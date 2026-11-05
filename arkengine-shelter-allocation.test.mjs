import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const table=source.match(/const shelterRooms = [\s\S]*?;/)[0];
const modelCode=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const allocationCode=source.slice(source.indexOf('  function shelterSwapSequences('),source.indexOf('  function shelterSwapStep('));
const {model,find,project,sequence}=vm.runInNewContext(`${table}\n${modelCode}\n${allocationCode}
  ({model:shelterModel,find:shelterFindAllocation,project:shelterSwapProjection,sequence:shelterAllocationMoves})`,{
  staffRoomTypes:['power','diner','water','scrap'],
  shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
const now=2000000000,keys=['power','food','water'],types=['power','diner','water','scrap'];
const rules={power:['str',12],diner:['agi',8],water:['per',8],scrap:['end',8]};
const resident=(id,roomId=null,stats={})=>({id,name:`居民${id}`,roomId,away:null,deadAt:null,adultAt:0,xp:0,happiness:100,
  outfitId:null,stats:{str:3,per:3,end:3,cha:3,int:3,agi:3,lck:3,...stats}});
function scene(people=[]) {
  const rooms=types.map((type,i)=>({id:i+1,type,width:1,level:1,floor:1,stored:0,builtAt:0,upgradeAt:null,unpowered:false,incident:null}));
  const state={lastSettledAt:now,rooms,residents:people,items:[],handies:[],births:[],achievements:[],
    resources:{scrap:100,power:100,food:100,water:100,parts:0,stimpak:0},stats:{collected:0},
    daily:{day:'2026-11-04',claimed:[]},season:{month:'2026-11',claimedFree:[],points:0}};
  return {vaultNo:77,serverTime:now,progress:{level:8},switches:{frozen:false},state};
}
// Independent, direct enumeration: no optimizer helpers, pruning, candidate ranking or cached projections.
function output(view,positions) {
  const production={power:0,food:0,water:0,scrap:0};
  for(const r of view.state.rooms){
    if(!rules[r.type]||r.builtAt>now||r.upgradeAt!==null||r.incident||r.unpowered)continue;
    const [stat,base]=rules[r.type],resource=r.type==='diner'?'food':r.type;
    for(const p of view.state.residents.filter(p=>(positions.get(p.id)??p.roomId)===r.id&&p.away===null&&p.deadAt===null&&p.adultAt<=now).slice(0,r.width*2)){
      const bonus=view.state.items.find(item=>item.id===p.outfitId)?.bonus?.[stat]||0;
      const event=Math.min(150,Math.max(100,...(view.env?.events||[]).filter(e=>e.kind==='production'&&e.startsAt<=now&&now<e.endsAt).map(e=>e.percent)));
      production[resource]+=base*[0,1,1.5,2.1][r.level]*(.5+Math.min(17,p.stats[stat]+bonus)/10)*
        (.6+.4*Math.min(100,p.happiness)/100)*(1+.01*(Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))-1))*
        (1+.03*(view.state.legacy?.perks?.production||0))*event/100;
    }
  }
  return production;
}
const score=(p,d)=>[keys.reduce((n,k)=>n+Math.max(0,d[k]*1.2-p[k])/Math.max(1,d[k]*1.2),0),-p.scrap,-keys.reduce((n,k)=>n+p[k],0)];
const better=(a,b)=>{for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-6)return a[i]<b[i];return false;};
function exhaustive(view,pool,demand) {
  const current=output(view,new Map()),positions=new Map(),floors=keys.map(k=>Math.min(current[k],demand[k]*1.2));
  let best=current;const original=score(current,demand);
  function visit(i){
    if(i===pool.length){
      const production=output(view,positions);
      const value=score(production,demand);
      // The shipped policy requires >1/hour gain unless a supply deficit improves.
      const worthwhile=original[0]-value[0]>1e-6||Math.abs(original[0]-value[0])<=1e-6&&
        (original[1]-value[1]>1||Math.abs(original[1]-value[1])<1e-6&&original[2]-value[2]>1);
      if(worthwhile&&keys.every((k,j)=>production[k]>=floors[j]-1e-9)&&better(value,score(best,demand)))best=production;
      return;
    }
    for(const room of [null,...view.state.rooms.filter(r=>rules[r.type]&&!r.incident&&!r.unpowered&&r.upgradeAt===null&&r.builtAt<=now).map(r=>r.id)]){
      // Undefined means unchanged; null is an explicit rest assignment.
      positions.set(pool[i].id,room===null?-1:room);
      const r=view.state.rooms.find(r=>r.id===room);
      if(r&&view.state.residents.filter(p=>p.id!==pool[i].id&&!pool.slice(i+1).some(q=>q.id===p.id)&&
        p.deadAt===null&&p.adultAt<=now&&(positions.has(p.id)?positions.get(p.id):p.roomId)===room).length>=r.width*2)continue;
      visit(i+1);
    }
    positions.delete(pool[i].id);
  }
  visit(0);return best;
}
function apply(view,moves){const copy=structuredClone(view);for(const move of moves)copy.state.residents.find(p=>p.id===move.id).roomId=move.room;return copy;}
function close(a,b,message='production'){for(const k of Object.keys(b))assert.ok(Math.abs(a[k]-b[k])<1e-7,`${message} ${k}: ${a[k]} vs ${b[k]}`);}

