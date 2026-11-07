import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView,workshopChurnView,dormWorkshopCycleView,familyWorkshopCycleView,workshopFamilyReturnView,workshopUpgradeView,multiWorkshopView,workshopBuildView,workshopBudgetCycleView,workshopPowerCycleView,materialProducerCycleView} from './arkengine-shelter-campaign.fixture.mjs';
const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const segment=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const implementation=[declarations,segment('  function shelterWorkerRate(','  function readShelter('),
  segment('  const staffRoomTypes =','  function shelterExploreStep('),
  segment('  function shelterCampaignSchedule(','  function shelterDailyClaimStep('),
  segment('  function recordShelterCampaign(','  function shelterFormValue('),
  segment('  function shelterConstructionChoice(','  function shelterBuildTitle(')].join('\n');

test('持续人口家庭接替：后备家庭的普通回收增产不能撤销前一家庭已补好的净水',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./arkengine-shelter-population-level.fixture.json',import.meta.url),'utf8'));
  const {v,api,context}=setup(fixture.view,false);
  context.shelterState=fixture.state;context.shelterPopulationTarget=40;context.shelterLevelTarget='auto';context.shelterOptimize=true;
  const seen=new Set(),moves=[];
  for(let i=0;i<12;i++){
    const fingerprint=JSON.stringify({residents:v.state.residents.map(p=>[p.id,p.roomId,p.romance]),state:context.shelterState});
    assert.ok(!seen.has(fingerprint),JSON.stringify(moves));seen.add(fingerprint);
    const m=api.model(v),a=api.campaign(m).choice||api.staff(m);if(!a)break;
    assert.ok(!a.kind||a.kind==='assign');
    const p=v.state.residents.find(p=>p.id===a.id);moves.push([a.id,p.roomId,a.room,a.reason]);p.roomId=a.room;
    if(a.role)api.record({kind:a.kind||'assign',targets:a.targets||[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  }
  assert.ok(!moves.some((a,i)=>a[0]===8&&a[1]===3&&a[2]===4&&moves.slice(i+1).some(b=>b[0]===8&&b[1]===4&&b[2]===3)),JSON.stringify(moves));
});

test('深层预算边界：固定30人15级所需下挖单笔10268超过10000总额度，等待恢复不能解锁',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./arkengine-shelter-population-level.fixture.json',import.meta.url),'utf8'));
  const {v,api,context,plan}=setup(fixture.view,false);
  context.shelterState=fixture.state;context.shelterPopulationTarget=30;context.shelterLevelTarget='auto';context.shelterOptimize=true;
  const {m,p}=plan(),project=p.next.project;
  assert.equal(project.kind,'dig');assert.equal(project.floor,24);assert.equal(project.cost.scrap,10268);
  assert.match(api.allowance(project,m,context.shelterConstruction,context.shelterState,null,v.serverTime),/单笔需 10268.*总额度 10000.*等待额度恢复也不足/);
  assert.equal(api.construction(m),null);assert.equal(context.shelterConstruction.scrapLimit,10000);
});
function setup(v=workshopChurnView(),explore=true){
  const context={objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'},
    shelterStaffMode:'population',shelterStaffHold:'',shelterOptimize:false,shelterGear:false,shelterPopulationTarget:14,shelterLevelTarget:10,
    shelterConstruction:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0},
    shelterState:{campaign:{roles:[{id:21,room:50,role:'workshop',at:v.serverTime}],trips:[],attempts:[],heals:[],trainingRest:[]}},
    shelterPending:null,shelterRead:null,shelterCaravanNote:'',shelterConstructionNote:'',shelterStaffNote:'',shelterPopulationNote:'',shelterSocialNote:'',
    Date:class extends Date{constructor(...args){super(...(args.length?args:[v.serverTime]));}static now(){return v.serverTime;}},
    crypto:{randomUUID:()=>String(v.serverTime)},log:{add:()=>{}},workshopAutomatic:()=>true};
  context.saveShelter=x=>context.shelterState=x;
  const api=vm.runInNewContext(`${implementation}\nshelterCampaign={...campaignDefaults,explore:${explore},sodaEfficiency:true};
    ({model:shelterModel,campaign:shelterCampaignSchedule,staff:shelterStaffPlan,record:recordShelterCampaign,development:shelterDevelopmentPlan,
      valid:validCampaignRecord,releasePreview:shelterWorkshopReleasePlan,powerReserve:shelterConstructionPowerReserve,populationDiagnostics:shelterPopulationDiagnostics,
      allowance:shelterConstructionAllowance,construction:shelterConstructionChoice,materials:shelterConstructionMaterials,
      startCache:()=>shelterCampaignSchedule.cache={},endCache:()=>delete shelterCampaignSchedule.cache,
      raw:(m,cfg)=>shelterCampaignPlan(m,{...campaignDefaults,...cfg},shelterState.campaign,30)})`,context);
  const plan=()=>{const m=api.model(v),c=api.campaign(m);return {m,c,p:api.development(m,context.shelterPopulationTarget,c,context.shelterLevelTarget)};};
  return {v,context,api,plan};
}

function employmentSetup(){
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-employment-space.fixture.json',import.meta.url),'utf8'));
  const scene=setup(snapshot.view,false),{context}=scene;
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  return scene;
}
function employmentPrioritySetup(){
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-employment-priority.fixture.json',import.meta.url),'utf8'));
  const scene=setup(snapshot.view,false),{context}=scene;
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;
  return scene;
}

test('成年就业接岗：扩建补电腾出回收空岗后先安排待就业子女，不把补电居民立即调回',()=>{
  const {v,context,api,plan}=employmentPrioritySetup(),before=structuredClone(v.state.resources);
  assert.deepEqual(Array.from(plan().c.unemployedResidents),[43]);
  const power=api.staff(api.model(v));assert.equal(power.id,1);assert.equal(power.room,1);
  v.state.residents.find(p=>p.id===power.id).roomId=power.room;
  const next=api.staff(api.model(v));assert.equal(next.id,43,'空岗优先消化待就业子女，不能重新抽回补电人员');
  assert.equal(next.room,1004);assert.equal(next.from,1003);
  v.state.residents.find(p=>p.id===next.id).roomId=next.room;
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  assert.ok(!plan().c.unemployedResidents.includes(43));assert.equal(v.state.residents.find(p=>p.id===1).roomId,1);
  assert.deepEqual(v.state.resources,before,'安排岗位不提前领取、建房或改保留量');
  assert.equal(context.shelterConstruction.scrapReserve,100);
  const following=api.staff(api.model(v));assert.ok(following?.id!==1||following?.room!==1004);
});

test('成年就业接岗边界：人工宿舍成人、未成年、外出和伤员不借就业优先移走',()=>{
  for(const kind of ['manual','child','away','injured']){
    const {v,api}=employmentPrioritySetup(),p=v.state.residents.find(p=>p.id===43);
    v.state.residents.find(p=>p.id===1).roomId=1;
    if(kind==='manual')p.parents=[];
    if(kind==='child')p.adultAt=v.serverTime+60000;
    if(kind==='away')p.away={kind:'explore'};
    if(kind==='injured')p.hp=1;
    assert.notEqual(api.staff(api.model(v))?.id,43,kind);
  }
});

test('成年就业空间：旧回收站升级不增加岗位，不能挡住两名成年子女所需的扩层',()=>{
  for(const target of [7,10]){
    const {v,context,api,plan}=employmentSetup();context.shelterLevelTarget=target;
    const before=JSON.stringify({v,state:context.shelterState}),{m,c,p}=plan();
    assert.deepEqual(Array.from(c.unemployedResidents),[48,49]);assert.equal(api.staff(m),null,'现有生产岗已满');
    assert.ok(p.candidates.some(c=>c.kind==='upgrade'&&c.type==='scrap'),'仍保留原回收增产候选');
    const jobs=p.candidates.find(c=>c.kind==='dig'&&c.employment);
    assert.ok(jobs,'增产升级不能抹掉待就业子女需要的新岗位');assert.equal(jobs.purpose.type,'scrap');
    assert.equal(api.allowance(jobs,m,context.shelterConstruction,context.shelterState,null,v.serverTime),'');
    assert.equal(JSON.stringify({v,state:context.shelterState}),before,'规划不预先腾岗或扣除扩层费用');
    if(target===10){
      assert.equal(p.next.project.id,1002,'原已确认备料不被新增岗位来回抢走');
      // 提供原工程已完工的状态，再验证仍有其他旧房可升也先补就业空间。
      v.state.rooms.find(r=>r.id===1002).level=3;v.progress.score++;
      v.state.resources.scrap-=480;v.state.resources.parts=0;delete context.shelterState.campaign.materials;
    }
    assert.equal(plan().p.next.project?.kind,'dig');assert.equal(plan().p.next.status,'ready');
  }
});

test('成年就业空间：儿童、手动宿舍成人、已预留施工岗位或人员关闭时不提前为就业扩层',()=>{
  for(const kind of ['child','manual','pending-jobs','off']){
    const {v,context,plan}=employmentSetup(),s=v.state;
    if(kind==='child')for(const p of s.residents.filter(p=>[48,49].includes(p.id)))p.adultAt=v.serverTime+3600000;
    if(kind==='manual')for(const p of s.residents.filter(p=>[48,49].includes(p.id)))p.parents=[];
    if(kind==='off')context.shelterStaffMode='off';
    if(kind==='pending-jobs'){
      // 合成场将一格空容量房定义为在建回收房；不会挤出旧生产者制造新的待就业人数。
      const room=s.rooms.find(r=>r.id===1004);
      Object.assign(room,{type:'scrap',level:1,builtAt:v.serverTime+3600000,upgradeAt:null});
    }
    const {p}=plan();assert.ok(!p.candidates.some(c=>c.employment),kind);
  }
});

test('成年就业空间：有需求也不突破下挖开关、预算、保留量、缺电或未知请求',()=>{
  for(const kind of ['off','budget','reserve','power','pending']){
    const {v,context,api,plan}=employmentSetup();context.shelterLevelTarget=7;
    const {m,p}=plan(),project=p.next.project;
    assert.equal(project.kind,'dig');
    if(kind==='off')context.shelterConstruction.dig=false;
    if(kind==='budget')context.shelterConstruction.scrapLimit=project.cost.scrap-1;
    if(kind==='reserve')context.shelterConstruction.scrapReserve=v.state.resources.scrap;
    if(kind==='power')for(const r of v.state.rooms.filter(r=>r.type==='power'))r.unpowered=true;
    const current=kind==='power'?plan():{m,p};
    assert.ok(api.allowance(kind==='power'?current.p.next.project:project,current.m,context.shelterConstruction,context.shelterState,
      kind==='pending'?{kind:'upgrade'}:null,v.serverTime),kind);
  }
});

test('成年就业扩层接续：下挖期间不另开备料占住下一轮，新楼层确认后先建岗位',()=>{
  const {v,context,plan}=employmentSetup(),s=v.state;
  s.rooms.find(r=>r.id===1002).level=3;v.progress.score++;delete context.shelterState.campaign.materials;
  s.resources.parts=0;s.digging={floor:5,doneAt:v.serverTime+3600000};
  let current=plan();assert.equal(current.p.next.status,'waiting');assert.equal(current.p.next.kind,'employment');
  assert.equal(current.c.actions.filter(a=>a.role==='workshop').length,0,'不为另一个普通升级开始新备料');
  s.depth=5;s.digging=null;s.rooms.push({...s.rooms.find(r=>r.type==='elevator'),id:1900,floor:5});v.progress.score+=3;
  current=plan();assert.equal(current.p.next.project.kind,'build');assert.equal(current.p.next.project.type,'scrap');
  assert.equal(current.p.next.project.employment,true);assert.equal(current.p.next.status,'ready');
});

