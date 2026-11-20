import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const implementation=source.slice(source.indexOf('  function shelterEmploymentDiagnostic('),source.indexOf('  function shelterDecisionLog('));
const diagnostic=vm.runInNewContext(`${implementation}\nshelterEmploymentDiagnostic`);
function scene(){
  const now=10000000,resident=(id,roomId=null)=>({id,roomId,deadAt:null,away:null,adultAt:0});
  return {m:{now,state:{residents:[resident(1),resident(2),{...resident(3,7),adultAt:now+3600000},
    {...resident(4,8),away:{kind:'explore'}},resident(5,8)],
    rooms:[{id:8,type:'scrap',width:1,builtAt:0,upgradeAt:null,incident:null,unpowered:false}]}},
    campaign:{unemployedResidents:[1],restingResidents:[1,2],defense:{busy:false}},control:{mode:'population'}};
}
test('141日志就业：训练返岗预留不能误报成闲置成人可用空岗，同一预留不重复扣减',()=>{
  const {m,campaign,control}=scene();
  m.state.residents=m.state.residents.filter(person=>person.id!==4);
  campaign.trainingDestinations=[{id:3,room:8},{id:3,room:8},{id:999,room:8}];
  const result=diagnostic(m,campaign,control),room=result.rows.find(row=>row.kind==='employment-room');
  assert.equal(room.occupied,1);assert.equal(room.reserved,1);assert.equal(room.slots,0);
  assert.equal(result.summary.readySlots,0);assert.equal(result.summary.status,'capacity-needed');
});

test('就业诊断：外出占位不当空岗，儿童与可调成人分开，规划不修改人口或产量',()=>{
  const {m,campaign,control}=scene(),before=JSON.stringify({m,campaign}),r=diagnostic(m,campaign,control);
  assert.equal(r.summary.eligibleAdults,2);assert.equal(r.summary.restingAdults,2);
  assert.equal(r.summary.children,1);assert.equal(r.summary.readySlots,0);
  assert.equal(r.summary.status,'capacity-needed');assert.equal(r.summary.shortageAfterConstruction,2);
  assert.equal(r.summary.potentialShortageAfterChildren,3);
  assert.equal(r.rows.find(x=>x.kind==='employment-person'&&x.id===3).remainingMinutes,60);
  assert.equal(JSON.stringify({m,campaign}),before);
});

test('就业诊断：可调池为空仍报告休息和宿舍成人，不伪称没有待安排人员',()=>{
  const {m,campaign,control}=scene();campaign.restingResidents=[];campaign.unemployedResidents=[];
  m.state.rooms.push({id:7,type:'quarters',width:2,builtAt:0,upgradeAt:null});
  m.state.residents.push({id:103,roomId:7,deadAt:null,away:null,adultAt:0});
  const result=diagnostic(m,campaign,control);
  assert.equal(result.summary.eligibleAdults,0);
  assert.equal(result.summary.observedUnassignedAdults,3);
  assert.equal(result.summary.notEligibleOrUnassessedAdults,3);
  assert.equal(result.rows.find(r=>r.id===103).status,'not-eligible-or-unassessed');
  assert.match(result.summary.message,/3名休息或宿舍成人/);
});

test('就业诊断：区分现成空岗、在建岗位、超期未确认和停电岗位，不把在建视为生产',()=>{
  const {m,campaign,control}=scene(),r=m.state.rooms[0];r.width=2;
  assert.equal(diagnostic(m,campaign,control).summary.status,'assignment-needed');
  r.upgradeAt=m.now+600000;
  let d=diagnostic(m,campaign,control);assert.equal(d.summary.status,'waiting-construction');
  assert.equal(d.summary.readySlots,0);assert.equal(d.summary.pendingSlots,2);
  assert.equal(d.rows.at(-1).awaitingConfirmation,false);
  r.upgradeAt=m.now-1;d=diagnostic(m,campaign,control);
  assert.equal(d.summary.status,'waiting-construction');assert.equal(d.rows.at(-1).awaitingConfirmation,true);
  r.unpowered=true;d=diagnostic(m,campaign,control);
  assert.equal(d.summary.pendingSlots,0);assert.equal(d.summary.blockedSlots,2);assert.equal(d.summary.status,'capacity-needed');
});

test('就业诊断：管理关闭、暂停、原单未知、防守与计划缺失分别说明，不能推断没有人手',()=>{
  for(const kind of ['off','held','pending','defense','missing']){
    const {m,campaign,control}=scene();
    if(kind==='off')control.mode='off';
    if(kind==='held')control.held='手动暂停';
    if(kind==='pending')control.pending=true;
    if(kind==='defense')campaign.defense.busy=true;
    const r=diagnostic(m,kind==='missing'?null:campaign,control);
    assert.equal(r.summary.status,kind==='missing'?'not-assessed':'held');
    assert.equal(r.summary.blocks.length,kind==='missing'?0:1);
  }
});

test('就业诊断：等待成年不虚构成人，死亡及外出儿童不计入本轮在家岗位需求',()=>{
  const {m,campaign,control}=scene();campaign.unemployedResidents=[];campaign.restingResidents=[];
  let d=diagnostic(m,campaign,control);assert.equal(d.summary.status,'waiting-adulthood');
  assert.equal(d.summary.eligibleAdults,0);assert.equal(d.summary.earliestAdultAt,m.now+3600000);
  m.state.residents[2].deadAt=m.now;d=diagnostic(m,campaign,control);
  assert.equal(d.summary.status,'no-eligible-adult');assert.equal(d.summary.children,0);
  m.state.residents[2].deadAt=null;m.state.residents[2].away={kind:'explore'};
  assert.equal(diagnostic(m,campaign,control).summary.children,0);
});
