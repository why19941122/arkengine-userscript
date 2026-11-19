import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createShelterSelectionDigest} from './arkengine-shelter-selection-digest.mjs';
import {createShelterDevelopmentSelection} from './arkengine-shelter-development-selection.mjs';
import {createShelterDevelopmentCandidates} from './arkengine-shelter-development-candidates.mjs';
import {createShelterDevelopmentContinuation} from './arkengine-shelter-development-continuation.mjs';
import {createShelterRouteSimulation} from './arkengine-shelter-route-simulation.mjs';
import {createShelterPlanningClient} from './arkengine-shelter-planning-client.mjs';
import {createShelterNativePlanning} from './arkengine-shelter-native-planning.mjs';
import {shelterPlanningWorkerSource,shelterPlanningBrowserBundle} from './arkengine-shelter-planning-build.mjs';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

const start=2_000_000_000,hour=3600000,tick=600000,route=createShelterRouteSimulation(),selector=createShelterDevelopmentSelection();
const assumptions={eventTiming:'tick-end',trainingOverflow:'reset',merge:'left-neighbor',source:'explicit conditional test'};
const construction={build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100};
const goal={id:'test-scrap',kind:'stock',resource:'scrap',amount:4000,source:'explicit fixture target'};
const execution={receipts:'immediate-simulated',collection:'each-tick',source:'conditional test only'};
const options={goal,execution,maxChecks:16,checksPerNode:16,maxExpansions:16};
function scene(){const v=campaignView(start);v.state.rooms.find(r=>r.id===6).width=3;
  for(const p of v.state.residents){p.training=0;if(p.id!==5)p.hp=50;}return v;}
function node(v=scene()){return route.create(v,{assumptions,windowEnd:start+168*hour,safety:{scrap:200},construction,constructionLedger:[]});}
function context(){return {enabled:true,pending:null,window:{start,end:start+168*hour},
  schedule:{vaultNo:77,constructionLedger:[],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},
  construction,safety:{scrap:200},settings:['production'],readAt:start,readStartedAt:start-100};}
function fake(){const workers=[];return {workers,makeWorker(){const w={terminated:false,terminate(){this.terminated=true;},postMessage(data){this.data=data;}};
  workers.push(w);return w;}};}
function nativeFactory(source){return ()=>{
  const worker=new Worker("const {parentPort}=require('node:worker_threads');const self={postMessage:data=>parentPort.postMessage(data)};"+
    "parentPort.on('message',data=>self.onmessage({data}));\n"+source,{eval:true});
  const adapter={postMessage:data=>worker.postMessage(data),terminate:()=>worker.terminate(),onmessage:null,onerror:null};
  worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',e=>adapter.onerror?.(e));return adapter;
};}
async function finished(client,key){for(let n=0;n<600;n++){const result=client.read(key);if(result?.status!=='running')return result;await delay(10);}throw Error('Test worker deadline');}

test('planning: browser SHA-256 matches Node for UTF-8, block boundaries and full native snapshots',()=>{
  const digest=createShelterSelectionDigest();
  for(const value of [null,true,{},scene(),'居民💧汽水',...Array.from({length:140},(_,i)=>'x'.repeat(i)),{long:'训练\ud800'.repeat(12000)}])
    assert.equal(digest(value),createHash('sha256').update(JSON.stringify(value)).digest('hex'));
});

test('planning: mid-window selection keeps the original deadline and collected inventory history',()=>{
  const original=node(),advanced=route.advance(original,start+2*tick,{collect:true}).node,before=JSON.stringify(advanced);
  const result=selector.select(advanced,{...options,maxChecks:1,checksPerNode:1,maxExpansions:1});
  assert.equal(JSON.stringify(advanced),before);assert.equal(result.body.windowStart,start);assert.equal(result.body.windowEnd,start+168*hour);
  assert.equal(result.body.from,start+2*tick);
  const report=result.body.comparisons[0].routes[0].report;
  assert.deepEqual(report.ending.accounting.initial,original.accounting.initial);
  assert.ok(report.ending.accounting.collected.scrap>=advanced.accounting.collected.scrap);
  assert.equal(result.body.selected?.firstAction??null,null);
  assert.throws(()=>selector.select({...advanced,view:{...advanced.view,serverTime:start+168*hour}},options),/original fixed/);
});

