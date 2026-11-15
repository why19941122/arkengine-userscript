import assert from 'node:assert/strict';
import {stockSnapshotsFromLog} from './arkengine-stock-replay.mjs';

export async function stockRetentionTests({t,setupStock,reloadStock,evaluate,until}) {
  const quiet=`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');
    localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({trade:false,predict:false,tradeLimit:3000,predictionLimit:0,stake:0,reserve:100}));`;
  const helpers=`window.retentionOrigin=clock;window.retentionSequence=0;
    window.retentionPut=(at,id,{cash=10000,price=1200,pageId='retention-page',rolling=false,settings={observeOnly:true},padding=''}={})=>{
      const stocks=Array.from({length:67},(_,i)=>({id:i+1,modelName:'模型'+i,priceCents:price+i,volume24h:1000}));
      const ticks=stocks.flatMap(s=>Array.from({length:12},(_,i)=>({stockId:s.id,priceCents:price+i,
        createdAt:new Date((rolling?at:retentionOrigin)-(11-i)*300000).toISOString()})));
      const common={settings,parts:[{userId:77,enabled:true,rules:km.view.rules,stocks,ticks,
        accountSnapshot:{userId:77,balanceTokens:cash,positions:[],pendingKnown:true,pending:null}}]};
      const reading={at,observationId:id,visibility:'hidden',reading:{generation:++retentionSequence,phase:'scan',marketAt:at,balanceAt:at,freshnessAt:at}};
      return window.__arkTestLogs.appendObservation({at,pageId,group:'expedition',version:'retention-fixture',page:'/stock',
        visibility:'hidden',type:'stock-observation-block',detail:'conditional retention'+padding},common,reading);
    };
    window.retentionPhysical=()=>new Promise((resolve,reject)=>{const req=indexedDB.open('arkengine-auto-log',1);
      req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction(['events','meta'],'readonly'),r=tx.objectStore('events').getAll();
        r.onerror=()=>reject(r.error);r.onsuccess=()=>{const rows=r.result,blocks=rows.filter(e=>e.type==='stock-observation-block');
          resolve({blocks:blocks.map(e=>({id:e.id,at:e.at,bytes:e.bytes,encoding:e.data.content.encoding,rawBytes:e.data.content.rawBytes,
            hash:e.data.content.sha256,readings:e.data.readings.length})),bytes:rows.reduce((n,e)=>n+e.bytes,0),rows:rows.length});};
        tx.oncomplete=()=>db.close();};});`;
  const setup=async()=>{await setupStock(quiet);await evaluate(helpers);};
  await t.test('跨玩法日志留存：旧行情不能挤掉较新避难所现场，整轮淘汰明确告警且回执保留',async()=>{
    await setup();
    await evaluate(`(async()=>{
      await window.__arkTestLogs.append({at:clock++,group:'expedition',type:'shelter-confirmed',data:{},receiptId:'preserved-receipt'},null,false);
      for(let i=0;i<10;i++)await retentionPut(clock++,'old-'+i,{price:1200+i,padding:'x'.repeat(1900000)});
      window.putShelter=async(id,payload='')=>{
        const common={group:'expedition',pageId:'shelter-diagnostic'};
        await window.__arkTestLogs.append({...common,at:clock++,type:'shelter-decision',data:{diagnosticId:id,totalParts:1}},null,false);
        await window.__arkTestLogs.append({...common,at:clock++,type:'shelter-decision-detail',data:{diagnosticId:id,part:0,totalParts:1,rows:[{payload}]}},null,false);
      };
      await putShelter('migrated');
      await new Promise((resolve,reject)=>{const r=indexedDB.open('arkengine-auto-log',1);r.onsuccess=()=>{
        const db=r.result,tx=db.transaction(['events','meta'],'readwrite'),s=tx.objectStore('events'),c=s.openCursor();
        c.onsuccess=()=>{const x=c.result;if(!x)return;const v=x.value;
          if(v.type.startsWith('shelter-decision'))x.update({...v,priority:1});x.continue();};
        const b=tx.objectStore('meta').get('budget');b.onsuccess=()=>{b.result.priorityVersion=4;tx.objectStore('meta').put(b.result);};
        tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});
      await putShelter('recent','x'.repeat(2000000));
    })()`);
    const first=await evaluate('window.__arkTestLogs.export()');
    assert.equal(first.shelterDiagnosticCoverage.completeRounds,2);
    assert.equal(first.shelterDiagnosticCoverage.summaries.missing,0);
    assert.ok(first.stockObservationCoverage.droppedReadings>0,'容量不足时先淘汰更早的同级行情');
    assert.ok(first.estimatedEventBytes<=first.budgetBytes);
    await evaluate(`(async()=>{for(let i=0;i<12;i++)await retentionPut(clock++,'new-'+i,{price:1300+i,padding:'x'.repeat(1900000)});})()`);
    const last=await evaluate('window.__arkTestLogs.export()');
    assert.equal(last.shelterDiagnosticCoverage.summaries.missing,2,'整条摘要消失也必须可见');
    assert.ok(last.warnings.some(w=>/摘要.*未保留/.test(w)));
    assert.equal(last.criticalEventCoverage.droppedEvents,0);
    assert.equal(last.days.flatMap(d=>d.events).filter(e=>e.receiptId==='preserved-receipt').length,1);
    assert.ok(last.estimatedEventBytes<=last.budgetBytes);
  });
  await t.test('日志启动提速：折叠面板只读两组汇总，跨刷新交付收益不解压历史，展开和导出仍完整',async()=>{
    await setup();
    await evaluate(`(async()=>{
      for(let i=0;i<64;i++){clock=retentionOrigin+i*50000;await retentionPut(clock,'startup-'+i);}
      for(const group of ['cultivate','expedition']){
        await window.__arkTestLogs.append({at:clock,group,type:'startup-income',data:{},receiptId:group+'-existing'},{代币:10},false);
        sessionStorage.setItem('arkengine:auto-log:v1:'+group+':outbox',JSON.stringify([
          {at:clock,group,type:'startup-income',data:{reward:{代币:7}},receiptId:group+'-pending'}]));
      }
    })()`);
    assert.equal((await evaluate('retentionPhysical()')).blocks[0].readings,64);
    const spy=`window.startupReads={buckets:0,decompressions:0};
      const originalCursor=IDBIndex.prototype.openCursor;IDBIndex.prototype.openCursor=function(...args){
        if(this.name==='bucket')startupReads.buckets++;return originalCursor.apply(this,args);};
      const OriginalDecompressionStream=DecompressionStream;
      window.DecompressionStream=class extends OriginalDecompressionStream{constructor(...args){super(...args);startupReads.decompressions++;}};`;
    await reloadStock(spy);
    // A queued append resolves only after both startup reads and outbox delivery.
    await evaluate(`window.__arkTestLogs.append({at:clock,group:'expedition',type:'startup-barrier',data:{}},null,false)`);
    const counts=await evaluate('startupReads');
    assert.deepEqual(counts,{buckets:0,decompressions:0},'collapsed panels need totals, not historical payloads');
    for(const group of ['cultivate','expedition']){
      const id=group==='cultivate'?'encounter':'expedition';
      assert.match(await evaluate(`document.getElementById('ark-auto-${id}').shadowRoot.getElementById('log-summary').textContent`),/代币 17/);
      assert.deepEqual(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-log:v1:${group}:outbox'))`),[]);
    }
    await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('local-log').open=true;`);
    await until(()=>evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.querySelector('#local-log pre').textContent.includes('stock-observation')`),'expanded log still loads observations');
    assert.ok((await evaluate('startupReads')).decompressions>0);
    const full=await evaluate('window.__arkTestLogs.export()');
    assert.equal(stockSnapshotsFromLog(full).length,64);
    for(const group of ['cultivate','expedition'])assert.equal(full.days.find(d=>d.group===group).totals['代币'],17);
    await reloadStock(spy);
    await evaluate(`window.__arkTestLogs.append({at:clock,group:'expedition',type:'startup-barrier',data:{}},null,false)`);
    assert.deepEqual(await evaluate('startupReads'),{buckets:0,decompressions:0});
    const after=await evaluate('window.__arkTestLogs.export()');
    assert.deepEqual(stockSnapshotsFromLog(after),stockSnapshotsFromLog(full));
    for(const group of ['cultivate','expedition'])assert.equal(after.days.find(d=>d.group===group).totals['代币'],17,'reload must not count delivered income twice');
  });
  await t.test('日志启动隔离：历史解压挂起时，新回执仍落盘；展开历史后仍等待真实解压',async()=>{
    await setup();await evaluate(`retentionPut(clock,'blocked-history')`);
    await reloadStock(`window.historyGate=new Promise(resolve=>window.releaseHistory=resolve);window.historyDecodes=0;
      const OriginalDecompressionStream=DecompressionStream;
      window.DecompressionStream=class{constructor(format){historyDecodes++;
        const stream=new OriginalDecompressionStream(format);this.writable=stream.writable;
        this.readable=stream.readable.pipeThrough(new TransformStream({async transform(chunk,controller){await historyGate;controller.enqueue(chunk);}}));}};`);
    try{
      await evaluate(`window.newReceiptSaved=false;window.newReceiptFailure=null;
        void window.__arkTestLogs.append({at:clock,group:'expedition',type:'new-income',data:{},receiptId:'new-income'},
          {代币:13},false).then(()=>newReceiptSaved=true).catch(e=>newReceiptFailure=e.message);`);
      await until(()=>evaluate('newReceiptSaved||newReceiptFailure'),'new receipt without decoding history',2000);
      assert.equal(await evaluate('newReceiptFailure'),null);
      assert.equal(await evaluate('historyDecodes'),0);
      assert.equal(await evaluate(`(await window.__arkTestLogs.summary('expedition')).totals['代币']`),13);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('local-log').open=true;`);
      await until(()=>evaluate('historyDecodes>0'),'explicit history triggers decoding');
      assert.equal(await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.querySelector('#local-log pre').textContent`),'');
    }finally{await evaluate('releaseHistory()');}
    await until(()=>evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.querySelector('#local-log pre').textContent.includes('stock-observation')`),'history completes after decoding');
    assert.equal(stockSnapshotsFromLog(await evaluate('window.__arkTestLogs.export()')).length,1);
  });
  await t.test('日志汇总边界：空桶、两组、跨日与重复回执和完整读取一致，失败不伪装空汇总',async()=>{
    await setup();
    assert.equal(await evaluate(`window.__arkTestLogs.summary('expedition','2000-01-01')`),null);
    await evaluate(`(async()=>{
      for(const group of ['cultivate','expedition'])for(let i=0;i<2;i++)
        await window.__arkTestLogs.append({at:clock,group,type:'summary-income',data:{},receiptId:group+'-summary'},
          {代币:group==='cultivate'?11:17},false);
      clock+=86400000;
      await window.__arkTestLogs.append({at:clock,group:'expedition',type:'summary-next-day',data:{}},{代币:19},false);
    })()`);
    const days=(await evaluate('window.__arkTestLogs.export()')).days;
    for(const d of days){
      const args=JSON.stringify(d.group)+','+JSON.stringify(d.day);
      const summary=await evaluate(`window.__arkTestLogs.summary(${args})`),full=await evaluate(`window.__arkTestLogs.read(${args},Infinity)`);
      const {events,...expected}=full;assert.deepEqual(summary,expected);
    }
    assert.equal(await evaluate(`(await window.__arkTestLogs.summary('expedition')).totals['代币']`),19);
    await evaluate(`window.originalSummaryGet=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(...args){
      if(this.name==='days')throw Error('fixture summary failure');return originalSummaryGet.apply(this,args);};`);
    try{assert.match(await evaluate(`window.__arkTestLogs.summary('expedition').then(()=>null,e=>e.message)`),/fixture summary failure/);}
    finally{await evaluate('IDBObjectStore.prototype.get=originalSummaryGet;');}
    assert.equal(await evaluate(`(await window.__arkTestLogs.summary('expedition')).totals['代币']`),19);
  });
  await t.test('股市诊断留存：迁移旧优先级后容量压力保留成套明细与原始行情，真实缺片可见',async()=>{
    await setup();await evaluate(`(async()=>{
      await retentionPut(clock,'original');
      window.putDiagnostic=async(id,payload='')=>{
        const common={at:clock++,group:'expedition',pageId:'diagnostic-page'};
        await window.__arkTestLogs.append({...common,type:'stock-decision',data:{diagnosticId:id,totalParts:1}},null,false);
        await window.__arkTestLogs.append({...common,at:clock++,type:'stock-decision-detail',data:{diagnosticId:id,part:0,totalParts:1,rows:[{payload}]}},null,false);
      };
      await putDiagnostic('migrated');
      await new Promise((resolve,reject)=>{const r=indexedDB.open('arkengine-auto-log',1);r.onsuccess=()=>{
        const db=r.result,tx=db.transaction(['events','meta'],'readwrite'),s=tx.objectStore('events'),c=s.openCursor();
        c.onsuccess=()=>{const x=c.result;if(!x)return;const v=x.value;
          if(v.type==='stock-decision-detail')x.update({...v,priority:0});
          if(v.type==='stock-decision')x.update({...v,priority:1});x.continue();};
        const b=tx.objectStore('meta').get('budget');b.onsuccess=()=>{b.result.priorityVersion=3;tx.objectStore('meta').put(b.result);};
        tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});
      for(let i=0;i<12;i++)await window.__arkTestLogs.append({at:clock++,group:'expedition',type:'heartbeat',data:{payload:'x'.repeat(1900000)}},null,false);
    })()`);
    const first=await evaluate('window.__arkTestLogs.export()');
    assert.equal(first.days.flatMap(d=>d.events).filter(e=>e.type==='stock-decision-detail'&&e.data.diagnosticId==='migrated').length,1,
      'normal traffic cannot discard the older diagnostic parts while retaining their summary');
    assert.equal(first.stockDiagnosticCoverage.completeRounds,1);
    assert.equal(first.stockObservationCoverage.droppedReadings,0);
    await evaluate(`(async()=>{for(let i=0;i<12;i++)await window.__arkTestLogs.append({at:clock++,group:'expedition',type:'old-check-fixture',data:{payload:'x'.repeat(1900000)}},null,false);
      await putDiagnostic('after-old-checks');})()`);
    const full=await evaluate('window.__arkTestLogs.export()');
    assert.equal(full.stockDiagnosticCoverage.frames.find(f=>f.diagnosticId==='after-old-checks')?.complete,true,
      'a full store of older ordinary checks must make room for the latest stock diagnostic');
    await evaluate(`(async()=>{for(let i=0;i<12;i++)await putDiagnostic('pressure-'+i,'x'.repeat(1900000));
      await window.__arkTestLogs.append({at:clock++,group:'expedition',pageId:'diagnostic-page',type:'stock-decision',data:{diagnosticId:'broken',totalParts:2}},null,false);
    })()`);
    const last=await evaluate('window.__arkTestLogs.export()'),coverage=last.stockDiagnosticCoverage;
    assert.equal(coverage.frames.find(f=>f.diagnosticId==='pressure-11').complete,true);
    assert.equal(coverage.frames.find(f=>f.diagnosticId==='broken').missingParts,2);
    assert.ok(last.warnings.some(w=>/股市.*诊断分片不完整/.test(w)));
    assert.equal(last.stockObservationCoverage.droppedReadings,0);
    assert.equal(stockSnapshotsFromLog(last).length,1);assert.ok(last.estimatedEventBytes<=last.budgetBytes);
  });
  await t.test('股市留存：相同行情合并读取，账户与设置变化分块，刷新不依赖旧页面基准',async()=>{
    await setup();const start=await evaluate('clock');
    await evaluate(`(async()=>{for(let i=0;i<3;i++){clock=retentionOrigin+i*300000;await retentionPut(clock,'same-'+i);}
      clock+=300000;await retentionPut(clock,'cash',{cash:9999});clock+=300000;await retentionPut(clock,'settings',{cash:9999,settings:{observeOnly:false}});})()`);
    const physical=await evaluate('retentionPhysical()');assert.equal(physical.blocks.length,3);assert.equal(physical.blocks[0].readings,3);
    assert.ok(physical.blocks.every(b=>b.encoding==='gzip-base64'));
    const before=await evaluate('window.__arkTestLogs.export()'),frames=stockSnapshotsFromLog(before);
    assert.equal(frames.length,5);assert.deepEqual(frames.map(f=>f.at),Array.from({length:5},(_,i)=>start+i*300000));
    assert.equal(frames[3].sourceAccount.balanceTokens,9999);assert.equal(frames[4].recordedSettings.observeOnly,false);
    assert.equal(before.stockObservationCoverage.retainedPackedReadings,5);assert.equal(before.stockObservationCoverage.blocks,3);
    await reloadStock();const after=await evaluate('window.__arkTestLogs.export()');assert.deepEqual(stockSnapshotsFromLog(after),frames);
    assert.equal(after.estimatedEventBytes>=physical.bytes,true);
  });
  await t.test('股市留存：失败事务无半组，重复读数幂等，恢复后可完整导出',async()=>{
    await setup();await evaluate(`(async()=>{window.savedPut=IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add=function(value,...args){if(value?.type==='stock-observation-block')throw Error('fixture write failure');return savedPut.call(this,value,...args);};
      window.retentionFailure=null;await retentionPut(clock,'failed').catch(e=>retentionFailure=e.message);IDBObjectStore.prototype.add=savedPut;})()`);
    assert.match(await evaluate('retentionFailure'),/fixture write failure/);
    assert.equal((await evaluate('retentionPhysical()')).blocks.length,0);
    await evaluate(`(async()=>{await retentionPut(clock,'accepted');retentionSequence--;await retentionPut(clock,'accepted');})()`);
    const exported=await evaluate('window.__arkTestLogs.export()');assert.equal(exported.stockObservationCoverage.acceptedReadings,1);
    assert.equal(stockSnapshotsFromLog(exported).length,1);
    assert.equal((await evaluate('retentionPhysical()')).blocks[0].readings,1);
  });
  await t.test('股市留存：容量淘汰整块并报告缺口，后续相同快照仍可独立恢复',async()=>{
    await setup();await evaluate(`(async()=>{await retentionPut(clock,'first');clock+=300000;await retentionPut(clock,'second');
      for(let i=0;i<12;i++)await window.__arkTestLogs.append({at:clock+i+1,group:'expedition',type:'critical-fixture',receiptId:'pressure-'+i,detail:'capacity pressure',data:{payload:'x'.repeat(1900000)}},null,false);
      clock+=1200000;await retentionPut(clock,'after-eviction');})()`);
    const exported=await evaluate(`(async()=>{const x=await window.__arkTestLogs.export();return {...x,days:x.days.map(d=>({...d,events:d.events.filter(e=>e.type==='stock-observation')}))};})()`);
    const frames=stockSnapshotsFromLog(exported);assert.equal(frames.length,1);assert.equal(frames[0].sourceObservation.id,'after-eviction');
    assert.equal(exported.stockObservationCoverage.acceptedReadings,3);assert.equal(exported.stockObservationCoverage.droppedReadings,2);
    assert.equal(exported.stockObservationCoverage.retainedPackedReadings,1);assert.ok(exported.estimatedEventBytes<=exported.budgetBytes);
    assert.equal((await evaluate('retentionPhysical()')).blocks.length,1);
  });
  await t.test('股市留存：超十分钟读取空档可见，压缩损坏导出拒绝且原数据保留',async()=>{
    await setup();await evaluate(`(async()=>{await retentionPut(clock,'before-gap');clock+=900000;await retentionPut(clock,'after-gap');})()`);
    const exported=await evaluate('window.__arkTestLogs.export()');assert.equal(exported.stockObservationCoverage.accounts[0].gapsOverTenMinutes[0].durationMs,900000);
    await evaluate(`(async()=>{await new Promise((resolve,reject)=>{const r=indexedDB.open('arkengine-auto-log',1);r.onsuccess=()=>{
      const db=r.result,tx=db.transaction('events','readwrite'),s=tx.objectStore('events'),c=s.openCursor();c.onsuccess=()=>{const x=c.result;if(!x)return;
        if(x.value.type==='stock-observation-block'){const value=x.value;value.data.content.sha256='0'.repeat(64);x.update(value);}else x.continue();};
      tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});
      window.retentionError=await window.__arkTestLogs.export().then(()=>null,e=>e.message);})()`);
    assert.match(await evaluate('retentionError'),/integrity/);assert.equal((await evaluate('retentionPhysical()')).blocks.length,1);
  });
  await t.test('股市留存：连续168小时变化行情与重复诊断在20MiB内保留，跨日不截掉起点',async()=>{
    await setup();
    // Synthetic traffic: 67 models, twelve points each, changing every five minutes.
    // Ordinary detail pressure is explicitly injected; this is capacity evidence, not a
    // real 24-hour background run or real market profitability.
    await evaluate(`clock=Date.parse('2026-11-02T12:00:00+08:00');retentionOrigin=clock;
      window.retentionBusy=true;window.retentionRunError=null;window.retentionProgress=0;
      window.retentionRun=(async()=>{for(let i=0;i<=2016;i++){
        clock=retentionOrigin+i*300000;await retentionPut(clock,'seven-day-'+i,{price:1200+i%37,rolling:true});
        await window.__arkTestLogs.append({at:clock,group:'expedition',type:'stock-decision-detail',detail:'synthetic repeated detail',
          data:{diagnosticId:'synthetic-'+i,payload:'详情'.repeat(3500)}},null,false);retentionProgress=i;
      }})().catch(e=>{retentionRunError=e.message;}).finally(()=>{retentionBusy=false;});void 0;`);
    await until(()=>evaluate('!retentionBusy'),'168-hour retention workload',300000);
    assert.equal(await evaluate('retentionRunError'),null);
    const summary=await evaluate(`(async()=>{const x=await window.__arkTestLogs.export(),f=x.days.flatMap(d=>d.events).filter(e=>e.type==='stock-observation');
      const ids=new Set(f.map(e=>e.data.observationId));return {coverage:x.stockObservationCoverage,bytes:x.estimatedEventBytes,budget:x.budgetBytes,
        droppedDetails:x.days.reduce((n,d)=>n+d.dropped,0),frames:ids.size,allParts:f.every(e=>e.data.totalParts===1),
        first:f[0].data.at,last:f.at(-1).data.at,stocks:f[0].data.snapshot.stocks.length,ticks:f[0].data.snapshot.ticks.length,
        days:x.days.map(d=>d.day),mode:x.retentionMode};})()`);
    assert.equal(summary.frames,2017);assert.equal(summary.last-summary.first,168*3600000);
    assert.equal(summary.stocks,67);assert.equal(summary.ticks,804);assert.equal(summary.allParts,true);
    assert.ok(summary.bytes<=summary.budget);assert.ok(summary.droppedDetails>0);
    assert.equal(summary.coverage.droppedReadings,0);assert.equal(summary.coverage.accounts[0].gapsOverTenMinutes.length,0);
    assert.equal(summary.coverage.retainedPackedReadings,2017);assert.ok(summary.days.includes('2026-11-02'));
    console.log(JSON.stringify({kind:'stock-retention-168h',...summary,scope:'synthetic capacity and export, not real background continuity'}));
  });
}
