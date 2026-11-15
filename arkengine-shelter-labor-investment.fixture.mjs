import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

// Two diner workers are necessary before the upgrade; one suffices afterwards.
// Five children count as future adult mouths, never as available workers.
export function laborInvestmentScene(){
  const view=campaignView(),s=view.state,person=s.residents[0];
  s.rooms.find(r=>r.id===2).level=1;
  s.rooms.find(r=>r.id===4).width=3;
  Object.assign(s.rooms.find(r=>r.id===6),{floor:2,col:5});
  s.rooms.find(r=>r.id===5).width=3;
  s.residents=Array.from({length:12},(_,i)=>({...structuredClone(person),id:i+1,name:'发展居民'+(i+1),
    roomId:[1,2,2,3,4,4,4,5,5,5,5,5][i],adultAt:i>=7?view.serverTime+86400000:0,
    stats:{str:10,agi:8,per:10,end:10,int:0,cha:0,lck:0},hp:100,xp:0,happiness:100}));
  s.resources={power:1000,water:1000,food:1000,scrap:2000,parts:50,stimpak:0};
  const score=2*s.residents.length+3*s.depth+s.rooms.filter(r=>!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
  view.progress={level:1+Math.floor(Math.sqrt(Math.max(0,score-30))/1.5),score};
  return {view,state:{families:[],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},
    campaign:{training:false,radio:false,explore:false,quests:false,dailyGoals:false,medical:false,help:false},
    construction:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}};
}

export function laborExpansionScene(){
  const f=laborInvestmentScene(),s=f.view.state;
  for(const id of [8,9,10])Object.assign(s.residents.find(p=>p.id===id),{adultAt:0,roomId:4});
  s.residents.filter(p=>p.roomId===2).forEach(p=>{p.stats.end=17;p.xp=300;p.hp=200;});
  return f;
}
