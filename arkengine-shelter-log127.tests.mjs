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
  await t.test('157延迟救援按钮：已拥有的房间窗口等原生按钮渲染，只发送一次',async()=>{
    const view=campaignView();view.state.rooms[0].incident={kind:'raiders',hp:20,maxHp:20};
    await setupShelter(scene({view,state:record(),campaign:{defense:true},construction:disabled})+
      `localStorage.setItem('arkengine:auto-shelter:staff:v1','off');sm.endRescue=true;
      const original=openConstruction;window.openConstruction=(...args)=>{original(...args);
        const button=[...document.querySelectorAll('[role="dialog"] button')].find(el=>el.textContent.includes('一键救援'));
        if(button){const parent=button.parentElement;button.remove();sm.showRescue=()=>parent.append(button);}};`);
    await drive(`typeof sm.showRescue==='function'`,'owned room opened without rescue button');await pulse(1000);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='rescue_incident').length`),0);
    await evaluate('sm.showRescue()');await drive(done,'late rescue button submitted and incident ended',120);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='rescue_incident').length`),1);
  });
  const rescueScene=()=>{
    const view=campaignView();view.state.rooms[0].type='door';view.state.rooms[0].incident={kind:'raiders',hp:98,maxHp:100};
    return scene({view,state:record(),campaign:{defense:true},construction:disabled})+
      `localStorage.setItem('arkengine:auto-shelter:staff:v1','off');`;
  };
  for(const legacy of [false,true])await t.test(`救援拒绝浏览器：${legacy?'旧139原单':'当前400响应'}归档后恢复，刷新与岗位变化不重复救援`,async()=>{
    const original={id:'legacy-rescue-400',kind:'rescue',targets:[1],vaultNo:campaignView().vaultNo,
      at:campaignView().serverTime-28*60000,
      lifecycle:{version:1,phase:'request-bound',page:'old-page',requestKey:'legacy-rescue-key',boundAt:campaignView().serverTime-28*60000},
      before:{serverTime:campaignView().serverTime-28*60000,present:69,incidentKind:'raiders',collected:campaignView().state.stats.collected,
        day:campaignView().state.daily.day,month:campaignView().state.season.month},
      result:{status:400,outcome:'http-error',responseFinishedAt:campaignView().serverTime-28*60000+847}};
    const reject=`const rescueFetch=window.fetch;window.fetch=async(url,options)=>{
      if(url==='/api/shelter/action'&&JSON.parse(options?.body||'{}').action?.type==='rescue_incident'){
        const request=JSON.parse(options.body);sm.calls.push({...request.action,idempotencyKey:request.idempotencyKey});
        return new Response(JSON.stringify({error:'本轮无法执行该操作'}),{status:400});}
      return rescueFetch(url,options);};`;
    await setupShelter(rescueScene()+(legacy?`localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(${JSON.stringify(original)}));
      const schedule=JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'));schedule.pendingReadOnly='${original.id}';
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(schedule));`:reject));
    await drive(`!!${state}.rescueRecovery&&!${pending}`,'archive failed rescue',120);
    const recovered=await evaluate(`${state}.rescueRecovery`);
    assert.equal(recovered.outcome,'http-rejected');
    assert.equal(recovered.original.result.status,400);
    if(legacy)assert.deepEqual(recovered.original,original);
    else assert.equal(recovered.original.result.error,'本轮无法执行该操作');
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(event=>event.type==='shelter-confirmed'&&event.data.kind==='rescue')`),false);
    assert.equal(await evaluate('sm.calls.filter(action=>action.type==="rescue_incident").length'),legacy?0:1);
    await drive(done,'finish failed rescue visit',120);
    await pulse(1000);
    await evaluate(`sm.view.state.residents[0].roomId=3;
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${state},nextAt:0}));
      history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
    await reloadShelter();await drive(done,'rejected rescue remains stopped across refresh',120);
    assert.equal(await evaluate('sm.calls.filter(action=>action.type==="rescue_incident").length'),legacy?0:1);
    await pulse(1000);
    await evaluate(`sm.view.state.rooms[0].incident=null;sm.view.state.rooms[1].stored=500;
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${state},nextAt:0}));
      history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
    await reloadShelter();await drive(`sm.calls.some(action=>action.type==='collect_all'||action.type==='collect')&&!${pending}`,'ordinary work resumes after incident',140);
    assert.equal(await evaluate(`${state}.rescueStops.length`),0);
    assert.deepEqual(await evaluate(`${state}.rescueRecovery.original`),recovered.original);
  });
  for(const response of [{status:503,body:{}},{status:400,body:{code:'retry',error:'稍后重试'}}])
    await t.test(`救援拒绝浏览器：${response.status}${response.body.code||''}保留未知原单，刷新不重发`,async()=>{
      await setupShelter(rescueScene()+`const rescueFetch=window.fetch;window.fetch=async(url,options)=>{
        if(url==='/api/shelter/action'&&JSON.parse(options?.body||'{}').action?.type==='rescue_incident'){
          const request=JSON.parse(options.body);sm.calls.push({...request.action,idempotencyKey:request.idempotencyKey});
          return new Response(JSON.stringify(${JSON.stringify(response.body)}),{status:${response.status}});}
        return rescueFetch(url,options);};`);
      await drive(`${pending}?.result?.responseFinishedAt>0`,'failed transport journal');
      const original=await evaluate(pending);
      await drive(done,'unknown rescue remains read only',120);
      await pulse(1000);
      await evaluate(`history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
      await reloadShelter();await drive(done,'unknown rescue survives reload',120);
      assert.equal(await evaluate(`${pending}.id`),original.id);
      assert.equal(await evaluate(`${state}.rescueRecovery===undefined`),true);
      assert.equal(await evaluate('sm.calls.filter(action=>action.type==="rescue_incident").length'),1);
    });
  await t.test('访问收尾浏览器：旧期限导致结束后立即清理，新预约能真正处理产出',async()=>{
    const view=campaignView();view.state.rooms.forEach(room=>room.stored=0);
    await setupShelter(scene({view,state:record(),campaign:{},construction:disabled})+
      `localStorage.setItem('arkengine:auto-shelter:staff:v1','off');
      sessionStorage.setItem('arkengine:auto-shelter:handoff:v1',JSON.stringify({vaultNo:sm.view.vaultNo,
        entryAt:clock-30*60000,expeditionAt:clock+40*60000,regularEnd:clock-25*60000,key:null}));`);
    await drive(done,'finish visit with historical deadline');
    assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-shelter:handoff:v1')`),null);
    await pulse(1000);
    await evaluate(`sm.view.state.rooms[1].stored=500;
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${state},nextAt:0}));
      history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
    await reloadShelter();
    await drive(`sm.calls.some(action=>action.type==='collect_all'||action.type==='collect')&&!${pending}`,'new visit collects after expired budget');
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
