import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {readyCampaignConstructionScene} from './arkengine-shelter-growth-investment.fixture.mjs';
import {setupPowerInvestment} from './arkengine-shelter-power-investment.fixture.mjs';

const source=readFileSync(process.env.ARKENGINE_TEST_SOURCE||new URL('./arkengine-auto-encounter.user.js',import.meta.url),'utf8');
function setup(role='training'){
  const x=setupPowerInvestment(source,readyCampaignConstructionScene(role));
  x.context.shelterOptimize=true;return x;
}

test('建设交接：关闭旧电台设置，训练和普通医疗不能绕过已就绪工程',()=>{
  for(const role of ['training','radio','medical']){
    const x=setup(role),before=JSON.stringify(x.f),{m,campaign,development}=x.plan();
    if(role==='radio')assert.equal(campaign.actions.some(a=>a.role==='radio'),false,'old radio settings cannot recruit');
    else assert.equal(campaign.choice.role,role,'must have a real competing duty');
    assert.equal(development.next.status,'ready');assert.equal(x.api.construction(m).id,4);
    assert.equal(x.api.choice(m),null,'executor hands off before elective assignment');
    assert.equal(x.api.staff(m),null,'ordinary optimizer also hands off');
    assert.equal(JSON.stringify(x.f),before,'selection does not spend or move anyone');
  }
});

test('建设交接：预算不足、开关关闭、当轮已开工或人工撤销不能无限压住养成',()=>{
  for(const reason of ['budget','disabled','done','held']){
    const x=setup();
    if(reason==='budget')x.context.shelterConstruction.scrapLimit=399;
    if(reason==='disabled')x.context.shelterConstruction.upgrade=false;
    if(reason==='done')x.context.shelterConstructionDone=true;
    if(reason==='held')x.context.shelterConstructionHeld=true;
    assert.equal(x.api.choice(x.api.model(x.f.view))?.role,'training',reason);
  }
});

test('建设交接：伤员救治及缺针时的医疗补员仍先处理',()=>{
  for(const stock of [0,9]){
    const x=setup('medical');x.f.view.state.residents[0].hp=50;x.f.view.state.resources.stimpak=stock;
    const {m}=x.plan(),choice=x.api.choice(m);
    assert.equal(choice.role,'medical');assert.equal(choice.kind,stock?'stimpak':'assign');
  }
});

test('建设交接：已开始训练保留进度与期限，训练结束返岗不被工程挡住',()=>{
  const x=setup(),a=x.plan().campaign.choice,p=x.f.view.state.residents.find(p=>p.id===a.id);
  p.roomId=a.room;p.training=.5;
  x.context.shelterState.campaign.roles=[{id:a.id,room:a.room,role:'training',at:x.f.view.serverTime,
    stat:a.stat,base:a.base,purpose:a.purpose,until:a.until,windowEnd:a.windowEnd,destination:a.destination}];
  const roles=JSON.stringify(x.context.shelterState.campaign.roles),{m,campaign}=x.plan();
  assert.ok(campaign.reserved.includes(p.id));assert.ok(!campaign.actions.some(c=>c.id===p.id&&c.role==='training-release'));
  x.api.choice(m);assert.equal(p.training,.5);assert.equal(JSON.stringify(x.context.shelterState.campaign.roles),roles);
  p.stats[a.stat]++;p.training=0;
  assert.equal(x.api.choice(x.api.model(x.f.view)).role,'training-release');
});
