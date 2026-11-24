import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const segment=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const implementation=[declarations,segment('  function shelterWorkerRate(','  function readShelter('),
  segment('  const staffRoomTypes =','  function shelterExploreStep('),
  segment('  function shelterCampaignSchedule(','  function shelterDailyClaimStep('),
  segment('  function shelterCampaignAllowed(','  function shelterFormValue(')].join('\n');
function setup(type='training'){
  const v=campaignView(),events=[],context={objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'},
    shelterStaffMode:'production',shelterStaffHold:'',shelterOptimize:true,shelterGear:false,shelterPopulationTarget:14,shelterLevelTarget:8,
    shelterConstruction:{build:false,upgrade:false,dig:false,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0},
    shelterState:{families:[],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},
    shelterPending:null,shelterRead:null,shelterExploreManualUntil:0,shelterCaravanNote:'',shelterConstructionNote:'',shelterStaffNote:'',shelterPopulationNote:'',shelterSocialNote:'',
    Date:class extends Date{constructor(...args){super(...(args.length?args:[v.serverTime]));}static now(){return v.serverTime;}},
    crypto:{randomUUID:()=>String(v.serverTime)},log:{add:(...args)=>events.push(args)},workshopAutomatic:()=>false};
  context.saveShelter=x=>context.shelterState=x;
  const api=vm.runInNewContext(`${implementation}\nshelterCampaign={...campaignDefaults};
    ({model:shelterModel,plan:shelterCampaignPlan,defaults:campaignDefaults,staff:shelterStaffPlan,campaign:shelterCampaignSchedule,
      dorm:shelterDormWorkers,idle:shelterIdleEmploymentChoice,
      shortages:typeof shelterSupplyShortages==='function'?shelterSupplyShortages:null,
      allowed:shelterCampaignAllowed,valid:validCampaignRecord,record:recordShelterCampaign})`,context);
  const s=v.state,room={...s.rooms[0],id:90,type,trainStat:'end',level:1,floor:3,col:2};s.rooms.push(room);
  const p=s.residents[4];Object.assign(p,{roomId:90,xp:0,hp:100,training:.9,stats:{str:5,per:5,end:5,cha:5,int:5,agi:5,lck:5}});
  s.residents[3].stats.end=10;s.residents[5].stats.end=10;
  const cfg={...api.defaults,development:true,training:true,trainTarget:6};
  return {v,s,p,room,context,api,cfg,events,
    run:(extra={},record={})=>api.plan(api.model(v),{...cfg,...extra},{...context.shelterState.campaign,...record},14)};
}

