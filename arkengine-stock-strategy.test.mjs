import assert from 'node:assert/strict';
import {test} from 'node:test';
import {replayStock} from './arkengine-stock-replay.mjs';
import {compareStockStrategies} from './arkengine-stock-comparison.mjs';

const start=Date.parse('2026-11-01T00:00:00Z'),minute=60000;
function market(prices=Array.from({length:73},(_,i)=>1000+10*i),ids=[1]){
  return {initialBalance:10000,snapshots:prices.map((priceCents,i)=>({at:start+i*5*minute,view:{userId:7,enabled:true,
    stocks:ids.map(id=>({id,modelName:'模型'+id,priceCents,volume24h:1000})),positions:[],rounds:[],myBets:[],
    ticks:ids.flatMap(stockId=>prices.slice(0,i+1).map((p,j)=>({stockId,priceCents:p,createdAt:new Date(start+j*5*minute).toISOString()}))),
    rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:100000,maxDailyBuyTokens:500000,maxPositionTokens:400000,reserveTokens:1000000}}}))};
}
const first=(report,action)=>report.trades.find(t=>t.action===action);

test('研究额度一致性：S1与S2遵守网站已用买入额度，未知额度不当作未使用',()=>{
  for(const candidate of ['S1','S2']){
    const data=market(candidate==='S1'?undefined:
      Array.from({length:34},(_,i)=>i<=12?1200-15*i:i<=15?1020+(i-12)*10:1050));
    const strategy={candidate};assert.ok(first(replayStock({...data,strategy}),'buy'),'positive signal control '+candidate);
    for(const used of [500000,null,-1]){
      const blocked=structuredClone(data);for(const s of blocked.snapshots)s.view.dailyBoughtTokens=used;
      assert.equal(replayStock({...blocked,strategy}).orders.length,0,candidate+' '+used);
    }
    for(const s of data.snapshots)s.view.dailyBoughtTokens=499900;
    const limited=replayStock({...data,strategy});assert.ok(first(limited,'buy'));
    assert.ok(limited.orders.filter(o=>o.action==='buy').every(o=>o.reservedTokens<=100));
  }
});

test('研究额度一致性：升值人工仓按现价占用网站上限，原成本风险另计',()=>{
  const data=market();for(const s of data.snapshots){
    s.view.stocks.push({id:99,modelName:'人工仓',priceCents:10000,volume24h:100});
    s.view.rules.maxPositionTokens=1000;
  }
  const initialPositions=[{stockId:99,shares:10,costBasisTokens:100,holdUntil:null}];
  for(const candidate of ['S0','S1']){
    const r=replayStock({...data,initialPositions,strategy:{candidate}});
    assert.equal(r.orders.length,0,candidate);assert.equal(r.account.ending.heldCost,100);
  }
});

test('研究成交复核：等待期间网站日额度耗尽或变未知，原股数不伪造成交',()=>{
  for(const used of [500000,null]){
    const data=market();for(const s of data.snapshots.slice(13))s.view.dailyBoughtTokens=used;
    const r=replayStock({...data,executionDelayMs:5*minute,strategy:{candidate:'S1'}});
    assert.equal(r.orders[0].decisionAt,start+60*minute);
    assert.equal(r.orders[0].status,'unfilled');assert.equal(r.trades.length,0);
    assert.equal(r.execution.pending,0);assert.equal(r.account.ending.cash,10000);
  }
});

test('研究成交复核：等待期间原仓升值占满网站额度，不用历史成本放行买单',()=>{
  const data=market();for(const [i,s] of data.snapshots.entries()){
    s.view.stocks.push({id:99,modelName:'人工仓',priceCents:i>=13?10000:1000,volume24h:100});
    s.view.rules.maxPositionTokens=1000;
  }
  const r=replayStock({...data,initialPositions:[{stockId:99,shares:10,costBasisTokens:100,holdUntil:null}],
    executionDelayMs:5*minute,strategy:{candidate:'S1'}});
  assert.equal(r.orders[0].decisionAt,start+60*minute);
  assert.equal(r.orders[0].status,'unfilled');assert.equal(r.trades.length,0);
  assert.equal(r.account.ending.cash,10000);assert.equal(r.account.ending.heldCost,100);
});

