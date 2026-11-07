import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.split('// STOCK_CORE_BEGIN')[1].split('// STOCK_CORE_END')[0];
const c=vm.runInNewContext(code.slice(code.indexOf('\n'))+'\nstockCore;');
const now=Date.parse('2026-11-03T03:00:00Z');
const config={trade:true,predict:true,tradeLimit:3000,predictionLimit:500,stake:100,reserve:100};

test('卖出到账：只接受绑定成功回执的 proceedsTokens，零到账有效，不用余额或预测赔付代替',()=>{
  const p={key:'original-sale-key',input:{action:'sell',expectedUserId:7}},
    body={ok:true,userId:7,action:'sell',idempotencyKey:p.key,tradeId:123,proceedsTokens:97,balanceAfter:99999};
  assert.equal(c.saleProceeds(p,200,body),97);
  assert.equal(c.saleProceeds(p,200,{...body,proceedsTokens:0}),0);
  for(const proceedsTokens of [undefined,null,'97',-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])
    assert.equal(c.saleProceeds(p,200,{...body,proceedsTokens,payoutTokens:97}),null);
  for(const changed of [{userId:8},{idempotencyKey:'other-key'},{action:'buy'},{ok:false}])
    assert.equal(c.saleProceeds(p,200,{...body,...changed}),null);
  assert.equal(c.saleProceeds(p,503,body),null);
  assert.equal(c.saleProceeds({...p,input:{...p.input,action:'buy'}},200,{...body,action:'buy'}),null);
});

test('卖出收入：实际到账与释放成本分别保留，负盈亏与未知成本不被当作零',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(c.saleReward(97,100))),{代币:97,股市返还:97,股市卖出到账:97,股市卖出成本:100,股市已实现盈亏:-3});
  assert.deepEqual(JSON.parse(JSON.stringify(c.saleReward(97,null))),{代币:97,股市返还:97,股市卖出到账:97,股市卖出成本待核对:1});
  assert.equal(c.saleReward(null,100)['股市卖出待核对'],1);
  const totals=c.historyTotals([{action:'sell',result:'success',proceeds:97,releasedCost:null}]);
  assert.equal(totals.knownProceeds,97);assert.equal(totals.realized,0);assert.equal(totals.unknownSales,1);
});

