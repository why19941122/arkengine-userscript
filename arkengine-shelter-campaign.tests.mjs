import assert from 'node:assert/strict';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

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
