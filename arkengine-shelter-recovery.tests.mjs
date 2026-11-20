import assert from 'node:assert/strict';
import {recoveryScene,assignmentHold,equipmentPending,recoveryBrowserSetup} from './arkengine-shelter-recovery.fixture.mjs';

export async function shelterRecoveryTests({t:testContext,setupShelter,reloadShelter,evaluate,drive,pulse}){
  const pending="JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))";
  const schedule="JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))";
  await testContext.test('恢复回归浏览器：隔离发电者不提议调离90%训练者，闲人继续就业',async()=>{
    const sample=recoveryScene();sample.record.assignmentHolds=[assignmentHold(sample.view,sample.state.residents[0])];
    await setupShelter(recoveryBrowserSetup(sample));
    for(let tick=0;tick<30;tick++)await pulse(1000);
    const result=await evaluate(`({calls:sm.calls,training:sm.view.state.residents.find(person=>person.id===5).training,
      decisions:(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(event=>event.type==='shelter-staff-decision').map(event=>({id:event.data.residentId,role:event.data.role}))})`);
    assert.equal(result.decisions.some(action=>action.id===5&&action.role==='training-release'),false);
    assert.equal(result.calls.some(action=>action.type==='assign'&&action.residentId===6),true);
    assert.equal(result.training,.9);
  });
  for(const duplicated of [false,true])await testContext.test('恢复回归浏览器：居民详情同窗关闭入口数量 '+(duplicated?2:1),async()=>{
    const sample=recoveryScene();sample.trainee.roomId=null;sample.cfg.training=false;
    await setupShelter(recoveryBrowserSetup(sample)+`sm.quickAssign=false;const originalOpen=openResident;window.openResident=id=>{
      originalOpen(id);const dialog=document.querySelector('[data-staff-dialog]');
      ${duplicated?`const button=document.createElement('button');button.setAttribute('aria-label','关闭');button.textContent='关闭';button.onclick=closeResident;dialog.append(button);`:''}};`);
    await drive(`sm.calls.some(action=>action.type==='assign')`,'detail assignment submitted',80);
    await pulse(20000);
    await drive(`!document.querySelector('[data-staff-dialog]')||localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'detail closed or paused',80);
    assert.equal(await evaluate(`!!document.querySelector('[data-staff-dialog]')`),false);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'true');
  });
  for(const slot of ['weapon','outfit'])await testContext.test('恢复回归浏览器：'+slot+'旧520不阻塞到期召回，刷新不重发原单',async()=>{
    const sample=recoveryScene();sample.trainee.roomId=null;
    Object.assign(sample.cfg,{training:false,explore:true,combatGear:false});
    sample.state.residents.find(person=>person.id===6).away={kind:'explore'};
    sample.state.explorers=[{id:901,residentId:6,tier:0,abyss:false,startedAt:sample.view.serverTime-8*3600000,
      recalledAt:null,returnAt:null,stimpaks:2,loot:{scrap:0,parts:0,stimpak:0,items:[]}}];
    sample.record.trips=[{id:901,resident:6,hours:6,at:sample.view.serverTime-8*3600000,
      startedAt:sample.view.serverTime-8*3600000,vaultNo:77}];
    sample.state.items=[{id:173,slot,name:'测试装备',damage:[11,18],bonus:{int:5}}];
    const saved=equipmentPending(sample.view,slot);
    await setupShelter(recoveryBrowserSetup(sample)+`
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(${JSON.stringify(saved)}));`);
    await drive(`sm.calls.some(action=>action.type==='explore_recall'&&action.explorerId===901)&&!${pending}`,'independent due recall',100);
    assert.deepEqual(await evaluate(`${schedule}.campaign.equipmentHolds[0].original`),saved);
    assert.equal(await evaluate(`sm.calls.some(action=>action.type==='equip')`),false);
    await evaluate(`history.replaceState({},'','/shelter'+sm.recoverySearch);renderShelter();
      document.getElementById('ark-auto-expedition').shadowRoot.getElementById('shelter-check').click();`);
    await reloadShelter();await pulse(20000);
    assert.equal(await evaluate(`${schedule}.campaign.equipmentHolds.length`),1);
    assert.equal(await evaluate(`${schedule}.campaign.equipmentHolds[0].resolvedAt`),undefined);
    assert.equal(await evaluate(`sm.calls.some(action=>action.type==='equip'||action.type==='assign'&&action.residentId===4)`),false);
    assert.equal(await evaluate(`sm.calls.filter(action=>action.type==='explore_recall'&&action.explorerId===901).length`),1);
  });
  for(const applied of [false,true])await testContext.test('恢复回归浏览器：实时装备520'+(applied?'已改变归属':'未改变归属')+'只发送一次，其他人员继续',async()=>{
    const sample=recoveryScene();sample.trainee.roomId=4;sample.cfg.training=false;sample.cfg.combatGear=true;
    sample.state.residents[5].roomId=2;
    sample.state.items=[{id:173,slot:'weapon',name:'轨道步枪',damage:[11,18]}];
    await setupShelter(recoveryBrowserSetup(sample)+`const previousFetch=window.fetch;window.fetch=async(url,options)=>{
      if(url==='/api/shelter/action'&&options?.method==='POST'){
        const envelope=JSON.parse(options.body);
        if(envelope.action.type==='equip'){
          sm.failedEquipment=envelope;sm.calls.push({...envelope.action,idempotencyKey:envelope.idempotencyKey});
          ${applied?`sm.view.state.residents.find(person=>person.id===envelope.action.residentId).weaponId=envelope.action.itemId;`:''}
          return new Response('{}',{status:520});
        }
      }
      return previousFetch(url,options);};`);
    await drive(`${schedule}?.campaign?.equipmentHolds?.length===1&&!${pending}`,'archive live equipment error',100);
    const entry=await evaluate(`${schedule}.campaign.equipmentHolds[0]`);
    assert.equal(entry.original.result.status,520);
    assert.equal(entry.original.result.campaignProof,undefined);
    assert.equal(entry.resolvedAt!==undefined,applied);
    assert.equal(await evaluate(`sm.calls.filter(action=>action.type==='equip').length`),1);
    assert.deepEqual(entry.original.before.equipment,{fromItem:null,owners:[]});
    await evaluate(`sm.view.state.residents.find(person=>person.id!==sm.failedEquipment.action.residentId).roomId=null;
      history.replaceState({},'','/shelter'+sm.recoverySearch);renderShelter();
      document.getElementById('ark-auto-expedition').shadowRoot.getElementById('shelter-check').click();`);
    await reloadShelter();
    await drive(`sm.calls.some(action=>action.type==='assign'&&action.residentId!==sm.failedEquipment.action.residentId)`,'other resident remains employable',100);
    assert.equal(await evaluate(`sm.calls.filter(action=>action.type==='equip').length`),1);
    assert.equal(await evaluate(`${schedule}.campaign.equipmentHolds.length`),1);
  });
}
