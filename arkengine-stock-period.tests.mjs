import assert from 'node:assert/strict';
import {stockHistoricalRequest} from './arkengine-stock-history.fixture.mjs';

export async function stockPeriodTests({t,setupStock,reloadStock,evaluate,pulse,drive}) {
  const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
  const ledger=`JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'))`;
  const settings=`localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({trade:true,predict:false,
    tradeLimit:3000,predictionLimit:0,stake:0,reserve:100,lossLimit:100000,riskLimit:400000}));
    localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'old',hold:false,owned:{},entries:[],pending:null,
      archive:{buyCost:120000,knownProceeds:10000,releasedCost:120000,realized:-110000,unknownSales:36,predictionStake:0,predictionPaid:0,predictionNet:0}}));`;
  const done=`location.pathname==='/activities/expedition'`;
  const start=`${panel}.getElementById('stock-period-start').click()`;
  await t.test('新周期浏览器：明确启动只封存旧账，不恢复买入，刷新不重置且可以导出',async()=>{
    await setupStock(settings);await drive(done,'legacy risk blocks before explicit activation');
    assert.equal(await evaluate('km.calls.length'),0);
    const old=await evaluate(`${ledger}`);
    await evaluate(start);await drive(`${ledger}.period && !${ledger}.pending`,'period starts without reopening buys');
    const p=await evaluate(`${ledger}`);
    assert.deepEqual(p.periodArchive.ledger.archive,old.archive);assert.deepEqual(p.periodArchive.ledger.entries,old.entries);
    assert.equal(p.periodArchive.ledger.accounting.record.trialId,old.accounting.record.trialId);
    assert.notEqual(p.accounting.record.trialId,old.accounting.record.trialId);
    assert.equal(p.accounting.record.initialBudgetLoss,0);assert.equal(p.period.totals.unknownSales,36);
    await drive(done,'period first check finished');await reloadStock();await drive(done,'period reload');
    assert.equal(await evaluate(`${ledger}.period.id`),p.period.id);
    assert.equal(await evaluate(`${panel}.getElementById('stock-period-start').disabled`),true);
    assert.equal(await evaluate('km.calls.length'),0);
    await evaluate(`URL.createObjectURL=blob=>{window.periodExportBlob=blob;return 'blob:period-fixture';};HTMLAnchorElement.prototype.click=function(){};
      ${panel}.getElementById('stock-period-export').click();`);
    const exported=await evaluate(`periodExportBlob.text().then(text=>JSON.parse(text))`);
    assert.deepEqual(exported.archive,p.periodArchive);assert.equal(exported.period.id,p.period.id);
    assert.match(await evaluate(`${panel}.getElementById('stock-period-status').textContent`),/缺证据卖出 36 笔已封存/);
  });
  await t.test('新周期浏览器：旧仓原成本核对卖出，起点前浮亏不算新亏损',async()=>{
    await setupStock(settings+`km.saleReceipt=true;km.view.positions=[{stockId:1,shares:10,costBasisTokens:1000,holdUntil:null}];
      const l=${ledger};l.owned={'1':{shares:10,cost:1000,modelName:'模型甲',manual:false}};
      l.periodRequest={id:'approved-period',userId:77,at:clock};localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
    await drive(done,'period marks old lot then sells');
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell']);
    const p=await evaluate(`${ledger}`);assert.equal(p.entries[0].releasedCost,1000);assert.equal(p.entries[0].proceeds,117);
    assert.equal(p.accounting.report.periodNet.lower,0);assert.equal(p.accounting.report.loss,0);
    assert.equal(p.periodArchive.ledger.owned['1'].cost,1000);
    assert.equal(p.periodArchive.ledger.pending,null);
  });
  await t.test('新周期浏览器：原24小时额度不随切换重置，到期后仍不恢复自动买入',async()=>{
    await setupStock(settings+`const l=${ledger};l.entries=[{id:'old-buy',at:clock-3600000,action:'buy',stockId:2,debit:3000,result:'success'}];
      l.periodRequest={id:'quota-period',userId:77,at:clock};localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
    await drive(done,'period retains rolling quota');assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),3000);assert.equal(await evaluate(`${ledger}.period.id`),'quota-period');
    await evaluate(`clock+=86400000;km.view.ticks=[1000,1040,1080,1120,1160,1200].map((priceCents,i)=>({stockId:1,priceCents,createdAt:new Date(clock-(5-i)*300000).toISOString()}));
      ${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'visit after rolling quota expires');await drive(done,'quota expires without reopening buys');
    assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),3000);
    assert.equal(await evaluate(`${ledger}.period.id`),'quota-period');
  });
  await t.test('新周期浏览器：原子写入失败不丢旧账或发单，刷新后只完成原预约',async()=>{
    await setupStock(settings+`const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
      if(k==='arkengine:auto-stock:ledger:v1'&&JSON.parse(v).period)throw new DOMException('quota','QuotaExceededError');return original.call(this,k,v);};`);
    await drive(done,'legacy wait before quota failure');await evaluate(start);await pulse(20000);
    const p=await evaluate(`${ledger}`);assert.ok(p.periodRequest);assert.equal(p.period,undefined);assert.equal(p.periodArchive,undefined);
    assert.equal(p.archive.unknownSales,36);assert.equal(await evaluate('km.calls.length'),0);
    await reloadStock();await drive(`${ledger}.period && !${ledger}.pending`,'saved activation survives write failure');
    await drive(done,'recovered period remains exit-only');assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${ledger}.period.id`),p.periodRequest.id);
    assert.equal(await evaluate(`${ledger}.periodArchive.ledger.archive.unknownSales`),36);
  });
  await t.test('新周期浏览器：未决原单不能切换周期或清除预留',async()=>{
    await setupStock(settings+stockHistoricalRequest());
    await drive(done,'historical unknown original preserved');const p=await evaluate(`${ledger}.pending`);
    assert.equal(await evaluate(`${panel}.getElementById('stock-period-start').disabled`),true);
    await evaluate(start);assert.equal(await evaluate(`${ledger}.period`),undefined);
    assert.equal(await evaluate(`${ledger}.pending.id`),p.id);assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${ledger}.entries[0].result`),'reserved');
  });
  await t.test('新周期浏览器：封存记录损坏保持原文并停止，不以再次开周期绕过',async()=>{
    await setupStock(settings);await drive(done,'old risk');await evaluate(start);await drive(`${ledger}.period && !${ledger}.pending`,'period created');
    await drive(done,'period done');
    const good=await evaluate(`${ledger}`);
    for(const corrupt of ['l.periodArchive.ledger.archive.unknownSales=35','l.accounting.record.openingEquity++']){
      await evaluate(`const l=${JSON.stringify(good)};${corrupt};localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
      const raw=await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`);
      await reloadStock();await pulse(10000);
      assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),raw);
      assert.equal(await evaluate(`${panel}.getElementById('stock-period-start').disabled`),true);
    }
  });
  await t.test('新周期浏览器：报价缺失时保留预约和旧账，刷新及报价恢复后开启同一周期',async()=>{
    await setupStock(settings+`km.saleReceipt=true;km.view.stocks[0].suspended=true;
      km.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];
      const l=${ledger};l.owned={'1':{shares:10,cost:100,modelName:'模型甲',manual:false}};
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
    await drive(done,'old suspended position');await evaluate(start);await drive(`${ledger}.note.includes('新周期等待') && ${done}`,'missing quote waits');
    const request=await evaluate(`${ledger}.periodRequest`);assert.ok(request);assert.equal(await evaluate(`${ledger}.period`),undefined);
    assert.equal(await evaluate('km.calls.length'),0);await reloadStock();await drive(done,'waiting survives reload');
    assert.equal(await evaluate(`${ledger}.periodRequest.id`),request.id);
    await evaluate(`km.view.stocks[0].suspended=false;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.period && !${ledger}.pending && km.calls.length===1`,'quote recovers');
    assert.equal(await evaluate(`${ledger}.period.id`),request.id);assert.equal(await evaluate(`${ledger}.periodArchive.ledger.archive.unknownSales`),36);
  });
  await t.test('新周期阻塞回归：日志中的两只停滞旧仓不再卡住已预约周期，强信号也不新增买入',async()=>{
    await setupStock(settings+`km.saleReceipt=true;km.tokens=491181;
      km.view.rules={buyFeePct:2,sellFeePct:2.5,maxTradeTokens:100000,maxDailyBuyTokens:500000,maxPositionTokens:1000000,reserveTokens:1563879};
      km.view.dailyBoughtTokens=0;
      km.view.stocks.push({id:195716,modelName:'jev-latest',priceCents:1711,volume24h:2076,stale:true},
        {id:298646,modelName:'mimo-v2.6-flash',priceCents:872,volume24h:9903,stale:true});
      km.view.positions=[{stockId:195716,shares:121,costBasisTokens:2076,holdUntil:new Date(clock-3600000).toISOString()},
        {stockId:298646,shares:1097,costBasisTokens:9903,holdUntil:new Date(clock-3600000).toISOString()}];
      const l=${ledger};l.archive={buyCost:1215102,knownProceeds:631808,releasedCost:954254,realized:-35999,unknownSales:36,
        predictionNet:-840,predictionStake:1600,predictionPaid:760};
      l.owned={'195716':{shares:121,cost:2076,modelName:'jev-latest',manual:false},
        '298646':{shares:1097,cost:9903,modelName:'mimo-v2.6-flash',manual:false}};
      l.periodRequest={id:'approved-before-update',userId:77,at:clock-86400000};
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));
      const c=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));c.autoBudget=true;c.netEfficiency=true;
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(c));`);
    await drive(`${ledger}.period && !${ledger}.pending`,'approved period starts despite stale holdings');
    await drive(done,'period activation stays exit-only');
    const p=await evaluate(`${ledger}`);
    assert.equal(p.period.id,'approved-before-update');assert.equal(p.periodRequest,undefined);
    assert.equal(p.period.totals.unknownSales,36);assert.equal(p.periodArchive.ledger.archive.realized,-35999);
    assert.equal(p.accounting.record.openingEquity,411344);
    assert.deepEqual(await evaluate('km.calls'),[]);assert.deepEqual(p.entries,[]);
    assert.equal(p.owned['195716'].shares,121);assert.equal(p.owned['298646'].shares,1097);
    await reloadStock();await drive(done,'new period survives reload without restarting');
    assert.equal(await evaluate(`${ledger}.period.id`),p.period.id);assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('新周期阻塞回归：真正缺报价继续等待，但账本刷新和其他合法卖出仍执行',async()=>{
    await setupStock(settings+`km.saleReceipt=true;km.view.stocks[0].suspended=true;
      km.view.stocks.push({id:2,modelName:'可退出旧仓',priceCents:1200,volume24h:1000,stale:true});
      km.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null},{stockId:2,shares:10,costBasisTokens:1000,holdUntil:null}];
      const l=${ledger};l.owned={'1':{shares:10,cost:100,modelName:'模型甲',manual:false},
        '2':{shares:10,cost:1000,modelName:'可退出旧仓',manual:false}};
      l.periodRequest={id:'waiting-for-suspension',userId:77,at:clock};
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
    await drive(done,'waiting period still manages a separate exit');
    let p=await evaluate(`${ledger}`);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell']);
    assert.equal(p.entries[0].proceeds,117);assert.equal(p.entries[0].releasedCost,1000);
    assert.equal(p.period,undefined);assert.equal(p.periodRequest.id,'waiting-for-suspension');
    assert.match(p.note,/新周期等待/);const previous=p.accounting.report.at;
    await pulse(1000);await evaluate(`${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.accounting.report.at>${previous} && ${done}`,'accounting keeps refreshing while quote remains unavailable');
    p=await evaluate(`${ledger}`);assert.equal(p.archive.unknownSales,36);assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('新周期阻塞回归：已过七天的原始交易先封存，随后日常归档不丢证据',async()=>{
    await setupStock(settings+`const l=${ledger};
      l.entries=[{id:'old-raw-proof',at:clock-8*86400000,debit:123,action:'buy',result:'success',stockId:2}];
      l.periodRequest={id:'preserve-original-rows',userId:77,at:clock};
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
    await drive(`${ledger}.period && !${ledger}.pending`,'period archives original expired evidence');
    await drive(done,'original evidence preserved during activation');
    assert.equal(await evaluate(`${ledger}.periodArchive.ledger.entries[0].id`),'old-raw-proof');
    // With no new buy there is no transaction-triggered second read. Retention
    // runs on the next scheduled visit after the original rows were archived.
    await pulse(300001);await drive(`${ledger}.entries.length===0 && ${done}`,'scheduled retention after activation');
    const p=await evaluate(`${ledger}`);
    assert.equal(p.periodArchive.ledger.entries[0].id,'old-raw-proof');
    assert.equal(p.periodArchive.ledger.entries[0].debit,123);
    assert.equal(p.period.totals.buyCost,120123);
    assert.ok(!p.entries.some(e=>e.id==='old-raw-proof'));
    assert.equal(p.archive.buyCost,120123);
    assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('新周期阻塞回归：未知人工交易或孤立预留仍阻止卖出，不能借等待分支绕过',async()=>{
    for(const kind of ['manual','reserved']){
      await setupStock(settings+`km.saleReceipt=true;
        km.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];
        const l=${ledger};l.owned={'1':{shares:10,cost:100,modelName:'模型甲',manual:false}};
        l.periodRequest={id:'pending-evidence',userId:77,at:clock};
        if('${kind}'==='reserved')l.entries=[{id:'unresolved',at:clock,debit:100,action:'buy',result:'reserved',stockId:1}];
        else{const id='a'.repeat(64);localStorage.setItem('arkengine:income-stock:v1:77:'+id,JSON.stringify({version:1,id,
          input:{action:'buy',modelName:'模型甲',shares:1,expectedUserId:77},at:clock,page:'closed-manual-page',
          before:null,confirmed:false,flow:false,settled:false,ambiguous:true,automatic:false,betId:null}));}
        localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
      await drive(done,'unresolved trade keeps period and blocks all orders');
      assert.equal(await evaluate('km.calls.length'),0,kind);assert.equal(await evaluate(`${ledger}.period`),undefined);
      assert.equal(await evaluate(`${ledger}.periodRequest.id`),'pending-evidence');
      assert.equal(await evaluate('km.view.positions[0].shares'),10);
      assert.match(await evaluate(`${ledger}.note`),/新周期等待/);
    }
  });
  await t.test('新周期阻塞回归：先核对已结算预测再开周期，未结算时保留预约且不新增风险',async()=>{
    await setupStock(settings+`const l=${ledger};
      l.entries=[{id:'old-bet',at:clock-3600000,debit:100,action:'predict',result:'success',stockId:1,roundId:9,betId:19}];
      l.periodRequest={id:'after-settlement',userId:77,at:clock};
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));
      km.view.myBets=[{id:19,roundId:9,betTokens:100,settled:false}];`);
    await drive(done,'unsettled prediction preserves period request');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.period`),undefined);
    await evaluate(`km.view.myBets[0].settled=true;km.view.myBets[0].payoutTokens=180;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.period && !${ledger}.pending`,'settlement unblocks the same period');
    await drive(done,'settlement and period activation do not reopen orders');assert.equal(await evaluate('km.calls.length'),0);
    const p=await evaluate(`${ledger}`);assert.equal(p.period.id,'after-settlement');
    assert.equal(p.periodArchive.ledger.entries[0].settlement.payout,180);
    assert.equal(p.period.totals.predictionNet,80);assert.equal(p.period.totals.unknownSales,36);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.equal(events.filter(e=>e.type==='stock-prediction-settled').length,1);
    assert.equal(events.filter(e=>e.type==='stock-period-started').length,1);
  });
}
