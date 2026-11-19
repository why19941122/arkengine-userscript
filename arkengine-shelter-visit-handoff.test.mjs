import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
function setup(){
  const start=Date.parse('2026-11-14T10:00:00+08:00'),storage=new Map(),offers=[];
  const c={shelterEntryAt:start,clock:start,shelterState:{vaultNo:77,nextAt:0},farmState:{expeditionAt:start+120000},
    shelterWork:null,shelterWorkConfirm:null,shelterPending:null,shelterBuildWork:null,shelterRecallWork:null,
    shelterStaffHold:false,shelterCampaignHeld:'',shelterExploreManualUntil:0,shelterConstructionDone:false,
    shelterEnabled:true,enabled:true,farmEnabled:false,farmPlan:null,shelterRead:{model:{view:{vaultNo:77},state:{rooms:[],residents:[]}}},
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    localStorage:{getItem:()=>null},log:{add(){}},shelterReload:()=>false,stateFault:()=>false,
    cancelShelterRead(){},cancelQueued(){},rememberExpeditionTime(){},travelLink:()=>({}),startNavigation(){},
    scheduledVisits:()=>[{path:'/stock',at:start+300000}],
    offer:(key,label,fn)=>offers.push({key,label,fn}),objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x)};
  c.Date=class extends Date{static now(){return c.clock;}};
  const first=source.includes('  function shelterHandoffIdentity(')?'  function shelterHandoffIdentity(':'  function shelterVisitBudget(';
  const api=vm.runInNewContext(part(first,'  function finishShelter(')+part('  function maybeVisitShelter(','  function shelterFits(')+
    '\n({budget:shelterVisitBudget,visit:maybeVisitShelter})',c);
  return {c,api,offers,storage,start};
}

test('避难所访问准入：20秒和不足一分钟有效工作窗口不切页，75秒起可进入',()=>{
  for(const seconds of [14,20,60,74,75,120]){
    const x=setup();x.c.farmState.expeditionAt=x.start+seconds*1000;
    assert.equal(x.api.visit(null),seconds>=75,String(seconds));
    assert.equal(x.offers.length,seconds>=75?1:0);
  }
});

test('避难所新访问：统一导航清理旧时限，四十分钟后的远征不会使新访问立即退出',()=>{
  const state=setup();state.c.farmState.expeditionAt=state.start+40*60000;
  state.storage.set('arkengine:auto-shelter:handoff:v1',JSON.stringify({vaultNo:77,entryAt:state.start-10*60000,
    expeditionAt:state.start+40*60000,regularEnd:state.start-300000,key:null}));
  assert.equal(state.api.budget().limitMs,-300000);
  state.c.location={pathname:'/stock'};state.c.NAV_JOURNAL='navigation';state.c.navigation=null;
  const navigate=vm.runInNewContext(part('  function startNavigation(','  function waitForNavigation(')+'\nstartNavigation',state.c);
  navigate('/shelter',{click(){state.c.location.pathname='/shelter';}});
  assert.equal(state.api.budget().limitMs,300000);
  state.c.clock+=60000;state.c.shelterEntryAt=state.c.clock;
  assert.equal(state.api.budget().limitMs,240000,'刷新不获得新的五分钟');
});

test('避难所交接：已打开的就业窗口可继续，截止按原到期时间，不滚动续期',()=>{
  const x=setup();x.api.budget();
  x.c.shelterWork={kind:'assign',id:9,room:4,from:null,idleEmployment:true,openedAt:x.start+60000};
  x.c.clock=x.start+106000;const p=x.api.budget();
  assert.equal(p.handoffOnly,true);assert.equal(p.finishLimitMs,225000);assert.equal(p.limitMs,225000);
  x.c.clock+=30000;assert.equal(x.api.budget().finishLimitMs,225000);
  assert.equal(p.handoffDeadline,x.start+240000);
});

test('避难所交接：后台规划、普通建设和未打开的意图不能获得两分钟宽限',()=>{
  for(const kind of ['none','build','new-training','unopened','late-open']){
    const x=setup();x.api.budget();x.c.clock=x.start+106000;
    if(kind==='build')x.c.shelterBuildWork={openedAt:x.start+60000,project:{kind:'upgrade'}};
    if(kind==='new-training')x.c.shelterWork={id:9,room:4,role:'training',openedAt:x.start+60000};
    if(kind==='unopened')x.c.shelterWork={id:9,room:4,idleEmployment:true,openedAt:0};
    if(kind==='late-open')x.c.shelterWork={id:9,room:4,idleEmployment:true,openedAt:x.c.clock};
    assert.ok(!x.api.budget().handoffOnly,kind);assert.equal(x.api.budget().limitMs,105000);
  }
});

test('避难所交接：部分完成的原配对跨刷新保留绝对期限，不能借新交接续时',()=>{
  const x=setup();x.api.budget();x.c.shelterState.pair={a:5,b:6,room:7,at:x.start+1000,step:1,release:false};
  x.c.clock=x.start+106000;const first=x.api.budget();assert.equal(first.handoffOnly,true);
  x.c.clock=x.start+150000;x.c.shelterEntryAt=x.c.clock;
  const after=x.api.budget();assert.equal(after.handoffDeadline,first.handoffDeadline);
  assert.equal(x.c.shelterEntryAt+after.finishLimitMs,x.start+225000);
  x.c.shelterState.pair={...x.c.shelterState.pair,at:x.c.clock};
  assert.ok(!x.api.budget().handoffOnly,'new pair is not the original handoff');
});

