import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
const functionSource=name=>source.match(new RegExp(`^  function ${name}\\([^]*?^  }`,'m'))[0];
test('普通倒计时不唤醒；到零、控件、领奖和结构变化仍唤醒，拍卖仅开启不缩短空闲兜底',()=>{
  const wake=vm.runInNewContext(functionSource('wakeForMutation')+'\nwakeForMutation');
  const text=(data,interactive=false)=>({nodeType:3,data,parentElement:{closest:selector=>interactive&&selector.startsWith('button')}});
  const change=(oldValue,value,interactive=false)=>wake({type:'characterData',oldValue,target:text(value,interactive)});
  assert.equal(change('剩余 10 秒','剩余 9 秒'),false);assert.equal(change('00:01','00:00'),true);
  assert.equal(change('5s','4s',true),true);assert.equal(change('1 秒','可领取'),true);assert.equal(change('2s','20s'),true);
  const target={nodeType:1,closest:()=>false};
  assert.equal(wake({type:'childList',target,removedNodes:[text('01:00')],addedNodes:[text('00:59')]}),false);
  assert.equal(wake({type:'childList',target,removedNodes:[],addedNodes:[text('00:59')]}),true);
  const ctx={auctionExclusive:false,auctionToggle:{checked:true},shelterEnabled:true,shelterCampaign:{},shelterDefenseEnabled:()=>false};
  const cadence=vm.runInNewContext(functionSource('idleWakeCadence')+'\nidleWakeCadence',ctx);
  assert.equal(cadence(),60000);ctx.auctionExclusive=true;assert.equal(cadence(),30000);
  ctx.auctionExclusive=false;ctx.shelterDefenseEnabled=()=>true;assert.equal(cadence(),30000);
});
test('升级迁移仅回收旧比较窗口和未启动计划；有原请求、已移动或待产时保留原安排',()=>{
  const ledger=[{id:'settled',at:42,scrap:270,parts:0}];
  const valid=vm.runInNewContext(part('  const validShelterState =','  let shelterState =')+'\nvalidShelterState',{objectState:value=>value!==null&&typeof value==='object'});
  assert.equal(valid({nextAt:0,note:'old',developmentWindow:'damaged',constructionLedger:ledger}),true);
  assert.equal(valid({nextAt:0,note:'old',developmentWindow:'damaged',constructionLedger:[{id:'bad'}]}),false);
  for(const mode of ['clean','journal','native','capture','moved','expecting']){
    const pair={step:0,a:1,b:2,fromA:null,fromB:3},state={nextAt:0,note:'old',pair,developmentWindow:'damaged',constructionLedger:ledger};
    const c={shelterState:state,shelterPending:mode==='journal'?{id:'unknown'}:null,nativePending:()=>mode==='native'?[{}]:[],
      captureShelterAction:mode==='capture'?{}:null,continueShelterAction:null,shelterWorkConfirm:null,shelterWork:null,shelterBuildWork:null,
      shelterRecallWork:null,shelterRescueWork:null,shelterCampaignWork:null,shelterFamilyExpecting:()=>mode==='expecting',saveShelter:value=>c.shelterState=value};
    const migrate=vm.runInNewContext(functionSource('shelterMigratePlanPolicy')+'\nshelterMigratePlanPolicy',c);
    const model={now:100,state:{residents:[{id:1,roomId:mode==='moved'?9:null},{id:2,roomId:3}].map(p=>({...p,deadAt:null,away:null}))}};
    assert.equal(migrate(model),!['journal','native','capture'].includes(mode),mode);
    assert.equal(c.shelterState.pair,mode==='clean'?null:pair,mode);assert.equal(c.shelterState.constructionLedger,ledger);
    if(c.shelterState!==state)assert.equal(c.shelterState.developmentWindow,undefined);
    assert.equal(migrate(model),false,mode);
  }
});
function windowScene(){
  const dialog={isConnected:true,querySelector:()=>({textContent:'确认安排'})},work={dialog},capture={};
  const confirm={dialog,work,capture,id:'op',title:'确认安排',sent:()=>false};
  const c={clock:100000,document:{querySelectorAll:()=>[dialog]},visible:()=>true,textOf:e=>e.textContent,
    shelterState:{},shelterWorkConfirm:confirm,shelterPending:null,awaitingShelterConfirmation:null,
    continueShelterAction:null,claimPageId:'page',nativePending:()=>[],accountStopReason:()=>'',
    say(){},cancelQueued(){},cancelShelterRead(){},cancelShelterAuxReads(){},log:{add(){}},
    location:{replace:path=>c.destination=path}};
  c.Date=class extends Date{static now(){return c.clock;}};
  c.saveShelter=s=>c.shelterState=s;c.saveShelterPending=p=>c.shelterPending=p;
  const recover=vm.runInNewContext(functionSource('shelterRecoverOwnedWindow')+'\nshelterRecoverOwnedWindow',c);
  return {c,work,confirm,recover,prepare(){c.shelterPending={id:'op',lifecycle:{phase:'prepared',page:'page'}};c.awaitingShelterConfirmation=capture;}};
}

