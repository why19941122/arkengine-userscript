// 按公开前端的主殿、秘境、alertdialog 和原请求记录构造；只在本机测试。
import { expeditionMarkup } from './arkengine-expedition.fixture.mjs';

const dungeonPageMarkup = `<!doctype html><meta charset="utf-8"><title>本地秘境测试</title>
<main id="game"></main><script>
window.clock = Date.parse('2026-10-10T10:00:00+08:00');
Date.now = () => clock;
const fixtureTimeout = window.setTimeout.bind(window);
window.dm = JSON.parse(sessionStorage.getItem('fixture:dungeon') || 'null') || {
  remaining: 5, limit: 5, runs: 0, current: null, recent: '', message: '', error: false,
  busy: false, calls: [], cooledUntil: 0, mode: '', blocked: -1, malformed: false, encounter: false,
  entryBlocked: false, entryReason: '', dungeonMissing: false
};
window.persistDun = () => sessionStorage.setItem('fixture:dungeon', JSON.stringify(dm));
window.nativeDun = () => JSON.parse(sessionStorage.getItem('dungeon:77') || 'null');
const nativeFixtureFetch=window.fetch;
window.fetch=function(...args) {
 if(dm.sweepFetch && new URL(args[0],location.href).pathname==='/api/cultivation/dungeons') {
   const request=JSON.parse(args[1].body);
   const body=dm.sweepResponse || {dungeonName:'坠星古墓',trips:Array.from({length:request.times},()=>({finished:true,rewards:{exp:1000}})),activeRunId:null,stopReason:'已完成请求次数'};
   window.sweepFetchPromise=Promise.resolve(new Response(JSON.stringify(body),{status:dm.sweepStatus||200,headers:{'Content-Type':'application/json'}}));
   return window.sweepFetchPromise;
 }
 return Reflect.apply(nativeFixtureFetch,this,args);
};
window.goDun = path => { dm.calls.push(['navigate', path]); history.pushState({}, '', path); renderDun(); };
window.dunRewards = [
 ['修为 +999999', '钻石 +1', '钻石 +5'],
 ['修为 +9,999', '修为 +1.2万', '修为 +100'],
 ['钻石 +5 · 修为 +100', '钻石 +5 · 修为 +200', '钻石 +4 · 修为 +9999'],
 ['修为 +0.01亿', '修为 +10', '修为 +900'],
 ['修为 +100', '钻石 +2', '修为 +2000'],
 ['修为 +100', '修为 +20', '修为 +300'],
 ['钻石 +1', '钻石 +8', '钻石 +2'],
 ['修为 +50', '修为 +60', '修为 +70']
];
window.applyDun = record => {
 const input = record.input;
 if (input.action === 'enter') {
   dm.remaining--; dm.runs++;
   dm.current = { node: 0, id: 'run-' + dm.runs, name: '坠星古墓' };
   dm.message = '已进入秘境，节点选择会在服务端保存';
 } else if (input.action === 'sweep') {
   const completed = Math.min(input.times, dm.remaining, dm.sweepCompleted ?? input.times);
   dm.remaining -= completed; dm.runs += completed;
   dm.recent = '扫荡最近探索 完成于 ' + clock;
   dm.sweepResult = { completed, partial: !!dm.sweepPartial, reason: dm.sweepReason || '已完成请求次数' };
   if (dm.sweepPartial) {
     dm.remaining--; dm.runs++;
     dm.current = {node:3,id:'sweep-partial',name:'坠星古墓'};
   }
   dm.message = '按上次路线通关 ' + completed + ' 次。' + dm.sweepResult.reason;
 } else {
   if (!dm.current || input.runId !== dm.current.id || input.nodeIndex !== dm.current.node) throw Error('重复或错误的节点选择');
   dm.current.node++;
   if (dm.current.node === 8) {
     dm.current = null;
     dm.recent = '本次奖励 修为 +12345 · 完成于 ' + clock;
     dm.cooledUntil = clock + (dm.manualCooldownMinutes ?? 40) * 60000;
     dm.message = '秘境探索完成，本次累计：' + (dm.finalReward || '修为 +12345');
   } else dm.message = '节点奖励已入账：修为 +100';
 }
 dm.busy = false;
 sessionStorage.removeItem('dungeon:77');
 renderDun();
};
window.submitDun = (input, recover = false) => {
 const record = nativeDun() || {input, idempotencyKey: crypto.randomUUID()};
 sessionStorage.setItem('dungeon:77', JSON.stringify(record));
 dm.calls.push([recover ? 'recover' : input.action, record.input, record.idempotencyKey]);
 if (input.action === 'sweep') dm.sweepResult = null;
 dm.busy = true; dm.message = ''; renderDun();
 if (dm.mode === 'busy:' + input.action) return;
 fixtureTimeout(async () => {
   if (input.action === 'sweep' && dm.sweepFetch) {
     const promise=fetch('/api/cultivation/dungeons',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...record.input,idempotencyKey:record.idempotencyKey,...dm.sweepRequestOverride})});
     dm.sameFetchPromise=promise===window.sweepFetchPromise;
     const response=await promise;dm.responseUnused=!response.bodyUsed;const body=await response.json();
     if(response.ok) {
       applyDun(record);
       if(dm.sweepStateDelayed&&dm.current){dm.refreshedCurrent=dm.current;dm.current=null;}
       if(dm.hideSweepResult){dm.sweepResult=null;dm.message='';}
       if(dm.sweepAfterError){dm.error=true;dm.message='秘境状态读取失败';}
     } else {if(response.status===400)sessionStorage.removeItem('dungeon:77');dm.busy=false;dm.error=true;dm.message=body.error||'秘境操作失败';}
     renderDun();
   } else if (input.action === 'enter' && dm.mode === 'quota-rejected') {
     // 网站明确拒绝后会清除原请求，但次数要等只读刷新才能更新。
     sessionStorage.removeItem('dungeon:77'); dm.refreshedRemaining=0;
     dm.busy=false; dm.error=true; dm.message='今日秘境次数已用完'; renderDun();
   } else if (!recover && dm.mode === input.action) {
     dm.busy = false; dm.message = '网络结果未确认'; renderDun();
   } else applyDun(record);
 }, 20);
};
window.openDun = (name = '坠星古墓', own = false) => {
 dm.calls.push(['open', name]);
 const box = document.createElement('div'); box.setAttribute('role', 'alertdialog');
 box.innerHTML = '<h2>确认操作</h2><div>进入' + name + '将消耗 50 钻石和 20 灵力，是否继续？</div><button>取消</button><button>确认</button>';
 box.querySelectorAll('button')[0].onclick = () => box.remove();
 box.querySelectorAll('button')[1].onclick = () => {
   const close = () => { box.remove(); game.removeAttribute('inert'); game.removeAttribute('aria-hidden'); };
   // 模拟公开 Base UI 的关闭完成回调：即使没有 CSS 动画，也先等一帧。
   if (dm.animationClose && !globalThis.BASE_UI_ANIMATIONS_DISABLED) requestAnimationFrame(close);
   else close();
   Promise.resolve().then(() => submitDun({action:'enter', dungeonId: name === '坠星古墓' ? 9 : 10}));
 };
 document.body.append(box);
 if (dm.animationClose) { game.setAttribute('inert',''); game.setAttribute('aria-hidden','true'); }
};
// 2026-11-10 公开前端 0imgqmmcw5xnl.js：原生 select、确认文案、sweep 原请求和结果区。
window.openSweep = () => {
 const times=dm.sweepTimes || 1, box=document.createElement('div'); box.setAttribute('role','alertdialog');
 box.innerHTML='<h2>按上次路线扫荡</h2><div>'+(times>1?'连续进入坠星古墓 '+times+' 次':'进入坠星古墓')+
 '，每次消耗 50 钻石和 20 灵力（共 '+(50*times)+' 钻石、'+(20*times)+' 灵力），按上次路线自动选完全部节点。资源不够或次数用完会提前停下。是否继续？</div><button>取消</button><button>确认</button>';
 box.querySelectorAll('button')[0].onclick=()=>box.remove();
 box.querySelectorAll('button')[1].onclick=()=>{box.remove();Promise.resolve().then(()=>submitDun({action:'sweep',sourceRunId:'previous-route',times}));};
 document.body.append(box);
};
window.renderDun = () => {
 if(location.pathname==='/activities/expedition'){
   renderExp();
   const link=document.createElement('a');link.href='/cultivate';link.textContent='奇遇';
   link.onclick=event=>{event.preventDefault();goDun('/cultivate');};game.append(link);return;
 }
 const isDungeon = location.pathname === '/cultivate/dungeon';
 if (!isDungeon) {
   game.innerHTML = '<a href="/cultivate/dungeon">秘境</a><button aria-label="刷新修炼状态">刷新</button><button id="seek" disabled>奇遇冷却 5:30</button>';
   if (dm.encounter) {
     const section = document.createElement('section'); section.id = 'cultivation-encounter';
     section.innerHTML = ['修为 +1','钻石 +2','修为 +3'].map((r,i) => '<button data-choice="'+i+'"><span>选项<span class="block text-caption">'+r+'</span></span></button>').join('');
     section.onclick = e => { const b=e.target.closest('button'); if(!b) return; dm.calls.push(['encounter',Number(b.dataset.choice)]); dm.encounter=false; renderDun(); };
     game.append(section);
   }
 } else {
   game.innerHTML = '<a href="/cultivate">返回修仙主殿</a><h1>秘境行记</h1><button id="refresh-dun" aria-label="刷新秘境状态">刷新</button><div aria-live="polite">今日剩余 '+dm.remaining+'/'+dm.limit+' 次</div>';
   document.getElementById('refresh-dun').disabled = !!dm.refreshing;
   document.getElementById('refresh-dun').onclick = () => {
     dm.calls.push(['refresh']);
     if (dm.refreshMode === 'unobserved') { persistDun(); return; }
     dm.refreshing=true;
     renderDun();
     if (dm.refreshMode === 'pending') return;
     fixtureTimeout(() => {
       dm.refreshing=false;
       if (dm.refreshMode === 'failed') { dm.error=true; dm.message='秘境状态读取失败'; }
       else {
         if (Number.isInteger(dm.refreshedRemaining)) { dm.remaining=dm.refreshedRemaining; delete dm.refreshedRemaining; }
         if (Object.hasOwn(dm,'refreshedCurrent')) { dm.current=dm.refreshedCurrent; delete dm.refreshedCurrent; }
       }
       renderDun();
     }, 20);
   };
   if(dm.cooldownLabel) {
     const badge=document.createElement('span');badge.setAttribute('aria-label',dm.cooldownLabel);badge.textContent='倒计时';game.append(badge);
   }
   if (dm.message) {
     const notice = document.createElement('p'); notice.setAttribute('role','status'); notice.setAttribute('aria-live','polite');
     notice.textContent=dm.message; if(dm.error) notice.className='text-destructive'; game.append(notice);
   }
   if(dm.current) {
     const section = document.createElement('section'); section.className='game-card';
     section.innerHTML='<p>探索中 · '+dm.current.name+'</p><h2>节点 '+(dm.current.node+1)+'</h2><p>第 '+(dm.current.node+1)+'/8 节 · 当前评分 100</p><p>本次累计：钻石 +999999</p><div></div>';
     dunRewards[dm.current.node].forEach((reward,index) => {
       const b=document.createElement('button'); b.disabled=dm.busy || !!nativeDun() || dm.blocked===index;
       b.innerHTML='<svg></svg><span>选项 '+index+' 钻石 +99999 的传说 · 基准：'+(dm.malformed && index===1 ? '修为 +未知' : reward)+'<span class="block text-caption">补给消耗说明 钻石 +99999</span></span>';
       b.onclick=()=>submitDun({action:'choose',runId:dm.current.id,nodeIndex:dm.current.node,choiceKey:'choice-'+index});
       section.lastElementChild.append(b);
     });
     game.append(section);
     const retreat=document.createElement('button'); retreat.textContent='撤退并保留已到账收获'; retreat.onclick=()=>dm.calls.push(['retreat']); game.append(retreat);
   } else {
     const section=document.createElement('section');
     for(const name of ['迷雾山谷','坠星古墓','其他秘境']) {
       if(dm.dungeonMissing&&name==='坠星古墓')continue;
       const card=document.createElement('div'); card.className='game-card';
       card.innerHTML='<div><h2>'+name+'</h2></div><div><p>8 个节点 · 守关者</p><p>境界 1~100 · 门票 50 钻 · 灵力 20</p><button></button></div>';
       const b=card.querySelector('button');
       b.textContent=dm.remaining===0?'今日次数已用完':clock<dm.cooledUntil?'秘境冷却中':dm.entryReason||'进入秘境';
       b.disabled=dm.busy||dm.refreshing||!!nativeDun()||dm.remaining===0||clock<dm.cooledUntil||dm.entryBlocked||!!dm.entryReason;
       b.onclick=()=>openDun(name); section.append(card);
     }
     game.append(section);
     if(dm.sweep) {
       const sweep=document.createElement('section');sweep.className='game-card';
       const max=dm.sweepMax ?? Math.max(1,Math.min(10,dm.remaining));
       sweep.innerHTML='<h2>按上次路线扫荡 · 坠星古墓</h2>'+(max>1?'<select aria-label="扫荡次数">'+Array.from({length:max},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+' 次</option>').join('')+'</select>':'')+'<button>按上次路线扫荡</button>';
       const select=sweep.querySelector('select');if(select){select.value=String(Math.min(dm.sweepTimes||1,max));select.disabled=dm.busy||!!nativeDun();select.onchange=()=>{dm.sweepTimes=Number(select.value);renderDun();};}
       const button=sweep.querySelector('button');button.disabled=dm.busy||!!nativeDun()||dm.remaining===0||clock<dm.cooledUntil||!!dm.sweepDisabled;button.onclick=openSweep;
       game.append(sweep);
     }
     if(dm.recent) { const recent=document.createElement('section'); recent.className='game-card'; recent.innerHTML='<h2>最近一次探索 · 坠星古墓</h2><p>'+dm.recent+'</p>'; game.append(recent); }
   }
   if(dm.sweepResult&&!dm.busy) {
     const result=document.createElement('section');result.setAttribute('role','status');result.className='game-card';
     result.innerHTML='<h2>扫荡结果 · 坠星古墓</h2><p>通关 '+dm.sweepResult.completed+' 次'+(dm.sweepResult.partial?'（另有 1 次停在半路）':'')+'，共获得：修为 +1000</p><p>停下原因：'+dm.sweepResult.reason+'</p>';game.append(result);
   }
   // 页面还含路线预览，它的数字不能成为当前奖励或操作目标。
   const preview=document.createElement('details'); preview.open=true;
   preview.innerHTML='<summary>路线预览</summary><p>钻石 +9999999</p><button>预览选项 · 基准：钻石 +999999</button>';
   preview.querySelector('button').onclick=()=>dm.calls.push(['preview']); game.append(preview);
   if(dm.busy||nativeDun()) {
     const n=document.createElement('p'); n.setAttribute('role','status');
     n.textContent=dm.busy?'正在处理秘境操作，请等待原结果。':'上次秘境结果未确认，请先恢复原操作，再作新选择。'; game.append(n);
   }
   if(nativeDun()) { const b=document.createElement('button'); b.textContent='确认上次秘境操作'; b.disabled=dm.busy; b.onclick=()=>submitDun(nativeDun().input,true); game.append(b); }
 }
 game.querySelector('a').onclick=e=>{e.preventDefault();goDun(e.currentTarget.getAttribute('href'));};
 const home=document.createElement('a');home.href='/activities/expedition';home.textContent='返回远征';
 home.onclick=event=>{event.preventDefault();goDun('/activities/expedition');};game.append(home);
 persistDun();
};
if(!model.runs.length)addRuns(6);model.burst=0;
renderDun();
</script>`;

export const dungeonScript = dungeonPageMarkup.match(/<script>([\s\S]*)<\/script>/)[1];
export const dungeonMarkup = expeditionMarkup + `<script>${dungeonScript}</script>`;
