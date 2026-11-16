import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
import {idleTrainingScene} from './arkengine-shelter-idle-training.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const code=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const staff=source.slice(source.indexOf('  const staffRoomTypes ='),source.indexOf('  function shelterExploreStep('));
const api=vm.runInNewContext(`${declarations}\n${code}\n${staff}\n({model:shelterModel,estimate:shelterTrainingReturn,plan:shelterCampaignPlan,
  capacity:shelterStaffCapacity,allocation:shelterFindAllocation,projection:shelterSwapProjection,
  defaults:campaignDefaults,valid:validCampaignRecord,pending:validCampaignPending})`,{
  objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
  shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
const hour=3600000;
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
function scene(stat='end',base=5){
  const v=campaignView(),s=v.state;
  const room={...s.rooms[0],id:90,type:'training',trainStat:stat,level:1,floor:3,col:2};s.rooms.push(room);
  for(const p of s.residents.slice(4))Object.assign(p,{xp:0,hp:100,stats:{str:5,per:5,end:5,cha:5,int:5,agi:5,lck:5}});
  const p=s.residents[4];p.stats[stat]=base;
  const cfg={...api.defaults,training:true,trainTarget:10,development:true};
  const record={roles:[],trips:[],attempts:[],heals:[],trainingRest:[]};
  return {v,s,p,room,cfg,record,estimate:(h=168,options={})=>api.estimate(api.model(v),p,room,h,options),
    run:()=>api.plan(api.model(v),cfg,record,14)};
}

test('人口训练协调修复：普通生产训练不能吃掉下一人口口粮，补足后恢复入训',()=>{
  const x=scene('agi'),diner=x.s.rooms.find(r=>r.id===2),worker=x.s.residents.find(p=>p.id===2);
  diner.level=1;worker.stats.agi=4;x.p.roomId=2;
  Object.assign(x.s.rooms.find(r=>r.type==='storage'),{width:3,level:3});
  const before=x.run().actions.find(a=>a.purpose==='production');assert.ok(before,'普通生产模式有真实可回本方案');
  x.cfg.populationGrowth=true;
  assert.ok(!x.run().actions.some(a=>a.purpose==='production'));
  worker.stats.agi=6;
  assert.ok(x.run().actions.some(a=>a.id===x.p.id&&a.purpose==='production'),'下一人口口粮补足后恢复');
});

test('人口训练协调修复：已开始的生产训练不因下一人口余量而中断',()=>{
  const x=scene('agi'),worker=x.s.residents.find(p=>p.id===2);worker.stats.agi=4;
  x.s.rooms.find(r=>r.id===2).level=1;x.p.roomId=2;
  Object.assign(x.s.rooms.find(r=>r.type==='storage'),{width:3,level:3});
  const a=x.run().actions.find(a=>a.purpose==='production');assert.ok(a);
  x.p=x.s.residents.find(p=>p.id===a.id);x.p.roomId=a.room;x.p.training=.2;x.cfg.populationGrowth=true;
  x.record.roles.push({id:a.id,room:a.room,role:'training',stat:a.stat,base:a.base,at:x.v.serverTime,
    purpose:a.purpose,until:a.until,windowEnd:a.windowEnd,destination:a.destination});
  assert.ok(!x.run().actions.some(a=>a.id===x.p.id&&a.role==='training-release'));
});

test('生产训练机会成本：长期能回本仍不能推迟当前实际工程攒料，资金就绪后重新准入',()=>{
  const x=scene();x.p.roomId=4;x.s.residents.find(p=>p.id===4).stats.end=10;
  x.s.residents.find(p=>p.id===6).away={kind:'explore'};
  const original=x.run().actions.find(a=>a.id===x.p.id&&a.purpose==='production');assert.ok(original);
  x.cfg.developmentProject={kind:'upgrade',type:'storage',id:6,level:3,priority:20,title:'实际工程',cost:{scrap:3500,parts:0}};
  x.record.constructionPolicy={upgrade:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0,spent:{scrap:0,parts:0}};
  assert.ok(!x.run().actions.some(a=>a.id===x.p.id&&a.purpose==='production'));
  x.s.resources.scrap=3600;
  assert.ok(x.run().actions.some(a=>a.id===x.p.id&&a.purpose==='production'));
});

test('生产训练：逐格比较直接工作与训练后工作，短窗口拒绝，不修改快照',()=>{
  for(const [base,hours,payback] of [[5,37/6,407/6],[9,61/6,915/6]]){
    const x=scene('end',base),before=JSON.stringify(x.v),a=x.estimate();
    assert.equal(a.eligible,true);close(a.hours,hours);close(a.best.paybackHours,payback);
    close(a.best.delta,a.best.afterRate*(168-hours)-a.best.beforeRate*168);
    assert.equal(x.estimate(48).eligible,false);assert.equal(JSON.stringify(x.v),before);
  }
});
test('生产训练：已有进度只计剩余时间；未知进度不当成零，已满属性可退出',()=>{
  const x=scene();x.p.roomId=x.room.id;x.p.training=.9;
  const a=x.estimate();assert.equal(a.eligible,true);close(a.hours,4/6);
  close(a.best.paybackHours,44/6);
  delete x.p.training;assert.equal(x.estimate().reason,'unknown-training');
  x.p.stats.end=10;assert.equal(x.estimate().reason,'attribute-maxed');
});
test('生产训练：限时加成分段计算，不把前一小时活动外推七天',()=>{
  const x=scene(),plain=x.estimate();
  x.v.env.events=[{kind:'production',startsAt:x.v.serverTime,endsAt:x.v.serverTime+hour,percent:150}];
  const boosted=x.estimate();
  close(boosted.best.directProduction,plain.best.directProduction+plain.best.beforeRate*.5);
  close(boosted.best.trainedProduction,plain.best.trainedProduction);
  close(boosted.best.delta,plain.best.delta-plain.best.beforeRate*.5);
});
test('生产训练：无生产空位、离岗断供和跨资源用途不会虚构回报',()=>{
  const full=scene();full.s.residents[5].roomId=4;
  assert.equal(full.estimate().reason,'no-productive-destination');
  const supply=scene('str');supply.p=supply.s.residents[0];
  assert.equal(api.estimate(api.model(supply.v),supply.p,supply.room).reason,'supply-uncovered');
  const cross=scene('end');cross.p.roomId=2;
  assert.equal(cross.estimate().reason,'cross-resource-opportunity');
});
test('生产训练：同一轮两个训练者不能承诺同一个返岗空位',()=>{
  const x=scene();x.s.residents[3].stats.end=10;
  const before=JSON.stringify(x.v),plan=x.run();
  const trained=plan.actions.filter(a=>a.purpose==='production');
  assert.equal(trained.length,1);
  assert.equal(trained[0].destination,4);assert.equal(JSON.stringify(x.v),before);
});
test('生产训练：刷新保留返岗席位，不能重新承诺给第二人',()=>{
  const x=scene();x.s.residents[3].stats.end=10;
  const a=x.run().actions.find(a=>a.purpose==='production');assert.ok(a);
  x.p=x.s.residents.find(p=>p.id===a.id);x.p.roomId=a.room;x.p.training=0;
  x.record.roles=[{id:a.id,room:a.room,role:'training',at:x.v.serverTime,stat:a.stat,base:a.base,
    purpose:a.purpose,until:a.until,windowEnd:a.windowEnd,destination:a.destination}];
  x.record=JSON.parse(JSON.stringify(x.record));
  const plan=api.plan(api.model(x.v),x.cfg,x.record,14);
  assert.equal(plan.actions.filter(a=>a.purpose==='production').length,0);
  assert.ok(plan.reserved.includes(a.id));assert.equal(api.valid(x.record),true);
});

test('训练持续与准入：20%余量下降但实际收支平衡时完成当前格，缺口或库存不足仍释放',()=>{
 for(const purpose of ['production','parent'])for(const condition of ['margin','drain','stock']){
  const x=scene(),a=x.run().actions.find(a=>a.purpose==='production');assert.ok(a);
  const p=x.s.residents.find(p=>p.id===a.id);p.roomId=a.room;p.training=.25;
  p.familyCooldownUntil=x.v.serverTime+8*hour;
  x.record.families=[{a:p.id,b:6,room:5}];
  x.record.roles=[{...a,role:'training',at:x.v.serverTime,until:a.until,windowEnd:a.windowEnd,purpose}];
  x.cfg.parentTraining=true;
  const m=api.model(x.v),power=x.s.residents.find(p=>p.roomId===1);
  // Exactly scale the actual worker, rather than only replacing the model's aggregate.
  power.happiness=0;power.stats.str=0;
  const low=api.model(x.v),rate=low.production.power;
  const demand=condition==='drain'?rate+.1:rate/1.1;
  // Physical upkeep can be fractional in the production model; pin this one input
  // in a shared model, used by admission and continuation below.
  low.demand.power=demand;if(condition==='stock')low.state.resources.power=0;
  const plan=api.plan(low,x.cfg,x.record,14);
  const released=plan.actions.some(c=>c.id===p.id&&c.role==='training-release');
  assert.equal(released,condition!=='margin',purpose+' '+condition);
  if(condition==='margin'){
   assert.ok(plan.reserved.includes(p.id));
   assert.ok(!plan.actions.some(c=>c.role==='training'&&c.id!==p.id),'no new training consumes the diminished margin');
  }
 }
});
test('生产训练：训练完成、模式关闭、期限到达和原目标岗位失效时释放',()=>{
  for(const reason of ['completed','training-off','development-off','expired','destination-lost','stat-changed']){
    const x=scene(),a=x.run().actions.find(a=>a.purpose==='production');assert.ok(a);
    const p=x.s.residents.find(p=>p.id===a.id);p.roomId=a.room;p.training=0;
    x.record.roles=[{id:a.id,room:a.room,role:'training',at:x.v.serverTime,stat:a.stat,base:a.base,
      purpose:a.purpose,until:a.until,windowEnd:a.windowEnd,destination:a.destination}];
    if(reason==='completed')p.stats[a.stat]++;
    if(reason==='training-off')x.cfg.training=false;
    if(reason==='development-off')x.cfg.development=false;
    if(reason==='expired')x.v.serverTime=a.until;
    if(reason==='stat-changed')x.room.trainStat='agi';
    if(reason==='destination-lost'){
      x.s.rooms.find(r=>r.id===a.destination).upgradeAt=x.v.serverTime+hour;
      x.s.rooms.push({...x.s.rooms.find(r=>r.id===4),id:91,upgradeAt:null,floor:4,col:2});
    }
    const plan=api.plan(api.model(x.v),x.cfg,x.record,14);
    assert.ok(plan.actions.some(c=>c.id===p.id&&c.role==='training-release'),reason);
  }
});
test('生产训练：零件收益绑定实际需求，工程保留废料不能用于供料',()=>{
  const x=scene('int');x.s.rooms.push({...x.s.rooms[0],id:91,type:'workshop',level:1,floor:4,col:2});
  assert.equal(x.estimate().eligible,false,'缺少实际零件用途不能记七天产量');
  const enough={partsTarget:120,scrapReserve:100};
  assert.equal(x.estimate(168,enough).eligible,true);
  assert.equal(x.estimate(168,{partsTarget:11,scrapReserve:100}).eligible,false,'只差一件，无需停工训练');
  assert.equal(x.estimate(168,{partsTarget:120,scrapReserve:x.s.resources.scrap}).eligible,false,'已承诺工程不可用未来总产量重复融资');
  assert.equal(x.estimate(168,{partsTarget:1000,scrapReserve:100}).reason,'parts-target-capacity');
  x.s.residents[5].roomId=91;
  assert.equal(x.estimate(168,{partsTarget:180,scrapReserve:100}).eligible,false,'现有值班足以使两种方案都完成需求，不重复承诺全部缺口');
});
test('生产训练：生产分配和逐步调岗也保护已承诺的返岗空位',()=>{
  const x=scene();x.p.roomId=x.room.id;x.p.training=0;
  const m={...api.model(x.v),trainingDestinations:[{id:x.p.id,room:4}]},spare=x.s.residents[5];
  const before=JSON.stringify(x.v),allocation=api.allocation(m,[spare]);
  assert.ok(!allocation.plan?.targets.some(t=>t.id===spare.id&&t.room===4));
  assert.equal(api.projection(m,[{id:spare.id,room:4}],false,true),null);
  assert.ok(api.projection(m,[{id:x.p.id,room:4}],false,true));
  assert.equal(JSON.stringify(x.v),before);
});
test('生产训练：原岗位本人尚未离开时席位不重复扣，离开后才形成空位预留',()=>{
  const x=scene(),worker=x.s.residents[3],room=x.s.rooms.find(r=>r.id===4);
  const m={...api.model(x.v),trainingDestinations:[{id:worker.id,room:4}]};
  assert.equal(api.capacity(m,room),2);worker.roomId=x.room.id;
  assert.equal(api.capacity(m,room),1);assert.equal(api.capacity(m,room,worker.id),2);
});

test('生产训练：返岗回执之后至少看到一次新结算，刷新或时钟前进不能立即再次送训',()=>{
  const x=scene();x.s.residents[3].stats.end=10;x.s.residents[5].stats.end=10;x.p.roomId=4;
  const returnedAt=x.v.serverTime;x.record.trainingRest=[{id:x.p.id,at:returnedAt}];
  for(const elapsed of [0,1000,600000]){
    x.v.serverTime=returnedAt+elapsed;x.record=JSON.parse(JSON.stringify(x.record));
    assert.equal(x.run().actions.some(a=>a.id===x.p.id&&a.role==='training'),false,'a new read is not a settled production interval');
  }
  x.s.lastSettledAt=x.v.serverTime;
  assert.ok(x.run().actions.some(a=>a.id===x.p.id&&a.role==='training'),'a real later settlement allows fresh investment evaluation');
});

test('训练实际用途：38人日志中过剩口粮的毛收益不能预留在岗工人，原父母训练保持',()=>{
  const {view,state,campaign}=idleTrainingScene(),m=api.model(view),cfg={...campaign,development:true,parentTraining:true};
  const record={...state.campaign,families:state.families,populationPreparation:42};
  const plan=api.plan(m,cfg,record,50);
  for(const id of [45,70,131,177])assert.ok(!plan.actions.some(a=>a.id===id&&a.purpose==='production'),String(id));
  assert.ok(plan.reserved.includes(11));assert.ok(!plan.actions.some(a=>a.id===11&&a.role==='training-release'));
  const p=view.state.residents.find(p=>p.id===70),room=view.state.rooms.find(r=>r.id===102);
  const estimate=api.estimate(m,p,room,168,{demand:{...m.demand,food:42,water:42}});
  assert.ok(estimate.best.grossDelta>0);assert.equal(estimate.best.delta,0);
  assert.equal(estimate.reason,'surplus-without-use');assert.equal(estimate.eligible,false);
});

test('训练实际用途：仓库与房间暂存都计入上限，仍能存下的有效收益可训练',()=>{
  const x=scene('agi',3);x.p.roomId=2;x.s.rooms.find(r=>r.id===2).width=2;
  x.s.resources.food=100;
  const m=api.model(x.v),ample={...m,caps:{...m.caps,food:100000}};
  const a=api.estimate(ample,x.p,x.room);assert.equal(a.eligible,true);close(a.best.delta,a.best.grossDelta);
  x.s.resources.food=m.caps.food;
  const rejected=api.estimate(api.model(x.v),x.p,x.room);
  assert.equal(rejected.eligible,false);assert.equal(rejected.reason,'surplus-without-use');
  assert.ok(rejected.usefulSupply.bufferCapacity>0);
});

test('训练实际用途：已承诺口粮和在建仓容增加实际用途，未知的目标人口不预支消耗',()=>{
  const x=scene('agi',3);x.p.roomId=2;x.s.rooms.find(r=>r.id===2).width=2;
  x.s.resources.food=100;
  const m=api.model(x.v),low=api.estimate(m,x.p,x.room);
  assert.equal(low.eligible,false);
  const committed=api.estimate(m,x.p,x.room,168,{demand:{food:30}});
  assert.equal(committed.eligible,true);
  for(const id of [101,102])x.s.rooms.push({...x.s.rooms[0],id,type:'storage',width:3,level:1,builtAt:x.v.serverTime+3600000});
  const growing=api.estimate(api.model(x.v),x.p,x.room);
  assert.equal(growing.eligible,true,'已开工仓容可以计入用途上界');
});

test('训练实际用途：已有当前格不因新准入上限被中断，废料与有用途的零件仍按原规则',()=>{
  const x=scene('agi',3);x.p.roomId=x.room.id;x.p.training=.9;x.s.resources.food=100000;
  const a=x.estimate();assert.equal(a.eligible,true);assert.equal(a.usefulSupply,null);
  const scrap=scene('end',5);assert.equal(scrap.estimate().eligible,true);
});
