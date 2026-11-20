import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createShelterExistingState} from './arkengine-shelter-existing-state.mjs';
import {createShelterRouteSimulation} from './arkengine-shelter-route-simulation.mjs';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
const existing=createShelterExistingState(),routes=createShelterRouteSimulation();
const start=2_000_000_000,tick=600000,hour=3600000;
const assumptions={eventTiming:'tick-end',trainingOverflow:'reset',merge:'left-neighbor',source:'explicit import fixture'};
const familyRules={romance:'base-charm-sum-per-120-per-tick',pregnancyMs:3*hour,childhoodMs:3*hour,cooldownMs:6*hour,source:'conditional public rules'};
function scene(){const v=campaignView(start);for(const p of v.state.residents)p.training=0;return v;}
const schedule=extra=>({vaultNo:77,nextAt:0,note:'source snapshot',constructionLedger:[],
  campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[],defense:[],defenseManual:[]},...extra});
const runtime=(s=schedule(),extra={})=>({schedule:s,pending:null,source:'explicit native-shaped fixture',...extra});
const options=(r,extra={})=>({runtime:r,assumptions,familyRules,safety:{scrap:200},windowEnd:start+168*hour,
  construction:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100},...extra});
const load=(v,s=schedule(),extra={})=>routes.fromRuntime(v,options(runtime(s,extra)));
const training=(s,v,{until=start+2*tick}={})=>{
  v.state.rooms.push({...v.state.rooms[0],id:7,type:'training',floor:2,col:4,trainStat:'end'});
  const p=v.state.residents.find(p=>p.id===5);p.roomId=7;p.training=.99;
  s.campaign.roles.push({id:5,room:7,role:'training',at:start-tick,stat:'end',base:8,purpose:'production',
    until,windowEnd:start+168*hour,destination:4});return p;
};
const reservation=(n,id,person,room)=>({id,purpose:'test independent use',
  people:[{residentId:person,from:n.view.serverTime,until:n.book.windowEnd}],
  seats:[{residentId:person,roomId:room,from:n.view.serverTime,until:n.book.windowEnd}]});
const confirm=(n,result='confirmed')=>routes.resolve(n,{requestId:n.pending.requestId,intentId:n.pending.intentId,
  fingerprint:n.pending.fingerprint,at:n.view.serverTime,result}).node;

test('existing state: same-vault ownership, explicit pending knowledge and source are mandatory',()=>{
  const v=scene(),r=runtime();
  for(const bad of [{...r,schedule:{...r.schedule,vaultNo:88}}, {...r,pending:undefined},{...r,source:''}])
    assert.throws(()=>routes.fromRuntime(v,options(bad)),/required|Invalid/);
  const missing=runtime();delete missing.pending;
  assert.throws(()=>routes.fromRuntime(v,options(missing)),/required/);
  assert.throws(()=>routes.fromRuntime(v,{...options(r),constructionLedger:[]}),/own native/);
});
test('existing state: all recorded duty kinds retain source, while stale roles and historical posts are not permanent manual locks',()=>{
  const v=scene(),s=schedule();
  for(const [i,role,type] of [[5,'medical','medbay'],[6,'workshop','workshop']]){
    const roomId=70+i;v.state.rooms.push({...v.state.rooms[0],id:roomId,type,floor:3,col:i-2});
    v.state.residents.find(p=>p.id===i).roomId=roomId;s.campaign.roles.push({id:i,room:roomId,role,at:start-tick});
  }
  s.campaign.roles.push({id:4,room:999,role:'radio',at:start-tick});
  const p=structuredClone(v.state.residents[0]);Object.assign(p,{id:9,name:'历史训练者',roomId:90,training:.2});
  v.state.residents.push(p);v.state.rooms.push({...v.state.rooms[0],id:90,type:'training',trainStat:'str',floor:4,col:3});
  const before=JSON.stringify([v,s]),{node,blocked}=load(v,s);assert.deepEqual(blocked,[]);
  assert.equal(node.existing.roles.find(r=>r.residentId===4).status,'stale');
  const history=node.existing.roles.find(r=>r.residentId===9);assert.equal(history.status,'historical');assert.equal(history.intentId,null);
  assert.equal(node.book.entries.length,2);assert.equal(JSON.stringify([v,s]),before);
});
test('existing state: temporary daily craft duty survives the worker snapshot import without losing its seat',()=>{
  const v=scene(),s=schedule();v.state.rooms.push({...v.state.rooms[0],id:90,type:'tailor',floor:3,col:2});
  v.state.residents[4].roomId=90;s.campaign.roles=[{id:5,room:90,role:'craftDaily',at:start-tick}];
  const {node,blocked}=load(v,s);assert.deepEqual(blocked,[]);
  const role=node.existing.roles.find(r=>r.residentId===5);assert.equal(role.record.role,'craftDaily');
  assert.equal(role.intentId,'existing:role:5');assert.equal(node.book.entries.length,1);
});
test('existing state: an imported trainee completes the real remaining fraction and returns without a new training entry or renewed deadline',()=>{
  const v=scene(),s=schedule();training(s,v);let {node:n,blocked}=load(v,s);assert.deepEqual(blocked,[]);
  const originalUntil=s.campaign.roles[0].until;
  const first=routes.advance(n,start+tick,{collect:true});assert.equal(first.complete,true,JSON.stringify(first.blocked));n=first.node;
  assert.equal(n.view.state.residents.find(p=>p.id===5).stats.end,9);
  const wait=routes.advance(JSON.parse(JSON.stringify(n)),start+2*tick);
  assert.equal(wait.complete,false);assert.ok(wait.blocked.some(b=>b.kind==='inherited-training-return-due'));
  const action={kind:'assign',residentId:5,fromRoomId:7,roomId:4};
  const submitted=routes.submit(n,'existing:role:5',action,'return-5');assert.equal(submitted.accepted,true,JSON.stringify(submitted.blocked));
  n=confirm(submitted.node);assert.equal(n.view.state.residents.find(p=>p.id===5).roomId,4);
  assert.equal(n.existing.roles[0].record.until,originalUntil);assert.equal(n.book.startedAt,start);
  assert.equal(n.book.entries[0].status,'complete');assert.equal(n.existing.roles[0].status,'completed');
  assert.equal(routes.advance(n,start+3*tick,{collect:true}).complete,true);
  console.log(JSON.stringify({kind:'existing-training-return',start,completedAt:first.node.view.serverTime,returnedAt:n.view.serverTime,
    until:originalUntil,stat:9,room:4,originalTrainingAt:s.campaign.roles[0].at,source:'conditional import fixture; not actual account'}));
});
test('existing state: two imports cannot claim the last return seat or borrow the already committed trainee',()=>{
  const v=scene(),s=schedule();training(s,v);const {node:n}=load(v,s);
  const taken=routes.reserve(n,reservation(n,'other',6,4));assert.equal(taken.accepted,false);
  assert.ok(taken.blocked.some(b=>b.kind==='seat-capacity'));
  const borrowed=routes.reserve(n,reservation(n,'family-helper',5,2));assert.equal(borrowed.accepted,false);
  assert.ok(borrowed.blocked.some(b=>b.kind==='resident-conflict'));
});
test('existing state: finish-current marker and fixed deadline survive import; malformed or unbounded promises are rejected',()=>{
  const v=scene(),s=schedule();training(s,v);s.campaign.roles[0].finishCurrent=true;
  const {node,blocked}=load(v,s);assert.deepEqual(blocked,[]);
  const record=JSON.parse(JSON.stringify(node)).existing.roles[0].record;
  assert.equal(record.finishCurrent,true);assert.equal(record.until,s.campaign.roles[0].until);
  for(const bad of [false,'true',{}]){
    const broken=structuredClone(s);broken.campaign.roles[0].finishCurrent=bad;
    assert.throws(()=>load(v,broken),/Invalid inherited role/);
  }
  const unbounded=structuredClone(s);unbounded.campaign.roles[0].until=start+3*hour;
  assert.throws(()=>load(v,unbounded),/Invalid inherited role/);
});
test('existing state: current-cell protection imports only its actual training seat and keeps the fixed deadline',()=>{
  const v=scene(),s=schedule();training(s,v);
  const role=s.campaign.roles[0];role.purpose='current';role.finishCurrent=true;
  delete role.destination;delete role.windowEnd;
  const {node,blocked}=load(v,s);assert.deepEqual(blocked,[]);
  assert.equal(node.existing.roles[0].destination,null);assert.equal(node.existing.roles[0].record.until,role.until);
  assert.ok(node.book.entries.every(entry=>entry.seats.every(seat=>seat.roomId===7)));
  const broken=structuredClone(s);delete broken.campaign.roles[0].finishCurrent;
  assert.throws(()=>load(v,broken),/Invalid inherited role/);
});

