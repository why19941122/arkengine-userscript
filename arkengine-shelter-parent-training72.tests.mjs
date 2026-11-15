import assert from 'node:assert/strict';
import {parentTraining72Scene} from './arkengine-shelter-parent-training72.fixture.mjs';

export async function shelterParentTraining72Tests({t,setupShelter,reloadShelter,evaluate,pulse,drive}){
  const state=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`,
    pending=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`,
    done=`location.pathname==='/activities/expedition'&&${state}?.nextAt>clock`;
  const scene=(extra='')=>{const f=parentTraining72Scene();return `sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;
    sm.fixtureSearch=location.search;sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.quickAssign=false;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
    localStorage.setItem('arkengine:auto-shelter:population:v1','13');
    localStorage.setItem('arkengine:auto-shelter:population-continuous:v1','false');
    localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify({tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:10,
      ...f.campaign,workshop:false,defense:false,craftDaily:false})}));
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(${JSON.stringify({...f.state,vaultNo:77,nextAt:0,note:'parent training72 fixture'})}));${extra}`;};
  const revisit=async()=>{
    await pulse(1000);
    if(await evaluate(`location.pathname!=='/shelter'`))
      await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+sm.fixtureSearch);`);
    await reloadShelter();
  };
  const completed=()=>scene(`const s=sm.view.state,p=s.residents.find(p=>p.id===6);p.roomId=91;p.stats.end=9;p.training=0;
    const record=${state};record.campaign.roles=[{id:6,room:91,role:'training',at:clock-3*3600000,stat:'end',base:8,purpose:'parent',until:p.familyCooldownUntil,destination:4}];
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(record));`);
  const continuous=extra=>scene(`for(const p of sm.view.state.residents){if([5,6].includes(p.id)){p.stats.cha=3;p.stats.end=4;}else p.stats.end=10;}${extra||''}`);
  const finishFirst=async()=>{
    await evaluate(`const p=sm.view.state.residents.find(p=>p.id===5);p.stats.end=5;p.training=0;clock+=2*3600000;
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);await revisit();
  };
  const duplicateRoom=stat=>continuous(`sm.view.state.rooms.push({...sm.view.state.rooms.find(r=>r.id===90),id:93,trainStat:'${stat}',floor:3,col:4});`);
  await t.test('父母候选浏览器：相同魅力室不挤掉耐力接续，两次返岗刷新不重复',async()=>{
    await setupShelter(duplicateRoom('cha'));
    await drive(`${state}.campaign.roles.some(r=>r.id===5&&r.room===91)&&!${pending}`,'equivalent rooms preserve first endurance cell',160);
    await evaluate('sm.view.state.residents.find(p=>p.id===5).training=.5;');await revisit();
    await drive(done,'first cell remains committed',160);
    await finishFirst();await drive(`${state}.campaign.roles.some(r=>r.id===6&&r.room===91)&&!${pending}`,'partner chosen after first return',160);
    await evaluate(`const p=sm.view.state.residents.find(p=>p.id===6);p.stats.end=5;p.training=0;clock+=2*3600000;
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);await revisit();await drive(done,'second return completed',160);
    await revisit();await drive(done,'duplicate-room route stays complete',160);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[5,6].includes(c.residentId)).map(c=>[c.residentId,c.roomId])`),[[5,91],[5,4],[6,91],[6,4]]);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.roomId===93)`),false);
  });
  await t.test('父母候选浏览器：确认前代表房间消失，撤销原安排并使用仍存在的等价房间',async()=>{
    await setupShelter(duplicateRoom('end'));
    await drive(`!!document.querySelector('[data-staff-dialog="5"]')`,'first room confirmation',160);
    await evaluate('sm.view.state.rooms=sm.view.state.rooms.filter(r=>r.id!==91);');
    await drive(done,'missing selected room cancels pending confirmation',160);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.roomId===91)`),false);
    await revisit();await drive(`${state}.campaign.roles.some(r=>r.id===5&&r.room===93)&&!${pending}`,'remaining admitted room selected',160);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5).map(c=>c.roomId)`),[93]);
  });
  const supplyCompetition=()=>continuous('for(const p of sm.view.state.residents.filter(p=>[1,2,3,9].includes(p.id)))p.stats.end=2;');
  await t.test('训练竞争浏览器：供给工低耐力不挡父母两格，全程守原岗且刷新不重复',async()=>{
    await setupShelter(supplyCompetition());
    await drive(`${state}.campaign.roles.some(r=>r.id===5&&r.room===91)&&!${pending}`,'supply workers are not endurance competitors',160);
    await evaluate('sm.view.state.residents.find(p=>p.id===5).training=.5;');await revisit();
    await drive(done,'first parent commitment survives refresh',160);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===6)`),false);
    await finishFirst();await drive(`${state}.campaign.roles.some(r=>r.id===6&&r.room===91)&&!${pending}`,'second parent after actual return',160);
    await evaluate(`const p=sm.view.state.residents.find(p=>p.id===6);p.stats.end=5;p.training=0;clock+=2*3600000;
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);await revisit();await drive(done,'second parent returned',160);
    await revisit();await drive(done,'completed low-END supply scene survives refresh',160);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[5,6].includes(c.residentId)).map(c=>[c.residentId,c.roomId])`),[[5,91],[5,4],[6,91],[6,4]]);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&[1,2,3,9].includes(c.residentId))`),false);
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[1,2,3,9].includes(p.id)).map(p=>[p.id,p.roomId])'),[[1,1],[2,2],[3,3],[9,1]]);
  });
  await t.test('训练竞争浏览器：确认前供给工转回收岗，撤销过时父母路线并重新评估',async()=>{
    await setupShelter(supplyCompetition());
    await drive(`!!document.querySelector('[data-staff-dialog="5"]')`,'first parent confirmation before competing job change',160);
    await evaluate(`const p=sm.view.state.residents.find(p=>p.id===1),replacement=sm.view.state.residents.find(p=>p.id===7);
      replacement.stats.str=p.stats.str;p.roomId=4;replacement.roomId=1;`);
    await drive(done,'changed occupation is re-evaluated before submission',160);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5&&c.roomId===91)`),false);
    await revisit();await drive(done,'changed scene continues with single-cell choice',160);
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5&&c.roomId===90)`));
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===1&&c.roomId===91)`));
  });
  await t.test('父母连续训练浏览器：两人依次完成耐力并各自返岗，刷新不重练或同时入训',async()=>{
    await setupShelter(continuous());await drive(`${state}.campaign.roles.some(r=>r.id===5&&r.room===91)&&!${pending}`,'first endurance cell',160);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===6&&c.roomId===91)`),false);
    const until=await evaluate(`${state}.campaign.roles.find(r=>r.id===5).until`);
    await evaluate(`sm.view.state.residents.find(p=>p.id===5).training=.5;`);await revisit();await drive(done,'original first cell survives refresh',160);
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===5).until`),until);
    await finishFirst();await drive(`${state}.campaign.roles.some(r=>r.id===6&&r.room===91)&&!${pending}`,'partner re-evaluated after first return',160);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),4);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[5,6].includes(c.residentId)).map(c=>[c.residentId,c.roomId])`),[[5,91],[5,4],[6,91]]);
    await evaluate(`const p=sm.view.state.residents.find(p=>p.id===6);p.stats.end=5;p.training=0;clock+=2*3600000;
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);await revisit();await drive(done,'both parents returned',160);
    await revisit();await drive(done,'completed route stays complete',160);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[5,6].includes(c.residentId)).map(c=>[c.residentId,c.roomId])`),[[5,91],[5,4],[6,91],[6,4]]);
    assert.deepEqual(await evaluate(`${state}.campaign.trainingRest.map(r=>r.id).sort()`),[5,6]);
  });
  await t.test('父母连续训练浏览器：第二人发送前冷却不足时取消，恢复条件后重新评估',async()=>{
    await setupShelter(continuous());await drive(`${state}.campaign.roles.some(r=>r.id===5&&r.room===91)&&!${pending}`,'first parent starts',160);
    await finishFirst();await drive(`!!document.querySelector('[data-staff-dialog="6"]')`,'partner confirmation',160);
    const deadline=await evaluate('sm.view.state.residents.find(p=>p.id===6).familyCooldownUntil');
    await evaluate(`sm.view.state.residents.find(p=>p.id===6).familyCooldownUntil=clock+1800000;`);
    await drive(done,'partner no longer fits cooldown',160);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===6&&c.roomId===91)`),false);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).stats.end'),5);
    await evaluate(`sm.view.state.residents.find(p=>p.id===6).familyCooldownUntil=${deadline};`);await revisit();
    await drive(`${state}.campaign.roles.some(r=>r.id===6&&r.room===91)&&!${pending}`,'partner eligibility restored',160);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===6&&c.roomId===91).length`),1);
  });
  await t.test('父母连续训练浏览器：第二格原请求未知跨刷新不重发，第一格成果与原返岗保留',async()=>{
    await setupShelter(continuous());await drive(`${state}.campaign.roles.some(r=>r.id===5&&r.room===91)&&!${pending}`,'first parent starts',160);
    await finishFirst();await drive(`sm.view.state.residents.find(p=>p.id===5).roomId===4&&!${pending}`,'first return confirmed',160);
    await evaluate('sm.assignUnknown=true;');await drive(`!!${pending}&&sm.calls.some(c=>c.type==='assign'&&c.residentId===6&&c.roomId===91)`,'second cell outcome unknown',160);
    const original=await evaluate(pending);assert.deepEqual(original.targets,[6,91]);
    await revisit();await drive(done,'unknown partner cell retained',160);
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[5,6].includes(c.residentId)).map(c=>[c.residentId,c.roomId])`),[[5,91],[5,4],[6,91]]);
    assert.equal(await evaluate(`${state}.campaign.roles.some(r=>r.id===6)`),false);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).stats.end'),5);
  });
  await t.test('父母连续训练浏览器：原魅力格已开始时不为两格预测改练或派伴侣',async()=>{
    await setupShelter(continuous(`const p=sm.view.state.residents.find(p=>p.id===5);p.roomId=90;p.training=.5;
      const record=${state};record.campaign.roles=[{id:5,room:90,role:'training',at:clock,stat:'cha',base:3,purpose:'parent',until:p.familyCooldownUntil,destination:4}];
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(record));`));
    const role=await evaluate(`${state}.campaign.roles.find(r=>r.id===5)`);await drive(done,'current charisma cell protected',160);
    await revisit();await drive(done,'original commitment survives refresh',160);
    assert.deepEqual(await evaluate(`${state}.campaign.roles.find(r=>r.id===5)`),role);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&[5,6].includes(c.residentId))`),false);
  });
  await t.test('父母连续训练浏览器：存在竞争生产训练时保留单格选择，不为预测冻结其他居民',async()=>{
    await setupShelter(continuous('sm.view.state.residents.find(p=>p.id===7).stats.end=5;'));
    await drive(done,'competing continuation uses original admission',160);
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5&&c.roomId===90)`));
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===7&&c.roomId===91)`));
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5&&c.roomId===91)`),false);
  });
  await t.test('父母返岗浏览器：原岗不被后来成人占用，刷新保留且完成后一步返岗',async()=>{
    await setupShelter(scene());await drive(`${state}.campaign.roles.some(r=>r.id===6)&&!${pending}`,'parent training recorded',160);
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===6).destination`),4);
    await evaluate(`const s=sm.view.state;s.rooms=s.rooms.filter(r=>r.id!==92);
      s.residents.find(p=>p.id===6).training=.5;
      s.residents.push({...structuredClone(s.residents[3]),id:10,name:'已有工人',roomId:4},
        {...structuredClone(s.residents[3]),id:11,name:'后来成人',roomId:null});`);
    await revisit();await drive(done,'parent seat remains held',160);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===11&&c.roomId===4)`),false);
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===6).destination`),4);
    await evaluate(`const p=sm.view.state.residents.find(p=>p.id===6);p.stats.end=9;p.training=0;clock+=3*3600000;
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);
    await revisit();await drive(`sm.view.state.residents.find(p=>p.id===6).roomId===4&&!${pending}`,'one-step parent return',160);
    await drive(done,'return settled',160);await revisit();await drive(done,'return survives refresh',160);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===6).map(c=>c.roomId)`),[91,4]);
    assert.equal(await evaluate(`${state}.campaign.trainingRest.filter(r=>r.id===6).length`),1);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===11&&c.roomId===4)`),false);
  });
  await t.test('父母返岗浏览器：返岗原单未知时刷新不重发，不释放原岗位承诺',async()=>{
    await setupShelter(completed()+'sm.assignUnknown=true;');
    await drive(`!!${pending}&&sm.calls.some(c=>c.type==='assign'&&c.residentId===6)`,'unknown parent return',160);
    const original=await evaluate(pending);assert.deepEqual(original.targets,[6,4]);
    await revisit();await drive(done,'unknown return retained',160);
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===6).length`),1);
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===6).destination`),4);
    assert.equal(await evaluate(`${state}.campaign.trainingRest.some(r=>r.id===6)`),false);
  });
  await t.test('父母返岗浏览器：训练室合并后快速就业先运行也不占用原返岗席位',async()=>{
    await setupShelter(scene(`const s=sm.view.state,p=s.residents.find(p=>p.id===6),room=s.rooms.find(r=>r.id===91);
      room.id=89;p.roomId=89;p.training=.5;s.rooms=s.rooms.filter(r=>r.id!==92);
      s.residents.push({...structuredClone(s.residents[3]),id:10,name:'已有工人',roomId:4},
        {...structuredClone(s.residents[3]),id:11,name:'后来成人',roomId:null});
      const record=${state};record.campaign.roles=[{id:6,room:91,role:'training',at:clock-3600000,stat:'end',base:8,purpose:'parent',until:p.familyCooldownUntil,destination:4}];
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(record));`));
    await drive(done,'merged parent duty keeps its return seat',160);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===11&&c.roomId===4)`),false);
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===6).room`),89);
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===6).destination`),4);
    await revisit();await drive(done,'merged training survives refresh',160);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&[6,11].includes(c.residentId))`),false);
  });
  await t.test('父母返岗浏览器：确认前岗位被占、身份或冷却变化均取消原返岗',async()=>{
    for(const change of [
      `for(const id of [10,11])sm.view.state.residents.push({...structuredClone(sm.view.state.residents[3]),id,name:'已占岗'+id,roomId:4});`,
      `sm.view.state.residents.find(p=>p.id===6).name='';`,
      `sm.view.state.residents.find(p=>p.id===6).familyCooldownUntil=clock;`]){
      await setupShelter(completed());await drive(`!!document.querySelector('[data-staff-dialog="6"]')`,'parent return dialog',160);
      await evaluate(change);await drive(done,'invalid parent return cancelled',160);
      assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===6&&c.roomId===4)`),false);
    }
  });
  await t.test('父母训练三天浏览器：实际选择有效耐力，完成格返岗，刷新不重开原训练',async()=>{
    await setupShelter(scene());await drive(`${state}.campaign.roles.some(r=>r.id===6&&r.room===91)&&!${pending}`,'selected endurance committed',160);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===6&&c.roomId===91).length`),1);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&[5,6].includes(c.residentId)&&c.roomId===90)`),false);
    const until=await evaluate(`${state}.campaign.roles.find(r=>r.id===6).until`);
    await evaluate(`sm.view.state.residents.find(p=>p.id===6).training=.4;`);await revisit();await drive(done,'original training continues',160);
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===6).until`),until);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===6).length`),1);
    await evaluate(`const p=sm.view.state.residents.find(p=>p.id===6);p.stats.end=9;p.training=0;clock+=3*3600000;
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);await revisit();
    await drive(`sm.view.state.residents.find(p=>p.id===6).roomId!==91&&!${pending}`,'completed training returns',160);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===6&&c.roomId===91).length`),1);
  });
  await t.test('父母训练三天浏览器：只有原魅力培养路线时保留首格，不因单格取整形成永久禁训',async()=>{
    await setupShelter(scene(`sm.view.state.rooms=sm.view.state.rooms.filter(r=>r.id!==91);`));await drive(done,'training prerequisite preserved',160);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[5,6].includes(c.residentId)&&c.roomId===90).length`),1);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='build'||c.type==='upgrade')`),false);
    assert.ok(await evaluate(`sm.view.state.residents.some(p=>[5,6].includes(p.id)&&p.roomId===4)`));
  });
  await t.test('父母训练三天浏览器：未知入室原单刷新保留，不重选属性或重发',async()=>{
    await setupShelter(scene('sm.assignUnknown=true;'));await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===6)`,'unknown chosen training',160);
    const id=await evaluate(`${pending}.id`);assert.equal(await evaluate(`${pending}.targets[1]`),91);
    await revisit();await drive(done,'unknown training retained',160);
    assert.equal(await evaluate(`${pending}.id`),id);assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign').length`),1);
    assert.equal(await evaluate(`${state}.campaign.roles.length`),0);
  });
  await t.test('父母训练三天浏览器：开窗后冷却结束或身份变化，撤销未发送训练',async()=>{
    for(const change of [`sm.view.state.residents.find(p=>p.id===6).familyCooldownUntil=clock;`,
      `sm.view.state.residents.find(p=>p.id===6).name='';`]){
      await setupShelter(scene());await drive(`!!document.querySelector('[data-staff-dialog="6"]')`,'selected parent dialog',160);
      await evaluate(change);await drive(done,'training no longer admissible',160);
      assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===6&&c.roomId===91)`),false);
      assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('父母训练三天浏览器：原魅力已练到半格时继续原格，不按新排序改练耐力',async()=>{
    await setupShelter(scene(`const p=sm.view.state.residents.find(p=>p.id===6);p.roomId=90;p.training=.5;
      const record=${state};record.campaign.roles=[{id:6,room:90,role:'training',at:clock,stat:'cha',base:9,purpose:'parent',until:p.familyCooldownUntil}];
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(record));`));
    const role=await evaluate(`${state}.campaign.roles.find(r=>r.id===6)`);await drive(done,'existing charm cell protected',160);
    await revisit();await drive(done,'original cell preserved after refresh',160);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===6)`),false);
    assert.deepEqual(await evaluate(`${state}.campaign.roles.find(r=>r.id===6)`),role);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===6).training`),.5);
  });
}
