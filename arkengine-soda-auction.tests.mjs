import assert from 'node:assert/strict';
import {readyCampaignConstructionScene} from './arkengine-shelter-growth-investment.fixture.mjs';

export async function sodaAuctionTests({t,setupAuction,reloadAuction,evaluate,pulse,until,drive,trustedAuctionKey}) {
  const state="JSON.parse(localStorage.getItem('arkengine:auto-soda-auction:state:v1'))";
  const status=()=>evaluate("document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent");
  const ready=()=>until(()=>evaluate('am.posts.length===1'),'auction first order');
  const fresh=async(code='')=>{await evaluate(`${code};refreshAuction()`);await pulse(0);};
  await t.test('汽水拍卖：默认开启，提前两分钟驻留，其他玩法和到期远征均让路',async()=>{
    await setupAuction(`clock=Date.parse('2026-11-20T19:57:59+08:00');am.view.auction.live=false;
      localStorage.setItem('arkengine:auto-farm:enabled:v1','true');localStorage.setItem('arkengine:auto-encounter:enabled:v1','true');
      localStorage.setItem('arkengine:auto-shelter:enabled:v1','true');
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({trade:true,predict:false,tradeLimit:3000,predictionLimit:0,stake:0,reserve:0}));`);
    assert.equal(await evaluate("document.getElementById('ark-auto-expedition').shadowRoot.getElementById('auction-enabled').checked"),true);
    await pulse(1000);
    await until(()=>evaluate("location.pathname==='/shelter'&&sm.tab==='汽水交易'"),'early auction residence');
    const calls=await evaluate('({exp:model.calls.length,farm:fm.calls.length,stock:km.calls.length,shelter:sm.calls.length})');
    await fresh(`clock=Date.parse('2026-11-20T20:00:00+08:00');am.view.auction.live=true;am.view.auction.price=400000;`);
    for(let index=0;index<3;index++)await pulse(2000);
    assert.equal(await evaluate('am.posts.length'),0);
    assert.equal(await evaluate('location.pathname'),'/shelter');
    assert.deepEqual(await evaluate('({exp:model.calls.length,farm:fm.calls.length,stock:km.calls.length,shelter:sm.calls.length})'),calls);
    await fresh('am.view.auction.price=399999;');await ready();
    assert.equal(await evaluate('am.market'),0);
  });
  await t.test('汽水拍卖：按钮就绪即提交，数量修正为1，取消普通随机等待',async()=>{
    await setupAuction('am.quantity=3;');await ready();
    const data=await evaluate('({posts:am.posts,clicks:am.clicks,clock})');
    assert.equal(data.posts[0].body.quantity,1);assert.equal(data.posts[0].body.maxUnitPrice,399999);
    assert.equal(data.posts[0].at,data.clock);
    assert.equal(data.posts[0].pending.phase,'submitted');
    assert.equal(data.posts[0].pending.key,data.posts[0].body.idempotencyKey);
    assert.ok(data.posts[0].wall-data.clicks.find(click=>click.type==='buy').wall<1000);
    assert.equal(await evaluate('am.market'),0);
  });
  await t.test('汽水拍卖：同批只买1瓶，每十分钟重复参加超过3轮，成交与成本只记一次',async()=>{
    await setupAuction();await ready();
    for(let round=1;round<=4;round++){
      await pulse(600000);
      await fresh(`am.view.auction.released=${3*(round+1)};am.view.auction.available=3;`);
      await until(()=>evaluate(`am.posts.length===${round+1}`),'new auction release');
      await fresh();assert.equal(await evaluate('am.posts.length'),round+1);
    }
    await until(()=>evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(event=>event.type==='soda-auction-bought').length===5`),'auction receipt logs');
    const rewards=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(event=>event.type==='soda-auction-bought').map(event=>event.data.reward)`);
    assert.equal(rewards.reduce((sum,reward)=>sum+reward.避难所汽水,0),5);
    assert.equal(rewards.reduce((sum,reward)=>sum+reward.汽水拍卖支出,0),1999995);
    assert.equal(await evaluate('location.pathname'),'/shelter');
  });
  await t.test('汽水拍卖：遵守动态每日限额，次日晚间自动恢复',async()=>{
    await setupAuction('am.view.auction.perUserDaily=1;');await ready();
    await until(()=>evaluate(`${state}?.doneDay==='2026-11-20'`),'actual daily quota');
    await evaluate(`clock=Date.parse('2026-11-21T20:00:00+08:00');am.view.auction.startsAt='2026-11-21T20:00:00+08:00';
      am.view.auction.endsAt='2026-11-21T21:00:00+08:00';am.view.auction.boughtToday=0;am.view.auction.available=3;
      am.view.auction.released=3;sm.tab='避难所';renderFeature();`);await pulse(0);
    await until(()=>evaluate('am.posts.length===2'),'next evening automatically resumes');
  });
  await t.test('汽水拍卖：余额不足继续守候降价，售罄后不会离开或误买市场',async()=>{
    await setupAuction('am.tokens=300000;');await pulse(0);
    assert.equal(await evaluate('am.posts.length'),0);
    await fresh('am.view.auction.price=250000;');await ready();
    await pulse(600000);await fresh('am.view.auction.released=6;am.view.auction.available=0;');
    assert.equal(await evaluate('location.pathname'),'/shelter');assert.equal(await evaluate('am.posts.length'),1);
    assert.equal(await evaluate('am.market'),0);
  });
  for(const mode of ['retry','network','empty'])await t.test('汽水拍卖：未知原单跨刷新和跨轮不重复 '+mode,async()=>{
    await setupAuction(`am.mode=${JSON.stringify(mode)};`);await ready();
    await until(()=>evaluate(`${state}?.pending?.unknown===true`),'unknown outcome retained');
    const original=await evaluate(`${state}.pending`);
    await reloadAuction();await pulse(600000);
    await fresh('am.view.auction.released=6;am.view.auction.available=3;');
    assert.equal(await evaluate('am.posts.length'),1);
    assert.equal((await evaluate(`${state}.pending`)).id,original.id);
  });
  await t.test('汽水拍卖：明确售罄拒绝不反复提交，下一批继续',async()=>{
    await setupAuction("am.mode='sold';");await ready();await pulse(0);
    assert.equal(await evaluate(`${state}.pending`),null);
    for(let index=0;index<3;index++)await fresh();
    assert.equal(await evaluate('am.posts.length'),1);
    await pulse(600000);await fresh("am.view.auction.released=6;am.view.auction.available=3;am.mode='success';");
    await until(()=>evaluate('am.posts.length===2'),'sold out release recovered');
  });
  await t.test('汽水拍卖：人工重试同一原单成功后解除未知等待，不创建额外订单',async()=>{
    await setupAuction("am.mode='retry';");await ready();
    await until(()=>evaluate(`${state}?.pending?.unknown===true`),'unknown order before manual retry');
    await evaluate(`am.mode='success';fetch('/api/shelter/auction',{method:'POST',body:JSON.stringify(am.posts[0].body)});`);
    await until(()=>evaluate(`${state}.pending===null`),'original retry receipt resolved');
    await fresh();assert.equal(await evaluate('am.posts.length'),2);
    assert.equal(await evaluate('am.posts[0].body.idempotencyKey===am.posts[1].body.idempotencyKey'),true);
    await until(()=>evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(event=>event.type==='soda-auction-bought').length===1`),'one recovered purchase receipt');
  });
  for(const variant of ['title','amount','request'])await t.test('汽水拍卖：确认框或原生请求不匹配时不花费 '+variant,async()=>{
    const code=variant==='title'?"am.title='买入 1 瓶，399999 代币/瓶';":variant==='amount'?'am.wrongAmount=true;':'am.requestPatch={quantity:2};';
    await setupAuction(code);
    await until(()=>evaluate('am.clicks.some(click=>click.type==="buy")'),'confirmation opened');
    await pulse(0);assert.equal(await evaluate('am.posts.length'),0);assert.equal(await evaluate('am.tokens'),3000000);
  });
  await t.test('汽水拍卖：关闭开关立即取消自己的未提交窗口，其他功能恢复',async()=>{
    await setupAuction('am.confirmDisabled=true;');
    await until(()=>evaluate('!!document.getElementById("auction-confirm")'),'waiting confirmation');
    await evaluate("document.getElementById('ark-auto-expedition').shadowRoot.getElementById('auction-enabled').click()");
    await until(()=>evaluate('!document.getElementById("auction-confirm")'),'native auction cancel');await pulse(0);
    assert.equal(await evaluate('am.posts.length'),0);assert.equal(await evaluate(`${state}.pending`),null);
    assert.equal(await evaluate("localStorage.getItem('arkengine:auto-soda-auction:enabled:v1')"),'false');
  });
  await t.test('汽水拍卖：确认期间切换账号不提交，原单保留身份',async()=>{
    await setupAuction('am.confirmDisabled=true;');
    await until(()=>evaluate('!!document.getElementById("auction-confirm")'),'waiting auction confirmation');
    await evaluate("sm.view.vaultNo=88;fetch('/api/shelter');");await pulse(0);
    assert.equal(await evaluate('am.posts.length'),0);
    assert.ok(/拍卖|汽水/.test(await status()));
  });
  await t.test('汽水拍卖：切换账号后迟到的旧余额不能恢复购买资格',async()=>{
    await setupAuction('am.view.auction.price=400000;');
    await until(()=>evaluate("sm.tab==='汽水交易'"),'old account waiting');await pulse(0);
    await evaluate("am.holdBalance=true;void fetch('/api/me/balance');");
    await evaluate("sm.view.vaultNo=88;am.tokens=0;am.holdBalance=false;fetch('/api/shelter');");await pulse(0);
    await evaluate('finishOldAuctionBalance();');await fresh('am.view.auction.price=399999;');
    assert.equal(await evaluate('am.posts.length'),0);
    await pulse(15000);await fresh();assert.equal(await evaluate('am.posts.length'),0);
  });
  await t.test('汽水拍卖：成交后刷新仍不重复买同批，下批继续',async()=>{
    await setupAuction();await ready();await pulse(0);await reloadAuction();await fresh();
    assert.equal(await evaluate('am.posts.length'),1);
    await pulse(600000);await fresh('am.view.auction.released=6;am.view.auction.available=3;');
    await until(()=>evaluate('am.posts.length===2'),'new batch after reload');
  });
  await t.test('汽水拍卖：总暂停阻止最终确认，开关关闭期间不恢复其他拍卖点击',async()=>{
    await setupAuction('am.confirmDisabled=true;');
    await until(()=>evaluate('!!document.getElementById("auction-confirm")'),'total pause confirmation');
    await evaluate("document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();document.getElementById('auction-confirm').disabled=false;");
    await pulse(15000);assert.equal(await evaluate('am.posts.length'),0);
    assert.equal(await status(),'已暂停');
  });
  await t.test('汽水拍卖：人工接手确认仍记录原单，不会再自动买一次',async()=>{
    await setupAuction('am.confirmDisabled=true;');
    await until(()=>evaluate('!!document.getElementById("auction-confirm")'),'manual takeover confirmation');
    await evaluate('document.getElementById("auction-cancel").focus()');await trustedAuctionKey();
    await evaluate('document.getElementById("auction-confirm").disabled=false;document.getElementById("auction-confirm").click()');
    await ready();await pulse(0);await reloadAuction();await fresh();
    assert.equal(await evaluate('am.posts.length'),1);
    assert.equal(await evaluate(`${state}.pending`),null);
  });
  await t.test('汽水拍卖：已有其他未知请求保留，不能阻止进入拍卖',async()=>{
    await setupAuction(`sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify({running:6,at:clock}));`);
    await ready();
    assert.equal(await evaluate("JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:claim:v1')).running"),6);
    assert.equal(await evaluate('location.pathname'),'/shelter');
  });
  await t.test('汽水拍卖：成功回执迟到期间不重发，关闭开关仍可记录原成交',async()=>{
    await setupAuction("am.mode='hold';");await ready();await pulse(10000);
    await evaluate("document.getElementById('ark-auto-expedition').shadowRoot.getElementById('auction-enabled').click();finishAuction();");
    await until(()=>evaluate(`${state}.pending===null`),'late receipt settled');
    assert.equal(await evaluate('am.posts.length'),1);
    await until(()=>evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(event=>event.type==='soda-auction-bought').length===1`),'late receipt logged once');
  });
  for(const page of ['远征','农场','秘境'])await t.test('汽水拍卖：接管前安全取消脚本自己的'+page+'未提交窗口',async()=>{
    const config=page==='远征'?`model.runs=[];`:
      page==='农场'?`localStorage.setItem('arkengine:auto-farm:enabled:v1','true');history.replaceState({},'','/farm');`:
      `localStorage.setItem('arkengine:auto-encounter:enabled:v1','true');history.replaceState({},'','/cultivate/dungeon');dm.sweep=false;`;
    await setupAuction(`clock=Date.parse('2026-11-20T19:55:00+08:00');am.view.auction.live=false;${config}`);
    await drive('!!document.querySelector("[role=dialog],[role=alertdialog]")','original '+page+' confirmation');
    await evaluate(`clock=Date.parse('2026-11-20T19:58:00+08:00');`);await pulse(0);
    await until(()=>evaluate("location.pathname==='/shelter'&&sm.tab==='汽水交易'&&!document.querySelector('[role=dialog],[role=alertdialog]')"),'yield '+page+' to auction');
    assert.equal(await evaluate('am.posts.length'),0);
    await fresh(`clock=Date.parse('2026-11-20T20:00:00+08:00');am.view.auction.live=true;`);await ready();
  });
  await t.test('汽水拍卖：取消未提交调岗确认并关闭居民详情，拍卖后不执行旧调岗',async()=>{
    const scene=readyCampaignConstructionScene();scene.campaign.training=false;
    const timestamp=Date.parse('2026-11-20T19:55:00+08:00');
    scene.view.serverTime=timestamp;scene.view.state.lastSettledAt=timestamp;
    for(const person of scene.view.state.residents)person.familyCooldownUntil=person.id>=5?0:timestamp+86400000;
    for(const [id,partnerId] of [[5,6],[6,5]])scene.view.state.residents.find(person=>person.id===id).romance={partnerId,progress:.1};
    scene.state.families=[{a:5,b:6,room:5}];
    await setupAuction(`clock=${timestamp};am.view.auction.live=false;sm.view=${JSON.stringify(scene.view)};
      sm.ui20261109=true;sm.quickAssign=false;sm.confirmFamily=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      history.replaceState({},'','/shelter');localStorage.setItem('arkengine:auto-shelter:enabled:v1','true');
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','8');
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({combatGear:false,tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6,...${JSON.stringify(scene.campaign)}}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({...${JSON.stringify(scene.construction)},build:false,upgrade:false,dig:false}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(scene.state)},vaultNo:77,nextAt:0,note:'auction interruption'}));`);
    await drive('!!document.querySelector("[role=alertdialog]")','assignment confirmation before auction',120);
    await evaluate(`clock=Date.parse('2026-11-20T19:58:00+08:00');
      const manual=document.createElement('div');manual.id='auction-manual';manual.setAttribute('role','dialog');manual.innerHTML='<h2>人工交易</h2><button>取消</button>';document.body.append(manual);`);
    await pulse(0);assert.equal(await evaluate('document.querySelectorAll("[role=dialog],[role=alertdialog]").length'),3);
    assert.equal(await evaluate('am.posts.length'),0);
    await evaluate("document.getElementById('auction-manual').remove()");
    try{await until(()=>evaluate("sm.tab==='汽水交易'&&!document.querySelector('[role=dialog],[role=alertdialog]')"),'resident dialogs yielded');}
    catch(error){throw Error(error.message+' '+JSON.stringify(await evaluate(`({tab:sm.tab,status:document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent,
      pending:localStorage.getItem('arkengine:auto-shelter:pending:v1'),dialogs:[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map(dialog=>({role:dialog.getAttribute('role'),
        hidden:dialog.getAttribute('aria-hidden'),title:dialog.querySelector('h2')?.textContent,buttons:[...dialog.querySelectorAll('button')].map(button=>({text:button.textContent,label:button.getAttribute('aria-label')}))})),
      events:(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.slice(-8)})`)));}
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="assign"&&call.residentId===5&&call.roomId===5).length'),0);
    await fresh(`clock=Date.parse('2026-11-20T20:00:00+08:00');am.view.auction.live=true;`);await ready();
    await evaluate("localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');document.getElementById('ark-auto-expedition').shadowRoot.getElementById('auction-enabled').click()");
    await pulse(5000);
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="assign"&&call.residentId===5&&call.roomId===5).length'),0);
  });
}
