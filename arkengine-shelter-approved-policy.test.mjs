import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setupParentPreparation} from './arkengine-shelter-parent-preparation.fixture.mjs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const setup=()=>{const x=setupParentPreparation(source);x.context.shelterPopulationTarget=200;return x;};
const fn=(x,name)=>vm.runInContext(name,x.context);
const plain=x=>structuredClone(x);

test('出生后原家庭先于快速就业：仅对真实可交接的全10家庭让路',()=>{
  const x=setup(),state=x.f.view.state,parents=state.residents.filter(person=>[8,9].includes(person.id));
  for(const parent of parents){for(const stat of Object.keys(parent.stats))parent.stats[stat]=10;parent.roomId=null;}
  const ready=()=>fn(x,'shelterFamilyHandoff')(x.m(),{});
  assert.equal(ready()?.room,7);assert.equal(fn(x,'shelterIdleEmploymentChoice')(x.m(),{}),null);
  for(const change of [{familyCooldownUntil:x.f.view.serverTime+60000},{roomId:90},{hp:1}]){
    const before={...parents[0]};Object.assign(parents[0],change);assert.equal(ready(),null);Object.assign(parents[0],before);
  }
  parents[0].stats.cha=9;assert.equal(ready(),null);parents[0].stats.cha=10;
  state.resources.food=0;assert.equal(ready(),null);
});

test('自动护士仅在已核准撤岗时直返原宿舍；不接管人工医务岗',()=>{
  const x=setup(),state=x.f.view.state;
  const parents=state.residents.filter(person=>[8,9].includes(person.id));
  for(const parent of parents){for(const stat of Object.keys(parent.stats))parent.stats[stat]=10;parent.roomId=null;}
  state.rooms.push({...state.rooms[0],id:301,type:'medbay',level:1});parents[0].roomId=301;
  state.residents.find(person=>person.id===6).roomId=1;
  const release={kind:'assign',role:'medical-release',id:8,from:301,room:null};
  const choose=actions=>fn(x,'shelterFamilyHandoff')(x.m(),{actions});
  assert.equal(choose([release]),null);
  x.context.shelterState.campaign.roles.push({id:8,room:301,role:'medical',at:x.f.view.serverTime});
  assert.equal(choose([]),null);assert.equal(choose([release])?.release,release);
  assert.equal(fn(x,'shelterFamilyHandoff')(x.m(),{actions:[release],medicalDutyRequired:true}),null);
  Object.assign(x.f.campaign,{medical:true,training:false});
  assert.equal(x.schedule().actions.find(action=>action.role==='medical-release'&&action.id===8)?.room,7);
  assert.ok(x.context.shelterState.families.some(family=>family.a===8&&family.b===9&&family.room===7));
  assert.ok(!x.context.shelterState.parentPreparation.pairs.some(pair=>[8,9].includes(pair.a)!==[8,9].includes(pair.b)));
  state.resources.stimpak=0;assert.ok(!x.schedule().actions.some(action=>action.role==='medical-release'&&action.room===7));
});

function deepDigFamily(){
  const x=setup(),s=x.f.view.state;
  Object.assign(x.f.campaign,{medical:true,training:false,parentPreparation:false});
  s.rooms.push({...s.rooms[0],id:301,type:'medbay',width:1,level:1});
  for(const p of s.residents.filter(p=>[8,9].includes(p.id)))for(const stat of Object.keys(p.stats))p.stats[stat]=10;
  s.residents.find(p=>p.id===8).roomId=301;s.residents.find(p=>p.id===6).roomId=1;
  s.digging={floor:40,doneAt:x.m().now+3600000};
  x.context.shelterState.campaign.roles.push({id:8,room:301,role:'medical',at:x.m().now});return x;
}

