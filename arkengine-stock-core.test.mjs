import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const c=vm.runInNewContext(code.slice(code.indexOf('\n'))+'\nstockCore;');
const now=Date.parse('2026-11-03T03:00:00Z');
const config={trade:true,predict:true,tradeLimit:3000,predictionLimit:500,stake:100,reserve:100};
function fixture(){const s={id:1,modelName:'模型甲',priceCents:1200,volume24h:1000};
  const v={userId:7,enabled:true,stocks:[s],positions:[],ticks:[1000,1040,1080,1120,1160,1200].map((priceCents,i)=>({stockId:1,priceCents,createdAt:new Date(now-(5-i)*300000).toISOString()})),
    rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:10000,maxDailyBuyTokens:10000,maxPositionTokens:10000,reserveTokens:10000},rounds:[],myBets:[]};
  return {v,m:c.model(v,{tokens:10000}),l:{owned:{},entries:[]}};}

test('运行修复：零成交量但行情有效可选股，停牌停滞和无效成交量仍不可选',()=>{
  const {v,m,l}=fixture(),s=v.stocks[0],cfg={...config,predict:false,netEfficiency:true};s.volume24h=0;
  assert.equal(c.trend(v,s,now)?.direction,'up');assert.equal(c.choose(m,cfg,l,now)?.action,'buy');
  for(const volume of [-1,NaN,undefined,Infinity]){s.volume24h=volume;assert.equal(c.choose(m,cfg,l,now),null);}
  s.volume24h=0;s.stale=true;assert.equal(c.choose(m,cfg,l,now),null);
  s.stale=false;s.suspended=true;assert.equal(c.choose(m,cfg,l,now),null);
  s.suspended=false;assert.equal(c.choose(m,cfg,l,now+11*60000),null);
});
test('运行修复：股市等待说明区分历史不足、停滞和上涨不足以覆盖费用',()=>{
  const {v,m,l}=fixture(),cfg={...config,predict:false};v.stocks[0].volume24h=0;
  v.stocks[0].priceCents=1040;v.ticks=v.ticks.map((t,i)=>({...t,priceCents:1000+i*8}));
  v.stocks.push({...v.stocks[0],id:2,modelName:'停滞模型',stale:true},{...v.stocks[0],id:3,modelName:'无历史模型'});
  const summary=c.marketSummary(m,now);
  assert.equal(summary.total,3);assert.equal(summary.stale,1);assert.equal(summary.history,1);
  assert.equal(summary.up,1);assert.equal(summary.buySignals,0);assert.equal(summary.minBuyChangePct,5.5);
  assert.equal(c.choose(m,cfg,l,now),null);assert.match(c.waitReason(m,cfg,l,now),/上涨1只.*含费门槛0只/);
  assert.match(c.waitReason(m,cfg,l,now),/停牌或停滞1只/);
});

