import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const shared=source.includes('  const readSessions = new Set();')?
  source.slice(source.indexOf('  const readSessions = new Set();'),source.indexOf('  function cancelFarmRead()')):'';
const code=shared+['cancelStockRead','readStock'].map(name=>source.match(new RegExp('^  function '+name+'\\([^]*?^  }','m'))[0]).join('\n');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(){
  let now=1000;const calls=[],timers=[],events=[],observations=[],finished=[];
  const pending={id:'original',key:'native-key',retries:0,result:null};
  const ctx={AbortController,DOMException,Date:{now:()=>now},stockController:null,stockGeneration:0,stockRead:null,
    stockReadAt:0,stockReadStarted:0,stockEntryAt:1000,stockReadFailures:0,STOCK_READ_TIMEOUT:30000,STOCK_VISIT_TIMEOUT:90000,
    stockLedger:{userId:77,pending},queued:null,enabled:true,active:true,pageFrozen:false,inStock:()=>true,accountStopReason:()=>false,
    stockReload:()=>false,stateFault:()=>false,stockConfig:{},stockRetryChange:()=>false,cancelQueued:()=>{},say:()=>{},schedule:()=>{},
    log:{add:(type,note,data)=>events.push({type,data})},stockPersist:next=>{ctx.stockLedger=next;},
    stockCore:{model:(view,balance)=>({view,balance}),funding:()=>({})},
    stockObservationLog:m=>{observations.push(m);return {};},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
    fetch:(path,options)=>new Promise(resolve=>{calls.push({path,signal:options.signal,resolve});})};
  const api=vm.runInNewContext(code+'\n({readStock,cancelStockRead})',ctx);
  ctx.stockFinish=note=>{finished.push(note);api.cancelStockRead();};
  const respond=async(index,{held=false,data}={})=>{
    const call=calls[index],body=data??(call.path==='/api/stock'?{userId:77,marker:index}:{tokens:10000});
    let release;call.resolve({ok:true,redirected:false,json:held?()=>new Promise(resolve=>{release=()=>resolve(body);}):async()=>body});
    await flush();return release;
  };
  return {ctx,api,calls,timers,events,observations,finished,pending,respond,at:value=>now=value};
}
test('股市读取期限：取消信号独立结束挂起响应体，迟到结果不覆盖新读取',async()=>{
  const x=setup();x.api.readStock();const release=await x.respond(0,{held:true});await x.respond(1);
  x.at(31000);x.ctx.stockController.abort();await flush();
  assert.equal(x.ctx.stockController,null);assert.equal(x.ctx.stockReadFailures,1);assert.equal(x.ctx.stockReadAt,33000);
  assert.equal(x.ctx.stockLedger.pending,x.pending);assert.equal(x.ctx.stockLedger.pending.retries,0);
  x.at(33000);x.api.readStock();const fresh=x.ctx.stockController;
  release();await flush();assert.equal(x.ctx.stockController,fresh);assert.equal(x.observations.length,0);
  await x.respond(2);await x.respond(3);assert.equal(x.observations.length,1);
  assert.equal(x.ctx.stockRead.model.view.marker,2);assert.equal(x.events.length,1);
});
test('股市读取期限：定时器迟到时，恰到期限的响应体也不能作为新快照',async()=>{
  for(const elapsed of [30000,31000]){
    const x=setup();x.api.readStock();const market=await x.respond(0,{held:true}),funds=await x.respond(1,{held:true});
    x.at(1000+elapsed);market();funds();await flush();
    assert.equal(x.observations.length,0);assert.equal(x.ctx.stockRead,null);assert.equal(x.ctx.stockReadFailures,1);
    assert.equal(x.calls[0].signal.aborted,true);assert.equal(x.events[0].data.reason,'timeout');
  }
});
test('股市读取期限：补读较旧快照共用原预算，不从补读开始再计30秒',async()=>{
  const x=setup();x.api.readStock();await x.respond(0);x.at(18000);await x.respond(1);
  assert.equal(x.calls.length,3);assert.equal(x.calls[2].path,'/api/stock');
  const release=await x.respond(2,{held:true});x.at(31000);release();await flush();
  assert.equal(x.observations.length,0);assert.equal(x.ctx.stockReadFailures,1);assert.equal(x.ctx.stockController,null);
});
test('股市读取期限：截止前完成仍接受，保持原读取时间与成功重置',async()=>{
  const x=setup();x.ctx.stockReadFailures=1;x.api.readStock();
  const market=await x.respond(0,{held:true}),funds=await x.respond(1,{held:true});
  x.at(30999);market();funds();await flush();
  assert.equal(x.observations.length,1);assert.equal(x.ctx.stockRead.at,30999);
  assert.equal(x.ctx.stockReadFailures,0);assert.equal(x.ctx.stockController,null);assert.equal(x.events.length,0);
});
test('股市读取期限：连续两次挂起有界退出，原单及重试次数保留',async()=>{
  const x=setup();x.api.readStock();await x.respond(0,{held:true});await x.respond(1);
  x.at(31000);x.timers[0]();await flush();x.at(33000);x.api.readStock();
  assert.equal(x.calls.length,4);await x.respond(2,{held:true});await x.respond(3);
  x.at(63000);x.timers[1]();await flush();
  assert.equal(x.finished.length,1);assert.equal(x.ctx.stockReadFailures,2);assert.equal(x.ctx.stockController,null);
  assert.equal(x.ctx.stockLedger.pending,x.pending);assert.equal(x.pending.retries,0);assert.equal(x.observations.length,0);
});
test('股市读取期限：主动取消旧读取不记失败，旧定时器不影响新读取',async()=>{
  const x=setup();x.api.readStock();const release=await x.respond(0,{held:true});await x.respond(1);
  x.api.cancelStockRead();await flush();assert.equal(x.ctx.stockReadFailures,0);
  x.api.readStock();const fresh=x.ctx.stockController;x.timers[0]();release();await flush();
  assert.equal(x.ctx.stockController,fresh);assert.equal(fresh.signal.aborted,false);assert.equal(x.events.length,0);
  await x.respond(2);await x.respond(3);assert.equal(x.observations.length,1);
});
test('股市读取期限：headers尚未到达也能终结，不等底层fetch主动拒绝',async()=>{
  const x=setup();x.api.readStock();x.at(31000);x.timers[0]();await flush();
  assert.equal(x.ctx.stockController,null);assert.equal(x.ctx.stockReadFailures,1);
  await x.respond(0);await x.respond(1);assert.equal(x.observations.length,0);assert.equal(x.events.length,1);
});
test('股市读取期限：后台过期后才收到headers，不再开始读取响应体',async()=>{
  const x=setup();x.api.readStock();let bodies=0;x.at(31000);
  for(const call of x.calls)call.resolve({ok:true,redirected:false,json:async()=>{bodies++;return {userId:77};}});
  await flush();assert.equal(bodies,0);assert.equal(x.ctx.stockReadFailures,1);assert.equal(x.observations.length,0);
});
