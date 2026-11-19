import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import {setupParentTraining72,parentContinuationScene} from './arkengine-shelter-parent-training72.fixture.mjs';
import {replayParentTraining72} from './arkengine-shelter-parent-training72-replay.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function scene(duplicates=1){
  const f=parentContinuationScene(),s=f.view.state,room=s.rooms.find(r=>r.id===90);
  for(let i=0;i<duplicates;i++)s.rooms.push({...room,id:93+i,floor:3+2*Math.floor(i/4),col:4+i%4});
  return f;
}
const setup=(duplicates=1)=>setupParentTraining72(source,scene(duplicates));
test('父母候选去重：多一间相同魅力室不应挤掉本可验证的耐力接续路线',()=>{
  const x=setup(),before=JSON.stringify(x.f),plan=x.api.schedule(x.m()),first=plan.actions.find(a=>a.purpose==='parent');
  assert.equal(first?.id,5);assert.equal(first.stat,'end');assert.equal(first.room,91);
  assert.equal(plan.parentTrainingComparison.reason,'paired-route-beats-control-continuations');
  assert.equal(plan.parentTrainingComparison.compared,7);assert.equal(plan.parentTrainingComparison.truncated,false);
  assert.equal(plan.parentTrainingComparison.equivalentRoomsSkipped,2);
  assert.equal(JSON.stringify(x.f),before);
});

test('父母候选去重：房间越多不重复投影，仍分别核对两位父母和所有旧后续',()=>{
  for(const duplicates of [0,1,4,6]){
    const x=setup(duplicates);x.context.trainingProjectionCalls=[];x.context.trainingChoiceCalls=[];
    vm.runInContext(`const projectBefore=shelterParentTrainingProjection,choiceBefore=shelterParentTrainingChoice;
      shelterParentTrainingProjection=(m,f,route,...rest)=>{trainingProjectionCalls.push(route);return projectBefore(m,f,route,...rest);};
      shelterParentTrainingChoice=(...args)=>{const start=trainingProjectionCalls.length,result=choiceBefore(...args);
        trainingChoiceCalls.push(trainingProjectionCalls.slice(start));return result;};`,x.context);
    const plan=x.api.schedule(x.m()),c=plan.parentTrainingComparison;
    assert.equal(c.reason,'paired-route-beats-control-continuations');assert.equal(c.compared,7);
    assert.equal(c.equivalentRoomsSkipped,duplicates*2);
    // The actual schedule evaluates admission and then manufacturing staffing.
    // Each comparison retains its own bounded work, including its baseline.
    assert.equal(x.context.trainingChoiceCalls.length,2);assert.equal(x.context.trainingProjectionCalls.length,16);
    assert.equal(c.continuation.controls.length,3);
    for(const calls of x.context.trainingChoiceCalls){
      assert.equal(calls.length,8);const singles=calls.filter(a=>a&&!Array.isArray(a));
      assert.deepEqual(JSON.parse(JSON.stringify(singles.map(a=>[a.id,a.room]))),[[5,90],[6,90],[5,91],[6,91]]);
    }
  }
});

test('父母候选去重：不同房间等级耗时仍独立，真正超预算继续保守回退',()=>{
  const x=setup();x.f.view.state.rooms.find(r=>r.id===93).level=2;
  const c=x.api.schedule(x.m()).parentTrainingComparison;
  assert.equal(c.equivalentRoomsSkipped,0);assert.equal(c.compared,6);
  assert.equal(c.continuation.reason,'comparison-work-budget');assert.equal(x.choose().stat,'cha');
});

test('父母候选去重：不同属性不可合并，未覆盖真实控制路线时不提升两格方案',()=>{
  const x=setup(3),s=x.f.view.state;
  for(const [i,stat] of ['str','per','agi'].entries())s.rooms.find(r=>r.id===93+i).trainStat=stat;
  const c=x.api.schedule(x.m()).parentTrainingComparison;
  assert.equal(c.equivalentRoomsSkipped,0);assert.equal(c.compared,8);assert.equal(c.truncated,true);
  assert.notEqual(c.reason,'paired-route-beats-control-continuations');
});

test('父母候选去重：保留原首个真实房间，失效或属性变化后从新快照选择',()=>{
  const x=setup(),s=x.f.view.state;s.rooms=s.rooms.filter(r=>r.id!==91);
  assert.equal(x.choose().room,90);
  s.rooms=s.rooms.filter(r=>r.id!==90);assert.equal(x.choose().room,93);
  s.rooms.find(r=>r.id===93).trainStat='end';assert.equal(x.choose().room,93);assert.equal(x.choose().stat,'end');
});

test('父母候选去重：真实竞争及其他家庭不因相同房间而被忽略',()=>{
  const competing=setup();competing.f.view.state.residents.find(p=>p.id===7).stats.end=5;
  const plan=competing.api.schedule(competing.m());
  assert.equal(plan.parentTrainingComparison.continuation.reason,'other-training-needs-continuation');
  assert.ok(plan.actions.some(a=>a.id===7&&a.purpose==='production'));
  const multi=setup();multi.context.shelterState.families.push({a:7,b:8,room:5});
  const c=multi.api.schedule(multi.m()).parentTrainingComparison;
  assert.equal(c.comparable,false);assert.equal(c.reason,'other-commitments-need-continuation');
});

test('父母候选去重：同一有效布局三天旧新实际接续，去重不改变结算规则',()=>{
  const scripts=[['after',source]],actual=[];
  if(process.env.ARKENGINE_PARENT_ALTERNATIVES_CONTROL_SOURCE)scripts.unshift(['before',
    readFileSync(process.env.ARKENGINE_PARENT_ALTERNATIVES_CONTROL_SOURCE,'utf8')]);
  for(const [label,script] of scripts)for(const offset of [-1,0,1]){
    const x=setupParentTraining72(script,scene()),first=x.choose();
    const r=replayParentTraining72(x.f,first,offset,13,({view,trainingRest})=>{
      x.f.view=view;x.context.shelterState.campaign.trainingRest=trainingRest;return x.choose();
    });
    assert.deepEqual(r.decisions.map(a=>a.room),label==='before'?[90,90]:[91,91]);
    assert.equal(r.births.length,4);assert.equal(r.employed.length,4);assert.equal(r.endPopulation,13);
    assert.ok(Object.values(r.minimum).every(v=>v>0));actual.push({label,...r});
  }
  const total=(r,k)=>r.checkpoints[72].resources[k]+r.checkpoints[72].stored[k];
  for(const offset of [-1,0,1]){
    const before=actual.find(r=>r.label==='before'&&r.offset===offset),after=actual.find(r=>r.label==='after'&&r.offset===offset);
    if(before)for(const k of ['scrap','parts','stimpak'])assert.ok(total(after,k)>=total(before,k));
  }
  if(process.env.ARKENGINE_PARENT_ALTERNATIVES_REPORT)writeFileSync(process.env.ARKENGINE_PARENT_ALTERNATIVES_REPORT,
    JSON.stringify({actual,conditions:actual[0].conditions},null,2)+'\n');
});
