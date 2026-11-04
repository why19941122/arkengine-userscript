// ==UserScript==
// @name         Ark Engine 自动奇遇、秘境、远征与农场
// @namespace    local.arkengine.auto-encounter
// @version      1.14.38
// @updateURL    https://raw.githubusercontent.com/why19941122/arkengine-userscript/main/arkengine-auto-encounter.meta.js
// @downloadURL  https://raw.githubusercontent.com/why19941122/arkengine-userscript/main/arkengine-auto-encounter.user.js
// @description  双标签页挂机：奇遇秘境迷雾、远征农场避难所与模型股市；独立预算交易预测、人口生产、探险归来领取与发展规划，七日本地日志。
// @match        https://game.arkengine.me/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  const injectedAt = Date.now();
  const injectedReadyState = document.readyState;
  const injectedClock = performance.now();
  let started = false;
  let bodyObserver;
  function start() {
  if (started || !document.body) return;
  started = true;
  bodyObserver?.disconnect();
  const bodyWaitMs = Math.max(0, Math.round(performance.now() - injectedClock));
  if (window.top !== window.self || document.getElementById('ark-auto-encounter')) return;
  // 网站 Base UI 的关闭完成回调先等 requestAnimationFrame；后台不绘制时可能一直不卸载。
  // 使用其公开代码中的开关，只在自动化路由启用期间跳过动画等待，不改写 rAF 或移除弹窗。
  const animationProperty = 'BASE_UI_ANIMATIONS_DISABLED';
  const ACCOUNT_STOP = 'arkengine:auto:account-stop:v1';
  const groupPrefs = ['arkengine:auto-encounter:enabled:v1', 'arkengine:auto-expedition:enabled:v1'];
  const accountListeners = [];
  let memoryAccountStop = '';
  const accountStopReason = () => {
    try { return localStorage.getItem(ACCOUNT_STOP) || memoryAccountStop; }
    catch { return memoryAccountStop; }
  };
  function clearAccountStop() {
    localStorage.removeItem(ACCOUNT_STOP);
    memoryAccountStop = '';
  }
  function pauseAccount(reason) {
    const message = `${reason}；账号异常，已暂停全部自动操作，请处理后分别手动开始`;
    // 先写共享停止标记；另一页即使还未收到 storage 事件，点击前也会读到。
    memoryAccountStop = message;
    try { localStorage.setItem(ACCOUNT_STOP, message); } catch { /* 本页仍须停止 */ }
    for (const pref of groupPrefs) {
      try { localStorage.setItem(pref, 'false'); } catch { /* 继续通知本页两组 */ }
    }
    for (const stop of accountListeners) {
      try { stop(message); } catch { /* 一组失败不能阻止另一组暂停 */ }
    }
  }
  window.addEventListener('storage', event => {
    if (event.key === ACCOUNT_STOP) memoryAccountStop = event.newValue || '';
    if (event.key === ACCOUNT_STOP && event.newValue) {
      for (const stop of accountListeners) stop(event.newValue);
    }
  });
  let animationSaved = false;
  let animationDescriptor;
  function syncDialogAnimations() {
    let wanted = false;
    try {
      wanted = /^\/cultivate(?:\/(?:dungeon|fog))?\/?$/.test(location.pathname)
        ? localStorage.getItem('arkengine:auto-encounter:enabled:v1') !== 'false'
        : /^(?:\/activities\/expedition|\/farm|\/shelter|\/stock)\/?$/.test(location.pathname) &&
          localStorage.getItem('arkengine:auto-expedition:enabled:v1') !== 'false';
      wanted &&= !accountStopReason();
      if (wanted && !animationSaved) {
        animationDescriptor = Object.getOwnPropertyDescriptor(globalThis, animationProperty);
        globalThis[animationProperty] = true;
        animationSaved = true;
      } else if (!wanted && animationSaved) {
        if (animationDescriptor) Object.defineProperty(globalThis, animationProperty, animationDescriptor);
        else delete globalThis[animationProperty];
        animationSaved = false;
      }
    } catch { /* 不支持动画开关时仍保留原有弹窗和请求保护 */ }
  }
  syncDialogAnimations();

  // 只接受唯一的当前候选。弹窗遮住页面后，仅复用遮挡前识别过的当前区域。
  // 不能以“仍有布局”把旧 aria-hidden 区域误当作当前表单。
  function createLocator() {
    let known = new WeakSet();
    let knownAncestors = new WeakSet();
    let path = location.pathname;
    const rendered = el => Boolean(el?.isConnected && !el.closest('[hidden]') &&
      el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const visible = el => rendered(el) && !el.closest('[aria-hidden="true"]');
    const remember = el => {
      known.add(el);
      for (let parent = el.parentElement; parent; parent = parent.parentElement) knownAncestors.add(parent);
      return el;
    };
    const readable = el => {
      if (!rendered(el)) return false;
      if (visible(el)) return true;
      // React 可在确认期间替换控件；允许已知背景内的新节点，但每层遮挡祖先都须已知。
      for (let parent = el; parent; parent = parent.parentElement) {
        if (parent.matches('[aria-hidden="true"], [inert]') && !knownAncestors.has(parent) && !known.has(parent)) return false;
      }
      return true;
    };
    const resetPath = () => {
      if (path !== location.pathname) { path = location.pathname; known = new WeakSet(); knownAncestors = new WeakSet(); }
    };
    function pick(elements) {
      resetPath();
      const candidates = [...(elements || [])];
      const current = candidates.filter(visible);
      if (current.length) return current.length === 1 ? remember(current[0]) : null;
      const background = candidates.filter(readable);
      if (background.length) return background.length === 1 ? background[0] : null;
      // 唯一不可见候选仅用于禁用/隐藏诊断，不能据此点击。
      return candidates.length === 1 && !rendered(candidates[0]) ? candidates[0] : null;
    }
    function all(elements) {
      resetPath();
      return [...elements].filter(el => visible(el) ? (remember(el), true) : readable(el));
    }
    return { pick, all, rendered, visible, readable,
      query: (selector, root = document) => pick(root?.querySelectorAll(selector)) };
  }

  // 只关闭明确的信息通知；不把通用“确认”、表单或交易窗口当作公告。
  function createNoticeHandler(log, say, enqueue, usable) {
    const seen = new WeakMap();
    const attempted = new WeakSet();
    let serial = 0;
    const text = el => (el?.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    return (dialogs, fallback) => {
      const dialog = dialogs[0];
      const title = text(dialog?.querySelector('h2, [data-slot="dialog-title"], [data-slot="alert-dialog-title"]'));
      const category = /^(公告|系统公告|更新公告|更新说明|版本更新|通知|系统通知|提示|温馨提示|系统提示)$/.test(title) ? title : 'unknown';
      const buttons = [...(dialog?.querySelectorAll('button, [role="button"]') || [])];
      const dismiss = button => /^(关闭|关闭公告|关闭提示|知道了|我知道了)$/.test(button.getAttribute('aria-label') || text(button));
      const controls = Boolean(dialog?.querySelector('form, input, select, textarea, [contenteditable="true"], a[href], [role="checkbox"], [role="switch"], [role="textbox"]'));
      const sensitive = /登录|登陆|密码|验证|授权|购买|支付|充值|扣除|消耗|删除|重置|确认操作|是否|确定要|同意/.test(text(dialog));
      const reason = dialogs.length !== 1 ? 'multiple-dialogs' : category === 'unknown' ? 'unknown-title' :
        controls ? 'interactive-content' : sensitive ? 'confirmation-content' :
          !buttons.length || buttons.some(button => !dismiss(button)) ? 'unknown-buttons' : 'notice';
      const detail = { category, reason, dialogs: dialogs.length, buttons: buttons.length, controls,
        dismissButtons: buttons.filter(dismiss).length };
      if (!dialog) { say(fallback); return; }
      let entry = seen.get(dialog);
      const signature = JSON.stringify(detail);
      if (!entry) { entry = { id: ++serial }; seen.set(dialog, entry); }
      if (entry.signature !== signature) {
        entry.signature = signature;
        log.add('dialog-observed', '核对阻塞弹窗的类型与关闭条件', detail);
      }
      if (reason !== 'notice') { say(fallback); return; }
      if (attempted.has(dialog)) { say('通知已请求关闭，等待窗口消失；若持续显示请手动关闭'); return; }
      const button = buttons.find(usable);
      if (!button) { say('等待通知的关闭按钮可用'); return; }
      enqueue(button, String(entry.id), '关闭已识别的信息通知', () => {
        attempted.add(dialog);
        log.add('notice-dismiss', '点击信息通知的关闭按钮', detail);
      });
    };
  }

  // 不记录页面文本、节点 ID 或属性值，仅记录影响可读性的布局条件。
  function layoutDiagnostic(el) {
    if (!el) return { found: false };
    const blockers = [];
    let depth = 0;
    for (let node = el; node && depth < 32; node = node.parentElement, depth++) {
      const css = getComputedStyle(node);
      const flags = { hidden: node.hasAttribute('hidden'), ariaHidden: node.getAttribute('aria-hidden') === 'true',
        inert: node.hasAttribute('inert'), display: css.display, visibility: css.visibility,
        contentVisibility: css.contentVisibility };
      if (flags.hidden || flags.ariaHidden || flags.inert || css.display === 'none' ||
          css.visibility !== 'visible' || css.contentVisibility && css.contentVisibility !== 'visible') blockers.push({ depth, ...flags });
    }
    const css = getComputedStyle(el);
    return { found: true, connected: el.isConnected, rectCount: el.getClientRects().length,
      css: { display: css.display, visibility: css.visibility, contentVisibility: css.contentVisibility }, blockers };
  }

  const stateFaults = new Map();
  const objectState = v => Boolean(v && typeof v === 'object' && !Array.isArray(v));
  const timedState = v => objectState(v) && Number.isFinite(v.at) && v.at >= 0;
  const planState = v => timedState(v) && ['opening', 'submitted'].includes(v.phase);
  function loadState(storage, key, fallback, scope, validate = objectState) {
    try {
      const raw = storage.getItem(key);
      if (raw === null || raw === 'null') return fallback;
      const value = JSON.parse(raw);
      if (!validate(value)) throw new Error('InvalidState');
      return value;
    } catch {
      // 不删除或改写原文，更不能把损坏的未决操作当作“没有操作”。
      stateFaults.set(key, scope);
      return fallback;
    }
  }
  function stateFault(scope) {
    const keys = [...stateFaults].filter(([, group]) => group === scope).map(([key]) => key);
    return keys.length ? `保存记录不可读，已暂停；原记录保留，请修复后刷新（${keys.join('、')}）` : '';
  }
  const PAGE_REFRESH_DELAYS = [90000, 5 * 60000, 15 * 60000, 60 * 60000, 120 * 60000];
  function runtimeDiagnostic() {
    return { online: navigator.onLine, readyState: document.readyState,
      uptimeMs: Math.max(0, Math.round(performance.now() - injectedClock)) };
  }
  function navigationDiagnostic() {
    const entry = performance.getEntriesByType('navigation')[0];
    if (!entry) return null;
    return { type: entry.type, ...Object.fromEntries(['responseStart', 'responseEnd', 'domInteractive',
      'domContentLoadedEventStart', 'loadEventStart'].map(key => [key, Math.round(entry[key])])) };
  }
  function createPageWait(scope, log) {
    const key = `arkengine:auto-page-wait:${scope}:v1`;
    let state = loadState(sessionStorage, key, null, scope, v => timedState(v) &&
      (v.refreshes === undefined || Number.isInteger(v.refreshes) && v.refreshes >= 0 && v.refreshes <= PAGE_REFRESH_DELAYS.length) &&
      (v.since === undefined || Number.isFinite(v.since) && v.since >= 0) &&
      ['recoverable', 'exhaustedLogged'].every(key => v[key] === undefined || typeof v[key] === 'boolean'));
    let waiting = false;
    function snapshot() {
      if (!state) return null;
      const attempt = state.refreshes ?? (state.reloaded ? 1 : 0);
      const limit = state.recoverable === false ? 1 : PAGE_REFRESH_DELAYS.length;
      const delay = state.recoverable === true ? PAGE_REFRESH_DELAYS[attempt] :
        state.recoverable === false && !attempt ? 90000 : null;
      return { scope, observedSince: state.since ?? state.at, blockedMs: Math.max(0, Date.now() - (state.since ?? state.at)),
        attempt, limit, nextAt: delay == null ? null : state.at + delay,
        lastRefreshAt: attempt ? state.at : null };
    }
    return {
      snapshot,
      begin() { waiting = false; },
      finish() { if (!waiting) this.clear('check-advanced'); },
      clear(cause = 'manual') {
        if (!state) return;
        // 仅说明调度离开了加载等待，不能据此推断游戏操作已成功。
        log.add('page-wait-ended', '页面加载等待已结束', { ...snapshot(), cause });
        state = null; sessionStorage.removeItem(key);
      },
      wait(reason, safe, say, pause, recoverable = false, beforeReload = null) {
        waiting = true;
        if (!navigator.onLine) { say('网络离线，等待连接恢复'); return; }
        if (recoverable) safe &&= !document.querySelector('[role="dialog"], [role="alertdialog"]');
        if (!state || state.path !== location.pathname) {
          state = { at: Date.now(), since: Date.now(), path: location.pathname, reloaded: false,
            recoverable: Boolean(recoverable && safe) };
          sessionStorage.setItem(key, JSON.stringify(state));
          log.add('page-blocked', reason, { ...snapshot(), runtime: runtimeDiagnostic() });
        } else if (state.since === undefined || state.recoverable !== Boolean(recoverable && safe)) {
          state = { ...state, since: state.since ?? state.at, recoverable: Boolean(recoverable && safe) };
          sessionStorage.setItem(key, JSON.stringify(state));
        }
        // 调用方确认可安全重新读页后才有限刷新；旧操作的记录须先保存，不能重置写入预算。
        if (recoverable && safe) {
          const refreshes = state.refreshes ?? (state.reloaded ? 1 : 0);
          if (refreshes >= PAGE_REFRESH_DELAYS.length) {
            if (!state.exhaustedLogged) {
              state = { ...state, exhaustedLogged: true };
              sessionStorage.setItem(key, JSON.stringify(state));
              log.add('page-refresh-exhausted', '加载恢复刷新次数已用完，保持开启等待', { ...snapshot(), runtime: runtimeDiagnostic() });
            }
            say(`${reason}；自动刷新已达 ${PAGE_REFRESH_DELAYS.length} 次，保持开启并等待页面恢复`); return;
          }
          const remaining = PAGE_REFRESH_DELAYS[refreshes] - (Date.now() - state.at);
          if (remaining > 0) {
            say(`${reason}；等待页面恢复（已刷新 ${refreshes}/${PAGE_REFRESH_DELAYS.length} 次，约 ${Math.ceil(remaining / 60000)} 分钟后再核对）`);
            return;
          }
          beforeReload?.();
          state = { ...state, reloaded: true, refreshes: refreshes + 1, at: Date.now() };
          sessionStorage.setItem(key, JSON.stringify(state));
          log.add('page-refresh', reason, { ...snapshot(), runtime: runtimeDiagnostic() });
          location.reload();
          return;
        }
        if (Date.now() - state.at >= (state.reloaded ? 300000 : 90000)) {
          if (!safe) { pause(`${reason}；存在弹窗或未决操作，已暂停并保留记录`); return; }
          if (state.reloaded) { pause(`${reason}；一次刷新后仍无进展，已暂停`); return; }
          state = { ...state, reloaded: true, at: Date.now() };
          sessionStorage.setItem(key, JSON.stringify(state));
          log.add('page-refresh', reason, { ...snapshot(), runtime: runtimeDiagnostic() });
          location.reload();
        } else say(`${reason}；等待页面更新${state.reloaded ? '（已核对一次）' : ''}`);
      },
    };
  }

  // 每页共享一个 Worker 和 DOM 观察器；非当前功能组不扫描整页。
  const wakeups = [];
  function subscribeWakeup(schedule, onPage, enabled, beforeMutation = () => {}) {
    wakeups.push({ schedule, onPage, enabled, beforeMutation, wasOnPage: onPage() });
    if (wakeups.length > 1) return;
    const wake = mutation => {
      observeSessionPage();
      for (const item of wakeups) {
        const current = item.onPage();
        if ((current && (mutation || item.enabled())) || item.wasOnPage !== current) {
          if (mutation) item.beforeMutation();
          item.schedule();
        }
        item.wasOnPage = current;
      }
    };
    new MutationObserver(records => {
      if (records.some(record => !(record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement)
        ?.closest('#ark-auto-encounter, #ark-auto-expedition'))) wake(true);
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'aria-pressed', 'aria-selected', 'aria-hidden', 'hidden', 'inert', 'class', 'style'] });
    for (const name of ['pageshow', 'focus', 'popstate', 'online', 'offline']) window.addEventListener(name, () => wake(true));
    for (const name of ['visibilitychange', 'resume']) document.addEventListener(name, () => wake(true));
    let worker;
    let timer;
    const fallback = () => { worker?.terminate(); worker = null; if (!timer) timer = setInterval(() => wake(false), 2000); };
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 2000);'], { type: 'text/javascript' }));
      try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
      worker.onmessage = () => wake(false);
      worker.onerror = fallback;
    } catch { fallback(); }
  }

  // STOCK_CORE_BEGIN — pure calculations also exercised by the Node tests.
  const stockCore = (() => {
    const whole = n => Number.isSafeInteger(n) && n >= 0;
    const positive = n => whole(n) && n > 0;
    const id = n => positive(n) || typeof n === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(n) && !['__proto__','constructor','prototype'].includes(n);
    const time = s => typeof s === 'string' ? Date.parse(s) : NaN;
    const distinct = (xs,key) => new Set(xs.map(key)).size === xs.length;
    const fee = p => typeof p === 'number' && p >= 0 && p < 100 && /^\d+(?:\.\d{1,4})?$/.test(String(p));
    // Integer cents and rational percentages avoid floating point rounding at fee boundaries.
    function quote(price, shares, percent, buy) {
      if (!positive(price) || !positive(shares) || shares > 2147483647 || !fee(percent)) return null;
      const [a,b=''] = String(percent).split('.'), scale = 10n ** BigInt(b.length);
      const gross = BigInt(price)*BigInt(shares), numerator = gross*BigInt(a+b), denominator = 100n*scale;
      const charge = (numerator+(buy ? denominator-1n : 0n))/denominator;
      const tokens = buy ? (gross+charge+99n)/100n : (gross-charge)/100n;
      return tokens <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(tokens) : null;
    }
    function sharesFor(price, percent, budget) {
      if (!positive(price) || !fee(percent) || !whole(budget)) return 0;
      let low=0, high=2147483647;
      while(low<high) { const mid=Math.ceil((low+high)/2), cost=quote(price,mid,percent,true);
        if(cost!==null && cost<=budget) low=mid; else high=mid-1; }
      return low;
    }
    function model(v,balance) {
      if (!v || !positive(v.userId) || typeof v.enabled!=='boolean' || !Number.isFinite(balance?.tokens) ||
          balance.tokens<0 || balance.tokens>Number.MAX_SAFE_INTEGER ||
          !['stocks','positions','ticks','rounds','myBets'].every(k=>Array.isArray(v[k])&&v[k].every(x=>x&&typeof x==='object'&&!Array.isArray(x)))) return null;
      if (!v.stocks.every(s=>id(s.id) && typeof s.modelName==='string' && s.modelName.length>0 && s.modelName.length<=200 &&
          positive(s.priceCents)) || !distinct(v.stocks,s=>String(s.id)) || !distinct(v.stocks,s=>s.modelName) ||
          !v.positions.every(p=>id(p.stockId) && whole(p.shares) && p.shares<=2147483647 &&
            (p.costBasisTokens==null || whole(p.costBasisTokens)) && (p.holdUntil==null || Number.isFinite(time(p.holdUntil)))) ||
          !distinct(v.positions,p=>String(p.stockId))) return null;
      const r=v.rules;
      if (!r || !fee(r.buyFeePct) || !fee(r.sellFeePct) ||
          !['maxTradeTokens','maxDailyBuyTokens','maxPositionTokens','reserveTokens'].every(k=>whole(r[k]))) return null;
      // Other game income can contain decimals. Only whole tokens are available for stock orders.
      return {view:v,balance:Math.floor(balance.tokens),rules:r};
    }
    function uniqueBet(v,betId) {
      if(!id(betId)||!Array.isArray(v?.myBets))return null;
      const matches=v.myBets.filter(b=>id(b?.id)&&String(b.id)===String(betId));
      return matches.length===1&&matches[0].id===betId?matches[0]:null;
    }
    function trend(v,s,now) {
      if(s.stale || s.suspended || !Number.isFinite(s.volume24h) || s.volume24h<=0) return null;
      const ticks=v.ticks.filter(t=>t.stockId===s.id).map(t=>({at:time(t.createdAt),price:t.priceCents}))
        .sort((a,b)=>a.at-b.at).slice(-12);
      if(ticks.length<6 || !ticks.every(t=>Number.isFinite(t.at) && positive(t.price)) ||
          now-ticks.at(-1).at>10*60000 || ticks.at(-1).at>now+5000 || now-ticks[0].at>2*3600000 ||
          ticks.at(-1).at-ticks[0].at<20*60000 || Math.abs(s.priceCents/ticks.at(-1).price-1)>.05) return null;
      let up=0,down=0;
      for(let i=1;i<ticks.length;i++) {
        const delta=ticks[i].price/ticks[i-1].price-1, gap=ticks[i].at-ticks[i-1].at;
        if(gap<=0 || gap>15*60000 || Math.abs(delta)>.2) return null;
        if(delta>0)up++; if(delta<0)down++;
      }
      const avg=xs=>xs.reduce((sum,t)=>sum+t.price,0)/xs.length;
      const change=avg(ticks.slice(-3))/avg(ticks.slice(0,3))-1;
      const direction=change>=.02 && up/(ticks.length-1)>=.6 ? 'up' : change<=-.02 && down/(ticks.length-1)>=.6 ? 'down' : null;
      return direction ? {direction,change,samples:ticks.length,at:ticks.at(-1).at} : null;
    }
    // Server receipts do not expose an execution time. First successful confirmation is a conservative bound.
    const entryTime = e => Math.max(e.at,e.confirmedAt??0);
    function spend(entries,action,now) {
      return entries.filter(e=>e.action===action && entryTime(e)>now-86400000 && e.result!=='rejected').reduce((sum,e)=>sum+e.debit,0);
    }
    function sellPlan(m,s,owned,now) {
      const o=owned[String(s.id)],p=m.view.positions.find(p=>p.stockId===s.id),r=m.rules;
      if(!m.view.enabled || !o || o.manual || !p || p.shares!==o.shares || p.costBasisTokens!==o.cost || !o.cost ||
          s.suspended || s.stale || p.holdUntil && time(p.holdUntil)>now)return null;
      const net=quote(s.priceCents,p.shares,r.sellFeePct,false),t=trend(m.view,s,now);
      if(net===null || !(net/o.cost>=1.08 || net/o.cost<=.94 || t?.direction==='down'))return null;
      const cap=BigInt(Math.min(r.maxTradeTokens,r.reserveTokens))*100n/BigInt(s.priceCents);
      const shares=Number(cap<BigInt(p.shares)?cap:BigInt(p.shares));
      if(shares<=0)return null;
      const proceeds=quote(s.priceCents,shares,r.sellFeePct,false);
      if(proceeds===null)return null;
      // Whole-token rounding applies to each partial sale, not to the original full position.
      if(proceeds===0)return {blocked:true,reason:`${s.modelName}当前可卖 ${shares} 股，扣费取整后预计净到账为0代币，暂不卖出`};
      return {action:'sell',stockId:s.id,modelName:s.modelName,shares,debit:0,
        reason:net/o.cost>=1.08?'净收益达到8%':net/o.cost<=.94?'净亏损达到6%':'行情转弱'};
    }
    function choose(m,config,ledger,now) {
      const v=m.view,r=m.rules,own=ledger.owned;
      if(!v.enabled)return null;
      // Alternate new spending when both modules have candidates; predictions cannot starve buying.
      if(config.trade && config.predict && ledger.entries.at(-1)?.action==='predict') {
        const trade=choose(m,{...config,predict:false},ledger,now);if(trade)return trade;
      }
      // No averaging down or mixing with manual positions. Each model has at most one script lot.
      if(config.trade) for(const s of v.stocks) {
        const sale=sellPlan(m,s,own,now);if(sale?.action)return sale;
      }
      const trends=v.stocks.map(s=>({s,t:trend(v,s,now)})).filter(x=>x.t).sort((a,b)=>Math.abs(b.t.change)-Math.abs(a.t.change)||String(a.s.id).localeCompare(String(b.s.id)));
      const free=Math.max(0,m.balance-config.reserve);
      if(config.predict && config.stake>0 && config.stake<=free &&
          spend(ledger.entries,'predict',now)+config.stake<=config.predictionLimit) {
        for(const {s,t} of trends) for(const round of v.rounds.filter(x=>x.stockId===s.id)) {
          if(!id(round.id) || round.ruleVersion!==2 || !Number.isFinite(time(round.lockAt)) || !Number.isFinite(time(round.closeAt)) ||
            time(round.lockAt)-now<60000 || time(round.closeAt)<=time(round.lockAt) ||
            round.openAt!=null && (!Number.isFinite(time(round.openAt)) || time(round.openAt)>now) ||
            !positive(round.oddsBp) || round.oddsBp<100 ||
            BigInt(config.stake)*BigInt(round.oddsBp)>BigInt(Number.MAX_SAFE_INTEGER)*100n ||
            ledger.entries.some(e=>e.roundId===round.id) || v.myBets.some(b=>b.roundId===round.id)) continue;
          return {action:'predict',roundId:round.id,stockId:s.id,modelName:s.modelName,direction:t.direction,
            betTokens:config.stake,debit:config.stake,reason:`近期${t.samples}笔行情${t.direction==='up'?'上行':'下行'}`};
        }
      }
      if(!config.trade || !config.tradeLimit || v.positions.filter(p=>p.shares>0 && own[String(p.stockId)] && !own[String(p.stockId)].manual).length>=3)return null;
      const positions=v.positions.filter(p=>p.shares>0);
      if(positions.some(p=>!whole(p.costBasisTokens)))return null;
      const held=positions.reduce((sum,p)=>sum+p.costBasisTokens,0);
      // Ten percent quote buffer is a reservation, not a server-enforced limit price.
      const reserveBudget=Math.floor(Math.min(config.tradeLimit-spend(ledger.entries,'buy',now),
        config.tradeLimit-held,config.tradeLimit/3,free,r.maxTradeTokens,r.maxDailyBuyTokens-spend(ledger.entries,'buy',now),r.maxPositionTokens-held));
      if(reserveBudget<=0)return null;
      for(const {s,t} of trends) {
        if(t.direction!=='up' || t.change*100<r.buyFeePct+r.sellFeePct+1 ||
          positions.some(p=>p.stockId===s.id) || own[String(s.id)]?.manual ||
          ledger.entries.some(e=>e.stockId===s.id && e.action==='sell' && e.result!=='rejected' && entryTime(e)>now-3600000))continue;
        const shares=sharesFor(s.priceCents,r.buyFeePct,Math.floor(reserveBudget/1.1));
        if(!shares)continue;
        const estimate=quote(s.priceCents,shares,r.buyFeePct,true),debit=Math.ceil(estimate*1.1);
        if(debit<=reserveBudget)return {action:'buy',stockId:s.id,modelName:s.modelName,shares,debit,estimate,reason:`近期${t.samples}笔上涨，预留10%报价余量`};
      }
      return null;
    }
    // Confirming a native intent can still execute it. Recheck changed funding limits without counting its reservation twice.
    function recoveryWait(m,config,ledger,p,now) {
      const a=p.choice;
      if(p.manualTouched)return '原交易期间持仓被手动操作，保留原请求供手动核对';
      if(a.action!=='predict') {
        const before=p.beforeShares,after=before+(a.action==='buy'?a.shares:-a.shares);
        if(!whole(before)||!positive(a.shares)||!whole(after))return '原交易持仓快照无法核对，保留原请求';
        const pos=m.view.positions.find(s=>s.stockId===a.stockId),shares=pos?.shares||0;
        // An unchanged position or the possible original result may be retried with the same key, never treated as a receipt.
        if(shares!==before&&shares!==after)return '当前持仓数量与原交易前后均不符，保留原请求，等待同步或手动核对';
        if(a.action==='sell') {
          const owned=ledger.owned[String(a.stockId)];
          if(!owned||owned.manual||owned.shares!==before)return '原卖出持仓归属无法核对，保留原请求供手动核对';
          if(shares===before&&pos?.costBasisTokens!==owned.cost)return '原卖出持仓成本已改变，保留原请求，等待同步或手动核对';
        }
      }
      if(a.action==='sell') {
        const stock=m.view.stocks.find(s=>s.id===a.stockId&&s.modelName===a.modelName);
        if(!stock||stock.stale||stock.suspended)return '原卖出当前报价无法核对，保留原单等待';
        const proceeds=quote(stock.priceCents,a.shares,m.rules.sellFeePct,false);
        if(proceeds===null)return '原卖出当前扣费后金额无法核对，保留原单等待';
        if(proceeds===0)return '原卖出扣费取整后预计净到账为0代币，保留原请求，等待报价恢复或手动核对';
        return null;
      }
      if(!positive(a.debit))return '原交易预留金额无法核对，保留原请求';
      if(a.action==='predict'&&config.stake!==a.betTokens)return '固定单注已改变，原交易使用旧单注；等待设置一致或手动核对';
      const limit=a.action==='buy'?config.tradeLimit:config.predictionLimit;
      if(spend(ledger.entries.filter(e=>e.id!==p.id),a.action,now)+a.debit>limit)
        return '原交易预留超过当前24小时额度，等待额度恢复或手动核对';
      if(a.action==='buy') {
        const stock=m.view.stocks.find(s=>s.id===a.stockId&&s.modelName===a.modelName);
        if(!stock||stock.stale||stock.suspended)return '原买入当前报价无法核对，保留原单等待';
        const cost=quote(stock.priceCents,a.shares,m.rules.buyFeePct,true);
        if(cost===null)return '原买入当前含费成本无法核对，保留原单等待';
        if(cost>a.debit)return `原买入当前预计含费成本 ${cost} 超过原预留 ${a.debit}，等待报价恢复或手动核对`;
        const positions=m.view.positions.filter(pos=>pos.shares>0);
        if(positions.some(pos=>!whole(pos.costBasisTokens)))return '持仓成本不完整，原交易等待同步后再核对';
        const otherCost=positions.filter(pos=>pos.stockId!==a.stockId).reduce((sum,pos)=>sum+pos.costBasisTokens,0);
        const ownCost=positions.find(pos=>pos.stockId===a.stockId)?.costBasisTokens||0;
        if(otherCost+Math.max(ownCost,a.debit)>config.tradeLimit)return '原交易预留与当前持仓超过设置上限，等待资金条件恢复或手动核对';
      }
      // A lower balance cannot prove this intent executed: another feature may have spent it.
      // Unknown outcomes may be resubmitted only within current funds; an actual receipt is reconciled without another POST.
      if(m.balance-config.reserve<a.debit)
        return '原交易确认可能动用当前保留余额，等待余额恢复或手动核对';
      return null;
    }
    // Only explain a completed no-action check; these messages do not change eligibility, limits, or scheduling.
    function waitReason(m,config,ledger,now) {
      if(!m.view.enabled)return '股市暂未开放';
      const blocked=config.trade&&m.view.stocks.map(s=>sellPlan(m,s,ledger.owned,now)).find(s=>s?.blocked);
      if(blocked)return blocked.reason;
      const messages=[],free=Math.max(0,m.balance-config.reserve),r=m.rules;
      const budgetWait=(action,limit,needed,label)=>{
        let used=spend(ledger.entries,action,now);
        const expiring=ledger.entries.filter(e=>e.action===action&&e.result!=='rejected'&&e.debit>0&&entryTime(e)>now-86400000)
          .slice().sort((a,b)=>entryTime(a)-entryTime(b));
        for(const e of expiring){
          used-=e.debit;
          if(used+needed<=limit)return `；按当前记录约${Math.max(1,Math.ceil((entryTime(e)+86400000-now)/60000))}分钟后${label}`;
        }
        return '';
      };
      if(config.trade) {
        const positions=m.view.positions.filter(p=>p.shares>0),spent=spend(ledger.entries,'buy',now);
        const held=positions.reduce((sum,p)=>sum+(p.costBasisTokens??0),0);
        let reason;
        if(!config.tradeLimit)reason='未设置股票额度';
        else if(positions.some(p=>!whole(p.costBasisTokens)))reason='持仓成本不完整，等待同步';
        else if(positions.filter(p=>ledger.owned[String(p.stockId)]&&!ledger.owned[String(p.stockId)].manual).length>=3)reason='已有3只脚本持仓，继续核对现有持仓';
        else if(held>=config.tradeLimit)reason='当前持仓成本已达设置上限';
        else if(held>=r.maxPositionTokens)reason='已达网站总持仓成本上限';
        else if(spent>=config.tradeLimit)reason='24小时买入额度已用完'+budgetWait('buy',config.tradeLimit,1,'开始释放');
        else if(spent>=r.maxDailyBuyTokens)reason='网站买入额度暂无余量，按已记录支出保守等待';
        else if(free<=0)reason='可用余额已到保留线';
        else if(!r.maxTradeTokens)reason='网站单笔交易额度为0';
        else reason='暂无同时满足行情、持仓和资金条件的股票';
        messages.push('买入：'+reason);
      }
      if(config.predict) {
        let reason;
        if(!config.stake)reason='尚未设置有效固定单注';
        else if(config.stake>config.predictionLimit)reason='固定单注超过预测额度';
        else if(spend(ledger.entries,'predict',now)+config.stake>config.predictionLimit)
          reason='24小时额度不足一注'+budgetWait('predict',config.predictionLimit,config.stake,'可容纳一注');
        else if(free<config.stake)reason='可用余额不足固定单注，保留余额不动用';
        else reason='暂无同时满足行情、轮次和去重条件的预测';
        messages.push('预测：'+reason);
      }
      return messages.join('；') || '股市自动操作未开启';
    }
    const input = (a,userId) => a.action==='predict' ? {roundId:a.roundId,direction:a.direction,betTokens:a.betTokens,action:a.action,expectedUserId:userId} :
      {modelName:a.modelName,shares:a.shares,action:a.action,expectedUserId:userId};
    const same = (a,b) => a && b && Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(k=>a[k]===b[k]);
    function receipt(p,status,r) {
      if(!p.key || r?.userId!==p.input.expectedUserId || r.action!==p.input.action || r.idempotencyKey!==p.key)return null;
      if(status>=200 && status<300 && r.ok===true)return 'success';
      if(status===400 && r.executed===false && r.code!=='idempotency_conflict')return 'rejected';
      return null;
    }
    return {whole,positive,id,time,quote,sharesFor,model,uniqueBet,trend,entryTime,spend,sellPlan,choose,recoveryWait,waitReason,input,same,receipt};
  })();
  // STOCK_CORE_END

  const LOG_PREFIX = 'arkengine:auto-log:v1:';
  const diagnosticLogs = {};
  // 仅在本脚本点击领取的同步调用期间绑定原网页请求，不读取请求正文。
  let captureExpeditionClaim = null;
  let captureShelterAction = null;
  let continueShelterAction = null;
  let captureStockAction = null;
  let observeStockPost = null;
  let observeSessionPage = () => {};
  const pageGroup = path => /^\/cultivate(?:\/(?:dungeon|fog))?\/?$/.test(path) ? 'cultivate' :
    /^(?:\/activities\/expedition|\/farm|\/shelter|\/stock)\/?$/.test(path) ? 'expedition' : '';
  const diagnosticPage = (path = location.pathname) => path === '/' || pageGroup(path) ? path : '[其他页面]';
  const logDay = (at = Date.now()) => new Date(at + 8 * 3600000).toISOString().slice(0, 10);
  const RECEIPTS = {
    encounter: /^奇遇奖励已入账[:：]/,
    dungeon: /^(节点奖励已入账|秘境探索完成,本次累计)[:：]/,
    expedition: /^(远征归来,获得\s|已领取\s*\d+\s*支远征,共获得\s)/,
    'farm-sale': /^卖出成功,实际获得\s/,
  };
  const receiptTexts = () => [...document.querySelectorAll('[role="status"]')]
    // 弹窗会把旧回执所在的主体标记 aria-hidden；仍需纳入提交前基线，避免关窗后误记。
    .filter(n => !n.matches('.text-destructive, .bg-destructive'))
    .map(n => (n.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim())
    .filter(s => Object.values(RECEIPTS).some(pattern => pattern.test(s)));
  function receiptReward(text) {
    const result = {};
    const number = '([+-]?)\\s*((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)\\s*([万亿]?)';
    function append(label, match) {
      const value = Number(match[2].replaceAll(',', '')) *
        (match[3] === '亿' ? 1e8 : match[3] === '万' ? 1e4 : 1) * (match[1] === '-' ? -1 : 1);
      if (Number.isFinite(value)) result[label] = (result[label] || 0) + value;
    }
    if (RECEIPTS.encounter.test(text) || RECEIPTS.dungeon.test(text)) {
      for (const part of text.replace(/^[^:：]*[:：]/, '').split(/[·|;；]/)) {
        const match = part.trim().match(new RegExp(`^(修为|钻石|代币)\\s*${number}$`));
        if (match) append(match[1], match.slice(1));
      }
    } else {
      // 主奖励与“额外获得”的里程碑分开读取；不把里程碑次数、报价、产出系数当金额。
      const main = text.match(new RegExp(`^(?:远征归来,获得|已领取\\s*\\d+\\s*支远征,共获得|卖出成功,实际获得)\\s*${number}\\s*代币(?=$|[!;\\s(])`));
      if (main) append('代币', main);
      if (RECEIPTS.expedition.test(text)) {
        for (const milestone of text.matchAll(/达成\s*\d+\s*次里程碑,额外获得([^!;]+)/g)) {
          for (const part of milestone[1].split(/\s+\+\s*/)) {
            const match = part.trim().match(new RegExp(`^${number}\\s*(代币|钻石)$`));
            if (match) append(match[4], match);
          }
        }
      }
    }
    return result;
  }
  const SCRIPT_VERSION = '1.14.38';
  function mountPanelControls(shadow,group) {
    const box=shadow.querySelector('.box'),title=box.querySelector('strong'),fullTitle=title.textContent;
    const key=`arkengine:auto-panel:${group}:collapsed:v1`;
    const style=document.createElement('style');
    style.textContent=`.panel-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
      .panel-heading{min-width:0}.panel-heading strong{display:block;font-size:13px}
      .panel-version{display:block;color:#acbde1;font-size:11px}
      #panel-fold{flex-shrink:0;min-height:28px;padding:2px 8px}
      #panel-content[hidden]{display:none}`;
    shadow.append(style);
    const header=document.createElement('header');header.className='panel-header';
    const heading=document.createElement('div');heading.className='panel-heading';
    const version=document.createElement('span');version.id='script-version';version.className='panel-version';
    version.textContent=`v${SCRIPT_VERSION}`;heading.append(title,version);
    const fold=document.createElement('button');fold.id='panel-fold';fold.type='button';
    fold.setAttribute('aria-controls','panel-content');header.append(heading,fold);
    const content=document.createElement('div');content.id='panel-content';
    while(box.firstChild)content.append(box.firstChild);
    box.append(header,content);
    const render=collapsed=>{
      content.hidden=collapsed;
      title.textContent=collapsed?(group==='cultivate'?'修仙助手':'远征助手'):fullTitle;
      fold.textContent=collapsed?'展开':'折叠';
      fold.setAttribute('aria-expanded',String(!collapsed));
      fold.title=collapsed?'展开脚本面板':'折叠面板，脚本继续运行';
      box.scrollTop=0;
    };
    let collapsed=false;
    try{collapsed=localStorage.getItem(key)==='true';}catch{ /* 面板偏好不可读时仍可使用默认展开状态 */ }
    render(collapsed);
    fold.addEventListener('click',()=>{
      render(!content.hidden);
      try{localStorage.setItem(key,String(content.hidden));}
      catch{fold.title+='；本次状态仅在当前页面生效';}
    });
  }
  const LOG_BUDGET = 20 * 1024 * 1024;
  const LOG_DAYS = 7;
  const logBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const normalLog = event => ['state', 'heartbeat'].includes(event.type) ||
    event.type === 'request-result' && event.data?.status >= 200 && event.data.status < 400;
  const idbResult = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function logTransaction(db, stores, mode, run) {
    const tx = db.transaction(stores, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || new Error('日志事务中止'));
      tx.onerror = () => {}; // 由 onabort 统一报告，不能把 request 成功当作提交成功。
    });
    // 提前接住事务错误，避免异步 run 尚未退出时产生未处理拒绝。
    done.catch(() => {});
    try { const result = await run(tx); await done; return result; }
    catch (error) { try { tx.abort(); } catch { /* 已结束 */ } await done.catch(() => {}); throw error; }
  }
  function createLogStore() {
    let connection;
    let queue = Promise.resolve();
    const warnings = new Set();
    const blank = (group, day) => ({ key: `${group}:${day}`, group, day, counts: {}, totals: {},
      dropped: 0, sampled: 0, firstAt: null, lastAt: null });
    const emptyBudget = () => ({ key: 'budget', bytes: 0, normalBytes: 0, day: '' });
    const stores = ['events', 'days', 'meta'];
    async function open() {
      if (connection) return connection;
      connection = new Promise((resolve, reject) => {
        const request = indexedDB.open('arkengine-auto-log', 1);
        let blocked = false;
        request.onupgradeneeded = () => {
          const db = request.result;
          const events = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
          events.createIndex('bucket', 'bucket');
          events.createIndex('day', 'day');
          events.createIndex('priorityAt', ['priority', 'at']);
          db.createObjectStore('days', { keyPath: 'key' });
          db.createObjectStore('meta', { keyPath: 'key' });
        };
        request.onblocked = () => { blocked = true; reject(new Error('日志数据库升级被其他标签页阻塞')); };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) { db.close(); return; }
          db.onversionchange = () => { db.close(); connection = null; };
          db.onclose = () => { connection = null; };
          resolve(db);
        };
      }).catch(error => { connection = null; throw error; });
      return connection;
    }
    const enqueue = work => {
      const result = queue.then(async () => work(await open()));
      queue = result.catch(() => {});
      return result;
    };
    // 游标删除避免加载整个七天事件数组；预算按序列化 UTF-8 估算，不冒充磁盘实占。
    const walk = (request, visit) => new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || visit(cursor) === false) { resolve(); return; }
        cursor.continue();
      };
    });
    async function maintain(tx, budget) {
      const events = tx.objectStore('events');
      const days = tx.objectStore('days');
      const earliest = logDay(Date.now() - (LOG_DAYS - 1) * 86400000);
      if (budget.day !== logDay()) {
        await walk(events.index('day').openCursor(IDBKeyRange.upperBound(earliest, true)), cursor => {
          budget.bytes -= cursor.value.bytes;
          if (!cursor.value.priority) budget.normalBytes -= cursor.value.bytes;
          cursor.delete();
        });
        await walk(days.openCursor(), cursor => { if (cursor.value.day < earliest) cursor.delete(); });
        await walk(tx.objectStore('meta').openCursor(), cursor => {
          if (cursor.value.day && /^(migration|receipt):/.test(cursor.value.key) && cursor.value.day < earliest) cursor.delete();
        });
        budget.day = logDay();
      }
      const dropped = new Map();
      for (const priority of [0, 1]) {
        if (budget.bytes <= LOG_BUDGET && budget.normalBytes <= LOG_BUDGET * 0.8) break;
        await walk(events.index('priorityAt').openCursor(IDBKeyRange.bound([priority, 0], [priority, Number.MAX_VALUE])), cursor => {
          if (budget.bytes <= LOG_BUDGET && budget.normalBytes <= LOG_BUDGET * 0.8) return false;
          const event = cursor.value;
          budget.bytes -= event.bytes;
          if (!priority) budget.normalBytes -= event.bytes;
          dropped.set(event.bucket, (dropped.get(event.bucket) || 0) + 1);
          cursor.delete();
        });
      }
      for (const [key, count] of dropped) {
        const day = await idbResult(days.get(key));
        if (day) { day.dropped += count; days.put(day); }
      }
      budget.bytes = Math.max(0, budget.bytes);
      budget.normalBytes = Math.max(0, budget.normalBytes);
      tx.objectStore('meta').put(budget);
    }
    async function migrate(db) {
      const earliest = logDay(Date.now() - (LOG_DAYS - 1) * 86400000);
      const keys = Object.keys(localStorage).filter(key => /^arkengine:auto-log:v1:(cultivate|expedition):\d{4}-\d{2}-\d{2}$/.test(key));
      for (const key of keys) {
        const day = key.slice(-10);
        if (day < earliest) { localStorage.removeItem(key); continue; }
        const raw = localStorage.getItem(key);
        let old;
        try {
          old = JSON.parse(raw);
          if (!objectState(old) || !Array.isArray(old.events)) throw new Error('InvalidLegacyLog');
        } catch { warnings.add(`旧日志不可读，原文保留：${key}`); continue; }
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))].map(b => b.toString(16).padStart(2, '0')).join('');
        const group = key.split(':')[3];
        const migrated = await logTransaction(db, stores, 'readwrite', async tx => {
          const meta = tx.objectStore('meta');
          const marker = await idbResult(meta.get(`migration:${key}`));
          if (marker) return marker.digest === digest;
          const days = tx.objectStore('days');
          const entry = await idbResult(days.get(`${group}:${day}`)) || blank(group, day);
          const budget = await idbResult(meta.get('budget')) || emptyBudget();
          for (const field of ['counts', 'totals']) {
            for (const [name, value] of Object.entries(old[field] || {})) {
              if (Number.isFinite(value)) entry[field][name] = (entry[field][name] || 0) + value;
            }
          }
          entry.dropped += Number.isSafeInteger(old.dropped) && old.dropped > 0 ? old.dropped : 0;
          for (const event of old.events) {
            if (!objectState(event)) { entry.dropped++; continue; }
            const item = { ...event, at: Number.isFinite(event.at) ? event.at : Date.parse(`${day}T00:00:00+08:00`),
              bucket: entry.key, day, priority: normalLog(event) ? 0 : 1 };
            delete item.id;
            item.bytes = logBytes(item);
            tx.objectStore('events').add(item);
            budget.bytes += item.bytes;
            if (!item.priority) budget.normalBytes += item.bytes;
            entry.firstAt = entry.firstAt === null ? item.at : Math.min(entry.firstAt, item.at);
            entry.lastAt = Math.max(entry.lastAt || 0, item.at);
          }
          days.put(entry);
          meta.put({ key: `migration:${key}`, digest, day });
          await maintain(tx, budget);
          return true;
        });
        // 必须等待事务提交，且旧版没有继续写此键，才可移除已迁移副本。
        if (migrated && localStorage.getItem(key) === raw) localStorage.removeItem(key);
        else warnings.add(`旧版日志仍有变化，原文保留：${key}`);
      }
    }
    let migrated = false;
    const ready = async db => { if (!migrated) { await migrate(db); migrated = true; } };
    return {
      append(event, reward, sampled) {
        return enqueue(async db => {
          await ready(db);
          return logTransaction(db, stores, 'readwrite', async tx => {
            const day = logDay(event.at);
            const key = `${event.group}:${day}`;
            const days = tx.objectStore('days');
            const entry = await idbResult(days.get(key)) || blank(event.group, day);
            const meta = tx.objectStore('meta');
            if (event.receiptId && await idbResult(meta.get(`receipt:${event.receiptId}`))) return entry;
            entry.counts[event.type] = (entry.counts[event.type] || 0) + 1;
            for (const [name, value] of Object.entries(reward || {})) {
              if (Number.isFinite(value)) entry.totals[name] = (entry.totals[name] || 0) + value;
            }
            entry.firstAt = entry.firstAt === null ? event.at : Math.min(entry.firstAt, event.at);
            entry.lastAt = Math.max(entry.lastAt || 0, event.at);
            const budget = await idbResult(tx.objectStore('meta').get('budget')) || emptyBudget();
            if (sampled) entry.sampled++;
            else {
              const item = { ...event, bucket: key, day, priority: normalLog(event) ? 0 : 1 };
              item.bytes = logBytes(item);
              tx.objectStore('events').add(item);
              budget.bytes += item.bytes;
              if (!item.priority) budget.normalBytes += item.bytes;
            }
            days.put(entry);
            if (event.receiptId) meta.put({ key: `receipt:${event.receiptId}`, day });
            await maintain(tx, budget);
            return idbResult(days.get(key));
          });
        });
      },
      read(group, day = logDay(), limit = 30) {
        return enqueue(async db => {
          await ready(db);
          return logTransaction(db, ['days', 'events'], 'readonly', async tx => {
            const key = `${group}:${day}`;
            const entry = await idbResult(tx.objectStore('days').get(key));
            if (!entry) return null;
            const events = [];
            await walk(tx.objectStore('events').index('bucket').openCursor(key, 'prev'), cursor => {
              events.push(cursor.value); return events.length < limit;
            });
            return { ...entry, events: events.reverse() };
          });
        });
      },
      export() {
        return enqueue(async db => {
          await ready(db);
          return logTransaction(db, stores, 'readwrite', async tx => {
            const budget = await idbResult(tx.objectStore('meta').get('budget')) || emptyBudget();
            await maintain(tx, budget);
            const days = await idbResult(tx.objectStore('days').getAll());
            for (const day of days) {
              day.events = await idbResult(tx.objectStore('events').index('bucket').getAll(day.key));
              day.events.sort((a, b) => a.at - b.at || a.id - b.id);
              for (const event of day.events) { delete event.id; delete event.bytes; delete event.bucket; delete event.priority; }
              delete day.key;
            }
            return { days, retentionDays: LOG_DAYS, budgetBytes: LOG_BUDGET, estimatedEventBytes: budget.bytes,
              byteAccounting: '事件序列化 UTF-8 估算；索引、数据库元数据和每日汇总不计入', warnings: [...warnings] };
          });
        });
      },
    };
  }
  const logStore = createLogStore();

  function createLog(group) {
    const pageId = crypto.randomUUID();
    const heartbeatKey = `${LOG_PREFIX}${group}:heartbeat`;
    const receiptKey = `${LOG_PREFIX}${group}:receipt`;
    let checkpoint = null;
    let pending = null;
    let receiptWriting = false;
    let receiptWriteFailed = false;
    let lastTick = 0;
    let lastWrite = 0;
    let lastState = '';
    let lastSample = 0;
    let hint;
    let storageFailed = false;
    try {
      checkpoint = JSON.parse(localStorage.getItem(heartbeatKey) || 'null');
      pending = JSON.parse(sessionStorage.getItem(receiptKey) || 'null');
      lastSample = checkpoint?.sampleAt || 0;
    } catch { storageFailed = true; }
    let cached = { day: logDay(), totals: {}, events: [] };
    let failedWrites = 0;
    const samples = new Map();
    const outboxKey = `${LOG_PREFIX}${group}:outbox`;
    let outbox = [];
    let outboxWritable = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(outboxKey) || '[]');
      if (!Array.isArray(saved) || saved.some(e => !objectState(e) || e.group !== group ||
          !Number.isFinite(e.at) || typeof e.receiptId !== 'string' || !objectState(e.data))) throw new Error('InvalidOutbox');
      outbox = saved.filter(e => logDay(e.at) >= logDay(Date.now() - 6 * 86400000));
    } catch { storageFailed = true; outboxWritable = false; }
    function saveOutbox() {
      if (!outboxWritable) { failed(); return; }
      try { sessionStorage.setItem(outboxKey, JSON.stringify(outbox)); }
      catch { failed(); }
    }
    function committed(event, value) {
      if (event.receiptId && outbox.some(e => e.receiptId === event.receiptId)) {
        outbox = outbox.filter(e => e.receiptId !== event.receiptId); saveOutbox();
      }
      if (value?.day === logDay()) cached = { ...value, events: cached.events };
      render();
      return true;
    }
    // 小型本地交付队列只保存收益事件；刷新后由随机回执ID去重，不保存游戏请求密钥。
    for (const event of outbox) logStore.append(event, event.data.reward, false)
      .then(value => committed(event, value)).catch(failed);
    function failed() { storageFailed = true; failedWrites++; render(); }
    function render() {
      if (!hint) return;
      const totals = cached.day === logDay() ? cached.totals : {};
      const message = storageFailed ? '日志存储失败；部分事件未保存，自动操作仍继续。请检查站点空间后重新导出。' :
        `本组今日确认收入：代币 ${totals['代币'] || 0} · 修为 ${totals['修为'] || 0} · 钻石 ${totals['钻石'] || 0}（毛收入，不含未完成秘境）`;
      if (hint.textContent !== message) hint.textContent = message;
    }
    function refreshLog() {
      return logStore.read(group).then(value => {
        cached = value || { day: logDay(), totals: {}, events: [] }; render(); return cached;
      }).catch(failed);
    }
    function add(type, detail = '', data = {}, sum = false, receiptId) {
      const now = Date.now();
      if (sum) receiptId ||= crypto.randomUUID();
      const event = { at: now, beijing: new Date(now + 8 * 3600000).toISOString().replace('Z', '+08:00'),
        group, page: diagnosticPage(), pageId, version: SCRIPT_VERSION, visibility: document.visibilityState,
        type, detail: String(detail).slice(0, 300), data, ...(receiptId ? { receiptId } : {}) };
      let sampled = false;
      if (normalLog(event)) {
        const key = type === 'request-result' ? `${type}:${data.path}:${data.method}:${data.status}` :
          `${type}:${event.detail.replace(/\d+(?:\.\d+)?/g, '#')}`;
        const previous = samples.get(key);
        sampled = previous !== undefined && now >= previous && now - previous < 30000;
        if (!sampled) samples.set(key, now);
        if (samples.size > 256) samples.delete(samples.keys().next().value);
      }
      // 结构化诊断限定体积；不让单条异常耗尽日志配额。
      if (logBytes(data) > 32768) event.data = { truncated: true };
      if (sum && !outbox.some(e => e.receiptId === receiptId)) {
        if (outbox.length < 50) { outbox.push(event); saveOutbox(); }
        else failed();
      }
      return logStore.append(event, sum ? data.reward : null, sampled)
        .then(value => committed(event, value)).catch(() => { failed(); return false; });
    }
    function saveReceipt(value) {
      pending = value;
      try { sessionStorage.setItem(receiptKey, JSON.stringify(value)); } catch { storageFailed = true; }
    }
    function expect(kind) {
      receiptWriteFailed = false;
      saveReceipt({ kind, at: Date.now(), before: receiptTexts(), changed: false, receiptId: crypto.randomUUID() });
    }
    function receipts() {
      if (!pending || receiptWriting || receiptWriteFailed) return;
      const texts = receiptTexts();
      const matches = texts.filter(s => RECEIPTS[pending.kind]?.test(s));
      if (!pending.changed && !matches.some(s => pending.before.includes(s))) saveReceipt({ ...pending, changed: true });
      const receipt = matches.find(s => pending.changed || !pending.before.includes(s));
      if (!receipt) return;
      const kind = pending.kind === 'expedition' ? 'expedition-reward' : pending.kind === 'farm-sale' ? 'farm-sale-reward' :
        receipt.startsWith('奇遇') ? 'encounter-reward' : receipt.startsWith('秘境探索完成') ? 'dungeon-reward' : 'dungeon-node-reward';
      // 秘境只把最终累计收入加入总额，节点回执仅供排障，不重复累加。
      if (!pending.receiptId) saveReceipt({ ...pending, receiptId: crypto.randomUUID() });
      const original = pending;
      receiptWriting = true;
      add(kind, receipt, { reward: receiptReward(receipt) }, kind !== 'dungeon-node-reward', original.receiptId).then(saved => {
        receiptWriting = false;
        if (pending !== original) return;
        if (saved) saveReceipt(null);
        else receiptWriteFailed = true; // 原记录保留，刷新后可重核；不在满空间时反复写。
      });
    }
    function pulse(state, diagnostic = {}) {
      const now = Date.now();
      diagnostic = { ...diagnostic, runtime: runtimeDiagnostic() };
      const normalizedState = String(state).replace(/\d+(?:\.\d+)?/g, '#');
      if (state && normalizedState !== lastState) {
        lastState = normalizedState;
        add('state', state);
      }
      const previous = lastTick || (checkpoint?.active ? checkpoint.at : 0);
      if (previous && now - previous > 120000) add('heartbeat-gap', '脚本两次检查间隔超过两分钟；原因待核对',
        { from: previous, to: now, gapMs: now - previous, previousState: checkpoint?.state || '', discarded: Boolean(document.wasDiscarded) });
      lastTick = now;
      receipts();
      // 留下低频执行证据；只写本地日志，不访问游戏接口。
      if (now - lastSample >= 15 * 60000) {
        lastSample = now;
        add('heartbeat', state, diagnostic);
      }
      if (now - lastWrite >= 60000) {
        checkpoint = { at: now, sampleAt: lastSample, pageId, version: SCRIPT_VERSION, active: true,
          state: String(state).slice(0, 180), page: diagnosticPage(), visibility: document.visibilityState, diagnostic };
        try { localStorage.setItem(heartbeatKey, JSON.stringify(checkpoint)); } catch { storageFailed = true; }
        lastWrite = now;
        render();
      }
    }
    function stop(reason) {
      add('pause', reason, { reason: /账号|登录|权限|限流/.test(reason) ? 'account' : /手动|人工/.test(reason) ? 'manual' :
        /保存记录/.test(reason) ? 'invalid-state' : /原.*结果|恢复上限/.test(reason) ? 'pending-result' : 'page-or-runtime' });
      checkpoint = { at: Date.now(), pageId, version: SCRIPT_VERSION, active: false, state: reason };
      lastTick = 0;
      try { localStorage.setItem(heartbeatKey, JSON.stringify(checkpoint)); } catch { storageFailed = true; }
    }
    function observeLifecycle(context) {
      const record = (event, name = event.type) => {
        const state = context();
        if (!state) return;
        // 生命周期事件不算调度心跳，不能掩盖恢复后发现的检查中断。
        add('page-lifecycle', `页面事件：${name}`, {
          event: name, persisted: Boolean(event.persisted), trusted: Boolean(event.isTrusted),
          discarded: Boolean(document.wasDiscarded), ...runtimeDiagnostic(),
          ...(name === 'load' ? { startup: { injectedAt, injectedReadyState, bodyWaitMs } } : {}),
          ...(['load', 'DOMContentLoaded', 'document-load'].includes(name) ? { navigation: navigationDiagnostic() } : {}),
          lastTickAt: lastTick || null, gapMs: lastTick ? Math.max(0, Date.now() - lastTick) : null,
          ...state,
        });
      };
      for (const name of ['freeze', 'resume', 'visibilitychange', 'readystatechange', 'DOMContentLoaded']) document.addEventListener(name, record, true);
      for (const name of ['pageshow', 'pagehide', 'online', 'offline']) window.addEventListener(name, record, true);
      window.addEventListener('load', event => { if (event.target === document) record(event, 'document-load'); });
      record({ type: 'load' });
    }
    function mount(shadow) {
      const box = shadow.querySelector('.box');
      hint = document.createElement('p'); hint.className = 'hint'; hint.id = 'log-summary'; box.append(hint);
      const details = document.createElement('details');
      details.innerHTML = '<summary style="cursor:pointer">本地日志（最近 7 天）</summary><p class="hint">北京时间今天及前 6 天；两组共用约 20 MiB 事件预算。重复普通状态会合并；关键故障、结果与收益汇总优先保留。导出包含采样、截断和覆盖时间。</p><button type="button">导出两页日志（7 天）</button><pre style="white-space:pre-wrap;max-height:180px;overflow:auto;font:11px/1.5 system-ui"></pre>';
      details.addEventListener('toggle', async () => {
        if (!details.open) return;
        const value = await refreshLog();
        details.querySelector('pre').textContent = value ? value.events.map(e =>
          `${e.beijing?.slice(11,19) || ''} ${e.type || ''} ${e.detail || ''}`).join('\n') || '今天暂无记录' : '日志不可读';
      });
      details.querySelector('button').onclick = async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const result = await logStore.export();
          const heartbeats = Object.fromEntries(['cultivate', 'expedition'].map(name =>
            [name, JSON.parse(localStorage.getItem(`${LOG_PREFIX}${name}:heartbeat`) || 'null')]));
          const failures = Object.fromEntries(Object.entries(diagnosticLogs).map(([name, logger]) => [name, logger.failedWrites()]));
          const url = URL.createObjectURL(new Blob([JSON.stringify({ version: SCRIPT_VERSION, exportedAt: new Date().toISOString(),
            ...result, heartbeats, storageFailuresInThisPage: failures }, null, 2)], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = url; link.download = `arkengine-log-${logDay()}.json`;
          link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch { failed(); }
        finally { button.disabled = false; }
      };
      box.append(details); render(); refreshLog();
      const scopes = group === 'cultivate' ? ['cultivate', 'dungeon', 'fog'] : ['expedition', 'farm', 'shelter', 'stock'];
      for (const [key, scope] of stateFaults) if (scopes.includes(scope)) {
        add('invalid-state', '保存记录不可读，原文保留；受影响功能暂停', { key, scope });
      }
    }
    const log = { add, pulse, stop, expect, receipts, mount, observeLifecycle, failedWrites: () => failedWrites };

    diagnosticLogs[group] = log;
    return log;
  }

  function observeSession() {
    const contextKey = 'arkengine:auto:session-context:v1';
    // 仅保存功能组与固定页面路径，跨整页跳转保留来源，不读取登录资料。
    let previous = null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(contextKey) || 'null');
      if (saved && pageGroup(saved.page) === saved.group && saved.group) previous = saved;
    } catch { /* 没有可靠来源时不把首次打开登录页当成掉线 */ }
    let onLogin = false;
    observeSessionPage = () => {
      try {
        const group = pageGroup(location.pathname);
        if (group && previous?.page !== location.pathname) {
          previous = { group, page: location.pathname };
          try { sessionStorage.setItem(contextKey, JSON.stringify(previous)); } catch { /* 保留本页来源 */ }
        }
        // 2026-10-14 公开首页：LinuxDo 登录链接与备用登录表单。
        const login = location.pathname === '/' && [...document.querySelectorAll(
          'a[href="/api/auth/linuxdo"], form[aria-label="备用账号登录"] input[type="password"]')]
          .some(el => !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
            el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
        if (login && !onLogin && previous) {
          diagnosticLogs[previous.group].add('login-page', '从游戏页面进入登录页；无法仅据此判断登出原因',
            { from: previous.page, to: '/' });
          if (!accountStopReason()) pauseAccount('已从游戏页面进入登录页，请手动登录');
        }
        onLogin = login;
      } catch { /* 诊断失败不能影响网站导航 */ }
    };
    observeSessionPage();
    window.addEventListener('pagehide', observeSessionPage);

    const paths = new Set(['/api/cultivation', '/api/cultivation/dungeons', '/api/cultivation/fog',
      '/api/activities', '/api/activities/expedition-claim-all', '/api/activities/expedition-event',
      '/api/farm', '/api/farm/plant', '/api/farm/plant-all', '/api/farm/harvest', '/api/farm/harvest-all',
      '/api/farm/sell', '/api/me/balance', '/api/stamina', '/api/shelter', '/api/shelter/action', '/api/stock']);
    const background = new Set(['/api/me/balance', '/api/stamina']);
    const samples = new Map();
    function record(info, result) {
      // 相同错误每分钟最多一条；后台余额、体力同类响应每十五分钟一条，状态变化立即记录。
      const key = `${info.group}:${info.path}`;
      const signature = `${result.status}:${result.outcome}`;
      const last = samples.get(key);
      const interval = background.has(info.path) ? 15 * 60000 : result.outcome === 'ok' ? 0 : 60000;
      const now = Date.now();
      if (!last || last.signature !== signature || now - last.at >= interval) {
        samples.set(key, { signature, at: now });
        diagnosticLogs[info.group].add('request-result', '已有游戏请求的被动观察结果',
            { path: info.path, startedAt: info.at, durationMs: Math.max(0, now - info.at), status: result.status, outcome: result.outcome,
            redirected: Boolean(result.redirected), ...(result.to ? { to: result.to } : {}) });
      }
      const reason = result.outcome === 'login-redirect' ? '游戏请求跳转至登录入口，请手动核对登录' :
        ({ 401: '游戏请求返回 HTTP 401（未授权）', 403: '游戏请求返回 HTTP 403（拒绝访问）',
          429: '游戏请求返回 HTTP 429（限流）' })[result.status];
      if (reason && !accountStopReason()) pauseAccount(reason);
    }
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const at = Date.now();
      const claimCapture = captureExpeditionClaim;
      let shelterCapture = captureShelterAction;
      // 免费赛季原生按钮逐档await；后续请求仍属于同一批次，普通读取不加入捕获。
      if(!shelterCapture&&continueShelterAction){
        try{
          const input=args[0],url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input?.url,document.baseURI);
          const method=String(args[1]?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
          let body;try{body=JSON.parse(args[1]?.body);}catch{ /* 地址仍可识别 */ }
          if(url.pathname==='/api/shelter/action'&&method!=='GET'||body?.action?.type==='claim_season')shelterCapture=continueShelterAction;
        }catch{ /* 其他页面的非避难所请求不接管 */ }
      }
      let stockCapture = captureStockAction;
      // 自动点击只接受能同步核对的原生JSON请求，地址、方法或正文变化时在发送前停止。
      // 人工Request正文仅从副本被动观察，不消费原流，也不延迟网站请求。
      let stockBound = false;
      let observedStockBody = null;
      let observedStockNative;
      if (stockCapture || observeStockPost) {
        try {
          const input = args[0], raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
          const url = new URL(raw, document.baseURI);
          const method=String(args[1]?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
          const matches=url.origin===location.origin&&url.pathname==='/api/stock'&&method==='POST';
          if(stockCapture) {
            if(!matches||typeof args[1]?.body!=='string')throw Error('股市请求格式无法同步核对');
            stockCapture.bind(JSON.parse(args[1].body));stockBound=true;
          }else if(matches) {
            if(typeof args[1]?.body==='string') {
              stockCapture=observeStockPost?.(JSON.parse(args[1].body));stockBound=Boolean(stockCapture);
            }else if(input instanceof Request&&args[1]?.body==null) {
              observedStockNative=observeStockPost?.snapshot();
              observedStockBody=input.clone().json().catch(()=>null);
            }
          }
        } catch (error) { if(captureStockAction){captureStockAction.fail();return Promise.reject(error);} }
      }
      if(shelterCapture?.validate) {
        try {
          const input=args[0],url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input?.url,document.baseURI);
          const method=String(args[1]?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
          if(url.origin!==location.origin||url.pathname!=='/api/shelter/action'||method!=='POST'||typeof args[1]?.body!=='string')
            throw Error('避难所请求格式无法同步核对');
          shelterCapture.validate(JSON.parse(args[1].body));
        }catch(error){shelterCapture.fail(error);return Promise.reject(error);}
      }
      const promise = Reflect.apply(originalFetch, this, args);
      if (stockBound) promise.then(response => response.clone().json().then(body => stockCapture.result(response.status,body)),
        () => stockCapture.result(null,null)).catch(() => stockCapture.result(null,null));
      if(observedStockBody) {
        // Clone the response as soon as it arrives; the site's own reader may consume it next.
        const receipt=promise.then(response=>response.clone().json().then(body=>({status:response.status,body})),()=>null).catch(()=>null);
        observedStockBody.then(body=>{
          const observer=body&&observeStockPost?.(body,observedStockNative);if(!observer)return;
          return receipt.then(result=>observer.result(result?.status??null,result?.body??null));
        }).catch(()=>{ /* 被动观察失败不能改变网站收到的结果 */ });
      }
      try {
        const input = args[0];
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href :
          input instanceof Request ? input.url : null;
        const url = raw === null ? null : new URL(raw, document.baseURI);
        const group = pageGroup(location.pathname) || previous?.group;
        if (url?.origin === location.origin && paths.has(url.pathname) && group) {
          const info = { group, path: url.pathname, at };
          const method = String(args[1]?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
          const report = (result,response) => {
            record(info, result);
            if (claimCapture?.path === info.path && method === 'POST') claimCapture.result(result);
            if (shelterCapture && info.path === '/api/shelter/action' && method === 'POST') {
              let request=null;try{request=JSON.parse(args[1]?.body);}catch{ /* 无可核对的原生正文 */ }
              shelterCapture(result,request);
              if(response && result.outcome==='ok')response.clone().json().then(body=>shelterCapture(result,request,body))
                .catch(()=>{ shelterCapture.end?.(); /* 缺少正文保留未知结果，后续按目标状态核对 */ });
            }
          };
          promise.then(response => {
            let loginRedirect = false;
            if (response.redirected && response.url) {
              const target = new URL(response.url);
              loginRedirect = target.origin === location.origin && target.pathname === '/';
            }
            report({ status: response.status, redirected: response.redirected,
              outcome: loginRedirect ? 'login-redirect' : response.ok ? 'ok' : 'http-error',
              ...(loginRedirect ? { to: '/' } : {}) },response);
          }, error => report({ status: null,
            outcome: error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'aborted' : 'network-error' }))
            .catch(() => { /* 日志或监听失败不能改变网站收到的结果 */ });
        }
      } catch { /* 诊断不可用时仍返回原始请求 */ }
      return promise;
    };
  }

  function createRecovery(group, log, say) {
    const key = `arkengine:auto-recovery:${group}:v1`;
    // 原请求标识仅保存在本地，不写入可导出的日志。刷新不重置预算。
    let states = loadState(sessionStorage, key, {}, group, value => objectState(value) &&
      Object.values(value).every(s => objectState(s) && typeof s.identity === 'string' &&
        Number.isInteger(s.attempts) && s.attempts >= 0 && Number.isFinite(s.nextAt)));
    const save = () => sessionStorage.setItem(key, JSON.stringify(states));
    return {
      ready(scope, identity, startedAt, pause, label, limit = 3) {
        if (states[scope]?.identity !== identity) {
          states[scope] = { identity, attempts: 0, nextAt: startedAt + 30000 };
          save();
        }
        const state = states[scope];
        if (Date.now() < state.nextAt) {
          say(`${label}：等待原结果，约 ${Math.ceil((state.nextAt - Date.now()) / 1000)} 秒后再核对`);
          return false;
        }
        if (state.attempts >= limit) {
          pause(`${label}已达恢复上限，原记录保留，请手动核对`);
          return false;
        }
        return true;
      },
      attempted(scope) {
        const state = states[scope];
        state.attempts++;
        state.nextAt = Date.now() + (state.attempts === 1 ? 2 : 5) * 60000;
        save();
        log.add('recovery-attempt', '核对原结果，失败后延长等待', { scope, attempt: state.attempts, nextAt: state.nextAt });
      },
      nextAt: scope => states[scope]?.nextAt || 0,
      clear(scope) {
        if (scope ? !states[scope] : !Object.keys(states).length) return;
        if (scope) delete states[scope]; else states = {};
        save();
      },
    };
  }

(() => {
  'use strict';
  if (window.top !== window.self || document.getElementById('ark-auto-encounter')) return;

  // 依据 2026-10-10 网站 v1.29.1 的前端结构；不调用游戏接口。
  const PREF = 'arkengine:auto-encounter:enabled:v1';
  const LOCK = 'arkengine:auto-encounter:tab:v1';
  const RETRY_MS = 30000;
  const ENCOUNTER_ACTION = 'arkengine:auto-encounter:action:v1';
  let encounterAction = loadState(sessionStorage, ENCOUNTER_ACTION, null, 'cultivate', value =>
    timedState(value) && ['seek', 'choose'].includes(value.kind) && typeof value.signature === 'string');
  function saveEncounterAction(value) {
    sessionStorage.setItem(ENCOUNTER_ACTION, JSON.stringify(value));
    encounterAction = value;
  }
  // 每次点击前单独随机等待；游戏冷却仍完全由网页按钮决定。
  const CLICK_DELAY_MIN_MS = 2000;
  const CLICK_DELAY_MAX_MS = 5000;
  const RECOVERY_PREFIX = 'cultivation:operation:';
  const inDungeon = () => /^\/cultivate\/dungeon\/?$/.test(location.pathname);
  const inFog = () => /^\/cultivate\/fog\/?$/.test(location.pathname);
  const onPage = () => /^\/cultivate(?:\/(?:dungeon|fog))?\/?$/.test(location.pathname);
  const FOG_PREF = 'arkengine:auto-fog:enabled:v1';
  const FOG_STATE = 'arkengine:auto-fog:state:v1';
  const FOG_JOURNAL = 'arkengine:auto-fog:pending:v1';
  let fogEnabled = true;
  let fog = { draining: false, nextAt: 0 };
  let fogPlan = null;
  let openedFogDialog = false;
  let fogDialog = null;
  let fogLeaving = false;
  let fogResultObserved = false;
  let fogPageAt = 0;
  try {
    fogEnabled = localStorage.getItem(FOG_PREF) !== 'false';
    fog = loadState(localStorage, FOG_STATE, fog, 'fog', v => objectState(v) && Number.isFinite(v.nextAt));
    fogPlan = loadState(sessionStorage, FOG_JOURNAL, null, 'fog', v => planState(v) && objectState(v.settings) &&
      ['east', 'south', 'explore'].includes(v.settings.route) && ['guard-heavy', 'strike'].includes(v.settings.strategy) &&
      Number.isInteger(v.settings.retreatHp) && v.settings.retreatHp >= 0 && v.settings.retreatHp <= 90);
    if (stateFault('fog')) fogEnabled = false;
  } catch { fogEnabled = false; }
  const DUNGEON_PREF = 'arkengine:auto-dungeon:enabled:v1';
  const DUNGEON_STATE = 'arkengine:auto-dungeon:state:v1';
  const DUNGEON_JOURNAL = 'arkengine:auto-dungeon:pending:v1';
  const DUNGEON_NAME = '坠星古墓';
  // 秘境次数按北京时间 04:00 划日；收益日志仍按北京时间自然日记账。
  const dungeonDay = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  let dungeonEnabled = true;
  let dungeon = { nextAt: 0, exhaustedDay: '', run: null };
  let dungeonPlan = null;
  try {
    dungeonEnabled = localStorage.getItem(DUNGEON_PREF) !== 'false';
    dungeon = loadState(localStorage, DUNGEON_STATE, dungeon, 'dungeon', v => objectState(v) && Number.isFinite(v.nextAt));
    dungeonPlan = loadState(sessionStorage, DUNGEON_JOURNAL, null, 'dungeon', v => planState(v) &&
      (v.phase === 'opening' ? typeof v.description === 'string' : v.action === 'enter' ||
        v.action === 'choose' && Number.isInteger(v.step) && v.step >= 1 && v.step <= 8));
    if (stateFault('dungeon')) dungeonEnabled = false;
    // 旧标记采用零点划日，不能直接当作新的次数周期；只重新核对额度。
    if (!stateFault('dungeon') && dungeon.quotaResetHour !== 4) {
      dungeon = { ...dungeon, exhaustedDay: '', quotaResetHour: 4 };
      localStorage.setItem(DUNGEON_STATE, JSON.stringify(dungeon));
    }
  } catch { dungeonEnabled = false; }
  let dungeonPageDay = '';
  let openedDungeonDialog = false;
  let returningFromDungeon = false;
  let dungeonProgress = null;
  let dungeonEntryReview = null;
  let enabled = true;
  try { enabled = localStorage.getItem(PREF) !== 'false'; } catch { /* 使用内存设置 */ }
  let active = false;
  let acquiring = false;
  let releaseLock = null;
  let lastAction = null;
  let nextActionAt = 0;
  let pendingClick = null;
  let clickConsidered = false;
  let scheduled = false;
  let statusText = '';
  const log = createLog('cultivate');
  const handleNotice = createNoticeHandler(log, message => say(message), (button, id, message, before) =>
    recordClick(button, 'notice:close', id, message, before), usable);
  const recoveryBudget = createRecovery('cultivate', log, say);
  const pageWait = createPageWait('cultivate', log);
  const locator = createLocator();
  accountListeners.push(reason => setEnabled(false, reason));

  const host = document.createElement('aside');
  host.id = 'ark-auto-encounter';
  host.hidden = !onPage();
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; right: 14px; bottom: 18px;
        z-index: 2147483646; font: 13px/1.6 system-ui, sans-serif; color: #e6edf9; }
      :host([hidden]) { display: none; }
      .box { box-sizing: border-box; width: 280px; max-width: calc(100vw - 28px); max-height: 80vh; overflow-y: auto;
        padding: 12px 14px; background: #1b2033; border: 1px solid #616e9c;
        border-radius: 6px; box-shadow: 0 4px 18px #0005; }
      strong { font-size: 14px; } p { margin: 6px 0; overflow-wrap: anywhere; }
      .hint { color: #acbde1; font-size: 12px; }
      button { min-height: 32px; padding: 4px 14px; cursor: pointer;
        color: #102625; background: #62cebd; border: 0; border-radius: 3px; }
      button:focus-visible { outline: 2px solid white; outline-offset: 3px; }
      a { color: #acbde1; }
    </style>
    <div class="box">
      <strong>自动奇遇、秘境与迷雾</strong>
      <p id="status" role="status" aria-live="polite"></p>
      <p class="hint">最高钻石优先；无钻石时选最高修为。</p>
      <p id="last" class="hint">等待下一次奇遇</p>
      <button type="button" id="toggle"></button>
      <p id="dungeon-status" class="hint"></p>
      <button type="button" id="dungeon-toggle"></button>
      <p id="fog-status" class="hint"></p>
      <button type="button" id="fog-toggle"></button>
      <p class="hint"><a href="/activities/expedition" target="_blank" rel="noopener">打开远征挂机页</a></p>
    </div>`;
  document.body.append(host);
  const status = shadow.getElementById('status');
  const last = shadow.getElementById('last');
  const toggle = shadow.getElementById('toggle');
  const dungeonStatus = shadow.getElementById('dungeon-status');
  const dungeonToggle = shadow.getElementById('dungeon-toggle');
  const fogStatus = shadow.getElementById('fog-status');
  const fogToggle = shadow.getElementById('fog-toggle');
  log.mount(shadow);
  mountPanelControls(shadow,'cultivate');
  fogToggle.addEventListener('click', () => {
    if (stateFault('fog')) { say(stateFault('fog')); return; }
    fogEnabled = !fogEnabled;
    localStorage.setItem(FOG_PREF, String(fogEnabled));
    if (fogEnabled) {
      saveFog({ ...fog, nextAt: 0, deferrals: 0, stalls: 0 });
      recoveryBudget.clear('fog');
    }
    cancelPendingClick(); schedule();
  });
  function updateFogHint() {
    const hint = stateFault('fog') || (!fogEnabled ? '迷雾已暂停' : dungeonPlan ? '迷雾：等待秘境原操作确认' :
      dungeon.run ? '迷雾：等待本轮秘境结束' : fog.nextAt > Date.now() ?
      `迷雾：约 ${Math.ceil((fog.nextAt - Date.now()) / 60000)} 分钟后再核对` :
      fog.draining || fogPlan ? '迷雾：本轮探索到灵力不足 20' : '迷雾：主殿灵力达到 200 后进入');
    if (fogStatus.textContent !== hint) fogStatus.textContent = hint;
    fogToggle.textContent = fogEnabled ? '暂停迷雾' : '开启迷雾';
  }
  function updateDungeonHint() {
    const hint = stateFault('dungeon') || (!dungeonEnabled ? '秘境已暂停' : dungeon.run ? '秘境：本轮探索尚未结束' :
      dungeon.exhaustedDay === dungeonDay() ? '秘境：次数已用完，北京时间 4 点后再检查' :
      dungeon.nextAt > Date.now() ? `秘境：约 ${Math.ceil((dungeon.nextAt - Date.now()) / 60000)} 分钟后检查` :
      '秘境：准备探索坠星古墓');
    if (dungeonStatus.textContent !== hint) dungeonStatus.textContent = hint;
    dungeonToggle.textContent = dungeonEnabled ? '暂停秘境' : '开启秘境';
  }
  dungeonToggle.addEventListener('click', () => {
    if (stateFault('dungeon')) { say(stateFault('dungeon')); return; }
    dungeonEntryReview = null;
    dungeonEnabled = !dungeonEnabled;
    localStorage.setItem(DUNGEON_PREF, String(dungeonEnabled));
    if (dungeonEnabled) {
      saveDungeon({ ...dungeon, nextAt: dungeon.deferrals ? 0 : dungeon.nextAt, deferrals: 0, stalls: 0 });
      if (dungeonPlan?.action === 'enter' && dungeonPlan.entryReviewAttempted) {
        saveDungeonPlan({ ...dungeonPlan, entryReviewAttempted: false });
      }
      recoveryBudget.clear('dungeon');
    }
    cancelPendingClick();
    schedule();
  });

  function say(text) {
    if (text === statusText) return;
    statusText = text;
    status.textContent = text;
  }

  function setEnabled(value, reason = '') {
    if (value && stateFault('cultivate')) { say(stateFault('cultivate')); return; }
    enabled = value;
    try { localStorage.setItem(PREF, String(value)); } catch { /* 不阻断暂停 */ }
    toggle.textContent = value ? '暂停修仙自动操作' : '开始修仙自动操作';
    if (!value) {
      if (active) log.stop(reason || '人工暂停');
      cancelPendingClick();
      releaseLock?.();
      say(reason || '已暂停');
    }
    schedule();
  }
  toggle.addEventListener('click', () => {
    if (stateFault('cultivate')) { say(stateFault('cultivate')); return; }
    if (!enabled) { clearAccountStop(); recoveryBudget.clear(); pageWait.clear(); }
    setEnabled(!enabled);
  });
  toggle.textContent = enabled ? '暂停修仙自动操作' : '开始修仙自动操作';

  const textOf = el => (el?.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  function visible(el) {
    return Boolean(el?.isConnected && !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
      el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }
  function usable(el) {
    return visible(el) && !el.matches(':disabled, [aria-disabled="true"]');
  }
  function findButton(label) {
    return locator.pick([...document.querySelectorAll('button')].filter(el => textOf(el) === label && visible(el)));
  }

  function amount(reward, label) {
    if (!reward.includes(label)) return 0;
    // 网站当前使用“修为 +12,345 · 钻石 +5”；同时接受小数和万/亿。
    const segment = reward.split(/[·|；;]/).map(s => s.trim()).filter(s => s.includes(label));
    if (segment.length !== 1) return null;
    const match = segment[0].match(new RegExp(`^${label}\\s*[:：]?\\s*([+-]?)\\s*((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)\\s*([万亿]?)$`));
    if (!match) return null;
    const value = Number(match[2].replaceAll(',', '')) *
      (match[3] === '亿' ? 1e8 : match[3] === '万' ? 1e4 : 1) * (match[1] === '-' ? -1 : 1);
    return Number.isFinite(value) ? value : null;
  }

  function choose(panel) {
    const buttons = [...panel.querySelectorAll('button')].filter(visible);
    if (buttons.length !== 2 && buttons.length !== 3) {
      return { error: '等待两个或三个奇遇选项' };
    }
    const options = buttons.map(button => {
      // 仅解析奖励行，避免把剧情、选项序号或页面顶部余额当成奖励。
      const reward = textOf(button.querySelector('span.block.text-caption'));
      return { button, reward, exp: amount(reward, '修为'), diamonds: amount(reward, '钻石') };
    });
    if (options.some(o => !o.reward || o.exp === null || o.diamonds === null)) {
      return { error: '奖励格式无法识别，请手动处理本次奇遇' };
    }
    const hasDiamonds = options.some(o => o.diamonds > 0);
    if (!hasDiamonds && !options.some(o => o.exp > 0)) {
      return { error: '本次没有钻石或修为奖励，请手动选择' };
    }
    options.sort((a, b) => hasDiamonds ? b.diamonds - a.diamonds || b.exp - a.exp : b.exp - a.exp);
    return { best: options[0], signature: textOf(panel) };
  }

  function pendingOperation() {
    // 网站原按钮会恢复任意修炼操作，因此必须核对其原请求确为 encounter。
    try {
      const records = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (!key?.startsWith(RECOVERY_PREFIX)) continue;
        const record = JSON.parse(sessionStorage.getItem(key));
        if (record) records.push(record);
      }
      if (records.length !== 1) return null;
      const record = records[0];
      return record.input?.action === 'encounter' && typeof record.idempotencyKey === 'string'
        ? record : null;
    } catch { return null; }
  }

  function cancelPendingClick() {
    if (pendingClick) clearTimeout(pendingClick.timer);
    pendingClick = null;
  }

  function recordClick(button, kind, signature, message, beforeClick, afterClick) {
    if (accountStopReason()) { setEnabled(false, accountStopReason()); return false; }
    if (!usable(button) || !enabled || !active || !onPage()) return false;
    clickConsidered = true;
    if (!pendingClick || pendingClick.kind !== kind || pendingClick.signature !== signature) {
      cancelPendingClick();
      const delay = CLICK_DELAY_MIN_MS + Math.floor(Math.random() *
        (CLICK_DELAY_MAX_MS - CLICK_DELAY_MIN_MS + 1));
      pendingClick = { kind, signature, dueAt: Date.now() + delay,
        // 计时器只唤醒检查，不保存旧按钮，也不直接点击。
        timer: setTimeout(schedule, delay) };
    }
    const remaining = pendingClick.dueAt - Date.now();
    if (remaining > 0) {
      const action = /^(dungeon|fog|notice):/.test(kind) ? message :
        kind === 'seek' ? '寻找奇遇' : kind === 'choose' ? '选择最高奖励' : '确认原奇遇结果';
      say(`随机等待 ${(Math.ceil(remaining / 100) / 10).toFixed(1)} 秒后${action}`);
      return false;
    }
    cancelPendingClick();
    if (kind === 'seek' || kind === 'choose') {
      if (encounterAction?.kind === kind && encounterAction.signature === signature) recoveryBudget.attempted('encounter');
      else recoveryBudget.clear('encounter');
      saveEncounterAction({ kind, signature, at: Date.now(), refreshed: false });
    }
    lastAction = { kind, signature, at: Date.now(), refreshed: false };
    nextActionAt = Date.now() + 1500;
    say(message);
    log.add('action', message, { kind });
    if (kind === 'choose') log.expect('encounter');
    if (kind === 'dungeon:choose') log.expect('dungeon');
    beforeClick?.();
    button.click();
    afterClick?.();
    return true;
  }

  function retryReady(kind, signature) {
    if (!encounterAction || encounterAction.kind !== kind || encounterAction.signature !== signature) return true;
    if (!recoveryBudget.ready('encounter', `${kind}:${signature}`, encounterAction.at,
      reason => setEnabled(false, reason), '奇遇结果')) return false;
    // 超时先通过页面已有刷新按钮同步状态，再决定是否重试原操作。
    if (!encounterAction.refreshed) {
      const refresh = locator.query('button[aria-label="刷新修炼状态"]');
      if (!usable(refresh)) { say('等待游戏允许刷新状态'); return false; }
      recoveryBudget.attempted('encounter');
      saveEncounterAction({ ...encounterAction, refreshed: true });
      nextActionAt = Date.now() + 1500;
      say('正在核对上次操作结果');
      log.add('action', '刷新并核对上次奇遇结果');
      refresh.click();
      return false;
    }
    return true;
  }

  function tick() {
    clickConsidered = false;
    pageWait.begin();
    try { checkPage(); } finally {
      // 暂停、切页、处理中、重新冷却或选项失效时撤销待执行点击。
      if (!clickConsidered) cancelPendingClick();
      if (enabled && active && onPage()) pageWait.finish();
    }
  }

  function checkPage() {
    syncDialogAnimations();
    observeDungeonEntryReview();
    updateDungeonHint();
    updateFogHint();
    if (host.hidden === onPage()) host.hidden = !onPage();
    if (accountStopReason()) {
      if (enabled) setEnabled(false, accountStopReason()); else say(accountStopReason());
      return;
    }
    if (stateFault('cultivate')) {
      if (enabled) setEnabled(false, stateFault('cultivate')); else say(stateFault('cultivate'));
      return;
    }
    if (inDungeon() && stateFault('dungeon')) { say(stateFault('dungeon')); return; }
    if (inFog() && stateFault('fog')) { say(stateFault('fog')); return; }
    if (!onPage() || !enabled) {
      releaseLock?.();
      if (!enabled && !statusText) say('已暂停');
      return;
    }
    if (!navigator.locks) {
      setEnabled(false, '浏览器不支持标签页互斥，请使用新版 Chrome / Edge / Firefox');
      return;
    }
    if (!active) { acquire(); return; }
    log.pulse(statusText, { pageRecovery: pageWait.snapshot() });
    const notices = [...document.querySelectorAll('[role="status"]')].filter(visible);
    const errors = [...document.querySelectorAll('[role="status"].text-destructive, [role="alert"].text-destructive, [role="status"].bg-destructive, [role="alert"].bg-destructive')]
      .filter(visible).map(textOf).join(' ');
    if (/(?:\b(?:401|403|429)\b|cyber_abuse|abuse_detected|user_disabled|未登录|登录.*(?:失效|过期)|账号已切换|封禁|禁用|访问被拒绝|权限不足|频率|频繁|限流|rate.?limit|unauthori[sz]ed|forbidden)/i.test(errors)) {
      pauseAccount('游戏提示登录、权限或限流异常');
      return;
    }
    if (inDungeon()) { checkDungeon(notices, errors); return; }
    if (inFog()) { checkFog(errors); return; }
    fogPageAt = 0;
    fogLeaving = false;
    dungeonPageDay = '';
    returningFromDungeon = false;
    dungeonProgress = null;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    if (dialogs.length) {
      handleNotice(dialogs, '请先处理当前弹窗'); return;
    }
    if (notices.some(el => /正在处理修炼操作|正在恢复原请求/.test(textOf(el)))) {
      say('游戏正在处理修炼操作，等待原结果');
      return;
    }
    if (Date.now() < nextActionAt) return;
    const refresh = locator.query('button[aria-label="刷新修炼状态"]');
    if (!refresh || !usable(refresh)) {
      pageWait.wait('等待修炼状态刷新完成', !encounterAction && !pendingOperation(), say,
        reason => setEnabled(false, reason), true);
      return;
    }

    const recovery = findButton('确认原修炼结果');
    if (recovery) {
      const operation = pendingOperation();
      if (!operation) { say('原操作不是可确认的寻访奇遇，请手动处理'); return; }
      if (!usable(recovery)) { say('等待原奇遇结果'); return; }
      if (lastAction && Date.now() - lastAction.at < RETRY_MS) {
        say('等待原奇遇请求完成，稍后确认结果');
        return;
      }
      if (!recoveryBudget.ready('encounter-original', operation.idempotencyKey, Date.now() - RETRY_MS,
        reason => setEnabled(false, reason), '原奇遇结果')) return;
      recordClick(recovery, 'recover', operation.idempotencyKey, '正在确认原奇遇结果', () => recoveryBudget.attempted('encounter-original'));
      return;
    }

    const panel = locator.query('[id="cultivation-encounter"]');
    if (visible(panel)) {
      const result = choose(panel);
      if (result.error) { say(result.error); return; }
      if (!usable(result.best.button)) { say('等待奇遇选项可以点击'); return; }
      if (!retryReady('choose', result.signature)) return;
      if (recordClick(result.best.button, 'choose', result.signature, `正在领取：${result.best.reward}`)) {
        last.textContent = `上次选择：${textOf(result.best.button)}`;
      }
      return;
    }

    const cooldown = [...document.querySelectorAll('button')].find(el =>
      visible(el) && /^奇遇冷却\s/.test(textOf(el)));
    if (cooldown) {
      // 先确认上一轮已结束，再切秘境/迷雾；否则同样的下一轮选项会被旧重试记录挡住。
      lastAction = null;
      if (encounterAction) saveEncounterAction(null);
      recoveryBudget.clear('encounter');
      recoveryBudget.clear('encounter-original');
    }
    if ((!fogEnabled || !fogPlan || fog.nextAt > Date.now()) && visitDungeon()) return;
    if (visitFog()) return;
    if (cooldown) {
      say(textOf(cooldown));
      return;
    }
    const seek = findButton('寻找奇遇');
    if (!seek) {
      pageWait.wait('等待修仙主殿加载', !encounterAction && !pendingOperation(), say,
        reason => setEnabled(false, reason), true); return;
    }
    if (!usable(seek)) { say('等待游戏允许寻访奇遇'); return; }
    if (!retryReady('seek', 'seek')) return;
    recordClick(seek, 'seek', 'seek', '正在寻找奇遇');
  }

  // 奇遇、秘境与迷雾共享队列和标签页锁，任何时刻只执行当前页面的一步操作。
  function saveFog(value) {
    const serialized = JSON.stringify(value);
    localStorage.setItem(FOG_STATE, serialized);
    if (localStorage.getItem(FOG_STATE) !== serialized) throw new Error('无法保存迷雾进度');
    fog = value;
  }
  function saveFogPlan(value) {
    const serialized = JSON.stringify(value);
    sessionStorage.setItem(FOG_JOURNAL, serialized);
    if (sessionStorage.getItem(FOG_JOURNAL) !== serialized) throw new Error('无法保存迷雾原操作');
    fogPlan = value;
  }
  function nativeFogRequests() {
    return Object.keys(sessionStorage).filter(key => /^fog:\d+$/.test(key))
      .map(key => ({ key, value: JSON.parse(sessionStorage.getItem(key)) })).filter(r => r.value);
  }
  function fogSettings() {
    const route = locator.query('select[aria-label="探索路线"]')?.value;
    const strategy = locator.query('select[aria-label="战斗策略"]')?.value;
    const rawHp = locator.query('input[aria-label="生命撤离线"]')?.value;
    const retreatHp = Number(rawHp);
    return ['east', 'south', 'explore'].includes(route) && ['guard-heavy', 'strike'].includes(strategy) &&
      rawHp !== undefined && rawHp !== '' && Number.isInteger(retreatHp) && retreatHp >= 0 && retreatHp <= 90
      ? { route, strategy, retreatHp } : null;
  }
  function bindFogRequest() {
    if (fogPlan?.phase !== 'submitted' || fogPlan.original) return;
    const records = nativeFogRequests();
    if (records.length !== 1) return;
    const { input, idempotencyKey } = records[0].value;
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || input?.action !== 'start' ||
        Object.keys(input).length !== 2 || !input.quick || Object.keys(input.quick).length !== 3 ||
        Object.keys(fogPlan.settings).some(key => input.quick[key] !== fogPlan.settings[key])) return;
    saveFogPlan({ ...fogPlan, original: records[0] });
    fogResultObserved = true;
  }
  function afterFogClick() {
    bindFogRequest();
    // 原网页先完成确认 Promise，再同步保存原请求，故紧随它的微任务绑定。
    queueMicrotask(() => {
      try { bindFogRequest(); } catch { setEnabled(false, '迷雾原操作保存失败，请手动核对结果'); }
    });
  }
  function returnFromFog() {
    const link = linkTo('/cultivate');
    if (!usable(link)) { say('等待返回修仙主殿入口'); return; }
    recordClick(link, 'fog:return', 'hall', '返回主殿继续奇遇', () => { fogResultObserved = false; });
  }
  function deferFog(reason, pause = false, stalled = false) {
    if (!fogLeaving) {
      const deferrals = Math.min((fog.deferrals || 0) + 1, 4);
      const stalls = (fog.stalls || 0) + Number(stalled);
      pause ||= stalls >= 3;
      const minutes = Math.min(30, 5 * 2 ** (deferrals - 1));
      saveFog({ ...fog, deferrals, stalls, nextAt: Date.now() + minutes * 60000 });
      if (pause) {
        fogEnabled = false;
        localStorage.setItem(FOG_PREF, 'false');
      }
      fogLeaving = true;
      last.textContent = `${reason}；${pause ? '迷雾已暂停，请手动核对' : `${minutes} 分钟后再核对迷雾`}`;
      log.add('fog-deferred', reason, { paused: pause, pending: Boolean(fogPlan), retryAt: fog.nextAt });
    }
    returnFromFog();
  }
  function visitFog() {
    if (!fogEnabled || fog.nextAt > Date.now() || dungeon.run || dungeonPlan) return false;
    const link = linkTo('/cultivate/fog');
    if (!usable(link)) return false;
    // 严格读取主殿的灵力行，避免误把顶部体力、门票或奖励数字作为灵力。
    const values = [...document.querySelectorAll('span')].filter(visible).map(textOf)
      .map(text => text.match(/^灵力\s+(\d+)\s*\/\s*(\d+)$/)).filter(Boolean);
    const spirit = values.length === 1 && Number(values[0][1]) <= Number(values[0][2]) ? Number(values[0][1]) : null;
    const shouldEnter = fogPlan || fog.draining || spirit !== null && spirit >= 200;
    if (Object.keys(sessionStorage).some(key => key.startsWith(RECOVERY_PREFIX) && sessionStorage.getItem(key) !== 'null')) return false;
    const cooldown = [...document.querySelectorAll('button')].some(el => visible(el) && /^奇遇冷却\s/.test(textOf(el)));
    if (!cooldown && lastAction && !/^(dungeon|fog):/.test(lastAction.kind) && Date.now() - lastAction.at < RETRY_MS) return false;
    if (!cooldown && !findButton('寻找奇遇')) return false;
    // 只利用正常奇遇操作或网页自身更新的灵力，不为迷雾定时刷新主殿。
    if (!shouldEnter) return false;
    recordClick(link, 'fog:visit', 'fog', '切换到迷雾', () => saveFog({ ...fog, draining: true }));
    return true;
  }
  function checkFog(errors) {
    fogPageAt ||= Date.now();
    if (Date.now() < nextActionAt) return;
    const records = nativeFogRequests();
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    if (dialogs.length) {
      const dialog = dialogs[0];
      const title = dialog.querySelector('h2, [data-slot="alert-dialog-title"]');
      const own = dialogs.length === 1 && !records.length && openedFogDialog && fogPlan?.phase === 'opening' &&
        (!fogDialog || fogDialog === dialog) && textOf(title) === '快速探索' && textOf(dialog).includes(fogPlan.description);
      if (!own) { handleNotice(dialogs, '请先手动处理当前弹窗'); return; }
      fogDialog = dialog;
      if (!fogEnabled) {
        const cancel = [...dialog.querySelectorAll('button')].find(b => textOf(b) === '取消');
        recordClick(cancel, 'fog:cancel', 'cancel', '取消尚未提交的迷雾探索', () => {
          saveFogPlan(null); openedFogDialog = false;
        });
        return;
      }
      if (JSON.stringify(fogSettings()) !== JSON.stringify(fogPlan.settings)) {
        say('迷雾预设已变化，请手动核对确认窗口'); return;
      }
      const confirm = [...dialog.querySelectorAll('button')].find(b => textOf(b) === '确认');
      recordClick(confirm, 'fog:confirm', fogPlan.description, '确认快速探索（消耗 20 灵力）', () => {
        saveFogPlan({ ...fogPlan, phase: 'submitted', at: Date.now(), startedAt: Date.now() });
        openedFogDialog = false; fogResultObserved = false;
      }, afterFogClick);
      return;
    }
    if (!fogEnabled || fogLeaving || fog.nextAt > Date.now()) { returnFromFog(); return; }
    const own = records.length === 1 && fogPlan?.original && JSON.stringify(records[0]) === JSON.stringify(fogPlan.original);
    if (records.length && !own) { deferFog('存在无法核对归属的迷雾原请求', true); return; }
    const refresh = findButton('刷新');
    if (fogPlan?.phase === 'submitted') {
      if (Date.now() - fogPlan.startedAt > 90000) {
        if (!fogPlan.deferred) {
          // 每次返回后仍保留同一原请求，但允许下一次核对获得独立的等待窗口。
          saveFogPlan({ ...fogPlan, deferred: true });
          deferFog('迷雾 90 秒未确认结果，保留原请求回主殿', false, true); return;
        }
        saveFogPlan({ ...fogPlan, startedAt: Date.now(), deferred: false });
      }
      if (own) {
        const recover = findButton('确认原探索结果');
        if (Date.now() - fogPlan.at >= RETRY_MS && usable(recover)) {
          if (!recoveryBudget.ready('fog', records[0].value.idempotencyKey, fogPlan.at,
            reason => deferFog(reason, true), '原迷雾结果')) return;
          recordClick(recover, 'fog:recover', records[0].value.idempotencyKey, '确认原探索结果', () => {
            recoveryBudget.attempted('fog');
            saveFogPlan({ ...fogPlan, at: Date.now() }); fogResultObserved = true;
          });
        } else say('等待原迷雾请求完成，不重复消耗灵力');
        return;
      }
      if (!usable(refresh)) { say('等待迷雾结果同步完成'); return; }
      if (errors) { deferFog(`迷雾提示：${errors}；本轮结果不能确认`, true); return; }
      const receipt = [...document.querySelectorAll('[role="status"]')].filter(visible).map(textOf)
        .find(text => /已到账:修为\s*\d+\s*·\s*法宝碎片\s*\d+$/.test(text));
      if (fogPlan.original && fogResultObserved && receipt &&
          (usable(findButton('进入并快速探索 · 20 灵力')) || fogSpirit()?.current < 20)) {
        const reward = receipt.match(/已到账:修为\s*(\d+)\s*·\s*法宝碎片\s*(\d+)$/);
        // 原请求已明确结束，才将对应回执计账；连续相同金额也是不同轮次。
        saveFogPlan(null); fogResultObserved = false;
        recoveryBudget.clear('fog');
        saveFog({ ...fog, deferrals: 0, stalls: 0 });
        log.add('fog-reward', receipt, { reward: { 修为: Number(reward[1]), 法宝碎片: Number(reward[2]) } }, true);
      } else { deferFog('迷雾结果无法可靠核对，请查看原探索结果', true); return; }
    }
    if (fogPlan?.phase === 'opening') {
      if (Date.now() - fogPlan.at < 10000) { say('等待快速探索确认窗口'); return; }
      saveFogPlan(null); openedFogDialog = false;
      deferFog('快速探索确认窗口未打开或已取消'); return;
    }
    if (errors) { deferFog(`迷雾提示：${errors}`); return; }
    if (!usable(refresh)) {
      if (Date.now() - fogPageAt > 90000) deferFog('迷雾页面超过 90 秒未能加载', false, true);
      else say('等待迷雾页面加载');
      return;
    }
    if (findButton('确认原探索结果') || findButton('按策略完成本局')) {
      deferFog('迷雾中有手动探索或其他原操作', true); return;
    }
    const spirit = fogSpirit();
    if (!spirit || spirit.cost !== 20) { deferFog('迷雾灵力或入场费用无法核对'); return; }
    if (spirit.current < 20 || !fog.draining && spirit.current < 200) {
      saveFog({ draining: false, nextAt: 0 });
      fogLeaving = true; returnFromFog(); return;
    }
    const quick = findButton('进入并快速探索 · 20 灵力');
    const settings = fogSettings();
    if (!usable(quick) || !settings) { deferFog('当前无法快速探索迷雾'); return; }
    const description = `消耗 20 灵力开始新局,按所选路线逐格探索。沿用当前战斗、补给和奖励规则;生命不高于 ${settings.retreatHp} 时撤离,仍可能在单次受击中失败。不会自动使用背包补品。`;
    recordClick(quick, 'fog:open', JSON.stringify(settings), '进入并快速探索迷雾', () => {
      saveFog({ ...fog, draining: true, nextAt: 0 });
      saveFogPlan({ phase: 'opening', settings, description, at: Date.now() });
      openedFogDialog = true;
      fogDialog = null;
    }, () => {
      // 记住实际打开的窗口；手动关闭后重开的同名窗口也不能代为确认。
      fogDialog = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].find(visible) || null;
    });
  }
  function fogSpirit() {
    const matches = [...document.querySelectorAll('p[aria-live="polite"]')].filter(visible).map(textOf)
      .map(text => text.match(/^当前灵力\s+(\d+)\/(\d+)\s*·\s*入场消耗\s+(\d+)\s+灵力$/)).filter(Boolean);
    if (matches.length !== 1 || Number(matches[0][1]) > Number(matches[0][2])) return null;
    return { current: Number(matches[0][1]), cost: Number(matches[0][3]) };
  }

  function saveDungeon(value) {
    const serialized = JSON.stringify(value);
    localStorage.setItem(DUNGEON_STATE, serialized);
    if (localStorage.getItem(DUNGEON_STATE) !== serialized) throw new Error('无法保存秘境进度');
    dungeon = value;
  }
  function saveDungeonPlan(value) {
    const serialized = JSON.stringify(value);
    sessionStorage.setItem(DUNGEON_JOURNAL, serialized);
    if (sessionStorage.getItem(DUNGEON_JOURNAL) !== serialized) throw new Error('无法保存秘境原操作');
    dungeonPlan = value;
    dungeonEntryReview = null;
  }
  function dungeonEntryIdleState() {
    if (!inDungeon() || dungeonPlan?.phase !== 'submitted' || dungeonPlan.action !== 'enter' ||
        (dungeon.run && dungeon.run.step !== 0)) return null;
    if (nativeDungeonRequests().length || findButton('确认上次秘境操作') ||
        [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(visible)) return null;
    const notices = [...document.querySelectorAll('[role="status"], [role="alert"]')].filter(visible);
    if (notices.some(n => n.matches('.text-destructive, .bg-destructive') ||
        /正在处理秘境操作|正在读取原请求/.test(textOf(n)))) return null;
    if ([...document.querySelectorAll('section p')].filter(visible).some(p =>
        /^探索中\s*·|^第\s*\d+\s*\/\s*\d+\s*节/.test(textOf(p))) || findButton('撤退并保留已到账收获')) return null;
    const refresh = locator.query('button[aria-label="刷新秘境状态"]');
    const card = [...document.querySelectorAll('h2')].find(h => visible(h) && textOf(h) === DUNGEON_NAME)?.closest('.game-card');
    const entry = card && [...card.querySelectorAll('button')].find(b => visible(b) &&
      /^(进入秘境|今日次数已用完|秘境冷却中)$/.test(textOf(b)));
    const quota = dungeonQuota();
    return usable(refresh) && entry && quota ? { refresh, quota } : null;
  }
  function freshDungeonEntryReview() {
    return Boolean(dungeonEntryReview?.completedAt && Date.now() - dungeonEntryReview.completedAt < RETRY_MS &&
      dungeonEntryReview.plan === JSON.stringify(dungeonPlan));
  }
  function observeDungeonEntryReview() {
    const review = dungeonEntryReview;
    if (!review) return;
    if (!inDungeon() || review.plan !== JSON.stringify(dungeonPlan)) { dungeonEntryReview = null; return; }
    const refresh = locator.query('button[aria-label="刷新秘境状态"]');
    if (review.completedAt) {
      if (!dungeonEntryIdleState()) dungeonEntryReview = null;
      return;
    }
    if (visible(refresh) && refresh.disabled) review.loading = true;
    else if (review.loading && dungeonEntryIdleState()) {
      review.completedAt = Date.now();
    }
  }
  function nativeDungeonRequests() {
    const records = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith('dungeon:')) continue;
      const value = JSON.parse(sessionStorage.getItem(key));
      if (value) records.push({ key, value });
    }
    return records;
  }
  function bindDungeonRequest() {
    const records = nativeDungeonRequests();
    if (records.length !== 1 || dungeonPlan?.phase !== 'submitted' || dungeonPlan.original) return;
    const { input, idempotencyKey } = records[0].value;
    if (typeof idempotencyKey !== 'string' || input?.action !== dungeonPlan.action) return;
    if (input.action === 'choose' && (input.nodeIndex !== dungeonPlan.step - 1 ||
        !input.runId || !input.choiceKey)) return;
    saveDungeonPlan({ ...dungeonPlan, original: records[0] });
  }
  function afterDungeonClick() {
    bindDungeonRequest();
    // 网站的入场确认先 resolve Promise，再建立原请求；在它的微任务之后保存。
    queueMicrotask(() => {
      try { bindDungeonRequest(); } catch { setEnabled(false, '秘境原操作保存失败，请手动核对结果'); }
    });
  }
  function linkTo(path) {
    return [...document.querySelectorAll('a[href]')].find(link => {
      const url = new URL(link.href, location.href);
      return url.origin === location.origin && url.pathname.replace(/\/$/, '') === path &&
        !link.target && visible(link);
    });
  }
  function visitDungeon() {
    if (!dungeonEnabled || dungeon.nextAt > Date.now() ||
        (!dungeon.run && dungeon.exhaustedDay === dungeonDay())) return false;
    const link = linkTo('/cultivate/dungeon');
    if (!usable(link)) return false;
    // 等待正在领取的奇遇落定，不在两次修炼请求之间切走。
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(RECOVERY_PREFIX) && sessionStorage.getItem(key) !== 'null') {
        say('先等待原修炼请求结束，再进入秘境'); return true;
      }
    }
    const cooldown = [...document.querySelectorAll('button')].some(el => visible(el) && /^奇遇冷却\s/.test(textOf(el)));
    if (!cooldown && lastAction && !/^(dungeon|fog):/.test(lastAction.kind) && Date.now() - lastAction.at < RETRY_MS) {
      say('先等待本次奇遇结果，再进入秘境'); return true;
    }
    if (!cooldown && !findButton('寻找奇遇')) return false;
    recordClick(link, 'dungeon:visit', 'dungeon', '切换到秘境');
    return true;
  }
  function returnToHall() {
    const link = linkTo('/cultivate');
    if (!usable(link)) { say('等待返回修仙主殿入口'); return; }
    recordClick(link, 'dungeon:return', 'hall', '返回主殿继续奇遇');
  }
  function deferDungeon(reason, delay = null, stalled = false, pause = false) {
    // 返回主殿不会撤退；保留 run 和原请求，等待返回的几秒内不反复延长预约。
    if (!returningFromDungeon) {
      const deferrals = Math.min((dungeon.deferrals || 0) + 1, 4);
      const stalls = (dungeon.stalls || 0) + Number(stalled);
      pause ||= stalls >= 3;
      delay ??= Math.min(30, 5 * 2 ** (deferrals - 1)) * 60000;
      saveDungeon({ ...dungeon, deferrals, stalls, nextAt: Date.now() + delay });
      if (pause) { dungeonEnabled = false; localStorage.setItem(DUNGEON_PREF, 'false'); }
      returningFromDungeon = true;
      last.textContent = `${reason}；${pause ? '秘境已暂停，请手动核对' : `${Math.ceil(delay / 60000)} 分钟后再检查`}`;
      log.add('dungeon-deferred', reason, { paused: pause, retryAt: dungeon.nextAt, pending: Boolean(dungeonPlan),
        action: dungeonPlan?.action || '', phase: dungeonPlan?.phase || '', quota: dungeonQuota(),
        error: dungeonPlan?.lastError || '' });
    }
    returnToHall();
  }
  function recentDungeonResult() {
    return locator.pick([...document.querySelectorAll('section')].filter(section =>
      [...section.querySelectorAll('h2')].some(h => textOf(h) === `最近一次探索 · ${DUNGEON_NAME}`)));
  }
  function dungeonChoices(section) {
    const buttons = [...section.querySelectorAll('button')].filter(usable);
    if (!buttons.length) return { error: '等待秘境选项可以点击' };
    const options = buttons.map(button => {
      // 只读外层 span 的直接文本，排除下层“补给/伤势/条件”等代价说明。
      const span = button.querySelector('span');
      const label = [...(span?.childNodes || [])].filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent).join('').normalize('NFKC');
      const reward = label.includes('基准:') ? label.split('基准:').slice(1).join('基准:').trim() : '';
      return { button, reward, exp: amount(reward, '修为'), diamonds: amount(reward, '钻石') };
    });
    if (options.some(o => !o.reward || o.exp === null || o.diamonds === null)) {
      return { error: '秘境奖励无法识别，请手动处理本节' };
    }
    const hasDiamonds = options.some(o => o.diamonds > 0);
    if (!hasDiamonds && !options.some(o => o.exp > 0)) return { error: '本节没有钻石或修为，请手动选择' };
    options.sort((a, b) => hasDiamonds ? b.diamonds - a.diamonds || b.exp - a.exp : b.exp - a.exp);
    return { best: options[0] };
  }
  function dungeonQuota() {
    const quotaText = locator.all(document.querySelectorAll('[aria-live="polite"]')).map(textOf)
      .find(text => /^今日剩余\s*\d+\s*\/\s*\d+\s*次/.test(text));
    const quota = quotaText?.match(/^今日剩余\s*(\d+)\s*\/\s*(\d+)\s*次/);
    return quota && Number(quota[1]) <= Number(quota[2]) ? { remaining: +quota[1], limit: +quota[2] } : null;
  }
  function waitDungeonResult(refresh, errors) {
    const error = (errors || '').slice(0, 300);
    if (error && error !== dungeonPlan.lastError) {
      saveDungeonPlan({ ...dungeonPlan, lastError: error });
      log.add('dungeon-result-pending', '原秘境结果尚未确认', { action: dungeonPlan.action, error, quota: dungeonQuota() });
    }
    if (Date.now() - dungeonPlan.at < RETRY_MS) { say('等待原秘境结果，不重复入场或选择'); return; }
    const entry = dungeonPlan.phase === 'submitted' && dungeonPlan.action === 'enter' && (!dungeon.run || dungeon.run.step === 0);
    if ((!dungeonPlan.refreshed || (entry && !dungeonPlan.entryReviewAttempted)) && usable(refresh)) {
      recordClick(refresh, 'dungeon:refresh', 'original', '刷新并核对原秘境结果', () => {
        saveDungeonPlan({ ...dungeonPlan, refreshed: true, at: Date.now(),
          ...(entry ? { entryAt: dungeonPlan.entryAt ?? dungeonPlan.at, entryReviewAttempted: true } : {}) });
        if (entry) dungeonEntryReview = { plan: JSON.stringify(dungeonPlan), loading: false, completedAt: 0 };
      }, observeDungeonEntryReview);
      return;
    }
    say('原秘境结果尚未确认，请手动核对；不会重新购买门票');
  }
  function checkDungeon(notices, errors) {
    if (!dungeonEnabled) {
      if (returningFromDungeon) returnToHall(); else say('秘境已暂停，可手动返回主殿继续奇遇');
      return;
    }
    if (Date.now() < nextActionAt) return;
    const records = nativeDungeonRequests();
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    const own = records.length === 1 && dungeonPlan?.original &&
      JSON.stringify(records[0]) === JSON.stringify(dungeonPlan.original);
    // 不越过手动弹窗或其他原请求。只有本轮可核对的进度才允许让出页面。
    if (!dialogs.length && (!records.length || own) && (dungeon.run || dungeonPlan?.phase === 'submitted')) {
      if (returningFromDungeon || dungeon.nextAt > Date.now()) { returnToHall(); return; }
      const progress = [...document.querySelectorAll('section p')].map(textOf).find(s => /^第\s*\d+\/8\s*节/.test(s)) || '';
      const signature = `${progress}:${dungeonPlan?.action || ''}:${dungeonPlan?.step || 0}:${records.length}`;
      if (!dungeonProgress || dungeonProgress.signature !== signature) dungeonProgress = { signature, at: Date.now() };
      if (Date.now() - dungeonProgress.at > 90000) {
        deferDungeon('秘境超过 90 秒没有进展，保留原操作回主殿', null, true); return;
      }
    }
    const busy = notices.some(n => /正在处理秘境操作|正在读取原请求/.test(textOf(n)));
    if (busy) { say('游戏正在处理秘境操作，等待原结果'); return; }
    if (dialogs.length) {
      const dialog = dialogs[0];
      if (records.length || dialogs.length !== 1 || !openedDungeonDialog || dungeonPlan?.phase !== 'opening' ||
          !textOf(dialog).includes(dungeonPlan.description)) {
        handleNotice(dialogs, '请先手动处理当前弹窗'); return;
      }
      const confirm = [...dialog.querySelectorAll('button')].find(b => textOf(b) === '确认');
      if (!usable(confirm)) { say('等待秘境入场确认按钮'); return; }
      recordClick(confirm, 'dungeon:confirm', dungeonPlan.description, `确认进入${DUNGEON_NAME}`, () => {
        saveDungeonPlan({ ...dungeonPlan, phase: 'submitted', action: 'enter', at: Date.now() });
        openedDungeonDialog = false;
      }, afterDungeonClick);
      return;
    }
    if (records.length) {
      if (!own) { say('存在其他秘境原请求，请先手动确认'); return; }
      const recovery = findButton('确认上次秘境操作');
      if (Date.now() - dungeonPlan.at < RETRY_MS || !usable(recovery)) {
        say('等待原秘境请求完成，稍后确认结果'); return;
      }
      if (!recoveryBudget.ready('dungeon', records[0].value.idempotencyKey, dungeonPlan.at,
        reason => deferDungeon(reason, null, false, true), '原秘境结果')) return;
      recordClick(recovery, 'dungeon:recover', records[0].value.idempotencyKey, '确认上次秘境操作', () => {
        recoveryBudget.attempted('dungeon');
        saveDungeonPlan({ ...dungeonPlan, at: Date.now() });
      });
      return;
    }
    if (findButton('确认上次秘境操作')) { say('秘境原请求记录无法核对，请手动处理'); return; }
    const refresh = locator.query('button[aria-label="刷新秘境状态"]');
    if (!usable(refresh)) {
      pageWait.wait('等待秘境状态加载完成', !dungeonPlan && !records.length, say,
        reason => deferDungeon(reason, null, false, true)); return;
    }
    const section = locator.pick([...document.querySelectorAll('section')].filter(s =>
      [...s.querySelectorAll('p')].some(p => /^探索中 · /.test(textOf(p)))));
    if (section) {
      const name = [...section.querySelectorAll('p')].find(p => /^探索中 · /.test(textOf(p)));
      if (textOf(name) !== `探索中 · ${DUNGEON_NAME}`) { say('当前不是坠星古墓，请手动完成或返回'); return; }
      const progress = textOf(section).match(/第\s*(\d+)\/(\d+)\s*节/);
      if (!progress || Number(progress[2]) !== 8) { say('秘境节点结构变化，请手动核对'); return; }
      const step = Number(progress[1]);
      if (step < 1 || step > 8) { say('秘境进度无法识别'); return; }
      if (dungeonPlan?.phase === 'submitted') {
        if (dungeonPlan.action === 'enter' || (dungeonPlan.action === 'choose' && step > dungeonPlan.step)) {
          saveDungeonPlan(null);
        } else { waitDungeonResult(refresh, errors); return; }
      }
      if (errors) { say(`秘境提示：${errors}，请手动核对`); return; }
      if (!dungeon.run || dungeon.run.step !== step) {
        recoveryBudget.clear('dungeon');
        saveDungeon({ ...dungeon, deferrals: 0, stalls: 0, run: { beforeResult: dungeon.run?.beforeResult ?? '', step } });
      }
      const choice = dungeonChoices(section);
      if (choice.error) { say(choice.error); return; }
      const signature = `${step}:${textOf(section)}`;
      recordClick(choice.best.button, 'dungeon:choose', signature, `选择第 ${step}/8 节：${choice.best.reward}`, () =>
        saveDungeonPlan({ phase: 'submitted', action: 'choose', step, at: Date.now() }), afterDungeonClick);
      return;
    }
    // 必须先看到本轮探索及新的完成结果；旧“最近一次探索”不能触发冷却。
    const recent = textOf(recentDungeonResult());
    if (dungeon.run?.step === 8 && (notices.some(n => /^秘境探索完成，本次累计/.test(textOf(n))) ||
        (recent && recent !== dungeon.run.beforeResult))) {
      const interval = (40 * 60000) + Math.floor(Math.random() * (10 * 60000 + 1));
      recoveryBudget.clear('dungeon');
      saveDungeon({ ...dungeon, deferrals: 0, stalls: 0, run: null, nextAt: Date.now() + interval });
      saveDungeonPlan(null);
      returningFromDungeon = true;
      log.add('dungeon-complete', '八节探索已完成，返回主殿', { nextAt: dungeon.nextAt });
      last.textContent = `秘境已完成；${Math.round(interval / 60000)} 分钟后再检查`;
    }
    if (dungeonPlan) {
      if (dungeonPlan.phase === 'opening') {
        if (Date.now() - dungeonPlan.at < 10000) { say('等待秘境入场窗口'); return; }
        saveDungeonPlan(null);
        openedDungeonDialog = false;
        saveDungeon({ ...dungeon, run: null, nextAt: Date.now() + 60000 });
        returningFromDungeon = true;
      } else {
        const idle = freshDungeonEntryReview() && dungeonEntryIdleState();
        if (idle) {
          // 刷新确认当前已无探索及原请求，只归档失效的本地意图；历史扣费与奖励仍未知。
          // 若入场刚发生，至少保留从旧尝试算起的 50 分钟间隔，不连续重新买票。
          const nextAt = Math.max(dungeon.nextAt || 0, (dungeonPlan.entryAt ?? dungeonPlan.at) + 50 * 60000);
          saveDungeon({ ...dungeon, run: null, deferrals: 0, stalls: 0, nextAt,
            exhaustedDay: idle.quota.remaining === 0 ? dungeonDay() : '',
            lastReconciledEntry: { at: Date.now(), plan: dungeonPlan, run: dungeon.run, quota: idle.quota } });
          saveDungeonPlan(null);
          recoveryBudget.clear('dungeon');
          log.add('dungeon-entry-reconciled', '刷新确认当前无进行中秘境，已归档旧入场记录',
            { outcome: 'unknown', quota: idle.quota, nextAt });
          last.textContent = '旧入场记录已归档，按网页当前状态继续调度';
          returningFromDungeon = true;
          returnToHall(); return;
        }
        // 网站明确拒绝入场并已清除原请求时，可结束失败的入场意图。
        // 单有“剩余 0”或网络错误不能证明失败，仍保留记录，不能再买门票。
        if (dungeonPlan.action === 'enter' && (!dungeon.run || dungeon.run.step === 0) && dungeonQuota()?.remaining === 0 &&
            /(?:今日|每日|当天).*(?:次数.*(?:用完|耗尽|不足)|(?:已达|达到).*上限)/.test(errors)) {
          log.add('dungeon-entry-rejected', '网页明确提示次数耗尽，等待北京时间 4 点', { error: errors.slice(0, 300) });
          saveDungeonPlan(null);
          saveDungeon({ ...dungeon, run: null, exhaustedDay: dungeonDay(), deferrals: 0, stalls: 0 });
          returningFromDungeon = true;
          returnToHall(); return;
        }
        waitDungeonResult(refresh, errors); return;
      }
    }
    if (dungeon.run) { say('本轮秘境进度尚未确认，请刷新秘境状态核对'); return; }
    if (errors) { deferDungeon(`秘境提示：${errors}`); return; }
    if (dungeonPageDay && dungeonPageDay !== dungeonDay()) {
      recordClick(refresh, 'dungeon:day', dungeonDay(), '刷新今日秘境次数', () => { dungeonPageDay = dungeonDay(); });
      return;
    }
    dungeonPageDay ||= dungeonDay();
    const quota = dungeonQuota();
    if (!quota) {
      pageWait.wait('等待网页提供今日秘境次数', !dungeonPlan, say,
        reason => deferDungeon(reason, null, false, true)); return;
    }
    if (quota.remaining === 0) {
      if (dungeon.exhaustedDay !== dungeonDay()) saveDungeon({ ...dungeon, exhaustedDay: dungeonDay() });
      returningFromDungeon = true;
    }
    if (returningFromDungeon || dungeon.nextAt > Date.now() || dungeon.exhaustedDay === dungeonDay()) {
      returnToHall(); return;
    }
    const heading = locator.pick([...document.querySelectorAll('h2')].filter(h => textOf(h) === DUNGEON_NAME));
    const card = heading?.closest('.game-card');
    if (!card) { deferDungeon('当前未找到坠星古墓入口'); return; }
    const cooldown = [...card.querySelectorAll('button')].find(b => textOf(b) === '秘境冷却中');
    if (cooldown) {
      // 网站 CountdownBadge 的 aria-label 为“秘境冷却 MM:SS / HH:MM:SS”。
      const badge = [...document.querySelectorAll('[aria-label^="秘境冷却 "]')].find(visible);
      const match = badge?.getAttribute('aria-label').match(/^秘境冷却\s+(\d+):(\d{2})(?::(\d{2}))?$/);
      let remaining = null;
      if (match && Number(match[2]) < 60 && (match[3] === undefined || Number(match[3]) < 60)) {
        remaining = match[3] === undefined ? (+match[1] * 60 + +match[2]) * 1000 :
          (+match[1] * 3600 + +match[2] * 60 + +match[3]) * 1000;
      }
      deferDungeon('秘境仍在冷却', Number.isSafeInteger(remaining) ? Math.max(30000, remaining + 2000) : null); return;
    }
    const enter = [...card.querySelectorAll('button')].find(b => textOf(b) === '进入秘境');
    const cost = textOf(card).match(/门票\s*(\d+)\s*钻\s*·\s*灵力\s*(\d+)/);
    if (!cost || !usable(enter)) { deferDungeon('坠星古墓暂不满足入场条件'); return; }
    const description = `进入${DUNGEON_NAME}将消耗 ${cost[1]} 钻石和 ${cost[2]} 灵力,是否继续?`;
    recordClick(enter, 'dungeon:enter', description, `进入${DUNGEON_NAME}`, () => {
      saveDungeon({ ...dungeon, run: { step: 0, beforeResult: recent } });
      saveDungeonPlan({ phase: 'opening', description, at: Date.now() });
      openedDungeonDialog = true;
    });
  }

  function acquire() {
    if (acquiring) return;
    acquiring = true;
    navigator.locks.request(LOCK, { ifAvailable: true }, async lock => {
      if (!lock || !enabled || !onPage()) {
        if (enabled && onPage()) say('另一游戏标签页正在自动修仙');
        return;
      }
      active = true;
      try {
        await new Promise(resolve => { releaseLock = resolve; schedule(); });
      } finally {
        cancelPendingClick();
        active = false;
        releaseLock = null;
      }
    }).catch(() => setEnabled(false, '无法取得标签页运行锁，请刷新页面后重试'))
      .finally(() => { acquiring = false; });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // Worker/DOM 事件已经唤醒脚本，不能再转到后台会被节流的 setTimeout。
    queueMicrotask(() => {
      scheduled = false;
      try { observeSessionPage(); tick(); } catch (error) {
        log.add('runtime-error', '修仙检查异常，已暂停并保留原记录', { name: error?.name || 'Error', stage: 'cultivate-check' });
        setEnabled(false, '脚本检查失败，已暂停；请刷新后重试');
      }
    });
  }

  log.observeLifecycle(() => onPage() ? { enabled, ownsLock: active, state: statusText,
    pageRecovery: pageWait.snapshot(),
    pendingEncounter: Boolean(encounterAction), pendingDungeon: Boolean(dungeonPlan), pendingFog: Boolean(fogPlan) } : null);
  subscribeWakeup(schedule, onPage, () => enabled, () => {
    try { observeDungeonEntryReview(); } catch { dungeonEntryReview = null; }
  });
  window.addEventListener('pagehide', () => { cancelPendingClick(); releaseLock?.(); });
  window.addEventListener('storage', event => {
    if (event.key === PREF) {
      enabled = event.newValue !== 'false';
      toggle.textContent = enabled ? '暂停修仙自动操作' : '开始修仙自动操作';
      if (!enabled) { cancelPendingClick(); releaseLock?.(); say('已暂停'); }
      schedule();
    }
    if (event.key === DUNGEON_STATE || event.key === DUNGEON_PREF) {
      try {
        dungeon = JSON.parse(localStorage.getItem(DUNGEON_STATE) || 'null') || { nextAt: 0, exhaustedDay: '', run: null };
        dungeonEnabled = localStorage.getItem(DUNGEON_PREF) !== 'false';
      } catch { dungeonEnabled = false; }
      schedule();
    }
    if (event.key === FOG_STATE || event.key === FOG_PREF) {
      try {
        fog = JSON.parse(localStorage.getItem(FOG_STATE) || 'null') || { draining: false, nextAt: 0 };
        fogEnabled = localStorage.getItem(FOG_PREF) !== 'false';
      } catch { fogEnabled = false; }
      schedule();
    }
  });
  if (!enabled) say('已暂停');
  schedule();
})();

// 远征与农场共用标签页、点击队列和锁；平时驻留远征，仅到农场预约时间才切页。
(() => {
  'use strict';
  if (window.top !== window.self || document.getElementById('ark-auto-expedition')) return;
  // 复用网页原生写入按钮；农场与避难所只读状态用于核对与预约。
  const PREF = 'arkengine:auto-expedition:enabled:v1';
  const JOURNAL = 'arkengine:auto-expedition:pending:v1';
  const LOCK = 'arkengine:auto-expedition:tab:v1';
  const TEAM_LIMIT = 6;
  const inFarm = () => /^\/farm\/?$/.test(location.pathname);
  const inShelter = () => /^\/shelter\/?$/.test(location.pathname);
  const inStock = () => /^\/stock\/?$/.test(location.pathname);
  const onPage = () => /^\/(?:activities\/expedition|farm|shelter|stock)\/?$/.test(location.pathname);
  const FARM_PREF = 'arkengine:auto-farm:enabled:v1';
  const FARM_CROP = 'arkengine:auto-farm:crop:v1';
  const FARM_STATE = 'arkengine:auto-farm:schedule:v1';
  const FARM_JOURNAL = 'arkengine:auto-farm:pending:v1';
  const STAMINA_SYNC = 'arkengine:auto-farm:stamina-sync:v1';
  const CROPS = ['小麦','胡萝卜','番茄','玉米','草莓','南瓜','蓝莓','葡萄','黄金苹果','西瓜','可可豆','星辉果'];
  let farmEnabled = true;
  let farmCrop = 'auto';
  let farmState = { nextAt: 0, expeditionAt: 0, note: '等待首次检查', selection: '' };
  let farmPlan = null;
  let staminaSync = loadState(sessionStorage, STAMINA_SYNC, null, 'farm', v => timedState(v) &&
    (v.reloadFrom === undefined || typeof v.reloadFrom === 'string'));
  try {
    farmEnabled = localStorage.getItem(FARM_PREF) !== 'false';
    farmCrop = localStorage.getItem(FARM_CROP) || 'auto';
    farmState = loadState(localStorage, FARM_STATE, farmState, 'farm', v => objectState(v) && Number.isFinite(v.nextAt));
    farmPlan = loadState(sessionStorage, FARM_JOURNAL, null, 'farm', v => timedState(v) &&
      ['plant', 'harvest'].includes(v.action) && Array.isArray(v.plots) && v.plots.every(p => Number.isInteger(p) && p > 0) &&
      (v.action === 'harvest' ? v.plots.length > 0 : typeof v.crop === 'string' && Number.isInteger(v.empty) && v.empty > 0));
    if (stateFault('farm')) farmEnabled = false;
  } catch { farmEnabled = false; }
  let ownSeedDialog = null;
  let openingSeedsAt = 0;
  let farmEntryAt = 0;
  let farmSignature = '';
  let farmChangedAt = 0;
  let farmMarket = null;
  let farmMarketLoading = false;
  let farmReadGeneration = 0;
  let farmReadController = null;
  let farmReadAttempts = 0;
  let farmReadNextAt = 0;
  function cancelFarmRead() {
    farmReadGeneration++;
    farmReadController?.abort();
    farmReadController = null;
    farmMarketLoading = false;
    farmMarket = null;
    farmReadAttempts = 0;
    farmReadNextAt = 0;
  }
  const textOf = el => (el?.textContent || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const beijingTime = () => {
    const time = new Date(Date.now() + 8 * 3600000);
    const hour = time.getUTCHours();
    return { day: time.toISOString().slice(0, 10), inWindow: hour >= 1 && hour < 2, canBurst: hour >= 1 };
  };
  let enabled = true;
  let plan = null;
  try {
    enabled = localStorage.getItem(PREF) !== 'false';
    plan = loadState(sessionStorage, JOURNAL, null, 'expedition', v => planState(v) && objectState(v.before) &&
      typeof v.route === 'string' && Number.isInteger(v.total) && v.total > 0);
  } catch { /* 存储不可用时，实际派遣前会停止 */ }
  let active = false;
  let acquiring = false;
  let releaseLock = null;
  let queued = null;
  let offered = false;
  let scheduled = false;
  let nextStepAt = 0;
  const CLAIM_JOURNAL = 'arkengine:auto-expedition:claim:v1';
  let pageFrozen = false;
  const claimPageId = crypto.randomUUID();
  const claimResultValid = v => objectState(v) && ['ok', 'network-error', 'aborted', 'http-error', 'login-redirect'].includes(v.outcome) &&
    (v.status === null || Number.isInteger(v.status) && v.status >= 100 && v.status <= 599);
  let claimWait = loadState(sessionStorage, CLAIM_JOURNAL, null, 'expedition', v =>
    timedState(v) && Number.isInteger(v.running) && v.running >= 0 &&
    (v.retries === undefined || Number.isInteger(v.retries) && v.retries >= 0 && v.retries <= 1) &&
    (v.ready === undefined || Number.isInteger(v.ready) && v.ready > 0 && v.ready <= v.running) &&
    (v.reloadFrom === undefined || typeof v.reloadFrom === 'string') &&
    (v.attemptId === undefined || typeof v.attemptId === 'string') &&
    (v.result === undefined || claimResultValid(v.result)));
  let claimStable = null;
  let legacyClaimLookup = null;
  function saveClaimWait(value) {
    const serialized = JSON.stringify(value);
    sessionStorage.setItem(CLAIM_JOURNAL, serialized);
    if (sessionStorage.getItem(CLAIM_JOURNAL) !== serialized) throw new Error('无法保存远征领取记录');
    claimWait = value;
  }
  const transientClaim = result => result && (['network-error', 'aborted'].includes(result.outcome) ||
    result.outcome === 'http-error' && result.status >= 500);
  function claimReason() {
    const result = claimWait?.result;
    if (!result) return '领取结果尚未确认';
    if (result.outcome === 'network-error') return '领取请求网络错误，到账结果待核对';
    if (result.outcome === 'aborted') return '领取请求中断或超时，到账结果待核对';
    if (result.outcome === 'http-error') return `领取请求返回 HTTP ${result.status}`;
    return '领取响应已返回，等待页面确认结果';
  }
  function submitClaim(button, q, ready, retry = false) {
    const attemptId = crypto.randomUUID();
    const now = Date.now();
    saveClaimWait(retry ? { ...claimWait, at: now, retries: 1, attemptId, result: undefined } :
      { running: q.running, ready, at: now, submittedAt: now, retries: 0, attemptId });
    claimStable = null;
    log.expect('expedition');
    if (retry) log.add('expedition-claim-retry', '刷新后待领队伍与额度一致，补领一次', { ready, retry: 1, limit: 1 });
    captureExpeditionClaim = { path: /^一键领取/.test(textOf(button)) ? '/api/activities/expedition-claim-all' : '/api/activities',
      result(result) {
        if (claimWait?.attemptId !== attemptId) return;
        try { saveClaimWait({ ...claimWait, result: { status: result.status, outcome: result.outcome } }); }
        catch { setEnabled(false, '无法保存领取响应，已暂停并保留原记录'); }
        schedule();
      } };
    try { button.click(); } finally { captureExpeditionClaim = null; }
  }
  function recoverLegacyClaimEvidence() {
    if (!claimWait || claimWait.attemptId || claimWait.result) return false;
    const submittedAt = claimWait.submittedAt ?? claimWait.at;
    if (legacyClaimLookup?.at === submittedAt) return legacyClaimLookup.pending && Date.now() - legacyClaimLookup.startedAt < 5000;
    legacyClaimLookup = { at: submittedAt, pending: true, startedAt: Date.now() };
    const lookup = legacyClaimLookup;
    // 旧版没有在领取记录中保存网络结果。只接受同页、同次点击对应的专用批量领取错误。
    const days = [...new Set([logDay(submittedAt), logDay(submittedAt + 60000)])];
    Promise.all(days.map(day => logStore.read('expedition', day, Infinity))).then(buckets => {
      const events = buckets.flatMap(bucket => bucket?.events || []);
      const clicks = events.filter(e => e.type === 'action' && e.data?.kind === 'claim' && Math.abs(e.at - submittedAt) <= 100);
      if (clicks.length !== 1 || !clicks[0].pageId) return;
      const results = events.filter(e => e.type === 'request-result' && e.pageId === clicks[0].pageId &&
        e.data?.path === '/api/activities/expedition-claim-all' &&
        e.data.startedAt >= submittedAt && e.data.startedAt <= submittedAt + 1000);
      if (results.length !== 1 || !transientClaim(results[0].data) || !claimResultValid(results[0].data) ||
          !claimWait || (claimWait.submittedAt ?? claimWait.at) !== submittedAt || claimWait.attemptId) return;
      saveClaimWait({ ...claimWait, result: { outcome: results[0].data.outcome, status: results[0].data.status },
        // 缺少新版刷新标记的旧记录仍须由本版重新刷新核对。
        reloaded: false, at: Date.now() });
      log.add('expedition-claim-evidence', '已从本地日志核对旧领取的网络错误，重新刷新确认待领状态');
    }).catch(() => { /* 证据不可用时沿用保留原记录并暂停的规则。 */ })
      .finally(() => { lookup.pending = false; schedule(); });
    return true;
  }
  let observedDay = beijingTime().day;
  const IDLE_JOURNAL = 'arkengine:auto-expedition:idle:v1';
  let idleWait = loadState(sessionStorage, IDLE_JOURNAL, null, 'expedition', v => timedState(v) &&
    ['loadDeadline', 'loadHeldAt'].every(key => v[key] === undefined || Number.isFinite(v[key]) && v[key] >= 0));
  let idleChecked = false;
  let idleBlocked = false;
  let idleSignature = '';
  let diagnostic = {};
  let quotaRead = {};
  const log = createLog('expedition');
  const handleNotice = createNoticeHandler(log, message => say(message), (button, id, message, before) =>
    offer(`notice:${id}`, message, () => { before(); button.click(); }), usable);
  const recoveryBudget = createRecovery('expedition', log, message => say(message));
  const farmWait = createPageWait('farm', log);
  const expeditionLoadWait = createPageWait('expedition', log);
  const NAV_JOURNAL = 'arkengine:auto-expedition:navigation:v1';
  const travelPaths = ['/farm', '/activities/expedition', '/shelter', '/stock'];
  let navigation = loadState(sessionStorage, NAV_JOURNAL, null, 'expedition', v => timedState(v) &&
    travelPaths.includes(v.from) && travelPaths.includes(v.to) && v.from !== v.to && typeof v.reloaded === 'boolean');
  const locator = createLocator();
  accountListeners.push(reason => setEnabled(false, reason));
  const BURST_DAY = 'arkengine:auto-expedition:burst-day:v1';
  const QUOTA_REFRESH = 'arkengine:auto-expedition:quota-refresh:v2';
  let expeditionObserved = false;
  function quotaCheckState() {
    const value = JSON.parse(localStorage.getItem(QUOTA_REFRESH) || 'null');
    return value?.day === beijingTime().day ? value : { day: beijingTime().day, count: 0, at: Date.now() };
  }
  function noteQuotaSync() {
    localStorage.setItem(QUOTA_REFRESH, JSON.stringify({ ...quotaCheckState(), at: Date.now() }));
  }

  const host = document.createElement('aside');
  host.id = 'ark-auto-expedition';
  host.hidden = !onPage();
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; right: 14px; bottom: 18px;
        z-index: 2147483646; font: 13px/1.6 system-ui, sans-serif; color: #e6edf9; }
      :host([hidden]) { display: none; }
      .box { box-sizing: border-box; width: 290px; max-width: calc(100vw - 28px); max-height: 75vh; overflow-y: auto;
        padding: 12px 14px; background: #1b2033; border: 1px solid #616e9c;
        border-radius: 6px; box-shadow: 0 4px 18px #0005; }
      p { margin: 6px 0; overflow-wrap: anywhere; }
      .hint, a { color: #acbde1; font-size: 12px; }
      button { min-height: 32px; padding: 4px 14px; cursor: pointer;
        color: #102625; background: #62cebd; border: 0; border-radius: 3px; }
      button:focus-visible { outline: 2px solid white; outline-offset: 3px; }
      select { box-sizing: border-box; width: 100%; min-height: 36px; margin-top: 4px;
        color: #e6edf9; background: #1b2033; border: 1px solid #616e9c; border-radius: 3px; }
      select:focus-visible { outline: 2px solid white; outline-offset: 2px; }
      .staff-option { display: block; margin-top: 6px; }
      #shelter-population { width: 64px; margin-left: 6px; }
    </style>
    <div class="box">
      <strong>自动远征、农场、避难所与股市</strong>
      <p id="status" role="status" aria-live="polite"></p>
      <p class="hint">常态：边境巡逻，最多 6 队。<br>突发：北京时间 01:00～02:00 优先；错过且额度完整未用时补派深渊。</p>
      <p class="hint">自动领取 · 完整行程 · 点击前随机等 2～5 秒</p>
      <button type="button" id="toggle"></button>
      <p class="hint">主开关同时控制远征、农场、避难所和股市。</p>
      <p class="hint" id="farm-status"></p>
      <label for="farm-crop">种植作物</label>
      <select id="farm-crop">
        <option value="auto">自动：当前收益最高的单一作物</option>
        ${CROPS.map(name => `<option value="${name}">${name}</option>`).join('')}
      </select>
      <p class="hint" id="farm-selection">每次种植前读取最新行情，每块扣除留种 1 份。</p>
      <button type="button" id="farm-toggle"></button>
      <button type="button" id="farm-check">检查农场</button>
      <p class="hint" id="shelter-status"></p>
      <button type="button" id="shelter-toggle"></button>
      <button type="button" id="shelter-check">检查避难所</button>
      <label class="staff-option"><input type="checkbox" id="shelter-explore-claim"> 自动领取已归来的探险</label>
      <p class="hint" id="shelter-explore-status">领取并释放归来的居民；出发、召回、救援和废土小队仍由你安排。</p>
      <label for="shelter-staff">避难所人员管理</label>
      <select id="shelter-staff">
        <option value="off">仅收取奖励，人员由我安排</option>
        <option value="production">自动生产：保障供应，优先废料</option>
        <option value="family">自动生产＋已有配对生育轮换</option>
        <option value="population">自动生产＋人口发展（安排新配对）</option>
      </select>
      <label class="staff-option">人口发展目标<input id="shelter-population" type="number" min="2" max="200" step="1" value="14"> 人</label>
      <p class="hint" id="shelter-population-status">人口发展模式才使用此目标；默认 14 人。</p>
      <label class="staff-option"><input type="checkbox" id="shelter-gear"> 自动穿戴闲置生产服装</label>
      <label class="staff-option"><input type="checkbox" id="shelter-optimize"> 优化满员生产房间</label>
      <p class="hint" id="shelter-staff-status"></p>
      <details><summary>避难所人员建议</summary><p class="hint" id="shelter-advice">首次检查后显示生产和生育建议。</p></details>
      <details><summary>避难所发展规划</summary><p class="hint" id="shelter-development" style="white-space:pre-line">检查避难所后比较建造、升级和扩容。建议不会自动花费资源。</p></details>
      <details><summary>避难所运行提醒</summary><p class="hint" id="shelter-operations" style="white-space:pre-line">检查后显示停产、供应、施工和废土返程情况。</p></details>
      <details id="stock-settings"><summary>模型股市</summary>
        <p class="hint" id="stock-status"></p>
        <label class="staff-option"><input type="checkbox" id="stock-trade"> 自动择股与管理脚本持仓</label>
        <label class="staff-option"><input type="checkbox" id="stock-predict"> 自动涨跌预测（可能亏损）</label>
        <label class="staff-option">股票24小时买入／持仓成本上限 <input id="stock-trade-limit" type="number" min="0" step="1" style="width:90px"></label>
        <label class="staff-option">预测24小时下注上限 <input id="stock-prediction-limit" type="number" min="0" step="1" style="width:90px"></label>
        <label class="staff-option">预测每注固定代币 <input id="stock-stake" type="number" min="0" step="1" style="width:90px"></label>
        <label class="staff-option">账号保留代币 <input id="stock-reserve" type="number" min="0" step="1" style="width:90px"></label>
        <p class="hint">默认关闭、额度为0。每5分钟检查，最多3只股票；净盈利8%、净亏损6%或趋势转弱时尝试卖出，须满足持有期。预测按近期趋势固定下注，每轮一次，不加倍追损。</p>
        <p class="hint">交易按市价成交，无最高成交价保证；预留10%报价余量仍可能超出预估。上限只统计脚本支出，卖出及预测返还不补回24小时额度。手动持仓和历史仓由你处理。</p>
        <button type="button" id="stock-save">保存股市设置</button>
        <button type="button" id="stock-check">检查股市</button>
      </details>
      <p class="hint"><a href="/cultivate" target="_blank" rel="noopener">打开奇遇挂机页</a></p>
    </div>`;
  document.body.append(host);
  const status = shadow.getElementById('status');
  const toggle = shadow.getElementById('toggle');
  const say = message => { if (status.textContent !== message) status.textContent = message; };
  const farmStatus = shadow.getElementById('farm-status');
  const farmSelect = shadow.getElementById('farm-crop');
  const farmToggle = shadow.getElementById('farm-toggle');
  log.mount(shadow);
  mountPanelControls(shadow,'expedition');
  // 只监听用户实际点击确认卖出，既不发售卖请求，也不替用户确认。暂停自动操作后仍可记账。
  document.addEventListener('click', event => {
    if (!inFarm()) return;
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    const dialog = button?.closest('[role="dialog"], [role="alertdialog"]');
    if (textOf(button) !== '确认卖出' || !usable(button) || !dialog ||
        ![...dialog.querySelectorAll('h2')].some(h => /^卖出(?:作物|\s)/.test(textOf(h)))) return;
    log.expect('farm-sale');
    schedule();
  }, true);
  farmSelect.value = farmCrop;
  if (!farmSelect.value) farmSelect.value = farmCrop = 'auto';
  farmSelect.addEventListener('change', () => {
    if (stateFault('farm')) { say(stateFault('farm')); return; }
    farmCrop = farmSelect.value;
    cancelFarmRead();
    localStorage.setItem(FARM_CROP, farmCrop);
    saveFarmState({ ...farmState, nextAt: 0, selection: '', note: '作物已更改，下次种植生效' });
    cancelQueued(); schedule();
  });
  farmToggle.addEventListener('click', () => {
    if (stateFault('farm')) { say(stateFault('farm')); return; }
    farmEnabled = !farmEnabled;
    cancelFarmRead();
    localStorage.setItem(FARM_PREF, String(farmEnabled));
    if (farmEnabled) {
      recoveryBudget.clear('farm-ready');
      farmWait.clear();
      clearStaminaSync();
    }
    if (navigation?.to === '/farm') clearNavigation();
    cancelQueued(); schedule();
  });
  shadow.getElementById('farm-check').addEventListener('click', () => {
    if (stateFault('farm')) { say(stateFault('farm')); return; }
    farmWait.clear();
    saveFarmState({ ...farmState, nextAt: 0, note: '等待检查农场' });
    schedule();
  });

  // 股市与远征共用运行锁；预算、持仓与原请求在同一条持久记录内原子保存。
  const STOCK_CONFIG = 'arkengine:auto-stock:config:v1';
  const STOCK_LEDGER = 'arkengine:auto-stock:ledger:v1';
  const stockDefault = {trade:false,predict:false,tradeLimit:0,predictionLimit:0,stake:0,reserve:0};
  const validStockConfig = v => objectState(v) && typeof v.trade==='boolean' && typeof v.predict==='boolean' &&
    ['tradeLimit','predictionLimit','stake','reserve'].every(k=>stockCore.whole(v[k]) && v[k]<=1e12);
  // 结算记录是历史清理的完成凭据，损坏字段不能被当作已经结算。
  const validStockLedger = v => objectState(v) && v.version===1 && (v.userId===null || stockCore.positive(v.userId)) &&
    stockCore.whole(v.nextAt) && typeof v.note==='string' && typeof v.hold==='boolean' && objectState(v.owned) &&
    (v.holdReason==null || typeof v.holdReason==='string') &&
    Object.values(v.owned).every(o=>objectState(o) && stockCore.whole(o.shares) && stockCore.whole(o.cost) &&
      typeof o.modelName==='string' && typeof o.manual==='boolean') && Array.isArray(v.entries) && v.entries.length<=2000 &&
    v.entries.every(e=>objectState(e) && typeof e.id==='string' && stockCore.whole(e.at) && stockCore.whole(e.debit) &&
      (e.confirmedAt===undefined || stockCore.whole(e.confirmedAt)&&e.confirmedAt>=e.at) &&
      ['buy','sell','predict'].includes(e.action) && ['reserved','success','rejected'].includes(e.result) &&
      (e.settlement==null || objectState(e.settlement) && e.action==='predict' && e.result==='success' &&
        stockCore.id(e.betId) && stockCore.whole(e.settlement.payout) && stockCore.whole(e.settlement.at))) &&
    (v.pending===null || objectState(v.pending) && typeof v.pending.id==='string' && stockCore.whole(v.pending.at) &&
      Number.isInteger(v.pending.retries) && v.pending.retries>=0 && v.pending.retries<=2 &&
      objectState(v.pending.input) && stockCore.same(v.pending.input,stockCore.input(v.pending.choice,v.userId)) &&
      (v.pending.confirmedAt===undefined || stockCore.whole(v.pending.confirmedAt)&&v.pending.confirmedAt>=v.pending.at) &&
      (v.pending.reserveFloor===undefined || stockCore.whole(v.pending.reserveFloor)&&v.pending.reserveFloor<=1e12) &&
      v.entries.some(e=>e.id===v.pending.id && e.action===v.pending.input.action) &&
      (v.pending.key===null || typeof v.pending.key==='string' && /^[a-zA-Z0-9-]{8,64}$/.test(v.pending.key)) &&
      [null,'success','rejected'].includes(v.pending.result));
  const emptyStockLedger = () => ({version:1,userId:null,nextAt:0,note:'未配置资金，不会自动交易',hold:false,owned:{},entries:[],pending:null});
  let stockConfig=loadState(localStorage,STOCK_CONFIG,stockDefault,'stock',validStockConfig);
  let stockLedger=loadState(localStorage,STOCK_LEDGER,emptyStockLedger(),'stock',validStockLedger);
  let stockFault='',stockRead=null,stockController=null,stockGeneration=0,stockReadAt=0,stockReadStarted=0;
  let stockEntryAt=0,stockLeave=false,stockActions=0,stockManualUntil=0;
  const stockEnabled = () => stockConfig.trade || stockConfig.predict;
  const stockActionEnabled = action => action==='predict' ? stockConfig.predict : stockConfig.trade;
  // Keep the stop cause separate from temporary wait/status messages, including legacy records.
  const stockHoldReason = () => stockLedger.hold ? stockLedger.holdReason || stockLedger.note : null;
  // Legacy capacity stops may resume reads; other holds and pending requests keep their existing protections.
  const stockCapacityWait = () => !stockLedger.pending && stockHoldReason()==='股市账本达到容量上限，请导出日志后核对';
  function stockPersist(value) {
    // 通知可能迟到；发现共享记录已改变时，不能把按旧状态算出的值写回。
    const changed=stockReload();
    if(stateFault('stock'))throw Error('股市共享记录不可读，已撤销旧状态写入');
    if(changed)throw Object.assign(Error('股市共享记录已更新，已撤销旧状态写入'),{code:'stock-state-changed'});
    value={...value,holdReason:value.hold?value.holdReason||value.note:null};
    if(!validStockLedger(value))throw Error('股市账本校验失败');
    const text=JSON.stringify(value);localStorage.setItem(STOCK_LEDGER,text);
    if(localStorage.getItem(STOCK_LEDGER)!==text)throw Error('股市账本写入失败');
    stockLedger=value;
  }
  function stockReload() {
    const previous=JSON.stringify([stockConfig,stockLedger]);
    stockConfig=loadState(localStorage,STOCK_CONFIG,stockDefault,'stock',validStockConfig);
    stockLedger=loadState(localStorage,STOCK_LEDGER,emptyStockLedger(),'stock',validStockLedger);
    return previous!==JSON.stringify([stockConfig,stockLedger]);
  }
  function stockHint() {
    const c=stockConfig,l=stockLedger;
    const reason=stockHoldReason();
    const text=stateFault('stock') || stockFault || `股市${stockEnabled()?'':'已暂停'}：${l.note}${reason&&reason!==l.note?`；停止原因：${reason}`:''}。24小时买入 ${stockCore.spend(l.entries,'buy',Date.now())}/${c.tradeLimit}；预测 ${stockCore.spend(l.entries,'predict',Date.now())}/${c.predictionLimit}${l.pending?'；有原交易待核对':''}`;
    const el=shadow.getElementById('stock-status');if(el.textContent!==text)el.textContent=text;
  }
  function stockFillSettings() {
    for(const [key,id] of [['trade','stock-trade'],['predict','stock-predict']])shadow.getElementById(id).checked=stockConfig[key];
    for(const [key,id] of [['tradeLimit','stock-trade-limit'],['predictionLimit','stock-prediction-limit'],['stake','stock-stake'],['reserve','stock-reserve']])shadow.getElementById(id).value=String(stockConfig[key]);
  }
  stockFillSettings();
  shadow.getElementById('stock-save').addEventListener('click',()=>{
    try {
      stockReload();
      if(stateFault('stock')){say(stateFault('stock'));return;}
      const c={trade:shadow.getElementById('stock-trade').checked,predict:shadow.getElementById('stock-predict').checked};
      for(const [key,id] of [['tradeLimit','stock-trade-limit'],['predictionLimit','stock-prediction-limit'],['stake','stock-stake'],['reserve','stock-reserve']]) {
        const raw=shadow.getElementById(id).value;c[key]=/^\d+$/.test(raw)?Number(raw):NaN;
      }
      if(!validStockConfig(c) || c.predict && (!c.stake || c.stake>c.predictionLimit)) {say('请填写有效整数额度；预测每注必须大于0且不超过预测上限');return;}
      localStorage.setItem(STOCK_CONFIG,JSON.stringify(c));
      if(localStorage.getItem(STOCK_CONFIG)!==JSON.stringify(c))throw Error('设置保存失败');
      stockConfig=c;stockFault='';cancelStockRead();cancelQueued();
      stockPersist({...stockLedger,nextAt:0,hold:stockLedger.pending?stockLedger.hold:false,
        holdReason:stockHoldReason(),note:'设置已保存，等待检查'});
      if(navigation?.to==='/stock' && !stockEnabled())clearNavigation();
      schedule();
    }catch(error){if(!stockRetryChange(error)){stockFault='股市设置保存失败，停止股市操作';say(stockFault);}}
  });
  shadow.getElementById('stock-check').addEventListener('click',()=>{
    stockReload();
    if(stateFault('stock') || stockFault || !stockEnabled()){say('请先配置并开启股市');return;}
    try{stockPersist({...stockLedger,nextAt:0});cancelStockRead();cancelQueued();schedule();}
    catch(error){if(!stockRetryChange(error))stockFault='无法保存股市预约';}
  });
  // 人工操作优先；不改用户筛选或接管用户原请求。正在发送的交易仍保留原记录。
  for(const name of ['pointerdown','keydown','input'])document.addEventListener(name,event=>{
    if(!event.isTrusted || !inStock() || event.composedPath().includes(host))return;
    stockManualUntil=Date.now()+60000;cancelQueued();schedule();
  },true);
  function cancelStockRead() {
    stockGeneration++;stockController?.abort();stockController=null;stockRead=null;stockReadAt=0;stockReadStarted=0;
  }
  function stockFinish(note,hold=false) {
    stockReload();
    stockPersist({...stockLedger,nextAt:Date.now()+300000,note,hold:hold || stockLedger.hold,
      holdReason:hold?note:stockHoldReason()});
    log.add(hold?'stock-held':'stock-check',note,{pending:Boolean(stockLedger.pending),held:stockLedger.hold,holdReason:stockHoldReason(),
      buys24h:stockCore.spend(stockLedger.entries,'buy',Date.now()),predictions24h:stockCore.spend(stockLedger.entries,'predict',Date.now())});
    stockLeave=true;cancelStockRead();
  }
  function stockRetryChange(error) {
    if(error?.code!=='stock-state-changed')return false;
    cancelStockRead();cancelQueued();
    // 只预约重新读取，不重放旧计算或清理原请求；预约仍冲突则交回调用方安全停止。
    try{stockFinish('股市共享记录已更新，本轮操作已撤销，五分钟后重新检查');schedule();return true;}
    catch{return false;}
  }
  function stockBack() {
    offer('stock:return','返回远征，股市按预约再检查',()=>{
      startNavigation('/activities/expedition',travelLink('/activities/expedition'));
    });
  }
  function maybeVisitStock(running) {
    if(stockReload()){cancelStockRead();cancelQueued();}
    // A paused feature keeps its original journal for reconciliation, without blocking unrelated work.
    if(!stockEnabled() || stockFault || stateFault('stock') || stockLedger.hold && !stockLedger.pending?.result && !stockCapacityWait() && !stockCanConfirmHere() || stockLedger.nextAt>Date.now() ||
      farmEnabled&&farmPlan || shelterEnabled&&shelterPending&&!shelterReadOnlyWait())return false;
    rememberExpeditionTime(running);
    if(farmState.expeditionAt>Date.now() && farmState.expeditionAt-Date.now()<15000)return false;
    offer('stock:visit','检查股市行情、持仓与预测',()=>{
      startNavigation('/stock',travelLink('/stock'));
    });return true;
  }
  function readStock() {
    if(stockController || Date.now()<stockReadAt)return;
    const generation=++stockGeneration,controller=new AbortController();stockController=controller;stockReadStarted=Date.now();
    const timeout=setTimeout(()=>controller.abort(),10000);
    const read=async path=>{const response=await fetch(path,{cache:'no-store',signal:controller.signal});
      if(!response.ok || response.redirected)throw Error('股市状态读取失败');return response.json();};
    Promise.all([read('/api/stock'),read('/api/me/balance')]).then(([view,balance])=>{
      if(generation!==stockGeneration || !enabled || !active || !inStock() || accountStopReason())return;
      if(stockReload() || stateFault('stock')){cancelStockRead();cancelQueued();schedule();return;}
      const m=stockCore.model(view,balance);if(!m)throw Error('股市字段不完整');
      if(stockLedger.userId!==null && stockLedger.userId!==view.userId){stockFinish('股市账号已变化，保留原账本，请核对账号',true);return;}
      if(stockLedger.userId===null)stockPersist({...stockLedger,userId:view.userId});
      stockRead={at:Date.now(),model:m};
    }).catch(error=>{
      if(generation!==stockGeneration || !enabled || !inStock() || accountStopReason())return;
      if(error?.code==='stock-state-changed'){
        if(!stockRetryChange(error))stockFault='股市记录无法保存';
        return;
      }
      try{stockFinish('股市行情或余额未能完整读取，五分钟后再检查');}
      catch(error){if(!stockRetryChange(error))stockFault='股市记录无法保存';}
    }).finally(()=>{clearTimeout(timeout);if(generation===stockGeneration){stockController=null;stockReadAt=Date.now()+2000;schedule();}});
  }
  function stockNative() {
    const records=[];
    for(let i=0;i<sessionStorage.length;i++) {
      const key=sessionStorage.key(i);if(!/^stock:request:\d+$/.test(key || ''))continue;
      const raw=sessionStorage.getItem(key);if(raw===null || raw==='null')continue;
      try{records.push({key,value:JSON.parse(raw)});}catch{records.push({key,value:null});}
    }
    return records;
  }
  function stockOwnNative(p,records=stockNative()) {
    return records.length===1 && records[0].key===`stock:request:${stockLedger.userId}` &&
      records[0].value?.idempotencyKey===p.key && stockCore.same(records[0].value.input,p.input);
  }
  function stockCanConfirmHere() {
    const p=stockLedger.pending;
    return Boolean(p?.key&&p.retries<2&&stockOwnNative(p));
  }
  function stockCapture(p) {
    return {
      bind(body) {
        // The native handler runs after reservation; another tab can still change limits or ownership before fetch.
        const changed=stockReload(),current=stockLedger.pending;
        if(changed || !enabled || localStorage.getItem(PREF)==='false' || !active || !stockActionEnabled(p.input.action) || stockFault || accountStopReason() || !current || current.id!==p.id ||
          !/^[a-zA-Z0-9-]{8,64}$/.test(body?.idempotencyKey || ''))throw Error('股市请求未绑定');
        const {idempotencyKey,...input}=body;
        if(!stockCore.same(input,current.input) || current.key && current.key!==idempotencyKey)throw Error('股市请求不一致');
        const bound={...current,key:idempotencyKey};if(!stockOwnNative(bound))throw Error('原生记录不一致');
        stockPersist({...stockLedger,pending:bound});
      },
      fail(){stockFault='股市原请求绑定失败，保留记录，请核对原交易';schedule();},
      result(status,body) {
        try {
          stockReload();const current=stockLedger.pending;if(!current || current.id!==p.id)return;
          const result=stockCore.receipt(current,status,body);
          const resolved=current.result || result;
          const confirmedAt=resolved==='success'?current.confirmedAt??Math.max(current.at,
            current.result==='success'&&stockCore.whole(current.responseAt)?current.responseAt:Date.now()):null;
          stockPersist({...stockLedger,
            entries:confirmedAt!==null?stockLedger.entries.map(e=>e.id===current.id?{...e,confirmedAt}:e):stockLedger.entries,
            pending:{...current,result:resolved,...(confirmedAt!==null?{confirmedAt}:{}),responseAt:Date.now(),httpStatus:status}});
          stockRead=null;stockReadAt=Date.now()+1000;
          log.add('stock-response',result==='success'?'股市原交易回执已核对':result==='rejected'?'股市原交易明确未执行':'股市交易结果仍未知',
            {action:current.input.action,status,confirmed:Boolean(result),...(confirmedAt!==null?{confirmedAt}:{})});schedule();
        }catch{stockFault='无法保存股市响应，原交易保留';schedule();}
      }
    };
  }
  function stockClick(button,p) {
    captureStockAction=stockCapture(p);
    try{button.click();}finally{captureStockAction=null;}
  }
  observeStockPost = (body,nativeAtSend) => {
    try {
      stockReload();if(stateFault('stock'))return null;
      const {idempotencyKey,...input}=body || {},p=stockLedger.pending;
      // 用户在原生页手动确认脚本原请求时，仍只接收精确匹配的回执。
      if(p?.key && p.key===idempotencyKey && stockCore.same(input,p.input) && stockOwnNative(p,nativeAtSend))return stockCapture(p);
      if(['buy','sell'].includes(input.action) && input.expectedUserId===stockLedger.userId) {
        const owned={...stockLedger.owned};let changed=false;
        for(const [id,o] of Object.entries(owned))if(o.modelName===input.modelName && !o.manual){owned[id]={...o,manual:true};changed=true;}
        const touched=p?.choice.modelName===input.modelName && p.input.action!=='predict';
        if(changed || touched)stockPersist({...stockLedger,owned,pending:touched?{...p,manualTouched:true}:p,note:'检测到手动交易，相关模型交回人工管理'});
      }
    }catch{stockFault='手动交易后的持仓归属无法核对，停止股市操作';}
    return null;
  };
  // Native successful requests can clear sessionStorage before an asynchronous body copy finishes.
  observeStockPost.snapshot=stockNative;
  function stockRoundSignature(round) {
    const fmt=s=>new Date(s).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
    return `${fmt(round.lockAt)}～${fmt(round.closeAt)}|${(round.oddsBp/100).toFixed(2)}x`.normalize('NFKC');
  }
  function stockControls(a,m) {
    if(a.action!=='predict') {
      const input=locator.pick([...document.querySelectorAll('input')].filter(n=>n.getAttribute('aria-label')===`${a.modelName} 交易数量`));
      const root=input?.parentElement?.parentElement;
      return {input,button:buttonIn(root,new RegExp(`^${a.action==='buy'?'买':'卖'} ${a.shares}$`))};
    }
    const root=section('涨跌预测'),round=m.view.rounds.find(r=>r.id===a.roundId);
    if(!root || !round)return {};
    const signature=stockRoundSignature(round);
    if(m.view.rounds.filter(r=>r.stockId===a.stockId && stockRoundSignature(r)===signature).length!==1)return {};
    const cards=[];
    for(const title of [...root.querySelectorAll('p')].filter(n=>textOf(n)===a.modelName)) {
      let card=title.parentElement;
      while(card && card!==root && ![...card.querySelectorAll('button')].some(b=>/^(涨|跌) \d+$/.test(textOf(b))))card=card.parentElement;
      if(card && card!==root && signature.split('|').every(s=>textOf(card).replace(/\s/g,'').includes(s)))cards.push(card);
    }
    const card=locator.pick([...new Set(cards)]);
    return {input:locator.pick([...root.querySelectorAll('input')].filter(n=>n.getAttribute('aria-label')==='预测下注代币数量')),
      button:buttonIn(card,new RegExp(`^${a.direction==='up'?'涨':'跌'} ${a.betTokens}$`))};
  }
  function stockReconcile(m) {
    const p=stockLedger.pending;if(!p)return false;
    if(p.result) {
      if(p.result==='success' && p.manualTouched){stockFinish('原交易期间持仓被手动操作，成本无法独立核对，保留原记录',true);return true;}
      const owned={...stockLedger.owned},entries=stockLedger.entries.map(e=>({...e})),entry=entries.find(e=>e.id===p.id),a=p.choice;
      entry.result=p.result;
      if(p.result==='success')entry.confirmedAt=Math.max(p.at,p.confirmedAt??entry.confirmedAt??
        (stockCore.whole(p.responseAt)?p.responseAt:Date.now()));
      if(p.result==='success' && a.action!=='predict') {
        const pos=m.view.positions.find(s=>s.stockId===a.stockId),expected=p.beforeShares+(a.action==='buy'?a.shares:-a.shares);
        if((pos?.shares || 0)!==expected || expected && !(a.action==='buy'?stockCore.positive(pos.costBasisTokens):stockCore.whole(pos.costBasisTokens))) {
          // A newly bought positive-price lot cannot prove its actual debit with a zero cost basis.
          const zeroBuyCost=a.action==='buy'&&pos?.shares===expected&&pos.costBasisTokens===0;
          if(Date.now()-p.at>30000)stockFinish(zeroBuyCost?'新买入持仓成本为0，保留预算及原记录，等待实际成本更新':'交易已执行，等待对应持仓和成本更新；保留原记录，稍后核对');
          else {stockRead=null;stockReadAt=Date.now()+2000;say(zeroBuyCost?'新买入持仓成本为0，保留预算并等待同步':'交易已执行，等待持仓和成本更新');}
          return true;
        }
        if(a.action==='buy')entry.debit=pos.costBasisTokens;
        if(expected)owned[String(a.stockId)]={shares:pos.shares,cost:pos.costBasisTokens,modelName:a.modelName,manual:false};
        else delete owned[String(a.stockId)];
      }else if(p.result==='success') {
        const matches=m.view.myBets.filter(b=>b.roundId===a.roundId && b.direction===a.direction && b.betTokens===a.betTokens && !p.beforeBets.includes(b.id));
        if(matches.length!==1 || !stockCore.uniqueBet(m.view,matches[0].id)) {
          if(Date.now()-p.at>30000)stockFinish('下注已执行，等待对应下注记录更新；保留原记录，稍后核对');
          else {stockRead=null;stockReadAt=Date.now()+2000;say('下注已执行，等待对应下注记录，不再次下注');}
          return true;
        }
        entry.betId=matches[0].id;
      }
      const over=p.result==='success' && a.action==='buy' && (entry.debit>a.debit || stockCore.spend(entries,'buy',Date.now())>stockConfig.tradeLimit);
      const resolvedWait=p.result==='success'&&!p.manualTouched&&
        (stockHoldReason()==='本页没有匹配的原交易，请回原标签页核对；不新建交易'||
          a.action!=='predict'&&stockHoldReason()==='交易已执行，但持仓成本或数量尚未对应，保留原记录');
      const reason=over?'实际买入超过预留金额，已停止后续自动交易':stockLedger.hold&&!resolvedWait?stockHoldReason():null;
      stockPersist({...stockLedger,owned,entries,pending:null,hold:Boolean(reason),holdReason:reason,
        note:p.result==='rejected'?'交易被网站拒绝，未执行':reason||`${a.action==='buy'?'买入':a.action==='sell'?'卖出':'预测下注'}已确认`});
      log.add('stock-confirmed',stockLedger.note,{action:a.action,model:a.modelName,result:p.result,
        submittedAt:entry.at,...(entry.confirmedAt!==undefined?{confirmedAt:entry.confirmedAt}:{}),
        ...(a.action==='sell'?{shares:a.shares}:{debitTokens:entry.debit})});
      stockRead=null;stockReadAt=Date.now()+2000;
      if(p.result==='rejected' || over)stockFinish(stockLedger.note,true);
      return true;
    }
    if(!p.key) {if(Date.now()-p.at>10000)stockFinish('尚未捕获属于脚本的原交易编号，保留记录，请核对',true);else say('等待原网页提交股市交易');return true;}
    if(!stockActionEnabled(p.input.action)){stockFinish('原交易所属功能已暂停，保留原请求供手动核对');return true;}
    if(!stockOwnNative(p)) {stockFinish('本页没有匹配的原交易，请回原标签页核对；不新建交易',true);return true;}
    const fundingWait=stockCore.recoveryWait(m,stockConfig,stockLedger,p,Date.now());
    if(fundingWait){stockFinish(fundingWait);return true;}
    const wait=p.retries?120000:30000;
    if(Date.now()-(p.lastRetryAt || p.at)<wait){say('等待股市原交易结果，不重复下单');return true;}
    if(p.retries>=2){stockFinish('原交易已核对两次仍未知，保留记录，请手动确认原交易',true);return true;}
    const button=locator.pick([...document.querySelectorAll('button')].filter(b=>textOf(b)==='确认原交易'));
    if(!usable(button)) {stockFinish('原交易确认按钮尚不可用，保留记录，稍后核对');return true;}
    const key=`stock:recover:${p.id}:${p.retries}`;
    if(queued?.key===key&&Date.now()>=queued.dueAt&&Date.now()-stockRead.at>1500){offered=true;readStock();return true;}
    offer(key,'核对同一笔股市原交易',()=>{
      const next={...p,retries:p.retries+1,lastRetryAt:Date.now()};stockPersist({...stockLedger,pending:next});stockClick(button,next);
    });return true;
  }
  function stockStep() {
    if(stockReload()){cancelStockRead();cancelQueued();}
    if(!stockEnabled() && !stockEntryAt){say('股市自动操作未开启，可在面板配置额度与开关');return;}
    if(!stockEntryAt){stockEntryAt=Date.now();stockActions=0;stockLeave=false;}
    if(stockLeave){stockBack();return;}
    if(!stockEnabled() || stockFault || stateFault('stock')){stockBack();return;}
    const dialogs=[...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    if(dialogs.length){handleNotice(dialogs,'股市弹窗等待你处理');return;}
    if(Date.now()<stockManualUntil){say('股市正在手动操作，自动操作等待一分钟');return;}
    if(!navigator.onLine){stockFinish('网络离线，保留股市记录，稍后检查');return;}
    if(plan || claimWait || farmEnabled&&farmPlan || shelterEnabled&&shelterPending&&!shelterReadOnlyWait() || nativePending().length){stockFinish('其他玩法有原操作待核对，先返回远征');return;}
    if(stockLedger.hold && !stockLedger.pending?.result && !stockCapacityWait() && !stockCanConfirmHere()){stockFinish(stockLedger.note);return;}
    if(stockLedger.pending && Date.now()-stockEntryAt>60000 && !stockLedger.pending.result){stockFinish('原交易待核对，先回远征，下次只核对同一请求');return;}
    if(stockController && Date.now()-stockReadStarted>12000){cancelStockRead();stockFinish('股市读取超时，稍后再检查');return;}
    if(!stockRead || Date.now()-stockRead.at>10000){readStock();return;}
    const m=stockRead.model;
    if(stockReconcile(m))return;
    if(stockNative().length){stockFinish('存在手动股市原请求，请先在网页核对',true);return;}
    // 手动改变持仓后停止管理该模型，避免出售人工买入的股票。
    const owned={...stockLedger.owned},capacityWait=stockCapacityWait();let changed=capacityWait;
    for(const [id,o] of Object.entries(owned)) {
      const p=m.view.positions.find(p=>String(p.stockId)===id);
      if(!o.manual && (p?.shares!==o.shares || p?.costBasisTokens!==o.cost)) {owned[id]={...o,manual:true};changed=true;}
    }
    const settlements=[];
    const entries=stockLedger.entries.filter(e=>stockCore.entryTime(e)>Date.now()-7*86400000 || e.action==='predict' && e.result!=='rejected' && !e.settlement).map(entry=>{
      if(entry.action!=='predict' || entry.result!=='success' || !entry.betId || entry.settlement)return entry;
      const bet=stockCore.uniqueBet(m.view,entry.betId);
      if(bet?.settled===true && bet.roundId===entry.roundId && bet.betTokens===entry.debit && stockCore.whole(bet.payoutTokens)) {
        const next={...entry,settlement:{payout:bet.payoutTokens,at:Date.now()}};changed=true;
        settlements.push(next);return next;
      }
      return entry;
    });
    if(changed || entries.length!==stockLedger.entries.length)stockPersist({...stockLedger,owned,entries,
      ...(capacityWait?{hold:false,holdReason:null,note:'股市账本容量等待已恢复核对'}:{})});
    // A failed ledger write must not mutate the live ledger or announce a completed settlement.
    for(const entry of settlements)log.add('stock-prediction-settled','预测已结算，返还不补回下注额度',
      {stake:entry.debit,payout:entry.settlement.payout,net:entry.settlement.payout-entry.debit});
    if(stockLedger.entries.length>=2000){stockFinish('股市账本暂满，暂停新交易，五分钟后核对结算与到期记录');return;}
    if(Date.now()-stockEntryAt>60000 || stockActions>=3){stockFinish('本轮股市检查结束，五分钟后继续');return;}
    const a=stockCore.choose(m,stockConfig,stockLedger,Date.now());
    if(!a){stockFinish(stockCore.waitReason(m,stockConfig,stockLedger,Date.now()));return;}
    const control=stockControls(a,m),quantity=a.action==='predict'?a.betTokens:a.shares;
    if(!usable(control.input)){stockFinish('目标模型控件不可见或不唯一，请检查手动筛选');return;}
    if(Number(control.input.value)!==quantity) {
      offer(`stock:quantity:${a.action}:${a.stockId}:${quantity}`,'填写股市原生数量',()=>{
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(control.input,String(quantity));
        control.input.dispatchEvent(new Event('input',{bubbles:true}));control.input.dispatchEvent(new Event('change',{bubbles:true}));
      });return;
    }
    if(!usable(control.button)){stockFinish('目标交易按钮尚不可用，稍后再检查');return;}
    const key=`stock:submit:${JSON.stringify(a)}`;
    if(queued?.key===key && Date.now()>=queued.dueAt && Date.now()-stockRead.at>1500){offered=true;readStock();return;}
    offer(key,`${a.action==='predict'?'预测'+(a.direction==='up'?'涨':'跌'):a.action==='buy'?'买入':'卖出'} ${a.modelName}`,()=>{
      const p={id:crypto.randomUUID(),at:Date.now(),retries:0,key:null,result:null,choice:a,input:stockCore.input(a,m.view.userId),
        beforeShares:m.view.positions.find(p=>p.stockId===a.stockId)?.shares || 0,beforeBets:m.view.myBets.map(b=>b.id)};
      stockPersist({...stockLedger,pending:p,entries:[...stockLedger.entries,{id:p.id,at:p.at,action:a.action,stockId:a.stockId,roundId:a.roundId,debit:a.debit,result:'reserved'}]});
      stockActions++;stockRead=null;stockReadAt=Date.now()+2000;
      log.add('stock-submit',a.reason,{action:a.action,model:a.modelName,shares:a.shares,stake:a.betTokens,reservedDebit:a.debit});
      stockClick(control.button,p);
    });
  }

  // 避难所只在远征组运行。读取原有状态接口，所有写入使用原网页控件。
  const SHELTER_PREF = 'arkengine:auto-shelter:enabled:v1';
  const SHELTER_STATE = 'arkengine:auto-shelter:schedule:v1';
  const SHELTER_PENDING = 'arkengine:auto-shelter:pending:v1';
  const SHELTER_STAFF = 'arkengine:auto-shelter:staff:v1';
  const SHELTER_GEAR = 'arkengine:auto-shelter:gear:v1';
  const SHELTER_OPTIMIZE = 'arkengine:auto-shelter:optimize:v1';
  const SHELTER_POPULATION = 'arkengine:auto-shelter:population:v1';
  const SHELTER_EXPLORE_CLAIM = 'arkengine:auto-shelter:explore-claim:v1';
  function populationTarget() {
    const raw = localStorage.getItem(SHELTER_POPULATION), value = raw === null ? 14 : Number(raw);
    return Number.isInteger(value) && value >= 2 && value <= 200 ? value : null;
  }
  let shelterPopulationTarget = populationTarget(), shelterPopulationNote = '';
  let shelterGear = localStorage.getItem(SHELTER_GEAR) === 'true';
  let shelterOptimize = localStorage.getItem(SHELTER_OPTIMIZE) === 'true';
  let shelterExploreClaim = localStorage.getItem(SHELTER_EXPLORE_CLAIM) === 'true',shelterExploreNote='',shelterExploreManualUntil=0;
  const shelterExploreSkipped=new Set();
  const staffModes = ['off','production','family','population'];
  let shelterStaffMode = localStorage.getItem(SHELTER_STAFF) || 'off';
  if (!staffModes.includes(shelterStaffMode)) shelterStaffMode = 'off';
  let shelterWork = null, shelterStaffHold = false, shelterStaffNote = '';
  const shelterKinds = ['collect', 'tutorial', 'daily', 'season', 'achievement', 'assign', 'equip', 'explore'];
  let shelterEnabled = localStorage.getItem(SHELTER_PREF) === 'true';
  let shelterStopFault='';
  const validShelterState = v => objectState(v) && Number.isFinite(v.nextAt) && typeof v.note === 'string' &&
    (v.pendingReadOnly === undefined || typeof v.pendingReadOnly === 'string' && v.pendingReadOnly.length > 0) &&
    (v.vaultNo === undefined || Number.isSafeInteger(v.vaultNo) && v.vaultNo > 0);
  let shelterState = loadState(localStorage, SHELTER_STATE, { nextAt: 0, note: '等待首次检查' }, 'shelter',validShelterState);
  const validShelterPending = v => timedState(v) &&
    typeof v.id === 'string' && shelterKinds.includes(v.kind) && Number.isSafeInteger(v.vaultNo) && v.vaultNo > 0 &&
    Array.isArray(v.targets) && v.targets.length > 0 &&
    (v.sentCount === undefined || v.kind === 'season' && Number.isSafeInteger(v.sentCount) && v.sentCount > 0 && v.sentCount <= v.targets.length) &&
    v.targets.every((x,i) => typeof x === 'string' || Number.isSafeInteger(x) || v.kind === 'assign' && i === 1 && x === null) && objectState(v.before) &&
    Number.isFinite(v.before.collected) && typeof v.before.day === 'string' && typeof v.before.month === 'string' &&
    (v.kind !== 'assign' || v.targets.length === 2 && Number.isSafeInteger(v.targets[0]) && v.targets[0] > 0 &&
      (v.targets[1] === null || Number.isSafeInteger(v.targets[1]) && v.targets[1] > 0) &&
      (v.before.room === null || Number.isSafeInteger(v.before.room))) &&
    (v.kind !== 'equip' || v.targets.length === 2 && v.targets.every(x => Number.isSafeInteger(x) && x > 0) &&
      (v.before.outfit === null || Number.isSafeInteger(v.before.outfit))) &&
    (v.kind !== 'explore' || v.targets.length===2&&v.targets.every(x=>Number.isSafeInteger(x)&&x>0)&&
      objectState(v.before.explorer)&&v.before.explorer.id===v.targets[0]&&v.before.explorer.residentId===v.targets[1]&&
      Number.isFinite(v.before.explorer.startedAt)&&Number.isFinite(v.before.explorer.returnAt)&&
      v.before.explorer.returnAt>=v.before.explorer.startedAt) &&
    (v.kind !== 'collect' || Array.isArray(v.before.rooms) && v.before.rooms.length > 0 &&
      v.before.rooms.every(r => Number.isSafeInteger(r.id) && Number.isFinite(r.stored) && r.stored > 0));
  // 同组只持有一把运行锁；未决记录跨标签共享，避免接力标签重放未知领取。
  let shelterPending = loadState(localStorage, SHELTER_PENDING, null, 'shelter', validShelterPending);
  function shelterReadOnlyWait() { return Boolean(shelterPending && shelterState.pendingReadOnly === shelterPending.id); }
  let shelterRead = null, shelterController = null, shelterGeneration = 0, shelterReadAt = 0;
  let shelterEntryAt = 0, shelterStage = 0, shelterActions = 0, shelterLeave = false, shelterVisitPeriod = null;
  let shelterBatchReloading = false;
  const shelterToggle = shadow.getElementById('shelter-toggle');
  const shelterResources = { power: '电力', food: '食物', water: '净水', scrap: '废料', parts: '零件', stimpak: '治疗针' };
  // 2026-11-03 公开前端：属性、基础小时产出、每批数量；等级倍率 1 / 1.5 / 2.1。
  const shelterRooms = { power: ['str','power',12,30], diner: ['agi','food',8,25], water: ['per','water',8,25],
    scrap: ['end','scrap',8,30], medbay: ['int','stimpak',.5,2], workshop: ['int','parts',.6,3],
    door: [], elevator: [], quarters: [], storage: [], training: [], armory: [], tailor: [], radio: [] };
  // Public 2026-11-03 room definitions: label, base scrap price, unlock level.
  const shelterBuildRules = {power:['发电站',100,1],diner:['餐厅',100,1],water:['净水站',100,1],scrap:['废料回收站',80,1],
    quarters:['宿舍',120,1],storage:['仓库',80,2],medbay:['医务室',300,3],training:['训练室',400,4],
    workshop:['工坊',500,5],armory:['武器工坊',600,6],tailor:['服装工坊',600,6],radio:['电台',800,8]};
  const achievementIds = Object.fromEntries([
    ['向下十层','depth-10'],['小小社区','pop-20'],['勤快管家','collect-10k'],['废土常客','explore-10'],
    ['消防队','incident-20'],['新生命','birth-1'],['第一件作品','craft-1'],['老手','resident-10'],
    ['五脏俱全','rooms-6'],['见多识广','codex-15'],['身经百战','wins-50'],['初具规模','level-5'],
    ['赛季起步','season-5'],['深入地底','depth-30'],['繁荣小镇','pop-60'],['仓储专家','collect-200k'],
    ['废土老兵','explore-500h'],['临危不乱','incident-200'],['人丁兴旺','birth-50'],['能工巧匠','craft-30'],
    ['资深居民','resident-30'],['精良装备','gear-4'],['任务专家','quests-20'],['赛季中坚','season-20'],
    ['地下城市','level-12'],['深渊行者','depth-60'],['总工程师','builder'],['大家长','family'],
    ['收藏家','collector'],['传奇居民','resident-50'],['薪火相传','legacy-20'],['赛季满档','season-30'],['废土巨富','collect-2m']
  ]);
  function shelterReload() {
    const snapshot=()=>JSON.stringify([shelterEnabled,shelterState,shelterPending,shelterStaffMode,
      shelterGear,shelterOptimize,shelterPopulationTarget,shelterExploreClaim]);
    const previous=snapshot(),mode=shelterStaffMode,gear=shelterGear,optimize=shelterOptimize,
      target=shelterPopulationTarget,explore=shelterExploreClaim,hadSwap=Boolean(shelterState.swap);
    shelterEnabled=localStorage.getItem(SHELTER_PREF)==='true';
    shelterState=loadState(localStorage,SHELTER_STATE,shelterState,'shelter',validShelterState);
    shelterPending=loadState(localStorage,SHELTER_PENDING,null,'shelter',validShelterPending);
    if(stateFault('shelter')||shelterStopFault)shelterEnabled=false;
    const staff=localStorage.getItem(SHELTER_STAFF);
    shelterStaffMode=staffModes.includes(staff)?staff:'off';
    shelterGear=localStorage.getItem(SHELTER_GEAR)==='true';
    shelterOptimize=localStorage.getItem(SHELTER_OPTIMIZE)==='true';
    shelterExploreClaim=localStorage.getItem(SHELTER_EXPLORE_CLAIM)==='true';
    shelterPopulationTarget=populationTarget();
    if(mode!==shelterStaffMode||gear!==shelterGear||optimize!==shelterOptimize){
      shelterStaffHold=hadSwap;
      shelterStaffNote=hadSwap?'其他页面已改变设置，本轮停止人员调整。':'';
    }
    if(target!==shelterPopulationTarget){shelterStaffHold=false;shelterStaffNote='';shelterPopulationNote='';}
    if(explore!==shelterExploreClaim){shelterExploreNote='';shelterExploreSkipped.clear();}
    return previous!==snapshot();
  }
  function shelterWriteGuard() {
    const changed=shelterReload();
    if(stateFault('shelter'))throw Error('避难所共享记录不可读，保留原文');
    if(shelterStopFault)throw Error(shelterStopFault);
    if(changed)throw Object.assign(Error('避难所共享记录已更新，已撤销旧写入'),{code:'shelter-state-changed'});
  }
  function saveShelter(value) {
    shelterWriteGuard();
    const raw = JSON.stringify(value);
    localStorage.setItem(SHELTER_STATE, raw);
    if (localStorage.getItem(SHELTER_STATE) !== raw) throw new Error('无法保存避难所预约');
    shelterState = value;
  }
  function saveShelterPending(value) {
    shelterWriteGuard();
    const raw = JSON.stringify(value);
    localStorage.setItem(SHELTER_PENDING, raw);
    if (localStorage.getItem(SHELTER_PENDING) !== raw) throw new Error('无法保存避难所操作记录');
    shelterPending = value;
  }
  function cancelShelterRead() {
    shelterGeneration++; shelterController?.abort(); shelterController = null; shelterRead = null; shelterReadAt = 0;
  }
  function shelterHint() {
    if (stateFault('shelter')||shelterStopFault) shelterEnabled = false;
    const left = Math.max(0, shelterState.nextAt - Date.now());
    const message = stateFault('shelter') || shelterStopFault || `避难所${shelterEnabled ? '' : '已暂停'}：${shelterState.note}${
      shelterEnabled && left ? `；约 ${Math.ceil(left / 60000)} 分钟后检查` : ''}`;
    shadow.getElementById('shelter-status').textContent = message;
    shelterToggle.textContent = shelterEnabled ? '暂停避难所' : '开启避难所';
    shadow.getElementById('shelter-advice').textContent = shelterState.advice || '首次检查后显示生产和生育建议；人员由你安排。';
    shadow.getElementById('shelter-development').textContent = shelterState.development || '检查避难所后比较建造、升级和扩容。建议不会自动花费资源。';
    shadow.getElementById('shelter-operations').textContent = shelterState.operations || '检查后显示停产、供应、施工和废土返程情况。';
    shadow.getElementById('shelter-staff').value = shelterStaffMode;
    shadow.getElementById('shelter-gear').checked = shelterGear;
    shadow.getElementById('shelter-optimize').checked = shelterOptimize;
    shadow.getElementById('shelter-explore-claim').checked = shelterExploreClaim;
    shadow.getElementById('shelter-explore-status').textContent=shelterExploreClaim?
      shelterExploreNote||shelterState.exploreNote||'库存足够时领取已归来的探险；小队、出发、召回和救援由你安排。':'探险自动领取未开启。';
    const target = shadow.getElementById('shelter-population');
    if (shadow.activeElement !== target) target.value = shelterPopulationTarget ?? '';
    shadow.getElementById('shelter-population-status').textContent = shelterStaffMode === 'population' ?
      shelterPopulationNote || `目标 ${shelterPopulationTarget ?? '未设置'} 人；先保供应，再安排无已知亲缘关系的新配对。` :
      '人口发展模式才使用此目标；正在培养感情或待产的家庭保持原安排。';
    shadow.getElementById('shelter-staff-status').textContent = shelterStaffMode === 'off' ? '人员自动管理未开启。' :
      shelterStaffNote || '先保障电、水、食物，并留 20% 时产余量；保护培养感情、待产和特殊岗位。';
  }
  function pauseShelter(message) {
    try{shelterReload();}catch{ /* 读取失败也须保留原文并暂停 */ }
    shelterEnabled = false;
    cancelShelterRead(); cancelQueued();
    try {
      localStorage.setItem(SHELTER_PREF, 'false');
      if(localStorage.getItem(SHELTER_PREF)!=='false')throw Error('暂停设置未保存');
    }catch{ shelterStopFault='避难所暂停设置无法保存，本页已停止；修复存储后刷新再开启'; }
    try { saveShelter({...shelterState,note:message}); }
    catch { shelterEnabled=false; /* 内存暂停仍然生效，不覆盖损坏原文 */ }
    log.add('shelter-paused', message, { pending: Boolean(shelterPending) }); say(message);
    schedule();
  }
  function shelterRetryChange(error) {
    if(error?.code!=='shelter-state-changed')return false;
    cancelShelterRead();cancelQueued();
    try{finishShelter(null,'避难所共享记录已更新，本轮操作已撤销，一分钟后重新检查',60000);schedule();return true;}
    catch{return false;}
  }
  function shelterControl(id,event,handler) {
    shadow.getElementById(id).addEventListener(event,e=>{
      try{
        if(shelterReload()){cancelShelterRead();cancelQueued();}
        if(stateFault('shelter')||shelterStopFault){say(stateFault('shelter')||shelterStopFault);return;}
        handler(e);
      }catch(error){if(!shelterRetryChange(error))pauseShelter('避难所设置无法保存，已暂停并保留原记录');}
    });
  }
  shelterControl('shelter-toggle','click', () => {
    shelterEnabled = !shelterEnabled; localStorage.setItem(SHELTER_PREF, String(shelterEnabled));
    cancelShelterRead(); cancelQueued(); shelterLeave = false;
    saveShelter({ ...shelterState, nextAt: 0, note: shelterEnabled ? '等待检查' : '人工暂停' }); schedule();
  });
  shelterControl('shelter-check','click', () => {
    if (!shelterEnabled) { say('请先开启避难所'); return; }
    saveShelter({ ...shelterState, nextAt: 0, note: '等待检查' });
    if (!shelterPending) { cancelShelterRead(); shelterStage = 0; shelterLeave = false;shelterExploreSkipped.clear();shelterExploreNote=''; }
    schedule();
  });
  shelterControl('shelter-explore-claim','change',event=>{
    shelterExploreClaim=event.target.checked;localStorage.setItem(SHELTER_EXPLORE_CLAIM,String(shelterExploreClaim));
    shelterExploreNote='';shelterExploreSkipped.clear();cancelShelterRead();cancelQueued();
    saveShelter({...shelterState,exploreNote:'',nextAt:0,note:'探险归来领取设置已更新'});schedule();
  });
  for(const name of ['pointerdown','keydown','input','change'])document.addEventListener(name,event=>{
    if(!event.isTrusted||!shelterExploreClaim||!inShelter()||event.composedPath().includes(host))return;
    shelterExploreManualUntil=Date.now()+60000;cancelQueued();schedule();
  },true);
  shelterControl('shelter-staff','change', event => {
    shelterStaffMode = event.target.value;
    localStorage.setItem(SHELTER_STAFF,shelterStaffMode);
    shelterStaffHold = Boolean(shelterState.swap);
    shelterStaffNote = shelterStaffHold ? '设置已改变，本轮停止人员调整；已完成的换位步骤保留。' : '';
    cancelShelterRead(); cancelQueued();
    saveShelter({ ...shelterState,swap:null,nextAt:0,note:'人员管理设置已更新' }); schedule();
  });
  shelterControl('shelter-population','change',event => {
    const value = Number(event.target.value);
    if (!Number.isInteger(value) || value < 2 || value > 200) {
      say('人口目标请输入 2～200 的整数'); event.target.value = shelterPopulationTarget ?? ''; return;
    }
    localStorage.setItem(SHELTER_POPULATION,String(value)); shelterPopulationTarget = value;
    shelterPopulationNote = ''; shelterStaffHold = false; shelterStaffNote = '';
    cancelShelterRead(); cancelQueued();
    saveShelter({...shelterState,nextAt:0,note:'人口目标已更新'}); schedule();
  });
  for (const [id,key] of [['shelter-gear',SHELTER_GEAR],['shelter-optimize',SHELTER_OPTIMIZE]]) {
    shelterControl(id,'change',event => {
      localStorage.setItem(key,String(event.target.checked));
      if (key === SHELTER_GEAR) shelterGear = event.target.checked;
      else shelterOptimize = event.target.checked;
      shelterStaffHold = Boolean(shelterState.swap);
      shelterStaffNote = shelterStaffHold ? '设置已改变，本轮停止人员调整；已完成的换位步骤保留。' : '';
      cancelShelterRead(); cancelQueued();
      saveShelter({...shelterState,swap:null,nextAt:0,note:'生产强化设置已更新'}); schedule();
    });
  }
  function shelterWorkerRate(s, now, env, p, r) {
    const [stat,resource,base] = shelterRooms[r.type] || [];
    if (!resource || r.builtAt > now || r.incident || r.unpowered || r.upgradeAt !== null) return 0;
    const bonus = s.items.find(item => item.id === p.outfitId)?.bonus?.[stat] ?? 0;
    if (!Number.isFinite(bonus) || bonus < 0) throw new Error('避难所装备规则变化');
    const events = (env?.events || []).filter(e => e.kind === 'production' && e.startsAt <= now && now < e.endsAt);
    return base*[0,1,1.5,2.1][r.level]*(.5+Math.min(17,p.stats[stat]+bonus)/10)*(.6+.4*Math.min(100,p.happiness)/100)*
      (1+(Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))-1)*.01)*(1+.03*(s.legacy?.perks?.production || 0))*
      Math.min(150,Math.max(100,...events.map(e => e.percent)))/100;
  }
  function shelterStoredProjection(s,r,now,env,cap) {
    const [,resource,,batchBase]=shelterRooms[r.type],batch=(batchBase || 0)*r.width*[0,1,1.5,2.1][r.level];
    const elapsed=Math.max(0,now-s.lastSettledAt),steps=Math.floor(Math.min(86400000,elapsed)/600000);
    const nextTickAt=s.lastSettledAt+(Math.floor(elapsed/600000)+1)*600000;
    const result={stored:resource?r.stored:0,autoCollected:0,scrapConsumed:0,nextTickAt};
    if(!resource || !steps)return result;
    // Public page's ty(): 10-minute ticks, at most 24 hours, rate sampled at the start of that window.
    const from=Math.max(s.lastSettledAt,now-86400000);
    const workers=s.residents.filter(p=>p.roomId===r.id && p.away===null && p.deadAt===null && p.adultAt<=from).slice(0,r.width*2);
    const increment=workers.reduce((sum,p)=>sum+shelterWorkerRate(s,from,env,p,r),0)/6;
    const automatic=(s.handies || []).some(h=>h.floor===r.floor),maxStored=4*batch;
    let scrap=s.resources.scrap,capacity=cap-s.resources[resource];
    for(let i=0;i<steps;i++) {
      if(increment>0) {
        let made=Math.min(increment,Math.max(0,maxStored-result.stored));
        if(r.type==='workshop') {made=Math.min(made,scrap/6);scrap-=6*made;result.scrapConsumed+=6*made;}
        result.stored+=Math.max(0,made);
      }
      if(automatic) {
        const collected=Math.min(Math.floor(result.stored/batch+1e-9)*batch,Math.max(0,Math.floor(capacity)));
        if(collected>0){result.stored=Math.max(0,result.stored-collected);capacity-=collected;result.autoCollected+=collected;}
      }
      if(increment<=0 && !automatic)break;
    }
    return result;
  }
  function shelterFutureCollection(m,afterMs=0) {
    const amounts={},automatic={};
    for(const room of m.state.rooms.filter(r=>r.builtAt<=m.now+afterMs)) {
      const [,resource,,batchBase]=shelterRooms[room.type];if(!resource)continue;
      const batch=batchBase*room.width*[0,1,1.5,2.1][room.level];
      const projected=shelterStoredProjection(m.state,room,m.now+afterMs,m.view.env,m.caps[resource]);
      amounts[room.id]=Math.floor(projected.stored/batch+1e-9)*batch;
      automatic[resource]=(automatic[resource] || 0)+projected.autoCollected;
    }
    return {amounts,automatic};
  }
  function shelterCapacity(rooms,storagePerk,extraStorage=0) {
    const storage=rooms.filter(r=>r.type==='storage').reduce((n,r)=>n+r.width*r.level,extraStorage);
    const caps=Object.fromEntries(Object.keys(shelterResources).map(key=>{
      const [base,warehouse,room]=key==='scrap'?[1500,1200,600]:key==='parts'?[100,60,40]:
        key==='stimpak'?[10,5,5]:[600,400,250];
      const cells=rooms.filter(r=>shelterRooms[r.type][1]===key).reduce((n,r)=>n+r.width*[0,1,1.5,2.1][r.level],0);
      return [key,Math.floor((base+warehouse*storage+room*cells)*(1+.05*storagePerk))];
    }));
    return {caps,itemCap:20+10*storage,populationCap:Math.min(200,
      rooms.filter(r=>r.type==='quarters').reduce((n,r)=>n+r.width*(2+2*r.level),0))};
  }
  function shelterModel(view) {
    const s = view?.state, now = view?.serverTime;
    const finite = x => Number.isFinite(x) && x >= 0;
    if (!Number.isSafeInteger(view?.vaultNo) || view.vaultNo <= 0 || !finite(now) || !s ||
        !finite(s.lastSettledAt) || !finite(s.stats?.collected) || !Number.isSafeInteger(view.progress?.level) ||
        !Array.isArray(s.rooms) || !Array.isArray(s.residents) || !Array.isArray(s.items) || !Array.isArray(s.births) ||
        !Array.isArray(s.achievements) || !Array.isArray(s.daily?.claimed) || typeof s.daily.day !== 'string' ||
        !Array.isArray(s.season?.claimedFree) || !finite(s.season.points) || typeof s.season.month !== 'string' ||
        (s.tutorial != null && !Array.isArray(s.tutorial.claimed)) || typeof view.switches?.frozen !== 'boolean' ||
        !Object.keys(shelterResources).every(key => finite(s.resources?.[key]))) throw new Error('避难所状态结构变化');
    if (new Set(s.rooms.map(r => r.id)).size !== s.rooms.length || s.rooms.some(r => !Number.isSafeInteger(r.id) ||
        !Object.hasOwn(shelterRooms, r.type) || ![1,2,3].includes(r.level) || ![1,2,3].includes(r.width) ||
        !finite(r.builtAt) || !finite(r.stored) || !(r.upgradeAt === null || finite(r.upgradeAt)))) throw new Error('避难所房间规则变化');
    if (s.residents.some(p => !Number.isSafeInteger(p.id) || !(p.deadAt === null || finite(p.deadAt)) ||
        !(p.away === null || typeof p.away === 'object') || !finite(p.adultAt)) ||
        s.births.some(b => !finite(b.dueAt))) throw new Error('避难所居民数据不完整');
    if(s.handies!==undefined && (!Array.isArray(s.handies) || s.handies.some(h=>!Number.isSafeInteger(h?.floor) || h.floor<0)) ||
        s.handies?.length && s.rooms.some(r=>!Number.isSafeInteger(r.floor) || r.floor<0))throw new Error('避难所机器人楼层无法核对');
    const multiplier = r => [0,1,1.5,2.1][r.level];
    const built = s.rooms.filter(r => r.builtAt <= now);
    const perk = key => {
      const n = s.legacy?.perks?.[key] ?? 0;
      if (!Number.isInteger(n) || n < 0 || n > 10) throw new Error('避难所传承规则变化');
      return n;
    };
    const capacity=shelterCapacity(built,perk('storage')), {caps}=capacity;
    const atHome = s.residents.filter(p => p.away === null && p.deadAt === null);
    if (atHome.some(p => !finite(p.adultAt) || !finite(p.xp) || !finite(p.happiness) ||
        !['str','per','end','cha','int','agi','lck'].every(key => finite(p.stats?.[key])))) throw new Error('避难所居民数据不完整');
    const production = Object.fromEntries(Object.keys(shelterResources).map(k => [k,0]));
    const rooms = built.map(r => {
      const [stat,resource,base,batchBase] = shelterRooms[r.type];
      const workers = atHome.filter(p => p.roomId === r.id && p.adultAt <= now).slice(0,r.width*2);
      let rate = 0;
      if (resource && !r.incident && !r.unpowered && r.upgradeAt === null) {
        perk('production');
        rate = workers.reduce((n,p) => n+shelterWorkerRate(s,now,view.env,p,r),0);
        if (!finite(rate)) throw new Error('避难所活动规则变化');
        production[resource] += rate;
      }
      const batch = resource ? batchBase*r.width*multiplier(r) : 0;
      const projected=shelterStoredProjection(s,r,now,view.env,caps[resource]);
      return { id:r.id, resource, rate, batch, ...projected, automatic:(s.handies || []).some(h=>h.floor===r.floor), workers:workers.length };
    });
    const mouths = atHome.reduce((n,p) => n+(p.adultAt <= now ? 1 : .5),0);
    const power = built.reduce((n,r) => n+(['door','elevator','power'].includes(r.type) ? 0 :
      (shelterRooms[r.type][1] ? 1 : .5)*r.width*r.level),0);
    return { view, state:s, now, ...capacity, rooms, production, demand:{power,food:mouths,water:mouths} };
  }
  function shelterProductionWithout(m,ids) {
    const absent=new Set(ids),reserved=new Set(m.reservedResidents || []),s=m.state,projected={...m.production};
    const workers=s.residents.filter(p=>p.deadAt===null&&p.away===null&&p.adultAt<=m.now&&!reserved.has(p.id));
    // 按原生顺序和房间容量重算；多名家人一起离岗时，替补只能计入一次。
    for(const id of new Set(workers.filter(p=>absent.has(p.id)).map(p=>p.roomId))) {
      const room=s.rooms.find(r=>r.id===id),resource=room&&shelterRooms[room.type][1];
      if(!resource)continue;
      const occupants=workers.filter(p=>p.roomId===id);
      const output=people=>people.slice(0,room.width*2).reduce((n,p)=>n+shelterWorkerRate(s,m.now,m.view.env,p,room),0);
      projected[resource]+=output(occupants.filter(p=>!absent.has(p.id)))-output(occupants);
    }
    return projected;
  }
  function shelterDepartureSafe(m,ids) {
    const projected=shelterProductionWithout(m,ids);
    return Object.keys(m.demand).every(k=>projected[k]>=Math.min(m.production[k],m.demand[k]*1.2)-1e-9);
  }
  // 倒下记录仍在时保留恢复名额；不凭本地期限推断已经安葬，也不计入当前产出/消耗。
  function shelterRecoveringPopulation(s) {
    return s.residents.filter(p => p.deadAt !== null).length;
  }
  function shelterFamilyExpecting(s,a,b) {
    // 多对家庭可同住宿舍；只有父母匹配的待产记录才能抵消该家庭的感情预留。
    return a!==b&&[a,b].every(id=>Number.isSafeInteger(id)&&id>0)&&s.births.some(birth=>
      Array.isArray(birth.parents)&&birth.parents.length===2&&birth.parents.includes(a)&&birth.parents.includes(b));
  }
  function shelterDevelopmentPlan(m,target=14) {
    const s=m.state, now=m.now, candidates=[], notes=[], fmt=n=>Number(n.toFixed(1));
    const built=s.rooms.filter(r=>r.builtAt<=now), living=s.residents.filter(p=>p.deadAt===null);
    const population=living.length+s.births.length, recovering=shelterRecoveringPopulation(s);
    const construction=s.rooms.filter(r=>r.type!=='elevator'&&(r.builtAt>now||r.upgradeAt!==null));
    const storagePerk=s.legacy?.perks?.storage??0;
    const committedRooms=s.rooms.map(r=>r.builtAt<=now&&r.upgradeAt!==null?{...r,level:Math.min(3,r.level+1)}:r);
    const committed=shelterCapacity(committedRooms,storagePerk),committedCapacity=committed.populationCap;
    const capacityPending=committed.itemCap>m.itemCap||Object.keys(m.caps).some(k=>committed.caps[k]>m.caps[k]);
    const pairs=new Set(living.filter(p=>p.romance&&Number.isSafeInteger(p.romance.partnerId)&&
      !shelterFamilyExpecting(s,p.id,p.romance.partnerId)).map(p=>[p.id,p.romance.partnerId].sort((a,b)=>a-b).join(':')));
    const futureMouths=population+recovering+pairs.size;
    const requestedTarget=Number.isInteger(target)&&target>=2&&target<=200?target:null;
    const wanted=Math.max(requestedTarget??0,futureMouths);
    if(pairs.size)notes.push(`已有 ${pairs.size} 对培养感情的家庭，另预留 ${pairs.size} 个出生名额、床位及成年口粮；转为待产后不重复预留。`);
    if(recovering)notes.push(`倒下居民 ${recovering} 人仍在名单中，已预留恢复后的床位与成年口粮；记录移除后才释放预留，当前产出和消耗不包含他们。`);
    // Current demand already includes built rooms at their current level; reserve only unfinished additions.
    const committedPower=construction.reduce((n,r)=>n+(['door','elevator','power'].includes(r.type)?0:
      (shelterRooms[r.type][1]?1:.5)*r.width*(r.builtAt>now?r.level:r.level<3?1:0)),0);
    const demand={power:m.demand.power+committedPower,food:Math.max(m.demand.food,futureMouths),water:Math.max(m.demand.water,futureMouths)};
    const shortages=Object.keys(demand).filter(k=>m.production[k]<demand[k]*1.2-1e-9);
    const netScrap=m.production.scrap-6*m.production.parts;
    const active=r=>r.builtAt<=now&&r.upgradeAt===null&&!r.incident&&!r.unpowered;
    const idle=living.filter(p=>p.away===null&&p.adultAt<=now&&p.roomId===null&&!p.romance&&
      Number.isFinite(p.hp)&&p.hp>=.6*Math.round(100+(Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))-1)*(2+.5*p.stats.end)));
    // Layout is advisory-only: old or incomplete snapshots must not stop collection/staffing.
    let layout=Number.isInteger(s.depth)&&s.depth>=1&&s.depth<=1000&&s.rooms.every(r=>
      Number.isInteger(r.floor)&&r.floor>=0&&r.floor<=s.depth&&Number.isInteger(r.col)&&r.col>=0&&r.col+r.width<=8);
    if(layout)layout=!s.rooms.some((r,i)=>s.rooms.slice(i+1).some(o=>r.floor===o.floor&&r.col<o.col+o.width&&o.col<r.col+r.width));
    const spots=[];
    if(layout)for(let floor=1;floor<=s.depth;floor++) {
      if(!s.rooms.some(r=>r.floor===floor&&r.col<=1&&r.col+r.width>1))continue;
      let col=2,previous=null;
      while(col<8){const r=s.rooms.find(r=>r.floor===floor&&r.col<=col&&r.col+r.width>col);if(!r)break;
        if(r.col!==col){layout=false;break;}previous=r;col+=r.width;}
      if(col<8)spots.push({floor,col,previous});
    }
    if(!layout){spots.length=0;notes.push('布局资料不完整，暂不指定建造位置或判断是否需要下挖；领取与人员管理照常。');}
    else notes.push(spots.length?`现有 ${spots.length} 层还有右侧可建空位，先利用空位；不必为扩建立即下挖。`:'现有楼层没有可接续建造的空位。');
    if(construction.length)notes.push(`施工或升级 ${construction.length}/2 项；未完成的宿舍容量已计入规划，避免重复扩容。`);
    if(committedPower>0)notes.push(`已在施工或升级的房间完工后还需 ${fmt(committedPower)} 电力/小时，已为这部分耗电预留供应。`);
    if(construction.some(r=>r.type==='power'))notes.push('在建或升级中的发电站尚未提前计入新增产能，完工后按实际人员重算，先核对结果再决定是否继续扩建。');
    if(shortages.includes('power'))notes.push('电力产出尚未覆盖现有及已开工房间完工后所需的 20% 供应余量，优先补足。');
    const mouthShortages=shortages.filter(k=>k!=='power');
    if(mouthShortages.length)notes.push(`${mouthShortages.map(k=>shelterResources[k]).join('、')}尚未覆盖外出居民归来、倒下居民恢复、现有儿童成年、待产及已配对人口所需的 20% 供应余量，优先补足。`);
    const awayAssigned=living.filter(p=>p.away!==null&&p.adultAt<=now&&built.some(r=>r.id===p.roomId&&['power','diner','water','scrap'].includes(r.type))).length;
    if(awayAssigned)notes.push(`${awayAssigned} 名外出居民仍登记在生产房间，原生调岗按记录占位，这些位置不能直接补员；当前不计他们的产出，归来或岗位释放后再核对空位。`);
    if(built.some(r=>r.incident||r.unpowered))notes.push('有房间因事件或停电停产，先恢复现有产能，再按正常产量重算扩建收益。');
    if(netScrap<=0)notes.push('工坊每生产 1 零件消耗 6 废料；当前废料净增不为正，不能按回收站毛产量推算攒料时间。');
    const assess=c=>{
      c.blocks??=[];c.cost??={scrap:0,parts:0};
      c.shortage=Object.fromEntries(Object.entries(c.cost).map(([k,v])=>[k,Math.max(0,Math.ceil(v-s.resources[k]))]));
      if(c.kind!=='staff'&&c.kind!=='dig'&&construction.length>=2)c.blocks.push('先等一个施工名额空出');
      if(c.kind!=='staff') {
        const limits=Object.entries(c.cost).filter(([k,v])=>v>m.caps[k]);
        if(limits.some(([k,v])=>v>committed.caps[k]))c.blocks.push('所需资源超过当前及已开工工程完工后的库存容量，先扩仓');
        else if(limits.length)c.blocks.push('先等已开工工程完工，所需库存容量尚未生效');
      }
      c.saveHours=c.shortage.scrap>0&&netScrap>0&&c.cost.scrap<=m.caps.scrap?c.shortage.scrap/netScrap:null;
      candidates.push(c);
    };
    const powerCheck=extra=>extra>0&&m.production.power<(demand.power+extra)*1.2-1e-9?['扩建后电力余量不足，先补发电']:[];
    const vacancy=type=>built.filter(r=>r.type===type&&active(r)).reduce((n,r)=>n+Math.max(0,r.width*2-
      living.filter(p=>p.adultAt<=now&&p.roomId===r.id).length),0);
    const labels=type=>shelterBuildRules[type][0];
    const build=(type,priority,benefit)=>{
      if(!layout||!spots.length)return;
      const [label,base,unlock]=shelterBuildRules[type];
      const spot=spots.find(p=>p.previous?.type===type&&p.previous.level===1&&p.previous.width<3&&active(p.previous))||spots[0];
      const cells=s.rooms.filter(r=>r.type===type).reduce((n,r)=>n+r.width,0);
      const extra=shelterRooms[type][1]?type==='power'?0:1:.5;
      const blocks=powerCheck(extra);
      if(m.view.progress.level<unlock)blocks.push(`避难所 ${unlock} 级解锁`);
      assess({kind:'build',type,priority,floor:spot.floor,col:spot.col,hours:1/6,
        title:`第 ${spot.floor} 层右侧新建一格${label}`,cost:{scrap:Math.ceil(base*(1+.2*cells)),parts:0},benefit:`${benefit}；施工约 10 分钟`,blocks});
    };
    const upgrade=(r,priority,benefit)=>{
      if(r.level>=3||!active(r))return;
      const next=r.level+1,hours=r.width*(next===2?1:3),resource=shelterRooms[r.type][1];
      const row=m.rooms.find(x=>x.id===r.id),extra=resource?r.type==='power'?0:r.width:.5*r.width;
      const blocks=powerCheck(extra), outages=[];
      for(const k of Object.keys(demand)) {
        const left=m.production[k]-(resource===k?row.rate:0),need=Math.max(0,demand[k]-left)*hours+2*demand[k];
        if(s.resources[k]<need)outages.push(`${shelterResources[k]}需至少 ${Math.ceil(need)} 库存（含两小时余量）`);
      }
      if(outages.length)blocks.push(`停产期间${outages.join('、')}`);
      if(resource==='parts'&&s.resources.scrap<6*row.rate*hours)blocks.push('工坊废料供应不足，实际增产待核对');
      assess({kind:'upgrade',type:r.type,id:r.id,priority,hours,title:`${Number.isInteger(r.floor)?`第 ${r.floor} 层` : ''}${labels(r.type)}升至 ${next} 级`,
        cost:{scrap:Math.ceil(shelterBuildRules[r.type][1]*r.width*(next===2?2.5:6)),parts:next===3?15*r.width:0},
        benefit:`${benefit}；整间施工 ${hours} 小时${resource?'，期间停产':''}`,blocks});
    };
    for(const type of ['power','diner','water','scrap']) {
      const resource=shelterRooms[type][1],deficit=shortages.includes(resource),priority=deficit?10:resource==='scrap'?50:90;
      if(!deficit&&resource!=='scrap')continue;
      const vacancies=vacancy(type);
      if(vacancies)assess({kind:'staff',type,priority:deficit?5:15,title:`先补现有${labels(type)}岗位`,
        benefit:`已有 ${vacancies} 个空岗；${idle.length?`可先评估 ${idle.length} 名健康闲置成人`:'暂无可直接安排的健康闲置成人，先评估调岗或等待孩子成年'}，不用先造新房`,blocks:[]});
      if(!vacancies&&idle.length) {
        const hypothetical={type,width:1,level:1,builtAt:0,upgradeAt:null,incident:null,unpowered:false};
        const gain=idle.map(p=>shelterWorkerRate(s,now,m.view.env,p,hypothetical)).sort((a,b)=>b-a).slice(0,2).reduce((n,v)=>n+v,0);
        build(type,priority,`安排现有闲置成人后约增加 ${fmt(gain)} ${shelterResources[resource]}/小时；空房本身不增产`);
      }
      if(!vacancies&&!idle.length&&deficit&&!built.some(r=>r.type===type))
        build(type,priority,'尚无可直接安排的健康闲置成人，先确认调岗人选；建成空房不会增加产量');
      const upgrades=built.filter(r=>r.type===type&&active(r)&&r.level<3).map(r=>{
        const rate=m.rooms.find(x=>x.id===r.id).rate,gain=rate*([0,1,1.5,2.1][r.level+1]/[0,1,1.5,2.1][r.level]-1);
        return {r,gain};}).filter(x=>x.gain>0).sort((a,b)=>b.gain/b.r.width-a.gain/a.r.width);
      if(upgrades.length){const {r,gain}=upgrades[0];upgrade(r,priority+1,`按当前人员约增加 ${fmt(gain)} ${shelterResources[resource]}/小时`);}
    }
    if(committedCapacity<wanted) {
      const benefit=`人口容量增加 ${Math.min(200,committedCapacity+4)-committedCapacity}，当前及施工后容量 ${m.populationCap}/${committedCapacity}，规划至少 ${wanted}；不加快培养感情`;
      build('quarters',shortages.length?65:30,benefit);
      const room=built.filter(r=>r.type==='quarters'&&active(r)&&r.level<3).sort((a,b)=>a.level-b.level||a.width-b.width)[0];
      if(room)upgrade(room,shortages.length?66:31,`人口容量增加 ${Math.min(200,committedCapacity+2*room.width)-committedCapacity}；不加快培养感情`);
    }
    const full=Object.keys(m.caps).filter(k=>s.resources[k]>=.9*m.caps[k]&&m.production[k]>0);
    const equipmentFull=s.items.length>=.9*m.itemCap;
    if(full.length||equipmentFull) {
      const afterFull=full.filter(k=>s.resources[k]>=.9*committed.caps[k]),afterEquipmentFull=equipmentFull&&s.items.length>=.9*committed.itemCap;
      const pending=full.filter(k=>committed.caps[k]>m.caps[k]).map(k=>`${shelterResources[k]} ${m.caps[k]}→${committed.caps[k]}`);
      if(equipmentFull&&committed.itemCap>m.itemCap)pending.push(`装备 ${m.itemCap}→${committed.itemCap}`);
      notes.push(`${[...full.map(k=>shelterResources[k]),...(equipmentFull?['装备']:[])].join('、')}当前接近满仓。`);
      if(pending.length)notes.push(`已开工工程完工后的容量：${pending.join('、')}（当前→完工后）；尚未生效，领取仍按当前容量。`);
      if(!afterFull.length&&!afterEquipmentFull)notes.push('先等现有工程完工，可缓解当前满仓压力，暂不建议重复扩仓；期间留意库存变化。');
      else {
        notes.push(`${construction.length?'完工后仍有':''}${[...afterFull.map(k=>shelterResources[k]),...(afterEquipmentFull?['装备']:[])].join('、')}接近满仓，可比较先消费库存与继续扩仓。`);
        const storageGain=cells=>{
          const next=shelterCapacity(committedRooms,storagePerk,cells);
          return `${capacityPending?'在已开工工程完工后的基础上，':''}容量增加：${Object.keys(m.caps).map(k=>`${shelterResources[k]} ${next.caps[k]-committed.caps[k]}`).join('、')}、装备 ${next.itemCap-committed.itemCap}；增加容量不会直接产生资源`;
        };
        build('storage',20,storageGain(1));
        const room=built.filter(r=>r.type==='storage'&&active(r)&&r.level<3).sort((a,b)=>a.level-b.level||a.width-b.width)[0];
        if(room)upgrade(room,21,storageGain(room.width));
      }
    }
    // 升级方案是备选项：先说明推进其中一项所需的最小零件缺口，不把费用累加。
    const partsShortages=candidates.filter(c=>c.kind==='upgrade'&&c.shortage.parts>0).map(c=>c.shortage.parts);
    if(partsShortages.length) {
      const needed=Math.min(...partsShortages),feed=6*needed,workshops=s.rooms.filter(r=>r.type==='workshop');
      notes.push(`备选升级至少还缺 ${needed} 零件；先选定一项，其他方案的零件需求不累加。工坊每生产 1 零件消耗 6 废料，补足这部分至少另外消耗 ${feed} 废料，须与升级、建造费用分别预留。`);
      if(s.resources.scrap<feed)notes.push(`仅这部分零件的供料废料不足，尚差 ${Math.ceil(feed-s.resources.scrap)}；先保证基础供应和回收净产量。`);
      if(m.production.parts>0)notes.push(`当前工坊约 ${fmt(m.production.parts)} 零件/小时；在持续供料和收取、产量不变时，补足至少约需 ${(needed/m.production.parts).toFixed(1)} 小时。已有房间先继续生产，不为这笔需求重复建造。`);
      else if(workshops.some(r=>r.builtAt>now||r.upgradeAt!==null))notes.push('已有工坊正在施工或升级，先等现有工程完工，再核对值班人员和产量。');
      else if(workshops.some(active)) {
        const vacancies=vacancy('workshop');
        if(vacancies)assess({kind:'staff',type:'workshop',priority:25,title:'先补现有工坊岗位',
          benefit:`已有 ${vacancies} 个空岗，先评估智力高的健康成人；每生产 1 零件消耗 6 废料，工坊人员由你安排`,blocks:[]});
        else notes.push('工坊岗位仍被外出成人占用，等待归来或手动释放岗位后再核对，不把占位当空岗。');
      } else if(workshops.length)notes.push('先恢复现有工坊的事件或停电，再核对产量，不重复建造。');
      else {
        const hypothetical={type:'workshop',width:1,level:1,builtAt:0,upgradeAt:null,incident:null,unpowered:false};
        const gain=idle.map(p=>shelterWorkerRate(s,now,m.view.env,p,hypothetical)).sort((a,b)=>b-a).slice(0,2).reduce((n,v)=>n+v,0);
        build('workshop',25,gain>0?`安排现有闲置成人后约产 ${fmt(gain)} 零件/小时，同时消耗 ${fmt(6*gain)} 废料/小时；人员由你安排`:
          '先确认智力高的值班人选和废料供应；空工坊不会生产零件，人员由你安排');
      }
    }
    const homeHurt=living.filter(p=>{
      const health=p.away===null?shelterHealth(p):null;
      return health&&health.hp<health.max;
    });
    if(homeHurt.length&&s.resources.stimpak<1) {
      const medbays=s.rooms.filter(r=>r.type==='medbay');
      notes.push(`在家 ${homeHurt.length} 名伤员且治疗针不足 1 支，先准备医疗供应；医务室有人值班时伤员恢复更快，岗位和治疗由你安排。`);
      if(m.rooms.some(r=>r.resource==='stimpak'&&r.stored+1e-9>=r.batch))
        notes.push('医务室已存整批治疗针，先回房间核对领取状态，领取后再核对库存和伤员；无需为这次缺针重复建造。');
      else if(m.production.stimpak>0)
        notes.push(`当前医务室约 ${fmt(m.production.stimpak)} 治疗针/小时，先维持生产并按整批收取；治疗效果和伤员恢复时间以网页为准，不重复建造。`);
      else if(medbays.some(active)) {
        const vacancies=vacancy('medbay');
        if(vacancies)assess({kind:'staff',type:'medbay',priority:18,title:'先补现有医务室岗位',
          benefit:`已有 ${vacancies} 个空岗，先评估智力高的健康成人，保住食物、净水和电力供应；医务室人员由你安排`,blocks:[]});
        else notes.push('医务室岗位仍被外出成人占用，等待归来或手动释放岗位后再核对，不把占位当空岗。');
      } else if(medbays.some(r=>r.builtAt>now||r.upgradeAt!==null))
        notes.push('已有医务室正在施工或升级，先等现有工程完工，再核对值班人员和产量。');
      else if(medbays.length)notes.push('先恢复现有医务室的事件或停电，再核对产量，不重复建造。');
      else {
        const hypothetical={type:'medbay',width:1,level:1,builtAt:0,upgradeAt:null,incident:null,unpowered:false};
        const gain=idle.map(p=>shelterWorkerRate(s,now,m.view.env,p,hypothetical)).sort((a,b)=>b-a).slice(0,2).reduce((n,v)=>n+v,0);
        build('medbay',18,gain>0?`安排现有闲置成人后约产 ${fmt(gain)} 治疗针/小时；人员由你安排`:
          '先确认智力高的健康值班人选并保住基础供应；空医务室不会生产治疗针，人员由你安排');
      }
    }
    if(Number.isInteger(s.depth)&&s.depth>=1&&s.depth<=1000) {
      const cost=Math.ceil(120*Math.pow(s.depth+1,1.4));
      if(s.digging&&Number.isFinite(s.digging.doneAt))notes.push(`正在下挖，约 ${Math.max(0,Math.ceil((s.digging.doneAt-now)/60000))} 分钟后完成，先等现有工程。`);
      else if(s.digging===null&&layout&&!spots.length)assess({kind:'dig',type:'elevator',priority:40,
        title:`向下扩至第 ${s.depth+1} 层`,cost:{scrap:cost,parts:0},benefit:'新增建造空间；下挖本身不增加废料产量，工期以网站确认为准',blocks:[]});
      else if(layout&&spots.length)notes.push(`下挖一层需 ${cost} 废料；目前有空位，暂缓这项开支。`);
    }
    candidates.sort((a,b)=>a.priority-b.priority||a.cost.scrap-b.cost.scrap);
    return {at:now,population,recovering,reservedBirths:pairs.size,requestedTarget,capacity:m.populationCap,committedCapacity,target:wanted,netScrap,notes,candidates:candidates.slice(0,8)};
  }
  function shelterDevelopmentText(plan) {
    const lines=[`人口 ${plan.population}/${plan.capacity}（含外出与待产），${plan.requestedTarget===null?'人口目标未设置':`设置目标 ${plan.requestedTarget}`}，规划容量至少 ${plan.target}；废料扣除工坊消耗后约 ${plan.netScrap.toFixed(1)}/小时。`,...plan.notes];
    for(const [i,c] of plan.candidates.entries()) {
      const price=c.kind==='staff'?'无需建造费用':`${c.cost.scrap} 废料${c.cost.parts?` + ${c.cost.parts} 零件`:''}`;
      const missing=Object.entries(c.shortage).filter(([,v])=>v>0).map(([k,v])=>`${v} ${shelterResources[k]}`);
      lines.push(`${i+1}. ${c.title}：${price}。${c.benefit}。${missing.length?`尚缺 ${missing.join('、')}。`:''}${
        c.saveHours!==null?`按当前净产量且持续收取、不再消费，废料约还需 ${c.saveHours.toFixed(1)} 小时。`:''}${
        c.blocks.length?`先决条件：${c.blocks.join('；')}。`:''}`);
    }
    if(!plan.candidates.length)lines.push('暂未发现必须立即投入的扩建；先保持生产，资料更新后重新评估。');
    lines.push('这些是备选方案，收益不能叠加；本面板只给建议，不自动建造、升级或下挖。');
    return lines.join('\n');
  }
  function shelterCollectProof(p,status,request,body) {
    if(p.kind!=='collect'||!Number.isInteger(status)||status<200||status>=300||body?.code==='retry'||body?.view?.vaultNo!==p.vaultNo||
      !/^[A-Za-z0-9-]{8,64}$/.test(request?.idempotencyKey||''))return null;
    const action=request.action,all=p.targets.length===1&&p.targets[0]==='all';
    if(!action||Object.keys(action).length!==(all?1:2)||action.type!==(all?'collect_all':'collect')||
      !all&&(p.targets.length!==1||action.roomId!==p.targets[0]))return null;
    let after;try{after=shelterModel(body.view);}catch{return null;}
    if(after.now<(p.before.serverTime??0)||after.state.stats.collected<=p.before.collected||
      !p.before.rooms.every(r=>after.state.rooms.some(x=>x.id===r.id&&x.stored<r.stored)))return null;
    return {key:request.idempotencyKey,vaultNo:p.vaultNo,collected:after.state.stats.collected,at:after.now};
  }
  function shelterRewardProof(p,status,request,body) {
    if(!['daily','season'].includes(p.kind)||!Number.isInteger(status)||status<200||status>=300||body?.code==='retry'||
      body?.view?.vaultNo!==p.vaultNo||typeof request?.idempotencyKey!=='string'||!/^[A-Za-z0-9-]{8,64}$/.test(request.idempotencyKey))return null;
    const daily=p.kind==='daily',action=request.action,target=daily?action?.index:action?.tier,
      period=daily?p.before.day:p.before.month;
    if(!action||Object.keys(action).length!==(daily?2:3)||action.type!==(daily?'claim_objective':'claim_season')||
      !daily&&action.premium!==false||!Number.isSafeInteger(target)||target<(daily?0:1)||!p.targets.includes(target))return null;
    let after;try{after=shelterModel(body.view);}catch{return null;}
    const state=after.state[p.kind],claimed=daily?state.claimed:state.claimedFree;
    if(after.now<(p.before.serverTime??0)||state[daily?'day':'month']!==period||!claimed.includes(target))return null;
    return {kind:p.kind,operationId:p.id,target,period,key:request.idempotencyKey,vaultNo:p.vaultNo,at:after.now};
  }
  function shelterRewardPeriodCurrent(kind,serverTime,readAt,now=Date.now()) {
    if(!['daily','season'].includes(kind))return true;
    if(![serverTime,readAt,now].every(Number.isFinite))return false;
    const start=new Date(serverTime+8*3600000),end=new Date(serverTime+Math.max(0,now-readAt)+8*3600000);
    if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime()))return false;
    const length=kind==='daily'?10:7;
    return start.toISOString().slice(0,length)===end.toISOString().slice(0,length);
  }
  function shelterRewardConfirmed(p,m) {
    if(!['daily','season'].includes(p.kind)||m.view.vaultNo!==p.vaultNo)return false;
    const daily=p.kind==='daily',period=daily?p.before.day:p.before.month,state=m.state[p.kind],
      claimed=state[daily?'day':'month']===period?(daily?state.claimed:state.claimedFree):[],
      proofs=Array.isArray(p.result?.rewardProofs)?p.result.rewardProofs:[];
    return p.targets.length>0&&p.targets.every(target=>claimed.includes(target)||proofs.some(proof=>
      proof?.kind===p.kind&&proof.operationId===p.id&&proof.target===target&&proof.period===period&&
      proof.vaultNo===p.vaultNo&&typeof proof.key==='string'&&/^[A-Za-z0-9-]{8,64}$/.test(proof.key)&&Number.isFinite(proof.at)&&
      proof.at>=(p.before.serverTime??0)&&proof.at<=m.now));
  }
  function shelterExplorerCandidates(m) {
    const s=m.state,ready=[],notes=[],positive=x=>Number.isSafeInteger(x)&&x>0;
    const normalize=x=>String(x??'').normalize('NFKC').replace(/\s+/g,' ').trim();
    if(!Array.isArray(s.explorers))return {ready,notes:['探险资料不完整，本轮仍可处理其他避难所任务。']};
    if(s.explorers.some(e=>!e||!positive(e.id)||!positive(e.residentId))||
      new Set(s.explorers.map(e=>e.id)).size!==s.explorers.length||
      new Set(s.explorers.map(e=>e.residentId)).size!==s.explorers.length)
      return {ready,notes:['探险编号或人员对应不唯一，保留归来奖励。']};
    for(const e of s.explorers) {
      if(!Number.isFinite(e.returnAt)||e.returnAt>m.now)continue;
      const people=s.residents.filter(p=>p.id===e.residentId),p=people[0],loot=e.loot;
      if(people.length!==1||p.deadAt!==null||p.away?.kind!=='explore'||p.adultAt>m.now)continue;
      if(typeof p.name!=='string'||!normalize(p.name)||s.residents.filter(o=>normalize(o.name)===normalize(p.name)).length!==1||
        !Number.isFinite(e.startedAt)||e.startedAt<0||e.returnAt<e.startedAt||
        !Number.isSafeInteger(e.tier)||e.tier<0||typeof e.abyss!=='boolean'||
        !Number.isFinite(e.stimpaks)||e.stimpaks<0||!loot||
        !['scrap','parts','stimpak'].every(k=>Number.isFinite(loot[k])&&loot[k]>=0)||!Array.isArray(loot.items)||
        Object.keys(loot).some(k=>!['scrap','parts','stimpak','items'].includes(k))) {
        notes.push('归来探险的人员或背包资料无法完整核对，保留奖励。');continue;
      }
      const zone=['锈蚀街区','沉没港口','晶体平原','方舟残骸','静默高架'][e.tier]||`深渊裂谷 第 ${e.tier-4} 段`;
      ready.push({id:e.id,residentId:p.id,title:normalize(`${p.name} · ${e.abyss?'深渊 ':''}${zone}`),
        before:{id:e.id,residentId:p.id,startedAt:e.startedAt,returnAt:e.returnAt},
        // Conservative capacity reservation covers both loot and any unused carried stimpaks.
        reward:{scrap:Math.ceil(loot.scrap),parts:Math.ceil(loot.parts),stimpak:Math.ceil(loot.stimpak+e.stimpaks)},items:loot.items.length});
    }
    return {ready,notes};
  }
  function shelterExplorerReleased(p,m) {
    return m.view.vaultNo===p.vaultNo&&Array.isArray(m.state.explorers)&&
      m.state.explorers.every(e=>e&&Number.isSafeInteger(e.id)&&e.id!==p.targets[0])&&
      m.state.residents.filter(r=>r.id===p.targets[1]).length===1&&
      m.state.residents.some(r=>r.id===p.targets[1]&&r.away===null&&r.deadAt===null);
  }
  function shelterExplorerConfirmed(p,m) {
    // A successful response cannot make a stale listing safe to claim again as a new operation.
    if(m.view.vaultNo!==p.vaultNo||m.now<(p.before.serverTime??0)||!Array.isArray(m.state.explorers)||
      !m.state.explorers.every(e=>e&&Number.isSafeInteger(e.id)&&e.id>0&&e.id!==p.targets[0]))return false;
    const proof=p.result?.proof;
    return shelterExplorerReleased(p,m)||proof?.kind==='explore'&&proof.vaultNo===p.vaultNo&&
      proof.explorerId===p.targets[0]&&proof.residentId===p.targets[1]&&Number.isFinite(proof.at)&&
      proof.at>=(p.before.serverTime??0)&&proof.at<=m.now&&/^[A-Za-z0-9-]{8,64}$/.test(proof.key||'');
  }
  function shelterExplorerProof(p,status,request,body) {
    if(p.kind!=='explore'||!Number.isInteger(status)||status<200||status>=300||body?.code==='retry'||
      !/^[A-Za-z0-9-]{8,64}$/.test(request?.idempotencyKey||'')||request?.action?.type!=='explore_claim'||
      request.action.explorerId!==p.targets[0]||Object.keys(request.action).length!==2)return null;
    let m;try{m=shelterModel(body.view);}catch{return null;}
    if(m.now<(p.before.serverTime??0)||!shelterExplorerReleased(p,m))return null;
    return {kind:'explore',key:request.idempotencyKey,vaultNo:p.vaultNo,explorerId:p.targets[0],residentId:p.targets[1],at:m.now};
  }
  function shelterPendingWait(p,m) {
    const data={kind:p.kind,reason:'result-unconfirmed',snapshotAt:m.now,requestSnapshotAt:p.before.serverTime??null};
    if(p.kind!=='explore'){
      if(m.now<(p.before.serverTime??0)){
        data.reason='snapshot-before-request';return {note:'避难所快照时间早于原操作，等待数据同步',data};
      }
      return {note:'避难所操作仍未确认',data};
    }
    const proof=p.result?.proof,hasSuccessProof=Boolean(proof?.kind==='explore'&&proof.vaultNo===p.vaultNo&&
      proof.explorerId===p.targets[0]&&proof.residentId===p.targets[1]&&Number.isFinite(proof.at)&&
      proof.at>=(p.before.serverTime??0)&&/^[A-Za-z0-9-]{8,64}$/.test(proof.key||''));
    const readable=Array.isArray(m.state.explorers)&&m.state.explorers.every(e=>e&&Number.isSafeInteger(e.id)&&e.id>0);
    Object.assign(data,{hasSuccessProof,proofAt:hasSuccessProof?proof.at:null,explorerListReadable:readable,
      explorerListed:readable?m.state.explorers.some(e=>e.id===p.targets[0]):null});
    let note='探险原领取结果仍未确认';
    if(m.now<(p.before.serverTime??0)){data.reason='snapshot-before-request';note='探险快照时间早于原操作，等待数据同步';}
    else if(!readable){data.reason='explorer-list-unavailable';note='探险列表暂不可核对，等待资料恢复';}
    else if(data.explorerListed){data.reason='explorer-still-listed';note=hasSuccessProof?
      '探险已收到原领取成功凭据，当前列表仍含原探险':`${note}，当前列表仍含原探险`;}
    else if(hasSuccessProof&&proof.at>m.now){data.reason='snapshot-before-proof';note='探险快照时间早于原领取成功凭据，等待数据同步';}
    return {note,data};
  }
  function shelterHealth(p) {
    if(![p.hp,p.xp,p.stats?.end].every(n=>Number.isFinite(n)&&n>=0))return null;
    const max=Math.round(100+(Math.min(50,1+Math.floor(Math.sqrt(Math.max(0,p.xp)/3)))-1)*(2+.5*p.stats.end));
    return Number.isFinite(max)&&max>0&&p.hp<=max?{hp:p.hp,max,critical:p.hp<max/2}:null;
  }
  function shelterOperations(m) {
    const s=m.state,now=m.now,messages=[],urgent=[],events=[],counts={incidents:0,unpowered:0,lowSupply:0,awayHurt:0,returned:0,down:0,
      homeHurt:0,homeCritical:0,homeDown:0,healthUnknown:0,relief:0,romancePaused:0};
    const future=at=>{if(Number.isFinite(at)&&at>now)events.push(at-now);};
    const roomLabel=r=>`${Number.isInteger(r.floor)?`第 ${r.floor} 层` : ''}${shelterBuildRules[r.type]?.[0]||'房间'}`;
    if(m.view.reliefAvailable===true) {
      counts.relief=1;urgent.push('网页已开放“物资快耗尽了，向方舟求援”，可回避难所核对并领取；补给数量和冷却以网页结果为准。');
    }
    const explorerIds=new Set((Array.isArray(s.explorers)?s.explorers:[]).filter(e=>e&&Number.isSafeInteger(e.residentId)).map(e=>e.residentId));
    for(const p of s.residents.filter(p=>p.away===null&&p.deadAt!==null&&!explorerIds.has(p.id))) {
      counts.homeDown++;
      const name=typeof p.name==='string'?p.name:'居民',deadline=p.deadAt+86400000,remaining=deadline-now;
      urgent.push(`${name}在家已倒下；${remaining>0?`按网页24小时期限约剩 ${Math.ceil(remaining/60000)} 分钟，请在居民详情核对废料救回。`:
        '已到网页提示的24小时期限，请在居民详情核对当前状态和可用操作。'}`);
      future(deadline);
    }
    for(const p of s.residents.filter(p=>p.away===null&&p.deadAt===null)) {
      const health=shelterHealth(p),name=typeof p.name==='string'?p.name:'居民';
      if(!health){counts.healthUnknown++;continue;}
      if(health.hp>=health.max)continue;
      counts.homeHurt++;if(health.critical)counts.homeCritical++;
      (health.critical?urgent:messages).push(`${name}在家血量 ${Number(health.hp.toFixed(1))}/${health.max}${health.critical?'，不足一半':''}；${
        s.resources.stimpak>=1?'可在居民详情核对“用治疗针”按钮。':'治疗针不足，可检查医务室的值班和产出。'}`);
    }
    if(counts.healthUnknown)messages.push(`${counts.healthUnknown} 名在家居民的血量资料不完整，未按健康状态判断；请核对居民详情。`);
    const romances=new Set();
    for(const p of s.residents) {
      if(!Number.isSafeInteger(p.romance?.partnerId))continue;
      const other=s.residents.find(o=>o.id===p.romance.partnerId);
      if(!other||other.id===p.id)continue;
      const key=[p.id,other.id].sort((a,b)=>a-b).join(':');if(romances.has(key))continue;romances.add(key);
      const pair=[p,other],reasons=[],room=s.rooms.find(r=>r.id===p.roomId);
      if(pair.some(o=>o.away!==null||o.deadAt!==null))reasons.push('有人外出或倒下');
      if(pair.some(o=>o.adultAt>now))reasons.push('有人尚未成年');
      if(pair.some(o=>Number.isFinite(o.happiness)&&o.happiness<50))reasons.push('两人的心情都需要达到 50');
      if(pair.some(o=>o.familyCooldownUntil>now))reasons.push('生育冷却尚未结束');
      if(!room||room.type!=='quarters'||p.roomId!==other.roomId)reasons.push('两人需要在同一间宿舍');
      else {
        if(room.builtAt>now)reasons.push('宿舍尚未建成');
        if(room.incident)reasons.push('宿舍事件尚未处理');
      }
      if(reasons.length){counts.romancePaused++;messages.push(`${p.name}与${other.name}感情暂停：${reasons.join('；')}。保留现有关系，请核对居民详情。`);}
    }
    for(const r of s.rooms) {
      future(r.builtAt);future(r.upgradeAt);future(r.craft?.doneAt);
      if(r.incident) {
        counts.incidents++;
        const adults=s.residents.filter(p=>p.roomId===r.id&&p.away===null&&p.deadAt===null&&p.adultAt<=now).length;
        messages.push(`${roomLabel(r)}发生事件，已停产；${adults?`${adults} 名成人在场处理，注意血量`:'没有成人在场，需安排人员处理以免蔓延'}。`);
      }
      if(r.unpowered){counts.unpowered++;messages.push(`${roomLabel(r)}停电，先恢复电力供应。`);}
    }
    future(s.digging?.doneAt);
    for(const k of Object.keys(m.demand)) {
      const drain=m.demand[k]-m.production[k];
      if(drain>0) {
        const hours=s.resources[k]/drain;
        messages.push(`${shelterResources[k]}净缺 ${drain.toFixed(1)}/小时，按当前消耗库存约可撑 ${hours.toFixed(1)} 小时。`);
        if(hours<=2){counts.lowSupply++;events.push(Math.max(60000,hours*1800000));}
      }
    }
    for(const r of s.rooms.filter(r=>r.builtAt>now||r.upgradeAt!==null)) {
      const at=r.builtAt>now?r.builtAt:r.upgradeAt;
      if(Number.isFinite(at))messages.push(`${roomLabel(r)}${r.builtAt>now?'施工':'升级'}${at>now?`约 ${Math.ceil((at-now)/60000)} 分钟后完成`:'已到预计完成时间，等待网站结算'}。`);
    }
    if(s.digging&&Number.isFinite(s.digging.doneAt))messages.push(`下挖${s.digging.doneAt>now?`约 ${Math.ceil((s.digging.doneAt-now)/60000)} 分钟后完成`:'已到预计完成时间'}。`);
    if(!Array.isArray(s.explorers)||!Array.isArray(s.quests))messages.push('废土资料不完整，尚不能核对全部探险和小队返程。');
    if(Array.isArray(s.explorers))for(const e of s.explorers) {
      if(!e||!Number.isSafeInteger(e.residentId))continue;
      const p=s.residents.find(p=>p.id===e.residentId);if(!p)continue;
      const name=typeof p.name==='string'?p.name:'探险居民';
      future(e.returnAt);
      if(p.deadAt!==null){counts.down++;urgent.push(`${name}探险中倒下，需在废土页核对救援；不会自动花废料救回。`);continue;}
      if(Number.isFinite(e.returnAt)&&e.returnAt<=now){counts.returned++;messages.push(`${name}已归来，去废土页领取后可重新安排岗位。`);continue;}
      if(shelterHealth(p)?.critical) {
        counts.awayHurt++;urgent.push(`${name}探险血量不足一半，携带治疗针 ${Number.isFinite(e.stimpaks)?e.stimpaks:'未知'} 支；请评估召回，返程仍需时间。`);
      }
      if(Number.isFinite(e.returnAt)&&e.returnAt>now)messages.push(`${name}约 ${Math.ceil((e.returnAt-now)/60000)} 分钟后归来。`);
    }
    if(Array.isArray(s.quests))for(const q of s.quests) {
      if(!q)continue;future(q.returnAt);if(q.status==='active')future(q.nextStageAt);
      if(Number.isFinite(q.returnAt)&&q.returnAt<=now){counts.returned++;messages.push(`废土小队${q.status==='failed'?'带伤':'完成任务后'}已归来，去废土页领取并释放队员。`);}
      else if(Number.isFinite(q.returnAt))messages.push(`废土小队约 ${Math.ceil((q.returnAt-now)/60000)} 分钟后归来。`);
    }
    if(counts.incidents||counts.unpowered||counts.lowSupply||counts.awayHurt||counts.down||counts.homeCritical||counts.homeDown||counts.relief||counts.romancePaused)events.push(5*60000);
    const all=[...urgent,...messages];
    if(!all.length)all.push('当前已知状态没有紧急供应或停产提醒；有施工、返程等时间点时会提前预约。');
    return {messages:all.length>24?[...all.slice(0,23),`另有 ${all.length-23} 条提醒，请回避难所检查。`]:all,events,counts};
  }
  function readShelter() {
    if (shelterController || Date.now() < shelterReadAt || !navigator.onLine) return;
    const generation = shelterGeneration;
    const current = () => generation === shelterGeneration && enabled && shelterEnabled && active && inShelter() && !accountStopReason();
    shelterController = new AbortController();
    say('核对避难所库存、岗位与原操作');
    fetch('/api/shelter', { cache:'no-store', credentials:'same-origin',
      signal:AbortSignal.any([shelterController.signal,AbortSignal.timeout(12000)]) })
      .then(async response => {
        if (!current()) return;
        if(shelterReload()){cancelShelterRead();cancelQueued();schedule();return;}
        if ([401,403,429].includes(response.status) || response.redirected && new URL(response.url).pathname === '/') {
          pauseAccount('避难所状态返回登录、权限或限流异常'); return;
        }
        if (!response.ok) { finishShelter(null,`避难所读取失败（HTTP ${response.status}），稍后检查`); return; }
        let view;
        try { view = await response.json(); }
        catch (error) {
          if (error.name !== 'SyntaxError') throw error;
          if (current()) finishShelter(null,'避难所响应解析失败，稍后重新读取');
          return;
        }
        if (!current()) return;
        if(shelterReload()){cancelShelterRead();cancelQueued();schedule();return;}
        const model = shelterModel(view);
        if (shelterState.vaultNo && shelterState.vaultNo !== view.vaultNo || shelterPending && shelterPending.vaultNo !== view.vaultNo) {
          pauseAccount('避难所账号已切换，请核对原操作记录'); return;
        }
        shelterRead = { model, at:Date.now() };
        if (!shelterState.vaultNo) saveShelter({ ...shelterState, vaultNo:view.vaultNo });
      }).catch(error => {
        if (!current()) return;
        if(shelterRetryChange(error))return;
        try{
          if (['TypeError','TimeoutError','AbortError'].includes(error.name)) finishShelter(null,'避难所读取中断，稍后检查');
          else pauseShelter('避难所状态无法核对，已暂停并保留原记录');
        }catch(error){if(!shelterRetryChange(error))pauseShelter('避难所记录无法保存，已暂停并保留原记录');}
      })
      .finally(() => { if (generation === shelterGeneration) { shelterController = null; schedule(); } });
  }
  const staffRoomTypes = ['power','diner','water','scrap'];
  const staffRoomNames = { power:'发电站',diner:'餐厅',water:'净水站',scrap:'废料回收站',quarters:'宿舍' };
  function shelterNameUnique(s,p) {
    const normalized = name => name.normalize('NFKC').replace(/\s+/g,' ').trim();
    return s.residents.filter(other => normalized(other.name) === normalized(p.name)).length === 1;
  }
  function shelterGearPlan(m,pool) {
    if (!shelterGear) return null;
    const s = m.state, used = new Set(s.residents.flatMap(p => [p.weaponId,p.outfitId]));
    if (s.residents.some(p => ![p.weaponId,p.outfitId].every(id => id === null || Number.isSafeInteger(id) && id > 0)) ||
        new Set(s.items.map(item => item.id)).size !== s.items.length) throw new Error('装备归属无法核对');
    const outfits = s.items.filter(item => item.slot === 'outfit' && !used.has(item.id));
    if (outfits.some(item => !Number.isSafeInteger(item.id) || item.id <= 0 || !objectState(item.bonus) ||
        Object.entries(item.bonus).some(([key,n]) => !['str','per','end','cha','int','agi','lck'].includes(key) || !Number.isFinite(n) || n < 0))) {
      throw new Error('服装属性无法核对');
    }
    const choices = [];
    for (const p of pool) {
      const room = s.rooms.find(r => r.id === p.roomId && staffRoomTypes.includes(r.type));
      if (!room || p.outfitId !== null && !s.items.some(item => item.id === p.outfitId && item.slot === 'outfit')) continue;
      const workers = s.residents.filter(other => other.roomId === room.id && other.deadAt === null && other.away === null && other.adultAt <= m.now);
      if (workers.indexOf(p) >= room.width*2) continue;
      const resource = shelterRooms[room.type][1], current = shelterWorkerRate(s,m.now,m.view.env,p,room);
      if (!current) continue;
      for (const item of outfits) {
        const gain = shelterWorkerRate(s,m.now,m.view.env,{...p,outfitId:item.id},room)-current;
        if (gain <= 1e-6) continue;
        const priority = Object.hasOwn(m.demand,resource) && m.production[resource] < m.demand[resource]*1.2 ? 2 : resource === 'scrap' ? 1 : 0;
        choices.push({kind:'equip',id:p.id,item:item.id,fromItem:p.outfitId,room:p.roomId,from:p.roomId,name:p.name,
          reason:`穿戴闲置服装，增加${shelterResources[resource]}产出`,gain,priority});
      }
    }
    return choices.sort((a,b) => b.priority-a.priority || (Math.abs(b.gain-a.gain) > 1e-6 ? b.gain-a.gain : 0) || a.id-b.id || a.item-b.item)[0] || null;
  }
  function shelterSwapSequences(a,b) {
    const move = (p,room) => ({id:p.id,room});
    if (a.room === null) return [[move(b,null),move(a,b.room)]];
    return [
      [move(b,a.room),move(a,b.room)],
      [move(a,null),move(b,a.room),move(a,b.room)],
      [move(b,null),move(a,b.room),move(b,a.room)]
    ];
  }
  // 模拟每一步的房间容量与供应；不能安全腾位的满员房间保留原安排。
  function shelterSwapProjection(m,moves,futureSupply = false) {
    const s = m.state, assigned = new Map(s.residents.map(p => [p.id,p.roomId])), projected = {...(m.actualProduction || m.production)};
    const demand = futureSupply && m.currentDemand ? m.currentDemand : m.demand;
    for (const move of moves) {
      const p = s.residents.find(p => p.id === move.id), old = s.rooms.find(r => r.id === assigned.get(move.id));
      const room = move.room === null ? null : s.rooms.find(r => r.id === move.room);
      if (!p || move.room !== null && (!room || !staffRoomTypes.includes(room.type) || room.builtAt > m.now ||
          room.incident || room.unpowered || room.upgradeAt !== null ||
          s.residents.filter(other => other.id !== p.id && other.deadAt === null && other.adultAt <= m.now && assigned.get(other.id) === room.id).length >= room.width*2)) return null;
      if (old && shelterRooms[old.type][1]) projected[shelterRooms[old.type][1]]-=shelterWorkerRate(s,m.now,m.view.env,p,old);
      if (room) projected[shelterRooms[room.type][1]]+=shelterWorkerRate(s,m.now,m.view.env,p,room);
      assigned.set(p.id,move.room);
      if (!Object.keys(demand).every(key => projected[key] >= demand[key]*1.2-1e-9)) return null;
    }
    return projected;
  }
  function shelterSwapStep(m,eligible) {
    let swap = shelterState.swap;
    if (!swap) return null;
    const validRoom = room => room === null || Number.isSafeInteger(room) && room > 0;
    if (!objectState(swap) || typeof swap.id !== 'string' || !Number.isFinite(swap.at) ||
        !(swap.futureSupply === undefined || typeof swap.futureSupply === 'boolean') ||
        !(swap.prepareFamily === undefined || Array.isArray(swap.prepareFamily) && swap.prepareFamily.length === 3 &&
          swap.prepareFamily.every(id => Number.isSafeInteger(id) && id > 0) && swap.prepareFamily[0] < swap.prepareFamily[1]) ||
        !Array.isArray(swap.people) || swap.people.length !== 2 || swap.people.some(p => !p || !Number.isSafeInteger(p.id) || p.id <= 0 || !validRoom(p.room)) ||
        swap.people[0].id === swap.people[1].id || swap.people[1].room === null || swap.people[0].room === swap.people[1].room ||
        !Array.isArray(swap.moves) || !shelterSwapSequences(...swap.people).some(sequence => JSON.stringify(sequence) === JSON.stringify(swap.moves)) ||
        !Number.isInteger(swap.step) || swap.step < 0 || swap.step > swap.moves.length) throw new Error('换位记录无法核对');
    if (swap.prepareFamily && JSON.stringify(swap.prepareFamily) !== JSON.stringify(m.prepareFamily)) {
      holdShelterStaff('原家庭的返宿舍条件已改变，取消剩余接替换位，保留当前岗位'); return null;
    }
    const matches = step => {
      const expected = new Map(swap.people.map(p => [p.id,p.room]));
      for (const move of swap.moves.slice(0,step)) expected.set(move.id,move.room);
      return swap.people.every(p => m.state.residents.some(current => current.id === p.id && current.roomId === expected.get(p.id)));
    };
    if (swap.step < swap.moves.length && matches(swap.step+1)) {
      swap = {...swap,step:swap.step+1}; saveShelter({...shelterState,swap});
    } else if (!matches(swap.step)) {
      holdShelterStaff('换位期间人员岗位已改变，本轮停止调整，保留现有安排'); return null;
    }
    if (swap.step === swap.moves.length) {
      saveShelter({...shelterState,swap:null});
      log.add('shelter-optimization','满员房间人员优化已完成',{steps:swap.moves.length}); return null;
    }
    if (!shelterOptimize || swap.people.some(p => {
      const current = m.state.residents.find(current => current.id === p.id);
      return !current || !eligible(current);
    }) || !shelterSwapProjection(m,swap.moves.slice(swap.step),swap.futureSupply)) {
      holdShelterStaff('换位所需供应、人员或房间条件已变化，本轮停止调整'); return null;
    }
    const move = swap.moves[swap.step], p = m.state.residents.find(p => p.id === move.id);
    return {id:p.id,room:move.room,from:p.roomId,name:p.name,
      reason:`${swap.prepareFamily ? '为原家庭返宿舍安排接替' : swap.futureSupply ? '补足未来供应，优化满员岗位' : '优化满员岗位'}（${swap.step+1}/${swap.moves.length}）`};
  }
  function planShelterSwap(m,pool) {
    const keys = Object.keys(m.demand), futureSupply = Boolean(m.currentDemand && keys.some(key => m.production[key] < m.demand[key]*1.2-1e-9));
    const demand = futureSupply ? m.currentDemand : m.demand;
    if (!shelterOptimize || !keys.every(key => (m.actualProduction || m.production)[key] >= demand[key]*1.2-1e-9)) return null;
    const gap = output => keys.reduce((n,key) => n+Math.max(0,m.demand[key]*1.2-output[key]),0);
    const beforeGap = gap(m.production);
    let best = null;
    const s = m.state, available = p => p.roomId === null || s.rooms.some(r => r.id === p.roomId && staffRoomTypes.includes(r.type) &&
      r.builtAt <= m.now && !r.incident && !r.unpowered && r.upgradeAt === null);
    const workers = pool.filter(available);
    const rooms = new Map(s.rooms.map(r => [r.id,r])), occupied = new Map(), rates = new Map();
    for (const p of s.residents) if (p.deadAt === null && p.adultAt <= m.now) occupied.set(p.roomId,(occupied.get(p.roomId)||0)+1);
    const rate = (p,room) => {
      if (!room || m.reservedResidents?.includes(p.id)) return 0;
      const key = `${p.id}:${room.type}:${room.level}`;
      if (!rates.has(key)) rates.set(key,shelterWorkerRate(s,m.now,m.view.env,p,room));
      return rates.get(key);
    };
    for (const a of workers) for (const b of workers) {
      if (a.id === b.id || b.roomId === null || a.roomId === b.roomId) continue;
      const target = rooms.get(b.roomId), source = rooms.get(a.roomId);
      if (occupied.get(target.id) !== target.width*2) continue;
      // 先筛最终收益，再模拟腾位。补未来供应时可少产废料，但不能扩大任何基础资源缺口。
      const change = {power:0,food:0,water:0,scrap:0};
      if (source) change[shelterRooms[source.type][1]]+=rate(b,source)-rate(a,source);
      change[shelterRooms[target.type][1]]+=rate(a,target)-rate(b,target);
      const scrap = change.scrap, basic = change.power+change.food+change.water;
      const after = Object.fromEntries(keys.map(key => [key,m.production[key]+change[key]])), supplyGain = beforeGap-gap(after);
      if (futureSupply ? supplyGain <= 1e-6 : !(scrap > 1 || Math.abs(scrap) < 1e-6 && basic > 1)) continue;
      if (!keys.every(key => after[key] >= (futureSupply ? Math.min(m.production[key],m.demand[key]*1.2) : m.demand[key]*1.2)-1e-9)) continue;
      const people = [a,b].map(p => ({id:p.id,room:p.roomId}));
      for (const moves of shelterSwapSequences(...people)) {
        if (!shelterSwapProjection(m,moves,futureSupply)) continue;
        if (!best || supplyGain > best.supplyGain+1e-6 || Math.abs(supplyGain-best.supplyGain) < 1e-6 &&
            (scrap > best.scrap+1e-6 || Math.abs(scrap-best.scrap) < 1e-6 &&
              (basic > best.basic+1e-6 || Math.abs(basic-best.basic) < 1e-6 && moves.length < best.moves.length))) {
          best = {people,moves,scrap,basic,supplyGain};
        }
      }
    }
    if (!best) return null;
    const swap = {id:crypto.randomUUID(),at:Date.now(),people:best.people,moves:best.moves,step:0,futureSupply,
      ...(m.prepareFamily ? {prepareFamily:m.prepareFamily} : {})};
    saveShelter({...shelterState,swap});
    log.add('shelter-optimization',futureSupply ? '开始满员岗位调整，补足未来供应' : '开始满员房间人员优化',
      {steps:swap.moves.length,scrapGain:best.scrap,futureSupply,supplyGain:best.supplyGain,
        ...(m.prepareFamily ? {prepareFamily:m.prepareFamily} : {})});
    return swap;
  }
  function rememberShelterFamilies(m) {
    const s = m.state, stored = shelterState.families || [];
    if (!Array.isArray(stored) || stored.some(f => !f || ![f.a,f.b,f.room].every(x => Number.isSafeInteger(x) && x > 0) || f.a === f.b) ||
        new Set(stored.flatMap(f => [f.a,f.b])).size !== stored.length*2) throw new Error('配对记录无法核对');
    let families = stored.filter(f => [f.a,f.b].every(id => {
      const p = s.residents.find(p => p.id === id);
      // 倒下仍可救回；只有居民记录消失或关系明确改变时才取消已记住的家庭。
      return p && (!p.romance || p.romance.partnerId === (id === f.a ? f.b : f.a));
    }));
    const candidates = s.residents.filter(p => p.romance).map(p => [p.id,p.romance.partnerId]);
    for (const child of s.residents) if (child.parents.length === 2) candidates.push(child.parents);
    for (const ids of candidates) {
      const [a,b] = ids.map(id => s.residents.find(p => p.id === id));
      if (!a || !b || a.id === b.id || a.roomId !== b.roomId || a.deadAt !== null || b.deadAt !== null ||
          a.away !== null || b.away !== null || a.adultAt > m.now || b.adultAt > m.now ||
          a.romance && a.romance.partnerId !== b.id || b.romance && b.romance.partnerId !== a.id) continue;
      const room = s.rooms.find(r => r.id === a.roomId && r.type === 'quarters');
      if (!room || families.some(f => [f.a,f.b].includes(a.id) || [f.a,f.b].includes(b.id))) continue;
      families.push({a:Math.min(a.id,b.id),b:Math.max(a.id,b.id),room:room.id});
    }
    families.sort((a,b) => a.a-b.a);
    if (JSON.stringify(families) !== JSON.stringify(stored)) saveShelter({...shelterState,families});
    return families;
  }
  const familyKey = (a,b) => [a,b].sort((x,y)=>x-y).join(':');
  function populationBudget(m,families,exclude = '') {
    const s = m.state, reserved = new Map();
    const add = (a,b) => { if (!shelterFamilyExpecting(s,a,b)) reserved.set(familyKey(a,b),[a,b]); };
    for (const p of s.residents) if (p.deadAt === null && p.romance) add(p.id,p.romance.partnerId);
    for (const f of families) {
      const pair = [f.a,f.b].map(id => s.residents.find(p => p.id === id));
      if (pair.every(p => p && p.deadAt === null && !(p.familyCooldownUntil > m.now)) && pair.some(p => p.roomId === f.room)) add(f.a,f.b);
    }
    const plan = shelterState.pair;
    if (plan && !plan.release) add(plan.a,plan.b);
    reserved.delete(exclude);
    const living = s.residents.filter(p => p.deadAt === null).length, recovering = shelterRecoveringPopulation(s);
    return {living,recovering,reserved,future:living+recovering+s.births.length+reserved.size,limit:Math.min(shelterPopulationTarget ?? 0,m.populationCap)};
  }
  function populationHousingSupply(m,families,pair) {
    const budget = populationBudget(m,families,familyKey(pair[0].id,pair[1].id)), future = budget.future+1;
    // 预留所有已安排家庭离岗后的产量，以及儿童、外出/倒下居民恢复和新生儿成年后的口粮。
    const absent = new Set([...budget.reserved.values()].flat().concat(pair.map(p => p.id)));
    const projected = shelterProductionWithout(m,absent);
    const demand = {...m.demand,food:future,water:future};
    return {production:projected,demand,reservedResidents:[...absent],
      allowed:future <= budget.limit && Object.keys(demand).every(k => m.state.resources[k] >= demand[k]*2)};
  }
  function populationCanHouse(m,families,pair) {
    const supply = populationHousingSupply(m,families,pair);
    return supply.allowed && Object.keys(supply.demand).every(k => supply.production[k] >= supply.demand[k]*1.2-1e-9);
  }
  function populationKinship(s) {
    const people = new Map(s.residents.map(p => [p.id,p])), cache = new Map();
    const ancestors = (id,path = new Set()) => {
      if (cache.has(id)) return cache.get(id);
      const p = people.get(id);
      if (!p || path.has(id) || ![0,2].includes(p.parents.length) || new Set(p.parents).size !== p.parents.length ||
          p.parents.some(parent => !Number.isSafeInteger(parent) || parent <= 0)) return null;
      const result = new Set([id]), next = new Set([...path,id]);
      for (const parent of p.parents) {
        const lineage = ancestors(parent,next);
        if (!lineage) { cache.set(id,null); return null; }
        for (const ancestor of lineage) result.add(ancestor);
      }
      cache.set(id,result); return result;
    };
    return (a,b) => {
      const left = ancestors(a.id), right = ancestors(b.id);
      return Boolean(left && right && ![...left].some(id => right.has(id)));
    };
  }
  function stopPopulationPlan(message) {
    saveShelter({...shelterState,pair:null}); shelterPopulationNote = message;
    log.add('shelter-population',message,{phase:'cancelled'}); holdShelterStaff(message);
  }
  function shelterPopulationPlan(m,families,{eligible,home,healthy},create = false) {
    if (shelterStaffMode !== 'population') return null;
    const s = m.state, blocks = shelterState.pairBlocks || [];
    if (!Array.isArray(blocks) || blocks.length > 200 || blocks.some(b => !b || ![b.a,b.b].every(id => Number.isSafeInteger(id) && id > 0) ||
        b.a === b.b || !Number.isFinite(b.until))) throw new Error('配对等待记录无法核对');
    const activeBlocks = blocks.filter(b => b.until > Date.now());
    if (activeBlocks.length !== blocks.length) saveShelter({...shelterState,pairBlocks:activeBlocks});
    let plan = shelterState.pair;
    const validRoom = id => id === null || Number.isSafeInteger(id) && id > 0;
    const roomUnchanged = (room,ids) => room?.type === 'quarters' && room.builtAt <= m.now && !s.births.some(b => b.roomId === room.id) &&
      !s.residents.some(p => p.deadAt === null && p.adultAt <= m.now && p.roomId === room.id && !ids.includes(p.id));
    const roomReady = (room,ids) => roomUnchanged(room,ids) && !room.incident && !room.unpowered && room.upgradeAt === null;
    const key = plan && familyKey(plan.a,plan.b);
    if (plan) {
      if (!objectState(plan) || ![plan.a,plan.b,plan.room].every(id => Number.isSafeInteger(id) && id > 0) || plan.a >= plan.b ||
          ![plan.fromA,plan.fromB].every(validRoom) || [plan.fromA,plan.fromB].includes(plan.room) ||
          !(plan.first===undefined || [plan.a,plan.b].includes(plan.first)) ||
          ![0,1,2].includes(plan.step) || !Number.isFinite(plan.at) || !(plan.waitAt === null || Number.isFinite(plan.waitAt)) ||
          !(plan.roomWaitAt == null || Number.isFinite(plan.roomWaitAt)) ||
          typeof plan.release !== 'boolean' || typeof plan.failed !== 'boolean') throw new Error('新配对计划无法核对');
      const pair = [plan.a,plan.b].map(id => s.residents.find(p => p.id === id)), room = s.rooms.find(r => r.id === plan.room);
      if (pair.some((p,i) => !p || p.deadAt !== null || p.romance && p.romance.partnerId !== [plan.b,plan.a][i])) {
        stopPopulationPlan('新配对人员或关系已变化，保留当前安排'); return null;
      }
      const relation = pair.some((p,i) => p.romance?.partnerId === pair[1-i].id) ||
        s.residents.some(child => child.parents.length === 2 && child.parents.includes(plan.a) && child.parents.includes(plan.b));
      if (relation) {
        if (families.some(f => familyKey(f.a,f.b) !== key && [f.a,f.b].some(id => [plan.a,plan.b].includes(id)))) {
          stopPopulationPlan('新配对与原家庭记录冲突，本轮等待核对'); return null;
        }
        const next = families.some(f => familyKey(f.a,f.b) === key) ? families : [...families,{a:plan.a,b:plan.b,room:plan.room}];
        saveShelter({...shelterState,pair:null,families:next});
        shelterPopulationNote = '网站已确认新家庭，后续按生育冷却轮换。';
        log.add('shelter-population','网站已确认新家庭',{phase:'confirmed',residents:[plan.a,plan.b],room:plan.room});
        return null;
      }
      if (pair.some(p => p.romance) || s.births.some(b => b.roomId === plan.room)) {
        shelterPopulationNote = '宿舍已出现感情或待产状态，保留人员并等待家庭关系确认。'; return null;
      }
      if (plan.release) {
        if (room?.type !== 'quarters' ||
            s.residents.some(p => p.deadAt === null && p.adultAt <= m.now && p.roomId === plan.room && ![plan.a,plan.b].includes(p.id)) ||
            pair.some((p,i) => ![plan.room,i ? plan.fromB : plan.fromA,null].includes(p.roomId))) {
          stopPopulationPlan('结束配对时人员或宿舍已被改变，取消剩余步骤并保留现状'); return null;
        }
        const p = pair.find(p => p.roomId === plan.room);
        if (p) {
          if (!home(p) || !healthy(p) || !shelterNameUnique(s,p) || !roomReady(room,[plan.a,plan.b])) {
            shelterPopulationNote = '等待人员和宿舍恢复后结束未确认配对。'; return null;
          }
          const from = p.id === plan.a ? plan.fromA : plan.fromB, old = s.rooms.find(r => r.id === from);
          const available = old && staffRoomTypes.includes(old.type) && old.builtAt <= m.now && !old.incident && !old.unpowered && old.upgradeAt === null &&
            s.residents.filter(other => other.deadAt === null && other.adultAt <= m.now && other.roomId === old.id).length < old.width*2;
          return {id:p.id,room:available ? old.id : null,from:p.roomId,name:p.name,reason:'结束未确认的新配对，恢复生产安排'};
        }
        if (plan.failed) {
          const next = activeBlocks.filter(b => familyKey(b.a,b.b) !== key).concat({a:plan.a,b:plan.b,until:Date.now()+86400000}).slice(-200);
          saveShelter({...shelterState,pairBlocks:next});
        }
        stopPopulationPlan(plan.failed ? '未观察到网站确认感情，已结束尝试；此组合 24 小时内不重试' : '心情、人口或供应条件已变化，已结束本次配对安排');
        return null;
      }
      const ordered=plan.first===plan.b?[pair[1],pair[0]]:pair;
      const matches = step => ordered.every((p,i)=>p.roomId===(i<step?plan.room:p.id===plan.a?plan.fromA:plan.fromB));
      if (plan.step < 2 && matches(plan.step+1)) {
        plan = {...plan,step:plan.step+1,waitAt:plan.step === 1 ? Date.now() : null}; saveShelter({...shelterState,pair:plan});
      } else if (!matches(plan.step)) {
        stopPopulationPlan('安排新配对期间岗位已被改变，取消剩余步骤'); return null;
      }
      if (!roomReady(room,[plan.a,plan.b])) {
        if (roomUnchanged(room,[plan.a,plan.b])) {
          const reasons=[room.unpowered&&'停电',room.incident&&'事件尚未处理',room.upgradeAt!==null&&'升级尚未完成'].filter(Boolean);
          if (plan.roomWaitAt == null) {
            saveShelter({...shelterState,pair:{...plan,roomWaitAt:Date.now()}});
            log.add('shelter-population','新配对宿舍暂时受阻，保留原计划',{phase:'room-wait',room:plan.room,step:plan.step,reasons});
          }
          shelterPopulationNote = `新配对宿舍${reasons.join('、')}，保留原计划，条件恢复后继续。`; return null;
        }
        stopPopulationPlan('新配对宿舍条件已改变，保留当前人员安排'); return null;
      }
      if (plan.roomWaitAt != null) {
        // 无法从当前快照确定宿舍受阻的完整时长，恢复后重新给足感情等待时间。
        plan = {...plan,roomWaitAt:null,waitAt:plan.step === 2 ? Date.now() : plan.waitAt};
        saveShelter({...shelterState,pair:plan});
        log.add('shelter-population','新配对宿舍已恢复，重新核对原安排',{phase:'room-resumed',room:plan.room,step:plan.step});
      }
      const canContinue = pair.every(p => home(p) && healthy(p) && p.happiness >= 50 && shelterNameUnique(s,p) && !(p.familyCooldownUntil > m.now) &&
        (p.roomId === plan.room || eligible(p))) && populationCanHouse(m,families,pair) && populationKinship(s)(...pair);
      // 只有两人均已入住才开始等感情；挂起期间尚未入住或条件失效不能算配对失败。
      const failed = plan.step === 2 && canContinue && Date.now()-(plan.waitAt ?? plan.at) >= 30*60000;
      if (failed || !canContinue) {
        saveShelter({...shelterState,pair:{...plan,release:true,failed}});
        return shelterPopulationPlan(m,families,{eligible,home,healthy});
      }
      if (plan.step === 2) { shelterPopulationNote = '两人已到宿舍，等待网站确认感情；本次先不安排其他新配对。'; return null; }
      let p = ordered[plan.step];
      if(!shelterDepartureSafe(m,[p.id])) {
        const alternate=plan.step===0&&ordered.find(person=>shelterDepartureSafe(m,[person.id]));
        if(!alternate){shelterPopulationNote='当前离岗步骤会降低基础供应，保留配对计划，先检查生产安排。';return null;}
        plan={...plan,first:alternate.id};saveShelter({...shelterState,pair:plan});p=alternate;
      }
      return {id:p.id,room:plan.room,from:p.roomId,name:p.name,reason:`安排新配对（${plan.step+1}/2）`};
    }
    if (!create) return null;
    const budget = populationBudget(m,families);
    shelterPopulationNote = `人口 ${budget.living}；待产及已预约名额 ${budget.future-budget.living-budget.recovering}；${budget.recovering ? `倒下居民预留 ${budget.recovering}；` : ''}目标 ${budget.limit}。`;
    if (budget.future >= budget.limit) { shelterPopulationNote+='已有名额达到目标，停止安排新增生育。'; return null; }
    const rooms = s.rooms.filter(r => roomReady(r,[]) && !families.some(f => f.room === r.id)).sort((a,b) => a.id-b.id);
    if (!rooms.length) { shelterPopulationNote+='暂无未被原家庭占用的空宿舍。'; return null; }
    // 原生居民详情明确要求双方心情 >= 50；不能先调离生产，再等无效配对超时。
    const unrelated = populationKinship(s), candidates = s.residents.filter(p => eligible(p) && p.happiness >= 50 &&
      (p.roomId === null || s.rooms.some(r => r.id === p.roomId && staffRoomTypes.includes(r.type))) &&
      !(p.familyCooldownUntil > 0) && !families.some(f => [f.a,f.b].includes(p.id)) && !s.residents.some(child => child.parents.includes(p.id)))
      .sort((a,b) => a.id-b.id);
    const loss = pair => {
      // 人选排序同样比较两人离岗后的实际产量；容量外驻留和接替者不能按个人理论产量计损失。
      const projected=shelterProductionWithout(m,pair.map(p=>p.id));
      return {idle:pair.filter(p=>p.roomId===null).length,scrap:m.production.scrap-projected.scrap,
        total:Object.keys(m.production).reduce((n,key)=>n+m.production[key]-projected[key],0)};
    };
    let best = null;
    for (let i=0;i<candidates.length;i++) for (let j=i+1;j<candidates.length;j++) {
      const pair = [candidates[i],candidates[j]], key = familyKey(pair[0].id,pair[1].id);
      if (activeBlocks.some(b => familyKey(b.a,b.b) === key) || !unrelated(...pair) || !populationCanHouse(m,families,pair)) continue;
      const first=pair.find(p=>shelterDepartureSafe(m,[p.id]));if(!first)continue;
      const score = loss(pair);
      if (!best || score.idle > best.score.idle || score.idle === best.score.idle &&
          (score.scrap < best.score.scrap-1e-6 || Math.abs(score.scrap-best.score.scrap) < 1e-6 && score.total < best.score.total-1e-6)) best = {pair,score,first:first.id};
    }
    if (!best) { shelterPopulationNote+='当前没有双方心情均达50、亲缘资料完整且离岗后供应仍充足的新组合。'; return null; }
    const [a,b] = best.pair;
    plan = {a:a.id,b:b.id,room:rooms[0].id,fromA:a.roomId,fromB:b.roomId,step:0,at:Date.now(),waitAt:null,release:false,failed:false,
      ...(best.first!==a.id?{first:best.first}:{})};
    saveShelter({...shelterState,pair:plan});
    log.add('shelter-population','开始安排一对未配对成人',{phase:'placing',residents:[a.id,b.id],firstResident:plan.first??plan.a,room:plan.room,target:shelterPopulationTarget});
    return shelterPopulationPlan(m,families,{eligible,home,healthy});
  }
  function shelterStaffPlan(m,skippedFamilies = []) {
    if (shelterStaffMode === 'off' || shelterStaffHold) return null;
    const s = m.state;
    // 调岗比领奖需要更多字段；缺少证据只停止人员管理，仍可收取奖励。
    if (new Set(s.residents.map(p => p.id)).size !== s.residents.length || s.residents.some(p =>
      typeof p.name !== 'string' || !p.name.trim() || !Number.isFinite(p.hp) || p.hp < 0 ||
      !(p.roomId === null || Number.isSafeInteger(p.roomId)) || !Array.isArray(p.parents) ||
      !p.parents.every(Number.isSafeInteger) || !(p.familyCooldownUntil == null || Number.isFinite(p.familyCooldownUntil)) ||
      !(p.romance == null || objectState(p.romance) && Number.isSafeInteger(p.romance.partnerId))) ||
      s.births.some(b => !Number.isSafeInteger(b.roomId) || !s.rooms.some(r => r.id === b.roomId && r.type === 'quarters'))) throw new Error('人员或待产信息不完整');
    const familyMode = ['family','population'].includes(shelterStaffMode), populationMode = shelterStaffMode === 'population';
    if (populationMode && shelterPopulationTarget === null) { holdShelterStaff('人口目标无效，本轮只收取奖励，请重新设置目标'); return null; }
    const families = familyMode ? rememberShelterFamilies(m) : [];
    const home = p => p.deadAt === null && p.away === null && p.adultAt <= m.now;
    const healthy = p => p.hp >= .6*Math.round(100+(Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)))-1)*(2+.5*p.stats.end));
    const byRoom = id => s.rooms.find(r => r.id === id);
    const familyOf = p => families.find(f => f.a === p.id || f.b === p.id);
    const birthRooms = new Set(s.births.map(b => b.roomId));
    const romanceResidents = new Set(s.residents.filter(p => p.deadAt === null && p.romance).flatMap(p => [p.id,p.romance.partnerId]));
    const protectedParent = p => families.some(f => [f.a,f.b].includes(p.id) && birthRooms.has(f.room));
    const occupancy = id => s.residents.filter(p => p.deadAt === null && p.adultAt <= m.now && p.roomId === id).length;
    const recovering = shelterRecoveringPopulation(s);
    const population = s.residents.filter(p => p.deadAt === null).length+s.births.length+recovering;
    const eligible = p => {
      if (!home(p) || !healthy(p) || romanceResidents.has(p.id) || birthRooms.has(p.roomId) || protectedParent(p) ||
          !shelterNameUnique(s,p)) return false;
      const old = byRoom(p.roomId);
      if (old?.incident || old?.upgradeAt != null || old && old.builtAt > m.now) return false;
      if (p.roomId === null || old && staffRoomTypes.includes(old.type)) return true;
      if (old?.type !== 'quarters') return false;
      const f = familyOf(p);
      if (f && f.room === old.id) return p.familyCooldownUntil > m.now || population >= (populationMode ? Math.min(shelterPopulationTarget,m.populationCap) : m.populationCap);
      // 只接管尚未组建家庭的成年子女；不拆散玩家放进宿舍的其他成人。
      return p.parents.length === 2 && !s.residents.some(child => child.parents.includes(p.id)) && !p.familyCooldownUntil;
    };
    if (populationMode && shelterState.pair) {
      const next = shelterPopulationPlan(m,families,{eligible,home,healthy});
      if (next || shelterStaffHold) return next;
    }
    const pool = s.residents.filter(p => eligible(p) && !(populationMode && shelterState.pair && [shelterState.pair.a,shelterState.pair.b].includes(p.id)));
    const budget = populationMode ? populationBudget(m,families) : null;
    const future = budget ? budget.future+(budget.future === budget.living+budget.recovering && budget.future < budget.limit ? 1 : 0) : 0;
    const readyFamilies = families.filter(f => {
      const pair = [f.a,f.b].map(id => s.residents.find(p => p.id === id)), room = byRoom(f.room);
      return room?.type === 'quarters' && room.builtAt <= m.now && room.upgradeAt === null && !room.incident && !room.unpowered &&
        !birthRooms.has(room.id) && pair.every(p => home(p) && healthy(p) && p.happiness >= 50 && !p.romance && !(p.familyCooldownUntil > m.now) &&
          (p.roomId === room.id || eligible(p))) &&
        !s.residents.some(p => p.deadAt === null && p.adultAt <= m.now && p.roomId === room.id && ![f.a,f.b].includes(p.id));
    });
    const recoveryDemand = familyMode && recovering ? {...m.demand,food:m.demand.food+recovering,water:m.demand.water+recovering} : m.demand;
    const familyBirth = familyMode && !populationMode && recovering && population < m.populationCap && readyFamilies.length ? 1 : 0;
    const baseDemand = populationMode ? {...m.demand,food:future,water:future} :
      familyBirth ? {...recoveryDemand,food:recoveryDemand.food+1,water:recoveryDemand.water+1} : recoveryDemand;
    let preparation = null;
    if (populationMode && !shelterState.pair) {
      const pending = shelterState.swap?.prepareFamily, familyIds = f => [Math.min(f.a,f.b),Math.max(f.a,f.b),f.room];
      const candidates = readyFamilies.filter(f => pending ? JSON.stringify(pending) === JSON.stringify(familyIds(f)) :
        !skippedFamilies.includes(familyKey(f.a,f.b)) && [f.a,f.b].some(id => s.residents.find(p => p.id === id).roomId !== f.room));
      // 已能返回的家庭先返回；需要接替时只准备一对，避免多对同时抽空基础岗位。
      if (pending || Object.keys(baseDemand).every(k => m.production[k] >= baseDemand[k]*1.2-1e-9) &&
          !candidates.some(f => populationCanHouse(m,families,[f.a,f.b].map(id => s.residents.find(p => p.id === id))))) {
        for (const f of candidates) {
          const supply = populationHousingSupply(m,families,[f.a,f.b].map(id => s.residents.find(p => p.id === id)));
          if (supply.allowed) { preparation = {...supply,prepareFamily:familyIds(f)}; break; }
        }
      }
    }
    if (skippedFamilies.length && !preparation) return null;
    const staffDemand = preparation?.demand || baseDemand;
    const staffModel = populationMode || familyMode && recovering ? {...m,demand:staffDemand,currentDemand:m.demand,
      ...(preparation ? {...preparation,actualProduction:m.production} : {})} : m;
    const supplyProduction = staffModel.production;
    const staffPool = preparation ? pool.filter(p => !preparation.reservedResidents.includes(p.id)) : pool;
    if (preparation) shelterPopulationNote = '原家庭正准备返宿舍：先按两人离岗后的产量安排接替，供应和名额重新核对通过后再返回。';
    if (shelterState.swap) {
      const next = shelterSwapStep(staffModel,eligible);
      if (next || shelterStaffHold) return next;
    }
    if (populationMode) for (const f of families) {
      const pair = [f.a,f.b].map(id => s.residents.find(p => p.id === id));
      if (birthRooms.has(f.room) || pair.some(p => !home(p) || p.romance || p.roomId !== f.room && !eligible(p)) || populationCanHouse(m,families,pair)) continue;
      const p = pair.find(p => p.roomId === f.room && healthy(p) && shelterNameUnique(s,p));
      const room = byRoom(f.room);
      if (p && room && room.builtAt <= m.now && !room.incident && room.upgradeAt === null) return {id:p.id,room:null,from:p.roomId,name:p.name,reason:'人口或供应已到限制，原配对暂缓新增生育'};
    }
    const gear = shelterGearPlan(staffModel,staffPool);
    if (gear) return gear;
    const rate = (p,r) => r ? shelterWorkerRate(s,m.now,m.view.env,p,r) : 0;
    const departures=new Map();
    const departureLoss = p => {
      const room=byRoom(p.roomId),resource=room&&shelterRooms[room.type][1];
      if(!resource)return 0;
      if(!departures.has(p.id))departures.set(p.id,supplyProduction[resource]-shelterProductionWithout(staffModel,[p.id])[resource]);
      return departures.get(p.id);
    };
    const safeDonor = p => {
      const r = byRoom(p.roomId), resource = r && shelterRooms[r.type][1];
      const loss=departureLoss(p);
      return (!Object.hasOwn(staffDemand,resource) || loss<=1e-9 || supplyProduction[resource]-loss >= staffDemand[resource]*1.2-1e-9) &&
        (!preparation || shelterDepartureSafe(m,[p.id]));
    };
    const targets = s.rooms.filter(r => staffRoomTypes.includes(r.type) && r.builtAt <= m.now &&
      !r.incident && !r.unpowered && r.upgradeAt === null && occupancy(r.id) < r.width*2);
    const choices = (rooms,reason) => rooms.flatMap(r => staffPool.filter(p => p.roomId !== r.id && safeDonor(p)).map(p => {
      const old = byRoom(p.roomId), resource = shelterRooms[r.type][1];
      const gain = rate(p,r)-(old && shelterRooms[old.type][1] === resource ? departureLoss(p) : 0);
      return {id:p.id,room:r.id,from:p.roomId,reason,gain,name:p.name};
    })).filter(c => c.gain > 1).sort((a,b) => b.gain-a.gain || a.id-b.id || a.room-b.room);
    const shortages = Object.keys(staffDemand).filter(k => supplyProduction[k] < staffDemand[k]*1.2-1e-9)
      .sort((a,b) => m.state.resources[a]/Math.max(1,staffDemand[a])-m.state.resources[b]/Math.max(1,staffDemand[b]));
    for (const resource of shortages) {
      const choice = choices(targets.filter(r => shelterRooms[r.type][1] === resource),
        `${preparation ? '原家庭返宿舍前安排接替，' : ''}补足${shelterResources[resource]}供应`)[0];
      if (choice) return choice;
    }
    if (!shortages.length && familyMode && population < m.populationCap && !(populationMode && shelterState.pair)) {
      for (const f of readyFamilies) {
        const pair = [f.a,f.b].map(id => s.residents.find(p => p.id === id)), room = byRoom(f.room);
        // 已回宿舍、尚未开始感情进度的另一对也占用一个预期出生名额。
        const reserved = families.filter(other => other !== f && !shelterFamilyExpecting(s,other.a,other.b) && [other.a,other.b].every(id =>
          s.residents.some(p => p.id === id && home(p) && p.roomId === other.room && !(p.familyCooldownUntil > m.now)))).length;
        if (population+reserved >= m.populationCap) continue;
        if (populationMode && !populationCanHouse(m,families,pair)) continue;
        if (!populationMode) {
          const projected = shelterProductionWithout(m,pair.map(p=>p.id));
          if (!Object.keys(recoveryDemand).every(k => projected[k] >= (recoveryDemand[k]+(k === 'power' ? 0 : 1))*1.2-1e-9 &&
              s.resources[k] >= recoveryDemand[k]*2)) continue;
        }
        const p = pair.find(p => p.roomId !== room.id && shelterDepartureSafe(m,[p.id]));
        if (p && occupancy(room.id) < room.width*2) return {id:p.id,room:room.id,from:p.roomId,name:p.name,reason:'冷却结束，原配对返回宿舍'};
      }
    }
    if (populationMode && !preparation) {
      const next = shelterPopulationPlan(m,families,{eligible,home,healthy},true);
      if (next || shelterStaffHold) return next;
    }
    if (preparation) {
      if (planShelterSwap(staffModel,pool)) return shelterSwapStep(staffModel,eligible);
      // 一对暂时无法接替时，继续检查其他原家庭；不让第一对阻塞全部生育轮换。
      const note = shelterPopulationNote;
      const next = shelterStaffPlan(m,[...skippedFamilies,familyKey(preparation.prepareFamily[0],preparation.prepareFamily[1])]);
      if (next || shelterStaffHold) return next;
      shelterPopulationNote = note;
    }
    const scrap = choices(targets.filter(r => r.type === 'scrap'),'增加废料生产')[0];
    if (scrap) return scrap;
    if (!preparation && planShelterSwap(staffModel,pool)) return shelterSwapStep(staffModel,eligible);
    const lowMoodFamilies=families.filter(f=>[f.a,f.b].some(id=>s.residents.find(p=>p.id===id)?.happiness<50)).length;
    shelterStaffNote = (familyMode ? `已记住 ${families.length} 对原配对。${lowMoodFamilies?`${lowMoodFamilies} 对心情不足50，需恢复后才能继续生育。`:''}` : '')+
      (shortages.length ? `${preparation ? '原家庭离岗后' : ''}尚缺供应：${shortages.map(k=>`${shelterResources[k]}时产 ${supplyProduction[k].toFixed(1)}/目标 ${(staffDemand[k]*1.2).toFixed(1)}`).join('、')}。当前可用人员和房间无法安全补足。` :
        '已按供应余量和废料收益安排；培养感情、待产、受伤和特殊岗位保持原安排。');
    return null;
  }
  function shelterExploreStep(m) {
    const plan=shelterExplorerCandidates(m);
    shelterExploreNote=plan.notes[0]||(shelterExploreSkipped.size?'部分归来探险未能唯一定位，本轮保留该奖励。':'暂无已归来且可领取的探险。');
    for(const choice of plan.ready) {
      if(shelterExploreSkipped.has(choice.id))continue;
      if(!shelterFits(m,choice.reward,choice.items)) {shelterExploreNote='归来探险的背包或携带治疗针可能溢出，保留奖励，先腾出库存。';continue;}
      const tab=shelterTab('废土');
      if(!usable(tab)){shelterExploreNote='尚未识别废土页签，本轮保留归来奖励。';return false;}
      if(tab.getAttribute('aria-selected')!=='true') {
        offer('shelter:explore-tab','查看已归来的探险',()=>tab.click());return true;
      }
      const root=locator.pick([...document.querySelectorAll('section')].filter(el=>/^单人探险\s*\(\d+\/\d+\)$/.test(textOf(el.querySelector('h2')))));
      const row=locator.pick([...(root?.querySelectorAll('li')||[])].filter(el=>textOf(el.querySelector('p'))===choice.title&&
        [...el.querySelectorAll('p')].some(p=>textOf(p)==='到家了')));
      const button=buttonIn(row,'领取');
      if(!usable(button)) {
        shelterExploreSkipped.add(choice.id);shelterExploreNote='未能唯一定位可领取的归来探险，本轮保留该奖励。';continue;
      }
      shelterExploreNote='核对并领取已归来的探险奖励。';
      shelterSubmit(button,'explore',[choice.id,choice.residentId],m,'领取已归来的探险奖励');return true;
    }
    return false;
  }
  function shelterTab(label) {
    const tabs = locator.query('[role="tablist"][aria-label="避难所"]');
    return buttonIn(tabs,new RegExp(`^${label}(?:\\s*\\d+)?$`));
  }
  function shelterRewardTabDue(stage,m) {
    const label = stage === 1 ? '目标' : '图鉴', tab = shelterTab(label);
    if (!tab) return false;
    const badge = textOf(tab).match(/(\d+)$/);
    if (stage === 2) return Boolean(badge && +badge[1] > 0);
    const season = m.state.season;
    const tiers = Array.from({length:Math.min(30,Math.floor(season.points/150))},(_,i)=>i+1);
    if (tiers.some(t => !season.claimedFree.includes(t))) return true;
    if (m.state.daily.claimed.length >= 3) return false;
    // 网站目标角标也包含通行证档，不能为不处理的付费奖励反复切页。
    const paid = season.premium && Array.isArray(season.claimedPremium) ? tiers.filter(t => !season.claimedPremium.includes(t)).length : 0;
    return Boolean(badge && +badge[1] > paid);
  }
  function holdShelterStaff(message) {
    shelterStaffHold = true; shelterStaffNote = message; cancelQueued();
    if (shelterState.swap) saveShelter({...shelterState,swap:null});
    log.add('shelter-staff-held',message);
  }
  function shelterWorkTitle(dialog,work = shelterWork) {
    if (!work) return false;
    const name = work.name.normalize('NFKC').replace(/\s+/g,' ').trim(), title = textOf(dialog?.querySelector('h2'));
    return title.startsWith(`${name} · `) && /^\d+ 级$/.test(title.slice(name.length+3));
  }
  function closeShelterWork() {
    const work = shelterWork, dialog = work?.dialog;
    if (!dialog?.isConnected) { shelterWork = null; return false; }
    if (work.closing) { say('等待居民窗口关闭，请勿重复操作'); return true; }
    if (!shelterWorkTitle(dialog,work)) {
      shelterWork = null; holdShelterStaff('居民窗口已被更改，本轮人员管理等待你处理'); return true;
    }
    const close = currentElement([...dialog.querySelectorAll('button')].filter(b => b.getAttribute('aria-label') === '关闭' || textOf(b) === '关闭'));
    if (!usable(close)) { say('等待关闭脚本打开的居民窗口'); return true; }
    offer('shelter:staff-close','关闭已核对的居民窗口',() => { close.click(); work.closing = true; });
    return true;
  }
  function shelterWorkStep(m,dialogs) {
    let choice;
    try { choice = shelterStaffPlan(m); }
    catch(error) { if(error?.code==='shelter-state-changed')throw error;holdShelterStaff('人员或配对记录无法核对，本轮只收取奖励'); }
    if (shelterWork?.submitted || shelterLeave || !shelterEnabled || !choice) return closeShelterWork();
    if (shelterWork && (shelterWork.id !== choice.id || shelterWork.room !== choice.room || shelterWork.from !== choice.from ||
        shelterWork.kind !== choice.kind || shelterWork.item !== choice.item || shelterWork.fromItem !== choice.fromItem)) {
      return closeShelterWork();
    }
    if (!shelterWork) shelterWork = {...choice,openedAt:0,dialog:null};
    const work = shelterWork;
    if (work.dialog) {
      if (!work.dialog.isConnected) {
        if (!work.closing && !work.submitted) {
          if (shelterStaffMode === 'population' && shelterState.pair) stopPopulationPlan('居民窗口已关闭，本轮停止安排新配对');
          else holdShelterStaff('居民窗口已关闭，本轮尊重手动操作');
        }
        shelterWork = null; return false;
      }
      if (work.closing) { say('等待居民窗口关闭'); return true; }
      const equip = work.kind === 'equip', value = equip ? String(work.item) : work.room === null ? 'rest' : String(work.room);
      const labels = [...work.dialog.querySelectorAll('label')].filter(el => equip ? /^服装/.test(textOf(el)) : /^调去/.test(textOf(el)));
      const select = labels.length === 1 ? labels[0].querySelector('select') : null;
      const option = select && [...select.options].find(o => o.value === value && !o.disabled);
      if (!usable(select) || !option) { holdShelterStaff('原网页没有可用的岗位或服装选项，本轮保留现有安排'); return closeShelterWork(); }
      if (!shelterWorkTitle(work.dialog,work)) { shelterWork = null; holdShelterStaff('居民窗口身份发生变化，本轮等待你处理'); return true; }
      const room = m.state.rooms.find(r => r.id === work.room);
      shelterStaffNote = equip ? `${work.reason}。` : `${work.reason}：${work.room === null ? '暂时休息' : `安排到${staffRoomNames[room?.type] || '目标房间'}`}。`;
      shelterSubmit(select,equip ? 'equip' : 'assign',[work.id,equip ? work.item : work.room],m,shelterStaffNote,() => {
        work.submitted = true;
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,value);
        select.dispatchEvent(new Event('change',{bubbles:true}));
      });
      return true;
    }
    if (work.openedAt) {
      const matches = dialogs.filter(d => shelterWorkTitle(d,work) &&
        [...d.querySelectorAll('label')].some(el => /^调去/.test(textOf(el))));
      if (dialogs.length === 1 && matches.length === 1) { work.dialog = matches[0]; schedule(); return true; }
      if (Date.now()-work.openedAt > 5000) { holdShelterStaff('未能确认居民窗口，本轮保留原岗位'); shelterWork = null; }
      else say('等待网页打开指定居民详情');
      return true;
    }
    const tab = shelterTab('居民');
    if (!usable(tab)) { holdShelterStaff('未找到居民页签，本轮只收取奖励'); shelterWork = null; return false; }
    if (tab.getAttribute('aria-selected') !== 'true') {
      offer('shelter:staff-tab','打开居民页安排生产',() => tab.click()); return true;
    }
    const root = currentElement([...document.querySelectorAll('section')].filter(el => /^居民\s+\d+\/\d+$/.test(textOf(el.querySelector('h2')))));
    const filter = currentElement([...(root?.querySelectorAll('label') || [])].filter(el => /^筛选/.test(textOf(el))))?.querySelector('select');
    if (usable(filter) && filter.value !== 'all' && [...filter.options].some(o => o.value === 'all')) {
      offer('shelter:staff-filter','查看全部居民',() => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(filter,'all');
        filter.dispatchEvent(new Event('change',{bubbles:true}));
      }); return true;
    }
    const p = m.state.residents.find(p => p.id === work.id), level = Math.min(50,1+Math.floor(Math.sqrt(p.xp/3)));
    const name = p.name.normalize('NFKC').replace(/\s+/g,' ').trim();
    const title = `${name} · ${level} 级`;
    const row = currentElement([...(root?.querySelectorAll('li > button') || [])].filter(b => textOf(b).startsWith(`${title} · `)));
    if (!usable(row)) { holdShelterStaff('未能唯一定位居民，本轮保留原岗位'); shelterWork = null; return false; }
    offer(`shelter:staff-open:${work.id}`,'打开待调岗居民详情',() => { work.title = title; work.openedAt = Date.now(); row.click(); });
    return true;
  }
  // 用户接手脚本打开的窗口后，不再自动改动或关闭该窗口。
  for (const event of ['pointerdown','keydown','change']) document.addEventListener(event,e => {
    if (e.isTrusted && shelterWork?.dialog?.contains(e.target)) {
      shelterWork = null;
      if (shelterStaffMode === 'population' && shelterState.pair) stopPopulationPlan('你已接手居民窗口，取消剩余新配对安排');
      else holdShelterStaff('你已接手居民窗口，本轮暂停人员管理');
      schedule();
    }
  },true);
  function shelterAdvice(m) {
    const deficits = Object.keys(m.demand).filter(k => m.production[k] < m.demand[k]);
    const waiting = m.state.residents.filter(p => p.away === null && p.deadAt === null && p.adultAt <= m.now && p.roomId === null).length;
    const pairs = new Set(m.state.residents.filter(p => p.romance && p.deadAt === null && p.away === null)
      .map(p => [p.id,p.romance.partnerId].sort((a,b)=>a-b).join(':'))).size;
    const cooldown = m.state.residents.filter(p => p.familyCooldownUntil > m.now && p.away === null && p.deadAt === null).length;
    return `${deficits.length ? deficits.map(k => `${shelterResources[k]}净缺 ${(m.demand[k]-m.production[k]).toFixed(1)}/小时，库存约可撑 ${(m.state.resources[k]/(m.demand[k]-m.production[k])).toFixed(1)} 小时`).join('；') : '当前基础供应可覆盖消耗'}。`+
      `废料约 ${m.production.scrap.toFixed(1)}/小时；闲置成人 ${waiting} 人；培养感情 ${pairs} 对，待产 ${m.state.births.length} 个。`+
      `${cooldown ? `${cooldown} 人处于生育冷却。` : ''}优先补供应缺口，再安排耐力高的居民回收；自动管理遵循面板所选模式。`;
  }
  function finishShelter(m, note = '本轮检查完成', delay = note.includes('上限') ? 60000 : 15*60000,
    pendingReadOnly) {
    shelterReload();
    pendingReadOnly ??= shelterState.pendingReadOnly;
    let development=shelterState.development;
    let operations=shelterState.operations,attention={};
    if (m) {
      try { development=`${new Date(m.now).toLocaleString('zh-CN')} 检查结果\n${shelterDevelopmentText(shelterDevelopmentPlan(m,shelterPopulationTarget))}`; }
      catch { development='发展规划资料暂不完整，下一轮重新评估；领取与人员管理照常。'; }
      const events = m.rooms.filter(r => !r.automatic && r.rate>0 && r.batch>r.stored &&
        (r.resource!=='parts' || m.state.resources.scrap>=6*(r.batch-r.stored))).map(r =>
          r.nextTickAt-m.now+Math.max(0,Math.ceil((r.batch-r.stored)/(r.rate/6)-1e-9)-1)*600000);
      try {
        const ops=shelterOperations(m);operations=`${new Date(m.now).toLocaleString('zh-CN')} 检查结果\n${ops.messages.join('\n')}`;
        events.push(...ops.events);attention=ops.counts;
      }catch{operations='运行提醒资料暂不完整，下一轮重新核对。';}
      for (const b of m.state.births) if (b.dueAt > m.now) events.push(b.dueAt-m.now);
      for (const p of m.state.residents) {
        if (p.adultAt > m.now) events.push(p.adultAt-m.now);
        if (p.familyCooldownUntil > m.now) events.push(p.familyCooldownUntil-m.now);
      }
      if (shelterStaffMode === 'population' && shelterState.pair && !shelterState.pair.release && shelterState.pair.roomWaitAt == null) {
        const remaining = (shelterState.pair.waitAt ?? shelterState.pair.at)+30*60000-Date.now();
        if (remaining > 0) events.push(remaining);
      }
      const midnight = Date.parse(`${logDay(m.now+86400000)}T00:00:00+08:00`);
      events.push(midnight-m.now);
      if (events.length) delay = Math.max(60000,Math.min(delay,...events)+2000);
    }
    saveShelter({ ...shelterState, nextAt:Date.now()+delay, note, exploreNote:shelterExploreNote,
      pendingReadOnly:shelterPending?.id===pendingReadOnly?pendingReadOnly:undefined,
      ...(m ? { advice:shelterAdvice(m),development,operations } : {}) });
    log.add('shelter-check', note, { nextAt:shelterState.nextAt, actions:shelterActions,pendingReadOnly:shelterReadOnlyWait(),
      staffMode:shelterStaffMode,staffHeld:shelterStaffHold,staffNote:shelterStaffNote,
      gearEnabled:shelterGear,optimizeEnabled:shelterOptimize,pendingSwap:Boolean(shelterState.swap),
      populationTarget:shelterPopulationTarget,pendingPair:Boolean(shelterState.pair),
      exploreClaimEnabled:shelterExploreClaim,exploreNote:shelterExploreNote,
      ...(m ? { resources:m.state.resources, production:m.production, demand:m.demand,attention,
        population:m.state.residents.filter(p=>p.deadAt===null).length, recovering:shelterRecoveringPopulation(m.state), births:m.state.births.length } : {}) });
    shelterLeave = true; cancelShelterRead();
  }
  function leaveShelter() {
    const link = travelLink('/activities/expedition');
    offer('shelter:return','返回远征，等待下一次避难所预约',() => {
      startNavigation('/activities/expedition',link);
    });
  }
  function maybeVisitShelter(running) {
    if(shelterReload()){cancelShelterRead();cancelQueued();}
    if (!shelterEnabled || stateFault('shelter') || shelterState.nextAt > Date.now() || farmEnabled&&farmPlan) return false;
    rememberExpeditionTime(running);
    if (farmState.expeditionAt > Date.now() && farmState.expeditionAt-Date.now() < 15000) return false;
    const link = travelLink('/shelter');
    offer('shelter:visit','切换避难所收取产出和奖励',() => {
      startNavigation('/shelter',link);
    });
    return true;
  }
  function shelterFits(m, reward, items = 0) {
    const {automatic}=shelterFutureCollection(m,10000+Math.max(0,Date.now()-(shelterRead?.at || Date.now())));
    return Object.entries(reward).every(([k,n]) => Number.isFinite(n) && n >= 0 &&
      m.state.resources[k]+(automatic[k] || 0)+n <= m.caps[k]) &&
      m.state.items.length+items <= m.itemCap;
  }
  function shelterReward(text) {
    const reward = {}; let items = 0;
    for (const part of text.replace(/,/g,'').split(/[·、]/).map(s=>s.trim()).filter(Boolean)) {
      const match = part.match(/^(\d+)\s*(废料|零件|治疗针)$/);
      if (match) reward[Object.keys(shelterResources).find(k=>shelterResources[k]===match[2])] = +match[1];
      else if (/^\d+ 档装备$/.test(part)) items++;
      else if (!/^\d+ 赛季积分$|^称号「[^」]+」$/.test(part)) return null;
    }
    return Object.keys(reward).length || items ? { reward, items } : null;
  }
  function shelterRequestAction(kind,targets) {
    const [first,second]=targets;
    switch(kind){
      case 'collect':return first==='all'?{type:'collect_all'}:{type:'collect',roomId:first};
      case 'tutorial':return {type:'claim_tutorial',step:first};
      case 'daily':return {type:'claim_objective',index:first};
      case 'season':return {type:'claim_season',tier:first,premium:false};
      case 'achievement':return {type:'claim_achievement',id:first};
      case 'assign':return {type:'assign',residentId:first,roomId:second};
      case 'equip':return {type:'equip',residentId:first,itemId:second,slot:'outfit'};
      case 'explore':return {type:'explore_claim',explorerId:first};
      default:return null;
    }
  }
  function shelterSubmit(button, kind, targets, m, label, perform = () => button.click()) {
    if (!usable(button)) return;
    const readAt=shelterRead.at,periodNote='避难所奖励周期已变化，取消未发送目标；一分钟后重新核对';
    const key = `shelter:${kind}:${targets.join(',')}`;
    if(!shelterRewardPeriodCurrent(kind,m.now,readAt)) {
      finishShelter(null,periodNote,60000);return;
    }
    // 随机等待结束时再读一次，避免沿用等待前的库存和奖励档位。
    if (queued?.key === key && Date.now() >= queued.dueAt && Date.now()-shelterRead.at > 1500) {
      offered = true; readShelter(); return;
    }
    offer(key,label,() => {
      const id = crypto.randomUUID();
      saveShelterPending({ at:Date.now(), id, kind, targets, vaultNo:m.view.vaultNo,
        before:{ collected:m.state.stats.collected, serverTime:m.now, day:m.state.daily.day, month:m.state.season.month,
          ...(kind === 'assign' ? {room:m.state.residents.find(p => p.id === targets[0]).roomId} : {}),
          ...(kind === 'equip' ? {outfit:m.state.residents.find(p => p.id === targets[0]).outfitId} : {}),
          ...(kind === 'explore' ? {explorer:shelterExplorerCandidates(m).ready.find(e=>e.id===targets[0]&&e.residentId===targets[1])?.before} : {}),
          ...(kind === 'collect' ? { rooms:m.rooms.filter(r => r.batch && r.stored >= r.batch &&
            (targets[0] === 'all' || targets.includes(r.id))).map(r => ({id:r.id,stored:r.stored})) } : {}) } });
      shelterRead = null; shelterReadAt = Date.now()+2000; shelterActions++;
      let submitted=0,inFlight=null;
      const signature=request=>JSON.stringify([request?.idempotencyKey,request?.action]);
      const capture = (result,request,body) => {
        if(inFlight===signature(request))inFlight=null;
        if(kind==='season'&&(submitted===targets.length||result.outcome!=='ok'||body&&(body.code==='retry'||!objectState(body.view))))capture.end();
        try {
          shelterReload();if (shelterPending?.id !== id) return;
          const proof=shelterCollectProof(shelterPending,result.status,request,body)||
            shelterExplorerProof(shelterPending,result.status,request,body)||shelterPending.result?.proof;
          const rewardProof=shelterRewardProof(shelterPending,result.status,request,body);
          const rewardProofs=Array.isArray(shelterPending.result?.rewardProofs)?shelterPending.result.rewardProofs:[];
          const rewards=rewardProof?[...rewardProofs.filter(p=>p.target!==rewardProof.target),rewardProof]:rewardProofs;
          saveShelterPending({ ...shelterPending, result:{status:result.status,outcome:result.outcome,
            ...(proof?{proof}:{}),...(rewards.length?{rewardProofs:rewards}:{})} });
        }
        catch { pauseShelter('无法保存避难所响应，请核对原结果'); }
        schedule();
      };
      capture.id=id;
      capture.current=()=>shelterPending?.id===id&&shelterPending.targets.length===targets.length&&
        shelterPending.targets.every((target,i)=>target===targets[i])&&shelterPending.sentCount===submitted;
      capture.end=()=>{if(continueShelterAction===capture)continueShelterAction=null;};
      capture.validate=body=>{
        shelterWriteGuard();
        if(kind==='season'&&submitted&&!capture.current())
          throw Object.assign(Error('避难所旧批次已被接管，取消后续请求'),{code:'shelter-batch-obsolete'});
        if(shelterReadOnlyWait())throw Object.assign(Error('避难所原批次等待核对，不继续发送'),{code:'shelter-read-only'});
        const action=body?.action,expected=shelterRequestAction(kind,kind==='season'?targets.slice(submitted):targets);
        if(inFlight||submitted>=(kind==='season'?targets.length:1)||!enabled||localStorage.getItem(PREF)==='false'||!active||!shelterEnabled||accountStopReason()||shelterPending?.id!==id||
          kind==='explore'&&!shelterExploreClaim||kind==='assign'&&shelterStaffMode==='off'||
          kind==='equip'&&(!shelterGear||shelterStaffMode==='off')||
          !objectState(body)||Object.keys(body).length!==2||!/^[A-Za-z0-9-]{8,64}$/.test(body?.idempotencyKey||'')||!objectState(action)||!expected||
          Object.keys(action).length!==Object.keys(expected).length||Object.entries(expected).some(([key,value])=>action[key]!==value))
          throw Error('避难所请求与原动作或目标不一致');
        if(!shelterRewardPeriodCurrent(kind,m.now,readAt))
          throw Object.assign(Error(periodNote),{code:'shelter-period-changed'});
        // 先持久保存尝试范围，再交给原生 fetch；写入失败不得发送，也不能推断旧记录未曾发送。
        if(kind==='season')saveShelterPending({...shelterPending,sentCount:submitted+1});
        submitted++;inFlight=signature(body);
        if(kind==='season')continueShelterAction=capture;
      };
      capture.fail=error=>{
        capture.end();
        if(error?.code==='shelter-batch-obsolete'||error?.code==='shelter-state-changed'&&kind==='season'&&submitted&&!capture.current()) {
          log.add('shelter-batch-obsolete','避难所旧批次已被接管，取消后续请求',{kind,sent:submitted});schedule();return;
        }
        const expiredWait=error?.code==='shelter-read-only'&&!shelterRewardPeriodCurrent(kind,m.now,readAt);
        if(error?.code==='shelter-read-only'&&!expiredWait){schedule();return;}
        if(error?.code==='shelter-period-changed'||expiredWait) {
          if(!enabled||!shelterEnabled||localStorage.getItem(PREF)==='false'||!active||accountStopReason()){schedule();return;}
          try {
            shelterWriteGuard();
            if(shelterPending?.id!==id)throw Error('避难所原记录已变化');
            saveShelterPending(submitted?{...shelterPending,targets:targets.slice(0,submitted)}:null);
            log.add('shelter-period-change',periodNote,{kind,sent:submitted,cancelled:targets.length-submitted});
            finishShelter(null,periodNote,60000);schedule();
          }catch(error){if(!shelterRetryChange(error))pauseShelter('避难所周期变更无法保存，请核对原记录');}
          return;
        }
        pauseShelter('避难所原请求无法绑定，已停止并保留记录');
      };
      captureShelterAction=capture;
      log.add('shelter-submitted',label,{kind,targets});
      try { perform(); } finally { captureShelterAction = null; }
    });
  }
  function shelterConfirmed(m) {
    const p = shelterPending, s = m.state;
    if(m.now<(p.before.serverTime??0))return false;
    if (p.kind === 'assign') return s.residents.some(resident => resident.id === p.targets[0] && resident.roomId === p.targets[1]);
    if (p.kind === 'equip') return s.residents.some(resident => resident.id === p.targets[0] && resident.outfitId === p.targets[1]);
    if(p.kind==='explore')return shelterExplorerConfirmed(p,m);
    if (p.kind === 'collect') {
      const proof=p.result?.proof,proved=proof?.vaultNo===p.vaultNo&&/^[A-Za-z0-9-]{8,64}$/.test(proof?.key||'')&&
        Number.isFinite(proof.at)&&proof.at>=(p.before.serverTime??0)&&Number.isFinite(proof.collected)&&
        proof.collected>p.before.collected&&s.stats.collected>=proof.collected;
      return s.stats.collected > p.before.collected && (proved ||
        p.before.rooms.every(before => m.rooms.some(r => r.id === before.id && r.stored < before.stored)));
    }
    if(p.kind==='daily'||p.kind==='season')return shelterRewardConfirmed(p,m);
    const claimed = p.kind === 'tutorial' ? (s.tutorial?.claimed || []) : p.kind === 'achievement' ? s.achievements : [];
    return p.targets.length > 0 && p.targets.every(id => claimed.includes(id));
  }
  function shelterStep() {
    if(shelterReload()){cancelShelterRead();cancelQueued();}
    if(shelterExploreClaim&&Date.now()<shelterExploreManualUntil){say('你正在操作避难所页面，自动操作等待一分钟');return;}
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    const openingWork = shelterWork?.openedAt && !shelterWork.dialog && dialogs.length === 1 &&
      shelterWorkTitle(dialogs[0]) && [...dialogs[0].querySelectorAll('label')].some(el => /^调去/.test(textOf(el)));
    if (openingWork) shelterWork.dialog = dialogs[0];
    if (dialogs.length && !openingWork && !(dialogs.length === 1 && dialogs[0] === shelterWork?.dialog)) {
      if(shelterEnabled&&!stateFault('shelter'))handleNotice(dialogs,'避难所弹窗需要先处理，自动操作等待');
      else say('避难所弹窗需要先处理，自动操作等待');
      return;
    }
    if (!shelterEnabled || stateFault('shelter')) {
      if (closeShelterWork()) return;
      if (shelterEntryAt) leaveShelter(); else say('避难所未开启，可在面板开启'); return;
    }
    // 旧页的原生 await 可能仍未结束；先卸载其回调，不能让新批次覆盖旧捕获器。
    if(continueShelterAction&&!continueShelterAction.current()) {
      if(!shelterBatchReloading) {
        shelterBatchReloading=true;cancelQueued();
        log.add('shelter-batch-reload','避难所批次已由其他页面处理，刷新以清理旧页面回调');
        location.reload();
      }
      return;
    }
    if (!shelterEntryAt) { shelterEntryAt = Date.now(); shelterStage = 0; shelterActions = 0; shelterLeave = false;shelterVisitPeriod=null;
      shelterExploreSkipped.clear();shelterExploreNote=''; }
    if (shelterLeave) { if (!closeShelterWork()) leaveShelter(); return; }
    if (shelterReadOnlyWait() && shelterState.nextAt > Date.now()) { if (!closeShelterWork()) leaveShelter(); return; }
    if (!navigator.onLine) { say('避难所：网络离线，等待恢复'); return; }
    if (plan || claimWait || farmEnabled&&farmPlan || nativePending().length) {
      finishShelter(null,'其他玩法正在核对原操作，先返回远征，一分钟后再检查避难所',60000);return;
    }
    if (!shelterPending && (Date.now()-shelterEntryAt > 60000 || shelterActions >= 12)) {
      finishShelter(shelterRead?.model,'本轮处理已到上限，稍后继续避难所'); return;
    }
    if (!shelterRead || Date.now()-shelterRead.at > 10000) { readShelter(); return; }
    const m = shelterRead.model;
    shelterVisitPeriod ??= {day:m.state.daily.day,month:m.state.season.month};
    if (shelterPending) {
      if(shelterPending.kind==='season'&&shelterPending.sentCount<shelterPending.targets.length&&
        continueShelterAction?.id!==shelterPending.id) {
        const cancelled=shelterPending.targets.length-shelterPending.sentCount;
        saveShelterPending({...shelterPending,targets:shelterPending.targets.slice(0,shelterPending.sentCount)});
        log.add('shelter-batch-recovered','恢复赛季批次：先核对已发送档位，撤销未发送预留',{sent:shelterPending.sentCount,cancelled});
      }
      if (shelterConfirmed(m)) {
        const confirmed=shelterPending;
        saveShelterPending(null);
        log.add('shelter-confirmed',confirmed.kind === 'assign' ? '居民岗位变更已确认' : confirmed.kind === 'equip' ? '居民服装变更已确认' :
          confirmed.kind==='explore'?'探险归来领取与居民释放已确认':'避难所领取状态已确认',
          {kind:confirmed.kind,targets:confirmed.targets,resources:m.state.resources});
      } else {
        const wait=shelterPendingWait(shelterPending,m);
        if(Date.now()-shelterPending.at>=30000) {
          log.add('shelter-pending-wait',wait.note,wait.data);
          finishShelter(null,`${wait.note}，五分钟后只读核对；保留记录，不重复提交`,300000,shelterPending.id);
        } else { shelterRead=null;shelterReadAt=Date.now()+5000;say(`${wait.note}，稍后只读核对，不重复提交`); }
      }
      return;
    }
    if(shelterVisitPeriod.day!==m.state.daily.day||shelterVisitPeriod.month!==m.state.season.month) {
      finishShelter(null,'避难所奖励周期已变化，取消未发送目标；一分钟后重新核对',60000);return;
    }
    if (m.view.switches.frozen || m.view.nameRequired) { finishShelter(m,'避难所维护或尚未命名，等待你处理'); return; }
    if(shelterExploreClaim&&!shelterWork&&!dialogs.length&&shelterExploreStep(m))return;
    if (shelterWork || shelterStaffMode !== 'off' && !shelterStaffHold) {
      if (shelterWorkStep(m,dialogs)) return;
    }
    if (dialogs.length) return;
    const names = ['避难所','目标','图鉴'];
    while (shelterStage > 0 && shelterStage < names.length && !shelterRewardTabDue(shelterStage,m)) shelterStage++;
    if (shelterStage >= names.length) { finishShelter(m); return; }
    const tab = shelterTab(names[shelterStage]);
    if (!usable(tab)) { finishShelter(m,'未识别避难所页签，稍后再检查'); return; }
    if (tab.getAttribute('aria-selected') !== 'true') {
      offer(`shelter:tab:${shelterStage}`,shelterStage ? `领取${names[shelterStage]}待领奖励` : '检查避难所产出',() => tab.click()); return;
    }
    if (shelterStage === 0) {
      const ready = m.rooms.filter(r => r.batch && r.stored >= r.batch);
      const reward = {};
      // 预留在途十秒的下一批；批量还可能收进目前未满、在途才满的房间。
      const projected=shelterFutureCollection(m,Date.now()-shelterRead.at+10000);
      const amount = r => projected.amounts[r.id] || 0;
      for (const r of m.rooms.filter(r => r.batch)) reward[r.resource] = (reward[r.resource]||0)+amount(r);
      const all = locator.pick([...document.querySelectorAll('button')].filter(b => textOf(b)==='全部收取'));
      // 满仓资源不能拖住其他房间，批量不合适时逐房收取原生图标按钮。
      if (ready.length && usable(all) && shelterFits(m,reward)) {
        shelterSubmit(all,'collect',['all'],m,'收取避难所已满批产出'); return;
      }
      for (const r of ready) {
        if (!shelterFits(m,{[r.resource]:amount(r)})) continue;
        const root = locator.query(`[data-room="${r.id}"]`);
        const button = root?.querySelector(`button[aria-label="收取${shelterResources[r.resource]}"]`);
        if (usable(button)) { shelterSubmit(button,'collect',[r.id],m,`收取避难所${shelterResources[r.resource]}`); return; }
      }
      const tutorial = locator.pick([...document.querySelectorAll('section')].filter(el=>/^新手引导/.test(textOf(el.querySelector('h2')))));
      const button = buttonIn(tutorial,'领取');
      const step = textOf(tutorial).match(/第\s*(\d+)\s*步/);
      const rewardText = [...(tutorial?.querySelectorAll('p') || [])].map(textOf).find(t => /^奖励\s/.test(t));
      const parsed = rewardText && shelterReward(rewardText.replace(/^奖励\s+/,''));
      if (step && parsed && usable(button) && !(m.state.tutorial?.claimed || []).includes(+step[1]) && shelterFits(m,parsed.reward,parsed.items)) {
        shelterSubmit(button,'tutorial',[+step[1]],m,'领取已完成的新手引导奖励'); return;
      }
    } else if (shelterStage === 1) {
      const daily = section('今日目标');
      const rows = [...(daily?.querySelectorAll('li') || [])].filter(visible);
      for (const [index,row] of rows.entries()) {
        const parsed = shelterReward(textOf(row).split('奖励 ')[1]?.replace(/领取$|已领$/,'').trim() || '');
        const button = buttonIn(row,'领取');
        if (rows.length === 3 && parsed && usable(button) && !m.state.daily.claimed.includes(index) && shelterFits(m,parsed.reward,parsed.items)) {
          shelterSubmit(button,'daily',[index],m,'领取已完成的避难所今日目标'); return;
        }
      }
      const free = locator.pick([...document.querySelectorAll('button')].filter(b=>/^领取免费档\s*\(\d+\)$/.test(textOf(b))));
      const tiers = Array.from({length:Math.min(30,Math.floor(m.state.season.points/150))},(_,i)=>i+1).filter(i=>!m.state.season.claimedFree.includes(i));
      const reward = {scrap:0,parts:0}; let items = 0;
      for (const tier of tiers) {
        if (tier%10===0) reward.scrap+=200*tier;
        else if (tier%5===0) items++;
        else { reward.scrap+=60*tier; reward.parts+=Math.ceil(tier/4); }
      }
      if (tiers.length && usable(free) && +textOf(free).match(/\((\d+)\)/)[1]===tiers.length && shelterFits(m,reward,items)) {
        shelterSubmit(free,'season',tiers,m,'领取避难所已达成的免费赛季档'); return;
      }
    } else {
      const roots = [...document.querySelectorAll('section[aria-label$="成就"]')].filter(visible);
      for (const root of roots) for (const row of root.querySelectorAll('li')) {
        const id = achievementIds[textOf(row.querySelector('p'))];
        const parsed = shelterReward(textOf(row).split('奖励 ')[1]?.replace(/领取$|已领$|未达成$/,'').trim() || '');
        const button = buttonIn(row,'领取');
        if (id && parsed && usable(button) && !m.state.achievements.includes(id) && shelterFits(m,parsed.reward,parsed.items)) {
          shelterSubmit(button,'achievement',[id],m,'领取已达成的避难所成就'); return;
        }
      }
    }
    shelterStage++; schedule();
  }

  function cancelQueued() {
    if (queued) clearTimeout(queued.timer);
    queued = null;
  }
  function clearIdleWait(recovered = false) {
    if (idleWait) {
      if (recovered) log.add('expedition-unblocked', '远征页面阻塞已解除，重新核对当前操作', {
        reason: idleWait.reason || '', blockedSince: idleWait.since || idleWait.at,
        blockedMs: Math.max(0, Date.now() - (idleWait.since || idleWait.at)), reloaded: idleWait.reloaded,
      });
      idleWait = null;
      sessionStorage.removeItem(IDLE_JOURNAL);
    }
    idleSignature = '';
  }
  function waitForIdlePage(reason, detail = {}) {
    idleBlocked = true;
    const now = Date.now();
    if (!idleWait || idleWait.reason !== reason || !idleWait.since) {
      idleWait = { ...(idleWait || { at: now, reloaded: false }), since: idleWait?.since || idleWait?.at || now, reason };
      sessionStorage.setItem(IDLE_JOURNAL, JSON.stringify(idleWait));
    }
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length;
    const pending = Boolean(plan || claimWait || nativePending().length);
    let loadExpired = null;
    if (detail.pageLoading) {
      const before = JSON.stringify(idleWait);
      idleWait.loadDeadline ??= (pending ? idleWait.since : idleWait.at) + (pending || !idleWait.reloaded ? 90000 : 5 * 60000);
      if (document.hidden) idleWait.loadHeldAt ??= now;
      else if (idleWait.loadHeldAt !== undefined) {
        idleWait.loadDeadline += Math.max(0, now - idleWait.loadHeldAt);
        delete idleWait.loadHeldAt;
      }
      if (JSON.stringify(idleWait) !== before) sessionStorage.setItem(IDLE_JOURNAL, JSON.stringify(idleWait));
      loadExpired = now >= idleWait.loadDeadline;
    }
    diagnostic = { ...diagnostic, blocked: reason, blockedSince: idleWait.since,
      blockedMs: Math.max(0, now - idleWait.since), reloaded: idleWait.reloaded, dialogs, ...detail,
      ...(detail.pageLoading ? { backgroundLoadWait: document.hidden, loadDeadline: idleWait.loadDeadline } : {}) };
    // 同一阻塞只在原因变化时记录，持续时长由已有低频心跳和恢复事件补充。
    const signature = JSON.stringify({ reason, dialogs, missing: detail.missing, quotaRead: detail.quotaRead,
      backgroundLoadWait: diagnostic.backgroundLoadWait, button: detail.button && {
      found: detail.button.found, connected: detail.button.connected, disabled: detail.button.disabled,
      visible: detail.button.visible, rectCount: detail.button.rectCount, css: detail.button.css, blockers: detail.button.blockers,
    } });
    if (signature !== idleSignature) {
      idleSignature = signature;
      log.add('expedition-blocked', reason, diagnostic);
    }
    // 后台未完成布局的弹窗也不能被刷新越过；可见性不足以证明它已关闭。
    if (dialogs) {
      say(`${reason}；弹窗尚未关闭，请先核对`);
      return;
    }
    if (!navigator.onLine) { say(`${reason}；网络离线，等待连接恢复`); return; }
    // 已结束的领取请求可保留原记录、重新加载只读页面；不把进行中的派遣或未知请求当作安全刷新。
    const settledClaim = claimWait && (transientClaim(claimWait.result) || claimWait.result?.outcome === 'ok');
    const recoverClaimLoad = settledClaim && !plan && !farmPlan && !nativePending().length && !stateFault('farm');
    if (detail.pageLoading && (!pending || recoverClaimLoad)) {
      expeditionLoadWait.wait(reason, true, say, message => setEnabled(false, message), true,
        recoverClaimLoad ? () => saveClaimWait({ ...claimWait, submittedAt: claimWait.submittedAt ?? claimWait.at,
          reloaded: true, reloadFrom: claimPageId, at: Date.now() }) : null);
      return;
    }
    // 尚无响应证据的原操作继续等待，不打断在途请求，也不重复提交。
    if (detail.pageLoading && document.hidden) {
      say(`${reason}；后台数据未就绪，等待页面恢复${pending ? '，原操作记录已保留' : ''}`);
      return;
    }
    if (pending) {
      if (loadExpired ?? now - idleWait.since >= 90000) setEnabled(false, `${reason}；原结果未确认，已暂停并保留记录`);
      else say(`${reason}；等待原结果，不重复提交`);
      return;
    }
    if (idleWait.reloaded && (loadExpired ?? now - idleWait.at >= 5 * 60000)) {
      setEnabled(false, `${reason}；一次刷新后仍无进展，已暂停，请核对页面`);
    } else if (!idleWait.reloaded && (loadExpired ?? now - idleWait.at >= 90000)) {
      offer('idle-refresh', '刷新并核对停滞的远征页面', () => {
        idleWait = { ...idleWait, reloaded: true, at: Date.now(), loadDeadline: undefined, loadHeldAt: undefined };
        sessionStorage.setItem(IDLE_JOURNAL, JSON.stringify(idleWait));
        log.add('expedition-idle-refresh', reason, diagnostic);
        location.reload();
      });
    } else say(`${reason}；等待页面更新${idleWait.reloaded ? '（已核对一次）' : ''}`);
  }
  function buttonState(button) {
    const connected = Boolean(button?.isConnected);
    const css = connected ? getComputedStyle(button) : null;
    const rect = connected ? button.getBoundingClientRect() : null;
    const blockers = [];
    const describe = (kind, element) => {
      let depth = 0;
      for (let node = button; node && node !== element; node = node.parentElement) depth++;
      blockers.push({ kind, tag: element.tagName.toLowerCase(), depth });
    };
    for (const [kind, selector] of [['hidden', '[hidden]'], ['aria-hidden', '[aria-hidden="true"]'], ['inert', '[inert]']]) {
      const ancestor = button?.closest(selector);
      if (ancestor) describe(kind, ancestor);
    }
    if (connected && !button.getClientRects().length) {
      for (let node = button; node; node = node.parentElement) {
        if (getComputedStyle(node).display === 'none') { describe('display-none', node); break; }
      }
    }
    // 只保存布局数值、CSS 状态和祖先标签，不导出 DOM 文本、属性值或原请求标识。
    return { found: Boolean(button), connected, visible: visible(button),
      disabled: Boolean(button?.matches(':disabled, [aria-disabled="true"]')),
      inert: Boolean(button?.closest('[inert]')), blockers,
      rectCount: connected ? button.getClientRects().length : 0,
      size: rect ? { width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 } : null,
      css: css ? { display: css.display, visibility: css.visibility, pointerEvents: css.pointerEvents } : null };
  }
  function setEnabled(value, reason = '') {
    if (value && stateFault('expedition')) { say(stateFault('expedition')); return; }
    if (!value) { cancelFarmRead(); cancelShelterRead(); cancelStockRead(); }
    enabled = value;
    try { localStorage.setItem(PREF, String(value)); } catch { /* 内存开关仍然有效 */ }
    toggle.textContent = value ? '暂停远征与农场' : '开始远征与农场';
    if (!value) { if (active) log.stop(reason || '人工暂停'); cancelQueued(); releaseLock?.(); say(reason || '已暂停'); }
    schedule();
  }
  toggle.addEventListener('click', () => {
    try {
      if (stateFault('expedition')) { say(stateFault('expedition')); return; }
      if (!enabled) {
        clearAccountStop(); recoveryBudget.clear(); clearIdleWait();
        farmWait.clear(); expeditionLoadWait.clear(); clearNavigation();
        clearStaminaSync();
        if (claimWait) {
          // 用户明确开始后重新给状态核对计时；保留原领取，不再次提交领取请求。
          saveClaimWait({ ...claimWait, submittedAt: claimWait.submittedAt ?? claimWait.at,
            at: Date.now(), reloaded: false });
          log.add('expedition-claim-recheck', '手动开始后重新核对原领取，最多刷新一次', { running: claimWait.running });
        }
      }
      setEnabled(!enabled);
    } catch { setEnabled(false, '无法保存原领取核对状态，已暂停；请检查站点存储'); }
  });
  toggle.textContent = enabled ? '暂停远征与农场' : '开始远征与农场';

  function savePlan(value) {
    // 出发前保存本脚本的意图；恢复时只确认属于这次自动派遣的原请求。
    const serialized = JSON.stringify(value);
    sessionStorage.setItem(JOURNAL, serialized);
    if (sessionStorage.getItem(JOURNAL) !== serialized) throw new Error('无法保存远征操作记录');
    plan = value;
  }
  function rendered(el) {
    return Boolean(el?.isConnected && !el.closest('[hidden]') &&
      el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }
  function visible(el) {
    return rendered(el) && !el.closest('[aria-hidden="true"]');
  }
  function usable(el) {
    return visible(el) && !el.closest('[inert]') && !el.matches(':disabled, [aria-disabled="true"]');
  }
  function currentElement(elements) { return locator.pick(elements); }
  function section(title) {
    return currentElement([...document.querySelectorAll('section')].filter(el =>
      [...el.querySelectorAll('h2')].some(heading => textOf(heading) === title)));
  }
  function buttonIn(root, matcher) {
    return currentElement([...(root?.querySelectorAll('button') || [])].filter(button =>
      typeof matcher === 'string' ? textOf(button) === matcher : matcher.test(textOf(button))));
  }
  function quotas() {
    const candidates = document.querySelectorAll('section[aria-label="远征派遣额度"]');
    const root = currentElement(candidates);
    quotaRead = { candidates: candidates.length, readable: locator.readable(root),
      readyState: document.readyState, fields: {} };
    if (!quotaRead.readable) quotaRead.layout = [...candidates].slice(0, 3).map(layoutDiagnostic);
    if (!quotaRead.readable) return null;
    function read(label, ratio) {
      const node = currentElement([...root.querySelectorAll('span')].filter(el => textOf(el) === label));
      const value = textOf(node?.parentElement).slice(label.length).trim();
      const match = value.match(ratio ? /^(\d+)\s*\/\s*(\d+)\s*支$/ : /^(\d+)\s*支$/);
      quotaRead.fields[label] = { found: Boolean(node), parsed: Boolean(match) };
      return match ? match.slice(1).map(Number) : null;
    }
    const normal = read('常态剩余', true);
    const burst = read('今日突发剩余', true);
    const running = read('当前运行', false);
    if (!normal || !burst || !running || normal[0] > normal[1] || burst[0] > burst[1]) return null;
    return { normal: normal[0], normalMax: normal[1], burst: burst[0], burstMax: burst[1], running: running[0] };
  }
  function claimPageState(q, fields, errors) {
    const running = section('进行中的远征');
    const buttons = [...(running?.querySelectorAll('button') || [])].filter(visible);
    const teams = buttons.filter(b => /^(领取|远征中)$/.test(textOf(b)));
    const ready = teams.filter(b => textOf(b) === '领取').length;
    const underway = teams.filter(b => textOf(b) === '远征中' && b.matches(':disabled')).length;
    const loading = Boolean(fields.root.querySelector('.animate-spin') || running?.querySelector('.animate-spin'));
    const consistent = !errors && !loading && (!running || visible(running)) && teams.length === q.running;
    return { consistent, teams: teams.length, ready, underway, loading, error: errors.slice(0, 300),
      allUnderway: consistent && underway === q.running && !buttons.some(b => /^一键领取/.test(textOf(b))) };
  }
  function forecast(root) {
    const node = currentElement([...(root?.querySelectorAll('[role="status"]') || [])].filter(el => /^预计派遣/.test(textOf(el))));
    const match = textOf(node).match(/^预计派遣\s*(\d+)\s*支[:：]\s*常态\s*(\d+)\s*支[，,]\s*突发\s*(\d+)\s*支/);
    if (!match || Number(match[1]) !== Number(match[2]) + Number(match[3])) return null;
    return { total: Number(match[1]), normal: Number(match[2]), burst: Number(match[3]) };
  }
  function form() {
    const root = section('自动组队派遣');
    const routes = section('选择路线');
    const count = currentElement(root?.querySelectorAll('input[aria-label="最多派遣队数"]'));
    const label = currentElement([...(root?.querySelectorAll('label') || [])].filter(el => textOf(el) === '允许使用今日突发额度'));
    const burst = currentElement(label?.querySelectorAll('input[type="checkbox"]'));
    const high = buttonIn(currentElement(root?.querySelectorAll('[aria-label="自动组队偏好"]')), '高星优先');
    const routeButton = name => currentElement([...(routes?.querySelectorAll('button') || [])].filter(el =>
      [...el.querySelectorAll('span')].some(span => textOf(span) === name)));
    return { root, count, burst, high, routeButton, forecast: forecast(root) };
  }
  function nativePending() {
    const records = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!/^expedition:\d+:(auto|manual)$/.test(key || '')) continue;
      const value = JSON.parse(sessionStorage.getItem(key));
      if (value) records.push({ key, value });
    }
    return records;
  }
  function bindOriginalRequest() {
    const records = nativePending();
    if (records.length !== 1 || !records[0].key.endsWith(':auto')) return;
    const { key, value } = records[0];
    if (typeof value.idempotencyKey !== 'string' || !value.input) return;
    savePlan({ ...plan, phase: 'submitted', original: { key, value }, submittedAt: Date.now() });
  }
  function ownOriginal(records) {
    return records.length === 1 && plan?.original && records[0].key === plan.original.key &&
      JSON.stringify(records[0].value) === JSON.stringify(plan.original.value);
  }
  function offer(key, label, perform) {
    if (accountStopReason()) { setEnabled(false, accountStopReason()); return; }
    offered = true;
    if (!queued || queued.key !== key) {
      cancelQueued();
      const delay = 2000 + Math.floor(Math.random() * 3001);
      queued = { key, dueAt: Date.now() + delay, timer: setTimeout(schedule, delay) };
    }
    const remaining = queued.dueAt - Date.now();
    if (remaining > 0) { say(`随机等待 ${(Math.ceil(remaining / 100) / 10).toFixed(1)} 秒后${label}`); return; }
    cancelQueued();
    nextStepAt = Date.now() + 500;
    say(label);
    log.add('action', label, { kind: key.split(':')[0] });
    perform();
  }
  function matchesPlan(fields) {
    return fields.routeButton(plan.route)?.getAttribute('aria-pressed') === 'true' &&
      fields.high?.getAttribute('aria-pressed') === 'true' &&
      Number(fields.count?.value) === plan.maxTeams && fields.burst?.checked === plan.allowBurst;
  }
  function closeOwnDialog(dialog, message) {
    const close = dialog.querySelector('button[aria-label="关闭"]');
    if (!usable(close)) { setEnabled(false, message); return; }
    offer('cancel-dialog', message, () => { close.click(); savePlan(null); });
  }
  function handlePlan(q, fields, records, dialogs) {
    if (plan.phase !== 'opening' && plan.phase !== 'submitted') throw new Error('无法识别原派遣记录');
    // 以服务端刷新后的额度/队伍变化确认出发，勾选和打开窗口都不算成功。
    if (plan.phase === 'submitted' && !records.length &&
        q.running >= plan.before.running + plan.total &&
        (!plan.normal || q.normal <= plan.before.normal - plan.normal) &&
        (!plan.burst || q.burst <= plan.before.burst - plan.burst)) {
      log.add('expedition-dispatched', '派遣结果已确认', { route: plan.route, normal: plan.normal, burst: plan.burst });
      if (plan.burst) localStorage.setItem(BURST_DAY, plan.day);
      recoveryBudget.clear('dispatch');
      noteQuotaSync();
      savePlan(null);
      say('派遣已确认，继续监控归来奖励');
      return;
    }
    const dialog = dialogs.find(el => textOf(el).includes('批量派遣模式'));
    if (plan.phase === 'opening' && dialog) {
      const now = beijingTime();
      if (plan.allowBurst && (!now.canBurst || now.day !== plan.day || q.burst !== q.burstMax ||
          localStorage.getItem(BURST_DAY) === now.day)) {
        closeOwnDialog(dialog, '突发日期或完整额度已变化，取消本次确认');
        return;
      }
      const preview = fields.forecast;
      if (!matchesPlan(fields) || !preview || preview.total !== plan.total ||
          preview.normal !== plan.normal || preview.burst !== plan.burst) {
        closeOwnDialog(dialog, '派遣配置已变化，重新检查');
        return;
      }
      const complete = [...dialog.querySelectorAll('[role="tab"]')].find(el => textOf(el) === '完整行程');
      if (complete && complete.getAttribute('aria-selected') !== 'true') {
        if (usable(complete)) offer('complete-mode', '选择完整行程', () => complete.click());
        return;
      }
      const confirm = buttonIn(dialog, new RegExp(`^确认完整行程\\s*·\\s*${plan.total}\\s*队$`));
      if (!usable(confirm)) { say('等待完整行程确认按钮'); return; }
      offer(`confirm:${plan.route}:${plan.total}:${plan.day}`, `确认 ${plan.total} 队${plan.route}`, () => {
        savePlan({ ...plan, phase: 'submitted', submittedAt: Date.now() });
        confirm.click();
        bindOriginalRequest();
      });
      return;
    }
    if (records.length) {
      if (!ownOriginal(records)) { say('存在其他原派遣请求，请先手动确认'); return; }
      const recovery = buttonIn(fields.root, '确认上次派遣结果');
      if (Date.now() - (plan.submittedAt || plan.at) < 30000 || !usable(recovery)) {
        say('等待原派遣结果，不重复创建队伍');
        return;
      }
      if (!recoveryBudget.ready('dispatch', plan.original.value.idempotencyKey, plan.submittedAt || plan.at,
        reason => setEnabled(false, reason), '原派遣结果')) return;
      // 只恢复已发送的原请求；即使已过两点，也不会创建一笔新的突发派遣。
      offer(`recover:${plan.original.value.idempotencyKey}`, '确认上次派遣结果', () => {
        recoveryBudget.attempted('dispatch');
        savePlan({ ...plan, submittedAt: Date.now() });
        recovery.click();
      });
      return;
    }
    if (plan.phase === 'opening' && Date.now() - plan.at > 10000) {
      savePlan(null);
      setEnabled(false, '派遣窗口已取消或未打开，自动远征已暂停');
      return;
    }
    if (plan.phase === 'submitted' && Date.now() - plan.submittedAt > 60000) {
      if (plan.reloaded) { setEnabled(false, '原派遣结果仍不明确，请手动核对后继续'); return; }
      offer('sync-result', '刷新并核对原派遣结果', () => {
        savePlan({ ...plan, reloaded: true });
        location.reload();
      });
      return;
    }
    say('等待派遣结果和额度刷新');
  }

  function saveFarmState(value) {
    const serialized = JSON.stringify(value);
    localStorage.setItem(FARM_STATE, serialized);
    if (localStorage.getItem(FARM_STATE) !== serialized) throw new Error('无法保存农场日程');
    farmState = value;
  }
  function saveFarmPlan(value) {
    const serialized = JSON.stringify(value);
    sessionStorage.setItem(FARM_JOURNAL, serialized);
    if (sessionStorage.getItem(FARM_JOURNAL) !== serialized) throw new Error('无法保存农场操作记录');
    farmPlan = value;
  }
  function farmHint() {
    if (stateFault('farm')) farmEnabled = false;
    const remaining = Math.max(0, farmState.nextAt - Date.now());
    const message = stateFault('farm') || (!farmEnabled ? `农场已暂停：${farmState.note}` :
      remaining ? `农场：${farmState.note}；约 ${Math.ceil(remaining / 60000)} 分钟后检查` : '农场：等待检查或操作');
    if (farmStatus.textContent !== message) farmStatus.textContent = message;
    farmToggle.textContent = farmEnabled ? '暂停农场' : '开启农场';
    const selected = shadow.getElementById('farm-selection');
    const description = farmState.selection || (farmCrop === 'auto' ?
      '每次种植前读取最新行情，每块扣除留种 1 份。' : `指定：${farmCrop}；下次种植生效`);
    if (selected.textContent !== description) selected.textContent = description;
  }
  function pauseFarm(message) {
    cancelFarmRead();
    farmEnabled = false;
    localStorage.setItem(FARM_PREF, 'false');
    saveFarmState({ ...farmState, note: message });
    log.add('farm-paused', message);
    cancelQueued(); say(message);
  }
  function travelLink(path) {
    return [...document.querySelectorAll('a[href]')].find(a => {
      const url = new URL(a.href, location.href);
      return url.origin === location.origin && url.pathname.replace(/\/$/, '') === path && !a.target && usable(a);
    });
  }
  function clearNavigation() {
    if (!navigation) return;
    navigation = null;
    sessionStorage.removeItem(NAV_JOURNAL);
  }
  function startNavigation(path, link) {
    navigation = { from: location.pathname.replace(/\/$/, ''), to: path, at: Date.now(), reloaded: false };
    sessionStorage.setItem(NAV_JOURNAL, JSON.stringify(navigation));
    if(link)link.click();else location.assign(path);
  }
  function waitForNavigation() {
    if (!navigation) return false;
    const path = location.pathname.replace(/\/$/, '');
    if (path !== navigation.from || navigation.to === '/farm' && !farmEnabled || navigation.to === '/shelter' && !shelterEnabled || navigation.to === '/stock' && !stockEnabled()) {
      clearNavigation(); return false;
    }
    const target = navigation.to === '/farm' ? '农场' : navigation.to === '/shelter' ? '避难所' : navigation.to === '/stock' ? '股市' : '远征';
    if (!navigator.onLine) { say(`切换${target}时网络离线，等待连接恢复`); return true; }
    if ([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(visible) ||
      plan || claimWait || farmEnabled&&farmPlan || nativePending().length) {
      say(`等待切换${target}；先核对当前弹窗或原操作`); return true;
    }
    if (!navigation.reloaded && Date.now() - navigation.at >= 30000) {
      navigation = { ...navigation, reloaded: true, at: Date.now() };
      sessionStorage.setItem(NAV_JOURNAL, JSON.stringify(navigation));
      log.add('navigation-refresh', '切页未完成，整页打开目标一次', { from: navigation.from, to: navigation.to });
      location.assign(navigation.to);
    } else say(navigation.reloaded ? `切换${target}仍未完成，等待页面恢复；可手动刷新` : `等待切换${target}完成，不重复点击`);
    return true;
  }
  function backToExpedition() {
    const link = travelLink('/activities/expedition');
    if (!link) { say('等待返回远征入口'); return; }
    offer('farm:return', '返回远征，按预约时间再检查农场', () => startNavigation('/activities/expedition', link));
  }
  function planFarmVisit(at, note) {
    // 农场已经确认不足时，记住顶部旧数值；同一旧值不能反复触发往返。
    saveFarmState({ ...farmState, nextAt: Math.max(Date.now() + 30000, at), note,
      staminaSeen: farmStaminaNeed(note) ? displayedStamina() : null });
    backToExpedition();
  }
  function farmStaminaNeed(note = farmState.note) {
    // 兼容旧版保存的体力预约。成熟预约等其他原因绝不能提前取消。
    const match = String(note || '').match(/^等待体力恢复到 (\d+) 点再(?:种植|收获)$/);
    const need = Number(match?.[1]);
    return Number.isSafeInteger(need) && need > 0 ? need : null;
  }
  function displayedStamina() {
    // 网站资源栏的 aria-label 含完整数值；图标旁文字可能隐藏上限或缩写。
    // 此值只用于唤醒农场检查，不能作为扣体力操作的依据。
    const chips = [...document.querySelectorAll('[role="group"][aria-label="我的资源"] [role="group"][aria-label^="体力 "]')].filter(visible);
    const values = chips.map(chip => {
      const match = chip.getAttribute('aria-label').normalize('NFKC').match(/^体力\s+(\d+)\/(\d+)(?:,|$)/);
      const current = Number(match?.[1]), max = Number(match?.[2]);
      return Number.isSafeInteger(current) && Number.isSafeInteger(max) && max > 0 && current <= max ? current : null;
    });
    return values.length && values[0] !== null && values.every(value => value === values[0]) ? values[0] : null;
  }
  function rememberExpeditionTime(running) {
    // 突发窗口必须在农场等待期间也能被调度；远征平时常驻，因此不依赖这个估算领奖。
    const dates = [...(running?.querySelectorAll('p') || [])].flatMap(p => {
      const m = textOf(p).match(/完整到达:\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2}):(\d{2})/);
      if (!m) return [];
      // 此处是网站 toLocaleString 的本地时区，而“预计 HH:mm”是北京时间。
      const at = new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]).getTime();
      return Number.isFinite(at) && at > Date.now() ? [at] : [];
    });
    const nextAt = dates.length ? Math.min(...dates) : 0;
    if (farmState.expeditionAt !== nextAt) saveFarmState({ ...farmState, expeditionAt: nextAt });
  }
  function overduePatrol(running) {
    // 巡逻卡公开的北京时间只精确到分钟，宽限两分钟再核对。
    // 只推断短途巡逻，避免把跨日深渊的 HH:mm 当作今天。
    const now = Date.now();
    const day = beijingTime().day;
    return [...(running?.querySelectorAll('button') || [])].some(button => {
      if (textOf(button) !== '远征中') return false;
      const card = textOf(button.parentElement);
      const match = card.match(/预计\s*(\d{1,2}):(\d{2})\s*归来/);
      if (!card.includes('边境巡逻') || !match || +match[1] > 23 || +match[2] > 59) return false;
      let at = Date.parse(`${day}T${match[1].padStart(2, '0')}:${match[2]}:00+08:00`);
      if (at - now > 12 * 3600000) at -= 86400000;
      if (now - at > 12 * 3600000) at += 86400000;
      return now - at >= 120000;
    });
  }
  function maybeVisitFarm(running) {
    if (!farmEnabled) return false;
    let earlyStamina = null;
    if (farmState.nextAt > Date.now() && !farmPlan) {
      const need = farmStaminaNeed();
      if (!need) return false;
      const shown = displayedStamina();
      if (shown === null || shown === farmState.staminaSeen) return false;
      if (shown < need) {
        saveFarmState({ ...farmState, staminaSeen: shown });
        return false;
      }
      earlyStamina = shown;
    }
    const link = travelLink('/farm');
    if (!link) {
      waitForIdlePage('农场已到预约时间，但入口不可用');
      return true;
    }
    rememberExpeditionTime(running);
    // 距离已知的归来时间只剩十几秒时，先等这一批归来，不立即切走。
    if (farmState.expeditionAt > Date.now() && farmState.expeditionAt - Date.now() < 15000) return false;
    offer(earlyStamina === null ? 'farm:visit' : `farm:visit:stamina:${earlyStamina}`,
      earlyStamina === null ? '切换到农场检查收获与种植' : '顶部体力有变化，提前到农场核对', () => {
        // 只在实际切页时清除旧预约；等待期间数值下降或暂停仍可撤销。
        if (earlyStamina !== null) {
          saveFarmState({ ...farmState, nextAt: 0, staminaSeen: earlyStamina });
          log.add('farm-stamina-wake', '顶部体力变化，提前检查；尚未确认实际可用体力', { displayed: earlyStamina });
        }
        startNavigation('/farm', link);
      });
    return true;
  }
  function farmSnapshot() {
    const timeline = currentElement([...document.querySelectorAll('details')].filter(d => /^全场成熟时间轴/.test(textOf(d.querySelector('summary')))));
    const staminaNode = currentElement([...document.querySelectorAll('[title]')].filter(el =>
      /^每\s*\d+\s*分钟自然恢复\s*1\s*点体力$/.test(el.title) && /^体力\s/.test(textOf(el))));
    const s = textOf(staminaNode).match(/^体力\s*(\d+)\s*\/\s*(\d+)(?:\s*\((\d+):(\d+)\s*恢复 1 点\))?/);
    if (!locator.readable(timeline) || !locator.readable(staminaNode) || !s) return null;
    const entries = [...timeline.querySelectorAll('li')].map(li => {
      const number = textOf(li).match(/^(\d+)\s*号地/);
      const time = li.querySelector('time[datetime]');
      // 名称取时间元素前面的文本，日期展示格式不影响成熟时间。
      const label = time?.parentElement?.cloneNode(true);
      label?.querySelector('time')?.remove();
      return { plot: number ? +number[1] : NaN, crop: textOf(label).replace(/^\d+\s*号地\s*·\s*/, ''),
        at: Date.parse(time?.getAttribute('datetime') || '') };
    });
    if (entries.some(e => !Number.isFinite(e.at) || !Number.isInteger(e.plot))) return null;
    const compact = locator.query('section[aria-label="紧凑经营视图"]');
    // 模态窗口会把背景设为 inert/aria-hidden；背景数据仍需读取，但绝不点击。
    const laidOut = el => Boolean(el?.getClientRects().length && getComputedStyle(el).display !== 'none');
    const empty = locator.all(document.querySelectorAll('button[aria-label="空地块，点击种植"]')).filter(laidOut);
    if (laidOut(compact)) empty.push(...[...compact.querySelectorAll('button')].filter(b => textOf(b) === '选择种子' && laidOut(b)));
    const count = textOf(timeline.querySelector('summary')).match(/(\d+)\s*块种植中/);
    if (!count || Number(count[1]) !== entries.length || entries.length + empty.length === 0) return null;
    return { timeline, entries, empty, total: entries.length + empty.length,
      ready: entries.filter(e => e.at <= Date.now()), stamina: +s[1], max: +s[2],
      regen: Number(staminaNode.title.match(/\d+/)[0]) * 60000,
      nextRegen: s[3] === undefined ? null : (+s[3] * 60 + +s[4]) * 1000 };
  }
  function staminaReadyAt(s, need, at = Date.now()) {
    return at + (s.nextRegen ?? s.regen) + Math.max(0, need - s.stamina - 1) * s.regen + 2000;
  }
  function clearStaminaSync() {
    if (!staminaSync) return;
    staminaSync = null;
    sessionStorage.removeItem(STAMINA_SYNC);
  }
  function checkFarmStamina(s, need, action, latest = false) {
    if (!latest && s.stamina >= need && !farmStaminaNeed()) { clearStaminaSync(); return true; }
    if (!farmMarket || Date.now() - farmMarket.at > 15000) {
      readFarmMarket('核对最新农场体力与田地'); return false;
    }
    const data = farmMarket.data.stamina;
    if (!Number.isSafeInteger(data.current) || data.current < 0 || !Number.isSafeInteger(data.max) ||
        data.max < need || data.current > data.max || !Number.isFinite(data.regenMinutes) || data.regenMinutes <= 0 ||
        data.nextRegenSeconds != null && (!Number.isFinite(data.nextRegenSeconds) || data.nextRegenSeconds < 0 || data.nextRegenSeconds > data.regenMinutes * 60)) {
      pauseFarm('最新体力或恢复时间无法核对，请检查农场状态'); return false;
    }
    const detail = { action, current: data.current, needed: need, pageStamina: s.stamina,
      displayed: displayedStamina(), checkedAt: farmMarket.at };
    if (data.current < need) {
      const note = `等待体力恢复到 ${need} 点再${action}`;
      const nextAt = Math.max(Date.now() + 30000, staminaReadyAt({ stamina: data.current,
        regen: data.regenMinutes * 60000, nextRegen: data.nextRegenSeconds == null ? null : data.nextRegenSeconds * 1000 }, need, farmMarket.at));
      if (farmState.nextAt !== nextAt || farmState.note !== note) {
        saveFarmState({ ...farmState, nextAt, note, staminaSeen: detail.displayed });
        log.add('farm-stamina-wait', '按最新体力预约下一次农场检查', { ...detail, nextAt });
      }
      if (ownSeedDialog) {
        const close = ownSeedDialog.querySelector('button[aria-label="关闭"]');
        if (usable(close)) offer('farm:stamina-close', '关闭种子窗口，等待体力恢复', () => close.click());
        else say('最新体力不足，请关闭种子窗口后等待恢复');
      } else backToExpedition();
      return false;
    }
    if (s.stamina < need) {
      if (staminaSync) {
        if (Date.now() - farmEntryAt >= 10000) pauseFarm('最新体力已足够，但刷新后农场仍显示旧值；请核对页面后开启农场');
        else say('已刷新核对体力，等待农场页面更新');
      } else if (!plan && !claimWait && !nativePending().length &&
          !document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        offer('farm:stamina-sync', '刷新农场，核对已恢复的体力', () => {
          staminaSync = { at: Date.now(), reloadFrom: claimPageId };
          sessionStorage.setItem(STAMINA_SYNC, JSON.stringify(staminaSync));
          log.add('farm-stamina-refresh', '最新体力足够但农场显示不足，整页核对一次', { ...detail, reloadFrom: claimPageId });
          location.reload();
        });
      } else say('体力已恢复，等待当前弹窗或原操作核对后刷新农场');
      return false;
    }
    clearStaminaSync();
    if (farmStaminaNeed()) {
      saveFarmState({ ...farmState, nextAt: 0, note: `体力已核对，准备${action}`, staminaSeen: detail.displayed });
      log.add('farm-stamina-ready', '最新体力与农场页面均已满足操作要求', detail);
    }
    return true;
  }
  function readFarmMarket(message = '读取本轮最新行情与种植加成') {
    if (farmMarketLoading) return;
    if (!navigator.onLine) { say('农场行情：网络离线，等待连接恢复'); return; }
    if (Date.now() < farmReadNextAt) { say('农场行情暂时不可用，等待有限重试'); return; }
    const generation = farmReadGeneration;
    const current = () => generation === farmReadGeneration && inFarm() && enabled && farmEnabled && active && !accountStopReason();
    farmReadController = new AbortController();
    farmReadAttempts++;
    farmMarketLoading = true;
    say(message);
    // 只读网站原有状态接口，保留 priceMilli 精度；种植、收获仍只点网页原按钮。
    fetch('/api/farm', { cache: 'no-store', credentials: 'same-origin',
      signal: AbortSignal.any([farmReadController.signal, AbortSignal.timeout(15000)]) })
      .catch(error => { throw Object.assign(error, { transient: true }); })
      .then(async response => {
        if (!current()) return;
        if (!response.ok) throw Object.assign(new Error(`农场状态读取失败（${response.status}）`), {
          stopGroup: [401, 403, 429].includes(response.status), transient: response.status >= 500
        });
        const data = await response.json();
        if (!current()) return;
        if (!Number.isSafeInteger(data.userId) || !Array.isArray(data.seeds) || !Array.isArray(data.prices) ||
            !Array.isArray(data.plots) || !Array.isArray(data.crops) || !Array.isArray(data.inventory) ||
            !data.stamina || data.staminaCosts?.plant !== 1 || data.staminaCosts?.harvest !== 1) {
          throw new Error('农场数据或体力规则变化');
        }
        if (farmState.userId && farmState.userId !== data.userId) {
          throw Object.assign(new Error('农场账号已切换，请核对日程'), { stopGroup: true });
        }
        farmMarket = { data, at: Date.now() };
        farmReadAttempts = 0; farmReadNextAt = 0;
        if (!farmState.userId) saveFarmState({ ...farmState, userId: data.userId });
      })
      .catch(error => {
        if (!current()) return;
        farmMarket = null;
        if (error.stopGroup) pauseAccount(error.message);
        else if (error.transient && farmReadAttempts < 3) {
          farmReadNextAt = Date.now() + (farmReadAttempts === 1 ? 5000 : 15000);
          log.add('farm-read-retry', '只读行情暂时失败，延后核对', { attempt: farmReadAttempts, nextAt: farmReadNextAt });
          say('农场行情暂时不可用，等待有限重试');
        }
        else pauseFarm(`${error.message}；本轮未种植，请核对后开启农场`);
      })
      .finally(() => { if (generation === farmReadGeneration) { farmMarketLoading = false; farmReadController = null; schedule(); } });
  }
  function bestFarmSeed(dialog, s) {
    const data = farmMarket.data;
    const prices = new Map(data.prices.map(p => [p.seedId, p.priceMilli / 1000]));
    const occupied = new Set(data.crops.map(c => c.plotIndex));
    const empty = data.plots.filter(p => !occupied.has(p.plotIndex));
    if (data.crops.length !== s.entries.length || empty.length !== s.empty.length ||
        data.plots.length !== s.total) return { error: '农场种植地块发生变化，请重新检查' };
    if (data.stamina.current < empty.length) return { error: '最新体力不足以种满空地，请恢复后检查' };
    const candidates = [];
    const seen = new Set();
    for (const button of dialog.querySelectorAll('button')) {
      if (!usable(button)) continue;
      const name = textOf(button.querySelector('span.font-semibold'));
      if (!CROPS.includes(name)) continue;
      if (farmCrop !== 'auto' && name !== farmCrop) continue;
      const text = textOf(button);
      const free = text.match(/免费\s*·\s*存货\s*(\d+)/);
      if (!free || +free[1] < s.empty.length) continue; // 不自动补购种子。
      const seed = data.seeds.find(seed => seed.name === name);
      if (!seed) return { error: `${name}的种子数据无法核对` };
      const available = (data.seedPouch?.[seed.key] || 0) + data.inventory.filter(i => i.seedKey === seed.key).reduce((sum,i) => sum+i.quantity,0);
      if (available < empty.length || (seed.minSoilLevel || 0) > (data.soilLevel || 0)) continue;
      seen.add(name);
      const cost = button.querySelector('[title*="种植消耗"]')?.title.match(/种植消耗\s*(\d+)\s*体力/);
      if (!cost || Number(cost[1]) !== 1) return { error: '种植体力规则变化，请手动核对' };
      if (farmCrop !== 'auto' && name === farmCrop) return { button, name, description: `指定种植：${name}；每块留种 1 份` };
      // 与网站展示预计时间/产量的公式相同；读到的是本轮最新种子、地块、活动参数。
      const durations = data.plots.map(p => Math.round(1000 * seed.growSeconds *
        Math.max(.4, Math.max(.5, data.growthMultiplier ?? 1) * (1-Math.max(0,Math.min(20,p.growthPct))/100)) /
        Math.max(.1, data.growSpeedMultiplier ?? 1)));
      const harvest = data.plots.reduce((sum,p) => sum + seed.yieldQuantity*(1+p.yieldPct/100)-1, 0);
      const price = prices.get(seed.id);
      const growth = Math.max(...durations);
      const regen = Number(data.stamina.regenMinutes) * 60000;
      if (!(growth > 0) || !(harvest > 0) || !(price > 0) || !(regen > 0) || !Number.isFinite(growth+harvest+price+regen)) {
        return { error: `${name}的成熟时间、产量或最新售价无法读取` };
      }
      // 统一作物长期循环：全场一轮需 2N 体力，每块减一份留种。
      const cycle = Math.max(growth, 2 * data.plots.length * regen);
      const income = harvest * price * 3600000 / cycle;
      candidates.push({ button, name, income });
    }
    if (farmCrop !== 'auto') return { error: `${farmCrop}未解锁或免费存货不足，暂不种植` };
    if (!candidates.length || !seen.size) return { error: '没有足够免费存货的可选作物，暂不种植' };
    candidates.sort((a,b) => b.income - a.income);
    const best = candidates[0];
    return { ...best, description: `当前选 ${best.name}：留种后约 ${best.income.toFixed(1)} 代币/小时（普通品质）` };
  }
  function farmStep() {
    farmEntryAt ||= Date.now();
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    if (!farmEnabled) {
      if (dialogs.length === 1 && dialogs[0] === ownSeedDialog) {
        const close = ownSeedDialog.querySelector('button[aria-label="关闭"]');
        if (usable(close)) offer('farm:pause-close', '关闭本脚本的种子窗口', () => close.click());
        return;
      }
      if (dialogs.length) { say('农场已暂停，请手动处理当前弹窗'); return; }
      backToExpedition(); return;
    }
    const fatal = [...document.querySelectorAll('[role="alert"], [role="status"]')].filter(el =>
      visible(el) && (el.classList.contains('text-destructive') || el.classList.contains('bg-destructive'))).map(textOf).join(' ');
    if (fatal) { pauseFarm(`农场提示：${fatal}；请核对后开启农场`); return; }
    if (!dialogs.length) { ownSeedDialog = null; }
    if (dialogs.length && !ownSeedDialog) {
      const seedDialog = dialogs.find(d => [...d.querySelectorAll('h2')].some(h => textOf(h).startsWith('选择种子')));
      if (openingSeedsAt && Date.now() - openingSeedsAt < 10000 && seedDialog && dialogs.length === 1) {
        ownSeedDialog = seedDialog; openingSeedsAt = 0;
      } else { handleNotice(dialogs, '等待你处理农场弹窗'); return; }
    }
    const tabs = locator.query('[role="tablist"][aria-label="农场功能"]');
    const plotsTab = [...(tabs?.querySelectorAll('[role="tab"]') || [])].find(b => textOf(b) === '田地');
    if (!dialogs.length && plotsTab && plotsTab.getAttribute('aria-selected') !== 'true') {
      if (usable(plotsTab)) offer('farm:plots', '切换田地页', () => plotsTab.click());
      return;
    }
    const s = farmSnapshot();
    if (!s) {
      farmWait.wait('等待田地、成熟时间和体力数据加载', !farmPlan && !dialogs.length, say, pauseFarm, true);
      return;
    }
    const signature = JSON.stringify(s.entries.map(e => [e.plot,e.crop,e.at])) + ':' + s.empty.length;
    if (signature !== farmSignature) { farmSignature = signature; farmChangedAt = Date.now(); }
    if (farmPlan) {
      const plots = new Map(s.entries.map(e => [e.plot,e.crop]));
      const confirmed = farmPlan.action === 'harvest' ? farmPlan.plots.some(p => !plots.has(p)) :
        s.empty.length < farmPlan.empty && s.entries.some(e => !farmPlan.plots.includes(e.plot) && e.crop === farmPlan.crop);
      if (confirmed && Date.now() - farmChangedAt >= 1500) {
        log.add(`farm-${farmPlan.action}-confirmed`, '田地变化已确认；不计作出售收入',
          { crop: farmPlan.crop || '', plots: farmPlan.action === 'harvest' ? farmPlan.plots.length : farmPlan.empty });
        saveFarmPlan(null); farmMarket = null;
      } else {
        if (Date.now() - farmPlan.at > 30000 && !farmPlan.reloaded) {
          if (dialogs.length === 1 && dialogs[0] === ownSeedDialog) {
            // 网站会等种植请求结束才关窗。先关自己的窗口，保留原操作记录，再刷新核对。
            // 关闭窗口不代表请求取消或失败，绝不能据此重复种植。
            const close = ownSeedDialog.querySelector('button[aria-label="关闭"]');
            if (usable(close)) offer('farm:close-pending', '关闭种子窗口，准备核对原种植结果', () => close.click());
            else say('原种植结果未确认，请手动关闭种子窗口后核对');
          } else if (!dialogs.length) {
            offer('farm:sync-result', '刷新核对上次农场操作结果', () => {
              saveFarmPlan({ ...farmPlan, reloaded: true }); location.reload();
            });
          } else say('原农场结果未确认，等待你处理当前弹窗');
        } else if (farmPlan.reloaded && Date.now() - farmEntryAt > 10000 && !confirmed) {
          pauseFarm('原农场结果仍无法确认，已停止重复操作；请手动核对');
        } else say('等待农场原操作落定，不重复种植或收获');
        return;
      }
    }
    if (ownSeedDialog) {
      const dialog = ownSeedDialog;
      if (dialogs.length !== 1 || dialogs[0] !== dialog) { say('等待你处理当前弹窗'); return; }
      if (s.empty.length === 0 || s.stamina < s.empty.length) {
        const close = dialog.querySelector('button[aria-label="关闭"]');
        if (usable(close)) offer('farm:close', '关闭种子窗口并等待体力', () => close.click());
        return;
      }
      const all = buttonIn(dialog, /^(?:只种这一块|种满全部)/);
      if (s.empty.length > 1 && (!all || all.getAttribute('aria-pressed') !== 'true')) {
        if (usable(all)) offer('farm:all', `选择种满 ${s.empty.length} 块空地`, () => all.click());
        else say('等待种满全部空地按钮');
        return;
      }
      // 用户曾设置收获时间筛选时，自动模式仍需比较完整作物列表。
      const filter = [...dialog.querySelectorAll('label')].find(l => textOf(l).startsWith('希望多久内收获'))?.querySelector('select');
      if (filter && filter.value !== '0') {
        if (usable(filter)) offer('farm:filter', '显示全部可选作物', () => {
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(filter, '0');
          filter.dispatchEvent(new Event('change', { bubbles: true }));
        });
        return;
      }
      if (!farmMarket || Date.now() - farmMarket.at > 15000) { readFarmMarket(); return; }
      if (!checkFarmStamina(s, s.empty.length, '种植', true)) return;
      const best = bestFarmSeed(dialog,s);
      if (best.error) {
        const close = dialog.querySelector('button[aria-label="关闭"]');
        if (usable(close)) offer('farm:seed-error', '关闭种子窗口', () => { close.click(); pauseFarm(best.error); });
        else say(best.error);
        return;
      }
      if (farmState.selection !== best.description) saveFarmState({ ...farmState, selection: best.description });
      offer(`farm:plant:${best.name}:${s.empty.length}:${farmCrop}`, `种植 ${s.empty.length} 块${best.name}`, () => {
        log.add('farm-estimate', best.description, { crop: best.name, estimatedHourlyValue: best.income ?? null });
        saveFarmPlan({ action:'plant', crop:best.name, empty:s.empty.length, plots:s.entries.map(e=>e.plot), at:Date.now() });
        best.button.click();
      });
      return;
    }
    if (openingSeedsAt) {
      if (Date.now() - openingSeedsAt < 10000) { say('等待种子窗口'); return; }
      openingSeedsAt = 0; pauseFarm('种子窗口未打开，请核对农场页面'); return;
    }
    if (farmState.nextAt > Date.now()) {
      const need = farmStaminaNeed();
      if (need && s.stamina >= need) { if (!checkFarmStamina(s, need, farmState.note.endsWith('收获') ? '收获' : '种植')) return; }
      else { backToExpedition(); return; }
    }
    if (s.ready.length) {
      const need = s.ready.length;
      if (!checkFarmStamina(s, need, '收获')) return;
      const harvest = [...document.querySelectorAll('button')].find(b => usable(b) && /^一键收获\s*\(\d+\)$/.test(textOf(b)));
      if (!harvest) {
        // 页面自身更新无效时，本批田地最多整页核对一次。跨刷新保留预算。
        if (recoveryBudget.ready('farm-ready', signature, farmEntryAt + 30000, pauseFarm, '农场成熟状态', 1)) {
          offer('farm:refresh-ready', '刷新已到成熟时间的田地', () => {
            recoveryBudget.attempted('farm-ready'); location.reload();
          });
        } else if (farmEnabled) planFarmVisit(recoveryBudget.nextAt('farm-ready'), '等待页面确认成熟状态');
        return;
      }
      recoveryBudget.clear('farm-ready');
      const count = Number(textOf(harvest).match(/\((\d+)\)/)[1]);
      if (count !== need) {
        farmWait.wait('等待一键收获数量与成熟地块一致', !farmPlan && !dialogs.length, say, pauseFarm); return;
      }
      offer(`farm:harvest:${s.ready.map(e=>e.plot).join(',')}`, `一键收获 ${count} 块田地`, () => {
        saveFarmPlan({action:'harvest',plots:s.ready.map(e=>e.plot),at:Date.now()}); farmMarket = null; harvest.click();
      });
      return;
    }
    if (s.empty.length) {
      const need = s.empty.length;
      if (!checkFarmStamina(s, need, '种植')) return;
      const empty = s.empty.find(usable);
      if (!empty) { say('等待农场操作完成'); return; }
      offer('farm:seeds', '打开空地选择种子', () => { openingSeedsAt = Date.now(); empty.click(); });
      return;
    }
    const next = Math.min(...s.entries.map(e=>e.at));
    planFarmVisit(next + 2000, '作物生长中');
  }

  function step() {
    syncDialogAnimations();
    farmHint();
    shelterHint();
    stockHint();
    if (!inStock() && (stockEntryAt || stockController || stockRead)) {
      cancelStockRead();stockEntryAt=0;stockLeave=false;stockActions=0;
    }
    if (!inShelter() && (shelterEntryAt || shelterController || shelterRead)) {
      cancelShelterRead(); shelterEntryAt = 0; shelterStage = 0; shelterActions = 0; shelterLeave = false;
      shelterWork = null; shelterStaffHold = false;
    }
    if (host.hidden === onPage()) host.hidden = !onPage();
    if (onPage()) log.receipts();
    if (accountStopReason()) {
      if (enabled) setEnabled(false, accountStopReason()); else say(accountStopReason());
      return;
    }
    if (stateFault('expedition')) {
      if (enabled) setEnabled(false, stateFault('expedition')); else say(stateFault('expedition'));
      return;
    }
    if (!onPage() || !enabled || pageFrozen) {
      if (!onPage()) clearNavigation();
      if (farmMarketLoading) cancelFarmRead();
      if (shelterController) cancelShelterRead();
      if (stockController) cancelStockRead();
      releaseLock?.(); return;
    }
    if (!navigator.locks) { setEnabled(false, '请使用支持标签页互斥的新版浏览器'); return; }
    if (!active) { acquire(); return; }
    log.pulse(status.textContent, { ...diagnostic,
      pageRecovery: (inFarm() ? farmWait : expeditionLoadWait).snapshot() });
    const errors = [...document.querySelectorAll('[role="status"].text-destructive, [role="status"].bg-destructive, [role="alert"].text-destructive, [role="alert"].bg-destructive')].filter(visible).map(textOf).join(' ');
    if (/(?:\b(?:401|403|429)\b|cyber_abuse|abuse_detected|user_disabled|未登录|登录.*(?:失效|过期)|账号已切换|封禁|禁用|访问被拒绝|权限不足|频率|频繁|限流|rate.?limit|unauthori[sz]ed|forbidden)/i.test(errors)) {
      pauseAccount('游戏提示登录、权限或限流异常');
      return;
    }
    if (Date.now() < nextStepAt) return;
    // reload 不会同步销毁当前文档。旧页面不能按“刷新后仍旧值”暂停农场或继续操作。
    if (staminaSync?.reloadFrom === claimPageId) {
      say('农场刷新已发起，等待新页面接管'); return;
    }
    if (waitForNavigation()) return;
    if (inStock()) {
      expeditionObserved=false;
      if(farmEntryAt || farmMarketLoading){cancelFarmRead();farmEntryAt=0;}
      try{stockStep();}catch(error){if(!stockRetryChange(error)){
        stockFault='股市检查异常，保留原记录并停止股市操作';stockLeave=true;cancelStockRead();log.add('stock-error',stockFault);
      }}
      return;
    }
    if (inShelter()) {
      expeditionObserved = false;
      if (farmEntryAt || farmMarketLoading) { cancelFarmRead(); farmEntryAt = 0; }
      try { shelterStep(); }
      catch(error) { if(!shelterRetryChange(error))pauseShelter('避难所检查异常，已暂停并保留原记录'); }
      return;
    }
    if (inFarm()) { expeditionObserved = false; farmStep(); return; }
    if (farmEntryAt || farmMarketLoading || farmReadAttempts) cancelFarmRead();
    farmEntryAt = 0; farmSignature = ''; ownSeedDialog = null; openingSeedsAt = 0; farmMarket = null;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    // 用户可在首次扫描前打开弹窗，不能要求先识别被遮住的背景表单。
    if (!plan && dialogs.length) { handleNotice(dialogs, '等待你处理当前弹窗'); return; }
    const q = quotas();
    const fields = form();
    diagnostic = { quota: q, farmEnabled, farmDueAt: farmState.nextAt || 0,
      shelterEnabled, shelterDueAt:shelterState.nextAt, pendingShelter:Boolean(shelterPending),
      pendingDispatch: Boolean(plan), pendingClaim: Boolean(claimWait) };
    if (!q || !fields.root || !fields.count || !fields.burst || !fields.high) {
      waitForIdlePage('等待远征页面和额度加载', { pageLoading: true,
        ...(!q ? { quotaRead } : {}),
        missing: { quota: !q, form: !fields.root, count: !fields.count, burst: !fields.burst, preference: !fields.high } });
      return;
    }
    if (!expeditionObserved) { noteQuotaSync(); expeditionObserved = true; }
    const records = nativePending();
    if (plan) { handlePlan(q, fields, records, dialogs); return; }
    if (records.length) { say('存在手动派遣待确认，请先处理原请求'); return; }
    if (dialogs.length) { say('等待你处理当前弹窗'); return; }

    const running = section('进行中的远征');
    const claimAll = buttonIn(running, /^一键领取\s*\(\d+\)$/);
    const claimOne = buttonIn(running, '领取');
    const claim = usable(claimAll) ? claimAll : usable(claimOne) ? claimOne : null;
    if (claimWait) {
      const current = claimPageState(q, fields, errors);
      diagnostic.claim = { beforeRunning: claimWait.running, since: claimWait.submittedAt ?? claimWait.at,
        reloaded: Boolean(claimWait.reloaded), retries: claimWait.retries || 0,
        result: claimWait.result || null, ...current };
      if (current.consistent && (q.running < claimWait.running || current.allUnderway)) {
        if (q.running < claimWait.running) {
          log.add('expedition-claimed', '远征领取后队伍减少已确认', { teams: claimWait.running - q.running });
        } else {
          // 手动领取并重新派满时总数不变；完整列表均在途中，原待领奖励已无对应目标。
          // 只结束旧等待，不推断奖励金额；收入仍仅由新的原网页到账回执确认。
          log.add('expedition-claim-reconciled', '当前队伍均在途中，结束旧领取等待',
            { beforeRunning: claimWait.running, running: q.running });
        }
        saveClaimWait(null);
        claimStable = null;
        noteQuotaSync();
      }
      else {
        if (!navigator.onLine) { claimStable = null; say('领取结果待核对；网络离线，恢复连接后继续'); return; }
        if (recoverLegacyClaimEvidence()) { say('正在从本地日志核对旧领取请求'); return; }
        const freshPage = claimWait.reloaded && claimWait.reloadFrom && claimWait.reloadFrom !== claimPageId;
        const ready = claimWait.ready ?? claimWait.running;
        const countMatches = claim === claimAll ? Number(textOf(claimAll).match(/\((\d+)\)/)?.[1]) === ready : ready === 1;
        const canRetry = freshPage && !claimWait.retries && transientClaim(claimWait.result) &&
          current.consistent && q.running === claimWait.running && current.ready === ready &&
          current.ready + current.underway === q.running && claim && countMatches;
        if (!canRetry) claimStable = null;
        else {
          const signature = JSON.stringify([q, current.ready, current.underway, textOf(claim)]);
          if (claimStable?.signature !== signature) claimStable = { signature, at: Date.now() };
        }
        if (claimWait.reloaded && Date.now() - claimWait.at > 60000) {
          if (canRetry) {
            if (Date.now() - claimStable.at < 2000) { say('刷新后仍有待领奖励，等待队伍状态稳定'); return; }
            offer('retry-claim', '补领页面已确认的待领奖励（最多一次）', () => submitClaim(claim, q, ready, true));
            return;
          }
          log.add('expedition-claim-unconfirmed', '一次刷新后仍无法确认原领取', diagnostic.claim);
          setEnabled(false, claimWait.retries ? `${claimReason()}；补领一次后仍未确认，已暂停。请手动一键领取，到账后再开始` :
            '原领取结果仍无法确认，已暂停并保留记录；请手动一键领取，到账后再开始');
        } else if (!claimWait.reloaded && Date.now() - claimWait.at > 30000) {
          offer('sync-claim', '刷新领取后的状态', () => {
            saveClaimWait({ ...claimWait, submittedAt: claimWait.submittedAt ?? claimWait.at,
              reloaded: true, reloadFrom: claimPageId, at: Date.now() }); location.reload();
          });
        }
        else say(`${claimReason()}；${claimWait.reloaded ? '已刷新，等待核对待领队伍' : '等待队伍变化，超时后刷新核对'}`);
        return;
      }
    }
    // 跨日不打断当前页面；优先由领取、派遣和正常切页更新额度。
    if (beijingTime().day !== observedDay) {
      observedDay = beijingTime().day;
      noteQuotaSync();
      log.add('expedition-day', '跨日继续等待归来，沿用正常操作更新额度');
    }
    idleChecked = true;
    if (claim) {
      offer(`claim:${q.running}:${textOf(claim)}`, '领取已完成的远征奖励', () => {
        submitClaim(claim, q, claimPageState(q, fields, errors).ready);
      });
      return;
    }
    if (fields.root.querySelector('.animate-spin') || running?.querySelector('.animate-spin')) {
      waitForIdlePage('等待远征页面加载完成');
      return;
    }
    if ((claimAll || claimOne) && !claim) {
      waitForIdlePage('远征已显示领取，但按钮不可用', { button: buttonState(claimAll || claimOne) });
      return;
    }
    if (overduePatrol(running)) {
      waitForIdlePage('巡逻已过预计归来时间，页面仍显示远征中');
      return;
    }

    // 服务器总是优先使用常态名额，因此先补巡逻，再派纯突发深渊。
    const nowForBurst = beijingTime();
    const burstUsed = localStorage.getItem(BURST_DAY) === nowForBurst.day;
    const burst = q.normal === 0 && nowForBurst.canBurst && !burstUsed && q.burst > 0 && q.burst === q.burstMax;
    if (q.normal === 0 && !burst) {
      if (maybeVisitFarm(running)) return;
      if (maybeVisitShelter(running)) return;
      if (maybeVisitStock(running)) return;
      // 优先复用正常领取、派遣及返回页面后的状态；无更新一小时才兜底，全天最多两次。
      const quotaCheck = quotaCheckState();
      if (!burstUsed && nowForBurst.canBurst && q.burst < q.burstMax && quotaCheck.count < 2 &&
          Date.now() - quotaCheck.at >= 60 * 60000) {
        offer('refresh-quota', '重新读取今日突发额度', () => {
          const count = quotaCheck.count + 1;
          localStorage.setItem(QUOTA_REFRESH, JSON.stringify({ ...quotaCheck, count, at: Date.now() }));
          log.add('quota-refresh', '无正常状态更新，兜底检查突发额度', { count, limit: 2 });
          location.reload();
        });
        return;
      }
      say(burstUsed || q.burst < q.burstMax ? '今日突发已使用或额度不完整；持续等待远征归来' : '巡逻进行中；突发等待北京时间 1 点');
      return;
    }
    const route = burst ? '深渊远征' : '边境巡逻';
    const maxTeams = burst ? Math.min(TEAM_LIMIT, q.burst) : TEAM_LIMIT;
    const selected = fields.routeButton(route);
    if (!selected) { waitForIdlePage(`未找到${route}路线`); return; }
    if (selected.getAttribute('aria-pressed') !== 'true') {
      if (usable(selected)) offer(`route:${route}`, `选择${route}`, () => selected.click());
      else waitForIdlePage(`${route}路线按钮不可用`, { button: buttonState(selected) });
      return;
    }
    if (fields.high.getAttribute('aria-pressed') !== 'true') {
      if (usable(fields.high)) offer('high-stars', '选择高星优先', () => fields.high.click());
      else waitForIdlePage('高星优先按钮不可用', { button: buttonState(fields.high) });
      return;
    }
    if (Number(fields.count.value) !== maxTeams) {
      if (usable(fields.count)) offer(`teams:${maxTeams}`, `设置最多 ${maxTeams} 队`, () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(fields.count, String(maxTeams));
        fields.count.dispatchEvent(new Event('input', { bubbles: true }));
        fields.count.dispatchEvent(new Event('change', { bubbles: true }));
      });
      else waitForIdlePage('派遣队数输入框不可用', { button: buttonState(fields.count) });
      return;
    }
    if (fields.burst.checked !== burst) {
      if (usable(fields.burst)) offer(`burst:${burst}`, burst ? '允许使用今日突发额度' : '关闭突发额度', () => fields.burst.click());
      else waitForIdlePage('突发额度开关不可用', { button: buttonState(fields.burst) });
      return;
    }
    const preview = fields.forecast;
    if (!preview || preview.total < 1) {
      if (maybeVisitFarm(running)) return;
      if (maybeVisitShelter(running)) return;
      if (maybeVisitStock(running)) return;
      say('等待符合条件的英雄或可用名额'); return;
    }
    if (burst ? preview.normal !== 0 || preview.burst !== maxTeams : preview.burst !== 0 || preview.normal > q.normal) {
      say('等待派遣预览与常态／突发额度一致');
      return;
    }
    const dispatch = buttonIn(fields.root, new RegExp(`^派出\\s*${preview.total}\\s*支队伍$`));
    if (!usable(dispatch)) { waitForIdlePage('等待派遣按钮可以点击', { button: buttonState(dispatch) }); return; }
    const now = beijingTime();
    offer(`dispatch:${route}:${preview.total}:${q.normal}:${q.burst}:${now.day}`, `派出 ${preview.total} 队${route}`, () => {
      if (burst) log.add('burst-schedule', now.inWindow ? '凌晨优先派遣深渊' : '发现完整未用额度，补派深渊', { day: now.day });
      savePlan({ phase: 'opening', route, allowBurst: burst, maxTeams, total: preview.total,
        normal: preview.normal, burst: preview.burst, before: q, day: now.day, at: Date.now() });
      dispatch.click();
      // 兼容页面关闭批量确认功能时直接出发的情况。
      bindOriginalRequest();
    });
  }

  function acquire() {
    if (acquiring || pageFrozen) return;
    acquiring = true;
    navigator.locks.request(LOCK, { ifAvailable: true }, async lock => {
      if (!lock || !enabled || !onPage() || pageFrozen) { if (enabled && onPage() && !pageFrozen) say('另一远征标签页正在运行'); return; }
      if(shelterReload()){cancelShelterRead();cancelQueued();}
      stockReload();
      active = true;
      try { await new Promise(resolve => { releaseLock = resolve; schedule(); }); }
      finally { active = false; releaseLock = null; cancelShelterRead(); cancelStockRead(); cancelQueued(); }
    }).catch(() => setEnabled(false, '无法取得远征运行锁，请刷新后重试'))
      .finally(() => { acquiring = false; });
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // 与奇遇相同：唤醒后直接检查，避免普通定时器在后台再延迟一分钟。
    queueMicrotask(() => {
      scheduled = false;
      offered = false;
      idleChecked = false;
      idleBlocked = false;
      farmWait.begin();
      expeditionLoadWait.begin();
      try { observeSessionPage(); step(); }
      catch (error) { log.add('runtime-error', '远征检查异常，已暂停并保留原记录', { name: error?.name || 'Error', stage: 'expedition-check' }); setEnabled(false, '远征检查失败，已暂停；请核对页面后重试'); }
      finally {
        if (!offered) cancelQueued();
        if (idleChecked && !idleBlocked) clearIdleWait(true);
        if (enabled && active && farmEnabled && inFarm()) farmWait.finish();
        if (enabled && active && onPage()) expeditionLoadWait.finish();
      }
    });
  }
  log.observeLifecycle(() => onPage() ? { enabled, ownsLock: active, state: status.textContent,
    pageRecovery: (inFarm() ? farmWait : expeditionLoadWait).snapshot(),
    pendingDispatch: Boolean(plan), pendingClaim: Boolean(claimWait), pendingFarm: Boolean(farmPlan),
    shelterEnabled, shelterDueAt:shelterState.nextAt, pendingShelter:Boolean(shelterPending),
    stockEnabled:stockEnabled(),stockDueAt:stockLedger.nextAt,pendingStock:Boolean(stockLedger.pending),stockHeld:stockLedger.hold,
    shelterStaffMode,shelterGear,shelterOptimize,populationTarget:shelterPopulationTarget,
    pendingStaff:Boolean(shelterWork),pendingSwap:Boolean(shelterState.swap),pendingPair:Boolean(shelterState.pair),diagnostic } : null);
  subscribeWakeup(schedule, onPage, () => enabled);
  document.addEventListener('freeze', () => {
    pageFrozen = true;
    cancelFarmRead(); cancelShelterRead(); cancelStockRead(); cancelQueued(); releaseLock?.();
  });
  const resumePage = () => {
    if (pageFrozen) { stockEntryAt = 0; shelterEntryAt = 0; }
    pageFrozen = false; schedule();
  };
  document.addEventListener('resume', resumePage);
  window.addEventListener('pageshow', resumePage);
  window.addEventListener('pagehide', () => { cancelFarmRead(); cancelShelterRead(); cancelStockRead(); cancelQueued(); releaseLock?.(); });
  window.addEventListener('storage', event => {
    if (event.key === PREF) {
      enabled = event.newValue !== 'false';
      toggle.textContent = enabled ? '暂停远征与农场' : '开始远征与农场';
      if (!enabled) { cancelFarmRead(); cancelShelterRead(); cancelStockRead(); cancelQueued(); releaseLock?.(); say('已暂停'); }
    } else if ([FARM_PREF,FARM_CROP,FARM_STATE].includes(event.key)) {
      try {
        farmEnabled = localStorage.getItem(FARM_PREF) !== 'false';
        farmCrop = localStorage.getItem(FARM_CROP) || 'auto';
        farmSelect.value = farmCrop;
        farmState = JSON.parse(localStorage.getItem(FARM_STATE) || 'null') || farmState;
      } catch { farmEnabled = false; }
      cancelQueued();
    } else if ([STOCK_CONFIG,STOCK_LEDGER].includes(event.key)) {
      stockReload();if(event.key===STOCK_CONFIG)stockFillSettings();cancelStockRead();cancelQueued();
    } else if ([SHELTER_PREF,SHELTER_STATE,SHELTER_PENDING,SHELTER_STAFF,SHELTER_GEAR,SHELTER_OPTIMIZE,SHELTER_POPULATION,SHELTER_EXPLORE_CLAIM].includes(event.key)) {
      if(shelterReload()){cancelShelterRead();cancelQueued();}
    } else return;
    schedule();
  });
  if (!enabled) say('已暂停');
  schedule();
})();
  observeSession();
  }
  // document-idle 在后台慢加载时可能迟迟不注入。正文一出现就挂载调度，不等待 load/DOMContentLoaded。
  if (document.body) start();
  else {
    bodyObserver = new MutationObserver(start);
    bodyObserver.observe(document, { childList: true, subtree: true });
  }
})();
