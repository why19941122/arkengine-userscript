import {readFileSync} from 'node:fs';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
export const allocationSupplyDiagnostic=JSON.parse(readFileSync(new URL('./arkengine-shelter-allocation-supply.fixture.json',import.meta.url),'utf8'));
export function allocationSupplyScene(beforeFirstMove=true){
  const d=structuredClone(allocationSupplyDiagnostic),view=campaignView(d.source.snapshotAt),s=view.state;
  s.rooms=d.rooms;s.items=d.items;s.resources=d.summary.resources;
  s.residents=d.residents.map(p=>({...p,romance:p.romance?.partnerId?p.romance:null,away:p.away?{kind:p.away}:null}));
  s.lastSettledAt=d.summary.productionEvidence.lastSettledAt;s.depth=10;
  // Reconstruct the logged staffing/rates; trips and rewards are outside this fixture.
  view.vaultNo=10;view.progress={level:9};view.env.events=[];view.env.quests=[];
  s.daily.day='2026-11-11';
  if(beforeFirstMove)s.residents.find(p=>p.id===70).roomId=6;
  return {view,record:{roles:d.roles,trips:[],attempts:[],heals:[],trainingRest:[]},targets:d.moves};
}