test('历史宿舍：普通成人与已有子女的成人都能就业，不要求旧自动角色',()=>{
  for(const hasChildren of [false,true]){
    const x=setup('quarters');x.context.shelterOptimize=false;
    if(hasChildren)x.s.residents[5].parents=[x.p.id,4];
    const m=x.api.model(x.v),campaign=x.api.campaign(m);
    assert.ok(x.api.dorm(m,campaign).includes(x.p.id));
    const a=x.api.staff(m);assert.equal(a.id,x.p.id);assert.equal(a.room,4);
  }
});
test('历史训练：只读候选按剩余进度接管，不修改原快照和角色记录',()=>{
  const x=setup(),before=JSON.stringify(x.v),record=JSON.stringify(x.context.shelterState);
  const plan=x.run(),adopt=plan.adoptions?.find(r=>r.id===x.p.id);
  assert.ok(adopt);assert.equal(adopt.purpose,'production');assert.equal(adopt.base,5);assert.equal(adopt.destination,4);
  assert.ok(adopt.until-x.v.serverTime<3600000);assert.ok(plan.reserved.includes(x.p.id));
  assert.ok(!plan.actions.some(a=>a.id===x.p.id));
  assert.equal(JSON.stringify(x.v),before);assert.equal(JSON.stringify(x.context.shelterState),record);
});
test('历史训练：调度保存用途与固定期限，刷新后不重开168小时窗口，完成后返岗',()=>{
  const x=setup();x.context.shelterCampaign={...x.cfg};
  x.api.campaign(x.api.model(x.v));
  const first=x.context.shelterState.campaign.roles.find(r=>r.id===x.p.id);assert.ok(first);
  assert.equal(x.api.valid(x.context.shelterState.campaign),true);
  x.context.shelterState=JSON.parse(JSON.stringify(x.context.shelterState));x.v.serverTime+=60000;
  const next=x.api.campaign(x.api.model(x.v));
  assert.equal(x.context.shelterState.campaign.roles.find(r=>r.id===x.p.id).windowEnd,first.windowEnd);
  assert.ok(next.reserved.includes(x.p.id));
  x.p.stats.end++;x.p.training=0; // Native completion starts the next cell at zero.
  const done=x.api.campaign(x.api.model(x.v));
  assert.ok(done.actions.some(a=>a.id===x.p.id&&a.role==='training-release'&&a.room===4));
});
test('历史训练：无用途释放；未知属性或进度不猜；家庭、未决与暂停不接管',()=>{
  const useless=setup();useless.p.stats.end=10;
  assert.ok(useless.run().actions.some(a=>a.id===useless.p.id&&a.role==='training-release'));
  for(const kind of ['unknown-stat','unknown-progress','romance','pending','hold']){
    const x=setup(),record={};
    if(kind==='unknown-stat')delete x.room.trainStat;
    if(kind==='unknown-progress')delete x.p.training;
    if(kind==='romance')x.p.romance={partnerId:6,progress:.3};
    if(kind==='pending')record.pending={kind:'assign',targets:[x.p.id,90]};
    if(kind==='hold')x.cfg.development=false;
    const plan=x.run({},record);
    assert.ok(!plan.adoptions?.some(r=>r.id===x.p.id),kind);
    assert.ok(!plan.actions.some(a=>a.id===x.p.id),kind);
  }
});
test('历史特殊岗：有效医疗与工坊用途保留，需求结束后可释放',()=>{
  const med=setup('medbay');med.p.training=undefined;
  med.s.residents[5].hp=30;med.s.resources.stimpak=0;
  assert.ok(med.run({medical:true}).reserved.includes(med.p.id));
  med.s.residents[5].hp=142;med.s.resources.stimpak=10;
  assert.ok(med.run({medical:true}).actions.some(a=>a.id===med.p.id&&a.role==='medical-release'));
  const workshop=setup('workshop');
  assert.ok(workshop.run({workshop:true,partsTarget:40,workshopScrapReserve:100}).reserved.includes(workshop.p.id));
  assert.ok(workshop.run({workshop:true,partsTarget:0}).actions.some(a=>a.id===workshop.p.id&&a.role==='workshop-release'));
});
test('历史电台：需要人口或满床心情时保留，目标已满仍有空床时释放',()=>{
  const x=setup('radio');
  assert.ok(x.run({radio:true}).actions.some(a=>a.id===x.p.id&&a.role==='radio-release'),'idle adult blocks recruitment');
  x.s.residents[5].roomId=4;
  assert.ok(x.run({radio:true}).reserved.includes(x.p.id));
  const plan=x.api.plan(x.api.model(x.v),{...x.cfg,radio:true},x.context.shelterState.campaign,6);
  assert.ok(plan.actions.some(a=>a.id===x.p.id&&a.role==='radio-release'));
});
test('发展关闭养成后仍能执行必要释放；用户手动操作和人员暂停继续阻止提交',()=>{
  const x=setup();x.context.shelterCampaign={...x.api.defaults};
  for(const role of ['training-release','medical-release','radio-release','workshop-release'])
    assert.equal(x.api.allowed({kind:'assign',role}),true,role);
  x.context.shelterStaffHold=true;assert.equal(x.api.allowed({kind:'assign',role:'training-release'}),false);
  x.context.shelterStaffHold=false;x.context.shelterExploreManualUntil=x.v.serverTime+1000;
  assert.equal(x.api.allowed({kind:'assign',role:'training-release'}),false);
});