test('existing state: training upgrade wait survives import without extending the remaining cell budget',()=>{
  const view=scene(),saved=schedule();training(saved,view);
  const role=saved.campaign.roles[0];
  Object.assign(role,{finishCurrent:true,upgradeUntil:start+3*hour,until:start+4*hour});
  view.state.rooms.find(room=>room.id===7).upgradeAt=role.upgradeUntil;
  const {node,blocked}=load(view,saved);assert.deepEqual(blocked,[]);
  assert.equal(node.existing.roles[0].record.upgradeUntil,role.upgradeUntil);
  assert.equal(node.existing.roles[0].record.until,role.until);
  for(const change of [{upgradeUntil:role.at},{upgradeUntil:role.until},{upgradeUntil:'later'},
    {until:role.upgradeUntil+131*60000}]){
    const broken=structuredClone(saved);Object.assign(broken.campaign.roles[0],change);
    assert.throws(()=>load(view,broken),/Invalid inherited role/);
  }
});

test('existing state: manually started full cell keeps its finite deadline and rejects unrelated or unbounded markers',()=>{
  const view=scene(),saved=schedule();training(saved,view);
  const role=saved.campaign.roles[0];
  Object.assign(role,{purpose:'current',finishCurrent:true,existingTraining:true,until:start+6*hour});
  delete role.destination;delete role.windowEnd;
  const {node,blocked}=load(view,saved);assert.deepEqual(blocked,[]);
  assert.equal(node.existing.roles[0].record.existingTraining,true);assert.equal(node.existing.roles[0].record.until,role.until);
  for(const change of [{existingTraining:'true'},{existingTraining:false},{purpose:'parent'},
    {until:role.at+11*hour},{finishCurrent:undefined}]){
    const broken=structuredClone(saved);Object.assign(broken.campaign.roles[0],change);
    assert.throws(()=>load(view,broken),/Invalid inherited role/);
  }
});

