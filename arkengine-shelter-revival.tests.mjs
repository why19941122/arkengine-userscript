import assert from 'node:assert/strict';
export async function shelterRevivalTests({t,setupShelter,reloadShelter,evaluate,pulse,drive,trustedStaffKey}){
  const state=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`;
  const pending=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`;
  const done=`location.pathname==='/activities/expedition' && ${state}?.nextAt>clock`;
  const calls=`sm.calls.filter(c=>c.type==='revive')`;
  const scene=`sm.fixtureSearch=location.search;sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    sm.view.state.season.points=0;sm.view.state.resources.scrap=1000;sm.view.state.resources.stimpak=0;
    sm.view.state.rooms.forEach(r=>r.stored=0);const p=sm.view.state.residents[0];p.hp=0;p.deadAt=clock-3600000;
    localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({explore:false,quests:false,training:false,
      medical:true,radio:false,combatGear:false,defense:false,development:false,workshop:false,dailyGoals:false,craftDaily:false,
      tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6}));
    localStorage.setItem('arkengine:auto-shelter:staff:v1','off');
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:false,upgrade:false,dig:false,
      budgetMode:'stock',scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:5}));`;
  await t.test('废料救回浏览器：原生救回仅扣一次，刷新不重发并保存费用',async()=>{
    await setupShelter(scene);await drive(done,'revival complete');
    assert.equal(await evaluate(`${calls}.length`),1);assert.equal(await evaluate('sm.view.state.residents[0].deadAt'),null);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),860);assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate(`${state}.constructionLedger.filter(e=>e.scrap===140).length`),1);
    assert.equal(await evaluate(`sm.calls.some(c=>['bury','retire'].includes(c.type))`),false);
    await pulse(1000);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+sm.fixtureSearch);`);await reloadShelter();await drive(done,'revival reload');
    assert.equal(await evaluate(`${calls}.length`),1);
  });
  await t.test('废料救回浏览器：未知原请求跨刷新保留，人工恢复不能当原单成功',async()=>{
    await setupShelter(scene+'sm.mode="unknown";');await drive(`${calls}.length===1`,'unknown revive');
    const id=await evaluate(`${pending}.id`);assert.equal(await evaluate(`${pending}.lifecycle.phase`),'request-bound');
    await evaluate(`sm.view.state.residents[0].deadAt=null;sm.view.state.residents[0].hp=40;`);
    await reloadShelter();await drive(done,'unknown revive retained');
    assert.equal(await evaluate(`${pending}.id`),id);assert.equal(await evaluate(`${calls}.length`),1);
    assert.equal(await evaluate(`${state}.constructionLedger?.length||0`),0);
  });
  await t.test('废料救回浏览器：迟到成功回执唤醒核对，重复返回不重记费用',async()=>{
    await setupShelter(scene+`const transport=window.fetch;window.fetch=async(u,o)=>{const r=await transport(u,o);
      if(u==='/api/shelter/action'&&JSON.parse(o.body).action.type==='revive')return new Promise(resolve=>sm.releaseRevival=()=>resolve(r));return r;};`);
    await drive(`${calls}.length===1`,'late revival request');await pulse(35000);
    assert.equal(await evaluate(`${pending}.kind`),'revive');
    await evaluate('sm.releaseRevival()');await pulse(2000);
    await evaluate(`clock=Math.max(clock,${state}.nextAt);`);
    if(await evaluate(`location.pathname!=='/shelter'`))await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+sm.fixtureSearch);`);
    await reloadShelter();await drive(done,'late revival reconciled');
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`${calls}.length`),1);
    assert.equal(await evaluate(`${state}.constructionLedger.filter(e=>e.scrap===140).length`),1);
  });
  await t.test('废料救回浏览器：报价、按钮或身份不符只关闭本轮窗口，不反复打开',async()=>{
    for(const change of ['sm.revivalQuoteDelta=1;','sm.revivalDisabled=true;',
      `const open=openResident;window.openResident=id=>{open(id);document.querySelector('[data-staff-dialog] h2').textContent='#999 错误居民 · 1 级';};`]){
      await setupShelter(scene+change);await drive(done,'revival control mismatch',160);
      assert.equal(await evaluate(`${calls}.length`),0);assert.equal(await evaluate('sm.residentOpens'),1);
      assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('废料救回浏览器：窗口打开后期限、价格或预算变化，撤销未发送救回',async()=>{
    for(const change of ['p.deadAt=clock-86400000;','p.xp=147;','sm.view.state.resources.scrap=239;']){
      await setupShelter(scene+`const open=openResident;window.openResident=id=>{open(id);${change}};`);
      await drive(done,'revival changed before send',160);assert.equal(await evaluate(`${calls}.length`),0);
      assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('废料救回浏览器：医疗关闭、库存不足及到期时不打开救回窗口',async()=>{
    for(const change of [`localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({...JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1')),medical:false}));`,
      'sm.view.state.resources.scrap=239;','p.deadAt=clock-86400000;']){
      await setupShelter(scene+change);await drive(done,'revival not admitted');
      assert.equal(await evaluate(`${calls}.length`),0);assert.equal(await evaluate('sm.residentOpens||0'),0);
    }
  });
  await t.test('废料救回浏览器：人工接手原窗口后不提交不自动关闭',async()=>{
    await setupShelter(scene);await drive(`!!document.querySelector('[data-revive]')`,'revival dialog');
    await evaluate(`document.querySelector('[data-revive]').focus()`);await trustedStaffKey();
    await pulse(61000);assert.equal(await evaluate(`${calls}.length`),0);
    assert.equal(await evaluate(`!!document.querySelector('[data-revive]')`),true);
  });
  await t.test('废料救回浏览器：原生居民窗口没有调岗控件也能救回，关医疗则撤销',async()=>{
    for(const disable of [false,true]){
      await setupShelter(scene+`const open=openResident;window.openResident=id=>{open(id);
        document.querySelector('[data-staff-dialog]').querySelectorAll('label').forEach(e=>e.remove());
        ${disable?`const panel=document.getElementById('ark-auto-expedition').shadowRoot;panel.getElementById('shelter-campaign-medical').checked=false;panel.getElementById('shelter-campaign-save').click();`:''}};`);
      await drive(done,'revival native down controls');assert.equal(await evaluate(`${calls}.length`),disable?0:1);
      assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('废料救回浏览器：请求失败或回执不含成功状态，保留原单不重发不记账',async()=>{
    for(const mode of ['error','missing-proof']){
      await setupShelter(scene+(mode==='error'?'sm.mode="error";':`const prior=window.fetch;window.fetch=async(u,o)=>{
        const r=await prior(u,o);return u==='/api/shelter/action'?new Response('{}'):r;};`));
      await drive(`${calls}.length===1`,'revival failed response');await reloadShelter();await drive(done,'failed revival retained');
      assert.equal(await evaluate(`${pending}.kind`),'revive');assert.equal(await evaluate(`${calls}.length`),1);
      assert.equal(await evaluate(`${state}.constructionLedger?.length||0`),0);
    }
  });
  await t.test('废料救回浏览器：发送前持久化失败不扣款，刷新只恢复未发送准备',async()=>{
    await setupShelter(scene+`const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
      if(k==='arkengine:auto-shelter:pending:v1'&&JSON.parse(v)?.lifecycle?.phase==='request-bound')throw Error('fixture bound write failure');
      return set.call(this,k,v);};`);
    await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'failed revival persistence');
    assert.equal(await evaluate(`${calls}.length`),0);assert.equal(await evaluate('sm.view.state.resources.scrap'),1000);
    assert.equal(await evaluate(`${pending}.lifecycle.phase`),'prepared');
    await reloadShelter();await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('shelter-toggle').click()`);
    await drive(done,'prepared revival recovered');assert.equal(await evaluate(`${calls}.length`),1);
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate('sm.view.state.resources.scrap'),860);
  });
  await t.test('废料救回浏览器：多个倒下居民先救期限最近者，每次重读预算不透支',async()=>{
    await setupShelter(scene+`sm.view.state.resources.scrap=240;
      sm.view.state.residents.push({...structuredClone(p),id:2,name:'期限最近',deadAt:clock-23*3600000});`);
    await drive(done,'one affordable revival');assert.deepEqual(await evaluate(`${calls}.map(c=>c.residentId)`),[2]);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),100);assert.equal(await evaluate('sm.view.state.residents[0].hp'),0);
    assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
  });
  await t.test('废料救回浏览器：探险救回后保留在途行程，不冒充领取或重复召回',async()=>{
    await setupShelter(scene+`p.roomId=null;p.away={kind:'explore'};sm.view.state.explorers=[{id:41,residentId:p.id,
      startedAt:clock-4*3600000,recalledAt:null,returnAt:null,stimpaks:0,loot:{scrap:30,parts:0,stimpak:0,items:[]}}];`);
    await drive(done,'revived explorer returning');assert.equal(await evaluate(`${calls}.length`),1);
    assert.equal(await evaluate(pending),null);assert.ok(await evaluate('sm.view.state.explorers[0].returnAt>clock'));
    assert.equal(await evaluate('sm.view.state.residents[0].away.kind'),'explore');
    assert.equal(await evaluate(`sm.calls.some(c=>['explore_claim','explore_recall','assign'].includes(c.type))`),false);
  });
}
