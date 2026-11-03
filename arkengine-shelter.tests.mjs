import assert from 'node:assert/strict';

export async function shelterTests({t,setupShelter,reloadShelter,evaluate,pulse,drive,until,expStatus}) {
  const panel = `document.getElementById('ark-auto-expedition').shadowRoot`;
  const state = `JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`;
  const pending = `JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`;
  const enabled = `localStorage.getItem('arkengine:auto-shelter:enabled:v1')`;
  const done = `location.pathname==='/activities/expedition' && ${state}?.nextAt>clock`;
  const quiet = `sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.view.state.rooms[0].stored=0;`;

  await t.test('避难所：远征和农场空闲后领取全批与奖励，再返回且不频繁访问',async()=>{
    await setupShelter(`localStorage.setItem('arkengine:auto-farm:enabled:v1','true');sm.view.state.season.points=300;`,'/activities/expedition');
    await drive(done,'complete shelter visit',180);
    assert.equal(await evaluate('fm.crops.length'),12);
    assert.deepEqual(await evaluate(`sm.calls.map(c=>c.type)`),['collect_all','claim_tutorial','claim_objective','claim_objective','claim_objective','claim_season','claim_season','claim_achievement']);
    assert.deepEqual(await evaluate('sm.view.state.season.claimedFree'),[1,2]);
    assert.equal(await evaluate(pending),null);
    assert.ok(await evaluate(`${state}.advice.includes('废料约 8.0/小时')`));
    const reads=await evaluate('sm.reads');for(let i=0;i<5;i++)await pulse();
    assert.equal(await evaluate('sm.reads'),reads);
    assert.deepEqual(await evaluate(`fm.calls.filter(c=>c.type==='navigate').map(c=>c.path)`),['/farm','/activities/expedition','/shelter','/activities/expedition']);
  });
  await t.test('避难所：废料满仓不批量丢弃，单独收取可容纳的电力',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.view.state.resources.scrap=2100;
      sm.view.state.rooms.push({...sm.view.state.rooms[0],id:2,type:'power'});`);
    await drive(done,'individual safe collect');
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.roomId])'),[['collect',2]]);
    assert.equal(await evaluate('sm.view.state.rooms[0].stored'),30);
  });
  await t.test('避难所：领取前重新读库存，等待期间满仓时取消原领取',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;`);
    await until(async()=>/随机等待.*产出/.test(await expStatus()),'collect queued');
    await evaluate('sm.view.state.resources.scrap=2100');
    await drive(done,'full storage during wait');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：临近下一批时预留容量，避免只按当前一批计算',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=59.99;sm.view.state.resources.scrap=2070;`);
    await drive(done,'projected batch capacity');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：隐藏副本不误点，当前可见按钮仍可领取',async()=>{
    await setupShelter(`const render=renderShelter;window.renderShelter=()=>{render();const d=document.createElement('div');
      d.hidden=true;d.innerHTML=game.innerHTML;d.querySelectorAll('button').forEach(b=>b.onclick=()=>sm.calls.push({type:'hidden'}));game.prepend(d);};`);
    await drive(done,'ignore hidden DOM',150);
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='claim_tutorial')`));
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='hidden')`),false);
  });
  await t.test('避难所：奖励和免费装备可能溢出时保留奖励且不点击付费按钮',async()=>{
    await setupShelter(`sm.view.state.resources.scrap=2100;sm.view.state.season.points=750;
      sm.view.state.season.claimedFree=[1,2,3,4];sm.view.state.items=Array.from({length:20},(_,id)=>({id}));`);
    await drive(done,'overflow rewards skipped');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：默认不开启且修仙路由不会运行避难所',async()=>{
    for(const path of ['/activities/expedition','/cultivate']){
      await setupShelter(`localStorage.removeItem('arkengine:auto-shelter:enabled:v1');localStorage.setItem('arkengine:auto-encounter:enabled:v1','false');`,path);
      if(path==='/cultivate')await evaluate(`localStorage.setItem('arkengine:auto-shelter:enabled:v1','true');window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-shelter:enabled:v1',newValue:'true'}));`);
      for(let i=0;i<3;i++)await pulse(10000);
      assert.equal(await evaluate('sm.reads'),0);assert.deepEqual(await evaluate('sm.calls'),[]);
      assert.equal(await evaluate('location.pathname'),path);
    }
  });
  await t.test('避难所：暂停总开关、独立开关或离开路由后丢弃迟到读取',async()=>{
    for(const cancel of [`${panel}.getElementById('toggle').click()`,`${panel}.getElementById('shelter-toggle').click()`,
      `history.pushState({},'','/cultivate');window.dispatchEvent(new Event('focus'))`]){
      await setupShelter('sm.deferRead=true;');
      await until(()=>evaluate('!!sm.resolveRead'),'read started');await evaluate(cancel);await pulse();
      await evaluate('sm.resolveRead()');await pulse(5000);
      assert.deepEqual(await evaluate('sm.calls'),[]);
    }
  });
  await t.test('避难所：未知领取保留记录，刷新后核对一次也不重复点击',async()=>{
    await setupShelter('sm.mode="unknown";');
    await drive('sm.calls.length===1','original collect submitted');
    assert.ok(await evaluate(pending));await reloadShelter();
    await drive(`${enabled}==='false' && location.pathname==='/activities/expedition'`,'unknown receipt isolated');
    assert.equal(await evaluate('sm.calls.length'),1);assert.ok(await evaluate(pending));
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('避难所：刷新后已到账的旧任务奖励可核对，不再领取',async()=>{
    await setupShelter(`${quiet}sm.view.state.tutorial={claimed:[1]};
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old',kind:'tutorial',targets:[1],at:clock-60000,vaultNo:77,
        before:{collected:0,day:'2026-10-10',month:'2026-10'}}));`);
    await drive(done,'old receipt reconciled');assert.equal(await evaluate(pending),null);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：旧收取已有成功响应，房间重新产满后仍可确认原结果',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.view.state.stats.collected=30;sm.view.state.resources.scrap=2100;
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old',kind:'collect',targets:[1],at:clock-3600000,vaultNo:77,
        result:{outcome:'ok',status:200},before:{collected:0,day:'2026-10-10',month:'2026-10',rooms:[{id:1,stored:30}]}}));`);
    await drive(done,'confirmed collection after refill');assert.equal(await evaluate(pending),null);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：其他房间手动收取不误确认未知的原领取',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.view.state.stats.collected=100;
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old',kind:'collect',targets:[1],at:clock-60000,vaultNo:77,
        before:{collected:0,day:'2026-10-10',month:'2026-10',rooms:[{id:1,stored:30}]}}));`);
    await drive(`${enabled}==='false'`,'do not accept unrelated collection');assert.ok(await evaluate(pending));assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：免费档部分成功后不整批重放，其他功能保持开启',async()=>{
    await setupShelter(`${quiet}sm.view.state.season.points=300;sm.mode='partial';`);
    await drive(`${enabled}==='false' && location.pathname==='/activities/expedition'`,'partial season retained');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1,2]);assert.deepEqual(await evaluate(`${pending}.targets`),[1,2]);
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('避难所：读取网络故障预约稍后检查，结构变化仅暂停避难所',async()=>{
    await setupShelter('sm.readError=true;');await drive(done,'network isolation');assert.equal(await evaluate(enabled),'true');
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await setupShelter('delete sm.view.state.resources.scrap;');
    await drive(`${enabled}==='false' && location.pathname==='/activities/expedition'`,'schema isolation');
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：游戏登录错误或账号切换停止总开关',async()=>{
    for(const code of ['sm.httpStatus=401;',`localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:88,nextAt:0,note:'旧账号'}));`]){
      await setupShelter(code);await drive(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')==='false'`,'account stop');
      assert.deepEqual(await evaluate('sm.calls'),[]);
    }
  });
  await t.test('避难所：手动弹窗不关闭、不切页，关闭后继续',async()=>{
    await setupShelter(`const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<h2>升级房间？</h2><button>确认</button>';document.body.append(d);`);
    for(let i=0;i<3;i++)await pulse(30000);
    assert.equal(await evaluate('sm.reads'),0);assert.equal(await evaluate('location.pathname'),'/shelter');
    await evaluate(`document.querySelector('[role="dialog"]').remove()`);await drive(done,'manual dialog dismissed',150);
  });
  await t.test('避难所：缺少旧版引导状态可读取，人员建议区分儿童、待产与闲置成人',async()=>{
    await setupShelter(`${quiet}delete sm.view.state.tutorial;sm.view.state.births=[{id:1,dueAt:clock+90000}];
      const p=sm.view.state.residents[0];sm.view.state.residents.push({...p,id:2,roomId:null},{...p,id:3,roomId:null,adultAt:clock+3600000});
      sm.view.state.residents[0].romance={partnerId:2};sm.view.state.residents[1].romance={partnerId:1};`);
    await drive(done,'advice and appointment');
    assert.match(await evaluate(`${state}.advice`),/闲置成人 1 人；培养感情 1 对，待产 1 个/);
    assert.ok(await evaluate(`${state}.nextAt-clock<=92000`));assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：损坏的领取日志阻止操作并保留原文',async()=>{
    await setupShelter(`localStorage.setItem('arkengine:auto-shelter:pending:v1','broken');`);
    for(let i=0;i<3;i++)await pulse();assert.equal(await evaluate('sm.reads'),0);assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:pending:v1')`),'broken');
  });
  await t.test('避难所：保存领取记录失败时不点击，远征总开关保持开启',async()=>{
    await setupShelter(`const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){
      if(key==='arkengine:auto-shelter:pending:v1')throw new DOMException('full','QuotaExceededError');return set.call(this,key,value);};`);
    await drive(`${enabled}==='false' && location.pathname==='/activities/expedition'`,'journal write failure');
    assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
}
