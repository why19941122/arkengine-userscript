// ==UserScript==
// @name         Ark Engine 自动奇遇、秘境、远征与农场
// @namespace    local.arkengine.auto-encounter
// @version      1.6.1
// @updateURL    https://raw.githubusercontent.com/why19941122/arkengine-userscript/main/arkengine-auto-encounter.meta.js
// @downloadURL  https://raw.githubusercontent.com/why19941122/arkengine-userscript/main/arkengine-auto-encounter.user.js
// @description  双标签页挂机：奇遇秘境迷雾、远征农场；灵力满200快速探索，突发深渊补派，本地收益与排障日志。
// @match        https://game.arkengine.me/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self || document.getElementById('ark-auto-encounter')) return;
  // 网站 Base UI 的关闭完成回调先等 requestAnimationFrame；后台不绘制时可能一直不卸载。
  // 使用其公开代码中的开关，只在自动化路由启用期间跳过动画等待，不改写 rAF 或移除弹窗。
  const animationProperty = 'BASE_UI_ANIMATIONS_DISABLED';
  let animationSaved = false;
  let animationDescriptor;
  function syncDialogAnimations() {
    let wanted = false;
    try {
      wanted = /^\/cultivate(?:\/(?:dungeon|fog))?\/?$/.test(location.pathname)
        ? localStorage.getItem('arkengine:auto-encounter:enabled:v1') !== 'false'
        : /^(?:\/activities\/expedition|\/farm)\/?$/.test(location.pathname) &&
          localStorage.getItem('arkengine:auto-expedition:enabled:v1') !== 'false';
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

  const LOG_PREFIX = 'arkengine:auto-log:v1:';
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
  function createLog(group) {
    const heartbeatKey = `${LOG_PREFIX}${group}:heartbeat`;
    const receiptKey = `${LOG_PREFIX}${group}:receipt`;
    let checkpoint = null;
    let pending = null;
    let lastTick = 0;
    let lastWrite = 0;
    let lastState = '';
    let hint;
    let storageFailed = false;
    try {
      checkpoint = JSON.parse(localStorage.getItem(heartbeatKey) || 'null');
      pending = JSON.parse(sessionStorage.getItem(receiptKey) || 'null');
    } catch { storageFailed = true; }
    function prune() {
      const earliest = logDay(Date.now() - 86400000);
      for (const key of Object.keys(localStorage)) {
        const suffix = key.startsWith(LOG_PREFIX) && key.split(':').at(-1);
        if (/^\d{4}-\d{2}-\d{2}$/.test(suffix) && suffix < earliest) localStorage.removeItem(key);
      }
    }
    function bucket() {
      return JSON.parse(localStorage.getItem(`${LOG_PREFIX}${group}:${logDay()}`) || 'null') ||
        { day: logDay(), group, totals: {}, counts: {}, dropped: 0, events: [] };
    }
    function render() {
      if (!hint) return;
      try {
        const b = bucket();
        hint.textContent = storageFailed ? '日志存储失败，请检查站点存储空间；自动操作仍继续。' :
          `本组今日确认收入：代币 ${b.totals['代币'] || 0} · 修为 ${b.totals['修为'] || 0} · 钻石 ${b.totals['钻石'] || 0}（毛收入，不含未完成秘境）`;
      } catch { hint.textContent = '日志暂不可读，自动操作仍继续。'; }
    }
    function add(type, detail = '', data = {}, sum = false) {
      try {
        prune();
        const b = bucket();
        const now = Date.now();
        b.events.push({ at: now, beijing: new Date(now + 8 * 3600000).toISOString().replace('Z', '+08:00'),
          page: location.pathname, visibility: document.visibilityState, type, detail: String(detail).slice(0, 300), data });
        b.counts[type] = (b.counts[type] || 0) + 1;
        if (sum) for (const [key, value] of Object.entries(data.reward || {})) b.totals[key] = (b.totals[key] || 0) + value;
        if (b.events.length > 1200) { b.dropped += b.events.length - 1200; b.events = b.events.slice(-1200); }
        localStorage.setItem(`${LOG_PREFIX}${group}:${b.day}`, JSON.stringify(b));
      } catch { storageFailed = true; }
      render();
    }
    function saveReceipt(value) {
      pending = value;
      try { sessionStorage.setItem(receiptKey, JSON.stringify(value)); } catch { storageFailed = true; }
    }
    function expect(kind) {
      saveReceipt({ kind, at: Date.now(), before: receiptTexts(), changed: false });
    }
    function receipts() {
      if (!pending) return;
      const texts = receiptTexts();
      const matches = texts.filter(s => RECEIPTS[pending.kind]?.test(s));
      if (!pending.changed && !matches.some(s => pending.before.includes(s))) saveReceipt({ ...pending, changed: true });
      const receipt = matches.find(s => pending.changed || !pending.before.includes(s));
      if (!receipt) return;
      const kind = pending.kind === 'expedition' ? 'expedition-reward' : pending.kind === 'farm-sale' ? 'farm-sale-reward' :
        receipt.startsWith('奇遇') ? 'encounter-reward' : receipt.startsWith('秘境探索完成') ? 'dungeon-reward' : 'dungeon-node-reward';
      // 秘境只把最终累计收入加入总额，节点回执仅供排障，不重复累加。
      add(kind, receipt, { reward: receiptReward(receipt) }, kind !== 'dungeon-node-reward');
      saveReceipt(null);
    }
    function pulse(state) {
      const now = Date.now();
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
      if (now - lastWrite >= 60000) {
        checkpoint = { at: now, active: true, state: String(state).slice(0, 180), page: location.pathname, visibility: document.visibilityState };
        try { prune(); localStorage.setItem(heartbeatKey, JSON.stringify(checkpoint)); } catch { storageFailed = true; }
        lastWrite = now;
        render();
      }
    }
    function stop(reason) {
      add('pause', reason);
      checkpoint = { at: Date.now(), active: false, state: reason };
      lastTick = 0;
      try { localStorage.setItem(heartbeatKey, JSON.stringify(checkpoint)); } catch { storageFailed = true; }
    }
    function mount(shadow) {
      const box = shadow.querySelector('.box');
      hint = document.createElement('p'); hint.className = 'hint'; hint.id = 'log-summary'; box.append(hint);
      const details = document.createElement('details');
      details.innerHTML = '<summary style="cursor:pointer">本地日志（今天＋昨天）</summary><p class="hint">仅统计观察到的到账回执；农场估值不计作收入。详细事件每组每天保留最近 1200 条，汇总不受截断影响。</p><button type="button">导出两页日志</button><pre style="white-space:pre-wrap;max-height:180px;overflow:auto;font:11px/1.5 system-ui"></pre>';
      details.addEventListener('toggle', () => {
        if (!details.open) return;
        try { details.querySelector('pre').textContent = bucket().events.slice(-30).map(e => `${e.beijing.slice(11,19)} ${e.type} ${e.detail}`).join('\n') || '今天暂无记录'; }
        catch { details.querySelector('pre').textContent = '日志不可读'; }
      });
      details.querySelector('button').onclick = () => {
        try {
          prune();
          const days = Object.keys(localStorage).filter(k => k.startsWith(LOG_PREFIX) && /:\d{4}-\d{2}-\d{2}$/.test(k))
            .sort().map(k => JSON.parse(localStorage.getItem(k)));
          const heartbeats = Object.fromEntries(['cultivate', 'expedition'].map(name =>
            [name, JSON.parse(localStorage.getItem(`${LOG_PREFIX}${name}:heartbeat`) || 'null')]));
          const url = URL.createObjectURL(new Blob([JSON.stringify({ version: '1.6.1', exportedAt: new Date().toISOString(), days, heartbeats }, null, 2)], { type: 'application/json' }));
          const link = document.createElement('a'); link.href = url; link.download = `arkengine-log-${logDay()}.json`;
          link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch { storageFailed = true; render(); }
      };
      box.append(details); render();
    }
    return { add, pulse, stop, expect, receipts, mount };
  }

(() => {
  'use strict';
  if (window.top !== window.self || document.getElementById('ark-auto-encounter')) return;

  // 依据 2026-10-10 网站 v1.29.1 的前端结构；不调用游戏接口。
  const PREF = 'arkengine:auto-encounter:enabled:v1';
  const LOCK = 'arkengine:auto-encounter:tab:v1';
  const RETRY_MS = 30000;
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
    fog = JSON.parse(localStorage.getItem(FOG_STATE) || 'null') || fog;
    fogPlan = JSON.parse(sessionStorage.getItem(FOG_JOURNAL) || 'null');
  } catch { fogEnabled = false; }
  const DUNGEON_PREF = 'arkengine:auto-dungeon:enabled:v1';
  const DUNGEON_STATE = 'arkengine:auto-dungeon:state:v1';
  const DUNGEON_JOURNAL = 'arkengine:auto-dungeon:pending:v1';
  const DUNGEON_NAME = '坠星古墓';
  const beijingDay = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  let dungeonEnabled = true;
  let dungeon = { nextAt: 0, exhaustedDay: '', run: null };
  let dungeonPlan = null;
  try {
    dungeonEnabled = localStorage.getItem(DUNGEON_PREF) !== 'false';
    dungeon = JSON.parse(localStorage.getItem(DUNGEON_STATE) || 'null') || dungeon;
    dungeonPlan = JSON.parse(sessionStorage.getItem(DUNGEON_JOURNAL) || 'null');
  } catch { dungeonEnabled = false; }
  let dungeonPageDay = '';
  let openedDungeonDialog = false;
  let returningFromDungeon = false;
  let dungeonProgress = null;
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
  let worker = null;
  let timer = null;
  let statusText = '';
  const log = createLog('cultivate');

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
  fogToggle.addEventListener('click', () => {
    fogEnabled = !fogEnabled;
    localStorage.setItem(FOG_PREF, String(fogEnabled));
    if (fogEnabled) saveFog({ ...fog, nextAt: 0 });
    cancelPendingClick(); schedule();
  });
  function updateFogHint() {
    const hint = !fogEnabled ? '迷雾已暂停' : fog.nextAt > Date.now() ?
      `迷雾：约 ${Math.ceil((fog.nextAt - Date.now()) / 60000)} 分钟后再核对` :
      fog.draining || fogPlan ? '迷雾：本轮探索到灵力不足 20' : '迷雾：主殿灵力达到 200 后进入';
    if (fogStatus.textContent !== hint) fogStatus.textContent = hint;
    fogToggle.textContent = fogEnabled ? '暂停迷雾' : '开启迷雾';
  }
  function updateDungeonHint() {
    const hint = !dungeonEnabled ? '秘境已暂停' : dungeon.run ? '秘境：本轮探索尚未结束' :
      dungeon.exhaustedDay === beijingDay() ? '秘境：今日次数已用完，明日再检查' :
      dungeon.nextAt > Date.now() ? `秘境：约 ${Math.ceil((dungeon.nextAt - Date.now()) / 60000)} 分钟后检查` :
      '秘境：准备探索坠星古墓';
    if (dungeonStatus.textContent !== hint) dungeonStatus.textContent = hint;
    dungeonToggle.textContent = dungeonEnabled ? '暂停秘境' : '开启秘境';
  }
  dungeonToggle.addEventListener('click', () => {
    dungeonEnabled = !dungeonEnabled;
    localStorage.setItem(DUNGEON_PREF, String(dungeonEnabled));
    cancelPendingClick();
    schedule();
  });

  function say(text) {
    if (text === statusText) return;
    statusText = text;
    status.textContent = text;
  }

  function setEnabled(value, reason = '') {
    enabled = value;
    try { localStorage.setItem(PREF, String(value)); } catch { /* 不阻断暂停 */ }
    toggle.textContent = value ? '暂停修仙自动操作' : '开始修仙自动操作';
    if (!value) {
      if (active) log.stop(reason || '已暂停');
      cancelPendingClick();
      releaseLock?.();
      say(reason || '已暂停');
    }
    schedule();
  }
  toggle.addEventListener('click', () => setEnabled(!enabled));
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
    return [...document.querySelectorAll('button')].find(el => textOf(el) === label && visible(el));
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
      const action = /^(dungeon|fog):/.test(kind) ? message :
        kind === 'seek' ? '寻找奇遇' : kind === 'choose' ? '选择最高奖励' : '确认原奇遇结果';
      say(`随机等待 ${(Math.ceil(remaining / 100) / 10).toFixed(1)} 秒后${action}`);
      return false;
    }
    cancelPendingClick();
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
    if (!lastAction || lastAction.kind !== kind || lastAction.signature !== signature) return true;
    if (Date.now() - lastAction.at < RETRY_MS) {
      say('已提交，等待游戏返回结果');
      return false;
    }
    // 超时先通过页面已有刷新按钮同步状态，再决定是否重试原操作。
    if (!lastAction.refreshed) {
      const refresh = document.querySelector('button[aria-label="刷新修炼状态"]');
      if (!usable(refresh)) { say('等待游戏允许刷新状态'); return false; }
      lastAction.refreshed = true;
      lastAction.at = Date.now();
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
    try { checkPage(); } finally {
      // 暂停、切页、处理中、重新冷却或选项失效时撤销待执行点击。
      if (!clickConsidered) cancelPendingClick();
    }
  }

  function checkPage() {
    syncDialogAnimations();
    updateDungeonHint();
    updateFogHint();
    if (host.hidden === onPage()) host.hidden = !onPage();
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
    log.pulse(statusText);
    const notices = [...document.querySelectorAll('[role="status"]')].filter(visible);
    const errors = [...document.querySelectorAll('[role="status"].text-destructive, [role="alert"].text-destructive')]
      .filter(visible).map(textOf).join(' ');
    if (/(?:\b(?:401|403|429)\b|cyber_abuse|abuse_detected|user_disabled|未登录|登录.*(?:失效|过期)|账号已切换|封禁|禁用|访问被拒绝|权限不足|频率|频繁|限流|rate.?limit|unauthori[sz]ed|forbidden)/i.test(errors)) {
      setEnabled(false, '游戏提示登录、权限或限流异常，已暂停；处理后手动开始');
      return;
    }
    if (inDungeon()) { checkDungeon(notices, errors); return; }
    if (inFog()) { checkFog(errors); return; }
    fogPageAt = 0;
    fogLeaving = false;
    dungeonPageDay = '';
    returningFromDungeon = false;
    dungeonProgress = null;
    if ([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(visible)) {
      say('请先处理当前弹窗'); return;
    }
    if (notices.some(el => /正在处理修炼操作|正在恢复原请求/.test(textOf(el)))) {
      say('游戏正在处理修炼操作，等待原结果');
      return;
    }
    if (Date.now() < nextActionAt) return;
    const refresh = document.querySelector('button[aria-label="刷新修炼状态"]');
    if (refresh && !usable(refresh)) { say('等待修炼状态刷新完成'); return; }

    const recovery = findButton('确认原修炼结果');
    if (recovery) {
      const operation = pendingOperation();
      if (!operation) { say('原操作不是可确认的寻访奇遇，请手动处理'); return; }
      if (!usable(recovery)) { say('等待原奇遇结果'); return; }
      if (lastAction && Date.now() - lastAction.at < RETRY_MS) {
        say('等待原奇遇请求完成，稍后确认结果');
        return;
      }
      recordClick(recovery, 'recover', operation.idempotencyKey, '正在确认原奇遇结果');
      return;
    }

    const panel = document.getElementById('cultivation-encounter');
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

    if ((!fogEnabled || !fogPlan || fog.nextAt > Date.now()) && visitDungeon()) return;
    if (visitFog()) return;

    const cooldown = [...document.querySelectorAll('button')].find(el =>
      visible(el) && /^奇遇冷却\s/.test(textOf(el)));
    if (cooldown) {
      lastAction = null;
      say(textOf(cooldown));
      return;
    }
    const seek = findButton('寻找奇遇');
    if (!seek) { say('等待修仙主殿加载，请保持登录'); return; }
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
    const route = document.querySelector('select[aria-label="探索路线"]')?.value;
    const strategy = document.querySelector('select[aria-label="战斗策略"]')?.value;
    const rawHp = document.querySelector('input[aria-label="生命撤离线"]')?.value;
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
  function deferFog(reason, pause = false) {
    if (!fogLeaving) {
      saveFog({ ...fog, nextAt: Date.now() + 5 * 60000 });
      if (pause) {
        fogEnabled = false;
        localStorage.setItem(FOG_PREF, 'false');
      }
      fogLeaving = true;
      last.textContent = `${reason}；${pause ? '迷雾已暂停，请手动核对' : '5 分钟后再核对迷雾'}`;
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
      if (!own) { say('请先手动处理当前弹窗'); return; }
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
          deferFog('迷雾 90 秒未确认结果，保留原请求回主殿'); return;
        }
        saveFogPlan({ ...fogPlan, startedAt: Date.now(), deferred: false });
      }
      if (own) {
        const recover = findButton('确认原探索结果');
        if (Date.now() - fogPlan.at >= RETRY_MS && usable(recover)) {
          recordClick(recover, 'fog:recover', records[0].value.idempotencyKey, '确认原探索结果', () => {
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
      if (Date.now() - fogPageAt > 90000) deferFog('迷雾页面超过 90 秒未能加载');
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
      saveFog({ draining: true, nextAt: 0 });
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
        (!dungeon.run && dungeon.exhaustedDay === beijingDay())) return false;
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
  function deferDungeon(reason, delay = 5 * 60000) {
    // 返回主殿不会撤退；保留 run 和原请求，等待返回的几秒内不反复延长预约。
    if (!returningFromDungeon) {
      saveDungeon({ ...dungeon, nextAt: Date.now() + delay });
      returningFromDungeon = true;
      last.textContent = `${reason}；${Math.ceil(delay / 60000)} 分钟后再检查`;
      log.add('dungeon-deferred', reason, { retryAt: dungeon.nextAt, pending: Boolean(dungeonPlan) });
    }
    returnToHall();
  }
  function recentDungeonResult() {
    return [...document.querySelectorAll('section')].find(section =>
      [...section.querySelectorAll('h2')].some(h => textOf(h) === `最近一次探索 · ${DUNGEON_NAME}`));
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
  function waitDungeonResult(refresh) {
    if (Date.now() - dungeonPlan.at < RETRY_MS) { say('等待原秘境结果，不重复入场或选择'); return; }
    if (!dungeonPlan.refreshed && usable(refresh)) {
      recordClick(refresh, 'dungeon:refresh', 'original', '刷新并核对原秘境结果', () =>
        saveDungeonPlan({ ...dungeonPlan, refreshed: true, at: Date.now() }));
      return;
    }
    say('原秘境结果尚未确认，请手动核对；不会重新购买门票');
  }
  function checkDungeon(notices, errors) {
    if (!dungeonEnabled) { say('秘境已暂停，可手动返回主殿继续奇遇'); return; }
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
        deferDungeon('秘境超过 90 秒没有进展，保留原操作回主殿'); return;
      }
    }
    const busy = notices.some(n => /正在处理秘境操作|正在读取原请求/.test(textOf(n)));
    if (busy) { say('游戏正在处理秘境操作，等待原结果'); return; }
    if (dialogs.length) {
      const dialog = dialogs[0];
      if (records.length || dialogs.length !== 1 || !openedDungeonDialog || dungeonPlan?.phase !== 'opening' ||
          !textOf(dialog).includes(dungeonPlan.description)) {
        say('请先手动处理当前弹窗'); return;
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
      recordClick(recovery, 'dungeon:recover', records[0].value.idempotencyKey, '确认上次秘境操作', () =>
        saveDungeonPlan({ ...dungeonPlan, at: Date.now() }));
      return;
    }
    if (findButton('确认上次秘境操作')) { say('秘境原请求记录无法核对，请手动处理'); return; }
    const refresh = document.querySelector('button[aria-label="刷新秘境状态"]');
    if (!usable(refresh)) { say('等待秘境状态加载完成'); return; }
    const section = [...document.querySelectorAll('section')].find(s =>
      [...s.querySelectorAll('p')].some(p => /^探索中 · /.test(textOf(p))));
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
        } else { waitDungeonResult(refresh); return; }
      }
      if (errors) { say(`秘境提示：${errors}，请手动核对`); return; }
      if (!dungeon.run || dungeon.run.step !== step) {
        saveDungeon({ ...dungeon, run: { beforeResult: dungeon.run?.beforeResult ?? '', step } });
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
      saveDungeon({ ...dungeon, run: null, nextAt: Date.now() + interval });
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
      } else { waitDungeonResult(refresh); return; }
    }
    if (dungeon.run) { say('本轮秘境进度尚未确认，请刷新秘境状态核对'); return; }
    if (errors) { deferDungeon(`秘境提示：${errors}`); return; }
    if (dungeonPageDay && dungeonPageDay !== beijingDay()) {
      recordClick(refresh, 'dungeon:day', beijingDay(), '刷新今日秘境次数', () => { dungeonPageDay = beijingDay(); });
      return;
    }
    dungeonPageDay ||= beijingDay();
    const quotaText = [...document.querySelectorAll('[aria-live="polite"]')].map(textOf)
      .find(text => /^今日剩余\s*\d+\s*\/\s*\d+\s*次/.test(text));
    const quota = quotaText?.match(/^今日剩余\s*(\d+)\s*\/\s*(\d+)\s*次/);
    if (!quota || Number(quota[1]) > Number(quota[2])) { say('等待网页提供今日秘境次数'); return; }
    if (Number(quota[1]) === 0) {
      if (dungeon.exhaustedDay !== beijingDay()) saveDungeon({ ...dungeon, exhaustedDay: beijingDay() });
      returningFromDungeon = true;
    }
    if (returningFromDungeon || dungeon.nextAt > Date.now() || dungeon.exhaustedDay === beijingDay()) {
      returnToHall(); return;
    }
    const heading = [...document.querySelectorAll('h2')].find(h => textOf(h) === DUNGEON_NAME);
    const card = heading?.closest('.game-card');
    if (!card) { deferDungeon('当前未找到坠星古墓入口'); return; }
    const cooldown = [...card.querySelectorAll('button')].find(b => textOf(b) === '秘境冷却中');
    if (cooldown) {
      deferDungeon('秘境仍在冷却', 60000); return;
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
      try { tick(); } catch (error) {
        console.error('[自动奇遇] 本次检查失败', error);
        setEnabled(false, '脚本检查失败，已暂停；请刷新后重试');
      }
    });
  }

  // Worker 提供后台心跳，MutationObserver 在游戏更新按钮/选项时立即唤醒。
  // 浏览器冻结、丢弃标签页或系统休眠时，两者都不能保证继续运行。
  function startTimer() {
    const fallback = () => {
      worker?.terminate();
      worker = null;
      if (!timer) timer = setInterval(schedule, 2000);
    };
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 2000);'],
        { type: 'text/javascript' }));
      try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
      worker.onmessage = schedule;
      worker.onerror = fallback;
    } catch { fallback(); }
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'class'] });
  window.addEventListener('pageshow', schedule);
  window.addEventListener('focus', schedule);
  window.addEventListener('popstate', schedule);
  window.addEventListener('online', schedule);
  document.addEventListener('visibilitychange', schedule);
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
  startTimer();
  if (!enabled) say('已暂停');
  schedule();
})();

