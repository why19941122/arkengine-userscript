import assert from 'node:assert/strict';
import {finishParentStats} from './arkengine-shelter-parent72.fixture.mjs';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
import {readyConstructionScene} from './arkengine-shelter-growth-investment.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const segment=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const implementation=[declarations,segment('  function shelterWorkerRate(','  function readShelter('),
  segment('  const staffRoomTypes =','  function shelterExploreStep('),
  segment('  function shelterCampaignSchedule(','  function shelterDailyClaimStep('),
  segment('  function recordShelterCampaign(','  function shelterFormValue('),
  segment('  function shelterRequestAction(','  function shelterSubmit(')].join('\n');
function setup(){
  const v=campaignView(),events=[],context={objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'},
    shelterStaffMode:'population',shelterStaffHold:'',shelterOptimize:true,shelterGear:false,shelterPopulationTarget:14,shelterLevelTarget:8,
    shelterConstruction:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0},
    shelterState:{families:[],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},
    shelterPending:null,shelterRead:null,shelterCaravanNote:'',shelterConstructionNote:'',shelterStaffNote:'',shelterPopulationNote:'',shelterSocialNote:'',
    Date:class extends Date{constructor(...args){super(...(args.length?args:[v.serverTime]));}static now(){return v.serverTime;}},
    crypto:{randomUUID:()=>String(v.serverTime)},log:{add:(...args)=>events.push(args)},workshopAutomatic:()=>false};
  context.saveShelter=x=>context.shelterState=x;
  const api=vm.runInNewContext(`${implementation}\nshelterCampaign={...campaignDefaults};
    ({model:shelterModel,plan:shelterCampaignPlan,defaults:campaignDefaults,staff:shelterStaffPlan,campaign:shelterCampaignSchedule,
      population:shelterPopulationPlan,assessment:shelterParentAssessment,estimate:shelterParentTrainingEstimate,
      development:shelterDevelopmentPlan,allowance:shelterConstructionAllowance,record:recordShelterCampaign,
      valid:validCampaignRecord,pending:validCampaignPending,diagnostics:shelterPopulationDiagnostics})`,context);
  const run=(cfg={})=>api.plan(api.model(v),{...api.defaults,training:true,parentTraining:true,...cfg},
    {...context.shelterState.campaign,families:context.shelterState.families},14);
  const apply=a=>{
    v.state.residents.find(p=>p.id===a.id).roomId=a.room;
    api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  };
  return {v,context,api,run,apply,events};
}
function parents(){
  const scene=setup(),{v,context}=scene,s=v.state;
  context.shelterState.families=[{a:5,b:6,room:5}];
  for(const p of s.residents.slice(4))Object.assign(p,{roomId:5,xp:0,hp:100,familyCooldownUntil:v.serverTime+6*3600000,
    stats:{str:5,per:5,end:5,cha:2,int:5,agi:5,lck:5}});
  s.rooms.push({...s.rooms[0],id:90,type:'training',trainStat:'cha',level:2,floor:2,col:4});
  return scene;
}
function multipleFamilies(){
  const scene=parents(),{v,context}=scene,s=v.state;
  s.rooms.push({...s.rooms.find(r=>r.id===5),id:91,floor:3,col:2,width:1});
  for(const id of [7,8])s.residents.push({...structuredClone(s.residents[4]),id,name:`第二家庭${id}`,roomId:91});
  context.shelterState.families.push({a:7,b:8,room:91});
  return scene;
}
function pairScene(){
  const scene=setup(),s=scene.v.state;
  s.rooms.find(r=>r.id===4).width=3;
  for(const p of s.residents.slice(4)){p.roomId=4;p.stats=Object.fromEntries(Object.keys(p.stats).map(k=>[k,3]));}
  for(const id of [7,8])s.residents.push({...structuredClone(s.residents[3]),id,name:`优质居民${id}`,roomId:4,parents:[]});
  s.residents[3].stats=Object.fromEntries(Object.keys(s.residents[3].stats).map(k=>[k,3]));
  s.residents[3].xp=0;s.residents[3].hp=100;
  finishParentStats(scene.v);
  scene.choose=()=>scene.api.population(scene.api.model(scene.v),scene.context.shelterState.families,
    {eligible:p=>p.id>=4,home:()=>true,healthy:()=>true},true);
  return scene;
}

