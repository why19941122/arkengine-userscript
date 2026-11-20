import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function setup(){
  const state=setupPowerInvestment(source),context=state.context,now=state.f.view.serverTime;
  const original={id:'rejected-rescue',kind:'rescue',targets:[1],vaultNo:state.f.view.vaultNo,at:now-28*60000,
    lifecycle:{version:1,phase:'request-bound',requestKey:'rescue-request-key',boundAt:now-28*60000},
    before:{serverTime:now-28*60000,present:69,incidentKind:'raiders'},
    result:{status:400,outcome:'http-error',responseFinishedAt:now-28*60000+847}};
  Object.assign(context,{shelterPending:original,continueShelterAction:null,awaitingShelterConfirmation:null,
    shelterWorkConfirm:null,shelterRescueWork:null,shelterRescueSkipped:new Set(),accountStopReason:()=>'',
    shelterWriteGuard(){},cancelQueued(){},cancelShelterRead(){},shelterActionMatches:(actual,expected)=>JSON.stringify(actual)===JSON.stringify(expected),
    shelterRequestAction:()=>({type:'rescue_incident',roomId:1})});
  context.saveShelterPending=value=>context.shelterPending=value;
  const api=vm.runInContext(source.slice(source.indexOf('  function shelterRescueCount('),source.indexOf('  function closeShelterRescue('))+
    '\n({recover:typeof reconcileShelterRescue===\'function\'?reconcileShelterRescue:()=>false,proof:shelterRescueProof,settled:shelterRescueSettled})',context);
  state.f.view.state.rooms[0].incident={kind:'raiders',hp:98,maxHp:100};
  const model=state.api.model(state.f.view);context.shelterRead={model,at:now,startedAt:now-100};
  return {...state,api,model,original,now};
}

test('救援拒绝恢复：旧400缺少正文也归档原单，保留事件停发记录并解除全局等待',()=>{
  const state=setup();state.context.shelterState.pendingReadOnly=state.original.id;
  assert.equal(state.api.recover(state.model),true);
  assert.equal(state.context.shelterPending,null);
  const saved=state.context.shelterState;
  assert.deepEqual(structuredClone(saved.rescueRecovery.original),state.original);
  assert.equal(saved.rescueRecovery.outcome,'http-rejected');
  assert.equal(saved.rescueRecovery.snapshotAt,state.model.now);
  assert.equal(saved.rescueStops[0].rejected,true);
  assert.equal(saved.pendingReadOnly,undefined);
  assert.equal(saved.nextAt,0);
});

test('救援拒绝恢复：事件已结束仍保留原单，但不残留该事件停发记录',()=>{
  const state=setup();state.model.state.rooms[0].incident=null;
  assert.equal(state.api.recover(state.model),true);
  assert.equal(state.context.shelterState.rescueStops.length,0);
  assert.equal(state.context.shelterState.rescueRecovery.original.id,state.original.id);
});

test('救援拒绝恢复：未知传输、陈旧读取、错误归属及重试响应不能解除全局等待',()=>{
  for(const boundary of ['transport','success','server','conflict','auth','rate','unfinished','old-read','old-model','stale','vault','unbound',
    'key','bound-time','retry','emergency','active','frozen','account']){
    const state=setup(),context=state.context,record=state.original;
    if(boundary==='transport')record.result.outcome='network-error';
    if(boundary==='success')record.result.status=200;
    if(boundary==='server')record.result.status=503;
    if(boundary==='conflict')record.result.status=409;
    if(boundary==='auth')record.result.status=403;
    if(boundary==='rate')record.result.status=429;
    if(boundary==='unfinished')delete record.result.responseFinishedAt;
    if(boundary==='old-read')context.shelterRead.startedAt=record.result.responseFinishedAt-1;
    if(boundary==='old-model')state.model.now=record.before.serverTime-1;
    if(boundary==='stale')context.shelterRead.at-=2000;
    if(boundary==='vault')record.vaultNo++;
    if(boundary==='unbound')record.lifecycle.phase='prepared';
    if(boundary==='key')record.lifecycle.requestKey='';
    if(boundary==='bound-time')record.lifecycle.boundAt=record.result.responseFinishedAt+1;
    if(boundary==='retry')record.result.retry=true;
    if(boundary==='emergency')record.emergency={id:'independent'};
    if(boundary==='active')context.continueShelterAction={id:record.id};
    if(boundary==='frozen')state.model.view.switches.frozen=true;
    if(boundary==='account')context.accountStopReason=()=> 'stopped';
    assert.equal(state.api.recover(state.model),false,boundary);
    assert.equal(context.shelterPending,record,boundary);
    assert.equal(context.shelterState.rescueRecovery,undefined,boundary);
  }
});

test('救援拒绝恢复：归档写入失败时必须保留原待核对记录',()=>{
  const state=setup();state.context.saveShelter=()=>{throw Error('archive unavailable');};
  assert.throws(()=>state.api.recover(state.model),/archive unavailable/);
  assert.equal(state.context.shelterPending,state.original);
});

test('救援拒绝恢复：4xx文案不伪造成功回执',()=>{
  const state=setup(),request={idempotencyKey:state.original.lifecycle.requestKey,action:{type:'rescue_incident',roomId:1}};
  assert.equal(state.api.proof(state.original,400,request,{error:'没有可用居民'}),null);
});

test('救援拒绝恢复：旧4xx兼容回执不能冒充成功，真实2xx仍按绑定凭据核验',()=>{
  const state=setup(),record=state.original;
  record.result.rescueProof={key:record.lifecycle.requestKey,room:1,at:record.before.serverTime,present:69};
  assert.equal(state.api.settled(record,state.model,state.context.shelterRead.startedAt),false);
  Object.assign(record.result,{status:200,outcome:'ok'});
  assert.equal(state.api.settled(record,state.model,state.context.shelterRead.startedAt),true);
  record.result.retry=true;
  assert.equal(state.api.settled(record,state.model,state.context.shelterRead.startedAt),false);
});
