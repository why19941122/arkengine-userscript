import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {powerPrerequisiteView,digPowerPrerequisiteView,fullPowerPrerequisiteView} from './arkengine-shelter-campaign.fixture.mjs';
const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const segment=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const implementation=[declarations,segment('  function shelterWorkerRate(','  function readShelter('),
  segment('  const staffRoomTypes =','  function shelterExploreStep('),
  segment('  function shelterCampaignSchedule(','  function shelterDailyClaimStep('),
  segment('  function shelterConstructionChoice(','  function shelterBuildTitle(')].join('\n');
function setup(v=powerPrerequisiteView()){
  const context={objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'},
    shelterStaffMode:'production',shelterStaffHold:'',shelterOptimize:false,shelterGear:false,shelterPopulationTarget:14,shelterLevelTarget:10,
    shelterConstruction:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:0,partsReserve:0},
    shelterState:{campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},shelterPending:null,shelterRead:null,shelterCaravanNote:'',
    shelterConstructionNote:'',shelterStaffNote:'',shelterPopulationNote:'',shelterSocialNote:'',Date,
    crypto:{randomUUID:()=>String(v.serverTime)},log:{add:()=>{}},workshopAutomatic:()=>true};
  context.saveShelter=x=>context.shelterState=x;
  const api=vm.runInNewContext(`${implementation}\nshelterCampaign={...campaignDefaults};
    ({model:shelterModel,staff:shelterStaffPlan,campaign:shelterCampaignSchedule,
      development:shelterDevelopmentPlan,construction:shelterConstructionChoice})`,context);
  return {v,context,api};
}

test('满岗供电扩产：当前电力够用但下一工程缺电，满级发电房可由回收工接续扩建',()=>{
  const {v,context,api}=setup(fullPowerPrerequisiteView());context.shelterPopulationTarget=30;
  const m=api.model(v);assert.equal(m.demand.power,74.5);assert.equal(m.production.power,90.72);
  assert.ok(m.production.power>=m.demand.power*1.2&&m.production.power<76*1.2);
  assert.equal(api.staff(m),null,'原发电满岗满级，现有房间无法通过调岗补足');
  const before=JSON.stringify(v),c=api.construction(m);
  assert.ok(c,'必须把已确认的工程供电缺口转成实际发电扩产');
  assert.equal(c.kind,'dig');assert.equal(c.purpose.type,'power');assert.equal(c.floor,9);
  assert.ok(c.purpose.gain>0,'必须有可安全接替的真实工人，不能只建空房');
  assert.equal(JSON.stringify(v),before,'规划不预支库存、不提前调岗');
  v.state.resources.scrap-=c.cost.scrap;
  v.state.digging={floor:9,doneAt:v.serverTime+3600000};
  assert.equal(api.construction(api.model(v)),null,'正在下挖不重复付费');
  v.state.digging=null;v.state.depth=9;v.progress.score+=3;
  v.state.rooms.push({...v.state.rooms.find(r=>r.type==='elevator'),id:2009,floor:9});
  // 新楼层出现后可先执行耗电更低且合法的仓库；最多两格便用尽原供电余量，随后必须补发电。
  let build=api.construction(api.model(v)),safeStorage=0;
  while(build?.type==='storage'&&safeStorage<2){
    assert.equal(build.kind,'build');assert.ok(api.model(v).production.power>=(api.model(v).demand.power+.5)*1.2-1e-9);
    v.state.resources.scrap-=build.cost.scrap;
    v.state.rooms.push({...v.state.rooms[0],id:3100+safeStorage,type:'storage',floor:build.floor,col:build.col,width:1,level:1,stored:0});
    v.progress.score++;safeStorage++;build=api.construction(api.model(v));
  }
  assert.equal(build?.kind,'build');assert.equal(build.type,'power');
  v.state.resources.scrap-=build.cost.scrap;
  const room={...v.state.rooms[0],id:3001,type:'power',floor:build.floor,col:build.col,width:1,level:1,builtAt:v.serverTime+600000,stored:0};
  v.state.rooms.push(room);
  assert.equal(api.model(v).production.power,90.72,'施工中的空房不能提前计产');
  assert.equal(api.construction(api.model(v)),null,'等待发电完工，不重复扩建');
  v.serverTime+=600000;v.state.lastSettledAt=v.serverTime;v.progress.score++;
  const move=api.staff(api.model(v));assert.equal(move?.room,3001,'完工后须实际有人接续');
  assert.equal(v.state.rooms.find(r=>r.id===move.from)?.type,'scrap');
  v.state.residents.find(p=>p.id===move.id).roomId=move.room;
  const resumed=api.construction(api.model(v));assert.ok(resumed,'补电后原建设须继续');
  assert.equal(resumed.type,'storage');assert.ok(['build','upgrade'].includes(resumed.kind));
  assert.equal(api.development(api.model(v),30,api.campaign(api.model(v)),10).next.project.blocks.length,0,
    '原扩仓需求恢复为合法工程，不跳过供电检查');
  assert.equal(api.staff(api.model(v)),null,'开工前不能把刚补上的发电工调回');
});

