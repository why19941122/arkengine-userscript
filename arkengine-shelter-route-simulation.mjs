import {createShelterResourceSimulation} from './arkengine-shelter-resource-simulation.mjs';
import {createShelterEventSimulation} from './arkengine-shelter-event-simulation.mjs';
import {createShelterReservations} from './arkengine-shelter-reservations.mjs';
import {createShelterFamilySimulation} from './arkengine-shelter-family-simulation.mjs';
import {createShelterMoodSimulation} from './arkengine-shelter-mood-simulation.mjs';
import {createShelterXpSimulation} from './arkengine-shelter-xp-simulation.mjs';
import {createShelterExistingState} from './arkengine-shelter-existing-state.mjs';

// Offline D.14 state transitions, with an explicit one-action-per-tick execution assumption.
// Does not generate/rank routes or send requests. Bound simulated receipts must never be
// substituted for the userscript's native DOM/network proof when a runtime adapter is added.
export function createShelterRouteSimulation() {
  const resource=createShelterResourceSimulation(),natural=createShelterEventSimulation(),holds=createShelterReservations(),
    family=createShelterFamilySimulation(),mood=createShelterMoodSimulation(),xp=createShelterXpSimulation(),existing=createShelterExistingState();
  const tick=600000,day=86400000,keys=['power','food','water','scrap','parts','stimpak'];
  const production={power:'power',diner:'food',water:'water',scrap:'scrap',workshop:'parts',medbay:'stimpak'};
  const builds={power:[100,1],diner:[100,1],water:[100,1],scrap:[80,1],quarters:[120,1],storage:[80,2],
    medbay:[300,3],training:[400,4],workshop:[500,5],armory:[600,6],tailor:[600,6],radio:[800,8]};
  const validId=n=>Number.isSafeInteger(n)&&n>0;
  const evidence=s=>typeof s==='string'&&s.trim().length>0;
  const zero=()=>Object.fromEntries(keys.map(k=>[k,0]));
  const active=e=>!['cancelled','complete'].includes(e.status);
  const present=(p,at)=>p.deadAt===null&&p.away===null&&p.adultAt<=at;
  const activeRoom=(r,at)=>r&&r.builtAt<=at&&r.upgradeAt===null&&!r.incident&&!r.unpowered;
  const sameParents=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===2&&b.length===2&&a.every(id=>b.includes(id));
  const upgradeCost=r=>({scrap:Math.ceil(builds[r.type][0]*r.width*(r.level===1?2.5:6)),parts:r.level===1?0:15*r.width});
  function create(view,{assumptions,outcomes={births:[],digs:[]},familyRules=null,moodRules=null,xpRules=null,safety={},windowEnd,
    windowStart=view.serverTime,firstActionOnly=false,construction,constructionLedger}={}) {
    if(typeof firstActionOnly!=='boolean'||!Number.isSafeInteger(windowStart)||windowStart<0||windowStart>view.serverTime||
      windowEnd-windowStart>168*3600000||view.serverTime>=windowEnd)throw Error('Invalid original planning window');
    // A native read between settlements supports current-action checks only. Never
    // replace lastSettledAt or invent history to make it a full simulation snapshot.
    if(firstActionOnly)resource.validate(view);
    else natural.advance(view,view.serverTime,{assumptions,outcomes,moodRules,xpRules});
    if(!construction||!['build','upgrade','dig'].every(k=>typeof construction[k]==='boolean')||
      construction.budgetMode!==undefined&&!['stock','daily'].includes(construction.budgetMode)||
      !['scrap','parts'].every(k=>Number.isSafeInteger(construction[k+'Limit'])&&construction[k+'Limit']>=0))
      throw Error('Explicit construction switches, valid budget mode and limits required');
    if(!Array.isArray(constructionLedger)||constructionLedger.some(e=>!e||!evidence(e.id)||
      !Number.isSafeInteger(e.at)||e.at<0||e.at>view.serverTime||!['scrap','parts'].every(k=>Number.isSafeInteger(e.cost?.[k])&&e.cost[k]>=0))||
      new Set(constructionLedger.map(e=>e.id)).size!==constructionLedger.length)
      throw Error('Explicit prior construction payments required');
    return {version:1,view:structuredClone(view),book:{...holds.create(view,{safety,windowEnd}),startedAt:windowStart},assumptions:structuredClone(assumptions),
      outcomes:structuredClone(outcomes),familyRules:structuredClone(familyRules),familyPlans:[],familyPauses:[],
      moodRules:structuredClone(moodRules),mood:null,xpRules:structuredClone(xpRules),xp:null,
      construction:structuredClone(construction),spent:structuredClone(constructionLedger),pending:null,lastActionAt:null,
      accounting:{initial:{...view.state.resources},produced:zero(),collected:zero(),consumed:zero(),feed:zero(),paid:zero()},events:[],
      model:firstActionOnly?'native-snapshot-first-action-only':'offline-one-confirmed-action-per-ten-minute-tick'};
  }
  function validate(n) {
    if(n?.version!==1||!Array.isArray(n.spent)||!Array.isArray(n.events)||!n.accounting||
      !keys.every(k=>['initial','produced','collected','consumed','feed','paid'].every(f=>Number.isFinite(n.accounting[f][k])&&n.accounting[f][k]>=0)))
      throw Error('Invalid route state');
    resource.validate(n.view);holds.inspect(n.view,n.book);
    if(n.existing)existing.validate(n.view,n.existing,n.book);
    if(n.existing?.priorPayments.some(p=>!n.spent.some(s=>s.id===p.id&&s.at===p.at&&
      s.cost.scrap===p.cost.scrap&&s.cost.parts===p.cost.parts)))throw Error('Inherited construction payments cannot be reset');
    family.validate(n.familyPlans??[],n.familyRules);
    if(n.moodRules!=null)mood.validate(n.view,n.moodRules);
    if(n.mood&&['statBasis','matching','shortage','timing','rounding','source'].some(k=>n.mood.rules?.[k]!==n.moodRules?.[k]))
      throw Error('Stored mood rules disagree with the route policy');
    if(n.xpRules!=null)xp.validate(n.view,n.xpRules);
    if(n.xp&&['duty','collection','health','activity','precision','source'].some(k=>n.xp.rules?.[k]!==n.xpRules?.[k]))
      throw Error('Stored XP rules disagree with the route policy');
    if((n.familyPlans??[]).some(p=>!evidence(p.intentId)||!n.book.entries.some(e=>e.id===p.intentId)))
      throw Error('Family plan is not bound to its reservation');
    if(n.book.entries.filter(e=>e.status==='submitted').length!==(n.pending?1:0))throw Error('Route pending mismatch');
    if(n.pending){
      const p=n.book.entries.find(e=>e.id===n.pending.intentId)?.pending;
      if(!p||p.id!==n.pending.requestId||p.fingerprint!==n.pending.fingerprint||p.fingerprint!==JSON.stringify(n.pending.action))
        throw Error('Route pending binding mismatch');
    }
  }
  function checkConservation(n) {
    for(const k of keys){const a=n.accounting;
      if(Math.abs(a.initial[k]+a.collected[k]-a.consumed[k]-a.feed[k]-a.paid[k]-n.view.state.resources[k])>1e-6)
        throw Error('Route inventory conservation failed: '+k);
    }
  }
  function accumulate(n,ledger) {for(const field of ['produced','collected','consumed','feed'])for(const k of keys)n.accounting[field][k]+=ledger[field][k];}
  function fromRuntime(view,options={}) {
    if(!options.runtime||options.constructionLedger!==undefined)throw Error('Runtime import requires its own native construction history');
    const imported=existing.capture(view,{...options.runtime,windowEnd:options.windowEnd,safety:options.safety});
    const node=create(view,{...options,constructionLedger:imported.payments});
    node.book={...imported.book,startedAt:node.book.startedAt};node.existing=imported.state;validate(node);
    return {node,blocked:imported.blocked};
  }
  const inheritedIssues=(n,options={})=>existing.issues(n.view,n.existing,n.book,{familyPlans:n.familyPlans,...options});
  function reserve(input,intent) {
    validate(input);if(input.pending)throw Error('Reconcile pending before changing route commitments');
    const blocked=inheritedIssues(input,{action:{kind:'reserve'}});if(blocked.length)return {node:input,accepted:false,blocked};
    const result=holds.reserve(input.view,input.book,intent);
    return {node:result.accepted?{...input,book:result.book}:input,accepted:result.accepted,blocked:result.report.blocked};
  }
  function release(input,id,options) {
    validate(input);
    if(input.existing?.native.length)throw Error('Native pending action must be reconciled outside the simulator');
    if(input.existing?.roles.some(r=>r.intentId===id&&['active','preempted','return-due'].includes(r.status)))
      throw Error('Inherited role must end with a confirmed assignment before release');
    if(input.existing?.material?.intentId===id&&input.existing.material.workers.some(w=>
      input.existing.material.rooms.includes(input.view.state.residents.find(p=>p.id===w.id)?.roomId)))
      throw Error('Inherited material workers must leave or transfer their use before release');
    if(input.existing?.families.some(f=>f.intentId===id&&f.kind==='romance'&&['needs-plan','paused'].includes(f.status)&&
      input.book.entries.some(e=>e.id===id&&active(e))))throw Error('Inherited romance must retain its reservation');
    if((input.familyPlans??[]).some(p=>p.intentId===id&&p.stage==='romance'))throw Error('Active romance cannot lose its reservation');
    if((input.familyPlans??[]).some(p=>p.intentId===id&&p.stage==='planned'&&p.parents.every(id=>
      input.view.state.residents.some(r=>r.id===id&&r.roomId===p.roomId))))
      throw Error('Co-located parents cannot be cancelled without resolving their next family transition');
    const n={...input,book:holds.release(input.view,input.book,id,options),familyPlans:structuredClone(input.familyPlans??[])};
    for(const p of n.familyPlans)if(p.intentId===id&&p.stage==='planned')p.stage='cancelled';
    if(n.existing){n.existing=structuredClone(n.existing);for(const f of n.existing.families)if(f.intentId===id&&f.status==='needs-plan')f.status='cancelled';}
    if(n.existing?.swap?.intentId===id)n.existing.swap.status='cancelled';
    if(n.existing?.material?.intentId===id)n.existing.material.status='cancelled';
    return n;
  }
  function amend(input,intentId,changes) {
    validate(input);if(input.pending)throw Error('Reconcile pending before amending commitments');
    const blocked=inheritedIssues(input,{action:{kind:'amend'}});if(blocked.length)return {node:input,accepted:false,blocked};
    const result=holds.amend(input.view,input.book,intentId,changes);
    if(result.accepted){
      try{if(input.existing)existing.validate(input.view,input.existing,result.book);}
      catch{return {node:input,accepted:false,blocked:[{kind:'inherited-commitment-amendment-invalid'}]};}
      const blocked=familyCommitments({...input,book:result.book});
      if(blocked.length)return {node:input,accepted:false,blocked};
    }
    return {node:result.accepted?{...input,book:result.book}:input,accepted:result.accepted,blocked:result.report.blocked};
  }
  function familyCommitments(n) {
    const blocked=[],at=n.view.serverTime;
    for(const p of n.familyPlans??[])if(['planned','romance'].includes(p.stage)){
      const e=n.book.entries.find(e=>e.id===p.intentId&&active(e));
      if(!e||!e.families.some(f=>sameParents(f.parents,p.parents)&&f.dueAt===null&&f.childId===null)||
        p.parents.some(id=>!e.people.some(c=>c.residentId===id&&c.from<=at&&c.until>at)||
          !e.seats.some(c=>c.residentId===id&&c.roomId===p.roomId&&c.from<=at&&c.until>at)))
        blocked.push({kind:'family-commitment-missing',key:p.key,intentId:p.intentId});
    }
    return blocked;
  }
  function registerFamily(input,intentId,plan) {
    validate(input);if(input.pending||input.existing?.native.length)throw Error('Reconcile pending before registering family');
    if(plan?.stage!=='planned')throw Error('New family must start as an explicit planned cycle');
    const n=structuredClone(input);n.familyPlans??=[];
    n.familyPlans.push({...structuredClone(plan),intentId});family.validate(n.familyPlans,n.familyRules);
    const blocked=familyCommitments(n);
    blocked.push(...family.eligibility(n.view,plan,{ignoreLocation:true}));
    if(n.outcomes.births.some(o=>o.resident.id===plan.child.id))blocked.push({kind:'family-child-already-promised',key:plan.key});
    return {node:blocked.length?input:n,accepted:!blocked.length,blocked};
  }
  function bindExistingFamily(input,intentId,plan) {
    validate(input);if(input.pending||input.existing?.native.length)throw Error('Reconcile pending before binding inherited family');
    const f=input.existing?.families.find(f=>f.intentId===intentId&&f.status==='needs-plan');
    if(!f||plan?.roomId!==f.roomId||!sameParents(plan.parents,f.parents)||
      plan.stage!==(f.kind==='romance'?'romance':'planned'))throw Error('Family plan does not bind inherited family');
    if(plan.stage==='planned')return registerFamily(input,intentId,plan);
    const n=structuredClone(input);n.familyPlans.push({...structuredClone(plan),intentId});family.validate(n.familyPlans,n.familyRules);
    const blocked=familyCommitments(n);
    if(n.view.state.residents.some(p=>p.id===plan.child.id)||n.outcomes.births.some(o=>o.resident.id===plan.child.id))
      blocked.push({kind:'family-child-already-promised',key:plan.key});
    if(!f.parents.every(id=>n.view.state.residents.some(p=>p.id===id&&p.roomId===f.roomId&&
      p.romance&&f.parents.includes(p.romance.partnerId))))blocked.push({kind:'inherited-romance-state-changed'});
    return {node:blocked.length?input:n,accepted:!blocked.length,blocked};
  }
  function nextExistingSwap(input) {
    validate(input);const s=input.existing?.swap;
    if(!s||s.status==='complete'||s.status==='cancelled')return {action:null,intentId:null,blocked:[]};
    const move=s.moves[s.step],p=input.view.state.residents.find(p=>p.id===move?.id);
    if(!move||!p)return {action:null,intentId:s.intentId,blocked:[{kind:'inherited-swap-position-changed'}]};
    const action={kind:'assign',residentId:p.id,fromRoomId:p.roomId,roomId:move.room};
    const result=preview(input,s.intentId,action);
    return {action:result.blocked.length?null:action,intentId:s.intentId,blocked:result.blocked};
  }
  function refreshMaterials(n) {
    const m=n.existing?.material;if(!m||m.status==='cancelled')return;
    const e=n.book.entries.find(e=>e.id===m.intentId),r=n.view.state.rooms.find(r=>r.id===m.roomId);
    if(e.status==='submitted')return;
    if(m.status==='constructing'&&r?.level>=m.targetLevel&&r.upgradeAt===null)m.status='complete';
    const preparing=['preparing','ready'].includes(m.status);
    if(preparing&&(!r||r.type!==n.existing.materialPurpose.type||r.level!==m.fromLevel||r.upgradeAt!==null))
      throw Error('Inherited material target changed before payment');
    if(preparing)m.cost=upgradeCost(r);
    const report=holds.inspect(n.view,n.book,{owner:m.intentId});
    // Existing allocations are replaceable by their own purpose, not extra inventory.
    const availableScrap=Math.max(0,report.ownSpendable.scrap+e.feedScrap),availableParts=Math.max(0,report.ownSpendable.parts);
    e.resources.scrap=preparing?Math.min(m.cost.scrap,availableScrap):0;
    e.resources.parts=preparing?Math.min(m.cost.parts,availableParts):0;
    let collected=structuredClone(n.view),ready=0;
    for(const roomId of m.rooms){const result=resource.collect(collected,roomId);collected=result.view;ready+=result.ledger.collected.parts;}
    m.shortage={scrap:preparing?m.cost.scrap-e.resources.scrap:0,parts:preparing?m.cost.parts-e.resources.parts:0};
    m.collectableParts=ready;
    // Grant at most the next actual tick's feed, then re-evaluate collected inventory.
    // Capping at fractional remaining parts would strand an incomplete whole batch.
    const feedNeed=preparing&&m.shortage.parts>ready+1e-7?n.view.state.rooms.filter(r=>m.rooms.includes(r.id))
      .reduce((sum,r)=>sum+resource.rate(n.view,r,n.view.serverTime),0):0;
    e.feedScrap=Math.min(Math.max(0,availableScrap-e.resources.scrap),feedNeed);
    m.allocated={scrap:e.resources.scrap,parts:e.resources.parts,feedScrap:e.feedScrap};m.updatedAt=n.view.serverTime;
    if(preparing)m.status=m.shortage.scrap<1e-7&&m.shortage.parts<1e-7?'ready':'preparing';
  }
  function bindExistingMaterials(input,{workers,source}={}) {
    validate(input);if(input.pending||input.existing?.native.length)throw Error('Reconcile pending before binding inherited materials');
    const purpose=input.existing?.materialPurpose;
    if(!purpose||input.existing.material||!evidence(source)||!Array.isArray(workers)||workers.some(id=>!validId(id))||
      new Set(workers).size!==workers.length)throw Error('Explicit inherited material workers and source required');
    const n=structuredClone(input),r=n.view.state.rooms.find(r=>r.id===purpose.id),at=n.view.serverTime;
    if(!r||r.type!==purpose.type||r.level+1!==purpose.level||!builds[r.type]||r.level>=3||!activeRoom(r,at))
      return {node:input,accepted:false,blocked:[{kind:'inherited-material-target-changed'}]};
    const report=holds.inspect(n.view,n.book),bindings=[],people=[],seats=[],rooms=new Set(),blocked=[];
    for(const id of workers){
      const p=n.view.state.residents.find(p=>p.id===id),room=n.view.state.rooms.find(r=>r.id===p?.roomId);
      if(!p||!present(p,at)||p.romance||room?.type!=='workshop'||!activeRoom(room,at)){
        blocked.push({kind:'inherited-material-worker-unavailable',residentId:id});continue;
      }
      const claims=report.people.filter(c=>c.residentId===id),role=n.existing.roles.find(r=>r.residentId===id&&
        r.record.role==='workshop'&&['active','return-due'].includes(r.status));
      if(claims.length&&(!role||claims.some(c=>c.intentId!==role.intentId))){
        blocked.push({kind:'inherited-material-worker-already-promised',residentId:id});continue;
      }
      rooms.add(room.id);const intentId=claims.length?role.intentId:'existing:materials';
      bindings.push({id,intentId});
      if(!claims.length){people.push({residentId:id,from:at,until:n.book.windowEnd});
        seats.push({residentId:id,roomId:room.id,from:at,until:n.book.windowEnd});}
    }
    for(const p of n.view.state.residents)if(present(p,at)&&n.view.state.rooms.some(r=>r.id===p.roomId&&r.type==='workshop'&&activeRoom(r,at))&&!workers.includes(p.id))
      blocked.push({kind:'manufacturing-owner-conflict',residentId:p.id});
    if(blocked.length)return {node:input,accepted:false,blocked};
    const held=holds.reserve(n.view,n.book,{id:'existing:materials',purpose:'inherited project material allocation',people,seats});
    if(!held.accepted)return {node:input,accepted:false,blocked:held.report.blocked};n.book=held.book;
    n.existing.material={intentId:'existing:materials',source,roomId:r.id,fromLevel:r.level,targetLevel:purpose.level,
      cost:upgradeCost(r),workers:bindings,rooms:[...rooms],status:'preparing',allocated:{scrap:0,parts:0,feedScrap:0}};
    refreshMaterials(n);validate(n);
    return {node:n,accepted:true,blocked:holds.inspect(n.view,n.book).blocked};
  }
  function manufacturing(n,requestedOwner=null) {
    const m=n.existing?.material,owner=m&&m.status!=='cancelled'?m.intentId:requestedOwner;
    if(m&&m.status!=='cancelled'&&requestedOwner!==null&&requestedOwner!==owner)
      return {blocked:[{kind:'manufacturing-owner-conflict'}]};
    const allowance=holds.feedAllowance(n.view,n.book,owner),blocked=[];
    if(owner!==null){
      const owned=new Set(allowance.report.people.filter(p=>p.intentId===owner&&p.from<=n.view.serverTime&&p.until>n.view.serverTime).map(p=>p.residentId));
      if(m?.intentId===owner)for(const p of m.workers)owned.add(p.id);
      for(const p of n.view.state.residents)if(present(p,n.view.serverTime)&&n.view.state.rooms.some(r=>r.id===p.roomId&&
        r.type==='workshop'&&activeRoom(r,n.view.serverTime))&&!owned.has(p.id))blocked.push({kind:'manufacturing-owner-conflict',residentId:p.id});
    }
    return {...allowance,owner,blocked};
  }
  function committedFamilySupply(n) {
    const v=structuredClone(n.view);
    // All prospective parents are removed together, including other reserved families.
    // Checking only the parent moved by this action could strand the second supply worker.
    for(const e of n.book.entries.filter(active))for(const f of e.families)if(f.dueAt===null&&f.childId===null)
      for(const id of f.parents){const p=v.state.residents.find(p=>p.id===id);if(p)p.roomId=null;}
    return supply(v,n.book);
  }
  function growthNeeds(view,book) {
    const at=view.serverTime,s=view.state,report=holds.inspect(view,book);
    const current=resource.demand(view,at),needs={...current,food:report.population,water:report.population};
    // Reserve the electricity of already paid construction and upgrade increments.
    for(const r of s.rooms){
      const per=['power','door','elevator'].includes(r.type)?0:production[r.type]?1:.5;
      if(r.builtAt>at)needs.power+=per*r.width*r.level;
      else if(r.upgradeAt!==null)needs.power+=per*r.width;
    }
    return needs;
  }
  function supply(view,book) {
    const need=growthNeeds(view,book),rates=zero();
    for(const r of view.state.rooms)if(production[r.type])rates[production[r.type]]+=resource.rate(view,r,view.serverTime);
    return Object.fromEntries(['power','food','water'].map(k=>[k,{need:need[k],rate:rates[k],
      deficit:Math.max(0,need[k]*1.2-rates[k]),inventoryGap:Math.max(0,need[k]*2-view.state.resources[k])}]));
  }
  function constructionSupplyTrajectory(node,intentId,cost) {
    // Use the same event/stock model as the route, including whole-batch collection. Completion
    // itself gives no inventory. This assumes one collection opportunity per tick; the runtime
    // must measure its real delay before these offline times can be used as an execution claim.
    const projected=structuredClone(node),e=projected.book.entries.find(e=>e.id===intentId),begin=projected.view.serverTime;
    for(const k of ['scrap','parts']){projected.view.state.resources[k]-=cost[k];e.resources[k]-=cost[k];}
    if(projected.existing?.material?.intentId===intentId)projected.existing.material.status='constructing';
    refreshMaterials(projected);
    const first=supply(projected.view,projected.book),waiting=Object.keys(first).filter(k=>first[k].deficit>1e-7);
    const minimum=Object.fromEntries(Object.entries(first).map(([k])=>[k,projected.view.state.resources[k]])),restored={};
    const blocked=[];
    for(const [k,v] of Object.entries(first))if(v.inventoryGap>1e-7)blocked.push({kind:'construction-stock-floor',resource:k});
    const end=Math.min(begin+day,projected.book.windowEnd);
    while(waiting.some(k=>restored[k]===undefined)&&projected.view.serverTime+tick<=end&&!blocked.length){
      blocked.push(...inheritedIssues(projected,{advancing:true,nextAt:projected.view.serverTime+tick}));
      if(blocked.length)break;
      const feed=manufacturing(projected);blocked.push(...feed.blocked);if(blocked.length)break;
      const floor=feed.floor;
      const step=natural.advance(projected.view,projected.view.serverTime+tick,{assumptions:projected.assumptions,
        outcomes:projected.outcomes,familyPlans:projected.familyPlans,familyRules:projected.familyRules,
        moodRules:projected.moodRules??null,xpRules:projected.xpRules??null,scrapFloor:floor,collect:true});
      if(!step.complete){blocked.push(...step.blocked);break;}
      projected.view=step.view;projected.outcomes=step.outcomes;projected.familyPlans=step.familyPlans;
      if(feed.owner!==null)projected.book=holds.consumeFeed(projected.view,projected.book,feed.owner,step.ledger.feed.scrap);
      projected.book=holds.reconcileEvents(projected.view,projected.book,step.events);
      if(projected.existing)projected.existing=existing.remap(projected.existing,step.events);
      refreshMaterials(projected);
      const after=supply(projected.view,projected.book);
      for(const [k,v] of Object.entries(after)){
        minimum[k]=Math.min(minimum[k],step.ledger.minimumInventory[k]);
        if(step.ledger.unserved[k]>1e-7||step.ledger.minimumInventory[k]<2*v.need-1e-7)
          blocked.push({kind:'construction-stock-floor',resource:k,at:projected.view.serverTime});
        if(waiting.includes(k)&&v.deficit<=1e-7&&step.ledger.collected[k]>0)restored[k]??=projected.view.serverTime;
      }
    }
    for(const k of waiting)if(restored[k]===undefined&&!blocked.length)blocked.push({kind:'construction-supply-unresolved',resource:k});
    return {blocked,restored,minimum,assumption:'whole-batch collection at every ten-minute boundary',from:begin,checkedUntil:projected.view.serverTime};
  }
  function preview(input,intentId,action) {
    validate(input);const n=structuredClone(input),at=n.view.serverTime,s=n.view.state,blocked=[];
    const entry=n.book.entries.find(e=>e.id===intentId&&active(e));
    if(!entry)return {blocked:[{kind:'unknown-intent'}]};
    const cost={scrap:0,parts:0},beforeSupply=supply(n.view,n.book);let supplyRecovery=null;
    const people=new Set(entry.people.filter(c=>c.from<=at&&at<c.until).map(c=>c.residentId));
    const seats=entry.seats.filter(c=>c.from<=at&&at<c.until);
    if(s.lastSettledAt!==at&&n.model!=='native-snapshot-first-action-only'||at>=n.book.windowEnd)blocked.push({kind:'invalid-action-time'});
    if(n.view.switches?.frozen)blocked.push({kind:'frozen-shelter'});
    if(n.model==='native-snapshot-first-action-only'&&action.kind!=='assign')blocked.push({kind:'native-current-assignment-only'});
    blocked.push(...inheritedIssues(n,{intentId,action}));
    blocked.push(...familyCommitments(n));
    if(input.lastActionAt!==null&&at<input.lastActionAt+tick)blocked.push({kind:'action-cadence'});
    const a=action,r=s.rooms.find(r=>r.id===a.roomId);
    if(a.kind==='assign'){
      const p=s.residents.find(p=>p.id===a.residentId);
      const maxHp=p?Math.round(100+Math.min(49,Math.floor(Math.sqrt(p.xp/3)))*(2+.5*p.stats.end)):Infinity;
      if(!p||!people.has(p.id)||!present(p,at)||p.romance||!Number.isFinite(p.hp)||p.hp<.6*maxHp||p.roomId!==a.fromRoomId||a.roomId===a.fromRoomId)
        blocked.push({kind:'resident-action-invalid'});
      const familyPlan=r?.type==='quarters'?(n.familyPlans??[]).find(f=>f.key===a.familyKey&&f.intentId===intentId&&
        f.stage==='planned'&&f.roomId===a.roomId&&f.parents.includes(a.residentId)):null;
      if(a.roomId!==null&&(!activeRoom(r,at)||!production[r?.type]&&!['training','radio'].includes(r?.type)&&!familyPlan||
        !seats.some(c=>c.residentId===a.residentId&&c.roomId===a.roomId)))blocked.push({kind:'destination-not-reserved'});
      if(r?.type==='radio'){
        const capacity=Math.min(200,s.rooms.filter(q=>q.type==='quarters'&&q.builtAt<=at).reduce((n,q)=>n+q.width*(2+2*q.level),0));
        if(s.residents.length+s.births.length<capacity||s.rooms.some(q=>q.type==='quarters'&&(q.builtAt>at||q.upgradeAt!==null)))
          blocked.push({kind:'radio-recruitment-not-modeled'});
      }
      if(familyPlan){
        blocked.push(...family.eligibility(n.view,familyPlan,{ignoreLocation:true}));
        for(const [k,v] of Object.entries(committedFamilySupply(n)))if(v.deficit>1e-7||v.inventoryGap>1e-7)
          blocked.push({kind:'family-supply-not-covered',resource:k,...v});
      }
      if(r&&s.residents.filter(q=>q.id!==p?.id&&q.deadAt===null&&q.adultAt<=at&&q.roomId===r.id).length>=r.width*2)
        blocked.push({kind:'destination-full'});
      if(r?.type==='training'&&(!['str','per','end','cha','int','agi','lck'].includes(r.trainStat)||p?.stats[r.trainStat]>=10))
        blocked.push({kind:'invalid-training-destination'});
      if(!blocked.length){p.roomId=a.roomId;if(a.fromRoomId!==a.roomId)p.training=0;}
    }else if(['build','upgrade','dig'].includes(a.kind)){
      if(!n.construction[a.kind])blocked.push({kind:'construction-disabled'});
      if(!Number.isSafeInteger(a.finishAt)||a.finishAt<=at||a.finishAt>n.book.windowEnd||!evidence(a.source))
        blocked.push({kind:'unknown-construction-time'});
      if(a.kind!=='dig'&&s.rooms.filter(r=>r.builtAt>at||r.upgradeAt!==null).length>=2)blocked.push({kind:'construction-slots'});
      if(a.kind==='upgrade'){
        if(!activeRoom(r,at)||!builds[r?.type]||r.level!==a.fromLevel||r.level>=3)blocked.push({kind:'upgrade-state-changed'});
        else{
          Object.assign(cost,upgradeCost(r));
          r.upgradeAt=a.finishAt;
        }
      }else if(a.kind==='build'){
        if(!builds[a.type]||!validId(a.roomId)||r||!Number.isInteger(a.floor)||a.floor<1||a.floor>s.depth||
          !Number.isInteger(a.col)||a.col<2||a.col>7||n.view.progress.level<(builds[a.type]?.[1]??Infinity))blocked.push({kind:'build-state-invalid'});
        const floor=s.rooms.filter(r=>r.floor===a.floor).sort((a,b)=>a.col-b.col);let next=2;
        for(const room of floor.filter(r=>!['door','elevator'].includes(r.type))){if(room.col!==next)blocked.push({kind:'layout-gap'});next=room.col+room.width;}
        if(a.col!==next)blocked.push({kind:'build-not-at-free-edge'});
        if(a.type==='training'&&!['str','per','end','cha','int','agi','lck'].includes(a.trainStat))blocked.push({kind:'unknown-training-stat'});
        if(builds[a.type])cost.scrap=Math.ceil(builds[a.type][0]*(1+.2*s.rooms.filter(r=>r.type===a.type).reduce((n,r)=>n+r.width,0)));
        if(!blocked.length)s.rooms.push({id:a.roomId,type:a.type,floor:a.floor,col:a.col,width:1,level:1,builtAt:a.finishAt,
          upgradeAt:null,stored:0,incident:null,unpowered:false,...(a.type==='training'?{trainStat:a.trainStat}:{})});
      }else{
        if(s.digging||a.floor!==s.depth+1||a.floor>=20||!validId(a.elevatorId)||s.rooms.some(r=>r.id===a.elevatorId))
          blocked.push({kind:'dig-state-or-unmodeled-defense'});
        cost.scrap=Math.ceil(120*(s.depth+1)**1.4);
        if(!blocked.length){
          s.digging={floor:a.floor,doneAt:a.finishAt};
          n.outcomes.digs.push({floor:a.floor,doneAt:a.finishAt,source:a.source,
            elevator:{id:a.elevatorId,type:'elevator',floor:a.floor,col:1,width:1,level:1,builtAt:a.finishAt,
              upgradeAt:null,stored:0,incident:null,unpowered:false}});
        }
      }
      for(const k of ['scrap','parts']){
        const spent=n.spent.filter(x=>x.at>at-day).reduce((sum,x)=>sum+x.cost[k],0);
        if(n.construction.budgetMode!=='stock'&&cost[k]+spent>n.construction[k+'Limit'])blocked.push({kind:'rolling-construction-limit',resource:k});
      }
    }else blocked.push({kind:'unsupported-action'});
    if(!blocked.length){
      const after=supply(n.view,n.book);
      if(a.kind==='assign'&&input.existing?.swap?.intentId===intentId)for(const k of ['power','food','water'])
        if(after[k].rate<(input.existing.swap.supplyFloor?.[k]??0)-1e-7)
          blocked.push({kind:'inherited-swap-supply-floor',resource:k});
      for(const k of ['power','food','water'])if(a.kind==='assign'&&
        (after[k].deficit>beforeSupply[k].deficit+1e-7||after[k].inventoryGap>1e-7))
        blocked.push({kind:'supply-not-covered',resource:k,before:beforeSupply[k],after:after[k]});
      // Existing deficits may be repaired incrementally but never worsened by a free move.
      const report=holds.inspect(n.view,n.book,{owner:intentId});
      blocked.push(...report.blocked);
      for(const k of ['scrap','parts'])if(cost[k]>entry.resources[k]+1e-7||cost[k]>report.ownSpendable[k]+1e-7)
        blocked.push({kind:'construction-cost-not-reserved',resource:k,cost:cost[k]});
      if(!blocked.length&&['build','upgrade','dig'].includes(a.kind)){
        supplyRecovery=constructionSupplyTrajectory(n,intentId,cost);blocked.push(...supplyRecovery.blocked);
      }
    }
    return {node:n,cost,blocked,supplyRecovery};
  }
  function submit(input,intentId,action,requestId) {
    validate(input);if(input.pending)throw Error('Route already has a pending action');
    if(input.model==='native-snapshot-first-action-only')return {node:input,accepted:false,blocked:[{kind:'native-receipt-required'}]};
    const proposal=preview(input,intentId,action);if(proposal.blocked.length)return {node:input,accepted:false,blocked:proposal.blocked};
    const fingerprint=JSON.stringify(action),result=holds.submit(input.view,input.book,intentId,{requestId,fingerprint,cost:proposal.cost});
    if(!result.accepted)return {node:input,accepted:false,blocked:result.report.blocked};
    return {node:{...input,book:result.book,pending:{intentId,requestId,fingerprint,action:structuredClone(action),at:input.view.serverTime}},accepted:true,blocked:[]};
  }
  function resolve(input,receipt) {
    validate(input);const pending=input.pending;
    if(!pending){
      const found=input.book.receipts.find(r=>r.requestId===receipt?.requestId);
      if(!found)throw Error('No matching pending action');
      holds.resolve(input.view,input.book,found.intentId,receipt);return {node:input,duplicate:true,blocked:[]};
    }
    // Check the exact request binding before previewing or applying any local state change.
    const payment=holds.resolve(input.view,input.book,pending.intentId,receipt);
    if(receipt.result==='unknown')return {node:input,duplicate:false,blocked:[{kind:'pending-outcome'}]};
    const n=structuredClone(input);
    if(receipt.result==='confirmed'){
      // The bound receipt has resolved uncertainty. Validate the confirmed action against
      // still-unpaid allocations without treating this same request as pending forever;
      // otherwise valid later intents for the resident prevent confirming the first move.
      const confirmedInput=structuredClone(input),confirmedEntry=confirmedInput.book.entries.find(e=>e.id===pending.intentId);
      confirmedEntry.status='held';confirmedEntry.pending=null;confirmedInput.pending=null;
      const proposal=preview(confirmedInput,pending.intentId,pending.action);
      if(proposal.blocked.length)return {node:input,duplicate:false,blocked:proposal.blocked};
      const reserved=input.book.entries.find(e=>e.id===pending.intentId).pending.cost;
      if(['scrap','parts'].some(k=>reserved[k]!==proposal.cost[k]))
        return {node:input,duplicate:false,blocked:[{kind:'submitted-cost-changed'}]};
      n.view=proposal.node.view;n.outcomes=proposal.node.outcomes;n.familyPlans=proposal.node.familyPlans;
      n.view.state.resources=payment.view.state.resources;
      for(const k of keys)n.accounting.paid[k]+=input.book.entries.find(e=>e.id===pending.intentId).pending.cost[k];
      if(['build','upgrade','dig'].includes(pending.action.kind))n.spent.push({id:pending.requestId,at:n.view.serverTime,cost:proposal.cost});
    }
    n.book=payment.book;n.pending=null;n.lastActionAt=n.view.serverTime;
    if(receipt.result==='confirmed'&&pending.intentId===n.existing?.material?.intentId&&pending.action.kind==='upgrade')
      n.existing.material.status='constructing';
    if(receipt.result==='confirmed'&&pending.action.kind==='assign'&&n.existing){
      const role=n.existing.roles.find(r=>r.intentId===pending.intentId&&r.residentId===pending.action.residentId);
      if(role&&pending.action.roomId!==role.roomId){
        role.status='completed';role.completedAt=n.view.serverTime;
        n.book=holds.release(n.view,n.book,pending.intentId,{complete:true,reason:'inherited role ended by confirmed simulated assignment'});
      }
      if(n.existing.swap?.intentId===pending.intentId)existing.syncSwap(n.view,n.existing,n.book,{confirmed:true});
    }
    refreshMaterials(n);
    n.events.push({kind:'action',at:n.view.serverTime,action:pending.action,result:receipt.result,requestId:pending.requestId});
    checkConservation(n);return {node:n,duplicate:false,blocked:[]};
  }
  function advanceInternal(input,to,{feedOwner=null,collect=false,stopAtEvent=false}={},owned=false) {
    if(input.model==='native-snapshot-first-action-only')throw Error('Unsettled native snapshot cannot be advanced as a simulated route');
    validate(input);let n=owned?input:structuredClone(input);const blocked=[];
    const metrics={ticks:0,minimumInventory:{...input.view.state.resources},unserved:zero(),roomOverflow:zero()};
    if(!Number.isSafeInteger(to)||to<n.view.serverTime||to>n.book.windowEnd||(to-n.view.serverTime)%tick!==0)throw Error('Invalid route horizon');
    if(n.pending)return {node:input,complete:false,blocked:[{kind:'pending-action-timing-unknown'}],metrics};
    const inherited=inheritedIssues(n,{advancing:true});if(inherited.length)return {node:input,complete:false,blocked:inherited,metrics};
    while(n.view.serverTime<to){
      const inherited=inheritedIssues(n,{advancing:true,nextAt:n.view.serverTime+tick});if(inherited.length){blocked.push(...inherited);break;}
      const report=holds.inspect(n.view,n.book);if(report.blocked.length){blocked.push(...report.blocked);break;}
      const familyIssues=familyCommitments(n);if(familyIssues.length){blocked.push(...familyIssues);break;}
      if((n.familyPlans??[]).some(p=>p.stage==='romance'||p.stage==='planned'&&p.parents.every(id=>
        n.view.state.residents.some(r=>r.id===id&&r.roomId===p.roomId)))){
        for(const [k,v] of Object.entries(committedFamilySupply(n)))if(v.deficit>1e-7||v.inventoryGap>1e-7)
          blocked.push({kind:'family-supply-not-covered',resource:k,...v});
        if(blocked.length)break;
      }
      const feed=manufacturing(n,feedOwner);if(feed.blocked.length){blocked.push(...feed.blocked);break;}
      const {floor,allowed,owner}=feed;
      const next=natural.advance(n.view,n.view.serverTime+tick,{assumptions:n.assumptions,outcomes:n.outcomes,
        familyPlans:n.familyPlans,familyRules:n.familyRules,moodRules:n.moodRules??null,xpRules:n.xpRules??null,scrapFloor:floor,collect});
      if(!next.complete){blocked.push(...next.blocked);break;}
      if(next.ledger.feed.scrap>allowed+1e-7)throw Error('Feed allowance exceeded');
      metrics.ticks++;
      for(const k of keys){metrics.minimumInventory[k]=Math.min(metrics.minimumInventory[k],next.ledger.minimumInventory[k]);
        metrics.unserved[k]+=next.ledger.unserved[k];metrics.roomOverflow[k]+=next.ledger.roomOverflow[k];}
      n.view=next.view;n.outcomes=next.outcomes;n.familyPlans=next.familyPlans;n.mood=next.mood;n.xp=next.xp;
      n.familyPauses??=[];n.familyPauses.push(...next.familyPauses);
      accumulate(n,next.ledger);n.events.push(...next.events);
      if(owner!==null)n.book=holds.consumeFeed(n.view,n.book,owner,next.ledger.feed.scrap);
      n.book=holds.reconcileEvents(n.view,n.book,next.events);
      if(n.existing)n.existing=existing.remap(n.existing,next.events);
      refreshMaterials(n);
      const after=holds.inspect(n.view,n.book);
      // Depletion and new adulthood are real state transitions, not silently undone to make a
      // route look feasible. Retain that state and its explicit failure for the route search.
      for(const k of ['power','food','water'])if(next.ledger.unserved[k]>1e-7||
        next.ledger.minimumInventory[k]+1e-7<2*resource.demand(n.view,n.view.serverTime)[k])
        blocked.push({kind:'supply-inventory-floor',resource:k});
      blocked.push(...after.blocked.filter(b=>b.kind!=='deadline'||n.view.serverTime<to));
      if(blocked.length||stopAtEvent&&next.events.length)break;
    }
    checkConservation(n);return {node:n,complete:n.view.serverTime===to&&!blocked.length,blocked,metrics};
  }
  const advance=(input,to,options)=>advanceInternal(input,to,options,false);
  // For the continuation interpreter's already private clone only. Avoid copying the
  // growing immutable event prefix on every ten-minute tick of a full-week projection.
  const advanceOwned=(input,to,options)=>advanceInternal(input,to,options,true);
  return {create,fromRuntime,reserve,amend,release,registerFamily,bindExistingFamily,bindExistingMaterials,nextExistingSwap,preview,submit,resolve,advance,advanceOwned,
    inspect:n=>({...holds.inspect(n.view,n.book),inherited:inheritedIssues(n)}),supply:n=>supply(n.view,n.book)};
}
