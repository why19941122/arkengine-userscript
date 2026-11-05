import assert from 'node:assert/strict';

export async function shelterProductionTests({t,setupShelter,reloadShelter,evaluate,pulse,drive}) {
  const panel = `document.getElementById('ark-auto-expedition').shadowRoot`;
  const state = `JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`;
  const pending = `JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`;
  const moves = `sm.calls.filter(c=>c.type==='assign')`;
  const equips = `sm.calls.filter(c=>c.type==='equip')`;
  const done = `location.pathname==='/activities/expedition' && ${state}?.nextAt>clock`;
  const waiting = `${done}&&localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='true'&&${pending}!==null&&${state}.pendingReadOnly===${pending}.id`;
  const scene = `sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    const original=sm.view.state.rooms[0],adult=sm.view.state.residents[0];
    sm.view.state.rooms=['scrap','power','diner','water','quarters'].map((type,i)=>({...original,id:i+1,type,width:i===4?3:1,stored:0}));
    sm.view.state.residents=Array.from({length:8},(_,i)=>({...structuredClone(adult),id:i+1,name:'居民'+(i+1),roomId:[2,3,4,1,1,2,3,4][i],
      stats:{str:3,per:3,end:3,cha:3,int:3,agi:3,lck:3}}));
    sm.view.state.residents[0].stats.str=10;sm.view.state.residents[1].stats.agi=10;sm.view.state.residents[2].stats.per=10;
    sm.view.state.residents[3].stats.end=1;sm.view.state.residents[4].stats.end=5;sm.view.state.residents[5].stats.end=10;`;
  const gear = `${scene}localStorage.setItem('arkengine:auto-shelter:gear:v1','true');
    sm.view.state.items=[{id:101,slot:'outfit',name:'回收服',bonus:{end:2}},{id:102,slot:'outfit',name:'净水服',bonus:{per:2}}];
    sm.view.state.residents[4].stats.end=17;`;
  const swap = `${scene}localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');`;
  const turnOff = id => `${panel}.getElementById('${id}').checked=false;${panel}.getElementById('${id}').dispatchEvent(new Event('change'));`;
  const cycle = `${swap}
    Object.assign(sm.view.state.residents[0].stats,{str:5,agi:17,per:0,end:0});
    Object.assign(sm.view.state.residents[1].stats,{str:0,agi:10,per:17,end:0});
    Object.assign(sm.view.state.residents[2].stats,{str:10,agi:0,per:10,end:0});
    for(const p of sm.view.state.residents.slice(3)){p.hp=1;p.stats={str:10,agi:10,per:10,end:17,cha:3,int:3,lck:3};}`;

  await t.test('服装整批分配：为其他岗位保留多属性服，跨刷新继续核对且不重复穿戴',async()=>{
    await setupShelter(`${gear}sm.view.state.items=[{id:101,slot:'outfit',name:'多用途服',bonus:{end:5,per:4}},
      {id:102,slot:'outfit',name:'回收专用服',bonus:{end:5}}];`);
    await drive(`${equips}.length===1&&${pending}===null`,'first batch outfit confirmed');
    assert.deepEqual(await evaluate(`${equips}.map(c=>[c.residentId,c.itemId])`),[[4,102]]);
    await reloadShelter();await drive(done,'batch outfit plan after reload',180);
    assert.deepEqual(await evaluate(`${equips}.map(c=>[c.residentId,c.itemId])`),[[4,102],[3,101]]);
    const entries=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-gear-plan')`);
    assert.equal(entries.length,2);assert.equal(entries[0].data.count,2);assert.equal(entries[0].data.complete,true);
    assert.ok(entries[0].data.after.water>entries[0].data.before.water);
    await evaluate(`${panel}.getElementById('shelter-check').click()`);await drive(`location.pathname==='/shelter'`,'next batch visit');
    await drive(done,'batch outfits remain stable');assert.equal(await evaluate(`${equips}.length`),2);
  });

  await t.test('人员整体分配：三人岗位循环错配时比较整组产出，突破两两互换无收益的局限',async()=>{
    await setupShelter(cycle);await drive(done,'three-way production allocation',240);
    assert.deepEqual(await evaluate('sm.view.state.residents.slice(0,3).map(p=>p.roomId)'),[3,4,2]);
    assert.equal(await evaluate(`${moves}.length`),4,'满员三人轮换只需一次腾位和三次归位');
    assert.deepEqual(await evaluate('sm.view.state.residents.slice(3).map(p=>p.roomId)'),[1,1,2,3,4],'保护不参与调岗的居民');
    const count=await evaluate(`${moves}.length`);
    await evaluate(`${panel}.getElementById('shelter-check').click();`);await drive(`location.pathname==='/shelter'`,'review allocation');await drive(done,'stable allocation',180);
    assert.equal(await evaluate(`${moves}.length`),count,'达到本轮最优分配后不反复换人');
  });
  await t.test('人员整体分配：轮换中刷新接续原计划，已确认步骤不重复',async()=>{
    for(const completed of [1,2]){
      await setupShelter(cycle);await drive(`${moves}.length===${completed}`,'allocation before reload');
      await reloadShelter();await drive(done,'resume allocation',240);
      assert.deepEqual(await evaluate('sm.view.state.residents.slice(0,3).map(p=>p.roomId)'),[3,4,2]);
      assert.equal(await evaluate(`${moves}.length`),4);
      assert.equal(await evaluate(`${state}.swap`),null);assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('人员整体分配：关闭优化或手动改动计划人员后停止剩余轮换',async()=>{
    for(const change of [turnOff('shelter-optimize'),`sm.view.state.residents[1].roomId=5;`]){
      await setupShelter(cycle);await drive(`${moves}.length===1&&${pending}===null`,'first allocation step confirmed');
      await evaluate(change);await drive(done,'allocation cancelled after user change',180);
      assert.equal(await evaluate(`${moves}.length`),1);assert.equal(await evaluate(`${state}.swap`),null);
    }
  });
  await t.test('人员整体分配：腾位结果未知时只读等待，刷新不执行后续调岗',async()=>{
    await setupShelter(`${cycle}sm.assignUnknown=true;`);await drive(`${moves}.length===1`,'unknown first allocation step');
    await reloadShelter();await drive(waiting,'unknown allocation waits',180);
    assert.equal(await evaluate(`${moves}.length`),1);assert.ok(await evaluate(`${state}.swap`));
    assert.equal(await evaluate(`${pending}.kind`),'assign');
  });
  await t.test('人员整体分配：暂时腾位后属性或服装改变，不执行已失去收益的旧方案',async()=>{
    for(const [setup,change] of [['',`sm.view.state.residents[5].stats.end=0;`],
      [`sm.view.state.residents[5].stats.end=0;sm.view.state.residents[5].outfitId=101;sm.view.state.items=[{id:101,slot:'outfit',bonus:{end:10}}];`,
        `sm.view.state.residents[5].outfitId=null;`]]){
      await setupShelter(`${swap}${setup}`);await drive(`${moves}.length===1&&${pending}===null`,'first vacancy confirmed before stats change');
      await evaluate(change);await drive(done,'obsolete allocation stopped',180);
      assert.equal(await evaluate(`${moves}.length`),1);
      assert.equal(await evaluate(`${state}.swap`),null);
      assert.match(await evaluate(`${panel}.getElementById('shelter-staff-status').textContent`),/收益|增益/);
    }
  });
  await t.test('人员整体分配：餐厅无人能安全离岗时仍优化其他房间，不被高属性留守者卡住',async()=>{
    await setupShelter(`${swap}
      const specs=[{str:5,per:17,end:0,agi:0},{str:0,per:10,end:17,agi:0},{str:10,per:0,end:10,agi:0},
        {str:17,per:17,end:17,agi:5},{str:17,per:17,end:17,agi:5},{str:10},{per:10},{end:17}];
      sm.view.state.residents.forEach((p,i)=>{p.roomId=[2,4,1,3,3,2,4,1][i];Object.assign(p.stats,specs[i]);if(i>=5)p.hp=1;});
      for(let id=6;id<=8;id++)sm.view.state.rooms.push({...sm.view.state.rooms[1],id});`);
    await drive(done,'safe allocation around locked diner',240);
    assert.deepEqual(await evaluate('sm.view.state.residents.slice(0,2).map(p=>p.roomId)'),[4,1]);
    assert.ok(await evaluate('sm.view.state.rooms.find(r=>r.id===sm.view.state.residents[2].roomId).type===\'power\''));
    assert.deepEqual(await evaluate('sm.view.state.residents.slice(3).map(p=>p.roomId)'),[3,3,2,4,1]);
    assert.ok(await evaluate(`${moves}.length>0`));
    assert.ok(await evaluate(`${moves}.every(c=>[1,2,3].includes(c.residentId))`));
  });
  await t.test('人员整体分配：刷新读到重复目标、外来动作或缺失终点时停止调岗并保留奖励领取',async()=>{
    for(const change of [`saved.swap.targets[1]=saved.swap.targets[0];`,
      `saved.swap.moves[1].id=999;`,`saved.swap.targets[0].room=1;`]){
      await setupShelter(cycle);await drive(`${moves}.length===1&&${pending}===null`,'allocation stored before corruption');
      await evaluate(`const saved=${state};${change}localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(saved));sm.achievementIncomplete=false;`);
      await reloadShelter();await drive(done,'bad allocation isolated',180);
      assert.equal(await evaluate(`${moves}.length`),1);
      assert.ok(await evaluate(`sm.calls.some(c=>c.type==='claim_achievement')`));
    }
  });

  await t.test('避难所请求绑定：服装、居民或装备槽变化时不发送，不替换原穿戴记录',async()=>{
    for(const change of [`itemId:102`,`residentId:1`,`slot:'weapon'`]){
      await setupShelter(`${gear}window.shelterTransport=(u,o)=>{const body=JSON.parse(o.body);
        return fetch(u,{...o,body:JSON.stringify({...body,action:{...body.action,${change}}})});};`);
      await drive(`${pending}!==null`,'outfit reserved');await pulse(3000);
      assert.deepEqual(await evaluate('sm.calls'),[]);
      assert.deepEqual(await evaluate(`${pending}.targets`),[4,101]);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'false');
    }
  });

  await t.test('生产强化：默认不穿衣或满员换位，人员管理关闭时两项开关也不执行',async()=>{
    await setupShelter(scene);await drive(done,'enhancements default off');assert.deepEqual(await evaluate('sm.calls'),[]);
    await setupShelter(`${gear}localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');localStorage.setItem('arkengine:auto-shelter:staff:v1','off');`);
    await drive(done,'manual staff mode');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('生产强化：闲置服装按实际产量分配，属性达到17后不浪费服装且下轮不重穿',async()=>{
    await setupShelter(gear);await drive(done,'equip production outfits',180);
    assert.deepEqual(await evaluate(`${equips}.map(c=>[c.residentId,c.itemId,c.slot])`),[[4,101,'outfit'],[3,102,'outfit']]);
    assert.equal(await evaluate(pending),null);
    await evaluate(`${panel}.getElementById('shelter-check').click()`);await drive(`location.pathname==='/shelter'`,'next visit');await drive(done,'stable outfits');
    assert.equal(await evaluate(`${equips}.length`),2);
  });
  await t.test('生产强化：供应缺口先用对应服装补足，再安排废料服装',async()=>{
    await setupShelter(`${gear}sm.view.state.residents[2].stats.per=0;sm.view.state.residents[7].stats.per=0;`);
    await drive(done,'gear fixes supply first',180);
    assert.deepEqual(await evaluate(`${equips}.map(c=>c.itemId)`),[102,101]);
  });
  await t.test('生产强化：不抽走任何人穿着的服装，不用武器或无生产收益服装替换',async()=>{
    await setupShelter(`${gear}sm.view.state.residents[6].outfitId=101;sm.view.state.residents[7].outfitId=102;
      sm.view.state.items.push({id:103,slot:'weapon',bonus:{end:10}},{id:104,slot:'outfit',bonus:{lck:10}});`);
    await drive(done,'occupied and unrelated items');assert.equal(await evaluate(`${equips}.length`),0);
    assert.deepEqual(await evaluate('sm.view.state.residents.slice(6).map(p=>p.outfitId)'),[101,102]);
  });
  await t.test('生产强化：房间额外驻留者不计入生产时不占用闲置服装',async()=>{
    await setupShelter(`${gear}sm.view.state.items=sm.view.state.items.slice(0,1);sm.view.state.residents[3].stats.end=17;
      sm.view.state.residents.push({...structuredClone(sm.view.state.residents[3]),id:9,name:'额外驻留者',stats:{str:3,per:3,end:1,cha:3,int:3,agi:3,lck:3}});`);
    await drive(done,'extra resident does not produce');assert.equal(await evaluate(`${equips}.length`),0);
    assert.equal(await evaluate('sm.view.state.residents[8].outfitId'),null);
  });
  await t.test('生产强化：等待穿衣时服装被手动占用，撤销排队操作',async()=>{
    await setupShelter(`${gear}sm.view.state.items=sm.view.state.items.slice(0,1);`);
    await drive(`!!document.querySelector('[data-staff-dialog]') && ${panel}.getElementById('status').textContent.includes('随机等待')`,'equip queued');
    await evaluate('sm.view.state.residents[6].outfitId=101;');await drive(done,'item no longer unused');
    assert.equal(await evaluate(`${equips}.length`),0);
  });
  await t.test('生产强化：关闭穿衣开关撤销待提交操作并退出自己的窗口',async()=>{
    await setupShelter(gear);await drive(`!!document.querySelector('[data-staff-dialog]')`,'outfit dialog');
    await evaluate(turnOff('shelter-gear'));await drive(done,'outfits disabled');assert.equal(await evaluate(`${equips}.length`),0);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]')`),null);
  });
  await t.test('生产强化：未知穿衣结果刷新后不重试，只读核对且不阻塞远征',async()=>{
    await setupShelter(`${gear}sm.equipUnknown=true;`);await drive(`${equips}.length===1`,'unknown equip');
    await reloadShelter();await drive(waiting,'unknown equip isolated');
    assert.equal(await evaluate(`${equips}.length`),1);assert.equal(await evaluate(`${pending}.kind`),'equip');
    assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
  });
  await t.test('生产强化：已穿好的旧记录只核对，损坏装备归属时仍收奖励',async()=>{
    await setupShelter(`${gear}sm.view.state.items=sm.view.state.items.slice(0,1);sm.view.state.residents[3].outfitId=101;
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'old',kind:'equip',targets:[4,101],at:clock-60000,vaultNo:77,
        before:{collected:0,day:'2026-10-10',month:'2026-10',outfit:null}}));`);
    await drive(done,'reconcile old outfit');assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`${equips}.length`),0);
    await setupShelter(`${gear}delete sm.view.state.residents[0].weaponId;sm.achievementIncomplete=false;`);
    await drive(done,'bad item ownership holds staff');assert.equal(await evaluate(`${equips}.length`),0);
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='claim_achievement')`));
  });
  await t.test('生产强化：满员生产房间三步换位，每步保留供应余量，后续不来回交换',async()=>{
    await setupShelter(swap);await drive(done,'full room swap',200);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[4,null],[6,1],[4,2]]);
    const snapshots=await evaluate('sm.snapshots'), residents=await evaluate('sm.view.state.residents');
    for(const positions of snapshots){
      for(const [room,stat,base,min] of [[2,'str',12,5.4],[3,'agi',8,9.6],[4,'per',8,9.6]]){
        const workers=positions.filter(p=>p.room===room);assert.ok(workers.length<=2);
        const output=workers.reduce((n,p)=>n+base*(.5+residents.find(r=>r.id===p.id).stats[stat]/10),0);
        assert.ok(output>=min-1e-9,`${stat} supply: ${output}`);
      }
    }
    assert.equal(await evaluate(`${state}.swap`),null);assert.equal(await evaluate(pending),null);
    await evaluate(`${panel}.getElementById('shelter-check').click()`);await drive(`location.pathname==='/shelter'`,'stable swap visit');await drive(done,'stable placement');
    assert.equal(await evaluate(`${moves}.length`),3);
  });
  await t.test('生产强化：闲置高产居民替换满员回收站人员，原岗位有空位时继续比较基础产出',async()=>{
    await setupShelter(`${swap}sm.view.state.residents[5].stats.end=3;
      sm.view.state.residents.push({...structuredClone(adult),id:9,name:'闲置回收员',roomId:null,stats:{str:3,per:3,end:17,cha:3,int:3,agi:3,lck:3}});`);
    await drive(done,'idle replacement',180);assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[4,null],[9,1]]);
    await setupShelter(`${swap}sm.view.state.residents[0].roomId=5;`);
    await drive(done,'source has spare capacity',180);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[4,2],[6,1],[8,2]]);
    // 净水仍由感知10的居民独立覆盖9.6/小时底线，转去发电额外增加3.2/小时基础产量。
    assert.equal(await evaluate('sm.view.state.residents.filter(p=>p.roomId===4).reduce((n,p)=>n+8*(.5+p.stats.per/10),0)'),12);
    const count=await evaluate(`${moves}.length`);
    await evaluate(`${panel}.getElementById('shelter-check').click()`);await drive(`location.pathname==='/shelter'`,'recheck vacancy allocation');await drive(done,'stable vacancy allocation');
    assert.equal(await evaluate(`${moves}.length`),count);
  });
  await t.test('生产强化：换位任一步完成后刷新，接续剩余步骤而不重放',async()=>{
    for(const completed of [1,2]){
      await setupShelter(swap);await drive(`${moves}.length===${completed}`,'move before reload');await reloadShelter();await drive(done,'resume swap',200);
      assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[4,null],[6,1],[4,2]]);
      assert.equal(await evaluate(`${state}.swap`),null);
    }
  });
  await t.test('生产强化：腾位结果未知时保留含空房间目标的记录，刷新不重复提交',async()=>{
    await setupShelter(`${swap}sm.assignUnknown=true;`);await drive(`${moves}.length===1`,'unknown rest');await reloadShelter();
    await drive(waiting,'rest pending isolated');
    assert.deepEqual(await evaluate(`${pending}.targets`),[4,null]);assert.equal(await evaluate(`${moves}.length`),1);
  });
  await t.test('生产强化：换位中关闭优化、房间满员或手动改岗时不继续旧计划',async()=>{
    for(const mutation of [turnOff('shelter-optimize'),
      `localStorage.setItem('arkengine:auto-shelter:optimize:v1','false');const saved=${state};saved.swap=null;
       localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(saved));window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-shelter:optimize:v1',newValue:'false'}));`,
      `sm.view.state.residents.push({...structuredClone(sm.view.state.residents[0]),id:9,name:'手动补员',roomId:2});`,
      `sm.view.state.residents[3].roomId=5;`]){
      await setupShelter(swap);await drive(`${moves}.length===1 && ${pending}===null`,'confirmed first move before interruption');
      assert.ok(await evaluate(`${state}.swap`));await evaluate(mutation);
      await drive(done,'swap interrupted',180);assert.equal(await evaluate(`${moves}.length`),1);assert.equal(await evaluate(`${state}.swap`),null);
    }
  });
  await t.test('生产强化：原调岗尚未确认时被手动改岗，保留未知记录而不猜测完成',async()=>{
    await setupShelter(swap);await drive(`${moves}.length===1`,'unconfirmed first move');
    assert.ok(await evaluate(pending));await evaluate('sm.view.state.residents[3].roomId=5;');
    await drive(waiting,'manual change before confirmation');
    assert.deepEqual(await evaluate(`${pending}.targets`),[4,null]);assert.equal(await evaluate(`${moves}.length`),1);
  });
  await t.test('生产强化：无法保存换位计划时不执行腾位，仍可收取奖励',async()=>{
    await setupShelter(`${swap}sm.achievementIncomplete=false;const save=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key==='arkengine:auto-shelter:schedule:v1'&&JSON.parse(value).swap)throw new Error('fixture full');return save.call(this,key,value);};`);
    await drive(done,'swap storage failure isolated');assert.equal(await evaluate(`${moves}.length`),0);
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='claim_achievement')`));
  });
  await t.test('生产强化：任何中间步骤会损失基础供应余量时不换位',async()=>{
    await setupShelter(`${swap}sm.view.state.rooms[4].level=3;
      for(const p of sm.view.state.residents){if(p.roomId===2)p.stats.str=0;if(p.roomId===3)p.stats.agi=1;if(p.roomId===4)p.stats.per=1;}`);
    await drive(done,'no safe vacancy');assert.equal(await evaluate(`${moves}.length`),0);
  });
  await t.test('生产强化：损坏换位计划只停止人员调整，继续领取奖励',async()=>{
    await setupShelter(`${swap}sm.achievementIncomplete=false;
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'旧计划',swap:{people:[],moves:[],step:0}}));`);
    await drive(done,'bad swap isolated');assert.equal(await evaluate(`${moves}.length`),0);
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='claim_achievement')`));
  });
  await t.test('生产强化：接近人口上限且满员岗位已平衡时不制造无收益调岗',async()=>{
    await setupShelter(`${swap}sm.view.state.rooms=[];sm.view.state.residents=[];
      for(let r=0;r<33;r++){
        sm.view.state.rooms.push({...original,id:r+1,type:['power','diner','water','scrap'][r%4],width:3,stored:0});
        for(let i=0;i<6;i++)sm.view.state.residents.push({...structuredClone(adult),id:r*6+i+1,name:'居民'+(r*6+i+1),roomId:r+1,
          stats:{str:3,per:3,end:3,cha:3,int:3,agi:3,lck:3}});
      }`);
    await drive(done,'198 residents balanced');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'true');
    assert.match(await evaluate(`${panel}.getElementById('shelter-staff-status').textContent`),/局部优化.*尚未完成整体最优核验/);
  });
}
