import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {fullPowerPrerequisiteView} from './arkengine-shelter-campaign.fixture.mjs';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function setup(){
  // Synthetic continuation of the existing power fixture: reproduce the log's
  // full main plant + one worker/one trainee seat in a level-one secondary plant.
  const v=fullPowerPrerequisiteView(Date.parse('2026-11-15T06:25:00Z')),s=v.state,base=s.rooms[0],person=s.residents[0];
  s.depth=9;
  s.rooms.push({...base,id:3001,type:'power',floor:9,col:2,width:1,level:1},
    {...base,id:3002,type:'quarters',floor:9,col:3,width:2,level:1},
    {...base,id:2009,type:'elevator',floor:9,col:1,width:1,level:1});
  s.rooms.find(r=>r.id===8).trainStat='str';
  for(const [id,roomId] of [[9001,3001],[9002,8],[9003,3002],[9004,3002]])s.residents.push({
    ...structuredClone(person),id,name:'回归居民'+id,roomId,training:id===9002?.5:0,stats:{...person.stats,str:id>=9003?6:3}});
  for(const p of s.residents.filter(p=>p.roomId===1))p.happiness=100;
  s.resources.scrap=6000;s.resources.parts=50;
  const f={view:v,state:{campaign:{roles:[{id:9002,room:8,role:'training',purpose:'production',stat:'str',base:3,
    at:v.serverTime-1800000,until:v.serverTime+7200000,windowEnd:v.serverTime+168*3600000,destination:3001}],
    trips:[],attempts:[],heals:[],trainingRest:[]}},
    campaign:{training:true,explore:false,quests:false,medical:false,radio:false,combatGear:false,dailyGoals:false,
      help:false,craftDaily:false,defense:false},
    construction:{build:true,upgrade:true,dig:true,budgetMode:'stock',scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}};
  const x=setupPowerInvestment(source,f,'production');x.context.shelterPopulationTarget=40;
  const m=x.api.model(x.f.view),primary=m.rooms.find(r=>r.id===1).rate,secondary=m.rooms.find(r=>r.id===3001).rate;
  // Current reserve is met, but one additional production room misses it by .6/h.
  const happiness=(((m.demand.power*1.2+.6-secondary)/primary)-.6)/.004;
  assert.ok(happiness>=0&&happiness<=100);
  for(const p of x.f.view.state.residents.filter(p=>p.roomId===1))p.happiness=happiness;
  return x;
}

test('训练返岗占位补电：先执行补电工程并补员，再回到就业建设，训练座位保持',()=>{
  const x=setup(),s=x.f.view.state,{m,campaign,development}=x.plan(),before=JSON.stringify(x.f);
  assert.ok(m.production.power>=m.demand.power*1.2&&m.production.power<(m.demand.power+1)*1.2);
  assert.ok(campaign.trainingDestinations.some(d=>d.id===9002&&d.room===3001));
  assert.equal(campaign.powerPreparation?.extra,1,'预留座位不能让补电建设误判为仍可直接补员');
  assert.equal(development.next.project?.type,'power');
  const project=x.api.construction(m);
  assert.equal(project?.kind,'build');assert.equal(project.type,'power');
  assert.equal(x.api.staff(m),null,'补电工程开工前不能夺走训练返岗位');
  assert.equal(JSON.stringify(x.f),before,'规划不得提前调岗或花费');
  const power={...s.rooms.find(r=>r.id===3001),id:3003,floor:project.floor,col:project.col,
    builtAt:x.f.view.serverTime+600000,stored:0};
  s.resources.scrap-=project.cost.scrap;s.rooms.push(power);
  assert.equal(x.plan().campaign.powerPreparation,null,'已开工补电不再启动第二项');
  x.f.view.serverTime+=600000;s.lastSettledAt=x.f.view.serverTime;
  const support=x.api.staff(x.api.model(x.f.view));assert.equal(support?.room,3003);
  assert.ok([9003,9004].includes(support.id));s.residents.find(p=>p.id===support.id).roomId=support.room;
  const build=x.api.construction(x.api.model(x.f.view));
  assert.equal(build?.kind,'build');assert.equal(build.type,'scrap','补电完工须返回就业目标');
  s.resources.scrap-=build.cost.scrap;
  s.rooms.push({...power,id:3004,type:'scrap',floor:build.floor,col:build.col,level:1,width:1,
    stored:0,builtAt:x.f.view.serverTime+600000});
  x.f.view.serverTime+=600000;s.lastSettledAt=x.f.view.serverTime;
  const move=x.api.staff(x.api.model(x.f.view));assert.equal(move?.room,3004);
  assert.ok([9003,9004].includes(move.id));assert.notEqual(move.id,support.id);
  s.residents.find(p=>p.id===move.id).roomId=move.room;
  assert.equal(s.residents.find(p=>p.id===9002).roomId,8,'已开始的训练保持');
  assert.equal(s.residents.filter(p=>p.roomId===3001).length,1,'训练返回前仍保留其座位');
});

test('训练返岗占位补电：真正空岗优先调岗，工程开关、未决原单、人工暂停和保留量保持',()=>{
  const free=setup();free.context.shelterState.campaign.roles[0].destination=4;
  assert.equal(free.plan().campaign.powerPreparation,null);
  assert.equal(free.api.staff(free.plan().m)?.room,3001,'没有返回预留时先用原有空岗');
  for(const change of ['construction-off','pending','held','reserve']){
    const x=setup();
    if(change==='construction-off'){x.context.shelterConstruction.upgrade=false;x.context.shelterConstruction.build=false;}
    if(change==='pending')x.context.shelterPending={id:'unknown'};
    if(change==='held'){
      x.context.shelterStaffHold='manual';
      assert.equal(x.plan().campaign.powerPreparation,null,'人工暂停调岗时不新增人手准备');continue;
    }
    if(change==='reserve')x.context.shelterConstruction.scrapReserve=x.f.view.state.resources.scrap;
    assert.equal(x.api.construction(x.plan().m),null,change);
  }
});