test('就绪工程不饥饿：可支付的普通生产升级先开工，不被可选调岗持续抢占',()=>{
  const {v,context,api}=setup(),fixture=readyConstructionScene();Object.assign(v,fixture.view);
  context.shelterStaffMode='production';context.shelterState=fixture.state;
  const m=api.model(v),campaign=api.campaign(m),plan=api.development(m,14,campaign,8);
  assert.equal(plan.next.status,'ready',JSON.stringify(plan.next));
  assert.equal(plan.next.project.type,'scrap');assert.ok(!plan.next.project.levelInvestment);
  assert.equal(api.allowance(plan.next.project,m,context.shelterConstruction,context.shelterState,null,v.serverTime),'');
  assert.equal(api.staff(m),null,'do not start another discretionary allocation before this admitted construction');
});

test('父母选择：就业落实且供应可承受时优先高属性生产者',()=>{
  const {choose,context,events}=pairScene();assert.ok(choose());
  assert.deepEqual([context.shelterState.pair.a,context.shelterState.pair.b],[7,8]);
  const assessment=events.find(e=>e[0]==='shelter-population')[2].assessment;
  assert.equal(assessment.baseTotal,70);assert.equal(assessment.midpoint.cha,10);assert.equal(assessment.romanceHours,1);
});

test('父母比较边界：另有闲人尚待就业时仍按属性和真实供给决定配对',()=>{
  const {v,choose,context,api}=pairScene();
  for(const p of v.state.residents.filter(p=>p.id>=4)){
    p.stats=Object.fromEntries(Object.keys(p.stats).map(k=>[k,p.id>=7?5:3]));
    p.stats.cha=p.id>=7?1:9;
  }
  const m=api.model(v),high=v.state.residents.filter(p=>p.id>=7),low=v.state.residents.filter(p=>[5,6].includes(p.id));
  assert.ok(api.assessment(m,high).baseTotal>api.assessment(m,low).baseTotal);
  assert.ok(api.assessment(m,high).score<api.assessment(m,low).score,'reproduce the old rate-based ranking conflict');
  v.state.residents.find(p=>p.id===5).roomId=null;
  assert.equal(choose(),null);finishParentStats(v);
  assert.ok(choose());assert.deepEqual([context.shelterState.pair.a,context.shelterState.pair.b],[7,8]);
  assert.equal(v.state.residents.find(p=>p.id===5).roomId,null,'选择不自动改写其他成人岗位');
});
test('父母选择：基础魅力影响周期、装备不影响评估，生产损失会降低同属性组合评分',()=>{
  const {v,api}=setup(),m=api.model(v),pair=v.state.residents.slice(4);
  const before=api.assessment(m,pair);pair[0].outfitId=99;v.state.items.push({id:99,slot:'outfit',stats:{cha:50}});
  assert.equal(api.assessment(m,pair).score,before.score);
  pair[0].stats.cha=1;assert.ok(api.assessment(m,pair).romanceHours>before.romanceHours);
  pair[0].stats.cha=8;pair[0].roomId=4;v.state.rooms.find(r=>r.id===4).width=2;
  assert.ok(api.assessment(api.model(v),pair).score<before.score);
});
test('父母选择：亲缘与供给门槛不能被高属性评分绕过，已有感情仍受保护',()=>{
  const a=pairScene();a.v.state.residents.filter(p=>[7,8].includes(p.id)).forEach(p=>p.parents=[1,2]);
  assert.equal(a.choose(),null);assert.equal(a.context.shelterState.pair,undefined);
  const b=pairScene();b.v.state.resources.food=0;assert.equal(b.choose(),null);assert.equal(b.context.shelterState.pair,undefined);
  const c=parents();for(const p of c.v.state.residents.slice(4))p.romance={partnerId:p.id===5?6:5};
  assert.ok(!c.run().actions.some(a=>[5,6].includes(a.id)));
});

test('父母换届：旧家庭空宿舍不永久排斥高属性组合，原父母仍留生产且刷新不中断新计划',()=>{
  const {v,context,api,choose,events}=pairScene();
  context.shelterState.families=[{a:5,b:6,room:5}];
  for(const p of v.state.residents.filter(p=>[5,6].includes(p.id)))p.familyCooldownUntil=v.serverTime-1;
  const first=choose();assert.ok(first);assert.deepEqual([context.shelterState.pair.a,context.shelterState.pair.b],[7,8]);
  assert.equal(context.shelterState.families.length,0);assert.ok(events.some(e=>e[2]?.replacedFamilies?.length));
  v.state.residents.find(p=>p.id===first.id).roomId=first.room;
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  const next=api.population(api.model(v),context.shelterState.families,{eligible:p=>p.id>=4,home:()=>true,healthy:()=>true});
  assert.equal(next.id,8);assert.equal(next.room,5);
  assert.ok(v.state.residents.filter(p=>[5,6].includes(p.id)).every(p=>p.roomId===4));
});

