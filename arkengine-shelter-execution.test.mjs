import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';
import {readyCampaignConstructionScene,growthInvestmentScene} from './arkengine-shelter-growth-investment.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function setup(fixture=readyCampaignConstructionScene()){
  const {api,context:c,f}=setupPowerInvestment(source,fixture);
  let local=f.view.serverTime;
  Object.assign(c,{structuredClone,claimPageId:'execution-page',shelterEnabled:true,shelterPopulationContinuous:false,shelterExploreManualUntil:0,
    shelterExecutionDeferrals:new Map(),
    Date:class extends Date{static now(){return local;}}});
  const api2=vm.runInContext(source.slice(source.indexOf('  function shelterExecutionFacts('),source.indexOf('  function shelterWorkStep('))+
    '\n({capture:shelterExecutionCapture,current:shelterExecutionCurrent,defer:shelterExecutionDefer,deferred:shelterExecutionDeferred,recheck:shelterRecheckExpiredWork})',c);
  const model=()=>{const m=api.model(f.view);c.shelterRead={model:m,at:local};return m;};
  const choice={kind:'upgrade',id:4,type:'scrap',level:2,cost:{scrap:400,parts:0},priority:1};
  const capture=(selected=choice)=>{
    // A healing proposal is only admitted for an injured resident.
    if(selected.kind==='stimpak')f.view.state.residents.find(p=>p.id===selected.id).hp=30;
    const m=model();return {project:selected,execution:api2.capture(m,selected,['craft','stimpak','explore-start','quest-start'].includes(selected.kind)?selected:null)};
  };
  const advance=ms=>{local+=ms;f.view.serverTime+=ms;};
  return {c,f,api:api2,native:api,model,capture,advance,local:ms=>local+=ms};
}

function completedReturn(){
  const x=setup(),p=x.f.view.state.residents.find(p=>p.id===5);
  Object.assign(p,{roomId:90,training:0});p.stats.end=2;
  x.c.shelterState.campaign.roles=[{id:5,room:90,role:'training',purpose:'production',stat:'end',base:1,
    at:x.f.view.serverTime-3600000,until:x.f.view.serverTime+603000,windowEnd:x.f.view.serverTime+86400000,destination:4}];
  return {...x,returnChoice:{kind:'assign',id:5,room:4,from:90,role:'training-release'}};
}
test('完成返岗期限修复：不受原训练减十分钟、他人冷却或正常结算取消，保持固定目标',()=>{
  const x=completedReturn();x.f.view.state.lastSettledAt=x.f.view.serverTime-590000;
  x.f.view.state.residents[0].familyCooldownUntil=x.f.view.serverTime+605000;
  const w=x.capture(x.returnChoice),saved=structuredClone(w.execution.choice);
  x.advance(11000);x.f.view.state.lastSettledAt=x.f.view.serverTime;
  assert.equal(x.api.current(x.model(),w),w.execution);
  assert.deepEqual(structuredClone(w.execution.choice),saved);
});
test('完成返岗期限修复：岗位占用、属性回退、供给下降、人工操作和未知原单仍撤销',()=>{
  for(const change of ['occupancy','stats','supply','manual','pending','clock']){
    const x=completedReturn(),w=x.capture(x.returnChoice);x.advance(4000);
    if(change==='occupancy')x.f.view.state.residents[0].roomId=4;
    if(change==='stats')x.f.view.state.residents.find(p=>p.id===5).stats.end=1;
    if(change==='supply')x.f.view.state.resources.food--;
    if(change==='manual')x.c.shelterExploreManualUntil=x.f.view.serverTime+60000;
    if(change==='pending')x.c.shelterPending={id:'unknown'};
    if(change==='clock')x.f.view.state.lastSettledAt--;
    assert.equal(x.api.current(x.model(),w),null,change);
  }
});