test('手动卖出成本：按原持仓与成交后持仓核对部分出售，数量或并发不符保持未知',()=>{
  const input={action:'sell',modelName:'甲',shares:3,expectedUserId:7},entry={input,before:{stockId:1,shares:10,cost:103}},
    view={userId:7,stocks:[{id:1,modelName:'甲'}],positions:[{stockId:1,shares:7,costBasisTokens:73}]};
  assert.equal(c.incomeProof(entry,view).releasedCost,30);
  for(const p of [{shares:6,costBasisTokens:73},{shares:7,costBasisTokens:104},{shares:7,costBasisTokens:-1}])
    assert.equal(c.incomeProof(entry,{...view,positions:[{stockId:1,...p}]}),null);
  assert.equal(c.incomeProof({...entry,ambiguous:true},view),null);
  assert.equal(c.incomeProof({...entry,input:{...input,shares:10}},{...view,positions:[]}).releasedCost,103);
});
test('卖出回执诊断：只记录已绑定成功回执的字段结构，不泄露原始值或把候选金额入账',()=>{
  const p={key:'original-sale-key',input:{action:'sell',expectedUserId:7}},
    body={ok:true,userId:7,action:'sell',idempotencyKey:p.key,result:{payoutTokens:987654321,note:'private receipt text'},
      accessToken:'private-access',password:'private-password',account:{apiKey:'private-key',balance:123456789},rows:[{secret:'private-row'}]};
  const before=JSON.stringify(body),shape=c.saleReceiptShape(p,200,body),json=JSON.stringify(shape);
  assert.deepEqual(JSON.parse(json),{version:1,type:'object',fields:[
    {name:'ok',type:'boolean'},{name:'userId',type:'number'},{name:'action',type:'string'},
    {name:'result',type:'object',fields:[{name:'payoutTokens',type:'number'},{name:'note',type:'string'}]},
    {name:'account',type:'object',fields:[{name:'balance',type:'number'}],omitted:1},{name:'rows',type:'array'}],omitted:3});
  assert.doesNotMatch(json,/private|original-sale-key|987654321|123456789|idempotencyKey|accessToken|password|apiKey/);
  assert.equal(JSON.stringify(body),before);
});
test('卖出回执诊断：错账号、错原请求、未成功和其他动作都不生成成交结构证据',()=>{
  const p={key:'original-sale-key',input:{action:'sell',expectedUserId:7}},body={ok:true,userId:7,action:'sell',idempotencyKey:p.key};
  for(const changed of [{userId:8},{action:'buy'},{idempotencyKey:'other-sale-key'},{ok:false}])
    assert.equal(c.saleReceiptShape(p,200,{...body,...changed}),null);
  assert.equal(c.saleReceiptShape(p,503,body),null);assert.equal(c.saleReceiptShape(p,null,null),null);
  assert.equal(c.saleReceiptShape({...p,input:{...p.input,action:'buy'}},200,{...body,action:'buy'}),null);
});
test('卖出回执诊断：字段总数和嵌套深度有界，异常对象不影响交易确认',()=>{
  const p={key:'original-sale-key',input:{action:'sell',expectedUserId:7}},body={ok:true,userId:7,action:'sell',idempotencyKey:p.key};
  const nested={...body,result:{trade:{detail:{amount:123456789}}}};
  assert.match(JSON.stringify(c.saleReceiptShape(p,200,nested)),/truncated/);
  const many={...body,...Object.fromEntries(Array.from({length:100},(_,i)=>['field'+i,{amount:i}]))};
  const json=JSON.stringify(c.saleReceiptShape(p,200,many));assert.ok(json.length<4500);assert.match(json,/truncated/);
  Object.defineProperty(body,'result',{enumerable:true,get(){throw Error('unreadable diagnostic');}});
  assert.equal(c.saleReceiptShape(p,200,body),null);assert.equal(c.receipt(p,200,body),'success');
});
test('手动股市核心：原生输入严格区分编号、整数股数和下注金额，未知字段不接管',()=>{
  const body={idempotencyKey:'manual-stock-key',action:'buy',expectedUserId:7,modelName:'模型甲',shares:2};
  assert.ok(c.incomeInput(body));
  for(const shares of [0,-1,1.2,'2',NaN])assert.equal(c.incomeInput({...body,shares}),null);
  assert.equal(c.incomeInput({...body,extra:true}),null);assert.equal(c.incomeInput({...body,idempotencyKey:'bad'}),null);
  assert.ok(c.incomeInput({idempotencyKey:'manual-predict-key',action:'predict',expectedUserId:7,roundId:42,direction:'up',betTokens:100}));
});
test('手动股市核心：买入只核对对应持仓成本增量，不把累计成本、报价或混合交易当本次支出',()=>{
  const {v}=fixture(),input={action:'buy',expectedUserId:7,modelName:'模型甲',shares:2};
  v.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];
  const e={input,before:c.incomeBefore(v,input),ambiguous:false};
  v.positions[0]={...v.positions[0],shares:12,costBasisTokens:131};assert.equal(c.incomeProof(e,v).debit,31);
  assert.equal(c.incomeProof({...e,ambiguous:true},v),null);
  assert.equal(c.incomeProof(e,{...v,userId:8}),null);
  v.positions[0].shares=13;assert.equal(c.incomeProof(e,v),null);
  v.positions[0].shares=12;v.positions[0].costBasisTokens=99;assert.equal(c.incomeProof(e,v),null);
});
test('手动股市核心：预测排除旧下注，绑定唯一新记录后才用该笔返还核算',()=>{
  const {v}=fixture(),input={action:'predict',expectedUserId:7,roundId:42,direction:'up',betTokens:100};
  const bet={id:1,roundId:42,direction:'up',betTokens:100,settled:true,payoutTokens:180};v.myBets=[bet];
  const e={input,before:c.incomeBefore(v,input)};
  assert.equal(c.incomeProof(e,v),null);v.myBets.push({...bet,id:2,settled:false});
  assert.equal(c.incomeProof(e,v).betId,2);assert.equal(c.incomeProof(e,v).payout,undefined);
  v.myBets.push({...bet,id:3});assert.equal(c.incomeProof(e,v),null);
  e.betId=2;v.myBets[1].settled=true;v.myBets[1].payoutTokens=0;assert.equal(c.incomeProof(e,v).payout,0);
  v.myBets[1].direction='down';assert.equal(c.incomeProof(e,v),null);
});
function fixture(){const s={id:1,modelName:'模型甲',priceCents:1200,volume24h:1000};
  const v={userId:7,enabled:true,stocks:[s],positions:[],ticks:[1000,1040,1080,1120,1160,1200].map((priceCents,i)=>({stockId:1,priceCents,createdAt:new Date(now-(5-i)*300000).toISOString()})),
    rules:{buyFeePct:2,sellFeePct:2.5,maxTradeTokens:10000,maxDailyBuyTokens:10000,maxPositionTokens:10000,reserveTokens:10000},rounds:[],myBets:[]};
  return {v,m:c.model(v,{tokens:10000}),l:{owned:{},entries:[]}};}