test('批准运行策略：脚本窗口关闭失败返回并指数退避，不留下永久停用',()=>{
  const x=windowScene();assert.equal(x.recover(x.work),true);
  assert.equal(x.c.destination,'/activities/expedition');assert.equal(x.c.shelterState.nextAt,160000);
  assert.equal(x.c.shelterState.windowRecovery.count,1);
  delete x.work.recovering;x.c.clock=200000;x.recover(x.work);
  assert.equal(x.c.shelterState.nextAt,320000);assert.equal(x.c.shelterState.windowRecovery.count,2);
});
test('批准运行策略：当前页可证明未发送确认保留交接原单后恢复',()=>{
  const x=windowScene();x.prepare();x.recover(x.confirm);
  assert.equal(x.c.destination,'/activities/expedition');
  assert.equal(x.c.shelterPending.id,'op');assert.equal(x.c.shelterPending.lifecycle.phase,'prepared');
  assert.equal(x.c.shelterPending.lifecycle.hiddenExitAt,x.c.clock);assert.equal(x.confirm.capture.cancelled,true);
});
test('批准运行策略：人工、歧义、已发送、未知、旧页及账号停止禁止窗口自动恢复',()=>{
  for(const mode of ['manual','parent-manual','unknown-window','ambiguous','clicked','sent','bound','old-page','native','account','continuation']){
    const x=windowScene();x.prepare();const {c,confirm}=x;
    if(mode==='manual')confirm.manual=true;if(mode==='parent-manual')confirm.work.manual=true;
    if(mode==='unknown-window')c.document.querySelectorAll=()=>[confirm.dialog,{}];
    if(mode==='ambiguous')confirm.dialogAmbiguous=true;if(mode==='clicked')confirm.clicked=true;
    if(mode==='sent')confirm.sent=()=>true;if(mode==='bound')c.shelterPending.lifecycle.phase='request-bound';
    if(mode==='old-page')c.shelterPending.lifecycle.page='old';if(mode==='native')c.nativePending=()=>[{}];
    if(mode==='account')c.accountStopReason=()=> 'stopped';if(mode==='continuation')c.continueShelterAction={};
    const original=structuredClone(c.shelterPending);x.recover(confirm);
    assert.equal(c.destination,undefined,mode);assert.deepEqual(c.shelterPending,original,mode);
  }
});
test('批准运行策略：非必需页签超时只跳过该页，下次访问可重新检查',()=>{
  const c={clock:0,shelterUiSkipped:new Set(),shelterUiWait:null,shelterTab:()=>null,usable:x=>Boolean(x),visible:()=>false,
    cancelQueued(){},log:{add(){}},say(){},finishShelter:()=>c.finished=true};
  c.Date=class extends Date{static now(){return c.clock;}};
  const ready=vm.runInNewContext(functionSource('shelterReadyTab')+'\nshelterReadyTab',c);
  for(const label of ['目标','图鉴','排行','商队']){
    ready({},label);c.clock+=15000;ready({},label);assert.equal(c.shelterUiSkipped.has(label),true);
  }
  assert.equal(c.finished,undefined);
  c.shelterTab=()=>({});assert.ok(ready({},'居民'));assert.equal(ready({},'目标'),null);
  c.shelterUiSkipped.clear();assert.ok(ready({},'目标'));
});
test('批准运行策略：战斗无execution治疗控件失败可局部让路，未决或已提交不放行',()=>{
  const c={shelterPending:null,shelterExecutionDeferrals:new Map(),shelterExecutionKey:w=>JSON.stringify([w.kind,[w.id]]),
    shelterExecutionDefer(){throw Error('combat has no execution');}};
  const defer=vm.runInNewContext(functionSource('shelterDeferMedical')+'\nshelterDeferMedical',c);
  const work={kind:'stimpak',id:1};assert.equal(defer(work),true);assert.equal(work.closing,true);
  assert.equal(c.shelterExecutionDeferrals.size,1);
  assert.equal(defer({kind:'stimpak',id:2,submitted:true}),false);
  c.shelterPending={id:'unknown'};assert.equal(defer({kind:'stimpak',id:3}),false);
  assert.equal(c.shelterExecutionDeferrals.size,1);
});

