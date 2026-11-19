import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {setupParentPreparation,parentPreparationScene} from './arkengine-shelter-parent-preparation.fixture.mjs';
const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
const plain=x=>JSON.parse(JSON.stringify(x));
const training=p=>p.actions.filter(a=>a.preparation);

test('父母预培养：失效宿舍释放被动家庭，真实感情、待产和当前训练保留',()=>{
  for(const protection of ['none','romance','birth','unknown-birth','training']){
    const x=setupParentPreparation(source),s=x.f.view.state;
    x.context.shelterState.families=[{a:4,b:5,room:999}];
    if(protection==='romance')s.residents.find(p=>p.id===4).romance={partnerId:5};
    if(protection==='birth')s.births=[{roomId:999,parents:[4,5],dueAt:x.m().now+3600000}];
    if(protection==='unknown-birth')s.births=[{roomId:999,dueAt:x.m().now+3600000}];
    if(protection==='training'){
      s.residents.find(p=>p.id===4).roomId=93;
      x.context.shelterState.campaign.roles=[{id:4,room:93,role:'training',purpose:'parent',stat:'cha',base:3,at:x.m().now,until:x.m().now+3600000}];
    }
    assert.equal(x.api.remember(x.m()).length,protection==='none'?0:1,protection);
  }
});

test('父母预培养：旧家庭优先质量而非编号，祖先数据保持不变',()=>{
  const x=setupParentPreparation(source),s=x.f.view.state,before=JSON.stringify(s);
  x.context.shelterState.families=[{a:8,b:9,room:7},{a:4,b:5,room:5}];
  assert.deepEqual(plain(x.api.remember(x.m())).map(f=>f.a),[4,8]);assert.equal(JSON.stringify(s),before);
});

test('父母预培养：保存两对无亲缘候选，未达标不生育且刷新不换人',()=>{
  const x=setupParentPreparation(source),plan=x.schedule(),saved=plain(x.context.shelterState.parentPreparation);
  assert.equal(saved.pairs.length,2);assert.equal(x.api.validPreparation(saved),true);
  assert.deepEqual(saved.pairs.flatMap(f=>[f.a,f.b]),[4,5,6,7]);
  assert.equal(training(plan).length,1);assert.equal(training(plan)[0].stat,'cha');
  assert.equal(x.api.pairAllowed(x.m(),x.f.view.state.residents.filter(p=>[4,5].includes(p.id)),saved),false);
  x.f.view.state.residents.find(p=>p.id===9).stats.lck=10;x.tick();x.schedule();
  assert.deepEqual(plain(x.context.shelterState.parentPreparation),saved);
  const reloaded=setupParentPreparation(source,{...x.f,state:plain(x.context.shelterState)});reloaded.schedule();
  assert.deepEqual(plain(reloaded.context.shelterState.parentPreparation),saved);
});

test('父母预培养：无冷却也能训练，同家庭串行、另一对可接续，回执保留用途和返岗',()=>{
  const x=setupParentPreparation(source),first=training(x.schedule())[0];assert.ok(first);x.apply(first);
  assert.equal(x.api.valid(x.context.shelterState.campaign),true);
  assert.equal(x.context.shelterState.campaign.roles[0].preparation,true);
  x.tick();const next=x.schedule();
  assert.ok(!next.actions.some(a=>a.id===first.id&&a.role==='training-release'));
  assert.equal(training(next)[0]?.id,6,'other pair can use the remaining seat');
  assert.ok(!training(next).some(a=>a.id===5),'same pair cannot enter together');
  const p=x.f.view.state.residents.find(p=>p.id===first.id);p.stats.cha=4;p.training=0;x.tick();
  const release=x.schedule().actions.find(a=>a.id===p.id&&a.role==='training-release');assert.equal(release?.room,4);
  x.apply(release);x.tick();assert.equal(x.context.shelterState.campaign.roles.some(r=>r.id===p.id),false);
});

test('父母预培养：共同供给不足不追加，真实断供返岗而非继续培养',()=>{
  const x=setupParentPreparation(source),a=training(x.schedule())[0];x.apply(a);
  x.f.view.state.resources.food=0;x.tick();const plan=x.schedule();
  assert.equal(training(plan).length,0);assert.ok(plan.actions.some(r=>r.id===a.id&&r.role==='training-release'));
});

test('父母预培养：双方七项均达10才放行，装备和另一位高属性不能抵消短板',()=>{
  const x=setupParentPreparation(source);x.schedule();const saved=x.context.shelterState.parentPreparation;
  const pair=x.f.view.state.residents.filter(p=>[4,5].includes(p.id));
  pair[0].stats.cha=10;assert.equal(x.api.pairAllowed(x.m(),pair,saved),false);
  pair.forEach(person=>Object.keys(person.stats).forEach(stat=>person.stats[stat]=10));
  assert.equal(x.api.pairAllowed(x.m(),pair,saved),true);
  pair[1].stats.lck=9;pair[1].outfitId=999;x.f.view.state.items.push({id:999,slot:'outfit',bonus:{lck:10}});
  assert.equal(x.api.pairAllowed(x.m(),pair,saved),false);
  assert.equal(x.api.pairAllowed(x.m(),[pair[0],x.f.view.state.residents.find(p=>p.id===7)],saved),false);
});