test('股市详细诊断：逐股给出真实涨幅、含费门槛差额、样本时效和资金瓶颈，保持交易决策不变',()=>{
  const {v,m,l}=fixture(),cfg={...config,predict:false,netEfficiency:true};
  v.ticks=[1000,1010,1020,1030,1040,1050].map((priceCents,i)=>({stockId:1,priceCents,createdAt:new Date(now-(5-i)*300000).toISOString()}));v.stocks[0].priceCents=1050;
  const before=JSON.stringify({v,l,cfg}),choice=c.choose(m,cfg,l,now),d=c.decisionDiagnostics(m,cfg,l,now);
  assert.equal(choice,null);assert.equal(d.selected,null);assert.equal(d.stocks[0].modelName,'模型甲');
  assert.ok(d.stocks[0].trend.changePct>2&&d.stocks[0].trend.changePct<5.5);
  assert.equal(d.stocks[0].trend.buyThresholdPct,5.5);assert.ok(d.stocks[0].trend.gapPct>0);
  assert.equal(d.stocks[0].trend.samples,6);assert.equal(d.stocks[0].trend.quoteAgeMs,0);
  assert.ok(d.stocks[0].buy.blockers.includes('below-fee-threshold'));
  assert.ok(d.budget.constraints.some(c=>c.key==='per-stock-limit'&&c.remaining===1000));
  assert.equal(JSON.stringify({v,l,cfg}),before);
});
test('股市详细诊断：停滞标志与报价过期分别说明；已有持仓、卖后冷却、零预算和未知成本不伪称可买',()=>{
  for(const kind of ['stale-flag','expired','position','cooldown','budget','unknown']){
    const {v,m,l}=fixture(),cfg={...config,predict:false};
    if(kind==='stale-flag')v.stocks[0].stale=true;
    if(kind==='expired')for(const t of v.ticks)t.createdAt=new Date(Date.parse(t.createdAt)-11*60000).toISOString();
    if(['position','unknown'].includes(kind))v.positions=[{stockId:'1',shares:1,costBasisTokens:kind==='unknown'?null:12}];
    if(kind==='cooldown')l.entries=[{id:'sale',at:now-1000,action:'sell',stockId:'1',debit:0,result:'success'}];
    if(kind==='budget')cfg.tradeLimit=0;
    const d=c.decisionDiagnostics(m,cfg,l,now),row=d.stocks[0];
    assert.equal(row.buy.eligible,false,kind);assert.equal(c.choose(m,cfg,l,now),null,kind);
    if(kind==='stale-flag')assert.ok(row.trend.reasons.includes('website-stale'));
    if(kind==='expired')assert.ok(row.trend.reasons.includes('quote-older-than-10m'));
    if(kind==='cooldown')assert.equal(row.buy.cooldownUntil,now-1000+3600000);
    if(kind==='unknown')assert.equal(d.budget.heldCost,null);
  }
});

test('股票编号类型：同一股票已有人工持仓时，字符串与数字别名不能触发新的自动买入',()=>{
  const {v,m,l}=fixture();v.positions=[{stockId:'1',shares:10,costBasisTokens:100,holdUntil:null}];
  assert.ok(c.model(v,{tokens:10000}));
  assert.equal(c.choose(m,{...config,predict:false},l,now),null);
});

