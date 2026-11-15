// Shared commitments for offline D.14 route states. No browser storage, requests or account
// mutations. Money is held, not paid, until a caller supplies a bound simulated outcome.
// The runtime adapter must retain its existing request/receipt proofs before using this model.
export function createShelterReservations() {
  const resources=['power','food','water','scrap','parts','stimpak'];
  const id=n=>Number.isSafeInteger(n)&&n>0;
  const at=n=>Number.isSafeInteger(n)&&n>=0;
  const amount=n=>Number.isFinite(n)&&n>=0;
  const label=s=>typeof s==='string'&&s.length>0&&s.length<=160;
  const zero=()=>Object.fromEntries(resources.map(k=>[k,0]));
  const active=e=>!['cancelled','complete'].includes(e.status);
  const familyKey=p=>[...p].sort((a,b)=>a-b).join('/');
  const span=c=>at(c.from)&&at(c.until)&&c.until>c.from;
  const overlaps=(a,b)=>a.from<b.until&&b.from<a.until;
  const normalize=x=>Object.fromEntries(resources.map(k=>[k,x?.[k]??0]));
  function validate(book,view) {
    if(book?.version!==1||!id(book.vaultNo)||view.vaultNo!==book.vaultNo||!at(book.startedAt)||!at(book.windowEnd)||
      book.windowEnd<=book.startedAt||book.windowEnd-book.startedAt>168*3600000||!Array.isArray(book.entries)||!Array.isArray(book.receipts)||!at(view.serverTime)||
      !resources.every(k=>amount(book.safety?.[k])&&amount(view.state.resources?.[k])))throw Error('Invalid reservation account');
    if(new Set(book.entries.map(e=>e.id)).size!==book.entries.length)throw Error('Duplicate reservation identity');
    for(const e of book.entries){
      if(!label(e.id)||!label(e.purpose)||!['held','submitted','cancelled','complete'].includes(e.status)||
        !at(e.at)||!at(e.deadline)||e.deadline<=e.at||e.deadline>book.windowEnd||
        !resources.every(k=>amount(e.resources?.[k])&&amount(e.paid?.[k]))||!amount(e.feedScrap)||!amount(e.feedSpent)||
        !Array.isArray(e.people)||!Array.isArray(e.seats)||!Array.isArray(e.families))throw Error('Invalid reservation entry');
      for(const c of [...e.people,...e.seats])if(!id(c.residentId)||!span(c)||c.from<book.startedAt||c.until>book.windowEnd||
        e.seats.includes(c)&&!id(c.roomId))throw Error('Invalid reservation interval');
      for(const f of e.families)if(!Array.isArray(f.parents)||f.parents.length!==2||!f.parents.every(id)||f.parents[0]===f.parents[1]||
        !(f.dueAt===null||at(f.dueAt))||!(f.childId===null||id(f.childId)))throw Error('Invalid family reservation');
      if(e.status==='submitted'&&(!e.pending||!label(e.pending.id)||!label(e.pending.fingerprint)||
        !at(e.pending.at)||!resources.every(k=>amount(e.pending.cost?.[k]))))throw Error('Invalid pending reservation');
      if(e.status!=='submitted'&&e.pending!==null)throw Error('Unexpected pending reservation');
    }
    if(new Set(book.receipts.map(r=>r.requestId)).size!==book.receipts.length||book.receipts.some(r=>!label(r.requestId)||
      !label(r.intentId)||!label(r.fingerprint)||!at(r.at)||!['confirmed','rejected'].includes(r.result)))
      throw Error('Invalid reservation receipts');
  }
  function create(view,{safety={},windowEnd}={}) {
    const book={version:1,vaultNo:view.vaultNo,startedAt:view.serverTime,windowEnd,safety:normalize(safety),entries:[],receipts:[]};
    validate(book,view);return book;
  }
  function inspect(view,book,{owner=null}={}) {
    validate(book,view);const now=view.serverTime,held=book.entries.filter(active),blocked=[];
    const direct=zero(),others=zero();let feed=0,otherFeed=0;
    for(const e of held){
      for(const k of resources){direct[k]+=e.resources[k];if(e.id!==owner)others[k]+=e.resources[k];}
      feed+=e.feedScrap;if(e.id!==owner)otherFeed+=e.feedScrap;
      if(e.deadline<=now)blocked.push({kind:'deadline',intentId:e.id,pending:e.status==='submitted'});
    }
    const free=zero(),ownSpendable=zero();
    for(const k of resources){
      free[k]=view.state.resources[k]-book.safety[k]-direct[k]-(k==='scrap'?feed:0);
      // Own construction allocation is usable; its separately promised feed still is not.
      ownSpendable[k]=view.state.resources[k]-book.safety[k]-others[k]-(k==='scrap'?feed:0);
      if(free[k]<-1e-7)blocked.push({kind:'material-deficit',resource:k,amount:-free[k]});
    }
    const people=held.flatMap(e=>e.people.filter(c=>c.until>now||e.status==='submitted').map(c=>({...c,intentId:e.id,pending:e.status==='submitted'})));
    // A pending intent keeps outsiders from taking its resident, but its own sequential
    // stages are not simultaneous assignments. The route cannot advance while unresolved.
    for(let i=0;i<people.length;i++)for(let j=0;j<i;j++)if(people[i].residentId===people[j].residentId&&
      (overlaps(people[i],people[j])||people[i].intentId!==people[j].intentId&&(people[i].pending||people[j].pending)))
      blocked.push({kind:'resident-conflict',residentId:people[i].residentId,intents:[people[j].intentId,people[i].intentId]});
    for(const c of people){
      const p=view.state.residents.find(p=>p.id===c.residentId);
      if(!p||p.deadAt!==null||p.away!==null||p.adultAt>c.from)blocked.push({kind:'resident-unavailable',intentId:c.intentId,residentId:c.residentId});
    }
    const seats=held.flatMap(e=>e.seats.filter(c=>c.until>now||e.status==='submitted').map(c=>({...c,intentId:e.id,pending:e.status==='submitted'})));
    for(let i=0;i<seats.length;i++)for(let j=0;j<i;j++)if(seats[i].residentId===seats[j].residentId&&
      (overlaps(seats[i],seats[j])||seats[i].intentId!==seats[j].intentId&&(seats[i].pending||seats[j].pending)))
      blocked.push({kind:'resident-seat-conflict',residentId:seats[i].residentId,intents:[seats[j].intentId,seats[i].intentId]});
    for(const c of seats){
      if(!people.some(p=>p.intentId===c.intentId&&p.residentId===c.residentId&&p.from<=c.from&&p.until>=c.until))
        blocked.push({kind:'seat-without-resident',intentId:c.intentId,residentId:c.residentId});
      const r=view.state.rooms.find(r=>r.id===c.roomId);
      if(!r||r.builtAt>c.from||r.upgradeAt!==null&&r.upgradeAt>c.from||r.incident||r.unpowered)
        blocked.push({kind:'seat-unavailable',intentId:c.intentId,roomId:c.roomId});
    }
    for(const roomId of new Set(seats.map(c=>c.roomId))){
      const r=view.state.rooms.find(r=>r.id===roomId);if(!r)continue;
      const claims=seats.filter(c=>c.roomId===roomId),boundaries=new Set([now,...claims.map(c=>Math.max(now,c.from)),
        ...view.state.residents.filter(p=>p.roomId===roomId&&p.adultAt>now).map(p=>p.adultAt)]);
      for(const t of boundaries){
        const current=claims.filter(c=>c.pending||c.from<=t&&t<c.until);if(!current.length)continue;
        // A planned departure never frees a real seat. Only an applied move updates roomId.
        // Away residents retain recorded occupancy, and one's own return is counted once.
        const occupants=new Set(view.state.residents.filter(p=>p.deadAt===null&&p.roomId===roomId&&p.adultAt<=t).map(p=>p.id));
        for(const c of current)occupants.add(c.residentId);
        if(occupants.size>r.width*2)blocked.push({kind:'seat-capacity',roomId,at:t,used:occupants.size,capacity:r.width*2});
      }
    }
    const families=held.flatMap(e=>e.families.map(f=>({...f,intentId:e.id}))),births=view.state.births,extra=new Set();
    const familyOwners=new Map(),parentOwners=new Map();
    for(const f of families){
      const key=familyKey(f.parents);
      if(f.parents.some(id=>!view.state.residents.some(p=>p.id===id)))blocked.push({kind:'unknown-family-parents',intentId:f.intentId});
      if(familyOwners.has(key))blocked.push({kind:'family-conflict',parents:f.parents,intents:[familyOwners.get(key),f.intentId]});
      familyOwners.set(key,f.intentId);
      if(f.childId===null)for(const id of f.parents){
        if(parentOwners.has(id))blocked.push({kind:'family-parent-conflict',residentId:id,intents:[parentOwners.get(id),f.intentId]});
        parentOwners.set(id,f.intentId);
      }
      if(f.childId!==null){
        const p=view.state.residents.find(p=>p.id===f.childId);
        if(!p||!Array.isArray(p.parents)||familyKey(p.parents)!==key)blocked.push({kind:'unknown-family-child',intentId:f.intentId});
      }else if(f.dueAt!==null){
        if(!births.some(b=>b.dueAt===f.dueAt&&familyKey(b.parents??[])===key))blocked.push({kind:'unknown-family-birth',intentId:f.intentId});
      }else if(births.some(b=>familyKey(b.parents??[])===key))blocked.push({kind:'family-transition-unreconciled',intentId:f.intentId});
      else extra.add(key);
    }
    // Existing romance and an explicit planned reservation for the same parents count once.
    for(const p of view.state.residents)if(p.romance?.partnerId){
      const pair=[p.id,p.romance.partnerId],key=familyKey(pair);
      if(!births.some(b=>familyKey(b.parents??[])===key))extra.add(key);
    }
    const capacity=Math.min(200,view.state.rooms.filter(r=>r.type==='quarters'&&r.builtAt<=now)
      .reduce((n,r)=>n+r.width*(2+2*r.level),0));
    const population=view.state.residents.length+births.length+extra.size;
    if(families.length&&population>capacity)blocked.push({kind:'beds',used:population,capacity});
    return {free,ownSpendable,direct,feedScrap:feed,otherFeedScrap:otherFeed,people,seats,population,capacity,blocked,
      expired:held.filter(e=>e.deadline<=now).map(e=>e.id)};
  }
  function reserve(view,input,intent) {
    validate(input,view);const book=structuredClone(input);
    if(book.entries.some(e=>e.id===intent.id))throw Error('Reservation identity already used');
    if(view.serverTime>=book.windowEnd)throw Error('Reservation window expired');
    const e={id:intent.id,purpose:intent.purpose,at:view.serverTime,deadline:intent.deadline??book.windowEnd,status:'held',
      people:structuredClone(intent.people??[]),seats:structuredClone(intent.seats??[]),families:structuredClone(intent.families??[]),
      resources:normalize(intent.resources),feedScrap:intent.feedScrap??0,paid:zero(),feedSpent:0,pending:null};
    if([...e.people,...e.seats].some(c=>c.from<view.serverTime))throw Error('Reservation starts before snapshot');
    book.entries.push(e);const report=inspect(view,book);
    return report.blocked.length?{book:input,accepted:false,report}:{book,accepted:true,report};
  }
  function release(view,input,intentId,{complete=false,reason}={}) {
    validate(input,view);const book=structuredClone(input),e=book.entries.find(e=>e.id===intentId);
    if(!e||!active(e)||!label(reason))throw Error('Unknown reservation or missing release reason');
    if(e.status==='submitted')throw Error('Pending action must be reconciled before release');
    e.status=complete?'complete':'cancelled';e.releasedAt=view.serverTime;e.releaseReason=reason;
    return book;
  }
  function amend(view,input,intentId,changes) {
    validate(input,view);const book=structuredClone(input),e=book.entries.find(e=>e.id===intentId);
    if(!e||e.status!=='held'||e.deadline<=view.serverTime||!changes||Object.keys(changes)
      .some(k=>!['people','seats','families','resources','feedScrap'].includes(k)))throw Error('Invalid commitment amendment');
    for(const [key,value] of Object.entries(changes))e[key]=key==='resources'?normalize(value):structuredClone(value);
    const report=inspect(view,book);
    return report.blocked.length?{book:input,accepted:false,report}:{book,accepted:true,report};
  }
  function submit(view,input,intentId,{requestId,fingerprint,cost={}}) {
    validate(input,view);const book=structuredClone(input),e=book.entries.find(e=>e.id===intentId),payment=normalize(cost);
    if(!e||e.status!=='held'||book.entries.some(e=>e.status==='submitted')||!label(requestId)||!label(fingerprint)||
      book.receipts.some(r=>r.requestId===requestId)||!resources.every(k=>amount(payment[k])&&payment[k]<=e.resources[k]))
      throw Error('Invalid submission or unreserved cost');
    const report=inspect(view,book,{owner:intentId});
    if(report.blocked.length||resources.some(k=>payment[k]>report.ownSpendable[k]+1e-7))
      return {book:input,accepted:false,report};
    e.status='submitted';e.pending={id:requestId,fingerprint,at:view.serverTime,cost:payment};
    return {book,accepted:true,report};
  }
  function resolve(view,input,intentId,receipt) {
    validate(input,view);const book=structuredClone(input),e=book.entries.find(e=>e.id===intentId),p=e?.pending;
    const prior=book.receipts.find(r=>r.requestId===receipt?.requestId);
    if(prior){
      if(JSON.stringify(prior)!==JSON.stringify(receipt)||prior.intentId!==intentId)throw Error('Conflicting duplicate receipt');
      return {view,book:input,duplicate:true};
    }
    if(!p||receipt?.intentId!==intentId||receipt.requestId!==p.id||receipt.fingerprint!==p.fingerprint||
      !['confirmed','rejected','unknown'].includes(receipt.result)||!at(receipt.at)||receipt.at<p.at||receipt.at>view.serverTime)
      throw Error('Receipt does not bind pending action');
    if(receipt.result==='unknown')return {view,book:input,duplicate:false};
    const next=structuredClone(view);
    if(receipt.result==='confirmed')for(const k of resources){
      if(next.state.resources[k]+1e-7<p.cost[k])throw Error('Confirmed payment cannot be funded');
      next.state.resources[k]-=p.cost[k];e.resources[k]-=p.cost[k];e.paid[k]+=p.cost[k];
    }
    e.status='held';e.pending=null;book.receipts.push(structuredClone(receipt));
    return {view:next,book,duplicate:false};
  }
  function reconcileEvents(view,input,events) {
    validate(input,view);const book=structuredClone(input);
    for(const event of events){
      if(event.kind==='merge')for(const e of book.entries.filter(active))for(const c of e.seats)if(c.roomId===event.roomId)c.roomId=event.into;
      if(event.kind==='pregnancy'){
        const claims=book.entries.filter(active).flatMap(e=>e.families).filter(f=>
          f.childId===null&&familyKey(f.parents)===familyKey(event.parents));
        if(claims.length!==1||!at(event.dueAt)||claims[0].dueAt!==null&&claims[0].dueAt!==event.dueAt)
          throw Error('Pregnancy event needs one matching family reservation');
        claims[0].dueAt=event.dueAt;
      }
      if(event.kind==='birth')for(const e of book.entries.filter(active))for(const f of e.families)
        if(f.dueAt===event.dueAt&&familyKey(f.parents)===familyKey(event.parents))f.childId=event.id;
    }
    return book;
  }
  function feedAllowance(view,book,owner=null) {
    const report=inspect(view,book),e=owner===null?null:book.entries.find(e=>e.id===owner&&active(e));
    if(owner!==null&&(!e||e.status==='submitted'))throw Error('Invalid manufacturing owner');
    const allowed=e?Math.min(e.feedScrap,Math.max(0,report.free.scrap+e.feedScrap)):Math.max(0,report.free.scrap);
    return {floor:Math.max(0,view.state.resources.scrap-allowed),allowed,report};
  }
  function consumeFeed(view,input,owner,spent) {
    validate(input,view);const book=structuredClone(input),e=book.entries.find(e=>e.id===owner&&active(e));
    if(!e||!amount(spent)||spent>e.feedScrap+1e-7)throw Error('Manufacturing exceeds reserved feed');
    e.feedScrap=Math.max(0,e.feedScrap-spent);e.feedSpent+=spent;return book;
  }
  return {create,inspect,reserve,amend,release,submit,resolve,reconcileEvents,feedAllowance,consumeFeed};
}
