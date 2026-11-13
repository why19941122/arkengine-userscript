import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const offer=source.slice(source.indexOf('  function shelterPreparationAction('),source.indexOf('  function matchesPlan('));
const cancel=source.slice(source.indexOf('  function cancelQueued('),source.indexOf('  function clearIdleWait('));
function setup(random=0){
  let now=100,id=0;const timers=new Map(),calls=[];
  const context={queued:null,nextStepAt:600,offered:false,Date:{now:()=>now},Math:Object.assign(Object.create(Math),{random:()=>random}),
    accountStopReason:()=>null,setEnabled:()=>{throw Error('unexpected pause');},shelterEmergency:()=>true,inShelter:()=>true,
    setTimeout:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimeout:key=>timers.delete(key),
    schedule:()=>calls.push('wake'),say:()=>{},log:{add:()=>{}}};
  const api=vm.runInNewContext(offer+cancel+'\n({offer,ready:offerReady,cancel:cancelQueued,preparation:shelterPreparationAction})',context);
  return {api,context,timers,calls,at:t=>now=t};
}
test('点击冷却：紧急动作可提前准备，但500毫秒保护到期前不能执行',()=>{
  const x=setup();x.api.offer('shelter:staff-open:5','open',()=>x.calls.push('stale'));
  assert.deepEqual(x.calls,[]);assert.equal(x.context.queued.dueAt,600);
  assert.equal([...x.timers.values()][0].delay,500);
  x.at(599);x.api.offer('shelter:staff-open:5','open',()=>x.calls.push('too early'));
  assert.deepEqual(x.calls,[]);assert.equal(x.timers.size,1);
  x.at(600);[...x.timers.values()][0].fn();assert.deepEqual(x.calls,['wake'],'timer only wakes a fresh check');
  x.api.offer('shelter:staff-open:5','open',()=>x.calls.push('current'));
  assert.deepEqual(x.calls,['wake','current']);assert.equal(x.context.nextStepAt,1100);assert.equal(x.timers.size,0);
});
for(const [random,delay] of [[0,2000],[.9999,5000]])test('普通操作保留完整随机等待：'+delay,()=>{
  const x=setup(random);x.api.offer('shelter:explore-start:5','send',()=>x.calls.push('old'));
  assert.equal(x.context.queued.dueAt,100+delay);assert.equal([...x.timers.values()][0].delay,delay);
  x.at(99+delay);x.api.offer('shelter:explore-start:5','send',()=>x.calls.push('early'));assert.deepEqual(x.calls,[]);
  x.at(100+delay);x.api.offer('shelter:explore-start:5','send',()=>x.calls.push('current'));
  assert.deepEqual(x.calls,['current']);
});
test('准备撤销：取消等待或换目标不会执行旧闭包',()=>{
  const x=setup();x.api.offer('shelter:staff-open:5','old',()=>x.calls.push('old'));
  const wake=[...x.timers.values()][0].fn;x.api.cancel();assert.equal(x.timers.size,0);
  x.at(200);x.api.offer('shelter:staff-open:6','new',()=>x.calls.push('new'));
  wake();assert.deepEqual(x.calls,['wake']);assert.equal(x.context.queued.key,'shelter:staff-open:6');
  x.at(600);x.api.offer('shelter:staff-open:6','new',()=>x.calls.push('new'));assert.deepEqual(x.calls,['wake','new']);
});

test('确认倒计时可与只读核对重叠，计时结束本身不点击或占用冷却',()=>{
  const x=setup(.9999);x.context.shelterEmergency=()=>false;
  const key='shelter:work-confirm:owned';
  assert.equal(x.api.ready(key,'confirm'),false);assert.equal(x.context.queued.dueAt,5100);
  x.at(5099);assert.equal(x.api.ready(key,'confirm'),false);
  x.at(5100);[...x.timers.values()][0].fn();assert.deepEqual(x.calls,['wake']);
  assert.equal(x.api.ready(key,'confirm'),true);assert.equal(x.context.nextStepAt,600);
  x.at(7100);assert.equal(x.api.ready(key,'confirm'),true);assert.equal(x.context.queued.dueAt,5100);
  x.api.offer(key,'confirm',()=>x.calls.push('freshly checked'));
  assert.deepEqual(x.calls,['wake','freshly checked']);assert.equal(x.context.nextStepAt,7600);
});

test('确认倒计时撤销后重新开始，旧唤醒不能授权新目标',()=>{
  const x=setup(.9999);x.context.shelterEmergency=()=>false;
  x.api.ready('shelter:work-confirm:old','confirm');const wake=[...x.timers.values()][0].fn;
  x.api.cancel();x.at(6000);wake();
  assert.equal(x.api.ready('shelter:work-confirm:new','confirm'),false);
  assert.equal(x.context.queued.dueAt,11000);assert.deepEqual(x.calls,['wake']);
});
test('纯界面提速：仅明确列出的准备动作等待半秒，离开避难所仍用原等待',()=>{
  for(const key of ['shelter:staff-tab','shelter:staff-open:5','shelter:staff-page:5:2','shelter:campaign-person',
    'shelter:construction-open','shelter:recall-open','shelter:quest-page:select:2','shelter:tab:1']){
    const x=setup(.9999);x.context.shelterEmergency=()=>false;x.context.nextStepAt=0;
    x.api.offer(key,'prepare',()=>x.calls.push('old'));
    assert.equal(x.context.queued.dueAt,600,key);x.at(599);x.api.offer(key,'prepare',()=>x.calls.push('early'));
    assert.deepEqual(x.calls,[]);x.at(600);x.api.offer(key,'prepare',()=>x.calls.push('current'));assert.deepEqual(x.calls,['current']);
  }
  const x=setup(.9999);x.context.shelterEmergency=()=>false;x.context.inShelter=()=>false;
  x.api.offer('shelter:staff-tab','prepare',()=>{});assert.equal(x.context.queued.dueAt,5100);
});
test('提交与未知动作不走准备提速：确认、派遣、治疗、建设、互助、商队、领取和跨页均保留等待',()=>{
  for(const key of ['shelter:work-confirm:original','shelter:assign:5:4','shelter:stimpak:5','shelter:explore-start:5',
    'shelter:explore-recall:11','shelter:quest-start:1','shelter:upgrade:4','shelter:build:water','shelter:dig:8',
    'shelter:help-submit:7','shelter:caravan:1','shelter:collect:all','shelter:daily:1','shelter:season:1',
    'shelter:visit','shelter:return','shelter:staff-open:5:confirm','shelter:construction-open:submit',
    'shelter:campaign-new-action','stock:buy','dispatch:route:1']){
    const x=setup(.9999);x.context.shelterEmergency=()=>false;
    assert.equal(x.api.preparation(key),false,key);x.api.offer(key,'submit',()=>{});
    assert.equal(x.context.queued.dueAt,5100,key);
  }
});
