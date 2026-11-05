import assert from 'node:assert/strict';

export async function crossFeatureTests({t,setupFeatures,reloadFeatures,evaluate,pulse,drive,until,withDelayedStockNavigation}) {
  const shelterPending=`localStorage.getItem('arkengine:auto-shelter:pending:v1')`;
  const farmPending=`sessionStorage.getItem('arkengine:auto-farm:pending:v1')`;
  const shelfEnabled=`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`;
  const stock=`JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'))`;
  const done=`location.pathname==='/activities/expedition'&&${stock}?.pending===null&&${stock}?.entries.length===1`;
  const oldFarm=`sessionStorage.setItem('arkengine:auto-farm:pending:v1',JSON.stringify({action:'harvest',plots:[1],at:clock-60000,reloaded:true}));
    fm.crops=[{plot:1,key:fc[0].key,at:clock-1000}];`;

  await t.test('共享暂停延迟：农场、避难所和股市排队期间保存总暂停后均不继续写入或切页',async()=>{
    const status=`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent`;
    for(const path of ['/farm','/shelter','/stock']){
      await setupFeatures(`localStorage.setItem('arkengine:auto-farm:enabled:v1','true');
        fm.crops=[{plot:1,key:fc[0].key,name:fc[0].name,at:clock-1000}];`,path);
      await drive(`${status}.includes('随机等待')`,'feature queued before shared pause');
      const before=await evaluate(`({farm:${farmPending},shelter:${shelterPending},stock:${stock}})`);
      await evaluate(`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);
      await pulse(60000);
      assert.equal(await evaluate('location.pathname'),path);
      assert.equal(await evaluate(status),'已暂停');
      assert.deepEqual(await evaluate('fm.calls.filter(c=>c.type!=="read")'),[]);
      assert.deepEqual(await evaluate('sm.calls'),[]);
      assert.deepEqual(await evaluate('km.calls'),[]);
      assert.deepEqual(await evaluate(`({farm:${farmPending},shelter:${shelterPending},stock:${stock}})`),before);
    }
  });

  await t.test('玩法导航地址：损坏链接不阻断农场、避难所与股市，外站及新窗口链接不接管',async()=>{
    await setupFeatures(`localStorage.setItem('arkengine:auto-farm:enabled:v1','true');window.badNavigationClicks=[];
      for(const [href,target] of [['http://[',''],['https://example.invalid/farm',''],['/farm','_blank']]){
        const a=document.createElement('a');a.setAttribute('href',href);a.target=target;a.textContent='无效导航';
        a.onclick=event=>{event.preventDefault();badNavigationClicks.push(href);};document.body.prepend(a);
      }`);
    await drive(`fm.calls.some(c=>c.type==='plant')&&sm.calls.some(c=>c.type==='collect_all')&&${done}`,'all features skip invalid navigation links',240);
    assert.deepEqual(await evaluate('badNavigationClicks'),[]);
    assert.equal(await evaluate(`fm.calls.filter(c=>c.type==='plant').length`),1);
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['buy']);
  });

  await t.test('玩法隔离人员轮换：避难所到时限让股市运行，返回后接续原调岗而不重放',async()=>{
    const schedule=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`;
    const moves=`sm.calls.filter(c=>c.type==='assign')`;
    await setupFeatures(`localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      const original=sm.view.state.rooms[0],adult=sm.view.state.residents[0];
      sm.view.state.rooms=['scrap','power','diner','water','quarters'].map((type,i)=>({...original,id:i+1,type,width:i===4?3:1,stored:0}));
      sm.view.state.residents=Array.from({length:8},(_,i)=>({...structuredClone(adult),id:i+1,name:'居民'+(i+1),roomId:[2,3,4,1,1,2,3,4][i],
        stats:{str:10,per:10,end:17,cha:3,int:3,agi:10,lck:3},hp:i<3?100:1}));
      Object.assign(sm.view.state.residents[0].stats,{str:5,agi:17,per:0,end:0});
      Object.assign(sm.view.state.residents[1].stats,{str:0,agi:10,per:17,end:0});
      Object.assign(sm.view.state.residents[2].stats,{str:10,agi:0,per:10,end:0});`,'/shelter');
    await drive(`${moves}.length===1&&JSON.parse(${shelterPending})===null`,'allocation first step confirmed').catch(async error=>{
      error.message+=JSON.stringify(await evaluate(`({calls:sm.calls,schedule:${schedule},pending:${shelterPending},staff:document.getElementById('ark-auto-expedition').shadowRoot.getElementById('shelter-staff-status').textContent})`));throw error;
    });
    const id=await evaluate(`${schedule}.swap.id`);
    await pulse(61000);await drive(done,'stock served between allocation visits');
    assert.equal(await evaluate(`${moves}.length`),1);assert.equal(await evaluate(`${schedule}.swap.id`),id);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['buy']);
    await pulse(61000);await drive(`${moves}.length===4&&${schedule}.swap===null&&location.pathname==='/activities/expedition'`,'resume allocation after other feature',240);
    assert.deepEqual(await evaluate('sm.view.state.residents.slice(0,3).map(p=>p.roomId)'),[3,4,2]);
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`JSON.parse(${shelterPending})`),null);
  });

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
