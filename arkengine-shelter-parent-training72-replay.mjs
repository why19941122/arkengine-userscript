import {createShelterResourceSimulation} from './arkengine-shelter-resource-simulation.mjs';
import {createShelterFamilySimulation} from './arkengine-shelter-family-simulation.mjs';
import {createShelterEventSimulation} from './arkengine-shelter-event-simulation.mjs';

// Independent conditional settlement: no projection timetable/rates are read.
// Compare an explicit initial route (at most one cell per parent in this
// cooldown), then the same family and real seats. An optional caller may select
// the partner's second cell from the independently settled post-return state.
export function replayParentTraining72(seed,action,offset,target=13,continuation=null){
  const resources=createShelterResourceSimulation(),families=createShelterFamilySimulation(),events=createShelterEventSimulation();
  const hour=3600000,tick=600000,start=seed.view.serverTime,end=start+72*hour;
  const route=Array.isArray(action)?action:action?[action]:[];
  let view=structuredClone(seed.view),plans=[],outcomes=[],trainingDoneAt=null,returned=!route.length,
    activeTraining=route[0]||null,nextTrainingAt=null,routeIndex=0,continued=false;
  const trainingRest=[],decisions=route.length?[{...route[0],hours:0}]:[];
  const f=seed.state.families[0],ids=[f.a,f.b],origins=ids.map(id=>view.state.residents.find(p=>p.id===id).roomId);
  if(route.length>2||route.some(a=>!ids.includes(a.id))||new Set(route.map(a=>a.id)).size!==route.length)
    throw Error('At most one cell per original parent');
  const s=view.state;
  const jobs=s.rooms.filter(r=>r.type==='scrap').sort((a,b)=>b.level-a.level||a.id-b.id).flatMap(r=>
    Array.from({length:Math.max(0,r.width*2-s.residents.filter(p=>p.roomId===r.id).length)},()=>r.id));
  const cap=Math.min(target,s.rooms.filter(r=>r.type==='quarters').reduce((n,r)=>n+r.width*(2+2*r.level),0));
  const limit=Math.min(jobs.length,cap-s.residents.length),births=[],moves=[],trainingEvents=[],checkpoints={};
  const minimum={power:Infinity,food:Infinity,water:Infinity},employed=new Set();
  const rules={romance:'base-charm-sum-per-120-per-tick',pregnancyMs:3*hour,childhoodMs:3*hour,cooldownMs:6*hour,
    source:'cached public family text; explicit per-child inheritance offset and per-resident ten-minute handoffs'};
  const trainRules={trainingOverflow:'reset',source:'cached public training rate; single cell then return next tick'};
  if(activeTraining){const p=s.residents.find(p=>p.id===activeTraining.id);p.roomId=activeTraining.room;p.training=0;}
  let placing=null,parentWorkHours=0;
  while(view.serverTime<end){
    const now=view.serverTime,state=view.state,parents=ids.map(id=>state.residents.find(p=>p.id===id));
    const move=(p,to,reason)=>{if(p.roomId===to)return;p.roomId=to;moves.push({id:p.id,to,hours:(now-start)/hour,reason});};
    if(activeTraining&&trainingDoneAt!==null&&!returned&&now>=trainingDoneAt+tick){
      const id=activeTraining.id;move(parents.find(p=>p.id===id),origins[ids.indexOf(id)],'training-return');returned=true;
      trainingRest.push({id,at:now});activeTraining=null;nextTrainingAt=now+tick;
    }
    if(nextTrainingAt!==null&&now>=nextTrainingAt&&!continued){
      continued=true;
      const next=route[++routeIndex]||continuation?.({view:structuredClone(view),trainingRest:structuredClone(trainingRest)});
      if(next){
        if(trainingRest.some(r=>r.id===next.id)||!ids.includes(next.id))throw Error('Continuation must train the other original parent');
        const p=parents.find(p=>p.id===next.id);if(p.familyCooldownUntil<=now)throw Error('Continuation exceeds cooldown');
        activeTraining={id:next.id,room:next.room};trainingDoneAt=null;returned=false;p.training=0;
        move(p,next.room,'partner-training');decisions.push({...activeTraining,hours:(now-start)/hour});
      }
    }
    for(const plan of plans)if(plan.conceivedAt)for(const [i,p] of parents.entries()){
      if(now>=plan.conceivedAt+(i+1)*tick&&now<plan.conceivedAt+6*hour)move(p,origins[i],'pregnancy-return');
    }
    for(const [i,outcome] of outcomes.entries())if(now>=outcome.resident.adultAt+tick&&!employed.has(outcome.resident.id)){
      const p=state.residents.find(p=>p.id===outcome.resident.id),room=state.rooms.find(r=>r.id===jobs[i]);
      if(!p||state.residents.filter(p=>p.roomId===room.id&&p.adultAt<=now).length>=room.width*2)throw Error('Child job occupied');
      move(p,room.id,'child-work');employed.add(p.id);
    }
    if(!placing&&plans.length<limit&&parents.every(p=>p.familyCooldownUntil<=now&&!p.romance)&&
      !state.births.length&&returned)placing={at:now};
    if(placing){
      move(parents[0],f.room,'family-placement');
      if(now>=placing.at+tick){
        move(parents[1],f.room,'family-placement');
        const child={...structuredClone(parents[0]),id:100+plans.length,name:'情景儿童'+plans.length,roomId:f.room,parents:ids,
          adultAt:0,xp:0,hp:100,happiness:100,training:0,romance:null,away:null,deadAt:null,familyCooldownUntil:0,outfitId:null,weaponId:null,
          stats:Object.fromEntries(Object.keys(parents[0].stats).map(k=>[k,Math.min(10,Math.max(1,Math.floor((parents[0].stats[k]+parents[1].stats[k])/2)+offset))]))};
        plans.push({key:'cycle-'+child.id,source:'explicit genetic offset '+offset,parents:ids,roomId:f.room,stage:'planned',child});placing=null;
      }
    }
    const family=families.prepare(view,plans,rules);if(family.blocked.length||family.paused.length)throw Error(JSON.stringify(family));
    plans=family.plans;outcomes.push(...family.outcomes);
    const training=activeTraining&&trainingDoneAt===null?events.trainingStep(view,trainRules):{updates:[],blocked:[]};
    if(training.blocked.length)throw Error(JSON.stringify(training.blocked));
    parentWorkHours+=parents.filter((p,i)=>p.roomId===origins[i]).length/6;
    const settled=resources.settleTick(view);view=settled.view;
    for(const k of Object.keys(minimum)){
      minimum[k]=Math.min(minimum[k],settled.ledger.minimumInventory[k]);if(settled.ledger.unserved[k])throw Error('Unserved '+k);
    }
    for(const u of training.updates){
      const p=view.state.residents.find(p=>p.id===u.id);p.training=u.progress;
      if(p.training>=1-1e-9){p.stats[u.stat]++;p.training=0;trainingDoneAt=view.serverTime;
        trainingEvents.push({id:p.id,stat:u.stat,hours:(view.serverTime-start)/hour});}
    }
    for(const u of family.updates)Object.assign(view.state.residents.find(p=>p.id===u.id),u);
    view.state.births.push(...family.births);
    for(const outcome of outcomes)if(outcome.dueAt<=view.serverTime&&!view.state.residents.some(p=>p.id===outcome.resident.id)){
      view.state.residents.push(structuredClone(outcome.resident));
      view.state.births=view.state.births.filter(b=>!(b.dueAt===outcome.dueAt&&b.roomId===outcome.roomId));
      plans.find(p=>p.child.id===outcome.resident.id).stage='born';births.push({id:outcome.resident.id,hours:(view.serverTime-start)/hour});
    }
    // The native automation admits whole ready batches only. The independent
    // resource kernel also supports partial native payouts, so explicitly use
    // the live caller's capacity gate here instead of silently assuming those.
    const kinds={power:['power',30],diner:['food',25],water:['water',25],scrap:['scrap',30],medbay:['stimpak',2],workshop:['parts',3]};
    for(const r of view.state.rooms){
      const rule=kinds[r.type];if(!rule)continue;
      const batch=rule[1]*r.width*[0,1,1.5,2.1][r.level],ready=Math.floor((r.stored+1e-9)/batch)*batch;
      if(ready>0&&ready<=resources.capacities(view)[rule[0]]-view.state.resources[rule[0]]+1e-9)
        view=resources.collect(view,r.id).view;
    }
    const hours=(view.serverTime-start)/hour;
    if([24,48,72].includes(hours))checkpoints[hours]={resources:{...view.state.resources},stored:resources.storedTotals(view)};
  }
  return {offset,action,decisions,births,moves,trainingEvents,checkpoints,minimum,parentWorkHours,employed:[...employed],
    endPopulation:view.state.residents.length,parents:view.state.residents.filter(p=>ids.includes(p.id)).map(p=>({id:p.id,stats:p.stats,room:p.roomId})),
    conditions:'Explicit initial route, at most one cell per parent in current cooldown; same original family and existing jobs; per-resident ten-minute handoffs; fixed health/mood/XP; explicit inheritance offset, no probabilities or later investments'};
}