test('股市详细诊断：有效买入与预测选择保持一致，逐项记录预测轮次拒绝条件',()=>{
  const {v,m,l}=fixture(),cfg={...config,netEfficiency:true};
  const round={id:42,stockId:1,ruleVersion:2,oddsBp:180,lockAt:new Date(now+120000).toISOString(),closeAt:new Date(now+900000).toISOString()};
  for(const variant of ['valid','lock','version','duplicate','disabled','risk']){
    v.rounds=[{...round}];l.entries=[];const settings={...cfg};
    if(variant==='lock')v.rounds[0].lockAt=new Date(now+30000).toISOString();
    if(variant==='version')v.rounds[0].ruleVersion=1;
    if(variant==='duplicate')l.entries=[{action:'predict',roundId:42,at:now,debit:100,result:'success'}];
    if(variant==='disabled')settings.predict=false;
    if(variant==='risk')settings.riskLimit=0;
    const before=JSON.stringify({v,l,settings}),d=c.decisionDiagnostics(m,settings,l,now);
    assert.equal(JSON.stringify(d.selected),JSON.stringify(c.choose(m,settings,l,now)));
    assert.equal(d.rounds[0].eligible,variant==='valid');
    if(variant==='valid')assert.equal(d.selected.action,'predict');
    if(variant==='lock')assert.ok(d.rounds[0].blockers.includes('lock-within-60s'));
    if(variant==='duplicate')assert.ok(d.rounds[0].blockers.includes('already-recorded-round'));
    if(d.selected?.action==='buy')assert.equal(d.stocks[0].buy.eligible,true);
    assert.equal(JSON.stringify({v,l,settings}),before);
  }
});

test('股市详细诊断：67只长名称及12笔行情完整分片，单条含封套低于截断限制',()=>{
  const {v,m,l}=fixture();v.stocks=Array.from({length:67},(_,i)=>({...v.stocks[0],id:i+1,modelName:'模型'.repeat(80)+i}));
  v.ticks=v.stocks.flatMap(s=>Array.from({length:12},(_,i)=>({stockId:s.id,priceCents:980+i*20,createdAt:new Date(now-(11-i)*300000).toISOString()})));
  const d=c.decisionDiagnostics(m,config,l,now),parts=c.diagnosticParts(d.stocks);
  assert.ok(parts.length>1);assert.equal(parts.flat().length,67);
  for(const rows of parts)assert.ok(Buffer.byteLength(JSON.stringify({diagnosticId:'x'.repeat(36),snapshotAt:now,part:1,totalParts:parts.length,rows}))<32768);
});

test('股市详细诊断：组合条件下可买标记与原单股选择一致，拒绝原因不能替代交易规则',()=>{
  for(const priceStep of [0,1,10,40,80])for(const reserve of [0,9500,10000])for(const limit of [0,10,3000])for(const netEfficiency of [false,true]){
    const {v,m,l}=fixture(),cfg={...config,predict:false,reserve,tradeLimit:limit,netEfficiency};
    v.ticks.forEach((t,i)=>t.priceCents=1000+priceStep*i);v.stocks[0].priceCents=v.ticks.at(-1).priceCents;
    const d=c.decisionDiagnostics(m,cfg,l,now);
    assert.equal(d.stocks[0].buy.eligible,c.choose(m,cfg,l,now)?.action==='buy',JSON.stringify({priceStep,reserve,limit,netEfficiency,d}));
  }
});

test('股票编号类型：脚本持仓卖出、逐仓说明与原交易核对接受唯一别名，不丢失既有成本',()=>{
  const {v,m,l}=fixture();v.positions=[{stockId:'1',shares:10,costBasisTokens:100,holdUntil:null}];
  l.owned['1']={shares:10,cost:100,modelName:'模型甲',manual:false};
  const a=c.choose(m,{...config,predict:false},l,now);assert.equal(a?.action,'sell');assert.equal(a.shares,10);
  assert.equal(c.positionReport(m,l,now)[0].status,'sell');
  assert.equal(c.recoveryWait(m,config,l,{id:'original',beforeShares:10,choice:a},now),null);
  v.stocks[0].id='1';a.stockId=1;
  assert.equal(c.recoveryWait(m,config,l,{id:'original',beforeShares:10,choice:a},now),null);
});

