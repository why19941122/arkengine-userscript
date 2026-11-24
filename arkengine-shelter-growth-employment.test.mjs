import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parent72Scene,finishParentStats} from './arkengine-shelter-parent72.fixture.mjs';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function setup(){
  const seed=parent72Scene(),s=seed.view.state;
  finishParentStats(seed.view);
  s.rooms.push({...s.rooms[0],id:30,type:'radio',floor:4,col:2,width:1,level:1});
  s.residents.push({...structuredClone(s.residents[3]),id:9,name:'待就业成人',roomId:null,parents:[]});
  seed.campaign.radio=true;
  const x=setupPowerInvestment(source,seed,'population');x.context.shelterPopulationTarget=14;
  Object.assign(x.api,vm.runInContext('({population:shelterPopulationPlan,housing:populationHousingSupply,preparation:shelterPopulationPreparation,idle:shelterIdleEmploymentChoice})',x.context));
  x.m=()=>x.api.model(x.f.view);x.s=x.f.view.state;
  x.choose=()=>x.api.population(x.m(),x.context.shelterState.families,{eligible:p=>p.id>=5&&p.id<=8,home:()=>true,healthy:()=>true},true);
  return x;
}

test('人口岗位准入：闲置成人不触发电台，也不否决供给充足的达标配对',()=>{
  for(const roomId of [null,5]){
    const x=setup();x.s.residents.find(p=>p.id===9).roomId=roomId;
    const before=JSON.stringify(x.s),p=x.api.schedule(x.m());
    assert.equal(p.actions.filter(a=>a.role==='radio').length,0,'unemployed adult must block recruitment');
    if(roomId===null){assert.ok(x.choose());assert.deepEqual([x.context.shelterState.pair.a,x.context.shelterState.pair.b],[7,8]);}
    else{assert.equal(x.choose(),null);assert.match(x.context.shelterPopulationNote,/空宿舍/);}
    assert.equal(JSON.stringify(x.s),before);
  }
});

test('人口岗位准入：就业实际落实后电台仍关闭，达标父母可以配对',()=>{
  const x=setup();
  const a=x.api.idle(x.m(),{reserved:[],dailyReserved:[]});
  assert.equal(a.id,9);assert.equal(a.room,4);x.s.residents.find(p=>p.id===a.id).roomId=a.room;
  assert.ok(!x.api.schedule(x.m()).actions.some(a=>a.role==='radio'));
  assert.ok(x.choose());assert.ok(x.context.shelterState.pair);
});

test('人口岗位准入：已开始配对和已开始感情不因其他成人待就业而拆散',()=>{
  const x=setup();x.s.residents.find(p=>p.id===9).roomId=4;const first=x.choose();assert.ok(first);
  x.s.residents.find(p=>p.id===first.id).roomId=first.room;
  x.s.residents.find(p=>p.id===9).roomId=null;
  const next=x.choose();assert.ok(next);assert.equal(next.room,first.room);assert.notEqual(next.id,first.id);
  const pair=[x.context.shelterState.pair.a,x.context.shelterState.pair.b];
  pair.forEach((id,i)=>x.s.residents.find(p=>p.id===id).romance={partnerId:pair[1-i],progress:.2});
  assert.equal(x.api.housing(x.m(),[],pair.map(id=>x.s.residents.find(p=>p.id===id))).allowed,true);
});

test('人口岗位准入：在训、在途、儿童及现有防守岗位不被当成失业',()=>{
  for(const duty of ['training','away','child','door','armory','tailor']){
    const x=setup(),p=x.s.residents.find(p=>p.id===9);
    if(duty==='away')p.away={kind:'explore'};
    else if(duty==='child')p.adultAt=x.f.view.serverTime+3600000;
    else {x.s.rooms.push({...x.s.rooms[0],id:31,type:duty,trainStat:'str',
      ...(['armory','tailor'].includes(duty)?{craft:{doneAt:x.f.view.serverTime+3600000}}:{})});p.roomId=31;p.training=.4;}
    const before=structuredClone(p);assert.ok(x.choose(),duty);assert.deepEqual(p,before);
  }
});

