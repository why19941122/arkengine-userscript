import assert from 'node:assert/strict';

export async function shelterConstructionTests({t,setupShelter,reloadShelter,evaluate,drive,pulse,trustedStaffKey}) {
  const panel="document.getElementById('ark-auto-expedition').shadowRoot";
  const pending="JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))";
  const state="JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))";
  const calls="sm.calls.filter(c=>['build','upgrade','dig'].includes(c.type))";
  const done="location.pathname==='/activities/expedition'";
  const scene=`const s=sm.view.state;sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;
    sm.view.progress.level=8;s.depth=3;s.digging=null;s.resources={scrap:300,parts:0,stimpak:0,power:100,food:100,water:100};
    const base=s.rooms[0],room=(id,type,floor,col,width=1,level=1)=>({...base,id,type,floor,col,width,level,stored:0});
    s.rooms=[room(10,'elevator',1,1),room(11,'elevator',2,1),room(12,'elevator',3,1),room(1,'power',1,2),
      room(2,'diner',1,3),room(3,'water',1,4),room(4,'scrap',1,5),room(5,'quarters',2,2,3),room(6,'storage',3,2)];
    const p=s.residents[0];s.residents=Array.from({length:8},(_,i)=>({...structuredClone(p),id:i+1,name:'居民'+(i+1),roomId:Math.floor(i/2)+1}));`;
  const config=(changes={})=>`localStorage.setItem('arkengine:auto-shelter:construction:v1',${JSON.stringify(JSON.stringify({build:true,upgrade:true,dig:true,scrapLimit:3000,partsLimit:100,scrapReserve:0,partsReserve:0,...changes}))});`;

  await t.test('运行修复浏览器：建设窗口已打开时跨过访问时限，先确认当前项目再返回',async()=>{
    await setupShelter(scene+config()+`sm.visitStart=clock;
      const originalData=shelterData;window.shelterData=()=>{if(!sm.lateRead){sm.lateRead=true;clock+=48000;}return originalData();};`);
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'late construction dialog');
    await pulse(await evaluate('sm.visitStart+62000-clock'));await drive(done,'finish late construction before returning');
    const list=await evaluate(calls);assert.equal(list.length,1);assert.equal(list[0].type,'upgrade');
    assert.equal(await evaluate(pending),null);assert.equal(await evaluate(`${state}.constructionLedger.length`),1);
    assert.match(await evaluate(`${state}.constructionNote`),/已确认开工/);
    const check=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='shelter-check').at(-1)`);
    assert.ok(check.data.visit.elapsedMs>60000);assert.ok(check.data.visit.elapsedMs<90000);
    assert.equal(check.data.visit.constructionConfirmed,true);
  });
  await t.test('运行修复浏览器：建设收尾延时有上限，不可用按钮不能持续占用页面',async()=>{
    await setupShelter(scene+config()+`sm.visitStart=clock;
      const originalData=shelterData;window.shelterData=()=>{if(!sm.lateRead){sm.lateRead=true;clock+=48000;}return originalData();};`);
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'late construction hard deadline');
    await pulse(40000);await drive(done,'hard deadline yields');assert.deepEqual(await evaluate(calls),[]);
    assert.equal(await evaluate(pending),null);
  });
  await t.test('运行修复浏览器：窗口收尾仍重核最新预算，不能借延时绕过额度下降',async()=>{
    await setupShelter(scene+config()+`sm.visitStart=clock;
      const originalData=shelterData;window.shelterData=()=>{if(!sm.lateRead){sm.lateRead=true;clock+=48000;}return originalData();};`);
    await drive(`!!document.querySelector('[data-construction-dialog]')`,'late construction before new budget');
    await evaluate(config({scrapLimit:199}));await pulse(await evaluate('sm.visitStart+62000-clock'));
    await drive(done,'updated budget cancels finishing work');assert.deepEqual(await evaluate(calls),[]);
    assert.equal(await evaluate(pending),null);
  });

  await t.test('自动建设：默认关闭，足额资源也只显示规划',async()=>{
    await setupShelter(scene);await drive(done,'default advisory');assert.deepEqual(await evaluate(calls),[]);
    assert.match(await evaluate(`${panel}.getElementById('shelter-construction-status').textContent`),/未开启/);
  });
  await t.test('自动建设设置：零额度和空保留量不保存，合法设置保存且保持折叠分组',async()=>{
    await setupShelter(scene+`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);
    const key='arkengine:auto-shelter:construction:v1';
    await evaluate(`${panel}.getElementById('shelter-build').checked=true;${panel}.getElementById('shelter-development-save').click();`);
    assert.equal(await evaluate(`localStorage.getItem('${key}')`),null);
    await evaluate(`${panel}.getElementById('shelter-scrap-limit').value='1000';${panel}.getElementById('shelter-scrap-reserve').value='';${panel}.getElementById('shelter-development-save').click();`);
    assert.equal(await evaluate(`localStorage.getItem('${key}')`),null);
    await evaluate(`${panel}.getElementById('shelter-scrap-reserve').value='200';${panel}.getElementById('shelter-development-save').click();`);
    const cfg=await evaluate(`JSON.parse(localStorage.getItem('${key}'))`);assert.equal(cfg.build,true);assert.equal(cfg.upgrade,false);assert.equal(cfg.scrapLimit,1000);assert.equal(cfg.scrapReserve,200);
    assert.equal(await evaluate(`${panel}.querySelector('[data-panel-section="shelter-development"]').open`),false);assert.deepEqual(await evaluate(calls),[]);
  });
  await t.test('自动建设：有空岗无人可补时执行增产升级，一次开工、预算记账和刷新保留',async()=>{
    await setupShelter(scene+config()+`s.residents=s.residents.filter(p=>![2,4,6,8].includes(p.id));`);
    const fixtureSearch=await evaluate('location.search');
    await drive(done,'upgrade incomplete occupancy');assert.equal((await evaluate(calls)).length,1);
    assert.equal((await evaluate(calls))[0].type,'upgrade');assert.equal(await evaluate(`${pending}`),null);
    assert.equal(await evaluate(`${state}.constructionLedger[0].scrap`),200);
    await pulse(1000);
    await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'no duplicate upgrade after refresh');
    assert.equal((await evaluate(calls)).length,1);
  });
  await t.test('自动建设：有闲置人手才建新回收站，匹配楼层位置和原生费用',async()=>{
    await setupShelter(scene+config()+`localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
      s.residents.push({...structuredClone(s.residents[0]),id:20,name:'待命居民',roomId:null});`);
    await drive(done,'new scrap room');const list=await evaluate(calls);assert.equal(list.length,1);
    assert.deepEqual(list[0],{type:'build',room:'scrap',floor:1,col:6,trainStat:null,idempotencyKey:'fixture-key'});
    assert.equal(await evaluate(`${state}.constructionLedger[0].scrap`),96);
  });
  await t.test('自动建设：无可用空间且人口扩容确有需要才下挖，确认Promise绑定一次消费',async()=>{
    await setupShelter(scene+config()+`s.depth=1;s.rooms=s.rooms.filter(r=>r.floor===1);s.rooms.push(room(5,'quarters',1,6,2,3));
      s.resources.scrap=1000;localStorage.setItem('arkengine:auto-shelter:population:v1','20');
      for(let i=9;i<=16;i++)s.residents.push({...structuredClone(s.residents[0]),id:i,name:'儿童'+i,roomId:5,adultAt:clock+3600000});
      s.residents.filter(p=>p.adultAt===0).forEach(p=>{p.stats.agi=20;p.stats.per=20;p.stats.str=20;});`);
    await drive(done,'dig capacity expansion');const list=await evaluate(calls);assert.equal(list.length,1,JSON.stringify(await evaluate(`({state:${state},pending:${pending}})`)));assert.equal(list[0].type,'dig');
    assert.equal(await evaluate(`${pending}`),null);assert.equal(await evaluate(`${state}.constructionLedger[0].scrap`),Math.ceil(120*2**1.4));
  });
  for(const [label,options] of [['废料保留量',{scrapReserve:101}],['废料额度',{scrapLimit:199}],['升级开关',{upgrade:false}]]){
    await t.test('自动建设：'+label+'不满足时不跳去消费其他备选方案',async()=>{
      await setupShelter(scene+config(options));await drive(done,'construction limited');assert.deepEqual(await evaluate(calls),[]);
      assert.match(await evaluate(`${state}.constructionNote`),/保留量|额度|未开启/);
    });
  }
  await t.test('自动建设：原生按钮费用变化时撤销，无消费和预算扣记',async()=>{
    await setupShelter(scene+config()+`sm.wrongConstructionPrice=1;`);await drive(done,'price mismatch');
    assert.deepEqual(await evaluate(calls),[]);assert.equal(await evaluate(`${state}.constructionLedger?.length||0`),0);
  });
  await t.test('自动建设：未知结果跨刷新保留原记录和额度，不能重新提交',async()=>{
    await setupShelter(scene+config()+`sm.mode='unknown';`);await drive(`${calls}.length===1`,'unknown construction');
    const saved=await evaluate(pending);assert.equal(saved.kind,'upgrade');assert.equal(saved.constructionKey,'fixture-key');
    await reloadShelter();await drive(done,'unknown construction yields');assert.equal((await evaluate(calls)).length,1);
    assert.equal(await evaluate(`${pending}.id`),saved.id);
    assert.match(await evaluate(`${panel}.getElementById('shelter-construction-status').textContent`),/200\/3000/);
  });
  await t.test('自动建设：等待确认时修改设置或人工接管均撤销原项目',async()=>{
    for(const manual of [false,true]){
      await setupShelter(scene+config());await drive(`!!document.querySelector('[data-construction-dialog]')`,'construction window opened');
      if(manual)await trustedStaffKey();
      else await evaluate(`${panel}.getElementById('shelter-upgrade').checked=false;${panel}.getElementById('shelter-development-save').click();`);
      await pulse(manual?61000:1000);await drive(done,'construction cancelled');assert.deepEqual(await evaluate(calls),[]);
    }
  });
  await t.test('自动建设：原生发送目标错误时拦截，待确认预留保留',async()=>{
    await setupShelter(scene+config()+`sm.constructionWrong=true;`);
    await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'wrong target held');
    assert.deepEqual(await evaluate(calls),[]);assert.ok(await evaluate(pending));
  });
  await t.test('自动建设：等待点击期间余额下降或另一页降低额度会撤销消费',async()=>{
    for(const change of ['balance','shared']){
      await setupShelter(scene+config());await drive(`!!document.querySelector('[data-construction-dialog]')`,'opened before resource change');
      if(change==='balance')await evaluate(`sm.view.state.resources.scrap=199;`);
      else await evaluate(config({scrapLimit:199}));
      await drive(done,'new limits reread');assert.deepEqual(await evaluate(calls),[]);
    }
  });
  await t.test('自动建设：保存待确认或原请求键失败均不发送，原文保留',async()=>{
    for(const failKey of [false,true]){
      await setupShelter(scene+config()+`const originalSet=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){if(key==='arkengine:auto-shelter:pending:v1'&&${failKey?"JSON.parse(value)?.constructionKey":"JSON.parse(value)?.kind==='upgrade'"})throw Error('fixture storage failure');return originalSet.call(this,key,value);};`);
      await drive(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')==='false'`,'construction storage failure');
      assert.deepEqual(await evaluate(calls),[]);assert.equal(Boolean(await evaluate(pending)),failKey);
    }
  });
  await t.test('自动建设：已用额度跨刷新仍限制下一笔，不重置24小时预算',async()=>{
    await setupShelter(scene+config({scrapLimit:300})+`localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:0,note:'已有建设',vaultNo:77,constructionLedger:[{id:'prior',at:clock-1000,scrap:150,parts:0}]}));`);
    const fixtureSearch=await evaluate('location.search');await drive(done,'prior spending blocks upgrade');assert.deepEqual(await evaluate(calls),[]);
    await pulse(1000);await evaluate(`document.querySelector('a[href="/shelter"]').click();history.replaceState({},'','/shelter'+${JSON.stringify(fixtureSearch)});`);
    await reloadShelter();await drive(done,'prior spending persists');assert.deepEqual(await evaluate(calls),[]);
    assert.equal(await evaluate(`${state}.constructionLedger[0].scrap`),150);
  });
  await t.test('自动建设：修仙页与默认关闭时不接管手动建设窗口',async()=>{
    await setupShelter(scene+config(),'/cultivate');await pulse(5000);assert.deepEqual(await evaluate(calls),[]);
    await setupShelter(scene+`openConstruction('upgrade',4);`);await pulse(5000);
    assert.equal(await evaluate(`!!document.querySelector('[data-construction-dialog]')`),true);assert.deepEqual(await evaluate(calls),[]);
  });
}
