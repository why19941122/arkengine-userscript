import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView,levelGateView,upperStageView,materialCycleView,storageChoiceView,handyMaterialView,capacityRouteView} from './arkengine-shelter-campaign.fixture.mjs';
const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(name=>source.match(new RegExp(`const ${name}\\s*=[^;]*;`))[0]).join('\n');
const code=source.slice(source.indexOf('  function shelterWorkerRate('),source.indexOf('  function readShelter('));
const api=vm.runInNewContext(`${declarations}\n${code}\n({model:shelterModel,plan:shelterCampaignPlan,defense:shelterDefensePlan,level:shelterLevelProgress,routes:shelterLevelRoutes,development:shelterDevelopmentPlan,render:shelterDevelopmentText,forecast:shelterMaterialForecast,trace:shelterDevelopmentTrace,traceValid:validShelterDevelopmentTrace,traceText:shelterDevelopmentTraceText,daily:shelterDailyGoals,evidence:shelterTripEvidence,valid:validCampaignRecord,caravan:shelterCaravanPlan})`,{
  objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'}});
const now=2_000_000_000;
function stageTrace(view,previous,goal=10){
  const m=api.model(view),plan=api.development(m,14,{enabled:true,reserved:[],projects:[]},goal);
  return api.trace(previous,m,plan);
}
test('高等级备料：持续追7级才产生的三级升级也必须给出零件项目，不漏掉后生成候选',()=>{
  const v=upperStageView(),p=api.development(api.model(v),14,{enabled:true,reserved:[],projects:[]},10);
  assert.equal(p.levelProgress.score,96);assert.equal(p.levelProgress.targetLevel,7);
  const selected=p.candidates.find(c=>c.levelTarget===7);
  assert.ok(selected?.cost.parts>0,JSON.stringify(p.next));
  assert.ok(p.partsTarget>0,'level-only upgrade must propagate its parts requirement');
  assert.ok(p.partsProject?.cost.parts>0);assert.match(p.notes.join('\n'),/零件/);
});
test('高等级备料：已备足零件或在途足够升7时不再预留，关闭追级不延用旧需求',()=>{
  const v=upperStageView(),campaign={enabled:true,reserved:[],projects:[]};
  let p=api.development(api.model(v),14,campaign,10);v.state.resources.parts=p.partsTarget;
  p=api.development(api.model(v),14,campaign,10);assert.equal(p.partsTarget,0);assert.equal(p.partsProject,null);
  v.state.resources.parts=0;
  p=api.development(api.model(v),14,campaign,0);assert.equal(p.partsTarget,0);
  v.state.births=Array.from({length:8},(_,i)=>({roomId:5,dueAt:now+3600000+i}));
  p=api.development(api.model(v),30,campaign,10);assert.ok(p.levelProgress.committed>=111);
  assert.ok(!p.candidates.some(c=>c.levelTarget));assert.equal(p.partsTarget,0);
});
test('6到10级临界规划：各级有可开工增产升级，实际增分后继续下一阶段，达到10不继续追级',()=>{
  const thresholds=[111,141,174,213];
  for(let target=7;target<=10;target++){
    const v=upperStageView(),s=v.state,base=s.rooms[0];
    for(let i=0;i<2;i++)s.rooms.push({...base,id:200+i,type:'power',floor:5,col:2+i,width:1,level:3});
    s.residents.slice(10,14).forEach((p,i)=>p.roomId=200+Math.floor(i/2));
    if(target>=9){s.depth=target===10?10:8;for(let floor=8;floor<=s.depth;floor++)s.rooms.push({...base,id:100+floor,type:'elevator',floor,col:1,width:1,level:1});}
    // 阈值来自已核实网页规则；以空闲位置的既有仓库构造独立边界快照，不宣称这是一条自动建设路线。
    const expected=thresholds[target-7]-1;let missing=expected-(102+(s.depth-7)*3),id=300;
    for(let floor=1;floor<=s.depth&&missing;floor++)for(let col=2;col<8&&missing;col++){
      if(s.rooms.some(r=>r.floor===floor&&r.col<=col&&col<r.col+r.width))continue;
      const level=Math.min(3,missing);s.rooms.push({...base,id:id++,type:'storage',floor,col,width:1,level});missing-=level;
    }
    assert.equal(missing,0);s.resources.parts=100;v.progress={level:target-1,score:expected,next:thresholds[target-7]};
    let m=api.model(v),plan=api.development(m,14,{enabled:true,reserved:[],projects:[]},10);
    assert.equal(plan.levelProgress.score,expected);assert.equal(plan.levelProgress.targetLevel,target);
    assert.equal(plan.next.status,'ready',JSON.stringify({target,next:plan.next}));
    assert.equal(plan.next.project.kind,'upgrade');const chosen=plan.next.project;
    const trace=api.trace(undefined,m,plan),room=s.rooms.find(r=>r.id===chosen.id);
    assert.ok(room.level<3);s.resources.scrap-=chosen.cost.scrap;s.resources.parts-=chosen.cost.parts;
    room.level++;v.serverTime+=chosen.hours*3600000;v.progress.level=target;
    m=api.model(v);plan=api.development(m,14,{enabled:true,reserved:[],projects:[]},10);
    assert.equal(plan.levelProgress.level,target);assert.equal(plan.levelProgress.score,expected+room.width);
    assert.equal(plan.levelProgress.targetLevel,target<10?target+1:undefined);
    const after=api.trace(trace,m,plan);assert.equal(after.history[0].outcome,'reached');
    assert.equal(after.active?.target,target<10?target+1:undefined);
    assert.equal(s.residents.length,15,'planning must not change the population ceiling or residents');
  }
});
test('高等级备料：临时工坊值班不会把当前材料项目改成升级工坊，人工产能仍可评估',()=>{
  const v=upperStageView(),s=v.state;s.resources.scrap=1500;
  s.residents.find(p=>p.id===4).roomId=4;s.residents.find(p=>p.id===7).roomId=4;
  s.rooms.push({...s.rooms[0],id:108,type:'workshop',floor:3,col:6,width:1,level:1});
  const worker=s.residents.find(p=>p.id===4),record={roles:[{id:4,room:108,role:'workshop',at:v.serverTime-1}]};
  const plan=(cfg={},r=record)=>{const m=api.model(v);return api.development(m,14,api.plan(m,cfg,r),10);};
  let p=plan();assert.equal(p.next.project.type,'power');assert.equal(p.partsTarget,30);
  worker.roomId=108;p=plan();
  assert.equal(p.next.project.type,'power','temporary staffing must not replace the project it supplies');
  assert.equal(p.partsTarget,30);assert.equal(p.partsProject.cost.scrap,1200);
  s.daily.picks=['build','win','baby'].map(key=>({key,target:1,reward:{scrap:1300,parts:0,points:30}}));s.daily.counters={};
  p=plan({dailyGoals:true});assert.equal(p.next.project.type,'power','daily build reward must not recreate the staffing loop');
  s.daily.picks=[];
  p=plan({},{});assert.equal(p.next.project.type,'workshop','manual workshop production remains a valid upgrade candidate');
  s.residents.find(p=>p.id===7).roomId=108;
  p=plan();assert.equal(p.next.project.type,'workshop','a mixed room still has independent manual production');
  s.residents.find(p=>p.id===7).away={kind:'explore'};
  p=plan();assert.equal(p.next.project.type,'power','an absent manual worker cannot establish permanent production');
});

test('高等级备料：零件保留量不能把无需零件的当前升级解释成备料需求',()=>{
  const v=upperStageView(),s=v.state;s.resources.scrap=1500;
  s.rooms.push({...s.rooms[0],id:108,type:'workshop',floor:3,col:6,width:1,level:1});
  s.residents.find(p=>p.id===4).roomId=108;s.residents.find(p=>p.id===7).roomId=4;
  const m=api.model(v),p=api.development(m,14,api.plan(m,{partsReserve:10}),10);
  assert.equal(p.next.project.type,'workshop');assert.equal(p.next.project.cost.parts,0);
  assert.equal(p.partsTarget,0);assert.equal(p.partsProject,null);
  assert.doesNotMatch(p.notes.join('\n'),/本轮追级项目.*还需准备/);
});

test('连续备料：原发电升级归属跨产速变化保留，不因工坊有产出改选本金不足的医务室',()=>{
  const v=materialCycleView(),s=v.state,record={roles:[]};
  let m=api.model(v),p=api.development(m,14,api.plan(m,{},record),10);
  assert.equal(p.next.project.type,'power');
  record.materials={vaultNo:77,id:1,type:'power',level:3,targetLevel:7,finalTarget:10};
  s.residents.find(p=>p.id===3).roomId=108;record.roles.push({id:3,room:108,role:'workshop',at:now-1});
  m=api.model(v);p=api.development(m,14,api.plan(m,{},record),10);
  assert.equal(p.next.project.type,'power');assert.equal(p.partsTarget,30);
  assert.ok(p.routes.every(r=>!r.steps.length||r.steps[0].project.id===1));
  assert.match(p.notes.join('\n'),/继续.*备料/);
  s.resources.parts=30;p=api.development(api.model(v),14,api.plan(api.model(v),{},record),10);
  assert.equal(p.next.project.id,1);assert.equal(p.next.status,'ready');
});

test('连续备料：已开工、目标变化、账号或房间身份不符时旧项目不再约束，紧急供给仍优先',()=>{
  const original=materialCycleView();original.state.residents.find(p=>p.id===3).roomId=108;
  const materials={vaultNo:77,id:1,type:'power',level:3,targetLevel:7,finalTarget:10};
  const plan=(v,patch={},goal=10)=>{const m=api.model(v);return api.development(m,14,
    api.plan(m,{}, {materials:{...materials,...patch},roles:[{id:3,room:108,role:'workshop',at:now-1}]}),goal);};
  for(const patch of [{vaultNo:88},{id:99},{type:'water'},{level:2},{targetLevel:8},{finalTarget:9}])
    assert.doesNotMatch(plan(structuredClone(original),patch).notes.join('\n'),/继续.*备料/);
  assert.doesNotMatch(plan(structuredClone(original),{},9).notes.join('\n'),/继续.*备料/);
  assert.doesNotMatch(plan(structuredClone(original),{},0).notes.join('\n'),/继续.*备料/);
  let v=structuredClone(original);v.state.rooms[0].upgradeAt=now+3600000;
  let p=plan(v);assert.notEqual(p.next.project?.id,1);assert.doesNotMatch(p.notes.join('\n'),/继续.*备料/);
  v=structuredClone(original);v.state.rooms[0].incident={kind:'raiders',hp:80,maxHp:80};
  p=plan(v);assert.equal(p.next.kind,'restore');
  v=structuredClone(original);v.state.residents.filter(r=>r.roomId===3).forEach(r=>r.roomId=null);
  p=plan(v);assert.equal(p.next.type,'water','supply repair outranks material commitment');
  const record={roles:[],trips:[],attempts:[],heals:[],trainingRest:[],materials};
  assert.equal(api.valid(record),true);assert.equal(api.valid({...record,materials:{...materials,id:'1'}}),false);
  delete record.materials;assert.equal(api.valid(record),true,'old records remain valid');
});

test('追级仓储：仅充足消耗品接近满仓时先备料升级，不为继续囤积占用建设资金',()=>{
  for(const resource of ['stimpak','power','food','water']){
    const v=upperStageView(),m=api.model(v);v.state.resources[resource]=.95*m.caps[resource];
    const p=api.development(api.model(v),14,api.plan(api.model(v),{}),10);
    assert.notEqual(p.next.type,'storage',resource);
    assert.ok(!p.candidates.some(c=>c.type==='storage'&&c.priority<70),resource);
    assert.match(p.notes.join('\n'),/储备.*充足.*扩仓.*后续/);
  }
});

test('追级仓储：材料和装备空间仍可扩，明确医疗预留不足及关闭追级保持原扩仓评估',()=>{
  for(const kind of ['scrap','parts','items','medical','disabled']){
    const v=upperStageView(),s=v.state;let m=api.model(v);
    if(kind==='items')s.items=Array.from({length:Math.ceil(.95*m.itemCap)},(_,i)=>({id:i+100,slot:'weapon',damage:[1,2]}));
    else if(kind==='parts'){s.rooms.push({...s.rooms[0],id:108,type:'workshop',floor:3,col:6,width:1,level:1});s.residents.at(-1).roomId=108;
      s.resources.parts=api.model(v).caps.parts*.95;}
    else s.resources[kind==='scrap'?'scrap':'stimpak']=.95*m.caps[kind==='scrap'?'scrap':'stimpak'];
    m=api.model(v);const cfg=kind==='medical'?{medical:true,reserve:100}:{};
    const p=api.development(m,14,api.plan(m,cfg),kind==='disabled'?0:10);
    assert.ok(p.candidates.some(c=>c.type==='storage'&&c.priority<70),kind);
    if(kind==='medical')assert.ok(api.plan(m,cfg).stimpakTarget>m.caps.stimpak);
  }
});

test('扩仓路线执行：同用途升级更早完成且可立即开工时，不被新建的固定优先级挡住',()=>{
  const v=storageChoiceView(),m=api.model(v),p=api.development(m,14,api.plan(m,{}),10);
  assert.equal(p.levelProgress.score,112);assert.equal(m.production.scrap,5.04);
  const first=p.routes[0].steps[0];assert.equal(first.project.id,202);assert.ok(first.finishHours<1.01);
  assert.equal(p.next.kind,'upgrade');assert.equal(p.next.project.id,202);
  assert.equal(p.next.status,'ready');assert.equal(p.next.project.cost.scrap,200);
  assert.equal(p.next.project.levelTarget,8);
});

test('扩仓路线执行：资金已足够时仍选十分钟新建，不因升级更便宜固定选升级',()=>{
  const v=storageChoiceView();v.state.resources.scrap=300;
  const m=api.model(v),p=api.development(m,14,api.plan(m,{}),10);
  assert.equal(p.next.kind,'build');assert.equal(p.next.type,'storage');assert.equal(p.next.status,'ready');
  assert.equal(p.next.project.cost.scrap,256);assert.ok(p.routes[0].hours<.17);
});

test('扩仓路线执行：可领取整批同时覆盖两方案时按整批到账评估，新建仍可更早完成',()=>{
  const v=storageChoiceView();v.state.resources.scrap=100;v.state.rooms.find(r=>r.id===4).stored=189;
  const m=api.model(v),p=api.development(m,14,api.plan(m,{}),10);
  assert.equal(p.next.kind,'build');assert.equal(p.next.type,'storage');assert.equal(p.next.status,'saving');
  assert.ok(p.routes[0].hours<.34,'one collection tick and ten minutes construction');
});

test('扩仓路线执行：停产储备不足的升级不能因现有本金够用而成为可执行路线',()=>{
  const v=storageChoiceView();v.state.resources.power=0;
  const m=api.model(v),p=api.development(m,14,api.plan(m,{}),10);
  assert.ok(p.candidates.some(c=>c.id===202&&c.blocks.some(x=>x.includes('停产期间'))));
  assert.ok(!p.routes.some(r=>r.steps.some(x=>x.project.id===202)));
  assert.notEqual(p.next.kind,'upgrade');
});

test('攒料时间：已存整批按下一领取步长计入，下一步及候选不再显示31小时的连续产量估算',()=>{
  const v=storageChoiceView();v.state.resources.scrap=100;v.state.rooms.find(r=>r.id===4).stored=189;
  const m=api.model(v),before=JSON.stringify(v),p=api.development(m,14,api.plan(m,{}),10);
  assert.equal(p.next.kind,'build');assert.ok(Math.abs(p.next.project.saveHours-1/6)<1e-8);
  assert.equal(p.next.project.saveHours,p.routes[0].steps[0].startHours);
  assert.ok(p.candidates.filter(c=>c.type==='storage'&&c.shortage.scrap>0).every(c=>Math.abs(c.saveHours-1/6)<1e-8));
  assert.match(p.next.reason,/整批.*10 分钟/);assert.doesNotMatch(api.render(p),/31\.0 小时/);
  assert.equal(JSON.stringify(v),before);
});

test('攒料时间：没有已存批量时等待37.5小时满一批，关闭追级也沿用相同估算',()=>{
  const v=storageChoiceView();v.state.resources.scrap=100;
  const m=api.model(v);
  for(const level of [0,10]){
    const p=api.development(m,14,api.plan(m,{}),level);
    assert.equal(p.next.kind,'build');assert.ok(Math.abs(p.next.project.saveHours-37.5)<1e-7);
    assert.match(p.next.reason,/整批.*37\.5 小时/);assert.doesNotMatch(api.render(p),/31\.0 小时/);
  }
});

test('攒料时间：废料足够而只缺零件时，已有整批可以估时，完全没有来源时明确未知',()=>{
  const v=upperStageView(),s=v.state;s.resources.parts=29;
  s.rooms.push({...s.rooms[0],id:108,type:'workshop',floor:3,col:6,width:1,level:1,stored:3});
  const record={materials:{vaultNo:v.vaultNo,id:1,type:'power',level:3,targetLevel:7,finalTarget:10}};
  let m=api.model(v),p=api.development(m,14,api.plan(m,{},record),10);
  assert.equal(p.next.project.id,1);assert.equal(p.next.project.shortage.scrap,0);assert.equal(p.next.project.shortage.parts,1);
  assert.ok(Math.abs(p.next.project.saveHours-1/6)<1e-8);assert.match(p.next.reason,/材料.*整批.*10 分钟/);
  s.rooms.at(-1).stored=0;m=api.model(v);p=api.development(m,14,api.plan(m,{},record),10);
  assert.equal(p.next.project.id,1,'keep the same already-funded material project for the missing-source comparison');
  assert.equal(p.next.project.saveHours,null);assert.match(p.next.reason,/无法估计.*零件|零件.*无法估计/);
});

test('攒料时间：容量放不下整批时不给虚假等待小时，现有基础供应不足时也保留原因',()=>{
  const v=storageChoiceView();v.state.resources.scrap=100;v.state.rooms.find(r=>r.id===4).stored=189;
  let m=api.model(v);m.caps.scrap=260;
  let p=api.development(m,14,api.plan(m,{}),10);
  assert.equal(p.next.project.saveHours,null);assert.match(p.next.reason,/整批.*容量|容量.*整批/);
  v.state.resources.power=0;v.state.rooms.find(r=>r.id===1).unpowered=true;
  m=api.model(v);p=api.development(m,14,api.plan(m,{}),10);
  assert.ok(p.candidates.filter(c=>c.shortage.scrap>0).every(c=>c.saveHours===null));
});

test('攒料时间：工坊供料扣减建设本金，先估失败的昂贵方案不污染后续候选的较早可用时间',()=>{
  const v=upperStageView();v.state.resources.scrap=100;v.state.resources.parts=0;
  const m=api.model(v);m.rooms.find(r=>r.resource==='scrap').rate=0;
  m.rooms.push({id:108,resource:'parts',rate:6,batch:3,stored:0,nextTickAt:m.now+600000});
  const before=JSON.stringify(m),forecast=api.forecast(m);
  assert.equal(forecast({scrap:100,parts:3}).hours,null,'three parts consume 18 scrap, leaving less than the requested principal');
  assert.ok(Math.abs(forecast({scrap:82,parts:3}).hours-.5)<1e-8,'an earlier affordable alternative must still be found');
  assert.equal(forecast({scrap:100,parts:0}).hours,0,'the current fully funded candidate does not inherit the failed forecast');
  assert.equal(forecast({scrap:90,parts:3}).hours,null);
  assert.equal(JSON.stringify(m),before,'candidate comparison must not mutate actual stocks or production');
});

test('管家攒料：已有管家可按整数空位代收，手动与其他楼层仍不能拆批',()=>{
  for(const floor of [undefined,1,2]){
    const v=storageChoiceView();v.state.resources.scrap=100;v.state.rooms.find(r=>r.id===4).stored=189;
    v.state.handies=floor===undefined?[]:[{id:1,floor}];
    const m=api.model(v);m.caps.scrap=260;const before=JSON.stringify(m);
    const p=api.development(m,14,api.plan(m,{}),10);
    assert.equal(p.next.status,'saving','a forecast is not current inventory or permission to spend');
    if(floor===2){
      assert.ok(Math.abs(p.next.project.saveHours-1/6)<1e-8,JSON.stringify(p.next));
      assert.ok(Math.abs(p.routes[0].steps[0].startHours-1/6)<1e-8);
    }else assert.equal(p.next.project.saveHours,null);
    assert.equal(JSON.stringify(m),before);
  }
});

test('管家攒料：小数余量向下取整，同层多台管家不增加可收金额',()=>{
  const v=storageChoiceView();v.state.resources.scrap=100.5;v.state.rooms.find(r=>r.id===4).stored=189;
  v.state.handies=[{id:1,floor:2},{id:2,floor:2}];
  const m=api.model(v);m.caps.scrap=260;m.rooms.find(r=>r.id===4).rate=0;
  const forecast=api.forecast(m);
  assert.ok(Math.abs(forecast({scrap:259,parts:0}).hours-1/6)<1e-8);
  assert.equal(forecast({scrap:260,parts:0}).hours,null,'159 tokens fit; the remaining half slot cannot be rounded up');
});

test('管家攒料：实际3600容量与医务室造价下，代收填满前仅预测，到账后才可开工',()=>{
  const v=handyMaterialView(),record={materials:{vaultNo:77,id:7,type:'medbay',level:3,targetLevel:7,finalTarget:10}};
  const plan=()=>{const m=api.model(v);assert.equal(m.caps.scrap,3600);return api.development(m,14,api.plan(m,{},record),10);};
  const p=plan();assert.equal(p.next.project.id,7);assert.equal(p.next.project.cost.scrap,3600);
  assert.equal(p.next.status,'saving');assert.ok(Math.abs(p.next.project.saveHours-1/6)<1e-8);
  assert.match(api.render(p),/已有管家.*整数空间/);
  v.state.handies=[];assert.equal(plan().next.project.saveHours,null);
  v.state.handies=[{id:1,floor:2}];v.state.resources.scrap+=100;v.state.rooms.find(r=>r.id===4).stored-=100;
  assert.equal(plan().next.status,'ready');assert.equal(plan().next.project.id,7);
});

test('管家路线：新建生产房继承所在楼层已有管家，代收只为后续工程提供一次本金',()=>{
  // 隔离路线库存推进的容量边界，人工指定候选费用；不将这些数值当成真实建筑造价。
  for(const automatic of [false,true]){
    const v=upperStageView();v.state.resources.scrap=0;v.state.handies=automatic?[{id:1,floor:3}]:[];
    const m=api.model(v);m.caps.scrap=10;m.rooms=m.rooms.filter(r=>r.resource!=='scrap');
    const options=[{kind:'build',type:'scrap',floor:3,col:6,hours:1/6,cost:{scrap:0,parts:0},gain:60,levelGain:1,blocks:[]},
      {kind:'upgrade',type:'power',id:1,hours:1,cost:{scrap:610,parts:0},levelGain:2,blocks:[]}];
    const routes=api.routes(m,options,99,{kind:'build'}),complete=routes.find(r=>r.complete);
    if(automatic){
      assert.ok(complete);assert.equal(complete.steps.length,2);assert.equal(complete.cost,610);
      assert.ok(Math.abs(complete.steps[1].startHours-(10+2/3))<1e-8);
    }else assert.equal(complete,undefined,'the new room adds 600 capacity, but the final 30-token batch still cannot fit in ten remaining slots');
  }
});

test('人口防守建议：床位口粮足够但主要武器持有者外出时，不直接建议扩到19人',()=>{
  const v=storageChoiceView(),s=v.state;s.items[0].damage=[1000,1000];
  const strong=s.residents.find(p=>p.id===11);strong.weaponId=s.items[0].id;strong.away={kind:'explore'};
  const m=api.model(v),p=api.development(m,14,api.plan(m,{defense:true}),10);
  assert.match(p.populationAdvice,/口粮.*19 人/);assert.match(p.populationAdvice,/留守未达标/);
  assert.doesNotMatch(p.populationAdvice,/可评估调到/);assert.equal(p.requestedTarget,14);
});

test('人口防守建议：关闭防守及缺少检查证据分别提示，不把容量上限当成扩人口建议',()=>{
  const v=storageChoiceView(),m=api.model(v);
  for(const [campaign,reason] of [[api.plan(m,{defense:false}),/自动防守未开启/],[null,/防守资料尚未核对/]]){
    const p=api.development(m,14,campaign,10);assert.match(p.populationAdvice,reason);
    assert.match(p.populationAdvice,/口粮.*19 人/);assert.doesNotMatch(p.populationAdvice,/可评估调到/);
  }
});

test('人口防守建议：战力比例设为零仍不把无法核对的装备解释为已准备好扩人口',()=>{
  const v=storageChoiceView();v.state.residents.find(p=>p.id===11).weaponId=99999;
  const m=api.model(v),campaign=api.plan(m,{defense:true,guardPowerPercent:0});
  assert.equal(campaign.guard.allowed,true,'the owner departure setting still applies');
  const p=api.development(m,14,campaign,10);
  assert.match(p.populationAdvice,/装备资料无法核对/);assert.doesNotMatch(p.populationAdvice,/可评估调到/);
});

test('人口防守建议：来袭期间先处理事件，当前留守通过后建议仍须人工修改且不保证胜率',()=>{
  const v=storageChoiceView(),before=JSON.stringify(v),m=api.model(v);
  let p=api.development(m,14,api.plan(m,{defense:true}),10);
  assert.match(p.populationAdvice,/可评估调到 19 人.*修改人口目标/);
  assert.match(p.populationAdvice,/满足当前留守设置/);assert.match(p.populationAdvice,/不代表.*必胜|不是.*必胜/);
  assert.equal(JSON.stringify(v),before);assert.equal(p.requestedTarget,14);
  v.state.rooms.find(r=>r.id===8).incident={kind:'raiders',hp:80,maxHp:80};
  const attacked=api.model(v);p=api.development(attacked,14,api.plan(attacked,{defense:true}),10);
  assert.match(p.populationAdvice,/来袭.*先处理/);assert.doesNotMatch(p.populationAdvice,/可评估调到/);
});

test('人口防守建议：从14人跨过15门槛前预查留守，不提前改变普通出发门槛',()=>{
  const v=storageChoiceView();v.state.residents.pop();v.progress={level:6,score:110,next:111};
  const m=api.model(v),campaign=api.plan(m,{defense:true,guardResidents:15,guardPowerPercent:50});
  assert.equal(campaign.guard.active,false,'ordinary departure threshold remains at 15');
  const p=api.development(m,14,campaign,10);
  assert.match(p.populationAdvice,/15 人/);assert.match(p.populationAdvice,/留守未达标.*14\/15/);
  assert.doesNotMatch(p.populationAdvice,/可评估调到/);
});

test('人口防守建议：预查扣除本轮计划外出人选，不把尚未出发者重复计入未来留守',()=>{
  const v=storageChoiceView();v.state.residents.pop();v.progress={level:6,score:110,next:111};
  const m=api.model(v),campaign=api.plan(m,{explore:true,defense:true,guardResidents:14,guardPowerPercent:0,tier:0,hours:6,stimpaks:0,reserve:0});
  assert.ok(campaign.actions.some(a=>a.kind==='explore-start'));
  const p=api.development(m,14,campaign,10);
  assert.match(p.populationAdvice,/留守未达标/);assert.doesNotMatch(p.populationAdvice,/可评估调到/);
});

test('等级阶段记录：原起点和材料来源跨刷新保留，实际升5才结束并开启6级阶段',()=>{
  const v=levelGateView();v.state.rooms[0].upgradeAt=now+3600000;v.state.rooms[1].upgradeAt=now+7200000;
  let record=stageTrace(v);assert.equal(api.traceValid(record),true);
  assert.equal(record.active.start.score,62);assert.equal(record.active.start.resources.scrap,722);
  assert.equal(record.active.target,5);assert.equal(record.active.latest.route.kind,'wait');
  assert.equal(record.active.latest.route.expectedAt,now+7200000);
  const original=JSON.stringify(record);
  v.serverTime=now+3600000;v.state.rooms[0].upgradeAt=null;v.state.rooms[0].level++;
  record=stageTrace(v,JSON.parse(original));assert.equal(record.active.start.score,62);assert.equal(record.active.latest.score,64);
  assert.equal(record.history.length,0);
  v.serverTime=now+7200000;v.state.rooms[1].upgradeAt=null;v.state.rooms[1].level++;v.progress.level=5;
  record=stageTrace(v,JSON.parse(JSON.stringify(record)));
  assert.equal(record.history.length,1);assert.equal(record.history[0].outcome,'reached');
  assert.equal(record.history[0].end.score,66);assert.equal(record.history[0].end.at,now+7200000);
  assert.equal(record.active.target,6);assert.equal(record.active.start.level,5);
  assert.equal(stageTrace(v,record).history.length,1,'same completed snapshot cannot create duplicate completion');
  assert.match(api.traceText(record),/首次观察到 5 级\/66 分/);
});
test('等级阶段记录：预计时间已到不等于升级，缺完整路线时不编造完成日期',()=>{
  const v=levelGateView();v.state.rooms[0].upgradeAt=now+3600000;v.state.rooms[1].upgradeAt=now+7200000;
  let record=stageTrace(v);v.serverTime=now+10*3600000;record=stageTrace(v,record);
  assert.equal(record.history.length,0);assert.equal(record.active.latest.level,4);
  assert.match(api.traceText(record),/尚未确认升级/);
  for(const r of v.state.rooms)if(r.type!=='elevator'){r.level=3;r.upgradeAt=null;}
  v.state.residents.at(-1).roomId=7;v.state.resources={scrap:100,parts:0,power:100,food:100,water:100,stimpak:1};v.progress.level=6;
  record=stageTrace(v);assert.equal(record.active.target,7);assert.equal(record.active.latest.route,null);
  assert.match(api.traceText(record),/没有.*完整时间估算/);
});
test('等级阶段记录：坏记录、错账号、倒序状态和不一致等级保留原证据，不影响独立规划',()=>{
  const v=levelGateView(),record=stageTrace(v),before=JSON.stringify(record);
  v.serverTime=now-1;assert.equal(stageTrace(v,record),record);v.serverTime=now;
  v.vaultNo=88;assert.equal(stageTrace(v,record),record);v.vaultNo=77;
  v.progress.level=5;assert.equal(stageTrace(v,record),record);v.progress.level=4;
  const damaged=JSON.parse(before);damaged.active.start.score='62';
  assert.equal(api.traceValid(damaged),false);assert.equal(stageTrace(v,damaged),damaged);
  assert.match(api.traceText(damaged),/无法核对/);assert.equal(JSON.stringify(record),before);
});
test('等级阶段记录：改目标或实际等级下降不能冒充成功，只保留最近12个已结束阶段',()=>{
  const v=levelGateView();let record=stageTrace(v);
  for(let i=0;i<14;i++){v.serverTime++;record=stageTrace(v,record,i%2?10:11);}
  assert.equal(record.history.length,12);assert.ok(record.history.every(s=>s.outcome==='settings-changed'));
  for(const p of v.state.residents.slice(0,8))p.deadAt=v.serverTime;
  v.progress.level=3;v.serverTime++;record=stageTrace(v,record);
  assert.equal(record.history.at(-1).outcome,'level-fell');assert.equal(record.active.target,4);
  assert.match(api.traceText(record),/实际等级下降.*未记作升级成功/);assert.equal(api.traceValid(record),true);
});
test('商队计划：按剩余全部次数比较总成本、预算和本金，不把单笔便宜当作可完成目标',()=>{
  const v=campaignView(),m=api.model(v),goal={remaining:2,reward:{scrap:250,parts:0}},
    config={scrapLimit:1000,partsLimit:10,scrapReserve:0,partsReserve:0},
    offers=[{slot:0,scrap:100,parts:0,delivered:false},{slot:1,scrap:160,parts:0,delivered:false}];
  assert.equal(api.caravan(m,goal,offers,config,{},null,now).choice,null);
  offers[1].scrap=120;
  let plan=api.caravan(m,goal,offers,config,{},null,now);assert.equal(plan.choice.slot,0);assert.equal(plan.cost.scrap,220);
  assert.equal(api.caravan(m,goal,offers,{...config,scrapLimit:219},{},null,now).choice,null);
  assert.equal(api.caravan(m,goal,offers,config,{},null,now,{cost:{scrap:2800,parts:0}}).choice,null);
  offers[1].delivered=true;assert.equal(api.caravan(m,goal,offers,config,{},null,now).choice,null);
});
test('商队计划：选择预算内可完成组合，未知旧单即使两天后仍占预算',()=>{
  const m=api.model(campaignView()),goal={remaining:1,reward:{scrap:200,parts:2}},
    config={scrapLimit:200,partsLimit:0,scrapReserve:0,partsReserve:0},
    offers=[{slot:0,scrap:10,parts:1,delivered:false},{slot:1,scrap:100,parts:0,delivered:false}];
  assert.equal(api.caravan(m,goal,offers,config,{},null,now).choice.slot,1);
  const state={caravan:{pending:{id:'old',at:now-2*86400000,cost:{scrap:101,parts:0}}}};
  assert.equal(api.caravan(m,goal,offers,config,state,null,now).choice,null);
});
function evidence(){
  const v=campaignView(),e={id:42,residentId:5,tier:0,abyss:false,startedAt:now-7*3600000,recalledAt:null,returnAt:null};
  v.state.residents[4].away={kind:'explore'};v.state.explorers=[e];
  const base={pageId:'original-page',detail:'普通探险区域0，计划6小时；不加速、不进入深渊'},targets=[5,0,2],at=e.startedAt;
  return {v,e,events:[{...base,at:at-100,type:'shelter-submitted',data:{kind:'explore-start',targets}},
    {...base,at:at+1000,type:'request-result',data:{path:'/api/shelter/action',startedAt:at-100,status:200,outcome:'ok',redirected:false}},
    {...base,at:at+3000,type:'shelter-campaign-confirmed',data:{kind:'explore-start',targets,mission:42,at:at+200}},
    {...base,at:at+3001,type:'shelter-confirmed',data:{kind:'explore-start',targets}}]};
}
test('行程恢复：原成功链匹配才恢复旧时长，到点仍优先召回',()=>{
  const {v,e,events}=evidence(),m=api.model(v),trip=api.evidence(m,e,events);assert.equal(trip.hours,6);
  const p=api.plan(m,{explore:true,hours:2,sodaEfficiency:true},{trips:[trip]},14);
  assert.equal(p.choice.kind,'explore-recall');assert.equal(p.trips[0].recallAt,e.startedAt+6*3600000);
});

test('紧急防守优先：来袭与到期召回同时发生，先安排在家成人，战后恢复原召回',()=>{
  const {v,e,events}=evidence(),trip=api.evidence(api.model(v),e,events);
  v.state.rooms.push({id:90,type:'door',floor:1,col:0,width:1,level:1,builtAt:0,upgradeAt:null,
    unpowered:false,stored:0,incident:{kind:'raiders',hp:80,maxHp:80}});
  const config={explore:true,defense:true,hours:6},record={trips:[trip]};
  let plan=api.plan(api.model(v),config,record,14);
  assert.equal(plan.choice.role,'defense');
  assert.ok(plan.actions.every(a=>a.role==='defense'));
  assert.ok(!plan.actions.some(a=>a.id===e.residentId),'不等待或调动外出的探险者');
  v.state.rooms.at(-1).incident=null;
  plan=api.plan(api.model(v),config,record,14);
  assert.equal(plan.choice.kind,'explore-recall');
  assert.equal(plan.trips[0].recallAt,e.startedAt+6*3600000);
});

test('每日建设候选：差一次目标但无可负担升级时，保留已有需求及阻碍',()=>{
  const v=levelGateView();Object.assign(v.state.resources,{scrap:0,food:1,water:1});
  const base={enabled:true,reserved:[],projects:[]};
  const before=api.development(api.model(v),14,base);
  const withDaily=api.development(api.model(v),14,{...base,dailyGoals:{goals:[{
    key:'build',remaining:1,claimed:false,index:0,reward:{scrap:240,parts:2,points:30}}]}});
  assert.ok(before.candidates.length>0,'基线确实存在建设需求');
  for(const candidate of before.candidates)assert.ok(withDaily.candidates.some(c=>c.title===candidate.title),candidate.title);
  assert.notEqual(withDaily.next.status,'none');
  assert.equal(withDaily.next.title,before.next.title);
});
test('行程恢复：拒绝缺链、重复凭据、错账号、错时间、错人物和深渊',()=>{
  const {v,e,events}=evidence(),m=api.model(v);
  for(let i=0;i<events.length;i++)assert.equal(api.evidence(m,e,events.filter((_,j)=>j!==i)),null);
  assert.equal(api.evidence(m,e,[...events,events[2]]),null);
  for(const change of [{residentId:6},{id:43},{startedAt:e.startedAt-60001},{abyss:true}])assert.equal(api.evidence(m,{...e,...change},events),null);
  const wrong=structuredClone(events);wrong[2].data.vaultNo=88;assert.equal(api.evidence(m,e,wrong),null);
  const changed=structuredClone(events);changed[2].detail='unknown';assert.equal(api.evidence(m,e,changed),null);
});
test('行程诊断：无证据外出不接管，显示未管理；原时长不被推荐设置覆盖',()=>{
  const {v,e}=evidence(),m=api.model(v),p=api.plan(m,{explore:true,hours:2},{},14);
  assert.equal(p.trips[0].managed,false);assert.match(p.notes.join('\n'),/没有可核对的原行程/);
  const owned=api.plan(m,{explore:true,hours:2},{trips:[{id:42,resident:5,hours:12,at:e.startedAt}]},14);
  assert.ok(!owned.actions.some(a=>a.kind==='explore-recall'));assert.match(owned.notes.join('\n'),/原计划外出 12 小时/);
});
function raid(){const v=campaignView();v.state.rooms.push({id:90,type:'door',floor:1,col:0,width:1,level:1,builtAt:0,upgradeAt:null,unpowered:false,stored:0,incident:{kind:'raiders',hp:80,maxHp:80}});return v;}
test('防守：健康成人超员增援，零库存与临时停产不阻止退敌',()=>{
  const v=raid(),p=api.defense(api.model(v),{defense:true});assert.equal(p.actions.length,6);
  for(const a of p.actions){assert.equal(a.room,90);assert.equal(a.original,v.state.residents.find(p=>p.id===a.id).roomId);}
  v.state.residents[4].hp=1;assert.ok(!api.defense(api.model(v),{defense:true}).actions.some(a=>a.id===5));
  v.state.resources.power=0;v.state.resources.food=0;v.state.resources.water=0;
  assert.ok([1,2,3].every(id=>api.defense(api.model(v),{defense:true}).actions.some(a=>a.id===id)),'零库存也应撤出供应人员参加退敌');
  v.state.rooms[0].unpowered=true;v.state.rooms[1].type='medbay';
  v.state.residents[2].romance={partnerId:6};
  assert.ok([1,2,3].every(id=>api.defense(api.model(v),{defense:true},{familyReserved:[3]}).actions.some(a=>a.id===id)),
    '停电、特殊值班和感情培养不能阻止紧急增援，原岗位会记录');
});
test('防守：掠夺者入室后直接追击，整场结束才回最初岗位，自动挤出也能复岗',()=>{
  const v=raid(),p=v.state.residents[3];p.roomId=90;const journal={defense:[{id:4,room:90,from:4,at:now-1000}]};
  v.state.rooms.find(r=>r.id===90).incident=null;v.state.rooms[0].incident={kind:'raiders',hp:60,maxHp:80};
  let plan=api.defense(api.model(v),{defense:true},journal);const chase=plan.actions.find(a=>a.id===4);
  assert.equal(chase.room,1);assert.equal(chase.original,4);assert.equal(chase.role,'defense');
  p.roomId=null;v.state.rooms[0].incident=null;journal.defense[0].room=1;
  plan=api.defense(api.model(v),{defense:true},journal);assert.equal(plan.actions.find(a=>a.id===4).room,4);
  p.roomId=5;assert.ok(!api.defense(api.model(v),{defense:true},journal).actions.some(a=>a.id===4));
});
test('防守：暂停、原岗位满员和人工接手不能强行调回',()=>{
  const v=raid();v.state.rooms.find(r=>r.id===90).incident=null;v.state.residents[3].roomId=90;
  const record={defense:[{id:4,room:90,from:4,at:now-1}]};
  assert.equal(api.defense(api.model(v),{defense:false},record).actions.length,0);
  v.state.residents[4].roomId=4;v.state.residents[5].roomId=4;
  assert.ok(!api.defense(api.model(v),{defense:true},record).actions.some(a=>a.id===4));
});
test('防守医疗：受袭房间重伤者先用针，普通增援仍保留且不开新探险',()=>{
  const v=raid();Object.assign(v.state.residents[0],{roomId:90,hp:30});v.state.residents[1].hp=10;
  const plan=api.plan(api.model(v),{defense:true,medical:true,explore:true,reserve:2},{},14);
  assert.equal(plan.choice?.kind,'stimpak');assert.equal(plan.choice?.id,1);
  assert.ok(plan.actions.some(a=>a.role==='defense'));
  assert.ok(plan.actions.every(a=>a.kind==='stimpak'||a.role==='defense'));
  assert.equal(api.plan(api.model(v),{defense:false,medical:true,reserve:2},{},14).choice?.id,2,
    '关闭防守时保留普通医疗按血量比例选择的顺序');
});
test('防守医疗：已有健康增援先行动，全员不足七成时允许治疗后重新评估追击',()=>{
  const v=raid();v.state.residents[0].hp=60;
  const cfg={defense:true,medical:true,reserve:2};
  let plan=api.plan(api.model(v),cfg,{},14);
  assert.equal(plan.choice?.role,'defense');assert.ok(plan.actions.some(a=>a.kind==='stimpak'&&a.id===1));
  for(const p of v.state.residents)p.hp=60;
  plan=api.plan(api.model(v),cfg,{},14);assert.equal(plan.choice?.kind,'stimpak');
  v.state.residents[0].hp=100;
  plan=api.plan(api.model(v),cfg,{heals:[{id:1,at:now}]},14);
  assert.equal(plan.choice?.role,'defense');assert.equal(plan.choice?.id,1);
});
test('隔离防守医疗：原用针涉及者不挡住另一伤员，选人时就扣除原针数预留',()=>{
  const v=raid();Object.assign(v.state.residents[0],{hp:10,roomId:90});Object.assign(v.state.residents[1],{hp:40,roomId:90});
  v.state.resources.stimpak=4;
  const pending={id:'old-needle',kind:'stimpak',targets:[1],vaultNo:77,at:now-1000,before:{serverTime:now-1000},
    result:{status:503,outcome:'http-error',responseFinishedAt:now-1}};
  const cfg={medical:true,defense:true,reserve:2},record={pending,readStartedAt:now};
  let plan=api.plan(api.model(v),cfg,record,14);
  assert.equal(plan.choice?.kind,'stimpak');assert.equal(plan.choice?.id,2);
  v.state.resources.stimpak=3;plan=api.plan(api.model(v),cfg,record,14);
  assert.ok(!plan.actions.some(a=>a.kind==='stimpak'));
  assert.equal(v.state.residents[0].hp,10);assert.equal(v.state.residents[1].hp,40);
});
test('防守医疗：关闭医疗、保留量和近期用针限制不因来袭被绕过',()=>{
  const v=raid();for(const p of v.state.residents)p.hp=30;
  const cfg={defense:true,medical:true,reserve:2};
  assert.ok(!api.plan(api.model(v),{...cfg,medical:false},{},14).actions.some(a=>a.kind==='stimpak'));
  v.state.resources.stimpak=2;
  assert.ok(!api.plan(api.model(v),cfg,{},14).actions.some(a=>a.kind==='stimpak'));
  v.state.resources.stimpak=9;
  const record={heals:v.state.residents.map(p=>({id:p.id,at:now-1799999}))};
  assert.ok(!api.plan(api.model(v),cfg,record,14).actions.some(a=>a.kind==='stimpak'));
  v.serverTime+=2;
  assert.equal(api.plan(api.model(v),cfg,record,14).choice?.kind,'stimpak');
});
test('防守：入室追击允许超过普通房间容量，全部追击保留原岗位',()=>{
  const v=raid();assert.equal(api.defense(api.model(v),{defense:true}).actions.length,6);
  v.state.residents[3].roomId=90;v.state.residents[4].roomId=90;
  const record={defense:[{id:4,room:90,from:4,at:now-1},{id:5,room:90,from:null,at:now-1}]};
  v.state.rooms.find(r=>r.id===90).incident=null;v.state.rooms[0].incident={kind:'raiders',hp:60,maxHp:80};
  let plan=api.defense(api.model(v),{defense:true},record);assert.ok(plan.actions.length>2);assert.ok(plan.actions.every(a=>a.room===1));
  v.state.residents[5].roomId=1;v.state.residents[5].away={kind:'explore'};
  plan=api.defense(api.model(v),{defense:true},record);assert.equal(plan.actions.filter(a=>[4,5].includes(a.id)&&a.room===1).length,2);
});
test('等级规划：按62/66计分，居民经验不凑等级；为锁定工坊选择有生产收益的升级',()=>{
  const v=levelGateView(),m=api.model(v);assert.equal(api.level(m).score,62);assert.equal(api.level(m).next,66);
  v.state.residents[0].xp+=10000;assert.equal(api.level(api.model(v)).score,62);
  const c={enabled:true,reserved:[],projects:[{type:'workshop',person:15,priority:25,benefit:'需要零件'}]};
  const p=api.development(api.model(v),14,c);assert.ok(p.candidates.some(c=>c.levelTarget===5&&c.kind==='upgrade'));
  assert.equal(p.next.project.levelTarget,5);assert.equal(p.next.project.strategy,undefined);assert.notEqual(p.next.status,'blocked');
});
test('等级规划：待产与已开工覆盖缺口就等待，事件中不追加等级消费',()=>{
  const v=levelGateView();v.state.rooms[0].upgradeAt=now+3600000;v.state.births=[{roomId:5,dueAt:now+3600000}];
  const c={enabled:true,reserved:[],projects:[{type:'workshop',person:15,priority:25,benefit:'需要零件'}]};
  const p=api.development(api.model(v),14,c);assert.equal(p.levelProgress.committed,66);
  assert.ok(!p.candidates.some(c=>c.levelTarget));
  v.state.births=[];v.state.rooms[0].upgradeAt=null;v.state.rooms[0].incident={kind:'raiders',hp:70,maxHp:80};
  assert.ok(!api.development(api.model(v),14,c).candidates.some(c=>c.levelTarget));
});
test('持续等级目标：没有锁定建筑仍推进4到5，达到5级后继续规划6级',()=>{
  const v=levelGateView(),campaign={enabled:true,reserved:[],projects:[]};
  let p=api.development(api.model(v),14,campaign,10);
  assert.equal(p.levelProgress.finalTarget,10);
  assert.equal(p.levelProgress.targetLevel,5);
  assert.ok(p.candidates.some(c=>c.levelTarget===5));
  v.state.rooms.find(r=>r.id===1).level=2;v.state.rooms.find(r=>r.id===2).level=2;
  v.progress={level:5,score:66,next:87};
  p=api.development(api.model(v),14,campaign,10);
  assert.equal(p.levelProgress.targetLevel,6);
  assert.equal(p.levelProgress.targetScore,87);
  assert.equal(p.levelProgress.finalTarget,10);
});
test('持续等级目标：生产房满级且人口硬上限已达时，明确等级阻碍而非声称保持生产即可推进',()=>{
  const v=levelGateView();for(const r of v.state.rooms)if(r.type!=='elevator')r.level=3;
  v.state.residents.at(-1).roomId=7;
  v.state.resources={scrap:100,parts:0,power:100,food:100,water:100,stimpak:1};
  v.progress.level=6;
  const p=api.development(api.model(v),14,{enabled:true,reserved:[],projects:[]},10);
  assert.equal(p.next.status,'blocked');assert.equal(p.next.kind,'level');
  assert.match(p.next.reason,/人口目标|设置目标/);assert.match(p.next.reason,/14/);
  assert.equal(p.requestedTarget,14);assert.equal(p.levelProgress.finalTarget,10);
});
test('持续等级目标：在途足够时展示等待路线，人口建议不越过用户设置',()=>{
  const v=levelGateView();v.state.rooms[0].upgradeAt=now+3600000;v.state.births=[{roomId:5,dueAt:now+3600000}];
  const p=api.development(api.model(v),14,{enabled:true,reserved:[],projects:[]},10);
  assert.equal(p.levelProgress.committed,66);
  assert.equal(p.levelProgress.targetLevel,5);assert.equal(p.requestedTarget,14);
  assert.ok(p.routes.some(r=>r.kind==='wait'&&r.score>=66));
  assert.ok(!p.candidates.some(c=>c.levelTarget));
});
test('实际阶段回归：17人口64分的在建发电站足够升5，不必等无关较晚工程，完工后继续规划6级',()=>{
  const v=levelGateView(),s=v.state;
  for(let i=16;i<=17;i++)s.residents.push({...structuredClone(s.residents[0]),id:i,name:`新增居民${i}`,roomId:null,adultAt:now+86400000});
  s.rooms.find(r=>r.id===6).width=1;
  s.rooms.find(r=>r.id===1).upgradeAt=now+2*3600000;
  s.rooms.push({...s.rooms[0],id:90,type:'storage',width:1,floor:4,col:2,builtAt:now+6*3600000,upgradeAt:null});
  const campaign={enabled:true,reserved:[],projects:[]};
  let p=api.development(api.model(v),14,campaign,10);
  assert.equal(p.levelProgress.score,64);assert.equal(p.levelProgress.committed,67);
  const wait=p.routes.find(r=>r.kind==='wait');assert.equal(wait.hours,2);assert.equal(wait.score,66);
  assert.ok(!p.candidates.some(c=>c.levelTarget));
  v.serverTime=now+2*3600000;s.lastSettledAt=v.serverTime;s.rooms[0].level=2;s.rooms[0].upgradeAt=null;v.progress.level=5;
  p=api.development(api.model(v),14,campaign,10);
  assert.equal(p.levelProgress.level,5);assert.equal(p.levelProgress.targetLevel,6);
  assert.equal(p.levelProgress.finalTarget,10);
});

test('等级路线：两项工程不重复花同一份废料，第二项等待整批到账，原始状态不变',()=>{
  const v=levelGateView(),before=JSON.stringify(v),m=api.model(v),p=api.development(m,14,api.plan(m,{defense:true}),10);
  const route=p.routes.find(r=>r.complete);assert.ok(route);
  assert.ok(route.steps.length>=2&&route.steps.length<=3);
  assert.ok(route.cost>v.state.resources.scrap,'验证包含需要额外攒料的路线');
  assert.ok(route.steps[1].startHours>route.steps[0].finishHours,'第二项等待新产出');
  assert.equal(new Set(route.steps.map(s=>s.project.id)).size,route.steps.length);
  assert.equal(JSON.stringify(v),before,'规划不得修改真实快照');
  assert.match(p.populationAdvice,/目标 14.*调到 17.*修改人口目标/);
});
test('等级路线：仓库只剩10空间时不能把30废料整批拆成10来凑开工资金',()=>{
  const v=levelGateView();v.state.resources.scrap=90;
  const m=api.model(v);m.caps.scrap=100;
  for(const r of m.rooms.filter(r=>r.resource==='scrap')){r.stored=30;r.batch=30;r.rate=60;}
  const c={kind:'upgrade',type:'diner',id:2,level:2,levelGain:2,hours:1,cost:{scrap:100,parts:0},blocks:[]};
  assert.equal(api.routes(m,[c],64).length,0,'执行层拒绝溢出的整批，规划不能虚构可领取的零头');
  m.caps.scrap=200;const route=api.routes(m,[c],64)[0];assert.ok(route?.complete);
});

test('路线需求：扩容已解除满仓压力时不重复扩仓凑分，完整路线仍由有用途工程达级',()=>{
  const v=capacityRouteView(),m=api.model(v),before=JSON.stringify(v);
  const p=api.development(m,14,{enabled:true,reserved:[],projects:[]},10);
  assert.ok(p.routes.some(r=>r.complete),'仍应找到扩仓后攒料升级医务室的可行路线');
  for(const route of p.routes){
    assert.ok(route.steps.filter(x=>x.project.type==='storage').length<=1,JSON.stringify(route));
    if(route.complete)assert.ok(route.steps.some(x=>x.project.type==='medbay'),'不能靠已不需要的第二项扩仓声称到7级');
  }
  assert.equal(JSON.stringify(v),before);
});

test('路线需求：装备扩容后仍接近满仓时保留第二项扩仓，充足后不再沿用旧需求',()=>{
  const v=storageChoiceView();v.state.resources.scrap=1000;
  const campaign={enabled:true,reserved:[],projects:[]};
  let p=api.development(api.model(v),14,campaign,10);
  assert.ok(p.routes.every(r=>r.steps.filter(x=>x.project.type==='storage').length<=1));
  v.state.items.push(...Array.from({length:14},(_,i)=>({id:2000+i,slot:'weapon',damage:[0,0]})));
  p=api.development(api.model(v),14,campaign,10);
  assert.ok(p.routes.some(r=>r.steps.filter(x=>x.project.type==='storage').length===2),'185件装备扩容到200格后仍达90%，第二项需求仍在');
});

test('路线需求：先消费材料已解除满仓压力时，不再把旧扩仓需求列入后续步骤',()=>{
  const v=capacityRouteView(),m=api.model(v);
  const p=api.development(m,14,{enabled:true,reserved:[],projects:[]},10);
  const storage=p.candidates.find(c=>c.type==='storage'&&c.kind==='build');assert.ok(storage);
  const first={kind:'upgrade',type:'scrap',id:4,level:3,hours:3,cost:{scrap:480,parts:15},levelGain:1,blocks:[]};
  const routes=api.routes(m,[first,{...storage,levelGain:1}],111,first);
  assert.ok(routes.length);assert.ok(routes.every(r=>r.steps.length===1),'回收站升级已降低库存占比，后续应按实际变化再评估扩仓');
});

test('路线容量：仓库升级完工后按新增容量攒后续工程本金，真实库存和容量不变',()=>{
  const v=capacityRouteView(),m=api.model(v),before=JSON.stringify(m);
  assert.equal(api.level(m).score,108);assert.equal(m.caps.scrap,3600);
  const first={kind:'upgrade',type:'storage',id:90,level:2,hours:1,cost:{scrap:200,parts:0},levelGain:1,blocks:[]};
  const second={kind:'upgrade',type:'medbay',id:7,level:3,hours:6,cost:{scrap:3600,parts:30},levelGain:2,blocks:[]};
  const route=api.routes(m,[first,second],111,first).find(r=>r.complete);
  assert.ok(route,'completed storage must allow the next full batch to fund the medbay');
  assert.equal(route.steps.length,2);assert.ok(route.steps[1].startHours>route.steps[0].finishHours);
  assert.equal(route.cost,200+3600+6*30);assert.equal(JSON.stringify(m),before);
});

test('路线容量：生产房升级增加的专属容量和仓储传承取整同样在完工后生效',()=>{
  const v=capacityRouteView();v.state.resources.parts=45;v.state.legacy.perks.storage=1;
  const m=api.model(v),first={kind:'upgrade',type:'scrap',id:4,level:3,hours:3,cost:{scrap:480,parts:15},levelGain:1,blocks:[]};
  const second={kind:'upgrade',type:'medbay',id:7,level:3,hours:6,cost:{scrap:3780,parts:30},levelGain:2,blocks:[]};
  // 第二项用容量边界费用隔离传承取整；实际医务室造价由前后两项真实参数场景覆盖。
  assert.equal(m.caps.scrap,3780);
  assert.ok(api.routes(m,[first,second],111,first).some(r=>r.complete));
});

test('路线容量：新仓库完工可支撑后续原医务室升级，但不能提前使用新增容量',()=>{
  const v=capacityRouteView(),m=api.model(v);
  const first={kind:'build',type:'storage',floor:4,col:3,hours:1/6,cost:{scrap:96,parts:0},levelGain:1,gain:0,blocks:[]};
  const second={kind:'upgrade',type:'medbay',id:7,level:3,hours:6,cost:{scrap:3600,parts:30},levelGain:2,blocks:[]};
  const route=api.routes(m,[first,second],111,first).find(r=>r.complete);assert.ok(route);
  assert.ok(route.steps[1].startHours>=first.hours);assert.equal(route.cost,3696+6*30);
});

test('路线合并：新仓库将与原仓库合并时，不沿用原一格仓库的后续升级费用与工期',()=>{
  const v=capacityRouteView(),m=api.model(v);
  const first={kind:'build',type:'storage',floor:4,col:3,hours:1/6,cost:{scrap:96,parts:0},levelGain:1,gain:0,blocks:[]};
  const obsolete={kind:'upgrade',type:'storage',id:90,level:2,hours:1,cost:{scrap:200,parts:0},levelGain:1,blocks:[]};
  const routes=api.routes(m,[first,obsolete],111,first);
  assert.ok(routes.length);assert.ok(routes.every(r=>r.steps.length===1),'after merging, recalculate the new room from an actual snapshot');
});

test('路线合并：原仓库已达三格时新房不会合并，仍可比较原仓库的后续升级',()=>{
  const v=capacityRouteView();v.state.rooms.find(r=>r.id===90).width=3;v.progress.score=110;
  const m=api.model(v),first={kind:'build',type:'storage',floor:4,col:5,hours:1/6,cost:{scrap:128,parts:0},levelGain:1,gain:0,blocks:[]};
  const upgrade={kind:'upgrade',type:'storage',id:90,level:2,hours:3,cost:{scrap:600,parts:0},levelGain:3,blocks:[]};
  const complete=api.routes(m,[first,upgrade],114,first).find(r=>r.complete);
  assert.ok(complete);assert.equal(complete.steps.length,2);assert.equal(complete.cost,728);
});

test('路线容量：施工期间仍按旧容量积料，完工后才能收进被原容量挡住的整批',()=>{
  const v=capacityRouteView(),m=api.model(v);
  // 延长第一项时长只为隔离生效时间，不将20小时当成一格仓库的真实工期。
  const first={kind:'upgrade',type:'storage',id:90,level:2,hours:20,cost:{scrap:200,parts:0},levelGain:1,blocks:[]};
  const second={kind:'upgrade',type:'medbay',id:7,level:3,hours:6,cost:{scrap:3600,parts:30},levelGain:2,blocks:[]};
  const route=api.routes(m,[first,second],111,first).find(r=>r.complete);assert.ok(route);
  assert.ok(Math.abs(route.steps[1].startHours-(20+1/6))<1e-8);
});

test('路线合并批量：新生产房并入一格同类房后按两格大批量等待，不能拆成两个小批提前筹款',()=>{
  for(const automatic of [false,true]){
  const v=upperStageView(),s=v.state;s.resources.scrap=0;
  s.handies=automatic?[{id:1,floor:7}]:[];
  s.rooms.push({...s.rooms[0],id:301,type:'scrap',floor:7,col:2,width:1,level:1,stored:0});
  v.progress={level:6,score:97,next:111};
  const m=api.model(v);for(const r of m.rooms.filter(r=>r.resource==='scrap')){r.rate=0;r.stored=0;}
  // 候选费用仅用于隔离合并后的批量时点；不用这组费用代表网站真实建筑价格。
  const first={kind:'build',type:'scrap',floor:7,col:3,hours:1/6,cost:{scrap:0,parts:0},gain:60,levelGain:1,blocks:[]};
  const second={kind:'upgrade',type:'power',id:1,level:3,hours:1,cost:{scrap:30,parts:0},levelGain:2,blocks:[]};
  const route=api.routes(m,[first,second],100,first).find(r=>r.complete);assert.ok(route);
  assert.ok(Math.abs(route.steps[1].startHours-(1+1/6))<1e-8,'merged room needs a 60-token batch, not 30');
  }
});
test('探险幸运：同战力优先有效幸运，不为幸运降低战力或改变汽水概率',()=>{
  const v=campaignView(),cfg={explore:true,hours:6,tier:0,stimpaks:2,reserve:2};
  v.state.residents[3].away={kind:'quest'};v.state.residents[4].stats.lck=1;v.state.residents[5].stats.lck=9;
  let p=api.plan(api.model(v),cfg,{},14);assert.equal(p.actions.find(a=>a.kind==='explore-start').id,6);
  v.state.residents[4].stats.str=9;p=api.plan(api.model(v),cfg,{},14);assert.equal(p.actions.find(a=>a.kind==='explore-start').id,5);
});
test('工坊：当前升级缺零件时预留值班人选，材料备齐或缺供料后释放自动岗位',()=>{
  const v=campaignView(),s=v.state;
  s.rooms.find(r=>r.id===4).level=2;s.residents[4].roomId=4;s.residents[5].roomId=5;s.resources.parts=0;
  s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1});
  let p=api.plan(api.model(v),{workshop:true,partsTarget:15,workshopScrapReserve:100});
  const a=p.actions.find(a=>a.role==='workshop');assert.ok(a);assert.equal(a.room,90);
  s.residents.find(p=>p.id===a.id).roomId=90;
  const record={roles:[{id:a.id,room:90,role:'workshop',at:now-1}]};
  p=api.plan(api.model(v),{workshop:true,partsTarget:15,workshopScrapReserve:100},record);
  assert.ok(p.reserved.includes(a.id));assert.ok(!p.actions.some(a=>a.role==='workshop-release'));
  s.resources.parts=15;p=api.plan(api.model(v),{workshop:true,partsTarget:15,workshopScrapReserve:100},record);
  assert.ok(p.actions.some(a=>a.id===record.roles[0].id&&a.role==='workshop-release'&&a.room===null));
  s.resources.parts=0;s.resources.scrap=100;
  assert.ok(api.plan(api.model(v),{workshop:true,partsTarget:15,workshopScrapReserve:100},record).actions.some(a=>a.role==='workshop-release'));
  assert.ok(!api.plan(api.model(v),{workshop:true,partsTarget:15,workshopScrapReserve:100},{}).actions.some(a=>a.role==='workshop-release'),'不撤销人工工坊岗位');
});

