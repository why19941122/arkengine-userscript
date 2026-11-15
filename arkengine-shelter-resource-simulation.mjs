// Deterministic resource transitions for offline development comparisons and opt-in DOM fixtures.
// Production, capacity and batching equations are independently transcribed from the saved public
// page (eP/et/tw). Consumption uses the script's explicit adult/child and room-demand contract.
// This is a conditional model: constant mood/XP/health, no random rewards, births or auto-upgrades.
// Callers must apply confirmed non-resource events between advances; it is not a server emulator.
// Room array order resolves competing feed/automatic collection here; the public projection does
// not establish server settlement order. Route selection must disclose/test that assumption.
// Rates sample each tick's start, using the supplied roster. Missing historical assignments or
// changes within a partly elapsed tick cannot be reconstructed from a later snapshot.
// Keep this factory self-contained so the same transition can run in the browser fixture.
export function createShelterResourceSimulation() {
  const tick=600000,keys=['power','food','water','scrap','parts','stimpak'],multipliers=[0,1,1.5,2.1];
  const rules={power:['str','power',12,30],diner:['agi','food',8,25],water:['per','water',8,25],
    scrap:['end','scrap',8,30],medbay:['int','stimpak',.5,2],workshop:['int','parts',.6,3]};
  const zero=()=>Object.fromEntries(keys.map(k=>[k,0]));
  const finite=n=>Number.isFinite(n)&&n>=0;
  function check(view) {
    const s=view?.state;
    if(!s||!finite(view.serverTime)||!finite(s.lastSettledAt)||s.lastSettledAt>view.serverTime||
      !Array.isArray(s.rooms)||!Array.isArray(s.residents)||!Array.isArray(s.items)||!finite(s.stats?.collected)||
      !keys.every(k=>finite(s.resources?.[k])))throw Error('Incomplete resource simulation state');
    if(s.rooms.some(r=>!multipliers[r.level]||![1,2,3].includes(r.width)||!finite(r.stored)||!finite(r.builtAt)||
      !(r.upgradeAt===null||finite(r.upgradeAt)))||
      new Set(s.rooms.map(r=>r.id)).size!==s.rooms.length)throw Error('Invalid resource simulation rooms');
    for(const p of s.residents)if(!finite(p.adultAt)||!finite(p.xp)||!finite(p.happiness)||
      !(p.away===null||p.away&&typeof p.away==='object')||!(p.deadAt===null||finite(p.deadAt))||
      !['str','per','end','cha','int','agi','lck'].every(k=>finite(p.stats?.[k])))throw Error('Invalid resource simulation resident');
    if(!Array.isArray(s.births)||s.births.some(b=>!finite(b.dueAt))||
      s.digging!=null&&!finite(s.digging.doneAt))throw Error('Invalid resource simulation future event');
    for(const k of ['storage','production'])if(!Number.isInteger(s.legacy?.perks?.[k]??0)||
      (s.legacy?.perks?.[k]??0)<0||(s.legacy?.perks?.[k]??0)>10)throw Error('Invalid resource simulation perk');
    if((view.env?.events??[]).some(e=>e.kind==='production'&&(!finite(e.startsAt)||!finite(e.endsAt)||
      e.endsAt<e.startsAt||!finite(e.percent))))throw Error('Invalid resource simulation event');
  }
  function capacities(view,at=view.serverTime) {
    const s=view.state,built=s.rooms.filter(r=>r.builtAt<=at);
    const storage=built.filter(r=>r.type==='storage').reduce((n,r)=>n+r.width*r.level,0);
    return Object.fromEntries(keys.map(k=>{
      const [base,warehouse,room]=k==='scrap'?[1500,1200,600]:k==='parts'?[100,60,40]:k==='stimpak'?[10,5,5]:[600,400,250];
      const cells=built.filter(r=>rules[r.type]?.[1]===k).reduce((n,r)=>n+r.width*multipliers[r.level],0);
      return [k,Math.floor((base+warehouse*storage+room*cells)*(1+.05*(s.legacy?.perks?.storage??0)))];
    }));
  }
  function demand(view,at) {
    const s=view.state,home=s.residents.filter(p=>p.away===null&&p.deadAt===null);
    const mouths=home.reduce((n,p)=>n+(p.adultAt<=at?1:.5),0);
    return {power:s.rooms.filter(r=>r.builtAt<=at).reduce((n,r)=>n+(['door','elevator','power'].includes(r.type)?0:
      (rules[r.type]?1:.5)*r.width*r.level),0),food:mouths,water:mouths};
  }
  function rate(view,room,at) {
    const s=view.state,rule=rules[room.type];
    if(!rule||room.builtAt>at||room.incident||room.unpowered||room.upgradeAt!==null)return 0;
    const [stat,,base]=rule,boost=Math.min(150,Math.max(100,...(view.env?.events??[])
      .filter(e=>e.kind==='production'&&e.startsAt<=at&&at<e.endsAt).map(e=>e.percent)))/100;
    const workers=s.residents.filter(p=>p.roomId===room.id&&p.away===null&&p.deadAt===null&&p.adultAt<=at).slice(0,room.width*2);
    return workers.reduce((n,p)=>{
      const bonus=s.items.find(i=>i.id===p.outfitId)?.bonus?.[stat]??0;
      if(!finite(bonus))throw Error('Invalid resource simulation outfit');
      return n+base*multipliers[room.level]*(.5+Math.min(17,p.stats[stat]+bonus)/10)*
        (.6+.4*Math.min(100,p.happiness)/100)*(1+Math.min(49,Math.floor(Math.sqrt(p.xp/3)))*.01);
    },0)*(1+.03*(s.legacy?.perks?.production??0))*boost;
  }
  function take(view,room,caps,ledger,{at=view.serverTime,sampledAt=at,method='manual'}={}) {
    const rule=rules[room.type];if(!rule)return;
    const key=rule[1],batch=rule[3]*room.width*multipliers[room.level];
    const ready=Math.floor(room.stored/batch+1e-9)*batch;
    const amount=Math.min(ready,Math.max(0,Math.floor(caps[key]-view.state.resources[key])));
    if(amount<=0)return;
    const storedBefore=room.stored;
    room.stored=Math.max(0,room.stored-amount);view.state.resources[key]+=amount;
    view.state.stats.collected+=amount;ledger.collected[key]+=amount;
    // Preserve the actual room and roster, including the distinction between tick-start
    // automatic collection and manual collection after adulthood/merges. Aggregated income
    // cannot identify the workers entitled to collection XP.
    ledger.collections.push({at,sampledAt,method,roomId:room.id,resource:key,batch,
      readyBatches:Math.round(ready/batch),amount,storedBefore,storedAfter:room.stored,
      workerIds:view.state.residents.filter(p=>p.roomId===room.id&&p.away===null&&p.deadAt===null&&p.adultAt<=sampledAt)
        .slice(0,room.width*2).map(p=>p.id)});
  }
  function storedTotals(view) {
    const stored=zero();for(const r of view.state.rooms)if(rules[r.type])stored[rules[r.type][1]]+=r.stored;
    return stored;
  }
  function ledgerFor(view) {
    return {initial:{...view.state.resources},initialStored:storedTotals(view),minimumInventory:{...view.state.resources},
      produced:zero(),collected:zero(),consumed:zero(),feed:zero(),
      unserved:zero(),roomOverflow:zero(),collections:[],feedBlockedParts:0,ticks:0,from:view.serverTime,to:view.serverTime};
  }
  function finish(view,ledger) {
    ledger.final={...view.state.resources};ledger.finalStored=storedTotals(view);
    for(const k of keys){
      if(Math.abs(ledger.initial[k]+ledger.collected[k]-ledger.consumed[k]-ledger.feed[k]-ledger.final[k])>1e-7)
        throw Error('Resource simulation conservation failed: '+k);
      if(Math.abs(ledger.initialStored[k]+ledger.produced[k]-ledger.collected[k]-ledger.finalStored[k])>1e-7)
        throw Error('Room storage conservation failed: '+k);
    }
    return {view,ledger};
  }
  function advanceResources(input,to,{scrapFloor=0}={},oneEventTick=false) {
    check(input);
    if(!finite(scrapFloor))throw Error('Invalid manufacturing scrap floor');
    if(!finite(to)||to<input.serverTime||to-input.state.lastSettledAt>86400000)
      throw Error('Advance requires monotone time and at most 24 hours; compose explicit event segments');
    // A due non-resource event needs its own explicit transition. Do not silently freeze a child
    // that ought to be born, or count production from an upgrade whose completion is unverified.
    const cutoff=oneEventTick?input.serverTime:to;
    if(input.state.births.some(b=>b.dueAt<=cutoff)||
      input.state.rooms.some(r=>r.upgradeAt!==null&&r.upgradeAt<=cutoff)||
      input.state.digging!=null&&input.state.digging.doneAt<=cutoff)
      throw Error('Non-resource event requires an explicit transition');
    const view=structuredClone(input),s=view.state,ledger=ledgerFor(view);
    while(s.lastSettledAt+tick<=to) {
      const at=s.lastSettledAt,caps=capacities(view,at),needs=demand(view,at);
      // Consumption before collection is an explicit conservative ordering assumption.
      for(const [k,hourly] of Object.entries(needs)) {
        const wanted=hourly/6,used=Math.min(wanted,s.resources[k]);
        s.resources[k]-=used;ledger.consumed[k]+=used;ledger.unserved[k]+=wanted-used;
        ledger.minimumInventory[k]=Math.min(ledger.minimumInventory[k],s.resources[k]);
      }
      for(const room of s.rooms) {
        const rule=rules[room.type];if(!rule)continue;
        const key=rule[1],batch=rule[3]*room.width*multipliers[room.level],possible=rate(view,room,at)/6;
        let made=Math.min(possible,Math.max(0,4*batch-room.stored));
        ledger.roomOverflow[key]+=possible-made;
        if(key==='parts'){
          const funded=Math.min(made,Math.max(0,s.resources.scrap-scrapFloor)/6);
          ledger.feedBlockedParts+=made-funded;made=funded;
          s.resources.scrap-=made*6;ledger.feed.scrap+=made*6;
          ledger.minimumInventory.scrap=Math.min(ledger.minimumInventory.scrap,s.resources.scrap);
        }
        room.stored+=made;ledger.produced[key]+=made;
        if(room.builtAt<=at&&(s.handies??[]).some(h=>h.floor===room.floor))
          take(view,room,caps,ledger,{at:at+tick,sampledAt:at,method:'automatic'});
      }
      s.lastSettledAt+=tick;ledger.ticks++;
    }
    view.serverTime=to;ledger.to=to;
    return finish(view,ledger);
  }
  function advance(input,to,options) {return advanceResources(input,to,options);}
  // One interval, sampled from its start, leaving its due events unprocessed. The event layer
  // must resolve those events before another tick: overdue events still fail the cutoff above.
  // No fractional initial interval is accepted because its earlier roster is unavailable.
  function settleTick(input,options) {
    check(input);
    if(input.serverTime!==input.state.lastSettledAt)throw Error('Event tick requires a settled starting snapshot');
    return advanceResources(input,input.serverTime+tick,options,true);
  }
  function collect(input,roomId=null) {
    check(input);const view=structuredClone(input),ledger=ledgerFor(view),caps=capacities(view);
    for(const r of view.state.rooms)if(r.builtAt<=view.serverTime&&(roomId===null||r.id===roomId))take(view,r,caps,ledger);
    return finish(view,ledger);
  }
  return {advance,settleTick,collect,capacities,rate,demand,storedTotals,validate:check};
}
