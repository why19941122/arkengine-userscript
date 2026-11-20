import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function setup(){
  const view=campaignView();view.state.resources.parts=44;
  view.state.rooms.push({...view.state.rooms[0],id:90,type:'workshop',floor:3,col:2,level:1,stored:0});
  const fixture=setupPowerInvestment(source,{view,state:{campaign:{}},campaign:{},construction:{build:false,upgrade:false,dig:false,
    budgetMode:'daily',scrapLimit:0,partsLimit:0,scrapReserve:100,partsReserve:0}});
  fixture.context.shelterLevelTarget=1;
  vm.runInContext(source.match(/^  const workshopAutomatic=[^]*?;/m)[0]+'\nthis.workshopAutomatic=workshopAutomatic;',fixture.context);
  fixture.run=()=>fixture.api.schedule(fixture.api.model(fixture.f.view));
  fixture.apply=action=>{
    const person=fixture.f.view.state.residents.find(person=>person.id===action.id);person.roomId=action.room;
    fixture.context.shelterState.campaign={roles:[{id:person.id,room:90,role:'workshop',at:view.serverTime}]};
  };
  return fixture;
}

test('工坊库存：建设关闭和零建设额度仍补到100，现有空岗安排一次并继续值班',()=>{
  const fixture=setup(),first=fixture.run();
  const action=first.actions.find(action=>action.role==='workshop');assert.ok(action);
  assert.equal(action.room,90);assert.ok([5,6].includes(action.id),'只用可离岗成人，不抽供应岗位');
  fixture.apply(action);const next=fixture.run();
  assert.ok(next.reserved.includes(action.id));assert.ok(!next.actions.some(next=>next.id===action.id));
  assert.equal(next.projects.some(project=>project.type==='workshop'),false);
});

test('工坊库存：达到100或已满批待领达到100后结束自动值班，消耗后重新补料',()=>{
  const fixture=setup(),action=fixture.run().actions.find(action=>action.role==='workshop');assert.ok(action);fixture.apply(action);
  for(const [stock,stored] of [[100,0],[97,3]]){
    fixture.f.view.state.resources.parts=stock;fixture.f.view.state.rooms.find(room=>room.id===90).stored=stored;
    assert.ok(fixture.run().actions.some(next=>next.id===action.id&&next.role==='workshop-release'));
  }
  fixture.f.view.state.resources.parts=99;fixture.f.view.state.rooms.find(room=>room.id===90).stored=0;
  assert.ok(fixture.run().reserved.includes(action.id));
});

test('工坊库存：供料、基础供应、人员关闭、未知请求或训练保护不允许抢人',()=>{
  for(const variant of ['scrap','food','off','pending','training']){
    const fixture=setup(),state=fixture.f.view.state;
    if(variant==='scrap')state.resources.scrap=100;
    if(variant==='food')state.resources.food=0;
    if(variant==='off')fixture.context.shelterStaffMode='off';
    if(variant==='pending')fixture.context.shelterPending={id:'unknown',kind:'assign',targets:[5,90]};
    if(variant==='training'){
      state.rooms.push({...state.rooms[0],id:91,type:'training',trainStat:'int'});
      for(const person of state.residents){
        if(person.id<=3)person.hp=1;
        else {person.roomId=91;person.training=.9;}
      }
    }
    assert.ok(!fixture.run().actions.some(action=>action.role==='workshop'),variant);
  }
});

test('工坊库存：没有现成工坊且未开启建设，不为库存目标新建房间',()=>{
  const fixture=setup();fixture.f.view.state.rooms=fixture.f.view.state.rooms.filter(room=>room.id!==90);
  const plan=fixture.run();assert.ok(!plan.actions.some(action=>action.role==='workshop'));
  assert.ok(!plan.projects.some(project=>project.type==='workshop'));
});

test('工坊库存：保留量高于100时按更高目标，仓容限制和未满批产物仍核对',()=>{
  const fixture=setup();fixture.context.shelterConstruction.partsReserve=120;
  fixture.f.view.state.resources.parts=100;
  assert.ok(fixture.run().actions.some(action=>action.role==='workshop'));
  fixture.context.shelterConstruction.partsReserve=0;
  fixture.f.view.state.resources.parts=97;fixture.f.view.state.rooms.find(room=>room.id===90).stored=2.9;
  assert.ok(fixture.run().actions.some(action=>action.role==='workshop'));
  const model=fixture.api.model(fixture.f.view);model.caps.parts=80;
  assert.ok(!fixture.api.schedule(model).actions.some(action=>action.role==='workshop'));
});
