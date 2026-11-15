import assert from 'node:assert/strict';
import {latestFamilyScene} from './arkengine-shelter-latest-log.fixture.mjs';

export async function shelterStaffTests({t,setupShelter,reloadShelter,evaluate,pulse,drive,until,expStatus,trustedStaffKey}) {
  const panel = `document.getElementById('ark-auto-expedition').shadowRoot`;
  const state = `JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`;
  const pending = `JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`;
  const moves = `sm.calls.filter(c=>c.type==='assign')`;
  const done = `location.pathname==='/activities/expedition' && ${state}?.nextAt>clock`;
  const check = `${panel}.getElementById('shelter-check').click()`;
  const mode = value => `${panel}.getElementById('shelter-staff').value='${value}';${panel}.getElementById('shelter-staff').dispatchEvent(new Event('change'));`;
  const scene = `sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    const original=sm.view.state.rooms[0];
    sm.view.state.rooms=['scrap','power','diner','water','quarters'].map((type,i)=>({...original,id:i+1,type,width:i===0||i===4?3:1,stored:0}));
    const adult=sm.view.state.residents[0];
    sm.view.state.residents=['甲','乙','丙','丁','戊'].map((name,i)=>({...structuredClone(adult),id:i+1,name,roomId:[2,3,4,1,null][i]}));
    for(const p of sm.view.state.residents){p.stats={str:3,per:3,end:3,cha:3,int:3,agi:3,lck:3};}
    sm.view.state.residents[0].stats.str=10;sm.view.state.residents[1].stats.agi=10;
    sm.view.state.residents[2].stats.per=10;sm.view.state.residents[3].stats.end=10;sm.view.state.residents[4].stats.end=8;`;
  const family = `${scene}localStorage.setItem('arkengine:auto-shelter:staff:v1','family');
    sm.view.state.residents.push(...[6,7].map(id=>({...structuredClone(adult),id,name:'家人'+id,roomId:5,
      romance:{partnerId:id===6?7:6,progress:.4}})));`;
  await t.test('避难所弹窗恢复：居民详情标题变化或缺少调岗控件，关闭本轮窗口继续远征',async()=>{
    for(const wrong of ['title','control']){
      await setupShelter(`${scene}sm.quickAssign=false;const open=openResident;window.openResident=id=>{
        open(id);const d=document.querySelector('[data-staff-dialog]');
        ${wrong==='title'?`d.querySelector('h2').textContent='新版居民详情';`:`for(const l of d.querySelectorAll('label'))if(l.textContent.startsWith('调去'))l.remove();`}};`);
      await drive(done,'changed resident dialog '+wrong);assert.deepEqual(await evaluate('sm.calls'),[]);
      assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`document.querySelector('[data-staff-dialog]')`),null);
    }
  });
  await t.test('避难所弹窗恢复：关闭首次未生效时只补一次，持续失败明确暂停并保留窗口',async()=>{
    for(const stuck of [false,true]){
      await setupShelter(`${scene}sm.quickAssign=false;const open=openResident;window.openResident=id=>{
        open(id);const d=document.querySelector('[data-staff-dialog]');d.querySelector('h2').textContent='新版居民详情';
        const b=d.querySelector('button[aria-label="关闭"]'),close=b.onclick;b.onclick=()=>{
          sm.closeAttempts=(sm.closeAttempts||0)+1;if(!${stuck}&&sm.closeAttempts>1)close();};};`);
      if(stuck){
        await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'failed closure stops');
        await pulse(20000);assert.equal(await evaluate('sm.closeAttempts'),2);
        assert.equal(await evaluate(`!!document.querySelector('[data-staff-dialog]')`),true);
      }else{await drive(done,'second close completes');assert.equal(await evaluate('sm.closeAttempts'),2);}
      assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('避难所弹窗恢复：新版居民窗口人工预开或接手后，超时不关闭不调岗',async()=>{
    for(const preopen of [true,false]){
      await setupShelter(`${scene}sm.ui20261109=true;sm.quickAssign=false;${preopen?'openResident(5);':''}`);
      if(!preopen){
        await drive(`!!document.querySelector('[data-staff-dialog]')`,'native staff before manual takeover');
        await evaluate(`document.querySelector('[data-staff-dialog] select').focus()`);await trustedStaffKey();
      }
      await pulse(61000);await pulse(1000);assert.equal(await evaluate(`!!document.querySelector('[data-staff-dialog]')`),true);
      assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('新版UI：居民房间筛选后跨12人分页，忽略亲属图谱分页并按编号上岗',async()=>{
    await setupShelter(`${scene}sm.ui20261109=true;sm.tab='居民';sm.roomFilter='2';
      const p=sm.view.state.residents.pop();
      for(let id=10;id<22;id++)sm.view.state.residents.push({...structuredClone(p),id,name:'儿童'+id,adultAt:clock+9999999});
      sm.view.state.residents.push(p);
      const render=renderShelter;window.renderShelter=()=>{render();if(sm.tab==='居民'){
        const d=document.createElement('details');d.open=true;d.innerHTML='<div aria-label="分页"><button>下一页</button><span>1/2 页 · 共 15 项</span></div>';
        d.querySelector('button').onclick=()=>sm.calls.push({type:'wrong-pager'});document.querySelector('#shelter-content section').append(d);
      }};`);
    await drive(done,'new resident pagination');
    assert.ok(await evaluate(`${moves}.some(a=>a.residentId===5)`));
    assert.equal(await evaluate('sm.calls.some(a=>a.type==="wrong-pager")'),false);
  });
  await t.test('新版UI：完全同名同级同属性同岗位由居民编号消歧，错误详情编号不发送',async()=>{
    for(const wrong of [false,true]){
      await setupShelter(`${scene}sm.ui20261109=true;sm.quickAssign=false;
        sm.view.state.residents.push({...structuredClone(sm.view.state.residents[4]),id:6});
        ${wrong?`const open=openResident;window.openResident=id=>open(id===5?6:5);`:''}`);
      if(wrong){await drive(`Boolean(document.querySelector('[data-staff-dialog]'))`,'wrong id dialog');await pulse(10000);assert.deepEqual(await evaluate('sm.calls'),[]);}
      else {await drive(done,'native id identity');assert.ok(await evaluate(`${moves}.some(a=>a.residentId===5)`));}
    }
  });
  await t.test('快捷调岗：列表直接上岗与旧详情回退结果相同，省去详情开关且刷新不重发',async()=>{
    for(const quick of [false,true]){
      await setupShelter(`${scene}sm.ui20261109=true;sm.quickAssign=${quick};sm.fixtureSearch=location.search;`);
      await drive(done,'quick assign '+quick,150);
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[5,1]]);
      assert.equal(await evaluate('sm.residentOpens||0'),quick?0:1);
      assert.equal(await evaluate(pending),null);
      await pulse(1000);await evaluate(`history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
      await reloadShelter();await drive(done,'quick assign refresh',150);
      assert.equal(await evaluate(`${moves}.length`),1);
    }
  });
  await t.test('快捷调岗：错误编号控件回退详情，错误原生请求不发送',async()=>{
    for(const badRequest of [false,true]){
      await setupShelter(`${scene}sm.ui20261109=true;
        const render=renderShelter;window.renderShelter=()=>{render();
          const select=document.querySelector('select[aria-label="调动 #5 戊"]');if(!select)return;
          ${badRequest?`select.onchange=()=>shelterAct({type:'assign',residentId:4,roomId:1});`:
            `select.setAttribute('aria-label','调动 #4 戊');`}
        };`);
      if(badRequest){await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'wrong quick request rejected');assert.deepEqual(await evaluate('sm.calls'),[]);}
      else {await drive(done,'bad quick identity fallback',150);assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[5,1]]);assert.equal(await evaluate('sm.residentOpens'),1);}
    }
  });
  await t.test('快捷调岗：未知结果跨刷新保留原请求，不重发也不打开详情补发',async()=>{
    await setupShelter(`${scene}sm.ui20261109=true;sm.assignUnknown=true;`);
    await drive(`${moves}.length===1`,'quick unknown submitted');await pulse(35000);
    await reloadShelter();await drive(done,'quick unknown refresh',150);
    assert.equal(await evaluate(`${moves}.length`),1);assert.equal(await evaluate('sm.residentOpens||0'),0);
    assert.equal(await evaluate(`${pending}?.kind`),'assign');
  });
  await t.test('快捷调岗：排队后目标满员或关闭管理，重读后取消原调岗',async()=>{
    for(const full of [false,true]){
      await setupShelter(`${scene}sm.ui20261109=true;`);
      await drive(`${panel}.getElementById('status').textContent.includes('列表快捷调岗')`,'quick assign queued');
      await evaluate(full?`sm.view.state.rooms[0].width=1;sm.view.state.residents.push({...structuredClone(sm.view.state.residents[3]),id:9,name:'填满岗位',roomId:1});`:mode('off'));
      await drive(done,'quick assign cancelled',150);assert.deepEqual(await evaluate(moves),[]);
      assert.equal(await evaluate('sm.residentOpens||0'),0);
    }
  });
  await t.test('最新接替浏览器：历史场景岗位不足且建设暂停，保留家庭记录并等待补岗',async()=>{
    const latest=latestFamilyScene('agi');
    await setupShelter(`sm.view=${JSON.stringify(latest.view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.confirmFamily=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','50');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(latest.state)},vaultNo:77,nextAt:0,note:'历史缺岗场'}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:false,upgrade:false,dig:false,scrapLimit:0,partsLimit:0,scrapReserve:100,partsReserve:0}));`);
    await drive(done,'paused construction does not invent family employment',200);
    assert.equal(await evaluate(`${moves}.some(c=>[56,84].includes(c.residentId)&&c.roomId===8)`),false);
    assert.ok(await evaluate(`${state}.families.some(f=>f.a===56&&f.b===84&&f.room===8)`));
    assert.match(await evaluate(`${state}.populationEvaluation.note`),/岗位/);
    assert.equal(await evaluate('sm.view.state.rooms.length'),latest.view.state.rooms.length);
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0);
  });
  await t.test('最新接替浏览器：重名子女就业、原家庭返宿舍与网站确认，刷新不重复调岗',async()=>{
    const latest=latestFamilyScene('agi');
    // Explicit job-ready counterfactual, matching the core family test. The
    // historical no-job state is tested separately, without invented capacity.
    latest.view.state.rooms.push({...latest.view.state.rooms.find(r=>r.type==='scrap'),id:9000,floor:5,col:5,width:2,level:1,stored:0});
    await setupShelter(`sm.view=${JSON.stringify(latest.view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.confirmFamily=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','50');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(latest.state)},vaultNo:77,nextAt:0,note:'最新诊断接替场'}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:false,upgrade:false,dig:false,scrapLimit:0,partsLimit:0,scrapReserve:100,partsReserve:0}));`);
    const confirmed=`[56,84].every(id=>{const p=sm.view.state.residents.find(p=>p.id===id);return p.roomId===8&&p.romance?.partnerId===(id===56?84:56);})`;
    await drive(confirmed,'latest family confirmation',400);
    await drive(done,'latest family visit completes',400);
    assert.notEqual(await evaluate(`sm.view.state.residents.find(p=>p.id===103).roomId`),8);
    assert.deepEqual(await evaluate(`${moves}.filter(c=>[56,84].includes(c.residentId)&&c.roomId===8).map(c=>c.residentId).sort((a,b)=>a-b)`),[56,84]);
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig','rush','rename','retire','caravan'].includes(c.type)).length`),0);
    await pulse(1000);
    const completed=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
    await evaluate(`history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
    await reloadShelter();await drive(done,'confirmed family after refresh',400);
    const after=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
    assert.deepEqual(after.slice(0,completed.length),completed);
    for(const [id,room] of completed)assert.equal(after.filter(([a,b])=>a===id&&b===room).length,1,
      '刷新可继续其余就业，但不重复已完成请求');
    assert.equal(await evaluate(confirmed),true);
  });
  await t.test('最新家庭就业浏览器：待产父母进入建设人手，支付补岗成本，完工刷新后就业',async()=>{
    const latest=latestFamilyScene('agi');
    // Start after an explicitly confirmed pregnancy and supply replacement.
    // This tests existing parents' employment, not admission of a new family
    // with missing jobs (covered separately above).
    for(const id of [35,103])latest.view.state.residents.find(p=>p.id===id).roomId=110;
    for(const id of [56,84])Object.assign(latest.view.state.residents.find(p=>p.id===id),{
      roomId:8,romance:null,familyCooldownUntil:latest.view.serverTime+21600000});
    latest.view.state.births.push({roomId:8,parents:[56,84],dueAt:latest.view.serverTime+10800000});
    await setupShelter(`sm.view=${JSON.stringify(latest.view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
      sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.simulateResources=true;
      sm.resourceInitial=structuredClone(sm.view.state.resources);
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','32');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(latest.state)},vaultNo:77,nextAt:0,note:'最新家庭完整接续'}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:false,dig:false,budgetMode:'daily',scrapLimit:176,partsLimit:100,scrapReserve:100,partsReserve:0}));`);
    for(let visit=0;visit<5;visit++){
      await drive(done,'parent employment construction visit',500);
      if(await evaluate(`sm.calls.some(c=>c.type==='build')`))break;
      await evaluate(check);await drive(`location.pathname==='/shelter'`,'continue employment build');
    }
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build').length`),1,JSON.stringify(await evaluate(`({calls:sm.calls,development:${state}.development,population:${state}.populationEvaluation,people:sm.view.state.residents.map(p=>[p.id,p.roomId])})`)));
    assert.equal(await evaluate(`sm.calls.find(c=>c.type==='build').room`),'scrap');
    const room=await evaluate('sm.view.state.rooms.at(-1)'),paid=await evaluate(`${state}.constructionLedger.reduce((n,e)=>n+e.scrap,0)`);
    assert.equal(paid,176,'80 * (1 + .2 * six existing scrap columns)');
    assert.equal(await evaluate(`sm.view.state.residents.some(p=>p.roomId===${room.id})`),false);
    await pulse(Math.max(1000,room.builtAt-await evaluate('clock')));
    await evaluate(`const score=2*sm.view.state.residents.length+3*sm.view.state.depth+sm.view.state.rooms.filter(r=>r.builtAt<=clock&&!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
      sm.view.progress={score,level:1+Math.floor(Math.sqrt(Math.max(0,score-30))/1.5)};
      history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
    await reloadShelter();
    const employed=`[56,84].every(id=>{const p=sm.view.state.residents.find(p=>p.id===id);return sm.view.state.rooms.some(r=>r.id===p.roomId&&['power','diner','water','scrap'].includes(r.type));})`;
    for(let visit=0;visit<6;visit++){
      await drive(done,'parent employment after construction',500);if(await evaluate(employed))break;
      await evaluate(check);await drive(`location.pathname==='/shelter'`,'continue parent return');
    }
    assert.equal(await evaluate(employed),true,JSON.stringify(await evaluate(`({calls:sm.calls,
      state:${state},pending:${pending},people:sm.view.state.residents.map(p=>({id:p.id,room:p.roomId,romance:p.romance})),
      rooms:sm.view.state.rooms.map(r=>({id:r.id,type:r.type,width:r.width,level:r.level,builtAt:r.builtAt})),clock,
      status:${panel}.getElementById('shelter-staff-status').textContent})`)));
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build').length`),1,'refresh does not repeat paid project');
    const resources=await evaluate(`({initial:sm.resourceInitial,ledger:sm.resourceLedger,ending:sm.view.state.resources})`);
    const first=resources.initial;
    for(const key of Object.keys(first)){
      const net=resources.ledger.reduce((n,e)=>n+e.collected[key]-e.consumed[key]-e.feed[key],0);
      assert.ok(Math.abs(first[key]+net-(key==='scrap'?paid:0)-resources.ending[key])<1e-7,key+' includes real costs and production');
    }
    assert.ok(resources.ledger.some(e=>e.ticks>0&&e.produced.food>0),'time advance must produce real room inventory');
    assert.ok(resources.ledger.some(e=>e.collected.food>0),'whole food batches are actually collected');
    assert.equal(await evaluate(pending),null,'collection and assignments must be reconciled');
    assert.equal(await evaluate('sm.view.state.births.length'),3);
    assert.equal(await evaluate(`sm.calls.filter(c=>['rush','caravan','rename','retire'].includes(c.type)).length`),0);
  });
  await t.test('运行修复浏览器：居民窗口跨过访问时限时完成当前调岗，刷新不重复同一目标',async()=>{
    await setupShelter(scene+`sm.quickAssign=false;sm.visitStart=clock;sm.fixtureSearch=location.search;
      const originalData=shelterData;window.shelterData=()=>{if(!sm.lateRead){sm.lateRead=true;clock+=285000;}return originalData();};`);
    await drive(`!!document.querySelector('[data-staff-dialog]')`,'late resident dialog');
    await pulse(await evaluate('sm.visitStart+302000-clock'));await drive(done,'finish current resident move');
    assert.equal(await evaluate(`${moves}.length`),1);assert.equal(await evaluate(pending),null);
    const original=await evaluate(`${moves}[0]`);
    await pulse(1000);
    await evaluate(`history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);await reloadShelter();
    await drive(done,'no replay after staff refresh');
    assert.equal(await evaluate(`${moves}.filter(c=>c.residentId===${original.residentId}&&c.roomId===${original.roomId}).length`),1);
  });
  await t.test('发展供应准备：生产模式先备好儿童成年、外出归来、恢复及待产口粮，再增加废料',async()=>{
    for(const extra of [
      `sm.view.state.residents.push(...[6,7].map(id=>({...structuredClone(adult),id,name:'儿童'+id,roomId:5,adultAt:clock+3600000})));`,
      `sm.view.state.residents.push(...[6,7].map(id=>({...structuredClone(adult),id,name:'外出'+id,roomId:null,away:{kind:'explore'}})));`,
      `sm.view.state.residents.push(...[6,7].map(id=>({...structuredClone(adult),id,name:'待恢复'+id,roomId:null,deadAt:clock-1000,hp:0})));`,
      `sm.view.state.births=[{id:1,roomId:5,dueAt:clock+3600000},{id:2,roomId:5,dueAt:clock+7200000}];`
    ]){
      await setupShelter(`${scene}sm.view.state.residents[1].stats.agi=5;sm.view.state.residents[4].stats.agi=10;${extra}`);
      const fixtureSearch=await evaluate('location.search');
      await drive(done,'prepare future food before scrap',200);
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])[0]`),[5,3]);
      const diagnostic=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-check').at(-1).data`);
      assert.equal(diagnostic.plannedDemand.food,7);assert.ok(diagnostic.demand.food<7,'当前消耗与未来预留分别记录');
      assert.ok(await evaluate(`sm.view.state.residents.filter(p=>p.roomId===3&&p.deadAt===null&&p.away===null&&p.adultAt<=clock)
        .slice(0,2).reduce((sum,p)=>sum+8*(.5+p.stats.agi/10),0)>=7*1.2`));
      const count=await evaluate(`${moves}.length`);await evaluate(check);await drive(`location.pathname==='/shelter'`,'revisit with future food reserved');
      await evaluate(`history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
      await reloadShelter();await drive(done,'future food remains reserved',160);
      assert.equal(await evaluate(`${moves}.length`),count);
    }
  });
  await t.test('发展供应准备：预留已在建房间的完工耗电，不能把未来供电人手先派去回收',async()=>{
    await setupShelter(`${scene}sm.view.state.residents[4].stats.str=17;
      sm.view.state.rooms.push({...original,id:6,type:'workshop',width:3,level:3,builtAt:clock+3600000});`);
    await drive(done,'prepare committed construction power',200);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])[0]`),[5,2]);
  });
  await t.test('避难所页签等待：居民页签晚到后继续调岗，不提前停止本轮人员管理',async()=>{
    await setupShelter(`${scene}sm.delayedStaff=true;const originalRender=renderShelter;window.renderShelter=()=>{originalRender();
      if(sm.delayedStaff)[...game.querySelectorAll('[role="tablist"] button')].find(b=>b.textContent==='居民')?.remove();};`);
    await until(async()=>/等待避难所.*居民.*页签/.test(await expStatus()),'resident tab pending');
    await pulse(5000);assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate('sm.delayedStaff=false;renderShelter();');await drive(done,'staff continues when tab appears');
    assert.ok(await evaluate(`${moves}.length>0`));
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-staff-held').length`),0);
  });
  const recoveringFamily = `${family}sm.confirmFamily=true;
    sm.view.state.residents.filter(p=>p.id<6).forEach(p=>p.familyCooldownUntil=clock+86400000);
    sm.view.state.residents.filter(p=>p.id>=6).forEach(p=>{p.romance=null;p.roomId=1;});
    Object.assign(sm.view.state.residents.find(p=>p.id===6),{deadAt:clock-60000,hp:0});
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'原家庭分散生产',vaultNo:77,families:[{a:6,b:7,room:5}]}));`;

  await t.test('避难所请求绑定：调岗的居民或目标房间变化时不发送，保留原安排记录',async()=>{
    for(const change of [`residentId:1`,`roomId:5`]){
      await setupShelter(`${scene}window.shelterTransport=(u,o)=>{const body=JSON.parse(o.body);
        return fetch(u,{...o,body:JSON.stringify({...body,action:{...body.action,${change}}})});};`);
      await drive(`${pending}!==null`,'assignment reserved');await pulse(3000);
      assert.deepEqual(await evaluate('sm.calls'),[]);
      assert.deepEqual(await evaluate(`${pending}.targets`),[5,1]);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'false');
    }
  });

  await t.test('原家庭恢复：家人倒下时两种生育模式均保留记录，跨刷新后救回可重新成对返宿舍',async()=>{
    for(const staffMode of ['family','population']){
      await setupShelter(`${recoveringFamily}localStorage.setItem('arkengine:auto-shelter:staff:v1','${staffMode}');`);
      const fixtureSearch=await evaluate('location.search');
      await drive(done,'original family waits for recovery',200);
      assert.deepEqual(await evaluate(`${state}.families`),[{a:6,b:7,room:5}]);
      assert.equal(await evaluate(`${moves}.some(c=>c.residentId===6||[6,7].includes(c.residentId)&&c.roomId===5)`),false);
      assert.match(await evaluate(`${state}.operations`),/家人6.*倒下.*24.*分钟/);
      assert.ok(await evaluate(`${state}.nextAt-clock<=302000`));
      await pulse(1000);
      await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
      await reloadShelter();await drive(done,'down family remains after reload',200);
      assert.deepEqual(await evaluate(`${state}.families`),[{a:6,b:7,room:5}]);
      await evaluate(`Object.assign(sm.view.state.residents.find(p=>p.id===6),{deadAt:null,hp:100});${check}`);
      await drive(`location.pathname==='/shelter'`,'family member recovered');await drive(done,'resume original family',200);
      assert.deepEqual(await evaluate(`${moves}.filter(c=>[6,7].includes(c.residentId)&&c.roomId===5).map(c=>c.residentId)`),[6,7]);
      assert.deepEqual(await evaluate(`${state}.families`),[{a:6,b:7,room:5}]);
      assert.equal(await evaluate(`sm.calls.some(c=>['revive','bury'].includes(c.type))`),false);
    }
  });
  await t.test('原家庭恢复：一人倒下后不把尚无子女的另一人重新配给其他成人',async()=>{
    await setupShelter(`${recoveringFamily}localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      sm.view.state.residents.find(p=>p.id===7).roomId=null;
      sm.view.state.residents.push({...structuredClone(adult),id:8,name:'新居民',roomId:null,romance:null});`);
    await drive(done,'retain family rather than replace down partner',200);
    assert.equal(await evaluate(`${moves}.some(c=>c.residentId===7&&c.roomId===5)`),false);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===7).romance'),null);
    assert.deepEqual(await evaluate(`${state}.families`),[{a:6,b:7,room:5}]);
  });
  await t.test('原家庭恢复：居民已不在状态中或已有其他明确关系时，仍清除失效的旧家庭',async()=>{
    for(const changed of ['sm.view.state.residents=sm.view.state.residents.filter(p=>p.id!==6);',
      'sm.view.state.residents.find(p=>p.id===7).romance={partnerId:4,progress:.1};']){
      await setupShelter(`${recoveringFamily}${changed}`);await drive(done,'discard obsolete family',200);
      assert.equal(await evaluate(`${state}.families.some(f=>f.a===6&&f.b===7)`),false);
      assert.equal(await evaluate(`${moves}.some(c=>c.residentId===6)`),false);
    }
  });

  await t.test('生育心情：原配对在两种生育模式下都等两人达到50再返宿舍',async()=>{
    for(const staffMode of ['family','population']){
      await setupShelter(`${family}localStorage.setItem('arkengine:auto-shelter:staff:v1','${staffMode}');sm.confirmFamily=true;
        sm.view.state.residents.filter(p=>p.id>=6).forEach(p=>{p.romance=null;p.roomId=1;});
        sm.view.state.residents.find(p=>p.id===6).happiness=49;
        localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'已记录配对',vaultNo:77,families:[{a:6,b:7,room:5}]}));`);
      await drive(done,'existing family below happiness threshold',200);
      assert.equal(await evaluate(`${moves}.some(c=>[6,7].includes(c.residentId)&&c.roomId===5)`),false);
      await evaluate(`sm.view.state.residents.find(p=>p.id===6).happiness=50;${check}`);
      await drive(`location.pathname==='/shelter'`,'recheck existing family after happiness recovery');await drive(done,'existing family returns',200);
      assert.deepEqual(await evaluate(`${moves}.filter(c=>[6,7].includes(c.residentId)&&c.roomId===5).map(c=>c.residentId)`),[6,7]);
    }
  });

  await t.test('人员管理：闲置成人按耐力上岗，保留基础供应且不空逛奖励页',async()=>{
    await setupShelter(scene);await drive(done,'idle adult assigned',150);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[5,1]]);
    assert.deepEqual(await evaluate('sm.view.state.residents.slice(0,3).map(p=>p.roomId)'),[2,3,4]);
    assert.deepEqual(await evaluate('sm.tabs'),['居民']);
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`),false);
  });
  await t.test('人员管理：先补净水岗位，禁止从不足的其他基础岗位抽人',async()=>{
    await setupShelter(`${scene}sm.view.state.residents[2].roomId=1;`);await drive(done,'water deficit fixed',150);
    const calls=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
    // An idle adult fills the actual shortage first; no productive resident
    // needs to move merely to maximize water while the safety margin is met.
    assert.deepEqual(calls,[[5,4]]);
    assert.equal(await evaluate('sm.view.state.residents[2].roomId'),1);
    assert.ok(await evaluate('8*(.5+sm.view.state.residents[4].stats.per/10)>=sm.view.state.residents.length*1.2'));
    assert.equal(await evaluate('sm.view.state.residents[0].roomId'),2);assert.equal(await evaluate('sm.view.state.residents[1].roomId'),3);
  });
  await t.test('人员管理：基础岗位有足够余量时可调往回收站，下一轮不反复调岗',async()=>{
    await setupShelter(`${scene}sm.view.state.residents[4].roomId=3;`);await drive(done,'surplus moved',150);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[5,1]]);
    await evaluate(check);await drive('location.pathname==="/shelter"','next visit');await drive(done,'stable placement');
    assert.equal(await evaluate(`${moves}.length`),1);
  });
  await t.test('人员管理额外驻留：按容量内实际产出判断调岗，额外成人可补空岗且离岗后有人接替',async()=>{
    for(const expected of [6,2]){
      await setupShelter(`${scene}sm.view.state.residents[4].roomId=3;sm.view.state.residents[4].stats.end=0;
        sm.view.state.residents.push({...structuredClone(adult),id:6,name:'额外成人',roomId:3,
          stats:{str:3,per:3,end:10,cha:3,int:3,agi:0,lck:3}});
        sm.view.state.residents.filter(p=>p.roomId===3).forEach(p=>p.stats.agi=0);
        ${expected===2?'sm.view.state.residents[1].stats.end=17;':`sm.view.state.rooms.find(r=>r.id===3).incident={kind:'fire'};`}`);
      if(expected===6){
        await drive(done,'incident occupants stay until room recovers');assert.deepEqual(await evaluate(moves),[]);
        await evaluate(`sm.view.state.rooms.find(r=>r.id===3).incident=null;${check}`);
        await drive(`location.pathname==='/shelter'`,'room recovered after incident');
      }
      await drive(done,'overflow workers allocated without losing food supply',180);
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[expected,1]]);
      assert.equal(await evaluate(`sm.view.state.residents.filter(p=>p.roomId===3).length`),2);
      assert.equal(await evaluate(`sm.view.state.residents.filter(p=>p.roomId===3).slice(0,2).reduce((n,p)=>n+8*(.5+p.stats.agi/10),0)`),8);
      await evaluate(check);await drive(`location.pathname==='/shelter'`,'revisit after excess adult leaves');await drive(done,'placement stays stable');
      assert.equal(await evaluate(`${moves}.length`),1);
    }
  });
  await t.test('人员管理额外驻留：已有供应缺口时允许不减产的调岗，利用另一间空房补足同类供应',async()=>{
    await setupShelter(`${scene}sm.view.state.residents[4].roomId=3;sm.view.state.residents[3].stats.agi=0;
      sm.view.state.residents.push({...structuredClone(adult),id:6,name:'额外成人',roomId:3});
      sm.view.state.residents.filter(p=>p.roomId===3).forEach(p=>p.stats.agi=0);
      sm.view.state.residents.push(...[7,8].map(id=>({...structuredClone(adult),id,name:'保护家人'+id,roomId:5,
        romance:{partnerId:id===7?8:7,progress:.1}})));
      sm.view.state.rooms.push({...original,id:6,type:'diner',width:1,stored:0});`);
    await drive(done,'spread excess adults across food rooms',180);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[2,6]]);
    assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>[3,6].includes(p.roomId)).map(p=>[p.id,p.roomId])`),[[2,6],[5,3],[6,3]]);
    assert.equal(await evaluate(`sm.view.state.residents.filter(p=>[3,6].includes(p.roomId)).reduce((n,p)=>n+8*(.5+p.stats.agi/10),0)`),12);
  });
  await t.test('人员管理额外驻留：外出、倒下或未成年者不能当作离岗后的生产替补',async()=>{
    for(const change of [`p.away={kind:'explore'}`,`p.deadAt=clock-60000;p.hp=0`,`p.adultAt=clock+3600000`]){
      await setupShelter(`${scene}sm.view.state.residents[4].roomId=3;
        sm.view.state.residents.push({...structuredClone(adult),id:6,name:'不可生产者',roomId:3});
        sm.view.state.residents.filter(p=>p.roomId===3).forEach(p=>p.stats.agi=0);
        const p=sm.view.state.residents.find(p=>p.id===6);${change};`);
      await drive(done,'unavailable resident cannot replace a producer',180);
      assert.deepEqual(await evaluate(moves),[],change);
      assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>p.roomId===3).map(p=>p.id)`),[2,5,6]);
    }
  });
  await t.test('人员管理额外驻留：先落实有效岗位，再按实际替补产出轮换原家庭',async()=>{
    for(const [replacements,ready] of [[1,false],[2,false],[2,true]]){
      await setupShelter(`${scene}localStorage.setItem('arkengine:auto-shelter:staff:v1','family');sm.confirmFamily=true;
        sm.view.state.residents[4].roomId=3;
        sm.view.state.residents.push(...[6,7].slice(0,${replacements}).map(id=>({...structuredClone(adult),id,name:'接替居民'+id,roomId:3})));
        sm.view.state.residents.filter(p=>p.roomId===3).forEach(p=>p.stats.agi=2);
        if(${ready})sm.view.state.rooms.find(r=>r.id===3).width=2;
        localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'原家庭待轮换',vaultNo:77,families:[{a:2,b:5,room:5}]}));`);
      await drive(done,'original family checks actual replacement count',200);
      if(!ready){
        assert.deepEqual(await evaluate(`${moves}.filter(c=>c.roomId===5)`),[]);
        assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===2).romance`),null);
      }else{
        assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[2,5],[5,5]]);
        assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>p.roomId===3).map(p=>p.id)`),[6,7]);
        assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===2).romance?.partnerId`),5);
      }
    }
  });
  await t.test('人员管理额外驻留：原家庭按安全顺序返宿舍，不能只保证两人都离岗后的产量',async()=>{
    for(const staffMode of ['family','population']){
      await setupShelter(`${scene}localStorage.setItem('arkengine:auto-shelter:staff:v1','${staffMode}');sm.confirmFamily=true;
        sm.view.state.residents[4].roomId=3;sm.view.state.residents[4].stats.agi=0;
        sm.view.state.residents.push(...[6,7].map(id=>({...structuredClone(adult),id,name:'接替居民'+id,roomId:3,hp:id===6?50:100,
          stats:{str:3,per:3,end:3,cha:3,int:3,agi:id===6?0:10,lck:3}})));
        localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'原家庭待轮换',vaultNo:77,families:[{a:2,b:5,room:5}]}));`);
      await drive(done,'parents leave in an order that preserves current food supply',200);
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[5,1],[2,1],[2,5],[5,5]],staffMode);
      assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===2).romance?.partnerId'),5);
      const residents=await evaluate('sm.view.state.residents');
      for(const positions of await evaluate('sm.snapshots')){
        const food=positions.filter(p=>p.room===3).slice(0,2).reduce((n,p)=>n+8*(.5+residents.find(r=>r.id===p.id).stats.agi/10),0);
        assert.ok(food>=8.4-1e-9,`${staffMode} current food ${food}`);
      }
    }
  });
  await t.test('人员管理：成年前保留儿童，成年后自动上岗',async()=>{
    await setupShelter(`${scene}sm.view.state.residents[4].adultAt=clock+60000;sm.view.state.residents[4].parents=[1,2];sm.view.state.residents[4].roomId=5;`);
    await drive(done,'child remains');assert.equal(await evaluate(`${moves}.length`),0);
    await pulse(65000);await drive(`${moves}.length===1 && ${done}`,'adult joins workforce',150);
    assert.equal(await evaluate('sm.view.state.residents[4].roomId'),1);
  });
  await t.test('人员管理：培养感情与待产房间保持原安排',async()=>{
    await setupShelter(`${family}sm.view.state.births=[{id:1,roomId:5,dueAt:clock+60000}];`);
    await drive(done,'birth protected',150);
    assert.ok(await evaluate(`${moves}.every(c=>c.residentId!==6&&c.residentId!==7)`));
    assert.deepEqual(await evaluate(`${state}.families`),[{a:6,b:7,room:5}]);
  });
  await t.test('规则纠正浏览器：父母身份明确时怀孕后立即回生产，未知父母仍保留待产房间',async()=>{
    await setupShelter(`${family}sm.view.state.residents.filter(p=>p.id>=6).forEach(p=>{p.romance=null;p.familyCooldownUntil=clock+6*3600000;});
      sm.view.state.births=[{id:1,roomId:5,parents:[6,7],dueAt:clock+3*3600000}];`);
    await drive(done,'parents work during pregnancy',200);
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[6,7].includes(p.id)).map(p=>p.roomId)'),[1,1]);
    assert.deepEqual(await evaluate(`${state}.families`),[{a:6,b:7,room:5}]);
    assert.equal(await evaluate('sm.view.state.births.length'),1);assert.equal(await evaluate(pending),null);
    await setupShelter(`${family}sm.view.state.births=[{id:1,roomId:5,dueAt:clock+3*3600000}];`);
    await drive(done,'unidentified pregnancy preserved',200);assert.ok(await evaluate(`${moves}.every(c=>![6,7].includes(c.residentId))`));
  });
  await t.test('人员管理：已有配对从待产到生产，再在冷却结束后成对返回宿舍',async()=>{
    await setupShelter(family);await drive(done,'remember existing family',150);
    await evaluate(`sm.view.state.residents.filter(p=>p.id>=6).forEach(p=>{p.romance=null;p.familyCooldownUntil=clock+3600000;});
      sm.view.state.births=[{id:1,roomId:5,dueAt:clock+1000}];${check};`);
    await drive(`location.pathname==='/shelter'`,'pending birth visit');await drive(done,'birth kept');
    assert.equal(await evaluate(`${moves}.filter(c=>c.residentId>=6).length`),0);
    await evaluate(`sm.view.state.births=[];sm.view.state.residents.push({...structuredClone(sm.view.state.residents[0]),
      id:8,name:'宝宝',parents:[6,7],roomId:5,adultAt:clock+10800000,romance:null,familyCooldownUntil:0});${check};`);
    await drive(`location.pathname==='/shelter'`,'post birth visit');await drive(done,'parents produce in cooldown',180);
    assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>[6,7].includes(p.id)).map(p=>p.roomId)`),[1,1]);
    await pulse(3600000);await drive(`location.pathname==='/shelter'`,'cooldown due');await drive(done,'family returns',180);
    assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>[6,7].includes(p.id)).map(p=>p.roomId)`),[5,5]);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===8).roomId`),5);
    assert.deepEqual(await evaluate(`${moves}.filter(c=>[6,7].includes(c.residentId)).map(c=>[c.residentId,c.roomId])`),[[6,1],[7,1],[6,5],[7,5]]);
  });
  await t.test('人员管理：供应或人口容量不足时原配对留在生产岗位',async()=>{
    for(const constraint of [`sm.view.state.rooms[4].width=1;`,`sm.view.state.resources.food=0;`]){
      await setupShelter(`${family}sm.view.state.residents.filter(p=>p.id>=6).forEach(p=>{p.romance=null;p.roomId=1;});
        localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'已记录配对',vaultNo:77,families:[{a:6,b:7,room:5}]}));${constraint}`);
      await drive(done,'family return constrained',150);
      assert.ok(await evaluate(`${moves}.every(c=>c.roomId!==5)`));
    }
  });
  await t.test('人员管理：伤员、外出人员和特殊岗位不自动接管',async()=>{
    for(const patch of [`p.hp=10;`,`p.away={kind:'explore'};`,`p.deadAt=clock;`,
      `sm.view.state.rooms.push({...sm.view.state.rooms[0],id:6,type:'training'});p.roomId=6;`]){
      await setupShelter(`${scene}const p=sm.view.state.residents[4];${patch}`);await drive(done,'protected resident');
      assert.equal(await evaluate(`${moves}.length`),0);
    }
  });
  await t.test('组合身份：同名不同级、同级不同属性和同属性不同房间均定位正确居民',async()=>{
    for(const patch of [`p.xp=27;`,``,
      `p.stats=structuredClone(sm.view.state.residents[3].stats);`]){
      await setupShelter(`${scene}sm.ui20261109=false;const p=sm.view.state.residents[4];p.name='丁';${patch}`);
      await drive(done,'composite resident identity',180);
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[5,1]],patch);
      assert.equal(await evaluate(`sm.view.state.residents[3].roomId`),1);
    }
  });
  await t.test('组合身份：同名同级同属性同岗位仍有歧义时不打开窗口或提交',async()=>{
    await setupShelter(`${scene}sm.ui20261109=false;const p=sm.view.state.residents[4],q=sm.view.state.residents[3];
      p.name=q.name;p.stats=structuredClone(q.stats);q.roomId=null;`);
    await drive(done,'ambiguous identical residents',180);
    assert.equal(await evaluate(`${moves}.length`),0);
    assert.equal(await evaluate(`document.querySelector('[data-staff-dialog]')`),null);
  });
  await t.test('组合身份：原生详情打开错误同名居民时不发送调岗',async()=>{
    await setupShelter(`${scene}sm.ui20261109=false;const p=sm.view.state.residents[4];p.name='丁';
      const open=openResident;window.openResident=id=>open(id===5?4:id);`);
    await drive(`!!document.querySelector('[data-staff-dialog]')`,'wrong same-name dialog');
    for(let i=0;i<8;i++)await pulse(10000);
    assert.equal(await evaluate(`${moves}.length`),0);
    assert.equal(await evaluate(`sm.view.state.residents[4].roomId`),null);
  });
  await t.test('组合身份：排队期间详情属性被替换时取消提交',async()=>{
    await setupShelter(`${scene}sm.ui20261109=false;sm.view.state.residents[4].name='丁';`);
    await drive(`!!document.querySelector('[data-staff-dialog]') && ${panel}.getElementById('status').textContent.includes('随机等待')`,'identity checked before queue');
    await evaluate(`document.querySelector('[data-staff-dialog] ul[aria-label="属性"]').children[2].lastElementChild.textContent='10';`);
    for(let i=0;i<8;i++)await pulse(10000);
    assert.equal(await evaluate(`${moves}.length`),0);
  });
  await t.test('人员管理：调岗等待期间目标满员，取消旧岗位变更',async()=>{
    await setupShelter(scene+'sm.quickAssign=false;');
    await drive(`!!document.querySelector('[data-staff-dialog]') && ${panel}.getElementById('status').textContent.includes('随机等待')`,'assignment queued');
    await evaluate(`sm.view.state.rooms[0].width=1;sm.view.state.residents.push({...structuredClone(sm.view.state.residents[3]),id:9,name:'填满岗位',roomId:1});`);
    await drive(done,'capacity changes cancel assign',150);assert.equal(await evaluate(`${moves}.length`),0);
  });
  await t.test('人员管理：切回手动模式时撤销排队调岗，只关闭脚本自己的窗口',async()=>{
    await setupShelter(scene+'sm.quickAssign=false;');
    await drive(`!!document.querySelector('[data-staff-dialog]') && ${panel}.getElementById('status').textContent.includes('随机等待')`,'assignment queued');
    await evaluate(mode('off'));await drive(done,'manual staff mode');assert.equal(await evaluate(`${moves}.length`),0);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]')`),null);
  });
  await t.test('人员管理：手动打开的居民详情不会被接管',async()=>{
    await setupShelter(`${scene}openResident(5);`);for(let i=0;i<3;i++)await pulse(10000);
    assert.equal(await evaluate('sm.reads'),0);assert.equal(await evaluate(`${moves}.length`),0);
    assert.equal(await evaluate(`document.querySelector('[data-staff-dialog]').dataset.staffDialog`),'5');
  });
  await t.test('人员管理：真实键盘接管窗口后不调岗、不自动关闭',async()=>{
    await setupShelter(scene+'sm.quickAssign=false;');
    await drive(`!!document.querySelector('[data-staff-dialog]') && ${panel}.getElementById('status').textContent.includes('随机等待')`,'script dialog ready');
    await evaluate(`document.querySelector('[data-staff-dialog] select').focus()`);await trustedStaffKey();
    for(let i=0;i<3;i++)await pulse(5000);
    assert.equal(await evaluate(`${moves}.length`),0);assert.ok(await evaluate(`!!document.querySelector('[data-staff-dialog]')`));
    await evaluate('closeResident()');await drive(done,'user closed dialog');assert.equal(await evaluate(`${moves}.length`),0);
  });
  await t.test('人员管理：详情刚打开就关闭自动管理，仍能退出自己的窗口',async()=>{
    await setupShelter(`${scene}sm.quickAssign=false;const open=openResident;window.openResident=id=>{open(id);${mode('off')}};`);
    await drive(done,'mode changed while opening',150);assert.equal(await evaluate(`${moves}.length`),0);
    assert.equal(await evaluate('sm.residentOpens'),1);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]')`),null);
  });
  await t.test('人员管理：居民升级后仍核对同一人并关闭自己的窗口',async()=>{
    await setupShelter(`${scene}sm.quickAssign=false;const act=shelterAct;window.shelterAct=async a=>{const result=await act(a);if(a.type==='assign'){
      const p=sm.view.state.residents.find(p=>p.id===a.residentId);p.xp=3;document.querySelector('[data-staff-dialog] h2').textContent=p.name+' · 2 级';}return result;};`);
    await drive(done,'level changed during assign',150);assert.equal(await evaluate(`${moves}.length`),1);
    assert.equal(await evaluate('sm.residentOpens'),1);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]')`),null);
  });
  await t.test('人员管理：未知调岗跨刷新保留记录，不重复提交或影响远征开关',async()=>{
    await setupShelter(`${scene}sm.assignUnknown=true;`);await drive(`${moves}.length===1`,'unknown assignment');
    await reloadShelter();await drive(`${done}&&localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='true'&&${pending}!==null&&${state}.pendingReadOnly===${pending}.id`,'unknown isolated');
    assert.equal(await evaluate(`${moves}.length`),1);assert.equal(await evaluate(`${pending}.kind`),'assign');
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('人员管理：岗位已变更的旧记录只核对，不再提交',async()=>{
    await setupShelter(`${scene}sm.view.state.residents[4].roomId=1;
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old',kind:'assign',targets:[5,1],at:clock-60000,vaultNo:77,
        before:{collected:0,day:'2026-10-10',month:'2026-10',room:null}}));`);
    await drive(done,'old assignment reconciled');assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`${moves}.length`),0);
  });
  await t.test('人员管理：缺失人员信息或损坏配对仅停止调岗，仍领取奖励',async()=>{
    for(const patch of [`delete sm.view.state.residents[4].parents;`,
      `localStorage.setItem('arkengine:auto-shelter:staff:v1','family');localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'旧记录',families:[{a:1,b:1,room:5}]}));`]){
      await setupShelter(`${scene}${patch}sm.achievementIncomplete=false;`);await drive(done,'only staff held',150);
      assert.equal(await evaluate(`${moves}.length`),0);assert.ok(await evaluate(`sm.calls.some(c=>c.type==='claim_achievement')`));
    }
  });
  await t.test('快速就业证据：人口模式目标损坏时只领奖，不绕过普通人员管理去调岗',async()=>{
    await setupShelter(`${scene}sm.achievementIncomplete=false;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','invalid');`);
    await drive(done,'invalid population target holds fast employment',150);
    assert.deepEqual(await evaluate(moves),[]);
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='claim_achievement')`));
    assert.match(await evaluate(`${panel}.getElementById('shelter-staff-status').textContent`),/人口目标无效/);
    assert.equal(await evaluate('localStorage.getItem("arkengine:auto-shelter:enabled:v1")'),'true');
  });
  await t.test('快速就业证据：打开居民窗口后资料缺失，取消未提交调岗；修复重读后只派一次',async()=>{
    await setupShelter(`${scene}sm.quickAssign=false;sm.fixtureSearch=location.search;`);
    await drive(`!!document.querySelector('[data-staff-dialog]')&&${pending}===null`,'idle job selected before metadata changes');
    await evaluate(`delete sm.view.state.residents.find(p=>p.id===5).parents;`);
    await drive(done,'incomplete evidence cancels unsent idle job',150);
    assert.deepEqual(await evaluate(moves),[]);assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate(`document.querySelector('[data-staff-dialog]')`),null);
    await pulse(1000);
    await evaluate(`sm.view.state.residents.find(p=>p.id===5).parents=[];
      history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
    await reloadShelter();await drive(done,'repaired roster may work again',150);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[5,1]]);
    await evaluate(check);await drive(`location.pathname==='/shelter'`,'revisit repaired job');await drive(done,'confirmed job stays stable');
    assert.equal(await evaluate(`${moves}.length`),1);
  });
  await t.test('人员管理：旧居民未保存可选感情和冷却字段时仍可安排生产',async()=>{
    await setupShelter(`${scene}sm.view.state.residents.forEach(p=>{delete p.romance;delete p.familyCooldownUntil;});`);
    await drive(done,'optional family fields',150);assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[5,1]]);
  });
  await t.test('避难所页签：带奖励角标时领取，无奖励时跳过目标和图鉴',async()=>{
    await setupShelter('sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.view.state.rooms[0].stored=0;');
    await drive(done,'no reward tabs');assert.deepEqual(await evaluate('sm.tabs'),[]);
    await setupShelter('sm.tutorial=false;sm.view.state.rooms[0].stored=0;sm.view.state.season.points=150;');
    await drive(done,'badge reward tabs',150);assert.deepEqual(await evaluate('sm.tabs'),['目标','图鉴']);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='claim_objective').length`),3);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='claim_achievement').length`),1);
  });
  await t.test('避难所页签：只有通行证奖励时跳过目标页',async()=>{
    await setupShelter(`sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.view.state.rooms[0].stored=0;
      Object.assign(sm.view.state.season,{points:60,premium:true,claimedFree:[1],claimedPremium:[]});sm.paidBadge=1;`);
    await drive(done,'paid-only badge skipped');assert.deepEqual(await evaluate('sm.tabs'),[]);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
}
