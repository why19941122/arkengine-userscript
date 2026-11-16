import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync,writeFileSync} from 'node:fs';
import {setupParentTraining72} from './arkengine-shelter-parent-training72.fixture.mjs';
import {replayParentTraining72} from './arkengine-shelter-parent-training72-replay.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x)),hour=3600000;

test('父母训练三天：遗传取整与感情结算均不变的魅力不再压过有效耐力',()=>{
  const x=setupParentTraining72(source),before=JSON.stringify(x.f),plan=x.api.schedule(x.m()),a=plan.actions.find(a=>a.purpose==='parent');
  assert.equal(a?.id,6);assert.equal(a.stat,'end');assert.equal(a.room,91);
  assert.equal(plan.parentTrainingComparison.reason,'better-in-each-explicit-inheritance-scenario');
  assert.equal(plan.parentTrainingComparison.independentBoundsSeparated,false,'paired scenarios are not an independent-outcome guarantee');
  assert.equal(plan.parentTrainingComparison.control.noKnownGain,true);assert.equal(JSON.stringify(x.f),before);
  for(const bound of ['lower','center','upper']){
    const c=plan.parentTrainingComparison;
    assert.ok(c.selected.scenarios[bound].end.scrap>c.baseline.scenarios[bound].end.scrap);
    assert.ok(c.selected.scenarios[bound].end.scrap>c.control.scenarios[bound].end.scrap);
    assert.equal(c.selected.scenarios[bound].born,4);assert.equal(c.selected.scenarios[bound].working,4);
  }
});

test('父母训练三天：单格未跨遗传档不构成永久禁训，保留伴侣后续跨档的原培养路径',()=>{
  const x=setupParentTraining72(source);x.f.view.state.rooms=x.f.view.state.rooms.filter(r=>r.id!==91);
  const p=x.api.schedule(x.m()),first=p.actions.find(a=>a.purpose==='parent');assert.equal(first?.stat,'cha');
  assert.ok(!p.projects.some(p=>p.type==='training'));
  assert.equal(p.parentTrainingComparison.reason,'no-proven-window-change');
  const person=x.f.view.state.residents.find(p=>p.id===first.id);person.stats.cha++;
  const next=x.choose();assert.ok(next);assert.equal(next.stat,'cha');assert.notEqual(next.id,first.id);
  const f=x.context.shelterState.families[0],pair=[f.a,f.b].map(id=>x.f.view.state.residents.find(p=>p.id===id));
  const before=x.api.assessment(x.m(),pair),after=x.api.assessment(x.m(),pair.map(p=>p.id===next.id?{...p,stats:{...p.stats,cha:p.stats.cha+1}}:p));
  assert.ok(after.inheritance.center.cha>before.inheritance.center.cha);
  assert.ok(Math.ceil(120/after.charm)<Math.ceil(120/before.charm));
});

test('父母训练三天：当前训练不重新排名，不中断原格或续写期限',()=>{
  const x=setupParentTraining72(source),s=x.f.view.state,now=x.f.view.serverTime,p=s.residents.find(p=>p.id===6);
  p.roomId=90;p.training=.4;
  x.context.shelterState.campaign.roles=[{id:6,room:90,role:'training',at:now,stat:'cha',base:9,purpose:'parent',until:now+6*hour}];
  const before=JSON.stringify(x.context.shelterState),plan=x.api.schedule(x.m());
  assert.ok(plan.reserved.includes(6));assert.ok(!plan.actions.some(a=>a.id===6));
  assert.equal(JSON.stringify(x.context.shelterState),before);assert.equal(p.training,.4);
});

test('父母训练三天：岗位、床位和目标限制多轮子代数，不计未落实岗位',()=>{
  const x=setupParentTraining72(source),f=x.context.shelterState.families[0],record=x.context.shelterState;
  const project=target=>x.api.projection(x.m(),f,{id:6,room:91},target,record);
  assert.equal(project(10).scenarios.center.working,1);
  x.f.view.state.rooms=x.f.view.state.rooms.filter(r=>r.id!==92);
  assert.equal(project(13).scenarios.center.working,1);
  x.f.view.state.rooms.find(r=>r.id===5).level=1;
  assert.equal(project(13).scenarios.center.working,0);
});

test('父母训练三天：待产、其他家庭、在训、工程、外出和事件边界需要后续模型，不伪造可比收益',()=>{
  for(const kind of ['birth','family','training','construction','away','event','supply','clock']){
    const x=setupParentTraining72(source),s=x.f.view.state,now=x.f.view.serverTime;
    if(kind==='birth')s.births=[{roomId:5,parents:[5,6],dueAt:now+hour}];
    if(kind==='family')x.context.shelterState.families.push({a:7,b:8,room:5});
    if(kind==='training'){s.residents[0].roomId=90;s.residents[0].training=.4;}
    if(kind==='construction')s.rooms[0].upgradeAt=now+hour;
    if(kind==='away')s.residents[0].away={kind:'explore'};
    if(kind==='event')x.f.view.env.events=[{kind:'production',startsAt:now+hour,endsAt:now+2*hour,percent:150}];
    if(kind==='supply')s.resources.food=0;if(kind==='clock')s.lastSettledAt=now-600000;
    assert.equal(x.api.projection(x.m(),x.context.shelterState.families[0],{id:6,room:91},13,x.context.shelterState).comparable,false,kind);
  }
});

test('父母训练三天：同步比较有固定工作上限，超限保留原决定而不启动长计算',()=>{
  const x=setupParentTraining72(source),m=x.m(),p=m.state.residents.find(p=>p.id===6),r=m.state.rooms.find(r=>r.id===90);
  const option={p,r,...x.api.estimate(m,p,r)};
  m.rooms=Array.from({length:50},(_,id)=>({...m.rooms[0],id,batch:1}));
  const choice=x.api.trainingChoice(m,[option],x.context.shelterState,13);
  assert.equal(choice.choice,option);assert.equal(choice.comparison.reason,'comparison-work-budget');
  assert.equal(choice.comparison.comparable,false);
});

test('父母训练三天：独立结算验证单格训练、四轮生育、返岗及子代就业的三种遗传情景',()=>{
  const x=setupParentTraining72(source),family=x.context.shelterState.families[0],results=[];
  for(const action of [null,{id:6,room:90},{id:6,room:91}]){
    const projection=x.api.projection(x.m(),family,action,13,x.context.shelterState);assert.ok(projection.comparable);
    for(const [bound,offset] of [['lower',-1],['center',0],['upper',1]]){
      const r=replayParentTraining72(x.f,action,offset),expected=projection.scenarios[bound];
      assert.equal(r.births.length,4);assert.equal(r.employed.length,4);assert.equal(r.endPopulation,13);
      assert.ok(Object.values(r.minimum).every(v=>v>0));assert.equal(r.trainingEvents.length,action?1:0);
      assert.ok(Math.abs(r.parentWorkHours-expected.parentWorkHours)<1e-7);
      for(const k of ['power','food','water','scrap','parts','stimpak'])
        assert.ok(Math.abs(r.checkpoints[72].resources[k]+r.checkpoints[72].stored[k]-expected.end[k])<1e-6,`${JSON.stringify(action)}/${bound}/${k}`);
      results.push(r);
    }
  }
  if(process.env.ARKENGINE_PARENT72_REPORT)writeFileSync(process.env.ARKENGINE_PARENT72_REPORT,JSON.stringify({results,conditions:results[0].conditions},null,2)+'\n');
});
