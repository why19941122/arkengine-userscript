import assert from 'node:assert/strict';
import {test} from 'node:test';
import {auditStockTrades} from './arkengine-stock-trade-audit.mjs';

const start=Date.parse('2026-11-01T00:00:00Z'),minute=60000,version='1.17.114';
const rules={buyFeePct:2,sellFeePct:2.5,maxTradeTokens:100000,maxDailyBuyTokens:500000,maxPositionTokens:1000000,reserveTokens:1000000};
function fixture(){
  const events=[],position={stockId:1,shares:100,costBasisTokens:1020,holdUntil:new Date(start+60*minute).toISOString()};
  function observe(id,at,priceCents,positions,pending=null){
    events.push({at:at+1,version,type:'stock-observation',data:{observationVersion:2,observationId:id,
      at,part:0,totalParts:1,reading:{generation:events.length+1,phase:'scan',marketAt:at,balanceAt:at,freshnessAt:at},
      snapshot:{userId:7,enabled:true,stocks:[{id:1,modelName:'model',priceCents}],ticks:[],rules:{...rules},
        positions:structuredClone(positions),accountSnapshot:{userId:7,balanceTokens:10000,positions:structuredClone(positions),pendingKnown:true,pending}}}});
  }
  const buy={id:'buy-1',at:start,action:'buy',stockId:1,modelName:'model',shares:100,result:'success'};
  observe('buy',start+10,1000,[position],buy);
  events.push({at:start+11,version,type:'stock-confirmed',data:{action:'buy',model:'model',result:'success',
    submittedAt:start,confirmedAt:start+5,observationId:'buy',debitTokens:1020}});
  observe('locked',start+30*minute,1000,[position]);
  observe('unlock',start+61*minute,950,[position]);
  observe('later',start+90*minute,1100,[position]);
  const sale={id:'sell-1',at:start+120*minute,action:'sell',stockId:1,modelName:'model',shares:100,result:'success'};
  observe('sell',sale.at+10,900,[],sale);
  events.push({at:sale.at+11,version,type:'stock-confirmed',data:{action:'sell',model:'model',result:'success',
    submittedAt:sale.at,confirmedAt:sale.at+5,observationId:'sell',shares:100,releasedCost:1020,proceeds:877,realized:-143}});
  return {version,events};
}
const frame=(log,id)=>log.events.find(e=>e.type==='stock-observation'&&e.data.observationId===id).data.snapshot;
const receipt=(log,action)=>log.events.find(e=>e.type==='stock-confirmed'&&e.data.action===action);

test('实单归因：绑定原单、真实锁定与首次解锁报价，不择优或改变输入',()=>{
  const log=fixture(),before=JSON.stringify(log),r=auditStockTrades(log);
  assert.equal(r.receipts.buys,1);assert.equal(r.receipts.sales,1);assert.equal(r.receipts.realized,-143);
  assert.equal(r.attribution.firstUnlockQuotedNet,-94);assert.equal(r.attribution.afterUnlockQuoteDifference,-49);
  assert.equal(r.attribution.pairedRealized,-143);assert.equal(r.attribution.comparableLots,1);
  assert.equal(r.lots[0].firstUnlock.observationLagMs,minute);
  assert.equal(r.lots[0].lockObservations.bestObservedNet,-45);
  assert.equal(r.attribution.negativeAtEveryObservedLockedQuote,1);
  assert.equal(r.unpairedSales.length,0);assert.equal(r.qualifiedForLive,false);assert.equal(JSON.stringify(log),before);
});

test('实单归因：跨页重复成功与收入事件不重复加收益，原单矛盾报错',()=>{
  const log=fixture(),copy=structuredClone(receipt(log,'sell'));copy.pageId='other-page';copy.at+=5;
  log.events.push(copy,{version,type:'stock-income',data:{realized:-143}});
  const r=auditStockTrades(log);assert.equal(r.receipts.duplicates,1);assert.equal(r.receipts.realized,-143);
  copy.data.proceeds++;copy.data.realized++;
  assert.throws(()=>auditStockTrades(log),/Conflicting confirmed operation/);
});

test('实单归因：原仓卖出单列，不配成当前版本新入场或混入其他版本',()=>{
  const log=fixture();receipt(log,'buy').version='1.17.110';
  const r=auditStockTrades(log);assert.equal(r.receipts.buys,0);assert.equal(r.receipts.realized,-143);
  assert.equal(r.attribution.pairedLots,0);assert.equal(r.unpairedSales.length,1);
  const old=structuredClone(receipt(log,'sell'));old.version='1.17.110';old.data.proceeds=999;log.events.push(old);
  assert.deepEqual(auditStockTrades(log),r);
});

