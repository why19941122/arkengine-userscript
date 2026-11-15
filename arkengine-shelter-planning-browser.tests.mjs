import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';
import {levelPlanningView} from './arkengine-shelter-level-planning.fixture.mjs';
import {idleTrainingScene} from './arkengine-shelter-idle-training.fixture.mjs';
import {readyCampaignConstructionScene} from './arkengine-shelter-growth-investment.fixture.mjs';

export async function shelterPlanningBrowserTests({t,setupShelter,reloadShelter,evaluate,pulse,drive,until,trustedStaffKey}){
  const state="JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))";
  const pending="JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))";
  const continuousScene=(extra='')=>{
    const f=readyCampaignConstructionScene(),s=f.view.state;
    Object.assign(f.campaign,{training:false,medical:true,explore:true});
    s.depth=13;s.resources.stimpak=10;f.view.drops.minMinutes=120;
    Object.assign(s.residents.find(p=>p.id===5),{roomId:90,training:0});s.residents.find(p=>p.id===5).stats.end=2;
    s.residents.find(p=>p.id===6).hp=30;
    for(const id of [7,8])s.residents.push({...structuredClone(s.residents[0]),id,name:'外出候选'+id,roomId:id===7?4:2});
    for(const p of s.residents)p.familyCooldownUntil=f.view.serverTime+86400000;
    f.state.campaign.roles=[{id:5,room:90,role:'training',purpose:'production',stat:'end',base:1,
      at:f.view.serverTime-3600000,until:f.view.serverTime+600000,windowEnd:f.view.serverTime+168*3600000,destination:4}];
    return `sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      sm.quickAssign=false;sm.executionPlanCostMs=1800;sm.slowDeparture=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','8');
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({combatGear:false,tier:0,hours:6,sodaEfficiency:true,
        stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6,...${JSON.stringify(f.campaign)}}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(f.state)},vaultNo:77,nextAt:0,note:'continuous progress'}));
      sm.progressReads=0;sm.flowStarted=clock;sm.flowCalls=[];sm.flowReads=[];const beforeProgress=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter/action')sm.flowCalls.push({at:clock,...JSON.parse(options.body).action});
        if(url==='/api/shelter'){
          sm.progressReads++;sm.flowReads.push(clock);sm.view.revision=(sm.view.revision||0)+1;
          for(const r of sm.view.state.rooms)r.stored+=.001;
          for(const p of sm.view.state.residents){p.xp+=.001;if(p.roomId===90)p.training+=.001;}
          for(const k of ['food','water','power'])sm.view.state.resources[k]+=.001;
        }return beforeProgress(url,options);};${extra}`;
  };
  await t.test('公共执行连续场景：产出增长中完成治疗、训练返岗、双派遣和建设，刷新不重发',async()=>{
    const random=Number(process.env.ARKENGINE_FLOW_RANDOM??0);
    assert.ok([0,.5,.9999].includes(random),'fixed comparison must use the documented wait samples');
    await setupShelter(continuousScene(`Math.random=()=>${random};`));
    await drive(`sm.calls.some(c=>c.type==='stimpak'&&c.residentId===6)&&
      sm.calls.some(c=>c.type==='assign'&&c.residentId===5&&c.roomId===4)&&
      sm.calls.filter(c=>c.type==='explore_start').length===2&&sm.calls.some(c=>c.type==='upgrade')&&!${pending}`,
      'continuous development makes progress in all four paths',180);
    assert.ok(await evaluate('sm.progressReads>10'));
    const calls=await evaluate('sm.calls');
    assert.equal(calls.filter(c=>c.type==='stimpak').length,1);
    assert.equal(calls.filter(c=>c.type==='assign'&&c.residentId===5).length,1);
    assert.equal(calls.filter(c=>c.type==='upgrade').length,1);
    assert.equal(new Set(calls.filter(c=>c.type==='explore_start').map(c=>c.residentId)).size,2);
    assert.ok(await evaluate(`${state}.campaign.trips.every(t=>t.hours===2)`));
    if(process.env.ARKENGINE_FLOW_REPORT)writeFileSync(process.env.ARKENGINE_FLOW_REPORT,JSON.stringify(await evaluate(`({
      elapsedMs:clock-sm.flowStarted,random:Math.random(),reads:sm.progressReads,readsAt:sm.flowReads.map(at=>at-sm.flowStarted),
      calls:sm.flowCalls.map(c=>({...c,at:c.at-sm.flowStarted})),
      events:(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>
        ['action','shelter-submitted','shelter-confirmed'].includes(e.type)).map(e=>({...e,at:e.at-sm.flowStarted}))})`),null,2));
    await reloadShelter();for(let i=0;i<15;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>["stimpak","upgrade","explore_start"].includes(c.type)).length'),4);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).length'),1);
  });
  await t.test('公共执行物资增长：重读废料零件治疗针增加，治疗返岗双派遣仍完成且不重发',async()=>{
    await setupShelter(continuousScene(`
      const growingRead=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter')for(const k of ['scrap','parts','stimpak'])sm.view.state.resources[k]+=1;
        return growingRead(url,options);
      };`));
    await drive(`sm.calls.some(c=>c.type==='stimpak'&&c.residentId===6)&&
      sm.calls.some(c=>c.type==='assign'&&c.residentId===5&&c.roomId===4)&&
      sm.calls.filter(c=>c.type==='explore_start').length===2&&sm.calls.some(c=>c.type==='upgrade')&&!${pending}`,
      'material growth preserves already admitted fixed resident actions',180);
    assert.ok(await evaluate('sm.progressReads>10'));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'stimpak\').length'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'assign\'&&c.residentId===5).length'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'upgrade\').length'),1);
    const departures=await evaluate('sm.calls.filter(c=>c.type===\'explore_start\')');
    assert.equal(new Set(departures.map(c=>c.residentId)).size,2);
    assert.ok(departures.every(c=>c.stimpaks===2),'more stock does not increase the selected departure dose');
    await reloadShelter();for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>["stimpak","upgrade","explore_start"].includes(c.type)).length'),4);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'assign\'&&c.residentId===5).length'),1);
  });
  await t.test('公共执行取消让路：反复变化的治疗窗口本轮只开一次，后续建设继续，下轮可重评',async()=>{
    const f=readyCampaignConstructionScene();f.campaign.training=false;f.campaign.medical=true;
    f.view.state.residents.find(p=>p.id===5).hp=30;
    for(const p of f.view.state.residents)p.familyCooldownUntil=f.view.serverTime+86400000;
    await setupShelter(`sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','8');
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({combatGear:false,tier:0,hours:6,stimpaks:2,
        reserve:2,chance:70,attempts:1,trainTarget:6,...${JSON.stringify(f.campaign)}}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(f.state)},vaultNo:77,nextAt:0,note:'yield cancelled healing'}));
      sm.healOpens=0;sm.changeHealing=true;const open=openResident;window.openResident=id=>{if(id===5)sm.healOpens++;return open(id);};
      const read=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter'&&sm.changeHealing&&document.querySelector('[role="dialog"] h2')?.textContent.includes('居民5'))
          sm.view.state.residents.find(p=>p.id===5).hp-=.001;
        return read(url,options);};`);
    await drive(`sm.calls.some(c=>c.type==='upgrade')&&!${pending}`,'failed heal yields to funded construction',100);
    assert.equal(await evaluate('sm.healOpens'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="stimpak").length'),0);
    const deferred=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-execution-deferred')`);
    assert.ok(deferred.some(e=>e.data.kind==='stimpak'&&e.data.reason==='progress-regressed'));
    await evaluate('sm.changeHealing=false;');await reloadShelter();
    await drive(`sm.calls.some(c=>c.type==='stimpak')&&!${pending}`,'fresh visit retries the now stable patient',100);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="stimpak").length'),1);
  });
  await t.test('慢读取完整接续：治疗、训练返岗、两人出发与工程依次成功，刷新不重发',async()=>{
    await setupShelter(continuousScene(`Math.random=()=>.999;
      const read=window.fetch;sm.slowReads=0;window.fetch=(url,options)=>{
        if(url!=='/api/shelter')return read(url,options);sm.slowReads++;const due=clock+4000;
        return new Promise((resolve,reject)=>{const check=()=>{if(clock<due)return;cleanup();read(url,options).then(resolve,reject);};
          const abort=()=>{cleanup();reject(new DOMException('aborted','AbortError'));};
          const cleanup=()=>{window.removeEventListener('focus',check);options.signal.removeEventListener('abort',abort);};
          window.addEventListener('focus',check);options.signal.addEventListener('abort',abort,{once:true});});};`));
    await drive(`sm.calls.some(c=>c.type==='stimpak'&&c.residentId===6)&&
      sm.calls.some(c=>c.type==='assign'&&c.residentId===5&&c.roomId===4)&&
      sm.calls.filter(c=>c.type==='explore_start').length===2&&sm.calls.some(c=>c.type==='upgrade')&&!${pending}`,
      'slow full workflow finishes all selected actions',450);
    const calls=await evaluate('sm.calls');
    for(const type of ['stimpak','upgrade'])assert.equal(calls.filter(c=>c.type===type).length,1);
    assert.equal(calls.filter(c=>c.type==='assign'&&c.residentId===5).length,1);
    assert.equal(new Set(calls.filter(c=>c.type==='explore_start').map(c=>c.residentId)).size,2);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    for(const kind of ['stimpak','assign','explore-start','upgrade'])assert.ok(events.some(e=>e.type==='shelter-confirmed'&&e.data.kind===kind),kind);
    await reloadShelter();for(let i=0;i<15;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>["stimpak","upgrade","explore_start"].includes(c.type)).length'),4);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).length'),1);
  });
  await t.test('响应版本变化：同一伤员只治疗一次，随后工程开工且刷新不重复用针',async()=>{
    const f=readyCampaignConstructionScene();f.campaign.training=false;f.campaign.medical=true;
    f.view.state.resources.stimpak=6;
    Object.assign(f.view.state.residents.find(p=>p.id===5),{name:'何小满',hp:30});
    for(const p of f.view.state.residents)p.familyCooldownUntil=f.view.serverTime+86400000;
    await setupShelter(`sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.executionPlanCostMs=1800;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','8');
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({combatGear:false,tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6,...${JSON.stringify(f.campaign)}}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(f.state)},vaultNo:77,nextAt:0,note:'revision drift healing'}));
      sm.healOpens=0;const open=openResident;window.openResident=id=>{if(id===5)sm.healOpens++;return open(id);};
      const read=window.fetch;window.fetch=(url,options)=>{if(url==='/api/shelter')sm.view.revision=(sm.view.revision||0)+1;return read(url,options);};`);
    await drive(`sm.calls.some(c=>c.type==='stimpak'&&c.residentId===5)&&!${pending}`,'heal during revision changes',55);
    assert.equal(await evaluate('sm.healOpens'),1);
    assert.equal(await evaluate('sm.view.state.resources.stimpak'),5);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).hp'),70);
    assert.equal(await evaluate('sm.executionPlanCalls||0'),0);
    await drive(`sm.calls.some(c=>c.type==='upgrade')&&!${pending}`,'healing no longer starves construction',100);
    await reloadShelter();for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="stimpak"&&c.residentId===5).length'),1);
    assert.equal(await evaluate('sm.view.state.resources.stimpak'),5);
  });
  const ordinaryBuildScene=`const s=sm.view.state;sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    sm.view.progress.level=8;s.depth=3;s.digging=null;s.resources={scrap:300,parts:0,stimpak:0,power:100,food:100,water:100};
    const base=s.rooms[0],room=(id,type,floor,col,width=1,level=1)=>({...base,id,type,floor,col,width,level,stored:0});
    s.rooms=[room(10,'elevator',1,1),room(11,'elevator',2,1),room(12,'elevator',3,1),room(1,'power',1,2),
      room(2,'diner',1,3),room(3,'water',1,4),room(4,'scrap',1,5),room(5,'quarters',2,2,3),room(6,'storage',3,2)];
    const p=s.residents[0];s.residents=Array.from({length:8},(_,i)=>({...structuredClone(p),id:i+1,name:'居民'+(i+1),roomId:Math.floor(i/2)+1}));
    s.residents.push({...structuredClone(s.residents[0]),id:20,name:'待命居民',roomId:null});
    sm.fixtureSearch=location.search;sm.executionPlanCostMs=1800;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,
      scrapLimit:3000,partsLimit:100,scrapReserve:0,partsReserve:0}));
    sm.buildOpens=0;const open=openConstruction;window.openConstruction=(...args)=>{sm.buildOpens++;return open(...args);};`;
  await t.test('普通工程执行：无关房间持续产出时实际建站，一次扣款，刷新不重发',async()=>{
    await setupShelter(ordinaryBuildScene+`
      const read=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter')sm.view.state.rooms.find(r=>r.id===1).stored+=.001;
        return read(url,options);};`);
    await drive(`sm.calls.some(c=>c.type==='build')&&!${pending}`,'build while other room produces',45);
    assert.equal(await evaluate('sm.buildOpens'),1);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),204);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="build").map(c=>[c.room,c.floor,c.col])'),[['scrap',1,6]]);
    assert.equal(await evaluate('sm.executionPlanCalls||0'),0);
    await reloadShelter();for(let i=0;i<15;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build").length'),1);
  });
  await t.test('普通工程撤销：原生费用不符只关一次，不反复开窗且一分钟复查',async()=>{
    await setupShelter(ordinaryBuildScene+'sm.wrongConstructionPrice=1;');
    await drive(`location.pathname==='/activities/expedition'`,'bad price yields without reopening',60);
    assert.equal(await evaluate('sm.buildOpens'),1);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type))'),[]);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),300);
    assert.equal(await evaluate(pending),null);
    const check=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.findLast(e=>e.type==='shelter-check')`);
    assert.ok(check.data.nextAt-check.at<=62000);
  });
  for(const change of ['supply','occupant','construction'])await t.test('普通工程撤销：'+change+'变化记录原因，原工程不重开',async()=>{
    await setupShelter(ordinaryBuildScene);
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'new build window before safety change',40);
    if(change==='supply')await evaluate('sm.view.state.resources.food=0;');
    if(change==='occupant')await evaluate('sm.view.state.residents.find(p=>p.id===20).hp=20;');
    if(change==='construction')await evaluate(`sm.view.state.rooms.push(...[90,91].map((id,i)=>({...sm.view.state.rooms[0],id,type:'storage',floor:3,col:3+i,builtAt:clock+3600000})));`);
    await drive(`!document.querySelector('[data-construction-dialog]')`,'changed construction cancelled',30);
    for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate('sm.buildOpens'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build").length'),0);
    const failure=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='shelter-execution-invalidated')`);
    assert.equal(failure.data.reason,change==='construction'?'construction-basis':'construction-safety-bound');
    assert.ok(failure.data.fields.some(path=>path.startsWith(change==='construction'?'rooms':change==='occupant'?'residents.20.hp':'resources.food')));
  });
  await t.test('普通工程人工接手：焦点在原生窗口时不确认、不关闭、不重开',async()=>{
    await setupShelter(ordinaryBuildScene);
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'build before owner takeover',40);
    await evaluate(`document.querySelector('[data-construction-dialog] button').focus();`);await trustedStaffKey();
    await pulse(61000);for(let i=0;i<10;i++)await pulse();
    assert.equal(await evaluate('sm.buildOpens'),1);
    assert.ok(await evaluate(`!!document.querySelector('[data-construction-dialog]')`));
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
  });
  const executionScene=(kind,extra='')=>{
    const f=readyCampaignConstructionScene();
    f.campaign.training=false;f.view.state.residents.forEach(p=>p.familyCooldownUntil=f.view.serverTime+86400000);
    if(kind==='family'){
      for(const p of f.view.state.residents.slice(4))p.familyCooldownUntil=0;
      f.state.families=[{a:5,b:6,room:5}];
      f.construction={...f.construction,build:false,upgrade:false,dig:false};
    }
    return `sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.ui20261109=true;sm.quickAssign=false;sm.confirmFamily=true;
      sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.executionPlanCostMs=1800;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','${kind==='family'?'population':'production'}');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','8');
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({combatGear:false,
        tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6,...${JSON.stringify(f.campaign)}}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(f.state)},vaultNo:77,nextAt:0,note:'selected execution fixture'}));
      sm.executionReads=0;const executionFetch=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter')sm.executionReads++;return executionFetch(url,options);};${extra}`;
  };
  for(const kind of ['family','construction'])await t.test(`统一执行通路：${kind}在慢规划下完成原生提交，刷新不重发`,async()=>{
    await setupShelter(executionScene(kind));
    const success=kind==='family'?`sm.view.state.residents.slice(4).every(p=>p.roomId===5&&p.romance)`:
      `sm.view.state.rooms.find(r=>r.id===4).upgradeAt>clock`;
    await drive(`${success}&&!${pending}`,'selected '+kind+' finishes without replanning',110);
    const calls=await evaluate('sm.calls');assert.equal(calls.length,kind==='family'?2:1);
    assert.ok(calls.every(c=>c.type===(kind==='family'?'assign':'upgrade')));
    assert.equal(await evaluate('sm.executionPlanCalls||0'),0,'an open operation never repeats global selection');
    assert.ok(await evaluate('sm.executionReads>=2'),'mandatory fresh reads remain');
    await reloadShelter();for(let i=0;i<12;i++)await pulse();
    if(kind==='family'){
      // The follow-up exchanges 4 (higher agility) and 2 (higher endurance).
      // Wait for both halves, independent of which read finished before reload.
      await drive(`sm.view.state.residents.find(p=>p.id===4).roomId===2&&
        sm.view.state.residents.find(p=>p.id===2).roomId===4&&!${pending}`,'independent production swap completes after family',50);
      const after=await evaluate('sm.calls');
      assert.deepEqual(after.filter(c=>[5,6].includes(c.residentId)),calls);
      assert.deepEqual(after.filter(c=>![5,6].includes(c.residentId)).map(c=>[c.type,c.residentId,c.roomId]),[['assign',4,2],['assign',2,4]]);
      assert.ok(await evaluate('sm.view.state.residents.filter(p=>[5,6].includes(p.id)).every(p=>p.roomId===5&&p.romance)'));
    }else assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),calls.length);
  });
  await t.test('供给变化执行：慢规划与连续供给增长时工程仍开工，刷新不重复扣款',async()=>{
    await setupShelter(executionScene('construction',`
      const read=window.fetch;window.fetch=(url,options)=>{if(url==='/api/shelter'){
        for(const key of ['power','food','water'])sm.view.state.resources[key]+=.001;
      }return read(url,options);};`));
    await drive(`sm.view.state.rooms.find(r=>r.id===4).upgradeAt>clock&&!${pending}`,'construction survives benign stock drift',45);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),1);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2600);
    assert.equal(await evaluate('sm.executionPlanCalls||0'),0);
    await reloadShelter();for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),1);
  });
  for(const changed of ['budget','staff','supply','room','pending','manual'])await t.test(`统一执行撤销：建设开窗后${changed}变化不能沿用旧动作`,async()=>{
    await setupShelter(executionScene('construction'));
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'selected construction opened',50);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate(`const old=document.querySelector('[data-construction-dialog]');
      new MutationObserver(()=>{if(!old.isConnected&&sm.executionClosedCalls===undefined)sm.executionClosedCalls=sm.calls.length;})
        .observe(document.body,{childList:true,subtree:true});`);
    if(changed==='budget')await evaluate(`const key='arkengine:auto-shelter:construction:v1',cfg=JSON.parse(localStorage.getItem(key));cfg.scrapLimit=0;localStorage.setItem(key,JSON.stringify(cfg));`);
    if(changed==='staff')await evaluate('sm.view.state.residents.filter(p=>p.roomId===4).forEach(p=>p.hp=0);');
    if(changed==='supply')await evaluate('sm.view.state.resources.food=0;');
    if(changed==='room')await evaluate('sm.view.state.rooms.find(r=>r.id===4).unpowered=true;');
    if(changed==='pending')await evaluate(`localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'unknown-build',at:clock,kind:'upgrade',targets:[4],vaultNo:77,before:{collected:0,serverTime:clock,day:sm.view.state.daily.day,month:sm.view.state.season.month,construction:{project:{kind:'upgrade',id:4,type:'scrap',level:2,cost:{scrap:400,parts:0}},cells:2}}}));`);
    if(changed==='manual'){await evaluate(`document.querySelector('[data-construction-dialog] button').focus();`);await trustedStaffKey();}
    for(let i=0;i<32;i++)await pulse();
    if(changed==='staff'){
      assert.equal(await evaluate('sm.executionClosedCalls'),0,'changed roster closes the old decision before any new submission');
      assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>e.type==='shelter-execution-invalidated')`));
    }else{
      assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),0,changed);
      assert.equal(await evaluate('sm.view.state.resources.scrap'),3000);
    }
    if(changed==='pending'){
      await drive(`${state}.pendingReadOnly==='unknown-build'`,'unknown original request enters read-only recheck',20);
      assert.equal(await evaluate(`${pending}.id`),'unknown-build');
      assert.equal(await evaluate('sm.calls.length'),0);
      assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>e.type==='shelter-pending-wait')`),
        'a valid unknown operation reaches receipt verification rather than a corrupt-state stop');
    }
  });
  await t.test('统一执行通路：慢规划下派满两个普通探险名额，刷新不重复出发',async()=>{
    const view=campaignView();view.state.depth=13;
    await setupShelter(`sm.view=${JSON.stringify(view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      sm.executionPlanCostMs=1800;sm.slowDeparture=true;
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({
        explore:true,quests:false,training:false,medical:false,radio:false,combatGear:false,
        tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6}));`);
    await drive(`sm.view.state.explorers.length===2&&!${pending}`,'both slow-planning departures complete',100);
    const ids=await evaluate('sm.calls.filter(c=>c.type==="explore_start").map(c=>c.residentId)');
    assert.equal(ids.length,2);assert.equal(new Set(ids).size,2);
    await reloadShelter();for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="explore_start").length'),2);
  });
  await t.test('最新领取阻塞：41人日志派生现场在慢规划下先收满批、归来探险、赛季与成就',async()=>{
    const f=JSON.parse(readFileSync(new URL('./arkengine-shelter-latest-maintenance.fixture.json',import.meta.url),'utf8'));
    await setupShelter(`sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.planCostMs=12000;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','50');
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify(f.campaign)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(f.state)},nextAt:0,note:'latest maintenance'}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
      sm.view.state.season.points=60;sm.view.state.season.claimedFree=[];
      sm.view.state.achievements=[];`);
    await drive(`['collect_all','explore_claim','claim_season','claim_achievement'].every(type=>sm.calls.some(c=>c.type===type))`,
      'maintenance must run before optional expensive planning',70);
    const calls=await evaluate('sm.calls');
    for(const type of ['collect_all','explore_claim','claim_season','claim_achievement'])assert.equal(calls.filter(c=>c.type===type).length,1,type);
    assert.equal(await evaluate('sm.planCalls||0'),0,'no full development calculation before independent claims');
    assert.equal(await evaluate('sm.view.state.explorers.some(e=>e.id===172)'),false);
    assert.equal(await evaluate('sm.view.state.explorers.find(e=>e.id===160).returnAt'),f.view.state.explorers.find(e=>e.id===160).returnAt);
  });
  const familyScene=(mode,extra='')=>{
    const input=campaignView(2_000_000_000);
    for(const p of input.state.residents)p.training=0;
    return `sm.view=${JSON.stringify(input)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      const s=sm.view.state;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({
        explore:true,quests:true,dailyGoals:false,training:false,medical:false,radio:false,combatGear:false,
        tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6}));
      const record={vaultNo:77,nextAt:0,note:'family wait maintenance',families:[{a:1,b:2,room:5}],
        campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}};
      ${extra}
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(record));
      const nativeRead=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter')sm.view.state.resources.water+=.001;
        return nativeRead(url,options);
      };
      sm.familyJobs=0;window.Worker=class{
        postMessage(data){
          if(data.kind==='native-family-supply')sm.familyJobs++;
          if(data.kind==='native-family-supply'&&sm.holdFamily){sm.heldFamily={worker:this,data};return;}
          if(data.kind==='native-family-supply'&&'${mode}'==='running')return;
          setTimeout(()=>{if(!this.closed)this.onmessage?.({data:data.kind==='native-family-supply'?
            {id:data.id,kind:data.kind,supply:null,...('${mode}'==='failed'?{error:'fixture family failure'}:{})}:
            {id:data.id,error:'fixture unrelated development failure'}});},40);
        }
        terminate(){this.closed=true;}
      };`;
  };
  const idleScene=(mode,extra='')=>familyScene(mode,`
    const cfg=JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1'));
    cfg.explore=false;cfg.quests=false;localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(cfg));
    s.rooms.find(r=>r.id===4).width=2;${extra}`)+captureEmploymentTiming;
  const idleTrainingSetup=()=>{
    const {view,state:record,campaign}=idleTrainingScene();
    return `sm.view=${JSON.stringify(view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','50');
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify(campaign)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(${JSON.stringify({...record,nextAt:0,note:'两名休息居民'})}));
      sm.familyJobs=0;window.Worker=class{
        postMessage(data){if(data.kind==='native-family-supply'){sm.familyJobs++;return;}
          setTimeout(()=>this.onmessage?.({data:{id:data.id,error:'fixture unrelated planning held'}}),40);}
        terminate(){}
      };`+captureEmploymentTiming;
  };
  const captureEmploymentTiming=`sm.employmentTiming=[];sm.employmentStart=clock;
    const employmentFetch=window.fetch;window.fetch=(url,options)=>{
      if(options?.body){const action=JSON.parse(options.body).action;
        if(action?.type==='assign')sm.employmentTiming.push({id:action.residentId,room:action.roomId,
          elapsed:clock-sm.employmentStart,plans:sm.planCalls||0,familyJobs:sm.familyJobs||0});}
      return employmentFetch(url,options);
    };`;
  await t.test('慢规划就业：完整规划超过快照期限仍在首轮完成闲人补岗',async()=>{
    await setupShelter(idleScene('running',`sm.ui20261109=true;sm.planCostMs=12000;`));
    await drive(`sm.view.state.residents.slice(4).every(p=>p.roomId===4)&&!${pending}`,'idle jobs bypass full planning',60);
    const timing=await evaluate('sm.employmentTiming');
    assert.deepEqual(timing.map(x=>x.id).sort(),[5,6]);
    assert.ok(timing.every(x=>x.plans===0&&x.elapsed<60000),JSON.stringify(timing));
  });
  await t.test('慢规划就业：41人派生场景安排13号休息居民并让186号成年子女腾出宿舍',async()=>{
    const f=JSON.parse(readFileSync(new URL('./arkengine-shelter-latest-maintenance.fixture.json',import.meta.url),'utf8'));
    // Not a complete new snapshot: advance the older logged fixture to the latest
    // decision time and apply only the confirmed return/claim of resident 13.
    f.view.serverTime=1794388999553;
    f.view.state.residents.find(p=>p.id===13).away=null;
    f.view.state.explorers=f.view.state.explorers.filter(e=>e.residentId!==13);
    await setupShelter(`sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.planCostMs=12000;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','50');
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify(f.campaign)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(f.state)},nextAt:0,note:'latest employment'}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));`+captureEmploymentTiming);
    await drive(`[13,186].every(id=>sm.view.state.residents.find(p=>p.id===id).roomId===83)&&!${pending}`,
      'resting adult and grown child actually employed',65);
    const timing=await evaluate('sm.employmentTiming.filter(x=>[13,186].includes(x.id))');
    assert.deepEqual(timing.map(x=>x.id).sort((a,b)=>a-b),[13,186]);
    assert.ok(timing.every(x=>x.plans===0&&x.elapsed<60000),JSON.stringify(timing));
    const calls=await evaluate('sm.calls');
    assert.equal(calls.filter(c=>c.type==='stimpak'&&c.residentId===13).length,1);
    assert.ok(calls.findIndex(c=>c.type==='stimpak'&&c.residentId===13)<calls.findIndex(c=>c.type==='assign'&&c.residentId===13));
    for(const r of f.state.campaign.roles)assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${r.id}).roomId`),r.room);
    assert.ok(await evaluate('sm.view.state.explorers.some(e=>e.residentId===18)'));
  });
  await t.test('拟训练就业浏览器：38人日志中115和116在家庭后台等待期间实际到岗，刷新不重复',async()=>{
    await setupShelter(idleTrainingSetup());
    await drive(`sm.view.state.residents.find(p=>p.id===116).roomId!==null&&!${pending}`,'first idle adult employed',100);
    assert.ok(await evaluate('sm.employmentTiming.length===1&&sm.employmentTiming[0].familyJobs===0'), 'first employment precedes family search');
    await reloadShelter();
    await drive(`[115,116].every(id=>sm.view.state.residents.find(p=>p.id===id).roomId!==null)&&!${pending}`,
      'both idle adults employed despite deferred training',160);
    const calls=await evaluate('sm.calls.filter(c=>c.type==="assign"&&[115,116].includes(c.residentId))');
    assert.equal(calls.length,2,JSON.stringify(calls));assert.equal(new Set(calls.map(c=>c.residentId)).size,2);
    assert.ok(await evaluate('[115,116].every(id=>sm.view.state.rooms.some(r=>r.id===sm.view.state.residents.find(p=>p.id===id).roomId&&["power","diner","water","scrap"].includes(r.type)))'));
    const original=idleTrainingScene();const trainee=await evaluate('sm.view.state.residents.find(p=>p.id===11)');
    assert.equal(trainee.roomId,175);assert.equal(trainee.training,original.view.state.residents.find(p=>p.id===11).training);
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===11).until`),original.state.campaign.roles[0].until);
  });
  await t.test('拟训练就业浏览器：补岗原单结果未知，刷新不重发、不继续安排第二人',async()=>{
    await setupShelter(idleTrainingSetup()+`sm.assignUnknown=true;`);
    await drive(`${pending}?.kind==='assign'&&sm.calls.some(c=>c.type==='assign')`,'idle employment request unknown',100);
    const original=await evaluate(pending),count=await evaluate('sm.calls.filter(c=>c.type==="assign").length');
    await reloadShelter();for(let i=0;i<8;i++)await pulse();
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),count);
    assert.ok(await evaluate('[115,116].every(id=>sm.view.state.residents.find(p=>p.id===id).roomId===null)'));
  });
  await t.test('拟训练就业浏览器：提交前两名闲人受伤，取消待发补岗',async()=>{
    await setupShelter(idleTrainingSetup()+'sm.ui20261109=true;');
    await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('列表快捷调岗')`,
      'idle training employment queued',100);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),0);
    await evaluate('for(const id of [115,116])sm.view.state.residents.find(p=>p.id===id).hp=1;');
    for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&[115,116].includes(c.residentId)).length'),0);
    assert.ok(await evaluate('[115,116].every(id=>sm.view.state.residents.find(p=>p.id===id).roomId===null)'));
  });
  const fullSupplyScene=(resource,roomId,stat)=>idleScene('running',`
    sm.ui20261109=true;s.residents[4].roomId=4;
    s.rooms.find(r=>r.id===${roomId}).level=1;s.residents[${roomId-1}].stats.${stat}=0;
    // Native capacity: base 600 + 3 warehouse cells * 400 + one level-1 production cell * 250.
    s.resources.${resource}=2050;`);
  const competingSupplyScene=()=>idleScene('running',`
    sm.ui20261109=true;s.residents[4].roomId=4;
    s.rooms.find(r=>r.id===2).level=1;s.rooms.find(r=>r.id===3).level=1;
    s.residents[1].stats.agi=2;s.residents[2].stats.per=0;
    s.resources.food=5;s.resources.water=10;`);
  await t.test('补岗紧迫性浏览器：库存更多但净消耗更快的水先补，实际到岗且不挪原生产者',async()=>{
    await setupShelter(competingSupplyScene());
    await drive(`sm.view.state.residents[5].roomId===3&&!${pending}`,'net shortage water staffing',40);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>[c.residentId,c.roomId])'),[[6,3]]);
    assert.ok(await evaluate('sm.view.state.residents.slice(0,4).every(p=>p.roomId===p.id)'));
    const d=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>
      e.type==='shelter-staff-decision'&&e.data.residentId===6)?.data`);
    assert.ok(d.production.food>d.production.water);assert.equal(d.to,3);
  });
  await t.test('补岗紧迫性浏览器：提交前供水恢复、食物恶化时撤销旧补水并改补食物',async()=>{
    await setupShelter(competingSupplyScene());
    await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('列表快捷调岗')`,
      'water staffing queued',30);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate('sm.view.state.residents[2].stats.per=3;sm.view.state.residents[1].stats.agi=0;');
    await drive(`sm.view.state.residents[5].roomId===2&&!${pending}`,'updated food staffing',45);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>[c.residentId,c.roomId])'),[[6,2]]);
  });
  await t.test('满仓补供给浏览器：电食水负产出时先补对应岗位，不因满仓改派回收',async()=>{
    for(const [resource,roomId,stat] of [['power',1,'str'],['food',2,'agi'],['water',3,'per']]){
      await setupShelter(fullSupplyScene(resource,roomId,stat));
      await drive(`sm.view.state.residents[5].roomId===${roomId}&&!${pending}`,
        'full '+resource+' stock still needs sustainable production',40);
      assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>[c.residentId,c.roomId])'),[[6,roomId]]);
      const decision=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>
        e.type==='shelter-staff-decision'&&e.data.residentId===6)?.data`);
      assert.ok(decision.production[resource]<decision.plannedDemand[resource]);
      assert.ok(await evaluate(`sm.view.state.resources.${resource}>=2050`));
      assert.ok(await evaluate('sm.view.state.residents.slice(0,4).every(p=>p.roomId===p.id)'));
      // Family supply search is not started while baseline production is insufficient.
    }
  });
  await t.test('满仓补供给浏览器：产能补足撤销旧补电，本轮让路后刷新按最新空岗就业',async()=>{
    await setupShelter(fullSupplyScene('power',1,'str'));
    await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('列表快捷调岗')`,
      'full-stock power assignment queued',30);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate(`const p=sm.view.state.residents[0];p.stats.str=10;p.outfitId=99;
      sm.view.state.items.push({id:99,slot:'outfit',bonus:{str:7}});`);
    for(let i=0;i<12;i++)await pulse();
    assert.deepEqual(await evaluate('sm.calls'),[],'cancelled resident is deferred for this visit');
    assert.equal(await evaluate(pending),null);
    await reloadShelter();
    await drive(`sm.view.state.residents[5].roomId===4&&!${pending}`,'new visit uses new supply snapshot',45);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>[c.residentId,c.roomId])'),[[6,4]]);
  });
  const complementaryScene=()=>idleScene('running',`
    sm.ui20261109=true;localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
    s.rooms.find(r=>r.id===1).level=1;s.residents[0].stats.str=0;s.rooms.find(r=>r.id===4).width=1;
    s.rooms.push({...s.rooms.find(r=>r.id===5),id:90,width:1,level:1,floor:3});
    for(const p of s.residents.slice(4))Object.assign(p,{roomId:90,xp:0,hp:100});
    Object.assign(s.residents[4].stats,{str:10,end:10});Object.assign(s.residents[5].stats,{str:9,end:0});`);
  const coolingFamilyScene=()=>idleScene('running',`
    sm.ui20261109=true;s.rooms.push({...s.rooms.find(r=>r.id===5),id:90,floor:3,width:1});
    record.families.push({a:5,b:6,room:90});
    sm.cooldownUntil=clock+6*3600000;
    for(const p of s.residents.slice(4)){p.roomId=90;p.familyCooldownUntil=sm.cooldownUntil;}`);
  await t.test('冷却就业浏览器：家庭后台等待时两名父母到岗，刷新保留关系和期限且不重发',async()=>{
    await setupShelter(coolingFamilyScene());
    await drive(`sm.view.state.residents.slice(4).every(p=>p.roomId===4)&&!${pending}`,
      'cooling parents take production seats before family planning completes',55);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>c.residentId).sort()'),[5,6]);
    assert.ok(await evaluate(`${state}.families.some(f=>f.a===5&&f.b===6&&f.room===90)`));
    assert.ok(await evaluate('sm.view.state.residents.slice(4).every(p=>p.familyCooldownUntil===sm.cooldownUntil)'));
    assert.ok(await evaluate('sm.employmentTiming.length===2&&sm.employmentTiming.every(x=>x.familyJobs===0)'), 'employment precedes family search');
    const decisions=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>
      e.type==='shelter-staff-decision'&&[5,6].includes(e.data.residentId)).map(e=>e.data)`);
    assert.equal(decisions.length,2);assert.ok(decisions.every(d=>d.from===90&&d.to===4&&d.familyCooldownUntil>0));
    // Isolate the refresh from new family formation among the other adults.
    await pulse(1000);await evaluate(`for(const p of sm.view.state.residents.slice(0,4))p.familyCooldownUntil=clock+86400000;
      history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
    await reloadShelter();for(let i=0;i<12;i++)await pulse();
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign"&&[5,6].includes(c.residentId)).map(c=>c.residentId).sort()'),[5,6]);
    assert.ok(await evaluate(`${state}.families.some(f=>f.a===5&&f.b===6&&f.room===90)`));
    assert.ok(await evaluate('sm.view.state.residents.slice(4).every(p=>p.familyCooldownUntil===sm.cooldownUntil)'));
    assert.equal(await evaluate(pending),null);
  });
  await t.test('冷却就业浏览器：提交前临近冷却结束时取消原就业安排',async()=>{
    for(const remaining of [0,600000]){
    await setupShelter(coolingFamilyScene());
    await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('列表快捷调岗')`,
      'cooling parent move queued',30);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate(`for(const p of sm.view.state.residents.slice(4))p.familyCooldownUntil=clock+${remaining};`);
    for(let i=0;i<20;i++)await pulse();
    assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.ok(await evaluate('sm.view.state.residents.slice(4).every(p=>p.roomId===90)'));
    assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('组合补岗浏览器：先用合适人手补电，再让回收能手就业，后台家庭未返回也完成两步',async()=>{
    await setupShelter(complementaryScene());
    await drive('sm.calls.some(c=>c.type==="assign")','first complementary employment',30);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>[c.residentId,c.roomId])'),[[6,1]]);
    await drive(`sm.view.state.residents[4].roomId===4&&sm.view.state.residents[5].roomId===1&&!${pending}`,
      'both complementary jobs confirmed',55);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>[c.residentId,c.roomId])'),[[6,1],[5,4]]);
    assert.ok(await evaluate('sm.view.state.residents.slice(0,4).every(p=>p.roomId===p.id)'));
    const detail=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>
      e.type==='shelter-staff-decision'&&e.data.residentId===6)?.data.idleAllocation`);
    assert.ok(detail.planned.scrap>detail.baseline.scrap+16);assert.ok(detail.localChecks<=2000);
  });
  await t.test('组合补岗浏览器：提交前能力变化撤销旧选择，改用当前能补足供电的居民',async()=>{
    await setupShelter(complementaryScene());
    await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('列表快捷调岗')`,
      'complementary choice queued',30);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate('sm.view.state.residents[5].stats.str=0;');
    await drive(`sm.view.state.residents[4].roomId===1&&!${pending}`,'reselected power worker confirmed',55);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===6&&c.roomId===1).length'),0);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5&&c.roomId===1).length'),1);
  });
  await t.test('闲置就业优先：家庭计算未返回时实际安排两个闲置成人，原供给和家庭人员不动',async()=>{
    await setupShelter(idleScene('running'));
    await drive(`sm.view.state.residents.filter(p=>[5,6].includes(p.id)).every(p=>p.roomId===4)&&!${pending}`,
      'idle employment does not wait for unrelated family search',55);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>c.residentId).sort()'),[5,6]);
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>p.id<=4).every(p=>p.roomId===p.id)'));
    assert.ok(await evaluate('sm.employmentTiming.length===2&&sm.employmentTiming.every(x=>x.familyJobs===0)'), 'employment precedes family search');
  });
  await t.test('宿舍快速就业：新版居民页将两名单人宿舍成人补到回收岗，刷新不重复',async()=>{
    await setupShelter(idleScene('running',`
      sm.ui20261109=true;s.rooms.push({...s.rooms.find(r=>r.id===5),id:90,floor:3});
      s.residents[4].roomId=5;s.residents[5].roomId=90;`));
    const employed=`sm.view.state.residents.filter(p=>[5,6].includes(p.id)).every(p=>p.roomId===4)&&!${pending}`;
    await drive(employed,'dorm adults work before family result',55);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>c.residentId).sort()'),[5,6]);
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>p.id<=4).every(p=>p.roomId===p.id)'));
    assert.ok(await evaluate('sm.employmentTiming.length===2&&sm.employmentTiming.every(x=>x.familyJobs===0)'), 'employment precedes family search');
    const decisions=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>
      e.type==='shelter-staff-decision'&&[5,6].includes(e.data.residentId)).map(e=>e.data)`);
    for(const [id,from] of [[5,5],[6,90]])assert.ok(decisions.some(d=>d.residentId===id&&d.from===from&&d.to===4&&d.idleEmployment));
    // Keep the refresh check focused on employment, without starting a new family afterwards.
    await pulse(1000);await evaluate(`for(const p of sm.view.state.residents)p.familyCooldownUntil=clock+86400000;
      history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
    await reloadShelter();for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),2,
      JSON.stringify(await evaluate(`({calls:sm.calls,record:${state},residents:sm.view.state.residents})`)));
    assert.equal(await evaluate(pending),null);
  });
  for(const change of ['目标已满','开始恋爱'])await t.test(`宿舍快速就业：提交前${change}时取消原调岗`,async()=>{
    await setupShelter(idleScene('running',`
      sm.ui20261109=true;s.rooms.find(r=>r.id===4).width=1;
      s.residents[4].roomId=5;s.residents[5].roomId=1;`));
    await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('列表快捷调岗')`,
      'dorm move queued before fresh read',25);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate(change==='目标已满'?'sm.view.state.residents[5].roomId=4;':
      'sm.view.state.residents[4].romance={partnerId:6,progress:.3};');
    for(let i=0;i<20;i++)await pulse();
    // Other residents may still receive valid jobs after this choice is cancelled.
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5)'),[],
      'the original dorm resident cannot be moved after fresh eligibility changes');
    assert.equal(await evaluate('sm.view.state.residents[4].roomId'),5);
    assert.equal(await evaluate(pending),null);
  });
  const batchEmploymentScene=idleScene('ready',`
      sm.ui20261109=true;sm.visitStart=clock;
      s.rooms.find(r=>r.id===4).width=3;
      s.rooms.push({...s.rooms.find(r=>r.id===4),id:90,floor:3,col:2},
        {...s.rooms.find(r=>r.id===4),id:92,floor:4,col:2});
      for(let id=7;id<=18;id++)s.residents.push({...structuredClone(s.residents[5]),id,name:'待就业'+id,roomId:null});
      s.rooms.push({id:91,type:'training',trainStat:'agi',floor:4,col:5,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
      s.residents[4].stats.agi=1;for(const p of s.residents)p.training=0;
      cfg.training=true;localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(cfg));`);
  await t.test('连续避难所操作：超过一分钟和十二次操作仍在同页安排十三名成人',async()=>{
    await setupShelter(batchEmploymentScene);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId>=6)&&!${pending}`,'first idle worker employed');
    await pulse(65000);
    await drive(`sm.view.state.residents.filter(p=>p.id>=6).every(p=>[1,2,3,4,90,92].includes(p.roomId))&&!${pending}`,
      'all idle adults employed in one visit',220);
    const calls=await evaluate('sm.calls.filter(c=>c.type==="assign")');
    assert.ok([1,2,3,4,90,92].includes(calls[0].roomId),'first action creates production instead of starting training');
    assert.equal(calls.filter(c=>c.residentId>=6).length,13,'each unreserved adult is assigned once');
    assert.deepEqual(await evaluate('fm.calls.filter(c=>c.type==="navigate")'),[],
      'outstanding work must not force a round trip through expedition after one minute or twelve actions');
    assert.equal(await evaluate('location.pathname'),'/shelter');
    assert.equal(await evaluate(pending),null);
  });
  await t.test('连续避难所操作：远征即将到期时交还页面，保留未完成就业',async()=>{
    await setupShelter(batchEmploymentScene+`
      localStorage.setItem('arkengine:auto-farm:schedule:v1',JSON.stringify({nextAt:0,expeditionAt:clock+120000}));`);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId>=6)&&!${pending}`,'first assignment before expedition due');
    await pulse(await evaluate('sm.visitStart+106000-clock'));
    await drive(`location.pathname==='/activities/expedition'`,'return for known expedition arrival',35);
    assert.ok(await evaluate('sm.view.state.residents.some(p=>p.id>=6&&p.roomId===null)'));
    assert.equal(await evaluate(pending),null);
    assert.ok(await evaluate('clock-sm.visitStart<150000'),'do not occupy the full five-minute visit while expedition is due');
    const checks=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-check')`);
    assert.match(checks.at(-1).detail,/远征即将到期/);
    assert.equal(checks.at(-1).data.visit.expeditionAt,await evaluate('sm.visitStart+120000'));
  });
  await t.test('远征交接浏览器：已打开就业窗口完成同一人，其他闲置成人留待下次访问',async()=>{
    await setupShelter(batchEmploymentScene+`sm.quickAssign=false;sm.visitStart=clock;
      localStorage.setItem('arkengine:auto-farm:schedule:v1',JSON.stringify({nextAt:0,expeditionAt:clock+120000}));`);
    await drive(`!!document.querySelector('[data-staff-dialog]')`,'necessary employment window opened');
    await pulse(await evaluate('sm.visitStart+155000-clock'));
    await drive(`location.pathname==='/activities/expedition'&&!${pending}`,'finish only selected employment and return',70);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),1);
    assert.ok(await evaluate('sm.view.state.residents.some(p=>p.id>=6&&p.roomId===null)'));
    assert.ok(await evaluate('clock<=sm.visitStart+240000'));
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.equal(events.filter(e=>e.type==='shelter-handoff').length,1);
  });
  await t.test('闲置就业接续：五分钟上限后仍会接续未完成岗位',async()=>{
    await setupShelter(idleScene('ready',`
      s.rooms.find(r=>r.id===4).width=3;
      s.rooms.push({...s.rooms.find(r=>r.id===4),id:90,floor:3,col:2});
      for(let id=7;id<=14;id++)s.residents.push({...structuredClone(s.residents[5]),id,name:'待就业'+id,roomId:null});
      s.rooms.push({id:91,type:'training',trainStat:'agi',floor:4,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
      s.residents[4].stats.agi=1;for(const p of s.residents)p.training=0;
      cfg.training=true;localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(cfg));`));
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId>=6)&&!${pending}`,'first idle worker employed');
    await pulse(305000); // Force the extended bounded visit to end while real idle jobs remain.
    await drive(`sm.view.state.residents.filter(p=>p.id>=6).every(p=>[1,2,3,4,90].includes(p.roomId))&&!${pending}`,
      'bounded visits automatically continue outstanding idle employment',220);
    const calls=await evaluate('sm.calls.filter(c=>c.type==="assign")');
    assert.ok([1,2,3,4,90].includes(calls[0].roomId),'first action creates production instead of starting training');
    assert.equal(calls.filter(c=>c.residentId>=6).length,9,'each unreserved adult is assigned once');
    const checks=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-check')`);
    assert.ok(checks.some(e=>e.data.employmentContinuation?.recheckMs===5000&&e.data.nextAt-e.at<=5000&&e.data.actions>0),
      'visit expiry records short continuation while real jobs remain');
  });
  const dueTrip=`s.residents[4].away={kind:'explore'};s.residents[4].roomId=null;
    s.explorers=[{id:11,residentId:5,tier:0,abyss:false,startedAt:clock-6*3600000,
      recalledAt:null,returnAt:null,stimpaks:2,loot:{scrap:0,parts:0,stimpak:0,items:[]}}];
    record.campaign.trips=[{id:11,resident:5,at:clock-6*3600000,hours:6}];`;
  const familyStaffScene=familyScene('ready',`
    for(const p of s.residents)if(![1,2].includes(p.id))p.familyCooldownUntil=clock+86400000;
    // This suite exercises moving an existing producer, which still depends on family search.
    s.rooms.find(r=>r.id===4).width=2;for(const p of s.residents)if([5,6].includes(p.id))p.roomId=4;
    const cfg=JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1'));
    cfg.explore=false;cfg.quests=false;
    localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(cfg));`);
  await t.test('供给变化执行：库存增加保留原等待期限，家庭生产接替实际提交',async()=>{
    await setupShelter(familyStaffScene+`sm.familyJobsOnAssign=[];const assignFetch=window.fetch;
      window.fetch=(url,options)=>{if(url==='/api/shelter/action'){
        const action=JSON.parse(options.body).action;if(action.type==='assign')sm.familyJobsOnAssign.push({
          id:action.residentId,room:action.roomId,jobs:sm.familyJobs});}
        return assignFetch(url,options);};`);
    await until(()=>evaluate('sm.familyJobs>0'),'family job before dependent staffing');
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===4&&c.roomId===1)&&${pending}===null`,
      'production replacement survives changing stock and repeated family jobs',45);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===4&&c.roomId===1).length'),1);
    assert.deepEqual(await evaluate('sm.familyJobsOnAssign.filter(a=>a.id===4&&a.room===1)'),[{id:4,room:1,jobs:1}],
      'stock growth must reuse the first family decision through submission; actual reassignment may start a later job');
    assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>
      e.type==='shelter-confirmed'&&e.data.kind==='assign'&&e.data.targets[0]===4)`));
  });
  const holdStaffRefresh=async(extra='')=>{
    // This flow explicitly waits for the current UI's list assignment control.
    await setupShelter(familyStaffScene+'sm.ui20261109=true;');
    await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('列表快捷调岗')`,
      'production replacement queued',25);
    assert.equal(await evaluate('sm.calls.length'),0);
    await evaluate(`sm.holdFamily=true;sm.view.state.resources.water-=1;${extra}`);
    await drive('Boolean(sm.heldFamily)','fresh family job held before submission',12);
    for(let i=0;i<4;i++)await pulse();
    assert.deepEqual(await evaluate('sm.calls'),[],'elapsed click delay must never execute while family result is pending');
  };
  const releaseFamily=`sm.holdFamily=false;const held=sm.heldFamily;
    held.worker.onmessage?.({data:{id:held.data.id,kind:held.data.kind,supply:null}});`;
  await t.test('家庭重算调岗：供给下降撤销旧安排，计算返回后下一轮按当前现场接续',async()=>{
    await holdStaffRefresh();await evaluate(releaseFamily);
    // The fresh read reduced actual water. The selected operation is deferred
    // for this visit even when a later family result becomes ready.
    await drive(`location.pathname==='/activities/expedition'&&${state}?.nextAt>clock`,'invalidated action yields the current visit',25);
    assert.equal(await evaluate('sm.calls.length'),0);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.ok(events.some(e=>e.type==='shelter-execution-deferred'&&e.data.kind==='assign'));
    await pulse(61000);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===4&&c.roomId===1)&&${pending}===null`,
      'next visit reassesses the production replacement after supply regression',45);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===4&&c.roomId===1).length'),1);
  });
  await t.test('家庭重算调岗：重算失败取消已到期动作，不使用上一次结果',async()=>{
    await holdStaffRefresh();
    await evaluate(`const held=sm.heldFamily;held.worker.onmessage?.({data:{id:held.data.id,error:'fixture fresh family failure'}});`);
    await drive(`location.pathname==='/activities/expedition'&&${state}?.nextAt>clock`,'failed recomputation leaves safely',25);
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
  });
  await t.test('家庭重算调岗：最新读取发现目标满员，旧调岗不能续发',async()=>{
    await holdStaffRefresh('sm.view.state.residents[5].roomId=1;');
    await evaluate(releaseFamily);
    for(let i=0;i<25;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===4&&c.roomId===1).length'),0);
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>p.roomId===1).length<=2'));
  });
  await t.test('家庭重算调岗：真实键盘接手后迟到结果不恢复旧动作',async()=>{
    await holdStaffRefresh();await trustedStaffKey();await evaluate(releaseFamily);
    for(let i=0;i<15;i++)await pulse();
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
  });
  await t.test('家庭重算调岗：本轮访问超时后取消原等待，迟到结果不补发',async()=>{
    await holdStaffRefresh();await pulse(305000);
    await drive(`location.pathname==='/activities/expedition'&&${state}?.nextAt>clock`,'visit expires while family is held',15);
    await evaluate(releaseFamily);await pulse(1000);
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
  });
  await t.test('家庭失败恢复：一次后台故障结束当前轮，相同现场下一轮重新计算并只调岗一次',async()=>{
    await setupShelter(familyStaffScene+`
      window.fetch=nativeRead;sm.retryJobs=0;
      window.Worker=class{
        postMessage(data){
          if(data.kind!=='native-family-supply'){setTimeout(()=>this.onmessage?.({data:{id:data.id,error:'unrelated worker'}}),20);return;}
          sm.retryJobs++;const first=sm.retryJobs===1;
          setTimeout(()=>{if(!this.closed)this.onmessage?.({data:first?{id:data.id,error:'one transient worker error'}:
            {id:data.id,kind:data.kind,supply:null}});},40);
        }
        terminate(){this.closed=true;}
      };`);
    await drive(`location.pathname==='/activities/expedition'&&${state}.nextAt>clock`,'failed family search exits the visit',35);
    assert.equal(await evaluate('sm.retryJobs'),1,'no repeated attempt in the failed visit');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'assign\').length'),0);
    await pulse(61000);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===4&&c.roomId===1)&&${pending}===null`,
      'next visit can recover without an unrelated state change or manual reload',75);
    assert.ok(await evaluate('sm.retryJobs>=2'));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'assign\'&&c.residentId===4&&c.roomId===1).length'),1);
  });
  await t.test('后台规划截止：定时器延迟仍结束挂起家庭任务，迟到结果不调岗且下轮恢复一次',async()=>{
    await setupShelter(familyStaffScene+`
      window.fetch=nativeRead;sm.deadlineJobs=0;sm.deadlineTimers=[];
      const deadlineTimeout=window.setTimeout.bind(window);
      window.setTimeout=(fn,ms,...args)=>{
        if(ms===45000){sm.deadlineTimers.push(fn);return deadlineTimeout(()=>{},3600000);}
        return deadlineTimeout(fn,ms,...args);
      };
      window.Worker=class{
        postMessage(data){
          if(data.kind!=='native-family-supply'){setTimeout(()=>this.onmessage?.({data:{id:data.id,error:'unrelated worker'}}),20);return;}
          sm.deadlineJobs++;
          if(sm.deadlineJobs===1){sm.deadlineJob={worker:this,data,at:clock};return;}
          setTimeout(()=>{if(!this.closed)this.onmessage?.({data:{id:data.id,kind:data.kind,supply:null}});},40);
        }
        terminate(){this.closed=true;}
      };`);
    await until(()=>evaluate('Boolean(sm.deadlineJob)'),'family Worker hangs with deadline timer withheld');
    assert.deepEqual(await evaluate('sm.calls'),[]);
    await pulse(46000);
    await drive(`location.pathname==='/activities/expedition'&&${state}.nextAt>clock`,
      'wake-up expires the original task and yields the visit',20);
    assert.equal(await evaluate('sm.deadlineJobs'),1);
    assert.equal(await evaluate('sm.deadlineJob.worker.closed'),true);
    const statuses=()=>evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events
      .filter(e=>e.type==='shelter-family-planning').map(e=>e.data.status)`);
    assert.deepEqual(await statuses(),['timeout']);
    const timing=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events
      .find(e=>e.type==='shelter-family-planning').data`);
    assert.equal(timing.timingScope,'queue-to-result-wall-clock');
    assert.ok(Number.isSafeInteger(timing.requestedAt)&&Number.isSafeInteger(timing.finishedAt));
    assert.ok(timing.finishedAt-timing.requestedAt>=45000);
    await evaluate(`const held=sm.deadlineJob;
      held.worker.onmessage?.({data:{id:held.data.id,kind:held.data.kind,supply:null}});
      sm.deadlineTimers.forEach(fn=>fn());`);
    assert.deepEqual(await statuses(),['timeout']);
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
    await pulse(61000);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===4&&c.roomId===1)&&${pending}===null`,
      'next visit recomputes and confirms one valid assignment',75);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'assign\'&&c.residentId===4&&c.roomId===1).length'),1);
  });
  await t.test('家庭慢计算：连续产出跨过状态刷新仍完成供给比较，实际调岗一次',async()=>{
    await setupShelter(familyStaffScene+`
      sm.slowFamilyJobs=[];sm.familyDeliveries=[];sm.familyGrowthReads=0;
      const growthRead=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter'){
          sm.familyGrowthReads++;
          for(const r of sm.view.state.rooms)r.stored+=.001;
          for(const p of sm.view.state.residents){p.xp+=.001;p.training+=.001;}
        }return growthRead(url,options);
      };
      window.Worker=class{
        postMessage(data){
          if(data.kind!=='native-family-supply'){setTimeout(()=>this.onmessage?.({data:{id:data.id,error:'unrelated worker'}}),20);return;}
          const job={id:data.id,at:clock};sm.slowFamilyJobs.push(job);
          const deliver=()=>{
            if(this.closed||clock<job.at+12000)return;
            window.removeEventListener('focus',deliver);
            sm.familyDeliveries.push({id:data.id,jobs:sm.slowFamilyJobs.length});
            this.onmessage?.({data:{id:data.id,kind:data.kind,supply:null}});
          };
          window.addEventListener('focus',deliver);this.removeListener=()=>window.removeEventListener('focus',deliver);
        }
        terminate(){this.closed=true;this.removeListener?.();}
      };`);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===4&&c.roomId===1)&&${pending}===null`,
      'slow family comparison survives ordinary production and reaches a confirmed assignment',100);
    assert.ok(await evaluate('sm.familyGrowthReads>=3'));
    assert.equal(await evaluate('sm.familyDeliveries[0].jobs'),1,'refresh must not repeatedly cancel the first search');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'assign\'&&c.residentId===4&&c.roomId===1).length'),1);
  });
  await t.test('慢规划召回：完整规划耗时超过快照期限也先召回，确认回执且不重复',async()=>{
    await setupShelter(familyScene('running',dueTrip+'sm.planCostMs=12000;'));
    await drive(`sm.calls.some(c=>c.type==='explore_recall')`,'recall before slow elective search',35);
    assert.equal(await evaluate('sm.planCalls||0'),0);
    await drive(`${pending}===null`,'recall receipt confirmed before other work',15);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="explore_recall").length'),1);
    assert.ok(await evaluate('sm.view.state.explorers[0].returnAt>clock'));
  });
  for(const mode of ['ready','running','failed'])await t.test(`家庭等待收尾：${mode}下到期召回只提交一次并核对回执`,async()=>{
    // Exercise family-dependent reassignment. An idle adult may legally take a
    // basic production vacancy before family search, covered by the idle suite.
    await setupShelter(familyScene(mode,dueTrip+'s.residents[5].roomId=4;'));
    assert.equal(await evaluate('sm.familyJobs'),0,'existing recall must not wait for a family search to start');
    await drive(`sm.calls.some(c=>c.type==='explore_recall')&&${pending}===null`,'recall while family recalculates',40);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="explore_recall").length'),1);
    assert.ok(await evaluate('sm.view.state.explorers[0].returnAt>clock'));
    assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>
      e.type==='shelter-confirmed'&&e.data.kind==='explore-recall')`));
    if(mode!=='ready'){
      for(let i=0;i<30;i++)await pulse();
      assert.ok(await evaluate('sm.familyJobs>0'),'family planning was actually requested');
      assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_recall'],
        'family-dependent staffing, construction and new departures must still wait');
    }
  });
  for(const mode of ['ready','running','failed'])await t.test(`家庭等待收尾：${mode}下归来领取和安全巡检日奖继续`,async()=>{
    await setupShelter(familyScene(mode,dueTrip+`
      s.explorers[0].recalledAt=clock-3600000;s.explorers[0].returnAt=clock-1;
      s.residents[5].away={kind:'quest'};s.residents[5].roomId=null;
      s.quests=[{id:21,questId:'w1',team:[6],status:'returning',stage:3,nextStageAt:null,
        returnAt:clock-1,snapshot:structuredClone(sm.view.env.quests[0])}];
      const cfg=JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1'));
      cfg.dailyGoals=true;localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(cfg));
      s.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);
      s.daily.picks=[['incident',2],['win',5],['baby',1]].map(([key,target])=>({key,target,reward:{scrap:160,parts:1,points:30}}));
      s.daily.counters={incident:1,win:0,baby:0};sm.inspectionGoals=true;sm.ui20261109=true;`));
    assert.equal(await evaluate('sm.familyJobs'),0,'return and reward handling precedes family search');
    await drive(`sm.view.state.explorers.length===0&&sm.view.state.quests.length===0&&
      sm.view.state.daily.claimed.includes(0)&&${pending}===null`,'returns and daily progress while family waits',55);
    const calls=await evaluate('sm.calls.map(c=>c.type)');
    for(const kind of ['explore_claim','quest_claim','safety_inspection','claim_objective'])
      assert.equal(calls.filter(c=>c===kind).length,1,kind+' must submit once');
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[5,6].includes(p.id)).every(p=>p.away===null)'));
    if(mode!=='ready')assert.equal(calls.length,4,'no family-dependent actions during the wait');
  });
  await t.test('家庭等待收尾：未知召回跨刷新只读保留，不重发或穿插新动作',async()=>{
    await setupShelter(familyScene('running',dueTrip+`sm.mode='unknown';`));
    await drive('sm.calls.length===1','unknown recall submitted',40);
    const original=await evaluate(pending);
    assert.equal(original.kind,'explore-recall');
    await pulse(1000);
    await evaluate(`history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
    await reloadShelter();
    await drive(`location.pathname==='/activities/expedition'&&${state}?.pendingReadOnly===${JSON.stringify(original.id)}`,
      'unknown recall remains read only');
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_recall']);
  });
  await t.test('避难所领取活锁：家庭供给跨刷新重算、未返回或失败仍能领取一次',async()=>{
    for(const mode of ['ready','running','failed']){
    const input=campaignView(2_000_000_000);
    input.state.rooms.find(r=>r.id===4).stored=63;
    for(const p of input.state.residents)p.training=0;
    await setupShelter(`sm.view=${JSON.stringify(input)};clock=sm.view.serverTime;
      sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'collection refresh',families:[{a:1,b:2,room:5}]}));
      const nativeRead=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter')sm.view.state.resources.water+=.001;
        return nativeRead(url,options);
      };
      sm.familyJobs=0;window.Worker=class{
        postMessage(data){
          if(data.kind==='native-family-supply')sm.familyJobs++;
          if(data.kind==='native-family-supply'&&'${mode}'==='running')return;
          setTimeout(()=>{if(!this.closed)this.onmessage?.({data:data.kind==='native-family-supply'?
            {id:data.id,kind:data.kind,supply:null,...('${mode}'==='failed'?{error:'fixture family failure'}:{})}:
            {id:data.id,error:'fixture unrelated development failure'}});},40);
        }
        terminate(){this.closed=true;}
      };`);
    assert.equal(await evaluate('sm.familyJobs'),0,'collection precedes family search');
    for(let i=0;i<12&&!await evaluate(`sm.calls.some(c=>c.type==='collect_all')&&${pending}===null`);i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="collect_all").length'),1,
      'fresh pre-submit reads must not restart the collection delay');
    assert.equal(await evaluate('sm.view.state.stats.collected'),63);
    assert.equal(await evaluate(pending),null);
    await pulse(5000);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="collect_all").length'),1);
    assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>
      e.type==='shelter-confirmed'&&e.data.kind==='collect')`));
    if(mode!=='ready')assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all'],
      'dependent staffing and construction must still wait for family supply');
    }
  });
  const v=campaignView(2_000_000_000);v.state.rooms.find(r=>r.id===6).width=3;
  for(const p of v.state.residents){p.training=0;if(p.id!==5)p.hp=50;}
  // Ordinary production transfer: idle adults now have a higher-priority direct
  // employment path and intentionally do not wait for the background comparison.
  v.state.rooms.push({...v.state.rooms.find(r=>r.id===4),id:40,level:1,floor:4,col:2});
  v.state.residents.find(p=>p.id===5).roomId=40;
  const scene=`sm.view=${JSON.stringify(v)};clock=sm.view.serverTime+1234;sm.fixtureSearch=location.search;
    sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'worker fixture',constructionLedger:[]}));
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:false,upgrade:false,dig:false,scrapLimit:0,partsLimit:0,scrapReserve:200,partsReserve:0}));
    sm.planningReplies=[];sm.planningRequests=[];const RealWorker=window.Worker;
    window.Worker=class extends RealWorker{
      constructor(...args){super(...args);this.addEventListener('message',event=>{
        if(event.data?.result?.body?.kind==='bounded-development-selection')sm.planningReplies.push(event.data);
      });}
      postMessage(data,...rest){if(data?.runtime)sm.planningRequests.push(structuredClone(data));return super.postMessage(data,...rest);}
    };`;
  await t.test('后台规划分岗伴侣：真实Worker继续增产建议，原生调岗确认且保留伴侣岗位和进度',async()=>{
    await setupShelter(scene+`
      const parent=sm.view.state.residents[0];
      sm.view.state.residents.push(...[[7,8,5],[8,7,2]].map(([id,partnerId,roomId])=>
        ({...structuredClone(parent),id,name:'分岗伴侣'+id,roomId,romance:{partnerId,progress:.4}})));
      const key='arkengine:auto-shelter:schedule:v1',saved=JSON.parse(localStorage.getItem(key));
      saved.families=[{a:7,b:8,room:5}];localStorage.setItem(key,JSON.stringify(saved));`);
    await until(()=>evaluate('sm.planningReplies.some(x=>x.prepared?.action?.residentId===5)'),
      'separated partners allow independent Worker proposal',10000);
    await drive(`${pending}===null&&sm.calls.some(c=>c.type==='assign'&&c.residentId===5&&c.roomId===4)`,
      'independent native assignment confirmed');
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>
      e.type==='shelter-staff-decision'&&e.data.developmentProposal?.candidateId==='assign:5:4')`),true);
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[7,8].includes(p.id)).map(p=>[p.id,p.roomId,p.romance.progress])'),
      [[7,5,.4],[8,2,.4]]);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>c.residentId)'),[5]);
  });
  await t.test('后台规划浏览器：实际Worker建议通过原生调岗回执确认，刷新保留原窗口且不重复',async()=>{
    await setupShelter(scene);
    await until(()=>evaluate('sm.planningReplies.some(x=>x.prepared?.action?.residentId===5)'),'actual planner worker reply',10000);
    const window=await evaluate(`${state}.developmentWindow`);
    assert.equal(await evaluate('sm.planningRequests[0].runtime.view.state.lastSettledAt'),v.state.lastSettledAt);
    assert.equal(await evaluate('sm.planningRequests[0].runtime.view.serverTime>sm.planningRequests[0].runtime.view.state.lastSettledAt'),true);
    await drive(`${pending}===null&&sm.calls.some(x=>x.type==='assign'&&x.residentId===5&&x.roomId===4)`,'native assignment confirmed');
    assert.equal(await evaluate('sm.calls.filter(x=>x.type==="assign").length'),1);
    const timing=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events
      .find(e=>e.type==='shelter-planning'&&e.data.status==='ready').data`);
    assert.equal(timing.timingScope,'request-to-result-wall-clock');
    assert.ok(Number.isSafeInteger(timing.requestedAt)&&Number.isSafeInteger(timing.finishedAt));
    assert.ok(timing.finishedAt>=timing.requestedAt);
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>
      e.type==='shelter-staff-decision'&&e.data.developmentProposal?.candidateId==='assign:5:4')`),true,
      'the native execution decision must actually consume the background proposal: '+JSON.stringify(await evaluate(`({requests:sm.planningRequests.length,replies:sm.planningReplies.length,
        schedule:${state},logs:(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type.includes('planning')||e.type==='shelter-staff-decision').map(e=>({type:e.type,data:e.data}))})`)));
    assert.equal(await evaluate('sm.planningReplies[0].result.body.qualifiedForNativeExecution'),false);
    assert.deepEqual(await evaluate('sm.planningReplies[0].result.body.coverage.exchange'),
      {evaluated:false,reason:'native-current-assignment-only',emitted:0});
    await evaluate(`history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);await reloadShelter();
    await pulse(10000);
    assert.deepEqual(await evaluate(`${state}.developmentWindow`),window);
    assert.equal(await evaluate('sm.calls.filter(x=>x.type==="assign").length'),1);
  });
  await t.test('后台规划浏览器：Worker被阻止时常规调岗仍可确认，不同步运行长搜索',async()=>{
    await setupShelter(scene+`window.Worker=class{constructor(){throw new Error('fixture CSP worker blocked');}};`);
    await drive(`${pending}===null&&sm.calls.some(x=>x.type==='assign'&&x.residentId===5&&x.roomId===4)`,'fallback staff confirmed');
    assert.equal(await evaluate('sm.planningReplies.length'),0);
    assert.equal(await evaluate('sm.calls.filter(x=>x.type==="assign").length'),1);
  });

  const lv=levelPlanningView();
  const levelScene=`sm.view=${JSON.stringify(lv)};clock=sm.view.serverTime;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
    localStorage.setItem('arkengine:auto-shelter:population:v1','6');
    localStorage.setItem('arkengine:auto-shelter:level-target:v1',${JSON.stringify(String(lv.progress.level+1))});
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'level worker fixture',constructionLedger:[]}));
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}));
    sm.levelReplies=[];sm.levelRequests=[];const ActualWorker=window.Worker;
    window.Worker=class extends ActualWorker{
      constructor(...args){super(...args);this.addEventListener('message',e=>{if(e.data?.kind==='native-level-routes')sm.levelReplies.push(e.data);});}
      postMessage(data,...rest){if(data?.targetScore)sm.levelRequests.push(structuredClone(data));return super.postMessage(data,...rest);}
      set onmessage(listener){super.onmessage=e=>{
        if(e.data?.kind==='native-level-routes'&&sm.delayLevelReply)setTimeout(()=>listener.call(this,e),sm.delayLevelReply);
        else listener.call(this,e);
      };}
    };`;
  await t.test('等级后台浏览器：完整路线返回后经当前原生窗口核对开工，刷新不重复',async()=>{
    await setupShelter(levelScene);
    try{await until(()=>evaluate('sm.levelReplies.some(r=>r.routes.some(x=>x.complete))'),'native level worker reply',10000);}
    catch(error){t.diagnostic(JSON.stringify(await evaluate(`({requests:sm.levelRequests,replies:sm.levelReplies,calls:sm.calls,schedule:${state},logs:(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.slice(-12)})`)));throw error;}
    try{await drive(`${pending}===null&&sm.calls.some(c=>c.type==='upgrade'&&c.roomId>=100)`,'native level upgrade confirmed');}
    catch(error){t.diagnostic(JSON.stringify(await evaluate(`({requests:sm.levelRequests,replies:sm.levelReplies,calls:sm.calls,schedule:${state},logs:(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.slice(-12)})`)));throw error;}
    const upgrades=await evaluate('sm.calls.filter(c=>c.type==="upgrade")');assert.equal(upgrades.length,1);
    const firsts=await evaluate('sm.levelReplies.flatMap(r=>r.routes.filter(x=>x.complete).map(x=>x.steps[0].project.id))');
    assert.ok(firsts.includes(upgrades[0].roomId));
    await reloadShelter();await pulse(3000);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===${upgrades[0].roomId}).length`),1);
  });
  await t.test('等级后台刷新：响应版本与字段顺序持续变化仍消费完成路线并确认开工',async()=>{
    await setupShelter(levelScene+`
      sm.levelReadCount=0;const baseFetch=window.fetch;
      const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?
        Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
      window.fetch=(url,options)=>{if(url==='/api/shelter'){
        sm.view.revision=++sm.levelReadCount;sm.view=reorder(sm.view);
      }return baseFetch(url,options);};`);
    await until(()=>evaluate('sm.levelReplies.some(r=>r.routes.some(x=>x.complete))'),'route ready before refreshed read',10000);
    await drive(`${pending}===null&&sm.calls.some(c=>c.type==='upgrade'&&c.roomId>=100)`,
      'completed level route survives mandatory fresh reads',65);
    assert.ok(await evaluate('sm.levelReadCount>1'));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'upgrade\').length'),1);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.equal(events.filter(e=>e.type==='shelter-execution-evidence'&&e.data.reason==='facts'&&!e.data.fields.length).length,0);
  });
  await t.test('等级规划连续生产：后台计算跨过刷新，正常积累中仍完成开工确认且不重复',async()=>{
    await setupShelter(levelScene+`
      sm.delayLevelReply=700;sm.growingReads=0;const baseFetch=window.fetch;
      window.fetch=(url,options)=>{if(url==='/api/shelter'){
        sm.growingReads++;sm.view.revision=sm.growingReads;
        for(const p of sm.view.state.residents)p.xp+=.001;
        for(const r of sm.view.state.rooms)r.stored+=.001;
        for(const k of ['food','water','power','scrap'])sm.view.state.resources[k]+=.001;
      }return baseFetch(url,options);};`);
    try{await drive(`${pending}===null&&sm.calls.some(c=>c.type==='upgrade'&&c.roomId>=100)`,
      'completed search reaches one confirmed construction during ordinary production',110);}
    catch(error){t.diagnostic(JSON.stringify(await evaluate(`({reads:sm.growingReads,searches:sm.levelRequests.length,replies:sm.levelReplies.length,
      evidence:(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-execution-evidence').map(e=>e.data)})`)));throw error;}
    assert.ok(await evaluate('sm.growingReads>2'));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'upgrade\').length'),1);
    const id=await evaluate('sm.calls.find(c=>c.type===\'upgrade\').roomId');
    await reloadShelter();for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===${id}).length`),1);
    // Feed an explicit completed server snapshot; no simulated future income.
    await evaluate(`const built=sm.view.state.rooms.find(r=>r.id===${id});clock=Math.max(clock,built.upgradeAt+1000);
      built.level++;built.upgradeAt=null;sm.view.state.lastSettledAt=clock;
      sm.view.progress.score+=built.width;sm.view.progress.level=1+Math.floor(Math.sqrt(Math.max(0,sm.view.progress.score-30))/1.5);`);
    await evaluate(`const nextFetch=window.fetch;window.fetch=(url,options)=>{if(url==='/api/shelter'){
      for(const p of sm.view.state.residents)p.xp+=.001;
      for(const r of sm.view.state.rooms)r.stored+=.001;
      for(const k of ['food','water','power','scrap'])sm.view.state.resources[k]+=.001;
    }return nextFetch(url,options);};`);
    await drive(`${pending}===null&&sm.calls.filter(c=>c.type==='upgrade').length===2`,
      'confirmed completion leads to the next funded step under continuing production',110);
    const entries=await evaluate(`${state}.constructionLedger`);
    assert.equal(entries.length,2);assert.equal(new Set(entries.map(e=>e.id)).size,2);
    assert.ok(entries.every(e=>e.scrap>0));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'assign\').length'),0,'no staffing churn to complete the same route');
  });
  await t.test('等级慢计算：结果跨过十秒重读且产出持续增长，仍能完成当前工程',async()=>{
    await setupShelter(levelScene+`
      sm.slowJobs=0;sm.growthReads=0;const NativeWorker=window.Worker;
      window.Worker=class extends NativeWorker{
        set onmessage(listener){super.onmessage=e=>{
          if(e.data?.kind!=='native-level-routes'){listener.call(this,e);return;}
          sm.slowJobs++;const due=clock+12000;
          const deliver=()=>{if(this.closed||clock<due)return;window.removeEventListener('focus',deliver);listener.call(this,e);};
          window.addEventListener('focus',deliver);
        };}
        terminate(){this.closed=true;super.terminate();}
      };
      const fetchBefore=window.fetch;window.fetch=(url,options)=>{if(url==='/api/shelter'){
        sm.growthReads++;for(const k of ['scrap','food','water','power'])sm.view.state.resources[k]+=.001;
        for(const r of sm.view.state.rooms)r.stored+=.001;
        for(const p of sm.view.state.residents)p.xp+=.001;
      }return fetchBefore(url,options);};`);
    try{await drive(`${pending}===null&&sm.calls.some(c=>c.type==='upgrade'&&c.roomId>=100)`,
      'slow complete route survives the mandatory refreshing observations',100);}
    catch(error){t.diagnostic(JSON.stringify(await evaluate('({reads:sm.growthReads,jobs:sm.slowJobs,calls:sm.calls})')));throw error;}
    assert.ok(await evaluate('sm.growthReads>=3'));assert.equal(await evaluate('sm.calls.filter(c=>c.type===\'upgrade\').length'),1);
  });
  await t.test('等级复核缓存：已开窗的工程遇到预算降低仍撤销且不提交',async()=>{
    await setupShelter(levelScene+`sm.delayLevelReply=700;`);
    await drive(`Boolean(document.querySelector('[data-construction-dialog]'))`,
      'level proposal rechecked and native construction dialog opened',100);
    assert.equal(await evaluate('sm.calls.filter(c=>["upgrade","build","dig"].includes(c.type)).length'),0);
    await evaluate(`const key='arkengine:auto-shelter:construction:v1',cfg=JSON.parse(localStorage.getItem(key));
      cfg.scrapLimit=0;cfg.partsLimit=0;localStorage.setItem(key,JSON.stringify(cfg));
      window.dispatchEvent(new StorageEvent('storage',{key}));`);
    await drive(`!document.querySelector('[data-construction-dialog]')`,'changed budget cancels the cached proposal',35);
    for(let i=0;i<8;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>["upgrade","build","dig"].includes(c.type)).length'),0);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('等级后台浏览器：Worker不可用时不执行未经完整比较的纯等级投资',async()=>{
    await setupShelter(levelScene+`window.Worker=class{constructor(){throw new Error('fixture level CSP blocked');}};`);
    await pulse(10000);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId>=100).length'),0);
    assert.equal(await evaluate('sm.levelReplies.length'),0);
  });
  await t.test('等级后台浏览器：计算返回前预算降低，迟到完整路线不能开工',async()=>{
    await setupShelter(levelScene+'sm.delayLevelReply=1500;');
    await until(()=>evaluate('sm.levelReplies.some(r=>r.routes.some(x=>x.complete))'),'delayed complete level route',10000);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),0);
    await evaluate(`const key='arkengine:auto-shelter:construction:v1';const config=JSON.parse(localStorage.getItem(key));
      config.scrapLimit=0;config.partsLimit=0;localStorage.setItem(key,JSON.stringify(config));window.dispatchEvent(new StorageEvent('storage',{key}));`);
    for(let i=0;i<12;i++)await pulse(1000);
    assert.equal(await evaluate('sm.calls.filter(c=>["upgrade","build","dig"].includes(c.type)).length'),0);
    assert.equal(await evaluate(pending),null);
  });
}