test('planning: active training can replan without losing its original return deadline or replaying earlier actions',()=>{
  const v=scene();v.state.rooms.push({...v.state.rooms[0],id:40,type:'training',trainStat:'end',floor:4,col:2,level:3});
  Object.assign(v.state.residents.find(p=>p.id===5),{roomId:40,training:.99});
  const n=node(v),c=createShelterDevelopmentCandidates(),continuation=createShelterDevelopmentContinuation();
  const admitted=continuation.start(n,c.enumerate(n,{goal}),'train:5:40:4',{execution});assert.equal(admitted.accepted,true);
  const state=continuation.advance(admitted.state,start+tick).state,before=JSON.stringify(state);
  const result=selector.continueSelection(state,{...options,maxChecks:1,checksPerNode:1,maxExpansions:1});
  assert.equal(JSON.stringify(state),before);assert.equal(result.body.windowEnd,state.origin.windowEnd);
  for(const row of result.body.comparisons.flatMap(x=>x.routes)){
    assert.equal(row.report.from,start);assert.deepEqual(row.report.actions.slice(0,state.history.length),state.history);
    assert.equal(row.report.actions.filter(x=>x.action.kind==='assign'&&x.action.roomId===4).length,1);
  }
  assert.equal(result.body.selected?.firstAction??null,null);
  assert.throws(()=>selector.continueSelection(state,{...options,goal:{...goal,amount:1}}),/preserve/);
});

test('planning: unsettled native reads allow only checked current assignments and preserve original payments',()=>{
  const view=scene();view.serverTime+=1234;const ctx=context();
  ctx.schedule.constructionLedger=[{id:'old-payment',at:start-1000,scrap:80,parts:0}];
  const input={firstActionOnly:true,windowStart:start,windowEnd:start+168*hour,construction,safety:ctx.safety,
    runtime:{schedule:ctx.schedule,pending:null,source:'observed test input',
      clock:{localAt:start,serverAt:view.serverTime,uncertaintyMs:100,source:'bounded read'}}};
  const n=route.fromRuntime(view,input).node,result=selector.selectLocal(n,options);
  assert.equal(n.view.state.lastSettledAt,start);assert.equal(n.view.serverTime,start+1234);
  assert.equal(n.book.startedAt,start);assert.equal(n.spent[0].id,'old-payment');assert.equal(n.spent[0].cost.scrap,80);
  assert.equal(result.body.outcome,'independent-local-improvement');assert.equal(result.body.selected.firstCandidate.id,'assign:5:4');
  assert.equal(selector.prepareSelected(n,result).accepted,true);
  const prepared=selector.prepareSelected(n,result);
  assert.equal(route.submit(prepared.node,result.body.selected.firstCandidate.id,prepared.action,'not-native').accepted,false);
  assert.throws(()=>route.advance(n,view.serverTime+tick),/cannot be advanced/);
  const pending={id:'unknown-native',kind:'assign',vaultNo:77,at:start,targets:[5,4]};
  const blocked=route.fromRuntime(view,{...input,runtime:{...input.runtime,pending}}).node;
  assert.equal(selector.selectLocal(blocked,options).body.selected,null);
  assert.deepEqual(blocked.existing.native.map(x=>x.id),['unknown-native']);
});

test('planning: generated Worker runs the same complete selector while the caller heartbeat keeps running',async()=>{
  const n=node(),o={...options,maxChecks:2,checksPerNode:2,maxExpansions:2},expected=selector.select(n,o);
  const source=shelterPlanningWorkerSource(),client=createShelterPlanningClient({source,makeWorker:nativeFactory(source),timeoutMs:20000});
  let beats=0;const timer=setInterval(()=>beats++,5);
  try{
    client.request('snapshot',{node:n,options:o});const status=await finished(client,'snapshot');
    assert.equal(status.status,'ready',status.error);assert.deepEqual(status.result,expected);assert.ok(beats>=2,'main event loop remains responsive');
  }finally{clearInterval(timer);client.invalidate();}
});

test('planning: native current-action snapshot with training rooms does not require future simulation assumptions',()=>{
  const view=scene(),ctx=context();view.serverTime+=1234;
  view.state.rooms.push({...view.state.rooms[0],id:40,type:'training',trainStat:'end',floor:4,col:2});
  const n=route.fromRuntime(view,{firstActionOnly:true,windowStart:start,windowEnd:ctx.window.end,construction,safety:ctx.safety,
    runtime:{schedule:ctx.schedule,pending:null,source:'native current-action regression'}}).node;
  assert.equal(n.assumptions,undefined);
  const result=selector.selectLocal(n,options);
  assert.equal(result.body.outcome,'independent-local-improvement');
  assert.equal(result.body.selected.firstCandidate.id,'assign:5:4');
  assert.equal(selector.prepareSelected(n,result).accepted,true);
});

