import {levelPlanningView} from './arkengine-shelter-level-planning.fixture.mjs';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

// A funded production upgrade competes with optional reassignment, not emergency supply.
export function readyConstructionScene(){
  const view=campaignView(),s=view.state;
  Object.assign(s.rooms.find(r=>r.id===4),{width:2,level:1});
  for(const p of s.residents)if(p.id>=4){p.roomId=4;p.stats.end=1;p.stats.agi=10;}
  s.residents[1].stats.end=10;
  return {view,state:{families:[],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},
    campaign:{training:false,radio:false,explore:false,quests:false,dailyGoals:false,medical:false,help:false},
    construction:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}};
}

export function readyCampaignConstructionScene(role='training'){
  const f=readyConstructionScene(),s=f.view.state;
  // Keep health consistent with the changed END stat, so campaign candidates are real.
  for(const p of s.residents)Object.assign(p,{xp:0,hp:100,training:0});
  s.rooms.push({...s.rooms[0],id:90,type:role==='medical'?'medbay':role,
    trainStat:role==='training'?'end':undefined,floor:3,col:2,level:1});
  Object.assign(f.campaign,{[role]:true,trainTarget:10,reserve:2});
  if(role==='medical')s.resources.stimpak=0;
  f.construction.scrapLimit=400;
  return f;
}

// Controlled 65/66-point scene. Both investments are real native quotes:
// one storage upgrade (200 scrap, 1h) or a staffed recycler (400 scrap, 2h).
export function growthInvestmentScene(){
  const view=levelPlanningView(),s=view.state;
  Object.assign(s.rooms.find(r=>r.id===6),{floor:3,col:2});
  Object.assign(s.rooms.find(r=>r.id===4),{width:2,level:1});
  s.residents.push({...structuredClone(s.residents[3]),id:7,name:'生产居民7',roomId:4});
  for(const [i,p] of s.residents.entries())Object.assign(p,{roomId:[1,2,3,4,4,4,4][i],xp:147,hp:149,happiness:100,
    stats:{str:10,per:10,end:10,agi:10,int:10,cha:10,lck:10},familyCooldownUntil:view.serverTime+6*3600000});
  s.rooms.push(...[2,3].map((col,i)=>({...s.rooms[0],id:200+i,type:'storage',floor:5,col,width:1,level:3})));
  const score=2*s.residents.length+3*s.depth+s.rooms.filter(r=>!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
  view.progress={level:1+Math.floor(Math.sqrt(Math.max(0,score-30))/1.5),score};
  return {view,state:{families:[],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},
    campaign:{training:false,radio:false,explore:false,quests:false,dailyGoals:false,medical:false,help:false},
    construction:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}};
}