test('existing state: conflicts already present in native roles remain visible instead of dropping a commitment',()=>{
  const v=scene(),s=schedule();training(s,v);
  const p=v.state.residents.find(p=>p.id===6);p.roomId=7;p.training=.2;
  s.campaign.roles.push({...s.campaign.roles[0],id:6});
  const result=load(v,s);assert.equal(result.node.book.entries.length,2);
  assert.ok(result.blocked.some(b=>b.kind==='seat-capacity'));
});
test('existing state: native operation kinds and nested emergency records stay unresolved without copying request keys',()=>{
  for(const kind of ['collect','tutorial','daily','season','achievement','assign','equip','explore','build','upgrade','dig',
    'explore-start','explore-recall','quest-start','quest-claim','stimpak','craft']){
    const v=scene(),pending={id:'native-'+kind,kind,vaultNo:77,at:start,targets:[1],campaignKey:'do-not-copy',
      before:{serverTime:start},result:{responseFinishedAt:start+1,campaignProof:{key:'do-not-copy'}}};
    const {node:n}=load(v,schedule(),{pending});
    const moved=routes.reserve(n,reservation(n,'new',5,4));assert.equal(moved.accepted,false,kind);
    assert.equal(moved.blocked[0].kind,'inherited-native-pending');
    assert.equal(routes.advance(n,start+tick).node,n);assert.ok(!JSON.stringify(n.existing).includes('do-not-copy'));
    assert.throws(()=>routes.resolve(n,{requestId:pending.id,result:'confirmed'}),/No matching/);
  }
  const pending={id:'parent',kind:'collect',vaultNo:77,at:start,targets:['all'],
    emergency:{id:'defense',blockedBy:'parent',kind:'assign',vaultNo:77,at:start,targets:[5,90]}};
  const {node:n}=load(scene(),schedule(),{pending});assert.equal(n.existing.native.length,2);
  assert.equal(routes.advance(n,start+tick).blocked.length,2);
  pending.emergency.blockedBy='wrong';assert.throws(()=>load(scene(),schedule(),{pending}),/Invalid inherited/);
});
test('existing state: unknown construction result records a cost bound without deducting current inventory again',()=>{
  const v=scene(),s=schedule();training(s,v);const pending={id:'build-old',kind:'build',vaultNo:77,at:start,targets:['scrap',2,4],
    before:{serverTime:start,construction:{project:{cost:{scrap:96,parts:0}}}}};
  const {node:n}=load(v,s,{pending});assert.equal(n.view.state.resources.scrap,v.state.resources.scrap);
  assert.equal(n.accounting.paid.scrap,0);assert.deepEqual(n.existing.native[0].costBound,{scrap:96,parts:0});
  assert.throws(()=>routes.release(n,'existing:role:5',{reason:'ignore old request'}),/outside the simulator/);
  assert.equal(routes.amend(n,'existing:role:5',{people:[]}).accepted,false);
});
test('existing state: prior local-clock spending uses explicit latest possible server time and keeps rolling budget occupied',()=>{
  const v=scene(),s=schedule({constructionLedger:[{id:'paid',at:100000,scrap:9950,parts:0}]});
  assert.throws(()=>load(v,s),/clock bounds/);
  const clock={localAt:101000,serverAt:start,uncertaintyMs:500,source:'explicit paired-clock condition'};
  let {node:n}=load(v,s,{clock});assert.equal(n.spent[0].at,start-500);assert.equal(n.accounting.paid.scrap,0);
  assert.deepEqual(n.existing.paymentBounds[0],{id:'paid',localAt:100000,earliest:start-1500,latest:start-500,source:clock.source});
  n=routes.reserve(n,{id:'build',purpose:'next room',resources:{scrap:96}}).node;
  const action={kind:'build',roomId:50,type:'scrap',floor:2,col:4,finishAt:start+tick,source:'fixture time'};
  const result=routes.submit(n,'build',action,'new-build');assert.equal(result.accepted,false);
  assert.ok(result.blocked.some(b=>b.kind==='rolling-construction-limit'));
});
test('existing state: absent prior construction history blocks new spending, but an unrelated free assignment remains possible',()=>{
  const v=scene(),s=schedule();delete s.constructionLedger;let {node:n}=load(v,s);
  assert.equal(n.existing.constructionKnown,false);
  n=routes.reserve(n,reservation(n,'job',5,4)).node;
  assert.equal(routes.submit(n,'job',{kind:'assign',residentId:5,fromRoomId:null,roomId:4},'job-5').accepted,true);
  n=routes.reserve(n,{id:'build',purpose:'next room',resources:{scrap:96}}).node;
  assert.ok(routes.preview(n,'build',{kind:'build',roomId:50,type:'scrap',floor:2,col:4,finishAt:start+tick,source:'fixture'}).blocked
    .some(b=>b.kind==='prior-construction-spending-unknown'));
});
test('existing state: old family history alone does not reserve parents or duplicate population',()=>{
  const v=scene(),s=schedule({families:[{a:5,b:6,room:5}]});const {node:n}=load(v,s);
  assert.equal(n.book.entries.length,0);assert.equal(n.existing.families.length,0);assert.equal(routes.inspect(n).population,6);
});
test('existing state: a real romance and matching pending pair import once, bind explicit rules, and continue existing progress',()=>{
  const v=scene(),s=schedule({pair:{a:5,b:6,room:5,step:2}});
  for(const [id,partner] of [[5,6],[6,5]])Object.assign(v.state.residents.find(p=>p.id===id),{roomId:5,romance:{partnerId:partner,progress:.99}});
  let {node:n,blocked}=load(v,s);assert.deepEqual(blocked,[]);assert.equal(n.existing.families.length,1);assert.equal(routes.inspect(n).population,7);
  assert.ok(routes.advance(n,start+tick).blocked.some(b=>b.kind==='inherited-family-plan-needed'));
  assert.throws(()=>routes.release(n,'existing:family:5/6',{reason:'cancel romance'}),/retain/);
  const child={...structuredClone(v.state.residents[0]),id:7,name:'conditional child',parents:[5,6],roomId:5,
    training:0,romance:null,away:null,deadAt:null,outfitId:null,weaponId:null,xp:0,hp:100,adultAt:0};
  const bound=routes.bindExistingFamily(n,'existing:family:5/6',{key:'existing-family',parents:[5,6],roomId:5,stage:'romance',child,source:'explicit child template'});
  assert.equal(bound.accepted,true,JSON.stringify(bound.blocked));n=bound.node;
  const step=routes.advance(n,start+tick);assert.equal(step.complete,true,JSON.stringify(step.blocked));
  assert.equal(step.node.view.state.births.length,1);assert.equal(routes.inspect(step.node).population,7);
});
test('existing state: inconsistent romance cannot be silently restarted from zero',()=>{
  const v=scene();v.state.residents[4].romance={partnerId:6,progress:.4};
  assert.throws(()=>load(v),/Inconsistent inherited romance/);
});

