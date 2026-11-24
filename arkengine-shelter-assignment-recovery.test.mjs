import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function setup(position='original'){
  const state=setupPowerInvestment(source),context=state.context,now=state.f.view.serverTime;
  const resident=state.f.view.state.residents.find(person=>person.deadAt===null&&person.away===null);
  const room=state.f.view.state.rooms.find(candidate=>candidate.type==='training');
  resident.hp=100;resident.stats[room.trainStat]=3;
  const original={id:'assignment-http-520',kind:'assign',targets:[resident.id,room.id],vaultNo:state.f.view.vaultNo,
    at:now-720000,campaignKey:'assignment-request-key',
    lifecycle:{version:1,phase:'request-bound',page:'old-page',requestKey:'assignment-request-key',boundAt:now-720000},
    before:{serverTime:now-720000,room:resident.roomId,collected:0,day:'2026-11-20',month:'2026-11',
      campaign:{choice:{kind:'assign',targets:[resident.id,room.id],id:resident.id,name:resident.name,room:room.id,
        role:'training',stat:room.trainStat,base:3},ids:[],hp:100}},
    result:{status:520,outcome:'http-error',responseFinishedAt:now-678000}};
  if(position==='training'){resident.roomId=room.id;resident.training=.9;}
  Object.assign(context,{shelterPending:original,continueShelterAction:null,awaitingShelterConfirmation:null,
    shelterWorkConfirm:null,shelterWork:null,accountStopReason:()=>'',shelterWriteGuard(){},cancelQueued(){},
    cancelShelterRead(){},schedule(){},shelterExecutionDeferrals:new Map()});
  context.readShelter=()=>{context.reads=(context.reads||0)+1;};
  context.saveShelterPending=value=>context.shelterPending=value;
  const start=source.indexOf('  function reconcileShelterAssignment(');
  const recover=start<0?()=>false:vm.runInContext(source.slice(start,source.indexOf('\n  function ',start+1))+
    '\nreconcileShelterAssignment',context);
  const releaseStart=source.indexOf('  function reconcileShelterAssignmentHolds(');
  const release=releaseStart<0?()=>false:vm.runInContext(source.slice(releaseStart,source.indexOf('\n  function ',releaseStart+1))+
    '\nreconcileShelterAssignmentHolds',context);
  const model=state.api.model(state.f.view);context.shelterRead={model,at:now,startedAt:now-500};
  return {...state,recover,release,model,original,now,resident,room};
}

test('调岗520恢复：先完整留档并隔离居民，再解除全局等待，不伪造成功回执',()=>{
  const state=setup();state.context.shelterState.pendingReadOnly=state.original.id;
  assert.equal(state.recover(state.model,[]),true);
  assert.equal(state.context.shelterPending,null);
  const entry=state.context.shelterState.campaign.assignmentHolds[0];
  assert.deepEqual(structuredClone(entry.original),state.original);
  assert.equal(entry.id,state.resident.id);assert.equal(entry.room,state.resident.roomId);
  assert.equal(entry.resolvedAt,undefined);assert.equal(entry.original.result.campaignProof,undefined);
  assert.equal(state.context.shelterState.pendingReadOnly,undefined);
  const plan=state.api.schedule(state.model);
  assert.ok(plan.reserved.includes(state.resident.id));
  assert.equal(plan.actions.some(action=>action.id===state.resident.id),false);
});

test('免费调岗恢复：请求已结束且目标训练室已满足，归档原单并按新鲜训练状态接管',()=>{
  const state=setup('training');assert.equal(state.recover(state.model,[]),true);
  assert.equal(state.context.shelterPending,null);
  assert.deepEqual(structuredClone(state.context.shelterState.assignmentRecovery.original),state.original);
  assert.equal(state.context.shelterState.assignmentRecovery.outcome,'target-observed');
  assert.equal(state.context.shelterState.assignmentRecovery.original.result.campaignProof,undefined);
  assert.equal(state.context.shelterState.campaign.assignmentHolds,undefined);
});

test('免费调岗恢复：普通目标岗已满足可继续，仍不把原错误认作成功',()=>{
  const state=setup();state.original.targets[1]=state.resident.roomId;
  Object.assign(state.original.before.campaign.choice,{role:'workshop',room:state.resident.roomId,targets:state.original.targets});
  assert.equal(state.recover(state.model,[]),true);
  assert.equal(state.context.shelterState.assignmentRecovery.original.result.status,520);
  assert.equal(state.context.shelterPending,null);
});

