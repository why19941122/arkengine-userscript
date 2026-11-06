import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {populationGrowthView,familyGrowthView,workshopChurnView} from './arkengine-shelter-campaign.fixture.mjs';
const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const segment=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const implementation=[declarations,segment('  function shelterWorkerRate(','  function readShelter('),
  segment('  const staffRoomTypes =','  function shelterExploreStep('),
  segment('  function shelterCampaignSchedule(','  function shelterDailyClaimStep(')].join('\n');
function setup(v=populationGrowthView()){
  const context={objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'},
    shelterStaffMode:'population',shelterStaffHold:'',shelterOptimize:false,shelterGear:false,shelterPopulationTarget:30,shelterLevelTarget:6,
    shelterConstruction:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:0,partsReserve:0},
    shelterState:{campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},shelterPending:null,shelterRead:null,shelterCaravanNote:'',
    shelterConstructionNote:'',shelterStaffNote:'',shelterPopulationNote:'',shelterSocialNote:'',Date,
    crypto:{randomUUID:()=>String(v.serverTime)},log:{add:()=>{}},workshopAutomatic:()=>true};
  context.saveShelter=x=>context.shelterState=x;
  const api=vm.runInNewContext(`${implementation}\nshelterCampaign={...campaignDefaults};
    ({model:shelterModel,campaign:shelterCampaignSchedule,development:shelterDevelopmentPlan,staff:shelterStaffPlan,familySupply:shelterPopulationFamilySupply})`,context);
  const plan=()=>{const m=api.model(v),c=api.campaign(m);return {m,c,p:api.development(m,context.shelterPopulationTarget,c,context.shelterLevelTarget)};};
  return {v,context,plan,api};
}

function adultJobsSetup(){
  const scene=setup(workshopChurnView()),s=scene.v.state;
  scene.context.shelterStaffMode='production';scene.context.shelterLevelTarget=5;scene.context.shelterPopulationTarget=17;
  s.resources.scrap=800;
  s.residents.find(p=>p.id===21).roomId=4;
  for(const id of [35,36])Object.assign(s.residents.find(p=>p.id===id),{roomId:5,parents:[1,2]});
  return scene;
}
test('成年就业：回收岗位已满时，宿舍里的未成家成年子女也能驱动生产扩建',()=>{
  const {plan,v}=adultJobsSetup(),before=JSON.stringify(v),{c,p}=plan();
  assert.deepEqual(Array.from(c.unemployedResidents||[]),[35,36]);
  assert.equal(p.next.status,'ready',JSON.stringify(p.next));assert.equal(p.next.project.kind,'build');assert.equal(p.next.project.type,'scrap');
  assert.ok(p.next.project.gain>0);assert.equal(JSON.stringify(v),before,'planning does not evict children into rest');
});
test('成年就业：儿童、家庭、人工宿舍成人、受伤与特殊岗位不能算作自动扩建人手',()=>{
  for(const change of ['child','romance','parent','cooldown','manual','injured','special','incident','unpowered','birth','off']){
    const {v,context,plan}=adultJobsSetup(),s=v.state;
    for(const p of s.residents.filter(p=>[35,36].includes(p.id))){
      if(change==='child')p.adultAt=v.serverTime+600000;
      if(change==='romance')p.romance={partnerId:p.id===35?36:35,progress:.1};
      if(change==='parent')s.residents.find(x=>x.id===14).parents=[35,36];
      if(change==='cooldown')p.familyCooldownUntil=v.serverTime-1;
      if(change==='manual')p.parents=[];
      if(change==='injured')p.hp=20;
      if(change==='special')p.roomId=8;
    }
    if(change==='incident')s.rooms.find(r=>r.id===5).incident={kind:'fire',hp:10,maxHp:10};
    if(change==='unpowered')s.rooms.find(r=>r.id===5).unpowered=true;
    if(change==='birth')s.births=[{id:1,roomId:5,dueAt:v.serverTime+600000}];
    if(change==='off')context.shelterStaffMode='off';
    const {c}=plan();assert.equal((c.unemployedResidents||[]).length,0,change);
  }
});

