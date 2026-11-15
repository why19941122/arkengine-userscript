import assert from 'node:assert/strict';
import {currentGrowthDiagnostic,currentGrowthScene} from './arkengine-shelter-current-growth.fixture.mjs';
export async function currentGrowthTests({t,setupShelter,reloadShelter,evaluate,drive,pulse}){
  const journal=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`;
  const scene=(flags={},extra='')=>{
    const {view,state}=currentGrowthScene();
    return `sm.view=${JSON.stringify(view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','50');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(${JSON.stringify({...state,nextAt:0,note:'当前发展阻塞'})}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(currentGrowthDiagnostic.summary.construction)}));
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify({...currentGrowthDiagnostic.campaign,explore:false,quests:false,radio:false,help:false,dailyGoals:false,craftDaily:false,...flags})}));${extra}`;
  };
  await t.test('当前装备与每日浏览器：38人现场利用165号服装工坊制作并穿上闲置装备',async()=>{
    await setupShelter(scene({dailyGoals:true,craftDaily:true,combatGear:true},`
      sm.dailyGoalRows=true;const s=sm.view.state;
      s.daily.picks=[{key:'win',target:7,reward:{scrap:440,parts:3,points:30}},
        {key:'baby',target:1,reward:{scrap:440,parts:3,points:30}},{key:'craft',target:1,reward:{scrap:440,parts:3,points:30}}];
      s.daily.counters={win:7,baby:0,craft:0};s.daily.claimed=[0];
      s.items.push({id:173,slot:'weapon',name:'轨道步枪',damage:[11,18]},
        {id:71,slot:'outfit',name:'普通演出服',bonus:{cha:2}},
        {id:136,slot:'outfit',name:'破旧幸运夹克',bonus:{lck:1}},
        {id:169,slot:'weapon',name:'生锈钢管',damage:[1,3]},{id:171,slot:'weapon',name:'生锈钢管',damage:[1,3]});`));
    await drive(`sm.calls.some(a=>a.type==='craft'&&a.roomId===165)&&sm.calls.some(a=>a.type==='equip'&&a.itemId===173)`,
      'current workshop and rifle',160);
    const calls=await evaluate('sm.calls');assert.equal(calls.filter(a=>a.type==='craft').length,1);
    assert.ok(!calls.some(a=>a.type==='assign'&&[45,115,177].includes(a.residentId)),JSON.stringify(calls));
    assert.ok(await evaluate('sm.view.state.residents.some(p=>p.outfitId===71&&p.roomId===165)'));
  });
  await t.test('当前发展浏览器：38人现场先补水再让11和93回原宿舍，训练不被打断',async()=>{
    await setupShelter(scene());
    await drive(`[11,93].every(id=>sm.view.state.residents.find(p=>p.id===id).roomId===76)`,'interrupted parents reunite',120);
    const moves=await evaluate(`sm.calls.filter(a=>a.type==='assign')`);
    assert.ok(moves.some(a=>![11,93].includes(a.residentId)&&[7,110].includes(a.roomId)),JSON.stringify(moves));
    assert.ok(!moves.some(a=>[45,115,177].includes(a.residentId)),JSON.stringify(moves));
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===11).romance.partnerId`),93);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===93).romance.partnerId`),11);
  });
  await t.test('当前发展浏览器：无旧日志的两名普通探险实际召回，刷新不重发',async()=>{
    await setupShelter(scene({explore:true},`localStorage.setItem('arkengine:auto-shelter:staff:v1','production');`));
    await drive(`sm.calls.filter(a=>a.type==='explore_recall').length===2`,'both existing trips recalled',120);
    assert.deepEqual((await evaluate(`sm.calls.filter(a=>a.type==='explore_recall').map(a=>a.explorerId)`)).sort(),[160,172]);
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='explore_start').length`),0);
    assert.ok(await evaluate(`${journal}.campaign.trips.every(t=>t.source==='existing-state'&&t.hours===6&&t.vaultNo===10)`));
    await reloadShelter();for(let i=0;i<6;i++)await pulse();
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='explore_recall').length`),2);
  });
  await t.test('当前发展浏览器：未就业先等，原生补岗确认后大门空闲也可安排电台',async()=>{
    await setupShelter(scene({radio:true,training:false},`localStorage.setItem('arkengine:auto-shelter:staff:v1','off');
      sm.view.state.residents.forEach(p=>p.romance=null);
      sm.view.state.residents.find(p=>p.id===11).stats.cha=10;
      const old=${journal};old.families=[];old.campaign.roles=[];localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(old));`));
    await drive(`location.pathname==='/activities/expedition'`,'unemployed adult prevents further recruitment');
    assert.deepEqual(await evaluate('sm.calls'),[]);
    const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
    assert.match(await evaluate(`${panel}.getElementById('shelter-campaign-status').textContent`),/成年居民尚未落实有效岗位/);
    await pulse(1000);
    // This isolates radio admission, as in the core counterpart. Production is
    // paused and scrap jobs are full; manually use an actual water vacancy.
    await evaluate(`history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();openResident(11);
      const select=document.querySelector('[data-staff-dialog]').querySelectorAll('select')[2];
      select.value='7';select.dispatchEvent(new Event('change'));`);
    await drive(`sm.view.state.residents.find(p=>p.id===11).roomId===7&&!sm.busy`,'native water assignment confirmed');
    await evaluate(`closeResident();${panel}.getElementById('shelter-check').click();`);
    await drive(`sm.calls.some(a=>a.type==='assign'&&a.roomId===154)`,'radio staffed with empty door');
    const moves=await evaluate(`sm.calls.filter(a=>a.type==='assign')`),radio=moves.findIndex(a=>a.roomId===154);
    assert.ok(moves.slice(0,radio).some(a=>a.residentId===11&&[7,110].includes(a.roomId)),JSON.stringify(moves));
    assert.ok(await evaluate(`sm.view.state.residents.every(p=>p.roomId!==1)`));
  });
}
