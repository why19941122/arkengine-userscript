import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
function setup(path='/farm'){
  const at=Date.parse('2026-11-19T12:00:00+08:00'),offers=[],navigations=[],storage=new Map();
  const context={clock:at,location:{pathname:path},farmState:{nextAt:at+360000,expeditionAt:at+2400000,expeditionReviewAt:at+3600000},
    farmEnabled:true,shelterEnabled:true,shelterState:{nextAt:at+900000},stockLedger:{nextAt:at+300000},stockFault:false,
    stockEnabled:()=>true,stockCapacityWait:()=>false,stockCanConfirmHere:()=>false,stateFault:()=>false,
    cultivation:{dueAt:()=>at+360000},shelterPending:null,farmPlan:null,plan:null,claimWait:null,
    nativePending:()=>[],shelterReadOnlyWait:()=>false,shelterReload:()=>false,stockReload:()=>false,stockCheckRequested:false,
    stockRecoverRejectedHold:()=>false,
    cancelQueued(){},cancelStockRead(){},cancelShelterRead(){},schedule(){},say(){},visible:()=>true,
    document:{querySelectorAll:()=>[]},sessionStorage:{removeItem:key=>storage.delete(key)},
    travelLink:path=>({path}),offer:(key,label,callback)=>offers.push({key,label,callback}),
    startNavigation:path=>navigations.push(path),textOf:element=>element.textContent,
    farmStaminaNeed:()=>null,displayedStamina:()=>null};
  context.Date=class extends Date{static now(){return context.clock;}};
  context.saveFarmState=state=>context.farmState=state;
  const api=vm.runInNewContext(part('  function rememberExpeditionTime(','  function overduePatrol(')+
    part('  function scheduledVisits(','  function farmSnapshot(')+
    part('  function maybeVisitStock(','  function readStock(')+
    part('  function maybeVisitShelter(','  function shelterFits(')+
    '\n({finish:finishScheduledVisit,remember:rememberExpeditionTime})',context);
  return {context,api,at,offers,navigations};
}

test('页面预约：远征四十分钟后归来，无到期任务不切换、不推迟原预约',()=>{
  const state=setup(),before=JSON.stringify(state.context.farmState);
  for(let index=0;index<20;index++){state.api.finish('farm');state.context.clock+=1000;}
  assert.equal(state.offers.length,0);assert.equal(JSON.stringify(state.context.farmState),before);
  state.context.clock=state.at+2400000-15001;state.context.farmEnabled=false;state.context.shelterEnabled=false;
  state.context.stockEnabled=()=>false;state.context.cultivation.dueAt=()=>Infinity;
  state.api.finish('farm');assert.equal(state.offers.length,0);
  state.context.clock++;state.api.finish('farm');state.offers[0].callback();
  assert.deepEqual(state.navigations,['/activities/expedition']);
});

test('避难所等待预约时显示本次撤销原因，不把未执行动作报成本轮完成',()=>{
  const {api,context}=setup('/shelter');let message;
  context.say=text=>{message=text;};context.shelterState.note='已撤销动作本轮先让路，一分钟内重新核对';
  api.finish('shelter');assert.ok(message.includes(context.shelterState.note));assert.doesNotMatch(message,/本轮完成/);
});

test('页面预约：到期奇遇直接从农场进入，跨页不清空归来时间',()=>{
  const state=setup();state.context.cultivation.dueAt=()=>state.context.clock;
  state.api.finish('farm');assert.equal(state.offers.length,1);state.offers[0].callback();
  assert.deepEqual(state.navigations,['/cultivate']);assert.equal(state.context.farmState.expeditionAt,state.at+2400000);
});

test('页面预约：人工窗口和未决原请求不会被普通奇遇访问越过',()=>{
  for(const condition of ['dialog','shelter','farm','stock']){
    const state=setup();state.context.cultivation.dueAt=()=>state.context.clock;
    if(condition==='dialog')state.context.document.querySelectorAll=()=>[{}];
    if(condition==='shelter')state.context.shelterPending={id:'original'};
    if(condition==='farm')state.context.farmPlan={id:'original'};
    if(condition==='stock')state.context.stockLedger.pending={id:'original'};
    state.api.finish('farm');assert.equal(state.offers.length,0,condition);
  }
});

test('页面预约：当前页面到期可重新检查，无需绕远征刷新访问',()=>{
  const state=setup('/shelter');state.context.shelterState.nextAt=state.at;
  state.context.shelterEntryAt=state.at-1000;state.context.shelterLeave=true;
  state.api.finish('shelter');assert.equal(state.context.shelterEntryAt,0);assert.equal(state.context.shelterLeave,false);
  assert.equal(state.offers.length,0);
});

test('页面预约：远征页面读取实际完整到达时间，并保留跨日核对预约',()=>{
  const state=setup('/activities/expedition'),arrival=new Date(state.at+2400000);
  const text=arrival.getFullYear()+'/'+(arrival.getMonth()+1)+'/'+arrival.getDate()+' '+arrival.toTimeString().slice(0,8);
  state.context.farmState={nextAt:state.at+60000};state.api.remember({querySelectorAll:()=>[{textContent:'完整到达: '+text}]});
  assert.equal(state.context.farmState.expeditionAt,state.at+2400000);
  assert.equal(state.context.farmState.expeditionReviewAt,state.at+3600000);
  state.context.location.pathname='/stock';state.api.remember(null);
  assert.equal(state.context.farmState.expeditionAt,state.at+2400000);
});