test('实单归因：缺绑定观察、错误原单或损益算术不会被推测补齐',()=>{
  for(const edit of [
    log=>receipt(log,'buy').data.observationId='missing',
    log=>frame(log,'buy').accountSnapshot.pending.at++,
    log=>receipt(log,'buy').data.confirmedAt=start+20,
    log=>receipt(log,'sell').data.realized++
  ]){
    const log=fixture();edit(log);const r=auditStockTrades(log);
    assert.equal(r.receipts.gaps.length,1);assert.equal(r.attribution.pairedLots,0);
  }
});

test('实单归因：部分卖出不冒充整仓清算，持仓变化不冒充同一笔',()=>{
  const log=fixture(),sale=receipt(log,'sell').data;
  Object.assign(sale,{shares:40,releasedCost:408,proceeds:351,realized:-57});
  frame(log,'sell').accountSnapshot.pending.shares=40;
  frame(log,'sell').accountSnapshot.positions=[{...frame(log,'buy').positions[0],shares:60,costBasisTokens:612}];
  const r=auditStockTrades(log);assert.equal(r.receipts.realized,-57);assert.equal(r.attribution.pairedLots,0);
  assert.equal(r.unpairedBuys[0].reason,'partial-or-intervening-operation');assert.equal(r.unpairedSales.length,1);
  const changed=fixture();frame(changed,'locked').accountSnapshot.positions[0].shares=101;
  assert.equal(auditStockTrades(changed).unpairedBuys[0].reason,'position-continuity-unverified');
});

test('实单归因：解锁首帧不可卖或缺失时不挑后续更好行情，不把未知当零收益',()=>{
  for(const [edit,reason] of [
    [v=>v.enabled=false,'market-disabled'],[v=>v.stocks[0].suspended=true,'suspended'],
    [v=>v.rules.reserveTokens=0,'liquidity'],[v=>v.stocks=[],'missing-quote']
  ]){
    const log=fixture();edit(frame(log,'unlock'));const r=auditStockTrades(log);
    assert.equal(r.lots[0].firstUnlock.blocked,reason);assert.equal(r.attribution.comparableLots,0);
    assert.equal(r.lots[0].afterUnlockQuoteDifference,null);assert.equal(r.attribution.firstUnlockQuotedNet,null);
  }
  const log=fixture();log.events=log.events.filter(e=>!['unlock','later'].includes(e.data.observationId));
  const r=auditStockTrades(log);assert.equal(r.lots[0].firstUnlock,null);assert.equal(r.attribution.comparableLots,0);
  assert.equal(r.attribution.firstUnlockQuotedNet,null);
});

test('实单归因：锁仓内缺报价不能宣称所有已观察行情都亏损',()=>{
  const log=fixture();frame(log,'locked').stocks=[];
  const r=auditStockTrades(log);assert.equal(r.lots[0].lockObservations.count,2);
  assert.equal(r.lots[0].lockObservations.knownQuotes,1);assert.equal(r.attribution.negativeAtEveryObservedLockedQuote,0);
});

test('实单归因：快照晚到不能把解锁前报价变成解锁后成交条件',()=>{
  const log=fixture(),data=log.events.find(e=>e.data.observationId==='unlock').data;
  data.reading.marketAt=start+59*minute;data.reading.freshnessAt=data.reading.marketAt;
  const r=auditStockTrades(log);
  assert.equal(r.lots[0].firstUnlock.blocked,'market-read-outside-window');
  assert.equal(r.lots[0].firstUnlock.marketAt,start+59*minute);
  assert.equal(r.attribution.comparableLots,0);assert.equal(r.attribution.firstUnlockQuotedNet,null);
});

test('实单归因：尚未卖出的新仓单列，未来回执不能补完较早导出',()=>{
  const log=fixture();log.events=log.events.filter(e=>e.at<start+120*minute);
  const r=auditStockTrades(log);
  assert.equal(r.receipts.buys,1);assert.equal(r.receipts.sales,0);
  assert.equal(r.unpairedBuys[0].reason,'no-observed-close');assert.equal(r.attribution.pairedLots,0);
});

test('实单归因：不同账户拒绝合并，观察缺片沿用原解析检查',()=>{
  const log=fixture();frame(log,'later').userId=8;frame(log,'later').accountSnapshot.userId=8;
  assert.throws(()=>auditStockTrades(log),/combine accounts/);
  const missing=fixture();missing.events[0].data.totalParts=2;
  assert.throws(()=>auditStockTrades(missing),/Incomplete observation/);
});
