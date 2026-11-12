import assert from 'node:assert/strict';
import {test} from 'node:test';
import {replayStock,stockSnapshotsFromLog} from './arkengine-stock-replay.mjs';

const start=Date.parse('2026-11-03T00:00:00Z');
function input(){
  const prices=Array.from({length:30},(_,i)=>i<18?1000+i*40:1700-(i-18)*70);
  return {initialBalance:10000,snapshots:prices.map((priceCents,i)=>({at:start+i*300000,view:{userId:7,enabled:true,
    stocks:[{id:1,modelName:'测试模型',priceCents,volume24h:1000}],positions:[],rounds:[],myBets:[],
    ticks:prices.slice(0,i+1).map((p,j)=>({stockId:1,priceCents:p,createdAt:new Date(start+j*300000).toISOString()})),
    rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:10000,maxDailyBuyTokens:10000,maxPositionTokens:10000,reserveTokens:10000}}}))};
}
test('股市时间回放：手续费与持有期实际影响成交，未来样本不能改变过去决策',()=>{
  const data=input(),full=replayStock(data),prefix=replayStock({...data,snapshots:data.snapshots.slice(0,12)});
  assert.ok(full.trades.some(t=>t.action==='buy'));assert.ok(full.trades.some(t=>t.action==='sell'));
  assert.ok(full.feesAndRounding>0);assert.equal(full.baselineNoTrade,10000);
  const buy=full.trades.find(t=>t.action==='buy'),sell=full.trades.find(t=>t.action==='sell');
  assert.ok(sell.at-buy.at>=3600000);
  assert.deepEqual(full.trades.filter(t=>t.at<=data.snapshots[11].at),prefix.trades);
  const changed=structuredClone(data);for(const snapshot of changed.snapshots.slice(12))snapshot.view.stocks[0].priceCents=1;
  assert.deepEqual(replayStock(changed).trades.filter(t=>t.at<=data.snapshots[11].at),prefix.trades);
});
test('股市时间回放：停滞仍可按当前报价估值和完成旧卖单，停牌保留未成交',()=>{
  for(const suspended of [false,true]){
    const data=input();data.snapshots=data.snapshots.slice(5,7);
    for(const sample of data.snapshots){sample.view.stocks[0].priceCents=1200;sample.view.stocks[0].stale=true;}
    data.snapshots[1].view.stocks[0].suspended=suspended;
    const result=replayStock({...data,executionDelayMs:300000,
      initialPositions:[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null,managed:true}]});
    assert.equal(result.orders.length,1);assert.equal(result.orders[0].action,'sell');
    if(suspended){assert.equal(result.orders[0].reason,'suspended');assert.equal(result.trades.length,0);assert.equal(result.net,null);}
    else{assert.equal(result.orders[0].status,'filled');assert.equal(result.trades[0].proceeds,117);assert.equal(result.positions.length,0);assert.equal(result.valuationComplete,true);}
  }
});

test('股市时间回放：重复和倒序快照拒绝，快照内夹带未来行情不提前交易',()=>{
  const data=input();assert.throws(()=>replayStock({...data,snapshots:[data.snapshots[1],data.snapshots[0]]}),/increasing/);
  assert.throws(()=>replayStock({...data,snapshots:[data.snapshots[0],data.snapshots[0]]}),/increasing/);
  const early=structuredClone(data.snapshots[0]);early.view.ticks=data.snapshots.at(-1).view.ticks;
  assert.deepEqual(replayStock({...data,snapshots:[early]}).trades,[]);
});

