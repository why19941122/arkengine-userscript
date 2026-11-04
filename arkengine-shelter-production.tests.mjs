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
  await t.test('生产强化：闲置高产居民替换满员回收站人员，空位原岗位用两步完成',async()=>{
    await setupShelter(`${swap}sm.view.state.residents[5].stats.end=3;
      sm.view.state.residents.push({...structuredClone(adult),id:9,name:'闲置回收员',roomId:null,stats:{str:3,per:3,end:17,cha:3,int:3,agi:3,lck:3}});`);
    await drive(done,'idle replacement',180);assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[4,null],[9,1]]);
    await setupShelter(`${swap}sm.view.state.residents[0].roomId=5;`);
    await drive(done,'source has spare capacity',180);
    assert.deepEqual(await evaluate(`${moves}.map(c=>[c.residentId,c.roomId])`),[[4,2],[6,1]]);
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
    assert.ok(await evaluate(`${panel}.getElementById('shelter-staff-status').textContent.includes('已按供应余量')`));
  });
}
