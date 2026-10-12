// 来自公开前端结构的本地 DOM 模拟；不连接游戏、不代表真实账号数据。
export const expeditionMarkup = `<!doctype html><meta charset="utf-8"><title>本地远征测试</title>
<main id="game"></main><script>
window.clock = Date.parse('2026-10-10T12:00:00+08:00');
Date.now = () => clock;
window.model = { normalMax: 6, burstMax: 6, burst: 6, route: '边境巡逻', high: true,
  maxTeams: 6, allowBurst: false, complete: true, runs: [], nextId: 1,
  calls: [], opens: 0, message: '', error: false, resultMode: 'success', busy: false };
window.pendingPayload = null;
window.addRuns = (count, burst = false, done = false, route = '边境巡逻') => {
  for (let i = 0; i < count; i++) model.runs.push({id: model.nextId++, burst, done, route});
};
window.preview = () => {
  const free = model.normalMax - model.runs.filter(run => !run.burst).length;
  const room = Math.max(0, model.normalMax + model.burstMax - model.runs.length);
  const normal = Math.min(model.maxTeams, free, room);
  const burst = model.allowBurst ? Math.min(model.maxTeams - normal, model.burst, room - normal) : 0;
  return {normal, burst, total: normal + burst};
};
window.clearDialog = () => {
  const dialog = document.querySelector('[role="dialog"]');
  const close = () => {
    dialog?.remove(); game.removeAttribute('aria-hidden'); game.removeAttribute('inert');
  };
  if (model.animationClose && !globalThis.BASE_UI_ANIMATIONS_DISABLED) requestAnimationFrame(close);
  else close();
};
window.finishDispatch = () => {
  const input = pendingPayload.input;
  addRuns(pendingPayload.normal, false, false, input.route);
  addRuns(pendingPayload.burst, true, false, input.route);
  model.burst -= pendingPayload.burst;
  model.message = '已派出 ' + pendingPayload.total + ' 支队伍、共 6 名英雄（常态 ' +
    pendingPayload.normal + ' 支，突发 ' + pendingPayload.burst + ' 支），路线：' + input.route;
  sessionStorage.removeItem('expedition:77:auto');
  pendingPayload = null; model.busy = false; renderExp();
};
window.submitDispatch = () => {
  const view = preview();
  const input = {route: model.route, routeKey: model.route === '边境巡逻' ? 'patrol' : 'abyss',
    preference: model.high ? 'high' : 'low', maxTeams: model.maxTeams, allowBurst: model.allowBurst,
    eventChoice: model.complete ? 'complete' : 'return_early'};
  const idempotencyKey = 'fixture-' + model.opens;
  sessionStorage.setItem('expedition:77:auto', JSON.stringify({input, idempotencyKey}));
  pendingPayload = {...view, input};
  model.calls.push({type: 'dispatch', route: model.route, ...view, input, idempotencyKey, at: clock});
  model.message = ''; model.busy = true; clearDialog(); renderExp();
  setTimeout(() => {
    if (model.resultMode === 'success') finishDispatch();
    else { model.busy = false; renderExp(); }
  }, 30);
};
window.openDispatch = () => {
  model.opens++;
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
  dialog.innerHTML = '<header><h2>批量派遣模式</h2><button aria-label="关闭">关闭</button></header>' +
    '<button role="tab">完整行程</button><button role="tab">轻装返航</button><button id="confirm-dispatch"></button>';
  const tabs = dialog.querySelectorAll('[role="tab"]');
  const update = () => {
    tabs[0].setAttribute('aria-selected', String(model.complete));
    tabs[1].setAttribute('aria-selected', String(!model.complete));
    dialog.querySelector('#confirm-dispatch').textContent = '确认' + (model.complete ? '完整行程' : '轻装返航') + ' · ' + preview().total + ' 队';
  };
  tabs[0].onclick = () => { model.complete = true; update(); };
  tabs[1].onclick = () => { model.complete = false; update(); };
  dialog.querySelector('[aria-label="关闭"]').onclick = clearDialog;
  dialog.querySelector('#confirm-dispatch').onclick = submitDispatch;
  update(); document.body.append(dialog);
  game.setAttribute('aria-hidden', 'true'); game.setAttribute('inert', '');
};
window.claimRuns = (id = null) => {
  const remove = model.runs.filter(run => run.done && (id === null || run.id === id));
  model.calls.push({type: 'claim', count: remove.length});
  model.runs = model.runs.filter(run => !remove.includes(run));
  const receipt=model.claimReceipts?.shift();
  model.message = receipt ? '' : '已领取 ' + remove.length + ' 支远征'; renderExp();
  if(receipt)setTimeout(()=>{model.message=receipt;renderExp();},20);
};
window.renderExp = () => {
  const free = model.normalMax - model.runs.filter(run => !run.burst).length;
  const ready = model.runs.filter(run => run.done);
  const view = preview();
  game.innerHTML = '<h1>远征派遣</h1>' +
    '<section aria-label="远征派遣额度"><div>' +
    '<div><span>常态剩余</span><span>' + free + '<span>/' + model.normalMax + ' 支</span></span></div>' +
    '<div><span>当前运行</span><span>' + model.runs.length + '<span>支</span></span></div>' +
    '<div><span>今日突发剩余</span><span>' + model.burst + '<span>/' + model.burstMax + ' 支</span></span></div>' +
    '</div></section>' +
    '<p id="notice" role="status" class="' + (model.error ? 'text-destructive' : 'text-primary') + '">' + model.message + '</p>' +
    '<section id="running"><h2>进行中的远征</h2></section>' +
    '<section id="routes"><h2>选择路线</h2></section>' +
    '<section id="auto"><h2>自动组队派遣</h2>' +
    '<div aria-label="自动组队偏好"><button id="high">高星优先</button><button id="low">低星优先</button></div>' +
    '<label>最多派遣队数<input aria-label="最多派遣队数" type="number" min="1" max="100"></label>' +
    '<label><input type="checkbox">允许使用今日突发额度</label>' +
    '<p role="status">预计派遣 ' + view.total + ' 支：常态 ' + view.normal + ' 支，突发 ' + view.burst + ' 支。实际名额以出发时为准。</p>' +
    '<button id="dispatch"></button></section>' +
    '<section><h2>选择英雄</h2><button id="manual">出发（边境巡逻）</button></section>';
  document.querySelector('#manual').onclick = () => model.calls.push({type:'manual'});
  const running = document.querySelector('#running');
  if (ready.length > 1) {
    const all = document.createElement('button'); all.textContent = '一键领取（' + ready.length + '）';
    all.onclick = () => claimRuns(); running.append(all);
  }
  model.runs.forEach(run => {
    const card = document.createElement('div'); card.textContent = run.route;
    const button = document.createElement('button'); button.textContent = run.done ? '领取' : '远征中';
    button.disabled = !run.done; button.onclick = () => claimRuns(run.id); card.append(button); running.append(card);
  });
  ['边境巡逻', '遗迹勘探', '深渊远征'].forEach(name => {
    const button = document.createElement('button'); button.innerHTML = '<span><span>' + name + '</span><span>需队伍总星级 ≥ 1</span></span><span>0.94h</span>';
    button.setAttribute('aria-pressed', String(model.route === name));
    button.onclick = () => { model.route = name; renderExp(); }; document.querySelector('#routes').append(button);
  });
  document.querySelector('#high').setAttribute('aria-pressed', String(model.high));
  document.querySelector('#low').setAttribute('aria-pressed', String(!model.high));
  document.querySelector('#high').onclick = () => { model.high = true; renderExp(); };
  document.querySelector('#low').onclick = () => { model.high = false; renderExp(); };
  const count = document.querySelector('input[type="number"]'); count.value = model.maxTeams;
  count.oninput = event => { model.maxTeams = Number(event.target.value); renderExp(); };
  const burst = document.querySelector('input[type="checkbox"]'); burst.checked = model.allowBurst;
  burst.onchange = event => { model.allowBurst = event.target.checked; renderExp(); };
  const dispatch = document.querySelector('#dispatch');
  const original = sessionStorage.getItem('expedition:77:auto');
  dispatch.textContent = original ? '确认上次派遣结果' : '派出 ' + view.total + ' 支队伍';
  dispatch.disabled = model.busy || (!original && !view.total);
  dispatch.onclick = original ? () => {
    model.calls.push({type: 'recover', idempotencyKey: JSON.parse(original).idempotencyKey});
    if (!model.recoveryPending) finishDispatch();
  } : openDispatch;
};
renderExp();
</script>`;