test('existing state: separated romance retains current posts and progress without blocking unrelated employment',()=>{
  for(const otherRoom of [2,null]){
    const v=scene(),s=schedule({families:[{a:5,b:6,room:5}]});
    Object.assign(v.state.residents[4],{roomId:5,romance:{partnerId:6,progress:.4}});
    Object.assign(v.state.residents[5],{roomId:otherRoom,romance:{partnerId:5,progress:.4}});
    v.state.rooms.push({...v.state.rooms.find(r=>r.id===4),id:40,floor:3});
    const before=JSON.stringify(v);
    let {node:n,blocked}=load(v,s);assert.deepEqual(blocked,[]);
    const f=n.existing.families[0],entry=n.book.entries.find(e=>e.id===f.intentId);
    assert.equal(n.existing.families.length,1);assert.equal(f.status,'paused');
    assert.deepEqual(entry.seats.map(c=>[c.residentId,c.roomId]),otherRoom===null?[[5,5]]:[[5,5],[6,2]]);
    assert.equal(routes.inspect(n).population,7);assert.equal(JSON.stringify(v),before);
    assert.deepEqual(n.view.state.residents.slice(4).map(p=>p.romance.progress),[.4,.4]);
    assert.ok(routes.advance(n,start+tick).blocked.some(b=>b.kind==='inherited-romance-paused'));
    assert.throws(()=>routes.release(n,f.intentId,{reason:'ignore paused relation'}),/retain/);
    const borrowed=routes.reserve(n,reservation(n,'borrow',6,4));assert.equal(borrowed.accepted,false);
    const tampered=structuredClone(n);tampered.book.entries.find(e=>e.id===f.intentId).seats=[];
    assert.throws(()=>routes.inspect(tampered),/family lost its commitment/);
    // Production worker 4 may change jobs; neither partner is moved or re-paired.
    n=routes.reserve(n,reservation(n,'unrelated',4,40)).node;
    const checked=routes.preview(n,'unrelated',{kind:'assign',residentId:4,fromRoomId:4,roomId:40});
    assert.deepEqual(checked.blocked,[]);
    assert.deepEqual(routes.inspect(JSON.parse(JSON.stringify(n))).blocked,[]);
    v.state.residents[5].roomId=5;
    const reunited=load(v,s).node;
    assert.equal(reunited.existing.families[0].status,'needs-plan');
    assert.deepEqual(reunited.view.state.residents.slice(4).map(p=>p.romance.progress),[.4,.4]);
  }
});

test('existing state: separated romance still rejects nonreciprocal or invalid progress',()=>{
  for(const bad of [null,{partnerId:4,progress:.4},{partnerId:5},{partnerId:5,progress:NaN},{partnerId:5,progress:.5}]){
    const v=scene();Object.assign(v.state.residents[4],{roomId:5,romance:{partnerId:6,progress:.4}});
    Object.assign(v.state.residents[5],{roomId:2,romance:bad});
    assert.throws(()=>load(v),/Inconsistent inherited romance/);
  }
});
test('existing state: unknown birth ownership also protects linked parents outside the original dorm',()=>{
  const v=scene(),s=schedule({families:[{a:5,b:6,room:5}]});v.state.births=[{roomId:5,dueAt:start+hour}];
  let {node:n}=load(v,s);n=routes.reserve(n,reservation(n,'job',5,4)).node;
  assert.ok(routes.preview(n,'job',{kind:'assign',residentId:5,fromRoomId:null,roomId:4}).blocked.some(b=>b.kind==='inherited-birth-ownership-unknown'));
  assert.ok(routes.advance(n,start+tick).blocked.some(b=>b.kind==='inherited-birth-ownership-unknown'));
});
test('existing state: defense preemption retains a training return seat and manual takeover is not invented',()=>{
  const v=scene(),s=schedule();training(s,v);v.state.rooms.push({...v.state.rooms[0],id:90,type:'door',col:0});
  v.state.residents.find(p=>p.id===5).roomId=90;s.campaign.defense=[{id:5,room:90,from:7,at:start-tick}];
  const {node:n}=load(v,s);assert.equal(n.existing.roles[0].status,'preempted');assert.equal(n.existing.defense[0].intentId,'existing:role:5');
  assert.equal(n.book.entries.length,1);assert.equal(n.book.entries[0].seats[0].roomId,4);
});
test('existing state: an incomplete native swap is rejected and an unbound material purpose remains explicit',()=>{
  const v=scene(),s=schedule({swap:{people:[{id:5},{id:6}],step:1}});
  assert.throws(()=>load(v,s),/Invalid inherited swap/);
  delete s.swap;s.campaign.materials={vaultNo:77,id:4,type:'scrap',level:3,targetLevel:8,finalTarget:8};
  let {node:n}=load(v,s);assert.deepEqual(n.existing.materialPurpose,s.campaign.materials);
  n=routes.reserve(n,{id:'build',purpose:'next room',resources:{scrap:96}}).node;
  assert.ok(routes.preview(n,'build',{kind:'build',roomId:50,type:'scrap',floor:2,col:4,finishAt:start+tick,source:'fixture'}).blocked
    .some(b=>b.kind==='inherited-material-allocation-needed'));
});
test('existing state: completed-room merge updates imported target bindings while retaining original source fields',()=>{
  const v=scene(),s=schedule();training(s,v);const {node:n}=load(v,s);
  const remapped=existing.remap(n.existing,[{kind:'merge',roomId:4,into:14}]);
  assert.equal(remapped.roles[0].destination,14);assert.equal(remapped.roles[0].record.destination,4);
  assert.equal(n.existing.roles[0].destination,4);
});