test('股市净信号：含费取整后的净幅度优先，价格涨幅最高者不必排第一；换序结果一致',()=>{
  const {v,l}=fixture();v.rules.buyFeePct=0;v.rules.sellFeePct=0;
  v.stocks=[{id:1,modelName:'涨幅更高',priceCents:81,volume24h:1000},{id:2,modelName:'净幅度更高',priceCents:90,volume24h:1000}];
  v.ticks=v.stocks.flatMap((s,i)=>(i===0?[67,70,73,76,78,81]:[75,78,81,84,87,90]).map((priceCents,n)=>({stockId:s.id,priceCents,createdAt:new Date(now-(5-n)*300000).toISOString()})));
  const cfg={...config,tradeLimit:300,predict:false},m=c.model(v,{tokens:10000});
  assert.equal(c.choose(m,cfg,l,now).stockId,1);
  // Both orders cost 90 tokens; the same-trend scenario settles 99 versus 100 tokens after rounding.
  const best=c.choose(m,{...cfg,netEfficiency:true},l,now);
  assert.equal(best.stockId,2);assert.equal(best.estimate,90);assert.equal(best.signalNet,10);
  v.stocks.reverse();assert.equal(c.choose(c.model(v,{tokens:10000}),{...cfg,netEfficiency:true},l,now).stockId,2);
  assert.match(best.reason,/非收益预测/);
});
test('股市净信号：扣费取整后无净幅度则不买，不把历史涨幅当确定收益',()=>{
  const {v,l}=fixture();v.rules.buyFeePct=0;v.rules.sellFeePct=0;
  v.stocks[0].priceCents=120;v.ticks=[100,104,108,112,116,120].map((priceCents,n)=>({stockId:1,priceCents,createdAt:new Date(now-(5-n)*300000).toISOString()}));
  const cfg={...config,tradeLimit:9,reserve:0,predict:false},m=c.model(v,{tokens:10000});
  assert.ok(c.choose(m,cfg,l,now));assert.equal(c.choose(m,{...cfg,netEfficiency:true},l,now),null);
});
test('股市自动资金：摆脱手填100000，按资产80%和网站限额计算，零设置也可自动投入',()=>{
  const {m,l}=fixture(),cfg={...config,autoBudget:true,tradeLimit:100000,reserve:99999,predict:false};
  let f=c.funding(m,cfg);assert.equal(f.reserve,2000);assert.equal(f.tradeLimit,8000);assert.equal(f.positionLimit,8000);
  m.rules.maxDailyBuyTokens=4000;m.rules.maxPositionTokens=7000;
  f=c.funding(m,cfg);assert.equal(f.tradeLimit,4000);assert.equal(f.positionLimit,7000);
  assert.ok(c.choose(m,{...cfg,tradeLimit:0},l,now));
  m.balance=800;f=c.funding(m,cfg);assert.equal(f.reserve,800);assert.equal(f.tradeLimit,0);assert.equal(c.choose(m,cfg,l,now),null);
});
test('股市自动资金：买入转持仓不收缩总预算，卖出不清支出，手动持仓占用总仓位',()=>{
  const {m,l}=fixture(),cfg={...config,autoBudget:true,predict:false};
  m.balance=7000;m.view.positions=[{stockId:1,shares:250,costBasisTokens:3000}];
  assert.equal(c.funding(m,cfg).tradeLimit,8000);assert.equal(c.funding(m,cfg).reserve,2000);
  l.entries=[{id:'prior',action:'buy',at:now,debit:8000,result:'success'}];
  m.balance=10000;m.view.positions=[];assert.equal(c.choose(m,cfg,l,now),null,'卖出回款不恢复已花额度');
  m.balance=2000;m.view.positions=[{stockId:99,shares:100,costBasisTokens:8000}];l.entries=[];
  assert.equal(c.choose(m,cfg,l,now),null,'手动持仓不再额外获得一份自动仓位');
  m.view.positions[0].costBasisTokens=null;assert.equal(c.choose(m,cfg,l,now),null);
  assert.match(c.waitReason(m,cfg,l,now),/成本不完整/);
});
test('股市自动资金：未知买单按最新余额和网站上限核对，不重算股数或侵占周转金',()=>{
  const {m,l}=fixture(),cfg={...config,autoBudget:true,predict:false},p={id:'original',beforeShares:0,
    choice:{action:'buy',stockId:1,modelName:'模型甲',shares:70,debit:900}};
  l.entries=[{id:p.id,action:'buy',at:now,debit:900,result:'reserved'}];
  assert.equal(c.recoveryWait(m,cfg,l,p,now),null);
  m.balance=1500;assert.match(c.recoveryWait(m,cfg,l,p,now),/额度|保留余额/);
  m.balance=10000;m.rules.maxDailyBuyTokens=500;assert.match(c.recoveryWait(m,cfg,l,p,now),/额度/);
  m.rules.maxDailyBuyTokens=10000;m.rules.maxPositionTokens=500;assert.match(c.recoveryWait(m,cfg,l,p,now),/持仓超过/);
});
test('股市自动资金：手动模式保持原额度，极大资产与缺失成本不生成不安全金额',()=>{
  const {m}=fixture();assert.equal(c.funding(m,config).tradeLimit,3000);assert.equal(c.funding(m,config).reserve,100);
  m.balance=Number.MAX_SAFE_INTEGER;m.view.positions=[{stockId:1,shares:1,costBasisTokens:1}];
  assert.equal(c.funding(m,{...config,autoBudget:true}).tradeLimit,0);
});

