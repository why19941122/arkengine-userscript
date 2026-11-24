import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';
import vm from 'node:vm';
import {createShelterResourceSimulation} from './arkengine-shelter-resource-simulation.mjs';
import {createShelterFamilySimulation} from './arkengine-shelter-family-simulation.mjs';

export function finishParentStats(view,ids=[7,8]){
  for(const person of view.state.residents.filter(person=>ids.includes(person.id)))
    for(const stat of Object.keys(person.stats))person.stats[stat]=10;
}

// All existing adults already work; one uncommitted recycler seat can receive
// one child. This deliberately excludes the separate idle-adult employment issue.
export function parent72Scene(){
  const view=campaignView(),s=view.state;
  s.rooms.find(r=>r.id===4).width=3;s.resources.scrap=1000;
  for(const id of [7,8])s.residents.push({...structuredClone(s.residents[3]),id,name:'父母候选'+id,parents:[]});
  for(const p of s.residents){
    p.training=0;p.xp=0;p.hp=100;
    if(p.id<5){p.familyCooldownUntil=view.serverTime+24*3600000;continue;}
    p.roomId=4;p.stats=Object.fromEntries(Object.keys(p.stats).map(k=>[k,p.id>=7?5:3]));
    p.stats.cha=p.id>=7?1:9;p.familyCooldownUntil=0;
  }
  return {view,state:{families:[],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},
    campaign:{training:false,radio:false,explore:false,quests:false,dailyGoals:false,medical:false,help:false,combatGear:false},
    construction:{build:false,upgrade:false,dig:false,budgetMode:'stock',scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}};
}
export function setupParent72(source){
  const x=setupPowerInvestment(source,parent72Scene(),'population');
  x.context.shelterPopulationTarget=9;x.context.shelterLevelTarget=8;
  Object.assign(x.api,vm.runInContext('({population:shelterPopulationPlan,assessment:shelterParentAssessment,'+
    'projection:typeof shelterParentDevelopmentProjection===\'function\'?shelterParentDevelopmentProjection:null})',x.context));
  x.choose=()=>x.api.population(x.api.model(x.f.view),x.context.shelterState.families,
    {eligible:p=>p.id>=5&&p.familyCooldownUntil<=x.f.view.serverTime,home:()=>true,healthy:()=>true},true);
  return x;
}

// Independent tick transitions. Inheritance offsets are explicit scenarios,
// never random samples or an assumed probability distribution.
export function replayParent72(seed,ids,offset,destination=4){
  const resources=createShelterResourceSimulation(),family=createShelterFamilySimulation(),hour=3600000,tick=600000;
  let view=structuredClone(seed.view);const start=view.serverTime,end=start+72*hour;
  const parents=ids.map(id=>view.state.residents.find(p=>p.id===id)),origins=parents.map(p=>p.roomId);
  const child={...structuredClone(parents[0]),id:999,name:'明确情景子女',roomId:5,parents:[...ids],xp:0,hp:100,happiness:100,
    adultAt:0,training:0,romance:null,away:null,deadAt:null,familyCooldownUntil:0,outfitId:null,weaponId:null,
    stats:Object.fromEntries(Object.keys(parents[0].stats).map(k=>[k,
      Math.min(10,Math.max(1,Math.floor((parents[0].stats[k]+parents[1].stats[k])/2)+offset))]))};
  let plans=[{key:'one-child',source:'explicit conditional first-child comparison',parents:[...ids],roomId:5,stage:'planned',child}];
  const rules={romance:'base-charm-sum-per-120-per-tick',pregnancyMs:3*hour,childhoodMs:3*hour,cooldownMs:6*hour,
    source:'cached public family text; fixed mood/XP and tick handoffs are explicit scenario assumptions'};
  parents.forEach(p=>p.roomId=5);
  let outcome=null,returned=false,working=false;const timeline=[],checkpoints={},minimum={power:Infinity,food:Infinity,water:Infinity};
  while(view.serverTime<end){
    if(plans[0].stage==='planned'||plans[0].stage==='romance'){
      const step=family.prepare(view,plans,rules);assertNoBlocked(step);plans=step.plans;
      const produced=resources.settleTick(view);view=produced.view;
      for(const k of Object.keys(minimum)){minimum[k]=Math.min(minimum[k],produced.ledger.minimumInventory[k]);
        if(produced.ledger.unserved[k])throw Error('Unserved supply in parent comparison');}
      for(const u of step.updates)Object.assign(view.state.residents.find(p=>p.id===u.id),u);
      view.state.births.push(...step.births);if(step.outcomes.length)outcome=step.outcomes[0];
      timeline.push(...step.events);
    }else{
      const produced=resources.settleTick(view);view=produced.view;
      for(const k of Object.keys(minimum)){minimum[k]=Math.min(minimum[k],produced.ledger.minimumInventory[k]);
        if(produced.ledger.unserved[k])throw Error('Unserved supply in parent comparison');}
    }
    if(plans[0].conceivedAt&&!returned&&view.serverTime>=plans[0].conceivedAt+tick){
      ids.forEach((id,i)=>view.state.residents.find(p=>p.id===id).roomId=origins[i]);returned=true;
      timeline.push({kind:'parents-return',at:view.serverTime});
    }
    if(outcome&&view.serverTime>=outcome.dueAt&&!view.state.residents.some(p=>p.id===child.id)){
      view.state.births=[];view.state.residents.push(structuredClone(outcome.resident));plans[0].stage='born';
      timeline.push({kind:'birth',at:view.serverTime});
    }
    if(outcome&&!working&&view.serverTime>=outcome.resident.adultAt+tick){
      if(view.state.rooms.find(r=>r.id===destination).width*2<=view.state.residents.filter(p=>p.roomId===destination).length)
        throw Error('Child job is occupied');
      view.state.residents.find(p=>p.id===child.id).roomId=destination;working=true;
      timeline.push({kind:'child-work',at:view.serverTime});
    }
    view=resources.collect(view).view;
    const elapsed=(view.serverTime-start)/hour;
    if([24,72].includes(elapsed))checkpoints[elapsed]={resources:{...view.state.resources},stored:resources.storedTotals(view)};
  }
  return {parents:ids,offset,childStats:child.stats,timeline:timeline.map(e=>({...e,hours:(e.at-start)/hour})),
    checkpoints,minimum,population:view.state.residents.length,
    people:view.state.residents.map(p=>({id:p.id,room:p.roomId,training:p.training})),
    conditions:'one child; public family timing; fixed mood/XP, newborn100 mood/0XP, explicit genetic offset, existing job, one-tick handoffs, no subsequent births/training/unknown rewards'};
}
function assertNoBlocked(step){if(step.blocked.length||step.paused.length)throw Error(JSON.stringify({blocked:step.blocked,paused:step.paused}));}
