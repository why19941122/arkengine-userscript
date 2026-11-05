import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const table=source.match(/const shelterRooms = [\s\S]*?;/)[0];
const modelCode=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const gearCode=source.slice(source.indexOf('  function shelterGearPlan('),source.indexOf('  function shelterSwapSequences('));
const scoreCode=source.slice(source.indexOf('  function shelterAllocationScore('),source.indexOf('  function shelterAllocationFutureSupply('));
const {model,gear,find}=vm.runInNewContext(`${table}\n${modelCode}\n${scoreCode}\n${gearCode}\n({model:shelterModel,gear:shelterGearPlan,find:shelterFindGear})`,{
  shelterGear:true,objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
  staffRoomTypes:['power','diner','water','scrap'],
  shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
const now=2000000000;
const resident=(id,roomId,stats={})=>({id,name:`居民${id}`,roomId,away:null,deadAt:null,adultAt:0,xp:0,happiness:100,
  outfitId:null,weaponId:null,stats:{str:3,per:3,end:3,cha:3,int:3,agi:3,lck:3,...stats}});
function scene(people,items){
  return {vaultNo:77,serverTime:now,progress:{level:8},switches:{frozen:false},state:{lastSettledAt:now,
    rooms:['power','diner','water','scrap'].map((type,i)=>({id:i+1,type,width:1,level:1,floor:1,stored:0,builtAt:0,upgradeAt:null,unpowered:false,incident:null})),
    residents:people,items,handies:[],births:[],achievements:[],resources:{scrap:100,power:100,food:100,water:100,parts:0,stimpak:0},
    stats:{collected:0},daily:{day:'2026-11-04',claimed:[]},season:{month:'2026-11',claimedFree:[],points:0}}};
}
function finish(view){
  const v=structuredClone(view),steps=[];
  for(let i=0;i<50;i++){
    const m=model(v),before=JSON.stringify(m),choice=gear(m,v.state.residents);
    assert.equal(JSON.stringify(m),before,'planning must not mutate game state');
    if(!choice)return {view:v,production:m.production,steps};
    assert.ok(!v.state.residents.some(p=>p.outfitId===choice.item||p.weaponId===choice.item),'only unused clothing');
    v.state.residents.find(p=>p.id===choice.id).outfitId=choice.item;steps.push(choice);
  }
  assert.fail('clothing plan did not settle');
}
test('服装整批分配：专用服留给有替代者，多属性服补另一岗位，不被单件最大收益锁死',()=>{
  const v=scene([resident(1,4,{end:3}),resident(2,3,{per:3}),resident(3,1,{str:17}),resident(4,2,{agi:17})],
    [{id:101,slot:'outfit',bonus:{end:5,per:4}},{id:102,slot:'outfit',bonus:{end:5}}]);
  const result=finish(v);
  assert.equal(result.view.state.residents[0].outfitId,102);
  assert.equal(result.view.state.residents[1].outfitId,101);
  assert.ok(Math.abs(result.production.scrap-10.4)<1e-9);
  assert.ok(Math.abs(result.production.water-9.6)<1e-9);
});

// Independent enumeration of every clothing/worker combination and direct production formula.
function direct(view){
  const out={power:0,food:0,water:0,scrap:0};
  for(const r of view.state.rooms){
    const [key,stat,base]=({power:['power','str',12],diner:['food','agi',8],water:['water','per',8],scrap:['scrap','end',8]})[r.type];
    for(const p of view.state.residents.filter(p=>p.roomId===r.id&&p.away===null&&p.deadAt===null&&p.adultAt<=now).slice(0,r.width*2)){
      const bonus=view.state.items.find(i=>i.id===p.outfitId)?.bonus?.[stat]||0;
      out[key]+=base*[0,1,1.5,2.1][r.level]*(.5+Math.min(17,p.stats[stat]+bonus)/10)*
        (.6+.4*Math.min(100,p.happiness)/100)*(1+.01*(Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))-1));
    }
  }
  return out;
}
const score=(out,demand)=>[Object.keys(demand).reduce((n,k)=>n+Math.max(0,demand[k]*1.2-out[k])/Math.max(1,demand[k]*1.2),0),
  -out.scrap,-out.power-out.food-out.water];
const better=(a,b)=>{for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-6)return a[i]<b[i];return false;};
function exhaustive(view){
  const v=structuredClone(view),demand=model(v).demand,used=new Set();let best=direct(v);
  function visit(index){
    if(index===v.state.residents.length){const output=direct(v);if(better(score(output,demand),score(best,demand)))best=output;return;}
    const p=v.state.residents[index];
    for(const item of [null,...v.state.items.map(i=>i.id)]){
      if(item!==null&&used.has(item))continue;
      p.outfitId=item;if(item!==null)used.add(item);visit(index+1);used.delete(item);
    }
    p.outfitId=null;
  }
  visit(0);return best;
}
test('服装整批分配独立穷举：供应缺口、属性上限、等级、心情和房间倍率下均达到小阵容最佳收益',()=>{
  let seed=731;const random=()=>((seed=(seed*1664525+1013904223)>>>0)%18);
  for(let trial=0;trial<16;trial++){
    const people=[1,2,3,4].map(id=>({...resident(id,id,{str:random(),agi:random(),per:random(),end:random()}),
      happiness:50+random()*2,xp:trial*6}));
    const items=[101,102,103].map(id=>({id,slot:'outfit',bonus:{str:random()%7,per:random()%7,end:random()%7,agi:random()%7}}));
    const view=scene(people,items);view.state.rooms[trial%4].level=2;
    const expected=score(exhaustive(view),model(view).demand),result=finish(view),actual=score(direct(result.view),model(view).demand);
    actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-7,`trial ${trial}, score ${i}: ${n} != ${expected[i]}`));
    assert.ok(result.steps.length<=items.length);assert.equal(gear(model(result.view),result.view.state.residents),null);
  }
});
test('服装整批分配：不以溢出的单项供应收益挤掉另一个仍未补足的缺口',()=>{
  const m={production:{power:9,food:0,water:12,scrap:0},demand:{power:10,food:10,water:10}};
  const choices=[{id:1,item:101,resource:'power',gain:100},{id:2,item:101,resource:'food',gain:10}];
  const result=find(m,choices);assert.equal(result.choices[0].id,2);assert.equal(result.complete,true);
});
test('服装整批分配：计算有界，达到节点或人数上限仍保留可行方案并明确未穷尽',()=>{
  const m={production:{power:20,food:20,water:20,scrap:0},demand:{power:1,food:1,water:1}};
  const choices=Array.from({length:17},(_,i)=>({id:i+1,item:i+101,resource:'scrap',gain:1}));
  const limited=find(m,choices.slice(0,16),1);assert.equal(limited.complete,false);assert.equal(limited.nodes,1);
  assert.equal(limited.choices.length,16);assert.equal(limited.production.scrap,16);
  const large=find(m,choices);assert.equal(large.complete,false);assert.equal(large.nodes,0);assert.equal(large.choices.length,17);
});