test('完成返岗独立复核：他人练完一格及日常计数增长不撤销固定生产岗',()=>{
  const context=completedReturn(),other=context.f.view.state.residents.find(person=>person.id!==5);
  other.training=.99;
  context.f.view.state.ticks=100;context.f.view.state.radioProgress=.1;
  context.f.view.state.daily.counters={train:1};
  const work=context.capture(context.returnChoice),original=structuredClone(work.execution.choice);
  context.advance(7000);other.stats.agi++;other.training=0;
  context.f.view.state.ticks++;context.f.view.state.radioProgress=.2;
  context.f.view.state.daily.counters.train++;context.f.view.state.season.points++;
  assert.equal(context.api.current(context.model(),work),work.execution);
  assert.deepEqual(structuredClone(work.execution.choice),original);
});
test('v136训练确认：他人按属性结算不撤销固定返岗，本人当前90%仍保护',()=>{
  const context=completedReturn(),other=context.f.view.state.residents.find(person=>person.id!==5);
  Object.assign(other,{trainingStat:'agi',training:.99,trainingByStat:{agi:.99,end:.4}});
  const work=context.capture(context.returnChoice);
  other.stats.agi++;other.training=0;other.trainingByStat.agi=0;
  assert.equal(context.api.current(context.model(),work),work.execution);
  context.c.shelterCampaign.training=true;
  const person=context.f.view.state.residents.find(person=>person.id===5);
  Object.assign(person,{trainingStat:'agi',training:0,trainingByStat:{end:.9,agi:0}});
  context.c.shelterState.campaign.roles[0].finishCurrent=true;
  const protectedWork=context.capture(context.returnChoice);
  assert.equal(context.api.current(context.model(),protectedWork),null);
  assert.equal(protectedWork.executionFailure.reason,'training-in-progress');
});
test('v136训练确认：属性进度连续增长可交接，回退或未知属性变化仍撤销',()=>{
  for(const change of ['increase','decrease','unknown']){
    const context=setup(),person=context.f.view.state.residents[0];
    Object.assign(person,{trainingStat:'agi',training:.5,trainingByStat:{agi:.5,end:.2}});
    const work=context.capture({kind:'explore-start',id:5,targets:[5,0,2]});
    if(change==='increase'){person.training=.6;person.trainingByStat.agi=.6;}
    if(change==='decrease')person.trainingByStat.end=.1;
    if(change==='unknown')person.trainingByStat.unknown=.5;
    assert.equal(context.api.current(context.model(),work),change==='increase'?work.execution:null,change);
  }
});

for(const field of ['stat','health','room','equipment','counter','unknown'])test('完成返岗独立复核：'+field+'安全条件变化仍撤销',()=>{
  const context=completedReturn(),other=context.f.view.state.residents.find(person=>person.id!==5);
  context.f.view.state.daily.counters={train:2};
  const work=context.capture(context.returnChoice);context.advance(7000);
  if(field==='stat')other.stats.agi--;
  if(field==='health')other.hp--;
  if(field==='room')other.roomId=4;
  if(field==='equipment')other.weaponId=10000;
  if(field==='counter')context.f.view.state.daily.counters.train--;
  if(field==='unknown')context.f.view.state.unknownActionConstraint=true;
  assert.equal(context.api.current(context.model(),work),null);
});

test('跨格训练保护：返岗最终确认发现当前格已到90%则撤销旧动作',()=>{
  const context=completedReturn();context.c.shelterCampaign.training=true;
  context.c.shelterState.campaign.roles[0].finishCurrent=true;
  const work=context.capture(context.returnChoice);
  context.advance(4000);context.f.view.state.residents.find(person=>person.id===5).training=.9;
  assert.equal(context.api.current(context.model(),work),null);
  assert.equal(work.executionFailure.reason,'training-in-progress');
});

test('训练室升级保护：旧返岗意图在最终确认遇到90%升级训练必须撤销',()=>{
  const context=completedReturn();context.c.shelterCampaign.training=true;
  const person=context.f.view.state.residents.find(person=>person.id===5),room=context.f.view.state.rooms.find(room=>room.id===90);
  const role=context.c.shelterState.campaign.roles[0];
  Object.assign(role,{base:person.stats.end,finishCurrent:true,until:context.f.view.serverTime+3600000});
  person.training=.9;room.upgradeAt=context.f.view.serverTime+3*3600000;
  const work=context.capture(context.returnChoice);
  assert.equal(context.api.current(context.model(),work),null);
  assert.equal(work.executionFailure.reason,'training-in-progress');
});

test('手动训练最终确认：没有自动用途记录的零进度或25%训练不能被旧离岗意图发送',()=>{
  for(const progress of [0,.25]){
    const context=completedReturn();context.c.shelterCampaign.training=true;context.c.shelterState.campaign.roles=[];
    const person=context.f.view.state.residents.find(person=>person.id===5),room=context.f.view.state.rooms.find(room=>room.id===90);
    room.trainStat='int';room.level=3;person.stats.int=7;person.training=progress;
    const work=context.capture(context.returnChoice);
    assert.equal(context.api.current(context.model(),work),null);
    assert.equal(work.executionFailure.reason,'training-in-progress');
  }
});

