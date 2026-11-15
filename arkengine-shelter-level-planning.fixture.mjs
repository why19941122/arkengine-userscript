import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

export function levelPlanningView(){
  const v=campaignView(),s=v.state;
  s.resources={scrap:3000,parts:100,power:1000,food:1000,water:1000,stimpak:0};
  for(const p of s.residents){p.stats.str=10;p.training=0;}
  s.residents[4].roomId=1;s.residents[5].roomId=4;
  for(let i=0;i<4;i++)s.rooms.push({...s.rooms[0],id:100+i,type:'storage',floor:4,col:2+i,level:1});
  const score=2*s.residents.length+3*s.depth+s.rooms.filter(r=>!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
  v.progress={level:1+Math.floor(Math.sqrt(Math.max(0,score-30))/1.5),score};
  return v;
}