function familySetup(){
  const scene=setup(familyGrowthView());scene.context.shelterOptimize=true;
  scene.context.shelterState.families=[{a:6,b:7,room:5}];
  scene.context.Date=class extends Date{static now(){return scene.v.serverTime;}};
  return scene;
}
test('家庭扩产：父母在岗够用但现有岗位无法接替，须用可安全调动的人手扩建水站',()=>{
  for(const level of [1,3]){
    const {v,plan}=familySetup();v.state.rooms.find(r=>r.id===3).level=level;
    const before=JSON.stringify(v),{m,c,p}=plan();
    assert.ok(m.production.water>16*1.2);assert.equal(p.next.status,'ready');assert.equal(p.next.project.kind,'build');
    assert.equal(p.next.project.type,'water');assert.ok(p.next.project.gain>0);
    assert.deepEqual(Array.from(c.populationFamilySupply.family),[6,7,5]);
    assert.ok(c.populationFamilySupply.resources.water.capacity<16*1.2);
    assert.match(p.notes.join('\n'),/原家庭.*离岗.*接替/);assert.equal(JSON.stringify(v),before);
  }
});
test('家庭扩产：目标已满、非人口模式、冷却或宿舍不可用时不为原家庭预建生产房',()=>{
  for(const change of ['target','mode','cooldown','occupied','unpowered','birth','mood','stock','injured']){
    const {v,context,plan}=familySetup(),s=v.state;
    if(change==='target')context.shelterPopulationTarget=15;
    if(change==='mode')context.shelterStaffMode='production';
    if(change==='cooldown')s.residents.find(p=>p.id===6).familyCooldownUntil=v.serverTime+3600000;
    if(change==='occupied')s.residents.find(p=>p.id===13).roomId=5;
    if(change==='unpowered')s.rooms.find(r=>r.id===5).unpowered=true;
    if(change==='birth')s.births=[{id:1,roomId:5,parents:[6,7],dueAt:v.serverTime+3600000}];
    if(change==='mood')s.residents.find(p=>p.id===6).happiness=49;
    if(change==='stock')s.resources.water=31;
    if(change==='injured')s.residents.find(p=>p.id===6).hp=20;
    const {c,p}=plan();assert.equal(c.populationFamilySupply??null,null,change);
    assert.ok(!p.candidates.some(c=>c.kind==='build'&&c.type==='water'),change);
  }
});
test('家庭扩产：计划已预留的父母不能再次用于家庭扩产',()=>{
  const {api,v}=familySetup(),m=api.model(v);
  assert.equal(api.familySupply(m,{reserved:[6],dailyReserved:[]}),null);
  assert.equal(api.familySupply(m,{reserved:[],dailyReserved:[7]}),null);
});
test('家庭扩产：已有水站工程先等完工，替代者容量足够后不继续扩建',()=>{
  const {v,plan}=familySetup(),s=v.state;
  s.rooms.push({...s.rooms.find(r=>r.id===3),id:200,floor:5,col:2,width:2,level:1,builtAt:v.serverTime+600000});
  let result=plan();assert.ok(!result.p.candidates.some(c=>c.kind==='build'&&c.type==='water'));
  assert.match(result.p.notes.join('\n'),/原家庭.*工程.*完工/);
  s.rooms.find(r=>r.id===200).builtAt=0;result=plan();
  assert.equal(result.c.populationFamilySupply??null,null);assert.ok(!result.p.candidates.some(c=>c.kind==='build'&&c.type==='water'));
});
test('家庭扩产：可接替的其他原家庭或成年子女优先，不替困难家庭提前消费',()=>{
  for(const kind of ['family','adultChild']){
    const {v,context,plan}=familySetup();
    if(kind==='family')context.shelterState.families.push({a:9,b:10,room:6});
    else {
      // 两名父母都在一格1级水站时，任一人腾位就断供；必须有真实的安全交接余量。
      v.state.rooms.find(r=>r.id===3).level=2;
      for(const id of [9,10])Object.assign(v.state.residents.find(p=>p.id===id),{
        roomId:6,familyCooldownUntil:0,parents:[1,2],stats:{...v.state.residents[0].stats,per:17}});
    }
    const before=JSON.stringify({v,state:context.shelterState});
    const {c,p}=plan();assert.equal(c.populationFamilySupply??null,null,kind);
    assert.equal(JSON.stringify({v,state:context.shelterState}),before,'handover preview must not move residents or save a plan');
    assert.ok(!p.candidates.some(c=>c.kind==='build'&&c.type==='water'),kind);
  }
});
test('家庭扩产：特殊岗位不作为扩产人手，联合抽调不能损伤其他基础供应',()=>{
  const {v,plan}=familySetup(),s=v.state;
  for(const p of s.residents)if(![6,7].includes(p.id)&&p.roomId===4)p.roomId=8;
  const {c,p}=plan();assert.ok(c.populationFamilySupply);
  const info=c.populationFamilySupply.resources.water;assert.equal(info.gain,0);
  assert.equal(info.donors.length,0);assert.ok(!p.candidates.some(c=>c.kind==='build'&&c.type==='water'));
});
test('家庭扩产：升级候选按安全接替者评估，不能使用父母原产量',()=>{
  const {v,plan}=familySetup();
  for(const p of v.state.residents)if(![6,7].includes(p.id))p.stats.per=2;
  Object.assign(v.state.rooms.find(r=>r.id===3),{level:2});
  const {p,c}=plan(),upgrade=p.candidates.find(c=>c.kind==='upgrade'&&c.id===3);assert.ok(upgrade);
  assert.ok(c.populationFamilySupply.resources.water.capacity<19.2);
  assert.match(upgrade.benefit,/接替容量/);
});
test('家庭扩产：理论最终容量足够但满员腾位会断供时，仍需准备可安全交接的产能',()=>{
  const {v,plan}=familySetup(),s=v.state;
  s.rooms.find(r=>r.id===3).level=2;
  s.rooms.push({...s.rooms.find(r=>r.id===3),id:108,floor:1,col:7,level:1});
  for(const [id,room] of [[3,3],[6,2],[7,108],[8,108],[9,3]])s.residents.find(p=>p.id===id).roomId=room;
  const {c,p}=plan();assert.ok(c.populationFamilySupply,'inaccessible final capacity must not suppress transition construction');
  assert.equal(p.next.status,'ready');assert.ok(['build','upgrade'].includes(p.next.project.kind));assert.equal(p.next.project.type,'water');
});
test('家庭扩产：已有安全换位时只预览不消费，也不保存或推进人员原计划',()=>{
  const {v,context,plan}=familySetup(),s=v.state;
  s.rooms.find(r=>r.id===3).level=3;
  s.rooms.push({...s.rooms.find(r=>r.id===3),id:108,floor:1,col:7,level:1});
  for(const id of [3,8])s.residents.find(p=>p.id===id).roomId=108;
  const before=JSON.stringify(context.shelterState),{c,p}=plan();
  assert.equal(c.populationFamilySupply,null);assert.ok(!p.candidates.some(c=>c.type==='water'));
  assert.equal(JSON.stringify(context.shelterState),before,'scheduling preview must not start a swap or write reservations');
});