test('训练连续生命周期：旧返岗确认遇到已保存的当前90%训练也必须撤销',()=>{
  const context=completedReturn();context.c.shelterCampaign.training=true;
  const person=context.f.view.state.residents.find(entry=>entry.id===5),role=context.c.shelterState.campaign.roles[0];
  Object.assign(role,{base:person.stats.end,finishCurrent:true,until:context.f.view.serverTime+3600000});
  const work=context.capture(context.returnChoice);context.advance(4000);person.training=.9;
  assert.equal(context.api.current(context.model(),work),null);
  assert.equal(work.executionFailure.reason,'training-in-progress');
  assert.equal(context.c.shelterState.campaign.roles[0].until,role.until);
});

test('等级工程交接：保留实际完整路线依据，正常产出增长后仍可确认原工程',()=>{
  const x=setup(growthInvestmentScene());x.c.shelterPopulationTarget=7;x.c.shelterLevelTarget=5;
  x.c.shelterConstruction.scrapLimit=200;
  const m=x.model(),project=x.native.construction(m);
  assert.equal(project.type,'storage');assert.equal(project.levelInvestment,true);
  assert.ok(project.levelDecision?.cost.scrap>=project.cost.scrap);
  const w=x.capture(project),deadline=w.execution.deadline;
  for(const k of ['scrap','parts','power','food','water'])x.f.view.state.resources[k]+=.001;
  for(const r of x.f.view.state.rooms)r.stored+=.001;
  for(const p of x.f.view.state.residents)p.xp+=.001;
  x.advance(1000);
  assert.equal(x.api.current(x.model(),w),w.execution);
  assert.equal(w.execution.deadline,deadline);
});

test('三天工程交接：增产路线不会因普通产出增长撤销或延长期限',()=>{
  const x=setup(growthInvestmentScene());x.c.shelterPopulationTarget=7;x.c.shelterLevelTarget=5;
  const project=x.native.construction(x.model());assert.equal(project.type,'scrap');assert.equal(project.id,4);
  const w=x.capture(project),deadline=w.execution.deadline;
  for(const k of ['scrap','parts','power','food','water'])x.f.view.state.resources[k]+=.001;
  for(const r of x.f.view.state.rooms)r.stored+=.001;
  for(const p of x.f.view.state.residents)p.xp+=.001;
  x.advance(1000);assert.equal(x.api.current(x.model(),w),w.execution);assert.equal(w.execution.deadline,deadline);
});

test('等级工程交接：预算、资源、人员、施工条件变化仍阻止原投资',()=>{
  for(const change of [x=>x.f.view.state.resources.scrap--,x=>x.c.shelterConstruction.scrapLimit=0,
    x=>x.f.view.state.residents[0].roomId=4,x=>x.f.view.state.rooms.find(r=>r.id===100).upgradeAt=x.f.view.serverTime+3600000,
    x=>x.c.shelterPopulationTarget=100,x=>x.f.view.state.residents[0].hp--]){
    const x=setup(growthInvestmentScene());x.c.shelterPopulationTarget=7;x.c.shelterLevelTarget=5;
    const w=x.capture(x.native.construction(x.model()));change(x);
    assert.equal(x.api.current(x.model(),w),null);assert.ok(w.executionFailure.fields.length);
  }
});

test('等级工程交接：缺少完整路线依据或仍有库存需求的仓库保持严格复核',()=>{
  for(const variant of ['no-decision','no-purpose','capacity']){
    const x=setup(growthInvestmentScene());x.c.shelterPopulationTarget=7;x.c.shelterLevelTarget=5;
    x.c.shelterConstruction.scrapLimit=200;
    const p=x.native.construction(x.model());
    assert.equal(p.type,'storage');
    if(variant==='no-decision')delete p.levelDecision;
    if(variant==='no-purpose')delete p.levelInvestment;
    if(variant==='capacity')p.storageDemand={resources:['scrap']};
    const w=x.capture(p);x.f.view.state.resources.scrap++;
    assert.equal(x.api.current(x.model(),w),null,variant);
  }
});

test('执行依据：只增加服务器时间的新读取可复核，原请求记录不增加凭据',()=>{
  const x=setup(),original=JSON.stringify(x.c.shelterState),w=x.capture();x.advance(1000);
  assert.ok(x.api.current(x.model(),w));assert.equal(JSON.stringify(x.c.shelterState),original);assert.equal(x.c.shelterPending,null);
});