test('父母预培养：亲缘不完整或共同祖先均不录用，不借训练绕过关系保护',()=>{
  const x=setupParentPreparation(source),s=x.f.view.state;
  s.residents.find(p=>p.id===5).parents=[1,2];s.residents.find(p=>p.id===4).parents=[1,2];
  s.residents.find(p=>p.id===6).parents=[999,998];x.schedule();
  assert.ok(!x.context.shelterState.parentPreparation.pairs.some(f=>f.a===4&&f.b===5||[f.a,f.b].includes(6)));
});

test('父母预培养：缺少目标属性训练室时请求补建，居民继续生产',()=>{
  const x=setupParentPreparation(source);x.f.view.state.rooms=x.f.view.state.rooms.filter(r=>r.trainStat!=='cha');
  for(const person of x.f.view.state.residents.filter(person=>[4,5,6,7].includes(person.id)))
    for(const stat of Object.keys(person.stats))if(stat!=='cha')person.stats[stat]=10;
  const plan=x.schedule();assert.equal(training(plan).length,0);
  assert.ok(plan.projects.some(p=>p.type==='training'&&p.trainStat==='cha'&&!p.trainingDeadline));
  assert.ok(x.f.view.state.residents.filter(p=>[4,5,6,7].includes(p.id)).every(p=>p.roomId===4));
  Object.assign(x.context.shelterConstruction,{build:true,upgrade:true,dig:true});
  const m=x.m(),campaign=x.schedule(),development=x.api.development(m,18,campaign,null);
  assert.equal(development.next.status,'ready');assert.equal(development.next.project.type,'training');
  assert.equal(development.next.project.trainStat,'cha');
});

test('父母预培养：未知请求、人工暂停与防守期间不选择或改写候选',()=>{
  for(const kind of ['pending','hold','defense']){
    const x=setupParentPreparation(source);
    if(kind==='pending')x.context.shelterPending={id:'unknown'};
    if(kind==='hold')x.context.shelterStaffHold='manual';
    if(kind==='defense')x.context.shelterState.campaign.defense=[{id:4,room:1,from:4,at:x.m().now}];
    if(kind==='defense')x.schedule();else x.api.update(x.m());
    assert.equal(x.context.shelterState.parentPreparation,undefined,kind);
  }
});

test('父母预培养：旧家庭实际返宿舍选择高属性组合，不再优先小编号',()=>{
  const x=setupParentPreparation(source);Object.assign(x.context.shelterCampaign,{training:false,parentPreparation:false});
  x.context.shelterState.families=[{a:4,b:5,room:5},{a:8,b:9,room:7}];
  for(const p of x.f.view.state.residents.filter(p=>[8,9].includes(p.id)))p.stats.cha=6;
  const a=x.api.staff(x.m());assert.equal(a.id,8);assert.equal(a.room,7);assert.match(a.reason,/原配对返回/);
});

test('父母预培养：已达标稳定组合可接替略低属性旧家庭，不再被20%门槛卡住',()=>{
  const x=setupParentPreparation(source);x.schedule();const pair=x.f.view.state.residents.filter(p=>[4,5].includes(p.id));
  pair.forEach(person=>Object.keys(person.stats).forEach(stat=>person.stats[stat]=10));
  const m=x.m(),families=x.context.shelterState.families,c=x.api.pairing(m,families,()=>true);
  // The only usable dorm belongs to the lower-quality bridge family.
  c.rooms=c.rooms.filter(r=>r.id===7);
  const choice=x.api.pairChoice(m,families,c,pair,x.api.assessment(m,pair));
  assert.equal(choice?.room.id,7);assert.equal(choice.replacedFamilies.length,1);
});

test('父母预培养：不拆已有入训家庭的伴侣去组新候选，关闭后保留原用途收尾',()=>{
  const x=setupParentPreparation(source),s=x.f.view.state;
  x.context.shelterState.families=[{a:4,b:5,room:5}];s.residents.find(p=>p.id===4).roomId=93;
  x.context.shelterState.campaign.roles=[{id:4,room:93,role:'training',purpose:'parent',stat:'cha',base:3,at:x.m().now,until:x.m().now+3600000}];
  x.schedule();assert.ok(!x.context.shelterState.parentPreparation.pairs.some(f=>[f.a,f.b].includes(5)));
  x.context.shelterCampaign.parentPreparation=false;x.schedule();assert.equal(x.context.shelterState.parentPreparation,undefined);
  assert.equal(x.context.shelterState.campaign.roles[0].id,4);
});