test('成年就业扩层接续：有效原备料继续，旧等级或已失效的材料记录不阻断就业等待',()=>{
  for(const kind of ['valid','target-changed','missing-room','completed']){
    const {v,context,plan}=employmentSetup();v.state.digging={floor:5,doneAt:v.serverTime+3600000};
    if(kind==='target-changed')context.shelterLevelTarget=7;
    if(kind==='missing-room')context.shelterState.campaign.materials.id=99999;
    if(kind==='completed')v.state.rooms.find(r=>r.id===1002).level=3;
    const {p}=plan();
    if(kind==='valid')assert.equal(p.next.project.id,1002);
    else {assert.equal(p.next.status,'waiting',kind);assert.equal(p.next.kind,'employment',kind);}
  }
});

test('普通升级供电等待：当前供给正常但未来升级缺电缺件时，不抽空原生产房造成工坊循环',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-material-power-wait.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false),s=v.state,seen=new Set(),actions=[];
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  for(let step=0;step<14;step++){
    const key=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(key),'同一库存与建设状态不能来回安排工坊');seen.add(key);
    const {m,c,p}=plan();assert.equal(p.next.project?.id,4);assert.equal(p.next.project.levelTarget,undefined);
    assert.ok(p.next.project.blocks.includes('扩建后电力余量不足，先补发电'));
    const a=c.choice||api.staff(m);if(!a)break;
    assert.notEqual(a.from,4,'不能抽空升级房最后生产者使备料目标消失');assert.notEqual(a.role,'workshop-release');
    actions.push(a);s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(step<13);
  }
  assert.ok(actions.length>0);assert.ok(plan().m.production.parts>0);assert.ok(s.residents.some(p=>p.roomId===4));
  context.shelterConstruction.upgrade=false;assert.equal(api.staff(api.model(v))?.from,4,'取消升级后解除最后生产者保护');
});

test('工坊扩建供电接续：先建工坊仍保留原升级的联合用电，不在补电与回收之间往返',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-workshop-power-chain.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false),s=v.state,seen=new Set(),actions=[];
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  const initial=plan();assert.equal(initial.c.workshopPreparation.original.id,4);
  assert.equal(initial.p.next.project.type,'workshop');assert.equal(initial.p.next.project.kind,'build');
  for(let step=0;step<14;step++){
    const key=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(key),'同一工程与库存不能为供电反复调出调入同一人');seen.add(key);
    const {m,c}=plan(),a=c.choice||api.staff(m);if(!a)break;
    actions.push(a);s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(step<13);
  }
  const after=plan();assert.equal(after.p.next.project.type,'workshop');assert.equal(after.p.next.status,'ready');
  assert.ok(after.m.production.power>=(after.m.demand.power+1+3)*1.2-1e-9,'新工坊一格和原回收站三格升级的用电均保留');
  assert.equal(actions.filter(a=>a.reason?.includes('为近期工程预留供电')).length,0,'快照已经补足电力，不应重新补电');
  context.shelterConstruction.upgrade=false;context.shelterConstruction.build=false;
  assert.equal(plan().c.workshopPreparation,null,'关闭原工程后不继续预留备料扩产');
  assert.equal(api.staff(api.model(v))?.from,1,'取消工程后允许多余发电人员恢复回收生产');
});

test('供水施工备料稳定：临时零产量但没有可补供水岗位时，不为回收增产抽空原工程',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-workshop-power-chain.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false),s=v.state;
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  Object.assign(s.rooms.find(r=>r.id===3),{level:2,upgradeAt:v.serverTime+3600000});v.progress.score-=3;
  const {m,c,p}=plan();assert.equal(m.production.water,0);assert.equal(p.next.project.id,4);assert.equal(c.choice,null);
  assert.equal(api.staff(m),null,'供水施工已覆盖停产期，不为普通回收增产撤走原工程最后生产者');
  assert.ok(m.production.parts>0);assert.equal(s.residents.find(p=>p.id===5).roomId,4);
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.equal(api.staff(api.model(v)),null,'刷新后仍稳定备料');
  // 真正存在可补的供水空岗时，救供应仍先于上述普通增产保护。
  s.rooms.find(r=>r.id===3).upgradeAt=null;s.residents.find(p=>p.roomId===3).roomId=null;
  for(const person of s.residents)person.stats.per=person.id===5?10:0;
  const emergency=api.staff(api.model(v));assert.equal(emergency.id,5);assert.equal(emergency.room,3);
  assert.match(emergency.reason,/补足净水供应/);
});

test('原工程额度供电等待：材料已齐但额度未到时不为备选建房反复补电，额度恢复后接续原升级',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-funded-power-wait.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false),s=v.state;
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  const waiting=plan();assert.equal(waiting.p.next.project.id,4,'原项目仍有效，不能因暂缺供电退成另一项建房');
  assert.match(api.allowance({...waiting.p.next.project,blocks:[]},waiting.m,context.shelterConstruction,context.shelterState,null,v.serverTime),/零件剩余额度/);
  assert.equal(api.powerReserve(waiting.p.next.project,waiting.m,context.shelterConstruction,context.shelterState,null,v.serverTime),0);
  // 允许与供电无关且能收敛的满岗优化，不能把“完全不调岗”当成正确行为。
  const seen=new Set();
  for(let step=0;step<8;step++){
    const key=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(key),'额度等待时不能循环调岗');seen.add(key);
    const {m,c,p}=plan();assert.equal(p.next.project.id,4);
    const action=c.choice||api.staff(m);if(!action)break;
    assert.doesNotMatch(action.reason,/为近期工程预留供电/,'原升级额度尚未恢复，不为另一项建房补电');
    s.residents.find(p=>p.id===action.id).roomId=action.room;
    if(action.role)api.record({kind:'assign',targets:[action.id,action.room],before:{campaign:{choice:action}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(step<7);
  }
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.equal(api.staff(api.model(v)),null);
  v.serverTime+=86400001;s.lastSettledAt=v.serverTime;
  const ready=plan(),move=api.staff(ready.m);assert.equal(ready.p.next.project.id,4);
  assert.equal(move.id,1);assert.equal(move.room,1);assert.match(move.reason,/为近期工程预留供电/);
  s.residents.find(p=>p.id===move.id).roomId=move.room;
  const powered=plan();assert.equal(powered.p.next.project.id,4);assert.equal(powered.p.next.status,'ready');
  assert.equal(api.allowance(powered.p.next.project,powered.m,context.shelterConstruction,context.shelterState,null,v.serverTime),'');
  assert.notEqual(api.staff(powered.m)?.from,1,'供电补足后不能再为普通回收调走');
});

test('就绪升级生产者稳定：换位期间候选临时改为发电升级，也不抽空该房并再次补电',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-funded-producer.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false),s=v.state,seen=new Set();
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  assert.equal(plan().p.next.project.type,'storage');assert.equal(context.shelterState.campaign.materials,undefined);
  for(let step=0;step<16;step++){
    const fingerprint=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(fingerprint),'不能抽空即将升级的发电房而在仓库与发电升级间往返');seen.add(fingerprint);
    const {m,c}=plan(),action=c.choice||api.staff(m);if(!action)break;
    s.residents.find(p=>p.id===action.id).roomId=action.room;
    if(action.role)api.record({kind:'assign',targets:[action.id,action.room],before:{campaign:{choice:action}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(step<15);
  }
  // 换位完成并清理记录后，原仓库升级重新成为首选；有效供电必须保持到可实际开工。
  const ready=plan();assert.equal(ready.p.next.project.type,'storage');assert.equal(ready.p.next.project.id,1026);
  assert.equal(ready.p.next.status,'ready');assert.ok(s.residents.some(p=>p.roomId===1027));
  assert.equal(api.allowance(ready.p.next.project,ready.m,context.shelterConstruction,context.shelterState,null,v.serverTime),'');
  assert.equal(api.staff(ready.m),null,'清理换位记录后再次规划仍保持稳定供电');
  context.shelterConstruction.upgrade=false;context.shelterConstruction.build=false;context.shelterConstruction.dig=false;
  assert.equal(api.staff(api.model(v))?.from,1027,'取消建设后不永久锁住多余发电人员');
});

test('发电升级备料稳定：缺件期间保留原房最后生产者，不因回收增产撤工坊再补电',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-power-material-producer.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false),s=v.state,seen=new Set(),actions=[];
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  for(let step=0;step<16;step++){
    const fingerprint=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(fingerprint),'补电后不能抽空发电升级原房，释放工坊后再次补电');seen.add(fingerprint);
    const {m,c}=plan(),action=c.choice||api.staff(m);if(!action)break;
    assert.notEqual(action.from,1026,'当前已确认缺件工程的最后生产者须保留');
    assert.notEqual(action.role,'workshop-release');actions.push(action);
    s.residents.find(p=>p.id===action.id).roomId=action.room;
    if(action.role)api.record({kind:'assign',targets:[action.id,action.room],before:{campaign:{choice:action}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(step<15);
  }
  const waiting=plan();assert.equal(waiting.p.next.project.id,1026);assert.equal(waiting.p.next.project.type,'power');
  assert.ok(waiting.m.production.parts>0);assert.ok(waiting.p.next.project.shortage.parts>0);
  assert.equal(actions.filter(a=>a.room===1026).length,1,'只补一次发电岗位');
  assert.equal(api.staff(waiting.m),null,'刷新后继续稳定备料');
  assert.ok(api.allowance(waiting.p.next.project,waiting.m,context.shelterConstruction,context.shelterState,null,v.serverTime),'缺件不能开工');
  s.resources.parts=15;
  const ready=plan();assert.equal(ready.p.next.project.id,1026);assert.equal(ready.p.next.status,'ready');
  assert.equal(api.allowance(ready.p.next.project,ready.m,context.shelterConstruction,context.shelterState,null,v.serverTime),'');
  context.shelterConstruction.upgrade=false;context.shelterConstruction.build=false;context.shelterConstruction.dig=false;
  assert.equal(api.staff(api.model(v))?.from,1026,'取消工程后允许多余发电人员回收生产');
});

test('换位备料接续：已有空宿舍升级在两人换位期间保留备料，禁止开工且不整组撤补',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-swap-material.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false),s=v.state,seen=new Set(),actions=[];
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  const original=s.residents.filter(p=>[50,1010,1012].includes(p.roomId)).map(p=>({id:p.id,room:p.roomId}));
  const first=plan();assert.equal(first.p.next.project?.id,1006,'换位不使已确认的备料工程消失');
  assert.match(first.p.next.project.blocks.join('；'),/换位/);
  const parts=s.resources.parts;s.resources.parts=first.p.next.project.cost.parts;
  assert.equal(api.allowance(first.p.next.project,first.m,context.shelterConstruction,{...context.shelterState,constructionLedger:[]},null,v.serverTime),
    '当前项目尚未满足开工条件','即使材料和额度齐备，仍须先完成换位');
  s.resources.parts=parts;
  for(let step=0;step<20;step++){
    const fingerprint=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(fingerprint),'换位期间不能循环释放工坊');seen.add(fingerprint);
    const {m,c}=plan(),action=c.choice||api.staff(m);if(!action)break;
    assert.notEqual(action.role,'workshop-release');actions.push(action);
    s.residents.find(p=>p.id===action.id).roomId=action.room;
    if(action.role)api.record({kind:'assign',targets:[action.id,action.room],before:{campaign:{choice:action}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(step<19);
  }
  assert.ok(actions.some(a=>a.reason.includes('优化满员岗位')));assert.equal(context.shelterState.swap,null);
  for(const person of original)assert.equal(s.residents.find(p=>p.id===person.id).roomId,person.room);
  const after=plan();assert.equal(after.p.next.project.id,1006);assert.ok(after.m.production.parts>0);
  assert.ok(!after.p.next.project.blocks.some(reason=>reason.includes('换位')));
});