test('股市下注唯一性：重复编号和数值/字符串别名都不能成为唯一凭据，不改原列表',()=>{
  const first={id:1,roundId:42,settled:true,payoutTokens:180},second={id:1,roundId:42,settled:false};
  const v={myBets:[first,second]},before=JSON.stringify(v);
  assert.equal(c.uniqueBet(v,1),null);v.myBets.reverse();assert.equal(c.uniqueBet(v,1),null);
  v.myBets.reverse();assert.equal(JSON.stringify(v),before);
  v.myBets=[first,{...second,id:'1'}];assert.equal(c.uniqueBet(v,1),null);assert.equal(c.uniqueBet(v,'1'),null);
  v.myBets=[first];assert.equal(c.uniqueBet(v,1),first);assert.equal(c.uniqueBet(v,'1'),null);
});

test('股市下注唯一性：缺失或非法编号不绑定，其他下注的冲突不影响当前唯一记录',()=>{
  const bet={id:'bet-1',roundId:42,settled:true,payoutTokens:0};
  const v={myBets:[null,{},bet,{id:2,settled:false},{id:2,settled:true}]};
  assert.equal(c.uniqueBet(v,'bet-1'),bet);
  for(const id of [undefined,null,0,-1,{},'__proto__','missing'])assert.equal(c.uniqueBet(v,id),null);
  for(const view of [undefined,null,{}, {myBets:null}])assert.equal(c.uniqueBet(view,'bet-1'),null);
});
test('股市金额：买向上、卖向下取整，小数手续费和最大安全边界',()=>{
  assert.equal(c.quote(101,1,2,true),2);assert.equal(c.quote(101,1,2.5,false),0);
  assert.equal(c.quote(10000,3,2.125,true),307);assert.equal(c.quote(10000,3,2.125,false),293);
  assert.equal(c.quote(Number.MAX_SAFE_INTEGER,2147483647,2,true),null);
  assert.equal(c.quote(100,1,-1,true),null);assert.equal(c.quote(100,1,100,true),null);
  assert.equal(c.sharesFor(101,2,10),9);assert.equal(c.sharesFor(101,2,0),0);
});