test('父母换届：普通调度在旧配对返回前比较属性，不先把低属性父母塞回宿舍',()=>{
  const {v,context,api}=pairScene();context.shelterState.families=[{a:5,b:6,room:5}];
  for(const person of v.state.residents.filter(person=>[7,8].includes(person.id)))
    for(const stat of Object.keys(person.stats))person.stats[stat]=10;
  const action=api.staff(api.model(v));assert.equal(action.id,7);assert.equal(action.room,5);
  assert.deepEqual([context.shelterState.pair.a,context.shelterState.pair.b],[7,8]);
});

test('父母换届：旧父母占基础岗位需要接替时，先执行已有供应支持的更优组合',()=>{
  const {v,context,api}=pairScene(),s=v.state;context.shelterState.families=[{a:5,b:6,room:5}];
  s.residents.find(p=>p.id===1).roomId=4;s.residents.find(p=>p.id===2).roomId=4;
  Object.assign(s.residents.find(p=>p.id===5),{roomId:1,stats:{str:8,per:3,end:3,cha:3,int:3,agi:3,lck:3}});
  Object.assign(s.residents.find(p=>p.id===6),{roomId:2,stats:{str:3,per:3,end:3,cha:3,int:3,agi:8,lck:3}});
  for(const person of s.residents.filter(person=>[7,8].includes(person.id)))
    for(const stat of Object.keys(person.stats))person.stats[stat]=10;
  const action=api.staff(api.model(v));assert.ok(action);assert.equal(action.room,5);
  assert.ok([1,2,7,8].includes(action.id));
  assert.ok(context.shelterState.pair);assert.ok(![5,6].includes(context.shelterState.pair.a));
  assert.ok(![5,6].includes(context.shelterState.pair.b));
  assert.equal(s.residents.find(p=>p.id===5).roomId,1);assert.equal(s.residents.find(p=>p.id===6).roomId,2);
});

test('父母换届：感情、待产、宿舍已有成人、原请求、换位和模式限制均不能被更高评分绕过',()=>{
  for(const kind of ['romance','birth','unknown-birth','occupied','pending','swap','mode']){
    const {v,context,choose}=pairScene(),s=v.state;context.shelterState.families=[{a:5,b:6,room:5}];
    if(kind==='romance')s.residents.find(p=>p.id===5).romance={partnerId:6,progress:.3};
    if(kind==='birth')s.births=[{roomId:5,parents:[5,6],dueAt:v.serverTime+1000}];
    if(kind==='unknown-birth')s.births=[{roomId:5,dueAt:v.serverTime+1000}];
    if(kind==='occupied')s.residents.find(p=>p.id===5).roomId=5;
    if(kind==='pending')context.shelterPending={kind:'assign'};
    if(kind==='swap')context.shelterState.swap={step:0};
    if(kind==='mode')context.shelterStaffMode='family';
    assert.equal(choose(),null,kind);assert.equal(context.shelterState.families.length,1,kind);
  }
});

test('父母换届：不为小幅评分提升拆旧配对，未来供给或库存不足时不释放宿舍绑定',()=>{
  for(const kind of ['small-gain','food','stock']){
    const {v,context,choose}=pairScene(),s=v.state;context.shelterState.families=[{a:7,b:8,room:5}];
    if(kind==='small-gain')for(const p of s.residents.filter(p=>[5,6,7,8].includes(p.id))){p.stats=Object.fromEntries(Object.keys(p.stats).map(k=>[k,5]));p.roomId=null;}
    if(kind==='food')s.residents.find(p=>p.id===2).stats.agi=0;
    if(kind==='stock')s.resources.food=0;
    assert.equal(choose(),null,kind);assert.equal(context.shelterState.families.length,1,kind);
  }
});

