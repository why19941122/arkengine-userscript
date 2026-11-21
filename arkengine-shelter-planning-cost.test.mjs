import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function setup(){
  const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(name=>source.match(new RegExp(`const ${name}\\s*=[^;]*;`))[0]).join('\n');
  let kernel=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
  const calls={};
  for(const name of ['shelterDepartureLoadout','shelterOperationHeld','shelterTrainingReturn'])kernel=kernel.replace(
    new RegExp(`(function ${name}\\([^\\n]+\\) \\{)`),`$1 calls['${name}']=(calls['${name}']||0)+1;`);
  kernel=kernel.replace(/(function shelterTrainingReturn\([^\n]+\) \{)/,
    '$1 calls.incompatibleTraining=(calls.incompatibleTraining||0)+Number(!shelterTrainingPurpose(m,p,room).compatible);');
  const api=vm.runInNewContext(`${declarations}\n${kernel}\n({model:shelterModel,plan:shelterCampaignPlan,departure:shelterDepartureLoadout,defaults:campaignDefaults})`,{
    calls,objectState:value=>value!==null&&typeof value==='object'&&!Array.isArray(value),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
  return {api,calls};
}

test('规划减负：只有生产训练时不计算出征装备，仍选择可回本的一格训练',()=>{
  const {api,calls}=setup(),view=campaignView(),state=view.state;
  state.rooms.push({...state.rooms[0],id:90,type:'training',trainStat:'end',floor:3});
  for(const person of state.residents){person.stats.end=5;person.xp=0;person.hp=100;}
  const before=JSON.stringify(view),plan=api.plan(api.model(view),{...api.defaults,development:true,training:true,combatGear:true},{});
  assert.ok(plan.actions.some(action=>action.role==='training'&&action.purpose==='production'));
  assert.equal(calls.shelterDepartureLoadout||0,0);
  assert.equal(JSON.stringify(view),before);
});

test('规划减负：没有武器时保留闲置服装收益，跳过供体扫描及无效防守试算',()=>{
  const {api,calls}=setup(),view=campaignView();
  view.state.items=[{id:90,slot:'outfit',bonus:{str:2}}];
  const model=api.model(view),team=[model.state.residents[4]],options=new Map();let checks=0;
  const before=JSON.stringify(model),plan=api.departure(model,team,true,[],options,{},[],()=>{checks++;return false;});
  assert.equal(plan.changes.length,1);assert.equal(plan.changes[0].item,90);
  assert.equal(calls.shelterOperationHeld||0,0);assert.equal(checks,0);
  assert.equal(JSON.stringify(model),before);
});

test('规划减负：七种训练室只评估原岗位适用属性，保留生产训练动作',()=>{
  const {api,calls}=setup(),view=campaignView(),state=view.state;
  state.rooms.find(room=>room.type==='scrap').width=3;
  state.rooms.find(room=>room.type==='power').width=3;
  state.residents.push(...[7,8].map(id=>({...structuredClone(state.residents[0]),id,name:'供电居民'+id})));
  for(const [index,stat] of ['str','per','end','agi','int','cha','lck'].entries())
    state.rooms.push({...state.rooms[0],id:90+index,type:'training',trainStat:stat,floor:3+index});
  for(const person of state.residents){
    person.stats.end=5;person.xp=0;person.hp=100;
    if([5,6].includes(person.id))person.roomId=4;
    if(person.roomId===1)person.stats.str=10;
  }
  const plan=api.plan(api.model(view),{...api.defaults,development:true,training:true,trainTarget:10},{});
  assert.ok(plan.actions.some(action=>action.role==='training'&&action.stat==='end'&&action.purpose==='production'),plan.notes.join('\n'));
  assert.equal(calls.incompatibleTraining,0);
});

test('规划减负：共享供体限制不跨快照，队伍、已派出和装备预留仍逐次核对',()=>{
  const {api,calls}=setup(),view=campaignView(),state=view.state;
  state.items=[{id:90,slot:'weapon',damage:[10,10]}];state.residents[0].weaponId=90;
  const model=api.model(view),team=[model.state.residents[4]],options=new Map(),record={defenseManual:[]};
  const run=(departing=[],blocked=[],members=team,cache=options)=>api.departure(model,members,true,blocked,cache,record,departing,()=>true);
  assert.equal(run().changes[0].fromOwner,1);
  assert.equal(run([1]).changes.length,0);
  assert.equal(run([],[90]).changes.length,0);
  assert.equal(run([],[],[model.state.residents[0]]).changes.length,0);
  assert.equal(run().changes[0].fromOwner,1);
  assert.equal(calls.shelterOperationHeld,1);
  record.defenseManual=[1];assert.equal(run([],[],team,new Map()).changes.length,0);
  assert.equal(calls.shelterOperationHeld,2);
});

test('规划减负：已找到可行最佳武器后，不为更差方案重复扫描全员留守',()=>{
  const {api}=setup(),view=campaignView(),state=view.state;
  state.items=[90,91,92].map((id,index)=>({id,slot:'weapon',damage:[10-index,10-index]}));
  state.residents.slice(0,3).forEach((person,index)=>person.weaponId=90+index);
  const model=api.model(view),team=[state.residents[4]],checked=[];
  const plan=api.departure(model,team,true,[],new Map(),{},[],candidate=>{
    checked.push(candidate.changes[0].item);return true;
  });
  assert.equal(plan.changes[0].item,90);
  assert.deepEqual(checked,[90]);
  const fallback=api.departure(model,team,true,[],new Map(),{},[],candidate=>candidate.changes[0].item!==90);
  assert.equal(fallback.changes[0].item,91);
});
