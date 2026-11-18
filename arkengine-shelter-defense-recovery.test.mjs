import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
import {createShelterResourceSimulation} from './arkengine-shelter-resource-simulation.mjs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(name=>
  source.match(new RegExp(`const ${name}\\s*=[^;]*;`))[0]).join('\n');
const code=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const reconcile=source.slice(source.indexOf('  function reconcileShelterDefense('),source.indexOf('  function closeShelterRecall('));
const recordCode=source.slice(source.indexOf('  function recordShelterCampaign('),source.indexOf('  function shelterFormValue('));
const api=vm.runInNewContext(`${declarations}\n${code}\n${reconcile}\n${recordCode}
  let shelterState,shelterPending=null,shelterStaffMode='production',shelterStaffHold=false,shelterCampaign={defense:true};
  const workshopAutomatic=()=>false,saveShelter=s=>shelterState=s,log={add(){}},shelterRaidTiming=()=>{};
  ({model:shelterModel,plan:shelterDefensePlan,select:shelterDefenseReturn,
    reconcile:(m,state,pending=null)=>{shelterState=state;shelterPending=pending;reconcileShelterDefense(m);return shelterState;},
    receipt:(m,state,p)=>{shelterState=state;recordShelterCampaign(p,m);return shelterState;}})`,{
  objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
  shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
const tick=600000;
const record=extra=>({roles:[],trips:[],attempts:[],heals:[],trainingRest:[],defense:[],defenseManual:[],...extra});
const cfg={defense:true,development:true,training:true,reserve:2};
function scene(from=4){
  const v=campaignView(),s=v.state,p=s.residents.find(p=>p.id===5);
  s.rooms.push({...s.rooms[0],id:90,type:'door',level:1,col:0});p.roomId=90;
  return {v,p,r:record({defense:[{id:5,room:90,from,at:v.serverTime-tick}]})};
}
const run=(v,r,c=cfg)=>api.plan(api.model(v),c,r);
const normalized=x=>JSON.parse(JSON.stringify(x));

test('defense recovery: unavailable origin no longer strands a worker when a safe productive vacancy exists',()=>{
  const {v,r}=scene(999),before=JSON.stringify([v,r]);
  assert.equal(run(v,r,{...cfg,development:false}).actions.length,0);
  const plan=run(v,r);assert.equal(plan.actions[0].room,4);
  assert.equal(plan.actions[0].original,999);assert.equal(plan.actions[0].role,'defense-release');
  assert.equal(JSON.stringify([v,r]),before,'planning is pure');
});
test('defense recovery: current water shortage outranks returning to scrap without reducing other supply',()=>{
  const {v,r}=scene();v.state.residents.find(p=>p.id===3).roomId=4;
  const c=run(v,r).actions[0];assert.equal(c.room,3);
  for(const k of ['power','food','water'])assert.ok(c.recovery.productionAfter[k]>=c.recovery.productionBefore[k]);
  assert.equal(c.recovery.productionBefore.water,0);assert.ok(c.recovery.productionAfter.water>0);
});
test('defense recovery: a productive current post is kept when moving would transfer a shortage',()=>{
  const {v,r}=scene();const p=v.state.residents.find(p=>p.id===2);
  r.defense=[{id:2,room:2,from:4,at:v.serverTime-tick}];
  v.state.residents.find(p=>p.id===3).roomId=4;
  const plan=run(v,r);assert.deepEqual(normalized(plan.settled),[p.id]);assert.equal(plan.actions.length,0);
});
test('defense recovery: future training seats and other defenders returns cannot be double claimed',()=>{
  const {v,r}=scene(999),s=v.state;
  s.rooms.push({...s.rooms[0],id:7,type:'training',trainStat:'end'});s.residents.find(p=>p.id===6).roomId=7;
  r.roles=[{id:6,room:7,role:'training',stat:'end',base:8,purpose:'production',destination:4,
    at:v.serverTime-tick,until:v.serverTime+tick,windowEnd:v.serverTime+168*3600000}];
  assert.notEqual(run(v,r).actions[0].room,4);
  r.roles=[];s.residents.find(p=>p.id===6).roomId=90;
  r.defense.push({id:6,room:90,from:4,at:v.serverTime-tick});
  assert.notEqual(run(v,r).actions.find(a=>a.id===5).room,4);
});
test('defense recovery: unfinished training retains deadline, expired training goes directly to its production destination',()=>{
  const {v,p,r}=scene(7);v.state.rooms.push({...v.state.rooms[0],id:7,type:'training',trainStat:'end',unpowered:true});
  r.roles=[{id:p.id,room:7,role:'training',stat:'end',base:8,purpose:'production',destination:4,
    at:v.serverTime-tick,until:v.serverTime+tick,windowEnd:v.serverTime+168*3600000}];
  assert.equal(run(v,r).actions.length,0);
  v.serverTime+=2*tick;const c=run(v,r).actions[0];assert.equal(c.room,4);assert.equal(c.recovery.trainingFinished,true);
  assert.equal(r.roles[0].until,v.serverTime-tick,'deadline was not renewed during recovery');
});
test('defense recovery: real family and unknown birth ownership retain their original purpose',()=>{
  for(const kind of ['romance','reserved','unknown-birth']){
    const {v,p,r}=scene(5);
    if(kind==='romance')p.romance={partnerId:6,progress:.5};
    if(kind==='reserved')r.familyReserved=[5,6];
    if(kind==='unknown-birth')v.state.births=[{roomId:5,dueAt:v.serverTime+3600000}];
    assert.equal(run(v,r).actions[0].room,5,kind);
  }
});
test('defense recovery: useful workshop duty survives temporary power loss and does not spend reserved materials',()=>{
  const {v,r}=scene(7);v.state.rooms.push({...v.state.rooms[0],id:7,type:'workshop',unpowered:true});
  r.materials={vaultNo:77,id:4,type:'scrap',level:3,targetLevel:8,finalTarget:8};
  const before=JSON.stringify([v,r]);assert.equal(run(v,r,{...cfg,workshop:true}).actions.length,0);
  assert.equal(JSON.stringify([v,r]),before);
  assert.equal(run(v,r,{...cfg,workshop:true,partsTarget:0}).actions[0].room,4);
});
test('defense recovery: unresolved original requests and active raids do not enter ordinary replanning',()=>{
  const {v,r}=scene(999);r.pending={id:'original'};
  assert.equal(run(v,r).actions.length,0);
  delete r.pending;v.state.rooms.find(r=>r.id===90).incident={kind:'raiders',hp:80,maxHp:80};
  const plan=run(v,r);assert.equal(plan.active,true);assert.equal(plan.settled.length,0);
  assert.deepEqual(Array.from(plan.actions,a=>[a.kind,a.room]),[['rescue',90]]);
});
test('defense recovery: low health and occupied or unpowered destinations do not enable a new production move',()=>{
  const {v,p,r}=scene(999);p.hp=1;assert.equal(run(v,r).actions.length,0);
  p.hp=142;for(const room of v.state.rooms)if(['power','diner','water','scrap'].includes(room.type))room.unpowered=true;
  const plan=run(v,r);assert.equal(plan.actions.length,0);assert.ok(plan.notes.some(n=>n.includes('无不恶化')));
});
test('defense recovery: no-op reconciliation retains unrelated state and cannot consume an unresolved request',()=>{
  const {v,r}=scene(999);v.state.residents.find(p=>p.id===5).roomId=4;r.defense[0].room=4;
  const state={nextAt:0,note:'fixture',vaultNo:77,campaign:r,families:[]};
  const protectedState=api.reconcile(api.model(v),structuredClone(state),{id:'original'});
  assert.equal(protectedState.campaign.defense.length,1);
  const once=api.reconcile(api.model(v),structuredClone(state));assert.equal(once.campaign.defense.length,0);
  const twice=api.reconcile(api.model(v),normalized(once));assert.deepEqual(normalized(twice),normalized(once));
  assert.deepEqual(once.families,[]);
});
test('defense recovery: a confirmed redirected return retires only the obsolete role and records actual training exit',()=>{
  const {v,p,r}=scene(7);p.roomId=4;
  r.roles=[{id:5,room:7,role:'training',stat:'end',base:8,at:v.serverTime-tick},
    {id:4,room:4,role:'workshop',at:v.serverTime-tick}];
  const choice={kind:'assign',role:'defense-release',room:4,original:7,targets:[5,4],reason:'return'};
  const pending={kind:'assign',targets:[5,4],before:{campaign:{choice}},result:{campaignProof:{at:v.serverTime}}};
  const state=api.receipt(api.model(v),{campaign:r},pending);
  assert.equal(state.campaign.defense.length,0);assert.equal(state.campaign.roles.length,1);
  assert.equal(state.campaign.roles[0].id,4);assert.deepEqual(normalized(state.campaign.trainingRest),[{id:5,at:v.serverTime}]);
});
test('defense recovery: same three-hour window converts an otherwise waiting adult into an extra collected scrap batch',()=>{
  const {v,r}=scene(999),next=structuredClone(v),choice=run(v,r).actions[0];
  next.state.residents.find(p=>p.id===choice.id).roomId=choice.room;
  const sim=createShelterResourceSimulation(),end=v.serverTime+3*3600000;
  const baseline=sim.collect(sim.advance(v,end).view),candidate=sim.collect(sim.advance(next,end).view);
  assert.equal(baseline.view.serverTime,candidate.view.serverTime);
  const difference=candidate.ledger.collected.scrap-baseline.ledger.collected.scrap;
  assert.equal(difference,63);
  for(const k of ['power','food','water'])assert.equal(candidate.view.state.resources[k],baseline.view.state.resources[k]);
  console.log(JSON.stringify({kind:'defense-recovery-3h',from:v.serverTime,to:end,resident:choice.id,destination:choice.room,
    baselineCollected:baseline.ledger.collected.scrap,candidateCollected:candidate.ledger.collected.scrap,difference,
    scope:'same-window conditional fixture, constant mood/XP/health, one confirmed initial move and final collection; not real or seven-day improvement'}));
});