test('历史训练：多人可保留当前格，既有生产目的地不占返岗席位',()=>{
  for(const existing of [false,true]){
    const x=setup(),other=x.s.residents[5];
    Object.assign(other,{roomId:90,xp:0,hp:100,training:.9,stats:{...x.p.stats}});
    const record=existing?{roles:[{id:other.id,room:90,role:'training',at:x.v.serverTime-1000,
      stat:'end',base:5,purpose:'production',until:x.v.serverTime+3600000,
      windowEnd:x.v.serverTime+168*3600000,destination:4}]}:{};
    const before=JSON.stringify(record),plan=x.run({},record);
    assert.equal(plan.trainingDestinations.length,0);
    assert.equal(plan.adoptions.filter(r=>r.purpose==='production').length,existing?0:1);
    assert.equal(JSON.stringify(record),before);
  }
});
test('历史训练：旧无用途角色转换为实际剩余进度，不沿用旧时间或重写输入',()=>{
  const x=setup(),record={roles:[{id:x.p.id,room:90,role:'training',at:1,stat:'end',base:4}]};
  const before=JSON.stringify(record),plan=x.run({},record),adopt=plan.adoptions.find(r=>r.id===x.p.id);
  assert.equal(adopt?.purpose,'production');assert.equal(adopt.base,5);
  assert.ok(adopt.until>x.v.serverTime&&adopt.until<x.v.serverTime+3600000);
  assert.equal(JSON.stringify(record),before);
});
test('历史岗位：未知待产保护关联家庭家长，即使家长已离开该宿舍',()=>{
  for(const type of ['training','medbay','workshop','radio']){
    const x=setup(type);x.s.births.push({roomId:5,dueAt:x.v.serverTime+3600000});
    const plan=x.run({}, {families:[{a:x.p.id,b:6,room:5}]});
    assert.ok(!plan.adoptions.some(r=>r.id===x.p.id),type);
    assert.ok(!plan.actions.some(a=>a.id===x.p.id),type);
  }
});
test('历史训练：保存接管失败不得返回可执行计划或报告接管成功',()=>{
  const x=setup();x.context.shelterCampaign={...x.cfg};
  const before=JSON.stringify(x.context.shelterState);
  x.context.saveShelter=()=>{throw Error('fixture storage full');};
  assert.throws(()=>x.api.campaign(x.api.model(x.v)),/fixture storage full/);
  assert.equal(JSON.stringify(x.context.shelterState),before);
  assert.ok(!x.events.some(e=>e[0]==='shelter-training-adopted'));
});