test('深挖交班：替班只派一次，实际到岗且有回执后才让原护士返宿舍',()=>{
  const x=deepDigFamily(),s=x.f.view.state,first=x.api.choice(x.m());
  assert.equal(first?.role,'medical');assert.equal(first.room,301);assert.ok(![8,9].includes(first.id));
  assert.deepEqual(x.api.choice(x.m()).targets,first.targets);
  assert.ok(!x.schedule().actions.some(a=>a.role==='medical-release'));
  const other=s.residents.find(p=>p.id===first.id);other.roomId=301;x.tick();
  assert.ok(!x.schedule().actions.some(a=>a.role==='medical-release'));
  x.apply(first);x.tick();const release=x.api.choice(x.m());
  assert.deepEqual(plain(release?.targets),[8,7]);assert.equal(release.role,'medical-release');
  other.roomId=first.from;x.tick();assert.ok(!x.schedule().actions.some(a=>a.role==='medical-release'));other.roomId=301;
  other.hp=10;x.tick();assert.ok(!x.schedule().actions.some(a=>a.role==='medical-release'));
  other.hp=100;x.apply(release);x.tick();assert.equal(other.roomId,301);
  assert.ok(!x.schedule().actions.some(a=>a.id===other.id&&a.role==='medical-release'));
});

test('深挖交班：原医务室满员时用另一间已完工医务室，不为交班开工',()=>{
  const x=deepDigFamily(),s=x.f.view.state;
  Object.assign(s.residents.find(p=>p.id===4),{roomId:301,away:{kind:'explore'}});
  const spare={...s.rooms.find(r=>r.id===301),id:302,floor:3,col:7};s.rooms.push(spare);
  spare.unpowered=true;assert.ok(!x.schedule().actions.some(a=>a.familyMedical));
  spare.unpowered=false;const relief=x.api.choice(x.m());assert.equal(relief?.room,302);x.apply(relief);x.tick();
  assert.deepEqual(plain(x.api.choice(x.m())?.targets),[8,7]);
  spare.unpowered=true;x.tick();assert.ok(!x.schedule().actions.some(a=>a.role==='medical-release'));
});

test('深挖交班：不接管人工岗位、挤占已占用席位或在缺针及供给不足时撤岗',()=>{
  for(const gate of ['manual','historical','full','needles','power','pending','incident']){
    const x=deepDigFamily(),s=x.f.view.state;
    if(gate==='manual')x.context.shelterState.campaign.roles=[];
    if(gate==='historical')x.context.shelterState.campaign.roles[0].historical=true;
    if(gate==='full')Object.assign(s.residents.find(p=>p.id===4),{roomId:301,away:{kind:'explore'}});
    if(gate==='needles')s.resources.stimpak=0;
    if(gate==='power')s.resources.power=0;
    if(gate==='pending')x.context.shelterPending={kind:'assign',targets:[4,301]};
    if(gate==='incident')s.rooms[0].incident={kind:'raiders',hp:80,maxHp:80};
    assert.ok(!x.schedule().actions.some(a=>a.familyMedical||a.id===8&&a.role==='medical-release'),gate);
  }
});

test('默认建设日志：分别保留规划目标与未选生产房，未规划不臆造原因',()=>{
  const x=setup(),m=x.m(),project={kind:'dig',type:'elevator',floor:40,title:'下挖',benefit:'增加探险位',priority:40,blocks:[],cost:{scrap:200,parts:0}},
    production={kind:'build',type:'scrap',floor:4,col:2,title:'新建回收站',priority:51,blocks:['电力不足'],cost:{scrap:120,parts:0}},
    plan={next:{status:'ready',project,title:'下挖',reason:'施工条件满足'},productionProject:production};
  const check=fn(x,'shelterConstructionCheck')(m,plan,{projects:[]});
  assert.equal(check.selected.floor,40);assert.equal(check.selected.benefit,'增加探险位');
  assert.equal(check.production.type,'scrap');assert.ok(check.production.reasons.includes('电力不足'));
  assert.equal(fn(x,'shelterConstructionCheck')(m,null,null).status,'unavailable');
  const actual=x.plan(),real=fn(x,'shelterConstructionCheck')(actual.m,actual.development,actual.campaign);
  assert.equal(real.materials.partsPerHour,actual.m.production.parts);assert.ok(Object.hasOwn(real.basis,'openFloors'));
  assert.notEqual(real.productionStatus,'not-evaluated');
  const events=[],context={log:{add:(...args)=>events.push(args)},localStorage:{getItem:()=>null}};
  vm.runInNewContext(source.slice(source.indexOf('  function shelterCheckLog('),source.indexOf('  function shelterHandoffIdentity('))+';shelterCheckLog',context)('检查',{constructionCheck:check,developmentNext:plan.next});
  assert.deepEqual(Object.keys(events[0][2]),['constructionCheck']);assert.ok(JSON.stringify(check).length<2500);
});

