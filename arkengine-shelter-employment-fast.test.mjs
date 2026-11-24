import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const segment=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
function setup(){
  const view=campaignView(),s=view.state;s.rooms.find(r=>r.id===4).width=2;
  for(const p of s.residents){p.xp=0;p.hp=100;p.training=0;}
  const context={objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'},
    shelterState:{families:[{a:1,b:2,room:5}],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},
    shelterCampaign:{explore:false,quests:false,training:true,medical:false,dailyGoals:false,defense:false},
    shelterStaffMode:'population',shelterStaffHold:false,shelterPopulationTarget:14,shelterPending:null,shelterRead:null,shelterOptimize:true,
    shelterCampaignSchedule:()=>{throw Error('Fast employment must not invoke full planning');}};
  const api=vm.runInNewContext(['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n')+
    segment('  function shelterWorkerRate(','  function readShelter(')+segment('  const staffRoomTypes =','  function shelterExploreStep(')+
    segment('  function shelterCampaignDeferrals(','  function shelterDailyCraftStaffing(')+
    segment('  function shelterMaintenanceSchedule(','  function shelterCampaignChoice(')+
    '\n({model:shelterModel,schedule:shelterEmploymentSchedule,idle:shelterIdleEmploymentChoice})',context);
  const choose=()=>{const m=api.model(view);return api.idle(m,api.schedule(m));};
  return {view,s,context,api,choose};
}
test('fast employment: resting adult and grown child leave an occupied family dorm without full planning',()=>{
  const x=setup();x.s.residents[4].roomId=5;x.s.residents[4].parents=[1,2];
  const initial=structuredClone(x.s.residents.slice(0,4)),moves=[];
  for(let i=0;i<2;i++){const a=x.choose();assert.ok(a);assert.equal(a.room,4);moves.push(a.id);x.s.residents.find(p=>p.id===a.id).roomId=a.room;}
  assert.deepEqual(moves.sort(),[5,6]);assert.deepEqual(x.s.residents.slice(0,4),initial);assert.equal(x.choose(),null);
});
test('fast employment: actual role and defense reservations never become free idle candidates',()=>{
  for(const kind of ['roles','defense']){const x=setup();x.context.shelterState.campaign[kind]=[5,6].map(id=>({id,room:99,role:'training'}));assert.equal(x.choose(),null,kind);}
});
test('fast employment: an open solo trip reserves its chosen resident but not the other idle adult',()=>{
  const x=setup(),selected=x.choose()?.id;assert.ok(selected);
  Object.assign(x.context.shelterCampaign,{explore:true,reserve:2,stimpaks:2});x.s.explorers=[];
  x.context.shelterCampaignSchedule=()=>({departureResidents:[selected]});
  const other=x.choose();assert.ok(other);assert.notEqual(other.id,selected);
});
test('fast employment: actual training does not reserve a future job, including expired historical records',()=>{
  const x=setup(),s=x.s;s.rooms.find(r=>r.id===4).width=1;
  s.rooms.push({...s.rooms[0],id:30,type:'training',trainStat:'end'});
  s.residents.push({...structuredClone(s.residents[5]),id:7,name:'在训人员',roomId:30});
  x.context.shelterState.campaign.roles=[{id:7,room:30,role:'training',purpose:'production',destination:4,until:x.view.serverTime-1}];
  assert.ok([5,6].includes(x.choose()?.id),'the empty production seat is usable during training');
  s.residents.find(p=>p.id===7).roomId=null;
  assert.ok([5,6].includes(x.choose()?.id),'finished/displaced trainee does not keep a phantom seat');
});
test('fast employment: active family, unknown birth, health, identity, pending and manual holds remain protected',()=>{
  for(const kind of ['family','romance','birth','hurt','identity','pending','pair','swap','held']){
    const x=setup();for(const p of x.s.residents.slice(4)){
      if(kind==='romance')p.romance={partnerId:p.id===5?6:5,progress:0};
      if(kind==='hurt')p.hp=1;if(kind==='identity')p.name='';if(kind==='birth')p.roomId=5;
    }
    if(kind==='family'){x.context.shelterState.families.push({a:5,b:6,room:5});x.s.residents[4].roomId=5;}
    if(kind==='birth')x.s.births.push({roomId:5,dueAt:x.view.serverTime+3600000});
    if(kind==='pending')x.context.shelterPending={id:'unknown'};
    if(kind==='pair')x.context.shelterState.pair={a:5,b:6};
    if(kind==='swap')x.context.shelterState.swap={people:[{id:5},{id:6}]};
    if(kind==='held')x.context.shelterStaffHold=true;
    assert.equal(x.choose(),null,kind);
  }
});
test('fast employment: available treatment precedes employment while unavailable treatment does not stall healthy workers',()=>{
  const x=setup();Object.assign(x.context.shelterCampaign,{medical:true,reserve:2});x.s.resources.stimpak=3;x.s.residents[2].hp=70;
  assert.equal(x.choose(),null);x.s.resources.stimpak=2;assert.ok(x.choose());
});

test('fast employment: incomplete roster and birth evidence cannot bypass ordinary staffing checks',()=>{
  const cases={
    'candidate ancestry missing':x=>{delete x.s.residents[4].parents;},
    'other resident ancestry missing':x=>{delete x.s.residents[0].parents;},
    'invalid ancestry id':x=>{x.s.residents[4].parents=['unknown'];},
    'duplicate resident id':x=>{x.s.residents[4].id=x.s.residents[0].id;},
    'unknown health':x=>{delete x.s.residents[0].hp;},
    'invalid cooldown':x=>{x.s.residents[0].familyCooldownUntil='unknown';},
    'invalid partner':x=>{x.s.residents[0].romance={partnerId:'unknown'};},
    'invalid population target':x=>{x.context.shelterPopulationTarget=null;},
    'unknown birth room':x=>{x.s.births.push({roomId:999,dueAt:x.view.serverTime+3600000});}
  };
  for(const [label,change] of Object.entries(cases)){
    const x=setup();assert.ok(x.choose(),label+' has an eligible job before evidence changes');
    change(x);assert.equal(x.choose(),null,label);
  }
});

