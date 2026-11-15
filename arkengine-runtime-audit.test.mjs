import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditRuntime} from './arkengine-runtime-audit.mjs';
const version='1.17.124';
const e=(type,data,at=1000,pageId='page')=>({type,data,at,pageId,version});
const run=events=>auditRuntime({version,events},version);
const data={diagnosticId:'d',confirmedActions:0,visit:{elapsedMs:100},developmentNext:{status:'waiting',reason:'材料不足'}};
function chunks(){const json=JSON.stringify(data),cut=70;return [
  e('shelter-check',{diagnosticId:'d',confirmedActions:0,detailParts:2,detailEncoding:'json-chunks',detailEvent:'shelter-check-detail'}),
  ...[json.slice(0,cut),json.slice(cut)].map((json,part)=>e('shelter-check-detail',{diagnosticId:'d',part,totalParts:2,json}))];}

test('runtime audit: complete fragments reconstruct, duplicate exports do not double observations',()=>{
  const es=chunks(),r=run([...es,...structuredClone(es)]);
  assert.equal(r.coverage.checks.count,1);assert.equal(r.coverage.duplicatesRemoved,3);
  assert.equal(r.visits.medianMs,100);assert.equal(r.visits.zeroConfirmedChecks,1);
  assert.deepEqual(r.construction.states,{waiting:1});assert.equal(r.unknown.lostProduction,null);
});
test('runtime audit: missing, conflicting, cross-page and truncated evidence cannot supply a duration',()=>{
  const scenarios=[es=>es.pop(),es=>es[2].pageId='other',es=>es[2].data.part=0,
    es=>es[2].data.totalParts=3,es=>es[2].data.json='bad',es=>es[0].data.confirmedActions=3,
    es=>es.push({...es[2],data:{...es[2].data,json:'conflicting'}})];
  for(const change of scenarios){const es=chunks();change(es);const r=run(es);
    assert.equal(r.coverage.checks.count,0);assert.equal(r.visits.maxMs,null);
    assert.deepEqual(r.coverage.checkStates,{'incomplete-or-invalid':1});}
  assert.equal(run([e('shelter-check',{...data,truncated:true})]).coverage.checks.count,0);
});
test('runtime audit: crossing midnight is allowed, crossing source versions is not',()=>{
  const es=chunks(),r=auditRuntime({version:'future',days:[{events:es.slice(0,2)},{events:es.slice(2)}]},version);
  assert.equal(r.coverage.checks.count,1);assert.equal(r.eventVersion,version);
  es[2].version='1.17.114';assert.equal(run(es).coverage.checks.count,0);
  assert.throws(()=>auditRuntime({events:[]}),/explicit event version/);
});
test('runtime audit: no evidence is unknown, and malformed timestamps are excluded',()=>{
  const r=run([e('shelter-check',data,-1),{...e('shelter-check',data),pageId:null}]);
  assert.equal(r.coverage.invalidEvents,2);assert.equal(r.coverage.checks.spanMs,null);
  assert.equal(r.visits.medianMs,null);assert.equal(r.unknown.eligibleExplorationIdleMs,null);
});
test('runtime audit: returns require actual confirmations in one page and preserve manual-interaction context',()=>{
  const assign=(to,at,page='page')=>e('shelter-confirmed',{kind:'assign',targets:[7,to]},at,page);
  const es=[assign(10,1000),assign(null,2000),assign(10,3000),e('shelter-user-interaction',{},2500),
    e('shelter-staff-decision',{residentId:7,to:11},4000),assign(11,5000,'other')];
  const r=run(es);assert.equal(r.assignments.confirmed,4);assert.equal(r.assignments.withinPageReturnsIn10m.length,1);
  assert.equal(r.assignments.withinPageReturnsIn10m[0].userInteractionObserved,true);
  assert.equal(r.assignments.withinPageReturnsIn10m[0].spanMs,2000);assert.equal(r.unknown.lostProduction,null);
  assert.equal(run([assign(10,1000),assign(11,2000),assign(10,700000)]).assignments.withinPageReturnsIn10m.length,0);
});
test('runtime audit: wall-clock measurements exclude old, reversed, future and unknown-scope timers',()=>{
  const t={status:'ready',requestedAt:100,finishedAt:800,timingScope:'queue-to-result-wall-clock'};
  const r=run([e('shelter-family-planning',t),e('shelter-planning',{status:'ready'}),
    e('shelter-planning',{...t,requestedAt:900}),e('shelter-planning',{...t,finishedAt:1200}),
    e('shelter-planning',{...t,timingScope:'unknown'})]);
  assert.equal(r.planning.wallClock.count,1);assert.equal(r.planning.wallClock.maxMs,700);
  assert.equal(r.planning.withoutValidTiming,4);
});
