import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView,workshopChurnView,dormWorkshopCycleView,familyWorkshopCycleView,workshopFamilyReturnView,workshopUpgradeView,multiWorkshopView,workshopBuildView,workshopBudgetCycleView,workshopPowerCycleView,materialProducerCycleView} from './arkengine-shelter-campaign.fixture.mjs';
const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const segment=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const implementation=[declarations,segment('  function shelterWorkerRate(','  function readShelter('),
  segment('  const staffRoomTypes =','  function shelterExploreStep('),
  segment('  function shelterCampaignSchedule(','  function shelterDailyClaimStep('),
  segment('  function recordShelterCampaign(','  function shelterFormValue(')].join('\n');
function setup(v=workshopChurnView(),explore=true){
  const context={objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'},
    shelterStaffMode:'population',shelterStaffHold:'',shelterOptimize:false,shelterGear:false,shelterPopulationTarget:14,shelterLevelTarget:10,
    shelterConstruction:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0},
    shelterState:{campaign:{roles:[{id:21,room:50,role:'workshop',at:v.serverTime}],trips:[],attempts:[],heals:[],trainingRest:[]}},
    shelterPending:null,shelterRead:null,shelterCaravanNote:'',shelterConstructionNote:'',shelterStaffNote:'',shelterPopulationNote:'',shelterSocialNote:'',
    Date:{now:()=>v.serverTime},crypto:{randomUUID:()=>String(v.serverTime)},log:{add:()=>{}},workshopAutomatic:()=>true};
  context.saveShelter=x=>context.shelterState=x;
  const api=vm.runInNewContext(`${implementation}\nshelterCampaign={...campaignDefaults,explore:${explore},sodaEfficiency:true};
    ({model:shelterModel,campaign:shelterCampaignSchedule,staff:shelterStaffPlan,record:recordShelterCampaign,development:shelterDevelopmentPlan,
      powerReserve:shelterConstructionPowerReserve,populationDiagnostics:shelterPopulationDiagnostics,
      startCache:()=>shelterCampaignSchedule.cache={},endCache:()=>delete shelterCampaignSchedule.cache,
      raw:(m,cfg)=>shelterCampaignPlan(m,{...campaignDefaults,...cfg},shelterState.campaign,30)})`,context);
  const plan=()=>{const m=api.model(v),c=api.campaign(m);return {m,c,p:api.development(m,context.shelterPopulationTarget,c,context.shelterLevelTarget)};};
  return {v,context,api,plan};
}
test('人口阻塞诊断：按家庭分别记录外出、心情、冷却及离岗后供给，不修改人员或配对',()=>{
  const {v,context,api}=setup(workshopChurnView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterState.families=[{a:1,b:3,room:6},{a:13,b:14,room:5}];
  s.residents.find(p=>p.id===1).away={kind:'explore'};
  s.residents.find(p=>p.id===3).happiness=49;
  s.residents.find(p=>p.id===13).familyCooldownUntil=v.serverTime+3600000;
  const before=JSON.stringify({v,state:context.shelterState}),d=api.populationDiagnostics(api.model(v),{reserved:[],dailyReserved:[]});
  assert.match(d.families[0].reasons.join('；'),/外出/);assert.match(d.families[0].reasons.join('；'),/心情/);
  assert.match(d.families[1].reasons.join('；'),/冷却/);assert.equal(d.target,30);
  assert.ok(d.families.every(f=>f.supply&&Object.hasOwn(f.supply,'food')));
  assert.equal(JSON.stringify({v,state:context.shelterState}),before);
});
test('同步规划复用：同一快照重复核对只算一次，目标、记录、设置、快照变化及下一轮均重新计算',()=>{
  const {v,context,api}=setup(workshopChurnView(),false),m=api.model(v);
  api.startCache();let previous=api.campaign(m);assert.equal(api.campaign(m),previous);
  const changes=[()=>context.shelterPopulationTarget=30,
    ()=>context.shelterState=JSON.parse(JSON.stringify(context.shelterState)),
    ()=>context.shelterConstruction={...context.shelterConstruction,partsLimit:0},
    ()=>context.shelterCampaign={...context.shelterCampaign,medical:true},
    ()=>context.shelterStaffHold='manual'];
  for(const change of changes){change();const current=api.campaign(m);assert.notEqual(current,previous);assert.equal(api.campaign(m),current);previous=current;}
  assert.notEqual(api.campaign(api.model(v)),previous);api.endCache();
  assert.notEqual(api.campaign(m),api.campaign(m),'同步回合以外不保留规划');
});

test('工坊调度稳定：5级已有自动岗位不能因上下岗改变需求而无限往返',()=>{
  for(const target of [null,10]){
    const {v,context,api,plan}=setup(),actions=[];context.shelterLevelTarget=target;
    assert.equal(plan().p.next.project.cost.parts,0,'当前先执行无需零件的工程');
    if(target===null)assert.equal(plan().p.next.kind,'dig','覆盖现场下挖里程碑分支');
    for(let i=0;i<8;i++){
      const {c,p}=plan(),a=c.choice;
      if(!a||!a.role?.startsWith('workshop'))break;
      actions.push({role:a.role,id:a.id,room:a.room,next:p.next.title});
      v.state.residents.find(p=>p.id===a.id).roomId=a.room;
      api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
      context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
    }
    assert.deepEqual(actions.map(a=>a.role),['workshop-release'],JSON.stringify(actions));
  }
});
test('工坊调度稳定：仅启用自动建设也应保持备料，不被新增成年子女的补岗候选反复撤销',()=>{
  for(const assigned of [true,false]){
    const {v,context,api,plan}=setup(dormWorkshopCycleView(),false),s=v.state;
    context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
    context.shelterState.families=[[1,3,6],[2,10,1000],[12,21,1004],[13,14,5]].map(([a,b,room])=>({a,b,room}));
    context.shelterState.campaign.roles=assigned?[{id:1,room:50,role:'workshop',at:v.serverTime}]:[];
    context.shelterState.campaign.materials={vaultNo:77,id:1,type:'power',level:3,targetLevel:7,finalTarget:10};
    if(!assigned)s.residents.find(p=>p.id===1).roomId=1003;
    const actions=[];
    for(let step=0;step<8;step++){
      const {m,c}=plan();assert.ok(!c.choice?.role?.endsWith('release'),JSON.stringify(c.choice));
      const a=c.choice||api.staff(m);if(!a)break;actions.push(a);
      s.residents.find(p=>p.id===a.id).roomId=a.room;
      if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
      context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
    }
    assert.equal(s.residents.find(p=>p.id===1).roomId,50);assert.ok(plan().m.production.parts>0);
    assert.equal(actions.filter(a=>a.role==='workshop').length,assigned?1:2);
  }
});
test('家庭备料稳定：抽调工坊留下的回收空岗不能冒充口粮接替进展并取消备料',()=>{
  const {v,context,api,plan}=setup(familyWorkshopCycleView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  context.shelterState.families=[[1,3,6],[2,10,1000],[4,11,1004],[13,14,5]].map(([a,b,room])=>({a,b,room}));
  context.shelterState.campaign.roles=[];
  const actions=[],seen=new Set();
  for(let step=0;step<12;step++){
    const {m,c,p}=plan(),fingerprint=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(fingerprint),'unchanged state must not repeat');seen.add(fingerprint);
    assert.equal(p.next.type,'diner','food replacement remains necessary regardless of scrap vacancy');
    assert.ok(!c.choice?.role?.endsWith('release'),JSON.stringify(c.choice));
    const a=c.choice||api.staff(m);if(!a)break;actions.push(a);
    s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
    assert.ok(step<11,'staffing must settle');
  }
  assert.equal(actions.filter(a=>a.role==='workshop').length,2);
  assert.equal(s.residents.find(p=>p.id===4).roomId,50);assert.ok(plan().m.production.parts>0);
  s.resources.parts=31;
  assert.equal(plan().c.choice?.role,'workshop-release','actual sufficient stock still ends automatic duty');
});
test('工坊备料效率：已有一人且仍缺整批材料时，安全补足同一房间空位以缩短等待',()=>{
  const {v,context,api}=setup(),cfg={workshop:true,partsTarget:30,workshopScrapReserve:1200},s=v.state;
  s.resources.parts=0;
  const before=api.model(v),a=api.raw(before,cfg).choice;
  assert.equal(a?.role,'workshop','an existing worker must not suppress a useful second shift');
  assert.notEqual(a.id,21);assert.equal(a.room,50);
  s.residents.find(p=>p.id===a.id).roomId=a.room;
  api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  const after=api.model(v);
  assert.ok(after.production.parts>=before.production.parts*2-1e-9,'equal-skill second worker halves continuous production time');
  assert.ok(Object.keys(after.demand).every(k=>after.production[k]>=after.demand[k]*1.2-1e-9));
  assert.equal(api.raw(after,cfg).actions.filter(a=>a.role==='workshop').length,0,'full room does not reserve a third worker');
  s.resources.parts=30;
  assert.equal(api.raw(api.model(v),cfg).actions.filter(a=>a.role==='workshop-release').length,2,'both automatic workers are released when actual materials suffice');
});
test('工坊备料效率：本金或供应不足、岗位占满、下一批即够用时不追加人手',()=>{
  for(const kind of ['funds','supply','full','next-tick']){
    const {v,api}=setup(),cfg={workshop:true,partsTarget:30,workshopScrapReserve:1200},s=v.state;
    s.resources.parts=0;
    if(kind==='funds')s.resources.scrap=1200;
    if(kind==='supply')for(const p of s.residents)if(p.roomId===3)p.stats.per=0;
    if(kind==='full')s.residents.find(p=>p.id===35).roomId=50;
    if(kind==='next-tick'){s.resources.parts=27;s.rooms.find(r=>r.id===50).stored=2.99;}
    assert.equal(api.raw(api.model(v),cfg).actions.filter(a=>a.role==='workshop').length,0,kind);
  }
});
test('工坊备料效率：不能抽走目标升级房的最后一名生产者，使备料需求自行消失',()=>{
  const {v,context,api}=setup(campaignView()),s=v.state;
  s.rooms.push({...s.rooms[0],id:50,type:'workshop',floor:2,col:4,width:1,level:1});
  s.residents.find(p=>p.id===4).roomId=50;s.residents.find(p=>p.id===5).roomId=4;s.residents.find(p=>p.id===6).roomId=5;
  context.shelterState.campaign.roles=[{id:4,room:50,role:'workshop',at:v.serverTime}];s.resources.parts=0;
  const c=api.raw(api.model(v),{workshop:true,partsTarget:30,workshopScrapReserve:1200,workshopProject:4});
  assert.equal(c.actions.filter(a=>a.role==='workshop').length,0,'leave the last producer supporting the actual upgrade');
  assert.equal(c.actions.filter(a=>a.role==='workshop-release').length,0,'the existing workshop worker still has a real material demand');
});
test('工坊人口衔接：原家庭可返宿舍时不因预留工人改变工程而反复释放再补入',()=>{
  const {v,context,api,plan}=setup(workshopFamilyReturnView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  context.shelterState.families=[[1,3,6],[2,10,1000],[4,11,1004],[13,14,5]].map(([a,b,room])=>({a,b,room}));
  context.shelterState.campaign.roles=[{id:4,room:50,role:'workshop',at:v.serverTime}];
  context.shelterState.campaign.materials={vaultNo:77,id:1002,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  const seen=new Set(),actions=[];
  for(let step=0;step<16;step++){
    const key=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(key),JSON.stringify(actions));seen.add(key);
    const {m,c}=plan(),a=c.choice||api.staff(m);if(!a)break;
    actions.push({id:a.id,room:a.room,role:a.role});s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(step<15,'staffing must settle');
  }
  assert.ok(s.residents.filter(p=>[4,11].includes(p.id)).every(p=>p.roomId===1004),'an existing safe family must be allowed to return');
});

test('多工坊补员：原房满员后安排另一间已建空房，刷新稳定，齐料后释放自动岗位',()=>{
  const {v,context,api,plan}=setup(multiWorkshopView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterConstruction.scrapReserve=0;
  context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
  context.shelterState.campaign.materials={vaultNo:77,id:1010,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  const before=JSON.stringify(v),initial=plan();
  assert.equal(initial.p.next.project.id,1010);assert.equal(initial.p.next.project.cost.parts,30);
  assert.equal(initial.c.choice?.role,'workshop','有真实备料需求时使用另一间现有工坊');
  assert.equal(initial.c.choice.room,3000);assert.equal(JSON.stringify(v),before,'预览不能提前计入人手或产出');
  const added=[];
  for(let step=0;step<2;step++){
    const a=plan().c.choice;assert.equal(a.role,'workshop');assert.equal(a.room,3000);added.push(a.id);
    s.residents.find(p=>p.id===a.id).roomId=a.room;
    api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  }
  assert.equal(new Set(added).size,2);const filled=plan();
  assert.ok(filled.m.production.parts>2.69);
  assert.equal(filled.c.workshopPreparation?.original.id??filled.p.next.project.id,1010,
    '若满岗新工坊升2更快，前置工程也必须继续归属原1010材料需求');
  assert.ok(!filled.c.actions.some(a=>a.role?.startsWith('workshop')),'已满的两个工坊不反复调动或释放');
  assert.ok(s.residents.some(p=>p.roomId===1010),'原工程必须仍有有效生产者');
  s.resources.parts=30;const done=plan();
  assert.equal(done.c.actions.filter(a=>a.role==='workshop-release').length,4,'仅在原材料已齐时结束本脚本值班');
});

test('多工坊供料：只能供原房时不增员且保留原岗，另房完整批量供料齐备后再接岗',()=>{
  const {v,context,api}=setup(multiWorkshopView(),false),s=v.state;
  context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
  const original=s.rooms.find(r=>r.id===50),feed=6*(Math.ceil(30/4.5)*4.5-original.stored),extra=180;
  const run=()=>api.raw(api.model(v),{workshop:true,partsTarget:30,workshopScrapReserve:960,workshopProject:1010});
  s.resources.scrap=960+feed+extra-1;
  const limited=run();assert.ok(!limited.actions.some(a=>a.role==='workshop'));
  assert.ok(!limited.actions.some(a=>a.role==='workshop-release'),'新增房供料不足不能撤掉原房有效人员');
  s.resources.scrap++;
  const funded=run();assert.equal(funded.choice?.role,'workshop');assert.equal(funded.choice.room,3000);
  const a=funded.choice;s.residents.find(p=>p.id===a.id).roomId=a.room;
  api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  assert.ok(!run().actions.some(a=>a.role==='workshop-release'),'恰好够两房供料时，加岗前后的浮点运算不能造成撤岗');
});

test('多工坊供料：原房全员外出占位时，只为可用的另一间工坊预留供料',()=>{
  const {v,context,api}=setup(multiWorkshopView(),false),s=v.state;
  context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
  for(const id of [10,35])s.residents.find(p=>p.id===id).away={kind:'explore'};
  s.resources.scrap=960+180;
  const c=api.raw(api.model(v),{workshop:true,partsTarget:30,workshopScrapReserve:960,workshopProject:1010});
  assert.equal(c.choice?.role,'workshop');assert.equal(c.choice.room,3000);
  assert.ok(!c.actions.some(a=>[10,35].includes(a.id)),'不调动外出人员，也不把他们占用的房间当成可供料空房');
});

test('多工坊连续供料：两间实际整批产出更早备齐原工程，供料守恒且逐轮不往返',t=>{
  const run=second=>{
    const {v,context,api}=setup(multiWorkshopView(),false),s=v.state;
    context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
    if(!second){s.rooms=s.rooms.filter(r=>r.id!==3000);v.progress.score--;}
    const initialScrap=s.resources.scrap,initialStored=s.rooms.find(r=>r.id===50).stored;
    let madeTotal=0,collected=0,feed=0,ticks=0,assignments=0;
    const plan=()=>api.raw(api.model(v),{workshop:true,partsTarget:30,workshopScrapReserve:960,workshopProject:1010});
    for(;s.resources.parts<30&&ticks<144;ticks++){
      const seen=new Set();
      for(let decision=0;decision<8;decision++){
        const a=plan().choice;if(!a)break;
        assert.equal(a.role,'workshop','备料期间不因增加工坊而释放原班');
        const key=JSON.stringify(s.residents.map(p=>[p.id,p.roomId]));assert.ok(!seen.has(key));seen.add(key);
        s.residents.find(p=>p.id===a.id).roomId=a.room;assignments++;
        api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
        context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
      }
      for(const room of s.rooms.filter(r=>r.type==='workshop')){
        const factor=[0,1,1.5,2.1][room.level],batch=3*room.width*factor;
        const workers=s.residents.filter(p=>p.roomId===room.id&&p.away===null&&p.adultAt<=v.serverTime).slice(0,room.width*2);
        const amount=workers.reduce((n,p)=>n+.6*factor*(.5+p.stats.int/10)*(.6+.4*p.happiness/100),0)/6;
        room.stored+=amount;s.resources.scrap-=6*amount;madeTotal+=amount;feed+=6*amount;
        const take=Math.floor((room.stored+1e-9)/batch)*batch;room.stored-=take;s.resources.parts+=take;collected+=take;
        assert.ok(room.stored>=-1e-8&&room.stored<4*batch);assert.ok(s.resources.scrap>=960);
      }
      v.serverTime+=600000;s.lastSettledAt=v.serverTime;
    }
    assert.ok(s.resources.parts>=30);assert.ok(Math.abs(initialScrap-s.resources.scrap-feed)<1e-7);
    assert.ok(Math.abs(initialStored+madeTotal-collected-s.rooms.filter(r=>r.type==='workshop').reduce((n,r)=>n+r.stored,0))<1e-7);
    assert.ok(Math.abs(feed-6*madeTotal)<1e-7);assert.equal(s.resources.parts,collected);
    assert.equal(plan().actions.filter(a=>a.role==='workshop-release').length,second?4:2);
    return {hours:ticks/6,assignments,parts:s.resources.parts,feed};
  };
  const baseline=run(false),expanded=run(true);
  assert.ok(expanded.hours<baseline.hours);assert.equal(expanded.assignments,2);assert.equal(baseline.assignments,0);
  t.diagnostic(JSON.stringify({scope:'fixed original material target, existing rooms, no construction or general supply time simulation',baseline,expanded}));
});

test('多工坊边界：先补原房空位，临近齐料、施工、停电、事件及外出占位时不占用第二房',()=>{
  for(const kind of ['first-vacancy','near','building','upgrading','unpowered','incident','away']){
    const {v,context,api}=setup(multiWorkshopView(),false),s=v.state,newRoom=s.rooms.find(r=>r.id===3000);
    context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
    if(kind==='first-vacancy'){s.residents.find(p=>p.id===35).roomId=null;context.shelterState.campaign.roles.pop();}
    if(kind==='near'){s.resources.parts=28;s.rooms.find(r=>r.id===50).stored=4.4;}
    if(kind==='building')newRoom.builtAt=v.serverTime+3600000;
    if(kind==='upgrading')newRoom.upgradeAt=v.serverTime+3600000;
    if(kind==='unpowered')newRoom.unpowered=true;
    if(kind==='incident')newRoom.incident={kind:'fire',hp:20,maxHp:20};
    if(kind==='away')for(const id of [21,36]){const p=s.residents.find(p=>p.id===id);p.roomId=3000;p.away={kind:'explore'};}
    const c=api.raw(api.model(v),{workshop:true,partsTarget:30,workshopScrapReserve:960,workshopProject:1010});
    if(kind==='first-vacancy')assert.equal(c.choice?.room,50,'已有值班房的空位优先');
    else assert.ok(!c.actions.some(a=>a.role==='workshop'&&a.room===3000),kind);
    assert.ok(!c.actions.some(a=>a.role==='workshop-release'),kind);
  }
});

function buildWorkshopSetup(){
  const result=setup(workshopBuildView(),false),{context,v}=result;
  context.shelterPopulationTarget=30;context.shelterConstruction.scrapReserve=0;
  context.shelterConstruction.scrapLimit=1600;
  context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
  context.shelterState.campaign.materials={vaultNo:77,id:1010,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  return result;
}
test('工坊新建备料：计入施工与离岗损失后更快才扩建，施工期间不预先撤人',()=>{
  const {v,context,api,plan}=buildWorkshopSetup(),s=v.state,before=JSON.stringify(v);
  const initial=plan(),preparation=initial.c.workshopPreparation,c=initial.p.next.project;
  assert.equal(c?.kind,'build');assert.equal(c.type,'workshop');assert.equal(c.cost.scrap,600);
  assert.equal(preparation.original.id,1010);assert.ok(preparation.savedHours>1);
  assert.equal(preparation.workers.length,2);assert.equal(JSON.stringify(v),before);
  assert.equal(initial.c.actions.filter(a=>a.kind==='assign').length,0,'建成前不占用候选工人');
  const posts=preparation.workers.map(id=>[id,s.residents.find(p=>p.id===id).roomId]);
  s.resources.scrap-=c.cost.scrap;
  s.rooms.push({...s.rooms.find(r=>r.id===50),id:3000,floor:c.floor,col:c.col,width:1,level:1,stored:0,builtAt:v.serverTime+600000});
  context.shelterState.constructionLedger=[{id:'build-workshop',at:v.serverTime,scrap:c.cost.scrap,parts:0}];
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  assert.equal(plan().c.workshopPreparation,null);
  assert.equal(plan().c.actions.filter(a=>a.kind==='assign').length,0,'施工期间原工坊和候选工人继续生产');
  assert.deepEqual(posts.map(([id])=>[id,s.residents.find(p=>p.id===id).roomId]),posts);
  v.serverTime+=600000;s.lastSettledAt=v.serverTime;v.progress.score++;
  for(let i=0;i<2;i++){
    const a=plan().c.choice;assert.equal(a.role,'workshop');assert.equal(a.room,3000);
    s.residents.find(p=>p.id===a.id).roomId=a.room;
    api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  }
  assert.ok(plan().m.production.parts>2.69);assert.equal(plan().p.next.project.id,1010);
  assert.equal(plan().c.actions.filter(a=>a.role==='workshop-release').length,0);
  s.resources.parts=30;assert.equal(plan().p.next.status,'ready');
  assert.equal(plan().c.actions.filter(a=>a.role==='workshop-release').length,4);
});

test('工坊新建边界：少量缺件、开关、联合预算、供料、人员和供电不满足时保留原工程',()=>{
  for(const kind of ['near','off','budget','feed','people','power','population','space']){
    const {v,context,plan}=buildWorkshopSetup(),s=v.state;
    if(kind==='near')s.resources.parts=29;
    if(kind==='off')context.shelterConstruction.build=false;
    if(kind==='budget')context.shelterConstruction.scrapLimit=1500;
    if(kind==='feed')s.resources.scrap=600+960+6*(31.5-1.1112)+180-1;
    if(kind==='people')for(const p of s.residents)if(![10,35].includes(p.id))p.hp=50;
    if(kind==='power')s.residents.filter(p=>p.roomId===1).forEach(p=>p.stats.str=0);
    if(kind==='population')context.shelterPopulationTarget=31;
    if(kind==='space')delete s.rooms[0].col;
    const before=JSON.stringify(v),result=plan();
    assert.equal(result.c.workshopPreparation,null,kind);assert.equal(JSON.stringify(v),before,kind);
    if(!['power','space'].includes(kind))assert.equal(result.p.next.project?.id,1010,kind);
  }
});

test('工坊新建合并：沿用相邻同级合并位置，按合并后的整批量估计和实际备料',t=>{
  const {v,context,api,plan}=buildWorkshopSetup(),s=v.state,w=s.rooms.find(r=>r.id===50);
  s.rooms.push({...w,id:3001,type:'storage',level:1,stored:0});
  Object.assign(w,{level:1,floor:5,col:5});
  const initial=plan(),p=initial.c.workshopPreparation;
  assert.equal(p?.project.kind,'build');assert.equal(p.project.floor,5);assert.equal(p.project.col,6);
  assert.equal(p.workers.length,2);assert.ok(p.savedHours>1);
  const firstScrap=s.resources.scrap,firstStored=w.stored;let feed=0,made=0,collected=0;
  s.resources.scrap-=600;context.shelterState.constructionLedger=[{id:'merge-build',at:v.serverTime,scrap:600,parts:0}];
  // 固定夹具无经验/装备/活动变化；独立按公开十分钟产刻与整批规则推进。
  const tick=()=>{
    const batch=3*w.width,workers=s.residents.filter(p=>p.roomId===w.id&&p.away===null).slice(0,w.width*2);
    const amount=workers.reduce((n,p)=>n+.6*(.5+p.stats.int/10)*(.6+.4*p.happiness/100),0)/6;
    w.stored+=amount;s.resources.scrap-=amount*6;made+=amount;feed+=amount*6;
    const take=Math.floor((w.stored+1e-9)/batch)*batch;w.stored-=take;s.resources.parts+=take;collected+=take;
    v.serverTime+=600000;s.lastSettledAt=v.serverTime;
  };
  tick();w.width++;v.progress.score++;
  for(let i=0;i<2;i++){
    const a=plan().c.choice;assert.equal(a?.role,'workshop');assert.equal(a.room,50);
    s.residents.find(p=>p.id===a.id).roomId=50;
    api.record({kind:'assign',targets:[a.id,50],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  }
  let ticks=1;
  for(;s.resources.parts<30&&ticks<180;ticks++)tick();
  assert.ok(s.resources.parts>=30);assert.equal(collected%6,0,'合并后不能拆成两个3件的小批提前领取');
  assert.ok(Math.abs(firstScrap-s.resources.scrap-600-feed)<1e-7);
  assert.ok(Math.abs(firstStored+made-collected-w.stored)<1e-7);
  assert.ok(Math.abs(ticks/6-p.totalHours)<1/6+1e-9,'有供料且本金充足时预测与独立整步生产相符');
  assert.equal(plan().p.next.project.id,1010);assert.equal(plan().p.next.status,'ready');
  t.diagnostic(JSON.stringify({scope:'merged workshop fixed material target only',baselineHours:p.baselineHours,
    forecastHours:p.totalHours,actualHours:ticks/6,constructionScrap:600,feed,collected}));
});

test('备料额度等待：建设额度暂不足不抽空原工程，不触发八人工坊整组释放重补',()=>{
  const {v,context,api,plan}=setup(workshopBudgetCycleView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  context.shelterState.campaign.roles=s.residents.filter(p=>[50,1012].includes(p.roomId)).map(p=>({id:p.id,room:p.roomId,role:'workshop',at:v.serverTime}));
  context.shelterState.campaign.materials={vaultNo:77,id:4,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  context.shelterState.constructionLedger=[{id:'prior-upgrades',at:v.serverTime,scrap:2160,parts:60}];
  const initial=plan();assert.equal(initial.p.next.project.id,4);assert.equal(initial.p.next.project.cost.parts,45);
  assert.equal(api.powerReserve(initial.p.next.project,initial.m,context.shelterConstruction,context.shelterState,null,v.serverTime),0,
    '额度不足仍不额外预留开工供电');
  for(let i=0;i<30;i++){
    const {m,c,p}=plan(),a=c.choice||api.staff(m);if(!a)break;
    assert.equal(p.next.project.id,4);assert.ok(!a.role?.endsWith('release'),'原工程确实缺件，现有工坊应继续生产');
    assert.ok(a.id!==4||a.room===4,'原回收唯一生产者不能为邻房小幅增产离岗');
    s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
  }
  assert.equal(s.residents.find(p=>p.id===4).roomId,4);
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  assert.equal(plan().p.next.project.id,4);assert.ok(plan().m.production.parts>4.3);
  s.resources.parts=46;assert.equal(plan().c.actions.filter(a=>a.role==='workshop-release').length,8,'材料齐备仍释放');
  s.resources.parts=37;context.shelterConstruction.upgrade=false;
  assert.equal(api.staff(api.model(v))?.id,4,'关闭原工程后不再保护特殊备料岗位');
});

test('工坊扩产等待：缺件较多且本金充裕时先升工坊，施工与刷新仍保留原工程需求',()=>{
  const {v,context,api,plan}=setup(workshopUpgradeView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterConstruction.scrapReserve=0;
  context.shelterConstruction.build=false; // 单独验收没有新建授权时的升级路径。
  context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
  context.shelterState.campaign.materials={vaultNo:77,id:1010,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  const before=JSON.stringify(v),initial=plan();
  assert.equal(initial.p.next.project?.type,'workshop','不是一味等原工坊：当前项目应比较有效扩产');
  assert.equal(initial.p.next.project.id,50);assert.equal(initial.p.next.project.level,2);
  assert.ok(initial.c.workshopPreparation.savedHours>4,'包括停产和整批收取后仍能缩短原工程等待');
  assert.equal(initial.c.actions.filter(a=>a.role==='workshop-release').length,0,'前置工程不把原零件目标改为0');
  assert.equal(JSON.stringify(v),before);
  s.resources.scrap-=1250;s.rooms.find(r=>r.id===50).upgradeAt=v.serverTime+3600000;
  context.shelterState.constructionLedger=[{id:'workshop-upgrade',at:v.serverTime,scrap:1250,parts:0}];
  context.shelterState=JSON.parse(JSON.stringify(context.shelterState));
  const pending=plan();assert.equal(pending.c.actions.filter(a=>a.role==='workshop-release').length,0);
  assert.notEqual(pending.p.next.project?.id,50,'不重复工坊施工');
  v.serverTime+=3600000;s.lastSettledAt=v.serverTime;
  Object.assign(s.rooms.find(r=>r.id===50),{upgradeAt:null,level:2});v.progress.score++;
  const completed=plan();assert.equal(completed.p.next.project?.id,1010,'完工回到原材料项目');
  assert.ok(completed.m.production.parts>1.6);assert.equal(completed.c.actions.filter(a=>a.role==='workshop-release').length,0);
  s.resources.parts=31;const funded=plan();assert.equal(funded.p.next.project?.id,1010);assert.equal(funded.p.next.status,'ready');
  assert.equal(funded.c.actions.filter(a=>a.role==='workshop-release').length,2,'原材料真正齐备时仍正常结束自动值班');
});

test('工坊扩产等待：临近备齐、开关或资金受限、缺电和人工岗位时不升级',()=>{
  for(const kind of ['near','budget','principal','off','pending','power','manual','health','hold']){
    const {v,context,plan}=setup(workshopUpgradeView(),false),s=v.state;
    context.shelterPopulationTarget=30;context.shelterConstruction.scrapReserve=0;
    context.shelterConstruction.build=false;
    context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
    context.shelterState.campaign.materials={vaultNo:77,id:1010,type:'scrap',level:3,targetLevel:8,finalTarget:10};
    if(kind==='near')s.resources.parts=28;
    if(kind==='budget')context.shelterConstruction.scrapLimit=2000;
    if(kind==='principal')s.resources.scrap=2000;
    if(kind==='off')context.shelterConstruction.upgrade=false;
    if(kind==='pending')context.shelterPending={id:'unknown'};
    if(kind==='power')s.residents.filter(p=>p.roomId===1).forEach(p=>p.stats.str=0);
    if(kind==='manual')context.shelterState.campaign.roles=[];
    if(kind==='health')s.residents.find(p=>p.id===35).hp=50;
    if(kind==='hold')context.shelterStaffHold='人工窗口';
    const before=JSON.stringify(v),result=plan();
    assert.equal(result.c.workshopPreparation,null,kind);assert.notEqual(result.p.next.project?.type,'workshop',kind);
    assert.equal(JSON.stringify(v),before,'比较不改变人员和库存');
  }
});

test('工坊扩产阶段：人口未达阶段目标、尚有幼儿或成年子女待就业时先保留发展预算',()=>{
  for(const kind of ['population','child','jobs']){
    const {v,context,plan}=setup(workshopUpgradeView(),false),s=v.state;
    context.shelterPopulationTarget=kind==='population'?31:30;context.shelterConstruction.scrapReserve=0;
    context.shelterState.campaign.roles=[10,35].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
    context.shelterState.campaign.materials={vaultNo:77,id:1010,type:'scrap',level:3,targetLevel:8,finalTarget:10};
    const child=s.residents.find(p=>p.id===49);child.parents=[2,10];child.roomId=1000;
    if(kind==='child')child.adultAt=v.serverTime+3600000;
    else if(kind==='population')child.roomId=1010;
    const result=plan();assert.equal(result.c.workshopPreparation,null,kind);
    assert.notEqual(result.p.next.project?.type,'workshop',kind);
  }
});

test('备料供电稳定：已确认原工程仍缺零件时保留发电准备，不能反复撤工坊再补电',()=>{
  const {v,context,api,plan}=setup(workshopPowerCycleView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  context.shelterState.campaign.roles=[{id:3,room:50,role:'workshop',at:v.serverTime}];
  context.shelterState.campaign.materials={vaultNo:77,id:4,type:'scrap',level:3,targetLevel:8,finalTarget:10};
  context.shelterState.families=[[1,3,6],[2,10,1000],[12,21,1004],[13,14,5]].map(([a,b,room])=>({a,b,room}));
  const seen=new Set(),actions=[];
  for(let i=0;i<15;i++){
    const fingerprint=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(fingerprint),JSON.stringify(actions));seen.add(fingerprint);
    const {m,c}=plan(),a=c.choice||api.staff(m);if(!a)break;
    actions.push(a);s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(i<14);
  }
  assert.equal(s.residents.find(p=>p.id===1).roomId,1,'缺件期间仍保留现有供电准备');
  assert.equal(plan().p.next.project?.id,4);assert.equal(actions.filter(a=>a.role==='workshop-release').length,0);
});

test('备料供电限制：只有原项目的在岗备料可继续预留，其他开关额度和供料条件不放宽',()=>{
  for(const kind of ['valid','different','manual','budget','principal','off','pending','other-block']){
    const {v,context,api,plan}=setup(workshopPowerCycleView(),false),s=v.state;
    context.shelterPopulationTarget=30;context.shelterConstruction.scrapReserve=0;
    s.residents.find(p=>p.id===10).roomId=50;
    context.shelterState.campaign.roles=[3,10].map(id=>({id,room:50,role:'workshop',at:v.serverTime}));
    context.shelterState.campaign.materials={vaultNo:77,id:4,type:'scrap',level:3,targetLevel:8,finalTarget:10};
    const c=plan().p.next.project;assert.equal(c.id,4);
    if(kind==='different')context.shelterState.campaign.materials.id=1007;
    if(kind==='manual')context.shelterState.campaign.roles=[];
    if(kind==='budget')context.shelterConstruction.partsLimit=44;
    if(kind==='principal')s.resources.scrap=1500;
    if(kind==='off')context.shelterConstruction.upgrade=false;
    if(kind==='pending')context.shelterPending={id:'unknown'};
    if(kind==='other-block')c.blocks.push('等待其他实际条件');
    const before=JSON.stringify(v);
    assert.equal(api.powerReserve(c,api.model(v),context.shelterConstruction,context.shelterState,context.shelterPending,v.serverTime),kind==='valid'?3:0,kind);
    assert.equal(JSON.stringify(v),before,'规划不能把尚未产出的零件写进真实库存');
  }
});

test('备料生产者稳定：不能为短期回收增产抽空原升级房，使最后一批零件需求反复消失',()=>{
  const {v,context,api,plan}=setup(materialProducerCycleView(),false),s=v.state;
  context.shelterPopulationTarget=30;context.shelterOptimize=true;context.shelterConstruction.scrapReserve=0;
  context.shelterState.campaign.roles=[];
  context.shelterState.campaign.materials={vaultNo:77,id:1016,type:'scrap',level:3,targetLevel:9,finalTarget:10};
  const seen=new Set(),actions=[];
  for(let i=0;i<16;i++){
    const key=JSON.stringify({posts:s.residents.map(p=>p.roomId),state:context.shelterState});
    assert.ok(!seen.has(key),JSON.stringify(actions));seen.add(key);
    const {m,c}=plan(),a=c.choice||api.staff(m);if(!a)break;
    actions.push(a);s.residents.find(p=>p.id===a.id).roomId=a.room;
    if(a.role)api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:v.serverTime}}},api.model(v));
    context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(i<15);
  }
  assert.equal(plan().p.next.project?.id,1016);assert.equal(actions.filter(a=>a.role==='workshop-release').length,0);
  assert.ok(s.residents.some(p=>p.roomId===1016));
  context.shelterConstruction.upgrade=false;
  const next=api.staff(api.model(v));assert.equal(next?.from,1016,'取消升级后不再保留原房生产者');
});
