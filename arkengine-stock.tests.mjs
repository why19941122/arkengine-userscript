import assert from 'node:assert/strict';

export async function stockTests({t,setupStock,reloadStock,evaluate,pulse,drive,until,secondStock,trustedStaffKey,withDelayedStockNavigation}) {
  const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
  const ledger=`JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'))`;
  const cfg=`{trade:true,predict:false,tradeLimit:3000,predictionLimit:500,stake:100,reserve:100}`;
  const settings=`localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify(${cfg}));`;
  const prediction=`localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},trade:false,predict:true}));
    km.view.rounds=[{id:42,stockId:1,ruleVersion:2,oddsBp:180,lockAt:new Date(clock+240000).toISOString(),closeAt:new Date(clock+900000).toISOString()}];`;
  const owned=`km.view.positions=[{stockId:1,shares:10,costBasisTokens:100,holdUntil:null}];
    localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,
      entries:[],pending:null,owned:{'1':{shares:10,cost:100,modelName:'模型甲',manual:false}}}));`;
  const done=`location.pathname==='/activities/expedition'`;
  await t.test('股市结算重复记录：同一下注编号返回已结算与未结算两条时，不能取第一条宣布完成',async()=>{
    await setupStock(prediction);await drive(done,'prediction before conflicting settlement rows');
    await evaluate(`km.originalBet=structuredClone(km.view.myBets[0]);
      km.view.myBets=[{...km.originalBet,settled:true,payoutTokens:180},km.originalBet];
      ${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'ambiguous settlement read');await drive(done,'keep conflicting bet unresolved');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement`),undefined,'重复编号不构成唯一结算凭据');
    assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-prediction-settled').length`),0);
    await evaluate(`km.view.myBets=[{...km.originalBet,settled:true,payoutTokens:180}];${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'unique settlement restored');await drive(done,'settle once after list recovers');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement.payout`),180);
    await reloadStock();await drive(done,'confirmed settlement after reload');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.entries[0].debit`),100);
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
      await setupStock(`${prediction}km.hideBets=true;`);await drive('km.calls.length===1','prediction awaiting bet identity');
      await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'original prediction receipt');
      const original=await evaluate(`${ledger}.pending`);
      await evaluate(`km.originalBet=structuredClone(km.view.myBets[0]);km.view.myBets=[${duplicate},km.originalBet];km.hideBets=false;`);
      await pulse(6000);await pulse(31000);await drive(done,'ambiguous first binding yields to expedition');
      assert.equal(await evaluate(`${ledger}.pending?.id`),original.id);
      assert.equal(await evaluate(`${ledger}.entries[0].betId`),undefined);assert.equal(await evaluate('km.calls.length'),1);
      await evaluate(`km.view.myBets=[km.originalBet];${panel}.getElementById('stock-check').click();`);
      await drive(`${ledger}.pending===null`,'original prediction bound after unique identity');await drive(done,'original prediction complete');
      assert.equal(await evaluate(`${ledger}.entries[0].betId`),1);assert.equal(await evaluate('km.calls.length'),1);
      assert.equal(await evaluate(`${ledger}.entries[0].debit`),100);
    }
  });
  await t.test('股市结算重复记录别名：数值与字符串同编号不选首条，恢复唯一后仍接受零返还结算',async()=>{
    await setupStock(prediction);await drive(done,'prediction before aliased settlement');
    await evaluate(`km.originalBet=structuredClone(km.view.myBets[0]);km.view.myBets=[{...km.originalBet,settled:true,payoutTokens:0},
      {...km.originalBet,id:String(km.originalBet.id),settled:true,payoutTokens:180}];${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'aliased settlement rows');await drive(done,'aliased settlement waits');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement`),undefined);
    await evaluate(`km.view.myBets=km.view.myBets.slice(0,1);${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'unique zero payout');await drive(done,'zero payout remains valid');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement.payout`),0);assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('股市结算重复记录隔离：单笔冲突不阻塞其他唯一结算或正常买入，也不返还原下注额度',async()=>{
    await setupStock(prediction);await drive(done,'prediction before partial settlement conflict');
    await evaluate(`km.originalBet=structuredClone(km.view.myBets[0]);km.view.myBets=[{...km.originalBet,settled:true,payoutTokens:180},km.originalBet,
      {id:99,roundId:99,betTokens:100,settled:true,payoutTokens:0}];km.view.rounds=[];
      const l=${ledger};l.entries.push({id:'other-prediction',action:'predict',roundId:99,betId:99,at:clock,debit:100,result:'success'});
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},predict:true}));${panel}.getElementById('stock-check').click();`);
    await drive('km.calls.some(c=>c.action===\'buy\')','trading alongside unresolved settlement');await drive(done,'other settlement and buy complete');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement`),undefined);
    assert.equal(await evaluate(`${ledger}.entries.find(e=>e.id==='other-prediction').settlement.payout`),0);
    assert.equal(await evaluate(`${ledger}.entries.filter(e=>e.action==='predict').reduce((n,e)=>n+e.debit,0)`),200);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['predict','buy']);
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
  await t.test('股市原卖出报价缺失：模型缺失、改名、停牌或过期时不续发原卖出',async()=>{
    for(const change of [`km.view.stocks=[]`,`km.view.stocks[0].modelName='模型乙'`,
      `km.view.stocks[0].suspended=true`,`km.view.stocks[0].stale=true`]){
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
    await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','original before external buy');
    const original=await evaluate(`${ledger}.pending`),balance=await evaluate('km.tokens');
    await evaluate(`km.view.positions=[{stockId:1,shares:1,costBasisTokens:13,holdUntil:null}];
      km.mode='success';${panel}.getElementById('stock-check').click();`);
    await pulse(31000);await drive(done,'external holdings block original buy');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.tokens'),balance);
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
    for(const seed of [settings,settings+owned]){
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
    for(const seed of [settings,settings+owned]){
      await setupStock(`${seed}km.mode='deferred';`);await drive('km.calls.length===1','original before queued position change');
      await pulse(31000);await drive(`${panel}.getElementById('status').textContent.includes('核对同一笔股市原交易')`,'original position recovery queued');
      await evaluate(`km.view.positions=[{stockId:1,shares:12,costBasisTokens:120,holdUntil:null}];km.mode='success';`);
      await drive(done,'queued position rechecked');assert.equal(await evaluate('km.calls.length'),1);
      assert.equal(await evaluate(`${ledger}.pending.retries`),0);assert.match(await evaluate(`${ledger}.note`),/数量与原交易前后均不符/);
    }
  });
  await t.test('股市原交易原有持仓结果：原买入、全部卖出和部分卖出已执行丢回执，仍只确认原键',async()=>{
    for(const seed of [settings,settings+owned,settings+owned+'km.view.rules.maxTradeTokens=60;']){
      await setupStock(`${seed}km.mode='lost';`);await drive('km.calls.length===1','original executed before lost receipt');
      const original=await evaluate(`${ledger}.pending`),tokens=await evaluate('km.tokens'),positions=await evaluate('km.view.positions');
      await reloadStock();await evaluate(`km.mode='success';`);await drive(`${ledger}.pending===null`,'original position result still confirms',180);
      assert.equal(await evaluate('km.calls.length'),2);assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(original.key)})`));
      assert.equal(await evaluate('km.tokens'),tokens);assert.deepEqual(await evaluate('km.view.positions'),positions);
      assert.equal(await evaluate(`${ledger}.entries[0].result`),'success');assert.equal(await evaluate(`${ledger}.hold`),false);
    }
  });
  await t.test('股市原交易外部持仓迟到回执：数量不符时保留已成功原单，数据恢复后核对且不再次提交',async()=>{
    await setupStock(`${settings}const originalFetch=window.fetch;
      window.fetch=(u,o)=>{const response=originalFetch(u,o);return u==='/api/stock'&&o?.method==='POST'?
        response.then(r=>new Promise(resolve=>{window.releaseStockReceipt=()=>resolve(r);})):response;};`);
    await drive('km.calls.length===1','executed original with held receipt');
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
  await t.test('股市原交易报价：等待确认后股价或手续费上涨超过原预留，不继续按旧金额提交',async()=>{
    for(const change of [`km.view.stocks[0].priceCents=2000`,`km.view.rules.buyFeePct=25`]){
      await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','original before quote change');
      const original=await evaluate(`${ledger}.pending`),balance=await evaluate('km.tokens');
      await evaluate(`${change};km.mode='success';${panel}.getElementById('stock-check').click();`);
      await pulse(31000);await drive(done,'new quote respects original reservation');
      assert.equal(await evaluate('km.calls.length'),1,change);assert.equal(await evaluate('km.tokens'),balance);
      assert.equal(await evaluate(`${ledger}.pending.id`),original.id);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
      assert.equal(await evaluate(`${ledger}.entries[0].debit`),original.choice.debit);
    }
  });
  await t.test('股市原交易报价恢复：超预留等待跨刷新保留，报价恢复后只确认原键和原股数',async()=>{
    await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','original reserved quote');
    const original=await evaluate(`${ledger}.pending`);
    await evaluate(`km.view.stocks[0].priceCents=2000;km.mode='success';${panel}.getElementById('stock-check').click();`);
    await drive(done,'quote increase waits');await reloadStock();await drive(done,'quote wait survives reload');
    assert.match(await evaluate(`${ledger}.note`),/超过原预留/);assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate(`${ledger}.pending.retries`),0);assert.deepEqual(await evaluate(`${ledger}.pending.input`),original.input);
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),original.choice.debit);
    await evaluate(`km.view.stocks[0].priceCents=1200;`);await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));
    await drive(`${ledger}.pending===null`,'quote restored confirms original');
    assert.equal(await evaluate('km.calls.length'),2);assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(original.key)}&&c.shares===${original.input.shares})`));
    assert.equal(await evaluate(`${ledger}.entries.length`),1);assert.equal(await evaluate(`${ledger}.hold`),false);
  });
  await t.test('股市原交易报价余量：价格或手续费上涨仍在原预留内时正常确认并记录实际成本',async()=>{
    for(const change of [`km.view.stocks[0].priceCents=1250`,`km.view.rules.buyFeePct=5`]){
      await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','original before affordable quote change');
      const original=await evaluate(`${ledger}.pending`);
      await evaluate(`${change};km.mode='success';${panel}.getElementById('stock-check').click();`);await pulse(31000);
      await drive(`${ledger}.pending===null`,'quote fits original reservation');
      assert.equal(await evaluate('km.calls.length'),2);assert.equal(await evaluate(`${ledger}.hold`),false);
      assert.ok(await evaluate(`${ledger}.entries[0].debit<=${original.choice.debit}`));
      assert.equal(await evaluate(`${ledger}.entries[0].debit`),10000-await evaluate('km.tokens'));
    }
  });
  await t.test('股市原交易排队报价：随机等待期间价格超预留，重读后不点击旧确认',async()=>{
    await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','original before queued quote change');
    await pulse(31000);await drive(`${panel}.getElementById('status').textContent.includes('核对同一笔股市原交易')`,'recovery queued');
    await evaluate(`km.view.stocks[0].priceCents=2000;km.mode='success';`);await drive(done,'queued quote rechecked');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    assert.match(await evaluate(`${ledger}.note`),/超过原预留/);
  });
  await t.test('股市原交易报价缺失：模型消失、改名、停牌或报价过期时保留原单，不借其他模型价格续发',async()=>{
    for(const change of [`km.view.stocks=[]`,`km.view.stocks[0].modelName='模型乙'`,`km.view.stocks[0].suspended=true`,`km.view.stocks[0].stale=true`]){
      await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','original before quote unavailable');
      const original=await evaluate(`${ledger}.pending`);
      await evaluate(`${change};km.mode='success';${panel}.getElementById('stock-check').click();`);await drive(done,'unavailable original quote waits');
      assert.equal(await evaluate('km.calls.length'),1,change);assert.equal(await evaluate(`${ledger}.pending.id`),original.id);
      assert.equal(await evaluate(`${ledger}.pending.retries`),0);assert.match(await evaluate(`${ledger}.note`),/报价无法核对/);
    }
  });
  await t.test('股市原交易报价迟到回执：当前报价超预留但原单成功回执到达，直接核对原成本不再续发',async()=>{
    await setupStock(`${settings}const originalFetch=window.fetch;
      window.fetch=(u,o)=>{const response=originalFetch(u,o);return u==='/api/stock'&&o?.method==='POST'?
        response.then(r=>new Promise(resolve=>{window.releaseStockReceipt=()=>resolve(r);})):response;};`);
    await drive('km.calls.length===1','old quote executed with held receipt');
    const tokens=await evaluate('km.tokens'),original=await evaluate(`${ledger}.pending`);
    await evaluate(`km.view.stocks[0].priceCents=2000;${panel}.getElementById('stock-check').click();`);
    await drive(done,'high quote waits before late receipt');assert.match(await evaluate(`${ledger}.note`),/超过原预留/);
    await evaluate('window.releaseStockReceipt();');await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'original receipt saved');
    await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));await drive(`${ledger}.pending===null`,'late receipt confirms original cost');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.tokens'),tokens);
    assert.equal(await evaluate(`${ledger}.entries[0].id`),original.id);assert.equal(await evaluate(`${ledger}.entries[0].debit`),10000-tokens);
    assert.equal(await evaluate(`${ledger}.hold`),false);
  });
  await t.test('股市原交易余额变化：保留线未变但其他消费减少余额，原买入和预测都不得动用保留款',async()=>{
    for(const seed of [settings,prediction]){
      await setupStock(`${seed}km.mode='deferred';`);await drive('km.calls.length===1','original request not executed');
      const original=await evaluate(`${ledger}.pending`);
      await evaluate(`km.tokens=${original.choice.estimate??original.choice.debit}+50;km.mode='success';
        ${panel}.getElementById('stock-check').click();`);
      const balance=await evaluate('km.tokens');await pulse(31000);await drive(done,'preserve reserve after other spending');
      assert.equal(await evaluate('km.calls.length'),1,original.input.action);
      assert.equal(await evaluate('km.tokens'),balance);assert.equal(await evaluate(`${ledger}.pending.id`),original.id);
      assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    }
  });
  await t.test('股市原交易排队余额：确认按钮随机等待期间余额减少，点击前重新读取并撤销续发',async()=>{
    await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','original before recovery queue');
    const original=await evaluate(`${ledger}.pending`);
    await pulse(31000);await drive(`${panel}.getElementById('status').textContent.includes('核对同一笔股市原交易')`,'original confirmation queued');
    const reads=await evaluate('km.reads');
    await evaluate(`km.tokens=${original.choice.estimate}+50;km.mode='success';`);
    await drive(done,'queued confirmation checks current balance');
    assert.equal(await evaluate('km.calls.length'),1);assert.ok(await evaluate('km.reads')>reads);
    assert.equal(await evaluate(`${ledger}.pending.id`),original.id);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    assert.match(await evaluate(`${ledger}.note`),/保留余额/);
  });
  await t.test('股市原交易额度：等待确认期间降低买入额度，不能用原请求继续扣款',async()=>{
    await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','original deferred buy');
    const pending=await evaluate(`${ledger}.pending`),tokens=await evaluate('km.tokens');
    await evaluate(`${panel}.getElementById('stock-trade-limit').value='0';${panel}.getElementById('stock-save').click();km.mode='success';`);
    await pulse(31000);await drive(done,'lowered limit respected by original confirmation');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.tokens'),tokens);
    assert.equal(await evaluate(`${ledger}.pending.id`),pending.id);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
  });
  await t.test('股市原交易额度：等待确认期间提高保留余额或改变固定单注，不按旧资金设置续发',async()=>{
    for(const [seed,id,value] of [[settings,'stock-reserve','10000'],[prediction,'stock-stake','50']]){
      await setupStock(`${seed}km.mode='deferred';`);await drive('km.calls.length===1','original deferred spending');
      const pending=await evaluate(`${ledger}.pending`),tokens=await evaluate('km.tokens');
      await evaluate(`${panel}.getElementById('${id}').value='${value}';${panel}.getElementById('stock-save').click();km.mode='success';`);
      await pulse(31000);await drive(done,'changed spending settings respected');
      assert.equal(await evaluate('km.calls.length'),1,id);assert.equal(await evaluate('km.tokens'),tokens,id);
      assert.equal(await evaluate(`${ledger}.pending.id`),pending.id,id);assert.equal(await evaluate(`${ledger}.pending.retries`),0,id);
    }
  });
  await t.test('股市原交易恢复：新资金条件跨刷新保留，恢复额度后只确认原请求且不重复预留',async()=>{
    await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','original before limit hold');
    const original=await evaluate(`${ledger}.pending`);
    await evaluate(`${panel}.getElementById('stock-trade-limit').value='0';${panel}.getElementById('stock-save').click();km.mode='success';`);
    await pulse(31000);await drive(done,'original waits under lower limit');
    await reloadStock();await drive(done,'lower limit survives reload');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending.reserveFloor`),undefined);
    assert.equal(await evaluate(`${ledger}.pending.retries`),0);assert.equal(await evaluate(`${ledger}.hold`),false);
    await evaluate(`${panel}.getElementById('stock-trade-limit').value='3000';${panel}.getElementById('stock-save').click();`);
    await drive(`${ledger}.pending===null`,'restored limit confirms original');
    assert.equal(await evaluate('km.calls.length'),2);assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(original.key)})`));
    assert.equal(await evaluate(`${ledger}.entries.length`),1);assert.equal(await evaluate(`${ledger}.entries[0].id`),original.id);
  });
  await t.test('股市原交易额度：提高保留余额但仍足够支付原预留时继续确认',async()=>{
    await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','original before affordable reserve change');
    const key=await evaluate(`${ledger}.pending.key`);
    await evaluate(`${panel}.getElementById('stock-reserve').value='500';${panel}.getElementById('stock-save').click();km.mode='success';`);
    await pulse(31000);await drive(`${ledger}.pending===null`,'affordable original proceeds');
    assert.equal(await evaluate('km.calls.length'),2);assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(key)})`));
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
  await t.test('股市原交易额度：降低预测总额后计入其他下注，不能只看原单注仍可容纳',async()=>{
    await setupStock(`${prediction}km.mode='deferred';
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,
        owned:{},pending:null,entries:[{id:'previous-bet',action:'predict',roundId:41,at:clock,debit:100,result:'success'}]}));`);
    await drive('km.calls.length===1','original prediction after other spend');
    await evaluate(`${panel}.getElementById('stock-prediction-limit').value='100';${panel}.getElementById('stock-save').click();km.mode='success';`);
    await pulse(31000);await drive(done,'lower prediction limit includes previous debit');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    assert.equal(await evaluate(`${ledger}.entries.length`),2);assert.match(await evaluate(`${ledger}.note`),/24小时额度/);
  });
  await t.test('股市原交易余额：丢失回执且余额不足时保留原单，余额恢复后只确认原键且不再次扣款',async()=>{
    await setupStock(`${settings}km.tokens=500;km.mode='lost';`);await drive('km.calls.length===1','tight original executed once');
    const original=await evaluate(`${ledger}.pending`),tokens=await evaluate('km.tokens');
    assert.ok(tokens-100<original.choice.debit);
    await reloadStock();await evaluate(`km.mode='success';`);
    await drive(done,'unknown original waits for current funding');
    assert.match(await evaluate(`${ledger}.note`),/保留余额/);assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    await evaluate(`km.tokens+=${original.choice.debit};`);
    await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));
    await drive(`${ledger}.pending===null`,'lost receipt under unchanged reserve reconciles');
    assert.equal(await evaluate('km.calls.length'),2);assert.equal(await evaluate('km.tokens'),tokens+original.choice.debit);
    assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(original.key)})`));
  });
  await t.test('股市原交易迟到回执：余额不足续发时仍接收成功回执，到期只读核对而不再扣款',async()=>{
    await setupStock(`${settings}km.tokens=500;const originalFetch=window.fetch;
      window.fetch=(u,o)=>{const response=originalFetch(u,o);return u==='/api/stock'&&o?.method==='POST'?
        response.then(r=>new Promise(resolve=>{window.releaseStockReceipt=()=>resolve(r);})):response;};`);
    await drive('km.calls.length===1','original executed before delayed receipt');
    const original=await evaluate(`${ledger}.pending`),tokens=await evaluate('km.tokens');
    await drive(done,'insufficient balance waits with original receipt pending');
    assert.match(await evaluate(`${ledger}.note`),/保留余额/);assert.equal(await evaluate(`${ledger}.pending.retries`),0);
    await evaluate('window.releaseStockReceipt();');
    await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'late bound receipt saved');
    await pulse(await evaluate(`${ledger}.nextAt-clock+1000`));await drive(`${ledger}.pending===null`,'late receipt reconciles without funds to resubmit');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.tokens'),tokens);
    assert.equal(await evaluate(`${ledger}.entries[0].id`),original.id);assert.equal(await evaluate(`${ledger}.hold`),false);
  });
  await t.test('股市原交易旧记录：缺少原保留线时按当前余额核对，手动确认仍可观察原结果',async()=>{
    await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','legacy original before migration');
    await evaluate(`const old=${ledger};delete old.pending.reserveFloor;localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(old));
      ${panel}.getElementById('stock-reserve').value='10000';${panel}.getElementById('stock-save').click();km.mode='success';`);
    await reloadStock();await drive(done,'legacy original cannot prove previous reserve');
    assert.match(await evaluate(`${ledger}.note`),/保留余额/);
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending.reserveFloor`),undefined);
    const key=await evaluate(`${ledger}.pending.key`);
    await evaluate(`void stockAct('buy',{modelName:'ignored',shares:1});`);
    await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'manual original receipt observed');
    await evaluate(`${panel}.getElementById('stock-check').click();`);await drive(`${ledger}.pending===null`,'manual receipt reconciled');
    assert.equal(await evaluate('km.calls.length'),2);assert.ok(await evaluate(`km.calls.every(c=>c.idempotencyKey===${JSON.stringify(key)})`));
  });
  await t.test('股市原交易校验：损坏的原保留线保留原文且不续发',async()=>{
    for(const value of [-1,1.5,'100',null,1000000000001]){
      await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','original before corrupt reserve snapshot');
      const raw=await evaluate(`(()=>{const l=${ledger};l.pending.reserveFloor=${JSON.stringify(value)};
        const raw=JSON.stringify(l);localStorage.setItem('arkengine:auto-stock:ledger:v1',raw);return raw;})()`);
      await reloadStock();await pulse(31000);await drive(done,'corrupt snapshot stops stock');
      assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),raw);
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
      await setupStock(`${settings}km.deferRead=true;km.mode='unknown';`);
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
  await t.test('股市跨页同步：提交前共享预算再次变化时撤销旧写入，保留最新支出并按预约自动恢复',async()=>{
    await setupStock(settings);
    await drive(`${panel}.getElementById('status').textContent.includes('秒后买入')`,'buy queued before latest budget write');
    await evaluate(`const uuid=crypto.randomUUID.bind(crypto);km.injected=false;
      crypto.randomUUID=()=>{if(!km.injected){km.injected=true;const current=${ledger};
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
    await evaluate(`const current=${ledger};current.entries[0].at=clock-25*3600000;
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(current));`);
    await pulse(300001);
    await drive('km.calls.length===1','fresh budget permits automatic revisit without settings intervention');
    await drive(`${ledger}.pending===null`,'resumed buy reconciled');
    assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate('km.calls[0].action'),'buy');
    assert.equal(await evaluate(`${ledger}.entries[0].id`),'latest-budget');
    assert.equal(await evaluate(`${ledger}.entries.length`),2);
  });
  await t.test('股市发送瞬间：总暂停通知尚未到达时仍阻止买入、卖出和预测',async()=>{
    for(const seed of [settings,`${settings}${owned}`,prediction]){
      await setupStock(`${seed}window.stockTransport=(u,o)=>{
        km.intercepted=true;km.originalPending=${ledger}.pending;
        localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');return fetch(u,o);};`);
      await drive('km.intercepted','pause immediately before native send');await pulse(1000);
      assert.deepEqual(await evaluate('km.calls'),[]);
      assert.equal(await evaluate(`${ledger}.pending.id`),await evaluate('km.originalPending.id'));
      assert.equal(await evaluate(`${ledger}.pending.key`),null);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
      assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/绑定失败/);
    }
  });
  await t.test('股市发送瞬间：原生按钮触发后额度或保留余额变化，不继续使用旧预留',async()=>{
    for(const [seed,change] of [[settings,'c.tradeLimit=0'],[prediction,'c.predictionLimit=0'],[settings,'c.reserve=10000']]){
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
    for(const [seed,change] of [[settings,`l.entries.push({id:'boundary-spend',action:'buy',at:clock,debit:3000,result:'success'})`],
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
      `localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},tradeLimit:0}))`]){
      await setupStock(`${settings}km.mode='deferred';window.stockTransport=(u,o)=>{
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
      km.view.rules.reserveTokens=1;`);
    await drive(done,'zero proceeds sale waits');assert.deepEqual(await evaluate('km.calls'),[]);
    assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/净到账.*0.*暂不卖出/);
    await reloadStock();await drive(done,'zero proceeds wait survives reload');assert.deepEqual(await evaluate('km.calls'),[]);
    await evaluate(`km.view.rules.reserveTokens=2;${panel}.getElementById('stock-check').click();`);
    await drive('km.calls.length===1','positive proceeds resumes');
    assert.equal(await evaluate('km.calls[0].action'),'sell');assert.equal(await evaluate('km.calls[0].shares'),4);
    assert.equal(await evaluate('km.tokens'),10001);
  });
  await t.test('股市请求边界：Request自带正文、错误地址或方法在发送前停止并保留原记录',async()=>{
    for(const transport of [
      `(u,o)=>fetch(new Request(new URL(u,location.href),o))`,
      `(u,o)=>fetch('/api/unexpected-stock',o)`,
      `(u,o)=>fetch('https://unexpected.invalid/api/stock',o)`,
      `(u,o)=>fetch(u,{...o,method:'PUT'})`
    ]){
      await setupStock(`${settings}km.forwarded=[];const prior=window.fetch;
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
      await setupStock(`${settings}window.stockTransport=${transport};`);await drive(done,'explicit body transport supported');
      assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`${ledger}.pending`),null);
      assert.equal(await evaluate(`${ledger}.entries[0].result`),'success');
    }
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
    await setupStock(`${settings}km.mode='unknown';const clone=Request.prototype.clone;
      Request.prototype.clone=function(){const copy=clone.call(this),json=copy.json.bind(copy);
        copy.json=()=>new Promise((resolve,reject)=>json().then(body=>{km.releaseObservedBody=()=>resolve(body);},reject));return copy;};`);
    await drive('km.calls.length===1','original request bound');
    await evaluate(`km.mode='success';window.stockTransport=(u,o)=>fetch(new Request(new URL(u,location.href),o));
      void stockAct('buy',{modelName:'ignored',shares:1});`);
    await until(()=>evaluate(`km.calls.length===2&&!km.busy&&!!km.releaseObservedBody`),'native request finished before observation');
    assert.equal(await evaluate("sessionStorage.getItem('stock:request:77')"),null);
    await evaluate('km.releaseObservedBody();');
    await until(()=>evaluate(`${ledger}.pending?.result==='success'||${ledger}.entries[0].result==='success'`),'delayed original proof');
    await drive(done,'matched receipt reconciled');assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate('new Set(km.calls.map(c=>c.idempotencyKey)).size'),1);
  });
  await t.test('股市：默认关闭不干预手动页面，零额度检查不花费且返回远征',async()=>{
    await setupStock();await pulse(10000);assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate('location.pathname'),'/stock');assert.equal(await evaluate('km.reads'),0);
    await setupStock(`${settings}localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},tradeLimit:0}));`);
    await drive(done,'zero budget');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市：自动择股买入，记录实际含费成本，持有期内不卖或重复买',async()=>{
    await setupStock(settings);await drive(done,'buy then return');
    const calls=await evaluate('km.calls'),l=await evaluate(ledger);assert.equal(calls.length,1);assert.equal(calls[0].action,'buy');
    assert.equal(l.pending,null);assert.equal(l.entries[0].result,'success');assert.ok(l.entries[0].debit<=1000);
    assert.equal(l.owned['1'].cost,await evaluate('km.view.positions[0].costBasisTokens'));
    assert.equal(l.owned['1'].shares,calls[0].shares);
  });
  await t.test('股市等待诊断：额度、保留余额和人工持仓成本分别显示原因，正常等待不永久停止',async()=>{
    for(const [seed,reason] of [
      [`localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},tradeLimit:0}));`,'未设置股票额度'],
      [`km.tokens=100;`,'可用余额已到保留线'],
      [`km.view.positions=[{stockId:1,shares:10,costBasisTokens:3000}];`,'当前持仓成本已达设置上限']]){
      await setupStock(`${settings}${seed}`);await drive(done,'explicit normal stock wait');
      assert.ok((await evaluate(`${panel}.getElementById('stock-status').textContent`)).includes(reason));
      assert.equal(await evaluate(`${ledger}.hold`),false);assert.ok(await evaluate(`${ledger}.nextAt>clock`));
      assert.deepEqual(await evaluate('km.calls'),[]);
    }
  });
  await t.test('股市等待诊断：预测显示足够一注的额度恢复时间，刷新保留预算，到期后按原规则恢复',async()=>{
    await setupStock(`${prediction}
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,owned:{},pending:null,
        entries:[{id:'part-a',action:'predict',roundId:80,betId:80,at:clock-23*3600000,debit:40,result:'success'},
          {id:'part-b',action:'predict',roundId:81,betId:81,at:clock-3*86400000,confirmedAt:clock-22*3600000,debit:60,result:'success'},
          {id:'recent',action:'predict',roundId:82,betId:82,at:clock-3600000,debit:400,result:'success'}]}));`);
    await drive(done,'prediction waits for sufficient released budget');
    assert.match(await evaluate(`${ledger}.note`),/约120分钟后可容纳一注/);
    const original=await evaluate(`${ledger}.entries`);await reloadStock();await drive(done,'budget wait survives reload');
    assert.deepEqual(await evaluate(`${ledger}.entries`),original);assert.deepEqual(await evaluate('km.calls'),[]);
    const reads=await evaluate('km.reads');await pulse(3600000);
    await drive(`km.reads>${reads}`,'partial budget expiry reread');await drive(done,'partial release still insufficient');
    assert.deepEqual(await evaluate('km.calls'),[]);assert.equal(await evaluate(`${ledger}.hold`),false);
    await evaluate(`km.view.rounds[0].lockAt=new Date(clock+7200000).toISOString();km.view.rounds[0].closeAt=new Date(clock+9000000).toISOString();`);
    await pulse(3600000);
    await evaluate(`km.view.ticks.forEach((x,i)=>x.createdAt=new Date(clock-(5-i)*300000).toISOString());`);
    await drive('km.calls.length===1','sufficient budget resumes normal prediction');await drive(done,'resumed prediction confirmed');
    assert.equal(await evaluate(`${ledger}.entries.length`),4);assert.equal(await evaluate(`${ledger}.entries.at(-1).debit`),100);
    assert.equal(await evaluate(`${ledger}.pending`),null);assert.equal(await evaluate(`${ledger}.hold`),false);
  });
  await t.test('股市：余额含小数仍能买入，只使用向下取整后的整币额度',async()=>{
    await setupStock(`${settings}km.tokens=10000.75;`);await drive(done,'fractional balance accepted');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.calls[0].action'),'buy');
    assert.equal(await evaluate('km.tokens%1'),.75);
  });
  await t.test('股市同步恢复：买入成功但持仓迟到超过30秒，恢复后解除数据等待且不重复买入',async()=>{
    await setupStock(`${settings}km.hidePositions=true;`);
    await drive('km.calls.length===1','buy sent before positions update');await pulse(31000);
    await drive(done,'late positions yields to expedition');assert.ok(await evaluate(`${ledger}.pending`));
    await evaluate(`km.hidePositions=false;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.pending===null`,'positions recovered');await drive(done,'resume regular stock schedule');
    assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate(`${ledger}.owned['1'].shares`),await evaluate('km.view.positions[0].shares'));
  });
  await t.test('股市成本恢复：新买入份额已到但成本为0时保留预算，刷新后等真实成本且不重复买入',async()=>{
    await setupStock(`${settings}km.zeroCosts=true;`);
    await drive('km.calls.length===1','buy sent before valid cost');
    const reserved=await evaluate(`${ledger}.entries[0].debit`);assert.ok(reserved>0);
    await pulse(31000);await drive(done,'zero buy cost yields without confirming free purchase');
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),reserved,'未核实实际成本前不能把预留预算清零');
    assert.ok(await evaluate(`${ledger}.pending`),'新买入成本0不能当作已核对真实花费');
    assert.equal(await evaluate(`${ledger}.owned['1']`),undefined);
    assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/成本为0/);
    assert.equal(await evaluate(`${ledger}.hold`),false);
    await reloadStock();await drive(done,'zero cost reservation survives refresh');
    assert.ok(await evaluate(`${ledger}.pending`));assert.equal(await evaluate(`${ledger}.entries[0].debit`),reserved);
    assert.equal(await evaluate('km.calls.length'),1);
    await evaluate(`km.zeroCosts=false;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.pending===null`,'positive cost reconciled');await drive(done,'regular stock schedule resumes');
    const cost=await evaluate('km.view.positions[0].costBasisTokens');assert.ok(cost>0);
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),cost);assert.equal(await evaluate(`${ledger}.owned['1'].cost`),cost);
    assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('股市等待迁移：旧版仅因持仓迟到的停止可在核对后解除，其他停止原因保留',async()=>{
    for(const [note,held]of [['交易已执行，但持仓成本或数量尚未对应，保留原记录',false],['实际买入超过预留金额，已停止后续自动交易',true]]){
      await setupStock(`${settings}km.hidePositions=true;`);await drive('km.calls.length===1','original successful buy');await pulse(31000);
      await drive(done,'wait preserved');
      await evaluate(`const l=${ledger};l.hold=true;l.note=${JSON.stringify(note)};localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));km.hidePositions=false;`);
      await reloadStock();await drive(`${ledger}.pending===null`,'original position now proved');await drive(done,'migration checked');
      assert.equal(await evaluate(`${ledger}.hold`),held);assert.equal(await evaluate('km.calls.length'),1);
      if(held)assert.match(await evaluate(`${ledger}.note`),/超过预留/);
    }
  });
  await t.test('股市等待迁移：旧停止跨多轮迟到、读取失败与保存设置后仍保留原原因，核对后恢复',async()=>{
    for(const mode of ['late','read-error','settings']){
      await setupStock(`${settings}km.hidePositions=true;`);await drive('km.calls.length===1','original successful buy');await pulse(31000);
      await drive(done,'original position pending');
      await evaluate(`const l=${ledger};l.hold=true;delete l.holdReason;l.note='交易已执行，但持仓成本或数量尚未对应，保留原记录';
        localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));km.readError=${mode==='read-error'};`);
      await reloadStock();
      if(mode==='settings')await evaluate(`${panel}.getElementById('stock-save').click();`);
      await drive(done,'original reason survives another wait');assert.equal(await evaluate(`${ledger}.hold`),true);
      assert.equal(await evaluate(`${ledger}.holdReason`),'交易已执行，但持仓成本或数量尚未对应，保留原记录');
      assert.match(await evaluate(`${panel}.getElementById('stock-status').textContent`),/停止原因：交易已执行/);
      assert.ok(await evaluate(`${ledger}.pending`));assert.equal(await evaluate('km.calls.length'),1);
      await evaluate(`km.readError=false;km.hidePositions=false;${panel}.getElementById('stock-check').click();`);
      await drive(`${ledger}.pending===null`,'position finally consistent');await drive(done,'migration completes after delay');
      assert.equal(await evaluate(`${ledger}.hold`),false);assert.equal(await evaluate('km.calls.length'),1);
    }
  });
  await t.test('股市：远征空闲自动访问，结束后保留五分钟预约',async()=>{
    await setupStock(settings,'/activities/expedition');await drive('km.calls.length===1','expedition visits stock');
    await drive(done,'stock returns');assert.ok(await evaluate(`${ledger}.nextAt>clock`));
    await pulse(10000);assert.equal(await evaluate('location.pathname'),'/activities/expedition');
  });
  await t.test('股市迟到成交：原请求隔天或一周后才执行，仍计入当前24小时预算且不被七天清理',async()=>{
    for(const days of [2,8]){
      await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','deferred buy has no outcome');
      assert.equal(await evaluate('km.view.positions.length'),0);await pulse(days*86400000);
      await drive(done,'old request yields');
      await evaluate(`km.mode='success';stockAct('buy',{modelName:'ignored',shares:99});`);
      await until(()=>evaluate(`${ledger}.pending?.result==='success'`),'late original success');
      await evaluate(`${panel}.getElementById('stock-check').click();`);
      await drive(`${ledger}.pending===null`,'late original reconciled');await drive(done,'late original returns');
      const l=await evaluate(ledger),cost=await evaluate('km.view.positions[0].costBasisTokens');
      assert.equal(l.entries.length,1);assert.equal(l.entries[0].debit,cost);assert.ok(l.entries[0].confirmedAt>=l.entries[0].at+days*86400000);
      assert.ok(await evaluate(`${panel}.getElementById('stock-status').textContent.includes('24小时买入 '+${cost}+'/3000')`));
      assert.equal(await evaluate('km.calls.length'),2);assert.equal(await evaluate('new Set(km.calls.map(c=>c.idempotencyKey)).size'),1);
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
  await t.test('股市：三只旧持仓交回人工后仍能选择新的自动持仓',async()=>{
    await setupStock(`${settings}${owned}km.view.positions=[];
      const seed=km.view.stocks[0],ticks=km.view.ticks;km.view.stocks=[1,2,3,4].map(id=>({...seed,id,modelName:'模型'+id}));
      km.view.ticks=km.view.stocks.flatMap(s=>ticks.map(t=>({...t,stockId:s.id})));
      const ledger=JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'));
      ledger.owned=Object.fromEntries([1,2,3].map(id=>[id,{shares:10,cost:100,manual:true,modelName:'模型'+id}]));
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(ledger));`);
    await drive(done,'released automatic position slots');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('km.calls[0].modelName'),'模型4');
    assert.equal(await evaluate(`${ledger}.owned['4'].manual`),false);
  });
  await t.test('股市：预测固定单注且同轮不重复，刷新保留独立额度',async()=>{
    await setupStock(prediction);await drive(done,'predict once');
    const calls=await evaluate('km.calls');assert.equal(calls.length,1);assert.equal(calls[0].action,'predict');assert.equal(calls[0].direction,'up');assert.equal(calls[0].betTokens,100);
    await reloadStock();await drive(done,'reload prediction ledger');assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),100);
  });
  await t.test('股市预测核验：成功响应先到但下注列表迟到时，保留对应记录并在恢复后绑定结算',async()=>{
    await setupStock(`${prediction}km.hideBets=true;`);
    await drive('km.calls.length===1','prediction submitted');await pulse(6000);
    assert.equal(await evaluate(`${ledger}.pending?.result`),'success');assert.equal(await evaluate(`${ledger}.entries[0].betId`),undefined);
    await pulse(31000);await drive(done,'wait for late bet without occupying expedition');
    assert.equal(await evaluate('km.calls.length'),1);assert.ok(await evaluate(`${ledger}.pending`));
    await evaluate(`km.hideBets=false;${panel}.getElementById('stock-check').click();`);
    await drive(`${ledger}.pending===null`,'late bet bound');
    assert.equal(await evaluate(`${ledger}.entries[0].betId`),1);assert.equal(await evaluate('km.calls.length'),1);
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
  await t.test('股市：预测下跌方向、已下注轮次、临近锁盘和重复卡片保护',async()=>{
    await setupStock(`${prediction}km.view.ticks.forEach((t,i)=>t.priceCents=1400-i*40);`);
    await drive(done,'down prediction');assert.equal(await evaluate('km.calls[0]?.direction'),'down');
    await setupStock(`${prediction}km.view.myBets=[{id:9,roundId:42,betTokens:10,direction:'up',settled:false}];`);
    await drive(done,'manual bet already exists');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(`${prediction}km.view.rounds[0].lockAt=new Date(clock+59000).toISOString();`);
    await drive(done,'near lock');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(`${prediction}km.view.rounds.push({...km.view.rounds[0],id:43});`);
    await drive(done,'duplicate round display');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市：成交回执丢失仅确认同一个请求，刷新后不再扣款',async()=>{
    await setupStock(`${settings}km.mode='lost';`);await drive('km.calls.length===1','lost receipt');
    const key=await evaluate('km.calls[0].idempotencyKey');await reloadStock();await evaluate(`km.mode='success'`);
    await drive(done,'same intent confirmed',180);const calls=await evaluate('km.calls');
    assert.equal(calls.length,2);assert.ok(calls.every(c=>c.idempotencyKey===key));assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate('km.view.positions.length'),1);assert.equal(await evaluate('km.view.positions[0].shares'),calls[0].shares);
  });
  await t.test('股市：HTTP成功但错账号不算确认，两次核对仍未知后隔离股市',async()=>{
    await setupStock(`${settings}km.mode='wrong-user';`);await drive('km.calls.length===1','wrong receipt');
    await pulse(31000);await drive('km.calls.length===2','first same recovery');await pulse(31000);await drive(done,'pending yields to expedition');
    await pulse(121000);await evaluate(`${panel}.getElementById('stock-check').click();`);await drive('km.calls.length===3','second same recovery');
    await pulse(61000);await drive(done,'second pending yields');await pulse(121000);await evaluate(`${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'final original check');await drive(done,'unknown isolated');assert.equal(await evaluate(`${ledger}.pending.retries`),2);
    assert.equal(await evaluate(`${ledger}.hold`),true);assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('股市：明确拒绝释放预算且不反复尝试，幂等冲突保留原记录',async()=>{
    await setupStock(`${settings}km.mode='rejected';`);await drive(done,'rejection');
    assert.equal(await evaluate(`${ledger}.pending`),null);assert.equal(await evaluate(`${ledger}.entries[0].result`),'rejected');assert.equal(await evaluate('km.calls.length'),1);
    await setupStock(`${settings}km.mode='conflict';`);await drive('km.calls.length===1','conflict');
    assert.equal(await evaluate(`${ledger}.pending.result`),null);
  });
  await t.test('股市：已有手动原请求不接管，不覆盖或创建新交易',async()=>{
    await setupStock(`${settings}sessionStorage.setItem('stock:request:77',JSON.stringify({idempotencyKey:'manual-original',input:{modelName:'模型甲',shares:1,action:'buy',expectedUserId:77}}));`);
    await drive(done,'manual request');assert.equal(await evaluate('km.calls.length'),0);
    assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('stock:request:77')).idempotencyKey`),'manual-original');
  });
  await t.test('股市：等待下单期间暂停、行情变化或跨页撤销点击',async()=>{
    const queued=`${panel}.getElementById('status').textContent.includes('秒后买入')`;
    await setupStock(settings);await drive(queued,'buy queued');await evaluate(`${panel}.getElementById('toggle').click()`);await pulse(10000);
    assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(settings);await drive(queued,'buy queued again');await evaluate('km.view.stocks[0].suspended=true;renderStock();');await drive(done,'suspended');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(settings);await drive(queued,'buy queued before navigate');await evaluate(`navFarm('/activities/expedition')`);await pulse(1000);assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市：存储损坏保留原文，账本写入失败不得发送交易',async()=>{
    await setupStock(`${settings}localStorage.setItem('arkengine:auto-stock:ledger:v1','broken-json');`);await drive(done,'corrupt ledger isolated');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),'broken-json');
    await setupStock(`${settings}const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='arkengine:auto-stock:ledger:v1')throw Error('quota');return originalSet.call(this,k,v);};`);
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
    await setupStock(`${settings}km.mode='deferred';`);await drive('km.calls.length===1','saved original request');
    await evaluate(`const l=${ledger};l.pending.confirmedAt='invalid';localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(l));`);
    const original=await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`);
    await reloadStock();await drive(done,'corrupt pending time isolated');
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),original);
  });
  await t.test('股市：实际成交超过预留则停止后续交易，不能把报价当作到账',async()=>{
    await setupStock(`${settings}km.fillPrice=1800;`);await drive(done,'price slipped');
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
  await t.test('股市：买卖和预测同时开启分别计额，卖出后不立即回买',async()=>{
    await setupStock(`${prediction}localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...${cfg},trade:true,predict:true}));`);
    await drive(done,'both paths');assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['predict','buy']);
    assert.equal(await evaluate(`${ledger}.entries.filter(e=>e.action==='predict').reduce((n,e)=>n+e.debit,0)`),100);
    await setupStock(`${settings}${owned}`);await drive(done,'sell then cooldown');assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell']);
  });
  await t.test('股市：等待期间降低资金上限或关闭预测，立即撤销尚未发送的操作',async()=>{
    await setupStock(settings);await drive(`${panel}.getElementById('status').textContent.includes('秒后买入')`,'limit queued');
    await evaluate(`${panel}.getElementById('stock-trade-limit').value='0';${panel}.getElementById('stock-save').click();`);
    await drive(done,'budget lowered');assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(prediction);await drive(`${panel}.getElementById('status').textContent.includes('秒后预测')`,'prediction queued');
    await evaluate(`${panel}.getElementById('stock-predict').checked=false;${panel}.getElementById('stock-save').click();`);
    await drive(done,'prediction off');assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('股市：手动确认脚本原请求能核对回执，手动新交易转交持仓',async()=>{
    await setupStock(`${settings}km.mode='lost';`);await drive('km.calls.length===1','pending original');
    await evaluate(`km.mode='success';stockAct('buy',{modelName:'ignored',shares:99});`);
    await drive(done,'manual confirms same original');assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.equal(await evaluate('new Set(km.calls.map(c=>c.idempotencyKey)).size'),1);
    await setupStock(`${settings}${owned}localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);
    await evaluate(`stockAct('buy',{modelName:'模型甲',shares:1});`);
    await until(()=>evaluate('km.calls.length===1 && !km.busy'),'manual buy');assert.equal(await evaluate(`${ledger}.owned['1'].manual`),true);
  });
  await t.test('股市：原请求绑定保存失败阻止发送，原生已有请求不被覆盖',async()=>{
    await setupStock(`${settings}const save=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
      if(k==='arkengine:auto-stock:ledger:v1' && JSON.parse(v).pending?.key)throw Error('fixture bind quota');return save.call(this,k,v);};`);
    await drive(done,'bind failure');assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending.key`),null);
    assert.ok(await evaluate(`sessionStorage.getItem('stock:request:77')`));
  });
  await t.test('股市：双标签共用锁，接力页缺少原请求时不重建订单',async()=>{
    await setupStock(`${settings}km.mode='lost';`);await drive('km.calls.length===1','first tab submitted');
    const second=await secondStock();
    try {
      await second.pulse(5000);assert.equal(await second.evaluate('km.calls.length'),0);
      await evaluate(`history.pushState({},'','/outside');window.dispatchEvent(new Event('popstate'));`);
      for(let i=0;i<12;i++)await second.pulse(1000);
      assert.equal(await second.evaluate('km.calls.length'),0);assert.equal(await second.evaluate(`${ledger}.hold`),true);
      assert.ok(await second.evaluate(`${ledger}.pending.key`));
    }finally{await second.close();}
  });
  await t.test('股市冻结接力：真实冻结释放运行锁，新页继续工作，旧页恢复不重复买入',async()=>{
    await setupStock(`${settings}
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
    assert.equal(await evaluate(`${ledger}.owned['1'].manual`),false);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),null);
  });
  await t.test('股市冻结原请求：接力页不重建未知交易，原页恢复后确认同一笔并解除页面缺失等待',async()=>{
    for(const returned of [false,true]){
    await setupStock(`${settings}km.mode='lost';
      document.addEventListener('freeze',()=>localStorage.setItem('fixture:stock-frozen','true'));
      document.addEventListener('resume',()=>{clock+=2*3600000;km.mode='success';
        if(location.pathname==='/stock')renderStock();else renderExp();});`);
    await drive('km.calls.length===1','original stock order sent before freeze');
    const pending=await evaluate(`${ledger}.pending`);assert.ok(pending.key);
    const afterBuy=await evaluate('km.tokens');
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
    assert.equal(await evaluate('km.tokens'),afterBuy);assert.equal(await evaluate(`${ledger}.entries.length`),1);
    assert.equal(await evaluate(`${ledger}.hold`),false,'a verified original receipt resolves the missing-page stop');
    }
  });
  await t.test('股市冻结暂停：冻结期间另一页关闭总开关，恢复和再次唤醒都不自动开启',async()=>{
    await setupStock(`${settings}
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
    await setupStock(prediction);await drive(done,'bet confirmed');
    await evaluate(`km.view.myBets[0].settled=true;km.view.myBets[0].payoutTokens=180;km.tokens+=180;
      ${panel}.getElementById('stock-check').click();`);
    await drive(`location.pathname==='/stock'`,'settlement visit');await drive(done,'settlement reconciled');
    assert.equal(await evaluate(`${ledger}.entries[0].settlement.payout`),180);assert.equal(await evaluate(`${ledger}.entries[0].debit`),100);
    assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('股市账本容量：用完最后一条后暂停新交易，到期清理后自动恢复且保留当前预算',async()=>{
    await setupStock(`${prediction}
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'fixture',hold:false,owned:{},pending:null,
        entries:Array.from({length:1999},(_,i)=>({id:'old-rejected-'+i,action:'predict',roundId:10000+i,
          at:clock-7*86400000+120000,debit:100,result:'rejected'}))}));`);
    await drive(done,'last ledger slot used');
    assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate(`${ledger}.entries.length`),2000);
    assert.equal(await evaluate(`${ledger}.pending`),null);
    await evaluate(`km.view.rounds[0]={...km.view.rounds[0],id:43,lockAt:new Date(clock+900000).toISOString(),closeAt:new Date(clock+1800000).toISOString()};`);
    await pulse(300001);
    await drive('km.calls.length===2','expired terminal entries release capacity without settings click');
    await drive(done,'new prediction reconciled');
    assert.deepEqual(await evaluate(`${ledger}.entries.map(e=>e.roundId)`),[42,43]);
    assert.equal(await evaluate(`${ledger}.entries.reduce((sum,e)=>sum+e.debit,0)`),200);
    assert.equal(await evaluate(`${ledger}.hold`),false);
    await reloadStock();await drive(done,'recovered ledger survives reload');
    assert.equal(await evaluate('km.calls.length'),2);
    assert.equal(await evaluate(`${ledger}.entries.length`),2);
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
    assert.equal(await evaluate(`${ledger}.hold`),false);
    await reloadStock();await drive(done,'capacity wait survives reload');
    await evaluate(`km.view.myBets=[{id:10000,roundId:10000,betTokens:100,direction:'up',settled:true,payoutTokens:180}];`);
    await pulse(300001);await drive(`${ledger}.entries.some(e=>e.settlement?.payout===180)`,'settlement read at capacity');
    await drive(done,'settlement persisted without spending');
    assert.deepEqual(await evaluate('km.calls'),[]);
    await evaluate(`km.view.rounds=[{id:42,stockId:1,ruleVersion:2,oddsBp:180,
      lockAt:new Date(clock+900000).toISOString(),closeAt:new Date(clock+1800000).toISOString()}];
      km.view.ticks.forEach((x,i)=>x.createdAt=new Date(clock-(5-i)*300000).toISOString());`);
    await pulse(300001);await drive('km.calls.length===1','terminal slot released after settlement');await drive(done,'capacity full again');
    assert.equal(await evaluate(`${ledger}.entries.length`),2000);
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
    await setupStock(prediction);await drive(done,'bet confirmed before settlement storage failure');
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
    assert.equal(await evaluate('km.calls.length'),1);
    assert.equal(await evaluate(`${events}.counts['stock-prediction-settled']`),1,'刷新不能重复记同一结算');
    assert.deepEqual(await evaluate(`${events}.events.find(e=>e.type==='stock-prediction-settled').data`),{stake:100,payout:180,net:80});
    assert.equal(firstCount,0,'账本写入成功前不记录结算已完成');
    assert.deepEqual(await evaluate(`${events}.totals`),{},'返还不是本组毛收入');
  });
  await t.test('股市：真实键盘操作、手动弹窗与离线不会继续排队下单',async()=>{
    await setupStock(settings);await drive(`${panel}.getElementById('status').textContent.includes('秒后买入')`,'keyboard queued');
    await trustedStaffKey();await pulse(10000);assert.equal(await evaluate('km.calls.length'),0);
    await setupStock(`${settings}const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.textContent='确认兑换历史仓';document.body.append(dialog);`);
    await pulse(10000);assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate('location.pathname'),'/stock');
    await setupStock(`${settings}Object.defineProperty(navigator,'onLine',{get:()=>false});`);await drive(done,'offline skipped');assert.equal(await evaluate('km.calls.length'),0);
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
