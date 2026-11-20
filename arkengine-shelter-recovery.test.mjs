import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {api,source,recoveryScene,assignmentHold,equipmentPending} from './arkengine-shelter-recovery.fixture.mjs';
import {fourExplorerView} from './arkengine-shelter-campaign.fixture.mjs';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';

test('恢复回归：隔离仍在生产的居民不制造供给缺口，不提议中断90%训练',()=>{
  const sample=recoveryScene();sample.record.assignmentHolds=[assignmentHold(sample.view,sample.state.residents[0])];
  const plan=api.plan(api.model(sample.view),sample.cfg,sample.record,14);
  assert.equal(plan.actions.some(action=>action.id===5&&action.role==='training-release'),false);
  assert.ok(plan.adoptions.some(role=>role.id===5&&role.existingTraining));
  assert.equal(plan.actions.some(action=>action.id===1),false);
});

test('恢复回归：隔离发电者保留实际供给，仍可派出四名合格探险者',()=>{
  const view=fourExplorerView(Date.parse('2026-11-20T09:00:00Z'));
  const cfg={...api.defaults,explore:true,development:true,guardResidents:0,guardPowerPercent:0};
  const record={roles:[],trips:[],attempts:[],heals:[],trainingRest:[],assignmentHolds:[assignmentHold(view,view.state.residents[0])]};
  const plan=api.plan(api.model(view),cfg,record,14);
  assert.deepEqual(Array.from(plan.actions.filter(action=>action.kind==='explore-start'),action=>action.id),[5,6,7,8]);
});

for(const scenario of [
  {name:'层数与缓存都缺失',state:{},record:{},expected:0},
  {name:'27层没有缓存',state:{depth:27},record:{},expected:4},
  {name:'原生名额优先',state:{depth:27},record:{exploreSlots:{depth:27,limit:3}},expected:3},
  {name:'层数变化后旧缓存失效',state:{depth:32},record:{exploreSlots:{depth:27,limit:4}},expected:5}
])test('恢复回归：'+scenario.name,()=>assert.equal(api.slots({state:scenario.state},scenario.record),scenario.expected));

function equipmentSetup(slot='weapon'){
  const sample=recoveryScene();sample.state.items=[{id:173,slot,name:'测试装备',damage:[11,18],bonus:{int:5}}];
  const state=setupPowerInvestment(source,{view:sample.view,campaign:sample.cfg,state:{campaign:sample.record},construction:{}});
  const context=state.context,original=equipmentPending(state.f.view,slot),model=state.api.model(state.f.view);
  Object.assign(context,{shelterPending:original,continueShelterAction:null,awaitingShelterConfirmation:null,
    shelterWorkConfirm:null,shelterWork:null,accountStopReason:()=>'',shelterWriteGuard(){},cancelQueued(){},
    cancelShelterRead(){},schedule(){},shelterExecutionDeferrals:new Map(),shelterRead:{model,at:model.now,startedAt:model.now-500}});
  context.saveShelterPending=value=>context.shelterPending=value;
  const extract=name=>{
    const start=source.indexOf('  function '+name+'(');
    return start<0?()=>false:vm.runInContext(source.slice(start,source.indexOf('\n  function ',start+1))+'\n'+name,context);
  };
  return {...state,model,original,recover:extract('reconcileShelterEquipment'),release:extract('reconcileShelterEquipmentHolds'),
    blocked:extract('shelterAssignmentBlocked'),deferred:extract('shelterExecutionDeferred')};
}

for(const slot of ['weapon','outfit'])test('装备恢复：'+slot+'错误先留原单，再解除全局等待并保护相关人和物',()=>{
  const state=equipmentSetup(slot);assert.equal(state.recover(state.model,[]),true);
  assert.equal(state.context.shelterPending,null);
  const entry=state.context.shelterState.campaign.equipmentHolds[0];
  assert.deepEqual(structuredClone(entry.original),state.original);
  assert.equal(entry.resolvedAt,undefined);
  assert.equal(state.blocked('assign',[4,1]),true);
  assert.equal(state.blocked('equip',[6,173,slot]),true);
  assert.equal(state.blocked('quest-start',['quest',4]),true);
  assert.equal(state.blocked('explore-start',[4,0,0]),true);
  assert.equal(state.blocked('rescue',[1]),true);
  for(const kind of ['stimpak','explore-recall','explore','collect'])assert.equal(state.blocked(kind,[4]),false);
  assert.equal(state.blocked('assign',[6,1]),false);
  assert.equal(state.deferred({kind:'equip',id:6,item:173,targets:[6,173,slot]}),true);
  assert.equal(api.valid(state.context.shelterState.campaign),true);
});