test('组合策略：S0复用原策略，S1固定持有从实际成交起算，原生锁定另行约束',()=>{
  const data=market(),baseline=replayStock(data),explicit=replayStock({...data,strategy:{candidate:'S0'}});
  assert.deepEqual(explicit.trades,baseline.trades);assert.deepEqual(explicit.orders,baseline.orders);
  for(const holdMinutes of [60,120,240]){
    const r=replayStock({...data,executionDelayMs:10*minute,strategy:{candidate:'S1',holdMinutes}});
    const buy=first(r,'buy'),sell=first(r,'sell');
    assert.equal(buy.decisionAt,start+60*minute);assert.equal(buy.at,start+70*minute);
    assert.equal(sell.decisionAt,buy.at+holdMinutes*minute);assert.equal(sell.at,sell.decisionAt+10*minute);
    assert.equal(sell.reason,'planned-exit');assert.equal(r.orders[0].research.signalAt,buy.decisionAt);
  }
  const locked=replayStock({...data,holdMs:120*minute,strategy:{candidate:'S1',holdMinutes:60}});
  assert.equal(first(locked,'sell').at,first(locked,'buy').at+120*minute);
  assert.ok(locked.strategy.checks.some(c=>c.triggers?.includes('planned-exit')&&c.blocked==='holding-period'));
});

test('组合策略：S3禁止新仓，原有管理仓仍退出，手动仓只占资金风险',()=>{
  const data=market(),opening={stockId:1,modelName:'模型1',shares:100,costBasisTokens:1000,holdUntil:null};
  const empty=replayStock({...data,strategy:{candidate:'S3'}});assert.equal(empty.orders.length,0);assert.equal(empty.net,0);
  const manual=replayStock({...data,initialPositions:[opening],strategy:{candidate:'S3'}});assert.equal(manual.orders.length,0);
  assert.equal(manual.account.ending.heldCost,1000);
  const managed=replayStock({...data,initialPositions:[{...opening,managed:true}],strategy:{candidate:'S3'}});
  assert.deepEqual(managed.trades.map(t=>t.action),['sell']);assert.equal(managed.strategy.openingExitPolicy,'S0');
});

test('组合策略：S1趋势失效和固定到期分开比较，锁定期间不按触发旧价成交',()=>{
  const data=market(Array.from({length:65},(_,i)=>i<=12?1000+10*i:1120));
  const risk=replayStock({...data,strategy:{candidate:'S1',holdMinutes:240,exitMode:'risk'}});
  const fixed=replayStock({...data,strategy:{candidate:'S1',holdMinutes:240,exitMode:'fixed'}});
  assert.equal(first(risk,'sell').at,start+120*minute);assert.equal(first(risk,'sell').reason,'S1-invalidated');
  assert.equal(first(fixed,'sell').at,start+300*minute);
  assert.ok(risk.strategy.checks.some(c=>c.at===start+90*minute&&c.triggers.includes('S1-invalidated')&&c.blocked==='holding-period'));
});

test('组合策略：S2入场低点冻结，锁定触发恢复后不重放，后续跌破按当前价退出',()=>{
  const prices=Array.from({length:34},(_,i)=>i<=12?1200-15*i:i<=15?1020+(i-12)*10:i<27?1000:i===27?1100:1010);
  const data=market(prices);for(const s of data.snapshots){s.view.rules.buyFeePct=0;s.view.rules.sellFeePct=0;}
  const r=replayStock({...data,strategy:{candidate:'S2',holdMinutes:240,exitMode:'risk'}}),buy=first(r,'buy'),sell=first(r,'sell');
  assert.equal(buy.at,start+75*minute);assert.equal(r.orders[0].research.signalLowCents,1020);
  assert.ok(r.strategy.checks.some(c=>c.at===start+80*minute&&c.triggers.includes('S2-invalidated')&&c.blocked==='holding-period'));
  const unlocked=r.strategy.checks.find(c=>c.at===start+135*minute&&c.stage==='exit');
  assert.deepEqual(unlocked.triggers,[]);assert.equal(unlocked.policy.signalLowCents,1020);
  assert.equal(sell.at,start+140*minute);assert.equal(sell.priceCents,1010);assert.equal(sell.reason,'S2-invalidated');
  assert.ok(sell.priceCents>1000,'cannot move the frozen invalidation threshold to a later low');
});

