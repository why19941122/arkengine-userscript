import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {workshopBudgetCycleView,reservedGrowthView,familyTrainingSeatView,fourExplorerView} from './arkengine-shelter-campaign.fixture.mjs';
import {powerInvestmentScene} from './arkengine-shelter-power-investment.fixture.mjs';
import {growthInvestmentScene,readyConstructionScene,readyCampaignConstructionScene} from './arkengine-shelter-growth-investment.fixture.mjs';
import {laborInvestmentScene,laborExpansionScene} from './arkengine-shelter-labor-investment.fixture.mjs';
import {parent72Scene} from './arkengine-shelter-parent72.fixture.mjs';
import {createShelterResourceSimulation} from './arkengine-shelter-resource-simulation.mjs';
import {campaignView,levelGateView,upperStageView,materialCycleView,storageChoiceView,handyMaterialView,capacityRouteView,powerPrerequisiteView,digPowerPrerequisiteView,fullPowerPrerequisiteView,workshopUpgradeView,multiWorkshopView,workshopBuildView,workshopPowerCycleView,materialProducerCycleView,populationGrowthView,familyGrowthView,workshopChurnView,dormWorkshopCycleView,familyWorkshopCycleView,workshopFamilyReturnView} from './arkengine-shelter-campaign.fixture.mjs';

export async function shelterCampaignTests({t,setupShelter,reloadShelter,evaluate,drive,pulse,until,trustedStaffKey,withShelterBackground,injectAutomation}){
  const key='arkengine:auto-shelter:campaign:v1',state=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`,
    pending=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`,panel=`document.getElementById('ark-auto-expedition').shadowRoot`,
    done=`location.pathname==='/activities/expedition'&&${state}?.nextAt>clock`;
  const defaults={explore:false,quests:false,training:false,medical:false,radio:false,combatGear:false,tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6};
  const diagnose=()=>evaluate(`({calls:sm.calls,state:${state},pending:${pending},enabled:localStorage.getItem('arkengine:auto-shelter:enabled:v1'),
    status:${panel}.getElementById('shelter-status').textContent,campaign:${panel}.getElementById('shelter-campaign-status').textContent})`);
  const chainReport=async label=>{
    if(!process.env.ARKENGINE_CHAIN_REPORT)return;
    writeFileSync(process.env.ARKENGINE_CHAIN_REPORT+'-'+label.replace(/[^a-zA-Z0-9-]/g,'-')+'.json',
      JSON.stringify(await evaluate(`({view:shelterData(),state:${state},pending:${pending},calls:sm.calls,
        observedSodaPending:sm.savedSodaPending,observedQuestSubmission:sm.growthSubmission,
        origins:sm.assignmentOrigins,receipts:sm.receipts,construction:JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1')),
        campaign:JSON.parse(localStorage.getItem('${key}')),events:(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.slice(-40)})`),null,2));
  };
  const settle=async label=>{try{await drive(done,label);await chainReport(label);}catch(e){await chainReport(label);throw Error(e.message+' '+JSON.stringify(await diagnose()));}};
  const familyWorkerProbe=`sm.familyActive=0;sm.familyBeats=0;sm.familyReplies=[];
    setInterval(()=>sm.familyBeats++,5);const FamilyWorker=window.Worker;
    window.Worker=class extends FamilyWorker{
      constructor(...args){super(...args);this.addEventListener('message',e=>{
        if(this.familyActive){sm.familyReplies.push({kind:e.data.kind,beats:sm.familyBeats-this.familyBeatStart});this.familyDone();}
      });}
      familyDone(){if(this.familyActive){this.familyActive=false;sm.familyActive--;}}
      postMessage(data,...rest){if(data.kind==='native-family-supply'){
        this.familyActive=true;this.familyBeatStart=sm.familyBeats;sm.familyActive++;
      }return super.postMessage(data,...rest);}
      terminate(){this.familyDone();return super.terminate();}
    };`;
  const settleFamily=async(label,complete=done)=>{
    // A real CPU job runs on wall time. Do not advance the simulated game clock
    // while waiting for it. Cover the native 5m visit, 30s finish and 15s navigation
    // budget; keep the 10s wall-time bound for each real worker response.
    try{
      for(let i=0;i<=345;i++){
        if(await evaluate(complete))return;
        if(await evaluate('sm.familyActive>0'))await until(()=>evaluate('sm.familyActive===0'),label+' worker',10000);
        await pulse();
      }
      throw Error(label+' action rounds exhausted');
    }catch(e){
      if(process.env.ARKENGINE_FAMILY_HANDOFF_REPORT)writeFileSync(process.env.ARKENGINE_FAMILY_HANDOFF_REPORT,
        JSON.stringify(await evaluate(`({view:shelterData(),state:${state},calls:sm.calls,origins:sm.assignmentOrigins,frames:sm.handoffFrames,
          construction:JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1')),
          campaign:JSON.parse(localStorage.getItem('${key}')),status:${panel}.getElementById('shelter-status').textContent,
          pending:${pending},events:(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.slice(-30)})`),null,2));
      throw Error(e.message+' '+JSON.stringify(await diagnose()));
    }
  };
  const scene=(flags={},extra='')=>`sm.view=${JSON.stringify(campaignView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
    sm.fixtureSearch=location.search;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;const s=sm.view.state;
    localStorage.setItem('${key}',JSON.stringify(${JSON.stringify({...defaults,...flags})}));${extra}`;
  const construction=`localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:0,partsReserve:0}));`;
  for(const commission of ['', 'survey'])await t.test('v136废土：'+(commission?'保留人工委托选择且不创建错误派遣原单':'新增委托选项不影响普通探险派遣'),async()=>{
    await setupShelter(scene({explore:true},`sm.ui20261109=true;sm.ui20261121=true;sm.commission=${JSON.stringify(commission)};`));
    if(commission){
      await settle('manual commission preserved');
      assert.equal(await evaluate('sm.calls.some(call=>call.type==="explore_start")'),false);
      assert.equal(await evaluate(pending),null);
      assert.equal(await evaluate('sm.commission'),'survey');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'true');
    }else{
      await drive(`sm.calls.some(call=>call.type==='explore_start')&&!${pending}`,'ordinary exploration with commission control',120);
      const call=await evaluate('sm.calls.find(call=>call.type==="explore_start")');
      assert.equal(call.abyss,false);assert.equal(call.commission,undefined);
    }
  });
  await t.test('父母质量浏览器：高基础属性组合实际入住，已有关系刷新后保留',async()=>{
    await setupShelter(scene({},`sm.ui20261109=true;sm.confirmFamily=true;s.rooms.find(r=>r.id===4).width=3;
      s.residents.slice(4).forEach(p=>p.roomId=4);
      for(const id of [7,8])s.residents.push({...structuredClone(s.residents[3]),id,name:'优质居民'+id,roomId:4});
      for(const p of s.residents){if(p.id<=3){p.familyCooldownUntil=clock+86400000;continue;}
        p.stats=Object.fromEntries(Object.keys(p.stats).map(k=>[k,p.id>=7?5:3]));p.stats.cha=1;}
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');`));
    await drive(`sm.view.state.residents.filter(p=>[7,8].includes(p.id)).every(p=>p.roomId===5&&p.romance)&&!${pending}`,
      'higher base attributes selected and placed',160);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===5).map(c=>c.residentId).sort()'),[7,8]);
    await reloadShelter();await drive(done,'confirmed family survives reload',150);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===5).map(c=>c.residentId).sort()'),[7,8]);
    const event=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='shelter-population'&&e.data.phase==='placing')`);
    assert.equal(event.data.ranking,'base-attributes-fallback');assert.equal(event.data.assessment.baseTotal,31);
  });
  const parent72BrowserScene=()=>{const f=parent72Scene();return scene(f.campaign,`sm.view=${JSON.stringify(f.view)};
    clock=sm.view.serverTime;sm.ui20261109=true;sm.confirmFamily=true;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
    localStorage.setItem('arkengine:auto-shelter:population:v1','9');
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));`);};
  await t.test('三天父母浏览器：较低总属性的保守方案实际入住，已有感情刷新不更换',async()=>{
    await setupShelter(parent72BrowserScene());
    await drive(`sm.view.state.residents.filter(p=>[5,7].includes(p.id)).every(p=>p.roomId===5&&p.romance)&&!${pending}`,
      '72h parent proposal reaches native confirmation',160);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===5).map(c=>c.residentId).sort()`),[5,7]);
    const event=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='shelter-population'&&e.data.phase==='placing')`);
    assert.equal(event.data.ranking,'development72-genetic-bounds');assert.equal(event.data.assessment.baseTotal,29);
    assert.ok(event.data.development72.lower.end.scrap>event.data.developmentComparison.baseline.upper.end.scrap);
    await reloadShelter();await drive(done,'72h selected family survives refresh',160);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===5).map(c=>c.residentId).sort()`),[5,7]);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===8).roomId'),4);
  });
  await t.test('三天父母浏览器：首个调岗结果未知时刷新只核对原单，不改选或重发',async()=>{
    await setupShelter(parent72BrowserScene()+'sm.assignUnknown=true;');
    await drive(`sm.calls.some(c=>c.type==='assign')`,'72h parent request unknown');
    assert.equal(await evaluate(`sm.calls.find(c=>c.type==='assign').residentId`),5);
    const original=await evaluate(pending);
    assert.equal(original.kind,'assign');await reloadShelter();await drive(done,'unknown parent request after refresh',160);
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign').length`),1);
    assert.deepEqual(await evaluate(`[${state}.pair.a,${state}.pair.b]`),[5,7]);
  });
  await t.test('就绪工程浏览器：普通生产升级先于可选换位开工，刷新不重复扣款',async()=>{
    const f=readyConstructionScene();f.construction.scrapLimit=400;
    await setupShelter(scene(f.campaign,`sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.ui20261109=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','8');
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));`));
    await drive(`sm.calls.some(c=>c.type==='upgrade')&&!${pending}`,'funded recycler actually starts',100);
    const calls=await evaluate('sm.calls');assert.equal(calls[0].type,'upgrade');assert.equal(calls[0].roomId,4);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),f.view.state.resources.scrap-400);
    assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
    await reloadShelter();await drive(done,'recheck construction after refresh',200);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),1);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),f.view.state.resources.scrap-400);
  });
  for(const role of ['training','medical','radio'])await t.test(`建设与养成仲裁浏览器：${role}新增调岗不能抢先于已就绪升级`,async()=>{
    const f=readyCampaignConstructionScene(role);
    await setupShelter(scene(f.campaign,`sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.ui20261109=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','8');
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));`));
    await drive('sm.calls.length>0','first admitted action',100);
    assert.equal(await evaluate('sm.calls[0].type'),'upgrade',JSON.stringify(await diagnose()));
    await drive(`sm.calls.some(c=>c.type==='upgrade')&&!${pending}`,'construction confirmed before new duty',60);
    assert.equal(await evaluate('sm.calls[0].roomId'),4);
    assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),f.view.state.resources.scrap-400);
    await reloadShelter();await drive(done,'fresh construction state after reload',200);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),1);
    if(role==='training')assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===90).length'),0,
      'do not start training against an unavailable return room');
    await evaluate(`const r=sm.view.state.rooms.find(r=>r.id===4);clock=r.upgradeAt+1;r.level=2;r.upgradeAt=null;
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      ${panel}.getElementById('shelter-check').click();`);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.roomId===90)&&!${pending}`,'duty resumes with completed room and spent budget',120);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),1);
  });
  await t.test('新版UI：周任务跨页清除旧选择并按编号选队，只提交规划队伍',async()=>{
    await setupShelter(scene({quests:true},`sm.ui20261109=true;sm.questTeam=[20,21,22];
      const extras=Array.from({length:13},(_,i)=>({...structuredClone(s.residents[0]),id:20+i,name:'候补'+i,roomId:null,stats:{str:1,per:1,end:1,cha:1,int:1,agi:1,lck:1}}));
      s.residents=[...extras,...s.residents];s.rooms.find(r=>r.id===5).width=3;
      for(const id of [2,3])s.residents.find(p=>p.id===id).stats[id===2?'agi':'per']=10;`));
    await settle('paged quest selection');
    const calls=await evaluate('sm.calls.filter(a=>a.type==="quest_start")');
    assert.equal(calls.length,1,JSON.stringify(await diagnose()));
    assert.ok(calls[0].team.includes(5)||calls[0].team.includes(6));
    assert.ok(calls[0].team.every(id=>id<20));assert.equal(await evaluate(pending),null);
  });
  const reloadCampaign=async()=>{
    await pulse(1000);await evaluate(`history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);await reloadShelter();
  };
  const swapContinuityScene=(extra='')=>{
    const f=JSON.parse(readFileSync(new URL('./arkengine-shelter-swap-training.fixture.json',import.meta.url),'utf8'));
    return scene(f.campaign,`sm.ui20261109=true;sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','50');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(f.state)},nextAt:0,note:'derived swap fixture'}));${extra}`);
  };
  await t.test('换位接续浏览器：先完成36号后半步再重评电台，41号不插队训练，刷新保留原训练期限',async()=>{
    await setupShelter(swapContinuityScene());
    const roles=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='training')`);
    await drive('sm.calls.some(c=>c.type==="assign"&&c.residentId===36)','remaining swap action before elective training');
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>[c.residentId,c.roomId])'),[[36,119]],
      'safe original swap finishes before elective radio release; no new training or unrelated reassignment');
    await drive(`!${state}.swap&&!${pending}`,'confirmed swap retired');
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===41).roomId'),6);
    assert.deepEqual(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='training')`),roles);
    await reloadCampaign();
    for(let i=0;i<10;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===36&&c.roomId===119).length'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===41&&c.roomId===44).length'),0);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===93&&c.roomId===null).length'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===154).length'),0);
  });
  await t.test('换位接续浏览器：确认前成员受伤撤销原步骤，不因接续而强制调岗',async()=>{
    await setupShelter(swapContinuityScene('sm.quickAssign=false;'));
    await drive('!!document.querySelector("[data-staff-dialog="+CSS.escape("36")+"]")','remaining swap resident detail');
    await evaluate('sm.view.state.residents.find(p=>p.id===36).hp=1;');
    for(let i=0;i<15;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===36).length'),0);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===36).roomId'),6);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('换位接续浏览器：未知后半步跨刷新保留原单，不重复调岗或另送训练',async()=>{
    await setupShelter(swapContinuityScene(`const prior=window.fetch;window.fetch=async(u,o)=>{
      if(u==='/api/shelter/action'&&JSON.parse(o.body).action.type==='assign'&&JSON.parse(o.body).action.residentId===36){
        sm.assignUnknown=true;try{return await prior(u,o);}finally{sm.assignUnknown=false;}}
      return prior(u,o);};`));
    await drive('sm.calls.some(c=>c.type==="assign"&&c.residentId===36)','unknown remaining swap submitted');
    const first=await evaluate('sm.calls.find(c=>c.type==="assign"&&c.residentId===36)');assert.equal(first.roomId,119);
    await pulse(31000);await settle('unknown swap retained');
    const original=await evaluate(pending);assert.equal(original.kind,'assign');
    await reloadCampaign();await settle('unknown swap retained after refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===36).length'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&![36,93].includes(c.residentId)).length'),0);
    assert.equal(await evaluate(`${pending}.id`),original.id);assert.ok(await evaluate(`${state}.swap`));
  });
  await t.test('新版UI：训练返岗确认被替换或人工接手时不确认，不发送调岗',async()=>{
    for(const mode of ['wrong-id','manual']){
      await setupShelter(scene({training:true,trainTarget:6},`sm.ui20261109=true;s.rooms.push({id:30,type:'training',trainStat:'end',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
        for(const p of s.residents){p.stats.end=10;p.training=0;}
        s.residents[5].roomId=4;Object.assign(s.residents[4],{roomId:30,xp:0,hp:100,training:0});
        localStorage.setItem('arkengine:auto-shelter:staff:v1','production');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');`));
      await drive(`Boolean(document.querySelector('[role="alertdialog"]'))`,'training confirmation open');
      if(mode==='wrong-id')await evaluate(`document.querySelector('[role="alertdialog"] h2').textContent='确认调动 #999 居民5？';`);
      else await trustedStaffKey();
      await pulse(10000);
      assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).length'),0);
    }
  });
  const trainingConfirmScene=(extra='')=>scene({training:true,trainTarget:6},`sm.ui20261109=true;
    s.rooms.push({id:30,type:'training',trainStat:'agi',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
    for(const p of s.residents){p.stats.agi=10;p.training=0;}
    s.residents[5].roomId=4;Object.assign(s.residents[4],{roomId:30,xp:0,hp:100,training:0});
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');${extra}`);
  await t.test('v136训练：新版保留属性进度说明能确认完成后的返岗',async()=>{
    await setupShelter(trainingConfirmScene('sm.ui20261121=true;'));
    await drive(`!!document.querySelector('[role="alertdialog"]')`,'current training description');
    assert.match(await evaluate(`document.querySelector('[role="alertdialog"]').textContent`),/换属性后仍可回来继续/);
    await drive(`sm.calls.some(call=>call.type==='assign'&&call.residentId===5)&&!${pending}`,'current training return',35);
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="assign"&&call.residentId===5).length'),1);
    assert.equal(await evaluate(`!!document.querySelector('[role="alertdialog"]')`),false);
  });
  await t.test('训练室升级浏览器：40%及90%跨刷新不调岗、不弹确认，完成一格才返岗',async()=>{
    await setupShelter(scene({training:true},`sm.ui20261109=true;
      s.rooms.push({...s.rooms[0],id:79,type:'training',trainStat:'per',floor:3,col:2,level:2,upgradeAt:clock+3*3600000});
      for(const [index,progress] of [[4,.4],[5,.9]])Object.assign(s.residents[index],
        {roomId:79,xp:0,hp:100,training:progress,stats:{...s.residents[index].stats,per:4}});
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'升级前当前格训练',campaign:{
        roles:[{id:5,room:79,role:'training',at:clock-600000,stat:'per',base:4,purpose:'production',finishCurrent:true,
          until:clock+2*3600000,windowEnd:clock+168*3600000,destination:3}],trips:[],attempts:[],heals:[],trainingRest:[]}}));
      sm.trainingPrompts=0;const confirm=fixtureConfirm;window.fixtureConfirm=(...args)=>{sm.trainingPrompts++;return confirm(...args);};`));
    await settle('upgrading training room preserves both residents');
    assert.equal(await evaluate('sm.calls.some(call=>call.type==="assign"&&[5,6].includes(call.residentId))'),false);
    const roles=await evaluate(`${state}.campaign.roles.filter(role=>[5,6].includes(role.id))`);
    assert.equal(roles.length,2);assert.ok(roles.every(role=>role.upgradeUntil&&role.until>role.upgradeUntil));
    assert.equal(await evaluate('sm.trainingPrompts'),0);
    assert.equal(await evaluate('sm.calls.some(call=>call.type==="assign"&&[5,6].includes(call.residentId))'),false);
    await reloadCampaign();await settle('upgrading training survives refresh');
    assert.deepEqual(await evaluate(`${state}.campaign.roles.filter(role=>[5,6].includes(role.id))`),roles);
    assert.equal(await evaluate('sm.calls.some(call=>call.type==="assign"&&[5,6].includes(call.residentId))'),false);
    await evaluate(`const room=sm.view.state.rooms.find(room=>room.id===79);clock=room.upgradeAt+1;room.upgradeAt=null;room.level=3;
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      for(const person of sm.view.state.residents.filter(person=>[5,6].includes(person.id))){person.stats.per=5;person.training=0;}
      ${panel}.getElementById('shelter-check').click();`);
    await drive(`sm.view.state.residents.filter(person=>[5,6].includes(person.id)).every(person=>person.roomId!==79)&&!${pending}`,
      'completed upgraded training returns',160);
    assert.deepEqual(await evaluate('sm.assignmentOrigins.filter(call=>call.from===79).map(call=>call.residentId).sort()'),[5,6]);
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="assign"&&call.residentId===5&&call.roomId===3).length'),1);
  });
  await t.test('训练确认计算复用：维护核对七百毫秒，完成训练后有限读取即返岗',async()=>{
    await setupShelter(trainingConfirmScene(`sm.maintenanceCostMs=700;sm.trainingReads=0;
      const read=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter'&&document.querySelector('[role="alertdialog"]'))sm.trainingReads++;
        return read(url,options);};`));
    await drive(`Boolean(document.querySelector('[role="alertdialog"]'))`,'training confirmation opens');
    const openedAt=await evaluate('clock');
    await drive(`sm.calls.some(call=>call.type==='assign'&&call.residentId===5)&&!${pending}`,'bounded training confirmation',30);
    assert.ok(await evaluate(`clock-${openedAt}<20000`));
    assert.ok(await evaluate('sm.trainingReads<=2'));
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="assign"&&call.residentId===5).length'),1);
    assert.equal(await evaluate(`document.querySelector('[role="alertdialog"]')`),null);
  });
  await t.test('孙小满训练浏览器：手动智力25%及零进度不因没有零件岗位退出，刷新仍完成同一格',async()=>{
    await setupShelter(scene({training:true},`sm.ui20261109=true;
      s.rooms.push({...s.rooms[0],id:466,type:'training',trainStat:'int',floor:3,col:2,level:3});
      for(const [index,progress] of [[4,.25],[5,0]])Object.assign(s.residents[index],
        {roomId:466,xp:0,hp:100,training:progress,stats:{...s.residents[index].stats,int:7}});
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      sm.trainingPrompts=0;const confirm=fixtureConfirm;window.fixtureConfirm=(...args)=>{sm.trainingPrompts++;return confirm(...args);};`));
    await settle('manual training without immediate production purpose remains');
    assert.equal(await evaluate('sm.trainingPrompts'),0);
    assert.equal(await evaluate('sm.calls.some(call=>call.type==="assign"&&[5,6].includes(call.residentId))'),false);
    const roles=await evaluate(`${state}.campaign.roles.filter(role=>[5,6].includes(role.id))`);
    assert.equal(roles.length,2);assert.ok(roles.every(role=>role.existingTraining&&role.base===7));
    await reloadCampaign();await settle('manual training fixed deadlines survive refresh');
    assert.deepEqual(await evaluate(`${state}.campaign.roles.filter(role=>[5,6].includes(role.id))`),roles);
    assert.equal(await evaluate('sm.calls.some(call=>call.type==="assign"&&[5,6].includes(call.residentId))'),false);
  });
  await t.test('141魅力训练浏览器：64.3%及25%都保留当前格，刷新不弹离岗确认也不延长期限',async()=>{
    await setupShelter(scene({training:true},`sm.ui20261109=true;sm.simulateResources=true;
      s.rooms.push({...s.rooms[0],id:79,type:'training',trainStat:'cha',floor:3,col:2,level:3});
      for(const [index,base,progress] of [[4,6,.643],[5,5,.25]])Object.assign(s.residents[index],
        {roomId:79,xp:0,hp:100,training:progress,stats:{...s.residents[index].stats,cha:base}});
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      sm.trainingPrompts=0;const confirm=fixtureConfirm;window.fixtureConfirm=(...args)=>{sm.trainingPrompts++;return confirm(...args);};`));
    await settle('historical charisma remains in training');
    const roles=await evaluate(`${state}.campaign.roles.filter(role=>[5,6].includes(role.id))`);
    assert.equal(roles.length,2);assert.ok(roles.every(role=>role.purpose==='current'));
    assert.equal(await evaluate('sm.trainingPrompts'),0);
    assert.equal(await evaluate('sm.calls.some(call=>call.type==="assign"&&[5,6].includes(call.residentId))'),false);
    await reloadCampaign();await settle('current training deadlines survive refresh');
    assert.deepEqual(await evaluate(`${state}.campaign.roles.filter(role=>[5,6].includes(role.id))`),roles);
    assert.equal(await evaluate('sm.calls.some(call=>call.type==="assign"&&[5,6].includes(call.residentId))'),false);
  });
  await t.test('141闲置就业浏览器：保留训练返岗位，两名闲置成人参与工坊和回收生产',async()=>{
    await setupShelter(scene({training:true},`sm.ui20261109=true;
      s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:3,col:2},
        {...s.rooms[0],id:91,type:'training',trainStat:'end',floor:3,col:3});
      Object.assign(s.residents[4],{roomId:91,xp:0,hp:100,training:.9,stats:{...s.residents[4].stats,end:5}});
      s.residents.push({...structuredClone(s.residents[5]),id:7,name:'闲置居民7'});
      for(const person of s.residents.slice(5)){person.roomId=null;person.stats.int=7;}
      s.resources.parts=9;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'保留返岗位',campaign:{
        roles:[{id:5,room:91,role:'training',at:clock-600000,stat:'end',base:5,purpose:'production',until:clock+3600000,windowEnd:clock+168*3600000,destination:4}],
        trips:[],attempts:[],heals:[],trainingRest:[]}}));`));
    await drive(`sm.view.state.residents.filter(person=>[6,7].includes(person.id)).every(person=>[4,90].includes(person.roomId))&&
      sm.view.state.residents.some(person=>person.roomId===90)&&!${pending}`,
      'idle residents join production while workshop manufactures parts',180);
    assert.equal(await evaluate('sm.view.state.residents.find(person=>person.id===5).roomId'),91);
    assert.equal(await evaluate('sm.calls.some(call=>call.type==="assign"&&call.residentId===5)'),false);
    assert.equal(await evaluate(`${state}.campaign.roles.find(role=>role.id===5).destination`),4);
    assert.ok(await evaluate('sm.view.state.residents.filter(person=>person.roomId===4).length<2'));
  });
  await t.test('训练确认真实结构：div说明自动确认满属性离岗，零训练进度也能释放并继续远征',async()=>{
    await setupShelter(trainingConfirmScene());
    await drive(`Boolean(document.querySelector('[role="alertdialog"]'))`,'actual div confirmation');
    assert.equal(await evaluate(`document.querySelector('[role="alertdialog"] p')`),null);
    assert.match(await evaluate(`document.getElementById(document.querySelector('[role="alertdialog"]').getAttribute('aria-describedby')).textContent`),/0\.0%/);
    await settle('maxed training released');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5&&c.roomId===null).length`),1);
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`document.querySelector('[role="alertdialog"]')`),null);
  });
  await t.test('避难所弹窗恢复：训练确认标题变化时取消原Promise，清理未发送意图并继续远征',async()=>{
    await setupShelter(trainingConfirmScene(`const confirm=fixtureConfirm;window.fixtureConfirm=(...args)=>{
      const result=confirm(...args);document.querySelector('[role="alertdialog"] h2').textContent='新版居民调动确认';return result;};`));
    await settle('changed training confirmation cancelled');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5).length`),0);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===5).roomId`),30);
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`document.querySelector('[role="dialog"],[role="alertdialog"]')`),null);
  });
  await t.test('避难所弹窗恢复：训练取消第一次无响应时限次重试，只有原窗口关闭才清理意图',async()=>{
    await setupShelter(trainingConfirmScene(`const confirm=fixtureConfirm;window.fixtureConfirm=(...args)=>{
      const result=confirm(...args),d=document.querySelector('[role="alertdialog"]');d.querySelector('h2').textContent='新版居民调动确认';
      const b=d.querySelector('button'),cancel=b.onclick;b.onclick=()=>{sm.cancelAttempts=(sm.cancelAttempts||0)+1;if(sm.cancelAttempts>1)cancel();};return result;};`));
    await drive('sm.cancelAttempts===1','first cancellation swallowed');assert.ok(await evaluate(pending));
    assert.equal(await evaluate(`!!document.querySelector('[role="alertdialog"]')`),true);
    await settle('second cancellation resolves original Promise');assert.equal(await evaluate('sm.cancelAttempts'),2);
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5).length`),0);
  });
  await t.test('避难所弹窗恢复：人工接手或替换训练确认后，超时也不点击不清空原意图',async()=>{
    for(const mode of ['manual','replacement']){
      await setupShelter(trainingConfirmScene());await drive(`!!document.querySelector('[role="alertdialog"]')`,'training before ownership loss');
      const original=await evaluate(pending);
      if(mode==='manual'){await evaluate(`document.querySelector('[role="alertdialog"] button').focus()`);await trustedStaffKey();}
      else await evaluate(`const old=document.querySelector('[role="alertdialog"]'),replacement=old.cloneNode(true);old.replaceWith(replacement);`);
      await pulse(61000);await pulse(1000);
      assert.equal(await evaluate(`${pending}.id`),original.id);
      assert.equal(await evaluate(`!!document.querySelector('[role="alertdialog"]')`),true);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5).length`),0);
    }
  });
  await t.test('避难所弹窗恢复：取消按钮消失时明确暂停，未观察到取消不得清空原意图',async()=>{
    await setupShelter(trainingConfirmScene(`const confirm=fixtureConfirm;window.fixtureConfirm=(...args)=>{
      const result=confirm(...args),d=document.querySelector('[role="alertdialog"]');d.querySelector('h2').textContent='新版确认';
      d.querySelector('button').remove();return result;};`));
    await drive(`!!document.querySelector('[role="alertdialog"]')`,'missing cancel dialog');const original=await evaluate(pending);
    await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'missing cancel stops');
    assert.equal(await evaluate(`${pending}.id`),original.id);assert.equal(await evaluate(`!!document.querySelector('[role="alertdialog"]')`),true);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5).length`),0);
  });
  await t.test('训练确认退出：未知说明、错误说明引用或超时取消未发送动作，关闭自有窗口继续远征',async()=>{
    for(const reason of ['unknown','bad-reference','expired']){
      await setupShelter(trainingConfirmScene());
      await drive(`Boolean(document.querySelector('[role="alertdialog"]'))`,'owned confirmation before cancellation');
      await evaluate(reason==='unknown'?`document.getElementById('fixture-confirm-description').textContent='将消耗1瓶汽水';`:
        reason==='bad-reference'?`document.querySelector('[role="alertdialog"]').setAttribute('aria-describedby','missing-description');`:
          `[...document.querySelector('[role="alertdialog"]').querySelectorAll('button')].find(b=>b.textContent==='确认').disabled=true;`);
      if(reason==='expired'){await pulse();await evaluate('clock+=16000;');}
      await settle('cancel unsent confirmation '+reason);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5).length`),0,reason);
      assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===5).roomId`),30);
      assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`document.querySelector('[role="dialog"],[role="alertdialog"]')`),null);
      assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-work-cancelled').length`),1);
    }
  });
  await t.test('训练确认未知：点击确认后请求结果不明，刷新保留原记录且不补发',async()=>{
    await setupShelter(trainingConfirmScene('sm.assignUnknown=true;'));
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5)`,'confirmed unknown request');
    await reloadCampaign();await settle('unknown confirmed assignment');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5).length`),1);
    assert.ok(await evaluate(`${pending}?.campaignKey`));
    assert.equal(await evaluate(`${panel}.getElementById('shelter-cancel-old-assignment').hidden`),true);
    await evaluate(`window.confirm=()=>{throw Error('known sent request must never offer cancellation');};${panel}.getElementById('shelter-cancel-old-assignment').click();`);
    assert.ok(await evaluate(pending));
  });
  await t.test('旧训练等待恢复：刷新不会自动丢弃旧单，主人明确原弹窗已取消后才解除并重评',async()=>{
    await setupShelter(trainingConfirmScene());
    await drive(`Boolean(document.querySelector('[role="alertdialog"]'))`,'old stalled dialog');
    // Model a 1.17.23 reload with the pre-confirm record but no live capture closure.
    await evaluate(`{const p=${pending};delete p.lifecycle;localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(p));}`);
    await reloadCampaign();await settle('old unconfirmed assignment');
    assert.ok(await evaluate(pending));assert.equal(await evaluate(`sm.calls.filter(c=>c.residentId===5).length`),0);
    assert.equal(await evaluate(`${panel}.getElementById('shelter-cancel-old-assignment').hidden`),false);
    await evaluate(`window.confirm=()=>false;${panel}.getElementById('shelter-cancel-old-assignment').click();`);assert.ok(await evaluate(pending));
    await evaluate(`window.confirm=()=>true;${panel}.getElementById('shelter-cancel-old-assignment').click();`);
    assert.equal(await evaluate(pending),null);await settle('owner cancelled old proposal and fresh training release');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5&&c.roomId===null).length`),1);
    assert.equal(await evaluate(pending),null);
  });
  const stalledTraining=async extra=>{
    await setupShelter(trainingConfirmScene(`
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');${extra||''}`));
    await drive(`Boolean(document.querySelector('[role="alertdialog"]'))`,'legacy training intent before reload');
    await evaluate(`{sm.view.state.residents.find(p=>p.id===6).roomId=5;
      const p=${pending};delete p.lifecycle;localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(p));}`);
    const original=await evaluate(pending);assert.ok(original&&!original.campaignKey&&!original.result);
    return original;
  };
  await t.test('旧调岗状态恢复：当前已经休息，核销旧释放并实际安排宿舍单人生产，不重发旧单',async()=>{
    const original=await stalledTraining();
    await evaluate(`sm.view.state.residents.find(p=>p.id===5).roomId=null;`);
    await reloadShelter();
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===6&&c.roomId===4)`,'single dorm adult actually employed after old intent ends');
    await settle('recovered production visit');
    assert.equal(await evaluate(`${state}.assignmentRecovery.original.id`),original.id);
    assert.equal(await evaluate(`${state}.assignmentRecovery.currentRoom`),null);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5&&c.roomId===null).length`),0);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===6).roomId`),4);
    assert.equal(await evaluate(pending),null);
    assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>
      e.type==='shelter-assignment-reconciled'&&e.data.receiptConfirmed===false)`));
    const count=await evaluate('sm.calls.length');await reloadCampaign();await settle('reconciliation survives refresh');
    assert.equal(await evaluate('sm.calls.length'),count);
  });
  await t.test('旧调岗状态恢复：当前已有其他生产岗，旧释放失效，不把人拉回休息',async()=>{
    const original=await stalledTraining('s.rooms.find(r=>r.id===4).width=2;');
    await evaluate(`sm.view.state.residents.find(p=>p.id===5).roomId=4;`);await reloadShelter();
    await settle('current productive post supersedes old release');
    assert.equal(await evaluate(`${state}.assignmentRecovery.original.id`),original.id);
    assert.equal(await evaluate(`${state}.assignmentRecovery.currentRoom`),4);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5&&c.roomId===null).length`),0);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===5).roomId`),4);
  });
  await t.test('旧调岗状态恢复：仍在原训练室不猜测执行，折叠面板仍显示全局阻塞及恢复入口',async()=>{
    const original=await stalledTraining();await reloadShelter();await settle('unchanged training remains unknown');
    await evaluate(`${panel}.getElementById('panel-fold').click();`);await pulse(1000);
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.equal(await evaluate(`${panel}.getElementById('panel-content').hidden`),true);
    assert.ok(await evaluate(`${panel}.getElementById('shelter-blocker').checkVisibility()`));
    assert.ok(await evaluate(`${panel}.getElementById('shelter-cancel-old-assignment').checkVisibility()`));
    assert.match(await evaluate(`${panel}.getElementById('shelter-blocker-text').textContent`),/#5.*阻塞.*生产调岗、配对和建设未执行/);
    const waits=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-pending-wait')`);
    assert.ok(waits.some(e=>e.data.trainingRelease?.residentId===5&&e.data.trainingRelease.currentRoom===30&&
      e.data.trainingRelease.from===30&&!e.data.trainingRelease.requestBound));
    assert.equal(await evaluate('sm.calls.length'),0);
  });
  await t.test('旧调岗状态恢复：已发送、身份改变或原记录归档失败时不释放旧单',async()=>{
    for(const boundary of ['sent','renamed','archive-failed']){
      const original=await stalledTraining();
      await evaluate(`sm.view.state.residents.find(p=>p.id===5).roomId=null;
        ${boundary==='sent'?`const p=${pending};p.campaignKey='known-sent-key';localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(p));`:''}
        ${boundary==='renamed'?`sm.view.state.residents.find(p=>p.id===5).name='身份已改变';`:''}`);
      if(boundary==='archive-failed'){
        // Persist a fixture flag; the reload driver reinstalls the storage failure before injection.
        await evaluate('sm.failRecoveryArchive=true;');
      }
      await reloadShelter();
      if(boundary==='archive-failed')await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'failed archive stops without clearing');
      else await settle('old request protected '+boundary);
      assert.equal(await evaluate(`${pending}.id`),original.id,boundary);
      assert.equal(await evaluate('sm.calls.length'),0,boundary);
    }
  });
  await t.test('旧调岗状态恢复：满属性仍在原训练室的十小时旧意图自动归档，重读后释放并安排宿舍成人',async()=>{
    const original=await stalledTraining();
    await evaluate(`const p=${pending};p.at=clock-10*3600000;localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(p));`);
    await reloadShelter();
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===6&&c.roomId===4)`,'stale maxed training no longer blocks dorm employment');
    await settle('stale maxed training recovered');
    assert.equal(await evaluate(`${state}.assignmentRecovery.original.id`),original.id);
    assert.match(await evaluate(`${state}.assignmentRecovery.reason`),/属性已满/);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5&&c.roomId===null).length`),1);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===6).roomId`),4);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('旧调岗状态恢复：十小时旧单仍在训练且属性未满，不自动撤销',async()=>{
    const original=await stalledTraining();
    await evaluate(`sm.view.state.residents.find(p=>p.id===5).stats.agi=9;
      const p=${pending};p.at=clock-10*3600000;localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(p));`);
    await reloadShelter();await settle('unmet training remains unresolved');
    assert.equal(await evaluate(`${pending}.id`),original.id);assert.equal(await evaluate('sm.calls.length'),0);
  });
  await t.test('旧调岗状态恢复：总暂停或人工窗口仍打开时保留过期旧意图',async()=>{
    for(const boundary of ['paused','dialog']){
      const original=await stalledTraining();
      await evaluate(`const p=${pending};p.at=clock-10*3600000;localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(p));
        ${boundary==='paused'?`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`:''}`);
      await reloadShelter();
      if(boundary==='dialog')await evaluate(`const d=document.createElement('div');d.setAttribute('role','alertdialog');
        d.textContent='主人正在核对原操作';document.body.append(d);`);
      for(let i=0;i<5;i++)await pulse(10000);
      assert.equal(await evaluate(`${pending}.id`),original.id,boundary);
      assert.equal(await evaluate('sm.calls.length'),0,boundary);
      assert.ok(await evaluate(`!${state}.assignmentRecovery`),boundary);
    }
  });
  await t.test('旧调岗状态恢复：历史训练阻塞加回收站漏水，恢复后按房间批量救援并自动返原岗',async()=>{
    const original=await stalledTraining();
    await evaluate(`const p=${pending};p.at=clock-10*3600000;localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(p));
      const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.defense=true;localStorage.setItem('${key}',JSON.stringify(cfg));
      sm.view.state.rooms.find(r=>r.id===4).incident={kind:'leak',hp:12,maxHp:20};
      sm.view.state.residents.push({...structuredClone(sm.view.state.residents[5]),id:7,name:'漏水增援候选',roomId:null});`);
    const roster=`sm.view.state.residents.map(p=>[p.id,p.roomId])`,before=await evaluate(roster);
    await reloadShelter();
    await drive(`Object.keys(sm.rescueOrigins||{}).length===3`,'recovered scheduler sends first native rescue batch');
    assert.equal(await evaluate(`${state}.assignmentRecovery.original.id`),original.id);
    assert.equal(await evaluate('sm.view.state.residents.filter(p=>p.roomId===4).length'),before.filter(([,room])=>room===4).length+3);
    await evaluate('sm.endRescue=true;');
    await drive(`!sm.view.state.rooms.find(r=>r.id===4).incident&&!${pending}`,'next rescue batch ends incident and returns original workers');
    assert.deepEqual(await evaluate(`sm.calls.map(c=>[c.type,c.roomId])`),[['rescue_incident',4],['rescue_incident',4]]);
    assert.deepEqual(await evaluate(roster),before);
  });
  const finishingParentScene=(progress='5/7',extra='')=>scene({training:true,trainTarget:6},`sm.ui20261109=true;
    s.rooms.push({id:30,type:'training',trainStat:'cha',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
    Object.assign(s.residents[4],{roomId:30,xp:0,hp:100,training:${progress}});s.residents[4].stats.cha=6;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','family');
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,vaultNo:77,note:'父母当前格71.4%',
      families:[{a:5,b:6,room:5}],campaign:{roles:[{id:5,room:30,role:'training',purpose:'parent',stat:'cha',base:5,
        at:clock-6*3600000,until:clock-1000}],trips:[],attempts:[],heals:[],trainingRest:[]}}));${extra}`);
  for(const margin of ['normal','continuation'])await t.test(margin==='normal'?
    '训练收尾浏览器：71.4%先完成当前格，刷新不续期，升到7且下一格未开始时真实离岗':
    '训练收尾浏览器：电力仅有11%余量时冷却到期仍完成当前格，刷新不续期且完成后真实离岗',async()=>{
    const extra=margin==='continuation'?`s.rooms.find(r=>r.id===1).level=1;`:'';
    await setupShelter(finishingParentScene('5/7',extra));await settle('finish parent current cell');
    if(margin==='continuation'){
      const supply=await evaluate(`({power:12*(.5+sm.view.state.residents[0].stats.str/10),
        demand:sm.view.state.rooms.reduce((n,r)=>n+(['power','door','elevator'].includes(r.type)?0:
          (['diner','water','scrap','workshop','medbay'].includes(r.type)?1:.5)*r.width*r.level),0)})`);
      assert.ok(supply.power> supply.demand&&supply.power<1.2*supply.demand,JSON.stringify(supply));
    }
    const role=await evaluate(`${state}.campaign.roles.find(r=>r.id===5)`);
    assert.equal(role?.finishCurrent,true,JSON.stringify(await diagnose()));assert.equal(role.base,6);
    assert.equal(await evaluate('sm.calls.filter(c=>c.residentId===5).length'),0);
    await reloadCampaign();await settle('completion commitment survives refresh');
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===5).until`),role.until);
    await evaluate(`const p=sm.view.state.residents.find(p=>p.id===5);p.stats.cha=7;p.training=0;
      const schedule=${state};schedule.nextAt=0;localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(schedule));`);
    await reloadCampaign();
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5&&c.roomId===null)&&!${pending}`,'completed current cell actually released');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5&&c.roomId===null).length'),1);
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>r.id!==5)`));
  });
  await t.test('训练收尾浏览器：升级前已打开但无发送凭据的旧离岗，按当前格归档并继续训练',async()=>{
    await setupShelter(finishingParentScene('0'));
    await drive(`Boolean(document.querySelector('[role="alertdialog"]'))`,'old parent release confirmation');
    const original=await evaluate(pending);assert.ok(original&&!original.campaignKey&&!original.result);
    await evaluate(`sm.view.state.residents.find(p=>p.id===5).training=5/7;
      const p=${pending};delete p.lifecycle;p.at=clock-60000;localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(p));`);
    await reloadShelter();await settle('old release reconciled to current training');
    assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate(`${state}.assignmentRecovery.original.id`),original.id);
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===5).finishCurrent`),true);
    assert.equal(await evaluate('sm.calls.filter(c=>c.residentId===5).length'),0);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),30);
  });
  await t.test('训练收尾浏览器：旧离岗已有发送凭据时保留未知原单，不拿训练进度取消请求',async()=>{
    // Idle employment may precede this release. Stall only the original trainee,
    // so an unrelated successful job does not prevent exercising this contract.
    await setupShelter(finishingParentScene('0',`window.shelterTransport=(u,o)=>{
      const action=JSON.parse(o.body).action;if(action.type==='assign'&&action.residentId===5)sm.assignUnknown=true;
      return fetch(u,o);};`));
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5)`,'sent original parent release');
    const original=await evaluate(pending);assert.ok(original.campaignKey);
    await evaluate('sm.view.state.residents.find(p=>p.id===5).training=5/7;');
    await reloadCampaign();await settle('sent parent release remains unknown');
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.equal(await evaluate('sm.calls.filter(c=>c.residentId===5).length'),1);
    assert.ok(await evaluate(`!${state}.campaign.roles.find(r=>r.id===5)?.finishCurrent`));
  });
  const renewalScene=()=>scene({},`sm.confirmFamily=true;s.rooms.find(r=>r.id===4).width=3;
    for(const p of s.residents.slice(3))Object.assign(p,{roomId:4,xp:0,hp:100,stats:{str:3,per:3,end:3,cha:3,int:3,agi:3,lck:3}});
    for(const id of [7,8])s.residents.push({...structuredClone(s.residents[3]),id,name:'优质居民'+id,
      stats:{str:8,per:8,end:8,cha:8,int:8,agi:8,lck:8}});
    s.rooms.push({...s.rooms.find(r=>r.id===5),id:91,floor:3});
    for(const id of [9,10])s.residents.push({...structuredClone(s.residents[3]),id,name:'已有感情'+id,roomId:91,
      romance:{partnerId:id===9?10:9,progress:.3}});
    localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
    localStorage.setItem('arkengine:auto-shelter:population:v1','14');
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,vaultNo:77,note:'旧家庭占住空宿舍',
      families:[{a:5,b:6,room:5},{a:9,b:10,room:91}]}));`);
  await t.test('父母换届浏览器：空宿舍改选高属性父母，原父母继续生产，已有30%感情保留且刷新不再换人',async()=>{
    await setupShelter(renewalScene());await settle('replace idle family reservation');
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===5).map(c=>c.residentId)'),[7,8]);
    assert.ok(await evaluate(`${state}.families.some(f=>f.a===7&&f.b===8&&f.room===5)`));
    assert.ok(await evaluate(`!${state}.families.some(f=>f.a===5&&f.b===6)`));
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[5,6].includes(p.id)).map(p=>p.roomId)'),[4,4]);
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[9,10].includes(p.id)).map(p=>p.romance.progress)'),[.3,.3]);
    await reloadCampaign();await settle('replacement survives reload');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===5).length'),2);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&[9,10].includes(c.residentId)).length'),0);
  });
  await t.test('父母换届浏览器：第一步原请求未知时刷新只核对，不换第二组合或重复调人',async()=>{
    await setupShelter(renewalScene()+'sm.assignUnknown=true;');
    await drive('sm.calls.filter(c=>c.type==="assign").length===1','first replacement unknown');await reloadShelter();
    await drive(`${done}&&${pending}!==null&&${state}.pendingReadOnly===${pending}.id`,'replacement request isolated');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),1);
    assert.deepEqual(await evaluate(`${pending}.targets`),[7,5]);
    assert.deepEqual(await evaluate(`[${state}.pair.a,${state}.pair.b]`),[7,8]);
    assert.ok(await evaluate(`${state}.families.some(f=>f.a===9&&f.b===10)`));
  });
  const scrapInvestmentScene=()=>scene({},`${construction}
    Object.assign(s.rooms.find(r=>r.id===4),{width:3,level:2});
    Object.assign(s.rooms.find(r=>r.id===6),{floor:2,col:4,width:3});
    for(let id=7;id<=11;id++)s.residents.push({...structuredClone(s.residents[3]),id,name:'回收居民'+id});
    s.resources.scrap=1000;s.resources.parts=60;sm.view.progress={level:5,score:82,next:87};
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');`);
  await t.test('废料布局浏览器：实际建第二回收站并按两名工人使用现有小空位，完工后到岗且刷新不重建',async()=>{
    await setupShelter(scrapInvestmentScene());await settle('second recycler investment');
    const builds=await evaluate('sm.calls.filter(c=>c.type==="build")');
    assert.equal(builds.length,1,JSON.stringify(await diagnose()));
    assert.equal(builds[0].room,'scrap');assert.equal(builds[0].floor,2);assert.equal(builds[0].col,7);
    assert.ok(await evaluate(`${state}.constructionLedger.some(c=>c.scrap===128&&c.parts===0)`));
    const room=await evaluate('sm.view.state.rooms.find(r=>r.type==="scrap"&&r.floor===2)');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===${room.id}).length`),0);
    await reloadCampaign();await settle('scrap construction kept after reload');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build").length'),1);
    await evaluate(`clock=${room.builtAt}+1;sm.view.state.lastSettledAt=clock;${panel}.getElementById('shelter-check').click();`);
    await settle('second recycler actually staffed');
    assert.equal(await evaluate(`sm.view.state.residents.filter(p=>p.roomId===${room.id}).length`),2,JSON.stringify(await diagnose()));
  });
  await t.test('废料布局浏览器：打开建站窗口后降低预算，不发送原建造请求也不记消费',async()=>{
    await setupShelter(scrapInvestmentScene());await drive('!!document.querySelector("[data-construction-dialog]")','recycler build confirmation');
    await evaluate(`const c=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));c.scrapLimit=127;
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(c));`);
    await drive('!document.querySelector("[data-construction-dialog]")','cancel over-budget recycler');
    assert.equal(await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type)).length'),0);
    assert.equal(await evaluate(`${state}.constructionLedger?.length||0`),0);
  });
  await t.test('父母优化浏览器：基础属性与生育速度参与实际新配对，不单凭闲置优先',async()=>{
    await setupShelter(scene({},`sm.confirmFamily=true;s.rooms.find(r=>r.id===4).width=3;
      for(const p of s.residents.slice(3))Object.assign(p,{xp:0,hp:100,stats:{str:3,per:3,end:3,cha:3,int:3,agi:3,lck:3}});
      for(const id of [7,8])s.residents.push({...structuredClone(s.residents[3]),id,name:'优质居民'+id,roomId:4,
        stats:{str:8,per:8,end:8,cha:8,int:8,agi:8,lck:8}});
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','14');`));
    await settle('quality parents actually placed');
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===5).slice(0,2).map(c=>c.residentId).sort((a,b)=>a-b)'),[7,8]);
    await reloadCampaign();await settle('quality family survives reload');
    assert.ok(await evaluate(`${state}.families.some(f=>f.a===7&&f.b===8)`));
  });
  await t.test('父母优化浏览器：魅力训练回执刷新保留，到期退出并按更优组合重新配对',async()=>{
    await setupShelter(scene({training:true},`sm.confirmFamily=true;s.rooms.find(r=>r.id===4).width=2;
      // Start after ordinary cooldown employment, so both parent candidates have the same origin.
      for(const p of s.residents.slice(4))Object.assign(p,{roomId:4,xp:0,hp:100,familyCooldownUntil:clock+21600000,
        stats:{str:5,per:5,end:5,cha:2,int:5,agi:5,lck:5}});
      s.rooms.push({...s.rooms[0],id:90,type:'training',trainStat:'cha',level:2,floor:2,col:4});
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','14');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'父母冷却',vaultNo:77,
        families:[{a:5,b:6,room:5}],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}}));`));
    await settle('parent charisma training');
    const role=await evaluate(`${state}.campaign.roles.find(r=>r.purpose==='parent')`);
    assert.ok(role,JSON.stringify(await diagnose()));assert.equal(role.stat,'cha');assert.equal(role.room,90);
    await reloadCampaign();await settle('parent training restored');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===90).length'),1);
    await evaluate(`clock=${role.until}+1000;sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);
    await reloadCampaign();await settle('parent training deadline and family return');
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.purpose==='parent').length`),0);
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[4,5].includes(p.id)).map(p=>p.roomId)'),[5,5],JSON.stringify(await diagnose()));
    assert.ok(await evaluate(`${state}.families.some(f=>f.a===4&&f.b===5&&f.room===5)`));
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===6).roomId'),4,'原低分配偶继续生产，不为旧家庭永久保留宿舍');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===90).length'),1);
  });
  await t.test('父母分家庭训练浏览器：两家庭同窗入训，刷新保留，完成后分别返岗且不重复训练',async()=>{
    await setupShelter(scene({training:true},`sm.ui20261109=true;sm.confirmFamily=true;
      for(const p of s.residents.slice(4))Object.assign(p,{roomId:5,xp:0,hp:100,training:0,familyCooldownUntil:clock+21600000,
        stats:{str:6,per:6,end:6,cha:3,int:6,agi:6,lck:6}});
      s.rooms.push({...s.rooms.find(r=>r.id===5),id:91,floor:3,col:2,width:1});
      for(const id of [7,8])s.residents.push({...structuredClone(s.residents[4]),id,name:'第二家庭'+id,roomId:91});
      s.rooms.push({...s.rooms[0],id:90,type:'training',trainStat:'cha',level:1,floor:2,col:4});
      localStorage.setItem('arkengine:auto-shelter:staff:v1','family');
      localStorage.setItem('arkengine:auto-shelter:population:v1','14');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'两家庭冷却',vaultNo:77,
        families:[{a:5,b:6,room:5},{a:7,b:8,room:91}],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}}));`));
    await settle('two families use the same cooldown window');
    // The initial employment pass fills scrap with resident 5; the idle partner
    // 6 is therefore the lower-loss training choice for that family.
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===90).map(c=>c.residentId)'),[6,7],JSON.stringify(await diagnose()));
    const roles=await evaluate(`${state}.campaign.roles.filter(r=>r.purpose==='parent')`);assert.equal(roles.length,2);
    await reloadCampaign();await settle('both training assignments survive refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===90).length'),2);
    // Explicit server settlement of both one-point improvements, before cooldown.
    await evaluate(`clock=${roles[0].at}+15600000;sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      for(const id of [6,7]){const p=sm.view.state.residents.find(p=>p.id===id);p.stats.cha=4;p.training=0;}`);
    await reloadCampaign();await settle('both improvements release their original duties');
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.purpose==='parent').length`),0);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===90).length'),2,'neither completed parent nor partner starts a too-long new point');
    await evaluate(`clock=${roles[0].until}+1000;sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);
    await reloadCampaign();await settle('first family waits for a real job after the original deadline');
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[5,6,7,8].includes(p.id)).map(p=>p.roomId)'),[4,null,91,91]);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===90).length'),2);
    // Explicit observed capacity after training; expanding at the initial state
    // would erase the lower-opportunity-loss choice this regression checks.
    await evaluate(`const s=sm.view.state;s.rooms.push({...s.rooms.find(r=>r.id===4),id:92,floor:4,col:2,width:3,stored:0});`);
    await reloadCampaign();await settle('both original families resume once real jobs exist');
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[5,6,7,8].includes(p.id)).map(p=>p.roomId)'),[5,5,91,91]);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===90).length'),2);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('父母训练房间变更浏览器：房间消失与属性提升同时到达，按原格返岗且刷新不重新入训',async()=>{
    await setupShelter(scene({training:true},`sm.ui20261109=true;s.rooms.find(r=>r.id===4).width=2;
      for(const p of s.residents.slice(4))Object.assign(p,{roomId:4,xp:0,hp:100,training:0,familyCooldownUntil:clock+21600000,
        stats:{str:6,per:6,end:6,cha:2,int:6,agi:6,lck:6}});
      s.rooms.push({...s.rooms[0],id:90,type:'training',trainStat:'cha',level:2,floor:2,col:4});
      localStorage.setItem('arkengine:auto-shelter:staff:v1','family');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'父母训练房号变化',vaultNo:77,
        families:[{a:5,b:6,room:5}],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}}));`));
    await settle('parent starts one original training point');
    const role=await evaluate(`${state}.campaign.roles.find(r=>r.purpose==='parent')`);assert.ok(role);
    // Explicit settled input, not a claim that the fixture emulates native merges.
    await evaluate(`clock=${role.at}+7200000;sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      const r=sm.view.state.rooms.find(r=>r.id===90);r.id=89;r.width=2;
      const p=sm.view.state.residents.find(p=>p.id===${role.id});p.roomId=89;p.stats.cha=3;p.training=0;`);
    await reloadCampaign();await settle('room change does not erase the completed point');
    assert.ok(await evaluate(`${state}.campaign.trainingRest.some(r=>r.id===${role.id})`),JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${role.id}).roomId`),4);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===${role.id}&&[89,90].includes(c.roomId)).length`),1);
    await reloadCampaign();await settle('completed original parent stays employed across refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===${role.id}&&[89,90].includes(c.roomId)).length`),1);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('父母优化浏览器：已有魅力训练室太慢时按预算升级，完工后入室且刷新不重复施工',async()=>{
    await setupShelter(scene({training:true},`${construction}s.rooms.find(r=>r.id===4).width=2;
      // Existing production seats isolate the training upgrade from employment expansion.
      for(const p of s.residents.slice(4))Object.assign(p,{roomId:4,xp:0,hp:100,familyCooldownUntil:clock+21600000,
        stats:{str:5,per:5,end:5,cha:5,int:5,agi:5,lck:5}});
      s.rooms.push({...s.rooms[0],id:90,type:'training',trainStat:'cha',level:1,floor:2,col:4});
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','14');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'父母训练房升级',vaultNo:77,
        families:[{a:5,b:6,room:5}],campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}}));`));
    await settle('parent training room upgrade');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===90).length'),1,JSON.stringify(await diagnose()));
    assert.ok(await evaluate(`${state}.constructionLedger.some(c=>c.scrap===1000&&c.parts===0)`));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===90).length'),0);
    await reloadCampaign();await settle('training construction restored');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===90).length'),1);
    await evaluate(`const r=sm.view.state.rooms.find(r=>r.id===90);clock=r.upgradeAt+1;r.upgradeAt=null;r.level=2;
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;${panel}.getElementById('shelter-check').click();`);
    await settle('parent uses completed training room');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===90).length'),1,JSON.stringify(await diagnose()));
  });
  const laborInvestmentBrowserScene=(compareLevel=false,expand=false)=>{
    const f=expand?laborExpansionScene():laborInvestmentScene();
    if(expand)f.construction.scrapLimit=378; // Exactly the two-step budget; isolate later optional recycler upgrades.
    if(compareLevel){
      const s=f.view.state;s.rooms.push({...s.rooms[0],id:99,type:'radio',floor:3,col:2,width:3,level:3});
      // Isolate the investment comparison from normal release of healthy radio workers.
      s.residents.filter(p=>p.adultAt>0).forEach(p=>{p.adultAt=0;p.hp=1;});
      const score=2*s.residents.length+3*s.depth+s.rooms.filter(r=>!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
      f.view.progress={level:1+Math.floor(Math.sqrt(Math.max(0,score-30))/1.5),score};
    }
    return scene(f.campaign,`const laborSeed=${JSON.stringify(f)};sm.view=laborSeed.view;clock=sm.view.serverTime;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:population:v1','${compareLevel?12:50}');localStorage.setItem('arkengine:auto-shelter:level-target:v1','${compareLevel?f.view.progress.level+1:'off'}');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');localStorage.setItem('arkengine:auto-shelter:gear:v1','false');
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(laborSeed.construction));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...laborSeed.state,vaultNo:77,nextAt:0,note:'建设与人力联合投资'}));`);
  };
  await t.test('联合投资浏览器：实际升级后才释放供给工，完工调岗增产且刷新不重复支付',async()=>{
    await setupShelter(laborInvestmentBrowserScene());await settle('labor-saving investment starts');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).map(c=>[c.type,c.roomId])`),[['upgrade',2]],JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.resources.scrap'),1750);
    assert.equal(await evaluate('sm.view.state.residents.filter(p=>p.roomId===2).length'),2,'no supply worker is released before completion');
    await reloadCampaign();await settle('labor investment reload during construction');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade').length`),1);
    await evaluate(`const r=sm.view.state.rooms.find(r=>r.id===2);clock=r.upgradeAt+1;r.level=2;r.upgradeAt=null;
      sm.view.state.lastSettledAt=clock;sm.view.serverTime=clock;sm.view.progress.score++;`);
    await reloadCampaign();await settle('completed upgrade releases actual worker to recycling');
    assert.equal(await evaluate('sm.view.state.residents.filter(p=>p.roomId===2).length'),1,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.residents.filter(p=>p.roomId===4).length'),4);
    assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
    const assignments=await evaluate(`sm.calls.filter(c=>c.type==='assign').length`);
    await reloadCampaign();await settle('settled labor investment remains stable');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign').length`),assignments);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade').length`),1);
  });
  await t.test('联合投资浏览器：确认期间人手或预算失效，取消投资且不扣材料',async()=>{
    for(const reason of ['workers','budget']){
      await setupShelter(laborInvestmentBrowserScene());
      await drive(`!!document.querySelector('[data-construction-dialog]')`,'labor investment confirmation');
      if(reason==='workers')await evaluate(`sm.view.state.residents.filter(p=>p.roomId===2).forEach(p=>p.hp=1);`);
      else await evaluate(`const c=${panel}.getElementById('shelter-scrap-limit');c.value='249';${panel}.getElementById('shelter-development-save').click();`);
      await settle('lost labor investment prerequisites');
      assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0,reason+JSON.stringify(await diagnose()));
      assert.equal(await evaluate('sm.view.state.resources.scrap'),2000);assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('联合投资后台浏览器：真实Worker结果未送达时不抢跑，送达后按完整路线开工',async()=>{
    await setupShelter(laborInvestmentBrowserScene(true)+`
      sm.levelReplies=[];sm.releaseLevelResults=false;const NativeWorker=window.Worker;
      window.Worker=class {constructor(...args){this.native=new NativeWorker(...args);
        this.native.onmessage=e=>{if(e.data?.kind==='native-level-routes'&&!sm.releaseLevelResults)sm.levelReplies.push(()=>this.onmessage?.(e));else this.onmessage?.(e);};
        this.native.onerror=e=>this.onerror?.(e);this.native.onmessageerror=e=>this.onmessageerror?.(e);}
        postMessage(m){this.native.postMessage(m);}terminate(){this.native.terminate();}};`);
    await drive('sm.levelReplies.length>0','real worker result held for scheduling check');
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0);
    await evaluate('sm.releaseLevelResults=true;sm.levelReplies.splice(0).forEach(reply=>reply());');
    await settle('completed comparison admits joint investment');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===2).length`),1,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(pending),null);
  });
  await t.test('联合扩产浏览器：满员回收先升级供给再建站，刷新接续后真实调岗且两笔费用各记一次',async()=>{
    await setupShelter(laborInvestmentBrowserScene(false,true));await settle('funded labor expansion first step');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).map(c=>[c.type,c.roomId])`),[['upgrade',2]],JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.residents.filter(p=>p.roomId===2).length'),2);
    await reloadCampaign();await settle('pending supply upgrade blocks speculative recycler');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build').length`),0);
    await evaluate(`const r=sm.view.state.rooms.find(r=>r.id===2);clock=r.upgradeAt+1;r.level=2;r.upgradeAt=null;
      sm.view.state.lastSettledAt=clock;sm.view.serverTime=clock;sm.view.progress.score++;`);
    await reloadCampaign();await settle('completed supply creates funded recycler staffing');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='scrap').length`),1,JSON.stringify(await diagnose()));
    assert.deepEqual(await evaluate(`${state}.constructionLedger.map(e=>[e.scrap,e.parts])`),[[250,0],[128,0]]);
    await evaluate(`const r=sm.view.state.rooms.find(r=>r.type==='scrap'&&r.builtAt>clock);sm.laborRecycler=r.id;clock=r.builtAt+1;
      sm.view.state.lastSettledAt=clock;sm.view.serverTime=clock;sm.view.progress.score++;`);
    await reloadCampaign();await settle('new recycler completes and native staffing uses it');
    await reloadCampaign();await settle('finish native allocation if previous visit capped');
    assert.equal(await evaluate('sm.view.state.residents.filter(p=>p.roomId===sm.laborRecycler).length'),1,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.residents.filter(p=>p.roomId===2).length'),1);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),1622);
    assert.equal(await evaluate(`${state}.constructionLedger.length`),2);assert.equal(await evaluate(pending),null);
    const count=await evaluate('sm.calls.length');await reloadCampaign();await settle('settled expansion remains stable');
    assert.equal(await evaluate('sm.calls.length'),count);
  });
  await t.test('联合扩产浏览器：首项确认前整链预算降低，升级不扣款；第二项人手失效也不建空站',async()=>{
    await setupShelter(laborInvestmentBrowserScene(false,true));
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'expansion first confirmation');
    await evaluate(`const c=${panel}.getElementById('shelter-scrap-limit');c.value='377';${panel}.getElementById('shelter-development-save').click();`);
    await settle('whole-chain funding invalidated');assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade'].includes(c.type)).length`),0);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2000);
    await setupShelter(laborInvestmentBrowserScene(false,true));await settle('first upgrade for invalid second step');
    await evaluate(`const r=sm.view.state.rooms.find(r=>r.id===2);clock=r.upgradeAt+1;r.level=2;r.upgradeAt=null;
      sm.view.state.lastSettledAt=clock;sm.view.serverTime=clock;sm.view.progress.score++;`);
    await reloadCampaign();await drive(`!!document.querySelector('[data-construction-dialog]')`,'second-step confirmation');
    await evaluate('sm.view.state.residents.filter(p=>p.roomId===2).forEach(p=>p.hp=1);');
    await settle('second-step workers no longer available');assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build').length`),0);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),1750);assert.equal(await evaluate(pending),null);
  });
  const growthInvestmentBrowserScene=(limit=200)=>{
    const f=growthInvestmentScene();f.construction.scrapLimit=limit;
    return scene(f.campaign,`const growthSeed=${JSON.stringify(f)};sm.view=growthSeed.view;clock=sm.view.serverTime;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','17');localStorage.setItem('arkengine:auto-shelter:level-target:v1','5');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(growthSeed.construction));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...growthSeed.state,vaultNo:77,nextAt:0,note:'同目标路线比较'}));`);
  };
  await t.test('发展路线浏览器：人口未达标仍实际升级，一小时后达级，刷新不重复扣款',async()=>{
    await setupShelter(growthInvestmentBrowserScene());
    await settle('funded growing-population route starts');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).map(c=>[c.type,c.roomId])`),[['upgrade',100]],JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2800);
    assert.deepEqual(await evaluate(`${state}.constructionLedger.map(e=>[e.scrap,e.parts])`),[[200,0]]);
    const due=await evaluate('sm.view.state.rooms.find(r=>r.id===100).upgradeAt');
    assert.ok(await evaluate('sm.view.state.residents.every(p=>p.familyCooldownUntil>clock)'));
    await reloadCampaign();await settle('funded growth route receipt survives refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===100).length`),1);
    await evaluate(`clock=${due}+1;const completed=sm.view.state.rooms.find(r=>r.id===100);completed.level=2;completed.upgradeAt=null;
      sm.view.state.lastSettledAt=clock;sm.view.progress={level:5,score:66};`);
    await reloadCampaign();await settle('completed route reaches level without new population');
    assert.equal(await evaluate('sm.view.state.residents.length'),7);
    assert.equal(await evaluate(`${state}.developmentTrace.history.at(-1).target`),5);
    assert.equal(await evaluate(`${state}.developmentTrace.history.at(-1).outcome`),'reached');
    assert.equal(await evaluate(`${state}.developmentTrace.history.at(-1).end.score`),66);
    assert.equal(await evaluate(`${state}.constructionLedger.length`),1);assert.equal(await evaluate(pending),null);
  });
  await t.test('预算日历浏览器：已有支出到期前不付款，到期重读后开工且刷新不重发',async()=>{
    await setupShelter(growthInvestmentBrowserScene()+`
      localStorage.setItem('arkengine:auto-shelter:population:v1','7');
      const budgetState=${state};budgetState.constructionLedger=[{id:'previous-budget',at:clock-23*3600000,scrap:200,parts:0}];
      sm.budgetRelease=clock+3600000;
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(budgetState));`);
    await settle('budget waiting retains real future route');
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),3000);
    await evaluate(`clock=sm.budgetRelease+1;sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;`);
    await reloadCampaign();await settle('expired historical budget permits the selected investment');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).map(c=>[c.type,c.roomId])`),[['upgrade',100]]);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2800);
    await reloadCampaign();await settle('paid investment is not repeated after refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===100).length`),1);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('发展路线浏览器：等待三天比较后先增产，确认刷新不重复，完工达到同目标',async()=>{
    await setupShelter(growthInvestmentBrowserScene(10000));
    await drive(`sm.calls.some(c=>['build','upgrade','dig'].includes(c.type))`,'route selection before discretionary recycler');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).slice(0,1).map(c=>[c.type,c.roomId])`),[['upgrade',4]],JSON.stringify(await diagnose()));
    await settle('production route starts with actual payment');
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2600);
    await reloadCampaign();await settle('fresh read preserves the pending production route');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).map(c=>[c.type,c.roomId])`),[['upgrade',4]],JSON.stringify(await diagnose()));
    assert.deepEqual(await evaluate(`${state}.constructionLedger.map(e=>[e.scrap,e.parts])`),[[400,0]]);
    assert.equal(await evaluate(pending),null);
    await evaluate(`clock=sm.view.state.rooms.find(r=>r.id===4).upgradeAt+1;
      const completed=sm.view.state.rooms.find(r=>r.id===4);completed.level=2;completed.upgradeAt=null;
      sm.view.state.lastSettledAt=clock;sm.view.progress={level:5,score:67};`);
    await reloadCampaign();await settle('productive route reaches the level without point-only storage');
    assert.equal(await evaluate(`${state}.developmentTrace.history.at(-1).outcome`),'reached');
    assert.equal(await evaluate(`${state}.developmentTrace.history.at(-1).end.score`),67);
    assert.equal(await evaluate('sm.view.state.rooms.find(r=>r.id===100).level'),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===100).length`),0);
  });
  await t.test('发展路线浏览器：确认窗口后预算降低，撤销完整路线且不花首笔材料',async()=>{
    await setupShelter(growthInvestmentBrowserScene());
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'growth investment confirmation');
    await evaluate(`const control=${panel}.getElementById('shelter-scrap-limit');control.value='191';${panel}.getElementById('shelter-development-save').click();`);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1')).scrapLimit`),191);
    await settle('changed route budget cancels submission');
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.resources.scrap'),3000);assert.equal(await evaluate(pending),null);
  });
  const policyInvestmentScene=(reason,target=7)=>growthInvestmentBrowserScene(reason==='budget'?199:200)+`
    localStorage.setItem('arkengine:auto-shelter:population:v1','${target}');
    const policy=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
    if('${reason}'==='disabled')policy.upgrade=false;
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(policy));`;
  await t.test('规划保留量浏览器：只够工程报价时等待，库存达到含保留量门槛后开工且刷新不重复',async()=>{
    await setupShelter(growthInvestmentBrowserScene()+`
      sm.view.state.resources.scrap=200;
      localStorage.setItem('arkengine:auto-shelter:population:v1','7');`);
    await settle('construction waits for its scrap reserve');
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),200);
    assert.match(await evaluate(`${state}.developmentTrace.active.latest.reason`),/尚缺 100 废料.*保留量/);
    await evaluate('sm.view.state.resources.scrap=299;');
    await reloadCampaign();await settle('one scrap below payment threshold');
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0);
    await evaluate('sm.view.state.resources.scrap=300;');
    await reloadCampaign();await settle('payment threshold reached');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).map(c=>[c.type,c.roomId])`),[['upgrade',100]],JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.resources.scrap'),100);
    assert.deepEqual(await evaluate(`${state}.constructionLedger.map(e=>[e.scrap,e.parts])`),[[200,0]]);
    await reloadCampaign();await settle('reserve remains after confirmed payment');
    assert.equal(await evaluate(`${state}.constructionLedger.length`),1);assert.equal(await evaluate(pending),null);
  });
  await t.test('规划保留量浏览器：确认窗口后提高保留量，取消提交并显示真实缺口',async()=>{
    await setupShelter(growthInvestmentBrowserScene()+`
      sm.view.state.resources.scrap=300;
      localStorage.setItem('arkengine:auto-shelter:population:v1','7');`);
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'reserve-sensitive upgrade confirmation');
    await evaluate(`const c=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));c.scrapReserve=101;
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(c));`);
    await settle('reserve changed during confirmation');
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.resources.scrap'),300);assert.equal(await evaluate(pending),null);
    // The changed setting starts a new Worker comparison. Re-enter the normal
    // inspection cycle before asserting its completed funding explanation.
    await reloadCampaign();
    await drive(`${state}?.developmentTrace?.active?.latest?.reason?.includes('尚缺 1 废料')`,'new reserve plan ready');
    assert.match(await evaluate(`${state}.developmentTrace.active.latest.reason`),/尚缺 1 废料.*保留量/);
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0);
  });
  await t.test('规划权限浏览器：升级关闭或单笔超额时实际新建达级，刷新只记一笔费用',async()=>{
    for(const reason of ['disabled','budget'])for(const target of [7,17]){
      await setupShelter(policyInvestmentScene(reason,target));await settle('legal construction route '+reason+' '+target);
      assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).map(c=>[c.type,c.room])`),[['build','storage']],JSON.stringify(await diagnose()));
      assert.equal(await evaluate('sm.view.state.resources.scrap'),2807);
      assert.deepEqual(await evaluate(`${state}.constructionLedger.map(e=>[e.scrap,e.parts])`),[[193,0]]);
      await reloadCampaign();await settle('policy route survives refresh');
      assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),1);
      assert.equal(await evaluate('sm.view.state.resources.scrap'),2807);assert.equal(await evaluate(pending),null);
      await evaluate(`clock=Math.max(...sm.view.state.rooms.map(r=>r.builtAt))+1;
        sm.view.state.lastSettledAt=clock;sm.view.progress={level:5,score:66};`);
      await reloadCampaign();await settle('alternative construction reaches the same level');
      assert.equal(await evaluate(`${state}.developmentTrace.history.at(-1).outcome`),'reached');
      assert.equal(await evaluate(`${state}.developmentTrace.history.at(-1).end.score`),66);
      assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
    }
  });
  await t.test('规划权限浏览器：替代新建确认前关闭建造或降低额度，撤销且不扣款',async()=>{
    for(const change of ['disabled','budget']){
      await setupShelter(policyInvestmentScene('disabled'));
      await drive(`!!document.querySelector('[data-construction-dialog]')`,'alternative build confirmation');
      await evaluate(`const c=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
        if('${change}'==='disabled')c.build=false;else c.scrapLimit=191;
        localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(c));`);
      await settle('alternative construction permission withdrawn');
      assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0,JSON.stringify(await diagnose()));
      assert.equal(await evaluate(`${state}.constructionLedger?.length||0`),0);
      assert.equal(await evaluate('sm.view.state.resources.scrap'),3000);assert.equal(await evaluate(pending),null);
    }
  });
  const levelInvestmentScene=()=>scene({},`sm.view=${JSON.stringify(upperStageView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
    const ls=sm.view.state;for(const r of ls.rooms){if(r.type!=='elevator')r.level=3;r.stored=0;}
    ls.rooms.find(r=>r.id===6).level=1;ls.resources={scrap:2000,parts:40,power:500,food:500,water:500,stimpak:7};
    const score=2*ls.residents.length+3*ls.depth+ls.rooms.filter(r=>!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
    sm.view.progress={level:1+Math.floor(Math.sqrt((score-30))/1.5),score,next:111};
    ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:population:v1','15');localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');`);
  await t.test('等级投资浏览器：未满仓且人口阶段完成，实际升级空宿舍并只记一次费用，刷新保留施工',async()=>{
    await setupShelter(levelInvestmentScene());
    await settle('existing empty quarters upgrade');
    const calls=await evaluate('sm.calls');assert.equal(calls.filter(c=>c.type==='upgrade'&&c.roomId===6).length,1,JSON.stringify(await diagnose()));
    assert.equal(calls.filter(c=>c.type==='build'||c.type==='dig').length,0);
    assert.equal(await evaluate(`${state}.constructionLedger.reduce((n,r)=>n+r.scrap,0)`),900);
    assert.equal(await evaluate(`${state}.constructionLedger.reduce((n,r)=>n+r.parts,0)`),0);
    assert.ok(await evaluate('sm.view.state.rooms.find(r=>r.id===6).upgradeAt>clock'));
    await reloadCampaign();await settle('investment construction after refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===6).length`),1);
  });
  await t.test('等级投资浏览器：确认前有人入住空宿舍则撤销该升级，保留居民与费用',async()=>{
    await setupShelter(levelInvestmentScene());
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'empty quarters investment dialog');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),0);
    // Isolate occupied-room cancellation from ordinary employment. The frozen
    // 1.17.77 also assigns a healthy dorm occupant to production after cancelling.
    await evaluate('Object.assign(sm.view.state.residents.find(p=>p.id===13),{roomId:6,hp:20});');
    await settle('occupied quarters cancels investment');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===6).length'),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===13).roomId'),6);
    assert.equal(await evaluate(`${state}.constructionLedger?.reduce((n,r)=>n+r.scrap,0)||0`),0);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('等级投资接续浏览器：额度只够首项但无法完成达级时不盲目建空仓库',async()=>{
    for(const limit of [127,128]){
      await setupShelter(levelInvestmentScene()+`ls.rooms.find(r=>r.id===6).level=3;
        sm.view.progress.score+=6;sm.view.progress.level=1+Math.floor(Math.sqrt((sm.view.progress.score-30))/1.5);
        const lc=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));lc.scrapLimit=${limit};
        localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(lc));`);
      await settle('level investment warehouse within original budget '+limit);
      const calls=await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type))');
      // The frozen phase-2 source also refuses this obsolete cheap-prefix
      // expectation: 108/111 points needs more than one 128-scrap room, and
      // the later rooms exceed this same explicit per-day project ceiling.
      assert.deepEqual(calls,[],JSON.stringify(await diagnose()));
      assert.equal(await evaluate(`${state}.constructionLedger?.length||0`),0);
      assert.equal(await evaluate('sm.view.progress.score'),108);
      assert.match(await evaluate(`${state}.developmentTrace.active.latest.reason`),/还差 3 分/);
      assert.equal(await evaluate('sm.view.state.residents.length'),15);
      await reloadCampaign();await settle('incomplete level route remains unfunded after refresh');
      assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build").length'),0);
      assert.equal(await evaluate('sm.view.state.resources.scrap'),2000);
    }
  });
  const cheaperLevelScene=()=>levelInvestmentScene()+`ls.rooms.find(r=>r.id===6).level=3;
    ls.rooms.find(r=>r.id===90).level=2;ls.resources.parts=0;
    sm.view.progress.score=2*ls.residents.length+3*ls.depth+ls.rooms.filter(r=>!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
    sm.view.progress.level=1+Math.floor(Math.sqrt((sm.view.progress.score-30))/1.5);`;
  await t.test('等级成本浏览器：三级仓库缺零件时选择低成本新仓库，保持生产且刷新不重复消费',async()=>{
    await setupShelter(cheaperLevelScene());await settle('cheaper existing-space investment');
    const calls=await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type))');
    assert.equal(calls.length,1,JSON.stringify(await diagnose()));assert.equal(calls[0].type,'build');assert.equal(calls[0].room,'storage');
    assert.equal(await evaluate(`${state}.constructionLedger.reduce((n,r)=>n+r.scrap,0)`),128);
    assert.equal(await evaluate(`${state}.constructionLedger.reduce((n,r)=>n+r.parts,0)`),0);
    assert.equal(await evaluate('sm.view.state.rooms.find(r=>r.id===90).upgradeAt'),null);
    assert.ok(await evaluate('sm.calls.filter(c=>c.type==="assign").every(c=>sm.view.state.rooms.some(r=>r.id===c.roomId&&r.type==="scrap"))'),
      'normal recycler staffing is allowed; the warehouse must not require new workshop staffing');
    await reloadCampaign();await settle('cheap warehouse survives refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build").length'),1);
  });
  await t.test('等级成本浏览器：打开新仓库窗口后降低预算或提高人口目标，撤销尚未提交的投资',async()=>{
    for(const change of ['budget','population']){
      await setupShelter(cheaperLevelScene());await drive('!!document.querySelector("[data-construction-dialog]")','cheap warehouse window '+change);
      if(change==='budget')await evaluate(`const c=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));c.scrapLimit=127;
        localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(c));`);
      else await evaluate(`const c=${panel}.getElementById('shelter-population');c.value='30';c.dispatchEvent(new Event('change'));`);
      await drive('!document.querySelector("[data-construction-dialog]")','cheap investment withdrawn '+change);
      assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="storage").length'),0);
      assert.equal(await evaluate(`${state}.constructionLedger?.length||0`),0);assert.equal(await evaluate('sm.view.state.resources.scrap'),2000);
    }
  });
  const handoffScene=()=>levelInvestmentScene()+`ls.rooms.find(r=>r.id===6).level=2;
    ls.rooms.push({...ls.rooms[0],id:400,type:'workshop',level:3,floor:5,col:2,width:1});
    for(const id of [9,10])ls.residents.find(p=>p.id===id).roomId=400;
    // 工程交接以就业已落实、原备料工程已确认作为前提；历史宿舍/医疗人员不冒充已就业。
    for(const id of [13,14,15])ls.residents.find(p=>p.id===id).roomId=4;
    for(const p of ls.residents)if(ls.rooms.some(r=>r.id===p.roomId&&r.type==='power'))p.stats.str=10;
    ls.resources.scrap=5000;ls.resources.parts=45;
    sm.view.progress.score=2*ls.residents.length+3*ls.depth+ls.rooms.filter(r=>!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
    sm.view.progress.level=1+Math.floor(Math.sqrt((sm.view.progress.score-30))/1.5);
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'已备齐宿舍升级',campaign:{
      roles:[9,10].map(id=>({id,room:400,role:'workshop',at:clock})),trips:[],attempts:[],heals:[],trainingRest:[],
      materials:{vaultNo:77,id:6,type:'quarters',level:3,targetLevel:7,finalTarget:10}}}));`;
  await t.test('工坊工程交接浏览器：先升级再释放，实际扣料与刷新后重评，不把工人永久留在工坊',async()=>{
    await setupShelter(handoffScene());await settle('funded investment before workshop releases');
    const calls=await evaluate('sm.calls'),buildIndex=calls.findIndex(c=>c.type==='upgrade'&&c.roomId===6);
    assert.ok(buildIndex>=0,JSON.stringify(await diagnose()));
    assert.ok(calls.slice(0,buildIndex).every(c=>c.type!=='assign'||![9,10].includes(c.residentId)),'开工前不释放现有工坊');
    assert.equal(await evaluate(`${state}.constructionLedger.reduce((n,r)=>n+r.parts,0)`),45);
    assert.equal(await evaluate(`${state}.constructionLedger.reduce((n,r)=>n+r.scrap,0)`),2160);
    await reloadCampaign();await evaluate(`${panel}.getElementById('shelter-check').click();`);await settle('handoff after refresh');
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[9,10].includes(p.id)).every(p=>p.roomId!==400)'),
      '下一轮无后续备料需求时实际释放 '+JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===6).length'),1);
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>r.role!=='workshop')`));
  });
  await t.test('工坊工程交接浏览器：建设窗口后预算被调低，撤销升级并解除本次交接保留',async()=>{
    await setupShelter(handoffScene());await drive('!!document.querySelector("[data-construction-dialog]")','handoff upgrade window');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"||c.type==="assign"&&[9,10].includes(c.residentId)).length'),0);
    // 保持自动备料启用，只把额度降到本工程所需45件以下；0同时关闭自动工坊管理，是另一项设置语义。
    await evaluate(`const hc=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));hc.partsLimit=44;
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(hc));`);
    await settle('budget change cancels construction handoff');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),0);
    await reloadCampaign();await evaluate(`${panel}.getElementById('shelter-check').click();`);await settle('release workers after cancelled handoff');
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[9,10].includes(p.id)).every(p=>p.roomId!==400)'),JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.constructionLedger?.length||0`),0);
  });
  await t.test('工坊工程交接浏览器：开工结果未知时跨刷新保留原请求，不再次升级或调动保留工人',async()=>{
    await setupShelter(handoffScene());await drive('!!document.querySelector("[data-construction-dialog]")','handoff before unknown upgrade');
    await evaluate("sm.mode='unknown';");await drive('sm.calls.some(c=>c.type==="upgrade"&&c.roomId===6)','unknown handoff upgrade');
    const saved=await evaluate(pending),count=await evaluate('sm.calls.length');
    assert.equal(saved.kind,'upgrade');assert.deepEqual(saved.targets,[6]);
    assert.equal(saved.constructionKey,await evaluate('sm.calls.find(c=>c.type==="upgrade").idempotencyKey'));
    await reloadCampaign();await settle('unknown handoff retained after refresh');
    assert.equal(await evaluate(`${pending}.id`),saved.id);assert.equal(await evaluate('sm.calls.length'),count);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),1);
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[9,10].includes(p.id)).every(p=>p.roomId===400)'));
    assert.equal(await evaluate(`${state}.constructionLedger?.length||0`),0,'未知开工保留在途预留，不伪造成功账本');
  });
  const neighbors=Array.from({length:8},(_,i)=>({userId:i+1,vaultNo:100+i,shelterName:'邻居避难所'+i,self:false,helpedToday:false,helpBlocked:null,helpScrap:13}));
  const growthScene=()=>scene({},`sm.view=${JSON.stringify(populationGrowthView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;sm.confirmFamily=true;
    ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
    localStorage.setItem('arkengine:auto-shelter:population:v1','30');localStorage.setItem('arkengine:auto-shelter:level-target:v1','6');`);
  const familyGrowthScene=()=>growthScene()+`sm.view=${JSON.stringify(familyGrowthView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
    for(const p of sm.view.state.residents)p.familyCooldownUntil=clock-1;
    localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'原家庭等待接替',families:[{a:6,b:7,room:5}]}));`;
  const adultJobsScene=()=>scene({},`sm.view=${JSON.stringify(workshopChurnView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
    const js=sm.view.state;for(const r of js.rooms)r.stored=0;js.resources.scrap=800;js.residents.find(p=>p.id===21).roomId=4;
    for(const p of js.residents)if(![35,36].includes(p.id))p.stats.end=0;
    for(const id of [35,36])Object.assign(js.residents.find(p=>p.id===id),{roomId:5,parents:[1,2]});
    ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    const jb=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));jb.scrapLimit=128;
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(jb));
    localStorage.setItem('arkengine:auto-shelter:population:v1','17');localStorage.setItem('arkengine:auto-shelter:level-target:v1','5');`);
  const completeEmploymentInvestment=async roomId=>{
    const next=await evaluate('sm.view.state.rooms.find(r=>r.floor===5&&r.col===3&&r.type==="scrap")');
    assert.ok(next);assert.ok(next.builtAt>await evaluate('clock'));
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===${next.id}).length`),0);
    // Explicit observed completion and adjacent merge; the fixture is not a
    // server construction simulator. No income or workers are invented here.
    await evaluate(`clock=${next.builtAt}+1;const s=sm.view.state,first=s.rooms.find(r=>r.id===${roomId}),extra=s.rooms.find(r=>r.id===${next.id});
      first.width+=extra.width;first.stored+=extra.stored;s.rooms=s.rooms.filter(r=>r!==extra);
      s.lastSettledAt=clock;sm.view.serverTime=clock;sm.view.progress.score+=2;`);
    await reloadCampaign();await settle('completed adjacent investment receives real workers');
    assert.equal(await evaluate(`sm.view.state.residents.filter(p=>p.roomId===${roomId}).length`),4,JSON.stringify(await diagnose()));
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>p.roomId===1).length>=2'),'remaining power workers are retained');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="scrap").length'),2);
    const workers=await evaluate(`sm.view.state.residents.filter(p=>p.roomId===${roomId}).map(p=>p.id)`);
    await reloadCampaign();await settle('completed employment and investment survive refresh');
    assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>p.roomId===${roomId}).map(p=>p.id)`),workers);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="scrap").length'),2);
    assert.equal(await evaluate(pending),null);
  };
  const employmentSpaceScene=()=>{
    const snapshot=JSON.parse(readFileSync(new URL('./arkengine-shelter-employment-space.fixture.json',import.meta.url),'utf8'));
    return scene({},`const es=${JSON.stringify(snapshot)},offset=clock-es.view.serverTime;
      const shift=x=>Array.isArray(x)?x.map(shift):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,shift(v)])):
        typeof x==='number'&&x>1e12?x+offset:x;
      sm.view=shift(es.view);sm.view.state.lastSettledAt=clock;
      // 原备料工程已确认完工：本场验证随后的岗位扩层，不能把已付费账本当作空白。
      sm.view.state.rooms.find(r=>r.id===1002).level=3;sm.view.progress.score++;
      sm.view.state.resources.scrap-=480;sm.view.state.resources.parts=0;delete es.state.campaign.materials;
      sm.view.state.daily.day='2026-10-10';sm.view.state.season.month='2026-10';
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...shift(es.state),vaultNo:77,nextAt:0,note:'成年子女等待新岗位'}));
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:population:v1','30');localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');`);
  };
  await t.test('成年就业扩层浏览器：满层且旧站可升级时先开岗位空间，完工建站并实际安排子女生产',async()=>{
    await setupShelter(employmentSpaceScene());
    const initialSpent=await evaluate(`${state}.constructionLedger.reduce((n,r)=>n+r.scrap,0)`);
    await settle('dig for adult employment');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),1,JSON.stringify(await diagnose()));
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[48,49].includes(p.id)).map(p=>p.roomId)'),[1,1],
      '子女优先接现有发电空岗，不为旧断言强制继续闲置');
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[3,10].includes(p.id)).map(p=>p.roomId)'),[null,null],
      '退出原工坊的成人仍有实际岗位需求');
    const spent=await evaluate(`${state}.constructionLedger.reduce((n,r)=>n+r.scrap,0)`);
    assert.equal(spent-initialSpent,Math.ceil(120*5**1.4));
    await reloadCampaign();await settle('pending employment excavation is not repeated');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),1);
    // 提供已确认的新楼层状态，不把浏览器夹具的一小时占位工期当作实号规则。
    await evaluate(`const s=sm.view.state;s.depth=5;s.digging=null;
      s.rooms.push({...s.rooms.find(r=>r.type==='elevator'),id:1900,floor:5});
      sm.view.progress.score+=3;${panel}.getElementById('shelter-check').click();`);
    await settle('build actual jobs on completed floor');
    const room=await evaluate('sm.view.state.rooms.find(r=>r.floor===5&&r.type==="scrap")');
    assert.ok(room,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="scrap").length'),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===${room.id}).length`),0,'施工期间不提前安排');
    await evaluate(`clock=${room.builtAt}+1;sm.view.state.lastSettledAt=clock;${panel}.getElementById('shelter-check').click();`);
    await settle('first employment room starts production');
    assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>[3,10].includes(p.id)).map(p=>p.roomId)`),[room.id,room.id]);
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[48,49].includes(p.id)).map(p=>p.roomId)'),[1,1]);
    assert.equal(await evaluate('sm.view.state.residents.filter(p=>p.roomId===null).length'),0);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="scrap").map(c=>[c.floor,c.col])'),[[5,2],[5,3]],
      'employment is complete; the distinct adjacent cell is a funded labor investment, not a repeated job request');
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[6,11].includes(p.id)).map(p=>p.roomId)'),[1,1],
      'investment donors keep supplying power until the extra cell actually completes');
    await reloadCampaign();await settle('adult employment retained after reload');
    assert.ok(await evaluate(`sm.view.state.residents.filter(p=>[48,49].includes(p.id)).every(p=>
      sm.view.state.rooms.some(r=>r.id===p.roomId&&['power','diner','water','scrap','workshop'].includes(r.type)&&r.builtAt<=clock))`),JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="scrap").length'),2);
    await completeEmploymentInvestment(room.id);
  });
  await t.test('80人口并行就业浏览器：实际下挖保留原工坊备料，刷新不重复开工或撤人',async()=>{
    const seed=JSON.parse(readFileSync(new URL('./arkengine-shelter-stage80-settling.fixture.json',import.meta.url),'utf8'));
    await setupShelter(scene({},`sm.view=${JSON.stringify(seed.view)};clock=sm.view.serverTime;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:population:v1','80');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','auto');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(seed.state)},vaultNo:77,nextAt:0,note:'80 population employment'}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}));`));
    await settle('employment excavation with original manufacturing');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),1,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.campaign.materials.id`),9);
    const workers=seed.state.campaign.roles.filter(r=>r.role==='workshop').map(r=>[r.id,r.room]);
    assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>${JSON.stringify(workers.map(r=>r[0]))}.includes(p.id)).map(p=>[p.id,p.roomId]).sort((a,b)=>a[0]-b[0])`),workers.sort((a,b)=>a[0]-b[0]));
    await reloadCampaign();await settle('parallel excavation refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),1);
    assert.equal(await evaluate(`${state}.campaign.materials.id`),9);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&${JSON.stringify(workers.map(r=>r[0]))}.includes(c.residentId)&&c.roomId===null).length`),0);
  });

  await t.test('94人口供电浏览器：电站实际开工先于普通换位，刷新不重复升级或让18号往返',async()=>{
    const seed=JSON.parse(readFileSync(new URL('./arkengine-shelter-stage94-power.fixture.json',import.meta.url),'utf8'));
    await setupShelter(scene({},`sm.view=${JSON.stringify(seed.view)};clock=sm.view.serverTime;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:population:v1','100');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','auto');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(seed.state)},vaultNo:77,nextAt:0,note:'94 population power'}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}));`));
    await settle('ready power upgrade before optional swaps');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===1022).length'),1,JSON.stringify(await diagnose()));
    const first=await evaluate('sm.calls.findIndex(c=>c.type==="upgrade"&&c.roomId===1022)');
    assert.equal(await evaluate(`sm.calls.slice(0,${first}).some(c=>c.type==='assign'&&c.residentId===18&&c.roomId===null)`),false);
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('power upgrade refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===1022).length'),1);
  });

  await t.test('工坊换位接续浏览器：刷新后接完普通换位，缺件电站保持六人加工且不提前消费',async()=>{
    const seed=JSON.parse(readFileSync(new URL('./arkengine-shelter-workshop-swap.fixture.json',import.meta.url),'utf8'));
    await setupShelter(scene({},`sm.view=${JSON.stringify(seed.view)};clock=sm.view.serverTime;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:population:v1','100');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','auto');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(seed.state)},vaultNo:77,nextAt:0,note:'workshop swap continuation'}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}));`));
    const workers=seed.state.campaign.roles.filter(r=>r.role==='workshop').map(r=>[r.id,r.room]);
    await settle('resume swap without releasing manufacturing');
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").slice(0,2).map(c=>[c.residentId,c.roomId])'),[[118,9],[113,1032]],JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.swap`),null);assert.equal(await evaluate(`${state}.campaign.materials.id`),1022);
    assert.equal(await evaluate('sm.calls.filter(c=>["upgrade","dig","build"].includes(c.type)).length'),0);
    const count=await evaluate('sm.calls.filter(c=>c.type==="assign").length');
    await reloadCampaign();await settle('completed swap survives reload');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),count);
    assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>${JSON.stringify(workers.map(r=>r[0]))}.includes(p.id)).map(p=>[p.id,p.roomId]).sort((a,b)=>a[0]-b[0])`),workers.sort((a,b)=>a[0]-b[0]));
    assert.equal(await evaluate(pending),null);
  });

  for(const extraJobs of [false,true])await t.test(extraJobs?
    '家庭接替互扰浏览器：已有足够岗位时两对不反复换净水岗，实际升级餐厅并在刷新后保留':
    '家庭接替缺岗浏览器：真实收取后先就业与生产建设，不因旧家庭安排绕过子女岗位',async()=>{
    const seed=JSON.parse(readFileSync(new URL('./arkengine-shelter-family-swap.fixture.json',import.meta.url),'utf8'));
    // Preserve the historical no-jobs control. The positive has a separate,
    // explicitly built power floor with twelve real seats for adults and future
    // children. Power rooms add jobs without silently increasing consumer demand.
    if(extraJobs){const s=seed.view.state;s.depth++;
      s.rooms.push({...s.rooms.find(r=>r.type==='elevator'),id:2000,floor:s.depth,stored:0,builtAt:0,upgradeAt:null},
        ...[2,5].map((col,i)=>({...s.rooms.find(r=>r.type==='power'),id:2001+i,floor:s.depth,col,
          width:3,level:1,stored:0,builtAt:0,upgradeAt:null})));
      seed.view.progress.score+=9;
    }
    const milestone=extraJobs?'sm.calls.some(c=>c.type==="upgrade"&&c.roomId===1036)':'sm.calls.some(c=>c.type==="upgrade")';
    await setupShelter(scene({},`sm.view=${JSON.stringify(seed.view)};clock=sm.view.serverTime;sm.simulateResources=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:population:v1','100');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','auto');
      ${familyWorkerProbe}
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(seed.state)},vaultNo:77,nextAt:0,note:'family supply continuation'}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}));`));
    await settleFamily('family preparation converges to actual food capacity');
    // 按原生访问预算跨轮接续，不为测试绕过时长与动作上限。
    for(let visit=0;visit<4&&!await evaluate(milestone);visit++){
      await evaluate(`clock=Math.max(clock,${state}.nextAt+1);`);
      await reloadCampaign();await settleFamily('next visit continues family preparation');
    }
    if(process.env.ARKENGINE_FAMILY_INTERFERENCE_REPORT)writeFileSync(process.env.ARKENGINE_FAMILY_INTERFERENCE_REPORT.replace(/\.json$/,extraJobs?'-jobs.json':'-no-jobs.json'),
      JSON.stringify(await evaluate(`({view:shelterData(),state:${state},calls:sm.calls,receipts:sm.receipts,
        pending:${pending},resourceLedger:sm.resourceLedger,events:(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.slice(-40)})`),null,2));
    if(!extraJobs){
      assert.equal(await evaluate(pending),null);
      assert.ok(await evaluate('sm.calls.some(c=>c.type==="collect")'));
      assert.ok(await evaluate('sm.view.state.stats.collected>0'));
      assert.match(await evaluate(`${state}.populationEvaluation.note`),/未来72小时.*尚缺岗位/);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&sm.view.state.rooms.some(r=>r.id===c.roomId&&r.type==='quarters')).length`),0);
      assert.ok(await evaluate(`sm.calls.some(c=>c.type==='upgrade'&&sm.view.state.rooms.some(r=>r.id===c.roomId&&r.type==='scrap'))`));
      assert.ok(await evaluate('sm.resourceLedger.every(r=>Object.values(r.unserved).every(v=>v===0))'));
      const paid=await evaluate('sm.calls.filter(c=>c.type==="upgrade").map(c=>c.roomId)');
      await reloadCampaign();await settleFamily('confirmed collection and employment survive refresh');
      assert.equal(await evaluate(pending),null);
      assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="upgrade").map(c=>c.roomId)'),paid);
      assert.equal(await evaluate('sm.calls.filter(c=>c.type==="collect"&&c.roomId===1016).length'),1);
      return;
    }
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===1036).length'),1,JSON.stringify(await diagnose()));
    // Current idle employment legitimately puts 56 into the water vacancy once.
    // Neither family may reverse or repeat that staffing while preparing food.
    const handoffs=await evaluate('sm.assignmentOrigins.filter(c=>[14,56].includes(c.residentId))');
    assert.equal(handoffs.filter(c=>c.residentId===56&&c.roomId===7).length,1);
    for(const id of [14,56])assert.equal(handoffs.filter(c=>c.residentId===id).length,1);
    const paid=await evaluate(`${state}.constructionLedger.filter(r=>!${JSON.stringify(seed.state.constructionLedger.map(r=>r.id))}.includes(r.id))`);
    assert.equal(paid.length,1,'one actual construction receipt recorded');assert.equal(paid[0].scrap,250);assert.equal(paid[0].parts,0);
    assert.ok(await evaluate('sm.resourceLedger.every(r=>Object.values(r.unserved).every(v=>v===0))'));
    assert.equal(await evaluate(`${state}.swap`),null);
    await reloadCampaign();await settleFamily('food capacity upgrade survives refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===1036).length'),1);
    assert.deepEqual(await evaluate('sm.assignmentOrigins.filter(c=>[14,56].includes(c.residentId))'),handoffs);
    assert.equal(await evaluate(pending),null);
  });

  await t.test('家庭单步接替浏览器：跨轮完成供给与父母返回，18号不反复补电补水',async()=>{
    const seed=JSON.parse(readFileSync(new URL('./arkengine-shelter-family-power.fixture.json',import.meta.url),'utf8'));
    const familyComplete=`[12,118].every((id,i)=>sm.view.state.residents.some(p=>
      p.id===id&&p.roomId===59&&p.romance?.partnerId===[118,12][i]))&&!${state}.swap&&!${state}.pair&&!${pending}`;
    const settleHandoff=label=>settleFamily(label,`(${familyComplete})||(${done})`);
    const handoffProbe=`if(!window.handoffObserved){window.handoffObserved=true;
      const handoffFetch=window.fetch;window.fetch=async(url,options)=>{
        if(String(url)==='/api/shelter/action'&&options?.method==='POST'){
          const action=JSON.parse(options.body).action;
          if(action.type==='assign'&&action.residentId===18)(sm.handoffFrames??=[]).push({
            view:{...structuredClone(sm.view),serverTime:clock},state:${state},action});
        }return handoffFetch(url,options);
      };}`;
    const reloadHandoff=async()=>{await reloadCampaign();await evaluate(handoffProbe);};
    await setupShelter(scene({},`sm.view=${JSON.stringify(seed.view)};clock=sm.view.serverTime;sm.confirmFamily=true;sm.simulateResources=true;
      // Isolate the named family's return; other ready couples can legitimately fill
      // the last bed slots first. Multi-family interference has a separate scenario.
      for(const p of sm.view.state.residents)if(![12,118].includes(p.id))p.familyCooldownUntil=clock+24*3600000;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:population:v1','100');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','auto');
      ${familyWorkerProbe}
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(seed.state)},vaultNo:77,nextAt:0,note:'family single-step supply'}));
      ${handoffProbe}
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:100,partsReserve:0}));`));
    await settleHandoff('first family single-step visit');
    assert.ok(await evaluate('sm.familyReplies.some(r=>r.kind==="native-family-supply"&&r.beats>1)'),
      '真实家庭搜索期间页面定时器持续运行');
    // This scenario needs both milestones; an unrelated upgrade is not proof of family return.
    for(let visit=0;visit<6&&!await evaluate('sm.calls.some(c=>c.type==="upgrade")&&sm.view.state.residents.filter(p=>[12,118].includes(p.id)).every(p=>p.roomId===59)');visit++){
      await evaluate(`clock=Math.max(clock,${state}.nextAt+1);`);await reloadHandoff();await settleHandoff('continue actual family single-step visit');
    }
    // Paid upgrades stop production and occupy construction slots. Visit retries
    // do not complete their real duration. Bound this continuation to four actual
    // completions; an unchanged state without a real event must still fail.
    for(let recovery=0;recovery<4&&!await evaluate('sm.view.state.residents.filter(p=>[12,118].includes(p.id)).every(p=>p.roomId===59)');recovery++){
      const work=await evaluate('sm.view.state.rooms.filter(r=>r.upgradeAt>clock).sort((a,b)=>a.upgradeAt-b.upgradeAt)[0]');
      assert.ok(work,'unready family must have an observed recovery event '+JSON.stringify(await evaluate(`({calls:sm.calls,evaluation:${state}.populationEvaluation})`)));
      assert.ok(await evaluate(`sm.calls.some(c=>c.type==='upgrade'&&c.roomId===${work.id})`),'wait only for an actually submitted upgrade');
      const simulation=createShelterResourceSimulation(),ledgers=[],completed=[];
      let recovered=await evaluate('shelterData()');
      // Resource-only simulation deliberately refuses to invent non-resource
      // events. Settle each tick using its old production, then apply only paid,
      // observed upgrades whose deadline has actually elapsed at that tick end.
      while(recovered.serverTime<work.upgradeAt){
        const nextTick=recovered.state.lastSettledAt+600000;
        const result=recovered.serverTime===recovered.state.lastSettledAt?
          simulation.settleTick(recovered):simulation.advance(recovered,nextTick);
        recovered=result.view;ledgers.push(result.ledger);
        assert.ok(Object.values(result.ledger.unserved).every(v=>v===0),'food recovery wait must remain supplied');
        for(const room of recovered.state.rooms)if(room.upgradeAt!==null&&room.upgradeAt<=recovered.serverTime){
          completed.push(room.id);room.level++;room.upgradeAt=null;
        }
      }
      const score=2*recovered.state.residents.filter(p=>p.deadAt===null).length+3*recovered.state.depth+
        recovered.state.rooms.filter(r=>r.builtAt<=recovered.serverTime&&!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
      let level=1;while(score>=30+Math.ceil(2.25*level*level))level++;
      recovered.progress={level,score,next:30+Math.ceil(2.25*level*level)};
      assert.ok(completed.includes(work.id));
      await evaluate(`sm.view=${JSON.stringify(recovered)};clock=sm.view.serverTime;
        (sm.resourceLedger??=[]).push(...${JSON.stringify(ledgers)});`);
      assert.equal(await evaluate(`sm.view.state.rooms.find(r=>r.id===${work.id}).level`),work.level+1);
      assert.equal(await evaluate(`sm.view.state.rooms.find(r=>r.id===${work.id}).upgradeAt`),null);
      for(let visit=0;visit<6&&!await evaluate('sm.view.state.residents.filter(p=>[12,118].includes(p.id)).every(p=>p.roomId===59)');visit++){
        await evaluate(`clock=Math.max(clock,${state}.nextAt+1);`);await reloadHandoff();await settleHandoff('family return after actual food recovery');
      }
    }
    assert.ok(await evaluate('sm.calls.some(c=>c.type==="upgrade")'),JSON.stringify(await diagnose()));
    if(process.env.ARKENGINE_FAMILY_HANDOFF_REPORT)writeFileSync(process.env.ARKENGINE_FAMILY_HANDOFF_REPORT,
      JSON.stringify(await evaluate(`({view:shelterData(),state:${state},calls:sm.calls,origins:sm.assignmentOrigins,frames:sm.handoffFrames,
        construction:JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1')),
        campaign:JSON.parse(localStorage.getItem('${key}'))})`),null,2));
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[12,118].includes(p.id)).every(p=>p.roomId===59)'),
      JSON.stringify(await evaluate(`({calls:sm.calls.filter(c=>c.type!=='collect').map(c=>[c.type,c.residentId,c.roomId]),
        state:{note:${state}.note,evaluation:${state}.populationEvaluation,campaign:${state}.campaignNote,construction:${state}.constructionNote},
        parents:sm.view.state.residents.filter(p=>[12,118].includes(p.id)).map(p=>({id:p.id,room:p.roomId,romance:p.romance})),
        works:sm.view.state.rooms.filter(r=>r.upgradeAt>clock)})`)));
    assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>
      e.type==='shelter-family-planning'&&e.data.status==='ready'&&Number.isSafeInteger(e.data.jobId))`),
      '实际后台家庭供给计算完成后，原生父母返岗和建设才能继续');
    // A move to 1030 may now be a useful handover after other adults become available.
    // The regression is reversing/repeating that preparation without family progress.
    const moves18=await evaluate('sm.assignmentOrigins.filter(c=>c.residentId===18).map(c=>[c.from,c.roomId])');
    assert.equal(new Set(moves18.map(m=>JSON.stringify(m))).size,moves18.length,'no repeated handover '+JSON.stringify(moves18));
    assert.ok(!moves18.some(([from,to],i)=>moves18.slice(i+1).some(([a,b])=>a===to&&b===from)),
      'no reversed handover '+JSON.stringify(moves18));
    assert.equal(await evaluate(`${state}.swap`),null);assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate(familyComplete),true,'both original parents have reciprocal native romance and no unfinished handoff');
    const upgrades=await evaluate('sm.calls.filter(c=>c.type==="upgrade").map(c=>c.roomId)');
    const parentMoves=await evaluate('sm.calls.filter(c=>c.type==="assign"&&[12,118].includes(c.residentId))');
    // End the churn assertion at the completed family handoff. Later paid projects
    // have their own material shifts. Still run a full fresh visit after reload.
    const reads=await evaluate('sm.reads');
    await reloadHandoff();await settleFamily('completed family single-step survives refresh');
    assert.ok(await evaluate(`sm.reads>${reads}`),'refresh must actually read the current shelter');
    assert.equal(await evaluate(familyComplete),true);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign"&&[12,118].includes(c.residentId))'),parentMoves);
    const after=await evaluate('sm.calls.filter(c=>c.type==="upgrade").map(c=>c.roomId)');
    assert.ok(upgrades.every(id=>after.includes(id)));
    assert.equal(new Set(after).size,after.length,'刷新不能重复原房升级；另一空闲施工位可开不同工程 '+JSON.stringify(await diagnose()));
  });

  const restingJobsScene=()=>employmentSpaceScene()+`for(const p of sm.view.state.residents)if([48,49].includes(p.id))p.roomId=null;`;
  const swapSupportScene=(extra='')=>{
    const f=JSON.parse(readFileSync(new URL('./arkengine-shelter-swap-support.fixture.json',import.meta.url),'utf8'));
    return scene(f.campaign,`sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.ui20261109=true;
      sm.simulateResources=true;sm.confirmFamily=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','100');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','auto');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(f.state)},vaultNo:77,nextAt:0,note:'confirmed family swap support'}));${extra}`);
  };
  await t.test('换位辅助交接浏览器：先完成末步补水，工坊不因中间余量下降撤补，刷新不重复',async()=>{
    await setupShelter(swapSupportScene());
    const swap=await evaluate(`${state}.swap.id`);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===93&&c.roomId===7)&&!${pending}&&${state}.swap?.id!==${JSON.stringify(swap)}`,
      'complete original last handoff before unrelated release',180);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").slice(0,1).map(c=>[c.residentId,c.roomId])'),[[93,7]]);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===18).length'),0);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===18).roomId'),50);
    await reloadCampaign();await settleFamily('confirmed family swap survives refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===93&&c.roomId===7).length'),1);
  });
  await t.test('换位辅助交接浏览器：原末步回执未知时刷新只核对，不撤工坊或重复补水',async()=>{
    await setupShelter(swapSupportScene('sm.assignUnknown=true;'));
    await drive('sm.calls.some(c=>c.type==="assign")','unknown final family handoff');
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>[c.residentId,c.roomId])'),[[93,7]]);
    const saved=await evaluate(pending);assert.deepEqual(saved.targets,[93,7]);
    await reloadCampaign();await settle('unknown final handoff remains bound');
    assert.equal(await evaluate(`${pending}.id`),saved.id);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),1);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===18).roomId'),50);
  });
  await t.test('换位辅助交接浏览器：原末步确认前人员受伤则取消接替，不以接续优先绕过复核',async()=>{
    await setupShelter(swapSupportScene('sm.quickAssign=false;'));
    await drive('!!document.querySelector("[role=dialog] select")','last handoff before injury');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),0);
    await evaluate('sm.view.state.residents.find(p=>p.id===93).hp=1;');
    await settle('injury invalidates previously admitted handoff');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===93&&c.roomId===7).length'),0);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===93).roomId'),null);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('就业诊断浏览器：日志区分缺岗位与材料预算，完整分片包含儿童成年时间，不触发额外消费',async()=>{
    await setupShelter(adultJobsScene()+`const ec=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
      ec.scrapLimit=0;localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(ec));
      sm.view.state.residents.find(p=>p.id===35).adultAt=clock+3600000;`);
    await settle('employment diagnostic snapshot');
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const d=events.filter(e=>e.type==='shelter-decision').at(-1).data;
    assert.equal(d.employment.status,'capacity-needed');assert.equal(d.employment.eligibleAdults,1);
    assert.equal(d.employment.children,1);assert.equal(d.employment.readySlots,0);
    assert.equal(d.employment.shortageAfterConstruction,1);
    const parts=events.filter(e=>e.type==='shelter-decision-detail'&&e.data.diagnosticId===d.diagnosticId)
      .map(e=>e.data).sort((a,b)=>a.part-b.part),rows=parts.flatMap(p=>p.rows);
    assert.deepEqual(parts.map(p=>p.part),Array.from({length:d.totalParts},(_,i)=>i));assert.equal(rows.length,d.rows);
    const child=rows.find(r=>r.kind==='employment-person'&&r.id===35);
    assert.equal(child.status,'child');assert.ok(child.remainingMinutes>0&&child.remainingMinutes<=60);
    assert.equal(rows.find(r=>r.kind==='employment-person'&&r.id===36).status,'eligible-adult');
    assert.ok(rows.some(r=>r.kind==='employment-room'&&r.status==='ready'&&r.slots===0));
    assert.ok(rows.some(r=>r.kind==='construction'&&r.project.type==='scrap'&&r.allowanceReason&&r.funds.scrap.remaining24h===0));
    assert.equal(await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type)).length'),0);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===35).roomId'),5);
  });
  await t.test('休息就业浏览器：满层时先为闲置成人扩层建岗，完工后实际到岗，刷新不重复',async()=>{
    await setupShelter(restingJobsScene());await settle('resting adults need job space');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),1,JSON.stringify(await diagnose()));
    await reloadCampaign();await settle('rest job excavation survives reload');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),1);
    await evaluate(`const s=sm.view.state;s.depth=5;s.digging=null;
      s.rooms.push({...s.rooms.find(r=>r.type==='elevator'),id:1900,floor:5});sm.view.progress.score+=3;
      ${panel}.getElementById('shelter-check').click();`);
    await settle('rest jobs on completed floor');
    const room=await evaluate('sm.view.state.rooms.find(r=>r.floor===5&&r.type==="scrap")');
    assert.ok(room,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===${room.id}).length`),0);
    await evaluate(`clock=${room.builtAt}+1;sm.view.state.lastSettledAt=clock;${panel}.getElementById('shelter-check').click();`);
    await settle('resting adults enter actual jobs');
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[3,10].includes(p.id)).map(p=>p.roomId)'),[1,1]);
    assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>[48,49].includes(p.id)).map(p=>p.roomId)`),[room.id,room.id]);
    assert.ok(await evaluate(`sm.view.state.residents.filter(p=>[3,10,48,49].includes(p.id)).every(p=>
      sm.view.state.rooms.some(r=>r.id===p.roomId&&['power','diner','water','scrap'].includes(r.type)&&r.builtAt<=clock))`),JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),1);
    await reloadCampaign();await settle('rest jobs survive reload without excess construction');
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="scrap").map(c=>[c.floor,c.col])'),[[5,2],[5,3]]);
    await completeEmploymentInvestment(room.id);
  });
  await t.test('休息就业浏览器：扩层窗口期间闲置成人受伤，取消原工程且不扣费',async()=>{
    await setupShelter(restingJobsScene());const initialLedger=await evaluate(`${state}.constructionLedger`);
    await drive('!!document.querySelector("[data-construction-dialog]")','rest job excavation window');
    await evaluate('for(const p of sm.view.state.residents)if([3,10,48,49].includes(p.id))p.hp=1;');
    await settle('withdraw resting jobs excavation');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),0,JSON.stringify(await diagnose()));
    assert.deepEqual(await evaluate(`${state}.constructionLedger`),initialLedger);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('成年就业扩层浏览器：确认前待就业子女受伤则取消扩层，不为失效人选消费',async()=>{
    await setupShelter(employmentSpaceScene());const initialLedger=await evaluate(`${state}.constructionLedger`);
    await drive('!!document.querySelector("[data-construction-dialog]")','employment dig confirmation');
    // 自动工坊已释放的3/10现在也能驱动就业扩层；本取消场需令所有实际人选失效。
    await evaluate('for(const p of sm.view.state.residents)if([3,10,48,49].includes(p.id))p.hp=1;');
    await settle('cancel excavation without healthy job candidates');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),0,JSON.stringify(await diagnose()));
    assert.deepEqual(await evaluate(`${state}.constructionLedger`),initialLedger);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('成年就业浏览器：宿舍成年子女驱动岗位扩建，完工后直接上岗且刷新不重复',async()=>{
    await setupShelter(adultJobsScene());await settle('build jobs for adult children');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='scrap').length`),1,JSON.stringify(await diagnose()));
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[35,36].includes(p.id)).every(p=>p.roomId===5)'),
      'children stay in quarters until the actual workplace is ready');
    await reloadCampaign();await settle('keep new jobs across refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='scrap').length`),1);
    await evaluate('clock=Math.max(clock,...sm.view.state.rooms.map(r=>r.builtAt))+1;sm.view.state.lastSettledAt=clock;');
    await reloadCampaign();await settle('adult children start production');
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[35,36].includes(p.id)).every(p=>sm.view.state.rooms.some(r=>r.id===p.roomId&&r.type==="scrap"))'),JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[35,36].includes(c.residentId)&&c.roomId===null).length`),0);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),672);assert.equal(await evaluate(pending),null);
  });
  await t.test('成年就业浏览器：建设窗口后改为人工宿舍成人，不再为原人选消费',async()=>{
    await setupShelter(adultJobsScene());await drive(`!!document.querySelector('[data-construction-dialog]')`,'adult jobs construction window');
    await evaluate('for(const p of sm.view.state.residents.filter(p=>[35,36].includes(p.id)))p.parents=[];');
    await settle('cancel changed adult workforce');
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.resources.scrap'),800);assert.equal(await evaluate(pending),null);
  });
  await t.test('工坊两阶段浏览器：仅自动建设启用时保持原备料人选，补员和刷新不反复释放',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(dormWorkshopCycleView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      for(const p of sm.view.state.residents)if(p.familyCooldownUntil)p.familyCooldownUntil=clock-600000;
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','population');localStorage.setItem('arkengine:auto-shelter:population:v1','30');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'原工程备料',
        families:[[1,3,6],[2,10,1000],[12,21,1004],[13,14,5]].map(([a,b,room])=>({a,b,room})),
        campaign:{roles:[{id:1,room:50,role:'workshop',at:clock}],trips:[],attempts:[],heals:[],trainingRest:[],
          materials:{vaultNo:77,id:1,type:'power',level:3,targetLevel:7,finalTarget:10}}}));`));
    let recruited;
    for(let round=0;round<3;round++){
      if(round)await reloadCampaign();await settle('retain actual material shift '+round);
      assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===1).roomId'),50,JSON.stringify(await diagnose()));
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===1).length`),0);
      assert.equal(await evaluate(`${state}.campaign.materials.id`),1);
      const workers=await evaluate('sm.view.state.residents.filter(p=>p.roomId===50&&p.id!==1).map(p=>p.id)');
      assert.equal(workers.length,1,'原工坊只补一名可用成年子女');
      recruited??=workers[0];assert.equal(workers[0],recruited,'刷新不能替换已到岗的备料人选');
      assert.ok(await evaluate(`sm.view.state.residents.some(p=>p.id===${recruited}&&p.parents.length&&p.adultAt<=clock)`));
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===${recruited}).length`),1);
    }
    assert.ok(await evaluate(`sm.view.state.residents.filter(p=>[42,43].includes(p.id)&&p.id!==${recruited}).every(p=>
      sm.view.state.rooms.some(r=>r.id===p.roomId&&['scrap','power','water','diner'].includes(r.type)))`),'另一名成年子女落实实际生产岗位');
  });
  await t.test('家庭备料浏览器：回收空岗不撤销口粮升级，跨刷新保留工坊并为成年子女补岗',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(familyWorkshopCycleView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      for(const p of sm.view.state.residents)if(p.familyCooldownUntil)p.familyCooldownUntil=clock-600000;
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','population');localStorage.setItem('arkengine:auto-shelter:population:v1','30');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'家庭接替备料',
        families:[[1,3,6],[2,10,1000],[4,11,1004],[13,14,5]].map(([a,b,room])=>({a,b,room})),
        campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[]}}));`));
    for(let round=0;round<3;round++){
      if(round)await reloadCampaign();await settle('family material staffing '+round);
      assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===4).roomId'),50,JSON.stringify(await diagnose()));
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===4).length`),1);
      assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0,'wait for actual parts before construction');
      assert.equal(await evaluate(pending),null);
    }
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId>=37&&c.roomId===1003)`),
      'new adult works in the vacated scrap slot while the workshop continues');
  });
  const workshopReturnScene=()=>scene({},`sm.view=${JSON.stringify(workshopFamilyReturnView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;sm.confirmFamily=true;
      for(const p of sm.view.state.residents)if(p.familyCooldownUntil)p.familyCooldownUntil=clock-600000;
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','population');localStorage.setItem('arkengine:auto-shelter:population:v1','30');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'原家庭返宿舍',
        families:[[1,3,6],[2,10,1000],[4,11,1004],[13,14,5]].map(([a,b,room])=>({a,b,room})),
        campaign:{roles:[{id:4,room:50,role:'workshop',at:clock}],trips:[],attempts:[],heals:[],trainingRest:[],
          materials:{vaultNo:77,id:1002,type:'scrap',level:3,targetLevel:8,finalTarget:10}}}));`);
  await t.test('工坊人口浏览器：条件已够的原家庭先返宿舍，工坊不反复抓回释放者',async()=>{
    await setupShelter(workshopReturnScene());
    for(let round=0;round<3;round++){
      if(round)await reloadCampaign();await settle('ready family return '+round);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===4&&c.roomId===50).length`),0,
        'the released parent cannot be repeatedly grabbed back by workshop');
      if(await evaluate('sm.view.state.residents.find(p=>p.id===4).romance?.partnerId===11'))break;
    }
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[4,11].includes(p.id)).every(p=>p.roomId===1004)'),JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===4).romance?.partnerId'),11);
    assert.deepEqual(await evaluate('sm.assignmentOrigins.filter(c=>c.residentId===4).map(c=>[c.from,c.roomId])'),[[50,1004]],
      'one confirmed handoff from workshop to the original dorm, with no idle intermediate');
    await reloadCampaign();await settle('family stays after refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===4&&c.roomId===50).length`),0);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('工坊家庭交接浏览器：提交前伴侣受伤时取消返宿舍，保留原岗',async()=>{
    await setupShelter(workshopReturnScene()+'sm.quickAssign=false;sm.ui20261109=true;');
    await drive('!!document.querySelector("[data-staff-dialog="+CSS.escape("4")+"]")','workshop parent detail before handoff',180);
    await evaluate('sm.view.state.residents.find(p=>p.id===11).hp=1;');
    await settle('unsafe workshop family handoff cancelled');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===4&&c.roomId===1004).length'),0);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===4).roomId'),50);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('工坊家庭交接浏览器：返宿舍请求结果未知时刷新保留原单，不重复调岗',async()=>{
    await setupShelter(workshopReturnScene()+`const prior=window.fetch;window.fetch=async(u,o)=>{
      if(u==='/api/shelter/action'&&JSON.parse(o.body).action.type==='assign'&&JSON.parse(o.body).action.residentId===4){
        sm.assignUnknown=true;try{return await prior(u,o);}finally{sm.assignUnknown=false;}}
      return prior(u,o);};`);
    await drive('sm.calls.some(c=>c.type==="assign"&&c.residentId===4&&c.roomId===1004)','family return submitted once',180);
    const original=await evaluate(pending);assert.ok(original.campaignKey);
    await reloadCampaign();await settle('unknown family return remains bound');
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===4).map(c=>c.roomId)'),[1004]);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===4).roomId'),50);
    assert.ok(await evaluate(`${state}.campaign.roles.some(r=>r.id===4&&r.role==='workshop')`));
  });
  const familyTrainingSeatScene=()=>familyGrowthScene()+`
    sm.view=${JSON.stringify(familyTrainingSeatView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
    for(const p of sm.view.state.residents)p.familyCooldownUntil=clock-1;
    const trainingConfig=JSON.parse(localStorage.getItem('${key}'));trainingConfig.training=true;trainingConfig.trainTarget=10;
    localStorage.setItem('${key}',JSON.stringify(trainingConfig));
    const trainingSchedule=${state};trainingSchedule.campaign={roles:[11,12].map(id=>({id,room:8,role:'training',at:clock,
      stat:'per',base:0,purpose:'production',until:clock+4*3600000,windowEnd:clock+168*3600000,destination:108})),
      trips:[],attempts:[],heals:[],trainingRest:[]};
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(trainingSchedule));
    const trainingBudget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
    trainingBudget.scrapLimit=140;localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(trainingBudget));`;
  await t.test('家庭训练预留浏览器：保留训练进度和返岗两席，实际开工接替水站且刷新不重复扣款',async()=>{
    await setupShelter(familyTrainingSeatScene());
    await settle('family expansion despite reserved water seats');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).map(c=>[c.type,c.room,c.floor,c.col])`),
      [['build','water',3,6]],JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2860);
    assert.deepEqual(await evaluate(`${state}.constructionLedger.map(e=>[e.scrap,e.parts])`),[[140,0]]);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&([11,12].includes(c.residentId)||c.roomId===108)).length`),0);
    assert.ok(await evaluate(`sm.view.state.residents.filter(p=>[11,12].includes(p.id)).every(p=>p.roomId===8&&p.training===.5)`));
    const until=await evaluate(`${state}.campaign.roles.filter(r=>[11,12].includes(r.id)).map(r=>[r.id,r.until,r.destination])`);
    assert.equal(until.length,2);
    await reloadCampaign();await settle('training reservations and construction receipt survive reload');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='water').length`),1);
    assert.deepEqual(await evaluate(`${state}.campaign.roles.filter(r=>[11,12].includes(r.id)).map(r=>[r.id,r.until,r.destination])`),until);
    assert.equal(await evaluate(`${state}.constructionLedger.length`),1);assert.equal(await evaluate(pending),null);
  });
  await t.test('家庭训练预留浏览器：确认窗口后返岗席位释放，撤销失去必要性的扩建且不扣款',async()=>{
    await setupShelter(familyTrainingSeatScene());
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'reserved-seat expansion confirmation');
    await evaluate(`for(const p of sm.view.state.residents)if([11,12].includes(p.id)){p.stats.per=1;p.training=0;}`);
    await drive(`!document.querySelector('[data-construction-dialog]')&&!${pending}&&
      sm.view.state.residents.filter(p=>[11,12].includes(p.id)).every(p=>p.roomId!==8)&&
      !${state}.campaign.roles.some(r=>[11,12].includes(r.id)&&r.role==='training')`,
      'cancel obsolete expansion and confirm completed trainees return',90);
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.resources.scrap'),3000);assert.equal(await evaluate(pending),null);
  });
  const parallelFamilyScene=()=>familyGrowthScene()+`
    sm.view.state.rooms.push({...sm.view.state.rooms.find(r=>r.id===4),id:200,floor:5,col:2,
      level:2,stored:0,upgradeAt:clock+9*3600000});
    const parallelBudget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
    parallelBudget.scrapLimit=120;localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(parallelBudget));`;
  await t.test('家庭扩产并行浏览器：九小时回收工程不挡补水开工，刷新保留两项施工且不重复付款',async()=>{
    await setupShelter(parallelFamilyScene());
    const original=await evaluate('sm.view.state.rooms.find(r=>r.id===200).upgradeAt');
    await settle('independent water starts before unrelated recycler finishes');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).map(c=>[c.type,c.room,c.floor,c.col])`),
      [['build','water',1,7]]);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2880);
    assert.deepEqual(await evaluate(`${state}.constructionLedger.map(e=>[e.scrap,e.parts])`),[[120,0]]);
    assert.equal(await evaluate('sm.view.state.rooms.find(r=>r.id===200).upgradeAt'),original);
    assert.ok(await evaluate(`clock<${original}&&sm.view.state.rooms.some(r=>r.type==='water'&&r.builtAt>clock)`));
    await reloadCampaign();await settle('parallel water receipt remains confirmed');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='water').length`),1);
    assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
    assert.equal(await evaluate('sm.view.state.rooms.find(r=>r.id===200).upgradeAt'),original);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('家庭扩产并行浏览器：确认窗口期间第二施工占满名额，撤销补水且不扣款',async()=>{
    await setupShelter(parallelFamilyScene());
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'parallel family build confirmation');
    await evaluate(`sm.view.state.rooms.push({...sm.view.state.rooms.find(r=>r.id===200),id:201,floor:6});`);
    await settle('cancel parallel build when capacity changes');
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),3000);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('家庭扩产浏览器：扩充实际接替岗位，刷新不重复，并行就业后原家庭返宿舍',async()=>{
    // Isolate the original family supply budget; existing employment may now
    // avoid the formerly required extra recycling room.
    await setupShelter(familyGrowthScene()+`const budget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
      budget.scrapLimit=388;localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(budget));`);
    let priorCalls=0;
    for(let round=0;round<8;round++){
      await settle('family supply construction '+round);
      if(await evaluate('sm.view.state.residents.find(p=>p.id===6).romance?.partnerId===7'))break;
      const familyWork=`sm.calls.filter(c=>c.type==='build'&&c.room==='water'||c.type==='upgrade'&&sm.view.state.rooms.some(r=>r.id===c.roomId&&r.type==='water'))`;
      const before=await evaluate(`${familyWork}.length`);
      assert.ok(before>0,JSON.stringify(await diagnose()));
      const pendingWork=await evaluate('sm.view.state.rooms.some(r=>r.type==="water"&&(r.builtAt>clock||r.upgradeAt!==null))');
      if(pendingWork){
        await reloadCampaign();await settle('do not duplicate pending family supply '+round);
        assert.equal(await evaluate(`${familyWork}.length`),before,
          JSON.stringify(await evaluate(`({clock,calls:sm.calls.filter(c=>['build','upgrade'].includes(c.type)),
            rooms:sm.view.state.rooms.map(({id,type,floor,col,builtAt,upgradeAt})=>({id,type,floor,col,builtAt,upgradeAt}))})`)));
        await evaluate(`clock=Math.max(clock,...sm.view.state.rooms.map(r=>Math.max(r.builtAt,r.upgradeAt||0)))+1;
          for(const r of sm.view.state.rooms)if(r.upgradeAt!==null){r.level++;r.upgradeAt=null;}
          sm.view.state.lastSettledAt=clock;`);
      }else assert.ok(await evaluate('sm.calls.length')>priorCalls,'completed rooms must lead to staffing progress');
      priorCalls=await evaluate('sm.calls.length');
      await reloadCampaign();
    }
    await settle('family supply final staffing');
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===6).romance?.partnerId'),7,JSON.stringify(await diagnose()));
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[6,7].includes(p.id)).every(p=>p.roomId===5)'));
    assert.equal(await evaluate('sm.view.state.residents.length'),15,'romance does not create a worker before birth');
    const builds=await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='water').length`);
    assert.equal(builds,2,'two new water cells provide actual replacement output and safe handover space');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===3).length`),0);
    // The released adult uses the existing power vacancy, so the two actual
    // supply projects suffice. Do not require an extra empty employment room.
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).map(c=>[c.type,c.room,c.floor,c.col])`),
      [['build','water',1,7],['build','water',3,6]]);
    assert.deepEqual(await evaluate(`${state}.constructionLedger.map(e=>[e.scrap,e.parts])`),[[120,0],[140,0]]);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2740,'only the two actual water projects are charged');
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===15).roomId'),1);
    await reloadCampaign();await settle('sufficient family supply stops expansion');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='water').length`),builds);
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),2);
    assert.equal(await evaluate(`${state}.constructionLedger.length`),2);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('家庭扩产浏览器：窗口后目标、模式或家庭变化撤销，零预算不消费',async()=>{
    for(const change of ['target','mode','family','budget']){
      await setupShelter(familyGrowthScene()+(change==='budget'?`const b=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));b.scrapLimit=0;localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(b));`:''));
      if(change!=='budget'){
        await drive(`!!document.querySelector('[data-construction-dialog]')`,'family expansion window '+change);
        if(change==='family')await evaluate('sm.view.state.residents.find(p=>p.id===6).happiness=49;');
        else await evaluate(`const control=${panel}.getElementById('${change==='target'?'shelter-population':'shelter-staff'}');
          control.value='${change==='target'?'15':'production'}';control.dispatchEvent(new Event('change'));`);
      }
      await settle('cancel family expansion '+change);
      assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0,JSON.stringify(await diagnose()));
      assert.equal(await evaluate('sm.view.state.resources.scrap'),3000);assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('家庭扩产浏览器：最终容量够但父母无法安全腾位，补过渡岗位后完成交接',async()=>{
    await setupShelter(familyGrowthScene()+`const fs=sm.view.state;fs.rooms.find(r=>r.id===3).level=2;
      fs.rooms.push({...fs.rooms.find(r=>r.id===3),id:108,floor:1,col:7,level:1});
      for(const [id,room] of [[3,3],[6,2],[7,108],[8,108],[9,3]])fs.residents.find(p=>p.id===id).roomId=room;`);
    await settle('prepare a safe handover instead of indefinite staffing wait');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='water').length`),1,JSON.stringify(await diagnose()));
    await reloadCampaign();await settle('handover construction persists across refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='water').length`),1);
    await evaluate('clock=Math.max(clock,...sm.view.state.rooms.map(r=>r.builtAt))+1;sm.view.state.lastSettledAt=clock;');
    for(let round=0;round<6;round++){
      await reloadCampaign();await settle('complete safe parent handover '+round);
      if(await evaluate('sm.view.state.residents.find(p=>p.id===6).romance?.partnerId===7'))break;
    }
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===6).romance?.partnerId'),7,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='water').length`),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade').length`),0);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2860);assert.equal(await evaluate(pending),null);
  });
  await t.test('产物收取调度：5级两人闲置时先收已满批产物，再处理普通工坊岗位',async()=>{
    await setupShelter(scene({explore:true,sodaEfficiency:true},`sm.view=${JSON.stringify(workshopChurnView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'fixture',campaign:{roles:[{id:21,room:50,role:'workshop',at:clock}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`));
    await drive('sm.calls.length>0','first production or staffing action');
    assert.ok(['collect','collect_all'].includes(await evaluate('sm.calls[0].type')),JSON.stringify(await diagnose()));
    await settle('collection and ordinary work finish');
    assert.ok(await evaluate('sm.view.state.rooms.find(r=>r.id===3).stored<50'));
    assert.ok(await evaluate('sm.view.state.rooms.find(r=>r.id===4).stored<135'));
    for(let round=0;round<2;round++){await reloadCampaign();await settle('healthy idle workers return to useful work '+round);}
    const calls=await evaluate('sm.calls');
    assert.equal(calls.filter(c=>c.type==='assign'&&c.residentId===21&&c.roomId===null).length,1,'only release the old unnecessary shift once');
    assert.equal(calls.filter(c=>c.type==='assign'&&c.roomId===50).length,0,'no speculative restaffing for a different upgrade');
    // 此时现有回收站已满员，新建回收站为两人预留岗位；核对实际完工快照后才安排。
    assert.ok(await evaluate('sm.view.state.rooms.some(r=>r.type==="scrap"&&r.builtAt>clock)'));
    await evaluate('clock=Math.max(clock,...sm.view.state.rooms.filter(r=>r.type==="scrap").map(r=>r.builtAt))+1;sm.view.state.lastSettledAt=clock;');
    await reloadCampaign();await settle('new scrap room completed, reserved workers take their posts');
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[35,36].includes(p.id)).every(p=>p.roomId!==null||p.away!==null)'),JSON.stringify(await diagnose()));
  });
  await t.test('产物收取调度：满批产物不能抢在来袭增援之前',async()=>{
    await setupShelter(scene({defense:true},`sm.view=${JSON.stringify(workshopChurnView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.view.state.rooms.push({...sm.view.state.rooms[0],id:90,type:'door',floor:1,col:0,width:1,level:1,stored:0,incident:{kind:'raiders',hp:80,maxHp:80}});`));
    await drive('sm.calls.length>0','raid reinforcement before collection');
    const first=await evaluate('sm.calls[0]');assert.equal(first.type,'rescue_incident');assert.equal(first.roomId,90);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type.startsWith("collect")).length'),0);
  });
  await t.test('产物收取调度：原生收取按钮缺失仍能继续普通调岗，不反复切页',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(workshopChurnView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      const renderOriginal=renderShelter;window.renderShelter=()=>{renderOriginal();
        for(const b of document.querySelectorAll('button'))if(b.textContent==='全部收取'||b.getAttribute('aria-label')?.startsWith('收取'))b.remove();};`));
    await settle('missing collection controls do not starve staffing');
    assert.ok(await evaluate('sm.calls.some(c=>c.type==="assign")'),JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type.startsWith("collect")).length'),0);
  });
  await t.test('人口扩产浏览器：先升级满员水站，完工后配对，刷新不重复工程或人口预留',async()=>{
    await setupShelter(growthScene());await settle('prepare next birth water supply');
    const calls=await evaluate('sm.calls'),upgrade=calls.findIndex(c=>c.type==='upgrade'&&c.roomId===3);
    assert.ok(upgrade>=0,JSON.stringify(await diagnose()));
    assert.ok(!calls.slice(0,upgrade).some(c=>c.type==='assign'&&[5,6].includes(c.roomId)),'insufficient future water cannot start a family');
    assert.equal(calls.filter(c=>c.type==='upgrade'&&c.roomId===3).length,1);
    assert.equal(await evaluate('sm.view.state.residents.length'),15);
    await reloadCampaign();await settle('keep original water upgrade across refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===3).length`),1);
    await evaluate(`clock+=3600001;const room=sm.view.state.rooms.find(r=>r.id===3);room.level=2;room.upgradeAt=null;
      sm.view.state.lastSettledAt=clock;${panel}.getElementById('shelter-check').click();`);
    await drive(`${state}.families?.some(f=>f.room===6)&&!${pending}`,'water supply permits a confirmed family',240);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:population:v1')`),'30');
    assert.equal(await evaluate('sm.view.state.residents.length'),15,'a confirmed romance does not invent an already-born worker');
    assert.equal(await evaluate(`${state}.constructionLedger.filter(e=>e.scrap===250).length`),1);
  });
  const reservedGrowthScene=()=>scene({},`sm.view=${JSON.stringify(reservedGrowthView())};sm.view.serverTime=clock;
    sm.view.state.lastSettledAt=clock;sm.confirmFamily=true;${construction}
    localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
    localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
    localStorage.setItem('arkengine:auto-shelter:population:v1','50');
    localStorage.setItem('arkengine:auto-shelter:level-target:v1','auto');`);
  await t.test('已有床位浏览器：原两对家庭的子女缺岗时暂停第三对，生产建设刷新不重复或绕去扩宿舍',async()=>{
    await setupShelter(reservedGrowthScene());
    for(let round=0;round<3;round++){
      if(round)await reloadCampaign();await settle('existing families wait for real jobs '+round);
      const calls=await evaluate('sm.calls');
      assert.deepEqual(calls.map(c=>[c.type,c.room]),[['build','scrap']]);
      assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
      assert.equal(await evaluate(`${state}.constructionLedger[0].scrap`),128);
      assert.equal(await evaluate('sm.view.state.resources.scrap'),692);
      assert.equal(await evaluate('sm.view.state.rooms.filter(r=>r.type==="quarters").length'),3);
      assert.ok(await evaluate('sm.view.state.rooms.some(r=>r.type==="scrap"&&r.builtAt>clock)'));
      assert.match(await evaluate(`${state}.populationEvaluation.note`),/子女尚缺岗位/);
      assert.deepEqual(await evaluate(`${state}.families.map(f=>[f.a,f.b,f.room])`),[[17,18,5],[19,20,9]]);
      assert.equal(await evaluate(pending),null);
    }
    const observed=await evaluate('shelterData()'),room=observed.state.rooms.find(r=>r.builtAt>observed.serverTime),
      completed=createShelterResourceSimulation().advance(observed,room.builtAt+1);
    assert.ok(Object.values(completed.ledger.unserved).every(n=>n===0));
    await evaluate(`sm.view=${JSON.stringify(completed.view)};clock=sm.view.serverTime;${panel}.getElementById('shelter-check').click();`);
    await settle('first real production room completed with original job shortage');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="quarters").length'),0);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===6).length'),0);
    assert.match(await evaluate(`${state}.populationEvaluation.note`),/子女尚缺岗位/);
  });
  // Supply preparation is meaningful only after reserving real return seats
  // for four parents, two trainees and the already committed children.
  const reservedGrowthJobsScene=()=>reservedGrowthScene()+`sm.view.state.rooms.push({
    ...sm.view.state.rooms.find(r=>r.id===4),id:99,floor:4,col:2,level:1,stored:0});`;
  await t.test('已有床位浏览器：已有后续岗位时先补供给，第三对进入空三格宿舍，刷新不重复配对',async()=>{
    await setupShelter(reservedGrowthJobsScene());
    for(let round=0;round<5;round++){
      if(round)await reloadCampaign();await settle('prepare third family in existing dorm '+round);
      if(await evaluate(`${state}.families?.some(f=>f.room===6)`))break;
    }
    const calls=await evaluate('sm.calls'),placed=calls.map((c,i)=>({c,i})).filter(({c})=>c.type==='assign'&&c.roomId===6);
    assert.equal(placed.length,2,JSON.stringify(await diagnose()));
    assert.deepEqual(calls.filter(c=>c.type==='assign').map(c=>[c.residentId,c.roomId]),[[9,3],[10,2],[11,6],[12,6]]);
    assert.ok(calls.slice(0,placed[0].i).some(c=>c.type==='assign'&&[2,3].includes(c.roomId)),'prepare actual food/water output first');
    assert.equal(calls.slice(0,placed[1].i).filter(c=>c.type==='build'&&c.room==='quarters').length,0,'do not build housing before the existing dorm is used');
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[17,18,19,20].includes(p.id)).map(p=>p.romance.progress)'),[.2,.2,.2,.2]);
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[15,16].includes(p.id)).map(p=>p.roomId)'),[8,8]);
    await reloadCampaign();await settle('third family survives reload');
    assert.deepEqual(await evaluate('sm.calls'),calls,'same completed handover and construction remain stable across refresh');
    assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
    assert.equal(await evaluate(`${state}.constructionLedger[0].scrap`),264);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),556);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===6).length'),2);
    assert.equal(await evaluate('sm.view.state.residents.length'),21);
    assert.equal(await evaluate('localStorage.getItem("arkengine:auto-shelter:population:v1")'),'50');
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const decision=events.filter(e=>e.type==='shelter-decision').at(-1);
    assert.equal(decision.data.population.living,21);
    assert.equal(decision.data.population.future,24);
    assert.equal(decision.data.population.preparation,24,'all three dorms are now reserved, without an invented fourth birth');
  });
  await t.test('已有床位浏览器：补供给的原请求未知时刷新只核对，不能绕去新建宿舍',async()=>{
    await setupShelter(reservedGrowthJobsScene()+'sm.assignUnknown=true;');
    await drive('sm.calls.some(c=>c.type==="assign")','first supply move sent');
    const original=await evaluate(pending);assert.equal(original.kind,'assign');
    for(let pass=1;pass<=2;pass++){
      await reloadCampaign();await settle('supply request preserved '+pass);
      assert.equal(await evaluate(`${pending}.id`),original.id);
      assert.equal(await evaluate(`${state}.pendingReadOnly`),original.id);
      assert.deepEqual(await evaluate(`${pending}.targets`),original.targets);
      assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),1);
      assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="quarters").length'),0);
      assert.equal(await evaluate('sm.view.state.rooms.filter(r=>r.type==="quarters").length'),3);
    }
  });
  await t.test('已有床位浏览器：原缺岗场景的建设请求未知时刷新保留原单，不改建宿舍或调走父母',async()=>{
    await setupShelter(reservedGrowthScene()+"sm.mode='unknown';");
    await drive('sm.calls.some(c=>c.type==="build")','original future job construction sent');
    const original=await evaluate(pending);assert.equal(original.kind,'build');
    for(let pass=1;pass<=2;pass++){
      await reloadCampaign();await settle('original future job request preserved '+pass);
      assert.equal(await evaluate(`${pending}.id`),original.id);
      assert.equal(await evaluate(`${state}.pendingReadOnly`),original.id);
      assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.room])'),[['build','scrap']]);
      assert.equal(await evaluate('sm.view.state.resources.scrap'),820);
      assert.equal(await evaluate('sm.view.state.rooms.filter(r=>r.type==="quarters").length'),3);
      assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>[17,18,19,20].includes(p.id)).map(p=>p.romance.progress)'),[.2,.2,.2,.2]);
    }
  });
  await t.test('满床扩容浏览器：已预约满床先建必要宿舍，不被等级备料挡住，刷新不重复开工',async()=>{
    await setupShelter(reservedGrowthScene()+`const rs=sm.view.state;
      rs.residents.push({...structuredClone(rs.residents.at(-1)),id:22,name:'居民22'});
      for(const p of rs.residents)if([2,3].includes(p.roomId)){p.stats.agi=12;p.stats.per=12;}
      rs.resources.scrap=2200;rs.resources.parts=0;
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'满床时已有追级备料',
        campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[],
          materials:{vaultNo:77,id:4,type:'scrap',level:3,targetLevel:6,finalTarget:6}}}));`);
    await settle('full capacity housing before level materials');
    const calls=await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type))');
    assert.equal(calls[0]?.type,'build',JSON.stringify(await diagnose()));assert.equal(calls[0].room,'quarters');
    assert.equal(calls.filter(c=>c.type==='build'&&c.room==='quarters').length,1);
    assert.ok(await evaluate(`${state}.constructionLedger.some(c=>c.scrap>0&&c.parts===0)`));
    await reloadCampaign();await settle('keep original full-capacity housing project');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="quarters").length'),1);
  });
  await t.test('人口扩产浏览器：升级窗口打开后降低目标或退出人口模式，撤销未发送的扩产工程',async()=>{
    for(const change of ['target','mode']){
      await setupShelter(growthScene());await drive(`!!document.querySelector('[data-construction-dialog]')`,'growth water upgrade dialog');
      await evaluate(`const control=${panel}.getElementById('${change==='target'?'shelter-population':'shelter-staff'}');
        control.value='${change==='target'?'14':'production'}';control.dispatchEvent(new Event('change'));`);
      await settle('cancel unsubmitted growth project '+change);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===3).length`),0);
      assert.equal(await evaluate('sm.view.state.resources.scrap'),3000);assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('备料生产者浏览器：保留待升级房的最后工人，跨刷新等到零件后实际开工',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(materialProducerCycleView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:population:v1','30');localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'保留原房有效生产',
        campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[],
          materials:{vaultNo:77,id:1016,type:'scrap',level:3,targetLevel:9,finalTarget:10}}}));`));
    for(let round=0;round<2;round++){
      if(round)await reloadCampaign();await settle('keep material producer '+round);
      assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===3).roomId'),1016,JSON.stringify(await diagnose()));
      assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===2).roomId'),50);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===null).length`),0);
    }
    await evaluate(`sm.view.state.resources.parts=17.5;sm.view.state.rooms.find(r=>r.id===50).stored=0;
      ${panel}.getElementById('shelter-check').click();`);
    await settle('collected materials permit original upgrade');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===1016).length`),1,JSON.stringify(await diagnose()));
  });
  await t.test('备料供电浏览器：零件生产中保留原工程发电，刷新不反复撤工坊补电',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(workshopPowerCycleView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.view.state.rooms.find(r=>r.id===2).upgradeAt=clock+13/6*3600000;
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:population:v1','30');localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'保留备料供电',
        campaign:{roles:[{id:3,room:50,role:'workshop',at:clock}],trips:[],attempts:[],heals:[],trainingRest:[],
          materials:{vaultNo:77,id:4,type:'scrap',level:3,targetLevel:8,finalTarget:10}}}));`));
    let workers;
    for(let round=0;round<3;round++){
      if(round)await reloadCampaign();await settle('retain material power '+round);
      assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===1).roomId'),1,JSON.stringify(await diagnose()));
      const actual=await evaluate('sm.view.state.residents.filter(p=>p.roomId===50).map(p=>p.id).sort((a,b)=>a-b)');
      if(!workers){workers=actual;assert.equal(workers.length,2);assert.ok(workers.includes(3));}
      assert.deepEqual(actual,workers,'the original worker and actually admitted helper stay across refresh');
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&${JSON.stringify([1,...workers])}.includes(c.residentId)&&c.roomId!==50).length`),0);
      for(const id of workers.filter(id=>id!==3))
        assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===${id}&&c.roomId===50).length`),1);
    }
  });
  const workshopUpgradeScene=(view=workshopUpgradeView(),allowBuild=false)=>scene({},`sm.view=${JSON.stringify(view)};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
    ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:population:v1','30');localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');
    const wc=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));wc.build=${allowBuild};
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(wc));
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'工坊扩产比较',
      campaign:{roles:[10,35].map(id=>({id,room:50,role:'workshop',at:clock})),trips:[],attempts:[],heals:[],trainingRest:[],
        materials:{vaultNo:77,id:1010,type:'scrap',level:3,targetLevel:8,finalTarget:10}}}));`);
  const supportReturnScene=()=>scene({medical:true,radio:true},`
    s.rooms.find(r=>r.id===4).width=2;
    for(const [id,type] of [[90,'medbay'],[91,'radio']])s.rooms.push({...s.rooms[0],id,type,floor:3,col:id===90?2:3});
    s.residents[4].roomId=90;s.residents[5].roomId=91;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:population:v1','6');
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'辅助岗位直接返岗',
      campaign:{roles:[{id:5,room:90,role:'medical',at:clock},{id:6,room:91,role:'radio',at:clock}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`);
  await t.test('辅助返岗浏览器：医务室与电台结束值班直接生产，刷新不重复或先去休息',async()=>{
    await setupShelter(supportReturnScene());await settle('support staff directly returns');
    let calls=await evaluate('sm.calls.filter(c=>c.type==="assign")');assert.equal(calls.length,2);
    assert.deepEqual(calls.map(c=>[c.residentId,c.roomId]),[[5,4],[6,4]]);
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>![5,6].includes(r.id))`));
    await reloadCampaign();await settle('support return remains settled');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),2);
  });
  for(const kind of ['医疗需求恢复','招募条件恢复','目标房失效'])await t.test(`辅助返岗浏览器：居民窗口中${kind}时撤销原直接调岗`,async()=>{
    await setupShelter(supportReturnScene()+`sm.quickAssign=false;${kind==='招募条件恢复'?`s.residents[4].roomId=4;`:''}`);
    await drive(`!!document.querySelector('[role="dialog"] select')`,'support return resident window');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),0);
    if(kind==='医疗需求恢复')await evaluate('sm.view.state.resources.stimpak=0;');
    else if(kind==='招募条件恢复')await evaluate(`const input=${panel}.getElementById('shelter-population');input.value='14';input.dispatchEvent(new Event('change'));`);
    else await evaluate('sm.view.state.rooms.find(r=>r.id===4).unpowered=true;');
    await settle('support release revalidated');
    const id=kind==='招募条件恢复'?6:5;
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===${id}&&c.roomId===4).length`),0,
      JSON.stringify(await diagnose()));
    assert.equal(await evaluate(pending),null);
  });
  const workshopBuildScene=()=>workshopUpgradeScene(workshopBuildView(),true)+`
    const bc=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));bc.scrapLimit=1600;
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(bc));`;
  await t.test('工坊直接接岗浏览器：两名工人齐料后一次回生产，刷新不残留角色或重复释放',async()=>{
    await setupShelter(workshopUpgradeScene(workshopBuildView())+`sm.view.state.resources.parts=100;
      const rc=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));rc.scrapLimit=1;rc.dig=false;
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(rc));`);
    await settle('direct workshop return without idle assignment');
    const moves=await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[10,35].includes(c.residentId))`);
    assert.equal(moves.length,2,JSON.stringify(await diagnose()));
    assert.ok(moves.every(a=>a.roomId!==null));assert.equal(new Set(moves.map(a=>a.residentId)).size,2);
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[10,35].includes(p.id)).every(p=>sm.view.state.rooms.some(r=>r.id===p.roomId&&r.type==="scrap"))'));
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>![10,35].includes(r.id))`));
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('direct return survives reload');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[10,35].includes(c.residentId)).length`),2);
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>r.role!=='workshop-release')`));
    assert.equal(await evaluate(pending),null);
  });
  const growthReturnScene=()=>workshopUpgradeScene(workshopBuildView())+`sm.view.state.resources.parts=100;
    const rc=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));rc.scrapLimit=1;rc.dig=false;
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(rc));`;
  await t.test('工坊成长返岗浏览器：人口目标未满且有幼儿待产，两人各一次直接生产，刷新不重复释放',async()=>{
    await setupShelter(growthReturnScene()+`
      localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:population:v1','40');
      sm.view.state.residents.find(p=>p.id===49).adultAt=clock+3600000;
      sm.view.state.births=[{id:1,roomId:5,parents:[13,14],dueAt:clock+3600000}];
      for(const p of sm.view.state.residents.filter(p=>[10,35].includes(p.id)))p.familyCooldownUntil=clock+86400000;`);
    await drive(`sm.calls.filter(c=>c.type==='assign'&&[10,35].includes(c.residentId)).length>=2`,'growing population direct returns');
    const moves=await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[10,35].includes(c.residentId))`);
    assert.equal(moves.length,2);assert.equal(new Set(moves.map(c=>c.residentId)).size,2);
    assert.ok(moves.every(c=>c.roomId!==null),JSON.stringify(moves));
    assert.ok(await evaluate(`sm.view.state.residents.filter(p=>[10,35].includes(p.id)).every(p=>sm.view.state.rooms.some(r=>r.id===p.roomId&&r.type==='scrap'))`));
    await drive(`${pending}===null`,'return receipts confirmed');
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>![10,35].includes(r.id))`));
    await reloadCampaign();for(let i=0;i<6;i++)await pulse();
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[10,35].includes(c.residentId)).length`),2);
  });
  const reserveReturnSeat=`{
    const s=sm.view.state;
    const trainee={...structuredClone(s.residents[0]),id:999,name:'返岗训练者',roomId:9000,xp:0,hp:100,
      training:.9,stats:{str:5,agi:5,per:5,end:5,cha:5,int:5,lck:5},parents:[],romance:null,familyCooldownUntil:0};
    s.residents.push(trainee);
    s.rooms.push({...s.rooms[0],id:9000,type:'training',width:1,level:1,floor:6,col:2,trainStat:'end',stored:0});
    const schedule=${state};schedule.campaign.roles.push({id:999,room:9000,role:'training',at:clock,stat:'end',base:5,
      purpose:'production',until:clock+3600000,windowEnd:clock+168*3600000,destination:1010});
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(schedule));
    const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.training=true;cfg.trainTarget=10;
    localStorage.setItem('${key}',JSON.stringify(cfg));}`;
  const onlyReturnSeat=`for(const r of sm.view.state.rooms.filter(r=>r.type==='scrap')){
    if(r.id===1010)r.width=2;else r.unpowered=true;
  }`;
  await t.test('工坊成长返岗浏览器：最后空岗留给在训居民，收工人员不抢占',async()=>{
    await setupShelter(growthReturnScene()+onlyReturnSeat+reserveReturnSeat);
    await drive(`sm.calls.some(c=>c.type==='assign'&&[10,35].includes(c.residentId))`,'workshop can finish without taking reserved seat');
    for(let i=0;i<6;i++)await pulse();
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===1010).length`),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===999).roomId`),9000);
    assert.ok(await evaluate(`${state}.campaign.roles.some(r=>r.id===999&&r.destination===1010)`));
  });
  await t.test('工坊成长返岗浏览器：居民窗口打开后空位被训练预留，撤销旧直接调岗',async()=>{
    await setupShelter(growthReturnScene()+onlyReturnSeat+'sm.quickAssign=false;');
    await drive(`!!document.querySelector('[role="dialog"] select')`,'direct return window before training reservation');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign').length`),0);
    await evaluate(reserveReturnSeat);
    for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[10,35].includes(c.residentId)&&c.roomId===1010).length`),0,
      JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===999).roomId`),9000);
  });
  await t.test('工坊直接接岗浏览器：打开居民窗口后目标房失效，撤销原直接调岗',async()=>{
    await setupShelter(workshopUpgradeScene(workshopBuildView())+`sm.quickAssign=false;sm.view.state.resources.parts=100;
      const rc=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));rc.scrapLimit=1;rc.dig=false;
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(rc));`);
    await drive(`!!document.querySelector('[role="dialog"] select')`,'direct assignment resident window');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign').length`),0);
    await evaluate(`for(const r of sm.view.state.rooms.filter(r=>r.type==='scrap'))r.unpowered=true;`);
    await settle('invalid target cancels planned direct assignment');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[10,35].includes(c.residentId)&&c.roomId!==null).length`),0,
      JSON.stringify(await diagnose()));
    assert.equal(await evaluate(pending),null);
  });
  await t.test('备料额度浏览器：等待额度时保留原回收生产者和八人工坊，刷新后材料与额度齐备才开工',async()=>{
    await setupShelter(workshopUpgradeScene(workshopBudgetCycleView())+`
      const schedule=JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'));
      schedule.campaign.roles=sm.view.state.residents.filter(p=>[50,1012].includes(p.roomId))
        .map(p=>({id:p.id,room:p.roomId,role:'workshop',at:clock}));
      schedule.campaign.materials={vaultNo:77,id:4,type:'scrap',level:3,targetLevel:8,finalTarget:10};
      schedule.constructionLedger=[{id:'prior-upgrades',at:clock,scrap:2160,parts:60}];
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(schedule));`);
    await settle('continue material production during budget wait');
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===4).roomId'),4);
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),8);
    assert.equal(await evaluate('sm.calls.length'),0,JSON.stringify(await diagnose()));
    await reloadCampaign();await settle('budget wait survives refresh without churn');
    assert.equal(await evaluate('sm.calls.length'),0,JSON.stringify(await diagnose()));
    await evaluate(`sm.view.state.resources.parts=46;clock+=86400001;sm.view.state.lastSettledAt=clock;
      ${panel}.getElementById('shelter-check').click();`);
    try{await drive(`sm.calls.some(c=>c.type==='upgrade'&&c.roomId===4)`,'material project starts after budget expires',600);}
    catch(e){throw Error(e.message+' '+JSON.stringify(await diagnose()));}
    await settle('confirm budget-waited project');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===4).length`),1);
    assert.notEqual(await evaluate(`${state}.campaign.materials?.id??null`),4);
    assert.equal(await evaluate(pending),null);
  });
  const workshopPowerChainScene=(fixture='arkengine-shelter-workshop-power-chain.fixture.json')=>{
    const snapshot=JSON.parse(readFileSync(new URL('./'+fixture,import.meta.url),'utf8'));
    return scene({},`const ws=${JSON.stringify(snapshot)},offset=clock-ws.view.serverTime;
      const shift=x=>Array.isArray(x)?x.map(shift):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,shift(v)])):
        typeof x==='number'&&x>1e12?x+offset:x;
      sm.view=shift(ws.view);sm.view.state.lastSettledAt=clock;
      sm.view.state.daily.day='2026-10-10';sm.view.state.season.month='2026-10';
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...shift(ws.state),vaultNo:77,nextAt:0,note:'工坊与原工程联合供电'}));
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:population:v1','30');localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');`);
  };
  await t.test('工坊扩建供电接续浏览器：保留原工程生产者与联合供电，实际开工且刷新不重复',async()=>{
    await setupShelter(workshopPowerChainScene());
    const before=await evaluate(`${state}.constructionLedger.map(r=>r.id)`);
    await settle('build workshop without displacing original production');
    const calls=await evaluate('sm.calls'),index=calls.findIndex(c=>c.type==='build'&&c.room==='workshop');
    assert.ok(index>=0,JSON.stringify(await diagnose()));
    assert.ok(calls.slice(0,index).every(c=>c.type!=='assign'||![1,5].includes(c.residentId)),'开工前保留已补足的供电及原回收生产者');
    // 原快照含恰在24小时边界的旧费用，检查本次新增条目，不把过期移出误当退款。
    const added=(await evaluate(`${state}.constructionLedger`)).filter(r=>!before.includes(r.id));
    assert.equal(added.length,1);assert.equal(added[0].scrap,800);assert.equal(added[0].parts,0);
    assert.equal(await evaluate(`${state}.campaign.materials.id`),4);
    await reloadCampaign();await settle('retain linked project across refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="workshop").length'),1);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),4);
    assert.equal(await evaluate(pending),null);
  });

  await t.test('供水施工备料稳定浏览器：停产期间保留原生产者与工坊，完工后继续实际建设',async()=>{
    await setupShelter(workshopPowerChainScene()+`Object.assign(sm.view.state.rooms.find(r=>r.id===3),{level:2,upgradeAt:clock+3600000});sm.view.progress.score-=3;`);
    await settle('water construction retains original material shift');
    assert.equal(await evaluate('sm.calls.filter(c=>["assign","build","upgrade","dig"].includes(c.type)).length'),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),4);
    assert.equal(await evaluate(`${state}.campaign.materials.id`),4);
    await reloadCampaign();await settle('water construction material shift across refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),0);
    // 用公开完工状态恢复供水，随后仍须通过原生窗口和费用核对开工。
    await evaluate(`Object.assign(sm.view.state.rooms.find(r=>r.id===3),{level:3,upgradeAt:null});sm.view.progress.score+=3;${panel}.getElementById('shelter-check').click();`);
    await settle('resume linked construction after water completion');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="workshop").length'),1,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(pending),null);
  });

  await t.test('原工程额度供电等待浏览器：等待额度不为备选补电，跨刷新保留目标，恢复后原生升级只扣一次费',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-funded-power-wait.fixture.json')+`
      const budget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));budget.budgetMode='daily';
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(budget));`);
    await settle('funded material project awaits rolling budget');
    assert.equal(await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type)).length'),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===1).length'),0);
    assert.equal(await evaluate(`${state}.campaign.materials.id`),4);
    const waitingMoves=await evaluate('sm.calls.filter(c=>c.type==="assign").length');
    await reloadCampaign();await settle('same budget wait after refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),waitingMoves,'普通优化已收敛，刷新不重新往返');
    await evaluate(`clock+=86400001;sm.view.state.lastSettledAt=clock;${panel}.getElementById('shelter-check').click();`);
    try{await drive('sm.calls.some(c=>c.type==="upgrade"&&c.roomId===4)','resume original upgrade after rolling budget',600);}
    catch(e){throw Error(e.message+' '+JSON.stringify(await diagnose()));}
    await settle('confirm original funded upgrade');
    const entries=await evaluate(`${state}.constructionLedger`);
    assert.equal(entries.filter(r=>r.scrap===1440&&r.parts===45).length,1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build").length'),0);
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('confirmed original upgrade survives refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===4).length'),1);
  });

  await t.test('原工程库存供电浏览器：默认库存模式不受旧日账本阻塞，补电后原升级只付款一次',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-funded-power-wait.fixture.json'));
    const before=await evaluate(`${state}.constructionLedger.map(r=>r.id)`),resources=await evaluate('sm.view.state.resources');
    await settle('stock budget starts original funded upgrade');
    const calls=await evaluate('sm.calls'),index=calls.findIndex(c=>c.type==='upgrade'&&c.roomId===4);
    assert.ok(index>=0,JSON.stringify(await diagnose()));
    assert.equal(calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length,1);
    assert.equal(calls.slice(0,index).filter(c=>c.type==='assign'&&c.roomId===1).length,1);
    const added=(await evaluate(`${state}.constructionLedger`)).filter(r=>!before.includes(r.id));
    assert.deepEqual(added.map(r=>[r.scrap,r.parts]),[[1440,45]]);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),resources.scrap-1440);
    assert.equal(await evaluate('sm.view.state.resources.parts'),resources.parts-45);
    await reloadCampaign();await settle('stock funded upgrade survives refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===4).length'),1);
    assert.equal(await evaluate(pending),null);
  });

  await t.test('未完成等级投资浏览器：无完整路线不为仓库补电或付款，刷新保持生产稳定',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-funded-producer.fixture.json'));
    const resources=await evaluate('sm.view.state.resources'),posts=await evaluate('sm.view.state.residents.map(p=>[p.id,p.roomId])');
    await settle('incomplete storage route preserves production');
    assert.equal(await evaluate('sm.calls.length'),0,JSON.stringify(await diagnose()));
    assert.match(await evaluate(`${state}.development`),/未找到完整达级路线/);
    assert.equal(await evaluate(`${state}.campaign.materials??null`),null);
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('incomplete storage route remains stable after refresh');
    assert.equal(await evaluate('sm.calls.length'),0);
    assert.deepEqual(await evaluate('sm.view.state.residents.map(p=>[p.id,p.roomId])'),posts);
    assert.deepEqual(await evaluate('sm.view.state.resources'),resources);
  });

  await t.test('发电升级备料稳定浏览器：缺件时补电一次并保留生产者，材料齐备后实际升级',async()=>{
    // 本例单独核验缺件等待；防守快照的赛季奖励视为已领，避免奖励补齐材料提前开工。
    await setupShelter(workshopPowerChainScene('arkengine-shelter-power-material-producer.fixture.json')+
      `sm.view.state.season.claimedFree=Array.from({length:30},(_,i)=>i+1);`);
    await settle('power upgrade retains its last producer while gathering parts');
    assert.equal(await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type)).length'),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===1026).length'),1);
    const producer=await evaluate('sm.calls.find(c=>c.type==="assign"&&c.roomId===1026).residentId');
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${producer}).roomId`),1026);
    assert.ok(await evaluate(`${state}.campaign.roles.some(r=>r.role==='workshop'&&sm.view.state.residents.some(p=>p.id===r.id&&p.roomId===r.room))`),
      '发电补员后仍有真实工坊生产者供料，不固定旧版人选');
    assert.equal(await evaluate(`${state}.campaign.materials.id`),1026);
    const moves=await evaluate('sm.calls.filter(c=>c.type==="assign").length');
    await reloadCampaign();await settle('power material production survives refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),moves,
      '刷新不撤工坊或重复补电 '+JSON.stringify({diagnostic:await diagnose(),calls:await evaluate('sm.calls')}));
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${producer}).roomId`),1026);
    const before=await evaluate(`${state}.constructionLedger.map(r=>r.id)`);
    await evaluate(`sm.view.state.resources.parts=15;${panel}.getElementById('shelter-check').click();`);
    await settle('start confirmed power upgrade after parts arrive');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===1026).length'),1,JSON.stringify(await diagnose()));
    const calls=await evaluate('sm.calls'),upgrade=calls.findIndex(c=>c.type==='upgrade'&&c.roomId===1026);
    assert.deepEqual(calls.slice(0,upgrade).filter(c=>c.type==='assign'&&c.residentId===producer).map(c=>c.roomId),[1026],
      '原发电生产者到岗后保留到实际开工，不在备料期间撤回');
    assert.notEqual(await evaluate(`${state}.campaign.materials?.id??null`),1026);
    const added=(await evaluate(`${state}.constructionLedger`)).filter(r=>!before.includes(r.id));
    assert.equal(added.length,1);assert.equal(added[0].scrap,600);assert.equal(added[0].parts,15);
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('confirmed power upgrade does not repeat');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===1026).length'),1);
  });

  await t.test('换位备料接续浏览器：先完成已有换位，六人工坊不撤补，刷新后材料齐备才升级',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-swap-material.fixture.json'));
    const workers=await evaluate('sm.view.state.residents.filter(p=>[50,1010,1012].includes(p.roomId)).map(p=>({id:p.id,room:p.roomId}))');
    // 满员优化可能需要多轮；等已确认的换位全部完成，不把单轮动作上限视为收敛。
    for(let round=0;round<4;round++){
      await settle('finish production swaps while retaining material workers');
      if(await evaluate(`${state}.swap===null`))break;
      await evaluate(`${panel}.getElementById('shelter-check').click();`);
    }
    assert.equal(await evaluate(`${state}.swap`),null,JSON.stringify(await diagnose()));
    let calls=await evaluate('sm.calls');
    assert.ok(calls.some(c=>c.type==='assign'),'实际完成原换位');
    assert.ok(calls.every(c=>c.type!=='assign'||!workers.some(p=>p.id===c.residentId)),'工坊原六人均无撤补');
    assert.equal(calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length,0);
    assert.equal(await evaluate(`${state}.campaign.materials.id`),1006);
    await reloadCampaign();await settle('retained material workers survive refresh');
    calls=await evaluate('sm.calls');assert.ok(calls.every(c=>c.type!=='assign'||!workers.some(p=>p.id===c.residentId)));
    const before=await evaluate(`${state}.constructionLedger.map(r=>r.id)`);
    assert.equal(await evaluate(`${state}.constructionLedger.filter(r=>clock-r.at<86400000).reduce((n,r)=>n+r.parts,0)`),90);
    // 原快照还需等待最早15件支出满24小时；材料到齐并不授权突破100件滚动预算。
    await evaluate(`sm.view.state.resources.parts=15;
      clock=Math.max(clock,Math.min(...${state}.constructionLedger.filter(r=>clock-r.at<86400000).map(r=>r.at))+86400001);
      sm.view.state.lastSettledAt=clock;${panel}.getElementById('shelter-check').click();`);
    try{await drive('sm.calls.some(c=>c.type==="upgrade"&&c.roomId===1006)','original dormitory after material and budget recovery',600);}
    catch(e){throw Error(e.message+' '+JSON.stringify(await diagnose()));}
    await settle('confirmed dormitory starts after swap completion and material arrival');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===1006).length'),1,JSON.stringify(await diagnose()));
    const added=(await evaluate(`${state}.constructionLedger`)).filter(r=>!before.includes(r.id));
    assert.equal(added.length,1);assert.equal(added[0].scrap,720);assert.equal(added[0].parts,15);
    assert.equal(await evaluate(pending),null);
  });

  await t.test('生产升级工坊交接浏览器：十人工坊先保留，餐厅实际开工后接续下一项备料',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-production-handoff.fixture.json'));
    const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').map(r=>r.id)`);
    const before=await evaluate(`${state}.constructionLedger.map(r=>r.id)`);
    assert.equal(workers.length,10);
    await settle('funded diner upgrade before ten workshop releases');
    const calls=await evaluate('sm.calls'),index=calls.findIndex(c=>c.type==='upgrade'&&c.roomId===2);
    assert.ok(index>=0,JSON.stringify(await diagnose()));
    assert.ok(calls.slice(0,index).every(c=>c.type!=='assign'||!workers.includes(c.residentId)),'十人不在本项开工前被调走');
    const added=(await evaluate(`${state}.constructionLedger`)).filter(r=>!before.includes(r.id));
    assert.equal(added.length,1);assert.equal(added[0].scrap,1200);assert.equal(added[0].parts,30);
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('next material project after diner starts');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===2).length'),1);
    assert.ok(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length>0`),'仍有实际备料需求时继续值班');
  });

  await t.test('生产升级交接浏览器：窗口打开后食物储备不足，撤销餐厅升级不消费',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-production-handoff.fixture.json'));
    await drive('!!document.querySelector("[data-construction-dialog]")','production handoff upgrade window');
    const before=await evaluate(`${state}.constructionLedger.map(r=>r.id)`);
    await evaluate(`sm.view.state.resources.food=30;`);
    await settle('insufficient outage stock cancels diner upgrade');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===2).length'),0,JSON.stringify(await diagnose()));
    assert.equal((await evaluate(`${state}.constructionLedger`)).filter(r=>!before.includes(r.id)).length,0);
    assert.equal(await evaluate(pending),null);
  });

  await t.test('生产升级交接浏览器：餐厅开工回执未知时不撤十人工坊，刷新只核对原单',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-production-handoff.fixture.json'));
    const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').map(r=>({id:r.id,room:r.room}))`);
    await drive('!!document.querySelector("[data-construction-dialog]")','production handoff before unknown response');
    await evaluate("sm.mode='unknown';");await drive('sm.calls.some(c=>c.type==="upgrade"&&c.roomId===2)','submit original diner upgrade');
    const saved=await evaluate(pending),count=await evaluate('sm.calls.length');
    assert.equal(saved.kind,'upgrade');assert.deepEqual(saved.targets,[2]);
    await reloadCampaign();await settle('unknown production handoff retained across reload');
    assert.equal(await evaluate(`${pending}.id`),saved.id);assert.equal(await evaluate('sm.calls.length'),count);
    for(const person of workers)assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${person.id}).roomId`),person.room);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===2).length'),1);
  });

  await t.test('施工期间工坊复岗浏览器：餐厅停产储备覆盖首批时十人直接回收，刷新无重复',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-outage-return.fixture.json')+`
      const budget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));budget.budgetMode='daily';
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(budget));`);
    const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').map(r=>r.id)`);
    const original=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').map(r=>({id:r.id,room:r.room}))`);
    // 统计从原工坊离开的真实请求；之后回收房之间的正常增产调岗不是重复释放。
    const returns=`(sm.assignmentOrigins||[]).filter(c=>${JSON.stringify(original)}.some(r=>r.id===c.residentId&&r.room===c.from))`;
    assert.equal(workers.length,10);
    for(let round=0;round<4;round++){
      await settle('direct material return during funded food outage');
      if(await evaluate(`${state}.campaign.roles.every(r=>!${JSON.stringify(workers)}.includes(r.id))`))break;
      await evaluate(`${panel}.getElementById('shelter-check').click();`);
    }
    const moves=await evaluate(returns);
    assert.equal(moves.length,10,JSON.stringify(await diagnose()));assert.equal(new Set(moves.map(c=>c.residentId)).size,10);
    assert.ok(moves.every(c=>c.roomId!==null),'施工已被库存覆盖，不经休息中转');
    assert.ok(await evaluate(`sm.view.state.residents.filter(p=>${JSON.stringify(workers)}.includes(p.id)).every(p=>sm.view.state.rooms.some(r=>r.id===p.roomId&&r.type==='scrap'))`));
    assert.equal(await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type)).length'),0,'原工程额度仍不足，不提前开工');
    assert.ok(await evaluate('sm.view.state.rooms.find(r=>r.type==="diner").upgradeAt>clock'));
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('direct outage return remains stable after reload');
    assert.equal(await evaluate(`${returns}.length`),10);
    assert.ok(await evaluate(`sm.calls.every(c=>c.type!=='assign'||!${JSON.stringify(original)}.some(r=>r.id===c.residentId&&r.room===c.roomId))`),
      '结束备料后没有重新派回原工坊');
  });

  await t.test('施工期间工坊复岗浏览器：打开居民窗口后停产库存不足，取消直接回收',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-outage-return.fixture.json')+'sm.quickAssign=false;');
    const original=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').map(r=>({id:r.id,room:r.room}))`);
    await drive('!!document.querySelector("[role=dialog] select")','outage direct return resident window');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),0,'change stock before any workshop return is sent');
    await evaluate('sm.view.state.resources.food=100;');
    await settle('outage stock change cancels direct production return');
    const moves=await evaluate(`(sm.assignmentOrigins||[]).filter(c=>${JSON.stringify(original)}.some(r=>r.id===c.residentId))`);
    assert.ok(moves.every(c=>!original.some(r=>r.id===c.residentId&&r.room===c.from)||c.roomId===null),
      'insufficient stock cancels every direct workshop-to-production handoff '+JSON.stringify(moves));
    for(const move of moves.filter(c=>c.roomId!==null)){
      assert.equal(move.from,null,'ordinary employment must start after confirmed release');
      assert.ok(moves.slice(0,moves.indexOf(move)).some(c=>c.residentId===move.residentId&&c.roomId===null));
    }
    assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>e.type==='shelter-execution-deferred')`),
      JSON.stringify(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>/cancel|defer|execution/.test(e.type))`)));
    assert.equal(await evaluate(pending),null);
  });

  await t.test('施工期间库存预算浏览器：结束备料后按现有库存升级净水，不重复扣除历史支出',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-outage-return.fixture.json')+`
      const budget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));budget.budgetMode='stock';
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(budget));`);
    const before=await evaluate(`({resources:sm.view.state.resources,ledger:${state}.constructionLedger.map(r=>r.id)})`);
    for(let round=0;round<4;round++){
      await settle('current stock funds the water upgrade during food recovery');
      if(await evaluate('sm.calls.some(c=>c.type==="upgrade"&&c.roomId===3)'))break;
      await evaluate(`${panel}.getElementById('shelter-check').click();`);
    }
    assert.deepEqual(await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type)).map(c=>[c.type,c.roomId])'),[['upgrade',3]]);
    const added=(await evaluate(`${state}.constructionLedger`)).filter(r=>!before.ledger.includes(r.id));
    assert.equal(added.length,1);assert.equal(added[0].scrap,1200);assert.equal(added[0].parts,30);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),before.resources.scrap-1200);
    assert.equal(await evaluate('sm.view.state.resources.parts'),before.resources.parts-30);
    assert.ok(await evaluate('sm.view.state.rooms.find(r=>r.id===2).upgradeAt>clock'),'existing food recovery is still pending');
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('funded water upgrade remains unique after refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===3).length'),1);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),before.resources.scrap-1200);
  });

  await t.test('工坊供电复岗浏览器：一人直接补电，其他工坊不经休息撤补，重评后实际升级',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-power-return.fixture.json'));
    const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').map(r=>r.id)`);
    const before=await evaluate(`${state}.constructionLedger.map(r=>r.id)`);
    assert.equal(workers.length,10);
    for(let round=0;round<4;round++){
      await settle('direct workshop power return followed by actual upgrade');
      if(await evaluate('sm.calls.some(c=>c.type==="upgrade"&&c.roomId===2)'))break;
      await evaluate(`${panel}.getElementById('shelter-check').click();`);
    }
    const calls=await evaluate('sm.calls'),index=calls.findIndex(c=>c.type==='upgrade'&&c.roomId===2);
    assert.ok(index>=0,JSON.stringify(await diagnose()));
    const moves=calls.slice(0,index).filter(c=>c.type==='assign'&&workers.includes(c.residentId));
    assert.equal(moves.length,1,JSON.stringify(moves));assert.equal(moves[0].roomId,1);
    assert.equal(moves[0].residentId,4);
    const added=(await evaluate(`${state}.constructionLedger`)).filter(r=>!before.includes(r.id));
    assert.equal(added.length,1);assert.equal(added[0].scrap,1200);assert.equal(added[0].parts,30);
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('power return and upgrade remain confirmed after reload');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===2).length'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===4&&c.roomId===1).length'),1);
  });

  await t.test('工坊供电复岗浏览器：打开居民窗口后发电空岗被占用，取消原直接补电',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-power-return.fixture.json')+'sm.quickAssign=false;');
    await drive('!!document.querySelector("[role=dialog] select")','direct power return resident window');
    await evaluate('sm.view.state.residents.find(p=>p.id===37).roomId=1;');
    await settle('occupied power vacancy cancels original direct assignment');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===4&&c.roomId===1).length'),0,
      JSON.stringify(await diagnose()));
  });

  await t.test('工坊供电复岗浏览器：调岗回执未知，刷新保留原单，不继续撤人或开工',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-power-return.fixture.json')+'sm.quickAssign=false;');
    await drive('!!document.querySelector("[role=dialog] select")','direct power return before unknown response');
    await evaluate("sm.mode='unknown';");
    await drive('sm.calls.some(c=>c.type==="assign"&&c.residentId===4&&c.roomId===1)','submit original power return');
    const saved=await evaluate(pending),count=await evaluate('sm.calls.length');
    assert.equal(saved.kind,'assign');assert.deepEqual(saved.targets,[4,1]);
    await reloadCampaign();await settle('unknown direct power return preserved after reload');
    assert.equal(await evaluate(`${pending}.id`),saved.id);assert.equal(await evaluate('sm.calls.length'),count);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),0);
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),10);
  });

  await t.test('工坊扩产原工程绑定浏览器：六人已在岗时建房确认记录餐厅目标，刷新后继续原升级',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-expansion-binding.fixture.json'));
    assert.equal(await evaluate(`${state}.campaign.materials`),undefined);
    const before=await evaluate(`${state}.constructionLedger.map(r=>r.id)`);
    await settle('confirmed expansion binds its original diner project');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="workshop").length'),1,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.campaign.materials.id`),2);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),0);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),0,'已有工人全留岗，也必须记录本次扩产目的');
    const added=(await evaluate(`${state}.constructionLedger`)).filter(r=>!before.includes(r.id));
    assert.equal(added.length,1);assert.equal(added[0].scrap,800);assert.equal(added[0].parts,0);
    await reloadCampaign();await settle('original diner retained during expansion construction');
    assert.equal(await evaluate(`${state}.campaign.materials.id`),2);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build").length'),1);
    await evaluate(`clock=Math.max(clock,...sm.view.state.rooms.map(r=>r.builtAt))+1;
      sm.view.state.lastSettledAt=clock;sm.view.state.resources.parts=30;`);
    await reloadCampaign();
    for(let round=0;round<4;round++){
      await settle('original diner begins after expansion and actual material stock');
      if(await evaluate('sm.calls.some(c=>c.type==="upgrade"&&c.roomId===2)'))break;
      await evaluate(`${panel}.getElementById('shelter-check').click();`);
    }
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===2).length'),1,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===1004).length'),0);
    assert.equal(await evaluate(pending),null);
  });

  await t.test('工坊扩产原工程绑定浏览器：开窗后最终等级改变，即使工坊造价相同也撤销旧目标',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-expansion-binding.fixture.json'));
    await drive('!!document.querySelector("[data-construction-dialog]")','expansion binding before level change');
    const before=await evaluate(`${state}.constructionLedger.map(r=>r.id)`);
    await evaluate(`const input=${panel}.getElementById('shelter-level-target');input.value='13';input.dispatchEvent(new Event('change',{bubbles:true}));`);
    await settle('changed final target cancels original expansion confirmation');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build").length'),0,JSON.stringify(await diagnose()));
    assert.equal((await evaluate(`${state}.constructionLedger`)).filter(r=>!before.includes(r.id)).length,0);
    assert.equal(await evaluate(`${state}.campaign.materials`),undefined);
    assert.equal(await evaluate(pending),null);
  });

  await t.test('工坊扩产原工程绑定浏览器：开工结果未知只保存原请求目标，不提前绑定或改投宿舍',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-expansion-binding.fixture.json'));
    await drive('!!document.querySelector("[data-construction-dialog]")','expansion binding build window');
    await evaluate("sm.mode='unknown';");await drive('sm.calls.some(c=>c.type==="build")','original workshop expansion submitted');
    const saved=await evaluate(pending),count=await evaluate('sm.calls.length');
    assert.equal(saved.before.construction.project.materials.id,2);
    assert.equal(await evaluate(`${state}.campaign.materials`),undefined);
    await reloadCampaign();await settle('unknown expansion binding across reload');
    assert.equal(await evaluate(`${pending}.id`),saved.id);assert.equal(await evaluate('sm.calls.length'),count);
    assert.equal(await evaluate(`${state}.campaign.materials`),undefined);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade").length'),0);
  });

  await t.test('等级投资准入浏览器：材料供电具备仍不投孤立仓库，普通生产优化收敛',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-ready-investment.fixture.json'));
    const resources=await evaluate('sm.view.state.resources');
    await settle('incomplete level route permits ordinary production optimization');
    const calls=await evaluate('sm.calls');
    assert.ok(calls.length>0&&calls.every(c=>c.type==='assign'),JSON.stringify(await diagnose()));
    assert.equal(new Set(calls.map(c=>`${c.residentId}:${c.roomId}`)).size,calls.length,'没有重复撤补同一岗位');
    assert.match(await evaluate(`${state}.development`),/未找到完整达级路线/);
    assert.equal(await evaluate(`${state}.campaign.materials??null`),null);
    await reloadCampaign();await settle('ordinary production optimization converges across refresh');
    assert.deepEqual(await evaluate('sm.calls'),calls);
    assert.deepEqual(await evaluate('sm.view.state.resources'),resources);
    assert.equal(await evaluate(pending),null);
  });

  const idleInvestmentScene=()=>workshopPowerChainScene('arkengine-shelter-ready-investment.fixture.json')+`
    sm.view.state.residents.find(p=>p.id===7).roomId=null;sm.view.state.rooms.find(r=>r.id===1009).level=1;`;
  await t.test('等级投资补岗浏览器：缺完整路线仍让闲置成人就业，后续调岗收敛且不投空仓库',async()=>{
    await setupShelter(idleInvestmentScene());await settle('idle adult before level investment');
    const calls=await evaluate('sm.calls');
    assert.ok(calls.every(c=>c.type==='assign'),JSON.stringify(await diagnose()));
    assert.equal(calls[0].residentId,7);assert.notEqual(calls[0].roomId,null,'闲置成人先进入现有岗位');
    assert.equal(calls.filter(c=>c.type==='assign'&&c.residentId===7).length,1);
    assert.ok(await evaluate('sm.view.state.rooms.some(r=>r.id===sm.view.state.residents.find(p=>p.id===7).roomId&&r.type==="scrap")'));
    await reloadCampaign();await settle('idle staffing and investment survive reload');
    assert.deepEqual(await evaluate('sm.calls'),calls);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('等级投资补岗浏览器：确认前原空岗停电或人员受伤，撤销直接补岗',async()=>{
    for(const change of ['power','health']){
      await setupShelter(idleInvestmentScene()+'sm.quickAssign=false;');
      await drive('!!document.querySelector("[role=dialog] select")','idle investment assignment window '+change);
      if(change==='power')await evaluate('for(const r of sm.view.state.rooms)if(r.type==="scrap")r.unpowered=true;');
      else await evaluate('sm.view.state.residents.find(p=>p.id===7).hp=1;');
      // All recyclers losing power also starts ordinary reassignment. Observe
      // cancellation through the real 5m visit plus finish/navigation allowance.
      await drive(done,'withdraw invalid idle assignment '+change,345);
      await chainReport('withdraw invalid idle assignment '+change);
      assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===7).length'),0,JSON.stringify(await diagnose()));
      assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===7).roomId'),null);
    }
  });
  await t.test('等级投资补岗边界浏览器：无已选工程时空回收房可就业，刷新不反复撤补或花仓库费用',async()=>{
    await setupShelter(idleInvestmentScene()+`sm.view.state.residents.find(p=>p.id===8).roomId=1014;`);
    const resources=await evaluate('sm.view.state.resources');
    await settle('empty scrap room receives first idle worker');
    const calls=await evaluate('sm.calls');
    assert.ok(calls.every(c=>c.type==='assign'),JSON.stringify(await diagnose()));
    assert.equal(calls[0].residentId,7);assert.notEqual(calls[0].roomId,null);
    assert.ok(await evaluate(`sm.view.state.rooms.some(r=>r.id===${calls[0].roomId}&&r.type==='scrap')`));
    assert.equal(await evaluate('sm.assignmentOrigins.find(c=>c.residentId===7).from'),null);
    assert.equal(calls.filter(c=>c.residentId===7).length,1);
    await reloadCampaign();await settle('first empty-room worker stays employed across refresh');
    assert.deepEqual(await evaluate('sm.calls'),calls);
    assert.deepEqual(await evaluate('sm.view.state.resources'),resources);
    assert.equal(await evaluate(pending),null);
  });
  const employmentPriorityScene=()=>workshopPowerChainScene('arkengine-shelter-employment-priority.fixture.json')+`
    const employmentBudget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
    employmentBudget.scrapReserve=100;localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(employmentBudget));`;
  await t.test('高等级供电备料浏览器：持续模式释放工坊后实际补建发电，不反复召回杨初一',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-late-power-material.fixture.json')+`
      const budget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));budget.scrapReserve=100;
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(budget));
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','auto');
      const saved=${state};saved.campaign.materials.finalTarget=14;
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(saved));`);
    const before=await evaluate(`${state}.constructionLedger.map(e=>e.id)`);
    await settle('late power prerequisite actually built');
    const calls=await evaluate('sm.calls'),builds=calls.filter(c=>c.type==='build'&&c.room==='power');
    assert.equal(builds.length,1,JSON.stringify(await diagnose()));
    assert.equal(calls.filter(c=>c.type==='assign'&&c.residentId===21&&c.roomId===4).length,1);
    assert.equal(calls.filter(c=>c.type==='assign'&&c.residentId===21&&c.roomId===50).length,0);
    const entries=(await evaluate(`${state}.constructionLedger`)).filter(e=>!before.includes(e.id));
    assert.equal(entries.length,1);assert.equal(entries[0].scrap,180);assert.equal(entries[0].parts,0);
    await reloadCampaign();await settle('power construction preserved on reload');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="power").length'),1);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('在途等级接续浏览器：已有净水升级足够升8级时先等待，不在刷新间反复增撤备料人手',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-level-wait.fixture.json')+`
      const waitBudget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
      waitBudget.scrapReserve=100;localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(waitBudget));`);
    await settle('await committed water upgrade before ordinary workshop preparation');
    const count=await evaluate('sm.calls.length');
    assert.equal(await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type)).length'),0,
      JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&[50,1010,1013].includes(c.roomId)).length'),0);
    assert.match(await evaluate(`${panel}.getElementById('shelter-development').textContent`),/等待现有工程及新生儿增加等级分/);
    await reloadCampaign();await settle('stable committed-level wait after refresh');
    assert.equal(await evaluate('sm.calls.length'),count);assert.equal(await evaluate(pending),null);
  });
  await t.test('成年就业接岗浏览器：保留100废料时补电后子女接空岗，刷新不重建补电循环',async()=>{
    await setupShelter(employmentPriorityScene());await settle('new adult fills vacancy released by power preparation');
    const moves=await evaluate('sm.calls.filter(c=>c.type==="assign")');
    assert.deepEqual(moves.slice(0,2).map(c=>[c.residentId,c.roomId]),[[1,1],[43,1004]],JSON.stringify(await diagnose()));
    assert.equal(moves.filter(c=>c.residentId===1&&c.roomId===1004).length,0);
    await reloadCampaign();await settle('employment handoff after reload');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===1&&c.roomId===1).length'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===43&&c.roomId===1004).length'),1);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1')).scrapReserve`),100);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('成年就业接岗浏览器：打开子女窗口后空岗被占满，撤销原接岗',async()=>{
    await setupShelter(employmentPriorityScene()+`sm.quickAssign=false;sm.view.state.residents.find(p=>p.id===1).roomId=1;`);
    await drive('!!document.querySelector("[role=dialog] select")','new adult assignment window');
    assert.equal(await evaluate('document.querySelector("[data-staff-dialog]").dataset.staffDialog'),'43');
    assert.equal(await evaluate('sm.calls.length'),0);
    await evaluate(`sm.view.state.residents.find(p=>p.id===1).roomId=1004;`);
    // 只验证当前窗口的撤销；以后可先补电腾出新空岗，再以新状态合法安排该子女。
    await drive('!document.querySelector("[role=dialog] select")','cancel original new adult window after vacancy fills',15);
    assert.equal(await evaluate('sm.calls.length'),0,
      JSON.stringify(await diagnose()));
  });

  await t.test('同产量复岗追级浏览器：优先补空回收房形成便宜升级候选，六步内收敛且刷新不重排',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-vacancy-level.fixture.json'));
    const before=await evaluate(`${state}.constructionLedger.map(r=>r.id)`);
    // 正式页面每批有操作数上限，第一批五步后仍需下一批完成第六步，不能把批次结束当人员规划收敛。
    for(let round=0;round<2;round++){
      await settle('equal output vacancy creates useful upgrade sooner');
      if(await evaluate('sm.calls.filter(c=>c.type==="assign").length>=6'))break;
      await evaluate(`${panel}.getElementById('shelter-check').click();`);
    }
    const calls=await evaluate('sm.calls'),moves=calls.filter(c=>c.type==='assign');
    assert.equal(moves.length,6,JSON.stringify(await diagnose()));
    assert.equal(moves[0].residentId,2);assert.equal(moves[0].roomId,1009);
    assert.ok(moves.every(c=>c.roomId!==null));
    assert.equal(await evaluate(`${state}.campaign.materials.id`),1009);
    assert.equal(calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length,0,'实际零件仍未齐，不提前开工');
    assert.equal((await evaluate(`${state}.constructionLedger`)).filter(r=>!before.includes(r.id)).length,0);
    await reloadCampaign();await settle('equal output vacancy remains stable across reload');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),moves.length);
    assert.equal(await evaluate(pending),null);
  });

  await t.test('同产量复岗追级浏览器：打开窗口后原空房停电，取消该直接调岗',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-vacancy-level.fixture.json')+'sm.quickAssign=false;');
    await drive('!!document.querySelector("[role=dialog] select")','equal output vacancy resident window');
    assert.equal(await evaluate('document.querySelector("[data-staff-dialog]").dataset.staffDialog'),'2');
    assert.equal(await evaluate('sm.calls.length'),0);
    await evaluate('sm.view.state.rooms.find(r=>r.id===1009).unpowered=true;');
    await drive('!document.querySelector("[role=dialog] select")','cancel original vacancy window after power loss',15);
    await settle('unpowered vacancy cancels original direct assignment');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===2&&c.roomId===1009).length'),0,
      JSON.stringify(await diagnose()));
  });

  await t.test('工坊新建浏览器：建房只扣一次费，完工前不撤原岗，补员后接续原工程',async()=>{
    await setupShelter(workshopBuildScene());await settle('build additional workshop');
    const room=await evaluate('sm.view.state.rooms.find(r=>r.type==="workshop"&&r.id!==50)');
    assert.ok(room,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='workshop').length`),1);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),11172-600);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign').length`),0,'施工期间不让生产者先去休息');
    assert.equal(await evaluate(`${state}.campaign.materials?.id`),1010);
    await reloadCampaign();await settle('retain original production across construction refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build').length`),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign').length`),0);
    await evaluate(`clock=${room.builtAt}+1;sm.view.state.lastSettledAt=clock;sm.view.progress.score++;`);
    await reloadCampaign();await settle('staff completed workshop');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===${room.id}).length`),2,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),4);
    await reloadCampaign();await settle('keep new material workers across refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===${room.id}).length`),2);
    await evaluate(`sm.view.state.resources.parts=30;${panel}.getElementById('shelter-check').click();`);
    // 原工程实际开工仍经过原生窗口及费用核对；齐料后不先整组撤补工坊。
    try{await drive(`sm.calls.some(c=>c.type==='upgrade'&&c.roomId===1010)`,'original material project resumes',300);}
    catch(e){throw Error(e.message+' '+JSON.stringify(await diagnose()));}
    await settle('confirm original upgrade');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===1010).length`),1);
    assert.notEqual(await evaluate(`${state}.campaign.materials?.id??null`),1010);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('工坊新建浏览器：确认前材料已齐或候选人失去健康时取消额外开工',async()=>{
    for(const change of ['materials','workers']){
      await setupShelter(workshopBuildScene());await drive(`!!document.querySelector('[data-construction-dialog]')`,'new workshop comparison dialog');
      await evaluate(change==='materials'?'sm.view.state.resources.parts=30;':
        'for(const p of sm.view.state.residents)if(![10,35].includes(p.id))p.hp=50;');
      await settle('recheck new workshop '+change);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='workshop').length`),0,JSON.stringify(await diagnose()));
      assert.ok(await evaluate('sm.view.state.resources.scrap>=11172-960'),'原工程可开工，额外建房费不得扣除');
    }
  });
  const multiWorkshopScene=()=>workshopUpgradeScene(multiWorkshopView(),true)+`
    const mc=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));mc.scrapLimit=1000;
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(mc));`;
  await t.test('多工坊浏览器：补已建第二房，刷新保留四名工人，齐料后接续原工程',async()=>{
    // A 1000-scrap budget isolates staffing from the separately covered 1250-scrap workshop upgrade.
    await setupShelter(multiWorkshopScene());await settle('staff second existing workshop');
    const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop')`);
    assert.equal(workers.length,4,JSON.stringify(await diagnose()));assert.equal(workers.filter(r=>r.room===3000).length,2);
    assert.equal(await evaluate(`${state}.campaign.materials?.id`),1010);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===3000).length`),2);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build').length`),0,'只使用现有房间');
    await reloadCampaign();await settle('retain two workshops across refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===3000).length`),2);
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),4);
    const fundedAt=await evaluate('sm.calls.length');
    await evaluate(`sm.view.state.resources.parts=30;${panel}.getElementById('shelter-check').click();`);
    await settle('collect sufficient materials and fund original upgrade');
    try{await drive(`sm.calls.some(c=>c.type==='upgrade'&&c.roomId===1010)`,
      'next scheduled round completes remaining staffing and starts original upgrade',180);
    }catch(e){throw Error(e.message+' '+JSON.stringify(await diagnose()));}
    await settle('confirm original upgrade after the per-round action limit');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===1010).length`),1,JSON.stringify(await diagnose()));
    const calls=await evaluate('sm.calls'),upgradeAt=calls.findIndex(c=>c.type==='upgrade'&&c.roomId===1010);
    assert.ok(calls.slice(fundedAt,upgradeAt).every(c=>c.type!=='assign'||!workers.some(w=>w.id===c.residentId)),
      '原工程已可开工时不先撤补四人工坊');
    assert.notEqual(await evaluate(`${state}.campaign.materials?.id??null`),1010,'开工后不能残留原材料工程归属');
    assert.equal(await evaluate(pending),null);
    // 后续需求也已备齐且建设额度不足时，仍必须实际释放原工人，不能永久锁住岗位。
    await evaluate(`sm.view.state.resources.parts=100;const no=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
      no.partsLimit=29;localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(no));
      ${panel}.getElementById('shelter-check').click();`);
    await settle('release material workers when no further funded project needs them');
    for(const worker of workers)assert.notEqual(await evaluate(`sm.view.state.residents.find(p=>p.id===${worker.id}).roomId`),worker.room);
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>!${JSON.stringify(workers.map(w=>w.id))}.includes(r.id))`));
  });
  await t.test('多工坊浏览器：第二房供料差一废料时保留原工坊，补齐后才调入新人',async()=>{
    await setupShelter(multiWorkshopScene()+`sm.view.state.resources.scrap=960+6*(31.5-1.1112)+180-1;`);
    await settle('retain existing workshop when additional feed is unavailable');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===3000).length`),0,JSON.stringify(await diagnose()));
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[10,35].includes(p.id)).every(p=>p.roomId===50)'));
    await evaluate(`sm.view.state.resources.scrap+=1;${panel}.getElementById('shelter-check').click();`);
    await settle('additional full-batch feed permits second workshop');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===3000).length`),2,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),4,JSON.stringify(await diagnose()));
  });
  await t.test('工坊扩产浏览器：先升工坊，施工和刷新保留原备料，完工收齐后接续原工程',async()=>{
    await setupShelter(workshopUpgradeScene());await settle('upgrade workshop for current material project');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===50).length`),1,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.resources.scrap'),11172-1250);
    assert.equal(await evaluate(`${state}.campaign.materials?.id`),1010,'前置工程不清除原项目');
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[10,35].includes(p.id)).every(p=>p.roomId===50)'));
    await reloadCampaign();await settle('keep workshop workers during construction');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===50).length`),1);
    await evaluate(`const w=sm.view.state.rooms.find(r=>r.id===50);clock=w.upgradeAt+1;w.upgradeAt=null;w.level=2;
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;sm.view.progress.score++;`);
    await reloadCampaign();await settle('workshop completes and keeps original need');
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[10,35].includes(p.id)).every(p=>p.roomId===50)'),JSON.stringify(await diagnose()));
    await evaluate(`sm.view.state.resources.parts=31;${panel}.getElementById('shelter-check').click();`);
    await settle('confirmed materials fund original project');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===1010).length`),1,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.campaign.materials??null`),null);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===50).length`),1);
  });
  await t.test('工坊扩产浏览器：确认前原材料已齐备则取消额外升级，直接推进原工程',async()=>{
    await setupShelter(workshopUpgradeScene());await drive(`!!document.querySelector('[data-construction-dialog]')`,'workshop upgrade comparison dialog');
    await evaluate('sm.view.state.resources.parts=31;');await settle('cancel unneeded workshop upgrade');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===50).length`),0,JSON.stringify(await diagnose()));
    assert.ok(await evaluate('sm.view.state.resources.scrap>=11172-960'),'只允许原工程支出，不支付已无必要的1250');
  });
  await t.test('工坊扩产阶段浏览器：仍有孩子未成年时保留人口发展预算，不提前升级工坊',async()=>{
    await setupShelter(workshopUpgradeScene()+`localStorage.setItem('arkengine:auto-shelter:staff:v1','population');
      const child=sm.view.state.residents.find(p=>p.id===49);child.parents=[2,10];child.roomId=1000;child.adultAt=clock+3600000;`);
    await settle('population phase before workshop efficiency');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===50).length`),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.rooms.find(r=>r.id===50).level'),1);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===49).roomId'),1000);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),11172,'本场原工程仍缺件，不为工坊额外花1250');
  });
  const fullPowerScene=()=>scene({},`sm.view=${JSON.stringify(fullPowerPrerequisiteView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
    const ps=sm.view.state;ps.depth=9;ps.rooms.push({...ps.rooms.find(r=>r.type==='elevator'),id:2009,floor:9},
      {...ps.rooms.find(r=>r.type==='storage'),id:3000,floor:9,col:2,width:2,level:1});
    sm.view.progress={level:9,score:201,next:213};${construction}
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');localStorage.setItem('arkengine:auto-shelter:population:v1','30');
    localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');`);
  await t.test('满岗供电浏览器：先建发电房，刷新不重复，完工后由回收工补员并继续建设',async()=>{
    await setupShelter(fullPowerScene());await settle('build power prerequisite with real donor');
    const power=await evaluate(`sm.view.state.rooms.find(r=>r.type==='power'&&r.id!==1)`);
    assert.ok(power,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='power').length`),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===${power.id}).length`),0,'施工期不提前占岗');
    await reloadCampaign();await settle('do not rebuild pending power');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='power').length`),1);
    await evaluate(`clock=${power.builtAt}+1;sm.view.state.lastSettledAt=clock;`);
    await reloadCampaign();await settle('complete power then resume construction');
    // A completed background comparison may replace the unsent construction target.
    // Check its one-minute retry as well; never accept repeated cancellations as progress.
    if(await evaluate(`${state}.constructionNote==='建设目标或费用已变化，本轮撤销后重新规划'`)){
      assert.equal(await evaluate(pending),null);
      await pulse(61000);await reloadCampaign();await settle('one bounded replan after power staffing');
    }
    const calls=await evaluate(`sm.calls.filter(c=>['build','upgrade','assign'].includes(c.type))`),
      staffed=calls.findIndex(c=>c.type==='assign'&&c.roomId===power.id);
    assert.ok(staffed>0,JSON.stringify(calls));
    assert.ok(calls.slice(staffed+1).some(c=>c.type==='build'&&c.room==='storage'||c.type==='upgrade'),JSON.stringify({calls,diagnostic:await diagnose()}));
    const resident=calls[staffed].residentId;
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${resident}).roomId`),power.id);
    await reloadCampaign();await settle('keep power staff after refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='power').length`),1);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${resident}).roomId`),power.id);
  });
  await t.test('满岗供电浏览器：建造确认前接替人手受伤则取消，不消费或预调岗',async()=>{
    await setupShelter(fullPowerScene());await drive(`!!document.querySelector('[data-construction-dialog]')`,'power expansion confirmation');
    await evaluate(`for(const p of sm.view.state.residents)if(sm.view.state.rooms.find(r=>r.id===p.roomId)?.type==='scrap')p.hp=1;`);
    await settle('recheck donors before power spending');
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','dig','upgrade','assign'].includes(c.type)).length`),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.resources.scrap'),78857);assert.equal(await evaluate(pending),null);
  });
  await t.test('扩层供电准备浏览器：先补员再下挖，刷新不重挖，确认新楼层后才建目标房',async()=>{
    const cost=Math.ceil(120*8**1.4);
    for(const limit of [cost-1,10000]){
      await setupShelter(scene({},`sm.view=${JSON.stringify(digPowerPrerequisiteView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
        ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
        const budget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
        budget.scrapLimit=${limit};localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(budget));`));
      await settle('prepare power before digging budget '+limit);
      const calls=await evaluate(`sm.calls.filter(c=>['assign','upgrade','build','dig'].includes(c.type))`);
      if(limit===cost-1){
        assert.equal(calls.filter(c=>c.type!=='assign').length,0,'insufficient budget cannot fund construction');
        assert.equal(calls.filter(c=>c.type==='assign'&&c.roomId===1).length,0,'no worker reserved to power unaffordable digging');
        assert.equal(await evaluate('sm.view.state.resources.scrap'),88000);
        assert.equal(await evaluate(`${state}.constructionLedger?.length||0`),0);
        continue;
      }
      const at=calls.findIndex(c=>c.type==='dig');assert.ok(at>0,JSON.stringify(calls));
      assert.ok(calls.slice(0,at).some(c=>c.type==='assign'&&c.roomId===1));
      assert.equal(calls.filter(c=>c.type==='dig').length,1);assert.equal(calls.filter(c=>c.type==='build').length,0);
      assert.equal(await evaluate('sm.view.state.depth'),7);assert.equal(await evaluate('sm.view.state.digging.floor'),8);
      await reloadCampaign();await settle('do not replay pending excavation');
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='dig').length`),1);
      // 只提供已确认完工后的快照，不借用模拟页面的一小时占位值来证明真实下挖工期。
      await evaluate(`const s=sm.view.state;s.depth=8;s.digging=null;s.rooms.push({...s.rooms.find(r=>r.type==='elevator'),id:1108,floor:8});
        sm.view.progress={level:8,score:173,next:174};${panel}.getElementById('shelter-check').click();`);
      await settle('new floor permits intended storage');
      const builds=await evaluate(`sm.calls.filter(c=>c.type==='build')`);assert.equal(builds.length,1);
      assert.equal(builds[0].room,'storage');assert.equal(builds[0].floor,8);
      assert.equal(await evaluate('sm.view.state.resources.scrap'),88000-cost-480);
      await reloadCampaign();await settle('new storage is not repeated after refresh');
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='dig').length`),1);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='storage').length`),1);
      const projects=await evaluate(`sm.calls.filter(c=>c.type==='build')`);
      assert.equal(new Set(projects.map(c=>[c.room,c.floor,c.col].join(':'))).size,projects.length,
        'a distinct funded production project is not a repeat of the original storage');
    }
  });
  for(const jobsReady of [false,true])await t.test(jobsReady?
    '补电投资浏览器：已有子女岗位后真实补员并重评生产升级，刷新不重复付款或抽回发电工':
    '补电投资缺岗浏览器：先为已有儿童建设岗位，不越过就业直接追级升级',async()=>{
    const f=powerInvestmentScene();
    if(jobsReady){
      f.view.state.rooms.push({...f.view.state.rooms.find(r=>r.type==='scrap'),id:9000,floor:10,col:2,width:2,level:1,stored:0});
      f.view.state.residents.find(p=>p.roomId===5&&p.stats.str<10).stats.str++;
      f.view.progress.score+=2;
    }
    await setupShelter(scene(f.campaign,`sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;
      sm.ui20261109=true;sm.fixtureSearch=location.search;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:population:v1','50');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','false');
      localStorage.setItem('arkengine:auto-shelter:gear:v1','false');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${JSON.stringify(f.state)},nextAt:0,note:'补电投资对照场景',vaultNo:sm.view.vaultNo}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));`));
    if(!jobsReady){
      await settle('existing children need jobs before power investment');
      assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).map(c=>[c.type,c.room,c.floor,c.col])`),
        [['build','scrap',9,6]]);
      assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
      assert.equal(await evaluate(`${state}.constructionLedger[0].scrap`),240);
      assert.equal(await evaluate(pending),null);return;
    }
    await drive(`sm.calls.some(c=>c.type==='upgrade')`,'power staffing unlocks productive upgrade',350);
    const calls=await evaluate(`sm.calls.filter(c=>['assign','upgrade','dig','build'].includes(c.type))`);
    const power=calls.findIndex(c=>c.type==='assign'&&c.roomId===5);
    const upgrade=calls.findIndex(c=>c.type==='upgrade');
    assert.ok(power>=0&&upgrade>power,JSON.stringify(calls));
    await chainReport('power investment after actual staffing');
    const donor=calls[power].residentId,roomId=calls[upgrade].roomId;
    const originalRoom=f.view.state.rooms.find(r=>r.id===roomId);
    assert.equal(donor,41);assert.equal(originalRoom.type,'scrap');assert.equal(originalRoom.level,2);
    assert.ok(f.view.state.residents.some(p=>p.roomId===roomId),'upgrade expands an actually staffed production room');
    const price={scrap:80*originalRoom.width*6,parts:15*originalRoom.width};
    assert.ok(!calls.some(c=>c.type==='dig'),'不能先为远期探险位花4353废料');
    await drive(`!${pending}&&${state}.constructionLedger?.some(e=>e.scrap===${price.scrap}&&e.parts===${price.parts})`,
      'upgrade receipt confirms actual cost');
    assert.equal(await evaluate('sm.view.state.resources.scrap'),f.view.state.resources.scrap-price.scrap);
    assert.equal(await evaluate('sm.view.state.resources.parts'),f.view.state.resources.parts-price.parts);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===${roomId}).length`),1);
    await reloadCampaign();await settle('power investment receipt survives refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===${roomId}).length`),1);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${donor}).roomId`),5);
  });
  await t.test('工程供电准备浏览器：有预算时先调岗再开工，预算不足不占人，刷新不重复工程',async()=>{
    for(const limit of [479,480]){
      await setupShelter(scene({},`sm.view=${JSON.stringify(powerPrerequisiteView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
        // 与纯规划用例一样隔离供电工人；医务室保留伤员值班，宿舍成人本轮不可调。
        for(const p of sm.view.state.residents)if(sm.view.state.rooms.some(r=>r.id===p.roomId&&['quarters','medbay'].includes(r.type)))p.hp=1;
        ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
        const budget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
        budget.scrapLimit=${limit};localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(budget));`));
      await settle('prepare construction power with budget '+limit);
      const calls=await evaluate(`sm.calls.filter(c=>['assign','upgrade','build','dig'].includes(c.type))`);
      if(limit===479){assert.deepEqual(calls,[]);continue;}
      assert.equal(calls.filter(c=>c.type!=='assign').length,1,JSON.stringify(calls));
      assert.equal(calls[0].type,'assign');assert.equal(calls[0].roomId,1);
      assert.equal(calls[1].type,'upgrade');assert.equal(calls[1].roomId,1001);
      assert.ok(calls.slice(2).every(c=>c.type==='assign'&&c.roomId===1000),'后续只允许已有工坊的正常备料');
      assert.equal(await evaluate(`${state}.constructionLedger[0].scrap`),480);
      assert.match(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events
        .filter(e=>e.type==='shelter-submitted'&&e.data?.kind==='assign').map(e=>JSON.stringify(e)).join(' ')`),/近期工程/);
      await reloadCampaign();await settle('preserve committed power after refresh');
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===1001).length`),1);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===1).length`),1);
      assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${calls[0].residentId}).roomId`),1);
    }
  });
  await t.test('路线容量浏览器：默认停建与零额度不生成可兑现路线，刷新不改变库存容量或等级',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(capacityRouteView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','off');`));
    const verify=async()=>{
      const text=await evaluate(`${panel}.getElementById('shelter-development').textContent`);
      assert.match(text,/建设额度不足.*没有可核对的恢复时间/);
      assert.equal(text.split('\n').filter(line=>line.startsWith('路线估算：')).length,0);
      assert.equal(await evaluate('sm.view.state.resources.scrap'),3500);assert.equal(await evaluate('sm.view.progress.level'),6);
      assert.equal(await evaluate('sm.view.state.rooms.find(r=>r.id===90).level'),1);
      assert.equal(await evaluate(`${state}.developmentTrace.active.latest.score`),108);
      assert.equal(await evaluate(`${state}.developmentTrace.active.latest.route`),null);
      assert.ok(!await evaluate(`sm.calls.some(c=>['build','upgrade','dig'].includes(c.type))`));
    };
    await settle('future storage capacity explanation');await verify();
    await reloadCampaign();await settle('future capacity remains only a forecast after reload');await verify();
  });
  await t.test('路线容量浏览器：已授权仓库开工仍用旧容量，实际完工合并后才更新，刷新不重复建设',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(capacityRouteView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','off');`));
    await settle('funded storage starts without predicted capacity');
    const calls=await evaluate('sm.calls'),build=calls.find(c=>c.type==='build'&&c.room==='storage');
    assert.ok(build,JSON.stringify(await diagnose()));assert.equal(calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length,1);
    const room=await evaluate(`sm.view.state.rooms.find(r=>r.type==='storage'&&r.id!==90)`);
    assert.ok(room);assert.equal(room.floor,4);assert.equal(room.col,3);
    const verifyPending=async committed=>{
      const decision=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-decision').at(-1).data`);
      assert.equal(decision.caps.scrap,3600);assert.equal(decision.levelProgress.score,108);assert.equal(decision.levelProgress.committed,committed);
      assert.equal(await evaluate('sm.view.progress.level'),6);
      assert.equal(await evaluate('sm.view.state.rooms.find(r=>r.id===90).width'),1);
      assert.equal(await evaluate(`${state}.developmentTrace.active.latest.score`),108);
      assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="storage").length'),1);
      assert.equal(await evaluate(`${state}.constructionLedger.filter(r=>r.scrap===96&&r.parts===0).length`),1);
    };
    assert.match(await evaluate(`${state}.development`),/本项完工后才计入新增容量/);
    assert.match(await evaluate(`${state}.development`),/实际合并结果重算费用和工期/);
    await verifyPending(109);await reloadCampaign();await settle('inflight storage remains old capacity after refresh');
    // The refreshed plan may fund a separate productive recycler upgrade. Its
    // one committed point is still not an actual point or completed capacity.
    await verifyPending(110);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===4).length'),1);
    // Supply only the observed completion/merge; no forecast income or level-up.
    await evaluate(`clock=${room.builtAt}+1;sm.view.state.lastSettledAt=clock;
      sm.view.state.rooms=sm.view.state.rooms.filter(r=>r.id!==${room.id});sm.view.state.rooms.find(r=>r.id===90).width=2;
      sm.view.progress.score=109;${panel}.getElementById('shelter-check').click();`);
    await settle('observed storage merge updates actual capacity');
    const decision=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-decision').at(-1).data`);
    assert.equal(decision.caps.scrap,4800);assert.equal(decision.levelProgress.score,109);
    assert.equal(decision.levelProgress.committed,110);
    assert.equal(await evaluate('sm.view.progress.level'),6);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="storage").length'),1);
    assert.equal(await evaluate(`${state}.developmentTrace.history.length`),0,'扩仓完工只增加一分，还没有达到7级');
    assert.equal(await evaluate(pending),null);
  });
  await t.test('管家攒料浏览器：预测代收不提前开工，刷新保留说明，实际到账后仅升级一次',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(handyMaterialView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','off');`));
    await settle('robot material forecast without spending');
    const text=()=>evaluate(`${panel}.getElementById('shelter-development').textContent`);
    assert.match(await text(),/已有管家.*整数空间/);assert.match(await text(),/整批.*10 分钟/);
    assert.ok(!await evaluate(`sm.calls.some(c=>['build','upgrade','dig'].includes(c.type))`));
    assert.equal(await evaluate('sm.view.state.resources.scrap'),3500);
    await reloadCampaign();await settle('robot forecast after refresh');assert.match(await text(),/整批.*10 分钟/);
    assert.ok(!await evaluate(`sm.calls.some(c=>['build','upgrade','dig'].includes(c.type))`));
    // 模拟一次明确的管家入库，保持房间存量+库存守恒；不按预测直接给建设补钱。
    const received=await evaluate(`(()=>{const s=sm.view.state,r=s.rooms.find(r=>r.id===4);
      const take=Math.min(Math.floor(r.stored/45)*45,Math.floor(3600-s.resources.scrap));
      s.resources.scrap+=take;r.stored-=take;clock+=600000;s.lastSettledAt=clock;return take;})()`);
    assert.equal(received,100);await evaluate(`${panel}.getElementById('shelter-check').click();`);
    await settle('robot receipts fund actual upgrade');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===7).length`),1,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.constructionLedger[0].scrap`),3600);
    await reloadCampaign();await settle('robot-funded upgrade is not repeated');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===7).length`),1);
  });
  await t.test('攒料时间浏览器：材料整批估时不冒充停建或零额度会自动恢复，阶段记录保留真实阻塞',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(storageChoiceView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.view.state.resources.scrap=100;`));
    await settle('batch funding estimate');
    const text=()=>evaluate(`${panel}.getElementById('shelter-development').textContent`);
    assert.match(await text(),/整批.*37\.5 小时/);assert.doesNotMatch(await text(),/31\.0 小时/);
    assert.match(await evaluate(`${state}.developmentTrace.active.start.reason`),/建设额度不足.*没有可核对的恢复时间/);
    assert.equal(await evaluate(`${state}.developmentTrace.active.start.route`),null);
    await reloadCampaign();await settle('batch funding estimate survives refresh');
    assert.match(await text(),/整批.*37\.5 小时/);assert.doesNotMatch(await text(),/31\.0 小时/);
    assert.ok(!await evaluate(`sm.calls.some(c=>['build','upgrade','dig'].includes(c.type))`));
  });
  await t.test('攒料时间浏览器：启用建设后按整批37.5小时估算，未实际收取不预支材料',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(storageChoiceView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.view.state.resources.scrap=100;${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','off');`));
    await settle('funded policy uses real batch forecast');
    const start=await evaluate(`${state}.developmentTrace.active.start`);
    assert.match(start.reason,/整批.*37\.5 小时/);assert.doesNotMatch(start.reason,/31\.0 小时/);
    assert.ok(start.route);assert.equal(start.route.complete,false);assert.equal(start.route.expectedAt,null);
    assert.equal(start.resources.scrap,100);assert.equal(await evaluate('sm.calls.length'),0);
    await reloadCampaign();await settle('funded batch forecast survives refresh');
    assert.deepEqual(await evaluate(`${state}.developmentTrace.active.start`),start);
    assert.match(await evaluate(`${state}.developmentTrace.active.latest.reason`),/整批.*37\.5 小时/);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),100);assert.equal(await evaluate('sm.calls.length'),0);
    const observed=await evaluate('shelterData()'),sim=createShelterResourceSimulation(),tick=600000,
      settledAt=observed.state.lastSettledAt;
    // Inspection advances the page clock without settling production. Count
    // whole resource ticks from the actual last settlement, within each 24h cap.
    const day=sim.advance(observed,settledAt+144*tick);
    const before=sim.advance(day.view,settledAt+224*tick),early=sim.collect(before.view,4);
    assert.equal(early.ledger.collected.scrap,0);assert.equal(early.view.state.resources.scrap,100);
    const ready=sim.advance(before.view,settledAt+225*tick),proof=sim.collect(ready.view,4);
    for(const step of [day,before,ready])assert.ok(Object.values(step.ledger.unserved).every(n=>n===0));
    assert.equal(proof.ledger.collected.scrap,189);assert.equal(proof.view.state.resources.scrap,289);
    // Supply the independently settled room state; the native action must still
    // collect it. Do not copy the preview's credited inventory into the page.
    await evaluate(`sm.view=${JSON.stringify(ready.view)};clock=sm.view.serverTime;${panel}.getElementById('shelter-check').click();`);
    await settle('full real batch is collected before funded storage');
    const calls=await evaluate('sm.calls'),collect=calls.findIndex(c=>c.type==='collect_all'||c.type==='collect'&&c.roomId===4),
      build=calls.findIndex(c=>c.type==='build'&&c.room==='storage');
    assert.ok(collect>=0&&build>collect,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.constructionLedger.filter(r=>r.scrap===256&&r.parts===0).length`),1);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),33);
    await reloadCampaign();await settle('real batch funded build survives refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="storage").length'),1);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('人口防守建议浏览器：留守不足和关闭防守不直接推扩人口，恢复后刷新重评且目标不变',async()=>{
    for(const defense of [false,true]){
      await setupShelter(scene({defense},`sm.view=${JSON.stringify(storageChoiceView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
        const person=sm.view.state.residents.find(p=>p.id===11);person.weaponId=sm.view.state.items[0].id;
        sm.view.state.items[0].damage=[1000,1000];person.away={kind:'explore'};`));
      await settle('population defense condition '+defense);
      let advice=await evaluate(`${state}.populationAdvice`);
      assert.match(advice,defense?/留守未达标/:/自动防守未开启/);assert.doesNotMatch(advice,/可评估调到/);
      assert.match(await evaluate(`${state}.development`),defense?/留守未达标/:/自动防守未开启/);
      assert.match(await evaluate(`${panel}.getElementById('shelter-development').textContent`),defense?/留守未达标/:/自动防守未开启/);
      assert.equal(await evaluate(`${panel}.getElementById('shelter-population').value`),'14');
      if(defense){
        await evaluate(`sm.view.state.residents.find(p=>p.id===11).away=null;`);await reloadCampaign();
        await settle('population readiness after homecoming');advice=await evaluate(`${state}.populationAdvice`);
        assert.match(advice,/可评估调到 19 人.*修改人口目标/);assert.match(advice,/满足当前留守设置/);
        assert.equal(await evaluate(`${panel}.getElementById('shelter-population').value`),'14');
        assert.ok(!await evaluate(`sm.calls.some(c=>['breed','radio','explore_start','quest_start'].includes(c.type))`));
      }
    }
  });
  await t.test('扩仓路线执行浏览器：现有一格升级可先完工时实际开工，预算仍限制且刷新不重复扣款',async()=>{
    for(const limit of [199,200]){
      await setupShelter(scene({},`sm.view=${JSON.stringify(storageChoiceView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
        ${construction}const budget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
        budget.scrapLimit=${limit};localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(budget));`));
      await settle('storage route respects budget '+limit);
      const builds=()=>evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type))`);
      if(limit===199){assert.deepEqual(await builds(),[]);continue;}
      const list=await builds();assert.equal(list.length,1,JSON.stringify(await diagnose()));
      assert.equal(list[0].type,'upgrade');assert.equal(list[0].roomId,202);
      assert.equal(await evaluate('sm.view.state.resources.scrap'),0);
      assert.equal(await evaluate(`${state}.constructionLedger[0].scrap`),200);
      await reloadCampaign();await settle('storage upgrade survives refresh');
      assert.equal((await builds()).length,1);assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
    }
  });
  await t.test('追级仓储浏览器：明确医疗预留超过当前容量仍可扩仓，预算不足不消费',async()=>{
    for(const limit of [100,10000]){
      await setupShelter(scene({medical:true,reserve:100},`sm.view=${JSON.stringify(materialCycleView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
        sm.view.state.resources.stimpak=60;${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
        const budget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));budget.scrapLimit=${limit};
        localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(budget));`));
      await settle('medical storage demand budget '+limit);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='storage').length`),limit===100?0:1,JSON.stringify(await diagnose()));
    }
  });
  await t.test('追级仓储浏览器：治疗针近满仍为原升级备料，刷新和满针领取不反复建仓',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(materialCycleView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.view.state.resources.stimpak=60;${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');`));
    await settle('stocked medicine does not take material budget');
    assert.ok(!await evaluate(`sm.calls.some(c=>c.type==='build'&&c.room==='storage')`),JSON.stringify(await diagnose()));
    assert.ok(await evaluate(`${state}.campaign.roles.some(r=>r.role==='workshop')`));
    await reloadCampaign();await settle('surplus inventory after refresh');
    assert.ok(!await evaluate(`sm.calls.some(c=>c.type==='build'&&c.room==='storage')`));
    // The retained-project view need not repeat the initial storage explanation.
    // Check the actual purpose and inventory instead of requiring obsolete text.
    assert.equal(await evaluate(`${state}.campaign.materials.id`),1);
    assert.equal(await evaluate('sm.view.state.resources.stimpak'),60);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===1).length`),0,'未领取零件前不能开工');
    await evaluate(`sm.view.state.resources.parts=27;sm.view.state.rooms.find(r=>r.id===108).stored=3;
      sm.view.state.rooms.find(r=>r.id===7).stored=3;${panel}.getElementById('shelter-check').click();`);
    await settle('original upgrade starts despite medicine overflow');
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='upgrade'&&c.roomId===1)`),JSON.stringify(await diagnose()));
    assert.ok(!await evaluate(`sm.calls.some(c=>c.type==='build'&&c.room==='storage')`));
    assert.equal(await evaluate(`sm.view.state.rooms.find(r=>r.id===7).stored`),3,'uncollectable medicine stays in its room');
    assert.equal(await evaluate('sm.view.state.resources.stimpak'),60);
    const calls=await evaluate('sm.calls'),collect=calls.findIndex(c=>c.type==='collect'&&c.roomId===108),upgrade=calls.findIndex(c=>c.type==='upgrade'&&c.roomId===1);
    assert.ok(collect>=0&&upgrade>collect,'零件真实领取先于原升级');
    assert.ok(!calls.some(c=>c.type==='collect_all'||c.type==='collect'&&c.roomId===7),'满针时只领取可容纳的工坊整批');
    await reloadCampaign();await settle('medicine overflow does not repeat original upgrade');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===1).length`),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='storage').length`),0);
    assert.equal(await evaluate(pending),null);
  });
  for(const quick of [true,false])await t.test(`连续备料浏览器：工坊产速改变路线估算时保持原升级，刷新、领取后开工且释放材料归属（${quick?'列表快捷':'居民详情'}）`,async()=>{
    const path=quick?'quick':'detail';
    await setupShelter(scene({},`sm.view=${JSON.stringify(materialCycleView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.quickAssign=${quick};
      // Explicit manufacturing candidates: general employment can move former idle
      // adults before staffing, so identical stats no longer guarantee their rank.
      for(const id of [13,14])sm.view.state.residents.find(p=>p.id===id).stats.int=10;
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');`));
    await settle('material project remains stable after workshop staffing '+path);
    const firstVisit=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events
      .filter(e=>e.type==='shelter-check').map(e=>({note:e.detail,actions:e.data.actions,visit:e.data.visit,
        recheckMs:e.data.nextAt-e.at,campaign:e.data.campaignNote}))`);
    // Both native paths fit the current 5-minute/60-action visit. Do not force
    // an obsolete 12-action yield that used to split these two worker arrivals.
    assert.equal(firstVisit.length,1);assert.equal(firstVisit[0].note,'本轮检查完成');
    assert.equal(firstVisit[0].visit.limitMs,300000);assert.equal(firstVisit[0].visit.actionLimit,60);
    assert.ok(firstVisit[0].visit.elapsedMs<=firstVisit[0].visit.limitMs);
    assert.ok(firstVisit[0].actions<=firstVisit[0].visit.actionLimit);
    assert.equal(await evaluate(pending),null);
    const work=await evaluate(`${state}.campaign.roles.find(r=>r.role==='workshop')`);assert.ok(work,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.campaign.materials.id`),1);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===108).map(c=>c.residentId).sort((a,b)=>a-b)`),[13,14],
      '快捷与详情路径均完成两名工坊工人的真实到岗 '+JSON.stringify({calls:await evaluate('sm.calls'),firstVisit}));
    assert.ok(!await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===${work.id}&&c.roomId===null)`));
    await reloadCampaign();await settle('material project survives refresh '+path);
    assert.equal(await evaluate(`${state}.campaign.materials.id`),1);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===108).map(c=>c.residentId).sort((a,b)=>a-b)`),[13,14]);
    await evaluate(`sm.view.state.resources.parts=27;sm.view.state.rooms.find(r=>r.id===108).stored=3;${panel}.getElementById('shelter-check').click();`);
    await settle('material project collected and built '+path);
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='upgrade'&&c.roomId===1)`),JSON.stringify(await diagnose()));
    assert.ok(!await evaluate(`sm.calls.some(c=>c.type==='upgrade'&&c.roomId===7)`));
    assert.equal(await evaluate(`${state}.campaign.materials??null`),null);
  });
  await t.test('防守备料接续：十五人跨轮增援追击、刷新复岗后保留原工程，真实领取后才开工',async()=>{
    await setupShelter(scene({defense:true},`sm.view=${JSON.stringify(materialCycleView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.view.state.rooms.push({id:900,type:'door',floor:1,col:0,width:1,level:1,builtAt:0,upgradeAt:null,stored:0,unpowered:false,incident:null});
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');`));
    await settle('prepare original materials before raid');
    const worker=await evaluate(`${state}.campaign.roles.find(r=>r.role==='workshop')`);
    const material=await evaluate(`${state}.campaign.materials`);
    assert.ok(worker,JSON.stringify(await diagnose()));assert.equal(material.id,1);
    // Ordinary development may have built an affordable room before the raid.
    // Compare against that actual history; the retained upgrade must still wait
    // for collection, and combat must add no construction request at all.
    const constructionBefore=await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type))`);
    const ledgerBefore=await evaluate(`${state}.constructionLedger?.length||0`);
    assert.equal(constructionBefore.filter(c=>c.type==='upgrade'&&c.roomId===1).length,0);
    const original=await evaluate('sm.view.state.residents.map(p=>({id:p.id,room:p.roomId}))');
    assert.equal(original.length,15);
    const workshopPeople=original.filter(p=>p.room===108).map(p=>p.id);
    assert.ok(workshopPeople.length>=1&&workshopPeople.length<=2,'现有一格工坊可能已安全补到两人，按战前实际岗位核对恢复');
    await evaluate(`sm.view.state.rooms.find(r=>r.id===900).incident={kind:'raiders',hp:80,maxHp:80};${panel}.getElementById('shelter-check').click();`);
    await drive(`sm.view.state.residents.every(p=>p.roomId===900)&&${state}.campaign.defense.length===15&&!${pending}`,'all fifteen defenders gathered across visits',320);
    assert.deepEqual(await evaluate(`${state}.campaign.materials`),material);
    assert.ok(await evaluate(`${state}.campaign.roles.some(r=>r.id===${worker.id}&&r.role==='workshop'&&r.room===108)`));
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type))`),constructionBefore);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===900).incident=null;sm.view.state.rooms.find(r=>r.id===4).incident={kind:'raiders',hp:30,maxHp:80};`);
    await drive(`sm.view.state.residents.every(p=>p.roomId===4)&&${state}.campaign.defense.every(r=>r.room===4)&&!${pending}`,'all defenders pursue without losing original roles',320);
    const defenders=await evaluate(`${state}.campaign.defense`);
    for(const resident of original)assert.equal(defenders.find(r=>r.id===resident.id).from,resident.room);
    await reloadCampaign();
    await evaluate(`sm.view.state.rooms.find(r=>r.id===4).incident=null;sm.view.state.rooms.find(r=>r.id===108).unpowered=true;
      ${panel}.getElementById('shelter-check').click();`);
    await drive(`${state}.campaign.defense.length===${workshopPeople.length}&&${state}.campaign.defense.every(d=>${JSON.stringify(workshopPeople)}.includes(d.id))&&!${pending}`,'other jobs resume while workshop is temporarily unavailable',320);
    assert.ok(await evaluate(`sm.view.state.residents.filter(p=>${JSON.stringify(workshopPeople)}.includes(p.id)).every(p=>p.roomId===4)`));
    assert.deepEqual(await evaluate(`${state}.campaign.materials`),material);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===108).unpowered=false;${panel}.getElementById('shelter-check').click();`);
    await drive(`${state}.campaign.defense.length===0&&sm.view.state.residents.filter(p=>${JSON.stringify(workshopPeople)}.includes(p.id)).every(p=>p.roomId===108)&&!${pending}`,'original workshop assignment restored',160);
    await settle('continue original project after battle');
    assert.deepEqual(await evaluate(`${state}.campaign.materials`),material);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type))`),constructionBefore);
    // 后续独立生产快照：只补齐已生产存量，脚本必须实际领取，不能从目标或路线直接加库存。
    await evaluate(`sm.view.state.rooms.find(r=>r.id===108).stored=30;sm.view.state.resources.parts=0;
      sm.resultMessages={collect:'收到30 零件',collect_all:'收到30 零件'};
      ${panel}.getElementById('shelter-check').click();`);
    await settle('collect accumulated materials and start the retained project');
    const calls=await evaluate('sm.calls');
    assert.equal(calls.filter(c=>c.type==='upgrade'&&c.roomId===1).length,1);
    assert.equal(calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length,constructionBefore.length+1);
    const income=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-income')`);
    assert.ok(income.some(e=>e.data.reward['避难所零件']===30));
    assert.equal(await evaluate(`${state}.campaign.materials??null`),null);
    assert.equal(await evaluate(`${state}.constructionLedger.length`),ledgerBefore+1);
  });
  await t.test('高等级备料浏览器：普通就业完成但无可执行工程时不为备选升级建工坊，刷新保持生产',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(upperStageView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.view.state.resources.scrap=2000;${construction}
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');`));
    await settle('level-seven materials scheduled');
    const calls=await evaluate('sm.calls');
    assert.ok(calls.length>0&&calls.every(c=>c.type==='assign'),JSON.stringify(await diagnose()));
    assert.match(await evaluate(`${state}.development`),/未找到完整达级路线/);
    assert.equal(await evaluate(`${state}.campaign.materials??null`),null);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2000);
    await reloadCampaign();await settle('unselected level materials do not spend across refresh');
    assert.deepEqual(await evaluate('sm.calls'),calls);
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2000);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('高等级备料浏览器：明确回收升级需求后建工坊，完工供料保留本金，领取后实际升级',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(upperStageView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      // Derive a real productive upgrade, independent of incomplete point-only routes.
      sm.view.state.rooms.find(r=>r.id===4).level=2;sm.view.progress.score-=3;
      sm.view.state.resources.scrap=2500;${construction}
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');`));
    await settle('productive upgrade builds missing workshop');
    const build=await evaluate(`sm.calls.find(c=>c.type==='build'&&c.room==='workshop')`);
    assert.ok(build,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='workshop').length`),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&sm.view.state.rooms.some(r=>r.id===c.roomId&&r.type==='workshop')).length`),0,
      '施工期没有预先安排工人或虚构产量');
    await evaluate(`const workshop=sm.view.state.rooms.find(r=>r.type==='workshop');clock=workshop.builtAt+1;
      sm.view.state.lastSettledAt=clock;sm.view.progress.score++;
      ${panel}.getElementById('shelter-check').click();`);
    await settle('workshop staffed for selected level project');
    const work=await evaluate(`${state}.campaign.roles.find(r=>r.role==='workshop')`);assert.ok(work,JSON.stringify(await diagnose()));
    assert.ok(await evaluate(`sm.view.state.residents.some(p=>p.id===${work.id}&&p.roomId===${work.room})`));
    assert.ok(await evaluate(`sm.view.state.resources.scrap>=1440+45*6`),'回收升级本金与整批供料分别留足');
    await reloadCampaign();await settle('level materials continue after refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='workshop').length`),1);
    const staffed=await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===${work.room})`);
    assert.ok(staffed.length>=1&&staffed.length<=2,'现有一格工坊可补满两人');
    assert.equal(new Set(staffed.map(c=>c.residentId)).size,staffed.length,'刷新不能重复调入同一居民，新增安全补员不算往返');
    assert.equal(staffed.filter(c=>c.residentId===work.id).length,1);
    assert.ok(!await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===${work.id}&&c.roomId===null)`));
    await evaluate(`sm.view.state.resources.parts=42;sm.view.state.rooms.find(r=>r.id===${work.room}).stored=3;
      ${panel}.getElementById('shelter-check').click();`);
    await settle('level project materials collected and upgrade starts');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===4).length`),1,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.constructionLedger.filter(r=>r.scrap===1440&&r.parts===45).length`),1);
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===${work.id}&&c.roomId!==${work.room})`),'备料完成必须离开工坊，允许直接接生产岗位');
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>r.id!==${work.id}||r.role!=='workshop')`));
    await reloadCampaign();await settle('productive material upgrade survives refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===4).length`),1);
    assert.equal(await evaluate(pending),null);
    assert.ok(!await evaluate(`sm.calls.some(c=>c.type==='upgrade'&&c.roomId===${work.room})`));
  });
  const inspectionScene=(extra='',flags={dailyGoals:true})=>scene(flags,`sm.ui20261109=true;
    s.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);
    s.daily.picks=[['incident',2],['win',5],['baby',1]].map(([key,target])=>({key,target,reward:{scrap:160,parts:1,points:30}}));
    s.daily.counters={incident:0,win:0,baby:0};sm.inspectionGoals=true;sm.inspectionBaseline=structuredClone(s);${extra}`);
  for(const unavailable of ['missing','disabled'])await t.test('安全巡检调度：'+unavailable+'按钮不反复切页，下次访问重新核对',async()=>{
    await setupShelter(inspectionScene(unavailable==='missing'?`sm.ui20261109=false;`:
      `const render=window.renderShelter;window.renderShelter=()=>{render();
        const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='安全巡检');if(button)button.disabled=true;};`));
    await settle('unavailable inspection yields to other work');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='safety_inspection').length`),0);
    const visits=await evaluate(`sm.tabs.filter(t=>t==='目标').length`);
    assert.ok(visits>0&&visits<=2,'inspection must not repeatedly preempt production: '+visits);
    await evaluate('sm.ui20261109=true;');await reloadCampaign();await settle('inspection recovers on next visit');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='safety_inspection').length`),1);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('安全巡检：无消耗推进两次目标，冷却预约后领取奖励且刷新不重做',async()=>{
    await setupShelter(inspectionScene());await settle('first safety inspection');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='safety_inspection').length`),1);
    assert.equal(await evaluate(pending),null);
    assert.deepEqual(await evaluate('sm.view.state.resources'),await evaluate('sm.inspectionBaseline.resources'));
    assert.deepEqual(await evaluate('sm.view.state.residents'),await evaluate('sm.inspectionBaseline.residents'));
    assert.ok(await evaluate(`${state}.nextAt<=sm.view.state.daily.counters.safety_inspection_at+602000`));
    await reloadCampaign();await settle('inspection cooldown after refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='safety_inspection').length`),1);
    await evaluate(`clock=sm.view.state.daily.counters.safety_inspection_at+600001;${panel}.getElementById('shelter-check').click();`);
    await settle('second inspection and reward');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='safety_inspection').length`),2);
    assert.deepEqual(await evaluate('sm.view.state.daily.claimed'),[0]);
    assert.equal(await evaluate('sm.view.state.resources.scrap-sm.inspectionBaseline.resources.scrap'),160);
    assert.equal(await evaluate('sm.view.state.resources.parts-sm.inspectionBaseline.resources.parts'),1);
    await reloadCampaign();await settle('completed inspection after refresh');
    assert.equal(await evaluate('sm.calls.length'),3);
  });
  await t.test('安全巡检：关闭目标、真实事件、无人半血、已达标与缺少按钮均不提交',async()=>{
    for(const scenario of ['off','incident','health','done','legacy']){
      const extra=scenario==='incident'?`s.rooms[0].incident={kind:'fire'};`:scenario==='health'?`s.residents.forEach(p=>p.hp=1);`:
        scenario==='done'?`s.daily.counters.incident=2;s.daily.claimed=[0];`:scenario==='legacy'?`sm.ui20261109=false;`:'';
      await setupShelter(inspectionScene(extra,{dailyGoals:scenario!=='off'}));await settle('inspection blocked '+scenario);
      assert.equal(await evaluate(`sm.calls.some(c=>c.type==='safety_inspection')`),false,scenario);
    }
  });
  await t.test('安全巡检：未知结果跨刷新和跨日不重发，其他事件计数增长不能冒认成功',async()=>{
    await setupShelter(inspectionScene(`sm.inspectionUnknown=true;`));
    await drive(`sm.calls.some(c=>c.type==='safety_inspection')`,'unknown inspection');await pulse(35000);
    await evaluate(`sm.view.state.daily.counters.incident=1;sm.view.state.daily.counters.safety_inspection_at=clock;`);
    await reloadCampaign();await settle('unknown inspection read only');
    assert.equal(await evaluate(`${pending}?.kind`),'inspection');
    await evaluate(`clock+=86400000;sm.view.state.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);sm.view.state.daily.counters={incident:0,win:0,baby:0};`);
    await reloadCampaign();await settle('unknown inspection next day');
    assert.equal(await evaluate(`${pending}?.kind`),'inspection');
    assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('安全巡检：原生处理器关闭开关或替换动作时发送前拦截',async()=>{
    for(const wrong of [false,true]){
      await setupShelter(inspectionScene(`const act=shelterAct;window.shelterAct=a=>{
        if(a.type==='safety_inspection'){
          ${wrong?`a={type:'collect_all'};`:`const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.dailyGoals=false;localStorage.setItem('${key}',JSON.stringify(cfg));`}
        }return act(a);
      };`));
      await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'inspection request blocked');
      assert.deepEqual(await evaluate('sm.calls'),[]);
    }
  });
  const dailyScene=`s.daily.picks=[['build',2],['win',5],['collect_scrap',600]].map(([key,target])=>({key,target,reward:{scrap:240,parts:2,points:30}}));
    s.daily.counters={build:1,win:1,collect_scrap:405};`;
  const guardScene=`for(let i=7;i<=16;i++)s.residents.push({...structuredClone(s.residents[0]),id:i,name:'儿童'+i,roomId:null,adultAt:clock+86400000});
    s.items=[{id:71,slot:'weapon',tier:1,name:'留守武器',damage:[20,20]}];s.residents[4].weaponId=71;`;
  await t.test('留守浏览器：16人口时保留主要武器持有者，其他人出发，旧设置迁移及刷新不重复派遣',async()=>{
    await setupShelter(scene({explore:true,defense:true},guardScene));
    await settle('guard keeps armed resident at home');
    const starts=await evaluate(`sm.calls.filter(c=>c.type==='explore_start')`);
    assert.equal(starts.length,1);assert.notEqual(starts[0].residentId,5);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).away'),null);
    assert.match(await evaluate(`${state}.campaignNote`),/留守/);
    assert.equal(await evaluate(`${panel}.getElementById('shelter-campaign-guardResidents').value`),'2');
    await reloadCampaign();await settle('guard refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='explore_start').length`),1);
  });
  await t.test('留守浏览器：自定义人数阻止出发，保存后刷新仍生效，降低至可行值才继续',async()=>{
    await setupShelter(scene({explore:true,defense:true,guardResidents:6,guardPowerPercent:50},guardScene));
    await settle('custom guard blocks departure');assert.equal(await evaluate('sm.calls.length'),0);
    await reloadCampaign();await settle('custom guard retained');assert.equal(await evaluate('sm.calls.length'),0);
    await evaluate(`${panel}.getElementById('shelter-campaign-guardResidents').value='4';${panel}.getElementById('shelter-campaign-save').click();`);
    await drive(`sm.calls.some(c=>c.type==='explore_start')`,'valid guard permits departure');
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('${key}')).guardResidents`),4);
    assert.notEqual(await evaluate(`sm.calls.find(c=>c.type==='explore_start').residentId`),5);
  });
  await t.test('留守浏览器：提交前主力被人工派出，取消原候选且不以返程预计到家冒充可用',async()=>{
    await setupShelter(scene({explore:true,defense:true},guardScene));
    await drive(`sm.explorePerson===6`,'departure is being prepared');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='explore_start').length`),0);
    await evaluate(`sm.view.state.residents.find(p=>p.id===5).away={kind:'explore'};
      sm.view.state.explorers=[{id:90,residentId:5,tier:0,abyss:false,startedAt:clock-10000,recalledAt:clock-500,returnAt:clock+500}];`);
    await settle('guard rechecked before departure');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='explore_start').length`),0);
  });
  for(const unavailable of ['disabled','missing'])await t.test('每日领奖调度：'+unavailable+'按钮不反复抢占产出检查，下次访问恢复领取',async()=>{
    await setupShelter(scene({dailyGoals:true},`
      s.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);
      s.daily.picks=[{key:'caravan',target:1,reward:{scrap:160,parts:1,points:30}},
        {key:'win',target:4,reward:{scrap:160,parts:1,points:30}},{key:'baby',target:1,reward:{scrap:160,parts:1,points:30}}];
      s.daily.counters={caravan:1,win:0,baby:0};
      ${unavailable==='missing'?`const render=window.renderShelter;window.renderShelter=()=>{render();
        if(sm.tab==='目标')[...document.querySelectorAll('section')].find(n=>n.querySelector('h2')?.textContent==='今日目标')?.remove();};`:''}`));
    await settle('unavailable daily reward yields to other work');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='claim_objective').length`),0);
    const visits=await evaluate(`sm.tabs.filter(t=>t==='目标').length`);
    assert.ok(visits>0&&visits<=2,'at most priority check plus the normal reward sweep: '+visits);
    await evaluate('sm.dailyGoalRows=true;sm.dailyIncomplete=false;');
    await reloadCampaign();await settle('available daily reward is checked on the next visit');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='claim_objective').map(c=>c.index)`),[0]);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('每日商队浏览器：最低成本交付绑定回执，未知结果保留物资预留且跨刷新不重交',async()=>{
    for(const unknown of [false,true]){
      await setupShelter(scene({dailyGoals:true,caravanDaily:true},`${construction}
        sm.caravanUnknown=${unknown};s.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);
        s.daily.picks=[{key:'caravan',target:1,reward:{scrap:400,parts:3,points:30}},
          {key:'win',target:4,reward:{scrap:400,parts:3,points:30}},{key:'baby',target:1,reward:{scrap:400,parts:3,points:30}}];
        s.daily.counters={caravan:0,win:0,baby:0};
        sm.caravan={offers:[{slot:0,difficulty:1,scrap:100,parts:0,reward:50,delivered:false},
          {slot:1,difficulty:2,scrap:300,parts:3,reward:100,delivered:false}]};`));
      await drive(`sm.calls.some(c=>c.type==='caravan')`,'caravan submitted');await settle('caravan finished');
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='caravan').length`),1);
      assert.equal(await evaluate(`sm.calls.find(c=>c.type==='caravan').slot`),0);
      if(unknown)assert.equal(await evaluate(`${state}.caravan.pending.cost.scrap`),100);
      else assert.equal(await evaluate(`${state}.constructionLedger.find(e=>e.scrap===100).parts`),0);
      await reloadCampaign();await settle('caravan refresh');
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='caravan').length`),1);
      const totals=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).totals`);
      assert.equal(totals['代币']||0,unknown?0:50);
      assert.equal(totals['避难所商队代币']||0,unknown?0:50);
      if(!unknown){
        await evaluate(`fetch('/api/shelter').then(r=>r.json())`);await pulse(1000);
        await evaluate(`fetch('/api/shelter/caravan',{method:'POST',body:JSON.stringify({slot:0,idempotencyKey:sm.calls.find(c=>c.type==='caravan').idempotencyKey})}).then(r=>r.json())`);
        await evaluate(`fetch('/api/shelter').then(r=>r.json())`);await pulse(1000);
        assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).totals['避难所商队代币']`),50);
      }
    }
  });
  const caravanScene=(extra='')=>scene({dailyGoals:true,caravanDaily:true},`${construction}
    s.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);
    s.daily.picks=[{key:'caravan',target:1,reward:{scrap:200,parts:0,points:30}},
      {key:'win',target:4,reward:{scrap:200,parts:0,points:30}},{key:'baby',target:1,reward:{scrap:200,parts:0,points:30}}];
    s.daily.counters={caravan:0,win:0,baby:0};
    sm.caravan={offers:[{slot:0,difficulty:1,scrap:100,parts:0,reward:50,delivered:false}]};${extra}`);
  await t.test('每日商队总成本：剩余两次成本合计超过奖励，不能只按便宜的第一笔开工',async()=>{
    await setupShelter(caravanScene(`s.daily.picks[0].target=2;
      sm.caravan.offers=[{slot:0,difficulty:1,scrap:150,parts:0,reward:50,delivered:false},
        {slot:1,difficulty:2,scrap:151,parts:0,reward:100,delivered:false}];`));
    await settle('total caravan cost blocks incomplete goal');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='caravan').length`),0);
    assert.match(await evaluate(`${state}.campaignNote`),/总成本.*奖励/);
  });
  await t.test('每日商队未知跨日：新一天订单不证明旧单结果，两天后仍保留原预留',async()=>{
    await setupShelter(caravanScene('sm.caravanUnknown=true;'));
    await drive(`sm.calls.some(c=>c.type==='caravan')`,'unknown caravan submitted');await settle('unknown caravan settled');
    const original=await evaluate(`${state}.caravan.pending`);
    await evaluate(`clock+=2*86400000;sm.caravanUnknown=false;
      sm.view.state.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);sm.view.state.daily.counters.caravan=0;
      sm.caravan.offers[0].delivered=false;`);
    await reloadCampaign();await settle('old caravan still unresolved');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='caravan').length`),1);
    assert.deepEqual(await evaluate(`${state}.caravan.pending`),original);
  });
  await t.test('每日商队发送约束：原生按钮内部关闭每日目标后不能发送，同次点击第二请求被拒绝',async()=>{
    for(const changed of [true,false]){
      await setupShelter(caravanScene(changed?`sm.beforeCaravan=()=>{const c=JSON.parse(localStorage.getItem('${key}'));c.dailyGoals=false;localStorage.setItem('${key}',JSON.stringify(c));};`:
        'sm.caravanDuplicate=true;'));
      await settle('caravan original click guarded');
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='caravan').length`),changed?0:1);
    }
  });
  await t.test('每日商队零代币：原成功回执的零到账仍确认材料消费，不误留待确认',async()=>{
    await setupShelter(caravanScene('sm.caravan.offers[0].reward=0;'));
    await drive(`sm.calls.some(c=>c.type==='caravan')`,'zero token caravan');await settle('zero token receipt');
    assert.equal(await evaluate(`${state}.caravan.pending`),null);
    assert.equal(await evaluate(`${state}.constructionLedger.find(e=>e.scrap===100).parts`),0);
    assert.match(await evaluate(`${state}.campaignNote`),/到账 0 代币/);
    const totals=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).totals`);
    assert.equal(totals['代币'],0);assert.equal(totals['避难所商队代币'],0);
  });
  const craftStaffScene=(mode='success')=>scene({dailyGoals:true,craftDaily:true},`
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:false,upgrade:false,dig:false,scrapLimit:10000,partsLimit:100,scrapReserve:0,partsReserve:0}));
    sm.mode='${mode}';sm.dailyGoalRows=true;s.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);
    s.daily.picks=[{key:'craft',target:1,reward:{scrap:440,parts:3,points:30}},
      {key:'win',target:7,reward:{scrap:440,parts:3,points:30}},{key:'baby',target:1,reward:{scrap:440,parts:3,points:30}}];
    s.daily.counters={craft:0,win:7,baby:0};s.daily.claimed=[1];
    s.rooms.push({...s.rooms[0],id:90,type:'tailor',floor:3,col:2,level:1});s.residents[5].roomId=4;`);
  await t.test('每日制作补员浏览器：空制作房到岗开工，刷新不重做，完工领奖并释放临时工',async()=>{
    await setupShelter(craftStaffScene());await drive(`sm.calls.some(c=>c.type==='craft')`,'staff then craft',150);
    await settle('craft waiting');
    const calls=await evaluate('sm.calls'),move=calls.find(a=>a.type==='assign'&&a.roomId===90);
    assert.ok(move,JSON.stringify(calls));assert.equal(calls.filter(a=>a.type==='craft').length,1);
    assert.ok(calls.indexOf(move)<calls.findIndex(a=>a.type==='craft'));
    await reloadCampaign();await settle('staffed craft reload');
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='craft').length`),1);
    assert.equal(await evaluate(`${state}.campaign.roles.find(r=>r.id===${move.residentId}).role`),'craftDaily');
    await evaluate(`sm.view.state.rooms.find(r=>r.id===90).craft=null;sm.view.state.daily.counters.craft=1;`);
    await reloadCampaign();await settle('craft reward and return');
    assert.ok(await evaluate('sm.view.state.daily.claimed.includes(0)'));
    assert.notEqual(await evaluate(`sm.view.state.residents.find(p=>p.id===${move.residentId}).roomId`),90);
    assert.equal(await evaluate(`${state}.campaign.roles.some(r=>r.role==='craftDaily')`),false);
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='craft').length`),1);
  });
  await t.test('每日制作补员浏览器：调岗结果未知时刷新保留原单，不重复调岗或提前制作',async()=>{
    await setupShelter(craftStaffScene()+`sm.assignUnknown=true;`);
    await drive(`sm.calls.some(c=>c.type==='assign')`,'unknown craft staffing');
    await reloadCampaign();await settle('unknown staffing retained');
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='assign').length`),1);
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='craft').length`),0);
    assert.equal(await evaluate(`${pending}.kind`),'assign');
    assert.equal(await evaluate(`${pending}.before.campaign.choice.role`),'craftDaily');
  });
  await t.test('每日制作补员浏览器：开窗后预算不足撤销调入，不发制作请求',async()=>{
    await setupShelter(craftStaffScene()+`sm.quickAssign=false;`);
    await drive(`!!document.querySelector('[role="dialog"] h2')`,'craft staff detail');
    await evaluate(`localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:false,upgrade:false,dig:false,scrapLimit:79,partsLimit:100,scrapReserve:0,partsReserve:0}));`);
    await settle('cancel unfunded craft staffing');
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='assign'&&a.roomId===90).length`),0);
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='craft').length`),0);
  });
  await t.test('每日制作浏览器：已有工坊和值班者时只做一次0档，共用额度且未知结果不重放',async()=>{
    for(const mode of ['success','unknown']){
      await setupShelter(scene({dailyGoals:true,craftDaily:true},`${construction}
        sm.mode='${mode}';s.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);
        s.daily.picks=[{key:'craft',target:1,reward:{scrap:400,parts:3,points:30}},
          {key:'win',target:4,reward:{scrap:400,parts:3,points:30}},{key:'baby',target:1,reward:{scrap:400,parts:3,points:30}}];
        s.daily.counters={craft:0,win:0,baby:0};
        s.rooms.push({...s.rooms[0],id:90,type:'armory',floor:2,col:4,level:1});s.residents[4].roomId=90;`));
      await drive(`sm.calls.some(c=>c.type==='craft')`,'daily craft submitted');
      await settle('craft visit finished');
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='craft').length`),1);
      if(mode==='success')assert.equal(await evaluate(`${state}.constructionLedger[0].scrap`),80);
      else assert.equal(await evaluate(`${pending}.kind`),'craft');
      await reloadCampaign();await settle('craft survives reload');
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='craft').length`),1);
    }
  });
  await t.test('持续等级浏览器：默认持续升级，固定终点与持续模式切换后刷新保留且不突破零预算',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(levelGateView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:0,partsLimit:0,scrapReserve:0,partsReserve:0}));`));
    await settle('level goal shown under zero budget');
    assert.match(await evaluate(`${panel}.getElementById('shelter-development').textContent`),/持续升级：4 → 5 级/);
    assert.equal(await evaluate(`${panel}.getElementById('shelter-level-continuous').checked`),true);
    assert.equal(await evaluate(`${panel}.getElementById('shelter-level-target').disabled`),true);
    const developmentText=await evaluate(`${panel}.getElementById('shelter-development').textContent`);
    assert.match(developmentText,/目标 14，新配对受限/);
    assert.match(developmentText,/自动防守未开启，请先确认手动防守安排或开启并核对留守/);
    assert.equal(await evaluate('sm.calls.length'),0);
    await evaluate(`const mode=${panel}.getElementById('shelter-level-continuous');mode.checked=false;mode.dispatchEvent(new Event('change',{bubbles:true}));
      const input=${panel}.getElementById('shelter-level-target');input.value='6';input.dispatchEvent(new Event('change',{bubbles:true}));`);
    await reloadCampaign();await settle('custom level target retained');
    assert.equal(await evaluate(`${panel}.getElementById('shelter-level-target').value`),'6');
    assert.match(await evaluate(`${panel}.getElementById('shelter-development').textContent`),/4 → 6 级/);
    assert.equal(await evaluate('sm.calls.length'),0);
    await evaluate(`const mode=${panel}.getElementById('shelter-level-continuous');mode.checked=true;mode.dispatchEvent(new Event('change',{bubbles:true}));`);
    await reloadCampaign();await settle('continuous level target retained');
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:level-target:v1')`),'auto');
    assert.match(await evaluate(`${panel}.getElementById('shelter-development').textContent`),/持续升级：4 → 5 级/);
    assert.equal(await evaluate('sm.calls.length'),0);
  });
  await t.test('实际阶段浏览器：17人口在建工程等到5级后自动生成6级计划，不重复提交现有升级',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(levelGateView())};const actual=sm.view.state;
      sm.view.serverTime=clock;actual.lastSettledAt=clock;
      for(let i=16;i<=17;i++)actual.residents.push({...structuredClone(actual.residents[0]),id:i,name:'新增居民'+i,roomId:null,adultAt:clock+86400000});
      actual.rooms.find(r=>r.id===6).width=1;actual.rooms[0].upgradeAt=clock+2*3600000;
      actual.resources={scrap:793,parts:23,power:409,food:311,water:298,stimpak:7};
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:0,partsLimit:0,scrapReserve:0,partsReserve:0}));`));
    await settle('wait for known upgrade');assert.equal(await evaluate('sm.calls.length'),0);
    assert.match(await evaluate(`${state}.development`),/当前阶段 5 级/);
    assert.match(await evaluate(`${state}.development`),/后核对5级/);
    const start=await evaluate(`${state}.developmentTrace.active.start`);
    assert.equal(start.score,64);assert.equal(start.resources.scrap,793);assert.equal(start.route.kind,'wait');
    await reloadCampaign();await settle('stage survives refresh');
    assert.deepEqual(await evaluate(`${state}.developmentTrace.active.start`),start);
    await evaluate(`clock+=2*3600000;sm.view.state.rooms[0].upgradeAt=null;sm.view.state.rooms[0].level=2;
      sm.view.progress.level=5;sm.view.state.lastSettledAt=clock;${panel}.getElementById('shelter-check').click();`);
    await drive(`${state}.development.includes('当前阶段 6 级')`,'continue toward six after server confirms five');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade').length`),0);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:population:v1')`),'14','不能暗改已保存的人口设置');
    const trace=await evaluate(`${state}.developmentTrace`);
    assert.equal(trace.history.length,1);assert.equal(trace.history[0].outcome,'reached');assert.equal(trace.history[0].end.score,66);
    assert.equal(trace.active.target,6);assert.equal(trace.active.start.level,5);
    await settle('completed stage exported');
    assert.match(await evaluate(`${panel}.getElementById('shelter-development-trace').textContent`),/首次观察到 5 级\/66 分/);
    const check=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-check').at(-1)`);
    assert.equal(check.data.developmentStage.last.outcome,'reached');assert.equal(check.data.developmentStage.active.target,6);
    await reloadCampaign();await settle('completion not duplicated');
    assert.equal(await evaluate(`${state}.developmentTrace.history.length`),1);
  });
  await t.test('等级阶段浏览器：损坏诊断保留原文，零预算和原操作不受其影响，页面明确提示',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(levelGateView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'fixture',developmentTrace:{version:999,original:'keep'}}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:0,partsLimit:0,scrapReserve:0,partsReserve:0}));`));
    await settle('damaged trace does not stop normal assessment');
    assert.deepEqual(await evaluate(`${state}.developmentTrace`),{version:999,original:'keep'});
    assert.equal(await evaluate('sm.calls.length'),0);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'true');
    assert.match(await evaluate(`${panel}.getElementById('shelter-development-trace').textContent`),/无法核对/);
    assert.match(await evaluate(`${state}.development`),/持续升级：4 → 5 级/);
    await reloadCampaign();await settle('damaged trace stays isolated after refresh');
    assert.deepEqual(await evaluate(`${state}.developmentTrace`),{version:999,original:'keep'});
    assert.equal(await evaluate('sm.calls.length'),0);assert.equal(await evaluate(pending),null);
    assert.match(await evaluate(`${panel}.getElementById('shelter-development-trace').textContent`),/无法核对/);
  });
  await t.test('等级阶段浏览器：诊断损坏不妨碍合法开工，原请求未知后降至零预算仍保留原单且不重发',async()=>{
    const f=readyConstructionScene();f.construction.scrapLimit=400;
    await setupShelter(scene(f.campaign,`sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.mode='unknown';
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','8');
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'损坏诊断对照',
        developmentTrace:{version:999,original:'keep'}}));`));
    await drive('sm.calls.some(c=>c.type==="upgrade")','damaged diagnostic permits valid native request');
    const original=await evaluate(pending);assert.equal(original.kind,'upgrade');assert.deepEqual(original.targets,[4]);
    await evaluate(`const budget=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));
      budget.scrapLimit=0;budget.partsLimit=0;localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(budget));`);
    for(const pass of [1,2]){
      await reloadCampaign();await settle('damaged diagnostic retains unknown original '+pass);
      assert.equal(await evaluate(`${pending}.id`),original.id);assert.deepEqual(await evaluate(`${pending}.targets`),[4]);
      assert.deepEqual(await evaluate(`${state}.developmentTrace`),{version:999,original:'keep'});
      assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate('sm.calls[0].type'),'upgrade');
      assert.match(await evaluate(`${panel}.getElementById('shelter-development-trace').textContent`),/无法核对/);
    }
  });
  await t.test('持续等级阻碍浏览器：生产房满级且人口目标限制发展时，显示缺分和设置限制，不空等或偷改上限',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(levelGateView())};const actual=sm.view.state;
      sm.view.serverTime=clock;actual.lastSettledAt=clock;
      for(const r of actual.rooms)if(r.type!=='elevator')r.level=3;
      actual.residents.at(-1).roomId=7;actual.resources={scrap:100,parts:0,power:100,food:100,water:100,stimpak:1};
      sm.view.progress.level=6;`));
    await settle('explicit level blocker');
    assert.match(await evaluate(`${state}.development`),/仍缺可执行增分方案/);
    assert.match(await evaluate(`${state}.development`),/目标 14/);
    assert.equal(await evaluate('sm.calls.length'),0);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:population:v1')`),'14');
  });
  await t.test('施工养成浏览器：足够库存等到发电首批时保持训练，低库存时释放并重评',async()=>{
    for(const enough of [true,false]){
      await setupShelter(scene({training:true,defense:true},`s.rooms[0].level=1;s.rooms[0].upgradeAt=clock+2*3600000;
        s.rooms.push({...s.rooms[0],id:90,type:'training',trainStat:'agi',level:1,floor:2,col:4,upgradeAt:null});
        s.residents[4].roomId=90;s.residents[4].stats.agi=3;s.resources.power=${enough?400:1};
        localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'fixture',campaign:{roles:[{id:5,room:90,role:'training',stat:'agi',base:3,at:clock-1000}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`));
      await settle('construction supply keeps or releases training');
      const released=await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5&&c.roomId===null)`);
      assert.equal(released,!enough);
      if(enough)assert.match(await evaluate(`${state}.campaignNote`),/施工.*首批/);
    }
  });
  await t.test('每日目标整批浏览器：产量零头不足达标时先补回收人员，刷新后不反复调岗',async()=>{
    await setupShelter(scene({dailyGoals:true},`${dailyScene}
      s.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);
      clock=Date.parse(s.daily.day+'T18:50:00+08:00');
      sm.view.serverTime=clock;s.lastSettledAt=clock;
      Object.assign(s.rooms.find(r=>r.id===4),{width:3,level:2,stored:79});
      for(const p of s.residents)if(p.id!==4){p.roomId=p.id<4?p.id:null;}
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');`));
    await drive(`sm.calls.some(a=>a.type==='assign'&&a.roomId===4)`,'daily batch staffing');await settle('finish batch staffing');
    const residents=await evaluate('sm.view.state.residents.filter(p=>p.roomId===4).map(p=>p.id)');assert.ok(residents.length>1);
    const before=await evaluate('sm.calls.length');await reloadCampaign();await settle('daily staffing remains');
    assert.ok(!await evaluate(`sm.calls.slice(${before}).some(a=>a.type==='assign'&&${JSON.stringify(residents)}.includes(a.residentId)&&a.roomId!==4)`));
  });
  await t.test('每日目标整批浏览器：食物目标补员后不被废料优化拉回，关闭日目标解除保留',async()=>{
    await setupShelter(scene({dailyGoals:true},`${dailyScene}
      s.daily.day=new Date(clock+8*3600000).toISOString().slice(0,10);clock=Date.parse(s.daily.day+'T23:00:00+08:00');
      sm.view.serverTime=clock;s.lastSettledAt=clock;s.daily.picks[2]={key:'collect_food',target:200,reward:{scrap:240,parts:2,points:30}};
      Object.assign(s.rooms.find(r=>r.id===2),{width:3,level:1,stored:0});
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');`));
    await drive(`sm.calls.some(a=>a.type==='assign'&&a.roomId===2)`,'daily food staffing');await settle('food goal staffing stable');
    const people=await evaluate('sm.view.state.residents.filter(p=>p.roomId===2).map(p=>p.id)'),before=await evaluate('sm.calls.length');
    await reloadCampaign();await settle('food goal survives optimizer');
    assert.ok(!await evaluate(`sm.calls.slice(${before}).some(a=>a.type==='assign'&&${JSON.stringify(people)}.includes(a.residentId)&&a.roomId!==2)`));
    await evaluate(`const c=JSON.parse(localStorage.getItem('${key}'));c.dailyGoals=false;localStorage.setItem('${key}',JSON.stringify(c));${panel}.getElementById('shelter-check').click();`);
    await settle('daily goals disabled');assert.doesNotMatch(await evaluate(`${state}.campaignNote`),/整批领取保留/);
  });
  await t.test('每日目标浏览器：达标先领奖再养成，跨刷新不重复领取',async()=>{
    await setupShelter(scene({dailyGoals:true,training:true,trainTarget:10},`${dailyScene}s.resources.scrap=100;
      s.daily.counters={build:2,win:5,collect_scrap:600};sm.dailyIncomplete=false;
      s.rooms.push({...s.rooms[0],id:90,type:'training',trainStat:'agi',floor:2,col:4});`));
    await settle('daily rewards before training');
    assert.deepEqual(await evaluate('sm.calls.slice(0,3).map(a=>a.type)'),['claim_objective','claim_objective','claim_objective']);
    assert.equal(await evaluate('sm.view.state.daily.claimed.length'),3);
    await reloadCampaign();await settle('daily already claimed');assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='claim_objective').length`),3);
  });
  await t.test('每日目标浏览器：差一次建设优先有效升级，零预算不靠未到账奖励开工',async()=>{
    for(const limit of [0,10000]){
      await setupShelter(scene({dailyGoals:true},`${dailyScene}${construction}
        const cfg=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));cfg.scrapLimit=${limit};
        localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(cfg));
        s.rooms.find(r=>r.id===4).level=2;s.residents[4].roomId=4;s.residents[5].roomId=5;s.resources.parts=15;`));
      await settle('daily useful construction '+limit);
      const count=await evaluate(`sm.calls.filter(a=>a.type==='upgrade').length`);assert.equal(count,limit===0?0:1);
      assert.ok(!await evaluate(`sm.calls.some(a=>a.type==='dig'||a.type==='claim_objective')`));
    }
  });
  await t.test('每日互助浏览器：跳过受助上限，按成功回执领五次，刷新不重复且没有点赞',async()=>{
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};sm.neighbors[0].helpBlocked='对方今天受助已达上限';sm.neighbors[1].reason='target_limit';`));
    await drive(`(${state}?.social?.entries.filter(e=>e.rewarded).length||0)===5`,'five rewarded neighbors',180);await settle('social done');
    assert.equal(await evaluate('sm.calls.filter(a=>a.type===\'help\').length'),6);
    assert.ok(!await evaluate('sm.calls.some(a=>a.target===1)'));assert.equal(await evaluate('sm.view.state.resources.scrap'),165);
    await reloadCampaign();await settle('social reload no repeats');assert.equal(await evaluate('sm.calls.length'),6);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    assert.equal(events.filter(e=>e.type==='shelter-help-result'&&e.data.rewarded).length,5);
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).totals['避难所废料']`),65);
    assert.doesNotMatch(JSON.stringify(events),/fixture-fingerprint|fixture-help-key/);
    await evaluate(`fetch('/api/shelter').then(r=>r.json())`);await pulse(1000);
    await evaluate(`fetch('/api/shelter/social/help',{method:'POST',body:JSON.stringify({targetId:sm.calls.filter(c=>c.type==='help').at(-1).target,
      deviceFp:'fixture-fingerprint',idempotencyKey:sm.calls.filter(c=>c.type==='help').at(-1).idempotencyKey})}).then(r=>r.json())`);
    await evaluate(`fetch('/api/shelter').then(r=>r.json())`);await pulse(1000);
    assert.equal(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).totals['避难所废料']`),65);
  });
  await t.test('避难所弹窗恢复：互助窗口名称或编号变化，不帮助错误对象且关闭后继续远征',async()=>{
    for(const wrong of ['name','number']){
      await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};
        const append=document.body.append.bind(document.body);document.body.append=(...nodes)=>{append(...nodes);
          const d=nodes.find(n=>n.dataset?.socialDialog);if(d){
            ${wrong==='name'?`d.querySelector('h2').textContent='新版参观页面';`:`d.querySelector('p').textContent='第 999 号';`}
          }};`));
      await settle('changed social dialog '+wrong);assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='help').length`),0);
      assert.equal(await evaluate(`${state}.social?.pending||null`),null);
      assert.equal(await evaluate(`document.querySelector('[data-social-dialog]')`),null);
    }
  });
  await t.test('每日互助浏览器：异步加载窗口等待身份完成，不瞬关且不重复提交',async()=>{
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};sm.socialLoadDelay=-1;`));
    await drive(`!!document.querySelector('[data-social-dialog]')`,'loading social window');
    await pulse(4000);
    assert.equal(await evaluate(`document.querySelector('[data-social-dialog] h2')?.textContent`),'加载中…');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="help").length'),0);
    await evaluate(`sm.socialLoadDelay=0;sm.completeSocialLoad();document.querySelector('[data-social-dialog]').lastChild.disabled=true;`);
    await pulse(1000);
    assert.ok(await evaluate(`!!document.querySelector('[data-social-dialog]')`),'身份已就绪但按钮加载中仍等待');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="help").length'),0);
    await evaluate(`document.querySelector('[data-social-dialog]').lastChild.disabled=false;`);
    await drive(`(${state}?.social?.entries.filter(e=>e.rewarded).length||0)===5`,'loaded social identity',220);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="help").length'),5);
  });
  await t.test('每日互助浏览器：首个排行行缺失不挡后续对象，也不记成帮助成功',async()=>{
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};sm.hiddenNeighbors=[1];`));
    await drive(`(${state}?.social?.entries.filter(e=>e.rewarded).length||0)===5`,'skip missing leaderboard row',220);
    assert.equal(await evaluate('sm.calls.filter(c=>c.target===1).length'),0);
    assert.equal(await evaluate(`${state}.social.entries.some(e=>e.target===1)`),false);
  });
  await t.test('每日互助浏览器：自己奖励用尽即停，次日重新核对',async()=>{
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};sm.neighbors[0].reason='self_limit';`));
    await settle('self quota stops');assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`${state}.social.stopped`),true);
    await reloadCampaign();await settle('self quota explanation survives reload');
    assert.equal(await evaluate('sm.calls.length'),1);
    assert.match(await evaluate(`${state}.campaignNote`),/网站已确认今日互助奖励次数用尽/);
    assert.doesNotMatch(await evaluate(`${state}.campaignNote`),/0\/5/);
    await evaluate(`sm.view.state.daily.day='2026-10-11';sm.neighbors[0].reason=null;sm.neighbors[0].helpedToday=false;`);
    await reloadCampaign();await drive(`(${state}?.social?.entries.filter(e=>e.day==='2026-10-11'&&e.rewarded).length||0)===5`,'next day social resets',180);
  });
  await t.test('每日互助浏览器：未知结果跨刷新保留且不补发，错误目标发送前拦截',async()=>{
    for(const extra of ['sm.helpUnknown=true;','sm.helpWrongTarget=999;']){
      await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors.slice(0,1))};${extra}`));
      await drive(`Boolean(${state}?.social?.pending)`,'social pending saved');
      const before=await evaluate(`${state}.social.pending`);await settle('unknown social yields');
      const count=await evaluate('sm.calls.length');
      assert.equal(count,extra.includes('Unknown')?1:0);
      await reloadCampaign();await settle('unknown help not replayed');assert.equal(await evaluate('sm.calls.length'),count);
      if(extra.includes('Unknown')){
        assert.equal(before.lifecycle.phase,'request-bound');
        assert.equal(await evaluate(`${state}.social.pending.id`),before.id);
      }else{
        assert.equal(before.lifecycle.phase,'prepared');
        assert.equal(await evaluate(`${state}.social.pending`),null,'错误目标被发送前拒绝，刷新可释放未发送记录');
      }
    }
  });
  await t.test('每日互助浏览器：手动弹窗及关闭开关不接管，满仓不消费奖励',async()=>{
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};`));
    await drive(`!!document.querySelector('[data-social-dialog]')`,'neighbor before disable');
    await evaluate(`const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.help=false;localStorage.setItem('${key}',JSON.stringify(cfg));`);
    await settle('help disabled before post');assert.deepEqual(await evaluate('sm.calls'),[]);
    await setupShelter(scene({help:true},`s.resources.scrap=6360;sm.neighbors=${JSON.stringify(neighbors)};`));
    await settle('full storage preserves social reward');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('每日互助浏览器：原对象已帮助只读解除未知，不假报奖励也不重发原对象',async()=>{
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};sm.helpUnknown=true;`));
    await drive(`Boolean(${state}?.social?.pending?.key)`,'unknown original help');await settle('original social waits');
    await evaluate('sm.neighbors[0].helpedToday=true;sm.helpUnknown=false;');
    await reloadCampaign();await drive(`(${state}?.social?.entries.filter(e=>e.rewarded).length||0)===5`,'confirmed later neighbors',180);
    assert.equal(await evaluate('sm.calls.filter(a=>a.target===1).length'),1);
    assert.equal(await evaluate(`${state}.social.entries.find(e=>e.target===1).scrap`),0);
    assert.match(await evaluate(`${state}.social.entries.find(e=>e.target===1).reason`),/原奖励未知/);
  });
  await t.test('每日互助浏览器：回执记账失败后刷新不重发，手动接手原窗口即停止自动点击',async()=>{
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};
      const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='arkengine:auto-shelter:schedule:v1'&&JSON.parse(v)?.social?.entries?.some(e=>e.rewarded))throw Error('fixture ledger failure');return original.call(this,k,v);};`));
    await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'social receipt storage failure');
    assert.equal(await evaluate('sm.calls.length'),1);assert.ok(await evaluate(`${state}.social.pending`));
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};`));
    await drive(`!!document.querySelector('[data-social-dialog]')`,'social manual takeover');
    await evaluate(`document.querySelector('[data-social-dialog] button').focus();`);await trustedStaffKey();
    await pulse(10000);assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.ok(await evaluate(`!!document.querySelector('[data-social-dialog]')`));
  });
  await t.test('每日互助浏览器：原生指纹准备迟到，暂停后不发送；明确未发送的记录刷新可释放',async()=>{
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};sm.delayHelpSend=true;`));
    await drive(`typeof sm.releaseHelpSend==='function'`,'native help preparation delayed');
    await evaluate(`const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.help=false;localStorage.setItem('${key}',JSON.stringify(cfg));`);
    await pulse(16000);await evaluate('sm.releaseHelpSend();');await pulse(1000);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.ok(await evaluate(`${state}.social.pending`));
    await evaluate(`sm.delayHelpSend=false;sm.neighbors=sm.neighbors.slice(0,1);{const updated=JSON.parse(localStorage.getItem('${key}'));updated.help=true;localStorage.setItem('${key}',JSON.stringify(updated));}`);
    await reloadCampaign();await settle('unsent help recovered');
    assert.equal(await evaluate(`${state}.social.pending`),null);
    await reloadCampaign();await settle('later visit can help once');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="help").length'),1);
    assert.equal(await evaluate(`${state}.social.entries.filter(e=>e.rewarded).length`),1);
  });
  await t.test('整合互助浏览器：资格读取失败与旧版不完整记录都可在后续访问恢复',async()=>{
    for(const legacy of [false,true]){
      await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors.slice(0,1))};
        sm.failVisit=${!legacy};const originalVisit=window.fetch;
        window.fetch=(url,options)=>String(url).startsWith('/api/shelter/social/visit')&&sm.failVisit?
          Promise.resolve(new Response('{}',{status:503})):originalVisit(url,options);
        if(${legacy}){const j=${state}||{vaultNo:77,nextAt:0,note:''};j.social={day:s.daily.day,
          entries:[{target:1,day:s.daily.day,at:clock-1000,rewarded:false,scrap:0,reason:'资格资料不完整'}]};
          localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(j));}`));
      await settle('transient or legacy eligibility');
      if(!legacy){
        assert.equal(await evaluate('sm.calls.length'),0);
        assert.equal(await evaluate(`${state}.social?.entries.length||0`),0);
        await evaluate('sm.failVisit=false;');await reloadCampaign();await settle('transient eligibility recovers');
      }
      assert.equal(await evaluate('sm.calls.filter(c=>c.type==="help").length'),1);
      assert.equal(await evaluate(`${state}.social.entries.filter(e=>e.rewarded).length`),1);
    }
  });
  await t.test('整合互助浏览器：旧准备未结束不创建替代操作，迟到后不发送，后续访问可恢复',async()=>{
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors.slice(0,1))};sm.delayHelpSend=true;`));
    await drive(`typeof sm.releaseHelpSend==='function'`,'old help prepare');
    const original=await evaluate(`${state}.social.pending.id`);
    await pulse(16000);await settle('expired unsent help exits');
    assert.equal(await evaluate(`${state}.social.pending`),null);
    await evaluate(`${panel}.getElementById('shelter-check').click();`);await settle('cannot replace awaited callback');
    assert.equal(await evaluate(`${state}.social.pending`),null);
    await evaluate('sm.releaseHelpSend();sm.delayHelpSend=false;');await pulse(1000);
    assert.equal(await evaluate('sm.calls.length'),0);
    await reloadCampaign();await settle('new visit after callback ends');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="help").length'),1);
    assert.equal(await evaluate(`${state}.social.pending`),null);
    assert.ok(original);
  });
  await t.test('整合商队浏览器：异步准备超时可释放，迟到不交付；刷新后只交付一次',async()=>{
    await setupShelter(caravanScene('sm.delayCaravanSend=true;'));
    await drive(`typeof sm.releaseCaravanSend==='function'`,'old caravan prepare');
    assert.equal(await evaluate(`${state}.caravan.pending.lifecycle.phase`),'prepared');
    await pulse(16000);await settle('expired caravan releases reservation');
    assert.equal(await evaluate(`${state}.caravan.pending`),null);
    await evaluate('sm.releaseCaravanSend();sm.delayCaravanSend=false;');await pulse(1000);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="caravan").length'),0);
    await reloadCampaign();await settle('new caravan after unsent preparation');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="caravan").length'),1);
    assert.equal(await evaluate(`${state}.caravan.pending`),null);
    assert.equal(await evaluate(`${state}.constructionLedger.filter(e=>e.scrap===100).length`),1);
  });
  await t.test('整合商队浏览器：异步准备及时结束仍先持久化绑定，再发送和记账',async()=>{
    await setupShelter(caravanScene(`sm.delayCaravanSend=true;const originalCaravan=window.fetch;
      window.fetch=(url,options)=>{if(url==='/api/shelter/caravan'&&options?.method==='POST'){
        sm.boundBeforeTransport=JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).caravan.pending.lifecycle;
      }return originalCaravan(url,options);};`));
    await drive(`typeof sm.releaseCaravanSend==='function'`,'timely caravan prepare');
    await evaluate('sm.releaseCaravanSend();');await settle('timely caravan confirmed');
    assert.equal(await evaluate('sm.boundBeforeTransport.phase'),'request-bound');
    assert.equal(await evaluate('sm.boundBeforeTransport.requestKey===sm.calls.find(c=>c.type==="caravan").idempotencyKey'),true);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="caravan").length'),1);
  });
  for(const kind of ['social','caravan'])await t.test(`整合辅助绑定浏览器：${kind}请求绑定落盘失败不允许实际发送`,async()=>{
    const guard=`const originalSet=Storage.prototype.setItem;sm.bindWriteFailures=0;
      Storage.prototype.setItem=function(k,v){
        if(k==='arkengine:auto-shelter:schedule:v1'&&JSON.parse(v)?.${kind}?.pending?.lifecycle?.phase==='request-bound'){
          sm.bindWriteFailures++;throw Error('fixture binding persistence failed');
        }return originalSet.call(this,k,v);
      };`;
    await setupShelter(kind==='social'?scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors.slice(0,1))};${guard}`):caravanScene(guard));
    await drive('sm.bindWriteFailures>0','binding storage failure reached');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='${kind==='social'?'help':'caravan'}').length`),0);
    assert.equal(await evaluate(`${state}.${kind}.pending.lifecycle.phase`),'prepared');
    assert.equal(await evaluate(`${state}.${kind}.pending.key??null`),null);
    await settle('unsent binding failure yields safely');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='${kind==='social'?'help':'caravan'}').length`),0);
  });
  const adoptionScene=(extra='')=>scene({explore:true,sodaEfficiency:true,hours:6},`
    sm.ui20261109=true;sm.view.drops.minMinutes=120;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    s.residents.find(p=>p.id===5).away={kind:'explore'};
    s.explorers=[{id:194,residentId:5,tier:0,abyss:false,startedAt:clock-3*3600000,
      recalledAt:null,returnAt:null,stimpaks:2,loot:{scrap:0,parts:0,stimpak:0,items:[]}}];
    sm.originalDeparture=s.explorers[0].startedAt;${extra}`);
  for(const parent of [false,true])await t.test(`整合人员浏览器：${parent?'保留当前父母训练并派空闲伴侣':'新训练让位于剩余探险位'}，刷新不重复出发`,async()=>{
    await setupShelter(scene({explore:true,sodaEfficiency:true,training:true,parentTraining:true,trainTarget:10},`
      localStorage.setItem('arkengine:auto-shelter:staff:v1','${parent?'population':'production'}');
      sm.view.drops.minMinutes=120;s.depth=8;
      s.rooms.push({...s.rooms[0],id:30,type:'training',trainStat:'end',floor:3,col:2});
      s.residents[4].stats.end=1;s.residents[4].hp=118;
      for(const p of s.residents.slice(0,4))p.hp=p.id===4?114:80;
      s.residents[5].away={kind:'explore'};
      s.explorers=[{id:90,residentId:6,tier:0,abyss:false,startedAt:clock-600000,recalledAt:null,returnAt:null,
        stimpaks:2,loot:{scrap:0,parts:0,stimpak:0,items:[]}}];
      if(${parent}){
        s.residents[4].roomId=30;s.residents.push({...structuredClone(s.residents[4]),id:7,name:'空闲家长',roomId:null});
        for(const id of [5,7])s.residents.find(p=>p.id===id).familyCooldownUntil=clock+8*3600000;
        localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'父母训练',
          families:[{a:5,b:7,room:5}],campaign:{roles:[{id:5,room:30,from:null,role:'training',purpose:'parent',
            stat:'end',base:1,at:clock-600000,until:clock+8*3600000}],trips:[],attempts:[],heals:[],trainingRest:[]}}));
      }`));
    await drive(`sm.calls.some(c=>c.type==='explore_start')`,'fill second expedition slot');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='explore_start').map(c=>c.residentId)`),[parent?7:5]);
    assert.equal(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.roomId===30)`),false);
    if(parent)assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===5).roomId`),30);
    await settle('filled expedition returns to main page');await reloadCampaign();await settle('filled slots persist');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='explore_start').length`),1);
  });
  const oldAdoption=`{const journal=${state}||{vaultNo:77,nextAt:0,note:''};
    journal.campaign={roles:[],attempts:[],heals:[],trainingRest:[],trips:[{id:194,resident:5,hours:6,
      at:sm.originalDeparture+60000,startedAt:sm.originalDeparture,vaultNo:77,source:'existing-state'}]};
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(journal));}`;
  for(const legacy of [false,true])await t.test(`接管时长浏览器：${legacy?'旧六小时迁移':'无账本接管'}按两小时召回一次，刷新保留原时点`,async()=>{
    await setupShelter(adoptionScene(legacy?oldAdoption:''));
    await drive(`sm.calls.some(a=>a.type==='explore_recall')&&!${pending}`,'two hour adoption recalled',65);
    const trip=await evaluate(`${state}.campaign.trips.find(t=>t.id===194)`),started=await evaluate('sm.originalDeparture');
    assert.equal(trip.hours,2);assert.equal(trip.startedAt,started);assert.equal(trip.durationPolicy,1);
    if(legacy)assert.equal(trip.at,started+60000);
    assert.equal(await evaluate('sm.calls.filter(a=>a.type==="explore_start").length'),0);
    const event=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='shelter-trips-recovered')`);
    assert.equal(event.data.corrected.length,legacy?1:0);
    if(legacy)assert.equal(event.data.corrected[0].previousHours,6);
    await reloadCampaign();await settle('recall persists without replay');
    assert.equal(await evaluate('sm.calls.filter(a=>a.type==="explore_recall").length'),1);
    assert.deepEqual(await evaluate(`${state}.campaign.trips.find(t=>t.id===194)`),trip);
  });
  await t.test('接管时长浏览器：未到期旧记录固定出发期限，刷新和规则变化不续期',async()=>{
    await setupShelter(adoptionScene(`s.explorers[0].startedAt=clock-3600000;sm.originalDeparture=s.explorers[0].startedAt;${oldAdoption}`));
    await settle('adopt one hour old trip');const trip=await evaluate(`${state}.campaign.trips.find(t=>t.id===194)`);
    assert.equal(trip.hours,2);assert.equal(await evaluate('sm.calls.some(a=>a.type==="explore_recall")'),false);
    await evaluate(`clock=sm.originalDeparture+2*3600000+1000;sm.view.state.lastSettledAt=clock;sm.view.drops.minMinutes=360;`);
    await reloadCampaign();await settle('original two hour deadline remains');
    assert.equal(await evaluate('sm.calls.filter(a=>a.type==="explore_recall").length'),1);
    assert.deepEqual(await evaluate(`${state}.campaign.trips.find(t=>t.id===194)`),trip);
  });
  for(const protectedKind of ['original','returning','rules'])await t.test(`接管时长浏览器：${protectedKind}不改写旧行程或提前召回`,async()=>{
    const extra=protectedKind==='original'?`{const journal=${state};delete journal.campaign.trips[0].source;
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(journal));}`:
      protectedKind==='returning'?`s.explorers[0].recalledAt=clock-1000;s.explorers[0].returnAt=clock+3600000;`:
      `sm.view.drops.enabled=false;`;
    await setupShelter(adoptionScene(oldAdoption+extra));await settle('protected adoption '+protectedKind);
    assert.equal(await evaluate(`${state}.campaign.trips.find(t=>t.id===194).hours`),6);
    assert.equal(await evaluate('sm.calls.some(a=>a.type==="explore_recall")'),false);
  });
  await t.test('接管时长浏览器：原出发成功凭据优先于新两小时规则和旧接管标记',async()=>{
    await setupShelter(scene({explore:true}));await settle('six hour original departure');
    const original=await evaluate(`${state}.campaign.trips[0]`);
    await evaluate(`{const journal=${state};journal.campaign.trips[0].source='existing-state';
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(journal));}
      sm.view.drops.minMinutes=120;clock+=3*3600000;sm.view.state.lastSettledAt=clock;`);
    await reloadCampaign();await settle('recover proven original duration');
    const restored=await evaluate(`${state}.campaign.trips[0]`);
    assert.equal(restored.hours,6);assert.equal(restored.source,undefined);assert.equal(restored.startedAt,original.startedAt);
    assert.equal(await evaluate('sm.calls.filter(a=>a.type==="explore_recall").length'),0);
  });
  await t.test('接管时长浏览器：召回结果未知跨刷新保留原单，不重复发送',async()=>{
    await setupShelter(adoptionScene(oldAdoption+`sm.mode='unknown';`));
    await drive('sm.calls.some(a=>a.type==="explore_recall")','unknown adoption recall',65);
    const original=await evaluate(pending);assert.ok(original?.id);
    await reloadCampaign();for(let i=0;i<12;i++)await pulse();
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.equal(await evaluate('sm.calls.filter(a=>a.type==="explore_recall").length'),1);
    assert.equal(await evaluate(`${state}.campaign.trips[0].hours`),2);
  });
  await t.test('接管时长浏览器：迁移写入失败保留旧账本，不按未保存的新期限召回',async()=>{
    await setupShelter(adoptionScene(oldAdoption+`
      const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
        if(k==='arkengine:auto-shelter:schedule:v1'&&JSON.parse(v)?.campaign?.trips?.some(t=>t.durationPolicy===1))throw Error('fixture trip save failed');
        return originalSet.call(this,k,v);};`));
    await settle('failed migration remains uncommitted');
    assert.equal(await evaluate(`${state}.campaign.trips[0].hours`),6);
    assert.equal(await evaluate(`${state}.campaign.trips[0].durationPolicy`),undefined);
    assert.equal(await evaluate('sm.calls.some(a=>a.type==="explore_recall")'),false);
  });
  await t.test('行程恢复浏览器：成功日志恢复丢失账本，刷新后只召回原探险一次',async()=>{
    await setupShelter(scene({explore:true}));await settle('original trip confirmed');
    const original=await evaluate(`${state}.campaign.trips[0]`);
    await evaluate(`const journal=${state};journal.campaign.trips=[];localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(journal));`);
    // This case isolates trip recovery. Advance the service settlement as well as the clock;
    // leaving an old settlement here advertises six hours of crops the static fixture never produced.
    await evaluate(`clock+=6*3600000+1000;sm.view.state.lastSettledAt=clock;sm.view.state.rooms.forEach(r=>r.stored=0);`);
    await reloadCampaign();await settle('lost trip recovered and recalled');
    assert.deepEqual(await evaluate('sm.calls.map(a=>a.type)'),['explore_start','explore_recall'],JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.campaign.trips[0].id`),original.id);assert.equal(await evaluate(`${state}.campaign.trips[0].hours`),6);
    await reloadCampaign();await settle('confirmed recall not replayed');assert.equal(await evaluate('sm.calls.length'),2);
  });
  await t.test('行程恢复浏览器：其他岗位确认的快照缺少探险，不能清除原行程',async()=>{
    await setupShelter(scene({explore:true}));await settle('trip before transient snapshot');const original=await evaluate(`${state}.campaign.trips[0]`);
    await evaluate(`sm.savedExplorers=structuredClone(sm.view.state.explorers);sm.view.state.explorers=[];
      const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.explore=false;cfg.training=true;cfg.trainTarget=10;localStorage.setItem('${key}',JSON.stringify(cfg));
      sm.view.state.rooms.push({...sm.view.state.rooms[0],id:90,type:'training',trainStat:'agi',floor:2,col:4,level:1});
      ${panel}.getElementById('shelter-check').click();`);
    await drive(`sm.calls.some(a=>a.type==='assign')`,'training despite incomplete explorer list');await settle('training confirmation keeps trip');
    assert.equal(await evaluate(`${state}.campaign.trips[0].id`),original.id);
  });
  const recoveryScene=(extra='')=>scene({defense:true},`
    s.rooms.push({id:90,type:'door',floor:1,col:0,width:1,level:1,builtAt:0,upgradeAt:null,stored:0,unpowered:false,incident:null});
    s.residents.find(p=>p.id===5).roomId=90;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'战后恢复场',vaultNo:77,
      campaign:{roles:[],trips:[],attempts:[],heals:[],trainingRest:[],defenseManual:[],defense:[{id:5,room:90,from:999,at:clock-600000}]}}));${extra}`);
  await t.test('战后重新就业：原岗消失后直接到回收空岗，刷新不重复原恢复动作',async()=>{
    await setupShelter(recoveryScene());await settle('recover from missing original job');
    assert.ok(await evaluate('sm.calls.some(c=>c.type==="assign"&&c.residentId===5&&c.roomId===4)'),JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.campaign.defense.length`),0);
    const before=await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).length');
    await reloadCampaign();await settle('recovered role survives refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).length'),before);
  });
  await t.test('战后重新就业：缺水时实际补水，回执保留供给变化原因',async()=>{
    await setupShelter(recoveryScene('s.residents.find(p=>p.id===3).roomId=4;'));
    await drive(`sm.view.state.residents.find(p=>p.id===5).roomId===3&&!${pending}`,'actual water recovery');
    const calls=await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5)');assert.equal(calls[0].roomId,3);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-campaign-confirmed'&&e.data?.recovery)`);
    assert.ok(events.some(e=>e.data.recovery.destination===3&&e.data.recovery.productionBefore.water===0&&e.data.recovery.productionAfter.water>0));
  });
  await t.test('战后重新就业：打开详情后目标停电，原调岗取消不发送',async()=>{
    await setupShelter(recoveryScene('sm.quickAssign=false;'));
    await drive('!!document.querySelector("[role=dialog]")','open recovery resident detail');
    await evaluate('sm.view.state.rooms.find(r=>r.id===4).unpowered=true;');
    await settle('fresh snapshot cancels stale recovery target');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5&&c.roomId===4).length'),0);
  });
  await t.test('战后重新就业：回执未知跨刷新保留原单和恢复记录，不重复调人',async()=>{
    await setupShelter(recoveryScene('sm.assignUnknown=true;'));
    await drive('sm.calls.some(c=>c.type==="assign"&&c.residentId===5)','unknown recovery request');
    await reloadShelter();await drive(`${done}&&${pending}!==null&&${state}.pendingReadOnly===${pending}.id`,'unknown recovery isolated after reload');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).length'),1);
    assert.deepEqual(await evaluate(`${pending}.targets`),[5,4]);
    assert.ok(await evaluate(`${state}.campaign.defense.some(d=>d.id===5&&d.from===999)`));
  });
  await t.test('战后重新就业：当前生产岗已合适，仅核销防守记录且不重复入岗',async()=>{
    await setupShelter(recoveryScene(`s.residents.find(p=>p.id===5).roomId=4;
      const saved=JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'));
      saved.campaign.defense[0].room=4;localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(saved));`));
    await settle('retire already productive recovery');
    assert.equal(await evaluate(`${state}.campaign.defense.length`),0);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).length'),0);
  });
  const raidScene=scene({defense:true},`s.rooms.push({id:90,type:'door',floor:1,col:0,width:1,level:1,builtAt:0,upgradeAt:null,stored:0,unpowered:false,incident:{kind:'raiders',hp:80,maxHp:80}});`);
  const raidUpkeep=(extra='')=>raidScene+`for(const p of s.residents)p.roomId=90;
    const flags=JSON.parse(localStorage.getItem('${key}'));flags.explore=true;flags.dailyGoals=true;localStorage.setItem('${key}',JSON.stringify(flags));
    s.residents[5].roomId=null;s.residents[5].away={kind:'explore'};
    s.explorers=[{id:81,residentId:6,tier:0,abyss:false,startedAt:clock-6*3600000,recalledAt:null,returnAt:null,stimpaks:0,loot:{scrap:50,parts:0,stimpak:0,items:[]}}];
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'fixture',
      campaign:{roles:[],trips:[{id:81,resident:6,at:clock-6*3600000,hours:6}],attempts:[],heals:[],trainingRest:[]}}));${extra}`;
  await t.test('防守收尾浏览器：事件仍在时实际召回低血量探险，刷新不重发且守军不动',async()=>{
    await setupShelter(raidUpkeep('s.residents[5].hp=20;'));
    await settle('recall during active raid');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_recall']);
    assert.equal(await evaluate('sm.view.state.rooms.find(r=>r.id===90).incident.kind'),'raiders');
    assert.ok(await evaluate('sm.view.state.residents.slice(0,5).every(p=>p.roomId===90)'));
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('raid recall survives refresh');
    assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('防守收尾浏览器：驻守期间收满批产物和已完成日目标，不开工或调走守军',async()=>{
    await setupShelter(raidUpkeep(`${construction}s.explorers[0].recalledAt=clock-1;s.explorers[0].returnAt=clock+3600000;
      s.rooms.find(r=>r.id===4).stored=135;sm.dailyGoalRows=true;
      s.daily.picks=[['build',1],['win',5],['collect_scrap',600]].map(([key,target])=>({key,target,reward:{scrap:240,parts:2,points:30}}));
      s.daily.counters={build:1,win:0,collect_scrap:0};`));
    await settle('collect and daily claim while guarding');
    const calls=await evaluate('sm.calls');assert.ok(calls.some(c=>['collect','collect_all'].includes(c.type)));
    assert.equal(calls.filter(c=>c.type==='claim_objective').length,1);
    assert.ok(calls.every(c=>['collect','collect_all','claim_objective'].includes(c.type)));
    assert.ok(await evaluate('sm.view.state.residents.slice(0,5).every(p=>p.roomId===90)'));
    await reloadCampaign();await settle('guarding claims not replayed');
    assert.equal(await evaluate('sm.calls.length'),calls.length);
  });
  await t.test('防守收尾浏览器：领取已归来探险后重新评估增援，不派新探险',async()=>{
    await setupShelter(raidUpkeep(`s.explorers[0].recalledAt=clock-3*3600000;s.explorers[0].returnAt=clock-1;
      localStorage.setItem('arkengine:auto-shelter:explore-claim:v1','true');`));
    await settle('returned traveler claimed then reinforces');
    const calls=await evaluate('sm.calls');assert.equal(calls[0].type,'explore_claim');
    assert.equal(calls.filter(c=>c.type==='explore_claim').length,1);
    assert.ok(calls.some(c=>c.type==='rescue_incident'&&c.roomId===90));assert.equal(await evaluate('sm.view.state.residents.find(person=>person.id===6).roomId'),90);
    assert.ok(calls.every(c=>['explore_claim','rescue_incident'].includes(c.type)));
  });
  await t.test('防守收尾浏览器：召回确认前出现新增援需求，先取消未发送召回再增援',async()=>{
    await setupShelter(raidUpkeep());
    await drive(`Boolean(document.querySelector('[role="dialog"],[role="alertdialog"]'))`,'raid recall confirmation');
    await evaluate('sm.view.state.residents[0].roomId=1;');await pulse(2000);
    await drive('sm.calls.length>0','new defense preempts unsubmitted recall');
    assert.equal(await evaluate('sm.calls[0].type'),'rescue_incident');assert.equal(await evaluate('sm.calls[0].roomId'),90);
    await settle('recall continues after defense confirmed');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="explore_recall").length'),1);
  });
  await t.test('防守收尾浏览器：归来小队实际领取后增援，刷新不重复且不派新队',async()=>{
    await setupShelter(raidUpkeep(`flags.explore=false;flags.quests=true;localStorage.setItem('${key}',JSON.stringify(flags));
      s.residents[5].away={kind:'quest'};s.explorers=[];
      s.quests=[{id:91,questId:'w1',team:[6],status:'returning',returnAt:clock-1,snapshot:structuredClone(sm.view.env.quests[0])}];`));
    await settle('returned quest claimed during raid');
    const calls=await evaluate('sm.calls');assert.equal(calls[0].type,'quest_claim');
    assert.ok(calls.some(c=>c.type==='rescue_incident'&&c.roomId===90));assert.equal(await evaluate('sm.view.state.residents.find(person=>person.id===6).roomId'),90);
    assert.ok(calls.every(c=>['quest_claim','rescue_incident'].includes(c.type)));
    await reloadCampaign();await settle('returned quest receipt survives reload');
    assert.equal(await evaluate('sm.calls.length'),calls.length);
  });
  await t.test('防守收尾浏览器：召回确认前关闭探险或人工接手均不提交',async()=>{
    for(const mode of ['disabled','manual']){
      await setupShelter(raidUpkeep());
      await drive(`Boolean(document.querySelector('[role="dialog"],[role="alertdialog"]'))`,'recall before owner override');
      if(mode==='manual')await trustedStaffKey('Escape');
      else await evaluate(`const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.explore=false;localStorage.setItem('${key}',JSON.stringify(cfg));`);
      await pulse(10000);
      assert.deepEqual(await evaluate('sm.calls'),[],mode);
      assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('防守收尾浏览器：未知召回保留原单，刷新后不重复或穿插收取',async()=>{
    await setupShelter(raidUpkeep('sm.mode="unknown";s.rooms.find(r=>r.id===4).stored=135;'));
    await drive('sm.calls.length>0','unknown raid recall submitted');
    await pulse(31000);await settle('unknown raid recall remains pending');
    const original=await evaluate(pending);assert.equal(original.kind,'explore-recall');
    await reloadCampaign();await settle('unknown raid recall after reload');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_recall']);
    assert.equal(await evaluate(`${pending}.id`),original.id);
  });
  const fireScene=scene({defense:true},`s.rooms.find(r=>r.id===3).incident={kind:'fire',hp:9.4,maxHp:19};
    s.residents[4].roomId=4;s.residents[5].roomId=3;`);
  await t.test('停产事件：净水火灾原生增援一次，刷新保留原岗，结束后回收复产',async()=>{
    await setupShelter(fireScene);await settle('fire rescue dispatched');
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.residentId,c.roomId])'),[['assign',4,3]]);
    assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate(`${state}.campaign.defense[0].from`),4);
    await reloadCampaign();await settle('fire rescuers not duplicated after reload');
    assert.equal(await evaluate('sm.calls.length'),1);
    assert.ok(await evaluate('sm.view.state.rooms.find(r=>r.id===3).incident!==null'),'dispatch is not a fabricated event completion');
    await evaluate(`sm.view.state.rooms.find(r=>r.id===3).incident=null;${panel}.getElementById('shelter-check').click();`);
    await settle('observed fire end restores original production post');
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.residentId,c.roomId])'),[['assign',4,3],['assign',4,4]]);
    assert.equal(await evaluate(`${state}.campaign.defense.length`),0);assert.equal(await evaluate(pending),null);
    assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>
      e.type==='shelter-check'&&e.data.production.water>0&&e.data.production.scrap>0)`));
  });
  await t.test('停产事件：三人在场期间仍领取物资，不重复增援或占住远征',async()=>{
    await setupShelter(fireScene+`s.residents[3].roomId=3;s.rooms.find(r=>r.id===4).stored=63;`);
    await settle('staffed incident allows independent collection');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    await pulse(31000);await pulse(1000);
    assert.equal(await evaluate('location.pathname'),'/activities/expedition');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
  });
  await t.test('停产事件：未知增援跨刷新只读保留，不重复调岗',async()=>{
    await setupShelter(fireScene+`sm.mode='unknown';`);await drive('sm.calls.length===1','unknown fire assignment');
    const first=await evaluate(pending);await reloadCampaign();await settle('unknown fire assignment remains pending');
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`${pending}.id`),first.id);
    assert.equal(await evaluate(`${state}.pendingReadOnly`),first.id);
  });
  await t.test('停产事件：人工调走增援者后保留人工岗位，不自动拉回',async()=>{
    await setupShelter(fireScene);
    await drive(`(${state}?.campaign?.defense?.length||0)>0&&!${pending}`,'fire responder confirmed before takeover');
    await evaluate(`(async()=>{await shelterAct({type:'assign',residentId:4,roomId:4});})()`);
    assert.ok(!(await evaluate(`${state}.campaign.defense`)).some(r=>r.id===4));
    await settle('manual assignment before reload');
    await reloadCampaign();await settle('manual responder remains at chosen post');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===4&&c.roomId===3).length'),1);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===4).roomId'),4);
  });
  await t.test('停产事件：远征页巡检发现可增援火灾时自动返回避难所',async()=>{
    await setupShelter(fireScene+`localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:clock+900000,note:'normal future visit'}));`, '/activities/expedition');
    await drive('sm.calls.some(c=>c.type==="rescue_incident"&&c.roomId===3)','patrol wakes for local incident',35);
  });
  await t.test('停产事件：远征页巡检发现事件结束后提前返岗',async()=>{
    await setupShelter(fireScene);await settle('rescuer waiting for actual incident end');
    await evaluate(`sm.view.state.rooms.find(r=>r.id===3).incident=null;
      const saved=${state};saved.nextAt=clock+900000;localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(saved));`);
    await drive('sm.calls.some(c=>c.type==="assign"&&c.residentId===4&&c.roomId===4)','patrol restores original post',40);
    await settle('restored production after patrol');
    assert.equal(await evaluate(`${state}.campaign.defense.length`),0);
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.residentId,c.roomId])'),[['assign',4,3],['assign',4,4]]);
  });
  await t.test('停产事件：提交前事件消失或关闭增援时撤销未发送调岗',async()=>{
    for(const mode of ['ended','disabled']){
      await setupShelter(fireScene+'sm.quickAssign=false;');
      await drive(`!!document.querySelector('[data-staff-dialog]')`,'incident assignment before '+mode);
      await evaluate(mode==='ended'?`sm.view.state.rooms.find(r=>r.id===3).incident=null;`:
        `const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.defense=false;localStorage.setItem('${key}',JSON.stringify(cfg));`);
      await settle('cancel unsent incident assignment '+mode);
      assert.deepEqual(await evaluate('sm.calls'),[],mode);
      assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===4).roomId'),4);
    }
  });
  const medicalRaid=raidScene+`const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.medical=true;localStorage.setItem('${key}',JSON.stringify(cfg));`;
  await t.test('防守医疗浏览器：先救受袭房内重伤者，实际用针后增援，刷新受伤不突破半小时限制',async()=>{
    await setupShelter(medicalRaid+`Object.assign(s.residents[0],{roomId:90,hp:30});s.residents[1].hp=10;`);
    const start=await evaluate('clock');
    await drive('sm.calls.length>0','critical defender treated promptly',12);
    assert.equal(await evaluate('sm.calls[0].type'),'stimpak');assert.equal(await evaluate('sm.calls[0].residentId'),1);
    assert.ok(await evaluate(`clock-${start}<=5000`),'紧急治疗不累加普通随机等待');
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.roomId===90)&&${state}.campaign.heals.some(h=>h.id===1)`,'reinforcements follow verified healing',50);
    const heal=await evaluate(`${state}.campaign.heals.find(h=>h.id===1)`);
    await evaluate('sm.view.state.residents[0].hp=30;');await reloadCampaign();
    await settle('new wound remains within per-resident treatment limit');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='stimpak'&&c.residentId===1).length`),1);
    assert.deepEqual(await evaluate(`${state}.campaign.heals.find(h=>h.id===1)`),heal);
    assert.ok(await evaluate('sm.view.state.resources.stimpak>=2'));
    assert.ok(await evaluate(`sm.calls.every(c=>c.type==='assign'||c.type==='stimpak')`));
  });
  await t.test('防守医疗浏览器：没有七成血量的增援时先治一人，按实际回血后再派往受袭房',async()=>{
    await setupShelter(medicalRaid+`for(const p of s.residents)p.hp=60;`);
    await drive('sm.calls.length>=2','healed adult becomes eligible to reinforce',30);
    const calls=await evaluate('sm.calls');assert.equal(calls[0].type,'stimpak');
    assert.equal(calls[1].type,'assign');assert.equal(calls[1].roomId,90);assert.equal(calls[1].residentId,calls[0].residentId);
    assert.ok(await evaluate(`sm.view.state.residents.find(p=>p.id===${calls[0].residentId}).hp>60`));
  });
  await t.test('防守医疗浏览器：治疗窗口打开后关闭医疗，不发送用针而继续现有健康增援',async()=>{
    await setupShelter(medicalRaid+`Object.assign(s.residents[0],{roomId:90,hp:30});`);
    await drive(`!!document.querySelector('[data-staff-dialog]')`,'emergency healing dialog before setting changes',12);
    await evaluate(`{const changed=JSON.parse(localStorage.getItem('${key}'));changed.medical=false;localStorage.setItem('${key}',JSON.stringify(changed));}`);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.roomId===90)`,'healthy reinforcements after medical disabled',50);
    assert.ok(await evaluate(`sm.calls.every(c=>c.type!=='stimpak')`));
    assert.equal(await evaluate('sm.view.state.resources.stimpak'),9);
  });
  await t.test('紧急防守时序：已返程探险等待领取时仍先增援，首次提交不累计普通随机等待',async()=>{
    await setupShelter(raidScene+`localStorage.setItem('arkengine:auto-shelter:explore-claim:v1','true');
      s.residents[5].away={kind:'explore'};s.residents[5].roomId=null;
      s.explorers=[{id:11,residentId:6,startedAt:clock-3600000,returnAt:clock-1,tier:0,abyss:false,
        stimpaks:0,loot:{scrap:50,parts:0,stimpak:0,items:[]}}];`);
    const start=await evaluate('clock');
    await drive('sm.calls.length>0','first emergency response',12);
    assert.equal(await evaluate('sm.calls[0].type'),'rescue_incident');
    assert.equal(await evaluate('sm.calls[0].roomId'),90);
    assert.ok(await evaluate(`clock-${start}<=5000`),'首次增援应在新鲜快照后的五秒内提交');
  });
  await t.test('避难所读取恢复：短暂断网和服务端错误有限重读，保留原功能开关',async()=>{
    for(const error of ['sm.readError=true;','sm.httpStatus=503;']){
      await setupShelter(scene({},error));
      await drive('sm.reads>0','first failed read');
      await evaluate('sm.readError=false;sm.httpStatus=200;');
      await drive('sm.reads>=2','retry read without fifteen-minute wait',15);
      await settle('recovered shelter read');
      assert.equal(await evaluate("localStorage.getItem('arkengine:auto-shelter:enabled:v1')"),'true');
    }
  });
  await t.test('防守浏览器：零库存超员集结，短间隔自动追击，不需手动检查',async()=>{
    await setupShelter(raidScene+`s.residents=s.residents.filter(p=>p.id>=4);s.resources.power=0;s.resources.food=0;s.resources.water=0;`);
    await settle('zero stock defenders gathered');
    assert.equal(await evaluate(`sm.view.state.residents.filter(p=>p.roomId===90).length`),3);
    const remaining=await evaluate(`${state}.nextAt-clock`);assert.ok(remaining>0&&remaining<=7000);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===90).incident=null;sm.view.state.rooms[0].incident={kind:'raiders',hp:60,maxHp:80};`);
    await pulse(remaining+1000);await drive(`sm.view.state.residents.every(p=>p.roomId===1)`,'automatic incident pursuit');
    assert.ok(await evaluate(`sm.calls.filter(a=>a.type==='assign'&&a.roomId===1).length===3`));
    await evaluate(`sm.view.state.rooms[0].incident=null;sm.view.state.rooms.find(r=>r.id===6).incident={kind:'raiders',hp:20,maxHp:80};`);
    await drive(`sm.view.state.residents.every(p=>p.roomId===6)`,'pursuit into storage despite ordinary zero jobs');
  });
  await t.test('防守浏览器：关闭防守取消尚未发送的增援，保持原岗位',async()=>{
    await setupShelter(raidScene+'sm.quickAssign=false;');await drive(`!!document.querySelector('[data-staff-dialog]')`,'defender dialog before pause');
    await evaluate(`const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.defense=false;localStorage.setItem('${key}',JSON.stringify(cfg));`);
    await settle('defense disabled');assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('防守浏览器：增援、入室追击、刷新后战后复岗保留最初岗位',async()=>{
    await setupShelter(raidScene);await settle('defenders dispatched');
    const original=await evaluate(`${state}.campaign.defense`);assert.ok(original.length>0);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===90).incident=null;sm.view.state.rooms[0].incident={kind:'raiders',hp:60,maxHp:80};
      ${panel}.getElementById('shelter-check').click();`);await settle('chase moved raiders');
    const chase=await evaluate(`${state}.campaign.defense`);assert.ok(chase.some(r=>r.room===1),JSON.stringify(await diagnose()));
    for(const r of original)assert.equal(chase.find(x=>x.id===r.id)?.from,r.from);
    await reloadCampaign();await evaluate(`sm.view.state.rooms[0].incident=null;${panel}.getElementById('shelter-check').click();`);
    await settle('return to original jobs');
    for(const r of original)assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${r.id}).roomId`),r.from);
    assert.equal(await evaluate(`${state}.campaign.defense.length`),0);
  });
  await t.test('防守浏览器：人工调走临时防守者后不再追击或自动复岗',async()=>{
    await setupShelter(raidScene);
    await drive(`(${state}?.campaign?.defense?.length||0)>0&&!${pending}`,'first defender confirmed before owner takeover');
    const entry=await evaluate(`${state}.campaign.defense[0]`);
    await evaluate(`(async()=>{await shelterAct({type:'assign',residentId:${entry.id},roomId:5});})()`);
    assert.ok(!(await evaluate(`${state}.campaign.defense`)).some(r=>r.id===entry.id));
    await settle('remaining defenders dispatched');
    await evaluate(`sm.view.state.rooms.find(r=>r.id===90).incident=null;${panel}.getElementById('shelter-check').click();`);await settle('other defenders restored');
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${entry.id}).roomId`),5);
  });
  const workshopScene=scene({},`${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    s.rooms.find(r=>r.id===4).level=2;s.residents[4].roomId=4;s.residents[5].roomId=5;s.resources.parts=0;`);
  await t.test('工坊健康浏览器：成长后血量比例低于90%仍按普通调岗补员，刷新不重复',async()=>{
    await setupShelter(workshopScene+`for(const p of s.residents){p.xp=300;p.stats.end=6;p.hp=100;}
      s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1});`);
    await settle('grown residents staff workshop without invented healing');
    const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop')`);
    assert.ok(workers.length>0,JSON.stringify(await diagnose()));
    assert.ok(workers.every(r=>r.room===90));
    assert.ok(await evaluate('sm.view.state.residents.every(p=>p.hp===100&&p.xp===300)'));
    const count=await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===90).length`);
    assert.equal(count,workers.length);
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('workshop health assignment survives refresh');
    const calls=await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===90)`);
    assert.equal(new Set(calls.map(c=>c.residentId)).size,calls.length,'刷新可填第二空位，但不能重复提交同一居民');
    assert.ok(calls.length>=count&&calls.length<=2);
    for(const call of calls)assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${call.residentId}).roomId`),90);
  });
  await t.test('工坊增员浏览器：未绑定旧值班让位就业后两人供料，刷新不撤补，收齐后正常结束',async()=>{
    await setupShelter(workshopScene+`s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1});
      s.residents.push({...structuredClone(s.residents[4]),id:7,name:'新增成人7',roomId:90});
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'已有工坊值班',
        campaign:{roles:[{id:7,room:90,role:'workshop',at:clock}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`);
    await settle('fill the existing workshop');
    const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop')`);
    assert.equal(workers.length,2,JSON.stringify(await diagnose()));assert.ok(workers.every(r=>r.room===90));
    assert.ok(await evaluate('sm.view.state.residents.some(p=>p.roomId===4)'),'the funded upgrade room retains a producer');
    const calls=await evaluate('sm.calls'),build=calls.findIndex(c=>c.type==='build'&&c.room==='scrap');
    assert.ok(build>0,'先有就业工程，才切换到明确的回收升级备料');
    assert.deepEqual(calls.slice(0,build).map(c=>[c.type,c.residentId,c.roomId]),[['assign',7,null]],
      '没有原工程绑定的旧值班只释放一次');
    assert.deepEqual(calls.slice(build+1).map(c=>[c.type,c.roomId]),[['assign',90],['assign',90]]);
    assert.equal(new Set(calls.slice(build+1).map(c=>c.residentId)).size,2);
    await reloadCampaign();await settle('retain both workers after refresh');
    assert.deepEqual(await evaluate('sm.calls'),calls,'确认备料后刷新不能再撤补工人');
    await evaluate(`sm.view.state.resources.parts=15;${panel}.getElementById('shelter-check').click();`);
    await settle('both shifts finish after actual stock is sufficient');
    const finished=await evaluate('sm.calls'),upgrade=finished.findIndex(c=>c.type==='upgrade'&&c.roomId===4);
    assert.ok(upgrade>=calls.length,'先实际升级，再释放两名备料工人');
    for(const worker of workers){
      assert.equal(finished.slice(upgrade+1).filter(c=>c.type==='assign'&&c.residentId===worker.id&&c.roomId!==90).length,1);
      assert.notEqual(await evaluate(`sm.view.state.residents.find(p=>p.id===${worker.id}).roomId`),90);
    }
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),0);
    assert.equal(await evaluate(`${state}.constructionLedger.filter(r=>r.scrap===480&&r.parts===15).length`),1);
    await reloadCampaign();await settle('finished workshop shifts do not restart across refresh');
    assert.deepEqual(await evaluate('sm.calls'),finished);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('工坊增员浏览器：已有岗位且原升级明确时保留老工人，只补第二岗并提高实际产能',async()=>{
    await setupShelter(workshopScene+`s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1},
      {...s.rooms[0],id:91,type:'scrap',floor:2,col:5,level:3});
      s.residents[5].roomId=91;
      // Fund the original 480 scrap upgrade plus 90 feed, with no spare capital
      // for an independent second workshop expansion after staffing succeeds.
      s.resources.scrap=570;
      s.residents.push({...structuredClone(s.residents[4]),id:7,name:'新增成人7',roomId:90});
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'已有工坊值班和就业岗位',
        campaign:{roles:[{id:7,room:90,role:'workshop',at:clock}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`);
    await chainReport('single workshop worker before reinforcement');
    await settle('existing project receives second workshop worker');
    const calls=await evaluate('sm.calls'),workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop')`);
    assert.equal(workers.length,2);assert.ok(workers.every(r=>r.room===90));
    assert.equal(calls.length,1,JSON.stringify(await diagnose()));assert.equal(calls[0].type,'assign');
    assert.equal(calls[0].roomId,90);assert.notEqual(calls[0].residentId,7);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===7).roomId'),90);
    assert.ok(await evaluate('sm.view.state.residents.some(p=>p.roomId===4)'),'原升级房仍有生产者');
    await reloadCampaign();await settle('reinforced workshop stays stable after refresh');
    assert.deepEqual(await evaluate('sm.calls'),calls);
    await evaluate(`sm.view.state.resources.parts=12;sm.view.state.rooms.find(r=>r.id===90).stored=3;
      ${panel}.getElementById('shelter-check').click();`);
    await settle('reinforced workshop collects and starts original upgrade');
    const finished=await evaluate('sm.calls'),collect=finished.findIndex(c=>c.type==='collect_all'||c.type==='collect'&&c.roomId===90),
      upgrade=finished.findIndex(c=>c.type==='upgrade'&&c.roomId===4);
    assert.ok(collect>0&&upgrade>collect);
    for(const worker of workers)assert.ok(finished.slice(upgrade+1).some(c=>c.type==='assign'&&c.residentId===worker.id&&c.roomId!==90));
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),0);
    assert.equal(await evaluate(`${state}.constructionLedger.filter(r=>r.scrap===480&&r.parts===15).length`),1);
    await reloadCampaign();await settle('reinforced original upgrade survives refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===90).length`),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade'&&c.roomId===4).length`),1);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('工坊整批浏览器：只有未满批零件时继续加工，完整收取后再停工',async()=>{
    await setupShelter(workshopScene+`s.resources.parts=14;s.residents[4].roomId=90;
      s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1,stored:1});
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'fixture',campaign:{
        roles:[{id:5,room:90,role:'workshop',at:clock-1000}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`);
    await settle('unfinished parts keep worker');assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),90);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===90).stored=3;${panel}.getElementById('shelter-check').click();`);
    await settle('completed parts collected');
    const collected=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-confirmed'&&e.data.kind==='collect')`);
    assert.ok(collected.some(e=>e.data.resources.parts>=15),'先确认零件到账，之后才允许升级消耗它们');
    assert.ok(await evaluate(`sm.calls.some(a=>a.type==='assign'&&a.residentId===5&&a.roomId===null)`));
  });
  await t.test('工坊资金浏览器：为升级本金保留废料，不在攒建设资金时提前耗料',async()=>{
    await setupShelter(workshopScene+`s.resources.scrap=480;s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1});`);
    await settle('upgrade principal preserved');
    assert.ok(!await evaluate(`sm.calls.some(a=>a.type==='assign'&&a.roomId===90)`));
    assert.match(await evaluate(`${state}.campaignNote`),/建设资金/);
    await evaluate(`sm.view.state.resources.scrap=1100;${panel}.getElementById('shelter-check').click();`);
    await settle('principal and feed funded');assert.ok(await evaluate(`sm.calls.some(a=>a.type==='assign'&&a.roomId===90)`));
  });
  await t.test('防守浏览器：建造窗口尚未提交时出现掠夺者，关闭窗口优先增援',async()=>{
    await setupShelter(workshopScene+`const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.defense=true;localStorage.setItem('${key}',JSON.stringify(cfg));
      s.rooms.push({id:90,type:'door',floor:1,col:0,width:1,level:1,builtAt:0,upgradeAt:null,stored:0,unpowered:false,incident:null});`);
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'construction dialog before raid');
    await evaluate(`sm.view.state.rooms.find(r=>r.id===90).incident={kind:'raiders',hp:80,maxHp:80};`);await pulse(11000);
    await drive(`sm.calls.some(a=>a.type==='assign'&&a.roomId===90)`,'defense replaces unsubmitted construction');
    assert.ok(!await evaluate(`sm.calls.some(a=>['build','upgrade','dig'].includes(a.type))`));
    assert.equal(await evaluate(`!!document.querySelector('[data-construction-dialog]')`),false);
  });
  await t.test('工坊库存浏览器：建设关闭仍补100，刷新不重复，达标返岗并在消耗后补充',async()=>{
    await setupShelter(workshopScene+`s.resources.parts=44;s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1});
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:false,upgrade:false,dig:false,budgetMode:'daily',scrapLimit:0,partsLimit:0,scrapReserve:100,partsReserve:0}));`);
    await settle('workshop staffed');const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop')`);
    assert.equal(workers.length,2,JSON.stringify(await diagnose()));assert.ok(workers.every(r=>r.room===90));
    await reloadCampaign();await settle('workshop role survives reload');
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='assign'&&a.roomId===90).length`),2);
    for(const worker of workers)assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='assign'&&a.residentId===${worker.id}&&a.roomId===90).length`),1);
    await evaluate(`sm.view.state.resources.parts=100;${panel}.getElementById('shelter-check').click();`);
    await settle('materials ready release workshop');
    for(const worker of workers)assert.notEqual(await evaluate(`sm.view.state.residents.find(person=>person.id===${worker.id}).roomId`),90);
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),0);
    assert.ok(!await evaluate(`sm.calls.some(action=>['build','upgrade','dig'].includes(action.type))`));
    const calls=await evaluate('sm.calls.length');await reloadCampaign();await settle('full stock remains stable');
    assert.equal(await evaluate('sm.calls.length'),calls);
    await evaluate(`sm.view.state.resources.parts=44;${panel}.getElementById('shelter-check').click();`);await settle('consumed parts restocked');
    assert.ok(await evaluate(`${state}.campaign.roles.some(role=>role.role==='workshop')`));
  });
  await t.test('工坊库存浏览器：缺件时保护90%训练，供料低于保留量不调人',async()=>{
    for(const reason of ['training','scrap']){
      await setupShelter(workshopScene+`s.resources.parts=44;s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1});
        localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:false,upgrade:false,dig:false,budgetMode:'daily',scrapLimit:0,partsLimit:0,scrapReserve:100,partsReserve:0}));
        ${reason==='scrap'?'s.resources.scrap=100;':`const config=JSON.parse(localStorage.getItem('${key}'));config.training=true;localStorage.setItem('${key}',JSON.stringify(config));
          s.rooms.push({...s.rooms[0],id:91,type:'training',trainStat:'end',floor:3,col:2,level:1});
          s.rooms.find(room=>room.id===4).width=2;
          const person=s.residents.find(person=>person.id===5);Object.assign(person,{roomId:91,training:.9,xp:0,hp:100});person.stats.end=5;`}`);
      await settle('stock protection '+reason);
      if(reason==='training'){
        assert.ok(!await evaluate(`sm.calls.some(action=>action.type==='assign'&&action.residentId===5)`));
        assert.ok(await evaluate('sm.view.state.residents.find(person=>person.id===5).roomId===91&&sm.view.state.residents.find(person=>person.id===5).training===.9'));
      }else assert.ok(!await evaluate(`sm.calls.some(action=>action.type==='assign'&&action.roomId===90)`));
      assert.equal(await evaluate(pending),null);
      assert.equal(await evaluate(`!!document.querySelector('[role="alertdialog"]')`),false);
    }
  });
  await t.test('工坊闭环浏览器：无工坊先建造，完工到岗，供料不足停工且人工接手进入冷却',async()=>{
    await setupShelter(workshopScene);await settle('workshop construction');
    // 当前阶段先给闲置成人建回收岗位；一次访问只开工一项，下一次再接续工坊。
    if(!await evaluate(`sm.calls.some(a=>a.type==='build'&&a.room==='workshop')`)){
      assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='build'&&a.room==='scrap').length`),1);
      await reloadCampaign();await settle('workshop follows the backed employment project');
    }
    assert.ok(await evaluate(`sm.calls.some(a=>a.type==='build'&&a.room==='workshop')`),JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='build'&&a.room==='workshop').length`),1);
    const room=await evaluate(`sm.view.state.rooms.find(r=>r.type==='workshop').id`);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===${room}).builtAt=clock-1;${panel}.getElementById('shelter-check').click();`);
    await settle('new workshop staffed');const worker=await evaluate(`${state}.campaign.roles.find(r=>r.role==='workshop')`);
    assert.ok(worker,JSON.stringify(await diagnose()));
    await evaluate(`sm.view.state.resources.scrap=0;${panel}.getElementById('shelter-check').click();`);await settle('insufficient feed releases workshop');
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),0);
    await reloadCampaign();await evaluate(`document.activeElement?.blur();`);
    await trustedStaffKey();
    await evaluate(`(async()=>{await shelterAct({type:'assign',residentId:${worker.id},roomId:${room}});})()`);
    const count=await evaluate('sm.calls.length');await pulse(30000);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${worker.id}).roomId`),room);
    assert.equal(await evaluate('sm.calls.length'),count);
    assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>e.type==='shelter-user-interaction')`));
  });
  await t.test('工坊闭环浏览器：零建设额度仍补100库存，不绕过建设额度',async()=>{
    for(const limit of [0,100]){
      await setupShelter(workshopScene+`s.resources.parts=15;
        s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1});
        const cfg=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));cfg.partsReserve=10;cfg.partsLimit=${limit};
        localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(cfg));`);
      await settle('parts reserve with budget '+limit);
      const calls=await evaluate(`sm.calls.filter(a=>a.type==='assign'&&a.roomId===90)`);
      assert.equal(calls.length,2,JSON.stringify(await diagnose()));
      assert.equal(new Set(calls.map(c=>c.residentId)).size,calls.length,'每名工人仅调入一次');
      if(limit===0)assert.ok(!await evaluate(`sm.calls.some(action=>['build','upgrade','dig'].includes(action.type))`));
    }
  });
  await t.test('等级规划浏览器：工坊锁级时先升级有产出的房间，原预算仍限制开工',async()=>{
    for(const limit of [100,10000]){
      await setupShelter(`sm.view=${JSON.stringify(levelGateView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
        sm.view.state.residents[14].roomId=4;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
        localStorage.setItem('${key}',JSON.stringify(${JSON.stringify(defaults)}));
        ${construction}const cfg=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));cfg.scrapLimit=${limit};localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(cfg));`);
      await settle('level gate construction budget '+limit);
      const calls=await evaluate(`sm.calls.filter(a=>a.type==='upgrade'||a.type==='build'||a.type==='dig')`);
      if(limit===100)assert.equal(calls.length,0);else {assert.equal(calls.length,1);assert.equal(calls[0].type,'upgrade');}
      assert.doesNotMatch(await evaluate(`${state}.campaignNote`),/近期备料目标还需/,'当前先升级无零件成本的房间，不为后续回收升级预留工坊');
    }
  });
  const sodaReturn=`sm.view.drops.perUserDaily=1;s.residents[4].away={kind:'explore'};
    s.explorers=[{id:101,residentId:5,tier:0,abyss:false,startedAt:clock-9*3600000,recalledAt:clock-3*3600000,returnAt:clock-1,
      stimpaks:0,loot:{scrap:0,parts:0,stimpak:0,items:[]}}];
    const sodaFetch=window.fetch;window.fetch=async(u,o)=>{const response=await sodaFetch(u,o);
      if(u==='/api/shelter/action'&&JSON.parse(o.body).action.type==='explore_claim'){
        const body=await response.json();body.result.sodaDropped=sm.sodaAmount;return new Response(JSON.stringify(body),{status:response.status});}
      return response;};`;
  await t.test('汽水额度浏览器：领取达额仍新派，刷新和重复原记录不多计也不重复派遣',async()=>{
    await setupShelter(scene({explore:true,sodaEfficiency:true},`${sodaReturn}sm.sodaAmount=1;
      const save=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
        const result=save.call(this,k,v);
        if(k==='arkengine:auto-shelter:pending:v1'){const record=JSON.parse(v);if(record?.result?.sodaProof)sm.savedSodaPending=record;}
        return result;};`));
    // Confirmation may complete within the same event turn. Capture the actual
    // persisted proof without delaying its response or requiring it to stay pending.
    await settle('soda history permits new trips');assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_claim','explore_start']);
    const original=await evaluate('sm.savedSodaPending');assert.equal(original.result.sodaProof.amount,1);
    // 模拟器按当前列表分配新ID；旧领取与新行程须不同，避免把旧探险仍在列表的保护误作重复账本。
    assert.notEqual(await evaluate('sm.view.state.explorers[0].id'),original.targets[0]);
    assert.equal(await evaluate(`${state}.sodaReceipts[0].amount`),1);assert.match(await evaluate(`${state}.campaignNote`),/仅作提示/);
    await evaluate(`localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(${JSON.stringify(original)}));`);
    await reloadCampaign();await settle('duplicate receipt after refresh');
    assert.equal(await evaluate(`${state}.sodaReceipts.length`),1);assert.equal(await evaluate('sm.calls.length'),2);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const check=events.filter(e=>e.type==='shelter-check').at(-1);
    assert.equal(check.data.sodaRules.perUserDaily,1);assert.equal(check.data.sodaQuota.observed,1);
    assert.equal(check.data.sodaQuota.blocked,false);assert.equal(check.data.sodaQuota.resumeAt,null);
    assert.equal(events.filter(e=>e.type==='shelter-soda-receipt').length,1);
    assert.doesNotMatch(JSON.stringify(events.filter(e=>e.type==='shelter-soda-receipt')),/fixture-key|idempotencyKey/);
    await evaluate(`sm.view.state.daily.day='2026-10-11';${panel}.getElementById('shelter-check').click();`);
    await settle('calendar change is not verified soda reset');assert.equal(await evaluate('sm.calls.length'),2);
    assert.match(await evaluate(`${state}.campaignNote`),/近24小时已确认 1 瓶/);
  });
  await t.test('汽水额度浏览器：明确零掉落和缺失回执均不算达额，缺失数量单独记录',async()=>{
    for(const amount of ['0','undefined','1.5']){
      await setupShelter(scene({explore:true,sodaEfficiency:true},`${sodaReturn}sm.sodaAmount=${amount};`));
      await settle('continue after nonpositive or unknown receipt');
      assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_claim','explore_start']);
      assert.equal(await evaluate(`(${state}.sodaReceipts||[]).length`),0);
      const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
      assert.equal(events.some(e=>e.type==='shelter-soda-unknown'),amount!=='0');
      assert.equal(events.some(e=>e.type==='shelter-soda-receipt'),amount==='0');
    }
  });
  await t.test('汽水额度浏览器：网页零额度只挡汽水新派，周任务仍能运行',async()=>{
    await setupShelter(scene({explore:true,quests:true,sodaEfficiency:true},`sm.view.drops.perUserDaily=0;`));
    await settle('weekly work continues with zero soda quota');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['quest_start']);assert.match(await evaluate(`${state}.campaignNote`),/每日汽水上限为0/);
  });
  await t.test('汽水额度浏览器：原领取请求键保存失败不发送，原待确认记录保留',async()=>{
    await setupShelter(scene({explore:true,sodaEfficiency:true},`${sodaReturn}sm.sodaAmount=1;
      const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
        if(k==='arkengine:auto-shelter:pending:v1'&&JSON.parse(v)?.exploreKey)throw Error('fixture storage full');return original.call(this,k,v);};`));
    await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'claim key storage failure');
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(`${pending}.kind`),'explore');
    assert.equal(await evaluate(`${state}.sodaReceipts`),undefined);
  });
  await t.test('汽水额度浏览器：账本保存失败保留成功凭据，刷新恢复后只记一次不重领',async()=>{
    await setupShelter(scene({explore:true,sodaEfficiency:true},`${sodaReturn}sm.sodaAmount=1;
      const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
        if(k==='arkengine:auto-shelter:schedule:v1'&&JSON.parse(v)?.sodaReceipts?.length)throw Error('fixture ledger full');return original.call(this,k,v);};`));
    await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'receipt ledger storage failure');
    assert.equal(await evaluate(`${pending}.result.sodaProof.amount`),1);assert.equal(await evaluate('sm.calls.length'),1);
    await reloadShelter();await evaluate(`${panel}.getElementById('shelter-toggle').click();`);await settle('recover receipt ledger');
    assert.equal(await evaluate(`${state}.sodaReceipts.length`),1);assert.equal(await evaluate(pending),null);
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_claim','explore_start']);
  });
  await t.test('收益完善浏览器：三小时汽水资格正常出发并保存，刷新后按原三小时召回',async()=>{
    await setupShelter(scene({explore:true,sodaEfficiency:true},`sm.view.drops.minMinutes=180;sm.simulateResources=true;`));
    await settle('short soda trip starts and confirms');
    assert.equal(await evaluate(`${state}.campaign.trips[0].hours`),3);assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'true');
    await reloadCampaign();await settle('short trip survives reload');
    assert.equal(await evaluate('sm.calls.length'),1);
    const wait=await evaluate(`sm.view.state.explorers[0].startedAt+3*3600000-clock+1000`);
    await pulse(wait);await drive(`sm.calls.some(c=>c.type==='explore_recall')`,'short original trip recalled');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='explore_start').length`),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='explore_recall').length`),1);
  });
  await t.test('收益完善浏览器：半小时行程回执未知时刷新仍只核对原单，不新派遣',async()=>{
    await setupShelter(scene({explore:true,sodaEfficiency:true},`sm.view.drops.minMinutes=30;sm.mode='unknown';`));
    await drive('sm.calls.length===1','short unknown departure');const before=await evaluate(pending);
    assert.equal(before.before.campaign.choice.hours,.5);
    await reloadShelter();await settle('short unknown trip readonly');
    assert.equal(await evaluate(`${pending}.id`),before.id);assert.equal(await evaluate(`${state}.pendingReadOnly`),before.id);
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'true');
  });
  await t.test('收益完善浏览器：满级队伍纯废料不抵离岗成本时保持生产，出现有效积分后恢复派遣',async()=>{
    await setupShelter(scene({quests:true},`s.season.points=4500;const scrap=s.rooms.find(r=>r.id===4);scrap.floor=2;scrap.col=5;scrap.width=2;
      for(const p of s.residents.filter(p=>p.id>=4))p.roomId=4;
      for(const p of s.residents){p.xp=7203;p.hp=394;}
      sm.view.env.quests[0].rewards={scrap:1,parts:0,itemTier:null,seasonPoints:20};`));
    await settle('negative scrap task waits');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.match(await evaluate(`${state}.campaignNote`),/离岗损失/);
    await reloadCampaign();await settle('negative scrap task after reload');assert.deepEqual(await evaluate('sm.calls'),[]);
    for(const points of [4499,1800]){
      await evaluate(`sm.view.state.season.points=${points};${panel}.getElementById('shelter-check').click();`);
      await settle('no useful points above free season cap '+points);assert.deepEqual(await evaluate('sm.calls'),[]);
    }
    // Current public rules award one free tier per 60 points, through tier 30.
    await evaluate(`sm.view.state.season.points=1799;${panel}.getElementById('shelter-check').click();`);
    await settle('useful seasonal point permits actual quest');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['quest_start']);
    const confirmed=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events
      .find(e=>e.type==='shelter-campaign-confirmed'&&e.data.kind==='quest-start').data`);
    assert.equal(confirmed.assessment.nextSodaPoints,1800);assert.ok(confirmed.assessment.seasonRate>0);
    assert.equal(confirmed.assessment.growth.expectedUsefulXp,0);assert.ok(confirmed.assessment.scrapNetOnSuccess<0);
    await reloadCampaign();await settle('one useful point quest survives refresh');
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`${state}.campaign.attempts.length`),1);
  });
  await t.test('策略纠正浏览器：资源亏损但有经验的周任务可派，日志显示成长依据且刷新不重复出发',async()=>{
    await setupShelter(scene({quests:true},`s.season.points=4500;Object.assign(s.rooms.find(r=>r.id===4),{floor:2,col:5,width:2});
      for(const p of s.residents.filter(p=>p.id>=4))p.roomId=4;
      sm.view.env.quests[0].rewards={scrap:0,parts:0,itemTier:null,seasonPoints:0};
      const before=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter/action'&&JSON.parse(options.body).action.type==='quest_start')
          sm.growthSubmission={pending:${pending},panel:${panel}.getElementById('shelter-campaign-status').textContent};
        return before(url,options);};`));
    await settle('growth quest confirmed');assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['quest_start']);
    const submitted=await evaluate('sm.growthSubmission'),choice=submitted.pending.before.campaign.choice;
    assert.ok(choice.assessment.growth.expectedUsefulXp>0);assert.ok(choice.assessment.scrapNetOnSuccess<0);
    assert.match(choice.reason,/有效经验/);assert.match(choice.reason,/未计返程和疗伤/);
    assert.match(submitted.panel,/有效经验/);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const confirmed=events.find(e=>e.type==='shelter-campaign-confirmed'&&e.data.kind==='quest-start');
    assert.ok(confirmed);assert.ok(confirmed.data.assessment.growth.expectedUsefulXp>0);
    await reloadCampaign();await settle('growth quest reload retains attempt');assert.equal(await evaluate('sm.calls.length'),1);
    assert.equal(await evaluate(`${state}.campaign.attempts.length`),1);
  });
  const nurse=`s.resources.stimpak=4;s.rooms.push({id:30,type:'medbay',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
    s.residents[4].roomId=30;localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'fixture',campaign:{
      roles:[{id:5,room:30,role:'medical',at:clock-1000}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`;
  await t.test('收益完善浏览器：无外出需求且补给充足时释放自动护士，降到保留线重新补医务室',async()=>{
    await setupShelter(scene({medical:true},nurse));await settle('release unnecessary automatic nurse');
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5&&c.roomId===null)`));
    assert.equal(await evaluate(`${state}.campaign.roles.some(r=>r.role==='medical')`),false);
    await reloadCampaign();await settle('nurse release survives reload');
    const before=await evaluate('sm.calls.length');assert.equal(before,1);
    await evaluate(`sm.view.state.resources.stimpak=2;${panel}.getElementById('shelter-check').click();`);
    await drive(`sm.calls.slice(${before}).some(c=>c.type==='assign'&&c.roomId===30)`,'restore nurse below usable needle target');
    assert.ok(await evaluate(`sm.calls.every(c=>c.type!=='stimpak')`),'健康居民不消耗针');
  });
  await t.test('收益完善浏览器：零汽水概率不囤外出补给，手动医务室岗位不撤走',async()=>{
    await setupShelter(scene({medical:true,explore:true,sodaEfficiency:true},`${nurse}sm.view.drops.tierPermille=[0,0];`));
    await settle('zero soda nurse released');assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.roomId===null)`));
    assert.ok(await evaluate(`!sm.calls.some(c=>c.type==='explore_start')`));
    await setupShelter(scene({medical:true},`${nurse}localStorage.removeItem('arkengine:auto-shelter:schedule:v1');`));
    await settle('manual nurse preserved');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate('sm.view.state.residents[4].roomId'),30);
  });
  await t.test('综合调度浏览器：已保存关闭设置保留，折叠面板和设置独立保存',async()=>{
    await setupShelter(scene());await drive(done,'campaign default off');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.ok(await evaluate(`${panel}.querySelector('[data-panel-section="shelter-campaign"]')`));
    await evaluate(`const p=${panel};p.getElementById('shelter-campaign-explore').checked=true;p.getElementById('shelter-campaign-hours').value='12';p.getElementById('shelter-campaign-save').click();`);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('${key}')).hours`),12);
  });
  await t.test('综合调度浏览器：普通出发绑定人选区域补给，保存原探险身份',async()=>{
    await setupShelter(scene({explore:true}));await drive(done,'normal explorer starts');
    const calls=await evaluate('sm.calls');assert.equal(calls.length,1);assert.deepEqual({...calls[0],idempotencyKey:undefined},{type:'explore_start',residentId:5,tier:0,stimpaks:2,abyss:false,idempotencyKey:undefined});
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`${state}.campaign.trips.length`),1);
  });
  await t.test('探险双名额浏览器：深度十三同时派满两人，返程占位，领取后补派且刷新不重复',async()=>{
    await setupShelter(scene({explore:true},`s.depth=13;sm.ui20261109=true;`));
    await drive(`sm.calls.filter(c=>c.type==='explore_start').length===2&&!${pending}`,'fill both expedition slots',120);
    assert.equal(await evaluate('sm.view.state.explorers.length'),2);
    assert.equal(await evaluate('new Set(sm.calls.filter(c=>c.type==="explore_start").map(c=>c.residentId)).size'),2);
    await evaluate(`const e=sm.view.state.explorers[0];e.recalledAt=clock;e.returnAt=clock+3600000;`);
    await reloadShelter();await drive(done,'returning explorer keeps its slot',120);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="explore_start").length'),2);
    await evaluate(`sm.view.state.explorers[0].returnAt=clock-1;
      ${panel}.getElementById('shelter-check').click();`);
    await drive(`sm.calls.filter(c=>c.type==='explore_start').length===3&&!${pending}`,'claim return and refill freed slot',150);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="explore_claim").length'),1);
    assert.equal(await evaluate('sm.view.state.explorers.length'),2);
    assert.equal(await evaluate('sm.view.state.resources.stimpak>=2'),true);
  });
  await t.test('综合调度浏览器：普通探险先出发，周任务另选队并记次数',async()=>{
    await setupShelter(scene({explore:true,quests:true}));await settle('combined missions');
    const calls=await evaluate('sm.calls');assert.deepEqual(calls.map(a=>a.type),['explore_start','quest_start']);
    assert.ok(!calls[1].team.includes(calls[0].residentId));assert.equal(await evaluate(`${state}.campaign.attempts.length`),1);assert.equal(await evaluate(pending),null);
  });
  const fourExplorerScene=extra=>scene({explore:true},`Object.assign(sm.view,${JSON.stringify(fourExplorerView())});
    sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;sm.ui20261109=true;sm.simulateResources=true;${extra||''}`);
  await t.test('废土堵塞：291号耐力90%失去返岗席位，其他四人仍实际出发',async()=>{
    await setupShelter(fourExplorerScene(`const vault=sm.view.state,origin=vault.residents[0];
      vault.rooms.push({...vault.rooms[0],id:642,type:'training',trainStat:'end',floor:4,col:2});
      vault.residents.push({...origin,id:291,name:'李向晚',roomId:642,stats:{...origin.stats,end:4},trainingStat:'end',training:.9});
      localStorage.setItem('${key}',JSON.stringify({...JSON.parse(localStorage.getItem('${key}')),training:true}));
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'返岗席位失效',campaign:{
        roles:[{id:291,room:642,role:'training',at:clock-600000,stat:'end',base:4,purpose:'production',finishCurrent:true,
          until:clock+3600000,windowEnd:clock+168*3600000,destination:315}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`));
    await drive(`sm.calls.filter(call=>call.type==='explore_start').length===4&&!${pending}`,'four departures despite unavailable return seat',240);
    const departures=await evaluate('sm.calls.filter(call=>call.type==="explore_start").map(call=>call.residentId)');
    assert.equal(new Set(departures).size,4);assert.ok(!departures.includes(291));
    assert.equal(await evaluate('sm.calls.some(call=>call.type==="assign"&&call.residentId===291)'),false);
    const role=await evaluate(`${state}.campaign.roles.find(entry=>entry.id===291)`);
    assert.equal(role?.purpose,'current');assert.equal(role.destination,undefined);
  });
  await t.test('普通废土四人轮转：27层四人同派，逐人召回、返程占位、领取补派，32层增至五人',async()=>{
    await setupShelter(fourExplorerScene());
    await drive(`sm.calls.filter(call=>call.type==='explore_start').length===4&&!${pending}`,'four expedition departures',200);
    assert.deepEqual(await evaluate('sm.calls.filter(call=>call.type==="explore_start").map(call=>call.residentId)'),[5,6,7,8]);
    assert.equal(await evaluate(`${state}.campaign.trips.length`),4);
    await reloadCampaign();await settle('four departures survive refresh');
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="explore_start").length'),4);
    await pulse(6*3600000);
    await evaluate(`${panel}.getElementById('shelter-check').click()`);
    await drive(`sm.calls.filter(call=>call.type==='explore_recall').length===4&&!${pending}`,'four due recalls complete',240);
    assert.equal(await evaluate('new Set(sm.calls.filter(call=>call.type==="explore_recall").map(call=>call.explorerId)).size'),4);
    await reloadCampaign();await settle('four returning residents occupy slots');
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="explore_start").length'),4);
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="explore_recall").length'),4);
    await evaluate(`sm.view.state.explorers[0].returnAt=clock-1;${panel}.getElementById('shelter-check').click()`);
    await drive(`sm.calls.filter(call=>call.type==='explore_start').length===5&&!${pending}`,'claim and refill only freed slot',200);
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="explore_claim").length'),1);
    assert.equal(await evaluate('sm.view.state.explorers.length'),4);
    await evaluate(`sm.view.state.depth=32;${panel}.getElementById('shelter-check').click()`);
    await drive(`sm.calls.filter(call=>call.type==='explore_start').length===6&&!${pending}`,'fifth expedition slot after expansion',200);
    assert.equal(await evaluate('sm.view.state.explorers.length'),5);
    assert.equal(await evaluate(`${state}.campaign.exploreSlots.limit`),5);
  });
  await t.test('普通废土网页名额：原生上限较低时只派到上限，不连续点击满员出发',async()=>{
    await setupShelter(fourExplorerScene('sm.exploreSlots=3;'));
    await drive(`sm.calls.filter(call=>call.type==='explore_start').length===3&&!${pending}`,'native three-slot capacity',180);
    await settle('native capacity full');await reloadCampaign();await settle('native capacity retained');
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="explore_start").length'),3);
    assert.equal(await evaluate(`${state}.campaign.exploreSlots.limit`),3);
  });
  const rejectExpedition=type=>`const originalExpeditionFetch=window.fetch;sm.rejectedExpeditions=0;
    window.fetch=(url,options)=>{
      if(url==='/api/shelter/action'&&options?.method==='POST'){
        const request=JSON.parse(options.body);
        if(request.action.type==='${type}'&&sm.rejectedExpeditions===0){
          sm.rejectedExpeditions++;sm.rejectedExpedition=structuredClone(request);
          return Promise.resolve(new Response(JSON.stringify({error:'当前条件不满足'}),{status:400}));
        }
      }
      return originalExpeditionFetch(url,options);
    };`;
  await t.test('普通废土派遣拒绝：400不再阻塞其他人，刷新保留退避，到期按新状态补派',async()=>{
    await setupShelter(fourExplorerScene(rejectExpedition('explore_start')));
    await drive(`!!${state}?.campaignRecovery&&!${pending}`,'departure rejection archived',100);
    assert.equal(await evaluate(`${state}.campaignRecovery.original.kind`),'explore-start');
    await drive(`sm.calls.some(call=>call.type==='explore_start')&&!${pending}`,'another resident departs after rejection',100);
    assert.equal(await evaluate('sm.calls[0].residentId'),6);
    assert.ok(await evaluate(`${state}.campaign.rejections.some(entry=>entry.id===5)`));
    await reloadCampaign();
    await pulse(60000);await evaluate(`${panel}.getElementById('shelter-check').click()`);
    await drive(`sm.view.state.explorers.length===4&&!${pending}`,'refill after fresh planning',180);
    assert.equal(await evaluate('sm.rejectedExpeditions'),1);
    assert.ok(await evaluate('sm.calls.every(call=>call.idempotencyKey!==sm.rejectedExpedition.idempotencyKey)'));
  });
  await t.test('日常装备浏览器：无出征仍装备留守武器及制作服，刷新不反复穿戴',async()=>{
    await setupShelter(scene({combatGear:true},`
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      s.rooms.push({...s.rooms[0],id:90,type:'tailor',floor:3,col:2,level:1});s.residents[4].roomId=90;
      s.items=[{id:173,slot:'weapon',name:'轨道步枪',damage:[11,18]},{id:71,slot:'outfit',name:'演出服',bonus:{cha:2}}];`));
    await settle('home gear');
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='equip').length`),2);
    assert.ok(await evaluate('sm.view.state.residents.some(p=>p.weaponId===173)'));
    assert.equal(await evaluate('sm.view.state.residents[4].outfitId'),71);
    await reloadCampaign();await settle('home gear reload');
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='equip').length`),2);
  });
  await t.test('日常装备浏览器：穿戴结果未知刷新只核对原单，不重复换装',async()=>{
    await setupShelter(scene({combatGear:true},`
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');sm.equipUnknown=true;
      s.items=[{id:173,slot:'weapon',name:'轨道步枪',damage:[11,18]}];s.residents[4].roomId=4;s.residents[5].roomId=2;`));
    await drive(`sm.calls.some(a=>a.type==='equip')`,'unknown home gear');
    await reloadCampaign();await settle('unknown gear reload');
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='equip').length`),1);
    assert.equal(await evaluate(`${pending}.kind`),'equip');
  });
  await t.test('探险幸运服浏览器：先穿闲置幸运夹克再出发',async()=>{
    await setupShelter(scene({explore:true,combatGear:true},`s.items=[{id:136,slot:'outfit',name:'幸运夹克',bonus:{lck:1}}];`));
    await settle('luck before departure');const calls=await evaluate('sm.calls');
    assert.deepEqual(calls.map(a=>a.type),['equip','explore_start']);assert.equal(calls[0].itemId,136);
    assert.equal(calls[0].residentId,calls[1].residentId);
  });
  await t.test('出征武器交接浏览器：从生产者接过强武器，原生确认后出发，刷新不重复',async()=>{
    await setupShelter(scene({explore:true,combatGear:true},`s.items=[{id:101,slot:'weapon',name:'步枪',damage:[4,8]},{id:102,slot:'weapon',name:'值班武器',damage:[99,99]}];s.residents[0].weaponId=102;`));
    await drive(done,'combat equip then depart');const calls=await evaluate('sm.calls');
    assert.deepEqual(calls.map(a=>a.type),['equip','explore_start']);assert.equal(calls[0].slot,'weapon');assert.equal(calls[0].itemId,102);
    assert.equal(calls[0].residentId,calls[1].residentId);
    assert.equal(await evaluate('sm.view.state.residents[0].weaponId'),null);assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate('sm.view.state.residents[0].roomId'),1);
    await reloadCampaign();await settle('transferred weapon reload');
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='equip').length`),1);
  });
  await t.test('出征武器交接浏览器：确认窗口中原持有者外出或供给变差，撤销未发送转交',async()=>{
    for(const kind of ['away','supply']){
      await setupShelter(scene({explore:true,combatGear:true},`s.items=[{id:102,slot:'weapon',name:'值班武器',damage:[11,18]}];s.residents[0].weaponId=102;`));
      await drive(`Array.from(document.querySelectorAll('[role="alertdialog"] h2')).some(h=>h.textContent.includes('转交'))`,'native weapon transfer confirmation');
      assert.equal(await evaluate('sm.calls.length'),0);
      const original=await evaluate(pending);
      await evaluate(kind==='away'?`sm.view.state.residents[0].away={kind:'explore',id:999};`:
        `sm.view.state.rooms.find(r=>r.type==='water').unpowered=true;sm.view.state.resources.water=0;`);
      await settle('cancel invalid weapon handoff '+kind);
      assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='equip'||a.type==='explore_start').length`),0);
      assert.equal(await evaluate(pending),null);
      const cancelled=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events
        .filter(e=>e.type==='shelter-work-cancelled'&&e.data.operation===${JSON.stringify(original.id)}).at(-1)`);
      assert.ok(cancelled,'the original unsent transfer has a recorded cancellation');
      assert.match(cancelled.data.reason,/武器归属、出发队伍或留守条件变化/);
      assert.ok(cancelled.data.ageMs<=15000,'changed ownership or supply must be detected before confirmation expires');
      assert.ok((await evaluate(`${state}.campaignNote`)).includes(cancelled.data.reason));
      await reloadCampaign();await settle('invalid weapon handoff stays cancelled '+kind);
      assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='equip'||a.type==='explore_start').length`),0);
      assert.equal(await evaluate('sm.view.state.residents[0].weaponId'),102);
      assert.equal(await evaluate(pending),null);
    }
  });
  await t.test('出征武器交接浏览器：已发送转交结果未知，刷新保留原单且不出征',async()=>{
    await setupShelter(scene({explore:true,combatGear:true},`sm.equipUnknown=true;s.items=[{id:102,slot:'weapon',name:'值班武器',damage:[11,18]}];s.residents[0].weaponId=102;`));
    await drive(`sm.calls.some(a=>a.type==='equip')`,'unknown weapon transfer');
    const original=await evaluate(`${pending}.id`);await reloadCampaign();await settle('unknown transfer retained');
    assert.equal(await evaluate(`${pending}.id`),original);assert.equal(await evaluate(`${pending}.before.campaign.choice.fromOwner`),1);
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='equip').length`),1);
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='explore_start').length`),0);
  });
  await t.test('出征武器交接浏览器：已占用武器帮助周任务达标，确认后仅原队出征',async()=>{
    await setupShelter(scene({quests:true,combatGear:true,chance:82},`s.items=[{id:102,slot:'weapon',name:'值班武器',damage:[10,15]}];s.residents[0].weaponId=102;`));
    await settle('borrow weapon then quest');const calls=await evaluate('sm.calls');
    assert.deepEqual(calls.map(a=>a.type),['equip','quest_start']);assert.equal(calls[0].itemId,102);
    assert.ok(calls[1].team.includes(calls[0].residentId));assert.equal(await evaluate(pending),null);
  });
  await t.test('出征武器交接浏览器：保住留守主力枪，选择安全的次强枪出征',async()=>{
    await setupShelter(scene({explore:true,combatGear:true,defense:true},`
      for(let id=7;id<=15;id++)s.residents.push({...structuredClone(s.residents[0]),id,name:'儿童'+id,roomId:null,adultAt:clock+86400000});
      s.items=[{id:10,slot:'weapon',name:'主力枪',damage:[30,30]},{id:11,slot:'weapon',name:'备用枪',damage:[5,5]}];
      s.residents[0].weaponId=10;s.residents[1].weaponId=11;`));
    await settle('safe secondary weapon');const calls=await evaluate('sm.calls');
    assert.deepEqual(calls.map(a=>a.type),['equip','explore_start']);assert.equal(calls[0].itemId,11);
    assert.equal(await evaluate('sm.view.state.residents[0].weaponId'),10);
    assert.equal(await evaluate('sm.view.state.residents[1].weaponId'),null);
  });
  await t.test('规则纠正浏览器：闲置武器使任务达标，先确认装备再出发',async()=>{
    await setupShelter(scene({quests:true,combatGear:true,chance:82},`s.items=[{id:101,slot:'weapon',name:'步枪',damage:[10,15]}];`));
    await settle('gear unlocks weekly quest');const calls=await evaluate('sm.calls');
    assert.deepEqual(calls.map(a=>a.type),['equip','quest_start']);assert.equal(calls[0].itemId,101);
    assert.ok(calls[1].team.includes(calls[0].residentId));assert.equal(await evaluate(pending),null);
  });
  await t.test('规则纠正浏览器：已开启训练和派遣时保留培养人选，空余位置可多人训练',async()=>{
    const rooms=`s.rooms.push({id:30,type:'training',trainStat:'end',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});`;
    await setupShelter(scene({training:true,trainTarget:9,explore:true,quests:true},rooms));await settle('train and explore together');
    const calls=await evaluate('sm.calls'),trained=calls.filter(a=>a.type==='assign'&&a.roomId===30).map(a=>a.residentId);
    assert.ok(trained.length>0);assert.ok(calls.some(a=>a.type==='explore_start'));
    assert.ok(!calls.some(a=>a.type==='explore_start'&&trained.includes(a.residentId)||a.type==='quest_start'&&a.team.some(id=>trained.includes(id))));
    await setupShelter(scene({training:true,trainTarget:9},rooms));await settle('training fills actual seats');
    assert.equal(await evaluate('sm.view.state.residents.filter(p=>p.roomId===30).length'),2);
  });
  await t.test('综合调度浏览器：出发随机等待时暂停，尚未发送的动作撤销',async()=>{
    await setupShelter(scene({explore:true}));await drive(`/随机等待.*普通探险区域/.test(${panel}.getElementById('status').textContent)`,'departure queued');
    await evaluate(`${panel}.getElementById('shelter-toggle').click()`);await pulse(15000);assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
  });
  await t.test('综合调度浏览器：深渊已勾选不替用户改动或消费',async()=>{
    await setupShelter(scene({explore:true},'sm.abyss=true;'));await drive(done,'preserve abyss');assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate('sm.abyss'),true);
    assert.match(await evaluate(`${state}.campaignNote`),/深渊选项/);assert.doesNotMatch(await evaluate(`${state}.note`),/上限/);
  });
  await t.test('综合调度浏览器：未知出发跨刷新不重发，五分钟只读等待并返回远征',async()=>{
    await setupShelter(scene({explore:true},`sm.mode='unknown';`));await drive('sm.calls.length===1','unknown departure');
    const first=await evaluate(pending);await reloadShelter();await drive(done,'unknown persisted');
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`${pending}.id`),first.id);assert.equal(await evaluate(`${state}.pendingReadOnly`),first.id);
  });
  await t.test('综合调度浏览器：原生动作被改成付费深渊时请求发送前拦住',async()=>{
    await setupShelter(scene({explore:true},`window.shelterTransport=(u,o)=>{const body=JSON.parse(o.body);body.action.abyss=true;return fetch(u,{...o,body:JSON.stringify(body)});};`));
    await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'changed departure blocked');
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(`${pending}.kind`),'explore-start');
  });
  const trip=`s.residents[4].away={kind:'explore'};s.residents[4].roomId=null;
    s.explorers=[{id:11,residentId:5,tier:0,abyss:false,startedAt:clock-6*3600000,recalledAt:null,returnAt:null,stimpaks:2,loot:{scrap:0,parts:0,stimpak:0,items:[]}}];
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'待检查',campaign:{roles:[],trips:[{id:11,resident:5,at:clock-6*3600000,hours:6}],attempts:[],heals:[],trainingRest:[]}}));`;
  await t.test('综合调度浏览器：到时只召回原普通探险，经原生确认并保存成功回执',async()=>{
    await setupShelter(scene({explore:true},trip));await drive(done,'recall owned trip');
    assert.deepEqual(await evaluate('sm.calls.map(a=>a.type)'),['explore_recall']);assert.equal(await evaluate(pending),null);
    assert.ok(await evaluate('sm.view.state.explorers[0].returnAt>clock'));
  });
  await t.test('普通废土召回拒绝：400解除等待并退避，刷新后重新核对只成功召回一次',async()=>{
    await setupShelter(scene({explore:true},trip+rejectExpedition('explore_recall')));
    await drive(`!!${state}?.campaignRecovery&&!${pending}`,'recall rejection archived',100);
    assert.equal(await evaluate(`${state}.campaignRecovery.original.kind`),'explore-recall');
    await settle('rejected recall remains in backoff');
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="explore_recall").length'),0);
    await reloadCampaign();
    await pulse(60000);await evaluate(`${panel}.getElementById('shelter-check').click()`);
    await drive(`sm.calls.some(call=>call.type==='explore_recall')&&!${pending}`,'recall after fresh verification',120);
    await reloadCampaign();await settle('successful recall is not replayed');
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="explore_recall").length'),1);
    assert.ok(await evaluate('sm.calls.every(call=>call.idempotencyKey!==sm.rejectedExpedition.idempotencyKey)'));
    assert.equal(await evaluate(`${state}.campaign.rejections.length`),0);
  });
  const recallScreenshotScene=trip+`sm.ui20261109=true;s.depth=14;sm.view.drops.minMinutes=120;
    s.explorers[0].startedAt=clock-2*3600000-1000;
    s.residents[3].away={kind:'explore'};s.residents[3].roomId=null;
    s.explorers.push({...structuredClone(s.explorers[0]),id:12,residentId:4,startedAt:clock-6*3600000,
      recalledAt:clock-2*3600000,returnAt:clock+44*60000});
    {const journal=${state};journal.campaign.trips[0].hours=2;
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(journal));}
    sm.recallOpens=0;const append=document.body.append.bind(document.body);document.body.append=(...nodes)=>{
      append(...nodes);for(const d of nodes)if(d.querySelector?.('h2')?.textContent.startsWith('召回 ')){
        sm.recallOpens++;d.querySelector('p').textContent='返程需要 1小时0分（已出门时间的一半），到家后领取。';
        d.querySelector('button').focus();}};`;
  const delayedRecall=recallScreenshotScene+`const appendRecall=document.body.append.bind(document.body);document.body.append=(...nodes)=>{
    appendRecall(...nodes);const dialog=nodes.find(node=>node.querySelector?.('h2')?.textContent.startsWith('召回 '));
    if(dialog){window.recallDialog=dialog;dialog.style.opacity='0';sm.recallClicks=[];
      dialog.addEventListener('click',event=>sm.recallClicks.push(event.target.textContent));}};`;
  const recallEnabled=`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`;
  await t.test('废土迟到弹窗：召回窗口超过五秒才渲染，仍能撤销本轮窗口并继续',async()=>{
    await setupShelter(scene({explore:true},recallScreenshotScene+`
      const appendDelayed=document.body.append.bind(document.body);
      document.body.append=(...nodes)=>{
        appendDelayed(...nodes);
        const dialog=nodes.find(node=>node.querySelector?.('h2')?.textContent.startsWith('召回 '));
        if(dialog){window.delayedRecallDialog=dialog;dialog.remove();}
      };`));
    await drive('!!window.delayedRecallDialog','recall opening requested');
    await pulse(6000);
    await evaluate('document.body.appendChild(delayedRecallDialog);');
    await drive(`!delayedRecallDialog.isConnected&&location.pathname==='/activities/expedition'`,'late recall is cancelled and normal work resumes',70);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate('sm.recallOpens'),1);
    assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate(recallEnabled),'true');
  });
  await t.test('后台召回：确认与取消均不可用四十秒，前台再等动画后只确认原单一次',async()=>{
    await setupShelter(scene({explore:true},delayedRecall));
    await drive('window.recallDialog?.isConnected','script opened the owned recall');
    await withShelterBackground(async()=>{
      for(let pass=0;pass<4;pass++)await pulse(10000);
      assert.equal(await evaluate(recallEnabled),'true');assert.deepEqual(await evaluate('sm.recallClicks'),[]);
      assert.equal(await evaluate(pending),null);
    });
    await pulse(5000);assert.deepEqual(await evaluate('sm.recallClicks'),[]);
    await evaluate(`recallDialog.style.opacity='1'`);
    await drive(`sm.calls.some(c=>c.type==='explore_recall')&&!${pending}`,'foreground revalidates original recall');
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.explorerId])'),[['explore_recall',11]]);
    assert.deepEqual(await evaluate('sm.recallClicks'),['确认']);assert.equal(await evaluate('sm.recallOpens'),1);
  });
  await t.test('后台召回：已决定撤销时等待前台可用的取消按钮，绝不改点确认',async()=>{
    await setupShelter(scene({explore:true},delayedRecall));
    await drive('window.recallDialog?.isConnected','owned recall before changed title');
    await withShelterBackground(async()=>{
      await evaluate(`recallDialog.querySelector('h2').textContent='身份已变化'`);
      for(let pass=0;pass<4;pass++)await pulse(10000);
      assert.equal(await evaluate(recallEnabled),'true');assert.deepEqual(await evaluate('sm.recallClicks'),[]);
    });
    await evaluate(`recallDialog.style.opacity='1'`);await drive('!recallDialog.isConnected','cancel only after foreground');
    assert.deepEqual(await evaluate('sm.recallClicks'),['取消']);assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate('sm.recallOpens'),1);
  });
  await t.test('后台召回：控件在后台恢复即可继续，不要求切回标签页',async()=>{
    await setupShelter(scene({explore:true},delayedRecall));await drive('window.recallDialog?.isConnected','owned recall awaiting paint');
    await withShelterBackground(async()=>{
      await pulse(18000);await evaluate(`recallDialog.style.opacity='1'`);
      await drive(`sm.calls.some(c=>c.type==='explore_recall')&&!${pending}`,'background recovers once interactive');
      assert.deepEqual(await evaluate('sm.recallClicks'),['确认']);assert.equal(await evaluate(recallEnabled),'true');
    });
  });
  await t.test('后台召回：其他页面已让原队返程，恢复后重读并只取消',async()=>{
    await setupShelter(scene({explore:true},delayedRecall));await drive('window.recallDialog?.isConnected','owned recall before changed trip');
    await withShelterBackground(async()=>{
      await pulse(20000);await evaluate(`const trip=sm.view.state.explorers.find(e=>e.id===11);trip.recalledAt=clock;trip.returnAt=clock+3600000;`);
    });
    await evaluate(`recallDialog.style.opacity='1'`);await drive('!recallDialog.isConnected','changed trip cancels original window');
    assert.deepEqual(await evaluate('sm.recallClicks'),['取消']);assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
  });
  await t.test('后台召回：遮挡九分钟不延长访问，回到前台只取消超时访问',async()=>{
    await setupShelter(scene({explore:true},delayedRecall));await drive('window.recallDialog?.isConnected','owned recall before nine-minute absence');
    await withShelterBackground(async()=>{
      await pulse(18000);await pulse(9*60000);for(let pass=0;pass<4;pass++)await pulse(5000);
      assert.equal(await evaluate(recallEnabled),'true');assert.deepEqual(await evaluate('sm.recallClicks'),[]);
    });
    await evaluate(`recallDialog.style.opacity='1'`);await drive(done,'expired visit cancels and returns to expedition');
    assert.deepEqual(await evaluate('sm.recallClicks'),['取消']);assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(pending),null);
  });
  await t.test('后台召回：前台持续不可用仍有界撤销并暂停，两阶段都不点隐藏按钮',async()=>{
    await setupShelter(scene({explore:true},delayedRecall));await drive('window.recallDialog?.isConnected','foreground controls unavailable');
    for(let pass=0;pass<9;pass++)await pulse(5000);
    assert.equal(await evaluate(recallEnabled),'false');assert.equal(await evaluate('recallDialog.isConnected'),true);
    assert.deepEqual(await evaluate('sm.recallClicks'),[]);assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('召回窗口接续：双名额一人返程、另一人两小时到期，自动聚焦取消不阻止确认',async()=>{
    await setupShelter(scene({explore:true},recallScreenshotScene));
    await drive(`sm.calls.some(c=>c.type==='explore_recall')&&!${pending}`,'screenshot shaped native recall',50);
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.explorerId])'),[['explore_recall',11]]);
    assert.equal(await evaluate('sm.recallOpens'),1);
  });
  await t.test('执行耗时浏览器：召回最终读取十一秒跨过旧窗口期限，仍只召回一次',async()=>{
    await setupShelter(scene({explore:true},recallScreenshotScene+`Math.random=()=>.999;
      const read=window.fetch;sm.delayedRecallReads=0;window.fetch=(url,options)=>{
        if(url!=='/api/shelter'||!document.querySelector('[role="dialog"]')||sm.delayedRecallReads)return read(url,options);
        sm.delayedRecallReads++;const due=clock+11000;
        return new Promise((resolve,reject)=>{const check=()=>{if(clock<due)return;window.removeEventListener('focus',check);read(url,options).then(resolve,reject);};
          window.addEventListener('focus',check);});};`));
    await drive(`sm.calls.some(c=>c.type==='explore_recall')&&!${pending}`,'slow recall read completes without cancelling',80);
    assert.equal(await evaluate('sm.delayedRecallReads'),1);
    assert.equal(await evaluate('sm.recallOpens'),1);
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.explorerId])'),[['explore_recall',11]]);
  });
  await t.test('召回计算复用：维护核对每次耗时七百毫秒，确认不陷入重读循环',async()=>{
    await setupShelter(scene({explore:true},recallScreenshotScene+`sm.maintenanceCostMs=700;
      sm.recallReads=0;const read=window.fetch;window.fetch=(url,options)=>{
        if(url==='/api/shelter'&&document.querySelector('[role="dialog"]'))sm.recallReads++;
        return read(url,options);};`));
    await drive(`sm.recallOpens===1`,'recall opened before expensive verification');
    const openedAt=await evaluate('clock');
    await drive(`sm.calls.some(c=>c.type==='explore_recall')&&!${pending}`,'bounded recall verification',30);
    assert.ok(await evaluate(`clock-${openedAt}<20000`),'recall finishes within twenty simulated seconds');
    assert.ok(await evaluate('sm.recallReads<=2'),'one fresh confirmation read and at most one reconciliation read');
    assert.equal(await evaluate('sm.recallOpens'),1);
    assert.deepEqual(await evaluate('sm.calls.map(c=>[c.type,c.explorerId])'),[['explore_recall',11]]);
  });
  await t.test('召回窗口接续：截屏修饰键和系统截屏组合不放弃原窗口，仍只召回一次',async()=>{
    await setupShelter(scene({explore:true},recallScreenshotScene));
    await drive(`Boolean(document.querySelector('[role="dialog"]'))`,'recall dialog focused for screenshot');
    for(const key of ['Meta','Shift'])await trustedStaffKey(key);
    await trustedStaffKey('s',12);await trustedStaffKey('PrintScreen');
    await drive(`sm.calls.some(c=>c.type==='explore_recall')&&!${pending}`,'screenshot does not take over game dialog',50);
    assert.equal(await evaluate('sm.recallOpens'),1);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="explore_recall").length'),1);
  });
  await t.test('召回窗口接续：实际Tab接手超过一分钟仍保留人工窗口且零召回',async()=>{
    await setupShelter(scene({explore:true},recallScreenshotScene));
    await drive(`Boolean(document.querySelector('[role="dialog"]'))`,'owned recall before actual keyboard navigation');
    await trustedStaffKey('Tab');await pulse(65000);
    for(let i=0;i<5;i++)await pulse();
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="explore_recall").length'),0);
    assert.ok(await evaluate(`Boolean(document.querySelector('[role="dialog"]'))`));
    assert.equal(await evaluate(pending),null);
    const interaction=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events
      .filter(e=>e.type==='shelter-user-interaction').at(-1)`);
    assert.equal(interaction.data.eventType,'keydown');assert.equal(interaction.data.targetScope,'dialog');
  });
  await t.test('避难所弹窗恢复：召回标题变化时取消且继续远征，不误召回或重复开窗',async()=>{
    await setupShelter(scene({explore:true},trip+`const append=document.body.append.bind(document.body);
      document.body.append=(...nodes)=>{append(...nodes);const d=nodes.find(n=>n.querySelector?.('h2')?.textContent.startsWith('召回 '));
        if(d){sm.recallOpens=(sm.recallOpens||0)+1;d.querySelector('h2').textContent='新版召回确认';}};`));
    await settle('changed recall dialog cancelled');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate('sm.recallOpens'),1);assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"],[role="alertdialog"]')`),null);
  });
  await t.test('综合调度浏览器：召回确认前人工接手，不自动确认',async()=>{
    await setupShelter(scene({explore:true},trip));await drive(`Boolean(document.querySelector('[role="dialog"]'))`,'recall dialog open');
    await trustedStaffKey('Escape');await pulse(10000);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('综合调度浏览器：小队归来领取释放，失败任务本周不无限重试',async()=>{
    await setupShelter(scene({quests:true}));await drive(done,'weekly starts');
    await evaluate(`const q=sm.view.state.quests[0];q.status='failed';q.returnAt=clock-1;`);
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(done,'failed weekly claimed');
    assert.deepEqual(await evaluate('sm.calls.map(a=>a.type)'),['quest_start','quest_claim'],JSON.stringify(await diagnose()));assert.equal(await evaluate('sm.view.state.quests.length'),0);
    await pulse(1000);await evaluate(`history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);
    await reloadShelter();await pulse(await evaluate(`Math.max(1000,${state}.nextAt-clock+1000)`));await drive(done,'weekly attempt survives reload');
    assert.equal(await evaluate('sm.calls.length'),2);
  });
  await t.test('综合调度浏览器：医疗用针、值班和保留量同时生效',async()=>{
    await setupShelter(scene({medical:true},`s.residents[4].hp=30;s.rooms.push({id:30,type:'medbay',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});`));
    await drive(done,'heal then staff medical');const calls=await evaluate('sm.calls');
    assert.equal(calls.filter(c=>c.type==='stimpak').length,1);assert.ok(calls.some(c=>c.type==='assign'&&c.roomId===30));assert.equal(await evaluate(pending),null);
  });
  await t.test('训练实际用途浏览器：过剩净水不送训，可调工人实际接回收岗且刷新不反复调动',async()=>{
    await setupShelter(scene({training:true,trainTarget:6},`
      s.rooms.push({...s.rooms[0],id:30,type:'training',trainStat:'per',level:1,floor:3,col:2});
      for(const p of s.residents)p.stats.per=10;
      Object.assign(s.residents[4],{roomId:3,xp:0,hp:100,training:0});
      s.residents[4].stats.per=1;s.residents[4].stats.end=10;s.residents[5].roomId=1;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');`));
    await settle('surplus water worker produces useful scrap');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===30).length'),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),4,JSON.stringify(await diagnose()));
    assert.ok(await evaluate('sm.calls.some(c=>c.type==="assign"&&c.residentId===5&&c.roomId===4)'));
    const calls=await evaluate('sm.calls.filter(c=>c.type==="assign").length');
    await reloadCampaign();await settle('useful production survives reload');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),calls);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),4);
  });
  const alternativeTrainingReturnScene=()=>scene({training:true,trainTarget:10},`
    s.rooms.find(r=>r.id===4).width=2;
    s.rooms.push({...s.rooms[0],id:90,type:'training',trainStat:'end',level:1,floor:3,col:2},
      {...s.rooms[0],id:91,type:'scrap',unpowered:true,floor:3,col:3});
    for(const p of s.residents)p.stats.end=10;
    Object.assign(s.residents[4],{roomId:90,xp:0,hp:100,training:.01});s.residents[4].stats.end=6;
    s.residents[5].roomId=4;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    localStorage.setItem('arkengine:auto-shelter:optimize:v1','false');
    localStorage.setItem('arkengine:auto-shelter:population:v1','6');
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'训练备用返岗',
      campaign:{roles:[{id:5,room:90,role:'training',at:clock-3600000,stat:'end',base:5,purpose:'production',
        until:clock+600000,windowEnd:clock+168*3600000,destination:91}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`);
  const advancedProductionScene=(progress=.9)=>alternativeTrainingReturnScene()+`sm.ui20261109=true;
    s.residents.find(person=>person.id===5).training=${progress};
    const schedule=JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'));
    Object.assign(schedule.campaign.roles[0],{destination:4,finishCurrent:true,at:clock-2*3600000,until:clock-3600000});
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(schedule));`;
  await t.test('跨格训练浏览器：旧收尾过期但下一格90%不弹调岗确认，刷新不续期',async()=>{
    await setupShelter(advancedProductionScene());await settle('retain advanced production cell');
    const role=await evaluate(`${state}.campaign.roles.find(entry=>entry.id===5)`);
    assert.equal(role.base,6);assert.equal(role.finishCurrent,true);assert.equal(role.destination,4);
    assert.equal(await evaluate('sm.calls.filter(action=>action.residentId===5).length'),0);
    assert.equal(await evaluate(`!!document.querySelector('[role="alertdialog"]')`),false);
    await reloadCampaign();await settle('same cell deadline survives reload');
    assert.equal(await evaluate(`${state}.campaign.roles.find(entry=>entry.id===5).until`),role.until);
    await evaluate('const person=sm.view.state.residents.find(person=>person.id===5);person.stats.end=7;person.training=0;');
    await reloadCampaign();await drive(`sm.calls.some(action=>action.type==='assign'&&action.residentId===5&&action.roomId===4)&&!${pending}`,'return after current cell completes');
    assert.equal(await evaluate('sm.calls.filter(action=>action.residentId===5).length'),1);
  });
  await t.test('训练连续生命周期浏览器：升级返岗房、后台等待、两次跨格与刷新后只返岗一次',async()=>{
    const revisit=async()=>{
      await evaluate(`localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({...${state},nextAt:0}));`);
      await reloadCampaign();
    };
    await setupShelter(advancedProductionScene()+`Object.assign(s.rooms.find(room=>room.id===4),{level:2,upgradeAt:clock+3600000});`);
    await settle('retain training while return room upgrades');
    const first=await evaluate(`${state}.campaign.roles.find(role=>role.id===5)`);
    assert.equal(first.base,6);assert.equal(first.destination,4);
    assert.equal(await evaluate('sm.calls.filter(action=>action.residentId===5).length'),0);
    await withShelterBackground(async()=>{await pulse(20000);await pulse(20000);});
    await revisit();await settle('same cell survives background and reload');
    assert.equal(await evaluate(`${state}.campaign.roles.find(role=>role.id===5).until`),first.until);
    await evaluate(`clock+=3600000;sm.view.state.lastSettledAt=clock;
      Object.assign(sm.view.state.rooms.find(room=>room.id===4),{upgradeAt:null,level:3});
      const person=sm.view.state.residents.find(person=>person.id===5);person.stats.end=7;person.training=.9;`);
    await revisit();await settle('next completed cell binds new progress');
    const second=await evaluate(`${state}.campaign.roles.find(role=>role.id===5)`);
    assert.equal(second.base,7);assert.equal(second.windowEnd,first.windowEnd);assert.ok(second.until>first.until);
    assert.equal(await evaluate('sm.calls.filter(action=>action.residentId===5).length'),0);
    await revisit();await settle('second cell keeps its own fixed deadline');
    assert.equal(await evaluate(`${state}.campaign.roles.find(role=>role.id===5).until`),second.until);
    await evaluate('const person=sm.view.state.residents.find(person=>person.id===5);person.stats.end=8;person.training=0;');
    await revisit();await drive(`sm.calls.some(action=>action.type==='assign'&&action.residentId===5&&action.roomId===4)&&!${pending}`,'one final return after settlement');
    await settle('finish final return visit');
    await revisit();await settle('completed return survives refresh');
    assert.equal(await evaluate('sm.calls.filter(action=>action.residentId===5).length'),1);
    assert.equal(await evaluate(`${state}.campaign.roles.some(role=>role.id===5&&role.role==='training')`),false);
  });
  for(const sent of [false,true])await t.test('跨格训练浏览器：旧指定返岗'+(sent?'已发送则保持未知原单':'未绑定且当前90%则归档旧意图并保留训练'),async()=>{
    await setupShelter(advancedProductionScene(0)+(sent?'sm.assignUnknown=true;':''));
    await drive(sent?`sm.calls.some(action=>action.type==='assign'&&action.residentId===5)`:
      `!!document.querySelector('[role="alertdialog"]')`,'old return before next cell observation');
    const original=await evaluate(`const pending=${pending};${sent?'':'delete pending.lifecycle;pending.at=clock-60000;'}
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(pending));
      sm.view.state.residents.find(person=>person.id===5).training=.9;pending`);
    await reloadShelter();await settle('reconcile current training without replay');
    assert.equal(await evaluate('sm.calls.filter(action=>action.residentId===5).length'),sent?1:0);
    if(sent)assert.equal(await evaluate(`${pending}.id`),original.id);
    else{
      assert.equal(await evaluate(pending),null);
      assert.equal(await evaluate(`${state}.assignmentRecovery.original.id`),original.id);
      assert.equal(await evaluate(`${state}.campaign.roles.find(entry=>entry.id===5).base`),6);
      assert.ok(await evaluate(`!${state}.campaign.trainingRest.some(entry=>entry.id===5)`));
      assert.equal(await evaluate('sm.view.state.residents.find(person=>person.id===5).roomId'),90);
    }
  });
  await t.test('跨格训练浏览器：确认前当前格变成90%则取消未发送调岗',async()=>{
    await setupShelter(advancedProductionScene(0)+`const confirm=fixtureConfirm;window.fixtureConfirm=(...args)=>{
      const result=confirm(...args);sm.view.state.residents.find(person=>person.id===5).training=.9;return result;};`);
    await drive(`!!document.querySelector('[role="alertdialog"]')`,'return confirmation before progress changes');
    await drive(`!document.querySelector('[role="alertdialog"]')&&!${pending}`,'cancel stale return confirmation');
    assert.equal(await evaluate('sm.calls.filter(action=>action.residentId===5).length'),0,
      JSON.stringify(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(event=>/prepared|confirmation|cancelled/.test(event.type))`)));
    assert.equal(await evaluate('sm.view.state.residents.find(person=>person.id===5).roomId'),90);
  });
  for(const latency of [0,7000])await t.test(`训练返岗后台读取：${latency}毫秒响应、定时器受限时只确认一次`,async()=>{
    await setupShelter(advancedProductionScene(0)+`Math.random=()=>.9999;sm.returnReads=[];sm.confirmPanelCostMs=1600;
      s.ticks=100;s.radioProgress=.1;s.daily.counters={...s.daily.counters,train:1};s.residents[0].training=.99;
      const originalRead=window.fetch;window.fetch=(url,options)=>{
        if(url!=='/api/shelter'||!document.querySelector('[role="alertdialog"]'))return originalRead(url,options);
        const entry={start:clock,done:null};sm.returnReads.push(entry);const due=clock+${latency};
        return new Promise((resolve,reject)=>{
          const cleanup=()=>{window.removeEventListener('focus',check);options.signal.removeEventListener('abort',abort);};
          const check=()=>{if(clock<due)return;cleanup();entry.done=clock;originalRead(url,options).then(resolve,reject);};
          const abort=()=>{cleanup();reject(new DOMException('aborted','AbortError'));};
          window.addEventListener('focus',check);options.signal.addEventListener('abort',abort,{once:true});check();
        });};`);
    await drive(`!!document.querySelector('[role="alertdialog"]')`,'completed training opens confirmation');
    await withShelterBackground(async()=>{
      if(latency)await evaluate(`s.ticks++;s.radioProgress=.2;s.daily.counters.train++;s.season.points++;
        s.residents[0].stats.agi++;s.residents[0].training=0;`);
      await evaluate(`const timeout=window.setTimeout;window.setTimeout=(callback,ms,...args)=>timeout(callback,Math.max(ms||0,60000),...args);
        window.requestAnimationFrame=()=>0;`);
      await drive(`sm.calls.some(action=>action.type==='assign'&&action.residentId===5&&action.roomId===4)&&!${pending}`,
        'fresh response completes the original background confirmation',25);
      assert.equal(await evaluate('sm.calls.filter(action=>action.residentId===5).length'),1);
      assert.ok(await evaluate('sm.returnReads.length<=2'));
      const trace=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(event=>event.type==='shelter-confirmation-trace')`);
      assert.equal(trace.length,1);assert.equal(trace[0].data.phase,'confirm-click');
      assert.ok(trace[0].data.reads<=2);assert.equal(trace[0].visibility,'hidden');
    });
  });
  const delayedAssignment=alternativeTrainingReturnScene()+`sm.ui20261109=true;
    const appendWork=document.body.append.bind(document.body);document.body.append=(...nodes)=>{
      appendWork(...nodes);const dialog=nodes.find(node=>node.matches?.('[role="alertdialog"]')&&node.querySelector('h2')?.textContent.startsWith('确认调动'));
      if(dialog){window.assignDialog=dialog;dialog.style.opacity='0';sm.assignClicks=[];
        dialog.addEventListener('click',event=>sm.assignClicks.push(event.target.textContent));}};`;
  for(const changed of [false,true])await t.test(`后台调岗：等待四十秒再恢复${changed?'，目标已失效只取消':'，只确认一次'}`,async()=>{
    await setupShelter(delayedAssignment);await drive('window.assignDialog?.isConnected','owned assignment dialog');
    const original=await evaluate(pending);
    await pulse(8000);
    await withShelterBackground(async()=>{
      for(let pass=0;pass<4;pass++)await pulse(10000);
      assert.equal(await evaluate(recallEnabled),'true');assert.equal(await evaluate(`${pending}?.id`),original.id);
      assert.deepEqual(await evaluate('sm.assignClicks'),[]);assert.deepEqual(await evaluate('sm.calls'),[]);
      let trace;
      await until(async()=>{
        trace=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(event=>event.type==='shelter-confirmation-trace'&&event.data.operation===${JSON.stringify(original.id)})`);
        return trace.length>0;
      },'background scheduler records the long wait',5000);
      assert.equal(trace.length,1,JSON.stringify(await diagnose()));assert.equal(trace[0].data.phase,'waiting');
      assert.equal(trace[0].data.confirmUsable,false);assert.equal(trace[0].data.control,'confirm',JSON.stringify(trace));
    });
    await pulse(9000);await evaluate(`assignDialog.style.opacity='1';${changed?'sm.view.state.rooms.find(r=>r.id===4).unpowered=true;':''}`);
    await drive(`!assignDialog.isConnected&&!${pending}`,'resolve original assignment');
    assert.deepEqual(await evaluate('sm.assignClicks'),[changed?'取消':'确认']);
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign').map(c=>[c.residentId,c.roomId])`),changed?[]:[[5,4]]);
  });
  await t.test('后台调岗：撤销时短暂隐藏原窗口不算已取消，只能等原窗口恢复',async()=>{
    await setupShelter(delayedAssignment);await drive('window.assignDialog?.isConnected','owned dialog before cancel');
    const original=await evaluate(pending);
    await withShelterBackground(async()=>{
      await evaluate(`assignDialog.querySelector('h2').textContent='标题变化'`);await pulse();
      await evaluate(`assignDialog.hidden=true;`);await pulse(10000);await pulse(10000);
      assert.equal(await evaluate(`${pending}?.id`),original.id);assert.deepEqual(await evaluate('sm.calls'),[]);
      await evaluate(`assignDialog.hidden=false;assignDialog.style.opacity='1';`);
    });
    await drive(`!assignDialog.isConnected&&!${pending}`,'cancel only the restored dialog');
    assert.deepEqual(await evaluate('sm.assignClicks'),['取消']);assert.deepEqual(await evaluate('sm.calls'),[]);
  });
  await t.test('夜间调岗退让：取消窗持续透明，整页返回后才释放原准备并领取到期远征',async()=>{
    await setupShelter(delayedAssignment);await drive('window.assignDialog?.isConnected','owned transparent confirmation');
    const original=await evaluate(pending);
    await evaluate(`window.addEventListener('pagehide',()=>sessionStorage.setItem('night-exit-proof',JSON.stringify({clicks:sm.assignClicks,calls:sm.calls,clock,original:${pending}})));`);
    await withShelterBackground(async()=>{
      await pulse(9*60000);
      await until(()=>evaluate(`${panel}.getElementById('status').textContent.includes('取消按钮')`),'hidden cancel wait begins');
      await pulse(65000);
      await until(()=>evaluate(`location.pathname==='/activities/expedition'&&typeof addRuns==='function'`),'hidden confirmation yields to expedition',4500);
      const proof=await evaluate(`JSON.parse(sessionStorage.getItem('night-exit-proof'))`);
      assert.deepEqual(proof.clicks,[]);assert.deepEqual(proof.calls,[]);
      assert.equal(proof.original.id,original.id);assert.equal(proof.original.lifecycle.phase,'prepared');
      await evaluate(`clock=${proof.clock};Math.random=()=>0;model.burst=0;model.runs=[];addRuns(6);model.runs[0].done=true;renderExp();`);
      await injectAutomation();await drive(`model.calls.some(call=>call.type==='claim')&&!${pending}`,'fresh document recovers and claims',30);
      assert.ok(await evaluate(`${state}.nextAt>clock`));
    });
  });
  for(const guard of ['manual','overlay'])await t.test('夜间调岗退让保护：'+guard,async()=>{
    await setupShelter(delayedAssignment);await drive('window.assignDialog?.isConnected','owned assignment before takeover');
    const original=await evaluate(pending);
    if(guard==='manual'){await evaluate('assignDialog.querySelector("button").focus()');await trustedStaffKey();}
    else await evaluate(`const other=document.createElement('div');other.setAttribute('role','dialog');other.textContent='人工操作';document.body.append(other);`);
    await withShelterBackground(async()=>{
      await pulse(9*60000);await pulse(65000);await pulse(65000);
      assert.equal(await evaluate('location.pathname'),'/shelter');assert.deepEqual(await evaluate(pending),original);
      assert.deepEqual(await evaluate('sm.assignClicks'),[]);assert.deepEqual(await evaluate('sm.calls'),[]);
    });
  });
  await t.test('后台调岗：后台访问到期只取消，窗口恢复时不必切回前台',async()=>{
    await setupShelter(delayedAssignment);await drive('window.assignDialog?.isConnected','owned assignment before visit deadline');
    await withShelterBackground(async()=>{
      await pulse(9*60000);await pulse(20000);await pulse(20000);
      assert.equal(await evaluate(recallEnabled),'true');assert.deepEqual(await evaluate('sm.assignClicks'),[]);
      await evaluate(`assignDialog.style.opacity='1'`);await drive(`!assignDialog.isConnected&&!${pending}`,'cancel expired assignment in background');
      assert.deepEqual(await evaluate('sm.assignClicks'),['取消']);assert.deepEqual(await evaluate('sm.calls'),[]);
    });
  });
  await t.test('调岗弹窗归属：叠有其他窗口时不点击下层，移除后只处理原确认',async()=>{
    await setupShelter(delayedAssignment);await drive('window.assignDialog?.isConnected','owned assignment before overlay');
    await evaluate(`assignDialog.style.opacity='1';window.otherDialog=document.createElement('div');otherDialog.setAttribute('role','dialog');
      otherDialog.innerHTML='<h2>手动操作</h2><button>确认</button>';document.body.append(otherDialog);`);
    await pulse(5000);await pulse(5000);assert.deepEqual(await evaluate('sm.assignClicks'),[]);assert.deepEqual(await evaluate('sm.calls'),[]);
    await evaluate('otherDialog.remove()');await drive(`!assignDialog.isConnected&&!${pending}`,'only original confirmation after overlay');
    assert.deepEqual(await evaluate('sm.assignClicks'),['确认']);
    assert.deepEqual(await evaluate(`sm.calls.map(c=>[c.residentId,c.roomId])`),[[5,4]]);
  });
  for(const currentRoom of [4,90])await t.test(`旧指定返岗：${currentRoom===4?'已在目标生产岗则归档但不报成功':'仍在训练不猜测旧单结果'}`,async()=>{
    await setupShelter(alternativeTrainingReturnScene()+'sm.ui20261109=true;');
    await drive(`Boolean(document.querySelector('[role="alertdialog"]'))`,'unbound targeted assignment before reload');
    const original=await evaluate(`const p=${pending};delete p.lifecycle;
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(p));
      sm.view.state.residents.find(r=>r.id===5).roomId=${currentRoom};p`);
    assert.deepEqual(original.targets,[5,4]);await reloadShelter();await settle('old targeted training assignment');
    assert.deepEqual(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===5)`),[]);
    if(currentRoom===4){
      assert.deepEqual(await evaluate(`${state}.assignmentRecovery?.original`),original);
      assert.equal(await evaluate(`${state}.assignmentRecovery.currentRoom`),4);assert.equal(await evaluate(pending),null);
      assert.ok(await evaluate(`${state}.campaign.trainingRest.some(entry=>entry.id===5&&entry.at===${state}.assignmentRecovery.snapshotAt)`));
      assert.ok(await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.some(e=>
        e.type==='shelter-assignment-reconciled'&&e.data.operation==='${original.id}'&&e.data.receiptConfirmed===false)`));
    }else assert.equal(await evaluate(`${pending}?.id`),original.id);
  });
  await t.test('旧指定返岗：已绑定请求但没有成功凭据，即使人已在目标岗也不归档不重发',async()=>{
    await setupShelter(alternativeTrainingReturnScene()+'sm.ui20261109=true;sm.assignUnknown=true;');
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5)`,'targeted assignment with unknown result');
    const original=await evaluate(pending);assert.equal(original.lifecycle.phase,'request-bound');
    await evaluate('sm.view.state.residents.find(r=>r.id===5).roomId=4');await reloadShelter();await settle('unknown receipt already at target');
    assert.equal(await evaluate(`${pending}?.id`),original.id);assert.ok(await evaluate(`!${state}.assignmentRecovery`));
    assert.deepEqual(await evaluate(`sm.calls.map(c=>[c.residentId,c.roomId])`),[[5,4]]);
  });
  await t.test('训练备用返岗浏览器：原生确认后直接补备用空岗，刷新不重发、不立即重训',async()=>{
    await setupShelter(alternativeTrainingReturnScene());
    await drive(`Boolean(document.querySelector('[role="alertdialog"]'))`,'alternative return native confirmation');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),0);
    await settle('confirmed alternative training return');
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>[c.residentId,c.roomId])'),[[5,4]]);
    assert.ok(await evaluate(`${state}.campaign.trainingRest.some(r=>r.id===5)`));
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>r.id!==5)`));
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('alternative return receipt survives reload');
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>[c.residentId,c.roomId])'),[[5,4]]);
  });
  for(const moment of ['居民窗口','原生确认'])await t.test(`训练备用返岗浏览器：${moment}中备用房失效时撤销旧目标`,async()=>{
    await setupShelter(alternativeTrainingReturnScene());
    await drive(moment==='居民窗口'?`Boolean(document.querySelector('[role="dialog"] select'))`:
      `Boolean(document.querySelector('[role="alertdialog"]'))`,'alternative return before target changes');
    await evaluate('sm.view.state.rooms.find(r=>r.id===4).unpowered=true;');
    await settle('invalid alternative training destination cancelled');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===4).length'),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate(`Boolean(document.querySelector('[role="alertdialog"]'))`),false);
  });
  await t.test('训练备用返岗浏览器：确认后原单未知时跨刷新保留，不重复调岗或提前记返岗',async()=>{
    await setupShelter(alternativeTrainingReturnScene()+'sm.assignUnknown=true;');
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.residentId===5)`,'alternative return sent once');
    const original=await evaluate(pending);assert.ok(original.campaignKey);
    await reloadCampaign();await settle('alternative return unknown survives reload');
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.deepEqual(await evaluate('sm.calls.filter(c=>c.type==="assign").map(c=>[c.residentId,c.roomId])'),[[5,4]]);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),90);
    assert.ok(await evaluate(`${state}.campaign.roles.some(r=>r.id===5)`));
    assert.ok(await evaluate(`!${state}.campaign.trainingRest.some(r=>r.id===5)`));
  });
  for(const change of ['居民受伤','空位被训练预留'])await t.test(`训练备用返岗浏览器：原生确认前${change}则取消未发送调岗`,async()=>{
    await setupShelter(alternativeTrainingReturnScene());
    await drive(`Boolean(document.querySelector('[role="alertdialog"]'))`,'alternative return before safety change');
    if(change==='居民受伤')await evaluate('sm.view.state.residents.find(p=>p.id===5).hp=20;');
    else await evaluate(`sm.view.state.residents.find(p=>p.id===6).roomId=90;sm.view.state.rooms.find(r=>r.id===4).width=1;
      const schedule=${state};schedule.campaign.roles.push({id:6,room:90,role:'training',at:clock,stat:'end',base:8,
        purpose:'production',until:clock+3600000,windowEnd:clock+168*3600000,destination:4});
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(schedule));`);
    await settle('unsafe alternative return cancelled');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).length'),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),90);
  });
  await t.test('生产训练返岗房升级浏览器：施工和刷新不弹提前调岗确认，完工练成后只返岗一次',async()=>{
    await setupShelter(scene({training:true,trainTarget:10},`sm.ui20261109=true;
      s.rooms.push({...s.rooms[0],id:90,type:'training',trainStat:'agi',level:1,floor:3,col:2});
      Object.assign(s.rooms.find(r=>r.id===2),{level:2,upgradeAt:clock+3600000});
      for(const p of s.residents){p.stats.agi=10;p.training=0;}
      Object.assign(s.residents[4],{roomId:90,xp:0,hp:100,training:1/6});s.residents[4].stats.agi=2;
      s.residents[5].roomId=1;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','false');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'返岗房升级',
        campaign:{roles:[{id:5,room:90,role:'training',at:clock-3600000,stat:'agi',base:2,purpose:'production',
          until:clock+3*3600000,windowEnd:clock+168*3600000,destination:2}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`));
    const original=await evaluate(`${state}.campaign.roles.find(role=>role.id===5)`);
    await settle('upgrading destination keeps training');
    assert.match(await evaluate(`${state}.campaignNote`),/原返岗房正在升级/);
    await reloadCampaign();await settle('upgrading destination survives reload');
    assert.deepEqual(await evaluate(`${state}.campaign.roles.find(role=>role.id===5)`),original);
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="assign"&&call.residentId===5).length'),0);
    assert.equal(await evaluate('sm.view.state.residents.find(person=>person.id===5).training'),1/6);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"],[role="alertdialog"]')`),null);
    assert.equal(await evaluate(pending),null);
    await evaluate('const room=sm.view.state.rooms.find(room=>room.id===2);room.upgradeAt=null;room.level=3;');
    await evaluate(`clock=Math.max(clock,${state}.nextAt);`);
    await reloadCampaign();await settle('finished upgrade keeps unfinished training');
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="assign"&&call.residentId===5).length'),0);
    assert.deepEqual(await evaluate(`${state}.campaign.roles.find(role=>role.id===5)`),original);
    await evaluate('const person=sm.view.state.residents.find(person=>person.id===5);person.stats.agi=3;person.training=0;');
    await reloadCampaign();
    await settle('early refresh waits for the next scheduled visit');
    assert.equal(await evaluate('sm.calls.filter(call=>call.type==="assign"&&call.residentId===5).length'),0);
    await evaluate(`clock=Math.max(clock,${state}.nextAt);`);
    await reloadCampaign();
    await drive(`Boolean(document.querySelector('[role="alertdialog"]'))`,'completed training native return confirmation');
    await settle('completed training returns to original diner');
    assert.deepEqual(await evaluate('sm.calls.filter(call=>call.type==="assign"&&call.residentId===5).map(call=>call.roomId)'),[2]);
    assert.ok(await evaluate(`${state}.campaign.roles.every(role=>role.id!==5)`));
    assert.ok(await evaluate(`${state}.campaign.trainingRest.some(role=>role.id===5)`));
    assert.equal(await evaluate(pending),null);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"],[role="alertdialog"]')`),null);
    await reloadCampaign();await settle('completed return survives reload');
    assert.deepEqual(await evaluate('sm.calls.filter(call=>call.type==="assign"&&call.residentId===5).map(call=>call.roomId)'),[2]);
  });
  await t.test('生产训练浏览器：按单格回报入室，刷新保留返岗空位与期限，完成后直接返岗',async()=>{
    await setupShelter(scene({training:true,trainTarget:10},`s.rooms.push({id:30,type:'training',trainStat:'end',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
      for(const p of s.residents){p.stats.end=10;p.training=0;}
      // Start with a working trainee; resting adults correctly get employment priority since 1.17.57.
      Object.assign(s.residents[4],{roomId:4,xp:0,hp:100});s.residents[4].stats.end=5;s.residents[5].roomId=1;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');`));
    await settle('production training and reserved destination');
    const role=await evaluate(`${state}.campaign.roles.find(r=>r.purpose==='production')`);
    assert.ok(role);assert.equal(role.id,5);assert.equal(role.destination,4);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),30);
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>p.roomId===4).length<=1'));
    const logged=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events
      .filter(e=>e.type==='shelter-decision-detail').flatMap(e=>e.data.rows).findLast(r=>r.kind==='assigned-role'&&r.id===5)`);
    assert.equal(logged?.windowEnd,role.windowEnd);assert.equal(logged?.destination,4);
    await reloadCampaign();await settle('production training restored');
    const restored=await evaluate(`${state}.campaign.roles.find(r=>r.id===5)`);
    assert.equal(restored.until,role.until);assert.equal(restored.windowEnd,role.windowEnd);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5&&c.roomId===30).length'),1);
    await evaluate('sm.view.state.residents.find(p=>p.id===5).stats.end=6;');
    await reloadCampaign();await settle('production trainee returns after one attribute');
    assert.ok(await evaluate('sm.calls.some(c=>c.type==="assign"&&c.residentId===5&&c.roomId===4)'));
    assert.ok(await evaluate(`${state}.campaign.trainingRest.some(r=>r.id===5)`));
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>r.id!==5)`));
    await reloadCampaign();await settle('returned worker must not restart training before a new settlement');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5&&c.roomId===30).length'),1);
    assert.notEqual(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),30);
  });
  for(const exit of ['完成一格','关闭训练'])await t.test(`历史训练浏览器：接管不重发入室，刷新固定期限，${exit}后实际返岗`,async()=>{
    await setupShelter(scene({training:true,trainTarget:6},`s.rooms.push({id:30,type:'training',trainStat:'end',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
      for(const p of s.residents){p.stats.end=10;p.training=0;}
      Object.assign(s.residents[4],{roomId:30,xp:0,hp:100,training:.9});s.residents[4].stats.end=5;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');`));
    await settle('adopt historical production training');
    const role=await evaluate(`${state}.campaign.roles.find(r=>r.id===5)`);
    assert.equal(role?.purpose,'production');assert.equal(role.base,5);assert.equal(role.destination,4);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).length'),0);
    await reloadCampaign();await settle('historical training survives refresh');
    const restored=await evaluate(`${state}.campaign.roles.find(r=>r.id===5)`);
    assert.equal(restored.until,role.until);assert.equal(restored.windowEnd,role.windowEnd);
    if(exit==='完成一格')await evaluate('const p=sm.view.state.residents.find(p=>p.id===5);p.stats.end=6;p.training=0;');
    else await evaluate(`const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.training=false;localStorage.setItem('${key}',JSON.stringify(cfg));`);
    await reloadCampaign();await settle('historical training returns');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5&&c.roomId===30).length'),0);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5&&c.roomId===4).length'),1);
    const moves=await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).map(c=>c.roomId)');
    assert.equal(moves[0],4,'先兑现训练返岗承诺，再允许正常生产优化');
    assert.equal(new Set(moves).size,moves.length,'不重复调入同一个岗位');
    assert.ok(await evaluate(`['power','diner','water','scrap'].includes(sm.view.state.rooms.find(r=>r.id===sm.view.state.residents.find(p=>p.id===5).roomId)?.type)`));
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>r.id!==5)`));
  });
  await t.test('历史岗位浏览器：普通宿舍成人和已无用途的医疗工坊电台人员进入生产',async()=>{
    for(const type of ['quarters','medbay','workshop','radio']){
      await setupShelter(scene({},`s.rooms.push({id:30,type:'${type}',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
        s.residents[4].roomId=30;s.resources.parts=100;
        localStorage.setItem('arkengine:auto-shelter:staff:v1','production');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');`));
      await settle('historical '+type+' released to production');
      const moves=await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).map(c=>c.roomId)');
      assert.ok(moves.length>0&&!moves.includes(30),type);
      assert.equal(new Set(moves).size,moves.length,type+'不得反复释放或返旧岗');
      assert.ok(await evaluate(`['power','diner','water','scrap'].includes(sm.view.state.rooms.find(r=>r.id===sm.view.state.residents.find(p=>p.id===5).roomId)?.type)`),type);
      assert.ok(await evaluate('sm.view.state.residents.every(p=>p.roomId!==null)'),type+'现有成人均已就业');
      assert.equal(await evaluate(pending),null,type);
    }
  });
  await t.test('历史训练浏览器：接管记录保存失败时停止执行且不重复入室',async()=>{
    await setupShelter(scene({training:true,trainTarget:6},`s.rooms.push({id:30,type:'training',trainStat:'end',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
      for(const p of s.residents){p.stats.end=10;p.training=0;}
      Object.assign(s.residents[4],{roomId:30,xp:0,hp:100,training:.9});s.residents[4].stats.end=5;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
        if(k==='arkengine:auto-shelter:schedule:v1'&&JSON.parse(v)?.campaign?.roles?.some(r=>r.id===5&&r.purpose==='production'))throw Error('fixture storage full');
        return original.call(this,k,v);};`));
    await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'historical adoption save blocked');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===5).length'),0);
    assert.ok(await evaluate(`!${state}?.campaign?.roles?.some(r=>r.id===5)`));
  });
  await t.test('综合调度浏览器：训练轮换不会被生产优化立即调回，属性增长后释放',async()=>{
    await setupShelter(scene({training:true,trainTarget:9},`s.rooms.push({id:30,type:'training',trainStat:'end',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');`));
    await drive(done,'training with production');
    const role=await evaluate(`${state}.campaign.roles.find(r=>r.role==='training')`);assert.ok(role);
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${role.id}).roomId`),30);
    await evaluate(`sm.view.state.residents.find(p=>p.id===${role.id}).stats.end++;`);
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(done,'release improved trainee');
    assert.ok(await evaluate(`${state}.campaign.trainingRest.some(r=>r.id===${role.id})`));
    assert.notEqual(await evaluate(`sm.view.state.residents.find(p=>p.id===${role.id}).roomId`),30);
  });
  await t.test('综合调度浏览器：训练室绑定短板属性建造，仍遵守建设额度',async()=>{
    await setupShelter(scene({training:true,trainTarget:9},`${construction}s.residents[4].stats.end=3;s.residents[4].hp=120;`));
    await drive(done,'build training stat');const calls=await evaluate('sm.calls');
    assert.equal(calls.filter(c=>c.type==='build').length,1);assert.equal(calls.find(c=>c.type==='build').room,'training');
    assert.equal(calls.find(c=>c.type==='build').trainStat,'end');assert.equal(await evaluate(pending),null);
  });
  await t.test('综合调度浏览器：即使有空地也能按第8层探险位规划下挖',async()=>{
    await setupShelter(scene({explore:true},construction));await drive(done,'exploration milestone dig');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_start','dig']);assert.equal(await evaluate('sm.view.state.digging.floor'),8);
  });
  const employmentGrowthScene=radio=>{
    const f=parent72Scene(),s=f.view.state;
    for(const [id,roomId] of [[9,null],[10,4]])s.residents.push({...structuredClone(s.residents[3]),id,name:'岗位居民'+id,roomId,familyCooldownUntil:f.view.serverTime+86400000});
    s.rooms.push({...s.rooms[0],id:30,type:'radio',floor:4,col:2,width:1,level:1});
    return scene({radio},`sm.view=${JSON.stringify(f.view)};clock=sm.view.serverTime;sm.view.state.lastSettledAt=clock;
      sm.ui20261109=true;sm.quickAssign=false;sm.confirmFamily=true;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','${radio?'production':'population'}');
      localStorage.setItem('arkengine:auto-shelter:population:v1','14');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'growth employment fixture',families:[]}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(${JSON.stringify(f.construction)}));`);
  };
  const completedEmploymentRoom=`sm.view.state.rooms.push({...sm.view.state.rooms.find(r=>r.id===4),id:31,width:1,level:1,floor:4,col:3});`;
  for(const radio of [true,false])await t.test(`人口岗位浏览器：${radio?'电台招募':'新配对'}等就业，刷新不绕过，岗位就绪自动恢复`,async()=>{
    await setupShelter(employmentGrowthScene(radio));await settle('growth waits for jobs');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),0);
    assert.match(await evaluate(`${panel}.getElementById('${radio?'shelter-campaign-status':'shelter-population-status'}').textContent`),/岗位|就业/);
    await reloadCampaign();await settle('refresh still waits for jobs');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),0);
    await evaluate(completedEmploymentRoom);await reloadCampaign();await settle('new job restores growth');
    const calls=await evaluate('sm.calls.filter(c=>c.type==="assign")');
    const job=calls.findIndex(c=>c.residentId===9&&c.roomId===31),growth=calls.findIndex(c=>c.roomId===(radio?30:5));
    assert.ok(job>=0&&growth>job,JSON.stringify(calls));
    assert.ok([4,31].includes(await evaluate('sm.view.state.residents.find(p=>p.id===9).roomId')),'employment remains productive after ordinary optimization');
    assert.equal(await evaluate(pending),null);
  });
  await t.test('人口岗位浏览器：招募后新增成人无岗，电台只释放一次，训练进度跨刷新保留',async()=>{
    await setupShelter(employmentGrowthScene(true)+`sm.view.state.residents.find(p=>p.id===9).roomId=30;
      sm.view.state.rooms.push({...sm.view.state.rooms[0],id:32,type:'training',trainStat:'str',floor:4,col:4});
      sm.view.state.residents.push({...structuredClone(sm.view.state.residents[3]),id:11,name:'原有训练',roomId:32,training:.4});
      sm.view.state.residents.push({...structuredClone(sm.view.state.residents[3]),id:12,name:'新增未就业',roomId:null});
      const saved=JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'));
      saved.campaign={roles:[{id:9,room:30,role:'radio',at:clock},{id:11,room:32,role:'training',stat:'str',base:8,at:clock}],trips:[],attempts:[],heals:[],trainingRest:[]};
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(saved));
      const settings=JSON.parse(localStorage.getItem('${key}'));settings.training=true;settings.trainTarget=10;localStorage.setItem('${key}',JSON.stringify(settings));`);
    await settle('recruit arrival stops further recruitment');await reloadCampaign();await settle('release is not repeated');
    const calls=await evaluate('sm.calls.filter(c=>c.type==="assign")');
    assert.equal(calls.filter(c=>c.residentId===9&&c.roomId===null).length,1);
    assert.ok(!calls.some(c=>c.roomId===30||c.residentId===11),JSON.stringify(calls));
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===11).training'),.4);
  });
  const radioSupplyScene=(extra='')=>scene({radio:true},`sm.ui20261109=true;sm.quickAssign=false;
    s.rooms.find(r=>r.type==='scrap').width=2;s.residents.slice(4).forEach(p=>p.roomId=4);s.residents[4].stats.cha=9;
    s.rooms.push({id:30,type:'radio',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
    Object.assign(s.rooms.find(r=>r.type==='water'),{level:1,upgradeAt:clock+2*3600000});${extra}`);
  await t.test('电台连续浏览器：施工中到岗、刷新、完工及实际招募后按目标释放',async()=>{
    await setupShelter(radioSupplyScene(`localStorage.setItem('arkengine:auto-shelter:population:v1','7');`));
    await drive(done,'radio staffed during construction');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===30).length'),1);
    const id=await evaluate(`${state}.campaign.roles.find(r=>r.role==='radio').id`);
    await reloadCampaign();await settle('radio remains staffed after refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),1);
    await evaluate(`const r=sm.view.state.rooms.find(r=>r.type==='water');clock=r.upgradeAt+1;r.upgradeAt=null;r.level=2;
      sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;sm.view.state.resources.water-=14;`);
    await reloadCampaign();await settle('radio remains staffed after real completion state');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),1);
    // Explicit observed recruit, not a claim about the game's recruitment probability.
    await evaluate(`sm.view.state.residents.push({...structuredClone(sm.view.state.residents[5]),id:7,name:'新居民7',roomId:null});`);
    await reloadCampaign();await settle('population target reached');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===${id}&&c.roomId===null).length`),1);
    await reloadCampaign();await settle('no rehire after target');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),2);
  });
  await t.test('电台连续浏览器：库存只够原人口时等待，补足后入岗，真实不足时撤岗',async()=>{
    await setupShelter(radioSupplyScene('s.resources.water=43;'));await settle('wait for extra recruit supply');
    assert.equal(await evaluate('sm.calls.length'),0);assert.match(await evaluate(`${state}.campaignNote`),/下一人口供应不足/);
    await evaluate('sm.view.state.resources.water=400;');await reloadCampaign();await settle('funded radio duty');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===30).length'),1);
    await evaluate('sm.view.state.resources.water=1;');await reloadCampaign();await settle('lost supply releases duty');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===null).length'),1);
  });
  await t.test('电台连续浏览器：开窗后供应变化撤销未发送安排，恢复后只到岗一次',async()=>{
    await setupShelter(radioSupplyScene());
    await drive(`!!document.querySelector('[data-staff-dialog]')`,'radio assignment dialog');
    await evaluate('sm.view.state.resources.water=1;');await settle('cancel invalid radio assignment');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),0);
    assert.equal(await evaluate(pending),null);
    await evaluate('sm.view.state.resources.water=400;');await reloadCampaign();await settle('radio resumes after fresh valid read');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===30).length'),1);
  });
  await t.test('电台连续浏览器：结果未知跨刷新保留原单，不补发也不记作到岗',async()=>{
    await setupShelter(radioSupplyScene('sm.assignUnknown=true;'));
    await drive('sm.calls.some(c=>c.type==="assign"&&c.roomId===30)','radio unknown assignment');
    const original=await evaluate(pending);assert.ok(original);
    await reloadCampaign();await settle('unknown radio request retained');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),1);
    assert.equal(await evaluate(`${pending}.id`),original.id);
    assert.equal(await evaluate(`${state}.campaign?.roles?.filter(r=>r.role==='radio').length??0`),0);
  });
  await t.test('电台连续浏览器：生产优化与训练共存时不挪走下一人口所需净水工',async()=>{
    await setupShelter(scene({radio:true,training:true},`sm.ui20261109=true;
      s.rooms.push({id:30,type:'radio',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
      s.rooms.push({id:90,type:'training',trainStat:'str',floor:3,col:3,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
      s.rooms.find(r=>r.type==='water').level=1;s.rooms.find(r=>r.type==='scrap').width=3;
      for(const p of s.residents){p.xp=0;p.hp=100;}
      for(const id of [3,4]){const p=s.residents.find(p=>p.id===id);p.roomId=3;p.stats.per=5;p.stats.str=1;}
      s.residents[4].roomId=30;
      Object.assign(s.residents[5],{roomId:90,training:.9});s.residents[5].stats.str=1;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'radio supply fixture',families:[],
        campaign:{roles:[{id:5,room:30,role:'radio',at:clock},{id:6,room:90,role:'training',stat:'str',base:1,at:clock}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`));
    await settle('production preserves radio supply');await reloadCampaign();await settle('same commitments after refresh');
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[3,4].includes(p.id)).every(p=>p.roomId===3)'));
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),30);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===6).training'),.9);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&[3,4,5].includes(c.residentId)).length'),0);
  });
  await t.test('综合调度浏览器：电台达到目标后释放已记录值班',async()=>{
    await setupShelter(radioSupplyScene());
    await drive(done,'radio staffing');assert.ok(await evaluate(`${state}.campaign.roles.some(r=>r.role==='radio')`));
    await evaluate(`localStorage.setItem('arkengine:auto-shelter:population:v1','6');`);
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await drive(done,'radio target reached');
    assert.ok(await evaluate('sm.calls.some(a=>a.type==="assign"&&a.roomId===null)'));
  });
  await t.test('综合调度浏览器：队员变更不是顺序变化，绑定请求发送前拒绝',async()=>{
    await setupShelter(scene({quests:true},`window.shelterTransport=(u,o)=>{const body=JSON.parse(o.body);body.action.team=[1,2];return fetch(u,{...o,body:JSON.stringify(body)});};`));
    await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'changed team blocked');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate(`${pending}.kind`),'quest-start');
  });
  await t.test('综合调度浏览器：保存出发请求键失败时不发送且保留原待确认记录',async()=>{
    await setupShelter(scene({explore:true},`const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='arkengine:auto-shelter:pending:v1'&&JSON.parse(v)?.campaignKey)throw Error('fixture storage full');return original.call(this,k,v);};`));
    await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'campaign key write blocked');
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.equal(await evaluate(`${pending}.kind`),'explore-start');
  });
  await t.test('综合调度浏览器：未知队伍出发跨刷新不补发、不误计成功次数',async()=>{
    await setupShelter(scene({quests:true},`sm.mode='unknown';`));await drive('sm.calls.length===1','unknown quest start');
    const first=await evaluate(`${pending}.id`);await reloadShelter();await drive(done,'unknown quest recovery');
    assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate(`${pending}.id`),first);assert.equal(await evaluate(`${state}.campaign?.attempts?.length??0`),0);
  });
  await t.test('综合调度浏览器：全角名字仍按原队员绑定，召回窗口规范化后可核对',async()=>{
    await setupShelter(scene({quests:true},`s.residents[4].name='居民Ａ';s.residents[5].name='居民Ｂ';`));await settle('normalized quest names');
    assert.equal(await evaluate('sm.calls[0].type'),'quest_start');
    await setupShelter(scene({explore:true},`${trip}s.residents[4].name='居民Ａ';`));await settle('normalized recall name');
    assert.equal(await evaluate('sm.calls[0].type'),'explore_recall');
  });
  await t.test('综合调度浏览器：电台为下一人口预留供应，当前够用也不提前招募',async()=>{
    await setupShelter(scene({radio:true},`const base=s.residents[5];for(let i=7;i<=18;i++)s.residents.push({...structuredClone(base),id:i,name:'居民'+i});
      s.rooms.find(r=>r.type==='quarters').width=3;s.rooms.push({id:30,type:'radio',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
      localStorage.setItem('arkengine:auto-shelter:population:v1','20');s.rooms.push({id:31,type:'door',floor:0,col:0,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});s.residents[3].roomId=31;`));
    await settle('radio future supply');assert.deepEqual(await evaluate('sm.calls'),[]);assert.match(await evaluate(`${state}.campaignNote`),/下一人口供应/);
  });
  await t.test('发展决策浏览器：先做高积分效率任务，免费赛季满档后优先装备',async()=>{
    const quests=`const q=sm.view.env.quests[0];sm.view.env.quests=[{...q,id:'low',title:'低积分'},
      {...q,id:'high',title:'高积分',rewards:{...q.rewards,seasonPoints:100}},
      {...q,id:'gear',title:'装备',rewards:{...q.rewards,seasonPoints:0,itemTier:3}}];`;
    await setupShelter(scene({quests:true},quests));await settle('highest season efficiency');
    assert.equal(await evaluate('sm.calls.find(c=>c.type==="quest_start").questId'),'high');
    await setupShelter(scene({quests:true},`${quests}s.season.points=4500;s.season.claimedFree=Array.from({length:30},(_,i)=>i+1);`));
    await settle('full season prefers gear');assert.equal(await evaluate('sm.calls.find(c=>c.type==="quest_start").questId'),'gear');
  });
  await t.test('发展决策浏览器：满床保留电台心情值班，出现空床且人口目标已满则释放',async()=>{
    await setupShelter(scene({radio:true},`const room=s.rooms.find(r=>r.type==='quarters');room.width=1;room.level=2;
      s.rooms.push({id:30,type:'radio',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});
      localStorage.setItem('arkengine:auto-shelter:population:v1','6');`));
    await settle('full housing mood staffing');assert.ok(await evaluate(`${state}.campaign.roles.some(r=>r.role==='radio')`));
    assert.match(await evaluate(`${state}.campaignNote`),/心情/);
    await evaluate(`sm.view.state.rooms.find(r=>r.type==='quarters').level=3;`);
    await pulse(await evaluate(`${state}.nextAt-clock+1000`));await settle('new beds stop recruitment at target');
    assert.ok(await evaluate('sm.calls.some(c=>c.type==="assign"&&c.roomId===null)'));
  });
  await t.test('发展决策浏览器：按区域上限推进第10层解锁，当前仍按已解锁区域出发',async()=>{
    await setupShelter(scene({explore:true,tier:1},`${construction}s.depth=9;s.resources.scrap=4000;`));
    await settle('dig for region unlock');assert.equal(await evaluate('sm.view.state.digging.floor'),10);
    assert.ok(await evaluate('sm.calls.filter(c=>c.type==="explore_start").every(c=>c.tier===0)'));
  });
  await t.test('发展决策浏览器：有预算也不在缺少留守医疗时挖入第20层',async()=>{
    await setupShelter(scene({explore:true,tier:2},`${construction}s.depth=19;s.resources.scrap=12000;
      sm.view.drops.tierPermille=[50,70,100];Object.assign(s.rooms.find(r=>r.type==='storage'),{width:3,floor:4,col:2});s.resources.stimpak=20;
      const template=s.residents[4];for(let id=7;id<=8;id++)s.residents.push({...structuredClone(template),id,name:'居民'+id});`));
    await settle('beast threshold blocked');assert.ok(!await evaluate('sm.calls.some(c=>c.type==="dig")'));
    assert.match(await evaluate(`${state}.development`),/野兽/);
  });
}