test('股市日志回放：完整观察分片按批次还原，重复副本不多计，缺片或冲突拒绝评估',()=>{
  const data=input(),events=data.snapshots.flatMap((sample,i)=>[0,1].map(part=>({type:'stock-observation',version:'test',data:{
    observationId:'sample-'+i,at:sample.at,part,totalParts:2,snapshot:{...sample.view,
      stocks:part?[]:sample.view.stocks,ticks:part?sample.view.ticks:[]}}})));
  const restored=stockSnapshotsFromLog({days:[{events:events.slice().reverse().concat(events[0])}]});
  assert.deepEqual(replayStock({...data,snapshots:restored}).trades,replayStock(data).trades);
  assert.equal(replayStock({...data,snapshots:restored}).net,replayStock(data).net);
  assert.deepEqual(replayStock({...data,snapshots:restored}).observation.versions,['test']);
  assert.throws(()=>stockSnapshotsFromLog({events:events.slice(1)}),/Incomplete/);
  const conflict=structuredClone(events[0]);conflict.data.snapshot.enabled=false;
  assert.throws(()=>stockSnapshotsFromLog({events:[...events,conflict]}),/Conflicting/);
  assert.throws(()=>stockSnapshotsFromLog({events:[{type:'stock-observation',data:{truncated:true}}]}),/truncated/);
  assert.throws(()=>stockSnapshotsFromLog({events:[{type:'stock-check',data:{market:{total:67}}}]}),/No observation/);
});

test('股市时间回放：不同账号或同一股票改名的样本不拼成同一资金曲线',()=>{
  let data=input();data.snapshots.at(-1).view.userId=88;
  assert.throws(()=>replayStock(data),/account/);
  data=input();data.snapshots.at(-1).view.stocks[0].modelName='另一只股票';
  assert.throws(()=>replayStock(data),/identity/);
});

test('股市观察时序：合并快照只从双方资料可见后使用，新鲜度仍保留较早时刻',()=>{
  const sample=input().snapshots[0],reading={generation:3,phase:'scan',marketAt:start,balanceAt:start+1000,freshnessAt:start};
  sample.view.accountSnapshot={userId:sample.view.userId,balanceTokens:10000,positions:[],pendingKnown:true,pending:null};
  const event={type:'stock-observation',version:'candidate',data:{observationVersion:2,observationId:'read-3',
    at:start+1200,reading,part:0,totalParts:1,settings:{observeOnly:false},snapshot:sample.view}};
  const [restored]=stockSnapshotsFromLog({events:[event]});assert.equal(restored.at,start+1200);
  assert.deepEqual(restored.sourceObservation,{id:'read-3',version:2,reading});assert.equal(restored.sourceVersion,'candidate');
  for(const change of [{at:start},{reading:{...reading,freshnessAt:start+1000}},
    {reading:{...reading,generation:0}},{reading:{...reading,phase:'invented'}},{observationVersion:3},{observationVersion:null},
    {reading:null},{observationId:null}])
    assert.throws(()=>stockSnapshotsFromLog({events:[{...event,data:{...event.data,...change}}]}),/availability|metadata/);
  const downgraded=structuredClone(event);delete downgraded.data.observationVersion;
  assert.throws(()=>stockSnapshotsFromLog({events:[downgraded]}),/availability|metadata/);
  for(const accountSnapshot of [null,{...sample.view.accountSnapshot,balanceTokens:null},
    {...sample.view.accountSnapshot,pendingKnown:false}])
    assert.throws(()=>stockSnapshotsFromLog({events:[{...event,data:{...event.data,snapshot:{...sample.view,accountSnapshot}}}]}),/account evidence/);
});

test('股市观察时序：多分片必须来自同一读取代次和同一可见时间',()=>{
  const sample=input().snapshots[0],base={observationVersion:2,observationId:'same-read',at:start+1000,totalParts:2,
    reading:{generation:2,phase:'reconcile',marketAt:start,balanceAt:start+1000,freshnessAt:start}};
  sample.view.accountSnapshot={userId:sample.view.userId,balanceTokens:10000,positions:[],pendingKnown:true,pending:null};
  const events=[0,1].map(part=>({type:'stock-observation',data:{...structuredClone(base),part,
    snapshot:{...sample.view,stocks:part?[]:sample.view.stocks,ticks:part?sample.view.ticks:[]}}}));
  assert.equal(stockSnapshotsFromLog({events:[events[1],events[0],events[1]]}).length,1);
  const changed=structuredClone(events);changed[1].data.reading.generation=4;
  assert.throws(()=>stockSnapshotsFromLog({events:changed}),/Conflicting/);
  assert.throws(()=>stockSnapshotsFromLog({events:events.slice(0,1)}),/Incomplete/);
  const mixed=structuredClone(events);delete mixed[1].data.observationVersion;delete mixed[1].data.reading;
  assert.throws(()=>stockSnapshotsFromLog({events:mixed}),/Conflicting/);
});