test('免费调岗恢复：原请求结束的200或400且实际目标满足可归档，保留原响应',()=>{
  for(const status of [200,400]){
    const x=setup('training');x.original.result.status=status;
    assert.equal(x.recover(x.model,[]),true);
    assert.equal(x.context.shelterPending,null);
    assert.equal(x.context.shelterState.assignmentRecovery.original.result.status,status);
    assert.equal(x.context.shelterState.assignmentRecovery.original.result.campaignProof,undefined);
  }
});

test('调岗520恢复：岗位后续改变才解除原地隔离，时间流逝不触发同人重试',()=>{
  const state=setup();assert.equal(state.recover(state.model,[]),true);
  state.f.view.serverTime+=3600000;
  state.context.shelterRead={at:state.f.view.serverTime,startedAt:state.f.view.serverTime};
  assert.equal(state.release(state.api.model(state.f.view)),false);
  state.resident.roomId=null;
  assert.equal(state.release(state.api.model(state.f.view)),true);
  assert.equal(state.context.shelterState.campaign.assignmentHolds[0].resolvedAt,state.f.view.serverTime);
});

test('调岗520恢复：尚在请求、身份错误、旧读取、人工窗口和账户停止不能释放原单',()=>{
  for(const boundary of ['unfinished','network','success','auth','rate','old-read','old-model','stale','vault','key',
    'bound-time','prepared','active','confirmation','dialog','emergency','frozen','account','name','missing-resident']){
    const state=setup(),context=state.context,record=state.original;
    if(boundary==='unfinished')delete record.result.responseFinishedAt;
    if(boundary==='network')record.result.outcome='network-error';
    if(boundary==='success')record.result.status=200;
    if(boundary==='auth')record.result.status=403;
    if(boundary==='rate')record.result.status=429;
    if(boundary==='old-read')context.shelterRead.startedAt=record.result.responseFinishedAt-1;
    if(boundary==='old-model')state.model.now=record.before.serverTime-1;
    if(boundary==='stale')context.shelterRead.at-=2000;
    if(boundary==='vault')record.vaultNo++;
    if(boundary==='key')record.campaignKey='mismatched-key';
    if(boundary==='bound-time')record.lifecycle.boundAt=record.result.responseFinishedAt+1;
    if(boundary==='prepared')record.lifecycle.phase='prepared';
    if(boundary==='active')context.continueShelterAction={id:record.id};
    if(boundary==='confirmation')context.shelterWorkConfirm={id:record.id};
    if(boundary==='emergency')record.emergency={id:'unresolved-defense'};
    if(boundary==='frozen')state.model.view.switches.frozen=true;
    if(boundary==='account')context.accountStopReason=()=> 'stopped';
    if(boundary==='name')record.before.campaign.choice.name='其他居民';
    if(boundary==='missing-resident')state.model.state.residents=state.model.state.residents.filter(person=>person.id!==state.resident.id);
    assert.equal(state.recover(state.model,boundary==='dialog'?[{}]:[]),boundary==='stale',boundary);
    assert.equal(context.shelterPending,record,boundary);
    assert.equal(context.shelterState.campaign.assignmentHolds,undefined,boundary);
    assert.equal(context.reads||0,boundary==='stale'?1:0,boundary);
  }
});

test('调岗520恢复：排队关闭已提交窗口不要求新快照，归档仍须重新读取',()=>{
  const state=setup(),context=state.context,dialog={};
  context.shelterRead.at-=2000;context.shelterWork={submitted:true,dialog};
  let closed=0;context.closeShelterWork=()=>{closed++;return true;};
  assert.equal(state.recover(state.model,[dialog]),true);
  assert.equal(closed,1);assert.equal(context.reads,undefined);
  assert.equal(context.shelterPending,state.original);
  context.shelterWork.manual=true;
  assert.equal(state.recover(state.model,[dialog]),false);assert.equal(closed,1);
  assert.equal(state.recover(state.model,[]),true);
  assert.equal(context.reads,1);assert.equal(context.shelterPending,state.original);
  context.shelterWork=null;context.shelterRead.at=state.now;
  assert.equal(state.recover(state.model,[]),true);assert.equal(context.shelterPending,null);
});

