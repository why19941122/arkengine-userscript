// Conditional family transitions used by offline route comparisons. The public page establishes
// eligibility, charm speed, pregnancy/childhood duration, tick-start housing and cooldown.
// Callers still declare their rule version and exact child template; random outcomes and
// server ordering cannot be inferred from the public descriptions.
export function createShelterFamilySimulation() {
  const tick=600000,stats=['str','per','end','cha','int','agi','lck'];
  const id=n=>Number.isSafeInteger(n)&&n>0;
  const time=n=>Number.isSafeInteger(n)&&n>=0;
  const label=s=>typeof s==='string'&&s.trim().length>0;
  const key=parents=>[...parents].sort((a,b)=>a-b).join('/');
  const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===2&&b.length===2&&key(a)===key(b);
  const stages=['planned','romance','pregnant','born','cancelled'];
  function validate(plans,rules) {
    if(!Array.isArray(plans))throw Error('Invalid family plans');
    if(!plans.length)return;
    if(!rules||rules.romance!=='base-charm-sum-per-120-per-tick'||!label(rules.source)||
      ![rules.pregnancyMs,rules.childhoodMs,rules.cooldownMs].every(n=>time(n)&&n>=tick))
      throw Error('Explicit conditional family rules required');
    if(new Set(plans.map(p=>p.key)).size!==plans.length)throw Error('Duplicate family plan key');
    const pairs=new Set(),children=new Set(),parents=new Set();
    for(const p of plans){
      if(!label(p.key)||!label(p.source)||!Array.isArray(p.parents)||p.parents.length!==2||!p.parents.every(id)||
        p.parents[0]===p.parents[1]||!id(p.roomId)||!stages.includes(p.stage)||!p.child||!id(p.child.id)||
        !same(p.child.parents,p.parents)||![null,p.roomId].includes(p.child.roomId)||p.child.away!==null||p.child.deadAt!==null||
        p.child.romance!==null||p.child.training!==0||p.child.outfitId!==null||p.child.weaponId!==null||
        !label(p.child.name)||!Number.isFinite(p.child.hp)||p.child.hp<=0||
        !Number.isFinite(p.child.xp)||p.child.xp<0||!Number.isFinite(p.child.happiness)||p.child.happiness<0||p.child.happiness>100||
        !stats.every(k=>Number.isInteger(p.child.stats?.[k])&&p.child.stats[k]>=0&&p.child.stats[k]<=10))
        throw Error('Invalid explicit family or child template');
      if(children.has(p.child.id))throw Error('Duplicate planned child identity');children.add(p.child.id);
      if(!['born','cancelled'].includes(p.stage)){
        if(pairs.has(key(p.parents)))throw Error('Overlapping family cycles');pairs.add(key(p.parents));
        for(const id of p.parents){if(parents.has(id))throw Error('Parent has overlapping family plans');parents.add(id);}
      }
      for(const field of ['startedAt','conceivedAt','dueAt','bornAt','pausedAt'])if(p[field]!==undefined&&!time(p[field]))
        throw Error('Invalid family event time');
      if(['pregnant','born'].includes(p.stage)&&(!time(p.conceivedAt)||!time(p.dueAt)||p.dueAt<=p.conceivedAt))
        throw Error('Incomplete confirmed family cycle');
    }
  }
  function ancestry(view,residentId,path=new Set()) {
    const p=view.state.residents.find(p=>p.id===residentId);
    if(!p||path.has(residentId)||!Array.isArray(p.parents)||![0,2].includes(p.parents.length)||
      !p.parents.every(id)||new Set(p.parents).size!==p.parents.length)return null;
    const result=new Set([residentId]),next=new Set([...path,residentId]);
    for(const parent of p.parents){const ancestors=ancestry(view,parent,next);if(!ancestors)return null;for(const a of ancestors)result.add(a);}
    return result;
  }
  function eligibility(view,plan,{ignoreLocation=false,existing=false}={}) {
    const s=view.state,at=view.serverTime,blocked=[],pair=plan.parents.map(id=>s.residents.find(p=>p.id===id));
    const room=s.rooms.find(r=>r.id===plan.roomId);
    const issue=reason=>blocked.push({kind:'family',key:plan.key,reason});
    if(pair.some(p=>!p)){issue('missing-parent');return blocked;}
    const left=ancestry(view,pair[0].id),right=ancestry(view,pair[1].id);
    if(!left||!right)issue('unknown-ancestry');else if([...left].some(id=>right.has(id)))issue('related-parents');
    for(const p of pair){
      const maxHp=Math.round(100+Math.min(49,Math.floor(Math.sqrt(p.xp/3)))*(2+.5*p.stats.end));
      if(p.away!==null||p.deadAt!==null||p.adultAt>at||!Number.isFinite(p.hp)||p.hp<.6*maxHp)issue('parent-unavailable');
      if(!Number.isFinite(p.happiness)||p.happiness<50)issue('low-happiness');
      if(!(p.familyCooldownUntil==null||time(p.familyCooldownUntil)))issue('unknown-cooldown');
      else if(p.familyCooldownUntil>at)issue('cooldown');
      if(p.romance&&(!existing||p.romance.partnerId!==pair.find(q=>q.id!==p.id).id))issue('other-romance');
      if(!ignoreLocation&&p.roomId!==plan.roomId)issue('parents-not-together');
      if(!Number.isFinite(p.stats.cha)||p.stats.cha<0)issue('unknown-charm');
    }
    if(!room||room.type!=='quarters'||room.builtAt>at||room.upgradeAt!==null||room.incident||room.unpowered)issue('quarters-unavailable');
    if(!existing&&s.births.some(b=>b.roomId===plan.roomId||b.parents?.some(id=>plan.parents.includes(id))))issue('pending-birth');
    if(!existing&&s.residents.some(p=>p.deadAt===null&&p.adultAt<=at&&p.roomId===plan.roomId&&!plan.parents.includes(p.id)))
      issue('quarters-not-cleared');
    if(s.residents.some(p=>p.id===plan.child.id)&&plan.stage!=='born')issue('child-identity-already-used');
    return blocked;
  }
  function prepare(view,plans,rules) {
    validate(plans,rules);const next=structuredClone(plans),s=view.state,at=view.serverTime,end=at+tick;
    const blocked=[],paused=[],updates=[],births=[],outcomes=[],events=[];
    const issue=(p,reason)=>blocked.push({kind:'family',key:p?.key??null,reason});
    const expected=new Set(next.filter(p=>p.stage==='romance').flatMap(p=>p.parents));
    for(const p of s.residents)if(p.romance&&!expected.has(p.id))issue(null,'unregistered-romance');
    const capacity=Math.min(200,s.rooms.filter(r=>r.type==='quarters'&&r.builtAt<=at)
      .reduce((n,r)=>n+r.width*(2+2*r.level),0));
    let occupied=s.residents.length+s.births.length;
    // Competing simultaneous cycles cannot silently take the last bed by array order.
    const ready=[];
    for(const p of next){
      if(['cancelled','born'].includes(p.stage))continue;
      if(p.stage==='pregnant'){
        if(!s.births.some(b=>b.dueAt===p.dueAt&&same(b.parents,p.parents)))issue(p,'confirmed-pregnancy-missing');
        continue;
      }
      if(p.stage==='planned'){
        if(!p.parents.every(id=>s.residents.some(q=>q.id===id&&q.roomId===p.roomId)))continue;
        const reasons=eligibility(view,p);if(reasons.length){paused.push(...reasons);continue;}
        p.stage='romance';p.startedAt=end;
        updates.push(...p.parents.map((id,i)=>({id,romance:{partnerId:p.parents[1-i],progress:0}})));
        events.push({kind:'romance-start',at:end,key:p.key,parents:[...p.parents],roomId:p.roomId,source:p.source});
        continue;
      }
      const pair=p.parents.map(id=>s.residents.find(q=>q.id===id));
      if(pair.some((q,i)=>!q?.romance||q.romance.partnerId!==p.parents[1-i]||
        !Number.isFinite(q.romance.progress)||q.romance.progress<0||q.romance.progress>1)||
        Math.abs(pair[0]?.romance?.progress-pair[1]?.romance?.progress)>1e-9){issue(p,'romance-state-mismatch');continue;}
      const reasons=eligibility(view,p,{existing:true});
      if(reasons.length){
        p.pausedAt??=at;paused.push(...reasons);
        // The page permits partner changes after a long pause. No deterministic re-pairing
        // rule is known; do not keep a convenient old pair if a competing single is present.
        const parentRooms=new Set(pair.map(q=>q.roomId).filter(roomId=>s.rooms.some(r=>r.id===roomId&&r.type==='quarters')));
        if(end-p.pausedAt>1800000&&s.residents.some(q=>!p.parents.includes(q.id)&&q.deadAt===null&&q.away===null&&
          q.adultAt<=at&&parentRooms.has(q.roomId)&&!q.romance))issue(p,'paused-repairing-rule-unknown');
        continue;
      }
      delete p.pausedAt;
      const progress=Math.min(1,pair[0].romance.progress+(pair[0].stats.cha+pair[1].stats.cha)/120);
      updates.push(...pair.map(q=>({id:q.id,romance:{partnerId:q.romance.partnerId,progress}})));
      if(progress>=1-1e-9)ready.push(p);
    }
    if(ready.length>Math.max(0,capacity-occupied)&&capacity>occupied){
      issue(null,'simultaneous-pregnancies-exceed-known-capacity');return {plans:next,blocked,paused,updates:[],births:[],outcomes:[],events:[]};
    }
    for(const p of ready){
      if(occupied>=capacity){paused.push({kind:'family',key:p.key,reason:'beds-at-tick-start'});continue;}
      occupied++;p.stage='pregnant';p.conceivedAt=end;p.dueAt=end+rules.pregnancyMs;
      const birth={roomId:p.roomId,parents:[...p.parents],dueAt:p.dueAt};births.push(birth);
      outcomes.push({...birth,resident:{...structuredClone(p.child),adultAt:p.dueAt+rules.childhoodMs,familyCooldownUntil:0},source:p.source});
      for(const id of p.parents){
        const update=updates.find(u=>u.id===id);update.romance=null;update.familyCooldownUntil=end+rules.cooldownMs;
      }
      events.push({kind:'pregnancy',at:end,key:p.key,parents:[...p.parents],roomId:p.roomId,dueAt:p.dueAt,
        childId:p.child.id,source:p.source});
    }
    return {plans:next,blocked,paused,updates,births,outcomes,events};
  }
  return {validate,eligibility,prepare};
}
