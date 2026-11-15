import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const integer=n=>Number.isSafeInteger(n)&&n>=0;
const counts=values=>Object.fromEntries([...new Set(values)].sort().map(v=>[v,values.filter(x=>x===v).length]));
const span=events=>({count:events.length,from:events[0]?.at??null,to:events.at(-1)?.at??null,
  spanMs:events.length>1?events.at(-1).at-events[0].at:null});
const stats=values=>{const a=values.filter(integer).sort((a,b)=>a-b);return {count:a.length,
  medianMs:a.length?a[Math.ceil(a.length*.5)-1]:null,p95Ms:a.length?a[Math.ceil(a.length*.95)-1]:null,maxMs:a.at(-1)??null};};
const key=e=>JSON.stringify([e.version,e.pageId,e.data?.diagnosticId]);
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);

// Observed checks and confirmed actions, never an interpolation of eligible work
// or a counterfactual yield. Version and page identities cannot be merged silently.
export function auditRuntime(log,version){
  assert.ok(typeof version==='string'&&version,'An explicit event version is required');
  const raw=Array.isArray(log.events)?log.events:(log.days??[]).flatMap(d=>d.events??[]);
  const selected=raw.filter(e=>e.version===version),seen=new Set(),events=[];let duplicatesRemoved=0,invalidEvents=0;
  for(const e of selected){
    if(!integer(e.at)||typeof e.pageId!=='string'||!e.pageId||typeof e.type!=='string'){invalidEvents++;continue;}
    const identity=canonical({at:e.at,pageId:e.pageId,version:e.version,type:e.type,data:e.data,detail:e.detail});
    if(seen.has(identity)){duplicatesRemoved++;continue;}seen.add(identity);events.push(e);
  }
  events.sort((a,b)=>a.at-b.at);
  const details=new Map(),headers=events.filter(e=>e.type==='shelter-check'),checks=[],coverage=[];
  for(const e of events.filter(e=>e.type==='shelter-check-detail')){
    if(!details.has(key(e)))details.set(key(e),[]);details.get(key(e)).push(e);
  }
  const headerCounts=counts(headers.map(key));
  for(const e of headers){
    let data=e.data,status='complete';
    try{
      assert.ok(data&&typeof data==='object'&&!data.truncated);
      if(data.diagnosticId)assert.equal(headerCounts[key(e)],1);
      if(Object.hasOwn(data,'detailParts')){
        assert.equal(typeof data.diagnosticId,'string');assert.ok(data.diagnosticId);
        assert.equal(data.detailEncoding,'json-chunks');assert.equal(data.detailEvent,'shelter-check-detail');
        assert.ok(integer(data.detailParts)&&data.detailParts>0&&data.detailParts<=256);
        const parts=details.get(key(e))??[];
        assert.equal(parts.length,data.detailParts);assert.equal(new Set(parts.map(p=>p.data.part)).size,data.detailParts);
        parts.sort((a,b)=>a.data.part-b.data.part);
        for(const [i,p] of parts.entries()){
          assert.equal(p.data.part,i);assert.equal(p.data.totalParts,data.detailParts);
          assert.equal(typeof p.data.json,'string');assert.ok(p.data.json.length<=6000);
        }
        const full=JSON.parse(parts.map(p=>p.data.json).join(''));
        assert.equal(full.diagnosticId,data.diagnosticId);
        for(const name of ['actions','confirmedActions','population','nextAt'])
          if(Object.hasOwn(data,name))assert.deepEqual(full[name],data[name]);
        data=full;
      }
      assert.ok(!data.truncated);
    }catch{status='incomplete-or-invalid';}
    coverage.push({at:e.at,pageId:e.pageId,diagnosticId:e.data?.diagnosticId??null,status});
    if(status==='complete')checks.push({at:e.at,pageId:e.pageId,data});
  }
  const visits=checks.filter(e=>integer(e.data.visit?.elapsedMs));
  const assignments=events.filter(e=>e.type==='shelter-confirmed'&&e.data?.kind==='assign'&&
    Array.isArray(e.data.targets)&&Number.isSafeInteger(e.data.targets[0])&&e.data.targets[0]>0&&
    (e.data.targets[1]===null||Number.isSafeInteger(e.data.targets[1])&&e.data.targets[1]>0));
  const trajectories=new Map(),returns=[];
  for(const e of assignments){
    const [residentId,to]=e.data.targets,k=JSON.stringify([e.pageId,residentId]),a=trajectories.get(k)??[];
    a.push({at:e.at,to});trajectories.set(k,a);
    if(a.length>=3){
      const [x,y,z]=a.slice(-3);
      if(x.to!==null&&x.to===z.to&&x.to!==y.to&&x.at<y.at&&y.at<z.at&&z.at-x.at<=10*60000)
        returns.push({pageId:e.pageId,residentId,from:x.to,via:y.to,to:z.to,fromAt:x.at,toAt:z.at,spanMs:z.at-x.at,
          userInteractionObserved:events.some(p=>p.pageId===e.pageId&&p.type==='shelter-user-interaction'&&p.at>=x.at&&p.at<=z.at)});
    }
  }
  const planning=events.filter(e=>['shelter-planning','shelter-family-planning'].includes(e.type));
  const timingKnown=e=>integer(e.data?.requestedAt)&&integer(e.data?.finishedAt)&&e.data.finishedAt>=e.data.requestedAt&&
    e.data.finishedAt<=e.at&&['queue-to-result-wall-clock','request-to-result-wall-clock'].includes(e.data.timingScope);
  const timers=planning.filter(timingKnown);
  const construction=checks.filter(e=>e.data.developmentNext?.status);
  const decisions=events.filter(e=>e.type==='shelter-decision');
  return {kind:'runtime-observation-audit',eventVersion:version,exportedVersion:log.version??null,
    coverage:{events:span(events),checks:span(checks),decisions:span(decisions),duplicatesRemoved,invalidEvents,
      checkStates:counts(coverage.map(c=>c.status)),checkDetails:coverage},
    visits:{...stats(visits.map(e=>e.data.visit.elapsedMs)),withoutDuration:checks.length-visits.length,
      zeroConfirmedChecks:checks.filter(e=>e.data.confirmedActions===0).length,
      meaning:'Duration of observed visits includes valid work, UI waits, requests and planning; zero actions is not proof of waste.'},
    construction:{states:counts(construction.map(e=>e.data.developmentNext.status)),
      observedReasons:counts(construction.map(e=>String(e.data.developmentNext.reason??'unknown'))),
      withoutStatus:checks.length-construction.length,readyButUnstartedMs:null},
    assignments:{confirmed:assignments.length,withinPageReturnsIn10m:returns,
      meaning:'Three confirmed destinations A-B-A on one page; overlapping patterns are retained, not attributed to unnecessary moves or lost production.'},
    planning:{events:planning.length,states:counts(planning.map(e=>e.type+':'+(e.data?.status??'unknown'))),
      wallClock:stats(timers.map(e=>e.data.finishedAt-e.data.requestedAt)),withoutValidTiming:planning.length-timers.length,
      meaning:'Completed/failed/timed-out jobs only; includes queue/browser delay, excludes cancelled jobs, and is not CPU time.'},
    unknown:{eligibleExplorationIdleMs:null,constructionAvoidableWaitMs:null,lostProduction:null},
    limitations:['Only complete, matching version/page check fragments are used. Missing records are not filled.',
      'Checks describe observations, not continuous intervals; settings, defence and manual activity may justify waits.',
      'Confirmed assignment target IDs do not establish persistent account identity across pages; returns are page-local.',
      'Retained A-B-A observations may omit intervening actions; they are review candidates, not proven unnecessary moves.',
      'A ready construction candidate alone does not prove submission eligibility or an avoidable delay.',
      'No eligibility timeline or counterfactual resource model is inferred; this report cannot rank total development loss.']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [, ,input,output,version]=process.argv;
  assert.ok(input&&output&&version,'Usage: node arkengine-runtime-audit.mjs log.json report.json eventVersion');
  const raw=readFileSync(input),report=auditRuntime(JSON.parse(raw),version);
  report.input={path:input,sha256:createHash('sha256').update(raw).digest('hex')};
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({version,events:report.coverage.events,checks:report.coverage.checks,
    checkStates:report.coverage.checkStates,visits:report.visits,constructionStates:report.construction.states,
    assignments:report.assignments.confirmed,returnPatterns:report.assignments.withinPageReturnsIn10m.length,
    planning:report.planning,unknown:report.unknown},null,2));
}