test('父母换届：生过孩子但冷却已过的未绑定成人可参选，历史子女不能冒充本轮配对成功',()=>{
  const {v,context,api}=pairScene(),s=v.state;
  for(const p of s.residents.filter(p=>[7,8].includes(p.id)))p.familyCooldownUntil=v.serverTime-1;
  s.residents.push({...structuredClone(s.residents[3]),id:30,name:'历史子女',parents:[7,8],roomId:null,adultAt:v.serverTime+3600000});
  const choose=()=>api.population(api.model(v),context.shelterState.families,{eligible:p=>[7,8].includes(p.id),home:()=>true,healthy:()=>true},true);
  const first=choose();assert.equal(first?.id,7);assert.equal(context.shelterState.families.length,0);
  s.residents.find(p=>p.id===7).roomId=5;
  const second=choose();assert.equal(second?.id,8);assert.equal(context.shelterState.families.length,0);
  s.residents.find(p=>p.id===8).roomId=5;assert.equal(choose(),null);assert.ok(context.shelterState.pair);
  s.residents.find(p=>p.id===7).romance={partnerId:8,progress:.1};
  choose();assert.equal(context.shelterState.pair,null);assert.equal(context.shelterState.families.length,1);
});
test('父母训练：现有空位优先、一次最多一名、不会用普通战斗训练占走另一名父母',()=>{
  const {run}=parents(),p=run();
  const actions=p.actions.filter(a=>a.role==='training');assert.equal(actions.length,1);
  assert.equal(actions[0].purpose,'parent');assert.equal(actions[0].stat,'cha');assert.equal(actions[0].room,90);
  assert.ok(!p.projects.some(p=>p.type==='training'));
});

test('父母分家庭训练：已入室的家庭不占用另一家庭的空位和冷却窗口',()=>{
  const {v,context,run,apply}=multipleFamilies();
  const first=run().choice;assert.equal(first.id,5);apply(first);
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  const second=run().actions.find(a=>a.purpose==='parent');assert.ok(second,'second family can train while first continues');
  assert.equal(second.id,7);assert.equal(second.room,90);apply(second);
  const p=run();assert.ok(p.reserved.includes(5)&&p.reserved.includes(7));
  assert.equal(p.actions.filter(a=>a.purpose==='parent').length,0,'both families already have one trainee');
  assert.deepEqual(v.state.residents.filter(p=>p.roomId===90).map(p=>p.id),[5,7]);
});

test('父母分家庭训练：手动在训家长也占本家庭轮换名额，其他家庭仍可入室',()=>{
  const {v,run}=multipleFamilies();v.state.residents.find(p=>p.id===5).roomId=90;
  const action=run().actions.find(a=>a.purpose==='parent');assert.equal(action?.id,7);
  assert.ok(!run().actions.some(a=>a.id===5||a.id===6));
});

test('父母分家庭训练：所有新离岗共用供给余量，第二家庭不能各自重复使用余量',()=>{
  const {v,run,apply}=multipleFamilies(),s=v.state;
  s.rooms.find(r=>r.id===3).level=1;s.residents.find(p=>p.id===3).roomId=4;
  for(const id of [5,7]){const p=s.residents.find(p=>p.id===id);p.roomId=3;p.stats.per=8;}
  for(const id of [6,8])s.residents.find(p=>p.id===id).hp=1;
  const first=run().actions.find(a=>a.purpose==='parent');assert.ok(first);apply(first);
  assert.equal(run().actions.filter(a=>a.purpose==='parent').length,0,'one remaining water worker must stay');
  s.residents.find(p=>p.id===3).roomId=3;
  assert.equal(run().actions.find(a=>a.purpose==='parent')?.id,7,'restored supply admits the other family');
});

test('父母分家庭训练：外出占位、冷却不足、已有感情、换位与目标继续限制新增',()=>{
  for(const reason of ['seat','cooldown','romance','swap','target']){
    const {v,context,run,apply}=multipleFamilies(),s=v.state;apply(run().choice);
    if(reason==='seat')s.residents.push({...structuredClone(s.residents[0]),id:20,name:'外出占位者',roomId:90,away:{kind:'explore'}});
    if(reason==='cooldown')for(const id of [7,8])s.residents.find(p=>p.id===id).familyCooldownUntil=v.serverTime+600000;
    if(reason==='romance')for(const id of [7,8])s.residents.find(p=>p.id===id).romance={partnerId:id===7?8:7};
    if(reason==='swap')context.shelterState.campaign.assignmentInProgress=true;
    const p=run(reason==='target'?{trainTarget:2}:{});
    assert.equal(p.actions.filter(a=>a.purpose==='parent').length,0,reason);
  }
});

test('父母分家庭训练：本家庭完成后伴侣接续，已完成者本周期不重复入室',()=>{
  const {v,run,apply}=multipleFamilies(),s=v.state;
  const first=run().choice;apply(first);
  const second=run().actions.find(a=>a.purpose==='parent');assert.ok(second);apply(second);
  v.serverTime+=2*3600000;s.lastSettledAt=v.serverTime;s.residents.find(p=>p.id===5).stats.cha++;
  const release=run().actions.find(a=>a.id===5);assert.equal(release.role,'training-release');apply(release);
  const next=run().actions.find(a=>a.purpose==='parent');assert.equal(next?.id,6);
  assert.ok(!run().actions.some(a=>a.id===5));assert.ok(run().reserved.includes(7));
});

