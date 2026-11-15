import vm from 'node:vm';
import {parent72Scene} from './arkengine-shelter-parent72.fixture.mjs';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';
export function futureEmploymentScene(children=2){
  const f=parent72Scene(),s=f.view.state;
  Object.assign(s.rooms.find(r=>r.type==='storage'),{floor:2,col:4});
  for(const [i,roomId] of [1,2,3].entries())s.residents.push({...structuredClone(s.residents[i]),id:9+i,name:'原岗位'+i,roomId});
  for(let i=0;i<children;i++)s.residents.push({...structuredClone(s.residents[3]),id:12+i,name:'待成年'+i,roomId:5,
    adultAt:f.view.serverTime+3*3600000,parents:[5,7],romance:null,familyCooldownUntil:0});
  s.resources={power:400,food:400,water:400,scrap:1000,parts:10,stimpak:0};
  Object.assign(f.construction,{build:true,upgrade:true,dig:true});f.campaign.radio=true;
  s.rooms.push({...s.rooms[0],id:30,type:'radio',floor:3,col:2,level:1,width:1});
  return f;
}
export function setupFutureEmployment(source,seed=futureEmploymentScene()){
  const x=setupPowerInvestment(source,seed,'population');x.context.shelterPopulationTarget=20;x.context.shelterLevelTarget=null;
  Object.assign(x.api,vm.runInContext(`({population:shelterPopulationPlan,idle:shelterIdleEmploymentChoice,
    growthEmployment:shelterGrowthEmployment,future:typeof shelterFutureEmployment==='function'?shelterFutureEmployment:()=>null,
    routes:shelterLevelRoutes})`,x.context));
  x.m=()=>x.api.model(x.f.view);
  x.choose=()=>x.api.population(x.m(),x.context.shelterState.families,{eligible:p=>p.id>=5&&p.id<=8,home:()=>true,healthy:()=>true},true);
  return x;
}