test('股市观察时序：相同价格的后续账户和规则变化不能在重组时去掉',()=>{
  const sample=input().snapshots[0];const events=[0,1].map(i=>({type:'stock-observation',data:{
    observationVersion:2,observationId:'read-'+i,at:start+i*1000,part:0,totalParts:1,
    reading:{generation:i+1,phase:i?'reconcile':'scan',marketAt:start+i*1000,balanceAt:start+i*1000,freshnessAt:start+i*1000},
    snapshot:{...sample.view,rules:{...sample.view.rules,sellFeePct:i?3:2.5},accountSnapshot:{userId:sample.view.userId,
      balanceTokens:10000-i*100,positions:i?[{stockId:1,shares:10,costBasisTokens:100,holdUntil:start+3600000}]:[],
      pendingKnown:i===0,...(i?{}:{pending:null})}}}}));
  const frames=stockSnapshotsFromLog({events});assert.equal(frames.length,2);assert.deepEqual(frames[0].view.stocks,frames[1].view.stocks);
  assert.equal(frames[1].sourceAccount.balanceTokens,9900);assert.equal(frames[1].view.positions[0].shares,10);
  assert.equal(frames[1].view.rules.sellFeePct,3);assert.equal(frames[1].sourceAccount.pendingKnown,false);
  assert.equal(Object.hasOwn(frames[1].sourceAccount,'pending'),false);
});

test('股票编号类型回放：跨快照别名不丢失持仓估值或延迟成交，现金与成本轨迹一致',()=>{
  for(const executionDelayMs of [0,300000]){
    const data={...input(),executionDelayMs},baseline=replayStock(data),aliases=structuredClone(data);
    aliases.snapshots.forEach((sample,i)=>{
      sample.view.stocks[0].id=i%2?'1':1;
      sample.view.ticks.forEach((tick,j)=>tick.stockId=j%2?'1':1);
    });
    const result=replayStock(aliases),canonical=rows=>rows.map(row=>({...row,stockId:String(row.stockId)}));
    assert.deepEqual(canonical(result.trades),canonical(baseline.trades));
    assert.deepEqual(canonical(result.orders),canonical(baseline.orders));
    assert.deepEqual(result.curve,baseline.curve);assert.deepEqual(result.execution,baseline.execution);
    assert.equal(result.valuationComplete,true);assert.equal(result.net,baseline.net);
  }
});

test('股票编号类型回放：不同拼写不冒充旧股票，重复别名快照拒绝',()=>{
  const data=input();data.snapshots=data.snapshots.slice(5,7);
  data.snapshots[1].view.stocks[0].id='01';
  data.snapshots[1].view.ticks.forEach(t=>t.stockId='01');
  const result=replayStock({...data,executionDelayMs:300000});
  assert.equal(result.trades.length,0);assert.equal(result.orders[0].reason,'missing-quote');
  const duplicate=input();duplicate.snapshots[0].view.stocks.push({...duplicate.snapshots[0].view.stocks[0],id:'1'});
  assert.throws(()=>replayStock(duplicate),/verified stock contract/);
});