test('在线优化预算：截止或200人大矩阵不保存半成品，不缓存为无解，闲人使用已核对首选',()=>{
  const x=setup(),model=x.m(),search=fn(x,'shelterFindAllocation'),first={id:5,room:4};
  const before=JSON.stringify(x.context.shelterState),cache=search.lastNoPlan;
  assert.equal(search(model,model.state.residents,2000,1,0).reason,'search-limit');
  const large={state:{residents:Array(200),rooms:Array(21)}};
  assert.equal(search(large,large.state.residents,2000,1,Number.MAX_SAFE_INTEGER).plan,null);
  assert.equal(search.lastNoPlan,cache);x.context.shelterOptimize=true;
  assert.equal(fn(x,'shelterIdleEmploymentAllocation')(large,large.state.residents,large.state.rooms,{},first),first);
  assert.equal(JSON.stringify(x.context.shelterState),before);
});

test('旧存档缺少培养记录也不能用装备或缺省策略绕过七项基础全10',()=>{
  const x=setup(),pair=x.f.view.state.residents.slice(3,5);
  for(const person of pair)for(const stat of Object.keys(person.stats))person.stats[stat]=10;
  for(const record of [undefined,{version:1,pairs:[]}]){
    assert.equal(x.api.pairAllowed(x.m(),pair,record),true);
    pair[0].stats.cha=9;assert.equal(x.api.pairAllowed(x.m(),pair,record),false);pair[0].stats.cha=10;
  }
});

test('建设让路保留主项目本金、额度、施工位和原房间；未决不穿插',()=>{
  const x=setup(),model=x.m(),choose=fn(x,'shelterIndependentProject');
  const primary={kind:'build',type:'training',floor:2,col:3,priority:20,blocks:[],cost:{scrap:400,parts:8}};
  const upgrade={kind:'upgrade',type:'scrap',id:4,priority:50,blocks:[],cost:{scrap:250,parts:6}};
  const policy={build:false,upgrade:true,dig:true,scrapReserve:50,partsReserve:2,scrapLimit:650,partsLimit:14,budgetReleases:[]};
  Object.assign(model.state.resources,{scrap:700,parts:16});
  const check=(p=policy,busy=0,head=primary,other=upgrade)=>choose(model,head,[head,other],p,busy);
  assert.equal(check(),upgrade);assert.equal(check({...policy,build:true}),primary);
  assert.equal(check({...policy,partsLimit:13}),primary);assert.equal(check({...policy,pending:true}),primary);
  assert.equal(check(policy,1),primary);assert.equal(check({...policy,upgrade:false}),primary);
  assert.equal(check(policy,0,{...primary,layout:{mergeInto:4}}).type,'training');
  model.state.resources.scrap--;assert.equal(check(),primary);
});