test('股市原交易资金：原预留只计一次，降额按当前限额判断，旧预留跨日也不漏算',()=>{
  const {m,l}=fixture(),p={id:'original',beforeShares:0,choice:{action:'buy',stockId:1,modelName:'模型甲',shares:70,debit:900},reserveFloor:100};
  l.entries=[{id:p.id,action:'buy',at:now,debit:900,result:'reserved'},{id:'other',action:'buy',at:now,debit:200,result:'success'}];
  const cfg={...config,tradeLimit:1100};assert.equal(c.recoveryWait(m,cfg,l,p,now),null);
  assert.match(c.recoveryWait(m,{...cfg,tradeLimit:1000},l,p,now),/24小时额度/);
  l.entries[0].at=now-2*86400000;
  assert.match(c.recoveryWait(m,{...cfg,tradeLimit:1000},l,p,now),/24小时额度/);
  l.entries[1].result='rejected';assert.equal(c.recoveryWait(m,{...cfg,tradeLimit:1000},l,p,now),null);
});
test('股市原交易资金：预测尊重新固定单注和独立额度，股票支出不挪用预测额度',()=>{
  const {m,l}=fixture(),p={id:'original',choice:{action:'predict',debit:100,betTokens:100},reserveFloor:100};
  l.entries=[{id:'old-buy',action:'buy',at:now,debit:3000,result:'success'}];
  assert.equal(c.recoveryWait(m,config,l,p,now),null);
  assert.match(c.recoveryWait(m,{...config,stake:50},l,p,now),/固定单注/);
  l.entries.push({id:'old-predict',action:'predict',at:now,debit:100,result:'success'});
  assert.match(c.recoveryWait(m,{...config,predictionLimit:100},l,p,now),/24小时额度/);
});
test('股市原交易资金：未知结果始终核对当前余额，旧保留线记录不能证明已经扣款',()=>{
  const {m,l}=fixture(),p={id:'original',beforeShares:0,choice:{action:'buy',stockId:1,modelName:'模型甲',shares:70,debit:900},reserveFloor:100};
  for(const reserveFloor of [undefined,0,100,10000]){
    p.reserveFloor=reserveFloor;m.balance=100;assert.match(c.recoveryWait(m,config,l,p,now),/保留余额/);
    assert.match(c.recoveryWait(m,{...config,reserve:50},l,p,now),/保留余额/);
    m.balance=1000;assert.equal(c.recoveryWait(m,config,l,p,now),null);
    m.balance=999;assert.match(c.recoveryWait(m,config,l,p,now),/保留余额/);
  }
  m.balance=1500;assert.match(c.recoveryWait(m,{...config,reserve:1000},l,p,now),/保留余额/);
  m.balance=1900;assert.equal(c.recoveryWait(m,{...config,reserve:1000},l,p,now),null);
});
test('股市原交易资金：已出现的原持仓不重复计成本，其他持仓和成本缺失仍限制原买入',()=>{
  const {m,l}=fixture(),p={id:'original',beforeShares:0,choice:{action:'buy',stockId:1,modelName:'模型甲',shares:70,debit:900},reserveFloor:100},cfg={...config,tradeLimit:1000};
  m.view.positions=[{stockId:1,shares:70,costBasisTokens:820}];assert.equal(c.recoveryWait(m,cfg,l,p,now),null);
  m.view.positions.push({stockId:2,shares:10,costBasisTokens:101});assert.match(c.recoveryWait(m,cfg,l,p,now),/持仓超过/);
  m.view.positions[1].costBasisTokens=null;assert.match(c.recoveryWait(m,cfg,l,p,now),/成本不完整/);
});
test('股市原交易资金：人工接管阻止原卖出续发，普通卖出不受买入和预测额度影响',()=>{
  const {m,l}=fixture(),p={id:'original',beforeShares:10,choice:{action:'sell',stockId:1,modelName:'模型甲',shares:10,debit:0},reserveFloor:100};
  l.owned['1']={shares:10,cost:100,manual:false};
  m.view.positions=[{stockId:1,shares:10,costBasisTokens:100}];
  const cfg={...config,tradeLimit:0,predictionLimit:0,reserve:10000};assert.equal(c.recoveryWait(m,cfg,l,p,now),null);
  p.manualTouched=true;assert.match(c.recoveryWait(m,cfg,l,p,now),/手动操作/);
});
test('股市原交易报价：按原股数重算当前含费成本，等于原预留可确认，多一代币就等待',()=>{
  const {m,l}=fixture(),p={id:'original',beforeShares:0,choice:{action:'buy',stockId:1,modelName:'模型甲',shares:70,debit:900}};
  m.view.stocks[0].priceCents=1260;assert.equal(c.quote(1260,70,2,true),900);
  assert.equal(c.recoveryWait(m,config,l,p,now),null);
  const before=JSON.stringify(p);m.view.stocks[0].priceCents=1261;
  assert.match(c.recoveryWait(m,config,l,p,now),/901.*原预留 900/);assert.equal(JSON.stringify(p),before);
  m.view.stocks[0].priceCents=1200;m.rules.buyFeePct=25;
  assert.match(c.recoveryWait(m,config,l,p,now),/1050.*原预留 900/);
  m.rules.buyFeePct=2;assert.equal(c.recoveryWait(m,config,l,p,now),null);
});