test('父母分家庭训练：七项属性均能独立选择并跨家庭接续，规划不修改原状态',()=>{
  for(const stat of ['str','per','end','cha','int','agi','lck']){
    const {v,context,run,apply}=multipleFamilies(),s=v.state;
    s.rooms.find(r=>r.id===90).trainStat=stat;
    for(const p of s.residents.filter(p=>p.id>=5))for(const key of Object.keys(p.stats))p.stats[key]=key===stat?2:6;
    const before=JSON.stringify({v,state:context.shelterState}),first=run().choice;
    assert.equal(JSON.stringify({v,state:context.shelterState}),before);
    assert.equal(first.stat,stat);apply(first);
    const next=run().actions.find(a=>a.purpose==='parent');assert.equal(next?.id,7,stat);assert.equal(next.stat,stat);
  }
});

test('父母分家庭训练：已有家长在训不阻断其他家庭短板训练室的建设评估',()=>{
  const {v,run,apply}=multipleFamilies();apply(run().choice);
  for(const p of v.state.residents.filter(p=>[7,8].includes(p.id)))for(const stat of Object.keys(p.stats))p.stats[stat]=stat==='str'?2:6;
  const p=run(),project=p.projects.find(r=>r.type==='training');
  assert.equal(project?.person,7);assert.equal(project.trainStat,'str');
  assert.ok(!p.reserved.includes(7)&&!p.reserved.includes(8),'waiting for a room must not reserve or remove producers');
  assert.equal(p.projects.filter(r=>r.type==='training').length,1);
});
test('父母训练：进度与期限随成功回执保存，刷新保留，完成一格后本周期不再训练此人',()=>{
  const {v,context,api,run,apply}=parents(),a=run().choice;apply(a);
  assert.equal(api.valid(context.shelterState.campaign),true);
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  assert.ok(run().reserved.includes(a.id));assert.ok(run().events.includes(a.until-v.serverTime));assert.ok(!run().actions.some(x=>x.id===a.id));
  v.serverTime+=2*3600000;v.state.lastSettledAt=v.serverTime;v.state.residents.find(p=>p.id===a.id).stats.cha++;
  const release=run().actions.find(x=>x.id===a.id);assert.equal(release.role,'training-release');apply(release);
  assert.ok(!run().actions.some(x=>x.role==='training'&&x.id===a.id));
});
test('父母训练：冷却到期即退出，关闭训练、切换人员模式、缺供给也退出',()=>{
  for(const reason of ['deadline','disabled','mode','supply']){
    const {v,run,apply}=parents(),a=run().choice;apply(a);
    const cfg={};
    if(reason==='deadline')v.serverTime=a.until;
    if(reason==='disabled')cfg.training=false;
    if(reason==='mode')cfg.parentTraining=false;
    if(reason==='supply')v.state.resources.food=0;
    assert.equal(run(cfg).actions.find(x=>x.id===a.id)?.role,'training-release',reason);
  }
});

