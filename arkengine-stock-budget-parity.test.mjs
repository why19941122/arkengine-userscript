import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {replayStock} from './arkengine-stock-replay.mjs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const c=vm.runInNewContext(code.slice(code.indexOf('\n'))+'\nstockCore;');
const now=Date.parse('2026-11-12T04:00:00Z');
const settings={trade:true,predict:false,autoBudget:true,tradeLimit:3000,predictionLimit:0,stake:0,reserve:1000,
  riskLimit:400000,positionLimit:400000,lossLimit:100000};
function fixture(){
  const view={userId:77,enabled:true,stocks:[{id:1,modelName:'旧仓',priceCents:1000,volume24h:100,stale:true},
    {id:2,modelName:'候选',priceCents:1200,volume24h:1000}],
    positions:[{stockId:1,shares:1000,costBasisTokens:10000,holdUntil:null}],rounds:[],myBets:[],dailyBoughtTokens:0,
    ticks:[1000,1040,1080,1120,1160,1200].map((priceCents,i)=>({stockId:2,priceCents,createdAt:new Date(now-(5-i)*300000).toISOString()})),
    rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:100000,maxDailyBuyTokens:500000,maxPositionTokens:1000000,reserveTokens:1000000}};
  const ledger={userId:77,entries:[],owned:{'1':{shares:1000,cost:10000,modelName:'旧仓',manual:false}}};
  return {view,ledger,m:c.model(view,{tokens:400000})};
}
test('股市预算一致：先缩小订单再选择，不把剩余九万风险空间误判为无交易',()=>{
  const {view}=fixture();
  const r=replayStock({snapshots:[{at:now,view}],initialBalance:400000,
    initialPositions:view.positions.map(p=>({...p,managed:true})),config:settings});
  assert.equal(r.trades.length,1);assert.equal(r.trades[0].action,'buy');assert.equal(r.trades[0].stockId,2);
  assert.ok(r.orders[0].reservedTokens<=90000);assert.ok(r.trades[0].debit>80000);
  assert.ok(r.account.ending.capital<=100000);assert.ok(r.decisions.every(d=>d.allowed));
});
test('股市预算一致：日志候选、股数和约束使用执行预算，原自动资金设置不被改写',()=>{
  const {m,ledger}=fixture(),before=JSON.stringify({m,ledger,settings});
  const cfg=c.accountBudget(m,settings,ledger,now,20000),a=c.choose(m,cfg,ledger,now);
  const d=c.decisionDiagnostics(m,settings,ledger,now,undefined,20000);
  assert.equal(JSON.stringify(d.selected),JSON.stringify(a));assert.ok(a.debit<=20000);
  assert.equal(d.budget.reserveBudget,20000);assert.equal(d.policy.autoBudget,true);
  assert.equal(d.budget.constraints.find(v=>v.key==='account-risk-budget').remaining,20000);
  const candidate=d.stocks.find(s=>s.stockId===2);assert.equal(candidate.buy.reservedDebit,a.debit);
  assert.equal(JSON.stringify({m,ledger,settings}),before);
});
test('股市预算一致：已有24小时支出不会二次扣减风险余量，严格日额度仍生效',()=>{
  const {m,ledger}=fixture();ledger.entries.push({id:'spent',at:now-1000,action:'buy',result:'success',debit:10000,stockId:9});
  const cfg=c.accountBudget(m,settings,ledger,now,20000);
  assert.equal(cfg.tradeLimit,30000);assert.ok(c.choose(m,cfg,ledger,now).debit>18000);
  const limited=c.accountBudget(m,{...settings,dailyBuyLimit:12000},ledger,now,20000);
  assert.equal(limited.tradeLimit,12000);assert.ok(c.choose(m,limited,ledger,now).debit<=2000);
});
test('股市预算一致：无风险空间只停止新买，已触发的合法卖出保留',()=>{
  const {m,ledger}=fixture();
  for(const capacity of [0,null,NaN,undefined]){
    const cfg=c.accountBudget(m,settings,ledger,now,capacity);assert.equal(c.choose(m,cfg,ledger,now),null);
  }
  m.view.stocks[0].priceCents=900;
  const a=c.choose(m,c.accountBudget(m,settings,ledger,now,0),ledger,now);
  assert.equal(a.action,'sell');assert.equal(a.stockId,1);
});
