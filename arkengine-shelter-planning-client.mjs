// Self-contained browser factory. Only one immutable input is in flight; cancelling a
// worker cannot cancel or confirm a game request. No synchronous fallback on the UI thread.
export function createShelterPlanningClient({source,makeWorker=null,now=Date.now,timeoutMs=45000,onUpdate=()=>{}}) {
  if(!(typeof source==='function'||typeof source==='string'&&source)||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Invalid planning worker configuration');
  const factory=makeWorker??(()=>{
    const url=URL.createObjectURL(new Blob([typeof source==='function'?source():source],{type:'text/javascript'}));
    try{return new Worker(url);}finally{URL.revokeObjectURL(url);}
  });
  let sequence=0,job=null;
  const close=j=>{clearTimeout(j.timer);j.worker?.terminate();j.worker=null;};
  const finish=(j,status,extra={})=>{
    if(job!==j||j.status!=='running')return;
    const finishedAt=now();
    if(finishedAt-j.startedAt>=timeoutMs){status='timeout';extra={error:'Planning time budget exhausted'};}
    close(j);Object.assign(j,{status,finishedAt},extra);onUpdate(read(j.key));
  };
  function read(key){if(!job||job.key!==key)return null;
    // Background tabs may delay timers. Reads and replies still obey the original deadline.
    if(job.status==='running'&&now()-job.startedAt>=timeoutMs)finish(job,'timeout',{error:'Planning time budget exhausted'});
    return {id:job.id,key:job.key,status:job.status,startedAt:job.startedAt,finishedAt:job.finishedAt,
      result:job.result??null,prepared:job.prepared??null,error:job.error??null};}
  function invalidate(){if(job)close(job);job=null;sequence++;}
  function request(key,payload){
    if(typeof key!=='string'||!key)throw Error('A planning snapshot identity is required');
    if(job?.key===key)return read(key);
    invalidate();const j=job={id:++sequence,key,status:'running',startedAt:now(),finishedAt:null,worker:null,timer:null};
    try{
      j.worker=factory();
      j.worker.onmessage=({data})=>{
        if(job!==j||j.status!=='running'||data?.id!==j.id)return;
        if(data.error)finish(j,'failed',{error:data.error});
        else if(data.result?.body?.kind!=='bounded-development-selection'||typeof data.prepared?.accepted!=='boolean')
          finish(j,'failed',{error:'Invalid planning response'});
        else finish(j,'ready',{result:data.result,prepared:data.prepared});
      };
      j.worker.onerror=event=>finish(j,'failed',{error:String(event?.message??'Planning worker failed')});
      j.worker.onmessageerror=()=>finish(j,'failed',{error:'Planning response could not be decoded'});
      j.timer=setTimeout(()=>finish(j,'timeout',{error:'Planning time budget exhausted'}),timeoutMs);
      j.worker.postMessage({...payload,id:j.id});
    }catch(error){finish(j,'failed',{error:String(error?.message??error)});}
    return read(key);
  }
  return {request,read,invalidate};
}
