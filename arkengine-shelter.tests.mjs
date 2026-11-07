import assert from 'node:assert/strict';

export async function shelterTests({t,setupShelter,reloadShelter,restoreReloadedShelter,evaluate,pulse,drive,until,expStatus,withDelayedShelterNavigation,secondShelter}) {
  const panel = `document.getElementById('ark-auto-expedition').shadowRoot`;
  const state = `JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`;
  const pending = `JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`;
  const enabled = `localStorage.getItem('arkengine:auto-shelter:enabled:v1')`;
  const done = `location.pathname==='/activities/expedition' && ${state}?.nextAt>clock`;
  const waiting = `${done}&&${enabled}==='true'&&${pending}!==null&&${state}.pendingReadOnly===${pending}.id`;
  const quiet = `sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.view.state.rooms[0].stored=0;`;
  const incomeTotals=`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).totals`;
  const manualIncomeScene=`${quiet}sm.view.state.rooms[0].stored=30;sm.resultMessages={collect:'收到 30 废料',collect_all:'收到 30 废料'};
    localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');`;
  const auxScene=`${manualIncomeScene}sm.neighbors=[{userId:1,vaultNo:22,helpScrap:13}];
    sm.caravan={offers:[{slot:0,scrap:10,parts:0,reward:80,delivered:false}]};sm.view.state.daily.counters={caravan:0};`;
  const auxPost=(kind,key,requestBody=false)=>{
    const url=kind==='help'?'/api/shelter/social/help':'/api/shelter/caravan',body=kind==='help'?
      {targetId:1,deviceFp:'private-manual-fingerprint',idempotencyKey:key}:{slot:0,idempotencyKey:key};
    const options=JSON.stringify({method:'POST',body:JSON.stringify(body)});
    return `fetch(${requestBody?`new Request(new URL('${url}',location.href),${options})`:`'${url}',${options}`}).then(r=>r.json())`;
  };
  const auxRead=async()=>{await evaluate(`fetch('/api/shelter').then(r=>r.json())`);await pulse(1000);};
  await t.test('手动互助商队收入：原响应和后续账号读取齐备才记账，Request不被消费，同编号刷新去重',async()=>{
    for(const kind of ['help','caravan']){
      await setupShelter(auxScene);await auxRead();
      const key='manual-aux-'+kind,response=await evaluate(auxPost(kind,key,true));
      assert.equal(kind==='help'?response.scrap:response.tokens,kind==='help'?13:80);await pulse(1000);
      const field=kind==='help'?'避难所废料':'避难所商队代币';
      assert.equal(await evaluate(`${incomeTotals}['${field}']||0`),0);
      await auxRead();await until(()=>evaluate(`${incomeTotals}['${field}']===${kind==='help'?13:80}`),'aux actual income');
      await reloadShelter();await auxRead();await evaluate(auxPost(kind,key));await auxRead();
      assert.equal(await evaluate(`${incomeTotals}['${field}']`),kind==='help'?13:80);
      assert.equal(await evaluate('sm.calls.length'),2);assert.equal(await evaluate(enabled),'false');
      const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
      assert.ok(!JSON.stringify(events).includes(key));assert.doesNotMatch(JSON.stringify(events),/private-manual-fingerprint/);
    }
  });
  await t.test('手动互助商队收入：缺账号前状态、切换账号或未知回执不猜金额，不补发操作',async()=>{
    for(const mode of ['missing-before','other-account','unknown']){
      await setupShelter(auxScene+(mode==='unknown'?`sm.caravanUnknown=true;`:''));
      if(mode!=='missing-before')await auxRead();
      await evaluate(auxPost('caravan','manual-aux-boundary'));
      if(mode==='other-account')await evaluate('sm.view.vaultNo=88;');
      await auxRead();assert.equal(await evaluate(`${incomeTotals}['代币']||0`),0);
      assert.equal(await evaluate('sm.calls.length'),1);
    }
  });
  await t.test('手动互助商队收入：无奖励互助不虚增，商队补给单列汽水和装备，不折算代币',async()=>{
    await setupShelter(auxScene+`sm.neighbors[0].reason='self_limit';sm.caravan.offers[0].reward=0;
      sm.caravanFallback={item:'猎枪',boundSoda:2};`);await auxRead();
    await evaluate(auxPost('help','manual-help-no-reward'));await auxRead();
    await evaluate(auxPost('caravan','manual-caravan-fallback'));await auxRead();
    const totals=await evaluate(incomeTotals);assert.equal(totals['避难所废料'],0);assert.equal(totals['代币'],0);
    assert.equal(totals['避难所汽水'],2);assert.equal(totals['避难所商队装备'],1);
    assert.equal(totals['避难所金额待核对']||0,0);assert.equal(await evaluate('sm.calls.length'),2);
  });
  await t.test('手动收入避难所：关闭自动功能后仍记真实领取，不接管操作，不记录原请求密钥',async()=>{
    await setupShelter(manualIncomeScene);
    await evaluate(`fetch('/api/shelter').then(r=>r.json())`);await pulse(1000);
    await evaluate(`shelterAct({type:'collect',roomId:1})`);
    await until(()=>evaluate(`${incomeTotals}['避难所废料']===30`),'manual collection income');
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-income')`);
    assert.equal(events.length,1);assert.equal(events[0].data.source,'manual');
    assert.match(events[0].receiptId,/^shelter-income:[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(events).includes(await evaluate('sm.calls[0].idempotencyKey')));
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(enabled),'false');
    await reloadShelter();await pulse(1000);
    assert.equal(await evaluate(`${incomeTotals}['避难所废料']`),30);
    assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('手动收入避难所：Request正文只复制观察，成功后网站仍可读取原响应',async()=>{
    await setupShelter(manualIncomeScene);
    await evaluate(`fetch('/api/shelter').then(r=>r.json())`);await pulse(1000);
    const response=await evaluate(`fetch(new Request(new URL('/api/shelter/action',location.href),{method:'POST',body:JSON.stringify({action:{type:'collect',roomId:1},idempotencyKey:'manual-request-key'})})).then(r=>r.json())`);
    assert.equal(response.result.message,'收到 30 废料');
    await until(()=>evaluate(`${incomeTotals}['避难所废料']===30`),'manual Request income');
    assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('手动收入避难所：没有领取前快照或服务器结果未知时不估收入，也不补发请求',async()=>{
    for(const mode of ['missing-before','unknown']){
      await setupShelter(manualIncomeScene);
      if(mode==='unknown'){await evaluate(`sm.mode='unknown';fetch('/api/shelter').then(r=>r.json())`);await pulse(1000);}
      await evaluate(`void shelterAct({type:'collect',roomId:1})`);await pulse(1000);
      assert.equal(await evaluate(`${incomeTotals}['避难所废料']||0`),0);
      assert.equal(await evaluate('sm.calls.length'),1);
    }
  });
  await t.test('手动收入避难所：同一原编号的并发重复响应只记一次，正文属性顺序不影响去重',async()=>{
    await setupShelter(manualIncomeScene);
    await evaluate(`fetch('/api/shelter').then(r=>r.json())`);await pulse(1000);
    await evaluate(`Promise.all([{type:'collect',roomId:1},{roomId:1,type:'collect'}].map(action=>fetch('/api/shelter/action',
      {method:'POST',body:JSON.stringify({action,idempotencyKey:'manual-duplicate-key'})}).then(r=>r.json())))`);
    await until(()=>evaluate(`${incomeTotals}['避难所废料']===30`),'one duplicate receipt');await pulse(1000);
    assert.equal(await evaluate(`${incomeTotals}['避难所废料']`),30);
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).counts['shelter-income']`),1);
    assert.equal(await evaluate('sm.view.state.stats.collected'),30);assert.equal(await evaluate('sm.calls.length'),2);
  });
  await t.test('手动收入避难所：自动领取与人工重放共用回执身份，不能从两个入口重复入账',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.resultMessages={collect_all:'收到 30 废料'};
      window.shelterTransport=(u,o)=>{const response=fetch(u,o);queueMicrotask(()=>{void fetch(u,o);});return response;};`);
    await drive(done,'automatic and manual receipt reconciled');await pulse(1000);
    assert.equal(await evaluate('sm.calls.length'),2);
    assert.equal(await evaluate('sm.view.state.stats.collected'),30);
    assert.equal(await evaluate(`${incomeTotals}['避难所废料']`),30);
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).counts['shelter-income']`),1);
  });
  await t.test('手动收入避难所：页面闲置仍可核对本次回执，跨账号和倒序状态不能混入',async()=>{
    for(const mode of ['idle','other-account','old-read']){
      await setupShelter(manualIncomeScene+(mode==='old-read'?`sm.view.state.rooms[0].stored=0;`:''));
      await evaluate(`fetch('/api/shelter').then(r=>r.json())`);await pulse(1000);
      if(mode==='idle')await pulse(61000);
      if(mode==='other-account')await evaluate(`sm.view.vaultNo=88;`);
      if(mode==='old-read'){
        await evaluate(`sm.view.state.rooms[0].stored=30;sm.snapshotAt=clock-60000;fetch('/api/shelter').then(r=>r.json())`);
        await pulse(1000);await evaluate(`delete sm.snapshotAt;`);
      }
      await evaluate(`shelterAct({type:'collect',roomId:1})`);await pulse(1000);
      assert.equal(await evaluate(`${incomeTotals}['避难所废料']||0`),mode==='idle'?30:0,mode);assert.equal(await evaluate('sm.calls.length'),1);
    }
  });
  await t.test('收入统计避难所：原生产领取金额入账，刷新与重复检查不重记',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.resultMessages={collect:'收到30 废料',collect_all:'收到30 废料'};`);
    const fixtureSearch=await evaluate('location.search');
    await drive(done,'collection income confirmed');
    assert.equal(await evaluate(`${incomeTotals}['避难所废料']`),30);
    assert.equal(await evaluate(`${incomeTotals}['代币']||0`),0);
    assert.match(await evaluate(`${panel}.getElementById('log-summary').textContent`),/废料 30/);
    await pulse(1000);await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'income retained after reload');
    assert.equal(await evaluate(`${incomeTotals}['避难所废料']`),30);
  });
  await t.test('收入统计避难所：成功缺金额列待核对，未知响应不凭库存估收入',async()=>{
    for(const mode of ['success','unknown']){
      await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.mode='${mode}';`);
      await drive(done,'collection amount boundary');
      assert.equal(await evaluate(`${incomeTotals}['避难所废料']||0`),0);
      assert.equal(await evaluate(`${incomeTotals}['避难所金额待核对']||0`),mode==='success'?1:0);
    }
  });
  await t.test('避难所收入诊断浏览器：未知格式保存原成功提示与结构，不把库存或未知字段数值当收入',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.resultMessages={collect_all:'收取完成',collect:'收取完成'};
      const raw=window.fetch;window.fetch=async(url,options)=>{const r=await raw(url,options);
        if(url==='/api/shelter/action'&&options?.method==='POST'){
          const body=await r.json();body.result={...body.result,receiptDetail:{scrap:999},secretKey:'private-do-not-log'};
          return new Response(JSON.stringify(body),{status:r.status});}return r;};`);
    await drive(done,'unknown shelter receipt diagnosed');
    const records=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-income')`);
    assert.equal(records.length,1);assert.equal(records[0].data.receipt.message,'收取完成');
    assert.equal(records[0].data.receipt.amountStatus,'unknown-or-partial');
    assert.equal(records[0].data.reward['避难所金额待核对'],1);
    assert.equal(await evaluate(`${incomeTotals}['避难所废料']||0`),0);
    assert.ok(!JSON.stringify(records).includes('private-do-not-log'));assert.ok(!JSON.stringify(records).includes('999'));
    assert.ok(!JSON.stringify(records).includes((await evaluate('sm.calls[0]')).idempotencyKey));
  });
  await t.test('收入统计避难所：赛季各档独立累计，部分成功只记已确认档位',async()=>{
    for(const mode of ['success','partial']){
      await setupShelter(`${quiet}sm.view.state.season.points=300;sm.mode='${mode}';sm.resultMessages={claim_season:'奖励：30 废料 · 零件 +2'};`);
      await drive(done,'season income confirmed');
      assert.equal(await evaluate(`${incomeTotals}['避难所废料']`),mode==='success'?60:30);
      assert.equal(await evaluate(`${incomeTotals}['避难所零件']`),mode==='success'?4:2);
    }
  });
  const lateTab = label => `sm.delayedTab=true;const originalRender=renderShelter;
    window.renderShelter=()=>{originalRender();if(sm.delayedTab)
      [...document.querySelectorAll('[role="tablist"] button')].find(b=>b.textContent.startsWith('${label}'))?.remove();};`;
  const lastCollection = `(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-check').at(-1).data.collection`;
  const developmentScene = `${quiet}const s=sm.view.state,base=s.rooms[0],adult=s.residents[0];s.depth=3;s.digging=null;sm.view.progress.level=8;
    s.rooms=[...[1,2,3].map(floor=>({...base,id:100+floor,type:'elevator',floor,col:1})),
      ...['power','diner','water','scrap'].map((type,i)=>({...base,id:i+1,type,floor:1,col:i+2})),
      {...base,id:5,type:'quarters',floor:2,col:2,width:3},{...base,id:6,type:'storage',floor:3,col:2}];
    s.residents=Array.from({length:8},(_,i)=>({...structuredClone(adult),id:i+1,name:'居民'+(i+1),roomId:Math.floor(i/2)+1,
      xp:0,happiness:100,stats:{str:5,per:5,end:5,cha:5,int:5,agi:5,lck:5}}));s.resources.scrap=100;`;
  await t.test('避难所在建生产：预留施工岗位而不重复造房，工程完成后改为先补员且不自动消费',async()=>{
    await setupShelter(`${developmentScene}s.residents.push({...structuredClone(s.residents[0]),id:9,name:'闲置成人',roomId:null});
      s.rooms.push({...s.rooms.find(r=>r.id===4),id:30,col:6,builtAt:clock+600000});`);
    await drive(done,'pending scrap staffing reservation');
    let advice=await evaluate(`${state}.development`);assert.match(advice,/回收站.*施工.*预留 1 名/);
    assert.doesNotMatch(advice,/新建一格废料回收站/);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===30).builtAt=clock;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'construction completed');await drive(done,'staff completed room first');
    advice=await evaluate(`${state}.development`);assert.match(advice,/建设计划：先调人员。下一步：先补现有废料回收站岗位/);
    assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所在建供应：库存够时等升级，缓冲下降后允许预留人手用于更早的补救建设，刷新仍按当前库存评估',async()=>{
    await setupShelter(`${developmentScene}s.rooms.find(r=>r.id===2).upgradeAt=clock+3*3600000;
      s.residents.filter(p=>p.roomId===2).forEach(p=>p.roomId=5);
      s.residents.push({...structuredClone(s.residents[0]),id:9,name:'闲置成人',roomId:null});`);
    const fixtureSearch=await evaluate('location.search');
    await drive(done,'wait for existing diner upgrade');
    let advice=await evaluate(`${state}.development`);assert.match(advice,/餐厅.*完工.*覆盖供应/);assert.doesNotMatch(advice,/新建一格餐厅/);
    await evaluate(`sm.view.state.resources.food=5;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'review low food reserve');await drive(done,'allow earlier remedy');
    advice=await evaluate(`${state}.development`);assert.match(advice,/库存缓冲不足/);assert.match(advice,/新建一格餐厅/);assert.match(advice,/不能同时算两处产量/);
    await pulse(1000);await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'remedy remains after reload');
    assert.match(await evaluate(`${state}.development`),/新建一格餐厅/);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所建设计划：明确先攒料或可开工，床位宽裕时先回收，接近容量后转向宿舍',async()=>{
    await setupShelter(developmentScene);await drive(done,'save for scrap development');
    let advice=await evaluate(`${state}.development`);
    assert.match(advice,/建设计划：先攒资源。下一步：.*废料回收站/);
    assert.match(advice,/尚缺 100 废料/);assert.match(advice,/回本约/);
    await evaluate(`sm.view.state.resources.scrap=300;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'review construction funds');await drive(done,'construction ready');
    advice=await evaluate(`${state}.development`);assert.match(advice,/建设计划：条件已满足。下一步：.*废料回收站/);
    await evaluate(`sm.view.state.residents.push(...[9,10,11].map(id=>({...structuredClone(sm.view.state.residents[0]),id,name:'儿童'+id,roomId:5,adultAt:clock+3600000})));
      ${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'review approaching population capacity');await drive(done,'housing now takes priority');
    advice=await evaluate(`${state}.development`);assert.match(advice,/建设计划：条件已满足。下一步：.*新建一格宿舍/);
    const next=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-check').at(-1).data.developmentNext`);
    assert.equal(next.type,'quarters');assert.equal(next.status,'ready');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所在建人手：两种工程不能重复预留一人，增加专长人选后覆盖供应，刷新与完工重新评估',async()=>{
    await setupShelter(`${developmentScene}
      for(const type of ['diner','water'])s.rooms.find(r=>r.type===type).upgradeAt=clock+3600000;
      s.residents.filter(p=>[2,3].includes(p.roomId)).forEach(p=>p.roomId=5);
      s.residents.push({...structuredClone(s.residents[0]),id:9,name:'兼长居民',roomId:null});`);
    const fixtureSearch=await evaluate('location.search');
    await drive(done,'share one worker across committed rooms');
    let advice=await evaluate(`${state}.development`);
    assert.equal((advice.match(/完工后.*覆盖供应/g)||[]).length,1);
    assert.equal([...advice.matchAll(/为其空岗预留 (\d+) 名现有闲置成人/g)].reduce((n,m)=>n+Number(m[1]),0),1);
    assert.match(advice,/净水.*仍未达到.*供应准备线/);assert.doesNotMatch(advice,/新建一格废料回收站/);
    await evaluate(`{const s=sm.view.state;s.residents.push({...structuredClone(s.residents[0]),id:10,name:'餐厅专长',roomId:null,
      stats:{...s.residents[0].stats,agi:6,per:0}});${panel}.getElementById('shelter-check').click();}`);
    await drive(`location.pathname==='/shelter'`,'review additional worker');await drive(done,'two distinct workers cover both supplies');
    advice=await evaluate(`${state}.development`);assert.equal((advice.match(/完工后.*覆盖供应/g)||[]).length,2);
    assert.equal([...advice.matchAll(/为其空岗预留 (\d+) 名现有闲置成人/g)].reduce((n,m)=>n+Number(m[1]),0),2);
    await pulse(1000);await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'shared reservations remain after reload');
    advice=await evaluate(`${state}.development`);assert.equal((advice.match(/完工后.*覆盖供应/g)||[]).length,2);
    await evaluate(`{const s=sm.view.state;for(const type of ['diner','water']){const room=s.rooms.find(r=>r.type===type);room.upgradeAt=null;room.level=2;}
      ${panel}.getElementById('shelter-check').click();}`);
    await drive(`location.pathname==='/shelter'`,'review completed rooms');await drive(done,'staff real vacancies after completion');
    advice=await evaluate(`${state}.development`);assert.match(advice,/建设计划：先调人员。下一步：先补现有餐厅岗位/);
    assert.doesNotMatch(advice,/为其空岗预留/);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所下挖计划：楼层满先用现有升级，确需新宿舍才列下挖与后续建房费用',async()=>{
    await setupShelter(`${developmentScene}
      s.rooms.push({...base,id:20,type:'storage',floor:1,col:6,width:2},{...base,id:21,type:'storage',floor:2,col:5,width:3},
        {...base,id:22,type:'storage',floor:3,col:3,width:3},{...base,id:23,type:'storage',floor:3,col:6,width:2});`);
    await drive(done,'full floors do not force excavation');
    let advice=await evaluate(`${state}.development`);assert.match(advice,/先利用现有房间.*暂不下挖/);assert.doesNotMatch(advice,/向下扩至第/);
    await evaluate(`{const s=sm.view.state;s.rooms.find(r=>r.id===5).level=3;s.residents.forEach(p=>{p.stats.str=17;p.stats.agi=17;p.stats.per=17;});
      for(let id=9;id<=23;id++)s.residents.push({...structuredClone(s.residents[0]),id,name:'儿童'+id,roomId:5,adultAt:clock+3600000});
      const target=${panel}.getElementById('shelter-population');target.value='25';target.dispatchEvent(new Event('change'));
      ${panel}.getElementById('shelter-check').click();}`);
    await drive(`location.pathname==='/shelter'`,'review exhausted housing upgrades');await drive(done,'excavation has a concrete purpose');
    advice=await evaluate(`${state}.development`);
    assert.match(advice,/建设计划：先攒资源。下一步：向下扩至第 4 层，为宿舍腾出空间/);
    assert.match(advice,/836 废料/);assert.match(advice,/再建一格宿舍需 192 废料/);assert.match(advice,/两项合计 1028 废料/);
    assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所建设容量：无法攒够的升级不阻止必要下挖，也不先造工坊，已有扩仓后恢复等待升级',async()=>{
    await setupShelter(`${developmentScene}s.depth=2;s.rooms=s.rooms.filter(r=>r.floor<=2);
      s.rooms.find(r=>r.type==='quarters').level=2;
      s.rooms.push({...base,id:20,type:'medbay',floor:1,col:6,width:2},{...base,id:21,type:'medbay',floor:2,col:5,width:3});
      s.residents.forEach(p=>{p.stats.str=17;p.stats.agi=17;p.stats.per=17;});
      for(let id=9;id<=17;id++)s.residents.push({...structuredClone(s.residents[0]),id,name:'儿童'+id,roomId:5,adultAt:clock+3600000});
      s.resources.scrap=1000;s.resources.parts=0;localStorage.setItem('arkengine:auto-shelter:population:v1','20');`);
    const fixtureSearch=await evaluate('location.search');
    await drive(done,'housing expansion despite impossible upgrade');
    let advice=await evaluate(`${state}.development`);
    assert.match(advice,/建设计划：条件已满足。下一步：向下扩至第 3 层，为宿舍/);
    assert.match(advice,/2160 废料.*超过.*库存容量/);assert.match(advice,/两项合计 751 废料/);
    assert.doesNotMatch(advice,/为工坊腾出空间|备选升级至少还缺/);
    await pulse(1000);await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'housing expansion remains after refresh');
    assert.match(await evaluate(`${state}.development`),/下一步：向下扩至第 3 层，为宿舍/);
    await evaluate(`{const s=sm.view.state;Object.assign(s.rooms.find(r=>r.id===20),{type:'storage',builtAt:clock+600000});
      s.resources.parts=45;${panel}.getElementById('shelter-check').click();}`);
    await drive(`location.pathname==='/shelter'`,'review committed storage capacity');await drive(done,'wait for capacity before housing upgrade');
    advice=await evaluate(`${state}.development`);
    assert.match(advice,/建设计划：先满足条件。下一步：.*宿舍升至 3 级/);
    assert.match(advice,/已开工工程.*容量尚未生效/);assert.doesNotMatch(advice,/向下扩至第/);
    const next=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-check').at(-1).data.developmentNext`);
    assert.equal(next.kind,'upgrade');assert.equal(next.type,'quarters');assert.equal(next.status,'blocked');
    assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所升级取舍：主餐厅停产储备不足时选择另一间，刷新保持且库存补足后重算',async()=>{
    await setupShelter(`${developmentScene}s.rooms.find(r=>r.type==='quarters').level=2;
      s.rooms.push({...s.rooms.find(r=>r.id===2),id:30,floor:3,col:3});
      s.residents.filter(p=>p.roomId===2).forEach(p=>p.stats.agi=1);
      s.residents.filter(p=>p.roomId===3).forEach(p=>p.stats.per=17);
      for(const id of [9,10])s.residents.push({...structuredClone(s.residents[0]),id,name:'餐厅'+id,roomId:30,stats:{...s.residents[0].stats,agi:0}});
      for(let id=11;id<=16;id++)s.residents.push({...structuredClone(s.residents[0]),id,name:'儿童'+id,roomId:5,adultAt:clock+3600000});
      s.resources.food=39;s.resources.scrap=500;localStorage.setItem('arkengine:auto-shelter:population:v1','16');`);
    const fixtureSearch=await evaluate('location.search');
    await drive(done,'choose safe diner upgrade');
    assert.match(await evaluate(`${state}.development`),/建设计划：条件已满足。下一步：第 3 层餐厅升至 2 级/);
    await pulse(1000);await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'safe alternative persists after reload');
    assert.match(await evaluate(`${state}.development`),/下一步：第 3 层餐厅升至 2 级/);
    await evaluate(`sm.view.state.resources.food=40;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'review larger food reserve');await drive(done,'higher gain diner becomes safe');
    assert.match(await evaluate(`${state}.development`),/建设计划：条件已满足。下一步：第 1 层餐厅升至 2 级/);
    await evaluate(`sm.view.state.resources.food=37;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'review insufficient reserve for either room');await drive(done,'retain safety block');
    const advice=await evaluate(`${state}.development`);assert.match(advice,/建设计划：先满足条件/);assert.match(advice,/停产期间食物需至少 40 库存/);
    const next=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-check').at(-1).data.developmentNext`);
    assert.equal(next.type,'diner');assert.equal(next.status,'blocked');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所升级取舍：宽回收站供电不足时保留小房间增产，供电改善后重新比较回本',async()=>{
    await setupShelter(`${developmentScene}const scrap=s.rooms.find(r=>r.id===4);scrap.width=3;
      s.rooms.find(r=>r.type==='quarters').level=2;s.rooms.push({...scrap,id:30,width:1,floor:3,col:3});
      s.residents.filter(p=>p.roomId===1).forEach(p=>p.stats.str=1);
      s.residents.filter(p=>p.roomId===2).forEach(p=>p.stats.agi=17);
      s.residents.filter(p=>p.roomId===3).forEach(p=>p.stats.per=17);
      s.residents.filter(p=>p.roomId===4).forEach(p=>p.stats.end=17);
      for(let id=9;id<=12;id++)s.residents.push({...structuredClone(s.residents[0]),id,name:'回收'+id,roomId:4,stats:{...s.residents[0].stats,end:17}});
      for(const id of [13,14])s.residents.push({...structuredClone(s.residents[0]),id,name:'回收'+id,roomId:30,stats:{...s.residents[0].stats,end:0}});
      s.resources.scrap=1000;`);
    await drive(done,'choose smaller upgrade within power margin');
    assert.match(await evaluate(`${state}.development`),/建设计划：条件已满足。下一步：第 3 层废料回收站升至 2 级/);
    await evaluate(`sm.view.state.residents.filter(p=>p.roomId===1).forEach(p=>p.stats.str=5);${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'review stronger power workers');await drive(done,'select shorter payback upgrade');
    assert.match(await evaluate(`${state}.development`),/建设计划：条件已满足。下一步：第 1 层废料回收站升至 2 级/);
    assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所零件时机：远期宿舍缺料不提前造工坊，刷新保持，当前生产升级需要时再准备',async()=>{
    await setupShelter(`${developmentScene}s.rooms.find(r=>r.type==='quarters').level=2;
      s.rooms.find(r=>r.type==='scrap').level=3;s.resources.scrap=1000;
      localStorage.setItem('arkengine:auto-shelter:population:v1','20');`);
    const fixtureSearch=await evaluate('location.search');await drive(done,'defer distant housing materials');
    let advice=await evaluate(`${state}.development`);
    assert.match(advice,/建设计划：等待时机。下一步：先发展人口/);
    assert.match(advice,/后续规划.*宿舍升至 3 级.*45 零件/);
    assert.doesNotMatch(advice,/新建一格工坊|备选升级至少还缺/);
    await pulse(1000);await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'distant housing remains deferred after reload');
    assert.doesNotMatch(await evaluate(`${state}.development`),/新建一格工坊|备选升级至少还缺/);
    await evaluate(`sm.view.state.rooms.find(r=>r.type==='scrap').level=2;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'review current production upgrade');await drive(done,'prepare only current upgrade materials');
    advice=await evaluate(`${state}.development`);assert.match(advice,/新建一格工坊/);
    assert.match(advice,/备选升级至少还缺 15 零件/);assert.doesNotMatch(advice,/备选升级至少还缺 45 零件/);
    assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所零件时机：优先新建回收站不被备选升级的工坊抢先，人选变化后重新安排',async()=>{
    await setupShelter(`${developmentScene}s.rooms.find(r=>r.type==='scrap').level=2;
      s.residents.push({...structuredClone(s.residents[0]),id:9,name:'闲置回收专长',roomId:null,stats:{...s.residents[0].stats,end:17}});`);
    const fixtureSearch=await evaluate('location.search');await drive(done,'build scrap before optional workshop');
    let advice=await evaluate(`${state}.development`);
    assert.match(advice,/建设计划：条件已满足。下一步：.*新建一格废料回收站/);
    assert.match(advice,/暂不为这些备选方案提前安排工坊/);assert.doesNotMatch(advice,/新建一格工坊|备选升级至少还缺/);
    await pulse(1000);await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'preferred build survives reload');
    assert.match(await evaluate(`${state}.development`),/下一步：.*新建一格废料回收站/);
    await evaluate(`sm.view.state.residents.find(p=>p.id===9).roomId=5;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'review unavailable idle worker');await drive(done,'upgrade materials become relevant');
    advice=await evaluate(`${state}.development`);assert.match(advice,/备选升级至少还缺 15 零件/);assert.match(advice,/新建一格工坊/);
    const next=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-check').at(-1).data.developmentNext`);
    assert.equal(next.type,'workshop');assert.equal(next.status,'saving');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所页签等待：产出、目标或图鉴页签晚到时同轮继续，不把缺页签当作没有奖励',async()=>{
    for(const [label,seed,action] of [['避难所','sm.view.state.rooms[0].stored=30;','collect_all'],
      ['目标','sm.dailyIncomplete=false;','claim_objective'],['图鉴','sm.achievementIncomplete=false;','claim_achievement']]) {
      await setupShelter(`${quiet}${seed}${lateTab(label)}`);
      await until(async()=>/等待避难所.*页签/.test(await expStatus()),'wait for missing tab');
      await pulse(5000);
      assert.equal(await evaluate('location.pathname'),'/shelter');
      assert.deepEqual(await evaluate('sm.calls'),[]);
      await evaluate('sm.delayedTab=false;renderShelter();');
      await drive(done,'resume the same visit after tabs render');
      assert.ok(await evaluate(`sm.calls.some(c=>c.type==='${action}')`));
      assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-ui-ready').length`),1);
    }
  });
  await t.test('避难所页签等待：持续缺失只等十五秒，记录未检查产出并返回远征，不连续请求',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;${lateTab('避难所')}`);
    await until(async()=>/等待避难所.*页签/.test(await expStatus()),'initial missing tab');
    await pulse(16000);await drive(done,'bounded tab wait');
    assert.equal(await evaluate(enabled),'true');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.match(await evaluate(`${state}.note`),/页签.*未就绪/);
    assert.equal(await evaluate(`${lastCollection}.rooms[0].reason`),'not-checked');
    assert.equal(await evaluate(`${lastCollection}.rooms[0].stored`),30);
    const reads=await evaluate('sm.reads');assert.ok(reads<=3);
    await pulse(60000);assert.equal(await evaluate('sm.reads'),reads);
  });
  await t.test('避难所页签等待：等待期间独立暂停或总暂停，页面恢复也不能继续领取',async()=>{
    for(const control of ['shelter-toggle','toggle']) {
      await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;${lateTab('避难所')}`);
      await until(async()=>/等待避难所.*页签/.test(await expStatus()),'waiting before manual pause');
      await evaluate(`${panel}.getElementById('${control}').click();sm.delayedTab=false;renderShelter();`);
      await pulse(20000);await pulse(5000);
      assert.deepEqual(await evaluate('sm.calls'),[]);
      assert.equal(await evaluate(`localStorage.getItem('${control==='toggle'?'arkengine:auto-expedition:enabled:v1':'arkengine:auto-shelter:enabled:v1'}')`),'false');
    }
  });
  await t.test('避难所产出诊断：区分未满批、无人生产、缺材料、容量不足和按钮未就绪',async()=>{
    for(const [seed,reason] of [
      [`sm.view.state.rooms[0].stored=12;`,'not-full'],
      [`sm.view.state.residents[0].roomId=null;`,'no-workers'],
      [`sm.view.state.rooms[0].incident={kind:'fire'};`,'production-stopped'],
      [`sm.view.state.rooms[0].type='workshop';sm.view.state.resources.scrap=0;`,'materials-short'],
      [`sm.view.state.rooms[0].stored=30;sm.view.state.resources.scrap=2100;`,'capacity-blocked'],
      [`sm.view.state.rooms[0].stored=30;const originalRender=renderShelter;window.renderShelter=()=>{originalRender();
        [...game.querySelectorAll('button')].filter(b=>b.textContent==='全部收取'||b.getAttribute('aria-label')==='收取废料').forEach(b=>b.remove());};`,'controls-not-ready']]) {
      await setupShelter(`${quiet}${seed}`);await drive(done,'production reason logged');
      const collection=await evaluate(lastCollection),room=collection.rooms[0];
      assert.equal(room.reason,reason);assert.equal(room.id,1);
      assert.ok(Number.isFinite(room.stored)&&room.batch>0&&Number.isFinite(room.rate));
      assert.equal(collection.assessed,true);assert.ok(collection.checkedAt>=collection.serverTime);
      assert.deepEqual(await evaluate('sm.calls'),[]);
      assert.match(await evaluate(`${state}.operations`),/产出核对/);
      assert.doesNotMatch(JSON.stringify(collection),/居民甲|idempotencyKey|vaultNo/);
    }
  });
  await t.test('避难所产出诊断：领取确认后记录新库存，不把已收取产出继续显示为待领',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;`);await drive(done,'collect and refresh production diagnostics');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.equal(await evaluate(`${lastCollection}.rooms[0].stored`),0);
    assert.equal(await evaluate(`${lastCollection}.rooms[0].reason`),'not-full');
  });
  const pausedSeason=`${quiet}sm.view.state.season.points=300;
    window.shelterTransport=async(u,o)=>{const response=await fetch(u,o);
      if(JSON.parse(o.body).action.tier===1)await new Promise(resolve=>{window.continueOldBatch=resolve;});return response;};`;
  const oldSnapshot=kind=>`${quiet}
    sm.snapshotAt=clock-60001;sm.view.state.lastSettledAt=sm.snapshotAt;
    sm.view.state.residents[0].outfitId=8;sm.view.state.stats.collected=30;
    sm.view.state.tutorial.claimed=[1];sm.view.state.achievements=['collect-10k'];
    sm.view.state.daily.claimed=[0];sm.view.state.season.claimedFree=[1];
    localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'original-${kind}',kind:'${kind}',
      targets:${JSON.stringify({assign:[1,1],equip:[1,8],collect:[1],tutorial:[1],achievement:['collect-10k'],daily:[0],season:[1]}[kind])},
      at:clock-60000,vaultNo:77,before:{collected:0,serverTime:clock-60000,day:'2026-10-10',month:'2026-10',
        room:null,outfit:null,rooms:[{id:1,stored:30}]}}));`;
  await t.test('避难所页签等待：页签缺失不阻断原领取的只读确认，也不能重新领取',async()=>{
    await setupShelter(`${oldSnapshot('collect')}sm.snapshotAt=clock;${lateTab('避难所')}`);
    await drive(`${pending}===null`,'reconcile original collect without rendered tabs');
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await until(async()=>/等待避难所.*页签/.test(await expStatus()),'only new actions wait for tabs');
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-confirmed').length`),1);
  });
  for(const [label,kinds] of [['人员',['assign','equip']],['产出',['collect']],['奖励',['tutorial','achievement','daily','season']]]){
    await t.test(`避难所过期快照${label}：状态看似达到目标但时间早于原操作时保留记录，更新后才确认`,async()=>{
      for(const kind of kinds){
        await setupShelter(oldSnapshot(kind));await drive(done,'outdated matching snapshot handled');
        assert.equal(await evaluate(`${pending}?.id`),`original-${kind}`,'早于原操作的快照不能证明原结果');
        assert.equal(await evaluate(enabled),'true');assert.deepEqual(await evaluate('sm.calls'),[]);
        assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-confirmed').length`),0);
        assert.match(await evaluate(`${state}.note`),/快照时间早于原操作/);
        assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='shelter-pending-wait')?.data.reason`),'snapshot-before-request');
        await evaluate(`sm.snapshotAt=clock;sm.view.state.lastSettledAt=clock;${panel}.getElementById('shelter-check').click();`);
        await drive(`location.pathname==='/shelter'`,'fresh read visit');await drive(done,'current matching snapshot confirmed');
        assert.equal(await evaluate(pending),null);assert.deepEqual(await evaluate('sm.calls'),[]);
        assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-confirmed').length`),1);
      }
    });
  }
  await t.test('避难所过期快照刷新：原记录和只读预约跨刷新保留，数据恢复后仅确认一次',async()=>{
    await setupShelter(oldSnapshot('assign'));const fixtureSearch=await evaluate('location.search');
    await drive(done,'stale assignment waiting');
    const original=await evaluate(pending),nextAt=await evaluate(`${state}.nextAt`);
    await pulse(1000);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await pulse(1000);
    assert.deepEqual(await evaluate(pending),original);assert.equal(await evaluate(`${state}.nextAt`),nextAt);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await pulse(300000);await drive(`location.pathname==='/shelter'`,'scheduled stale recheck');await drive(done,'stale wait preserved after reload');
    assert.deepEqual(await evaluate(pending),original);assert.equal(await evaluate(enabled),'true');
    await evaluate(`sm.snapshotAt=clock;sm.view.state.lastSettledAt=clock;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'restored read after reload');await drive(done,'original assignment confirmed');
    assert.equal(await evaluate(pending),null);assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-confirmed').length`),1);
  });
  await t.test('避难所过期快照兼容：等于原快照时间可按状态确认，缺少旧时间的历史记录仍沿用原规则',async()=>{
    for(const legacy of [false,true]){
      await setupShelter(`${oldSnapshot('assign')}const old=${pending};
        if(${legacy})delete old.before.serverTime;else sm.snapshotAt=old.before.serverTime;
        localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(old));`);
      await drive(done,'compatible historical assignment');
      assert.equal(await evaluate(pending),null);assert.deepEqual(await evaluate('sm.calls'),[]);
      assert.equal(await evaluate(enabled),'true');
    }
  });
  await t.test('避难所批次刷新：首档成功但后档尚未发出，刷新后核对并只领取剩余档位',async()=>{
    await setupShelter(pausedSeason);await drive('sm.calls.length===1','first tier sent before reload');
    await until(()=>evaluate(`${pending}?.result?.rewardProofs?.length===1`),'first success receipt saved');
    await reloadShelter();await drive(`${pending}===null&&sm.calls.length===2&&${done}`,'reloaded batch resumes from remaining tier');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1,2]);assert.equal(await evaluate(enabled),'true');
    assert.equal(await evaluate('sm.view.state.resources.scrap'),449);
  });
  await t.test('避难所批次持久化：发送进度无法保存时不发请求，保留原记录并暂停',async()=>{
    await setupShelter(`${quiet}sm.view.state.season.points=150;const save=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){if(k==='arkengine:auto-shelter:pending:v1'&&JSON.parse(v)?.sentCount>0)throw Error('fixture write blocked');
        return save.call(this,k,v);};`);
    await drive(`sm.calls.length>0||${enabled}==='false'`,'journal or original transport reached');
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(enabled),'false');
    assert.deepEqual(await evaluate(`${pending}.targets`),[1]);
  });
  await t.test('避难所批次存活：原页后续回调尚存时，不提前裁剪或新建批次',async()=>{
    await setupShelter(pausedSeason);await drive('sm.calls.length===1','live first tier');
    await until(()=>evaluate(`${pending}?.result?.rewardProofs?.length===1`),'first live receipt');
    const original=await evaluate(pending);await pulse(10000);await pulse();
    assert.deepEqual(await evaluate(`${pending}.targets`),[1,2]);assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.equal(await evaluate(`${pending}.sentCount`),1);assert.equal(await evaluate('sm.calls.length'),1);
    await evaluate('window.continueOldBatch();');await drive(`${pending}===null&&${done}`,'live batch finishes normally');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1,2]);assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所批次恢复：未知首档跨刷新只核对已发送范围，不补领首档或后档',async()=>{
    await setupShelter(`${quiet}sm.view.state.season.points=300;sm.mode='unknown';`);
    await drive('sm.calls.length===1','unknown first tier sent');
    const original=await evaluate(pending);assert.equal(original.sentCount,1);
    await reloadShelter();await drive(waiting,'only attempted prefix awaits reconciliation');
    const restored=await evaluate(pending);assert.equal(restored.id,original.id);assert.deepEqual(restored.before,original.before);
    assert.deepEqual(restored.targets,[1]);assert.equal(restored.sentCount,1);assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('避难所批次兼容：缺少发送进度的旧记录保留全部目标，不推断未发送',async()=>{
    await setupShelter(`${quiet}sm.view.state.season.points=300;sm.view.state.season.claimedFree=[1];
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'legacy-batch',kind:'season',targets:[1,2],vaultNo:77,
        at:clock-60000,before:{collected:0,serverTime:clock-60000,day:'2026-10-10',month:'2026-10'}}));`);
    const original=await evaluate(pending);await drive(waiting,'legacy batch remains conservative');
    assert.deepEqual(await evaluate(pending),original);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所批次校验：损坏的发送进度保留原文且不发送',async()=>{
    for(const count of [0,-1,1.5,'1',3,null]){
      await setupShelter(`${quiet}sm.view.state.season.points=300;
        localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'broken-batch',kind:'season',targets:[1,2],vaultNo:77,
          sentCount:${JSON.stringify(count)},at:clock-60000,before:{collected:0,day:'2026-10-10',month:'2026-10'}}));`);
      const raw=await evaluate(`localStorage.getItem('arkengine:auto-shelter:pending:v1')`);
      await drive(`/记录|暂停|停止/.test(${panel}.getElementById('shelter-status').textContent)`,'invalid progress stopped');await pulse(60000);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:pending:v1')`),raw);
      assert.deepEqual(await evaluate('sm.calls'),[]);
    }
  });
  for(const release of [true,false])await t.test(`避难所批次接力：新页完成剩余档位，旧页${release?'恢复回调不再续发':'清理悬挂回调后继续'}`,async()=>{
    await setupShelter(`${pausedSeason}
      window.fixtureFreezeInstalled=true;document.addEventListener('freeze',()=>{window.fixtureFrozenEvent=true;localStorage.setItem('fixture:shelter-frozen','true');});
      document.addEventListener('resume',()=>{
        const server=JSON.parse(localStorage.getItem('fixture:shelter-server')||'null');
        if(server){Object.assign(sm,server.sm);clock=server.clock+2*3600000;${release?'window.continueOldBatch();':''}}
      });`);
    await drive('sm.calls.length===1','first tier held for takeover');
    await until(()=>evaluate(`${pending}?.result?.rewardProofs?.length===1`),'first receipt before takeover');
    const first=await evaluate('sm.calls[0]'),second=await secondShelter();let server;
    try{
      await second.withFrozenOriginal(async()=>{
        await until(()=>second.evaluate(`localStorage.getItem('fixture:shelter-frozen')==='true'`),'original frozen');
        for(let i=0;i<40;i++){
          if(await second.evaluate(`${pending}===null&&sm.calls.length===1&&${done}`))break;
          await second.pulse();
        }
        assert.deepEqual(await second.evaluate('sm.calls.map(c=>c.tier)'),[2]);assert.equal(await second.evaluate(pending),null);
        server=await second.evaluate('({sm,clock})');server.sm.calls.unshift(first);
        await second.evaluate(`localStorage.setItem('fixture:shelter-server',${JSON.stringify(JSON.stringify(server))});`);
      });
    }finally{await second.close();}
    if(!release)await restoreReloadedShelter(server);
    await drive(done,'old page returns without duplicate batch');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1,2]);assert.equal(await evaluate(enabled),'true');
    assert.equal(await evaluate('sm.view.state.resources.scrap'),449);assert.equal(await evaluate(pending),null);
  });
  await t.test('避难所周期发送：首请求发出前已换日或换月，撤销旧目标并重新预约',async()=>{
    for(const kind of ['daily','season']){
      const oldDay=kind==='daily'?'2026-10-10':'2026-10-31',newDay=kind==='daily'?'2026-10-11':'2026-11-01';
      await setupShelter(`${quiet}clock=Date.parse('${oldDay}T23:59:45+08:00');sm.view.state.lastSettledAt=clock;
        sm.view.state.daily.day='${oldDay}';${kind==='daily'?`sm.dailyIncomplete=false;sm.view.state.daily.claimed=[1,2];`:`sm.view.state.season.points=150;`}
        window.shelterTransport=(u,o)=>{clock=Date.parse('${newDay}T00:00:01+08:00');sm.view.state.lastSettledAt=clock;
          sm.dailyIncomplete=true;sm.view.state.daily={day:'${newDay}',claimed:[]};sm.view.state.season={month:'${newDay.slice(0,7)}',points:0,claimedFree:[]};
          return fetch(u,o);};`);
      await drive(done,'expired first reward returns for fresh period');
      assert.deepEqual(await evaluate('sm.calls'),[],kind);assert.equal(await evaluate(pending),null);
      assert.equal(await evaluate(enabled),'true');assert.match(await evaluate(`${state}.note`),/周期|换日|换月/);
    }
  });
  await t.test('避难所周期排队：重新读取已换日但旧按钮还可点时，不沿用旧目标',async()=>{
    await setupShelter(`${quiet}clock=Date.parse('2026-10-10T23:59:45+08:00');sm.view.state.lastSettledAt=clock;
      sm.dailyIncomplete=false;sm.view.state.daily.claimed=[1,2];`);
    await drive(`/随机等待.*今日目标/.test(${panel}.getElementById('status').textContent)`,'old daily button queued');
    await evaluate(`clock=Date.parse('2026-10-11T00:00:01+08:00');sm.view.state.lastSettledAt=clock;
      sm.view.state.daily={day:'2026-10-11',claimed:[]};sm.dailyIncomplete=true;`);
    await pulse();await drive(done,'do not act on old daily DOM after fresh read');
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate(enabled),'true');
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(done,'fresh visit sees incomplete new objectives');
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate(`sm.dailyIncomplete=false;sm.view.state.daily.claimed=[1,2];${panel}.getElementById('shelter-check').click();`);
    await drive(`${pending}===null&&sm.calls.length===1&&${done}`,'new completed daily reward remains available');
    assert.equal(await evaluate('sm.calls[0].type'),'claim_objective');
  });
  await t.test('避难所周期批次：首档后换月只核对已发送档，重新读取后才处理新赛季',async()=>{
    await setupShelter(`${quiet}clock=Date.parse('2026-10-31T23:59:45+08:00');sm.view.state.lastSettledAt=clock;
      sm.view.state.daily.day='2026-10-31';sm.view.state.season.points=300;
      window.shelterTransport=(u,o)=>fetch(u,o).then(response=>{if(!sm.rolled&&JSON.parse(o.body).action.tier===1){
        sm.rolled=true;clock=Date.parse('2026-11-01T00:00:01+08:00');sm.view.state.lastSettledAt=clock;
        sm.view.state.daily.day='2026-11-01';sm.view.state.season={month:'2026-11',points:0,claimedFree:[]};}return response;});`);
    await drive(done,'old batch ends before next-period tier');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1]);
    assert.deepEqual(await evaluate(`${pending}.targets`),[1]);assert.equal(await evaluate(enabled),'true');
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(`${pending}===null&&${done}`,'sent old tier confirmed');
    await evaluate(`sm.view.state.season.points=300;${panel}.getElementById('shelter-check').click();`);
    await drive(`${pending}===null&&sm.calls.length===3&&${done}`,'new season evaluated afresh');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1,1,2]);
  });
  await t.test('避难所周期迟到批次：只读等待后跨月回执到达，撤销未发送档且保留已发送结果',async()=>{
    await setupShelter(`${quiet}clock=Date.parse('2026-10-31T23:59:00+08:00');sm.view.state.lastSettledAt=clock;
      sm.view.state.daily.day='2026-10-31';sm.view.state.season.points=300;
      const previous=window.fetch,drawShelter=renderShelter;
      window.renderShelter=()=>location.pathname==='/shelter'?drawShelter():renderExp();
      window.fetch=(u,o)=>{const response=previous(u,o);return u==='/api/shelter/action'?
        response.then(result=>new Promise(resolve=>{sm.releaseOldTier=()=>resolve(result);})):response;};`);
    await drive('sm.calls.length===1','old first tier sent');await pulse(31000);await drive(waiting,'old batch read-only wait');
    await evaluate(`clock=Date.parse('2026-11-01T00:01:00+08:00');sm.view.state.lastSettledAt=clock;
      sm.view.state.daily.day='2026-11-01';sm.view.state.season={month:'2026-11',points:0,claimedFree:[]};sm.releaseOldTier();`);
    await until(()=>evaluate(`${pending}?.result?.rewardProofs?.length===1&&!sm.busy`),'old tier proof received after month change');
    assert.deepEqual(await evaluate(`${pending}.targets`),[1]);assert.equal(await evaluate(enabled),'true');
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(`${pending}===null&&${done}`,'late old batch resolved');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1]);
  });
  await t.test('避难所周期人工暂停：跨月迟到回执不解除独立或总暂停，也不改人工停止说明',async()=>{
    for(const control of ['shelter-toggle','toggle']){
      await setupShelter(`${quiet}clock=Date.parse('2026-10-31T23:59:00+08:00');sm.view.state.lastSettledAt=clock;
        sm.view.state.daily.day='2026-10-31';sm.view.state.season.points=300;
        const previous=window.fetch,drawShelter=renderShelter;
        window.renderShelter=()=>location.pathname==='/shelter'?drawShelter():renderExp();
        window.fetch=(u,o)=>{const response=previous(u,o);return u==='/api/shelter/action'?
          response.then(result=>new Promise(resolve=>{sm.releaseOldTier=()=>resolve(result);})):response;};`);
      await drive('sm.calls.length===1','first tier before pause');await pulse(31000);await drive(waiting,'waiting before pause');
      await evaluate(`${panel}.getElementById('${control}').click();`);const note=await evaluate(`${state}.note`);
      await evaluate(`clock=Date.parse('2026-11-01T00:01:00+08:00');sm.view.state.lastSettledAt=clock;
        sm.view.state.daily.day='2026-11-01';sm.view.state.season={month:'2026-11',points:0,claimedFree:[]};sm.releaseOldTier();`);
      await until(()=>evaluate(`${pending}?.result?.rewardProofs?.length===1&&!sm.busy`),'proof while paused');await pulse(3600000);
      assert.equal(await evaluate(`localStorage.getItem('${control==='toggle'?'arkengine:auto-expedition:enabled:v1':'arkengine:auto-shelter:enabled:v1'}')`),'false');
      assert.equal(await evaluate(`${state}.note`),note);assert.deepEqual(await evaluate(`${pending}.targets`),[1,2]);
      assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1]);
    }
  });
  await t.test('避难所跨周期：每日与赛季成功回执跨刷新保留，重置后仍确认旧奖励且不重领',async()=>{
    for(const kind of ['daily','season']){
      await setupShelter(`${quiet}${kind==='daily'?`sm.dailyIncomplete=false;sm.view.state.daily.claimed=[1,2];`:`sm.view.state.season.points=300;`}`);
      await drive(`sm.calls.filter(c=>c.type==='${kind==='daily'?'claim_objective':'claim_season'}').length===${kind==='daily'?1:2}`,'original periodic rewards sent');
      await until(()=>evaluate(`${pending}?.result?.rewardProofs?.length===${kind==='daily'?1:2}`),'period evidence captured before reset');
      const newDay=kind==='daily'?'2026-10-11':'2026-11-01';
      await evaluate(`clock=Date.parse('${newDay}T12:00:00+08:00');sm.view.state.lastSettledAt=clock;
        sm.dailyIncomplete=true;sm.view.state.daily={day:'${newDay}',claimed:[]};sm.view.state.season={month:'${newDay.slice(0,7)}',points:0,claimedFree:[]};`);
      await reloadShelter();await drive(`${pending}===null&&${done}`,'old reward confirmed after period reset');
      assert.equal(await evaluate('sm.calls.length'),kind==='daily'?1:2);
      assert.equal(await evaluate(enabled),'true');assert.equal(await evaluate(`${state}.pendingReadOnly`),undefined);
    }
  });
  await t.test('避难所跨周期迟到：昨日原回执今日才到，仍确认原领取且不占用今日奖励',async()=>{
    await setupShelter(`${quiet}sm.dailyIncomplete=false;sm.view.state.daily.claimed=[1,2];
      const previous=window.fetch,drawShelter=renderShelter;
      window.renderShelter=()=>location.pathname==='/shelter'?drawShelter():renderExp();
      window.fetch=(u,o)=>{const response=previous(u,o);return u==='/api/shelter/action'?
        response.then(result=>new Promise(resolve=>{sm.releaseDaily=()=>resolve(result);})):response;};`);
    await drive('sm.calls.length===1','daily request before rollover');
    await evaluate(`clock+=86400000;sm.view.state.lastSettledAt=clock;sm.view.state.daily={day:'2026-10-11',claimed:[]};sm.dailyIncomplete=true;`);
    await pulse();await drive(waiting,'new day cannot yet confirm yesterday');
    const original=await evaluate(`${pending}.id`);
    await evaluate('sm.releaseDaily();');await until(()=>evaluate(`${pending}?.result?.rewardProofs?.length===1`),'late prior-day proof persisted');
    assert.equal(await evaluate(`${pending}.id`),original);
    assert.equal(await evaluate(`${pending}.result.rewardProofs[0].period`),'2026-10-10');
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(`${pending}===null&&${done}`,'prior-day receipt releases wait');
    assert.equal(await evaluate('sm.calls.length'),1);assert.deepEqual(await evaluate('sm.view.state.daily.claimed'),[]);
    assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所跨周期隔离：新周期同编号奖励和HTTP成功不能代替旧凭据',async()=>{
    for(const kind of ['daily','season']){
      await setupShelter(`${quiet}sm.view.state.daily={day:'2026-10-11',claimed:[0]};sm.view.state.season={month:'2026-11',points:0,claimedFree:[1]};
        localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old-period',kind:'${kind}',targets:[${kind==='daily'?0:1}],
          vaultNo:77,at:clock-60000,before:{collected:0,serverTime:clock-60000,day:'2026-10-10',month:'2026-10'},result:{status:200,outcome:'ok'}}));`);
      const original=await evaluate(pending);await drive(waiting,'new period cannot replace old outcome');
      assert.deepEqual(await evaluate(pending),original);assert.deepEqual(await evaluate('sm.calls'),[]);
    }
  });
  await t.test('避难所跨周期部分批次：仅首档成功的凭据不能确认其他档，新赛季相同档也不补全',async()=>{
    await setupShelter(`${quiet}sm.view.state.season.points=300;sm.mode='partial';`);
    await drive(waiting,'partial season waits');
    assert.deepEqual(await evaluate(`${pending}.result.rewardProofs.map(p=>p.target)`),[1]);
    const original=await evaluate(pending);
    await pulse();await evaluate(`history.replaceState({},'','/shelter?shelter-fixture=partial-rollover');
      clock=Date.parse('2026-11-01T12:00:00+08:00');sm.view.state.lastSettledAt=clock;
      sm.view.state.season={month:'2026-11',points:300,claimedFree:[1,2]};`);
    await reloadShelter();await drive(waiting,'incomplete old season still unresolved');
    assert.deepEqual(await evaluate(pending),original);assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1,2]);
  });
  const lateCollection=`${quiet}sm.view.state.rooms[0].stored=30;sm.oldCollectionRead=true;
    const drawShelter=renderShelter;window.renderShelter=()=>location.pathname==='/shelter'?drawShelter():renderExp();
    const beforeCollection=structuredClone(sm.view.state),nativeCollectionFetch=window.fetch;
    window.fetch=(u,o)=>{
      if(u==='/api/shelter'&&sm.oldCollectionRead){sm.reads++;return Promise.resolve(new Response(JSON.stringify({...shelterData(),state:beforeCollection})));}
      const result=nativeCollectionFetch(u,o);
      return u==='/api/shelter/action'&&o?.method==='POST'?result.then(response=>new Promise(resolve=>{sm.releaseCollectionReceipt=()=>resolve(response);})):result;
    };`;
  await t.test('避难所迟到恢复：超时后限频只读核对，成功回执迟到后继续且不重复领取',async()=>{
    await setupShelter(lateCollection);await drive('sm.calls.length===1','original collection sent');
    const original=await evaluate(`${pending}.id`);
    await pulse(31000);await drive(`location.pathname==='/activities/expedition'`,'yield during pending verification');
    assert.equal(await evaluate(enabled),'true','uncertain result must not permanently turn off the feature');
    assert.equal(await evaluate(`${state}.pendingReadOnly`),original);
    assert.ok(await evaluate(`${state}.nextAt-clock>240000&&${state}.nextAt-clock<=300000`));
    const reads=await evaluate('sm.reads');await pulse(60000);
    assert.equal(await evaluate('sm.reads'),reads);assert.equal(await evaluate('sm.calls.length'),1);
    await evaluate('sm.oldCollectionRead=false;sm.releaseCollectionReceipt();');
    await until(()=>evaluate(`Boolean(${pending}?.result?.proof)`),'late original receipt persisted');
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(`${pending}===null&&${done}`,'resume after original result confirmed');
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(enabled),'true');
    await evaluate(`sm.view.state.rooms[0].stored=30;${panel}.getElementById('shelter-check').click();`);
    await drive('sm.calls.length===2','a later new batch is allowed');
    await evaluate('sm.releaseCollectionReceipt();');await drive(`${pending}===null&&${done}`,'new batch confirmed');
    assert.equal(await evaluate('sm.view.state.resources.scrap'),329);
  });
  await t.test('避难所迟到暂停：等待核对时人工暂停，晚到成功回执与刷新都不能擅自恢复',async()=>{
    await setupShelter(lateCollection);await drive('sm.calls.length===1','collection before manual pause');
    await pulse(31000);await drive(`location.pathname==='/activities/expedition'`,'pending check returns');
    assert.equal(await evaluate(enabled),'true');
    await evaluate(`${panel}.getElementById('shelter-toggle').click();sm.oldCollectionRead=false;sm.releaseCollectionReceipt();`);
    await until(()=>evaluate(`Boolean(${pending}?.result?.proof)`),'late proof while manually paused');
    await pulse(3600000);assert.equal(await evaluate(enabled),'false');assert.equal(await evaluate('sm.calls.length'),1);
    await evaluate(`history.replaceState({},'','/shelter?shelter-fixture=late-paused');`);
    await reloadShelter();await pulse(3600000);
    assert.equal(await evaluate(enabled),'false');assert.equal(await evaluate('sm.calls.length'),1);
    assert.ok(await evaluate(`${pending}.result.proof`));
  });
  await t.test('避难所迟到批次：进入只读等待后不再发送下一档，人工补领后核对原批次',async()=>{
    await setupShelter(`${quiet}sm.view.state.season.points=300;const previous=window.fetch;
      const drawShelter=renderShelter;window.renderShelter=()=>location.pathname==='/shelter'?drawShelter():renderExp();
      window.fetch=(u,o)=>{const response=previous(u,o);
        return u==='/api/shelter/action'&&JSON.parse(o.body).action.tier===1?
          response.then(result=>new Promise(resolve=>{sm.releaseSeasonReceipt=()=>resolve(result);})):response;};`);
    await drive('sm.calls.length===1','first tier sent');const original=await evaluate(pending);
    await pulse(31000);await drive(`${done}&&${state}.pendingReadOnly===${pending}.id`,'batch enters read-only wait');
    await evaluate('sm.releaseSeasonReceipt();');await until(()=>evaluate('!sm.busy'),'late tier handled');
    await pulse(3000);
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1]);
    assert.equal(await evaluate(enabled),'true');assert.equal(await evaluate(`${pending}.id`),original.id);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();`);
    await evaluate(`sm.mode='success';void shelterAct({type:'claim_season',tier:2,premium:false});`);
    await until(()=>evaluate('sm.calls.length===2&&!sm.busy'),'manual remaining tier');
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(`${pending}===null&&${done}`,'late batch resolved');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1,2]);assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所迟到总暂停：整组关闭后晚到成功与刷新只保存凭据，不继续自动操作',async()=>{
    await setupShelter(lateCollection);await drive('sm.calls.length===1','collection before group pause');
    await pulse(31000);await drive(waiting,'waiting before group pause');
    await evaluate(`${panel}.getElementById('toggle').click();sm.oldCollectionRead=false;sm.releaseCollectionReceipt();`);
    await until(()=>evaluate(`Boolean(${pending}?.result?.proof)`),'late proof after group pause');
    await evaluate(`history.replaceState({},'','/shelter?shelter-fixture=late-group-paused');`);
    await reloadShelter();await pulse(3600000);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
    assert.equal(await evaluate(enabled),'true');assert.equal(await evaluate('sm.calls.length'),1);
    assert.ok(await evaluate(`${pending}.result.proof`));
  });
  await t.test('避难所只读预约：刷新仍等原预约，到期只读复查，成功状态出现后自动恢复',async()=>{
    await setupShelter(`${quiet}sm.mode='unknown';sm.view.state.rooms[0].stored=30;`);
    await drive('sm.calls.length===1','unknown collect before reload');await pulse(31000);await drive(waiting,'read-only mode saved');
    const original=await evaluate(pending),nextAt=await evaluate(`${state}.nextAt`);
    await pulse();
    assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-expedition:navigation:v1')`),null,'return navigation settled before simulating a fresh shelter page');
    await evaluate(`history.replaceState({},'','/shelter?shelter-fixture=waiting-reload');`);
    const reads=await evaluate('sm.reads');await reloadShelter();await drive(waiting,'reload preserves wait');
    assert.equal(await evaluate('sm.reads'),reads);assert.equal(await evaluate(`${state}.nextAt`),nextAt);
    await pulse(nextAt-await evaluate('clock')+1000);await drive(waiting,'only read at next due time');
    assert.ok(await evaluate('sm.reads')>reads);assert.deepEqual(await evaluate(pending),original);
    assert.equal(await evaluate('sm.calls.length'),1);
    await evaluate(`sm.mode='success';sm.view.state.rooms[0].stored=0;sm.view.state.stats.collected=30;sm.view.state.resources.scrap=299;`);
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(`${done}&&${pending}===null`,'confirmed state restores normal mode');
    assert.equal(await evaluate(`${state}.pendingReadOnly`),undefined);assert.equal(await evaluate(enabled),'true');
    assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('避难所请求绑定：普通领取的错误地址、方法和不可同步正文在发送前停止',async()=>{
    for(const transport of [`(u,o)=>fetch('/api/unexpected-shelter',o)`,
      `(u,o)=>fetch('https://unexpected.invalid/api/shelter/action',o)`,
      `(u,o)=>fetch(u,{...o,method:'PUT'})`,
      `(u,o)=>fetch(new Request(new URL(u,location.href),o))`]){
      await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.forwarded=[];const previous=window.fetch;
        window.fetch=(u,o)=>{const method=o?.method||(u instanceof Request?u.method:'GET');
          if(method!=='GET'){sm.forwarded.push(String(u instanceof Request?u.url:u));return Promise.resolve(new Response('{}'));}
          return previous(u,o);};window.shelterTransport=${transport};`);
      await drive(`${pending}!==null`,'collection journal created');await pulse(3000);
      assert.deepEqual(await evaluate('sm.forwarded'),[],transport);
      assert.equal(await evaluate(enabled),'false');assert.equal(await evaluate(`${pending}.kind`),'collect');
    }
  });
  await t.test('避难所请求绑定：产出和奖励动作目标不符、付费档或额外参数均不发送',async()=>{
    const cases=[
      [`sm.view.state.rooms[0].stored=30;`,{type:'collect',roomId:1},'collect'],
      [`sm.tutorial=true;`,{type:'claim_tutorial',step:2},'tutorial'],
      [`sm.dailyIncomplete=false;`,{type:'claim_objective',index:2},'daily'],
      [`sm.view.state.season.points=150;`,{type:'claim_season',tier:1,premium:true},'season'],
      [`sm.achievementIncomplete=false;`,{type:'claim_achievement',id:'depth-10'},'achievement'],
      [`sm.view.state.rooms[0].stored=30;`,{type:'collect_all',spend:100},'collect']
    ];
    for(const [scene,action,kind] of cases){
      await setupShelter(`${quiet}${scene}window.shelterTransport=(u,o)=>fetch(u,{...o,
        body:JSON.stringify({...JSON.parse(o.body),action:${JSON.stringify(action)}})});`);
      await drive(`${pending}!==null`,'intended action reserved');await pulse(3000);
      assert.deepEqual(await evaluate('sm.calls'),[],kind);
      assert.equal(await evaluate(`${pending}.kind`),kind);assert.equal(await evaluate(enabled),'false');
    }
  });
  await t.test('避难所请求绑定：正常URL与Request显式正文可执行，单房收取仍绑定原房间',async()=>{
    for(const transport of [`(u,o)=>fetch(new URL(u,location.href),o)`,
      `(u,o)=>fetch(new Request(new URL(u,location.href),{method:'POST'}),{body:o.body})`]){
      await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;window.shelterTransport=${transport};`);
      await drive(done,'explicit request collection succeeds');
      assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);assert.equal(await evaluate(pending),null);
    }
    await setupShelter(`${quiet}sm.view.state.rooms.push({...sm.view.state.rooms[0],id:2,type:'power',stored:30});
      sm.view.state.rooms[0].stored=30;sm.view.state.resources.scrap=2100;`);
    await drive(done,'single room collection');
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.roomId])'),[['collect',2]]);assert.equal(await evaluate(pending),null);
  });
  await t.test('避难所请求绑定：格式不明或重复原生发送会停止，已发送的第一笔记录仍保留',async()=>{
    for(const mutation of [`delete body.idempotencyKey`,`body.extra=true`,`body.idempotencyKey='bad'`]){
      await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;
        window.shelterTransport=(u,o)=>{const body=JSON.parse(o.body);${mutation};return fetch(u,{...o,body:JSON.stringify(body)});};`);
      await drive(`${pending}!==null`,'format journal created');await pulse(3000);
      assert.deepEqual(await evaluate('sm.calls'),[],mutation);assert.equal(await evaluate(enabled),'false');
    }
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;
      window.shelterTransport=(u,o)=>{const first=fetch(u,o);void fetch(u,o).catch(()=>{});return first;};`);
    await drive(`${enabled}==='false'`,'second native write blocked');await pulse(3000);
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`${pending}.kind`),'collect');
  });
  await t.test('避难所请求绑定：手动Request请求和响应保持原样，不创建脚本原操作',async()=>{
    await setupShelter(`${quiet}localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');
      const original=window.fetch;window.fetch=(...args)=>{window.nativeRequest=args[0];return window.nativePromise=original(...args);};`);
    const result=await evaluate(`(async()=>{const request=new Request(new URL('/api/shelter/action',location.href),
      {method:'POST',body:JSON.stringify({action:{type:'collect_all'},idempotencyKey:'manual-request'})});
      const promise=fetch(request),samePromise=promise===nativePromise,sameRequest=request===nativeRequest;
      const response=await promise;return {samePromise,sameRequest,status:response.status,body:await response.json()};})()`);
    assert.equal(result.samePromise,true);assert.equal(result.sameRequest,true);assert.equal(result.status,200);
    assert.equal(result.body.view.vaultNo,77);assert.equal(await evaluate('sm.calls.length'),1);
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate(enabled),'false');
  });
  await t.test('避难所批次绑定：免费赛季首档返回后暂停，不继续发送后续档位',async()=>{
    for(const pref of ['arkengine:auto-shelter:enabled:v1','arkengine:auto-expedition:enabled:v1']){
      await setupShelter(`${quiet}sm.view.state.season.points=300;window.shelterTransport=(u,o)=>fetch(u,o).then(response=>{
        if(JSON.parse(o.body).action.tier===1)localStorage.setItem('${pref}','false');return response;});`);
      await drive('sm.calls.length>0','first tier submitted');await pulse(3000);
      assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1]);
      assert.equal(await evaluate(enabled),'false');assert.deepEqual(await evaluate(`${pending}.targets`),[1,2]);
    }
  });
  await t.test('避难所批次绑定：免费赛季后续档被改成付费或其他动作时在发送前阻止',async()=>{
    for(const action of [{type:'claim_season',tier:2,premium:true},{type:'claim_tutorial',step:1}]){
      await setupShelter(`${quiet}sm.view.state.season.points=300;window.shelterTransport=(u,o)=>{
        const body=JSON.parse(o.body);if(body.action.tier===2)body.action=${JSON.stringify(action)};
        return fetch(u,{...o,body:JSON.stringify(body)});};`);
      await drive('sm.calls.length>0','first valid tier');await pulse(3000);
      assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.tier])'),[['claim_season',1]]);
      assert.equal(await evaluate(enabled),'false');assert.deepEqual(await evaluate(`${pending}.targets`),[1,2]);
    }
  });
  await t.test('避难所批次绑定：异步三档正常完成，之后人工请求不被旧批次接管',async()=>{
    await setupShelter(`${quiet}sm.view.state.season.points=450;window.shelterTransport=async(u,o)=>{
      const response=await fetch(u,o);await new Promise(resolve=>setTimeout(resolve,20));return response;};`);
    await drive(done,'three async tiers completed');
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.tier,c.premium])'),[
      ['claim_season',1,false],['claim_season',2,false],['claim_season',3,false]]);
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate(enabled),'true');
    await pulse();await evaluate(`document.querySelector('a[href="/shelter"]').click();`);
    await evaluate(`void shelterAct({type:'claim_tutorial',step:1});`);
    await until(()=>evaluate('sm.calls.length===4&&!sm.busy'),'manual request after batch');
    assert.equal(await evaluate('sm.calls[3].type'),'claim_tutorial');assert.equal(await evaluate(pending),null);
  });
  await t.test('避难所批次绑定：部分失败结束捕获，人工处理后原记录只核对，不重放已领取档',async()=>{
    await setupShelter(`${quiet}sm.view.state.season.points=300;sm.mode='partial';`);
    await drive(waiting,'partial batch waits without replay');
    const original=await evaluate(pending);
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1,2]);
    await pulse();await evaluate(`document.querySelector('a[href="/shelter"]').click();`);
    await evaluate(`sm.mode='success';void shelterAct({type:'claim_season',tier:2,premium:false});`);
    await until(()=>evaluate('sm.calls.length===3&&!sm.busy'),'manual remaining tier');
    assert.equal(await evaluate(`${pending}.id`),original.id);
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));
    await drive(`${pending}===null&&${done}`,'original batch confirmed');
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate('sm.calls.length'),3);
  });
  await t.test('避难所批次绑定：等首档响应时普通读取和其他接口不被捕获，放行后按原批次完成',async()=>{
    await setupShelter(`${quiet}sm.view.state.season.points=300;const previous=window.fetch;
      window.fetch=(u,o)=>u==='/api/fixture-other-action'?Promise.resolve(new Response(JSON.stringify({ok:true}))):previous(u,o);
      window.shelterTransport=(u,o)=>{const response=fetch(u,o);return JSON.parse(o.body).action.tier===1?
        new Promise(resolve=>{window.releaseSeason=()=>resolve(response);}):response;};`);
    await drive(`typeof releaseSeason==='function'`,'batch awaiting first response');
    const result=await evaluate(`(async()=>({view:await (await fetch('/api/shelter')).json(),
      other:await (await fetch('/api/fixture-other-action',{method:'POST',body:JSON.stringify({action:{type:'unrelated'}})})).json()}))()`);
    assert.equal(result.view.vaultNo,77);assert.deepEqual(result.other,{ok:true});
    assert.equal(await evaluate(enabled),'true');await evaluate('releaseSeason();');await drive(done,'batch resumes after unrelated calls');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1,2]);assert.equal(await evaluate(pending),null);
  });
  const delayedStorage=`window.addEventListener('storage',e=>{
    if(e.key?.startsWith('arkengine:auto-shelter:'))e.stopImmediatePropagation();},true);`;
  await t.test('避难所跨页同步：另一页暂停后撤销排队领取，不依赖及时通知',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;${delayedStorage}`);
    await drive(`${panel}.getElementById('status').textContent.includes('秒后收取避难所')`,'collection queued');
    const second=await secondShelter();
    try{
      await second.evaluate(`${panel}.getElementById('shelter-toggle').click();`);
      for(let i=0;i<6;i++)await pulse();
      assert.equal(await evaluate(enabled),'false');assert.deepEqual(await evaluate('sm.calls'),[]);
      assert.equal(await evaluate(pending),null);
    }finally{await second.close();}
  });
  await t.test('避难所跨页同步：提交前状态变化撤销旧领取，保留原操作和暂停，普通冲突按预约恢复',async()=>{
    for(const mode of ['pending','pause','schedule']){
      await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;`);
      await drive(`${panel}.getElementById('status').textContent.includes('秒后收取避难所')`,'collection before latest shared write');
      await evaluate(`const uuid=crypto.randomUUID.bind(crypto);sm.injected=false;crypto.randomUUID=()=>{
        if(!sm.injected){sm.injected=true;
          if('${mode}'==='pause')localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');
          else if('${mode}'==='schedule')localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${state},
            nextAt:clock+60000,note:'other tab requested recheck'}));
          else localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'latest-collect',at:clock,kind:'collect',
            targets:['all'],vaultNo:77,before:{collected:0,day:'2026-10-10',month:'2026-10',rooms:[{id:1,stored:30}]}}));
        }return uuid();};`);
      await drive(`location.pathname==='/activities/expedition'`,'old submission cancelled');
      assert.equal(await evaluate('sm.injected'),true);assert.deepEqual(await evaluate('sm.calls'),[]);
      if(mode==='pending')assert.equal(await evaluate(`${pending}.id`),'latest-collect');
      else if(mode==='pause'){assert.equal(await evaluate(enabled),'false');assert.equal(await evaluate(pending),null);}
      else{
        assert.equal(await evaluate(enabled),'true');assert.equal(await evaluate(pending),null);
        assert.ok(await evaluate(`${state}.nextAt>clock`));
        await pulse(60001);await drive('sm.calls.length===1','ordinary conflict resumes automatically');
        await drive(done,'resumed collection confirmed');assert.equal(await evaluate('sm.calls.length'),1);
        assert.equal(await evaluate(pending),null);assert.equal(await evaluate(enabled),'true');
      }
    }
  });
  await t.test('避难所跨页同步：读取失败时保留别页更新的配对记录和损坏原文',async()=>{
    for(const corrupt of [false,true]){
      await setupShelter(`${quiet}${delayedStorage}const read=window.fetch;
        window.fetch=(u,o)=>u==='/api/shelter'?new Promise((resolve,reject)=>{
          window.rejectShelterRead=()=>reject(new TypeError('fixture delayed read failure'));}):read(u,o);`);
      await until(()=>evaluate(`typeof rejectShelterRead==='function'`),'read awaiting failure');
      const second=await secondShelter();
      try{
        const latest=corrupt?'{unreadable-shelter':JSON.stringify({nextAt:0,note:'other tab progress',vaultNo:77,
          families:[{a:2,b:3,room:5}],pair:{a:6,b:7,room:5,step:1}});
        await second.evaluate(`localStorage.setItem('arkengine:auto-shelter:schedule:v1',${JSON.stringify(latest)});`);
        await evaluate('rejectShelterRead();');
        await drive(`location.pathname==='/activities/expedition'`,'failed read leaves without stale overwrite');
        if(corrupt)assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:schedule:v1')`),latest);
        else{
          assert.deepEqual(await evaluate(`${state}.families`),[{a:2,b:3,room:5}]);
          assert.deepEqual(await evaluate(`${state}.pair`),{a:6,b:7,room:5,step:1});
        }
        assert.deepEqual(await evaluate('sm.calls'),[]);
      }finally{await second.close();}
    }
  });
  await t.test('避难所跨页同步：旧领取响应迟到时保留已替换的原操作及损坏原文，不覆盖或再次领取',async()=>{
    for(const corrupt of [false,true]){
      await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;${delayedStorage}
        const previous=window.fetch;window.fetch=(u,o)=>{const response=previous(u,o);
          return u==='/api/shelter/action'?new Promise(resolve=>{window.releaseShelterReply=()=>resolve(response);}):response;};`);
      await drive(`sm.calls.length===1&&typeof releaseShelterReply==='function'`,'first response held after server collection');
      const original=await evaluate(pending),second=await secondShelter();
      try{
        const replacement={...original,id:'replacement-collect',targets:[999],before:{...original.before,
          collected:30,rooms:[{id:999,stored:30}]}};
        const raw=corrupt?'{unreadable-original':JSON.stringify(replacement);
        await second.evaluate(`localStorage.setItem('arkengine:auto-shelter:pending:v1',${JSON.stringify(raw)});`);
        await evaluate('releaseShelterReply();');
        await pulse();
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:pending:v1')`),raw);
        await drive(`location.pathname==='/activities/expedition'`,`late response preserves current original record (corrupt=${corrupt})`);
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:pending:v1')`),raw);
        assert.equal(await evaluate('sm.calls.length'),1);
      }finally{await second.close();}
    }
  });
  await t.test('避难所跨页同步：连暂停开关也无法保存时保持本页停止，返回远征且不反复提交',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;`);
    await drive(`${panel}.getElementById('status').textContent.includes('秒后收取避难所')`,'queued before storage failure');
    await evaluate(`window.restoreShelterWrites=Storage.prototype.setItem;sm.writeAttempts=0;
      Storage.prototype.setItem=function(key,value){if(key.startsWith('arkengine:auto-shelter:')&&sm.writeAttempts<12){
        sm.writeAttempts++;throw new DOMException('fixture full','QuotaExceededError');}return restoreShelterWrites.call(this,key,value);};`);
    await drive(`location.pathname==='/activities/expedition'`,'memory pause survives unreadable stop preference');
    const attempts=await evaluate('sm.writeAttempts');
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
    for(let i=0;i<5;i++)await pulse();
    assert.equal(await evaluate('sm.writeAttempts'),attempts,'stopped feature must not repeatedly retry writes');
    assert.match(await evaluate(`${panel}.getElementById('shelter-status').textContent`),/暂停|停止/);
    assert.ok(attempts<12,'must stop before exhausting the injected storage failures');
  });
  await t.test('避难所冻结接力：新页接手领取，原页长时间挂起后恢复核对库存且不重复领取',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;
      document.addEventListener('freeze',()=>localStorage.setItem('fixture:shelter-frozen','true'));
      document.addEventListener('resume',()=>{
        const server=JSON.parse(localStorage.getItem('fixture:shelter-server')||'null');
        if(server){Object.assign(sm,server.sm);clock=server.clock+2*3600000;renderShelter();}
      });`);
    await until(()=>evaluate(`${panel}.getElementById('status').textContent.includes('收取避难所已满批产出')`),'original shelter queued before freeze');
    assert.equal(await evaluate('sm.calls.length'),0);
    const second=await secondShelter();
    try{
      await second.withFrozenOriginal(async()=>{
        await until(()=>second.evaluate(`localStorage.getItem('fixture:shelter-frozen')==='true'`),'real shelter freeze event');
        for(let i=0;i<18;i++){
          if(await second.evaluate(`sm.calls.length===1&&${pending}===null`))break;
          await second.pulse();
        }
        assert.equal(await second.evaluate('sm.calls.length'),1);assert.equal(await second.evaluate(pending),null);
        await second.evaluate(`localStorage.setItem('fixture:shelter-server',JSON.stringify({sm,clock}));`);
      });
    }finally{await second.close();}
    await drive(done,'resumed shelter uses current shared result');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),299);
    assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所冻结原请求：领取已发出但结果未知，接力和长时间恢复都保留记录且不补领',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.mode='unknown';
      document.addEventListener('freeze',()=>localStorage.setItem('fixture:shelter-frozen','true'));`);
    await drive('sm.calls.length===1','shelter request sent before freeze');
    const original=await evaluate(`localStorage.getItem('arkengine:auto-shelter:pending:v1')`),second=await secondShelter();
    assert.ok(original);
    try{
      await second.withFrozenOriginal(async()=>{
        await until(()=>second.evaluate(`localStorage.getItem('fixture:shelter-frozen')==='true'`),'real freeze with unresolved collection');
        for(let i=0;i<6;i++)await second.pulse(5000);
        assert.deepEqual(await second.evaluate('sm.calls'),[]);
        assert.equal(await second.evaluate(`localStorage.getItem('arkengine:auto-shelter:pending:v1')`),original);
      });
    }finally{await second.close();}
    await pulse(2*3600000);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:pending:v1')`),original);
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),269);
    assert.equal(await evaluate(enabled),'true');
    assert.equal(await evaluate(`${state}.pendingReadOnly`),JSON.parse(original).id);
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('避难所发展规划生育床位：已有感情预留床位，刷新及转待产不重复计数，也不改目标或自动建造',async()=>{
    await setupShelter(`${quiet}const s=sm.view.state,base=s.rooms[0],adult=s.residents[0];s.depth=3;s.digging=null;
      const room=(id,type,floor,col,width=1)=>({...base,id,type,floor,col,width});
      s.rooms=[room(10,'elevator',1,1),room(11,'elevator',2,1),room(12,'elevator',3,1),
        room(1,'power',1,2),room(2,'diner',1,3),room(3,'water',1,4),room(4,'scrap',1,5),
        room(5,'quarters',2,2,2),room(6,'storage',3,2)];
      s.residents=Array.from({length:8},(_,i)=>({...structuredClone(adult),id:i+1,name:'居民'+i,roomId:i>=6?5:Math.floor(i/2)+1,
        happiness:100,stats:{str:5,per:5,end:5,cha:5,int:5,agi:5,lck:5},romance:i>=6?{partnerId:i===6?8:7}:null}));
      localStorage.setItem('arkengine:auto-shelter:population:v1','8');`);
    const fixtureSearch=await evaluate('location.search'),development=`${panel}.getElementById('shelter-development').textContent`;
    await drive(done,'plan existing romance capacity');
    assert.match(await evaluate(development),/设置目标 8.*规划容量至少 9/);
    assert.match(await evaluate(development),/新建一格宿舍|宿舍升至/);
    assert.match(await evaluate(development),/培养感情.*预留 1/);
    await pulse(1000);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'romance reservation survives reload');
    assert.match(await evaluate(development),/设置目标 8.*规划容量至少 9/);
    await evaluate(`sm.view.state.births=[{roomId:5,parents:[7,8],dueAt:clock+3600000}];${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'pending birth state');await drive(done,'birth not counted twice');
    assert.match(await evaluate(development),/人口 9\/8.*设置目标 8.*规划容量至少 9/);
    assert.doesNotMatch(await evaluate(development),/培养感情.*预留/);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:population:v1')`),'8');
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所发展规划扩仓：在建仓库避免重复建议，刷新仍按当前容量保留产出，完工后再领取',async()=>{
    await setupShelter(`${quiet}const s=sm.view.state,base=s.rooms[0];s.depth=1;s.digging=null;s.resources.scrap=3290;
      s.rooms=[{...base,floor:1,col:2,stored:30},{...base,id:2,type:'elevator',floor:1,col:1},
        {...base,id:3,type:'storage',floor:1,col:3},{...base,id:4,type:'storage',floor:1,col:4,builtAt:clock+600000}];`);
    const fixtureSearch=await evaluate('location.search');
    await drive(done,'wait for warehouse capacity');
    const development=`${panel}.getElementById('shelter-development').textContent`;
    const advice=await evaluate(development);
    assert.doesNotMatch(advice,/新建一格仓库|仓库升至/);assert.match(advice,/先等.*完工/);
    assert.match(advice,/3300.*4500/);assert.match(advice,/领取仍按当前容量/);
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate('sm.view.state.rooms[0].stored'),30);
    await pulse(1000);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'',location.pathname+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'capacity wait survives refresh');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.doesNotMatch(await evaluate(development),/新建一格仓库|仓库升至/);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===4).builtAt=0;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'warehouse complete visit');await drive(done,'completed capacity permits collection');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),3320);assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所发展规划：待完工工程先预留电力，工程完成后重新评估且不消费资源',async()=>{
    await setupShelter(`${quiet}const s=sm.view.state,base=s.rooms[0],adult=s.residents[0];s.depth=3;s.digging=null;
      const room=(id,type,floor,col,width=1)=>({...base,id,type,floor,col,width});
      s.rooms=[room(10,'elevator',1,1),room(11,'elevator',2,1),room(12,'elevator',3,1),
        room(1,'power',1,2),room(2,'diner',1,3),room(3,'water',1,4),room(4,'scrap',1,5),
        room(5,'quarters',2,2,3),room(6,'storage',3,2),{...room(30,'workshop',2,5,3),builtAt:clock+600000}];
      s.residents=Array.from({length:8},(_,i)=>({...structuredClone(adult),id:i+1,name:'居民'+i,roomId:Math.floor(i/2)+1,
        happiness:i<2?0:100,stats:{str:i<2?0:5,per:5,end:5,cha:5,int:5,agi:5,lck:5}}));
      localStorage.setItem('arkengine:auto-shelter:population:v1','14');`);
    await drive(done,'committed construction power reserved');
    const development=`${panel}.getElementById('shelter-development').textContent`;
    const before=await evaluate(development);
    assert.match(before.split('\n').find(l=>l.includes('新建一格宿舍')),/电力余量不足/);
    assert.match(before,/已在施工.*3.*电力/);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===30).builtAt=0;
      sm.view.state.residents.filter(p=>p.roomId===1).forEach(p=>p.happiness=100);
      ${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'completed construction recheck');await drive(done,'construction completed advice');
    const after=await evaluate(development);
    assert.doesNotMatch(after,/已在施工.*3.*电力/);
    assert.doesNotMatch(after.split('\n').find(l=>l.includes('新建一格宿舍')),/电力余量不足/);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所发展规划：外出人员仍占位时不建议直接补员，位置释放后重新显示空岗',async()=>{
    await setupShelter(`${quiet}const s=sm.view.state,adult=s.residents[0];
      s.residents=[{...structuredClone(adult),away:{kind:'explore'}},
        {...structuredClone(adult),id:2,name:'外出乙',away:{kind:'explore'}},
        {...structuredClone(adult),id:3,name:'闲置丙',roomId:null}];`);
    await drive(done,'reserved room positions are not vacancies');
    assert.match(await evaluate(`${state}.development`),/2 名外出居民.*占位.*不能直接补员/);
    assert.doesNotMatch(await evaluate(`${state}.development`),/先补现有废料回收站岗位/);
    await evaluate(`sm.view.state.residents.filter(p=>p.away).forEach(p=>p.roomId=null);${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'positions released');await drive(done,'newly available positions');
    assert.match(await evaluate(`${state}.development`),/已有 2 个空岗/);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所伤员应急提醒：返回远征仍显示在家重伤与求援入口，提前预约且不消费',async()=>{
    await setupShelter(`${quiet}sm.view.state.residents[0].hp=25;sm.view.reliefAvailable=true;`);
    await drive(done,'emergency advice persists after return');
    const hint=await evaluate(`${panel}.getElementById('shelter-operations').textContent`);
    assert.match(hint,/居民甲.*25\/100.*不足一半/);assert.match(hint,/治疗针不足/);assert.match(hint,/向方舟求援/);
    assert.equal(await evaluate(`${state}.operations`),hint);assert.ok(await evaluate(`${state}.nextAt-clock<=300000`));
    assert.deepEqual(await evaluate('sm.calls'),[]);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const entry=events.findLast(e=>e.type==='shelter-check');
    assert.equal(entry.data.attention.homeHurt,1);assert.equal(entry.data.attention.relief,1);
  });

  await t.test('避难所发展规划：显示真实扩建及下挖成本，只有建议不点击消费按钮',async()=>{
    await setupShelter(`${quiet}const s=sm.view.state;s.depth=3;s.digging=null;s.rooms[0].floor=1;s.rooms[0].col=2;
      for(let i=1;i<=3;i++)s.rooms.push({...s.rooms[0],id:10+i,type:'elevator',floor:i,col:1});
      s.rooms.push({...s.rooms[0],id:20,type:'quarters',floor:2,col:2,width:3});`);
    await drive(done,'development advice without building');
    const advice=await evaluate(`${panel}.getElementById('shelter-development').textContent`);
    assert.match(advice,/192 废料/);assert.match(advice,/836 废料/);assert.match(advice,/停产/);
    assert.match(advice,/自动建设默认关闭/);assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(`${state}.development`),advice);
  });
  await t.test('避难所发展规划零件：缺料时提示工坊，刷新保留建议，材料备齐后撤销且不自动消费',async()=>{
    await setupShelter(`${quiet}const s=sm.view.state;s.depth=1;s.digging=null;s.rooms[0].floor=1;s.rooms[0].col=2;s.rooms[0].level=2;
      s.rooms.push({...s.rooms[0],id:10,type:'elevator',col:1,width:1,level:1});sm.view.progress.level=4;`);
    const resources=await evaluate('sm.view.state.resources'),fixtureSearch=await evaluate('location.search');
    await drive(done,'parts preparation advice');
    let advice=await evaluate(`${state}.development`);
    assert.match(advice,/备选升级至少还缺 15 零件/);
    assert.match(advice.split('\n').find(l=>l.includes('新建一格工坊')),/500 废料.*5 级解锁/);
    assert.match(advice,/另外消耗 90 废料/);assert.deepEqual(await evaluate('sm.calls'),[]);
    await pulse(1000);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'parts advice after reload');
    assert.match(await evaluate(`${state}.development`),/备选升级至少还缺 15 零件/);
    assert.deepEqual(await evaluate('sm.view.state.resources'),resources);
    await evaluate(`sm.view.state.resources.parts=15;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'materials ready revisit');await drive(done,'materials ready advice');
    advice=await evaluate(`${state}.development`);
    assert.doesNotMatch(advice,/备选升级至少还缺|新建一格工坊/);
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所发展规划医疗：无针伤员提示建造前提，刷新保留，补针或康复撤销且不自动消费',async()=>{
    await setupShelter(`${quiet}const s=sm.view.state;s.residents[0].hp=25;s.depth=1;s.digging=null;
      s.rooms[0].floor=1;s.rooms[0].col=2;
      s.rooms.push({...s.rooms[0],id:10,type:'elevator',col:1});sm.view.progress.level=2;`);
    const resources=await evaluate('sm.view.state.resources'),fixtureSearch=await evaluate('location.search');
    await drive(done,'medical preparation advice');
    let advice=await evaluate(`${state}.development`);
    assert.match(advice,/在家 1 名伤员.*治疗针不足/);
    assert.match(advice.split('\n').find(l=>l.includes('新建一格医务室')),/300 废料.*3 级解锁/);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await pulse(1000);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'medical advice after reload');
    assert.match(await evaluate(`${state}.development`),/先准备医疗供应/);
    assert.deepEqual(await evaluate('sm.view.state.resources'),resources);
    await evaluate(`sm.view.state.resources.stimpak=1;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'stimpak ready revisit');await drive(done,'stimpak ready advice');
    advice=await evaluate(`${state}.development`);assert.doesNotMatch(advice,/新建一格医务室|先准备医疗供应/);
    assert.match(await evaluate(`${state}.operations`),/用治疗针/);assert.equal(await evaluate('sm.view.state.resources.stimpak'),1);
    await evaluate(`sm.view.state.resources.stimpak=0;sm.view.state.residents[0].hp=100;${panel}.getElementById('shelter-check').click();`);
    await drive(`location.pathname==='/shelter'`,'recovered resident revisit');await drive(done,'medical need cleared');
    assert.doesNotMatch(await evaluate(`${state}.development`),/新建一格医务室|先准备医疗供应/);
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所发展规划：缺布局只限制建议，仍领取已有产出并返回远征',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;`);
    await drive(done,'legacy layout still collects');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.match(await evaluate(`${state}.development`),/布局资料不完整/);assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所发展规划：额外规划数据异常只跳过建议，不关闭自动领取',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;
      sm.view.state.residents[0].romance={partnerId:2};sm.view.state.births=[{dueAt:clock+3600000}];
      const original=shelterData;window.shelterData=()=>{const v=original();v.state.depth=3;v.state.rooms[0].col='unknown';return v;};`);
    await drive(done,'invalid optional plan fields');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.match(await evaluate(`${state}.development`),/布局资料不完整/);assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所运行提醒：施工与返程提前预约，遇到事件仅提醒而不擅自派人救援',async()=>{
    await setupShelter(`${quiet}const s=sm.view.state;s.rooms[0].incident={kind:'fire'};s.rooms[0].upgradeAt=clock+120000;
      s.residents[0].away={kind:'explore'};s.residents[0].hp=20;s.explorers=[{residentId:1,returnAt:clock+180000,stimpaks:0}];s.quests=[];`);
    await drive(done,'operational reminders');
    const hint=await evaluate(`${panel}.getElementById('shelter-operations').textContent`);
    assert.match(hint,/没有成人在场/);assert.match(hint,/血量不足一半/);assert.match(hint,/升级约/);
    assert.ok(await evaluate(`${state}.nextAt-clock<125000`));assert.deepEqual(await evaluate('sm.calls'),[]);
  });

  await t.test('避难所产出核验：十分钟结算前不提前收取，已有近满库存仍等下一整步',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=29;sm.view.state.lastSettledAt=clock-9*60000;`);
    await drive(done,'wait for discrete production tick');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(enabled),'true');assert.equal(await evaluate(pending),null);
  });
  await t.test('避难所产出核验：同层机器人已自动收取时不重复手动收取',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].floor=1;sm.view.state.rooms[0].stored=30;
      sm.view.state.handies=[{id:1,floor:1}];sm.view.state.lastSettledAt=clock-600000;`);
    await drive(done,'robot collected whole batch');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所产出核验：零件加工缺废料时不凭理论时产点击空收取',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].type='workshop';sm.view.state.rooms[0].stored=2.9;
      sm.view.state.resources.scrap=0;sm.view.state.lastSettledAt=clock-3600000;`);
    await drive(done,'workshop cannot spend missing scrap');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所产出核验：机器人占用库存后，其他楼层手动收取仍须预留容量',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].floor=1;sm.view.state.rooms[0].stored=30;
      sm.view.state.rooms.push({...sm.view.state.rooms[0],id:2,floor:2});sm.view.state.resources.scrap=2660;
      sm.view.state.handies=[{id:1,floor:1}];sm.view.state.lastSettledAt=clock-600000;`);
    await drive(done,'automated collection occupies capacity');assert.deepEqual(await evaluate('sm.calls'),[]);
  });

  await t.test('避难所：远征和农场空闲后领取全批与奖励，再返回且不频繁访问',async()=>{
    await setupShelter(`localStorage.setItem('arkengine:auto-farm:enabled:v1','true');sm.view.state.season.points=300;`,'/activities/expedition');
    await drive(done,'complete shelter visit',180);
    assert.equal(await evaluate('fm.crops.length'),12);
    assert.deepEqual(await evaluate(`sm.calls.map(c=>c.type)`),['collect_all','claim_tutorial','claim_objective','claim_objective','claim_objective','claim_season','claim_season','claim_achievement']);
    assert.deepEqual(await evaluate('sm.view.state.season.claimedFree'),[1,2]);
    assert.equal(await evaluate(pending),null);
    assert.ok(await evaluate(`${state}.advice.includes('废料约 8.0/小时')`));
    const reads=await evaluate('sm.reads');for(let i=0;i<5;i++)await pulse();
    assert.equal(await evaluate('sm.reads'),reads);
    assert.deepEqual(await evaluate(`fm.calls.filter(c=>c.type==='navigate').map(c=>c.path)`),['/farm','/activities/expedition','/shelter','/activities/expedition']);
  });
  await t.test('避难所：废料满仓不批量丢弃，单独收取可容纳的电力',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.view.state.resources.scrap=2100;
      sm.view.state.rooms.push({...sm.view.state.rooms[0],id:2,type:'power'});`);
    await drive(done,'individual safe collect');
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.roomId])'),[['collect',2]]);
    assert.equal(await evaluate('sm.view.state.rooms[0].stored'),30);
  });
  await t.test('避难所：领取前重新读库存，等待期间满仓时取消原领取',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;`);
    await until(async()=>/随机等待.*产出/.test(await expStatus()),'collect queued');
    await evaluate('sm.view.state.resources.scrap=2100');
    await drive(done,'full storage during wait');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：临近下一批时预留容量，避免只按当前一批计算',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=59.99;sm.view.state.resources.scrap=2070;
      sm.view.state.lastSettledAt=clock-595000;`);
    await drive(done,'projected batch capacity');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：隐藏副本不误点，当前可见按钮仍可领取',async()=>{
    await setupShelter(`const render=renderShelter;window.renderShelter=()=>{render();const d=document.createElement('div');
      d.hidden=true;d.innerHTML=game.innerHTML;d.querySelectorAll('button').forEach(b=>b.onclick=()=>sm.calls.push({type:'hidden'}));game.prepend(d);};`);
    await drive(done,'ignore hidden DOM',150);
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='claim_tutorial')`));
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='hidden')`),false);
  });
  await t.test('避难所弹窗核验：隐藏的旧窗口不阻断当前领取，也不点击旧窗口',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;
      const old=document.createElement('div');old.hidden=true;old.setAttribute('role','dialog');
      old.innerHTML='<h2>旧居民窗口</h2><button>关闭</button>';old.querySelector('button').onclick=()=>sm.calls.push({type:'old-dialog'});document.body.append(old);`);
    await drive(done,'hidden old dialog ignored');assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
  });
  await t.test('避难所弹窗核验：普通公告自动关闭后继续，暂停避难所时保留公告',async()=>{
    const modal=`const d=document.createElement('div');d.setAttribute('role','dialog');
      d.innerHTML='<h2>公告</h2><p>今日更新说明</p><button>知道了</button>';
      d.querySelector('button').onclick=()=>{sm.closedNotice=(sm.closedNotice||0)+1;d.remove();};document.body.append(d);`;
    await setupShelter(`${quiet}${modal}`);await drive(done,'close informational notice');
    assert.equal(await evaluate('sm.closedNotice'),1);assert.deepEqual(await evaluate('sm.calls'),[]);
    await setupShelter(`${quiet}localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');${modal}`);
    await pulse(10000);assert.equal(await evaluate('sm.closedNotice||0'),0);
  });
  await t.test('避难所导航核验：缺少入口时保存整页切换预算，失败后最多补跳一次',async()=>{
    await setupShelter(quiet,'/activities/expedition');await evaluate(`document.querySelector('a[href="/shelter"]').remove();`);
    await withDelayedShelterNavigation(async(count,stopLoading)=>{
      await Promise.all([pulse(5000),until(()=>count()===1,'first shelter navigation').then(stopLoading)]);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:navigation:v1')).to`),'/shelter');
      await pulse(15000);assert.equal(count(),1);
      await Promise.all([pulse(16000),until(()=>count()===2,'one shelter fallback').then(stopLoading)]);
      await pulse(60000);assert.equal(count(),2);assert.equal(await evaluate('sm.calls.length'),0);
    });
  });
  await t.test('避难所：奖励和免费装备可能溢出时保留奖励且不点击付费按钮',async()=>{
    await setupShelter(`sm.view.state.resources.scrap=2100;sm.view.state.season.points=750;
      sm.view.state.season.claimedFree=[1,2,3,4];sm.view.state.items=Array.from({length:20},(_,id)=>({id}));`);
    await drive(done,'overflow rewards skipped');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：默认不开启且修仙路由不会运行避难所',async()=>{
    for(const path of ['/activities/expedition','/cultivate']){
      await setupShelter(`localStorage.removeItem('arkengine:auto-shelter:enabled:v1');localStorage.setItem('arkengine:auto-encounter:enabled:v1','false');`,path);
      if(path==='/cultivate')await evaluate(`localStorage.setItem('arkengine:auto-shelter:enabled:v1','true');window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-shelter:enabled:v1',newValue:'true'}));`);
      for(let i=0;i<3;i++)await pulse(10000);
      assert.equal(await evaluate('sm.reads'),0);assert.deepEqual(await evaluate('sm.calls'),[]);
      assert.equal(await evaluate('location.pathname'),path);
    }
  });
  await t.test('避难所：暂停总开关、独立开关或离开路由后丢弃迟到读取',async()=>{
    for(const cancel of [`${panel}.getElementById('toggle').click()`,`${panel}.getElementById('shelter-toggle').click()`,
      `history.pushState({},'','/cultivate');window.dispatchEvent(new Event('focus'))`]){
      await setupShelter('sm.deferRead=true;');
      await until(()=>evaluate('!!sm.resolveRead'),'read started');await evaluate(cancel);await pulse();
      await evaluate('sm.resolveRead()');await pulse(5000);
      assert.deepEqual(await evaluate('sm.calls'),[]);
    }
  });
  await t.test('避难所：未知领取保留记录，刷新后核对一次也不重复点击',async()=>{
    await setupShelter('sm.mode="unknown";');
    await drive('sm.calls.length===1','original collect submitted');
    assert.ok(await evaluate(pending));await reloadShelter();
    await drive(waiting,'unknown receipt isolated');
    assert.equal(await evaluate('sm.calls.length'),1);assert.ok(await evaluate(pending));
    const original=await evaluate(pending);
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(waiting,'next read-only verification');
    assert.deepEqual(await evaluate(pending),original);assert.equal(await evaluate('sm.calls.length'),1);
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('避难所：刷新后已到账的旧任务奖励可核对，不再领取',async()=>{
    await setupShelter(`${quiet}sm.view.state.tutorial={claimed:[1]};
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old',kind:'tutorial',targets:[1],at:clock-60000,vaultNo:77,
        before:{collected:0,day:'2026-10-10',month:'2026-10'}}));`);
    await drive(done,'old receipt reconciled');assert.equal(await evaluate(pending),null);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：旧收取已有原请求状态证明，房间重新产满后仍可确认原结果',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.view.state.stats.collected=30;sm.view.state.resources.scrap=2100;
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old',kind:'collect',targets:[1],at:clock-3600000,vaultNo:77,
        result:{outcome:'ok',status:200,proof:{key:'fixture-key',vaultNo:77,collected:30,at:clock-3600000}},
        before:{collected:0,day:'2026-10-10',month:'2026-10',rooms:[{id:1,stored:30}]}}));`);
    await drive(done,'confirmed collection after refill');assert.equal(await evaluate(pending),null);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：其他房间手动收取不误确认未知的原领取',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.view.state.stats.collected=100;
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old',kind:'collect',targets:[1],at:clock-60000,vaultNo:77,
        before:{collected:0,day:'2026-10-10',month:'2026-10',rooms:[{id:1,stored:30}]}}));`);
    await drive(waiting,'do not accept unrelated collection');assert.ok(await evaluate(pending));assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所回执核验：仅HTTP200加其他房间收入，不能清除旧领取或再次收取',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.view.state.stats.collected=100;
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old',kind:'collect',targets:[1],at:clock-60000,vaultNo:77,
        result:{outcome:'ok',status:200},before:{collected:0,day:'2026-10-10',month:'2026-10',rooms:[{id:1,stored:30}]}}));`);
    await drive(waiting,'HTTP status is not a receipt');assert.ok(await evaluate(pending));assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所回执核验：保存本次原生领取的返回状态，刷新并重新产满后仍能确认',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;`);
    await drive('sm.calls.length===1','collection request sent');
    await until(()=>evaluate(`Boolean(${pending}?.result?.proof)`),'persist response proof');
    assert.equal(await evaluate(`${pending}.result.proof.collected`),30);
    await evaluate('sm.view.state.rooms[0].stored=30;sm.view.state.resources.scrap=2100;');
    await reloadShelter();await drive(done,'proof survives refill and reload');
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('避难所：免费档部分成功后不整批重放，其他功能保持开启',async()=>{
    await setupShelter(`${quiet}sm.view.state.season.points=300;sm.mode='partial';`);
    await drive(waiting,'partial season retained');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.tier)'),[1,2]);assert.deepEqual(await evaluate(`${pending}.targets`),[1,2]);
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('避难所：读取网络故障预约稍后检查，结构变化仅暂停避难所',async()=>{
    await setupShelter('sm.readError=true;');await drive(done,'network isolation');assert.equal(await evaluate(enabled),'true');
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await setupShelter('delete sm.view.state.resources.scrap;');
    await drive(`${enabled}==='false' && location.pathname==='/activities/expedition'`,'schema isolation');
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所读取恢复：临时截断响应保持开启，预约期间不反复读取，数据恢复后继续领取',async()=>{
    await setupShelter(`${quiet}sm.view.state.rooms[0].stored=30;sm.malformedRead=true;`);
    await drive(`location.pathname==='/activities/expedition'`,'leave after malformed read');
    assert.equal(await evaluate(enabled),'true');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.ok(await evaluate(`${state}.nextAt>clock&&${state}.nextAt<=clock+15*60000`));
    assert.match(await evaluate(`${state}.note`),/响应.*解析失败/);
    const reads=await evaluate('sm.reads');
    await pulse(60000);assert.equal(await evaluate('sm.reads'),reads);
    await evaluate(`sm.malformedRead=false;clock=${state}.nextAt;window.dispatchEvent(new Event('focus'));`);
    await drive(`sm.calls.length===1&&${done}`,'recover collection at appointment');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所读取恢复：截断响应跨刷新保留旧领取，数据完整后仅确认原结果',async()=>{
    await setupShelter(`${quiet}sm.malformedRead=true;sm.view.state.stats.collected=30;
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old',kind:'collect',targets:[1],at:clock-60000,vaultNo:77,
        result:{outcome:'ok',status:200,proof:{key:'fixture-key',vaultNo:77,collected:30,at:clock-60000}},
        before:{collected:0,day:'2026-10-10',month:'2026-10',rooms:[{id:1,stored:30}]}}));`);
    const fixtureSearch=await evaluate('location.search'),original=await evaluate(pending);
    await drive(`location.pathname==='/activities/expedition'`,'leave with pending read');
    assert.equal(await evaluate(enabled),'true');assert.deepEqual(await evaluate(pending),original);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await pulse(1000);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();
    await drive(`location.pathname==='/activities/expedition'`,'malformed read after refresh');
    assert.equal(await evaluate(enabled),'true');assert.deepEqual(await evaluate(pending),original);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate(`sm.malformedRead=false;clock=${state}.nextAt;window.dispatchEvent(new Event('focus'));`);
    await drive(`${pending}===null&&${done}`,'confirm original collection after recovery');
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(enabled),'true');
  });
  await t.test('避难所读取恢复：解析失败不清除未知领取，数据恢复后仍保留记录并只读核对',async()=>{
    await setupShelter(`${quiet}sm.malformedRead=true;sm.view.state.rooms[0].stored=30;
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old',kind:'collect',targets:[1],at:clock-60000,vaultNo:77,
        before:{collected:0,day:'2026-10-10',month:'2026-10',rooms:[{id:1,stored:30}]}}));`);
    const original=await evaluate(pending);
    await drive(`location.pathname==='/activities/expedition'`,'defer unknown original collection');
    assert.equal(await evaluate(enabled),'true');assert.deepEqual(await evaluate(pending),original);
    await evaluate(`sm.malformedRead=false;clock=${state}.nextAt;window.dispatchEvent(new Event('focus'));`);
    await drive(waiting,'retain unknown write protection');
    assert.deepEqual(await evaluate(pending),original);assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.match(await evaluate(`${state}.note`),/操作仍未确认/);
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('避难所：游戏登录错误或账号切换停止总开关',async()=>{
    for(const code of ['sm.httpStatus=401;',`localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:88,nextAt:0,note:'旧账号'}));`]){
      await setupShelter(code);await drive(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')==='false'`,'account stop');
      assert.deepEqual(await evaluate('sm.calls'),[]);
    }
  });
  await t.test('避难所：手动弹窗不关闭、不切页，关闭后继续',async()=>{
    await setupShelter(`const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<h2>升级房间？</h2><button>确认</button>';document.body.append(d);`);
    for(let i=0;i<3;i++)await pulse(30000);
    assert.equal(await evaluate('sm.reads'),0);assert.equal(await evaluate('location.pathname'),'/shelter');
    await evaluate(`document.querySelector('[role="dialog"]').remove()`);await drive(done,'manual dialog dismissed',150);
  });
  await t.test('避难所：缺少旧版引导状态可读取，人员建议区分儿童、待产与闲置成人',async()=>{
    await setupShelter(`${quiet}delete sm.view.state.tutorial;sm.view.state.births=[{id:1,dueAt:clock+90000}];
      const p=sm.view.state.residents[0];sm.view.state.residents.push({...p,id:2,roomId:null},{...p,id:3,roomId:null,adultAt:clock+3600000});
      sm.view.state.residents[0].romance={partnerId:2};sm.view.state.residents[1].romance={partnerId:1};`);
    await drive(done,'advice and appointment');
    assert.match(await evaluate(`${state}.advice`),/闲置成人 1 人；培养感情 1 对，待产 1 个/);
    assert.ok(await evaluate(`${state}.nextAt-clock<=92000`));assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('避难所：损坏的领取日志阻止操作并保留原文',async()=>{
    await setupShelter(`localStorage.setItem('arkengine:auto-shelter:pending:v1','broken');`);
    for(let i=0;i<3;i++)await pulse();assert.equal(await evaluate('sm.reads'),0);assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:pending:v1')`),'broken');
  });
  await t.test('避难所：保存领取记录失败时不点击，远征总开关保持开启',async()=>{
    await setupShelter(`const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){
      if(key==='arkengine:auto-shelter:pending:v1')throw new DOMException('full','QuotaExceededError');return set.call(this,key,value);};`);
    await drive(`${enabled}==='false' && location.pathname==='/activities/expedition'`,'journal write failure');
    assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
}