test('执行依据：对象字段顺序变化不撤销训练返岗，真实变化仍撤销',()=>{
  const x=setup(),w=x.capture({kind:'assign',id:5,from:90,room:null});
  const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?
    Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
  x.f.view=reorder(x.f.view);x.c.shelterState=reorder(x.c.shelterState);
  assert.equal(x.api.current(x.model(),w),w.execution);
  x.f.view.state.residents[0].stats.cha++;
  assert.equal(x.api.current(x.model(),w),null);
  assert.ok(w.executionFailure.fields.some(p=>p.endsWith('stats.cha')));
});

for(const key of ['note','advice','development','operations','populationAdvice','populationEvaluation',
  'campaignNote','constructionNote','exploreNote'])test('执行依据展示隔离：'+key+'更新不撤销原调岗或延长期限',()=>{
  const x=setup(),w=x.capture({kind:'assign',id:5,from:90,room:null}),before=structuredClone(w.execution);
  x.c.shelterState[key]=key==='populationEvaluation'?{at:x.f.view.serverTime,mode:'population',target:14,note:'检查完成'}:'检查已更新';
  x.advance(1000);
  assert.equal(x.api.current(x.model(),w),w.execution);
  assert.deepEqual(structuredClone(w.execution),before);
});

for(const [key,value] of Object.entries({pair:{a:6,b:7,room:5,step:1},nextAt:12345,
  constructionLedger:[{id:'other',at:1,scrap:1,parts:0}],unknownExecutionConstraint:true}))
test('执行依据展示隔离：'+key+'仍是实际条件，变化后撤销',()=>{
  const x=setup(),w=x.capture({kind:'assign',id:5,from:90,room:null});
  x.c.shelterState[key]=value;
  assert.equal(x.api.current(x.model(),w),null);
  assert.ok(w.executionFailure.fields.some(p=>p.startsWith('1.'+key)));
});

test('执行依据：已发送动作的正常收尾不再记作首次失效',()=>{
  const x=setup(),events=[];x.c.log={add:(type,detail,data)=>events.push({type,data})};
  const w=x.capture();w.submitted=true;
  assert.equal(x.api.current(x.model(),w),null);
  assert.equal(w.executionFailure.reason,'operation-ended');
  assert.equal(events.length,0);
  const changed=x.capture();x.f.view.state.residents[0].hp--;
  assert.equal(x.api.current(x.model(),changed),null);
  assert.equal(events.length,1);assert.equal(events[0].type,'shelter-execution-evidence');
  const cancelled=x.capture();cancelled.submitted=true;cancelled.cancelReason='fixture actual cancellation';
  assert.equal(x.api.current(x.model(),cancelled),null);
  assert.equal(events.length,2,'an explicit cancellation must retain its evidence');
});
for(const [name,change] of Object.entries({
  resources:x=>x.f.view.state.resources.food--,
  roster:x=>x.f.view.state.residents[0].hp--,
  room:x=>x.f.view.state.rooms[0].unpowered=true,
  obligations:x=>x.c.shelterState.campaign.roles.push({id:5,room:90,role:'training'}),
  policy:x=>x.c.shelterConstruction.scrapLimit=0,
  pending:x=>x.c.shelterPending={id:'unknown'},
  manual:x=>x.c.shelterExploreManualUntil=x.f.view.serverTime+60000,
  disabled:x=>x.c.shelterEnabled=false,
  serverRollback:x=>x.f.view.serverTime--,
  localRollback:x=>x.local(-1)
}))test('执行依据变更撤销：'+name,()=>{
  const x=setup(),w=x.capture();change(x);assert.equal(x.api.current(x.model(),w),null);
});
for(const [name,prepare] of Object.entries({
  adulthood:x=>x.f.view.state.residents[0].adultAt=x.f.view.serverTime+5000,
  cooldown:x=>x.f.view.state.residents[0].familyCooldownUntil=x.f.view.serverTime+5000,
  cooldownBuffer:x=>x.f.view.state.residents[0].familyCooldownUntil=x.f.view.serverTime+605000,
  settlement:x=>x.f.view.state.lastSettledAt=x.f.view.serverTime-595000,
  event:x=>x.f.view.env.events=[{kind:'production',startsAt:x.f.view.serverTime+5000,endsAt:x.f.view.serverTime+3600000,percent:20}],
  training:x=>x.c.shelterState.campaign.roles=[{id:5,room:90,role:'training',until:x.f.view.serverTime+5000}],
  healing:x=>x.c.shelterState.campaign.heals=[{id:5,at:x.f.view.serverTime-1795000}],
  budget:x=>{x.c.shelterConstruction.scrapLimit=401;x.c.shelterState.constructionLedger=[{id:'old',at:x.f.view.serverTime-86395000,scrap:1,parts:0}];},
  midnight:x=>{x.f.view.serverTime=86400000-8*3600000-5000;x.f.view.state.lastSettledAt=x.f.view.serverTime;}
}))test('时间边界：'+name+'前可用，到界重新选动作',()=>{
  const x=setup();prepare(x);const w=x.capture();x.advance(4999);assert.ok(x.api.current(x.model(),w));
  x.advance(1);assert.equal(x.api.current(x.model(),w),null);
});
test('复核考虑读取后的本地耗时，不让旧serverTime延长有效期',()=>{
  const x=setup();x.f.view.state.residents[0].adultAt=x.f.view.serverTime+5000;
  const w=x.capture(),m=x.model();x.local(5000);assert.equal(x.api.current(m,w),null);
});

