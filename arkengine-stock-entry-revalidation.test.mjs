import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const c=vm.runInNewContext(code.slice(code.indexOf('\n'))+'\nstockCore;');
const now=Date.parse('2026-11-10T12:00:00Z');
const cfg={trade:true,predict:false,tradeLimit:3000,positionLimit:10000,reserve:100};
function fixture(){
  const v={userId:77,enabled:true,stocks:[{id:1,modelName:'模型甲',priceCents:1200,volume24h:1000}],positions:[],
    ticks:[],rounds:[],myBets:[],rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:10000,maxDailyBuyTokens:10000,maxPositionTokens:10000,reserveTokens:10000}};
  const p={id:'original',beforeShares:0,beforeCost:0,result:null,choice:{action:'buy',stockId:1,modelName:'模型甲',shares:10,debit:150}};
  const f={m:c.model(v,{tokens:10000}),l:{entries:[{id:p.id,action:'buy',at:now,debit:150,result:'reserved'}],owned:{}},p};
  ticks(f,[1000,1040,1080,1120,1160,1200]);return f;
}
function ticks(f,prices){f.m.view.ticks=prices.map((priceCents,i)=>({stockId:1,priceCents,createdAt:new Date(now-(prices.length-1-i)*300000).toISOString()}));f.m.view.stocks[0].priceCents=prices.at(-1);}
test('原买单信号：上涨转弱、走平或不足含费门槛时不续发，原单保留',()=>{
  for(const prices of [[1400,1360,1320,1280,1240,1200],[1200,1200,1200,1200,1200,1200],[1150,1160,1170,1180,1190,1200]]){
    const f=fixture(),before=JSON.stringify(f.p);ticks(f,prices);
    assert.match(c.recoveryWait(f.m,cfg,f.l,f.p,now),/入场信号/);assert.equal(JSON.stringify(f.p),before);
  }
});
test('原买单信号：行情过期或缺样本时等待，新鲜上涨恢复后仍按原股数',()=>{
  const {m,l,p}=fixture();assert.equal(c.recoveryWait(m,cfg,l,p,now),null);
  assert.match(c.recoveryWait(m,cfg,l,p,now+600001),/入场信号/);
  m.view.ticks=[];assert.match(c.recoveryWait(m,cfg,l,p,now),/入场信号/);
  const fresh=fixture();m.view.ticks=fresh.m.view.ticks;assert.equal(c.recoveryWait(m,cfg,l,p,now),null);assert.equal(p.choice.shares,10);
});
test('原买单信号：手续费上涨抬高原有入场门槛，即使金额未超预留仍等待',()=>{
  const f=fixture();ticks(f,[1000,1020,1040,1060,1080,1100]);f.p.choice.debit=150;
  assert.equal(c.recoveryWait(f.m,cfg,f.l,f.p,now),null);
  f.m.rules.buyFeePct=8;assert.match(c.recoveryWait(f.m,cfg,f.l,f.p,now),/入场信号/);
});
test('原买单信号：净额筛选开启时原股数的含费情景也必须仍为正',()=>{
  const f=fixture();ticks(f,[1,1,1,2,2,2]);f.p.choice.shares=1;f.p.choice.debit=10;
  // Use a valid smooth trend at low prices so whole-token costs can consume the signal margin.
  ticks(f,[10,11,12,13,14,15]);
  assert.equal(c.recoveryWait(f.m,cfg,f.l,f.p,now),null);
  assert.match(c.recoveryWait(f.m,{...cfg,netEfficiency:true},f.l,f.p,now),/入场信号.*净额/);
});
test('原买单信号：已出现对应股数仅允许核对原回执，不改成功状态、不绕过余额',()=>{
  const f=fixture();ticks(f,[1400,1360,1320,1280,1240,1200]);
  f.m.view.positions=[{stockId:1,shares:10,costBasisTokens:123,holdUntil:null}];
  assert.equal(c.recoveryWait(f.m,cfg,f.l,f.p,now),null);assert.equal(f.p.result,null);
  f.m.balance=100;assert.match(c.recoveryWait(f.m,cfg,f.l,f.p,now),/保留余额/);
});
test('原买单信号：卖出退出不要求买入信号，人工接管仍阻止确认',()=>{
  const f=fixture();f.p.beforeShares=10;f.p.choice.action='sell';f.p.choice.debit=0;
  f.m.view.positions=[{stockId:1,shares:10,costBasisTokens:130,holdUntil:null}];f.l.owned['1']={shares:10,cost:130,manual:false};f.m.view.ticks=[];
  assert.equal(c.recoveryWait(f.m,cfg,f.l,f.p,now),null);
  f.p.manualTouched=true;assert.match(c.recoveryWait(f.m,cfg,f.l,f.p,now),/手动/);
});