test('组合策略：未来和后来补入的历史不改变已有决策，冲突历史拒绝',()=>{
  const data=market(),options={...data,strategy:{candidate:'S1',holdMinutes:120}},full=replayStock(options);
  const prefix=replayStock({...options,snapshots:data.snapshots.slice(0,22)});
  assert.deepEqual(full.trades.filter(t=>t.at<=data.snapshots[21].at),prefix.trades);
  const later=structuredClone(data);later.snapshots[13].view.ticks[0].priceCents=1001;
  assert.throws(()=>replayStock({...later,strategy:{candidate:'S1'}}),/Conflicting visible/);
  const delayed=market();for(const s of delayed.snapshots.slice(0,13))s.view.ticks=s.view.ticks.filter(t=>Date.parse(t.createdAt)>=start+5*minute);
  const late=replayStock({...delayed,strategy:{candidate:'S1'}});
  assert.ok(first(late,'buy').at>start+60*minute);assert.equal(late.orders.some(o=>o.decisionAt===start+60*minute),false);
  const future=structuredClone(data);future.snapshots[0].view.ticks=data.snapshots.at(-1).view.ticks;
  assert.equal(replayStock({...future,snapshots:[future.snapshots[0]],strategy:{candidate:'S1'}}).orders.length,0);
});

test('组合策略：稳定ID研究排序、最多三仓且不混手动仓，预算按预留而非报价扣除',()=>{
  const data=market(Array.from({length:24},(_,i)=>1000+10*i),[4,2,3,1]);
  const before=JSON.stringify(data),r=replayStock({...data,initialBalance:20000,config:{tradeLimit:20000,perStockLimit:1000},strategy:{candidate:'S1'}});
  assert.deepEqual(r.trades.map(t=>t.stockId),[1,2,3]);assert.equal(r.positions.length,3);
  assert.ok(r.strategy.checks.some(c=>c.reasons?.includes('three-managed-positions')));assert.equal(JSON.stringify(data),before);
  const small=replayStock({...data,accountLimits:{capital:1100,loss:1000},strategy:{candidate:'S1'}});
  assert.ok(small.capitalExposure.peak<=1000);assert.ok(small.account.curve.every(c=>c.stressLoss<=1000));
  const manual=replayStock({...data,initialPositions:[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}],strategy:{candidate:'S1'}});
  assert.equal(manual.trades.some(t=>t.stockId===1),false);
});

test('组合策略：已知旧亏损接续，不能换策略或改起点重新取得十万风险额度',()=>{
  const data=market();
  for(const candidate of ['S0','S1','S2','S3']){
    const stopped=replayStock({...data,initialBudgetLoss:100000,strategy:{candidate}});
    assert.equal(stopped.trades.length,0);assert.equal(stopped.account.ending.halt.reason,'loss-limit');
    assert.equal(stopped.account.ending.initialBudgetLoss,100000);
  }
  const partial=replayStock({...data,initialBudgetLoss:99500,strategy:{candidate:'S1'}});
  assert.ok(partial.trades.some(t=>t.action==='buy'));assert.ok(partial.orders[0].reservedTokens<=500);
  assert.equal(partial.simulation.initialBudgetLoss,99500);
  assert.throws(()=>replayStock({...data,initialBudgetLoss:-1}),/Stock account: invalid record/);
});

test('组合策略：部分卖出保留原入场期限，储备不足后恢复继续退出',()=>{
  const data=market(Array.from({length:28},(_,i)=>1000+10*i));
  data.snapshots[24].view.rules.reserveTokens=50;data.snapshots[25].view.rules.reserveTokens=0;
  const r=replayStock({...data,strategy:{candidate:'S1'}}),buy=first(r,'buy'),sales=r.trades.filter(t=>t.action==='sell');
  assert.equal(sales[0].at,start+120*minute);assert.ok(sales[0].shares<buy.shares);
  assert.equal(sales[1].at,start+130*minute);assert.equal(sales.reduce((n,t)=>n+t.shares,0),buy.shares);
  const blocked=r.strategy.checks.find(c=>c.stage==='exit'&&c.at===start+125*minute);
  assert.equal(blocked.policy.enteredAt,buy.at);assert.equal(blocked.policy.exitAt,buy.at+60*minute);
  assert.equal(blocked.blocked,'liquidity-or-rounding');assert.equal(r.account.ending.heldCost,0);
});

test('组合策略：超预留成交被保留，研究候选只停新增买入并解锁后风险退出',()=>{
  const data=market(Array.from({length:42},(_,i)=>1000+10*i));
  for(const s of data.snapshots.slice(13)){
    s.view.stocks[0].priceCents=1400;
    s.view.ticks=s.view.ticks.map(t=>({...t,priceCents:Date.parse(t.createdAt)>=start+65*minute?1400:t.priceCents}));
  }
  const r=replayStock({...data,executionDelayMs:5*minute,strategy:{candidate:'S1',holdMinutes:240}});
  assert.equal(r.execution.halt.reason,'buy-reservation-exceeded');
  assert.deepEqual(r.trades.map(t=>t.action),['buy','sell']);assert.equal(first(r,'sell').reason,'account-risk-stop');
  assert.ok(first(r,'sell').decisionAt-first(r,'buy').at>=60*minute);assert.equal(r.account.ending.heldCost,0);
});