test('装备恢复：转交隔离供体、接收者、原装备，时间和刷新不解除，当前归属核对后释放',()=>{
  const state=equipmentSetup();
  const choice=state.original.before.campaign.choice;
  Object.assign(choice,{fromOwner:1,fromItem:174,departureTeam:[4,5]});
  state.f.view.state.items.push({id:174,slot:'weapon',name:'旧武器',damage:[1,2]});
  state.f.view.state.residents[0].weaponId=173;state.f.view.state.residents[3].weaponId=174;
  assert.equal(state.recover(state.api.model(state.f.view),[]),true);
  assert.equal(state.blocked('assign',[1,null]),true);
  assert.equal(state.blocked('equip',[6,174,'weapon']),true);
  state.context.shelterPending=structuredClone(state.original);
  assert.equal(state.recover(state.api.model(state.f.view),[]),true);
  assert.equal(state.context.shelterState.campaign.equipmentHolds.length,1);
  state.f.view.serverTime+=3600000;state.context.shelterRead={at:state.f.view.serverTime,startedAt:state.f.view.serverTime};
  assert.equal(state.release(state.api.model(state.f.view)),false);
  state.f.view.state.residents[3].weaponId=173;
  assert.equal(state.release(state.api.model(state.f.view)),false);
  state.f.view.state.residents[0].weaponId=null;
  assert.equal(state.release(state.api.model(state.f.view)),true);
  const entry=state.context.shelterState.campaign.equipmentHolds[0];
  assert.equal(entry.resolvedAt,state.f.view.serverTime);
  assert.equal(entry.original.result.status,520);
  assert.equal(entry.original.result.campaignProof,undefined);
});

test('装备恢复：旧记录缺少原武器时隔离该槽库存，防止未知旧装备再分配',()=>{
  const state=equipmentSetup();delete state.original.before.campaign.choice.fromItem;
  state.f.view.state.items.push({id:174,slot:'weapon',name:'可能的旧武器',damage:[1,2]});
  assert.equal(state.recover(state.api.model(state.f.view),[]),true);
  assert.equal(state.blocked('equip',[6,174,'weapon']),true);
});

test('装备恢复：原武器为空时不将已穿服装误认为被替换的武器',()=>{
  const state=equipmentSetup();state.original.before.outfit=175;
  state.f.view.state.items.push({id:175,slot:'outfit',name:'生产服',bonus:{end:1}});
  state.f.view.state.residents[3].outfitId=175;
  assert.equal(state.recover(state.api.model(state.f.view),[]),true);
  assert.equal(state.context.shelterState.campaign.equipmentHolds[0].items.includes(175),false);
  assert.equal(api.valid(state.context.shelterState.campaign),true);
});

test('装备恢复：未结束、网络未知、过期读取、身份不符、人工窗口不能解除原单',()=>{
  for(const boundary of ['unfinished','network','success','auth','rate','old-read','stale','vault','key','bound-time',
    'prepared','active','confirmation','dialog','emergency','frozen','account','missing-item','missing-resident']){
    const state=equipmentSetup(),context=state.context,record=state.original;
    if(boundary==='unfinished')delete record.result.responseFinishedAt;
    if(boundary==='network')record.result.outcome='network-error';
    if(boundary==='success')record.result.status=200;
    if(boundary==='auth')record.result.status=403;
    if(boundary==='rate')record.result.status=429;
    if(boundary==='old-read')context.shelterRead.startedAt=record.result.responseFinishedAt-1;
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
    if(boundary==='missing-item')state.model.state.items=[];
    if(boundary==='missing-resident')state.model.state.residents=state.model.state.residents.filter(person=>person.id!==4);
    assert.equal(state.recover(state.model,boundary==='dialog'?[{}]:[]),false,boundary);
    assert.equal(context.shelterPending,record,boundary);
  }
});

test('装备恢复：存储失败保留原单，其他成功回执保留装备隔离记录',()=>{
  const failed=equipmentSetup();failed.context.saveShelter=()=>{throw Error('archive unavailable');};
  assert.throws(()=>failed.recover(failed.model,[]),/archive unavailable/);
  assert.equal(failed.context.shelterPending,failed.original);
  const state=equipmentSetup();assert.equal(state.recover(state.model,[]),true);
  const entry=structuredClone(state.context.shelterState.campaign.equipmentHolds[0]);
  vm.runInContext('recordShelterCampaign',state.context)({kind:'stimpak',id:'other-treatment',targets:[6],
    before:{campaign:{choice:{role:'medical'}}},result:{campaignProof:{at:state.model.now,mission:null}}},state.model);
  assert.deepEqual(structuredClone(state.context.shelterState.campaign.equipmentHolds),[entry]);
});

test('装备恢复：持久化拒绝损坏、重复或缺少依赖的隔离记录',()=>{
  const state=equipmentSetup();assert.equal(state.recover(state.model,[]),true);
  const record=state.context.shelterState.campaign;
  for(const mutation of [entry=>entry.residents=[],entry=>entry.items=[],entry=>entry.items=[999],
    entry=>entry.residents=[999],entry=>entry.residents.push(entry.residents[0]),entry=>entry.items.push(0),
    entry=>entry.resolvedAt=entry.snapshotAt-1,entry=>entry.original.lifecycle.boundAt=0,
    entry=>entry.original.targets[2]='outfit',entry=>entry.original.campaignKey='different-key',
    entry=>entry.original.before.campaign={}]){
    const invalid=structuredClone(record);mutation(invalid.equipmentHolds[0]);assert.equal(api.valid(invalid),false);
  }
  const duplicate=structuredClone(record);duplicate.equipmentHolds.push(duplicate.equipmentHolds[0]);
  assert.equal(api.valid(duplicate),false);
  for(const missing of ['fromItem','owners']){
    const invalid=structuredClone(record);
    invalid.equipmentHolds[0].original.before.equipment={fromItem:missing==='fromItem'?999:null,owners:missing==='owners'?[999]:[]};
    assert.equal(api.valid(invalid),false,missing);
  }
});