test('避难所交接：原换位只在实际已开始时继续，完整结束后立即让出页面',()=>{
  const x=setup();x.api.budget();x.c.shelterState.swap={id:'original',at:x.start+1000,step:0,moves:[{id:5,room:null},{id:6,room:4},{id:5,room:3}]};
  x.c.clock=x.start+106000;assert.ok(!x.api.budget().handoffOnly);
  x.c.shelterState.swap.step=1;assert.equal(x.api.budget().handoffOnly,true);
  x.c.shelterState.swap=null;assert.ok(!x.api.budget().handoffOnly);
  assert.ok(x.api.budget().limitMs<x.c.clock-x.c.shelterEntryAt);
});

test('避难所预约交接：远征尚远，股市到期给原换位收尾，不另起新任务',()=>{
  const state=setup();state.c.farmState.expeditionAt=state.start+40*60000;state.api.budget();
  state.c.shelterState.swap={id:'started',at:state.start+1000,step:2,moves:[{id:5,room:null},{id:6,room:4},{id:5,room:3}]};
  state.c.clock=state.start+301000;
  assert.equal(state.api.budget().handoffOnly,true);
  assert.equal(state.api.budget().finishLimitMs,405000);
  state.c.shelterState.swap=null;
  assert.equal(state.api.budget().handoffOnly,false);
  assert.equal(state.api.budget().limitMs,300000);
});

test('避难所预约交接：无其他到期任务时可继续安排人员，直至远征归来前十五秒',()=>{
  const state=setup();state.c.farmState.expeditionAt=state.start+40*60000;
  state.c.scheduledVisits=()=>[{path:'/stock',at:Infinity},{path:'/cultivate',at:Infinity}];
  state.c.clock=state.start+6*60000;
  assert.equal(state.api.budget().limitMs,40*60000-15000);
  state.c.shelterEntryAt=state.c.clock;
  assert.equal(state.api.budget().limitMs,34*60000-15000);
});

test('避难所交接：刷新时存储不可读或凭据损坏，不能把已到期远征当作新的五分钟访问',()=>{
  for(const kind of ['unreadable','malformed','identity']){
    const x=setup();x.api.budget();x.c.clock=x.start+160000;x.c.shelterEntryAt=x.c.clock;
    x.c.shelterState.pair={a:5,b:6,room:7,at:x.start+1000,step:1};
    if(kind==='unreadable')x.c.sessionStorage.getItem=()=>{throw Error('storage unavailable');};
    else x.storage.set('arkengine:auto-shelter:handoff:v1',kind==='malformed'?'{':JSON.stringify({vaultNo:88,entryAt:x.start,expeditionAt:x.start+120000,key:null}));
    const p=x.api.budget();assert.equal(p.handoffOnly,false);assert.equal(p.finishLimitMs,0);
  }
});

test('避难所交接：已确认第一步但step尚未推进仍可接续，不借原配对完成另一项训练',()=>{
  const x=setup();x.api.budget();x.c.clock=x.start+106000;
  x.c.shelterState.pair={a:5,b:6,room:7,at:x.start+1000,step:0};
  x.c.shelterRead.model.state.residents=[{id:5,roomId:7},{id:6,roomId:4}];
  assert.equal(x.api.budget().handoffOnly,true);
  x.c.shelterWork={id:9,room:30,role:'training',openedAt:x.start+1000};
  assert.equal(x.api.budget().handoffOnly,false);
});

test('避难所交接：人工接手、事件、取消和期限到达不再授权新发送',()=>{
  for(const kind of ['manual','incident','cancel','expired','storage']){
    const x=setup();x.api.budget();x.c.shelterWork={id:9,room:4,idleEmployment:true,openedAt:x.start+1000};
    x.c.clock=x.start+106000;
    if(kind==='manual')x.c.shelterExploreManualUntil=x.c.clock+60000;
    if(kind==='incident')x.c.shelterRead.model.state.rooms.push({incident:{kind:'fire'}});
    if(kind==='cancel')x.c.shelterWork.closing=true;
    if(kind==='expired')x.c.clock=x.start+225000;
    if(kind==='storage')x.c.sessionStorage.setItem=()=>{throw Error('storage unavailable');};
    assert.ok(!x.api.budget().handoffOnly,kind);
  }
});

test('避难所交接：跨日与凌晨突发窗口优先，原交接不能无限延期',()=>{
  for(const clock of [Date.parse('2026-11-14T23:59:00+08:00'),Date.parse('2026-11-15T00:59:00+08:00')]){
    const x=setup();x.c.clock=x.c.shelterEntryAt=clock;x.c.farmState.expeditionAt=clock+30000;x.api.budget();
    x.c.shelterWork={id:9,room:4,idleEmployment:true,openedAt:clock+1000};x.c.clock+=16000;
    assert.ok(x.c.shelterEntryAt+x.api.budget().finishLimitMs<=clock+45000);
  }
  const x=setup();x.c.farmState.expeditionAt=x.start+290000;x.api.budget();
  x.c.shelterWork={id:9,room:4,idleEmployment:true,openedAt:x.start+270000};x.c.clock=x.start+280000;
  assert.equal(x.api.budget().finishLimitMs,395000);
});
