import assert from 'node:assert/strict';
import {parentPreparationScene} from './arkengine-shelter-parent-preparation.fixture.mjs';

export async function shelterParentPreparationTests({t,setupShelter,reloadShelter,evaluate,pulse,drive}){
  const state=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`,
    pending=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`,
    done=`location.pathname==='/activities/expedition'&&${state}?.nextAt>clock`;
  const scene=(extra='')=>{const f=parentPreparationScene();return `sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;
    sm.fixtureSearch=location.search;sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.quickAssign=false;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
    localStorage.setItem('arkengine:auto-shelter:population:v1','18');
    localStorage.setItem('arkengine:auto-shelter:population-continuous:v1','false');
    localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify(f.campaign)}));
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(${JSON.stringify({...f.state,vaultNo:77,nextAt:0,note:'parent preparation fixture'})}));${extra}`;};
  const revisit=async()=>{
    await pulse(1000);
    if(await evaluate(`location.pathname!=='/shelter'`))
      await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+sm.fixtureSearch);`);
    await reloadShelter();
  };
  await t.test('父母预培养浏览器：两对分批训练、刷新保持、四人达标后实际开始生育安排',async()=>{
    await setupShelter(scene());
    await drive(`${state}?.campaign.roles.some(r=>r.id===4&&r.preparation)&&!${pending}`,'first preparation receipt',180);
    const saved=await evaluate(`${state}.parentPreparation`),until=await evaluate(`${state}.campaign.roles.find(r=>r.id===4).until`);
    assert.deepEqual(saved.pairs.flatMap(f=>[f.a,f.b]),[4,5,6,7]);
    await evaluate('sm.view.state.residents.find(p=>p.id===4).training=.3;');await revisit();
    await drive(`${state}?.campaign.roles.some(r=>r.id===6&&r.preparation)&&!${pending}`,'other family uses second seat',180);
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===4).until`),until);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&[5,7].includes(c.residentId)&&c.roomId===93)`),false);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&[4,5,6,7].includes(c.residentId)&&[5,7].includes(c.roomId))`),false);
    await evaluate(`for(const p of sm.view.state.residents.filter(p=>[4,6].includes(p.id))){p.stats.cha=4;p.training=0;}
      clock+=4*3600000;sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);await revisit();
    await drive(done,'first parents return before partner training',220);await revisit();
    await drive(`${state}?.campaign.roles.some(r=>r.id===5&&r.preparation)&&!${pending}`,'first partner starts',180);
    await drive(`${state}?.campaign.roles.some(r=>r.id===7&&r.preparation)&&!${pending}`,'second partner starts',180);
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[4,6].includes(p.id)).map(p=>p.roomId)'),[4,4]);
    await evaluate(`for(const p of sm.view.state.residents.filter(p=>[5,7].includes(p.id))){p.stats.cha=4;p.training=0;}
      clock+=4*3600000;sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);await revisit();
    await drive(done,'all targets reached and return completed',220);await revisit();
    await drive(`sm.calls.some(c=>c.type==='assign'&&[4,5,6,7].includes(c.residentId)&&[5,7].includes(c.roomId))`,
      'prepared parents actually assigned to quarters',220);
    assert.deepEqual(await evaluate(`${state}.parentPreparation`),saved);
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[4,5,6,7].includes(p.id)).every(p=>Object.values(p.stats).every(v=>v>=4))'));
  });

  await t.test('父母预培养浏览器：提交前断供撤销入训，恢复后不重复原请求',async()=>{
    await setupShelter(scene());
    await drive(`!!document.querySelector('[data-staff-dialog="4"]')`,'preparation dialog before supply changes',180);
    await evaluate('sm.view.state.resources.food=0;');
    await drive(done,'unsafe training cancelled',180);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===4&&c.roomId===93)`),false);
    await evaluate('sm.view.state.resources.food=1000;');await revisit();
    await drive(`${state}?.campaign.roles.some(r=>r.id===4&&r.preparation)&&!${pending}`,'training resumes with new safe read',180);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===4&&c.roomId===93).length`),1);
  });

  await t.test('父母预培养浏览器：未知入训原单跨刷新保留，候选和用途不丢失、不重发',async()=>{
    await setupShelter(scene('sm.assignUnknown=true;'));
    await drive(`!!${pending}&&sm.calls.some(c=>c.type==='assign'&&c.residentId===4)`,'unknown preparation receipt',180);
    const original=await evaluate(pending),cohort=await evaluate(`${state}.parentPreparation`);
    assert.equal(original.before.campaign.choice.preparation,true);
    await revisit();await drive(done,'unknown preparation remains held',180);
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.deepEqual(await evaluate(`${state}.parentPreparation`),cohort);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===4&&c.roomId===93).length`),1);
    assert.equal(await evaluate(`${state}.campaign.roles.some(r=>r.id===4)`),false,'unknown receipt cannot invent a confirmed role');
  });

  await t.test('父母预培养浏览器：旧配置自动兼容，新开关保存关闭后刷新保持',async()=>{
    const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
    await setupShelter(scene(`const cfg=JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1'));
      delete cfg.parentPreparation;localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(cfg));
      localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`));
    await pulse(1000);
    assert.equal(await evaluate(`${panel}.getElementById('shelter-campaign-parentPreparation').checked`),true);
    await evaluate(`${panel}.querySelector('[data-panel-section="shelter-campaign"]').open=true;`);
    await evaluate(`${panel}.getElementById('shelter-campaign-parentPreparation').checked=false;
      ${panel}.getElementById('shelter-campaign-save').click();`);
    await reloadShelter();await pulse(1000);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1')).parentPreparation`),false);
    assert.equal(await evaluate(`${panel}.getElementById('shelter-campaign-parentPreparation').checked`),false);
  });
}