test('股市原交易持仓：未决买入只能核对原前后股数，不凭持仓状态确认成功',()=>{
  const {m,l}=fixture(),p={id:'original',beforeShares:0,result:null,choice:{action:'buy',stockId:1,modelName:'模型甲',shares:70,debit:900}};
  const before=JSON.stringify(p);
  for(const shares of [0,1,69,70,71]){
    m.view.positions=shares?[{stockId:1,shares,costBasisTokens:820}]:[];
    const wait=c.recoveryWait(m,config,l,p,now);
    if(shares===0||shares===70)assert.equal(wait,null);
    else assert.match(wait,/数量与原交易前后均不符/);
    assert.equal(JSON.stringify(p),before,'股数匹配不变成成功回执，也不改原股数或预算');
  }
  for(const bad of [undefined,null,-1,1.5,'0',Number.MAX_SAFE_INTEGER]){
    p.beforeShares=bad;assert.match(c.recoveryWait(m,config,l,p,now),/快照无法核对/);
  }
});

test('股市原交易持仓：原卖出校验前后股数、原成本和管理归属，正常部分结果仍可核对',()=>{
  const {m,l}=fixture(),p={id:'original',beforeShares:10,choice:{action:'sell',stockId:1,modelName:'模型甲',shares:4,debit:0}};
  l.owned['1']={shares:10,cost:100,manual:false};
  for(const [shares,cost,allowed] of [[10,100,true],[6,60,true],[11,110,false],[9,90,false],[5,50,false],[10,101,false],[10,null,false]]){
    m.view.positions=[{stockId:1,shares,costBasisTokens:cost}];
    const wait=c.recoveryWait(m,config,l,p,now);
    if(allowed)assert.equal(wait,null);else assert.match(wait,/持仓数量|持仓成本/);
  }
  m.view.positions=[{stockId:1,shares:10,costBasisTokens:100}];
  l.owned['1'].manual=true;assert.match(c.recoveryWait(m,config,l,p,now),/归属无法核对/);
  delete l.owned['1'];assert.match(c.recoveryWait(m,config,l,p,now),/归属无法核对/);
});
test('股市原交易报价：只使用原编号和名称的当前有效报价，缺失或不安全金额均等待',()=>{
  for(const change of [m=>m.view.stocks=[],m=>m.view.stocks[0].id=2,m=>m.view.stocks[0].modelName='另一个模型',
    m=>m.view.stocks[0].stale=true,m=>m.view.stocks[0].suspended=true,
    m=>m.view.stocks[0].priceCents=Number.MAX_SAFE_INTEGER]){
    const {m,l}=fixture(),p={id:'original',beforeShares:0,choice:{action:'buy',stockId:1,modelName:'模型甲',shares:1000,debit:2000}};
    change(m);assert.match(c.recoveryWait(m,config,l,p,now),/无法核对/);
  }
});

test('股市原卖出报价：按原股数扣费取整，零代币等待，一代币恢复且不受买入资金限制',()=>{
  const {m,l}=fixture(),p={id:'original',beforeShares:10,choice:{action:'sell',stockId:1,modelName:'模型甲',shares:10,debit:0}};
  l.owned['1']={shares:10,cost:100,manual:false};m.view.positions=[{stockId:1,shares:10,costBasisTokens:100}];
  const cfg={...config,tradeLimit:0,predictionLimit:0,reserve:10000};m.balance=1;
  for(const [price,fee,shares,net] of [[10,2.5,10,0],[11,2.5,10,1],[11,9.9999,10,1],[11,10,10,0],[25,2.5,4,0],[26,2.5,4,1]]){
    m.view.stocks[0].priceCents=price;m.rules.sellFeePct=fee;p.choice.shares=shares;
    assert.equal(c.quote(price,shares,fee,false),net);
    const before=JSON.stringify(p),reason=c.recoveryWait(m,cfg,l,p,now);
    if(net===0)assert.match(reason,/净到账为0/);else assert.equal(reason,null);
    assert.equal(JSON.stringify(p),before,'不扩大原卖出股数来凑一代币，也不改变预留或结果');
  }
});

