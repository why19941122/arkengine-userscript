import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView,levelGateView} from './arkengine-shelter-campaign.fixture.mjs';
const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(name=>source.match(new RegExp(`const ${name}\\s*=[^;]*;`))[0]).join('\n');
const code=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const api=vm.runInNewContext(`${declarations}\n${code}\n({model:shelterModel,plan:shelterCampaignPlan,defense:shelterDefensePlan,level:shelterLevelProgress,development:shelterDevelopmentPlan,daily:shelterDailyGoals,evidence:shelterTripEvidence,valid:validCampaignRecord})`,{
  objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
const now=2_000_000_000;
function evidence(){
  const v=campaignView(),e={id:42,residentId:5,tier:0,abyss:false,startedAt:now-7*3600000,recalledAt:null,returnAt:null};
  v.state.residents[4].away={kind:'explore'};v.state.explorers=[e];
  const base={pageId:'original-page',detail:'普通探险区域0，计划6小时；不加速、不进入深渊'},targets=[5,0,2],at=e.startedAt;
  return {v,e,events:[{...base,at:at-100,type:'shelter-submitted',data:{kind:'explore-start',targets}},
    {...base,at:at+1000,type:'request-result',data:{path:'/api/shelter/action',startedAt:at-100,status:200,outcome:'ok',redirected:false}},
    {...base,at:at+3000,type:'shelter-campaign-confirmed',data:{kind:'explore-start',targets,mission:42,at:at+200}},
    {...base,at:at+3001,type:'shelter-confirmed',data:{kind:'explore-start',targets}}]};
}
test('行程恢复：原成功链匹配才恢复旧时长，到点仍优先召回',()=>{
  const {v,e,events}=evidence(),m=api.model(v),trip=api.evidence(m,e,events);assert.equal(trip.hours,6);
  const p=api.plan(m,{explore:true,hours:2,sodaEfficiency:true},{trips:[trip]},14);
  assert.equal(p.choice.kind,'explore-recall');assert.equal(p.trips[0].recallAt,e.startedAt+6*3600000);
});
test('行程恢复：拒绝缺链、重复凭据、错账号、错时间、错人物和深渊',()=>{
  const {v,e,events}=evidence(),m=api.model(v);
  for(let i=0;i<events.length;i++)assert.equal(api.evidence(m,e,events.filter((_,j)=>j!==i)),null);
  assert.equal(api.evidence(m,e,[...events,events[2]]),null);
  for(const change of [{residentId:6},{id:43},{startedAt:e.startedAt-60001},{abyss:true}])assert.equal(api.evidence(m,{...e,...change},events),null);
  const wrong=structuredClone(events);wrong[2].data.vaultNo=88;assert.equal(api.evidence(m,e,wrong),null);
  const changed=structuredClone(events);changed[2].detail='unknown';assert.equal(api.evidence(m,e,changed),null);
});
test('行程诊断：无证据外出不接管，显示未管理；原时长不被推荐设置覆盖',()=>{
  const {v,e}=evidence(),m=api.model(v),p=api.plan(m,{explore:true,hours:2},{},14);
  assert.equal(p.trips[0].managed,false);assert.match(p.notes.join('\n'),/没有可核对的原行程/);
  const owned=api.plan(m,{explore:true,hours:2},{trips:[{id:42,resident:5,hours:12,at:e.startedAt}]},14);
  assert.ok(!owned.actions.some(a=>a.kind==='explore-recall'));assert.match(owned.notes.join('\n'),/原计划外出 12 小时/);
});
function raid(){const v=campaignView();v.state.rooms.push({id:90,type:'door',floor:1,col:0,width:1,level:1,builtAt:0,upgradeAt:null,unpowered:false,stored:0,incident:{kind:'raiders',hp:80,maxHp:80}});return v;}
test('防守：健康成人超员增援，零库存与临时停产不阻止退敌',()=>{
  const v=raid(),p=api.defense(api.model(v),{defense:true});assert.equal(p.actions.length,6);
  for(const a of p.actions){assert.equal(a.room,90);assert.equal(a.original,v.state.residents.find(p=>p.id===a.id).roomId);}
  v.state.residents[4].hp=1;assert.ok(!api.defense(api.model(v),{defense:true}).actions.some(a=>a.id===5));
  v.state.resources.power=0;v.state.resources.food=0;v.state.resources.water=0;
  assert.ok([1,2,3].every(id=>api.defense(api.model(v),{defense:true}).actions.some(a=>a.id===id)),'零库存也应撤出供应人员参加退敌');
  v.state.rooms[0].unpowered=true;v.state.rooms[1].type='medbay';
  v.state.residents[2].romance={partnerId:6};
  assert.ok([1,2,3].every(id=>api.defense(api.model(v),{defense:true},{familyReserved:[3]}).actions.some(a=>a.id===id)),
    '停电、特殊值班和感情培养不能阻止紧急增援，原岗位会记录');
});
test('防守：掠夺者入室后直接追击，整场结束才回最初岗位，自动挤出也能复岗',()=>{
  const v=raid(),p=v.state.residents[3];p.roomId=90;const journal={defense:[{id:4,room:90,from:4,at:now-1000}]};
  v.state.rooms.find(r=>r.id===90).incident=null;v.state.rooms[0].incident={kind:'raiders',hp:60,maxHp:80};
  let plan=api.defense(api.model(v),{defense:true},journal);const chase=plan.actions.find(a=>a.id===4);
  assert.equal(chase.room,1);assert.equal(chase.original,4);assert.equal(chase.role,'defense');
  p.roomId=null;v.state.rooms[0].incident=null;journal.defense[0].room=1;
  plan=api.defense(api.model(v),{defense:true},journal);assert.equal(plan.actions.find(a=>a.id===4).room,4);
  p.roomId=5;assert.ok(!api.defense(api.model(v),{defense:true},journal).actions.some(a=>a.id===4));
});
test('防守：暂停、原岗位满员和人工接手不能强行调回',()=>{
  const v=raid();v.state.rooms.find(r=>r.id===90).incident=null;v.state.residents[3].roomId=90;
  const record={defense:[{id:4,room:90,from:4,at:now-1}]};
  assert.equal(api.defense(api.model(v),{defense:false},record).actions.length,0);
  v.state.residents[4].roomId=4;v.state.residents[5].roomId=4;
  assert.ok(!api.defense(api.model(v),{defense:true},record).actions.some(a=>a.id===4));
});
test('防守：入室追击允许超过普通房间容量，全部追击保留原岗位',()=>{
  const v=raid();assert.equal(api.defense(api.model(v),{defense:true}).actions.length,6);
  v.state.residents[3].roomId=90;v.state.residents[4].roomId=90;
  const record={defense:[{id:4,room:90,from:4,at:now-1},{id:5,room:90,from:null,at:now-1}]};
  v.state.rooms.find(r=>r.id===90).incident=null;v.state.rooms[0].incident={kind:'raiders',hp:60,maxHp:80};
  let plan=api.defense(api.model(v),{defense:true},record);assert.ok(plan.actions.length>2);assert.ok(plan.actions.every(a=>a.room===1));
  v.state.residents[5].roomId=1;v.state.residents[5].away={kind:'explore'};
  plan=api.defense(api.model(v),{defense:true},record);assert.equal(plan.actions.filter(a=>[4,5].includes(a.id)&&a.room===1).length,2);
});
test('等级规划：按62/66计分，居民经验不凑等级；为锁定工坊选择有生产收益的升级',()=>{
  const v=levelGateView(),m=api.model(v);assert.equal(api.level(m).score,62);assert.equal(api.level(m).next,66);
  v.state.residents[0].xp+=10000;assert.equal(api.level(api.model(v)).score,62);
  const c={enabled:true,reserved:[],projects:[{type:'workshop',person:15,priority:25,benefit:'需要零件'}]};
  const p=api.development(api.model(v),14,c);assert.ok(p.candidates.some(c=>c.levelTarget===5&&c.kind==='upgrade'));
  assert.equal(p.next.project.levelTarget,5);assert.equal(p.next.project.strategy,undefined);assert.notEqual(p.next.status,'blocked');
});
test('等级规划：待产与已开工覆盖缺口就等待，事件中不追加等级消费',()=>{
  const v=levelGateView();v.state.rooms[0].upgradeAt=now+3600000;v.state.births=[{roomId:5,dueAt:now+3600000}];
  const c={enabled:true,reserved:[],projects:[{type:'workshop',person:15,priority:25,benefit:'需要零件'}]};
  const p=api.development(api.model(v),14,c);assert.equal(p.levelProgress.committed,66);
  assert.ok(!p.candidates.some(c=>c.levelTarget));
  v.state.births=[];v.state.rooms[0].upgradeAt=null;v.state.rooms[0].incident={kind:'raiders',hp:70,maxHp:80};
  assert.ok(!api.development(api.model(v),14,c).candidates.some(c=>c.levelTarget));
});
test('探险幸运：同战力优先有效幸运，不为幸运降低战力或改变汽水概率',()=>{
  const v=campaignView(),cfg={explore:true,hours:6,tier:0,stimpaks:2,reserve:2};
  v.state.residents[3].away={kind:'quest'};v.state.residents[4].stats.lck=1;v.state.residents[5].stats.lck=9;
  let p=api.plan(api.model(v),cfg,{},14);assert.equal(p.actions.find(a=>a.kind==='explore-start').id,6);
  v.state.residents[4].stats.str=9;p=api.plan(api.model(v),cfg,{},14);assert.equal(p.actions.find(a=>a.kind==='explore-start').id,5);
});
test('工坊：当前升级缺零件时预留值班人选，材料备齐或缺供料后释放自动岗位',()=>{
  const v=campaignView(),s=v.state;
  s.rooms.find(r=>r.id===4).level=2;s.residents[4].roomId=4;s.residents[5].roomId=5;s.resources.parts=0;
  s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1});
  let p=api.plan(api.model(v),{workshop:true,partsTarget:15,workshopScrapReserve:100});
  const a=p.actions.find(a=>a.role==='workshop');assert.ok(a);assert.equal(a.room,90);
  s.residents.find(p=>p.id===a.id).roomId=90;
  const record={roles:[{id:a.id,room:90,role:'workshop',at:now-1}]};
  p=api.plan(api.model(v),{workshop:true,partsTarget:15,workshopScrapReserve:100},record);
  assert.ok(p.reserved.includes(a.id));assert.ok(!p.actions.some(a=>a.role==='workshop-release'));
  s.resources.parts=15;p=api.plan(api.model(v),{workshop:true,partsTarget:15,workshopScrapReserve:100},record);
  assert.ok(p.actions.some(a=>a.id===record.roles[0].id&&a.role==='workshop-release'&&a.room===null));
  s.resources.parts=0;s.resources.scrap=100;
  assert.ok(api.plan(api.model(v),{workshop:true,partsTarget:15,workshopScrapReserve:100},record).actions.some(a=>a.role==='workshop-release'));
  assert.ok(!api.plan(api.model(v),{workshop:true,partsTarget:15,workshopScrapReserve:100},{}).actions.some(a=>a.role==='workshop-release'),'不撤销人工工坊岗位');
});
test('每日目标：读取网站目标及计数，奖励不提前计入库存，损坏数据不猜测',()=>{
  const v=campaignView();v.state.daily={day:'2026-11-05',claimed:[],counters:{build:1,win:1,collect_scrap:405},
    picks:[['build',2],['win',5],['collect_scrap',600]].map(([key,target])=>({key,target,reward:{scrap:240,parts:2,points:30}}))};
  const m=api.model(v),p=api.daily(m);assert.deepEqual(Array.from(p.goals,g=>g.remaining),[1,4,195]);
  assert.equal(m.state.resources.scrap,3000);assert.match(p.notes.join('\n'),/不保证战斗必胜/);
  v.state.daily.counters.win=-1;assert.equal(api.daily(api.model(v)).goals.length,0);
});
test('每日训练：达到普通目标仍可为每日目标练一格，达标后不继续额外训练',()=>{
  const v=campaignView();v.state.rooms.push({...v.state.rooms[0],id:90,type:'training',trainStat:'agi',floor:2,col:4});
  v.state.daily.picks=['train','craft','caravan'].map(key=>({key,target:1,reward:{scrap:240,parts:2,points:30}}));v.state.daily.counters={};
  const cfg={dailyGoals:true,training:true,trainTarget:6};
  let p=api.plan(api.model(v),cfg);assert.ok(p.actions.some(a=>a.role==='training'));
  v.state.daily.counters.train=1;p=api.plan(api.model(v),cfg);assert.ok(!p.actions.some(a=>a.role==='training'));
  assert.match(p.notes.join('\n'),/商队订单尚需手动/);
});
test('每日收集：保留零点前所需产能，达标后允许原人选外出；防守不受该预留影响',()=>{
  const v=campaignView(Date.parse('2026-11-05T23:30:00+08:00'));
  v.state.daily={day:'2026-11-05',claimed:[],counters:{},picks:['collect_scrap','craft','caravan'].map(key=>({key,target:600,reward:{scrap:240,parts:2,points:30}}))};
  const cfg={dailyGoals:true,explore:true,tier:0,hours:6,stimpaks:2,reserve:2};
  let p=api.plan(api.model(v),cfg);assert.ok(!p.actions.some(a=>a.kind==='explore-start'&&a.id===4));assert.match(p.notes.join('\n'),/保留 1 名现有产出人员/);
  v.state.daily.counters.collect_scrap=600;p=api.plan(api.model(v),cfg);assert.doesNotMatch(p.notes.join('\n'),/保留 1 名现有产出人员/);
  v.state.daily.counters.collect_scrap=0;v.state.rooms[1].incident={kind:'raiders',hp:80,maxHp:80};
  p=api.plan(api.model(v),{...cfg,defense:true});assert.ok(p.actions.some(a=>a.role==='defense'&&a.id===4));
});
