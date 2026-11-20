import assert from 'node:assert/strict';
import {stockHistoricalRequest} from './arkengine-stock-history.fixture.mjs';
export async function stockExitOnlyTests({t,setupStock,reloadStock,evaluate,pulse,drive}){
  const ledger=`JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'))`,done=`location.pathname==='/activities/expedition'`;
  const settings=`localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({trade:true,predict:true,
    tradeLimit:3000,predictionLimit:500,stake:100,reserve:100}));`;
  await t.test('股市空转浏览器：停滞旧仓逐步降频，刷新不提前回访，手动检查恢复后照常兑现盈利',async()=>{
    await setupStock(settings+`km.saleReceipt=true;km.view.stocks[0].stale=true;km.view.stocks[0].priceCents=1000;
      km.view.positions=[{stockId:1,shares:100,costBasisTokens:1000,holdUntil:null}];
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'旧仓',hold:false,
        entries:[],pending:null,owned:{'1':{shares:100,cost:1000,modelName:'模型甲',manual:false}}}));`);
    await drive(done,'initial stagnant position');
    for(const delay of [300000,900000,1800000]){
      assert.equal(await evaluate(`${ledger}.idleCheck.delay`),delay);
      const due=await evaluate(`${ledger}.nextAt`);
      await reloadStock();await drive(done,'reload preserves idle appointment');
      assert.equal(await evaluate(`${ledger}.nextAt`),due);
      const reads=await evaluate('km.reads');await pulse(60000);
      assert.equal(await evaluate('km.reads'),reads,'no early stock requests');
      assert.equal(await evaluate('km.calls.length'),0);
      if(delay===1800000)break;
      await pulse(await evaluate(`${ledger}.nextAt-clock+1`));
      await drive(`${ledger}.nextAt>${due}&&${done}`,'next idle appointment');
    }
    await evaluate(`km.view.stocks[0].priceCents=1050;document.getElementById('ark-auto-expedition').shadowRoot.getElementById('stock-check').click();`);
    await drive(`km.calls.length===1&&!${ledger}.pending`,'manual recheck sells profitable old lot');
    assert.equal(await evaluate('km.calls[0].action'),'sell');
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),1023);
    assert.equal(await evaluate(`${ledger}.entries[0].releasedCost`),1000);
  });
  await t.test('股市空转浏览器：空仓每小时核对，原单未知仍按原节奏保留核对',async()=>{
    await setupStock(settings);await drive(done,'empty stock account');
    assert.equal(await evaluate(`${ledger}.idleCheck.delay`),3600000);
    const reads=await evaluate('km.reads');await pulse(300000);
    assert.equal(await evaluate('km.reads'),reads);assert.equal(await evaluate('location.pathname'),'/activities/expedition');
    await setupStock(settings+stockHistoricalRequest({result:null}));await drive(done,'unknown original stock request');
    assert.equal(await evaluate(`${ledger}.idleCheck`),null);
    assert.equal(await evaluate(`${ledger}.pending.key`),'old-buy-request');
  });
  await t.test('整合股市浏览器：保存旧买卖及预测开关也只观察，新买与下注均不发送',async()=>{
    await setupStock(settings+`km.view.rounds=[{id:42,stockId:1,ruleVersion:2,oddsBp:180,
      lockAt:new Date(clock+240000).toISOString(),closeAt:new Date(clock+900000).toISOString()}];`);
    await drive(done,'exit-only observation');assert.equal(await evaluate('km.calls.length'),0);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const d=events.find(e=>e.type==='stock-decision')?.data;
    assert.ok(d);assert.equal(d.policy.newBuy,false);assert.equal(d.policy.predict,false);assert.equal(d.selected,null);
    assert.match(JSON.stringify(events.filter(e=>e.type==='stock-decision-detail')),/new-buy-unverified/);
    assert.equal(await evaluate(`${ledger}.pending`),null);
    const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
    assert.equal(await evaluate(`${panel}.getElementById('stock-predict').disabled`),true);
    assert.equal(await evaluate(`${panel}.getElementById('stock-predict').checked`),false);
    await reloadStock();await drive(done,'exit-only after refresh');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('整合股市浏览器：只出不进仍卖出旧仓，回执与实际到账只记一次',async()=>{
    await setupStock(settings+`km.saleReceipt=true;
      km.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'旧仓',hold:false,
        entries:[],pending:null,owned:{'1':{shares:10,cost:100,modelName:'模型甲',manual:false}}}));`);
    await drive(done,'old lot sale');
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell']);
    assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);
    assert.equal(await evaluate(`${ledger}.entries[0].releasedCost`),100);
    await reloadStock();await drive(done,'no new lot after exit');
    assert.equal(await evaluate('km.calls.length'),1);
  });
  const oldBuy=result=>settings+stockHistoricalRequest({result});
  await t.test('整合股市浏览器：旧买单结果未知不重试、不释放原预算，刷新仍保留',async()=>{
    await setupStock(oldBuy(null));await drive(done,'old unknown buy preserved');
    assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${ledger}.pending.key`),'old-buy-request');
    assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    assert.equal(await evaluate(`${ledger}.entries[0].result`),'reserved');
    await reloadStock();await drive(done,'old unknown buy after refresh');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending.key`),'old-buy-request');
  });
  await t.test('整合股市浏览器：旧买单成功凭据继续核对实际持仓，不因禁止新买而遗失原账',async()=>{
    await setupStock(oldBuy('success')+`km.view.positions=[{stockId:1,shares:10,costBasisTokens:123,
      holdUntil:new Date(clock+3600000).toISOString()}];`);
    await drive(done,'old confirmed buy reconciled');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.entries[0].result`),'success');
    assert.equal(await evaluate(`${ledger}.owned['1'].cost`),123);
    await reloadStock();await drive(done,'old confirmed buy no replay');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('整合股市浏览器：旧未知买入和预测跨日恢复信号及额度仍不续发，原键与预算不变',async()=>{
    for(const action of ['buy','predict']){
      await setupStock(settings+stockHistoricalRequest({action}));await drive(done,'historical unknown order');
      const original=await evaluate(`${ledger}.pending`),native=await evaluate(`sessionStorage.getItem('stock:request:77')`);
      await evaluate(`clock+=2*86400000;km.tokens=400000;
        km.view.ticks.forEach((v,i)=>v.createdAt=new Date(clock-(5-i)*300000).toISOString());
        km.view.rounds=[{id:42,stockId:1,ruleVersion:2,oddsBp:180,lockAt:new Date(clock+240000).toISOString(),closeAt:new Date(clock+900000).toISOString()}];`);
      await reloadStock();await drive(done,'restored funding and signal do not permit replay');
      assert.equal(await evaluate('km.calls.length'),0,action);
      assert.deepEqual(await evaluate(`${ledger}.pending`),original,action);
      assert.equal(await evaluate(`${ledger}.entries[0].debit`),original.choice.debit,action);
      assert.equal(await evaluate(`${ledger}.entries[0].result`),'reserved',action);
      assert.equal(await evaluate(`sessionStorage.getItem('stock:request:77')`),native,action);
    }
  });
  await t.test('整合股市浏览器：旧买单只有持仓变化无成功回执，不能把余额或仓位当成交凭据',async()=>{
    await setupStock(oldBuy(null)+`km.tokens-=123;km.view.positions=[{stockId:1,shares:10,costBasisTokens:123,holdUntil:null}];`);
    await drive(done,'holdings alone are not a receipt');await reloadStock();await drive(done,'unproven old fill remains pending');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending.result`),null);
    assert.equal(await evaluate(`${ledger}.entries[0].result`),'reserved');assert.deepEqual(await evaluate(`${ledger}.owned`),{});
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).totals['股市买入支出']||0`),0);
  });
  await t.test('整合股市浏览器：用户手动确认旧买入或预测后核对原回执，刷新不重复交易或支出',async()=>{
    for(const action of ['buy','predict']){
      await setupStock(settings+stockHistoricalRequest({action}));await drive(done,'unknown old order before manual confirmation');
      const original=await evaluate(`${ledger}.pending`);
      await evaluate(`stockAct(${JSON.stringify(action)},{})`);
      const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
      await evaluate(`${panel}.getElementById('stock-check').click();`);
      await drive(`${ledger}.pending===null`,'manual original receipt reconciled');await drive(done,'manual original accounted');
      assert.deepEqual(await evaluate('km.calls'),[{...original.input,idempotencyKey:original.key}]);
      assert.equal(await evaluate(`${ledger}.entries[0].result`),'success');
      assert.equal(await evaluate(`${ledger}.entries[0].debit`),original.choice.debit);
      const key=action==='buy'?'股市买入支出':'股市下注支出';
      const total=`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).totals[${JSON.stringify(key)}]`;
      assert.equal(await evaluate(total),original.choice.debit);
      await reloadStock();await drive(done,'manual receipt after refresh');
      assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(total),original.choice.debit);
    }
  });
  await t.test('整合股市浏览器：旧成功买单实际成本超过预留仍记实账并保留停止原因',async()=>{
    await setupStock(oldBuy('success')+`km.view.positions[0].costBasisTokens=200;km.tokens=9800;`);
    await drive(done,'historical overspend recorded');
    assert.equal(await evaluate(`${ledger}.pending`),null);assert.equal(await evaluate(`${ledger}.entries[0].debit`),200);
    assert.equal(await evaluate(`${ledger}.owned['1'].cost`),200);assert.equal(await evaluate(`${ledger}.hold`),true);
    assert.match(await evaluate(`${ledger}.holdReason`),/超过预留/);
    await reloadStock();await drive(done,'historical overspend survives reload');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.hold`),true);
  });
  await t.test('整合股市浏览器：手动确认旧单的错账号回执不入账，也不触发自动补发',async()=>{
    for(const action of ['buy','predict']){
      await setupStock(settings+stockHistoricalRequest({action})+`km.mode='wrong-user';`);
      await drive(done,'old order before wrong-account manual receipt');await evaluate(`stockAct(${JSON.stringify(action)},{})`);
      const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
      await evaluate(`${panel}.getElementById('stock-check').click();`);
      await drive(`location.pathname==='/stock'`,'read after wrong-account receipt');await drive(done,'wrong-account receipt remains unresolved');
      assert.equal(await evaluate(`${ledger}.pending.result`),null);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
      assert.equal(await evaluate(`${ledger}.entries[0].result`),'reserved');
      assert.equal(await evaluate(`${ledger}.entries[0].debit`),action==='buy'?123:100);
      await reloadStock();await drive(done,'wrong-account receipt across refresh');assert.equal(await evaluate('km.calls.length'),1);
      const totals=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).totals`);
      assert.equal(totals['股市买入支出']||0,0);assert.equal(totals['股市下注支出']||0,0);
    }
  });
}