test('股市原卖出报价：缺失、改名、停牌、过期或金额无法安全计算均保留原单',()=>{
  for(const change of [m=>m.view.stocks=[],m=>m.view.stocks[0].id=2,m=>m.view.stocks[0].modelName='模型乙',
    m=>m.view.stocks[0].stale=true,m=>m.view.stocks[0].suspended=true,m=>m.view.stocks[0].priceCents=Number.MAX_SAFE_INTEGER]){
    const {m,l}=fixture(),p={id:'original',beforeShares:1000,choice:{action:'sell',stockId:1,modelName:'模型甲',shares:1000,debit:0}};
    l.owned['1']={shares:1000,cost:100,manual:false};m.view.positions=[{stockId:1,shares:1000,costBasisTokens:100}];
    change(m);assert.match(c.recoveryWait(m,config,l,p,now),/无法核对/);
  }
});
test('股市模型：余额独立读取，缺失规则、重复模型和错误持有期拒绝',()=>{
  const {v}=fixture();assert.ok(c.model(v,{tokens:1}));assert.equal(c.model(v,{}),null);
  delete v.rules.reserveTokens;assert.equal(c.model(v,{tokens:1}),null);
  const a=fixture().v;a.stocks.push({...a.stocks[0],id:2});assert.equal(c.model(a,{tokens:1}),null);
  const b=fixture().v;b.positions=[{stockId:1,shares:1,holdUntil:'unknown'}];assert.equal(c.model(b,{tokens:1}),null);
});
test('股市余额：有限小数余额仅向下取整为可花整数，不因小数拒绝整页',()=>{
  const {v}=fixture();assert.equal(c.model(v,{tokens:10000.75})?.balance,10000);
  assert.equal(c.model(v,{tokens:.75})?.balance,0);
  for(const tokens of [-.1,Infinity,NaN,'10000.75'])assert.equal(c.model(v,{tokens}),null);
});
test('股市模型：行情或下注数组有空项时停止本轮读取，不能把异常留到下单阶段',()=>{
  for(const key of ['stocks','positions','ticks','rounds','myBets'])for(const bad of [null,[],1,'missing']){
    const {v}=fixture();v[key].push(bad);assert.equal(c.model(v,{tokens:1000}),null);
  }
});
test('股市趋势：有序新鲜多笔行情；过期、停牌、重复时间或单笔跳价不追涨',()=>{
  const {v}=fixture();assert.equal(c.trend(v,v.stocks[0],now).direction,'up');
  assert.equal(c.trend(v,v.stocks[0],now+11*60000),null);
  v.ticks[1].createdAt=v.ticks[0].createdAt;assert.equal(c.trend(v,v.stocks[0],now),null);
  const b=fixture().v;b.ticks[1].priceCents=1;assert.equal(c.trend(b,b.stocks[0],now),null);
});
test('股市择股：控制24小时买入及总持仓成本、保留余额和一股最低费用',()=>{
  const {m,l}=fixture();const a=c.choose(m,config,l,now);assert.equal(a.action,'buy');assert.ok(a.debit<=1000);
  assert.ok(c.quote(m.view.stocks[0].priceCents,a.shares,m.rules.buyFeePct,true)<=a.debit);
  l.entries=[{action:'buy',at:now,debit:3000,result:'success'}];assert.equal(c.choose(m,config,l,now),null);
  l.entries[0].at=now-86400001;assert.equal(c.choose(m,config,l,now).action,'buy');
  m.balance=100;assert.equal(c.choose(m,config,l,now),null);
});

test('股市预算时间：迟到成功从首次确认时间保守计额，原提交日期不能提前释放额度',()=>{
  for(const action of ['buy','predict']){
    const entry={action,at:now-25*3600000,confirmedAt:now-1000,debit:300,result:'success'};
    assert.equal(c.spend([entry],action,now),300);
    assert.equal(c.spend([entry],action,now+86400000),0);
    assert.equal(c.spend([{...entry,result:'rejected'}],action,now),0);
    assert.equal(c.spend([{...entry,at:now,confirmedAt:now-86400001}],action,now),300);
  }
});