test('股票编号类型：旧卖出冷却和字符串行情继续匹配，但不同拼写编号不强行合并',()=>{
  const {v,m,l}=fixture();l.entries=[{id:'sale',stockId:'1',action:'sell',at:now,result:'success',debit:0}];
  assert.equal(c.choose(m,{...config,predict:false},l,now),null);
  l.entries=[];v.ticks.forEach(t=>t.stockId='1');
  assert.equal(c.choose(m,{...config,predict:false},l,now)?.action,'buy');
  assert.equal(c.observationParts(m)[0].ticks.length,6);
  v.positions=[{stockId:'01',shares:10,costBasisTokens:100}];
  assert.equal(c.choose(m,{...config,predict:false},l,now)?.action,'buy','01 is a distinct opaque identifier');
});

test('股票编号类型：手动买入按唯一别名持仓算成本增量，重复别名或改名不能当成新持仓',()=>{
  const {v}=fixture(),input={action:'buy',expectedUserId:7,modelName:'模型甲',shares:2};
  v.positions=[{stockId:'1',shares:10,costBasisTokens:100}];
  const before=c.incomeBefore(v,input);assert.equal(before.shares,10);assert.equal(before.cost,100);
  v.positions[0]={stockId:1,shares:12,costBasisTokens:125};v.stocks[0].id='1';
  assert.equal(c.incomeProof({input,before},v).debit,25);
  v.positions.push({...v.positions[0],stockId:'1'});
  assert.equal(c.incomeBefore(v,input),null);assert.equal(c.incomeProof({input,before},v),null);
  v.positions.pop();v.stocks.push({...v.stocks[0],id:1,modelName:'编号冲突'});
  assert.equal(c.incomeBefore(v,input),null);assert.equal(c.incomeProof({input,before},v),null);
  v.stocks.pop();v.stocks[0].modelName='已改名';
  assert.equal(c.incomeBefore(v,input),null);assert.equal(c.incomeProof({input,before},v),null);
});

test('股票编号类型：原买入已出现别名持仓时，恢复核对不重复累加同一笔成本',()=>{
  const {v,m,l}=fixture(),a=c.choose(m,{...config,predict:false},l,now);
  v.positions=[{stockId:'1',shares:a.shares,costBasisTokens:a.estimate}];
  const cfg={...config,riskLimit:a.debit,positionLimit:a.debit,perStockLimit:a.debit};
  assert.equal(c.recoveryWait(m,cfg,l,{id:'original',beforeShares:0,choice:a},now),null);
  v.positions[0].shares++;assert.match(c.recoveryWait(m,cfg,l,{id:'original',beforeShares:0,choice:a},now),/持仓数量/);
});

test('股票编号类型：预测按股票别名找到轮次，但轮次和账号仍精确绑定',()=>{
  const {v,m,l}=fixture();v.rounds=[{id:42,stockId:'1',ruleVersion:2,oddsBp:180,
    lockAt:new Date(now+240000).toISOString(),closeAt:new Date(now+900000).toISOString()}];
  const cfg={...config,trade:false},a=c.choose(m,cfg,l,now);
  assert.equal(a.action,'predict');assert.equal(a.roundId,42);
  const input=c.input(a,7);assert.equal(c.same(input,{...input,roundId:'42'}),false);
  assert.equal(c.incomeBefore({...v,userId:'7'},input),null);
  v.myBets=[{id:1,roundId:42}];assert.equal(c.choose(m,cfg,l,now),null);
});

test('股市独立额度：周转、总仓位、单股、现金保留和总风险分别生效',()=>{
  const {m,l}=fixture(),cfg={...config,predict:false,tradeLimit:6000,positionLimit:2000,perStockLimit:400,riskLimit:1500,cashReserve:9500};
  const f=c.funding(m,cfg);assert.equal(f.tradeLimit,6000);assert.equal(f.positionLimit,1500);assert.equal(f.perStockLimit,400);assert.equal(f.reserve,9500);
  const a=c.choose(m,cfg,l,now);assert.ok(a&&a.debit<=400);
  assert.equal(c.choose(m,{...cfg,perStockLimit:0},l,now),null);
  assert.equal(c.choose(m,{...cfg,cashReserve:10000},l,now),null);
  m.balance=100000;m.rules.maxDailyBuyTokens=100000;m.rules.maxPositionTokens=100000;
  const auto=c.funding(m,{...cfg,autoBudget:true,riskLimit:1200,positionLimit:2000,cashReserve:0});
  assert.equal(auto.positionLimit,1200);assert.ok(auto.perStockLimit<=400);
});

