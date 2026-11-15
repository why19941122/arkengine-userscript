// Adapter for current-action proposals. The native staff planner supplies the final
// allowed choices again on every read, including immediately before submission.
export function createShelterNativePlanning({client,now=Date.now}) {
  let latest=null;
  const keyOf=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
    Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  function observation(view,context){
    const {serverTime,revision,...facts}=view,bounds={serverTime},state={...facts.state},resources={...state.resources};
    const take=(copy,key,path,marker=null)=>{if(Number.isFinite(copy[key])){bounds[path]=copy[key];copy[key]=marker;}};
    for(const key of ['power','food','water','scrap','parts','stimpak'])take(resources,key,'resources.'+key);
    state.resources=resources;
    state.rooms=state.rooms.map(r=>{const copy={...r};take(copy,'stored','rooms.'+r.id);return copy;});
    state.residents=state.residents.map(p=>{
      const copy={...p};
      take(copy,'xp','residents.'+p.id+'.xp',Math.min(50,1+Math.floor(Math.sqrt(Math.max(0,p.xp)/3))));
      take(copy,'training','residents.'+p.id+'.training',p.training>=1);
      if(p.romance){copy.romance={...p.romance};take(copy.romance,'progress','residents.'+p.id+'.romance',p.romance.progress>=1);}
      return copy;
    });
    // Clock-only transitions can change admissible work even when the API has
    // not settled the state yet. Keep all other and unknown facts exact.
    const boundaries=[];
    const deadlines=new Set(['adultAt','familyCooldownUntil','builtAt','upgradeAt','startsAt','endsAt','dueAt','returnAt','until','windowEnd']);
    function clocks(value,path=''){
      if(!value||typeof value!=='object')return;
      for(const [key,v] of Object.entries(value)){
        if(deadlines.has(key)&&Number.isFinite(v))boundaries.push([path+'.'+key,v<=serverTime]);
        else if(v&&typeof v==='object')clocks(v,path+'.'+key);
      }
    }
    clocks([facts,context.schedule]);
    return {key:keyOf([{...facts,state},context.schedule,context.construction,context.safety,context.window,context.settings,
      boundaries.sort(([a],[b])=>a.localeCompare(b))]),bounds};
  }
  function update(view,context){
    if(!context.enabled||context.pending||!context.window||context.window.end<=view.serverTime){
      client.invalidate();latest=null;return null;
    }
    const {serverTime}=view,{key,bounds}=observation(view,context);
    const regressed=latest&&Object.entries(latest.bounds).some(([k,v])=>!Number.isFinite(bounds[k])||bounds[k]<v);
    if(latest?.key!==key||regressed||now()-latest.at>60000){
      client.invalidate();latest={key,at:now(),vaultNo:view.vaultNo,bounds};
    }else latest.bounds=bounds;
    const payload={mode:'local',runtime:{view,options:{firstActionOnly:true,
      windowStart:context.window.start,windowEnd:context.window.end,safety:context.safety,construction:context.construction,
      runtime:{schedule:context.schedule,pending:context.pending,source:'observed native read and persisted original obligations',
        clock:{localAt:context.readAt,serverAt:serverTime,uncertaintyMs:Math.max(0,context.readAt-context.readStartedAt),source:'native request/response clock interval'}}}},
      options:{goal:{id:'current-scrap-production',kind:'stock',resource:'scrap',amount:view.state.resources.scrap+1,
        source:'current non-worsening scrap production; not a future stock forecast'},
        execution:{receipts:'immediate-simulated',collection:'each-tick',source:'unused in local-only selection; never native evidence'},
        maxChecks:2000,checksPerNode:2000,maxExpansions:1}};
    const status=client.request(key,payload);return status;
  }
  function choose(view,context,allowed){
    const status=update(view,context);
    if(!status||status.status!=='ready'||now()-latest.at>60000||latest.vaultNo!==view.vaultNo)return null;
    const body=status.result?.body,prepared=status.prepared,first=body?.selected?.firstCandidate,action=prepared?.action;
    if(body?.outcome!=='independent-local-improvement'||!prepared?.accepted||first?.kind!=='assign'||action?.kind!=='assign'||
      body.windowStart!==context.window.start||body.windowEnd!==context.window.end||
      JSON.stringify(body.selected.firstAction?.action)!==JSON.stringify(action))return null;
    const current=allowed.find(c=>c.id===action.residentId&&c.room===action.roomId&&c.from===action.fromRoomId);
    if(!current)return null;
    return {...current,reason:'后台已比较独立增产调岗，本轮重新核对供应、用途和空位后执行',
      developmentProposal:{jobId:status.id,from:body.from,windowStart:body.windowStart,windowEnd:body.windowEnd,
        candidateId:first.id,kind:body.outcome}};
  }
  return {update,choose,status:()=>latest?client.read(latest.key):null,invalidate(){client.invalidate();latest=null;}};
}