test('股市预算时间：卖出原请求迟到确认后，一小时回买冷却从确认时间计算',()=>{
  const {m,l}=fixture();l.entries=[{action:'sell',stockId:1,at:now-25*3600000,confirmedAt:now-1000,debit:0,result:'success'}];
  assert.equal(c.choose(m,{...config,predict:false},l,now),null);
  l.entries[0].confirmedAt=now-3600001;
  assert.equal(c.choose(m,{...config,predict:false},l,now)?.action,'buy');
});
test('股市等待诊断：预测额度须足够一注，部分到期不能误报恢复，迟到确认和拒绝口径一致',()=>{
  const {m,l}=fixture();l.entries=[
    {action:'predict',at:now-23*3600000,debit:40,result:'success'},
    {action:'predict',at:now-3*86400000,confirmedAt:now-22*3600000,debit:60,result:'success'},
    {action:'predict',at:now-3600000,debit:400,result:'success'},
    {action:'predict',at:now,debit:100000,result:'rejected'}];
  const before=JSON.stringify(l),cfg={...config,trade:false};
  assert.equal(c.choose(m,cfg,l,now),null);
  assert.match(c.waitReason(m,cfg,l,now),/预测：24小时额度不足一注.*约120分钟后可容纳一注/);
  assert.match(c.waitReason(m,cfg,l,now+3600000),/约60分钟后可容纳一注/);
  assert.doesNotMatch(c.waitReason(m,cfg,l,now+2*3600000),/额度不足|分钟后可容纳/);
  assert.equal(JSON.stringify(l),before,'诊断不能改账本或提前释放预算');
});
test('股市等待诊断：买入额度开始释放时间与预测独立，关闭市场不误报额度故障',()=>{
  const {m,l}=fixture();l.entries=[{action:'buy',at:now-23*3600000,debit:3000,result:'success'}];
  assert.match(c.waitReason(m,config,l,now),/买入：24小时买入额度已用完.*约60分钟后开始释放/);
  assert.match(c.waitReason(m,config,l,now),/预测：暂无同时满足/);
  assert.doesNotMatch(c.waitReason(m,config,l,now+3600000),/买入额度已用完/);
  m.view.enabled=false;assert.equal(c.waitReason(m,config,l,now),'股市暂未开放');
});
test('股市等待诊断：分别说明保留余额、持仓成本、名额及网站限额，不建议提高额度',()=>{
  const cases=[
    [(m,l,cfg)=>cfg.tradeLimit=0,/买入：未设置股票额度/],
    [(m,l,cfg)=>m.balance=cfg.reserve,/买入：可用余额已到保留线/],
    [(m)=>m.view.positions=[{stockId:2,shares:1,costBasisTokens:null}],/买入：持仓成本不完整/],
    [(m)=>m.view.positions=[{stockId:2,shares:1,costBasisTokens:3000}],/买入：当前持仓成本已达设置上限/],
    [(m,l)=>{m.view.positions=[2,3,4].map(stockId=>({stockId,shares:1,costBasisTokens:1}));l.owned=Object.fromEntries([2,3,4].map(id=>[id,{manual:false}]));},/买入：已有3只脚本持仓/],
    [(m)=>m.rules.maxTradeTokens=0,/买入：网站单笔交易额度为0/],
    [(m)=>m.rules.maxPositionTokens=0,/买入：已达网站总持仓成本上限/],
    [(m)=>m.rules.maxDailyBuyTokens=0,/买入：网站买入额度暂无余量/]];
  for(const [change,expected] of cases){const {m,l}=fixture(),cfg={...config,predict:false};change(m,l,cfg);
    assert.equal(c.choose(m,cfg,l,now),null);assert.match(c.waitReason(m,cfg,l,now),expected);}
  const {m,l}=fixture();m.balance=config.reserve+99;
  assert.match(c.waitReason(m,{...config,trade:false},l,now),/预测：可用余额不足固定单注/);
});

