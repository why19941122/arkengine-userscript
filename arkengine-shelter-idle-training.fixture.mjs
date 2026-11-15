import {readFileSync} from 'node:fs';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
export const idleTrainingDiagnostic=JSON.parse(readFileSync(new URL('./arkengine-shelter-idle-training.fixture.json',import.meta.url),'utf8'));
export function idleTrainingScene(){
  const d=structuredClone(idleTrainingDiagnostic),view=campaignView(d.source.snapshotAt),s=view.state;
  s.residents=d.residents.map(p=>({...p,romance:p.romance?.partnerId?p.romance:null,away:p.away?{kind:p.away}:null}));
  s.rooms=d.rooms;s.items=d.items;s.births=d.births;s.resources=d.summary.resources;
  s.lastSettledAt=d.summary.productionEvidence.lastSettledAt;s.depth=11;s.digging={floor:12,doneAt:view.serverTime+90*60000};
  s.explorers=d.trips.map(t=>({id:t.id,residentId:t.resident,startedAt:t.startedAt,recalledAt:t.recalledAt,returnAt:t.returnAt,
    abyss:false,tier:0,stimpaks:0,loot:{scrap:0,parts:0,stimpak:0,items:[]}}));
  s.daily.day='2026-11-11';view.vaultNo=10;view.progress={level:9};view.env.events=[];view.env.quests=[];
  return {view,state:{vaultNo:10,families:d.families,campaign:{roles:d.roles,trips:[],attempts:[],heals:[],trainingRest:[]}},
    campaign:d.campaign};
}