test('最终确认复用真实业务边界，只允许本页同一未发送准备通过pending门槛',()=>{
  const x=setup(),choice={kind:'assign',id:5,room:5,from:4,targets:[5,5]};
  x.f.view.state.residents[0].adultAt=x.f.view.serverTime+30000;
  const w=x.capture(choice);
  w.submitted=true;
  const p={id:'prepared',kind:'assign',targets:[5,5],lifecycle:{phase:'prepared',page:'execution-page'}};
  x.c.shelterPending=p;
  assert.equal(x.api.current(x.model(),w),null);
  assert.equal(x.api.current(x.model(),w,p),w.execution);
  p.lifecycle.phase='request-bound';assert.equal(x.api.current(x.model(),w,p),null);
  p.lifecycle.phase='prepared';p.lifecycle.page='other-page';assert.equal(x.api.current(x.model(),w,p),null);
  p.lifecycle.page='execution-page';x.advance(30000);assert.equal(x.api.current(x.model(),w,p),null);
});
test('供给增长保留当前动作及原期限，任何下降仍须重新规划',()=>{
  const x=setup(),w=x.capture(),deadline=w.execution.deadline;
  for(let i=0;i<5;i++){
    for(const k of ['power','food','water'])x.f.view.state.resources[k]+=.001;
    x.advance(1000);assert.equal(x.api.current(x.model(),w),w.execution);
    assert.equal(w.execution.deadline,deadline);
  }
  x.f.view.state.resources.water=w.execution.supply.water-.001;
  assert.equal(x.api.current(x.model(),w),null);
});
for(const choice of [
  {kind:'stimpak',id:5,targets:[5]},
  {kind:'assign',id:5,room:4,from:90,role:'training-release'},
  {kind:'equip',id:6,item:80},
  {kind:'explore-start',id:5,targets:[5,0,2]},
  {kind:'quest-start',targets:['w1',4,5,6]}
])test('固定居民操作：'+choice.kind+'接受物资增加但保持原目标和期限',()=>{
  const x=setup();
  if(choice.role==='training-release'){
    Object.assign(x.f.view.state.residents.find(p=>p.id===5),{roomId:90});
    x.c.shelterState.campaign.roles=[{id:5,room:90,role:'training',stat:'end',base:0}];
  }
  const w=x.capture(choice),saved=structuredClone(w.execution);
  for(let i=0;i<3;i++){
    for(const key of ['power','food','water','scrap','parts','stimpak'])x.f.view.state.resources[key]+=1;
    x.advance(1000);assert.equal(x.api.current(x.model(),w),w.execution);
  }
  assert.deepEqual(structuredClone(w.execution),saved,'复核不重设目标、用量、点击或业务截止时间');
});

test('固定居民操作：废料零件治疗针下降仍撤销，未知资源保持精确',()=>{
  for(const key of ['scrap','parts','stimpak','unknown']){
    const x=setup();x.f.view.state.resources[key]=10;
    const w=x.capture({kind:'explore-start',id:5,targets:[5,0,2]});
    x.f.view.state.resources[key]+=key==='unknown'?1:-1;
    assert.equal(x.api.current(x.model(),w),null,key);
    assert.ok(w.executionFailure.fields.some(p=>p.endsWith('resources.'+key)),key);
  }
});

