// ==UserScript==
// @name         Ark Engine 自动奇遇、秘境、远征与农场
// @namespace    local.arkengine.auto-encounter
// @version      1.7.1
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
        : /^(?:\/activities\/expedition|\/farm)\/?$/.test(location.pathname) &&
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
  function createPageWait(scope, log) {
    const key = `arkengine:auto-page-wait:${scope}:v1`;
    let state = loadState(sessionStorage, key, null, scope, timedState);
    let waiting = false;
    return {
      begin() { waiting = false; },
      finish() { if (!waiting) this.clear(); },
      clear() { if (state) { state = null; sessionStorage.removeItem(key); } },
      wait(reason, safe, say, pause) {
        waiting = true;
        if (!navigator.onLine) { say('网络离线，等待连接恢复'); return; }
        if (!state || state.path !== location.pathname) {
          state = { at: Date.now(), path: location.pathname, reloaded: false };
          sessionStorage.setItem(key, JSON.stringify(state));
          log.add('page-blocked', reason, { scope });
        }
        if (Date.now() - state.at >= (state.reloaded ? 300000 : 90000)) {
          if (!safe) { pause(`${reason}；存在弹窗或未决操作，已暂停并保留记录`); return; }
          if (state.reloaded) { pause(`${reason}；一次刷新后仍无进展，已暂停`); return; }
          state = { ...state, reloaded: true, at: Date.now() };
          sessionStorage.setItem(key, JSON.stringify(state));
          log.add('page-refresh', reason, { scope });
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

  const LOG_PREFIX = 'arkengine:auto-log:v1:';
  const diagnosticLogs = {};
  // 仅在本脚本点击领取的同步调用期间绑定原网页请求，不读取请求正文。
  let captureExpeditionClaim = null;
  let observeSessionPage = () => {};
  const pageGroup = path => /^\/cultivate(?:\/(?:dungeon|fog))?\/?$/.test(path) ? 'cultivate' :
    /^(?:\/activities\/expedition|\/farm)\/?$/.test(path) ? 'expedition' : '';
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
  const SCRIPT_VERSION = '1.7.1';
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
      const record = event => {
        const state = context();
        if (!state) return;
        // 生命周期事件不算调度心跳，不能掩盖恢复后发现的检查中断。
        add('page-lifecycle', `页面事件：${event.type}`, {
          event: event.type, persisted: Boolean(event.persisted), trusted: Boolean(event.isTrusted),
          discarded: Boolean(document.wasDiscarded), readyState: document.readyState,
          lastTickAt: lastTick || null, gapMs: lastTick ? Math.max(0, Date.now() - lastTick) : null,
          ...state,
        });
      };
      for (const name of ['freeze', 'resume', 'visibilitychange']) document.addEventListener(name, record, true);
      for (const name of ['pageshow', 'pagehide']) window.addEventListener(name, record, true);
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
      const scopes = group === 'cultivate' ? ['cultivate', 'dungeon', 'fog'] : ['expedition', 'farm'];
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
      '/api/farm/sell', '/api/me/balance', '/api/stamina']);
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
          { path: info.path, startedAt: info.at, status: result.status, outcome: result.outcome,
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
      // 原参数、this、Promise 和 Response 原样传递，不读取请求头/正文或响应正文。
      const promise = Reflect.apply(originalFetch, this, args);
      try {
        const input = args[0];
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href :
          input instanceof Request ? input.url : null;
        const url = raw === null ? null : new URL(raw, document.baseURI);
        const group = pageGroup(location.pathname) || previous?.group;
        if (url?.origin === location.origin && paths.has(url.pathname) && group) {
          const info = { group, path: url.pathname, at };
          const method = String(args[1]?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
          const report = result => {
            record(info, result);
            if (claimCapture?.path === info.path && method === 'POST') claimCapture.result(result);
          };
          promise.then(response => {
            let loginRedirect = false;
            if (response.redirected && response.url) {
              const target = new URL(response.url);
              loginRedirect = target.origin === location.origin && target.pathname === '/';
            }
            report({ status: response.status, redirected: response.redirected,
              outcome: loginRedirect ? 'login-redirect' : response.ok ? 'ok' : 'http-error',
              ...(loginRedirect ? { to: '/' } : {}) });
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
    if (!enabled) { clearAccountStop(); recoveryBudget.clear(); }
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
      const action = /^(dungeon|fog):/.test(kind) ? message :
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
    log.pulse(statusText);
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
    if ([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(visible)) {
      say('请先处理当前弹窗'); return;
    }
    if (notices.some(el => /正在处理修炼操作|正在恢复原请求/.test(textOf(el)))) {
      say('游戏正在处理修炼操作，等待原结果');
      return;
    }
    if (Date.now() < nextActionAt) return;
    const refresh = locator.query('button[aria-label="刷新修炼状态"]');
    if (!refresh || !usable(refresh)) {
      pageWait.wait('等待修炼状态刷新完成', !encounterAction && !pendingOperation(), say,
        reason => setEnabled(false, reason));
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
      pageWait.wait('等待修仙主殿加载，请保持登录', !encounterAction && !pendingOperation(), say,
        reason => setEnabled(false, reason)); return;
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
  let idleWait = loadState(sessionStorage, IDLE_JOURNAL, null, 'expedition', timedState);
  let idleChecked = false;
  let idleBlocked = false;
  let idleSignature = '';
  let diagnostic = {};
  const log = createLog('expedition');
  const recoveryBudget = createRecovery('expedition', log, message => say(message));
  const farmWait = createPageWait('farm', log);
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
    }
    cancelQueued(); schedule();
  });
  shadow.getElementById('farm-check').addEventListener('click', () => {
    if (stateFault('farm')) { say(stateFault('farm')); return; }
    saveFarmState({ ...farmState, nextAt: 0, note: '等待检查农场' });
    schedule();
  });

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
    diagnostic = { ...diagnostic, blocked: reason, blockedSince: idleWait.since,
      blockedMs: Math.max(0, now - idleWait.since), reloaded: idleWait.reloaded, dialogs, ...detail };
    // 同一阻塞只在原因变化时记录，持续时长由已有低频心跳和恢复事件补充。
    const signature = JSON.stringify({ reason, dialogs, button: detail.button && {
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
    if (plan || claimWait || nativePending().length) {
      if (now - idleWait.since >= 90000) setEnabled(false, `${reason}；原结果未确认，已暂停并保留记录`);
      else say(`${reason}；等待原结果，不重复提交`);
      return;
    }
    if (idleWait.reloaded && Date.now() - idleWait.at >= 5 * 60000) {
      setEnabled(false, `${reason}；一次刷新后仍无进展，已暂停，请核对页面`);
    } else if (!idleWait.reloaded && Date.now() - idleWait.at >= 90000) {
      offer('idle-refresh', '刷新并核对停滞的远征页面', () => {
        idleWait = { ...idleWait, reloaded: true, at: Date.now() };
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
    if (!value) cancelFarmRead();
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
    const root = currentElement(document.querySelectorAll('section[aria-label="远征派遣额度"]'));
    if (!locator.readable(root)) return null;
    function read(label, ratio) {
      const node = currentElement([...root.querySelectorAll('span')].filter(el => textOf(el) === label));
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
        link.click();
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
  function staminaReadyAt(s, need) {
    return Date.now() + (s.nextRegen ?? s.regen) + Math.max(0, need - s.stamina - 1) * s.regen + 2000;
  }
  function readFarmMarket() {
    if (farmMarketLoading) return;
    if (!navigator.onLine) { say('农场行情：网络离线，等待连接恢复'); return; }
    if (Date.now() < farmReadNextAt) { say('农场行情暂时不可用，等待有限重试'); return; }
    const generation = farmReadGeneration;
    const current = () => generation === farmReadGeneration && inFarm() && enabled && farmEnabled && active && !accountStopReason();
    farmReadController = new AbortController();
    farmReadAttempts++;
    farmMarketLoading = true;
    say('读取本轮最新行情与种植加成');
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
      } else { say('等待你处理农场弹窗'); return; }
    }
    const tabs = locator.query('[role="tablist"][aria-label="农场功能"]');
    const plotsTab = [...(tabs?.querySelectorAll('[role="tab"]') || [])].find(b => textOf(b) === '田地');
    if (!dialogs.length && plotsTab && plotsTab.getAttribute('aria-selected') !== 'true') {
      if (usable(plotsTab)) offer('farm:plots', '切换田地页', () => plotsTab.click());
      return;
    }
    const s = farmSnapshot();
    if (!s) {
      farmWait.wait('等待田地、成熟时间和体力数据加载', !farmPlan && !dialogs.length, say, pauseFarm);
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
    if (accountStopReason()) {
      if (enabled) setEnabled(false, accountStopReason()); else say(accountStopReason());
      return;
    }
    if (stateFault('expedition')) {
      if (enabled) setEnabled(false, stateFault('expedition')); else say(stateFault('expedition'));
      return;
    }
    if (!onPage() || !enabled) { if (farmMarketLoading) cancelFarmRead(); releaseLock?.(); return; }
    if (!navigator.locks) { setEnabled(false, '请使用支持标签页互斥的新版浏览器'); return; }
    if (!active) { acquire(); return; }
    log.pulse(status.textContent, diagnostic);
    const errors = [...document.querySelectorAll('[role="status"].text-destructive, [role="status"].bg-destructive, [role="alert"].text-destructive, [role="alert"].bg-destructive')].filter(visible).map(textOf).join(' ');
    if (/(?:\b(?:401|403|429)\b|cyber_abuse|abuse_detected|user_disabled|未登录|登录.*(?:失效|过期)|账号已切换|封禁|禁用|访问被拒绝|权限不足|频率|频繁|限流|rate.?limit|unauthori[sz]ed|forbidden)/i.test(errors)) {
      pauseAccount('游戏提示登录、权限或限流异常');
      return;
    }
    if (Date.now() < nextStepAt) return;
    if (inFarm()) { expeditionObserved = false; farmStep(); return; }
    if (farmEntryAt || farmMarketLoading || farmReadAttempts) cancelFarmRead();
    farmEntryAt = 0; farmSignature = ''; ownSeedDialog = null; openingSeedsAt = 0; farmMarket = null;
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible);
    // 用户可在首次扫描前打开弹窗，不能要求先识别被遮住的背景表单。
    if (!plan && dialogs.length) { say('等待你处理当前弹窗'); return; }
    const q = quotas();
    const fields = form();
    diagnostic = { quota: q, farmEnabled, farmDueAt: farmState.nextAt || 0,
      pendingDispatch: Boolean(plan), pendingClaim: Boolean(claimWait) };
    if (!q || !fields.root || !fields.count || !fields.burst || !fields.high) {
      waitForIdlePage('等待远征页面和额度加载，请保持登录');
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
      idleChecked = false;
      idleBlocked = false;
      farmWait.begin();
      try { observeSessionPage(); step(); }
      catch (error) { log.add('runtime-error', '远征检查异常，已暂停并保留原记录', { name: error?.name || 'Error', stage: 'expedition-check' }); setEnabled(false, '远征检查失败，已暂停；请核对页面后重试'); }
      finally {
        if (!offered) cancelQueued();
        if (idleChecked && !idleBlocked) clearIdleWait(true);
        if (enabled && active && farmEnabled && inFarm()) farmWait.finish();
      }
    });
  }
  log.observeLifecycle(() => onPage() ? { enabled, ownsLock: active, state: status.textContent,
    pendingDispatch: Boolean(plan), pendingClaim: Boolean(claimWait), pendingFarm: Boolean(farmPlan), diagnostic } : null);
  subscribeWakeup(schedule, onPage, () => enabled);
  window.addEventListener('pagehide', () => { cancelFarmRead(); cancelQueued(); releaseLock?.(); });
  window.addEventListener('storage', event => {
    if (event.key === PREF) {
      enabled = event.newValue !== 'false';
      toggle.textContent = enabled ? '暂停远征与农场' : '开始远征与农场';
      if (!enabled) { cancelFarmRead(); cancelQueued(); releaseLock?.(); say('已暂停'); }
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
  observeSession();
})();
