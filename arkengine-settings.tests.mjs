import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
import {stockOwnedPosition} from './arkengine-stock.fixture.mjs';
import {stockHistoricalRequest} from './arkengine-stock-history.fixture.mjs';

export async function settingsTests({t,setupShelter,reloadShelter,setupStock,reloadStock,evaluate,pulse,drive,until,viewport,screenshot,pressEnter}) {
  const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
  const stockKey='arkengine:auto-stock:config:v1',shelterKey='arkengine:auto-shelter:construction:v1';
  const stock=`JSON.parse(localStorage.getItem('${stockKey}'))`,construction=`JSON.parse(localStorage.getItem('${shelterKey}'))`;
  const ledger=`JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'))`;
  const state=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`;
  const paused=`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`;
  const cfg={trade:true,predict:false,tradeLimit:100000,predictionLimit:700,stake:50,reserve:2500};
  const click=id=>evaluate(`${panel}.getElementById('${id}').click();`);
  const feedback=()=>evaluate(`${panel}.getElementById('stock-check-feedback').textContent`);
  const diagnostic=`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='stock-decision').at(-1).data`;
  const campaign={explore:false,quests:false,training:false,medical:false,radio:false,combatGear:false,
    tier:0,hours:12,stimpaks:3,reserve:4,chance:80,attempts:2,trainTarget:8};

  await t.test('推荐预设：首次股市无需填写，暂停总开关不交易，刷新保留全部额度',async()=>{
    await setupStock(paused);assert.equal(await evaluate(stock),null);assert.equal(await evaluate('km.reads'),0);
    await click('stock-preset');
    assert.deepEqual(await evaluate(stock),{trade:true,predict:false,observeOnly:false,netEfficiency:true,autoBudget:true,tradeLimit:400000,predictionLimit:0,stake:0,reserve:1000,riskLimit:400000,positionLimit:400000,lossLimit:100000});
    await pulse(10000);assert.equal(await evaluate('km.reads'),0);assert.deepEqual(await evaluate('km.calls'),[]);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
    await reloadStock();assert.equal(await evaluate(`${stock}.reserve`),1000);assert.equal(await evaluate('km.reads'),0);
    await click('stock-pause');assert.equal(await evaluate(`${stock}.trade||${stock}.predict`),false);
    assert.equal(await evaluate(`${stock}.tradeLimit`),400000);
  });
  await t.test('推荐预设：直接开启股市后卖出旧仓，保留资金设置且不开放新买入',async()=>{
    await setupStock(stockOwnedPosition);await click('stock-preset');
    await drive('km.calls.some(c=>c.action===\'sell\')','preset enables a legal old-position exit');
    await drive(`location.pathname==='/activities/expedition'`,'preset sale confirmed');
    assert.equal(await evaluate(`${ledger}.pending`),null);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell']);
    assert.equal(await evaluate(`${ledger}.entries[0].proceeds`),117);assert.equal(await evaluate('km.tokens'),10117);
    assert.equal(await evaluate(`${ledger}.entries[0].releasedCost`),100);
    assert.equal(await evaluate(`${diagnostic}.policy.newBuy`),false);
    assert.equal(await evaluate(`${diagnostic}.budget.reserve`),2024,'卖出后按实际10117资产保留向上取整的20%');
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='stock-decision').data.budget.reserve`),2020,
      '起点包含10000现金和100旧仓成本');
  });
  await t.test('推荐预设：100000退为手动备用，自动模式保留独立预测额度、持仓、已用预算和停止原因',async()=>{
    const saved={version:1,userId:77,nextAt:0,note:'人工核对',hold:true,holdReason:'原交易待人工核对',pending:null,
      owned:{'1':{shares:10,cost:800,modelName:'模型甲',manual:false}},
      entries:[{id:'prior',action:'buy',at:1,debit:800,result:'success'}]};
    await setupStock(`${paused}localStorage.setItem('${stockKey}',JSON.stringify(${JSON.stringify(cfg)}));
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify(${JSON.stringify(saved)}));`);
    for(let i=0;i<2;i++){
      await click('stock-preset');assert.deepEqual(await evaluate(stock),{...cfg,predict:false,observeOnly:false,netEfficiency:true,autoBudget:true,riskLimit:400000,positionLimit:400000,lossLimit:100000});
      const actual=await evaluate(ledger);assert.deepEqual(actual.entries,saved.entries);assert.deepEqual(actual.owned,saved.owned);
      assert.equal(actual.hold,true);assert.equal(actual.holdReason,saved.holdReason);
    }
    await reloadStock();assert.equal(await evaluate(`${stock}.tradeLimit`),100000);
    assert.equal(await evaluate(`${stock}.autoBudget`),true);
    assert.match(await evaluate(`${panel}.getElementById('stock-preset-summary').textContent`),/管理旧仓.*新买入等待收益验证.*保留原资金设置与更严格的独立限制.*总风险本金上限 400000/);
  });
  await t.test('推荐预设：股票零备用额度不妨碍显式启用自动资金，建设零额度仍保留',async()=>{
    await setupStock(`${paused}localStorage.setItem('${stockKey}',JSON.stringify({...${JSON.stringify(cfg)},tradeLimit:0,predictionLimit:0,stake:0}));`);
    await click('stock-preset');await pulse();assert.equal(await evaluate(`${stock}.trade&&${stock}.autoBudget`),true);
    assert.equal(await evaluate(`${stock}.tradeLimit`),0);
    assert.match(await evaluate(`${panel}.getElementById('stock-config-summary').textContent`),/自动资金/);
    await setupShelter(`${paused}localStorage.setItem('${shelterKey}',JSON.stringify({build:false,upgrade:false,dig:false,scrapLimit:0,partsLimit:0,scrapReserve:0,partsReserve:0}));`);
    await click('shelter-preset');await pulse();assert.equal(await evaluate(`${construction}.build`),false);
    assert.equal(await evaluate(`${construction}.scrapLimit`),0);
    assert.match(await evaluate(`${panel}.getElementById('shelter-config-summary').textContent`),/零建设额度/);
  });
  await t.test('推荐预设：首次避难所配齐生产人口养成与建设，刷新保留且不越过总暂停',async()=>{
    await setupShelter(`${paused}localStorage.removeItem('arkengine:auto-shelter:enabled:v1');localStorage.removeItem('arkengine:auto-shelter:population:v1');`);
    assert.equal(await evaluate(`${panel}.getElementById('shelter-population').value`),'30');
    await click('shelter-preset');await pulse(10000);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:staff:v1')`),'population');
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:population:v1')`),'30');
    for(const key of ['enabled','gear','optimize','explore-claim'])assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:${key}:v1')`),'true');
    const c=await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1'))`);
    for(const key of ['explore','quests','training','medical','radio','combatGear'])assert.equal(c[key],true);
    assert.equal(c.sodaEfficiency,true);
    assert.deepEqual(await evaluate(construction),{build:true,upgrade:true,dig:true,budgetMode:'stock',scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0});
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await reloadShelter();assert.equal(await evaluate(`${construction}.scrapLimit`),10000);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('推荐预设：保留更高的自定义人口、探险数字与建设账本，应用后统一开启项目',async()=>{
    const budgets={build:false,upgrade:false,dig:false,scrapLimit:5000,partsLimit:45,scrapReserve:240,partsReserve:10};
    const entries=[{id:'original-construction',at:1,scrap:300,parts:15}];
    await setupShelter(`${paused}localStorage.setItem('arkengine:auto-shelter:population:v1','44');
      localStorage.setItem('${shelterKey}',JSON.stringify(${JSON.stringify(budgets)}));
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify(campaign)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'fixture',constructionLedger:${JSON.stringify(entries)}}));`);
    await click('shelter-preset');await click('shelter-preset');
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:population:v1')`),'44');
    assert.deepEqual(await evaluate(construction),{...budgets,budgetMode:'daily',build:true,upgrade:true,dig:true});
    assert.deepEqual(await evaluate(`${state}.constructionLedger`),entries);
    const c=await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1'))`);
    for(const key of ['tier','hours','stimpaks','reserve','chance','attempts','trainTarget'])assert.equal(c[key],campaign[key]);
  });
  await t.test('人口阶段推荐：保存的14或28不会自行变化，明确应用后改为30并跨刷新保留',async()=>{
    for(const previous of [14,28]){
      await setupShelter(`${paused}localStorage.setItem('arkengine:auto-shelter:population:v1','${previous}');`);
      assert.equal(await evaluate(`${panel}.getElementById('shelter-population').value`),String(previous));
      assert.match(await evaluate(`${panel}.getElementById('shelter-preset-summary').textContent`),/人口阶段目标 30.*开启持续分阶段增长.*床位、成年口粮和岗位逐批准备/);
      await click('shelter-preset');await pulse(10000);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:population:v1')`),'30');
      assert.deepEqual(await evaluate('sm.calls'),[],'the preset must still respect the paused main switch');
      await reloadShelter();assert.equal(await evaluate(`${panel}.getElementById('shelter-population').value`),'30');
    }
  });
  await t.test('推荐预设：避难所开启后实际执行综合发展，未填写数字也能派出探险',async()=>{
    await setupShelter(`sm.view=${JSON.stringify(campaignView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.fixtureSearch=location.search;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');`);
    await click('shelter-preset');await drive(`sm.calls.some(c=>c.type==='explore_start')`,'preset shelter departure');
    assert.ok(await evaluate(`sm.calls.filter(c=>c.type==='explore_start').every(c=>c.stimpaks===2&&!c.abyss)`));
  });
  await t.test('推荐预设收益：保留旧12小时数字，汽水模式实际按6小时出发与9小时往返计划',async()=>{
    await setupShelter(`sm.view=${JSON.stringify(campaignView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.fixtureSearch=location.search;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify(campaign)}));
      localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');`);
    await click('shelter-preset');await drive(`${state}?.campaign?.trips.length>0`,'efficiency trip confirmed');
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1')).hours`),12);
    assert.equal(await evaluate(`${state}.campaign.trips[0].hours`),6);
    assert.match(await evaluate(`${panel}.getElementById('shelter-campaign-status').textContent`),/9小时/);
  });
  await t.test('推荐预设收益：应用推荐关闭原预测开关但保留金额，有轮次也不下注',async()=>{
    await setupStock(`${paused}localStorage.setItem('${stockKey}',JSON.stringify({...${JSON.stringify(cfg)},predict:true}));
      km.view.rounds=[{id:42,stockId:1,ruleVersion:2,oddsBp:180,lockAt:new Date(clock+240000).toISOString(),closeAt:new Date(clock+900000).toISOString()}];`);
    await click('stock-preset');assert.equal(await evaluate(`${stock}.predict`),false);
    assert.equal(await evaluate(`${stock}.predictionLimit`),700);assert.equal(await evaluate(`${stock}.stake`),50);
    await click('toggle');await drive(`location.pathname==='/activities/expedition'`,'recommended stock with prediction round');
    assert.deepEqual(await evaluate('km.calls'),[]);
    assert.equal(await evaluate(`${diagnostic}.policy.newBuy`),false);assert.equal(await evaluate(`${diagnostic}.policy.predict`),false);
  });
  await t.test('自动资金诊断：同为手填100000，额度随资产变化，刷新不清预算也不自动新买',async()=>{
    const budgets=[];
    for(const tokens of [1500,10000]){
      await setupStock(`${paused}km.tokens=${tokens};localStorage.setItem('${stockKey}',JSON.stringify(${JSON.stringify(cfg)}));`);
      await click('stock-preset');await click('toggle');await drive(`location.pathname==='/activities/expedition'`,'dynamic funds order');
      const l=await evaluate(ledger);assert.equal(l.entries.length,0);assert.equal(l.hold,false);
      budgets.push(await evaluate(`${diagnostic}.budget.reserveBudget`));assert.equal(await evaluate('km.tokens'),tokens);
      assert.equal(await evaluate(`${diagnostic}.budget.reserve`),tokens===1500?1000:2000);
      assert.equal(await evaluate(`${diagnostic}.selected`),null);assert.equal(await evaluate(`${diagnostic}.policy.newBuy`),false);
      assert.equal(await evaluate(`${stock}.tradeLimit`),100000,'旧数字只存作手动备用');
      await reloadStock();await drive(`location.pathname==='/activities/expedition'`,'dynamic funds reload');
      assert.deepEqual(await evaluate(`${ledger}.entries`),l.entries);assert.equal(await evaluate('km.calls.length'),0);
      assert.equal(await evaluate(`${diagnostic}.budget.reserveBudget`),budgets.at(-1));
    }
    assert.ok(budgets[0]>0&&budgets[1]>budgets[0]*5,'资金计算随资产变化，但不成为新增自动交易');
  });
  await t.test('自动资金诊断：余额不足周转金及手填小额度均保留正确约束，不恢复自动买入',async()=>{
    await setupStock(`${paused}km.tokens=800;`);await click('stock-preset');await click('toggle');
    await drive(`location.pathname==='/activities/expedition'`,'low funds wait');assert.deepEqual(await evaluate('km.calls'),[]);
    assert.ok(await evaluate(`${diagnostic}.budget.reserveBudget<=0`));
    await setupStock(paused);await click('stock-preset');
    await evaluate(`${panel}.getElementById('stock-auto-budget').checked=false;
      ${panel}.getElementById('stock-trade-limit').value='600';${panel}.getElementById('stock-save').click();`);
    await click('toggle');await drive(`location.pathname==='/activities/expedition'`,'manual budget restored');
    assert.equal(await evaluate(`${stock}.autoBudget`),false);
    assert.equal(await evaluate(`${diagnostic}.budget.constraints.find(c=>c.key==='daily-buy-limit').remaining`),600);
    assert.equal(await evaluate(`${diagnostic}.budget.constraints.find(c=>c.key==='per-stock-limit').remaining`),200);
    assert.deepEqual(await evaluate('km.calls'),[]);assert.equal(await evaluate(`${ledger}.entries.length`),0);
  });
  await t.test('自动资金收益：原买单未知后余额下降，跨刷新保留原单但不挤占周转金续发',async()=>{
    await setupStock(paused+stockHistoricalRequest());await click('stock-preset');await click('toggle');
    await drive(`location.pathname==='/activities/expedition'`,'unknown historical dynamic order preserved');
    const original=await evaluate(`${ledger}.pending.id`);
    await evaluate(`km.tokens=1500;`);await pulse(31000);await drive(`location.pathname==='/activities/expedition'`,'lower funds wait');
    await reloadStock();await drive(`location.pathname==='/activities/expedition'`,'lower funds after reload');
    assert.equal(await evaluate('km.calls.length'),0);assert.equal(await evaluate(`${ledger}.pending.id`),original);
    assert.match(await evaluate(`${ledger}.note`),/暂停.*手动核对/);
    assert.equal(await evaluate(`${ledger}.entries[0].debit`),123);assert.equal(await evaluate(`${ledger}.entries[0].result`),'reserved');
  });
  await t.test('汽水效率收益浏览器：区域概率为零时不出发，人员仍可参加周任务',async()=>{
    await setupShelter(`sm.view=${JSON.stringify(campaignView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.fixtureSearch=location.search;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      sm.view.drops.tierPermille=[0,0];localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({
        ...${JSON.stringify(campaign)},chance:70,explore:true,quests:true,sodaEfficiency:true}));`);
    await drive(`sm.calls.some(c=>c.type==='quest_start')`,'quest uses residents with no soda opportunities');
    assert.ok(await evaluate(`!sm.calls.some(c=>c.type==='explore_start')`));
    assert.match(await evaluate(`${panel}.getElementById('shelter-campaign-status').textContent`),/概率为0/);
  });
  await t.test('培养效率浏览器：同样短板先安排三级训练室，房间列表顺序不让一级房抢先',async()=>{
    await setupShelter(`sm.view=${JSON.stringify(campaignView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.fixtureSearch=location.search;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      const room=(id,trainStat,level,col)=>({id,type:'training',trainStat,level,col,floor:3,width:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
      sm.view.state.rooms.push(room(30,'end',1,2),room(31,'str',3,3));
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({...${JSON.stringify(campaign)},training:true,trainTarget:9}));`);
    await drive(`sm.calls.some(c=>c.type==='assign')`,'higher level training selected');
    assert.equal(await evaluate(`sm.calls.find(c=>c.type==='assign').roomId`),31);
  });
  await t.test('自动资金收益：待确认期间切回手动小额度，不按旧自动额度续发',async()=>{
    await setupStock(paused+stockHistoricalRequest());await click('stock-preset');await click('toggle');
    await drive(`location.pathname==='/activities/expedition'`,'historical original before custom limit');const original=await evaluate(`${ledger}.pending`);
    await evaluate(`${panel}.getElementById('stock-auto-budget').checked=false;
      ${panel}.getElementById('stock-trade-limit').value='0';${panel}.getElementById('stock-save').click();km.mode='success';`);
    await pulse(31000);await drive(`location.pathname==='/activities/expedition'`,'custom pause for original auto order');
    assert.equal(await evaluate('km.calls.length'),0);assert.deepEqual(await evaluate(`${ledger}.pending`),original);
    assert.equal(await evaluate(`${stock}.autoBudget`),false);
  });
  await t.test('推荐预设：股市未决原交易与预留预算不被应用按钮释放或重发',async()=>{
    await setupStock(`localStorage.setItem('${stockKey}',JSON.stringify(${JSON.stringify(cfg)}));`+stockHistoricalRequest());
    await drive(`location.pathname==='/activities/expedition'`,'original unknown historical order');
    await evaluate(`${paused}window.dispatchEvent(new Event('focus'));`);await pulse();
    const before=await evaluate(ledger);assert.ok(before.pending);
    await click('stock-preset');const after=await evaluate(ledger);
    assert.deepEqual(after.pending,before.pending);assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.owned,before.owned);
    await pulse(30000);assert.equal(await evaluate('km.calls.length'),0);
  });
  await t.test('推荐预设：避难所未决探险原请求与家庭规划不丢失',async()=>{
    await setupShelter(`sm.view=${JSON.stringify(campaignView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.fixtureSearch=location.search;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.mode='unknown';
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({...${JSON.stringify(campaign)},explore:true,stimpaks:2,reserve:2}));`);
    await drive('sm.calls.length===1','original unknown shelter trip');
    await evaluate(`${paused}window.dispatchEvent(new Event('focus'));`);await pulse();
    const key='arkengine:auto-shelter:pending:v1',before=await evaluate(`localStorage.getItem('${key}')`);
    assert.ok(before&&before!=='null');
    const record=await evaluate(`${state}.campaign`);await click('shelter-preset');
    assert.equal(await evaluate(`localStorage.getItem('${key}')`),before);assert.deepEqual(await evaluate(`${state}.campaign`),record);
    await pulse(30000);assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('推荐预设：股市预约保存失败或避难所中途写入失败，刷新仍暂停且账本不重置',async()=>{
    await setupStock(paused);
    await evaluate(`const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
      if(k==='arkengine:auto-stock:ledger:v1')throw Error('fixture quota');return originalSet.call(this,k,v);};`);
    await click('stock-preset');assert.equal(await evaluate(`${stock}.trade||${stock}.predict`),false);
    await reloadStock();assert.equal(await evaluate(`${stock}.trade||${stock}.predict`),false);
    await setupShelter(paused);
    await evaluate(`const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
      if(k==='arkengine:auto-shelter:campaign:v1')throw Error('fixture quota');return originalSet.call(this,k,v);};`);
    await click('shelter-preset');assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'false');
    await reloadShelter();assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'false');
    assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('检查股市反馈：未开启、总暂停和交易保护原因持续可见，不解除保护',async()=>{
    await setupStock(paused);await click('stock-check');await pulse(10000);assert.match(await feedback(),/股市未开启/);
    await click('stock-preset');await click('stock-check');await pulse(10000);assert.match(await feedback(),/总开关暂停/);
    assert.equal(await evaluate('km.reads'),0);
    await setupStock(`localStorage.setItem('${stockKey}',JSON.stringify(${JSON.stringify(cfg)}));
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:77,nextAt:0,note:'停止',
        hold:true,holdReason:'原交易待人工核对',owned:{},entries:[],pending:null}));`,'/activities/expedition');
    await click('stock-check');await pulse(10000);assert.match(await feedback(),/原交易待人工核对/);
    assert.equal(await evaluate(`${ledger}.hold`),true);assert.deepEqual(await evaluate('km.calls'),[]);
  });
  await t.test('检查股市调度：原轮检查已结束尚未返回时，再点检查确实重新读取',async()=>{
    await setupStock(`localStorage.setItem('${stockKey}',JSON.stringify({...${JSON.stringify(cfg)},tradeLimit:0}));`);
    await drive(`${ledger}?.nextAt>clock`,'stock first check finished');
    assert.equal(await evaluate('location.pathname'),'/stock');const reads=await evaluate('km.reads');
    await click('stock-check');await drive(`km.reads>${reads}`,'manual check starts a new read');
    await drive(`location.pathname==='/activities/expedition'`,'manual check returns');
    assert.match(await feedback(),/检查结果/);assert.deepEqual(await evaluate('km.calls'),[]);
  });
  await t.test('检查股市调度：远征空闲时手动预约优先于到期农场，检查完成后恢复正常轮转',async()=>{
    await setupStock(`localStorage.setItem('${stockKey}',JSON.stringify({...${JSON.stringify(cfg)},tradeLimit:0}));
      localStorage.setItem('arkengine:auto-stock:ledger:v1',JSON.stringify({version:1,userId:null,nextAt:clock+300000,note:'等待',hold:false,owned:{},entries:[],pending:null}));
      localStorage.setItem('arkengine:auto-farm:enabled:v1','true');`,'/activities/expedition');
    await click('stock-check');await drive(`location.pathname==='/stock'`,'manual stock check has priority');
    await drive(`location.pathname==='/activities/expedition'`,'manual stock check completes');
    assert.match(await feedback(),/检查结果/);await drive(`location.pathname==='/farm'`,'farm resumes after manual check');
  });
  await t.test('推荐预设面板：375宽度默认不展示参数，按键可展开高级设置且刷新记忆',async()=>{
    await setupStock(paused);await viewport({width:375,height:812,deviceScaleFactor:1,mobile:false});
    try {
      await evaluate(`for(const name of ['settings','shelter','stock'])${panel}.querySelector('[data-panel-section="'+name+'"]>summary').click();`);
      assert.equal(await evaluate(`${panel}.getElementById('stock-trade-limit').checkVisibility()`),false);
      assert.equal(await evaluate(`${panel}.getElementById('shelter-staff').checkVisibility()`),false);
      assert.equal(await evaluate(`${panel}.querySelector('.box').scrollWidth<=${panel}.querySelector('.box').clientWidth`),true);
      assert.equal(await evaluate(`${panel}.getElementById('stock-preset').checkVisibility()`),false);
      if(process.env.ARKENGINE_TEST_SCREENSHOT_DIR){
        await mkdir(process.env.ARKENGINE_TEST_SCREENSHOT_DIR,{recursive:true});
        for(const name of ['shelter','stock']){
          await evaluate(`${panel}.querySelector('[data-panel-section="${name}"]>summary').scrollIntoView({block:'start'});`);
          const {data}=await screenshot();await writeFile(join(process.env.ARKENGINE_TEST_SCREENSHOT_DIR,`preset-${name}.png`),Buffer.from(data,'base64'));
        }
      }
      await evaluate(`${panel}.querySelector('[data-panel-section="stock-advanced"]>summary').focus();`);
      assert.equal(await evaluate(`${panel}.activeElement.textContent`),'高级设置（可选）');
      await pressEnter();
      await until(()=>evaluate(`localStorage.getItem('arkengine:auto-panel:expedition:section:stock-advanced:collapsed:v1')==='false'`),'advanced preference saved');
      assert.ok(await evaluate(`${panel}.getElementById('stock-preset').getBoundingClientRect().height>=44`));
      await reloadStock();assert.equal(await evaluate(`${panel}.getElementById('stock-trade-limit').checkVisibility()`),true);
    } finally {await viewport({width:1280,height:900,deviceScaleFactor:1,mobile:false});}
  });
  await t.test('精简面板：单一收益区、默认隐藏设置，滚动及折叠仍能导出全部日志',async()=>{
    await setupStock(paused+`for(const [group,totals] of [['cultivate',{钻石:9,代币:20,修为:300}],['expedition',{避难所汽水:2,代币:100,股市返还:80,股市已实现盈亏:-5}]]){
      localStorage.setItem('arkengine:auto-log:v1:'+group+':2026-10-10',JSON.stringify({day:'2026-10-10',totals,events:[{type:'fixture-reward',detail:group+' income'}]}));}`);
    try {
      await until(()=>evaluate(`${panel}.getElementById('log-summary').textContent.includes('修仙：钻石 9 · 代币 20')`),'merged persisted income loaded');
      assert.match(await evaluate(`${panel}.getElementById('log-summary').textContent`),/避难所：汽水 2\n修仙：钻石 9 · 代币 20\n股市：已实现盈亏 -5 代币\n远征\/农场：钻石 0 · 代币 20/);
      assert.equal(await evaluate(`${panel}.querySelector('[data-panel-section="settings"]').open`),false);
      assert.equal(await evaluate(`${panel}.querySelectorAll('#log-summary').length`),1);
      assert.equal(await evaluate(`${panel}.getElementById('cultivate-log-summary')`),null);
      assert.equal(await evaluate(`${panel}.getElementById('stock-trade-limit').checkVisibility()`),false);
      for(const [width,height] of [[375,667],[1280,900],[667,375]]){
        await viewport({width,height,deviceScaleFactor:1,mobile:false});
        const visible=()=>evaluate(`(()=>{const root=${panel},box=root.querySelector('.box'),button=root.getElementById('log-export'),rect=button.getBoundingClientRect(),bounds=box.getBoundingClientRect();
          return button.checkVisibility()&&rect.top>=bounds.top&&rect.bottom<=bounds.bottom&&rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight&&box.scrollWidth<=box.clientWidth;})()`);
        assert.ok(await visible(),`default ${width}x${height}`);
        const buttons=await evaluate(`[...${panel}.querySelectorAll('.panel-tools button')].map(button=>{const rect=button.getBoundingClientRect();return {width:rect.width,height:rect.height,top:rect.top};})`);
        assert.equal(buttons.length,2);assert.deepEqual(buttons[0],buttons[1],`matching toolbar buttons ${width}x${height}`);
        if(height>=667)assert.ok(await evaluate(`${panel}.querySelector('.box').scrollHeight<=${panel}.querySelector('.box').clientHeight`));
        if(process.env.ARKENGINE_TEST_SCREENSHOT_DIR){
          await mkdir(process.env.ARKENGINE_TEST_SCREENSHOT_DIR,{recursive:true});
          const {data}=await screenshot();await writeFile(join(process.env.ARKENGINE_TEST_SCREENSHOT_DIR,`compact-${width}.png`),Buffer.from(data,'base64'));
        }
        await evaluate(`for(const section of ${panel}.querySelectorAll('[data-panel-section]'))section.open=true;${panel}.querySelector('.box').scrollTop=100000;`);
        assert.ok(await visible(),`scrolled ${width}x${height}`);
        await click('panel-fold');assert.ok(await visible(),`folded ${width}x${height}`);
        await click('panel-fold');await evaluate(`for(const section of ${panel}.querySelectorAll('[data-panel-section]'))section.open=false;`);
      }
      await click('panel-fold');
      await evaluate(`window.exportedBlob=null;URL.createObjectURL=blob=>{exportedBlob=blob;return 'blob:local';};HTMLAnchorElement.prototype.click=function(){};`);
      await click('log-export');await until(()=>evaluate('!!exportedBlob'),'folded export');
      const exported=await evaluate('exportedBlob.text().then(JSON.parse)');
      assert.equal(exported.days.find(day=>day.group==='cultivate').totals['修为'],300);
      assert.equal(exported.days.find(day=>day.group==='expedition').totals['股市返还'],80);
      assert.equal(exported.days.flatMap(day=>day.events).filter(event=>event.type==='fixture-reward').length,2);
      assert.equal(await evaluate(`${panel}.getElementById('log-export').disabled`),false);
      await reloadStock();await until(()=>evaluate(`${panel}.getElementById('log-summary').textContent.includes('修仙：钻石 9 · 代币 20')`),'merged income survives reload');
      await evaluate(`clock=Date.parse('2026-10-11T00:01:00+08:00');window.dispatchEvent(new Event('focus'));`);
      await until(()=>evaluate(`${panel}.getElementById('log-summary').textContent.includes('修仙：钻石 0 · 代币 0')`),'merged income resets on new day');
    } finally {await viewport({width:1280,height:900,deviceScaleFactor:1,mobile:false});}
  });
}
