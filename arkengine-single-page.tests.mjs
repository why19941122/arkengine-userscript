import assert from 'node:assert/strict';
import {campaignView} from './arkengine-shelter-campaign.fixture.mjs';

export async function singlePageTests({t,setupUnified,reloadUnified,evaluate,pulse,drive,secondUnified}) {
  const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
  const schedule=`JSON.parse(localStorage.getItem('arkengine:auto-encounter:schedule:v1'))`;
  const home=`location.pathname==='/activities/expedition'`;
  const disableDungeon=`localStorage.setItem('arkengine:auto-dungeon:enabled:v1','false');`;
  const timedExpedition=`window.returnAt=clock+40*60000;
    const render=renderFeature;window.renderFeature=()=>{render();if(location.pathname==='/activities/expedition'){
      const date=new Date(returnAt),pad=value=>String(value).padStart(2,'0'),time=document.createElement('p');
      time.textContent='完整到达: '+date.getFullYear()+'/'+(date.getMonth()+1)+'/'+date.getDate()+' '+pad(date.getHours())+':'+pad(date.getMinutes())+':'+pad(date.getSeconds());
      document.getElementById('running').append(time);}};`;
  await t.test('单页精简：同轮复用奇遇按钮，动画与秘境提示只更新一次，页面替换仍取新控件',async()=>{
    await setupUnified(`${disableDungeon}${timedExpedition}cm.cooldownAt=clock+360000;`);
    await drive(`location.pathname==='/cultivate'&&${schedule}?.nextAt>clock`,'cultivation cooldown ready');
    const counts=await evaluate(`(async()=>{
      const probe=document.createTextNode(''),query=document.querySelectorAll;document.body.append(probe);
      const counts=window.cultivateProbe={checks:0,animations:0,hints:0,buttons:0};
      document.querySelectorAll=function(selector){if(selector==='button')counts.buttons++;return query.call(this,selector);};
      try{for(let index=0;index<24;index++){probe.data=String(index);await Promise.resolve();await Promise.resolve();}return counts;}
      finally{document.querySelectorAll=query;delete window.cultivateProbe;probe.remove();}
    })()`);
    console.log('cultivation repeated work '+JSON.stringify(counts));
    assert.ok(counts.checks>=20);assert.equal(counts.buttons,counts.checks);
    assert.equal(counts.animations,counts.checks);assert.equal(counts.hints,counts.checks);
    await evaluate(`window.oldSeek=document.getElementById('seek');oldSeek.onclick=()=>{throw Error('Stale control');};clock=${schedule}.nextAt;cm.cooldownAt=0;renderFeature();`);
    await drive(`cm.calls.includes('choose')&&${schedule}?.nextAt>clock`,'new controls finish encounter');
    assert.deepEqual(await evaluate('cm.calls'),['seek','choose']);
    assert.equal(await evaluate('oldSeek.isConnected'),false);
  });
  await t.test('单页预约：远征四十分钟后归来，奇遇六分钟预约不滚动，提前十五秒回远征',async()=>{
    await setupUnified(`${disableDungeon}${timedExpedition}`);
    await drive(`location.pathname==='/cultivate'&&cm.calls.length===2&&${schedule}?.nextAt>clock`,'encounter finished and stays until appointment');
    const firstAt=await evaluate(`${schedule}.nextAt`),now=await evaluate('clock');
    assert.ok(firstAt-now>350000&&firstAt-now<=360000);
    await pulse(300000);
    assert.equal(await evaluate(`${schedule}.nextAt`),firstAt);
    assert.equal(await evaluate('cm.calls.length'),2);
    assert.deepEqual(await evaluate('fm.calls.filter(call=>call.type===\'navigate\').map(call=>call.path)'),['/cultivate']);
    await evaluate(`clock=${firstAt};renderFeature();`);
    await drive(`cm.calls.length===4&&${schedule}?.nextAt>clock`,'second encounter at six minutes');
    await evaluate('cm.remaining=0;clock=returnAt-20000;renderFeature();');
    await pulse(1000);assert.equal(await evaluate('location.pathname'),'/cultivate');
    await pulse(6000);await drive(home,'return just before arrival');
    assert.equal(await evaluate('fm.calls.filter(call=>call.path===\'/activities/expedition\').length'),1);
  });
  await t.test('单页预约：奇遇到期直接从农场切入，不绕远征；人工弹窗仍阻止切页',async()=>{
    await setupUnified(`${disableDungeon}${timedExpedition}
      localStorage.setItem('arkengine:auto-farm:enabled:v1','true');
      localStorage.setItem('arkengine:auto-farm:schedule:v1',JSON.stringify({nextAt:clock+120000,expeditionAt:returnAt,note:'预约'}));
      localStorage.setItem('arkengine:auto-encounter:schedule:v1',JSON.stringify({nextAt:clock+60000,note:'预约'}));`);
    await evaluate(`navFarm('/farm');const dialog=document.createElement('div');dialog.id='manual-appointment';dialog.setAttribute('role','dialog');dialog.textContent='人工窗口';document.body.append(dialog);`);
    await pulse(65000);assert.equal(await evaluate('location.pathname'),'/farm');
    await evaluate(`document.getElementById('manual-appointment').remove();`);
    await drive(`location.pathname==='/cultivate'&&cm.calls.length===2`,'direct farm to encounter');
    assert.equal(await evaluate('fm.calls.some(call=>call.path===\'/activities/expedition\')'),false);
  });
  await t.test('单页预约：修仙等待期间仍巡检避难所，紧急任务不会打断未领奇遇',async()=>{
    await setupUnified(`${disableDungeon}${timedExpedition}
      sm.view=${JSON.stringify(campaignView())};sm.view.serverTime=clock;sm.view.state.lastSettledAt=clock;
      localStorage.setItem('arkengine:auto-shelter:enabled:v1','true');
      localStorage.setItem('arkengine:auto-shelter:campaign:v1',JSON.stringify({explore:false,quests:false,training:false,medical:false,radio:false,combatGear:false,defense:true,tier:0,hours:6,stimpaks:2,reserve:2,chance:70,attempts:1,trainTarget:6}));
      localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({nextAt:clock+900000,note:'等待'}));
      cm.cooldownAt=clock+360000;`);
    await drive(`location.pathname==='/cultivate'&&${schedule}?.nextAt>clock`,'wait in cultivation');
    await evaluate(`sm.view.state.rooms.push({...sm.view.state.rooms[0],id:90,type:'door',col:0,width:1,incident:{kind:'raiders',hp:80,maxHp:80}});
      dm.encounter=true;renderFeature();const pending=document.createElement('div');pending.id='owner-block';pending.setAttribute('role','dialog');pending.textContent='人工确认';document.body.append(pending);`);
    await pulse(35000);assert.equal(await evaluate('location.pathname'),'/cultivate');
    await evaluate(`document.getElementById('owner-block').remove();`);
    await drive(`cm.calls.includes('choose')`,'claim pending reward first');
    await drive(`location.pathname==='/shelter'`,'urgent raid preempts the ordinary appointment');
    assert.equal(await evaluate('fm.calls.some(call=>call.path===\'/activities/expedition\')'),false);
  });
  await t.test('单页挂机：远征、奇遇最后一次与秘境扫荡共用一个面板并返回',async()=>{
    await setupUnified(`cm.remaining=1;dm.sweep=true;`);
    await drive(`${home}&&cm.calls.includes('choose')&&dm.remaining===0`,'complete encounter and dungeon then return',120);
    assert.deepEqual(await evaluate('cm.calls'),['seek','choose']);
    assert.equal(await evaluate(`dm.calls.filter(call=>call[0]==='sweep').length`),1);
    assert.equal(await evaluate(`document.querySelectorAll('#ark-auto-expedition').length`),1);
    assert.equal(await evaluate(`document.getElementById('ark-auto-encounter')`),null);
    assert.equal(await evaluate(`${panel}.querySelectorAll('[data-panel-section="cultivate"]').length`),1);
    assert.equal(await evaluate(`${panel}.getElementById('fog-toggle')`),null);
    assert.equal(await evaluate(`${panel}.querySelector('a[target="_blank"]')`),null);
    const visits=await evaluate(`fm.calls.filter(call=>call.type==='navigate').length`);
    await pulse(1800000);
    assert.equal(await evaluate(`fm.calls.filter(call=>call.type==='navigate').length`),visits);
  });
  await t.test('单页挂机：24次耗尽跨刷新保留预约，网页恢复额度后重新寻访',async()=>{
    await setupUnified(`${disableDungeon}cm.remaining=0;`);
    await drive(`${home}&&${schedule}?.nextAt>clock`,'exhausted quota returns');
    const nextAt=await evaluate(`${schedule}.nextAt`);
    assert.equal(new Date(nextAt+8*3600000).toISOString().slice(11,19),'04:00:00');
    await reloadUnified();
    assert.equal(await evaluate(`${schedule}.nextAt`),nextAt);
    await pulse(1800000);
    assert.deepEqual(await evaluate('cm.calls'),[]);
    assert.equal(await evaluate('location.pathname'),'/activities/expedition');
    await evaluate(`cm.remaining=24;clock=${nextAt};`);
    await drive(`${home}&&cm.calls.length===2`,'native quota restored');
    assert.equal(await evaluate('cm.remaining'),23);
  });
  await t.test('单页额度迁移：旧版小时复查改为四点，已过刷新点则立即核对',async()=>{
    for(const refreshed of [false,true]){
      await setupUnified(`${disableDungeon}
        clock=Date.parse('${refreshed?'2026-10-11T04:10:00+08:00':'2026-10-10T12:00:00+08:00'}');
        localStorage.setItem('arkengine:auto-encounter:schedule:v1',JSON.stringify({
          nextAt:clock+1800000,note:'今日奇遇次数已用完，一小时后核对网页额度'}));`);
      if(refreshed){await drive('cm.calls.length===2','old exhaustion expired across four');assert.equal(await evaluate('cm.remaining'),23);}
      else{
        const nextAt=await evaluate(`${schedule}.nextAt`);
        assert.equal(nextAt,Date.parse('2026-10-11T04:00:00+08:00'));
        await pulse(10000);assert.deepEqual(await evaluate('cm.calls'),[]);
        assert.equal(await evaluate('fm.calls.filter(call=>call.type==="navigate").length'),0);
      }
    }
  });
  await t.test('单页挂机：奇遇冷却返回远征，到期才再切页',async()=>{
    await setupUnified(`${disableDungeon}cm.cooldownAt=clock+600000;`);
    await drive(`${home}&&${schedule}?.nextAt>clock`,'cooldown scheduled');
    assert.deepEqual(await evaluate('cm.calls'),[]);
    const nextAt=await evaluate(`${schedule}.nextAt`);
    await pulse(300000);
    assert.equal(await evaluate('location.pathname'),'/activities/expedition');
    await evaluate(`clock=${nextAt};`);
    await drive(`${home}&&cm.calls.length===2`,'seek once after cooldown');
  });
  await t.test('单页挂机：按钮文字不变时按明确剩余额度退出，普通禁用则预约复查',async()=>{
    for(const exhausted of [true,false]){
      await setupUnified(`${disableDungeon}${exhausted?'cm.remaining=0;cm.quotaLabel=true;':'cm.unavailable=true;'}`);
      await drive(`${home}&&${schedule}?.nextAt>clock`,'disabled native seek returns');
      const remaining=await evaluate(`${schedule}.nextAt-clock`);
      if(exhausted){
        assert.ok(remaining>3600000&&remaining<=86400000);
        assert.equal(new Date(await evaluate(`${schedule}.nextAt`)+8*3600000).toISOString().slice(11,19),'04:00:00');
      }else assert.ok(remaining>290000&&remaining<=300000);
      assert.deepEqual(await evaluate('cm.calls'),[]);
    }
  });
  await t.test('单页挂机：未领取的最后一次奖励先于耗尽判断',async()=>{
    await setupUnified(`${disableDungeon}cm.remaining=0;dm.encounter=true;`,'/cultivate');
    await drive(`${home}&&cm.calls.includes('choose')`,'last reward claimed');
    assert.deepEqual(await evaluate('cm.calls'),['choose']);
    assert.deepEqual(await evaluate(`dm.calls.filter(call=>call[0]==='encounter').map(call=>call[1])`),[1]);
  });
  await t.test('单页额度日预约：奇遇秘境均满后跨零点不切入，凌晨四点一起恢复',async()=>{
    await setupUnified(`cm.remaining=0;dm.remaining=0;
      localStorage.setItem('arkengine:auto-expedition:burst-day:v1',new Date(clock+8*3600000).toISOString().slice(0,10));`);
    await drive(`${home}&&${schedule}?.nextAt>clock&&JSON.parse(localStorage.getItem('arkengine:auto-dungeon:state:v1'))?.exhaustedDay`,'both quotas exhausted',150);
    const firstReset=await evaluate(`${schedule}.nextAt`);
    assert.equal(new Date(firstReset+8*3600000).toISOString().slice(11,19),'04:00:00');
    await reloadUnified();
    const visits=await evaluate('fm.calls.filter(call=>call.type==="navigate").length');
    for(let pass=0;pass<4;pass++)await pulse(3600000);
    await evaluate(`clock=${firstReset}-4*3600000;
      localStorage.setItem('arkengine:auto-expedition:burst-day:v1',new Date(clock+8*3600000).toISOString().slice(0,10));`);
    await pulse(1000);
    await evaluate(`clock=${firstReset}-60000;`);await pulse(1000);
    assert.equal(await evaluate('location.pathname'),'/activities/expedition');
    assert.equal(await evaluate('fm.calls.filter(call=>call.type==="navigate").length'),visits);
    assert.equal(await evaluate(`!!document.getElementById('ark-auto-expedition')&&localStorage.getItem('arkengine:auto-expedition:enabled:v1')!=='false'`),true);
    await evaluate(`clock=${firstReset};cm.remaining=24;dm.remaining=1;dm.sweep=true;`);
    await drive(`${home}&&cm.calls.length===2&&dm.calls.some(call=>call[0]==='sweep')`,'both quotas refresh at four',150);
    assert.equal(await evaluate('cm.remaining'),23);assert.equal(await evaluate('dm.remaining'),0);
  });
  await t.test('单页真实额度：今日已完成24/24次奇遇按网页零点预约，秘境仍四点刷新',async()=>{
    await setupUnified(`cm.remaining=0;cm.completedLabel=true;dm.remaining=0;
      localStorage.setItem('arkengine:auto-expedition:burst-day:v1',new Date(clock+8*3600000).toISOString().slice(0,10));`);
    await drive(`${home}&&${schedule}?.nextAt>clock&&JSON.parse(localStorage.getItem('arkengine:auto-dungeon:state:v1'))?.exhaustedDay`,'actual completed quota scheduled',150);
    const reset=Date.parse('2026-10-11T00:00:00+08:00');
    assert.equal(await evaluate(`${schedule}.nextAt`),reset);
    await reloadUnified();
    const visits=await evaluate('fm.calls.filter(call=>call.type==="navigate").length');
    const dungeonVisits=await evaluate('fm.calls.filter(call=>call.path==="/cultivate/dungeon").length');
    for(let pass=0;pass<3;pass++)await pulse(3600000);
    assert.equal(await evaluate('fm.calls.filter(call=>call.type==="navigate").length'),visits);
    await evaluate(`clock=${reset};cm.remaining=24;renderFeature();
      localStorage.setItem('arkengine:auto-expedition:burst-day:v1',new Date(clock+8*3600000).toISOString().slice(0,10));`);
    await drive(`${home}&&cm.calls.length===2`,'encounter resumes at advertised midnight',100);
    assert.equal(await evaluate('dm.remaining'),0);
    assert.equal(await evaluate('fm.calls.filter(call=>call.path==="/cultivate/dungeon").length'),dungeonVisits);
  });
  await t.test('单页真实额度：剩余一次不会误停，最后奖励优先领取',async()=>{
    await setupUnified(`${disableDungeon}cm.remaining=1;cm.completedLabel=true;`);
    await drive(`${home}&&cm.calls.length===2&&${schedule}?.nextAt>clock`,'last real encounter received',100);
    assert.equal(await evaluate(`${schedule}.nextAt`),Date.parse('2026-10-11T00:00:00+08:00'));
    assert.deepEqual(await evaluate('cm.calls'),['seek','choose']);
  });
  await t.test('单页真实额度：当前页旧五分钟预约被明确耗尽提示纠正',async()=>{
    await setupUnified(`${disableDungeon}cm.remaining=0;cm.completedLabel=true;
      localStorage.setItem('arkengine:auto-encounter:schedule:v1',JSON.stringify({nextAt:clock+300000,note:'奇遇按钮暂不可用'}));`,'/cultivate');
    await drive(`${home}&&${schedule}?.nextAt>clock+300000`,'old short recheck corrected');
    assert.equal(await evaluate(`${schedule}.nextAt`),Date.parse('2026-10-11T00:00:00+08:00'));
    assert.deepEqual(await evaluate('cm.calls'),[]);
  });
  await t.test('单页挂机：人工弹窗和未知原奇遇均阻止切页',async()=>{
    for(const kind of ['dialog','pending']){
      await setupUnified(`${disableDungeon}cm.remaining=0;
        ${kind==='dialog'?`const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.textContent='人工操作';document.body.append(dialog);`:
          `sessionStorage.setItem('cultivation:operation:fixture',JSON.stringify({input:{action:'encounter'},idempotencyKey:'original'}));`}`,'/cultivate');
      for(let index=0;index<4;index++)await pulse(10000);
      assert.equal(await evaluate('location.pathname'),'/cultivate');
      assert.deepEqual(await evaluate('cm.calls'),[]);
    }
  });
  await t.test('单页挂机：远征即将归来时不抢先访问奇遇秘境',async()=>{
    await setupUnified(`window.returnAt=clock+65000;
      const render=renderFeature;window.renderFeature=()=>{render();if(location.pathname==='/activities/expedition'){
        const date=new Date(returnAt),pad=value=>String(value).padStart(2,'0'),time=document.createElement('p');
        time.textContent='完整到达: '+date.getFullYear()+'/'+(date.getMonth()+1)+'/'+date.getDate()+' '+pad(date.getHours())+':'+pad(date.getMinutes())+':'+pad(date.getSeconds());
        document.getElementById('running').append(time);}};`);
    await pulse(5000);
    assert.equal(await evaluate('location.pathname'),'/activities/expedition');
    assert.deepEqual(await evaluate('cm.calls'),[]);
    assert.equal(await evaluate(`fm.calls.filter(call=>call.type==='navigate').length`),0);
  });
  await t.test('单页挂机：暂停总开关撤销奇遇等待，恢复后重新核对',async()=>{
    await setupUnified(`${disableDungeon}`,'/cultivate');
    await drive(`${panel}.getElementById('status').textContent.includes('随机等待')`,'encounter queued');
    await evaluate(`${panel}.getElementById('toggle').click();`);
    await pulse(10000);
    assert.deepEqual(await evaluate('cm.calls'),[]);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
    await evaluate(`${panel}.getElementById('toggle').click();`);
    await drive('cm.calls.length===2','resume global switch');
  });
  await t.test('单页挂机：旧修仙标签页与远征统一互斥，跨页保持同一个锁',async()=>{
    await setupUnified(`${disableDungeon}cm.cooldownAt=clock+600000;`);
    await drive(`${home}&&${schedule}?.nextAt>clock`,'first owner ready');
    await secondUnified(async other=>{
      await other(`cm.remaining=1;renderFeature();`);
      for(let index=0;index<3;index++){await pulse(10000);await other(`clock+=10000;window.dispatchEvent(new Event('focus'));`);}
      assert.deepEqual(await other('cm.calls'),[]);
      assert.match(await other(`${panel}.getElementById('status').textContent`),/另一挂机标签页/);
      await evaluate(`${panel}.getElementById('toggle').click();`);
      await pulse(10000);
      assert.deepEqual(await other('cm.calls'),[]);
    });
  });
  await t.test('单页挂机：迷雾页不显示助手、不导航、不消费，旧记录保持原样',async()=>{
    const journal='{"phase":"submitted","at":123}';
    await setupUnified(`localStorage.setItem('arkengine:auto-fog:enabled:v1','true');sessionStorage.setItem('arkengine:auto-fog:pending:v1','${journal}');`,'/cultivate/fog');
    await pulse(100000);
    assert.equal(await evaluate(`document.getElementById('ark-auto-expedition').hidden`),true);
    assert.deepEqual(await evaluate('cm.calls'),[]);
    assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-fog:pending:v1')`),journal);
    assert.equal(await evaluate('location.pathname'),'/cultivate/fog');
  });
  await t.test('单页挂机：旧版修仙运行锁未释放时不与新调度并行',async()=>{
    await setupUnified(`${disableDungeon}
      navigator.locks.request('arkengine:auto-encounter:tab:v1',()=>new Promise(resolve=>{window.releaseLegacy=resolve;}));`,'/cultivate');
    await drive(`${panel}.getElementById('status').textContent.includes('旧修仙标签页')`,'legacy owner respected');
    await pulse(10000);
    assert.deepEqual(await evaluate('cm.calls'),[]);
    await evaluate('releaseLegacy();');
    await drive('cm.calls.length===2','resume only after legacy owner releases');
  });
}
