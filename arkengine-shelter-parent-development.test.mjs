import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
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
function pairScene(){
  const scene=setup(),s=scene.v.state;
  s.rooms.find(r=>r.id===4).width=3;
  for(const p of s.residents.slice(4))p.stats=Object.fromEntries(Object.keys(p.stats).map(k=>[k,3]));
  for(const id of [7,8])s.residents.push({...structuredClone(s.residents[3]),id,name:`优质居民${id}`,roomId:4,parents:[]});
  s.residents[3].stats=Object.fromEntries(Object.keys(s.residents[3].stats).map(k=>[k,3]));
  s.residents[3].xp=0;s.residents[3].hp=100;
  scene.choose=()=>scene.api.population(scene.api.model(scene.v),scene.context.shelterState.families,
    {eligible:p=>p.id>=4,home:()=>true,healthy:()=>true},true);
  return scene;
}

test('父母选择：供应可承受时优先高属性生产者，不能仅因低属性居民闲置就选他们',()=>{
  const {choose,context,events}=pairScene();assert.ok(choose());
  assert.deepEqual([context.shelterState.pair.a,context.shelterState.pair.b],[7,8]);
  const assessment=events.find(e=>e[0]==='shelter-population')[2].assessment;
  assert.equal(assessment.baseTotal,56);assert.equal(assessment.midpoint.cha,8);assert.equal(assessment.romanceHours,1.25);
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
  a.choose();assert.notDeepEqual([a.context.shelterState.pair.a,a.context.shelterState.pair.b],[7,8]);
  const b=pairScene();b.v.state.resources.food=0;assert.equal(b.choose(),null);assert.equal(b.context.shelterState.pair,undefined);
  const c=parents();for(const p of c.v.state.residents.slice(4))p.romance={partnerId:p.id===5?6:5};
  assert.ok(!c.run().actions.some(a=>[5,6].includes(a.id)));
});
test('父母训练：现有空位优先、一次最多一名、不会用普通战斗训练占走另一名父母',()=>{
  const {run}=parents(),p=run();
  const actions=p.actions.filter(a=>a.role==='training');assert.equal(actions.length,1);
  assert.equal(actions[0].purpose,'parent');assert.equal(actions[0].stat,'cha');assert.equal(actions[0].room,90);
  assert.ok(!p.projects.some(p=>p.type==='training'));
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
  context.shelterCampaign={...api.defaults,training:true};
  let a=api.campaign(api.model(v)).choice;assert.equal(a.purpose,'parent');apply(a);
  const id=a.id;v.serverTime=a.until;s.lastSettledAt=v.serverTime;
  a=api.campaign(api.model(v)).choice;assert.equal(a.role,'training-release');apply(a);
  assert.ok(!api.campaign(api.model(v)).actions.some(x=>x.id===id&&x.role==='training'));
  a=api.staff(api.model(v));assert.equal(a.id,id);assert.equal(a.room,5);assert.match(a.reason,/原配对返回/);
});
