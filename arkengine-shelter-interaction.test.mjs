import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const extract=name=>source.match(new RegExp(`^  function ${name}\\([^]*?^  }`,'m'))[0];
const dialog=()=>({contains:target=>target==='inside'});
function interaction(overrides={}){
  const handlers=new Map(),counts={scans:0,schedules:0,holds:0,cancels:0,stops:0},windows=[];
  const context={document:{querySelectorAll(){counts.scans++;return windows;},addEventListener(type,handler){
    if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(handler);
  }},visible:()=>true,inShelter:()=>true,host:{},shelterWorkConfirm:null,shelterWork:null,shelterRecallWork:null,
    shelterSocialWork:null,shelterBuildWork:null,shelterRescueWork:null,shelterCampaignEditing:false,campaignActive:()=>false,
    shelterExploreClaim:false,shelterConstruction:{},shelterStaffMode:'production',shelterState:{},shelterExploreManualUntil:0,
    cancelQueued(){counts.cancels++;},schedule(){counts.schedules++;},log:{add(){}},
    holdShelterStaff(){counts.holds++;},stopPopulationPlan(){counts.stops++;},...overrides};
  const listeners=[...source.matchAll(/^  for\s*\(const (?:name|event) of \['pointerdown'[^\n]*document\.addEventListener[^]*?^  },true\);/gm)]
    .map(match=>match[0]).filter(code=>code.includes('shelterUserInteraction('));
  assert.ok(listeners.length);
  vm.runInNewContext([extract('shelterUserInteraction'),extract('shelterBindDialog'),...listeners].join('\n'),context);
  return {context,counts,windows,emit(type='keydown',target='outside',extra={}){
    const event={type,target,key:'ArrowDown',isTrusted:true,composedPath:()=>[],...extra};
    for(const handler of handlers.get(type)||[])handler(event);
  }};
}

test('交互精简：空任务和已绑定窗口无需扫描DOM，人工接管仍只处理一次',()=>{
  const fixture=interaction();fixture.emit();assert.equal(fixture.counts.scans,0);
  fixture.context.shelterWork={dialogBefore:new Set(),dialog:dialog()};fixture.emit('keydown','inside');
  assert.equal(fixture.counts.scans,0);assert.equal(fixture.context.shelterWork,null);
  assert.equal(fixture.counts.holds,1);assert.equal(fixture.counts.schedules,1);
});

test('交互精简：同一事件的多个待绑定任务共用一次扫描，召回仍交给人工',()=>{
  const fixture=interaction({campaignActive:()=>true});
  fixture.context.shelterWork={dialogBefore:new Set()};fixture.context.shelterRecallWork={dialogBefore:new Set()};
  fixture.windows.push(dialog());fixture.emit('pointerdown','inside');
  assert.equal(fixture.counts.scans,1);assert.equal(fixture.context.shelterWork,null);
  assert.equal(fixture.context.shelterRecallWork,null);assert.match(fixture.context.shelterCampaignHeld,/接手召回/);
  assert.equal(fixture.counts.holds,1);assert.equal(fixture.counts.schedules,1);
  assert.ok(fixture.context.shelterExploreManualUntil>Date.now());
});

test('交互精简：编辑设置期间仍能接管居民窗口，input仅标记人工，后续change终止配对',()=>{
  const fixture=interaction({shelterCampaignEditing:true,shelterStaffMode:'population',shelterState:{pair:{a:1,b:2}}});
  const work={dialogBefore:new Set(),dialog:dialog()};fixture.context.shelterWork=work;
  fixture.emit('input','inside');assert.equal(fixture.context.shelterWork,work);assert.equal(work.manual,true);
  assert.equal(fixture.counts.stops,0);fixture.emit('change','inside');
  assert.equal(fixture.context.shelterWork,null);assert.equal(fixture.counts.stops,1);assert.equal(fixture.counts.schedules,1);
});

test('交互精简：截图键、脚本事件和面板操作不转移窗口归属',()=>{
  const fixture=interaction();const work={dialogBefore:new Set()};fixture.context.shelterWork=work;
  fixture.windows.push(dialog());fixture.emit('keydown','inside',{key:'Meta'});
  fixture.emit('keydown','inside',{key:'s',metaKey:true,shiftKey:true});fixture.emit('change','inside',{isTrusted:false});
  fixture.emit('pointerdown','inside',{composedPath:()=>[fixture.context.host]});
  assert.equal(fixture.counts.scans,0);assert.equal(work.manual,undefined);assert.equal(fixture.counts.schedules,0);
});

