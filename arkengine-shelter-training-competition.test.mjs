import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import {setupParentTraining72,parentContinuationScene} from './arkengine-shelter-parent-training72.fixture.mjs';
import {replayParentTraining72} from './arkengine-shelter-parent-training72-replay.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
export function competitionScene(){
  const f=parentContinuationScene();
  for(const p of f.view.state.residents.filter(p=>[1,2,3,9].includes(p.id)))p.stats.end=2;
  return f;
}
function setup(script=source){
  const x=setupParentTraining72(script,competitionScene());
  Object.assign(x.api,vm.runInContext('({trainingReturn:shelterTrainingReturn,purpose:typeof shelterTrainingPurpose===\'function\'?shelterTrainingPurpose:null})',x.context));return x;
}
test('训练竞争一致性：基础供给人员不具备耐力生产用途，不应阻断父母的两格路线',()=>{
  const x=setup(),m=x.m(),room=m.state.rooms.find(r=>r.id===91),before=JSON.stringify(x.f);
  for(const id of [1,2,3,9]){
    const p=m.state.residents.find(p=>p.id===id),assessment=x.api.trainingReturn(m,p,room);
    assert.equal(assessment.eligible,false);assert.equal(assessment.reason,'cross-resource-opportunity');
  }
  const plan=x.api.schedule(m),first=plan.actions.find(a=>a.purpose==='parent');
  assert.equal(first.id,5);assert.equal(first.stat,'end');
  assert.equal(plan.parentTrainingComparison.reason,'paired-route-beats-control-continuations');
  assert.ok(!plan.actions.some(a=>a.purpose==='production'));
  assert.equal(JSON.stringify(x.f),before);
});

test('训练竞争一致性：真实回收工训练继续竞争，不冻结他来维持父母预测',()=>{
  const x=setup();x.f.view.state.residents.find(p=>p.id===7).stats.end=5;
  const m=x.m(),p=m.state.residents.find(p=>p.id===7),room=m.state.rooms.find(r=>r.id===91);
  assert.equal(x.api.trainingReturn(m,p,room).eligible,true);
  const plan=x.api.schedule(m);assert.equal(plan.actions.find(a=>a.purpose==='parent').stat,'cha');
  assert.equal(plan.parentTrainingComparison.continuation.reason,'other-training-needs-continuation');
  assert.ok(plan.actions.some(a=>a.id===7&&a.purpose==='production'&&a.room===91));
});

test('训练竞争一致性：同一居民从供电换到回收岗时立即重评，换回可恢复父母路线',()=>{
  const x=setup(),s=x.f.view.state,p=s.residents.find(p=>p.id===1),replacement=s.residents.find(p=>p.id===7),
    room=s.rooms.find(r=>r.id===91);
  replacement.stats.str=p.stats.str;
  assert.equal(x.choose().stat,'end');assert.equal(x.api.trainingReturn(x.m(),p,room).reason,'cross-resource-opportunity');
  p.roomId=4;replacement.roomId=1;
  assert.equal(x.api.trainingReturn(x.m(),p,room).eligible,true);
  const plan=x.api.schedule(x.m());assert.equal(plan.actions.find(a=>a.purpose==='parent').stat,'cha');
  assert.equal(plan.parentTrainingComparison.continuation.reason,'other-training-needs-continuation');
  p.roomId=1;replacement.roomId=4;
  assert.equal(x.choose().stat,'end');
});

test('训练竞争一致性：空闲或来源未知不能据此排除竞争，父母预测保留不确定性',()=>{
  for(const origin of [null,999,5]){
    const x=setup(),p=x.f.view.state.residents.find(p=>p.id===7);p.stats.end=5;p.roomId=origin;
    const m=x.m(),room=m.state.rooms.find(r=>r.id===91);
    assert.equal(x.api.purpose(m,p,room).compatible,true);
    assert.notEqual(x.api.trainingReturn(m,p,room).reason,'cross-resource-opportunity');
    const comparison=x.api.schedule(m).parentTrainingComparison;
    assert.notEqual(comparison?.reason,'paired-route-beats-control-continuations');
  }
});

