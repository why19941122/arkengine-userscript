import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';

export function parentPreparationScene(){
  const view=campaignView(),s=view.state,base=s.residents[3],room=s.rooms[0];
  s.residents=s.residents.slice(0,3);
  for(const p of s.residents){p.xp=0;p.hp=100;p.stats={str:10,per:10,end:10,cha:10,int:10,agi:10,lck:10};}
  Object.assign(s.rooms.find(r=>r.id===4),{width:3,col:5,level:3});
  for(let id=4;id<=9;id++)s.residents.push({...structuredClone(base),id,name:`培养居民${id}`,roomId:4,xp:0,hp:100,
    stats:{str:4,per:4,end:4,cha:id<=7?3:2,int:4,agi:4,lck:4}});
  Object.assign(s.rooms.find(r=>r.id===5),{width:3,level:3});
  Object.assign(s.rooms.find(r=>r.id===6),{floor:2,col:6});
  s.rooms.push({...room,id:7,type:'quarters',floor:3,col:2,width:3},
    ...['str','per','end','cha','int','agi','lck'].map((stat,i)=>({...room,id:90+i,type:'training',trainStat:stat,floor:4+i,col:2,level:1})),
    ...[8,9,10].map(floor=>({...room,id:200+floor,type:'elevator',floor,col:1,level:1})));
  s.depth=10;s.resources={power:1000,food:1000,water:1000,scrap:5000,parts:100,stimpak:10};
  return {view,state:{families:[{a:8,b:9,room:7}],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},
    campaign:{explore:false,quests:false,training:true,parentPreparation:true,medical:false,radio:false,combatGear:false,defense:false,dailyGoals:false,
      help:false,craftDaily:false,caravanDaily:false,tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6},
    construction:{build:false,upgrade:false,dig:false,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}};
}

export function setupParentPreparation(source,seed=parentPreparationScene()){
  const x=setupPowerInvestment(source,seed,'population');x.context.shelterPopulationTarget=18;x.context.shelterLevelTarget=null;
  x.context.workshopAutomatic=()=>false;const events=[];x.context.log.add=(...args)=>events.push(args);x.events=events;
  Object.assign(x.api,vm.runInContext(`({remember:rememberShelterFamilies,update:shelterUpdateParentPreparation,
    rank:shelterRankFamilies,prepared:shelterParentPrepared,pairAllowed:shelterParentPairAllowed,kinship:populationKinship,
    plan:shelterCampaignPlan,record:recordShelterCampaign,valid:validCampaignRecord,validPreparation:validShelterParentPreparation,
    population:shelterPopulationPlan,pairing:populationPairingContext,pairChoice:populationPairingChoice,
    assessment:shelterParentAssessment,diagnostics:shelterPopulationDiagnostics})`,x.context));
  x.m=()=>x.api.model(x.f.view);
  x.schedule=()=>x.api.schedule(x.m());
  x.apply=a=>{
    const p=x.f.view.state.residents.find(p=>p.id===a.id);p.roomId=a.room;
    x.api.record({kind:'assign',targets:[a.id,a.room],before:{campaign:{choice:a}},result:{campaignProof:{at:x.f.view.serverTime}}},x.m());
  };
  x.tick=(hours=1/6)=>{x.f.view.serverTime+=hours*3600000;x.f.view.state.lastSettledAt=x.f.view.serverTime;};
  return x;
}