test('股市独立预算：未设置总风险时人工仓成本未知不阻断固定预算预测，原请求核对口径一致',()=>{
  const {v,m,l}=fixture(),cfg={...config,trade:false,predict:true};
  v.rounds=[{id:42,stockId:1,ruleVersion:2,oddsBp:180,lockAt:new Date(now+240000).toISOString(),closeAt:new Date(now+900000).toISOString()}];
  const a=c.choose(m,cfg,l,now);assert.equal(a.action,'predict');
  const p={id:'original',choice:a,reserveFloor:100};
  v.positions=[{stockId:2,shares:10,costBasisTokens:null}];
  assert.equal(c.recoveryWait(m,cfg,l,p,now),null);
  for(const riskLimit of [undefined,null]){
    const next=c.choose(m,{...cfg,riskLimit},l,now);assert.equal(next?.action,'predict');assert.equal(next.betTokens,100);
  }
  assert.equal(c.choose(m,{...cfg,trade:true,predict:false},l,now),null,'buying still requires known portfolio cost');
  assert.equal(c.choose(m,{...cfg,autoBudget:true},l,now),null,'automatic allocation cannot be inferred from unknown assets');
  assert.equal(c.choose(m,{...cfg,riskLimit:500},l,now),null,'an explicit total-risk cap still needs complete cost evidence');
  assert.match(c.waitReason(m,{...cfg,riskLimit:500},l,now),/总风险.*无法核对/);
  assert.match(c.recoveryWait(m,{...cfg,riskLimit:500},l,p,now),/总风险/);
  m.balance=199;assert.equal(c.choose(m,cfg,l,now),null,'cash reserve and stake remain binding');
});

test('股市风险等待：总风险尚未到顶但不足一注时解释本金缺口，额度恰好一注才可下注',()=>{
  const {v,m,l}=fixture(),cfg={...config,trade:false,predict:true,riskLimit:500};
  v.rounds=[{id:42,stockId:1,ruleVersion:2,oddsBp:180,lockAt:new Date(now+240000).toISOString(),closeAt:new Date(now+900000).toISOString()}];
  v.positions=[{stockId:2,shares:10,costBasisTokens:401}];
  assert.equal(c.choose(m,cfg,l,now),null);
  assert.match(c.waitReason(m,cfg,l,now),/总风险.*99.*固定单注.*100/);
  v.positions[0].costBasisTokens=400;assert.equal(c.choose(m,cfg,l,now)?.action,'predict');
  l.entries=[{id:'unsettled',action:'predict',result:'success',at:now-2*86400000,debit:100}];
  assert.equal(c.choose(m,cfg,l,now),null,'unsettled prediction still occupies risk after the daily budget window');
  assert.match(c.waitReason(m,cfg,l,now),/总风险本金已到上限/);
  l.entries[0].settlement={payout:0,at:now};assert.equal(c.choose(m,cfg,l,now)?.action,'predict');
});

test('股市盈亏：实际成本与卖出未知到账分开，不能把报价当已实现收入',()=>{
  const {m,l}=fixture();m.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];
  l.owned={'1':{shares:10,cost:100,modelName:'模型甲',manual:false}};
  l.entries=[{id:'buy',at:now,action:'buy',result:'success',debit:100},
    {id:'sell',at:now,action:'sell',result:'success',debit:0,releasedCost:50,proceeds:null}];
  const p=c.performance(m,l,now);assert.equal(p.buyCost,100);assert.equal(p.unknownSales,1);assert.equal(p.realized,0);
  assert.equal(p.unrealized,17);assert.equal(p.heldCost,100);
  assert.match(c.riskReason(m,{lossLimit:100},l,now),/卖出到账.*未知/);
});

test('股市亏损保护：达到净亏损上限停止新增风险，仍允许管理原持仓',()=>{
  const {m,l}=fixture();m.view.positions=[{stockId:1,shares:10,costBasisTokens:200,holdUntil:null}];
  l.owned={'1':{shares:10,cost:200,modelName:'模型甲',manual:false}};
  const cfg={...config,predict:false,lossLimit:50};assert.match(c.riskReason(m,cfg,l,now),/亏损/);
  assert.equal(c.choose(m,cfg,l,now)?.action,'sell');
  m.view.positions[0].holdUntil=new Date(now+3600000).toISOString();assert.equal(c.choose(m,cfg,l,now),null);
});

