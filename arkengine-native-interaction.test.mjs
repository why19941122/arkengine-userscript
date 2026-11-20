import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const extract=name=>source.match(new RegExp(`^  function ${name}\\([^]*?^  }`,'m'))?.[0]||'';
test('原生关闭：同一窗口多个关闭入口选择可用项，不借用内层窗口控件',()=>{
  const buttons=[],owner={querySelectorAll:()=>buttons},nested={};
  const button=(label,dialog=owner,enabled=true)=>({getAttribute:()=>label,textContent:label,
    closest:()=>dialog,enabled});
  const find=vm.runInNewContext(extract('nativeCancelButton')+'\nnativeCancelButton');
  const cancel=button('取消'),close=button('关闭');
  buttons.push(button('关闭',nested),button('确认'),button('关闭',owner,false),cancel,close);
  assert.equal(find(owner,element=>element.enabled),cancel);
  cancel.enabled=false;assert.equal(find(owner,element=>element.enabled),close);
  close.enabled=false;assert.equal(find(owner,element=>element.enabled),undefined);
});
function setup(path='/farm'){
  const handlers=new Map(),counts={scans:0,cancels:0},dialogs=[];
  const context={location:{pathname:path},host:{},seedWindow:null,dispatchWindow:null,dungeonWindow:null,
    visible:dialog=>!dialog.hidden,cancelQueued(){counts.cancels++;},cancelPendingClick(){counts.cancels++;},
    document:{querySelectorAll(){counts.scans++;return dialogs;},addEventListener(type,handler){
      if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(handler);
    }}};
  const listeners=[...source.matchAll(/^  for\(const type of \['pointerdown','keydown','input','change'\]\)document\.addEventListener[^]*?^  },true\);/gm)]
    .map(match=>match[0]).filter(code=>/dungeonWindow|seedWindow/.test(code));
  assert.equal(listeners.length,2);
  vm.runInNewContext([extract('bindNativeWindow'),extract('handleNativeWindowInteraction'),...listeners].join('\n'),context);
  return {context,counts,dialogs,emit(type='keydown',target='outside',extra={}){
    const event={type,target,isTrusted:true,composedPath:()=>[],...extra};
    for(const handler of handlers.get(type)||[])handler(event);
  }};
}
const windowRecord=path=>({path,before:new Set()});
const dialog=()=>({contains:target=>target==='inside'});

test('原生交互精简：空闲及其他页面的旧窗口不扫描弹窗',()=>{
  const state=setup();
  for(const type of ['pointerdown','keydown','input','change'])state.emit(type);
  state.context.dungeonWindow=windowRecord('/cultivate/dungeon');state.emit();
  assert.equal(state.counts.scans,0);assert.equal(state.counts.cancels,0);
  assert.equal(state.context.dungeonWindow.manual,undefined);
});

test('原生交互精简：已绑定窗口直接识别人工接管，重复事件不重复取消',()=>{
  const state=setup(),work={...windowRecord('/farm'),dialog:dialog()};state.context.seedWindow=work;
  state.emit();assert.equal(work.manual,undefined);
  state.emit('input','inside');state.emit('change','inside');
  assert.equal(work.manual,true);assert.equal(state.counts.scans,0);assert.equal(state.counts.cancels,1);
});

test('原生交互精简：多个待绑定任务共享扫描，旧窗口和隐藏窗口不接管',()=>{
  const state=setup(),old=dialog(),fresh=dialog();
  state.context.seedWindow={...windowRecord('/farm'),before:new Set([old])};
  state.context.dispatchWindow={...windowRecord('/farm'),before:new Set([old])};
  state.dialogs.push(old,{...dialog(),hidden:true},fresh);state.emit('pointerdown','inside');
  assert.equal(state.counts.scans,1);assert.equal(state.counts.cancels,2);
  for(const key of ['seedWindow','dispatchWindow']){
    assert.equal(state.context[key].dialog,fresh);assert.equal(state.context[key].manual,true);
  }
});

test('原生交互精简：迟到或多个窗口仍让出操作权，歧义窗口不重新绑定',()=>{
  for(const mode of ['delayed','multiple','ambiguous']){
    const state=setup('/cultivate/dungeon'),work=windowRecord('/cultivate/dungeon');state.context.dungeonWindow=work;
    if(mode==='multiple')state.dialogs.push(dialog(),dialog());
    if(mode==='ambiguous')work.ambiguous=true;
    state.emit('keydown','inside');assert.equal(work.manual,true);assert.equal(state.counts.cancels,1);
    if(mode!=='delayed')assert.equal(work.ambiguous,true);
    state.dialogs.splice(0,state.dialogs.length,dialog());state.emit('pointerdown','inside');
    assert.equal(work.dialog,undefined);assert.equal(state.counts.scans,mode==='ambiguous'?0:1);
    assert.equal(state.counts.cancels,1);
  }
});

test('原生交互精简：脚本事件和面板事件不接管原生窗口',()=>{
  const state=setup();state.context.seedWindow=windowRecord('/farm');state.dialogs.push(dialog());
  state.emit('input','inside',{isTrusted:false});
  state.emit('pointerdown','inside',{composedPath:()=>[state.context.host]});
  assert.equal(state.counts.scans,0);assert.equal(state.counts.cancels,0);
  assert.equal(state.context.seedWindow.manual,undefined);
});
