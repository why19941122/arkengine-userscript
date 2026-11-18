import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const code=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const api=vm.runInNewContext(declarations+'\n'+code+'\n({model:shelterModel,plan:shelterCampaignPlan,defaults:campaignDefaults})',{
  objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
  shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
function scene(){
  const v=campaignView(),s=v.state;
  s.rooms.push({...s.rooms[0],id:90,type:'door',level:1,width:1,incident:{kind:'raiders',hp:1,maxHp:80}});
  for(const p of s.residents)p.roomId=90;
  const traveler=s.residents.at(-1);traveler.roomId=null;traveler.away={kind:'explore'};
  s.explorers=[{id:81,residentId:traveler.id,startedAt:v.serverTime-3*3600000,abyss:false,recalledAt:null,returnAt:null,tier:0}];
  const record={trips:[{id:81,resident:traveler.id,hours:1,startedAt:s.explorers[0].startedAt,vaultNo:v.vaultNo}]};
  const cfg={...api.defaults,explore:true,defense:true,quests:false,medical:false,training:false,radio:false,combatGear:false,development:false};
  return {v,s,traveler,record,cfg};
}
const run=x=>api.plan(api.model(x.v),x.cfg,x.record,20);
test('独立收尾：所有养成开关开启仍只核对已有召回，不调用新出征装备或训练搜索',()=>{
  const guarded=vm.runInNewContext(declarations+'\n'+code+`\n
    shelterDepartureLoadout=()=>{throw Error('independent maintenance entered loadout search');};
    shelterTrainingReturn=()=>{throw Error('independent maintenance entered training search');};
    ({model:shelterModel,plan:shelterCampaignPlan})`,{
    objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
  const x=scene();x.s.rooms.at(-1).incident=null;
  Object.assign(x.cfg,{maintenanceOnly:true,development:true,training:true,medical:true,radio:true,combatGear:true,quests:true});
  const before=JSON.stringify(x.v),p=guarded.plan(guarded.model(x.v),x.cfg,x.record,20);
  assert.equal(JSON.stringify(x.v),before);assert.equal(p.actions.length,1);assert.equal(p.choice.kind,'explore-recall');
  assert.equal(p.adoptions.length,0);assert.equal(p.projects.length,0);
});
test('独立收尾：增援和战斗治疗仍优先，不因轻量收尾跳过防守',()=>{
  const x=scene();Object.assign(x.cfg,{maintenanceOnly:true,medical:true});x.s.residents[0].roomId=1;x.s.residents[1].hp=20;
  const full=run({...x,cfg:{...x.cfg,maintenanceOnly:false}}),light=run(x);
  assert.deepEqual(light.actions,full.actions);assert.equal(light.defense.urgent,true);assert.equal(light.choice.kind,'stimpak');
});
test('独立收尾：没有已到期行程就返回，无新训练、调岗、治疗或出征',()=>{
  const x=scene();x.s.rooms.at(-1).incident=null;x.s.explorers[0].recalledAt=x.v.serverTime;
  Object.assign(x.cfg,{maintenanceOnly:true,development:true,training:true,medical:true,radio:true,combatGear:true,quests:true});
  const p=run(x);assert.equal(p.choice,null);assert.equal(p.actions.length,0);assert.equal(p.projects.length,0);
});
for(const hp of [142,20])test(`防守收尾：无增援动作时保留已到期召回，外出血量${hp}`,()=>{
  const x=scene();x.traveler.hp=hp;const before=JSON.stringify(x.v),p=run(x);
  assert.equal(JSON.stringify(x.v),before);assert.equal(p.defense.busy,true);
  assert.equal(p.defense.actions.length,0);assert.equal(p.choice.kind,'explore-recall');
  assert.deepEqual(Array.from(p.choice.targets),[81]);assert.equal(p.defense.urgent,false);
});
test('防守收尾：低血量未到期也能召回，已返程与关闭探险不重复召回',()=>{
  const x=scene();x.record.trips[0].hours=6;x.traveler.hp=20;
  assert.equal(run(x).choice.kind,'explore-recall');
  x.s.explorers[0].recalledAt=x.v.serverTime;assert.equal(run(x).choice,null);
  x.s.explorers[0].recalledAt=null;x.cfg.explore=false;assert.equal(run(x).choice,null);
});
test('防守收尾：新增援和受袭重伤治疗排在召回前，召回仍保留',()=>{
  const x=scene();x.s.residents[0].roomId=1;
  let p=run(x);assert.equal(p.choice.kind,'rescue');assert.equal(p.defense.urgent,true);
  assert.equal(p.actions.at(-1).kind,'explore-recall');
  x.cfg.medical=true;x.s.residents[1].hp=20;p=run(x);
  assert.equal(p.choice.kind,'stimpak');assert.equal(p.choice.id,2);assert.equal(p.actions[1].kind,'rescue');
  assert.equal(p.actions.at(-1).kind,'explore-recall');
});
test('防守收尾：小队已归来可领取，未到家、仓容不足与关闭任务不领取',()=>{
  const x=scene();x.cfg.explore=false;x.cfg.quests=true;x.traveler.away={kind:'quest'};x.s.explorers=[];
  x.s.quests=[{id:91,team:[x.traveler.id],status:'returning',returnAt:x.v.serverTime-1,
    snapshot:{title:'旧地铁站',rewards:{scrap:30,parts:1,itemTier:null}}}];
  assert.equal(run(x).choice.kind,'quest-claim');
  x.s.quests[0].returnAt=x.v.serverTime+1;assert.equal(run(x).choice,null);
  x.s.quests[0].returnAt=x.v.serverTime-1;x.s.resources.scrap=api.model(x.v).caps.scrap;assert.equal(run(x).choice,null);
  x.s.resources.scrap=100;x.cfg.quests=false;assert.equal(run(x).choice,null);
});
test('防守收尾：没有收尾任务时继续守卫，不开启养成或新出发',()=>{
  const x=scene();x.record.trips[0].hours=6;
  Object.assign(x.cfg,{quests:true,training:true,radio:true,combatGear:true,development:true});
  const p=run(x);assert.equal(p.defense.busy,true);assert.equal(p.choice,null);assert.equal(p.actions.length,0);
  assert.equal(p.defense.reserved.length,5);assert.ok(p.events.includes(5000));
});