// 远征与农场共用标签页、点击队列和锁；平时驻留远征，仅到农场预约时间才切页。
(() => {
  'use strict';
  if (window.top !== window.self || document.getElementById('ark-auto-expedition')) return;
  // 根据网站公开前端 v1.29.1 的 DOM 和原请求记录实现，不自行请求游戏接口。
  const PREF = 'arkengine:auto-expedition:enabled:v1';
  const JOURNAL = 'arkengine:auto-expedition:pending:v1';
  const LOCK = 'arkengine:auto-expedition:tab:v1';
  const TEAM_LIMIT = 6;
  const inFarm = () => /^\/farm\/?$/.test(location.pathname);
  const onPage = () => /^\/(?:activities\/expedition|farm)\/?$/.test(location.pathname);
  const FARM_PREF = 'arkengine:auto-farm:enabled:v1';
  const FARM_CROP = 'arkengine:auto-farm:crop:v1';
  const FARM_STATE = 'arkengine:auto-farm:schedule:v1';
  const FARM_JOURNAL = 'arkengine:auto-farm:pending:v1';
  const CROPS = ['小麦','胡萝卜','番茄','玉米','草莓','南瓜','蓝莓','葡萄','黄金苹果','西瓜','可可豆','星辉果'];
  let farmEnabled = true;
  let farmCrop = 'auto';
  let farmState = { nextAt: 0, expeditionAt: 0, note: '等待首次检查', selection: '' };
  let farmPlan = null;
  try {
    farmEnabled = localStorage.getItem(FARM_PREF) !== 'false';
    farmCrop = localStorage.getItem(FARM_CROP) || 'auto';
    farmState = JSON.parse(localStorage.getItem(FARM_STATE) || 'null') || farmState;
    farmPlan = JSON.parse(sessionStorage.getItem(FARM_JOURNAL) || 'null');
  } catch { farmEnabled = false; }
  let ownSeedDialog = null;
  let openingSeedsAt = 0;
  let farmEntryAt = 0;
  let farmSignature = '';
  let farmChangedAt = 0;
  let farmMarket = null;
  let farmMarketLoading = false;
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
    plan = JSON.parse(sessionStorage.getItem(JOURNAL) || 'null');
  } catch { /* 存储不可用时，实际派遣前会停止 */ }
  let active = false;
  let acquiring = false;
  let releaseLock = null;
  let queued = null;
  let offered = false;
  let scheduled = false;
  let nextStepAt = 0;
  let claimWait = null;
  const loadedDay = beijingTime().day;
  const log = createLog('expedition');
  const BURST_DAY = 'arkengine:auto-expedition:burst-day:v1';
  const QUOTA_REFRESH = 'arkengine:auto-expedition:quota-refresh:v1';

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
    </style>
    <div class="box">
      <strong>自动远征与农场</strong>
      <p id="status" role="status" aria-live="polite"></p>
      <p class="hint">常态：边境巡逻，最多 6 队。<br>突发：北京时间 01:00～02:00 优先；错过且额度完整未用时补派深渊。</p>
      <p class="hint">自动领取 · 完整行程 · 点击前随机等 2～5 秒</p>
      <button type="button" id="toggle"></button>
      <p class="hint" id="farm-status"></p>
      <label for="farm-crop">种植作物</label>
      <select id="farm-crop">
        <option value="auto">自动：当前收益最高的单一作物</option>
        ${CROPS.map(name => `<option value="${name}">${name}</option>`).join('')}
      </select>
      <p class="hint" id="farm-selection">每次种植前读取最新行情，每块扣除留种 1 份。</p>
      <button type="button" id="farm-toggle"></button>
      <button type="button" id="farm-check">检查农场</button>
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
    farmCrop = farmSelect.value;
    farmMarket = null;
    localStorage.setItem(FARM_CROP, farmCrop);
    saveFarmState({ ...farmState, nextAt: 0, selection: '', note: '作物已更改，下次种植生效' });
    cancelQueued(); schedule();
  });
  farmToggle.addEventListener('click', () => {
    farmEnabled = !farmEnabled;
    localStorage.setItem(FARM_PREF, String(farmEnabled));
    cancelQueued(); schedule();
  });
  shadow.getElementById('farm-check').addEventListener('click', () => {
    saveFarmState({ ...farmState, nextAt: 0, note: '等待检查农场' });
    schedule();
  });

  function cancelQueued() {
    if (queued) clearTimeout(queued.timer);
    queued = null;
  }
  function setEnabled(value, reason = '') {
    enabled = value;
    try { localStorage.setItem(PREF, String(value)); } catch { /* 内存开关仍然有效 */ }
    toggle.textContent = value ? '暂停远征与农场' : '开始远征与农场';
    if (!value) { if (active) log.stop(reason || '已暂停'); cancelQueued(); releaseLock?.(); say(reason || '已暂停'); }
    schedule();
  }
  toggle.addEventListener('click', () => setEnabled(!enabled));
  toggle.textContent = enabled ? '暂停远征与农场' : '开始远征与农场';

  function savePlan(value) {
    // 出发前保存本脚本的意图；恢复时只确认属于这次自动派遣的原请求。
    const serialized = JSON.stringify(value);
    sessionStorage.setItem(JOURNAL, serialized);
    if (sessionStorage.getItem(JOURNAL) !== serialized) throw new Error('无法保存远征操作记录');
    plan = value;
  }
  function visible(el) {
    return Boolean(el?.isConnected && !el.closest('[hidden], [aria-hidden="true"]') &&
      el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  }
  function usable(el) {
    return visible(el) && !el.closest('[inert]') && !el.matches(':disabled, [aria-disabled="true"]');
  }
  function section(title) {
    return [...document.querySelectorAll('section')].find(el =>
      [...el.querySelectorAll('h2')].some(heading => textOf(heading) === title));
  }
  function buttonIn(root, matcher) {
    return [...(root?.querySelectorAll('button') || [])].find(button =>
      typeof matcher === 'string' ? textOf(button) === matcher : matcher.test(textOf(button)));
  }
  function quotas() {
    const root = document.querySelector('section[aria-label="远征派遣额度"]');
    if (!root) return null;
    function read(label, ratio) {
      const node = [...root.querySelectorAll('span')].find(el => textOf(el) === label);
      const value = textOf(node?.parentElement).slice(label.length).trim();
      const match = value.match(ratio ? /^(\d+)\s*\/\s*(\d+)\s*支$/ : /^(\d+)\s*支$/);
      return match ? match.slice(1).map(Number) : null;
    }
    const normal = read('常态剩余', true);
    const burst = read('今日突发剩余', true);
    const running = read('当前运行', false);
    if (!normal || !burst || !running || normal[0] > normal[1] || burst[0] > burst[1]) return null;
    return { normal: normal[0], normalMax: normal[1], burst: burst[0], burstMax: burst[1], running: running[0] };
  }
  function forecast(root) {
    const node = [...(root?.querySelectorAll('[role="status"]') || [])].find(el => /^预计派遣/.test(textOf(el)));
    const match = textOf(node).match(/^预计派遣\s*(\d+)\s*支[:：]\s*常态\s*(\d+)\s*支[，,]\s*突发\s*(\d+)\s*支/);
    if (!match || Number(match[1]) !== Number(match[2]) + Number(match[3])) return null;
    return { total: Number(match[1]), normal: Number(match[2]), burst: Number(match[3]) };
  }
  function form() {
    const root = section('自动组队派遣');
    const routes = section('选择路线');
    const count = root?.querySelector('input[aria-label="最多派遣队数"]');
    const label = [...(root?.querySelectorAll('label') || [])].find(el => textOf(el) === '允许使用今日突发额度');
    const burst = label?.querySelector('input[type="checkbox"]');
    const high = buttonIn(root?.querySelector('[aria-label="自动组队偏好"]'), '高星优先');
    const routeButton = name => [...(routes?.querySelectorAll('button') || [])].find(el =>
      [...el.querySelectorAll('span')].some(span => textOf(span) === name));
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
      // 只恢复已发送的原请求；即使已过两点，也不会创建一笔新的突发派遣。
      offer(`recover:${plan.original.value.idempotencyKey}`, '确认上次派遣结果', () => {
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
    const remaining = Math.max(0, farmState.nextAt - Date.now());
    const message = !farmEnabled ? `农场已暂停：${farmState.note}` :
      remaining ? `农场：${farmState.note}；约 ${Math.ceil(remaining / 60000)} 分钟后检查` : '农场：等待检查或操作';
    if (farmStatus.textContent !== message) farmStatus.textContent = message;
    farmToggle.textContent = farmEnabled ? '暂停农场' : '开启农场';
    const selected = shadow.getElementById('farm-selection');
    const description = farmState.selection || (farmCrop === 'auto' ?
      '每次种植前读取最新行情，每块扣除留种 1 份。' : `指定：${farmCrop}；下次种植生效`);
    if (selected.textContent !== description) selected.textContent = description;
  }
  function pauseFarm(message) {
    farmEnabled = false;
    localStorage.setItem(FARM_PREF, 'false');
    saveFarmState({ ...farmState, note: message });
    cancelQueued(); say(message);
  }
  function travelLink(path) {
    return [...document.querySelectorAll('a[href]')].find(a => {
      const url = new URL(a.href, location.href);
      return url.origin === location.origin && url.pathname.replace(/\/$/, '') === path && !a.target && usable(a);
    });
  }
  function backToExpedition() {
    const link = travelLink('/activities/expedition');
    if (!link) { say('等待返回远征入口'); return; }
    offer('farm:return', '返回远征，按预约时间再检查农场', () => link.click());
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
    if (!link) return false;
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
        link.click();
      });
    return true;
  }
  function farmSnapshot() {
    const timeline = [...document.querySelectorAll('details')].find(d => /^全场成熟时间轴/.test(textOf(d.querySelector('summary'))));
    const staminaNode = [...document.querySelectorAll('[title]')].find(el =>
      /^每\s*\d+\s*分钟自然恢复\s*1\s*点体力$/.test(el.title) && /^体力\s/.test(textOf(el)));
    const s = textOf(staminaNode).match(/^体力\s*(\d+)\s*\/\s*(\d+)(?:\s*\((\d+):(\d+)\s*恢复 1 点\))?/);
    if (!timeline || !s) return null;
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
    const compact = document.querySelector('section[aria-label="紧凑经营视图"]');
    // 模态窗口会把背景设为 inert/aria-hidden；背景数据仍需读取，但绝不点击。
    const laidOut = el => Boolean(el?.getClientRects().length && getComputedStyle(el).display !== 'none');
    const empty = [...document.querySelectorAll('button[aria-label="空地块，点击种植"]')].filter(laidOut);
    if (laidOut(compact)) empty.push(...[...compact.querySelectorAll('button')].filter(b => textOf(b) === '选择种子' && laidOut(b)));
    const count = textOf(timeline.querySelector('summary')).match(/(\d+)\s*块种植中/);
    if (!count || Number(count[1]) !== entries.length || entries.length + empty.length === 0) return null;
    return { timeline, entries, empty, total: entries.length + empty.length,
      ready: entries.filter(e => e.at <= Date.now()), stamina: +s[1], max: +s[2],
      regen: Number(staminaNode.title.match(/\d+/)[0]) * 60000,
      nextRegen: s[3] === undefined ? null : (+s[3] * 60 + +s[4]) * 1000 };
  }
  function staminaReadyAt(s, need) {
    return Date.now() + (s.nextRegen ?? s.regen) + Math.max(0, need - s.stamina - 1) * s.regen + 2000;
  }
  function readFarmMarket() {
    if (farmMarketLoading) return;
    farmMarketLoading = true;
    say('读取本轮最新行情与种植加成');
    // 只读网站原有状态接口，保留 priceMilli 精度；种植、收获仍只点网页原按钮。
    fetch('/api/farm', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
      .then(async response => {
        if (!response.ok) throw Object.assign(new Error(`农场状态读取失败（${response.status}）`), {
          stopGroup: [401, 403, 429].includes(response.status)
        });
        const data = await response.json();
        if (!Number.isSafeInteger(data.userId) || !Array.isArray(data.seeds) || !Array.isArray(data.prices) ||
            !Array.isArray(data.plots) || !Array.isArray(data.crops) || !Array.isArray(data.inventory) ||
            !data.stamina || data.staminaCosts?.plant !== 1 || data.staminaCosts?.harvest !== 1) {
          throw new Error('农场数据或体力规则变化');
        }
        if (farmState.userId && farmState.userId !== data.userId) {
          throw Object.assign(new Error('农场账号已切换，请核对日程'), { stopGroup: true });
        }
        farmMarket = { data, at: Date.now() };
        if (!farmState.userId) saveFarmState({ ...farmState, userId: data.userId });
      })
      .catch(error => {
        farmMarket = null;
        if (error.stopGroup) setEnabled(false, `${error.message}；已暂停远征与农场，请手动核对后恢复`);
        else pauseFarm(`${error.message}；本轮未种植，请核对后开启农场`);
      })
      .finally(() => { farmMarketLoading = false; schedule(); });
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
      } else { say('等待你处理农场弹窗'); return; }
    }
    const tabs = document.querySelector('[role="tablist"][aria-label="农场功能"]');
    const plotsTab = [...(tabs?.querySelectorAll('[role="tab"]') || [])].find(b => textOf(b) === '田地');
    if (!dialogs.length && plotsTab && plotsTab.getAttribute('aria-selected') !== 'true') {
      if (usable(plotsTab)) offer('farm:plots', '切换田地页', () => plotsTab.click());
      return;
    }
    const s = farmSnapshot();
    if (!s) { say('等待田地、成熟时间和体力数据加载'); return; }
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
      if (need && s.stamina >= need) saveFarmState({ ...farmState, nextAt: 0, staminaSeen: displayedStamina() });
      else { backToExpedition(); return; }
    }
    if (s.ready.length) {
      const need = s.ready.length;
      if (s.stamina < need) { planFarmVisit(staminaReadyAt(s,need), `等待体力恢复到 ${need} 点再收获`); return; }
      const harvest = [...document.querySelectorAll('button')].find(b => usable(b) && /^一键收获\s*\(\d+\)$/.test(textOf(b)));
      if (!harvest) {
        // 后台普通网页时钟可能滞后，按已读到的绝对成熟时间刷新一次，让原按钮更新。
        if (Date.now() - farmEntryAt > 10000 && Date.now() - (farmState.refreshedAt || 0) > 60000) {
          offer('farm:refresh-ready', '刷新已到成熟时间的田地', () => {
            saveFarmState({ ...farmState, refreshedAt: Date.now() }); location.reload();
          });
        } else say('已到预计成熟时间，等待页面确认可收获');
        return;
      }
      const count = Number(textOf(harvest).match(/\((\d+)\)/)[1]);
      if (count !== need) { say('等待一键收获数量与成熟地块一致'); return; }
      offer(`farm:harvest:${s.ready.map(e=>e.plot).join(',')}`, `一键收获 ${count} 块田地`, () => {
        saveFarmPlan({action:'harvest',plots:s.ready.map(e=>e.plot),at:Date.now()}); harvest.click();
      });
      return;
    }
    if (s.empty.length) {
      const need = s.empty.length;
      if (s.stamina < need) { planFarmVisit(staminaReadyAt(s,need), `等待体力恢复到 ${need} 点再种植`); return; }
      const empty = s.empty.find(usable);
      if (!empty) { say('等待农场操作完成'); return; }
      offer('farm:seeds', '打开空地选择种子', () => { farmMarket = null; openingSeedsAt = Date.now(); empty.click(); });
      return;
    }
    const next = Math.min(...s.entries.map(e=>e.at));
    planFarmVisit(next + 2000, '作物生长中');
  }

  function step() {
    syncDialogAnimations();
    farmHint();
    if (host.hidden === onPage()) host.hidden = !onPage();
    if (onPage()) log.receipts();
    if (!onPage() || !enabled) { releaseLock?.(); return; }
    if (!navigator.locks) { setEnabled(false, '请使用支持标签页互斥的新版浏览器'); return; }
    if (!active) { acquire(); return; }
    log.pulse(status.textContent);
    const errors = [...document.querySelectorAll('[role="status"].text-destructive, [role="status"].bg-destructive, [role="alert"].text-destructive')].map(textOf).join(' ');
    if (/(?:\b(?:401|403|429)\b|cyber_abuse|abuse_detected|user_disabled|未登录|登录.*(?:失效|过期)|账号已切换|封禁|禁用|访问被拒绝|权限不足|频率|频繁|限流|rate.?limit|unauthori[sz]ed|forbidden)/i.test(errors)) {
      setEnabled(false, '游戏提示登录、权限或限流异常，已暂停；处理后手动开始');
      return;
    }
    if (Date.now() < nextStepAt) return;
    if (inFarm()) { farmStep(); return; }
    farmEntryAt = 0; farmSignature = ''; ownSeedDialog = null; openingSeedsAt = 0; farmMarket = null;
    const q = quotas();
    const fields = form();
    if (!q || !fields.root || !fields.count || !fields.burst || !fields.high) {
      say('等待远征页面和额度加载，请保持登录');
      return;
    }
    const records = nativePending();
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    if (plan) { handlePlan(q, fields, records, dialogs); return; }
    if (records.length) { say('存在手动派遣待确认，请先处理原请求'); return; }
    if (dialogs.length) { say('等待你处理当前弹窗'); return; }

    if (claimWait) {
      if (q.running < claimWait.running) {
        log.add('expedition-claimed', '远征领取后队伍减少已确认', { teams: claimWait.running - q.running });
        claimWait = null;
      }
      else {
        if (Date.now() - claimWait.at > 30000) offer('sync-claim', '刷新领取后的状态', () => location.reload());
        else say('等待奖励领取和英雄释放');
        return;
      }
    }
    // 午夜跨日后服务器额度可能尚未刷新；只在没有未完成操作时重新载入页面。
    if (beijingTime().day !== loadedDay) {
      offer('new-day', '刷新今日突发额度', () => location.reload());
      return;
    }
    const running = section('进行中的远征');
    const claimAll = buttonIn(running, /^一键领取\s*\(\d+\)$/);
    const claimOne = buttonIn(running, '领取');
    const claim = usable(claimAll) ? claimAll : usable(claimOne) ? claimOne : null;
    if (claim) {
      offer(`claim:${q.running}:${textOf(claim)}`, '领取已完成的远征奖励', () => {
        claimWait = { running: q.running, at: Date.now() };
        log.expect('expedition');
        claim.click();
      });
      return;
    }
    if (fields.root.querySelector('.animate-spin') || running?.querySelector('.animate-spin')) {
      say('等待远征操作完成');
      return;
    }

    // 服务器总是优先使用常态名额，因此先补巡逻，再派纯突发深渊。
    const nowForBurst = beijingTime();
    const burstUsed = localStorage.getItem(BURST_DAY) === nowForBurst.day;
    const burst = q.normal === 0 && nowForBurst.canBurst && !burstUsed && q.burst > 0 && q.burst === q.burstMax;
    if (q.normal === 0 && !burst) {
      if (maybeVisitFarm(running)) return;
      // 页面只在请求后刷新服务器额度。尚未确认当天使用时，低频重新读取以发现延后刷新的额度。
      const checkedAt = Number(sessionStorage.getItem(QUOTA_REFRESH)) || 0;
      if (!checkedAt) sessionStorage.setItem(QUOTA_REFRESH, String(Date.now()));
      else if (!burstUsed && nowForBurst.canBurst && q.burst < q.burstMax && Date.now() - checkedAt >= 15 * 60000) {
        offer('refresh-quota', '重新读取今日突发额度', () => {
          sessionStorage.setItem(QUOTA_REFRESH, String(Date.now())); location.reload();
        });
        return;
      }
      say(burstUsed || q.burst < q.burstMax ? '今日突发已使用或额度不完整；持续等待远征归来' : '巡逻进行中；突发等待北京时间 1 点');
      return;
    }
    const route = burst ? '深渊远征' : '边境巡逻';
    const maxTeams = burst ? Math.min(TEAM_LIMIT, q.burst) : TEAM_LIMIT;
    const selected = fields.routeButton(route);
    if (!selected) { say(`未找到${route}路线，等待页面更新`); return; }
    if (selected.getAttribute('aria-pressed') !== 'true') {
      if (usable(selected)) offer(`route:${route}`, `选择${route}`, () => selected.click());
      return;
    }
    if (fields.high.getAttribute('aria-pressed') !== 'true') {
      if (usable(fields.high)) offer('high-stars', '选择高星优先', () => fields.high.click());
      return;
    }
    if (Number(fields.count.value) !== maxTeams) {
      if (usable(fields.count)) offer(`teams:${maxTeams}`, `设置最多 ${maxTeams} 队`, () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(fields.count, String(maxTeams));
        fields.count.dispatchEvent(new Event('input', { bubbles: true }));
        fields.count.dispatchEvent(new Event('change', { bubbles: true }));
      });
      return;
    }
    if (fields.burst.checked !== burst) {
      if (usable(fields.burst)) offer(`burst:${burst}`, burst ? '允许使用今日突发额度' : '关闭突发额度', () => fields.burst.click());
      return;
    }
    const preview = fields.forecast;
    if (!preview || preview.total < 1) {
      if (maybeVisitFarm(running)) return;
      say('等待符合条件的英雄或可用名额'); return;
    }
    if (burst ? preview.normal !== 0 || preview.burst !== maxTeams : preview.burst !== 0 || preview.normal > q.normal) {
      say('等待派遣预览与常态／突发额度一致');
      return;
    }
    const dispatch = buttonIn(fields.root, new RegExp(`^派出\\s*${preview.total}\\s*支队伍$`));
    if (!usable(dispatch)) { say('等待派遣按钮可以点击'); return; }
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
    if (acquiring) return;
    acquiring = true;
    navigator.locks.request(LOCK, { ifAvailable: true }, async lock => {
      if (!lock || !enabled || !onPage()) { if (enabled && onPage()) say('另一远征标签页正在运行'); return; }
      active = true;
      try { await new Promise(resolve => { releaseLock = resolve; schedule(); }); }
      finally { active = false; releaseLock = null; cancelQueued(); }
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
      try { step(); }
      catch (error) { console.error('[自动远征] 检查失败', error); setEnabled(false, '远征检查失败，已暂停；请核对页面后重试'); }
      finally { if (!offered) cancelQueued(); }
    });
  }
  // 不使用后台会停止的动画帧；Worker 不可用时退回普通计时器。
  let worker;
  let timer;
  const fallback = () => { worker?.terminate(); if (!timer) timer = setInterval(schedule, 2000); };
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 2000);'], { type: 'text/javascript' }));
    try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
    worker.onmessage = schedule;
    worker.onerror = fallback;
  } catch { fallback(); }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'aria-pressed', 'aria-selected', 'hidden', 'class'] });
  for (const name of ['pageshow', 'focus', 'popstate', 'online']) window.addEventListener(name, schedule);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pagehide', () => { cancelQueued(); releaseLock?.(); });
  window.addEventListener('storage', event => {
    if (event.key === PREF) {
      enabled = event.newValue !== 'false';
      toggle.textContent = enabled ? '暂停远征与农场' : '开始远征与农场';
      if (!enabled) { cancelQueued(); releaseLock?.(); say('已暂停'); }
    } else if ([FARM_PREF,FARM_CROP,FARM_STATE].includes(event.key)) {
      try {
        farmEnabled = localStorage.getItem(FARM_PREF) !== 'false';
        farmCrop = localStorage.getItem(FARM_CROP) || 'auto';
        farmSelect.value = farmCrop;
        farmState = JSON.parse(localStorage.getItem(FARM_STATE) || 'null') || farmState;
      } catch { farmEnabled = false; }
      cancelQueued();
    } else return;
    schedule();
  });
  if (!enabled) say('已暂停');
  schedule();
})();
})();