test('人口岗位准入：历史家庭名单不能替代就业，也不能阻止闲置父母先上岗',()=>{
  const x=setup();x.context.shelterState.families=[{a:8,b:9,room:5}];
  assert.equal(x.choose(),null);
  const a=x.api.idle(x.m(),{reserved:[],dailyReserved:[]});assert.equal(a?.id,9);assert.equal(a.room,4);
});

test('人口岗位准入：主家庭可先交接，冷却父母不因就业需要被赶到休息区',()=>{
  const x=setup();x.context.shelterState.families=[{a:7,b:8,room:5}];x.context.shelterCampaign.radio=false;
  const first=x.api.staff(x.m());assert.ok([7,8].includes(first.id));assert.equal(first.room,5);
  assert.equal(x.s.residents.find(person=>person.id===9).roomId,null);
  const y=setup();y.context.shelterState.families=[{a:5,b:6,room:5}];y.context.shelterCampaign.radio=false;
  for(const id of [5,6])Object.assign(y.s.residents.find(p=>p.id===id),{roomId:5,familyCooldownUntil:y.f.view.serverTime+3600000});
  const action=y.api.staff(y.m());assert.ok(action);assert.notEqual(action.room,null,'employment admission is not an eviction reason');
});

test('人口岗位准入：已开工且六小时内完工的真实空岗允许配对准备，不能提前开放电台',()=>{
  const x=setup();x.s.rooms.push({...x.s.rooms[3],id:31,width:1,level:1,floor:4,col:3,builtAt:x.f.view.serverTime+2*3600000});
  assert.ok(x.choose(),x.context.shelterPopulationNote);
  assert.equal(x.api.schedule(x.m()).actions.filter(a=>a.role==='radio').length,0,'radio can recruit immediately');
});

test('人口岗位准入：未落实岗位不再否决已有床位和供给允许的新配对',()=>{
  for(const reason of ['not-started','too-late','unsettled','unpowered','full']){
    const x=setup(),now=x.f.view.serverTime;
    const room={...x.s.rooms[3],id:31,width:1,floor:4,col:3,builtAt:now+2*3600000};
    if(reason!=='not-started')x.s.rooms.push(room);
    if(reason==='too-late')room.builtAt=now+7*3600000;
    if(reason==='unsettled'){room.builtAt=0;room.upgradeAt=now-1;}
    if(reason==='unpowered')room.unpowered=true;
    if(reason==='full')for(const id of [10,11])x.s.residents.push({...structuredClone(x.s.residents[3]),id,name:'工程占岗'+id,roomId:31});
    const before=JSON.stringify(x.s);assert.ok(x.choose(),reason);assert.equal(JSON.stringify(x.s),before,reason);
  }
});

test('人口岗位准入：就业建设独立于配对候选，不因闲人存在卡死',()=>{
  const x=setup();x.s.residents.push({...structuredClone(x.s.residents[3]),id:10,name:'最后原岗位',roomId:4});
  Object.assign(x.s.rooms.find(r=>r.type==='storage'),{floor:2,col:4});
  Object.assign(x.context.shelterConstruction,{build:true,upgrade:true,dig:true});
  x.context.shelterLevelTarget=null;
  const {development}=x.plan(),project=development.next.project;
  assert.ok(project?.employment,JSON.stringify(development.next));
  assert.ok(['build','dig'].includes(project.kind));
  assert.ok(x.api.construction(x.m()),'the employment proposal must reach the actual construction choice');
});

test('人口岗位准入：历史在训目的地不再预留远期岗位或否决新配对',()=>{
  const x=setup(),now=x.f.view.serverTime;
  x.s.rooms.push({...x.s.rooms[3],id:31,width:1,level:1,floor:4,col:3,builtAt:now+3600000});
  x.s.rooms.push({...x.s.rooms[0],id:32,type:'training',trainStat:'str',floor:4,col:4});
  for(const id of [10,11])x.s.residents.push({...structuredClone(x.s.residents[3]),id,name:'保留返岗'+id,roomId:32});
  x.context.shelterState.campaign.roles=[10,11].map(id=>({id,room:32,role:'training',purpose:'production',destination:31}));
  assert.ok(x.choose(),'training does not reserve future seats');
  x.context.shelterState.campaign.roles=x.context.shelterState.campaign.roles.slice(0,1);
  assert.ok(x.choose(),'one real unreserved future seat allows preparation');
});
