import assert from 'node:assert/strict';

export async function dialogRecoveryTests({t,setupDungeon,setupFarm,setupExp,evaluate,drive,pulse,trustedStaffKey}){
  const noDialog=`!document.querySelector('[role="dialog"],[role="alertdialog"]')`;
  await t.test('跨玩法弹窗恢复：秘境入场及扫荡说明变化后取消，不买票也不保留虚假进度',async()=>{
    for(const sweep of [false,true]){
      await setupDungeon(`dm.sweep=${sweep};const open=${sweep?'openSweep':'openDun'};window.${sweep?'openSweep':'openDun'}=(...args)=>{
        open(...args);document.querySelector('[role="alertdialog"] div').textContent='费用已变化，需要额外消费';};`,'/cultivate/dungeon');
      await drive(`location.pathname==='/cultivate'&&${noDialog}`,'changed dungeon confirmation cancelled');
      assert.equal(await evaluate(`dm.calls.filter(c=>['sweep','enter'].includes(c[0])).length`),0);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1'))`),null);
      assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-dungeon:state:v1')).run`),null);
    }
  });
  await t.test('跨玩法弹窗恢复：选种标题变化后关闭，保留体力并返回远征',async()=>{
    await setupFarm(`addRuns(6);const open=openSeeds;window.openSeeds=()=>{open();document.querySelector('[role="dialog"] h2').textContent='新版种子目录';};`,'/farm');
    const stamina=await evaluate('fm.stamina');
    await drive(`location.pathname==='/activities/expedition'&&${noDialog}`,'changed seed dialog closed');
    assert.equal(await evaluate(`fm.calls.filter(c=>c.type==='plant').length`),0);assert.equal(await evaluate('fm.stamina'),stamina);
  });
  await t.test('跨玩法弹窗恢复：派遣标题变化或确认按钮消失时撤销，不发队且不重复开窗',async()=>{
    for(const reason of ['title','button']){
      await setupExp(`const open=openDispatch;window.openDispatch=()=>{open();const d=document.querySelector('[role="dialog"]');
        ${reason==='title'?`d.querySelector('h2').textContent='新版派遣确认';`:`d.querySelector('#confirm-dispatch').remove();`}};`);
      await drive('model.opens===1','dispatch opened');await pulse(reason==='button'?16000:1000);
      await drive(noDialog,'dispatch cancelled');
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='dispatch').length`),0);assert.equal(await evaluate('model.opens'),1);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
    }
  });
  const features=[
    {name:'秘境',setup:code=>setupDungeon(`dm.sweep=true;${code}`,'/cultivate/dungeon'),open:'openSweep',wait:16000,back:'/cultivate',
      calls:`dm.calls.filter(c=>['enter','sweep'].includes(c[0])).length`,journal:'arkengine:auto-dungeon:pending:v1',enabled:'arkengine:auto-encounter:enabled:v1'},
    {name:'农场',setup:code=>setupFarm(`addRuns(6);${code}`,'/farm'),open:'openSeeds',wait:31000,back:'/activities/expedition',
      calls:`fm.calls.filter(c=>c.type==='plant').length`,journal:'arkengine:auto-farm:pending:v1',enabled:'arkengine:auto-farm:enabled:v1'},
    {name:'远征',setup:setupExp,open:'openDispatch',wait:16000,back:'/activities/expedition',
      calls:`model.calls.filter(c=>c.type==='dispatch').length`,journal:'arkengine:auto-expedition:pending:v1',enabled:'arkengine:auto-expedition:enabled:v1'}
  ];
  const dialog=`document.querySelector('[role="dialog"],[role="alertdialog"]')`;
  const wrap=(f,code)=>`const originalOpen=${f.open};window.${f.open}=(...args)=>{originalOpen(...args);const d=${dialog};${code}};`;
  await t.test('跨玩法弹窗恢复：选种和派遣模式点击无效时撤销，不无限重复',async()=>{
    for(const f of features.filter(f=>['农场','远征'].includes(f.name))){
      await f.setup((f.name==='远征'?'model.complete=false;':'')+wrap(f,`${f.name==='农场'?`d.querySelector('#all-plots')`:`d.querySelector('[role="tab"]')`}.onclick=()=>window.modeClicks=(window.modeClicks||0)+1;`));
      await drive('window.modeClicks>0',`${f.name} mode attempted`);
      await pulse(f.wait);
      await drive(`${noDialog}&&location.pathname==='${f.back}'`,`${f.name} unchanged mode cancelled`);
      assert.equal(await evaluate(f.calls),0);
      assert.equal(await evaluate('modeClicks'),1);
    }
  });
  for(const f of features){
    await t.test(`跨玩法弹窗恢复：${f.name}后台恢复后有效窗口继续本轮，不重复开窗`,async()=>{
      await f.setup(`window.autoOpens=0;`+wrap(f,'window.autoOpens++;'));
      await drive(`!!${dialog}`,`${f.name} valid window opened`);
      await pulse(60000);
      await drive(`${f.calls}===1`,`${f.name} resumes original window`);
      assert.equal(await evaluate('autoOpens'),1);
    });
    await t.test(`跨玩法弹窗恢复：${f.name}缺少操作控件时超时撤销并继续`,async()=>{
      await f.setup(wrap(f,`d.querySelectorAll('button').forEach(b=>{if(!/^(取消|关闭)$/.test(b.textContent))b.remove();});`));
      await drive(`!!${dialog}`,`${f.name} window opened`);await pulse(f.wait);
      await drive(`${noDialog}&&location.pathname==='${f.back}'`,`${f.name} missing control cancelled`);
      assert.equal(await evaluate(f.calls),0);
      await pulse();
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('${f.journal}'))`),null);
    });
    await t.test(`跨玩法弹窗恢复：${f.name}延后渲染仍能撤销异常窗口`,async()=>{
      await f.setup(wrap(f,`window.delayedWindow=d;d.remove();`));
      await drive('!!window.delayedWindow',`${f.name} open attempted`);
      await evaluate(`clock+=6000;delayedWindow.querySelector('h2').textContent='变更后的窗口';
        ${f.name==='秘境'?`delayedWindow.querySelector('div').textContent='变更后的费用';`:''}
        document.body.append(delayedWindow);window.dispatchEvent(new Event('focus'));`);
      await drive(`${noDialog}&&location.pathname==='${f.back}'`,`${f.name} delayed window cancelled`);
      assert.equal(await evaluate(f.calls),0);
    });
    await t.test(`跨玩法弹窗恢复：${f.name}关闭首击无效只补一次，两次失败或缺控件则暂停`,async()=>{
      for(const mode of ['second','never','missing']){
        await f.setup(`window.closeTimes=[];`+wrap(f,`d.querySelector('h2').textContent='变更后的窗口';
          ${f.name==='秘境'?`d.querySelector('div').textContent='变更后的费用';`:''}
          const close=[...d.querySelectorAll('button')].find(b=>/^(取消|关闭)$/.test(b.textContent));const original=close.onclick;
          ${mode==='missing'?`close.remove();`:`close.onclick=()=>{closeTimes.push(clock);${mode==='second'?`if(closeTimes.length===2)original();`:''}};`}`));
        await drive(`!!${dialog}`,`${f.name} open`);
        if(mode==='second'){
          await drive(`${noDialog}&&location.pathname==='${f.back}'`,`${f.name} second cancellation succeeds`);
          const times=await evaluate('closeTimes');assert.equal(times.length,2);assert.ok(times[1]-times[0]>=5000);
        }else{
          await drive(`localStorage.getItem('${f.enabled}')==='false'`,`${f.name} close failure pauses`);
          assert.equal(await evaluate('closeTimes.length'),mode==='never'?2:0);
          const pending=await evaluate(`sessionStorage.getItem('${f.journal}')`);
          await pulse(60000);
          assert.ok(await evaluate(`!!${dialog}`));assert.equal(await evaluate('closeTimes.length'),mode==='never'?2:0);
          assert.equal(await evaluate(`sessionStorage.getItem('${f.journal}')`),pending);
        }
        assert.equal(await evaluate(f.calls),0);
      }
    });
    await t.test(`跨玩法弹窗恢复：${f.name}人工接手、同名替换和多窗口不被接管`,async()=>{
      for(const mode of ['manual','replace','multiple']){
        await f.setup(wrap(f,mode==='multiple'?`const extra=d.cloneNode(true);document.body.append(extra);window.extraWindow=extra;`:''));
        await drive(`!!${dialog}`,`${f.name} original open`);
        if(mode==='manual'){
          await evaluate(`${dialog}.setAttribute('tabindex','-1');${dialog}.focus();`);await trustedStaffKey();
        }else if(mode==='replace'){
          await evaluate(`${dialog}.remove();${f.open}();`);
        }else{
          await pulse(1000);await evaluate('extraWindow.remove();');
        }
        await evaluate(`window.protectedWindow=${dialog};`);
        const pending=await evaluate(`sessionStorage.getItem('${f.journal}')`);
        for(let i=0;i<4;i++)await pulse(i===0?f.wait:3000);
        assert.equal(await evaluate('protectedWindow.isConnected'),true,mode);
        assert.equal(await evaluate(f.calls),0,mode);
        assert.equal(await evaluate(`sessionStorage.getItem('${f.journal}')`),pending,mode);
      }
    });
    await t.test(`跨玩法弹窗恢复：${f.name}取消后出现替换窗口仍保留原记录`,async()=>{
      await f.setup(wrap(f,`d.querySelector('h2').textContent='变更后的窗口';
        ${f.name==='秘境'?`d.querySelector('div').textContent='变更后的费用';`:''}
        const close=[...d.querySelectorAll('button')].find(b=>/^(取消|关闭)$/.test(b.textContent));
        close.onclick=()=>{d.remove();originalOpen();window.replacementWindow=${dialog};};`));
      await drive(`!!${dialog}`,`${f.name} original open`);
      const pending=await evaluate(`sessionStorage.getItem('${f.journal}')`);
      await drive('!!window.replacementWindow',`${f.name} cancelled window replaced`);
      for(let i=0;i<3;i++)await pulse(i===0?f.wait:3000);
      assert.equal(await evaluate('replacementWindow.isConnected'),true);
      assert.equal(await evaluate(f.calls),0);
      assert.equal(await evaluate(`sessionStorage.getItem('${f.journal}')`),pending);
    });
  }
}