test('物资敏感操作：备料补岗、训练装备和制作目标仍按原库存重评',()=>{
  for(const choice of [
    {kind:'assign',id:5,room:4,from:90,role:'workshop'},
    {kind:'assign',id:5,room:4,from:90,role:'training-release'},
    {kind:'assign',id:5,room:4,from:90,role:'training-release',materials:{id:4}},
    {kind:'equip',id:6,item:80,strategy:'reserve'},
    {kind:'equip',id:6,item:80,storageDemand:{resources:['parts']}},
    {kind:'equip',id:5,item:80},
    {kind:'craft',id:4,targets:[4,0],cost:{scrap:80,parts:0}}
  ]){
    const x=setup();x.f.view.state.residents.find(p=>p.id===5).roomId=90;
    if(choice.role==='training-release')x.c.shelterState.campaign.roles=[{id:5,room:90,role:'training',stat:'end',base:choice.materials?0:1}];
    const w=x.capture(choice);x.f.view.state.resources.parts++;
    assert.equal(x.api.current(x.model(),w),null,JSON.stringify(choice));
  }
});

test('普通建设：物资与正常生产进度增长保留原项目和期限',()=>{
  const x=setup(),w=x.capture(),deadline=w.execution.deadline;
  for(const key of ['scrap','parts','stimpak'])x.f.view.state.resources[key]++;
  x.f.view.state.rooms[0].stored+=.001;
  x.f.view.state.residents[0].xp=.001;
  x.f.view.state.residents[0].training=.001;
  x.f.view.lastReadAt=x.f.view.serverTime;
  x.advance(1000);
  assert.equal(x.api.current(x.model(),w),w.execution);
  assert.equal(w.execution.deadline,deadline);
});

test('下挖仅为普通生产腾位置时接受存量增长，特殊或未知用途保持严格',()=>{
  for(const type of ['power','diner','water','scrap','storage','training','medbay',undefined]){
    const x=setup(),choice={kind:'dig',type:'elevator',floor:4,cost:{scrap:240,parts:0},purpose:type?{type,gain:10}:undefined};
    const w=x.capture(choice),ordinary=['power','diner','water','scrap'].includes(type);
    assert.equal(Boolean(w.execution.construction),ordinary);
    x.f.view.state.rooms[0].stored+=.001;
    assert.equal(x.api.current(x.model(),w),ordinary?w.execution:null);
  }
});
test('普通建设：库存、健康和房间产物下降仍取消，给出明确原因',()=>{
  for(const key of ['scrap','parts','stimpak']){
    const x=setup(),w=x.capture();x.f.view.state.resources[key]--;
    assert.equal(x.api.current(x.model(),w),null,key);
    assert.equal(w.executionFailure.reason,'construction-safety-bound');
    assert.ok(w.executionFailure.fields.includes('resources.'+key));
  }
  const x=setup();x.f.view.state.rooms[0].stored=1;const w=x.capture();x.f.view.state.rooms[0].stored=0;
  assert.equal(x.api.current(x.model(),w),null);
  assert.ok(w.executionFailure.fields.includes('rooms.1.stored'));
});
test('普通建设：真实施工名额、预留人手、身份和规则变化均重新规划',()=>{
  for(const change of [
    x=>x.f.view.state.rooms.push({...x.f.view.state.rooms[0],id:901,builtAt:x.f.view.serverTime+3600000}),
    x=>x.f.view.state.residents[4].roomId=90,
    x=>x.f.view.state.residents[4].hp=20,
    x=>x.f.view.state.residents[4].name='另一个人',
    x=>x.f.view.state.residents[4].happiness=40,
    x=>x.f.view.state.residents[4].stats.end++,
    x=>x.f.view.state.rooms[0].incident={kind:'fire'},
    x=>x.f.view.state.rooms[3].width=3,
    x=>x.f.view.switches.frozen=true,
    x=>x.f.view.env.events=[{kind:'production',startsAt:x.f.view.serverTime-1000,endsAt:x.f.view.serverTime+3600000,percent:-20}]
  ]){
    const x=setup(),w=x.capture();change(x);
    assert.equal(x.api.current(x.model(),w),null);
    assert.ok(w.executionFailure.reason);
    assert.ok(w.executionFailure.fields.length);
  }
});
test('物资增长不放宽训练、仓库用途、特殊策略或未知资源',()=>{
  for(const choice of [
    {kind:'upgrade',id:4,type:'storage',level:2,cost:{scrap:400,parts:0}},
    {kind:'build',type:'medbay',floor:3,col:3,cost:{scrap:300,parts:0}},
    {kind:'upgrade',id:4,type:'scrap',level:2,cost:{scrap:400,parts:0},strategy:{person:5}},
    {kind:'assign',id:5,room:90,from:4}
  ]){
    const x=setup(),w=x.capture(choice);x.f.view.state.resources.scrap++;
    assert.equal(x.api.current(x.model(),w),null);
  }
  for(const key of ['unknown']){
    const x=setup(),w=x.capture();x.f.view.state.resources[key]=(x.f.view.state.resources[key]||0)+1;
    assert.equal(x.api.current(x.model(),w),null,key);
  }
});
test('训练收益上限及仓库储备需求仍按完整库存重新核对',()=>{
  for(const choice of [{kind:'assign',id:5,room:90,from:4},{kind:'upgrade',id:4,type:'scrap',level:2,cost:{scrap:400,parts:0},storageDemand:{resources:['water']}}]){
    const x=setup(),w=x.capture(choice);assert.ok(x.api.current(x.model(),w));
    x.f.view.state.resources.water+=1;assert.equal(x.api.current(x.model(),w),null);
  }
});
for(const choice of [
  {id:5,room:5,from:4}, {kind:'equip',id:5,item:80}, {kind:'stimpak',id:5,targets:[5]},
  {kind:'craft',id:4,targets:[4,0],cost:{scrap:80,parts:0}},
  {kind:'explore-start',id:5,targets:[5,0,2]}, {kind:'quest-start',targets:['w1',4,5,6]}
])test('动作绑定：'+(choice.kind||'assign'),()=>{
  const x=setup(),w=x.capture(choice);assert.ok(x.api.current(x.model(),w));
  w.project={...choice,targets:['different']};assert.equal(x.api.current(x.model(),w),null);
});

