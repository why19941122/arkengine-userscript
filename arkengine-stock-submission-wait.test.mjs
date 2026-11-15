import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const core=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const c=vm.runInNewContext(core.slice(core.indexOf('\n'))+'\nstockCore;');
// Exercise the expression actually used by stockStep, including the frozen baseline.
const step=source.slice(source.indexOf('  function stockStep()'),source.indexOf('  function stockStep()')+16000);
const keyExpression=step.match(/const key=([^\n]+);/)[1];
const keyHelper=source.match(/^  function stockSubmissionKey\([^]*?^  }/m)?.[0]||'';
const key=vm.runInNewContext(keyHelper+'\n(a)=>'+keyExpression);
const segment=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
function clockFixture(random){
  let now=100,id=0;const timers=new Map(),sent=[];
  const ctx={queued:null,nextStepAt:0,offered:false,Date:{now:()=>now},
    Math:Object.assign(Object.create(Math),{random:()=>random}),inShelter:()=>false,shelterEmergency:()=>false,
    accountStopReason:()=>null,setEnabled:()=>assert.fail('unexpected pause'),schedule:()=>{},say:()=>{},log:{add:()=>{}},
    setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)};
  const api=vm.runInNewContext(segment('  function shelterPreparationAction(','  function matchesPlan(')+
    segment('  function cancelQueued(','  function clearIdleWait(')+'\n({offer,cancel:cancelQueued})',ctx);
  return {ctx,api,timers,sent,at:t=>now=t,offer:a=>api.offer(key(a),'stock',()=>sent.push(a))};
}
const buy={action:'buy',stockId:1,modelName:'模型甲',shares:10,debit:135,estimate:123,signalMargin:.1,signalNet:12,reason:'original signal'};

test('股市提交等待：真实选股输出只改变历史净幅度时保留同一订单等待',()=>{
  const now=Date.parse('2026-11-13T00:00:00Z'),config={trade:true,predict:false,tradeLimit:3000,positionLimit:10000,
    reserve:100,netEfficiency:true},ledger={entries:[],owned:{}},
    view={userId:77,enabled:true,stocks:[{id:1,modelName:'模型甲',priceCents:1200,volume24h:1000}],positions:[],rounds:[],myBets:[],
      ticks:[1000,1040,1080,1120,1160,1200].map((priceCents,i)=>({stockId:1,priceCents,createdAt:new Date(now-(5-i)*300000).toISOString()})),
      rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:10000,maxDailyBuyTokens:10000,maxPositionTokens:10000,reserveTokens:10000}};
  const before=c.choose(c.model(view,{tokens:10000}),config,ledger,now);assert.equal(before.action,'buy');
  view.ticks.at(-1).priceCents=1180;
  const after=c.choose(c.model(view,{tokens:10000}),config,ledger,now+1000);assert.equal(after.action,'buy');
  assert.notEqual(after.signalMargin,before.signalMargin);assert.notEqual(after.reason,before.reason);
  for(const field of ['stockId','modelName','shares','estimate','debit'])assert.equal(after[field],before[field],field);
  assert.equal(key(after),key(before));
});
for(const [random,delay] of [[0,2000],[.9999,5000]])test('股市提交等待：评分更新沿用原'+delay+'毫秒期限，只执行当前回调',()=>{
  const x=clockFixture(random);x.offer(buy);const deadline=x.ctx.queued.dueAt,originalTimer=[...x.timers.values()][0];
  assert.equal(deadline,100+delay);
  for(const delta of [500,1000,1500]){
    x.at(100+delta);x.offer({...buy,reason:'signal '+delta,signalMargin:delta,signalNet:delta});
    assert.equal(x.ctx.queued.dueAt,deadline);assert.equal([...x.timers.values()][0],originalTimer);assert.equal(x.sent.length,0);
  }
  const latest={...buy,reason:'latest signal',signalMargin:.2,signalNet:24};
  x.at(deadline);originalTimer.fn();assert.equal(x.sent.length,0,'timer only wakes current validation');
  x.offer(latest);assert.deepEqual(x.sent,[latest]);assert.equal(x.timers.size,0);
});
test('股市提交等待：目标、数量、报价金额、预测条件及未知字段改变仍重置等待',()=>{
  for(const change of [{action:'sell'},{stockId:2},{modelName:'模型乙'},{shares:11},{estimate:124},{debit:136},
    {roundId:42},{direction:'down'},{betTokens:101},{unknownRisk:true}]){
    const x=clockFixture(0);x.offer(buy);x.at(1100);const changed={...buy,...change};
    assert.notEqual(key(changed),key(buy));x.offer(changed);assert.equal(x.ctx.queued.dueAt,3100);
    x.at(2100);x.offer(changed);assert.equal(x.sent.length,0);
    x.at(3100);x.offer(changed);assert.deepEqual(x.sent,[changed]);
  }
});
test('股市提交等待：预测样本说明和卖出原因不重置，相反方向或轮次仍重新等待',()=>{
  const predict={action:'predict',stockId:1,modelName:'模型甲',roundId:42,direction:'up',betTokens:100,debit:100,reason:'6 samples'};
  assert.equal(key(predict),key({...predict,reason:'7 samples'}));
  for(const change of [{roundId:43},{direction:'down'},{betTokens:200,debit:200}])assert.notEqual(key(predict),key({...predict,...change}));
  const sale={action:'sell',stockId:1,modelName:'模型甲',shares:10,debit:0,reason:'profit'};
  assert.equal(key(sale),key({...sale,reason:'trend'}));
});
test('股市提交等待：取消后旧计时器不能发送，新一轮保持完整等待',()=>{
  const x=clockFixture(0);x.offer(buy);const timer=[...x.timers.values()][0];x.api.cancel();
  x.at(2100);timer.fn();assert.equal(x.sent.length,0);x.offer({...buy,reason:'rechecked'});
  assert.equal(x.ctx.queued.dueAt,4100);assert.equal(x.sent.length,0);
});
