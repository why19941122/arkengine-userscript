import assert from 'node:assert/strict';

export async function crossFeatureTests({t,setupFeatures,reloadFeatures,evaluate,pulse,drive,until,withDelayedStockNavigation}) {
  const shelterPending=`localStorage.getItem('arkengine:auto-shelter:pending:v1')`;
  const farmPending=`sessionStorage.getItem('arkengine:auto-farm:pending:v1')`;
  const shelfEnabled=`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`;
  const stock=`JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'))`;
  const done=`location.pathname==='/activities/expedition'&&${stock}?.pending===null&&${stock}?.entries.length===1`;
  const oldFarm=`sessionStorage.setItem('arkengine:auto-farm:pending:v1',JSON.stringify({action:'harvest',plots:[1],at:clock-60000,reloaded:true}));
    fm.crops=[{plot:1,key:fc[0].key,at:clock-1000}];`;

  await t.test('玩法隔离探险快照：成功回执后旧探险仍在时只读等待，股市继续运行且不补领',async()=>{
    await setupFeatures(`localStorage.setItem('arkengine:auto-shelter:explore-claim:v1','true');
      const s=sm.view.state;s.rooms[0].stored=0;s.residents[0].away={kind:'explore'};
      s.explorers=[{id:11,residentId:1,startedAt:clock-3600000,returnAt:clock-1,tier:0,abyss:false,
        stimpaks:0,loot:{scrap:50,parts:0,stimpak:0,items:[]}}];sm.beforeClaimView=structuredClone(sm.view);`,'/shelter');
    await drive('sm.calls.length===1','explorer claim before stale cross-feature view');
    await until(()=>evaluate(`Boolean(JSON.parse(${shelterPending})?.result?.proof)`),'explorer receipt before cross-feature wait');
    const original=await evaluate(shelterPending);
    await evaluate(`sm.view=structuredClone(sm.beforeClaimView);sm.mode='unknown';renderShelter();`);
    await drive(done,'stock continues while stale explorer waits');
    assert.equal(await evaluate(shelterPending),original);assert.equal(await evaluate(shelfEnabled),'true');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_claim']);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['buy']);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).pendingReadOnly`),JSON.parse(original).id);
  });
  await t.test('玩法隔离：避难所原领取超时只读核对时股市仍运行，保留原记录不补领',async()=>{
    await setupFeatures(`sm.mode='unknown';`,'/shelter');
    await drive('sm.calls.length===1','shelter original sent');
    const original=await evaluate(shelterPending);await pulse(31000);
    await drive(done,'stock proceeds after shelter isolation');
    assert.equal(await evaluate(shelfEnabled),'true');assert.equal(await evaluate(shelterPending),original);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).pendingReadOnly`),JSON.parse(original).id);
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['buy']);
  });
  await t.test('玩法隔离：已暂停农场保留旧收获记录，不阻塞避难所和股市，刷新不重放',async()=>{
    await setupFeatures(oldFarm);const original=await evaluate(farmPending);
    await drive(done,'other features proceed past paused farm');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['buy']);
    assert.equal(await evaluate(farmPending),original);
    assert.equal(await evaluate(`fm.calls.filter(c=>['plant','harvest'].includes(c.type)).length`),0);
    await reloadFeatures();await pulse(20000);
    assert.equal(await evaluate(farmPending),original);assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('玩法隔离：其他玩法仍在核对时避难所让出页面，不将自己永久关闭',async()=>{
    await setupFeatures(`${oldFarm}localStorage.setItem('arkengine:auto-farm:enabled:v1','true');`,'/shelter');
    await drive(`location.pathname==='/farm'`,'yield to active farm reconciliation');
    assert.equal(await evaluate(shelfEnabled),'true');assert.equal(await evaluate('sm.calls.length'),0);assert.equal(await evaluate('km.calls.length'),0);
    assert.ok(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).nextAt<=clock+60000`));
    await drive(`localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'`,'farm original remains unknown');
    await pulse(61000);await drive(`sm.calls.length===1&&${done}`,'remaining features resume without manual restart');
    assert.equal(await evaluate(shelfEnabled),'true');assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('玩法隔离：股市原交易未知时仍处理避难所，不清交易记录或新建第二笔',async()=>{
    await setupFeatures(`km.mode='unknown';`,'/stock');await drive('km.calls.length===1','stock original submitted');
    await pulse(61000);await drive('sm.calls.length===1','shelter collects during stock wait');
    assert.ok(await evaluate(`${stock}.pending`));assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(shelfEnabled),'true');
  });
  await t.test('玩法隔离：账号异常和人工总暂停继续停止全部玩法，不能借故障隔离恢复',async()=>{
    for(const code of [`sm.httpStatus=401;`,`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`]){
      await setupFeatures(code,'/shelter');await pulse(60000);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
      assert.equal(await evaluate('sm.calls.length'),0);assert.equal(await evaluate('km.calls.length'),0);
    }
  });
  await t.test('玩法隔离导航：暂停农场旧记录及隐藏弹窗不阻塞股市切页的有限恢复',async()=>{
    for(const extra of [oldFarm,`const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.hidden=true;document.body.append(dialog);`]){
      await setupFeatures(`localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');${extra}`);
      const original=await evaluate(farmPending);
      await evaluate(`document.querySelector('a[href="/stock"]').remove();`);
      await withDelayedStockNavigation(async(count,stopLoading)=>{
        await Promise.all([pulse(5000),until(()=>count()===1,'first stock navigation').then(stopLoading)]);
        await pulse(15000);assert.equal(count(),1);
        await Promise.all([pulse(16000),until(()=>count()===2,'single stock navigation recovery').then(stopLoading)]);
        await pulse(60000);assert.equal(count(),2);assert.equal(await evaluate('km.calls.length'),0);
        assert.equal(await evaluate(farmPending),original);
      });
    }
  });
  await t.test('玩法隔离导航：可见弹窗和仍启用的农场原记录继续阻止强制切页，解除后仅恢复一次',async()=>{
    for(const mode of ['dialog','active-farm']){
      await setupFeatures(`localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');${mode==='active-farm'?oldFarm:''}`);
      await evaluate(`document.querySelector('a[href="/stock"]').remove();`);
      await withDelayedStockNavigation(async(count,stopLoading)=>{
        await Promise.all([pulse(5000),until(()=>count()===1,'initial navigation before blocker').then(stopLoading)]);
        if(mode==='dialog')await evaluate(`const d=document.createElement('div');d.setAttribute('role','dialog');d.textContent='手动确认';document.body.append(d);`);
        else await evaluate(`localStorage.setItem('arkengine:auto-farm:enabled:v1','true');window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-farm:enabled:v1',newValue:'true'}));`);
        await pulse(31000);assert.equal(count(),1);assert.equal(await evaluate('km.calls.length'),0);
        if(mode==='dialog')await evaluate(`document.querySelector('[role="dialog"]').remove();`);
        else await evaluate(`localStorage.setItem('arkengine:auto-farm:enabled:v1','false');window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-farm:enabled:v1',newValue:'false'}));`);
        await Promise.all([pulse(),until(()=>count()===2,'resume limited navigation after blocker').then(stopLoading)]);
        await pulse(60000);assert.equal(count(),2);assert.equal(await evaluate('km.calls.length'),0);
      });
    }
  });
}