test('弹窗绑定：迟到窗口仍可绑定，隐藏及旧窗口忽略，多个新窗口保持歧义保护',()=>{
  let windows=[],scans=0;const context={document:{querySelectorAll(){scans++;return windows;}},visible:item=>!item.hidden};
  const bind=vm.runInNewContext(extract('shelterBindDialog')+'\nshelterBindDialog',context);
  const old=dialog(),fresh=dialog(),work={dialogBefore:new Set([old])};
  bind(work);assert.equal(work.dialog,undefined);windows=[old,{hidden:true},fresh];bind(work);assert.equal(work.dialog,fresh);
  const ambiguous={dialogBefore:new Set()};bind(ambiguous,[old,fresh]);assert.equal(ambiguous.dialogAmbiguous,true);
  const before=scans;bind(ambiguous);bind({dialogBefore:new Set(),manual:true});bind(work);bind(null);
  assert.equal(scans,before);assert.equal(ambiguous.dialog,undefined);
});

test('奖励精简：待领奖励判断复用已定位页签，空奖励不点击或重复查找',()=>{
  const model={state:{season:{points:0,claimedFree:[]},daily:{claimed:[]}}};let queries=0,clicks=0;
  const context={shelterStage:1,shelterUiWait:null,shelterTab(label){queries++;return {label,text:label,getAttribute:()=> 'false',click(){clicks++;}};},
    usable:()=>true,textOf:tab=>tab.text,offer(key,label,perform){perform();},schedule(){}};
  const step=vm.runInNewContext(['shelterReadyTab','shelterRewardTabDue','shelterRewardStep'].map(extract).join('\n')+'\nshelterRewardStep',context);
  assert.equal(step(model),false);assert.equal(queries,2);assert.equal(clicks,0);
  context.shelterStage=1;model.state.season.points=60;queries=0;
  assert.equal(step(model),true);assert.equal(queries,1);assert.equal(clicks,1);
});

test('产出精简：没有满批房间时保留核对记录，无需遍历全页领取按钮',()=>{
  let scans=0;const model={rooms:[]},info={rooms:[],roomCount:0};
  const context={shelterRead:{at:Date.now()},shelterFutureCollection:()=>({amounts:{},totals:{}}),
    document:{querySelectorAll(){scans++;return [];}},locator:{pick:()=>null},shelterCollectionInfo:()=>info};
  const step=vm.runInNewContext(extract('shelterProductionClaimStep')+'\nshelterProductionClaimStep',context);
  assert.equal(step(model),false);assert.equal(context.shelterCollection,info);assert.equal(scans,0);
});

test('产出诊断精简：未满批、容量不足或全收已可用时，不再逐房查找按钮',()=>{
  let scans=0;const room={id:7,resource:'scrap',batch:10,stored:9,rate:1,workers:1};
  const model={rooms:[room],now:1000,caps:{scrap:100},state:{resources:{scrap:0}},itemCap:10};
  const assessment={projected:{amounts:{7:10},automatic:{}},bulkReady:false};
  const context={shelterStoredItems:()=>0,shelterResources:{scrap:'废料'},usable:button=>Boolean(button),
    locator:{query(){scans++;return {querySelector:()=>({})};}}};
  const info=vm.runInNewContext(extract('shelterCollectionInfo')+'\nshelterCollectionInfo',context);
  assert.equal(info(model,assessment).rooms[0].reason,'not-full');assert.equal(scans,0);
  room.stored=10;model.state.resources.scrap=95;
  assert.equal(info(model,assessment).rooms[0].reason,'capacity-blocked');assert.equal(scans,0);
  model.state.resources.scrap=0;assessment.bulkReady=true;
  assert.equal(info(model,assessment).rooms[0].reason,'ready');assert.equal(scans,0);
  assessment.bulkReady=false;assert.equal(info(model,assessment).rooms[0].reason,'ready');assert.equal(scans,1);
  context.locator.query=()=>{scans++;return null;};
  assert.equal(info(model,assessment).rooms[0].reason,'controls-not-ready');assert.equal(scans,2);
});