test('planning: replacing a snapshot terminates its worker and ignores late replies and wrong job IDs',()=>{
  const f=fake(),client=createShelterPlanningClient({source:'fixture',makeWorker:f.makeWorker});
  try{
    client.request('a',{});const old=f.workers[0];client.request('b',{});assert.equal(old.terminated,true);
    old.onmessage({data:{id:old.data.id,error:'late'}});assert.equal(client.read('b').status,'running');
    f.workers[1].onmessage({data:{id:old.data.id,error:'wrong'}});assert.equal(client.read('b').status,'running');
    assert.equal(client.request('b',{}).id,client.read('b').id);assert.equal(f.workers.length,2);
  }finally{client.invalidate();}
});

test('planning: worker timeout/error never invokes a main-thread planning fallback or repeats the same failed job',async()=>{
  const f=fake(),client=createShelterPlanningClient({source:'fixture',makeWorker:f.makeWorker,timeoutMs:10});
  client.request('timeout',{});await delay(30);assert.equal(client.read('timeout').status,'timeout');assert.equal(f.workers[0].terminated,true);
  client.request('timeout',{});assert.equal(f.workers.length,1);client.invalidate();
  const blocked=createShelterPlanningClient({source:'fixture',makeWorker(){throw Error('CSP blocked worker');}});
  assert.equal(blocked.request('csp',{}).status,'failed');blocked.invalidate();
});

test('planning: actual worker proposal requires fresh native admission and stops for pending, settings or account changes',async()=>{
  const source=shelterPlanningWorkerSource(),client=createShelterPlanningClient({source,makeWorker:nativeFactory(source)});
  let now=start;const adapter=createShelterNativePlanning({client,now:()=>now}),view=scene(),ctx=context();view.serverTime+=1234;
  const allowed=[{id:5,room:4,from:null,name:'native resident',gain:10,reason:'fresh allowed choice'}];
  try{
    const first=adapter.update(view,ctx),ready=await finished(client,first.key);assert.equal(ready.status,'ready',ready.error);
    assert.equal(adapter.choose(view,ctx,[]),null);assert.equal(adapter.choose(view,ctx,allowed)?.id,5);
    assert.equal(adapter.choose(view,ctx,[{...allowed[0],from:2}]),null);
    now+=60001;assert.equal(adapter.choose(view,ctx,allowed),null);now=start;
    assert.equal(adapter.choose(view,{...ctx,pending:{id:'original'}},allowed),null);assert.equal(client.read(first.key),null);
    const next=adapter.update(view,ctx);await finished(client,next.key);
    assert.equal(adapter.choose(view,{...ctx,settings:['off']},allowed),null);
    const other=structuredClone(view);other.vaultNo=88;assert.equal(adapter.choose(other,ctx,allowed),null);
  }finally{adapter.invalidate();}
});

test('planning: native adapter cannot submit a future move when selection starts with wait',()=>{
  const view=scene(),ctx=context();let current;
  const client={invalidate(){current=null;},request(key){return current??{id:1,key,status:'running'};}};
  const adapter=createShelterNativePlanning({client,now:()=>start});adapter.update(view,ctx);
  const action={kind:'assign',residentId:5,fromRoomId:null,roomId:4};
  current={id:1,status:'ready',prepared:{accepted:true,action},result:{body:{outcome:'independent-local-improvement',
    windowStart:start,windowEnd:ctx.window.end,selected:{firstCandidate:{kind:'wait'},firstAction:{action}}}}};
  assert.equal(adapter.choose(view,ctx,[{id:5,room:4,from:null}]),null);
});

test('planning: native adapter retains current proposals across revision and property order, but rechecks admission',async()=>{
  const source=shelterPlanningWorkerSource(),client=createShelterPlanningClient({source,makeWorker:nativeFactory(source)});
  const adapter=createShelterNativePlanning({client,now:()=>start}),view=scene(),ctx=context();view.revision=1;
  const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?
    Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
  try{
    const first=adapter.update(view,ctx);assert.equal((await finished(client,first.key)).status,'ready');
    const fresh=reorder(view);fresh.revision++;fresh.serverTime++;
    assert.equal(adapter.update(fresh,reorder(ctx)).id,first.id);
    assert.equal(adapter.status().status,'ready');
    assert.equal(adapter.choose(fresh,ctx,[]) ,null,'cached search never grants native permission');
    assert.equal(adapter.choose(fresh,ctx,[{id:5,room:4,from:null}])?.id,5);
    fresh.state.resources.scrap--;
    assert.notEqual(adapter.update(fresh,ctx).id,first.id);
  }finally{adapter.invalidate();}
});