test('股市时间回放：末次报价失效时净收益未知，历史估值缺口不能伪称完整回撤',()=>{
  const data=input();data.snapshots=data.snapshots.slice(0,13);
  data.snapshots.at(-1).view.stocks[0].suspended=true;
  const result=replayStock(data);assert.ok(result.positions.length);
  assert.equal(result.net,null);assert.equal(result.maxDrawdown,null);
  assert.equal(result.valuationComplete,false);assert.ok(result.missingValuationSamples>0);
});
test('股市回放可复核：记录有效配置、版本和区间，原观察设置不默默覆盖模拟参数',()=>{
  const data=input();for(const s of data.snapshots){s.sourceVersion='1.17.0';s.recordedSettings={trade:false,tradeLimit:0};}
  const report=replayStock({...data,holdMs:1800000,config:{tradeLimit:1500}});
  assert.equal(report.simulation.config.tradeLimit,1500);assert.equal(report.simulation.holdMs,1800000);
  assert.equal(report.simulation.from,data.snapshots[0].at);assert.equal(report.simulation.to,data.snapshots.at(-1).at);
  assert.equal(report.simulation.usesRecordedSettings,false);assert.deepEqual(report.observation.versions,['1.17.0']);
  assert.deepEqual(report.observation.settings,[{trade:false,tradeLimit:0}]);
  for(const config of [{reserve:-1},{tradeLimit:Infinity},{riskLimit:-10},{trade:'yes'},[]])
    assert.throws(()=>replayStock({...data,config}),/configuration/);
});

test('股市回放资金占用：按持仓成本与真实间隔计算，稀疏采样不改变同一交易轨迹的均值',()=>{
  const data=input(),full=replayStock(data);
  assert.deepEqual(full.trades.map(t=>[t.action,t.at-start,t.debit]),[['buy',25*60000,906],['sell',85*60000,0]]);
  assert.deepEqual(full.capitalUsage,{basis:'cost-basis',peakCost:906,endingCost:0,
    timeWeightedAverageCost:906*60/145,observedDurationMs:145*60000});
  const sparse=replayStock({...data,snapshots:[data.snapshots[0],data.snapshots[5],data.snapshots[17],data.snapshots[29]]});
  assert.deepEqual(sparse.trades,full.trades);
  assert.deepEqual(sparse.capitalUsage,full.capitalUsage,'sampling frequency is not time weight');
  assert.equal(full.curve[5].investedCost,906);assert.equal(full.curve[16].investedCost,906);
  assert.equal(full.curve[17].investedCost,0,'sale releases cost, not the larger proceeds');
});

test('股市回放资金占用：流动性导致部分卖出时只释放对应成本，不把盈利或剩余持仓算作现金',()=>{
  const data=input();data.snapshots=[data.snapshots[5],data.snapshots[17],data.snapshots[18]];
  data.snapshots[1].view.rules.reserveTokens=50;data.snapshots[2].view.rules.reserveTokens=0;
  const result=replayStock(data);
  assert.deepEqual(result.trades.map(t=>[t.action,t.shares]),[['buy',74],['sell',3]]);
  assert.equal(result.trades[1].proceeds,49,'网站限额比较扣费取整后的到账，毛额50.4仍可成交');
  assert.equal(result.positions[0].costBasisTokens,870);
  assert.deepEqual(result.curve.map(p=>p.investedCost),[906,870,870]);
  assert.deepEqual(result.capitalUsage,{basis:'cost-basis',peakCost:906,endingCost:870,
    timeWeightedAverageCost:(906*60+870*5)/65,observedDurationMs:65*60000});
});

test('股市回放资金占用：无交易为零、单时点均值未知，报价缺失不抹掉已经投入的本金',()=>{
  const data=input(),idle=replayStock({...data,config:{trade:false}});
  assert.deepEqual(idle.capitalUsage,{basis:'cost-basis',peakCost:0,endingCost:0,timeWeightedAverageCost:0,observedDurationMs:145*60000});
  const single=replayStock({...data,snapshots:[data.snapshots[5]]});
  assert.deepEqual(single.capitalUsage,{basis:'cost-basis',peakCost:906,endingCost:906,timeWeightedAverageCost:null,observedDurationMs:0});
  data.snapshots=data.snapshots.slice(0,13);data.snapshots.at(-1).view.stocks[0].suspended=true;
  const missing=replayStock(data);assert.equal(missing.net,null);assert.equal(missing.maxDrawdown,null);
  assert.equal(missing.capitalUsage.endingCost,906);assert.equal(missing.capitalUsage.timeWeightedAverageCost,906*35/60);
});

