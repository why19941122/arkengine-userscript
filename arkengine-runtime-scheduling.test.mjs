import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function setup(){
  const microtasks=[],timers=new Map();let sequence=0;
  const context={clock:1000,urgent:false,runs:0,recur:false,scheduled:false,
    queueMicrotask:callback=>microtasks.push(callback),
    setTimeout:(callback,delay)=>{const id=++sequence;timers.set(id,{callback,at:context.clock+delay});return id;},
    clearTimeout:id=>timers.delete(id),
    enabled:false,active:false,auctionExclusive:false,observeSessionPage(){},cancelQueued(){},
    farmWait:{begin(){}},expeditionLoadWait:{begin(){}}};
  context.Date=class extends Date{static now(){return context.clock;}};
  context.performance={now:()=>context.clock};
  context.step=()=>{context.runs++;context.clock+=context.workMs||0;if(context.recur)context.schedule();};
  const factory=source.match(/^  function createPageScheduler\([^]*?^  }/m)?.[0];
  context.schedule=factory?vm.runInNewContext(factory+'\ncreatePageScheduler(step,()=>urgent)',context):
    vm.runInNewContext(source.slice(source.lastIndexOf('  function schedule() {'),source.indexOf('\n  subscribeWakeup(',source.lastIndexOf('  function schedule() {'))).split('\n  }')[0]+'\n  }\nschedule',context);
  const flush=()=>{for(let count=0;microtasks.length&&count<100;count++)microtasks.shift()();};
  const advance=milliseconds=>{context.clock+=milliseconds;for(const [id,timer] of [...timers])if(timer.at<=context.clock){timers.delete(id);timer.callback();}flush();};
  return {context,microtasks,timers,flush,advance};
}

test('运行减负：持续DOM自唤醒不会形成无休止微任务，普通检查每秒最多两次',()=>{
  const state=setup();state.context.recur=true;state.context.schedule();state.flush();
  assert.equal(state.context.runs,1);
  assert.equal(state.microtasks.length,0);
  for(let index=0;index<100;index++){state.context.schedule();state.advance(10);}
  assert.ok(state.context.runs<=3,`runs=${state.context.runs}`);
  assert.equal(state.timers.size,1);
});

test('运行减负：拍卖按钮唤醒立即越过普通检查冷却，付款不等待定时器',()=>{
  const state=setup();state.context.schedule();state.flush();
  state.context.schedule();state.flush();assert.equal(state.context.runs,1);
  state.context.urgent=true;state.context.schedule();state.flush();assert.equal(state.context.runs,2);
  state.context.schedule();state.flush();assert.equal(state.context.runs,3);
  assert.equal(state.timers.size,0);
});

test('运行减负：后台定时器迟到时，Worker唤醒仍可检查且不重复执行',()=>{
  const state=setup();state.context.schedule();state.flush();state.context.schedule();state.flush();
  state.context.clock+=2000;state.context.schedule();state.flush();assert.equal(state.context.runs,2);
  state.advance(0);assert.equal(state.context.runs,2);
});

test('运行减负：昂贵规划按实际耗时留出渲染和输入时间，不连续重算',()=>{
  const state=setup();state.context.workMs=300;state.context.recur=true;
  state.context.schedule();state.flush();assert.equal(state.context.runs,1);
  state.advance(1199);assert.equal(state.context.runs,1);
  state.advance(1);assert.equal(state.context.runs,2);
});

test('运行减负：新避难所与股市读取立即交给原生确认核对，不让快照在冷却中失效',()=>{
  const state=setup();state.context.schedule();state.flush();
  state.context.schedule(true);state.flush();assert.equal(state.context.runs,2);
  state.context.schedule();state.flush();assert.equal(state.context.runs,2);
});
