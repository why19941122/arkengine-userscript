import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import {setupParentTraining72,parentContinuationScene} from './arkengine-shelter-parent-training72.fixture.mjs';
import {replayParentTraining72} from './arkengine-shelter-parent-training72-replay.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x)),hour=3600000,tick=600000;
const setup=()=>setupParentTraining72(source,parentContinuationScene());
const scrap=r=>r.checkpoints[72].resources.scrap+r.checkpoints[72].stored.scrap;

test('父母连续训练：实际首格考虑伴侣跨档，改练耐力但不提前分配第二人',()=>{
  const x=setup(),before=JSON.stringify(x.f),plan=x.api.schedule(x.m()),a=plan.actions.find(a=>a.purpose==='parent');
  assert.equal(a.id,5);assert.equal(a.stat,'end');assert.equal(a.destination,4);
  const c=plan.parentTrainingComparison;assert.equal(c.reason,'paired-route-beats-control-continuations');
  assert.equal(c.compared,7);assert.equal(c.continuation.controls.length,3);
  assert.deepEqual(plain(c.selected.steps.map(s=>[s.id,s.stat])),[[5,'end'],[6,'end']]);
  assert.equal(plan.actions.filter(a=>a.purpose==='parent').length,1);assert.equal(plan.reserved.includes(6),false);
  assert.equal(JSON.stringify(x.f),before);
});
test('父母连续训练：首人完成返岗后实际重评伴侣，原人每冷却窗只练一格',()=>{
  const x=setup();x.api.record=vm.runInContext('recordShelterCampaign',x.context);
  const first=x.choose(),p=x.f.view.state.residents.find(p=>p.id===first.id);
  p.roomId=first.room;x.api.record({kind:'assign',targets:[p.id,p.roomId],before:{campaign:{choice:first}},result:{campaignProof:{at:x.f.view.serverTime}}},x.m());
  x.f.view.serverTime+=2*hour;x.f.view.state.lastSettledAt=x.f.view.serverTime;p.stats[first.stat]++;p.training=0;
  const release=x.api.schedule(x.m()).actions.find(a=>a.id===p.id);assert.equal(release.room,4);
  p.roomId=4;x.api.record({kind:'assign',targets:[p.id,4],before:{campaign:{choice:release}},result:{campaignProof:{at:x.f.view.serverTime}}},x.m());
  x.f.view.serverTime+=tick;x.f.view.state.lastSettledAt=x.f.view.serverTime;
  const next=x.choose();assert.equal(next?.id,6);assert.equal(next.stat,'end');assert.equal(next.destination,4);
  assert.ok(!x.api.schedule(x.m()).actions.some(a=>a.id===5&&a.role==='training'));
});
test('父母连续训练：两格串行和两次交接必须在原冷却内，拒绝同人两格及过长路线',()=>{
  const x=setup(),f=x.context.shelterState.families[0],record=x.context.shelterState;
  const project=actions=>x.api.projection(x.m(),f,actions,13,record);
  assert.equal(project([{id:5,room:91},{id:5,room:90}]).comparable,false);
  for(const p of x.f.view.state.residents.filter(p=>[5,6].includes(p.id)))p.familyCooldownUntil=x.f.view.serverTime+3*hour;
  assert.equal(project([{id:5,room:91},{id:6,room:91}]).reason,'training-delays-family');
  const c=x.api.schedule(x.m()).parentTrainingComparison;
  assert.notEqual(c.reason,'paired-route-beats-control-continuations');
});
test('父母连续训练：搜索预算不足以覆盖旧后续时保留原单格决定，不只挑便宜对照',()=>{
  const x=setup(),s=x.f.view.state;
  // A real empty production row raises settlement cost without adding workers.
  s.rooms.push({...s.rooms.find(r=>r.id===4),id:93,floor:5,col:2,width:1});
  const c=x.api.schedule(x.m()).parentTrainingComparison;
  assert.equal(c.continuation.reason,'comparison-work-budget');
  assert.equal(x.choose().stat,'cha');assert.ok(c.compared<=6);
});
test('父母连续训练：其他成人可能开始生产训练时不承诺未建模的伴侣路线',()=>{
  const x=setup();x.f.view.state.residents.find(p=>p.id===7).stats.end=5;
  const plan=x.api.schedule(x.m());assert.equal(plan.actions.find(a=>a.purpose==='parent').stat,'cha');
  assert.equal(plan.parentTrainingComparison.continuation.reason,'other-training-needs-continuation');
  assert.ok(plan.actions.some(a=>a.purpose==='production'),'competing training remains eligible rather than being blocked for the forecast');
});
test('父母连续训练：独立两格结算与原生投影逐情景一致，旧策略真实选择后续作对照',()=>{
  const x=setup(),f=x.context.shelterState.families[0],rows=[];
  for(const route of [null,[{id:5,room:90},{id:6,room:90}],[{id:5,room:90},{id:6,room:91}],
    [{id:5,room:91},{id:6,room:91}]]){
    const projection=x.api.projection(x.m(),f,route,13,x.context.shelterState);assert.ok(projection.comparable);
    for(const [bound,offset] of [['lower',-1],['center',0],['upper',1]]){
      const r=replayParentTraining72(x.f,route,offset),expected=projection.scenarios[bound];
      for(const k of ['power','food','water','scrap','parts','stimpak'])
        assert.ok(Math.abs(r.checkpoints[72].resources[k]+r.checkpoints[72].stored[k]-expected.end[k])<1e-6,`${JSON.stringify(route)}/${bound}/${k}`);
      assert.equal(r.births.length,4);assert.equal(r.employed.length,4);assert.ok(Object.values(r.minimum).every(n=>n>0));
      assert.ok(Math.abs(r.parentWorkHours-expected.parentWorkHours)<1e-7);rows.push(r);
    }
  }
  // Current-source checks run in any checkout. The phase acceptance run also
  // supplies an explicit frozen control, rather than requiring ignored files.
  const scripts=[['after',source]],actual=[];
  if(process.env.ARKENGINE_PARENT_CONTROL_SOURCE)scripts.unshift(['before',readFileSync(process.env.ARKENGINE_PARENT_CONTROL_SOURCE,'utf8')]);
  for(const [label,script] of scripts)for(const offset of [-1,0,1]){
    const control=setupParentTraining72(script,parentContinuationScene()),first=control.choose();
    const r=replayParentTraining72(control.f,first,offset,13,({view,trainingRest})=>{
      control.f.view=view;control.context.shelterState.campaign.trainingRest=trainingRest;return control.choose();
    });
    assert.deepEqual(r.decisions.map(a=>a.room),label==='before'?[90,90]:[91,91]);actual.push({label,...r});
  }
  for(const offset of [-1,0,1]){
    const before=actual.find(r=>r.label==='before'&&r.offset===offset),after=actual.find(r=>r.label==='after'&&r.offset===offset);
    if(before)assert.ok(scrap(after)>scrap(before));
  }
  if(process.env.ARKENGINE_PARENT_CONTINUATION_REPORT)writeFileSync(process.env.ARKENGINE_PARENT_CONTINUATION_REPORT,
    JSON.stringify({projections:rows,actual,conditions:rows[0].conditions},null,2)+'\n');
});