test('组合策略：卖出报价压力作用于到账与持仓清算估值，费用和实际成交可复算',()=>{
  const data=market(Array.from({length:27},(_,i)=>1000+10*i)),strategy={candidate:'S1'};
  const normal=replayStock({...data,strategy}),stress=replayStock({...data,strategy,exitPriceHaircutBps:300});
  assert.equal(first(normal,'buy').debit,first(stress,'buy').debit);
  assert.equal(first(stress,'sell').priceCents,Math.floor(first(normal,'sell').priceCents*.97));
  assert.ok(first(stress,'sell').proceeds<first(normal,'sell').proceeds);assert.ok(stress.net<normal.net);
  assert.equal(stress.turnover.realized,stress.net);assert.equal(stress.turnover.releasedCost,first(stress,'buy').debit);
  assert.equal(stress.holdingExposure.lockedPositionMs,60*minute);
  assert.equal(stress.holdingExposure.lockedCostTokenMs,first(stress,'buy').debit*60*minute);
  const held=replayStock({...data,snapshots:data.snapshots.slice(0,20),strategy,exitPriceHaircutBps:300});
  assert.equal(held.account.ending.equity.upper,null);assert.equal(held.net,null);
  assert.equal(held.strategy.qualifiedForLive,false);
});

test('组合策略：未决成交占用本次周期，停牌和缺失观察不插值成交，输入必须明确',()=>{
  const data=market(Array.from({length:28},(_,i)=>1000+10*i)),strategy={candidate:'S1'};
  const sparse=replayStock({...data,snapshots:data.snapshots.filter((_,i)=>![13,14].includes(i)),executionDelayMs:5*minute,strategy});
  assert.equal(first(sparse,'buy').decisionAt,start+60*minute);assert.equal(first(sparse,'buy').at,start+75*minute);
  assert.equal(sparse.orders[0].observationLagMs,10*minute);
  assert.equal(sparse.orders.filter(o=>o.decisionAt===first(sparse,'buy').at).length,0);
  const paused=structuredClone(data);paused.snapshots[24].view.stocks[0].suspended=true;
  const stopped=replayStock({...paused,strategy});assert.equal(first(stopped,'sell').at,start+125*minute);
  assert.equal(stopped.holdingExposure.unavailablePositionMs,5*minute);
  for(const strategy of [{candidate:'S4'},{candidate:'S1',holdMinutes:30},{exitMode:'guess'},{unknown:1}])
    assert.throws(()=>replayStock({...data,strategy}),/Invalid replay strategy/);
  for(const exitPriceHaircutBps of [-1,1.2,10000,Infinity])assert.throws(()=>replayStock({...data,exitPriceHaircutBps}),/Invalid replay input/);
});

test('组合矩阵：14个固定候选各用独立账户，六种情景共84组，缺失位置不按收益挑选',()=>{
  const data=market(Array.from({length:29},(_,i)=>1000+10*i)),before=JSON.stringify(data),ids=[];
  const normal=compareStockStrategies(data,{onReport:(id,r)=>{ids.push(id);assert.equal(r.account.initial.cash,10000);}});
  assert.equal(normal.runs.length,14);assert.equal(new Set(ids).size,14);
  const single=replayStock({...data,strategy:{candidate:'S1',holdMinutes:60}});
  assert.equal(normal.runs.find(r=>r.id==='normal-S1-60-fixed').net,single.net);
  assert.equal(normal.runs.find(r=>r.id==='normal-S3').net,0);
  const stress=compareStockStrategies(data,{stress:true,missingStartIndex:13});assert.equal(stress.runs.length,84);
  assert.deepEqual(stress.runs.find(r=>r.id==='missing-two-S1-60-fixed').omittedAt,[start+65*minute,start+70*minute]);
  assert.equal(stress.runs.find(r=>r.id==='missing-two-S1-60-fixed').longestObservationGapMs,15*minute);
  assert.equal(stress.validation.qualifiedForLive,false);assert.equal(stress.validation.holdoutPerformed,false);
  assert.equal(JSON.stringify(data),before);
  assert.throws(()=>compareStockStrategies(data,{stress:true}),/predeclared/);
  assert.throws(()=>compareStockStrategies({...data,strategy:{candidate:'S1'}}),/fixed by the matrix/);
});
