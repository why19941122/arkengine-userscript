import {createShelterRouteSimulation} from './arkengine-shelter-route-simulation.mjs';
import {createShelterResourceSimulation} from './arkengine-shelter-resource-simulation.mjs';

// Two-person exchanges for offline development routes. Every move is a separately
// checked assignment, with a real settlement/collection between confirmations.
// This is bounded candidate generation, not an allocation optimum or native executor.
export function createShelterExchangeCandidates() {
  const routes=createShelterRouteSimulation(),resources=createShelterResourceSimulation();
  const tick=600000,types={power:'power',diner:'food',water:'water',scrap:'scrap'};
  const keys=['power','food','water','scrap','parts','stimpak'];
  const usable=(r,at)=>r&&r.builtAt<=at&&r.upgradeAt===null&&!r.incident&&!r.unpowered;
  const rates=v=>Object.fromEntries(keys.map(k=>[k,v.state.rooms.filter(r=>types[r.type]===k)
    .reduce((sum,r)=>sum+resources.rate(v,r,v.serverTime),0)]));
  function enumerate(n,{people,goal,maxCandidates}) {
    if(!Array.isArray(people)||!goal||typeof goal.id!=='string'||!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>2000)
      throw Error('Explicit exchange roster, goal and bounded generation budget required');
    const at=n.view.serverTime,s=n.view.state;
    const jobs=s.rooms.filter(r=>types[r.type]&&usable(r,at)).sort((a,b)=>a.id-b.id);
    const ids=new Set(people.filter(p=>p.eligible&&!p.intentId).map(p=>p.residentId));
    const workers=s.residents.filter(p=>ids.has(p.id)&&jobs.some(r=>r.id===p.roomId)).sort((a,b)=>a.id-b.id);
    const count=r=>s.residents.filter(p=>p.roomId===r.id&&p.deadAt===null&&p.adultAt<=at).length;
    const buffers=[null,...jobs.filter(r=>count(r)<r.width*2).map(r=>r.id)],pairs=[],seen=new Set();
    const contributions=new Map(),before=rates(n.view);
    function contribution(p,r){
      const key=p.id+':'+r.id;if(contributions.has(key))return contributions.get(key);
      const view={...n.view,state:{...s,residents:[{...p,roomId:r.id}]}};
      const value=resources.rate(view,r,at);contributions.set(key,value);return value;
    }
    // Rotate through the full roster before increasing pair distance. A budget must
    // not silently turn the roster into its first sixteen residents.
    for(let distance=1;distance<workers.length;distance++)for(let i=0;i<workers.length;i++){
      const a=workers[i],b=workers[(i+distance)%workers.length],key=[a.id,b.id].sort((a,b)=>a-b).join('/');
      if(seen.has(key))continue;seen.add(key);
      if(a.roomId===b.roomId)continue;
      const ra=jobs.find(r=>r.id===a.roomId),rb=jobs.find(r=>r.id===b.roomId);
      if(count(ra)>ra.width*2||count(rb)>rb.width*2||count(ra)<ra.width*2&&count(rb)<rb.width*2)continue;
      const delta=Object.fromEntries(keys.map(k=>[k,0]));
      delta[types[ra.type]]+=contribution(b,ra)-contribution(a,ra);
      delta[types[rb.type]]+=contribution(a,rb)-contribution(b,rb);
      // Keep cross-resource tradeoffs for the later full-window selector. A food gain
      // may unlock a family even when the current stock goal names scrap.
      if(!keys.some(k=>delta[k]>1e-7))continue;
      pairs.push({a,b,delta});
    }
    const rows=[];let totalVariants=0;
    for(const buffer of buffers)for(const reverse of [false,true])for(const pair of pairs){
      const a=reverse?pair.b:pair.a,b=reverse?pair.a:pair.b;
      if(buffer===a.roomId||buffer===b.roomId)continue;
      totalVariants++;if(rows.length>=maxCandidates)continue;
      const key='exchange:'+a.id+':'+b.id+':'+(buffer??'idle');
      const moves=[{kind:'assign',residentId:a.id,fromRoomId:a.roomId,roomId:buffer},
        {kind:'assign',residentId:b.id,fromRoomId:b.roomId,roomId:a.roomId},
        {kind:'assign',residentId:a.id,fromRoomId:buffer,roomId:b.roomId}];
      const people=[a,b].map(p=>({residentId:p.id,from:at,until:n.book.windowEnd}));
      const seats=buffer===null?[]:[{...people[0],roomId:buffer}];
      rows.push({id:key,kind:'assign',intentId:key,intent:{id:key,purpose:'exchange for '+goal.id,people,seats},action:moves[0],
        blocked:at+2*tick>=n.book.windowEnd?[{kind:'exchange-cannot-finish-before-window'}]:[],
        continuation:{kind:'exchange-sequence',moves,expectedRates:Object.fromEntries(keys.map(k=>[k,before[k]+pair.delta[k]])),
          finalDelta:pair.delta,bufferRoomId:buffer,requiresWholePath:true}});
    }
    return {rows,coverage:{eligibleResidents:workers.map(p=>p.id),improvingPairs:pairs.length,totalVariants,
      emitted:rows.length,unemitted:totalVariants-rows.length,generationTruncated:totalVariants>rows.length,
      pairScope:'two workers in existing basic production rooms; at least one full room; any positive resource delta retains cross-resource tradeoffs',
      bufferScope:'idle or currently free basic production room; both orders',maxCandidates}};
  }
  function stage(n,intentId,action) {
    const entry=n.book.entries.find(e=>e.id===intentId);
    if(!entry)return {node:n,accepted:false,blocked:[{kind:'exchange-reservation-missing'}]};
    const p=n.view.state.residents.find(p=>p.id===action.residentId);
    if(!p||p.roomId!==action.fromRoomId)return {node:n,accepted:false,blocked:[{kind:'exchange-position-changed',residentId:action.residentId}]};
    // Reserve only the next legal destination. A future departure never frees an
    // occupied seat. Continuation keeps the sequence exclusive until its last move.
    const seats=action.roomId===null?[]:[{residentId:action.residentId,roomId:action.roomId,from:n.view.serverTime,until:n.book.windowEnd}];
    return routes.amend(n,intentId,{seats});
  }
  function check(prepared,row,{inspectNode=()=>[]}={}) {
    let n=prepared;const trace=[],minimum={...n.view.state.resources};
    for(let i=0;i<row.continuation.moves.length;i++){
      const action=row.continuation.moves[i];
      if(i){const next=routes.advance(n,n.view.serverTime+tick,{collect:true});
        for(const k of keys)minimum[k]=Math.min(minimum[k],next.metrics.minimumInventory[k]);
        if(!next.complete)return {accepted:false,blocked:next.blocked,trace,checkedMoves:i,minimum};n=next.node;}
      const ready=stage(n,row.intentId,action);
      if(!ready.accepted)return {accepted:false,blocked:ready.blocked,trace,checkedMoves:i,minimum};n=ready.node;
      const submitted=routes.submit(n,row.intentId,action,'exchange-admission:'+i+':'+n.view.serverTime);
      if(!submitted.accepted)return {accepted:false,blocked:submitted.blocked,trace,checkedMoves:i+1,minimum};
      const pending=submitted.node.pending,resolved=routes.resolve(submitted.node,{requestId:pending.requestId,intentId:row.intentId,
        fingerprint:pending.fingerprint,at:n.view.serverTime,result:'confirmed'});
      if(resolved.blocked.length)return {accepted:false,blocked:resolved.blocked,trace,checkedMoves:i+1,minimum};n=resolved.node;
      const extra=inspectNode(n);if(extra.length)return {accepted:false,blocked:extra,trace,checkedMoves:i+1,minimum};
      trace.push({at:n.view.serverTime,action,supply:routes.supply(n),inventory:{...n.view.state.resources}});
    }
    return {accepted:true,blocked:[],trace,checkedMoves:trace.length,minimum,finalRates:rates(n.view),
      collected:structuredClone(n.accounting.collected),assumptions:'simulated immediate receipts; one action and collection per ten-minute tick'};
  }
  return {enumerate,stage,check};
}
