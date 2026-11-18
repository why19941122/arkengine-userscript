import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const segment=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const implementation=[declarations,segment('  function shelterWorkerRate(','  function readShelter('),
  segment('  const staffRoomTypes =','  function shelterExploreStep('),
  segment('  function shelterCampaignSchedule(','  function shelterDailyClaimStep('),
  segment('  function recordShelterCampaign(','  function shelterFormValue('),
  segment('  function shelterConstructionChoice(','  function shelterBuildTitle(')].join('\n');
const fixture=JSON.parse(readFileSync(new URL('./arkengine-shelter-swap-training.fixture.json',import.meta.url),'utf8'));
function setup(){
  const x=structuredClone(fixture),v=x.view;
  const context={objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'},
    shelterStaffMode:'population',shelterStaffHold:false,shelterOptimize:true,shelterGear:true,shelterPopulationTarget:50,shelterLevelTarget:10,
    shelterConstruction:x.construction,shelterCampaign:x.campaign,shelterState:x.state,shelterPending:null,shelterRead:null,
    shelterConstructionNote:'',shelterStaffNote:'',shelterPopulationNote:'',shelterSocialNote:'',shelterCaravanNote:'',
    Date:class extends Date{static now(){return v.serverTime;}},crypto:{randomUUID:()=>String(v.serverTime)},log:{add(){}},workshopAutomatic:()=>false};
  context.saveShelter=x=>context.shelterState=x;
  context.holdShelterStaff=note=>{context.shelterStaffHold=note;context.shelterState.swap=null;};
  const api=vm.runInNewContext(implementation+'\n({model:shelterModel,schedule:shelterCampaignSchedule,staff:shelterStaffPlan,record:recordShelterCampaign,raw:shelterCampaignPlan,defaults:campaignDefaults})',context);
  return {v,context,api,plan:()=>api.schedule(api.model(v))};
}
test('换位接续：真实派生快照先完成后半步，不被第三人新训练抽走供给',()=>{
  const x=setup(),before=JSON.stringify(x.v),p=x.plan();
  assert.equal(p.choice?.role,'radio-release','unbacked future jobs end recruitment even during a swap');
  assert.ok(!p.actions.some(a=>a.role==='training'));assert.ok(!p.reserved.includes(41));assert.ok(!p.trainingDestinations.some(d=>d.id===41));
  assert.equal(JSON.stringify(x.v),before);
  const a=x.api.staff(x.api.model(x.v));assert.equal(a.id,36);assert.equal(a.room,119);
  assert.equal(x.context.shelterStaffHold,false);
  x.v.state.residents.find(p=>p.id===a.id).roomId=a.room;
  x.context.shelterState=structuredClone(x.context.shelterState);
  x.api.staff(x.api.model(x.v));assert.equal(x.context.shelterState.swap,null);
  assert.equal(x.context.shelterStaffHold,false);assert.equal(x.v.state.residents.find(p=>p.id===41).roomId,6);
});
test('换位接续：取消换位后新训练恢复，已有训练进度及固定期限不被改写',()=>{
  const x=setup(),roles=structuredClone(x.context.shelterState.campaign.roles);
  assert.equal(x.plan().choice?.role,'radio-release');assert.ok(!x.plan().actions.some(a=>a.role==='training'));
  assert.deepEqual(x.context.shelterState.campaign.roles,roles);
  for(const id of [11,45,70])assert.ok(x.plan().reserved.includes(id));
  x.context.shelterState={...x.context.shelterState,swap:null};
  assert.ok(x.plan().actions.some(a=>a.id===41&&a.role==='training'));
});
test('换位接续：真实供给或人员资格变化仍取消剩余步骤，不强制执行旧方案',()=>{
  for(const kind of ['supply','health','incident']){
    const x=setup();
    if(kind==='supply')x.v.state.residents.find(p=>p.id===41).roomId=null;
    if(kind==='health')x.v.state.residents.find(p=>p.id===36).hp=1;
    if(kind==='incident')x.v.state.rooms.find(r=>r.id===119).incident={kind:'leak',hp:10,maxHp:10};
    assert.equal(x.api.staff(x.api.model(x.v)),null,kind);assert.ok(x.context.shelterStaffHold,kind);
  }
});
test('换位接续：期间暂停新出征、训练、医疗电台工坊补员，解除后恢复原选项',()=>{
  const x=setup();
  const flags={...x.api.defaults,development:true,defense:false,combatGear:false,stimpaks:0,reserve:0};
  for(const role of ['training','explore','quests','medical','radio','workshop']){
    const v=campaignView(),cfg={...flags,training:false,explore:false,quests:false,medical:false,radio:false,workshop:false,[role]:true,trainTarget:10,partsTarget:20};
    if(['training','medical','radio','workshop'].includes(role)){
      const type={training:'training',medical:'medbay',radio:'radio',workshop:'workshop'}[role];
      v.state.rooms.push({...v.state.rooms[0],id:90,type,level:1,trainStat:'end'});
    }
    v.state.resources.stimpak=0;
    if(role==='radio'){
      v.state.rooms.find(r=>r.id===4).width=2;
      v.state.residents.slice(4).forEach(p=>p.roomId=4);
    }
    const p=x.api.raw(x.api.model(v),cfg,{},14);
    assert.ok(p.actions.some(a=>role==='explore'?a.kind==='explore-start':role==='quests'?a.kind==='quest-start':a.role===role),role+' control offers work');
    const held=x.api.raw(x.api.model(v),cfg,{assignmentInProgress:true},14);
    assert.equal(held.actions.length,0,role);assert.equal(held.projects.length,0,role);
  }
});
test('换位接续：召回、急救、防守及已完成训练返岗继续处理',()=>{
  const x=setup(),v=campaignView(),cfg={...x.api.defaults,development:true,defense:true,medical:true,training:true,explore:true};
  v.state.residents[4].away={kind:'explore'};
  v.state.explorers=[{id:81,residentId:5,tier:0,abyss:false,startedAt:v.serverTime-6*3600000,recalledAt:null,returnAt:null}];
  const record={assignmentInProgress:true,trips:[{id:81,resident:5,hours:6}]};
  assert.equal(x.api.raw(x.api.model(v),cfg,record).choice.kind,'explore-recall');
  v.state.rooms.push({...v.state.rooms[0],id:90,type:'door',incident:{kind:'raiders',hp:80,maxHp:80}});
  Object.assign(v.state.residents[0],{roomId:90,hp:20});
  const emergency=x.api.raw(x.api.model(v),cfg,record);
  assert.equal(emergency.choice.kind,'stimpak');assert.ok(emergency.actions.some(a=>a.kind==='rescue'));
  v.state.rooms.at(-1).incident=null;v.state.residents[0].hp=100;
  v.state.rooms.push({...v.state.rooms[0],id:91,type:'training',trainStat:'end'});
  Object.assign(v.state.residents[5],{roomId:91,training:0});
  record.roles=[{id:6,room:91,role:'training',stat:'end',base:7,at:v.serverTime-3600000}];
  assert.ok(x.api.raw(x.api.model(v),cfg,record).actions.some(a=>a.role==='training-release'&&a.id===6));
});
test('换位接续：仍有实际用途的医疗、电台和工坊保持现岗，补员等待不会关闭原值班',()=>{
  const x=setup();
  for(const [role,type] of [['medical','medbay'],['radio','radio'],['workshop','workshop']]){
    const v=campaignView(),s=v.state;
    s.rooms.push({...s.rooms[0],id:90,type,level:1});s.residents[4].roomId=90;s.resources.stimpak=0;
    if(role==='radio')s.residents[5].roomId=4;
    const cfg={...x.api.defaults,development:true,defense:false,training:false,explore:false,quests:false,combatGear:false,
      medical:false,radio:false,workshop:false,[role]:true,partsTarget:20};
    const record={assignmentInProgress:true,roles:[{id:5,room:90,role,at:v.serverTime}]};
    const before=JSON.stringify(v),p=x.api.raw(x.api.model(v),cfg,record,14);
    assert.equal(JSON.stringify(v),before);assert.ok(p.reserved.includes(5),role);
    assert.ok(!p.actions.some(a=>a.id===5),role);assert.ok(!p.actions.some(a=>a.role===role),role+' no extra shift');
  }
});