test('股市回放延迟：固定原股数使用延迟后的报价，持有期从成交起算且未来不能改变先前成交',()=>{
  const data=input(),delay=10*60000,result=replayStock({...data,executionDelayMs:delay});
  const buy=result.trades.find(t=>t.action==='buy'),sell=result.trades.find(t=>t.action==='sell');
  assert.equal(buy.decisionAt,start+25*60000);assert.equal(buy.at,start+35*60000);
  assert.equal(buy.shares,74);assert.equal(buy.priceCents,1280);assert.equal(buy.debit,967);
  assert.ok(sell.decisionAt-buy.at>=3600000,'holding period starts at fill, not decision');
  assert.ok(sell.at-sell.decisionAt>=delay);assert.equal(result.execution.pending,0);
  assert.equal(result.simulation.executionDelayMs,delay);assert.equal(result.execution.complete,true);
  const prefix=replayStock({...data,executionDelayMs:delay,snapshots:data.snapshots.slice(0,13)});
  assert.deepEqual(result.trades.filter(t=>t.at<=data.snapshots[12].at),prefix.trades);
  assert.deepEqual(replayStock({...data,executionDelayMs:0}).trades,replayStock(data).trades);
});

test('股市回放延迟：市价超过原报价预留仍可成交，明确记录超额，不伪造限价保护',()=>{
  const data=input();data.snapshots=data.snapshots.slice(0,7);data.snapshots[6].view.stocks[0].priceCents=1400;
  const result=replayStock({...data,executionDelayMs:300000});
  assert.equal(result.trades.length,1);assert.equal(result.trades[0].shares,74);assert.equal(result.trades[0].debit,1057);
  assert.equal(result.orders[0].reservedTokens,997);assert.equal(result.orders[0].reservationExceeded,true);
  assert.equal(result.endingCash,8943);assert.equal(result.positions[0].costBasisTokens,1057);
  assert.equal(result.execution.overReservation,1);
});

test('股市回放暂停：实际买入超过预留后与脚本一致停止后续交易，仍保留成本及后续估值',()=>{
  for(const autoBudget of [false,true]){
    const data=input();data.snapshots[6].view.stocks[0].priceCents=1400;
    const result=replayStock({...data,executionDelayMs:300000,config:{autoBudget}});
    assert.equal(result.trades.length,1,'an over-reservation fill must not be followed by simulated automatic sales or buys');
    const buy=result.trades[0],order=result.orders[0];
    assert.equal(buy.action,'buy');assert.ok(buy.debit>order.reservedTokens);
    assert.equal(result.orders.length,1);assert.equal(result.positions[0].costBasisTokens,buy.debit);
    assert.deepEqual(result.execution.halt,{at:buy.at,orderId:order.id,reason:'buy-reservation-exceeded',
      reservedTokens:order.reservedTokens,actualTokens:buy.debit});
    assert.equal(result.execution.pending,0);assert.equal(result.execution.complete,true);
    assert.equal(result.capitalUsage.endingCost,buy.debit);assert.equal(result.endingCash,10000-buy.debit);
    assert.equal(result.curve.length,data.snapshots.length);
    assert.notEqual(result.curve[6].estimatedEquity,result.curve.at(-1).estimatedEquity,'the held lot is still valued after the stop');
    const prefix=replayStock({...data,executionDelayMs:300000,config:{autoBudget},snapshots:data.snapshots.slice(0,7)});
    assert.deepEqual(result.trades,prefix.trades);assert.deepEqual(result.execution.halt,prefix.execution.halt);
    const later=structuredClone(data.snapshots.at(-1));later.at+=2*86400000;later.view.stocks[0].priceCents=2000;
    const extended=replayStock({...data,executionDelayMs:300000,config:{autoBudget},snapshots:[...data.snapshots,later]});
    assert.equal(extended.orders.length,1,'elapsed budget windows do not resume a held script');
    assert.deepEqual(extended.execution.halt,result.execution.halt);
  }
});

