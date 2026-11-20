import {createShelterReservations} from './arkengine-shelter-reservations.mjs';

// Imports actual schedule/role records into the shared offline route state. This is a
// snapshot adapter, not a native receipt verifier. Unresolved native operations cannot
// be completed by the route simulator's synthetic receipts.
export function createShelterExistingState() {
  const holds=createShelterReservations(),stats=['str','per','end','cha','int','agi','lck'];
  const id=n=>Number.isSafeInteger(n)&&n>0,time=n=>Number.isSafeInteger(n)&&n>=0;
  const label=s=>typeof s==='string'&&s.trim().length>0;
  const active=e=>!['complete','cancelled'].includes(e.status);
  const pairKey=p=>[...p].sort((a,b)=>a-b).join('/');
  const pair=p=>Array.isArray(p)&&p.length===2&&p.every(id)&&p[0]!==p[1];
  const roomId=n=>n===null||id(n);
  const zero=()=>Object.fromEntries(['power','food','water','scrap','parts','stimpak'].map(k=>[k,0]));
  const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o[k]!==undefined).map(k=>[k,structuredClone(o[k])]));
  const validRole=r=>r&&id(r.id)&&id(r.room)&&time(r.at)&&['training','radio','medical','workshop','craftDaily'].includes(r.role)&&
    (r.finishCurrent===undefined||r.finishCurrent===true&&r.role==='training'&&['parent','production','current'].includes(r.purpose)&&
      Number.isInteger(r.base)&&r.base<10&&r.until-r.at<=130*60000)&&
    (r.role!=='training'||stats.includes(r.stat)&&Number.isFinite(r.base)&&r.base>=0&&r.base<=10&&
      (r.purpose===undefined||['production','parent','current'].includes(r.purpose)&&time(r.until)&&r.until>r.at)&&
      (r.purpose!=='current'||r.finishCurrent===true)&&
      (r.purpose!=='production'||['str','per','end','agi','int'].includes(r.stat)&&time(r.windowEnd)&&r.windowEnd>r.at&&id(r.destination)));
  const validMaterial=m=>m&&id(m.vaultNo)&&id(m.id)&&['power','diner','water','scrap','medbay','workshop','storage','quarters'].includes(m.type)&&
    m.level===3&&id(m.targetLevel)&&id(m.finalTarget)&&m.targetLevel<=m.finalTarget;
  function validateSwap(swap) {
    if(!swap)return;
    if(!label(swap.id)||!time(swap.at)||![undefined,'allocation'].includes(swap.kind)||
      !Array.isArray(swap.people)||!swap.people.length||swap.people.some(p=>!id(p.id)||!roomId(p.room))||
      new Set(swap.people.map(p=>p.id)).size!==swap.people.length||!Array.isArray(swap.moves)||!swap.moves.length||
      swap.moves.some(p=>!swap.people.some(q=>q.id===p.id)||!roomId(p.room))||
      !Number.isInteger(swap.step)||swap.step<0||swap.step>swap.moves.length||
      swap.futureSupply!==undefined&&typeof swap.futureSupply!=='boolean'||
      swap.prepareFamily!==undefined&&(!Array.isArray(swap.prepareFamily)||swap.prepareFamily.length!==3||
        !swap.prepareFamily.every(id)||swap.prepareFamily[0]>=swap.prepareFamily[1]))throw Error('Invalid inherited swap');
    if(swap.kind==='allocation'&&(!Array.isArray(swap.targets)||swap.targets.length!==swap.people.length||
      new Set(swap.targets.map(p=>p.id)).size!==swap.people.length||swap.targets.some(p=>!roomId(p.room)||
        !swap.people.some(q=>q.id===p.id)||[...swap.moves].reverse().find(q=>q.id===p.id)?.room!==p.room)||
      !['power','food','water'].every(k=>Number.isFinite(swap.supplyFloor?.[k])&&swap.supplyFloor[k]>=0)))
      throw Error('Invalid inherited allocation');
  }
  function swapMatches(view,swap,step) {
    const expected=new Map(swap.people.map(p=>[p.id,p.room]));
    for(const p of swap.moves.slice(0,step))expected.set(p.id,p.room);
    return swap.people.every(p=>view.state.residents.some(q=>q.id===p.id&&q.roomId===expected.get(p.id)));
  }
  function syncSwap(view,state,book,{confirmed=false}={}) {
    const s=state.swap;if(!s||['complete','cancelled','changed'].includes(s.status)||state.native.length)return;
    if(s.step<s.moves.length&&swapMatches(view,s,s.step+1)){s.step++;s.observedAt=view.serverTime;}
    else if(confirmed||!swapMatches(view,s,s.step)){s.status='changed';return;}
    const e=book.entries.find(e=>e.id===s.intentId);
    if(s.step===s.moves.length){s.status='complete';e.status='complete';e.releasedAt=view.serverTime;e.releaseReason='observed all inherited moves';return;}
    s.status='active';const next=s.moves[s.step];
    // Only the next destination is held: reserving every later full-room target would
    // reject a valid sequence before its preceding departure has actually happened.
    e.seats=next.room===null?[]:[{residentId:next.id,roomId:next.room,from:view.serverTime,until:book.windowEnd}];
  }
  function pendingRecord(p,vaultNo,parent=null) {
    if(!p||!label(p.id)||!label(p.kind)||p.vaultNo!==vaultNo||!time(p.at)||!Array.isArray(p.targets)||
      !p.targets.length||p.targets.some(x=>x!==null&&typeof x!=='string'&&!Number.isSafeInteger(x))||
      parent!==null&&(p.blockedBy!==parent||p.emergency!==undefined))throw Error('Invalid inherited native request');
    const project=p.before?.construction?.project,cost=project?.cost??p.before?.campaign?.choice?.cost;
    if(cost&&(!['scrap','parts'].every(k=>Number.isSafeInteger(cost[k])&&cost[k]>=0)))throw Error('Invalid inherited pending cost');
    const result={id:p.id,kind:p.kind,vaultNo,at:p.at,targets:structuredClone(p.targets),blockedBy:parent,
      sourceServerTime:time(p.before?.serverTime)?p.before.serverTime:null,costBound:cost?{scrap:cost.scrap,parts:cost.parts}:null,
      responseFinishedAt:time(p.result?.responseFinishedAt)?p.result.responseFinishedAt:null};
    // No idempotency keys, request bodies, or purported success proof are copied.
    return [result,...(p.emergency?[...pendingRecord(p.emergency,vaultNo,p.id)]:[])];
  }
  function capture(view,{schedule,pending,source,windowEnd,safety={},clock=null}={}) {
    if(!id(view.vaultNo)||!time(view.serverTime)||!schedule||schedule.vaultNo!==view.vaultNo||
      !Object.hasOwn(arguments[1]??{},'pending')||!label(source))throw Error('Explicit same-vault schedule, pending state and source required');
    const now=view.serverTime,s=view.state,book=holds.create(view,{windowEnd,safety});
    const c=schedule.campaign??{},list=(o,k)=>{
      if(o[k]!==undefined&&!Array.isArray(o[k]))throw Error('Invalid inherited list: '+k);
      return structuredClone(o[k]??[]);
    };
    const native=pending===null?[]:pendingRecord(pending,view.vaultNo);
    if(new Set(native.map(p=>p.id)).size!==native.length)throw Error('Duplicate inherited request identity');
    const state={version:1,vaultNo:view.vaultNo,at:now,source,native,nativeIds:native.map(p=>p.id),priorPayments:[],roles:[],families:[],defense:list(c,'defense'),
      trips:list(c,'trips'),attempts:list(c,'attempts'),heals:list(c,'heals'),trainingRest:list(c,'trainingRest'),
      historicalFamilies:list(schedule,'families'),defenseManual:list(c,'defenseManual'),
      materialPurpose:c.materials===undefined?null:structuredClone(c.materials),
      materialRecord:c.materials===undefined?null:structuredClone(c.materials),material:null,
      swap:schedule.swap==null?null:{...pick(schedule.swap,['id','kind','people','targets','moves','step','at','prepareFamily','futureSupply','supplyFloor']),
        record:pick(schedule.swap,['id','kind','people','targets','moves','step','at','prepareFamily','futureSupply','supplyFloor']),status:'active'},
      constructionKnown:Array.isArray(schedule.constructionLedger),paymentBounds:[],notes:[]};
    const add=(key,purpose,{people=[],seats=[],families=[]}={})=>{
      if(book.entries.some(e=>e.id===key))throw Error('Duplicate imported intent');
      book.entries.push({id:key,purpose,at:now,deadline:windowEnd,status:'held',people,seats,families,
        resources:zero(),feedScrap:0,paid:zero(),feedSpent:0,pending:null});
      return key;
    };
    const person=(residentId,from=now,until=windowEnd)=>({residentId,from,until});
    const seat=(residentId,roomId,from=now,until=windowEnd)=>({...person(residentId,from,until),roomId});
    const entries=list(c,'roles');
    if(new Set(entries.map(r=>r.id)).size!==entries.length)throw Error('Duplicate inherited role');
    for(const d of state.defense)if(!id(d.id)||!id(d.room)||!(d.from===null||id(d.from))||!time(d.at))throw Error('Invalid inherited defense');
    if(new Set(state.defense.map(d=>d.id)).size!==state.defense.length)throw Error('Duplicate inherited defender');
    if(state.defenseManual.some(x=>!id(x)))throw Error('Invalid manual defense identity');
    for(const r of entries){
      if(!validRole(r))throw Error('Invalid inherited role');
      const p=s.residents.find(p=>p.id===r.id),d=state.defense.find(d=>d.id===r.id&&d.from===r.room&&p&&[d.room,null].includes(p.roomId));
      const current=p&&p.deadAt===null&&p.away===null&&p.adultAt<=now&&(p.roomId===r.room||d);
      const row={residentId:r.id,roomId:r.room,destination:r.destination??null,intentId:null,
        status:current?(d?'preempted':'active'):'stale',record:pick(r,['id','room','role','at','stat','base','purpose','until','windowEnd','destination','finishCurrent'])};
      if(current){
        const due=r.role==='training'&&(p.stats[r.stat]>r.base||time(r.until)&&r.until<=now||time(r.windowEnd)&&r.windowEnd<=now);
        const returnAt=due?now:Math.min(windowEnd,r.until??windowEnd);
        const seats=[];
        // The runtime already promises the return seat. Training may finish before its
        // latest-return deadline, so reserving it only from `until` would strand a graduate.
        // Current training occupancy remains in the real roster and is not a second future seat.
        if(r.purpose==='production')seats.push(seat(p.id,r.destination));
        else if(!d&&returnAt>now)seats.push(seat(p.id,r.room,now,returnAt));
        row.intentId=add('existing:role:'+p.id,'inherited '+r.role,{people:[person(p.id)],seats});
        if(due)row.status='return-due';
      }
      state.roles.push(row);
    }
    // No old automatic marker does not mean a permanent manual lock. Retain the actual
    // special post for candidate review, without manufacturing a training purpose/deadline.
    for(const p of s.residents){
      const room=s.rooms.find(r=>r.id===p.roomId);
      if(p.deadAt===null&&p.away===null&&p.adultAt<=now&&['training','medbay','workshop','radio','armory','tailor','door'].includes(room?.type)&&
        !state.roles.some(r=>r.residentId===p.id&&r.status!=='stale'))
        state.roles.push({residentId:p.id,roomId:room.id,destination:null,intentId:null,status:'historical',record:{role:room.type}});
    }
    const families=new Map();
    const addFamily=(parents,roomId,kind)=>{
      if(!pair(parents)||!id(roomId))throw Error('Invalid inherited family');
      const key=pairKey(parents),old=families.get(key);
      if(old&&old.roomId!==roomId)throw Error('Conflicting inherited family room');
      if(!old||kind==='romance')families.set(key,{parents:[...parents],roomId,kind});
    };
    if(schedule.pair){const f=schedule.pair;addFamily([f.a,f.b],f.room,'pair');}
    for(const p of s.residents)if(p.romance){
      const other=s.residents.find(q=>q.id===p.romance.partnerId);
      if(!other||other.romance?.partnerId!==p.id||
        ![p,other].every(q=>Number.isFinite(q.romance.progress)&&q.romance.progress>=0&&q.romance.progress<=1)||
        Math.abs(p.romance.progress-other.romance.progress)>1e-9)throw Error('Inconsistent inherited romance');
      if(p.id>other.id||s.births.some(b=>pair(b.parents)&&pairKey(b.parents)===pairKey([p.id,other.id])))continue;
      if(p.roomId!==other.roomId||p.roomId===null){
        // Native partners may keep their relationship while working apart. Preserve
        // their actual posts; neither a shared dorm nor renewed progress is implied.
        const key=pairKey([p.id,other.id]),old=families.get(key);
        families.set(key,{parents:[p.id,other.id],roomId:old?.roomId??null,kind:'romance',
          positions:[p,other].map(q=>({id:q.id,room:q.roomId}))});
      }else addFamily([p.id,other.id],p.roomId,'romance');
    }
    for(const f of families.values()){
      const birth=s.births.find(b=>pair(b.parents)&&pairKey(b.parents)===pairKey(f.parents));
      if(birth){state.families.push({...f,intentId:null,status:'pregnant',dueAt:birth.dueAt});continue;}
      const intentId=add('existing:family:'+pairKey(f.parents),'inherited active family',{
        people:f.parents.map(p=>person(p)),seats:f.positions?
          f.positions.filter(p=>p.room!==null).map(p=>seat(p.id,p.room)):f.parents.map(p=>seat(p,f.roomId)),
        families:[{parents:f.parents,dueAt:null,childId:null}]});
      state.families.push({...f,intentId,status:f.positions?'paused':'needs-plan'});
    }
    for(const birth of s.births)if(!pair(birth.parents)){
      const people=new Set(s.residents.filter(p=>p.roomId===birth.roomId&&p.adultAt<=now).map(p=>p.id));
      for(const f of state.historicalFamilies)if(f.room===birth.roomId){people.add(f.a);people.add(f.b);}
      if([...people].some(p=>!id(p)))throw Error('Invalid historical family identity');
      state.families.push({roomId:birth.roomId,parents:[...people],intentId:null,status:'unknown-birth',dueAt:birth.dueAt});
    }
    for(const d of state.defense){
      const p=s.residents.find(p=>p.id===d.id);
      d.intentId=state.roles.find(r=>r.residentId===d.id&&r.status!=='stale')?.intentId??null;
      if(!d.intentId&&p&&p.deadAt===null&&p.away===null&&[d.room,null].includes(p.roomId)&&!state.defenseManual.includes(p.id))
        d.intentId=add('existing:defense:'+p.id,'inherited defense return',{people:[person(p.id)]});
    }
    if(state.swap){
      validateSwap(state.swap);
      state.swap.intentId=add('existing:swap','inherited unfinished swap',{people:state.swap.people.map(p=>person(p.id))});
      syncSwap(view,state,book);
    }
    const payments=[];
    if(schedule.constructionLedger!==undefined&&!Array.isArray(schedule.constructionLedger))throw Error('Invalid inherited construction ledger');
    const ledger=schedule.constructionLedger??[];
    if(ledger.length&&(!clock||!time(clock.localAt)||clock.serverAt!==now||!time(clock.uncertaintyMs)||!label(clock.source)))
      throw Error('Explicit local/server clock bounds required for prior construction payments');
    for(const e of ledger){
      if(!label(e.id)||!time(e.at)||e.at>clock.localAt||!['scrap','parts'].every(k=>Number.isSafeInteger(e[k])&&e[k]>=0)||payments.some(p=>p.id===e.id))
        throw Error('Invalid inherited construction payment');
      const mapped=e.at+clock.serverAt-clock.localAt,earliest=Math.max(0,mapped-clock.uncertaintyMs),latest=Math.min(now,mapped+clock.uncertaintyMs);
      if(latest<earliest)throw Error('Construction clock bounds do not intersect prior time');
      payments.push({id:e.id,at:latest,cost:{scrap:e.scrap,parts:e.parts}});
      state.paymentBounds.push({id:e.id,localAt:e.at,earliest,latest,source:clock.source});
    }
    state.priorPayments=structuredClone(payments);
    if(state.materialPurpose&&(!validMaterial(state.materialPurpose)||state.materialPurpose.vaultNo!==view.vaultNo))throw Error('Invalid inherited material purpose');
    const report=holds.inspect(view,book);validate(view,state,book);
    return {book,state,payments,blocked:report.blocked};
  }
  function validate(view,state,book) {
    if(state?.version!==1||state.vaultNo!==view.vaultNo||!time(state.at)||state.at>view.serverTime||!label(state.source)||
      !['native','nativeIds','priorPayments','roles','families','defense','trips','attempts','heals','trainingRest','historicalFamilies','defenseManual','paymentBounds','notes']
        .every(k=>Array.isArray(state[k]))||typeof state.constructionKnown!=='boolean')throw Error('Invalid inherited route state');
    for(const row of [...state.roles,...state.families,...state.defense,...(state.swap?[state.swap]:[])])
      if(row.intentId&&!book.entries.some(e=>e.id===row.intentId))throw Error('Inherited intent binding missing');
    for(const row of state.roles){
      if(!id(row.residentId)||!id(row.roomId)||!['active','preempted','return-due','stale','historical','completed'].includes(row.status)||
        !row.record||row.status!=='historical'&&(!validRole(row.record)||row.record.id!==row.residentId))
        throw Error('Invalid inherited role binding');
      if(!['active','preempted','return-due'].includes(row.status))continue;
      const e=book.entries.find(e=>e.id===row.intentId&&active(e));
      if(!e||!e.people.some(p=>p.residentId===row.residentId&&p.from<=state.at&&p.until===book.windowEnd)||
        row.record.purpose==='production'&&(!id(row.destination)||!e.seats.some(p=>p.residentId===row.residentId&&
          p.roomId===row.destination&&p.from<=state.at&&p.until===book.windowEnd)))
        throw Error('Inherited role lost its commitment');
    }
    for(const f of state.families)if(['needs-plan','paused'].includes(f.status)){
      const e=book.entries.find(e=>e.id===f.intentId&&active(e));
      const positions=f.status==='paused'?f.positions:f.parents.map(id=>({id,room:f.roomId}));
      if(!pair(f.parents)||(f.status==='paused'?!roomId(f.roomId):!id(f.roomId))||
        !Array.isArray(positions)||positions.length!==2||new Set(positions.map(p=>p.id)).size!==2||
        positions.some(p=>!f.parents.includes(p.id)||!roomId(p.room)||f.status==='paused'&&
          !view.state.residents.some(q=>q.id===p.id&&q.roomId===p.room))||
        !e||!e.families.some(p=>pairKey(p.parents)===pairKey(f.parents))||
        positions.some(q=>!e.people.some(p=>p.residentId===q.id)||q.room!==null&&
          !e.seats.some(p=>p.residentId===q.id&&p.roomId===q.room)))
        throw Error('Inherited family lost its commitment');
    }
    if(state.swap){
      const s=state.swap;validateSwap(s);validateSwap(s.record);
      if(!['active','changed','complete','cancelled'].includes(s.status))throw Error('Invalid inherited swap status');
      const e=book.entries.find(e=>e.id===s.intentId);
      if(!e||['active','changed'].includes(s.status)&&(!active(e)||s.people.some(p=>
        !e.people.some(c=>c.residentId===p.id&&c.until===book.windowEnd))))throw Error('Inherited swap lost its commitment');
      if(s.status==='active'&&!state.native.length&&!swapMatches(view,s,s.step))throw Error('Inherited swap position mismatch');
    }
    if(state.material){
      const m=state.material,e=book.entries.find(e=>e.id===m.intentId);
      if(!label(m.source)||!id(m.roomId)||m.roomId!==state.materialPurpose?.id||!id(m.fromLevel)||!id(m.targetLevel)||
        !['preparing','ready','constructing','complete','cancelled'].includes(m.status)||!Array.isArray(m.workers)||
        m.workers.some(p=>!id(p.id)||!label(p.intentId))||!Array.isArray(m.rooms)||!m.rooms.every(id)||
        !e||m.status!=='cancelled'&&!active(e)||
        !['scrap','parts'].every(k=>Number.isSafeInteger(m.cost?.[k])&&m.cost[k]>=0&&e.resources[k]===m.allocated?.[k])||
        e.feedScrap!==m.allocated?.feedScrap)throw Error('Invalid inherited material allocation');
      if(m.status!=='cancelled')for(const w of m.workers){
        const p=view.state.residents.find(p=>p.id===w.id);
        if(p&&m.rooms.includes(p.roomId)&&!book.entries.some(e=>e.id===w.intentId&&active(e)&&
          e.people.some(c=>c.residentId===w.id&&c.until>view.serverTime)))throw Error('Inherited material worker lost its commitment');
      }
    }
    if(state.materialPurpose&&(!validMaterial(state.materialPurpose)||!validMaterial(state.materialRecord)))throw Error('Invalid inherited material purpose');
    if(new Set(state.native.map(p=>p.id)).size!==state.native.length||JSON.stringify(state.nativeIds)!==JSON.stringify(state.native.map(p=>p.id))||
      state.native.some(p=>!label(p.id)||!label(p.kind)||p.vaultNo!==view.vaultNo||!time(p.at)||!Array.isArray(p.targets)||!p.targets.length||
        p.costBound!==null&&!['scrap','parts'].every(k=>Number.isSafeInteger(p.costBound?.[k])&&p.costBound[k]>=0)||
        p.blockedBy!==null&&!state.nativeIds.includes(p.blockedBy)))
      throw Error('Invalid inherited request binding');
    if(state.priorPayments.length!==state.paymentBounds.length||state.priorPayments.some(p=>!label(p.id)||!time(p.at)||
      !['scrap','parts'].every(k=>Number.isSafeInteger(p.cost?.[k])&&p.cost[k]>=0)||
      !state.paymentBounds.some(b=>b.id===p.id&&b.latest===p.at)))throw Error('Invalid inherited payment history');
  }
  function issues(view,state,book,{action=null,intentId=null,advancing=false,nextAt=null,familyPlans=[]}={}) {
    if(!state)return [];
    validate(view,state,book);const problems=[],s=view.state;
    const held=id=>book.entries.some(e=>e.id===id&&active(e));
    if(state.native.length)return state.native.map(p=>({kind:'inherited-native-pending',requestId:p.id,action:p.kind}));
    if(state.swap&&held(state.swap.intentId)){
      const swap=state.swap,move=swap.moves[swap.step];
      if(swap.status==='changed')problems.push({kind:'inherited-swap-position-changed'});
      if(swap.prepareFamily&&!familyPlans.some(p=>p.stage==='planned'&&pairKey(p.parents)===pairKey(swap.prepareFamily.slice(0,2))&&
        p.roomId===swap.prepareFamily[2]))problems.push({kind:'inherited-swap-family-context-needed'});
      if(action&&!(intentId===swap.intentId&&action.kind==='assign'&&action.residentId===move?.id&&action.roomId===move.room))
        problems.push({kind:'inherited-swap-next-action-required',step:swap.step});
    }
    if(action&&['build','upgrade','dig'].includes(action.kind)&&!state.constructionKnown)problems.push({kind:'prior-construction-spending-unknown'});
    if(state.materialPurpose&&!state.material&&(advancing&&s.residents.some(p=>p.deadAt===null&&p.away===null&&p.adultAt<=view.serverTime&&
      s.rooms.some(r=>r.id===p.roomId&&r.type==='workshop'&&r.builtAt<=view.serverTime&&r.upgradeAt===null&&!r.unpowered&&!r.incident))||
      action&&['build','upgrade','dig'].includes(action.kind)))problems.push({kind:'inherited-material-allocation-needed',roomId:state.materialPurpose.id});
    if(state.material&&action&&intentId===state.material.intentId&&['build','upgrade','dig'].includes(action.kind)&&
      (action.kind!=='upgrade'||action.roomId!==state.material.roomId||action.fromLevel!==state.material.fromLevel||state.material.status!=='ready'))
      problems.push({kind:'inherited-material-project-not-ready'});
    for(const f of state.families){
      if(f.status==='paused'&&held(f.intentId)&&(advancing||action?.kind==='assign'&&f.parents.includes(action.residentId)))
        problems.push({kind:'inherited-romance-paused',intentId:f.intentId});
      if(f.status==='unknown-birth'&&(advancing||action?.kind==='assign'&&f.parents.includes(action.residentId)))
        problems.push({kind:'inherited-birth-ownership-unknown',roomId:f.roomId});
      if(f.status==='needs-plan'&&held(f.intentId)&&!familyPlans.some(p=>p.intentId===f.intentId)&&
        (advancing||action?.kind==='assign'&&f.parents.includes(action.residentId)))
        problems.push({kind:'inherited-family-plan-needed',intentId:f.intentId});
    }
    if(advancing)for(const row of state.roles)if(row.intentId&&held(row.intentId)&&row.record.role==='training'){
      const r=row.record,p=s.residents.find(p=>p.id===row.residentId);
      if(p?.roomId===row.roomId&&(p.stats[r.stat]>r.base||time(r.until)&&view.serverTime>=r.until||time(r.windowEnd)&&view.serverTime>=r.windowEnd))
        problems.push({kind:'inherited-training-return-due',residentId:row.residentId,intentId:row.intentId,until:r.until??null});
      else if(p?.roomId===row.roomId&&time(nextAt)){
        const until=Math.min(...[r.until,r.windowEnd].filter(time));
        if(until>view.serverTime&&until<nextAt)problems.push({kind:'inherited-training-deadline-boundary',
          residentId:row.residentId,intentId:row.intentId,until,nextAt});
      }
    }
    return problems;
  }
  function remap(input,events) {
    if(!input)return input;const state=structuredClone(input);
    for(const e of events)if(e.kind==='merge'){
      for(const r of state.roles){if(r.roomId===e.roomId)r.roomId=e.into;if(r.destination===e.roomId)r.destination=e.into;}
      for(const f of state.families){
        if(f.roomId===e.roomId)f.roomId=e.into;
        for(const p of f.positions??[])if(p.room===e.roomId)p.room=e.into;
      }
      for(const d of state.defense){if(d.room===e.roomId)d.room=e.into;if(d.from===e.roomId)d.from=e.into;}
      if(state.materialPurpose?.id===e.roomId)state.materialPurpose.id=e.into;
      if(state.material){if(state.material.roomId===e.roomId)state.material.roomId=e.into;
        state.material.rooms=[...new Set(state.material.rooms.map(id=>id===e.roomId?e.into:id))];}
      if(state.swap){for(const p of [...state.swap.people,...state.swap.moves,...(state.swap.targets??[])])if(p.room===e.roomId)p.room=e.into;
        if(state.swap.prepareFamily?.[2]===e.roomId)state.swap.prepareFamily[2]=e.into;}
    }
    for(const e of events)if(['pregnancy','birth'].includes(e.kind))for(const f of state.families)
      if(pair(f.parents)&&pairKey(f.parents)===pairKey(e.parents??[])){
        f.status=e.kind==='pregnancy'?'pregnant':'born';f.dueAt=e.dueAt;if(e.kind==='birth')f.childId=e.id;
      }
    return state;
  }
  return {capture,validate,issues,remap,syncSwap};
}