test('装备恢复：隔离装备不能用于留守、生产和出发规划，原生产者继续供给',()=>{
  const state=equipmentSetup();assert.equal(state.recover(state.model,[]),true);
  const record=state.context.shelterState.campaign;
  for(const config of [{combatGear:true},{combatGear:true,explore:true},{combatGear:true,quests:true}]){
    const plan=api.plan(state.model,{...api.defaults,development:true,...config},record,14);
    assert.equal(plan.actions.some(action=>action.kind==='equip'&&action.item===173),false);
    assert.equal(plan.actions.some(action=>action.id===4&&['equip','assign','explore-start'].includes(action.kind)),false);
    assert.equal(plan.actions.some(action=>action.kind==='quest-start'&&action.targets.slice(1).includes(4)),false);
  }
  state.f.view.state.residents[5].weaponId=173;
  state.context.shelterRead.model=state.api.model(state.f.view);
  assert.equal(state.blocked('assign',[6,null]),true);
  const home=vm.runInContext('shelterHomeGear',state.context);
  assert.equal(home(state.model,new Set([4]),[173]),null);
});

test('装备恢复：涉及的换位和配对接续留档，无关接续继续保留',()=>{
  const state=equipmentSetup(),swap={id:'swap',people:[{id:4,room:1}],moves:[{id:4,room:2}]},pair={a:4,b:5};
  state.context.shelterState.swap=swap;state.context.shelterState.pair=pair;
  assert.equal(state.recover(state.model,[]),true);
  const entry=state.context.shelterState.campaign.equipmentHolds[0];
  assert.deepEqual(structuredClone(entry.swap),swap);assert.deepEqual(structuredClone(entry.pair),pair);
  assert.equal(state.context.shelterState.swap,undefined);assert.equal(state.context.shelterState.pair,undefined);
  const other=equipmentSetup();other.context.shelterState.pair={a:1,b:2};
  assert.equal(other.recover(other.model,[]),true);
  assert.deepEqual(other.context.shelterState.pair,{a:1,b:2});
});

test('装备恢复：非战斗生产服旧单也可恢复，过期或跨避难所快照不能解除隔离',()=>{
  const state=equipmentSetup('outfit');delete state.original.before.campaign;delete state.original.campaignKey;
  assert.equal(state.recover(state.model,[]),true);
  state.f.view.state.residents[3].outfitId=173;
  state.context.shelterRead.startedAt=state.f.view.serverTime-1;
  assert.equal(state.release(state.api.model(state.f.view)),false);
  state.context.shelterRead.startedAt=state.f.view.serverTime;
  state.f.view.vaultNo++;
  assert.equal(state.release(state.api.model(state.f.view)),false);
  state.f.view.vaultNo--;
  assert.equal(state.release(state.api.model(state.f.view)),true);
});

for(const [name,variable] of [['closeShelterWork','shelterWork'],['closeShelterSocial','shelterSocialWork'],
  ['closeShelterRescue','shelterRescueWork'],['closeShelterBuild','shelterBuildWork']]){
  for(const manual of [false,true])test('窗口恢复：'+name+(manual?'尊重人工接手':'只点同窗可用关闭入口'),()=>{
    const context={Date,visible:()=>true,usable:button=>Boolean(button&&!button.disabled&&!button.hidden),say(){},offer(key,label,perform){perform();},
      pauseShelter(){assert.fail('valid close must not pause');},shelterDialogGone:()=>false,shelterWorkTitle:()=>true,
      shelterWork:null,shelterRecallWork:null,shelterWorkConfirm:null};
    const dialog={isConnected:true},nested={},clicks=[];
    const button=(id,owner,disabled=false,hidden=false)=>({disabled,hidden,textContent:'关闭',getAttribute:()=>null,
      closest:()=>owner,click(){clicks.push(id);}});
    dialog.querySelectorAll=()=>[button('nested',nested),button('disabled',dialog,true),button('hidden',dialog,false,true),
      button('first',dialog),button('second',dialog)];
    context[variable]={dialog,manual};
    const extract=functionName=>{
      const start=source.indexOf('  function '+functionName+'(');
      return source.slice(start,source.indexOf('\n  function ',start+1));
    };
    const close=vm.runInNewContext(['nativeCancelButton','shelterCloseWindow',name].map(extract).join('\n')+'\n'+name,context);
    assert.equal(close(),true);
    assert.deepEqual(clicks,manual?[]:['first']);
  });
}
