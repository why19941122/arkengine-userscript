import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const c=vm.runInNewContext(code.slice(code.indexOf('\n'))+'\nstockCore;');
const now=Date.parse('2026-11-10T12:00:00Z');
const config={trade:true,predict:false,tradeLimit:0,predictionLimit:0,reserve:100,lossLimit:100000};
function fixture(){
  const stocks=[{id:1,modelName:'盈利仓',priceCents:1200,volume24h:100},
    {id:2,modelName:'止损仓',priceCents:800,volume24h:100},
    {id:3,modelName:'转弱仓',priceCents:1000,volume24h:100}];
  const view={userId:77,enabled:true,stocks,positions:stocks.map(s=>({stockId:s.id,shares:100,costBasisTokens:1000,holdUntil:null})),
    ticks:[1200,1160,1120,1080,1040,1000].map((priceCents,i)=>({stockId:3,priceCents,createdAt:new Date(now-(5-i)*300000).toISOString()})),
    rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:100000,maxDailyBuyTokens:100000,maxPositionTokens:100000,reserveTokens:100000},rounds:[],myBets:[]};
  return {m:c.model(view,{tokens:400000}),l:{entries:[],owned:Object.fromEntries(stocks.map(s=>[s.id,{shares:100,cost:1000,modelName:s.modelName,manual:false}]))}};
}
test('股市退出优先级：止损先于转弱和止盈，不依赖网页排列',()=>{
  const {m,l}=fixture();
  for(const order of [[1,2,3],[3,1,2],[2,3,1]]){
    m.view.stocks.sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
    assert.equal(c.choose(m,config,l,now).stockId,2);
  }
  l.owned[2].manual=true;assert.equal(c.choose(m,config,l,now).stockId,3);
});
test('股市退出优先级：同类按含费净亏损比例排序，平手按编号稳定选择',()=>{
  const {m,l}=fixture();m.view.stocks[0].priceCents=600;
  m.view.stocks.reverse();assert.equal(c.choose(m,config,l,now).stockId,1);
  m.view.stocks.find(s=>s.id===2).priceCents=600;assert.equal(c.choose(m,config,l,now).stockId,1);
});
test('股市退出优先级：停牌、锁定、人工混仓和成本不符不进入队列',()=>{
  for(const change of [({m})=>m.view.stocks[1].suspended=true,
    ({m})=>m.view.positions[1].holdUntil=new Date(now+60000).toISOString(),({l})=>l.owned[2].manual=true,
    ({l})=>l.owned[2].cost++]){
    const f=fixture();change(f);assert.equal(c.choose(f.m,config,f.l,now).stockId,3);
  }
});
test('股市退出优先级：部分出售保持单笔上限和手续费，零到账不卖',()=>{
  const {m,l}=fixture();m.rules.maxTradeTokens=40;
  const a=c.choose(m,config,l,now);assert.equal(a.stockId,2);assert.equal(a.shares,5);
  assert.equal(c.quote(800,a.shares,m.rules.sellFeePct,false),39);
  m.rules.reserveTokens=0;assert.equal(c.choose(m,config,l,now),null);
  m.rules.reserveTokens=1;m.view.stocks.forEach(s=>s.priceCents=1);
  m.view.positions.forEach(p=>p.shares=1);Object.values(l.owned).forEach(o=>o.shares=1);
  assert.equal(c.choose(m,config,l,now),null);
});
test('股市退出优先级：历史缺口仍禁新买但不拦合法止损，关闭交易不卖',()=>{
  const {m,l}=fixture();l.archive={unknownSales:36,realized:-35999};
  assert.match(c.riskReason(m,config,l,now),/未知/);
  assert.equal(c.choose(m,config,l,now).stockId,2);
  assert.equal(c.choose(m,{...config,trade:false},l,now),null);
});
test('股市退出优先级：诊断顺序与实际选择一致且不改持仓或原输入',()=>{
  const {m,l}=fixture(),before=JSON.stringify({m,l});
  const d=c.decisionDiagnostics(m,config,l,now);
  assert.deepEqual(Array.from(d.exitQueue,r=>r.stockId),[2,3,1]);
  assert.equal(d.exitQueue[0].stockId,d.selected.stockId);
  assert.equal(d.exitQueue[0].netReturnPct,-22);
  assert.equal(JSON.stringify({m,l}),before);
});
test('股市停滞获利退出：须整仓扣费取整后至少赚一代币，正常行情不提前止盈',()=>{
  const {m,l}=fixture(),stock=m.view.stocks[0],pos=m.view.positions[0];m.view.stocks=[stock];m.view.positions=[pos];
  stock.stale=true;stock.priceCents=1026;
  assert.equal(c.choose(m,config,l,now),null);
  stock.priceCents=1027;
  const sale=c.choose(m,config,l,now);assert.equal(sale?.action,'sell');assert.equal(sale.shares,pos.shares);
  assert.equal(c.quote(stock.priceCents,sale.shares,m.rules.sellFeePct,false),1001);
  assert.equal(c.positionReport(m,l,now)[0].status,'sell');
  assert.equal(c.decisionDiagnostics(m,config,l,now).exitQueue[0].reason,sale.reason);
  stock.stale=false;assert.equal(c.choose(m,config,l,now),null);
  stock.stale=true;m.rules.reserveTokens=1000;assert.equal(c.choose(m,config,l,now),null);
  assert.match(c.positionReport(m,l,now)[0].reason,/整仓/);
});
test('股市停滞获利退出：未知原单未反映时不能按已消失的盈利重发，可能成交只核对原回执',()=>{
  const {m,l}=fixture(),stock=m.view.stocks[0];stock.stale=true;stock.priceCents=1050;
  const sale=c.sellPlan(m,stock,l.owned,now);assert.equal(sale?.action,'sell');
  const pending={id:'original',beforeShares:100,beforeCost:1000,choice:sale},before=JSON.stringify(pending);
  assert.equal(c.recoveryWait(m,config,l,pending,now),null);
  stock.priceCents=1026;assert.match(c.recoveryWait(m,config,l,pending,now),/净收益/);
  m.view.positions.shift();assert.equal(c.recoveryWait(m,config,l,pending,now),null);
  assert.equal(JSON.stringify(pending),before);
});
