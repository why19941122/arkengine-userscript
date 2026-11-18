import assert from 'node:assert/strict';
import {campaignView,workshopChurnView} from './arkengine-shelter-campaign.fixture.mjs';
import {readyCampaignConstructionScene} from './arkengine-shelter-growth-investment.fixture.mjs';

export async function shelterLog127Tests({t,setupShelter,reloadShelter,evaluate,drive,pulse}){
  const state=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`,
    pending=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`,
    done=`location.pathname==='/activities/expedition'&&${state}?.nextAt>clock`;
  const flags={explore:false,quests:false,training:false,parentPreparation:false,medical:false,radio:false,combatGear:false,
    defense:false,dailyGoals:false,help:false,craftDaily:false,caravanDaily:false,tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6};
  const scene=f=>`sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.fixtureSearch=location.search;
    sm.ui20261109=true;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:population:v1','17');
    localStorage.setItem('arkengine:auto-shelter:population-continuous:v1','false');
    localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(${JSON.stringify({...flags,...f.campaign})}));
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(${JSON.stringify({...f.state,vaultNo:f.view.vaultNo,nextAt:0,note:'log127 fixture'})}));`;
  const record=()=>({families:[],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}});
  const disabled={build:false,upgrade:false,dig:false,scrapLimit:10000,partsLimit:100,scrapReserve:0,partsReserve:0};
  await t.test('128原生：旧设置0不改写晶体平原，原生普通出发及回执都保留区域2',async()=>{
    const view=campaignView();view.state.depth=20;view.drops.tierPermille=[60,85,108];
    await setupShelter(scene({view,state:record(),campaign:{explore:true,sodaEfficiency:true},construction:disabled}));
    await drive(`sm.calls.some(c=>c.type==='explore_start')&&!${pending}`,'native highest departure');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='explore_start').map(c=>[c.tier,c.abyss])`),[[2,false]]);
    assert.equal(await evaluate('sm.exploreTier===undefined'),true);
    const submitted=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='shelter-submitted'&&e.data.kind==='explore-start')`);
    assert.deepEqual(submitted.data.nativeTier,{highest:2,selected:2,configuredCap:0});
    const calls=await evaluate('sm.calls'),departure=calls.findIndex(c=>c.type==='explore_start');
    assert.ok(!calls.slice(0,departure).some(c=>c.type==='assign'&&c.residentId===calls[departure].residentId));
  });
  await t.test('131过期调岗：跨业务期限后在同次访问重读重选，只发一次',async()=>{
    const view=campaignView();view.state.resources.scrap=10;view.state.rooms.find(r=>r.id===4).width=2;
    view.state.residents[0].familyCooldownUntil=view.serverTime+630000;
    await setupShelter(scene({view,state:record(),campaign:{},construction:disabled})+`sm.quickAssign=false;`);
    await drive(`!!document.querySelector('[data-staff-dialog]')`,'first resident dialog');
    const id=await evaluate(`Number(document.querySelector('[data-staff-dialog]').dataset.staffDialog)`);
    await pulse(31000);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===${id})&&!${pending}`,'fresh choice sent in same visit');
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.map(e=>[e.type,e.data?.reason,e.data?.targets])`);
    assert.ok(events.some(([type,reason,targets])=>type==='shelter-execution-evidence'&&reason==='deadline'&&targets[0]===id));
    assert.ok(!events.some(([type])=>type==='shelter-check'));
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===${id}).length`),1);
  });
  for(const mode of ['full','target','ended','no-progress','unknown','missing'])await t.test(`128原生：房间一键救援 ${mode}`,async()=>{
    const view=campaignView(),room=view.state.rooms[0];room.type='door';room.incident={kind:'raiders',hp:98,maxHp:100};
    const initial=mode==='full'?0:96;
    view.state.residents=Array.from({length:110},(_,index)=>({...structuredClone(view.state.residents[0]),id:index+1,name:'救援'+(index+1),roomId:index<initial?room.id:2}));
    const init=scene({view,state:record(),campaign:{defense:true},construction:disabled});
    await setupShelter(init+`localStorage.setItem('arkengine:auto-shelter:staff:v1','off');sm.endRescue=${mode==='ended'};sm.rescueNoProgress=${mode==='no-progress'};sm.hideRescue=${mode==='missing'};sm.mode='${mode==='unknown'?'unknown':'normal'}';`);
    if(mode==='unknown'){
      await drive(`sm.calls.some(c=>c.type==='rescue_incident')`,'unknown rescue sent');
      for(let step=0;step<5;step++)await pulse(4000);
      assert.equal(await evaluate(`${pending}?.kind`),'rescue');
    }else await drive(done,'room rescue settles without reassigning',200);
    if(mode==='no-progress'){
      const saved=await evaluate(state),history=await evaluate('sm.calls');assert.equal(saved.rescueStops.length,1);assert.equal(history.length,1);
      await setupShelter(init+`sm.rescueNoProgress=true;sm.calls=${JSON.stringify(history)};localStorage.setItem('arkengine:auto-shelter:staff:v1','off');
        localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(saved)},nextAt:0}));`);
      await drive(done,'new page with persisted exhausted roster does not retry a no-op',80);
    }
    const calls=await evaluate(`sm.calls.map(c=>[c.type,c.roomId])`);
    assert.equal(calls.filter(([kind])=>kind==='assign').length,0);
    assert.deepEqual(calls.filter(([kind])=>kind==='rescue_incident'),Array.from({length:mode==='full'?34:mode==='target'?2:mode==='missing'?0:1},()=>['rescue_incident',room.id]));
    assert.equal(await evaluate(`sm.view.state.residents.filter(p=>p.roomId===1).length`),['full','target'].includes(mode)?102:initial);
    assert.deepEqual(await evaluate(`${state}.campaign?.defense||[]`),[]);
  });
  await t.test('日志127浏览器：下挖期间旧楼层实际开工并补员，刷新不重复建房',async()=>{
    const view=workshopChurnView(),s=view.state;s.resources.scrap=800;s.residents.find(p=>p.id===21).roomId=4;
    for(const p of s.residents.filter(p=>[35,36].includes(p.id))){p.roomId=5;p.parents=[1,2];}
    s.digging={floor:s.depth+1,doneAt:view.serverTime+3*3600000};
    await setupShelter(scene({view,state:record(),campaign:{},construction:{...disabled,build:true}}));
    await drive(`sm.calls.some(c=>c.type==='build'&&c.room==='scrap')`,'old-floor employment starts',220);
    await drive(done,'construction visit completes',220);
    const builds=await evaluate(`sm.calls.filter(c=>c.type==='build')`);assert.equal(builds.length,1);
    assert.ok(builds[0].floor<=s.depth);
    await pulse(11*60000);await evaluate(`sm.view.state.lastSettledAt=clock;
      document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+sm.fixtureSearch);`);
    await reloadShelter();await drive(`sm.calls.some(c=>c.type==='assign'&&[35,36].includes(c.residentId))`,'employment after construction',220);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build').length`),1);
  });
  await t.test('日志127浏览器：探险携针跨六支阈值，护士保持原岗且刷新不重复派遣',async()=>{
    const view=campaignView(),s=view.state;s.resources.stimpak=7.8;
    s.rooms.push({...s.rooms[0],id:30,type:'medbay',floor:3,col:2,level:1});s.residents[4].roomId=30;
    const stateValue=record();stateValue.campaign.roles=[{id:5,room:30,role:'medical',at:view.serverTime-1000}];
    await setupShelter(scene({view,state:stateValue,campaign:{explore:true,medical:true},construction:disabled}));
    await drive(`sm.calls.some(c=>c.type==='explore_start')`,'departure takes needles',200);await drive(done,'nurse kept',220);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5)`),false);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),30);
    const count=await evaluate(`sm.calls.filter(c=>c.type==='explore_start').length`);
    // Let the completed SPA return clear its navigation journal before a new visit.
    await pulse(1000);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+sm.fixtureSearch);`);
    await reloadShelter();await drive(done,'reload keeps nurse',220);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='explore_start').length`),count);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5)`),false);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),30);
  });
  await t.test('日志127浏览器：已完成生产训练跨原截止边界仍一次返岗，未知原单保持防重',async()=>{
    for(const unknown of [false,true]){
      const f=readyCampaignConstructionScene(),s=f.view.state,p=s.residents.find(p=>p.id===5);
      Object.assign(p,{roomId:90,training:0});p.stats.end=2;f.construction=disabled;
      f.state.campaign.roles=[{id:5,room:90,role:'training',purpose:'production',stat:'end',base:1,
        at:f.view.serverTime-3600000,until:f.view.serverTime+620000,windowEnd:f.view.serverTime+86400000,destination:4}];
      await setupShelter(scene(f)+`sm.quickAssign=false;sm.assignUnknown=${unknown};`);
      await drive(`!!document.querySelector('[data-staff-dialog="5"]')`,'completed training return dialog',180);
      await pulse(30000);
      await drive(unknown?`!!${pending}&&sm.calls.some(c=>c.type==='assign'&&c.residentId===5)`:
        `sm.view.state.residents.find(p=>p.id===5).roomId===4&&!${pending}`,'return submitted across old timer',220);
      assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>
        e.type==='shelter-execution-evidence'&&e.data.targets?.[0]===5&&e.data.reason==='deadline')`),false);
      await reloadShelter();await drive(done,'return refresh',220);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5&&c.roomId===4).length`),1);
      if(unknown)assert.deepEqual(await evaluate(`${pending}.targets`),[5,4]);
    }
  });
}
