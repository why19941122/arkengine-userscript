import assert from 'node:assert/strict';

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
    assert.deepEqual(await evaluate('sm.tabs'),['居民','避难所']);
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`),false);
  });
  await t.test('人员管理：先补净水岗位，禁止从不足的其他基础岗位抽人',async()=>{
    await setupShelter(`${scene}sm.view.state.residents[2].roomId=1;`);await drive(done,'water deficit fixed',150);
    const calls=await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`);
    assert.deepEqual(calls[0],[3,4]);assert.ok(calls.some(c=>c[0]===5&&c[1]===1));
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
  await t.test('人员管理额外驻留：原家庭轮换按两人离岗后的实际替补产出核对，不能重复扣父母产量',async()=>{
    for(const replacements of [1,2]){
      await setupShelter(`${scene}localStorage.setItem('arkengine:auto-shelter:staff:v1','family');sm.confirmFamily=true;
        sm.view.state.residents[4].roomId=3;
        sm.view.state.residents.push(...[6,7].slice(0,${replacements}).map(id=>({...structuredClone(adult),id,name:'接替居民'+id,roomId:3})));
        sm.view.state.residents.filter(p=>p.roomId===3).forEach(p=>p.stats.agi=2);
        localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'原家庭待轮换',vaultNo:77,families:[{a:2,b:5,room:5}]}));`);
      await drive(done,'original family checks actual replacement count',200);
      if(replacements===1){
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
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[5,5],[2,5]],staffMode);
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
  await t.test('人员管理：伤员、外出人员、重名和特殊岗位不自动接管',async()=>{
    for(const patch of [`p.hp=10;`,`p.away={kind:'explore'};`,`p.deadAt=clock;`,`p.name='丁';`,
      `sm.view.state.rooms.push({...sm.view.state.rooms[0],id:6,type:'training'});p.roomId=6;`]){
      await setupShelter(`${scene}const p=sm.view.state.residents[4];${patch}`);await drive(done,'protected resident');
      assert.equal(await evaluate(`${moves}.length`),0);
    }
  });
  await t.test('人员管理：调岗等待期间目标满员，取消旧岗位变更',async()=>{
    await setupShelter(scene);
    await drive(`!!document.querySelector('[data-staff-dialog]') && ${panel}.getElementById('status').textContent.includes('随机等待')`,'assignment queued');
    await evaluate(`sm.view.state.rooms[0].width=1;sm.view.state.residents.push({...structuredClone(sm.view.state.residents[3]),id:9,name:'填满岗位',roomId:1});`);
    await drive(done,'capacity changes cancel assign',150);assert.equal(await evaluate(`${moves}.length`),0);
  });
  await t.test('人员管理：切回手动模式时撤销排队调岗，只关闭脚本自己的窗口',async()=>{
    await setupShelter(scene);
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
    await setupShelter(scene);
    await drive(`!!document.querySelector('[data-staff-dialog]') && ${panel}.getElementById('status').textContent.includes('随机等待')`,'script dialog ready');
    await evaluate(`document.querySelector('[data-staff-dialog] select').focus()`);await trustedStaffKey();
    for(let i=0;i<3;i++)await pulse(5000);
    assert.equal(await evaluate(`${moves}.length`),0);assert.ok(await evaluate(`!!document.querySelector('[data-staff-dialog]')`));
    await evaluate('closeResident()');await drive(done,'user closed dialog');assert.equal(await evaluate(`${moves}.length`),0);
  });
  await t.test('人员管理：详情刚打开就关闭自动管理，仍能退出自己的窗口',async()=>{
    await setupShelter(`${scene}const open=openResident;window.openResident=id=>{open(id);${mode('off')}};`);
    await drive(done,'mode changed while opening',150);assert.equal(await evaluate(`${moves}.length`),0);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]')`),null);
  });
  await t.test('人员管理：居民升级后仍核对同一人并关闭自己的窗口',async()=>{
    await setupShelter(`${scene}const act=shelterAct;window.shelterAct=async a=>{const result=await act(a);if(a.type==='assign'){
      const p=sm.view.state.residents.find(p=>p.id===a.residentId);p.xp=3;document.querySelector('[data-staff-dialog] h2').textContent=p.name+' · 2 级';}return result;};`);
    await drive(done,'level changed during assign',150);assert.equal(await evaluate(`${moves}.length`),1);
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
    await setupShelter(`sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.view.state.rooms[0].stored=0;
      Object.assign(sm.view.state.season,{points:150,premium:true,claimedFree:[1],claimedPremium:[]});sm.paidBadge=1;`);
    await drive(done,'paid-only badge skipped');assert.deepEqual(await evaluate('sm.tabs'),[]);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
}
