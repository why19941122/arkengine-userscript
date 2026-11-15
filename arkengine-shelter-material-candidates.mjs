import {createShelterRouteSimulation} from './arkengine-shelter-route-simulation.mjs';
import {createShelterResourceSimulation} from './arkengine-shelter-resource-simulation.mjs';
import {createShelterReservations} from './arkengine-shelter-reservations.mjs';

// Explicit new upgrade purposes. No invented inherited role, future inventory or payment.
export function createShelterMaterialCandidates() {
  const routes=createShelterRouteSimulation(),resources=createShelterResourceSimulation(),holds=createShelterReservations();
  const basic=['power','diner','water','scrap'];
  const active=e=>!['complete','cancelled'].includes(e.status);
  const usable=(r,at)=>r&&r.builtAt<=at&&r.upgradeAt===null&&!r.incident&&!r.unpowered;
  const present=(p,at)=>p.deadAt===null&&p.away===null&&p.adultAt<=at;
  const claim=(n,id)=>({residentId:id,from:n.view.serverTime,until:n.book.windowEnd});
  function conflicts(n,intentId) {
    const blocked=[];
    if(n.existing?.materialPurpose&&!['complete','cancelled'].includes(n.existing.material?.status))
      blocked.push({kind:'existing-material-purpose-active'});
    if(n.book.entries.some(e=>active(e)&&e.id!==intentId&&e.purpose.startsWith('new upgrade materials for ')))
      blocked.push({kind:'material-purpose-already-active'});
    return blocked;
  }
  function refresh(n,intentId,spec) {
    const blocked=conflicts(n,intentId),at=n.view.serverTime,s=n.view.state;
    const e=n.book.entries.find(e=>e.id===intentId&&active(e)),r=s.rooms.find(r=>r.id===spec.project.roomId);
    if(!e||e.status!=='held')return {node:n,accepted:false,blocked:[{kind:'material-reservation-unavailable'}]};
    if(!usable(r,at)||r.level!==spec.project.fromLevel||r.width!==spec.width||r.type!==spec.type)
      blocked.push({kind:'material-target-changed'});
    const owned=new Set(e.people.filter(c=>c.from<=at&&at<c.until).map(c=>c.residentId));
    for(const p of s.residents)if(present(p,at)&&s.rooms.some(r=>r.id===p.roomId&&r.type==='workshop'&&usable(r,at))&&
      (!owned.has(p.id)||!spec.workers.some(w=>w.residentId===p.id&&w.workshopId===p.roomId)))
      blocked.push({kind:'manufacturing-owner-conflict',residentId:p.id});
    for(const id of spec.rooms)if(!s.rooms.some(r=>r.id===id&&r.type==='workshop'&&usable(r,at)))
      blocked.push({kind:'material-workshop-unavailable',roomId:id});
    if(blocked.length)return {node:n,accepted:false,blocked};
    const view=holds.inspect(n.view,n.book,{owner:intentId});
    const scrap=Math.max(0,view.ownSpendable.scrap+e.feedScrap),parts=Math.max(0,view.ownSpendable.parts);
    const allocation={scrap:Math.min(spec.cost.scrap,scrap),parts:Math.min(spec.cost.parts,parts)};
    let projected=n.view,collectable=0;
    for(const roomId of spec.rooms){const got=resources.collect(projected,roomId);projected=got.view;collectable+=got.ledger.collected.parts;}
    const missing=Math.max(0,spec.cost.parts-allocation.parts);
    const need=missing>collectable+1e-7?spec.rooms.reduce((sum,id)=>sum+resources.rate(n.view,s.rooms.find(r=>r.id===id),at),0):0;
    const feedScrap=Math.min(Math.max(0,scrap-allocation.scrap),need);
    const updated=routes.amend(n,intentId,{resources:allocation,feedScrap});
    return {...updated,material:{allocation,feedScrap,collectable,missing,
      partsReady:missing<1e-7,ready:missing<1e-7&&allocation.scrap>=spec.cost.scrap-1e-7}};
  }
  function enumerate(n,{proof,goal,cost,people,maxCandidates=2000}) {
    if(proof.action.kind!=='upgrade'||!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>2000)
      throw Error('Bounded new upgrade material evidence required');
    const at=n.view.serverTime,s=n.view.state,target=s.rooms.find(r=>r.id===proof.action.roomId);
    const workshops=s.rooms.filter(r=>r.type==='workshop'&&usable(r,at)).sort((a,b)=>a.id-b.id);
    const jobs=s.rooms.filter(r=>basic.includes(r.type)&&usable(r,at)).sort((a,b)=>a.id-b.id);
    const occupants=s.residents.filter(p=>present(p,at)&&workshops.some(r=>r.id===p.roomId)).sort((a,b)=>a.id-b.id);
    const book=holds.inspect(n.view,n.book),blocked=conflicts(n,null);
    for(const p of occupants){
      const maxHp=Math.round(100+Math.min(49,Math.floor(Math.sqrt(p.xp/3)))*(2+.5*p.stats.end));
      if(p.romance||!Number.isFinite(p.hp)||p.hp<.6*maxHp||book.people.some(c=>c.residentId===p.id)||
        n.existing?.roles.some(r=>r.residentId===p.id&&['active','return-due','preempted'].includes(r.status))||
        n.existing?.defense.some(d=>d.id===p.id))blocked.push({kind:'material-worker-unavailable',residentId:p.id});
    }
    const donors=people.filter(x=>x.eligible&&!x.intentId&&(!x.p.roomId||s.rooms.some(r=>r.id===x.p.roomId&&
      [...basic,'quarters'].includes(r.type)))).map(x=>x.p);
    const free=book.free,groups=[{workers:occupants.map(p=>({residentId:p.id,workshopId:p.roomId,fromRoomId:p.roomId})),arrival:null}];
    if(cost.parts>free.parts+1e-7)for(const donor of donors)for(const room of workshops){
      if(s.residents.filter(p=>p.roomId===room.id&&p.deadAt===null&&p.adultAt<=at).length>=room.width*2)continue;
      groups.push({workers:[...groups[0].workers,{residentId:donor.id,workshopId:room.id,fromRoomId:donor.roomId}],
        arrival:{kind:'assign',residentId:donor.id,fromRoomId:donor.roomId,roomId:room.id}});
    }
    const rows=[];let totalVariants=0;
    // Existing workers, optionally one new donor. Rotate a deterministic return allocation
    // across all basic jobs; report this limited family instead of claiming all permutations.
    for(let rotation=0;rotation<Math.max(1,jobs.length);rotation++)for(const group of groups){
      if(!group.workers.length&&rotation)continue;
      totalVariants++;if(rows.length>=maxCandidates)continue;
      const occupied=new Map(jobs.map(r=>[r.id,new Set(s.residents.filter(p=>p.roomId===r.id&&p.deadAt===null&&p.adultAt<=at).map(p=>p.id))]));
      const workers=group.workers.map(w=>({...w})),reasons=[...blocked];
      for(const w of workers){
        const original=jobs.find(r=>r.id===w.fromRoomId),ordered=[...jobs.slice(rotation),...jobs.slice(0,rotation)];
        const room=original??ordered.find(r=>occupied.get(r.id).size<r.width*2);
        if(!room){reasons.push({kind:'material-return-seat-missing',residentId:w.residentId});continue;}
        w.returnRoomId=room.id;occupied.get(room.id).add(w.residentId);
      }
      let projected=n.view,collectable=0;
      for(const r of workshops){const got=resources.collect(projected,r.id);projected=got.view;collectable+=got.ledger.collected.parts;}
      if(cost.parts>free.parts+collectable+1e-7&&!workers.length)reasons.push({kind:'material-manufacturing-worker-needed'});
      if(cost.parts>free.parts+collectable+1e-7&&!workshops.length)reasons.push({kind:'material-workshop-needed'});
      const key='material:'+proof.id+':'+(group.arrival?group.arrival.residentId+':'+group.arrival.roomId:'existing')+':'+rotation;
      const project={...structuredClone(proof.action),source:proof.source};delete project.finishAt;
      const spec={project,durationMs:proof.durationMs,
        cost:{...cost},type:target.type,width:target.width,goalId:goal.id,source:proof.source,workers,rooms:workshops.map(r=>r.id)};
      rows.push({id:key,kind:'project',intentId:key,intent:{id:key,purpose:'new upgrade materials for '+goal.id,
        people:workers.map(w=>claim(n,w.residentId)),seats:workers.map(w=>({...claim(n,w.residentId),roomId:w.workshopId})),
        resources:{scrap:Math.min(cost.scrap,Math.max(0,free.scrap)),parts:Math.min(cost.parts,Math.max(0,free.parts))}},
        action:group.arrival,blocked:reasons,continuation:{kind:'material-upgrade',spec}});
    }
    return {rows,coverage:{totalVariants,emitted:rows.length,unemitted:totalVariants-rows.length,generationTruncated:totalVariants>rows.length,
      scope:'all existing unreserved workshop workers, optionally one basic/idle donor; rotated greedy return seats; existing upgrades only'}};
  }
  function prepare(n,row) {
    const result=refresh(n,row.intentId,row.continuation.spec);if(!result.accepted)return result;
    const blocked=Object.entries(routes.supply(result.node)).filter(([,v])=>v.deficit>1e-7||v.inventoryGap>1e-7)
      .map(([resource])=>({kind:'material-investment-supply-not-covered',resource}));
    return blocked.length?{node:n,accepted:false,blocked}:result;
  }
  return {enumerate,prepare,refresh};
}
