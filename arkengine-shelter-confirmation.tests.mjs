import assert from 'node:assert/strict';
import {readyCampaignConstructionScene} from './arkengine-shelter-growth-investment.fixture.mjs';

export async function shelterConfirmationTests({t,setupShelter,reloadShelter,evaluate,pulse,drive,trustedStaffKey,secondShelter}){
  const pending="JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))";
  const state="JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))";
  const scene=()=>{
    const f=readyCampaignConstructionScene();f.campaign.training=false;
    for(const p of f.view.state.residents)p.familyCooldownUntil=p.id>=5?0:f.view.serverTime+86400000;
    for(const [id,partnerId] of [[5,6],[6,5]])f.view.state.residents.find(p=>p.id===id).romance={partnerId,progress:.1};
    f.state.families=[{a:5,b:6,room:5}];f.construction={...f.construction,build:false,upgrade:false,dig:false};
    return `sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.ui20261109=true;sm.quickAssign=false;sm.confirmFamily=true;sm.executionPlanCostMs=1800;
      sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','8');
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({combatGear:false,
        tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6,...${JSON.stringify(f.campaign)}}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(f.state)},vaultNo:77,nextAt:0,note:'confirmation lifecycle'}));
      sm.confirmReads=[];sm.boundAtTransport=[];const fetchBefore=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter'){sm.confirmReads.push(clock);sm.view.revision=(sm.view.revision||0)+1;}
        if(url==='/api/shelter/action')sm.boundAtTransport.push({at:clock,body:JSON.parse(options.body),pending:${pending}});
        return fetchBefore(url,options);};`;
  };
  const open=async()=>{await setupShelter(scene());await drive(`!!document.querySelector('[role="alertdialog"]')`,'native family confirmation',60);};
  const originalCalls='sm.calls.filter(c=>c.type==="assign"&&c.residentId===5&&c.roomId===5)';
  await t.test('居民定位提速：目标已在当前页且身份唯一时直接打开，不重复筛选岗位',async()=>{
    await setupShelter(scene()+`sm.roomFilterEdits=0;document.addEventListener('change',event=>{
      if(event.target.getAttribute('aria-label')==='按房间筛选')sm.roomFilterEdits++;});`);
    await drive(`${originalCalls}.length===1&&!${pending}`,'visible identified resident assigned once',60);
    assert.equal(await evaluate('sm.roomFilterEdits'),0);
    assert.equal(await evaluate(`${originalCalls}.length`),1);
  });
  await t.test('执行准备接续：纯界面准备等待半秒，尚未提交居民操作',async()=>{
    await setupShelter(scene());
    await drive(`sm.tab==='居民'`,'resident tab has opened');
    const at=await evaluate('clock');
    const status=()=>evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent`);
    assert.match(await status(),/等待.*(?:查找指定居民|居民详情)/,'read-only preparation does not wait for another heartbeat');
    const actions=()=>evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='action')`);
    const first=await actions();assert.equal(first.length,1);
    await pulse(499);assert.equal((await actions()).length,1,'no click before the half-second cooldown');
    await pulse(1);
    const next=await actions();assert.equal(next.length,2);
    assert.equal(next[1].at-at,500,'read-only preparation uses the short delay');
    assert.equal(await evaluate('sm.calls.length'),0,'navigation does not submit an assignment');
  });
  const receiptScene=`sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    sm.receiptReads=[];const read=window.fetch;window.fetch=(url,options)=>{
      if(url==='/api/shelter'){
        sm.receiptReads.push({at:clock,after:sm.replyAt!==undefined});
        if(sm.delayOldRead&&sm.releaseAction&&sm.replyAt===undefined){
          const old=read(url,options);return new Promise(resolve=>{sm.releaseOldRead=()=>old.then(resolve);});
        }
      }
      if(url==='/api/shelter/action')return new Promise((resolve,reject)=>{sm.releaseAction=()=>
        (sm.emptyReply?Promise.resolve(new Response('{}')):read(url,options)).then(r=>{sm.replyAt=clock;resolve(r);},reject);});
      return read(url,options);};`;
  for(const elapsed of [600,2000])await t.test('回执接续：成功回执立即重新读取，不沿用旧轮询等待 '+elapsed,async()=>{
    await setupShelter(receiptScene);
    await drive(`typeof sm.releaseAction==='function'`,'original request is in flight');
    const before=await evaluate('sm.receiptReads.length');
    await pulse(elapsed);
    if(elapsed>=2000)assert.ok(await evaluate(`sm.receiptReads.length>${before}`),'old snapshot was polled while request was in flight');
    await evaluate(`(async()=>{sm.releaseAction();await new Promise(resolve=>setTimeout(resolve,160));})()`);
    const reads=await evaluate('sm.receiptReads.filter(r=>r.after)');
    assert.ok(reads.length>0,'settled success wakes a fresh GET without advancing the clock');
    assert.equal(reads[0].at,await evaluate('sm.replyAt'));
    assert.equal(await evaluate(pending),null,'GET confirms the original operation');
    assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('回执接续：回执前发起的慢读取迟到，不覆盖确认结果或重复领取',async()=>{
    await setupShelter(receiptScene+'sm.delayOldRead=true;');
    await drive(`typeof sm.releaseAction==='function'`,'collection in flight');await pulse(2000);
    assert.equal(await evaluate('typeof sm.releaseOldRead'),'function');
    await evaluate(`(async()=>{sm.releaseAction();await new Promise(resolve=>setTimeout(resolve,160));})()`);
    assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate('sm.receiptReads.filter(r=>r.after).length'),1);
    await evaluate(`sm.releaseOldRead();`);await pulse(1000);
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate('sm.calls.length'),1);
  });
  for(const variant of ['http-error','read-failure','unconfirmed'])await t.test('回执接续：保留失败退避及未知原单 '+variant,async()=>{
    await setupShelter(receiptScene);
    await drive(`typeof sm.releaseAction==='function'`,'collection request waiting');
    if(variant==='read-failure')await evaluate('sm.readError=true;');
    await pulse(2000);
    const original=await evaluate(pending);
    await evaluate(`sm.readError=false;sm.mode=${JSON.stringify(variant==='http-error'?'error':'success')};sm.emptyReply=${variant==='unconfirmed'};`);
    await evaluate(`(async()=>{sm.releaseAction();await new Promise(resolve=>setTimeout(resolve,160));})()`);
    assert.equal(await evaluate('sm.receiptReads.filter(r=>r.after).length'),variant==='unconfirmed'?1:0);
    assert.equal((await evaluate(pending)).id,original.id,'HTTP completion alone never clears the original record');
    for(let i=0;i<3;i++)await pulse(0);
    assert.equal(await evaluate('sm.receiptReads.filter(r=>r.after).length'),variant==='unconfirmed'?1:0,'no busy polling');
    await pulse(5000);
    if(variant==='read-failure')assert.equal(await evaluate(pending),null,'normal read retry confirms the settled action');
    else assert.equal((await evaluate(pending)).id,original.id);
    assert.equal(await evaluate('sm.calls.length'),variant==='unconfirmed'?0:1);
  });
  await t.test('确认接续：确认领取后立即安排下一项，保留原生点击等待',async()=>{
    await setupShelter('sm.dailyIncomplete=true;sm.achievementIncomplete=true;');
    await drive('sm.calls.length===1','collection submitted');
    await pulse(1000);
    assert.equal(await evaluate(pending),null);
    assert.match(await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent`),
      /随机等待.*领取已完成的新手引导奖励/);
    assert.equal(await evaluate('sm.calls.length'),1,'next action keeps its normal click delay');
    await drive(`sm.calls.some(c=>c.type==='claim_tutorial')&&!${pending}`,'next reward confirms');
    assert.equal(await evaluate('sm.calls.length'),2);
  });
  await t.test('执行耗时浏览器：五秒原生等待与四秒读取完成同一调岗，不反复重开',async()=>{
    await setupShelter(scene()+`Math.random=()=>.9999;sm.slowReads=0;sm.slowReadTimings=[];
      const read=window.fetch;window.fetch=(url,options)=>{
        if(url!=='/api/shelter')return read(url,options);
        sm.slowReads++;const timing={start:clock,end:null};sm.slowReadTimings.push(timing);const due=clock+4000;
        return new Promise((resolve,reject)=>{const check=()=>{if(clock<due)return;cleanup();timing.end=clock;read(url,options).then(resolve,reject);};
          const abort=()=>{cleanup();reject(new DOMException('aborted','AbortError'));};
          const cleanup=()=>{window.removeEventListener('focus',check);options.signal.removeEventListener('abort',abort);};
          window.addEventListener('focus',check);options.signal.addEventListener('abort',abort,{once:true});});};`);
    await drive(`${originalCalls}.length===1&&!${pending}`,'slow native workflow reaches one confirmed assignment',120);
    assert.equal(await evaluate(`${originalCalls}.length`),1);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const prepared=events.find(e=>e.type==='shelter-prepared'),confirmed=events.find(e=>e.type==='action'&&e.detail==='确认本轮已核对的居民安排');
    assert.ok(confirmed.at-prepared.at>=5000,'the actual confirmation retains its full wait');
    const timings=await evaluate('sm.slowReadTimings.filter(t=>t.end!==null)');
    assert.ok(timings.length>0);assert.ok(timings.every(t=>t.end-t.start>=4000),'all completed reads retain their injected latency');
    assert.equal(events.filter(e=>e.type==='shelter-work-cancelled').length,0);
    assert.ok(events.some(e=>e.type==='shelter-confirmed'&&e.data.kind==='assign'));
  });
  for(const latency of [0,4000,7000])await t.test('确认并行准备：五秒等待与'+latency+'毫秒读取重叠，发送仍用新状态',async()=>{
    await setupShelter(scene()+`Math.random=()=>.9999;sm.confirmChecks=[];sm.confirmWrites=[];
      const before=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter/action')sm.confirmWrites.push({at:clock,readAt:sm.confirmChecks.at(-1)?.done});
        if(url!=='/api/shelter'||!document.querySelector('[role="alertdialog"]'))return before(url,options);
        const record={started:clock,done:null};sm.confirmChecks.push(record);const due=clock+${latency};
        return new Promise((resolve,reject)=>{
          const cleanup=()=>{window.removeEventListener('focus',check);options.signal.removeEventListener('abort',abort);};
          const check=()=>{if(clock<due)return;cleanup();record.done=clock;before(url,options).then(resolve,reject);};
          const abort=()=>{cleanup();reject(new DOMException('aborted','AbortError'));};
          window.addEventListener('focus',check);options.signal.addEventListener('abort',abort,{once:true});check();
        });};`);
    await drive(`!!document.querySelector('[role="alertdialog"]')`,'confirmation opens');
    const preparedAt=await evaluate(`${pending}.at`);
    await drive(`${originalCalls}.length===1&&!${pending}`,'overlapping confirmation completes',60);
    const checks=await evaluate('sm.confirmChecks'),writes=await evaluate('sm.confirmWrites');
    assert.equal(writes.length,1);
    assert.ok(checks[0].started-preparedAt<1000,'no post-send polling delay before an unsent confirmation');
    assert.equal(checks.length,latency===0?2:1,'no repeated reads during the confirmation countdown');
    assert.ok(writes[0].at-preparedAt>=5000,'the full confirmation wait is retained');
    assert.ok(writes[0].at-preparedAt<=Math.max(5000,latency)+1000,'read latency and countdown overlap');
    assert.ok(writes[0].at-writes[0].readAt<=1500,'fresh completed read before transport');
  });
  await t.test('执行耗时浏览器：确认条件改变后固定取消，不重读重置或覆盖原因',async()=>{
    await open();await evaluate('sm.view.state.resources.food=0;');
    await drive(`!document.querySelector('[role="alertdialog"]')&&!${pending}`,'cancel invalid native confirmation',35);
    assert.equal(await evaluate(`${originalCalls}.length`),0);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.equal(events.filter(e=>e.type==='shelter-confirmation-invalidated').length,1);
    const cancelled=events.find(e=>e.type==='shelter-work-cancelled');
    assert.match(cancelled.data.reason,/动作条件已变化/);
    const evidence=events.filter(e=>e.type==='shelter-execution-evidence');
    assert.equal(evidence.length,1);assert.equal(evidence[0].data.kind,'assign');
    assert.ok(evidence[0].data.fields.length);assert.ok(evidence[0].data.residents.length);
  });
  await t.test('避难所诊断留存：预算压力保留近期完整分片，导出明确报告缺片',async()=>{
    await setupShelter(scene()+`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);
    await evaluate(`(async()=>{const put=(type,data,at=clock)=>window.__arkTestLogs.append({at,group:'expedition',pageId:'audit',type,data},null,false);
      for(let i=0;i<12;i++)await put('old-detail-fixture',{payload:'x'.repeat(1900000)},clock-10000+i);
      await put('shelter-decision',{diagnosticId:'complete',totalParts:2});
      for(let part=0;part<2;part++)await put('shelter-decision-detail',{diagnosticId:'complete',totalParts:2,part,rows:[{id:41}]});
      await put('shelter-execution-evidence',{kind:'assign',targets:[41,210],reason:'facts'});
      for(let i=0;i<4;i++)await put('state',{payload:'x'.repeat(1900000)},clock+i);
      await put('shelter-decision',{diagnosticId:'missing',totalParts:2});
      await put('shelter-decision-detail',{diagnosticId:'missing',totalParts:2,part:0,rows:[]});})();`);
    const result=await evaluate(`(async()=>{const r=await window.__arkTestLogs.export();return {coverage:r.shelterDiagnosticCoverage,warnings:r.warnings,
      bytes:r.estimatedEventBytes,budget:r.budgetBytes,evidence:r.days.flatMap(d=>d.events).filter(e=>e.type==='shelter-execution-evidence')};})()`);
    assert.equal(result.coverage.frames.find(f=>f.diagnosticId==='complete').complete,true);
    assert.equal(result.coverage.frames.find(f=>f.diagnosticId==='missing').missingParts,1);
    assert.ok(result.warnings.some(w=>w.includes('诊断分片不完整')));
    assert.equal(result.evidence.length,1);assert.ok(result.bytes<=result.budget);
  });
  await t.test('执行耗时浏览器：确认阶段三次读取失败后关闭未发送窗口并释放原准备',async()=>{
    await open();await evaluate(`const read=window.fetch;sm.failedReads=0;sm.failedConfirmReads=0;window.fetch=(url,options)=>{
      if(url==='/api/shelter'){sm.failedReads++;if(document.querySelector('[role="alertdialog"]'))sm.failedConfirmReads++;
        return Promise.reject(new TypeError('fixture read failure'));}
      return read(url,options);};`);
    await drive(`sm.failedReads>=3&&!document.querySelector('[role="alertdialog"]')&&!${pending}`,'read failure cancels only unsent preparation',65);
    assert.equal(await evaluate(`${originalCalls}.length`),0);
    assert.equal(await evaluate('sm.failedConfirmReads'),3);
    const cancelled=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='shelter-work-cancelled')`);
    assert.match(cancelled.data.reason,/读取或访问已结束/);
  });
  await t.test('执行耗时浏览器：确认按钮持续不可用时有界撤销，零发送',async()=>{
    await open();await evaluate(`Array.from(document.querySelector('[role="alertdialog"]').querySelectorAll('button')).find(b=>b.textContent==='确认').disabled=true;`);
    await drive(`!document.querySelector('[role="alertdialog"]')&&!${pending}`,'unavailable confirmation closes unsent preparation',40);
    assert.equal(await evaluate(`${originalCalls}.length`),0);
    const cancelled=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='shelter-work-cancelled')`);
    assert.match(cancelled.data.reason,/控件持续不可用/);
  });
  await t.test('执行耗时浏览器：整次访问到限仍取消未发送确认，不能无限占页',async()=>{
    await open();await pulse(331000);
    await drive(`!document.querySelector('[role="alertdialog"]')&&!${pending}`,'visit budget closes unsent native confirmation',25);
    assert.equal(await evaluate(`${originalCalls}.length`),0);
    const cancelled=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='shelter-work-cancelled')`);
    assert.match(cancelled.data.reason,/访问时限已到/);
  });
  await t.test('确认生命周期：截屏快捷键不把原生居民确认永久转为人工处理',async()=>{
    await open();await evaluate(`document.querySelector('[role="alertdialog"] button').focus();`);
    await trustedStaffKey('Meta');await trustedStaffKey('Shift');await trustedStaffKey('s',12);
    await drive(`${originalCalls}.length===1&&!${pending}`,'native confirmation after screenshot keys',35);
    assert.equal(await evaluate(`${originalCalls}.length`),1);
  });
  for(const variant of ['unchanged','food','unpowered'])await t.test('确认生命周期：最终确认重新读取并核对 '+variant,async()=>{
    await open();const at=await evaluate('clock');assert.equal(await evaluate('sm.calls.length'),0);
    if(variant==='food')await evaluate('sm.view.state.resources.food=0;');
    if(variant==='unpowered')await evaluate('sm.view.state.rooms.find(r=>r.id===5).unpowered=true;');
    if(variant==='unchanged'){
      await drive(`${originalCalls}.length===1&&!${pending}`,'valid confirmation submits',35);
      const transport=await evaluate('sm.boundAtTransport[0]');
      assert.equal(transport.pending.lifecycle.phase,'request-bound');
      assert.equal(transport.pending.lifecycle.requestKey,transport.body.idempotencyKey);
      assert.ok((await evaluate('sm.confirmReads')).some(t=>t>at&&t<=transport.at));
      assert.equal(await evaluate('sm.executionPlanCalls||0'),0);
      await reloadShelter();for(let i=0;i<10;i++)await pulse();
      assert.equal(await evaluate(`${originalCalls}.length`),1);
    }else{
      await drive(`!document.querySelector('[role="alertdialog"]')&&!${pending}`,'invalid confirmation cancelled',35);
      assert.equal(await evaluate(`${originalCalls}.length`),0);
      const event=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='shelter-confirmation-invalidated')`);
      assert.ok(event?.data.reason);assert.ok(event?.data.fields.length);
    }
  });
  for(const variant of ['prepared','sent','legacy'])await t.test('确认生命周期：刷新区分 '+variant,async()=>{
    await open();const before=await evaluate(pending);
    assert.equal(await evaluate('sm.calls.length'),0);
    if(variant==='sent'){
      await evaluate('sm.assignUnknown=true;');await drive('sm.calls.length===1','bound unknown send',25);
      assert.equal(await evaluate(`${pending}.lifecycle.phase`),'request-bound');
    }
    if(variant==='legacy')await evaluate(`const p=${pending};delete p.lifecycle;localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(p));`);
    await reloadShelter();
    if(variant==='prepared'){
      await drive(`${originalCalls}.length===1&&!${pending}`,'prepared reload replans',65);
      const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
      assert.ok(events.some(e=>e.type==='shelter-preparation-recovered'&&e.data.operation===before.id));
    }else{
      await drive(`${state}.pendingReadOnly===${pending}?.id&&${state}.nextAt>clock`,'unknown stays read only',40);
      assert.equal(await evaluate(`${pending}.id`),before.id);
      assert.equal(await evaluate('sm.calls.length'),variant==='sent'?1:0);
    }
  });
  await t.test('确认生命周期：发送阶段写入失败阻止原生请求，刷新可重评未发送准备',async()=>{
    await open();
    await evaluate(`const set=Storage.prototype.setItem;window.restorePendingStorage=()=>Storage.prototype.setItem=set;
      Storage.prototype.setItem=function(k,v){if(k==='arkengine:auto-shelter:pending:v1'&&JSON.parse(v)?.lifecycle?.phase==='request-bound')throw Error('fixture send phase write failure');return set.call(this,k,v);};`);
    await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'persist failure blocks send',30);
    assert.equal(await evaluate('sm.calls.length'),0);assert.equal(await evaluate(`${pending}.lifecycle.phase`),'prepared');
    await evaluate(`restorePendingStorage();localStorage.setItem('arkengine:auto-shelter:enabled:v1','true');`);
    await reloadShelter();await drive(`${originalCalls}.length===1&&!${pending}`,'unsent retry is newly planned',65);
  });
  for(const paused of [false,true])await t.test('确认生命周期：人工确认保存发送凭据且刷新不补发，暂停='+paused,async()=>{
    await open();await evaluate(`sm.assignUnknown=true;document.querySelector('[role="alertdialog"] button').focus();`);await trustedStaffKey();
    if(paused)await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('shelter-toggle').click();`);
    await evaluate(`Array.from(document.querySelector('[role="alertdialog"]').querySelectorAll('button')).find(b=>b.textContent==='确认').click();`);
    await drive('sm.calls.length===1','owner native confirmation bound',10);
    const p=await evaluate(pending);assert.equal(p.lifecycle.phase,'request-bound');
    if(paused)await evaluate(`localStorage.setItem('arkengine:auto-shelter:enabled:v1','true');`);
    await reloadShelter();for(let i=0;i<20;i++)await pulse();
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`${pending}.id`),p.id);
  });
  await t.test('人工取消恢复：明确取消原确认后释放未发送准备，仍保留人工操作等待',async()=>{
    await open();const original=await evaluate(pending);
    await evaluate(`Array.from(document.querySelector('[role="alertdialog"]').querySelectorAll('button')).find(button=>button.textContent==='取消').focus();`);
    await trustedStaffKey('Enter');await pulse(1000);
    assert.equal(await evaluate(`!!document.querySelector('[role="alertdialog"]')`),false,'trusted cancellation closes the native dialog');
    assert.equal(await evaluate('sm.calls.length'),0);assert.equal(await evaluate(pending),null);
    const cancelled=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(event=>event.type==='shelter-work-cancelled'&&event.data.operation===${JSON.stringify(original.id)})`);
    assert.equal(cancelled?.data.ownerCancelled,true);
    assert.match(await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent`),/自动操作等待/);
    await pulse(65000);
    await drive(`!document.querySelector('[role="dialog"],[role="alertdialog"]')&&!${pending}`,'cancelled operation stops blocking the visit',20);
    assert.equal(await evaluate(`${originalCalls}.length`),0);
  });
  for(const action of ['takeover','removed','hidden','cancel-blocked'])await t.test('人工取消恢复：未观察到明确取消并关闭时保留原记录 '+action,async()=>{
    await open();const original=await evaluate(pending);
    await evaluate(`document.querySelector('[role="alertdialog"] button').focus();`);await trustedStaffKey();
    if(action==='removed')await evaluate(`document.querySelector('[role="alertdialog"]').remove();`);
    if(action==='hidden')await evaluate(`document.querySelector('[role="alertdialog"]').hidden=true;`);
    if(action==='cancel-blocked'){
      await evaluate(`const button=Array.from(document.querySelector('[role="alertdialog"]').querySelectorAll('button')).find(button=>button.textContent==='取消');button.onclick=()=>{};button.focus();`);
      await trustedStaffKey('Enter');
    }
    await pulse(1000);assert.equal(await evaluate(`${pending}?.id`),original.id);
    assert.equal(await evaluate('sm.calls.length'),0);
  });
  await t.test('确认生命周期：新标签接管准备后，旧标签原确认不能重发或停掉新标签',async()=>{
    await open();const original=await evaluate(pending);
    const second=await secondShelter('sm.assignUnknown=true;');
    try{
      await second.withFrozenOriginal(async()=>{
        for(let i=0;i<55&&!(await second.evaluate('sm.calls.length'));i++)await second.pulse();
        assert.equal(await second.evaluate('sm.calls.length'),1);
        const current=await second.evaluate(pending);assert.notEqual(current.id,original.id);
        assert.equal(current.lifecycle.phase,'request-bound');
      });
      // Resume the old native callback synchronously, before the next scheduler
      // can retire its now-obsolete confirmation object.
      await evaluate(`Array.from(document.querySelector('[role="alertdialog"]').querySelectorAll('button')).find(b=>b.textContent==='确认').click();`);
      for(let i=0;i<4;i++)await pulse();
      assert.equal(await evaluate('sm.calls.length'),0);
      assert.equal(await second.evaluate('sm.calls.length'),1);
      assert.equal(await second.evaluate("localStorage.getItem('arkengine:auto-shelter:enabled:v1')"),'true');
    }finally{await second.close();}
  });
}