test('逐仓说明：明确持有期、未触发退出、系统储备限制及可卖数量，金额只是报价估算',()=>{
  const {v,m,l}=fixture();v.stocks[0].priceCents=1000;v.ticks=[];
  v.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:new Date(now+3600000).toISOString()}];
  l.owned={'1':{shares:10,cost:100,modelName:'模型甲',manual:false}};
  let row=c.positionReport(m,l,now)[0];assert.equal(row.status,'locked');assert.equal(row.estimatedNet,97);
  assert.equal(row.unrealized,-3);assert.match(row.reason,/持有期/);
  v.positions[0].holdUntil=null;row=c.positionReport(m,l,now)[0];assert.equal(row.status,'holding');
  v.stocks[0].priceCents=1200;v.rules.reserveTokens=0;
  row=c.positionReport(m,l,now)[0];assert.equal(row.status,'liquidity');assert.match(row.reason,/储备/);
  v.rules.reserveTokens=60;row=c.positionReport(m,l,now)[0];assert.equal(row.status,'sell');assert.equal(row.sellShares,5);
  assert.equal(row.estimatedNet,117);assert.equal(row.estimatedSaleNet,58);
  assert.equal(c.choose(m,{...config,predict:false},l,now).shares,row.sellShares);
});

test('逐仓说明：手动持仓排除、账本不一致和停牌不冒充可卖或已实现收入',()=>{
  const {v,m,l}=fixture();v.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];
  l.owned={'1':{shares:10,cost:100,modelName:'模型甲',manual:true}};
  assert.equal(c.positionReport(m,l,now).length,0);l.owned['1'].manual=false;
  v.positions[0].shares=11;let row=c.positionReport(m,l,now)[0];assert.equal(row.status,'unconfirmed');assert.equal(row.estimatedNet,null);
  v.positions[0].shares=10;v.stocks[0].suspended=true;row=c.positionReport(m,l,now)[0];
  assert.equal(row.status,'unavailable');assert.equal(row.unrealized,null);
  v.stocks[0].suspended=false;row=c.positionReport(m,l,now)[0];assert.equal(row.status,'sell');assert.equal(row.unrealized,17);
});

test('观察行情分片：67只模型保留每只最近12点和决策字段，不超过单条日志预算',()=>{
  const {v}=fixture();v.stocks=Array.from({length:67},(_,i)=>({id:i+1,modelName:'模型'.repeat(80)+i,priceCents:1200,volume24h:1000}));
  v.ticks=v.stocks.flatMap(s=>Array.from({length:24},(_,i)=>({stockId:s.id,priceCents:900+i*13,
    createdAt:new Date(now-(23-i)*300000).toISOString(),unneeded:'secret-must-not-be-copied'})));
  const m=c.model(v,{tokens:10000}),parts=c.observationParts(m);
  assert.ok(parts.length>1);assert.equal(parts.flatMap(p=>p.stocks).length,67);assert.equal(parts.flatMap(p=>p.ticks).length,67*12);
  for(const part of parts){assert.ok(Buffer.byteLength(JSON.stringify(part))<24000);assert.ok(!JSON.stringify(part).includes('secret-must-not-be-copied'));}
  const restored={...v,stocks:parts.flatMap(p=>p.stocks),ticks:parts.flatMap(p=>p.ticks)};
  for(const s of v.stocks)assert.deepEqual(c.trend(restored,s,now),c.trend(v,s,now));
});
test('股市总风险核对：原买入已反映在持仓时不重复计本金，单股限制仍约束原请求',()=>{
  const {m,l}=fixture(),p={id:'pending',beforeShares:0,choice:{action:'buy',stockId:1,modelName:'模型甲',shares:70,debit:900}};
  l.entries=[{id:p.id,action:'buy',at:now,debit:900,result:'reserved'}];
  m.view.positions=[{stockId:1,shares:70,costBasisTokens:900}];
  assert.equal(c.recoveryWait(m,{...config,riskLimit:900,perStockLimit:900},l,p,now),null);
  assert.match(c.recoveryWait(m,{...config,riskLimit:900,perStockLimit:800},l,p,now),/单股/);
  assert.equal(c.choose(m,{...config,predict:true,riskLimit:900},l,now),null);
});

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
