import assert from 'node:assert/strict';

export async function stockUnlockTests({t,setupStock,reloadStock,evaluate,pulse,drive}) {
  const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
  const ledger=`JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'))`;
  const done=`location.pathname==='/activities/expedition'`;
  const setup=`localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({trade:true,predict:false,tradeLimit:3000,predictionLimit:0,stake:0,reserve:100}));
    km.saleReceipt=true;km.unlockAt=clock+60000;
    km.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:new Date(km.unlockAt).toISOString()}];
    localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'locked',hold:false,pending:null,
      owned:{'1':{shares:10,cost:100,modelName:'模型甲',manual:false}},entries:[]}));`;
  await t.test('解锁复查浏览器：一分钟后解锁预约到期复查，提前不卖且刷新保留',async()=>{
    await setupStock(setup);await drive(done,'locked position schedules next check');
    const at=await evaluate('km.unlockAt');assert.equal(await evaluate(`${ledger}.nextAt`),at+1000);
    assert.equal(await evaluate('km.calls.length'),0);
    await reloadStock();assert.equal(await evaluate(`${ledger}.nextAt`),at+1000);
    await pulse(await evaluate('Math.max(0,km.unlockAt-clock-1000)'));
    assert.equal(await evaluate('km.calls.length'),0);
    await pulse(2000);await drive(`km.calls.length===1 && !${ledger}.pending`,'fresh check sells after unlocking');
    assert.equal(await evaluate('km.calls[0].action'),'sell');assert.equal(await evaluate('km.tokens'),10117);
    const checks=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-check')`);
    const scheduled=checks.find(e=>e.data.unlockRecheck);assert.equal(scheduled.data.unlockRecheck.holdUntil,at);
    assert.ok(scheduled.data.retryAfterMs<300000);
  });
  await t.test('解锁复查浏览器：到期报价变化重新评估，不执行旧止盈方案',async()=>{
    await setupStock(setup);await drive(done,'unlock check queued');
    assert.equal(await evaluate(`${ledger}.nextAt`),await evaluate('km.unlockAt+1000'));
    await evaluate(`km.view.stocks[0].priceCents=1030;km.view.ticks.forEach(t=>t.priceCents=1030);`);
    await pulse(await evaluate('km.unlockAt-clock+2000'));await drive(`${ledger}.valuation.at>=km.unlockAt && ${done}`,'fresh unlocked quote keeps position');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate('km.view.positions[0].shares'),10);
    assert.equal(await evaluate(`${ledger}.valuation.positions[0].status`),'holding');
    const check=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-check').at(-1)`);
    assert.equal(check.data.retryAfterMs,300000);assert.equal(check.data.unlockRecheck,null);
  });
  await t.test('解锁复查浏览器：观察、人工仓、停牌和长锁定不加速检查',async()=>{
    for(const change of [
      `const c=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));c.observeOnly=true;localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(c));`,
      `const l=${ledger};l.owned['1'].manual=true;localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`,
      `km.view.stocks[0].suspended=true;`,
      `km.view.positions[0].holdUntil=new Date(clock+3600000).toISOString();`
    ]){
      await setupStock(setup+change);await drive(done,'ineligible unlock uses normal checks');
      const check=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-check').at(-1)`);
      assert.equal(check.data.retryAfterMs,300000,change);assert.equal(check.data.unlockRecheck,null,change);
      assert.equal(await evaluate('km.calls.length'),0);
    }
  });
  await t.test('解锁复查浏览器：预约后暂停不卖出，刷新保持暂停',async()=>{
    await setupStock(setup);await drive(done,'unlock queued before pause');
    await evaluate(`${panel}.getElementById('stock-pause').click();`);
    await pulse(await evaluate('km.unlockAt-clock+2000'));assert.equal(await evaluate('km.calls.length'),0);
    await reloadStock();await pulse(10000);assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1')).trade`),false);
  });
}
