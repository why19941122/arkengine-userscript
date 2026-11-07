import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {workshopBudgetCycleView} from './arkengine-shelter-campaign.fixture.mjs';
import {campaignView,levelGateView,upperStageView,materialCycleView,storageChoiceView,handyMaterialView,capacityRouteView,powerPrerequisiteView,digPowerPrerequisiteView,fullPowerPrerequisiteView,workshopUpgradeView,multiWorkshopView,workshopBuildView,workshopPowerCycleView,materialProducerCycleView,populationGrowthView,familyGrowthView,workshopChurnView,dormWorkshopCycleView,familyWorkshopCycleView,workshopFamilyReturnView} from './arkengine-shelter-campaign.fixture.mjs';

export async function shelterCampaignTests({t,setupShelter,reloadShelter,evaluate,drive,pulse,until,trustedStaffKey}){
  const key='arkengine:auto-shelter:campaign:v1',state=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`,
    pending=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))`,panel=`document.getElementById('ark-auto-expedition').shadowRoot`,
    done=`location.pathname==='/activities/expedition'&&${state}?.nextAt>clock`;
  const defaults={explore:false,quests:false,training:false,medical:false,radio:false,combatGear:false,tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6};
  const diagnose=()=>evaluate(`({calls:sm.calls,state:${state},pending:${pending},enabled:localStorage.getItem('arkengine:auto-shelter:enabled:v1'),
    status:${panel}.getElementById('shelter-status').textContent,campaign:${panel}.getElementById('shelter-campaign-status').textContent})`);
  const settle=async label=>{try{await drive(done,label);}catch(e){throw Error(e.message+' '+JSON.stringify(await diagnose()));}};
  const scene=(flags={},extra='')=>`sm.view=${JSON.stringify(campaignView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
    sm.fixtureSearch=location.search;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;const s=sm.view.state;
    localStorage.setItem('${key}',JSON.stringify(${JSON.stringify({...defaults,...flags})}));${extra}`;
  const construction=`localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:0,partsReserve:0}));`;
  const reloadCampaign=async()=>{
    await pulse(1000);await evaluate(`history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();`);await reloadShelter();
  };
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
    await setupShelter(scene({training:true},`sm.confirmFamily=true;
      for(const p of s.residents.slice(4))Object.assign(p,{roomId:5,xp:0,hp:100,familyCooldownUntil:clock+21600000,
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
  await t.test('父母优化浏览器：已有魅力训练室太慢时按预算升级，完工后入室且刷新不重复施工',async()=>{
    await setupShelter(scene({training:true},`${construction}
      for(const p of s.residents.slice(4))Object.assign(p,{roomId:5,xp:0,hp:100,familyCooldownUntil:clock+21600000,
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
    await evaluate('sm.view.state.residents.find(p=>p.id===13).roomId=6;');
    await settle('occupied quarters cancels investment');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===6).length'),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===13).roomId'),6);
    assert.equal(await evaluate(`${state}.constructionLedger?.reduce((n,r)=>n+r.scrap,0)||0`),0);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('等级投资接续浏览器：已有房满级后按原预算新建仓库，未满仓可开工且刷新不重复',async()=>{
    for(const limit of [127,128]){
      await setupShelter(levelInvestmentScene()+`ls.rooms.find(r=>r.id===6).level=3;
        sm.view.progress.score+=6;sm.view.progress.level=1+Math.floor(Math.sqrt((sm.view.progress.score-30))/1.5);
        const lc=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));lc.scrapLimit=${limit};
        localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(lc));`);
      await settle('level investment warehouse within original budget '+limit);
      const calls=await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type))');
      if(limit===127){assert.deepEqual(calls,[]);continue;}
      assert.equal(calls.length,1,JSON.stringify(await diagnose()));assert.equal(calls[0].type,'build');assert.equal(calls[0].room,'storage');
      assert.equal(await evaluate(`${state}.constructionLedger.reduce((n,r)=>n+r.scrap,0)`),128);
      assert.equal(await evaluate('sm.view.state.residents.length'),15);
      await reloadCampaign();await settle('new investment warehouse retained');
      assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build").length'),1);
    }
  });
  const handoffScene=()=>levelInvestmentScene()+`ls.rooms.find(r=>r.id===6).level=2;
    ls.rooms.push({...ls.rooms[0],id:400,type:'workshop',level:3,floor:5,col:2,width:1});
    for(const id of [9,10])ls.residents.find(p=>p.id===id).roomId=400;
    for(const p of ls.residents)if(ls.rooms.some(r=>r.id===p.roomId&&r.type==='power'))p.stats.str=10;
    ls.resources.scrap=5000;ls.resources.parts=45;
    sm.view.progress.score=2*ls.residents.length+3*ls.depth+ls.rooms.filter(r=>!['door','elevator'].includes(r.type)).reduce((n,r)=>n+r.width*r.level,0);
    sm.view.progress.level=1+Math.floor(Math.sqrt((sm.view.progress.score-30))/1.5);
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'已备齐宿舍升级',campaign:{
      roles:[9,10].map(id=>({id,room:400,role:'workshop',at:clock})),trips:[],attempts:[],heals:[],trainingRest:[]}}));`;
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
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[48,49].includes(p.id)).every(p=>[6,1000].includes(p.roomId))'));
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
    // 宿舍子女现在优先直接接第一间新房，不再为了排在临时冷却父母之后就业而等待第二间。
    assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>[48,49].includes(p.id)).map(p=>p.roomId)`),[room.id,room.id]);
    // 两名子女到岗后仍有两名已退出备料的健康成人。新策略为他们扩建相邻一格，不能当成重复建房。
    const extension=await evaluate(`sm.view.state.rooms.find(r=>r.floor===5&&r.type==='scrap'&&r.id!==${room.id})`);
    assert.ok(extension);assert.equal(extension.col,room.col+1);
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>p.roomId===null).map(p=>p.id).sort((a,b)=>a-b)'),[3,10]);
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="scrap").length'),2);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===${extension.id}).length`),0);
    await reloadCampaign();await settle('pending adjacent recycler is not duplicated');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="scrap").length'),2);
    // 夹具不自行合并房间；提供相邻同类同级完工后的真实结构规则，再验证脚本按新容量安排人员。
    await evaluate(`clock=${extension.builtAt}+1;sm.view.state.lastSettledAt=clock;
      sm.view.state.rooms.find(r=>r.id===${room.id}).width=2;
      sm.view.state.rooms=sm.view.state.rooms.filter(r=>r.id!==${extension.id});
      ${panel}.getElementById('shelter-check').click();`);
    await settle('merged recycler staffed by the remaining adults');
    await evaluate(`${panel}.getElementById('shelter-check').click();`);await settle('next staffing check fills the remaining merge vacancy');
    assert.deepEqual(await evaluate(`sm.view.state.residents.filter(p=>[3,10,48,49].includes(p.id)).map(p=>p.roomId)`),Array(4).fill(room.id),JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="build"&&c.room==="scrap").length'),2);
    await reloadCampaign();await settle('adult employment retained after reload');
    assert.ok(await evaluate(`sm.view.state.residents.filter(p=>[48,49].includes(p.id)).every(p=>
      sm.view.state.rooms.some(r=>r.id===p.roomId&&['power','diner','water','scrap','workshop'].includes(r.type)&&r.builtAt<=clock))`),JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="dig").length'),1);
  });
  await t.test('成年就业扩层浏览器：确认前待就业子女受伤则取消扩层，不为失效人选消费',async()=>{
    await setupShelter(employmentSpaceScene());const initialLedger=await evaluate(`${state}.constructionLedger`);
    await drive('!!document.querySelector("[data-construction-dialog]")','employment dig confirmation');
    await evaluate('for(const p of sm.view.state.residents)if([48,49].includes(p.id))p.hp=1;');
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
    for(let round=0;round<3;round++){
      if(round)await reloadCampaign();await settle('retain actual material shift '+round);
      assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===1).roomId'),50,JSON.stringify(await diagnose()));
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===1).length`),0);
      assert.equal(await evaluate(`${state}.campaign.materials.id`),1);
    }
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.roomId===1003)`),'adult child fills the vacancy while original worker continues making parts');
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
  await t.test('工坊人口浏览器：条件已够的原家庭先返宿舍，工坊不反复抓回释放者',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(workshopFamilyReturnView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;sm.confirmFamily=true;
      for(const p of sm.view.state.residents)if(p.familyCooldownUntil)p.familyCooldownUntil=clock-600000;
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','population');localStorage.setItem('arkengine:auto-shelter:population:v1','30');
      localStorage.setItem('arkengine:auto-shelter:level-target:v1','10');localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'原家庭返宿舍',
        families:[[1,3,6],[2,10,1000],[4,11,1004],[13,14,5]].map(([a,b,room])=>({a,b,room})),
        campaign:{roles:[{id:4,room:50,role:'workshop',at:clock}],trips:[],attempts:[],heals:[],trainingRest:[],
          materials:{vaultNo:77,id:1002,type:'scrap',level:3,targetLevel:8,finalTarget:10}}}));`));
    for(let round=0;round<3;round++){
      if(round)await reloadCampaign();await settle('ready family return '+round);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===4&&c.roomId===50).length`),0,
        'the released parent cannot be repeatedly grabbed back by workshop');
      if(await evaluate('sm.view.state.residents.find(p=>p.id===4).romance?.partnerId===11'))break;
    }
    assert.ok(await evaluate('sm.view.state.residents.filter(p=>[4,11].includes(p.id)).every(p=>p.roomId===1004)'),JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===4).romance?.partnerId'),11);
    await reloadCampaign();await settle('family stays after refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===4&&c.roomId===50).length`),0);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('家庭扩产浏览器：扩充实际接替岗位，刷新不重复，完工补员后原家庭返宿舍',async()=>{
    await setupShelter(familyGrowthScene());
    let priorCalls=0;
    for(let round=0;round<8;round++){
      await settle('family supply construction '+round);
      if(await evaluate('sm.view.state.residents.find(p=>p.id===6).romance?.partnerId===7'))break;
      const before=await evaluate(`sm.calls.filter(c=>['build','upgrade'].includes(c.type)).length`);
      assert.ok(before>0,JSON.stringify(await diagnose()));
      const pendingWork=await evaluate('sm.view.state.rooms.some(r=>r.type==="water"&&(r.builtAt>clock||r.upgradeAt!==null))');
      if(pendingWork){
        await reloadCampaign();await settle('do not duplicate pending family supply '+round);
        assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade'].includes(c.type)).length`),before);
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
    assert.equal(await evaluate('sm.view.state.resources.scrap'),2740,'120 plus 140 for two cells, each charged once');
    await reloadCampaign();await settle('sufficient family supply stops expansion');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='water').length`),builds);
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
    const first=await evaluate('sm.calls[0]');assert.equal(first.type,'assign');assert.equal(first.roomId,90);
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
    for(let round=0;round<3;round++){
      if(round)await reloadCampaign();await settle('retain material power '+round);
      assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===1).roomId'),1,JSON.stringify(await diagnose()));
      assert.ok(await evaluate('sm.view.state.residents.filter(p=>[3,10].includes(p.id)).every(p=>p.roomId===50)'),JSON.stringify(await diagnose()));
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&[1,3,10].includes(c.residentId)&&c.roomId!==50).length`),0);
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.residentId===10&&c.roomId===50).length`),1);
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
  await t.test('工坊直接接岗浏览器：打开居民窗口后目标房失效，撤销原直接调岗',async()=>{
    await setupShelter(workshopUpgradeScene(workshopBuildView())+`sm.view.state.resources.parts=100;
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
    await setupShelter(workshopPowerChainScene('arkengine-shelter-funded-power-wait.fixture.json'));
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

  await t.test('就绪升级生产者稳定浏览器：补电后先实际升级仓库，不为普通换位抽空发电房',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-funded-producer.fixture.json'));
    await settle('staffing converges before actual storage upgrade');
    const calls=await evaluate('sm.calls');
    assert.equal(calls.filter(c=>c.type==='upgrade'&&c.roomId===1026).length,1,JSON.stringify(await diagnose()));
    // 原21a和当前候选都已采用就绪投资先开工，不能要求开工前额外进行一次普通换位。
    assert.deepEqual(calls.map(c=>c.type==='assign'?[c.type,c.residentId,c.roomId]:[c.type,c.roomId]),
      [['assign',2,1027],['upgrade',1026]],'一次补电后直接开工，没有往返或多余换位');
    assert.deepEqual(await evaluate('sm.view.state.residents.filter(p=>p.roomId===1027).map(p=>p.id)'),[2]);
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('funded upgrade confirmed after refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===1026).length'),1);
  });

  await t.test('发电升级备料稳定浏览器：缺件时补电一次并保留生产者，材料齐备后实际升级',async()=>{
    // 本例单独核验缺件等待；防守快照的赛季奖励视为已领，避免奖励补齐材料提前开工。
    await setupShelter(workshopPowerChainScene('arkengine-shelter-power-material-producer.fixture.json')+
      `sm.view.state.season.claimedFree=Array.from({length:30},(_,i)=>i+1);`);
    await settle('power upgrade retains its last producer while gathering parts');
    assert.equal(await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type)).length'),0,JSON.stringify(await diagnose()));
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.roomId===1026).length'),1);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===4).roomId'),1026);
    assert.equal(await evaluate(`${state}.campaign.materials.id`),1026);
    const moves=await evaluate('sm.calls.filter(c=>c.type==="assign").length');
    await reloadCampaign();await settle('power material production survives refresh');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign").length'),moves,
      '刷新不撤工坊或重复补电 '+JSON.stringify({diagnostic:await diagnose(),calls:await evaluate('sm.calls')}));
    const before=await evaluate(`${state}.constructionLedger.map(r=>r.id)`);
    await evaluate(`sm.view.state.resources.parts=15;${panel}.getElementById('shelter-check').click();`);
    await settle('start confirmed power upgrade after parts arrive');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="upgrade"&&c.roomId===1026).length'),1,JSON.stringify(await diagnose()));
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
    await setupShelter(workshopPowerChainScene('arkengine-shelter-outage-return.fixture.json'));
    const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').map(r=>r.id)`);
    assert.equal(workers.length,10);
    for(let round=0;round<4;round++){
      await settle('direct material return during funded food outage');
      if(await evaluate(`${state}.campaign.roles.every(r=>!${JSON.stringify(workers)}.includes(r.id))`))break;
      await evaluate(`${panel}.getElementById('shelter-check').click();`);
    }
    const moves=await evaluate(`sm.calls.filter(c=>c.type==='assign'&&${JSON.stringify(workers)}.includes(c.residentId))`);
    assert.equal(moves.length,10,JSON.stringify(await diagnose()));assert.equal(new Set(moves.map(c=>c.residentId)).size,10);
    assert.ok(moves.every(c=>c.roomId!==null),'施工已被库存覆盖，不经休息中转');
    assert.ok(await evaluate(`sm.view.state.residents.filter(p=>${JSON.stringify(workers)}.includes(p.id)).every(p=>sm.view.state.rooms.some(r=>r.id===p.roomId&&r.type==='scrap'))`));
    assert.equal(await evaluate('sm.calls.filter(c=>["build","upgrade","dig"].includes(c.type)).length'),0,'原工程额度仍不足，不提前开工');
    assert.ok(await evaluate('sm.view.state.rooms.find(r=>r.type==="diner").upgradeAt>clock'));
    assert.equal(await evaluate(pending),null);
    await reloadCampaign();await settle('direct outage return remains stable after reload');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&${JSON.stringify(workers)}.includes(c.residentId)).length`),10);
  });

  await t.test('施工期间工坊复岗浏览器：打开居民窗口后停产库存不足，取消直接回收',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-outage-return.fixture.json'));
    const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').map(r=>r.id)`);
    await drive('!!document.querySelector("[role=dialog] select")','outage direct return resident window');
    await evaluate('sm.view.state.resources.food=100;');
    await settle('outage stock change cancels direct production return');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&${JSON.stringify(workers)}.includes(c.residentId)&&c.roomId!==null).length`),0,
      JSON.stringify(await diagnose()));
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
    await setupShelter(workshopPowerChainScene('arkengine-shelter-power-return.fixture.json'));
    await drive('!!document.querySelector("[role=dialog] select")','direct power return resident window');
    await evaluate('sm.view.state.residents.find(p=>p.id===37).roomId=1;');
    await settle('occupied power vacancy cancels original direct assignment');
    assert.equal(await evaluate('sm.calls.filter(c=>c.type==="assign"&&c.residentId===4&&c.roomId===1).length'),0,
      JSON.stringify(await diagnose()));
  });

  await t.test('工坊供电复岗浏览器：调岗回执未知，刷新保留原单，不继续撤人或开工',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-power-return.fixture.json'));
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

  await t.test('等级投资开工优先浏览器：仓库费用供电具备时先开工，不先触发普通换位循环',async()=>{
    await setupShelter(workshopPowerChainScene('arkengine-shelter-ready-investment.fixture.json'));
    await settle('funded level investment before discretionary staff optimization');
    const calls=await evaluate('sm.calls'),index=calls.findIndex(c=>c.type==='build'&&c.room==='storage');
    assert.ok(index>=0,JSON.stringify(await diagnose()));
    assert.ok(calls.slice(0,index).every(c=>c.type!=='assign'),'本项开工前不插入普通调岗');
    assert.equal(calls.filter(c=>c.type==='build'&&c.room==='storage').length,1);
    assert.ok(await evaluate(`${state}.constructionLedger.some(r=>r.scrap===240&&r.parts===0)`),'实际建房费用已记录');
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
    await setupShelter(employmentPriorityScene()+`sm.view.state.residents.find(p=>p.id===1).roomId=1;`);
    await drive('!!document.querySelector("[role=dialog] select")','new adult assignment window');
    await evaluate(`sm.view.state.residents.find(p=>p.id===1).roomId=1004;`);
    // 只验证当前窗口的撤销；以后可先补电腾出新空岗，再以新状态合法安排该子女。
    await drive('!document.querySelector("[role=dialog] select")','cancel original new adult window after vacancy fills');
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
    await setupShelter(workshopPowerChainScene('arkengine-shelter-vacancy-level.fixture.json'));
    await drive('!!document.querySelector("[role=dialog] select")','equal output vacancy resident window');
    await evaluate('sm.view.state.rooms.find(r=>r.id===1009).unpowered=true;');
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
    const calls=await evaluate(`sm.calls.filter(c=>['build','upgrade','assign'].includes(c.type))`),
      staffed=calls.findIndex(c=>c.type==='assign'&&c.roomId===power.id);
    assert.ok(staffed>0,JSON.stringify(calls));
    assert.ok(calls.slice(staffed+1).some(c=>c.type==='build'&&c.room==='storage'||c.type==='upgrade'),JSON.stringify(calls));
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
      if(limit===cost-1){assert.deepEqual(calls,[]);continue;}
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
      assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='dig'||c.type==='build').length`),2);
    }
  });
  await t.test('工程供电准备浏览器：有预算时先调岗再开工，预算不足不占人，刷新不重复工程',async()=>{
    for(const limit of [479,480]){
      await setupShelter(scene({},`sm.view=${JSON.stringify(powerPrerequisiteView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
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
  await t.test('路线容量浏览器：面板说明完工后扩容和合并重评，刷新不把预测库存或等级写成已完成',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(capacityRouteView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      localStorage.setItem('arkengine:auto-shelter:staff:v1','off');`));
    const verify=async()=>{
      const text=await evaluate(`${panel}.getElementById('shelter-development').textContent`);
      assert.match(text,/本项完工后才计入新增容量/);assert.match(text,/原房.*实际合并结果重算费用和工期/);
      assert.match(text,/每步开工前重评扩仓需求/);
      const routes=text.split('\n').filter(line=>line.startsWith('路线估算：'));assert.ok(routes.length);
      assert.ok(routes.every(line=>(line.match(/仓库/g)||[]).length<=1),'解除满仓后不沿用第二项扩仓');
      assert.ok(routes.filter(line=>line.includes('覆盖本阶段')).every(line=>line.includes('医务室')));
      assert.equal(await evaluate('sm.view.state.resources.scrap'),3500);assert.equal(await evaluate('sm.view.progress.level'),6);
      assert.equal(await evaluate('sm.view.state.rooms.find(r=>r.id===90).level'),1);
      assert.equal(await evaluate(`${state}.developmentTrace.active.latest.score`),108);
      assert.ok(!await evaluate(`sm.calls.some(c=>['build','upgrade','dig'].includes(c.type))`));
    };
    await settle('future storage capacity explanation');await verify();
    await reloadCampaign();await settle('future capacity remains only a forecast after reload');await verify();
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
  await t.test('攒料时间浏览器：下一步、候选和阶段记录按整批估算，刷新不恢复31小时旧提示',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(storageChoiceView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.view.state.resources.scrap=100;`));
    await settle('batch funding estimate');
    const text=()=>evaluate(`${panel}.getElementById('shelter-development').textContent`);
    assert.match(await text(),/整批.*37\.5 小时/);assert.doesNotMatch(await text(),/31\.0 小时/);
    assert.match(await evaluate(`${state}.developmentTrace.active.start.reason`),/整批.*37\.5 小时/);
    await reloadCampaign();await settle('batch funding estimate survives refresh');
    assert.match(await text(),/整批.*37\.5 小时/);assert.doesNotMatch(await text(),/31\.0 小时/);
    assert.ok(!await evaluate(`sm.calls.some(c=>['build','upgrade','dig'].includes(c.type))`));
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
    assert.match(await evaluate(`${state}.development`),/储备.*充足.*扩仓.*后续/);
    await evaluate(`sm.view.state.resources.parts=27;sm.view.state.rooms.find(r=>r.id===108).stored=3;
      sm.view.state.rooms.find(r=>r.id===7).stored=3;${panel}.getElementById('shelter-check').click();`);
    await settle('original upgrade starts despite medicine overflow');
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='upgrade'&&c.roomId===1)`),JSON.stringify(await diagnose()));
    assert.ok(!await evaluate(`sm.calls.some(c=>c.type==='build'&&c.room==='storage')`));
    assert.equal(await evaluate(`sm.view.state.rooms.find(r=>r.id===7).stored`),3,'uncollectable medicine stays in its room');
  });
  await t.test('连续备料浏览器：工坊产速改变路线估算时保持原升级，刷新、领取后开工且释放材料归属',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(materialCycleView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      ${construction}localStorage.setItem('arkengine:auto-shelter:staff:v1','production');`));
    await settle('material project remains stable after workshop staffing');
    const work=await evaluate(`${state}.campaign.roles.find(r=>r.role==='workshop')`);assert.ok(work,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`${state}.campaign.materials.id`),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===108).length`),1);
    assert.ok(!await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===${work.id}&&c.roomId===null)`));
    await reloadCampaign();await settle('material project survives refresh');
    assert.equal(await evaluate(`${state}.campaign.materials.id`),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===108).length`),1);
    await evaluate(`sm.view.state.resources.parts=27;sm.view.state.rooms.find(r=>r.id===108).stored=3;${panel}.getElementById('shelter-check').click();`);
    await settle('material project collected and built');
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
    const original=await evaluate('sm.view.state.residents.map(p=>({id:p.id,room:p.roomId}))');
    assert.equal(original.length,15);
    const workshopPeople=original.filter(p=>p.room===108).map(p=>p.id);
    assert.ok(workshopPeople.length>=1&&workshopPeople.length<=2,'现有一格工坊可能已安全补到两人，按战前实际岗位核对恢复');
    await evaluate(`sm.view.state.rooms.find(r=>r.id===900).incident={kind:'raiders',hp:80,maxHp:80};${panel}.getElementById('shelter-check').click();`);
    await drive(`sm.view.state.residents.every(p=>p.roomId===900)&&${state}.campaign.defense.length===15&&!${pending}`,'all fifteen defenders gathered across visits',320);
    assert.deepEqual(await evaluate(`${state}.campaign.materials`),material);
    assert.ok(await evaluate(`${state}.campaign.roles.some(r=>r.id===${worker.id}&&r.role==='workshop'&&r.room===108)`));
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0);
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
    assert.equal(await evaluate(`sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length`),0);
    // 后续独立生产快照：只补齐已生产存量，脚本必须实际领取，不能从目标或路线直接加库存。
    await evaluate(`sm.view.state.rooms.find(r=>r.id===108).stored=30;sm.view.state.resources.parts=0;
      sm.resultMessages={collect:'收到30 零件',collect_all:'收到30 零件'};
      ${panel}.getElementById('shelter-check').click();`);
    await settle('collect accumulated materials and start the retained project');
    const calls=await evaluate('sm.calls');
    assert.equal(calls.filter(c=>c.type==='upgrade'&&c.roomId===1).length,1);
    assert.equal(calls.filter(c=>['build','upgrade','dig'].includes(c.type)).length,1);
    const income=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-income')`);
    assert.ok(income.some(e=>e.data.reward['避难所零件']===30));
    assert.equal(await evaluate(`${state}.campaign.materials??null`),null);
    assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
  });
  await t.test('高等级备料浏览器：追7级所需零件仍安排工坊，建成后保留升级本金并按缺口值班',async()=>{
    await setupShelter(scene({},`sm.view=${JSON.stringify(upperStageView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.view.state.resources.scrap=2000;${construction}
      localStorage.setItem('arkengine:auto-shelter:staff:v1','production');`));
    await settle('level-seven materials scheduled');
    const build=await evaluate(`sm.calls.find(c=>c.type==='build'&&c.room==='workshop')`);
    assert.ok(build,JSON.stringify(await diagnose()));
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='workshop').length`),1);
    await evaluate(`clock+=600001;sm.view.state.rooms.find(r=>r.type==='workshop').builtAt=clock-1;sm.view.progress.level=6;
      ${panel}.getElementById('shelter-check').click();`);
    await settle('workshop staffed for selected level project');
    const work=await evaluate(`${state}.campaign.roles.find(r=>r.role==='workshop')`);assert.ok(work,JSON.stringify(await diagnose()));
    assert.ok(await evaluate(`sm.view.state.residents.some(p=>p.id===${work.id}&&p.roomId===${work.room})`));
    assert.ok(await evaluate(`sm.view.state.resources.scrap>=1200`));
    await reloadCampaign();await settle('level materials continue after refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='build'&&c.room==='workshop').length`),1);
    const staffed=await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===${work.room})`);
    assert.ok(staffed.length>=1&&staffed.length<=2,'现有一格工坊可补满两人');
    assert.equal(new Set(staffed.map(c=>c.residentId)).size,staffed.length,'刷新不能重复调入同一居民，新增安全补员不算往返');
    assert.equal(staffed.filter(c=>c.residentId===work.id).length,1);
    assert.ok(!await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===${work.id}&&c.roomId===null)`));
    await evaluate(`sm.view.state.resources.parts=27;sm.view.state.rooms.find(r=>r.id===${work.room}).stored=3;
      ${panel}.getElementById('shelter-check').click();`);
    await settle('level project materials collected and upgrade starts');
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='upgrade'&&c.roomId===1)`),JSON.stringify(await diagnose()));
    assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===${work.id}&&c.roomId!==${work.room})`),'备料完成必须离开工坊，允许直接接生产岗位');
    assert.ok(await evaluate(`${state}.campaign.roles.every(r=>r.id!==${work.id}||r.role!=='workshop')`));
    assert.ok(!await evaluate(`sm.calls.some(c=>c.type==='upgrade'&&c.roomId===${work.room})`));
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
    assert.match(await evaluate(`${panel}.getElementById('shelter-development-trace').textContent`),/首次观察到 5 级\/66 分/);
    await settle('completed stage exported');
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
    assert.match(await evaluate(`${state}.development`),/4 → 10 级/);
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
      await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};${extra}`));
      await drive(`Boolean(${state}?.social?.pending)`,'social pending saved');await settle('unknown social yields');
      const before=await evaluate(`${state}.social.pending`),count=await evaluate('sm.calls.length');
      assert.equal(count,extra.includes('Unknown')?1:0);
      await reloadCampaign();await settle('unknown help not replayed');assert.equal(await evaluate('sm.calls.length'),count);
      assert.equal(await evaluate(`${state}.social.pending.id`),before.id);
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
  await t.test('每日互助浏览器：原生指纹准备迟到，暂停后不得发送；次日不猜测昨日未知奖励',async()=>{
    await setupShelter(scene({help:true},`s.resources.scrap=100;sm.neighbors=${JSON.stringify(neighbors)};sm.delayHelpSend=true;`));
    await drive(`typeof sm.releaseHelpSend==='function'`,'native help preparation delayed');
    await evaluate(`const cfg=JSON.parse(localStorage.getItem('${key}'));cfg.help=false;localStorage.setItem('${key}',JSON.stringify(cfg));`);
    await pulse(16000);await evaluate('sm.releaseHelpSend();');await pulse(1000);
    assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.ok(await evaluate(`${state}.social.pending`));
    await evaluate(`sm.view.state.daily.day='2026-10-11';sm.neighbors[0].helpedToday=true;{const updated=JSON.parse(localStorage.getItem('${key}'));updated.help=true;localStorage.setItem('${key}',JSON.stringify(updated));}`);
    await reloadCampaign();await settle('yesterday unknown remains');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.ok(await evaluate(`${state}.social.pending`));
  });
  await t.test('行程恢复浏览器：成功日志恢复丢失账本，刷新后只召回原探险一次',async()=>{
    await setupShelter(scene({explore:true}));await settle('original trip confirmed');
    const original=await evaluate(`${state}.campaign.trips[0]`);
    await evaluate(`const journal=${state};journal.campaign.trips=[];localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify(journal));`);
    await pulse(6*3600000+1000);await reloadCampaign();await settle('lost trip recovered and recalled');
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
  const raidScene=scene({defense:true},`s.rooms.push({id:90,type:'door',floor:1,col:0,width:1,level:1,builtAt:0,upgradeAt:null,stored:0,unpowered:false,incident:{kind:'raiders',hp:80,maxHp:80}});`);
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
    assert.equal(await evaluate('sm.calls[0].type'),'assign');
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
    await setupShelter(raidScene);await drive(`!!document.querySelector('[data-staff-dialog]')`,'defender dialog before pause');
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
  await t.test('工坊增员浏览器：已有值班且人手富余时补第二岗，刷新不重复，收齐后两人正常结束值班',async()=>{
    await setupShelter(workshopScene+`s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1});
      s.residents.push({...structuredClone(s.residents[4]),id:7,name:'新增成人7',roomId:90});
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'已有工坊值班',
        campaign:{roles:[{id:7,room:90,role:'workshop',at:clock}],trips:[],attempts:[],heals:[],trainingRest:[]}}));`);
    await settle('fill the existing workshop');
    const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop')`);
    assert.equal(workers.length,2,JSON.stringify(await diagnose()));assert.ok(workers.every(r=>r.room===90));
    assert.ok(await evaluate('sm.view.state.residents.some(p=>p.roomId===4)'),'the funded upgrade room retains a producer');
    await reloadCampaign();await settle('retain both workers after refresh');
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign'&&c.roomId===90).length`),1);
    await evaluate(`sm.view.state.resources.parts=15;${panel}.getElementById('shelter-check').click();`);
    await settle('both shifts finish after actual stock is sufficient');
    for(const worker of workers)assert.ok(await evaluate(`sm.calls.some(c=>c.type==='assign'&&c.residentId===${worker.id}&&c.roomId===null)`));
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),0);
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
    await evaluate(`sm.view.state.resources.scrap=570;${panel}.getElementById('shelter-check').click();`);
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
  await t.test('工坊闭环浏览器：现有空工坊按需值班，刷新保留，材料备齐后释放自动岗位',async()=>{
    await setupShelter(workshopScene+`s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1});`);
    await settle('workshop staffed');const workers=await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop')`);
    assert.equal(workers.length,1,JSON.stringify(await diagnose()));assert.equal(workers[0].room,90);
    await reloadCampaign();await settle('workshop role survives reload');
    assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='assign'&&a.roomId===90).length`),1);
    await evaluate(`sm.view.state.resources.parts=15;${panel}.getElementById('shelter-check').click();`);
    await settle('materials ready release workshop');
    assert.ok(await evaluate(`sm.calls.some(a=>a.type==='assign'&&a.residentId===${workers[0].id}&&a.roomId===null)`));
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),0);
  });
  await t.test('工坊闭环浏览器：无工坊先建造，完工后自动到岗，供料不足停工且保留人工岗位',async()=>{
    await setupShelter(workshopScene);await settle('workshop construction');
    assert.ok(await evaluate(`sm.calls.some(a=>a.type==='build'&&a.room==='workshop')`),JSON.stringify(await diagnose()));
    const room=await evaluate(`sm.view.state.rooms.find(r=>r.type==='workshop').id`);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===${room}).builtAt=clock-1;${panel}.getElementById('shelter-check').click();`);
    await settle('new workshop staffed');const worker=await evaluate(`${state}.campaign.roles.find(r=>r.role==='workshop')`);
    assert.ok(worker,JSON.stringify(await diagnose()));
    await evaluate(`sm.view.state.resources.scrap=0;${panel}.getElementById('shelter-check').click();`);await settle('insufficient feed releases workshop');
    assert.equal(await evaluate(`${state}.campaign.roles.filter(r=>r.role==='workshop').length`),0);
    await evaluate(`sm.view.state.residents.find(p=>p.id===${worker.id}).roomId=${room};${panel}.getElementById('shelter-check').click();`);
    const count=await evaluate('sm.calls.length');await settle('manual worker remains');
    assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${worker.id}).roomId`),room);
    assert.equal(await evaluate('sm.calls.length'),count);
  });
  await t.test('工坊闭环浏览器：零件保留量计入备料，零建设额度不自动加工',async()=>{
    for(const limit of [0,100]){
      await setupShelter(workshopScene+`s.resources.parts=15;
        s.rooms.push({...s.rooms[0],id:90,type:'workshop',floor:2,col:4,level:1});
        const cfg=JSON.parse(localStorage.getItem('arkengine:auto-shelter:construction:v1'));cfg.partsReserve=10;cfg.partsLimit=${limit};
        localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify(cfg));`);
      await settle('parts reserve with budget '+limit);
      assert.equal(await evaluate(`sm.calls.filter(a=>a.type==='assign'&&a.roomId===90).length`),limit===0?0:1,JSON.stringify(await diagnose()));
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
    await setupShelter(scene({explore:true,sodaEfficiency:true},`${sodaReturn}sm.sodaAmount=1;`));
    await drive(`Boolean(${pending}?.result?.sodaProof)`,'soda receipt bound');const original=await evaluate(pending);
    await settle('soda history permits new trips');assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_claim','explore_start']);
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
    await setupShelter(scene({explore:true,sodaEfficiency:true},`sm.view.drops.minMinutes=180;`));
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
    await evaluate(`sm.view.state.season.points=4499;${panel}.getElementById('shelter-check').click();`);
    await drive(`sm.calls.some(c=>c.type==='quest_start')`,'useful seasonal points allow task');
  });
  await t.test('策略纠正浏览器：资源亏损但有经验的周任务可派，日志显示成长依据且刷新不重复出发',async()=>{
    await setupShelter(scene({quests:true},`s.season.points=4500;Object.assign(s.rooms.find(r=>r.id===4),{floor:2,col:5,width:2});
      for(const p of s.residents.filter(p=>p.id>=4))p.roomId=4;
      sm.view.env.quests[0].rewards={scrap:0,parts:0,itemTier:null,seasonPoints:0};`));
    await drive(`Boolean(${pending}?.before?.campaign?.choice?.assessment?.growth)`,'weekly growth assessment');
    const choice=await evaluate(`${pending}.before.campaign.choice`);
    assert.ok(choice.assessment.growth.expectedUsefulXp>0);assert.ok(choice.assessment.scrapNetOnSuccess<0);
    assert.match(choice.reason,/有效经验/);assert.match(choice.reason,/未计返程和疗伤/);
    assert.match(await evaluate(`${panel}.getElementById('shelter-campaign-status').textContent`),/有效经验/);
    await settle('growth quest confirmed');assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['quest_start']);
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
  await t.test('综合调度浏览器：默认关闭，折叠面板和设置独立保存',async()=>{
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
  await t.test('综合调度浏览器：普通探险先出发，周任务另选队并记次数',async()=>{
    await setupShelter(scene({explore:true,quests:true}));await settle('combined missions');
    const calls=await evaluate('sm.calls');assert.deepEqual(calls.map(a=>a.type),['explore_start','quest_start']);
    assert.ok(!calls[1].team.includes(calls[0].residentId));assert.equal(await evaluate(`${state}.campaign.attempts.length`),1);assert.equal(await evaluate(pending),null);
  });
  await t.test('综合调度浏览器：自动装备只穿闲置武器，再按实际战力出发',async()=>{
    await setupShelter(scene({explore:true,combatGear:true},`s.items=[{id:101,slot:'weapon',name:'步枪',damage:[4,8]},{id:102,slot:'weapon',name:'值班武器',damage:[99,99]}];s.residents[0].weaponId=102;`));
    await drive(done,'combat equip then depart');const calls=await evaluate('sm.calls');
    assert.deepEqual(calls.map(a=>a.type),['equip','explore_start']);assert.equal(calls[0].slot,'weapon');assert.equal(calls[0].itemId,101);
    assert.equal(await evaluate('sm.view.state.residents[0].weaponId'),102);assert.equal(await evaluate(pending),null);
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
  await t.test('综合调度浏览器：电台到目标后释放脚本值班，手动岗位不接管',async()=>{
    await setupShelter(scene({radio:true},`s.rooms.push({id:30,type:'radio',floor:3,col:2,width:1,level:1,builtAt:0,stored:0,upgradeAt:null,incident:null,unpowered:false});`));
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