test('fast employment: malformed family records block selection without overwriting the evidence',()=>{
  for(const families of [[{a:1,b:1,room:5}],[{a:1,b:2,room:5},{a:2,b:3,room:5}]]){
    const x=setup();x.context.shelterState.families=structuredClone(families);
    assert.equal(x.choose(),null);assert.deepEqual(x.context.shelterState.families,families);
  }
  // A non-array record is already rejected by the upstream campaign reader.
  // The fast selector itself must also refuse it, never normalize it to [].
  const x=setup(),invalid={a:1,b:2,room:5};x.context.shelterState.families=invalid;
  assert.throws(()=>x.choose(),/not iterable/);
  assert.equal(x.api.idle(x.api.model(x.view),{reserved:[],choice:null}),null);
  assert.equal(x.context.shelterState.families,invalid);
});

test('fast employment: a former proposal is rejected on incomplete evidence and resumes after an actual repair',()=>{
  const x=setup(),before=x.choose();assert.ok(before);
  const p=x.s.residents.find(p=>p.id===before.id),parents=p.parents;delete p.parents;
  assert.equal(x.choose(),null);assert.equal(p.roomId,null);
  p.parents=parents;const repaired=x.choose();assert.equal(repaired.id,before.id);assert.equal(repaired.room,before.room);
});

test('fast employment: invalid population settings do not disable the separate production-only mode',()=>{
  const x=setup();x.context.shelterPopulationTarget=null;
  assert.equal(x.choose(),null);x.context.shelterStaffMode='production';assert.ok(x.choose());
});

test('fast employment: historical training keeps its current cell without reserving the last production seat',()=>{
  const x=setup();x.context.shelterStaffMode='production';x.context.shelterState.families=[];
  Object.assign(x.context.shelterCampaign,{training:true,trainTarget:6});
  x.s.rooms.find(r=>r.id===4).width=1;
  x.s.rooms.push({...x.s.rooms[0],id:90,type:'training',trainStat:'end',level:1,floor:3,col:2});
  for(const p of x.s.residents)p.stats.end=10;
  const trainee=x.s.residents[4];Object.assign(trainee,{roomId:90,training:.9});trainee.stats.end=5;
  const before=JSON.stringify(x.view),saved=JSON.stringify(x.context.shelterState),m=x.api.model(x.view),plan=x.api.schedule(m);
  assert.equal(plan.trainingDestinations.length,0,'ongoing cell does not own a future seat');
  assert.ok(plan.adoptions.some(r=>r.id===5&&r.purpose==='production'&&r.destination===4));
  const choice=x.api.idle(m,plan);assert.equal(choice?.room,4,'idle adult can use the empty seat immediately');
  assert.equal(JSON.stringify(x.view),before);assert.equal(JSON.stringify(x.context.shelterState),saved);
  x.s.rooms.find(r=>r.id===4).width=2;
  assert.equal(x.choose()?.room,4,'a distinct spare seat is still available without running full planning');
});

test('fast employment: historical training assessment cannot delay a due recall or available healing',()=>{
  for(const urgent of ['recall','healing']){
    const x=setup();x.context.shelterStaffMode='production';x.context.shelterState.families=[];
    x.s.rooms.push({...x.s.rooms[0],id:90,type:'training',trainStat:'end',level:1,floor:3,col:2});
    Object.assign(x.s.residents[4],{roomId:90,training:.9});
    Object.assign(x.context.shelterCampaign,{training:true,trainTarget:10});
    if(urgent==='healing'){
      Object.assign(x.context.shelterCampaign,{medical:true,reserve:2});x.s.residents[2].hp=20;
    }else{
      x.context.shelterCampaign.explore=true;x.s.residents[5].away={kind:'explore'};
      x.s.explorers.push({id:91,residentId:6,startedAt:x.view.serverTime-6*3600000,recalledAt:null,returnAt:null,
        tier:0,abyss:false,stimpaks:0,loot:{scrap:0,parts:0,stimpak:0,items:[]}});
      x.context.shelterState.campaign.trips=[{id:91,resident:6,hours:6,at:x.view.serverTime-6*3600000}];
    }
    x.context.shelterTrainingReturn=()=>{throw Error('Urgent work must not run training assessment');};
    const plan=x.api.schedule(x.api.model(x.view));
    assert.equal(plan.choice?.kind,urgent==='recall'?'explore-recall':'stimpak');
    assert.equal(x.api.idle(x.api.model(x.view),plan),null);
  }
});

test('fast employment: staffing disabled or held does not adopt historical training',()=>{
  for(const mode of ['off','held']){
    const x=setup();x.context.shelterStaffMode=mode==='off'?'off':'production';x.context.shelterStaffHold=mode==='held';
    x.s.rooms.push({...x.s.rooms[0],id:90,type:'training',trainStat:'end',level:1,floor:3,col:2});
    Object.assign(x.s.residents[4],{roomId:90,training:.9});
    const plan=x.api.schedule(x.api.model(x.view));
    assert.equal(plan.adoptions.length,0);assert.equal(x.choose(),null);
  }
});
