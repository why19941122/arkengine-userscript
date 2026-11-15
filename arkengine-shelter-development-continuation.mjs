import {createShelterRouteSimulation} from './arkengine-shelter-route-simulation.mjs';
import {createShelterDevelopmentCandidates} from './arkengine-shelter-development-candidates.mjs';
import {createShelterResourceSimulation} from './arkengine-shelter-resource-simulation.mjs';
import {createShelterReservations} from './arkengine-shelter-reservations.mjs';
import {createShelterExchangeCandidates} from './arkengine-shelter-exchange-candidates.mjs';
import {createShelterMaterialCandidates} from './arkengine-shelter-material-candidates.mjs';

// Conditional continuation interpreter, not the D.14 bounded-search selector or a live executor.
// Only its own modeled submissions receive simulated receipts. Native pending requests remain
// unresolved. Subsequent investments can be appended at any observed state, across action types.
export function createShelterDevelopmentContinuation() {
  const routes=createShelterRouteSimulation(),candidates=createShelterDevelopmentCandidates(),resources=createShelterResourceSimulation(),holds=createShelterReservations(),
    exchanges=createShelterExchangeCandidates(),materials=createShelterMaterialCandidates();
  const tick=600000,hour=3600000,keys=['power','food','water','scrap','parts','stimpak'];
  const production={power:'power',diner:'food',water:'water',scrap:'scrap',workshop:'parts',medbay:'stimpak'};
  const active=e=>!['complete','cancelled'].includes(e.status),id=n=>Number.isSafeInteger(n)&&n>0;
  const text=s=>typeof s==='string'&&s.trim().length>0;
  const usable=(r,at)=>r&&r.builtAt<=at&&r.upgradeAt===null&&!r.unpowered&&!r.incident;
  const zero=()=>Object.fromEntries(keys.map(k=>[k,0]));
  const signature=x=>JSON.stringify(x);
  const owner=(n,intentId)=>n.book.entries.find(e=>e.id===intentId&&active(e));
  const person=(n,residentId,from=n.view.serverTime)=>({residentId,from,until:n.book.windowEnd});
  const seat=(n,residentId,roomId,from=n.view.serverTime)=>({...person(n,residentId,from),roomId});
  const assignment=(n,residentId,roomId)=>({kind:'assign',residentId,fromRoomId:n.view.state.residents.find(p=>p.id===residentId)?.roomId,roomId});
  const contract=w=>JSON.stringify({key:w.key,candidateId:w.candidateId,kind:w.kind,intentId:w.intentId,
    createdAt:w.createdAt,deadline:w.deadline,residentId:w.residentId,stat:w.stat,base:w.base,
    parents:w.parents,childId:w.childId,staff:w.staff,project:w.project,material:w.material,binding:w.binding});
  const projectAction=w=>w.constructionAction??w.project;
  function materialSpec(state,w) {
    return {...w.material,project:{...w.material.project,roomId:w.projectRoomId},
      rooms:[...new Set(w.material.rooms.map(id=>remappedRoom(state,id)))],
      workers:w.material.workers.map(p=>({...p,workshopId:remappedRoom(state,p.workshopId),returnRoomId:remappedRoom(state,p.returnRoomId)}))};
  }
  const overlap=(a,b)=>a.from<b.until&&b.from<a.until;
  // These are capacity guarantees, not invented future residents or usable construction.
  // Family return seats are held conservatively until confirmed; child seats start no
  // earlier than the known pregnancy + childhood durations. They never produce income.
  function guarantees(state,node=state.node) {
    const claims=[],n=node,at=n.view.serverTime;
    for(const w of state.workflows)if(w.stage!=='done'){
      if(w.kind==='family')for(const d of w.destinations){
        if(w.returned.includes(d.residentId))continue;
        const child=d.residentId===w.childId,p=n.view.state.residents.find(p=>p.id===d.residentId);
        const from=child?Math.max(at,p?.adultAt??w.createdAt+n.familyRules.pregnancyMs+n.familyRules.childhoodMs):at;
        if(from<n.book.windowEnd)claims.push({...d,intentId:w.intentId,from,until:n.book.windowEnd,child});
      }
      if(w.material&&w.paidAt===null)for(const p of materialSpec(state,w).workers)if(!w.materialReturned.includes(p.residentId))
        claims.push({residentId:p.residentId,roomId:p.returnRoomId,intentId:w.intentId,from:at,until:n.book.windowEnd,child:false});
      if(w.kind==='project')for(const residentId of w.staff)if(!w.staffed.includes(residentId)){
        const from=Math.max(at,projectAction(w).finishAt??n.view.state.rooms.find(r=>r.id===w.projectRoomId)?.upgradeAt??at);
        if(from<n.book.windowEnd)claims.push({residentId,roomId:w.projectRoomId,intentId:w.intentId,from,until:n.book.windowEnd,child:false});
      }
    }
    return claims;
  }
  function futureIssues(state,node=state.node) {
    // A preview has proposed positions but intentionally has not reconciled imported
    // swap/role state yet. Check its capacity book here; validate actual nodes separately.
    const claims=guarantees(state,node),view=node.view,blocked=[],book=holds.inspect(view,node.book);
    for(const c of claims){
      const w=state.workflows.find(w=>w.intentId===c.intentId),p=view.state.residents.find(p=>p.id===c.residentId);
      let r=view.state.rooms.find(r=>r.id===c.roomId);
      if(!r&&w.kind==='project'&&w.stage==='first'&&w.project.kind==='build')
        r={...w.project,id:c.roomId,width:1,builtAt:w.project.finishAt,upgradeAt:null};
      if(!r||!production[r.type]||r.builtAt>c.from||r.upgradeAt!==null&&r.upgradeAt>c.from||r.unpowered||r.incident)
        blocked.push({kind:'future-seat-unavailable',...c});
      const maxHp=p?Math.round(100+Math.min(49,Math.floor(Math.sqrt(p.xp/3)))*(2+.5*p.stats.end)):Infinity;
      if(!c.child&&(!p||p.deadAt!==null||p.away!==null||p.adultAt>c.from||!Number.isFinite(p.hp)||p.hp<.6*maxHp))
        blocked.push({kind:'future-worker-unavailable',...c});
      if(book.people.some(q=>q.residentId===c.residentId&&q.intentId!==c.intentId&&overlap(c,q))||
        claims.some(q=>q!==c&&q.residentId===c.residentId&&q.intentId!==c.intentId&&overlap(c,q)))
        blocked.push({kind:'future-worker-conflict',...c});
      if(!r)continue;
      const others=[...claims,...book.seats].filter(q=>q.roomId===c.roomId&&overlap(c,q));
      const boundaries=new Set([c.from,...others.map(q=>Math.max(c.from,q.from)),
        ...view.state.residents.filter(p=>p.roomId===c.roomId&&p.adultAt>=c.from&&p.adultAt<c.until).map(p=>p.adultAt)]);
      for(const at of boundaries){
        const occupants=new Set(view.state.residents.filter(p=>p.roomId===c.roomId&&p.deadAt===null&&p.adultAt<=at).map(p=>p.id));
        for(const q of others)if(q.from<=at&&at<q.until)occupants.add(q.residentId);
        if(occupants.size>r.width*2){blocked.push({kind:'future-seat-capacity',roomId:r.id,at,used:occupants.size,capacity:r.width*2});break;}
      }
    }
    return blocked;
  }
  function projectStaffIssues(node,w) {
    if(w.kind!=='project'||!w.staff.length)return [];
    // A static admission check only: actual event, staffing and collection times are
    // still advanced below. No output from this hypothetical end state is booked.
    const projected=structuredClone(node),s=projected.view.state,r=s.rooms.find(r=>r.id===w.projectRoomId);
    if(!r)return [{kind:'future-project-room-missing'}];
    projected.view.serverTime=projectAction(w).finishAt??node.view.serverTime+w.material.durationMs;r.upgradeAt=null;
    if(w.project.kind==='upgrade')r.level=w.project.fromLevel+1;
    if(w.material&&w.paidAt===null)for(const p of w.material.workers){
      const worker=s.residents.find(q=>q.id===p.residentId);
      if(worker)worker.roomId=remappedRoom({node},p.returnRoomId);
    }
    for(const id of w.staff)s.residents.find(p=>p.id===id).roomId=r.id;
    return Object.entries(routes.supply(projected)).filter(([,v])=>v.deficit>1e-7)
      .map(([resource,value])=>({kind:'future-project-supply',resource,...value}));
  }
  function remappedRoom(state,roomId) {
    for(const e of state.node.events)if(e.kind==='merge'&&e.roomId===roomId)roomId=e.into;
    return roomId;
  }
  function employed(view,p) {
    const r=view.state.rooms.find(r=>r.id===p.roomId),at=view.serverTime;
    return p.deadAt===null&&p.away===null&&p.adultAt<=at&&!!production[r?.type]&&usable(r,at)&&
      view.state.residents.filter(q=>q.roomId===r.id&&q.deadAt===null&&q.away===null&&q.adultAt<=at)
        .slice(0,r.width*2).some(q=>q.id===p.id)&&resources.rate(view,r,at)>0;
  }
  function snapshot(state) {
    const n=state.node,v=n.view,s=v.state,supply=routes.supply(n),book=routes.inspect(n);
    const employedIds=s.residents.filter(p=>employed(v,p)).map(p=>p.id);
    const score=2*s.residents.filter(p=>p.deadAt===null).length+3*s.depth+s.rooms
      .filter(r=>r.builtAt<=v.serverTime&&!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
    const rates=zero();for(const r of s.rooms)if(production[r.type])rates[production[r.type]]+=resources.rate(v,r,v.serverTime);
    const g=state.goal,supplied=Object.values(supply).every(v=>v.deficit<1e-7&&v.inventoryGap<1e-7);
    const achieved=supplied&&(g.kind==='employment'?g.residentIds.every(id=>employedIds.includes(id)):
      g.kind==='stock'?book.free[g.resource]>=g.amount:g.kind==='supply'?rates[g.resource]>=g.rate&&s.resources[g.resource]>=g.inventory:null);
    return {at:v.serverTime,score,employedIds,rates,supply,inventory:{...s.resources},stored:resources.storedTotals(v),
      free:{...book.free},accounting:structuredClone(n.accounting),goalAchieved:g.kind==='unlock'?null:achieved,
      goalUnknown:g.kind==='unlock'?'score alone does not verify the promised functional unlock':null};
  }
  function mark(state) {
    for(const k of keys)state.metrics.minimumInventory[k]=Math.min(state.metrics.minimumInventory[k],state.node.view.state.resources[k]);
    const value=snapshot(state);if(value.goalAchieved)state.goalFirstAt??=value.at;
    for(const h of [24,72,168])if(value.at===state.origin.windowStart+h*hour)state.checkpoints[String(h)]=value;
    state.latest=value;
  }
  function validate(state) {
    if(state?.version!==1||!state.node||!state.origin||!Array.isArray(state.workflows)||!Array.isArray(state.history)||!Array.isArray(state.admissions)||
      state.node.book.windowEnd!==state.origin.windowEnd||state.node.book.startedAt!==state.origin.windowStart||
      !Number.isSafeInteger(state.sequence)||state.sequence<0||state.execution?.receipts!=='immediate-simulated'||
      state.execution?.collection!=='each-tick'||!text(state.execution.source)||
      new Set(state.workflows.map(w=>w.key)).size!==state.workflows.length||state.admissions.length!==state.workflows.length||
      state.admissions.some((a,i)=>a!==contract(state.workflows[i]))||state.sequence!==state.history.length||
      state.metrics?.ticks*tick!==state.node.view.serverTime-state.origin.from||
      !keys.every(k=>Number.isFinite(state.metrics?.minimumInventory?.[k])&&state.metrics.minimumInventory[k]>=0))
      throw Error('Invalid or reset continuation state');
    routes.inspect(state.node);
    if(state.origin.goal!==signature(state.goal))throw Error('Continuation changed its original goal');
    for(const h of state.history)if(!state.workflows.some(w=>w.key===h.workflow)||!state.node.book.receipts.some(r=>
      r.requestId===h.requestId&&r.result==='confirmed'&&r.at===h.at&&r.fingerprint===signature(h.action)))
      throw Error('Continuation action lost its receipt');
    for(const k of keys){const a=state.node.accounting;
      if(Math.abs(a.initial[k]+a.collected[k]-a.consumed[k]-a.feed[k]-a.paid[k]-state.node.view.state.resources[k])>1e-6)
        throw Error('Continuation inventory conservation failed');}
    for(const w of state.workflows){
      if(w.stage==='first'&&signature(w.first)!==signature(w.binding.firstAction)||
        w.stage!=='first'&&w.binding.firstAction&&!state.history.some(h=>h.workflow===w.key&&signature(h.action)===signature(w.binding.firstAction)))
        throw Error('Continuation first action was not confirmed');
      for(const field of ['returnRoomId','trainingRoomId','projectRoomId'])if(w.binding[field]!==undefined&&
        w[field]!==remappedRoom(state,w.binding[field]))throw Error('Continuation destination changed');
      if(w.binding.destinations&&signature(w.destinations)!==signature(w.binding.destinations.map(d=>({...d,roomId:remappedRoom(state,d.roomId)}))))
        throw Error('Continuation family destinations changed');
      if(w.moves){
        if(signature(w.moves)!==signature(w.binding.moves)||!Number.isInteger(w.exchangeStep)||w.exchangeStep<0||w.exchangeStep>w.moves.length)
          throw Error('Continuation exchange lost its original moves');
        const confirmed=state.history.filter(h=>h.workflow===w.key);
        if(confirmed.length!==w.exchangeStep||confirmed.some((h,i)=>signature(h.action)!==signature(w.moves[i])))
          throw Error('Continuation exchange progress disagrees with receipts');
        if(w.stage==='done'&&w.exchangeStep!==w.moves.length)throw Error('Continuation exchange finished too early');
      }
      if(w.material){
        const payments=state.history.filter(h=>h.workflow===w.key&&h.action.kind==='upgrade');
        if(payments.length>1||payments.length!==(w.paidAt===null?0:1)||payments.length&&
          (w.paidAt!==payments[0].at||signature(w.constructionAction)!==signature(payments[0].action)||
            w.constructionAction.finishAt!==w.paidAt+w.material.durationMs))throw Error('Material construction clock lost its payment');
        if(w.stage==='done'&&w.paidAt===null)throw Error('Material purpose finished without construction');
        const spec=materialSpec(state,w),returned=spec.workers.filter(p=>state.history.some(h=>h.workflow===w.key&&
          h.action.kind==='assign'&&h.action.residentId===p.residentId&&remappedRoom(state,h.action.fromRoomId)===p.workshopId&&
          remappedRoom(state,h.action.roomId)===p.returnRoomId)).map(p=>p.residentId).sort((a,b)=>a-b);
        if(signature([...w.materialReturned].sort((a,b)=>a-b))!==signature(returned))throw Error('Material return lost its receipt');
      }
      if(!text(w.key)||!['wait','assign','train','family','project'].includes(w.kind)||!text(w.stage)||
        w.deadline>state.origin.windowEnd||w.kind!=='wait'&&!state.node.book.entries.some(e=>e.id===w.intentId))
        throw Error('Continuation lost its commitment');
      if(w.kind==='train'&&(!id(w.residentId)||!id(w.returnRoomId)||!Number.isSafeInteger(w.deadline)||
        !state.node.view.state.residents.some(p=>p.id===w.residentId)||w.base<0||w.base>=10))
        throw Error('Invalid training continuation');
      if(w.stage==='done'&&(!Number.isSafeInteger(w.completedAt)||w.completedAt>w.deadline||w.ownsIntent&&owner(state.node,w.intentId)))
        throw Error('Continuation was not fulfilled');
      if(w.stage!=='done'&&w.kind!=='wait'&&!owner(state.node,w.intentId)&&
        !(w.kind==='assign'&&state.node.existing?.swap?.status==='complete')&&
        !(w.kind==='train'&&state.node.existing?.roles.some(r=>r.intentId===w.intentId&&r.status==='completed')))
        throw Error('Unfinished continuation lost its active reservation');
    }
  }
  function workflow(n,row,completion,key) {
    const w={key,candidateId:row.id,kind:row.kind,intentId:row.intentId??null,stage:'first',
      first:structuredClone(row.action??null),ownsIntent:!!row.intent,continuation:structuredClone(row.continuation),
      createdAt:n.view.serverTime,deadline:n.book.windowEnd};
    if(row.continuation?.kind==='exchange-sequence')Object.assign(w,{moves:structuredClone(row.continuation.moves),exchangeStep:0});
    if(row.kind==='train')Object.assign(w,{residentId:row.continuation.residentId,stat:row.continuation.stat,base:row.continuation.base,
      returnRoomId:row.continuation.roomId,trainingRoomId:row.action?.roomId??n.view.state.residents.find(p=>p.id===row.continuation.residentId).roomId,
      deadline:row.continuation.deadline,expectedReadyAt:row.continuation.readyAt});
    if(row.kind==='family'){
      w.familyKey=row.familyPlan.key;w.parents=[...row.continuation.parents];w.childId=row.continuation.childId;
      w.destinations=structuredClone(completion?.destinations??[]);w.returned=[];w.childReserved=false;
      const ids=[...w.parents,w.childId];
      if(w.destinations.length!==ids.length||new Set(w.destinations.map(x=>x.residentId)).size!==ids.length||
        w.destinations.some(x=>!ids.includes(x.residentId)||!id(x.roomId)||!n.view.state.rooms.some(r=>r.id===x.roomId&&production[r.type])))
        return {blocked:[{kind:'missing-family-employment-plan',residents:ids}]};
    }
    if(row.kind==='project'){
      if(row.continuation?.kind==='material-upgrade'){
        w.material=structuredClone(row.continuation.spec);w.materialReturned=[];w.materialChecks=[];w.paidAt=null;
      }
      w.project=structuredClone(w.material?.project??row.action);w.projectRoomId=w.project.roomId??w.project.elevatorId;
      const r=n.view.state.rooms.find(r=>r.id===w.projectRoomId);
      w.staff=structuredClone(completion?.staff??(w.project.kind==='upgrade'?n.view.state.residents
        .filter(p=>p.roomId===r?.id&&p.deadAt===null&&p.away===null&&p.adultAt<=n.view.serverTime).map(p=>p.id):[]));
      w.staffReserved=false;w.staffed=[];
      if(!Array.isArray(w.staff)||new Set(w.staff).size!==w.staff.length||w.staff.some(id=>!n.view.state.residents.some(p=>p.id===id)))
        throw Error('Project staff must bind observed residents');
      if(production[w.project.type??r?.type]&&!w.staff.length)return {blocked:[{kind:'missing-project-staff-plan'}]};
    }
    w.binding=Object.fromEntries(Object.entries({firstAction:structuredClone(w.first),returnRoomId:w.returnRoomId,trainingRoomId:w.trainingRoomId,projectRoomId:w.projectRoomId,
      destinations:w.destinations?structuredClone(w.destinations):undefined,moves:w.moves?structuredClone(w.moves):undefined}).filter(([,value])=>value!==undefined));
    return {workflow:w,blocked:[]};
  }
  function append(input,report,candidateId,{completion={}}={}) {
    validate(input);const state=structuredClone(input),n=state.node;
    if(signature(report.goal)!==signature(state.goal))throw Error('Continuation cannot silently change the common goal');
    if(state.workflows.some(w=>w.material&&w.stage!=='done'))return {state:input,accepted:false,blocked:[{kind:'material-purpose-in-progress'}]};
    if(state.workflows.some(w=>w.moves&&w.stage!=='done'))return {state:input,accepted:false,blocked:[{kind:'exchange-sequence-in-progress'}]};
    if(state.workflows.some(w=>w.stage==='first'&&w.first))return {state:input,accepted:false,blocked:[{kind:'unsubmitted-first-action'}]};
    if(state.workflows.some(w=>w.stage!=='done'&&w.candidateId===candidateId))throw Error('Candidate continuation already active');
    const row=Object.values(report.groups).flat().find(p=>p.id===candidateId);
    if(!row)throw Error('Unknown first action');
    const ready=candidates.prepareFirst(n,report,candidateId);
    if(!ready.accepted)return {state:input,accepted:false,blocked:ready.blocked};
    const compiled=workflow(n,row,completion,'workflow:'+state.workflows.length);
    if(compiled.blocked.length)return {state:input,accepted:false,blocked:compiled.blocked};
    state.node=ready.node;state.workflows.push(compiled.workflow);state.admissions.push(contract(compiled.workflow));state.blocked=[];
    const proposal=row.action?routes.preview(state.node,row.intentId,row.action):{node:state.node,blocked:[]};
    const blocked=[...proposal.blocked,...futureIssues(state,proposal.node??state.node),
      ...projectStaffIssues(proposal.node??state.node,compiled.workflow)];
    if(compiled.workflow.moves){
      // Protect already admitted family/project guarantees throughout the exchange,
      // rather than finding a future-seat collision after its first displacement.
      const full=exchanges.check(state.node,row,{inspectNode:node=>futureIssues({...state,node})});
      blocked.push(...full.blocked);
    }
    if(compiled.workflow.kind==='project'&&compiled.workflow.staff.length&&compiled.workflow.project.finishAt>=n.book.windowEnd)
      blocked.push({kind:'project-staff-outside-window'});
    if(blocked.length)return {state:input,accepted:false,blocked};
    validate(state);mark(state);return {state,accepted:true,blocked:[]};
  }
  function start(n,report,candidateId,{execution,completion={}}={}) {
    if(execution?.receipts!=='immediate-simulated'||execution?.collection!=='each-tick'||!text(execution.source))
      throw Error('Explicit conditional receipt and collection assumptions required');
    const state={version:1,node:structuredClone(n),goal:structuredClone(report.goal),execution:structuredClone(execution),
      origin:{basis:signature(n),goal:signature(report.goal),from:n.view.serverTime,windowStart:n.book.startedAt,windowEnd:n.book.windowEnd},
      workflows:[],admissions:[],history:[],sequence:0,blocked:[],goalFirstAt:null,checkpoints:{},
      metrics:{ticks:0,minimumInventory:{...n.view.state.resources},unserved:zero(),roomOverflow:zero()}};
    const result=append(state,report,candidateId,{completion});if(result.accepted)result.state.firstCandidate={id:candidateId,kind:result.state.workflows[0].kind};
    return result;
  }
  function updateClaims(state,w,residentId,roomId,{from=state.node.view.serverTime,remove=false}={}) {
    const n=state.node,e=owner(n,w.intentId);if(!e)return [{kind:'continuation-reservation-ended'}];
    const people=e.people.filter(c=>c.residentId!==residentId),seats=e.seats.filter(c=>c.residentId!==residentId);
    if(!remove){people.push(person(n,residentId,from));seats.push(seat(n,residentId,roomId,from));}
    const amended=routes.amend(n,w.intentId,{people,seats});if(!amended.accepted)return amended.blocked;
    state.node=amended.node;return [];
  }
  function finish(state,w) {
    if(w.ownsIntent&&owner(state.node,w.intentId))state.node=routes.release(state.node,w.intentId,{complete:true,reason:'conditional continuation fulfilled'});
    w.stage='done';w.completedAt=state.node.view.serverTime;
  }
  function next(state,w) {
    const n=state.node,at=n.view.serverTime,s=n.view.state;
    if(w.stage==='done')return {};
    if(w.stage==='first'){
      if(w.first)return {action:w.first,after:'first'};
      if(w.kind==='wait'){finish(state,w);return {};}
      w.stage=w.material?'materials':w.kind==='train'?'training':w.kind==='family'?'parents':w.kind==='project'?'construction':'running';
    }
    if(w.material&&w.paidAt===null){
      const spec=materialSpec(state,w),updated=materials.refresh(state.node,w.intentId,spec);
      if(!updated.accepted)return {blocked:updated.blocked};state.node=updated.node;w.materialStatus=updated.material;
      const check={at,...structuredClone(updated.material),feedSpent:owner(state.node,w.intentId).feedSpent,
        returned:[...w.materialReturned]};
      if(signature(w.materialChecks.at(-1))!==signature(check))w.materialChecks.push(check);
      if(!updated.material.partsReady)return {};
      w.stage='material-return';
      for(const p of spec.workers)if(!w.materialReturned.includes(p.residentId)){
        const actual=state.node.view.state.residents.find(r=>r.id===p.residentId);
        if(actual?.roomId!==p.workshopId)return {blocked:[{kind:'material-worker-position-changed',residentId:p.residentId}]};
        const blocked=updateClaims(state,w,p.residentId,p.returnRoomId);if(blocked.length)return {blocked};
        return {action:assignment(state.node,p.residentId,p.returnRoomId),after:'material-return'};
      }
      if(!updated.material.ready){w.stage='material-capital';return {};}
      const action={...w.project,roomId:w.projectRoomId,finishAt:at+w.material.durationMs};
      if(action.finishAt>=state.origin.windowEnd)return {blocked:[{kind:'material-construction-outside-window',finishAt:action.finishAt}]};
      return {action,after:'material-payment'};
    }
    if(w.kind==='assign'){
      if(w.moves){
        if(w.exchangeStep===w.moves.length){finish(state,w);return {};}
        const action=w.moves[w.exchangeStep],ready=exchanges.stage(n,w.intentId,action);
        if(!ready.accepted)return {blocked:ready.blocked};state.node=ready.node;
        return {action,after:'exchange-move'};
      }
      if(w.continuation.kind==='inherited-swap'){
        if(n.existing.swap.status==='complete'){finish(state,w);return {};}
        const r=routes.nextExistingSwap(n);return {action:r.action,blocked:r.blocked.filter(b=>b.kind!=='action-cadence'),after:'swap'};
      }
      finish(state,w);return {};
    }
    if(w.kind==='train'){
      const p=s.residents.find(p=>p.id===w.residentId);
      if(p.roomId!==w.trainingRoomId&&p.roomId!==w.returnRoomId)return {blocked:[{kind:'training-position-changed',residentId:p.id}]};
      if(p.roomId===w.returnRoomId&&employed(n.view,p)){finish(state,w);return {};}
      if(p.stats[w.stat]>w.base||at>=w.deadline){
        w.returnReason=p.stats[w.stat]>w.base?'stat-complete':'deadline';
        if(w.ownsIntent){const blocked=updateClaims(state,w,p.id,w.returnRoomId);if(blocked.length)return {blocked};}
        return {action:assignment(state.node,p.id,w.returnRoomId),after:'training-return'};
      }
      return {};
    }
    if(w.kind==='family'){
      const plan=n.familyPlans.find(p=>p.key===w.familyKey);
      if(!plan)return {blocked:[{kind:'missing-family-continuation'}]};
      if(['planned','romance'].includes(plan.stage)){
        const p=w.parents.map(id=>s.residents.find(p=>p.id===id)).find(p=>p.roomId!==plan.roomId);
        return p?{action:{...assignment(n,p.id,plan.roomId),familyKey:plan.key},after:'parent-arrive'}:{};
      }
      if(!['pregnant','born'].includes(plan.stage))return {blocked:[{kind:'family-continuation-state-changed'}]};
      for(const id of w.parents)if(!w.returned.includes(id)){
        const dest=w.destinations.find(d=>d.residentId===id).roomId,p=s.residents.find(p=>p.id===id);
        if(p.roomId===dest){w.returned.push(id);const blocked=updateClaims(state,w,id,dest,{remove:true});if(blocked.length)return {blocked};continue;}
        const blocked=updateClaims(state,w,id,dest);if(blocked.length)return {blocked};
        return {action:assignment(state.node,id,dest),after:'parent-return'};
      }
      const child=s.residents.find(p=>p.id===w.childId);if(!child)return {};
      if(child.adultAt>=state.origin.windowEnd){w.outsideWindow='child-employment';return {};}
      const dest=w.destinations.find(d=>d.residentId===child.id).roomId;
      if(!w.childReserved){const blocked=updateClaims(state,w,child.id,dest,{from:Math.max(at,child.adultAt)});
        if(blocked.length)return {blocked};w.childReserved=true;}
      if(at<child.adultAt)return {};
      if(child.roomId===dest&&employed(n.view,child)){finish(state,w);return {};}
      return {action:assignment(state.node,child.id,dest),after:'child-job'};
    }
    if(w.kind==='project'){
      const r=s.rooms.find(r=>r.id===w.projectRoomId);
      if(w.project.kind==='dig'&&s.depth<w.project.floor)return {};
      if(w.project.kind!=='dig'&&(!r||r.builtAt>at||r.upgradeAt!==null))return {};
      if(r&&(!usable(r,at)||w.project.kind==='upgrade'&&r.level<w.project.fromLevel+1))return {blocked:[{kind:'project-not-operational'}]};
      for(const id of w.staff)if(!w.staffed.includes(id)){
        const p=s.residents.find(p=>p.id===id);
        if(p.roomId===w.projectRoomId&&employed(n.view,p)){w.staffed.push(id);continue;}
        const blocked=updateClaims(state,w,id,w.projectRoomId);if(blocked.length)return {blocked};
        return {action:assignment(state.node,id,w.projectRoomId),after:'project-staff'};
      }
      finish(state,w);return {};
    }
    return {};
  }
  function afterAction(state,w,task) {
    const at=state.node.view.serverTime;
    if(task.after==='first'){
      w.first=null;w.stage=w.material?'materials':w.kind==='train'?'training':w.kind==='family'?'parents':w.kind==='project'?'construction':'running';
      if(w.moves)w.exchangeStep=1;
      if(w.kind==='assign'&&w.continuation.kind!=='inherited-swap'&&!w.moves)finish(state,w);
      if(w.kind==='project'&&!w.material&&w.staff.length){
        const e=owner(state.node,w.intentId),from=w.project.finishAt;
        if(from>=state.origin.windowEnd)return [{kind:'project-staff-outside-window'}];
        const result=routes.amend(state.node,w.intentId,{people:[...e.people,...w.staff.map(id=>person(state.node,id,from))],
          seats:[...e.seats,...w.staff.map(id=>seat(state.node,id,w.projectRoomId,from))]});
        if(!result.accepted)return result.blocked;state.node=result.node;w.staffReserved=true;
      }
    }
    if(task.after==='material-return'){
      w.materialReturned.push(task.action.residentId);
      if(!w.staff.includes(task.action.residentId)){
        const blocked=updateClaims(state,w,task.action.residentId,task.action.roomId,{remove:true});if(blocked.length)return blocked;
      }
    }
    if(task.after==='material-payment'){
      w.paidAt=at;w.constructionAction=structuredClone(task.action);w.stage='construction';
      const from=task.action.finishAt;
      const result=routes.amend(state.node,w.intentId,{resources:{},feedScrap:0,
        people:w.staff.map(id=>person(state.node,id,from)),seats:w.staff.map(id=>seat(state.node,id,w.projectRoomId,from))});
      if(!result.accepted)return result.blocked;state.node=result.node;w.staffReserved=true;
    }
    if(task.after==='training-return'){w.returnedAt=at;finish(state,w);}
    if(task.after==='parent-return'){
      w.returned.push(task.action.residentId);
      const blocked=updateClaims(state,w,task.action.residentId,task.action.roomId,{remove:true});if(blocked.length)return blocked;
    }
    if(task.after==='child-job'){w.childEmployedAt=at;finish(state,w);}
    if(task.after==='project-staff')w.staffed.push(task.action.residentId);
    if(task.after==='exchange-move'){w.exchangeStep++;if(w.exchangeStep===w.moves.length)finish(state,w);}
    return [];
  }
  function remap(state,events) {
    for(const e of events)if(e.kind==='merge')for(const w of state.workflows){
      for(const field of ['returnRoomId','trainingRoomId','projectRoomId'])if(w[field]===e.roomId)w[field]=e.into;
      for(const d of w.destinations??[])if(d.roomId===e.roomId)d.roomId=e.into;
    }
  }
  function advance(input,to,{maxTicks=1008,stopAtDecision=false,collectTrajectory=false}={}) {
    validate(input);
    if(!Number.isSafeInteger(to)||to<input.node.view.serverTime||to>input.origin.windowEnd||
      (to-input.node.view.serverTime)%tick!==0||!Number.isInteger(maxTicks)||maxTicks<1||maxTicks>1008||typeof stopAtDecision!=='boolean'||typeof collectTrajectory!=='boolean')
      throw Error('Invalid continuation horizon or tick budget');
    const state=structuredClone(input);state.blocked=[];let ticks=0,decision=false;
    const trajectory=[];
    const record=(minimum=null)=>{if(collectTrajectory){const value=structuredClone(state.latest);
      value.minimumInventory=minimum?structuredClone(minimum):{...value.inventory};
      value.recoveringSupply=state.node.view.state.rooms.filter(r=>r.upgradeAt!==null)
        .map(r=>({power:'power',diner:'food',water:'water'})[r.type]).filter(Boolean);
      if(trajectory.at(-1)?.at===value.at)for(const k of keys)
        value.minimumInventory[k]=Math.min(value.minimumInventory[k],trajectory.at(-1).minimumInventory[k]);
      if(trajectory.at(-1)?.at===value.at)trajectory[trajectory.length-1]=value;else trajectory.push(value);}};
    record();
    while(true){
      const n=state.node,at=n.view.serverTime;
      if(n.pending||n.existing?.native.length){state.blocked=[{kind:'original-request-outcome-unknown'}];break;}
      state.blocked=futureIssues(state);if(state.blocked.length)break;
      if(at<state.origin.windowEnd){
        let acted=false;
        for(const w of state.workflows){
          const exchange=state.workflows.find(w=>w.moves&&w.stage!=='done');
          if(exchange&&w!==exchange)continue;
          const task=next(state,w);
          if(task.blocked?.length){state.blocked=task.blocked;break;}
          if(!task.action)continue;
          // Pure completion may run at the same timestamp; a second action may not.
          if(state.node.lastActionAt!==null&&at<state.node.lastActionAt+tick)continue;
          const proposal=routes.preview(state.node,w.intentId,task.action);
          state.blocked=[...proposal.blocked,...futureIssues(state,proposal.node??state.node),
            ...(task.after==='material-payment'?projectStaffIssues(proposal.node??state.node,w):[])];
          if(state.blocked.length)break;
          const requestId='continuation:'+state.sequence+':'+at;
          const submitted=routes.submit(state.node,w.intentId,task.action,requestId);
          if(!submitted.accepted){state.blocked=submitted.blocked;break;}
          const p=submitted.node.pending,confirmation=routes.resolve(submitted.node,
            {requestId,intentId:w.intentId,fingerprint:p.fingerprint,at,result:'confirmed'});
          if(confirmation.blocked.length){state.node=submitted.node;state.blocked=confirmation.blocked;break;}
          state.node=confirmation.node;state.sequence++;state.history.push({at,workflow:w.key,action:task.action,requestId});
          state.blocked=afterAction(state,w,task);acted=true;mark(state);record();break;
        }
        if(state.blocked.length)break;
        if(acted)continue;
      }
      mark(state);record();
      if(at===to)break;
      if(ticks>=maxTicks){state.blocked=[{kind:'continuation-tick-budget'}];break;}
      for(const w of state.workflows)if(w.kind==='train'&&w.stage!=='done'&&w.deadline>at&&w.deadline<at+tick)
        state.blocked.push({kind:'training-deadline-boundary',deadline:w.deadline,nextAt:at+tick});
      if(state.blocked.length)break;
      const material=state.workflows.find(w=>w.material&&w.stage!=='done');
      const eventCount=state.node.events.length,step=routes.advanceOwned(state.node,at+tick,{collect:true,feedOwner:material?.intentId??null});
      state.node=step.node;ticks+=step.metrics.ticks;state.metrics.ticks+=step.metrics.ticks;
      for(const k of keys){state.metrics.minimumInventory[k]=Math.min(state.metrics.minimumInventory[k],step.metrics.minimumInventory[k]);
        state.metrics.unserved[k]+=step.metrics.unserved[k];state.metrics.roomOverflow[k]+=step.metrics.roomOverflow[k];}
      const events=state.node.events.slice(eventCount);remap(state,events);mark(state);record(step.metrics.minimumInventory);
      if(!step.complete){state.blocked=step.blocked;break;}
      if(stopAtDecision&&events.some(e=>['adult','birth','build','upgrade','training','production-modifier-end'].includes(e.kind))){decision=true;break;}
    }
    validate(state);
    return {state,complete:state.node.view.serverTime===to&&!state.blocked.length,decisionRequired:decision,
      blocked:state.blocked,requestedTo:to,ticks,...(collectTrajectory?{trajectory}:{})};
  }
  function report(state) {
    validate(state);const current=snapshot(state),finished=state.node.view.serverTime===state.origin.windowEnd&&!state.blocked.length;
    const workflowIntents=new Set(state.workflows.map(w=>w.intentId));
    const unfinished=state.workflows.filter(w=>w.stage!=='done').map(w=>
      ({kind:w.kind,intentId:w.intentId,stage:w.stage,deadline:w.deadline,outsideWindow:w.outsideWindow??null}));
    unfinished.push(...state.node.book.entries.filter(e=>active(e)&&!workflowIntents.has(e.id)).map(e=>
      ({kind:'existing-commitment',intentId:e.id,stage:e.status,deadline:e.deadline,purpose:e.purpose})));
    if(state.node.existing?.native.length)unfinished.push({kind:'original-native-request',stage:'unknown',count:state.node.existing.native.length});
    const obligationsFulfilled=unfinished.length===0&&!state.node.pending;
    return {kind:'conditional-development-continuation',firstCandidate:state.firstCandidate,goal:state.goal,
      from:state.origin.from,windowStart:state.origin.windowStart,windowEnd:state.origin.windowEnd,evaluatedUntil:current.at,
      complete:finished&&obligationsFulfilled&&current.goalAchieved===true,
      simulationComplete:finished,obligationsFulfilled,
      firstAdmitted:!!state.firstCandidate,blocked:structuredClone(state.blocked),goalFirstAt:state.goalFirstAt,goalAtEnd:current.goalAchieved,
      checkpoints:structuredClone(state.checkpoints),ending:current,metrics:structuredClone(state.metrics),
      futureSeats:guarantees(state),actions:structuredClone(state.history),unfinished,
      materials:state.workflows.filter(w=>w.material).map(w=>({intentId:w.intentId,purpose:structuredClone(w.material),
        stage:w.stage,paidAt:w.paidAt,finishAt:w.constructionAction?.finishAt??null,returned:[...w.materialReturned],
        checks:structuredClone(w.materialChecks)})),
      selected:null,limitations:['Explicit chosen continuations, not bounded search or a winning complete strategy.',
        'Immediate simulated receipts and one action per ten-minute tick; no native account evidence.',
        'Future family seats are conservatively protected until confirmed; admission staffing is rechecked at execution.',
        'Subsequent investment choices are explicit appends; an unmodeled event stops the actual prefix.']};
  }
  return {start,append,advance,report};
}
