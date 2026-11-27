import assert from 'node:assert/strict';
import {parentPreparationScene} from './arkengine-shelter-parent-preparation.fixture.mjs';

export async function shelterParentPreparationTests({t,setupShelter,reloadShelter,evaluate,pulse,drive}){
  const state=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`,
    pending=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`,
    done=`location.pathname==='/activities/expedition'&&${state}?.nextAt>clock`;
  const scene=(extra='')=>{const f=parentPreparationScene();
    for(const person of f.view.state.residents.filter(person=>[4,5,6,7].includes(person.id)))
      for(const stat of Object.keys(person.stats))person.stats[stat]=stat==='cha'?9:10;
    return `sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;
    sm.fixtureSearch=location.search;sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.quickAssign=false;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
    localStorage.setItem('arkengine:auto-shelter:population:v1','18');
    localStorage.setItem('arkengine:auto-shelter:population-continuous:v1','false');
    localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify(f.campaign)}));
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(${JSON.stringify({...f.state,vaultNo:77,nextAt:0,note:'parent preparation fixture'})}));${extra}`;};
  await t.test('157生育接续：满属性原家庭先于闲置补岗，两人实际返回同一宿舍',async()=>{
    await setupShelter(scene(`const stored=JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'));
      stored.parentPreparation={version:1,pairs:[{a:8,b:9,at:clock,target:10}]};
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(stored));
      for(const parent of sm.view.state.residents.filter(person=>[8,9].includes(person.id))){
        parent.roomId=null;for(const stat of Object.keys(parent.stats))parent.stats[stat]=10;}
      const flags=JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1'));
      flags.training=false;localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(flags));`));
    await drive(`sm.view.state.residents.filter(person=>[8,9].includes(person.id)).every(person=>person.roomId===7)`,
      'both original parents return to the same quarters',150);
    assert.deepEqual(await evaluate(`sm.calls.filter(call=>call.type==='assign'&&[8,9].includes(call.residentId)).map(call=>call.roomId)`),[7,7]);
  });
  await t.test('159滚动培养：老家庭毕业，发电替班先到岗，待训家长随后入感知训练室',async()=>{
    await setupShelter(scene(`const stored=JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'));
      stored.parentPreparation={version:1,pairs:[{a:8,b:9,at:clock,target:10},{a:4,b:5,at:clock,target:10}]};
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(stored));
      const s=sm.view.state;for(const p of s.residents.filter(p=>[4,5,8,9].includes(p.id)))for(const stat of Object.keys(p.stats))p.stats[stat]=10;
      s.residents.find(p=>p.id===4).stats.per=8;s.residents.find(p=>p.id===4).roomId=1;s.residents.find(p=>p.id===1).roomId=4;
      s.residents.find(p=>p.id===8).familyCooldownUntil=clock+3600000;`));
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===4&&c.roomId===91)`,'single parent enters perception training after relief',180);
    const moves=await evaluate(`sm.calls.filter(c=>c.type==='assign').map(c=>[c.residentId,c.roomId])`);
    const cover=moves.findIndex(([id,room])=>id!==4&&room===1),train=moves.findIndex(([id,room])=>id===4&&room===91);
    assert.ok(cover>=0&&cover<train,JSON.stringify(moves));
    const stored=await evaluate(state);assert.ok(stored.families.some(f=>f.a===8&&f.b===9&&f.room===7));
    assert.equal(stored.parentPreparation.pairs.length,2);assert.ok(!stored.parentPreparation.pairs.some(f=>[8,9].includes(f.a)||[8,9].includes(f.b)));
  });
  await t.test('158深挖交班：替班先到医务室，原护士和伴侣再回同一宿舍',async()=>{
    await setupShelter(scene(`const stored=JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'));
      stored.parentPreparation={version:1,pairs:[{a:8,b:9,at:clock,target:10}]};
      stored.campaign.roles.push({id:8,room:301,role:'medical',at:clock});
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(stored));
      const flags=JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1'));
      Object.assign(flags,{training:false,medical:true});localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(flags));
      const s=sm.view.state;s.digging={floor:40,doneAt:clock+3600000};s.rooms.push({...s.rooms[0],id:301,type:'medbay',floor:3,col:6,width:1,level:1});
      for(const parent of s.residents.filter(p=>[8,9].includes(p.id)))for(const stat of Object.keys(parent.stats))parent.stats[stat]=10;
      s.residents.find(p=>p.id===8).roomId=301;s.residents.find(p=>p.id===6).roomId=1;`));
    await drive(`sm.view.state.residents.filter(p=>[8,9].includes(p.id)).every(p=>p.roomId===7)`,'nurse and partner reunited after real relief',240);
    const moves=await evaluate(`sm.calls.filter(c=>c.type==='assign'&&(c.roomId===301||[8,9].includes(c.residentId))).map(c=>[c.residentId,c.roomId])`);
    assert.equal(moves.length,3);assert.equal(moves[0][1],301);assert.ok(![8,9].includes(moves[0][0]));assert.deepEqual(moves.slice(1),[[8,7],[9,7]]);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${moves[0][0]}).roomId`),301);
    await drive(done,'completed shelter check after relief',180);
    const summary=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-check').at(-1)?.data`);
    assert.ok(summary?.constructionCheck?.basis);assert.ok(!Object.hasOwn(summary,'developmentNext'));
    assert.equal(summary.constructionCheck.materials.partsPerHour,0);
  });
  await t.test('157找不到单个居民：不发送该人调岗，下一位仍实际就业',async()=>{
    await setupShelter(scene(`localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      for(const person of sm.view.state.residents.filter(person=>[8,9].includes(person.id)))person.roomId=null;
      const render=renderShelter;window.renderShelter=()=>{render();for(const row of document.querySelectorAll('li'))
        if(row.querySelector('button')?.textContent.includes('培养居民8'))row.remove();};`));
    await drive(`sm.calls.some(call=>call.type==='assign'&&call.residentId===9)`,'next locatable worker employed',120);
    assert.equal(await evaluate(`sm.calls.some(call=>call.type==='assign'&&call.residentId===8)`),false);
    assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(event=>event.type==='shelter-resident-unlocated'&&event.data.residentId===8)`));
  });
  const revisit=async()=>{
    await pulse(1000);
    if(await evaluate(`location.pathname!=='/shelter'`))
      await evaluate(`document.querySelector('a[href="/shelter"]').click();`);
    await evaluate(`history.replaceState({},'','/shelter'+sm.fixtureSearch);`);
    await reloadShelter();
  };
  await t.test('父母预培养浏览器：旧父母未达10且同宿舍，未开始感情时退出并禁止重新配对',async()=>{
    await setupShelter(scene(`const cfg=JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1'));
      cfg.training=false;localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(cfg));
      for(const person of sm.view.state.residents.filter(person=>[8,9].includes(person.id)))person.roomId=7;`));
    await drive(`sm.calls.some(call=>call.type==='assign'&&[8,9].includes(call.residentId)&&call.roomId===null)`,
      'unprepared parents leave quarters before new romance',180);
    await drive(done,'preparation gate settles',180);
    assert.equal(await evaluate(`sm.calls.some(call=>call.type==='assign'&&[8,9].includes(call.residentId)&&call.roomId===7)`),false);
    assert.ok(await evaluate(`sm.view.state.residents.filter(person=>[8,9].includes(person.id)).some(person=>person.roomId!==7)`));
    assert.equal(await evaluate(pending),null);
  });
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
    await evaluate(`for(const p of sm.view.state.residents.filter(p=>[4,6].includes(p.id))){p.stats.cha=10;p.training=0;}
      clock+=12*3600000;sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);await revisit();
    await drive(done,'first parents return before partner training',220);await revisit();
    await drive(`${state}?.campaign.roles.some(r=>r.id===5&&r.preparation)&&!${pending}`,'first partner starts',180);
    await drive(`${state}?.campaign.roles.some(r=>r.id===7&&r.preparation)&&!${pending}`,'second partner starts',180);
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[4,6].includes(p.id)).map(p=>p.roomId)'),[4,4]);
    await evaluate(`for(const p of sm.view.state.residents.filter(p=>[5,7].includes(p.id))){p.stats.cha=10;p.training=0;}
      clock+=12*3600000;sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);await revisit();
    await drive(done,'all targets reached and return completed',220);await revisit();
    await drive(`sm.calls.some(c=>c.type==='assign'&&[4,5,6,7].includes(c.residentId)&&[5,7].includes(c.roomId))`,
      'prepared parents actually assigned to quarters',220);
    const after=await evaluate(state),graduates=[...after.families,...(after.parentPreparation.ready||[])];
    for(const pair of saved.pairs)assert.ok(graduates.some(f=>f.a===pair.a&&f.b===pair.b));
    assert.ok(after.parentPreparation.pairs.every(f=>![4,5,6,7].includes(f.a)&&![4,5,6,7].includes(f.b)));
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[4,5,6,7].includes(p.id)).every(p=>Object.values(p.stats).every(v=>v>=10))'));
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