for(const choice of [
  {id:5,room:5,from:4},{kind:'equip',id:5,item:80},{kind:'stimpak',id:5,targets:[5]},
  {kind:'craft',id:4,targets:[4,0],cost:{scrap:80,parts:0}},
  {kind:'explore-start',id:5,targets:[5,0,2]},{kind:'quest-start',targets:['w1',4,5,6]}
])test('响应版本变化不作废业务依据：'+(choice.kind||'assign'),()=>{
  const x=setup();x.f.view.revision=1;const w=x.capture(choice),deadline=w.execution.deadline;
  for(let i=0;i<3;i++){x.f.view.revision++;x.advance(1000);assert.equal(x.api.current(x.model(),w),w.execution);}
  assert.equal(w.execution.deadline,deadline);
  x.f.view.state.residents[4].hp--;
  assert.equal(x.api.current(x.model(),w),null,'actual resident changes still invalidate');
});
test('排除revision不放行未知业务字段或治疗针库存变化',()=>{
  for(const change of [x=>x.f.view.unknownRule=true,x=>x.f.view.state.resources.stimpak--]){
    const x=setup(),w=x.capture({kind:'stimpak',id:5,targets:[5]});x.f.view.revision=200;change(x);
    assert.equal(x.api.current(x.model(),w),null);
  }
});