test('股市回放暂停：恰好等于原预留仍管理持仓，暂停后的缺报价也不能伪称收益完整',()=>{
  const data=input();data.snapshots[6].view.stocks[0].priceCents=1320;
  const result=replayStock({...data,executionDelayMs:300000});
  assert.equal(result.orders[0].reservedTokens,997);assert.equal(result.trades[0].debit,997);
  assert.equal(result.execution.halt,null);assert.ok(result.trades.some(t=>t.action==='sell'));
  data.snapshots[6].view.stocks[0].priceCents=1400;data.snapshots.at(-1).view.stocks[0].suspended=true;
  const unknown=replayStock({...data,executionDelayMs:300000});
  assert.equal(unknown.execution.halt.reason,'buy-reservation-exceeded');assert.equal(unknown.orders.length,1);
  assert.equal(unknown.net,null);assert.equal(unknown.maxDrawdown,null);assert.equal(unknown.valuationComplete,false);
  assert.equal(unknown.capitalUsage.endingCost,1057);
});

test('股市回放延迟：成交时停牌、陈旧报价、市场关闭及资金或规则不足分别不成交',()=>{
  for(const [change,reason] of [
    [v=>v.stocks[0].suspended=true,'suspended'],[v=>v.stocks[0].stale=true,'stale-quote'],
    [v=>v.enabled=false,'market-disabled'],[v=>v.stocks=[],'missing-quote'],
    [v=>{v.stocks[0].priceCents=14000;v.rules.maxTradeTokens=20000;v.rules.maxPositionTokens=20000;v.rules.maxDailyBuyTokens=20000;},'cash'],
    [v=>v.rules.maxTradeTokens=0,'trade-limit'],[v=>v.rules.maxDailyBuyTokens=0,'daily-limit'],[v=>v.rules.maxPositionTokens=0,'position-limit']]){
    const data=input();data.snapshots=data.snapshots.slice(0,7);change(data.snapshots[6].view);
    const result=replayStock({...data,executionDelayMs:300000});
    assert.equal(result.trades.length,0,reason);assert.equal(result.endingCash,10000,reason);assert.deepEqual(result.positions,[],reason);
    assert.equal(result.orders[0].status,'unfilled',reason);assert.equal(result.orders[0].reason,reason);
    assert.deepEqual(result.execution,{submitted:1,filled:0,unfilled:1,pending:0,overReservation:0,complete:true,halt:null});
  }
});

test('股市回放延迟：卖出储备降低时整单不成交，保留完整持仓且不擅自缩小原股数',()=>{
  const data=input();data.snapshots=data.snapshots.slice(0,20);data.snapshots[19].view.rules.reserveTokens=50;
  const result=replayStock({...data,executionDelayMs:300000});
  assert.deepEqual(result.trades.map(t=>t.action),['buy']);assert.equal(result.positions[0].shares,74);
  assert.equal(result.positions[0].costBasisTokens,936);assert.equal(result.orders[1].action,'sell');
  assert.equal(result.orders[1].shares,74);assert.equal(result.orders[1].status,'unfilled');
  assert.equal(result.orders[1].reason,'liquidity');assert.equal(result.execution.pending,0);
});

test('股市回放延迟：缺少延迟后快照保留待定，不扣款或假定成交，间隔稀疏时说明实际等待',()=>{
  const data=input(),pending=replayStock({...data,executionDelayMs:300000,snapshots:data.snapshots.slice(0,6)});
  assert.deepEqual(pending.trades,[]);assert.equal(pending.endingCash,10000);assert.equal(pending.execution.complete,false);
  assert.equal(pending.execution.pending,1);assert.equal(pending.orders[0].status,'pending');
  assert.equal(pending.net,null);assert.equal(pending.maxDrawdown,null);
  const waiting=replayStock({...data,executionDelayMs:3600000,snapshots:data.snapshots.slice(0,13)});
  assert.equal(waiting.orders.length,1,'later signals cannot stack orders while the first is pending');
  assert.equal(waiting.execution.pending,1);assert.equal(waiting.capitalUsage.peakCost,0);
  const sparse=replayStock({...data,executionDelayMs:60000,snapshots:[data.snapshots[5],data.snapshots[7]]});
  assert.equal(sparse.orders[0].dueAt,start+26*60000);assert.equal(sparse.orders[0].resolvedAt,start+35*60000);
  assert.equal(sparse.orders[0].observationLagMs,9*60000);assert.equal(sparse.trades[0].priceCents,1280);
  for(const executionDelayMs of [-1,1.5,Infinity,'5'])assert.throws(()=>replayStock({...data,executionDelayMs}),/replay input/);
});

