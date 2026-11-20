import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const api=vm.runInNewContext(source.slice(source.indexOf('  const LOG_BUDGET ='),source.indexOf('  function diagnosticCoverage('))+
  '\n({priority:logPriority,critical:criticalLog,normal:normalLog,version:LOG_PRIORITY_VERSION})');
test('诊断优先级修复：正常生命周期和短暂加载先淘汰，规划及股市决策与现场同等保留',()=>{
  const routine=[{type:'page-lifecycle',data:{event:'load',online:true,gapMs:2}},
    {type:'page-blocked',data:{blockedMs:0,attempt:0}}, {type:'expedition-blocked',data:{reason:'quota'}}];
  for(const event of routine){assert.equal(api.critical(event),false);assert.equal(api.normal(event),true);}
  for(const type of ['shelter-planning','shelter-family-planning','stock-check','stock-decision','stock-decision-detail']){
    assert.equal(api.priority({type}),api.priority({type:'shelter-decision'}),type);
    assert.ok(api.priority({type})>api.priority(routine[0]));
  }
});
test('诊断优先级修复：真实故障、长等待、页面丢弃与所有收益原单仍优先',()=>{
  for(const event of [{type:'page-lifecycle',data:{discarded:true}}, {type:'page-lifecycle',data:{online:false}},
    {type:'page-lifecycle',data:{gapMs:90000}}, {type:'page-blocked',data:{blockedMs:90000}},
    {type:'page-blocked',data:{attempt:1}}, {type:'runtime-error'}, {type:'shelter-execution-evidence'}, {type:'shelter-paused'},
    {type:'page-lifecycle',receiptId:'actual-receipt'}, {type:'stock-confirmed'}, {type:'shelter-rescue-rejected'},
    {type:'shelter-recall-opened'}, {type:'shelter-recall-control-wait'}, {type:'encounter-quota'}]){
    assert.equal(api.critical(event),true,JSON.stringify(event));assert.equal(api.priority(event),2);
  }
});
test('修炼低频心跳和长等待结束与业务摘要同级，不挤占原单',()=>{
  for(const event of [{type:'heartbeat'},{type:'page-wait-ended',data:{blockedMs:90000}}]){
    assert.equal(api.priority({...event,group:'cultivate'}),1.5);
    assert.ok(api.priority({...event,group:'expedition'})<1.5);
  }
});