test('existing state: a deadline inside the next settlement stops before the tick, with no extra training or production',()=>{
  const v=scene(),s=schedule();training(s,v,{until:start+tick/2});
  v.state.residents.find(p=>p.id===5).training=.1;
  const {node:n}=load(v,s),before=JSON.stringify(n),step=routes.advance(n,start+tick,{collect:true});
  assert.equal(step.complete,false);
  assert.ok(step.blocked.some(b=>b.kind==='inherited-training-deadline-boundary'&&b.until===start+tick/2));
  assert.equal(step.node.view.serverTime,start);assert.deepEqual(step.node.accounting,n.accounting);
  assert.equal(JSON.stringify(n),before);
});

test('existing state: JSON reload cannot drop an active imported role binding or its return reservation',()=>{
  const v=scene(),s=schedule();training(s,v);const {node:n}=load(v,s);
  for(const corrupt of [x=>x.existing.roles[0].intentId=null,x=>x.book.entries[0].people=[],x=>x.book.entries[0].seats=[]]){
    const copy=JSON.parse(JSON.stringify(n));corrupt(copy);
    assert.throws(()=>routes.advance(copy,start+tick),/Inherited|inherited/);
  }
  assert.throws(()=>routes.release(n,'existing:role:5',{reason:'forget trainee'}),/inherited|Inherited/);
  assert.equal(routes.amend(n,'existing:role:5',{people:[],seats:[]}).accepted,false);
});

test('existing state: romance cannot promise an existing or already scheduled child identity',()=>{
  const v=scene(),s=schedule();
  for(const [id,partner] of [[5,6],[6,5]])Object.assign(v.state.residents.find(p=>p.id===id),{roomId:5,romance:{partnerId:partner,progress:.5}});
  const child={...structuredClone(v.state.residents[0]),id:7,name:'conditional child',parents:[5,6],roomId:5,
    training:0,romance:null,away:null,deadAt:null,outfitId:null,weaponId:null,xp:0,hp:100,adultAt:0};
  const {node:n}=load(v,s),plan={key:'old-family',parents:[5,6],roomId:5,stage:'romance',child,source:'explicit fixture'};
  const reused=structuredClone(plan);reused.child.id=1;
  assert.equal(routes.bindExistingFamily(n,'existing:family:5/6',reused).accepted,false);
  n.outcomes.births.push({roomId:5,dueAt:start+hour,resident:child,source:'prior explicit child outcome'});
  assert.equal(routes.bindExistingFamily(n,'existing:family:5/6',plan).accepted,false);
});

function swappedScene(){
  const v=scene(),s=schedule({swap:{id:'old-swap',at:start-tick,kind:'allocation',
    people:[{id:5,room:3},{id:6,room:4}],targets:[{id:5,room:4},{id:6,room:3}],
    moves:[{id:5,room:null},{id:6,room:3},{id:5,room:4}],step:1,futureSupply:false,
    supplyFloor:{power:0,food:0,water:0}}});
  v.state.residents.find(p=>p.id===6).roomId=4;return {v,s};
}
test('existing state: a partially completed swap resumes only its next move and releases after its final confirmation',()=>{
  const {v,s}=swappedScene();let {node:n,blocked}=load(v,s);assert.deepEqual(blocked,[]);
  const original=JSON.stringify(s.swap),actions=[];
  for(let i=0;i<2;i++){
    const next=routes.nextExistingSwap(JSON.parse(JSON.stringify(n)));assert.deepEqual(next.blocked,[]);
    actions.push(next.action);const submitted=routes.submit(n,next.intentId,next.action,'remaining-'+i);
    assert.equal(submitted.accepted,true,JSON.stringify(submitted.blocked));n=confirm(submitted.node);
    if(i===0){const step=routes.advance(n,start+tick,{collect:true});assert.equal(step.complete,true,JSON.stringify(step.blocked));n=step.node;}
  }
  assert.deepEqual(actions.map(a=>[a.residentId,a.roomId]),[[6,3],[5,4]]);
  assert.equal(n.existing.swap.status,'complete');assert.equal(n.existing.swap.record.step,1);
  assert.equal(n.book.entries[0].status,'complete');assert.equal(n.book.receipts.length,2);
  assert.equal(routes.nextExistingSwap(n).action,null);assert.equal(JSON.stringify(s.swap),original);
  console.log(JSON.stringify({kind:'existing-swap-resume',actions,originalStep:1,finalStep:n.existing.swap.step,
    completedAt:n.view.serverTime,source:'conditional inherited allocation; not runtime account'}));
});

