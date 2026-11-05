import assert from 'node:assert/strict';

export async function shelterExplorationTests({t,setupShelter,reloadShelter,evaluate,pulse,drive,until,expStatus,trustedStaffKey}) {
  const panel=`document.getElementById('ark-auto-expedition').shadowRoot`,pending=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`;
  const state=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`,enabled=`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`;
  const done=`location.pathname==='/activities/expedition'&&${state}?.nextAt>clock`;
  const flag=`localStorage.setItem('arkengine:auto-shelter:explore-claim:v1','true');`;
  const assertWait=async(reason,note,hasSuccessProof)=>{
    assert.match(await evaluate(`${state}.note`),note);
    const event=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-pending-wait').at(-1)`);
    assert.ok(event,'等待日志应保留可核对的原因');
    assert.equal(event.data.reason,reason);assert.equal(event.data.kind,'explore');
    assert.equal(event.data.hasSuccessProof,hasSuccessProof);
    assert.equal(event.data.explorerListReadable,reason!=='explorer-list-unavailable');
    assert.equal(event.data.explorerListed,reason==='explorer-list-unavailable'?null:reason==='explorer-still-listed');
    assert.equal(event.data.proofAt===null,!hasSuccessProof);
    assert.doesNotMatch(JSON.stringify(event.data),/original-key|idempotencyKey|vaultNo|residentId|explorerId/);
  };
  const scene=`sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;const s=sm.view.state;
    s.rooms[0].stored=0;s.residents[0].away={kind:'explore'};
    s.explorers=[{id:11,residentId:1,startedAt:clock-3600000,recalledAt:clock-1200000,returnAt:clock-1,
      tier:0,abyss:false,stimpaks:2,loot:{scrap:50,parts:1,stimpak:1,items:[]}}];`;
  await t.test('避难所页签等待：废土页签晚到后同轮领取归来探险并释放居民',async()=>{
    await setupShelter(`${scene}${flag}sm.delayedExplore=true;const originalRender=renderShelter;window.renderShelter=()=>{originalRender();
      if(sm.delayedExplore)[...game.querySelectorAll('[role="tablist"] button')].find(b=>b.textContent==='废土')?.remove();};`);
    await until(async()=>/等待避难所.*废土.*页签/.test(await expStatus()),'exploration tab pending');
    await pulse(5000);assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate('sm.delayedExplore=false;renderShelter();');await drive(done,'claim after exploration tab appears');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_claim']);
    assert.equal(await evaluate('sm.view.state.residents[0].away'),null);
  });
  await t.test('探险迟到快照：已收到成功回执但页面仍显示原探险时保留原记录，不再次领取',async()=>{
    await setupShelter(`${scene}${flag}sm.beforeClaimView=structuredClone(sm.view);`);
    await drive('sm.calls.length===1','explorer claim executed');
    await until(()=>evaluate(`Boolean(${pending}?.result?.proof)`),'explorer success proof saved');
    const original=await evaluate(pending);
    // 模拟领取响应已经成功，但随后的页面和只读读取仍给出旧数据；重复提交不得发生。
    await evaluate(`sm.afterClaimView=structuredClone(sm.view);sm.view=structuredClone(sm.beforeClaimView);sm.mode='unknown';renderShelter();`);
    await drive(done,'stale explorer view yields to expedition');
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.deepEqual(await evaluate(`${pending}.result.proof`),original.result.proof);
    assert.equal(await evaluate(enabled),'true');
    await assertWait('explorer-still-listed',/已收到原领取成功凭据.*列表仍含原探险/,true);
    await evaluate(`sm.view=sm.afterClaimView;sm.mode='success';`);
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(`${pending}===null&&${done}`,'fresh explorer state reconciles once');
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`${state}.pendingReadOnly`),undefined);
  });
  await t.test('探险迟到快照刷新：旧探险等待跨刷新保留，实际列表更新且居民重新出发后核对旧领取',async()=>{
    await setupShelter(`${scene}${flag}sm.beforeClaimView=structuredClone(sm.view);`);
    await drive('sm.calls.length===1','original explorer claimed before reload');
    await until(()=>evaluate(`Boolean(${pending}?.result?.proof)`),'proof before stale reload');
    const original=await evaluate(pending);
    await evaluate(`sm.afterClaimView=structuredClone(sm.view);sm.view=structuredClone(sm.beforeClaimView);sm.mode='unknown';renderShelter();`);
    await reloadShelter();await drive(done,'stale explorer survives reload');
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.deepEqual(await evaluate(`${pending}.result.proof`),original.result.proof);
    await assertWait('explorer-still-listed',/已收到原领取成功凭据.*列表仍含原探险/,true);
    await evaluate(`sm.view=sm.afterClaimView;sm.mode='success';sm.view.state.residents[0].away={kind:'explore'};
      sm.view.state.explorers=[{...sm.beforeClaimView.state.explorers[0],id:22,startedAt:clock,returnAt:clock+3600000}];`);
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(`${pending}===null&&${done}`,'proof reconciles old explorer while new trip exists');
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate('sm.view.state.explorers[0].id'),22);
    assert.equal(await evaluate(enabled),'true');
  });
  await t.test('探险迟到快照时间：早于成功回执的读取不提前解除记录，时间同步后仍不重复领取',async()=>{
    await setupShelter(`${scene}${flag}const originalData=shelterData;
      window.shelterTransport=(u,o)=>{clock+=1000;return fetch(u,o);};
      window.shelterData=()=>{const v=originalData();if(Number.isFinite(sm.readTime))v.serverTime=sm.readTime;return v;};`);
    await drive('sm.calls.length===1','explorer before regressing read time');
    await until(()=>evaluate(`Boolean(${pending}?.result?.proof)`),'success proof before clock regression');
    const original=await evaluate(pending);
    assert.ok(original.result.proof.at>original.before.serverTime,'本场景必须区分原请求时间与成功凭据时间');
    await evaluate(`sm.readTime=${original.result.proof.at}-1;sm.view.state.residents[0].away={kind:'explore'};
      sm.view.state.explorers=[{id:22,residentId:1,startedAt:clock,returnAt:clock+3600000,tier:0,abyss:false,
        stimpaks:0,loot:{scrap:0,parts:0,stimpak:0,items:[]}}];renderShelter();`);
    await drive(done,'older snapshot waits');assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.equal(await evaluate('sm.calls.length'),1);
    await assertWait('snapshot-before-proof',/快照时间早于原领取成功凭据/,true);
    await evaluate('delete sm.readTime;');await pulse(await evaluate(`${state}.nextAt-clock+1000`));
    await drive(`${pending}===null&&${done}`,'current snapshot reconciles proof');assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('探险迟到快照缺失：已有成功凭据但探险列表暂缺时等待，列表恢复后正常核对',async()=>{
    await setupShelter(`${scene}${flag}`);await drive('sm.calls.length===1','explorer before missing list');
    await until(()=>evaluate(`Boolean(${pending}?.result?.proof)`),'proof before missing list');
    const original=await evaluate(pending);await evaluate('delete sm.view.state.explorers;renderShelter();');
    await drive(done,'missing explorer list waits');assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.equal(await evaluate(enabled),'true');assert.equal(await evaluate('sm.calls.length'),1);
    await assertWait('explorer-list-unavailable',/探险列表暂不可核对/,true);
    await evaluate('sm.view.state.explorers=[];');await pulse(await evaluate(`${state}.nextAt-clock+1000`));
    await drive(`${pending}===null&&${done}`,'list returns after original success');assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('探险迟到快照未知结果：没有成功凭据且居民已在新探险中，不能猜旧领取完成',async()=>{
    await setupShelter(`${scene}${flag}sm.mode='unknown';`);await drive('sm.calls.length===1','unknown original explorer claim');
    const original=await evaluate(pending);
    await evaluate(`sm.view.state.explorers=[{...sm.view.state.explorers[0],id:22,startedAt:clock,returnAt:clock+3600000}];`);
    await drive(done,'new trip without original proof remains unknown');
    assert.equal(await evaluate(`${pending}.id`),original.id);assert.equal(await evaluate('sm.calls.length'),1);
    assert.equal(await evaluate(`${pending}.result?.proof`),undefined);assert.equal(await evaluate(`${state}.pendingReadOnly`),original.id);
    await assertWait('result-unconfirmed',/探险原领取结果仍未确认/,false);
  });
  await t.test('探险请求边界：错误地址或方法不发送，支持Request配显式正文',async()=>{
    for(const transport of [`(u,o)=>fetch('/api/unexpected-shelter',o)`,
      `(u,o)=>fetch('https://unexpected.invalid/api/shelter/action',o)`,
      `(u,o)=>fetch(u,{...o,method:'PUT'})`,
      `(u,o)=>fetch(new Request(new URL(u,location.href),o))`]){
      await setupShelter(`${scene}${flag}sm.forwarded=[];const prior=window.fetch;
        window.fetch=(u,o)=>{const method=o?.method||(u instanceof Request?u.method:'GET');
          if(method!=='GET'){sm.forwarded.push(String(u instanceof Request?u.url:u));return Promise.resolve(new Response('{}'));}
          return prior(u,o);};window.shelterTransport=${transport};`);
      await drive(`${pending}!==null`,'explorer intent reserved');await pulse(3000);
      assert.deepEqual(await evaluate('sm.forwarded'),[],transport);assert.equal(await evaluate(enabled),'false');
      assert.equal(await evaluate(`${pending}.kind`),'explore');
    }
    await setupShelter(`${scene}${flag}window.shelterTransport=(u,o)=>fetch(new Request(new URL(u,location.href),{method:'POST'}),{body:o.body});`);
    await drive(done,'explorer with explicit Request body');assert.equal(await evaluate('sm.calls.length'),1);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('探险归来：默认关闭，开启后只领取已归来的探险并释放居民',async()=>{
    await setupShelter(scene);await drive(done,'default off');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(`sm.tabs.includes('废土')`),false);
    await setupShelter(`${scene}${flag}`);await drive(done,'claim returned explorer');
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.explorerId])'),[['explore_claim',11]]);
    assert.equal(await evaluate('sm.view.state.residents[0].away'),null);assert.equal(await evaluate('sm.view.state.resources.scrap'),319);
    assert.equal(await evaluate('sm.view.state.resources.stimpak'),3);assert.equal(await evaluate(pending),null);
  });
  await t.test('探险归来：多名归来者逐个处理，返程中、倒下和小队领取不误点',async()=>{
    await setupShelter(`${scene}${flag}
      for(let i=2;i<=4;i++){s.residents.push({...s.residents[0],id:i,name:'居民'+i,deadAt:i===4?clock-1:null});
        s.explorers.push({...s.explorers[0],id:10+i,residentId:i,returnAt:i===3?clock+600000:clock-1,stimpaks:0});}
      s.quests=[{id:99,returnAt:clock-1}];`);
    await drive(done,'claim only safe arrived explorers');
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.explorerId])'),[['explore_claim',11],['explore_claim',12]]);
    assert.deepEqual(await evaluate('sm.view.state.explorers.map(e=>e.id)'),[13,14]);
  });
  await t.test('探险归来：背包、装备或携带治疗针可能溢出时保留奖励',async()=>{
    for(const extra of [`s.resources.scrap=2090;`,`s.resources.stimpak=8;`,
      `s.items=Array.from({length:20},(_,i)=>({id:i+1}));s.explorers[0].loot.items=[{id:30}];`]){
      await setupShelter(`${scene}${flag}${extra}`);await drive(done,'preserve overflowing explorer loot');
      assert.deepEqual(await evaluate('sm.calls'),[]);assert.match(await evaluate(`${state}.exploreNote`),/溢出/);
    }
  });
  await t.test('探险归来：等待期间关闭开关或库存变满，撤销尚未发送的领取',async()=>{
    for(const change of [`const c=${panel}.getElementById('shelter-explore-claim');c.checked=false;c.dispatchEvent(new Event('change'));`,
      `sm.view.state.resources.scrap=2100;`]){
      await setupShelter(`${scene}${flag}`);await drive(`/随机等待.*归来的探险奖励/.test(${panel}.getElementById('status').textContent)`,'explorer claim queued');
      await evaluate(change);await drive(done,'cancel changed explorer claim');assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('探险归来：结果未知跨刷新保留原记录，不再次领取或救援',async()=>{
    await setupShelter(`${scene}${flag}sm.mode='unknown';`);await drive('sm.calls.length===1','unknown explorer claim');
    await reloadShelter();await drive(`${done}&&${enabled}==='true'&&${pending}!==null&&${state}.pendingReadOnly===${pending}.id`,'unknown explorer isolated');
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`${pending}.kind`),'explore');
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('探险归来：用户正在废土页操作时撤销排队领取，等待一分钟后再检查',async()=>{
    await setupShelter(`${scene}${flag}`);
    await drive(`/随机等待.*归来的探险奖励/.test(${panel}.getElementById('status').textContent)`,'queued before manual interaction');
    await trustedStaffKey();await pulse(10000);assert.deepEqual(await evaluate('sm.calls'),[]);assert.match(await expStatus(),/等待一分钟/);
    await pulse(61000);await drive(done,'manual work gets time');assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate(`${panel}.getElementById('shelter-check').click();`);await drive('sm.calls.length===1','later check may resume');
  });
  await t.test('探险归来：本次返回状态证明跨刷新保留，不因居民随后再次出发重复领取旧探险',async()=>{
    await setupShelter(`${scene}${flag}`);await drive('sm.calls.length===1','explorer claim sent');
    await until(()=>evaluate(`Boolean(${pending}?.result?.proof)`),'explorer response proof');
    await evaluate(`sm.view.state.residents[0].away={kind:'explore'};sm.view.state.explorers=[{id:22,residentId:1,startedAt:clock,
      returnAt:clock+3600000,tier:0,abyss:false,stimpaks:0,loot:{scrap:0,parts:0,stimpak:0,items:[]}}];`);
    await reloadShelter();await drive(done,'reconcile original after a manual new trip');
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('探险归来：原生按钮发出的目标不符时在发送前拦住，保留记录',async()=>{
    await setupShelter(`${scene}${flag}const act=shelterAct;window.shelterAct=a=>act(a.type==='explore_claim'?{type:'revive',residentId:1}:a);`);
    await drive(`${enabled}==='false'`,'reject mismatched explorer intent');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(`${pending}.kind`),'explore');
  });
  await t.test('探险归来：重名、缺失或新增背包字段只停止该领取，其他产出继续收取',async()=>{
    for(const extra of [`s.residents.push({...s.residents[0],id:2});`, `delete s.explorers[0].loot.parts;`,
      `s.explorers[0].loot.unknownResource=3;`, `delete s.explorers;`]){
      await setupShelter(`${scene}${flag}s.rooms[0].stored=30;${extra}`);await drive(done,'optional exploration fields isolated');
      assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);assert.equal(await evaluate(enabled),'true');
    }
  });
  await t.test('探险归来：隐藏副本不误点，可见重名卡片不猜测也不来回切页',async()=>{
    for(const hidden of [true,false]){
      await setupShelter(`${scene}${flag}const render=renderShelter;window.renderShelter=()=>{render();if(sm.tab==='废土'){
        const root=game.querySelector('section'),copy=root.cloneNode(true);copy.hidden=${hidden};
        copy.querySelectorAll('button').forEach(b=>b.onclick=()=>sm.calls.push({type:'wrong-copy'}));root.after(copy);}};`);
      await drive(done,'unique explorer card');
      assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),hidden?['explore_claim']:[]);
      assert.equal(await evaluate(`sm.tabs.filter(t=>t==='废土').length`),1);
    }
  });
  await t.test('探险归来：领取释放居民后接续现有生产管理，补入回收站',async()=>{
    await setupShelter(`${scene}${flag}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      for(const [i,type]of ['power','diner','water'].entries()){const id=i+2;s.rooms.push({...s.rooms[0],id,type});
        s.residents.push({...s.residents[0],id,name:'生产员'+id,roomId:id,away:null});}`);
    await drive(done,'returned resident resumes production',150);
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_claim','assign']);
    assert.equal(await evaluate('sm.view.state.residents[0].roomId'),1);
  });
}
