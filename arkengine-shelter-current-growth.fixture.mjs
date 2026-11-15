import {readFileSync} from 'node:fs';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
export const currentGrowthDiagnostic=JSON.parse(readFileSync(new URL('./arkengine-shelter-current-growth.fixture.json',import.meta.url),'utf8'));
export function currentGrowthScene(){
  const data=structuredClone(currentGrowthDiagnostic),view=campaignView(data.source.snapshotAt),s=view.state;
  // Reconstruct logged staffing and rates; zero explorer loot is an explicit test condition.
  s.residents=data.residents.map(p=>({...p,romance:p.romance?.partnerId?p.romance:null}));
  s.rooms=data.rooms;s.resources=data.summary.resources;s.items=data.items;s.births=[];
  s.lastSettledAt=data.summary.productionEvidence.lastSettledAt;s.depth=10;
  s.digging={floor:11,doneAt:1794361539405};view.progress=data.summary.levelProgress;
  s.explorers=data.trips.map(t=>({id:t.id,residentId:t.resident,startedAt:t.startedAt,recalledAt:t.recalledAt,returnAt:t.returnAt,
    abyss:false,tier:0,stimpaks:0,loot:{scrap:0,parts:0,stimpak:0,items:[]}}));
  view.vaultNo=10;view.env.events=[];view.env.quests=[];s.daily.day='2026-11-11';
  const state={vaultNo:10,families:data.families,campaign:{roles:data.roles,trips:[],attempts:[],heals:[],trainingRest:[]}};
  return {view,state};
}
