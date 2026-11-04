import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const table=source.match(/const shelterRooms = [\s\S]*?;/)[0];
const buildTable=source.match(/const shelterBuildRules = [\s\S]*?;/)[0];
const functions=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const {project,model,future,plan,render,proof,rewardProof,rewardConfirmed,periodCurrent,operations,explorers,exploreProof,exploreConfirmed,pendingWait,released,without,safe}=vm.runInNewContext(`${table}\n${buildTable}\n${functions}\n({project:shelterStoredProjection,model:shelterModel,future:shelterFutureCollection,plan:shelterDevelopmentPlan,render:shelterDevelopmentText,proof:shelterCollectProof,rewardProof:shelterRewardProof,rewardConfirmed:shelterRewardConfirmed,periodCurrent:shelterRewardPeriodCurrent,operations:shelterOperations,explorers:shelterExplorerCandidates,exploreProof:shelterExplorerProof,exploreConfirmed:shelterExplorerConfirmed,pendingWait:shelterPendingWait,released:shelterExplorerReleased,without:shelterProductionWithout,safe:shelterDepartureSafe});`,{
  shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
const now=2000000000;
test('避难所等待诊断：各类原操作遇到更早快照时说明同步等待，同时间与旧缺省记录保持原提示',()=>{
  for(const kind of ['assign','equip','collect','tutorial','achievement','daily','season']){
    const p={kind,before:{serverTime:now}},before=JSON.stringify(p),m={now:now-1};
    const wait=pendingWait(p,m);
    assert.equal(wait.data.reason,'snapshot-before-request');assert.match(wait.note,/快照时间早于原操作/);
    assert.equal(wait.data.snapshotAt,now-1);assert.equal(wait.data.requestSnapshotAt,now);
    assert.equal(JSON.stringify(p),before);
    assert.equal(pendingWait(p,{now}).data.reason,'result-unconfirmed');
    assert.equal(pendingWait({kind,before:{}},m).data.reason,'result-unconfirmed');
  }
});
function scene(type='scrap') {
  const room={id:1,type,width:1,level:1,floor:1,stored:0,builtAt:0,upgradeAt:null,unpowered:false,incident:null};
  const state={lastSettledAt:now,rooms:[room],residents:[{id:1,name:'甲',roomId:1,away:null,deadAt:null,adultAt:0,xp:0,happiness:100,
    outfitId:null,stats:{str:5,per:5,end:5,cha:5,int:5,agi:5,lck:5}}],items:[],handies:[],births:[],achievements:[],
    resources:{scrap:100,power:100,food:100,water:100,parts:0,stimpak:0},stats:{collected:0},daily:{day:'2026-11-03',claimed:[]},season:{month:'2026-11',claimedFree:[],points:0}};
  const view={vaultNo:77,serverTime:now,progress:{level:1},switches:{frozen:false},state};
  return {room,state,view};
}
test('避难所模型：产出按十分钟整步，不把连续九分钟算成一批',()=>{
  const {room,state}=scene();room.stored=29;state.lastSettledAt=now-599999;
  assert.equal(project(state,room,now,null,2100).stored,29);
  assert.ok(Math.abs(project(state,room,now+1,null,2100).stored-(29+8/6))<1e-10);
  assert.equal(project(state,room,now,null,2100).nextTickAt,now+1);
});
test('避难所模型：补算最多24小时，采样窗口开始时未成年者不凭当前成人状态补产',()=>{
  const {room,state}=scene('medbay');state.lastSettledAt=now-48*3600000;
  state.residents[0].happiness=0; // 0.3/hour, 24h=7.2 under the 8-unit room cap.
  assert.ok(Math.abs(project(state,room,now,null,100).stored-7.2)<1e-9);
  state.residents[0].adultAt=now-12*3600000;assert.equal(project(state,room,now,null,100).stored,0);
});
test('避难所模型：机器人按整批收取并受整数库存空位约束，不跨楼层收取',()=>{
  const {room,state}=scene();room.stored=30;state.lastSettledAt=now-600000;state.handies=[{floor:1}];
  let p=project(state,room,now,null,2100);assert.equal(p.autoCollected,30);assert.ok(Math.abs(p.stored-8/6)<1e-9);
  state.resources.scrap=2095.5;p=project(state,room,now,null,2100);assert.equal(p.autoCollected,4);
  state.handies[0].floor=2;assert.equal(project(state,room,now,null,2100).autoCollected,0);
});
test('避难所模型：零件每份消耗6废料，枯竭时停止补算',()=>{
  const {room,state}=scene('workshop');room.stored=2.9;state.lastSettledAt=now-3600000;
  state.resources.scrap=0;assert.equal(project(state,room,now,null,100).stored,2.9);
  state.resources.scrap=1.2;const p=project(state,room,now,null,100);
  assert.ok(Math.abs(p.stored-3.1)<1e-9);assert.ok(Math.abs(p.scrapConsumed-1.2)<1e-9);
});
test('避难所模型：在途跨结算点时预留下一批，机器人收入另计库存占用',()=>{
  const {room,state,view}=scene();room.stored=59.99;state.lastSettledAt=now-595000;
  const m=model(view);assert.equal(m.rooms[0].stored,59.99);assert.equal(future(m,10000).amounts[1],60);
  state.handies=[{floor:1}];const a=future(model(view),10000);assert.equal(a.automatic.scrap,60);assert.equal(a.amounts[1],0);
});
test('避难所模型：未知机器人楼层不能按没有机器人继续估算',()=>{
  const {state,view}=scene();state.handies=[{}];assert.throws(()=>model(view),/机器人楼层/);
});

function developmentScene(){
  const x=scene(),{state:s,view}=x;view.progress.level=8;s.depth=3;s.digging=null;
  const room=(id,type,floor,col,width=1,level=1)=>({...x.room,id,type,floor,col,width,level});
  s.rooms=[room(10,'elevator',1,1),room(11,'elevator',2,1),room(12,'elevator',3,1),
    room(1,'power',1,2),room(2,'diner',1,3),room(3,'water',1,4),room(4,'scrap',1,5),
    room(5,'quarters',2,2,3),room(6,'storage',3,2)];
  const adult={...s.residents[0],hp:100,romance:null};
  s.residents=Array.from({length:8},(_,i)=>({...adult,id:i+1,name:`居民${i+1}`,roomId:Math.floor(i/2)+1}));
  return x;
}

test('人员离岗产量：容量外成人不减产，多人离岗时按实际替补人数重算且不改原状态',()=>{
  const {state:s,view}=scene('diner'),adult=s.residents[0];
  s.residents=[1,2,3,4].map(id=>({...structuredClone(adult),id,stats:{...adult.stats,agi:0}}));
  const m=model(view),before=JSON.stringify(s);
  assert.equal(m.production.food,8);
  assert.equal(without(m,[4]).food,8);assert.equal(without(m,[1]).food,8);
  assert.equal(without(m,[1,2]).food,8);assert.equal(without(m,[1,2,3]).food,4);
  assert.equal(without(m,[1,2,3,4]).food,0);assert.equal(JSON.stringify(s),before);
});

test('人员离岗产量：不把外出、倒下、未成年或已预留离岗者算作生产替补',()=>{
  const {state:s,view}=scene('diner'),adult=s.residents[0];
  s.residents=[1,2,3,4,5].map(id=>({...structuredClone(adult),id,stats:{...adult.stats,agi:0}}));
  s.residents[2].away={kind:'explore'};s.residents[3].deadAt=now-1;s.residents[4].adultAt=now+1;
  assert.equal(without(model(view),[1]).food,4);
  for(const p of s.residents){p.away=null;p.deadAt=null;p.adultAt=0;}
  const m=model(view),futureModel={...m,production:without(m,[1,4,5]),reservedResidents:[1,4,5]};
  assert.equal(futureModel.production.food,8);assert.equal(without(futureModel,[2]).food,4);
});

test('人员离岗安全：最终产量充足不代表第一步安全，未来预留不能替代当前供应',()=>{
  const {state:s,view}=scene('diner'),adult=s.residents[0];
  s.residents=Array.from({length:8},(_,i)=>({...structuredClone(adult),id:i+1,roomId:i<4?1:null,
    stats:{...adult.stats,agi:i===0||i===3?10:0}}));
  const m=model(view);
  assert.equal(m.production.food,16);assert.equal(m.demand.food,8);
  assert.equal(without(m,[1]).food,8);assert.equal(safe(m,[1]),false);
  assert.equal(safe(m,[2]),true);assert.equal(safe(m,[1,2]),true);
  const futureModel={...m,production:without(m,[2]),reservedResidents:[2]};
  assert.equal(safe(futureModel,[1]),true,'父母离岗后的投影充足，仍须独立检查当前供应');
  assert.equal(safe(m,[1]),false);
});
test('发展规划：现有空位优先；一格扩建按已有同类格数涨价，不强推836废料下挖',()=>{
  const {state:s,view}=developmentScene();s.resources.scrap=269;
  const p=plan(model(view),14),house=p.candidates.find(c=>c.kind==='build'&&c.type==='quarters');
  assert.equal(house.cost.scrap,192);assert.equal(house.floor,1);assert.equal(house.col,6);assert.equal(house.hours,1/6);
  assert.equal(p.candidates.some(c=>c.kind==='dig'),false);assert.match(render(p),/836 废料/);assert.match(render(p),/不加快培养感情/);
  s.rooms.find(r=>r.type==='quarters').width=2;
  const merge=plan(model(view),14).candidates.find(c=>c.kind==='build'&&c.type==='quarters');
  assert.equal(merge.floor,2);assert.equal(merge.col,4);assert.equal(merge.cost.scrap,168);
});
test('发展规划：必须拓展空间时给出真实挖掘成本，已有挖掘不重复建议',()=>{
  const {state:s,view}=developmentScene();const base=s.rooms[0];
  s.rooms.push({...base,id:20,type:'storage',floor:1,col:6,width:2},{...base,id:21,type:'storage',floor:2,col:5,width:3},
    {...base,id:22,type:'storage',floor:3,col:3,width:3},{...base,id:23,type:'storage',floor:3,col:6,width:2});
  let p=plan(model(view));assert.equal(p.candidates.find(c=>c.kind==='dig').cost.scrap,836);
  s.digging={doneAt:now+600000};p=plan(model(view));assert.equal(p.candidates.some(c=>c.kind==='dig'),false);assert.match(render(p),/正在下挖/);
});

test('发展规划：预留外出人员归来后的供应，原生仍登记占位时不能建议直接补员',()=>{
  const {state:s,view}=developmentScene();
  for(let i=9;i<=30;i++)s.residents.push({...s.residents[0],id:i,name:`外出居民${i}`,away:{kind:'explore'},
    roomId:i<11?2:null,adultAt:i===30?now+3600000:0});
  const p=plan(model(view),14),food=p.candidates.find(c=>c.type==='diner');
  assert.ok(food);assert.ok(food.priority<30);assert.match(p.notes.join(' '),/外出居民归来/);
  s.residents.filter(r=>r.roomId===2).forEach(r=>r.away={kind:'explore'});
  const occupied=plan(model(view),14);
  assert.equal(occupied.candidates.some(c=>c.kind==='staff'&&c.type==='diner'),false);
  assert.match(occupied.notes.join(' '),/外出居民.*占位.*不能直接补员/);
  s.residents.filter(r=>r.roomId===2).forEach(r=>r.roomId=null);
  const vacant=plan(model(view),14).candidates.find(c=>c.kind==='staff'&&c.type==='diner');
  assert.match(vacant.benefit,/已有 2 个空岗/);
});
test('发展规划：优先现有空岗；额外空房不凭空增产，不抢培养感情的闲置人选',()=>{
  const {state:s,view}=developmentScene();s.residents[7].roomId=null;
  let p=plan(model(view));assert.equal(p.candidates[0].kind,'staff');assert.equal(p.candidates[0].type,'scrap');
  assert.equal(p.candidates.some(c=>c.type==='scrap'&&c.kind==='build'),false);
  s.residents.push({...s.residents[0],id:20,roomId:null,romance:{partnerId:21}});s.residents[7].roomId=4;
  p=plan(model(view));assert.equal(p.candidates.some(c=>c.type==='scrap'&&c.kind==='build'),false);
});
test('发展规划：三级升级计入零件与整间停产工期，新增收益按等级倍率计算',()=>{
  const {state:s,view}=developmentScene();s.rooms.find(r=>r.id===4).level=2;
  const c=plan(model(view)).candidates.find(c=>c.kind==='upgrade'&&c.type==='scrap');
  assert.equal(c.cost.scrap,480);assert.equal(c.cost.parts,15);assert.equal(c.hours,3);assert.equal(c.shortage.parts,15);
  assert.match(c.benefit,/9.6 废料\/小时/);assert.match(c.benefit,/期间停产/);
});
test('发展规划零件：缺工坊时给出真实建造前提和转化成本，备选升级不累加需求',()=>{
  const {state:s,view}=developmentScene();s.rooms.find(r=>r.id===4).level=2;view.progress.level=4;
  const p=plan(model(view)),workshop=p.candidates.find(c=>c.kind==='build'&&c.type==='workshop');
  assert.ok(workshop);assert.equal(workshop.cost.scrap,500);assert.equal(workshop.hours,1/6);
  assert.ok(workshop.blocks.includes('避难所 5 级解锁'));
  assert.match(render(p),/备选升级至少还缺 15 零件/);assert.match(render(p),/每生产 1 零件消耗 6 废料/);
  assert.match(render(p),/另外消耗 90 废料/);assert.match(workshop.benefit,/确认.*人选/);
  s.residents[7].roomId=null;
  const staffed=plan(model(view)).candidates.find(c=>c.kind==='build'&&c.type==='workshop');
  assert.match(staffed.benefit,/约产 0.6 零件\/小时/);assert.match(staffed.benefit,/消耗 3.6 废料\/小时/);
  s.residents[7].roomId=4;
  s.rooms.find(r=>r.type==='quarters').level=2;s.resources.parts=5;
  const alternatives=plan(model(view),20);assert.match(render(alternatives),/备选升级至少还缺 10 零件/);
  assert.match(render(alternatives),/另外消耗 60 废料/);
  assert.doesNotMatch(render(alternatives),/至少还缺 50 零件/);
});
test('发展规划零件：已有工坊施工先等，建成空岗先补员，有产出时按实际速度等待',()=>{
  const {state:s,view}=developmentScene();s.rooms.find(r=>r.id===4).level=2;
  const workshop={...s.rooms[0],id:30,type:'workshop',floor:1,col:6,builtAt:now+600000};s.rooms.push(workshop);
  let p=plan(model(view));assert.equal(p.candidates.some(c=>c.type==='workshop'),false);
  assert.match(render(p),/工坊.*施工.*先等/);
  workshop.builtAt=0;p=plan(model(view));
  assert.ok(p.candidates.some(c=>c.type==='workshop'&&c.kind==='staff'));
  assert.equal(p.candidates.some(c=>c.type==='workshop'&&c.kind==='build'),false);
  s.residents.push({...s.residents[0],id:20,name:'工坊值班',roomId:30});
  p=plan(model(view));assert.match(render(p),/当前工坊约 0.6 零件\/小时/);assert.match(render(p),/约需 25.0 小时/);
  assert.equal(p.candidates.some(c=>c.type==='workshop'&&c.kind==='build'),false);
  workshop.unpowered=true;p=plan(model(view));assert.match(render(p),/先恢复现有工坊/);
  assert.equal(p.candidates.some(c=>c.type==='workshop'),false);assert.doesNotMatch(render(p),/约需 25.0 小时/);
  s.resources.parts=15;p=plan(model(view));assert.equal(p.candidates.some(c=>c.type==='workshop'),false);
  assert.doesNotMatch(render(p),/备选升级至少还缺|当前工坊约/);
});
test('发展规划零件：空房无产出、外出占位不当空岗，补料时间保留废料不足条件',()=>{
  const {state:s,view}=developmentScene();s.rooms.find(r=>r.id===4).level=2;
  const workshop={...s.rooms[0],id:30,type:'workshop',floor:1,col:6};s.rooms.push(workshop);
  for(let id=20;id<22;id++)s.residents.push({...s.residents[0],id,name:'工坊人员'+id,roomId:30,away:{kind:'explore'}});
  let p=plan(model(view));assert.equal(p.candidates.some(c=>c.type==='workshop'),false);
  assert.match(render(p),/工坊岗位.*外出.*等待归来/);
  s.residents.at(-1).away=null;s.resources.scrap=1;
  p=plan(model(view));assert.match(render(p),/另外消耗 90 废料/);assert.match(render(p),/废料不足.*89/);
  assert.match(render(p),/持续供料和收取/);
});
test('发展规划医疗：只有已知在家伤员且无针时准备医务室，列出建造前提且不改状态',()=>{
  const {state:s,view}=developmentScene();s.residents[0].hp=25;view.progress.level=2;
  const before=JSON.stringify(view),p=plan(model(view)),medical=p.candidates.find(c=>c.type==='medbay');
  assert.ok(medical);assert.equal(medical.kind,'build');assert.equal(medical.cost.scrap,300);assert.equal(medical.hours,1/6);
  assert.equal(medical.shortage.scrap,200);assert.ok(medical.blocks.includes('避难所 3 级解锁'));
  assert.match(render(p),/在家 1 名伤员.*治疗针不足/);assert.match(render(p),/有人值班时伤员恢复更快/);
  assert.match(medical.benefit,/智力.*人选/);assert.equal(JSON.stringify(view),before);
  for(const change of [()=>s.resources.stimpak=1,()=>s.residents[0].hp=100,()=>s.residents[0].hp=null,
    ()=>s.residents[0].hp=101,()=>s.residents[0].away={kind:'explore'},()=>s.residents[0].deadAt=now-1]){
    const next=developmentScene();next.state.residents[0].hp=25;
    s.resources.stimpak=0;s.residents[0]={...next.state.residents[0]};change();
    const advice=plan(model(view));assert.equal(advice.candidates.some(c=>c.type==='medbay'),false);
    assert.doesNotMatch(render(advice),/先准备医疗供应/);
  }
});

test('发展规划医疗：先用现有医务室与已存整批，缺员和持续生产分别提示且不重复建造',()=>{
  const {state:s,view}=developmentScene();s.residents[0].hp=25;
  const medbay={...s.rooms[0],id:30,type:'medbay',floor:1,col:6,stored:1.5};s.rooms.push(medbay);
  let p=plan(model(view));assert.equal(p.candidates.find(c=>c.type==='medbay')?.kind,'staff');
  assert.match(render(p),/已有 2 个空岗.*智力/);assert.doesNotMatch(render(p),/已存整批/);
  // 其他在建医务室不阻止先使用现有空岗。
  s.rooms.push({...medbay,id:31,floor:2,col:5,builtAt:now+600000});
  assert.equal(plan(model(view)).candidates.find(c=>c.type==='medbay')?.kind,'staff');
  medbay.stored=2;p=plan(model(view));assert.match(render(p),/医务室已存整批治疗针.*核对领取/);
  assert.equal(p.candidates.some(c=>c.type==='medbay'),false);
  medbay.stored=0;s.residents.push({...s.residents[1],id:20,name:'医务室值班',roomId:30});
  p=plan(model(view));assert.match(render(p),/当前医务室约 0.5 治疗针\/小时/);
  assert.equal(p.candidates.some(c=>c.type==='medbay'),false);
  s.resources.stimpak=1;p=plan(model(view));assert.doesNotMatch(render(p),/当前医务室约|先准备医疗供应/);
});

test('发展规划医疗：外出占位不当空岗，工程及停产先恢复，基础供应仍优先',()=>{
  const {state:s,view}=developmentScene();s.residents[0].hp=25;
  const medbay={...s.rooms[0],id:30,type:'medbay',floor:1,col:6};s.rooms.push(medbay);
  for(let id=20;id<22;id++)s.residents.push({...s.residents[1],id,name:'外出医务人员'+id,roomId:30,away:{kind:'explore'}});
  let p=plan(model(view));assert.equal(p.candidates.some(c=>c.type==='medbay'),false);
  assert.match(render(p),/医务室岗位.*外出.*等待归来/);
  medbay.builtAt=now+600000;p=plan(model(view));assert.match(render(p),/医务室.*施工.*先等/);
  medbay.builtAt=0;medbay.upgradeAt=now+600000;p=plan(model(view));assert.match(render(p),/医务室.*升级.*先等/);
  medbay.upgradeAt=null;medbay.unpowered=true;p=plan(model(view));assert.match(render(p),/先恢复现有医务室/);
  medbay.unpowered=false;medbay.incident={kind:'fire'};p=plan(model(view));assert.match(render(p),/先恢复现有医务室/);
  assert.equal(p.candidates.some(c=>c.type==='medbay'),false);
  s.rooms=s.rooms.filter(r=>r.id!==30);s.residents=s.residents.filter(p=>p.id<20);
  s.residents.filter(p=>p.roomId===1).forEach(p=>p.roomId=null);
  p=plan(model(view));const medical=p.candidates.find(c=>c.type==='medbay');
  assert.ok(medical.blocks.some(b=>/电力余量不足/.test(b)));assert.equal(p.candidates[0].type,'power');
  delete s.rooms[0].col;p=plan(model(view));assert.equal(p.candidates.some(c=>c.type==='medbay'),false);
  assert.match(render(p),/布局资料不完整/);assert.match(render(p),/先准备医疗供应/);
});

test('发展规划：基础供应升级必须覆盖停产与两小时储备',()=>{
  const {state:s,view}=developmentScene();s.residents=s.residents.filter(p=>p.roomId!==2||p.id===3);
  s.residents.find(p=>p.id===3).stats={...s.residents[2].stats,agi:0};s.resources.food=1;
  const c=plan(model(view)).candidates.find(c=>c.kind==='upgrade'&&c.type==='diner');
  assert.ok(c.blocks.some(x=>/停产期间食物需至少 21 库存/.test(x)));assert.match(render(plan(model(view))),/先决条件/);
});
test('发展规划：人口含外出、儿童和待产，已在施工的宿舍预留容量',()=>{
  const {state:s,view}=developmentScene();s.residents[0].away={};s.residents[1].adultAt=now+3600000;s.births=[{dueAt:now+600000,roomId:5}];
  s.rooms.push({...s.rooms[0],id:30,type:'quarters',floor:2,col:5,width:1,builtAt:now+600000});
  const p=plan(model(view),14);assert.equal(p.population,9);assert.equal(p.capacity,12);assert.equal(p.committedCapacity,16);
  assert.equal(p.candidates.some(c=>c.type==='quarters'),false);
});
test('发展规划生育床位：感情关系预留出生名额，单方回执不漏算，转为待产或出生后不重复计算',()=>{
  const {state:s,view}=developmentScene();s.rooms.find(r=>r.type==='quarters').width=2;
  for(const [i,other] of [[6,8],[7,7]])Object.assign(s.residents[i],{roomId:5,romance:{partnerId:other}});
  let p=plan(model(view),8);
  assert.equal(p.population,8);assert.equal(p.target,9);assert.equal(p.reservedBirths,1);assert.equal(p.requestedTarget,8);
  assert.ok(p.candidates.some(c=>c.type==='quarters'));assert.match(render(p),/设置目标 8.*规划容量至少 9/);
  assert.match(render(p),/培养感情.*预留 1/);
  s.residents[7].romance=null;p=plan(model(view),8);assert.equal(p.target,9);assert.equal(p.reservedBirths,1);
  s.births=[{roomId:5,parents:[7,8],dueAt:now+3600000}];p=plan(model(view),8);
  assert.equal(p.population,9);assert.equal(p.target,9);assert.equal(p.reservedBirths,0);
  s.births=[];s.residents[6].romance=null;
  s.residents.push({...s.residents[0],id:9,name:'孩子',roomId:5,adultAt:now+3600000});p=plan(model(view),8);
  assert.equal(p.population,9);assert.equal(p.target,9);assert.equal(p.reservedBirths,0);
});
test('发展规划生育床位：恢复与出生预留合并，已开工容量够用时不重复建议扩建',()=>{
  const {state:s,view}=developmentScene();s.rooms.find(r=>r.type==='quarters').width=2;
  for(const [i,other] of [[6,8],[7,7]])Object.assign(s.residents[i],{roomId:5,romance:{partnerId:other}});
  s.residents.push({...s.residents[0],id:9,name:'等待救回',roomId:null,deadAt:now-60000,hp:0});
  s.rooms.push({...s.rooms[0],id:30,type:'quarters',floor:2,col:4,width:1,builtAt:now+600000});
  let p=plan(model(view),8);assert.equal(p.target,10);assert.equal(p.requestedTarget,8);assert.equal(p.committedCapacity,12);
  assert.equal(p.candidates.some(c=>c.type==='quarters'),false);
  s.rooms=s.rooms.filter(r=>r.id!==30);p=plan(model(view),8);
  assert.equal(p.target,10);assert.ok(p.candidates.some(c=>c.type==='quarters'));assert.match(render(p),/设置目标 8.*规划容量至少 10/);
  p=plan(model(view),null);assert.equal(p.requestedTarget,null);assert.equal(p.target,10);assert.match(render(p),/人口目标未设置.*规划容量至少 10/);
});

test('同宿舍生育规划：一对待产和另一对培养感情分别计数，口粮与床位不因同房漏算',()=>{
  const {state:s,view}=developmentScene();
  for(const [i,other] of [[6,8],[7,7]])Object.assign(s.residents[i],{roomId:5,romance:{partnerId:other}});
  s.births=[{roomId:5,parents:[3,4],dueAt:now+3600000}];
  const before=JSON.stringify(s),p=plan(model(view),8);
  assert.equal(p.population,9);assert.equal(p.reservedBirths,1);assert.equal(p.target,10);
  assert.match(render(p),/另预留 1 个出生名额/);assert.equal(JSON.stringify(s),before);
});

test('同宿舍生育规划：只按完整父母编号合并感情与待产，父母顺序或当前位置不影响匹配',()=>{
  const {state:s,view}=developmentScene();
  for(const [i,other] of [[6,8],[7,7]])Object.assign(s.residents[i],{roomId:5,romance:{partnerId:other}});
  for(const parents of [[7,8],[8,7]]){
    s.births=[{roomId:5,parents,dueAt:now+3600000}];
    assert.equal(plan(model(view),8).reservedBirths,0);
    s.residents[6].roomId=4;assert.equal(plan(model(view),8).reservedBirths,0);
    s.residents[6].roomId=5;
  }
});

test('同宿舍生育规划：缺失或异常父母资料不凭房间消掉名额，资料补齐后自动合并',()=>{
  const {state:s,view}=developmentScene();s.residents[6].roomId=5;s.residents[6].romance={partnerId:8};
  for(const parents of [undefined,null,[],[7],[7,7],[7,'8'],[7,8,9],[3,4]]){
    s.births=[{roomId:5,parents,dueAt:now+3600000}];
    const p=plan(model(view),8);assert.equal(p.reservedBirths,1);assert.equal(p.target,10);
  }
  s.births[0].parents=[8,7];const p=plan(model(view),8);
  assert.equal(p.reservedBirths,0);assert.equal(p.target,9);
});

test('发展规划人口恢复：倒下人员计入未来口粮，当前消耗与生产仍只按实际状态',()=>{
  const {state:s,view}=developmentScene();
  s.residents.filter(p=>p.roomId===2).forEach(p=>p.stats={...p.stats,agi:3});
  const baseline=model(view);assert.ok(baseline.production.food>=baseline.demand.food*1.2);
  for(let id=9;id<=12;id++)s.residents.push({...s.residents[0],id,name:'倒下'+id,roomId:1,deadAt:now-60000,hp:0});
  const m=model(view),p=plan(m,14),food=p.candidates.find(c=>c.type==='diner');
  assert.ok(food&&food.priority<30);assert.equal(p.population,8);assert.equal(p.recovering,4);
  assert.deepEqual(m.demand,baseline.demand);assert.deepEqual(m.production,baseline.production);
  assert.match(render(p),/倒下.*4.*预留/);
});
test('发展规划人口恢复：期限过后记录仍在就保留床位，救回不重复计算，记录移除才释放',()=>{
  const {state:s,view}=developmentScene();s.rooms.find(r=>r.type==='quarters').width=2;
  for(let id=9;id<=10;id++)s.residents.push({...s.residents[0],id,name:'倒下'+id,roomId:null,deadAt:now-25*3600000,hp:0});
  let p=plan(model(view),8);assert.equal(p.population,8);assert.equal(p.recovering,2);assert.equal(p.target,10);
  assert.ok(p.candidates.some(c=>c.type==='quarters'));
  Object.assign(s.residents.find(p=>p.id===9),{deadAt:null,hp:100});
  p=plan(model(view),8);assert.equal(p.population,9);assert.equal(p.recovering,1);assert.equal(p.target,10);
  s.residents=s.residents.filter(p=>p.id!==10);p=plan(model(view),8);
  assert.equal(p.population,9);assert.equal(p.recovering,0);assert.equal(p.target,9);
});
test('发展规划：施工名额与电力不足写明前提，未解锁仓库不能当作可建',()=>{
  const {state:s,view}=developmentScene();s.resources.scrap=3900;view.progress.level=1;
  s.rooms.find(r=>r.type==='power').unpowered=true;
  s.rooms.push({...s.rooms[0],id:30,type:'training',floor:2,col:5,builtAt:now+600000},
    {...s.rooms[0],id:31,type:'medbay',floor:3,col:3,builtAt:now+600000});
  const c=plan(model(view)).candidates.find(c=>c.type==='storage'&&c.kind==='build');
  assert.ok(c.blocks.some(x=>x.includes('施工名额')));assert.ok(c.blocks.some(x=>x.includes('电力余量不足')));
  assert.ok(c.blocks.some(x=>x.includes('2 级解锁')));
});

test('发展规划：在建房间完工后的耗电先预留，完工后不重复计入，发电站本身不耗电',()=>{
  const {state:s,view}=developmentScene();
  s.residents.filter(p=>p.roomId===1).forEach(p=>{p.stats={...p.stats,str:0};p.happiness=0;});
  const added={...s.rooms[0],id:30,type:'workshop',floor:2,col:5,width:3,builtAt:now+600000};s.rooms.push(added);
  const candidate=()=>plan(model(view),14).candidates.find(c=>c.type==='quarters'&&c.kind==='build');
  assert.ok(candidate().blocks.some(x=>x.includes('电力余量不足')),'已开工工坊不能被当作没有未来耗电');
  assert.match(render(plan(model(view),14)),/已在施工.*3.*电力/);
  added.type='power';
  assert.equal(candidate().blocks.some(x=>x.includes('电力余量不足')),false,'在建发电站本身不预留耗电');
  added.type='workshop';added.builtAt=now;
  s.residents.filter(p=>p.roomId===1).forEach(p=>{p.happiness=100;}); // 12/h supports (8 + 0.5)*1.2, not a duplicate 3/h reservation.
  assert.equal(candidate().blocks.some(x=>x.includes('电力余量不足')),false,'完工后的耗电已在当前需求中，不再加一次');
});

test('发展规划：已提交升级预留新增耗电，完成后按新等级计算',()=>{
  const {state:s,view}=developmentScene();
  s.residents.filter(p=>p.roomId===1).forEach(p=>{p.stats={...p.stats,str:0};p.happiness=0;});
  const room=s.rooms.find(r=>r.type==='quarters');room.upgradeAt=now+3600000;
  s.residents.push({...s.residents[0],id:30,roomId:null,happiness:100});
  const candidate=()=>plan(model(view),20).candidates.find(c=>c.type==='scrap'&&c.kind==='build');
  assert.ok(candidate().blocks.some(x=>x.includes('电力余量不足')),'已升级宿舍完工后多用1.5电力/小时');
  assert.match(render(plan(model(view),20)),/已在施工.*1.5.*电力/);
  room.upgradeAt=null;room.level=2;
  s.residents.filter(p=>p.roomId===1).forEach(p=>{p.happiness=50;}); // 9.6/h covers 7.5*1.2, not a second 1.5/h reservation.
  assert.equal(candidate().blocks.some(x=>x.includes('电力余量不足')),false);
});
test('发展规划：净废料扣除工坊耗料，不为负净产估计乐观攒料时间',()=>{
  const {state:s,view}=developmentScene();const r={...s.rooms[0],id:30,type:'workshop',floor:3,col:3,width:3};s.rooms.push(r);
  s.residents.push(...Array.from({length:6},(_,i)=>({...s.residents[0],id:30+i,roomId:30,stats:{...s.residents[0].stats,int:10}})));
  s.resources.scrap=0;const p=plan(model(view),20);assert.ok(p.netScrap<0);
  assert.ok(p.candidates.every(c=>c.saveHours===null));assert.match(render(p),/净增不为正/);
});

test('发展规划扩仓：在建或升级仓库足以缓解当前满仓时先等完工，取消工程后再建议扩仓',()=>{
  for(const mode of ['build','upgrade']){
    const {state:s,view}=developmentScene();s.resources.scrap=3200;s.items=Array.from({length:28},(_,id)=>({id}));
    const warehouse=s.rooms.find(r=>r.type==='storage');
    if(mode==='build')s.rooms.push({...warehouse,id:30,col:3,builtAt:now+600000});else warehouse.upgradeAt=now+3600000;
    const p=plan(model(view));assert.equal(p.candidates.some(c=>c.type==='storage'),false,mode);
    assert.match(render(p),/先等.*完工/);assert.match(render(p),/3300.*4500/);assert.match(render(p),/30.*40/);
    assert.match(render(p),/领取仍按当前容量/);
    if(mode==='build')s.rooms=s.rooms.filter(r=>r.id!==30);else warehouse.upgradeAt=null;
    assert.ok(plan(model(view)).candidates.some(c=>c.type==='storage'),mode+' cancelled');
  }
});

test('发展规划扩仓：在建容量仍不足以缓解满仓时保留后续扩仓方案，不因有施工一律跳过',()=>{
  const {state:s,view}=developmentScene(),warehouse=s.rooms.find(r=>r.type==='storage');
  warehouse.width=3;warehouse.level=3;s.resources.scrap=12800;
  s.rooms.push({...warehouse,id:30,col:5,width:1,level:1,builtAt:now+600000});
  const p=plan(model(view));assert.ok(p.candidates.some(c=>c.kind==='build'&&c.type==='storage'));
  assert.match(render(p),/完工后仍.*接近满仓/);
});

test('发展规划扩仓：生产房间完工也增加对应资源容量，未来容量只用于建议',()=>{
  const {state:s,view}=developmentScene();s.resources.scrap=3200;
  s.rooms.push({...s.rooms.find(r=>r.type==='scrap'),id:30,floor:1,col:6,builtAt:now+600000});
  const m=model(view),p=plan(m);assert.equal(m.caps.scrap,3300);
  assert.equal(p.candidates.some(c=>c.type==='storage'),false);assert.match(render(p),/3300.*3900/);
  assert.equal(m.caps.scrap,3300,'给出规划不能改变用于领取的当前容量');
});

test('发展规划扩仓：传承加成按扩容前后总容量取整求差，治疗针不能把6写成5',()=>{
  const {state:s,view}=developmentScene();s.legacy={perks:{storage:1}};s.resources.scrap=3200;
  const p=plan(model(view)),build=p.candidates.find(c=>c.kind==='build'&&c.type==='storage'),upgrade=p.candidates.find(c=>c.kind==='upgrade'&&c.type==='storage');
  assert.equal(model(view).caps.stimpak,15);
  assert.match(build.benefit,/治疗针 6/);assert.match(upgrade.benefit,/治疗针 6/);
  const warehouse=s.rooms.find(r=>r.type==='storage');warehouse.width=3;s.resources.scrap=5700;
  const wide=plan(model(view)).candidates.find(c=>c.kind==='upgrade'&&c.type==='storage');
  assert.match(wide.benefit,/治疗针 16/);assert.match(wide.benefit,/装备 30/);
});

test('发展规划扩仓：工程所需容量将在现有施工完工后满足时提示等待，不再要求额外扩仓',()=>{
  const {state:s,view}=developmentScene(),base=s.rooms[0];s.depth=10;
  s.rooms.push({...base,id:30,type:'storage',floor:3,col:3,builtAt:now+600000});
  let id=40;
  for(let floor=1;floor<=10;floor++){
    if(floor>3)s.rooms.push({...base,id:id++,floor});
    let col=Math.max(2,...s.rooms.filter(r=>r.floor===floor).map(r=>r.col+r.width));
    while(col<8){const width=Math.min(3,8-col);s.rooms.push({...base,id:id++,type:'training',floor,col,width});col+=width;}
  }
  const dig=plan(model(view)).candidates.find(c=>c.kind==='dig');assert.ok(dig);
  assert.ok(dig.cost.scrap>3300&&dig.cost.scrap<4500);
  assert.ok(dig.blocks.some(x=>/先等.*完工.*容量/.test(x)));assert.equal(dig.blocks.some(x=>/先扩仓/.test(x)),false);
});
test('发展规划：缺布局或重叠布局只限制建议，不阻断其他避难所模型',()=>{
  const {state:s,view}=developmentScene();delete s.rooms[0].col;
  let p=plan(model(view));assert.match(render(p),/布局资料不完整/);assert.ok(p.candidates.some(c=>c.kind==='upgrade'));
  assert.equal(p.candidates.some(c=>c.kind==='build'||c.kind==='dig'),false);
  s.rooms[0].col=2;p=plan(model(view));assert.match(render(p),/布局资料不完整/);
});
test('避难所领取证明：请求目标、账号及对应库存变化缺一不可，200和retry不能单独当成功',()=>{
  const {view}=scene();view.state.stats.collected=30;
  const p={kind:'collect',targets:[1],vaultNo:77,before:{collected:0,serverTime:now-2000,rooms:[{id:1,stored:30}]}};
  const request={action:{type:'collect',roomId:1},idempotencyKey:'abcdefgh-1234'},body={view,result:{}};
  const evidence=proof(p,200,request,body);assert.equal(evidence.collected,30);assert.equal(evidence.key,request.idempotencyKey);
  assert.equal(proof(p,200,request,{}),null);assert.equal(proof(p,200,request,{...body,code:'retry'}),null);
  assert.equal(proof(p,503,request,body),null);assert.equal(proof(p,200,{...request,action:{type:'collect',roomId:2}},body),null);
  assert.equal(proof(p,200,{...request,action:{type:'collect_all'}},body),null);
  assert.equal(proof(p,200,request,{view:{...view,vaultNo:88}}),null);
  view.state.rooms[0].stored=30;assert.equal(proof(p,200,request,body),null);
});
test('周期奖励证明：仅原动作、目标、周期及成功状态同时匹配才保留证据',()=>{
  for(const kind of ['daily','season']){
    const {view}=scene(),daily=kind==='daily',target=daily?0:1;
    view.state[kind][daily?'claimed':'claimedFree']=[target];
    const p={id:'original',kind,targets:[target],vaultNo:77,before:{serverTime:now-2000,day:'2026-11-03',month:'2026-11'}};
    const request={action:daily?{type:'claim_objective',index:target}:{type:'claim_season',tier:target,premium:false},idempotencyKey:'abcdefgh-1234'};
    const body={view,result:{}},saved=rewardProof(p,200,request,body);
    assert.equal(saved.target,target);assert.equal(saved.operationId,p.id);assert.equal(saved.period,daily?p.before.day:p.before.month);
    for(const [status,r,b] of [[503,request,body],[200,request,{}],[200,request,{...body,code:'retry'}],
      [200,{...request,idempotencyKey:12345678},body],[200,{...request,action:{...request.action,extra:1}},body],
      [200,{...request,action:{...request.action,[daily?'index':'tier']:target+1}},body],
      [200,request,{view:{...view,vaultNo:88}}],[200,request,{view:{...view,serverTime:now-3000}}]])
      assert.equal(rewardProof(p,status,r,b),null);
    if(!daily)assert.equal(rewardProof(p,200,{...request,action:{...request.action,premium:true}},body),null);
    view.state[kind][daily?'day':'month']=daily?'2026-11-04':'2026-12';
    assert.equal(rewardProof(p,200,request,body),null,'same target in another period cannot prove the original');
    view.state[kind][daily?'day':'month']=daily?p.before.day:p.before.month;
    view.state[kind][daily?'claimed':'claimedFree']=[];assert.equal(rewardProof(p,200,request,body),null);
  }
});
test('周期发送判断：按服务器快照和经过时间判断北京时间边界，不采用本机绝对日期',()=>{
  const server=Date.parse('2026-10-31T23:59:59.500+08:00'),local=Date.parse('2040-01-12T03:00:00Z');
  for(const kind of ['daily','season']){
    assert.equal(periodCurrent(kind,server,local,local+499),true);
    assert.equal(periodCurrent(kind,server,local,local+500),false);
    assert.equal(periodCurrent(kind,server,local,local-1000),true,'backward local clock does not project the server backward');
    assert.equal(periodCurrent(kind,server+1000,local+1000,local+1500),true,'fresh post-boundary snapshot can be used');
  }
  const midMonth=Date.parse('2026-11-03T23:59:59.500+08:00');
  assert.equal(periodCurrent('daily',midMonth,local,local+500),false);
  assert.equal(periodCurrent('season',midMonth,local,local+500),true);
  const leap=Date.parse('2028-02-29T23:59:59.500+08:00');
  assert.equal(periodCurrent('season',leap,local,local+500),false);
});
test('周期发送判断：无效时间不放行周期奖励，普通收取不受日期边界限制',()=>{
  for(const values of [[NaN,0,0],[0,Infinity,0],[0,0,NaN],[1e20,0,0],[0,0,1e20]])
    assert.equal(periodCurrent('daily',...values),false);
  assert.equal(periodCurrent('collect',NaN,NaN,NaN),true);
  assert.equal(periodCurrent('season',Date.parse('2026-10-10T12:00:00Z'),0,86400000),true);
});
test('周期奖励确认：跨周期证据必须属于原记录，错误目标、账号、时间和键不能解除等待',()=>{
  const {view}=scene();view.state.daily.claimed=[0];
  const p={id:'original',kind:'daily',targets:[0],vaultNo:77,before:{serverTime:now-2000,day:'2026-11-03',month:'2026-11'}};
  const proof=rewardProof(p,200,{action:{type:'claim_objective',index:0},idempotencyKey:'abcdefgh-1234'},{view});
  view.state.daily={day:'2026-11-04',claimed:[0]};p.result={rewardProofs:[proof]};
  assert.equal(rewardConfirmed(p,model(view)),true);
  for(const mutation of [{operationId:'another'},{kind:'season'},{target:1},{period:'2026-11-04'},
    {vaultNo:88},{at:now-3000},{at:now+1},{at:NaN},{key:12345678},{key:'bad'}]){
    p.result.rewardProofs=[{...proof,...mutation}];assert.equal(rewardConfirmed(p,model(view)),false,JSON.stringify(mutation));
  }
  p.result={outcome:'ok',status:200};assert.equal(rewardConfirmed(p,model(view)),false);
  view.state.daily.day=p.before.day;assert.equal(rewardConfirmed(p,model(view)),true,'same-period state confirmation remains available');
});
test('赛季奖励确认：跨月必须覆盖全部原档位，部分凭据不借新月已领列表补全',()=>{
  const {view}=scene();view.state.season.claimedFree=[1,2];
  const p={id:'batch',kind:'season',targets:[1,2],vaultNo:77,before:{serverTime:now-2000,day:'2026-11-03',month:'2026-11'}};
  const proofs=[1,2].map(tier=>rewardProof(p,200,{action:{type:'claim_season',tier,premium:false},idempotencyKey:`batch-key-${tier}`},{view}));
  p.result={rewardProofs:proofs.slice(0,1)};view.state.season.claimedFree=[2];
  assert.equal(rewardConfirmed(p,model(view)),true,'same-period remaining claim may complete the original batch');
  view.state.season.month='2026-12';assert.equal(rewardConfirmed(p,model(view)),false);
  p.result.rewardProofs=proofs;assert.equal(rewardConfirmed(p,model(view)),true);
  assert.equal(rewardConfirmed(p,model({...view,vaultNo:88})),false);
});
test('运行提醒：无人处理事件、停电和即将耗尽的库存提前复查',()=>{
  const {state:s,view}=developmentScene();s.rooms.find(r=>r.type==='scrap').incident={kind:'fire'};
  s.residents=s.residents.filter(p=>p.roomId!==4);s.rooms.find(r=>r.type==='power').unpowered=true;s.resources.power=0;
  const ops=operations(model(view));assert.equal(ops.counts.incidents,1);assert.equal(ops.counts.unpowered,1);assert.equal(ops.counts.lowSupply,1);
  assert.match(ops.messages.join('\n'),/没有成人在场/);assert.ok(ops.events.includes(60000));
});
test('伤员应急提醒：在家重伤优先，血量上限使用基础耐力，治疗针只给出已知条件',()=>{
  const {state:s,view}=developmentScene();s.explorers=[];s.quests=[];
  s.residents[0].xp=3;s.residents[0].hp=52;s.residents[0].outfitId=99;
  s.items=[{id:99,slot:'outfit',stats:{end:50}}];s.residents[1].hp=99;
  s.residents[2].hp=20;s.residents[2].away={kind:'quest'};s.residents[3].deadAt=now-1;
  const ops=operations(model(view));assert.equal(ops.counts.homeHurt,2);assert.equal(ops.counts.homeCritical,1);
  assert.match(ops.messages.join('\n'),/52\/105/);assert.match(ops.messages.join('\n'),/不足一半/);
  assert.match(ops.messages.join('\n'),/治疗针不足/);assert.ok(ops.events.includes(5*60000));
  s.resources.stimpak=2;assert.match(operations(model(view)).messages.join('\n'),/居民详情.*用治疗针/);
});
test('伤员应急提醒：缺失血量不当作满血，求援仅依据服务端明确标记',()=>{
  const {state:s,view}=developmentScene();delete s.residents[0].hp;s.explorers=[];s.quests=[];
  view.reliefAvailable='true';let ops=operations(model(view));assert.equal(ops.counts.healthUnknown,1);
  assert.equal(ops.counts.relief,0);assert.match(ops.messages.join('\n'),/血量资料不完整/);
  view.reliefAvailable=true;ops=operations(model(view));assert.equal(ops.counts.relief,1);
  assert.match(ops.messages.join('\n'),/向方舟求援/);assert.ok(ops.events.includes(5*60000));
});
test('倒下居民提醒：在家倒下显示网页24小时期限并预约复查，过期不猜测已经安葬',()=>{
  const {state:s,view}=developmentScene();s.explorers=[];s.quests=[];
  s.residents[0].deadAt=now-23*3600000;s.residents[0].hp=0;
  let ops=operations(model(view));assert.equal(ops.counts.homeDown,1);assert.equal(ops.counts.homeHurt,0);
  assert.match(ops.messages.join('\n'),/居民1.*倒下.*24.*60 分钟.*救回/);
  assert.ok(ops.events.includes(5*60000));assert.ok(ops.events.includes(3600000));
  s.residents[0].deadAt=now-25*3600000;ops=operations(model(view));
  assert.match(ops.messages.join('\n'),/已到.*24.*期限.*核对/);
  assert.doesNotMatch(ops.messages.join('\n'),/已经安葬|已被安葬/);
  assert.ok(ops.events.every(n=>n>0));
});
test('倒下居民提醒：普通通知不能遮住在家救援，探险倒下仍单独核对且不重复计数',()=>{
  const {state:s,view}=developmentScene();s.quests=[];
  s.rooms=Array.from({length:30},(_,i)=>({...s.rooms[0],id:50+i,unpowered:true}));
  s.residents[0].deadAt=now-60000;s.residents[0].hp=0;
  s.residents[1].deadAt=now-60000;s.residents[1].hp=0;s.residents[1].away={kind:'explore'};
  s.explorers=[{residentId:2,returnAt:now-1}];
  const ops=operations(model(view));assert.equal(ops.counts.homeDown,1);assert.equal(ops.counts.down,1);
  assert.ok(ops.messages.length<=24);assert.match(ops.messages.join('\n'),/居民1.*倒下.*救回/);
  assert.match(ops.messages.join('\n'),/居民2.*探险中倒下/);
  assert.equal(ops.messages.filter(message=>message.includes('居民2')).length,1);
  s.residents[1].away=null;const delayed=operations(model(view));
  assert.equal(delayed.counts.homeDown,1);assert.equal(delayed.counts.down,1);
  assert.equal(delayed.messages.filter(message=>message.includes('居民2')).length,1);
});
test('伤员应急提醒：大量普通房间通知不能截掉低血量和求援提醒',()=>{
  const {state:s,view}=developmentScene();s.rooms=Array.from({length:30},(_,i)=>({...s.rooms[0],id:50+i,unpowered:true}));
  s.residents[0].hp=1;view.reliefAvailable=true;
  const ops=operations(model(view));assert.ok(ops.messages.length<=24);
  assert.match(ops.messages.join('\n'),/向方舟求援/);assert.match(ops.messages.join('\n'),/居民1.*不足一半/);
  assert.match(ops.messages.at(-1),/另有.*提醒/);
});
test('感情暂停提醒：按原生条件列出心情、异地、冷却与事件，成对去重且不猜恢复时间',()=>{
  const {state:s,view}=developmentScene();s.explorers=[];s.quests=[];
  const a=s.residents[0],b=s.residents[1];a.romance={partnerId:b.id,progress:.5};b.romance={partnerId:a.id,progress:.5};
  a.roomId=b.roomId=5;a.happiness=49;
  let ops=operations(model(view));assert.equal(ops.counts.romancePaused,1);
  assert.equal(ops.messages.filter(m=>m.includes('感情暂停')).length,1);assert.match(ops.messages.join('\n'),/心情.*50/);
  assert.ok(ops.events.includes(300000));
  a.happiness=50;assert.equal(operations(model(view)).counts.romancePaused,0);
  b.roomId=4;assert.match(operations(model(view)).messages.join('\n'),/同一间宿舍/);
  b.roomId=5;b.familyCooldownUntil=now+60000;s.rooms.find(r=>r.id===5).incident={kind:'fire'};
  ops=operations(model(view));assert.match(ops.messages.join('\n'),/冷却/);assert.match(ops.messages.join('\n'),/宿舍.*事件/);
});
test('运行提醒：施工、下挖、返程、任务关卡使用明确时间预约，过期时间不造成紧密循环',()=>{
  const {state:s,view}=developmentScene();s.rooms[3].upgradeAt=now+120000;s.digging={doneAt:now+180000};
  s.explorers=[{residentId:1,returnAt:now+240000}];s.quests=[{status:'active',nextStageAt:now+90000,returnAt:null}];
  const ops=operations(model(view));for(const delta of [120000,180000,240000,90000])assert.ok(ops.events.includes(delta));
  s.rooms[3].upgradeAt=now-1;s.digging.doneAt=now-1;s.explorers[0].returnAt=now-1;s.quests[0].nextStageAt=now-1;
  assert.ok(operations(model(view)).events.every(n=>n>0));
});
test('运行提醒：已倒下和低血量探险不能误报可领取，未提供废土资料明确标记',()=>{
  const {state:s,view}=developmentScene();s.explorers=[{residentId:1,returnAt:now-1},{residentId:2,returnAt:now+10000,stimpaks:0}];s.quests=[];
  s.residents[0].deadAt=now-1;s.residents[1].hp=20;
  const ops=operations(model(view));assert.equal(ops.counts.down,1);assert.equal(ops.counts.awayHurt,1);assert.equal(ops.counts.returned,0);
  assert.match(ops.messages.join('\n'),/不会自动花废料救回/);delete s.explorers;assert.match(operations(model(view)).messages.join('\n'),/废土资料不完整/);
});
function explorerScene(){
  const x=scene();x.state.residents[0].away={kind:'explore'};
  x.state.explorers=[{id:11,residentId:1,startedAt:now-3600000,returnAt:now-1,tier:6,abyss:true,stimpaks:2,
    loot:{scrap:50.1,parts:3,stimpak:1,items:[{id:44}]}}];return x;
}
test('探险归来模型：预留背包及携带治疗针的容量上界，按原生区域标题定位',()=>{
  const {view}=explorerScene(),c=explorers(model(view)).ready[0];
  assert.equal(c.id,11);assert.equal(c.residentId,1);assert.equal(c.reward.scrap,51);assert.equal(c.reward.stimpak,3);assert.equal(c.items,1);
  assert.equal(c.title,'甲 · 深渊 深渊裂谷 第 2 段');
});
test('探险归来模型：未到家、倒下、重复编号和未知背包字段不自动领取',()=>{
  const {state:s,view}=explorerScene();s.explorers[0].returnAt=now+1;assert.equal(explorers(model(view)).ready.length,0);
  s.explorers[0].returnAt=now-1;s.residents[0].deadAt=now-1;assert.equal(explorers(model(view)).ready.length,0);
  s.residents[0].deadAt=null;s.explorers[0].loot.futureResource=1;assert.equal(explorers(model(view)).ready.length,0);
  delete s.explorers[0].loot.futureResource;s.explorers.push({...s.explorers[0]});assert.equal(explorers(model(view)).ready.length,0);
});
test('探险归来模型：缺失附加资料或规范化后重名，只限制探险领取',()=>{
  const {state:s,view}=explorerScene();s.residents[0].name='Ａ';s.residents.push({...s.residents[0],id:2,name:'A'});
  assert.equal(explorers(model(view)).ready.length,0);delete s.explorers;
  assert.equal(explorers(model(view)).ready.length,0);assert.match(explorers(model(view)).notes[0],/资料不完整/);
});
test('探险归来证明：必须原探险消失且对应居民释放，绑定原请求和账号',()=>{
  const {state:s,view}=explorerScene(),p={kind:'explore',targets:[11,1],vaultNo:77,before:{serverTime:now-2000}},
    request={action:{type:'explore_claim',explorerId:11},idempotencyKey:'original-key'},body={view,result:{}};
  assert.equal(exploreProof(p,200,request,body),null);s.explorers=[];assert.equal(released(p,model(view)),false);
  s.residents[0].away=null;assert.equal(released(p,model(view)),true);assert.equal(exploreProof(p,200,request,body).kind,'explore');
  assert.equal(exploreProof(p,200,{...request,action:{type:'revive',residentId:1}},body),null);
  assert.equal(exploreProof(p,200,request,{...body,code:'retry'}),null);
  assert.equal(exploreProof(p,503,request,body),null);view.vaultNo=88;assert.equal(exploreProof(p,200,request,body),null);
});

test('探险确认快照：成功证明不能覆盖仍在列表里的原探险，缺失或损坏列表也等待',()=>{
  const {state:s,view}=explorerScene(),p={kind:'explore',targets:[11,1],vaultNo:77,before:{serverTime:now-2000},
    result:{proof:{kind:'explore',key:'original-key',vaultNo:77,explorerId:11,residentId:1,at:now-1000}}};
  const original=JSON.stringify(p);assert.equal(exploreConfirmed(p,model(view)),false);
  s.residents[0].away=null;assert.equal(exploreConfirmed(p,model(view)),false,'居民释放但旧探险仍在时也不能解除');
  for(const list of [undefined,null,[null],[{}],[{id:0}],[{id:'22'}]]){
    s.explorers=list;assert.equal(exploreConfirmed(p,model(view)),false);
  }
  s.explorers=[];assert.equal(exploreConfirmed(p,model(view)),true);
  assert.equal(JSON.stringify(p),original,'等待读取不能修改原证明或请求');
});

test('探险确认时间：当前快照不早于原请求，重新出发时须有时间与身份匹配的原证明',()=>{
  const {state:s,view}=explorerScene(),p={kind:'explore',targets:[11,1],vaultNo:77,before:{serverTime:now-2000}};
  s.explorers=[];s.residents[0].away=null;assert.equal(exploreConfirmed(p,model(view)),true,'已释放状态可直接核对');
  view.serverTime=now-2001;assert.equal(exploreConfirmed(p,model(view)),false);view.serverTime=now;
  s.explorers=[{id:22,residentId:1}];s.residents[0].away={kind:'explore'};
  assert.equal(exploreConfirmed(p,model(view)),false,'新旅程本身不证明旧领取成功');
  const proof={kind:'explore',key:'original-key',vaultNo:77,explorerId:11,residentId:1,at:now-1000};
  p.result={proof};assert.equal(exploreConfirmed(p,model(view)),true);
  for(const change of [{at:now+1},{at:now-2001},{key:'bad'},{vaultNo:88},{explorerId:22},{residentId:2},{kind:'collect'}]){
    p.result={proof:{...proof,...change}};assert.equal(exploreConfirmed(p,model(view)),false);
  }
  p.result={proof};view.serverTime=now-1000;assert.equal(exploreConfirmed(p,model(view)),true);
  view.serverTime=now-1001;assert.equal(exploreConfirmed(p,model(view)),false);
});

test('避难所等待诊断：区分原列表、缺失列表、请求前快照和凭据前快照，不改原记录',()=>{
  const {state:s,view}=explorerScene(),p={kind:'explore',targets:[11,1],vaultNo:77,before:{serverTime:now-2000},
    result:{proof:{kind:'explore',key:'original-key',vaultNo:77,explorerId:11,residentId:1,at:now-1000}}};
  const original=JSON.stringify(p);
  let wait=pendingWait(p,model(view));assert.equal(wait.data.reason,'explorer-still-listed');
  assert.match(wait.note,/已收到原领取成功凭据.*列表仍含原探险/);assert.equal(wait.data.hasSuccessProof,true);
  assert.equal(wait.data.explorerListed,true);assert.equal(wait.data.proofAt,now-1000);
  for(const list of [undefined,null,[null],[{}],[{id:0}],[{id:'22'}]]){
    s.explorers=list;wait=pendingWait(p,model(view));assert.equal(wait.data.reason,'explorer-list-unavailable');
    assert.equal(wait.data.explorerListReadable,false);assert.equal(wait.data.explorerListed,null);
    assert.match(wait.note,/探险列表暂不可核对/);
  }
  s.explorers=[{id:22,residentId:1}];view.serverTime=now-2001;
  wait=pendingWait(p,model(view));assert.equal(wait.data.reason,'snapshot-before-request');
  assert.match(wait.note,/快照时间早于原操作/);assert.equal(wait.data.requestSnapshotAt,now-2000);
  view.serverTime=now-1001;wait=pendingWait(p,model(view));assert.equal(wait.data.reason,'snapshot-before-proof');
  assert.match(wait.note,/快照时间早于原领取成功凭据/);
  assert.deepEqual(Object.keys(wait.data).sort(),['kind','reason','snapshotAt','requestSnapshotAt','hasSuccessProof','proofAt','explorerListReadable','explorerListed'].sort());
  assert.equal(JSON.stringify(p),original);
});

test('避难所等待诊断：HTTP成功或不匹配的凭据不能报告原领取已成功',()=>{
  const {state:s,view}=explorerScene(),p={kind:'explore',targets:[11,1],vaultNo:77,before:{serverTime:now-2000}},
    proof={kind:'explore',key:'original-key',vaultNo:77,explorerId:11,residentId:1,at:now-1000};
  for(const change of [null,{kind:'collect'},{vaultNo:88},{explorerId:22},{residentId:2},{at:now-2001},{key:'bad'}]){
    p.result={status:200,...(change?{proof:{...proof,...change}}:{})};
    const wait=pendingWait(p,model(view));assert.equal(wait.data.hasSuccessProof,false);
    assert.equal(wait.data.proofAt,null);assert.doesNotMatch(wait.note,/已收到原领取成功凭据/);
    assert.match(wait.note,/原领取结果仍未确认/);
  }
  s.explorers=[{id:22,residentId:1}];const wait=pendingWait(p,model(view));
  assert.equal(wait.data.reason,'result-unconfirmed');assert.equal(wait.data.explorerListed,false);
});

test('避难所等待诊断：其他操作保留通用结果未确认，不误报探险或暴露请求标识',()=>{
  const {view}=scene();
  for(const kind of ['collect','assign','equip','daily','season','achievement','tutorial']){
    const p={kind,targets:[1],vaultNo:77,before:{serverTime:now-2000},result:{status:200}};
    const wait=pendingWait(p,model(view));assert.equal(wait.note,'避难所操作仍未确认');
    assert.equal(wait.data.reason,'result-unconfirmed');assert.equal(wait.data.kind,kind);
    assert.equal(wait.data.hasSuccessProof,undefined);
    assert.doesNotMatch(JSON.stringify(wait.data),/key|vaultNo|targets|status|residents|resources/);
  }
});
