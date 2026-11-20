import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function setup(kind='explore-start'){
  const state=setupPowerInvestment(source),context=state.context,now=state.f.view.serverTime;
  const targets=kind==='explore-start'?[5,0,2]:[11];
  const original={id:'rejected-expedition',kind,targets,vaultNo:state.f.view.vaultNo,at:now-2000,campaignKey:'expedition-request-key',
    lifecycle:{version:1,phase:'request-bound',page:'fixture-page',requestKey:'expedition-request-key',boundAt:now-1900},
    before:{serverTime:now-2000,campaign:{choice:{kind,targets,id:5,hours:6},ids:[],hp:100}},
    result:{status:400,outcome:'http-error',retry:false,error:'fixture rejected action',responseFinishedAt:now-1000}};
  Object.assign(context,{shelterPending:original,continueShelterAction:null,awaitingShelterConfirmation:null,
    shelterWorkConfirm:null,shelterRecallWork:null,shelterCampaignWork:null,accountStopReason:()=>'',
    shelterWriteGuard(){},cancelQueued(){},cancelShelterRead(){}});
  context.saveShelterPending=value=>context.shelterPending=value;
  const start=source.indexOf('  function reconcileShelterExpedition(');
  const recover=start<0?()=>false:vm.runInContext(source.slice(start,source.indexOf('  function closeShelterRescue(',start))+
    '\nreconcileShelterExpedition',context);
  const model=state.api.model(state.f.view);context.shelterRead={model,at:now,startedAt:now-500};
  return {...state,recover,model,original,now};
}

test('普通废土拒绝恢复：派遣和召回的明确拒绝归档后解除全局等待，并保存目标退避',()=>{
  for(const kind of ['explore-start','explore-recall']){
    const state=setup(kind);state.context.shelterState.pendingReadOnly=state.original.id;
    assert.equal(state.recover(state.model),true,kind);
    assert.equal(state.context.shelterPending,null);
    assert.deepEqual(structuredClone(state.context.shelterState.campaignRecovery.original),state.original);
    const rejection=state.context.shelterState.campaign.rejections[0];
    assert.equal(rejection.kind,kind);assert.equal(rejection.id,state.original.targets[0]);
    assert.equal(rejection.until-state.now,60000);assert.equal(rejection.count,1);
    assert.equal(state.context.shelterState.pendingReadOnly,undefined);
  }
});

test('普通废土拒绝恢复：连续拒绝延长退避，刷新保留记录且不清除其他目标',()=>{
  const state=setup();
  state.context.shelterState.campaign={roles:[],trips:[],attempts:[],heals:[],trainingRest:[],
    rejections:[{kind:'explore-start',id:5,at:state.now-120000,until:state.now-60000,count:1},
      {kind:'explore-recall',id:12,at:state.now-10000,until:state.now+50000,count:1}]};
  assert.equal(state.recover(state.model),true);
  const entries=state.context.shelterState.campaign.rejections;
  assert.equal(entries.length,2);
  assert.equal(entries.find(entry=>entry.id===5).count,2);
  assert.equal(entries.find(entry=>entry.id===5).until-state.now,120000);
  assert.equal(entries.find(entry=>entry.id===12).until,state.now+50000);
});

test('普通废土拒绝恢复：未知结果、重试响应、错误归属及旧快照继续保留原单',()=>{
  for(const boundary of ['transport','success','server','conflict','auth','rate','unfinished','old-read','old-model','stale','vault',
    'unbound','key','bound-time','retry','missing-body','emergency','active','frozen','account','choice']){
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
    if(boundary==='key')record.campaignKey='another-request-key';
    if(boundary==='bound-time')record.lifecycle.boundAt=record.result.responseFinishedAt+1;
    if(boundary==='retry')record.result.retry=true;
    if(boundary==='missing-body')delete record.result.error;
    if(boundary==='emergency')record.emergency={id:'independent'};
    if(boundary==='active')context.continueShelterAction={id:record.id};
    if(boundary==='frozen')state.model.view.switches.frozen=true;
    if(boundary==='account')context.accountStopReason=()=> 'stopped';
    if(boundary==='choice')record.before.campaign.choice.targets=[6,0,2];
    assert.equal(state.recover(state.model),false,boundary);
    assert.equal(context.shelterPending,record,boundary);
  }
});

test('普通废土拒绝恢复：归档写入失败不删除待核对原单',()=>{
  const state=setup();state.context.saveShelter=()=>{throw Error('archive unavailable');};
  assert.throws(()=>state.recover(state.model),/archive unavailable/);
  assert.equal(state.context.shelterPending,state.original);
});
