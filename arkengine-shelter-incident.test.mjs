import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(name=>source.match(new RegExp(`const ${name}\\s*=[^;]*;`))[0]).join('\n');
const code=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const api=vm.runInNewContext(`${declarations}\n${code}\n({model:shelterModel,plan:shelterDefensePlan,campaign:shelterCampaignPlan})`,{
  objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
  shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
const record=extra=>({roles:[],trips:[],attempts:[],heals:[],trainingRest:[],defense:[],families:[],...extra});
const run=(v,r=record(),cfg={defense:true})=>api.plan(api.model(v),cfg,r);
const normalize=x=>JSON.parse(JSON.stringify(x));
function incident(kind='fire'){
  const v=campaignView();v.state.rooms.find(r=>r.id===3).incident={kind,hp:9.4,maxHp:19};
  return v;
}
for(const kind of ['raiders','fire','rats','leak','beast'])test(`native rescue targets the affected room, not a resident: ${kind}`,()=>{
  const view=incident(kind),before=JSON.stringify(view),plan=run(view);
  assert.deepEqual(normalize(plan.actions.map(action=>[action.kind,action.targets,action.incidentKind,action.present])),[['rescue',[3],kind,1]]);
  assert.ok(plan.busy);assert.equal(JSON.stringify(view),before);
});
for(const [start,expected,batchCount] of [[0,102,34],[99,102,1],[100,103,1],[101,101,0]])test(`native rescue: ${start} present, stop after crossing 100`,()=>{
  const view=incident(),state=view.state,base=state.residents[0];
  state.residents=Array.from({length:110},(_,index)=>({...base,id:index+1,name:`成人${index+1}`,roomId:index<start?3:null}));
  let batches=0;
  for(;batches<38;batches++){
    const plan=run(view);if(!plan.actions.length)break;
    assert.deepEqual(normalize(plan.actions.map(action=>action.targets)),[[3]]);
    for(const person of state.residents.filter(person=>person.roomId!==3).slice(0,3))person.roomId=3;
  }
  assert.equal(batches,batchCount);assert.equal(state.residents.filter(person=>person.roomId===3).length,expected);
  assert.equal(run(view).busy,true);state.rooms.find(room=>room.id===3).incident=null;assert.deepEqual(normalize(run(view).actions),[]);
});
test('native rescue: exhausted home roster excludes children, away, deceased and incapacitated residents',()=>{
  const view=incident(),state=view.state;for(const person of state.residents)person.roomId=3;
  for(const [index,change] of [{adultAt:view.serverTime+1},{away:{kind:'explore'}},{deadAt:view.serverTime},{hp:0}].entries())Object.assign(state.residents[index],{roomId:2},change);
  assert.deepEqual(normalize(run(view).actions),[]);
});
test('local incident: keep rescuers while active, then return using the existing journal',()=>{
  const v=incident(),s=v.state;s.residents[3].roomId=3;s.residents[4].roomId=3;
  const r=record({defense:[{id:4,room:3,from:4,at:v.serverTime-1}]});
  assert.ok(!run(v,r).actions.some(a=>a.role==='defense-release'));
  s.rooms.find(r=>r.id===3).incident=null;
  assert.deepEqual(normalize(run(v,r).actions.map(a=>[a.id,a.room,a.role])),[[4,4,'defense-release']]);
});
test('local incident: disabled, unknown kinds and pending native actions do not dispatch new rescuers',()=>{
  assert.equal(run(incident(),record(),{defense:false}).actions.length,0);
  assert.equal(run(incident('unknown')).actions.length,0);
  assert.equal(run(incident(),record({pending:{id:'unknown'}})).actions.length,0);
});
test('local incident: raiders retain priority without pulling people out of another active incident',()=>{
  const v=incident(),s=v.state;s.rooms.push({...s.rooms[0],id:90,type:'door',incident:{kind:'raiders',hp:80,maxHp:80}});
  const p=run(v);assert.deepEqual(normalize(p.actions.map(a=>[a.kind,a.room])),[['rescue',90],['rescue',3]]);
  assert.ok(!p.actions.some(a=>a.id===3));
});