test('调岗520恢复：归档写入失败保留原单，中途刷新不会重复归档或丢失其他记录',()=>{
  const failed=setup();failed.context.saveShelter=()=>{throw Error('archive unavailable');};
  assert.throws(()=>failed.recover(failed.model,[]),/archive unavailable/);
  assert.equal(failed.context.shelterPending,failed.original);
  const state=setup();assert.equal(state.recover(state.model,[]),true);
  state.context.shelterPending=structuredClone(state.original);
  assert.equal(state.recover(state.model,[]),true);
  assert.equal(state.context.shelterState.campaign.assignmentHolds.length,1);
});

test('调岗520恢复：只撤销涉及隔离居民的换位接续，并将完整接续计划一并留档',()=>{
  const state=setup(),swap={id:'interrupted-swap',step:1,people:[{id:state.resident.id,room:state.original.before.room}],
    moves:[{id:state.resident.id,room:state.room.id}]};
  state.context.shelterState.swap=swap;
  assert.equal(state.recover(state.model,[]),true);
  assert.equal(state.context.shelterState.swap,undefined);
  assert.deepEqual(structuredClone(state.context.shelterState.campaign.assignmentHolds[0].swap),swap);
  const independent=setup();independent.context.shelterState.swap={...swap,people:[{id:9999,room:null}]};
  assert.equal(independent.recover(independent.model,[]),true);
  assert.ok(independent.context.shelterState.swap);
});

test('调岗520恢复：隔离约束最终发送入口，其他居民、领取、治疗及召回继续',()=>{
  const state=setup();assert.equal(state.recover(state.model,[]),true);
  const start=source.indexOf('  function shelterAssignmentBlocked(');
  const blocked=vm.runInContext(source.slice(start,source.indexOf('\n  function ',start+1))+'\nshelterAssignmentBlocked',state.context);
  for(const kind of ['assign','equip','explore-start']){
    assert.equal(blocked(kind,[state.resident.id,1]),true,kind);
    assert.equal(blocked(kind,[99999,1]),false,kind);
  }
  assert.equal(blocked('quest-start',['quest',state.resident.id]),true);
  assert.equal(blocked('rescue',[1]),true);
  for(const kind of ['stimpak','explore-recall','explore','collect'])assert.equal(blocked(kind,[state.resident.id]),false,kind);
});

test('调岗520恢复：持久化校验拒绝损坏或重复的隔离记录',()=>{
  const state=setup();assert.equal(state.recover(state.model,[]),true);
  const record=state.context.shelterState.campaign;
  const valid=vm.runInContext('validCampaignRecord',state.context);
  assert.equal(valid(record),true);
  for(const mutation of [entry=>entry.id=0,entry=>entry.room='30',entry=>entry.base=3.5,
    entry=>entry.resolvedAt=entry.snapshotAt-1,entry=>entry.original.targets=[99999,30]]){
    const invalid=structuredClone(record);mutation(invalid.assignmentHolds[0]);
    assert.equal(valid(invalid),false);
  }
  const duplicate=structuredClone(record);duplicate.assignmentHolds.push(duplicate.assignmentHolds[0]);
  assert.equal(valid(duplicate),false);
});

test('调岗520恢复：其他居民的成功回执保留隔离原单，不覆盖尚待核对的记录',()=>{
  const state=setup();assert.equal(state.recover(state.model,[]),true);
  const entry=structuredClone(state.context.shelterState.campaign.assignmentHolds[0]);
  const record=vm.runInContext('recordShelterCampaign',state.context);
  record({kind:'stimpak',id:'confirmed-other-treatment',targets:[99999],
    before:{campaign:{choice:{role:'medical',reason:'other treatment'}}},
    result:{campaignProof:{at:state.now,mission:null}}},state.model);
  assert.deepEqual(structuredClone(state.context.shelterState.campaign.assignmentHolds),[entry]);
  assert.equal(state.context.shelterState.campaign.heals.some(heal=>heal.id===99999),true);
});

test('调岗520恢复：手动改入另一训练室继续保护当前格，不因岗位变化立即抽走',()=>{
  const state=setup();assert.equal(state.recover(state.model,[]),true);
  state.context.shelterRead.startedAt=state.now;
  state.resident.roomId=state.room.id;state.resident.training=.9;
  assert.equal(state.release(state.api.model(state.f.view)),true);
  const held=state.context.shelterState.campaign.assignmentHolds[0];
  assert.equal(held.resolvedAt,undefined);assert.equal(held.room,state.room.id);assert.equal(held.base,3);
  state.resident.training=.95;
  assert.equal(state.release(state.api.model(state.f.view)),false);
  state.resident.stats[state.room.trainStat]++;
  assert.equal(state.release(state.api.model(state.f.view)),true);
});
