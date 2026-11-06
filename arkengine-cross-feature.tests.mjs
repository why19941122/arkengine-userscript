import assert from 'node:assert/strict';
import {campaignView,levelGateView} from './arkengine-shelter-campaign.fixture.mjs';

export async function crossFeatureTests({t,setupFeatures,reloadFeatures,evaluate,pulse,drive,until,withDelayedStockNavigation}) {
  const shelterPending=`localStorage.getItem('arkengine:auto-shelter:pending:v1')`;
  const farmPending=`sessionStorage.getItem('arkengine:auto-farm:pending:v1')`;
  const shelfEnabled=`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`;
  const stock=`JSON.parse(localStorage.getItem('arkengine:auto-stock:ledger:v1'))`;
  const done=`location.pathname==='/activities/expedition'&&${stock}?.pending===null&&${stock}?.entries.length===1`;
  const oldFarm=`sessionStorage.setItem('arkengine:auto-farm:pending:v1',JSON.stringify({action:'harvest',plots:[1],at:clock-60000,reloaded:true}));
    fm.crops=[{plot:1,key:fc[0].key,at:clock-1000}];`;
  const raidWatch=`sm.view=${JSON.stringify(campaignView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
    sm.fixtureSearch=location.search;
    const shelterLink=document.createElement('a');shelterLink.href='/shelter';shelterLink.textContent='避难所';
    shelterLink.onclick=e=>{e.preventDefault();navFarm('/shelter');};document.body.append(shelterLink);
    localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({explore:false,quests:false,training:false,medical:false,
      radio:false,combatGear:false,defense:true,tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6}));
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:clock+900000,note:'普通复查尚未到期'}));
    sm.view.state.rooms.push({id:90,type:'door',floor:1,col:0,width:1,level:1,builtAt:0,upgradeAt:null,stored:0,
      unpowered:false,incident:{kind:'raiders',hp:80,maxHp:80}});`;
  await t.test('跨页防守巡检：股市未提交买入让位于在家增援，不受十五分钟预约限制',async()=>{
    await setupFeatures(raidWatch,'/stock');
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.roomId===90)`,'patrol preempts stock purchase',35);
    assert.deepEqual(await evaluate('km.calls'),[]);
    assert.ok(await evaluate('sm.reads>=1'));
    await drive(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))?.campaign?.defense?.length>0`,'first defender confirmed',30);
    const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
    const found=events.find(e=>e.type==='shelter-raid-detected'),sent=events.find(e=>e.type==='shelter-defense-submitted'),
      confirmed=events.find(e=>e.type==='shelter-defense-confirmed');
    assert.ok(found&&sent&&confirmed);assert.equal(sent.data.raidId,found.data.id);assert.equal(confirmed.data.raidId,found.data.id);
    assert.ok(sent.data.elapsedMs>=0&&sent.data.elapsedMs<30000);assert.ok(confirmed.data.elapsedMs>=sent.data.elapsedMs);
  });
  await t.test('跨页防守巡检：人工弹窗阻止切页及新买入，关闭后立即转向防守',async()=>{
    await setupFeatures(raidWatch+`const d=document.createElement('div');d.id='owner-dialog';d.setAttribute('role','dialog');d.textContent='人工确认';document.body.append(d);`,'/stock');
    await pulse(35000);
    assert.equal(await evaluate('location.pathname'),'/stock');
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.deepEqual(await evaluate('km.calls'),[]);
    await evaluate("document.getElementById('owner-dialog').remove();");
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.roomId===90)`,'raid after manual dialog closed',35);
  });
  await t.test('跨页防守巡检：总暂停阻止迟到读取导航，已返回的未知买入保留但不拖延增援',async()=>{
    await setupFeatures(raidWatch+'sm.deferRead=true;','/stock');
    await drive('typeof sm.resolveRead==="function"','deferred patrol');
    await evaluate("localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');sm.resolveRead();");
    await pulse(35000);
    assert.equal(await evaluate('location.pathname'),'/stock');
    assert.deepEqual(await evaluate('sm.calls'),[]);assert.deepEqual(await evaluate('km.calls'),[]);
    await setupFeatures(raidWatch+`sm.view.state.rooms.at(-1).incident=null;km.mode='unknown';`,'/stock');
    await drive('km.calls.length===1','original buy pending');
    const original=await evaluate(`${stock}.pending.id`);
    await evaluate("sm.view.state.rooms.at(-1).incident={kind:'raiders',hp:80,maxHp:80};");
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.roomId===90)`,'returned unknown stock yields to raid',45);
    assert.equal(await evaluate(`${stock}.pending.id`),original);
    assert.equal(await evaluate('km.calls.length'),1);
    assert.ok(await evaluate(`${stock}.pending.responseAt>=${stock}.pending.at`));
  });
  await t.test('跨页防守巡检：交易仍在传输时不切页，响应返回后保留原单并立即增援',async()=>{
    await setupFeatures(raidWatch+`sm.view.state.rooms.at(-1).incident=null;km.deferPost=true;`,'/stock');
    await drive('typeof km.resolvePost==="function"','stock post in flight');
    const original=await evaluate(`${stock}.pending.id`);
    await evaluate("sm.view.state.rooms.at(-1).incident={kind:'raiders',hp:80,maxHp:80};");
    await pulse(31000);await pulse(1000);
    assert.equal(await evaluate('location.pathname'),'/stock');assert.deepEqual(await evaluate('sm.calls'),[]);
    assert.equal(await evaluate('km.calls.length'),1);
    await evaluate('km.deferPost=false;km.resolvePost();');
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.roomId===90)`,'finished response permits defense',30);
    assert.equal(await evaluate(`${stock}.pending.id`),original);assert.equal(await evaluate('km.calls.length'),1);
  });

  await t.test('跨页防守原单：升级快照迟到仍可独立增援，旧读取不能确认原工程或紧急动作',async()=>{
    await setupFeatures(raidWatch+`const door=sm.view.state.rooms.at(-1);door.incident=null;
      sm.view=${JSON.stringify(levelGateView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      sm.view.state.rooms.push(door);sm.beforeConstructionView=structuredClone(sm.view);sm.staleConstruction=true;
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1')),trade:false,predict:false}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'检查原工程'}));
      localStorage.setItem('arkengine:auto-shelter:construction:v1',JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:10000,partsLimit:100,scrapReserve:0,partsReserve:0}));
      const fixtureFetch=window.fetch;window.fetch=async(url,options)=>{
        const response=await fixtureFetch(url,options);
        if(url==='/api/shelter'&&(sm.staleConstruction===true||sm.staleConstruction==='inside'&&location.pathname==='/shelter'))
          return new Response(JSON.stringify({...structuredClone(sm.beforeConstructionView),serverTime:clock}));
        return response;
      };`,'/shelter');
    await drive(`Boolean(JSON.parse(${shelterPending})?.result?.constructionProof)`,'upgrade receipt before stale snapshots',100);
    const original=await evaluate(`JSON.parse(${shelterPending})`);
    assert.equal(original.kind,'upgrade');
    await drive(`location.pathname==='/activities/expedition'&&JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).pendingReadOnly`,'construction read-only wait',80);
    await evaluate(`for(const view of [sm.view,sm.beforeConstructionView])view.state.rooms.find(r=>r.id===90).incident={kind:'raiders',hp:80,maxHp:80};`);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.roomId===90)`,'independent reinforcement while construction snapshot is stale',50);
    await until(()=>evaluate(`Boolean(JSON.parse(${shelterPending})?.emergency?.result?.campaignProof)`),'defense receipt belongs to emergency record');
    assert.equal(await evaluate(`JSON.parse(${shelterPending}).id`),original.id);
    await pulse(5000);await pulse(1000);
    assert.equal(await evaluate(`JSON.parse(${shelterPending}).id`),original.id);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign').length`),1,'紧急原单尚未确认时不叠加第二笔');
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).constructionLedger?.length||0`),0);
    const synchronizedAt=await evaluate('sm.staleConstruction=false;clock');
    await drive(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).constructionLedger?.some(e=>e.id===${JSON.stringify(original.id)})`,'both records confirmed only after fresh state arrives',60);
    assert.ok(await evaluate(`clock-${synchronizedAt}<60000`));
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='upgrade').length`),1);
    const ledger=await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).constructionLedger`);
    assert.equal(ledger.filter(e=>e.id===original.id).length,1);
    assert.equal(ledger.find(e=>e.id===original.id).scrap,original.before.construction.project.cost.scrap);
    assert.deepEqual(await evaluate('km.calls'),[]);
  });

  await t.test('跨页防守原单：仍在传输时保留原记录，不并发写入',async()=>{
    for(const mode of ['unknown']){
      await setupFeatures(raidWatch+`sm.view.state.rooms.at(-1).incident=null;sm.view.state.rooms.find(r=>r.type==='scrap').stored=63;
        sm.mode='${mode}';localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'等待原领取'}));
        localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1')),trade:false}));`,'/shelter');
      await drive(`location.pathname==='/activities/expedition'&&JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).pendingReadOnly`,'original collection waits read-only',90);
      const original=await evaluate(shelterPending);
      if(mode==='unknown')assert.equal(JSON.parse(original).result,undefined);
      else assert.equal(JSON.parse(original).result.status,503);
      await evaluate(`sm.view.state.rooms.at(-1).incident={kind:'raiders',hp:80,maxHp:80};
        if(sm.mode==='unknown'){sm.view.state.stats.collected=63;sm.view.state.rooms.find(r=>r.type==='scrap').stored=0;}`);
      const reads=await evaluate('sm.reads');await pulse(31000);await pulse(1000);
      assert.ok(await evaluate(`sm.reads>${reads}`),'仍巡检来袭');
      assert.equal(await evaluate('location.pathname'),'/activities/expedition');
      assert.equal(await evaluate(shelterPending),original);
      assert.equal(await evaluate('sm.calls.length'),1);
      assert.deepEqual(await evaluate('km.calls'),[]);
    }
  });

  await t.test('隔离防守：原领取已返回但结果未知，增援追击及刷新复岗均保留原单且不重领',async()=>{
    await setupFeatures(raidWatch+`sm.view.state.rooms.at(-1).incident=null;sm.view.state.rooms.find(r=>r.type==='scrap').stored=63;
      sm.mode='error';localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'原领取待核对'}));
      localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1')),trade:false}));`,'/shelter');
    await drive(`location.pathname==='/activities/expedition'&&JSON.parse(${shelterPending})?.result?.status===503`,'returned original collection retained',90);
    const original=await evaluate(`JSON.parse(${shelterPending})`);
    const posts=await evaluate('sm.view.state.residents.map(p=>({id:p.id,room:p.roomId}))');
    await evaluate(`sm.mode='success';sm.view.state.rooms.at(-1).incident={kind:'raiders',hp:80,maxHp:80};`);
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.roomId===90)`,'independent defense does not wait for original receipt',50);
    await drive(`sm.view.state.residents.every(p=>p.roomId===90)&&!JSON.parse(${shelterPending}).emergency`,'all defenders confirmed in separate records',120);
    assert.deepEqual(await evaluate(`JSON.parse(${shelterPending})`),original);
    await reloadFeatures();
    await evaluate(`sm.view.state.rooms.at(-1).incident=null;sm.view.state.rooms.find(r=>r.id===1).incident={kind:'raiders',hp:30,maxHp:80};`);
    await drive(`sm.view.state.residents.every(p=>p.roomId===1)&&!JSON.parse(${shelterPending}).emergency`,'pursue after refresh without replaying original request',150);
    await evaluate(`sm.view.state.rooms.find(r=>r.id===1).incident=null;`);
    await drive(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))?.campaign?.defense?.length===0&&!JSON.parse(${shelterPending}).emergency`,'restore jobs while original remains unknown',160);
    for(const post of posts)assert.equal(await evaluate(`sm.view.state.residents.find(p=>p.id===${post.id}).roomId`),post.room);
    assert.deepEqual(await evaluate(`JSON.parse(${shelterPending})`),original);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='collect_all'||c.type==='collect').length`),1);
    assert.deepEqual(await evaluate('km.calls'),[]);
  });

  const isolatedStart=raidWatch+`sm.view.state.rooms.at(-1).incident=null;sm.view.state.rooms.find(r=>r.type==='scrap').stored=63;
    sm.mode='error';localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'原领取待核对'}));
    localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1')),trade:false}));`;
  const originalReturned=`JSON.parse(${shelterPending})?.result?.responseFinishedAt>0`;
  await t.test('隔离防守：响应头已到但正文仍在传输时不写入，正文结束后才用新快照增援',async()=>{
    await setupFeatures(isolatedStart+`const fixtureFetch=window.fetch;window.fetch=async(url,options)=>{
      const response=await fixtureFetch(url,options);
      if(url==='/api/shelter/action'&&JSON.parse(options.body).action.type==='collect_all')
        return new Response(new ReadableStream({start(controller){sm.finishOriginalBody=()=>{controller.enqueue(new TextEncoder().encode('{}'));controller.close();};}}),{status:503});
      return response;
    };`,'/shelter');
    await drive(`typeof sm.finishOriginalBody==='function'&&JSON.parse(${shelterPending})?.result?.status===503`,'response headers observed');
    await evaluate(`sm.mode='success';sm.view.state.rooms.at(-1).incident={kind:'raiders',hp:80,maxHp:80};`);
    await pulse(31000);await pulse(1000);
    assert.equal(await evaluate('sm.calls.length'),1);
    assert.equal(await evaluate(`JSON.parse(${shelterPending}).result.responseFinishedAt??null`),null);
    await evaluate('sm.finishOriginalBody();');
    await drive(`sm.calls.some(c=>c.type==='assign'&&c.roomId===90)`,'complete response permits independent defense',50);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='collect_all').length`),1);
  });
  await t.test('隔离防守：紧急调岗也未知时只保留两份记录，刷新后不重复或继续叠加',async()=>{
    await setupFeatures(isolatedStart,'/shelter');await drive(originalReturned,'original returned');
    await evaluate(`sm.mode='success';sm.assignUnknown=true;sm.view.state.rooms.at(-1).incident={kind:'raiders',hp:80,maxHp:80};`);
    await drive(`Boolean(JSON.parse(${shelterPending})?.emergency)`,'emergency reserved separately',60);
    const original=await evaluate(shelterPending);
    await pulse(31000);await reloadFeatures();await pulse(31000);await pulse(1000);
    assert.equal(await evaluate(shelterPending),original);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='collect_all').length`),1);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='assign').length`),1);
    assert.ok(await evaluate(`JSON.parse(${shelterPending}).emergency.blockedBy===JSON.parse(${shelterPending}).id`));
  });
  await t.test('隔离防守：紧急记录保存失败不发送调岗、不覆盖原领取',async()=>{
    await setupFeatures(isolatedStart,'/shelter');await drive(originalReturned,'original returned before storage failure');
    const original=await evaluate(shelterPending);
    await evaluate(`const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){
      if(key==='arkengine:auto-shelter:pending:v1'&&JSON.parse(value)?.emergency)throw Error('fixture emergency storage failure');return originalSet.call(this,key,value);};
      sm.mode='success';sm.view.state.rooms.at(-1).incident={kind:'raiders',hp:80,maxHp:80};`);
    await drive(`${shelfEnabled}==='false'`,'failed emergency persistence stops before request',60);
    assert.equal(await evaluate(shelterPending),original);assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('隔离防守：未知调岗涉及的居民保留，其他在家居民仍能增援',async()=>{
    await setupFeatures(raidWatch+`localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({...JSON.parse(localStorage.getItem('arkengine:auto-stock:config:v1')),trade:false}));
      localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify({id:'unknown-assignment',at:clock-60000,kind:'assign',targets:[5,4],vaultNo:77,
        before:{serverTime:clock-60000,collected:0,day:sm.view.state.daily.day,month:sm.view.state.season.month,room:null},
        result:{status:503,outcome:'http-error',responseFinishedAt:clock-1000}}));`);
    await drive(`sm.view.state.residents.filter(p=>p.id!==5).every(p=>p.roomId===90)&&!JSON.parse(${shelterPending}).emergency`,'only independent residents reinforce',160);
    assert.equal(await evaluate('sm.view.state.residents.find(p=>p.id===5).roomId'),null);
    assert.ok(await evaluate('sm.calls.every(c=>c.residentId!==5)'));
    assert.equal(await evaluate(`JSON.parse(${shelterPending}).id`),'unknown-assignment');
  });
  await t.test('隔离防守医疗：未知用针不重治同一人，另一伤员可救治且继续保留原针数',async()=>{
    await setupFeatures(isolatedStart+`sm.view.state.rooms.find(r=>r.type==='scrap').stored=0;sm.view.state.residents[0].hp=10;
      const cfg=JSON.parse(localStorage.getItem('arkengine:auto-shelter:campaign:v1'));cfg.medical=true;localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify(cfg));`,'/shelter');
    await drive(originalReturned,'original medical response returned');
    const original=await evaluate(`JSON.parse(${shelterPending})`);assert.equal(original.kind,'stimpak');assert.equal(original.targets[0],1);
    await evaluate(`sm.mode='success';sm.view.state.rooms.at(-1).incident={kind:'raiders',hp:80,maxHp:80};
      sm.view.state.residents[0].roomId=90;Object.assign(sm.view.state.residents[1],{roomId:90,hp:40});sm.view.state.resources.stimpak=4;`);
    await drive(`sm.calls.some(c=>c.type==='stimpak'&&c.residentId===2)`,'independent critical patient treated',50);
    await drive(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))?.campaign?.heals?.some(h=>h.id===2)&&!JSON.parse(${shelterPending}).emergency`,'independent treatment recorded');
    assert.equal(await evaluate('sm.view.state.resources.stimpak'),3);
    await evaluate('sm.view.state.residents[2].hp=30;');await pulse(31000);await pulse(1000);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='stimpak').length`),2,'原单预留一针，剩余三针不得动用两针保留量');
    assert.equal(await evaluate(`JSON.parse(${shelterPending}).id`),original.id);
    assert.equal(await evaluate(`sm.calls.filter(c=>c.type==='stimpak'&&c.residentId===1).length`),1);
  });
  await t.test('隔离防守：双记录关联损坏时保留原文并暂停，不能当作新操作重放',async()=>{
    await setupFeatures(isolatedStart,'/shelter');await drive(originalReturned,'original returned before corrupt journal');
    await evaluate(`sm.mode='success';sm.assignUnknown=true;sm.view.state.rooms.at(-1).incident={kind:'raiders',hp:80,maxHp:80};`);
    await drive(`Boolean(JSON.parse(${shelterPending})?.emergency)`,'emergency exists before corrupting linkage',60);
    await evaluate(`const record=JSON.parse(${shelterPending});record.emergency.blockedBy='different-original';localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(record));`);
    const raw=await evaluate(shelterPending),calls=await evaluate('sm.calls.length');
    await reloadFeatures();await pulse(31000);
    assert.equal(await evaluate(shelterPending),raw);assert.equal(await evaluate('sm.calls.length'),calls);
    assert.match(await evaluate("document.getElementById('ark-auto-expedition').shadowRoot.getElementById('shelter-status').textContent"),/保存记录不可读，已暂停/);
  });
  await t.test('隔离防守：紧急窗口打开后总暂停仍取消发送，保留原单和库存',async()=>{
    await setupFeatures(isolatedStart,'/shelter');await drive(originalReturned,'original returned before owner pause');
    const original=await evaluate(shelterPending),resources=await evaluate('sm.view.state.resources');
    await evaluate(`sm.mode='success';sm.view.state.rooms.at(-1).incident={kind:'raiders',hp:80,maxHp:80};`);
    await drive(`!!document.querySelector('[data-staff-dialog]')`,'independent defense window before pause',60);
    await evaluate("localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');");await pulse(31000);
    assert.equal(await evaluate(shelterPending),original);assert.equal(await evaluate('sm.calls.length'),1);
    assert.deepEqual(await evaluate('sm.view.state.resources'),resources);
  });

  await t.test('共享暂停延迟：农场、避难所和股市排队期间保存总暂停后均不继续写入或切页',async()=>{
    const status=`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent`;
    for(const path of ['/farm','/shelter','/stock']){
      await setupFeatures(`localStorage.setItem('arkengine:auto-farm:enabled:v1','true');
        fm.crops=[{plot:1,key:fc[0].key,name:fc[0].name,at:clock-1000}];`,path);
      await drive(`${status}.includes('随机等待')`,'feature queued before shared pause');
      const before=await evaluate(`({farm:${farmPending},shelter:${shelterPending},stock:${stock}})`);
      await evaluate(`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);
      await pulse(60000);
      assert.equal(await evaluate('location.pathname'),path);
      assert.equal(await evaluate(status),'已暂停');
      assert.deepEqual(await evaluate('fm.calls.filter(c=>c.type!=="read")'),[]);
      assert.deepEqual(await evaluate('sm.calls'),[]);
      assert.deepEqual(await evaluate('km.calls'),[]);
      assert.deepEqual(await evaluate(`({farm:${farmPending},shelter:${shelterPending},stock:${stock}})`),before);
    }
  });

  await t.test('玩法导航地址：损坏链接不阻断农场、避难所与股市，外站及新窗口链接不接管',async()=>{
    await setupFeatures(`localStorage.setItem('arkengine:auto-farm:enabled:v1','true');window.badNavigationClicks=[];
      for(const [href,target] of [['http://[',''],['https://example.invalid/farm',''],['/farm','_blank']]){
        const a=document.createElement('a');a.setAttribute('href',href);a.target=target;a.textContent='无效导航';
        a.onclick=event=>{event.preventDefault();badNavigationClicks.push(href);};document.body.prepend(a);
      }`);
    await drive(`fm.calls.some(c=>c.type==='plant')&&sm.calls.some(c=>c.type==='collect_all')&&${done}`,'all features skip invalid navigation links',240);
    assert.deepEqual(await evaluate('badNavigationClicks'),[]);
    assert.equal(await evaluate(`fm.calls.filter(c=>c.type==='plant').length`),1);
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['buy']);
  });

  await t.test('玩法隔离人员轮换：避难所到时限让股市运行，返回后接续原调岗而不重放',async()=>{
    const schedule=`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))`;
    const moves=`sm.calls.filter(c=>c.type==='assign')`;
    await setupFeatures(`localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      localStorage.setItem('arkengine:auto-shelter:optimize:v1','true');
      const original=sm.view.state.rooms[0],adult=sm.view.state.residents[0];
      sm.view.state.rooms=['scrap','power','diner','water','quarters'].map((type,i)=>({...original,id:i+1,type,width:i===4?3:1,stored:0}));
      sm.view.state.residents=Array.from({length:8},(_,i)=>({...structuredClone(adult),id:i+1,name:'居民'+(i+1),roomId:[2,3,4,1,1,2,3,4][i],
        stats:{str:10,per:10,end:17,cha:3,int:3,agi:10,lck:3},hp:i<3?100:1}));
      Object.assign(sm.view.state.residents[0].stats,{str:5,agi:17,per:0,end:0});
      Object.assign(sm.view.state.residents[1].stats,{str:0,agi:10,per:17,end:0});
      Object.assign(sm.view.state.residents[2].stats,{str:10,agi:0,per:10,end:0});`,'/shelter');
    await drive(`${moves}.length===1&&JSON.parse(${shelterPending})===null`,'allocation first step confirmed').catch(async error=>{
      error.message+=JSON.stringify(await evaluate(`({calls:sm.calls,schedule:${schedule},pending:${shelterPending},staff:document.getElementById('ark-auto-expedition').shadowRoot.getElementById('shelter-staff-status').textContent})`));throw error;
    });
    const id=await evaluate(`${schedule}.swap.id`);
    await pulse(61000);await drive(done,'stock served between allocation visits');
    assert.equal(await evaluate(`${moves}.length`),1);assert.equal(await evaluate(`${schedule}.swap.id`),id);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['buy']);
    await pulse(61000);await drive(`${moves}.length===4&&${schedule}.swap===null&&location.pathname==='/activities/expedition'`,'resume allocation after other feature',240);
    assert.deepEqual(await evaluate('sm.view.state.residents.slice(0,3).map(p=>p.roomId)'),[3,4,2]);
    assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(`JSON.parse(${shelterPending})`),null);
  });

  await t.test('玩法隔离探险快照：成功回执后旧探险仍在时只读等待，股市继续运行且不补领',async()=>{
    await setupFeatures(`localStorage.setItem('arkengine:auto-shelter:explore-claim:v1','true');
      const s=sm.view.state;s.rooms[0].stored=0;s.residents[0].away={kind:'explore'};
      s.explorers=[{id:11,residentId:1,startedAt:clock-3600000,returnAt:clock-1,tier:0,abyss:false,
        stimpaks:0,loot:{scrap:50,parts:0,stimpak:0,items:[]}}];sm.beforeClaimView=structuredClone(sm.view);`,'/shelter');
    await drive('sm.calls.length===1','explorer claim before stale cross-feature view');
    await until(()=>evaluate(`Boolean(JSON.parse(${shelterPending})?.result?.proof)`),'explorer receipt before cross-feature wait');
    const original=await evaluate(shelterPending);
    await evaluate(`sm.view=structuredClone(sm.beforeClaimView);sm.mode='unknown';renderShelter();`);
    await drive(done,'stock continues while stale explorer waits');
    assert.equal(await evaluate(shelterPending),original);assert.equal(await evaluate(shelfEnabled),'true');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['explore_claim']);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['buy']);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).pendingReadOnly`),JSON.parse(original).id);
  });
  await t.test('玩法隔离：避难所原领取超时只读核对时股市仍运行，保留原记录不补领',async()=>{
    await setupFeatures(`sm.mode='unknown';`,'/shelter');
    await drive('sm.calls.length===1','shelter original sent');
    const original=await evaluate(shelterPending);await pulse(31000);
    await drive(done,'stock proceeds after shelter isolation');
    assert.equal(await evaluate(shelfEnabled),'true');assert.equal(await evaluate(shelterPending),original);
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).pendingReadOnly`),JSON.parse(original).id);
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['buy']);
  });
  await t.test('玩法隔离：已暂停农场保留旧收获记录，不阻塞避难所和股市，刷新不重放',async()=>{
    await setupFeatures(oldFarm);const original=await evaluate(farmPending);
    await drive(done,'other features proceed past paused farm');
    assert.deepEqual(await evaluate('sm.calls.map(c=>c.type)'),['collect_all']);
    assert.deepEqual(await evaluate('km.calls.map(c=>c.action)'),['buy']);
    assert.equal(await evaluate(farmPending),original);
    assert.equal(await evaluate(`fm.calls.filter(c=>['plant','harvest'].includes(c.type)).length`),0);
    await reloadFeatures();await pulse(20000);
    assert.equal(await evaluate(farmPending),original);assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate('sm.calls.length'),1);
  });
  await t.test('玩法隔离：其他玩法仍在核对时避难所让出页面，不将自己永久关闭',async()=>{
    await setupFeatures(`${oldFarm}localStorage.setItem('arkengine:auto-farm:enabled:v1','true');`,'/shelter');
    await drive(`location.pathname==='/farm'`,'yield to active farm reconciliation');
    assert.equal(await evaluate(shelfEnabled),'true');assert.equal(await evaluate('sm.calls.length'),0);assert.equal(await evaluate('km.calls.length'),0);
    assert.ok(await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1')).nextAt<=clock+60000`));
    await drive(`localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'`,'farm original remains unknown');
    await pulse(61000);await drive(`sm.calls.length===1&&${done}`,'remaining features resume without manual restart');
    assert.equal(await evaluate(shelfEnabled),'true');assert.equal(await evaluate('sm.calls.length'),1);assert.equal(await evaluate('km.calls.length'),1);
  });
  await t.test('玩法隔离：股市原交易未知时仍处理避难所，不清交易记录或新建第二笔',async()=>{
    await setupFeatures(`km.mode='unknown';`,'/stock');await drive('km.calls.length===1','stock original submitted');
    await pulse(61000);await drive('sm.calls.length===1','shelter collects during stock wait');
    assert.ok(await evaluate(`${stock}.pending`));assert.equal(await evaluate('km.calls.length'),1);assert.equal(await evaluate(shelfEnabled),'true');
  });
  await t.test('玩法隔离：账号异常和人工总暂停继续停止全部玩法，不能借故障隔离恢复',async()=>{
    for(const code of [`sm.httpStatus=401;`,`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`]){
      await setupFeatures(code,'/shelter');await pulse(60000);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
      assert.equal(await evaluate('sm.calls.length'),0);assert.equal(await evaluate('km.calls.length'),0);
    }
  });
  await t.test('玩法隔离导航：暂停农场旧记录及隐藏弹窗不阻塞股市切页的有限恢复',async()=>{
    for(const extra of [oldFarm,`const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.hidden=true;document.body.append(dialog);`]){
      await setupFeatures(`localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');${extra}`);
      const original=await evaluate(farmPending);
      await evaluate(`document.querySelector('a[href="/stock"]').remove();`);
      await withDelayedStockNavigation(async(count,stopLoading)=>{
        await Promise.all([pulse(5000),until(()=>count()===1,'first stock navigation').then(stopLoading)]);
        await pulse(15000);assert.equal(count(),1);
        await Promise.all([pulse(16000),until(()=>count()===2,'single stock navigation recovery').then(stopLoading)]);
        await pulse(60000);assert.equal(count(),2);assert.equal(await evaluate('km.calls.length'),0);
        assert.equal(await evaluate(farmPending),original);
      });
    }
  });
  await t.test('玩法隔离导航：可见弹窗和仍启用的农场原记录继续阻止强制切页，解除后仅恢复一次',async()=>{
    for(const mode of ['dialog','active-farm']){
      await setupFeatures(`localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');${mode==='active-farm'?oldFarm:''}`);
      await evaluate(`document.querySelector('a[href="/stock"]').remove();`);
      await withDelayedStockNavigation(async(count,stopLoading)=>{
        await Promise.all([pulse(5000),until(()=>count()===1,'initial navigation before blocker').then(stopLoading)]);
        if(mode==='dialog')await evaluate(`const d=document.createElement('div');d.setAttribute('role','dialog');d.textContent='手动确认';document.body.append(d);`);
        else await evaluate(`localStorage.setItem('arkengine:auto-farm:enabled:v1','true');window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-farm:enabled:v1',newValue:'true'}));`);
        await pulse(31000);assert.equal(count(),1);assert.equal(await evaluate('km.calls.length'),0);
        if(mode==='dialog')await evaluate(`document.querySelector('[role="dialog"]').remove();`);
        else await evaluate(`localStorage.setItem('arkengine:auto-farm:enabled:v1','false');window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-farm:enabled:v1',newValue:'false'}));`);
        await Promise.all([pulse(),until(()=>count()===2,'resume limited navigation after blocker').then(stopLoading)]);
        await pulse(60000);assert.equal(count(),2);assert.equal(await evaluate('km.calls.length'),0);
      });
    }
  });
}
