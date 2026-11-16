import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setupParentTraining72} from './arkengine-shelter-parent-training72.fixture.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x)),hour=3600000;
function setup(){
  const x=setupParentTraining72(source);
  Object.assign(x.api,vm.runInContext(source.slice(source.indexOf('  function shelterMaintenanceSchedule('),source.indexOf('  function shelterCampaignChoice('))+
    '\n({record:recordShelterCampaign,valid:validCampaignRecord,capacity:shelterStaffCapacity,idle:shelterIdleEmploymentChoice,employment:shelterEmploymentSchedule})',x.context));
  x.apply=a=>{x.f.view.state.residents.find(p=>p.id===a.id).roomId=a.room;
    x.api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:x.f.view.serverTime}}},x.m());};
  x.begin=()=>{const a=x.choose();assert.equal(a?.purpose,'parent');x.apply(a);return a;};
  return x;
}
test('父母返岗承诺：实际入训保存原生产岗，刷新后普通调度和快速就业共同保留',()=>{
  const x=setup(),a=x.begin();assert.equal(a.destination,4);
  x.context.shelterState=plain(x.context.shelterState);
  const role=x.context.shelterState.campaign.roles.find(r=>r.id===a.id);assert.equal(role.destination,4);
  assert.equal(x.api.valid(x.context.shelterState.campaign),true);
  for(const plan of [x.api.schedule(x.m()),x.api.employment(x.m())])
    assert.ok(plan.trainingDestinations.some(d=>d.id===a.id&&d.room===4));
});
test('父母返岗承诺：后来的闲置成人不能占用已在训父母的最后一个原岗位',()=>{
  const x=setup(),a=x.begin(),s=x.f.view.state;
  // Explicit stored destination isolates all consumers from the admission write.
  x.context.shelterState.campaign.roles[0].destination=4;
  s.rooms=s.rooms.filter(r=>r.id!==92);
  s.residents.push({...structuredClone(s.residents[3]),id:10,name:'已有工人',roomId:4},
    {...structuredClone(s.residents[3]),id:11,name:'后来成人',roomId:null});
  const m=x.m(),fast=x.api.employment(m);assert.equal(x.api.idle(m,fast),null);
  assert.equal(x.api.capacity({...m,trainingDestinations:fast.trainingDestinations},s.rooms.find(r=>r.id===4)),5);
  assert.ok(x.api.schedule(m).trainingDestinations.some(d=>d.id===a.id&&d.room===4));
});
test('父母返岗承诺：冷却内完成一格直接回原岗，记录只释放一次且不重练',()=>{
  const x=setup(),a=x.begin(),s=x.f.view.state,p=s.residents.find(p=>p.id===a.id);
  x.context.shelterState.campaign.roles[0].destination=4;
  x.f.view.serverTime+=3*hour;s.lastSettledAt=x.f.view.serverTime;p.stats[a.stat]++;p.training=0;
  const release=x.api.schedule(x.m()).actions.find(c=>c.id===a.id);
  assert.equal(release?.role,'training-release');assert.equal(release.room,4);x.apply(release);
  assert.equal(x.context.shelterState.campaign.roles.some(r=>r.id===a.id),false);
  assert.equal(x.context.shelterState.campaign.trainingRest.filter(r=>r.id===a.id).length,1);
  assert.equal(x.api.schedule(x.m()).actions.some(c=>c.id===a.id&&c.role==='training'),false);
});
test('父母返岗承诺：旧记录不虚构原岗，新增字段非法时拒绝整条记录',()=>{
  const x=setup(),a=x.begin(),role=x.context.shelterState.campaign.roles[0];delete role.destination;
  assert.equal(x.api.valid(x.context.shelterState.campaign),true);
  const p=x.f.view.state.residents.find(p=>p.id===a.id);p.stats[a.stat]++;p.training=0;
  assert.equal(x.api.schedule(x.m()).actions.find(c=>c.id===a.id)?.room,null);
  for(const destination of [null,0,-1,'4',4.5]){role.destination=destination;assert.equal(x.api.valid(x.context.shelterState.campaign),false);}
});
test('父母返岗承诺：原房失效、满员、低健康或临近生育时不强制回原岗',()=>{
  for(const kind of ['missing','building','upgrading','incident','power','full','hurt','family']){
    const x=setup(),a=x.begin(),s=x.f.view.state,p=s.residents.find(p=>p.id===a.id),room=s.rooms.find(r=>r.id===4);
    p.stats[a.stat]++;p.training=0;
    if(kind==='missing')s.rooms=s.rooms.filter(r=>r.id!==4);
    if(kind==='building')room.builtAt=x.f.view.serverTime+hour;
    if(kind==='upgrading')room.upgradeAt=x.f.view.serverTime+hour;
    if(kind==='incident')room.incident={kind:'fire',strength:1,startedAt:x.f.view.serverTime};
    if(kind==='power')room.unpowered=true;
    if(kind==='full')for(const id of [10,11])s.residents.push({...structuredClone(s.residents[3]),id,name:'已占岗'+id,roomId:4});
    if(kind==='hurt')p.hp=1;
    if(kind==='family')p.familyCooldownUntil=x.f.view.serverTime+600000;
    assert.ok(!x.api.schedule(x.m()).actions.some(c=>c.id===a.id&&c.room===4),kind);
  }
});
test('父母返岗承诺：实际离开训练后不残留虚假席位，原期限已过仍保护在训者',()=>{
  const x=setup(),a=x.begin(),p=x.f.view.state.residents.find(p=>p.id===a.id);
  x.context.shelterState.campaign.roles[0].until=x.f.view.serverTime-1;
  assert.ok(x.api.employment(x.m()).trainingDestinations.some(d=>d.id===a.id));
  p.roomId=null;
  assert.ok(!x.api.employment(x.m()).trainingDestinations.some(d=>d.id===a.id));
});
test('父母返岗承诺：原训练房仍在的人工换房、属性不符或倒下不冒充合并',()=>{
  for(const kind of ['manual','stat','down']){
    const x=setup(),a=x.begin(),s=x.f.view.state,p=s.residents.find(p=>p.id===a.id),old=s.rooms.find(r=>r.id===a.room);
    s.rooms.push({...old,id:89,trainStat:kind==='stat'?'cha':old.trainStat});p.roomId=89;
    if(kind!=='manual')s.rooms=s.rooms.filter(r=>r.id!==a.room);
    if(kind==='down')p.deadAt=x.f.view.serverTime;
    assert.ok(!x.api.employment(x.m()).trainingDestinations.some(d=>d.id===a.id),kind);
  }
});
test('父母返岗承诺：训练室合并和当前格收尾保留同一原岗位，不重新推断',()=>{
  const x=setup(),a=x.begin(),s=x.f.view.state,p=s.residents.find(p=>p.id===a.id),room=s.rooms.find(r=>r.id===a.room);
  room.id=89;p.roomId=89;p.training=.7;
  assert.ok(x.api.employment(x.m()).trainingDestinations.some(d=>d.id===a.id&&d.room===4),
    'quick employment before the full rebind must still hold the original job');
  x.api.schedule(x.m());
  assert.equal(x.context.shelterState.campaign.roles[0].room,89);
  assert.equal(x.context.shelterState.campaign.roles[0].destination,4);
  x.f.view.serverTime+=6*hour;s.lastSettledAt=x.f.view.serverTime;p.familyCooldownUntil=x.f.view.serverTime;
  const plan=x.api.schedule(x.m()),finish=x.context.shelterState.campaign.roles.find(r=>r.id===a.id);
  assert.ok(finish?.finishCurrent);assert.equal(finish.destination,4);
  assert.ok(plan.trainingDestinations.some(d=>d.id===a.id&&d.room===4));
  const original=plain(finish);x.api.schedule(x.m());
  assert.deepEqual(plain(x.context.shelterState.campaign.roles.find(r=>r.id===a.id)),original);
});