test('独立账本回放：原有仓位保留成本与身份，只有明确管理的仓位参与退出',()=>{
  const data=input(),opening={stockId:1,modelName:'测试模型',shares:100,costBasisTokens:1000,holdUntil:null};
  const before=JSON.stringify(data),passive=replayStock({...data,initialPositions:[opening]});
  assert.equal(passive.trades.length,0);assert.equal(passive.account.initial.heldCost,1000);
  assert.equal(passive.capitalExposure.ending,1000);assert.equal(passive.baselineNoTrade,null);
  const managed=replayStock({...data,initialPositions:[{...opening,managed:true}]});
  assert.ok(managed.trades.some(t=>t.action==='sell'));assert.equal(managed.account.initial.equity.lower,10975);
  assert.equal(managed.net,managed.account.ending.equity.lower-10975);
  assert.equal(JSON.stringify(data),before);
  assert.throws(()=>replayStock({...data,initialPositions:[{...opening,costBasisTokens:null}]}),/opening position/);
});
test('独立账本回放：初始未决买单只占一次网站日额度，成交才扣款及起算锁定',()=>{
  const data=input();data.snapshots=data.snapshots.slice(0,2);
  for(const s of data.snapshots){s.view.stocks[0].priceCents=1000;s.view.rules.maxDailyBuyTokens=105;}
  const initialPending={id:'old-order',decisionAt:start-1000,dueAt:start+300000,action:'buy',stockId:1,modelName:'测试模型',shares:10,reservedTokens:105};
  const result=replayStock({...data,initialPending,config:{trade:false}});
  assert.equal(result.account.curve[0].pendingBuy,105);assert.equal(result.curve[0].cash,10000);
  assert.equal(result.trades.length,1);assert.equal(result.trades[0].debit,102);
  assert.equal(result.account.ending.capital,102);assert.equal(result.account.ending.pendingBuy,0);
  assert.equal(Date.parse(result.positions[0].holdUntil),start+300000+3600000);
});
test('独立账本回放：挂起买单计入本金时长，未成交不是零风险占用',()=>{
  const data=input(),result=replayStock({...data,executionDelayMs:3600000,snapshots:data.snapshots.slice(0,13)});
  assert.equal(result.capitalUsage.peakCost,0);assert.equal(result.capitalExposure.peak,997);
  assert.equal(result.capitalExposure.endingPendingBuy,997);
  assert.equal(result.capitalExposure.timeWeightedAverage,997*35/60);
  assert.equal(result.account.ending.pending,1);assert.equal(result.net,null);
  const immediate=replayStock(data);
  assert.equal(immediate.capitalUsage.peakCost,906);assert.equal(immediate.capitalExposure.peak,997,'同一快照内先预留再成交，瞬时峰值仍须计算');
});
test('独立账本回放：七天外部转入不计利润，低于完整窗口不认证',()=>{
  const data=input(),first=data.snapshots[0],last=structuredClone(first);last.at=start+7*86400000;
  const externalFlows=[{id:'in',at:start+1000,amount:50000,reason:'修仙收入转入'},{id:'out',at:start+2000,amount:-20000,reason:'其他用途转出'}];
  const result=replayStock({...data,snapshots:[first,last],externalFlows,config:{trade:false}});
  assert.equal(result.endingCash,40000);assert.equal(result.net,0);assert.equal(result.netInterval.externalNet,30000);
  assert.equal(result.netInterval.complete,true);assert.equal(result.netInterval.targetExceeded,false);
  assert.equal(result.account.rollingWindows.length,1);assert.equal(result.account.rollingWindows[0].lower,0);
  assert.throws(()=>replayStock({...data,externalFlows:[{...externalFlows[0],at:start-1}]}),/observed window/);
});
test('独立账本回放：新增风险服从本金及全损压力余额，缺价不按成本保值',()=>{
  for(const accountLimits of [{capital:100,loss:100000},{capital:400000,loss:100}]){
    const result=replayStock({...input(),accountLimits});assert.equal(result.orders[0].action,'buy');
    assert.ok(result.orders[0].reservedTokens<=100,'先按可用预算缩单，不整笔丢弃可负担的买入');
    assert.ok(result.decisions.every(d=>d.allowed&&d.reservedTokens<=d.newRiskCapacity));
    assert.ok(result.account.ending.capital<=accountLimits.capital);
    assert.ok(result.account.ending.stressLoss<=accountLimits.loss);
  }
  const unaffordable=replayStock({...input(),accountLimits:{capital:1,loss:1}});
  assert.equal(unaffordable.orders.length,0,'不足一股及报价余量时仍不下单');
  const data=input();data.snapshots=data.snapshots.slice(0,13);data.snapshots.at(-1).view.stocks[0].suspended=true;
  const result=replayStock(data);assert.equal(result.estimatedEquity,null);
  assert.equal(result.account.ending.equity.lower,result.endingCash);assert.equal(result.account.ending.equity.upper,null);
  assert.equal(result.account.ending.loss,906);assert.equal(result.net,null);
});

