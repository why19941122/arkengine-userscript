import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Historical derived roster, with explicit policy changes to isolate a genuinely
// available power seat. The untouched source fixture retains its training holds.
export function powerInvestmentScene(){
  const f=JSON.parse(readFileSync(new URL('./arkengine-shelter-latest-maintenance.fixture.json',import.meta.url),'utf8'));
  f.state.campaign.roles=[];
  f.view.state.resources.scrap=1600; // Fund one upgrade, while digging still needs a meaningful saving window.
  // Isolate this decision from unrelated return/release actions in the old log.
  for(const e of f.view.state.explorers)e.returnAt=f.view.serverTime+12*3600000;
  for(const p of f.view.state.residents){
    const r=f.view.state.rooms.find(r=>r.id===p.roomId);
    if(['training','radio'].includes(r?.type)){p.hp=1;if(r.type==='radio')p.roomId=175;}
  }
  f.view.state.rooms.forEach(r=>r.stored=0);
  Object.assign(f.campaign,{training:false,dailyGoals:false,radio:false,combatGear:false,quests:false,medical:false,help:false,craftDaily:false});
  return f;
}
export function setupPowerInvestment(source,seed=powerInvestmentScene(),mode='production'){
  const f=structuredClone(seed),part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b));
  const context={structuredClone,objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterStaffMode:mode,shelterStaffHold:false,shelterOptimize:false,shelterGear:false,
    shelterPopulationTarget:50,shelterLevelTarget:10,shelterCampaign:f.campaign,
    shelterState:f.state,shelterConstruction:f.construction,shelterPending:null,shelterRead:null,
    shelterConstructionDone:false,shelterConstructionHeld:false,shelterCampaignHeld:'',shelterCampaignNote:'',
    shelterConstructionNote:'',shelterStaffNote:'',shelterPopulationNote:'',shelterSocialNote:'',shelterCaravanNote:'',
    Date:class extends Date{static now(){return f.view.serverTime;}},crypto:{randomUUID:()=>String(f.view.serverTime)},
    log:{add(){}},workshopAutomatic:()=>true};
  context.saveShelter=x=>context.shelterState=x;
  const api=vm.runInNewContext(['shelterRooms','shelterBuildRules','campaignDefaults','shelterResources'].map(n=>
    source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n')+
    part('  function shelterWorkerRate(','  function readShelter(')+
    part('  const staffRoomTypes =','  function shelterExploreStep(')+
    part('  function shelterCampaignSchedule(','  function shelterDailyClaimStep(')+
    part('  function shelterCampaignChoice(','  let shelterTripLookup=')+
    part('  function recordShelterCampaign(','  function shelterFormValue(')+
    part('  function shelterConstructionChoice(','  function shelterBuildTitle(')+
    '\n({model:shelterModel,schedule:shelterCampaignSchedule,choice:shelterCampaignChoice,development:shelterDevelopmentPlan,staff:shelterStaffPlan,construction:shelterConstructionChoice,'+
    'powerStaffing:typeof shelterUpgradePowerStaffing===\'function\'?shelterUpgradePowerStaffing:null,growth:shelterGrowthNeeds})',context);
  const plan=()=>{const m=api.model(f.view),campaign=api.schedule(m);return {m,campaign,development:api.development(m,context.shelterPopulationTarget,campaign,context.shelterLevelTarget)};};
  return {api,context,f,plan};
}