test('整体分配独立对照：12组小阵容穷举所有岗位，包含服装上限、等级、幸福度与活动倍率',()=>{
  let seed=4181;const random=()=>((seed=(seed*1664525+1013904223)>>>0)%18);
  for(let trial=0;trial<12;trial++){
    const pool=Array.from({length:5},(_,i)=>({...resident(i+1,i<3?i+1:4,{str:random(),agi:random(),per:random(),end:random()}),xp:trial*3,happiness:60+random()*2}));
    const anchors=[resident(101,1,{str:17}),resident(102,2,{agi:17}),resident(103,3,{per:17})];
    const view=scene([...pool,...anchors]);
    view.state.items=[{id:1,slot:'outfit',bonus:{end:9,str:3}}];pool[0].outfitId=1;
    view.state.rooms[trial%4].level=2;view.state.legacy={perks:{production:2}};
    view.env={events:[{kind:'production',startsAt:now-1,endsAt:now+1,percent:125}]};
    const m=model(view),before=JSON.stringify(view),expected=exhaustive(view,pool,m.demand),result=find(m,pool);
    assert.equal(result.complete,true);assert.ok(result.plan,`trial ${trial}: ${result.reason}`);
    const final=output(apply(view,result.plan.moves),new Map());
    close(final,expected,`trial ${trial}`);close(result.plan.production,final,'reported');
    assert.ok(project(m,result.plan.moves,false,true));assert.equal(JSON.stringify(view),before);
    assert.equal(find(model(apply(view,result.plan.moves)),apply(view,result.plan.moves).state.residents.slice(0,5)).plan,null,'stable next round');
  }
});

test('整体分配占位：外出成人占名额，固定人员和特殊岗位不会作为可调动人员',()=>{
  const pool=[resident(1,null,{end:17})],view=scene([...pool,resident(2,4),{...resident(3,4),away:{kind:'explore'}},resident(4,1,{str:17}),resident(5,2,{agi:17}),resident(6,3,{per:17})]);
  view.state.rooms.push({...view.state.rooms[0],id:5,type:'medbay'});view.state.residents.push(resident(7,5,{int:17}));
  const m=model(view),result=find(m,pool);assert.ok(result.plan);
  assert.ok(result.plan.targets.every(t=>t.id===1&&t.room!==4&&t.room!==5));
  close(output(apply(view,result.plan.moves),new Map()),exhaustive(view,pool,m.demand));
});

test('换岗产量模拟：容量外居民接替生产，按每一步真实在岗者重算且不修改模型',()=>{
  const view=scene([resident(1,1,{str:0}),resident(2,1,{str:0}),resident(3,1,{str:17})]);
  const m=model(view);m.demand={power:5,food:0,water:0};const before=JSON.stringify(m);
  const result=project(m,[{id:1,room:null}],false,true);
  assert.equal(result.power,32.4);assert.equal(JSON.stringify(m),before);
  const strict=project(m,[{id:1,room:null}],false,false);assert.equal(strict.power,32.4);
});

test('整体分配执行顺序：最终能增产但每条起步都会扩大缺口时保留原岗位',()=>{
  const pool=[resident(1,1,{str:0,agi:17}),resident(2,2,{str:17,agi:0})],m=model(scene(pool));
  m.demand={power:6,food:4,water:0};
  const result=find(m,pool);assert.equal(result.plan,null);assert.equal(result.reason,'no-safe-sequence');
  assert.equal(sequence(m,[{id:1,room:2},{id:2,room:1}]),null);
});

test('整体分配已有缺口：允许不降低当前供应的增产步骤，不能一步改善另一步再退回缺口',()=>{
  const view=scene([resident(1,1,{str:0}),resident(2,null,{str:17})]),m=model(view);m.demand={power:20,food:0,water:0};
  const result=find(m,view.state.residents);assert.ok(result.plan);assert.ok(result.plan.production.power>m.production.power);
  assert.ok(project(m,[{id:2,room:1}],false,true));
  assert.equal(project(m,[{id:2,room:1},{id:2,room:null}],false,true),null);
});

