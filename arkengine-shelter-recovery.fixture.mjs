import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

export const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(name=>source.match(new RegExp(`const ${name}\\s*=[^;]*;`))[0]).join('\n');
const code=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
export const api=vm.runInNewContext(`${declarations}\n${code}\n({model:shelterModel,plan:shelterCampaignPlan,slots:shelterExploreSlots,defaults:campaignDefaults,valid:validCampaignRecord})`,{
  objectState:value=>value!==null&&typeof value==='object'&&!Array.isArray(value),
  shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});

export function recoveryScene(){
  const view=campaignView(Date.parse('2026-11-20T09:00:00Z')),state=view.state;
  const room={...state.rooms[0],id:90,type:'training',trainStat:'cha',level:3,floor:3,col:2};state.rooms.push(room);
  for(const person of state.residents.slice(4))Object.assign(person,{xp:0,hp:100,stats:{str:5,per:5,end:5,cha:5,int:5,agi:5,lck:5}});
  const trainee=state.residents[4];trainee.roomId=room.id;trainee.training=.9;
  const cfg={...api.defaults,training:true,trainTarget:10,development:true};
  const record={roles:[],trips:[],attempts:[],heals:[],trainingRest:[]};
  return {view,state,room,trainee,cfg,record};
}

export function assignmentHold(view,person){
  const now=view.serverTime;
  return {id:person.id,at:now,snapshotAt:now,room:person.roomId,
    original:{id:'held-worker',kind:'assign',at:now-50000,vaultNo:view.vaultNo,targets:[person.id,90],
      before:{serverTime:now-50000,room:person.roomId},
      lifecycle:{version:1,phase:'request-bound',page:'recovery',requestKey:'recovery-request-key',boundAt:now-50000},
      result:{status:520,outcome:'http-error',responseFinishedAt:now-10000}}};
}

export function equipmentPending(view,slot='weapon'){
  const now=view.serverTime,targets=slot==='weapon'?[4,173,'weapon']:[4,173];
  return {id:'equipment-http-error',kind:'equip',targets,at:now-720000,vaultNo:view.vaultNo,
    lifecycle:{version:1,phase:'request-bound',page:'old-equipment-page',requestKey:'old-equipment-request-key',boundAt:now-720000},
    campaignKey:'old-equipment-request-key',before:{serverTime:now-720000,collected:0,
      day:view.state.daily.day,month:view.state.season.month,outfit:null,
      campaign:{choice:{kind:'equip',id:4,targets,role:'combatGear',slot,fromItem:null},ids:[],hp:100}},
    result:{status:520,outcome:'http-error',responseFinishedAt:now-678000}};
}

export function recoveryBrowserSetup(sample){
  return `sm.view=${JSON.stringify(sample.view)};clock=sm.view.serverTime;sm.recoverySearch=location.search;
    sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify(sample.cfg)}));
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:false,upgrade:false,dig:false,scrapLimit:0,partsLimit:0,scrapReserve:0,partsReserve:0}));
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'recovery',campaign:${JSON.stringify(sample.record)}}));`;
}