test('existing state: observed next swap move is not replayed, while unknown native result or changed positions stay protected',()=>{
  const {v,s}=swappedScene();v.state.residents.find(p=>p.id===6).roomId=3;
  const observed=load(v,s).node;assert.equal(observed.existing.swap.step,2);
  assert.equal(routes.nextExistingSwap(observed).action.residentId,5);
  const pending={id:'native',kind:'assign',vaultNo:77,at:start-tick,targets:[6,3]};
  const uncertain=load(v,s,{pending}).node;assert.equal(uncertain.existing.swap.step,1);
  assert.ok(routes.nextExistingSwap(uncertain).blocked.some(b=>b.kind==='inherited-native-pending'));
  v.state.residents.find(p=>p.id===5).roomId=2;
  const changed=load(v,s).node;assert.equal(changed.existing.swap.status,'changed');
  assert.equal(routes.nextExistingSwap(changed).action,null);
  const cancelled=routes.release(changed,'existing:swap',{reason:'positions changed; recompute from actual roster'});
  assert.equal(cancelled.existing.swap.status,'cancelled');assert.equal(cancelled.view.state.residents.find(p=>p.id===5).roomId,2);
});

test('existing state: inherited allocation floor and serialized person commitments remain enforced',()=>{
  const {v,s}=swappedScene();s.swap.supplyFloor.water=1000;
  const n=load(v,s).node;
  assert.ok(routes.nextExistingSwap(n).blocked.some(b=>b.kind==='inherited-swap-supply-floor'));
  const copy=JSON.parse(JSON.stringify(n));copy.book.entries[0].people=[];
  assert.throws(()=>routes.nextExistingSwap(copy),/Inherited swap/);
});

function materialScene({parts=14,stored=2.9,scrap=1000,automatic=true}={}){
  const v=scene(),s=schedule();Object.assign(v.state.resources,{parts,scrap});
  v.state.rooms.find(r=>r.id===4).level=2;
  v.state.rooms.push({...v.state.rooms[0],id:70,type:'workshop',floor:3,col:2,level:1,stored});
  v.state.residents.find(p=>p.id===5).roomId=70;
  if(automatic)s.campaign.roles.push({id:5,room:70,role:'workshop',at:start-tick});
  s.campaign.materials={vaultNo:77,id:4,type:'scrap',level:3,targetLevel:8,finalTarget:8};
  return {v,s};
}
const bindMaterials=n=>{
  const result=routes.bindExistingMaterials(n,{workers:[5],source:'explicit inherited workshop allocation'});
  assert.equal(result.accepted,true,JSON.stringify(result.blocked));assert.deepEqual(result.blocked,[]);return result.node;
};
test('existing state: material allocation collects a whole batch, stops feeding, pays the old project once and resumes production',()=>{
  const {v,s}=materialScene();let n=bindMaterials(load(v,s).node);
  assert.deepEqual(n.existing.material.cost,{scrap:480,parts:15});
  assert.equal(n.existing.material.status,'preparing');assert.equal(n.existing.material.allocated.parts,14);
  const originalPurpose=structuredClone(n.existing.materialRecord);
  const step=routes.advance(n,start+tick,{collect:true});assert.equal(step.complete,true,JSON.stringify(step.blocked));n=step.node;
  assert.equal(n.view.state.resources.parts,17);assert.equal(n.existing.material.status,'ready');
  assert.equal(n.existing.material.allocated.feedScrap,0);
  const paidFeed=n.accounting.feed.scrap;assert.ok(paidFeed>0&&paidFeed<1);
  const waiting=routes.advance(JSON.parse(JSON.stringify(n)),start+2*tick,{collect:true});
  assert.equal(waiting.complete,true,JSON.stringify(waiting.blocked));assert.equal(waiting.node.accounting.feed.scrap,paidFeed);n=waiting.node;
  const targetSeat={residentId:5,roomId:4,from:n.view.serverTime,until:n.book.windowEnd};
  const amended=routes.amend(n,'existing:role:5',{seats:[targetSeat]});assert.equal(amended.accepted,true);n=amended.node;
  const move=routes.submit(n,'existing:role:5',{kind:'assign',residentId:5,fromRoomId:70,roomId:4},'leave-workshop');
  assert.equal(move.accepted,true,JSON.stringify(move.blocked));n=confirm(move.node);
  n=routes.advance(n,start+3*tick,{collect:true}).node;
  const action={kind:'upgrade',roomId:4,fromLevel:2,finishAt:start+4*tick,source:'explicit conditional construction duration'};
  const build=routes.submit(n,'existing:materials',action,'old-project');assert.equal(build.accepted,true,JSON.stringify(build.blocked));
  const receipt={requestId:build.node.pending.requestId,intentId:build.node.pending.intentId,fingerprint:build.node.pending.fingerprint,
    at:build.node.view.serverTime,result:'confirmed'};
  n=routes.resolve(build.node,receipt).node;assert.equal(n.existing.material.status,'constructing');
  assert.equal(n.accounting.paid.scrap,480);assert.equal(n.accounting.paid.parts,15);
  assert.equal(routes.resolve(JSON.parse(JSON.stringify(n)),receipt).duplicate,true);
  const completed=routes.advance(n,start+16*tick,{collect:true});assert.equal(completed.complete,true,JSON.stringify(completed.blocked));n=completed.node;
  assert.equal(n.existing.material.status,'complete');assert.equal(n.view.state.rooms.find(r=>r.id===4).level,3);
  assert.equal(n.accounting.feed.scrap,paidFeed);assert.ok(n.accounting.collected.scrap>0);
  assert.deepEqual(n.existing.materialRecord,originalPurpose);
  for(const k of Object.keys(n.accounting.initial))assert.ok(Math.abs(n.accounting.initial[k]+n.accounting.collected[k]-
    n.accounting.consumed[k]-n.accounting.feed[k]-n.accounting.paid[k]-n.view.state.resources[k])<1e-6);
  console.log(JSON.stringify({kind:'existing-material-cycle',start,end:n.view.serverTime,initial:v.state.resources,
    accounting:n.accounting,final:n.view.state.resources,material:n.existing.material,source:'conditional fixture; not actual efficiency improvement'}));
});