function tripScene(mode){
  const m={now:10000,view:{vaultNo:77,drops:{}},state:{explorers:[{id:1,residentId:2,startedAt:100,abyss:false,recalledAt:null,returnAt:null}]}};
  const c={clock:10000,enabled:true,shelterEnabled:true,shelterPending:null,shelterCampaign:{explore:true,hours:6},
    shelterStaffMode:'production',shelterStaffHold:false,shelterState:{vaultNo:77,campaign:{trips:[]}},shelterRead:{model:m,at:10000},
    setTimeout:()=>1,clearTimeout(){},schedule(){},logDay:()=> '2026-11-23',log:{add(){}},say(){},
    shelterReload:()=>false,cancelShelterRead(){},cancelQueued(){},accountStopReason:()=>'',
    logStore:{read:()=>mode==='hung'?new Promise(()=>{}):mode==='failed'?Promise.reject(Error('local read failed')):Promise.resolve({events:[]})},
    shelterTripEvidence:()=>null,shelterAdoptTrip:(model,e)=>({id:e.id,resident:e.residentId,startedAt:e.startedAt,hours:6,source:'existing-state'})};
  c.Date=class extends Date{static now(){return c.clock;}};c.saveShelter=s=>c.shelterState=s;
  const recover=vm.runInNewContext(part('  let shelterTripLookup=null;','  function holdShelterCampaign(')+'\nrecoverShelterTrips',c);
  return {c,m,recover};
}
test('批准运行策略：日志拒绝或挂起后按新鲜身份接管既有普通行程，保留原出发时间',async()=>{
  for(const mode of ['failed','hung']){
    const x=tripScene(mode);assert.equal(x.recover(x.m),true);
    await new Promise(r=>setImmediate(r));x.c.clock+=1500;x.c.shelterRead.at=x.c.clock;
    assert.equal(x.recover(x.m),false);assert.equal(x.c.shelterState.campaign.trips[0].startedAt,100);
    assert.equal(x.c.shelterState.campaign.trips[0].id,1);
  }
});
test('批准运行策略：日志超时不接管旧读取、异账号、未决单或人工暂停的行程',()=>{
  for(const mode of ['stale','identity','pending','manual']){
    const x=tripScene('hung');x.recover(x.m);x.c.clock+=6000;
    if(mode!=='stale')x.c.shelterRead.at=x.c.clock;
    if(mode==='identity')x.c.shelterState.vaultNo=78;if(mode==='pending')x.c.shelterPending={};
    if(mode==='manual')x.c.shelterStaffHold=true;
    x.recover(x.m);assert.equal(x.c.shelterState.campaign.trips.length,0,mode);
  }
});