test('工坊整批备料：差1零件不能把未满批库存当到账，保留工人直到整批可收',()=>{
  const v=campaignView(),s=v.state;s.resources.parts=14;
  s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1,stored:1});s.residents[4].roomId=90;
  const cfg={workshop:true,partsTarget:15,workshopScrapReserve:100},record={roles:[{id:5,room:90,role:'workshop',at:now-1}]};
  let p=api.plan(api.model(v),cfg,record);
  assert.ok(!p.actions.some(a=>a.role==='workshop-release'));assert.ok(p.reserved.includes(5));
  s.rooms.at(-1).stored=3;p=api.plan(api.model(v),cfg,record);
  assert.ok(p.actions.some(a=>a.role==='workshop-release'),'整批可收时不继续加工');
});

test('工坊整批备料：完批供料不得动用建设资金和保留线，刚够下一批时才安排',()=>{
  const v=campaignView(),s=v.state;s.resources.parts=14;s.resources.scrap=711;
  s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1,stored:1});
  const cfg={workshop:true,partsTarget:15,workshopScrapReserve:700};
  assert.ok(!api.plan(api.model(v),cfg).actions.some(a=>a.role==='workshop'));
  s.resources.scrap=712;assert.ok(api.plan(api.model(v),cfg).actions.some(a=>a.role==='workshop'));
});
test('每日目标：读取网站目标及计数，奖励不提前计入库存，损坏数据不猜测',()=>{
  const v=campaignView();v.state.daily={day:'2026-11-05',claimed:[],counters:{build:1,win:1,collect_scrap:405},
    picks:[['build',2],['win',5],['collect_scrap',600]].map(([key,target])=>({key,target,reward:{scrap:240,parts:2,points:30}}))};
  const m=api.model(v),p=api.daily(m);assert.deepEqual(Array.from(p.goals,g=>g.remaining),[1,4,195]);
  assert.equal(m.state.resources.scrap,3000);assert.match(p.notes.join('\n'),/不保证战斗必胜/);
  v.state.daily.counters.win=-1;assert.equal(api.daily(api.model(v)).goals.length,0);
});
test('每日训练：达到普通目标仍可为每日目标练一格，达标后不继续额外训练',()=>{
  const v=campaignView();v.state.rooms.push({...v.state.rooms[0],id:90,type:'training',trainStat:'agi',floor:2,col:4});
  v.state.daily.picks=['train','craft','caravan'].map(key=>({key,target:1,reward:{scrap:240,parts:2,points:30}}));v.state.daily.counters={};
  const cfg={dailyGoals:true,training:true,trainTarget:6};
  let p=api.plan(api.model(v),cfg);assert.ok(p.actions.some(a=>a.role==='training'));
  v.state.daily.counters.train=1;p=api.plan(api.model(v),cfg);assert.ok(!p.actions.some(a=>a.role==='training'));
  assert.match(p.notes.join('\n'),/商队目标需开启每日商队开关/);
});
test('每日收集：保留零点前所需产能，达标后允许原人选外出；防守不受该预留影响',()=>{
  const v=campaignView(Date.parse('2026-11-05T23:30:00+08:00'));
  v.state.daily={day:'2026-11-05',claimed:[],counters:{},picks:['collect_scrap','craft','caravan'].map(key=>({key,target:600,reward:{scrap:240,parts:2,points:30}}))};
  const cfg={dailyGoals:true,explore:true,tier:0,hours:6,stimpaks:2,reserve:2};
  let p=api.plan(api.model(v),cfg);assert.ok(!p.actions.some(a=>a.kind==='explore-start'&&a.id===4));assert.match(p.notes.join('\n'),/保留 1 名现有产出人员/);
  v.state.daily.counters.collect_scrap=600;p=api.plan(api.model(v),cfg);assert.doesNotMatch(p.notes.join('\n'),/保留 1 名现有产出人员/);
  v.state.daily.counters.collect_scrap=0;v.state.rooms[1].incident={kind:'raiders',hp:80,maxHp:80};
  p=api.plan(api.model(v),{...cfg,defense:true});assert.ok(p.actions.some(a=>a.role==='defense'&&a.id===4));
});

