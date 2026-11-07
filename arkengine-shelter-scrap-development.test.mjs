import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const code=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const api=vm.runInNewContext(`${declarations}\n${code}\n({model:shelterModel,plan:shelterDevelopmentPlan,render:shelterDevelopmentText})`,{
  objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
  shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
function scene(){
  const v=campaignView(),s=v.state;
  Object.assign(s.rooms.find(r=>r.id===4),{width:3,level:2});
  Object.assign(s.rooms.find(r=>r.id===6),{floor:2,col:4});
  for(let id=7;id<=11;id++)s.residents.push({...structuredClone(s.residents[3]),id,name:`回收居民${id}`});
  s.resources.scrap=1000;s.resources.parts=60;
  const c={enabled:true,reserved:[],unemployedResidents:[],projects:[{type:'elevator',person:5,milestone:8,priority:40,benefit:'扩展探险位'}],
    constructionPolicy:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0,spent:{scrap:0,parts:0}}};
  const plan=(goal=null)=>api.plan(api.model(v),14,c,goal);
  return {v,s,c,plan};
}
test('废料投资：满员三格二级回收站之外有两名真实闲置成人，先建第二站再挖探险位',()=>{
  const {v,c,plan}=scene(),before=JSON.stringify(v),p=plan();
  assert.equal(p.next.type,'scrap');assert.equal(p.next.kind,'build');assert.equal(p.next.status,'ready');
  assert.equal(p.next.project.cost.scrap,128);assert.ok(p.next.project.economics.gain>0);
  assert.ok(p.next.project.scrapInvestment);assert.match(api.render(p),/废料.*回本/);
  assert.equal(JSON.stringify(v),before);assert.equal(c.constructionPolicy.scrapLimit,10000);
});
test('废料投资：有短回本的实际扩产时，不能只追便宜等级分而一直安排探险位',()=>{
  const {v,plan}=scene();v.progress={level:5,score:82,next:87};
  const p=plan(10);assert.equal(p.next.type,'scrap');assert.equal(p.next.kind,'build');assert.ok(p.next.project.scrapInvestment);
});
test('废料投资边界：无闲人、已预留、预算不足或未授权新建时不能提高建站优先级',()=>{
  for(const kind of ['no-workers','reserved','budget','spent','reserve','disabled','pending']){
    const {v,s,c,plan}=scene();
    if(kind==='no-workers')for(const p of s.residents.filter(p=>p.roomId===null))p.away={kind:'explore'};
    if(kind==='reserved')c.reserved=[5,6];
    if(kind==='budget')c.constructionPolicy.scrapLimit=127;
    if(kind==='spent')c.constructionPolicy.spent.scrap=9873;
    if(kind==='reserve')c.constructionPolicy.scrapReserve=s.resources.scrap-127;
    if(kind==='disabled')c.constructionPolicy.build=false;
    if(kind==='pending')c.constructionPolicy.pending=true;
    assert.ok(!plan().next.project?.scrapInvestment,kind);
  }
});
test('废料投资边界：供给紧缺或回收工程在建时，不为快回本抢掉基础保障或重复留人',()=>{
  for(const kind of ['food','power','pending','defense']){
    const {s,plan,v,c}=scene();
    if(kind==='food')s.residents.find(p=>p.id===2).stats.agi=0;
    if(kind==='power')s.residents.find(p=>p.id===1).stats.str=0;
    if(kind==='pending')s.rooms.find(r=>r.id===4).upgradeAt=v.serverTime+9*3600000;
    if(kind==='defense')c.defense={busy:true};
    if(kind==='food'||kind==='power')for(let id=20;id<30;id++)s.residents.push({...structuredClone(s.residents[0]),id,name:`新居民${id}`,roomId:null,adultAt:v.serverTime+3600000});
    assert.ok(!plan().next.project?.scrapInvestment,kind);
  }
});

test('废料投资边界：已确认原工程备料优先，目标失效后才恢复投资评估',()=>{
  const {v,c,plan}=scene();v.progress={level:5,score:82,next:87};
  c.materials={vaultNo:v.vaultNo,id:4,type:'scrap',level:3,targetLevel:6,finalTarget:10};
  assert.ok(!plan(10).candidates.some(p=>p.scrapInvestment),'已确认目标不能被新投资换掉');
  c.materials.id=999;
  assert.ok(plan(10).candidates.some(p=>p.scrapInvestment),'原房间不存在后重新评估');
});
test('布局：已有人手可继续扩宽时优先三格连续空间，不塞进只剩一格的楼层',()=>{
  const {s,plan}=scene();
  Object.assign(s.rooms.find(r=>r.id===6),{width:3}); // floor 2 only has column 7 left.
  for(const id of [12,13])s.residents.push({...structuredClone(s.residents.find(p=>p.id===6)),id,name:`待就业居民${id}`});
  const build=plan().candidates.find(c=>c.kind==='build'&&c.type==='scrap');
  assert.equal(build.floor,3);assert.equal(build.col,2);assert.equal(build.layout.targetWidth,3);
});

test('布局：仅有一格所需人手时沿用可用小位置，不为假设的增员提前改变整层安排',()=>{
  const {s,plan}=scene();s.rooms.find(r=>r.id===6).width=3;
  const build=plan().candidates.find(c=>c.kind==='build'&&c.type==='scrap');
  assert.equal(build.floor,2);assert.equal(build.col,7);assert.equal(build.layout.targetWidth,1);
});
test('布局：医疗等小房间有其他位置时，不堵住一级小生产房扩到三格的空间',()=>{
  const {s,c,plan}=scene();
  Object.assign(s.rooms.find(r=>r.id===6),{width:3});
  s.rooms.push({...s.rooms[0],id:90,type:'scrap',floor:3,col:2,width:1,level:1});
  c.projects=[{type:'medbay',person:5,priority:18,benefit:'准备医疗'}];
  const build=plan().candidates.find(c=>c.kind==='build'&&c.type==='medbay');
  assert.equal(build.floor,2);assert.equal(build.col,7);
});
test('布局：有真实增员和可合并位置时先扩宽回收站，没有新增人手则不强求三格',()=>{
  const {s,v,plan}=scene();
  Object.assign(s.rooms.find(r=>r.id===4),{width:1,level:1});
  s.residents=s.residents.filter(p=>p.id<=7); // id 4 and 7 fill the small recycler; 5/6 can fill its extension.
  v.progress={level:5,score:80,next:87};
  const p=plan(10);assert.equal(p.next.kind,'build');assert.equal(p.next.type,'scrap');
  assert.equal(p.next.project.floor,1);assert.equal(p.next.project.col,6);assert.equal(p.next.project.layout.mergeInto,4);
  s.residents=s.residents.filter(p=>![5,6].includes(p.id));
  assert.ok(!plan(10).candidates.some(c=>c.type==='scrap'&&c.kind==='build'));
});
test('布局：只剩生产房旁的空位时允许必要房间落地，不为保留整排无期限停工',()=>{
  const {s,c,plan}=scene();s.depth=2;
  s.rooms=s.rooms.filter(r=>r.floor<=2);
  Object.assign(s.rooms.find(r=>r.id===6),{width:3});
  Object.assign(s.rooms.find(r=>r.id===4),{width:1,level:1});
  s.rooms.push({...s.rooms[0],id:90,type:'storage',floor:2,col:7,width:1,level:3});
  c.projects=[{type:'medbay',person:5,priority:18,benefit:'必要医疗'}];
  const p=plan(),build=p.candidates.find(c=>c.kind==='build'&&c.type==='medbay');
  assert.equal(build.floor,1);assert.equal(build.col,6);
});
