// Native level-route and family-supply protocol. Results are proposals, never game actions.
// One Worker runs at a time; a few variants of the same native snapshot may queue.
export function createShelterLevelPlanning({source,makeWorker=null,now=Date.now,timeoutMs=45000,onUpdate=()=>{},retainLevelProgress=false,retainFamilyProgress=false}) {
  const factory=makeWorker??(()=>{
    const url=URL.createObjectURL(new Blob([typeof source==='function'?source():source],{type:'text/javascript'}));
    try{return new Worker(url);}finally{URL.revokeObjectURL(url);}
  });
  let epoch=null,sequence=0,active=null,progress=null;
  const jobs=new Map();
  // Inputs are JSON data. Object insertion order is not a business fact;
  // array order and every non-metadata field still participate in identity.
  const keyOf=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
    Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  function observation(view,retain){
    const {serverTime,revision,...facts}=view,bounds={};
    if(!retain)return {facts,bounds};
    bounds.serverTime=serverTime;
    // Only monotone accumulation may retain work. Level routes require replay;
    // family searches additionally compare every recorded family's stock eligibility.
    // Keep unknown fields and actual worker/room/health changes exact.
    const state={...facts.state},resources={...state.resources};
    const take=(copy,key,path,marker=null)=>{if(Number.isFinite(copy[key])){bounds[path]=copy[key];copy[key]=marker;}};
    for(const key of ['power','food','water','scrap','parts','stimpak'])take(resources,key,'resources.'+key);
    state.resources=resources;
    state.rooms=state.rooms.map(r=>{const next={...r};take(next,'stored','rooms.'+r.id+'.stored');return next;});
    state.residents=state.residents.map(p=>{
      const next={...p};
      take(next,'xp','residents.'+p.id+'.xp',Math.min(50,1+Math.floor(Math.sqrt(Math.max(0,p.xp)/3))));
      take(next,'training','residents.'+p.id+'.training',p.training>=1);
      if(p.romance){next.romance={...p.romance};take(next.romance,'progress','residents.'+p.id+'.romance',p.romance.progress>=1);}
      return next;
    });
    return {facts:{...facts,state},bounds};
  }
  const close=j=>{clearTimeout(j.timer);j.worker?.terminate();j.worker=null;if(active===j)active=null;};
  const read=j=>({id:j.id,status:j.status,routes:j.routes??[],supply:j.supply??null,snapshotAt:j.payload.view.serverTime,
    queuedAt:j.queuedAt,finishedAt:j.finishedAt??null,error:j.error??null});
  function invalidate(){for(const j of jobs.values())close(j);jobs.clear();epoch=null;progress=null;}
  function finish(j,status,extra={}){
    if(jobs.get(j.key)!==j||!['running','queued'].includes(j.status))return;
    const finishedAt=now();
    if(finishedAt-j.queuedAt>=timeoutMs){status='timeout';extra={error:'Planning request time budget exhausted'};}
    close(j);Object.assign(j,{status,finishedAt},extra);onUpdate(read(j));pump();
  }
  function pump(){
    if(active){
      // A delayed timer must not let expired work keep the queue occupied on the next read.
      if(now()-active.queuedAt>=timeoutMs)finish(active,'timeout',{error:'Planning request time budget exhausted'});
      return;
    }
    const j=[...jobs.values()].find(j=>j.status==='queued');if(!j)return;
    if(now()-j.queuedAt>=timeoutMs){finish(j,'timeout',{error:'Planning request time budget exhausted'});return;}
    active=j;j.status='running';
    try{
      j.worker=factory();
      j.worker.onmessage=({data})=>{
        if(active!==j||data?.id!==j.id)return;
        if(data.error)finish(j,'failed',{error:String(data.error)});
        else if(j.payload.kind==='native-family-supply'){
          if(data.kind!=='native-family-supply'||!(data.supply===null||data.supply&&
              Array.isArray(data.supply.family)&&data.supply.family.length===3&&
              data.supply.family.every(Number.isSafeInteger)&&data.supply.resources&&typeof data.supply.resources==='object'))
            finish(j,'failed',{error:'Invalid native family-supply response'});
          else finish(j,'ready',{supply:data.supply});
        }
        else if(data.kind!=='native-level-routes'||!Array.isArray(data.routes)||
          !data.routes.every(r=>r.kind==='projects'&&Array.isArray(r.steps)&&Number.isFinite(r.hours)))
          finish(j,'failed',{error:'Invalid native level-route response'});
        else finish(j,'ready',{routes:data.routes});
      };
      j.worker.onerror=e=>finish(j,'failed',{error:String(e?.message??'Level worker failed')});
      j.worker.onmessageerror=()=>finish(j,'failed',{error:'Level response could not be decoded'});
      j.worker.postMessage({id:j.id,...j.payload});
    }catch(e){finish(j,'failed',{error:String(e?.message??e)});}
  }
  function request(payload,context){
    // A changed clock alone may retain the search, but its route must be replayed
    // against the new clock by the native caller before any proposal is consumed.
    const {serverTime}=payload.view,family=payload.kind==='native-family-supply';
    const retain=family?retainFamilyProgress&&Array.isArray(payload.stockEligibility)&&payload.stockEligibility.length>0:retainLevelProgress;
    const replay=retain&&!family;
    const {facts,bounds}=observation(payload.view,retain);
    // Family previews depend on clock predicates, not elapsed stock projections.
    // Preserve a completed search across the mandatory fresh pre-submit read, but
    // invalidate at adulthood, cooldown, room completion or production-event boundaries.
    // Stock-only growth is equivalent only while every housing allowance stays the same.
    // Actual settlement, all other facts and unknown fields still belong to the epoch.
    const familyClock=family?[
      facts.state.residents.map(p=>[p.adultAt<=serverTime,p.familyCooldownUntil>serverTime]),
      facts.state.rooms.map(r=>[r.builtAt<=serverTime,r.upgradeAt!==null&&r.upgradeAt<=serverTime]),
      (facts.env?.events||[]).map(e=>[e.startsAt<=serverTime,e.endsAt<=serverTime])]:null;
    const newEpoch=keyOf([facts,context,familyClock,family?payload.stockEligibility:null]);
    const regressed=progress&&Object.entries(progress).some(([key,value])=>!Number.isFinite(bounds[key])||bounds[key]<value);
    if(epoch!==newEpoch||regressed){invalidate();epoch=newEpoch;}
    progress=bounds;
    // The job owns an immutable clone. Canonicalize its original view once,
    // while every current read is still checked in full, including metadata/time.
    const viewKey=replay?keyOf([payload.view,payload.planning?.campaign?.constructionPolicy?.budgetReleases]):null;
    // The local ledger timestamp is the payment identity. Mapping it into a
    // fresh server clock must not restart a search for millisecond read jitter;
    // the caller replays the proposal with the new mapping before consumption.
    const planning=structuredClone(payload.planning);
    if(replay&&planning?.campaign?.constructionPolicy?.budgetReleases)
      planning.campaign.constructionPolicy.budgetReleases=planning.campaign.constructionPolicy.budgetReleases.map(e=>{
        if(!Number.isFinite(e.localReleaseAt))return e;
        const {at,...payment}=e;return payment;
      });
    const key=keyOf([payload.kind,payload.options,payload.targetScore,payload.first,planning,payload.campaign]);
    let j=jobs.get(key);
    if(j?.status==='ready'&&now()-j.finishedAt>60000){close(j);jobs.delete(key);j=null;}
    if(!j){
      if(jobs.size>=4){const oldest=jobs.values().next().value;close(oldest);jobs.delete(oldest.key);}
      j={id:++sequence,key,viewKey,payload:structuredClone(payload),status:'queued',queuedAt:now(),worker:null,timer:null};jobs.set(key,j);
      // The deadline includes time in the queue; expired work must not acquire a Worker.
      j.timer=setTimeout(()=>finish(j,'timeout',{error:'Planning request time budget exhausted'}),timeoutMs);
    }
    pump();
    return {...read(j),recheck:replay&&viewKey!==j.viewKey};
  }
  return {request,invalidate};
}

export function installShelterLevelWorker(endpoint,model,routes,familySupply=null) {
  endpoint.onmessage=({data})=>{
    try{
      if(data.kind==='native-family-supply'){
        if(!familySupply)throw Error('Family-supply kernel unavailable');
        endpoint.postMessage({id:data.id,kind:data.kind,supply:familySupply(data)});return;
      }
      const result=routes(model(data.view),data.options,data.targetScore,data.first,data.planning);
      endpoint.postMessage({id:data.id,kind:'native-level-routes',routes:result});
    }catch(e){endpoint.postMessage({id:data.id,error:String(e?.message??e)});}
  };
}
