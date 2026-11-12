import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {replayStrategy} from './arkengine-stock-strategy.mjs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const core=vm.runInNewContext(code.slice(code.indexOf('\n'))+'\nstockCore;');
const scriptVersion=source.match(/^\/\/ @version\s+(\S+)/m)?.[1]??null;
const sourceHashes=Object.fromEntries(['arkengine-auto-encounter.user.js','arkengine-stock-replay.mjs','arkengine-stock-strategy.mjs','arkengine-stock-research.mjs']
  .map(name=>[name,createHash('sha256').update(readFileSync(new URL('./'+name,import.meta.url))).digest('hex')]));

export function stockSnapshotsFromLog(log) {
  const events=Array.isArray(log?.days)?log.days.flatMap(d=>d.events||[]):log?.events;
  if(!Array.isArray(events))throw Error('Expected a script log export');
  const frames=new Map();let legacy=0;
  for(const event of events.filter(e=>e.type==='stock-observation')){
    const d=event.data;
    if(!d||d.truncated||!d.snapshot)throw Error('Observation data was truncated or is missing; do not evaluate incomplete samples');
    const id=d.observationId??`legacy-${legacy++}`,part=d.part??0,total=d.totalParts??1,at=d.at;
    if(!Number.isFinite(at)||!Number.isInteger(total)||total<1||total>1000||!Number.isInteger(part)||part<0||part>=total||
      !Array.isArray(d.snapshot.stocks)||!Array.isArray(d.snapshot.ticks))throw Error('Invalid observation frame');
    const schema=Object.hasOwn(d,'observationVersion')?d.observationVersion:1,reading=d.reading??null;
    if(![1,2].includes(schema)||schema===1&&reading!==null||schema===2&&(!reading||typeof d.observationId!=='string'||!d.observationId.trim()||
      !Number.isSafeInteger(reading.generation)||reading.generation<1||!['scan','pre-submit','reconcile'].includes(reading.phase)||
      !Number.isSafeInteger(at)||at<0||!['marketAt','balanceAt','freshnessAt'].every(k=>Number.isSafeInteger(reading[k])&&reading[k]>=0&&reading[k]<=at)||
      reading.freshnessAt!==Math.min(reading.marketAt,reading.balanceAt)))throw Error('Invalid observation availability or reading metadata');
    if(!frames.has(id))frames.set(id,{at,total,parts:new Map(),schema,reading,version:event.version??log.version??null,settings:d.settings??null});
    const frame=frames.get(id),previous=frame.parts.get(part);
    if(frame.at!==at||frame.total!==total||frame.schema!==schema||JSON.stringify(frame.reading)!==JSON.stringify(reading)||
      frame.version!==(event.version??log.version??null)||
      JSON.stringify(frame.settings)!==JSON.stringify(d.settings??null)||previous&&JSON.stringify(previous)!==JSON.stringify(d.snapshot))
      throw Error('Conflicting observation parts');
    frame.parts.set(part,d.snapshot);
  }
  if(!frames.size)throw Error('No observation snapshots in this export; trade summaries cannot substitute for market history');
  const snapshots=[];
  for(const [observationId,frame] of frames){
    if(frame.parts.size!==frame.total)throw Error('Incomplete observation frame; one or more parts are missing');
    const parts=Array.from({length:frame.total},(_,i)=>frame.parts.get(i)),first=parts[0];
    if(parts.some(p=>p.userId!==first.userId||p.enabled!==first.enabled||JSON.stringify(p.rules)!==JSON.stringify(first.rules)))
      throw Error('Conflicting observation market or rules');
    const sourceAccount=first.accountSnapshot??null;
    if(frame.schema===2&&(!sourceAccount||!Number.isSafeInteger(sourceAccount.balanceTokens)||sourceAccount.balanceTokens<0||
      typeof sourceAccount.pendingKnown!=='boolean'||sourceAccount.pendingKnown===false&&Object.hasOwn(sourceAccount,'pending')))
      throw Error('Incomplete observation account evidence');
    if(sourceAccount&&(sourceAccount.userId!==first.userId||!Array.isArray(sourceAccount.positions)||
        sourceAccount.pendingKnown===true&&!Object.hasOwn(sourceAccount,'pending'))||
      parts.slice(1).some(p=>p.accountSnapshot&&JSON.stringify(p.accountSnapshot)!==JSON.stringify(sourceAccount)))
      throw Error('Conflicting observation account evidence');
    snapshots.push({at:frame.at,sourceVersion:frame.version,recordedSettings:frame.settings,sourceAccount,
      ...(frame.schema===2?{sourceObservation:{id:observationId,version:frame.schema,reading:frame.reading}}:{}),
      view:{...first,stocks:parts.flatMap(p=>p.stocks),ticks:parts.flatMap(p=>p.ticks),positions:sourceAccount?.positions??first.positions,rounds:[],myBets:[]}});
  }
  snapshots.sort((a,b)=>a.at-b.at);
  return snapshots;
}