test('父母训练边界：冷却结束时当前格剩半小时，余量低于新准入门槛仍可固定收尾，真实缺供给退出',()=>{
  for(const condition of ['margin','drain','stock']){
    const {v,context,api,run,apply}=parents(),a=run().choice;apply(a);
    v.serverTime=a.until;v.state.lastSettledAt=v.serverTime;
    const p=v.state.residents.find(p=>p.id===a.id);p.training=.75;
    const m=api.model(v);m.demand.power=condition==='drain'?m.production.power+.1:m.production.power/1.1;
    if(condition==='stock')m.state.resources.power=0;
    const cfg={...api.defaults,training:true,parentTraining:true,development:true};
    const record={...context.shelterState.campaign,families:context.shelterState.families};
    const first=api.plan(m,cfg,record,14);
    if(condition!=='margin'){
      assert.ok(first.actions.some(c=>c.id===p.id&&c.role==='training-release'),condition);continue;
    }
    assert.ok(first.reserved.includes(p.id),'允许安全收尾当前格');
    const finish=first.adoptions.find(r=>r.id===p.id);assert.equal(finish?.finishCurrent,true);
    assert.ok(finish.until>m.now&&finish.until<=m.now+2*3600000+600000);
    record.roles=record.roles.map(r=>r.id===p.id?finish:r);
    for(let i=0;i<3;i++){
      const again=api.plan(m,cfg,JSON.parse(JSON.stringify(record)),14);
      assert.ok(again.reserved.includes(p.id));assert.ok(!again.adoptions.some(r=>r.id===p.id),'刷新不能续期');
    }
    p.stats.cha++;p.training=0;
    assert.ok(api.plan(m,cfg,record,14).actions.some(c=>c.id===p.id&&c.role==='training-release'));
  }
});
test('父母训练：冷却不足、未知父母待产、人工特殊岗位不参与；训练未开不建房',()=>{
  for(const reason of ['deadline','birth','manual','disabled']){
    const {v,run}=parents(),cfg={};
    if(reason==='deadline')v.state.residents.slice(4).forEach(p=>p.familyCooldownUntil=v.serverTime+600000);
    if(reason==='birth')v.state.births=[{roomId:5,dueAt:v.serverTime+1000}];
    if(reason==='manual')v.state.residents.slice(4).forEach(p=>p.roomId=90);
    if(reason==='disabled')cfg.training=false;
    const plan=run(cfg);assert.ok(!plan.actions.some(a=>a.purpose==='parent'),reason);assert.ok(!plan.projects.length,reason);
  }
});
test('父母训练：七项属性均可培养，服装不计速度，结算余量计入剩余冷却',()=>{
  const {v,api}=parents(),p=v.state.residents[4],r=v.state.rooms.at(-1);
  for(const stat of ['str','per','end','cha','int','agi','lck']){
    p.stats[stat]=5;r.trainStat=stat;r.level=3;
    assert.equal(api.estimate(api.model(v),p,r).hours,2+1/6);
  }
  v.state.legacy.perks.training=10;assert.ok(api.estimate(api.model(v),p,r).hours<2+1/6);
});
test('父母训练：外出居民仍占训练名额，不能视为空岗，也不升级仍有人占位的房间',()=>{
  const {v,run}=parents(),s=v.state;
  for(const id of [20,21])s.residents.push({...structuredClone(s.residents[0]),id,name:`外出${id}`,roomId:90,away:{kind:'explore'}});
  const p=run();assert.ok(!p.actions.some(a=>a.room===90));assert.ok(!p.projects.some(p=>p.upgradeId===90||p.trainStat==='cha'));
});
test('父母训练建设：缺房只提一项且不提前停工等房；已有合适房间慢则评估升级',()=>{
  for(const kind of ['build','upgrade']){
    const {v,context,api,run}=parents(),s=v.state;
    if(kind==='build')s.rooms=s.rooms.filter(r=>r.id!==90);
    else {s.rooms.find(r=>r.id===90).level=1;for(const p of s.residents.slice(4))for(const key of Object.keys(p.stats))p.stats[key]=5;}
    const plan=run(),request=plan.projects.find(p=>p.type==='training');assert.ok(request);
    assert.equal(plan.reserved.length,0,'等待建设不能占用父母');
    assert.equal(request.upgradeId,kind==='upgrade'?90:undefined);
    const development=api.development(api.model(v),14,plan,8);
    const project=development.candidates.find(p=>p.strategy?.person===request.person&&p.type==='training');
    assert.ok(project);assert.equal(project.kind,kind);
    assert.match(api.allowance(project,api.model(v),{...context.shelterConstruction,[kind]:false},{},null,v.serverTime),/未开启/);
    assert.match(api.allowance(project,api.model(v),{...context.shelterConstruction,scrapLimit:0},{},null,v.serverTime),/额度/);
  }
});
test('父母训练记录：新增属性仅允许有明确父母用途和有效截止期，旧战斗记录仍兼容',()=>{
  const {run,api,context,v}=parents(),a=run().choice;
  const pending={kind:'assign',targets:a.targets,before:{serverTime:v.serverTime,campaign:{choice:a,ids:[a.id],hp:100}}};
  assert.equal(api.pending(pending),true);
  a.until=v.serverTime;assert.equal(api.pending(pending),false);a.until=v.serverTime+3600000;
  delete a.purpose;assert.equal(api.pending(pending),false);
  a.stat='end';assert.equal(api.pending(pending),true);
  context.shelterState.campaign.roles=[{id:5,room:90,at:v.serverTime,role:'training',stat:'agi',base:5}];
  assert.equal(api.valid(context.shelterState.campaign),true);
});

