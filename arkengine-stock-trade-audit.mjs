import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {stockSnapshotsFromLog} from './arkengine-stock-replay.mjs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const core=vm.runInNewContext(code.slice(code.indexOf('\n'))+'\nstockCore;');
const sha=value=>createHash('sha256').update(value).digest('hex');
const whole=value=>Number.isSafeInteger(value)&&value>=0;
const same=(a,b)=>core.sameStockId(a,b);
const sum=(rows,key)=>rows.reduce((n,row)=>n+row[key],0);

// Read-only receipt attribution, not a replay or an executable trading strategy.
export function auditStockTrades(log,{version=log?.version}={}){
  const raw=Array.isArray(log?.days)?log.days.flatMap(d=>d.events||[]):log?.events;
  if(!Array.isArray(raw)||typeof version!=='string'||!version)throw Error('Explicit log events and version required');
  const events=raw.filter(e=>(e.version??log.version)===version);
  const snapshots=stockSnapshotsFromLog({version,events});
  const account=snapshots[0].view.userId;
  if(snapshots.some(s=>s.view.userId!==account))throw Error('Trade audit cannot combine accounts');
  const frames=new Map(snapshots.filter(s=>s.sourceObservation).map(s=>[s.sourceObservation.id,s]));
  const receipts=new Map(),gaps=[];
  let duplicates=0;
  for(const event of events.filter(e=>e.type==='stock-confirmed'&&e.data?.result==='success')){
    const d=event.data,frame=frames.get(d.observationId),p=frame?.sourceAccount?.pending;
    const gap=reason=>gaps.push({at:event.at,action:d.action,model:d.model,reason});
    if(!['buy','sell'].includes(d.action))continue;
    if(!frame||!p){gap('missing-bound-receipt-observation');continue;}
    if(frame.sourceAccount.pendingKnown!==true||p.result!=='success'||!core.id(p.id)||!core.id(p.stockId)||
      p.action!==d.action||p.modelName!==d.model||p.at!==d.submittedAt||!core.positive(p.shares)||
      ![event.at,d.submittedAt,d.confirmedAt].every(whole)||d.submittedAt>d.confirmedAt||
      d.confirmedAt>frame.at||frame.at>event.at){gap('receipt-binding-mismatch');continue;}
    if(d.action==='buy'?!core.positive(d.debitTokens):
      !whole(d.proceeds)||!whole(d.releasedCost)||!Number.isSafeInteger(d.realized)||
      d.realized!==d.proceeds-d.releasedCost||d.shares!==p.shares){gap('invalid-receipt-amount');continue;}
    const receipt={id:String(p.id),stockId:p.stockId,model:d.model,action:d.action,shares:p.shares,
      submittedAt:d.submittedAt,confirmedAt:d.confirmedAt,
      ...(d.action==='buy'?{cost:d.debitTokens}:{proceeds:d.proceeds,releasedCost:d.releasedCost,realized:d.realized})};
    const old=receipts.get(receipt.id);
    if(old){
      if(JSON.stringify(old.receipt)!==JSON.stringify(receipt))throw Error('Conflicting confirmed operation');
      duplicates++;continue;
    }
    receipts.set(receipt.id,{receipt,frame});
  }
  const ordered=[...receipts.values()].sort((a,b)=>a.receipt.submittedAt-b.receipt.submittedAt);
  const lots=[],unpairedBuys=[],pairedSales=new Set();
  function quote(frame,pos,model,from){
    const m=core.model(frame.view,{tokens:frame.sourceAccount?.balanceTokens??0});
    const stock=frame.view.stocks.find(s=>same(s.id,pos.stockId));
    const marketAt=frame.sourceObservation?.reading.marketAt;
    const inWindow=whole(marketAt)&&marketAt>=from;
    const amount=inWindow&&m&&stock&&stock.modelName===model&&!stock.suspended?
      core.saleAmount(stock.priceCents,pos.shares,m.rules.sellFeePct):null;
    const blocked=!inWindow?'market-read-outside-window':!m?'invalid-market-contract':!stock?'missing-quote':stock.modelName!==model?'stock-identity-changed':
      stock.suspended?'suspended':!m.view.enabled?'market-disabled':amount===null?'unrepresentable-quote':
      amount===0?'zero-proceeds':amount>m.rules.maxTradeTokens?'trade-limit':amount>m.rules.reserveTokens?'liquidity':null;
    return {at:frame.at,marketAt:marketAt??null,priceCents:stock?.priceCents??null,quotedNet:amount===null?null:amount-pos.costBasisTokens,
      blocked,executableNet:blocked?null:amount-pos.costBasisTokens};
  }
  for(let i=0;i<ordered.length;i++){
    const {receipt:buy,frame}=ordered[i];if(buy.action!=='buy')continue;
    const reject=reason=>unpairedBuys.push({buyId:buy.id,stockId:buy.stockId,model:buy.model,reason});
    const pos=frame.view.positions.find(p=>same(p.stockId,buy.stockId)),unlockAt=Date.parse(pos?.holdUntil);
    if(!pos||pos.shares!==buy.shares||pos.costBasisTokens!==buy.cost||!whole(unlockAt)||unlockAt<buy.confirmedAt){
      reject('unverified-new-position-or-lock');continue;
    }
    const next=ordered.slice(i+1).find(r=>same(r.receipt.stockId,buy.stockId));
    if(!next){reject('no-observed-close');continue;}
    const sale=next.receipt;
    if(sale.action!=='sell'||sale.model!==buy.model||sale.shares!==buy.shares||sale.releasedCost!==buy.cost||
      sale.submittedAt<unlockAt||next.frame.view.positions.some(p=>same(p.stockId,buy.stockId)&&p.shares>0)){
      reject('partial-or-intervening-operation');continue;
    }
    const held=snapshots.filter(s=>s.at>=frame.at&&s.at<sale.submittedAt);
    if(gaps.some(g=>g.model===buy.model&&g.at>=buy.submittedAt&&g.at<=sale.confirmedAt)||held.some(s=>{
      const p=s.view.positions.find(p=>same(p.stockId,buy.stockId));
      return !p||p.shares!==buy.shares||p.costBasisTokens!==buy.cost||Date.parse(p.holdUntil)!==unlockAt;
    })) {reject('position-continuity-unverified');continue;}
    const unlocked=held.find(s=>s.at>=unlockAt),locked=held.filter(s=>s.at<unlockAt).map(s=>quote(s,pos,buy.model,buy.confirmedAt));
    const known=locked.filter(q=>q.quotedNet!==null),first=unlocked?quote(unlocked,pos,buy.model,unlockAt):null;
    pairedSales.add(sale.id);
    lots.push({buyId:buy.id,sellId:sale.id,stockId:buy.stockId,model:buy.model,shares:buy.shares,cost:buy.cost,
      boughtAt:buy.confirmedAt,unlockAt,soldAt:sale.confirmedAt,realized:sale.realized,
      firstUnlock:first?{...first,observationLagMs:first.at-unlockAt}:null,
      afterUnlockQuoteDifference:first?.executableNet===null||!first?null:sale.realized-first.executableNet,
      lockObservations:{count:locked.length,knownQuotes:known.length,
        bestObservedNet:known.length?Math.max(...known.map(q=>q.quotedNet)):null,
        allObservedQuotesNegative:known.length===locked.length&&known.length>0&&known.every(q=>q.quotedNet<0)}});
  }
  const all=[...receipts.values()].map(r=>r.receipt),sales=all.filter(r=>r.action==='sell'),buys=all.filter(r=>r.action==='buy');
  const comparable=lots.filter(l=>l.firstUnlock&&l.firstUnlock.executableNet!==null);
  return {kind:'stock-receipt-lock-attribution',sourceVersion:version,
    sourceHashes:Object.fromEntries(['arkengine-auto-encounter.user.js','arkengine-stock-replay.mjs','arkengine-stock-trade-audit.mjs']
      .map(name=>[name,sha(readFileSync(new URL('./'+name,import.meta.url)))])),
    coverage:{from:snapshots[0].at,to:snapshots.at(-1).at,observations:snapshots.length},
    receipts:{buys:buys.length,buyCost:sum(buys,'cost'),sales:sales.length,realized:sum(sales,'realized'),duplicates,gaps},
    attribution:{pairedLots:lots.length,comparableLots:comparable.length,pairedRealized:sum(lots,'realized'),
      comparableRealized:comparable.length?sum(comparable,'realized'):null,
      firstUnlockQuotedNet:comparable.length?sum(comparable.map(l=>({net:l.firstUnlock.executableNet})),'net'):null,
      afterUnlockQuoteDifference:comparable.length?sum(comparable,'afterUnlockQuoteDifference'):null,
      losingAtFirstUnlock:comparable.filter(l=>l.firstUnlock.executableNet<0).length,
      negativeAtEveryObservedLockedQuote:lots.filter(l=>l.lockObservations.allObservedQuotesNegative).length,
      maxUnlockObservationLagMs:comparable.length?Math.max(...comparable.map(l=>l.firstUnlock.observationLagMs)):null},
    lots,unpairedBuys,unpairedSales:sales.filter(s=>!pairedSales.has(s.id)),qualifiedForLive:false,
    limitations:['仅成功回执及其绑定观察参与配对；缺证据、加仓、部分卖出或观察到的持仓变化单列，不猜测对应关系。',
      '首次解锁报价采用锁定截止后的首个已有观察；行情读取也须在解锁后，不以迟到的解锁前报价代替。不插值或挑后续更好的报价，无法卖出时不计入可比较合计。',
      '解锁报价与实际收益的差额是同笔持仓的描述性归因，不是提前卖出的策略回测；交易等待、冲击和后续再投资未模拟。',
      '锁仓内最优值仅指已观察报价，不是区间真实最高价或可执行卖价；未知未按零填补。',
      '记录卖出的已实现损益包含旧仓，不等于期间总收益；未完整配对的交易不计入解锁归因。']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2]||!process.argv[3])throw Error('Usage: node arkengine-stock-trade-audit.mjs log.json report.json [version]');
  const raw=readFileSync(process.argv[2]),log=JSON.parse(raw);
  const report=auditStockTrades(log,{version:process.argv[4]??log.version});
  writeFileSync(process.argv[3],JSON.stringify({...report,input:{sha256:sha(raw),exportedAt:log.exportedAt}},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({receipts:report.receipts,attribution:report.attribution,unpairedBuys:report.unpairedBuys.length,
    unpairedSales:report.unpairedSales.length,qualifiedForLive:report.qualifiedForLive}));
}
