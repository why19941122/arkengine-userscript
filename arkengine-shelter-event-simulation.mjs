import {createShelterResourceSimulation} from './arkengine-shelter-resource-simulation.mjs';
import {createShelterFamilySimulation} from './arkengine-shelter-family-simulation.mjs';
import {createShelterMoodSimulation} from './arkengine-shelter-mood-simulation.mjs';
import {createShelterXpSimulation} from './arkengine-shelter-xp-simulation.mjs';

// Conditional, deterministic natural-event progression for D.14. This is an offline model,
// not a server emulator and not an action executor. Every run declares the same timing,
// training remainder and merge assumptions for all compared routes. Unknown outcomes stop
// before their interval; no fake children, elevator IDs or training progress are synthesized.
export function createShelterEventSimulation() {
  const resources=createShelterResourceSimulation(),family=createShelterFamilySimulation(),mood=createShelterMoodSimulation(),tick=600000;
  const xp=createShelterXpSimulation();
  const stats=['str','per','end','cha','int','agi','lck'];
  const keys=['power','food','water','scrap','parts','stimpak'];
  const zero=()=>Object.fromEntries(keys.map(k=>[k,0]));
  const id=n=>Number.isSafeInteger(n)&&n>0;
  const time=n=>Number.isSafeInteger(n)&&n>=0;
  const sameParents=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===2&&b.length===2&&
    a[0]!==a[1]&&a.every(id)&&b.every(id)&&a.every(p=>b.includes(p));
  const sameBirth=(a,b)=>a.roomId===b.roomId&&a.dueAt===b.dueAt&&sameParents(a.parents,b.parents);
  const active=(r,at)=>r.builtAt<=at&&r.upgradeAt===null&&!r.incident&&!r.unpowered;
  function validate(view,assumptions,outcomes) {
    resources.validate(view);const s=view.state;
    if(!assumptions||assumptions.eventTiming!=='tick-end'||assumptions.trainingOverflow!=='reset'||
      assumptions.merge!=='left-neighbor'||typeof assumptions.source!=='string'||!assumptions.source.trim())
      throw Error('Explicit conditional timing, training and merge assumptions required');
    if(view.serverTime!==s.lastSettledAt)throw Error('Event simulation needs a settled snapshot; missing tick history');
    if(!Number.isInteger(s.depth)||s.depth<1||s.rooms.some(r=>!id(r.id)||!Number.isInteger(r.floor)||r.floor<1||
      !Number.isInteger(r.col)||r.col<0)||s.residents.some(p=>!id(p.id))||
      new Set(s.residents.map(p=>p.id)).size!==s.residents.length)throw Error('Invalid event simulation identities or layout');
    if(!outcomes||!Array.isArray(outcomes.births)||!Array.isArray(outcomes.digs))throw Error('Explicit outcome lists required');
    for(const [i,b] of outcomes.births.entries())if(!time(b.dueAt)||!id(b.roomId)||!sameParents(b.parents,b.parents)||
      !b.resident||typeof b.source!=='string'||!b.source.trim()||outcomes.births.slice(0,i).some(a=>sameBirth(a,b)))
      throw Error('Invalid or duplicate birth outcome');
    for(const [i,d] of outcomes.digs.entries())if(!time(d.doneAt)||!Number.isInteger(d.floor)||d.floor<2||
      !d.elevator||typeof d.source!=='string'||!d.source.trim()||outcomes.digs.slice(0,i).some(a=>a.floor===d.floor&&a.doneAt===d.doneAt))
      throw Error('Invalid or duplicate digging outcome');
  }
  function progress(view) {
    const s=view.state,at=view.serverTime;
    const score=2*s.residents.filter(p=>p.deadAt===null).length+3*s.depth+s.rooms
      .filter(r=>r.builtAt<=at&&!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
    let level=1;while(score>=30+Math.ceil(2.25*level*level))level++;
    return {level,score,next:30+Math.ceil(2.25*level*level)};
  }
  function dueIssues(view,end,outcomes,familyPlans=[]) {
    const s=view.state,start=view.serverTime,issues=[];
    const issue=(kind,target,at,reason)=>issues.push({kind,target,at,reason});
    const usedPeople=new Set(s.residents.map(p=>p.id)),usedRooms=new Set(s.rooms.map(r=>r.id));
    if(view.switches?.frozen)issue('shelter',null,start,'frozen-shelter');
    for(const b of s.births){
      if(b.dueAt<=start){issue('birth',b.roomId,b.dueAt,'overdue-event-needs-snapshot');continue;}
      if(b.dueAt>end)continue;
      const o=outcomes.births.find(o=>sameBirth(o,b)),p=o?.resident;
      if(!o){issue('birth',b.roomId,b.dueAt,'missing-child-outcome');continue;}
      if(!id(p.id)||usedPeople.has(p.id)||!sameParents(p.parents,b.parents)||!time(p.adultAt)||p.adultAt<=end||
        !(p.roomId===null||p.roomId===b.roomId&&s.rooms.some(r=>r.id===b.roomId&&r.type==='quarters'))||
        p.deadAt!==null||p.away!==null||p.romance!==null||p.training!==0||
        p.outfitId!==null||p.weaponId!==null||!Number.isFinite(p.hp)||p.hp<=0||
        !stats.every(k=>Number.isInteger(p.stats?.[k])&&p.stats[k]>=0&&p.stats[k]<=10)||
        !Number.isFinite(p.xp)||p.xp<0||!Number.isFinite(p.happiness)||p.happiness<0||p.happiness>100)
        issue('birth',b.roomId,b.dueAt,'invalid-or-conflicting-child-outcome');
      usedPeople.add(p.id);
    }
    for(const r of s.rooms)if(r.upgradeAt!==null){
      if(r.upgradeAt<=start)issue('upgrade',r.id,r.upgradeAt,'overdue-event-needs-snapshot');
      else if(r.upgradeAt<=end&&(r.level>=3||r.builtAt>start))issue('upgrade',r.id,r.upgradeAt,'invalid-upgrade-state');
    }
    // A merge would change the identity referenced by pending family/crafting outcomes.
    // Until those dependencies have a remapping contract, stop before changing their room.
    const after=s.rooms.map(r=>({...r,level:r.level+(r.upgradeAt!==null&&r.upgradeAt<=end?1:0),
      upgradeAt:r.upgradeAt!==null&&r.upgradeAt<=end?null:r.upgradeAt}));
    for(const original of s.rooms.filter(r=>r.builtAt>start&&r.builtAt<=end||r.upgradeAt!==null&&r.upgradeAt<=end)){
      const r=after.find(r=>r.id===original.id),left=after.find(l=>l.id!==r.id&&l.floor===r.floor&&
        !l.separate&&!r.separate&&l.col+l.width===r.col&&l.type===r.type&&l.level===r.level&&l.width+r.width<=3&&active(l,end)&&active(r,end)&&
        (r.type!=='training'||l.trainStat===r.trainStat));
      if(left&&(s.births.some(b=>b.roomId===r.id||b.roomId===left.id)||r.craft||left.craft||
        familyPlans.some(p=>!['born','cancelled'].includes(p.stage)&&[r.id,left.id].includes(p.roomId))))
        issue('merge',r.id,end,'dependent-room-outcome-remap-not-modeled');
    }
    const d=s.digging;
    if(d&&d.doneAt<=start)issue('dig',d.floor,d.doneAt,'overdue-event-needs-snapshot');
    else if(d&&d.doneAt<=end){
      const o=outcomes.digs.find(o=>o.floor===d.floor&&o.doneAt===d.doneAt),r=o?.elevator;
      if(!o)issue('dig',d.floor,d.doneAt,'missing-elevator-outcome');
      else if(d.floor!==s.depth+1||!id(r.id)||usedRooms.has(r.id)||r.type!=='elevator'||r.floor!==d.floor||
        r.col!==1||r.width!==1||r.level!==1||r.builtAt!==d.doneAt||r.upgradeAt!==null||r.stored!==0||r.incident||r.unpowered)
        issue('dig',d.floor,d.doneAt,'invalid-or-conflicting-elevator-outcome');
    }
    for(const p of s.residents)if(p.romance&&!familyPlans.some(f=>f.stage==='romance'&&f.parents.includes(p.id)))
      issue('romance',p.id,start,'future-romance-rule-not-supplied');
    for(const r of s.rooms){
      if(r.incident)issue('incident',r.id,start,'incident-evolution-not-modeled');
      if(r.type==='radio'&&active(r,start)&&s.residents.some(p=>p.roomId===r.id&&p.deadAt===null&&p.away===null&&p.adultAt<=start)){
        const capacity=Math.min(200,s.rooms.filter(q=>q.type==='quarters'&&q.builtAt<=start).reduce((n,q)=>n+q.width*(2+2*q.level),0));
        if(s.residents.length+s.births.length<capacity)issue('radio',r.id,start,'recruitment-outcome-not-modeled');
      }
      if(r.craft&&(!time(r.craft.doneAt)||r.craft.doneAt<=end))issue('craft',r.id,r.craft.doneAt,'craft-outcome-not-supplied');
    }
    for(const e of s.explorers??[])if(e.returnAt===null||!time(e.returnAt)||e.returnAt<=end)
      issue('explorer',e.id,e.returnAt,'exploration-outcome-not-supplied');
    for(const q of s.quests??[])if(!time(q.nextStageAt)||q.nextStageAt<=end||q.returnAt!=null&&q.returnAt<=end)
      issue('quest',q.id,q.nextStageAt,'quest-outcome-not-supplied');
    return issues;
  }
  // Shared with native-decision window tests. Missing observations remain blocked;
  // neither an unknown attribute nor missing progress can become a fresh course.
  function trainingStep(view,assumptions) {
    if(assumptions?.trainingOverflow!=='reset'||typeof assumptions.source!=='string'||!assumptions.source.trim())
      throw Error('Explicit conditional training assumptions required');
    const s=view.state,start=view.serverTime,perk=s.legacy?.perks?.training??0,updates=[],blocked=[];
    for(const r of s.rooms.filter(r=>r.type==='training'&&active(r,start)))for(const p of s.residents
      .filter(p=>p.roomId===r.id&&p.away===null&&p.deadAt===null&&p.adultAt<=start).slice(0,r.width*2)){
      const base=p.stats[r.trainStat];
      if(!stats.includes(r.trainStat)||!Number.isInteger(base)||base<0||base>10||
        !Number.isInteger(perk)||perk<0||perk>10||base<10&&(!Number.isFinite(p.training)||p.training<0||p.training>=1)){
        blocked.push({kind:'training',target:p.id,at:start,reason:'unknown-training-state'});continue;
      }
      if(base<10)updates.push({id:p.id,stat:r.trainStat,base,
        progress:p.training+r.level*(1+.05*perk)/(base+1)/6});
    }
    return {updates,blocked};
  }
  function mergeCompleted(view,completed,events) {
    const s=view.state,at=view.serverTime;
    // Explicit conditional rule, matching the existing long-development fixture: only a
    // finished compatible left neighbor. Stored products and resident identities survive.
    const ordered=[...new Set(completed)].sort((a,b)=>{
      const ra=s.rooms.find(r=>r.id===a),rb=s.rooms.find(r=>r.id===b);
      return ra.floor-rb.floor||ra.col-rb.col||ra.id-rb.id;
    });
    for(const roomId of ordered){
      const r=s.rooms.find(r=>r.id===roomId);if(!r||r.separate||['door','elevator'].includes(r.type)||!active(r,at))continue;
      const left=s.rooms.find(l=>l.id!==r.id&&l.floor===r.floor&&l.col+l.width===r.col&&l.type===r.type&&
        !l.separate&&l.level===r.level&&l.width+r.width<=3&&active(l,at)&&(r.type!=='training'||l.trainStat===r.trainStat));
      if(!left)continue;
      left.width+=r.width;left.stored+=r.stored;
      for(const p of s.residents)if(p.roomId===r.id)p.roomId=left.id;
      s.rooms=s.rooms.filter(x=>x.id!==r.id);
      events.push({kind:'merge',at,roomId:r.id,into:left.id,width:left.width});
    }
  }
  function advance(input,to,{assumptions,outcomes={births:[],digs:[]},familyPlans=[],familyRules=null,moodRules=null,xpRules=null,scrapFloor=0,collect=false,stopAtEvent=false}={}) {
    validate(input,assumptions,outcomes);
    family.validate(familyPlans,familyRules);
    if(moodRules!==null)mood.validate(input,moodRules);
    if(xpRules!==null)xp.validate(input,xpRules);
    if(!time(to)||to<input.serverTime||to-input.serverTime>168*3600000||(to-input.serverTime)%tick!==0)
      throw Error('Event horizon must use whole ticks, monotone time and at most 168 hours');
    if(typeof collect!=='boolean'||typeof stopAtEvent!=='boolean'||!Number.isFinite(scrapFloor)||scrapFloor<0)
      throw Error('Invalid event simulation options');
    let view=structuredClone(input),plans=structuredClone(familyPlans),known=structuredClone(outcomes);
    const events=[],segments=[],blocked=[],familyPauses=[];
    let lastMood=null,lastXp=null;
    const earnedXp={duty:0,collection:0};
    const ledger={initial:{...view.state.resources},initialStored:resources.storedTotals(view),final:null,
      produced:zero(),collected:zero(),consumed:zero(),feed:zero(),
      unserved:zero(),roomOverflow:zero(),collections:[],minimumInventory:{...view.state.resources},feedBlockedParts:0,ticks:0};
    function accumulate(l){
      for(const k of keys){for(const field of ['produced','collected','consumed','feed','unserved','roomOverflow'])ledger[field][k]+=l[field][k];
        ledger.minimumInventory[k]=Math.min(ledger.minimumInventory[k],l.minimumInventory[k]);}
      ledger.feedBlockedParts+=l.feedBlockedParts;ledger.ticks+=l.ticks;
      ledger.collections.push(...l.collections);
    }
    while(view.serverTime<to){
      const start=view.serverTime,end=start+tick,s=view.state,issues=dueIssues(view,end,known,plans);
      const familyStep=plans.length?family.prepare(view,plans,familyRules):null;
      if(familyStep)issues.push(...familyStep.blocked);
      const dutyStep=xpRules===null?null:xp.duty(view,xpRules);
      if(dutyStep)issues.push(...dutyStep.blocked);
      const training=trainingStep(view,assumptions);issues.push(...training.blocked);
      if(issues.length){blocked.push(...issues);break;}
      const beforeEvents=events.length;
      const tickEvents=[],awards=dutyStep?[...dutyStep.awards]:[];
      const step=resources.settleTick(view,{scrapFloor});
      const moodStep=moodRules===null?null:mood.step(view,step.ledger.unserved,moodRules);
      if(moodStep?.blocked.length){blocked.push(...moodStep.blocked);break;}
      const autoXp=xpRules===null?null:xp.collection(step.view,step.ledger.collections,xpRules);
      if(autoXp?.blocked.length){blocked.push(...autoXp.blocked);break;}
      if(autoXp)awards.push(...autoXp.awards);
      let nextView=step.view;
      const next=nextView.state,completed=[],nextKnown=structuredClone(known);
      let nextPlans=structuredClone(plans);
      if(xpRules!==null)xp.apply(nextView,awards);
      if(moodStep){
        for(const update of moodStep.updates)next.residents.find(p=>p.id===update.id).happiness=update.after;
        tickEvents.push(...moodStep.events);
      }
      if(familyStep){
        for(const update of familyStep.updates){const {id,...changes}=update;Object.assign(next.residents.find(p=>p.id===id),changes);}
        next.births.push(...familyStep.births);nextKnown.births.push(...familyStep.outcomes);nextPlans=familyStep.plans;
        tickEvents.push(...familyStep.events);
      }
      for(const t of training.updates){
        const p=next.residents.find(p=>p.id===t.id);
        if(t.progress>=1-1e-9){p.stats[t.stat]++;p.training=0;tickEvents.push({kind:'training',at:end,id:p.id,stat:t.stat,from:t.base,to:p.stats[t.stat]});}
        else p.training=t.progress;
      }
      for(const r of next.rooms){
        if(r.upgradeAt!==null&&r.upgradeAt<=end){
          const dueAt=r.upgradeAt;r.upgradeAt=null;r.level++;completed.push(r.id);
          tickEvents.push({kind:'upgrade',at:end,dueAt,roomId:r.id,level:r.level});
        }
        if(r.builtAt>start&&r.builtAt<=end){completed.push(r.id);tickEvents.push({kind:'build',at:end,dueAt:r.builtAt,roomId:r.id});}
      }
      if(next.digging&&next.digging.doneAt<=end){
        const d=next.digging,o=nextKnown.digs.find(o=>o.floor===d.floor&&o.doneAt===d.doneAt);
        next.depth=d.floor;next.rooms.push(structuredClone(o.elevator));next.digging=null;
        tickEvents.push({kind:'dig',at:end,dueAt:d.doneAt,floor:d.floor,roomId:o.elevator.id,source:o.source});
      }
      for(const b of [...next.births])if(b.dueAt<=end){
        const o=nextKnown.births.find(o=>sameBirth(o,b));next.residents.push(structuredClone(o.resident));
        next.births.splice(next.births.indexOf(b),1);
        tickEvents.push({kind:'birth',at:end,dueAt:b.dueAt,id:o.resident.id,adultAt:o.resident.adultAt,parents:[...b.parents],source:o.source});
        for(const p of nextPlans)if(p.stage==='pregnant'&&p.dueAt===b.dueAt&&sameParents(p.parents,b.parents)){
          p.stage='born';p.bornAt=end;
        }
      }
      for(const p of next.residents)if(p.deadAt===null&&p.adultAt>start&&p.adultAt<=end)
        tickEvents.push({kind:'adult',at:end,dueAt:p.adultAt,id:p.id});
      for(const e of view.env?.events??[])if(e.kind==='production'){
        if(e.startsAt>start&&e.startsAt<=end)tickEvents.push({kind:'production-modifier-start',at:end,dueAt:e.startsAt,percent:e.percent});
        if(e.endsAt>start&&e.endsAt<=end)tickEvents.push({kind:'production-modifier-end',at:end,dueAt:e.endsAt,percent:e.percent});
      }
      mergeCompleted(nextView,completed,tickEvents);
      nextView.progress={...nextView.progress,...progress(nextView)};
      resources.validate(nextView);
      // Manual collection is a modeled action at the interval end, after natural transitions.
      // It must be explicitly requested and carries no implication of real browser execution.
      let manual=null;
      if(collect){
        manual=resources.collect(nextView);nextView=manual.view;
        if(xpRules!==null){
          const manualXp=xp.collection(nextView,manual.ledger.collections,xpRules);
          if(manualXp.blocked.length){blocked.push(...manualXp.blocked);break;}
          xp.apply(nextView,manualXp.awards);awards.push(...manualXp.awards);
        }
      }
      const xpStep=xpRules===null?null:xp.changes(view,nextView,awards);
      // Commit one whole tick only after all modeled transitions are known. In particular,
      // partial-collection uncertainty cannot leak production, births, XP or ledger changes.
      view=nextView;known=nextKnown;plans=nextPlans;accumulate(step.ledger);
      if(manual)accumulate(manual.ledger);
      if(moodStep)lastMood=moodStep;
      if(xpStep){tickEvents.push(...xpStep.events);lastXp=xpStep;
        earnedXp.duty+=xpStep.summary.duty;earnedXp.collection+=xpStep.summary.collection;}
      events.push(...tickEvents);
      if(familyStep)familyPauses.push(...familyStep.paused.map(p=>({...p,at:end})));
      segments.push({from:start,to:end,events:events.slice(beforeEvents),progress:{...view.progress},
        resources:{...view.state.resources},demand:resources.demand(view,end),...(moodStep?{mood:moodStep.summary}:{}),
        ...(xpStep?{xp:xpStep.summary}:{})});
      if(stopAtEvent&&events.length>beforeEvents)break;
    }
    ledger.final={...view.state.resources};ledger.finalStored=resources.storedTotals(view);
    for(const k of keys){
      if(Math.abs(ledger.initial[k]+ledger.collected[k]-ledger.consumed[k]-ledger.feed[k]-ledger.final[k])>1e-7)
        throw Error('Event resource conservation failed: '+k);
      if(Math.abs(ledger.initialStored[k]+ledger.produced[k]-ledger.collected[k]-ledger.finalStored[k])>1e-7)
        throw Error('Event room storage conservation failed: '+k);
    }
    return {view,ledger,events,segments,blocked,outcomes:known,familyPlans:plans,familyPauses,
      mood:{enabled:moodRules!==null,rules:structuredClone(moodRules),lastStep:lastMood},complete:view.serverTime===to,requestedTo:to,
      xp:{enabled:xpRules!==null,rules:structuredClone(xpRules),earned:earnedXp,lastStep:lastXp},
      model:{kind:'conditional-natural-events',assumptions:structuredClone(assumptions),
        limits:[moodRules===null?'constant-mood':'conditional-dynamic-mood',
          xpRules===null?'constant-xp-and-current-hp':'conditional-dynamic-xp-fixed-current-hp-no-healing',
          'radio-recruitment-requires-explicit-outcomes-when-beds-available','no-random-rewards-or-incidents','no-action-or-reservation-planner',
          'tick-start-roster-and-tick-end-events','birth-and-dig-outcomes-explicit','collection-only-if-requested',
          'room-array-order-for-feed-and-automatic-collection','training-one-increment-then-reset',
          'merge-completions-by-floor-column-into-left-neighbor',...(plans.length?['family-rules-and-child-templates-explicit']:[])]}};
  }
  return {advance,trainingStep};
}
