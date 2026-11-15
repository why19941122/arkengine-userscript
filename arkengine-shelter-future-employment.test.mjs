import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {setupFutureEmployment,futureEmploymentScene} from './arkengine-shelter-future-employment.fixture.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const setup=()=>setupFutureEmployment(source),plain=x=>JSON.parse(JSON.stringify(x)),hour=3600000;
test('未来岗位：当前成人全就业仍须为已有儿童预留名额，暂停电台及新配对',()=>{
  const x=setup(),before=JSON.stringify(x.f),result=x.api.growthEmployment(x.m(),x.context.shelterState);
  assert.equal(result.unemployed.length,0);assert.equal(result.allowed,false);assert.equal(result.future.missing.length,1);
  assert.equal(x.choose(),null);assert.ok(!x.api.schedule(x.m()).actions.some(a=>a.role==='radio'));
  assert.equal(JSON.stringify(x.f),before);
});
test('未来岗位：建设真实儿童岗位可解除暂停，未成年不提前上岗或计产量',()=>{
  const x=setup(),s=x.f.view.state,before=x.m().production.scrap,c=x.api.construction(x.m());
  assert.equal(c?.type,'scrap');assert.equal(c.kind,'build');assert.deepEqual(plain(c.futureEmployment.residents),[13]);
  assert.equal(x.api.idle(x.m(),x.api.schedule(x.m())),null);
  s.resources.scrap-=c.cost.scrap;s.rooms.push({...s.rooms[3],id:40,width:1,level:1,floor:c.floor,col:c.col,stored:0,builtAt:x.f.view.serverTime+600000});
  assert.equal(x.m().production.scrap,before,'construction does not create child production');assert.ok(x.choose());
  x.context.shelterState.pair=null;x.f.view.serverTime+=3*hour;s.lastSettledAt=x.f.view.serverTime;
  x.context.shelterCampaign.radio=false;
  const jobs=[];for(let n=0;n<2;n++){const a=x.api.idle(x.m(),x.api.schedule(x.m()));assert.ok(a);jobs.push(a.id);s.residents.find(p=>p.id===a.id).roomId=a.room;}
  assert.deepEqual(jobs.sort(),[12,13]);assert.ok(x.m().production.scrap>before);assert.ok(x.choose());
});
test('未来岗位：同一训练返岗席位只扣一次，且不能让儿童借用',()=>{
  const x=setup(),s=x.f.view.state,now=x.f.view.serverTime;
  s.rooms.push({...s.rooms[0],id:31,type:'training',trainStat:'end',floor:3,col:3});
  s.residents.push({...structuredClone(s.residents[3]),id:14,name:'原训练',roomId:31,training:.4});
  const role={id:14,room:31,role:'training',purpose:'production',destination:4};
  const record={roles:[role],trainingDestinations:[{id:14,room:4}]};
  const result=x.api.future(x.m(),record);assert.ok(result);assert.equal(result.missing.length,2);
  assert.deepEqual(plain(result.reservedReturns),[14]);assert.equal(s.residents.at(-1).training,.4);
  s.rooms.push({...s.rooms[3],id:40,width:1,level:1,builtAt:now+hour});
  assert.equal(x.api.future(x.m(),record).allowed,true);
});
test('未来岗位：在建名额按实际容量与时间匹配，不借未开工、停电或迟到岗位',()=>{
  for(const reason of ['ready','late','unpowered','occupied','upgrade']){
    const x=setup(),s=x.f.view.state,now=x.f.view.serverTime;
    const r={...s.rooms[3],id:40,width:1,level:1,builtAt:now+hour};s.rooms.push(r);
    if(reason==='late')r.builtAt=now+7*hour;if(reason==='unpowered')r.unpowered=true;
    if(reason==='occupied')for(const id of [14,15])s.residents.push({...structuredClone(s.residents[3]),id,roomId:40});
    if(reason==='upgrade'){r.builtAt=0;r.upgradeAt=now-1;}
    assert.equal(x.api.future(x.m()).allowed,reason==='ready',reason);
  }
});
test('未来岗位：待产不虚构属性；出生成为可观察儿童后才提出提前就业建设',()=>{
  const x=setupFutureEmployment(source,futureEmploymentScene(0)),s=x.f.view.state,now=x.f.view.serverTime;
  s.births=[{roomId:5,parents:[5,7],dueAt:now+hour},{roomId:5,parents:[6,8],dueAt:now+hour}];
  assert.equal(x.api.growthEmployment(x.m()).allowed,false);assert.equal(x.choose(),null);
  assert.ok(!x.plan().development.candidates.some(c=>c.futureEmployment));
  x.f.view.serverTime+=hour;s.lastSettledAt=x.f.view.serverTime;s.births=[];
  for(const id of [12,13])s.residents.push({...structuredClone(s.residents[3]),id,roomId:5,adultAt:x.f.view.serverTime+3*hour});
  assert.ok(x.api.construction(x.m())?.futureEmployment);
});
test('未来岗位：两端感情和待产不会重复计数，父母临时离岗不赠送原座位',()=>{
  const x=setupFutureEmployment(source,futureEmploymentScene(0)),s=x.f.view.state;
  for(const [id,other] of [[5,7],[7,5]])Object.assign(s.residents.find(p=>p.id===id),{roomId:5,romance:{partnerId:other,progress:.5}});
  let f=x.api.future(x.m(),{pair:{a:5,b:7,room:5},families:[{a:5,b:7,room:5}]});
  assert.ok(f);assert.equal(f.assignments.filter(a=>a.kind==='family').length,1);assert.equal(f.freeSlots,0);
  s.births=[{roomId:5,parents:[5,7],dueAt:x.f.view.serverTime+hour}];
  f=x.api.future(x.m(),{pair:{a:5,b:7,room:5},families:[{a:5,b:7,room:5}]});
  assert.equal(f.assignments.filter(a=>a.kind==='family').length,0);assert.equal(f.assignments.filter(a=>a.kind==='birth').length,1);
});
test('未来岗位：预算、开关与供应继续约束提前建设，未来产量不进入等级路线攒料',()=>{
  for(const reason of ['budget','switch','supply','layout']){
    const x=setup();if(reason==='budget')Object.assign(x.context.shelterConstruction,{budgetMode:'daily',scrapLimit:0});
    if(reason==='switch')x.context.shelterConstruction.build=false;
    if(reason==='supply')x.f.view.state.resources.food=0;
    if(reason==='layout')x.f.view.state.rooms[0].col=null;
    const c=x.api.construction(x.m());assert.ok(!c?.futureEmployment,reason);
  }
  const x=setup(),c=x.plan().development.candidates.find(c=>c.futureEmployment);assert.ok(c);
  assert.ok(c.economics.paybackHours>3);assert.ok(!c.scrapInvestment);
  assert.deepEqual(plain(x.api.routes(x.m(),[c],999,c,{deep:false})),[]);
});
test('未来岗位：原配对承诺继续完成，不因后续缺岗撤销当前家庭',()=>{
  const x=setupFutureEmployment(source,futureEmploymentScene(0)),s=x.f.view.state,first=x.choose();assert.ok(first);
  s.residents.find(p=>p.id===first.id).roomId=first.room;
  s.residents.push(...futureEmploymentScene().view.state.residents.filter(p=>p.id>=12).map(p=>({...p,parents:[]})));
  const a=x.choose();assert.ok(a);assert.notEqual(a.id,first.id);assert.equal(a.room,first.room);
});

test('未来岗位：失效返岗目标仍需占替代席位；时间自然流逝不改变同一建设身份',()=>{
  const x=setup(),s=x.f.view.state;
  s.rooms.push({...s.rooms[0],id:31,type:'training',trainStat:'end',floor:3,col:3});
  s.residents.push({...structuredClone(s.residents[3]),id:14,name:'原训练',roomId:31,training:.4});
  const f=x.api.future(x.m(),{roles:[{id:14,room:31,role:'training',purpose:'production',destination:999}]});
  assert.equal(f.missing.length,2);assert.ok(f.assignments.some(a=>a.id===14&&a.kind==='adult'));
  const y=setup(),before=y.api.construction(y.m());y.f.view.serverTime+=30000;y.f.view.state.lastSettledAt=y.f.view.serverTime;
  const after=y.api.construction(y.m());assert.deepEqual(plain(after.futureEmployment),plain(before.futureEmployment));
});
