// Public mood targets and ten-minute relaxation, with explicit interpretations for details
// not established by the saved UI: stat basis/ties, room eligibility, sampling and rounding.
// This changes mood only. It does not invent incident outcomes, recruitment, health or XP.
export function createShelterMoodSimulation() {
  const stats=['str','per','end','cha','int','agi','lck'];
  const roomStats={door:'end',power:'str',diner:'agi',water:'per',scrap:'end',quarters:'cha',
    medbay:'int',workshop:'int',armory:'str',tailor:'cha',radio:'cha'};
  const present=(p,at)=>p.deadAt===null&&p.away===null&&p.adultAt<=at;
  const active=(r,at)=>r.builtAt<=at&&r.upgradeAt===null&&!r.incident&&!r.unpowered;
  function validate(view,rules) {
    if(!rules||!['base','equipped'].includes(rules.statBasis)||rules.matching!=='any-highest-staffed-room-stat'||
      rules.shortage!=='unserved-interval'||rules.timing!=='tick-start'||rules.rounding!=='none'||
      typeof rules.source!=='string'||!rules.source.trim())throw Error('Explicit conditional mood rules required');
    if(!Number.isInteger(view.state.legacy?.perks?.happiness??0)||(view.state.legacy?.perks?.happiness??0)<0||
      (view.state.legacy?.perks?.happiness??0)>10)throw Error('Invalid happiness legacy perk');
    for(const p of view.state.residents)if(!Number.isFinite(p.happiness)||p.happiness<0||p.happiness>100||
      !stats.every(k=>Number.isFinite(p.stats?.[k])&&p.stats[k]>=0&&p.stats[k]<=10))throw Error('Invalid mood resident state');
  }
  function step(view,unserved,rules) {
    validate(view,rules);
    if(!['food','water'].every(k=>Number.isFinite(unserved?.[k])&&unserved[k]>=0))throw Error('Mood needs interval shortage evidence');
    const s=view.state,at=view.serverTime,updates=[],events=[],blocked=[];
    const radio=s.rooms.some(r=>r.type==='radio'&&active(r,at)&&s.residents.some(p=>p.roomId===r.id&&present(p,at)));
    for(const p of s.residents){
      if(p.deadAt!==null||p.away!==null)continue;
      const r=s.rooms.find(r=>r.id===p.roomId),adult=p.adultAt<=at,reasons={base:65,legacy:s.legacy?.perks?.happiness??0};
      if(p.roomId!==null&&!r){blocked.push({kind:'mood',id:p.id,reason:'unknown-assigned-room'});continue;}
      let values={...p.stats};
      if(rules.statBasis==='equipped'&&p.outfitId!==null){
        const outfit=s.items.find(i=>i.id===p.outfitId);
        if(!outfit||!stats.every(k=>Number.isFinite(outfit.bonus?.[k]??0)&&(outfit.bonus?.[k]??0)>=0)){
          blocked.push({kind:'mood',id:p.id,reason:'unknown-outfit-for-matching'});continue;
        }
        values=Object.fromEntries(stats.map(k=>[k,Math.min(17,p.stats[k]+(outfit.bonus?.[k]??0))]));
      }
      const stat=r?.type==='training'?r.trainStat:roomStats[r?.type];
      if(r&&adult&&!['storage','elevator'].includes(r.type)&&!stats.includes(stat)){
        blocked.push({kind:'mood',id:p.id,reason:'unknown-room-matching-stat'});continue;
      }
      // Matching is earned by an actual adult slot in an operational room. Extra occupants,
      // children and a room still under construction cannot gain a free work bonus.
      const assigned=r?s.residents.filter(q=>q.roomId===r.id&&present(q,at)).slice(0,r.width*2):[];
      if(r&&adult&&active(r,at)&&assigned.some(q=>q.id===p.id)&&stat&&values[stat]===Math.max(...stats.map(k=>values[k])))reasons.matching=15;
      if(radio)reasons.radio=10;
      if(adult&&p.roomId===null)reasons.unassigned=-20;
      if(r?.incident)reasons.incident=-20;
      if(r?.unpowered)reasons.outage=-10;
      if(unserved.food>1e-9)reasons.food=-25;
      if(unserved.water>1e-9)reasons.water=-25;
      const target=Math.min(100,Math.max(5,Object.values(reasons).reduce((a,b)=>a+b,0)));
      const next=p.happiness+.05*(target-p.happiness);
      updates.push({id:p.id,before:p.happiness,after:next,target,reasons});
      if(adult&&(p.happiness>=50)!==(next>=50))events.push({kind:'family-mood-threshold',at:at+600000,id:p.id,
        from:p.happiness,to:next,meetsMoodMinimum:next>=50});
    }
    const values=updates.map(u=>u.after);
    return {updates,events,blocked,summary:{at:at+600000,radio,changed:updates.filter(u=>u.before!==u.after).length,
      min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,
      belowFamilyMood:updates.filter(u=>u.after<50&&s.residents.find(p=>p.id===u.id).adultAt<=at).length}};
  }
  return {validate,step};
}