test('人口扩产：当前口粮够但下一人口不足，满员水站应列为升级项目，不能只等待生育',()=>{
  const {v,plan}=setup(),before=JSON.stringify(v),{m,c,p}=plan();
  assert.equal(m.demand.water,15);assert.ok(m.production.water>=18&&m.production.water<19.2);
  assert.equal(p.next.status,'ready');assert.equal(p.next.project?.kind,'upgrade');assert.equal(p.next.project?.id,3);
  assert.equal(c.populationPreparation,16,'only the next additional adult mouth is prepared, not all thirty at once');
  assert.match(p.notes.join('\n'),/下一.*16.*口粮/);assert.equal(JSON.stringify(v),before,'planning cannot add people or debit resources');
});

test('人口扩产：生产模式及已到人口目标不额外预留，已有待产或感情名额不重复增加',()=>{
  for(const mode of ['off','production','family']){
    const {context,plan}=setup();context.shelterStaffMode=mode;
    const {c,p}=plan();assert.equal(c.populationPreparation,null);assert.notEqual(p.next.project?.id,3);
  }
  let scene=setup();scene.context.shelterPopulationTarget=14;
  assert.equal(scene.plan().c.populationPreparation,15);assert.notEqual(scene.plan().p.next.project?.id,3);
  for(const kind of ['birth','romance']){
    scene=setup();const s=scene.v.state;
    if(kind==='birth')s.births=[{id:1,roomId:5,parents:[13,14],dueAt:scene.v.serverTime+3600000}];
    else {s.residents[12].romance={partnerId:14,progress:.2};s.residents[13].romance={partnerId:13,progress:.2};}
    assert.equal(scene.plan().c.populationPreparation,16,'an existing reserved child is not followed by an extra speculative mouth');
  }
});

test('人口扩产：已开工水站足够供应下一人口时等待完工，完成后不继续为同一口粮缺口扩建',()=>{
  const {v,plan}=setup(),water=v.state.rooms.find(r=>r.id===3);water.upgradeAt=v.serverTime+3600000;
  let result=plan();assert.notEqual(result.p.next.project?.id,3);assert.match(result.p.notes.join('\n'),/净水站.*先等现有工程/);
  water.upgradeAt=null;water.level=2;v.serverTime+=3600000;v.state.lastSettledAt=v.serverTime;
  result=plan();assert.ok(result.m.production.water>=16*1.2);assert.notEqual(result.p.next.project?.id,3);
});