for(const choice of [
  {kind:'assign',id:5,room:4,from:90,targets:[5,4],role:'training-release'},
  {kind:'equip',id:5,item:80},{kind:'stimpak',id:5,targets:[5]},
  {kind:'craft',id:4,targets:[4,0],cost:{scrap:80,parts:0}},
  {kind:'explore-start',id:5,targets:[5,0,2]},{kind:'quest-start',targets:['w1',4,5,6]}
])test('公共进度契约：'+choice.kind+'接受连续产出和未完成进度，原期限不延长',()=>{
  const x=setup();x.f.view.state.residents[0].romance={partnerId:2,progress:.1};
  const w=x.capture(choice),deadline=w.execution.deadline;
  for(let i=0;i<4;i++){
    for(const r of x.f.view.state.rooms)r.stored+=.001;
    for(const p of x.f.view.state.residents){p.xp+=.001;p.training+=.001;}
    x.f.view.state.residents[0].romance.progress+=.001;
    x.advance(1000);assert.equal(x.api.current(x.model(),w),w.execution);
    assert.equal(w.execution.deadline,deadline);
  }
});
test('公共进度契约：状态不被改写，进度回退、完成边界和未知字段仍撤销',()=>{
  for(const change of [
    x=>x.f.view.state.rooms[0].stored--,
    x=>x.f.view.state.residents[0].xp--,
    x=>x.f.view.state.residents[0].xp=3,
    x=>x.f.view.state.residents[0].training=1,
    x=>x.f.view.state.residents[0].stats.end++,
    x=>x.f.view.state.residents[0].hp--,
    x=>x.f.view.state.rooms[0].unknown=true
  ]){
    const x=setup();x.f.view.state.rooms[0].stored=1;x.f.view.state.residents[0].xp=1;
    const choice={kind:'explore-start',id:5,targets:[5,0,2]},before=JSON.stringify(x.f.view),w=x.capture(choice);
    assert.equal(JSON.stringify(x.f.view),before);change(x);
    assert.equal(x.api.current(x.model(),w),null);
  }
});
test('公共进度契约：自然恢复到九成不再打针，返岗接受供给增长',()=>{
  const x=setup(),w=x.capture({kind:'stimpak',id:5,targets:[5]});
  x.f.view.state.residents[4].hp=89;assert.equal(x.api.current(x.model(),w),w.execution);
  x.f.view.state.residents[4].hp=90;assert.equal(x.api.current(x.model(),w),null);
  assert.equal(w.executionFailure.reason,'healing-no-longer-needed');
  const y=completedReturn();
  const returned=y.capture(y.returnChoice);
  y.f.view.state.resources.water++;assert.equal(y.api.current(y.model(),returned),returned.execution);
});
test('取消让路：只延后已撤销且未发送的同一动作，其他动作和未知原单不受影响',()=>{
  const x=setup(),choice={kind:'assign',id:5,room:4,from:90};
  x.f.view.state.residents[0].adultAt=x.f.view.serverTime+30000;
  const w=x.capture(choice);
  x.api.defer(w);assert.equal(x.api.deferred(choice),false);
  x.advance(30000);assert.equal(x.api.current(x.model(),w),null);
  x.api.defer(w);x.api.defer(w);assert.equal(x.c.shelterExecutionDeferrals.size,1);
  assert.equal(x.api.deferred(choice),true);assert.equal(x.api.deferred({...choice,id:6}),false);
  assert.equal(x.api.deferred({...choice,room:null}),true,'同一居民不能靠换目标绕过本轮取消');
  assert.equal(x.api.deferred({kind:'explore-start',id:5,targets:[5,0,2]}),true);
  assert.equal(x.api.deferred({kind:'quest-start',targets:['w1',4,5,6]}),true);
  assert.equal(x.api.deferred({kind:'quest-start',targets:['w1',6,7,8]}),false);
  assert.equal(x.api.deferred({kind:'stimpak',id:5,targets:[5]}),false,'仍可救治受伤居民');
  x.c.shelterExecutionDeferrals.clear();w.submitted=true;x.api.defer(w);assert.equal(x.api.deferred(choice),false);
  w.submitted=false;x.c.shelterPending={id:'unknown'};x.api.defer(w);assert.equal(x.api.deferred(choice),false);
});

test('执行耗时：合法导航和慢读取超过30秒仍续接，真实结算边界仍撤销',()=>{
  const x=setup();x.f.view.state.lastSettledAt=x.f.view.serverTime;
  const w=x.capture({kind:'assign',id:5,room:5,from:4,targets:[5,5]}),deadline=w.execution.deadline;
  for(let i=0;i<8;i++){x.advance(10000);assert.equal(x.api.current(x.model(),w),w.execution);}
  assert.equal(w.execution.deadline,deadline,'没有靠重复续期改写真实业务期限');
  x.advance(deadline-x.f.view.serverTime);
  assert.equal(x.api.current(x.model(),w),null);assert.equal(w.executionFailure.reason,'deadline');
});
test('过期动作只在新读取越过边界后重新选一次，重复过期或存在原单时不放行',()=>{
  for(const kind of ['assign','stimpak']){
    const x=setup(),choice=kind==='assign'?{kind,id:5,room:4,from:90}:{kind,id:5,targets:[5]};
    const w=x.capture(choice);let reads=0;
    x.c.readShelter=()=>{reads++;x.c.shelterController={};};x.c.shelterController=null;
    x.advance(w.execution.deadline-x.f.view.serverTime);const old=x.model();
    assert.equal(x.api.current(old,w),null);x.api.defer(w);assert.ok(x.api.deferred(choice));
    assert.ok(x.api.recheck(old));assert.ok(x.api.recheck(old));assert.equal(reads,1);
    const fresh=x.model();x.c.shelterRead.startedAt=x.f.view.serverTime;x.c.shelterController=null;
    x.c.shelterPending={id:'unknown'};x.api.recheck(fresh);assert.ok(x.api.deferred(choice));
    x.c.shelterPending=null;x.api.recheck(fresh);assert.equal(x.api.deferred(choice),false);
    assert.equal(x.api.current(fresh,w),null);x.api.defer(w);assert.ok(x.api.deferred(choice));
    x.api.recheck(fresh);assert.equal(reads,1);
  }
});
