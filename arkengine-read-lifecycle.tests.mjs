import assert from 'node:assert/strict';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

// Headers have arrived, but the body remains pending even after signal.abort().
const holdBody=path=>`window.heldReads=[];const unheldFetch=window.fetch;
  window.fetch=(url,options)=>{
    const response=unheldFetch(url,options);
    if(String(url).startsWith('${path}')&&options?.method!=='POST'&&!heldReads.length){
      const held={signal:options?.signal,at:clock};heldReads.push(held);
      return response.then(r=>{const json=r.json.bind(r);r.json=()=>json().then(data=>new Promise(resolve=>{
        held.release=()=>resolve(data);
      }));return r;});
    }return response;
  };`;
const quiet=`sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;`;
const scene=(flags={},extra='')=>`sm.view=${JSON.stringify(campaignView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
  sm.fixtureSearch=location.search;${quiet}const s=sm.view.state;
  localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify({explore:false,quests:false,training:false,medical:false,radio:false,combatGear:false,defense:false,tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6,...flags})}));${extra}`;
const neighbors=[{userId:1,vaultNo:100,shelterName:'邻居避难所',self:false,helpedToday:false,helpBlocked:null,helpScrap:13}];
const caravan=`localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:0,partsReserve:0}));
  s.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);
  s.daily.picks=[{key:'caravan',target:1,reward:{scrap:240,parts:2,points:30}},
    {key:'win',target:4,reward:{scrap:240,parts:2,points:30}},{key:'baby',target:1,reward:{scrap:240,parts:2,points:30}}];s.daily.counters={caravan:0,win:0,baby:0};
  s.resources.scrap=2000;s.resources.parts=20;sm.caravan={offers:[{slot:0,scrap:100,parts:0,reward:20,delivered:false}]};`;
