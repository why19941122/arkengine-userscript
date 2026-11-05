import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(name=>source.match(new RegExp(`const ${name} =?[^;]*;`.replace(' =?','\\s*=')))[0]).join('\n');
const code=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const actions=source.slice(source.indexOf('  function shelterRequestAction('),source.indexOf('  function shelterSubmit('));
const api=vm.runInNewContext(`${declarations}\n${code}\n${actions}\n({model:shelterModel,plan:shelterCampaignPlan,development:shelterDevelopmentPlan,combat:shelterCombat,
  chance:shelterQuestChance,defaults:campaignDefaults,proof:shelterCampaignProof,confirmed:shelterCampaignConfirmed,valid:validCampaignPending,record:validCampaignRecord,action:shelterRequestAction,matches:shelterActionMatches})`,{
  objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
const now=2_000_000_000;

const cfg=extra=>({...api.defaults,...extra});
const run=(v,c={},record={})=>api.plan(api.model(v),cfg(c),record,14);
test('综合发展：全部开关默认关闭，无人员预留和原生操作',()=>{
  const v=campaignView(),before=JSON.stringify(v),plan=run(v);assert.equal(plan.enabled,false);assert.equal(plan.actions.length,0);assert.equal(plan.reserved.length,0);assert.equal(JSON.stringify(v),before);
});
test('综合发展：公开战力和三关成功率，服装封顶且幸运不改变战力',()=>{
  const v=campaignView(),p=v.state.residents[3];assert.equal(api.combat(v.state,p),40);
  assert.ok(Math.abs(api.chance(72,{difficulty:1,stages:3})-.69676)<.002);
  p.stats.lck=1;assert.equal(api.combat(v.state,p),40);
  v.state.items=[{id:1,slot:'weapon',damage:[3,7]},{id:2,slot:'outfit',bonus:{end:20}}];p.weaponId=1;p.outfitId=2;
  assert.equal(api.combat(v.state,p),59);v.state.items[0].damage=[3];assert.equal(api.combat(v.state,p),null);
});
test('综合发展：汽水探险先留人，周任务不占同一人，整组不抽空供应且不改状态',()=>{
  const v=campaignView(),before=JSON.stringify(v),p=run(v,{explore:true,quests:true});
  const e=p.actions.find(a=>a.kind==='explore-start'),q=p.actions.find(a=>a.kind==='quest-start');assert.ok(e);assert.ok(q);
  assert.ok(!q.team.includes(e.id));assert.deepEqual([...e.targets.slice(1)],[0,2]);assert.equal(q.team.length,2);
  assert.ok(!p.reserved.some(id=>id<=3));assert.equal(new Set(p.reserved).size,p.reserved.length);assert.equal(JSON.stringify(v),before);
});
test('综合发展：取同战力时优先低离岗损失，缺供应/缺针/掉落关闭均不新派遣',()=>{
  const v=campaignView(),p=run(v,{explore:true});assert.equal(p.choice.id,5);
  for(const modify of [v=>v.state.resources.stimpak=3,v=>v.drops.enabled=false,v=>v.state.rooms.find(r=>r.type==='diner').unpowered=true]){
    const v=campaignView();modify(v);assert.equal(run(v,{explore:true}).actions.some(a=>a.kind==='explore-start'),false);
  }
});
test('综合发展：已配对、儿童、伤员与待产父母不出发，不挪手动特殊岗位',()=>{
  const v=campaignView();v.state.residents[3].romance={partnerId:5};v.state.residents[4].romance={partnerId:4};v.state.residents[5].hp=100;
  assert.equal(run(v,{explore:true}).actions.some(a=>a.kind==='explore-start'),false);
  v.state.residents[5].hp=142;v.state.residents[5].adultAt=now+1;assert.equal(run(v,{explore:true}).choice,null);
});
test('综合发展：只召回有原出发记录的普通探险，伤势优先于计划时长',()=>{
  const v=campaignView(),p=v.state.residents[3];p.away={kind:'explore'};p.hp=50;
  v.state.explorers=[{id:11,residentId:p.id,tier:0,abyss:false,startedAt:now-3600000,recalledAt:null,returnAt:null}];
  assert.equal(run(v,{explore:true}).actions.some(a=>a.kind==='explore-recall'),false);
  assert.equal(run(v,{explore:true},{trips:[{id:11,resident:4,hours:6,at:now-3600000}]}).choice.kind,'explore-recall');
  v.state.explorers[0].abyss=true;assert.equal(run(v,{explore:true},{trips:[{id:11,resident:4,hours:6,at:now-3600000}]}).actions.some(a=>a.kind==='explore-recall'),false);
});
test('综合发展：周任务每周次数及六小时间隔跨刷新约束，新周恢复',()=>{
  const v=campaignView(),record={attempts:[{operation:'abc',week:v.env.week,quest:'w1',at:now-21600001}]};
  assert.equal(run(v,{quests:true},record).actions.length,0);assert.ok(run(v,{quests:true,attempts:2},record).choice);
  record.attempts[0].at=now-100;assert.equal(run(v,{quests:true,attempts:2},record).actions.length,0);
  v.env.week='2026-W46';assert.ok(run(v,{quests:true},record).choice);
});
test('综合发展：训练只安排一人，短板增长后轮换，保留已有进度且六小时内不再次入训',()=>{
  const v=campaignView(),p=v.state.residents[4];p.stats.end=3;p.hp=120;
  v.state.rooms.push({id:30,type:'training',trainStat:'end',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
  let plan=run(v,{training:true,trainTarget:9});assert.equal(plan.choice.kind,'assign');assert.equal(plan.choice.room,30);
  const person=v.state.residents.find(r=>r.id===plan.choice.id);person.roomId=30;
  const record={roles:[{id:person.id,room:30,role:'training',stat:'end',base:person.stats.end,at:now-3600000}]};
  plan=run(v,{training:true,trainTarget:9},record);assert.equal(plan.choice,null);assert.ok(plan.reserved.includes(person.id));
  record.roles[0].at=now-10800000;person.training=.5;assert.equal(run(v,{training:true,trainTarget:9},record).choice,null);
  person.training=0;assert.equal(run(v,{training:true,trainTarget:9},record).choice.role,'training-release');person.training=.5;
  person.stats.end++;plan=run(v,{training:true,trainTarget:9},record);assert.equal(plan.choice.role,'training-release');
  person.roomId=null;record.trainingRest=[{id:person.id,at:now}];record.roles=[];assert.notEqual(run(v,{training:true,trainTarget:9},record).choice?.id,person.id);
});
test('综合发展：医疗保留线和用针间隔，电台尊重目标与15人防御',()=>{
  const v=campaignView();v.state.residents[4].hp=30;
  const plan=run(v,{medical:true});assert.equal(plan.choice.kind,'stimpak');
  assert.notEqual(run(v,{medical:true},{heals:[{id:5,at:now}]}).choice?.kind,'stimpak');
  v.state.resources.stimpak=2;assert.notEqual(run(v,{medical:true}).choice?.kind,'stimpak');
  const radio=run(v,{radio:true});assert.ok(radio.projects.some(p=>p.type==='radio'));
  assert.equal(api.plan(api.model(v),cfg({radio:true}),{},6).projects.some(p=>p.type==='radio'),false);
});
test('综合发展：预留人手驱动医疗/训练建设，下挖为探险位不要求房间填满',()=>{
  const v=campaignView();v.state.resources.stimpak=3;
  let campaign=run(v,{medical:true}),plan=api.development(api.model(v),14,campaign);
  assert.ok(campaign.projects.some(p=>p.type==='medbay'));assert.equal(plan.next.project.type,'medbay');
  v.state.resources.stimpak=9;campaign=run(v,{explore:true});plan=api.development(api.model(v),14,campaign);
  assert.ok(campaign.projects.some(p=>p.milestone===8));assert.ok(plan.candidates.some(c=>c.kind==='dig'&&c.floor===8));
  const reserved=new Set(campaign.reserved);assert.ok(campaign.projects.filter(p=>p.person).every(p=>!reserved.has(p.person)));
});
test('综合发展：武器和战斗服只用闲置装备，不能把别人的装备抢走',()=>{
  const v=campaignView();v.state.items=[{id:1,slot:'weapon',damage:[4,8]},{id:2,slot:'weapon',damage:[99,99]}];v.state.residents[0].weaponId=2;
  const plan=run(v,{explore:true,combatGear:true});assert.equal(plan.choice.kind,'equip');assert.equal(plan.choice.slot,'weapon');assert.equal(plan.choice.item,1);
});
test('综合发展：新出发需要原请求回执，错误账号、键、目标和过早状态不确认',()=>{
  const v=campaignView(),choice=run(v,{explore:true}).choice;
  const p={id:'operation',kind:choice.kind,targets:choice.targets,vaultNo:77,campaignKey:'native-key',before:{serverTime:now,campaign:{choice,ids:[],hp:142}}};
  const action=api.action(p.kind,p.targets),request={idempotencyKey:'native-key',action};
  v.state.explorers=[{id:99,residentId:choice.id,tier:0,abyss:false,startedAt:now,stimpaks:2}];v.state.residents.find(r=>r.id===choice.id).away={kind:'explore'};
  assert.equal(api.confirmed(p,api.model(v)),false);assert.equal(api.valid(p),true);
  const proof=api.proof(p,200,request,{view:v});assert.ok(proof);p.result={campaignProof:proof};assert.equal(api.confirmed(p,api.model(v)),true);
  assert.equal(api.proof(p,200,{...request,idempotencyKey:'wrong-key'},{view:v}),null);
  assert.equal(api.proof(p,200,{...request,action:{...action,abyss:true}},{view:v}),null);
  assert.equal(api.proof(p,503,request,{view:v}),null);
  v.serverTime--;assert.equal(api.confirmed(p,api.model(v)),false);v.serverTime++;v.vaultNo=78;assert.equal(api.confirmed(p,api.model(v)),false);
});
test('综合发展：周任务按同一人员集合绑定，原生勾选顺序不同可通过，重复队员或换人拒绝',()=>{
  const expected={type:'quest_start',questId:'w1',team:[6,4]};
  assert.equal(api.matches({...expected,team:[4,6]},expected),true);
  for(const team of [[4,4],[4,5],[4],[4,6,7],['4',6]])assert.equal(api.matches({...expected,team},expected),false);
});
test('综合发展：未知周任务领取不凭列表消失确认，有回执后不要求队员永远闲置',()=>{
  const v=campaignView(),choice={kind:'quest-claim',targets:[22],team:[4,5]},p={id:'claim',kind:choice.kind,targets:choice.targets,vaultNo:77,campaignKey:'native-key',
    before:{serverTime:now,campaign:{choice,ids:[],hp:0}}};
  assert.equal(api.confirmed(p,api.model(v)),false);
  const request={idempotencyKey:'native-key',action:api.action(p.kind,p.targets)},proof=api.proof(p,200,request,{view:v});assert.ok(proof);
  p.result={campaignProof:proof};v.state.residents[3].away={kind:'quest'};assert.equal(api.confirmed(p,api.model(v)),true);
  assert.equal(api.proof(p,200,request,{view:v}),null);
});
test('综合发展：医疗留人先于新派遣，装备准备不能延误受伤探险召回',()=>{
  const v=campaignView();v.state.resources.stimpak=5;
  v.state.rooms.push({id:30,type:'medbay',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
  let plan=run(v,{medical:true,explore:true});assert.equal(plan.choice.role,'medical');
  const nurse=plan.choice.id,trip=plan.actions.find(a=>a.kind==='explore-start');assert.ok(trip);assert.notEqual(trip.id,nurse);
  v.state.depth=8;v.state.residents[3].away={kind:'explore'};v.state.residents[3].hp=40;
  v.state.explorers=[{id:11,residentId:4,tier:0,abyss:false,startedAt:now-3600000,recalledAt:null,returnAt:null}];
  v.state.items=[{id:1,slot:'weapon',damage:[4,8]}];v.state.resources.stimpak=9;
  plan=run(v,{explore:true,combatGear:true},{trips:[{id:11,resident:4,hours:6,at:now-3600000}]});assert.equal(plan.choice.kind,'explore-recall');
});
test('综合发展：损坏的训练、治疗和任务记录不可被默认设置覆盖',()=>{
  const valid={roles:[],trips:[],attempts:[],heals:[],trainingRest:[]};assert.equal(api.record(valid),true);
  assert.equal(api.record({...valid,attempts:[{at:now,week:'week'}]}),false);
  assert.equal(api.record({...valid,roles:[{id:1,room:30,at:now,role:'training',stat:'unknown',base:3}]}),false);
  assert.equal(api.record({...valid,heals:[{id:1,at:-1}]}),false);
});
test('综合发展：电台招募预留新增一人口的口粮，不能只按现有人口刚好够用',()=>{
  const v=campaignView(),m=api.model(v);
  m.production.food=m.production.water=7.5; // 当前6人1.2余量够，新增1人需8.4。
  const plan=api.plan(m,cfg({radio:true}),{},14);
  assert.equal(plan.projects.some(p=>p.type==='radio'),false);
  assert.equal(plan.actions.some(a=>a.role==='radio'),false);
});
