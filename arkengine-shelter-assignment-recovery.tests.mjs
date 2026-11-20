import assert from 'node:assert/strict';

export async function shelterAssignmentRecoveryTests({t,setupShelter,reloadShelter,evaluate,pulse,drive}){
  const pending="JSON.parse(localStorage.getItem('arkengine:auto-shelter:pending:v1'))";
  const state="JSON.parse(localStorage.getItem('arkengine:auto-shelter:schedule:v1'))";
  const scene=`sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;sm.ui20261109=true;sm.view.state.depth=27;
    sm.fixtureSearch=location.search;
    localStorage.setItem('arkengine:auto-shelter:staff:v1','production');
    const originalRoom=sm.view.state.rooms[0],originalResident=sm.view.state.residents[0];
    sm.view.state.rooms=['scrap','power','diner','water','quarters','training'].map((type,index)=>
      ({...originalRoom,id:index===5?30:index+1,type,floor:index+1,col:2,width:index===0||index===4?3:1,stored:0,
        trainStat:type==='training'?'end':null}));
    sm.view.state.residents=['甲','乙','丙','丁','戊','己'].map((name,index)=>
      ({...structuredClone(originalResident),id:index+1,name,roomId:[2,3,4,1,null,null][index],training:0,
        stats:{str:3,per:3,end:3,cha:3,int:3,agi:3,lck:3}}));
    sm.view.state.residents[0].stats.str=10;sm.view.state.residents[1].stats.agi=10;
    sm.view.state.residents[2].stats.per=10;sm.view.state.residents[3].stats.end=10;
    sm.view.state.residents[4].stats.end=8;sm.view.state.residents[5].stats.end=7;`;
  const saved=`sm.originalAssignment={id:'old-v147-assignment',at:clock-720000,kind:'assign',targets:[5,30],vaultNo:77,
    lifecycle:{version:1,phase:'request-bound',page:'old-v147-page',requestKey:'old-training-request-key',boundAt:clock-720000},
    campaignKey:'old-training-request-key',before:{serverTime:clock-720000,room:null,collected:0,
      day:sm.view.state.daily.day,month:sm.view.state.season.month,
      campaign:{choice:{kind:'assign',id:5,name:'戊',room:30,targets:[5,30],role:'training',stat:'end',base:8},ids:[],hp:100}},
    result:{status:520,outcome:'http-error',responseFinishedAt:clock-678000}};
    localStorage.setItem('arkengine:auto-shelter:pending:v1',JSON.stringify(sm.originalAssignment));
    localStorage.setItem('arkengine:auto-shelter:schedule:v1',JSON.stringify({vaultNo:77,nextAt:0,note:'旧调岗等待',
      pendingReadOnly:sm.originalAssignment.id}));`;
  const recheck=`history.replaceState({},'','/shelter'+sm.fixtureSearch);renderShelter();
    document.getElementById('ark-auto-expedition').shadowRoot.getElementById('shelter-check').click();`;
  for(const training of [false,true])await t.test('调岗520浏览器：继承147旧单解除全局等待，其他居民就业且刷新保护原人 '+training,async()=>{
    await setupShelter(scene+saved+(training?`sm.view.state.residents[4].roomId=30;sm.view.state.residents[4].training=.9;`:''));
    await drive(`!${pending}&&${state}?.campaign?.assignmentHolds?.length===1`,'archive completed old request',60);
    assert.deepEqual(await evaluate(`${state}.campaign.assignmentHolds[0].original`),await evaluate('sm.originalAssignment'));
    await drive(`sm.calls.some(action=>action.type==='assign'&&action.residentId===6)&&!${pending}`,'other resident employed',100);
    assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),'true','shelter stays enabled');
    assert.equal(await evaluate(`sm.calls.some(action=>action.type==='assign'&&action.residentId===5)`),false);
    assert.equal(await evaluate(`sm.view.state.residents[4].roomId`),training?30:null);
    if(training)assert.equal(await evaluate(`sm.view.state.residents[4].training`),.9);
    await evaluate(recheck);await reloadShelter();await pulse(1000);
    assert.equal(await evaluate(`${state}.campaign.assignmentHolds.length`),1);
    assert.equal(await evaluate(`${state}.campaign.assignmentHolds[0].resolvedAt`),undefined);
    assert.equal(await evaluate(`sm.calls.some(action=>action.type==='assign'&&action.residentId===5)`),false);
    if(training){
      await evaluate(`sm.view.state.residents[4].stats.end=9;sm.view.state.residents[4].training=0;${recheck}`);
      await drive(`${state}?.campaign?.assignmentHolds[0].resolvedAt!==undefined`,'completed cell releases hold',80);
    }
  });
  for(const quick of [true,false])await t.test('调岗520浏览器：实时错误回执恢复后其他人继续，原人不因反复访问重发 '+quick,async()=>{
    await setupShelter(scene+`sm.quickAssign=${quick};const priorFetch=window.fetch;window.fetch=(url,options)=>{
      if(url==='/api/shelter/action'&&options?.method==='POST'){
        const envelope=JSON.parse(options.body);
        if(envelope.action.type==='assign'&&envelope.action.residentId===5){
          sm.calls.push({...envelope.action,idempotencyKey:envelope.idempotencyKey});
          return Promise.resolve(new Response('{}',{status:520}));
        }
      }
      return priorFetch(url,options);};`);
    await drive(`sm.calls.some(action=>action.type==='assign'&&action.residentId===5)`,'live assignment error',80);
    await drive(`${state}?.campaign?.assignmentHolds?.length===1`,'live assignment archived',80);
    await drive(`sm.calls.some(action=>action.type==='assign'&&action.residentId===6)&&!${pending}`,'live other assignment succeeds',100);
    assert.equal(await evaluate(`document.querySelector('[role="alertdialog"]')`),null);
    assert.equal(await evaluate(`sm.calls.filter(action=>action.type==='assign'&&action.residentId===5).length`),1);
    await evaluate(recheck);await reloadShelter();await pulse(20000);
    assert.equal(await evaluate(`sm.calls.filter(action=>action.type==='assign'&&action.residentId===5).length`),1);
    assert.equal(await evaluate(`${state}.campaign.assignmentHolds[0].original.result.status`),520);
  });
}
