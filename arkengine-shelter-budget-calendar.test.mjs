import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {levelPlanningView} from './arkengine-shelter-level-planning.fixture.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults','shelterResources'].map(n=>
  source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const code=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const api=vm.runInNewContext(declarations+'\n'+code+'\n({model:shelterModel,routes:shelterLevelRoutes,level:shelterLevelProgress,'+
  'calendar:typeof shelterConstructionBudgetCalendar===\'function\'?shelterConstructionBudgetCalendar:null})',
  {objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x)});
const hour=3600000,plain=x=>JSON.parse(JSON.stringify(x));
function scene(){
  const view=levelPlanningView(),m=api.model(view);
  const options=view.state.rooms.filter(r=>[100,101].includes(r.id)).map(r=>({kind:'upgrade',type:'storage',id:r.id,level:2,
    cost:{scrap:200,parts:0},hours:1,levelGain:1,levelInvestment:true,priority:28,blocks:[],title:'仓库升级',benefit:'等级投入'}));
  const policy={upgrade:true,build:false,dig:false,scrapLimit:200,partsLimit:0,scrapReserve:0,partsReserve:0,spent:{scrap:0,parts:0}};
  return {view,m,options,policy,run(gain=2,extra={}){return api.routes(m,options,api.level(m).score+gain,null,
    {...extra,campaign:{constructionPolicy:policy}});}};
}
test('预算日历：两笔200受24小时200额度约束，完成至少25小时而非2小时',()=>{
  const x=scene(),before=JSON.stringify(x),route=x.run().find(r=>r.complete);
  assert.ok(route);assert.equal(route.steps.length,2);
  assert.ok(Math.abs(route.steps[1].startHours-24)<1e-8);assert.ok(Math.abs(route.hours-25)<1e-8);
  assert.equal(JSON.stringify(x),before);
});
test('预算日历：已发生支出按实际释放时间恢复，不固定多等24小时',()=>{
  const x=scene();x.policy.spent.scrap=200;
  x.policy.budgetReleases=[{at:x.m.now+2*hour,scrap:200,parts:0}];
  const r=x.run(1).find(r=>r.complete);assert.ok(r);assert.ok(Math.abs(r.hours-3)<1e-8);
});
test('预算日历：废料与零件分别约束，必须等到两者均有额度',()=>{
  const x=scene();x.policy.partsLimit=10;x.policy.spent={scrap:200,parts:10};
  x.options[0].cost.parts=10;
  x.policy.budgetReleases=[{at:x.m.now+2*hour,scrap:200,parts:0},{at:x.m.now+5*hour,scrap:0,parts:10}];
  x.options.splice(1);const r=x.run(1).find(r=>r.complete);assert.ok(r);assert.ok(Math.abs(r.hours-6)<1e-8);
});
test('预算日历：材料和预算等待同时流逝，不重复累加，期间继续生产',()=>{
  const x=scene();x.m.state.resources.scrap=0;x.policy.spent.scrap=200;
  x.policy.budgetReleases=[{at:x.m.now+12*hour,scrap:200,parts:0}];
  const r=x.run(1).find(r=>r.complete);assert.ok(r);assert.ok(Math.abs(r.hours-13)<1e-8);
});
test('预算日历：只有合计没有时间的占用不假定释放，预付模式也不借未来额度',()=>{
  const x=scene();x.policy.spent.scrap=200;assert.equal(x.run(1).length,0);
  x.policy.budgetReleases=[{at:x.m.now+hour,scrap:200,parts:0}];
  assert.equal(x.run(1,{funded:true}).length,0);
});
test('预算日历：跨预算周期的快速单项方案胜过两项名义短工期路线',()=>{
  const x=scene();x.options.push({...x.options[0],id:102,hours:3,levelGain:2});
  const r=x.run()[0];assert.equal(r.complete,true);assert.equal(r.steps[0].project.id,102);assert.ok(Math.abs(r.hours-3)<1e-8);
});
test('预算日历：重放原路线从当前时刻重算释放，过期账目不继续占额',()=>{
  const x=scene(),r=x.run().find(r=>r.complete);assert.ok(r);
  const next=structuredClone(x.view);next.serverTime+=hour;
  x.policy.spent.scrap=200;x.policy.budgetReleases=[{at:x.view.serverTime+24*hour,scrap:200,parts:0}];
  const m=api.model(next),replayed=api.routes(m,x.options,api.level(m).score+2,null,
    {routeSteps:r.steps.map(s=>s.project),campaign:{constructionPolicy:x.policy}}).find(r=>r.complete);
  assert.ok(replayed);assert.ok(Math.abs(replayed.steps[0].startHours-23)<1e-8);
});
test('预算日历：本地支付时间转换到服务端轴，未确认预留不进入自动释放列表',()=>{
  assert.equal(typeof api.calendar,'function');
  const local=100*hour,server=local+123456;
  const state={constructionLedger:[{id:'old',at:local-25*hour,scrap:80,parts:0},{id:'recent',at:local-22*hour,scrap:200,parts:5}],
    caravan:{pending:{id:'unknown',cost:{scrap:30,parts:0}}}};
  assert.deepEqual(plain(api.calendar(state,local,server)),[{at:server+2*hour,localReleaseAt:local+2*hour,scrap:200,parts:5}]);
});