// Offline only. Every decision sees only the snapshot and ticks available at that timestamp.
export function replayStock({snapshots,initialBalance=10000,initialPositions,initialPending,externalFlows=[],
  accountLimits={capital:400000,loss:100000},initialBudgetLoss=0,config={},holdMs=3600000,executionDelayMs=0,strategy={},exitPriceHaircutBps=0,
  boundaryAts=[],stopBeforeActionsAt=null}) {
  if(!Array.isArray(snapshots)||!snapshots.length||!Number.isSafeInteger(initialBalance)||initialBalance<0||
      !Number.isSafeInteger(holdMs)||holdMs<0||!Number.isSafeInteger(executionDelayMs)||executionDelayMs<0||
      !Number.isSafeInteger(exitPriceHaircutBps)||exitPriceHaircutBps<0||exitPriceHaircutBps>=10000)throw Error('Invalid replay input');
  const policy=replayStrategy(core,strategy),occupancy=[];
  const sellPrice=price=>Number(BigInt(price)*BigInt(10000-exitPriceHaircutBps)/10000n);
  const cfg={trade:true,predict:false,tradeLimit:3000,predictionLimit:0,stake:0,reserve:100,...config,predict:false};
  if(!config||typeof config!=='object'||Array.isArray(config)||typeof cfg.trade!=='boolean'||
    ['autoBudget','netEfficiency'].some(k=>cfg[k]!==undefined&&typeof cfg[k]!=='boolean')||
    ['tradeLimit','predictionLimit','stake','reserve'].some(k=>!core.whole(cfg[k])||cfg[k]>1e12)||
    ['dailyBuyLimit','positionLimit','perStockLimit','riskLimit','cashReserve','lossLimit'].some(k=>cfg[k]!=null&&(!core.whole(cfg[k])||cfg[k]>1e12)))
    throw Error('Invalid replay configuration');
  const ledger={owned:{},entries:[]},positions=[],trades=[],orders=[],curve=[],identities=new Map(),accountCurve=[],decisions=[];
  const account=snapshots[0].view?.userId;
  const firstAt=typeof snapshots[0].at==='number'?snapshots[0].at:Date.parse(snapshots[0].at);
  const lastAt=typeof snapshots.at(-1).at==='number'?snapshots.at(-1).at:Date.parse(snapshots.at(-1).at);
  const observedAts=new Set(snapshots.map(s=>typeof s.at==='number'?s.at:Date.parse(s.at)));
  if(!Array.isArray(boundaryAts)||new Set(boundaryAts).size!==boundaryAts.length||
    boundaryAts.some(t=>!Number.isSafeInteger(t)||!observedAts.has(t))||
    stopBeforeActionsAt!==null&&(!Number.isSafeInteger(stopBeforeActionsAt)||stopBeforeActionsAt!==lastAt))
    throw Error('Account boundaries require exact observed timestamps; the read-only stop must be the final snapshot');
  const boundaryTimes=new Set([...boundaryAts,...(stopBeforeActionsAt===null?[]:[stopBeforeActionsAt])]),boundaries=[];
  const opening=initialPositions??snapshots[0].view?.positions;
  if(snapshots[0].sourceAccount&&(snapshots[0].sourceAccount.pendingKnown!==true||snapshots[0].sourceAccount.pending)&&initialPending===undefined)
    throw Error('Opening pending state requires explicit reconciliation; do not assume no pending order');
  if(!Array.isArray(opening)||!Array.isArray(externalFlows)||
    !accountLimits||!core.whole(accountLimits.capital)||accountLimits.capital>400000||!core.whole(accountLimits.loss)||accountLimits.loss>100000)
    throw Error('Opening positions or account limits missing or invalid');
  for(const p of opening){
    const stock=snapshots[0].view.stocks?.find(s=>core.sameStockId(s.id,p.stockId));
    const modelName=p.modelName??stock?.modelName;
    positions.push({stockId:p.stockId,shares:p.shares,costBasisTokens:p.costBasisTokens,holdUntil:p.holdUntil});
    ledger.owned[String(p.stockId)]={shares:p.shares,cost:p.costBasisTokens,modelName,manual:p.managed!==true};
  }
  let accountRecord=core.account.create({trialId:'offline-stock',userId:account,at:firstAt,cash:initialBalance,limits:accountLimits,initialBudgetLoss,
    positions:opening.map(p=>({stockId:p.stockId,modelName:ledger.owned[String(p.stockId)].modelName,shares:p.shares,costBasisTokens:p.costBasisTokens,
      holdUntil:p.holdUntil===null?null:Date.parse(p.holdUntil)}))});
  const flows=externalFlows.map(f=>({...f,type:'transfer'})).sort((a,b)=>a.at-b.at);
  if(flows.some(f=>!Number.isSafeInteger(f.at)||f.at<firstAt||f.at>lastAt)||new Set(flows.map(f=>String(f.id))).size!==flows.length)
    throw Error('External flows must have unique identities inside the observed window');
  let flowIndex=0,initialAccountReport=null;
  let balance=initialBalance,peak=initialBalance,maxDrawdown=0,previous=-Infinity,feesAndRounding=0,missingValuationSamples=0,pending=null,halt=null;
  if(initialPending){
    const p=initialPending;
    if(!core.id(p.id)||!Number.isSafeInteger(p.decisionAt)||p.decisionAt>firstAt||!Number.isSafeInteger(p.dueAt)||p.dueAt<p.decisionAt)
      throw Error('Invalid opening pending order');
    const order={...p,id:String(p.id),status:'pending'},action={action:p.action,stockId:p.stockId,modelName:p.modelName,shares:p.shares,debit:p.reservedTokens,reason:'opening-pending'};
    accountRecord=core.account.append(accountRecord,{...order,type:'submit',at:firstAt});
    orders.push(order);pending={action,order};
    ledger.entries.push({id:order.id,action:order.action,stockId:order.stockId,at:order.decisionAt,debit:order.reservedTokens,result:'reserved'});
  }
  let peakCommitted=core.account.read(accountRecord).capital;
  const valuations=(view,at,r)=>positions.map(p=>{
    const stock=view.stocks.find(s=>core.sameStockId(s.id,p.stockId));
    const quoted=stock&&!stock.suspended?core.quote(sellPrice(stock.priceCents),p.shares,r.sellFeePct,false):null;
    const executable=quoted!==null&&quoted>0&&view.enabled&&!(p.holdUntil&&Date.parse(p.holdUntil)>at)&&
      core.saleAmount(sellPrice(stock.priceCents),p.shares,r.sellFeePct)!==null&&quoted<=Math.min(r.maxTradeTokens,r.reserveTokens);
    return {stockId:p.stockId,lower:executable?quoted:0,upper:executable?quoted:null,quoted};
  });
  for(const sample of snapshots){
    const at=typeof sample.at==='number'?sample.at:Date.parse(sample.at);
    if(!Number.isFinite(at)||at<=previous)throw Error('Snapshots must have unique increasing timestamps');
    previous=at;
    const view=structuredClone(sample.view);
    if(!view||!Array.isArray(view.ticks))throw Error('Snapshot market data missing');
    if(view.userId!==account)throw Error('Snapshots from different accounts cannot share a portfolio');
    for(const s of view.stocks||[]){
      if(identities.has(String(s.id))&&identities.get(String(s.id))!==s.modelName)throw Error('Stock identity changed between snapshots');
      identities.set(String(s.id),s.modelName);
    }
    view.ticks=view.ticks.filter(t=>Number.isFinite(Date.parse(t.createdAt))&&Date.parse(t.createdAt)<=at);
    policy.observe(view,at);
    view.positions=structuredClone(positions);view.myBets=[];view.rounds=[];
    let model=core.model(view,{tokens:balance});if(!model)throw Error('Snapshot does not match the verified stock contract');
    if(!initialAccountReport){initialAccountReport=core.account.report(accountRecord,{at,values:valuations(view,at,model.rules)});
      peak=initialAccountReport.equity.quoted??initialAccountReport.equity.lower;}
    // Transfers strictly before this boundary belong to the preceding segment.
    // A transfer or receipt at the boundary belongs to the next segment instead.
    while(flowIndex<flows.length&&flows[flowIndex].at<at){accountRecord=core.account.append(accountRecord,flows[flowIndex++]);}
    balance=core.account.read(accountRecord).cash;
    model=core.model(view,{tokens:Math.max(0,balance)});
    if(!model)throw Error('Snapshot does not match the verified stock contract');
    if(boundaryTimes.has(at)){
      const boundary={at,phase:'before-account-actions',report:core.account.report(accountRecord,{at,values:valuations(view,at,model.rules)}),
        continuity:structuredClone({accountRecord,ledger,positions,pending,strategy:policy.report(),halt})};
      boundaries.push({...boundary,sha256:createHash('sha256').update(JSON.stringify(boundary)).digest('hex')});
    }
    const readOnlyEnd=at===stopBeforeActionsAt;
    if(!readOnlyEnd){
    while(flowIndex<flows.length&&flows[flowIndex].at<=at){accountRecord=core.account.append(accountRecord,flows[flowIndex++]);}
    balance=core.account.read(accountRecord).cash;
    model=core.model(view,{tokens:Math.max(0,balance)});if(!model)throw Error('Snapshot does not match the verified stock contract');
    const hadPending=Boolean(pending);
    function executePending(){
      if(!pending||at<pending.order.dueAt)return;
      const {action,order}=pending,stock=view.stocks.find(s=>core.sameStockId(s.id,action.stockId)),buy=action.action==='buy',r=model.rules;
      const price=stock?(buy?stock.priceCents:sellPrice(stock.priceCents)):null;
      const amount=stock?(buy?core.quote(price,action.shares,r.buyFeePct,true):core.saleAmount(price,action.shares,r.sellFeePct)):null;
      const pos=positions.find(p=>core.sameStockId(p.stockId,action.stockId)),held=positions.reduce((sum,p)=>sum+p.costBasisTokens,0);
      let reason=!view.enabled?'market-disabled':!stock?'missing-quote':stock.suspended?'suspended':buy&&stock.stale?'stale-quote':
        amount===null?'unrepresentable-quote':null;
      if(!reason&&buy)reason=amount>balance?'cash':amount>r.maxTradeTokens?'trade-limit':
        core.spend(ledger.entries.filter(e=>e.id!==order.id||e.result!=='reserved'),'buy',at)+amount>r.maxDailyBuyTokens?'daily-limit':held+amount>r.maxPositionTokens?'position-limit':null;
      if(!reason&&!buy)reason=!pos||pos.shares<action.shares?'position':Date.parse(pos.holdUntil)>at?'holding-period':
        amount>r.maxTradeTokens?'trade-limit':amount>r.reserveTokens?'liquidity':amount===0?'zero-proceeds':null;
      Object.assign(order,{resolvedAt:at,observationLagMs:at-order.dueAt,status:reason?'unfilled':'filled'});
      pending=null;
      const legacyPending=ledger.entries.find(e=>e.id===order.id&&e.result==='reserved');
      if(legacyPending)ledger.entries.splice(ledger.entries.indexOf(legacyPending),1);
      if(reason){order.reason=reason;
        accountRecord=core.account.append(accountRecord,{id:'receipt-'+order.id,type:'reject',orderId:order.id,at,reason});}
      else {
        order.amount=amount;order.priceCents=price;order.reservationExceeded=buy&&amount>order.reservedTokens;
        const gross=price*action.shares/100;
        const entry={id:order.id,at,confirmedAt:at,stockId:stock.id,modelName:stock.modelName,
          action:action.action,shares:action.shares,result:'success',debit:buy?amount:0};
        if(buy){
          balance-=amount;feesAndRounding+=amount-gross;
          positions.push({stockId:stock.id,shares:action.shares,costBasisTokens:amount,holdUntil:new Date(at+holdMs).toISOString()});
          ledger.owned[String(stock.id)]={shares:action.shares,cost:amount,modelName:stock.modelName,manual:false};
        }else{
          const before=pos.costBasisTokens;
          const remaining=pos.shares-action.shares;
          pos.costBasisTokens=Number((BigInt(before)*BigInt(remaining)+BigInt(pos.shares)-1n)/BigInt(pos.shares));pos.shares=remaining;
          entry.releasedCost=before-pos.costBasisTokens;entry.proceeds=amount;balance+=amount;feesAndRounding+=gross-amount;
          if(remaining)ledger.owned[String(stock.id)]={shares:remaining,cost:pos.costBasisTokens,modelName:stock.modelName,manual:false};
          else {positions.splice(positions.indexOf(pos),1);delete ledger.owned[String(stock.id)];}
        }
        ledger.entries.push(entry);trades.push({...entry,decisionAt:order.decisionAt,priceCents:price,reason:action.reason});
        policy.filled(action,at,positions.find(p=>core.sameStockId(p.stockId,stock.id))?.shares??0);
        accountRecord=core.account.append(accountRecord,{id:'receipt-'+order.id,type:'fill',orderId:order.id,at,amount,
          ...(buy?{holdUntil:at+holdMs}:{remainingCost:positions.find(p=>core.sameStockId(p.stockId,stock.id))?.costBasisTokens??0})});
        // S0 retains the runtime's full stop. Research candidates stop buys but allow risk exits.
        if(buy&&(amount>order.reservedTokens||!cfg.autoBudget&&core.spend(ledger.entries,'buy',at)>cfg.tradeLimit))
          halt={at,orderId:order.id,reason:amount>order.reservedTokens?'buy-reservation-exceeded':'buy-budget-exceeded',
            reservedTokens:order.reservedTokens,actualTokens:amount};
      }
    }
    // A receipt consumes this observation cycle. Never spend unconfirmed sale proceeds.
    executePending();
    view.positions=structuredClone(positions);
    model=core.model(view,{tokens:Math.max(0,balance)});
    const valuation={at,values:valuations(view,at,model.rules)},marked=core.account.mark(accountRecord,valuation);
    accountRecord=marked.record;
    if(!hadPending&&!pending){
      const funded=core.accountBudget(model,cfg,ledger,at,marked.report.newRiskCapacity);
      const action=policy.choose(model,funded,ledger,at,marked.report,halt);
      if(action)decisions.push({at,action:action.action,stockId:action.stockId,shares:action.shares,
        reservedTokens:action.action==='buy'?action.debit:0,newRiskCapacity:marked.report.newRiskCapacity,
        allowed:action.action!=='buy'||action.debit<=marked.report.newRiskCapacity,
        reasons:action.action==='buy'&&action.debit>marked.report.newRiskCapacity?[...marked.report.reasons,'new-risk-budget']:[]});
      if(action&&(action.action!=='buy'||action.debit<=marked.report.newRiskCapacity)){
        let orderId=String(orders.length+1);while(orders.some(o=>o.id===orderId))orderId='new-'+orderId;
        const order={id:orderId,decisionAt:at,dueAt:at+executionDelayMs,action:action.action,
          stockId:action.stockId,modelName:action.modelName,shares:action.shares,
          reservedTokens:action.action==='buy'?action.debit:0,status:'pending',
          ...(action.research?{research:structuredClone(action.research)}:{})};
        if(!Number.isSafeInteger(order.dueAt))throw Error('Delayed order time outside supported range');
        accountRecord=core.account.reserve(accountRecord,{...order,type:'submit',at},valuation);
        peakCommitted=Math.max(peakCommitted,core.account.read(accountRecord).capital);
        orders.push(order);pending={action,order};
        executePending();
      }
    }
    }
    let value=balance,unknown=0;
    for(const pos of positions){
      const stock=view.stocks.find(s=>core.sameStockId(s.id,pos.stockId));
      const liquidation=stock&&!stock.suspended?core.quote(sellPrice(stock.priceCents),pos.shares,model.rules.sellFeePct,false):null;
      if(liquidation===null)unknown++;else value+=liquidation;
    }
    if(unknown)value=null;
    if(value!==null){const adjusted=value-core.account.read(accountRecord).externalNet;
      peak=Math.max(peak,adjusted);maxDrawdown=Math.max(maxDrawdown,peak?1-adjusted/peak:0);}
    if(unknown)missingValuationSamples++;
    const investedCost=positions.reduce((sum,pos)=>sum+pos.costBasisTokens,0);
    curve.push({at,cash:balance,investedCost,estimatedEquity:value,unknownPositions:unknown});
    occupancy.push({at,positions:positions.map(p=>{
      const s=view.stocks.find(s=>core.sameStockId(s.id,p.stockId));
      return {cost:p.costBasisTokens,holdUntil:p.holdUntil===null?at:Date.parse(p.holdUntil),
        unavailable:!view.enabled||!s||s.suspended===true};
    })});
    const end=readOnlyEnd?{record:accountRecord,report:boundaries.at(-1).report}:
      core.account.mark(accountRecord,{at,values:valuations(view,at,model.rules)});
    accountRecord=end.record;accountCurve.push(end.report);
    peakCommitted=Math.max(peakCommitted,end.report.capital);
    const audited=core.account.read(accountRecord);
    if(audited.cash!==balance||audited.heldCost!==investedCost||audited.pendingBuy!==(pending?.order.action==='buy'?pending.order.reservedTokens:0))
      throw Error('Replay and independent stock account disagree');
  }
  const equity=curve.at(-1).estimatedEquity;
  // 每笔模拟成交后的成本保持到下一次快照；末点没有后续观察时间，不外推占用时长。
  const observedDurationMs=curve.at(-1).at-curve[0].at;
  const costTime=curve.slice(0,-1).reduce((sum,point,i)=>sum+point.investedCost*(curve[i+1].at-point.at),0);
  const capitalUsage={basis:'cost-basis',peakCost:curve.reduce((peak,p)=>Math.max(peak,p.investedCost),0),
    endingCost:curve.at(-1).investedCost,timeWeightedAverageCost:observedDurationMs?costTime/observedDurationMs:null,observedDurationMs};
  const capitalExposure={basis:'remaining-cost-plus-pending-buys',peak:peakCommitted,
    ending:accountCurve.at(-1).capital,endingPendingBuy:accountCurve.at(-1).pendingBuy,
    timeWeightedAverage:observedDurationMs?accountCurve.slice(0,-1).reduce((n,p,i)=>n+p.capital*(accountCurve[i+1].at-p.at),0)/observedDurationMs:null};
  const netInterval=core.account.window(initialAccountReport,accountCurve.at(-1));
  const knownNet=!pending&&netInterval.lower!==null&&netInterval.lower===netInterval.upper?netInterval.lower:null;
  const rollingWindows=accountCurve.flatMap(point=>{const target=point.at-7*86400000;
    const from=initialAccountReport.at===target?initialAccountReport:accountCurve.find(p=>p.at===target);
    return from?[core.account.window(from,point)]:[];});
  const execution={submitted:orders.length,filled:trades.length,unfilled:orders.filter(o=>o.status==='unfilled').length,
    pending:Number(Boolean(pending)),overReservation:orders.filter(o=>o.reservationExceeded).length,complete:!pending,halt};
  const holdingExposure={lockedPositionMs:0,unavailablePositionMs:0,lockedCostTokenMs:0,unavailableCostTokenMs:0};
  for(let i=0;i<occupancy.length-1;i++)for(const p of occupancy[i].positions){
    const from=occupancy[i].at,to=occupancy[i+1].at,locked=Math.max(0,Math.min(to,p.holdUntil)-from),unavailable=p.unavailable?to-from:0;
    holdingExposure.lockedPositionMs+=locked;holdingExposure.lockedCostTokenMs+=locked*p.cost;
    holdingExposure.unavailablePositionMs+=unavailable;holdingExposure.unavailableCostTokenMs+=unavailable*p.cost;
  }
  const turnover=trades.reduce((n,t)=>({buyTokens:n.buyTokens+t.debit,sellProceeds:n.sellProceeds+(t.proceeds??0),
    releasedCost:n.releasedCost+(t.releasedCost??0)}),{buyTokens:0,sellProceeds:0,releasedCost:0});
  turnover.realized=turnover.sellProceeds-turnover.releasedCost;
  turnover.capitalWeightedClosedReturn=turnover.releasedCost?turnover.realized/turnover.releasedCost:null;
  return {kind:'offline-simulation',samples:snapshots.length,initialBalance,endingCash:balance,estimatedEquity:equity,
    simulation:{scriptVersion,sourceHashes,config:cfg,holdMs,executionDelayMs,exitPriceHaircutBps,strategy:policy.policy,fillPolicy:'first-observed-snapshot-at-or-after-delay',
      from:curve[0].at,to:curve.at(-1).at,initialPositions:structuredClone(opening),usesRecordedSettings:false,accountLimits,initialBudgetLoss,
      ...(boundaryTimes.size?{boundaryAts:[...boundaryTimes],stopBeforeActionsAt}:{} )},
    observation:{versions:[...new Set(snapshots.map(s=>s.sourceVersion).filter(Boolean))],
      settings:[...new Map(snapshots.filter(s=>s.recordedSettings).map(s=>[JSON.stringify(s.recordedSettings),s.recordedSettings])).values()]},
    net:knownNet,netInterval,maxDrawdown:pending||missingValuationSamples?null:maxDrawdown,
    valuationComplete:missingValuationSamples===0,missingValuationSamples,feesAndRounding,baselineNoTrade:opening.length?null:initialBalance,
    capitalUsage,capitalExposure,holdingExposure,turnover,strategy:policy.report(),execution,orders,decisions,trades,positions,curve,account:{record:accountRecord,initial:initialAccountReport,
      ending:accountCurve.at(-1),curve:accountCurve,rollingWindows,
      ...(boundaryTimes.size?{boundaries,deferredExternalFlows:structuredClone(flows.slice(flowIndex))}:{} )},assumptions:[
      '仅使用每个决策时点已出现的数据；输入必须是独立保存的历史快照。',
      `模拟按决策时固定股数下单，等待至少${executionDelayMs}毫秒后用首个已有快照的报价与规则评估整单成交；不插值、不缩单。实际等待及快照滞后另列，样本结束仍待定时不输出完整净收益或回撤。`,
      '成交只模拟公开手续费、取整、现金、单笔/日买入/持仓上限及卖出储备；规则不满足记未成交，不伪称真实服务器拒绝。市价可以超过下单前的报价预留，超额另记，不保证真实市场能按此价成交。',
      '超预留或非自动资金模式超额度时，S0沿用线上候选的全自动暂停；S1/S2/S3研究候选停止新增买入，已有管理仓解锁后可按风险退出。此差别单列，尚未改变实号退出行为。execution.complete只表示没有待定订单。',
      '各快照的行情和系统储备视为外部条件；不模拟自身买卖对后续价格或储备的影响，也不复现服务器撮合与重试。',
      '持有期由输入holdMs指定，从模拟成交开始；每个快照最多一笔新决策，存在待定订单时不再下单。缺价不按成本估值；报价净值与当前可退出估值分列，锁仓或整仓退出受限时下界0、上界未知，不将纸面浮盈当可兑现收益。maxDrawdown只度量扣外部流量后的报价净值。',
      '起点现金由initialBalance明确分配，已有仓取initialPositions或首快照positions，缺成本/持有期证据拒绝；只有managed:true的既有仓参与原策略卖出，所有仓都计风险。初始未决单显式导入，成交后才起算持有期；其他玩法不通过余额差入账，显式转入转出从净收益扣除。',
      'capitalUsage保留已成交成本统计；capitalExposure及account计入未决买单最大扣款预留，不能将前者用作40万边界证明。部分卖出只释放有证据的成本；平均值按相邻快照实际间隔加权，不外推末点之后。',
      '独立试验账本使用40万本金/10万累计净亏损上限（允许更低配置），浮盈和预测不补亏损预算；缺可信尾部界按投入全损预留。触线持久停新增风险，原可退出仓继续由原策略管理；不将此核算称为新盈利策略。七天窗口仅使用恰好相隔168小时的实际观察端点，缺端点不插值认证。',
      'S1/S2仅用首次可见历史生成固定信号，入场低点冻结；计划期限从实际成交起算。fixed只按期及累计风险退出，risk另加净亏6%和信号失效；锁仓中的触发只作记录，解锁重评。原有仓及起点未决买单对所有候选均用S0退出。S3不开新仓。研究排序按股票ID，不冒充已有经验收益分布或获准的实号策略。',
      '退出压力按exitPriceHaircutBps下调实际卖价及持仓清算估值；它不是实际滑点估计。锁定时长按原生截止时间、不可交易时长按观测状态延续至下一快照估算，多仓时长可重叠，二者不能相加当墙钟时间。周转收益使用已释放历史成本，不等于本窗口净资产收益。',
      '网站日额度暂按既有滚动24小时spend模拟，尚无服务器日界线及起点前已用额度证据；所有报告保持未通过实号验证，不能把本地成交模型当作网站规则证明。',
      '预测未参与模拟；结果不能作为真实收益或未来盈利证明。'
    ]};
}

// Endpoints are before transfers, receipts and decisions at that timestamp.
// They may share an already observed boundary quote, never a future fill.
export function stockReplayWindow(replay,from,to) {
  const boundary=t=>replay?.account?.boundaries?.find(b=>b.at===t&&b.phase==='before-account-actions');
  const a=boundary(from),b=boundary(to);
  if(!a||!b||from>=to)throw Error('Window requires two recorded before-action account boundaries');
  return core.account.window(a.report,b.report);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2])throw Error('Usage: node arkengine-stock-replay.mjs input.json [output.json]');
  const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const result=replayStock({...input,snapshots:input.snapshots??stockSnapshotsFromLog(input)});
  const json=JSON.stringify(result,null,2)+'\n';
  if(process.argv[3])writeFileSync(process.argv[3],json);else process.stdout.write(json);
}