test('每日收集整批：日志场景剩195而每批135，产量够195仍必须提示实际只能收135',()=>{
  const v=campaignView(Date.parse('2026-11-05T18:51:00+08:00'));
  v.state.daily={day:'2026-11-05',claimed:[],counters:{collect_scrap:405},picks:['collect_scrap','craft','caravan'].map(key=>({key,target:600,reward:{scrap:240,parts:2,points:30}}))};
  const m=api.model(v),room=m.rooms.find(r=>r.resource==='scrap');
  Object.assign(room,{stored:79,batch:135,rate:25});
  const p=api.plan(m,{dailyGoals:true});
  assert.match(p.notes.join('\n'),/整批.*135/);
  assert.match(p.notes.join('\n'),/仍差 60/);
});

test('每日收集整批：不同房间的零头不能合并，整批已足够才释放人员',()=>{
  const v=campaignView(Date.parse('2026-11-05T23:59:00+08:00'));
  v.state.daily={day:'2026-11-05',claimed:[],counters:{collect_scrap:405},picks:['collect_scrap','craft','caravan'].map(key=>({key,target:600,reward:{scrap:240,parts:2,points:30}}))};
  const m=api.model(v),r=m.rooms.find(r=>r.resource==='scrap');Object.assign(r,{stored:130,batch:135,rate:0});
  m.rooms.push({...r,id:99,stored:100});
  let p=api.plan(m,{dailyGoals:true});assert.match(p.notes.join('\n'),/仍差 195/);
  r.stored=270;p=api.plan(m,{dailyGoals:true});assert.doesNotMatch(p.notes.join('\n'),/仍差/);
  assert.doesNotMatch(p.notes.join('\n'),/保留 \d+ 名现有产出人员/);
});