test('换位备料边界：目标取消、关闭人员、房间入住或出现待产时不保留空房投资，供给不足仍释放工坊',()=>{
  for(const kind of ['target','off','occupied','birth','pending','hold','family','stale-material','other-vault','supply']){
    const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-swap-material.fixture.json',import.meta.url),'utf8'));
    const {v,context,plan}=setup(snapshot.view,false),s=v.state;
    context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
    if(kind==='target')context.shelterLevelTarget=7;
    if(kind==='off')context.shelterStaffMode='off';
    if(kind==='occupied')s.residents.find(p=>p.id===49).roomId=1006;
    if(kind==='birth')s.births.push({id:99,roomId:1006,parents:[13,14],dueAt:v.serverTime+3600000});
    if(kind==='pending')context.shelterPending={kind:'upgrade'};
    if(kind==='hold')context.shelterStaffHold='原换位等待人工核对';
    if(kind==='family')context.shelterState.swap.prepareFamily=[13,14,5];
    if(kind==='stale-material')context.shelterState.campaign.materials.level=2;
    if(kind==='other-vault')context.shelterState.campaign.materials.vaultNo=78;
    if(kind==='supply')s.rooms.find(r=>r.type==='water').unpowered=true;
    const {c,p}=plan();
    if(kind==='supply')assert.ok(c.actions.some(a=>a.role==='workshop-release'),'真实供给不足仍允许回岗补供应');
    else assert.notEqual(p.next.project?.id,1006,kind);
  }
});

test('等级投资接续：施工名额暂满仍保留备料工程，刷新后不会工坊回收循环',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-level-investment.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false),seen=new Set(),actions=[];
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  for(let step=0;step<12;step++){
    const key=JSON.stringify({rooms:v.state.residents.map(p=>[p.id,p.roomId]),state:context.shelterState});
    assert.ok(!seen.has(key),'材料与施工状态不变时不能反复释放工坊再补回');seen.add(key);
    const {m,c,p}=plan(),a=c.choice||api.staff(m);
    assert.ok(p.next.project?.levelInvestment);assert.match(p.next.reason,/施工名额/);
    if(!a)break;actions.push(a);
    v.state.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  }
  assert.equal(actions.length,1);assert.equal(actions[0].role,'workshop');
  assert.equal(context.shelterState.campaign.materials.type,'quarters');
  assert.ok(plan().m.production.parts>0);
  assert.ok(api.allowance(plan().p.next.project,plan().m,context.shelterConstruction,context.shelterState,null,v.serverTime));
  for(const room of v.state.rooms)if(room.upgradeAt!==null){room.level++;room.upgradeAt=null;}
  const score=2*v.state.residents.length+3*v.state.depth+v.state.rooms.filter(r=>!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
  v.progress={level:1+Math.floor(Math.sqrt((score-30))/1.5),score,next:174};
  v.state.resources.parts=100;
  const {m,p}=plan(),project=p.next.project;assert.ok(project?.levelInvestment);assert.equal(p.next.status,'ready');
  assert.match(api.allowance(project,m,context.shelterConstruction,context.shelterState,null,v.serverTime),/额度/,'原24小时已用90件，不能提前消费30件');
  const releasedAt=v.serverTime+86400000;
  assert.equal(api.allowance(project,m,context.shelterConstruction,context.shelterState,null,releasedAt),'');
  assert.match(api.allowance(project,m,{...context.shelterConstruction,partsLimit:0},context.shelterState,null,releasedAt),/额度/);
  assert.match(api.allowance(project,m,{...context.shelterConstruction,scrapReserve:Math.ceil(m.state.resources.scrap)},context.shelterState,null,releasedAt),/保留量/);
  assert.match(api.allowance(project,m,{...context.shelterConstruction,upgrade:false},context.shelterState,null,v.serverTime),/未开启/);
  assert.match(api.allowance(project,m,context.shelterConstruction,context.shelterState,{kind:'assign'},v.serverTime),/原操作/);
});
test('等级投资供电：原工程缺电缺件时，工坊释放不取消发电准备或重新抽人备料',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-level-power.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false),seen=new Set(),actions=[];
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  for(let step=0;step<12;step++){
    const key=JSON.stringify({rooms:v.state.residents.map(p=>[p.id,p.roomId]),state:context.shelterState});
    assert.ok(!seen.has(key),'发电准备不能随工坊最后一人离岗而消失');seen.add(key);
    const {m,c,p}=plan(),a=c.choice||api.staff(m);
    assert.equal(p.next.project?.type,'power');
    if(!a)break;actions.push(a);
    v.state.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  }
  assert.ok(actions.length<=2);assert.ok(!actions.some(a=>a.role==='workshop'));
  assert.equal(plan().p.next.status,'ready');
});

test('等级投资供电边界：无在岗工人仍须原工程归属、可用工坊、供料和原额度',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-level-power.fixture.json',import.meta.url),'utf8'));
  const {v,context,api}=setup(snapshot.view,false);
  context.shelterState=snapshot.state;context.shelterConstruction.scrapReserve=0;
  v.state.residents.find(p=>p.id===2).roomId=4;
  const m=api.model(v),c=api.development(m,30,{enabled:true,reserved:[],projects:[],materials:context.shelterState.campaign.materials},10).next.project;
  assert.ok(c.levelInvestment);assert.equal(m.production.parts,0);
  const reserve=(project=c,config=context.shelterConstruction,state=context.shelterState,model=m,pending=null)=>
    api.powerReserve(project,model,config,state,pending,v.serverTime);
  assert.equal(reserve(),.5);
  assert.equal(reserve({...c,levelInvestment:false}),0);
  assert.equal(reserve(c,context.shelterConstruction,{...context.shelterState,campaign:{...context.shelterState.campaign,materials:undefined}}),0);
  for(const config of [{partsLimit:0},{scrapLimit:0},{upgrade:false}])assert.equal(reserve(c,{...context.shelterConstruction,...config}),0);
  assert.equal(reserve(c,context.shelterConstruction,context.shelterState,m,{kind:'assign'}),0);
  const poor={...m,state:{...m.state,resources:{...m.state.resources,scrap:c.cost.scrap}}};
  assert.equal(reserve(c,context.shelterConstruction,context.shelterState,poor),0);
  for(const room of v.state.rooms)if(room.type==='workshop')room.unpowered=true;
  assert.equal(reserve(c,context.shelterConstruction,context.shelterState,api.model(v)),0);
});