function finishingParent(){
  const x=setup();x.room.trainStat='cha';x.p.stats.cha=6;x.p.training=5/7;
  x.cfg.parentTraining=true;x.context.shelterState.families=[{a:5,b:6,room:5}];
  x.record={...x.context.shelterState.campaign,families:x.context.shelterState.families,
    roles:[{id:5,room:90,role:'training',purpose:'parent',stat:'cha',base:5,
      at:x.v.serverTime-6*3600000,until:x.v.serverTime-1000}]};
  x.plan=()=>x.run({},x.record);return x;
}
test('训练收尾：魅力6到7已完成71.4%，到目标及冷却结束仍先完成当前格',()=>{
  const x=finishingParent(),before=JSON.stringify(x.record),plan=x.plan(),role=plan.adoptions.find(r=>r.id===5);
  assert.equal(role?.finishCurrent,true);assert.equal(role.base,6);assert.equal(role.stat,'cha');
  assert.ok(role.until>x.v.serverTime&&role.until<=x.v.serverTime+130*60000);
  assert.ok(plan.reserved.includes(5));assert.ok(!plan.actions.some(a=>a.id===5));
  assert.equal(JSON.stringify(x.record),before,'pure planning does not write records');
  assert.equal(x.api.valid({...x.context.shelterState.campaign,roles:[role]}),true);
});
test('训练收尾：按剩余时长判断，同百分比慢训练退出，低百分比快训练可收尾',()=>{
  const slow=finishingParent();slow.p.stats.cha=9;
  assert.ok(slow.plan().actions.some(a=>a.id===5&&a.role==='training-release'));
  const fast=finishingParent();fast.p.stats.cha=1;fast.p.training=.2;fast.room.level=3;
  assert.equal(fast.plan().adoptions.find(r=>r.id===5)?.finishCurrent,true);
});
test('训练收尾：刷新固定当前属性和期限，完成且下一格未开始或同格超时即释放',()=>{
  for(const end of ['completed','expired']){
    const x=finishingParent(),role=x.plan().adoptions.find(r=>r.id===5);assert.ok(role);
    x.record.roles=[JSON.parse(JSON.stringify(role))];x.v.serverTime+=60000;
    const kept=x.plan();assert.ok(kept.reserved.includes(5));assert.equal(kept.adoptions.length,0);
    assert.equal(x.record.roles[0].until,role.until);
    if(end==='completed'){x.p.stats.cha=7;x.p.training=0;}else x.v.serverTime=role.until;
    const done=x.plan();assert.ok(done.actions.some(a=>a.id===5&&a.role==='training-release'),end);
    assert.equal(done.adoptions.length,0,end);
  }
});
test('跨格训练保护：父母下一格已到90%时重新绑定当前属性，保留原返岗席位',()=>{
  const context=finishingParent(),role=context.plan().adoptions.find(entry=>entry.id===5);
  context.record.roles=[{...role,destination:4}];context.p.stats.cha=7;context.p.training=.9;
  context.v.serverTime=role.until+60000;
  context.s.lastSettledAt=context.v.serverTime;
  const plan=context.plan(),adopted=plan.adoptions.find(entry=>entry.id===5);
  assert.equal(adopted?.base,7);assert.equal(adopted?.purpose,'parent');assert.equal(adopted.destination,4);
  assert.ok(plan.reserved.includes(5));assert.ok(!plan.actions.some(action=>action.id===5));
});
test('训练收尾：关闭训练、无实际家庭收益、未知进度或供应不足不新增收尾承诺',()=>{
  for(const reason of ['disabled','no-family','zero','unknown','supply','pending']){
    const x=finishingParent();
    if(reason==='disabled')x.cfg.training=false;
    if(reason==='no-family')x.record.families=[];
    if(reason==='zero')x.p.training=0;
    if(reason==='unknown')delete x.p.training;
    if(reason==='supply'){x.s.resources.power=0;x.s.rooms.find(r=>r.id===1).unpowered=true;}
    if(reason==='pending')x.record.pending={kind:'assign',targets:[5,null]};
    assert.ok(!x.plan().adoptions.some(r=>r.id===5&&r.finishCurrent),reason);
  }
});
test('训练收尾：已有生产收益的历史训练达到目标后保留当前格，不预留返岗席位',()=>{
  const x=setup();x.p.stats.end=6;x.p.training=5/7;
  const plan=x.run(),role=plan.adoptions.find(r=>r.id===x.p.id);
  assert.equal(role?.finishCurrent,true);assert.equal(role.purpose,'production');assert.equal(role.destination,4);
  assert.equal(plan.trainingDestinations.length,0);
});
test('训练收尾：保存收尾承诺并刷新后仍按同一属性和期限核对',()=>{
  const x=finishingParent();x.context.shelterStaffMode='population';
  x.context.shelterCampaign={...x.cfg};x.context.shelterState.campaign={...x.context.shelterState.campaign,roles:x.record.roles};
  x.api.campaign(x.api.model(x.v));
  const role=x.context.shelterState.campaign.roles.find(r=>r.id===5);assert.equal(role?.finishCurrent,true);
  x.context.shelterState=JSON.parse(JSON.stringify(x.context.shelterState));x.v.serverTime+=60000;
  x.api.campaign(x.api.model(x.v));
  assert.equal(JSON.stringify(x.context.shelterState.campaign.roles.find(r=>r.id===5)),JSON.stringify(role));
});
test('闲置就业：家庭计算未返回或失败仍可只增不减地补现成岗位，不动原生产者',()=>{
  for(const status of ['running','failed']){
    const x=setup(),before=JSON.stringify(x.v),plan={reserved:[5],familySupplyPlanning:{status}};
    const job=x.api.idle(x.api.model(x.v),plan);
    assert.equal(job.id,6);assert.equal(job.from,null);assert.equal(job.room,4);assert.equal(job.idleEmployment,true);
    assert.equal(JSON.stringify(x.v),before);
  }
});
test('闲置就业：供给不足优先补基础岗位，再补回收',()=>{
  const x=setup();x.s.rooms.find(r=>r.id===1).level=1;x.s.residents[0].stats.str=0;
  assert.equal(x.api.idle(x.api.model(x.v),{reserved:[5]}).room,1);
});
function competingSupply(){
  const x=setup('quarters');x.p.roomId=4;x.context.shelterOptimize=false;
  x.s.rooms.find(r=>r.id===2).level=1;x.s.rooms.find(r=>r.id===3).level=1;
  x.s.residents[1].stats.agi=2;x.s.residents[2].stats.per=0;
  x.s.resources.food=5;x.s.resources.water=10;
  return x;
}
test('补岗紧迫性：库存较多但净消耗更快的水优先，快速与普通调度一致',()=>{
  const x=competingSupply(),m=x.api.model(x.v),before=JSON.stringify(x.v);
  assert.ok(m.production.food<m.demand.food&&m.production.water<m.demand.water);
  assert.ok(x.s.resources.food/m.demand.food<x.s.resources.water/m.demand.water);
  assert.ok(x.s.resources.food/(m.demand.food-m.production.food)>x.s.resources.water/(m.demand.water-m.production.water));
  assert.equal(x.api.idle(m,{}).room,3);assert.equal(x.api.staff(m).room,3);
  assert.equal(JSON.stringify(x.v),before);
});
test('补岗紧迫性：真实负产出先于只缺余量，供给变化后重新排序',()=>{
  const x=competingSupply();x.s.residents[1].stats.agi=3;
  let m=x.api.model(x.v);assert.ok(m.production.food>=m.demand.food&&m.production.food<m.demand.food*1.2);
  assert.equal(x.api.idle(m,{}).room,3);assert.equal(x.api.staff(m).room,3);
  x.s.residents[2].stats.per=3;x.s.residents[1].stats.agi=0;
  m=x.api.model(x.v);assert.equal(x.api.idle(m,{}).room,2);assert.equal(x.api.staff(m).room,2);
});
test('补岗紧迫性：等净消耗时间、零库存与无负产出时保持确定顺序和原余量规则',()=>{
  const x=competingSupply();x.s.residents[1].stats.agi=0;
  x.s.resources.food=10;x.s.resources.water=10;
  assert.equal(x.api.idle(x.api.model(x.v),{}).room,2);
  x.s.resources.water=0;assert.equal(x.api.idle(x.api.model(x.v),{}).room,3);
  x.s.residents[1].stats.agi=3;x.s.residents[2].stats.per=3;
  assert.equal(x.api.idle(x.api.model(x.v),{}).room,3);
});
test('补岗紧迫性：未来家庭与工程需求不冒充当前消耗，仍保留在补岗候选中',()=>{
  const x=competingSupply();x.s.residents[2].stats.per=10;
  const m=x.api.model(x.v),demand={...m.demand,water:30},projected={...m.production,water:0};
  assert.ok(m.production.water>m.demand.water);
  const before=JSON.stringify([m,demand,projected]),shortages=x.api.shortages(m,demand,projected);
  assert.deepEqual(Array.from(shortages),['food','water']);
  assert.equal(JSON.stringify([m,demand,projected]),before);
});
test('补岗紧迫性：最急房间不可用或有训练预留时继续补下一缺口',()=>{
  for(const why of ['incident','upgrade','unpowered','seat','full']){
    const x=competingSupply(),room=x.s.rooms.find(r=>r.id===3),campaign={};
    if(why==='incident')room.incident={kind:'leak'};
    if(why==='upgrade')room.upgradeAt=x.v.serverTime+600000;
    if(why==='unpowered')room.unpowered=true;
    if(why==='seat')campaign.trainingDestinations=[{id:5,room:3}];
    if(why==='full'){x.p.roomId=3;x.p.stats.per=0;campaign.reserved=[5];}
    assert.equal(x.api.idle(x.api.model(x.v),campaign).room,2,why);
  }
});
test('满仓补供给：电食水库存满也先补产能缺口，不把唯一闲人直接派去回收',()=>{
  for(const [resource,roomId,stat] of [['power',1,'str'],['food',2,'agi'],['water',3,'per']]){
    const x=setup();x.s.rooms.find(r=>r.id===roomId).level=1;x.s.residents[roomId-1].stats[stat]=0;
    const m=x.api.model(x.v);x.s.resources[resource]=m.caps[resource];
    assert.ok(m.production[resource]<m.demand[resource],resource+' has negative net production');
    const before=JSON.stringify(x.v),job=x.api.idle(x.api.model(x.v),{reserved:[5],familySupplyPlanning:{status:'running'}});
    assert.equal(job?.room,roomId,resource);assert.equal(job.id,6);assert.equal(JSON.stringify(x.v),before);
    x.s.residents[5].roomId=roomId;
    assert.ok(x.api.model(x.v).production[resource]>=m.demand[resource]*1.2);
    assert.equal(x.api.idle(x.api.model(x.v),{reserved:[5]}),null);
  }
});
test('满仓补供给：保留20%供给余量，但产能足够或废料满仓时不多塞人',()=>{
  const x=setup();x.s.rooms.find(r=>r.id===2).level=1;x.s.residents[1].stats.agi=3;
  let m=x.api.model(x.v);x.s.resources.food=m.caps.food;
  assert.ok(m.production.food>=m.demand.food&&m.production.food<m.demand.food*1.2);
  assert.equal(x.api.idle(x.api.model(x.v),{reserved:[5]}).room,2);
  x.s.residents[1].stats.agi=4;m=x.api.model(x.v);
  assert.ok(m.production.food>=m.demand.food*1.2);
  assert.equal(x.api.idle(m,{reserved:[5]}).room,4);
  x.s.resources.scrap=m.caps.scrap;assert.equal(x.api.idle(x.api.model(x.v),{reserved:[5]}),null);
});
test('满仓补供给：仍保护暂停、训练席位、满员与不可用房间',()=>{
  for(const reason of ['off','hold','pending','seat','full','incident','upgrade','unpowered']){
    const x=setup(),room=x.s.rooms.find(r=>r.id===2),campaign={reserved:[5]};
    room.level=1;x.s.residents[1].stats.agi=0;
    let m=x.api.model(x.v);x.s.resources.food=m.caps.food;
    if(reason==='off')x.context.shelterStaffMode='off';
    if(reason==='hold')x.context.shelterStaffHold=true;
    if(reason==='pending')x.context.shelterPending={kind:'assign'};
    if(reason==='seat')campaign.trainingDestinations=[{id:5,room:2}];
    if(reason==='full'){x.p.roomId=2;x.p.stats.agi=0;}
    if(reason==='incident')room.incident={kind:'leak'};
    if(reason==='upgrade')room.upgradeAt=x.v.serverTime+600000;
    if(reason==='unpowered')room.unpowered=true;
    const job=x.api.idle(x.api.model(x.v),campaign);
    assert.notEqual(job?.room,2,reason);
    if(['off','hold','pending'].includes(reason))assert.equal(job,null,reason);
  }
});
test('宿舍快速就业：未配对成人不等家庭后台计算，保留真实原岗位',()=>{
  for(const status of ['running','queued','failed']){
    const x=setup('quarters');x.s.residents[5].roomId=1;
    const before=JSON.stringify(x.v),job=x.api.idle(x.api.model(x.v),{familySupplyPlanning:{status}});
    assert.equal(job?.id,5,status);assert.equal(job.from,90);assert.equal(job.room,4);
    assert.equal(job.idleEmployment,true);assert.equal(JSON.stringify(x.v),before);
  }
});
function coolingFamily(){
  const x=setup('quarters');x.s.rooms.find(r=>r.id===4).width=2;
  x.context.shelterState.families=[{a:5,b:6,room:90}];
  for(const p of x.s.residents.slice(4)){p.roomId=90;p.familyCooldownUntil=x.v.serverTime+6*3600000;}
  return x;
}
test('冷却就业：已有家庭冷却时也能在后台等待中补回收，关系与期限保留',()=>{
  for(const status of ['running','queued','failed']){
    const x=coolingFamily(),record=JSON.stringify(x.context.shelterState),until=x.p.familyCooldownUntil,assigned=[];
    for(let i=0;i<2;i++){
      const m=x.api.model(x.v);assert.ok(x.api.dorm(m,{}).length>0);
      const job=x.api.idle(m,{familySupplyPlanning:{status}});
      assert.ok(job,status+' cooldown adult should work');assert.equal(job.room,4);assert.equal(job.from,90);
      assigned.push(job.id);x.s.residents.find(p=>p.id===job.id).roomId=job.room;
    }
    assert.deepEqual(assigned.sort(),[5,6]);assert.equal(x.api.idle(x.api.model(x.v),{}),null);
    assert.equal(JSON.stringify(x.context.shelterState),record);
    assert.ok(x.s.residents.slice(4).every(p=>p.familyCooldownUntil===until));
  }
});
test('冷却就业：冷却已到或无期限、恋爱、待产、预留和未知请求仍不能抢人',()=>{
  for(const mode of ['expired','near-expiry','unknown','nonfinite','romance','one-sided','birth','unknown-birth','reserved','daily','pending','training']){
    const x=coolingFamily(),campaign={};
    for(const p of x.s.residents.slice(4)){
      if(mode==='expired')p.familyCooldownUntil=x.v.serverTime;
      if(mode==='near-expiry')p.familyCooldownUntil=x.v.serverTime+600000;
      if(mode==='unknown')delete p.familyCooldownUntil;
      if(mode==='nonfinite')p.familyCooldownUntil=Infinity;
      if(mode==='romance')p.romance={partnerId:p.id===5?6:5,progress:.1};
    }
    if(mode==='one-sided')x.p.romance={partnerId:6,progress:.1};
    if(mode==='birth')x.s.births=[{roomId:90,parents:[5,6],dueAt:x.v.serverTime+3600000}];
    if(mode==='unknown-birth'){
      x.s.births=[{roomId:90,dueAt:x.v.serverTime+3600000}];
      // Even a parent now resting outside that dorm keeps the unknown-birth reservation.
      for(const p of x.s.residents.slice(4))p.roomId=null;
    }
    if(mode==='reserved')campaign.reserved=[5,6];
    if(mode==='daily')campaign.dailyReserved=[5,6];
    if(mode==='pending')x.context.shelterPending={kind:'assign'};
    if(mode==='training')x.room.type='training';
    assert.equal(x.api.idle(x.api.model(x.v),campaign),null,mode);
  }
});
test('宿舍快速就业：不抢家庭、待产、预留人员，不搬训练者及不合格居民',()=>{
  for(const why of ['family','romance','birth','unknown-birth','reserved','daily','defender','training',
      'child','away','dead','injured','room-building','room-upgrade','room-incident','room-unpowered','return-seat']){
    const x=setup('quarters'),plan={};x.s.residents[5].roomId=1;
    if(why==='family')x.context.shelterState.families=[{a:5,b:6,room:90}];
    if(why==='romance')x.p.romance={partnerId:6,progress:.3};
    if(why==='birth')x.s.births=[{roomId:90,parents:[5,6],dueAt:x.v.serverTime+3600000}];
    if(why==='unknown-birth')x.s.births=[{roomId:90,dueAt:x.v.serverTime+3600000}];
    if(why==='reserved')plan.reserved=[5];
    if(why==='daily')plan.dailyReserved=[5];
    if(why==='defender')x.context.shelterState.campaign.defense=[{id:5}];
    if(why==='training')x.room.type='training';
    if(why==='child')x.p.adultAt=x.v.serverTime+3600000;
    if(why==='away')x.p.away={kind:'explore'};
    if(why==='dead')x.p.deadAt=x.v.serverTime;
    if(why==='injured')x.p.hp=20;
    if(why==='room-building')x.room.builtAt=x.v.serverTime+3600000;
    if(why==='room-upgrade')x.room.upgradeAt=x.v.serverTime+3600000;
    if(why==='room-incident')x.room.incident={kind:'leak'};
    if(why==='room-unpowered')x.room.unpowered=true;
    if(why==='return-seat')plan.trainingDestinations=[{id:6,room:4}];
    assert.equal(x.api.idle(x.api.model(x.v),plan),null,why);
  }
});
function complementaryIdleWorkers(){
  const x=setup('quarters');
  x.s.rooms.find(r=>r.id===1).level=1;x.s.residents[0].stats.str=0;
  for(const p of x.s.residents.slice(4))Object.assign(p,{xp:0,hp:100,roomId:90});
  Object.assign(x.p.stats,{str:10,end:10});Object.assign(x.s.residents[5].stats,{str:9,end:0});
  return x;
}
test('组合补岗：两人都能补足供电时保留回收能手，实际两步产出优于逐次最强',()=>{
  const x=complementaryIdleWorkers(),before=JSON.stringify(x.v),initial=x.api.model(x.v);
  const first=x.api.idle(initial,{familySupplyPlanning:{status:'running'}});
  assert.equal(first?.room,1);assert.equal(first.id,6,'sufficient power worker leaves the best recycler available');
  assert.equal(first.from,90);assert.equal(JSON.stringify(x.v),before);
  x.s.residents.find(p=>p.id===first.id).roomId=first.room;
  const second=x.api.idle(x.api.model(x.v),{});assert.equal(second.id,5);assert.equal(second.room,4);
  x.p.roomId=second.room;
  const improved=x.api.model(x.v).production;
  const old=complementaryIdleWorkers();old.p.roomId=1;old.s.residents[5].roomId=4;
  const legacy=old.api.model(old.v).production;
  assert.ok(improved.power>=initial.demand.power*1.2);assert.ok(improved.scrap>legacy.scrap+16);
  assert.ok(Math.abs(improved.scrap-legacy.scrap-16.8)<1e-9);
  assert.equal(x.api.idle(x.api.model(x.v),{}),null);
});
test('组合补岗：不牺牲眼前供给，不使用预留席位，关闭生产优化仍按原规则就业',()=>{
  for(const mode of ['urgent','reserved','return-seat','disabled','one-resource']){
    const x=complementaryIdleWorkers(),campaign={},m=x.api.model(x.v);
    if(mode==='urgent')m.demand.power=(m.production.power+17.5)/1.2;
    if(mode==='reserved')campaign.reserved=[6];
    if(mode==='return-seat')campaign.trainingDestinations=[{id:1,room:4}];
    if(mode==='disabled')x.context.shelterOptimize=false;
    if(mode==='one-resource')x.s.resources.scrap=m.caps.scrap;
    const job=x.api.idle(m,campaign);assert.equal(job.id,5,mode);assert.equal(job.room,1,mode);
    assert.equal(job.idleAllocation,undefined,mode);
  }
});
test('组合补岗：按最新人员和装备重算，组合预测不写入跨轮执行计划',()=>{
  const x=complementaryIdleWorkers(),saved=JSON.stringify(x.context.shelterState),first=x.api.idle(x.api.model(x.v),{});
  assert.equal(first.id,6);assert.ok(first.idleAllocation.localChecks<=2000);
  assert.equal(JSON.stringify(x.context.shelterState),saved);
  x.p.away={kind:'explore'};
  const only=x.api.idle(x.api.model(x.v),{});assert.equal(only.id,6);assert.equal(only.idleAllocation,undefined);
  x.p.away=null;x.s.items.push({id:99,slot:'outfit',bonus:{end:15}});x.s.residents[5].outfitId=99;
  const geared=x.api.idle(x.api.model(x.v),{});assert.equal(geared.id,5);assert.equal(geared.room,1);
  assert.equal(JSON.stringify(x.context.shelterState),saved);
});
test('组合补岗：200人口只做有界即时分配，不改动原生产岗位或输入',t=>{
  const x=complementaryIdleWorkers();
  const seed=x.p;x.s.residents=x.s.residents.slice(0,4);
  for(let i=0;i<196;i++)x.s.residents.push({...structuredClone(seed),id:100+i,name:'待就业'+i,roomId:null,
    stats:{str:i%11,end:(i*7)%11,agi:(i*3)%11,per:(i*5)%11,cha:5,int:5,lck:5}});
  const templates=x.s.rooms.slice(0,4);
  x.s.rooms.push(...Array.from({length:36},(_,i)=>({...templates[i%4],id:1000+i,width:3,floor:5+Math.floor(i/2),col:i%2?5:2})));
  const m=x.api.model(x.v),before=JSON.stringify(x.v),started=performance.now(),job=x.api.idle(m,{});
  assert.ok(job?.id>=100);assert.ok(job.gain>0);assert.equal(JSON.stringify(x.v),before);
  if(job.idleAllocation)assert.ok(job.idleAllocation.localChecks<=2000);
  t.diagnostic('200 population immediate assignment: '+(performance.now()-started).toFixed(1)+' ms');
});
test('闲置就业：保护家庭、预留返岗席位、未知请求、暂停和紧急动作',()=>{
  for(const why of ['family','seat','pending','held','off','defense','heal','pair','swap']){
    const x=setup(),plan={reserved:[5]};
    if(why==='family'){
      x.context.shelterState.families=[{a:5,b:6,room:5}];
      x.context.shelterState.pair={a:5,b:6,room:5};
    }
    if(why==='seat')plan.trainingDestinations=[{id:5,room:4}];
    if(why==='pending')x.context.shelterPending={kind:'assign'};
    if(why==='held')x.context.shelterStaffHold=true;
    if(why==='off')x.context.shelterStaffMode='off';
    if(why==='defense')plan.defense={busy:true};
    if(why==='heal')plan.choice={kind:'stimpak'};
    if(why==='pair')x.context.shelterState.pair={a:1,b:2};
    if(why==='swap')x.context.shelterState.swap={step:0};
    assert.equal(x.api.idle(x.api.model(x.v),plan),null,why);
  }
});
