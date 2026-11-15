import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  function stockWaitForControl('),source.indexOf('  function stockReconcile('));
function setup(){
  let now=1000;const finished=[],events=[],input={disabled:false,getAttribute:()=> '模型甲 交易数量'},button={disabled:true};
  const ctx={stockUiWait:null,stockEntryAt:1000,Date:{now:()=>now},document:{querySelectorAll:()=>[input]},
    usable:x=>Boolean(x&&!x.disabled),textOf:x=>x?.text||'',layoutDiagnostic:x=>({found:Boolean(x)}),
    log:{add:(type,note,data)=>events.push({type,note,data})},stockFinish:note=>finished.push(note),say:()=>{}};
  const wait=vm.runInNewContext(code+'\nstockWaitForControl',ctx),choice={action:'buy',stockId:1,modelName:'模型甲'};
  return {ctx,finished,events,input,button,choice,wait:(ready=false,a=choice,c={input,button})=>wait(a,c,ready),at:n=>now=n};
}
test('股市控件期限：输入与按钮分阶段就绪不续期，也不修改原生禁用状态',()=>{
  const x=setup();x.wait(false,x.choice,{input:null,button:null});assert.equal(x.ctx.stockUiWait.at,1000);
  x.at(21000);x.wait();assert.equal(x.ctx.stockUiWait.at,1000);assert.equal(x.events.length,1);
  assert.equal(x.ctx.stockUiWait.diagnostic.phase,'button');assert.equal(x.button.disabled,true);
  x.at(31000);assert.equal(x.wait(),true);assert.equal(x.finished.length,1);
});
test('股市控件期限：期限内全部就绪结束等待，之后新等待拥有独立起点',()=>{
  const x=setup();x.wait();x.at(30999);x.button.disabled=false;
  assert.equal(x.wait(true),false);assert.equal(x.ctx.stockUiWait,null);assert.deepEqual(x.finished,[]);
  x.button.disabled=true;x.wait();assert.equal(x.ctx.stockUiWait.at,30999);assert.equal(x.events.length,2);
});
test('股市控件恢复：30秒前后已经可用均继续核验，原45秒访问界限仍生效',()=>{
  for(const now of [31000,32223,45999]){
    const x=setup();x.wait();x.at(now);x.button.disabled=false;
    assert.equal(x.wait(true),false);assert.equal(x.finished.length,0);assert.equal(x.ctx.stockUiWait,null);
  }
  for(const now of [46000,60000]){
    const x=setup();x.wait();x.at(now);x.button.disabled=false;
    assert.equal(x.wait(true),true);assert.equal(x.finished.length,1);
    assert.match(x.finished[0],/45秒期限/);
  }
});
test('股市控件期限：目标切换可以新建等待，但不能超过整轮45秒控件期限',()=>{
  const x=setup();x.wait();x.at(29000);const next={...x.choice,stockId:2,modelName:'模型乙'};
  x.wait(false,next);assert.equal(x.ctx.stockUiWait.at,29000);
  x.at(45999);x.wait(false,next);assert.deepEqual(x.finished,[]);
  x.at(46000);x.button.disabled=false;assert.equal(x.wait(true,next),true);assert.equal(x.finished.length,1);
});
test('股市控件期限：已经就绪的另一目标不继承旧目标等待，也不产生新等待记录',()=>{
  const x=setup();x.wait();x.at(32000);x.button.disabled=false;
  assert.equal(x.wait(true,{...x.choice,stockId:2}),false);assert.equal(x.ctx.stockUiWait,null);
  assert.equal(x.events.length,1);assert.deepEqual(x.finished,[]);
});
test('股市控件期限：等待期间出现人工搜索筛选，控件恢复仍尊重筛选并退出',()=>{
  const x=setup();x.wait();x.ctx.document.querySelectorAll=()=>[x.input,{getAttribute:()=> '搜索模型',value:'用户筛选'}];
  x.button.disabled=false;assert.equal(x.wait(true),true);
  assert.match(x.finished[0],/保留你的筛选设置/);
});