function handoffSetup(){
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-level-investment.fixture.json',import.meta.url),'utf8'));
  const result=setup(snapshot.view,false),{v,context}=result,s=v.state;
  context.shelterState=snapshot.state;context.shelterState.constructionLedger=[];
  context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  for(const r of s.rooms)if(r.upgradeAt!==null){r.level++;r.upgradeAt=null;}
  for(const r of s.rooms)if(!['quarters','storage','elevator','power'].includes(r.type))r.level=3;
  for(const p of s.residents)if(s.rooms.some(r=>r.id===p.roomId&&r.type==='power'))p.stats.str=10;
  s.resources.parts=30;
  const score=2*s.residents.length+3*s.depth+s.rooms.filter(r=>!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
  v.progress={level:1+Math.floor(Math.sqrt((score-30))/1.5),score,next:174};return result;
}
test('工坊工程交接：等级升级已备齐且可开工时，先开工再重评，不先释放整组备料人手',()=>{
  const {v,context,api,plan}=handoffSetup(),before=JSON.stringify({v,state:context.shelterState});
  const {m,c,p}=plan();assert.equal(p.next.status,'ready',JSON.stringify(p.next));assert.ok(p.next.project.levelInvestment);
  assert.equal(p.next.project.cost.parts,30);assert.ok(m.production.parts>0);
  assert.ok(!c.actions.some(a=>a.role==='workshop-release'),'材料马上用于已就绪等级工程时不提前拆散工坊');
  assert.ok(context.shelterState.campaign.roles.every(r=>r.role!=='workshop'||c.reserved.includes(r.id)));
  const ordinary=api.staff(m);
  assert.ok(!ordinary||!context.shelterState.campaign.roles.some(r=>r.id===ordinary.id&&r.role==='workshop'),'保留工坊后不应让普通人员管理重新拆走');
  assert.equal(JSON.stringify({v,state:context.shelterState}),before,'交接预演不修改材料或费用');
  const project=p.next.project;shelterStart(project);
  const after=plan();assert.equal(v.state.resources.parts,0);
  assert.ok(after.c.actions.every(a=>a.role!=='workshop-release'),'下一项真实工程仍缺料时原工坊接续');
  function shelterStart(project){const s=v.state,r=s.rooms.find(r=>r.id===project.id);
    s.resources.scrap-=project.cost.scrap;s.resources.parts-=project.cost.parts;r.upgradeAt=v.serverTime+project.hours*3600000;
    context.shelterState.constructionLedger.push({id:'started',at:v.serverTime,...project.cost});
    delete context.shelterState.campaign.materials;context.shelterState=JSON.parse(JSON.stringify(context.shelterState));}
});
test('工坊工程交接边界：预算、保留量、施工名额、未成年人、家庭、缺电与关闭升级不延迟原释放',()=>{
  for(const kind of ['budget','reserve','slots','child','family','power','disabled']){
    const {v,context,plan}=handoffSetup(),s=v.state;
    if(kind==='budget')context.shelterConstruction.partsLimit=0;
    if(kind==='reserve')context.shelterConstruction.partsReserve=30;
    if(kind==='slots')for(const r of s.rooms.filter(r=>r.type==='quarters').slice(0,2))r.upgradeAt=v.serverTime+3600000;
    if(kind==='child')s.residents.at(-1).adultAt=v.serverTime+3600000;
    if(kind==='family')context.shelterState.pair={a:1,b:3,room:6,fromA:1,fromB:4,step:0,at:v.serverTime};
    if(kind==='power')s.rooms.find(r=>r.type==='power').unpowered=true;
    if(kind==='disabled')context.shelterConstruction.upgrade=false;
    const {c}=plan();assert.equal(c.workshopConstructionHandoff,undefined,kind);
  }
});

function productionHandoffSetup(){
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-production-handoff.fixture.json',import.meta.url),'utf8'));
  const result=setup(snapshot.view,false),{context}=result;
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  return result;
}

test('生产升级工坊交接：餐厅已备齐且停产库存足够时，十人工坊先保留至实际开工后重评',()=>{
  const {v,context,api,plan}=productionHandoffSetup(),s=v.state,before=JSON.stringify({v,state:context.shelterState});
  const {m,c,p}=plan(),project=p.next.project,workers=context.shelterState.campaign.roles.filter(r=>r.role==='workshop');
  assert.equal(project.id,2);assert.equal(project.type,'diner');assert.equal(project.cost.parts,30);assert.equal(project.hours,6);
  assert.equal(p.next.status,'ready');assert.equal(api.allowance(project,m,context.shelterConstruction,context.shelterState,null,v.serverTime),'');
  assert.equal(workers.length,10);assert.ok(s.resources.food>=m.demand.food*(project.hours+2));
  assert.equal(c.actions.filter(a=>a.role==='workshop-release').length,0,'不能先把十人调走再开工');
  assert.ok(workers.every(r=>c.reserved.includes(r.id)));assert.equal(c.workshopConstructionHandoff.id,2);
  const ordinary=api.staff(m);assert.ok(!ordinary||!workers.some(r=>r.id===ordinary.id));
  assert.equal(JSON.stringify({v,state:context.shelterState}),before,'规划不会提前扣料或假定开工');
  s.resources.scrap-=1200;s.resources.parts-=30;s.rooms.find(r=>r.id===2).upgradeAt=v.serverTime+6*3600000;
  context.shelterState.constructionLedger.push({id:'production-started',at:v.serverTime,scrap:1200,parts:30});
  delete context.shelterState.campaign.materials;context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  const after=plan();assert.equal(s.resources.parts,1);assert.equal(after.m.production.food,0);
  assert.equal(after.c.workshopConstructionHandoff,undefined,'只保留至本项确认，不能永久挂交接');
  assert.ok(after.c.actions.every(a=>a.role!=='workshop-release'),'下一项实际缺件时继续原工坊');
});

test('生产升级交接边界：停产储备、预算、原请求和紧急供给不因减少调岗而被放宽',()=>{
  for(const kind of ['food-stock','budget','disabled','pending','power','family','worker-injured']){
    const {v,context,api,plan}=productionHandoffSetup(),s=v.state;
    if(kind==='food-stock')s.resources.food=30;
    if(kind==='budget')context.shelterConstruction.partsLimit=29;
    if(kind==='disabled')context.shelterConstruction.upgrade=false;
    if(kind==='pending')context.shelterPending={kind:'upgrade'};
    if(kind==='power')s.rooms.find(r=>r.type==='power').unpowered=true;
    if(kind==='family')context.shelterState.pair={a:1,b:3,room:6,fromA:1,fromB:4,step:0,at:v.serverTime};
    if(kind==='worker-injured')s.residents.find(p=>p.id===10).hp=10;
    const {c}=plan();assert.equal(c.workshopConstructionHandoff,undefined,kind);
    if(kind==='food-stock'){
      const candidate=plan().p.candidates.find(p=>p.id===2);
      if(candidate)assert.ok(api.allowance(candidate,api.model(v),context.shelterConstruction,context.shelterState,null,v.serverTime));
    }
  }
});

function outageReturnSetup(){
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-outage-return.fixture.json',import.meta.url),'utf8'));
  const result=setup(snapshot.view,false),{context}=result;
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  return result;
}

test('施工期间工坊复岗：库存覆盖停产至首批入库时，十名结束备料的工人直接回收，不先休息',()=>{
  const {v,context,api,plan}=outageReturnSetup(),s=v.state,workers=context.shelterState.campaign.roles.map(r=>r.id),actions=[];
  assert.equal(workers.length,10);assert.equal(plan().m.production.food,0);assert.ok(s.resources.food>1000);
  for(let step=0;step<10;step++){
    const {c}=plan(),a=c.choice;assert.equal(a?.role,'workshop-release');
    assert.equal(s.rooms.find(r=>r.id===a.room)?.type,'scrap','已确认停产储备可覆盖时不先送去休息');
    actions.push(a);s.residents.find(p=>p.id===a.id).roomId=a.room;
    api.record({kind:'assign',targets:a.targets,before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  }
  assert.equal(new Set(actions.map(a=>a.id)).size,10);assert.ok(actions.every(a=>workers.includes(a.id)));
  assert.ok(workers.every(id=>!context.shelterState.campaign.roles.some(r=>r.id===id)));
  assert.ok(plan().m.production.scrap>200);assert.equal(plan().m.production.food,0,'没有假定施工已完成或资源已到账');
});

test('施工期间复岗边界：库存不足首批、恢复房停电或完工人员离岗时仍由供应管理接手',()=>{
  for(const kind of ['stock','power','worker','pending','family']){
    const {v,context,plan}=outageReturnSetup(),s=v.state;
    if(kind==='stock')s.resources.food=100;
    if(kind==='power')s.rooms.find(r=>r.type==='diner').unpowered=true;
    if(kind==='worker')for(const p of s.residents.filter(p=>p.roomId===2))p.away={kind:'explore'};
    if(kind==='pending')context.shelterPending={kind:'upgrade'};
    if(kind==='family')context.shelterState.pair={a:1,b:3,room:6,step:0};
    const {c}=plan();assert.ok(!c.actions.some(a=>a.role==='workshop-release'&&a.room!==null),kind);
  }
});

function powerReturnSetup(){
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-power-return.fixture.json',import.meta.url),'utf8'));
  const result=setup(snapshot.view,false),{context}=result;
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  return result;
}

test('工坊供电复岗：原升级仅缺供电时，一名已结束备料的工人直接补电，按实际供电重评并保留九人交接',()=>{
  const {v,context,api,plan}=powerReturnSetup(),s=v.state,before=JSON.stringify({v,state:context.shelterState});
  const {m,c,p}=plan(),project=p.next.project,workers=context.shelterState.campaign.roles.map(r=>r.id),a=c.choice;
  assert.equal(project.id,4);assert.equal(project.type,'scrap');assert.equal(workers.length,10);
  assert.deepEqual(Array.from(project.blocks),['扩建后电力余量不足，先补发电']);
  assert.equal(api.allowance({...project,blocks:[]},m,context.shelterConstruction,context.shelterState,null,v.serverTime),'');
  assert.equal(a?.role,'workshop-release');assert.ok(workers.includes(a.id));
  assert.equal(a.room,1,'已结束备料的工人应直接填当前发电空岗，不先整组休息');
  assert.equal(JSON.stringify({v,state:context.shelterState}),before,'规划不预调岗、不扣材料');
  s.residents.find(p=>p.id===a.id).roomId=a.room;
  api.record({kind:'assign',targets:a.targets,before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  // 补电前原项目没有持久备料归属；补电后等级路线重新选出更早可做的餐厅，不能锁死临时回收候选。
  const after=plan();assert.equal(after.p.next.project.id,2);assert.equal(after.p.next.project.type,'diner');assert.equal(after.p.next.status,'ready');
  assert.equal(api.allowance(after.p.next.project,after.m,context.shelterConstruction,context.shelterState,null,v.serverTime),'');
  assert.equal(after.c.actions.filter(a=>a.role==='workshop-release').length,0);
  assert.equal(after.c.workshopConstructionHandoff.workers.length,9);
  assert.equal(api.staff(after.m),null,'已就绪的交接工程先开工，普通换位不能插队使工坊再次撤补');
  assert.ok(!context.shelterState.campaign.roles.some(r=>r.id===a.id),'调岗回执核对后才清理该人的工坊归属');
  assert.equal(s.resources.parts,46);assert.equal(s.rooms.find(r=>r.id===4).upgradeAt,null,'不假定工程已经开工');
});

test('工坊供电复岗边界：未授权工程、库存不足、无有效空岗或当前供应不足时保留原供给流程',()=>{
  for(const kind of ['disabled','budget','pending','family','stock','power-full','power-off','current-power','food']){
    const {v,context,plan}=powerReturnSetup(),s=v.state;
    if(kind==='disabled')context.shelterConstruction={...context.shelterConstruction,build:false,upgrade:false,dig:false};
    if(kind==='budget')context.shelterConstruction.partsLimit=0;
    if(kind==='pending')context.shelterPending={kind:'upgrade'};
    if(kind==='family')context.shelterState.pair={a:1,b:3,room:6,step:0};
    if(kind==='stock')s.resources.power=1;
    if(kind==='power-full')s.residents.find(p=>p.id===37).roomId=1;
    if(kind==='power-off')s.rooms.find(r=>r.id===1).unpowered=true;
    if(kind==='current-power')for(const p of s.residents.filter(p=>p.roomId===1))p.stats.str=0;
    if(kind==='food')s.rooms.find(r=>r.id===2).unpowered=true;
    const {c}=plan();assert.ok(!c.actions.some(a=>a.role==='workshop-release'&&a.room===1),kind);
  }
});

function expansionBindingSetup(){
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-expansion-binding.fixture.json',import.meta.url),'utf8'));
  const result=setup(snapshot.view,false),{context}=result;
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  return result;
}

test('工坊扩产原工程绑定：已有六人无需再调岗时，开工候选仍携带本次投入服务的餐厅升级',()=>{
  const {v,context,api,plan}=expansionBindingSetup(),before=JSON.stringify({v,state:context.shelterState});
  const {m,c}=plan(),prep=c.workshopPreparation,choice=api.construction(m);
  assert.equal(context.shelterState.campaign.materials,undefined);assert.equal(c.actions.length,0);
  assert.equal(prep.original.id,2);assert.equal(prep.project.cost.scrap,800);assert.equal(choice.type,'workshop');
  assert.ok(choice.materials,'已选择投资扩产时应携带原升级目标');
  assert.deepEqual(JSON.parse(JSON.stringify(choice.materials)),{vaultNo:77,id:2,type:'diner',level:3,targetLevel:8,finalTarget:10},
    '扩产投入不能依赖恰好发生新调岗才记得原工程');
  assert.equal(JSON.stringify({v,state:context.shelterState}),before,'预览不绑定、不预扣费用');
  v.state.resources.scrap-=800;
  v.state.rooms.push({id:1013,type:'workshop',floor:5,col:6,width:1,level:1,builtAt:v.serverTime+600000,upgradeAt:null,stored:0,incident:null,unpowered:false});
  context.shelterState.constructionLedger.push({id:'confirmed-workshop-build',at:v.serverTime,scrap:800,parts:0});
  context.shelterState.campaign.materials=api.materials(choice,api.model(v));
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  assert.ok(api.valid(context.shelterState.campaign));
  const after=plan();assert.equal(after.p.next.project.id,2);assert.equal(after.p.next.project.type,'diner');
  assert.equal(after.p.next.status,'saving');assert.equal(after.c.actions.filter(a=>a.role==='workshop-release').length,0);
  for(const changed of [{kind:'dig'},{type:'scrap'},{materials:{...choice.materials,vaultNo:78}},
    {materials:{...choice.materials,id:1004}},{materials:{...choice.materials,level:2}}])
    assert.equal(api.materials({...choice,...changed},api.model(v)),null);
  context.shelterLevelTarget=null;
  assert.notEqual(plan().p.next.project?.levelTarget,8,'取消等级目标后不能凭原记录强制继续等级投资');
});

test('持续升级材料归属：自动目标解析为下一等级，扩产确认与刷新仍接续原工程',()=>{
  const {v,context,api,plan}=expansionBindingSetup();context.shelterLevelTarget='auto';
  const choice=api.construction(api.model(v));
  assert.equal(choice.type,'workshop');assert.equal(choice.materials.id,2);
  assert.equal(choice.materials.finalTarget,v.progress.level+1);assert.equal(choice.materials.targetLevel,v.progress.level+1);
  v.state.resources.scrap-=800;
  v.state.rooms.push({id:1013,type:'workshop',floor:5,col:6,width:1,level:1,builtAt:v.serverTime+600000,upgradeAt:null,stored:0,incident:null,unpowered:false});
  context.shelterState.constructionLedger.push({id:'confirmed-auto-workshop-build',at:v.serverTime,scrap:800,parts:0});
  context.shelterState.campaign.materials=api.materials(choice,api.model(v));
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  assert.ok(api.valid(context.shelterState.campaign));assert.equal(context.shelterState.campaign.materials.finalTarget,8);
  const next=plan();assert.equal(next.p.next.project.id,2);assert.equal(next.p.next.status,'saving');
});

test('高等级供电备料：工坊释放后按可行单房供料保留发电前提，不在原仓库与补电间反复调岗',()=>{
  for(const target of [16,'auto']){
    const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-late-power-material.fixture.json',import.meta.url),'utf8'));
    const {v,context,api,plan}=setup(snapshot.view,false);context.shelterState=snapshot.state;
    context.shelterPopulationTarget=30;context.shelterLevelTarget=target;context.shelterOptimize=true;
    if(target==='auto')context.shelterState.campaign.materials.finalTarget=14;
    const resources=JSON.stringify(v.state.resources),seen=new Set();
    for(let step=0;step<12;step++){
      const fingerprint=JSON.stringify({v,state:context.shelterState});assert.ok(!seen.has(fingerprint),'原状态不得往返');seen.add(fingerprint);
      const {m,c}=plan(),action=c.choice||api.staff(m);if(!action)break;
      v.state.residents.find(p=>p.id===action.id).roomId=action.room;
      if(action.role)api.record({kind:'assign',targets:action.targets||[action.id,action.room],before:{campaign:{choice:action}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
      context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
    }
    const choice=api.construction(api.model(v));assert.equal(choice?.type,'power');assert.equal(choice.kind,'build');
    assert.equal(JSON.stringify(v.state.resources),resources);assert.equal(context.shelterConstruction.scrapReserve,100);
  }
});

test('等级投资开工优先：材料供电均满足时先建仓库，不让普通优化换位撤销原供电需求',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-ready-investment.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false);
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  const {m,p}=plan();assert.equal(p.next.project.type,'storage');assert.equal(p.next.project.levelInvestment,true);
  assert.equal(api.allowance(p.next.project,m,context.shelterConstruction,context.shelterState,null,v.serverTime),'');
  assert.equal(api.staff(m),null,'实际可以开工时普通收益换位不插队');
  const choice=api.construction(api.model(v));assert.equal(choice.kind,'build');assert.equal(choice.type,'storage');
  assert.equal(context.shelterState.swap,null);
});

function vacancyLevelSetup(){
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-vacancy-level.fixture.json',import.meta.url),'utf8'));
  const result=setup(snapshot.view,false),{context}=result;
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  return result;
}

test('在途等级接续：净水站完工已足够升8级，不在停产期间为可变普通回收升级反复备料',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-level-wait.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false);
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;
  const initial=structuredClone(v.state.resources),first=plan();
  assert.equal(first.p.levelProgress.committed,141);assert.equal(first.p.next.kind,'level');
  const seen=new Set();
  for(let step=0;step<12;step++){
    const key=JSON.stringify({people:v.state.residents.map(p=>[p.id,p.roomId]),state:context.shelterState});
    assert.ok(!seen.has(key),'不允许回到相同调岗状态');seen.add(key);
    const {m,c}=plan(),a=c.choice||api.staff(m);if(!a)break;
    assert.notEqual(a.role,'workshop','已在途够级时不另为普通增产项目新增备料人手');
    v.state.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    assert.ok(step<11,'释放后应收敛');
  }
  assert.deepEqual(v.state.resources,initial);
  const water=v.state.rooms.find(r=>r.id===3);v.serverTime=water.upgradeAt;v.state.lastSettledAt=v.serverTime;
  water.upgradeAt=null;water.level=3;v.progress={level:8,score:141,next:174};
  assert.notEqual(plan().p.next.kind,'level','完工后重新评估下一项，而非永久等待');
});

test('同产量复岗追级：先补可升级回收房的首位生产者，少走整组撤补仍保留本金供料',()=>{
  const {v,context,api,plan}=vacancyLevelSetup(),s=v.state,actions=[],before=JSON.stringify({v,state:context.shelterState});
  const first=plan();assert.equal(first.p.next.project.type,'quarters');
  assert.equal(first.c.choice.role,'workshop-release');assert.equal(first.c.choice.room,1009,
    '相同产量先让空的可升级回收房成为有效生产候选，而非只填大回收站');
  assert.equal(JSON.stringify({v,state:context.shelterState}),before);
  for(let step=0;step<12;step++){
    const {m,c}=plan(),a=c.choice||api.staff(m);if(!a)break;
    actions.push(a);s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
    assert.ok(step<11,'有限步收敛');
  }
  assert.ok(actions.length<=6,JSON.stringify(actions));
  const after=plan();assert.equal(after.p.next.project.id,1009);assert.equal(after.p.next.project.cost.scrap,480);
  assert.ok(after.m.production.parts>0);assert.equal(s.resources.parts,1);assert.equal(s.rooms.find(r=>r.id===1009).upgradeAt,null);
  assert.ok(api.allowance(after.p.next.project,after.m,context.shelterConstruction,context.shelterState,null,v.serverTime),'仍缺实际零件，不能提前开工');
});

test('同产量复岗边界：没有等级目标或关闭升级时不改变旧顺序，实际高产岗位优先',()=>{
  for(const kind of ['no-level','upgrade-off','higher-output']){
    const {v,context,plan}=vacancyLevelSetup();
    if(kind==='no-level')context.shelterLevelTarget=null;
    if(kind==='upgrade-off')context.shelterConstruction.upgrade=false;
    if(kind==='higher-output'){
      v.state.rooms.find(r=>r.id===4).level=3;
      for(const p of v.state.residents.filter(p=>p.roomId===1))p.stats.str=10;
    }
    const {c}=plan();assert.equal(c.choice?.room,4,kind);
    if(kind!=='higher-output')assert.equal(c.choice?.id,2,'未启用等级升级时保持原居民顺序');
  }
});

test('人口阻塞诊断：按家庭分别记录外出、心情、冷却及离岗后供给，不修改人员或配对',()=>{
  const {v,context,api}=setup(workshopChurnView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterState.families=[{a:1,b:3,room:6},{a:13,b:14,room:5}];
  s.residents.find(p=>p.id===1).away={kind:'explore'};
  s.residents.find(p=>p.id===3).happiness=49;
  s.residents.find(p=>p.id===13).familyCooldownUntil=v.serverTime+3600000;
  const before=JSON.stringify({v,state:context.shelterState}),d=api.populationDiagnostics(api.model(v),{reserved:[],dailyReserved:[]});
  assert.match(d.families[0].reasons.join('；'),/外出/);assert.match(d.families[0].reasons.join('；'),/心情/);
  assert.match(d.families[1].reasons.join('；'),/冷却/);assert.equal(d.target,30);
  assert.ok(d.families.every(f=>f.supply&&Object.hasOwn(f.supply,'food')));
  assert.equal(JSON.stringify({v,state:context.shelterState}),before);
});

test('普通升级备料：已在建足够追级时，普通增产项目仍保留最后生产者，不整组撤补工坊',()=>{
  const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-material-wait.fixture.json',import.meta.url),'utf8'));
  const {v,context,api,plan}=setup(snapshot.view,false),actions=[];
  context.shelterState=snapshot.state;context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  for(let step=0;step<18;step++){
    const {m,c,p}=plan(),a=c.choice||api.staff(m);
    assert.equal(p.next.project?.id,4);assert.equal(p.next.project.levelTarget,undefined);
    assert.ok(p.levelProgress.committed>=p.levelProgress.targetScore);
    if(!a)break;
    assert.notEqual(a.role,'workshop-release','材料未齐且原工程仍有效，不能因抽空原岗再整组撤回工坊');
    actions.push(a);v.state.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
    assert.ok(step<17,'必须稳定结束人员规划');
  }
  assert.equal(actions.length,8);assert.equal(v.state.residents.find(p=>p.id===44).roomId,4);
  assert.ok(plan().m.production.parts>0);
});
test('同步规划复用：同一快照重复核对只算一次，目标、记录、设置、快照变化及下一轮均重新计算',()=>{
  const {v,context,api}=setup(workshopChurnView(),false),m=api.model(v);
  api.startCache();let previous=api.campaign(m);assert.equal(api.campaign(m),previous);
  const changes=[()=>context.shelterPopulationTarget=30,
    ()=>context.shelterState=JSON.parse(JSON.stringify(context.shelterState)),
    ()=>context.shelterConstruction={...context.shelterConstruction,partsLimit:0},
    ()=>context.shelterCampaign={...context.shelterCampaign,medical:true},
    ()=>context.shelterStaffHold='manual'];
  for(const change of changes){change();const current=api.campaign(m);assert.notEqual(current,previous);assert.equal(api.campaign(m),current);previous=current;}
  assert.notEqual(api.campaign(api.model(v)),previous);api.endCache();
  assert.notEqual(api.campaign(m),api.campaign(m),'同步回合以外不保留规划');
});

test('工坊调度稳定：5级已有自动岗位不能因上下岗改变需求而无限往返',()=>{
  for(const target of [null,10]){
    const {v,context,api,plan}=setup(),actions=[];context.shelterLevelTarget=target;
    assert.equal(plan().p.next.project.cost.parts,0,'当前先执行无需零件的工程');
    if(target===null)assert.equal(plan().p.next.kind,'dig','覆盖现场下挖里程碑分支');
    for(let i=0;i<8;i++){
      const {c,p}=plan(),a=c.choice;
      if(!a||!a.role?.startsWith('workshop'))break;
      actions.push({role:a.role,id:a.id,room:a.room,next:p.next.title});
      v.state.residents.find(p=>p.id===a.id).roomId=a.room;
      api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
      context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
    }
    assert.deepEqual(actions.map(a=>a.role),['workshop-release'],JSON.stringify(actions));
  }
});
test('工坊调度稳定：仅启用自动建设也应保持备料，不被新增成年子女的补岗候选反复撤销',()=>{
  for(const assigned of [true,false]){
    const {v,context,api,plan}=setup(dormWorkshopCycleView(),false),s=v.state;
    context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
    context.shelterState.families=[[1,3,6],[2,10,1000],[12,21,1004],[13,14,5]].map(([a,b,room])=>({a,b,room}));
    context.shelterState.campaign.roles=assigned?[{id:1,room:50,role:'workshop',at:v.serverTime}]:[];
    context.shelterState.campaign.materials={vaultNo:77,id:1,type:'power',level:3,targetLevel:7,finalTarget:10};
    if(!assigned)s.residents.find(p=>p.id===1).roomId=1003;
    const actions=[];
    for(let step=0;step<8;step++){
      const {m,c}=plan();assert.ok(!c.choice?.role?.endsWith('release'),JSON.stringify(c.choice));
      const a=c.choice||api.staff(m);if(!a)break;actions.push(a);
      s.residents.find(p=>p.id===a.id).roomId=a.room;
      if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
      context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
    }
    assert.equal(s.residents.find(p=>p.id===1).roomId,50);assert.ok(plan().m.production.parts>0);
    assert.equal(actions.filter(a=>a.role==='workshop').length,assigned?1:2);
  }
});
test('家庭备料稳定：抽调工坊留下的回收空岗不能冒充口粮接替进展并取消备料',()=>{
  const {v,context,api,plan}=setup(familyWorkshopCycleView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  context.shelterState.families=[[1,3,6],[2,10,1000],[4,11,1004],[13,14,5]].map(([a,b,room])=>({a,b,room}));
  context.shelterState.campaign.roles=[];
  const actions=[],seen=new Set();
  for(let step=0;step<12;step++){
    const {m,c,p}=plan(),fingerprint=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(fingerprint),'unchanged state must not repeat');seen.add(fingerprint);
    assert.equal(p.next.type,'diner','food replacement remains necessary regardless of scrap vacancy');
    assert.ok(!c.choice?.role?.endsWith('release'),JSON.stringify(c.choice));
    const a=c.choice||api.staff(m);if(!a)break;actions.push(a);
    s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
    assert.ok(step<11,'staffing must settle');
  }
  assert.equal(actions.filter(a=>a.role==='workshop').length,2);
  assert.equal(s.residents.find(p=>p.id===4).roomId,50);assert.ok(plan().m.production.parts>0);
  s.resources.parts=31;
  assert.equal(plan().c.choice?.role,'workshop-release','actual sufficient stock still ends automatic duty');
});
test('工坊备料效率：已有一人且仍缺整批材料时，安全补足同一房间空位以缩短等待',()=>{
  const {v,context,api}=setup(),cfg={workshop:true,partsTarget:30,workshopScrapReserve:1200},s=v.state;
  s.resources.parts=0;
  const before=api.model(v),a=api.raw(before,cfg).choice;
  assert.equal(a?.role,'workshop','an existing worker must not suppress a useful second shift');
  assert.notEqual(a.id,21);assert.equal(a.room,50);
  s.residents.find(p=>p.id===a.id).roomId=a.room;
  api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  const after=api.model(v);
  assert.ok(after.production.parts>=before.production.parts*2-1e-9,'equal-skill second worker halves continuous production time');
  assert.ok(Object.keys(after.demand).every(k=>after.production[k]>=after.demand[k]*1.2-1e-9));
  assert.equal(api.raw(after,cfg).actions.filter(a=>a.role==='workshop').length,0,'full room does not reserve a third worker');
  s.resources.parts=30;
  assert.equal(api.raw(api.model(v),cfg).actions.filter(a=>a.role==='workshop-release').length,2,'both automatic workers are released when actual materials suffice');
});
test('工坊备料效率：本金或供应不足、岗位占满、下一批即够用时不追加人手',()=>{
  for(const kind of ['funds','supply','full','next-tick']){
    const {v,api}=setup(),cfg={workshop:true,partsTarget:30,workshopScrapReserve:1200},s=v.state;
    s.resources.parts=0;
    if(kind==='funds')s.resources.scrap=1200;
    if(kind==='supply')for(const p of s.residents)if(p.roomId===3)p.stats.per=0;
    if(kind==='full')s.residents.find(p=>p.id===35).roomId=50;
    if(kind==='next-tick'){s.resources.parts=27;s.rooms.find(r=>r.id===50).stored=2.99;}
    assert.equal(api.raw(api.model(v),cfg).actions.filter(a=>a.role==='workshop').length,0,kind);
  }
});
test('工坊备料效率：不能抽走目标升级房的最后一名生产者，使备料需求自行消失',()=>{
  const {v,context,api}=setup(campaignView()),s=v.state;
  s.rooms.push({...s.rooms[0],id:50,type:'workshop',floor:2,col:4,width:1,level:1});
  s.residents.find(p=>p.id===4).roomId=50;s.residents.find(p=>p.id===5).roomId=4;s.residents.find(p=>p.id===6).roomId=5;
  context.shelterState.campaign.roles=[{id:4,room:50,role:'workshop',at:v.serverTime}];s.resources.parts=0;
  const c=api.raw(api.model(v),{workshop:true,partsTarget:30,workshopScrapReserve:1200,workshopProject:4});
  assert.equal(c.actions.filter(a=>a.role==='workshop').length,0,'leave the last producer supporting the actual upgrade');
  assert.equal(c.actions.filter(a=>a.role==='workshop-release').length,0,'the existing workshop worker still has a real material demand');
});
test('工坊人口衔接：原家庭可返宿舍时不因预留工人改变工程而反复释放再补入',()=>{
  const {v,context,api,plan}=setup(workshopFamilyReturnView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  context.shelterState.families=[[1,3,6],[2,10,1000],[4,11,1004],[13,14,5]].map(([a,b,room])=>({a,b,room}));
  context.shelterState.campaign.roles=[{id:4,room:50,role:'workshop',at:v.serverTime}];
  context.shelterState.campaign.materials={vaultNo:77,id:1002,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  const seen=new Set(),actions=[];
  for(let step=0;step<16;step++){
    const key=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(key),JSON.stringify(actions));seen.add(key);
    const {m,c}=plan(),a=c.choice||api.staff(m);if(!a)break;
    actions.push({id:a.id,room:a.room,role:a.role});s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(step<15,'staffing must settle');
  }
  assert.ok(s.residents.filter(p=>[4,11].includes(p.id)).every(p=>p.roomId===1004),'an existing safe family must be allowed to return');
});

test('多工坊补员：原房满员后安排另一间已建空房，刷新稳定，齐料可开工时保留、预算受限时释放',()=>{
  const {v,context,api,plan}=setup(multiWorkshopView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterConstruction.scrapReserve=0;
  context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
  context.shelterState.campaign.materials={vaultNo:77,id:1010,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  const before=JSON.stringify(v),initial=plan();
  assert.equal(initial.p.next.project.id,1010);assert.equal(initial.p.next.project.cost.parts,30);
  assert.equal(initial.c.choice?.role,'workshop','有真实备料需求时使用另一间现有工坊');
  assert.equal(initial.c.choice.room,3000);assert.equal(JSON.stringify(v),before,'预览不能提前计入人手或产出');
  const added=[];
  for(let step=0;step<2;step++){
    const a=plan().c.choice;assert.equal(a.role,'workshop');assert.equal(a.room,3000);added.push(a.id);
    s.residents.find(p=>p.id===a.id).roomId=a.room;
    api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  }
  assert.equal(new Set(added).size,2);const filled=plan();
  assert.ok(filled.m.production.parts>2.69);
  assert.equal(filled.c.workshopPreparation?.original.id??filled.p.next.project.id,1010,
    '若满岗新工坊升2更快，前置工程也必须继续归属原1010材料需求');
  assert.ok(!filled.c.actions.some(a=>a.role?.startsWith('workshop')),'已满的两个工坊不反复调动或释放');
  assert.ok(s.residents.some(p=>p.roomId===1010),'原工程必须仍有有效生产者');
  s.resources.parts=30;const done=plan();
  assert.equal(done.c.workshopConstructionHandoff.id,1010);assert.equal(done.c.workshopConstructionHandoff.workers.length,4);
  assert.equal(done.c.actions.filter(a=>a.role==='workshop-release').length,0,'齐料且可开工时先交接工程');
  context.shelterConstruction.partsLimit=29;
  assert.equal(plan().c.actions.filter(a=>a.role==='workshop-release').length,4,'齐料但原工程额度不足时仍释放全部自动岗位');
});

test('多工坊供料：只能供原房时不增员且保留原岗，另房完整批量供料齐备后再接岗',()=>{
  const {v,context,api}=setup(multiWorkshopView(),false),s=v.state;
  context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
  const original=s.rooms.find(r=>r.id===50),feed=6*(Math.ceil(30/4.5)*4.5-original.stored),extra=180;
  const run=()=>api.raw(api.model(v),{workshop:true,partsTarget:30,workshopScrapReserve:960,workshopProject:1010});
  s.resources.scrap=960+feed+extra-1;
  const limited=run();assert.ok(!limited.actions.some(a=>a.role==='workshop'));
  assert.ok(!limited.actions.some(a=>a.role==='workshop-release'),'新增房供料不足不能撤掉原房有效人员');
  s.resources.scrap++;
  const funded=run();assert.equal(funded.choice?.role,'workshop');assert.equal(funded.choice.room,3000);
  const a=funded.choice;s.residents.find(p=>p.id===a.id).roomId=a.room;
  api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  assert.ok(!run().actions.some(a=>a.role==='workshop-release'),'恰好够两房供料时，加岗前后的浮点运算不能造成撤岗');
});

test('多工坊供料：原房全员外出占位时，只为可用的另一间工坊预留供料',()=>{
  const {v,context,api}=setup(multiWorkshopView(),false),s=v.state;
  context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
  for(const id of [10,35])s.residents.find(p=>p.id===id).away={kind:'explore'};
  s.resources.scrap=960+180;
  const c=api.raw(api.model(v),{workshop:true,partsTarget:30,workshopScrapReserve:960,workshopProject:1010});
  assert.equal(c.choice?.role,'workshop');assert.equal(c.choice.room,3000);
  assert.ok(!c.actions.some(a=>[10,35].includes(a.id)),'不调动外出人员，也不把他们占用的房间当成可供料空房');
});

test('多工坊连续供料：两间实际整批产出更早备齐原工程，供料守恒且逐轮不往返',t=>{
  const run=second=>{
    const {v,context,api}=setup(multiWorkshopView(),false),s=v.state;
    context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
    if(!second){s.rooms=s.rooms.filter(r=>r.id!==3000);v.progress.score--;}
    const initialScrap=s.resources.scrap,initialStored=s.rooms.find(r=>r.id===50).stored;
    let madeTotal=0,collected=0,feed=0,ticks=0,assignments=0;
    const plan=()=>api.raw(api.model(v),{workshop:true,partsTarget:30,workshopScrapReserve:960,workshopProject:1010});
    for(;s.resources.parts<30&&ticks<144;ticks++){
      const seen=new Set();
      for(let decision=0;decision<8;decision++){
        const a=plan().choice;if(!a)break;
        assert.equal(a.role,'workshop','备料期间不因增加工坊而释放原班');
        const key=JSON.stringify(s.residents.map(p=>[p.id,p.roomId]));assert.ok(!seen.has(key));seen.add(key);
        s.residents.find(p=>p.id===a.id).roomId=a.room;assignments++;
        api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
        context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
      }
      for(const room of s.rooms.filter(r=>r.type==='workshop')){
        const factor=[0,1,1.5,2.1][room.level],batch=3*room.width*factor;
        const workers=s.residents.filter(p=>p.roomId===room.id&&p.away===null&&p.adultAt<=v.serverTime).slice(0,room.width*2);
        const amount=workers.reduce((n,p)=>n+.6*factor*(.5+p.stats.int/10)*(.6+.4*p.happiness/100),0)/6;
        room.stored+=amount;s.resources.scrap-=6*amount;madeTotal+=amount;feed+=6*amount;
        const take=Math.floor((room.stored+1e-9)/batch)*batch;room.stored-=take;s.resources.parts+=take;collected+=take;
        assert.ok(room.stored>=-1e-8&&room.stored<4*batch);assert.ok(s.resources.scrap>=960);
      }
      v.serverTime+=600000;s.lastSettledAt=v.serverTime;
    }
    assert.ok(s.resources.parts>=30);assert.ok(Math.abs(initialScrap-s.resources.scrap-feed)<1e-7);
    assert.ok(Math.abs(initialStored+madeTotal-collected-s.rooms.filter(r=>r.type==='workshop').reduce((n,r)=>n+r.stored,0))<1e-7);
    assert.ok(Math.abs(feed-6*madeTotal)<1e-7);assert.equal(s.resources.parts,collected);
    assert.equal(plan().actions.filter(a=>a.role==='workshop-release').length,second?4:2);
    return {hours:ticks/6,assignments,parts:s.resources.parts,feed};
  };
  const baseline=run(false),expanded=run(true);
  assert.ok(expanded.hours<baseline.hours);assert.equal(expanded.assignments,2);assert.equal(baseline.assignments,0);
  t.diagnostic(JSON.stringify({scope:'fixed original material target, existing rooms, no construction or general supply time simulation',baseline,expanded}));
});

test('多工坊边界：先补原房空位，临近齐料、施工、停电、事件及外出占位时不占用第二房',()=>{
  for(const kind of ['first-vacancy','near','building','upgrading','unpowered','incident','away']){
    const {v,context,api}=setup(multiWorkshopView(),false),s=v.state,newRoom=s.rooms.find(r=>r.id===3000);
    context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
    if(kind==='first-vacancy'){s.residents.find(p=>p.id===35).roomId=null;context.shelterState.campaign.roles.pop();}
    if(kind==='near'){s.resources.parts=28;s.rooms.find(r=>r.id===50).stored=4.4;}
    if(kind==='building')newRoom.builtAt=v.serverTime+3600000;
    if(kind==='upgrading')newRoom.upgradeAt=v.serverTime+3600000;
    if(kind==='unpowered')newRoom.unpowered=true;
    if(kind==='incident')newRoom.incident={kind:'fire',hp:20,maxHp:20};
    if(kind==='away')for(const id of [21,36]){const p=s.residents.find(p=>p.id===id);p.roomId=3000;p.away={kind:'explore'};}
    const c=api.raw(api.model(v),{workshop:true,partsTarget:30,workshopScrapReserve:960,workshopProject:1010});
    if(kind==='first-vacancy')assert.equal(c.choice?.room,50,'已有值班房的空位优先');
    else assert.ok(!c.actions.some(a=>a.role==='workshop'&&a.room===3000),kind);
    assert.ok(!c.actions.some(a=>a.role==='workshop-release'),kind);
  }
});

function buildWorkshopSetup(){
  const result=setup(workshopBuildView(),false),{context,v}=result;
  context.shelterPopulationTarget=30;context.shelterConstruction.scrapReserve=0;
  context.shelterConstruction.scrapLimit=1600;
  context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
  context.shelterState.campaign.materials={vaultNo:77,id:1010,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  return result;
}
test('工坊直接接岗：材料齐备但建设额度不足时两名自动工人直接回收，不先休息且不残留释放角色',()=>{
  const {v,context,api,plan}=buildWorkshopSetup(),s=v.state;
  s.resources.parts=100;context.shelterStaffMode='production';context.shelterConstruction.partsLimit=29;
  const before=JSON.stringify({v,state:context.shelterState}),first=plan().c.choice;
  assert.equal(first.role,'workshop-release');
  assert.equal(s.rooms.find(r=>r.id===first.room)?.type,'scrap','有安全空岗时直接去生产房');
  assert.equal(JSON.stringify({v,state:context.shelterState}),before,'规划不能提前释放或保存角色');
  const original=[10,35],actions=[];
  for(let i=0;i<2;i++){
    const a=plan().c.choice;assert.equal(a.role,'workshop-release');assert.ok(original.includes(a.id));
    assert.equal(a.from,50);assert.equal(s.rooms.find(r=>r.id===a.room)?.type,'scrap');
    actions.push(a);s.residents.find(p=>p.id===a.id).roomId=a.room;
    api.record({kind:'assign',targets:a.targets,before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
    assert.ok(api.valid(context.shelterState.campaign),'直接释放不能保存非法的workshop-release常驻角色');
    assert.ok(!context.shelterState.campaign.roles.some(r=>r.id===a.id));
  }
  assert.equal(new Set(actions.map(a=>a.id)).size,2);assert.equal(context.shelterState.campaign.roles.length,0);
  assert.ok(!plan().c.choice?.role?.startsWith('workshop'));assert.ok(plan().m.production.scrap>0);
});

test('工坊直接接岗边界：人口就业、供给、人工和临时岗位限制仍保留原交接',()=>{
  for(const kind of ['off','held','family','population','child','birth','unemployed','supply','idle','hurt','incident','upgrade','manual','full','pair','swap']){
    const {v,context,plan}=buildWorkshopSetup(),s=v.state;s.resources.parts=100;context.shelterConstruction.partsLimit=29;
    if(kind==='off')context.shelterStaffMode='off';
    if(kind==='held')context.shelterStaffHold='manual';
    if(kind==='family')context.shelterStaffMode='family';
    if(kind==='population')context.shelterPopulationTarget=31;
    if(kind==='child')s.residents.find(p=>p.id===49).adultAt=v.serverTime+3600000;
    if(kind==='birth')s.births=[{id:1,roomId:5,parents:[13,14],dueAt:v.serverTime+3600000}];
    if(kind==='unemployed')Object.assign(s.residents.find(p=>p.id===49),{roomId:5,parents:[13,14],familyCooldownUntil:0});
    if(kind==='supply')for(const r of s.rooms.filter(r=>r.type==='power'))r.unpowered=true;
    if(kind==='idle')s.residents.find(p=>p.id===49).roomId=null;
    if(kind==='hurt')for(const id of [10,35])s.residents.find(p=>p.id===id).hp=40;
    if(kind==='incident')s.rooms.find(r=>r.id===50).incident={kind:'fire',hp:10,maxHp:20};
    if(kind==='upgrade')s.rooms.find(r=>r.id===50).upgradeAt=v.serverTime+3600000;
    if(kind==='manual')context.shelterState.campaign.roles=[];
    if(kind==='full')for(const r of s.rooms.filter(r=>r.type==='scrap'))r.upgradeAt=v.serverTime+3600000;
    if(kind==='pair')context.shelterState.pair={a:1,b:2,room:5,step:0};
    if(kind==='swap')context.shelterState.swap={people:[{id:1,from:1,to:2}],step:0};
    const c=plan().c;
    assert.ok(!c.actions.some(a=>a.role==='workshop-release'&&a.room!==null),kind);
  }
  const {v,context,plan}=buildWorkshopSetup();v.state.resources.parts=100;context.shelterConstruction.partsLimit=29;
  assert.notEqual(plan().c.choice.room,null,'人口30且全部就业后允许直接接岗');
});
test('工坊直接接岗每日目标：仍缺食物整批产量时先保留原人员分配顺序，不能直接锁去回收',()=>{
  const {v,context,api,plan}=buildWorkshopSetup();v.state.resources.parts=100;context.shelterConstruction.partsLimit=29;
  for(const resource of ['food','scrap'])for(const deficit of [false,true]){
    const {m,c}=plan();
    c.actions=c.actions.map(a=>a.role==='workshop-release'?{...a,room:null,targets:[a.id,null]}:a);c.choice=c.actions[0];
    c.dailyProduction=[{resource,forecast:deficit?0:100,remaining:100,hours:1}];
    api.releasePreview(m,c);
    assert.equal(c.choice.room===null,resource==='food'&&deficit,JSON.stringify({resource,deficit,choice:c.choice}));
  }
});

test('工坊新建备料：计入施工与离岗损失后更快才扩建，施工期间不预先撤人',()=>{
  const {v,context,api,plan}=buildWorkshopSetup(),s=v.state,before=JSON.stringify(v);
  const initial=plan(),preparation=initial.c.workshopPreparation,c=initial.p.next.project;
  assert.equal(c?.kind,'build');assert.equal(c.type,'workshop');assert.equal(c.cost.scrap,600);
  assert.equal(preparation.original.id,1010);assert.ok(preparation.savedHours>1);
  assert.equal(preparation.workers.length,2);assert.equal(JSON.stringify(v),before);
  assert.equal(initial.c.actions.filter(a=>a.kind==='assign').length,0,'建成前不占用候选工人');
  const posts=preparation.workers.map(id=>[id,s.residents.find(p=>p.id===id).roomId]);
  s.resources.scrap-=c.cost.scrap;
  s.rooms.push({...s.rooms.find(r=>r.id===50),id:3000,floor:c.floor,col:c.col,width:1,level:1,stored:0,builtAt:v.serverTime+600000});
  context.shelterState.constructionLedger=[{id:'build-workshop',at:v.serverTime,scrap:c.cost.scrap,parts:0}];
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  assert.equal(plan().c.workshopPreparation,null);
  assert.equal(plan().c.actions.filter(a=>a.kind==='assign').length,0,'施工期间原工坊和候选工人继续生产');
  assert.deepEqual(posts.map(([id])=>[id,s.residents.find(p=>p.id===id).roomId]),posts);
  v.serverTime+=600000;s.lastSettledAt=v.serverTime;v.progress.score++;
  for(let i=0;i<2;i++){
    const a=plan().c.choice;assert.equal(a.role,'workshop');assert.equal(a.room,3000);
    s.residents.find(p=>p.id===a.id).roomId=a.room;
    api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  }
  assert.ok(plan().m.production.parts>2.69);assert.equal(plan().p.next.project.id,1010);
  assert.equal(plan().c.actions.filter(a=>a.role==='workshop-release').length,0);
  s.resources.parts=30;assert.equal(plan().p.next.status,'ready');
  assert.equal(plan().c.workshopConstructionHandoff.id,1010);assert.equal(plan().c.workshopConstructionHandoff.workers.length,4);
  context.shelterConstruction.partsLimit=29;
  assert.equal(plan().c.actions.filter(a=>a.role==='workshop-release').length,4,'额度不足时不继续保留交接人手');
});

test('工坊新建边界：少量缺件、开关、联合预算、供料、人员和供电不满足时保留原工程',()=>{
  for(const kind of ['near','off','budget','feed','people','power','population','space']){
    const {v,context,plan}=buildWorkshopSetup(),s=v.state;
    if(kind==='near')s.resources.parts=29;
    if(kind==='off')context.shelterConstruction.build=false;
    if(kind==='budget')context.shelterConstruction.scrapLimit=1500;
    if(kind==='feed')s.resources.scrap=600+960+6*(31.5-1.1112)+180-1;
    if(kind==='people')for(const p of s.residents)if(![10,35].includes(p.id))p.hp=50;
    if(kind==='power')s.residents.filter(p=>p.roomId===1).forEach(p=>p.stats.str=0);
    if(kind==='population')context.shelterPopulationTarget=31;
    if(kind==='space')delete s.rooms[0].col;
    const before=JSON.stringify(v),result=plan();
    assert.equal(result.c.workshopPreparation,null,kind);assert.equal(JSON.stringify(v),before,kind);
    if(!['power','space'].includes(kind))assert.equal(result.p.next.project?.id,1010,kind);
  }
});

test('工坊新建合并：沿用相邻同级合并位置，按合并后的整批量估计和实际备料',t=>{
  const {v,context,api,plan}=buildWorkshopSetup(),s=v.state,w=s.rooms.find(r=>r.id===50);
  s.rooms.push({...w,id:3001,type:'storage',level:1,stored:0});
  Object.assign(w,{level:1,floor:5,col:5});
  const initial=plan(),p=initial.c.workshopPreparation;
  assert.equal(p?.project.kind,'build');assert.equal(p.project.floor,5);assert.equal(p.project.col,6);
  assert.equal(p.workers.length,2);assert.ok(p.savedHours>1);
  const firstScrap=s.resources.scrap,firstStored=w.stored;let feed=0,made=0,collected=0;
  s.resources.scrap-=600;context.shelterState.constructionLedger=[{id:'merge-build',at:v.serverTime,scrap:600,parts:0}];
  // 固定夹具无经验/装备/活动变化；独立按公开十分钟产刻与整批规则推进。
  const tick=()=>{
    const batch=3*w.width,workers=s.residents.filter(p=>p.roomId===w.id&&p.away===null).slice(0,w.width*2);
    const amount=workers.reduce((n,p)=>n+.6*(.5+p.stats.int/10)*(.6+.4*p.happiness/100),0)/6;
    w.stored+=amount;s.resources.scrap-=amount*6;made+=amount;feed+=amount*6;
    const take=Math.floor((w.stored+1e-9)/batch)*batch;w.stored-=take;s.resources.parts+=take;collected+=take;
    v.serverTime+=600000;s.lastSettledAt=v.serverTime;
  };
  tick();w.width++;v.progress.score++;
  for(let i=0;i<2;i++){
    const a=plan().c.choice;assert.equal(a?.role,'workshop');assert.equal(a.room,50);
    s.residents.find(p=>p.id===a.id).roomId=50;
    api.record({kind:'assign',targets:[a.id,50],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  }
  let ticks=1;
  for(;s.resources.parts<30&&ticks<180;ticks++)tick();
  assert.ok(s.resources.parts>=30);assert.equal(collected%6,0,'合并后不能拆成两个3件的小批提前领取');
  assert.ok(Math.abs(firstScrap-s.resources.scrap-600-feed)<1e-7);
  assert.ok(Math.abs(firstStored+made-collected-w.stored)<1e-7);
  assert.ok(Math.abs(ticks/6-p.totalHours)<1/6+1e-9,'有供料且本金充足时预测与独立整步生产相符');
  assert.equal(plan().p.next.project.id,1010);assert.equal(plan().p.next.status,'ready');
  t.diagnostic(JSON.stringify({scope:'merged workshop fixed material target only',baselineHours:p.baselineHours,
    forecastHours:p.totalHours,actualHours:ticks/6,constructionScrap:600,feed,collected}));
});

test('备料额度等待：建设额度暂不足不抽空原工程，不触发八人工坊整组释放重补',()=>{
  const {v,context,api,plan}=setup(workshopBudgetCycleView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  context.shelterState.campaign.roles=s.residents.filter(p=>[50,1012].includes(p.roomId)).map(p=>({id:p.id,room:p.roomId,role:'workshop',at:v.serverTime}));
  context.shelterState.campaign.materials={vaultNo:77,id:4,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  context.shelterState.constructionLedger=[{id:'prior-upgrades',at:v.serverTime,scrap:2160,parts:60}];
  const initial=plan();assert.equal(initial.p.next.project.id,4);assert.equal(initial.p.next.project.cost.parts,45);
  assert.equal(api.powerReserve(initial.p.next.project,initial.m,context.shelterConstruction,context.shelterState,null,v.serverTime),0,
    '额度不足仍不额外预留开工供电');
  for(let i=0;i<30;i++){
    const {m,c,p}=plan(),a=c.choice||api.staff(m);if(!a)break;
    assert.equal(p.next.project.id,4);assert.ok(!a.role?.endsWith('release'),'原工程确实缺件，现有工坊应继续生产');
    assert.ok(a.id!==4||a.room===4,'原回收唯一生产者不能为邻房小幅增产离岗');
    s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  }
  assert.equal(s.residents.find(p=>p.id===4).roomId,4);
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  assert.equal(plan().p.next.project.id,4);assert.ok(plan().m.production.parts>4.3);
  s.resources.parts=46;assert.equal(plan().c.actions.filter(a=>a.role==='workshop-release').length,8,'材料齐备仍释放');
  s.resources.parts=37;context.shelterConstruction.upgrade=false;
  assert.equal(api.staff(api.model(v))?.id,4,'关闭原工程后不再保护特殊备料岗位');
});

test('工坊扩产等待：缺件较多且本金充裕时先升工坊，施工与刷新仍保留原工程需求',()=>{
  const {v,context,api,plan}=setup(workshopUpgradeView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterConstruction.scrapReserve=0;
  context.shelterConstruction.build=false; // 单独验收没有新建授权时的升级路径。
  context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
  context.shelterState.campaign.materials={vaultNo:77,id:1010,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  const before=JSON.stringify(v),initial=plan();
  assert.equal(initial.p.next.project?.type,'workshop','不是一味等原工坊：当前项目应比较有效扩产');
  assert.equal(initial.p.next.project.id,50);assert.equal(initial.p.next.project.level,2);
  assert.ok(initial.c.workshopPreparation.savedHours>4,'包括停产和整批收取后仍能缩短原工程等待');
  assert.equal(initial.c.actions.filter(a=>a.role==='workshop-release').length,0,'前置工程不把原零件目标改为0');
  assert.equal(JSON.stringify(v),before);
  s.resources.scrap-=1250;s.rooms.find(r=>r.id===50).upgradeAt=v.serverTime+3600000;
  context.shelterState.constructionLedger=[{id:'workshop-upgrade',at:v.serverTime,scrap:1250,parts:0}];
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  const pending=plan();assert.equal(pending.c.actions.filter(a=>a.role==='workshop-release').length,0);
  assert.notEqual(pending.p.next.project?.id,50,'不重复工坊施工');
  v.serverTime+=3600000;s.lastSettledAt=v.serverTime;
  Object.assign(s.rooms.find(r=>r.id===50),{upgradeAt:null,level:2});v.progress.score++;
  const completed=plan();assert.equal(completed.p.next.project?.id,1010,'完工回到原材料项目');
  assert.ok(completed.m.production.parts>1.6);assert.equal(completed.c.actions.filter(a=>a.role==='workshop-release').length,0);
  s.resources.parts=31;const funded=plan();assert.equal(funded.p.next.project?.id,1010);assert.equal(funded.p.next.status,'ready');
  assert.equal(funded.c.workshopConstructionHandoff.id,1010);assert.equal(funded.c.workshopConstructionHandoff.workers.length,2);
  context.shelterConstruction.partsLimit=29;
  assert.equal(plan().c.actions.filter(a=>a.role==='workshop-release').length,2,'原材料齐备而额度不足时仍正常结束自动值班');
});

test('工坊扩产等待：临近备齐、开关或资金受限、缺电和人工岗位时不升级',()=>{
  for(const kind of ['near','budget','principal','off','pending','power','manual','health','hold']){
    const {v,context,plan}=setup(workshopUpgradeView(),false),s=v.state;
    context.shelterPopulationTarget=30;context.shelterConstruction.scrapReserve=0;
    context.shelterConstruction.build=false;
    context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
    context.shelterState.campaign.materials={vaultNo:77,id:1010,type:'scrap',level:3,targetLevel:8,finalTarget:10};
    if(kind==='near')s.resources.parts=28;
    if(kind==='budget')context.shelterConstruction.scrapLimit=2000;
    if(kind==='principal')s.resources.scrap=2000;
    if(kind==='off')context.shelterConstruction.upgrade=false;
    if(kind==='pending')context.shelterPending={id:'unknown'};
    if(kind==='power')s.residents.filter(p=>p.roomId===1).forEach(p=>p.stats.str=0);
    if(kind==='manual')context.shelterState.campaign.roles=[];
    if(kind==='health')s.residents.find(p=>p.id===35).hp=50;
    if(kind==='hold')context.shelterStaffHold='人工窗口';
    const before=JSON.stringify(v),result=plan();
    assert.equal(result.c.workshopPreparation,null,kind);assert.notEqual(result.p.next.project?.type,'workshop',kind);
    assert.equal(JSON.stringify(v),before,'比较不改变人员和库存');
  }
});

test('工坊扩产阶段：人口未达阶段目标、尚有幼儿或成年子女待就业时先保留发展预算',()=>{
  for(const kind of ['population','child','jobs']){
    const {v,context,plan}=setup(workshopUpgradeView(),false),s=v.state;
    context.shelterPopulationTarget=kind==='population'?31:30;context.shelterConstruction.scrapReserve=0;
    context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
    context.shelterState.campaign.materials={vaultNo:77,id:1010,type:'scrap',level:3,targetLevel:8,finalTarget:10};
    const child=s.residents.find(p=>p.id===49);child.parents=[2,10];child.roomId=1000;
    if(kind==='child')child.adultAt=v.serverTime+3600000;
    else if(kind==='population')child.roomId=1010;
    const result=plan();assert.equal(result.c.workshopPreparation,null,kind);
    assert.notEqual(result.p.next.project?.type,'workshop',kind);
  }
});

test('备料供电稳定：已确认原工程仍缺零件时保留发电准备，不能反复撤工坊再补电',()=>{
  const {v,context,api,plan}=setup(workshopPowerCycleView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  context.shelterState.campaign.roles=[{id:3,room:50,role:'workshop',at:v.serverTime}];
  context.shelterState.campaign.materials={vaultNo:77,id:4,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  context.shelterState.families=[[1,3,6],[2,10,1000],[12,21,1004],[13,14,5]].map(([a,b,room])=>({a,b,room}));
  const seen=new Set(),actions=[];
  for(let i=0;i<15;i++){
    const fingerprint=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(fingerprint),JSON.stringify(actions));seen.add(fingerprint);
    const {m,c}=plan(),a=c.choice||api.staff(m);if(!a)break;
    actions.push(a);s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(i<14);
  }
  assert.equal(s.residents.find(p=>p.id===1).roomId,1,'缺件期间仍保留现有供电准备');
  assert.equal(plan().p.next.project?.id,4);assert.equal(actions.filter(a=>a.role==='workshop-release').length,0);
});

test('备料供电限制：只有原项目的在岗备料可继续预留，其他开关额度和供料条件不放宽',()=>{
  for(const kind of ['valid','different','manual','budget','principal','off','pending','other-block']){
    const {v,context,api,plan}=setup(workshopPowerCycleView(),false),s=v.state;
    context.shelterPopulationTarget=30;context.shelterConstruction.scrapReserve=0;
    s.residents.find(p=>p.id===10).roomId=50;
    context.shelterState.campaign.roles=[3,10].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
    context.shelterState.campaign.materials={vaultNo:77,id:4,type:'scrap',level:3,targetLevel:8,finalTarget:10};
    const c=plan().p.next.project;assert.equal(c.id,4);
    if(kind==='different')context.shelterState.campaign.materials.id=1007;
    if(kind==='manual')context.shelterState.campaign.roles=[];
    if(kind==='budget')context.shelterConstruction.partsLimit=44;
    if(kind==='principal')s.resources.scrap=1500;
    if(kind==='off')context.shelterConstruction.upgrade=false;
    if(kind==='pending')context.shelterPending={id:'unknown'};
    if(kind==='other-block')c.blocks.push('等待其他实际条件');
    const before=JSON.stringify(v);
    assert.equal(api.powerReserve(c,api.model(v),context.shelterConstruction,context.shelterState,context.shelterPending,v.serverTime),kind==='valid'?3:0,kind);
    assert.equal(JSON.stringify(v),before,'规划不能把尚未产出的零件写进真实库存');
  }
});

test('备料生产者稳定：不能为短期回收增产抽空原升级房，使最后一批零件需求反复消失',()=>{
  const {v,context,api,plan}=setup(materialProducerCycleView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  context.shelterState.campaign.roles=[];
  context.shelterState.campaign.materials={vaultNo:77,id:1016,type:'scrap',level:3,targetLevel:9,finalTarget:10};
  const seen=new Set(),actions=[];
  for(let i=0;i<16;i++){
    const key=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(key),JSON.stringify(actions));seen.add(key);
    const {m,c}=plan(),a=c.choice||api.staff(m);if(!a)break;
    actions.push(a);s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(i<15);
  }
  assert.equal(plan().p.next.project?.id,1016);assert.equal(actions.filter(a=>a.role==='workshop-release').length,0);
  assert.ok(s.residents.some(p=>p.roomId===1016));
  context.shelterConstruction.upgrade=false;
  const next=api.staff(api.model(v));assert.equal(next?.from,1016,'取消升级后不再保留原房生产者');
});
