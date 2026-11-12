import {stockResearchSignal} from './arkengine-stock-research.mjs';

const minute=60000;
const byId=(a,b)=>String(a.id).localeCompare(String(b.id),'en');

// Offline research only. The production chooser is deliberately left unchanged.
export function replayStrategy(core,input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['candidate','holdMinutes','exitMode'].includes(k)))throw Error('Invalid replay strategy');
  const policy={candidate:'S0',holdMinutes:60,exitMode:'fixed',...input};
  if(!['S0','S1','S2','S3'].includes(policy.candidate)||![60,120,240].includes(policy.holdMinutes)||
    !['fixed','risk'].includes(policy.exitMode))throw Error('Invalid replay strategy');
  const history=new Map(),lots=new Map(),checks=[];
  const baseline=policy.candidate==='S0';
  const ticks=id=>[...(history.get(String(id))?.values()??[])].sort((a,b)=>a.at-b.at);
  function observe(view,at){
    if(baseline)return;
    for(const t of view.ticks){
      const time=Date.parse(t.createdAt);
      if(!Number.isFinite(time)||time>at)continue;
      if(!core.id(t.stockId)||!core.positive(t.priceCents))throw Error('Invalid visible research tick');
      const id=String(t.stockId);
      if(!history.has(id))history.set(id,new Map());
      const series=history.get(id),old=series.get(time);
      if(old&&old.priceCents!==t.priceCents)throw Error('Conflicting visible research tick');
      if(!old)series.set(time,{at:time,priceCents:t.priceCents,firstSeenAt:at});
    }
  }
  function choose(m,cfg,ledger,at,report,executionHalt,{allowEntry=true}={}){
    if(typeof allowEntry!=='boolean')throw Error('Invalid entry permission');
    if(!allowEntry&&baseline)throw Error('Exit-only research requires an S1/S2/S3 policy');
    if(baseline)return executionHalt?null:core.choose(m,cfg,ledger,at);
    if(!cfg.trade){checks.push({at,stage:'wait',reason:'trading-disabled'});return null;}
    const v=m.view,r=m.rules,exitCandidates=[];
    for(const p of v.positions){
      const owned=ledger.owned[String(p.stockId)],s=v.stocks.find(s=>core.sameStockId(s.id,p.stockId));
      if(!owned||owned.manual)continue;
      const lot=lots.get(String(p.stockId));
      // All opening positions and opening pending orders share the same S0 exit policy.
      const inherited=!lot;
      const net=s&&!s.suspended?core.quote(s.priceCents,p.shares,r.sellFeePct,false):null;
      const triggers=[];
      if(report.halt||executionHalt)triggers.push('account-risk-stop');
      let r30=null;
      if(lot){
        if(lot.exitMode==='risk'&&net!==null&&BigInt(net)*100n<=BigInt(p.costBasisTokens)*94n)triggers.push('net-loss-6pct');
        if(lot.exitMode==='risk'&&s&&!s.stale&&!s.suspended){
          const series=ticks(s.id),last=series.at(-1),ref=series.findLast(t=>t.at<=at-30*minute);
          const recent=ref?series.filter(t=>t.at>=ref.at):[];
          const fresh=last&&at-last.at<=10*minute&&last.priceCents===s.priceCents;
          if(fresh&&ref&&at-30*minute-ref.at<=5*minute&&recent.every((t,i)=>!i||t.at-recent[i-1].at<=10*minute))
            r30=s.priceCents/ref.priceCents-1;
          if(lot.candidate==='S1'&&r30!==null&&r30<=0)triggers.push('S1-invalidated');
          if(lot.candidate==='S2'&&fresh&&s.priceCents<lot.signalLowCents)triggers.push('S2-invalidated');
        }
        if(at>=lot.exitAt)triggers.push('planned-exit');
      }
      const oldSale=inherited?core.sellPlan(m,s??{id:p.stockId,suspended:true},ledger.owned,at):null;
      if(inherited&&oldSale?.action)triggers.push('opening-S0-exit');
      let blocked=!v.enabled?'market-disabled':!s?'missing-quote':s.suspended?'suspended':
        p.holdUntil&&Date.parse(p.holdUntil)>at?'holding-period':null;
      const shares=!blocked&&s?core.saleSharesFor(s.priceCents,r.sellFeePct,Math.min(r.maxTradeTokens,r.reserveTokens),p.shares):0;
      if(!blocked&&triggers.length&&(!shares||!core.quote(s.priceCents,shares,r.sellFeePct,false)))blocked='liquidity-or-rounding';
      checks.push({at,stage:'exit',stockId:p.stockId,policy:lot??{candidate:'S0',origin:'opening'},
        triggers,blocked,net,r30,holdUntil:p.holdUntil});
      if(triggers.length&&!blocked)exitCandidates.push({action:'sell',stockId:s.id,modelName:s.modelName,shares,debit:0,
        reason:triggers[0],priority:triggers[0]==='account-risk-stop'?0:triggers[0]==='net-loss-6pct'?1:triggers[0].endsWith('invalidated')?2:3});
    }
    if(exitCandidates.length)return exitCandidates.sort((a,b)=>a.priority-b.priority||byId({id:a.stockId},{id:b.stockId}))[0];
    if(!allowEntry){checks.push({at,stage:'wait',reason:'matched-entry-shadow-no-reinvestment'});return null;}
    if(policy.candidate==='S3'){checks.push({at,stage:'wait',reason:'no-new-position-control'});return null;}
    const funded=core.funding(m,cfg),held=v.positions.reduce((n,p)=>n+p.costBasisTokens,0);
    const used=core.spend(ledger.entries,'buy',at),managed=v.positions.filter(p=>!ledger.owned[String(p.stockId)]?.manual).length;
    const bounds={cash:m.balance-funded.reserve,scriptDaily:funded.tradeLimit-used,scriptPosition:funded.positionLimit-held,
      perStock:funded.perStockLimit,websiteTrade:r.maxTradeTokens,websiteDaily:r.maxDailyBuyTokens-used,
      websitePosition:r.maxPositionTokens-held,accountRisk:report.newRiskCapacity,
      ...(funded.riskLimit!=null?{configuredRisk:funded.riskLimit-core.riskExposure(m,ledger)}:{})};
    const budget=Math.max(0,Math.floor(Math.min(...Object.values(bounds))));
    let selected=null;
    for(const s of [...v.stocks].sort(byId)){
      const signal=stockResearchSignal({...s,status:s.suspended?'suspended':s.stale?'stale':null},ticks(s.id),at,policy.candidate);
      if(!signal.eligible){checks.push({at,stage:'signal',stockId:s.id,eligible:false,reason:signal.reason,features:signal.features??null});continue;}
      const reasons=[];
      if(!v.enabled)reasons.push('market-disabled');
      if(executionHalt||report.halt)reasons.push('persistent-risk-stop');
      if(core.riskReason(m,funded,ledger,at))reasons.push('configured-risk-stop');
      if(managed>=3)reasons.push('three-managed-positions');
      if(v.positions.some(p=>core.sameStockId(p.stockId,s.id))||ledger.owned[String(s.id)]?.manual)reasons.push('already-held-or-manual');
      if(ledger.entries.some(e=>core.sameStockId(e.stockId,s.id)&&e.action==='sell'&&e.result!=='rejected'&&core.entryTime(e)>at-60*minute))reasons.push('sale-cooldown');
      const shares=core.sharesFor(s.priceCents,r.buyFeePct,Math.floor(budget/1.1));
      const estimate=shares?core.quote(s.priceCents,shares,r.buyFeePct,true):0,debit=Math.ceil(estimate*1.1);
      if(!shares||debit>budget)reasons.push('insufficient-shared-budget');
      if(selected)reasons.push('stable-id-selection');
      checks.push({at,stage:'entry',stockId:s.id,eligible:true,features:signal.features,bounds,budget,shares,
        reservedTokens:debit,allowed:!reasons.length,reasons});
      if(!reasons.length)selected={action:'buy',stockId:s.id,modelName:s.modelName,shares,debit,estimate,reason:policy.candidate+'-fixed-signal',
        research:{...policy,signalAt:at,features:structuredClone(signal.features),signalLowCents:signal.features?.signalLowCents??null}};
    }
    return selected;
  }
  function filled(action,at,remainingShares){
    if(action.action==='buy'&&action.research)lots.set(String(action.stockId),{...action.research,enteredAt:at,exitAt:at+action.research.holdMinutes*minute});
    if(action.action==='sell'&&!remainingShares)lots.delete(String(action.stockId));
  }
  return {policy,baseline,observe,choose,filled,report:()=>({policy,ranking:'stable-stock-id-research-only',
    openingExitPolicy:'S0',checks,lots:[...lots.entries()].map(([stockId,p])=>({stockId,...p})),qualifiedForLive:false})};
}