test('满岗供电扩产：保留工程开关、预算、人工岗位、健康与基础供应限制',()=>{
  for(const change of [
    ({context})=>context.shelterConstruction.upgrade=false,
    ({context})=>context.shelterConstruction.scrapLimit=599,
    ({context})=>context.shelterPending={id:'pending'},
    ({context})=>context.shelterStaffMode='off',
    ({context})=>context.shelterStaffHold='人工调岗窗口',
    ({v})=>v.state.residents.filter(p=>v.state.rooms.find(r=>r.id===p.roomId)?.type==='scrap').forEach(p=>p.hp=1),
    ({v})=>v.state.residents.filter(p=>v.state.rooms.find(r=>r.id===p.roomId)?.type==='scrap').forEach(p=>p.roomId=8),
    ({v})=>v.state.resources.scrap=599
  ]){
    const x=setup(fullPowerPrerequisiteView());x.context.shelterPopulationTarget=30;change(x);
    const before=JSON.stringify(x.v),campaign=x.api.campaign(x.api.model(x.v));
    assert.equal(campaign.powerPreparation,null,'不具备合法原工程或安全接替时不能提前扩产');
    assert.equal(JSON.stringify(x.v),before);
  }
});
test('工程供电准备：当前供应充足但下一工程余量不足时先补现有发电空岗，不在开工前调回回收站',()=>{
  const {v,context,api}=setup(),m=api.model(v),plan=api.development(m,14,api.campaign(m),10);
  assert.equal(plan.levelProgress.score,148);assert.equal(m.demand.power,58);
  assert.ok(m.production.power>=58*1.2&&m.production.power<58.5*1.2);
  assert.match(plan.next.reason,/扩建后电力余量不足/);assert.equal(api.construction(m),null);
  const move=api.staff(m);assert.ok(move,'近期工程有材料、有预算且有安全人手，不能双方互等');
  assert.equal(move.room,1);assert.equal(move.from,4);assert.match(move.reason,/近期工程.*电力/);
  v.state.residents.find(p=>p.id===move.id).roomId=move.room;
  assert.equal(api.staff(api.model(v)),null,'补电后继续保留工程余量，不立即把同一工人调回');
  const c=api.construction(api.model(v));assert.ok(c);assert.equal(c.kind,'upgrade');assert.equal(c.id,1001);
  assert.equal(v.state.resources.scrap,68700);assert.equal(context.shelterPopulationTarget,14);
});
test('工程供电准备：开关、材料、额度、保留量或未决操作不允许开工时不提前占人',()=>{
  for(const change of [
    ({context})=>context.shelterConstruction.upgrade=false,
    ({v})=>v.state.resources.parts=0,
    ({context})=>context.shelterConstruction.scrapLimit=479,
    ({context})=>context.shelterConstruction.partsReserve=1,
    ({context})=>context.shelterPending={id:'unknown'},
    ({context})=>context.shelterState.constructionLedger=[{id:'spent',at:Date.now(),scrap:10000,parts:0}]
  ]){const scene=setup();change(scene);assert.equal(scene.api.staff(scene.api.model(scene.v)),null);}
});
test('工程供电准备：没有健康可调人员时保持原岗位，不抽空食物或净水供应',()=>{
  const {v,api}=setup();v.state.residents.filter(p=>p.roomId===4).forEach(p=>p.hp=1);
  const before=JSON.stringify(v);assert.equal(api.staff(api.model(v)),null);assert.equal(JSON.stringify(v),before);
});
test('工程供电准备：开工后由施工预留接续，取消自动升级则解除未开工工程的额外预留',()=>{
  for(const started of [false,true]){
    const {v,context,api}=setup(),move=api.staff(api.model(v));assert.ok(move);
    v.state.residents.find(p=>p.id===move.id).roomId=move.room;
    if(started){
      const c=api.construction(api.model(v));v.state.resources.scrap-=c.cost.scrap;v.state.resources.parts-=c.cost.parts;
      v.state.rooms.find(r=>r.id===c.id).upgradeAt=v.serverTime+3*3600000;
    }
    context.shelterConstruction.upgrade=false;
    const next=api.staff(api.model(v));
    if(started)assert.equal(next,null,'关闭新升级不取消已经开工工程的供电');
    else{assert.ok(next);assert.equal(next.from,1);assert.equal(next.room,4,'关闭未开工项目后可恢复回收岗位');}
  }
});
test('扩层供电准备：下挖目标房缺电时先补员，确认新楼层后接续建房，期间不虚增电力消耗',()=>{
  const {v,context,api}=setup(digPowerPrerequisiteView()),m=api.model(v);
  const p=api.development(m,14,api.campaign(m),10);assert.equal(p.next.kind,'dig');
  assert.equal(m.demand.power,69);assert.ok(m.production.power>=69*1.2&&m.production.power<69.5*1.2);
  assert.match(p.next.reason,/目标仓库：扩建后电力余量不足/);
  let moves=0;
  for(;moves<4;moves++){
    const a=api.staff(api.model(v));if(!a)break;
    if(!moves){assert.equal(a.room,1);assert.equal(a.from,4);}
    v.state.residents.find(p=>p.id===a.id).roomId=a.room;
  }
  assert.ok(moves>0&&moves<4,'应通过有限安全调岗解锁下挖，而非始终等待或循环往返');
  const dig=api.construction(api.model(v));assert.ok(dig);assert.equal(dig.kind,'dig');assert.equal(dig.floor,8);
  assert.equal(api.model(v).demand.power,69,'预留不写入实际耗电');
  v.state.resources.scrap-=dig.cost.scrap;
  context.shelterState.constructionLedger=[{id:'dig',at:Date.now(),...dig.cost}];
  // 单独注入已确认扩层的后状态，验证接续；不假定或推导真实下挖工期。
  v.state.depth=8;v.state.rooms.push({...v.state.rooms.find(r=>r.type==='elevator'),id:1108,floor:8});
  v.progress={level:8,score:173,next:174};
  assert.equal(api.model(v).demand.power,69);
  const build=api.construction(api.model(v));assert.ok(build);assert.equal(build.kind,'build');assert.equal(build.type,'storage');
  assert.equal(build.floor,8);assert.equal(v.state.resources.scrap,88000-dig.cost.scrap);
  assert.equal(context.shelterPopulationTarget,14);
});
test('扩层供电准备：下挖关闭、额度不足或原操作待核对时不为未来房间提前占人',()=>{
  for(const change of [
    ({context})=>context.shelterConstruction.dig=false,
    ({context})=>context.shelterConstruction.scrapLimit=Math.ceil(120*8**1.4)-1,
    ({context})=>context.shelterPending={id:'pending-dig'}
  ]){const s=setup(digPowerPrerequisiteView());change(s);assert.equal(s.api.staff(s.api.model(s.v)),null);}
});
test('扩层供电准备：只开下挖时也处理当前阶段供电条件，关闭下挖后停止额外准备',()=>{
  const {v,context,api}=setup(digPowerPrerequisiteView());context.shelterConstruction.build=false;context.shelterConstruction.upgrade=false;
  assert.equal(api.staff(api.model(v))?.room,1);
  context.shelterConstruction.dig=false;assert.equal(api.staff(api.model(v)),null);
});
