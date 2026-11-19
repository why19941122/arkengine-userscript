import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {setupParent72,replayParent72} from './arkengine-shelter-parent72.fixture.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x)),hour=3600000;
const pair=(x,ids)=>ids.map(id=>x.f.view.state.residents.find(p=>p.id===id));

test('三天父母：真实新配对允许较低总属性，保守子代仍胜过原高属性组合的乐观情景',()=>{
  const x=setupParent72(source),events=[];x.context.log.add=(...args)=>events.push(args);
  const before=JSON.stringify(x.f.view);assert.ok(x.choose());
  const chosen=x.context.shelterState.pair,entry=events.find(e=>e[0]==='shelter-population')[2];
  assert.deepEqual([chosen.a,chosen.b],[5,7]);assert.equal(entry.ranking,'development72-genetic-bounds');
  assert.ok(entry.assessment.baseTotal<31);assert.ok(entry.assessment.romanceHours<10);
  assert.ok(entry.development72.lower.end.scrap>entry.developmentComparison.baseline.upper.end.scrap);
  assert.equal(JSON.stringify(x.f.view),before);
});
test('三天父母：遗传取整与上下界独立记录，不把中点当确定子代或概率',()=>{
  const x=setupParent72(source),people=pair(x,[5,7]);people[0].stats.end=4;
  const a=x.api.assessment(x.api.model(x.f.view),people);
  assert.equal(a.midpoint.end,4.5);assert.equal(a.inheritance.center.end,4);
  assert.equal(a.inheritance.lower.end,3);assert.equal(a.inheritance.upper.end,5);
  assert.equal(a.inheritance.probabilities,'unknown');
  people.forEach(p=>{p.stats.str=10;p.stats.cha=0;});people[0].stats.cha=1;
  const b=x.api.assessment(x.api.model(x.f.view),people);
  assert.equal(b.inheritance.upper.str,10);assert.equal(b.inheritance.lower.cha,1);
});
test('三天父母：新生儿必须等成年和交接后到真实空岗，父母离岗损失覆盖孕前和返岗交接',()=>{
  const x=setupParent72(source),m=x.api.model(x.f.view),p=pair(x,[5,7]),before=JSON.stringify(x.f);
  const a=x.api.projection(m,p);assert.equal(a.comparable,true);assert.equal(a.childRoom,4);
  assert.ok(Math.abs(a.conceptionHours-13/6)<1e-8);
  assert.ok(Math.abs(a.childWorkHours-a.conceptionHours-6-1/6)<1e-8);
  assert.ok(Math.abs(a.parentReturnHours-a.conceptionHours-1/6)<1e-8);
  assert.ok(a.lower.end.scrap<a.upper.end.scrap);assert.ok(Object.values(a.lower.minimumSupply).every(n=>n>=0));
  assert.equal(JSON.stringify(x.f),before);
});
test('三天父母：满岗位、现有训练、其他闲人、待产和施工均不能虚构新劳动力收益',()=>{
  for(const condition of ['full','held-seat','training','idle','child','birth','construction','event','supply','clock']){
    const x=setupParent72(source),s=x.f.view.state;
    if(condition==='full')s.residents.push({...structuredClone(s.residents[3]),id:9,roomId:4});
    if(condition==='training')s.rooms.find(r=>r.id===1).type='training';
    if(condition==='idle')s.residents[0].roomId=null;
    if(condition==='child')s.residents[0].adultAt=x.f.view.serverTime+hour;
    if(condition==='birth')s.births.push({parents:[1,2],roomId:5,dueAt:x.f.view.serverTime+hour});
    if(condition==='construction')s.rooms[0].upgradeAt=x.f.view.serverTime+hour;
    if(condition==='event')x.f.view.env.events.push({kind:'production',startsAt:x.f.view.serverTime+hour,endsAt:x.f.view.serverTime+2*hour,percent:150});
    if(condition==='supply')s.resources.food=1;
    if(condition==='clock')s.lastSettledAt-=600000;
    const m=x.api.model(x.f.view);if(condition==='held-seat')m.trainingDestinations=[{id:1,room:4}];
    assert.equal(x.api.projection(m,pair(x,[5,7])).comparable,false,condition);
  }
});
test('三天父母：首人已入住后属性和产出变化不另换组合，刷新继续第二步',()=>{
  const x=setupParent72(source),first=x.choose(),chosen=plain(x.context.shelterState.pair);
  x.f.view.state.residents.find(p=>p.id===first.id).roomId=first.room;
  x.f.view.state.residents.find(p=>p.id===8).stats.end=10;
  x.context.shelterState=plain(x.context.shelterState);
  const second=x.choose();assert.equal(second.id,chosen.a===first.id?chosen.b:chosen.a);assert.equal(second.room,chosen.room);
  assert.equal(x.context.shelterState.pair.a,chosen.a);assert.equal(x.context.shelterState.pair.b,chosen.b);
});
test('三天父母：当遗传范围与窗口不能证明优势时保持原高属性控制方案',()=>{
  const x=setupParent72(source);for(const p of pair(x,[7,8]))p.stats.cha=9;
  assert.ok(x.choose());assert.deepEqual([x.context.shelterState.pair.a,x.context.shelterState.pair.b],[7,8]);
});
test('三天父母：独立家庭与资源结算复核孕前停产、父母回岗、出生和成年生产',()=>{
  for(const ids of [[7,8],[5,7]]){
    const x=setupParent72(source),profile=x.api.projection(x.api.model(x.f.view),pair(x,ids));
    for(const [bound,offset] of [['lower',-1],['upper',1]]){
      const r=replayParent72(x.f,ids,offset),at72=r.checkpoints[72];
      assert.equal(r.population,9);assert.ok(Object.values(r.minimum).every(n=>n>0));
      assert.ok(Math.abs(r.timeline.find(e=>e.kind==='child-work').hours-profile.childWorkHours)<1e-8);
      for(const k of ['scrap','parts','stimpak'])
        assert.ok(Math.abs(at72.resources[k]+at72.stored[k]-profile[bound].end[k])<1e-6,ids+'/'+bound+'/'+k);
    }
  }
});
