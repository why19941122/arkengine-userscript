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
  defaults:campaignDefaults,valid:validCampaignRecord,pending:validCampaignPending,finish:shelterTrainingFinish})`,{
  objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
  shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
const hour=3600000;
test('141日志训练：魅力64.3%及25%先完成当前格，不因缺少生产用途调走，刷新期限固定',()=>{
  for(const [base,progress] of [[6,.643],[5,.25]]){
    const context=scene('cha',base),{p,room,record,v}=context;
    room.level=3;p.roomId=room.id;p.training=progress;
    const plan=context.run(),retained=plan.adoptions.find(role=>role.id===p.id);
    assert.ok(retained,JSON.stringify(plan.actions));
    assert.equal(retained.purpose,'current');assert.equal(retained.base,base);
    assert.ok(!plan.actions.some(action=>action.id===p.id&&action.role==='training-release'));
    record.roles.push(retained);assert.equal(api.valid(record),true);
    v.serverTime+=60000;
    const restored=context.run();assert.ok(!restored.actions.some(action=>action.id===p.id&&action.role==='training-release'));
    assert.ok(!restored.adoptions.some(role=>role.id===p.id&&role.until!==retained.until));
    v.serverTime=retained.until+1;
    assert.ok(context.run().actions.some(action=>action.id===p.id&&action.role==='training-release'));
  }
});

test('当前格训练：幸运和无空位智力也保护已有进度，不虚构生产收益或返岗席位',()=>{
  for(const stat of ['lck','int']){
    const context=scene(stat,5);context.p.roomId=context.room.id;context.p.training=.9;
    const plan=context.run(),retained=plan.adoptions.find(role=>role.id===context.p.id);
    assert.equal(retained?.purpose,'current',stat);assert.equal(retained.destination,undefined);
    assert.ok(!plan.actions.some(action=>action.id===context.p.id&&action.role==='training-release'));
    context.record.roles.push(retained);context.p.stats[stat]++;context.p.training=0;
    assert.ok(context.run().actions.some(action=>action.id===context.p.id&&action.role==='training-release'));
  }
});

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);
test('当前格训练：关闭、断供与固定截止释放，不以当前格保护永久占位',()=>{
  for(const condition of ['disabled','supply','deadline']){
    const context=scene('cha',5);context.p.roomId=context.room.id;context.p.training=.9;
    const retained=context.run().adoptions.find(role=>role.id===context.p.id);assert.equal(retained?.purpose,'current');
    context.record.roles.push(retained);
    if(condition==='disabled')context.cfg.training=false;
    if(condition==='supply')context.s.resources.power=0;
    if(condition==='deadline')context.v.serverTime=retained.until;
    const plan=context.run();assert.ok(plan.actions.some(action=>action.id===context.p.id&&action.role==='training-release'),condition);
    assert.ok(!plan.adoptions.some(role=>role.id===context.p.id),condition);
  }
});

test('当前格训练：旧生产保护转入收尾时补全有限期限标记，不继承虚假返岗位',()=>{
  const context=scene('end',5),{p,room,v,cfg,record}=context;p.roomId=room.id;p.training=.9;
  const role={id:p.id,room:room.id,role:'training',at:v.serverTime-4*hour,stat:'end',base:5,
    purpose:'production',until:v.serverTime+hour,windowEnd:v.serverTime+1000,destination:4};
  const retained=api.finish(api.model(v),p,room,cfg,record,role);
  assert.equal(retained?.purpose,'current');assert.equal(retained.finishCurrent,true);
  assert.ok(retained.until<=role.until);assert.equal(retained.destination,undefined);assert.equal(retained.windowEnd,undefined);
  assert.equal(api.valid({...record,roles:[retained]}),true);
});

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

function advancedTrainingCell(){
  const context=scene('per',4),{v,p,room,record}=context;
  room.level=2;p.roomId=room.id;p.training=.9;
  record.roles=[{id:p.id,room:room.id,role:'training',at:v.serverTime-2*hour,stat:'per',base:3,
    until:v.serverTime-hour,finishCurrent:true,purpose:'production',windowEnd:v.serverTime+156*hour,destination:3}];
  assert.equal(api.valid(record),true);
  return context;
}

test('跨格训练保护：上一格收尾已过期，当前90%仍保留；同一格刷新不续期',()=>{
  const context=advancedTrainingCell(),{v,p,record}=context,before=JSON.stringify(record);
  const plan=context.run(),adopted=plan.adoptions.find(role=>role.id===p.id);
  assert.ok(adopted);assert.equal(adopted.base,4);assert.equal(adopted.finishCurrent,true);
  assert.equal(adopted.destination,3);assert.equal(adopted.windowEnd,record.roles[0].windowEnd);
  assert.ok(adopted.until>v.serverTime&&adopted.until<=v.serverTime+130*60000);
  assert.ok(!plan.actions.some(action=>action.id===p.id));assert.ok(plan.reserved.includes(p.id));
  assert.equal(JSON.stringify(record),before);
  record.roles=[JSON.parse(JSON.stringify(adopted))];v.serverTime+=60000;
  const refreshed=context.run();assert.ok(refreshed.reserved.includes(p.id));assert.equal(refreshed.adoptions.length,0);
  assert.equal(record.roles[0].until,adopted.until);
  p.stats.per=5;p.training=0;
  assert.equal(context.run().actions.find(action=>action.id===p.id)?.room,3);
});

test('跨格训练保护：同格超期、零进度、未知进度、关闭、断供及投资到期仍按条件释放',()=>{
  for(const condition of ['same-cell','zero','unknown','disabled','supply','window']){
    const context=advancedTrainingCell(),{v,p,cfg,record,s}=context;
    if(condition==='same-cell')p.stats.per=3;
    if(condition==='zero')p.training=0;
    if(condition==='unknown')delete p.training;
    if(condition==='disabled')cfg.training=false;
    if(condition==='supply')s.resources.power=0;
    if(condition==='window')record.roles[0].windowEnd=v.serverTime;
    const plan=context.run();assert.ok(plan.actions.some(action=>action.id===p.id&&action.role==='training-release'),condition);
    assert.ok(!plan.adoptions.some(role=>role.id===p.id),condition);
  }
});

test('训练连续生命周期：普通生产记录同一格到期也不能重新延长',()=>{
  const context=advancedTrainingCell(),{p,record}=context;
  p.stats.per=record.roles[0].base;delete record.roles[0].finishCurrent;
  const plan=context.run();
  assert.ok(plan.actions.some(action=>action.id===p.id&&action.role==='training-release'));
  assert.ok(!plan.adoptions.some(role=>role.id===p.id));
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
function upgradingTrainingScene(stat='end'){
  const context=scene(stat,2),{v,s,p,room,record,cfg}=context;
  const type={str:'power',per:'water',end:'scrap',agi:'diner',int:'workshop'}[stat];
  if(stat==='int'){
    s.rooms.push({...s.rooms[0],id:91,type:'workshop',level:2,floor:4,col:2});
    cfg.workshop=true;cfg.partsTarget=120;
  }
  const destination=s.rooms.find(target=>target.type===type);
  destination.level=2;p.roomId=room.id;p.training=1/6;
  record.roles=[{id:p.id,room:room.id,role:'training',at:v.serverTime-hour,stat,base:2,
    purpose:'production',until:v.serverTime+3*hour,windowEnd:v.serverTime+168*hour,destination:destination.id}];
  destination.upgradeAt=v.serverTime+hour;
  return {...context,destination};
}

test('生产训练返岗房升级：保留当前格、原席位和固定期限，不把施工房计为在产',()=>{
  for(const stat of ['str','per','end','agi','int']){
    const context=upgradingTrainingScene(stat),{v,s,p,record,destination}=context;
    const original=JSON.stringify(record),snapshot=JSON.stringify(v),started=v.serverTime;
    const resource={str:'power',per:'water',end:'scrap',agi:'food',int:'parts'}[stat];
    for(const elapsed of [0,hour/4,hour/2]){
      v.serverTime=started+elapsed;
      const model=api.model(v),plan=api.plan(model,context.cfg,JSON.parse(original),14);
      assert.equal(model.production[resource],0,stat+' construction produces nothing');
      assert.ok(!plan.actions.some(action=>action.id===p.id&&action.role==='training-release'),stat);
      assert.ok(plan.reserved.includes(p.id),stat);
      assert.ok(plan.trainingDestinations.some(seat=>seat.id===p.id&&seat.room===destination.id),stat);
      assert.ok(!plan.adoptions.some(role=>role.id===p.id),stat+' no renewed deadline');
      assert.ok(plan.events.includes(destination.upgradeAt-v.serverTime),stat+' checks upgrade completion');
      assert.equal(JSON.stringify(record),original);
    }
    v.serverTime=started;assert.equal(JSON.stringify(v),snapshot);
    destination.upgradeAt=null;destination.level=3;
    const afterUpgrade=context.run().actions.find(action=>action.id===p.id&&action.role==='training-release');
    if(stat==='int')assert.match(afterUpgrade?.reason,/no-payback-in-window/);
    else assert.equal(afterUpgrade,undefined,stat+' upgrade alone does not finish training');
    p.stats[stat]++;p.training=0;
    const returned=context.run().actions.find(action=>action.id===p.id&&action.role==='training-release');
    assert.equal(returned?.room,destination.id,stat+' completed training returns to original job');
  }
});

test('训练连续生命周期：返岗房升级时跨到90%的新格，保留席位且不提前计产',()=>{
  for(const stat of ['str','per','end','agi']){
    const context=upgradingTrainingScene(stat),{v,p,record,destination}=context;
    p.stats[stat]++;p.training=.9;record.roles[0].finishCurrent=true;
    record.roles[0].until=v.serverTime-1;
    const plan=context.run(),role=plan.adoptions.find(entry=>entry.id===p.id);
    assert.ok(role,stat);assert.equal(role.base,p.stats[stat]);assert.equal(role.destination,destination.id);
    assert.ok(!plan.actions.some(action=>action.id===p.id));
    assert.ok(plan.trainingDestinations.some(seat=>seat.id===p.id&&seat.room===destination.id));
    const resource={str:'power',per:'water',end:'scrap',agi:'food'}[stat];
    assert.equal(api.model(v).production[resource],0);
    record.roles=[JSON.parse(JSON.stringify(role))];v.serverTime+=60000;
    const refreshed=context.run();assert.ok(!refreshed.actions.some(action=>action.id===p.id));
    assert.equal(refreshed.adoptions.length,0);assert.equal(record.roles[0].until,role.until);
    destination.upgradeAt=null;destination.level=3;p.stats[stat]++;p.training=0;
    assert.equal(context.run().actions.find(action=>action.id===p.id)?.room,destination.id);
  }
});

test('生产训练返岗房升级：完成、关闭、到期、断供或岗位真实失效仍释放，不能调入施工房',()=>{
  for(const reason of ['completed','training-off','development-off','expired','window-ended','supply-low',
    'destination-lost','wrong-resource','full','unpowered','training-inactive','stat-changed','upgrade-too-late']){
    const context=upgradingTrainingScene(),{v,s,p,room,record,cfg,destination}=context;
    if(reason==='completed'){p.stats.end++;p.training=0;}
    if(reason==='training-off')cfg.training=false;
    if(reason==='development-off')cfg.development=false;
    if(reason==='expired')record.roles[0].until=v.serverTime;
    if(reason==='window-ended')record.roles[0].windowEnd=v.serverTime;
    if(reason==='supply-low')s.resources.power=0;
    if(reason==='destination-lost')s.rooms=s.rooms.filter(target=>target.id!==destination.id);
    if(reason==='wrong-resource')destination.type='diner';
    if(reason==='full')s.residents[5].roomId=destination.id;
    if(reason==='unpowered')destination.unpowered=true;
    if(reason==='training-inactive')room.upgradeAt=v.serverTime+hour;
    if(reason==='stat-changed')room.trainStat='agi';
    if(reason==='upgrade-too-late')destination.upgradeAt=record.roles[0].windowEnd;
    const released=context.run().actions.find(action=>action.id===p.id&&action.role==='training-release');
    assert.ok(released,reason);assert.equal(released.room,null,reason+' cannot assign into construction');
  }
});

test('生产训练返岗房升级：多个训练者仍共享真实容量，不重复预留最后一席',()=>{
  const context=upgradingTrainingScene(),{s,room,record,destination}=context;
  const second=s.residents[5];second.roomId=room.id;second.stats.end=2;second.training=1/6;
  record.roles.push({...record.roles[0],id:second.id});
  const plan=context.run();
  assert.equal(plan.trainingDestinations.filter(seat=>seat.room===destination.id).length,1);
  assert.ok(plan.reserved.includes(record.roles[0].id));
  assert.ok(plan.actions.some(action=>action.id===second.id&&action.role==='training-release'&&action.room===null));
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
      x.s.rooms.push({...x.s.rooms.find(r=>r.id===4),id:91,upgradeAt:null,floor:4,col:2});
      x.s.rooms=x.s.rooms.filter(r=>r.id!==a.destination);
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
