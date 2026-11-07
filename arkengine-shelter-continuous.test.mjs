import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {upperStageView} from './arkengine-shelter-campaign.fixture.mjs';

const source=readFileSync(new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const segment=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
const declarations=['shelterRooms','shelterBuildRules','campaignDefaults'].map(n=>source.match(new RegExp(`const ${n}\\s*=[^;]*;`))[0]).join('\n');
const implementation=[declarations,segment('  function shelterWorkerRate(','  function readShelter('),
  segment('  const staffRoomTypes =','  function shelterExploreStep('),
  segment('  function shelterCampaignSchedule(','  function shelterDailyClaimStep('),
  segment('  function recordShelterCampaign(','  function shelterFormValue('),
  segment('  function shelterConstructionChoice(','  function shelterBuildTitle(')].join('\n');

test('连续发展模拟：固定15人口、满针不反复扩仓，自产四项升级后保留关闭新建的约束',()=>{
  // 此场景只授权最初的一间工坊，随后关闭新建，专验四项已有工程的连续备料。
  // 多工坊扩产另有完整人口追级场覆盖；这里不模拟随机来袭/生育/奖励，不代表实号耗时。
  const v=upperStageView(Date.parse('2026-11-06T00:00:00Z')),s=v.state,start=v.serverTime;
  s.resources.stimpak=60;
  const context={objectState:x=>x!==null&&typeof x==='object'&&!Array.isArray(x),
    shelterResources:{power:'电力',food:'食物',water:'净水',scrap:'废料',parts:'零件',stimpak:'治疗针'},
    shelterStaffMode:'production',shelterStaffHold:'',shelterOptimize:false,shelterGear:false,shelterPopulationTarget:14,shelterLevelTarget:10,
    shelterConstruction:{build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:0,partsReserve:0},
    shelterState:{campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}},shelterPending:null,shelterRead:null,shelterCaravanNote:'',
    shelterConstructionNote:'',shelterStaffNote:'',shelterPopulationNote:'',shelterSocialNote:'',
    Date:{now:()=>v.serverTime},crypto:{randomUUID:()=>String(v.serverTime)},log:{add:()=>{}},workshopAutomatic:()=>true};
  context.saveShelter=x=>context.shelterState=x;
  const api=vm.runInNewContext(`${implementation}\nshelterCampaign={...campaignDefaults};
    ({model:shelterModel,staff:shelterStaffPlan,campaign:shelterCampaignSchedule,record:recordShelterCampaign,
      development:shelterDevelopmentPlan,construction:shelterConstructionChoice,valid:validCampaignRecord})`,context);
  // 单独按公开基础公式结算，不复用规划器的路线预测来补库存。每十分钟尝试整批领取。
  const rules={power:['str','power',12,30],diner:['agi','food',8,25],water:['per','water',8,25],
    scrap:['end','scrap',8,30],medbay:['int','stimpak',.5,2],workshop:['int','parts',.6,3]},mult=[0,1,1.5,2.1];
  const actions=[];let partsProduced=0,partsCollected=0,partsSpent=0,feedSpent=0,completed=0;
  for(let tick=0;tick<160*6;tick++){
    for(let decision=0;decision<10;decision++){
      const m=api.model(v),action=api.campaign(m).choice||api.staff(m);
      if(!action)break;
      assert.ok(decision<9,'unchanged state cannot alternate staffing indefinitely');
      assert.ok(!action.kind||action.kind==='assign');
      actions.push({at:v.serverTime,...action});s.residents.find(p=>p.id===action.id).roomId=action.room;
      if(action.role)api.record({kind:'assign',targets:[action.id,action.room],before:{campaign:{choice:action}},
        result:{campaignProof:{at:v.serverTime}}},api.model(v));
    }
    // 反序列化检查持久化归属；真实页面刷新另由浏览器测试覆盖。
    if(tick%36===0){context.shelterState=JSON.parse(JSON.stringify(context.shelterState));assert.ok(api.valid(context.shelterState.campaign));}
    const c=api.construction(api.model(v));
    if(c){
      actions.push({at:v.serverTime,...c});assert.ok(s.resources.scrap>=c.cost.scrap&&s.resources.parts>=c.cost.parts);
      s.resources.scrap-=c.cost.scrap;s.resources.parts-=c.cost.parts;partsSpent+=c.cost.parts;
      (context.shelterState.constructionLedger??=[]).push({id:String(v.serverTime),at:v.serverTime,...c.cost});
      if(c.kind==='upgrade'){
        if(actions.filter(a=>a.kind==='upgrade').length===1)assert.equal(c.id,1,'the funded material project must be the first upgrade');
        assert.equal(c.id,context.shelterState.campaign.materials?.id,'each funded material project must retain its identity');
        const r=s.rooms.find(r=>r.id===c.id);r.upgradeAt=v.serverTime+r.width*(r.level===1?1:3)*3600000;
        delete context.shelterState.campaign.materials; // 实际确认后的清理由浏览器测试断言。
      }else{
        assert.equal(c.kind,'build');assert.equal(c.type,'workshop','no arbitrary rooms supplied by the simulator');
        assert.equal(s.rooms.some(r=>r.type==='workshop'),false);
        s.rooms.push({id:108,type:c.type,floor:c.floor,col:c.col,width:1,level:1,builtAt:v.serverTime+600000,
          upgradeAt:null,stored:0,incident:null,unpowered:false});
        context.shelterConstruction.build=false;
      }
    }
    const m=api.model(v);
    for(const [k,need] of Object.entries(m.demand))s.resources[k]-=need/6;
    for(const r of s.rooms){
      const rule=rules[r.type];if(!rule||r.builtAt>v.serverTime||r.upgradeAt!==null||r.incident||r.unpowered)continue;
      const [stat,k,base,batchBase]=rule,batch=batchBase*r.width*mult[r.level];
      const workers=s.residents.filter(p=>p.roomId===r.id&&p.away===null&&p.deadAt===null&&p.adultAt<=v.serverTime).slice(0,r.width*2);
      let made=Math.min(4*batch-r.stored,workers.reduce((n,p)=>n+base*mult[r.level]*(.5+p.stats[stat]/10)*
        (.6+.4*p.happiness/100)*(1+(Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))-1)*.01),0)/6);
      if(k==='parts'){made=Math.min(made,Math.max(0,s.resources.scrap)/6);s.resources.scrap-=6*made;partsProduced+=made;feedSpent+=6*made;}
      r.stored+=made;const take=Math.floor((r.stored+1e-9)/batch)*batch;
      if(s.resources[k]+take<=m.caps[k]){s.resources[k]+=take;r.stored-=take;if(k==='parts')partsCollected+=take;}
    }
    v.serverTime+=600000;s.lastSettledAt=v.serverTime;
    for(const r of s.rooms)if(r.upgradeAt!==null&&r.upgradeAt<=v.serverTime){r.upgradeAt=null;r.level++;completed++;}
    const score=2*s.residents.length+3*s.depth+s.rooms.filter(r=>r.builtAt<=v.serverTime&&!['door','elevator'].includes(r.type))
      .reduce((n,r)=>n+r.width*r.level,0);let level=1;while(score>=30+Math.ceil(2.25*level*level))level++;
    v.progress={level,score,next:30+Math.ceil(2.25*level*level)};
    assert.ok(Object.values(s.resources).every(n=>n>=-1e-6),'production and construction must not exhaust basic supplies');
    if(completed>=4)break;
  }
  assert.equal(completed,4,'all four funded production upgrades must finish within this simulation');
  const shifts=actions.filter(a=>a.role==='workshop'),upgrades=actions.filter(a=>a.kind==='upgrade');
  assert.ok(shifts.length<=upgrades.length*2,'each of the four material projects may staff the two existing workshop slots');
  assert.equal(new Set(shifts.map(a=>`${a.materials.id}:${a.materials.level}:${a.id}`)).size,shifts.length,
    'the same worker must not be repeatedly assigned for the same unchanged material project');
  assert.ok(actions.filter(a=>a.role==='workshop-release').length<=shifts.length);
  assert.deepEqual(actions.filter(a=>a.kind==='upgrade').map(a=>a.id),[1,2,3,7]);
  assert.equal(partsSpent,105);assert.ok(partsCollected>=partsSpent);
  assert.equal(s.resources.parts,partsCollected-partsSpent);assert.ok(Math.abs(feedSpent-6*partsProduced)<1e-6);
  assert.ok(s.rooms.filter(r=>[1,2,3,7].includes(r.id)).every(r=>r.level===3));
  assert.equal(v.progress.score,104);assert.equal(v.progress.level,6);
  const m=api.model(v),next=api.development(m,14,api.campaign(m),10);
  assert.equal(next.levelProgress.targetLevel,7);assert.notEqual(next.next.project?.id,1);
  assert.equal(next.next.status,'ready');assert.equal(next.next.project.type,'storage');
  assert.equal(next.next.project.levelInvestment,true);assert.equal(context.shelterConstruction.build,false);
  assert.equal(api.construction(m),null,'等级投资不能绕过已经关闭的新建开关');
  assert.equal(next.levelProgress.targetScore-next.levelProgress.committed,7);
  assert.match(next.populationAdvice,/15.*目标 14.*19 人/);
  assert.match(next.populationAdvice,/自动防守未开启/);assert.doesNotMatch(next.populationAdvice,/可评估调到/);
  assert.ok(v.serverTime>start+24*3600000);
  assert.equal(s.residents.length,15);assert.equal(context.shelterPopulationTarget,14);
});
