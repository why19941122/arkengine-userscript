import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const fixture=JSON.parse(readFileSync(new URL('./arkengine-shelter-population-stage.fixture.json',import.meta.url),'utf8'));
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const context={objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
  shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}};
const implementation=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const api=vm.runInNewContext(`${declarations}\n${implementation}\n({model:shelterModel,stage:shelterPopulationStage})`,context);
function setup(){
  const {view,state}=structuredClone(fixture);
  const stage=(target=30,continuous=true,pending=null)=>api.stage(api.model(view),target,continuous,state,pending);
  return {view,state,stage};
}

test('持续人口：已实际就业的30人可规划40，改变阶段不产生人口、岗位、资源或预算',()=>{
  const {view,state,stage}=setup(),before=JSON.stringify({view,state}),p=stage();
  assert.equal(p.population,30);assert.equal(p.ready,true,JSON.stringify(p));assert.equal(p.nextTarget,40);
  assert.equal(stage(40).status,'growing');assert.equal(stage(40).ready,false,'同一快照不能连续抬高阶段');
  assert.equal(JSON.stringify({view,state}),before);
});
test('持续人口：40人完成本阶段后继续50，最终仍守住现有200人支持范围',()=>{
  const {view,state,stage}=setup(),s=view.state;
  for(const [i,type] of ['diner','water','power','scrap','scrap'].entries()){
    const room={...s.rooms[0],id:2000+i,type,width:1,level:3,builtAt:0,upgradeAt:null,stored:0,incident:null,unpowered:false};
    s.rooms.push(room);
    for(let j=0;j<2;j++){const id=100+2*i+j;
      s.residents.push({...structuredClone(s.residents[0]),id,name:`已就业居民${id}`,parents:[1,2],roomId:room.id});}
  }
  const m=api.model(view);
  const p=api.stage(m,40,true,state);
  assert.equal(p.ready,true,JSON.stringify(p));assert.equal(p.nextTarget,50);
  assert.equal(stage(195).nextTarget,200);assert.equal(stage(200).ready,false);assert.equal(stage(200).status,'limit');
});
test('持续人口：固定上限、无效目标与不足阶段人数均不自动扩大',()=>{
  const {stage}=setup();
  assert.equal(stage(30,false).ready,false);assert.equal(stage(30,false).status,'fixed');
  for(const n of [null,0,201,NaN])assert.equal(stage(n).status,'invalid');
  assert.equal(stage(40).status,'growing');
});
test('持续人口：儿童、待产、倒下、事件和未知原请求分别阻止阶段前移',()=>{
  const changes=[
    ['儿童',({view})=>{view.state.residents.at(-1).adultAt=view.serverTime+3600000;}],
    ['待产',({view})=>{view.state.births.push({id:99,roomId:view.state.rooms.find(r=>r.type==='quarters').id,parents:[13,14],dueAt:view.serverTime+3600000});}],
    ['恢复',({view})=>{view.state.residents.push({...structuredClone(view.state.residents[0]),id:999,deadAt:view.serverTime});}],
    ['事件',({view})=>{view.state.rooms[0].incident={kind:'raiders'};}],
    ['配对',({state})=>{state.pair={a:13,b:14};}],
    ['换位',({state})=>{state.swap={people:[]};}],
  ];
  for(const [label,change] of changes){const s=setup();change(s);const p=s.stage();assert.equal(p.ready,false,label);assert.ok(p.blocks.some(x=>x.includes(label)),JSON.stringify(p));}
  assert.ok(setup().stage(30,true,{id:'unknown'}).blocks.some(x=>x.includes('原操作')));
});
test('持续人口：成年子女休息、回宿舍或所处生产房停工时先落实就业',()=>{
  for(const type of ['rest','quarters','construction']){
    const {view,stage}=setup(),s=view.state,p=s.residents.find(p=>p.id===49);
    assert.ok(p&&p.parents.length===2);
    if(type==='rest')p.roomId=null;
    if(type==='quarters')p.roomId=s.rooms.find(r=>r.type==='quarters').id;
    if(type==='construction')s.rooms.find(r=>r.id===p.roomId).upgradeAt=view.serverTime+3600000;
    const plan=stage();assert.equal(plan.ready,false);assert.ok(plan.unemployed.includes(p.id));
  }
});
test('持续人口：当前供应余量和两小时库存不足时先恢复，下一阶段按实际容量逐对放行',()=>{
  for(const resource of ['power','food','water']){
    const {view,state}=setup(),m=api.model(view);m.production[resource]=0;
    assert.ok(api.stage(m,30,true,state).blocks.some(x=>x.includes('时产')));
    m.production[resource]=1000;view.state.resources[resource]=0;
    assert.ok(api.stage(api.model(view),30,true,state).blocks.some(x=>x.includes('库存')));
  }
  const {view,state}=setup(),m=api.model(view);m.populationCap=30;
  const p=api.stage(m,30,true,state);assert.equal(p.ready,true,'仅提高规划目标，不能要求床位先扩好才允许规划扩床');
  assert.equal(m.populationCap,30);assert.equal(p.nextTarget,40);
});