test('股市持仓：只出售脚本持仓，尊重锁定、系统储备和净收益',()=>{
  const {m,l}=fixture();m.view.positions=[{stockId:1,shares:10,costBasisTokens:100}];
  assert.equal(c.choose(m,config,l,now),null);
  l.owned['1']={shares:10,cost:100};assert.equal(c.choose(m,config,l,now).action,'sell');
  m.view.positions[0].holdUntil=new Date(now+60000).toISOString();assert.equal(c.choose(m,config,l,now),null);
  m.view.positions[0].holdUntil=null;m.rules.reserveTokens=0;assert.equal(c.choose(m,config,l,now),null);
  m.rules.reserveTokens=50;assert.equal(c.choose(m,config,l,now).shares,4);
});
test('股市零回收：整仓有盈利但储备只允许卖出零净额小单时保留持仓，恢复后正常卖出',()=>{
  const {m,l}=fixture();m.view.stocks[0].priceCents=49;m.view.positions=[{stockId:1,shares:100,costBasisTokens:10}];
  l.owned['1']={shares:100,cost:10};m.rules.reserveTokens=1;
  assert.equal(c.quote(49,100,2.5,false),47);assert.equal(c.quote(49,2,2.5,false),0);
  assert.equal(c.choose(m,{...config,predict:false},l,now),null);
  m.rules.reserveTokens=2;const a=c.choose(m,{...config,predict:false},l,now);
  assert.equal(a.action,'sell');assert.equal(a.shares,4);assert.equal(c.quote(49,a.shares,2.5,false),1);
});
test('股市零回收：整仓报价也不足一代币时不为零到账止损，其他可卖持仓继续处理',()=>{
  const {m,l}=fixture();m.view.stocks[0].priceCents=1;m.view.positions=[{stockId:1,shares:1,costBasisTokens:100}];
  l.owned['1']={shares:1,cost:100};assert.equal(c.choose(m,{...config,predict:false},l,now),null);
  m.view.stocks.push({...m.view.stocks[0],id:2,modelName:'模型乙',priceCents:1200});
  m.view.positions.push({stockId:2,shares:10,costBasisTokens:100});l.owned['2']={shares:10,cost:100};
  assert.equal(c.choose(m,{...config,predict:false},l,now)?.stockId,2);
});
test('股市持仓：已交回人工的旧持仓不会永久占用三只自动持仓名额',()=>{
  const {m,l}=fixture();
  const seed=m.view.stocks[0],ticks=m.view.ticks;
  m.view.stocks=[1,2,3,4].map(id=>({...seed,id,modelName:'模型'+id}));
  m.view.ticks=m.view.stocks.flatMap(s=>ticks.map(t=>({...t,stockId:s.id})));
  for(const id of [1,2,3])l.owned[id]={shares:10,cost:100,manual:true,modelName:'模型'+id};
  const a=c.choose(m,config,l,now);assert.equal(a?.stockId,4);assert.equal(a.action,'buy');
});
test('预测：固定单注、独立预算、只用v2且锁盘前留一分钟，同轮不重复',()=>{
  const {m,l}=fixture();m.view.rounds=[{id:4,stockId:1,ruleVersion:2,lockAt:new Date(now+120000).toISOString(),closeAt:new Date(now+600000).toISOString(),oddsBp:180}];
  const cfg={...config,trade:false};assert.equal(c.choose(m,cfg,l,now).direction,'up');
  assert.equal(c.choose(m,cfg,l,now+61000),null);
  l.entries=[{action:'predict',roundId:4,at:now,debit:100,result:'success'}];assert.equal(c.choose(m,cfg,l,now),null);
  l.entries=[{action:'predict',roundId:3,at:now,debit:450,result:'success'}];assert.equal(c.choose(m,cfg,l,now),null);
  l.entries=[];m.view.rounds[0].ruleVersion=1;assert.equal(c.choose(m,cfg,l,now),null);
});
test('股市回执：必须绑定账号、动作和原请求，HTTP200不能单独确认',()=>{
  const p={key:'original-key',input:{expectedUserId:7,action:'buy'}};
  const r={userId:7,action:'buy',idempotencyKey:'original-key',ok:true};
  assert.equal(c.receipt(p,200,r),'success');assert.equal(c.receipt(p,200,{}),null);
  assert.equal(c.receipt(p,200,{...r,userId:8}),null);assert.equal(c.receipt(p,200,{...r,idempotencyKey:'another-key'}),null);
  assert.equal(c.receipt(p,400,{...r,executed:false,code:'balance'}),'rejected');
  assert.equal(c.receipt(p,400,{...r,executed:false,code:'idempotency_conflict'}),null);
});
