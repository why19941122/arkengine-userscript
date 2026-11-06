import assert from 'node:assert/strict';

export async function shelterPopulationTests({t,setupShelter,reloadShelter,evaluate,pulse,drive,trustedStaffKey,secondShelter,until}) {
  const panel = `document.getElementById('ark-auto-expedition').shadowRoot`;
  const state = `JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`;
  const pending = `JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`;
  const moves = `sm.calls.filter(c=>c.type==='assign')`;
  const intoQuarters = `${moves}.filter(c=>c.roomId===5)`;
  const done = `location.pathname==='/activities/expedition' && ${state}?.nextAt>clock`;
  const check = `${panel}.getElementById('shelter-check').click()`;
  const target = value => `${panel}.getElementById('shelter-population').value='${value}';${panel}.getElementById('shelter-population').dispatchEvent(new Event('change'));`;
  const scene = `sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
    const original=sm.view.state.rooms[0],adult=sm.view.state.residents[0];
    sm.view.state.rooms=['scrap','power','diner','water','quarters'].map((type,i)=>({...original,id:i+1,type,width:i===0||i===4?3:1,level:i===4?2:1,stored:0}));
    sm.view.state.residents=Array.from({length:7},(_,i)=>({...structuredClone(adult),id:i+1,name:'居民'+(i+1),roomId:[2,3,4,1,1,null,null][i],
      stats:{str:3,per:3,end:3,cha:3,int:3,agi:3,lck:3}}));
    sm.view.state.residents[0].stats.str=10;sm.view.state.residents[1].stats.agi=10;sm.view.state.residents[2].stats.per=10;
    sm.view.state.residents[3].stats.end=10;sm.view.state.residents[4].stats.end=7;`;
  const onlyIdle = `sm.view.state.residents[3].familyCooldownUntil=clock+86400000;sm.view.state.residents[4].familyCooldownUntil=clock+86400000;`;
  const children = `for(let id=8;id<=13;id++)sm.view.state.residents.push({...structuredClone(adult),id,name:'孩子'+id,roomId:5,parents:[4,5],adultAt:clock+10800000});`;
  const adequate = `sm.view.state.rooms[2].level=2;sm.view.state.rooms[3].level=2;`;
  const fullSupply = `${scene}${children}
    sm.view.state.residents[5].roomId=3;sm.view.state.residents[5].stats.agi=0;sm.view.state.residents[5].stats.per=0;sm.view.state.residents[5].stats.str=0;
    sm.view.state.residents[6].roomId=4;sm.view.state.residents[6].stats.per=0;sm.view.state.residents[6].stats.agi=0;sm.view.state.residents[6].stats.str=0;
    sm.view.state.residents[3].stats.agi=17;sm.view.state.residents[3].stats.per=0;
    sm.view.state.residents[4].stats.per=17;sm.view.state.residents[4].stats.agi=0;`;
  const workingFamily = `${scene}sm.confirmFamily=true;
    sm.view.state.residents[3].stats.agi=10;sm.view.state.residents[3].stats.per=0;
    sm.view.state.residents[4].stats.per=10;sm.view.state.residents[4].stats.agi=0;
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'原配对正在生产',vaultNo:77,families:[{a:2,b:3,room:5}]}));`;

  const sharedQuarters = `${scene}${adequate}sm.confirmFamily=true;
    sm.view.state.rooms.push({...original,id:6,type:'quarters',width:2,stored:0});
    for(const id of [4,5]){const p=sm.view.state.residents[id-1];p.roomId=6;p.romance={partnerId:id===4?5:4,progress:.2};}
    for(let id=8;id<=12;id++)sm.view.state.residents.push({...structuredClone(adult),id,name:'居民'+id,roomId:6,
      adultAt:id<=9?0:clock+10800000,familyCooldownUntil:id<=9?clock+3600000:0});
    sm.view.state.births=[{id:1,roomId:6,parents:[8,9],dueAt:clock+3600000}];`;

  await t.test('同宿舍人口预留：另一对待产不抵消当前感情名额，12人加两个预留达到14后不再安排新配对',async()=>{
    await setupShelter(sharedQuarters);await drive(done,'two families share quarters at target',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),0,'待产一人和另一对感情各占一个名额，不能新增第15人');
    assert.match(await evaluate(`${panel}.getElementById('shelter-population-status').textContent`),/待产及已预约名额 2/);
    assert.match(await evaluate(`${state}.development`),/另预留 1 个出生名额/);
  });
  await t.test('同宿舍人口预留刷新：跨刷新仍保留两家名额，原感情结束且冷却后才接续新增配对',async()=>{
    await setupShelter(sharedQuarters);const fixtureSearch=await evaluate('location.search');
    await drive(done,'shared quarters reservation before reload',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),0);
    await pulse(1000);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'shared quarters reservation after reload',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),0);
    assert.ok(await evaluate(`${moves}.every(c=>![4,5].includes(c.residentId))`),'仍在培养感情的一对不能被调走');
    await evaluate(`for(const p of sm.view.state.residents.filter(p=>[4,5].includes(p.id))){p.romance=null;p.familyCooldownUntil=clock+3600000;}${check}`);
    await drive(`location.pathname==='/shelter'`,'one family reservation released');await drive(done,'new family within fourteen',200);
    assert.deepEqual(await evaluate(`${intoQuarters}.map(c=>c.residentId)`),[6,7]);
    assert.ok(await evaluate(`${state}.families.some(f=>f.a===6&&f.b===7)`));
    assert.deepEqual(await evaluate('sm.view.state.births[0].parents'),[8,9],'父母调岗后仍保留原待产身份');
  });
  await t.test('同宿舍人口预留匹配：同父母待产与旧感情只算一次，仍可使用剩余一个名额',async()=>{
    await setupShelter(`${sharedQuarters}sm.view.state.births[0].parents=[5,4];`);
    await drive(done,'matching parents do not duplicate reservation',200);
    assert.deepEqual(await evaluate(`${intoQuarters}.map(c=>c.residentId)`),[6,7]);
    assert.match(await evaluate(`${state}.development`),/另预留 1 个出生名额/);
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[4,5].includes(p.id)).map(p=>p.roomId)'),[1,1],'确认怀孕后原父母可在回收站工作');
  });
  await t.test('同宿舍人口预留缺失：父母资料暂缺不按房间猜测，补齐后自动释放重复预留',async()=>{
    await setupShelter(`${sharedQuarters}delete sm.view.state.births[0].parents;`);
    await drive(done,'unknown birth parents keep romance reservation',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),0);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'true');
    await evaluate(`sm.view.state.births[0].parents=[4,5];${check}`);
    await drive(`location.pathname==='/shelter'`,'birth parents become readable');await drive(done,'matching birth releases duplicate reservation',200);
    assert.deepEqual(await evaluate(`${intoQuarters}.map(c=>c.residentId)`),[6,7]);
  });
  await t.test('同宿舍人口预留中途：第一人入住后读到另一家待产，取消剩余新配对且不记失败封锁',async()=>{
    await setupShelter(`${sharedQuarters}sm.view.state.births[0].parents=[4,5];`);
    await drive(`${moves}.length===1&&${pending}===null`,'first resident placed before corrected family data');
    await evaluate(`sm.view.state.births[0].parents=[8,9];`);
    await drive(done,'cancel second resident after updated reservation',200);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[6,null]]);
    assert.equal(await evaluate(`${state}.pair`),null);assert.deepEqual(await evaluate(`${state}.pairBlocks||[]`),[]);
  });
  await t.test('同宿舍人口预留原家庭：只轮换原家庭模式也计入同房另一家的感情，不越过宿舍总容量',async()=>{
    await setupShelter(`${sharedQuarters}
      localStorage.setItem('arkengine:auto-shelter:staff:v1','family');
      Object.assign(sm.view.state.rooms.find(r=>r.id===5),{width:2,level:1});
      for(let id=13;id<=14;id++)sm.view.state.residents.push({...structuredClone(adult),id,name:'孩子'+id,roomId:6,adultAt:clock+10800000});
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'原家庭等待',vaultNo:77,families:[{a:6,b:7,room:5}]}));`);
    await drive(done,'existing family reserves shared quarters births',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),0,'14人加待产1和另一对感情1已占满16床位');
    assert.ok(await evaluate(`${state}.families.some(f=>f.a===6&&f.b===7)`));
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:staff:v1')`),'family');
  });

  await t.test('避难所跨页同步：通知迟到时在另一页检查或改人口目标，不丢失已安排一人的配对进度',async()=>{
    for(const control of [check,target(15)]){
      await setupShelter(`${scene}sm.deferRead=true;sm.confirmFamily=true;`);
      await until(()=>evaluate(`typeof sm.resolveRead==='function'`),'first read pending');
      const second=await secondShelter(`window.addEventListener('storage',e=>{
        if(e.key?.startsWith('arkengine:auto-shelter:'))e.stopImmediatePropagation();},true);`);
      try{
        await evaluate('sm.deferRead=false;sm.resolveRead();');
        await drive(`${moves}.length===1&&${pending}===null`,'first resident assigned');
        // Evaluate once more so the persisted plan reflects the confirmed first move.
        await drive(`${state}.pair?.step===1`,'first move progress persisted');
        const original=await evaluate(`${state}.pair`);
        await second.evaluate(control);
        assert.deepEqual(await evaluate(`${state}.pair`),original,'secondary control must merge latest progress');
        assert.deepEqual(await second.evaluate('sm.calls'),[]);
      }finally{await second.close();}
      await drive(done,'remaining pairing completes',200);
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[7,5]]);
      assert.ok(await evaluate(`${state}.families.some(f=>f.a===6&&f.b===7)`));
    }
  });
  await t.test('人口恢复预留：13名存活加1名倒下不新增生育，跨刷新保留，记录移除后才释放名额',async()=>{
    await setupShelter(`${scene}${children}${adequate}sm.confirmFamily=true;
      sm.view.state.residents.push({...structuredClone(adult),id:14,name:'等待救回',roomId:null,deadAt:clock-25*3600000,hp:0});`);
    const fixtureSearch=await evaluate('location.search');
    await drive(done,'reserve recovery at target fourteen',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),0);
    assert.match(await evaluate(`${panel}.getElementById('shelter-population-status').textContent`),/倒下.*预留 1/);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const entry=events.findLast(e=>e.type==='shelter-check');
    assert.equal(entry.data.population,13);assert.equal(entry.data.recovering,1);
    await pulse(1000);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'recovery reservation survives reload',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),0);
    await evaluate(`Object.assign(sm.view.state.residents.find(p=>p.id===14),{deadAt:null,hp:100});${check}`);
    await drive(`location.pathname==='/shelter'`,'recover resident');await drive(done,'recovery consumes its reservation',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),0);
    assert.match(await evaluate(`${panel}.getElementById('shelter-population-status').textContent`),/人口 14/);
    assert.doesNotMatch(await evaluate(`${panel}.getElementById('shelter-population-status').textContent`),/倒下居民预留/);
    await evaluate(`sm.view.state.residents=sm.view.state.residents.filter(p=>p.id!==14);${check}`);
    await drive(`location.pathname==='/shelter'`,'resident no longer in state');await drive(done,'vacant population slot may be used',200);
    assert.deepEqual(await evaluate(`${intoQuarters}.map(c=>c.residentId)`),[6,7]);
  });
  await t.test('人口恢复预留：原家庭两种模式均为倒下居民保留宿舍容量，记录移除后才返宿舍',async()=>{
    for(const mode of ['family','population']){
      await setupShelter(`${scene}${adequate}sm.confirmFamily=true;sm.view.state.rooms[4].level=1;
        localStorage.setItem('arkengine:auto-shelter:staff:v1','${mode}');
        for(let id=8;id<=11;id++)sm.view.state.residents.push({...structuredClone(adult),id,name:'孩子'+id,roomId:5,parents:[4,5],adultAt:clock+10800000});
        sm.view.state.residents.push({...structuredClone(adult),id:12,name:'等待救回',roomId:null,deadAt:clock-60000,hp:0});
        sm.view.state.residents.filter(p=>[6,7].includes(p.id)).forEach(p=>p.roomId=1);
        localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'原家庭等待',families:[{a:6,b:7,room:5}]}));`);
      await drive(done,'reserve quarters for original resident',200);assert.equal(await evaluate(`${intoQuarters}.length`),0);
      await evaluate(`sm.view.state.residents=sm.view.state.residents.filter(p=>p.id!==12);${check}`);
      await drive(`location.pathname==='/shelter'`,'quarters reservation released');await drive(done,'original family can return',200);
      assert.deepEqual(await evaluate(`${intoQuarters}.map(c=>c.residentId)`),[6,7]);
    }
  });
  await t.test('人口恢复预留：两种生育模式均先补恢复与新生儿口粮，不提前计算倒下人员产出',async()=>{
    for(const mode of ['family','population']){
      await setupShelter(`${scene}${onlyIdle}sm.confirmFamily=true;sm.view.state.residents[1].stats.agi=7;
        localStorage.setItem('arkengine:auto-shelter:staff:v1','${mode}');
        if('${mode}'==='family')localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'原家庭等待',families:[{a:6,b:7,room:5}]}));
        sm.view.state.residents.push({...structuredClone(adult),id:8,name:'等待救回',roomId:3,deadAt:clock-60000,hp:0});`);
      await drive(done,'prepare supply for recovery and a new child',200);
      const calls=await evaluate(`${moves}`),supply=calls.findIndex(c=>c.roomId===3),pair=calls.findIndex(c=>c.roomId===5);
      assert.ok(supply>=0&&pair>supply,JSON.stringify(calls));
      assert.deepEqual(calls.filter(c=>c.roomId===5).map(c=>c.residentId),[6,7]);
      assert.equal(calls.some(c=>c.residentId===8),false);
    }
  });
  await t.test('人口恢复预留：新配对进行中出现恢复名额时撤销剩余入住，不挤占原居民名额',async()=>{
    await setupShelter(`${scene}${onlyIdle}localStorage.setItem('arkengine:auto-shelter:population:v1','8');`);
    await drive(`${moves}.length===1&&${pending}===null`,'first partner arrived before recovery state');
    await evaluate(`sm.view.state.residents.push({...structuredClone(sm.view.state.residents[0]),id:8,name:'等待救回',roomId:null,deadAt:clock-60000,hp:0});`);
    await drive(done,'release unfinished pair to reserve recovery',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),1);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===6).roomId===5`),false);
    assert.equal(await evaluate(`${state}.pair`),null);
    assert.equal(await evaluate(`${moves}.some(c=>c.residentId===8)`),false);
  });

  await t.test('生育心情：新配对低于50先生产，恢复至50后可按原目标配对',async()=>{
    await setupShelter(`${scene}${onlyIdle}sm.confirmFamily=true;sm.view.state.residents[5].happiness=49;`);
    await drive(done,'low happiness leaves production available',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),0);
    assert.match(await evaluate(`${panel}.getElementById('shelter-population-status').textContent`),/心情/);
    await evaluate(`sm.view.state.residents[5].happiness=50;${check}`);
    await drive(`location.pathname==='/shelter'`,'happiness recovered');await drive(done,'new pair after recovery',200);
    assert.deepEqual(await evaluate(`${intoQuarters}.map(c=>c.residentId)`),[6,7]);
    assert.equal(await evaluate(`${state}.pair`),null);
  });
  await t.test('生育诊断：未配对原因写入检查日志，离页刷新后仍显示且目标变更后不沿用',async()=>{
    await setupShelter(`${scene}${onlyIdle}sm.confirmFamily=true;sm.view.state.residents[5].happiness=49;`);
    const fixtureSearch=await evaluate('location.search');
    await drive(done,'persist actual population blocking reason',200);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.match(events.filter(e=>e.type==='shelter-check').at(-1).data.populationNote,/心情/);
    const saved=await evaluate(`${state}.populationEvaluation`);assert.equal(saved.target,14);assert.match(saved.note,/心情/);
    await evaluate(`history.replaceState({},'','/activities/expedition'+${JSON.stringify(fixtureSearch)});`);await reloadShelter();
    assert.match(await evaluate(`${panel}.getElementById('shelter-population-status').textContent`),/上次检查.*心情/);
    await evaluate(`${target(30)}`);
    assert.doesNotMatch(await evaluate(`${panel}.getElementById('shelter-population-status').textContent`),/上次检查/);
  });
  await t.test('生育心情：新配对排队或第一人到宿舍后心情下降，撤销剩余安排且刷新不丢失',async()=>{
    for(const phase of ['queued','first','reload','late-reload']){
      await setupShelter(`${scene}${onlyIdle}`);
      if(phase==='queued')await drive(`!!document.querySelector('[data-staff-dialog]')`,'first family dialog queued');
      else await drive(`${moves}.length===1&&${pending}===null`,'first resident arrived');
      await evaluate('sm.view.state.residents[6].happiness=49;');
      if(phase==='late-reload')await evaluate('clock+=31*60000;');
      if(phase==='reload'||phase==='late-reload')await reloadShelter();
      await drive(done,'mood loss cancels incomplete pair',200);
      assert.equal(await evaluate(`${intoQuarters}.length`),phase==='queued'?0:1);
      assert.equal(await evaluate(`${state}.pair`),null);
      assert.equal(await evaluate(`${moves}.some(c=>c.residentId===7&&c.roomId===5)`),false);
      assert.deepEqual(await evaluate(`(${state}.pairBlocks||[])`),[]);
      if(phase!=='queued')assert.equal(await evaluate('sm.view.state.residents[5].roomId'),null);
    }
  });
  await t.test('生育心情：已确认感情的两人心情下降时保留关系与岗位，并显示暂停原因',async()=>{
    await setupShelter(`${scene}sm.confirmFamily=true;`);await drive(done,'relationship established',200);
    await evaluate(`sm.view.state.residents[5].happiness=49;${check}`);
    await drive(`location.pathname==='/shelter'`,'check paused romance');await drive(done,'preserve existing relationship',200);
    assert.deepEqual(await evaluate('sm.view.state.residents.slice(5,7).map(p=>p.roomId)'),[5,5]);
    assert.equal(await evaluate(`${moves}.length`),2);
    assert.match(await evaluate(`${state}.operations`),/居民6.*居民7.*感情暂停.*心情/);
    assert.ok(await evaluate(`${state}.nextAt-clock<=300000`));
  });
  await t.test('生育恢复：只安排一人后长时间挂起，恢复时接续第二步，不误算为感情等待超时',async()=>{
    await setupShelter(`${scene}sm.confirmFamily=true;`);
    await drive(`${moves}.length===1&&${pending}===null`,'first resident before long suspension');
    await evaluate('clock+=3600000;');await reloadShelter();await drive(done,'finish original pair after long suspension',200);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[7,5]]);
    assert.equal(await evaluate(`${state}.pair`),null);assert.deepEqual(await evaluate(`${state}.pairBlocks||[]`),[]);
  });
  await t.test('生育恢复：第一人入住后宿舍停电、事件或升级，跨刷新保留计划并接续第二人',async()=>{
    for(const blocked of ['unpowered=true','incident={type:"fire"}','upgradeAt=clock+3600000']){
      await setupShelter(`${scene}sm.confirmFamily=true;`);
      const fixtureSearch=await evaluate('location.search');
      await drive(`${moves}.length===1&&${pending}===null`,'first resident before room interruption');
      await evaluate(`sm.view.state.rooms.find(r=>r.id===5).${blocked};`);
      await drive(done,'wait for original quarters',200);
      assert.equal(await evaluate(`${state}.pair?.step`),1);assert.equal(await evaluate(`${moves}.length`),1);
      assert.match(await evaluate(`${panel}.getElementById('shelter-population-status').textContent`),/宿舍.*保留原计划/);
      await pulse(1000);
      await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
      await reloadShelter();await drive(done,'room interruption survives reload',200);
      assert.equal(await evaluate(`${state}.pair?.step`),1);assert.equal(await evaluate(`${moves}.length`),1);
      await evaluate(`Object.assign(sm.view.state.rooms.find(r=>r.id===5),{unpowered:false,incident:null,upgradeAt:null});${check}`);
      await drive(`${state}.pair===null&&${state}.families?.some(f=>f.a===6&&f.b===7)&&${done}`,'resume original pair',200);
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[7,5]]);
      assert.deepEqual(await evaluate(`${state}.pairBlocks||[]`),[]);
      const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
      assert.equal(events.filter(e=>e.type==='shelter-population'&&e.data.phase==='room-wait').length,1);
      assert.equal(events.filter(e=>e.type==='shelter-population'&&e.data.phase==='room-resumed').length,1);
    }
  });
  await t.test('生育恢复：两人入住后宿舍长时间停电，恢复后重新等待感情，正常超时保护仍生效',async()=>{
    await setupShelter(scene);const fixtureSearch=await evaluate('location.search');
    await drive(done,'both residents awaiting relationship',200);
    assert.equal(await evaluate(`${state}.pair.step`),2);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===5).unpowered=true;${check}`);
    await drive(`location.pathname==='/shelter'`,'observe outage');await drive(done,'pause relationship wait',200);
    assert.equal(await evaluate(`${state}.pair?.step`),2);
    await pulse(1000);
    await evaluate(`clock+=3600000;document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'outage waiting after long reload',200);
    assert.equal(await evaluate(`${moves}.length`),2);assert.equal(await evaluate(`${state}.pair?.release`),false);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===5).unpowered=false;${check}`);
    await drive(`location.pathname==='/shelter'`,'power restored');await drive(done,'new relationship wait after outage',200);
    assert.equal(await evaluate(`${state}.pair?.release`),false);assert.equal(await evaluate(`${moves}.length`),2);
    assert.deepEqual(await evaluate(`${state}.pairBlocks||[]`),[]);
    await evaluate(`clock+=31*60000;${check}`);
    await drive(`${state}.pair===null&&${done}`,'valid waiting eventually times out',200);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[7,5],[6,null],[7,null]]);
    assert.ok(await evaluate(`${state}.pairBlocks.some(b=>b.a===6&&b.b===7&&b.until>clock)`));
  });
  await t.test('生育恢复：宿舍等待期间被手动换人或拆除，仍取消原计划且不移动其他居民',async()=>{
    for(const mutation of ['sm.view.state.residents[3].roomId=5;',
      'sm.view.state.rooms=sm.view.state.rooms.filter(r=>r.id!==5);']){
      await setupShelter(`${scene}sm.confirmFamily=true;`);
      await drive(`${moves}.length===1&&${pending}===null`,'first resident before outage and manual change');
      await evaluate('sm.view.state.rooms.find(r=>r.id===5).unpowered=true;');await drive(done,'retain interrupted pair',200);
      assert.equal(await evaluate(`${state}.pair?.step`),1);
      await evaluate(`${mutation}${check}`);await drive(`location.pathname==='/shelter'`,'manual change during outage');
      await drive(done,'honor manual room change',200);
      assert.equal(await evaluate(`${state}.pair`),null);
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5]]);
      assert.deepEqual(await evaluate(`${state}.pairBlocks||[]`),[]);
    }
  });

  await t.test('人口发展：默认目标14且旧生产模式不会安排新配对',async()=>{
    await setupShelter(`${scene}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');`);await drive(done,'old mode preserved');
    assert.equal(await evaluate(`${panel}.getElementById('shelter-population').value`),'14');
    assert.equal(await evaluate(`${intoQuarters}.length`),0);
  });
  await t.test('人口配对产量：优先不影响实际生产的驻留者，不按个人属性误调走低产但在岗的回收员',async()=>{
    await setupShelter(`${scene}sm.confirmFamily=true;
      sm.view.state.rooms[0].width=1;
      sm.view.state.rooms.push({...original,id:6,type:'scrap',width:1,stored:0});
      for(const p of sm.view.state.residents.slice(0,3))p.familyCooldownUntil=clock+86400000;
      for(const p of sm.view.state.residents.slice(3,7)){p.roomId=1;p.stats.end=p.id<=5?17:10;}
      for(let id=8;id<=9;id++)sm.view.state.residents.push({...structuredClone(adult),id,name:'回收员'+id,roomId:6,
        stats:{str:0,per:0,end:0,cha:0,int:0,agi:0,lck:0}});`);
    await drive(`${moves}.length===1 && ${pending}===null`,'first resident selected without production loss');
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5]]);
    await reloadShelter();await drive(done,'production-preserving pair resumes after refresh',200);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[7,5]]);
    assert.ok(await evaluate(`(${state}.families||[]).some(f=>f.a===6&&f.b===7)`));
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[4,5,8,9].includes(p.id)).map(p=>[p.id,p.roomId])'),[[4,1],[5,1],[8,6],[9,6]]);
  });
  await t.test('人口发展：优先闲置成人，网站确认感情后接入已有家庭轮换',async()=>{
    await setupShelter(`${scene}sm.confirmFamily=true;`);await drive(done,'new family confirmed',200);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[7,5]]);
    assert.equal(await evaluate(`${state}.pair`),null);assert.deepEqual(await evaluate(`${state}.families`),[{a:6,b:7,room:5}]);
    assert.deepEqual(await evaluate('sm.view.state.residents.slice(0,5).map(p=>p.roomId)'),[2,3,4,1,1]);
  });
  await t.test('人口发展：同父母、共同祖先、缺失祖先和异常亲缘资料均不自动配对',async()=>{
    const variants = [
      `sm.view.state.residents[5].parents=[1,2];sm.view.state.residents[6].parents=[1,2];`,
      `sm.view.state.residents[5].parents=[20,21];sm.view.state.residents[6].parents=[22,23];
       for(let id=20;id<=25;id++)sm.view.state.residents.push({...structuredClone(adult),id,name:'祖辈'+id,roomId:null,deadAt:clock,parents:[20,22].includes(id)?[24,25]:[]});`,
      `sm.view.state.residents[5].parents=[90,91];`,
      `sm.view.state.residents[5].parents=[-1,2];`,
      `sm.view.state.residents[5].parents=[1];`,
      `sm.view.state.residents[5].name='居民7';`
    ];
    for(const patch of variants){
      await setupShelter(`${scene}${onlyIdle}${patch}`);await drive(done,'kinship excluded',180);
      assert.equal(await evaluate(`${intoQuarters}.length`),0);
    }
  });
  await t.test('人口发展：儿童未来消耗和两小时库存不足时先保生产',async()=>{
    // 两个基础房间都满员，12.8/小时够当前10人口当量，仍不足未来14人的16.8目标。
    const noSpareSupply = `${children}sm.view.state.residents[1].stats.agi=3;sm.view.state.residents[2].stats.per=3;
      sm.view.state.residents[5].roomId=3;sm.view.state.residents[6].roomId=4;`;
    for(const patch of [noSpareSupply,`sm.view.state.resources.food=15;`]){
      await setupShelter(`${scene}${patch}`);await drive(done,'future supply protected',180);
      assert.equal(await evaluate(`${intoQuarters}.length`),0);
    }
    await setupShelter(`${scene}sm.view.state.resources.food=16;sm.confirmFamily=true;`);await drive(done,'exact inventory boundary',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),2);
  });
  await t.test('人口发展：待产、培养感情和原家庭半途回宿舍都预留人口名额',async()=>{
    const room = `sm.view.state.rooms.push({...original,id:6,type:'quarters',width:1,stored:0});`;
    for(const patch of [
      `${room}sm.view.state.births=[{id:1,roomId:6,dueAt:clock+3600000}];`,
      `${room}for(const id of [4,5]){const p=sm.view.state.residents[id-1];p.roomId=6;p.romance={partnerId:id===4?5:4,progress:.2};}`,
      `${room}sm.view.state.residents[3].roomId=6;localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'原家庭返回',vaultNo:77,families:[{a:4,b:5,room:6}]}));`
    ]){
      await setupShelter(`${scene}${children}${adequate}${patch}`);await drive(done,'birth slot reserved',200);
      assert.equal(await evaluate(`${intoQuarters}.length`),0);
    }
  });
  await t.test('人口发展：目标和宿舍容量取较小值，不接管原家庭宿舍或特殊岗位',async()=>{
    for(const patch of [
      `sm.view.state.rooms[4].width=1;sm.view.state.rooms[4].level=1;`,
      `sm.view.state.residents[5].roomId=5;`,
      `${onlyIdle}sm.view.state.rooms.push({...original,id:6,type:'training',stored:0});sm.view.state.residents[5].roomId=6;`
    ]){
      await setupShelter(`${scene}${patch}`);await drive(done,'room and role protection',180);assert.equal(await evaluate(`${intoQuarters}.length`),0);
    }
  });
  await t.test('人口发展：一次只安排一对，等待期间不会把他们重新派回生产',async()=>{
    await setupShelter(scene);await drive(done,'await native relationship',200);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[7,5]]);
    assert.equal(await evaluate(`${state}.pair.step`),2);
    await evaluate(check);await drive(`location.pathname==='/shelter'`,'recheck waiting family');await drive(done,'waiting remains');
    assert.equal(await evaluate(`${moves}.length`),2);
  });
  await t.test('人口发展：单方明确指向对方的感情回执可确认，关系冲突则停止原计划',async()=>{
    for(const partner of [7,4]){
      await setupShelter(scene);await drive(done,'waiting pair for relationship',200);
      await evaluate(`sm.view.state.residents[5].romance={partnerId:${partner},progress:.1};${check};`);
      await drive(`location.pathname==='/shelter'`,'relationship evidence');await drive(done,'relationship checked',200);
      assert.equal(await evaluate(`${state}.pair`),null);assert.equal(await evaluate(`${moves}.length`),2);
      assert.equal(await evaluate(`(${state}.families||[]).some(f=>f.a===6&&f.b===7)`),partner===7);
    }
  });
  await t.test('人口发展：安排任一步后刷新只接续剩余步骤',async()=>{
    for(const completed of [1,2]){
      await setupShelter(`${scene}sm.confirmFamily=true;`);await drive(`${moves}.length===${completed}`,'placement before reload');await reloadShelter();
      await drive(done,'resume new family',200);assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[7,5]]);
      assert.equal(await evaluate(`${state}.pair`),null);
    }
  });
  await t.test('人口发展：调岗结果未知时保留计划与原记录，不跨刷新重复安排',async()=>{
    await setupShelter(`${scene}sm.assignUnknown=true;`);await drive(`${moves}.length===1`,'unknown family move');await reloadShelter();
    await drive(`${done}&&localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='true'&&${pending}!==null&&${state}.pendingReadOnly===${pending}.id`,'unknown placement isolated');
    assert.equal(await evaluate(`${moves}.length`),1);assert.deepEqual(await evaluate(`${pending}.targets`),[6,5]);assert.ok(await evaluate(`${state}.pair`));
  });
  await t.test('人口发展：第一人到宿舍后降低目标或供应下降，会退出未完成配对',async()=>{
    for(const mutation of [target(7),`sm.view.state.resources.food=0;`,
      `localStorage.setItem('arkengine:auto-shelter:population:v1','7');window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-shelter:population:v1',newValue:'7'}));`]){
      await setupShelter(scene);await drive(`${moves}.length===1 && ${pending}===null`,'first placement confirmed');await evaluate(mutation);
      await drive(done,'cancel incomplete placement',200);
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[6,null]]);assert.equal(await evaluate(`${state}.pair`),null);
    }
  });
  await t.test('人口发展：提交前降低目标会撤销，切回手动后可核对原计划再恢复',async()=>{
    await setupShelter(scene);await drive(`!!document.querySelector('[data-staff-dialog]')`,'new pair dialog before submission');
    await evaluate(target(7));await drive(done,'target changed before submission');
    assert.equal(await evaluate(`${moves}.length`),0);assert.equal(await evaluate(`${state}.pair`),null);
    await setupShelter(`${scene}sm.confirmFamily=true;`);await drive(`${moves}.length===1 && ${pending}===null`,'first placement before manual mode');
    await evaluate(`${panel}.getElementById('shelter-staff').value='off';${panel}.getElementById('shelter-staff').dispatchEvent(new Event('change'));`);
    await drive(done,'manual mode holds plan');assert.equal(await evaluate(`${moves}.length`),1);assert.ok(await evaluate(`${state}.pair`));
    await evaluate(`${panel}.getElementById('shelter-staff').value='population';${panel}.getElementById('shelter-staff').dispatchEvent(new Event('change'));`);
    await drive(`location.pathname==='/shelter'`,'population mode resumed');await drive(done,'resume original pair',200);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[7,5]]);assert.equal(await evaluate(`${state}.pair`),null);
  });
  await t.test('人口发展：30分钟仍无关系回执时退回生产，同组合24小时内不再安排',async()=>{
    await setupShelter(`${scene}${onlyIdle}`);await drive(done,'initial waiting pair',200);
    await pulse(31*60000);await drive(`location.pathname==='/shelter'`,'relationship deadline');await drive(done,'release unconfirmed pair',200);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[6,5],[7,5],[6,null],[7,null]]);
    assert.equal(await evaluate(`${state}.pair`),null);assert.deepEqual(await evaluate(`${state}.pairBlocks.map(b=>[b.a,b.b])`),[[6,7]]);
    await evaluate(check);await drive(`location.pathname==='/shelter'`,'blocked combination visit');await drive(done,'combination not repeated',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),2);
  });
  await t.test('人口发展：出生达到目标后，即使生产房间满员也让冷却父母离开宿舍',async()=>{
    await setupShelter(`${scene}localStorage.setItem('arkengine:auto-shelter:population:v1','8');sm.confirmFamily=true;sm.view.state.rooms[0].width=1;`);
    await drive(done,'original family',200);
    await evaluate(`sm.confirmFamily=false;for(const p of sm.view.state.residents.filter(p=>[6,7].includes(p.id))){p.romance=null;p.familyCooldownUntil=clock+3600000;}
      sm.view.state.residents.push({...structuredClone(sm.view.state.residents[0]),id:8,name:'新生儿',parents:[6,7],roomId:5,romance:null,adultAt:clock+10800000});${check}`);
    await drive(`location.pathname==='/shelter'`,'target reached visit');await drive(done,'parents stop next birth',200);
    assert.deepEqual(await evaluate('sm.view.state.residents.slice(5,7).map(p=>p.roomId)'),[null,null]);
    await pulse(3600000);await drive(`location.pathname==='/shelter'`,'cooldown completed');await drive(done,'target still enforced',200);
    assert.equal(await evaluate(`${intoQuarters}.length`),2);
  });
  await t.test('人口发展：达到目标也不拆散正在培养感情或待产的家庭',async()=>{
    for(const phase of ['both','single','birth']){
      await setupShelter(`${scene}localStorage.setItem('arkengine:auto-shelter:population:v1','7');
        sm.view.state.residents[5].roomId=5;sm.view.state.residents[6].roomId=5;
        ${phase === 'birth' ? `sm.view.state.births=[{id:1,roomId:5,dueAt:clock+3600000}];` : `sm.view.state.residents[5].romance={partnerId:7,progress:.1};${phase === 'both' ? `sm.view.state.residents[6].romance={partnerId:6,progress:.1};` : ''}`}`);
      await drive(done,'active family protected');assert.ok(await evaluate(`${moves}.every(c=>![6,7].includes(c.residentId))`));
    }
  });
  await t.test('人口发展：当前产量刚够用时提前补足下一人口的岗位，再让原家庭返回',async()=>{
    await setupShelter(`${scene}sm.confirmFamily=true;sm.view.state.residents[5].roomId=1;sm.view.state.residents[6].roomId=1;
      for(let id=8;id<=10;id++)sm.view.state.residents.push({...structuredClone(adult),id,name:'成年子女'+id,roomId:5,parents:[6,7]});
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'待返回原家庭',vaultNo:77,families:[{a:6,b:7,room:5}]}));`);
    for(let visit=0;visit<4;visit++){
      await drive(done,'future supply visit',240);
      if(await evaluate('sm.view.state.residents[5].romance?.partnerId===7'))break;
      await pulse(65000);await drive(`location.pathname==='/shelter'`,'continue future supply arrangement');
    }
    assert.equal(await evaluate('sm.view.state.residents[5].romance?.partnerId'),7);
    const calls=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
    assert.ok(calls.some(([id,room])=>id===4&&room===3));assert.ok(calls.some(([id,room])=>id===5&&room===4));
    assert.ok(calls.some(([id,room])=>id===6&&room===5));assert.ok(calls.some(([id,room])=>id===7&&room===5));
  });
  await t.test('人口发展：满员基础岗位可先补未来供应缺口，再安排新家庭，关闭优化时保持原岗位',async()=>{
    await setupShelter(fullSupply);await drive(done,'full rooms optimization disabled');
    assert.equal(await evaluate(`${moves}.length`),0);
    await setupShelter(`${fullSupply}sm.confirmFamily=true;localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');`);
    for(let visit=0;visit<4;visit++){
      await drive(done,'full future supply visit',240);
      if(await evaluate(`(${state}.families||[]).length===1`))break;
      await evaluate(check);await drive(`location.pathname==='/shelter'`,'continue full future supply');
    }
    const families=await evaluate(`${state}.families||[]`);
    assert.equal(families.length,1,JSON.stringify(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`)));
    const [family]=families;
    assert.ok([family.a,family.b].every(id=>[2,3,6,7].includes(id)));
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${family.a}).romance?.partnerId`),family.b);
    const calls=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
    assert.ok(calls.some(([,room])=>room===3));assert.ok(calls.some(([,room])=>room===4));
    const residents=await evaluate('sm.view.state.residents');
    for(const positions of await evaluate('sm.snapshots'))for(const [room,stat,base,min] of [[2,'str',12,9.6],[3,'agi',8,12],[4,'per',8,12]]){
      const workers=positions.filter(p=>p.room===room&&p.id<=7);assert.ok(workers.length<=2);
      const output=workers.reduce((n,p)=>n+base*(.5+residents.find(r=>r.id===p.id).stats[stat]/10),0);
      assert.ok(output>=min-1e-9,`${stat} current supply: ${output}`);
    }
    for(const [room,stat] of [[3,'agi'],[4,'per']]){
      const output=residents.filter(p=>p.roomId===room&&p.id<=7).reduce((n,p)=>n+8*(.5+p.stats[stat]/10),0);
      assert.ok(output>=14*1.2-1e-9,`${stat} future supply: ${output}`);
    }
  });
  await t.test('人口发展：满员补供应在腾位后刷新，接续原步骤且不重放',async()=>{
    await setupShelter(`${fullSupply}sm.confirmFamily=true;localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');`);
    await drive(`${moves}.length===1`,'future supply first move');
    const planned=await evaluate(`${state}.swap.moves.map(move=>[move.id,move.room])`);
    assert.equal(await evaluate(`${state}.swap.futureSupply`),true);await reloadShelter();
    await drive(done,'resume future supply swap',240);
    const calls=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
    assert.deepEqual(calls.slice(0,planned.length),planned);
    assert.equal(calls.filter(([id,room])=>id===planned[0][0]&&room===planned[0][1]).length,1);
    assert.equal(await evaluate(`${state}.swap`),null);assert.equal(await evaluate(pending),null);
  });
  await t.test('人口发展：未来缺口允许逐步改善，但不为未来生育损失当前供应余量',async()=>{
    await setupShelter(`${fullSupply}localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      sm.view.state.residents[1].stats.agi=3;sm.view.state.residents[5].stats.agi=3;
      sm.view.state.residents[2].stats.per=3;sm.view.state.residents[6].stats.per=3;`);
    await drive(done,'no safe vacancy for future supply',200);
    assert.equal(await evaluate(`${moves}.length`),0);
    await setupShelter(`${fullSupply}localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:population:v1','15');
      sm.view.state.residents.push({...structuredClone(adult),id:14,name:'孩子14',roomId:5,parents:[4,5],adultAt:clock+10800000});
      for(const p of sm.view.state.residents)if(![2,4].includes(p.id))p.stats.agi=0;
      sm.view.state.residents[1].stats.agi=11;sm.view.state.residents[3].stats.agi=1;
      sm.view.state.rooms[0].width=1;sm.view.state.rooms[3].level=2;`);
    await drive(done,'partial future supply improvement',200);
    const calls=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
    assert.deepEqual(calls,[[4,null],[6,1],[4,3]]);
    assert.match(await evaluate(`${panel}.getElementById('shelter-staff-status').textContent`),/食物时产 17\.6\/目标 18\.0/);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.ok(events.some(e=>e.type==='shelter-check'&&e.data.staffNote?.includes('食物时产 17.6/目标 18.0')));
    assert.ok(events.some(e=>e.type==='shelter-optimization'&&e.data.futureSupply===true&&e.data.supplyGain>0));
    await evaluate(check);await drive(`location.pathname==='/shelter'`,'partial future supply revisit');
    await drive(done,'no repeated partial swap',200);assert.equal(await evaluate(`${moves}.length`),3);
  });
  await t.test('人口发展：补未来供应换位中出现当前缺口或手动关闭优化，不继续原计划',async()=>{
    for(const mutation of [
      'sm.view.state.residents[0].stats.str=0;',
      `${panel}.getElementById('shelter-optimize').checked=false;${panel}.getElementById('shelter-optimize').dispatchEvent(new Event('change'));`
    ]){
      await setupShelter(`${fullSupply}localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');`);
      await drive(`${moves}.length===1 && ${pending}===null`,'confirmed first future supply move');
      await evaluate(mutation);await drive(done,'future supply plan interrupted',200);
      assert.equal(await evaluate(`${moves}.length`),1);assert.equal(await evaluate(`${state}.swap`),null);
    }
  });
  await t.test('人口发展：原家庭占据基础岗位时先安排接替，再返回宿舍',async()=>{
    await setupShelter(workingFamily);
    for(let visit=0;visit<4;visit++){
      await drive(done,'family replacement visit',240);
      if(await evaluate('sm.view.state.residents[1].romance?.partnerId===3'))break;
      await evaluate(check);await drive(`location.pathname==='/shelter'`,'continue family replacement');
    }
    assert.equal(await evaluate('sm.view.state.residents[1].romance?.partnerId'),3);
    const calls=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
    const intoHome=calls.findIndex(([,room])=>room===5);
    assert.ok(calls.slice(0,intoHome).some(([id,room])=>id===4&&room===3));
    assert.ok(calls.slice(0,intoHome).some(([id,room])=>id===5&&room===4));
    const residents=await evaluate('sm.view.state.residents');
    for(const positions of await evaluate('sm.snapshots'))for(const [room,stat,base,min] of [[2,'str',12,9.6],[3,'agi',8,8.4],[4,'per',8,8.4]]){
      const output=positions.filter(p=>p.room===room).reduce((n,p)=>n+base*(.5+residents.find(r=>r.id===p.id).stats[stat]/10),0);
      assert.ok(output>=min-1e-9,`${stat} family replacement supply: ${output}`);
    }
  });
  await t.test('人口发展额外驻留：为父母离岗准备替补时，每一步也保住父母尚未离岗时的实际供应',async()=>{
    await setupShelter(`${workingFamily}sm.view.state.rooms.find(r=>r.id===4).width=2;
      sm.view.state.residents[1].stats.agi=0;
      Object.assign(sm.view.state.residents[3],{roomId:3,stats:{str:3,per:10,end:10,cha:3,int:3,agi:10,lck:3}});
      sm.view.state.residents[4].stats.per=0;
      Object.assign(sm.view.state.residents[5],{roomId:3,stats:{str:3,per:0,end:3,cha:3,int:3,agi:0,lck:3}});
      Object.assign(sm.view.state.residents[6],{roomId:3,stats:{str:3,per:0,end:3,cha:3,int:3,agi:10,lck:3}});
      sm.view.state.residents.push({...structuredClone(adult),id:8,name:'净水值班',roomId:4,
        stats:{str:3,per:0,end:3,cha:3,int:3,agi:0,lck:3}});
      sm.view.state.residents.sort((a,b)=>[1,4,2,3,5,6,7,8].indexOf(a.id)-[1,4,2,3,5,6,7,8].indexOf(b.id));`);
    await drive(`${moves}.length>0`,'prepare family production replacements');
    await drive(done,'family replacement checks all intermediate supplies',260);
    const residents=await evaluate('sm.view.state.residents');
    for(const positions of await evaluate('sm.snapshots'))for(const [room,stat,base,capacity,min] of [[2,'str',12,2,10.8],[3,'agi',8,2,9.6],[4,'per',8,4,9.6]]){
      const output=positions.filter(p=>p.room===room).slice(0,capacity).reduce((n,p)=>n+base*(.5+residents.find(r=>r.id===p.id).stats[stat]/10),0);
      assert.ok(output>=min-1e-9,`${stat} current supply ${output}, positions ${JSON.stringify(positions)}`);
    }
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===2).romance?.partnerId'),3);
  });
  await t.test('人口发展额外驻留：新配对按安全顺序入住，第一人完成后刷新仍接续另一人',async()=>{
    for(const legacy of [false,true]){
      await setupShelter(`${scene}sm.confirmFamily=true;
        sm.view.state.residents[4].roomId=3;sm.view.state.residents[4].stats.agi=0;
        sm.view.state.residents[5].roomId=3;sm.view.state.residents[5].stats.agi=0;sm.view.state.residents[5].hp=50;
        sm.view.state.residents[6].roomId=3;sm.view.state.residents[6].stats.agi=10;
        sm.view.state.residents.filter(p=>![2,5].includes(p.id)).forEach(p=>p.familyCooldownUntil=clock+86400000);
        ${legacy?`localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'旧版未入住计划',vaultNo:77,
          pair:{a:2,b:5,room:5,fromA:3,fromB:3,step:0,at:clock,waitAt:null,release:false,failed:false}}));`:''}`);
      await drive(`${moves}.length===1&&${pending}===null`,'first safe resident enters quarters');
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[5,5]]);
      await drive(`${state}.pair?.step===1`,'safe order persisted after first resident');
      assert.equal(await evaluate(`${state}.pair.first`),5);
      await reloadShelter();await drive(done,'remaining resident follows persisted safe order',220);
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[5,5],[2,5]]);
      assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===2).romance?.partnerId'),5);
      assert.equal(await evaluate(`${state}.pair`),null);
    }
  });
  await t.test('人口发展：原家庭满员接替跨刷新接续，完成后两人可返宿舍',async()=>{
    await setupShelter(`${workingFamily}localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      sm.view.state.residents[5].roomId=3;sm.view.state.residents[6].roomId=4;sm.view.state.rooms[0].width=1;`);
    await drive(`${moves}.length===1`,'family full room replacement');
    const plan=await evaluate(`${state}.swap`);assert.deepEqual(plan.prepareFamily,[2,3,5]);
    await reloadShelter();
    for(let visit=0;visit<4;visit++){
      await drive(done,'family full room resume',240);
      if(await evaluate('sm.view.state.residents[1].romance?.partnerId===3'))break;
      await evaluate(check);await drive(`location.pathname==='/shelter'`,'continue full family replacement');
    }
    assert.equal(await evaluate('sm.view.state.residents[1].romance?.partnerId'),3);
    const calls=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
    assert.deepEqual(calls.slice(0,plan.moves.length),plan.moves.map(move=>[move.id,move.room]));
    assert.equal(calls.filter(([id,room])=>id===plan.moves[0].id&&room===plan.moves[0].room).length,1);
    assert.equal(await evaluate(`${state}.swap`),null);assert.equal(await evaluate(pending),null);
  });
  await t.test('人口发展：原家庭接替只在容量、库存、冷却与宿舍条件允许时准备',async()=>{
    for(const mutation of [
      `localStorage.setItem('arkengine:auto-shelter:population:v1','7');`,
      'sm.view.state.resources.food=15;',
      'sm.view.state.residents[1].familyCooldownUntil=clock+3600000;',
      'sm.view.state.residents[5].roomId=5;',
      `localStorage.setItem('arkengine:auto-shelter:staff:v1','family');`
    ]){
      await setupShelter(`${workingFamily}${mutation}`);await drive(done,'family replacement conditions',200);
      assert.equal(await evaluate(`${moves}.filter(c=>[3,4,5].includes(c.roomId)).length`),0);
    }
  });
  await t.test('人口发展：原家庭满员接替中目标、宿舍或心情条件改变，取消剩余换位',async()=>{
    for(const mutation of [target(7),'sm.view.state.residents[0].roomId=5;','sm.view.state.residents[1].happiness=49;']){
      await setupShelter(`${workingFamily}localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
        sm.view.state.residents[5].roomId=3;sm.view.state.residents[6].roomId=4;sm.view.state.rooms[0].width=1;`);
      await drive(`${moves}.length===1 && ${pending}===null`,'confirmed family replacement step');
      await evaluate(mutation);await drive(done,'cancel changed family replacement',200);
      assert.equal(await evaluate(`${moves}.length`),1);assert.equal(await evaluate(`${state}.swap`),null);
    }
  });
  await t.test('人口发展：第一对原家庭无法接替时，继续准备其他可接替的家庭',async()=>{
    await setupShelter(`${workingFamily}
      sm.view.state.rooms.push({...original,id:6,type:'quarters',width:1,stored:0},{...original,id:7,type:'water',width:1,stored:0});
      sm.view.state.residents[2].stats.per=3;sm.view.state.residents[4].roomId=4;
      sm.view.state.residents[5].roomId=3;sm.view.state.residents[5].stats.agi=0;sm.view.state.residents[6].stats.per=10;
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'两对等待接替',vaultNo:77,
        families:[{a:2,b:3,room:5},{a:4,b:5,room:6}]}));`);
    for(let visit=0;visit<4;visit++){
      await drive(done,'other family replacement',240);
      if(await evaluate('sm.view.state.residents[3].romance?.partnerId===5'))break;
      await evaluate(check);await drive(`location.pathname==='/shelter'`,'continue other family replacement');
    }
    assert.equal(await evaluate('sm.view.state.residents[3].romance?.partnerId'),5);
    const calls=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
    assert.ok(calls.some(([id,room])=>id===7&&room===7));
    assert.equal(calls.filter(([id,room])=>[2,3].includes(id)&&room===5).length,0);
  });
  await t.test('人口发展：父母离岗后由额外驻留者补上生产位置，按实际剩余产量判断',async()=>{
    for(const extra of [false,true]){
      await setupShelter(`${workingFamily}${children}
        sm.view.state.residents[3].roomId=3;sm.view.state.residents[4].roomId=4;
        ${extra ? `sm.view.state.residents[5].roomId=3;sm.view.state.residents[5].stats.agi=10;
          sm.view.state.residents[6].roomId=4;sm.view.state.residents[6].stats.per=10;` : ''}`);
      await drive(done,'remaining workers after parents leave',240);
      assert.equal(await evaluate('sm.view.state.residents[1].romance?.partnerId===3'),extra);
      const calls=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
      if(extra)assert.deepEqual(calls,[[2,5],[3,5]]);
      else assert.equal(calls.filter(([,room])=>room===5).length,0);
    }
  });
  await t.test('人口发展：退出未确认配对时遇到手动占用或宿舍移除，取消计划而不持续等待',async()=>{
    for(const mutation of ['sm.view.state.residents[3].roomId=5;',
      `sm.view.state.rooms=sm.view.state.rooms.filter(r=>r.id!==5);`]){
      await setupShelter(scene);await drive(done,'unconfirmed pair before release',200);
      const calls=await evaluate(`${moves}.length`);
      await evaluate(`const saved=${state};saved.pair.release=true;
        localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(saved));${mutation}
        window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-shelter:schedule:v1',newValue:JSON.stringify(saved)}));${check}`);
      await drive(`location.pathname==='/shelter'`,'release conditions changed');
      await drive(done,'release respects manual change',200);
      assert.equal(await evaluate(`${state}.pair`),null);assert.equal(await evaluate(`${moves}.length`),calls);
    }
  });
  await t.test('人口发展：宿舍被手动占用或窗口被接管时取消剩余新配对',async()=>{
    await setupShelter(scene);await drive(`${moves}.length===1 && ${pending}===null`,'first resident confirmed');
    await evaluate('sm.view.state.residents[3].roomId=5;');await drive(done,'manual room change');assert.equal(await evaluate(`${moves}.length`),1);
    assert.equal(await evaluate(`${state}.pair`),null);
    await setupShelter(scene);await drive(`!!document.querySelector('[data-staff-dialog]') && ${panel}.getElementById('status').textContent.includes('随机等待')`,'own family dialog');
    await evaluate(`document.querySelector('[data-staff-dialog] select').focus()`);await trustedStaffKey();await pulse();
    assert.equal(await evaluate(`${moves}.length`),0);assert.equal(await evaluate(`${state}.pair`),null);
    assert.ok(await evaluate(`!!document.querySelector('[data-staff-dialog]')`));await evaluate('closeResident()');await drive(done,'manual control respected');
  });
  await t.test('人口发展：无法保存计划、损坏计划或无效目标时只收奖励',async()=>{
    for(const patch of [
      `const save=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='arkengine:auto-shelter:schedule:v1'&&JSON.parse(value).pair)throw new Error('fixture full');return save.call(this,key,value);};`,
      `localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'旧计划',pair:{a:6,b:6}}));`,
      `localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'入住顺序损坏',
        pair:{a:6,b:7,first:99,room:5,fromA:null,fromB:null,step:0,at:clock,waitAt:null,release:false,failed:false}}));`,
      `localStorage.setItem('arkengine:auto-shelter:population:v1','invalid');`
    ]){
      await setupShelter(`${scene}sm.achievementIncomplete=false;${patch}`);await drive(done,'population failure isolated');
      assert.equal(await evaluate(`${moves}.length`),0);assert.ok(await evaluate(`sm.calls.some(c=>c.type==='claim_achievement')`));
    }
  });
}
