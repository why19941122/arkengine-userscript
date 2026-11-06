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
  data.snapshots.at(-1).view.stocks[0].stale=true;
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
  assert.deepEqual(result.trades.map(t=>[t.action,t.shares]),[['buy',74],['sell',2]]);
  assert.equal(result.positions[0].costBasisTokens,882);
  assert.deepEqual(result.curve.map(p=>p.investedCost),[906,882,882]);
  assert.deepEqual(result.capitalUsage,{basis:'cost-basis',peakCost:906,endingCost:882,
    timeWeightedAverageCost:(906*60+882*5)/65,observedDurationMs:65*60000});
});

test('股市回放资金占用：无交易为零、单时点均值未知，报价缺失不抹掉已经投入的本金',()=>{
  const data=input(),idle=replayStock({...data,config:{trade:false}});
  assert.deepEqual(idle.capitalUsage,{basis:'cost-basis',peakCost:0,endingCost:0,timeWeightedAverageCost:0,observedDurationMs:145*60000});
  const single=replayStock({...data,snapshots:[data.snapshots[5]]});
  assert.deepEqual(single.capitalUsage,{basis:'cost-basis',peakCost:906,endingCost:906,timeWeightedAverageCost:null,observedDurationMs:0});
  data.snapshots=data.snapshots.slice(0,13);data.snapshots.at(-1).view.stocks[0].stale=true;
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
  data.snapshots[6].view.stocks[0].priceCents=1400;data.snapshots.at(-1).view.stocks[0].stale=true;
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
