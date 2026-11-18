import assert from 'node:assert/strict';
import {stockSnapshotsFromLog} from './arkengine-stock-replay.mjs';
import {stockRetentionTests} from './arkengine-stock-retention.tests.mjs';
import {stockPeriodTests} from './arkengine-stock-period.tests.mjs';
import {stockUnlockTests} from './arkengine-stock-unlock.tests.mjs';
import {stockExitOnlyTests} from './arkengine-stock-exit-only.tests.mjs';
import {stockHistoricalRequest} from './arkengine-stock-history.fixture.mjs';

export async function stockTests({t,setupStock,reloadStock,evaluate,pulse,drive,until,secondStock,trustedStaffKey,withDelayedStockNavigation}) {
  await stockExitOnlyTests({t,setupStock,reloadStock,evaluate,pulse,drive});
  await stockRetentionTests({t,setupStock,reloadStock,evaluate,until});
  await stockPeriodTests({t,setupStock,reloadStock,evaluate,pulse,drive});
  await stockUnlockTests({t,setupStock,reloadStock,evaluate,pulse,drive});
  const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
  const ledger=`JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'))`;
  const cfg=`{trade:true,predict:false,tradeLimit:3000,predictionLimit:500,stake:100,reserve:100}`;
  const settings=`localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(${cfg}));`;
  const prediction=`localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},trade:false,predict:true}));
    km.view.rounds=[{id:42,stockId:1,ruleVersion:2,oddsBp:180,lockAt:new Date(clock+240000).toISOString(),closeAt:new Date(clock+900000).toISOString()}];`;
  const oldPrediction=prediction+stockHistoricalRequest({action:'predict',result:'success'});
  const oldBuy=settings+stockHistoricalRequest({result:'success'});
  const unknownBuy=settings+stockHistoricalRequest();
  const unknownPrediction=prediction+stockHistoricalRequest({action:'predict'});
  const lostBuy=oldBuy+`{const l=${ledger},p=l.pending;p.result=null;delete p.responseAt;
    sessionStorage.setItem('stock:request:77',JSON.stringify({input:p.input,idempotencyKey:p.key}));
    localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));}`;
  const delayedReceipt=`{const receiptFetch=window.fetch;window.fetch=(u,o)=>{const response=receiptFetch(u,o);
    return u==='/api/stock'&&o?.method==='POST'?response.then(r=>new Promise(resolve=>{window.releaseStockReceipt=()=>resolve(r);})):response;};}`;
  const manualOldBuy=async()=>{await pulse(1000);await evaluate(`navFarm('/stock');void stockAct('buy',{});`);
    await until(()=>evaluate(`km.calls.length===1 && typeof window.releaseStockReceipt==='function'`),'manual original receipt held');};
  const owned=`km.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];
    localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,
      entries:[],pending:null,owned:{'1':{shares:10,cost:100,modelName:'模型甲',manual:false}}}));`;
  const saleOnce=`km.saleReceipt=true;{const saleFetch=window.fetch;window.fetch=async(u,o)=>{
    const response=await saleFetch(u,o);if(u==='/api/stock'&&o?.method==='POST')km.view.rules.reserveTokens=0;return response;};}`;
  const done=`location.pathname==='/activities/expedition'`;
  const incomeTotals=`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).totals`;
  const manualIncomeSetup=`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');
    localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},trade:false,predict:false}));`;
  const readManualIncome=async()=>{await evaluate(`fetch('/api/stock').then(r=>r.json())`);await pulse(1000);};
  const incomeRecords=`Object.keys(localStorage).filter(k=>k.startsWith('arkengine:income-stock:v1:')).map(k=>JSON.parse(localStorage.getItem(k)))`;
  const observationEvents=`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-observation')`;
  const weakEntry=`km.view.ticks=[1400,1360,1320,1280,1240,1200].map((priceCents,i)=>({stockId:1,priceCents,createdAt:new Date(clock-(5-i)*300000).toISOString()}));`;
  const freshEntry=`km.view.ticks=[1000,1040,1080,1120,1160,1200].map((priceCents,i)=>({stockId:1,priceCents,createdAt:new Date(clock-(5-i)*300000).toISOString()}));`;
  await t.test('股市候选等待：历史信号变化但卖出条件数量相同，重读后完成旧仓退出且刷新不重发',async()=>{
    await setupStock(settings+owned+`
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},netEfficiency:true}));
      const changingSignalRead=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/stock'&&options?.method!=='POST')km.view.ticks.at(-1).priceCents=km.reads%2?1180:1200;
        return changingSignalRead(url,options);
      };`);
    await drive(done,'same economic order completes across changing signal diagnostics',110);
    const calls=await evaluate('km.calls');assert.equal(calls.length,1);assert.equal(calls[0].action,'sell');
    assert.equal(calls[0].modelName,'模型甲');assert.ok(calls[0].shares>0);
    assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.entries.filter(e=>e.action==='sell'&&e.result==='success').length`),1);
    const choices=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events
      .filter(e=>e.type==='stock-decision'&&e.data.selected?.action==='sell').map(e=>e.data.selected)`);
    assert.ok(choices.length>=2,'the submit still obtains a fresh market read');
    const trends=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events
      .filter(e=>e.type==='stock-decision-detail').flatMap(e=>e.data.rows).map(r=>r.trend?.changePct)`);
    assert.ok(new Set(trends).size>=2,'the historical signal actually changed');
    assert.equal(new Set(choices.map(c=>JSON.stringify([c.stockId,c.shares,c.estimate,c.debit]))).size,1);
    assert.equal(calls[0].shares,choices.at(-1).shares);
    await reloadStock();for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('股市市场证据浏览器：正常读取保留公开价格和未知字段类型，原生导出不泄露值或增加交易',async()=>{
    await setupStock(settings+`const c=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));c.observeOnly=true;
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(c));
      Object.assign(km.view.stocks[0],{openPriceCents:1100,high24hCents:1300,low24hCents:900,unverifiedMetric:987654321});
      for(let i=2;i<=70;i++)km.view.stocks.push({id:i,modelName:'额外股票'+i,priceCents:1200,volume24h:100,stale:true,
        ...(i===70?{lastRowMetric:765432109,providerStats:{errorRate:.876543219}}:{})});
      km.view.providerStats={requestCount:123456789,errorRate:.987654321};km.view.accessToken='must-not-copy-private';`);
    await drive(done,'market evidence recorded');assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate('km.reads'),1,'evidence collection cannot cause an extra market request');
    const events=await evaluate(observationEvents),snapshots=stockSnapshotsFromLog({events});
    const first=snapshots[0];assert.equal(first.view.stocks[0].openPriceCents,1100);
    assert.equal(first.view.stocks[0].high24hCents,1300);assert.equal(first.view.stocks[0].low24hCents,900);
    assert.equal(first.view.stocks[0].unverifiedMetric,undefined);assert.equal(first.view.marketSchema.version,1);
    assert.equal(first.view.stocks.length,70);
    const inventory=first.view.marketSchema.stockInventory;
    assert.equal(inventory.totalRows,70);assert.equal(inventory.inspectedRows,70);assert.equal(inventory.skippedRows,0);
    assert.deepEqual(inventory.shape.fields.find(f=>f.name==='lastRowMetric').types,['number']);
    assert.deepEqual(inventory.shape.fields.find(f=>f.name==='providerStats').fields.find(f=>f.name==='errorRate').types,['number']);
    const schema=JSON.stringify(first.view.marketSchema);assert.match(schema,/requestCount/);assert.match(schema,/errorRate/);
    for(const privateValue of ['123456789','987654321','765432109','876543219','must-not-copy-private','accessToken'])
      assert.equal(JSON.stringify(snapshots).includes(privateValue),false,privateValue);
    await evaluate(`window.exportedBlob=null;URL.createObjectURL=b=>{exportedBlob=b;return 'blob:local';};HTMLAnchorElement.prototype.click=function(){};
      [...${panel}.querySelectorAll('details button')].find(b=>b.textContent==='导出两页日志（7 天）').click();`);
    await until(()=>evaluate('Boolean(window.exportedBlob)'),'market evidence JSON export');
    const restored=stockSnapshotsFromLog(JSON.parse(await evaluate('exportedBlob.text()')));
    assert.deepEqual(restored,snapshots);assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市预算一致浏览器：日志保留可用风险额度，但禁止新买的候选不成为实际订单',async()=>{
    await setupStock(settings+`km.tokens=400000;
      km.view.rules={buyFeePct:2,sellFeePct:2.5,maxTradeTokens:100000,maxDailyBuyTokens:500000,maxPositionTokens:1000000,reserveTokens:1000000};
      km.view.stocks.push({id:2,modelName:'旧仓',priceCents:1000,volume24h:100,stale:true});
      km.view.positions=[{stockId:2,shares:1000,costBasisTokens:10000,holdUntil:null}];
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},autoBudget:true,riskLimit:400000,positionLimit:400000,lossLimit:100000}));
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,
        entries:[],pending:null,owned:{'2':{shares:1000,cost:10000,modelName:'旧仓',manual:false}}}));`);
    await drive(done,'risk budget observed without new exposure');assert.equal(await evaluate('km.calls.length'),0);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const d=events.find(e=>e.type==='stock-decision').data;
    assert.equal(d.budget.reserveBudget,90000);assert.equal(d.policy.autoBudget,true);
    assert.equal(d.budget.constraints.find(v=>v.key==='account-risk-budget').remaining,90000);
    assert.equal(d.selected,null);assert.equal(d.policy.newBuy,false);assert.equal(d.buyEligibleCount,0);
    const row=events.filter(e=>e.type==='stock-decision-detail'&&e.data.diagnosticId===d.diagnosticId)
      .flatMap(e=>e.data.rows).find(r=>r.kind==='stock'&&r.stockId===1);
    assert.ok(row.buy.shares>0);assert.ok(row.buy.reservedDebit<=90000);
    assert.equal(row.buy.eligible,false);assert.ok(row.buy.blockers.includes('new-buy-unverified'));
  });
  await t.test('股市预算一致浏览器：独立亏损预算耗尽时日志不再显示虚假的可买候选',async()=>{
    await setupStock(settings+`km.tokens=400000;
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},autoBudget:true,lossLimit:100000}));
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,
        entries:[],pending:null,owned:{},archive:{buyCost:200000,knownProceeds:99999,releasedCost:200000,realized:-100001,
        unknownSales:0,predictionNet:0,predictionStake:0,predictionPaid:0}}));`);
    await drive(done,'loss budget prevents entry');assert.equal(await evaluate('km.calls.length'),0);
    const d=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='stock-decision').data`);
    assert.equal(d.selected,null);assert.equal(d.budget.reserveBudget,0);assert.equal(d.buyEligibleCount,0);
    assert.ok(d.buyBlockers.includes('no-account-risk-budget'));
  });
  await t.test('原买单信号浏览器：未知旧买单转弱后恢复上涨仍不自动续发，原键原股数保留',async()=>{
    await setupStock(unknownBuy);await drive(done,'historical buy not confirmed');
    const first=await evaluate(`${ledger}.pending`);await evaluate(`${weakEntry}km.mode='success';`);await pulse(31000);
    await reloadStock();await drive(done,'weak entry keeps original pending');assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate('km.tokens'),10000);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    assert.match(await evaluate(`${ledger}.note`),/暂停.*手动核对/);
    await reloadStock();await drive(done,'invalid entry survives refresh');assert.equal(await evaluate('km.calls.length'),0);
    await evaluate(`${freshEntry}${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'fresh signal recheck');await drive(done,'fresh signal cannot reopen original request');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending.key`),first.key);
    assert.equal(await evaluate(`${ledger}.pending.choice.shares`),first.choice.shares);
    assert.equal(await evaluate(`${ledger}.entries[0].result`),'reserved');
    assert.equal(await evaluate(`${ledger}.entries.length`),1);
  });
  await t.test('原买单信号浏览器：旧买单达到原重试时间也不排队确认，信号转弱仍保留',async()=>{
    await setupStock(settings+stockHistoricalRequest({age:0}));await pulse(31000);
    await evaluate(weakEntry);await drive(done,'disabled old buy never queues confirmation');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    assert.equal(await evaluate('km.tokens'),10000);
  });
  await t.test('原买单信号浏览器：网站未标停滞但行情过期或走平时不继续花钱',async()=>{
    for(const change of [`km.view.ticks.forEach(t=>t.createdAt=new Date(Date.parse(t.createdAt)-600001).toISOString());`,
      `km.view.ticks.forEach(t=>t.priceCents=1200);`]){
      await setupStock(unknownBuy+change);await drive(done,'unknown buy with invalid signal');
      await evaluate(`${change}km.mode='success';`);await pulse(31000);await drive(done,'invalid entry does not confirm original');
      assert.equal(await evaluate('km.calls.length'),0,change);assert.equal(await evaluate('km.tokens'),10000,change);
      assert.match(await evaluate(`${ledger}.note`),/暂停/);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    }
  });
  await t.test('原买单信号浏览器：持仓反映旧股数也不自动重发，人工确认原回执后只记一次',async()=>{
    await setupStock(lostBuy);await drive(done,'historical fill with missing receipt');
    const p=await evaluate(`${ledger}.pending`),balance=await evaluate('km.tokens');
    await evaluate(`${weakEntry}km.mode='success';`);await reloadStock();await drive(done,'holdings alone do not trigger replay');
    assert.equal(await evaluate('km.calls.length'),0);
    await evaluate(`stockAct('buy',{});`);await evaluate(`${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.pending===null`,'manual confirmation retrieves original receipt');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.calls[0].idempotencyKey'),p.key);
    assert.equal(await evaluate('km.tokens'),balance);assert.equal(await evaluate('km.view.positions[0].shares'),p.choice.shares);
    assert.equal(await evaluate(`${ledger}.entries[0].result`),'success');
  });
  await t.test('原买单信号浏览器：入场等待期间迟到绑定回执照常入账，不借信号作成交判断',async()=>{
    await setupStock(unknownBuy+delayedReceipt);await drive(done,'old buy before manual confirmation');await manualOldBuy();
    const p=await evaluate(`${ledger}.pending`),balance=await evaluate('km.tokens');
    await evaluate(`${weakEntry}km.hidePositions=true;${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'manual fill recheck visit');await drive(done,'unreflected fill waits for entry signal or receipt');
    assert.match(await evaluate(`${ledger}.note`),/暂停/);assert.equal(await evaluate('km.calls.length'),1);
    await evaluate(`km.hidePositions=false;window.releaseStockReceipt();`);await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'late bound receipt saved');
    await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));await drive(`${ledger}.pending===null`,'late receipt reconciles despite weak signal');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.tokens'),balance);
    assert.equal(await evaluate(`${ledger}.entries[0].id`),p.id);assert.equal(await evaluate(`${ledger}.entries[0].debit`),10000-balance);
  });
  const saleSizing=(price,shares,cost,budget)=>`${settings}${owned}km.saleReceipt=true;km.nativeSaleCapacity=true;km.view.stocks[0].priceCents=${price};
    km.view.positions[0].shares=${shares};km.view.positions[0].costBasisTokens=${cost};
    km.view.rules.maxTradeTokens=${budget};km.view.rules.reserveTokens=${budget};
    const sizingLedger=${ledger};sizingLedger.owned['1'].shares=${shares};sizingLedger.owned['1'].cost=${cost};
    localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(sizingLedger));`;
  await t.test('净额卖出浏览器：100股在97净额限额内一次卖完，成本到账各记一次',async()=>{
    await setupStock(saleSizing(100,100,80,97));await drive(done,'one full-position sale at net limit');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.calls[0].shares'),100);
    assert.equal(await evaluate('km.tokens'),10097);assert.equal(await evaluate('km.view.positions[0].shares'),0);
    const e=await evaluate(`${ledger}.entries[0]`);assert.equal(e.proceeds,97);assert.equal(e.releasedCost,80);
    await reloadStock();await drive(done,'full exit remains settled after refresh');assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('净额卖出浏览器：分批同额保留余股价值，两笔合计19而非18代币',async()=>{
    await setupStock(saleSizing(2,1000,10,10));await drive(done,'two batches conserve quoted residual');
    assert.deepEqual(await evaluate('km.calls.map(c=>c.shares)'),[513,487]);assert.equal(await evaluate('km.tokens'),10019);
    assert.equal(await evaluate('km.view.positions[0].shares'),0);
    const es=await evaluate(`${ledger}.entries`);assert.equal(es.reduce((n,e)=>n+e.proceeds,0),19);
    assert.equal(es.reduce((n,e)=>n+e.releasedCost,0),10);assert.equal(new Set(es.map(e=>e.id)).size,2);
  });
  await t.test('净额卖出浏览器：小额股份合并到正净额，储备用完后保留剩余仓位',async()=>{
    await setupStock(saleSizing(49,100,10,1)+`const firstFetch=window.fetch;window.fetch=async(u,o)=>{
      const r=await firstFetch(u,o);if(u==='/api/stock'&&o?.method==='POST')km.view.rules.reserveTokens=0;return r;};`);
    await drive(done,'small shares yield positive net then wait for reserve');assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate('km.calls[0].shares'),3);assert.equal(await evaluate('km.tokens'),10001);
    assert.equal(await evaluate('km.view.positions[0].shares'),97);assert.equal(await evaluate(`${ledger}.pending`),null);
  });
  await t.test('净额卖出浏览器：排队期间储备下降重新缩量，未发送的旧整仓方案不执行',async()=>{
    await setupStock(saleSizing(100,100,80,97)+`const firstFetch=window.fetch;window.fetch=async(u,o)=>{
      const r=await firstFetch(u,o);if(u==='/api/stock'&&o?.method==='POST')km.view.rules.reserveTokens=0;return r;};`);
    await drive(`${panel}.getElementById('status').textContent.includes('秒后卖出')`,'full exit queued');
    await evaluate('km.view.rules.reserveTokens=50;');await drive(done,'fresh reserve resizes unsubmitted sale');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.calls[0].shares'),52);
    assert.equal(await evaluate('km.tokens'),10050);assert.equal(await evaluate('km.view.positions[0].shares'),48);
  });
  await t.test('净额卖出浏览器：旧原卖单不按新版数量放大，回执丢失只核对原股数',async()=>{
    await setupStock(saleSizing(100,100,80,97)+`km.view.rules.maxTradeTokens=94;km.mode='deferred';`);
    await drive('km.calls.length===1','original partial sale saved');const p=await evaluate(`${ledger}.pending`);
    assert.equal(p.choice.shares,97);
    await evaluate(`km.view.rules.maxTradeTokens=97;km.mode='success';const firstFetch=window.fetch;window.fetch=async(u,o)=>{
      const r=await firstFetch(u,o);if(u==='/api/stock'&&o?.method==='POST')km.view.rules.reserveTokens=0;return r;};`);
    await pulse(31000);await drive(done,'original sale reconciled at old size');
    assert.equal(await evaluate('km.calls.length'),2);assert.ok(await evaluate('km.calls.every(c=>c.shares===97 && c.idempotencyKey===km.calls[0].idempotencyKey)'));
    assert.equal(await evaluate('km.tokens'),10094);assert.equal(await evaluate('km.view.positions[0].shares'),3);
  });
  await t.test('净额卖出浏览器：整仓零到账仍保留，不为清尾仓而零回收卖出',async()=>{
    await setupStock(saleSizing(49,2,10,1));await drive(done,'zero-total quote remains unsold');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate('km.view.positions[0].shares'),2);
    assert.equal(await evaluate(`${ledger}.valuation.positions[0].status`),'rounding');assert.equal(await evaluate('km.tokens'),10000);
  });
  const oldRejected=`localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,
    note:'交易被网站拒绝，未执行',hold:true,holdReason:'交易被网站拒绝，未执行',owned:{},pending:null,
    entries:[{id:'old-rejected',action:'buy',stockId:1,at:clock-600000,debit:900,result:'rejected'}]}));`;
  await t.test('股市拒绝恢复：旧版明确拒绝的永久等待能自动恢复，拒绝记录和原预算保留',async()=>{
    await setupStock(settings+oldRejected+`km.saleReceipt=true;km.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];
      const old=${ledger};old.owned={'1':{shares:10,cost:100,modelName:'模型甲',manual:false}};
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(old));`,'/activities/expedition');
    await drive(`km.calls.length===1 && ${ledger}.pending===null`,'old definite rejection resumes through scheduler');
    const l=await evaluate(`${ledger}`);assert.equal(l.hold,false);assert.equal(l.entries[0].result,'rejected');
    assert.equal(l.entries[0].id,'old-rejected');assert.equal(l.entries[1].result,'success');
    assert.equal(l.entries[0].debit,900);assert.equal(l.entries[1].action,'sell');assert.equal(l.entries[1].proceeds,117);
    assert.equal(await evaluate('km.tokens'),10117);
  });
  await t.test('股市拒绝恢复：旧拒绝解等待仍受历史账目保护，人工暂停不恢复交易',async()=>{
    await setupStock(settings+oldRejected+`const l=${ledger};l.archive={buyCost:500,knownProceeds:0,releasedCost:0,realized:0,
      unknownSales:36,predictionStake:0,predictionPaid:0,predictionNet:0};localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
    await drive(done,'historic gaps remain after rejection recovery');assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate(`${ledger}.archive.unknownSales`),36);
    assert.match(await evaluate(`${ledger}.accounting.issue`),/旧卖出/);
    await setupStock(settings+oldRejected+`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);
    await pulse(10000);assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.hold`),true);
  });
  await t.test('股市拒绝恢复：未决记录、其他停止原因及不一致旧记录不自动解锁',async()=>{
    for(const change of [`l.holdReason='实际买入超过预留金额，已停止后续自动交易';`,
      `l.entries[0].result='reserved';`, `l.note='等待你核对账号';`,
      `sessionStorage.setItem('stock:request:77',JSON.stringify({idempotencyKey:'manual-pending-key',input:{action:'buy',modelName:'模型甲',shares:1,expectedUserId:77}}));`]){
      await setupStock(settings+oldRejected+`const l=${ledger};${change}localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
      await drive(done,'unrelated or inconsistent hold preserved');assert.equal(await evaluate('km.calls.length'),0,change);
      assert.equal(await evaluate(`${ledger}.hold`),true,change);
    }
  });
  await t.test('股市拒绝恢复：明确未执行后冷却五分钟，刷新保留，到期自动重新评估',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;km.mode='rejected';`);await drive(done,'definite rejection exits visit');
    const first=await evaluate(`${ledger}`);assert.equal(first.pending,null);assert.equal(first.entries[0].result,'rejected');
    assert.equal(first.hold,false);assert.ok(first.rejectionCooldownUntil>await evaluate('clock'));
    assert.equal(first.accounting.record.events.filter(e=>e.type==='reject').length,1);
    assert.equal(await evaluate('km.tokens'),10000);
    await evaluate(`km.mode='success';`);await reloadStock();await drive(done,'refresh preserves cooldown');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.rejectionCooldownUntil`),first.rejectionCooldownUntil);
    await pulse(await evaluate(`${ledger}.rejectionCooldownUntil-clock-1000`));assert.equal(await evaluate('km.calls.length'),1);
    await pulse(2000);await drive(`km.calls.length===2 && ${ledger}.pending===null`,'cooldown permits a fresh evaluated sale');
    const entries=await evaluate(`${ledger}.entries`);assert.deepEqual(entries.map(e=>e.result),['rejected','success']);
    assert.notEqual(await evaluate('km.calls[0].idempotencyKey'),await evaluate('km.calls[1].idempotencyKey'));
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell','sell']);assert.equal(await evaluate('km.view.positions[0].shares'),0);
    assert.equal(entries[1].proceeds,117);
  });
  await t.test('股市原卖单容量：储备不足不耗核对次数，恢复后沿用原键原股数',async()=>{
    await setupStock(settings+owned+`km.mode='deferred';km.saleReceipt=true;`);
    await drive('km.calls.length===1','original sale unknown');const first=await evaluate(`${ledger}.pending`);
    await evaluate(`km.view.rules.reserveTokens=1;km.mode='success';`);await pulse(31000);
    await drive(done,'original waits for liquidity');assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate(`${ledger}.pending.retries`),0);assert.match(await evaluate(`${ledger}.note`),/储备/);
    await reloadStock();await drive(done,'liquidity wait survives refresh');assert.equal(await evaluate('km.calls.length'),1);
    await evaluate(`km.view.rules.reserveTokens=10000;${panel}.getElementById('stock-check').click();`);
    await drive(`km.calls.length===2 && ${ledger}.pending===null`,'same original sale reconciled');
    assert.equal(await evaluate('km.calls[1].idempotencyKey'),first.key);assert.equal(await evaluate('km.calls[1].shares'),first.choice.shares);
    assert.equal(await evaluate('km.view.positions[0].shares'),0);assert.equal(await evaluate(`${ledger}.entries.length`),1);
  });
  await t.test('股市原卖单容量：单笔限额、持有期或关市改变时不发送，恢复后继续原单',async()=>{
    for(const change of [`km.view.rules.maxTradeTokens=1;`,`km.view.positions[0].holdUntil=new Date(clock+600000).toISOString();`,`km.view.enabled=false;`]){
      await setupStock(settings+owned+`km.mode='deferred';km.saleReceipt=true;`);await drive('km.calls.length===1','pending sale before market change');
      const first=await evaluate(`${ledger}.pending`);await evaluate(`${change}km.mode='success';`);await pulse(31000);
      await drive(done,'changed capacity preserves original request');assert.equal(await evaluate('km.calls.length'),1,change);
      assert.equal(await evaluate(`${ledger}.pending.retries`),0,change);
      await evaluate(`km.view.rules.maxTradeTokens=10000;km.view.positions[0].holdUntil=null;km.view.enabled=true;${panel}.getElementById('stock-check').click();`);
      await drive(`km.calls.length===2 && ${ledger}.pending===null`,'capacity restored to same request');
      assert.equal(await evaluate('km.calls[1].idempotencyKey'),first.key);assert.equal(await evaluate('km.calls[1].shares'),first.choice.shares);
    }
  });
  await t.test('股市原卖单容量：储备变零后迟到成功回执仍入账，不重复卖出',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;const originalFetch=window.fetch;
      window.fetch=(u,o)=>{const response=originalFetch(u,o);return u==='/api/stock'&&o?.method==='POST'?
        response.then(r=>new Promise(resolve=>{window.releaseStockReceipt=()=>resolve(r);})):response;};`);
    await drive('km.calls.length===1','sale executed with delayed receipt');const p=await evaluate(`${ledger}.pending`);
    await evaluate(`km.view.rules.reserveTokens=0;${panel}.getElementById('stock-check').click();`);await drive(done,'zero reserve waits for original receipt');
    await evaluate('window.releaseStockReceipt();');await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'bound sale receipt saved');
    await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));await drive(`${ledger}.pending===null`,'receipt reconciles without another sale');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.entries[0].id`),p.id);
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);assert.equal(await evaluate('km.tokens'),10117);
  });
  await t.test('股市拒绝恢复：冷却到期仍遵守人工暂停，重复明确拒绝重新冷却',async()=>{
    await setupStock(settings+owned+`km.mode='rejected';`);await drive(done,'first rejected order');
    const first=await evaluate(`${ledger}.rejectionCooldownUntil`);
    await pulse(await evaluate(`${ledger}.rejectionCooldownUntil-clock+1000`));
    await drive(`km.calls.length===2 && ${ledger}.pending===null`,'second fresh request definitely rejected');
    assert.ok(await evaluate(`${ledger}.rejectionCooldownUntil`)>first);
    await pulse(10000);assert.equal(await evaluate('km.calls.length'),2);
    await evaluate(`${panel}.getElementById('toggle').click();km.mode='success';`);await pulse(310000);
    assert.equal(await evaluate('km.calls.length'),2);assert.equal(await evaluate('km.tokens'),10000);
  });
  await t.test('股市拒绝恢复：核对次数耗尽后迟到明确拒绝解除本单等待并转入冷却',async()=>{
    await setupStock(settings+owned+`const originalFetch=window.fetch;km.mode='rejected';
      window.fetch=(u,o)=>{const response=originalFetch(u,o);return u==='/api/stock'&&o?.method==='POST'?
        response.then(r=>new Promise(resolve=>{window.releaseStockReceipt=()=>resolve(r);})):response;};`);
    await drive('km.calls.length===1','rejection receipt delayed');
    await evaluate(`const l=${ledger};l.pending.retries=2;l.hold=true;l.holdReason='原交易已核对两次仍未知，保留记录，请手动确认原交易';l.note=l.holdReason;
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));window.releaseStockReceipt();`);
    await until(()=>evaluate(`${ledger}.pending?.result==='rejected'`),'late definite rejection saved');
    await drive(`${ledger}.pending===null`,'late rejection closes exhausted original');
    assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate(`${ledger}.entries[0].result`),'rejected');
    assert.equal(await evaluate('km.calls.length'),1);assert.ok(await evaluate(`${ledger}.rejectionCooldownUntil>clock`));
  });
  await t.test('股市拒绝恢复：次数耗尽后迟到成功回执解除原单等待，实际超支仍停止',async()=>{
    for(const slipped of [false,true]){
      await setupStock(unknownBuy+delayedReceipt+`km.fillPrice=${slipped?1800:1200};`);
      await manualOldBuy();
      await evaluate(`const l=${ledger};l.pending.retries=2;l.hold=true;l.holdReason='原交易已核对两次仍未知，保留记录，请手动确认原交易';l.note=l.holdReason;
        localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));window.releaseStockReceipt();`);
      await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'late success saved');
      await evaluate(`${panel}.getElementById('stock-check').click();`);await drive(`${ledger}.pending===null`,'late success reconciled');
      assert.equal(await evaluate(`${ledger}.hold`),slipped);assert.equal(await evaluate('km.calls.length'),1);
      assert.equal(await evaluate(`${ledger}.entries[0].debit`),10000-await evaluate('km.tokens'));
      if(slipped)assert.match(await evaluate(`${ledger}.holdReason`),/超过预留/);
    }
  });
  await t.test('股市拒绝恢复：冷却字段损坏不按零处理，不发送新交易或覆盖原记录',async()=>{
    for(const deadline of ['-1',`'invalid'`]){
      await setupStock(settings+oldRejected+`const l=${ledger};l.rejectionCooldownUntil=${deadline};
        localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
      const before=await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`);
      await drive(done,'invalid cooldown isolated');assert.equal(await evaluate('km.calls.length'),0);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),before);
    }
  });
  const websiteSettings=settings+`km.nativeCapacity=true;`;
  await t.test('网站额度浏览器：账号仅余100代币时记录真实余量，但不开放自动买入',async()=>{
    await setupStock(websiteSettings+`km.view.dailyBoughtTokens=9900;`);await drive(done,'native remaining daily allowance');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending`),null);
    const d=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='stock-decision').data`);
    assert.equal(d.budget.website.remainingDaily,100);assert.equal(d.policy.newBuy,false);assert.equal(d.selected,null);
  });
  await t.test('网站额度浏览器：已有仓成本低但现价达到网站上限时零买入',async()=>{
    await setupStock(websiteSettings+`km.view.stocks.push({id:2,modelName:'已有仓',priceCents:5000,volume24h:1000});
      km.view.positions=[{stockId:2,shares:200,costBasisTokens:1000,holdUntil:null}];`);
    await drive(done,'market value consumes native capacity');assert.equal(await evaluate('km.calls.length'),0);
    const d=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='stock-decision').data`);
    assert.equal(d.budget.website.remainingPosition,0);assert.equal(d.selected,null);
  });
  await t.test('网站额度浏览器：账号额度从充足变为耗尽，重读保持零买入并更新诊断',async()=>{
    await setupStock(websiteSettings+`km.view.dailyBoughtTokens=0;`);
    await drive(done,'initial website capacity does not permit entry');
    await evaluate(`km.view.dailyBoughtTokens=10000;${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'native allowance recheck');await drive(done,'fresh website allowance recorded');
    assert.equal(await evaluate('km.calls.length'),0);
    const d=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-decision').at(-1).data`);
    assert.equal(d.budget.website.remainingDaily,0);assert.equal(d.selected,null);
  });
  await t.test('网站额度浏览器：未知旧买单额度不足保留，额度恢复也不自动重发原键',async()=>{
    await setupStock(websiteSettings+stockHistoricalRequest()+`km.view.dailyBoughtTokens=0;`);
    await drive(done,'unknown historical buy before allowance reduction');
    const original=await evaluate(`${ledger}.pending`);
    await evaluate(`km.view.dailyBoughtTokens=10000;km.mode='success';${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'old request allowance recheck');await drive(done,'original remains paused');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending.id`),original.id);
    assert.match(await evaluate(`${ledger}.note`),/暂停/);
    await reloadStock();await drive(done,'quota wait survives reload');assert.equal(await evaluate('km.calls.length'),0);
    await evaluate(`km.view.dailyBoughtTokens=0;${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'restored allowance recheck');await drive(done,'restored allowance does not reopen buys');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending.key`),original.key);
    assert.equal(await evaluate(`${ledger}.entries[0].result`),'reserved');assert.equal(await evaluate(`${ledger}.entries[0].debit`),original.choice.debit);
  });
  await t.test('网站额度浏览器：额度耗尽后迟到成功回执照常入账，不再发送原单',async()=>{
    await setupStock(websiteSettings+stockHistoricalRequest()+delayedReceipt+`km.view.dailyBoughtTokens=0;`);
    await manualOldBuy();const original=await evaluate(`${ledger}.pending`);
    await evaluate(`km.view.dailyBoughtTokens=10000;${panel}.getElementById('stock-check').click();`);
    await drive(done,'unknown result waits at exhausted allowance');assert.equal(await evaluate('km.calls.length'),1);
    await evaluate('window.releaseStockReceipt();');await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'late bound receipt saved');
    await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));await drive(`${ledger}.pending===null`,'late success reconciled despite allowance');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.entries[0].id`),original.id);
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),10000-await evaluate('km.tokens'));
  });
  await t.test('网站额度浏览器：网站额度异常仍管理合法卖出，观察模式仍不买',async()=>{
    await setupStock(websiteSettings+owned+`km.view.dailyBoughtTokens=null;km.saleReceipt=true;`);
    await drive(done,'sale independent of malformed buy allowance');
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell']);
    await setupStock(websiteSettings+`km.view.dailyBoughtTokens=9900;
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},observeOnly:true}));`);
    await drive(done,'observe website-limited candidate');assert.equal(await evaluate('km.calls.length'),0);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.equal(events.find(e=>e.type==='stock-decision').data.budget.website.remainingDaily,100);
    assert.ok(events.some(e=>e.type==='stock-observation'&&e.data.snapshot.dailyBoughtTokens===9900));
  });
  const splitExit=`${settings}${owned}km.saleReceipt=true;km.view.rules.maxTradeTokens=84;
    km.view.positions[0].shares=26;km.view.positions[0].costBasisTokens=400;
    const splitLedger=JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'));
    splitLedger.owned['1'].shares=26;splitLedger.owned['1'].cost=400;
    localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(splitLedger));`;
  await t.test('股市退出优化：停滞旧仓净赚2代币时整仓退出，只以原生回执入账',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;km.view.stocks[0].priceCents=1050;km.view.stocks[0].stale=true;`);
    await drive(done,'stalled positive exit reconciled');
    assert.deepEqual(await evaluate('km.calls.map(c=>[c.action,c.shares])'),[['sell',10]]);
    assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`(${incomeTotals})['股市已实现盈亏']`),2);
  });
  await t.test('股市退出优化：盈利仓列在前面也先实际卖出止损仓',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;
      km.view.stocks.push({id:2,modelName:'止损仓',priceCents:800,volume24h:1000});
      km.view.positions.push({stockId:2,shares:10,costBasisTokens:100,holdUntil:null});
      const l=JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'));
      l.owned['2']={shares:10,cost:100,modelName:'止损仓',manual:false};
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
    await drive('km.calls.length>0','risk-priority first native sale');
    assert.equal(await evaluate('km.calls[0].modelName'),'止损仓');
    await drive(done,'both exits reconciled');
    assert.deepEqual(await evaluate('km.calls.map(c=>[c.action,c.modelName])'),[['sell','止损仓'],['sell','模型甲']]);
    assert.equal(await evaluate(`${ledger}.pending`),null);
  });
  await t.test('股市退出优化：三笔分批成交后五秒预约并自动接续，四笔总股数与收入不重复',async()=>{
    await setupStock(splitExit);await drive(done,'first three exits finish visit');
    assert.equal(await evaluate('km.calls.length'),3);
    const checks=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-check')`);
    assert.equal(checks.at(-1).data.retryAfterMs,5000);
    assert.equal(checks.at(-1).data.exitContinuation.shares,5);
    await drive('km.calls.length===4','remaining exit resumes without manual check');
    await drive(`${ledger}.pending===null && location.pathname==='/activities/expedition'`,'last partial reconciled');
    assert.deepEqual(await evaluate('km.calls.map(c=>c.shares)'),[7,7,7,5]);
    assert.equal(await evaluate('new Set(km.calls.map(c=>c.idempotencyKey)).size'),4);
    assert.equal(await evaluate('km.view.positions[0].shares'),0);
    const entries=await evaluate(`${ledger}.entries`);
    assert.equal(entries.reduce((n,e)=>n+e.releasedCost,0),400);
    assert.equal(entries.reduce((n,e)=>n+e.proceeds,0),301);
    assert.equal(await evaluate('km.tokens'),10301);
    await pulse(10000);assert.equal(await evaluate('km.calls.length'),4);
  });
  await t.test('股市退出优化：三笔后停牌、储备不足、控件隐藏或同数量按钮禁用均不短接续',async()=>{
    for(const change of [`km.view.stocks[0].suspended=true;renderStock();`,
      `km.view.rules.reserveTokens=0;`, `km.search='不匹配';renderStock();`,
      `km.qty[1]=5;const prior=renderStock;window.renderStock=()=>{prior();
        [...document.querySelectorAll('#stock-list button')].filter(b=>b.textContent==='卖 5').forEach(b=>b.disabled=true);};renderStock();`]){
      await setupStock(splitExit);await drive('km.calls.length===3','three native exits before unavailable market');
      await evaluate(change);await drive(done,'unavailable remainder uses normal interval');
      const check=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-check').at(-1)`);
      assert.equal(check.data.retryAfterMs,300000,change);assert.equal(check.data.exitContinuation,null,change);
      await pulse(10000);assert.equal(await evaluate('km.calls.length'),3,change);
    }
  });
  await t.test('股市退出优化：短接续前停牌或人工暂停，不执行预约时的旧卖单',async()=>{
    for(const change of [`km.view.stocks[0].suspended=true;`,`${panel}.getElementById('toggle').click();`]){
      await setupStock(splitExit);await drive(done,'three exits booked short revisit');
      await evaluate(change);await pulse(10000);
      if(change.includes('suspended'))await drive(`${ledger}.note.includes('五分钟')||${ledger}.nextAt-clock>200000`,'fresh check blocks suspended exit');
      assert.equal(await evaluate('km.calls.length'),3);assert.equal(await evaluate('km.view.positions[0].shares'),5);
    }
  });
  await t.test('股市退出优化：第三笔回执未知只核对原请求，不另开第四笔或短接续',async()=>{
    await setupStock(splitExit);await drive('km.calls.length===2','first two partial sales');
    await evaluate(`km.mode='lost';`);await drive('km.calls.length===3','third partial receipt lost');
    const original=await evaluate(`${ledger}.pending`);await drive(done,'unknown original gives way to expedition');
    assert.equal(await evaluate(`${ledger}.pending.id`),original.id);
    assert.equal(await evaluate('new Set(km.calls.map(c=>c.idempotencyKey)).size'),3);
    assert.equal(await evaluate('km.view.positions[0].shares'),5);
    const check=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-check').at(-1)`);
    assert.equal(check.data.retryAfterMs,300000);assert.equal(check.data.exitContinuation,null);
  });
  await t.test('股市退出优化：行情停滞后仍重读当前价格，完成已触发的分批卖出',async()=>{
    await setupStock(splitExit);await drive(done,'three exits before stale quote');
    await evaluate(`km.view.stocks[0].stale=true;`);await pulse(10000);
    await drive(`km.calls.length===4 && !${ledger}.pending`,'stale flag does not cancel valid remaining exit');
    assert.equal(await evaluate('km.view.positions[0].shares'),0);
    const entries=await evaluate(`${ledger}.entries`);
    assert.equal(entries.reduce((n,e)=>n+e.releasedCost,0),400);
    assert.equal(entries.reduce((n,e)=>n+e.proceeds,0),301);
  });
  await t.test('股市退出优化：三笔卖完保持常规检查，不将新买入加速',async()=>{
    await setupStock(splitExit+`km.view.positions[0].shares=21;km.view.positions[0].costBasisTokens=330;
      const l=JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'));
      l.owned['1'].shares=21;l.owned['1'].cost=330;localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
    await drive(done,'three exits empty the position');assert.equal(await evaluate('km.calls.length'),3);
    assert.equal(await evaluate('km.view.positions[0].shares'),0);
    const check=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-check').at(-1)`);
    assert.equal(check.data.retryAfterMs,300000);assert.equal(check.data.exitContinuation,null);
  });
  await t.test('独立股票运行账本：原卖单和独立预留一起保存，丢回执刷新后只核对同一单',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;km.mode='lost';`);
    await drive('km.calls.length===1','trial pending persisted before receipt');
    const first=await evaluate(`${ledger}.accounting`),p=await evaluate(`${ledger}.pending`);
    assert.ok(first);assert.equal(first.record.events.filter(e=>e.type==='submit').length,1);
    assert.equal(first.record.events[0].id,p.id);assert.equal(first.record.events[0].reservedTokens,p.choice.debit);
    await reloadStock();await evaluate(`km.mode='success'`);await drive(done,'trial original reconciled after refresh',180);
    const last=await evaluate(`${ledger}.accounting`);
    assert.equal(last.record.trialId,first.record.trialId);assert.equal(last.record.startedAt,first.record.startedAt);
    assert.equal(last.record.events.filter(e=>e.type==='submit').length,1);assert.equal(last.record.events.filter(e=>e.type==='fill').length,1,
      JSON.stringify(await evaluate(`({ledger:${ledger},calls:km.calls,status:${panel}.getElementById('stock-status').textContent})`)));
    assert.equal(last.record.events.find(e=>e.type==='fill').amount,117);
    assert.equal(await evaluate(`${ledger}.entries[0].releasedCost`),100);
    assert.ok(await evaluate('km.calls.every(c=>c.idempotencyKey===km.calls[0].idempotencyKey)'));
  });
  await t.test('独立股票运行账本：历史亏损跨日保留，预测盈利和外部余额增长不补预算',async()=>{
    await setupStock(settings+`localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'旧亏损',hold:false,owned:{},pending:null,
      entries:[],archive:{buyCost:120000,knownProceeds:10000,releasedCost:120000,realized:-110000,unknownSales:0,predictionStake:1000,predictionPaid:501000,predictionNet:500000}}));`);
    await drive(done,'known historical stock loss blocks new risk');assert.equal(await evaluate('km.calls.length'),0);
    const first=await evaluate(`${ledger}.accounting`);assert.equal(first.record.initialBudgetLoss,110000);assert.equal(first.report.loss,110000);
    assert.equal(first.report.halt.reason,'loss-limit');
    await evaluate(`clock+=8*86400000;km.tokens+=500000;${panel}.getElementById('stock-check').click();`);
    await drive(done,'budget survives day change');await reloadStock();await drive(done,'budget survives reload');
    const next=await evaluate(`${ledger}.accounting`);assert.equal(next.record.trialId,first.record.trialId);
    assert.equal(next.record.initialCash,first.record.initialCash);assert.equal(next.report.loss,110000);
    assert.equal(next.report.halt.reason,'loss-limit');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('独立股票运行账本：旧未知卖出不得靠新起点归零，已有合法卖出仍核对',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;const l=JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'));
      l.archive={buyCost:500,knownProceeds:0,releasedCost:0,realized:0,unknownSales:36,predictionStake:0,predictionPaid:0,predictionNet:0};
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
    await drive(done,'unknown history allows old exit but no new buys');
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell']);
    const a=await evaluate(`${ledger}.accounting`);assert.equal(a.legacyUnknownSales,36);assert.match(a.issue,/旧卖出/);
    assert.equal(a.record.events.find(e=>e.type==='fill').amount,117);
    await reloadStock();await drive(done,'unknown history not reset');assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('独立股票运行账本：持久化失败不发送交易，损坏独立记录不以空账覆盖',async()=>{
    await setupStock(settings+owned+`const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
      if(k==='arkengine:auto-stock:ledger:v1'&&JSON.parse(v).accounting)throw Error('fixture account quota');return original.call(this,k,v);};`);
    await drive(done,'account write failure prevents submission');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(settings+`const l={version:1,userId:77,nextAt:0,note:'损坏',hold:false,owned:{},entries:[],pending:null,accounting:{version:1}};
      km.corruptLedger=JSON.stringify(l);localStorage.setItem('arkengine:auto-stock:ledger:v1',km.corruptLedger);`);
    await drive(done,'account corruption preserves original');assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),await evaluate('km.corruptLedger'));
  });
  await t.test('独立股票运行账本：观察建立起点后手动成交不移除风险、不借余额猜收益',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},observeOnly:true}));`);
    await drive(done,'trial opening observation');const first=await evaluate(`${ledger}.accounting`);
    await evaluate(`stockAct('sell',{modelName:'模型甲',shares:3});`);await pulse(1000);
    assert.match(await evaluate(`${ledger}.accounting.issue`),/手动股票交易/);
    await evaluate(`km.tokens+=50000;localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(${cfg}));`);
    await reloadStock();await drive(done,'manual attribution gap blocks new risk');
    const last=await evaluate(`${ledger}.accounting`);
    assert.equal(last.record.trialId,first.record.trialId);assert.equal(last.record.initialCash,first.record.initialCash);
    assert.deepEqual(last.record.events,first.record.events);assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('独立股票运行账本：实际卖出缺到账时保留独立未决，不伪记现金或清成本',async()=>{
    await setupStock(settings+owned);await drive(done,'unknown actual proceeds retained');
    const a=await evaluate(`${ledger}.accounting`);assert.match(a.issue,/卖出到账/);
    assert.equal(a.record.events.filter(e=>e.type==='fill').length,0);
    assert.equal(a.record.events.filter(e=>e.type==='submit'&&e.action==='sell').length,1);
    assert.equal(a.record.initialPositions[0].costBasisTokens,100);assert.equal(await evaluate('km.calls.length'),1);
    await reloadStock();await drive(done,'unknown proceeds survives refresh');assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('独立股票运行账本：同页手动卖出有完整证据时归属到账与成本，刷新不重计',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},observeOnly:true}));`);
    await drive(done,'manual accounting opening');await readManualIncome();
    const first=await evaluate(`${ledger}.accounting`);
    await evaluate(`stockAct('sell',{modelName:'模型甲',shares:3});`);await pulse(1000);await readManualIncome();
    await until(()=>evaluate(`${ledger}.accounting.record.events.some(e=>e.type==='fill')`),'manual sale imported into trial');
    const last=await evaluate(`${ledger}.accounting`);assert.equal(last.issue,'');
    assert.equal(last.report.realized,5);assert.equal(last.report.heldCost,70);assert.equal(last.report.cash,first.record.initialCash+35);
    assert.equal(last.record.events.filter(e=>e.type==='fill').length,1);assert.equal(await evaluate(`${ledger}.owned['1'].manual`),true);
    const request=await evaluate('km.calls[0]');
    await evaluate(`fetch('/api/stock',{method:'POST',body:JSON.stringify(${JSON.stringify(request)})}).then(r=>r.json());`);
    await readManualIncome();
    await until(()=>evaluate(`${ledger}.accounting.issue===''`),'known manual replay clears only its own pending marker');
    await reloadStock();await readManualIncome();
    assert.equal(await evaluate(`${ledger}.accounting.record.events.filter(e=>e.type==='fill').length`),1);
    assert.equal(await evaluate('km.calls.length'),2);assert.equal(await evaluate('km.view.positions[0].shares'),7);
  });
  await t.test('独立股票运行账本：同页手动增持按真实成本增量记账，其他玩法收入不混入',async()=>{
    await setupStock(settings+owned+`localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},observeOnly:true}));`);
    await drive(done,'manual buy opening');await readManualIncome();
    const initialCash=await evaluate(`${ledger}.accounting.record.initialCash`);
    await evaluate(`km.fillPrice=1500;stockAct('buy',{modelName:'模型甲',shares:2});`);await pulse(1000);
    await evaluate('km.tokens+=50000;');await readManualIncome();
    await until(()=>evaluate(`${ledger}.accounting.record.events.some(e=>e.type==='fill')`),'manual buy imported into trial');
    const a=await evaluate(`${ledger}.accounting`);assert.equal(a.issue,'');assert.equal(a.report.cash,initialCash-31);
    assert.equal(a.report.heldCost,131);assert.equal(a.report.realized,0);assert.equal(a.report.externalNet,0);
    assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('卖出实际收入浏览器：自动成交按回执到账和释放成本计亏损，归档刷新不重复',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;km.fillPrice=800;`);await drive(done,'actual sale receipt');
    const sale=await evaluate(`${ledger}.entries.find(e=>e.action==='sell')`);
    assert.equal(sale.proceeds,78);assert.equal(sale.releasedCost,100);
    assert.equal(await evaluate(`${incomeTotals}['股市已实现盈亏']`),-22);
    assert.equal(await evaluate(`${incomeTotals}['股市卖出到账']`),78);
    assert.equal(await evaluate(`${incomeTotals}['代币']`),78);
    assert.equal(await evaluate(`${incomeTotals}['股市卖出待核对']||0`),0);
    assert.match(await evaluate(`${panel}.getElementById('stock-performance').textContent`),/已知已实现盈亏 -22/);
    assert.match(await evaluate(`${panel}.getElementById('log-summary').textContent`),/股票已核对实现盈亏 -22/);
    const original=await evaluate('km.calls[0]');
    await evaluate(`fetch('/api/stock',{method:'POST',body:JSON.stringify(${JSON.stringify(original)})}).then(r=>r.json())`);await pulse(1000);
    assert.equal(await evaluate(`${incomeTotals}['股市卖出到账']`),78);
    await evaluate(`clock+=8*86400000;km.tokens=0;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.archive?.knownProceeds===78`,'sale archive');
    await reloadStock();await drive(done,'sale archive retained');
    assert.equal(await evaluate(`${ledger}.archive.knownProceeds`),78);assert.equal(await evaluate(`${ledger}.archive.realized`),-22);
    await evaluate(`fetch('/api/stock',{method:'POST',body:JSON.stringify(${JSON.stringify(original)})}).then(r=>r.json())`);await pulse(1000);
    // 七日日志自然过期；账本归档保留累计收益，旧单重放不得在今天重新产生收入。
    assert.equal(await evaluate(`${incomeTotals}['股市卖出到账']||0`),0);
    assert.equal(await evaluate(`${ledger}.archive.knownProceeds`),78);assert.equal(await evaluate(`${ledger}.archive.realized`),-22);
  });
  await t.test('卖出实际收入浏览器：自动部分卖出按实际成交价只释放对应成本，不重复扣手续费',async()=>{
    const close=`const original=window.fetch;window.fetch=async(url,options)=>{const r=await original(url,options);
      if(url==='/api/stock'&&options?.method==='POST'&&JSON.parse(options.body).action==='sell')km.view.rules.reserveTokens=0;return r;};`;
    await setupStock(settings+owned+`km.saleReceipt=true;km.fillPrice=1500;km.view.rules.reserveTokens=60;`+close);
    await drive(done,'actual partial sale');
    const sale=await evaluate(`${ledger}.entries.find(e=>e.action==='sell')`);
    assert.equal(sale.shares,5);assert.equal(sale.proceeds,73);assert.equal(sale.releasedCost,50);
    assert.equal(await evaluate(`${incomeTotals}['股市已实现盈亏']`),23);
    assert.equal(await evaluate(`${ledger}.owned['1'].cost`),50);assert.equal(await evaluate('km.calls.length'),1);
    await reloadStock();await drive(done,'partial sale retained');
    assert.equal(await evaluate(`${incomeTotals}['股市卖出到账']`),73);assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('卖出实际收入浏览器：手动部分卖出与余额杂项分开，原请求重放及刷新只记一次',async()=>{
    await setupStock(manualIncomeSetup+owned+`km.saleReceipt=true;km.fillPrice=1500;`);await readManualIncome();
    await evaluate(`stockAct('sell',{modelName:'模型甲',shares:3})`);
    await evaluate('km.tokens+=99999;');await readManualIncome();
    assert.equal(await evaluate(`${incomeTotals}['股市卖出到账']`),43);
    assert.equal(await evaluate(`${incomeTotals}['股市卖出成本']`),30);
    assert.equal(await evaluate(`${incomeTotals}['股市已实现盈亏']`),13);
    const original=await evaluate('km.calls[0]');await reloadStock();await readManualIncome();
    await evaluate(`fetch('/api/stock',{method:'POST',body:JSON.stringify(${JSON.stringify(original)})}).then(r=>r.json())`);await readManualIncome();
    assert.equal(await evaluate(`${incomeTotals}['代币']`),43);
    assert.equal(await evaluate(`${incomeTotals}['股市已实现盈亏']`),13);
    assert.equal(await evaluate(`${ledger}.entries.length`),0);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-income')`);
    assert.equal(events.length,1);assert.equal(events[0].data.amountSource,'receipt.proceedsTokens');
    assert.ok(!JSON.stringify(events).includes(original.idempotencyKey));
  });
  await t.test('卖出实际收入浏览器：手动缺成本仍记到账，原观察页刷新后不借新持仓猜成本',async()=>{
    for(const before of [false,true]){
      await setupStock(manualIncomeSetup+owned+`km.saleReceipt=true;`);
      if(before)await readManualIncome();
      await evaluate(`stockAct('sell',{modelName:'模型甲',shares:3})`);await pulse(1000);
      await reloadStock();await readManualIncome();
      assert.equal(await evaluate(`${incomeTotals}['股市卖出到账']`),35,String(before));
      assert.equal(await evaluate(`${incomeTotals}['股市卖出成本待核对']`),1);
      assert.equal(await evaluate(`${incomeTotals}['股市已实现盈亏']??null`),null);
    }
  });
  await t.test('卖出实际收入浏览器：成功回执先持久保存金额，持仓延迟跨刷新后核对且不重卖',async()=>{
    const close=`const raw=window.fetch;window.fetch=async(url,options)=>{const r=await raw(url,options);
      if(url==='/api/stock'&&options?.method==='POST'){km.hidePositions=true;km.view.rules.reserveTokens=0;}return r;};`;
    await setupStock(settings+owned+`km.saleReceipt=true;km.view.rules.reserveTokens=60;`+close);
    await drive(`${ledger}.pending?.proceeds===58`,'receipt amount durable before position sync');
    assert.equal(await evaluate(`${ledger}.pending.result`),'success');
    await reloadStock(`km.hidePositions=false;`);await drive(done,'pending amount reconciled after reload');
    assert.equal(await evaluate(`${incomeTotals}['股市卖出到账']`),58);
    assert.equal(await evaluate(`${incomeTotals}['股市已实现盈亏']`),8);
    assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('卖出实际收入浏览器：同股手动成交交错时到账各记一次，无法独立核对的成本不猜测',async()=>{
    await setupStock(manualIncomeSetup+owned+`km.saleReceipt=true;`);await readManualIncome();
    await evaluate(`stockAct('sell',{modelName:'模型甲',shares:3})`);
    await evaluate(`stockAct('buy',{modelName:'模型甲',shares:1})`);await readManualIncome();
    assert.equal(await evaluate(`${incomeTotals}['股市卖出到账']`),35);
    assert.equal(await evaluate(`${incomeTotals}['股市卖出成本待核对']`),1);
    assert.equal(await evaluate(`${incomeTotals}['股市已实现盈亏']??null`),null);
    assert.equal(await evaluate('km.calls.length'),2);
  });
  await t.test('股市独立预算浏览器：人工仓成本未知且保留固定预测预算，仍禁止自动下注',async()=>{
    await setupStock(prediction+`km.view.positions=[{stockId:2,shares:10,costBasisTokens:null,holdUntil:null}];`);
    await drive(done,'prediction independent of unknown manual lot');
    assert.equal(await evaluate('km.calls.length'),0);assert.deepEqual(await evaluate(`${ledger}.owned`),{});
    assert.equal(await evaluate('km.view.positions[0].costBasisTokens'),null);
    assert.equal(await evaluate(`${incomeTotals}['股市下注支出']||0`),0);
    await reloadStock();await drive(done,'no duplicate prediction after refresh');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${incomeTotals}['股市下注支出']||0`),0);
  });
  await t.test('股市风险等待浏览器：未知成本到可容纳一注均保持禁止下注，风险诊断保留真实成本',async()=>{
    await setupStock(prediction+`km.view.positions=[{stockId:2,shares:10,costBasisTokens:null,holdUntil:null}];
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},trade:false,predict:true,riskLimit:500}));`);
    await drive(done,'unknown cost blocks explicit risk cap');assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${ledger}.pending`),null);
    await reloadStock(`km.view.positions[0].costBasisTokens=401;
      km.view.rounds[0].lockAt=new Date(clock+240000).toISOString();km.view.rounds[0].closeAt=new Date(clock+900000).toISOString();`);
    await drive(done,'risk headroom below stake');assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate('km.view.positions[0].costBasisTokens'),401);
    await reloadStock(`km.view.positions[0].costBasisTokens=400;
      km.view.rounds[0].lockAt=new Date(clock+240000).toISOString();km.view.rounds[0].closeAt=new Date(clock+900000).toISOString();`);
    await drive(done,'risk headroom exactly one stake');assert.equal(await evaluate('km.calls.length'),0);
    assert.deepEqual(await evaluate(`${ledger}.owned`),{});assert.equal(await evaluate(`${incomeTotals}['股市下注支出']||0`),0);
    const frames=stockSnapshotsFromLog({events:await evaluate(observationEvents)});
    assert.deepEqual([...new Set(frames.map(f=>f.sourceAccount.positions[0].costBasisTokens))],[null,401,400]);
  });
  const stringStockReads=`const originalStockFetch=window.fetch;window.fetch=async(url,options)=>{
    const response=await originalStockFetch(url,options);
    if(url==='/api/stock'&&options?.method==='POST'&&JSON.parse(options.body).action==='sell'&&km.closeSaleLiquidity)
      km.view.rules.reserveTokens=0;
    if(url==='/api/stock'&&options?.method!=='POST'){
      const body=await response.clone().json();body.positions=body.positions.map(p=>({...p,stockId:String(p.stockId)}));
      body.rounds=body.rounds.map(r=>({...r,stockId:String(r.stockId)}));
      body.ticks=body.ticks.map(t=>({...t,stockId:String(t.stockId)}));
      return new Response(JSON.stringify(body),{status:response.status});
    }return response;};`;
  await t.test('股票编号类型浏览器：已有人工持仓的编号被字符串化时不自动加仓',async()=>{
    await setupStock(settings+`km.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];`+stringStockReads);
    await drive(done,'manual position alias does not create a new buy');
    assert.deepEqual(await evaluate('km.calls'),[]);assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.owned['1']??null`),null);
  });
  await t.test('股票编号类型浏览器：脚本持仓按唯一别名卖出并确认剩余成本，刷新不重卖',async()=>{
    // This scenario closes available liquidity after the first partial sale; later sales would be new valid orders.
    await setupStock(settings+owned+`km.view.rules.reserveTokens=60;km.closeSaleLiquidity=true;`+stringStockReads);
    await drive(done,'alias sale settles');
    const list=await evaluate('km.calls');assert.equal(list.length,1);assert.equal(list[0].action,'sell');assert.equal(list[0].shares,5);
    assert.equal(await evaluate(`${ledger}.pending`),null);assert.equal(await evaluate(`${ledger}.owned['1'].shares`),5);
    assert.equal(await evaluate(`${ledger}.owned['1'].cost`),50);assert.equal(await evaluate(`${ledger}.entries[0].releasedCost`),50);
    assert.equal(await evaluate(`${incomeTotals}['股市卖出待核对']`),1);
    await reloadStock(stringStockReads);await drive(done,'alias sale after refresh');assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('股票编号类型浏览器：手动买入别名持仓按增量记账，刷新不计累计成本',async()=>{
    await setupStock(manualIncomeSetup+owned+stringStockReads);await readManualIncome();
    await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);await readManualIncome();
    await until(()=>evaluate(`${incomeTotals}['股市买入支出']===25`),'manual alias purchase cost');
    await reloadStock(stringStockReads);await readManualIncome();assert.equal(await evaluate(`${incomeTotals}['股市买入支出']`),25);
    assert.equal(await evaluate(`${incomeTotals}['股市买入待核对']||0`),0);
  });
  await t.test('股票编号类型浏览器：旧成功买单按别名持仓核对原数量成本，刷新不重复买入',async()=>{
    await setupStock(oldBuy+`km.hidePositions=true;`+stringStockReads);await drive(done,'alias old buy awaiting positions');
    const original=await evaluate(`${ledger}.pending.input`),balance=await evaluate('km.tokens');
    await reloadStock(`km.hidePositions=false;`+stringStockReads);await drive(done,'alias original confirmed');
    assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate('km.tokens'),balance);assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.owned['1'].shares`),original.shares);
    assert.equal(await evaluate(`${incomeTotals}['股市买入支出']`),10000-balance);
  });
  await t.test('股票编号类型浏览器：预测轮次股票别名仍绑定原下注，刷新不重复并按实际返还记账',async()=>{
    await setupStock(oldPrediction+stringStockReads);await drive(done,'alias historical prediction bound');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.entries[0].betId`),1);
    await evaluate(`km.view.myBets[0].settled=true;km.view.myBets[0].payoutTokens=180;`);
    await reloadStock(stringStockReads);await drive(done,'alias prediction settlement');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${incomeTotals}['股市下注支出']`),100);
    assert.equal(await evaluate(`${incomeTotals}['股市返还']`),180);assert.equal(await evaluate(`${incomeTotals}['股市预测净盈亏']`),80);
  });
  await t.test('股市统计长期运行：2000笔已记账旧操作归档后新买入继续核算，不丢未决状态',async()=>{
    await setupStock(manualIncomeSetup+`for(let n=1;n<=2000;n++){
      const id=n.toString(16).padStart(64,'0');localStorage.setItem('arkengine:income-stock:v1:77:'+id,JSON.stringify({
        version:1,id,input:{action:'buy',modelName:'模型甲',shares:1,expectedUserId:77},at:clock-10*86400000,page:'closed-old-page',
        before:null,confirmed:true,flow:true,settled:false,ambiguous:false,automatic:false,betId:null}));}`);
    await readManualIncome();await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);await readManualIncome();
    await until(()=>evaluate(`${incomeTotals}['股市买入支出']===25`),'new income after complete-record archival');
    await until(()=>evaluate(`(${incomeRecords}).length===0`),'completed records archived');
    assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('股市统计长期运行：已结算预测归档，七天日志过期后重放旧编号仍不重复下注或利润',async()=>{
    await setupStock(prediction+manualIncomeSetup);await readManualIncome();
    await evaluate(`stockAct('predict',{roundId:42,direction:'up',betTokens:100})`);await readManualIncome();
    await evaluate(`km.view.myBets[0].settled=true;km.view.myBets[0].payoutTokens=180;`);await readManualIncome();
    await until(()=>evaluate(`(${incomeRecords}).length===0`),'settled prediction archived');
    await evaluate('clock+=8*86400000;');await evaluate(`window.__arkTestLogs.export()`);
    await reloadStock();await readManualIncome();
    await evaluate(`fetch('/api/stock',{method:'POST',body:JSON.stringify(km.calls[0])}).then(r=>r.json())`);await readManualIncome();
    assert.equal(await evaluate(`${incomeTotals}['股市下注支出']||0`),0);
    assert.equal(await evaluate(`${incomeTotals}['代币']||0`),0);assert.equal(await evaluate(`${incomeTotals}['股市预测净盈亏']||0`),0);
    assert.equal(await evaluate(`(${incomeRecords}).length`),0);assert.equal(await evaluate('km.view.myBets.length'),1);
  });
  await t.test('股市统计长期运行：八天未结算预测和未知回执继续保留，晚到结算仍按实际金额入账',async()=>{
    await setupStock(prediction+manualIncomeSetup);await readManualIncome();
    await evaluate(`stockAct('predict',{roundId:42,direction:'up',betTokens:100})`);await readManualIncome();
    await evaluate(`km.mode='unknown';stockAct('buy',{modelName:'模型甲',shares:2})`);await readManualIncome();
    await evaluate('clock+=8*86400000;');await reloadStock();await readManualIncome();
    let records=await evaluate(incomeRecords);assert.equal(records.length,2);
    assert.equal(records.find(e=>e.input.action==='predict').settled,false);assert.equal(records.find(e=>e.input.action==='buy').confirmed,false);
    await evaluate(`km.view.myBets[0].settled=true;km.view.myBets[0].payoutTokens=0;`);await readManualIncome();
    assert.equal(await evaluate(`${incomeTotals}['股市预测净盈亏']`),-100);
    records=await evaluate(incomeRecords);assert.equal(records.length,1);assert.equal(records[0].input.action,'buy');
  });
  await t.test('股市统计长期运行：归档写入失败保留已入账原记录，恢复后清理不重记也不重发',async()=>{
    await setupStock(manualIncomeSetup+`const incomeMetaPut=IDBObjectStore.prototype.put;
      window.restoreIncomeMetaPut=()=>{IDBObjectStore.prototype.put=incomeMetaPut;};
      IDBObjectStore.prototype.put=function(value,...args){if(this.name==='meta'&&String(value?.key).startsWith('stock-income:'))
        throw new DOMException('fixture archive full','QuotaExceededError');return incomeMetaPut.call(this,value,...args);};`);
    await readManualIncome();await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);await readManualIncome();
    await until(()=>evaluate(`${incomeTotals}['股市买入支出']===25`),'income committed before archive fault');
    const records=await evaluate(incomeRecords);assert.equal(records.length,1);assert.equal(records[0].flow,true);
    assert.equal(await evaluate('km.calls.length'),1);
    await evaluate('restoreIncomeMetaPut();');await readManualIncome();
    await until(()=>evaluate(`(${incomeRecords}).length===0`),'archive retried from stored completion');
    assert.equal(await evaluate(`${incomeTotals}['股市买入支出']`),25);assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('股市统计长期运行：批量归档中途失败整个事务回滚，恢复前不删除任何原记录',async()=>{
    await setupStock(manualIncomeSetup+`for(let n=1;n<=3;n++){
      const id=n.toString(16).padStart(64,'0');localStorage.setItem('arkengine:income-stock:v1:77:'+id,JSON.stringify({
        version:1,id,input:{action:'buy',modelName:'模型甲',shares:1,expectedUserId:77},at:clock,page:'closed-old-page',
        before:null,confirmed:true,flow:true,settled:false,ambiguous:false,automatic:false,betId:null}));}
      const incomeMetaPut=IDBObjectStore.prototype.put;let writes=0;
      window.restoreIncomeMetaPut=()=>{IDBObjectStore.prototype.put=incomeMetaPut;};
      IDBObjectStore.prototype.put=function(value,...args){if(this.name==='meta'&&String(value?.key).startsWith('stock-income:')&&++writes===2)
        throw new DOMException('fixture partial archive','QuotaExceededError');return incomeMetaPut.call(this,value,...args);};`);
    await readManualIncome();assert.equal(await evaluate(`(${incomeRecords}).length`),3);
    assert.deepEqual(await evaluate(`Promise.all([1,2,3].map(n=>window.__arkTestLogs.stockIncomeArchived(n.toString(16).padStart(64,'0'))))`),[false,false,false]);
    await evaluate('restoreIncomeMetaPut();');await readManualIncome();
    await until(()=>evaluate(`(${incomeRecords}).length===0`),'batch archive retry committed');
    assert.deepEqual(await evaluate(`Promise.all([1,2,3].map(n=>window.__arkTestLogs.stockIncomeArchived(n.toString(16).padStart(64,'0'))))`),[true,true,true]);
    assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('手动股市跨页收入：旁观页不能把仍存活原页的买入提前结为未知',async()=>{
    await setupStock(manualIncomeSetup);await readManualIncome();
    await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);await pulse(1000);
    const second=await secondStock();
    try{
      await second.evaluate(`fetch('/api/stock').then(r=>r.json())`);await second.pulse(1000);
      assert.equal(await evaluate(`${incomeTotals}['股市买入待核对']||0`),0);
      await readManualIncome();await until(()=>evaluate(`${incomeTotals}['股市买入支出']===25`),'original page retains cost proof');
      assert.equal(await evaluate(`${incomeTotals}['股市买入待核对']||0`),0);
      assert.equal(await second.evaluate('km.calls.length'),0);assert.equal(await evaluate('km.calls.length'),1);
    }finally{await second.close();}
  });
  await t.test('手动股市跨页收入：原页刷新失去中间证据后列未知，不用新页持仓猜成本',async()=>{
    await setupStock(manualIncomeSetup);await readManualIncome();
    await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);await pulse(1000);
    await reloadStock();await readManualIncome();
    assert.equal(await evaluate(`${incomeTotals}['股市买入待核对']`),1);
    assert.equal(await evaluate(`${incomeTotals}['股市买入支出']||0`),0);
    assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('手动股市跨页收入：另一页买卖后旧持仓不能成为新单成本基准，即使股数恢复原值',async()=>{
    for(const refreshBefore of [false,true]){
    await setupStock(manualIncomeSetup+owned);await readManualIncome();
    const second=await secondStock();
    try{
      await second.evaluate(`fetch('/api/stock').then(r=>r.json())`);await second.pulse(1000);
      await second.evaluate(`km.fillPrice=20000;stockAct('buy',{modelName:'模型甲',shares:1})`);
      await second.evaluate(`fetch('/api/stock').then(r=>r.json())`);await second.pulse(1000);
      await second.evaluate(`km.view.positions[0].holdUntil=null;stockAct('sell',{modelName:'模型甲',shares:1})`);
      await second.pulse(1000);
      const serverView=await second.evaluate('km.view');
      assert.equal(serverView.positions[0].shares,10);assert.equal(serverView.positions[0].costBasisTokens,277);
      await evaluate(`km.view=${JSON.stringify(serverView)};`);
      if(refreshBefore)await readManualIncome();
      await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);await readManualIncome();
      assert.equal(await evaluate(`${incomeTotals}['股市买入支出']`),refreshBefore?229:204,'only verified cost is known');
      assert.equal(await evaluate(`${incomeTotals}['股市买入待核对']||0`),refreshBefore?0:1);
    }finally{await second.close();}
    }
  });
  await t.test('手动股市跨页收入：统计锁排队不延迟网站Request成交及原响应读取',async()=>{
    await setupStock(manualIncomeSetup);await readManualIncome();
    await evaluate(`void navigator.locks.request('arkengine:income-stock:records',()=>new Promise(resolve=>{window.releaseIncomeRecords=resolve;}));`);
    await until(()=>evaluate(`typeof releaseIncomeRecords==='function'`),'statistics lock held');
    try{
      const response=await evaluate(`fetch(new Request(new URL('/api/stock',location.href),{method:'POST',body:JSON.stringify({
        action:'buy',modelName:'模型甲',shares:2,expectedUserId:77,idempotencyKey:'manual-stat-lock-key'})})).then(r=>r.json())`);
      assert.equal(response.ok,true);assert.equal(await evaluate('km.view.positions[0].shares'),2);
      assert.equal(await evaluate('km.calls.length'),1);
      assert.equal(await evaluate(`Object.keys(localStorage).filter(k=>k.startsWith('arkengine:income-stock:v1:')).length`),0);
    }finally{await evaluate('releaseIncomeRecords();');}
    await readManualIncome();await until(()=>evaluate(`${incomeTotals}['股市买入支出']===25`),'queued statistics completed');
  });
  await t.test('手动股市跨页收入：别页交易前发起的迟到读取不能重新启用旧成本缓存',async()=>{
    await setupStock(manualIncomeSetup);await readManualIncome();
    const second=await secondStock(`const incomeFetch=window.fetch;km.holdIncomeRead=true;
      window.fetch=(url,options)=>{if(url==='/api/stock'&&options?.method!=='POST'&&km.holdIncomeRead){
        const snapshot=structuredClone(km.view);return new Promise(resolve=>{window.releaseIncomeRead=()=>resolve(new Response(JSON.stringify(snapshot)));});
      }return incomeFetch(url,options);};`);
    try{
      await second.evaluate(`void fetch('/api/stock').then(r=>r.json());`);
      await until(()=>second.evaluate(`typeof releaseIncomeRead==='function'`),'other tab old read held');
      await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);await readManualIncome();
      assert.equal(await evaluate(`${incomeTotals}['股市买入支出']`),25);
      const serverView=await evaluate('km.view');
      await second.evaluate(`km.view=${JSON.stringify(serverView)};km.holdIncomeRead=false;releaseIncomeRead();`);await second.pulse(1000);
      await second.evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);
      await second.evaluate(`fetch('/api/stock').then(r=>r.json())`);await second.pulse(1000);
      assert.equal(await evaluate(`${incomeTotals}['股市买入支出']`),25);
      assert.equal(await evaluate(`${incomeTotals}['股市买入待核对']`),1);
      assert.equal(await second.evaluate('km.calls.length'),1);
    }finally{await second.close();}
  });
  await t.test('手动股市收入：同编号交易内容冲突不得用新成功响应给旧请求记账',async()=>{
    await setupStock(manualIncomeSetup+`km.mode='unknown';`);await readManualIncome();
    const send=shares=>`fetch('/api/stock',{method:'POST',body:JSON.stringify({modelName:'模型甲',shares:${shares},action:'buy',expectedUserId:77,idempotencyKey:'manual-conflicting-key'})}).then(r=>r.json())`;
    await evaluate(send(1));await pulse(1000);
    await evaluate(`km.mode='success';`);await evaluate(send(2));await readManualIncome();
    assert.equal(await evaluate(`${incomeTotals}['股市买入支出']||0`),0);
    assert.equal(await evaluate(`${incomeTotals}['股市买入待核对']||0`),0);
    assert.equal(await evaluate('km.calls.length'),2);
    const records=await evaluate(`Object.keys(localStorage).filter(k=>k.startsWith('arkengine:income-stock:v1:')).map(k=>JSON.parse(localStorage.getItem(k)))`);
    assert.equal(records.length,1);assert.equal(records[0].input.shares,1);assert.equal(records[0].confirmed,false);
  });
  await t.test('手动股市收入：增持按真实成本增量记支出，其他余额变化不混入，不开启自动交易',async()=>{
    await setupStock(manualIncomeSetup+owned);await readManualIncome();
    await evaluate(`km.fillPrice=1500;stockAct('buy',{modelName:'模型甲',shares:2})`);
    await evaluate('km.tokens+=99999;');await readManualIncome();
    await until(()=>evaluate(`${incomeTotals}['股市买入支出']===31`),'manual actual buy cost');
    assert.equal(await evaluate(`${incomeTotals}['代币']||0`),0);assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate('km.reads'),2);assert.equal(await evaluate(`${ledger}.entries.length`),0);
    assert.equal(await evaluate(`${ledger}.owned['1'].manual`),true);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1')).trade`),false);
  });
  await t.test('手动股市收入：同编号重复及刷新不重计，Request正文和原成功响应仍供网页读取',async()=>{
    await setupStock(manualIncomeSetup);await readManualIncome();
    const request={modelName:'模型甲',shares:2,action:'buy',expectedUserId:77,idempotencyKey:'manual-buy-repeat'};
    const response=await evaluate(`Promise.all([0,1].map(i=>fetch(new Request(new URL('/api/stock',location.href),{method:'POST',body:JSON.stringify(${JSON.stringify(request)})})).then(r=>r.json())))`);
    assert.ok(response.every(r=>r.ok===true));await readManualIncome();
    await until(()=>evaluate(`${incomeTotals}['股市买入支出']===25`),'manual replay counts once');
    await reloadStock();await readManualIncome();
    assert.equal(await evaluate(`${incomeTotals}['股市买入支出']`),25);assert.equal(await evaluate('km.view.positions[0].shares'),2);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-income')`);
    assert.equal(events.length,1);assert.ok(!JSON.stringify(events).includes(request.idempotencyKey));
  });
  await t.test('手动股市收入：缺少买入前状态则金额未知，卖出缺到账不能用报价凑利润',async()=>{
    await setupStock(manualIncomeSetup);
    await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);await readManualIncome();
    assert.equal(await evaluate(`${incomeTotals}['股市买入待核对']`),1);assert.equal(await evaluate(`${incomeTotals}['股市买入支出']||0`),0);
    await evaluate(`km.view.positions[0].holdUntil=null;stockAct('sell',{modelName:'模型甲',shares:2})`);await readManualIncome();
    assert.equal(await evaluate(`${incomeTotals}['股市卖出待核对']`),1);assert.equal(await evaluate(`${incomeTotals}['代币']||0`),0);
  });
  await t.test('手动股市收入：预测本金与返还分列，绑定后跨刷新结算，盈利和亏损均只记一次',async()=>{
    for(const payout of [180,0]){
      await setupStock(prediction+manualIncomeSetup);await readManualIncome();
      await evaluate(`stockAct('predict',{roundId:42,direction:'up',betTokens:100})`);await readManualIncome();
      assert.equal(await evaluate(`${incomeTotals}['股市下注支出']`),100);
      await reloadStock();await evaluate(`km.view.myBets[0].settled=true;km.view.myBets[0].payoutTokens=${payout};`);await readManualIncome();
      await until(()=>evaluate(`${incomeTotals}['股市预测净盈亏']===${payout-100}`),'manual prediction settled');
      await readManualIncome();assert.equal(await evaluate(`${incomeTotals}['代币']`),payout);
      assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).counts['stock-prediction-settled']`),1);
      assert.equal(await evaluate('km.calls.length'),1);
    }
  });
  await t.test('手动股市收入：未知、拒绝和错误账号回执不入账，持仓变化不能替代原成功回执',async()=>{
    for(const mode of ['unknown','rejected','wrong-user']){
      await setupStock(manualIncomeSetup+`km.mode='${mode}';`);await readManualIncome();
      await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);await readManualIncome();
      assert.equal(await evaluate(`${incomeTotals}['股市买入支出']||0`),0,mode);
      assert.equal(await evaluate(`${incomeTotals}['股市买入待核对']||0`),0,mode);assert.equal(await evaluate('km.calls.length'),1);
    }
  });
  await t.test('手动股市收入：同模型多笔交易穿插后成本不能独立归属，缺失期间的成本保持未知',async()=>{
    await setupStock(manualIncomeSetup);await readManualIncome();
    await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);
    await evaluate(`stockAct('sell',{modelName:'模型甲',shares:1})`);
    await evaluate(`stockAct('buy',{modelName:'模型甲',shares:1})`);await readManualIncome();
    assert.equal(await evaluate('km.view.positions[0].shares'),2);
    assert.equal(await evaluate(`${incomeTotals}['股市买入支出']||0`),0);
    assert.equal(await evaluate(`${incomeTotals}['股市买入待核对']`),2);
  });
  await t.test('手动股市收入：人工确认旧自动预测后重放原编号，跨刷新仍不重复或生成额外待结算记录',async()=>{
    await setupStock(unknownPrediction);await drive(done,'historical prediction remains pending');
    const p=await evaluate(`${ledger}.pending`),request={...p.input,idempotencyKey:p.key};
    assert.equal(await evaluate('km.calls.length'),0);
    await evaluate(`stockAct('predict',{});`);await evaluate(`${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.pending===null`,'manual original prediction reconciles before replay');
    await evaluate(`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);await reloadStock();
    await evaluate(`fetch('/api/stock',{method:'POST',body:JSON.stringify(${JSON.stringify(request)})}).then(r=>r.json())`);await readManualIncome();
    assert.equal(await evaluate(`${incomeTotals}['股市下注支出']`),100);
    assert.match(await evaluate(`${panel}.getElementById('stock-manual-income').textContent`),/0 笔预测/);
    assert.equal(await evaluate('km.view.myBets.length'),1);
    assert.equal(await evaluate('km.calls.length'),2);assert.equal(await evaluate('km.tokens'),9900);
  });
  await t.test('手动股市收入：统计存储失败不改变原网页成交，清楚提示统计缺口且不补发',async()=>{
    await setupStock(manualIncomeSetup+`const save=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
      if(k.startsWith('arkengine:income-stock:v1:'))throw Error('fixture income quota');return save.call(this,k,v);};`);
    await readManualIncome();await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);await pulse(1000);
    assert.equal(await evaluate('km.view.positions[0].shares'),2);assert.equal(await evaluate('km.calls.length'),1);
    assert.match(await evaluate(`${panel}.getElementById('stock-manual-income').textContent`),/不可核对/);
    assert.equal(await evaluate(`${incomeTotals}['股市买入支出']||0`),0);
  });
  await t.test('手动股市收入：交易前发起的迟到读取不能证明交易后成本，后续原生读取才完成核对',async()=>{
    await setupStock(manualIncomeSetup);await readManualIncome();
    await evaluate(`km.deferRead=true;void fetch('/api/stock').then(r=>r.json());`);
    await evaluate(`stockAct('buy',{modelName:'模型甲',shares:2})`);
    await evaluate(`km.deferRead=false;km.resolveRead();`);await pulse(1000);
    assert.equal(await evaluate(`${incomeTotals}['股市买入支出']||0`),0);
    await readManualIncome();assert.equal(await evaluate(`${incomeTotals}['股市买入支出']`),25);
  });
  await t.test('收入统计股市：暂停新买不产生支出，卖出无明确到账不能用报价或余额差计收入',async()=>{
    await setupStock(settings);await drive(done,'new buy paused');
    assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${incomeTotals}['股市买入支出']||0`),0);
    assert.equal(await evaluate(`${incomeTotals}['代币']||0`),0);
    await reloadStock();await drive(done,'new buy remains paused after reload');
    assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${incomeTotals}['股市买入支出']||0`),0);
    await setupStock(settings+owned);await drive(done,'unknown sale income');
    assert.equal(await evaluate(`${incomeTotals}['股市卖出待核对']`),1);
    assert.equal(await evaluate(`${incomeTotals}['代币']||0`),0);
  });
  const saleShapeResponse=`const saleShapeFetch=window.fetch;window.fetch=async(url,options)=>{
    const response=await saleShapeFetch(url,options);
    if(url==='/api/stock'&&options?.method==='POST'&&JSON.parse(options.body).action==='sell'){
      const body=await response.clone().json();return new Response(JSON.stringify({...body,
        result:{payoutTokens:987654321,note:'private receipt text'},accessToken:'private-access'}),{status:response.status});
    }return response;};`;
  await t.test('卖出回执诊断浏览器：自动卖出只记录字段类型，候选金额不算实际收入，刷新不重卖',async()=>{
    await setupStock(settings+owned+saleShapeResponse);await drive(done,'sale schema recorded');
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-response')`);
    const sale=events.find(e=>e.data.action==='sell');assert.ok(sale?.data.receiptShape);
    assert.match(JSON.stringify(sale.data.receiptShape),/payoutTokens/);
    assert.doesNotMatch(JSON.stringify(events),/private-access|private receipt text|987654321|idempotencyKey/);
    assert.equal(await evaluate(`${ledger}.entries.find(e=>e.action==='sell').proceeds`),null);
    assert.equal(await evaluate(`${incomeTotals}['股市卖出待核对']`),1);assert.equal(await evaluate(`${incomeTotals}['代币']||0`),0);
    await reloadStock();await drive(done,'schema inspection cannot trigger a new sale');assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('卖出回执诊断浏览器：手动成交原样通过，结构诊断与未知收入各记一次',async()=>{
    await setupStock(manualIncomeSetup+`km.view.positions=[{stockId:1,shares:2,costBasisTokens:20,holdUntil:null}];`+saleShapeResponse);
    await readManualIncome();await evaluate(`stockAct('sell',{modelName:'模型甲',shares:2})`);await readManualIncome();
    let events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-sell-receipt-shape')`);
    assert.equal(events.length,1);assert.equal(events[0].data.source,'manual');assert.match(JSON.stringify(events),/payoutTokens/);
    assert.doesNotMatch(JSON.stringify(events),/987654321|private receipt text|private-access|idempotencyKey/);
    await evaluate(`fetch('/api/stock',{method:'POST',body:JSON.stringify(km.calls[0])}).then(r=>r.json())`);await readManualIncome();
    events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-sell-receipt-shape')`);
    assert.equal(events.length,1);assert.equal(await evaluate(`${incomeTotals}['股市卖出待核对']`),1);
    assert.equal(await evaluate(`${incomeTotals}['代币']||0`),0);assert.equal(await evaluate('km.view.positions[0].shares'),0);
  });
  await t.test('收入统计股市：预测输赢分开统计返还与净盈亏，同笔结算刷新不重复',async()=>{
    for(const payout of [180,0]){
      await setupStock(oldPrediction);await drive(done,'historical prediction expense reconciled');
      assert.equal(await evaluate(`${incomeTotals}['股市下注支出']`),100);
      await evaluate(`km.view.myBets[0].settled=true;km.view.myBets[0].payoutTokens=${payout};km.tokens+=${payout};${panel}.getElementById('stock-check').click();`);
      await drive(`${ledger}.entries[0].settlement?.payout===${payout}`,'prediction settlement');await drive(done,'settlement finished');
      assert.equal(await evaluate(`${incomeTotals}['代币']`),payout);
      assert.equal(await evaluate(`${incomeTotals}['股市返还']`),payout);
      assert.equal(await evaluate(`${incomeTotals}['股市预测净盈亏']`),payout-100);
      await reloadStock();await drive(done,'settlement retained');
      assert.equal(await evaluate(`${incomeTotals}['股市预测净盈亏']`),payout-100);
      assert.match(await evaluate(`${panel}.getElementById('log-summary').textContent`),/非净利润/);
      assert.equal(await evaluate('km.calls.length'),0);
    }
  });
  await t.test('收入统计股市：次日确认结算计入次日，昨日下注支出不随返还搬动',async()=>{
    await setupStock(oldPrediction);await drive(done,'previous day historical prediction reconciled');
    await evaluate(`clock+=86400000;km.view.myBets[0].settled=true;km.view.myBets[0].payoutTokens=180;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.entries[0].settlement?.payout===180`,'next day settlement');await drive(done,'next day finished');
    assert.equal(await evaluate(`${incomeTotals}['代币']`),180);
    assert.equal(await evaluate(`${incomeTotals}['股市下注支出']||0`),0);
    const previous=await evaluate(`(await window.__arkTestLogs.read('expedition','2026-10-10',Infinity)).totals`);
    assert.equal(previous['股市下注支出'],100);assert.equal(previous['代币']||0,0);
    assert.equal(await evaluate('km.calls.length'),0);
  });
  const delayedPage=`const nativeStock=renderStock;window.renderStock=()=>{if(km.pageReady)nativeStock();else {game.innerHTML='<a href="/activities/expedition">远征</a><p>正在加载页面内容</p>';game.querySelector('a').onclick=e=>{e.preventDefault();navFarm('/activities/expedition');};}};`;
  await t.test('逐仓浏览器：显示持有期和报价浮盈亏，刷新保留，观察模式仍不卖出',async()=>{
    await setupStock(settings+owned+`const cfg=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));cfg.observeOnly=true;
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(cfg));
      km.view.positions[0].holdUntil=new Date(clock+3600000).toISOString();`);
    await drive(done,'position details ready');
    let text=await evaluate(`${panel}.getElementById('stock-positions').textContent`);
    assert.match(text,/模型甲.*10 股.*成本 100/);assert.match(text,/持有期/);assert.match(text,/浮盈亏/);
    assert.equal(await evaluate('km.calls.length'),0);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const check=events.filter(e=>e.type==='stock-check').at(-1);assert.equal(check.data.positions[0].status,'locked');
    await reloadStock();await drive(done,'position details survive reload');
    assert.match(await evaluate(`${panel}.getElementById('stock-positions').textContent`),/持有期/);
    await evaluate(`clock+=3601000;km.view.positions[0].holdUntil=null;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.valuation?.positions?.[0]?.status==='sell'`,'unlocked position explains exit');
    text=await evaluate(`${panel}.getElementById('stock-positions').textContent`);assert.match(text,/可卖/);
    assert.equal(await evaluate('km.calls.length'),0,'观察状态不因达到卖出条件而提交');
  });
  await t.test('股市核算浏览器：卖出成本按原持仓扣除，到账缺证据显示未知而非余额差',async()=>{
    await setupStock(settings+owned);
    await drive(done,'sell accounting');
    const sale=await evaluate(`${ledger}.entries.find(e=>e.action==='sell')`);
    assert.equal(sale.result,'success');assert.equal(sale.releasedCost,100);assert.equal(sale.proceeds,null);
    assert.match(await evaluate(`${panel}.getElementById('stock-performance').textContent`),/1 笔卖出到账.*未知/);
    await evaluate(`clock+=8*86400000;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.archive?.unknownSales===1`,'old sale archived without losing unknown amount');
    assert.equal(await evaluate(`${ledger}.archive.releasedCost`),100);
    await reloadStock();await drive(done,'archive retained');
    assert.equal(await evaluate(`${ledger}.archive.unknownSales`),1);
  });
  await t.test('股市独立风控浏览器：单股零上限阻止买入，设置保存与刷新不丢失',async()=>{
    await setupStock(settings+`const config=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));
      Object.assign(config,{perStockLimit:0,riskLimit:1000,dailyBuyLimit:500,lossLimit:100,cashReserve:100});
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(config));`);
    await drive(done,'zero single stock limit');assert.equal(await evaluate('km.calls.length'),0);
    await evaluate(`${panel}.getElementById('stock-save').click();`);await reloadStock();
    assert.equal(await evaluate(`${panel}.getElementById('stock-single-limit').value`),'0');
    assert.equal(await evaluate(`${panel}.getElementById('stock-daily-buy-limit').value`),'500');
    await drive(done,'saved limits remain');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市观察模式：记录当前信号但不交易，刷新保留观察开关',async()=>{
    await setupStock(settings+`const c=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));c.observeOnly=true;
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(c));`);
    await drive(done,'observation snapshot');assert.equal(await evaluate('km.calls.length'),0);
    assert.match(await evaluate(`${ledger}.note`),/仅观察/);
    const observations=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-observation')`);
    assert.equal(observations.length,1);assert.equal(observations[0].data.snapshot.stocks[0].modelName,'模型甲');
    assert.equal(observations[0].data.settings.tradeLimit,3000);assert.equal(observations[0].data.settings.observeOnly,true);
    assert.equal(observations[0].data.snapshot.accountSnapshot.userId,77);
    assert.equal(observations[0].data.snapshot.accountSnapshot.pendingKnown,true);
    assert.equal(observations[0].data.snapshot.accountSnapshot.pending,null);
    assert.deepEqual(observations[0].data.snapshot.accountSnapshot.positions,[]);
    assert.equal(observations[0].data.observationVersion,2);assert.equal(observations[0].data.reading.phase,'scan');
    assert.ok(observations[0].data.at>=Math.max(observations[0].data.reading.marketAt,observations[0].data.reading.balanceAt));
    assert.equal(Object.hasOwn(observations[0].data,'choice'),false,'raw collection cannot invent an evaluated decision');
    const decisions=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-decision')`);
    assert.equal(decisions[0].data.observationId,observations[0].data.observationId);
    assert.equal(decisions[0].data.selected,null);assert.equal(decisions[0].data.policy.newBuy,false);
    await reloadStock();assert.equal(await evaluate(`${panel}.getElementById('stock-observe').checked`),true);
    await drive(done,'observation refreshed');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市观察采集：交易模式保留提交前和核对早退快照，并关联实际订单',async()=>{
    await setupStock(settings+owned);await drive(done,'old-position trading with raw evidence');
    assert.equal(await evaluate('km.calls.length'),1);
    const all=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const raw=all.filter(e=>e.type==='stock-observation'),frames=stockSnapshotsFromLog({events:raw});
    assert.ok(frames.length>=3);assert.equal(frames[0].view.positions[0].shares,10);
    assert.equal(frames[0].sourceAccount.balanceTokens,10000);assert.equal(frames[0].recordedSettings.observeOnly,undefined);
    const reconciliation=frames.filter(f=>f.sourceObservation.reading.phase==='reconcile');assert.ok(reconciliation.length);
    assert.ok(reconciliation.some(f=>f.sourceAccount.pending?.action==='sell'&&f.view.positions[0]?.shares===0));
    assert.equal(frames.at(-1).sourceAccount.balanceTokens,await evaluate('km.tokens'));
    for(const e of all.filter(e=>['stock-submit','stock-confirmed'].includes(e.type))){
      const f=frames.find(f=>f.sourceObservation.id===e.data.observationId);assert.ok(f,JSON.stringify(e));assert.ok(f.at<=e.at);
    }
    assert.equal(raw.some(e=>e.data.truncated),false);
    const opening=frames[0];
    await setupStock(settings+owned+`const c=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));c.observeOnly=true;localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(c));`);
    await drive(done,'same starting market in observe mode');assert.equal(await evaluate('km.calls.length'),0);
    const observed=stockSnapshotsFromLog({events:await evaluate(observationEvents)})[0];
    assert.deepEqual(observed.view.stocks,opening.view.stocks);assert.deepEqual(observed.view.rules,opening.view.rules);
    assert.deepEqual(observed.sourceAccount,opening.sourceAccount);
  });
  await t.test('股市观察采集：缓存循环不重复记行情，价格不变的余额和规则变化仍保留',async()=>{
    await setupStock(settings+owned+`document.querySelector('[aria-label="模型甲 交易数量"]').remove();`);
    await until(async()=> (await evaluate(observationEvents)).length===1,'first accepted cached read');
    for(let i=0;i<3;i++)await pulse(1000);
    assert.equal((await evaluate(observationEvents)).length,1);assert.equal(await evaluate('km.calls.length'),0);
    await evaluate('renderStock();');await drive(done,'controls restored without duplicate order');assert.equal(await evaluate('km.calls.length'),1);
    await setupStock(settings+`const c=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));c.observeOnly=true;localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(c));`);
    await drive(done,'initial unchanged price');
    const first=stockSnapshotsFromLog({events:await evaluate(observationEvents)})[0];
    await evaluate(`km.tokens+=50;km.view.rules.sellFeePct=3;${panel}.getElementById('stock-check').click();`);
    await drive('km.reads>=2','requested account recheck actually begins');
    await drive(done,'new account evidence without price changes');
    const frames=stockSnapshotsFromLog({events:await evaluate(observationEvents)});assert.equal(frames.length,2);
    assert.deepEqual(frames[1].view.stocks,first.view.stocks);assert.equal(frames[1].sourceAccount.balanceTokens,10050);
    assert.equal(frames[1].view.rules.sellFeePct,3);assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市观察采集：一秒错时不把后来余额写回较早行情时刻',async()=>{
    await setupStock(settings+`const c=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));c.observeOnly=true;localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(c));km.deferBalance=true;`);
    await until(()=>evaluate(`typeof km.resolveBalance==='function'`),'balance is waiting');
    assert.equal((await evaluate(observationEvents)).length,0);
    await pulse(1000);await evaluate('km.tokens=9000;km.deferBalance=false;km.resolveBalance();');
    await drive(done,'both responses accepted');const frames=stockSnapshotsFromLog({events:await evaluate(observationEvents)});
    assert.equal(frames.length,1);const r=frames[0].sourceObservation.reading;
    assert.equal(r.balanceAt-r.marketAt,1000);assert.equal(r.freshnessAt,r.marketAt);
    assert.ok(frames[0].at>=r.balanceAt);assert.equal(frames[0].sourceAccount.balanceTokens,9000);
    assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市观察采集：三次动作上限早退仍保留最后读数，不追加第四笔',async()=>{
    await setupStock(splitExit);
    await drive(done,'three actions finish the visit',240);assert.equal(await evaluate('km.calls.length'),3);
    const all=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`),check=all.filter(e=>e.type==='stock-check').at(-1);
    assert.match(check.detail,/本轮三笔已核对/);assert.equal(check.data.exitContinuation.shares,5);
    const frames=stockSnapshotsFromLog({events:all});
    assert.ok(frames.some(f=>f.sourceObservation.id===check.data.observationId));
    assert.equal(frames.at(-1).sourceAccount.balanceTokens,await evaluate('km.tokens'));
  });
  await t.test('股市观察采集：账号变化隔离旧账本，不生成拼接快照',async()=>{
    await setupStock(settings+owned+`km.view.userId=88;`);await drive(done,'account mismatch');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal((await evaluate(observationEvents)).length,0);
    assert.equal(await evaluate(`${ledger}.userId`),77);assert.match(await evaluate(`${ledger}.note`),/账号已变化/);
  });
  await t.test('股市观察起点浏览器：保留已有仓与实际余额，观察不卖出且导出不改成空仓',async()=>{
    await setupStock(settings+owned+`const c=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));c.observeOnly=true;
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(c));`);
    await drive(done,'opening account observation');assert.equal(await evaluate('km.calls.length'),0);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-observation')`);
    const snapshots=stockSnapshotsFromLog({events});assert.equal(snapshots.length,1);
    assert.deepEqual(snapshots[0].view.positions,[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}]);
    assert.equal(snapshots[0].sourceAccount.balanceTokens,await evaluate('km.tokens'));
    assert.equal(snapshots[0].sourceAccount.pendingKnown,true);assert.equal(snapshots[0].sourceAccount.pending,null);
  });
  await t.test('股市观察分片：67只模型记录不被日志截断，导出后可还原完整行情',async()=>{
    await setupStock(settings+`const c=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));c.observeOnly=true;
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(c));
      km.view.stocks=Array.from({length:67},(_,i)=>({id:i+1,modelName:'模型'.repeat(80)+i,priceCents:1200,volume24h:1000}));
      km.view.ticks=km.view.stocks.flatMap(s=>Array.from({length:12},(_,i)=>({stockId:s.id,priceCents:980+i*20,createdAt:new Date(clock-(11-i)*300000).toISOString()})));`);
    await drive(done,'complete large market observation');assert.equal(await evaluate('km.calls.length'),0);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-observation')`);
    assert.ok(events.length>1);assert.ok(events.every(e=>!e.data.truncated));
    const snapshots=stockSnapshotsFromLog({events});assert.equal(snapshots.length,1);
    assert.equal(snapshots[0].view.stocks.length,67);assert.equal(snapshots[0].view.ticks.length,67*12);
    await evaluate(`window.exportedBlob=null;URL.createObjectURL=b=>{exportedBlob=b;return 'blob:local';};HTMLAnchorElement.prototype.click=function(){};
      [...${panel}.querySelectorAll('details button')].find(b=>b.textContent==='导出两页日志（7 天）').click();`);
    await until(()=>evaluate('Boolean(window.exportedBlob)'),'native JSON export generated');
    const exportedText=await evaluate('exportedBlob.text()'),exported=JSON.parse(exportedText),restored=stockSnapshotsFromLog(exported);
    assert.deepEqual(restored,snapshots,'actual export bytes must reconstruct the same complete observed market');
    console.log(JSON.stringify({kind:'stock-observation-native-export',bytes:Buffer.byteLength(exportedText),
      observations:restored.length,parts:events.length,stocks:restored[0].view.stocks.length,ticks:restored[0].view.ticks.length,
      schema:restored[0].sourceObservation.version,pendingKnown:restored[0].sourceAccount.pendingKnown,
      scope:'local 67-stock fixture, exported JSON Blob parsed; not real seven-day coverage'}));
  });
  await t.test('股市详细诊断浏览器：普通模式记录67只股票未买原因及关联分片，不增加下单',async()=>{
    await setupStock(settings+`
      km.view.stocks=Array.from({length:67},(_,i)=>({id:i+1,modelName:'模型'.repeat(80)+i,priceCents:1050,volume24h:1000}));
      km.view.ticks=km.view.stocks.flatMap(s=>[1000,1010,1020,1030,1040,1050].map((priceCents,i)=>({stockId:s.id,priceCents,createdAt:new Date(clock-(5-i)*300000).toISOString()})));`);
    await drive(done,'detailed no-buy evaluation');assert.equal(await evaluate('km.calls.length'),0);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.equal(events.filter(e=>e.type==='stock-diagnostic-error').length,0);
    const summary=events.filter(e=>e.type==='stock-decision');assert.equal(summary.length,1);
    const detail=events.filter(e=>e.type==='stock-decision-detail'),rows=detail.flatMap(e=>e.data.rows);
    assert.equal(detail.length,summary[0].data.totalParts);assert.ok(detail.length>1);
    assert.ok(detail.every(e=>!e.data.truncated&&e.data.diagnosticId===summary[0].data.diagnosticId));
    assert.equal(new Set(rows.map(r=>r.stockId)).size,67);assert.equal(rows.length,67);
    assert.ok(rows.every(r=>r.buy.blockers.includes('below-fee-threshold')&&r.trend.samples===6));
    assert.equal(summary[0].data.selected,null);assert.equal(summary[0].data.policy.observeOnly,false);
    assert.equal(events.filter(e=>e.type==='stock-check').at(-1).data.diagnosticId,summary[0].data.diagnosticId);
  });
  const heldReadBody=(path,limit=1)=>settings+owned+saleOnce+`
    km.hungBodies=[];km.readTimeouts=[];const readBeforeBodyHold=window.fetch,readTimer=window.setTimeout.bind(window);
    window.setTimeout=(fn,ms,...args)=>{
      if(ms===30000){km.readTimeouts.push(fn);return readTimer(()=>{},600000);}
      return readTimer(fn,ms,...args);
    };
    window.fetch=(url,options)=>{
      const response=readBeforeBodyHold(url,options);
      if(url==='${path}'&&options?.method!=='POST'&&km.hungBodies.length<${limit}){
        const held={signal:options.signal,at:clock};km.hungBodies.push(held);
        return response.then(r=>{const body=r.json.bind(r);
          r.json=()=>body().then(data=>new Promise(resolve=>{held.release=()=>resolve(data);}));return r;});
      }return response;
    };`;
  for(const path of ['/api/stock','/api/me/balance'])await t.test('股市读取期限浏览器：'+path+'响应体不响应取消时仍可重读，迟到不改账',async()=>{
    await setupStock(heldReadBody(path));
    await until(()=>evaluate('typeof km.hungBodies[0]?.release===\'function\''),'first body held');
    await pulse(31000);await pulse(3000);await pulse();
    assert.equal(await evaluate('km.hungBodies[0].signal.aborted'),true);
    assert.ok(await evaluate('km.reads>=2'),'timeout releases the old read before its body returns');
    await drive(done,'replacement read settles one old-position sale');
    const entries=await evaluate(`${ledger}.entries`),tokens=await evaluate('km.tokens');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(entries[0].result,'success');
    assert.equal(entries[0].releasedCost,100);assert.equal(entries[0].proceeds,117);
    assert.equal(await evaluate('km.calls[0].action'),'sell');
    await evaluate('km.hungBodies[0].release();');await pulse();
    assert.deepEqual(await evaluate(`${ledger}.entries`),entries);assert.equal(await evaluate('km.tokens'),tokens);
    await reloadStock();for(let i=0;i<8;i++)await pulse();assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('股市读取期限浏览器：后台迟到响应先于超时回调，仍拒绝过期快照',async()=>{
    await setupStock(heldReadBody('/api/stock'));
    await until(()=>evaluate('typeof km.hungBodies[0]?.release===\'function\''),'body ready before background time jump');
    await evaluate('clock+=31000;km.hungBodies[0].release();km.tokens=500;km.view.rules.reserveTokens=50;');
    await until(()=>evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>e.type==='stock-read-failed')||${observationEvents}.length>0`),'late response processed');
    assert.equal((await evaluate(observationEvents)).length,0,'expired response cannot become a fresh observation');
    assert.equal(await evaluate('km.calls.length'),0);
    await drive(done,'read current balance after rejecting expired response');
    assert.equal(await evaluate('km.calls.length'),1);assert.ok(await evaluate('km.tokens>=100'));
    assert.equal(await evaluate('km.calls[0].action'),'sell');assert.equal(await evaluate('km.calls[0].shares'),4);
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),46);assert.equal(await evaluate(`${ledger}.pending`),null);
  });
  await t.test('股市读取期限浏览器：连续两次响应体挂起按原次数退出，不拖满访问上限',async()=>{
    await setupStock(heldReadBody('/api/stock',2));
    await until(()=>evaluate('typeof km.hungBodies[0]?.release===\'function\''),'first body remains held');
    const started=await evaluate('clock');await pulse(31000);await pulse(3000);await pulse();
    assert.equal(await evaluate('km.hungBodies.length'),2);
    await pulse(31000);await drive(done,'second timeout returns to expedition',10);
    assert.ok(await evaluate(`clock-${started}<80000`));assert.equal(await evaluate('km.calls.length'),0);
    const failures=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-read-failed')`);
    assert.deepEqual(failures.map(e=>e.data.attempt),[1,2]);assert.ok(failures.every(e=>e.data.reason==='timeout'));
    assert.equal(await evaluate(`${ledger}.pending`),null);assert.match(await evaluate(`${ledger}.note`),/未能完整读取/);
  });
  const receiptReadRace=path=>settings+owned+`km.saleReceipt=true;
    km.receiptReleased=false;km.receiptReads=[];const receiptRead=window.fetch;
    window.fetch=(url,options)=>{
      if(url==='/api/stock'&&options?.method==='POST'){
        km.beforeReceiptView=structuredClone(km.view);km.beforeReceiptTokens=km.tokens;
        return receiptRead(url,options).then(response=>new Promise(resolve=>{
          km.releaseReceipt=()=>{km.receiptReleased=true;km.receiptAt=clock;resolve(response);};
        }));
      }
      if(url==='${path}'&&options?.method!=='POST'&&km.calls.length&&!km.receiptReleased){
        const data=url==='/api/stock'?km.beforeReceiptView:{tokens:km.beforeReceiptTokens,diamonds:10};
        const response=new Response(JSON.stringify(data));km.oldReadSignal=options.signal;
        // The headers arrived, but a body copy can finish after cancellation.
        response.json=()=>new Promise(resolve=>{km.releaseOldRead=()=>resolve(structuredClone(data));});
        return Promise.resolve(response);
      }
      if((url==='/api/stock'||url==='/api/me/balance')&&options?.method!=='POST'&&km.receiptReleased)
        km.receiptReads.push({url,at:clock});
      return receiptRead(url,options);
    };`;
  for(const path of ['/api/stock','/api/me/balance'])await t.test('股市回执换代：'+path+'旧读取未返回也能核对成交，迟到结果不覆盖',async()=>{
    await setupStock(receiptReadRace(path));
    await drive(`typeof km.releaseOldRead==='function'`,'pre-receipt read body held',45);
    assert.equal(await evaluate('km.calls.length'),1);
    await evaluate('km.releaseReceipt();');
    await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'successful original receipt recorded');
    for(let i=0;i<4;i++)await pulse();
    assert.equal(await evaluate(`${ledger}.pending`),null,'fresh reads can confirm before the obsolete body finishes');
    assert.equal(await evaluate('km.oldReadSignal.aborted'),true);
    assert.ok(await evaluate('km.receiptReads.some(r=>r.url===\'/api/stock\')&&km.receiptReads.some(r=>r.url===\'/api/me/balance\')'));
    const entries=await evaluate(`${ledger}.entries`),tokens=await evaluate('km.tokens');
    assert.equal(entries.length,1);assert.equal(entries[0].result,'success');
    assert.equal(entries[0].releasedCost,100);assert.equal(entries[0].proceeds,117);
    assert.equal(await evaluate('km.calls[0].action'),'sell');
    await evaluate('km.releaseOldRead();');await drive(done,'obsolete body cannot block the settled visit');
    assert.deepEqual(await evaluate(`${ledger}.entries`),entries);assert.equal(await evaluate('km.tokens'),tokens);
    assert.equal(await evaluate('km.calls.length'),1);
    await reloadStock();for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending`),null);
  });
  await t.test('股市回执换代：旧响应迟到不释放正在进行的新读取',async()=>{
    await setupStock(receiptReadRace('/api/stock')+`
      const holdFresh=window.fetch;window.fetch=(url,options)=>{
        const response=holdFresh(url,options);
        if(url==='/api/stock'&&options?.method!=='POST'&&km.receiptReleased&&!km.freshHeld){
          km.freshHeld=true;km.freshReadSignal=options.signal;
          return response.then(r=>new Promise(resolve=>{km.releaseFreshRead=()=>resolve(r);}));
        }return response;
      };`);
    await drive(`typeof km.releaseOldRead==='function'`,'old read held before receipt');await evaluate('km.releaseReceipt();');
    await drive(`typeof km.releaseFreshRead==='function'`,'fresh replacement read starts before old body resolves',12);
    assert.equal(await evaluate('km.oldReadSignal.aborted'),true);
    await evaluate('km.releaseOldRead();');await pulse(2000);
    assert.equal(await evaluate('km.freshReadSignal.aborted'),false);
    assert.equal(await evaluate(`km.receiptReads.filter(r=>r.url==='/api/stock').length`),1,'old finalizer must not free the replacement read slot');
    assert.equal(await evaluate(`${ledger}.pending.result`),'success');assert.equal(await evaluate('km.calls.length'),1);
    await evaluate('km.releaseFreshRead();');await drive(`${ledger}.pending===null`,'replacement read confirms original transaction');
    await drive(done,'fresh read completes the visit');assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate(`${ledger}.entries[0].releasedCost`),100);
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);
  });
  await t.test('股市慢请求修复：提交前余额17秒返回后继续卖出旧仓，回执和持仓均确认',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;`);
    await drive(`Number(document.querySelector('[aria-label="模型甲 交易数量"]').value)>1`,'quantity filled');
    await evaluate('km.deferBalance=true;');
    await drive(`typeof km.resolveBalance==='function'`,'pre-submit balance waiting');
    await pulse(17000);assert.equal(await evaluate('location.pathname'),'/stock');assert.deepEqual(await evaluate('km.calls'),[]);
    await evaluate('km.deferBalance=false;km.resolveBalance();');await drive(done,'old lot sold after slow balance');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.entries[0].result`),'success');
    assert.equal(await evaluate(`${ledger}.owned['1']`),undefined);assert.equal(await evaluate('km.view.positions[0].shares'),0);
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);
  });
  await t.test('股市慢请求修复：临时读取失败本轮恢复，持续失败有界退出且不下单',async()=>{
    for(const failures of [1,10]){
      await setupStock(settings+owned+`km.readErrorsLeft=${failures};`);await drive(done,'bounded read recovery');
      assert.equal(await evaluate('km.calls.length'),failures===1?1:0);
      assert.equal(await evaluate(`${ledger}.pending`),null);
      if(failures===10){assert.equal(await evaluate('km.reads'),2);assert.match(await evaluate(`${ledger}.note`),/读取/);}
    }
  });
  await t.test('股市快慢快照：余额迟到期间行情涨价，提交前重读旧行情并按新价缩量',async()=>{
    await setupStock(settings+owned+saleOnce+`km.view.rules.reserveTokens=117;`);
    await drive(`Number(document.querySelector('[aria-label="模型甲 交易数量"]').value)>1`,'quantity before market changes');
    const quantity=await evaluate(`Number(document.querySelector('[aria-label="模型甲 交易数量"]').value)`);
    await evaluate('km.deferBalance=true;');await drive(`typeof km.resolveBalance==='function'`,'slow pre-submit balance');
    // 余额继续保持慢接口；只有补读较快的行情，才能完成这一笔。
    await pulse(17000);await evaluate(`km.view.stocks[0].priceCents=1320;
      km.view.ticks.push({stockId:1,priceCents:1320,createdAt:new Date(clock).toISOString()});km.resolveBalance();`);
    await drive(`Number(document.querySelector('[aria-label="模型甲 交易数量"]')?.value)<${quantity}`,'refresh only the older market and reduce quantity');
    await evaluate('km.deferBalance=false;km.resolveBalance();');
    await drive(done,'new market priced before old lot sale');
    assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate('km.calls[0].action'),'sell');assert.equal(await evaluate('km.calls[0].shares'),9);
    assert.ok(await evaluate(`km.calls[0].shares<${quantity}`),'不能按17秒前低价发送超出网站净额限额的股数');
    assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate(`${ledger}.pending`),null);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.equal(events.find(e=>e.type==='stock-submit').data.shares,9);
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),115);assert.equal(await evaluate(`${ledger}.entries[0].releasedCost`),90);
  });
  await t.test('股市快慢快照：行情迟到时刷新旧余额，按真实账户状态卖出旧仓',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;km.deferRead=true;`);
    await until(()=>evaluate(`typeof km.resolveRead==='function'`),'initial slow market');
    await pulse(17000);await evaluate('km.tokens=500;km.deferRead=false;km.resolveRead();');
    await drive(done,'fresh balance before old lot sale');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.tokens'),617);
    assert.equal(await evaluate('km.calls[0].action'),'sell');assert.equal(await evaluate(`${ledger}.pending`),null);
    const frames=stockSnapshotsFromLog({events:await evaluate(observationEvents)});
    assert.equal(frames[0].sourceAccount.balanceTokens,500);
  });
  await t.test('股市快慢快照：补读旧行情时暂停，迟到资料不能恢复卖出',async()=>{
    await setupStock(settings+owned+`km.deferBalance=true;`);
    await until(()=>evaluate(`typeof km.resolveBalance==='function'`),'balance delayed after market');
    await pulse(17000);await evaluate('km.deferRead=true;km.deferBalance=false;km.resolveBalance();');
    await until(()=>evaluate(`typeof km.resolveRead==='function'`),'supplemental market held');
    await evaluate(`${panel}.getElementById('stock-pause').click();km.deferRead=false;km.resolveRead();`);
    await drive(done,'pause honors delayed supplemental read');assert.deepEqual(await evaluate('km.calls'),[]);
    assert.equal((await evaluate(observationEvents)).length,0,'discarded read generation cannot become an observation');
  });
  await t.test('股市慢请求修复：读取超时仅重读，流动性变化后重新计量，暂停时不继续卖出',async()=>{
    for(const pause of [false,true]){
      await setupStock(settings+owned+saleOnce+`km.deferRead=true;`);await until(()=>evaluate(`typeof km.resolveRead==='function'`),'initial read held');
      await pulse(31000);await pulse(1000);assert.equal(await evaluate('location.pathname'),'/stock');
      assert.deepEqual(await evaluate('km.calls'),[]);
      await evaluate(`km.deferRead=false;km.tokens=500;km.view.rules.reserveTokens=50;${pause?`${panel}.getElementById('stock-pause').click();`:''}km.resolveRead();`);
      await drive(done,'recover read or honor pause');
      assert.equal(await evaluate('km.calls.length'),pause?0:1);
      if(!pause){assert.equal(await evaluate('km.calls[0].shares'),4);assert.equal(await evaluate('km.tokens'),546);}
    }
  });
  await t.test('股市慢请求修复：原卖出回执丢失后只读失败，不新建卖单或重复计收入',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;km.mode='lost';`);await drive('km.calls.length===1','executed sale lost response');
    const key=await evaluate('km.calls[0].idempotencyKey'),tokens=await evaluate('km.tokens');
    await evaluate('km.readErrorsLeft=1;');await drive(done,'reconcile after transient read failure');
    assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(key)})`));
    assert.equal(await evaluate('km.tokens'),tokens);assert.equal(await evaluate(`${ledger}.pending?.key`),key);
    await pulse(121000); // 原请求第二次核对按既有两分钟退避，不因读取恢复绕过。
    await evaluate(`km.mode='success';${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'original request revisit');await drive(done,'confirm original only');
    assert.equal(await evaluate(`${ledger}.pending`),null);assert.equal(await evaluate('km.tokens'),tokens);
    assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(key)})`));
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);
  });
  const delayedActionButton=action=>`
    km.actionReady=false;const renderAction=window.renderStock;window.renderStock=()=>{
      renderAction();if(!km.actionReady)[...document.querySelectorAll('button')]
        .filter(b=>b.textContent.startsWith('${{buy:'买 ',sell:'卖 ',predict:'涨 '}[action]}')).forEach(b=>b.disabled=true);
    };renderStock();`;
  for(const action of ['buy','sell','predict'])await t.test('股市按钮就绪：'+action+(action==='sell'?'数量已填写但按钮迟到，等待后只提交一次':'即使原生按钮恢复也不新增自动交易'),async()=>{
    await setupStock((action==='predict'?prediction:settings)+(action==='sell'?owned:'')+delayedActionButton(action));
    if(action!=='sell'){
      await drive(done,'new exposure denied before waiting for native controls');
      assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending`),null);
      await reloadStock(`km.actionReady=true;`);await drive(done,'ready native controls cannot reopen exposure');
      assert.equal(await evaluate('km.calls.length'),0);assert.deepEqual(await evaluate(`${ledger}.entries`),[]);return;
    }
    await drive(`${panel}.getElementById('status').textContent.includes('等待模型甲的原生交易控件')`,action+' awaits native action readiness',35);
    await pulse(5000);assert.equal(await evaluate('location.pathname'),'/stock');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending`),null);
    await evaluate('km.actionReady=true;renderStock();');await drive(done,action+' completes after native button becomes ready');
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),[action]);assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.entries.filter(e=>e.action==='${action}'&&e.result==='success').length`),1);
    await reloadStock();for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('股市按钮就绪：持续不可用保持同一30秒期限，不下单并让出页面',async()=>{
    await setupStock(settings+owned+delayedActionButton('sell'));
    await drive(`${panel}.getElementById('status').textContent.includes('等待模型甲的原生交易控件')`,'native button wait begins',35);
    for(let i=0;i<6;i++)await pulse(4000);
    assert.equal(await evaluate('location.pathname'),'/stock');assert.equal(await evaluate('km.calls.length'),0);
    await pulse(7000);await drive(done,'native button timeout yields',12);
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending`),null);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.equal(events.filter(e=>e.type==='stock-ui-wait').length,1,'re-reading does not restart the UI deadline');
    const check=events.findLast(e=>e.type==='stock-check');
    assert.equal(check.data.ui.phase,'button');assert.ok(check.data.ui.waitingMs>=30000&&check.data.ui.waitingMs<40000);
  });
  await t.test('股市按钮就绪：输入框先到按钮后到，共用原等待期限而不重新计时',async()=>{
    await setupStock(settings+owned+delayedActionButton('sell')+`
      km.inputMissing=true;const renderInputs=window.renderStock;window.renderStock=()=>{
        renderInputs();if(km.inputMissing)document.querySelector('[aria-label="模型甲 交易数量"]')?.remove();
      };renderStock();`);
    await drive(`${panel}.getElementById('status').textContent.includes('等待模型甲的原生交易控件')`,'missing input begins common wait');
    await pulse(20000);assert.equal(await evaluate('location.pathname'),'/stock');
    await evaluate('km.inputMissing=false;renderStock();');
    for(let i=0;i<5;i++)await pulse(1000);
    assert.equal(await evaluate('location.pathname'),'/stock');
    await pulse(7000);await drive(done,'button uses original missing-input deadline',12);
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending`),null);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.equal(events.filter(e=>e.type==='stock-ui-wait').length,1);
    const ui=events.findLast(e=>e.type==='stock-check').data.ui;
    assert.equal(ui.phase,'button');assert.ok(ui.waitingMs>=30000&&ui.waitingMs<40000);
  });
  await t.test('股市按钮期限：31秒恢复可用后重读并完成旧仓卖出，刷新不重发',async()=>{
    await setupStock(settings+owned+delayedActionButton('sell'));
    await drive(`${panel}.getElementById('status').textContent.includes('等待模型甲的原生交易控件')`,'original button wait before suspension',35);
    const reads=await evaluate('km.reads');
    await evaluate('clock+=31000;km.actionReady=true;renderStock();window.dispatchEvent(new Event("focus"));');
    await drive(done,'recovered button completes currently valid sale',25);
    assert.ok(await evaluate(`km.reads>${reads}`),'恢复后必须重新核对行情');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.calls[0].action'),'sell');
    assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.entries.at(-1).result`),'success');
    await reloadStock();await drive(done,'confirmed sale is not repeated after reload');
    assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('股市按钮期限：超过45秒才恢复仍让出页面，不无限延长访问',async()=>{
    await setupStock(settings+owned+delayedActionButton('sell'));
    await drive(`${panel}.getElementById('status').textContent.includes('等待模型甲的原生交易控件')`,'button wait before hard limit',35);
    await evaluate('clock+=46000;km.actionReady=true;renderStock();window.dispatchEvent(new Event("focus"));');
    await drive(done,'absolute native UI limit still yields',20);
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.match(await evaluate(`${ledger}.note`),/45秒期限/);
  });
  await t.test('股市加载修复：迟到输入填写跨过30秒后仍完成卖出，原生控件不被强制启用',async()=>{
    await setupStock(settings+owned+delayedPage);
    await drive(`${panel}.getElementById('status').textContent.includes('等待模型甲的原生交易控件')`,'delayed native input');
    await evaluate('clock+=28000;km.pageReady=true;renderStock();');
    await drive(done,'late quantity and button complete within visit',25);
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.calls[0].action'),'sell');
    assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.entries.at(-1).result`),'success');
  });
  for(const change of ['liquidity','quote','pause','manual','original'])await t.test('股市按钮保护：等待中'+change+'变化，按钮恢复也不发送过时卖出',async()=>{
    await setupStock(settings+owned+delayedActionButton('sell'));
    await drive(`${panel}.getElementById('status').textContent.includes('等待模型甲的原生交易控件')`,'wait before '+change,35);
    if(change==='liquidity')await evaluate(`km.view.rules.reserveTokens=0;`);
    if(change==='quote')await evaluate(`km.view.stocks[0].suspended=true;`);
    if(change==='pause')await evaluate(`${panel}.getElementById('toggle').click();`);
    if(change==='original')await evaluate(`sessionStorage.setItem('stock:request:77',JSON.stringify({
      idempotencyKey:'manual-original-key',input:{action:'buy',modelName:'模型甲',shares:1,expectedUserId:77}}));`);
    if(change==='manual'){
      await evaluate(`document.querySelector('[aria-label="模型甲 交易数量"]').focus();`);await trustedStaffKey();
    }
    await evaluate('km.actionReady=true;renderStock();');for(let i=0;i<15;i++)await pulse();
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending`),null);
    if(change==='original')assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('stock:request:77')).idempotencyKey`),'manual-original-key');
    if(change==='liquidity'||change==='quote')assert.equal(await evaluate('location.pathname'),'/activities/expedition');
  });
  await t.test('股市加载修复：行情先返回时等待原生页面，控件出现后只卖出一次旧仓',async()=>{
    await setupStock(settings+owned+delayedPage);await until(()=>evaluate('km.reads>0'),'market read before page');
    await pulse(5000);assert.equal(await evaluate('location.pathname'),'/stock');assert.deepEqual(await evaluate('km.calls'),[]);
    await evaluate('km.pageReady=true;renderStock();');await drive(done,'late native page sells old lot');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate('km.calls[0].action'),'sell');
  });
  await t.test('股市加载修复：持续未加载有界退出，诊断保留候选及控件数量',async()=>{
    await setupStock(settings+owned+delayedPage);await until(()=>evaluate('km.reads>0'),'market available without UI');
    await pulse(1000);await pulse(31000);await drive(done,'UI deadline yields');assert.deepEqual(await evaluate('km.calls'),[]);
    assert.match(await evaluate(`${ledger}.note`),/页面.*加载/);
    const check=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-check').at(-1)`);
    assert.equal(check.data.ui.model,'模型甲');assert.equal(check.data.ui.matches,0);assert.equal(check.data.ui.tradeInputs,0);
  });
  await t.test('运行修复浏览器：零成交量仍记录有效上涨，旧仓正常退出且不重新买入',async()=>{
    await setupStock(settings+owned+`km.view.stocks[0].volume24h=0;`);
    await drive(done,'zero volume stock evaluated');assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate('km.calls[0].action'),'sell');assert.equal(await evaluate(`${ledger}.pending`),null);
    await evaluate(`${panel}.getElementById('stock-check').click();`);await drive(`location.pathname==='/stock'`,'stock refresh visit');
    await drive(done,'owned zero volume stock not bought again');assert.equal(await evaluate('km.calls.length'),1);
    const check=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-check').at(-1)`);
    assert.equal(check.data.market.zeroVolume,1);assert.equal(check.data.market.up,1);
  });
  await t.test('运行修复浏览器：没有达到含费门槛时显示行情筛选统计并保持不交易',async()=>{
    await setupStock(settings+`km.view.stocks[0].volume24h=0;km.view.stocks[0].priceCents=1040;
      km.view.ticks.forEach((t,i)=>{t.priceCents=1000+8*i;});`);
    await drive(done,'market explains why no buy');assert.deepEqual(await evaluate('km.calls'),[]);
    assert.match(await evaluate(`${ledger}.note`),/新买入.*验证/);
    const check=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-check').at(-1)`);
    assert.equal(check.data.market.buySignals,0);assert.equal(check.data.market.total,1);
  });
  await t.test('股市结算重复记录：同一下注编号返回已结算与未结算两条时，不能取第一条宣布完成',async()=>{
    await setupStock(oldPrediction);await drive(done,'historical prediction before conflicting settlement rows');
    await evaluate(`km.originalBet=structuredClone(km.view.myBets[0]);
      km.view.myBets=[{...km.originalBet,settled:true,payoutTokens:180},km.originalBet];
      ${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'ambiguous settlement read');await drive(done,'keep conflicting bet unresolved');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement`),undefined,'重复编号不构成唯一结算凭据');
    assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-prediction-settled').length`),0);
    await evaluate(`km.view.myBets=[{...km.originalBet,settled:true,payoutTokens:180}];${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'unique settlement restored');await drive(done,'settle once after list recovers');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement.payout`),180);
    await reloadStock();await drive(done,'confirmed settlement after reload');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.entries[0].debit`),100);
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-prediction-settled').length`),1);
  });
  await t.test('股市结算重复记录历史：七天前未决下注遇到冲突仍跨刷新保留，唯一结算后才按原规则清理',async()=>{
    await setupStock(`${prediction}km.view.rounds=[];
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'旧预测等待结算',hold:false,owned:{},pending:null,
        entries:[{id:'old-unsettled',action:'predict',roundId:77,betId:8,at:clock-8*86400000,debit:100,result:'success'}]}));
      km.view.myBets=[{id:8,roundId:77,betTokens:100,settled:true,payoutTokens:180},{id:8,roundId:77,betTokens:100,settled:false}];`);
    await drive(done,'old ambiguous settlement retained');
    assert.equal(await evaluate(`${ledger}.entries.length`),1);assert.equal(await evaluate(`${ledger}.entries[0].settlement`),undefined);
    await reloadStock();await drive(done,'old ambiguous settlement after reload');
    assert.equal(await evaluate(`${ledger}.entries.length`),1);assert.equal(await evaluate(`${ledger}.entries[0].settlement`),undefined);
    await evaluate(`km.view.myBets=km.view.myBets.slice(0,1);${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'old settlement becomes unique');await drive(done,'old unique settlement saved');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement.payout`),180);
    await evaluate(`${panel}.getElementById('stock-check').click();`);await drive(`location.pathname==='/stock'`,'cleanup after proven settlement');await drive(done,'old terminal entry may expire');
    assert.deepEqual(await evaluate(`${ledger}.entries`),[]);assert.deepEqual(await evaluate('km.calls'),[]);
  });
  await t.test('股市下注重复编号：成功回执后的首次绑定不能跳过同编号另一方向或字符串别名，恢复后只确认原单',async()=>{
    for(const duplicate of [`{...km.originalBet,direction:'down'}`,`{...km.originalBet,id:String(km.originalBet.id)}`]){
      await setupStock(`${oldPrediction}km.hideBets=true;`);await drive(done,'historical prediction awaiting bet identity');
      await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'original prediction receipt');
      const original=await evaluate(`${ledger}.pending`);
      await evaluate(`km.originalBet=structuredClone(km.view.myBets[0]);km.view.myBets=[${duplicate},km.originalBet];km.hideBets=false;`);
      await pulse(6000);await pulse(31000);await drive(done,'ambiguous first binding yields to expedition');
      assert.equal(await evaluate(`${ledger}.pending?.id`),original.id);
      assert.equal(await evaluate(`${ledger}.entries[0].betId`),undefined);assert.equal(await evaluate('km.calls.length'),0);
      await evaluate(`km.view.myBets=[km.originalBet];${panel}.getElementById('stock-check').click();`);
      await drive(`${ledger}.pending===null`,'original prediction bound after unique identity');await drive(done,'original prediction complete');
      assert.equal(await evaluate(`${ledger}.entries[0].betId`),1);assert.equal(await evaluate('km.calls.length'),0);
      assert.equal(await evaluate(`${ledger}.entries[0].debit`),100);
    }
  });
  await t.test('股市结算重复记录别名：数值与字符串同编号不选首条，恢复唯一后仍接受零返还结算',async()=>{
    await setupStock(oldPrediction);await drive(done,'historical prediction before aliased settlement');
    await evaluate(`km.originalBet=structuredClone(km.view.myBets[0]);km.view.myBets=[{...km.originalBet,settled:true,payoutTokens:0},
      {...km.originalBet,id:String(km.originalBet.id),settled:true,payoutTokens:180}];${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'aliased settlement rows');await drive(done,'aliased settlement waits');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement`),undefined);
    await evaluate(`km.view.myBets=km.view.myBets.slice(0,1);${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'unique zero payout');await drive(done,'zero payout remains valid');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement.payout`),0);assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市结算重复记录隔离：单笔冲突不阻塞其他唯一结算或旧仓卖出，也不返还原下注额度',async()=>{
    await setupStock(oldPrediction+`km.saleReceipt=true;km.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];
      const oldLedger=${ledger};oldLedger.owned={'1':{shares:10,cost:100,modelName:'模型甲',manual:false}};
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(oldLedger));`);
    await drive(done,'historical prediction and pre-existing lot before partial settlement conflict');
    await evaluate(`km.originalBet=structuredClone(km.view.myBets[0]);km.view.myBets=[{...km.originalBet,settled:true,payoutTokens:180},km.originalBet,
      {id:99,roundId:99,betTokens:100,settled:true,payoutTokens:0}];km.view.rounds=[];
      const l=${ledger};l.entries.push({id:'other-prediction',action:'predict',roundId:99,betId:99,at:clock,debit:100,result:'success'});
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},predict:true}));${panel}.getElementById('stock-check').click();`);
    await drive('km.calls.some(c=>c.action===\'sell\')','old lot exits alongside unresolved settlement');await drive(done,'other settlement and sale complete');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement`),undefined);
    assert.equal(await evaluate(`${ledger}.entries.find(e=>e.id==='other-prediction').settlement.payout`),0);
    assert.equal(await evaluate(`${ledger}.entries.filter(e=>e.action==='predict').reduce((n,e)=>n+e.debit,0)`),200);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell']);
    assert.equal(await evaluate(`${ledger}.entries.find(e=>e.action==='sell').proceeds`),117);
    assert.equal(await evaluate(`${ledger}.entries.find(e=>e.action==='sell').releasedCost`),100);
  });
  // Delay only the notification; both tabs still read/write the same real localStorage.
  const delayedStorage=`window.delayedStockEvents=[];window.delayStockEvents=true;
    window.addEventListener('storage',e=>{if(window.delayStockEvents&&['arkengine:auto-stock:ledger:v1','arkengine:auto-stock:config:v1'].includes(e.key)){
      window.delayedStockEvents.push({key:e.key,oldValue:e.oldValue,newValue:e.newValue,url:e.url});e.stopImmediatePropagation();}},true);
    window.flushStockEvents=()=>{window.delayStockEvents=false;for(const e of window.delayedStockEvents.splice(0))
      window.dispatchEvent(new StorageEvent('storage',{...e,storageArea:localStorage}));};`;
  const deferredRead=`const stockFetch=window.fetch;let stockReadReleased=false;
    window.fetch=(u,o)=>!stockReadReleased&&u==='/api/stock'&&o?.method!=='POST'?
    new Promise((resolve,reject)=>{
      window.rejectStockRead=()=>{stockReadReleased=true;reject(new TypeError('fixture delayed read failure'));};
      window.resolveStockRead=()=>{stockReadReleased=true;resolve(stockFetch(u,o));};
    }):stockFetch(u,o);`;
  await t.test('股市原卖出净额：原请求未执行后股价下降或手续费上涨至零回收，不继续确认卖出',async()=>{
    for(const [seed,change] of [[``,`km.view.stocks[0].priceCents=1`],
      [`km.view.stocks[0].priceCents=11;`,`km.view.rules.sellFeePct=10.1`],
      [`km.view.rules.maxTradeTokens=60;`,`km.view.stocks[0].priceCents=20`]]){
      await setupStock(`${settings}${owned}${seed}km.mode='deferred';`);
      await drive('km.calls.length===1','original sell before zero proceeds');
      const original=await evaluate(`${ledger}.pending`),tokens=await evaluate('km.tokens');
      await evaluate(`${change};km.mode='success';${panel}.getElementById('stock-check').click();`);
      await pulse(31000);await drive(done,'zero original sell waits');
      assert.equal(await evaluate('km.calls.length'),1,change);assert.equal(await evaluate('km.tokens'),tokens);
      assert.equal(await evaluate('km.view.positions[0].shares'),10);
      assert.equal(await evaluate(`${ledger}.pending.id`),original.id);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    }
  });
  await t.test('股市原卖出恢复：部分卖出零到账等待跨刷新保留，恢复一代币时仍按原股数和原键核对',async()=>{
    await setupStock(`${settings}${owned}km.view.rules.maxTradeTokens=60;km.mode='deferred';`);
    await drive('km.calls.length===1','original partial sell deferred');const original=await evaluate(`${ledger}.pending`);
    assert.equal(original.input.shares,5);
    await evaluate(`km.view.stocks[0].priceCents=20;km.mode='success';${panel}.getElementById('stock-check').click();`);
    await drive(done,'partial zero proceeds wait');await reloadStock();await drive(done,'partial sell wait survives reload');
    assert.match(await evaluate(`${ledger}.note`),/净到账为0/);assert.equal(await evaluate(`${ledger}.hold`),false);
    assert.equal(await evaluate(`${ledger}.pending.retries`),0);assert.deepEqual(await evaluate(`${ledger}.pending.input`),original.input);
    assert.equal(await evaluate('km.calls.length'),1);
    await evaluate(`km.view.stocks[0].priceCents=21;km.view.rules.maxTradeTokens=10000;`);
    await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));await drive(`${ledger}.pending===null`,'one token resumes original partial sale');
    assert.equal(await evaluate('km.calls.length'),2);assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(original.key)}&&c.shares===5)`));
    assert.equal(await evaluate('km.tokens'),10001);assert.equal(await evaluate('km.view.positions[0].shares'),5);
    assert.equal(await evaluate(`${ledger}.entries.length`),1);assert.equal(await evaluate(`${ledger}.entries[0].id`),original.id);
  });
  await t.test('股市原卖出排队：确认按钮随机等待期间报价变为零到账，重读后撤销续发',async()=>{
    await setupStock(`${settings}${owned}km.view.rules.maxTradeTokens=60;km.mode='deferred';`);
    await drive('km.calls.length===1','original sell before queued quote change');await pulse(31000);
    await drive(`${panel}.getElementById('status').textContent.includes('核对同一笔股市原交易')`,'original sell confirmation queued');
    await evaluate(`km.view.stocks[0].priceCents=20;km.mode='success';`);await drive(done,'queued sell quote rechecked');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    assert.match(await evaluate(`${ledger}.note`),/净到账为0/);assert.equal(await evaluate('km.view.positions[0].shares'),10);
  });
  await t.test('股市原卖出报价缺失：模型缺失、改名或停牌时不续发原卖出',async()=>{
    for(const change of [`km.view.stocks=[]`,`km.view.stocks[0].modelName='模型乙'`,
      `km.view.stocks[0].suspended=true`]){
      await setupStock(`${settings}${owned}km.mode='deferred';`);await drive('km.calls.length===1','original sell before quote unavailable');
      const original=await evaluate(`${ledger}.pending`);
      await evaluate(`${change};km.mode='success';${panel}.getElementById('stock-check').click();`);await drive(done,'unavailable sell quote waits');
      assert.equal(await evaluate('km.calls.length'),1,change);assert.equal(await evaluate(`${ledger}.pending.id`),original.id);
      assert.equal(await evaluate(`${ledger}.pending.retries`),0);assert.match(await evaluate(`${ledger}.note`),/报价无法核对/);
    }
  });
  await t.test('股市原卖出正净额：价格和手续费变化但仍到账一代币时确认，降低买入额度不阻止卖出',async()=>{
    await setupStock(`${settings}${owned}km.mode='deferred';`);await drive('km.calls.length===1','original sell before positive fee change');
    const original=await evaluate(`${ledger}.pending`);
    await evaluate(`km.view.stocks[0].priceCents=11;km.view.rules.sellFeePct=9.9999;km.mode='success';
      ${panel}.getElementById('stock-trade-limit').value='0';${panel}.getElementById('stock-reserve').value='10000';
      ${panel}.getElementById('stock-save').click();`);
    await pulse(31000);await drive(`${ledger}.pending===null`,'positive original sale still allowed');
    assert.equal(await evaluate('km.calls.length'),2);assert.equal(await evaluate('km.tokens'),10001);
    assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(original.key)}&&c.shares===10)`));
    assert.equal(await evaluate(`${ledger}.hold`),false);
  });
  await t.test('股市原卖出停滞：重读后仍核对同一原键和股数，不新建替代卖单',async()=>{
    await setupStock(`${settings}${owned}km.mode='deferred';km.saleReceipt=true;`);
    await drive('km.calls.length===1','original sell awaits response');
    const original=await evaluate(`${ledger}.pending`);
    await evaluate(`km.view.stocks[0].stale=true;km.mode='success';${panel}.getElementById('stock-check').click();`);
    await pulse(31000);await drive(`${ledger}.pending===null && km.calls.length===2`,'same sell recovers with current stale quote');
    assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(original.key)}&&c.shares===${original.choice.shares})`));
    assert.equal(await evaluate(`${ledger}.entries.length`),1);
    assert.equal(await evaluate(`${ledger}.entries[0].id`),original.id);
    assert.equal(await evaluate('km.view.positions[0].shares'),0);
  });
  await t.test('股市原卖出迟到回执：当前报价零到账或缺失时，原成功回执仍核对且不再次卖出',async()=>{
    for(const change of [`km.view.stocks[0].priceCents=1`,`km.view.stocks=[]`]){
      await setupStock(`${settings}${owned}const originalFetch=window.fetch;
        window.fetch=(u,o)=>{const response=originalFetch(u,o);return u==='/api/stock'&&o?.method==='POST'?
          response.then(r=>new Promise(resolve=>{window.releaseStockReceipt=()=>resolve(r);})):response;};`);
      await drive('km.calls.length===1','original sale executed with held receipt');
      const original=await evaluate(`${ledger}.pending`),tokens=await evaluate('km.tokens');
      await evaluate(`${change};${panel}.getElementById('stock-check').click();`);await drive(done,'current quote blocks unknown sell');
      assert.equal(await evaluate('km.calls.length'),1);await evaluate('window.releaseStockReceipt();');
      await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'original sale success saved');
      await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));await drive(`${ledger}.pending===null`,'original successful sale reconciles');
      assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.tokens'),tokens);
      assert.equal(await evaluate(`${ledger}.entries[0].id`),original.id);assert.equal(await evaluate(`${ledger}.entries[0].result`),'success');
      assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate(`${ledger}.owned['1']`),undefined);
    }
  });
  await t.test('股市原交易外部持仓：未收到本地人工事件的买入持仓变化仍阻止原单续发',async()=>{
    await setupStock(unknownBuy);await drive(done,'historical request preserved');
    const original=await evaluate(`${ledger}.pending`),balance=await evaluate('km.tokens');
    await evaluate(`km.view.positions=[{stockId:1,shares:1,costBasisTokens:13,holdUntil:null}];
      km.mode='success';${panel}.getElementById('stock-check').click();`);
    await pulse(31000);await drive(done,'external holdings block original buy');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate('km.tokens'),balance);
    assert.equal(await evaluate(`${ledger}.pending.id`),original.id);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    assert.notEqual(await evaluate(`${ledger}.pending.manualTouched`),true);
  });
  await t.test('股市原交易外部持仓：原卖出等待时股数增加、减少或同股数成本改变均不续发',async()=>{
    for(const change of [`km.view.positions[0].shares=12`,`km.view.positions[0].shares=5`,`km.view.positions[0].costBasisTokens=101`]){
      await setupStock(`${settings}${owned}km.mode='deferred';`);await drive('km.calls.length===1','original before external sell position change');
      const original=await evaluate(`${ledger}.pending`),balance=await evaluate('km.tokens');
      await evaluate(`${change};km.mode='success';${panel}.getElementById('stock-check').click();`);
      await pulse(31000);await drive(done,'changed sell holdings wait');
      assert.equal(await evaluate('km.calls.length'),1,change);assert.equal(await evaluate('km.tokens'),balance);
      assert.equal(await evaluate(`${ledger}.pending.id`),original.id);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
      assert.notEqual(await evaluate(`${ledger}.pending.manualTouched`),true);
    }
  });
  await t.test('股市原交易外部持仓恢复：等待跨刷新保存，原状态恢复后仍按原键核对且不重复预留',async()=>{
    for(const seed of [settings+owned,settings+owned+'km.view.rules.maxTradeTokens=60;']){
      await setupStock(`${seed}km.mode='deferred';`);await drive('km.calls.length===1','original before external mismatch');
      const original=await evaluate(`${ledger}.pending`),positions=await evaluate('km.view.positions');
      await evaluate(`km.view.positions=[{stockId:1,shares:12,costBasisTokens:120,holdUntil:null}];
        km.mode='success';${panel}.getElementById('stock-check').click();`);
      await drive(done,'mismatched position waits');await reloadStock();await drive(done,'mismatch persists after reload');
      assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending.id`),original.id);
      assert.equal(await evaluate(`${ledger}.pending.retries`),0);assert.equal(await evaluate(`${ledger}.hold`),false);
      assert.match(await evaluate(`${ledger}.note`),/数量与原交易前后均不符/);
      await evaluate(`km.view.positions=${JSON.stringify(positions)};`);await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));
      await drive(`${ledger}.pending===null`,'restored position confirms original');
      assert.equal(await evaluate('km.calls.length'),2);assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(original.key)})`));
      assert.equal(await evaluate(`${ledger}.entries.length`),1);assert.equal(await evaluate(`${ledger}.entries[0].id`),original.id);
    }
  });
  await t.test('股市原交易外部排队持仓：等待确认按钮期间外部改变股数，点击前重读并停止续发',async()=>{
    for(const seed of [settings+owned,settings+owned+'km.view.rules.maxTradeTokens=60;']){
      await setupStock(`${seed}km.mode='deferred';`);await drive('km.calls.length===1','original before queued position change');
      await pulse(31000);await drive(`${panel}.getElementById('status').textContent.includes('核对同一笔股市原交易')`,'original position recovery queued');
      await evaluate(`km.view.positions=[{stockId:1,shares:12,costBasisTokens:120,holdUntil:null}];km.mode='success';`);
      await drive(done,'queued position rechecked');assert.equal(await evaluate('km.calls.length'),1);
      assert.equal(await evaluate(`${ledger}.pending.retries`),0);assert.match(await evaluate(`${ledger}.note`),/数量与原交易前后均不符/);
    }
  });
  await t.test('股市原交易原有持仓结果：全部卖出和部分卖出已执行丢回执，仍只确认原键',async()=>{
    // Unknown old buys are preserved without replay by the exit-only integration tests.
    for(const seed of [settings+owned,settings+owned+'km.view.rules.maxTradeTokens=60;']){
      await setupStock(`${seed}km.mode='lost';`);await drive('km.calls.length===1','original executed before lost receipt');
      const original=await evaluate(`${ledger}.pending`),tokens=await evaluate('km.tokens'),positions=await evaluate('km.view.positions');
      await reloadStock();await evaluate(`km.mode='success';`);await drive(`${ledger}.pending===null`,'original position result still confirms',180);
      assert.equal(await evaluate('km.calls.length'),2);assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(original.key)})`));
      assert.equal(await evaluate('km.tokens'),tokens);assert.deepEqual(await evaluate('km.view.positions'),positions);
      assert.equal(await evaluate(`${ledger}.entries[0].result`),'success');assert.equal(await evaluate(`${ledger}.hold`),false);
    }
  });
  await t.test('股市原交易外部持仓迟到回执：数量不符时保留已成功原单，数据恢复后核对且不再次提交',async()=>{
    await setupStock(unknownBuy+delayedReceipt);await manualOldBuy();
    const positions=await evaluate('km.view.positions'),tokens=await evaluate('km.tokens');
    await evaluate(`km.view.positions[0].shares+=1;${panel}.getElementById('stock-check').click();`);
    await drive(done,'external mismatch waits for receipt');assert.equal(await evaluate('km.calls.length'),1);
    await evaluate('window.releaseStockReceipt();');await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'original success stored');
    await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));await drive(`location.pathname==='/stock'`,'read changed successful position');
    await drive(done,'confirmed receipt cannot override position mismatch');
    assert.equal(await evaluate(`${ledger}.pending.result`),'success');assert.equal(await evaluate('km.calls.length'),1);
    await evaluate(`km.view.positions=${JSON.stringify(positions)};`);await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));
    await drive(`${ledger}.pending===null`,'restored data reconciles actual original');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.tokens'),tokens);
  });
  const preserveHistorical=async(seed,change,restore='')=>{
    await setupStock(seed);await drive(done,'historical request before changed evidence');
    const before=await evaluate(ledger),native=await evaluate(`sessionStorage.getItem('stock:request:77')`);
    const settle=async()=>{
      const cfg=await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'))`);
      if(cfg.trade||cfg.predict||cfg.observeOnly)await drive(done,'historical request remains read-only');
      else await pulse(10000); // Saving the disabled prediction control can turn the whole feature off.
    };
    const check=async()=>{
      await evaluate(`${panel}.getElementById('stock-check').click();`);
      const cfg=await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'))`);
      if(cfg.trade||cfg.predict||cfg.observeOnly)await drive(`location.pathname==='/stock'`,'historical request recheck');
      await settle();
      const after=await evaluate(ledger);
      assert.equal(await evaluate('km.calls.length'),0);assert.deepEqual(after.pending,before.pending);
      assert.deepEqual(after.entries,before.entries);assert.equal(await evaluate(`sessionStorage.getItem('stock:request:77')`),native);
    };
    await evaluate(change);await check();await reloadStock();await settle();
    assert.deepEqual(await evaluate(`${ledger}.pending`),before.pending);assert.equal(await evaluate('km.calls.length'),0);
    if(restore){await evaluate(restore);await check();}
  };
  await t.test('股市原交易报价：股价或手续费超过原预留，旧买单保持原键与原预算',async()=>{
    for(const change of ['km.view.stocks[0].priceCents=2000;','km.view.rules.buyFeePct=25;'])
      await preserveHistorical(unknownBuy,change);
  });
  await t.test('股市原交易报价恢复：报价超预留后恢复，跨刷新仍不自动重发旧买单',async()=>{
    await preserveHistorical(unknownBuy,'km.view.stocks[0].priceCents=2000;','km.view.stocks[0].priceCents=1200;');
  });
  await t.test('股市原交易报价余量：涨价或手续费变化仍可负担，也不自动续发旧买单',async()=>{
    for(const change of ['km.view.stocks[0].priceCents=1201;','km.view.rules.buyFeePct=2.1;'])
      await preserveHistorical(unknownBuy,change);
  });
  await t.test('股市原交易排队报价：达到旧重试时刻后涨价，不产生自动确认队列',async()=>{
    await preserveHistorical(settings+stockHistoricalRequest({age:0}),'clock+=31000;km.view.stocks[0].priceCents=2000;');
  });
  await t.test('股市原交易报价缺失：模型消失、改名、停牌或过期不改变旧请求，也不借其他报价续发',async()=>{
    for(const change of ['km.view.stocks=[];','km.view.stocks[0].modelName="模型乙";','km.view.stocks[0].suspended=true;','km.view.stocks[0].stale=true;'])
      await preserveHistorical(unknownBuy,change);
  });
  await t.test('股市原交易报价迟到回执：当前报价超预留但原单成功回执到达，直接核对原成本不再续发',async()=>{
    await setupStock(unknownBuy+delayedReceipt);await manualOldBuy();
    const tokens=await evaluate('km.tokens'),original=await evaluate(`${ledger}.pending`);
    await evaluate(`km.view.stocks[0].priceCents=2000;${panel}.getElementById('stock-check').click();`);
    await drive(done,'high quote waits before late receipt');assert.match(await evaluate(`${ledger}.note`),/暂停/);
    await evaluate('window.releaseStockReceipt();');await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'original receipt saved');
    await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));await drive(`${ledger}.pending===null`,'late receipt confirms original cost');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.tokens'),tokens);
    assert.equal(await evaluate(`${ledger}.entries[0].id`),original.id);assert.equal(await evaluate(`${ledger}.entries[0].debit`),10000-tokens);
    assert.equal(await evaluate(`${ledger}.hold`),false);
  });
  await t.test('股市原交易余额变化：其他消费减少余额，旧买入和预测都不自动续发',async()=>{
    for(const seed of [unknownBuy,unknownPrediction])await preserveHistorical(seed,'km.tokens=150;');
  });
  await t.test('股市原交易排队余额：达到旧重试时间后余额减少，保留原请求而不创建确认队列',async()=>{
    await preserveHistorical(settings+stockHistoricalRequest({age:0}),'clock+=31000;km.tokens=150;');
  });
  await t.test('股市原交易额度：降低买入额度不清原预留，不用旧请求继续扣款',async()=>{
    await preserveHistorical(unknownBuy,
      `${panel}.getElementById('stock-trade-limit').value='0';${panel}.getElementById('stock-save').click();`);
  });
  await t.test('股市原交易额度：提高保留余额或改变单注仍保存旧请求，不自动续发',async()=>{
    for(const [seed,id,value] of [[unknownBuy,'stock-reserve','10000'],[unknownPrediction,'stock-stake','50']])
      await preserveHistorical(seed,`${panel}.getElementById('${id}').value='${value}';${panel}.getElementById('stock-save').click();`);
  });
  await t.test('股市原交易恢复：额度降低后恢复也不自动重发，跨刷新保留原键与预算',async()=>{
    await preserveHistorical(unknownBuy,`${panel}.getElementById('stock-trade-limit').value='0';${panel}.getElementById('stock-save').click();`,
      `${panel}.getElementById('stock-trade-limit').value='3000';${panel}.getElementById('stock-save').click();`);
  });
  await t.test('股市原交易额度：提高保留余额但仍可支付旧单，也不开放自动续发',async()=>{
    await preserveHistorical(unknownBuy,`${panel}.getElementById('stock-reserve').value='500';${panel}.getElementById('stock-save').click();`);
  });
  await t.test('股市原交易人工接管：另一页手动交易后保留原卖出，不自动继续发送',async()=>{
    await setupStock(`${settings}${owned}km.mode='deferred';`);await drive('km.calls.length===1','deferred original sell');
    const original=await evaluate(`${ledger}.pending`),second=await secondStock(`km.mode='success';`);
    try{
      await second.evaluate(`void stockAct('buy',{modelName:'模型甲',shares:1});`);
      await until(()=>second.evaluate('km.calls.length===1&&!km.busy'),'manual trade on other page');
      assert.equal(await evaluate(`${ledger}.pending.manualTouched`),true);
      await evaluate(`km.mode='success';`);await pulse(31000);await drive(done,'manual ownership blocks original sell retry');
      assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending.id`),original.id);
      assert.equal(await evaluate(`${ledger}.pending.retries`),0);assert.equal(await evaluate(`${ledger}.owned['1'].manual`),true);
    }finally{await second.close();}
  });
  await t.test('股市原交易额度：降低预测总额仍保留其他下注和原预留，不续发旧预测',async()=>{
    await preserveHistorical(unknownPrediction+`const l=${ledger};l.entries.unshift({id:'previous-bet',action:'predict',roundId:41,at:clock,debit:100,result:'success'});
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`,
      `${panel}.getElementById('stock-prediction-limit').value='100';${panel}.getElementById('stock-save').click();`);
    assert.equal(await evaluate(`${ledger}.entries.reduce((n,e)=>n+e.debit,0)`),200);
  });
  await t.test('股市原交易余额：丢失回执时资金恢复也不自动重发，人工确认原键不重复扣款',async()=>{
    await preserveHistorical(lostBuy,'km.tokens=100;','km.tokens=223;');
    const original=await evaluate(`${ledger}.pending`);
    await pulse(1000);
    await evaluate(`navFarm('/stock');stockAct('buy',{});`);await evaluate(`${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.pending===null`,'manual old receipt reconciles');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.calls[0].idempotencyKey'),original.key);
    assert.equal(await evaluate('km.tokens'),223);assert.equal(await evaluate(`${ledger}.entries[0].debit`),123);
  });
  await t.test('股市原交易迟到回执：余额不足续发时仍接收成功回执，到期只读核对而不再扣款',async()=>{
    await setupStock(unknownBuy+delayedReceipt);await manualOldBuy();
    const original=await evaluate(`${ledger}.pending`);await evaluate('km.tokens=100;');const tokens=await evaluate('km.tokens');
    await drive(done,'insufficient balance waits with original receipt pending');
    assert.match(await evaluate(`${ledger}.note`),/暂停/);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    await evaluate('window.releaseStockReceipt();');
    await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'late bound receipt saved');
    await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));await drive(`${ledger}.pending===null`,'late receipt reconciles without funds to resubmit');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.tokens'),tokens);
    assert.equal(await evaluate(`${ledger}.entries[0].id`),original.id);assert.equal(await evaluate(`${ledger}.hold`),false);
  });
  await t.test('股市原交易旧记录：缺少原保留线仍禁止自动续发，手动确认仍可观察原结果',async()=>{
    await setupStock(unknownBuy);await drive(done,'historical request preserved');
    await evaluate(`const old=${ledger};delete old.pending.reserveFloor;localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(old));
      ${panel}.getElementById('stock-reserve').value='10000';${panel}.getElementById('stock-save').click();km.mode='success';`);
    await reloadStock();await drive(done,'legacy original cannot prove previous reserve');
    assert.match(await evaluate(`${ledger}.note`),/暂停/);
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending.reserveFloor`),undefined);
    const key=await evaluate(`${ledger}.pending.key`);
    await evaluate(`void stockAct('buy',{modelName:'ignored',shares:1});`);
    await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'manual original receipt observed');
    await evaluate(`${panel}.getElementById('stock-check').click();`);await drive(`${ledger}.pending===null`,'manual receipt reconciled');
    assert.equal(await evaluate('km.calls.length'),1);assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(key)})`));
  });
  await t.test('股市原交易校验：损坏的原保留线保留原文且不续发',async()=>{
    for(const value of [-1,1.5,'100',null,1000000000001]){
      await setupStock(unknownBuy);await drive(done,'historical request preserved');
      const raw=await evaluate(`(()=>{const l=${ledger};l.pending.reserveFloor=${JSON.stringify(value)};
        const raw=JSON.stringify(l);localStorage.setItem('arkengine:auto-stock:ledger:v1',raw);return raw;})()`);
      await reloadStock();await pulse(31000);await drive(done,'corrupt snapshot stops stock');
      assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),raw);
    }
  });
  await t.test('股市跨页同步：读取失败时保留别页已交回人工的持仓，不用旧快照覆盖',async()=>{
    await setupStock(`${settings}${owned}${delayedStorage}${deferredRead}`);
    await until(()=>evaluate(`typeof rejectStockRead==='function'`),'first tab read pending');
    const second=await secondStock();
    try{
      await second.evaluate(`void stockAct('buy',{modelName:'模型甲',shares:1});`);
      await until(()=>second.evaluate('km.calls.length===1&&!km.busy'),'other tab manual trade');
      assert.equal(await evaluate(`${ledger}.owned['1'].manual`),true);
      await evaluate('rejectStockRead();');await drive(done,'failed read yields without undoing manual ownership');
      assert.equal(await evaluate(`${ledger}.owned['1'].manual`),true);
      assert.deepEqual(await evaluate('km.calls'),[]);
      await evaluate('flushStockEvents();');await reloadStock();await drive(done,'manual ownership persists on reload');
      assert.equal(await evaluate(`${ledger}.owned['1'].manual`),true);assert.deepEqual(await evaluate('km.calls'),[]);
    }finally{await second.close();}
  });
  await t.test('股市跨页同步：读取失败期间别页账本损坏时保留原文，不覆盖为缓存副本',async()=>{
    await setupStock(`${settings}${delayedStorage}${deferredRead}`);
    await until(()=>evaluate(`typeof rejectStockRead==='function'`),'read pending before corrupt update');
    const second=await secondStock();
    try{
      await second.evaluate(`localStorage.setItem('arkengine:auto-stock:ledger:v1','{unreadable-ledger');`);
      await evaluate('rejectStockRead();');await drive(done,'corrupt shared ledger preserves original');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),'{unreadable-ledger');
      assert.deepEqual(await evaluate('km.calls'),[]);
    }finally{await second.close();}
  });
  await t.test('股市跨页同步：读取成功迟到时先核对别页预算，重新读取后保留最新支出',async()=>{
    await setupStock(`${settings}${delayedStorage}${deferredRead}`);
    await until(()=>evaluate(`typeof resolveStockRead==='function'`),'read pending before budget update');
    const second=await secondStock();
    try{
      await second.evaluate(`localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,
        note:'other tab spent budget',hold:false,owned:{},pending:null,
        entries:[{id:'other-tab-buy',action:'buy',stockId:99,at:clock,debit:3000,result:'success'}]}));`);
      await evaluate('resolveStockRead();');await drive(done,'late read respects latest shared budget');
      assert.deepEqual(await evaluate('km.calls'),[]);
      assert.deepEqual(await evaluate(`${ledger}.entries.map(e=>e.id)`),['other-tab-buy']);
      assert.equal(await evaluate(`${ledger}.pending`),null);
      assert.equal(await evaluate(`${ledger}.hold`),false);
      assert.ok(await evaluate('km.reads>=2'),'stale read must be replaced before evaluating trades');
      assert.doesNotMatch(await evaluate(`${panel}.getElementById('stock-status').textContent`),/异常|无法保存/);
    }finally{await second.close();}
  });
  await t.test('股市跨页同步：通知延迟时保存设置或立即检查仍保留另一页的原请求及预算',async()=>{
    for(const control of ['stock-save','stock-check']){
      await setupStock(`${settings}${owned}km.deferRead=true;km.mode='unknown';`);
      await until(()=>evaluate(`typeof km.resolveRead==='function'`),'deferred initial read');
      const second=await secondStock(delayedStorage);
      try{
        await evaluate('km.deferRead=false;km.resolveRead();');await drive('km.calls.length===1','owner submitted original');
        const original=await evaluate(`${ledger}.pending`),entries=await evaluate(`${ledger}.entries`);
        assert.ok(original?.key);
        await second.evaluate(`${panel}.getElementById('${control}').click();`);
        assert.equal(await evaluate(`${ledger}.pending?.id`),original.id,control);
        assert.deepEqual(await evaluate(`${ledger}.entries`),entries,control);
        assert.equal(await evaluate('km.calls.length'),1);assert.deepEqual(await second.evaluate('km.calls'),[]);
      }finally{await second.close();}
    }
  });
  await t.test('股市跨页同步：排队操作前重新尊重别页人工归属或关闭开关，不留下多余原请求',async()=>{
    for(const action of ['manual','pause']){
      await setupStock(`${settings}${owned}${delayedStorage}`);
      await drive(`${panel}.getElementById('status').textContent.includes('秒后卖出')`,'sale queued');
      const second=await secondStock();
      try{
        if(action==='manual'){
          await second.evaluate(`void stockAct('buy',{modelName:'模型甲',shares:1});`);
          await until(()=>second.evaluate('km.calls.length===1&&!km.busy'),'other tab takes ownership');
        }else await second.evaluate(`${panel}.getElementById('stock-trade').checked=false;${panel}.getElementById('stock-save').click();`);
        await drive(done,'queued trade cancelled by other tab');
        assert.deepEqual(await evaluate('km.calls'),[],action);assert.equal(await evaluate(`${ledger}.pending`),null,action);
        assert.deepEqual(await evaluate(`${ledger}.entries`),[],action);
        if(action==='manual')assert.equal(await evaluate(`${ledger}.owned['1'].manual`),true);
      }finally{await second.close();}
    }
  });
  await t.test('股市跨页同步：提交前共享账本更新时撤销旧写入，保留最新支出并按预约重新卖出',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;`);
    await drive(`${panel}.getElementById('status').textContent.includes('秒后卖出')`,'sale queued before latest journal write');
    // Reads/diagnostics also allocate UUIDs. Inject only after the queued action
    // has entered execution, immediately before its new request is persisted.
    await evaluate(`const uuid=crypto.randomUUID.bind(crypto);km.injected=false;
      crypto.randomUUID=()=>{if(!km.injected&&${panel}.getElementById('status').textContent==='卖出 模型甲'){
        km.injected=true;const current=${ledger};
        current.entries.push({id:'latest-budget',action:'buy',stockId:99,at:clock,debit:3000,result:'success'});
        localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(current));}return uuid();};`);
    await drive(done,'late journal change cancels stale submission');
    assert.equal(await evaluate('km.injected'),true);
    assert.deepEqual(await evaluate('km.calls'),[]);
    assert.deepEqual(await evaluate(`${ledger}.entries.map(e=>e.id)`),['latest-budget']);
    assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.hold`),false);
    assert.ok(await evaluate(`${ledger}.nextAt>clock`),'readable conflict must schedule another check');
    assert.doesNotMatch(await evaluate(`${panel}.getElementById('stock-status').textContent`),/检查异常|无法保存/);
    const originalSpend=await evaluate(`${ledger}.entries[0]`);
    await pulse(300001);
    await drive('km.calls.length===1','fresh journal permits automatic old-lot revisit');
    await drive(`${ledger}.pending===null`,'resumed sale reconciled');
    assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate('km.calls[0].action'),'sell');
    assert.deepEqual(await evaluate(`${ledger}.entries[0]`),originalSpend);
    assert.equal(await evaluate(`${ledger}.entries.length`),2);
    assert.equal(await evaluate(`${ledger}.entries[1].proceeds`),117);
  });
  await t.test('股市发送瞬间：总暂停通知尚未到达时仍阻止买入、卖出和预测',async()=>{
    for(const seed of [settings,`${settings}${owned}`,prediction]){
      await setupStock(`${seed}window.stockTransport=(u,o)=>{
        km.intercepted=true;km.originalPending=${ledger}.pending;
        localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');return fetch(u,o);};`);
      if(seed!==`${settings}${owned}`){
        await drive(done,'new exposure denied before native handler');
        assert.equal(await evaluate('Boolean(km.intercepted)'),false);
        assert.deepEqual(await evaluate('km.calls'),[]);
        assert.equal(await evaluate(`${ledger}.pending`),null);continue;
      }
      await drive('km.intercepted','pause immediately before native send');await pulse(1000);
      assert.deepEqual(await evaluate('km.calls'),[]);
      assert.equal(await evaluate(`${ledger}.pending.id`),await evaluate('km.originalPending.id'));
      assert.equal(await evaluate(`${ledger}.pending.key`),null);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
      assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/绑定失败/);
    }
  });
  await t.test('股市发送瞬间：原生卖出按钮触发后关闭交易或改为观察，不继续发送旧操作',async()=>{
    for(const change of ['c.trade=false','c.observeOnly=true']){
      const seed=settings+owned;
      await setupStock(`${seed}window.stockTransport=(u,o)=>{
        km.intercepted=true;const c=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));${change};
        km.changedConfig=JSON.stringify(c);localStorage.setItem('arkengine:auto-stock:config:v1',km.changedConfig);
        km.reservedLedger=localStorage.getItem('arkengine:auto-stock:ledger:v1');return fetch(u,o);};`);
      await drive('km.intercepted','settings changed at native send');await pulse(1000);
      assert.deepEqual(await evaluate('km.calls'),[],change);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:config:v1')`),await evaluate('km.changedConfig'));
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),await evaluate('km.reservedLedger'));
      assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/绑定失败/);
    }
  });
  await t.test('股市发送瞬间：新支出或人工持仓归属更新时撤销旧操作，保留最新账本',async()=>{
    for(const [seed,change] of [[`${settings}${owned}`,`l.entries.push({id:'boundary-spend',action:'buy',at:clock,debit:3000,result:'success'})`],
      [`${settings}${owned}`,`l.owned['1'].manual=true;l.pending.manualTouched=true`]]){
      await setupStock(`${seed}window.stockTransport=(u,o)=>{
        km.intercepted=true;const l=${ledger};${change};km.changedLedger=JSON.stringify(l);
        localStorage.setItem('arkengine:auto-stock:ledger:v1',km.changedLedger);return fetch(u,o);};`);
      await drive('km.intercepted','ledger changed at native send');await pulse(1000);
      assert.deepEqual(await evaluate('km.calls'),[]);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),await evaluate('km.changedLedger'));
      assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/绑定失败/);
      await reloadStock();await drive(done,'unbound intent remains after reload');
      assert.deepEqual(await evaluate('km.calls'),[]);assert.ok(await evaluate(`${ledger}.pending`));
    }
  });
  await t.test('股市发送瞬间：核对原交易时同样尊重刚发生的暂停或设置变化',async()=>{
    for(const change of [`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false')`,
      `localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},trade:false}))`]){
      await setupStock(`${settings}${owned}km.mode='deferred';window.stockTransport=(u,o)=>{
        if(km.calls.length){km.intercepted=true;${change};}return fetch(u,o);};`);
      await drive('km.calls.length===1','original request awaiting confirmation');
      const pending=await evaluate(`${ledger}.pending`);
      await pulse(31000);await drive('km.intercepted','same original confirmation reaches boundary');await pulse(1000);
      assert.equal(await evaluate('km.calls.length'),1);
      assert.equal(await evaluate(`${ledger}.pending.id`),pending.id);
      assert.equal(await evaluate(`${ledger}.pending.key`),pending.key);
      assert.equal(await evaluate(`${ledger}.pending.result`),null);
      assert.equal(await evaluate(`${ledger}.entries.length`),1);
      assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/绑定失败/);
    }
  });
  await t.test('股市零回收：储备不足以支持正净额卖出时等待，恢复后继续且不误触永久停止',async()=>{
    await setupStock(`${settings}${owned}km.view.stocks[0].priceCents=49;km.view.positions[0].shares=100;km.view.positions[0].costBasisTokens=10;
      const l=${ledger};l.owned['1'].shares=100;l.owned['1'].cost=10;localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));
      km.view.rules.reserveTokens=0;`);
    await drive(done,'zero proceeds sale waits');assert.deepEqual(await evaluate('km.calls'),[]);
    assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.valuation.positions[0].status`),'liquidity');
    await reloadStock();await drive(done,'zero proceeds wait survives reload');assert.deepEqual(await evaluate('km.calls'),[]);
    await evaluate(`km.view.rules.reserveTokens=1;${panel}.getElementById('stock-check').click();`);
    await drive('km.calls.length===1','positive proceeds resumes');
    assert.equal(await evaluate('km.calls[0].action'),'sell');assert.equal(await evaluate('km.calls[0].shares'),3);
    assert.equal(await evaluate('km.tokens'),10001);
  });
  await t.test('股市请求边界：Request自带正文、错误地址或方法在发送前停止并保留原记录',async()=>{
    for(const transport of [
      `(u,o)=>fetch(new Request(new URL(u,location.href),o))`,
      `(u,o)=>fetch('/api/unexpected-stock',o)`,
      `(u,o)=>fetch('https://unexpected.invalid/api/stock',o)`,
      `(u,o)=>fetch(u,{...o,method:'PUT'})`
    ]){
      await setupStock(`${settings}${owned}km.forwarded=[];const prior=window.fetch;
        window.fetch=(u,o)=>{const method=o?.method||(u instanceof Request?u.method:'GET');
          if(method!=='GET'){km.forwarded.push(String(u instanceof Request?u.url:u));return Promise.resolve(new Response('{}'));}
          return prior(u,o);};window.stockTransport=${transport};`);
      await drive(`${ledger}?.pending`,'stock intent reserved');await pulse(3000);
      assert.deepEqual(await evaluate('km.forwarded'),[],transport);
      assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/绑定失败/);
      assert.equal(await evaluate(`${ledger}.pending.key`),null);
      await reloadStock();await drive(done,'unbound original stays held after reload');
      assert.deepEqual(await evaluate('km.calls'),[]);assert.ok(await evaluate(`${ledger}.pending`));
    }
  });
  await t.test('股市请求边界：URL对象和Request配显式JSON正文仍完整绑定原交易',async()=>{
    for(const transport of [`(u,o)=>fetch(new URL(u,location.href),o)`,
      `(u,o)=>fetch(new Request(new URL(u,location.href),{method:'POST'}),{body:o.body})`]){
      await setupStock(`${settings}${owned}km.saleReceipt=true;window.stockTransport=${transport};`);await drive(done,'explicit body transport supported');
      assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending`),null);
      assert.equal(await evaluate(`${ledger}.entries[0].result`),'success');
      assert.equal(await evaluate('km.calls[0].action'),'sell');assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);
    }
  });
  await t.test('股市请求边界：原生处理器改变股数、动作或账号时不发送，原意图和预留保留',async()=>{
    for(const change of ['body.shares++',"body.action='buy'",'body.expectedUserId=88']){
      await setupStock(settings+owned+`window.stockTransport=(u,o)=>{
        km.intercepted=true;km.originalIntent=sessionStorage.getItem('stock:request:77');
        const body=JSON.parse(o.body);${change};return fetch(u,{...o,body:JSON.stringify(body)});};`);
      await drive('km.intercepted','native request body changed before send');await drive(done,'inconsistent body leaves original pending');
      assert.deepEqual(await evaluate('km.calls'),[],change);
      assert.equal(await evaluate(`${ledger}.pending.input.action`),'sell');
      assert.equal(await evaluate(`${ledger}.pending.input.shares`),10);
      assert.equal(await evaluate(`${ledger}.pending.key`),null);assert.equal(await evaluate(`${ledger}.entries[0].result`),'reserved');
      assert.equal(await evaluate(`sessionStorage.getItem('stock:request:77')`),await evaluate('km.originalIntent'));
      await reloadStock();await drive(done,'unbound original after refresh');
      assert.deepEqual(await evaluate('km.calls'),[]);assert.equal(await evaluate('km.view.positions[0].shares'),10);
    }
  });
  await t.test('股市请求边界：总暂停后迟到成功回执仍保存，刷新保持暂停，恢复时只核对到账',async()=>{
    await setupStock(settings+owned+`km.saleReceipt=true;const receiptFetch=window.fetch;
      window.fetch=(u,o)=>{const response=receiptFetch(u,o);return u==='/api/stock'&&o?.method==='POST'?
        response.then(r=>new Promise(resolve=>{km.releasePausedReceipt=()=>resolve(r);})):response;};`);
    await drive(`km.calls.length===1 && typeof km.releasePausedReceipt==='function'`,'sale executed before receipt');
    const original=await evaluate(`${ledger}.pending`);
    await evaluate(`${panel}.getElementById('toggle').click();km.releasePausedReceipt();`);
    await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'late success persisted while paused');
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
    assert.equal(await evaluate(`${ledger}.pending.key`),original.key);assert.equal(await evaluate('km.calls.length'),1);
    await reloadStock();await pulse(5000);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
    assert.equal(await evaluate(`${ledger}.pending.result`),'success');assert.equal(await evaluate('km.calls.length'),1);
    await evaluate(`${panel}.getElementById('toggle').click();`);await drive(`${ledger}.pending===null`,'resume reconciles known receipt');
    await drive(done,'confirmed sale returns');assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate(`${ledger}.entries.length`),1);assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);
    assert.equal(await evaluate(`${ledger}.entries[0].releasedCost`),100);assert.equal(await evaluate('km.tokens'),10117);
  });
  await t.test('股市请求边界：人工Request交易保持原请求与响应，并将脚本持仓交回人工',async()=>{
    await setupStock(`${settings}${owned}km.view.positions[0].holdUntil=new Date(clock+3600000).toISOString();
      const native=window.fetch;window.fetch=function(...args){km.nativePromise=Reflect.apply(native,this,args);return km.nativePromise;};`);
    await drive(done,'automatic position held');await evaluate(`navFarm('/stock');
      window.stockTransport=(u,o)=>{const request=new Request(new URL(u,location.href),o),promise=fetch(request);
        km.samePromise=promise===km.nativePromise;return promise.then(response=>{
          km.responseWasUnread=!response.bodyUsed;km.requestWasRead=request.bodyUsed;return response;});};
      void stockAct('buy',{modelName:'模型甲',shares:1});`);
    await until(()=>evaluate('km.calls.length===1&&!km.busy'),'manual request completed');
    assert.equal(await evaluate(`${ledger}.owned['1'].manual`),true);
    assert.equal(await evaluate("sessionStorage.getItem('stock:request:77')"),null);
    assert.equal(await evaluate('km.view.positions[0].shares'),11);
    assert.deepEqual(await evaluate('[km.samePromise,km.responseWasUnread,km.requestWasRead]'),[true,true,true]);
  });
  await t.test('股市请求边界：人工Request正文观察迟到，原生已清记录仍能确认同一原交易',async()=>{
    await setupStock(`${settings}${owned}km.saleReceipt=true;km.mode='unknown';const clone=Request.prototype.clone;
      Request.prototype.clone=function(){const copy=clone.call(this),json=copy.json.bind(copy);
        copy.json=()=>new Promise((resolve,reject)=>json().then(body=>{km.releaseObservedBody=()=>resolve(body);},reject));return copy;};`);
    await drive('km.calls.length===1','original request bound');
    await evaluate(`km.mode='success';window.stockTransport=(u,o)=>fetch(new Request(new URL(u,location.href),o));
      void stockAct('sell',{modelName:'ignored',shares:1});`);
    await until(()=>evaluate(`km.calls.length===2&&!km.busy&&!!km.releaseObservedBody`),'native request finished before observation');
    assert.equal(await evaluate("sessionStorage.getItem('stock:request:77')"),null);
    await evaluate('km.releaseObservedBody();');
    await until(()=>evaluate(`${ledger}.pending?.result==='success'||${ledger}.entries[0].result==='success'`),'delayed original proof');
    await drive(done,'matched receipt reconciled');assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate('new Set(km.calls.map(c=>c.idempotencyKey)).size'),1);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell','sell']);
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);
  });
  await t.test('股市：初始化后保持关闭不干预手动页面，零额度检查不花费且返回远征',async()=>{
    await setupStock();await pulse(10000);assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate('location.pathname'),'/stock');assert.equal(await evaluate('km.reads'),0);
    await setupStock(`${settings}localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},tradeLimit:0}));`);
    await drive(done,'zero budget');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市：历史买入核对实际含费成本，持有期内不卖或重复买',async()=>{
    await setupStock(oldBuy);await drive(done,'historical buy reconciles then returns');
    const calls=await evaluate('km.calls'),l=await evaluate(ledger);assert.equal(calls.length,0);
    assert.equal(l.pending,null);assert.equal(l.entries[0].result,'success');assert.equal(l.entries[0].debit,123);
    assert.equal(l.owned['1'].cost,await evaluate('km.view.positions[0].costBasisTokens'));
    assert.equal(l.owned['1'].shares,10);
    await reloadStock();await drive(done,'historical holding stays locked');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.entries.length`),1);
  });
  await t.test('股市等待诊断：禁止新买时仍保留额度、保留余额与人工持仓约束，正常等待不永久停止',async()=>{
    for(const [seed,key,remaining] of [
      [`localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},tradeLimit:0}));`,'daily-buy-limit',0],
      [`km.tokens=100;`,'cash-after-reserve',0],
      [`km.view.positions=[{stockId:1,shares:10,costBasisTokens:3000,holdUntil:null}];`,'position-limit',0]]){
      await setupStock(`${settings}${seed}`);await drive(done,'explicit normal stock wait');
      assert.match(await evaluate(`${ledger}.note`),/新买入等待扣费后对照验证/);
      const d=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='stock-decision').data`);
      assert.equal(d.selected,null);assert.equal(d.policy.newBuy,false);
      assert.equal(d.budget.constraints.find(c=>c.key===key)?.remaining,remaining,JSON.stringify(d.budget));
      assert.equal(await evaluate(`${ledger}.hold`),false);assert.ok(await evaluate(`${ledger}.nextAt>clock`));
      assert.deepEqual(await evaluate('km.calls'),[]);
    }
  });
  await t.test('股市等待诊断：预测预算按确认时间逐笔释放，刷新保留记录，额度够一注也不自动下注',async()=>{
    await setupStock(`${prediction}
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,owned:{},pending:null,
        entries:[{id:'part-a',action:'predict',roundId:80,betId:80,at:clock-23*3600000,debit:40,result:'success'},
          {id:'part-b',action:'predict',roundId:81,betId:81,at:clock-3*86400000,confirmedAt:clock-22*3600000,debit:60,result:'success'},
          {id:'recent',action:'predict',roundId:82,betId:82,at:clock-3600000,debit:400,result:'success'}]}));`);
    await drive(done,'prediction waits for sufficient released budget');
    const diagnostic=`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-decision').at(-1).data`;
    assert.equal(await evaluate(`${diagnostic}.budget.remainingPrediction`),0);
    const original=await evaluate(`${ledger}.entries`);await reloadStock();await drive(done,'budget wait survives reload');
    assert.deepEqual(await evaluate(`${ledger}.entries`),original);assert.deepEqual(await evaluate('km.calls'),[]);
    const reads=await evaluate('km.reads');await pulse(3600000);
    await drive(`km.reads>${reads}`,'partial budget expiry reread');await drive(done,'partial release still insufficient');
    assert.equal(await evaluate(`${diagnostic}.budget.remainingPrediction`),40);
    assert.deepEqual(await evaluate('km.calls'),[]);assert.equal(await evaluate(`${ledger}.hold`),false);
    await evaluate(`km.view.rounds[0].lockAt=new Date(clock+7200000).toISOString();km.view.rounds[0].closeAt=new Date(clock+9000000).toISOString();`);
    const beforeFinalRead=await evaluate('km.reads');await pulse(3600000);
    await evaluate(`km.view.ticks.forEach((x,i)=>x.createdAt=new Date(clock-(5-i)*300000).toISOString());`);
    await drive(`km.reads>${beforeFinalRead}`,'sufficient budget read');await drive(done,'restored budget keeps prediction disabled');
    assert.equal(await evaluate(`${diagnostic}.budget.remainingPrediction`),100);
    assert.equal(await evaluate(`${diagnostic}.policy.predict`),false);assert.equal(await evaluate('km.calls.length'),0);
    assert.deepEqual(await evaluate(`${ledger}.entries`),original);
    assert.equal(await evaluate(`${ledger}.pending`),null);assert.equal(await evaluate(`${ledger}.hold`),false);
  });
  await t.test('股市：余额含小数仍可卖出旧仓，诊断按整币核对并保留账户小数',async()=>{
    await setupStock(`${settings}${owned}km.saleReceipt=true;km.tokens=10000.75;`);await drive(done,'fractional balance accepted');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.calls[0].action'),'sell');
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);assert.equal(await evaluate('km.tokens'),10117.75);
    assert.equal(await evaluate('km.tokens%1'),.75);
    const d=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='stock-decision').data`);
    assert.equal(d.budget.balance,10000);
  });
  await t.test('股市同步恢复：买入成功但持仓迟到超过30秒，恢复后解除数据等待且不重复买入',async()=>{
    await setupStock(`${oldBuy}km.hidePositions=true;`);
    await drive(done,'late positions yields to expedition');assert.ok(await evaluate(`${ledger}.pending`));
    await evaluate(`km.hidePositions=false;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.pending===null`,'positions recovered');await drive(done,'resume regular stock schedule');
    assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${ledger}.owned['1'].shares`),await evaluate('km.view.positions[0].shares'));
  });
  await t.test('股市成本恢复：新买入份额已到但成本为0时保留预算，刷新后等真实成本且不重复买入',async()=>{
    await setupStock(`${oldBuy}km.zeroCosts=true;`);
    const reserved=await evaluate(`${ledger}.entries[0].debit`);assert.ok(reserved>0);
    await pulse(31000);await drive(done,'zero buy cost yields without confirming free purchase');
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),reserved,'未核实实际成本前不能把预留预算清零');
    assert.ok(await evaluate(`${ledger}.pending`),'新买入成本0不能当作已核对真实花费');
    assert.equal(await evaluate(`${ledger}.owned['1']`),undefined);
    assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/成本为0/);
    assert.equal(await evaluate(`${ledger}.hold`),false);
    await reloadStock();await drive(done,'zero cost reservation survives refresh');
    assert.ok(await evaluate(`${ledger}.pending`));assert.equal(await evaluate(`${ledger}.entries[0].debit`),reserved);
    assert.equal(await evaluate('km.calls.length'),0);
    await evaluate(`km.zeroCosts=false;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.pending===null`,'positive cost reconciled');await drive(done,'regular stock schedule resumes');
    const cost=await evaluate('km.view.positions[0].costBasisTokens');assert.ok(cost>0);
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),cost);assert.equal(await evaluate(`${ledger}.owned['1'].cost`),cost);
    assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市等待迁移：旧版仅因持仓迟到的停止可在核对后解除，其他停止原因保留',async()=>{
    for(const [note,held]of [['交易已执行，但持仓成本或数量尚未对应，保留原记录',false],['实际买入超过预留金额，已停止后续自动交易',true]]){
      await setupStock(`${oldBuy}km.hidePositions=true;`);
      await drive(done,'wait preserved');
      await evaluate(`const l=${ledger};l.hold=true;l.note=${JSON.stringify(note)};localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));km.hidePositions=false;`);
      await reloadStock();await drive(`${ledger}.pending===null`,'original position now proved');await drive(done,'migration checked');
      assert.equal(await evaluate(`${ledger}.hold`),held);assert.equal(await evaluate('km.calls.length'),0);
      if(held)assert.match(await evaluate(`${ledger}.note`),/超过预留/);
    }
  });
  await t.test('股市等待迁移：旧停止跨多轮迟到、读取失败与保存设置后仍保留原原因，核对后恢复',async()=>{
    for(const mode of ['late','read-error','settings']){
      await setupStock(`${oldBuy}km.hidePositions=true;`);
      await drive(done,'original position pending');
      await evaluate(`const l=${ledger};l.hold=true;delete l.holdReason;l.note='交易已执行，但持仓成本或数量尚未对应，保留原记录';
        localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));km.readError=${mode==='read-error'};`);
      await reloadStock();
      if(mode==='settings')await evaluate(`${panel}.getElementById('stock-save').click();`);
      await drive(done,'original reason survives another wait');assert.equal(await evaluate(`${ledger}.hold`),true);
      assert.equal(await evaluate(`${ledger}.holdReason`),'交易已执行，但持仓成本或数量尚未对应，保留原记录');
      assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/停止原因：交易已执行/);
      assert.ok(await evaluate(`${ledger}.pending`));assert.equal(await evaluate('km.calls.length'),0);
      await evaluate(`km.readError=false;km.hidePositions=false;${panel}.getElementById('stock-check').click();`);
      await drive(`${ledger}.pending===null`,'position finally consistent');await drive(done,'migration completes after delay');
      assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate('km.calls.length'),0);
    }
  });
  await t.test('股市：远征空闲自动访问，结束后保留五分钟预约',async()=>{
    await setupStock(settings+owned+saleOnce,'/activities/expedition');await drive('km.calls.length===1','expedition visits stock');
    await drive(done,'stock returns');assert.ok(await evaluate(`${ledger}.nextAt>clock`));
    await pulse(10000);assert.equal(await evaluate('location.pathname'),'/activities/expedition');
  });
  await t.test('股市迟到成交：原请求隔天或一周后才执行，仍计入当前24小时预算且不被七天清理',async()=>{
    for(const days of [2,8]){
      await setupStock(settings+stockHistoricalRequest());await drive(done,'historical original has no outcome');
      assert.equal(await evaluate('km.view.positions.length'),0);await pulse(days*86400000);
      await drive(done,'old request yields');
      await evaluate(`km.mode='success';stockAct('buy',{modelName:'ignored',shares:99});`);
      await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'late original success');
      await evaluate(`${panel}.getElementById('stock-check').click();`);
      await drive(`${ledger}.pending===null`,'late original reconciled');await drive(done,'late original returns');
      const l=await evaluate(ledger),cost=await evaluate('km.view.positions[0].costBasisTokens');
      assert.equal(l.entries.length,1);assert.equal(l.entries[0].debit,cost);assert.ok(l.entries[0].confirmedAt>=l.entries[0].at+days*86400000);
      assert.ok(await evaluate(`${panel}.getElementById('stock-status').textContent.includes('24小时买入 '+${cost}+'/3000')`));
      assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.calls[0].idempotencyKey'),'old-buy-request');
      await reloadStock();await drive(done,'late debit survives reload');assert.equal(await evaluate(`${ledger}.entries.length`),1);
      assert.equal(await evaluate(`${ledger}.entries[0].confirmedAt`),l.entries[0].confirmedAt);
    }
  });
  await t.test('股市迟到成交：隔天才确认的原卖出按新确认时间冷却，不立即买回',async()=>{
    await setupStock(`${settings}${owned}km.mode='deferred';`);await drive('km.calls.length===1','original sell not executed');
    await pulse(2*86400000);await drive(done,'old sell yields');
    await evaluate(`km.mode='success';km.view.ticks.forEach((x,i)=>x.createdAt=new Date(clock-(5-i)*300000).toISOString());
      stockAct('sell',{modelName:'ignored',shares:99});`);
    await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'late original sell acknowledged');
    await evaluate(`${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.pending===null`,'late sell reconciled');await drive(done,'cooldown after real confirmation');
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell','sell']);
    assert.ok(await evaluate(`${ledger}.entries[0].confirmedAt>=clock-60000`));
  });
  await t.test('股市：只出售脚本持仓，满足净止盈并核对部分卖出的剩余成本',async()=>{
    await setupStock(`${settings}${owned}km.view.rules.reserveTokens=50;`);await drive(done,'partial sales');
    const calls=await evaluate('km.calls');assert.ok(calls.length>=1);assert.equal(calls[0].action,'sell');assert.equal(calls[0].shares,4);
    assert.ok(calls.every(c=>c.action==='sell'));assert.equal(await evaluate(`${ledger}.pending`),null);
  });
  await t.test('股市：手动持仓及被手动改变的原脚本持仓不出售',async()=>{
    await setupStock(`${settings}km.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];`);
    await drive(done,'manual lot');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(`${settings}${owned}km.view.positions[0].shares=11;`);await drive(done,'changed lot');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.owned['1'].manual`),true);
  });
  await t.test('股市：三只旧持仓交回人工后保留归属，空出的名额不开放新买入',async()=>{
    await setupStock(`${settings}${owned}km.view.positions=[];
      const seed=km.view.stocks[0],ticks=km.view.ticks;km.view.stocks=[1,2,3,4].map(id=>({...seed,id,modelName:'模型'+id}));
      km.view.ticks=km.view.stocks.flatMap(s=>ticks.map(t=>({...t,stockId:s.id})));
      const ledger=JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'));
      ledger.owned=Object.fromEntries([1,2,3].map(id=>[id,{shares:10,cost:100,manual:true,modelName:'模型'+id}]));
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(ledger));`);
    await drive(done,'released automatic position slots');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.owned['4']`),undefined);
    assert.equal(await evaluate(`${ledger}.entries.length`),0);
    assert.ok(await evaluate(`[1,2,3].every(id=>${ledger}.owned[id].manual===true)`));
  });
  await t.test('股市：历史预测固定单注核对后同轮不重复，刷新保留独立额度',async()=>{
    await setupStock(oldPrediction);await drive(done,'historical prediction reconciles');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate(`${ledger}.entries[0].betId`),1);assert.equal(await evaluate('km.view.myBets[0].direction'),'up');
    await reloadStock();await drive(done,'reload prediction ledger');assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),100);
  });
  await t.test('股市预测核验：成功响应先到但下注列表迟到时，保留对应记录并在恢复后绑定结算',async()=>{
    await setupStock(`${oldPrediction}km.hideBets=true;`);
    await drive(done,'historical confirmed prediction waits for bet list');
    assert.equal(await evaluate(`${ledger}.pending?.result`),'success');assert.equal(await evaluate(`${ledger}.entries[0].betId`),undefined);
    await pulse(31000);await drive(done,'wait for late bet without occupying expedition');
    assert.equal(await evaluate('km.calls.length'),0);assert.ok(await evaluate(`${ledger}.pending`));
    await evaluate(`km.hideBets=false;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.pending===null`,'late bet bound');
    assert.equal(await evaluate(`${ledger}.entries[0].betId`),1);assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市账本结算校验：损坏的结算结构、返还或时间不能作为已完成凭据清理，原文保留',async()=>{
    for(const settlement of ['true',"'finished'",'{}',"{payout:'180',at:clock-86400000}",'{payout:-1,at:clock-86400000}',"{payout:180,at:'unknown'}"]){
      await setupStock(`${prediction}km.view.rounds=[];
        km.seedLedger=JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,owned:{},pending:null,
          entries:[{id:'old-corrupt-settlement',action:'predict',roundId:42,betId:8,at:clock-8*86400000,debit:100,result:'success',settlement:${settlement}}]});
        localStorage.setItem('arkengine:auto-stock:ledger:v1',km.seedLedger);`);
      await drive(done,'invalid terminal record yields to expedition');
      assert.equal(await evaluate(`${ledger}.entries.length`),1,settlement);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')===km.seedLedger`),true,settlement);
      assert.deepEqual(await evaluate('km.calls'),[]);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
      assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/保存记录不可读.*原记录保留/);
      if(settlement==='true'){
        await reloadStock();await drive(done,'invalid settlement survives reload');
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')===km.seedLedger`),true);
        assert.deepEqual(await evaluate('km.calls'),[]);
      }
    }
  });
  await t.test('股市账本结算校验：结算必须属于有下注编号的成功预测，拒绝与买卖记录不能借此标为已结算',async()=>{
    for(const change of ["action:'buy'","result:'rejected'","betId:null"]){
      await setupStock(`${prediction}km.view.rounds=[];
        km.seedLedger=JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,owned:{},pending:null,
          entries:[{id:'invalid-settlement-owner',action:'predict',roundId:42,betId:8,at:clock-8*86400000,debit:100,result:'success',
            settlement:{payout:180,at:clock-86400000},${change}}]});
        localStorage.setItem('arkengine:auto-stock:ledger:v1',km.seedLedger);`);
      await drive(done,'inconsistent settlement owner');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')===km.seedLedger`),true,change);
      assert.deepEqual(await evaluate('km.calls'),[]);
    }
  });
  await t.test('股市预测核验：七天前已拒绝及合法已结算的下注会清理，成功但未结算的下注仍保留',async()=>{
    await setupStock(`${prediction}km.view.rounds=[];
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,owned:{},pending:null,
        entries:[{id:'old-rejected',action:'predict',roundId:1,at:clock-8*86400000,debit:100,result:'rejected'},
          {id:'old-open',action:'predict',roundId:2,at:clock-8*86400000,debit:100,result:'success',betId:2},
          {id:'old-open-null',action:'predict',roundId:20,at:clock-8*86400000,debit:100,result:'success',betId:20,settlement:null},
          ...[0,100,180].map((payout,i)=>({id:'old-settled-'+i,action:'predict',roundId:i+3,betId:i+3,at:clock-8*86400000,
            debit:100,result:'success',settlement:{payout,at:clock-86400000}}))]}));`);
    await drive(done,'trim terminal prediction history');
    assert.deepEqual(await evaluate(`${ledger}.entries.map(e=>e.id)`),['old-open','old-open-null']);assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市：预测下跌方向、已下注轮次、临近锁盘和重复卡片均保持禁止下注',async()=>{
    await setupStock(`${prediction}km.view.ticks.forEach((t,i)=>t.priceCents=1400-i*40);`);
    await drive(done,'down prediction disabled');assert.equal(await evaluate('km.calls.length'),0);
    const row=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-decision-detail').flatMap(e=>e.data.rows).find(r=>r.kind==='prediction')`);
    assert.equal(row.direction,'down');assert.equal(row.eligible,false);
    await setupStock(`${prediction}km.view.myBets=[{id:9,roundId:42,betTokens:10,direction:'up',settled:false}];`);
    await drive(done,'manual bet already exists');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(`${prediction}km.view.rounds[0].lockAt=new Date(clock+59000).toISOString();`);
    await drive(done,'near lock');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(`${prediction}km.view.rounds.push({...km.view.rounds[0],id:43});`);
    await drive(done,'duplicate round display');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市：卖出回执丢失仅确认同一个请求，刷新后不重复卖出或记收入',async()=>{
    await setupStock(`${settings}${owned}km.saleReceipt=true;km.mode='lost';`);await drive('km.calls.length===1','lost receipt');
    const key=await evaluate('km.calls[0].idempotencyKey');await reloadStock();await evaluate(`km.mode='success'`);
    await drive(done,'same intent confirmed',180);const calls=await evaluate('km.calls');
    assert.equal(calls.length,2);assert.ok(calls.every(c=>c.idempotencyKey===key));assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate('km.view.positions[0].shares'),0);assert.equal(await evaluate('km.tokens'),10117);
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);assert.equal(await evaluate(`${ledger}.entries.length`),1);
  });
  await t.test('股市：HTTP成功但错账号不算确认，两次核对仍未知后隔离股市',async()=>{
    await setupStock(`${settings}${owned}km.mode='wrong-user';`);await drive('km.calls.length===1','wrong receipt');
    await pulse(31000);await drive('km.calls.length===2','first same recovery');await pulse(31000);await drive(done,'pending yields to expedition');
    await pulse(121000);await evaluate(`${panel}.getElementById('stock-check').click();`);await drive('km.calls.length===3','second same recovery');
    await pulse(61000);await drive(done,'second pending yields');await pulse(121000);await evaluate(`${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'final original check');await drive(done,'unknown isolated');assert.equal(await evaluate(`${ledger}.pending.retries`),2);
    assert.equal(await evaluate(`${ledger}.hold`),true);assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('股市：明确拒绝释放预算且不反复尝试，幂等冲突保留原记录',async()=>{
    await setupStock(`${settings}${owned}km.mode='rejected';`);await drive(done,'rejection');
    assert.equal(await evaluate(`${ledger}.pending`),null);assert.equal(await evaluate(`${ledger}.entries[0].result`),'rejected');assert.equal(await evaluate('km.calls.length'),1);
    await setupStock(`${settings}${owned}km.mode='conflict';`);await drive('km.calls.length===1','conflict');
    assert.equal(await evaluate(`${ledger}.pending.result`),null);
  });
  await t.test('股市：已有手动原请求不接管，不覆盖或创建新交易',async()=>{
    await setupStock(`${settings}sessionStorage.setItem('stock:request:77',JSON.stringify({idempotencyKey:'manual-original',input:{modelName:'模型甲',shares:1,action:'buy',expectedUserId:77}}));`);
    await drive(done,'manual request');assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('stock:request:77')).idempotencyKey`),'manual-original');
    const frames=stockSnapshotsFromLog({events:await evaluate(observationEvents)});assert.equal(frames.length,1);
    assert.equal(frames[0].sourceAccount.pendingKnown,false);assert.equal(Object.hasOwn(frames[0].sourceAccount,'pending'),false);
  });
  await t.test('股市：等待卖出期间暂停、行情变化或跨页撤销点击',async()=>{
    const queued=`${panel}.getElementById('status').textContent.includes('秒后卖出')`;
    await setupStock(settings+owned);await drive(queued,'sale queued');await evaluate(`${panel}.getElementById('toggle').click()`);await pulse(10000);
    assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(settings+owned);await drive(queued,'sale queued again');await evaluate('km.view.stocks[0].suspended=true;renderStock();');await drive(done,'suspended');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(settings+owned);await drive(queued,'sale queued before navigate');await evaluate(`navFarm('/activities/expedition')`);await pulse(1000);assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市：存储损坏保留原文，账本写入失败不得发送交易',async()=>{
    await setupStock(`${settings}localStorage.setItem('arkengine:auto-stock:ledger:v1','broken-json');`);await drive(done,'corrupt ledger isolated');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),'broken-json');
    await setupStock(`${settings}${owned}const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='arkengine:auto-stock:ledger:v1')throw Error('quota');return originalSet.call(this,k,v);};`);
    await drive(done,'storage failure isolated');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市预算时间：损坏的确认时间保留原账本，不清空预算或再次交易',async()=>{
    for(const confirmedAt of [`'invalid'`,'-1','clock-2000']){
      await setupStock(`${settings}localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,
        nextAt:0,note:'fixture',hold:false,owned:{},pending:null,entries:[{id:'saved-buy',at:clock-1000,confirmedAt:${confirmedAt},
          action:'buy',stockId:1,debit:900,result:'success'}]}));`);
      const original=await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`);
      await drive(done,'corrupt debit time isolated');assert.equal(await evaluate('km.calls.length'),0);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),original);
    }
    await setupStock(unknownBuy);await drive(done,'saved historical request');
    await evaluate(`const l=${ledger};l.pending.confirmedAt='invalid';localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
    const original=await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`);
    await reloadStock();await drive(done,'corrupt pending time isolated');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),original);
  });
  await t.test('股市：实际成交超过预留则停止后续交易，不能把报价当作到账',async()=>{
    await setupStock(unknownBuy+`km.fillPrice=1800;`);await drive(done,'historical buy pending');
    await evaluate(`stockAct('buy',{});`);await evaluate(`${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.pending===null`,'manual original price slipped');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.hold`),true);
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),await evaluate('km.view.positions[0].costBasisTokens'));
  });
  await t.test('股市：缺规则、陈旧行情、余额不足和手动筛选均不盲买',async()=>{
    for(const code of ['delete km.view.rules.reserveTokens;','km.view.ticks.forEach(t=>t.createdAt=new Date(Date.parse(t.createdAt)-3600000).toISOString());','km.tokens=100;','km.search="未上市";']){
      await setupStock(settings+code);await drive(done,'unsafe market skipped');assert.equal(await evaluate('km.calls.length'),0);
    }
  });
  await t.test('股市：读取迟到、离线、账号异常和账号切换不会继续花费',async()=>{
    await setupStock(`${settings}km.deferRead=true;`);await until(()=>evaluate('typeof km.resolveRead===\'function\''),'read started');
    await evaluate(`${panel}.getElementById('toggle').click();km.resolveRead();`);await pulse(10000);assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(`${settings}km.httpStatus=401;`);await drive(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')==='false'`,'auth pause');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(`${settings}${owned}km.view.userId=88;`);await drive(done,'account switch');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市：旧买卖和预测同时开启仍禁止新增风险，卖出后不回买',async()=>{
    await setupStock(`${prediction}localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},trade:true,predict:true}));`);
    await drive(done,'both new exposure paths disabled');assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),[]);
    assert.equal(await evaluate(`${ledger}.entries.length`),0);
    await setupStock(`${settings}${owned}`);await drive(done,'sell then cooldown');assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell']);
  });
  await t.test('股市：关闭交易撤销排队卖出，修改买入额度或预测开关也不产生新增风险',async()=>{
    await setupStock(settings+owned);await drive(`${panel}.getElementById('status').textContent.includes('秒后卖出')`,'sale queued before trade disabled');
    await evaluate(`${panel}.getElementById('stock-trade').checked=false;${panel}.getElementById('stock-save').click();`);
    await drive(done,'trade disabled cancels queued sale');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(settings);await drive(done,'new buys already disabled');
    await evaluate(`${panel}.getElementById('stock-trade-limit').value='0';${panel}.getElementById('stock-save').click();`);
    await drive(done,'budget lowered');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(prediction);await drive(done,'new predictions already disabled');
    await evaluate(`${panel}.getElementById('stock-predict').checked=false;${panel}.getElementById('stock-save').click();`);
    await drive(done,'prediction off');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市：手动确认脚本原请求能核对回执，手动新交易转交持仓',async()=>{
    await setupStock(lostBuy);await drive(done,'historical pending original');
    await evaluate(`km.mode='success';stockAct('buy',{modelName:'ignored',shares:99});`);
    await evaluate(`${panel}.getElementById('stock-check').click();`);await drive(`${ledger}.pending===null`,'manual confirms same original');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.tokens'),9877);
    assert.equal(await evaluate('new Set(km.calls.map(c=>c.idempotencyKey)).size'),1);
    await setupStock(`${settings}${owned}localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);
    await evaluate(`stockAct('buy',{modelName:'模型甲',shares:1});`);
    await until(()=>evaluate('km.calls.length===1 && !km.busy'),'manual buy');assert.equal(await evaluate(`${ledger}.owned['1'].manual`),true);
  });
  await t.test('股市：原请求绑定保存失败阻止发送，原生已有请求不被覆盖',async()=>{
    await setupStock(`${settings}${owned}const save=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
      if(k==='arkengine:auto-stock:ledger:v1' && JSON.parse(v).pending?.key)throw Error('fixture bind quota');return save.call(this,k,v);};`);
    await drive(done,'bind failure');assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending.key`),null);
    assert.ok(await evaluate(`sessionStorage.getItem('stock:request:77')`));
  });
  await t.test('股市：双标签共用锁，接力页缺少原请求时不重建订单',async()=>{
    await setupStock(`${settings}${owned}km.mode='lost';`);await drive('km.calls.length===1','first tab submitted');
    const second=await secondStock();
    try {
      await second.pulse(5000);assert.equal(await second.evaluate('km.calls.length'),0);
      await evaluate(`history.pushState({},'','/outside');window.dispatchEvent(new Event('popstate'));`);
      for(let i=0;i<12;i++)await second.pulse(1000);
      assert.equal(await second.evaluate('km.calls.length'),0);assert.equal(await second.evaluate(`${ledger}.hold`),true);
      assert.ok(await second.evaluate(`${ledger}.pending.key`));
    }finally{await second.close();}
  });
  await t.test('股市冻结接力：真实冻结释放运行锁，新页继续卖出旧仓，旧页恢复不重复成交',async()=>{
    await setupStock(`${settings}${owned}km.saleReceipt=true;
      document.addEventListener('freeze',()=>localStorage.setItem('fixture:stock-frozen','true'));
      document.addEventListener('resume',()=>{
        const server=JSON.parse(localStorage.getItem('fixture:stock-server')||'null');
        if(server){Object.assign(km,server.km);clock=server.clock;renderStock();}
      });`);
    await until(()=>evaluate(`${panel}.getElementById('status').textContent.includes('填写股市原生数量')`),'first tab owns lock before freezing');
    assert.equal(await evaluate('km.calls.length'),0);
    const second=await secondStock();
    try {
      await second.withFrozenOriginal(async()=>{
        await until(()=>second.evaluate(`localStorage.getItem('fixture:stock-frozen')==='true'`),'real browser freeze event');
        for(let i=0;i<18;i++){
          if(await second.evaluate(`km.calls.length===1&&${ledger}.pending===null`))break;
          await second.pulse();
        }
        assert.equal(await second.evaluate('km.calls.length'),1,'live tab must acquire lock released by frozen tab');
        assert.equal(await second.evaluate(`${ledger}.pending`),null);
        await second.evaluate(`localStorage.setItem('fixture:stock-server',JSON.stringify({km,clock}));`);
      });
    } finally {await second.close();}
    await pulse(10000);await drive(done,'resumed original returns after checking shared holdings');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.entries.length`),1);
    assert.equal(await evaluate(`${ledger}.owned['1']`),undefined);assert.equal(await evaluate('km.view.positions[0].shares'),0);
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),null);
  });
  await t.test('股市冻结原请求：接力页不重建未知交易，原页恢复后确认同一笔并解除页面缺失等待',async()=>{
    for(const returned of [false,true]){
    await setupStock(`${settings}${owned}km.saleReceipt=true;km.mode='lost';
      document.addEventListener('freeze',()=>localStorage.setItem('fixture:stock-frozen','true'));
      document.addEventListener('resume',()=>{clock+=2*3600000;km.mode='success';
        if(location.pathname==='/stock')renderStock();else renderExp();});`);
    await drive('km.calls.length===1','original stock order sent before freeze');
    const pending=await evaluate(`${ledger}.pending`);assert.ok(pending.key);
    const afterSale=await evaluate('km.tokens');
    if(returned){await pulse(61000);await drive(done,'original returns while result remains unknown');}
    const second=await secondStock();
    try {
      await second.withFrozenOriginal(async()=>{
        await until(()=>second.evaluate(`localStorage.getItem('fixture:stock-frozen')==='true'`),'real freeze with unknown receipt');
        for(let i=0;i<12;i++){
          if(await second.evaluate(`${ledger}.hold`))break;
          await second.pulse();
        }
        assert.equal(await second.evaluate(`${ledger}.hold`),true);
        assert.match(await second.evaluate(`${ledger}.holdReason`),/本页没有匹配的原交易/);
        assert.equal(await second.evaluate(`${ledger}.pending.id`),pending.id);
        assert.equal(await second.evaluate(`${ledger}.pending.key`),pending.key);
        assert.equal(await second.evaluate('km.calls.length'),0,'second tab must not rebuild an unknown order');
      });
    } finally {await second.close();}
    await drive(`${ledger}.pending===null`,'original tab confirms retained request after resume');
    assert.equal(await evaluate('km.calls.length'),2);
    assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(pending.key)})`));
    assert.equal(await evaluate('km.tokens'),afterSale);assert.equal(await evaluate(`${ledger}.entries.length`),1);
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);
    assert.equal(await evaluate(`${ledger}.hold`),false,'a verified original receipt resolves the missing-page stop');
    }
  });
  await t.test('股市冻结暂停：冻结期间另一页关闭总开关，恢复和再次唤醒都不自动开启',async()=>{
    await setupStock(`${settings}${owned}
      document.addEventListener('freeze',()=>localStorage.setItem('fixture:stock-frozen','true'));`);
    await until(()=>evaluate(`${panel}.getElementById('status').textContent.includes('填写股市原生数量')`),'stock queue before freeze and pause');
    const second=await secondStock();
    try{
      await second.withFrozenOriginal(async()=>{
        await until(()=>second.evaluate(`localStorage.getItem('fixture:stock-frozen')==='true'`),'freeze before manual pause');
        await second.evaluate(`${panel}.getElementById('toggle').click();`);
        await second.pulse(2*3600000);assert.equal(await second.evaluate('km.calls.length'),0);
      });
    }finally{await second.close();}
    await pulse(2*3600000);await pulse(10000);
    assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
    assert.match(await evaluate(`${panel}.getElementById('status').textContent`),/暂停/);
  });
  await t.test('股市：预测结算记录真实返还，额度不因返还或亏损恢复',async()=>{
    await setupStock(oldPrediction);await drive(done,'historical bet confirmed');
    await evaluate(`km.view.myBets[0].settled=true;km.view.myBets[0].payoutTokens=180;km.tokens+=180;
      ${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'settlement visit');await drive(done,'settlement reconciled');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement.payout`),180);assert.equal(await evaluate(`${ledger}.entries[0].debit`),100);
    assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市账本容量：卖出用完最后一条后等待，到期清理只恢复旧仓退出且保留预测预算',async()=>{
    await setupStock(`${settings}km.saleReceipt=true;km.view.rules.reserveTokens=117;
      km.view.positions=[{stockId:1,shares:20,costBasisTokens:200,holdUntil:null}];
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,
        owned:{'1':{shares:20,cost:200,modelName:'模型甲',manual:false}},pending:null,
        entries:[...Array.from({length:1998},(_,i)=>({id:'old-rejected-'+i,action:'predict',roundId:10000+i,
          at:clock-7*86400000+120000,debit:100,result:'rejected'})),
          {id:'retained-bet',action:'predict',roundId:77,betId:77,at:clock,debit:100,result:'success'}]}));`);
    await drive(done,'last ledger slot used');
    assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate(`${ledger}.entries.length`),2000);
    assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate('km.view.positions[0].shares'),10);
    await pulse(300001);
    await drive('km.calls.length===2','expired terminal entries release capacity without settings click');
    await drive(done,'remaining old shares sold after capacity recovers');
    assert.deepEqual(await evaluate('km.calls.map(c=>[c.action,c.shares])'),[['sell',10],['sell',10]]);
    assert.equal(await evaluate(`${ledger}.entries.reduce((sum,e)=>sum+e.debit,0)`),100);
    assert.equal(await evaluate(`${ledger}.entries.filter(e=>e.action==='sell').reduce((sum,e)=>sum+e.proceeds,0)`),234);
    assert.equal(await evaluate(`${ledger}.entries.filter(e=>e.action==='sell').reduce((sum,e)=>sum+e.releasedCost,0)`),200);
    assert.equal(await evaluate(`${ledger}.hold`),false);
    await reloadStock();await drive(done,'recovered ledger survives reload');
    assert.equal(await evaluate('km.calls.length'),2);
    assert.equal(await evaluate(`${ledger}.entries.length`),3);
  });
  await t.test('股市账本容量：旧版容量停止仍核对结算，未结算记录不清理，容量释放后才恢复',async()=>{
    await setupStock(`${prediction}km.view.rounds=[];
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,
        note:'股市账本达到容量上限，请导出日志后核对',hold:true,owned:{},pending:null,
        entries:Array.from({length:2000},(_,i)=>({id:'old-open-'+i,action:'predict',roundId:10000+i,betId:10000+i,
          at:clock-8*86400000,debit:100,result:'success'}))}));`,'/activities/expedition');
    await drive('km.reads>0','legacy capacity wait still reads settlement');
    await drive(done,'full unresolved ledger waits without trading');
    assert.equal(await evaluate(`${ledger}.entries.length`),2000);assert.deepEqual(await evaluate('km.calls'),[]);
    assert.ok(stockSnapshotsFromLog({events:await evaluate(observationEvents)}).length>0,'capacity exit still preserves accepted market data');
    assert.equal(await evaluate(`${ledger}.hold`),false);
    await reloadStock();await drive(done,'capacity wait survives reload');
    await evaluate(`km.view.myBets=[{id:10000,roundId:10000,betTokens:100,direction:'up',settled:true,payoutTokens:180}];`);
    await pulse(300001);await drive(`${ledger}.entries.some(e=>e.settlement?.payout===180)`,'settlement read at capacity');
    await drive(done,'settlement persisted without spending');
    assert.deepEqual(await evaluate('km.calls'),[]);
    await evaluate(`km.view.rounds=[{id:42,stockId:1,ruleVersion:2,oddsBp:180,
      lockAt:new Date(clock+900000).toISOString(),closeAt:new Date(clock+1800000).toISOString()}];
      km.view.ticks.forEach((x,i)=>x.createdAt=new Date(clock-(5-i)*300000).toISOString());`);
    await pulse(300001);await drive(`${ledger}.entries.length===1999 && ${done}`,'terminal slot released without reopening bets');
    assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${ledger}.entries.length`),1999);
    assert.equal(await evaluate(`${ledger}.entries.filter(e=>e.id.startsWith('old-open-')).length`),1999);
    assert.equal(await evaluate(`${ledger}.entries.some(e=>e.id==='old-open-0')`),false);
    assert.equal(await evaluate(`${ledger}.hold`),false);
  });
  await t.test('股市账本容量：旧容量提示不能解除其他停止原因或用户关闭开关',async()=>{
    for(const mode of ['reason','pause']){
      await setupStock(`${prediction}km.view.rounds=[];
        const config=JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1'));
        if('${mode}'==='pause'){config.predict=false;localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(config));}
        localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,
          note:'股市账本达到容量上限，请导出日志后核对',hold:true,
          ...('${mode}'==='reason'?{holdReason:'实际买入超过预留金额，已停止后续自动交易'}:{}),owned:{},pending:null,entries:[]}));`,
        '/activities/expedition');
      await pulse(300001);
      assert.equal(await evaluate('km.reads'),0,mode);assert.deepEqual(await evaluate('km.calls'),[],mode);
      assert.equal(await evaluate(`${ledger}.hold`),true,mode);
    }
  });
  await t.test('股市结算：账本保存失败不先记完成日志，刷新后只确认一次且不重复下注',async()=>{
    await setupStock(oldPrediction);await drive(done,'historical bet confirmed before settlement storage failure');
    await evaluate(`km.view.myBets[0].settled=true;km.view.myBets[0].payoutTokens=180;km.tokens+=180;
      const save=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
        if(k==='arkengine:auto-stock:ledger:v1' && JSON.parse(v).entries.some(e=>e.settlement))throw Error('fixture settlement quota');
        return save.call(this,k,v);};
      ${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'failed settlement visit');await drive(done,'failed settlement returns');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement`),undefined,'失败时保留未结算原账本');
    const events=`(await window.__arkTestLogs.read('expedition','2026-10-10',100000))`;
    const firstCount=await evaluate(`${events}.counts['stock-prediction-settled']||0`);
    assert.ok(await evaluate(`${events}.counts['stock-error']`),'保存失败有诊断记录');
    await reloadStock();await drive(done,'settlement recovers after storage restored');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement.payout`),180);
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),100);
    assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`${events}.counts['stock-prediction-settled']`),1,'刷新不能重复记同一结算');
    assert.deepEqual(await evaluate(`${events}.events.find(e=>e.type==='stock-prediction-settled').data`),{stake:100,payout:180,net:80,
      reward:{代币:180,股市返还:180,'股市预测净盈亏':80}});
    assert.equal(firstCount,0,'账本写入成功前不记录结算已完成');
    assert.deepEqual(await evaluate(`${events}.totals`),{'股市下注支出':100,代币:180,股市返还:180,'股市预测净盈亏':80},'返还与本金支出、净盈亏分开');
  });
  await t.test('股市：真实键盘操作、手动弹窗与离线不会继续排队下单',async()=>{
    await setupStock(settings+owned);await drive(`${panel}.getElementById('status').textContent.includes('秒后卖出')`,'keyboard queued');
    await trustedStaffKey();await pulse(10000);assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(`${settings}${owned}const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.textContent='确认兑换历史仓';document.body.append(dialog);`);
    await pulse(10000);assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate('location.pathname'),'/stock');
    await setupStock(`${settings}${owned}Object.defineProperty(navigator,'onLine',{get:()=>false});`);await drive(done,'offline skipped');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市：无导航入口时直接跳转仍持久限次，加载中断不反复刷新',async()=>{
    await setupStock(settings,'/activities/expedition');
    await evaluate(`document.querySelector('a[href="/stock"]').remove();`);
    await withDelayedStockNavigation(async(count,stopLoading)=>{
      // Chromium queues Runtime.evaluate during a pending cross-document navigation.
      // Interrupt that navigation at the protocol layer, then inspect the surviving document.
      await Promise.all([pulse(5000),until(()=>count()===1,'first direct navigation').then(stopLoading)]);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:navigation:v1')).to`),'/stock');
      await pulse(15000);assert.equal(count(),1);
      await Promise.all([pulse(16000),until(()=>count()===2,'single fallback navigation').then(stopLoading)]);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:navigation:v1')).reloaded`),true);
      await pulse(60000);assert.equal(count(),2);assert.equal(await evaluate('km.calls.length'),0);
    });
  });
}