test('独立账本观察还原：保留原有仓，旧资料缺起点不能偷偷改为空仓',()=>{
  const data=input(),sample=data.snapshots[0],position={stockId:1,shares:100,costBasisTokens:1000,holdUntil:null};
  const snapshot={...sample.view,accountSnapshot:{userId:7,balanceTokens:999999,positions:[position],pendingKnown:true,pending:null}};
  const events=[{type:'stock-observation',data:{at:sample.at,snapshot}}];
  const restored=stockSnapshotsFromLog({events}),result=replayStock({snapshots:restored,initialBalance:10000,config:{trade:false}});
  assert.equal(result.account.initial.heldCost,1000);assert.equal(result.account.initial.cash,10000,'全账户余额不是股市分配现金');
  assert.equal(restored[0].sourceAccount.balanceTokens,999999);
  delete snapshot.accountSnapshot;delete snapshot.positions;
  const missing=stockSnapshotsFromLog({events});assert.throws(()=>replayStock({snapshots:missing}),/Opening positions/);
  assert.equal(replayStock({snapshots:missing,initialPositions:[],config:{trade:false}}).account.initial.heldCost,0);
});
test('独立账本观察还原：未决状态缺失或已存在时要求核对，账户冲突拒绝',()=>{
  const sample=input().snapshots[0],snapshot={...sample.view,accountSnapshot:{userId:7,balanceTokens:10000,positions:[],pendingKnown:false}};
  const events=[{type:'stock-observation',data:{at:sample.at,snapshot}}];
  assert.throws(()=>replayStock({snapshots:stockSnapshotsFromLog({events})}),/explicit reconciliation/);
  snapshot.accountSnapshot.pendingKnown=true;
  assert.throws(()=>stockSnapshotsFromLog({events}),/account evidence/);
  snapshot.accountSnapshot.pending={id:'unresolved'};
  assert.throws(()=>replayStock({snapshots:stockSnapshotsFromLog({events})}),/explicit reconciliation/);
  snapshot.accountSnapshot.userId=8;assert.throws(()=>stockSnapshotsFromLog({events}),/account evidence/);
});

test('独立账本回放：首个七天窗口从第一笔交易之前计收益，不能遗漏首笔手续费',()=>{
  const data=input(),first=data.snapshots[5],last=structuredClone(first);
  last.at=first.at+7*86400000;last.view.stocks[0].priceCents=1400;
  const result=replayStock({...data,snapshots:[first,last]});
  assert.equal(result.trades.length,2);assert.equal(result.account.rollingWindows.length,1);
  assert.equal(result.account.rollingWindows[0].lower,result.net);
  assert.equal(result.net,result.trades[1].proceeds-result.trades[0].debit);
});
