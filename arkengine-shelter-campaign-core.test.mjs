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
  growth:shelterQuestGrowth,value:shelterQuestValue,better:shelterQuestBetter,
  efficiency:shelterExploreEfficiency,chance:shelterQuestChance,loadout:shelterCombatLoadout,defaults:campaignDefaults,proof:shelterCampaignProof,confirmed:shelterCampaignConfirmed,valid:validCampaignPending,record:validCampaignRecord,action:shelterRequestAction,matches:shelterActionMatches,
  income:shelterIncomeReward,manualIncome:shelterManualIncomePending,sodaProof:shelterSodaProof,sodaReceipt:shelterSodaReceipt,sodaQuota:shelterSodaQuota,sodaLedger:shelterSodaLedger,sodaValid:validShelterSodaReceipts})`,{
  objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
const now=2_000_000_000;

const cfg=extra=>({...api.defaults,...extra});
test('手动收入前证据：缺少原状态、原房无整批、已领取奖励或付费档都不能生成领取凭据',()=>{
  const view=campaignView(),request={idempotencyKey:'manual-income-key',action:{type:'collect',roomId:1}};
  assert.equal(api.manualIncome(null,request),null);
  view.state.rooms[0].stored=0;assert.equal(api.manualIncome(api.model(view),request),null);
  view.state.rooms[0].stored=63;assert.equal(api.manualIncome(api.model(view),request).targets[0],1);
  request.action={type:'claim_objective',index:0};assert.ok(api.manualIncome(api.model(view),request));
  view.state.daily.claimed=[0];assert.equal(api.manualIncome(api.model(view),request),null);
  request.action={type:'claim_season',tier:1,premium:true};assert.equal(api.manualIncome(api.model(view),request),null);
  request.action={type:'upgrade',roomId:1};assert.equal(api.manualIncome(api.model(view),request),null);
});
test('收入统计核心：只解析原领取回执，支持数字顺序与千分位，不拿错误或预估金额入账',()=>{
  const view=campaignView();view.state.tutorial={claimed:[1]};
  const p={id:'income-one',kind:'tutorial',targets:[1],vaultNo:77,before:{serverTime:now-1000}};
  const request={idempotencyKey:'income-native-key',action:{type:'claim_tutorial',step:1}};
  const read=(message,extra={})=>JSON.parse(JSON.stringify(api.income(p,200,request,{view,result:{message},...extra})));
  assert.deepEqual(read('收到30 废料 · 2 零件'),{'避难所废料':30,'避难所零件':2});
  assert.deepEqual(read('奖励：废料 +1,234 · 零件 2 · 3瓶汽水'),{'避难所废料':1234,'避难所零件':2,'避难所汽水':3});
  for(const message of ['', '成功', '预计收到 30 废料', '收到 1,23 废料', '收到 -30 废料', '收到 30 废料，消耗 2 零件'])
    assert.deepEqual(read(message),{'避难所金额待核对':1},message);
  const body={view,result:{message:'收到 30 废料'}};
  for(const status of [0,503])assert.equal(api.income(p,status,request,body),null);
  assert.equal(read('收到 30 废料',{code:'retry'}),null);
  assert.equal(api.income(p,200,{...request,action:{type:'claim_tutorial',step:2}},body),null);
  assert.equal(api.income(p,200,request,{...body,view:{...view,vaultNo:88}}),null);
  view.state.tutorial.claimed=[];assert.equal(api.income(p,200,request,body),null);
});
const run=(v,c={},record={})=>api.plan(api.model(v),cfg(c),record,14);
test('收入统计核心：每日与成就必须对应已领取目标，日切后旧每日回执不归入新日奖励',()=>{
  const view=campaignView();view.state.daily.claimed=[0];view.state.achievements=['first'];
  const p={id:'income-daily',kind:'daily',targets:[0],vaultNo:77,before:{serverTime:now-1000,day:'2026-10-10'}};
  const request={idempotencyKey:'income-native-key',action:{type:'claim_objective',index:0}},body={view,result:{message:'收到 160 废料 · 1 零件'}};
  assert.equal(api.income(p,200,request,body)['避难所废料'],160);
  view.state.daily.day='2026-10-11';assert.equal(api.income(p,200,request,body),null);
  p.kind='achievement';p.targets=['first'];request.action={type:'claim_achievement',id:'first'};
  assert.equal(api.income(p,200,request,body)['避难所零件'],1);
  request.action.id='other';assert.equal(api.income(p,200,request,body),null);
});
test('收入统计核心：探险汽水字段与明文不重复相加，部分已知不掩盖其余金额未知',()=>{
  const view=campaignView(),p={id:'income-explore',kind:'explore',targets:[11,5],vaultNo:77,exploreKey:'income-native-key',before:{serverTime:now-1000}};
  const request={idempotencyKey:'income-native-key',action:{type:'explore_claim',explorerId:11}},body={view,result:{message:'探险归来：50 废料 · 1 汽水',sodaDropped:1}};
  let reward=api.income(p,200,request,body);assert.equal(reward['避难所废料'],50);assert.equal(reward['避难所汽水'],1);
  body.result.message='探险归来';reward=api.income(p,200,request,body);
  assert.equal(reward['避难所汽水'],1);assert.equal(reward['避难所金额待核对'],1);
  view.state.residents.find(r=>r.id===5).away={kind:'explore'};assert.equal(api.income(p,200,request,body),null);
});
test('收入统计核心：周任务须原请求和队员释放证据，队伍消失本身不能产生收入',()=>{
  const view=campaignView(),p={id:'income-quest',kind:'quest-claim',targets:[99],vaultNo:77,campaignKey:'income-native-key',
    before:{serverTime:now-1000,campaign:{choice:{team:[5,6]}}}};
  const request={idempotencyKey:'income-native-key',action:{type:'quest_claim',runId:99}},body={view,result:{message:'小队归来：200 废料 · 3 零件'}};
  assert.equal(api.income(p,200,request,body)['避难所废料'],200);
  assert.equal(api.income(p,200,{...request,idempotencyKey:'different-key'},body),null);
  view.state.residents.find(r=>r.id===5).away={kind:'quest'};assert.equal(api.income(p,200,request,body),null);
});
function guardedView() {
  const v=campaignView(),s=v.state;
  for(let i=7;i<=15;i++)s.residents.push({...structuredClone(s.residents[0]),id:i,name:`儿童${i}`,roomId:null,adultAt:now+86400000});
  s.items=[{id:71,slot:'weapon',tier:1,name:'留守武器',damage:[20,20]}];s.residents[4].weaponId=71;
  return v;
}
test('出发前留守：主力不能带走过半力量武器指标，但可改派其他居民且不占生产岗位',()=>{
  const v=guardedView(),p=run(v,{explore:true,defense:true});
  const trip=p.actions.find(a=>a.kind==='explore-start');assert.ok(trip);
  assert.notEqual(trip.id,5);assert.ok(!p.actions.some(a=>a.role==='defense'));
  assert.match(p.notes.join(' '),/留守/);assert.equal(v.state.residents[4].roomId,null);
});
test('出发前留守：未满15不套掠夺者门槛，待产计入门槛且人工关闭防守尊重设置',()=>{
  const v=guardedView();v.state.residents.pop();
  assert.equal(run(v,{explore:true,defense:true}).actions.find(a=>a.kind==='explore-start').id,5);
  v.state.births=[{roomId:5,dueAt:now+100000}];
  assert.notEqual(run(v,{explore:true,defense:true}).actions.find(a=>a.kind==='explore-start')?.id,5);
  assert.equal(run(v,{explore:true,defense:false}).actions.find(a=>a.kind==='explore-start').id,5);
});
test('出发前留守：返程人员不算到家，多队共用留守额度而非各自通过',()=>{
  const v=guardedView(),s=v.state;s.residents[4].away={kind:'explore'};
  s.explorers=[{id:11,residentId:5,tier:0,abyss:false,startedAt:now-10000,recalledAt:now-1000,returnAt:now+5000}];
  assert.ok(!run(v,{explore:true,quests:true,defense:true}).actions.some(a=>['explore-start','quest-start'].includes(a.kind)));
  s.residents[4].away=null;s.explorers=[];s.items=[];s.residents[4].weaponId=null;s.depth=24;
  const p=run(v,{explore:true,quests:true,defense:true,stimpaks:0,guardResidents:4,guardPowerPercent:50});
  const departed=p.actions.flatMap(a=>a.kind==='explore-start'?[a.id]:a.kind==='quest-start'?a.team:[]);
  assert.ok(departed.length>0);assert.ok(departed.length<=2);assert.equal(new Set(departed).size,departed.length);
});
test('出发前留守：伤员和其他事故中人员不计可增援人数，低于门槛不阻断治疗',()=>{
  const v=guardedView(),s=v.state;s.residents[4].hp=20;
  const p=run(v,{explore:true,medical:true,defense:true,guardResidents:6});
  assert.ok(!p.actions.some(a=>a.kind==='explore-start'));assert.ok(p.actions.some(a=>a.kind==='stimpak'));
  assert.match(p.notes.join(' '),/留守/);
});
test('施工期间养成：发电站升级且库存足够等到首批电力时，不释放正常训练人选',()=>{
  const v=campaignView(),s=v.state;
  Object.assign(s.rooms[0],{level:1,upgradeAt:now+2*3600000});
  s.rooms.push({...s.rooms[0],id:90,type:'training',trainStat:'agi',level:1,floor:2,col:4,upgradeAt:null});
  Object.assign(s.residents[4],{roomId:90});s.residents[4].stats.agi=3;
  const record={roles:[{id:5,room:90,role:'training',stat:'agi',base:3,at:now-1000}]};
  let p=run(v,{training:true,trainTarget:6},record);
  assert.ok(!p.actions.some(a=>a.role==='training-release'&&a.id===5));assert.ok(p.reserved.includes(5));
  assert.match(p.notes.join(' '),/施工.*首批/);
  s.resources.power=1;p=run(v,{training:true,trainTarget:6},record);
  assert.ok(p.actions.some(a=>a.role==='training-release'&&a.id===5));
  s.resources.power=400;s.residents[0].away={kind:'explore'};
  assert.ok(run(v,{training:true,trainTarget:6},record).actions.some(a=>a.role==='training-release'&&a.id===5),'外出工人不能算完工产能');
});
test('汽水额度回执：仅原领取成功响应可计数，错误请求、旧凭据、错误账号和未知数量不计',()=>{
  const v=campaignView(),p={id:'claim-one',kind:'explore',targets:[11,5],vaultNo:77,exploreKey:'native-key',before:{serverTime:now-1000}};
  const request={idempotencyKey:'native-key',action:{type:'explore_claim',explorerId:11}},body={view:v,result:{sodaDropped:1}};
  const proof=api.sodaProof(p,200,request,body);assert.equal(proof.amount,1);
  p.result={sodaProof:proof,proof};assert.equal(api.sodaReceipt(p).amount,1);
  for(const amount of [undefined,null,-1,1.2,NaN,Infinity,'1'])assert.equal(api.sodaProof(p,200,request,{...body,result:{sodaDropped:amount}}),null);
  for(const status of [503,403,429])assert.equal(api.sodaProof(p,status,request,body),null);
  assert.equal(api.sodaProof(p,200,request,{...body,code:'retry'}),null);
  assert.equal(api.sodaProof(p,200,{...request,idempotencyKey:'wrong-key'},body),null);
  assert.equal(api.sodaProof(p,200,{...request,action:{...request.action,explorerId:12}},body),null);
  assert.equal(api.sodaProof({...p,kind:'quest-claim'},200,request,body),null);
  assert.equal(api.sodaProof(p,200,request,{...body,view:{...v,vaultNo:88}}),null);
  assert.equal(api.sodaProof(p,200,request,{...body,view:{...v,serverTime:now-2000}}),null);
  assert.equal(api.sodaReceipt({...p,exploreKey:'wrong-key'}),null);
  assert.equal(api.sodaReceipt({...p,id:'other-operation'}),null);
  v.state.residents[4].away={kind:'explore'};
  assert.equal(api.sodaProof(p,200,request,body),null,'已有旧成功凭据不能证明本次未释放人员的响应');
  v.state.residents[4].away=null;
  assert.equal(api.sodaProof(p,200,request,{...body,result:{sodaDropped:0}}).amount,0,'明确零瓶可确认，但不能推断为达额');
});
test('汽水额度账本：刷新重放只计一次，损坏记录拒绝，7日裁剪不删未来回执',()=>{
  const receipt={operation:'claim-one',vaultNo:77,explorerId:11,residentId:5,at:now,amount:1};
  const entries=api.sodaLedger([],receipt,now),saved=JSON.parse(JSON.stringify(entries));
  assert.equal(api.sodaLedger(saved,receipt,now+1000).length,1);assert.equal(saved.length,1);
  assert.equal(api.sodaLedger(saved,{...receipt,operation:'zero',amount:0},now).length,1);
  assert.equal(api.sodaLedger(saved,{...receipt,operation:'new',at:now+8*86400000},now+8*86400000).length,1);
  assert.equal(api.sodaLedger(saved,receipt,now-1000).length,1);
  assert.equal(api.sodaValid([...saved,...saved]),false);
  for(const change of [{amount:-1},{amount:1.2},{at:NaN},{vaultNo:0},{operation:''}])assert.equal(api.sodaValid([{...receipt,...change}]),false);
  assert.throws(()=>api.sodaLedger([{...receipt,amount:-1}],receipt,now));
});
test('策略纠正：近24小时领取只作统计提示，不生成等待时间或阻止派遣',()=>{
  const v=campaignView(),receipts=[{operation:'two',vaultNo:77,explorerId:12,residentId:6,at:now-1000,amount:2},
    {operation:'one',vaultNo:77,explorerId:11,residentId:5,at:now-2000,amount:1}];
  const q=api.sodaQuota(api.model(v),receipts);
  assert.equal(q.observed,3);assert.equal(q.blocked,false);assert.equal(q.resumeAt,null);
  assert.equal(q.reason,'observed-limit-advisory');
  v.drops.perUserDaily=3;assert.equal(api.sodaQuota(api.model(v),receipts).blocked,false);
  v.drops.perUserDaily=4;assert.equal(api.sodaQuota(api.model(v),receipts).blocked,false);
  assert.equal(api.sodaQuota(api.model(v),[{}]).reason,'invalid-receipts');
});
test('策略纠正：已确认领取达到上限仍可新派，继续周任务并保留统计',()=>{
  const v=campaignView();v.drops.perUserDaily=1;
  const record={sodaReceipts:[{operation:'claim-one',vaultNo:77,explorerId:11,residentId:5,at:now-1000,amount:1}]};
  let p=run(v,{explore:true,quests:true,sodaEfficiency:true},record);
  assert.ok(p.actions.some(a=>a.kind==='explore-start'));assert.ok(p.actions.some(a=>a.kind==='quest-start'));
  assert.equal(p.sodaQuota.observed,1);assert.match(p.notes.join(' '),/24小时/);
  assert.ok(run(v,{explore:true,sodaEfficiency:false},record).actions.some(a=>a.kind==='explore-start'));
  v.drops.perUserDaily=2;
  assert.ok(run(v,{explore:true,sodaEfficiency:true},record).actions.some(a=>a.kind==='explore-start'));
});
test('汽水额度：零或未知额度不新派汽水探险，未记录领取不冒充已拿满',()=>{
  const v=campaignView();
  for(const limit of [0,undefined,null,-1,NaN,1.5,'1']){
    v.drops.perUserDaily=limit;
    assert.ok(!run(v,{explore:true,sodaEfficiency:true}).actions.some(a=>a.kind==='explore-start'));
  }
  v.drops.perUserDaily=1;
  const p=run(v,{explore:true,sodaEfficiency:true});
  assert.ok(p.actions.some(a=>a.kind==='explore-start'));assert.equal(p.sodaQuota.historyComplete,false);
});
test('策略纠正：日历换日不清领取统计，旧快照仍等待数据同步',()=>{
  const v=campaignView();v.drops.perUserDaily=1;
  const record={sodaReceipts:[{operation:'claim-one',vaultNo:77,explorerId:11,residentId:5,at:now-1000,amount:1}]};
  v.state.daily.day='2099-01-01';
  assert.ok(run(v,{explore:true,sodaEfficiency:true},record).actions.some(a=>a.kind==='explore-start'));
  assert.equal(run(v,{explore:true,sodaEfficiency:true},record).sodaQuota.observed,1);
  v.serverTime=now-2000;
  assert.ok(!run(v,{explore:true,sodaEfficiency:true},record).actions.some(a=>a.kind==='explore-start'),'旧服务器快照不能忽略较新回执');
  v.serverTime=now-1000+86400000;
  assert.ok(run(v,{explore:true,sodaEfficiency:true},record).actions.some(a=>a.kind==='explore-start'));
  v.serverTime=now;record.sodaReceipts[0].vaultNo=88;
  assert.ok(run(v,{explore:true,sodaEfficiency:true},record).actions.some(a=>a.kind==='explore-start'),'其他避难所不占额度');
});
test('策略纠正：历史领取不取消医疗需求和探险扩位，原行程仍召回',()=>{
  const v=campaignView(),s=v.state;v.drops.perUserDaily=1;
  s.resources.stimpak=4;s.rooms.push({id:30,type:'medbay',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
  s.residents[5].roomId=30;s.residents[4].away={kind:'explore'};
  s.explorers=[{id:11,residentId:5,tier:0,abyss:false,startedAt:now-6*3600000,recalledAt:null,returnAt:null}];
  const record={roles:[{id:6,room:30,role:'medical',at:now-2000}],trips:[{id:11,resident:5,hours:6,at:now-6*3600000}],
    sodaReceipts:[{operation:'claim-one',vaultNo:77,explorerId:10,residentId:4,at:now-1000,amount:1}]};
  const p=run(v,{explore:true,medical:true,sodaEfficiency:true},record);
  assert.ok(p.actions.some(a=>a.kind==='explore-recall'));assert.ok(!p.actions.some(a=>a.role==='medical-release'));
  assert.ok(!p.events.includes(86400000-1000));
  s.resources.stimpak=9;
  assert.ok(run(v,{explore:true,sodaEfficiency:true},record).projects.some(p=>p.type==='elevator'));
});
test('策略纠正：未满级队员的周任务成长收益不能被纯废料亏损筛掉',()=>{
  const v=campaignView(),s=v.state;s.season.points=4500;
  Object.assign(s.rooms.find(r=>r.id===4),{width:2,floor:2,col:5});
  for(const p of s.residents.filter(p=>p.id>=4))p.roomId=4;
  v.env.quests[0].rewards={scrap:0,parts:0,itemTier:null,seasonPoints:0};
  const action=run(v,{quests:true}).actions.find(a=>a.kind==='quest-start');assert.ok(action);
  assert.ok(action.assessment.growth.expectedUsefulXp>0);assert.ok(action.assessment.scrapNetOnSuccess<0);
  assert.match(action.reason,/经验/);assert.match(action.reason,/未计返程和疗伤/);
});
test('策略纠正：经验按逐关概率累计，后续失败不抹掉前关经验',()=>{
  const q={difficulty:1,stages:2,stageMinutes:60},team=[{xp:0}],before=JSON.stringify(team);
  const growth=api.growth(8.8,q,team),first=.5,second=.5/2.05;
  assert.ok(Math.abs(growth.expectedUsefulXp-3*(first+second))<1e-12);
  assert.ok(growth.expectedUsefulXp>6*second,'不能把所有经验都乘以完整通关率');
  assert.equal(growth.usefulXpOnSuccess,6);assert.equal(growth.xpRate,growth.expectedUsefulXp/2);
  assert.equal(JSON.stringify(team),before);
});
test('策略纠正：每名队员分别封顶50级，只差1经验者只计首关1点增长',()=>{
  const q={difficulty:1,stages:2,stageMinutes:60},growth=api.growth(8.8,q,[{xp:0},{xp:7202},{xp:7203},{xp:8000}]);
  assert.ok(Math.abs(growth.expectedUsefulXp-(4*.5+3*.5/2.05))<1e-12);
  assert.equal(growth.usefulXpOnSuccess,7);assert.equal(growth.xpRate,growth.expectedUsefulXp/8);
  assert.equal(api.growth(8.8,q,[{xp:7203}]).expectedUsefulXp,0);
  assert.equal(api.growth(8.8,q,[{xp:7202}]).expectedUsefulXp,.5);
});
test('策略纠正：同等资源才比较经验，不替代积分装备材料优先序',()=>{
  const q={id:'w1',difficulty:1,stages:2,stageMinutes:60,rewards:{scrap:0,parts:0,seasonPoints:0,itemTier:null}};
  const make=(rewards,xp)=>({q,team:[{xp}],cost:0,chance:.8,value:api.value({...q,rewards:{...q.rewards,...rewards}},.8,1,0,0,api.growth(80,q,[{xp}]))});
  const young=make({},0),full=make({},7203);
  assert.equal(api.better(young,full),true);assert.equal(api.better(full,young),false);
  for(const rewards of [{seasonPoints:1},{itemTier:0},{parts:1},{scrap:1}]){
    const resources=make(rewards,7203);assert.equal(api.better(resources,young),true);assert.equal(api.better(young,resources),false);
  }
});
test('策略纠正：经验计算拒绝损坏属性和时间，成长不绕过奖励校验或胜率门槛',()=>{
  const q={difficulty:1,stages:2,stageMinutes:60};
  for(const change of [{difficulty:0},{difficulty:NaN},{stages:0},{stages:51},{stageMinutes:0},{stageMinutes:Infinity}])
    assert.equal(api.growth(80,{...q,...change},[{xp:0}]),null);
  for(const xp of [-1,undefined,Infinity,NaN])assert.equal(api.growth(80,q,[{xp}]),null);
  assert.equal(api.growth(Infinity,q,[{xp:0}]),null);assert.equal(api.growth(80,q,[]),null);
  const v=campaignView();v.env.quests[0].rewards.parts=undefined;
  assert.ok(!run(v,{quests:true}).actions.some(a=>a.kind==='quest-start'));
  v.env.quests[0].rewards.parts=0;v.env.quests[0].difficulty=1000;
  assert.ok(!run(v,{quests:true,chance:99}).actions.some(a=>a.kind==='quest-start'));
});
test('收益完善：短时汽水行程可以持久绑定，半小时到24小时之外仍拒绝',()=>{
  for(const minutes of [30,90,180,360,1440]){
    const v=campaignView();v.drops.minMinutes=minutes;
    const choice=run(v,{explore:true,sodaEfficiency:true}).choice;
    const p={id:'short-trip',kind:choice.kind,targets:choice.targets,vaultNo:77,
      before:{serverTime:now,campaign:{choice,ids:[],hp:142}}};
    assert.equal(choice.hours,minutes/60);assert.equal(api.valid(p),true);
    for(const hours of [0,.49,24.01,NaN,Infinity]){
      assert.equal(api.valid({...p,before:{...p.before,campaign:{...p.before.campaign,choice:{...choice,hours}}}}),false);
    }
  }
});
test('收益完善：满级且满赛季的纯废料任务不抵离岗损失时跳过，空闲人选或有效积分仍可出发',()=>{
  const v=campaignView(),s=v.state;s.season.points=4500;
  for(const p of s.residents){p.xp=7203;p.hp=394;}
  for(const p of s.residents.filter(p=>p.id>=4))p.roomId=4;
  Object.assign(s.rooms.find(r=>r.id===4),{width:2,floor:2,col:5});
  v.env.quests[0].rewards={scrap:1,parts:0,itemTier:null,seasonPoints:20};
  const before=JSON.stringify(v),p=run(v,{quests:true});
  assert.ok(!p.actions.some(a=>a.kind==='quest-start'));assert.match(p.notes.join(' '),/离岗/);
  assert.equal(JSON.stringify(v),before);
  s.residents[4].roomId=null;s.residents[5].roomId=null;
  assert.ok(run(v,{quests:true}).actions.some(a=>a.kind==='quest-start'),'有零废料离岗成本的人选，正收益任务可选');
  for(const p of s.residents.filter(p=>p.id>=4))p.roomId=4;
  s.season.points=4499;assert.ok(run(v,{quests:true}).actions.some(a=>a.kind==='quest-start'),'仍需有效积分时沿用积分优先');
  s.season.points=4500;v.env.quests[0].rewards.parts=1;
  assert.ok(run(v,{quests:true}).actions.some(a=>a.kind==='quest-start'),'未给零件虚构废料兑换价');
});
test('收益完善：满级队伍没有任何可用奖励时不派队，不计一次尝试',()=>{
  const v=campaignView();v.state.season.points=4500;
  for(const p of v.state.residents){p.xp=7203;p.hp=394;}
  v.env.quests[0].rewards={scrap:0,parts:0,itemTier:null,seasonPoints:20};
  assert.equal(run(v,{quests:true}).actions.some(a=>a.kind==='quest-start'),false);
  v.env.quests[0].rewards.itemTier=0;
  assert.equal(run(v,{quests:true}).actions.some(a=>a.kind==='quest-start'),true,'0档装备也是奖励');
});
test('收益完善：失败可能提前结束，不因全程成本减期望奖励为负而拒绝成功时有净废料的任务',()=>{
  const v=campaignView();v.state.season.points=4500;
  v.state.residents[4].roomId=5;v.state.residents[5].roomId=5;
  const q=v.env.quests[0],loss=api.model(v).production.scrap*q.stages*q.stageMinutes/60;
  q.rewards={scrap:Math.ceil(loss)+1,parts:0,itemTier:null,seasonPoints:0};
  const p=run(v,{quests:true,chance:50}).actions.find(a=>a.kind==='quest-start');
  assert.ok(p);assert.deepEqual([...p.team],[4]);
  assert.ok(p.assessment.scrapRate<0);assert.ok(p.assessment.scrapNetOnSuccess>0);
});
test('收益完善：医疗只为有效探险补双程携针，关闭探险或零汽水概率时释放自动护士',()=>{
  const v=campaignView(),s=v.state;s.resources.stimpak=4;
  s.rooms.push({id:30,type:'medbay',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
  s.residents[4].roomId=30;
  const record={roles:[{id:5,room:30,role:'medical',at:now-1000}]};
  assert.ok(run(v,{medical:true},record).actions.some(a=>a.role==='medical-release'));
  assert.ok(!run(v,{medical:true,explore:true},record).actions.some(a=>a.role==='medical-release'));
  v.drops.tierPermille=[0,0];
  assert.ok(run(v,{medical:true,explore:true,sodaEfficiency:true},record).actions.some(a=>a.role==='medical-release'));
  assert.ok(!run(v,{medical:true},{}).actions.some(a=>a.id===5),'不撤走手动护士');
  s.resources.stimpak=2;
  assert.ok(!run(v,{medical:true},record).actions.some(a=>a.role==='medical-release'),'至少留一支能用于治疗的针');
  s.resources.stimpak=4;s.residents[5].hp=40;
  assert.ok(!run(v,{medical:true},record).actions.some(a=>a.role==='medical-release'),'仍有伤员时保持医疗');
});
test('汽水效率收益：零掉落不新派遣或占用队员，仍可做周任务；非效率模式允许收集其他战利品',()=>{
  const v=campaignView();v.drops.tierPermille=[0,0];
  const p=run(v,{explore:true,quests:true,sodaEfficiency:true});
  assert.ok(!p.actions.some(a=>a.kind==='explore-start'));assert.ok(p.actions.some(a=>a.kind==='quest-start'));
  assert.match(p.notes.join(' '),/概率为0/);
  assert.ok(run(v,{explore:true,sodaEfficiency:false}).actions.some(a=>a.kind==='explore-start'));
  v.drops.tierPermille=[0,50];v.state.depth=10;
  assert.ok(run(v,{explore:true,tier:1,sodaEfficiency:true}).actions.some(a=>a.kind==='explore-start'&&a.targets[1]===1));
});
test('培养效率：同样短板优先三级训练室，避免先选一级房；更低短板仍优先',()=>{
  const v=campaignView();
  const room=(id,trainStat,level,col)=>({id,type:'training',trainStat,level,col,floor:3,width:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
  v.state.rooms.push(room(30,'end',1,2),room(31,'str',3,3));
  const plan=run(v,{training:true,trainTarget:9}),first=plan.actions.find(a=>a.role==='training');
  assert.equal(first.room,31);assert.equal(first.stat,'str');
  v.state.rooms.reverse();assert.equal(run(v,{training:true,trainTarget:9}).actions.find(a=>a.role==='training').room,31);
  for(const p of v.state.residents){p.stats.end=7;p.hp=Math.min(p.hp,138);}
  assert.equal(run(v,{training:true,trainTarget:9}).actions.find(a=>a.role==='training').room,30,'先补更低短板，不盲目追房间等级');
});
test('汽水效率：资格时长随网页变化，包含一半返程；旧自定义时长与原行程不覆盖',()=>{
  const v=campaignView(),c=cfg({explore:true,hours:12,sodaEfficiency:true});
  assert.equal(api.efficiency(api.model(v),c).hours,6);assert.equal(api.efficiency(api.model(v),c).cycleHours,9);
  assert.equal(api.efficiency(api.model(v),{...c,sodaEfficiency:false}).hours,12);
  v.drops.minMinutes=450;assert.equal(api.efficiency(api.model(v),c).hours,7.5);
  v.drops.minMinutes=1500;assert.equal(api.efficiency(api.model(v),c),null);
  v.drops.minMinutes=360;const p=v.state.residents[3];p.away={kind:'explore'};
  v.state.explorers=[{id:11,residentId:4,tier:0,abyss:false,startedAt:now-7*3600000,recalledAt:null,returnAt:null}];
  assert.ok(!api.plan(api.model(v),c,{trips:[{id:11,resident:4,hours:12,at:now-7*3600000}]},14).actions.some(a=>a.kind==='explore-recall'));
});
test('汽水效率：只比较原上限与已解锁范围内概率，非单调和并列概率不盲选更深区域',()=>{
  const v=campaignView();v.state.depth=30;v.drops.tierPermille=[50,80,60,80];
  const m=api.model(v),before=JSON.stringify(v);
  assert.equal(api.efficiency(m,cfg({sodaEfficiency:true,tier:3})).tier,1);
  assert.equal(api.efficiency(m,cfg({sodaEfficiency:true,tier:0})).tier,0);
  assert.equal(api.efficiency(m,cfg({sodaEfficiency:false,tier:3})).tier,3);
  assert.equal(JSON.stringify(v),before);
  v.state.depth=7;assert.equal(api.efficiency(api.model(v),cfg({sodaEfficiency:true,tier:3})).tier,0);
});
test('汽水效率：给定相同存活与掉落假设，资格时长方案在可行时长内汽水/占用小时最大',()=>{
  for(const minutes of [30,180,360,450,720,1440]){
    const v=campaignView();v.drops.minMinutes=minutes;
    const result=api.efficiency(api.model(v),cfg({sodaEfficiency:true,hours:24}));
    for(let duration=minutes;duration<=1440;duration+=30)
      assert.ok(result.probability/result.cycleHours>=result.probability/(duration/60*1.5)-1e-12);
  }
});
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
test('综合发展：正在恋爱的居民、儿童与伤员不出发，不挪手动特殊岗位',()=>{
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
test('综合发展：训练短板增长后轮换；低进度不超时退出，最近练过的人排在其他候选之后',()=>{
  const v=campaignView(),p=v.state.residents[4];p.stats.end=3;p.hp=120;
  v.state.rooms.push({id:30,type:'training',trainStat:'end',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
  let plan=run(v,{training:true,trainTarget:9});assert.equal(plan.choice.kind,'assign');assert.equal(plan.choice.room,30);
  const person=v.state.residents.find(r=>r.id===plan.choice.id);person.roomId=30;
  const record={roles:[{id:person.id,room:30,role:'training',stat:'end',base:person.stats.end,at:now-3600000}]};
  plan=run(v,{training:true,trainTarget:9},record);assert.ok(!plan.actions.some(a=>a.id===person.id));assert.ok(plan.reserved.includes(person.id));
  record.roles[0].at=now-10800000;person.training=.5;assert.ok(!run(v,{training:true,trainTarget:9},record).actions.some(a=>a.id===person.id));
  person.training=0;assert.ok(!run(v,{training:true,trainTarget:9},record).actions.some(a=>a.id===person.id));person.training=.5;
  person.stats.end++;plan=run(v,{training:true,trainTarget:9},record);assert.equal(plan.choice.role,'training-release');
  person.roomId=null;record.trainingRest=[{id:person.id,at:now}];record.roles=[];assert.notEqual(run(v,{training:true,trainTarget:9},record).choice?.id,person.id);
  for(const other of v.state.residents)if(other.id!==person.id)other.stats.end=other.stats.str=other.stats.agi=10;
  assert.equal(run(v,{training:true,trainTarget:10},record).choice?.id,person.id,'没有其他培养候选时不必等六小时');
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
  let campaign=run(v,{medical:true,explore:true}),plan=api.development(api.model(v),14,campaign);
  assert.ok(campaign.projects.some(p=>p.type==='medbay'));assert.equal(plan.next.project.type,'medbay');
  v.state.resources.stimpak=9;campaign=run(v,{explore:true});plan=api.development(api.model(v),14,campaign);
  assert.ok(campaign.projects.some(p=>p.milestone===8));assert.ok(plan.candidates.some(c=>c.kind==='dig'&&c.floor===8));
  const reserved=new Set(campaign.reserved);assert.ok(campaign.projects.filter(p=>p.person).every(p=>!reserved.has(p.person)));
});
test('综合发展：武器和战斗服只用闲置装备，不能把别人的装备抢走',()=>{
  const v=campaignView();v.state.items=[{id:1,slot:'weapon',damage:[4,8]},{id:2,slot:'weapon',damage:[99,99]}];v.state.residents[0].weaponId=2;
  const plan=run(v,{explore:true,combatGear:true});assert.equal(plan.choice.kind,'equip');assert.equal(plan.choice.slot,'weapon');assert.equal(plan.choice.item,1);
});

test('规则纠正：先计入闲置装备再判断任务门槛，关闭装备仍按当前战力',()=>{
  const v=campaignView();v.state.items=[{id:1,slot:'weapon',damage:[10,15]}];
  assert.ok(api.chance(120,v.env.quests[0])<.82);assert.ok(api.chance(145,v.env.quests[0])>.82);
  assert.equal(run(v,{quests:true,chance:82}).choice,null);
  const p=run(v,{quests:true,combatGear:true,chance:82});
  assert.equal(p.choice?.kind,'equip');assert.ok(p.actions.some(a=>a.kind==='quest-start'));
  assert.equal(p.actions.filter(a=>a.kind==='equip').length,1);
  assert.equal(run(v,{quests:true,combatGear:true,chance:85}).choice,null,'一件武器不能同时算给三个队员');
});

test('规则纠正：服装封顶按整个队伍分配，现有装备与先前预留装备均不能挪用',()=>{
  const v=campaignView(),team=v.state.residents.slice(4);team[0].stats.str=10;team[1].stats.str=1;
  v.state.items=[{id:1,slot:'outfit',bonus:{str:10}},{id:2,slot:'outfit',bonus:{end:5}},
    {id:3,slot:'weapon',damage:[50,50]},{id:4,slot:'weapon',damage:[20,20]}];
  v.state.residents[0].weaponId=3;
  const before=JSON.stringify(v),p=api.loadout(v.state,team,true,[4]);
  assert.equal(p.combat,api.combat(v.state,team[0])+api.combat(v.state,team[1])+15);
  assert.deepEqual([...p.changes].map(c=>[c.id,c.item]).sort(),[[5,2],[6,1]]);
  assert.equal(JSON.stringify(v),before);
});

test('规则纠正：同轮探险与任务不能重复使用同一件闲置装备的增益',()=>{
  const v=campaignView();v.state.items=[{id:1,slot:'weapon',damage:[10,15]}];
  const p=run(v,{explore:true,quests:true,combatGear:true,chance:75});
  assert.equal(p.actions.filter(a=>a.kind==='equip').length,1);
  assert.ok(p.actions.some(a=>a.kind==='explore-start'));assert.ok(!p.actions.some(a=>a.kind==='quest-start'));
});

test('规则纠正：三人争用服装的结果与小库存穷举一致，封顶、保留装备和库存顺序不改变最佳战力',()=>{
  const v=campaignView(),team=v.state.residents.slice(3);team[0].stats.str=10;team[1].stats.end=1;team[2].stats.agi=3;
  v.state.items=[{id:1,slot:'outfit',bonus:{str:10}},{id:2,slot:'outfit',bonus:{end:10}},
    {id:3,slot:'outfit',bonus:{agi:10}},{id:4,slot:'outfit',bonus:{str:5,end:5,agi:5}}];
  for(const blocked of [[],[4]]){
    let best=0;
    const ids=[null,...v.state.items.filter(i=>!blocked.includes(i.id)).map(i=>i.id)];
    for(const a of ids)for(const b of ids)for(const c of ids){
      const assigned=[a,b,c],used=assigned.filter(id=>id!==null);if(new Set(used).size!==used.length)continue;
      best=Math.max(best,team.reduce((n,p,i)=>n+api.combat(v.state,{...p,outfitId:assigned[i]}),0));
    }
    assert.equal(api.loadout(v.state,team,true,blocked).combat,best);
    v.state.items.reverse();assert.equal(api.loadout(v.state,team,true,blocked).combat,best);
  }
});

test('规则纠正：待产父母可以继续外出；未确认父母的待产房间与正在恋爱的另一对仍保护',()=>{
  const v=campaignView();v.state.births=[{id:1,roomId:5,parents:[5,6],dueAt:now+3600000}];
  for(const p of v.state.residents.filter(p=>p.id>=5)){p.roomId=5;p.familyCooldownUntil=now+3600000;}
  assert.equal(run(v,{explore:true}).choice?.id,5);
  v.state.births[0].parents=undefined;assert.equal(run(v,{explore:true}).choice?.id,4);
  v.state.births[0].parents=[1,2];v.state.residents[4].romance={partnerId:6};v.state.residents[5].romance={partnerId:5};
  assert.equal(run(v,{explore:true}).choice?.id,4);
});

test('规则纠正：启用训练时派遣不能拿走全部候选，单开训练使用两人房间的实际空位',()=>{
  const v=campaignView();v.state.rooms.push({id:30,type:'training',trainStat:'end',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
  const p=run(v,{training:true,trainTarget:9,explore:true,quests:true});
  const train=p.actions.find(a=>a.role==='training'),trip=p.actions.find(a=>a.kind==='explore-start');
  assert.ok(train);assert.ok(trip);assert.notEqual(train.id,trip.id);
  assert.ok(!p.actions.some(a=>a.team?.includes(train.id)));
  const only=run(v,{training:true,trainTarget:9});assert.equal(only.actions.filter(a=>a.role==='training').length,2);
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

test('发展决策：相同耗时和难度优先高积分奖励，任务列表顺序不影响选择',()=>{
  const v=campaignView(),q=v.env.quests[0];v.env.quests=[{...q,id:'low'},
    {...q,id:'high',title:'高积分任务',rewards:{...q.rewards,seasonPoints:100}}];
  assert.equal(run(v,{quests:true}).choice.targets[0],'high');
  v.env.quests.reverse();assert.equal(run(v,{quests:true}).choice.targets[0],'high');
});

test('发展决策：比较成功率、已知关卡耗时和人数后的积分效率，满赛季改选装备',()=>{
  const v=campaignView(),q=v.env.quests[0];v.env.quests=[{...q,id:'slow',stageMinutes:600,rewards:{...q.rewards,seasonPoints:100}},
    {...q,id:'fast',title:'短程积分',rewards:{...q.rewards,seasonPoints:50}},
    {...q,id:'gear',title:'装备任务',rewards:{...q.rewards,seasonPoints:0,itemTier:3}}];
  assert.equal(run(v,{quests:true}).choice.targets[0],'fast');
  v.state.season.points=4500;assert.equal(run(v,{quests:true}).choice.targets[0],'gear');
  v.env.quests=[{...q,id:'unknown',rewards:undefined},v.env.quests[2]];
  assert.equal(run(v,{quests:true}).choice.targets[0],'gear','奖励缺失的任务不能假定有收益');
});

test('发展决策：积分效率显示可复算且不把满档后的溢出积分当收益，0档装备归来可领取',()=>{
  const v=campaignView();v.state.season.points=4495;
  const p=run(v,{quests:true}).choice,a=p.assessment;
  assert.equal(a.hours,3);assert.equal(a.personHours,a.hours*p.team.length);
  assert.equal(a.seasonRate,a.chance*5/a.personHours);assert.equal(a.nextSodaPoints,4500);
  assert.match(p.reason,/未计返程和疗伤/);
  const team=[5,6];for(const id of team)v.state.residents.find(p=>p.id===id).away={kind:'quest'};
  v.state.quests=[{id:99,team,status:'returning',returnAt:now-1,questId:'w1',snapshot:{...v.env.quests[0],rewards:{scrap:1,parts:0,itemTier:0}}}];
  assert.equal(run(v,{quests:true}).choice?.kind,'quest-claim');
});

test('发展决策：宿舍已满时保留电台心情值班，有空床但目标已满时释放，停电或扩容中不保留',()=>{
  const v=campaignView();v.state.rooms.find(r=>r.type==='quarters').width=1;v.state.rooms.find(r=>r.type==='quarters').level=2;
  v.state.rooms.push({id:30,type:'radio',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
  v.state.residents[4].roomId=30;
  const record={roles:[{id:5,room:30,role:'radio',at:now-1000}]};
  let p=api.plan(api.model(v),cfg({radio:true}),record,6);
  assert.ok(!p.actions.some(a=>a.role==='radio-release'));assert.ok(p.reserved.includes(5));assert.match(p.notes.join(' '),/心情/);
  v.state.rooms.find(r=>r.type==='quarters').level=3;
  assert.ok(api.plan(api.model(v),cfg({radio:true}),record,6).actions.some(a=>a.role==='radio-release'));
  v.state.rooms.find(r=>r.type==='quarters').level=2;v.state.rooms.find(r=>r.id===30).unpowered=true;
  assert.ok(api.plan(api.model(v),cfg({radio:true}),record,6).actions.some(a=>a.role==='radio-release'));
  v.state.rooms.find(r=>r.id===30).unpowered=false;v.state.rooms.find(r=>r.type==='quarters').upgradeAt=now+3600000;
  assert.ok(api.plan(api.model(v),cfg({radio:true}),record,6).actions.some(a=>a.role==='radio-release'));
  assert.ok(!api.plan(api.model(v),cfg({radio:true}),{},6).actions.some(a=>a.id===5),'手动值班不自动撤走');
});

test('发展决策：第10层区域解锁按设置和概率规划，同时列明累计下挖成本',()=>{
  const v=campaignView();v.state.depth=9;
  let p=run(v,{explore:true,tier:1}),project=p.projects.find(p=>p.type==='elevator');
  assert.equal(project?.milestone,10);assert.equal(project?.purpose,'region');
  assert.equal(project?.totalScrap,Math.ceil(120*10**1.4));
  assert.ok(!run(v,{explore:true,tier:0}).projects.some(p=>p.purpose==='region'));
  v.drops.tierPermille[1]=10;assert.ok(!run(v,{explore:true,tier:1}).projects.some(p=>p.purpose==='region'));
});

test('发展决策：第20层下挖先核对医务室、针和留守武器，不把预留出发者算成守卫',()=>{
  const v=campaignView();v.state.depth=19;v.state.resources.scrap=12000;
  const goal={type:'elevator',priority:40,person:5,milestone:20,purpose:'region',benefit:'解锁区域2'};
  const plan=(reserved=[])=>api.development(api.model(v),14,{projects:[goal],reserved});
  const dig=()=>plan().candidates.find(c=>c.kind==='dig');
  assert.ok(dig().blocks.some(x=>x.includes('野兽')));
  v.state.rooms.push({id:30,type:'medbay',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
  v.state.residents[5].roomId=30;v.state.items=[{id:1,slot:'weapon',damage:[2,3]}];v.state.residents[4].weaponId=1;
  assert.ok(!dig().blocks.some(x=>x.includes('野兽')));
  assert.ok(plan([5]).candidates.find(c=>c.kind==='dig').blocks.some(x=>x.includes('野兽')));
  v.state.resources.stimpak=0;assert.ok(dig().blocks.some(x=>x.includes('野兽')));
});

test('发展决策：满床电台不抽走生产者，留守时仍保留正常生产调度空间',()=>{
  const v=campaignView();const room=v.state.rooms.find(r=>r.type==='quarters');room.width=1;room.level=2;
  v.state.rooms.push({id:30,type:'radio',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
  for(const p of v.state.residents.filter(p=>p.id>=5))p.roomId=4;
  assert.ok(!api.plan(api.model(v),cfg({radio:true}),{},6).actions.some(a=>a.role==='radio'));
  v.state.residents[4].roomId=null;
  assert.equal(api.plan(api.model(v),cfg({radio:true}),{},6).choice?.id,5);
});
