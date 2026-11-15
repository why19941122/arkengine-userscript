import assert from 'node:assert/strict';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
import {stockOwnedPosition} from './arkengine-stock.fixture.mjs';
import {stockHistoricalRequest} from './arkengine-stock-history.fixture.mjs';

export async function enabledDefaultsTests({t,setupShelter,reloadShelter,setupStock,reloadStock,evaluate,pulse,drive,secondStock}){
  const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
  const marker=scope=>`arkengine:auto-defaults:${scope}:v1`;
  const stockKey='arkengine:auto-stock:config:v1',campaignKey='arkengine:auto-shelter:campaign:v1';
  const constructionKey='arkengine:auto-shelter:construction:v1',ledgerKey='arkengine:auto-stock:ledger:v1';
  const read=key=>evaluate(`JSON.parse(localStorage.getItem('${key}'))`);
  const fresh=`for(const key of Object.keys(localStorage))if(key.startsWith('arkengine:auto-shelter:')||key.startsWith('arkengine:auto-stock:')||key.startsWith('arkengine:auto-defaults:'))localStorage.removeItem(key);`;
  const paused=`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`;
  const activate=scope=>`localStorage.removeItem('${marker(scope)}');`;
  const click=id=>evaluate(`${panel}.getElementById('${id}').click();`);
  const stockDefault={trade:true,predict:false,observeOnly:false,tradeLimit:400000,predictionLimit:0,stake:0,reserve:1000,
    netEfficiency:true,autoBudget:true,riskLimit:400000,positionLimit:400000,lossLimit:100000};
  const constructionDefault={build:true,upgrade:true,dig:true,budgetMode:'stock',scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0};

  await t.test('默认启用：全新安装自动配齐股市及避难所，保留总暂停且无需点击推荐',async()=>{
    await setupShelter(fresh+paused);await pulse(10000);
    assert.deepEqual(await read(stockKey),stockDefault);
    assert.deepEqual(await read(constructionKey),constructionDefault);
    const campaign=await read(campaignKey);
    for(const key of ['explore','quests','training','medical','radio','combatGear','defense','dailyGoals','help','craftDaily','sodaEfficiency'])assert.equal(campaign[key],true,key);
    assert.equal(campaign.caravanDaily,false,'材料不换代币');
    for(const key of ['enabled','gear','optimize','explore-claim','population-continuous'])
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:${key}:v1')`),'true',key);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:staff:v1')`),'population');
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:level-target:v1')`),'auto');
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:population:v1')`),'30');
    assert.equal(await evaluate(`${panel}.getElementById('shelter-campaign-defense').checked`),true);
    assert.equal(await evaluate(`${panel}.getElementById('stock-trade').checked`),true);
    assert.equal(await evaluate('sm.reads'),0);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('默认启用：旧全零关闭模板升级后获得有效额度，保存数字和账本不被重置',async()=>{
    const config={trade:false,predict:false,tradeLimit:0,predictionLimit:0,stake:0,reserve:0};
    const construction={build:false,upgrade:false,dig:false,scrapLimit:0,partsLimit:0,scrapReserve:0,partsReserve:0};
    const saved={nextAt:12345,note:'保留原预约',constructionLedger:[{id:'original',at:1,scrap:300,parts:5}]};
    await setupShelter(fresh+paused+`localStorage.setItem('${stockKey}',JSON.stringify(${JSON.stringify(config)}));
      localStorage.setItem('${constructionKey}',JSON.stringify(${JSON.stringify(construction)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(${JSON.stringify(saved)}));`);
    assert.deepEqual(await read(stockKey),stockDefault);assert.deepEqual(await read(constructionKey),constructionDefault);
    assert.deepEqual(await read('arkengine:auto-shelter:schedule:v1'),saved);
  });
  await t.test('默认启用：保留自定零额度和更严限制，超出四十万本金及十万亏损的配置收紧',async()=>{
    const config={trade:false,predict:true,observeOnly:true,tradeLimit:9000,predictionLimit:700,stake:50,reserve:2500,
      dailyBuyLimit:0,perStockLimit:8000,riskLimit:900000,positionLimit:500000,lossLimit:200000};
    const construction={build:false,upgrade:false,dig:false,scrapLimit:0,partsLimit:12,scrapReserve:240,partsReserve:10};
    const saved={version:1,userId:77,nextAt:22222,note:'人工核对',hold:true,holdReason:'旧卖出到账未知',pending:null,
      owned:{'1':{shares:10,cost:800,modelName:'模型甲',manual:false}},entries:[{id:'prior',action:'buy',at:1,debit:800,result:'success'}]};
    await setupShelter(fresh+paused+`localStorage.setItem('${stockKey}',JSON.stringify(${JSON.stringify(config)}));
      localStorage.setItem('${constructionKey}',JSON.stringify(${JSON.stringify(construction)}));
      localStorage.setItem('${ledgerKey}',JSON.stringify(${JSON.stringify(saved)}));`);
    assert.deepEqual(await read(stockKey),{...config,trade:true,predict:false,observeOnly:false,autoBudget:true,netEfficiency:true,
      riskLimit:400000,positionLimit:400000,lossLimit:100000});
    assert.deepEqual(await read(constructionKey),{...construction,budgetMode:'daily'});
    assert.deepEqual(await read(ledgerKey),saved);
    await evaluate(`const c=JSON.parse(localStorage.getItem('${stockKey}'));c.riskLimit=0;c.positionLimit=2000;c.lossLimit=500;
      localStorage.setItem('${stockKey}',JSON.stringify(c));${activate('stock')}`);
    await reloadShelter();const tighter=await read(stockKey);
    assert.equal(tighter.riskLimit,0);assert.equal(tighter.positionLimit,2000);assert.equal(tighter.lossLimit,500);
  });
  await t.test('默认启用：应用后手动暂停与单项关闭跨刷新保留',async()=>{
    await setupShelter(fresh+paused);await click('stock-pause');await click('shelter-toggle');
    await evaluate(`${panel}.getElementById('shelter-campaign-defense').checked=false;${panel}.getElementById('shelter-campaign-save').click();`);
    await reloadShelter();await pulse(10000);
    assert.equal((await read(stockKey)).trade,false);assert.equal((await read(campaignKey)).defense,false);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'false');
    assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('默认启用：账户停止和损坏配置不被开启或覆盖，刷新不重新迁移',async()=>{
    await setupStock(fresh+paused+`localStorage.setItem('arkengine:auto:account-stop:v1','fixture owner stop');`);
    assert.equal(await read(stockKey),null);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`),'fixture owner stop');
    await reloadStock();assert.deepEqual(await evaluate('km.calls'),[]);assert.equal(await read(stockKey),null);
    await setupStock(fresh+paused+`localStorage.setItem('${stockKey}','{broken');`);
    assert.equal(await evaluate(`localStorage.getItem('${stockKey}')`),'{broken');
    assert.deepEqual(await evaluate('km.calls'),[]);
  });
  await t.test('默认启用：存储中途失败时避难所暂停，刷新不重复启用或清原记录',async()=>{
    await setupShelter(fresh+paused+`const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){if(k==='${constructionKey}')throw Error('fixture quota');return set.call(this,k,v);};`);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'false');
    assert.equal(await evaluate(`localStorage.getItem('${marker('shelter')}')`),'failed');
    await reloadShelter();assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'false');
    assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('默认启用：股市配置写入失败不交易，刷新后不自动重试启用',async()=>{
    await setupStock(activate('stock')+`const set=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){if(k==='${stockKey}')throw Error('fixture quota');return set.call(this,k,v);};`);
    await pulse(10000);assert.equal(await read(stockKey),null);assert.deepEqual(await evaluate('km.calls'),[]);
    assert.equal(await evaluate(`localStorage.getItem('${marker('stock')}')`),'failed');
    await reloadStock();await pulse(10000);assert.equal(await read(stockKey),null);assert.deepEqual(await evaluate('km.calls'),[]);
  });
  await t.test('默认启用：无需推荐按钮实际执行避难所探险，不消费汽水或交付商队',async()=>{
    await setupShelter(activate('shelter')+`sm.view=${JSON.stringify(campaignView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;`);
    await drive(`sm.calls.some(c=>c.type==='explore_start')`,'startup default shelter departure');
    assert.ok(await evaluate(`sm.calls.every(c=>c.type!=='caravan')`));
    assert.ok(await evaluate(`sm.calls.filter(c=>c.type==='explore_start').every(c=>c.stimpaks===2&&!c.abyss)`));
    assert.equal((await read(campaignKey)).caravanDaily,false);
  });
  await t.test('默认启用：避难所旧未知探险跨升级保留原请求，不再派人',async()=>{
    await setupShelter(activate('shelter')+`sm.view=${JSON.stringify(campaignView())};
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      const beforeDeparture=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter/action'&&options?.method==='POST'&&JSON.parse(options.body).action.type==='explore_start')sm.mode='unknown';
        return beforeDeparture(url,options);
      };`);
    await drive(`sm.calls.some(c=>c.type==='explore_start')`,'unknown shelter departure before upgrade');
    const pendingKey='arkengine:auto-shelter:pending:v1',original=await read(pendingKey),count=await evaluate('sm.calls.length');
    await evaluate(activate('shelter'));await reloadShelter();await pulse(20000);
    assert.equal((await read(pendingKey)).id,original.id);assert.equal(await evaluate('sm.calls.length'),count);
  });
  await t.test('默认启用：无需推荐按钮卖出旧仓，未知原单升级及第二页不重发',async()=>{
    await setupStock(activate('stock')+stockOwnedPosition+`km.mode='unknown';`);
    await drive('km.calls.length===1','startup stock order');const original=(await read(ledgerKey)).pending;
    assert.equal(await evaluate('km.calls[0].action'),'sell');
    await evaluate(activate('stock'));await reloadStock();await pulse(10000);
    assert.equal((await read(ledgerKey)).pending.id,original.id);assert.equal(await evaluate('km.calls.length'),1);
    const second=await secondStock();
    try{await second.pulse(10000);assert.deepEqual(await second.evaluate('km.calls'),[]);}finally{await second.close();}
  });
  await t.test('默认启用：新账户及历史未知买单跨升级保持零新增交易，原键与预留不变',async()=>{
    for(const seed of ['',stockHistoricalRequest()]){
      await setupStock(activate('stock')+seed);
      await drive(`location.pathname==='/activities/expedition'`,'startup observes without new risk');
      const before=await read(ledgerKey);assert.deepEqual(await evaluate('km.calls'),[]);
      assert.equal(await evaluate('km.tokens'),10000);
      await evaluate(activate('stock'));await reloadStock();await drive(`location.pathname==='/activities/expedition'`,'upgrade cannot reopen entry');
      const after=await read(ledgerKey);assert.deepEqual(after.pending,before.pending);assert.deepEqual(after.entries,before.entries);
      assert.deepEqual(await evaluate('km.calls'),[]);
      if(seed){assert.equal(after.pending.key,'old-buy-request');assert.equal(after.entries[0].debit,123);assert.equal(after.entries[0].result,'reserved');}
      const second=await secondStock();
      try{await second.pulse(310000);assert.deepEqual(await second.evaluate('km.calls'),[]);}finally{await second.close();}
    }
  });
}