test('existing state: an existing full batch is not inventory before collection and needs no extra feed',()=>{
  const {v,s}=materialScene({stored:3});let n=bindMaterials(load(v,s).node);
  assert.equal(n.existing.material.collectableParts,3);assert.equal(n.existing.material.allocated.parts,14);
  assert.equal(n.existing.material.allocated.feedScrap,0);assert.equal(n.view.state.resources.parts,14);
  assert.ok(routes.preview(n,'existing:materials',{kind:'upgrade',roomId:4,fromLevel:2,finishAt:start+tick,source:'fixture'}).blocked
    .some(b=>b.kind==='inherited-material-project-not-ready'));
  const a=routes.advance(n,start+tick,{collect:true});assert.equal(a.complete,true,JSON.stringify(a.blocked));
  assert.equal(a.node.accounting.feed.scrap,0);assert.equal(a.node.existing.material.status,'ready');
});

test('existing state: partial funding never spends future scrap and preserves other intents and the safety reserve',()=>{
  const {v,s}=materialScene({parts:0,stored:0,scrap:700});let n=load(v,s).node;
  n=routes.reserve(n,{id:'other',purpose:'another committed payment',resources:{scrap:50}}).node;
  n=bindMaterials(n);assert.equal(n.existing.material.allocated.scrap,450);assert.equal(n.existing.material.allocated.feedScrap,0);
  assert.equal(n.existing.material.shortage.scrap,30);
  const step=routes.advance(n,start+tick,{collect:true});assert.equal(step.complete,true,JSON.stringify(step.blocked));
  assert.equal(step.node.accounting.feed.scrap,0);assert.ok(step.node.view.state.resources.scrap>=700);
  assert.equal(step.node.book.entries.find(e=>e.id==='other').resources.scrap,50);
  const corrupt=JSON.parse(JSON.stringify(n));corrupt.book.entries.find(e=>e.id==='existing:materials').resources.scrap=0;
  assert.throws(()=>routes.advance(corrupt,start+tick),/material allocation/);
});

test('existing state: historical workshop workers acquire a shared intent, while a second unbound producer is refused',()=>{
  const {v,s}=materialScene({automatic:false});const n=bindMaterials(load(v,s).node);
  assert.equal(n.existing.material.workers[0].intentId,'existing:materials');
  assert.throws(()=>routes.release(n,'existing:materials',{reason:'discard purpose while still making parts'}),/workers must/);
  v.state.residents.find(p=>p.id===6).roomId=70;
  const rejected=routes.bindExistingMaterials(load(v,s).node,{workers:[5],source:'incomplete ownership'});
  assert.equal(rejected.accepted,false);assert.ok(rejected.blocked.some(b=>b.kind==='manufacturing-owner-conflict'));
  const both=routes.bindExistingMaterials(load(v,s).node,{workers:[5,6],source:'explicit two-worker purpose'});
  assert.equal(both.accepted,true,JSON.stringify(both.blocked));
  assert.equal(routes.advance(both.node,start+tick,{collect:true}).complete,true);
});

test('existing state: serialized native requests and prior rolling payments cannot disappear on reload',()=>{
  const pending={id:'unknown-native',kind:'assign',vaultNo:77,at:start,targets:[5,4]},n=load(scene(),schedule(),{pending}).node;
  n.existing.native=[];assert.throws(()=>routes.advance(n,start+tick),/request binding/);
  const s=schedule({constructionLedger:[{id:'paid',at:100,scrap:9950,parts:0}]}),clock={localAt:100,serverAt:start,uncertaintyMs:0,source:'fixture clock'};
  const withPayment=load(scene(),s,{clock}).node;withPayment.spent=[];
  assert.throws(()=>routes.advance(withPayment,start+tick),/payments cannot be reset/);
  const v=scene(),tr=schedule();training(tr,v);const trainee=load(v,tr).node;delete trainee.existing.roles[0].record.until;
  assert.throws(()=>routes.advance(trainee,start+tick),/role binding/);
});

test('existing state: multiple workshops finish whole batches without borrowing the project principal or feeding after ready',()=>{
  const {v,s}=materialScene({parts:10,stored:2.7,automatic:false});
  v.state.rooms.push({...v.state.rooms.find(r=>r.id===70),id:71,col:3,stored:2.8});
  v.state.residents.find(p=>p.id===6).roomId=71;
  let n=routes.bindExistingMaterials(load(v,s).node,{workers:[5,6],source:'two explicit workshops'}).node;
  const first=routes.advance(n,start+6*tick,{collect:true});assert.equal(first.complete,true,JSON.stringify(first.blocked));n=first.node;
  assert.equal(n.existing.material.status,'ready');assert.equal(n.accounting.collected.parts,6);
  assert.equal(n.existing.material.allocated.parts,15);assert.equal(n.existing.material.allocated.scrap,480);
  const feed=n.accounting.feed.scrap;assert.ok(feed>3&&feed<6);
  const continued=routes.advance(JSON.parse(JSON.stringify(n)),start+12*tick,{collect:true});assert.equal(continued.complete,true);
  assert.equal(continued.node.accounting.feed.scrap,feed);assert.ok(continued.node.view.state.resources.scrap>=200+480);
  assert.equal(continued.node.accounting.paid.scrap,0);
});

