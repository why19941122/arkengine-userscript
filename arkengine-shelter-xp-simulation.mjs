// Public duty/collection XP and resident level/max-HP equations. This optional offline
// model declares tick sampling and numerical precision. It does not invent healing,
// activity multipliers or XP for an ambiguously capacity-limited collection.
export function createShelterXpSimulation() {
  const tick=600000,precision=1e9;
  const rooms=new Set(['door','elevator','power','diner','water','scrap','quarters','storage',
    'medbay','training','workshop','armory','tailor','radio']);
  const fields={duty:'tick-start-prorated',collection:'full-ready-batches',health:'fixed-current-hp',
    activity:'block-unmodeled-xp',precision:'1e-9'};
  const level=p=>Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)));
  const maxHp=p=>Math.round(100+(level(p)-1)*(2+.5*p.stats.end));
  const present=(p,at)=>p.deadAt===null&&p.away===null&&p.adultAt<=at;
  function validate(view,rules) {
    if(!rules||Object.entries(fields).some(([k,v])=>rules[k]!==v)||
      Object.keys(rules).some(k=>!(k in fields)&&k!=='source')||typeof rules.source!=='string'||!rules.source.trim())
      throw Error('Explicit conditional XP and fixed-health rules required');
    for(const p of view.state.residents)if(!Number.isFinite(p.xp)||p.xp<0||!Number.isFinite(p.hp)||p.hp<0||
      !Number.isFinite(p.stats?.end)||p.stats.end<0||p.stats.end>10)
      throw Error('Invalid XP or current-health state');
    for(const e of view.env?.events??[])if(e.kind==='xp'&&(!Number.isSafeInteger(e.startsAt)||e.startsAt<0||
      !Number.isSafeInteger(e.endsAt)||e.endsAt<e.startsAt||!Number.isFinite(e.percent)||e.percent<0))
      throw Error('Invalid XP activity interval');
  }
  function duty(view,rules) {
    validate(view,rules);const at=view.serverTime,awards=[],blocked=[];
    // The saved page identifies affected XP sources but does not prove the server's XP
    // multiplier, cap or boundary handling. Do not silently assume no active boost.
    if((view.env?.events??[]).some(e=>e.kind==='xp'&&e.startsAt<at+tick&&e.endsAt>at))
      blocked.push({kind:'xp',at,reason:'xp-activity-rule-not-modeled'});
    for(const p of view.state.residents)if(present(p,at)&&p.roomId!==null&&
      !view.state.rooms.some(r=>r.id===p.roomId))blocked.push({kind:'xp',id:p.id,at,reason:'unknown-assigned-room'});
    for(const r of view.state.rooms){
      if(!rooms.has(r.type)){blocked.push({kind:'xp',roomId:r.id,at,reason:'unknown-duty-room-type'});continue;}
      if(['quarters','elevator','storage'].includes(r.type)||r.builtAt>at||r.upgradeAt!==null||r.incident||r.unpowered)continue;
      for(const p of view.state.residents.filter(p=>p.roomId===r.id&&present(p,at)).slice(0,r.width*2))
        awards.push({id:p.id,roomId:r.id,amount:1/6,kind:'duty',at:at+tick,sampledAt:at});
    }
    return {awards,blocked};
  }
  function collection(view,receipts,rules) {
    validate(view,rules);const awards=[],blocked=[],seen=new Set();
    if(!Array.isArray(receipts))throw Error('Per-room collection receipts required for XP');
    for(const r of receipts){
      const room=view.state.rooms.find(room=>room.id===r.roomId),key=r.at+':'+r.method+':'+r.roomId;
      const workers=room?view.state.residents.filter(p=>p.roomId===room.id&&present(p,r.sampledAt)).slice(0,room.width*2).map(p=>p.id):[];
      if(!Number.isFinite(r.batch)||r.batch<=0||!Number.isSafeInteger(r.readyBatches)||r.readyBatches<1||
        !Number.isFinite(r.amount)||r.amount<=0||r.amount>r.batch*r.readyBatches+1e-7||
        !room||seen.has(key)||!Number.isFinite(r.storedBefore)||!Number.isFinite(r.storedAfter)||r.storedAfter<0||
        Math.abs(r.storedBefore-r.amount-r.storedAfter)>1e-7||Math.floor(r.storedBefore/r.batch+1e-9)!==r.readyBatches||
        !Array.isArray(r.workerIds)||new Set(r.workerIds).size!==r.workerIds.length||
        !['automatic','manual'].includes(r.method)||!Number.isSafeInteger(r.at)||r.at!==view.serverTime||
        !Number.isSafeInteger(r.sampledAt)||r.sampledAt!==(r.method==='automatic'?r.at-tick:r.at)||
        JSON.stringify(r.workerIds)!==JSON.stringify(workers))
        throw Error('Invalid per-room XP collection receipt');
      seen.add(key);
      if(r.workerIds.length&&Math.abs(r.amount-r.batch*r.readyBatches)>1e-7){
        blocked.push({kind:'xp',roomId:r.roomId,at:r.at,reason:'partial-collection-xp-unknown',
          amount:r.amount,readyBatches:r.readyBatches,batch:r.batch});continue;
      }
      for(const id of r.workerIds)awards.push({id,roomId:r.roomId,amount:2*r.readyBatches,
        kind:'collection',method:r.method,at:r.at,sampledAt:r.sampledAt});
    }
    return {awards,blocked};
  }
  function apply(view,awards) {
    // Called only on a private tick copy. Normalize tiny binary additions consistently
    // across JSON/repeated advances; this precision is a model condition, not UI evidence.
    for(const a of awards){const p=view.state.residents.find(p=>p.id===a.id);
      if(!p||!Number.isFinite(a.amount)||a.amount<0)throw Error('Invalid XP award');
      p.xp=Math.round((p.xp+a.amount)*precision)/precision;
    }
  }
  function changes(before,after,awards) {
    const events=[],at=after.serverTime;
    for(const p of before.state.residents){
      const q=after.state.residents.find(q=>q.id===p.id);if(!q)continue;
      const oldLevel=level(p),newLevel=level(q),oldMax=maxHp(p),newMax=maxHp(q);
      if(oldLevel!==newLevel)events.push({kind:'resident-level',at,id:p.id,from:oldLevel,to:newLevel,xp:q.xp});
      if(oldMax!==newMax)events.push({kind:'resident-max-hp',at,id:p.id,from:oldMax,to:newMax,hp:q.hp});
      if(present(p,before.serverTime)&&(p.hp>=.6*oldMax)!==(q.hp>=.6*newMax))
        events.push({kind:'resident-health-threshold',at,id:p.id,hp:q.hp,maxHp:newMax,meetsHealthMinimum:q.hp>=.6*newMax});
    }
    return {events,summary:{at,duty:awards.filter(a=>a.kind==='duty').reduce((n,a)=>n+a.amount,0),
      collection:awards.filter(a=>a.kind==='collection').reduce((n,a)=>n+a.amount,0),
      workers:new Set(awards.map(a=>a.id)).size,levels:events.filter(e=>e.kind==='resident-level').length,
      belowHealthMinimum:after.state.residents.filter(p=>present(p,at)&&p.hp<.6*maxHp(p)).length}};
  }
  return {validate,duty,collection,apply,changes,level,maxHp};
}