test('父母训练建设：预算恢复晚于冷却窗口时不建本轮用不上的训练房',()=>{
  const {v,api,run}=parents();v.state.rooms=v.state.rooms.filter(r=>r.id!==90);
  const plan=run();assert.ok(plan.projects.some(p=>p.type==='training'));
  plan.constructionPolicy={build:true,upgrade:true,dig:true,budgetMode:'daily',scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0,
    spent:{scrap:10000,parts:0},budgetReleases:[{at:v.serverTime+12*3600000,scrap:10000,parts:0}]};
  const development=api.development(api.model(v),14,plan,8);
  const projects=development.candidates.filter(c=>c.strategy?.trainingDeadline);
  assert.ok(projects.length);assert.ok(projects.every(c=>c.priority>=70&&c.blocks.some(s=>s.includes('冷却窗口'))));
  assert.notEqual(development.next.type,'training');assert.equal(plan.reserved.length,0);
});
test('家庭诊断：占宿舍成人记录身份与父母，家庭记录包含基础属性评估',()=>{
  const {v,context,api}=parents(),s=v.state;
  s.residents.push({...structuredClone(s.residents[0]),id:100,name:'成年子女',roomId:5,parents:[5,6]});
  const d=api.diagnostics(api.model(v),{reserved:[],dailyReserved:[]}).families[0];
  assert.equal(d.otherAdults[0].id,100);assert.deepEqual(Array.from(d.otherAdults[0].parents),[5,6]);assert.ok(d.parentAssessment);
});
test('宿舍就业：冷却父母和另一宿舍成年子女均可直接接岗，不依赖整体优化搜索',()=>{
  const {v,context,api}=parents(),s=v.state;
  s.residents.find(p=>p.id===6).roomId=2;
  s.rooms.find(r=>r.id===4).width=3;
  s.rooms.push({...s.rooms.find(r=>r.id===5),id:91,floor:3,col:2});
  context.shelterState.families.push({a:1,b:2,room:91});
  for(const p of s.residents.filter(p=>[1,2].includes(p.id)))p.familyCooldownUntil=v.serverTime+3600000;
  s.residents.push({...structuredClone(s.residents[4]),id:100,name:'成年子女',roomId:91,parents:[1,2],familyCooldownUntil:0});
  const ids=new Set();
  for(let i=0;i<2;i++){
    const m=api.model(v),campaign=api.campaign(m);
    const a=api.staff(m);assert.ok(a);assert.equal(a.room,4);assert.match(a.reason,/宿舍待就业/);
    ids.add(a.id);s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.id===100)assert.ok(campaign.unemployedResidents.includes(a.id));
    else assert.ok(s.residents.find(p=>p.id===a.id).familyCooldownUntil>v.serverTime);
  }
  assert.deepEqual([...ids].sort((a,b)=>a-b),[5,100]);
});
test('父母训练完整轮换：实际调度读取家庭，训练到期释放后两人返回原宿舍',()=>{
  const {v,context,api,apply}=parents(),s=v.state;
  context.shelterCampaign={...api.defaults,training:true,parentPreparation:false};
  let a=api.campaign(api.model(v)).choice;assert.equal(a.purpose,'parent');apply(a);
  const id=a.id;v.serverTime=a.until;s.lastSettledAt=v.serverTime;
  a=api.campaign(api.model(v)).choice;assert.equal(a.role,'training-release');apply(a);
  assert.ok(!api.campaign(api.model(v)).actions.some(x=>x.id===id&&x.role==='training'));
  finishParentStats(v,[5,6]);
  a=api.staff(api.model(v));assert.equal(a.id,id);assert.equal(a.room,5);assert.match(a.reason,/原配对返回/);
});

function parentRoomChanged(){
  const x=parents(),first=x.run().choice;x.apply(first);
  const role=structuredClone(x.context.shelterState.campaign.roles[0]);
  const p=x.v.state.residents.find(p=>p.id===first.id),room=x.v.state.rooms.find(r=>r.id===90);
  // Settled post-merge snapshot: the old room no longer exists; resident identity,
  // training attribute and current progress survive in the wider training room.
  x.v.serverTime+=600000;x.v.state.lastSettledAt=x.v.serverTime;
  Object.assign(room,{id:89,width:2});p.roomId=89;p.training=.2;
  x.context.shelterCampaign={...x.api.defaults,training:true,parentPreparation:false};
  return {...x,p,room,role};
}

