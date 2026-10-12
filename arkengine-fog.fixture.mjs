import { dungeonMarkup } from './arkengine-dungeon.fixture.mjs';

// 复用主殿/秘境模型；迷雾采用公开页面的按钮、确认 Promise、原请求和到账回执。
export const fogMarkup = dungeonMarkup.replace('</script>', `
window.fo = JSON.parse(sessionStorage.getItem('fixture:fog') || 'null') || {
  spirit: 200, cost: 20, runs: 0, calls: [], paid: '', busy: false, error: '', mode: '',
  route: 'east', strategy: 'guard-heavy', hp: 30, manual: false, quick: true
};
window.persistFog = () => sessionStorage.setItem('fixture:fog', JSON.stringify(fo));
window.nativeFog = () => JSON.parse(sessionStorage.getItem('fog:77') || 'null');
const originalRenderDun = renderDun;
const originalApplyDun = applyDun;
window.applyDun = record => { if(record.input.action==='enter') fo.spirit-=20; originalApplyDun(record); };
window.submitFog = (input, recover = false) => {
  const record = nativeFog() || {input, idempotencyKey: crypto.randomUUID()};
  sessionStorage.setItem('fog:77', JSON.stringify(record));
  fo.calls.push([recover ? 'recover' : 'start', record.input, record.idempotencyKey, clock]);
  fo.busy = true; fo.error = ''; renderDun();
  if(fo.mode==='busy') return;
  fixtureTimeout(() => {
    fo.busy=false;
    if(fo.mode==='pending' && !recover) fo.error='响应超时，可确认原探索结果。';
    else {
      sessionStorage.removeItem('fog:77');
      if(fo.mode==='reject') fo.error='本次探索未能开始';
      else { fo.spirit-=20; fo.runs++; fo.paid='安全撤离 已到账：修为 325 · 法宝碎片 12'; }
    }
    renderDun();
  },20);
};
window.openFog = () => {
  fo.calls.push(['open', clock]);
  const box=document.createElement('div'); box.setAttribute('role','alertdialog');
  box.innerHTML='<h2>快速探索</h2><p>消耗 20 灵力开始新局，按所选路线逐格探索。沿用当前战斗、补给和奖励规则；生命不高于 '+fo.hp+' 时撤离，仍可能在单次受击中失败。不会自动使用背包补品。</p><button>取消</button><button>确认</button>';
  const close=()=>{box.remove();game.removeAttribute('inert');game.removeAttribute('aria-hidden');};
  box.querySelectorAll('button')[0].onclick=close;
  box.querySelectorAll('button')[1].onclick=()=>{
    if(fo.animation && !globalThis.BASE_UI_ANIMATIONS_DISABLED) requestAnimationFrame(close); else close();
    Promise.resolve().then(()=>submitFog({action:'start',quick:{route:fo.route,strategy:fo.strategy,retreatHp:fo.hp}}));
  };
  document.body.append(box);
  if(fo.animation) { game.setAttribute('inert',''); game.setAttribute('aria-hidden','true'); }
};
window.renderDun = () => {
  if(location.pathname!=='/cultivate/fog') {
    originalRenderDun();
    if(location.pathname==='/cultivate') {
      const row=document.createElement('p'); row.innerHTML='<span>体力 999/999</span><span>灵力 '+fo.spirit+'/400</span><a href="/cultivate/fog">迷雾</a>';
      row.querySelector('a').onclick=e=>{e.preventDefault();goDun('/cultivate/fog');};game.append(row);
      game.querySelector('[aria-label="刷新修炼状态"]').onclick=()=>{fo.calls.push(['refresh-hall',clock]);fo.spirit=fo.freshSpirit??fo.spirit;renderDun();};
      if(fo.seek) { const seek=document.getElementById('seek');seek.disabled=false;seek.textContent='寻找奇遇';seek.onclick=()=>{fo.calls.push(['seek']);fo.seek=false;renderDun();}; }
    }
    persistFog();return;
  }
  game.innerHTML='<a href="/cultivate">返回修仙主殿</a><h1>迷雾探索</h1><button id="fog-refresh">刷新</button><p aria-live="polite">当前灵力 '+fo.spirit+'/400 · 入场消耗 '+fo.cost+' 灵力</p><button id="normal-entry">进入迷雾</button>';
  game.querySelector('a').onclick=e=>{e.preventDefault();goDun('/cultivate');};
  document.getElementById('normal-entry').onclick=()=>fo.calls.push(['wrong-entry']);
  const refresh=document.getElementById('fog-refresh');refresh.disabled=fo.busy;refresh.onclick=()=>{fo.calls.push(['refresh-fog']);renderDun();};
  if(fo.error) {const p=document.createElement('p');p.setAttribute('role','alert');p.className='text-destructive';p.textContent=fo.error;game.append(p);}
  if(nativeFog()) {const b=document.createElement('button');b.textContent='确认原探索结果';b.disabled=fo.busy;b.onclick=()=>submitFog(nativeFog().input,true);game.append(b);}
  if(fo.paid) {const p=document.createElement('p');p.setAttribute('role','status');p.textContent=fo.paid;game.append(p);}
  if(fo.quick) {
    const section=document.createElement('section');
    section.innerHTML='<select aria-label="探索路线"><option value="east">向右</option><option value="south">向下</option><option value="explore">逐行</option></select><select aria-label="战斗策略"><option value="guard-heavy">重击防守</option><option value="strike">普攻</option></select><input aria-label="生命撤离线" type="number"><button></button>';
    const [route,strategy]=section.querySelectorAll('select');route.value=fo.route;strategy.value=fo.strategy;
    route.onchange=()=>fo.route=route.value;strategy.onchange=()=>fo.strategy=strategy.value;
    const hp=section.querySelector('input');hp.value=fo.hp;hp.onchange=()=>fo.hp=Number(hp.value);
    const quick=section.querySelector('button');quick.textContent=fo.manual?'按策略完成本局':'进入并快速探索 · 20 灵力';
    quick.disabled=fo.busy||!!nativeFog()||fo.spirit<fo.cost||fo.blocked;
    quick.onclick=()=>fo.manual?fo.calls.push(['manual-taken']):openFog();game.append(section);
  }
  persistFog();
};
renderDun();
</script>`);