export async function readLifecycleTests({t,setupShelter,setupFarm,setupFeatures,reloadFeatures,evaluate,pulse,drive,until}){
  const state=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`;
  const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
  const events=`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`;
  const held=()=>until(()=>evaluate(`typeof heldReads[0]?.release==='function'`),'read body held');
  await t.test('读取生命周期：避难所挂起读取超时后重读并领取，旧响应不重复操作',async()=>{
    await setupShelter(quiet+holdBody('/api/shelter'));await held();
    await pulse(13000);await pulse(6000);await pulse();
    assert.ok(await evaluate('sm.reads>=2'),'main shelter read slot must be released');
    await drive('sm.calls.some(c=>c.type===\'collect_all\')','collect after fresh read');
    await drive(`location.pathname==='/activities/expedition'`,'shelter yields after recovery');
    const calls=await evaluate('sm.calls');await evaluate('heldReads[0].release();');await pulse();
    assert.deepEqual(await evaluate('sm.calls'),calls);
  });
  await t.test('读取生命周期：农场挂起读取按原退避恢复，不阻塞种植',async()=>{
    await setupFarm('addRuns(6);'+holdBody('/api/farm'),'/farm');await drive(`typeof heldReads[0]?.release==='function'`,'farm body held');
    await pulse(16000);await pulse(6000);await pulse();
    assert.ok(await evaluate('fm.reads>=2'),'farm timeout must release its loading slot');
    await drive(`fm.calls.some(c=>c.type==='plant')`,'farm plants after replacement read');
    const count=await evaluate('fm.calls.filter(c=>c.type===\'plant\').length');await evaluate('heldReads[0].release();');await pulse();
    assert.equal(await evaluate('fm.calls.filter(c=>c.type===\'plant\').length'),count);
  });
  await t.test('读取生命周期：防守巡检超时后按退避重新检查，旧响应不抢页面',async()=>{
    await setupFeatures(scene({defense:true},`localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:clock+900000,note:'later'}));
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({trade:false,predict:false}));`)+holdBody('/api/shelter'));
    await held();await pulse(13000);await pulse(61000);await pulse();
    assert.ok(await evaluate('sm.reads>=2'),'patrol must release the aborted reader and retry');
    assert.ok(await evaluate(`${events}.some(e=>e.type==='shelter-watch-read-wait')`));
    await evaluate('heldReads[0].release();');await pulse();assert.equal(await evaluate('location.pathname'),'/activities/expedition');
  });
  for(const type of ['互助','商队'])await t.test('读取生命周期：'+type+'挂起不会占满避难所访问时间，原单不伪造',async()=>{
    const social=type==='互助';
    await setupShelter(scene(social?{help:true}:{dailyGoals:true,caravanDaily:true},social?`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};`:caravan)+
      holdBody(social?'/api/shelter/social/leaderboard':'/api/shelter/caravan'));
    await drive(`typeof heldReads[0]?.release==='function'`,type+' started');const at=await evaluate('clock');
    await pulse(13000);await drive(`location.pathname==='/activities/expedition'`,type+' yields after read timeout',30);
    assert.ok(await evaluate(`clock-${at}<50000`));assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='${social?'help':'caravan'}').length`),0);
    assert.equal(await evaluate(`${state}?.${social?'social':'caravan'}?.pending??null`),null);
    await evaluate('heldReads[0].release();');await pulse();assert.equal(await evaluate('location.pathname'),'/activities/expedition');
  });
  await t.test('读取生命周期：旧商队请求跨访问未返回，新访问仍能完成交付',async()=>{
    await setupShelter(scene({dailyGoals:true,caravanDaily:true},caravan)+holdBody('/api/shelter/caravan'));
    await drive(`typeof heldReads[0]?.release==='function'`,'caravan old read held');
    await evaluate(`history.pushState({},'','/activities/expedition');renderExp();`);await pulse();
    await evaluate(`history.pushState({},'','/shelter');renderShelter();`);await pulse();
    await drive(`sm.calls.some(c=>c.type==='caravan')`,'new visit delivers despite old body',35);
    await evaluate('heldReads[0].release();');await drive(`location.pathname==='/activities/expedition'`,'caravan settles once');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='caravan').length`),1);assert.equal(await evaluate(`${state}.caravan.pending`),null);
  });
  for(const type of ['避难所','农场','互助','商队','巡检'])await t.test('读取生命周期暂停：'+type+'挂起时暂停，迟到结果不恢复操作',async()=>{
    if(type==='农场')await setupFarm('addRuns(6);'+holdBody('/api/farm'),'/farm');
    else if(type==='巡检')await setupFeatures(scene({defense:true},`localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:clock+900000,note:'later'}));
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({trade:false,predict:false}));`)+holdBody('/api/shelter'));
    else await setupShelter(type==='避难所'?quiet+holdBody('/api/shelter'):
      scene(type==='互助'?{help:true}:{dailyGoals:true,caravanDaily:true},type==='互助'?`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};`:caravan)+
      holdBody(type==='互助'?'/api/shelter/social/leaderboard':'/api/shelter/caravan'));
    await drive(`typeof heldReads[0]?.release==='function'`,type+' pending before pause');
    await evaluate(`${panel}.getElementById('toggle').click();`);await pulse();
    assert.equal(await evaluate('heldReads[0].signal.aborted'),true);
    const before=await evaluate(`JSON.stringify({s:window.sm?.calls,f:fm.calls,k:window.km?.calls})`);
    await evaluate('heldReads[0].release();');await pulse(40000);
    assert.equal(await evaluate(`JSON.stringify({s:window.sm?.calls,f:fm.calls,k:window.km?.calls})`),before);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('读取生命周期：互助资格读取挂起只跳过未核对目标，不假记奖励',async()=>{
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};`)+holdBody('/api/shelter/social/visit'));
    await drive(`typeof heldReads[0]?.release==='function'`,'neighbor eligibility held');await pulse(13000);
    await drive(`location.pathname==='/activities/expedition'`,'eligibility failure yields',35);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='help').length`),0);
    assert.equal(await evaluate(`${state}.social??null`),null,'资格未核对且未提交时不应生成互助账本');
    await evaluate('heldReads[0].release();');await pulse();assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='help').length`),0);
    assert.equal(await evaluate(`${state}.social??null`),null,'迟到资格不能伪造已提交或已领奖记录');
  });
  await t.test('读取生命周期连续：股市与避难所分别挂起恢复，资源增长中完成两项预约且刷新不重发',async()=>{
    await setupFeatures(`localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:clock-1000,note:'due shelter'}));
      window.delayedBodies={};const chainRead=window.fetch;
      window.fetch=(url,options)=>{
        if(url==='/api/shelter')sm.view.state.resources.scrap++;
        const response=chainRead(url,options);
        if(['/api/stock','/api/shelter'].includes(url)&&options?.method!=='POST'&&!delayedBodies[url]){
          const held=delayedBodies[url]={signal:options.signal};
          return response.then(r=>{const json=r.json.bind(r);r.json=()=>json().then(data=>new Promise(resolve=>held.release=()=>resolve(data)));return r;});
        }return response;
      };`);
    await drive(`km.calls.length===1&&sm.calls.some(c=>c.type==='collect_all')&&location.pathname==='/activities/expedition'`,
      'both failed reads recover and both scheduled features finish',180);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['sell']);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1')).entries[0].proceeds`),117);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='collect_all').length`),1);
    assert.equal(await evaluate(`Object.values(delayedBodies).every(r=>r.signal.aborted)`),true);
    const stock=await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`);
    await evaluate(`Object.values(delayedBodies).forEach(r=>r.release());`);await pulse();
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-stock:ledger:v1')`),stock);
    await reloadFeatures();for(let i=0;i<10;i++)await pulse();
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='collect_all').length`),1);
  });
}