test('existing state: manufacturing can refill partial material reservations only after real collection',()=>{
  const {v,s}=materialScene({parts:14,stored:2.9,scrap:700});v.state.rooms.find(r=>r.id===4).stored=44;
  let n=load(v,s).node;n=routes.reserve(n,{id:'other',purpose:'independent allocation',resources:{scrap:50}}).node;n=bindMaterials(n);
  const first=routes.advance(n,start+tick,{collect:true});assert.equal(first.complete,true,JSON.stringify(first.blocked));
  assert.equal(first.node.accounting.feed.scrap,0);assert.ok(first.node.accounting.collected.scrap>=45);
  assert.equal(first.node.existing.material.allocated.scrap,480);assert.ok(first.node.existing.material.allocated.feedScrap>0);
  const second=routes.advance(JSON.parse(JSON.stringify(first.node)),start+2*tick,{collect:true});assert.equal(second.complete,true);
  assert.equal(second.node.existing.material.status,'ready');assert.equal(second.node.accounting.collected.parts,3);
  assert.equal(second.node.book.entries.find(e=>e.id==='other').resources.scrap,50);
});

test('existing state: real romance continues through parent return, birth, adulthood and first actual employment collection',()=>{
  const v=scene(),s=schedule({pair:{a:5,b:6,room:5,step:2}});
  for(const [id,partner] of [[5,6],[6,5]])Object.assign(v.state.residents.find(p=>p.id===id),{roomId:5,romance:{partnerId:partner,progress:.99}});
  const child={...structuredClone(v.state.residents[0]),id:7,name:'known conditional child',parents:[5,6],roomId:5,
    training:0,romance:null,away:null,deadAt:null,outfitId:null,weaponId:null,xp:0,hp:100,adultAt:0};
  let n=load(v,s).node;
  n=routes.bindExistingFamily(n,'existing:family:5/6',{key:'inherited-cycle',parents:[5,6],roomId:5,stage:'romance',child,source:'explicit child condition'}).node;
  const pregnancy=routes.advance(n,start+tick,{collect:true});assert.equal(pregnancy.complete,true,JSON.stringify(pregnancy.blocked));n=pregnancy.node;
  assert.equal(n.existing.families[0].status,'pregnant');assert.equal(routes.inspect(n).population,7);
  n=routes.amend(n,'existing:family:5/6',{seats:[{residentId:5,roomId:4,from:n.view.serverTime,until:n.book.windowEnd},
    {residentId:6,roomId:2,from:n.view.serverTime,until:n.book.windowEnd}]}).node;
  for(const [id,room] of [[5,4],[6,2]]){
    const submitted=routes.submit(n,'existing:family:5/6',{kind:'assign',residentId:id,fromRoomId:5,roomId:room},'parent-return-'+id);
    assert.equal(submitted.accepted,true,JSON.stringify(submitted.blocked));n=confirm(submitted.node);
    const next=routes.advance(n,n.view.serverTime+tick,{collect:true});assert.equal(next.complete,true,JSON.stringify(next.blocked));n=next.node;
  }
  n=routes.release(n,'existing:family:5/6',{complete:true,reason:'pregnancy confirmed and both parents returned'});
  const adultAt=start+tick+6*hour,adult=routes.advance(JSON.parse(JSON.stringify(n)),adultAt,{collect:true});
  assert.equal(adult.complete,true,JSON.stringify(adult.blocked));n=adult.node;
  assert.equal(n.existing.families[0].status,'born');assert.equal(n.view.state.births.length,0);
  assert.equal(n.view.state.residents.length,7);assert.equal(routes.inspect(n).population,7);
  assert.equal(n.view.state.residents.find(p=>p.id===7).roomId,5);
  n=routes.reserve(n,reservation(n,'child-job',7,3)).node;
  const action=routes.submit(n,'child-job',{kind:'assign',residentId:7,fromRoomId:5,roomId:3},'first-child-job');
  assert.equal(action.accepted,true,JSON.stringify(action.blocked));n=confirm(action.node);
  const before=n.accounting.collected.water,work=routes.advance(n,adultAt+3*hour,{collect:true});
  assert.equal(work.complete,true,JSON.stringify(work.blocked));assert.ok(work.node.accounting.collected.water>before);
  console.log(JSON.stringify({kind:'existing-family-cycle',pregnantAt:start+tick,adultAt,child:7,
    population:routes.inspect(work.node).population,waterCollectedAfterEmployment:work.node.accounting.collected.water-before,
    source:'conditional child and fixed mood/XP; not runtime growth or causal efficiency improvement'}));
});

test('existing state: inherited supply upgrade preview and actual first recovered collection use the same allocated feed',()=>{
  const {v,s}=materialScene({parts:15,stored:0});v.state.rooms.find(r=>r.id===1).level=2;
  s.campaign.materials={...s.campaign.materials,id:1,type:'power'};
  let n=bindMaterials(load(v,s).node);
  const action={kind:'upgrade',roomId:1,fromLevel:2,finishAt:start+6*tick,source:'conditional one-hour supply upgrade'};
  const preview=routes.preview(n,'existing:materials',action);assert.deepEqual(preview.blocked,[]);
  assert.ok(preview.supplyRecovery.restored.power>action.finishAt);
  const submitted=routes.submit(n,'existing:materials',action,'inherited-power');assert.equal(submitted.accepted,true,JSON.stringify(submitted.blocked));
  n=confirm(submitted.node);const step=routes.advance(n,preview.supplyRecovery.checkedUntil,{collect:true});
  assert.equal(step.complete,true,JSON.stringify(step.blocked));assert.equal(step.node.accounting.feed.scrap,0);
  assert.equal(step.node.existing.material.status,'complete');assert.ok(step.node.accounting.collected.power>0);
  assert.ok(step.node.view.state.resources.power>=2*routes.supply(step.node).power.need);
});
