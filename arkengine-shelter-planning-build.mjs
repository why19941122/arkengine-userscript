import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {installShelterLevelWorker} from './arkengine-shelter-level-planning.mjs';

export function shelterLevelWorkerSource(){
  // Reuse the actual native kernel, including manufacturing staffing and stock
  // projection. Keep one rule implementation instead of a second level model.
  const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
  const start=source.search(/^  function shelterWorkerRate\(/m),end=source.search(/^  function shelterConstructionChanged\(/m);
  if(start<0||end<=start)throw Error('Missing native shelter planning kernel');
  const health=source.match(/^  function shelterHealth\([^]*?^  \}/m)?.[0];
  if(!health)throw Error('Missing native health calculation');
  const staffStart=source.search(/^  const staffRoomTypes =/m),staffEnd=source.search(/^  function populationKinship\(/m);
  if(staffStart<0||staffEnd<=staffStart)throw Error('Missing native family-supply kernel');
  const declarations=['shelterRooms','shelterBuildRules','campaignDefaults','shelterResources'].map(name=>{
    const match=source.match(new RegExp(`^  const ${name}\\s*=[^;]*;`,'m'));
    if(!match)throw Error('Missing native planner declaration '+name);return match[0];
  }).join('\n');
  return "'use strict';\nconst objectState=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);\n"+
    declarations+'\n'+source.slice(start,end)+'\n'+source.slice(staffStart,staffEnd)+'\n'+health+'\n'+
    'let shelterStaffMode,shelterStaffHold,shelterPopulationTarget,shelterOptimize,shelterState;\n'+
    'const saveShelter=()=>{throw Error("Read-only family preview cannot save state");};\n'+installShelterLevelWorker.toString()+
    '\ninstallShelterLevelWorker(self,shelterModel,shelterLevelRoutes,data=>{\n'+
    '({shelterStaffMode,shelterStaffHold,shelterPopulationTarget,shelterOptimize,shelterState}=data.policy);\n'+
    'return shelterPopulationFamilySupply(shelterModel(data.view),data.campaign);\n});\n';
}

// Local, deterministic bundle of the tested modules; no dependency installation/CDN.
export function shelterPlanningWorkerSource(){
  const seen=new Set(),chunks=[];
  function visit(url){
    if(seen.has(url.href))return;seen.add(url.href);
    let source=readFileSync(url,'utf8');
    const imports=[...source.matchAll(/^import\s+\{[^}]+\}\s+from\s+'([^']+)';\r?\n/gm)];
    for(const match of imports){if(!match[1].startsWith('./'))throw Error('Nonlocal planner dependency '+match[1]);visit(new URL(match[1],url));}
    source=source.replace(/^import\s+\{[^}]+\}\s+from\s+'[^']+';\r?\n/gm,'');
    const names=[...source.matchAll(/^export function (\w+)/gm)].map(m=>m[1]);
    if(!names.length)throw Error('Missing planner exports '+url.pathname);
    source=source.replace(/^export function /gm,'function ');
    if(/^import |^export /m.test(source))throw Error('Unsupported planner syntax '+url.pathname);
    chunks.push('const {'+names.join(',')+'}=(()=>{\n'+source+'\nreturn {'+names.join(',')+'};\n})();');
  }
  visit(new URL('./arkengine-shelter-planning-worker.mjs',import.meta.url));
  return "'use strict';\n"+chunks.join('\n')+'\ninstallShelterPlanningWorker(self);\n';
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=new URL('./arkengine-auto-encounter.user.js',import.meta.url),source=readFileSync(file,'utf8');
  const next=source.replace(/^  \/\/ BEGIN GENERATED SHELTER PLANNING WORKER\r?\n[\s\S]*?^  \/\/ END GENERATED SHELTER PLANNING WORKER\r?\n/m,'');
  if(/GENERATED SHELTER PLANNING WORKER|installShelterPlanningWorker|shelterLevelWorkerSource/.test(next))throw Error('Unexpected offline planner in userscript');
  if(next!==source){
    if(process.argv.includes('--check'))throw Error('Userscript still embeds the offline planner');
    writeFileSync(file,next);
  }
  console.log('Userscript excludes offline planning workers');
}
