import vm from 'node:vm';
import {parent72Scene} from './arkengine-shelter-parent72.fixture.mjs';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';

export function parentTraining72Scene(){
  const f=parent72Scene(),s=f.view.state,now=f.view.serverTime;
  Object.assign(s.rooms.find(r=>r.type==='storage'),{floor:2,col:4});
  s.rooms.push({...s.rooms[0],id:90,type:'training',trainStat:'cha',floor:3,col:2,level:3},
    {...s.rooms[0],id:91,type:'training',trainStat:'end',floor:3,col:3,level:3},
    {...s.rooms[3],id:92,type:'scrap',floor:4,col:2,width:3,level:3});
  s.residents.push({...structuredClone(s.residents[0]),id:9,name:'固定电力工',roomId:1});
  for(const p of s.residents){
    p.familyCooldownUntil=now+72*3600000;
    if([5,6].includes(p.id)){
      p.stats={str:5,per:5,end:p.id===5?9:8,cha:9,int:5,agi:5,lck:5};p.familyCooldownUntil=now+6*3600000;
    }
  }
  // This fixture isolates post-birth cooldown training; pre-breeding cohorts
  // have their own end-to-end fixture and must not replace this baseline family.
  f.state.families=[{a:5,b:6,room:5}];f.campaign.training=true;f.campaign.trainTarget=10;f.campaign.parentPreparation=false;
  return f;
}
export function setupParentTraining72(source,seed=parentTraining72Scene()){
  const x=setupPowerInvestment(source,seed,'population');x.context.shelterPopulationTarget=13;x.context.shelterLevelTarget=null;
  Object.assign(x.api,vm.runInContext(`({estimate:shelterParentTrainingEstimate,assessment:shelterParentAssessment,
    projection:typeof shelterParentTrainingProjection==='function'?shelterParentTrainingProjection:null,
    trainingChoice:typeof shelterParentTrainingChoice==='function'?shelterParentTrainingChoice:null})`,x.context));
  x.m=()=>x.api.model(x.f.view);x.choose=()=>x.api.schedule(x.m()).actions.find(a=>a.purpose==='parent');return x;
}
export function parentContinuationScene(){
  const f=parentTraining72Scene();
  for(const p of f.view.state.residents.filter(p=>[5,6].includes(p.id))){p.stats.cha=3;p.stats.end=4;}
  // No competing production-training route: all other adults already have
  // maximum END for the only production-training room available in this scene.
  for(const p of f.view.state.residents.filter(p=>![5,6].includes(p.id)))p.stats.end=10;
  return f;
}
