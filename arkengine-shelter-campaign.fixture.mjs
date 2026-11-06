export function campaignView(time=2_000_000_000){
  const room=(id,type,col,floor=1,level=3)=>({id,type,col,floor,width:1,level,builtAt:0,upgradeAt:null,stored:0,incident:null,unpowered:false});
  const residents=Array.from({length:6},(_,i)=>({id:i+1,name:`居民${i+1}`,roomId:i<4?i+1:null,away:null,deadAt:null,adultAt:0,xp:i<3?0:147,happiness:100,
    hp:i<3?100:142,stats:{str:8,per:8,end:8,cha:8,int:8,agi:8,lck:8},parents:[],romance:null,familyCooldownUntil:0,weaponId:null,outfitId:null}));
  return {vaultNo:77,serverTime:time,progress:{level:8},switches:{frozen:false},nameRequired:false,
    drops:{enabled:true,minMinutes:360,tierPermille:[50,70],perUserDaily:2},
    env:{week:'2026-W45',events:[],quests:[{id:'w1',title:'旧地铁站',difficulty:1,stages:3,stageMinutes:60,recommendedLevel:1,rewards:{scrap:30,parts:1,itemTier:null,seasonPoints:20}}]},
    state:{lastSettledAt:time,depth:7,digging:null,resources:{scrap:3000,power:400,food:400,water:400,parts:10,stimpak:9},
      stats:{collected:0},legacy:{perks:{}},items:[],births:[],achievements:[],explorers:[],quests:[],weekly:{completed:[]},
      daily:{day:'2026-10-10',claimed:[]},season:{month:'2026-10',points:0,claimedFree:[]},residents,
      rooms:[room(1,'power',2),room(2,'diner',3),room(3,'water',4),room(4,'scrap',5),{...room(5,'quarters',2,2),width:2},room(6,'storage',6),
        ...Array.from({length:7},(_,i)=>room(10+i,'elevator',1,i+1,1))]}};
}
export function levelGateView(time=2_000_000_000){
  const v=campaignView(time),s=v.state,base=s.rooms[0];
  const room=(id,type,floor,col,width,level=1)=>({...base,id,type,floor,col,width,level});
  s.depth=4;s.rooms=[room(1,'power',1,2,2),room(2,'diner',1,4,2),room(3,'water',1,6,2),
    room(4,'scrap',2,4,3,2),room(5,'quarters',2,2,2),room(6,'quarters',3,2,3),room(7,'medbay',2,7,1),
    {...room(8,'training',3,5,1,2),trainStat:'agi'},...Array.from({length:4},(_,i)=>room(20+i,'elevator',i+1,1,1))];
  const p=s.residents[4];s.residents=Array.from({length:15},(_,i)=>({...structuredClone(p),id:i+1,name:'居民'+(i+1),
    roomId:[1,1,2,2,2,3,3,3,4,4,8,8,5,5,null][i],stats:{...p.stats}}));
  s.resources={scrap:722,parts:19,power:500,food:500,water:500,stimpak:7};
  v.progress={level:4,score:62,next:66};return v;
}
export function upperStageView(time=2_000_000_000){
  const v=levelGateView(time),s=v.state;
  s.depth=7;s.rooms.filter(r=>['power','diner','water'].includes(r.type)).forEach(r=>r.level=2);
  s.rooms.find(r=>r.type==='scrap').level=3;s.rooms.find(r=>r.id===6).level=3;s.rooms.find(r=>r.type==='medbay').level=2;
  s.rooms.push({...s.rooms[0],id:90,type:'storage',floor:4,col:2,width:3,level:3});
  for(let floor=5;floor<=7;floor++)s.rooms.push({...s.rooms[0],id:100+floor,type:'elevator',floor,col:1,width:1,level:1});
  s.residents.at(-1).roomId=7;s.resources={scrap:1200,parts:0,power:500,food:500,water:500,stimpak:7};
  v.progress={level:6,score:96,next:111};return v;
}
export function materialCycleView(time=2_000_000_000){
  const v=upperStageView(time),s=v.state;
  for(const id of [3,6])s.residents.find(p=>p.id===id).roomId=4;
  s.rooms.push({...s.rooms[0],id:108,type:'workshop',floor:3,col:6,width:1,level:1,stored:2.6429});
  s.resources={scrap:1629.1426,parts:0,power:691,food:705,water:705,stimpak:16};
  v.progress={level:6,score:97,next:111};return v;
}
export function workshopChurnView(time=2_000_000_000){
  // 等价现场：5级67分、17/20人口、28零件、工坊自动值班、训练结束两人闲置。
  // 日志缺少完整居民属性；此处只复现调度边界，不是完整实号回放。
  const v=levelGateView(time),s=v.state;
  s.rooms=s.rooms.filter(r=>r.type!=='medbay');
  s.rooms.find(r=>r.id===1).level=2;
  Object.assign(s.rooms.find(r=>r.type==='training'),{level:1,floor:2,col:7});
  s.rooms.push({...s.rooms[0],id:50,type:'workshop',floor:3,col:5,width:1,level:1,stored:.2112});
  const posts=[1,1,2,2,2,2,3,3,3,4,4,4,4,4,50,null,null],base=s.residents[0];
  s.residents=posts.map((roomId,i)=>({...structuredClone(base),id:i<14?i+1:[21,35,36][i-14],
    name:i===14?'杨初一':'居民'+(i+1),roomId,xp:0,hp:100,happiness:75,
    stats:{str:5,per:5,end:5,cha:5,int:5,agi:5,lck:5}}));
  s.rooms.find(r=>r.id===3).stored=55.9243;s.rooms.find(r=>r.id===4).stored=162.453;
  s.resources={scrap:1784.7327,parts:28,power:513.1667,food:416.75,water:303.75,stimpak:9};
  v.progress={level:5,score:67,next:87};return v;
}
export function populationGrowthView(time=2_000_000_000){
  // Fifteen residents: water covers their 20% margin, but not a sixteenth adult mouth. Its two slots are full.
  const v=upperStageView(time),s=v.state;
  Object.assign(s.rooms.find(r=>r.id===3),{width:1,level:1});
  for(const p of s.residents){p.stats.per=0;if(p.roomId===3)p.roomId=4;}
  for(const id of [6,7]){
    const p=s.residents.find(p=>p.id===id);Object.assign(p,{roomId:3,happiness:75,xp:0,hp:100});p.stats.per=8;
  }
  s.resources={scrap:3000,parts:60,power:500,food:500,water:500,stimpak:7};
  v.progress.score=2*s.residents.length+3*s.depth+s.rooms.filter(r=>!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
  return v;
}
export function storageChoiceView(time=2_000_000_000){
  // 独立7级快照：装备近满，已有一格仓库可升级；不代表连续发展或实号状态。
  const v=upperStageView(time),s=v.state,base=s.rooms[0];
  s.rooms.filter(r=>['power','diner','water','medbay'].includes(r.type)).forEach(r=>r.level=3);
  s.rooms.push({...base,id:108,type:'workshop',floor:7,col:2,width:1,level:1});
  for(const [id,floor,col,width] of [[201,3,6,2],[202,4,5,1],[203,5,2,3],[204,6,2,2]])
    s.rooms.push({...base,id,type:'storage',floor,col,width,level:1});
  const posts=[1,1,4,6,2,6,6,3,6,6,8,8,5,5,7];s.residents.forEach((p,i)=>p.roomId=posts[i]);
  const worker=s.residents[2];Object.assign(worker,{xp:0,happiness:0,hp:100});worker.stats.end=0;
  s.resources={scrap:200,parts:0,power:4600,food:2300,water:2700,stimpak:60};
  s.items=Array.from({length:171},(_,i)=>({id:1000+i,slot:'weapon',damage:[0,0]}));
  v.progress={level:7,score:112,next:141};return v;
}
export function familyGrowthView(time=2_000_000_000){
  // 原家庭6/7在水站；当前够用，但其余居民的感知不足以在现有两岗接替。
  const v=populationGrowthView(time),s=v.state;
  for(const p of s.residents){p.familyCooldownUntil=time-1;if(p.roomId===5)p.roomId=4;}
  for(const id of [6,7])s.residents.find(p=>p.id===id).stats.per=17;
  s.residents.find(p=>p.id===15).parents=[6,7];s.residents.find(p=>p.id===3).roomId=4;
  return v;
}
export function dormWorkshopCycleView(time=2_000_000_000){
  // 17→30连续模拟在26人出现的工坊往返状态，非实号快照。
  const v=workshopChurnView(time),s=v.state,base=s.rooms[0],person=s.residents[0];
  s.rooms=s.rooms.filter(r=>r.type==='elevator');
  for(const [id,type,floor,col,width,level,stored] of [
    [1,'power',1,2,2,2,58.5],[2,'diner',1,4,2,2,40.2],[3,'water',1,6,2,2,42.5243],[4,'scrap',2,4,3,2,81.453],
    [5,'quarters',2,2,2,1,0],[6,'quarters',3,2,3,1,0],[8,'training',2,7,1,1,0],[50,'workshop',3,5,1,1,.2112],
    [1000,'quarters',3,6,1,1,0],[1001,'scrap',3,7,1,3,47.76],[1002,'scrap',4,2,1,2,40.8],
    [1003,'scrap',4,3,1,1,1.2],[1004,'quarters',4,4,1,1,0],[1005,'scrap',4,5,1,2,3]])
    s.rooms.push({...base,id,type,floor,col,width,level,stored});
  const posts=[[1,50],[2,2],[3,1003],[4,2],[5,2],[6,1],[7,3],[8,3],[9,3],[10,1001],[11,1],[12,4],[13,4],[14,4],
    [21,1002],[35,4],[36,4],[37,4],[38,1002],[39,1001],[40,1005],[41,1005],[42,1000],[43,1004],[44,5],[45,6]];
  const parents={35:[13,14],37:[13,14],38:[1,3],39:[2,10],40:[13,14],41:[1,3],42:[2,10],43:[12,21],44:[13,14],45:[1,3]};
  s.residents=posts.map(([id,roomId])=>({...structuredClone(person),id,name:'居民'+id,roomId,parents:parents[id]||[],
    familyCooldownUntil:[1,2,3,10,12,13,14,21].includes(id)?time-600000:0}));
  s.resources={scrap:1310.7327,parts:13,power:813.1667,food:625.0833,water:562.0833,stimpak:9};
  v.progress={level:6,score:99,next:111};return v;
}
export function familyWorkshopCycleView(time=2_000_000_000){
  // 低遗传连续模拟的28人状态：工坊抽人留下回收空岗，但并未改善原家庭的口粮接替。
  const v=dormWorkshopCycleView(time),s=v.state,base=s.residents[0];
  s.rooms.find(r=>r.id===1).level=3;
  s.rooms.push({...s.rooms.find(r=>r.id===1004),id:1006,col:6});
  const posts=[[1,3],[2,1002],[3,2],[4,1003],[5,2],[6,1002],[7,3],[8,2],[9,1005],[10,1003],
    [11,1001],[12,1001],[13,3],[14,2],[21,4],[35,4],[36,4],[37,null],[38,3],[39,1],[40,1],
    [41,1005],[42,4],[43,null],[44,4],[45,4],[46,1000],[47,1004]];
  const parents={35:[13,14],37:[13,14],38:[1,3],39:[2,10],40:[13,14],41:[1,3],42:[2,10],
    43:[4,11],44:[13,14],45:[1,3],46:[2,10],47:[4,11]};
  s.residents=posts.map(([id,roomId])=>({...structuredClone(base),id,name:'居民'+id,roomId,parents:parents[id]||[],
    stats:Object.fromEntries(Object.keys(base.stats).map(k=>[k,id>=37?4:5])),
    familyCooldownUntil:[1,2,3,4,10,11,13,14].includes(id)?time-600000:0}));
  const stored={1:65.304,2:6.48,3:28.3643,4:82.713,50:.0312,1001:37.68,1002:18.66,1003:26.04,1005:32.76};
  for(const r of s.rooms)r.stored=stored[r.id]||0;
  s.resources={scrap:5318.8127,parts:1,power:826.6667,food:1257.9167,water:1119.9167,stimpak:9};
  v.progress={level:6,score:106,next:111};return v;
}
export function workshopFamilyReturnView(time=2_000_000_000){
  // 双人工坊低遗传模拟在原家庭返宿舍后的28人状态，非实号回放。
  const v=familyWorkshopCycleView(time),s=v.state;
  s.rooms.find(r=>r.id===2).level=3;s.rooms.find(r=>r.id===1003).level=2;
  s.rooms.push({...s.rooms.find(r=>r.id===1003),id:1007,col:7,stored:3.6});
  const posts={1:3,2:3,3:2,4:50,5:2,6:null,7:3,8:2,9:4,10:1001,11:1002,12:1001,13:5,14:5,21:3,35:2,36:4,
    37:1003,38:1,39:1,40:1005,41:1005,42:4,43:1002,44:1003,45:4,46:4,47:4};
  for(const p of s.residents){p.roomId=posts[p.id];if([13,14].includes(p.id))p.romance={partnerId:p.id===13?14:13,progress:0};}
  const stored={1:65.916,2:121.08,3:219.4643,4:50.853,50:1.9512,1001:2.652,1002:13.98,1003:6.48,1005:9.54,1007:3.6};
  for(const r of s.rooms)r.stored=stored[r.id]||0;
  s.resources={scrap:6013.2927,parts:4,power:1173.75003,food:1147.4167,water:1234.4167,stimpak:9};
  v.progress={level:7,score:111,next:141};return v;
}
export function handyMaterialView(time=2_000_000_000){
  // 真实容量公式为3600废料；两格医务室升3也需3600，回收站存180但库存只空100。
  const v=upperStageView(time),s=v.state;
  s.rooms.filter(r=>['power','diner','water'].includes(r.type)).forEach(r=>r.level=3);
  Object.assign(s.rooms.find(r=>r.id===4),{width:1,level:2,stored:180});
  Object.assign(s.rooms.find(r=>r.id===7),{col:5,width:2});
  Object.assign(s.rooms.find(r=>r.id===90),{width:1,level:1});
  // 原回收人员已调到宿舍；仅收取留下的存量，不额外假设新产出或触发持续产能扩仓需求。
  s.residents.filter(p=>p.roomId===4).forEach(p=>p.roomId=6);
  s.resources={scrap:3500,parts:30,power:500,food:500,water:500,stimpak:7};
  s.handies=[{id:1,floor:2}];v.progress={level:6,score:89,next:111};return v;
}
export function capacityRouteView(time=2_000_000_000){
  const v=handyMaterialView(time),s=v.state;
  s.handies=[];s.residents.find(p=>p.id===9).roomId=4;
  const quarters=s.rooms.find(r=>r.id===6);
  for(const [id,floor] of [[201,5],[202,6]])s.rooms.push({...quarters,id,floor,col:2});
  s.rooms.find(r=>r.id===8).level=3;v.progress={level:6,score:108,next:111};return v;
}
export function powerPrerequisiteView(time=2_000_000_000){
  // 连续探索在8级148分遇到的供电边界，作为独立回归快照；不是实号或新的初始资源补给。
  const v=upperStageView(time),s=v.state,base=s.rooms[0];
  s.rooms.filter(r=>['power','diner','water','medbay'].includes(r.type)).forEach(r=>r.level=3);
  s.rooms.push({...base,id:1000,type:'workshop',floor:3,col:6,width:1,level:1});
  for(const [id,floor,col,width] of [[1001,3,7,1],[1002,4,5,3],[1005,5,2,3],[1008,5,5,3],
    [1011,6,2,3],[1014,6,5,3],[1017,7,2,3],[1020,7,5,3]])
    s.rooms.push({...base,id,type:'storage',floor,col,width,level:2});
  const posts=[1,1,4,4,2,4,4,3,4,4,8,8,5,5,7];s.residents.forEach((p,i)=>p.roomId=posts[i]);
  s.resources={scrap:68700,parts:15,power:20500,food:10200,water:10600,stimpak:270};
  v.progress={level:8,score:148,next:174};return v;
}
export function digPowerPrerequisiteView(time=2_000_000_000){
  const v=powerPrerequisiteView(time),s=v.state;
  s.rooms.filter(r=>r.type==='storage').forEach(r=>r.level=3);
  const p=s.residents.find(p=>p.id===3);p.roomId=1;p.stats.str=0;p.stats.end=0;p.hp=114;p.happiness=96;
  s.resources.scrap=88000;v.progress={level:8,score:170,next:174};return v;
}
export function fullPowerPrerequisiteView(time=2_000_000_000){
  // 30人口连续模拟的9级停滞边界：四个发电岗满员满级，无闲置成人；下一工程仍缺电。
  const v=workshopChurnView(time),s=v.state,base=s.rooms[0],person=s.residents[0];
  const rows=[[1,'power',1,2,2,3],[2,'diner',1,4,2,3],[3,'water',1,6,2,3],
    [4,'scrap',2,4,3,3],[5,'quarters',2,2,2,1],[6,'quarters',3,2,3,1],[8,'training',2,7,1,1],
    [50,'workshop',3,5,1,1],[1000,'quarters',3,6,1,1],[1001,'scrap',3,7,1,3],
    [1002,'scrap',4,2,1,3],[1003,'scrap',4,3,1,3],[1004,'quarters',4,4,1,1],
    [1005,'scrap',4,5,1,3],[1006,'quarters',4,6,1,1],[1007,'scrap',4,7,1,3],
    [1009,'storage',5,2,1,3],[1010,'scrap',5,3,2,3],[1012,'storage',5,5,3,3],
    [1016,'storage',6,2,3,3],[1019,'storage',6,5,3,3],[1023,'storage',7,2,3,3],
    [1026,'storage',7,5,3,3],[1030,'storage',8,2,3,1],[1033,'storage',8,5,3,1]];
  s.rooms=rows.map(([id,type,floor,col,width,level])=>({...base,id,type,floor,col,width,level,stored:0,
    ...(type==='training'?{trainStat:'agi'}:{})}));
  for(let floor=1;floor<=8;floor++)s.rooms.push({...base,id:2000+floor,type:'elevator',floor,col:1,width:1,level:1,stored:0});
  const ids=[1,2,3,4,5,6,7,8,9,10,11,12,13,14,21,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49];
  const posts=[1,1,4,4,2,1,1010,3,3,1002,1,1007,3,2,1007,4,1010,4,1002,1001,1005,1005,2,1001,4,4,1003,1003,1010,1010];
  s.residents=ids.map((id,i)=>({...structuredClone(person),id,name:`居民${id}`,roomId:posts[i]}));
  s.depth=8;s.resources={scrap:78857,parts:1,power:23197,food:22921,water:23173,stimpak:9};
  v.progress={level:9,score:196,next:213};return v;
}
export function workshopUpgradeView(time=2_000_000_000){
  // 7级30人、双人工坊1.08零件/h，当前回收升级缺17零件；固定场景用于扩产等待比较。
  const v=fullPowerPrerequisiteView(time),s=v.state;
  s.rooms=s.rooms.filter(r=>r.floor<=5&&![1012].includes(r.id));s.depth=5;
  for(const id of [2,3,4,1010])s.rooms.find(r=>r.id===id).level=2;
  s.rooms.find(r=>r.id===1009).level=1;
  const posts=[1,1002,1010,2,2,1,3,3,3,50,1,1007,3,2,1007,50,4,4,1002,1001,1005,1005,2,1001,4,4,1003,1003,1010,1010];
  s.residents.forEach((p,i)=>p.roomId=posts[i]);
  s.rooms.find(r=>r.id===50).stored=1.1112;
  s.resources={scrap:11172,parts:13,power:1862,food:1601,water:1688,stimpak:9};
  v.progress={level:7,score:125,next:141};return v;
}
export function multiWorkshopView(time=2_000_000_000){
  // Existing full level-2 workshop plus a completed empty workshop, with a real 30-part project shortage.
  const v=workshopUpgradeView(time),s=v.state,workshop=s.rooms.find(r=>r.id===50);
  workshop.level=2;s.resources.parts=0;v.progress.score++;
  s.rooms.push({...workshop,id:3000,floor:5,col:5,width:1,level:1,stored:0});v.progress.score++;
  return v;
}
export function workshopBuildView(time=2_000_000_000){
  const v=multiWorkshopView(time);
  v.state.rooms=v.state.rooms.filter(r=>r.id!==3000);v.progress.score--;
  return v;
}
export function workshopBudgetCycleView(time=2_000_000_000){
  const v=workshopBuildView(time),s=v.state,w=s.rooms.find(r=>r.id===50);
  w.level=1;w.stored=.21;
  for(const id of [2,1010])s.rooms.find(r=>r.id===id).level=3;
  s.rooms.push({...w,id:1012,floor:5,col:5,width:3,stored:.24});
  const posts=[1,1012,1012,4,2,1,3,3,3,1012,1,1002,3,2,50,50,1012,1012,1012,1001,1005,1005,2,1001,1010,1002,1003,1003,1010,1010];
  s.residents.forEach((p,i)=>p.roomId=posts[i]);s.resources.parts=37;
  v.progress.score=132;return v;
}
export function workshopPowerCycleView(time=2_000_000_000){
  const v=workshopUpgradeView(time),s=v.state;
  s.rooms=s.rooms.filter(r=>![1009,1010].includes(r.id));
  s.rooms.find(r=>r.id===2).upgradeAt=time+13/6*3600000;
  Object.assign(s.rooms.find(r=>r.id===50),{level:2,stored:1.4712});
  s.residents.find(p=>p.id===3).roomId=50;s.residents.find(p=>p.id===10).roomId=null;
  s.residents.find(p=>p.id===35).roomId=4;
  for(const [id,roomId,parents] of [[48,6,[1,3]],[49,1000,[2,10]]])Object.assign(s.residents.find(p=>p.id===id),{roomId,parents});
  s.resources={scrap:8207.1727,parts:5.5,power:1451.8334,food:1231.5833,water:1318.5833,stimpak:9};
  v.progress={level:7,score:121,next:141};return v;
}
export function materialProducerCycleView(time=2_000_000_000){
  const v=fullPowerPrerequisiteView(time),s=v.state,base=s.rooms[0];
  s.rooms=s.rooms.filter(r=>r.floor<=4);s.depth=6;
  for(const [id,type,floor,col,width,level] of [[1008,'elevator',5,1,1,1],[1009,'storage',5,2,3,2],
    [1012,'storage',5,5,1,2],[1013,'scrap',5,6,2,3],[1015,'elevator',6,1,1,1],
    [1016,'scrap',6,2,1,2],[1017,'storage',6,3,1,1]])s.rooms.push({...base,id,type,floor,col,width,level,stored:0});
  Object.assign(s.rooms.find(r=>r.id===50),{level:2,stored:4.3962});
  const posts=[1,1002,null,1013,2,1,1013,3,3,1013,1,1007,3,2,1007,4,4,4,1002,1001,1005,1005,2,1001,4,4,1003,1003,4,1013];
  s.residents.forEach((p,i)=>p.roomId=posts[i]);
  s.resources={scrap:22883.6227,parts:13,power:3597.9167,food:2941.5833,water:2458.5833,stimpak:9};
  v.progress={level:8,score:148,next:174};return v;
}