test('planning: userscript embeds exactly the tested local Worker and keeps proposal execution in the native staff path',()=>{
  const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
  assert.ok(source.includes(shelterPlanningBrowserBundle()));
  const embedded=source.slice(source.indexOf('  const shelterPlanningWorkerSource='),source.indexOf('  const createShelterPlanningClient='));
  const result=runInNewContext(`let joined=0;const join=Array.prototype.join;
    Array.prototype.join=function(...args){joined+=this.length;return join.apply(this,args);};
    ${embedded}\n({worker:shelterPlanningWorkerSource(),joined});`);
  assert.equal(result.worker,shelterPlanningWorkerSource());
  assert.equal(result.joined,0,'first worker use should not assemble an array of source lines');
  assert.ok(source.includes('shelterBackgroundAssignment(m,scrapChoices)'));
  assert.ok(source.includes('shelterStartBackgroundPlanning(model)'));
  assert.ok(source.includes('developmentProposal:choice.developmentProposal'));
});

test('planning: passive accumulation retains a finished proposal and still requires current admission',()=>{
  const f=fake(),client=createShelterPlanningClient({source:'fixture',makeWorker:f.makeWorker});
  const adapter=createShelterNativePlanning({client,now:()=>start}),view=scene(),ctx=context();
  try{
    const first=adapter.update(view,ctx),action={kind:'assign',residentId:5,fromRoomId:null,roomId:4};
    f.workers[0].onmessage({data:{id:first.id,prepared:{accepted:true,action},result:{body:{kind:'bounded-development-selection',
      outcome:'independent-local-improvement',windowStart:start,windowEnd:ctx.window.end,
      selected:{firstCandidate:{kind:'assign'},firstAction:{action}}}}}});
    view.state.rooms[0].stored+=.01;view.state.resources.scrap+=1;view.serverTime+=1000;
    assert.equal(adapter.update(view,ctx).id,first.id);assert.equal(adapter.status().status,'ready');
    assert.equal(f.workers.length,1);assert.equal(adapter.choose(view,ctx,[]),null);
    assert.equal(adapter.choose(view,ctx,[{id:5,room:4,from:null}])?.id,5);
    view.state.rooms[0].stored-=.001;
    assert.notEqual(adapter.update(view,ctx).id,first.id,'regression is checked against the latest read, not only the first snapshot');
  }finally{adapter.invalidate();}
});
test('planning: passive reads retain in-flight work; business boundaries and unknown facts invalidate it',()=>{
  for(const change of ['adult','cooldown','event','upgrade','stock-loss','person','unknown']){
    const f=fake(),client=createShelterPlanningClient({source:'fixture',makeWorker:f.makeWorker});
    const adapter=createShelterNativePlanning({client,now:()=>start}),view=scene(),ctx=context();
    if(change==='adult')view.state.residents[5].adultAt=start+1000;
    if(change==='cooldown')view.state.residents[5].familyCooldownUntil=start+1000;
    if(change==='event')view.env.events=[{startsAt:start+1000,endsAt:start+hour}];
    if(change==='upgrade')view.state.rooms[0].upgradeAt=start+1000;
    try{
      const first=adapter.update(view,ctx);view.state.rooms[0].stored+=.01;view.serverTime+=500;
      assert.equal(adapter.update(view,ctx).id,first.id,change);
      if(change==='stock-loss')view.state.resources.food--;
      else if(change==='person')view.state.residents[0].stats.str++;
      else if(change==='unknown')view.state.futureField=true;
      else view.serverTime+=500;
      assert.notEqual(adapter.update(view,ctx).id,first.id,change);assert.equal(f.workers[0].terminated,true);
    }finally{adapter.invalidate();}
  }
});
test('planning: unchanged proposal is refreshed after its bounded lifetime instead of remaining unusable forever',()=>{
  const f=fake(),client=createShelterPlanningClient({source:'fixture',makeWorker:f.makeWorker});let now=start;
  const adapter=createShelterNativePlanning({client,now:()=>now}),view=scene(),ctx=context();
  try{
    const first=adapter.update(view,ctx);now+=60001;
    assert.notEqual(adapter.update(view,ctx).id,first.id);assert.equal(f.workers.length,2);
  }finally{adapter.invalidate();}
});