test('训练竞争一致性：所有生产用途沿用原跨资源边界，魅力幸运不冒充生产训练',()=>{
  const x=setup(),s=x.f.view.state,p=s.residents.find(p=>p.id===7),origin=s.rooms.find(r=>r.id===4),
    room=s.rooms.find(r=>r.id===91);
  for(const [type,stat] of [['power','str'],['water','per'],['scrap','end'],['diner','agi'],['workshop','int']]){
    origin.type=type;
    for(const other of ['str','per','end','agi','int','cha','lck']){
      room.trainStat=other;p.stats[other]=5;const m=x.m(),purpose=x.api.purpose(m,p,room),a=x.api.trainingReturn(m,p,room);
      assert.equal(purpose.compatible,other===stat,`${type}/${other}`);
      if(['cha','lck'].includes(other))assert.equal(a.reason,'requires-family-or-combat-benefit');
      else if(other!==stat)assert.equal(a.reason,'cross-resource-opportunity');
      else assert.notEqual(a.reason,'cross-resource-opportunity');
    }
  }
  origin.type='medbay';room.trainStat='int';
  assert.equal(x.api.trainingReturn(x.m(),p,room).reason,'cross-resource-opportunity');
});

test('训练竞争一致性：短窗口或暂缺零件用途不能变成永久无竞争证据',()=>{
  const x=setup(),s=x.f.view.state,p=s.residents.find(p=>p.id===7),room=s.rooms.find(r=>r.id===91);
  p.stats.end=5;
  assert.equal(x.api.trainingReturn(x.m(),p,room,1).eligible,false);
  assert.equal(x.api.purpose(x.m(),p,room).compatible,true);
  assert.equal(x.api.schedule(x.m()).parentTrainingComparison.continuation.reason,'other-training-needs-continuation');
  const origin=s.rooms.find(r=>r.id===p.roomId);origin.type='workshop';room.trainStat='int';
  assert.equal(x.api.trainingReturn(x.m(),p,room).reason,'no-parts-purpose');
  assert.equal(x.api.purpose(x.m(),p,room).compatible,true);
  const available=x.api.trainingReturn(x.m(),p,room,168,{partsTarget:20});
  assert.notEqual(available.reason,'no-parts-purpose');
});

test('训练竞争一致性：目标已达的非父母不阻挡路线，目标以下仍保留竞争',()=>{
  const x=setup(),p=x.f.view.state.residents.find(p=>p.id===7);p.stats.end=5;
  x.context.shelterCampaign.trainTarget=5;
  assert.equal(x.choose().stat,'end');
  p.stats.end=4;
  assert.equal(x.api.schedule(x.m()).parentTrainingComparison.continuation.reason,'other-training-needs-continuation');
});

test('训练竞争一致性：三天独立结算接真实新旧后续，基础供给岗位全程保持',()=>{
  const scripts=[['after',source]],actual=[];
  if(process.env.ARKENGINE_TRAINING_COMPETITION_CONTROL_SOURCE)scripts.unshift(['before',
    readFileSync(process.env.ARKENGINE_TRAINING_COMPETITION_CONTROL_SOURCE,'utf8')]);
  for(const [label,script] of scripts)for(const offset of [-1,0,1]){
    const x=setupParentTraining72(script,competitionScene()),first=x.choose();
    const r=replayParentTraining72(x.f,first,offset,13,({view,trainingRest})=>{
      x.f.view=view;x.context.shelterState.campaign.trainingRest=trainingRest;return x.choose();
    });
    assert.deepEqual(r.decisions.map(a=>a.room),label==='before'?[90,90]:[91,91]);
    assert.equal(r.births.length,4);assert.equal(r.employed.length,4);assert.equal(r.endPopulation,13);
    assert.ok(Object.values(r.minimum).every(v=>v>0));
    assert.ok(!r.moves.some(a=>[1,2,3,9].includes(a.id)));actual.push({label,...r});
  }
  const total=(r,k)=>r.checkpoints[72].resources[k]+r.checkpoints[72].stored[k];
  for(const offset of [-1,0,1]){
    const before=actual.find(r=>r.label==='before'&&r.offset===offset),after=actual.find(r=>r.label==='after'&&r.offset===offset);
    if(before){assert.ok(total(after,'scrap')>total(before,'scrap'));
      for(const k of ['parts','stimpak'])assert.ok(total(after,k)>=total(before,k));}
  }
  if(process.env.ARKENGINE_TRAINING_COMPETITION_REPORT)writeFileSync(process.env.ARKENGINE_TRAINING_COMPETITION_REPORT,
    JSON.stringify({actual,conditions:actual[0].conditions},null,2)+'\n');
});