test('父母训练房间变更：原房消失后沿用原格基线和期限，不重新开始训练承诺',()=>{
  const x=parentRoomChanged(),before=JSON.stringify(x.context.shelterState),plan=x.run({development:true});
  const adopted=plan.adoptions.find(r=>r.id===x.p.id);assert.ok(adopted);
  assert.deepEqual(JSON.parse(JSON.stringify(adopted)),{...x.role,room:89});
  assert.equal(JSON.stringify(x.context.shelterState),before,'planning remains read-only');
  x.api.campaign(x.api.model(x.v));x.context.shelterState=JSON.parse(JSON.stringify(x.context.shelterState));
  const next=x.api.campaign(x.api.model(x.v));
  assert.ok(next.reserved.includes(x.p.id));assert.equal(next.adoptions.length,0);
  assert.deepEqual(x.context.shelterState.campaign.roles.find(r=>r.id===x.p.id),{...x.role,room:89});
});

test('父母训练房间变更：已完成一格随原房消失后仍返岗，不把提升后的属性当作新起点',()=>{
  const x=parentRoomChanged();x.p.stats.cha++;x.p.training=0;
  const plan=x.api.campaign(x.api.model(x.v)),release=plan.actions.find(a=>a.id===x.p.id);
  assert.equal(release?.role,'training-release',JSON.stringify({roles:x.context.shelterState.campaign.roles,actions:plan.actions}));x.apply(release);
  assert.ok(x.context.shelterState.campaign.trainingRest.some(r=>r.id===x.p.id));
  assert.ok(!x.run().actions.some(a=>a.id===x.p.id&&a.role==='training'));
  assert.equal(x.run().actions.find(a=>a.purpose==='parent')?.id,6);
});

test('父母训练房间变更：有限收尾的固定期限跨房号及刷新不续期',()=>{
  const x=parentRoomChanged();x.role.finishCurrent=true;x.role.until=x.role.at+600000;
  x.context.shelterState.campaign.roles=[x.role];
  const plan=x.api.campaign(x.api.model(x.v));
  assert.equal(plan.actions.find(a=>a.id===x.p.id)?.role,'training-release');
  assert.equal(x.context.shelterState.campaign.roles.find(r=>r.id===x.p.id).until,x.role.until);
});

test('父母训练房间变更：完成后已有下一格进度只生成一次有限收尾记录',()=>{
  const x=parentRoomChanged();x.p.stats.cha++;x.p.training=.5;
  const plan=x.run({development:true}),adoptions=plan.adoptions.filter(r=>r.id===x.p.id);
  assert.equal(adoptions.length,1);assert.equal(adoptions[0].finishCurrent,true);assert.equal(adoptions[0].base,3);
  x.api.campaign(x.api.model(x.v));
  assert.equal(x.api.valid(x.context.shelterState.campaign),true);
  const role=structuredClone(x.context.shelterState.campaign.roles.find(r=>r.id===x.p.id));
  x.v.serverTime=role.until;x.v.state.lastSettledAt=x.v.serverTime;
  const next=x.api.campaign(x.api.model(x.v));
  assert.equal(next.actions.find(a=>a.id===x.p.id)?.role,'training-release');
  assert.equal(x.context.shelterState.campaign.roles.find(r=>r.id===x.p.id).until,role.until);
});

test('父母训练房间变更：原房仍在、属性未知、原请求未决或暂停不能自动迁移旧承诺',()=>{
  for(const reason of ['old-room','unknown-stat','pending','hold']){
    const x=parentRoomChanged(),before=JSON.stringify(x.context.shelterState);
    if(reason==='old-room')x.v.state.rooms.push({...x.room,id:90,col:6,width:1});
    if(reason==='unknown-stat')delete x.room.trainStat;
    if(reason==='pending')x.context.shelterPending={kind:'assign',targets:[x.p.id,null]};
    if(reason==='hold')x.context.shelterStaffHold='manual';
    const plan=x.api.campaign(x.api.model(x.v));
    const adopted=x.context.shelterState.campaign.roles.find(r=>r.id===x.p.id&&r.room===89);
    assert.ok(!adopted||adopted.at!==x.role.at,reason);
    if(['pending','hold'].includes(reason)){
      assert.equal(JSON.stringify(x.context.shelterState),before,reason);
      assert.ok(!plan.actions.some(a=>a.id===x.p.id),reason);
    }
  }
});

test('父母训练房间变更：关闭训练后仍能核对原记录并返岗',()=>{
  const x=parentRoomChanged();x.context.shelterCampaign.training=false;
  const plan=x.api.campaign(x.api.model(x.v));
  assert.equal(plan.actions.find(a=>a.id===x.p.id)?.role,'training-release');
  assert.equal(x.context.shelterState.campaign.roles.find(r=>r.id===x.p.id).base,x.role.base);
});