test('整体分配未来口粮：未来供应已足时不能借当前较低消耗降低中途供应底线',()=>{
  const pool=[resident(1,1,{str:0,agi:17}),resident(2,2,{str:17,agi:0})];
  const m=model(scene([...pool,resident(3,1,{str:0}),resident(4,2,{agi:0})]));
  m.demand={power:10,food:6,water:0};m.currentDemand={power:5,food:3,water:0};
  assert.equal(sequence(m,[{id:1,room:2},{id:2,room:1}]),null);
  assert.equal(find(m,pool).plan,null);
});

test('整体分配计算上限：提前停止明确标记未穷尽，超过16名可调动人员退回局部策略',()=>{
  const pool=Array.from({length:8},(_,i)=>resident(i+1,Math.floor(i/2)+1)),m=model(scene(pool));
  const limited=find(m,pool,1);assert.equal(limited.complete,false);assert.equal(limited.nodes,1);assert.equal(limited.plan,null);
  const large=Array.from({length:17},(_,i)=>resident(i+1));
  const skipped=find(model(scene(large)),large);assert.equal(skipped.reason,'large-roster');assert.equal(skipped.nodes,0);
});

test('整体分配14人：有界搜索返回的方案确实改善产量，执行投影与最终实际岗位一致',t=>{
  const pool=Array.from({length:14},(_,i)=>resident(i+1,Math.floor(i/4)+1,{str:(i*7)%18,agi:(i*11)%18,per:(i*13)%18,end:(i*5)%18}));
  const view=scene(pool);view.state.rooms.forEach(r=>r.width=2);
  const m=model(view),started=performance.now(),result=find(m,pool),elapsed=performance.now()-started;
  assert.ok(result.plan);assert.ok(result.nodes<=50000);
  const final=output(apply(view,result.plan.moves),new Map()),projection=project(m,result.plan.moves,false,true);
  assert.ok(projection);close(projection,final);close(result.plan.production,final);
  assert.ok(better(score(final,m.demand),score(m.production,m.demand)));
  t.diagnostic(`14人搜索 ${result.nodes} 节点，耗时 ${elapsed.toFixed(1)} ms，执行 ${result.plan.moves.length} 步；穷尽=${result.complete}`);
});

test('整体分配可执行候选：餐厅不能腾位时继续寻找其他房间的安全三人轮换',()=>{
  const pool=[resident(1,1,{str:5,per:17,end:0,agi:0}),resident(2,3,{str:0,per:10,end:17,agi:0}),
    resident(3,4,{str:10,per:0,end:10,agi:0}),resident(4,2,{str:17,per:17,end:17,agi:5}),resident(5,2,{str:17,per:17,end:17,agi:5})];
  const view=scene([...pool,resident(6,1,{str:10}),resident(7,3,{per:10}),resident(8,4,{end:17})]);
  for(let id=5;id<=7;id++)view.state.rooms.push({...view.state.rooms[0],id});
  const m=model(view);
  assert.ok(project(m,[{id:1,room:null},{id:3,room:1},{id:2,room:4},{id:1,room:3}],false,true),'已知存在不改动餐厅的安全循环');
  const result=find(m,pool);assert.ok(result.plan,`不应让无法腾位的高收益候选遮住安全方案：${result.reason}`);
  assert.ok(result.plan.targets.every(t=>![4,5].includes(t.id)));
  assert.ok(project(m,result.plan.moves,false,true));
  assert.ok(result.plan.production.scrap>m.production.scrap+1);
});

test('整体分配留守条件：有同类空房可先补产时不把当前无法离岗者永久固定',()=>{
  const pool=[resident(1,1,{str:5,per:17,end:0,agi:0}),resident(2,3,{str:0,per:10,end:17,agi:0}),
    resident(3,4,{str:10,per:0,end:10,agi:0}),resident(4,2,{str:17,per:17,end:17,agi:5}),resident(5,2,{str:17,per:17,end:17,agi:5})];
  const view=scene([...pool,resident(6,1,{str:10}),resident(7,3,{per:10}),resident(8,4,{end:17})]);
  view.state.rooms.push({...view.state.rooms[0],id:5},{...view.state.rooms[1],id:6});
  const m=model(view),result=find(m,pool);
  assert.ok(project(m,[{id:1,room:6},{id:4,room:5}],false,true));
  assert.ok(result.plan);assert.ok(result.plan.targets.some(t=>[4,5].includes(t.id)&&t.room!==2));
  assert.ok(project(m,result.plan.moves,false,true));
  close(output(apply(view,result.plan.moves),new Map()),exhaustive(view,pool,m.demand));
});