test('父母预培养：每项短板都受门槛约束，固定训练期限不会因刷新延后',()=>{
  const x=setupParentPreparation(source),a=training(x.schedule())[0];x.apply(a);
  const record=plain(x.context.shelterState.campaign.roles[0]);x.tick();x.schedule();
  assert.equal(x.context.shelterState.campaign.roles[0].until,record.until);
  const f=x.context.shelterState.parentPreparation.pairs[0],ps=x.f.view.state.residents.filter(p=>[f.a,f.b].includes(p.id));
  for(const person of ps)for(const stat of Object.keys(person.stats))person.stats[stat]=10;
  for(const person of ps)for(const stat of ['str','per','end','cha','int','agi','lck']){
    person.stats[stat]=9;assert.equal(x.api.prepared(x.m(),f),false,person.id+':'+stat);person.stats[stat]=10;
  }
  assert.equal(x.api.prepared(x.m(),f),true);
});

test('父母预培养：旧4点目标迁移到10，候选身份与训练期限不变',()=>{
  const state=setupParentPreparation(source),action=training(state.schedule())[0];state.apply(action);
  const before=plain(state.context.shelterState.parentPreparation),until=state.context.shelterState.campaign.roles[0].until;
  state.context.shelterState.parentPreparation.pairs.forEach(pair=>pair.target=4);
  state.tick();state.schedule();
  assert.deepEqual(plain(state.context.shelterState.parentPreparation),before);
  assert.equal(state.context.shelterState.campaign.roles[0].until,until);
  assert.ok(before.pairs.every(pair=>pair.target===10));
  const old=state.f.view.state.residents.filter(person=>[8,9].includes(person.id));
  assert.equal(state.api.pairAllowed(state.m(),old,before,true),false);
  assert.equal(state.api.pairAllowed(state.m(),old,{version:1,pairs:[]},true),false);
});

test('父母预培养：关闭训练只暂停培养，未达标父母仍不能新开生育',()=>{
  const state=setupParentPreparation(source);state.context.shelterCampaign.training=false;
  const campaign=state.schedule(),pair=state.f.view.state.residents.filter(person=>[4,5].includes(person.id));
  assert.equal(training(campaign).length,0);
  assert.equal(state.context.shelterState.parentPreparation.pairs.length,2);
  assert.equal(state.api.pairAllowed(state.m(),pair,state.context.shelterState.parentPreparation),false);
});

test('父母预培养：旧父母同宿舍未开始感情时先退出，双方全10及已开始家庭保留',()=>{
  for(const status of ['below-target','ready','romance','birth','unknown-birth']){
    const state=setupParentPreparation(source),view=state.f.view.state;
    state.context.shelterCampaign.training=false;
    const pair=view.residents.filter(person=>[8,9].includes(person.id));
    pair.forEach(person=>person.roomId=7);
    if(status==='ready')pair.forEach(person=>Object.keys(person.stats).forEach(stat=>person.stats[stat]=10));
    if(status==='romance')pair.forEach((person,index)=>person.romance={partnerId:pair[1-index].id});
    if(status==='birth'||status==='unknown-birth')view.births=[{roomId:7,dueAt:state.m().now+3600000,
      ...(status==='birth'?{parents:[8,9]}:{})}];
    state.schedule();
    const action=state.api.staff(state.m());
    if(status==='below-target'){
      assert.ok([8,9].includes(action?.id));assert.equal(action.room,null);
      assert.match(action.reason,/七项基础属性.*10/);
      state.apply(action);state.tick();
      const next=state.api.staff(state.m());
      assert.ok(!next||next.room!==7,'未达标不能重新团聚生育');
    }else assert.ok(!action?.reason.includes('七项基础属性'),status);
  }
});

test('父母预培养：已有一级房仍升级空房，排除该房新入训且实际建设可开工',()=>{
  const state=setupParentPreparation(source);state.context.shelterConstruction.upgrade=true;
  const campaign=state.schedule(),project=campaign.projects.find(project=>project.upgradeId);
  assert.ok(project);assert.equal(project.type,'training');
  assert.ok(!campaign.actions.some(action=>action.room===project.upgradeId));
  const development=state.api.development(state.m(),18,campaign,null);
  assert.equal(development.next.status,'ready');assert.equal(development.next.project.id,project.upgradeId);
  assert.equal(development.next.project.kind,'upgrade');
});

test('父母预培养：满级、有人训练、预算不足和供电不足均不抢先升级',()=>{
  for(const condition of ['full','occupied','budget','power']){
    const state=setupParentPreparation(source);state.context.shelterConstruction.upgrade=true;
    const rooms=state.f.view.state.rooms.filter(room=>room.type==='training');
    if(condition==='full')rooms.forEach(room=>room.level=3);
    if(condition==='occupied'){
      state.f.view.state.rooms=state.f.view.state.rooms.filter(room=>room.type!=='training'||room.id===93);
      state.f.view.state.residents.find(person=>person.id===9).roomId=93;
    }
    if(condition==='budget')state.context.shelterConstruction.scrapLimit=1;
    if(condition==='power')state.f.view.state.residents.find(person=>person.id===1).roomId=null;
    const campaign=state.schedule();assert.ok(!campaign.projects.some(project=>project.upgradeId),condition);
    if(condition==='occupied')assert.ok(!campaign.actions.some(action=>action.id===9),condition);
  }
});