test('批准策略：同一主配对同训，逐格结算保持原训练室，到10直接转下一属性',()=>{
  const x=setup(),s=x.f.view.state;
  const first=x.schedule().actions.find(a=>a.preparation);assert.equal(first.id,4);x.apply(first);x.tick();
  const second=x.schedule().actions.find(a=>a.preparation);assert.equal(second.id,5);x.apply(second);x.tick();
  const p=s.residents.find(p=>p.id===4);p.stats.cha++;p.training=0;
  let plan=x.schedule();assert.ok(!plan.actions.some(a=>a.id===4&&a.role==='training-release'));
  assert.equal(p.roomId,93);assert.equal(x.api.valid(x.context.shelterState.campaign),true);
  assert.deepEqual(plain(plan.trainingDestinations),[]);
  p.stats.cha=10;x.tick();plan=x.schedule();
  const transfer=plan.actions.find(a=>a.id===4&&a.role==='training');
  assert.ok(transfer);assert.notEqual(transfer.room,93);assert.equal(transfer.preparation,true);
});

test('批准策略：HP60且低心情仍可入训，HP不足60不得入训',()=>{
  for(const hp of [59,60]){
    const x=setup(),p=x.f.view.state.residents.find(p=>p.id===4);p.hp=hp;p.happiness=10;
    const plan=x.schedule();assert.equal(plan.actions.some(a=>a.id===4&&a.preparation),hp===60);
  }
});

test('批准策略：人口封顶后的收尾记录合法，当前格结束即释放，不启动下一格',()=>{
  const x=setup(),a=x.schedule().actions.find(a=>a.preparation);x.apply(a);
  const p=x.f.view.state.residents.find(p=>p.id===a.id),r=x.f.view.state.rooms.find(r=>r.id===a.room);
  p.training=.4;x.tick();const role=x.context.shelterState.campaign.roles[0];
  const continuation=fn(x,'shelterParentContinuation'),finish=continuation(x.m(),p,r,role,false);
  assert.equal(finish.finishCurrent,true);assert.equal(finish.destination,undefined);
  assert.equal(x.api.valid({...x.context.shelterState.campaign,roles:[finish]}),true);
  const deadline=finish.until;x.tick();assert.equal(continuation(x.m(),p,r,finish,false).until,deadline);
  p.stats[finish.stat]++;p.training=0;x.tick();assert.equal(continuation(x.m(),p,r,finish,false),null);
  for(let id=10;id<=200;id++)x.f.view.state.residents.push({...plain(p),id,name:`居民${id}`,roomId:null});
  const plan=x.schedule();assert.equal(plan.actions.some(a=>a.preparation&&a.role==='training'),false);
  assert.deepEqual(plain(plan.parentResidents),[]);
});

test('批准策略：护士按真实席位排班，HP60可值班，无席位不占人',()=>{
  for(const roomAvailable of [false,true]){
    const x=setup(),s=x.f.view.state;Object.assign(x.f.campaign,{medical:true,training:false,parentPreparation:false});
    x.context.shelterCampaign=x.f.campaign;s.resources.stimpak=0;
    s.rooms=s.rooms.filter(r=>r.type!=='medbay');
    if(roomAvailable)s.rooms.push({...plain(s.rooms[0]),id:300,type:'medbay',level:1,width:1,incident:null});
    for(const p of s.residents.filter(p=>p.id>=4)){p.hp=60;p.stats.int=p.id===4?10:1;}
    const plan=x.api.plan(x.m(),{...x.f.campaign,development:true},x.context.shelterState.campaign,200);
    const nurses=plan.actions.filter(a=>a.role==='medical');
    assert.equal(nurses.length>0,roomAvailable);
    if(roomAvailable)assert.equal(nurses[0].id,4);
    else assert.equal(plan.reserved.includes(4),false);
  }
});

