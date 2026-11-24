import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {populationGrowthView,familyGrowthView,familyTrainingSeatView,workshopChurnView,reservedGrowthView} from './arkengine-shelter-campaign.fixture.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
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
    ({model:shelterModel,campaign:shelterCampaignSchedule,development:shelterDevelopmentPlan,staff:shelterStaffPlan,familySupply:shelterPopulationFamilySupply,
      preparation:shelterPopulationPreparation})`,context);
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

test('下挖就业修复：旧层可用岗位工程不等扩层，原预算和供给保护保持',()=>{
  const x=adultJobsSetup(),s=x.v.state;
  s.digging={floor:s.depth+1,doneAt:x.v.serverTime+3*3600000};
  const p=x.plan().p;
  assert.equal(p.next.status,'ready',JSON.stringify(p.next));
  assert.equal(p.next.project.kind,'build');assert.equal(p.next.project.employment,true);
  assert.ok(p.next.project.floor<=s.depth);
  s.resources.scrap=0;
  assert.notEqual(x.plan().p.next.status,'ready','不能借并行建设绕过资金限制');
});

test('下挖就业修复：旧层无可建位置仍等现有下挖，不另开普通升级',()=>{
  const x=restingJobsSetup();x.v.state.digging={floor:x.v.state.depth+1,doneAt:x.v.serverTime+3*3600000};
  assert.equal(x.plan().p.next.kind,'employment');assert.equal(x.plan().p.next.status,'waiting');
});
test('成年就业：回收岗位已满时，宿舍里的未成家成年子女也能驱动生产扩建',()=>{
  const {plan,v}=adultJobsSetup(),before=JSON.stringify(v),{c,p}=plan();
  assert.deepEqual(Array.from(c.unemployedResidents||[]),[35,36]);
  assert.equal(p.next.status,'ready',JSON.stringify(p.next));assert.equal(p.next.project.kind,'build');assert.equal(p.next.project.type,'scrap');
  assert.ok(p.next.project.gain>0);assert.equal(JSON.stringify(v),before,'planning does not evict children into rest');
});
test('成年就业：儿童、实际感情、受伤、待产归属不明与特殊岗位不能算作自动扩建人手',()=>{
  for(const change of ['child','romance','injured','special','incident','unpowered','birth','off']){
    const {v,context,plan}=adultJobsSetup(),s=v.state;
    for(const p of s.residents.filter(p=>[35,36].includes(p.id))){
      if(change==='child')p.adultAt=v.serverTime+600000;
      if(change==='romance')p.romance={partnerId:p.id===35?36:35,progress:.1};
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
test('成年就业：曾育子女、冷却结束和历史手动住宿均不构成永久排除',()=>{
  for(const change of ['parent','cooldown','manual']){
    const {v,plan}=adultJobsSetup(),s=v.state;
    if(change==='parent')s.residents.find(p=>p.id===14).parents=[35,36];
    for(const p of s.residents.filter(p=>[35,36].includes(p.id))){
      if(change==='cooldown')p.familyCooldownUntil=v.serverTime-1;
      if(change==='manual')p.parents=[];
    }
    const {c,p}=plan();assert.deepEqual(Array.from(c.unemployedResidents),[35,36],change);
    assert.ok(p.next.project.employment);assert.equal(p.next.project.type,'scrap');
  }
});

function restingJobsSetup(){
  const saved=JSON.parse(readFileSync(new URL('./arkengine-shelter-employment-space.fixture.json',import.meta.url),'utf8'));
  const scene=setup(saved.view),s=scene.v.state;
  scene.context.shelterState=saved.state;scene.context.shelterLevelTarget=10;
  scene.context.Date=class extends Date{static now(){return scene.v.serverTime;}};
  s.rooms.find(r=>r.id===1002).level=3;scene.v.progress.score++;
  s.resources.scrap-=480;s.resources.parts=0;delete saved.state.campaign.materials;
  for(const id of [48,49])s.residents.find(p=>p.id===id).roomId=null;
  return scene;
}

test('休息就业：满层时健康闲置成人也需新岗位，旧站升级不能替代扩层',()=>{
  const {v,plan}=restingJobsSetup(),before=JSON.stringify(v),{p}=plan();
  assert.equal(p.next.project?.kind,'dig',JSON.stringify(p.next));
  assert.equal(p.next.project.purpose.type,'scrap');assert.ok(p.next.project.employment);
  assert.equal(p.next.status,'ready');assert.equal(JSON.stringify(v),before);
});

test('休息就业：人员管理关闭、暂停、受伤、姓名缺失或已有工程预留时不提高岗位建设优先级',()=>{
  for(const change of ['off','hold','injured','unidentified','reserved','pending']){
    const {v,context,api}=restingJobsSetup(),s=v.state;
    if(change==='off')context.shelterStaffMode='off';
    if(change==='hold')context.shelterStaffHold='手动暂停';
    for(const p of s.residents.filter(p=>[48,49].includes(p.id))){
      if(change==='injured')p.hp=1;
      // 新UI可用居民ID区分同名；真正缺少姓名才无法建立调岗身份。
      if(change==='unidentified')p.name='';
    }
    const m=api.model(v),c=api.campaign(m);
    if(change==='reserved')c.dailyReserved=[48,49];
    if(change==='pending'){
      s.depth=5;s.rooms.push({...s.rooms.find(r=>r.type==='elevator'),id:2999,floor:5},
        {...s.rooms.find(r=>r.type==='scrap'),id:3000,floor:5,col:2,width:1,level:1,builtAt:v.serverTime+600000});
    }
    const p=api.development(api.model(v),30,c,10);
    assert.ok(!p.candidates.some(x=>x.employment),change);
  }
});

function familySetup(){
  const scene=setup(familyGrowthView());scene.context.shelterOptimize=true;
  scene.context.shelterState.families=[{a:6,b:7,room:5}];
  scene.context.Date=class extends Date{static now(){return scene.v.serverTime;}};
  return scene;
}

function familyTrainingSeatSetup(){
  const scene=familySetup();scene.v.state=familyTrainingSeatView(scene.v.serverTime).state;
  for(const p of scene.v.state.residents.filter(p=>[6,7].includes(p.id)))for(const stat of Object.keys(p.stats))p.stats[stat]=10;
  // Isolate existing production return-seat commitments from new breeding enrollment.
  scene.context.shelterCampaign={...scene.context.shelterCampaign,training:true,trainTarget:10,parentPreparation:false};
  scene.context.shelterState.campaign.roles=[11,12].map(id=>({id,room:8,role:'training',at:scene.v.serverTime,
    stat:'per',base:0,purpose:'production',until:scene.v.serverTime+4*3600000,
    windowEnd:scene.v.serverTime+168*3600000,destination:108}));
  return scene;
}

test('家庭训练预留：取消长期占位后复用现有空岗接替父母，无需额外建房',()=>{
  const {v,context,plan,api}=familyTrainingSeatSetup(),before=JSON.stringify([v,context.shelterState]),{c,p}=plan();
  assert.equal(c.trainingDestinations.length,0);
  assert.equal(c.populationFamilySupply,null);assert.equal(p.next.project,undefined);
  const staff=api.staff(api.model(v));assert.equal(staff?.room,108,'use the real vacancy before construction');
  assert.ok(v.state.residents.filter(p=>[11,12].includes(p.id)).every(p=>p.roomId===8&&p.training===.5));
  assert.equal(JSON.stringify([v,context.shelterState]),before,'preview does not start a swap or change training');
});

test('家庭训练预留：解除预约后复用现有空岗，重复和已返岗记录不额外扣座',()=>{
  const {v,api}=familyTrainingSeatSetup(),m=api.model(v);
  const base={reserved:[11,12],dailyReserved:[],trainingDestinations:[],defense:{busy:false}};
  assert.equal(api.familySupply(m,base),null,'real vacancies allow safe existing preparation');
  const held={...base,trainingDestinations:[{id:11,room:108},{id:12,room:108}]};
  const supply=api.familySupply(m,held);assert.ok(supply);
  assert.deepEqual(api.familySupply(m,{...held,trainingDestinations:[...held.trainingDestinations,...held.trainingDestinations]}),supply);
  for(const id of [11,12])v.state.residents.find(p=>p.id===id).roomId=108;
  const returned=api.model(v);
  assert.equal(api.familySupply(returned,held),api.familySupply(returned,base),'already occupied seats are not reserved a second time');
});
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
test('家庭扩产并行：无关回收站还需九小时，现有供给和接替者齐全时不暂停十分钟净水站建设',()=>{
  const {v,plan}=familySetup(),s=v.state;
  s.rooms.push({...s.rooms.find(r=>r.id===4),id:200,floor:5,col:2,level:2,stored:0,upgradeAt:v.serverTime+9*3600000});
  const before=JSON.stringify(v),{c,p}=plan();
  assert.ok(c.populationFamilySupply.resources.water.donors.length>0);
  assert.equal(c.populationFamilySupply.resources.water.pending.length,0,'无关回收工程不是补水前置');
  assert.equal(p.next.status,'ready');assert.equal(p.next.project.type,'water');assert.equal(p.next.project.kind,'build');
  assert.equal(p.next.project.hours,1/6);assert.equal(p.next.project.cost.scrap,120);
  assert.equal(JSON.stringify(v),before,'不预支库存、完工或人员调动');
});
test('家庭扩产并行：同类水站施工、名额用满、供给不足或接替者仍在施工中时仍须等待',()=>{
  for(const kind of ['same-resource','two-projects','power','workers']){
    const {v,plan}=familySetup(),s=v.state;
    s.rooms.push({...s.rooms.find(r=>r.id===4),id:200,floor:5,col:2,level:2,stored:0,upgradeAt:v.serverTime+9*3600000});
    if(kind==='same-resource')s.rooms.at(-1).type='water';
    if(kind==='two-projects')s.rooms.push({...s.rooms.at(-1),id:201,floor:6});
    if(kind==='power')s.residents.filter(p=>p.roomId===1).forEach(p=>p.stats.str=0);
    if(kind==='workers')s.rooms.find(r=>r.id===4).upgradeAt=v.serverTime+9*3600000;
    const {c,p}=plan();
    assert.ok(!(p.next.status==='ready'&&p.next.project?.type==='water'),kind);
    if(kind==='same-resource')assert.ok(c.populationFamilySupply.resources.water.pending.includes(200));
    if(kind==='two-projects')assert.match(p.next.reason,/施工名额/);
  }
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
  const {v,plan}=setup();
  // 本场单独验证未来口粮扩产；普通宿舍成人先处于真实有空位的生产房。
  for(const id of [13,14])v.state.residents.find(p=>p.id===id).roomId=4;
  const before=JSON.stringify(v),{m,c,p}=plan();
  assert.equal(m.demand.water,15);assert.ok(m.production.water>=18&&m.production.water<19.2);
  assert.equal(p.next.status,'ready');assert.equal(p.next.project?.kind,'upgrade');assert.equal(p.next.project?.id,3);
  assert.equal(c.populationPreparation,16,'only the next additional adult mouth is prepared, not all thirty at once');
  assert.match(p.notes.join('\n'),/下一.*16.*口粮/);assert.equal(JSON.stringify(v),before,'planning cannot add people or debit resources');
});

function reservedGrowthWithJobs(){
  const v=reservedGrowthView();
  // Isolate supply preparation with real seats for the four parents, two
  // trainees and two committed children. Keep the original six-seat room full.
  v.state.rooms.push({...v.state.rooms.find(r=>r.id===4),id:99,floor:4,col:2,level:1,stored:0});
  return v;
}

test('人口扩产：21人两对预约且后续岗位有保障时为第24人口备供给，空宿舍不抢建',()=>{
  const {v,context,plan}=setup(reservedGrowthWithJobs());context.shelterPopulationTarget=50;
  const before=JSON.stringify(v),{m,c,p}=plan();
  assert.equal(m.populationCap,24);assert.ok(m.production.food>=27.6&&m.production.food<28.8);
  assert.ok(m.production.water>=27.6&&m.production.water<28.8);
  assert.equal(c.populationPreparation,24);
  assert.ok(p.candidates.filter(c=>c.type==='quarters').every(c=>c.priority>=70));
  assert.ok(['diner','water'].includes(p.next.project?.type),JSON.stringify(p.next));
  assert.equal(JSON.stringify(v),before);
});

test('人口扩产：预约之外无健康可调父母或空宿舍，不额外预支下一人口',()=>{
  for(const change of ['cooldown','related','name','training','room','target','capacity','pending']){
    const {v,context,plan}=setup(reservedGrowthView()),s=v.state;context.shelterPopulationTarget=50;
    const free=s.residents.filter(p=>[1,2,3,4].includes(p.roomId));
    if(change==='cooldown')free.forEach(p=>p.familyCooldownUntil=v.serverTime+60000);
    if(change==='related')free.forEach(p=>p.parents=[20,21]);
    if(change==='name')free.forEach(p=>p.name='');
    if(change==='training')free.forEach(p=>p.roomId=8);
    if(change==='room')s.rooms.find(r=>r.id===6).unpowered=true;
    if(change==='target')context.shelterPopulationTarget=23;
    if(change==='capacity')s.rooms.find(r=>r.id===6).width=2;
    if(change==='pending')context.shelterPending={kind:'assign'};
    assert.equal(plan().c.populationPreparation,23,change);
  }
});

test('人口扩产：已有床位够下一人但供给工程缺料时，宿舍不能绕过优先级抢预算',()=>{
  const {v,context,plan}=setup(reservedGrowthWithJobs());context.shelterPopulationTarget=50;
  v.state.resources.scrap=300;
  const {p}=plan();assert.ok(['diner','water'].includes(p.next.project?.type),JSON.stringify(p.next));
  assert.ok(p.candidates.filter(c=>c.type==='quarters').every(c=>c.priority>=70));
});

test('人口扩产：补足当前口粮后仍先落实已有床位内的父母，不能在接替途中抢建宿舍',()=>{
  const {v,context,plan}=setup(reservedGrowthWithJobs());context.shelterPopulationTarget=50;
  for(const p of v.state.residents)if([2,3].includes(p.roomId)){p.stats.agi=12;p.stats.per=12;}
  const {m,c,p}=plan();assert.ok(m.production.food>28.8&&m.production.water>28.8);
  assert.equal(c.populationPreparation,24);
  assert.ok(p.candidates.filter(c=>c.type==='quarters').every(c=>c.priority>=70));
});

test('人口扩产：成年子女先就业，就业后才为额外家庭备供给，不解除既有预约',()=>{
  const {v,context,plan}=setup(reservedGrowthWithJobs());context.shelterPopulationTarget=50;
  const child=v.state.residents.at(-1);Object.assign(child,{away:null,roomId:5,parents:[17,18]});
  assert.equal(plan().c.populationPreparation,23);
  child.roomId=4;assert.equal(plan().c.populationPreparation,24,'就业不再是额外家庭的硬前提，实际产量仍按六岗计算');
  child.roomId=1;assert.equal(plan().c.populationPreparation,24,'进入有容量的有效岗位后自动恢复准备');
});

test('人口扩产：未来岗位缺口继续报告，不再强制暂停额外家庭供给准备',()=>{
  const {v,context,plan}=setup(reservedGrowthView());context.shelterPopulationTarget=50;
  const before=plan();assert.equal(before.c.populationPreparation,24);
  assert.equal(before.c.futureEmployment.allowed,false);assert.equal(before.c.futureEmployment.missing.length,2);
  v.state.rooms.push(reservedGrowthWithJobs().state.rooms.at(-1));
  assert.equal(plan().c.populationPreparation,24);
});

test('人口扩产：其他任务预留和失败配对冷却不能被下一人口准备绕过',()=>{
  const {v,api,context}=setup(reservedGrowthView());context.shelterPopulationTarget=50;
  const ids=v.state.residents.filter(p=>[1,2,3,4].includes(p.roomId)).map(p=>p.id),m=api.model(v);
  for(const campaign of [{reserved:ids},{dailyReserved:ids},{defense:{busy:true}}])
    assert.equal(api.preparation(m,[],campaign),23);
  context.shelterState.pairBlocks=ids.flatMap((a,i)=>ids.slice(i+1).map(b=>({a,b,until:Date.now()+3600000})));
  assert.equal(api.preparation(m,[]),23);
});

test('人口扩产：床位已满仍保留扩容，在建床位够用则不重复开工',()=>{
  const {v,context,plan}=setup(reservedGrowthView());context.shelterPopulationTarget=50;
  v.state.residents.push({...structuredClone(v.state.residents.at(-1)),id:22,name:'居民22'});
  let result=plan();assert.ok(result.p.candidates.some(c=>c.type==='quarters'&&c.priority<70));
  v.state.rooms.push({...v.state.rooms.find(r=>r.id===6),id:99,floor:4,col:2,width:1,builtAt:v.serverTime+600000});
  result=plan();assert.ok(result.p.candidates.filter(c=>c.type==='quarters').every(c=>c.priority>=70));
});

test('人口扩产：已预约满床且供给就绪时，必要扩容先于旧等级工程备料',()=>{
  const {v,context,plan}=setup(reservedGrowthView());context.shelterPopulationTarget=50;
  v.state.residents.push({...structuredClone(v.state.residents.at(-1)),id:22,name:'居民22'});
  for(const p of v.state.residents)if([2,3].includes(p.roomId)){p.stats.agi=12;p.stats.per=12;}
  v.state.resources.scrap=2200;v.state.resources.parts=0;
  context.shelterState.campaign.materials={vaultNo:77,id:4,type:'scrap',level:3,targetLevel:6,finalTarget:6};
  const before=JSON.stringify(context.shelterState),{p}=plan();
  assert.equal(p.next.project?.type,'quarters',JSON.stringify(p.next));
  assert.equal(p.next.status,'ready');assert.ok(p.next.project.priority<25);
  assert.equal(JSON.stringify(context.shelterState),before,'priority change does not erase the old material record or spend money');
});

test('人口扩产：生产模式及已到人口目标不额外预留，已有预约仅再准备一个可执行名额',()=>{
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
    if(kind==='birth'){
      assert.equal(scene.plan().c.populationPreparation,16,'先让可返岗的待产父母就业，再准备额外一对');
      for(const id of [13,14])s.residents.find(p=>p.id===id).roomId=4;
    }
    assert.equal(scene.plan().c.populationPreparation,17,'one reserved child plus one additional pair, not all remaining targets');
    for(const p of s.residents)if(![13,14].includes(p.id))p.familyCooldownUntil=scene.v.serverTime+60000;
    assert.equal(scene.plan().c.populationPreparation,16,'without another eligible pair the original reservation is not counted twice');
  }
});

test('人口扩产：已开工水站足够供应下一人口时等待完工，完成后不继续为同一口粮缺口扩建',()=>{
  const {v,plan}=setup(),water=v.state.rooms.find(r=>r.id===3);water.upgradeAt=v.serverTime+3600000;
  let result=plan();assert.notEqual(result.p.next.project?.id,3);assert.match(result.p.notes.join('\n'),/净水站.*先等现有工程/);
  water.upgradeAt=null;water.level=2;v.serverTime+=3600000;v.state.lastSettledAt=v.serverTime;
  result=plan();assert.ok(result.m.production.water>=16*1.2);assert.notEqual(result.p.next.project?.id,3);
});
