import assert from 'node:assert/strict';
import {futureEmploymentScene} from './arkengine-shelter-future-employment.fixture.mjs';

export async function shelterFutureEmploymentTests({t,setupShelter,reloadShelter,evaluate,pulse,drive}){
  const state=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`,
    pending=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`,
    builds=`sm.calls.filter(c=>c.type==='build'&&c.room==='scrap')`,
    done=`location.pathname==='/activities/expedition'&&${state}?.nextAt>clock`;
  const scene=(extra='')=>{const f=futureEmploymentScene();return `sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;
    sm.fixtureSearch=location.search;sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    sm.confirmFamily=true;sm.constructionOpens=0;const priorOpen=openConstruction;
    window.openConstruction=(...args)=>{sm.constructionOpens++;return priorOpen(...args);};
    localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
    localStorage.setItem('arkengine:auto-shelter:population:v1','20');
    localStorage.setItem('arkengine:auto-shelter:population-continuous:v1','false');
    localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify({tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6,
      ...f.campaign,development:false,workshop:false,defense:false,craftDaily:false})}));
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify({...f.construction,upgrade:false,dig:false})}));
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(${JSON.stringify({...f.state,vaultNo:77,nextAt:0,note:'future employment fixture'})}));${extra}`;};
  const revisit=async()=>{
    await pulse(1000);
    if(await evaluate(`location.pathname!=='/shelter'`))
      await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+sm.fixtureSearch);`);
    await reloadShelter();
  };
  await t.test('未来岗位浏览器：先建儿童岗位，刷新不重建，成年实际就业后保持增长可用',async()=>{
    await setupShelter(scene());await drive(`${builds}.length===1&&!${pending}`,'future job built',160);
    const calls=await evaluate('sm.calls'),index=calls.findIndex(c=>c.type==='build'&&c.room==='scrap');
    assert.ok(!calls.slice(0,index).some(c=>c.type==='assign'&&[5,30].includes(c.roomId)),JSON.stringify(calls));
    assert.ok(!calls.some(c=>c.type==='assign'&&[12,13].includes(c.residentId)));
    assert.equal(await evaluate('sm.constructionOpens'),1);
    await revisit();await drive(done,'construction survives refresh',160);
    assert.equal(await evaluate(`${builds}.length`),1);
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&[5,30].includes(c.roomId))`),'confirmed construction releases growth');
    await evaluate(`clock=sm.view.state.residents.find(p=>p.id===13).adultAt+600000;sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);
    await revisit();await drive(`[12,13].every(id=>{const p=sm.view.state.residents.find(p=>p.id===id);return sm.view.state.rooms.some(r=>r.id===p.roomId&&r.type==='scrap');})&&!${pending}`,
      'children reach actual jobs',180);
    assert.equal(await evaluate(`${builds}.length`),1);
    assert.ok(await evaluate(`sm.view.state.residents.filter(p=>[12,13].includes(p.id)).every(p=>p.adultAt<=clock)`));
  });
  await t.test('未来岗位浏览器：未知建设原单跨刷新保留，不重建或提前按完工恢复增长',async()=>{
    await setupShelter(scene('sm.mode="unknown";'));await drive(`${builds}.length===1`,'unknown child job build',160);
    const id=await evaluate(`${pending}.id`);await revisit();await drive(done,'unknown job build retained',160);
    assert.equal(await evaluate(`${pending}.id`),id);assert.equal(await evaluate(`${builds}.length`),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign').length`),0);
    assert.equal(await evaluate(`${state}.constructionLedger?.length||0`),0);
  });
  await t.test('未来岗位浏览器：开窗后儿童身份、成年时间或预算变化均撤销未发送工程',async()=>{
    for(const change of [`sm.view.state.residents.find(p=>p.id===13).name='';`,
      `sm.view.state.residents.find(p=>p.id===13).adultAt=clock+73*3600000;`,
      `sm.view.state.resources.scrap=100;`]){
      await setupShelter(scene());await drive(`!!document.querySelector('[data-construction-dialog]')`,'future job native quote',160);
      await evaluate(change);await drive(done,'future job evidence changed',160);
      assert.equal(await evaluate(`${builds}.length`),0);assert.equal(await evaluate(pending),null);
      assert.equal(await evaluate('sm.constructionOpens'),1);
    }
  });
  await t.test('未来岗位浏览器：给儿童建设时保留当前训练格及其原返岗席位',async()=>{
    await setupShelter(scene(`const s=sm.view.state;
      s.rooms.push({...s.rooms[0],id:31,type:'training',trainStat:'end',floor:3,col:3,level:1});
      s.residents.push({...structuredClone(s.residents[3]),id:14,name:'原训练',roomId:31,training:.4});
      const cfg=JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1'));cfg.training=true;cfg.trainTarget=10;
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(cfg));
      const record=${state};record.campaign.roles=[{id:14,room:31,role:'training',purpose:'production',destination:4,
        at:clock,stat:'end',base:8,until:clock+3600000,windowEnd:clock+168*3600000}];
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(record));`));
    await drive(`${builds}.length===1&&!${pending}`,'child construction with reserved training',160);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===14)`),false);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===14).training`),.4);
    await revisit();await drive(done,'training reserved after refresh',160);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===14)`),false);
    assert.equal(await evaluate(`${builds}.length`),1);
  });
}