test('批准策略：受袭重伤可在确认前针后再次治疗，跳过对象在选人之前过滤',()=>{
  const x=setup(),s=x.f.view.state;
  s.rooms[0].incident={kind:'raiders',hp:80,maxHp:80};
  for(const id of [1,2]){const p=s.residents.find(p=>p.id===id);p.roomId=s.rooms[0].id;p.hp=20;}
  const cfg={...x.f.campaign,defense:true,medical:true,maintenanceOnly:true,training:false};
  const record={...x.context.shelterState.campaign,heals:[{id:1,at:x.m().now-1000}],skippedHealing:[1]};
  let plan=x.api.plan(x.m(),cfg,record,200);assert.equal(plan.healing.id,2);assert.equal(plan.healing.urgent,true);
  record.skippedHealing=[];record.heals.push({id:2,at:x.m().now-1000});
  plan=x.api.plan(x.m(),cfg,record,200);assert.ok(plan.healing);
  s.rooms[0].incident=null;plan=x.api.plan(x.m(),cfg,record,200);assert.equal(plan.healing,null);
  s.resources.stimpak=cfg.reserve;s.rooms[0].incident={kind:'raiders',hp:80,maxHp:80};
  assert.equal(x.api.plan(x.m(),cfg,record,200).healing,null);
});

test('批准策略：普通补针不占用可交接主配对，缺席位仅提出工程需求',()=>{
  const x=setup(),s=x.f.view.state;for(const p of s.residents.filter(p=>[4,5].includes(p.id)))Object.keys(p.stats).forEach(k=>p.stats[k]=10);
  const cfg={...x.f.campaign,medical:true,training:false,workshopFamilyReady:[4,5]};s.resources.stimpak=cfg.reserve;
  const plan=x.api.plan(x.m(),cfg,x.context.shelterState.campaign,200);
  assert.ok(!plan.actions.some(a=>a.role==='medical'&&[4,5].includes(a.id)));
});

test('批准策略：深挖期间满针仍自动安排临时护士，结束后按库存释放',()=>{
  const x=setup(),s=x.f.view.state;Object.assign(x.f.campaign,{training:false,parentPreparation:false,medical:true});
  s.rooms.push({...plain(s.rooms[0]),id:300,type:'medbay',level:1,width:1});
  s.digging={floor:20,doneAt:x.m().now+3600000};s.resources.stimpak=10;
  for(const p of s.residents.filter(p=>p.id>=4))p.hp=60;
  const nurse=x.schedule().actions.find(a=>a.kind==='assign'&&a.role==='medical');assert.ok(nurse);assert.equal(nurse.room,300);
  x.apply(nurse);x.tick();assert.ok(!x.schedule().actions.some(a=>a.id===nurse.id&&a.role==='medical-release'));
  s.digging=null;x.tick();assert.ok(x.schedule().actions.some(a=>a.id===nurse.id&&a.role==='medical-release'));
});

test('批准策略：救回独立于建设日额，跳过第一位后仍选择下一位',()=>{
  const x=setup(),s=x.f.view.state;
  for(const id of [4,5]){const p=s.residents.find(p=>p.id===id);p.hp=0;p.deadAt=x.m().now-60000;}
  x.context.shelterExecutionDeferred=c=>c.id===4;
  const revive=fn(x,'shelterRevivalChoice');
  const choice=revive(x.m(),{...x.f.construction,scrapLimit:0},x.context.shelterState,null,x.m().now);
  assert.equal(choice?.id,5);
});

test('批准策略：普通资源满仓且储备足够，不为继续囤积扩仓',()=>{
  const x=setup(),m=x.m();for(const k of ['food','water','power'])x.f.view.state.resources[k]=m.caps[k];
  const plan=x.api.development(x.m(),200,x.schedule(),null);
  assert.equal(plan.candidates.some(c=>c.type==='storage'&&c.storageDemand),false);
});

test('批准策略：可用其他宿舍接续旧家庭，不改已有感情或待产家庭',()=>{
  for(const established of [false,true]){
    const x=setup(),s=x.f.view.state;x.context.shelterState.families=[{a:4,b:5,room:7}];
    s.rooms.find(r=>r.id===7).unpowered=true;
    if(established)s.residents.find(p=>p.id===4).romance={partnerId:5};
    const before=x.context.shelterState.families[0].room;
    const moved=fn(x,'shelterRelocatePassiveFamilies')(x.m());
    assert.equal(moved,!established);
    assert.equal(x.context.shelterState.families[0].room===before,established);
  }
});
