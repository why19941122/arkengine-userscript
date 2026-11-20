import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchTestBrowser } from './arkengine-browser-test-runtime.mjs';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { expeditionMarkup } from './arkengine-expedition.fixture.mjs';
import { dungeonMarkup } from './arkengine-dungeon.fixture.mjs';
import { farmMarkup } from './arkengine-farm.fixture.mjs';

import { shelterMarkup } from './arkengine-shelter.fixture.mjs';
import { shelterTests } from './arkengine-shelter.tests.mjs';
import { shelterConstructionTests } from './arkengine-shelter-construction.tests.mjs';
import { shelterCampaignTests } from './arkengine-shelter-campaign.tests.mjs';
import { shelterExplorationTests } from './arkengine-shelter-exploration.tests.mjs';
import { shelterStaffTests } from './arkengine-shelter-staff.tests.mjs';
import { shelterRevivalTests } from './arkengine-shelter-revival.tests.mjs';
import { shelterFutureEmploymentTests } from './arkengine-shelter-future-employment.tests.mjs';
import { shelterParentTraining72Tests } from './arkengine-shelter-parent-training72.tests.mjs';
import { shelterParentPreparationTests } from './arkengine-shelter-parent-preparation.tests.mjs';
import { shelterLog127Tests } from './arkengine-shelter-log127.tests.mjs';
import { shelterPlanningBrowserTests } from './arkengine-shelter-planning-browser.tests.mjs';
import { shelterConfirmationTests } from './arkengine-shelter-confirmation.tests.mjs';
import { shelterProductionTests } from './arkengine-shelter-production.tests.mjs';
import { shelterPopulationTests } from './arkengine-shelter-population.tests.mjs';
import { stockMarkup, stockOwnedPosition } from './arkengine-stock.fixture.mjs';
import { stockTests } from './arkengine-stock.tests.mjs';
import { settingsTests } from './arkengine-settings.tests.mjs';
import { enabledDefaultsTests } from './arkengine-enabled-defaults.tests.mjs';
import { crossFeatureMarkup } from './arkengine-cross-feature.fixture.mjs';
import { crossFeatureTests } from './arkengine-cross-feature.tests.mjs';
import { singlePageMarkup } from './arkengine-single-page.fixture.mjs';
import { singlePageTests } from './arkengine-single-page.tests.mjs';
import { readLifecycleTests } from './arkengine-read-lifecycle.tests.mjs';
import { dialogRecoveryTests } from './arkengine-dialog-recovery.tests.mjs';
import { currentGrowthTests } from './arkengine-shelter-current-growth.tests.mjs';

// 无第三方依赖。使用独立的无头浏览器和本地模拟页面，不连接游戏、不使用玩家账号。
const rawSource = await readFile(process.env.ARKENGINE_TEST_SOURCE || new URL('./arkengine-auto-encounter.user.js', import.meta.url), 'utf8');
const scriptVersion=rawSource.match(/^\/\/ @version\s+(\S+)/m)[1];
assert.equal(rawSource.match(/const SCRIPT_VERSION\s*=\s*'([^']+)'/)?.[1],scriptVersion,
  '发布标头、面板与日志版本必须一致；请同步更新 SCRIPT_VERSION');
// 仅测试上下文暴露实际日志存储，等待其事务队列；发布脚本不含此入口。
const source = rawSource.replace('const logStore = createLogStore();', 'const logStore = createLogStore(); window.__arkTestLogs = logStore;')
  .replace('function historyTotals(entries,archive={}) {','$& if(window.panelProbe)panelProbe.totals++;')
  .replace('function spend(entries,action,now) {','$& if(window.panelProbe)panelProbe.spend++;')
  .replace('function stockHint() {','$& if(window.panelProbe)panelProbe.ticks++;')
  .replace('function shelterCampaignPlan(m,cfg={},record={},target=14) {',
    'function shelterCampaignPlan(m,cfg={},record={},target=14) { if(typeof window!=="undefined"&&window.sm?.planCostMs&&!cfg.maintenanceOnly){clock+=sm.planCostMs;sm.planCalls=(sm.planCalls||0)+1;}' +
    'if(typeof window!=="undefined"&&window.sm?.executionPlanCostMs&&!cfg.maintenanceOnly&&(document.querySelector("[data-staff-dialog],[data-construction-dialog]")||sm.slowDeparture&&sm.tab==="废土")){' +
    'clock+=sm.executionPlanCostMs;sm.executionPlanCalls=(sm.executionPlanCalls||0)+1;}');
const executable = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));
assert.ok(executable, '需要本机 Chrome / Edge，或设置 CHROME_PATH');

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async evaluate(session, expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true,
      replMode: expression.includes('(await window.__arkTestLogs') }, session)
      .catch(error => { throw new Error(`${error.message}: ${expression.slice(0, 180)}`, { cause: error }); });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}

async function until(check, description, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await delay(80);
  }
  throw new Error(`Timeout: ${description}`);
}

const markup = `<!doctype html><meta charset="utf-8"><title>本地奇遇测试</title>
<main id="game"></main><script>
window.clicks = [];
window.timeOffset = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + window.timeOffset;
window.base = () => {
  game.innerHTML = '<button id="refresh" aria-label="刷新修炼状态">刷新</button>' +
    '<section><h2>寻访奇遇</h2><button id="seek" disabled>奇遇冷却 5:30</button></section>' +
    '<button id="breakthrough">突破</button>' +
    '<button id="wash">洗练灵根 · 100 钻石</button>';
  ['refresh', 'breakthrough', 'wash'].forEach(id => {
    document.getElementById(id).onclick = () => clicks.push(id);
  });
};
window.choices = (rewards, labels = ['甲', '乙', '丙']) => {
  document.getElementById('cultivation-encounter')?.remove();
  const panel = document.createElement('section');
  panel.id = 'cultivation-encounter';
  panel.innerHTML = '<h2>仙山奇遇</h2><p>请选择一条路。</p><div></div>';
  rewards.forEach((reward, index) => {
    const button = document.createElement('button');
    button.innerHTML = '<svg></svg><span>' + labels[index] + '<span class="block text-caption">' + reward + '</span></span>';
    button.addEventListener('click', () => {
      clicks.push(index);
      if (window.removeAfterChoice) panel.remove();
    });
    panel.lastElementChild.append(button);
  });
  game.append(panel);
};
window.recover = action => {
  sessionStorage.setItem('cultivation:operation:fixture', JSON.stringify({input:{action},idempotencyKey:'test-key'}));
  const button = document.createElement('button');
  button.textContent = '确认原修炼结果';
  button.onclick = () => clicks.push('recover');
  game.append(button);
};
window.notice = (text, error = false) => {
  const node = document.createElement('p');
  node.setAttribute('role', 'status');
  if (error) node.className = 'text-destructive';
  node.textContent = text;
  game.append(node);
  return node;
};
base();
</script>`;

// 来自公开首页的固定登录标志；没有账号或真实登录接口。
const loginMarkup = `<!doctype html><meta charset="utf-8"><main>
<a href="/api/auth/linuxdo">使用 LinuxDo 登录</a>
<form aria-label="备用账号登录"><input name="login"><input type="password" name="password"></form>
</main><script>window.loginFixture=true;</script>`;

// 五百余项顺序执行的完整验收已耗时约44分钟；整轮留60分钟，单步/CDP超时保持不变。
test('单页奇遇、秘境、远征与农场：真实 Chromium DOM 集成检查', { timeout: 3600000 }, async t => {
  // Node 按父测试匹配名称时会包含全部子项；显式筛选用于修改后的定向复测。
  if (process.env.ARKENGINE_TEST_PATTERN) {
    const pattern = new RegExp(process.env.ARKENGINE_TEST_PATTERN);
    const register = t.test.bind(t);
    t.test = (name, run) => register(name, { skip: !pattern.test(name) }, run);
  }
  let expeditionRequests = 0;
  let diagnosticRequests = 0;
  let startupResponse;
  let delayFarmReload = false;
  let farmReloadResponse;
  let delayedFeaturePath=null,featureNavigationResponses=[];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if(delayedFeaturePath && url.pathname===delayedFeaturePath){featureNavigationResponses.push(res);return;}
    if (delayFarmReload && url.pathname === '/farm') {
      farmReloadResponse = res;
      return; // 刷新请求已发出，但旧文档仍存活，模拟网站响应迟到。
    }
    if (url.searchParams.has('startup-fixture')) {
      startupResponse = res;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.write('<!doctype html><html><head><script>window.startupHead=true;</script></head>');
      return; // 由测试继续发送正文，保持文档 loading，不触发 DOMContentLoaded/load。
    }
    if (url.pathname.startsWith('/api/')) {
      diagnosticRequests++;
      if (url.searchParams.has('network-error')) { req.socket.destroy(); return; }
      if (url.searchParams.has('redirect')) {
        res.writeHead(302, { Location: '/?login-fixture=1&token=redirect-secret' }); res.end(); return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        res.writeHead(Number(url.searchParams.get('code') || 200), { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, body, privateValue: 'response-secret' }));
      });
      return;
    }
    if (url.searchParams.has('login-fixture')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(loginMarkup); return;
    }
    const expedition = req.url.startsWith('/activities/expedition');
    if (expedition) expeditionRequests++;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.url.includes('single-page-fixture') ? singlePageMarkup : req.url.includes('cross-feature-fixture') ? crossFeatureMarkup : req.url.includes('stock-fixture') || url.pathname === '/stock' ? stockMarkup : req.url.includes('shelter-fixture') ? shelterMarkup : req.url.includes('farm-fixture') || url.pathname === '/farm' && !url.searchParams.has('test') ? farmMarkup : expedition ? expeditionMarkup : req.url.includes('dungeon-fixture') ? dungeonMarkup : markup);
  });
  let cdp, runtime;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    runtime = await launchTestBrowser(executable);
    const { profile, browser } = runtime;
    const portFile = join(profile, 'DevToolsActivePort');
    let port, wsPath;
    // Windows can expose this file before Chrome releases its handle or finishes both lines.
    await until(async () => {
      if (runtime.error) throw runtime.error;
      if (browser.exitCode !== null || browser.signalCode !== null) throw new Error('测试浏览器在调试端口就绪前退出');
      try {
        [port, wsPath] = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
        return /^\d+$/.test(port) && Number(port)>0 && Number(port)<=65535 &&
          /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(wsPath || '');
      } catch (error) {
        if (['ENOENT','EBUSY'].includes(error.code)) return false;
        throw error;
      }
    }, 'Chrome debugging port readable and complete', 15000);
    const socket = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    cdp = new CDP(socket);
    const createTab = async () => {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      return { targetId, sessionId };
    };
    const tab = await createTab();
    const withFrozenOriginal = targetId => async run => {
      await cdp.send('Target.activateTarget',{targetId});
      let failure;
      try {
        await cdp.send('Page.setWebLifecycleState',{state:'frozen'},tab.sessionId);
        return await run();
      }catch(error){failure=error;throw error;}
      finally {
        await cdp.send('Page.setWebLifecycleState',{state:'active'},tab.sessionId);
        if(failure)try{failure.message+=' '+JSON.stringify(await cdp.evaluate(tab.sessionId,`({url:location.href,visibility:document.visibilityState,
          hook:window.fixtureFreezeInstalled,event:window.fixtureFrozenEvent,shared:localStorage.getItem('fixture:shelter-frozen'),
          script:!!window.__arkTestLogs,calls:window.sm?.calls?.length})`));}catch{}
      }
    };
    const evaluate = expression => cdp.evaluate(tab.sessionId, expression);
    const status = () => evaluate(`document.getElementById('ark-auto-expedition')?.shadowRoot.getElementById('status').textContent`);
    const clickLog = () => evaluate('clicks');
    const resetLogs = () => evaluate(`new Promise((resolve,reject)=>{
      const req=indexedDB.deleteDatabase('arkengine-auto-log');req.onsuccess=resolve;req.onerror=()=>reject(req.error);
    })`);
    // Existing business scenarios start after initial setup, with their explicit switches intact.
    // Startup-default tests remove these markers to exercise the real installation/upgrade path.
    const configuredDefaults=`localStorage.setItem('arkengine:auto-encounter:enabled:v1','false');for(const scope of ['stock','shelter'])localStorage.setItem('arkengine:auto-defaults:'+scope+':v1','applied');`;
    let pageSerial = 0;
    const setup = async (code = '', path = '/cultivate') => {
      await cdp.send('Page.navigate', { url: `${origin}${path}?test=${++pageSerial}` }, tab.sessionId);
      await until(() => evaluate(`location.search === '?test=${pageSerial}' && typeof window.base === 'function'`), 'fixture ready');
      await resetLogs();
      await evaluate(`localStorage.clear(); sessionStorage.clear(); ${configuredDefaults} localStorage.setItem('arkengine:auto-encounter:enabled:v1','true'); localStorage.setItem('arkengine:auto-dungeon:enabled:v1','false'); Math.random = () => 0; ${code}`);
      await evaluate(source);
    };
    const expectClick = async expected => {
      await until(async () => (await clickLog()).length > 0, 'script clicks expected button');
      assert.deepEqual(await clickLog(), [expected]);
    };

    await t.test('后台节流回归：主线程定时器延迟一分钟时仍可等待并领取奇遇', async () => {
      await setup(`
        choices(['修为 +10', '修为 +20', '钻石 +1']);
        window.mainTimerCalls = 0;
        const originalTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, milliseconds, ...args) => {
          mainTimerCalls++;
          return originalTimeout(callback, Math.max(milliseconds || 0, 60000), ...args);
        };
      `);
      const foreground = await createTab();
      try {
        await cdp.send('Target.activateTarget', { targetId: foreground.targetId });
        assert.equal(await evaluate('document.visibilityState'), 'hidden');
        await until(async () => (await status())?.includes('随机等待'), 'background scheduler reaches choice', 2500);
        assert.deepEqual(await clickLog(), [], '保留随机等待，不能直接点击');
        await expectClick(2);
        assert.ok(await evaluate('mainTimerCalls > 0'), '主线程等待定时器确实受节流模拟影响');
      } finally { await cdp.send('Target.closeTarget', { targetId: foreground.targetId }); }
    });

    await t.test('寻访和选项各自随机等待，重复检查不会重新抽取延迟', async () => {
      await setup(`
        window.clock = 10000; Date.now = () => clock;
        window.draws = 0; Math.random = () => [0, 0.9999999][draws++];
        seek.disabled = false; seek.textContent = '寻找奇遇';
        seek.onclick = () => { clicks.push('seek'); seek.disabled = true;
          seek.textContent = '奇遇冷却 0:20'; choices(['修为 +1', '修为 +3', '修为 +2']); };
      `);
      await until(async () => (await status())?.includes('随机等待 2.0 秒'), 'minimum random delay');
      assert.deepEqual(await clickLog(), []);
      await evaluate(`clock = 11999; game.append(document.createElement('hr'));`);
      await until(async () => (await status())?.includes('随机等待 0.1 秒'), 'seek still waits before deadline');
      assert.deepEqual(await clickLog(), []);
      assert.equal(await evaluate('draws'), 1);
      await evaluate(`clock = 12000; game.append(document.createElement('hr'));`);
      await expectClick('seek');
      await evaluate(`clock = 13500; game.append(document.createElement('hr'));`);
      await until(async () => (await status())?.includes('随机等待 5.0 秒'), 'new random delay for choice');
      await evaluate(`clock = 18499; game.append(document.createElement('hr'));`);
      await until(async () => (await status())?.includes('随机等待 0.1 秒'), 'choice still waits before deadline');
      assert.deepEqual(await clickLog(), ['seek']);
      assert.equal(await evaluate('draws'), 2);
      await evaluate(`clock = 18500; game.append(document.createElement('hr'));`);
      await until(async () => (await clickLog()).length === 2, 'delayed best choice');
      assert.deepEqual(await clickLog(), ['seek', 1]);
    });
    await t.test('暂停会取消等待，重新开始时重新计时', async () => {
      await setup(`window.clock = 10000; Date.now = () => clock; choices(['修为 +1', '修为 +2', '修为 +3']);`);
      await until(async () => (await status())?.includes('随机等待'), 'queued choice');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click(); clock = 20000; game.append(document.createElement('hr'));`);
      await until(async () => (await status()) === '已暂停', 'cancel queued choice');
      assert.deepEqual(await clickLog(), []);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click()`);
      await until(async () => (await status())?.includes('随机等待 2.0 秒'), 'resume with fresh delay');
      assert.deepEqual(await clickLog(), []);
      await evaluate(`clock = 22000; game.append(document.createElement('hr'));`);
      await expectClick(2);
    });
    await t.test('共享暂停延迟：修仙未收到storage通知也须撤销旧点击，不新增记录且重新开始重新等待',async()=>{
      await setup(`window.clock=10000;Date.now=()=>clock;choices(['修为 +1','修为 +2','修为 +3']);`);
      await until(async()=>(await status())?.includes('随机等待'),'cultivate queued before shared pause');
      await evaluate(`localStorage.setItem('arkengine:auto-encounter:enabled:v1','false');clock+=5000;window.dispatchEvent(new Event('focus'));`);
      await delay(200);
      assert.deepEqual(await clickLog(),[]);
      assert.equal(await status(),'已暂停');
      assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-encounter:action:v1')`),null);
      await evaluate(`window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-encounter:enabled:v1',newValue:'true'}));clock+=5000;window.dispatchEvent(new Event('focus'));`);
      await delay(200);
      assert.deepEqual(await clickLog(),[],'旧开启通知不能越过已保存的暂停');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('cultivate-toggle').click();`);
      await until(async()=>(await status())?.includes('随机等待 2.0 秒'),'new delay after explicit resume');
      assert.deepEqual(await clickLog(),[]);
      await evaluate(`clock+=2000;window.dispatchEvent(new Event('focus'));`);
      await expectClick(2);
    });
    await t.test('等待期间奖励变化时重新比较，不点击旧的最高奖励', async () => {
      await setup(`window.clock = 10000; Date.now = () => clock; choices(['修为 +100', '修为 +2', '修为 +3']);`);
      await until(async () => (await status())?.includes('随机等待'), 'initial choice delay');
      await evaluate(`clock = 12000; choices(['修为 +100', '钻石 +1', '修为 +3']);`);
      await until(async () => (await status())?.includes('随机等待 2.0 秒'), 'new rewards restart delay');
      await delay(200);
      assert.deepEqual(await clickLog(), []);
      await evaluate(`clock = 14000; game.append(document.createElement('hr'));`);
      await expectClick(1);
    });
    await t.test('等待期间重新冷却时不寻访，冷却缩短后按按钮继续', async () => {
      await setup(`window.clock = 10000; Date.now = () => clock; seek.disabled = false;
        seek.textContent = '寻找奇遇'; seek.onclick = () => clicks.push('seek');`);
      await until(async () => (await status())?.includes('随机等待'), 'queued seek');
      await evaluate(`clock = 15000; seek.disabled = true; seek.textContent = '奇遇冷却 0:03';`);
      await until(async () => (await status()) === '奇遇冷却 0:03', 'cancel seek on new cooldown');
      assert.deepEqual(await clickLog(), []);
      await evaluate(`clock = 18000; seek.disabled = false; seek.textContent = '寻找奇遇';`);
      await until(async () => (await status())?.includes('随机等待 2.0 秒'), 'short cooldown ends');
      assert.deepEqual(await clickLog(), []);
      await evaluate(`clock = 20000; game.append(document.createElement('hr'));`);
      await expectClick('seek');
    });

    await t.test('按数字比较修为，忽略剧情中的钻石和外部洗练按钮', async () => {
      await setup(`choices(['修为 +9,999 · 代币 +90', '修为 +12,000', '修为 +800'], ['钻石 +999999 的传说', '最高修为', '第三条路']);`);
      await expectClick(1);
      await delay(1800);
      assert.deepEqual(await clickLog(), [1], '等待结果时不能重复提交');
    });
    await t.test('有钻石时选择最高钻石，即使其他项修为更多', async () => {
      await setup(`choices(['修为 +999,999', '钻石 +8 · 修为 +10', '钻石 +12']);`);
      await expectClick(2);
    });
    await t.test('钻石相同则比较修为，支持万和亿', async () => {
      await setup(`choices(['钻石 +5 · 修为 +1.2万', '钻石 +5 · 修为 +0.01亿', '钻石 +4 · 修为 +900,000']);`);
      await expectClick(1);
    });
    await t.test('两个奇遇选项：随机等待后选择最高钻石或修为', async () => {
      for (const [rewards, expected] of [
        [['修为 +9,999', '修为 +1.2万'], 1],
        [['钻石 +1', '修为 +999,999'], 0],
        [['钻石 +5 · 修为 +100', '钻石 +8'], 1],
        [['钻石 +5 · 修为 +200', '钻石 +5 · 修为 +100'], 0],
      ]) {
        await setup(`window.clock = 10000; Date.now = () => clock;
          window.removeAfterChoice = true; choices(${JSON.stringify(rewards)});`);
        await until(async () => (await status())?.includes('随机等待 2.0 秒'), 'two choices queue with delay');
        assert.deepEqual(await clickLog(), []);
        await evaluate(`clock = 12000; game.append(document.createElement('hr'));`);
        await expectClick(expected);
        await evaluate(`clock = 14000; game.append(document.createElement('hr'));`);
        await until(async () => (await status())?.includes('奇遇冷却'), 'two-choice encounter completes');
        assert.deepEqual(await clickLog(), [expected]);
      }
    });
    await t.test('两个选项等待期间出现第三项时重新比较并等待', async () => {
      await setup(`window.clock = 10000; Date.now = () => clock; choices(['修为 +100', '修为 +200']);`);
      await until(async () => (await status())?.includes('随机等待 2.0 秒'), 'two choices queued');
      await evaluate(`clock = 12000; choices(['修为 +100', '修为 +200', '钻石 +1']);`);
      await until(async () => (await status())?.includes('随机等待 2.0 秒'), 'added choice resets delay');
      assert.deepEqual(await clickLog(), [], '不能在旧截止时间点击原来的最高修为');
      await evaluate(`clock = 14000; game.append(document.createElement('hr'));`);
      await expectClick(2);
    });
    await t.test('正在处理时等待，完成后由 DOM 变化唤醒', async () => {
      await setup(`choices(['修为 +10', '修为 +20', '修为 +30']); window.busy = notice('正在处理修炼操作，请等待原结果。');`);
      await until(async () => (await status())?.includes('等待原结果'), 'busy status');
      assert.deepEqual(await clickLog(), []);
      await evaluate('busy.remove()');
      await expectClick(2);
    });
    await t.test('不会为了可点击而选择收益更低的项', async () => {
      await setup(`choices(['修为 +10', '修为 +20', '修为 +30']); document.querySelectorAll('#cultivation-encounter button')[2].disabled = true;`);
      await until(async () => (await status())?.includes('选项可以点击'), 'disabled best choice');
      assert.deepEqual(await clickLog(), []);
      await evaluate(`document.querySelectorAll('#cultivation-encounter button')[2].disabled = false`);
      await expectClick(2);
    });
    await t.test('两个和三个选项交替时，冷却、寻访和选择形成完整循环', async () => {
      await setup(`window.clock=100000;Date.now=()=>clock;window.removeAfterChoice=true;window.round=0;
        localStorage.setItem('arkengine:auto-farm:schedule:v1',JSON.stringify({nextAt:clock+3600000,expeditionAt:clock+2400000}));
        seek.textContent='寻找奇遇';seek.disabled=false;
        seek.onclick=()=>{clicks.push('seek');seek.disabled=true;seek.textContent='奇遇冷却 5:30';choices(++round===1?['修为 +20','修为 +5']:['修为 +20','修为 +5','修为 +10']);};`);
      for(let index=0;index<8;index++){await evaluate(`clock+=1000;window.dispatchEvent(new Event('focus'));`);await delay(160);}
      await until(async () => (await clickLog()).length === 2, 'first round', 15000);
      assert.deepEqual(await clickLog(), ['seek', 0]);
      await evaluate(`clock+=5000;window.dispatchEvent(new Event('focus'));`);
      await until(()=>evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-encounter:schedule:v1'))?.nextAt>clock`),'next encounter appointment');
      await evaluate(`clock=JSON.parse(localStorage.getItem('arkengine:auto-encounter:schedule:v1')).nextAt;seek.textContent='寻找奇遇';seek.disabled=false;`);
      for(let index=0;index<8;index++){await evaluate(`clock+=1000;window.dispatchEvent(new Event('focus'));`);await delay(160);}
      await until(async () => (await clickLog()).length === 4, 'second round', 15000);
      assert.deepEqual(await clickLog(), ['seek', 0, 'seek', 0]);
    });
    await t.test('只能恢复 encounter 原操作', async () => {
      await setup(`recover('encounter');`);
      await expectClick('recover');
      for (const action of ['wash_root', 'breakthrough']) {
        await setup(`recover('${action}');`);
        await until(async () => (await status())?.includes('请手动处理'), 'reject other recovery');
        assert.deepEqual(await clickLog(), []);
      }
    });
    await t.test('奖励格式不明或选项数量异常时不猜测', async () => {
      for (const rewards of ["['修为 +1', '修为 +未知', '修为 +2']", "['修为 +1', '修为 +未知']", "[]", "['修为 +1']", "['代币 +10', '灵力 +20', '灵石 +3']"]) {
        await setup(`choices(${rewards});`);
        await until(async () => /无法识别|等待两个或三个|没有钻石/.test(await status()), 'unrecognized choices');
        assert.deepEqual(await clickLog(), []);
      }
    });
    await t.test('暂停可以持久化并手动恢复', async () => {
      await setup(`localStorage.setItem('arkengine:auto-encounter:enabled:v1','false'); choices(['修为 +1', '修为 +2', '修为 +3']);`);
      await until(async () => (await status()) === '已暂停', 'paused');
      assert.deepEqual(await clickLog(), []);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('cultivate-toggle').click()`);
      await expectClick(2);
    });
    await t.test('限流或登录异常暂停，必须手动恢复', async () => {
      await setup(`notice('429 请求过于频繁', true); choices(['修为 +1', '修为 +2', '修为 +3']);`);
      await until(async () => (await status())?.includes('异常，已暂停'), 'error stop');
      assert.deepEqual(await clickLog(), []);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-encounter:enabled:v1')`), 'false');
    });
    await t.test('超时先刷新状态，再重试原选项', async () => {
      await setup(`choices(['修为 +1', '修为 +2', '修为 +3']);`);
      await expectClick(2);
      await evaluate(`timeOffset += 31000; game.append(document.createElement('hr'));`);
      await until(async () => (await clickLog()).length === 2, 'refresh after timeout');
      assert.deepEqual(await clickLog(), [2, 'refresh']);
      await evaluate(`timeOffset += 31000; game.append(document.createElement('hr'));`);
      await delay(200);
      assert.deepEqual(await clickLog(), [2, 'refresh'], '刷新后延长等待，不每30秒重试');
      await evaluate(`timeOffset += 90000; game.append(document.createElement('hr'));`);
      await until(async () => (await clickLog()).length === 3, 'retry choice');
      assert.deepEqual(await clickLog(), [2, 'refresh', 2]);
    });
    await t.test('其他路径不点击，SPA 进入主殿后启动', async () => {
      await setup(`choices(['修为 +1', '修为 +2', '修为 +3']);`, '/unrelated');
      await delay(400);
      assert.deepEqual(await clickLog(), []);
      assert.equal(await evaluate(`document.getElementById('ark-auto-expedition').hidden`), true);
      await evaluate(`history.pushState({}, '', '/cultivate'); game.append(document.createElement('hr'));`);
      await expectClick(2);
    });
    await t.test('两个标签页只允许一个自动操作，关闭后接力', async () => {
      await setup(`window.clock=10000;Date.now=()=>clock;choices(['修为 +1','修为 +2','修为 +3']);`);
      await until(async () => (await status())?.includes('随机等待'), 'first tab owns lock');
      const second = await createTab();
      try {
        await cdp.send('Page.navigate', { url: `${origin}/cultivate?second=1` }, second.sessionId);
        await until(() => cdp.evaluate(second.sessionId, `location.search === '?second=1' && typeof base === 'function'`), 'second fixture');
        await cdp.evaluate(second.sessionId, `choices(['修为 +1', '修为 +2', '修为 +3']);`);
        await cdp.evaluate(second.sessionId, source);
        await until(() => cdp.evaluate(second.sessionId, `document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('另一挂机标签页')`), 'second tab waits');
        assert.deepEqual(await cdp.evaluate(second.sessionId, 'clicks'), []);
        await cdp.send('Page.navigate', { url: 'about:blank' }, tab.sessionId);
        await until(async () => (await cdp.evaluate(second.sessionId, 'clicks')).length === 1, 'second tab takes over');
        assert.deepEqual(await cdp.evaluate(second.sessionId, 'clicks'), [2]);
      } finally { await cdp.send('Target.closeTarget', { targetId: second.targetId }); }
    });
    await t.test('隐藏标签页仍可处理 DOM 变化', async () => {
      await setup();
      const foreground = await createTab();
      try {
        await cdp.send('Target.activateTarget', { targetId: foreground.targetId });
        assert.equal(await evaluate('document.visibilityState'), 'hidden');
        await evaluate(`choices(['修为 +10', '修为 +20', '钻石 +1']);`);
        await expectClick(2);
      } finally { await cdp.send('Target.closeTarget', { targetId: foreground.targetId }); }
    });

    const expStatus = () => evaluate(`document.getElementById('ark-auto-expedition')?.shadowRoot.getElementById('status').textContent`);
    const setupExp = async (code = '') => {
      await cdp.send('Page.navigate', { url: `${origin}/activities/expedition?test=${++pageSerial}` }, tab.sessionId);
      await until(() => evaluate(`location.search === '?test=${pageSerial}' && typeof renderExp === 'function'`), 'expedition fixture');
      await resetLogs();
      await evaluate(`localStorage.clear(); sessionStorage.clear(); ${configuredDefaults} Math.random = () => 0; model.burst=0;
        localStorage.setItem('arkengine:auto-farm:enabled:v1','false'); ${code}; renderExp();`);
      await evaluate(source);
    };
    const pulse = async (milliseconds = 1000) => {
      await evaluate(`clock += ${milliseconds}; window.dispatchEvent(new Event('focus'));`);
      await delay(160);
    };
    const drive = async (expression, label, rounds = 90) => {
      for (let i = 0; i < rounds; i++) {
        if (await evaluate(expression)) return;
        await pulse();
      }
      const detail=process.env.ARKENGINE_TEST_UI?await evaluate(`({calls:window.sm?.calls??window.km?.calls,pending:localStorage.getItem('arkengine:auto-shelter:pending:v1'),state:localStorage.getItem('arkengine:auto-shelter:schedule:v1'),stock:localStorage.getItem('arkengine:auto-stock:ledger:v1'),dialogs:[...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].map(d=>d.textContent),events:(await window.__arkTestLogs.read('expedition',undefined,Infinity))?.events?.slice(-6)??[]})`):null;
      throw new Error(`${label}: ${await expStatus()} / ${await status()}${detail?' / '+JSON.stringify(detail):''}`);
    };
    const setupUnified=async(code='',path='/activities/expedition')=>{
      await cdp.send('Page.navigate',{url:`${origin}${path}?single-page-fixture=${++pageSerial}`},tab.sessionId);
      await until(()=>evaluate(`typeof cm==='object'&&typeof renderFeature==='function'`),'single-page fixture');
      await resetLogs();
      await evaluate(`localStorage.clear();sessionStorage.clear();${configuredDefaults}
        localStorage.setItem('arkengine:auto-encounter:enabled:v1','true');
        localStorage.setItem('arkengine:auto-farm:enabled:v1','false');localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');
        Math.random=()=>0;model.burst=0;model.runs=[];addRuns(6);${code};renderFeature();`);
      await evaluate(source);
    };
    const reloadUnified=async()=>{
      const snapshot=await evaluate('({clock,model,fm,dm,cm})');
      await cdp.send('Page.navigate',{url:`${origin}/activities/expedition?single-page-fixture=${++pageSerial}`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?single-page-fixture=${pageSerial}'&&typeof cm==='object'&&!document.getElementById('ark-auto-expedition')`),'reload unified page');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderFeature();`);
      await evaluate(source);
    };
    const secondUnified=async run=>{
      const other=await createTab();
      const read=expression=>cdp.evaluate(other.sessionId,expression);
      try{
        await cdp.send('Page.navigate',{url:`${origin}/cultivate?single-page-fixture=other`},other.sessionId);
        await until(()=>read(`typeof cm==='object'`),'second unified page');
        await read(source);
        await run(read);
      }finally{await cdp.send('Target.closeTarget',{targetId:other.targetId});}
    };
    await singlePageTests({t,setupUnified,reloadUnified,evaluate,pulse,drive,secondUnified});
    const confirmed = `model.calls.filter(c => c.type === 'dispatch')`;

    await t.test('页面性能：空闲远征连续更新不重绘不变面板，不解析未变大记录，仍能识别同页存储变化',async()=>{
      await setupExp(`addRuns(6);window.perfKey='arkengine:auto-shelter:schedule:v1';window.stockPerfKey='arkengine:auto-stock:ledger:v1';
        localStorage.setItem(stockPerfKey,JSON.stringify({version:1,userId:null,nextAt:clock+3600000,note:'未交易',hold:false,owned:{},entries:[],pending:null,reportFixture:'perf-stock:'.repeat(12000)}));
        localStorage.setItem(perfKey,JSON.stringify({nextAt:clock+3600000,note:'等待巡检',development:'perf-journal:'.repeat(12000)}));
        const decode=window.atob;window.plannerDecodes=0;window.atob=function(text){if(text.length>200000)plannerDecodes++;return decode(text);};`);
      await pulse();await pulse();
      const observed=await evaluate(`(async()=>{
        const root=document.getElementById('ark-auto-expedition').shadowRoot,advice=root.getElementById('shelter-development');
        let writes=0,parses=0,stockParses=0;const observer=new MutationObserver(batch=>writes+=batch.length);
        observer.observe(advice,{childList:true,subtree:true,characterData:true});
        const parse=JSON.parse;JSON.parse=function(raw,...rest){if(typeof raw==='string'&&raw.length>100000){if(raw.includes('perf-journal:'))parses++;if(raw.includes('perf-stock:'))stockParses++;}return parse(raw,...rest);};
        const probe=document.createTextNode('');document.body.append(probe);
        try{const start=performance.now();for(let index=0;index<24;index++){
          probe.data=String(index);await Promise.resolve();await Promise.resolve();
        }return {writes,parses,stockParses,decodes:plannerDecodes,ms:Math.round(performance.now()-start)};
        }finally{observer.disconnect();JSON.parse=parse;probe.remove();}
      })()`);
      console.log('idle performance '+JSON.stringify(observed));
      assert.equal(observed.writes,0);assert.equal(observed.parses,0);assert.equal(observed.stockParses,0);assert.equal(observed.decodes,0);
      await evaluate(`localStorage.setItem(perfKey,JSON.stringify({nextAt:clock+3600000,note:'外部更新',development:'新的发展记录'}))`);
      await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('shelter-development').textContent==='新的发展记录'`,'refresh updated same-tab journal');
      await evaluate(`localStorage.setItem(stockPerfKey,'{invalid');`);
      await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('stock-status').textContent.includes('保存记录不可读')`,'reject corrupt same-tab ledger');
      assert.equal(await evaluate('localStorage.getItem(stockPerfKey)'),'{invalid');
    });

    await t.test('页面性能：空闲面板不重复扫描股市历史或改写控件，额度到期和账本更新立即生效',async()=>{
      await setupExp(`addRuns(6);window.edge=clock+180000;window.ledgerKey='arkengine:auto-stock:ledger:v1';
        const old=edge-2*86400000,entries=Array.from({length:1000},(_,index)=>({id:'old'+index,at:old,action:'sell',debit:0,result:'success',proceeds:2,releasedCost:1}));
        entries.push({id:'buy',action:'buy',at:old,confirmedAt:edge-86400000,debit:31,result:'success'},
          {id:'predict',action:'predict',at:edge-86400000+5000,debit:12,result:'reserved'});
        localStorage.setItem(ledgerKey,JSON.stringify({version:1,userId:null,nextAt:clock+3600000,note:'测试',hold:false,owned:{},entries,pending:null}));`);
      await pulse();await pulse();
      const panel=`document.getElementById('ark-auto-expedition').shadowRoot`,status=`${panel}.getElementById('stock-status').textContent`;
      assert.match(await evaluate(status),/24小时买入 31\/0；预测 12\/0/);
      assert.match(await evaluate(`${panel}.getElementById('stock-performance').textContent`),/已知已实现盈亏 1000/);
      const counts=await evaluate(`(async()=>{const root=${panel},probe=document.createTextNode('');document.body.append(probe);
        const counts=window.panelProbe={ticks:0,totals:0,spend:0,attributes:0},observer=new MutationObserver(batch=>counts.attributes+=batch.length);
        for(const id of ['shelter-level-target','shelter-cancel-old-assignment','stock-period-start','stock-period-export','stock-pause'])
          observer.observe(root.getElementById(id),{attributes:true,attributeFilter:['hidden','disabled']});
        try{for(let index=0;index<24;index++){probe.data=String(index);await Promise.resolve();await Promise.resolve();}
          counts.attributes+=observer.takeRecords().length;return counts;
        }finally{delete window.panelProbe;observer.disconnect();probe.remove();}})()`);
      console.log('idle panel work '+JSON.stringify(counts));
      assert.ok(counts.ticks>=20);assert.deepEqual([counts.totals,counts.spend,counts.attributes],[0,0,0]);
      const at=offset=>evaluate(`(async()=>{clock=edge+(${offset});document.body.append(document.createTextNode(''));await Promise.resolve();await Promise.resolve();return ${status};})()`);
      assert.match(await at(-1),/买入 31\/0；预测 12\/0/);assert.match(await at(0),/买入 0\/0；预测 12\/0/);
      assert.match(await at(5000),/买入 0\/0；预测 0\/0/);assert.match(await at(-1),/买入 31\/0；预测 12\/0/);
      await evaluate(`const changed=JSON.parse(localStorage.getItem(ledgerKey));changed.userId=7;changed.entries[0].proceeds+=10;
        changed.entries.at(-1).debit=19;localStorage.setItem(ledgerKey,JSON.stringify(changed));`);
      await drive(`${status}.includes('预测 19/0')&&${panel}.getElementById('stock-performance').textContent.includes('已知已实现盈亏 1010')&&
        !${panel}.getElementById('stock-period-start').disabled`,'same-length external ledger change');
    });

    await t.test('页面性能：避难所面板复用静态控件、阶段报告和建设预算，不延误到期与外部更新',async()=>{
      await setupExp(`addRuns(6);window.stateKey='arkengine:auto-shelter:schedule:v1';window.configKey='arkengine:auto-shelter:construction:v1';
        window.edge=clock+180000;window.stamp=clock-3600000;
        const snap={at:stamp,level:4,score:500,committed:0,resources:{scrap:50,parts:1,power:2,food:3,water:4},netScrap:10,partsRate:1,next:'',reason:'',route:null};
        const ledger=Array.from({length:500},(_,index)=>({at:edge-86400000,id:'paid'+index,scrap:2,parts:1}));
        localStorage.setItem(stateKey,JSON.stringify({note:'建设性能测试',nextAt:clock+3600000,constructionLedger:ledger,
          developmentTrace:{version:1,vaultNo:77,history:[],active:{target:5,finalTarget:10,start:snap,latest:snap}}}));
        window.setBudget=mode=>localStorage.setItem(configKey,JSON.stringify({build:false,upgrade:false,dig:false,budgetMode:mode,scrapLimit:9000,partsLimit:700,scrapReserve:90,partsReserve:2}));setBudget('daily');
        const parse=JSON.parse;JSON.parse=function(...args){const value=parse.apply(this,args);
          if(value?.note==='建设性能测试')for(const entry of value.constructionLedger)for(const key of ['at','id']){
            const saved=entry[key];Object.defineProperty(entry,key,{get(){if(window.shelterProbe)shelterProbe.reads++;return saved;},enumerable:true});}
          return value;};`);
      await pulse();await pulse();
      const root=`document.getElementById('ark-auto-expedition').shadowRoot`,budget=`${root}.getElementById('shelter-construction-status').textContent`,
        trace=`${root}.getElementById('shelter-development-trace').textContent`;
      assert.match(await evaluate(budget),/1000\/9000 废料、500\/700/);assert.match(await evaluate(trace),/目前 500 分/);
      const measure=()=>evaluate(`(async()=>{const root=${root},lookup=root.getElementById,format=Date.prototype.toLocaleString,probe=document.createTextNode('');document.body.append(probe);
        const counts=window.shelterProbe={reads:0,formats:0,lookups:0};window.panelProbe={ticks:0,totals:0,spend:0};
        root.getElementById=function(id){if(id.startsWith('shelter-'))counts.lookups++;return lookup.call(this,id);};
        Date.prototype.toLocaleString=function(...args){if(+this===stamp)counts.formats++;return format.apply(this,args);};
        try{for(let index=0;index<24;index++){probe.data=String(index);await Promise.resolve();await Promise.resolve();}return {...counts,ticks:panelProbe.ticks};}
        finally{delete root.getElementById;Date.prototype.toLocaleString=format;delete window.shelterProbe;delete window.panelProbe;probe.remove();}})()`);
      const daily=await measure();
      const at=offset=>evaluate(`(async()=>{clock=edge+(${offset});document.body.append(document.createTextNode(''));await Promise.resolve();await Promise.resolve();return ${budget};})()`);
      assert.match(await at(-1),/1000\/9000/);assert.match(await at(0),/0\/9000 废料、0\/700/);assert.match(await at(-1),/1000\/9000/);
      await evaluate(`setBudget('stock');const record=JSON.parse(localStorage.getItem(stateKey));record.developmentTrace.active.latest.score=510;localStorage.setItem(stateKey,JSON.stringify(record));`);
      await drive(`${budget}.includes('按实际库存，未决预留 0 废料')&&${trace}.includes('目前 510 分')`,'refresh shelter budget and trace');
      const stock=await measure();console.log('idle shelter panel '+JSON.stringify({daily,stock}));
      for(const result of [daily,stock]){assert.ok(result.ticks>=20);assert.deepEqual([result.reads,result.formats,result.lookups],[0,0,0]);}
      await evaluate(`{const record=JSON.parse(localStorage.getItem(stateKey));record.developmentTrace={version:-1};
        record.caravan={pending:{id:'cart',day:'fixture',vaultNo:77,slot:0,at:clock,cost:{scrap:36,parts:3}}};localStorage.setItem(stateKey,JSON.stringify(record));}`);
      await drive(`${trace}.includes('阶段记录无法核对')&&${budget}.includes('未决预留 36 废料 / 3 零件')`,'refresh corrupt report and new reservation');
      await evaluate(`{const record=JSON.parse(localStorage.getItem(stateKey));delete record.developmentTrace;
        record.constructionLedger[0]={id:'cart',at:clock,scrap:36,parts:3};localStorage.setItem(stateKey,JSON.stringify(record));}`);
      await drive(`${trace}===''&&${budget}.includes('未决预留 0 废料 / 0 零件')`,'clear absent report and release already booked reservation');
    });

    await t.test('共享暂停延迟：远征确认前重读总开关，不发送派遣且保留已打开的原计划',async()=>{
      await setupExp();
      await drive(`Boolean(document.querySelector('#confirm-dispatch'))`,'own expedition confirmation open');
      await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('随机等待')&&
        document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('确认')`,'expedition confirmation queued');
      const original=await evaluate(`sessionStorage.getItem('arkengine:auto-expedition:pending:v1')`);
      assert.ok(original);
      await evaluate(`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);
      await pulse(10000);
      assert.deepEqual(await evaluate('model.calls'),[]);
      assert.equal(await expStatus(),'已暂停');
      assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-expedition:pending:v1')`),original);
      assert.ok(await evaluate(`document.querySelector('#confirm-dispatch')`));
      await evaluate(`window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-expedition:enabled:v1',newValue:'true'}));`);
      await pulse(10000);
      assert.deepEqual(await evaluate('model.calls'),[],'迟到的旧开启通知不能越过已保存的暂停');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
    });

    await t.test('面板分组：各模块与避难所子项独立折叠，刷新记忆且不改业务开关', async () => {
      await setupExp(`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);
      const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
      const section=name=>`${panel}.querySelector('[data-panel-section="${name}"]')`;
      const preference=name=>`localStorage.getItem('arkengine:auto-panel:expedition:section:${name}:collapsed:v1')`;
      assert.deepEqual(await evaluate(`[...${panel}.querySelectorAll('.panel-section')].map(d=>[d.dataset.panelSection,d.open])`),
        [['cultivate',false],['expedition',false],['farm',false],['shelter',false],['stock',false]]);
      assert.equal(await evaluate(`${panel}.getElementById('script-version').textContent`),`v${scriptVersion}`);
      for(const name of ['farm','shelter','shelter-staff','stock']) {
        await evaluate(`${section(name)}.querySelector('summary').click();`);
        await until(()=>evaluate(`${preference(name)}==='false'`),'expanded section saved');
      }
      await evaluate(`${section('shelter')}.querySelector('summary').click();`);
      await until(()=>evaluate(`${preference('shelter')}==='true'`),'shelter collapsed saved');
      assert.equal(await evaluate(`${section('farm')}.open && ${section('stock')}.open && ${section('shelter-staff')}.open`),true);
      await evaluate(`${panel}.getElementById('panel-fold').click();${panel}.getElementById('panel-fold').click();`);
      assert.equal(await evaluate(`${section('shelter')}.open`),false,'整面板展开不改变模块状态');
      await cdp.send('Page.reload',{},tab.sessionId);
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'panel reloaded');
      await evaluate(source);
      assert.deepEqual(await evaluate(`[...${panel}.querySelectorAll('.panel-section')].map(d=>d.open)`),[false,false,true,false,true]);
      assert.equal(await evaluate(`${section('shelter-staff')}.open`),true,'父项折叠仍保留子项偏好');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-shelter:enabled:v1')`),null);
      assert.equal(await evaluate(`${panel}.getElementById('stock-trade').checked`),false);
      assert.equal(await evaluate(`${panel}.getElementById('stock-predict').checked`),false);
      assert.equal(await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.querySelector('[data-panel-section="cultivate"]').open`),false);
    });
    await t.test('面板分组：模块和整面板折叠期间修仙与远征继续运行，版本始终可见', async () => {
      const cult=`document.getElementById('ark-auto-expedition').shadowRoot`;
      const exp=`document.getElementById('ark-auto-expedition').shadowRoot`;
      await setup(`choices(['修为 +1','修为 +2','钻石 +3']);`);
      assert.equal(await evaluate(`${cult}.querySelector('[data-panel-section="cultivate"]').open`),false);
      await expectClick(2);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-encounter:enabled:v1')`),'false');
      await evaluate(`${cult}.getElementById('panel-fold').click();`);
      assert.equal(await evaluate(`${cult}.getElementById('script-version').checkVisibility()`),true);
      await cdp.send('Page.reload',{},tab.sessionId);
      await until(()=>evaluate(`typeof base==='function'&&!document.getElementById('ark-auto-expedition')`),'cultivate panel reloaded');
      await evaluate(source);
      assert.equal(await evaluate(`${cult}.getElementById('panel-content').hidden`),true);
      await evaluate(`${cult}.getElementById('panel-fold').click();`);
      assert.equal(await evaluate(`${cult}.querySelector('[data-panel-section="cultivate"]').open`),false);
      await setupExp(`localStorage.setItem('arkengine:auto-panel:cultivate:collapsed:v1','true');`);
      assert.equal(await evaluate(`${exp}.getElementById('panel-content').hidden`),false,'旧修仙折叠偏好不影响统一面板');
      await evaluate(`${exp}.getElementById('panel-fold').click();`);
      await drive(`${confirmed}.length===1`,'dispatch while all panel content is folded');
      assert.equal(await evaluate(`${exp}.getElementById('script-version').checkVisibility()`),true);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
    });
    await t.test('面板分组：键盘可展开与收起，偏好读写失败仍可操作且不阻断主开关', async () => {
      await setupExp(`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');
        const originalGet=Storage.prototype.getItem,originalSet=Storage.prototype.setItem;
        Storage.prototype.getItem=function(k){if(k.startsWith('arkengine:auto-panel:'))throw Error('fixture preferences unavailable');return originalGet.call(this,k);};
        Storage.prototype.setItem=function(k,v){if(k.startsWith('arkengine:auto-panel:'))throw Error('fixture preferences unavailable');return originalSet.call(this,k,v);};`);
      const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
      const farm=`${panel}.querySelector('[data-panel-section="farm"]')`;
      await cdp.send('Page.bringToFront',{},tab.sessionId);
      await evaluate(`${panel}.querySelector('[data-panel-section="settings"]>summary').click();`);
      await evaluate(`${farm}.querySelector('summary').focus();`);
      assert.equal(await evaluate(`${panel}.activeElement===${farm}.querySelector('summary')`),true);
      for(const [key,code,keyCode] of [['Enter','Enter',13],[' ','Space',32]]) {
        const before=await evaluate(`${farm}.open`);
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,text:keyCode===13?'\r':' ',unmodifiedText:keyCode===13?'\r':' ',windowsVirtualKeyCode:keyCode},tab.sessionId);
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode},tab.sessionId);
        await until(()=>evaluate(`${farm}.open===${!before}`),`keyboard ${code} toggles section`);
        await until(()=>evaluate(`${farm}.querySelector('summary').title.includes('仅在当前页面生效')`),'storage failure remains usable');
      }
      await evaluate(`${panel}.getElementById('panel-fold').click();`);
      assert.equal(await evaluate(`${panel}.getElementById('panel-content').hidden`),true);
      await evaluate(`${panel}.getElementById('panel-fold').click();${panel}.getElementById('toggle').click();`);
      await drive(`${confirmed}.length===1`,'start still works without panel preference storage');
    });

    const farmState = `JSON.parse(localStorage.getItem('arkengine:auto-farm:schedule:v1'))`;
    const farmCalls = type => `fm.calls.filter(c=>c.type==='${type}')`;
    const setupFarm = async (code = '', path = '/activities/expedition') => {
      await cdp.send('Page.navigate', { url:`${origin}${path}?farm-fixture=${++pageSerial}` },tab.sessionId);
      await until(()=>evaluate(`location.search==='?farm-fixture=${pageSerial}' && typeof renderFarm==='function'`),'farm fixture');
      await resetLogs();
      await evaluate(`localStorage.clear();sessionStorage.clear();${configuredDefaults}Math.random=()=>0;model.burst=0;${code};
        if(location.pathname==='/farm')renderFarm();else renderExp();`);
      await evaluate(source);
    };
    const setupShelter = async (code = '', path = '/shelter') => {
      await cdp.send('Page.navigate', { url:`${origin}${path}?shelter-fixture=${++pageSerial}` },tab.sessionId);
      await until(()=>evaluate(`location.search==='?shelter-fixture=${pageSerial}' && typeof renderShelter==='function'`),'shelter fixture');
      await resetLogs();
      await evaluate(`localStorage.clear();sessionStorage.clear();${configuredDefaults}Math.random=()=>0;model.burst=0;addRuns(6);
        localStorage.setItem('arkengine:auto-farm:enabled:v1','false');localStorage.setItem('arkengine:auto-shelter:enabled:v1','true');
        // Existing scenarios model the previously saved target. New-default tests explicitly remove this key.
        localStorage.setItem('arkengine:auto-shelter:population:v1','14');
        sm.ui20261109=${process.env.ARKENGINE_TEST_UI==='20261109'};
        ${code};if(location.pathname==='/shelter')renderShelter();else renderExp();`);
      await evaluate(source);
    };
    const restoreReloadedShelter = async state => {
      await until(()=>evaluate(`typeof renderShelter==='function' && !document.getElementById('ark-auto-expedition')`),'reloaded shelter');
      await evaluate(`Object.assign(window,${JSON.stringify(state)});clock+=120000;sm.busy=false;Math.random=()=>0;
        if(sm.failRecoveryArchive){const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){
          if(k==='arkengine:auto-shelter:schedule:v1'&&JSON.parse(v)?.assignmentRecovery)throw Error('fixture archive write failure');return set.call(this,k,v);};}
        renderShelter();`);
      await evaluate(source);
    };
    const reloadShelter = async () => {
      const state = await evaluate('({sm,clock})');
      await cdp.send('Page.reload', {},tab.sessionId);
      await restoreReloadedShelter(state);
    };
    const secondShelter=async(code='')=>{
      const state=await evaluate('({sm,clock,model,fm})'),second=await createTab();
      await cdp.send('Page.navigate',{url:`${origin}/shelter?shelter-fixture=second`},second.sessionId);
      const read=code=>cdp.evaluate(second.sessionId,code);
      await until(()=>read(`typeof renderShelter==='function'`),'second shelter fixture');
      await read(`Object.assign(window,${JSON.stringify(state)});sm.calls=[];sm.busy=false;Math.random=()=>0;${code};renderShelter();`);await read(source);
      return {evaluate:read,pulse:async(ms=1000)=>{await read(`clock+=${ms};window.dispatchEvent(new Event('focus'));`);await delay(180);},
        withFrozenOriginal:withFrozenOriginal(second.targetId),close:()=>cdp.send('Target.closeTarget',{targetId:second.targetId})};
    };
    await shelterTests({ t, setupShelter, reloadShelter, restoreReloadedShelter, evaluate, pulse, drive, until, expStatus, secondShelter,
      withDelayedShelterNavigation:run=>withDelayedFeatureNavigation('/shelter',run) });
    const trustedStaffKey = async (key='Tab',modifiers=0) => {
      const codes={Shift:['ShiftLeft',16],Control:['ControlLeft',17],Alt:['AltLeft',18],Meta:['MetaLeft',91],
        Escape:['Escape',27],Tab:['Tab',9],Enter:['Enter',13],PrintScreen:['PrintScreen',44],s:['KeyS',83]};
      const [code,windowsVirtualKeyCode]=codes[key]||[key,0];
      for (const type of ['keyDown','keyUp']) await cdp.send('Input.dispatchKeyEvent',
        {type,key,code,windowsVirtualKeyCode,modifiers,...(key==='Enter'&&type==='keyDown'?{text:'\r'}:{})},tab.sessionId);
    };
    await shelterExplorationTests({ t, setupShelter, reloadShelter, evaluate, pulse, drive, until, expStatus, trustedStaffKey });
    await shelterConstructionTests({t,setupShelter,reloadShelter,evaluate,drive,pulse,trustedStaffKey});
    const withShelterBackground=async run=>{
      const foreground=await createTab();
      try{
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        await until(()=>evaluate(`document.visibilityState==='hidden'`),'shelter tab hidden');
        await run();
      }finally{
        await cdp.send('Target.closeTarget',{targetId:foreground.targetId});
        await cdp.send('Target.activateTarget',{targetId:tab.targetId});
        await until(()=>evaluate(`document.visibilityState==='visible'`),'shelter tab visible');
      }
    };
    await shelterCampaignTests({t,setupShelter,reloadShelter,evaluate,drive,pulse,until,trustedStaffKey,withShelterBackground});
    await currentGrowthTests({t,setupShelter,reloadShelter,evaluate,drive,pulse});
    await shelterStaffTests({ t, setupShelter, reloadShelter, evaluate, pulse, drive, until, expStatus, trustedStaffKey });
    await shelterRevivalTests({t,setupShelter,reloadShelter,evaluate,pulse,drive,trustedStaffKey});
    await shelterFutureEmploymentTests({t,setupShelter,reloadShelter,evaluate,pulse,drive});
    await shelterParentTraining72Tests({t,setupShelter,reloadShelter,evaluate,pulse,drive});
    await shelterParentPreparationTests({t,setupShelter,reloadShelter,evaluate,pulse,drive});
    await shelterLog127Tests({t,setupShelter,reloadShelter,evaluate,pulse,drive});
    await shelterPlanningBrowserTests({t,setupShelter,reloadShelter,evaluate,pulse,drive,until,trustedStaffKey});
    await shelterConfirmationTests({t,setupShelter,reloadShelter,evaluate,pulse,drive,trustedStaffKey,secondShelter});
    await shelterProductionTests({ t, setupShelter, reloadShelter, evaluate, pulse, drive });
    await shelterPopulationTests({ t, setupShelter, reloadShelter, evaluate, pulse, drive, trustedStaffKey, secondShelter, until });
    const setupStock=async(code='',path='/stock')=>{
      await cdp.send('Page.navigate',{url:`${origin}${path}?stock-fixture=${++pageSerial}`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?stock-fixture=${pageSerial}' && typeof renderStock==='function'`),'stock fixture');
      await resetLogs();
      await evaluate(`localStorage.clear();sessionStorage.clear();${configuredDefaults}Math.random=()=>0;model.burst=0;addRuns(6);
        localStorage.setItem('arkengine:auto-farm:enabled:v1','false');${code};if(location.pathname==='/stock')renderStock();else renderExp();`);
      await evaluate(source);
    };
    const reloadStock=async(code='')=>{
      // Let the SPA route observation finish before simulating a later user reload.
      await pulse(1000);
      const state=await evaluate('({km,clock,model,fm})');
      await cdp.send('Page.navigate',{url:`${origin}/stock?stock-fixture=${++pageSerial}`},tab.sessionId);
      await until(()=>evaluate(`typeof renderStock==='function' && !document.getElementById('ark-auto-expedition') && location.search==='?stock-fixture=${pageSerial}'`),'reloaded stock');
      await evaluate(`Object.assign(window,${JSON.stringify(state)});km.busy=false;Math.random=()=>0;${code};renderStock();`);
      await evaluate(source);
    };
    const secondStock=async(code='')=>{
      const state=await evaluate('({km,clock,model,fm})'),second=await createTab();
      await cdp.send('Page.navigate',{url:`${origin}/stock?stock-fixture=second`},second.sessionId);
      const read=code=>cdp.evaluate(second.sessionId,code);
      await until(()=>read(`typeof renderStock==='function'`),'second stock fixture');
      await read(`Object.assign(window,${JSON.stringify(state)});km.calls=[];km.busy=false;Math.random=()=>0;${code};renderStock();`);await read(source);
      return {evaluate:read,pulse:async(ms=1000)=>{await read(`clock+=${ms};window.dispatchEvent(new Event('focus'));`);await delay(180);},
        withFrozenOriginal:withFrozenOriginal(second.targetId),
        close:()=>cdp.send('Target.closeTarget',{targetId:second.targetId})};
    };
    async function withDelayedFeatureNavigation(path,run){
      delayedFeaturePath=path;featureNavigationResponses=[];
      try{
        // The Web Lock arrives asynchronously. Do not advance the frozen clock before an action is queued.
        const label=path==='/stock'?'秒后检查股市':'秒后切换避难所';
        await until(()=>evaluate(`document.getElementById('ark-auto-expedition')?.shadowRoot.getElementById('status').textContent.includes(${JSON.stringify(label)})`),'feature navigation queued');
        await run(()=>featureNavigationResponses.length,()=>cdp.send('Page.stopLoading',{},tab.sessionId));
      }
      catch(error){
        await cdp.send('Page.stopLoading',{},tab.sessionId);
        const state=await evaluate(`({path:location.pathname,clock,enabled:localStorage.getItem('arkengine:auto-expedition:enabled:v1'),
          status:document.getElementById('ark-auto-expedition')?.shadowRoot.getElementById('status').textContent,
          navigation:sessionStorage.getItem('arkengine:auto-expedition:navigation:v1')})`);
        error.message+=` / fixture navigation ${JSON.stringify(state)}`;throw error;
      }finally{
        delayedFeaturePath=null;
        for(const response of featureNavigationResponses){response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(path==='/stock'?stockMarkup:shelterMarkup);}
        featureNavigationResponses=[];
      }
    }
    const withDelayedStockNavigation=run=>withDelayedFeatureNavigation('/stock',run);
    await stockTests({t,setupStock,reloadStock,evaluate,pulse,drive,until,secondStock,trustedStaffKey,withDelayedStockNavigation});
    await enabledDefaultsTests({t,setupShelter,reloadShelter,setupStock,reloadStock,evaluate,pulse,drive,secondStock});
    await settingsTests({t,setupShelter,reloadShelter,setupStock,reloadStock,evaluate,pulse,drive,until,
      viewport:params=>cdp.send('Emulation.setDeviceMetricsOverride',params,tab.sessionId),
      pressEnter:async()=>{await cdp.send('Page.bringToFront',{},tab.sessionId);
        await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13},tab.sessionId);
        await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13},tab.sessionId);},
      screenshot:()=>cdp.send('Page.captureScreenshot',{format:'png'},tab.sessionId)});
    const setupFeatures=async(code='',path='/activities/expedition')=>{
      await cdp.send('Page.navigate',{url:`${origin}${path}?cross-feature-fixture=${++pageSerial}`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?cross-feature-fixture=${pageSerial}'&&typeof renderFeature==='function'`),'cross-feature fixture');
      await resetLogs();
      await evaluate(`localStorage.clear();sessionStorage.clear();${configuredDefaults}Math.random=()=>0;model.burst=0;addRuns(6);
        localStorage.setItem('arkengine:auto-farm:enabled:v1','false');localStorage.setItem('arkengine:auto-shelter:enabled:v1','true');
        localStorage.setItem('arkengine:auto-stock:config:v1',JSON.stringify({trade:true,predict:false,tradeLimit:3000,predictionLimit:500,stake:100,reserve:100}));
        ${stockOwnedPosition}sm.tutorial=false;sm.dailyIncomplete=true;sm.achievementIncomplete=true;${code};renderFeature();`);
      await evaluate(source);
    };
    const reloadFeatures=async()=>{
      await pulse(1000);const state=await evaluate('({sm,km,fm,model,clock})');
      await cdp.send('Page.navigate',{url:`${origin}/activities/expedition?cross-feature-fixture=${++pageSerial}`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?cross-feature-fixture=${pageSerial}'&&typeof renderFeature==='function'&&!document.getElementById('ark-auto-expedition')`),'reloaded cross-feature fixture');
      await evaluate(`Object.assign(window,${JSON.stringify(state)});sm.busy=false;km.busy=false;Math.random=()=>0;renderFeature();`);
      await evaluate(source);
    };
    await crossFeatureTests({t,setupFeatures,reloadFeatures,evaluate,pulse,drive,until,withDelayedStockNavigation});
    await readLifecycleTests({t,setupShelter,setupFarm,setupFeatures,reloadFeatures,evaluate,pulse,drive,until});
    await t.test('启动恢复：正文迟到且页面一直加载时仍启动农场，保留人工暂停', async () => {
      // 此项在文档头部注入，不能像普通 setup 那样注入前清库；先卸载上一页并隔离其日志。
      await cdp.send('Page.navigate', { url:`${origin}/?test=${++pageSerial}` },tab.sessionId);
      await until(()=>evaluate(`location.search==='?test=${pageSerial}' && typeof base==='function' && !window.__arkTestLogs`),'clean startup fixture');
      await resetLogs();
      await cdp.send('Page.enable', {}, tab.sessionId);
      const hook = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
        window.startupErrors=[];window.addEventListener('error',e=>startupErrors.push(e.message));
        window.clock=Date.parse('2026-10-10T12:00:00+08:00');Date.now=()=>clock;
        localStorage.clear();sessionStorage.clear();
        localStorage.setItem('arkengine:auto-encounter:enabled:v1','false');
        localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');
        ${source}` }, tab.sessionId);
      try {
        await cdp.send('Page.navigate', { url: `${origin}/farm?startup-fixture=${++pageSerial}` }, tab.sessionId);
        await until(()=>evaluate('window.startupHead===true'),'streaming document head');
        assert.equal(await evaluate('document.body'),null);
        startupResponse.write(farmMarkup);
        await until(()=>evaluate(`typeof renderFarm==='function'&&!!document.getElementById('ark-auto-expedition')`),'panel before document finishes')
          .catch(async error=>{throw new Error(error.message+' '+JSON.stringify(await evaluate(`({errors:window.startupErrors,
            body:!!document.body,fixture:typeof renderFarm,encounter:!!document.getElementById('ark-auto-expedition'),ready:document.readyState})`)));});
        assert.equal(await evaluate('document.readyState'),'loading');
        assert.deepEqual(await evaluate('fm.calls'),[],'提前启动不能解除人工暂停');
        await evaluate(`Math.random=()=>0;addRuns(6);document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();`);
        await drive(`${farmCalls('plant')}.length===1`,'farm works while document remains loading');
        assert.equal(await evaluate('document.readyState'),'loading');
        assert.deepEqual(await evaluate('startupErrors'),[]);
        await evaluate(source);
        assert.equal(await evaluate(`document.querySelectorAll('#ark-auto-expedition').length`),1,'重复注入不重复挂载');
        const startup=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='page-lifecycle'&&e.data.event==='load').data.startup`);
        assert.equal(startup.injectedReadyState,'loading');
        assert.ok(startup.bodyWaitMs>=0);
        assert.match(rawSource,/\/\/ @run-at\s+document-start/);
        startupResponse.end(); startupResponse=null;
        await until(()=>evaluate(`document.readyState==='complete'`),'streaming document finally complete');
        const lifecycle=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='page-lifecycle')`);
        assert.ok(lifecycle.some(e=>e.data.event==='DOMContentLoaded'));
        const loaded=lifecycle.filter(e=>e.data.event==='document-load');
        assert.equal(loaded.length,1,'文档完成事件不混入资源加载事件');
        assert.equal(loaded[0].data.readyState,'complete');
        assert.equal(loaded[0].data.online,true);
        assert.ok(loaded[0].data.navigation.responseStart>=0);
        assert.ok(loaded[0].data.navigation.domContentLoadedEventStart>0);
      } finally {
        startupResponse?.end(); startupResponse = null;
        await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hook.identifier }, tab.sessionId);
        await cdp.send('Page.disable', {}, tab.sessionId);
      }
    });
    await t.test('农场：先派巡逻，同页种满12块，留种后最优选蓝莓并返回远征', async () => {
      await setupFarm();
      await drive(`fm.crops.length===12 && location.pathname==='/activities/expedition'`, 'farm first round');
      assert.equal(await evaluate('model.runs.length'),6);
      assert.deepEqual(await evaluate(`${farmCalls('plant')}.map(c=>[c.name,c.count])`),[['蓝莓',12]]);
      assert.equal(await evaluate('fm.stamina'),88);
      assert.equal(await evaluate('fm.reads'),1);
      assert.match(await evaluate(`${farmState}.selection`),/蓝莓.*508\.4/);
      assert.equal(await evaluate(`${farmState}.nextAt`),await evaluate('fm.crops[0].at+2000'));
      assert.equal(await evaluate(`fm.calls.some(c=>['pin','upgrade'].includes(c.type))`),false);
      const travel=await evaluate(`${farmCalls('navigate')}.length`);
      await pulse(30*60000);
      assert.equal(await evaluate(`${farmCalls('navigate')}.length`),travel,'成熟之前不反复切农场');
      await evaluate('model.runs.forEach(r=>r.done=true);renderExp();');
      await drive(`${confirmed}.length===2 && model.runs.length===6`,'patrol continues while crops grow');
      assert.equal(await evaluate(`${farmCalls('navigate')}.length`),travel);
    });
    await t.test('农场：下一轮最新行情改变最优作物，不固定蓝莓且不使用旧售价', async () => {
      await setupFarm('addRuns(6);');
      await drive(`fm.crops.length===12 && location.pathname==='/activities/expedition'`,'blueberry planted');
      await evaluate(`clock=${farmState}.nextAt;fm.stamina=100;fm.prices[6]=40;fm.prices[7]=10;renderExp();`);
      await drive(`${farmCalls('plant')}.length===2 && location.pathname==='/activities/expedition'`,'new price round');
      assert.deepEqual(await evaluate(`${farmCalls('plant')}.map(c=>c.name)`),['蓝莓','南瓜']);
      assert.equal(await evaluate(`${farmCalls('harvest')}[0].count`),12);
      assert.equal(await evaluate('fm.stamina'),76);
      assert.equal(await evaluate('fm.reads'),2);
    });
    await t.test('农场：读取精确售价并考虑体力瓶颈，不能按最快成熟或基准价选', async () => {
      await setupFarm(`addRuns(6);fm.prices[6]=22.795;fm.prices[7]=16.631;`);
      await drive(`${farmCalls('plant')}.length===1`,'precision crop choice');
      // 四舍五入到图鉴一位小数时会误选南瓜；精确比较应选蓝莓。
      assert.equal(await evaluate(`${farmCalls('plant')}[0].name`),'蓝莓');
      await setupFarm(`addRuns(6);fm.prices[4]=20;`);
      await drive(`${farmCalls('plant')}.length===1`,'corn under changed price');
      assert.equal(await evaluate(`${farmCalls('plant')}[0].name`),'玉米');
    });
    await t.test('农场：手动选作物持久化，种满模式与收获时间筛选会正确调整', async () => {
      await setupFarm(`addRuns(6);fm.filter='1';fm.view='compact';localStorage.setItem('arkengine:auto-farm:crop:v1','星辉果');`);
      await drive(`${farmCalls('plant')}.length===1 && location.pathname==='/activities/expedition'`,'manual star fruit');
      assert.deepEqual(await evaluate(`${farmCalls('plant')}.map(c=>[c.name,c.count])`),[['星辉果',12]]);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-farm:crop:v1')`),'星辉果');
      assert.equal(await evaluate('fm.filter'),'0');
      assert.equal(await evaluate('fm.all'),true);
    });
    const additionalFarmCrops = `
      fc.push(...[
        {id:31,key:'new-crop-a',name:'测试新作物甲',minutes:60,yieldQuantity:10,price:1},
        {id:32,key:'new-crop-b',name:'测试新作物乙',minutes:120,yieldQuantity:12,price:50},
        {id:33,key:'new-crop-c',name:'测试新作物丙',minutes:180,yieldQuantity:14,price:100}
      ]);
      fc.forEach(c=>{fm.inventory[c.key]=100;fm.prices[c.id]=c.price;});`;
    const farmCropSelect = `document.getElementById('ark-auto-expedition').shadowRoot.getElementById('farm-crop')`;
    await t.test('农场新增作物：动态目录进入下拉框并参与每轮最新收益比较', async () => {
      await setupFarm(`addRuns(6);${additionalFarmCrops}`);
      await drive(`fm.crops.length===12&&location.pathname==='/activities/expedition'`,'new crops ranked with existing crops');
      assert.deepEqual(await evaluate(`${farmCalls('plant')}.map(c=>[c.name,c.count])`),[['测试新作物丙',12]]);
      assert.deepEqual(await evaluate(`[...${farmCropSelect}.options].slice(1).map(option=>option.value)`),await evaluate('fc.map(c=>c.name)'));
      assert.match(await evaluate(`${farmState}.selection`),/测试新作物丙.*5760\.0/);
      assert.equal(await evaluate('fm.reads'),1);
      await evaluate(`clock=${farmState}.nextAt;fm.stamina=100;fm.prices[32]=200;renderExp();`);
      await drive(`${farmCalls('plant')}.length===2&&location.pathname==='/activities/expedition'`,'latest prices change new crop winner');
      assert.deepEqual(await evaluate(`${farmCalls('plant')}.map(c=>c.name)`),['测试新作物丙','测试新作物乙']);
      assert.equal(await evaluate('fm.reads'),2);
    });
    await t.test('农场新增作物：首次读取前保留指定作物，刷新后目录和选择仍可用', async () => {
      await setupFarm(`addRuns(6);${additionalFarmCrops}localStorage.setItem('arkengine:auto-farm:crop:v1','测试新作物甲');`);
      assert.equal(await evaluate(`${farmCropSelect}.value`),'测试新作物甲');
      await drive(`${farmCalls('plant')}.length===1&&location.pathname==='/activities/expedition'`,'saved new crop stays manual');
      assert.equal(await evaluate(`${farmCalls('plant')}[0].name`),'测试新作物甲');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-farm:crop:v1')`),'测试新作物甲');
      const snapshot=await evaluate('({fm,model,clock,fc})');
      await cdp.send('Page.navigate',{url:`${origin}/activities/expedition?farm-fixture=${++pageSerial}`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?farm-fixture=${pageSerial}'&&typeof renderFarm==='function'`),'reload dynamic crop catalog');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderExp();`);
      await evaluate(source);
      assert.equal(await evaluate(`${farmCropSelect}.value`),'测试新作物甲');
      assert.deepEqual(await evaluate(`[...${farmCropSelect}.options].slice(1).map(option=>option.value)`),snapshot.fc.map(c=>c.name));
      await evaluate(`${farmCropSelect}.value='测试新作物乙';${farmCropSelect}.dispatchEvent(new Event('change',{bubbles:true}));`);
      await drive(`location.pathname==='/activities/expedition'&&${farmState}.nextAt===fm.crops[0].at+2000`,'changed selection keeps current growth schedule');
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),1,'更改作物不铲除现有作物');
      await evaluate(`clock=Math.max(...fm.crops.map(c=>c.at))+2000;fm.stamina=100;renderExp();`);
      await drive(`${farmCalls('plant')}.length===2`,'new dropdown selection applies next planting');
      assert.equal(await evaluate(`${farmCalls('plant')}[1].name`),'测试新作物乙');
    });
    await t.test('农场新增作物：库存不足、未解锁和禁用按钮仍不能种植', async () => {
      for(const restriction of [
        `fm.inventory['new-crop-c']=11;`,
        `const baseData=window.farmData;window.farmData=()=>{const data=baseData();data.seeds.find(seed=>seed.id===33).minSoilLevel=11;return data;};`,
        `const open=window.openSeeds;window.openSeeds=()=>{open();const dialog=document.querySelector('[role="dialog"]');
          const disable=()=>{for(const button of dialog.querySelectorAll('#seed-buttons button'))if(button.textContent.includes('测试新作物丙'))button.disabled=true;};
          dialog.addEventListener('click',disable);disable();};`
      ]) {
        await setupFarm(`addRuns(6);${additionalFarmCrops}${restriction}`);
        await drive(`${farmCalls('plant')}.length===1`,'new crop eligibility preserved');
        assert.equal(await evaluate(`${farmCalls('plant')}[0].name`),'测试新作物乙');
      }
    });
    await t.test('农场新增作物：指定目录外或缺货作物时等待，不切回自动种其他作物', async () => {
      for(const crop of ['测试已移除作物','测试新作物丙']) {
        await setupFarm(`addRuns(6);${additionalFarmCrops}fm.inventory['new-crop-c']=0;localStorage.setItem('arkengine:auto-farm:crop:v1',${JSON.stringify(crop)});`);
        await drive(`localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'`,'unavailable manual crop stops planting');
        assert.equal(await evaluate(`${farmCropSelect}.value`),crop);
        assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
        assert.match(await evaluate(`${farmState}.note`),/未解锁或免费存货不足/);
      }
    });
    await t.test('农场新增作物：缺少售价、同名种子或按钮目录不一致时不猜测种植', async () => {
      for(const change of [
        `data.prices=data.prices.filter(price=>price.seedId!==33);`,
        `data.seeds.push({...data.seeds.find(seed=>seed.id===33),id:34,key:'duplicate-crop'});`,
        `data.seeds=data.seeds.filter(seed=>seed.id!==33);`
      ]) {
        await setupFarm(`addRuns(6);${additionalFarmCrops}const baseData=window.farmData;window.farmData=()=>{const data=baseData();${change}return data;};`);
        await drive(`localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'`,'inconsistent new crop stops planting');
        assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
        assert.match(await evaluate(`${farmState}.note`),/无法读取|无法核对/);
      }
    });
    await t.test('农场新增作物：目录更新与跨标签页指定选择同步，名称只作为文本显示', async () => {
      await setupFarm(`addRuns(6);${additionalFarmCrops}
        fc.push({id:34,key:'text-crop',name:'<b>测试作物</b>',minutes:60,yieldQuantity:6,price:1});
        fm.inventory['text-crop']=0;fm.prices[34]=1;`);
      await drive(`${farmCalls('plant')}.length===1&&location.pathname==='/activities/expedition'`,'catalog includes plain text names');
      assert.equal(await evaluate(`${farmCropSelect}.querySelector('b')`),null);
      assert.ok(await evaluate(`[...${farmCropSelect}.options].some(option=>option.textContent==='<b>测试作物</b>')`));
      await evaluate(`localStorage.setItem('arkengine:auto-farm:crop:v1','测试跨页新作物');
        window.dispatchEvent(new StorageEvent('storage',{key:'arkengine:auto-farm:crop:v1',newValue:'测试跨页新作物'}));`);
      assert.equal(await evaluate(`${farmCropSelect}.value`),'测试跨页新作物');
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),1);
    });

    await t.test('农场：体力不足时预约恢复再返回远征，不发出失败的批量种植', async () => {
      await setupFarm('addRuns(6);fm.stamina=5;fm.nextRegen=120;', '/farm');
      await drive(`location.pathname==='/activities/expedition'`,'wait stamina');
      const state=await evaluate(farmState);
      assert.match(state.note,/12 点再种植/);
      assert.deepEqual(await evaluate(farmCalls('plant')),[]);
      assert.equal(await evaluate('fm.reads'),1,'体力不足时先核对最新状态，再预约');
      await evaluate(`clock=${state.nextAt};fm.stamina=12;renderExp();`);
      await drive(`fm.crops.length===12 && location.pathname==='/activities/expedition'`,'plant after stamina regeneration');
      assert.equal(await evaluate('fm.stamina'),0);
    });
    const oldStaminaWait = `localStorage.setItem('arkengine:auto-farm:schedule:v1',JSON.stringify({nextAt:clock+15*60000,note:'等待体力恢复到 12 点再种植'}));`;
    const staleFarmStamina = `const renderFresh=renderFarm;window.renderFarm=()=>{renderFresh();
      const stamina=game.querySelector('[title^="每 "]');if(stamina)stamina.textContent='体力 8/100（4:00 恢复 1 点）';};`;
    await t.test('体力刷新竞态：新文档迟到时旧页不得关闭农场、重复读取或继续操作', async () => {
      await setupFarm(`addRuns(6);fm.stamina=46;${staleFarmStamina}
        const readFresh=window.fetch;window.releaseRead=null;window.fetch=(...args)=>new Promise(resolve=>{
          window.releaseRead=()=>resolve(readFresh(...args));});`, '/farm');
      try {
        await drive('!!window.releaseRead','initial stamina read');
        await pulse(11000); // 农场入页已超过旧逻辑的 10 秒阈值。
        delayFarmReload=true;
        const oldCalls=await evaluate('fm.calls');
        const snapshot=await evaluate('({fm,model,clock})');
        // 导航期间 CDP 默认上下文会等新文档。由旧文档自己的定时器推进并保存观察值。
        await evaluate(`window.reloadProbeTicks=0;window.reloadProbe=setInterval(()=>{
          clock+=5000;window.dispatchEvent(new Event('focus'));
          if(sessionStorage.getItem('arkengine:auto-farm:stamina-sync:v1')&&++reloadProbeTicks>=4){
            sessionStorage.setItem('test:old-farm',JSON.stringify({enabled:localStorage.getItem('arkengine:auto-farm:enabled:v1'),
              calls:fm.calls,status:document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent}));
            clearInterval(reloadProbe);
          }
        },150);releaseRead();`);
        await until(()=>Boolean(farmReloadResponse),'server holds new document');
        await delay(1500);
        delayFarmReload=false;
        farmReloadResponse.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
        farmReloadResponse.end(farmMarkup);farmReloadResponse=null;
        await until(()=>evaluate(`typeof renderFarm==='function'&&!document.getElementById('ark-auto-expedition')`),'new farm document');
        const probe=await evaluate(`JSON.parse(sessionStorage.getItem('test:old-farm'))`);
        assert.ok(probe,'旧文档在等待响应时实际运行了多次定时器');
        assert.notEqual(probe.enabled,'false');
        assert.deepEqual(probe.calls.map(c=>c.type),[...oldCalls.map(c=>c.type),'read'],'旧页面只完成一次已发起读取');
        assert.match(probe.status,/等待新页面接管/);
        await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderFarm();`);
        await evaluate(source);
        const events=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events`);
        assert.equal(events.filter(e=>e.type==='farm-paused').length,0);
        assert.equal(events.filter(e=>e.type==='farm-stamina-refresh').length,1);
        await drive(`${farmCalls('plant')}.length===1`,'new document resumes planting');
        await pulse(5000);
        assert.equal(await evaluate(farmCalls('plant')+'.length'),1);
        assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:stamina-sync:v1')`),null);
      } finally {
        delayFarmReload=false;
        if(farmReloadResponse){farmReloadResponse.end(farmMarkup);farmReloadResponse=null;}
      }
    });
    await t.test('体力恢复核对：预约到期但农场仍显示8，核对后刷新并只收获或种植一次', async () => {
      for(const action of ['harvest','plant']) {
        const crops=action==='harvest'?`fm.crops=Array.from({length:12},(_,i)=>({plot:i+1,key:'crop-0',name:'小麦',at:clock-1}));`:'';
        await setupFarm(`addRuns(6);fm.stamina=46;fm.headerStamina=8;${crops}${staleFarmStamina}
          localStorage.setItem('arkengine:auto-farm:schedule:v1',JSON.stringify({nextAt:clock-1,note:'等待体力恢复到 12 点再${action==='harvest'?'收获':'种植'}'}));`, '/farm');
        const snapshot=await evaluate('({fm,model,clock})');
        await drive(`!document.getElementById('ark-auto-expedition')`,'reload stale stamina view',30);
        await until(()=>evaluate(`typeof renderFarm==='function'&&!document.getElementById('ark-auto-expedition')`),'stamina reload fixture');
        assert.ok(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:stamina-sync:v1')`));
        await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderFarm();`);
        await evaluate(source);
        await drive(`${farmCalls(action)}.length===1`,'operation after fresh farm display');
        await pulse(5000);
        assert.equal(await evaluate(farmCalls(action)+'.length'),1);
        assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:stamina-sync:v1')`),null);
        assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
      }
    });
    await t.test('体力恢复核对：顶部足够但接口仍不足，按最新值预约且不反复请求', async () => {
      await setupFarm(`addRuns(6);fm.stamina=10;fm.headerStamina=46;fm.nextRegen=30;${staleFarmStamina}${oldStaminaWait}`);
      await drive(`${farmCalls('navigate')}.length===2&&location.pathname==='/activities/expedition'`,'fresh stamina schedule');
      const event=await evaluate(`(await window.__arkTestLogs.read('expedition','2026-10-10',100000)).events.find(e=>e.type==='farm-stamina-wait')`);
      assert.equal(event.data.current,10);assert.equal(event.data.needed,12);assert.equal(event.data.pageStamina,8);
      assert.equal(event.data.nextAt-event.data.checkedAt,272000);
      assert.equal(await evaluate('fm.reads'),1);
      const nextAt=await evaluate(farmState+'.nextAt');
      await pulse(60000);
      assert.equal(await evaluate(farmState+'.nextAt'),nextAt);
      assert.equal(await evaluate('fm.reads'),1);
      assert.equal(await evaluate(farmCalls('plant')+'.length'),0);
    });
    await t.test('体力恢复核对：种植前最新体力不足会预约，恢复后继续且不关闭农场', async () => {
      await setupFarm(`addRuns(6);fm.stamina=12;fm.apiStamina=8;`);
      await drive(`location.pathname==='/activities/expedition'&&${farmCalls('read')}.length===1&&!!${farmState}.staminaSeen`,'server says stamina insufficient');
      assert.equal(await evaluate(farmCalls('open')+'.length'),1,'检查种子窗口已打开后的最新体力不足分支');
      assert.equal(await evaluate(`document.querySelectorAll('[role="dialog"]').length`),0);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
      assert.equal(await evaluate(farmCalls('plant')+'.length'),0);
      await evaluate(`clock=${farmState}.nextAt;fm.stamina=12;fm.apiStamina=12;renderExp();`);
      await drive('fm.crops.length===12','stamina recovers without manual enable');
      assert.equal(await evaluate(farmCalls('plant')+'.length'),1);
    });
    await t.test('体力恢复核对：刷新后仍是旧体力只等待或提示核对，不再次刷新或种植', async () => {
      await setupFarm(`addRuns(6);fm.stamina=46;${staleFarmStamina}
        sessionStorage.setItem('arkengine:auto-farm:stamina-sync:v1',JSON.stringify({at:clock-1000}));`, '/farm');
      await drive(`localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'`,'stale display after bounded reload',25);
      assert.equal(await evaluate('fm.reads'),1);
      assert.equal(await evaluate(farmCalls('plant')+'.length'),0);
      assert.ok(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:stamina-sync:v1')`));
    });
    await t.test('体力恢复核对：迟到体力响应不能越过暂停、离页或账号异常', async () => {
      for(const stop of ['farm','group','leave','account']) {
        await setupFarm(`addRuns(6);fm.stamina=8;${oldStaminaWait}
          window.readSignal=null;window.finishRead=null;window.fetch=(url,options)=>{fm.reads++;readSignal=options.signal;
            return new Promise(resolve=>{finishRead=()=>resolve(new Response(JSON.stringify(farmData()),{status:200}));});};`, '/farm');
        await evaluate(`clock=${farmState}.nextAt;window.dispatchEvent(new Event('focus'));`);
        await drive('fm.reads===1','stamina request pending',20);
        if(stop==='leave')await evaluate(`navFarm('/profile');`);
        else if(stop==='account')await evaluate(`fm.error=true;fm.message='401 登录失效';renderFarm();`);
        else await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('${stop==='farm'?'farm-toggle':'toggle'}').click();`);
        await pulse();
        const before=await evaluate(`localStorage.getItem('arkengine:auto-farm:schedule:v1')`);
        assert.equal(await evaluate('readSignal.aborted'),true);
        await evaluate('fm.stamina=46;finishRead();');await pulse(10000);
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-farm:schedule:v1')`),before);
        assert.equal(await evaluate(farmCalls('plant')+'.length'),0);
      }
    });
    await t.test('体力恢复核对：数据缺失或恢复时间非法时不猜预约、不刷新或操作', async () => {
      for(const override of [`current:NaN`,`current:8,regenMinutes:0`,`current:8,nextRegenSeconds:-1`]) {
        await setupFarm(`addRuns(6);fm.stamina=8;const original=farmData;window.farmData=()=>{
          const data=original();Object.assign(data.stamina,{${override}});return data;};`, '/farm');
        await drive(`localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'`,'invalid stamina is rejected',20);
        assert.equal(await evaluate('fm.reads'),1);
        assert.equal(await evaluate(farmCalls('plant')+'.length'),0);
        assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:stamina-sync:v1')`),null);
        assert.match(await evaluate(farmState+'.note'),/体力或恢复时间无法核对/);
      }
    });
    await t.test('体力恢复核对：准备同步旧体力时出现手动弹窗会撤销刷新', async () => {
      await setupFarm(`addRuns(6);fm.stamina=46;${staleFarmStamina}`, '/farm');
      await until(async()=>(await expStatus())?.includes('秒后刷新农场'),'stamina reload queued');
      await evaluate(`openSeeds();window.manualDialog=document.querySelector('[role="dialog"]');`);
      await pulse(30000);
      assert.equal(await evaluate('manualDialog.isConnected'),true);
      assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:stamina-sync:v1')`),null);
      assert.equal(await evaluate(farmCalls('plant')+'.length'),0);
    });
    await t.test('体力恢复核对：农场原收获未确认时不读体力或新建收获', async () => {
      await setupFarm(`addRuns(6);fm.stamina=46;${staleFarmStamina}
        fm.crops=Array.from({length:12},(_,i)=>({plot:i+1,key:'crop-0',name:'小麦',at:clock-1}));
        sessionStorage.setItem('arkengine:auto-farm:pending:v1',JSON.stringify({at:clock,action:'harvest',plots:Array.from({length:12},(_,i)=>i+1)}));`, '/farm');
      await pulse(15000);
      assert.equal(await evaluate('fm.reads'),0);
      assert.equal(await evaluate(farmCalls('harvest')+'.length'),0);
      assert.ok(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:pending:v1')`));
      assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:stamina-sync:v1')`),null);
    });
    await t.test('体力恢复核对：远征仍有未决记录时不以体力同步刷新越过', async () => {
      await setupFarm(`addRuns(6);fm.stamina=46;${staleFarmStamina}
        sessionStorage.setItem('expedition:77:manual',JSON.stringify({input:{routeKey:'patrol'},idempotencyKey:'manual-pending'}));`, '/farm');
      await pulse(1000);await pulse(60000);
      assert.ok(await evaluate(`sessionStorage.getItem('expedition:77:manual')`));
      assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:stamina-sync:v1')`),null);
      assert.equal(await evaluate(farmCalls('plant')+'.length'),0);
      assert.match(await expStatus(),/原操作核对/);
    });
    await t.test('农场体力：旧版还等15分钟，显示足够时提前检查且不影响成熟预约', async () => {
      await setupFarm(`addRuns(6);fm.stamina=12;fm.headerStamina=12;${oldStaminaWait}`);
      const oldAt=await evaluate(`${farmState}.nextAt`);
      await drive(`fm.crops.length===12&&location.pathname==='/activities/expedition'`,'server stamina bypasses obsolete wait',35);
      assert.ok(await evaluate('clock')<oldAt);
      assert.equal(await evaluate('fm.stamina'),0);
      assert.equal(await evaluate('fm.reads'),1,'只保留原有种植前行情读取，不新增体力轮询');
      const nextAt=await evaluate(`${farmState}.nextAt`);
      await pulse(60000);
      assert.equal(await evaluate(`${farmState}.nextAt`),nextAt);
      assert.equal(await evaluate('fm.reads'),1,'生长预约不轮询体力，也不因旧顶部12点提前切页');
      assert.equal(await evaluate(`${farmCalls('navigate')}.length`),2);
    });
    await t.test('农场体力：顶部旧12但农场8时核对一次最新状态，不反复切页或查询接口', async () => {
      await setupFarm(`addRuns(6);fm.stamina=8;fm.headerStamina=12;${oldStaminaWait}`);
      await drive(`${farmCalls('navigate')}.length===2&&location.pathname==='/activities/expedition'`,'stale top value checked once',20);
      const nextAt=await evaluate(`${farmState}.nextAt`);
      await pulse(5*60000);
      assert.equal(await evaluate('fm.reads'),1);
      assert.equal(await evaluate(`${farmState}.nextAt`),nextAt);
      assert.equal(await evaluate(`${farmCalls('navigate')}.length`),2);
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      const snapshot=await evaluate('({fm,model,clock})');
      await cdp.send('Page.navigate',{url:`${origin}/activities/expedition?farm-fixture=stamina-reload`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?farm-fixture=stamina-reload'&&typeof renderFarm==='function'`),'reload stamina wait');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderExp();`);
      await evaluate(source);
      await pulse(60000);
      assert.equal(await evaluate(`${farmCalls('navigate')}.length`),2,'刷新脚本后仍记得同一旧数值已核对');
      assert.equal(await evaluate('fm.reads'),1);
      await evaluate('fm.stamina=13;fm.headerStamina=13;renderExp();');
      await drive(`fm.crops.length===12`,'new displayed value allows another check');
      assert.equal(await evaluate('fm.reads'),2);
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),1);
    });
    await t.test('农场体力：顶部未更新时保留原预约，到期照常检查，不额外轮询', async () => {
      await setupFarm(`addRuns(6);fm.stamina=12;fm.headerStamina=0;${oldStaminaWait}`);
      const nextAt=await evaluate(`${farmState}.nextAt`);
      await pulse(5*60000);
      assert.equal(await evaluate(`${farmCalls('navigate')}.length`),0);
      assert.equal(await evaluate('fm.reads'),0);
      await evaluate(`clock=${nextAt};`);
      await drive('fm.crops.length===12','original deadline remains valid',35);
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),1);
    });
    await t.test('农场体力：提前收获后实际体力扣为0，不按顶部旧12点继续种植', async () => {
      await setupFarm(`addRuns(6);fm.stamina=12;fm.headerStamina=12;
        fm.crops=Array.from({length:12},(_,i)=>({plot:i+1,key:'crop-6',name:'蓝莓',at:clock-1}));
        localStorage.setItem('arkengine:auto-farm:schedule:v1',JSON.stringify({nextAt:clock+15*60000,note:'等待体力恢复到 12 点再收获'}));`);
      await drive(`${farmCalls('harvest')}.length===1&&!fm.crops.length&&location.pathname==='/activities/expedition'`,'early harvest followed by real stamina wait',35);
      assert.equal(await evaluate('fm.stamina'),0);
      assert.match(await evaluate(`${farmState}.note`),/12 点再种植/);
      await pulse(60000);
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      assert.equal(await evaluate('location.pathname'),'/activities/expedition');
    });
    await t.test('农场体力：原有种植前读取失败时不因顶部足够而种植', async () => {
      await setupFarm(`addRuns(6);fm.stamina=12;fm.headerStamina=12;fm.requestError=true;${oldStaminaWait}`);
      await drive(`${farmState}?.readDeferred===true&&location.pathname==='/activities/expedition'`,'failed planting preflight deferred');
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      assert.equal(await evaluate('fm.reads'),3,'只读网络失败最多三次，写操作始终为零');
    });

    for(const lowStamina of [false,true])await t.test(`农场临时故障预约：${lowStamina?'核对体力':'种子窗口'}连续三次读取失败后保留开启，冷却后自动恢复种植`,async()=>{
      await setupFarm(`addRuns(6);fm.httpStatus=503;fm.stamina=${lowStamina?8:100};`,'/farm');
      await drive('fm.reads===3','three bounded farm read attempts',100);
      await drive(`location.pathname==='/activities/expedition'`,'farm yields during temporary failure',100);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      assert.equal(await evaluate(`Boolean(document.querySelector('[role="dialog"]'))`),false);
      const nextAt=await evaluate(`${farmState}.nextAt`);
      assert.ok(nextAt>await evaluate('clock'),'保存未来检查时间');
      await pulse(240000);assert.equal(await evaluate('fm.reads'),3,'冷却期间不继续请求');
      await evaluate(`fm.httpStatus=200;fm.stamina=100;clock=${nextAt};renderExp();`);
      await drive(`${farmCalls('plant')}.length===1&&location.pathname==='/activities/expedition'`,'automatic farm recovery after scheduled read',100);
      assert.equal(await evaluate('fm.reads'),4);
      assert.equal(await evaluate('fm.crops.length'),12);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
    });
    await t.test('农场临时故障预约：响应暂时无法解析时仍受三次和五分钟限制，恢复有效状态后再种植',async()=>{
      await setupFarm(`addRuns(6);fm.badJson=true;const originalFetch=window.fetch;
        window.fetch=(...args)=>{if(fm.badJson){fm.reads++;return Promise.resolve(new Response('{',{status:200}));}return originalFetch(...args);};`,'/farm');
      await drive(`${farmState}?.readDeferred===true&&location.pathname==='/activities/expedition'`,'invalid response deferred',100);
      assert.equal(await evaluate('fm.reads'),3);assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      await pulse(240000);assert.equal(await evaluate('fm.reads'),3);
      await evaluate(`fm.badJson=false;clock=${farmState}.nextAt;renderExp();`);
      await drive(`${farmCalls('plant')}.length===1`,'valid response resumes original farm schedule');
      assert.equal(await evaluate('fm.reads'),4);
    });
    await t.test('农场临时故障预约：人工关闭覆盖自动重查，非临时错误和数据规则变化仍停止',async()=>{
      await setupFarm('addRuns(6);fm.httpStatus=503;','/farm');
      await drive(`${farmState}?.readDeferred===true&&location.pathname==='/activities/expedition'`,'farm temporary cooldown before manual pause',100);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('farm-toggle').click();fm.httpStatus=200;`);
      await pulse(360000);
      assert.equal(await evaluate('fm.reads'),3);assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
      for(const code of ['fm.httpStatus=400;','window.farmData=()=>null;','fm.httpStatus=401;']){
        await setupFarm(`addRuns(6);${code}`,'/farm');
        await drive(`localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'||localStorage.getItem('arkengine:auto-expedition:enabled:v1')==='false'`,'hard farm failure stopped');
        await pulse(600000);
        assert.equal(await evaluate('fm.reads'),1);assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
        assert.notEqual(await evaluate(`${farmState}?.readDeferred`),true);
      }
    });
    await t.test('只读恢复：离线不请求，恢复后有限重试成功且只种植一次', async () => {
      await setupFarm(`addRuns(6);Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.testOnline});window.testOnline=false;`, '/farm');
      for(let i=0;i<10;i++)await pulse();
      assert.equal(await evaluate('fm.reads'),0);
      await evaluate(`testOnline=true;fm.httpStatus=503;window.dispatchEvent(new Event('online'));`);
      await drive('fm.reads===1','first read failure',20);
      await evaluate('fm.httpStatus=200');
      await drive(`fm.crops.length===12 && location.pathname==='/activities/expedition'`,'retry succeeds',40);
      assert.equal(await evaluate('fm.reads'),2);
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),1);
    });
    await t.test('只读恢复：暂停或离页后迟到的行情不能改写日程或触发种植', async () => {
      for(const leave of [false,true]) {
        await setupFarm(`addRuns(6);window.readSignal=null;window.finishRead=null;
          window.fetch=(url,options)=>{fm.reads++;readSignal=options.signal;return new Promise(resolve=>{finishRead=()=>resolve(new Response(JSON.stringify(farmData()),{status:200}));});};`, '/farm');
        await drive('fm.reads===1','pending read',20);
        if(leave)await evaluate(`navFarm('/profile')`);
        else await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click()`);
        await pulse();
        assert.equal(await evaluate('readSignal.aborted'),true);
        const before=await evaluate(`localStorage.getItem('arkengine:auto-farm:schedule:v1')`);
        await evaluate('finishRead()');
        await pulse(10000);
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-farm:schedule:v1')`),before);
        assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
        assert.equal(await evaluate('fm.reads'),1);
      }
    });

    await t.test('农场体力：顶部和农场都残留12但接口只有8时预约等待，不种植或关闭农场', async () => {
      await setupFarm(`addRuns(6);fm.stamina=12;fm.headerStamina=12;fm.apiStamina=8;${oldStaminaWait}`);
      await drive(`${farmCalls('navigate')}.length===2&&location.pathname==='/activities/expedition'`,'authoritative preflight schedules stamina recovery');
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      assert.equal(await evaluate('fm.reads'),1);
      assert.match(await evaluate(`${farmState}.note`),/等待体力恢复到 12 点再种植/);
    });
    await t.test('农场：状态接口401、403或429时整组暂停，远征归来后也不再自动请求', async () => {
      for(const statusCode of [401,403,429]) {
        await setupFarm(`addRuns(6);fm.httpStatus=${statusCode};`);
        await drive(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')==='false'`,'farm HTTP error stops expedition group');
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-encounter:enabled:v1')`),'false');
        assert.ok(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`));
        assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
        assert.equal(await evaluate('fm.reads'),1);
        await evaluate(`closeSeeds();navFarm('/activities/expedition');model.runs.forEach(r=>r.done=true);renderExp();`);
        const calls=await evaluate('model.calls.length');
        await pulse(60000);
        assert.equal(await evaluate('fm.reads'),1);
        assert.equal(await evaluate('model.calls.length'),calls,'异常后不可继续领取派遣');
        assert.equal(await evaluate('model.runs.length'),6);
      }
    });
    await t.test('农场：状态接口发现账号切换时整组暂停，不再使用旧账号日程', async () => {
      await setupFarm(`addRuns(6);localStorage.setItem('arkengine:auto-farm:schedule:v1',JSON.stringify({userId:88,nextAt:0}));`);
      await drive(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')==='false'`,'account change pauses group');
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      assert.equal(await evaluate('fm.reads'),1);
      assert.match(await expStatus(),/账号已切换/);
    });
    await t.test('农场体力：等待切页时体力下降或暂停，不清除旧预约', async () => {
      await setupFarm(`addRuns(6);fm.stamina=12;fm.headerStamina=12;${oldStaminaWait}`);
      await until(async()=>(await expStatus())?.includes('提前到农场核对'),'queued early check');
      const oldAt=await evaluate(`${farmState}.nextAt`);
      await evaluate('fm.headerStamina=8;renderExp();');
      await pulse(10000);
      assert.equal(await evaluate(`${farmState}.nextAt`),oldAt);
      assert.equal(await evaluate(`${farmCalls('navigate')}.length`),0);
      await evaluate('fm.headerStamina=12;renderExp();');
      await until(async()=>(await expStatus())?.includes('提前到农场核对'),'queued re-crossing threshold');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('farm-toggle').click();`);
      await pulse(10000);
      assert.equal(await evaluate(`${farmState}.nextAt`),oldAt);
      assert.equal(await evaluate(`${farmCalls('navigate')}.length`),0);
      assert.equal(await evaluate('fm.reads'),0);
    });
    await t.test('农场：已成熟但体力不足时预约收获，收获后再预约种植体力', async () => {
      await setupFarm(`addRuns(6);fm.stamina=5;fm.crops=Array.from({length:12},(_,i)=>({plot:i+1,key:'crop-6',name:'蓝莓',at:clock-1}));`,'/farm');
      await drive(`location.pathname==='/activities/expedition'`,'harvest waits for stamina');
      assert.deepEqual(await evaluate(farmCalls('harvest')),[]);
      await evaluate(`clock=${farmState}.nextAt;fm.stamina=12;renderExp();`);
      await drive(`${farmCalls('harvest')}.length===1 && !fm.crops.length && location.pathname==='/activities/expedition'`,'harvest then wait planting energy');
      assert.equal(await evaluate('fm.stamina'),0);
      assert.deepEqual(await evaluate(farmCalls('plant')),[]);
      assert.match(await evaluate(`${farmState}.note`),/再种植/);
    });
    await t.test('农场：行情读取失败或免费库存不足时停止本轮种植，不猜价补购', async () => {
      for(const code of ['fm.requestError=true;','fc.forEach(c=>fm.inventory[c.key]=0);']) {
        await setupFarm(`addRuns(6);${code}`);
        await drive(code==='fm.requestError=true;'?`${farmState}?.readDeferred===true&&location.pathname==='/activities/expedition'`:
          `localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'`,'farm stops current planting on missing data');
        assert.deepEqual(await evaluate(farmCalls('plant')),[]);
        if(code==='fm.requestError=true;'){
          assert.equal(await evaluate('fm.reads'),3);
          assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
        }
      }
    });
    await t.test('农场：手动种子弹窗不接管，暂停撤销已排队的种植', async () => {
      await setupFarm('addRuns(6);', '/farm');
      await evaluate('openSeeds();');
      await until(async ()=>(await expStatus())?.includes('你处理农场弹窗'),'manual seed dialog');
      await pulse(10000);
      assert.deepEqual(await evaluate(farmCalls('plant')),[]);
      await setupFarm('addRuns(6);');
      await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('秒后种植')`,'queued farm planting');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('farm-toggle').click();`);
      await pulse(10000);
      assert.deepEqual(await evaluate(farmCalls('plant')),[]);
    });
    await t.test('农场：等待种植时更改指定作物，会重新计算并重新随机等待', async () => {
      await setupFarm('addRuns(6);');
      await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('秒后种植')`,'queued blueberry');
      await evaluate(`const select=document.getElementById('ark-auto-expedition').shadowRoot.getElementById('farm-crop');select.value='小麦';select.dispatchEvent(new Event('change'));`);
      await drive(`${farmCalls('plant')}.length===1`,'changed crop');
      assert.equal(await evaluate(`${farmCalls('plant')}[0].name`),'小麦');
    });
    await t.test('农场：凌晨先补普通与突发队伍，再在同页处理农场', async () => {
      await setupFarm(`model.burst=6;clock=Date.parse('2026-10-10T01:30:00+08:00');`);
      await drive(`${farmCalls('plant')}.length===1 && location.pathname==='/activities/expedition'`,'burst before farm');
      assert.deepEqual(await evaluate(`${confirmed}.map(c=>c.route)`),['边境巡逻','深渊远征']);
      assert.equal(await evaluate('model.runs.length'),12);
    });
    await t.test('农场：刷新后保留原成熟预约，不立即再次切页', async () => {
      await setupFarm('addRuns(6);');
      await drive(`fm.crops.length===12 && location.pathname==='/activities/expedition'`,'scheduled farm');
      const snapshot=await evaluate('({fm,model,clock})');
      const nextAt=await evaluate(`${farmState}.nextAt`);
      await cdp.send('Page.navigate',{url:`${origin}/activities/expedition?farm-fixture=reload`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?farm-fixture=reload' && typeof renderFarm==='function'`),'farm reload');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderExp();`);
      await evaluate(source);
      await until(async ()=>(await expStatus())?.includes('今日突发已使用'),'resumes expedition wait');
      await pulse(60000);
      assert.equal(await evaluate(`${farmState}.nextAt`),nextAt);
      assert.equal(await evaluate('location.pathname'),'/activities/expedition');
      assert.equal(await evaluate('fm.reads'),1);
    });
    await t.test('农场：请求尚未落定时不重复种植，延迟结果出现后继续远征', async () => {
      await setupFarm(`addRuns(6);fm.result='pending';`);
      await drive(`${farmCalls('plant')}.length===1`,'unconfirmed farm planting');
      await pulse(10000);
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),1);
      assert.equal(await evaluate(`document.querySelectorAll('[role="dialog"]').length`),1,'请求处理中保留真实种子弹窗');
      await evaluate('finishPlant();');
      await drive(`location.pathname==='/activities/expedition'`,'delayed planting result verified');
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),1);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-farm:pending:v1'))`),null);
    });
    await t.test('农场：种植弹窗超时后刷新核对，未知结果保留记录且突发远征继续', async () => {
      await setupFarm(`addRuns(6);model.burst=6;fm.result='pending';clock=Date.parse('2026-10-10T01:58:00+08:00');`,'/farm');
      await drive(`${farmCalls('plant')}.length===1`,'plant submitted with dialog open');
      const pending=await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-farm:pending:v1'))`);
      assert.equal(await evaluate(`document.querySelectorAll('[role="dialog"]').length`),1);
      await pulse(31000);
      await drive(`!document.querySelector('[role="dialog"]')`,'timed-out own dialog closes',10);
      const snapshot=await evaluate('({fm,model,clock})');
      for(let i=0;i<5;i++) {
        if(await evaluate(`!document.getElementById('ark-auto-expedition')`))break;
        await pulse();
      }
      await until(()=>evaluate(`typeof renderFarm==='function'&&!document.getElementById('ark-auto-expedition')`),'automatic farm reload');
      assert.deepEqual(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-farm:pending:v1'))`),{...pending,reloaded:true});
      // 重新加载后服务端仍未确认种植；新页面允许操作，脚本必须继续保留原记录。
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;fm.busy=false;renderFarm();`);
      await evaluate(source);
      await drive(`location.pathname==='/activities/expedition'&&${confirmed}.some(c=>c.route==='深渊远征')`,'expedition resumes before 02:00');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),1);
      assert.equal(await evaluate(`${farmCalls('harvest')}.length`),0);
      assert.deepEqual(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-farm:pending:v1'))`),{...pending,reloaded:true});
      assert.equal(await evaluate('clock<Date.parse("2026-10-10T02:00:00+08:00")'),true);
      const travels=await evaluate(`${farmCalls('navigate')}.length`);
      await pulse(60000);
      assert.equal(await evaluate(`${farmCalls('navigate')}.length`),travels,'未知结果不导致反复返回农场');
    });
    await t.test('农场：种植超时关闭窗口后结果到达，撤销刷新并正常返回远征', async () => {
      await setupFarm(`addRuns(6);fm.result='pending';`,'/farm');
      await drive(`${farmCalls('plant')}.length===1`,'pending farm operation');
      await pulse(31000);
      await drive(`!document.querySelector('[role="dialog"]')`,'close own pending dialog',10);
      await evaluate('finishPlant();');
      await drive(`location.pathname==='/activities/expedition'`,'late success returns to expedition');
      assert.equal(await evaluate('fm.crops.length'),12);
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),1);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-farm:pending:v1'))`),null);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
    });
    await t.test('农场：超时恢复不关闭后来手动打开的窗口', async () => {
      await setupFarm(`addRuns(6);fm.result='pending';`,'/farm');
      await drive(`${farmCalls('plant')}.length===1`,'pending farm planting');
      await evaluate(`closeSeeds();openSeeds();window.manualSeedDialog=document.querySelector('[role="dialog"]');`);
      await pulse(45000);
      for(let i=0;i<5;i++)await pulse();
      assert.equal(await evaluate('manualSeedDialog.isConnected'),true);
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),1);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-farm:pending:v1')).reloaded`),undefined);
    });
    await t.test('农场：请求处理中暂停农场，返回远征且保留原种植记录', async () => {
      await setupFarm(`addRuns(6);fm.result='pending';`,'/farm');
      await drive(`${farmCalls('plant')}.length===1`,'planting in flight');
      const pending=await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-farm:pending:v1'))`);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('farm-toggle').click();`);
      await drive(`location.pathname==='/activities/expedition'`,'paused farm releases page');
      assert.equal(await evaluate(`document.querySelectorAll('[role="dialog"]').length`),0);
      assert.deepEqual(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-farm:pending:v1'))`),pending);
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),1);
      await pulse(45000);
      assert.equal(await evaluate('location.pathname'),'/activities/expedition');
    });
    await t.test('农场：后台主线程定时器延迟一分钟，成熟预约仍由 Worker 触发切页', async () => {
      await setupFarm(`addRuns(6);fm.crops=Array.from({length:12},(_,i)=>({plot:i+1,key:'crop-6',name:'蓝莓',at:clock+600000}));`,'/farm');
      await drive(`location.pathname==='/activities/expedition'`,'wait in expedition');
      const foreground=await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        await evaluate(`const timeout=window.setTimeout.bind(window);
          window.setTimeout=(fn,ms,...args)=>timeout(fn,Math.max(ms||0,60000),...args);
          clock=${farmState}.nextAt;`);
        await until(async ()=>(await expStatus())?.includes('随机等待'),'worker notices farm deadline',6000);
        assert.equal(await evaluate('document.visibilityState'),'hidden');
        assert.equal(await evaluate('location.pathname'),'/activities/expedition');
        await evaluate('clock+=2001');
        await until(()=>evaluate(`location.pathname==='/farm'`),'worker switches farm in background',6000);
      } finally {await cdp.send('Target.closeTarget',{targetId:foreground.targetId});}
    });

    const dungeonState = `JSON.parse(localStorage.getItem('arkengine:auto-dungeon:state:v1'))`;
    const setupDungeon = async (code = '', path = '/cultivate') => {
      await cdp.send('Page.navigate', { url: `${origin}${path}?dungeon-fixture=${++pageSerial}` }, tab.sessionId);
      await until(() => evaluate(`location.search === '?dungeon-fixture=${pageSerial}' && typeof renderDun === 'function'`), 'dungeon fixture');
      await resetLogs();
      // 新场景不能继承上一场景保存的游戏模型。
      await evaluate(`localStorage.clear(); sessionStorage.clear();${configuredDefaults}
        localStorage.setItem('arkengine:auto-encounter:enabled:v1','true');localStorage.setItem('arkengine:auto-farm:enabled:v1','false');
        localStorage.setItem('arkengine:auto-shelter:enabled:v1','false');`);
      await cdp.send('Page.reload', {}, tab.sessionId);
      await until(() => evaluate(`typeof renderDun === 'function' && !document.getElementById('ark-auto-expedition')`), 'fresh dungeon document');
      await evaluate(`Math.random = () => 0; ${code}; renderDun();`);
      await evaluate(source);
    };

    await t.test('修仙导航异常：跳过损坏及禁用的同路入口，秘境完成后仍返回主殿', async () => {
      for(const invalid of ['malformed','disabled']){
        await setupDungeon(`const bad=document.createElement('div');
          bad.innerHTML=${JSON.stringify('<a href="https://example.invalid/cultivate/dungeon">外站</a><a href="/cultivate/dungeon" target="_blank">新窗口</a><a href="/cultivate/dungeon" hidden>隐藏入口</a>')};
          for(const path of ['/cultivate/dungeon','/cultivate']){
            const a=document.createElement('a');a.textContent='不可用链接';
            a.href=${JSON.stringify(invalid)}==='malformed'?'http://[':path;
            if(${JSON.stringify(invalid)}==='disabled')a.setAttribute('aria-disabled','true');
            a.onclick=e=>{e.preventDefault();dm.calls.push(['invalid-navigation']);};bad.append(a);
          }document.body.prepend(bad);`);
        await drive(`dm.runs===1&&!dm.current&&location.pathname==='/cultivate'`,'complete dungeon past invalid links',70);
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),1);
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='choose').length`),8);
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='invalid-navigation').length`),0);
        assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-encounter:enabled:v1')`),'false');
      }
    });
    await t.test('夜间回归：动画帧停止时秘境确认窗仍能关闭并完成八节', async () => {
      await setupDungeon(`dm.animationClose=true; window.requestAnimationFrame=()=>1;`);
      await drive(`dm.runs===1 && !dm.current && location.pathname==='/cultivate'`, 'dungeon closes without animation frames', 60);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),1);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='choose').length`),8);
      assert.equal(await evaluate(`!!document.querySelector('[role="alertdialog"]')`),false);
    });
    await t.test('夜间回归：动画帧停止时远征仍能连续派遣领取', async () => {
      await setupExp(`model.animationClose=true; model.burst=0; window.requestAnimationFrame=()=>1;`);
      await drive(`model.runs.length===6 && !document.querySelector('[role="dialog"]')`, 'expedition closes without animation frames', 25);
      await evaluate(`model.runs.forEach(r=>r.done=true);renderExp();`);
      await drive(`${confirmed}.length===2 && model.runs.length===6`, 'claim after animation-free close', 25);
    });
    await t.test('夜间回归：秘境原请求持续处理中时让出主殿，恢复只确认原请求', async () => {
      await setupDungeon(`dm.mode='busy:enter';`);
      await drive(`dm.busy && !!nativeDun()`, 'entry pending');
      await pulse(2000);
      const original = await evaluate('nativeDun().idempotencyKey');
      await pulse(91000);
      await drive(`location.pathname==='/cultivate'`, 'stalled dungeon yields hall', 10);
      assert.equal(await evaluate('nativeDun().idempotencyKey'),original);
      const retryAt = await evaluate(`JSON.parse(localStorage.getItem('arkengine:auto-dungeon:state:v1')).nextAt`);
      await evaluate(`dm.encounter=true;renderDun();`);
      await drive(`dm.calls.some(c=>c[0]==='encounter')`, 'encounters run while dungeon waits');
      await pulse(60000);
      assert.equal(await evaluate('location.pathname'),'/cultivate');
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),1);
      await evaluate(`dm.busy=false;dm.mode='';clock=${retryAt};renderDun();`);
      await drive(`dm.runs===1 && !dm.current && location.pathname==='/cultivate'`, 'recover saved entry and finish');
      assert.equal(await evaluate(`dm.calls.find(c=>c[0]==='recover')[2]`),original);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),1);
      assert.equal(await evaluate(`dm.calls.some(c=>c[0]==='retreat')`),false);
    });
    const logBucket = (group='cultivate', day='2026-10-10') => `(await window.__arkTestLogs.read('${group}','${day}',100000))`;
    const requestEvents = `${logBucket()}?.events.filter(e=>e.type==='request-result')`;
    const diagnosticSetup = `window.clock=Date.parse('2026-10-10T12:00:00+08:00');Date.now=()=>clock;
      localStorage.setItem('arkengine:auto-encounter:enabled:v1','false');
      localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`;

    await t.test('七天日志：跨日边界、迁移幂等、损坏旧桶保留并注明', async () => {
      await setup(`${diagnosticSetup}
        for(const day of ['2026-10-02','2026-10-03','2026-10-04','2026-10-09'])localStorage.setItem('arkengine:auto-log:v1:cultivate:'+day,
          JSON.stringify({day,counts:{'legacy-reward':1},totals:{代币:10},dropped:3,events:[{at:Date.parse(day+'T12:00:00+08:00'),type:'legacy-reward',detail:'已到账',data:{}}]}));
        localStorage.setItem('arkengine:auto-log:v1:expedition:2026-10-09','{broken');`);
      const first=await evaluate('window.__arkTestLogs.export()');
      assert.equal(first.retentionDays,7);
      assert.equal(first.budgetBytes,20*1024*1024);
      assert.deepEqual(first.days.filter(d=>d.group==='cultivate').map(d=>d.day),['2026-10-03','2026-10-04','2026-10-09','2026-10-10']);
      assert.equal(first.retentionMode,'seven-full-days-plus-current-calendar-day');
      assert.equal(first.days.find(d=>d.day==='2026-10-04').dropped,3);
      assert.match(first.warnings.join(' '),/旧日志不可读/);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-log:v1:expedition:2026-10-09')`),'{broken');
      await evaluate(`window.__arkTestLogs.append({group:'cultivate',at:clock-1000,type:'state',detail:'迟到事件',data:{}},null,false)`);
      const coverage=await evaluate(logBucket());
      assert.equal(coverage.firstAt,await evaluate('clock-1000'));
      assert.equal(coverage.lastAt,await evaluate('clock'),'迟到写入不能缩短覆盖终点');
      await evaluate(`clock=Date.parse('2026-10-11T00:00:00+08:00')`);
      const next=await evaluate('window.__arkTestLogs.export()');
      assert.equal(next.days.some(d=>d.day==='2026-10-03'),false);
      assert.equal(next.days.some(d=>d.day==='2026-10-04'),true,'seven complete prior days survive the midnight boundary');
      assert.equal(next.days.find(d=>d.day==='2026-10-09').totals['代币'],10,'重复导出不重复迁移收益');
    });
    await t.test('七天日志：迁移事务失败保留旧记录，恢复后仅入账一次', async () => {
      await setup(`${diagnosticSetup}
        localStorage.setItem('arkengine:auto-log:v1:cultivate:2026-10-09',JSON.stringify({day:'2026-10-09',counts:{reward:1},totals:{代币:7},events:[{at:clock-86400000,type:'reward',data:{}}]}));
        const original=IDBObjectStore.prototype.add;window.restoreIDB=()=>{IDBObjectStore.prototype.add=original;};
        IDBObjectStore.prototype.add=function(){throw new DOMException('full','QuotaExceededError');};`);
      await until(()=>evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('log-summary').textContent.includes('日志存储失败')`),'migration failure visible');
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-log:v1:cultivate:2026-10-09')`),null);
      await evaluate('restoreIDB()');
      for(let i=0;i<2;i++){
        const value=await evaluate('window.__arkTestLogs.export()');
        assert.equal(value.days.find(d=>d.day==='2026-10-09').totals['代币'],7);
      }
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-log:v1:cultivate:2026-10-09')`),null);
    });
    await t.test('七天日志：20MiB预算优先保留故障，截断不改变收益汇总', async () => {
      await setup(diagnosticSetup);
      await evaluate(`window.__arkTestLogs.append({group:'cultivate',at:clock,type:'pause',detail:'保留故障',data:{}},null,false)`);
      await evaluate(`(async()=>{
        const payload='x'.repeat(500000);
        for(let i=0;i<50;i++)await window.__arkTestLogs.append({group:'cultivate',at:clock+i+1,type:'state',detail:'大记录',data:{payload}},{代币:1},false);
      })()`);
      const result=await evaluate('window.__arkTestLogs.export()');
      const day=result.days.find(d=>d.group==='cultivate');
      assert.ok(result.estimatedEventBytes<=result.budgetBytes);
      assert.ok(day.dropped>0);
      assert.equal(day.totals['代币'],50);
      assert.equal(day.counts.state,50);
      assert.ok(day.events.some(e=>e.detail==='保留故障'));
    });
    await t.test('关键日志保留：旧库先重分级，普通检查压力不能挤掉成交和施工回执', async () => {
      await setup(diagnosticSetup);
      await evaluate(`(async()=>{
        for(const [i,type] of ['stock-income','stock-submit','shelter-confirmed'].entries())
          await window.__arkTestLogs.append({group:'cultivate',at:clock-10000+i,type,
            receiptId:type==='stock-income'?'retention-old-receipt':undefined,detail:'旧版关键记录',data:{}},
            type==='stock-income'?{'股市已实现盈亏':-7}:null,false);
        await window.__arkTestLogs.append({group:'cultivate',at:clock-9000,type:'shelter-decision-detail',data:{rows:[]}},null,false);
        await new Promise((resolve,reject)=>{const req=indexedDB.open('arkengine-auto-log',1);
          req.onerror=()=>reject(req.error);req.onsuccess=()=>{
            const db=req.result,tx=db.transaction(['events','days','meta'],'readwrite');
            tx.onerror=()=>reject(tx.error);tx.onabort=()=>{db.close();reject(tx.error);};tx.oncomplete=()=>{db.close();resolve();};
            const rows=tx.objectStore('events').getAll();rows.onsuccess=()=>{
              for(const row of rows.result)tx.objectStore('events').put({...row,priority:1});
            };
            const b=tx.objectStore('meta').get('budget');b.onsuccess=()=>{
              delete b.result.priorityVersion;tx.objectStore('meta').put(b.result);
            };
            const d=tx.objectStore('days').get('cultivate:2026-10-10');d.onsuccess=()=>{
              delete d.result.criticalDropped;delete d.result.unclassifiedDropped;d.result.dropped=7;
              tx.objectStore('days').put(d.result);
            };
          };
        });
        for(let i=0;i<3;i++)await window.__arkTestLogs.append({group:'cultivate',at:clock+i,type:'shelter-check',
          data:{payload:'x'.repeat(9000000)}},null,false);
      })()`);
      const result=await evaluate('window.__arkTestLogs.export()'),day=result.days.find(d=>d.group==='cultivate');
      assert.ok(result.estimatedEventBytes<=result.budgetBytes);
      for(const type of ['stock-income','stock-submit','shelter-confirmed'])assert.ok(day.events.some(e=>e.type===type),type);
      assert.equal(day.events.some(e=>e.type==='shelter-decision-detail'),false);
      assert.equal(day.counts['shelter-check'],3);assert.ok(day.events.filter(e=>e.type==='shelter-check').length<3);
      assert.equal(day.totals['股市已实现盈亏'],-7);
      assert.equal(result.criticalEventCoverage.droppedEvents,0);
      assert.equal(result.criticalEventCoverage.unclassifiedDropped,7,'旧版丢失不能被升级清零');
      const again=await evaluate('window.__arkTestLogs.export()');
      assert.deepEqual(again.criticalEventCoverage,result.criticalEventCoverage,'重复导出不重计损失');
      assert.equal(again.estimatedEventBytes,result.estimatedEventBytes);
    });
    await t.test('关键日志保留：关键记录也超容量时报告损失，收益及回执去重仍保留', async () => {
      await setup(diagnosticSetup);
      await evaluate(`(async()=>{
        for(let i=0;i<3;i++)await window.__arkTestLogs.append({group:'cultivate',at:clock+i,type:'stock-income',
          receiptId:'critical-overflow-'+i,data:{payload:'x'.repeat(9000000)}},{代币:7},false);
        await window.__arkTestLogs.append({group:'cultivate',at:clock+10,type:'stock-income',
          receiptId:'critical-overflow-0',data:{duplicate:true}},{代币:7},false);
      })()`);
      const result=await evaluate('window.__arkTestLogs.export()'),day=result.days.find(d=>d.group==='cultivate');
      assert.ok(result.estimatedEventBytes<=result.budgetBytes);
      assert.equal(day.counts['stock-income'],3);assert.equal(day.totals['代币'],21);
      assert.equal(day.events.filter(e=>e.type==='stock-income').length,2);
      assert.ok(result.criticalEventCoverage.droppedEvents>=1);
      assert.equal(result.criticalEventCoverage.droppedEvents,day.criticalDropped);
      assert.equal(result.criticalEventCoverage.unclassifiedDropped,0);
      assert.equal(day.events.some(e=>e.data?.duplicate),false);
    });
    await t.test('七天日志：两个标签并发追加不丢事件或收益', async () => {
      await setup(diagnosticSetup);
      const second=await createTab();
      try {
        await cdp.send('Page.navigate',{url:`${origin}/cultivate?concurrent-log=1`},second.sessionId);
        await until(()=>cdp.evaluate(second.sessionId,`typeof base==='function'`),'concurrent logger fixture');
        await cdp.evaluate(second.sessionId,`window.clock=Date.parse('2026-10-10T12:00:00+08:00');Date.now=()=>clock;`);
        await cdp.evaluate(second.sessionId,source);
        const append=`(async()=>{for(let i=0;i<30;i++)await window.__arkTestLogs.append({group:'cultivate',at:clock,type:'audit-reward',detail:'到账',data:{}},{代币:2},false);})()`;
        await Promise.all([evaluate(append),cdp.evaluate(second.sessionId,append)]);
        const day=await evaluate(logBucket());
        assert.equal(day.counts['audit-reward'],60);
        assert.equal(day.totals['代币'],120);
        assert.equal(day.events.filter(e=>e.type==='audit-reward').length,60);
      } finally {await cdp.send('Target.closeTarget',{targetId:second.targetId});}
    });

    await t.test('七天日志：收益交付跨刷新且已提交回执不重复入账', async () => {
      await setup(`${diagnosticSetup}
        sessionStorage.setItem('arkengine:auto-log:v1:cultivate:outbox',JSON.stringify([{group:'cultivate',at:clock,type:'encounter-reward',detail:'已到账',data:{reward:{代币:9}},receiptId:'fixture-receipt'}]));`);
      assert.equal(await evaluate(`${logBucket()}.totals['代币']`),9);
      await evaluate(`sessionStorage.setItem('arkengine:auto-log:v1:cultivate:outbox',JSON.stringify([{group:'cultivate',at:clock,type:'encounter-reward',detail:'已到账',data:{reward:{代币:9}},receiptId:'fixture-receipt'}]));`);
      await cdp.send('Page.reload',{},tab.sessionId);
      await until(()=>evaluate(`typeof base==='function' && !window.__arkTestLogs`),'reload without resetting delivery');
      await evaluate(diagnosticSetup);
      await evaluate(source);
      assert.equal(await evaluate(`${logBucket()}.totals['代币']`),9);
      assert.equal(await evaluate(`${logBucket()}.counts['encounter-reward']`),1);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-log:v1:cultivate:outbox')).length`),0);
    });

    await t.test('七天日志：刷新诊断未落盘时跨刷新补交，重复交付只记一次且不计收入',async()=>{
      await setupFarm(`addRuns(6);const renderCurrent=renderFarm;window.renderFarm=()=>{renderCurrent();document.querySelector('details').remove();};`,'/farm');
      await until(async()=>(await expStatus())?.includes('等待田地'),'loading before delayed refresh log');
      const initial=await evaluate('clock');
      await evaluate(`const append=window.__arkTestLogs.append;window.__arkTestLogs.append=(event,...args)=>event.type==='page-refresh'?new Promise(()=>{}):append(event,...args);`);
      await pulse(90001);
      await until(()=>evaluate(`typeof renderFarm==='function'&&!document.getElementById('ark-auto-expedition')`),'reload before refresh log commits');
      const outbox=await evaluate(`sessionStorage.getItem('arkengine:auto-log:v1:expedition:outbox')`);
      assert.equal(JSON.parse(outbox||'[]').filter(e=>e.type==='page-refresh').length,1,'刷新前必须保存待交付的诊断');
      await evaluate(`clock=${initial+90001};addRuns(6);Math.random=()=>0;`);await evaluate(source);
      let events=await evaluate(`${logBucket('expedition')}.events`);
      assert.equal(events.filter(e=>e.type==='page-refresh').length,1);
      assert.equal(events.find(e=>e.type==='page-refresh').data.attempt,1);
      await evaluate(`sessionStorage.setItem('arkengine:auto-log:v1:expedition:outbox',${JSON.stringify(outbox)});`);
      await cdp.send('Page.reload',{},tab.sessionId);
      await until(()=>evaluate(`typeof renderFarm==='function'&&!document.getElementById('ark-auto-expedition')`),'replay committed refresh diagnostic');
      await evaluate(`clock=${initial+90002};addRuns(6);Math.random=()=>0;`);await evaluate(source);
      const bucket=await evaluate(logBucket('expedition'));
      assert.equal(bucket.counts['page-refresh'],1);assert.equal(bucket.events.filter(e=>e.type==='page-refresh').length,1);
      assert.deepEqual(bucket.totals,{});
      assert.deepEqual(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-log:v1:expedition:outbox'))`),[]);
    });
    for(const kind of ['idle','stamina'])await t.test(`刷新日志交付：${kind==='idle'?'远征停滞':'农场体力'}刷新前先保存诊断，下一页只补交一次`,async()=>{
      const type=kind==='idle'?'expedition-idle-refresh':'farm-stamina-refresh';
      if(kind==='idle'){
        await setupExp('addRuns(6);');
        await evaluate(`document.querySelector('#running button').parentElement.insertAdjacentHTML('beforeend','<span>预计 11:55 归来</span>');`);
        await until(async()=>(await expStatus())?.includes('已过预计归来时间'),'idle refresh waiting');
      }else await setupFarm(`addRuns(6);fm.stamina=46;${staleFarmStamina}`,'/farm');
      const at=await evaluate('clock');
      await evaluate(`const append=window.__arkTestLogs.append;window.__arkTestLogs.append=(event,...args)=>event.type===${JSON.stringify(type)}?new Promise(()=>{}):append(event,...args);`);
      if(kind==='idle'){await pulse(91000);await pulse(3000);}
      else await drive(`typeof renderFarm==='function'&&!document.getElementById('ark-auto-expedition')`,'stamina reload before log commit');
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'reload ready before diagnostic replay');
      const key='arkengine:auto-log:v1:expedition:outbox';
      const outbox=await evaluate(`sessionStorage.getItem(${JSON.stringify(key)})`);
      const events=JSON.parse(outbox||'[]').filter(e=>e.type===type);
      assert.equal(events.length,1,'刷新诊断必须在卸载前保存待交付记录');
      const path=kind==='idle'?'/activities/expedition':'/farm';
      await evaluate(`clock=${at+120000};addRuns(6);Math.random=()=>0;localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);
      await evaluate(source);
      let bucket=await evaluate(logBucket('expedition'));
      assert.equal(bucket.events.filter(e=>e.type===type).length,1);assert.equal(bucket.counts[type],1);assert.deepEqual(bucket.totals,{});
      await evaluate(`sessionStorage.setItem(${JSON.stringify(key)},${JSON.stringify(outbox)});`);
      await cdp.send('Page.reload',{},tab.sessionId);
      await until(()=>evaluate(`location.pathname===${JSON.stringify(path)}&&typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'committed diagnostic replay page');
      await evaluate(`clock=${at+120001};Math.random=()=>0;`);await evaluate(source);
      bucket=await evaluate(logBucket('expedition'));
      assert.equal(bucket.events.filter(e=>e.type===type).length,1);assert.equal(bucket.counts[type],1);assert.deepEqual(bucket.totals,{});
    });
    for(const operation of ['dispatch','claim','harvest'])await t.test(`原操作刷新诊断：${operation}原记录保留，刷新前持久保存核对原因且不计收入`,async()=>{
      const key=operation==='dispatch'?'arkengine:auto-expedition:pending:v1':
        operation==='claim'?'arkengine:auto-expedition:claim:v1':'arkengine:auto-farm:pending:v1';
      if(operation==='harvest'){
        await setupFarm(`addRuns(6);fm.crops=[{plot:1,key:fc[0].key,name:fc[0].name,at:clock-1000}];
          sessionStorage.setItem('${key}',JSON.stringify({action:'harvest',plots:[1],at:clock}));`,'/farm');
      }else if(operation==='dispatch'){
        await setupExp(`model.resultMode='pending';`);
        await drive(`${confirmed}.length===1&&!model.busy`,'dispatch result still unknown');
        await evaluate(`sessionStorage.removeItem('expedition:77:auto');renderExp();`);
      }else{
        await setupExp(`addRuns(6,false,true);window.claimRuns=()=>model.calls.push({type:'claim'});`);
        await drive(`model.calls.filter(c=>c.type==='claim').length===1`,'claim result still unknown');
      }
      const before=await evaluate(`JSON.parse(sessionStorage.getItem('${key}'))`),at=await evaluate('clock');
      await evaluate(`const append=window.__arkTestLogs.append;window.__arkTestLogs.append=(event,...args)=>event.type==='operation-refresh'?new Promise(()=>{}):append(event,...args);`);
      await pulse(operation==='dispatch'?61000:31000);await pulse(3000);
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'original operation page reloaded');
      const after=await evaluate(`JSON.parse(sessionStorage.getItem('${key}'))`);
      assert.equal(after.reloaded,true);assert.equal(after.at,operation==='claim'?at+34000:before.at);
      if(operation==='harvest')assert.deepEqual(after.plots,before.plots);
      if(operation==='dispatch')assert.deepEqual(after.original,before.original);
      if(operation==='claim')assert.equal(after.running,before.running);
      const queued=await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-log:v1:expedition:outbox')||'[]').filter(e=>e.type==='operation-refresh')`);
      assert.equal(queued.length,1);assert.equal(queued[0].data.operation,operation);
      assert.equal(queued[0].data.scope,operation==='harvest'?'farm':'expedition');
      assert.doesNotMatch(JSON.stringify(queued),/idempotencyKey|fixture-1/);
      await evaluate(`clock=${at+120000};localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`);await evaluate(source);
      const bucket=await evaluate(logBucket('expedition'));
      assert.equal(bucket.counts['operation-refresh'],1);assert.deepEqual(bucket.totals,{});
      assert.deepEqual(await evaluate(`JSON.parse(sessionStorage.getItem('${key}'))`),after);
    });
    await t.test('调度优化：单Worker，暂停组不周期扫描；重复日志采样不丢计数', async () => {
      await setup(`${diagnosticSetup}
        window.workerCount=0;window.scanCount=0;const OriginalWorker=Worker;
        window.Worker=class extends OriginalWorker{constructor(...args){super(...args);workerCount++;}};
        const originalQuery=document.querySelectorAll.bind(document);document.querySelectorAll=(...args)=>{scanCount++;return originalQuery(...args);};`);
      assert.equal(await evaluate('workerCount'),1);
      await delay(100);
      const before=await evaluate('scanCount');
      await delay(2200);
      assert.equal(await evaluate('scanCount'),before,'暂停后Worker不调度组内扫描');
      await evaluate(`window.__arkTestLogs.append({group:'cultivate',at:clock,type:'state',data:{},detail:'采样'},null,true)`);
      const day=await evaluate(logBucket());
      assert.equal(day.sampled,1);
      assert.ok(day.counts.state>=1);
      assert.equal(day.events.some(e=>e.detail==='采样'),false);
    });

    await t.test('登录诊断：真实 Request、Promise、响应正文保持原样，敏感内容不入日志', async () => {
      await setup(`${diagnosticSetup}
        const nativeFetch=window.fetch;
        window.fetch=function(...args){window.nativePromise=Reflect.apply(nativeFetch,this,args);return nativePromise;};`);
      const before = diagnosticRequests;
      await evaluate('window.installedFetch=window.fetch');
      await evaluate(source);
      assert.equal(await evaluate('window.fetch===installedFetch'),true,'重复注入不重复包裹请求');
      const result = await evaluate(`(async()=>{
        const request=new Request(location.origin+'/api/cultivation?token=query-secret#hash-secret',
          {method:'POST',headers:{'X-Test-Private':'header-secret'},body:'password=body-secret'});
        const promise=fetch(request);const same=promise===nativePromise;
        const response=await promise;const unused=!response.bodyUsed;const data=await response.json();
        return {same,unused,data,requestUsed:request.bodyUsed};
      })()`);
      assert.deepEqual(result,{same:true,unused:true,data:{method:'POST',body:'password=body-secret',privateValue:'response-secret'},requestUsed:true});
      assert.equal(diagnosticRequests-before,1,'只发送网站原来的一个请求');
      const events=await evaluate(requestEvents);
      assert.equal(events.length,1);
      assert.deepEqual(events[0].data,{path:'/api/cultivation',startedAt:Date.parse('2026-10-10T12:00:00+08:00'),durationMs:0,status:200,outcome:'ok',redirected:false});
      assert.doesNotMatch(JSON.stringify(await evaluate(`${logBucket()}`)),/query-secret|hash-secret|header-secret|body-secret|response-secret/);
    });
    await t.test('登录诊断：只观察已知同源游戏接口，余额心跳去重且不发探测请求', async () => {
      await setup(diagnosticSetup);
      const before=diagnosticRequests;
      await evaluate(`(async()=>{
        await fetch(new URL('/api/me/balance?token=private-query',location.origin));
        await fetch('/api/me/balance');await fetch('/api/me/balance');
        await fetch('/api/auth/password?code=401',{method:'POST',body:'private-password'});
        await fetch('/api/unknown/private-id?code=403');
        try{await fetch('http://localhost:${server.address().port}/api/cultivation?code=401');}catch{}
      })()`);
      assert.equal(await evaluate(`${requestEvents}.length`),1);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`),null);
      await evaluate(`clock+=15*60000;fetch('/api/me/balance')`);
      assert.equal(await evaluate(`${requestEvents}.length`),2);
      await delay(250);
      assert.equal(diagnosticRequests-before,7);
      assert.doesNotMatch(JSON.stringify(await evaluate(`${logBucket()}`)),/private-query|private-password|private-id/);
      for (const path of ['/api/farm/plant','/api/farm/plant-all','/api/farm/harvest','/api/farm/harvest-all','/api/farm/sell']) {
        await evaluate(`fetch('${path}?code=503',{method:'POST',body:'farm-private-body'})`);
        assert.equal(await evaluate(`${requestEvents}.at(-1).data.path`),path);
        assert.equal(await evaluate(`${requestEvents}.at(-1).data.status`),503);
      }
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`),null);
      assert.doesNotMatch(JSON.stringify(await evaluate(`${logBucket()}`)),/farm-private-body/);
    });
    await t.test('登录诊断：401、403、429 立即停止两组并保留原请求记录', async () => {
      for (const code of [401,403,429]) {
        await setup(`${diagnosticSetup}
          sessionStorage.setItem('cultivation:operation:fixture','original-pending');
          sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify({at:clock,reloaded:true,submittedAt:clock-1000}));`);
        const journals=await evaluate(`JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))`);
        assert.equal(await evaluate(`fetch('/api/cultivation?code=${code}').then(r=>r.status)`),code);
        assert.match(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`),new RegExp(`HTTP ${code}`));
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-encounter:enabled:v1')`),'false');
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
        assert.equal(await evaluate(`JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))`),journals);
        assert.equal(await evaluate(`${requestEvents}.at(-1).data.status`),code);
        await evaluate(`fetch('/api/cultivation?code=${code}')`);
        assert.equal(await evaluate(`${requestEvents}.length`),1,'重复失败不刷屏');
        await evaluate(`fetch('/api/cultivation')`);
        assert.equal(await evaluate(`${requestEvents}.at(-1).data.status`),200);
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-encounter:enabled:v1')`),'false','成功响应不能自动恢复');
      }
    });
    await t.test('登录诊断：网络中断、取消和 500 不误判登出，保留原异常', async () => {
      await setup(diagnosticSetup);
      assert.equal(await evaluate(`fetch('/api/cultivation?code=500').then(r=>r.status)`),500);
      assert.equal(await evaluate(`fetch('/api/cultivation?network-error=1').then(()=>false,e=>e.name)`),'TypeError');
      assert.equal(await evaluate(`(async()=>{const controller=new AbortController();controller.abort();
        try{await fetch('/api/cultivation',{signal:controller.signal});return false;}catch(e){return e===controller.signal.reason;}})()`),true);
      assert.deepEqual(await evaluate(`${requestEvents}.map(e=>e.data.outcome)`),['http-error','network-error','aborted']);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`),null);
    });
    await t.test('登录诊断：请求重定向与整页跳回登录保留来源、停止两组且不自动恢复', async () => {
      await setup(diagnosticSetup);
      const response=await evaluate(`fetch('/api/cultivation?redirect=1').then(async r=>({status:r.status,redirected:r.redirected,text:await r.text()}))`);
      assert.equal(response.status,200);assert.equal(response.redirected,true);assert.match(response.text,/使用 LinuxDo 登录/);
      assert.equal(await evaluate(`${requestEvents}.at(-1).data.outcome`),'login-redirect');
      assert.doesNotMatch(JSON.stringify(await evaluate(`${logBucket()}`)),/redirect-secret/);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();`);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`),null);
      // 全文档重载：仅延续 sessionStorage，不靠旧页面内存。
      await cdp.send('Page.navigate',{url:`${origin}/?login-fixture=1&token=navigation-secret`},tab.sessionId);
      await until(()=>evaluate('window.loginFixture===true'),'login landing');
      await evaluate(`Date.now=()=>${Date.parse('2026-10-10T12:00:00+08:00')};`);
      await evaluate(source);
      assert.deepEqual(await evaluate(`${logBucket()}.events.find(e=>e.type==='login-page').data`),{from:'/cultivate',to:'/'});
      assert.match(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`),/进入登录页/);
      assert.doesNotMatch(JSON.stringify(await evaluate(`${logBucket()}`)),/navigation-secret/);
      await cdp.send('Page.navigate',{url:`${origin}/cultivate?login-return=1`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?login-return=1'&&typeof base==='function'`),'manual login return');
      await evaluate(source);
      assert.equal(await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').textContent`),'开始全部自动操作');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click()`);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`),null);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
    });
    await t.test('登录诊断：首次登录、普通首页、隐藏入口不误停；SPA 出现真实入口才记录一次', async () => {
      await setup(diagnosticSetup,'/');
      await evaluate(`game.innerHTML=${JSON.stringify(loginMarkup)};window.dispatchEvent(new Event('focus'));`);
      await delay(150);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`),null);
      await setup(diagnosticSetup);
      await evaluate(`history.pushState({},'','/?token=spa-secret');game.innerHTML='<div hidden><a href="/api/auth/linuxdo">使用 LinuxDo 登录</a></div>';`);
      await delay(150);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`),null);
      await evaluate(`document.querySelector('#game div').hidden=false;`);
      await until(()=>evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')!==null`),'SPA login pause');
      await evaluate(`window.dispatchEvent(new Event('focus'));game.append(document.createElement('hr'));`);
      await delay(150);
      assert.equal(await evaluate(`${logBucket()}.counts['login-page']`),1);
      assert.doesNotMatch(JSON.stringify(await evaluate(`${logBucket()}`)),/spa-secret/);
    });
    await t.test('登录诊断：日志存储失败不影响响应或本页暂停', async () => {
      await setup(diagnosticSetup);
      await evaluate(`const nativeSet=Storage.prototype.setItem;window.restoreStorage=()=>{Storage.prototype.setItem=nativeSet;};
        Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError');};`);
      try {
        assert.equal(await evaluate(`fetch('/api/cultivation?code=401').then(r=>r.status)`),401);
        assert.match(await status(),/HTTP 401/);
        assert.match(await expStatus(),/HTTP 401/);
        assert.equal(await evaluate(`fetch('/api/cultivation').then(r=>r.json()).then(x=>x.method)`),'GET');
      } finally { await evaluate('restoreStorage()'); }
    });
    await t.test('登录诊断：HTTP 401 跨标签暂停统一控制器，恢复需显式开启奇遇', async () => {
      await setupExp(`addRuns(6);`);
      const cultivate=await createTab();
      try {
        await cdp.send('Page.navigate',{url:`${origin}/cultivate?http-stop=1`},cultivate.sessionId);
        await until(()=>cdp.evaluate(cultivate.sessionId,`typeof choices==='function'`),'HTTP stop cultivation');
        await cdp.evaluate(cultivate.sessionId,`window.clock=100000;Date.now=()=>clock;Math.random=()=>0;choices(['修为 +1','钻石 +2']);`);
        await cdp.evaluate(cultivate.sessionId,source);
        await until(()=>cdp.evaluate(cultivate.sessionId,`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('另一挂机标签页')`),'cultivation waits for unified lock');
        await evaluate(`model.runs.forEach(r=>r.done=true);renderExp();`);
        await until(async ()=>(await expStatus())?.includes('随机等待'),'expedition HTTP queue');
        await cdp.evaluate(cultivate.sessionId,`fetch('/api/cultivation?code=401').then(r=>r.status)`);
        await until(async ()=>(await expStatus())?.includes('HTTP 401'),'HTTP cross-tab pause');
        await pulse(10000);
        await cdp.evaluate(cultivate.sessionId,`clock+=10000;window.dispatchEvent(new Event('focus'));`);
        await delay(200);
        assert.deepEqual(await evaluate('model.calls'),[]);
        assert.deepEqual(await cdp.evaluate(cultivate.sessionId,'clicks'),[]);
        await cdp.send('Page.navigate',{url:'about:blank'},tab.sessionId);
        await cdp.evaluate(cultivate.sessionId,`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();`);
        await cdp.evaluate(cultivate.sessionId,`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('cultivate-toggle').click();`);
        await until(()=>cdp.evaluate(cultivate.sessionId,`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('随机等待')`),'current group resumed');
        await cdp.evaluate(cultivate.sessionId,`clock+=10000;window.dispatchEvent(new Event('focus'));`);
        await until(()=>cdp.evaluate(cultivate.sessionId,'clicks.length===1'),'current group action');
        assert.deepEqual(await cdp.evaluate(cultivate.sessionId,'clicks'),[1]);
        assert.equal(await cdp.evaluate(cultivate.sessionId,`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'true');
      } finally { await cdp.send('Target.closeTarget',{targetId:cultivate.targetId}); }
    });

    await dialogRecoveryTests({t,setupDungeon,setupFarm,setupExp,evaluate,drive,pulse,trustedStaffKey});














    await t.test('代币统计：奇遇按到账记录修为钻石代币，识别千位小数万亿且不猜未知金额', async () => {
      await setup(`window.clock=Date.parse('2026-10-10T10:00:00+08:00');Date.now=()=>clock;
        window.removeAfterChoice=true;
        window.claimReward=text=>{
          choices(['修为 +1 · 代币 +99999','钻石 +2 · 代币 +1']);
          document.querySelectorAll('#cultivation-encounter button').forEach(b=>b.onclick=()=>{
            game.querySelectorAll('[role="status"]').forEach(n=>n.remove());
            setTimeout(()=>notice('奇遇奖励已入账：'+text),20);
          });
        };`);
      for(const [i,receipt] of ['修为 +1.2万 · 钻石 +2 · 代币 +1,234.5','代币 +0.01亿','代币 +未知','代币 +1,23'].entries()){
        await evaluate(`claimReward(${JSON.stringify(receipt)})`);
        await drive(`${logBucket()}?.counts['encounter-reward']===${i+1}`,'encounter currency receipt');
        await pulse(2000);
      }
      assert.deepEqual(await evaluate(`${logBucket()}.totals`),{'代币':1001234.5,'修为':12000,'钻石':2});
      assert.deepEqual(await clickLog(),[1,1,1,1],'统计代币不改变钻石优先的选项规则');
      assert.match(await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('log-summary').textContent`),/代币 1001234\.5/);
    });
    await t.test('代币统计：远征单领批领加上明确额外里程碑，相同回执两次分别入账', async () => {
      await setupExp(`addRuns(1,false,true);addRuns(5);model.claimReceipts=[
        '远征归来，获得 1,200 代币！ 达成 10 次里程碑，额外获得 50 代币 + 2 抽卡券 + 3 钻石！',
        '已领取 6 支远征，共获得 7,200 代币；达成 20 次里程碑，额外获得100 代币 + 5 钻石；达成 30 次里程碑，额外获得200 代币',
        '已领取 6 支远征，共获得 7,200 代币；达成 20 次里程碑，额外获得100 代币 + 5 钻石；达成 30 次里程碑，额外获得200 代币'];`);
      await drive(`${logBucket('expedition')}?.totals['代币']===1250`,'single claim tokens');
      assert.equal(await evaluate(`${logBucket('expedition')}.totals['钻石']`),3);
      for(const tokens of [8750,16250]){
        await drive('model.runs.length===6','patrol refilled');
        await evaluate('model.runs.forEach(r=>r.done=true);renderExp();');
        await drive(`${logBucket('expedition')}?.totals['代币']===${tokens}`,'batch claim tokens');
      }
      assert.equal(await evaluate(`${logBucket('expedition')}.totals['钻石']`),13);
      assert.equal(await evaluate(`${logBucket('expedition')}.counts['expedition-reward']`),3);
      await pulse(60000);
      assert.equal(await evaluate(`${logBucket('expedition')}.totals['代币']`),16250);
    });
    await t.test('代币统计：农场暂停自动操作后手动成交仍记收入，报价与旧提示不计账', async () => {
      await setupFarm(`localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');fm.tab='market';fm.message='卖出成功，实际获得 9000 代币';`,'/farm');
      await pulse();
      assert.equal(await evaluate(`${logBucket('expedition')}?.totals['代币']||0`),0);
      for(const count of [1,2]){
        if(count===2) await evaluate(`localStorage.setItem('arkengine:auto:account-stop:v1','模拟账号暂停，手动成交仍应记账');`);
        await evaluate('openSale();');
        await pulse(10000);
        assert.equal(await evaluate(`${farmCalls('sell')}.length`),count-1,'脚本不能替用户卖出');
        await evaluate(`document.querySelector('[role="dialog"] button').click()`);
        await pulse();
        assert.equal(await evaluate(`${logBucket('expedition')}?.totals['代币']||0`),(count-1)*123.5,'报价不计收入');
        await evaluate(`document.querySelectorAll('[role="dialog"] button')[1].click()`);
        await drive(`${logBucket('expedition')}?.totals['代币']===${count*123.5}`,'actual farm sale tokens');
      }
      assert.equal(await evaluate(`${logBucket('expedition')}.counts['farm-sale-reward']`),2);
      await evaluate(`fm.saleMessage='报价已过期，请重新报价';fm.saleError=true;openSale();document.querySelectorAll('[role="dialog"] button')[1].click();`);
      await pulse(5000);
      assert.equal(await evaluate(`${logBucket('expedition')}.totals['代币']`),247);
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
      await evaluate(`window.exportedBlob=null;URL.createObjectURL=b=>{exportedBlob=b;return 'blob:local';};HTMLAnchorElement.prototype.click=function(){};
        document.getElementById('ark-auto-expedition').shadowRoot.getElementById('log-export').click();`);
      await until(()=>evaluate('!!exportedBlob'),'async log export');
      const exported=await evaluate('exportedBlob.text().then(JSON.parse)');
      assert.equal(exported.days[0].totals['代币'],247);
      assert.equal(exported.version,scriptVersion);
    });
    await t.test('代币统计：只有农场种收和估值不会增加代币收入', async () => {
      await setupFarm('addRuns(6);');
      await drive(`fm.crops.length===12&&location.pathname==='/activities/expedition'`,'plant without sale');
      await evaluate(`clock=${farmState}.nextAt;fm.stamina=100;renderExp();`);
      await drive(`${farmCalls('harvest')}.length===1&&${farmCalls('plant')}.length===2`,'harvest and replant');
      assert.equal(await evaluate(`${logBucket('expedition')}.totals['代币']||0`),0);
      assert.ok(await evaluate(`${logBucket('expedition')}.counts['farm-estimate']`)>0);
    });
    await t.test('代币统计：秘境完成累计代币只记一次，节点不重复累加', async () => {
      await setupDungeon(`dm.finalReward='修为 +12345 · 代币 +2.5万 · 钻石 +10';`);
      await drive(`dm.runs===1&&!dm.current&&location.pathname==='/cultivate'`,'dungeon currency receipt');
      assert.deepEqual(await evaluate(`${logBucket()}.totals`),{'修为':12345,'代币':25000,'钻石':10});
      await pulse(60000);
      assert.equal(await evaluate(`${logBucket()}.counts['dungeon-reward']`),1);
    });
    await t.test('夜间回归：日志只累计新到账回执，相同奖励两次仍分别入账', async () => {
      await setup(`window.clock=Date.parse('2026-10-10T10:00:00+08:00');Date.now=()=>clock;
        notice('奇遇奖励已入账：钻石 +2');
        window.prepareReward=()=>{
          window.removeAfterChoice=true;choices(['修为 +1','钻石 +2']);
          document.querySelectorAll('#cultivation-encounter button').forEach(b=>b.onclick=()=>{
            game.querySelectorAll('[role="status"]').forEach(n=>n.remove());
            setTimeout(()=>notice('奇遇奖励已入账：钻石 +2'),20);
          });
        };`);
      await pulse();
      assert.equal(await evaluate(`${logBucket()}?.totals['钻石']||0`),0,'旧回执不能算新收入');
      for(let i=1;i<=2;i++) {
        await evaluate('prepareReward()');
        await drive(`${logBucket()}?.totals['钻石']===${2*i}`, 'separate identical receipts');
        await pulse(2000);
      }
      assert.equal(await evaluate(`${logBucket()}.counts['encounter-reward']`),2);
      await pulse(3600000);
      assert.equal(await evaluate(`${logBucket()}.totals['钻石']`),4,'心跳和重复观察不重复计账');
      assert.equal(await evaluate(`${logBucket()}.counts['heartbeat-gap']`),1);
      assert.equal(await evaluate(`${logBucket()}.events.some(e=>e.type==='heartbeat-gap'&&e.data.gapMs>=3600000)`),true);
    });
    await t.test('夜间回归：秘境汇总不重复累加节点，日志每日保留昨夜证据并可导出', async () => {
      await setupDungeon(`
        localStorage.removeItem('arkengine:auto-defaults:stock:v1');localStorage.removeItem('arkengine:auto-defaults:shelter:v1');
        localStorage.setItem('arkengine:auto-log:v1:cultivate:2026-10-08',JSON.stringify({events:[]}));
        localStorage.setItem('arkengine:auto-log:v1:expedition:2026-10-09',JSON.stringify({day:'2026-10-09',events:[{detail:'昨夜'}]}));
      `);
      await drive(`dm.runs===1&&!dm.current&&location.pathname==='/cultivate'`, 'completed dungeon log');
      assert.equal(await evaluate(`${logBucket()}.totals['修为']`),12345);
      assert.equal(await evaluate(`${logBucket()}.counts['dungeon-reward']`),1);
      assert.ok(await evaluate(`${logBucket()}.counts['dungeon-node-reward']`)>0);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-log:v1:cultivate:2026-10-08')`),null);
      assert.notEqual(await evaluate(logBucket('expedition','2026-10-09')),null,'旧日志迁移后仍可读取');
      await evaluate(`window.exportedBlob=null;URL.createObjectURL=b=>{exportedBlob=b;return 'blob:local';};
        HTMLAnchorElement.prototype.click=function(){};
        document.getElementById('ark-auto-expedition').shadowRoot.getElementById('log-export').click();`);
      await until(()=>evaluate('!!exportedBlob'),'async log export');
      const exported = await evaluate(`exportedBlob.text().then(JSON.parse)`);
      assert.equal(exported.version,scriptVersion);
      assert.deepEqual(exported.days.map(d=>`${d.group}:${d.day}`).sort(),[
        'cultivate:2026-10-08','cultivate:2026-10-10','expedition:2026-10-09','expedition:2026-10-10']);
      const migrations=exported.days.find(d=>d.group==='expedition'&&d.day==='2026-10-10');
      assert.equal(migrations.counts['automation-defaults'],2);
      assert.deepEqual(migrations.events.filter(e=>e.type==='automation-defaults').map(e=>e.data.scope).sort(),['shelter','stock'],
        '1.17.29起股市和避难所默认迁移各生成一条事件，导出必须完整保留');
      assert.ok(!JSON.stringify(exported).includes('idempotencyKey'));
      await evaluate(`clock=Date.parse('2026-10-11T00:01:00+08:00');window.dispatchEvent(new Event('focus'));`);
      await delay(200);
      assert.notEqual(await evaluate(logBucket('cultivate','2026-10-10')),null);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-log:v1:expedition:2026-10-09')`),null);
    });
    await t.test('夜间回归：暂停和离开自动化路由会恢复原动画设置', async () => {
      await setup(`globalThis.BASE_UI_ANIMATIONS_DISABLED=false;`);
      assert.equal(await evaluate('BASE_UI_ANIMATIONS_DISABLED'),true);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click()`);
      await until(()=>evaluate('BASE_UI_ANIMATIONS_DISABLED===false'),'restore on pause');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click()`);
      await until(()=>evaluate('BASE_UI_ANIMATIONS_DISABLED===true'),'reenable');
      await evaluate(`history.pushState({},'','/other');window.dispatchEvent(new Event('popstate'));`);
      await until(()=>evaluate('BASE_UI_ANIMATIONS_DISABLED===false'),'restore on other route');
    });
    await t.test('夜间回归：一点前等待，延后刷新额度在重新读取后补派', async () => {
      await setupExp(`model.burst=6;addRuns(6);clock=Date.parse('2026-10-10T00:30:00+08:00');`);
      await until(async ()=>(await expStatus())?.includes('等待北京时间 1 点'),'wait for preferred window');
      await pulse(10000);
      assert.deepEqual(await evaluate(confirmed),[]);
      await setupExp(`model.burst=0;addRuns(6);clock=Date.parse('2026-10-10T03:50:00+08:00');`);
      await until(async ()=>(await expStatus())?.includes('今日突发已使用'),'stale quota');
      const snapshot=await evaluate('({model,clock})');
      const before=expeditionRequests;
      await pulse(15*60000);
      assert.equal(expeditionRequests,before,'15分钟不再整页刷新');
      await pulse(45*60000);
      await until(async ()=>(await expStatus())?.includes('重新读取今日突发额度'),'idle quota refresh queued');
      await pulse(2000);
      await until(()=>expeditionRequests>before,'reload stale quota');
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'reloaded document');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});clock=Date.parse('2026-10-10T04:50:03+08:00');model.burst=6;Math.random=()=>0;renderExp();`);
      await evaluate(source);
      await drive(`${confirmed}.length===1&&model.burst===0`,'fresh allowance caught up');
      assert.equal(await evaluate(`${confirmed}[0].route`),'深渊远征');
      assert.equal(await evaluate(`${confirmed}[0].normal`),0);
      assert.equal(await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('log-summary').textContent.includes('钻石 0')`),true,'队伍变化不能虚构钻石收入');
    });
    await t.test('夜间回归：日志写入失败不阻断奇遇', async () => {
      await setup(`window.clock=Date.parse('2026-10-10T10:00:00+08:00');Date.now=()=>clock;
        const originalAdd=IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add=function(value){if(this.name==='events')throw new DOMException('full','QuotaExceededError');return originalAdd.call(this,value);};
        choices(['修为 +1','钻石 +2']);`);
      await drive(`clicks.length===1`,'storage-full automation continues');
      assert.deepEqual(await clickLog(),[1]);
      await until(()=>evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('log-summary').textContent.includes('日志存储失败')`),'async storage failure is displayed');
      assert.match(await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('log-summary').textContent`),/日志存储失败/);
    });

    await t.test('秘境接续优化：逐节通关后网页允许扫荡时立即完成今日剩余次数', async () => {
      await setupDungeon(`dm.sweep=true;dm.remaining=4;dm.manualCooldownMinutes=0;dm.current={node:7,id:'existing-run',name:'坠星古墓'};`,'/cultivate/dungeon');
      const start=await evaluate('clock');
      await drive(`dm.remaining===0 && ${dungeonState}.lastSweep && location.pathname==='/cultivate'`, 'complete remaining quota without artificial wait',35);
      assert.ok(await evaluate('clock')-start<60000);
      assert.deepEqual(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').map(c=>c[1].times)`),[4]);
      assert.deepEqual(await evaluate(`dm.calls.filter(c=>c[0]==='choose').map(c=>c[1].nodeIndex)`),[7]);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),0);
    });
    await t.test('秘境接续优化：网页仍冷却、扫荡被禁用或次数耗尽时不提前扫荡', async () => {
      for(const code of [`dm.manualCooldownMinutes=40;`,`dm.manualCooldownMinutes=0;dm.sweepDisabled=true;`,
        `dm.manualCooldownMinutes=0;dm.remaining=0;`]) {
        await setupDungeon(`dm.sweep=true;dm.remaining=4;dm.current={node:7,id:'existing-run',name:'坠星古墓'};${code}`,'/cultivate/dungeon');
        await drive(`!dm.current && location.pathname==='/cultivate'`, 'respect server gate');
        await pulse(60000);
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').length`),0);
      }
    });
    await t.test('秘境接续优化：扫荡回执有未完节点但页面遗漏时刷新一次再接续', async () => {
      await setupDungeon(`dm.sweep=true;dm.sweepFetch=true;dm.sweepCompleted=2;dm.sweepPartial=true;dm.sweepStateDelayed=true;
        dm.sweepResponse={dungeonName:'坠星古墓',trips:[{finished:true},{finished:true},{finished:false}],activeRunId:'sweep-partial',stopReason:'路线中断'};`);
      await drive(`${dungeonState}.lastSweep && !dm.current && location.pathname==='/cultivate'`, 'refresh missing partial state and continue',85);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='refresh').length`),1);
      assert.deepEqual(await evaluate(`dm.calls.filter(c=>c[0]==='choose').map(c=>c[1].nodeIndex)`),[3,4,5,6,7]);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').length`),1);
      assert.equal(await evaluate(`${dungeonState}.lastSweep.partial`),true);
    });
    await t.test('秘境接续优化：未完节点读取失败时保留批次，不把完成回执当作通关', async () => {
      await setupDungeon(`dm.sweep=true;dm.sweepFetch=true;dm.sweepCompleted=2;dm.sweepPartial=true;dm.sweepStateDelayed=true;dm.refreshMode='failed';
        dm.sweepResponse={dungeonName:'坠星古墓',trips:[{finished:true},{finished:true},{finished:false}],activeRunId:'sweep-partial',stopReason:'路线中断'};`);
      await drive(`dm.calls.some(c=>c[0]==='refresh')`, 'one read of missing partial state',45);
      await pulse(5000);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1')).receipt.partial`),true);
      assert.equal(await evaluate(`${dungeonState}.lastSweep`),undefined);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='choose'||c[0]==='enter').length`),0);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').length`),1);
    });
    await t.test('秘境接续优化：读取之后才到达的扫荡回执允许再核对一次实际节点', async () => {
      await setupDungeon(`dm.sweep=true;dm.remaining=0;dm.refreshedCurrent={node:6,id:'late-partial',name:'坠星古墓'};
        sessionStorage.setItem('arkengine:auto-dungeon:pending:v1',JSON.stringify({phase:'submitted',action:'sweep',times:5,
          at:clock-60000,refreshed:true,receipt:{status:200,at:clock-1000,completed:4,partial:true,stopReason:'原节点待处理'}}));`,'/cultivate/dungeon');
      await drive(`${dungeonState}.lastSweep && !dm.current && location.pathname==='/cultivate'`, 'late receipt permits fresh state read',35);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='refresh').length`),1);
      assert.deepEqual(await evaluate(`dm.calls.filter(c=>c[0]==='choose').map(c=>c[1].nodeIndex)`),[6,7]);
      assert.equal(await evaluate(`dm.calls.some(c=>c[0]==='enter'||c[0]==='sweep')`),false);
    });
    const sweepIncomeTotals=`(await window.__arkTestLogs.read('cultivate',undefined,Infinity)).totals`;
    const sweepIncomeBody={dungeonName:'坠星古墓',trips:Array.from({length:5},()=>({finished:true,rewards:{exp:38436,diamonds:52,tokens:1.25,stamina:96}})),
      activeRunId:null,stopReason:'已完成5次'};
    await t.test('秘境收益：五次扫荡实发金额进入修仙总收入，结果区丢失、重复回执与刷新不重记',async()=>{
      await setupDungeon(`dm.sweep=true;dm.sweepFetch=true;dm.hideSweepResult=true;dm.sweepResponse=${JSON.stringify(sweepIncomeBody)};`);
      await drive(`${dungeonState}.lastSweep && location.pathname==='/cultivate'`,'confirmed sweep income');
      await until(()=>evaluate(`${sweepIncomeTotals}['钻石']===260`),'income transaction');
      const totals=await evaluate(sweepIncomeTotals);
      assert.equal(totals['修为'],192180);assert.equal(totals['代币'],6.25);assert.equal(totals['灵力'],480);
      assert.equal(totals['秘境扫荡通关'],5);assert.equal(totals['秘境扫荡修为'],192180);
      assert.match(await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('log-summary').textContent`),/修仙：钻石 260 · 代币 6\.25/);
      await evaluate(`fetch('/api/cultivation/dungeons',{method:'POST',body:JSON.stringify({...dm.calls.find(c=>c[0]==='sweep')[1],idempotencyKey:dm.calls.find(c=>c[0]==='sweep')[2]})});persistDun();`);
      await cdp.send('Page.navigate',{url:origin+'/cultivate?dungeon-fixture=income-reload'},tab.sessionId);
      await until(()=>evaluate(`location.search==='?dungeon-fixture=income-reload'&&typeof renderDun==='function'&&!window.__arkTestLogs`),'income reload');
      await evaluate(source);await pulse(1000);
      assert.equal(await evaluate(`${sweepIncomeTotals}['修为']`),192180);
      assert.equal(await evaluate(`(await window.__arkTestLogs.read('cultivate',undefined,Infinity)).counts['dungeon-sweep-income']`),1);
    });
    await t.test('秘境收益：两趟完成加半途接续，节点与最终累计不能重复入账',async()=>{
      const body={dungeonName:'坠星古墓',trips:[{finished:true,rewards:{exp:100,diamonds:20}},
        {finished:true,rewards:{exp:100,diamonds:20}},{finished:false,rewards:{exp:900,diamonds:50}}],activeRunId:'sweep-partial',stopReason:'中断'};
      await setupDungeon(`dm.sweep=true;dm.sweepFetch=true;dm.sweepCompleted=2;dm.sweepPartial=true;
        dm.sweepResponse=${JSON.stringify(body)};dm.finalReward='修为 +1000 · 钻石 +60';`);
      await drive(`${dungeonState}.lastSweep && !dm.current && location.pathname==='/cultivate'`,'partial final income');
      await until(()=>evaluate(`${sweepIncomeTotals}['修为']===1200`),'completed and continued income');
      assert.equal(await evaluate(`${sweepIncomeTotals}['钻石']`),100);
      assert.equal(await evaluate(`${sweepIncomeTotals}['秘境扫荡通关']`),2);
      assert.equal(await evaluate(`(await window.__arkTestLogs.read('cultivate',undefined,Infinity)).counts['dungeon-reward']`),1);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').length`),1);
    });
    await t.test('秘境收益：奖励缺失标记待核对，失败或请求不匹配不记金额',async()=>{
      for(const mode of ['missing','rejected','mismatch']){
        const body=mode==='missing'?{...sweepIncomeBody,trips:[{finished:true},{finished:true,rewards:{exp:100,diamonds:20}}]}:sweepIncomeBody;
        await setupDungeon(`dm.sweep=true;dm.sweepFetch=true;dm.hideSweepResult=true;dm.sweepResponse=${JSON.stringify(body)};`+
          (mode==='missing'?`dm.sweepCompleted=2;`:mode==='rejected'?`dm.sweepStatus=400;dm.sweepResponse={error:'今日次数已用完'};`:
          `dm.sweepRequestOverride={idempotencyKey:'mismatched-income'};`));
        await drive(`dm.calls.some(c=>c[0]==='sweep')&&!dm.busy`,'sweep income boundary '+mode);await pulse(1000);
        const totals=await evaluate(sweepIncomeTotals);
        assert.equal(totals['修为']||0,mode==='missing'?100:0,mode);
        assert.equal(totals['钻石']||0,mode==='missing'?20:0,mode);
        assert.equal(totals['秘境金额待核对']||0,mode==='missing'?1:0,mode);
      }
    });
    await t.test('秘境收益：日志未提交就跨日刷新，按原确认日补交一次，不算今日新收入',async()=>{
      await setupDungeon(`clock=Date.parse('2026-10-10T23:59:00+08:00');dm.sweep=true;dm.sweepFetch=true;dm.sweepResponse=${JSON.stringify(sweepIncomeBody)};`);
      await evaluate(`const append=window.__arkTestLogs.append;window.__arkTestLogs.append=(event,...args)=>
        event.type==='dungeon-sweep-income'?new Promise(()=>{}):append(event,...args);`);
      await drive(`${dungeonState}.lastSweep && location.pathname==='/cultivate'`,'queued income before refresh');
      const outbox=await evaluate(`sessionStorage.getItem('arkengine:auto-log:v1:cultivate:outbox')`);
      assert.equal(JSON.parse(outbox).filter(e=>e.type==='dungeon-sweep-income').length,1);
      await evaluate('persistDun();');
      await cdp.send('Page.navigate',{url:origin+'/cultivate?dungeon-fixture=income-midnight'},tab.sessionId);
      await until(()=>evaluate(`location.search==='?dungeon-fixture=income-midnight'&&typeof renderDun==='function'&&!window.__arkTestLogs`),'midnight reload');
      await evaluate(`clock=Date.parse('2026-10-11T00:01:00+08:00');`);await evaluate(source);
      const yesterday=`(await window.__arkTestLogs.read('cultivate','2026-10-10',Infinity))`;
      await until(()=>evaluate(`${yesterday}.totals['钻石']===260`),'yesterday income delivered');
      assert.equal(await evaluate(`${yesterday}.counts['dungeon-sweep-income']`),1);
      assert.equal(await evaluate(`${sweepIncomeTotals}['钻石']||0`),0);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-log:v1:cultivate:outbox')).length`),0);
    });
    await t.test('秘境回执：成功响应持久保存，页面刷新丢失结果区后仍能收尾', async () => {
      await setupDungeon(`dm.sweep=true;dm.sweepFetch=true;dm.hideSweepResult=true;`);
      await drive(`dm.calls.some(c=>c[0]==='sweep')`, 'sweep sent');
      await until(()=>evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1'))?.receipt?.status===200`),'durable sweep receipt');
      assert.equal(await evaluate('dm.sameFetchPromise && dm.responseUnused'),true);
      const before=await evaluate('clock');
      await cdp.send('Page.navigate',{url:`${origin}/cultivate/dungeon?dungeon-fixture=durable-receipt`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?dungeon-fixture=durable-receipt' && typeof renderDun==='function'`),'reload receipt');
      await evaluate(`clock=${before+3000};Math.random=()=>0;renderDun();`);await evaluate(source);
      await drive(`${dungeonState}.lastSweep && location.pathname==='/cultivate'`, 'receipt settles after reload');
      assert.equal(await evaluate(`${dungeonState}.lastSweep.completed`),5);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').length`),1);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1'))`),null);
    });
    await t.test('秘境回执：扫荡成功后状态读取失败仍收尾，明确拒绝解除待确认', async () => {
      for(const rejected of [false,true]) {
        await setupDungeon(`dm.sweep=true;dm.sweepFetch=true;dm.hideSweepResult=true;dm.sweepAfterError=true;`+
          (rejected?`dm.sweepStatus=400;dm.sweepResponse={error:'上次路线已失效，请重新探索'};`:''));
        await drive(`${dungeonState}.${rejected?'lastRejectedSweep':'lastSweep'} && location.pathname==='/cultivate'`, 'settled sweep releases hall');
        assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1'))`),null);
        await pulse(10000);
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').length`),1);
        assert.equal(await evaluate('dm.runs'),rejected?0:5);
      }
    });
    await t.test('秘境回执：不匹配请求和畸形成功响应不能清除未知批次', async () => {
      for(const code of [`dm.sweepRequestOverride={idempotencyKey:'other-request'};`,
        `dm.sweepResponse={dungeonName:'其他秘境',trips:[],activeRunId:null,stopReason:'结束'};`,
        `dm.sweepResponse={dungeonName:'坠星古墓',trips:[{finished:'true'}],activeRunId:null,stopReason:'结束'};`]) {
        await setupDungeon(`dm.sweep=true;dm.sweepFetch=true;dm.hideSweepResult=true;${code}`);
        await drive(`dm.calls.some(c=>c[0]==='sweep') && !dm.busy`, 'invalid receipt');
        await pulse(5000);
        assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1')).receipt`),undefined);
        assert.equal(await evaluate(`${dungeonState}.lastSweep`),undefined);
      }
    });
    await t.test('秘境扫荡冷却：等待网页明确倒计时，不按五分钟反复切页', async () => {
      await setupDungeon(`dm.sweep=true;dm.sweepDisabled=true;dm.cooledUntil=clock+37*60000;dm.cooldownLabel='秘境冷却 37:00';`,'/cultivate/dungeon');
      const before=await evaluate('clock');
      await drive(`location.pathname==='/cultivate'`, 'sweep cooldown yields');
      assert.ok(await evaluate(`${dungeonState}.nextAt`)>=before+37*60000);
      const visits=await evaluate('dm.calls.length');await pulse(6*60000);
      assert.equal(await evaluate('dm.calls.length'),visits);
    });
    await t.test('秘境回执：暂时服务器错误和损坏保存记录不冒认已完成', async () => {
      await setupDungeon(`dm.sweep=true;dm.sweepFetch=true;dm.sweepStatus=500;dm.sweepResponse={error:'暂时无法处理'};`);
      await drive(`dm.calls.some(c=>c[0]==='sweep') && !dm.busy`, 'server failure');
      await pulse(5000);
      assert.ok(await evaluate('nativeDun()'));
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1')).receipt`),undefined);
      await setupDungeon(`dm.sweep=true;sessionStorage.setItem('arkengine:auto-dungeon:pending:v1',JSON.stringify({phase:'submitted',action:'sweep',times:5,at:clock,
        receipt:{status:200,at:clock,completed:99,partial:false,stopReason:'错误数据'}}));`,'/cultivate/dungeon');
      await pulse(5000);
      assert.equal(await evaluate('dm.calls.length'),0);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1')).receipt.completed`),99);
    });
    const orphanDungeon = `localStorage.setItem('arkengine:auto-dungeon:state:v1',JSON.stringify({quotaResetHour:4,nextAt:0,run:{step:3,beforeResult:'旧记录'},stalls:2}));`;
    await t.test('秘境孤立进度：只读刷新确认空闲后归档，恢复五次扫荡', async () => {
      await setupDungeon(orphanDungeon+`dm.sweep=true;`, '/cultivate/dungeon');
      await drive(`${dungeonState}.lastSweep && location.pathname==='/cultivate'`, 'orphan cleared and swept');
      assert.equal(await evaluate('dm.runs'),5);
      assert.equal(await evaluate(`${dungeonState}.lastReconciledRun.run.step`),3);
      assert.equal(await evaluate(`${dungeonState}.lastReconciledRun.outcome`),'unknown');
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='refresh').length`),1);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter'||c[0]==='choose').length`),0);
      assert.deepEqual(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').map(c=>c[1])`),[{action:'sweep',sourceRunId:'previous-route',times:5}]);
      await pulse(2*3600000);
      assert.equal(await evaluate('dm.runs'),5,'当天用完后不重发批次');
    });
    await t.test('秘境孤立进度：刷新失败或未完成不清旧记录，发现当前探索则接续', async () => {
      for(const mode of ['failed','pending','unobserved']) {
        await setupDungeon(orphanDungeon+`dm.sweep=true;dm.refreshMode='${mode}';`, '/cultivate/dungeon');
        await drive(`dm.calls.some(c=>c[0]==='refresh')`, 'refresh orphan');
        await pulse(5000);
        assert.equal(await evaluate(`${dungeonState}.run.step`),3);
        assert.equal(await evaluate(`${dungeonState}.lastReconciledRun`),undefined);
        assert.equal(await evaluate('dm.runs'),0);
      }
      await setupDungeon(orphanDungeon+`dm.sweep=true;dm.refreshedCurrent={node:3,id:'old-run',name:'坠星古墓'};`, '/cultivate/dungeon');
      await drive(`dm.calls.some(c=>c[0]==='choose')`, 'continue actual active run');
      assert.equal(await evaluate(`${dungeonState}.lastReconciledRun`),undefined);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').length`),0);
    });
    await t.test('秘境扫荡：按剩余次数和服务端控件上限选择，提前停止不立即重买', async () => {
      for (const [remaining,max,expected] of [[3,3,3],[5,1,1],[8,8,5]]) {
        await setupDungeon(`dm.sweep=true;dm.remaining=${remaining};dm.limit=10;dm.sweepMax=${max};dm.sweepCompleted=0;dm.sweepReason='资源不足';`);
        await drive(`${dungeonState}.lastSweep && location.pathname==='/cultivate'`, 'sweep stops early');
        assert.equal(await evaluate(`dm.calls.find(c=>c[0]==='sweep')[1].times`),expected);
        assert.equal(await evaluate(`${dungeonState}.lastSweep.completed`),0);
        await pulse(10000);
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').length`),1);
      }
    });
    await t.test('秘境扫荡：中断后接续原节点，不重发扫荡或入场', async () => {
      await setupDungeon(`dm.sweep=true;dm.sweepCompleted=2;dm.sweepPartial=true;dm.sweepReason='路线中断';`);
      await drive(`${dungeonState}.lastSweep && !dm.current && location.pathname==='/cultivate'`, 'finish interrupted trip');
      assert.equal(await evaluate(`${dungeonState}.lastSweep.completed`),2);
      assert.equal(await evaluate(`${dungeonState}.lastSweep.partial`),true);
      assert.deepEqual(await evaluate(`dm.calls.filter(c=>c[0]==='choose').map(c=>c[1].nodeIndex)`),[3,4,5,6,7]);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').length`),1);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),0);
    });
    await t.test('秘境扫荡：未知结果跨刷新仅恢复同一原请求', async () => {
      await setupDungeon(`dm.sweep=true;dm.mode='sweep';`);
      await drive(`nativeDun() && !dm.busy`, 'sweep pending');
      const original=await evaluate('nativeDun()');
      const now=await evaluate('clock');
      await cdp.send('Page.navigate',{url:`${origin}/cultivate/dungeon?dungeon-fixture=sweep-reload`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?dungeon-fixture=sweep-reload' && typeof renderDun==='function' && !document.getElementById('ark-auto-expedition')`),'reload sweep');
      await evaluate(`clock=${now+31000};Math.random=()=>0;renderDun();`);
      await evaluate(source);
      await drive(`${dungeonState}.lastSweep && location.pathname==='/cultivate'`, 'recover sweep');
      assert.equal(await evaluate('dm.runs'),5);
      const calls=await evaluate(`dm.calls.filter(c=>c[0]==='sweep'||c[0]==='recover')`);
      assert.equal(calls.length,2);
      assert.deepEqual(calls.map(c=>c[2]),[original.idempotencyKey,original.idempotencyKey]);
      assert.deepEqual(calls[1][1],original.input);
    });
    await t.test('秘境扫荡：手动原单、手动弹窗、费用变更和暂停不越过', async () => {
      for(const code of [
        `sessionStorage.setItem('dungeon:77',JSON.stringify({input:{action:'sweep',sourceRunId:'manual',times:5},idempotencyKey:'manual'}));`,
        `openSweep();`,
        `localStorage.setItem('arkengine:auto-dungeon:enabled:v1','false');`
      ]) {
        await setupDungeon(`dm.sweep=true;${code}`, '/cultivate/dungeon');
        await pulse(10000);
        assert.equal(await evaluate(`dm.calls.some(c=>['sweep','recover','enter'].includes(c[0]))`),false);
      }
      await setupDungeon(`dm.sweep=true;`);
      await drive(`!!document.querySelector('[role="alertdialog"]')`, 'sweep confirm');
      await evaluate(`document.querySelector('[role="alertdialog"] div').textContent='连续进入坠星古墓 5 次，费用改为5000钻石';`);
      await pulse(10000);
      assert.equal(await evaluate(`dm.calls.some(c=>c[0]==='sweep')`),false);
    });
    await t.test('秘境扫荡：确认等待期间弹窗被同名手动窗口替换时不提交', async () => {
      await setupDungeon(`dm.sweep=true;`);
      await drive(`!!document.querySelector('[role="alertdialog"]')`, 'sweep dialog');
      await drive(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('秒后确认按上次路线')`, 'confirm queued');
      await evaluate(`document.querySelector('[role="alertdialog"]').remove();openSweep();`);
      await pulse(5000);
      assert.equal(await evaluate(`dm.calls.some(c=>c[0]==='sweep')`),false);
    });
    await t.test('秘境扫荡：丢失回执且无原请求时保留未知批次，不再次购买门票', async () => {
      await setupDungeon(`dm.sweep=true;dm.mode='sweep';`);
      await drive(`nativeDun() && !dm.busy`, 'sweep unknown');
      await evaluate(`sessionStorage.removeItem('dungeon:77');dm.sweepResult=null;renderDun();`);
      await pulse(31000);
      await drive(`dm.calls.some(c=>c[0]==='refresh')`, 'refresh unknown batch');
      await pulse(91000);
      await drive(`location.pathname==='/cultivate'`, 'unknown batch yields');
      assert.equal(await evaluate(`${dungeonState}.lastSweep`),undefined);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1')).action`),'sweep');
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='sweep').length`),1);
    });

    await t.test('秘境：先完成当前奇遇，再探索八节，返回主殿并持久保存随机冷却', async () => {
      await setupDungeon(`dm.encounter=true; dm.recent='旧探索记录'; dm.message='秘境探索完成，本次累计：旧奖励';`);
      await drive(`dm.runs === 1 && !dm.current && location.pathname === '/cultivate'`, 'one dungeon round');
      const calls = await evaluate('dm.calls');
      assert.deepEqual(calls[0], ['encounter', 1]);
      assert.deepEqual(calls.filter(c => c[0] === 'open'), [['open', '坠星古墓']]);
      assert.deepEqual(calls.filter(c => c[0] === 'choose').map(c => c[1].choiceKey),
        [2, 1, 1, 0, 1, 2, 1, 2].map(i => `choice-${i}`));
      assert.equal(calls.some(c => ['retreat','preview'].includes(c[0])), false);
      const state = await evaluate(dungeonState);
      const completion = await evaluate(`Number(dm.recent.split('完成于 ')[1])`);
      assert.equal(state.nextAt, completion + 40 * 60000 + 2000, '确认服务端完成后抽取40分钟间隔');
      assert.equal(state.run, null);
      await evaluate(`clock = ${state.nextAt - 1}; dm.encounter=true; renderDun();`);
      await drive(`dm.calls.filter(c=>c[0]==='encounter').length === 2`, 'encounters continue between runs');
      // 重新载入脚本后的时间不得被重置，回主殿仍等待同一截止时间。
      await evaluate(`clock = ${state.nextAt - 30000}; persistDun();`);
      await cdp.send('Page.navigate', { url: `${origin}/cultivate?dungeon-fixture=reload` }, tab.sessionId);
      await until(() => evaluate(`location.search === '?dungeon-fixture=reload' && typeof renderDun === 'function'`), 'reload cooldown');
      await evaluate(`clock = ${state.nextAt - 30000}; Math.random=()=>0;`);
      await evaluate(source);
      await drive(`location.pathname==='/activities/expedition'`, 'cooldown returns to expedition');
      assert.equal(await evaluate(`${dungeonState}.nextAt`), state.nextAt);
      assert.equal(await evaluate('dm.runs'), 1);
    });
    await t.test('秘境：五轮循环后停止入场，次日重新读取页面次数', async () => {
      await setupDungeon();
      for (let i=1; i<=5; i++) {
        await drive(`dm.runs === ${i} && !dm.current && location.pathname === '/cultivate'`, `dungeon round ${i}`);
        assert.equal(await evaluate('dm.remaining'), 5-i);
        if(i<5) await evaluate(`clock = ${dungeonState}.nextAt + 1; renderDun();`);
      }
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='choose').length`),40);
      await pulse(3*3600000);
      assert.equal(await evaluate('location.pathname'),'/cultivate');
      assert.equal(await evaluate('dm.runs'),5);
      await evaluate(`clock=Date.parse('2026-10-11T04:00:01+08:00'); dm.remaining=5; dm.cooledUntil=0; renderDun();`);
      await drive(`dm.runs===6`, 'new-day allowance');
    });
    await t.test('4点刷新：秘境零点不重入，4点读到新次数后恢复探索', async () => {
      await setupDungeon(`clock=Date.parse('2026-10-10T23:55:00+08:00');dm.remaining=0;`, '/cultivate/dungeon');
      await drive(`location.pathname==='/cultivate'`, 'quota exhausted returns');
      assert.equal(await evaluate(`${dungeonState}.exhaustedDay`),'2026-10-10');
      const visits=await evaluate(`dm.calls.filter(call=>call[0]==='navigate'&&call[1]==='/cultivate/dungeon').length`);
      await evaluate(`clock=Date.parse('2026-10-11T00:00:01+08:00');renderDun();`);
      await pulse(10000);
      assert.equal(await evaluate(`dm.calls.filter(call=>call[0]==='navigate'&&call[1]==='/cultivate/dungeon').length`), visits);
      await evaluate(`clock=Date.parse('2026-10-11T03:59:50+08:00');renderDun();`);
      await pulse(1000);
      assert.equal(await evaluate(`dm.calls.filter(call=>call[0]==='navigate'&&call[1]==='/cultivate/dungeon').length`), visits);
      await evaluate(`clock=Date.parse('2026-10-11T04:00:00+08:00');dm.remaining=5;renderDun();`);
      await drive('dm.runs===1', '4am allowance');
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),1);
    });
    await t.test('4点刷新：额度仍为零不入场，原有冷却不因跨日缩短', async () => {
      await setupDungeon(`clock=Date.parse('2026-10-11T03:58:00+08:00');dm.remaining=0;`, '/cultivate/dungeon');
      await drive(`location.pathname==='/cultivate'`, 'before reset');
      await evaluate(`clock=Date.parse('2026-10-11T04:00:00+08:00');renderDun();`);
      await drive(`${dungeonState}.exhaustedDay==='2026-10-11'&&location.pathname==='/cultivate'`, 'server still zero');
      assert.equal(await evaluate('dm.runs'),0);
      await setupDungeon(`clock=Date.parse('2026-10-11T03:58:00+08:00');
        localStorage.setItem('arkengine:auto-dungeon:state:v1',JSON.stringify({quotaResetHour:4,exhaustedDay:'2026-10-10',nextAt:Date.parse('2026-10-11T04:30:00+08:00'),run:null}));`);
      await evaluate(`clock=Date.parse('2026-10-11T04:00:00+08:00');renderDun();`);
      await pulse(5000);
      assert.equal(await evaluate(`dm.calls.filter(call=>call[0]!=='navigate'||call[1]==='/cultivate/dungeon').length`),0);
      await evaluate(`clock=Date.parse('2026-10-11T04:30:00+08:00');renderDun();`);
      await drive('dm.runs===1','keep existing cooldown');
    });
    await t.test('4点刷新：旧零点耗尽标记迁移后重新核对，不清除暂停或待确认入场', async () => {
      await setupDungeon(`clock=Date.parse('2026-10-11T06:00:00+08:00');
        localStorage.setItem('arkengine:auto-dungeon:state:v1',JSON.stringify({exhaustedDay:'2026-10-11',nextAt:0,run:null}));`);
      await drive('dm.runs===1','legacy quota checked');
      await setupDungeon(`clock=Date.parse('2026-10-11T06:00:00+08:00');
        localStorage.setItem('arkengine:auto-dungeon:enabled:v1','false');
        localStorage.setItem('arkengine:auto-dungeon:state:v1',JSON.stringify({exhaustedDay:'2026-10-11',nextAt:0,run:null,stalls:3}));
        sessionStorage.setItem('arkengine:auto-dungeon:pending:v1',JSON.stringify({phase:'submitted',action:'enter',at:clock-3600000,refreshed:true}));`);
      await pulse(10000);
      assert.equal(await evaluate(`dm.calls.filter(call=>call[0]!=='navigate').length`),0);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-dungeon:enabled:v1')`),'false');
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1')).action`),'enter');
    });
    await t.test('秘境入场核对：明确次数耗尽且原请求清除时回主殿等4点', async () => {
      await setupDungeon(`clock=Date.parse('2026-10-11T00:01:00+08:00');dm.mode='quota-rejected';`);
      await drive(`dm.calls.some(c=>c[0]==='enter')&&location.pathname==='/cultivate'`, 'definite quota rejection');
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1'))`),null);
      assert.equal(await evaluate(`${dungeonState}.exhaustedDay`),'2026-10-10');
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-dungeon:enabled:v1')`),'false');
      assert.equal(await evaluate('dm.runs'),0);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='refresh').length`),1,'网页次数未更新时只读核对一次');
      await evaluate(`clock=Date.parse('2026-10-11T04:00:00+08:00');dm.mode='';dm.remaining=5;dm.error=false;dm.message='';renderDun();`);
      await drive('dm.runs===1','retry with actual new quota');
    });
    await t.test('秘境入场核对：次数为零但结果不明仍保留原操作，日志记录原因', async () => {
      await setupDungeon(`dm.remaining=0;dm.message='网络结果未确认';dm.error=true;
        sessionStorage.setItem('arkengine:auto-dungeon:pending:v1',JSON.stringify({phase:'submitted',action:'enter',at:clock,refreshed:true}));`, '/cultivate/dungeon');
      await pulse(2000);
      await pulse(91000);
      await drive(`location.pathname==='/cultivate'`,'ambiguous result yields hall');
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1')).action`),'enter');
      assert.equal(await evaluate('dm.runs'),0);
      assert.ok(await evaluate(`${logBucket()}.events.some(e=>e.type==='dungeon-deferred'&&e.data.error==='网络结果未确认'&&e.data.quota.remaining===0)`));
    });
    const staleDungeonEntry = `
      localStorage.setItem('arkengine:auto-dungeon:enabled:v1','true');
      localStorage.setItem('arkengine:auto-dungeon:state:v1',JSON.stringify({quotaResetHour:4,nextAt:0,run:{step:0,beforeResult:'旧结果'},stalls:3}));
      sessionStorage.setItem('arkengine:auto-dungeon:pending:v1',JSON.stringify({phase:'submitted',action:'enter',at:clock-8*3600000,refreshed:true,
        original:{key:'dungeon:77',value:{input:{action:'enter',dungeonId:9},idempotencyKey:'original-entry'}}}));`;
    const dungeonPending = `JSON.parse(sessionStorage.getItem('arkengine:auto-dungeon:pending:v1'))`;
    await t.test('秘境旧入场：升级后自动刷新核对并归档，继续正常探索', async () => {
      await setupDungeon(staleDungeonEntry, '/cultivate/dungeon');
      const original=await evaluate(`${dungeonPending}.original`);
      await drive(`${dungeonState}.lastReconciledEntry`, 'fresh idle state reconciles stale entry');
      assert.equal(await evaluate(dungeonPending),null);
      assert.equal(await evaluate(`${dungeonState}.run`),null);
      assert.deepEqual(await evaluate(`${dungeonState}.lastReconciledEntry.plan.original`),original);
      assert.equal(await evaluate('dm.runs'),0,'刷新核对本身不入场');
      assert.ok(await evaluate(`${logBucket()}.events.some(e=>e.type==='dungeon-entry-reconciled'&&e.data.outcome==='unknown')`));
      await drive('dm.runs===1','normal scheduling resumes without manual confirmation');
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),1);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='refresh').length`),1);
    });
    await t.test('秘境旧入场：刷新未完成、失败或未观察到加载时保留记录', async () => {
      for (const mode of ['pending','failed','unobserved']) {
        await setupDungeon(staleDungeonEntry+`dm.refreshMode='${mode}';`, '/cultivate/dungeon');
        const original=await evaluate(`${dungeonPending}.original`);
        await drive(`dm.calls.some(c=>c[0]==='refresh')`,'one native refresh');
        await pulse(5000);
        assert.deepEqual(await evaluate(`${dungeonPending}.original`),original);
        assert.equal(await evaluate(`${dungeonState}.lastReconciledEntry`),undefined);
        assert.equal(await evaluate('dm.runs'),0);
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='refresh').length`),1);
      }
    });
    await t.test('秘境旧入场：已有探索、原请求、弹窗或非入场记录时不归档', async () => {
      for (const code of [
        `dm.current={node:0,id:'running',name:'坠星古墓'};`,
        `dm.mode='busy:enter';sessionStorage.setItem('dungeon:77',JSON.stringify(${dungeonPending}.original.value));`,
        `openDun();`,
        `sessionStorage.setItem('arkengine:auto-dungeon:pending:v1',JSON.stringify({phase:'submitted',action:'choose',step:1,at:clock,refreshed:true}));`
      ]) {
        await setupDungeon(staleDungeonEntry+code,'/cultivate/dungeon');
        for(let i=0;i<5;i++) await pulse();
        assert.equal(await evaluate(`${dungeonState}.lastReconciledEntry`),undefined);
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='refresh').length`),0);
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),0);
      }
    });
    await t.test('秘境旧入场：刷新后出现探索则接续原探索，不归档或重入', async () => {
      await setupDungeon(staleDungeonEntry+`dm.refreshedCurrent={node:0,id:'running',name:'坠星古墓'};`,'/cultivate/dungeon');
      await drive('dm.current && dm.current.node===1','continue original active run');
      assert.equal(await evaluate(`${dungeonState}.lastReconciledEntry`),undefined);
      assert.equal(await evaluate('dm.runs'),0);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),0);
    });
    await t.test('秘境旧入场：核对期间出现原请求或错误时不归档', async () => {
      for(const code of [
        `sessionStorage.setItem('dungeon:77',JSON.stringify(${dungeonPending}.original.value));dm.mode='busy:enter';`,
        `dm.error=true;dm.message='秘境状态读取失败';`
      ]) {
        await setupDungeon(staleDungeonEntry+`dm.refreshMode='pending';`,'/cultivate/dungeon');
        const original=await evaluate(`${dungeonPending}.original`);
        await drive(`dm.calls.some(c=>c[0]==='refresh')`,'refresh pending');
        await evaluate(`${code}dm.refreshing=false;renderDun();`);
        await pulse(5000);
        assert.equal(await evaluate(`${dungeonState}.lastReconciledEntry`),undefined);
        assert.deepEqual(await evaluate(`${dungeonPending}.original`),original);
        assert.equal(await evaluate('dm.runs'),0);
      }
    });

    await t.test('秘境旧入场：暂停不自动恢复，未完成核对跨刷新不重复请求', async () => {
      await setupDungeon(staleDungeonEntry+`localStorage.setItem('arkengine:auto-dungeon:enabled:v1','false');`,'/cultivate/dungeon');
      await pulse(5000);
      assert.deepEqual(await evaluate('dm.calls'),[]);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('dungeon-toggle').click()`);
      await drive(`${dungeonState}.lastReconciledEntry`,'explicit enable resumes verification');
      await setupDungeon(staleDungeonEntry+`dm.refreshMode='unobserved';`,'/cultivate/dungeon');
      await drive(`dm.calls.some(c=>c[0]==='refresh')`,'unverified refresh');
      const original=await evaluate(dungeonPending);
      const before=await evaluate('clock');
      await cdp.send('Page.reload',{},tab.sessionId);
      await until(()=>evaluate(`typeof renderDun==='function' && !document.getElementById('ark-auto-expedition')`),'reload pending review');
      await evaluate(`clock=${before+5000};Math.random=()=>0;renderDun();`);
      await evaluate(source);
      await pulse(35000);
      assert.deepEqual(await evaluate(dungeonPending),original);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='refresh').length`),1);
      assert.equal(await evaluate('dm.runs'),0);
    });
    await t.test('秘境：今日零次数或服务端仍冷却时返回主殿，不扣门票', async () => {
      for (const code of ['dm.remaining=0;', 'dm.cooledUntil=clock+50*60000;']) {
        await setupDungeon(code, '/cultivate/dungeon');
        await drive(`location.pathname==='/cultivate'`, 'blocked dungeon returns');
        assert.equal(await evaluate('dm.runs'),0);
        assert.deepEqual(await evaluate(`dm.calls.filter(c=>['open','enter','choose'].includes(c[0]))`),[]);
      }
    });
    await t.test('秘境：入场条件不足或入口未开放时返回主殿，预约到期后重新检查', async () => {
      for(const code of ['dm.entryBlocked=true;',"dm.entryReason='灵力不足';",'dm.dungeonMissing=true;']) {
        await setupDungeon(code);
        await drive(`dm.calls.filter(c=>c[0]==='navigate').length===2&&location.pathname==='/cultivate'`,'unavailable dungeon returns',15);
        const nextAt=await evaluate(`${dungeonState}.nextAt`);
        assert.ok(nextAt>await evaluate('clock'));
        assert.deepEqual(await evaluate(`dm.calls.filter(c=>['open','enter'].includes(c[0]))`),[]);
        await evaluate('dm.encounter=true;renderDun();');
        await drive(`dm.calls.some(c=>c[0]==='encounter')`,'encounters continue while entry unavailable');
        await evaluate(`clock=${nextAt-10000};renderDun();`);
        await pulse();
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='navigate').length`),2,'预约之前不反复进入秘境');
        await evaluate(`dm.entryBlocked=false;dm.entryReason='';dm.dungeonMissing=false;clock=${nextAt+1};renderDun();`);
        await drive('dm.runs===1','entry condition restored');
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),1);
      }
    });
    await t.test('秘境：最长随机间隔为50分钟，不按固定40分钟立即重入', async () => {
      await setupDungeon(`dm.current={node:7,id:'manual-run',name:'坠星古墓'}; Math.random=()=>0.99999999;`, '/cultivate/dungeon');
      await drive(`!dm.current && location.pathname==='/cultivate'`, 'last node completes');
      const state=await evaluate(dungeonState);
      const finished=await evaluate(`Number(dm.recent.split('完成于 ')[1])`);
      assert.ok(state.nextAt-finished>=50*60000 && state.nextAt-finished<50*60000+5000);
      await pulse(40*60000);
      assert.equal(await evaluate('dm.runs'),0);
    });
    await t.test('秘境：入场与节点请求中断后只恢复原请求，刷新后也不重新买票', async () => {
      for(const mode of ['enter','choose']) {
        await setupDungeon(`dm.mode='${mode}';`);
        await drive(`nativeDun() && !dm.busy`, `pending ${mode}`);
        const pending = await evaluate('nativeDun()');
        const before = await evaluate('clock');
        await cdp.send('Page.navigate', {url:`${origin}/cultivate/dungeon?dungeon-fixture=recover-${mode}`},tab.sessionId);
        await until(()=>evaluate(`location.search==='?dungeon-fixture=recover-${mode}' && typeof renderDun==='function'`),'pending reload');
        await evaluate(`clock=${before+31000}; Math.random=()=>0; dm.mode=''; renderDun();`);
        await evaluate(source);
        await drive(`dm.calls.some(c=>c[0]==='recover') && dm.current`, 'recover original dungeon request');
        const recovered=await evaluate(`dm.calls.find(c=>c[0]==='recover')`);
        assert.equal(recovered[2],pending.idempotencyKey);
        assert.deepEqual(recovered[1],pending.input);
        assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),1);
      }
    });
    await t.test('秘境：不确认手动弹窗或手动遗留请求，未知奖励不猜测', async () => {
      await setupDungeon(`openDun();`, '/cultivate/dungeon');
      await until(async () => (await status())?.includes('手动处理当前弹窗'),'manual dungeon dialog');
      await pulse(10000);
      assert.equal(await evaluate('dm.runs'),0);
      await setupDungeon(`sessionStorage.setItem('dungeon:77',JSON.stringify({input:{action:'enter',dungeonId:10},idempotencyKey:'manual'}));`,'/cultivate/dungeon');
      await until(async ()=>(await status())?.includes('其他秘境原请求'),'manual dungeon request');
      assert.deepEqual(await evaluate('dm.calls'),[]);
      await setupDungeon(`dm.current={node:0,id:'manual-run',name:'坠星古墓'}; dm.malformed=true;`,'/cultivate/dungeon');
      await until(async ()=>(await status())?.includes('秘境奖励无法识别'),'unknown dungeon rewards');
      assert.deepEqual(await evaluate('dm.calls'),[]);
    });
    await t.test('秘境：暂停撤销待点击，恢复后按仍在进行的节点继续', async () => {
      await setupDungeon(`dm.current={node:2,id:'manual-run',name:'坠星古墓'};`,'/cultivate/dungeon');
      await until(async ()=>(await status())?.includes('随机等待'),'queued dungeon choice');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('dungeon-toggle').click()`);
      await pulse(10000);
      assert.deepEqual(await evaluate('dm.calls'),[]);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('dungeon-toggle').click()`);
      await drive(`dm.current.node===3`,'resume dungeon node');
      assert.equal(await evaluate('dm.runs'),0);
    });
    await t.test('秘境：后台普通定时器延迟一分钟时仍由 Worker 完成节点选择', async () => {
      await setupDungeon(`dm.current={node:0,id:'manual-run',name:'坠星古墓'};
        const realTimeout=window.setTimeout.bind(window);
        window.setTimeout=(fn,ms,...args)=>realTimeout(fn,Math.max(ms||0,60000),...args);`,'/cultivate/dungeon');
      const foreground=await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        await until(async ()=>(await status())?.includes('随机等待'),'hidden dungeon queues');
        assert.equal(await evaluate('document.visibilityState'),'hidden');
        await evaluate('clock+=2001');
        await until(()=>evaluate('dm.current.node===1'),'worker selects dungeon choice',6000);
        assert.equal(await evaluate('dm.calls[0][1].choiceKey'),'choice-2');
      } finally {await cdp.send('Target.closeTarget',{targetId:foreground.targetId});}
    });

    await t.test('后台节流回归：远征在普通定时器延迟一分钟时仍可派遣并确认', async () => {
      await setupExp(`
        const originalTimeout = window.setTimeout.bind(window);
        window.setTimeout = (callback, milliseconds, ...args) =>
          originalTimeout(callback, Math.max(milliseconds || 0, 60000), ...args);
      `);
      const foreground = await createTab();
      try {
        await cdp.send('Target.activateTarget', { targetId: foreground.targetId });
        assert.equal(await evaluate('document.visibilityState'), 'hidden');
        await until(async () => (await expStatus())?.includes('随机等待'), 'background expedition queues dispatch', 2500);
        assert.deepEqual(await evaluate('model.calls'), []);
        // 只推进模拟时钟，不触发 focus/DOM；后续步骤必须由 Worker 唤醒。
        await evaluate('clock += 2001');
        await until(() => evaluate(`!!document.querySelector('[role="dialog"]')`), 'worker opens dispatch dialog', 6000);
        await evaluate('clock += 501');
        await until(async () => (await expStatus())?.includes('秒后确认 6 队'), 'worker queues confirmation', 6000);
        await evaluate('clock += 2001');
        await until(() => evaluate(`${confirmed}.length === 1`), 'worker confirms dispatch', 6000);
        assert.equal(await evaluate(`${confirmed}[0].input.eventChoice`), 'complete');
        assert.equal(await evaluate('document.visibilityState'), 'hidden');
      } finally { await cdp.send('Target.closeTarget', { targetId: foreground.targetId }); }
    });

    await t.test('远征：纠正路线/队数/突发开关，确认完整巡逻并循环领取', async () => {
      await setupExp(`model.route = '遗迹勘探'; model.maxTeams = 1; model.allowBurst = true; model.high = false; model.complete = false;`);
      await drive(`${confirmed}.length === 1 && model.runs.length === 6`, 'first patrol');
      let calls = await evaluate(confirmed);
      assert.equal(calls[0].route, '边境巡逻');
      assert.equal(calls[0].total, 6);
      assert.equal(calls[0].burst, 0);
      assert.equal(calls[0].input.eventChoice, 'complete');
      assert.equal(await evaluate('model.burst'), 0);
      await evaluate(`model.runs.forEach(run => run.done = true); renderExp();`);
      await drive(`${confirmed}.length === 2 && model.runs.length === 6`, 'claim and redispatch');
      assert.deepEqual(await evaluate(`model.calls.filter(c => c.type === 'claim').map(c => c.count)`), [6]);
      assert.equal(await evaluate(`model.calls.some(c => c.type === 'manual')`), false);
      assert.equal(await evaluate('model.burst'), 0);
    });
    await t.test('远征：凌晨先补常态巡逻，再并行派六队纯突发深渊', async () => {
      await setupExp(`model.burst=6;clock = Date.parse('2026-10-10T01:10:00+08:00');`);
      await drive(`${confirmed}.length === 2 && model.runs.length === 12`, 'parallel patrol and burst');
      assert.deepEqual(await evaluate(`${confirmed}.map(c => [c.route, c.normal, c.burst])`), [['边境巡逻', 6, 0], ['深渊远征', 0, 6]]);
      assert.equal(await evaluate('model.burst'), 0);
      await evaluate(`model.runs.forEach(run => run.done = true); renderExp();`);
      await drive(`${confirmed}.length === 3 && model.runs.length === 6`, 'burst must not refill on claim');
      for (let i = 0; i < 8; i++) await pulse();
      assert.deepEqual(await evaluate(`${confirmed}.map(c => c.route)`), ['边境巡逻', '深渊远征', '边境巡逻']);
      assert.equal(await evaluate('model.burst'), 0);
    });
    await t.test('远征：已使用过突发额度时不重复派深渊', async () => {
      await setupExp(`clock = Date.parse('2026-10-10T01:00:00+08:00'); addRuns(6); model.burst = 3;`);
      await until(async () => (await expStatus())?.includes('今日突发已使用'), 'used burst');
      for (let i = 0; i < 5; i++) await pulse();
      assert.deepEqual(await evaluate(confirmed), []);
    });
    await t.test('远征：错过凌晨后完整额度补派深渊，领取后不再补派', async () => {
      await setupExp(`model.burst=6;clock = Date.parse('2026-10-10T06:00:00+08:00'); addRuns(6);`);
      await drive(`${confirmed}.length===1 && model.burst===0`, 'catch up unused burst');
      assert.deepEqual(await evaluate(`${confirmed}.map(c=>[c.route,c.normal,c.burst])`),[['深渊远征',0,6]]);
      await evaluate(`model.runs.filter(r=>r.burst).forEach(r=>r.done=true);renderExp();`);
      await drive(`model.runs.length===6`,'claim abyss');
      for(let i=0;i<8;i++)await pulse();
      assert.equal(await evaluate(`${confirmed}.length`),1);
    });
    await t.test('远征：确认弹窗跨过两点仍可补派，跨日则取消旧额度确认', async () => {
      await setupExp(`model.burst=6;clock = Date.parse('2026-10-10T01:59:00+08:00'); addRuns(6); model.route = '深渊远征'; model.allowBurst = true;`);
      await drive(`!!document.querySelector('[role="dialog"]')`, 'burst dialog opened');
      await evaluate(`clock = Date.parse('2026-10-10T02:00:00+08:00'); window.dispatchEvent(new Event('focus'));`);
      await drive(`${confirmed}.length===1 && model.burst===0`, 'confirm catch-up dialog');
      await setupExp(`model.burst=6;clock=Date.parse('2026-10-10T23:59:00+08:00');addRuns(6);model.route='深渊远征';model.allowBurst=true;`);
      await drive(`!!document.querySelector('[role="dialog"]')`, 'late burst dialog');
      await evaluate(`clock=Date.parse('2026-10-11T00:00:00+08:00');window.dispatchEvent(new Event('focus'));`);
      await drive(`!document.querySelector('[role="dialog"]')`, 'cancel previous day dialog');
      assert.deepEqual(await evaluate(confirmed), []);
      assert.equal(await evaluate('model.burst'), 6);
    });
    await t.test('远征：原请求超时只恢复同一请求，不创建第二批', async () => {
      await setupExp(`model.resultMode = 'pending';`);
      await drive(`${confirmed}.length === 1 && !model.busy`, 'pending original request');
      await pulse(31000);
      await drive(`model.calls.some(c => c.type === 'recover') && model.runs.length === 6`, 'recover original');
      const calls = await evaluate('model.calls');
      assert.deepEqual(calls.map(c => c.type), ['dispatch', 'recover']);
      assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
    });
    await t.test('远征：不接管手动请求或手动打开的确认弹窗', async () => {
      await setupExp(`sessionStorage.setItem('expedition:77:auto', JSON.stringify({input:{routeKey:'other'},idempotencyKey:'manual-fixture'}));`);
      await until(async () => (await expStatus())?.includes('存在手动派遣'), 'manual pending');
      assert.deepEqual(await evaluate('model.calls'), []);
      await setupExp();
      await evaluate('openDispatch()');
      await until(async () => (await expStatus())?.includes('处理当前弹窗'), 'manual dialog');
      for (let i = 0; i < 4; i++) await pulse();
      assert.deepEqual(await evaluate('model.calls'), []);
    });
    await t.test('远征：等待期间暂停会撤销派遣', async () => {
      await setupExp();
      await until(async () => (await expStatus())?.includes('随机等待'), 'queued dispatch');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click()`);
      await pulse(10000);
      assert.deepEqual(await evaluate('model.calls'), []);
      assert.equal(await evaluate('model.opens'), 0);
    });
    await t.test('远征：登录或限流错误停止自动操作', async () => {
      await setupExp(`model.error = true; model.message = '429 请求过于频繁';`);
      await until(async () => (await expStatus())?.includes('异常，已暂停'), 'expedition error stop');
      assert.deepEqual(await evaluate('model.calls'), []);
    });
    await t.test('远征：跨午夜不整页刷新，正常领取后继续派遣', async () => {
      await setupExp(`clock = Date.parse('2026-10-10T23:59:59+08:00'); addRuns(6); model.burst = 0;`);
      await until(async () => (await expStatus())?.includes('今日突发已使用'), 'previous day used');
      const before = expeditionRequests;
      await pulse(1001);
      await pulse(3000);
      assert.equal(expeditionRequests, before, '跨日不自动整页刷新');
      await evaluate('model.runs.forEach(r=>r.done=true);renderExp();');
      await drive(`${confirmed}.length===1 && model.runs.length===6`, 'normal cycle across midnight');
      assert.equal(expeditionRequests, before);
      assert.equal(await evaluate(`${logBucket('expedition','2026-10-11')}.counts['expedition-day']`),1);
    });
    // 模拟网页保留旧区域：副本排在当前区域前，数据冲突且不绑定真实操作。
    const staleExpedition = (hide = 'wrapper.hidden=true;') => `
      const renderCurrent=renderExp;
      window.staleClicks=0;
      window.renderExp=()=>{
        renderCurrent();
        const wrapper=document.createElement('div');${hide}
        wrapper.dataset.stale='true';
        for(const section of [...game.querySelectorAll('section')]) {
          const copy=section.cloneNode(true);
          copy.removeAttribute('id');copy.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
          const count=copy.querySelector('input[type="number"]');if(count)count.value='1';
          const preference=copy.querySelector('[aria-label="自动组队偏好"]');
          preference?.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed','false'));
          if(section.id==='routes')copy.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed','false'));
          if(section.id==='running')copy.insertAdjacentHTML('beforeend','<button>领取</button>');
          if(section.hasAttribute('aria-label'))copy.innerHTML='<div><span>常态剩余</span><span>0/6 支</span></div>'+
            '<div><span>当前运行</span><span>12 支</span></div><div><span>今日突发剩余</span><span>0/6 支</span></div>';
          const forecast=copy.querySelector('[role="status"]');if(forecast)forecast.textContent='预计派遣 1 支：常态 1 支，突发 0 支';
          wrapper.append(copy);
        }
        wrapper.addEventListener('click',()=>staleClicks++);
        game.prepend(wrapper);
      };
    `;

    await t.test('稳定性优化：隐藏刷新副本不挡住奇遇，两个可见候选不盲选', async () => {
      await setup(`window.clock=10000;Date.now=()=>clock;choices(['修为 +1','修为 +2','修为 +3']);
        const stale=refresh.cloneNode(true);stale.removeAttribute('id');
        const wrap=document.createElement('div');wrap.hidden=true;wrap.append(stale);game.prepend(wrap);`);
      await drive('clicks.length===1','current cultivate controls',10);
      assert.deepEqual(await clickLog(),[2]);
      await setup(`window.clock=10000;Date.now=()=>clock;choices(['修为 +1','修为 +2','修为 +3']);
        const copy=refresh.cloneNode(true);copy.id='copy';game.prepend(copy);`);
      for(let i=0;i<5;i++)await pulse();
      assert.deepEqual(await clickLog(),[],'两份可见刷新控件无法唯一定位，不能猜测');
    });
    await t.test('稳定性优化：损坏保存记录不阻断面板、不覆盖原文或恢复操作', async () => {
      for(const [key,group] of [['arkengine:auto-encounter:action:v1','encounter'],
          ['arkengine:auto-expedition:claim:v1','expedition'],['arkengine:auto-expedition:idle:v1','expedition'],
          ['arkengine:auto-recovery:expedition:v1','expedition']]) {
        await setupExp(`sessionStorage.setItem('${key}','{bad-json');`);
        const panel=`document.getElementById('ark-auto-expedition').shadowRoot`;
        const hint=`${panel}.getElementById('${group==='encounter'?'cultivate-status':'status'}').textContent`;
        await until(()=>evaluate(`${hint}.includes('保存记录不可读')`),'corrupt record status');
        assert.equal(await evaluate(`document.querySelectorAll('#ark-auto-expedition').length`),1);
        await evaluate(`${panel}.getElementById('${group==='encounter'?'cultivate-toggle':'toggle'}').click()`);
        assert.equal(await evaluate(`sessionStorage.getItem('${key}')`),'{bad-json');
        assert.match(await evaluate(hint),/保存记录不可读/);
      }
      await setupExp(`sessionStorage.setItem('arkengine:auto-expedition:claim:v1','[]');`);
      await until(async()=>(await expStatus())?.includes('保存记录不可读'),'valid JSON with invalid shape');
      assert.deepEqual(await evaluate('model.calls'),[]);
      for(const [key,body,hint] of [

        ['arkengine:auto-dungeon:pending:v1',{phase:'submitted',at:10000,action:'choose',step:99},'dungeon-status']]) {
        await setup(`window.clock=10000;Date.now=()=>clock;sessionStorage.setItem('${key}',JSON.stringify(${JSON.stringify(body)}));
          choices(['修为 +1','修为 +2','修为 +3']);`);
        await drive('clicks.length===1','unaffected encounter continues',10);
        assert.match(await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('${hint}').textContent`),/保存记录不可读/);
        assert.deepEqual(await evaluate(`JSON.parse(sessionStorage.getItem('${key}'))`),body);
      }
    });
    await t.test('加载故障恢复：远征后台刷新用尽仍保留开启，数据恢复后继续派遣', async () => {
      await setupExp(`sessionStorage.setItem('arkengine:auto-page-wait:expedition:v1',JSON.stringify({at:clock-300001,path:location.pathname,reloaded:true,refreshes:5}));
        const renderCurrent=renderExp;window.renderExp=()=>{renderCurrent();document.querySelector('#auto input[type="number"]').remove();};`);
      const foreground=await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        await until(()=>evaluate(`document.hidden`),'expedition hidden');
        const requests=expeditionRequests;
        await pulse(3600000);
        assert.match(await expStatus(),/刷新.*5.*等待页面恢复/);
        assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
        assert.equal(expeditionRequests,requests);
        await evaluate(`window.renderExp=renderCurrent;renderExp();`);
        await drive('model.runs.length===6','expedition resumes after loading outage');
      } finally { await cdp.send('Target.closeTarget',{targetId:foreground.targetId}); }
    });
    await t.test('加载故障恢复：农场旧超时后重新开启，先等待加载再种植', async () => {
      await setupFarm(`addRuns(6);localStorage.setItem('arkengine:auto-farm:enabled:v1','false');
        sessionStorage.setItem('arkengine:auto-page-wait:farm:v1',JSON.stringify({at:clock-3600000,path:'/farm',reloaded:true}));
        const renderCurrent=renderFarm;window.renderFarm=()=>{renderCurrent();document.querySelector('details').remove();};`, '/farm');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('farm-toggle').click();`);
      await pulse(2000);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'true');
      assert.equal(await evaluate(farmCalls('plant')+'.length'),0);
      assert.match(await expStatus(),/等待.*加载/);
      await evaluate(`window.renderFarm=renderCurrent;renderFarm();`);
      await drive('fm.crops.length===12','farm recovers after enable');
      assert.equal(await evaluate(farmCalls('plant')+'.length'),1);
    });
    await t.test('加载故障恢复：修仙刷新用尽仍开启，手动刷新后数据恢复会继续', async () => {
      const loading=`window.clock=10000;Date.now=()=>clock;refresh.remove();`;
      await setup(`${loading}
        sessionStorage.setItem('arkengine:auto-page-wait:cultivate:v1',JSON.stringify({at:0,path:'/cultivate',reloaded:true,refreshes:5}));`);
      await pulse(3600000);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-encounter:enabled:v1')`),'false');
      assert.match(await status(),/刷新.*5.*等待页面恢复/);
      await cdp.send('Page.reload',{},tab.sessionId);
      await until(()=>evaluate(`typeof base==='function'&&!document.getElementById('ark-auto-expedition')`),'manual reload after outage');
      await evaluate(`${loading}Math.random=()=>0;`);
      await evaluate(source);
      await pulse(5000);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-encounter:enabled:v1')`),'false');
      await evaluate(`base();choices(['修为 +1','修为 +2','钻石 +1']);`);
      await drive('clicks.length===1','cultivate resumes after outage',10);
      assert.deepEqual(await clickLog(),[2]);
    });
    await t.test('加载故障恢复：农场延长至一小时两小时共五次，跨刷新保留上限并自动恢复', async () => {
      const removeData=`document.querySelector('details').remove();`;
      await setupFarm(`addRuns(6);const renderCurrent=renderFarm;window.renderFarm=()=>{renderCurrent();${removeData}};`, '/farm');
      await until(async()=>(await expStatus())?.includes('等待田地'),'initial loading wait started');
      const observedSince=await evaluate('clock');
      for(const [index,interval] of [90000,300000,900000,3600000,7200000].entries()) {
        await pulse(interval-1000);
        assert.ok(await evaluate(`!!document.getElementById('ark-auto-expedition')`),'到间隔前不刷新');
        const snapshot=await evaluate('({fm,model,clock})');snapshot.clock+=1001;
        await pulse(1001);
        await until(()=>evaluate(`typeof renderFarm==='function'&&!document.getElementById('ark-auto-expedition')`),'scheduled loading refresh');
        await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderFarm();${removeData}`);
        await evaluate(source);
        await until(async()=>(await expStatus())?.includes('等待田地'),'wait resumes after reload');
        assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-page-wait:farm:v1')).refreshes`),index+1);
        assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
      }
      await pulse(3600000);
      assert.match(await expStatus(),/刷新.*5.*等待页面恢复/);
      assert.equal(await evaluate(farmCalls('plant')+'.length'),0);
      await pulse(15*60000);
      const events=await evaluate(`${logBucket('expedition')}.events`);
      const refreshes=events.filter(e=>e.type==='page-refresh'&&e.data.scope==='farm');
      assert.equal(refreshes.length,5);
      assert.deepEqual(refreshes.map(e=>e.data.attempt),[1,2,3,4,5]);
      assert.equal(refreshes[3].data.nextAt,refreshes[3].at+7200000);
      assert.equal(refreshes[4].data.nextAt,null);
      assert.ok(refreshes.every(e=>e.data.observedSince===observedSince));
      assert.equal(events.filter(e=>e.type==='page-refresh-exhausted').length,1,'耗尽只记一次，不每轮刷屏');
      const heartbeat=events.filter(e=>e.type==='heartbeat').at(-1);
      assert.equal(heartbeat.data.pageRecovery.attempt,5);
      assert.equal(heartbeat.data.pageRecovery.limit,5);
      assert.equal(heartbeat.data.runtime.online,true);
      assert.ok(heartbeat.data.pageRecovery.blockedMs>=3*3600000);
      await evaluate(`renderFarm();`);
      await drive('fm.crops.length===12','automatic resume after fifth refresh');
      assert.equal(await evaluate(farmCalls('plant')+'.length'),1);
      const ended=await evaluate(`${logBucket('expedition')}.events.find(e=>e.type==='page-wait-ended'&&e.data.scope==='farm')`);
      assert.equal(ended.data.attempt,5);
      assert.equal(ended.data.cause,'check-advanced');
    });
    await t.test('加载故障恢复：离线不刷新，恢复联网和数据后继续农场', async () => {
      await setupFarm(`addRuns(6);Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
        const renderCurrent=renderFarm;window.renderFarm=()=>{renderCurrent();document.querySelector('details').remove();};`, '/farm');
      await pulse(3600000);
      assert.match(await expStatus(),/网络离线/);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
      await evaluate(`delete navigator.onLine;window.renderFarm=renderCurrent;renderFarm();`);
      await drive('fm.crops.length===12','resume after network returns');
      assert.equal(await evaluate(farmCalls('plant')+'.length'),1);
    });
    await t.test('加载故障恢复：旧三次记录继续等待一小时，第四次不提前也不清零', async () => {
      await setupExp(`sessionStorage.setItem('arkengine:auto-page-wait:expedition:v1',JSON.stringify({at:clock,path:location.pathname,reloaded:true,refreshes:3}));
        const renderCurrent=renderExp;window.renderExp=()=>{renderCurrent();document.querySelector('#auto input[type="number"]').remove();};`);
      const requests=expeditionRequests;
      await pulse(3599000);
      assert.equal(expeditionRequests,requests);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-page-wait:expedition:v1')).refreshes`),3);
      await pulse(1001);
      await until(()=>expeditionRequests===requests+1,'fourth refresh from legacy three-attempt state');
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'fourth page loaded');
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-page-wait:expedition:v1')).refreshes`),4);
    });
    await t.test('加载诊断：记录断网恢复与心跳运行状态，不额外查询或采集页面地址参数', async () => {
      await setupExp(`addRuns(6);history.replaceState({},'','/activities/expedition?token=diagnostic-secret');`);
      const requests=diagnosticRequests;
      await evaluate(`Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.dispatchEvent(new Event('offline'));`);
      await pulse(1000);
      await evaluate(`delete navigator.onLine;window.dispatchEvent(new Event('online'));`);
      await pulse(16*60000);
      const events=await evaluate(`${logBucket('expedition')}.events`);
      assert.equal(events.find(e=>e.type==='page-lifecycle'&&e.data.event==='offline').data.online,false);
      assert.equal(events.find(e=>e.type==='page-lifecycle'&&e.data.event==='online').data.online,true);
      const runtime=events.filter(e=>e.type==='heartbeat').at(-1).data.runtime;
      assert.equal(runtime.online,true);assert.equal(runtime.readyState,'complete');assert.ok(runtime.uptimeMs>=0);
      assert.equal(diagnosticRequests,requests,'诊断不得发起额外网络请求');
      assert.doesNotMatch(JSON.stringify(events),/diagnostic-secret/);
    });
    await t.test('加载故障恢复：人工暂停或账号异常后，数据恢复不自动开启', async () => {
      for(const stop of ['manual','account']) {
        await setupFarm(`addRuns(6);sessionStorage.setItem('arkengine:auto-page-wait:farm:v1',JSON.stringify({at:clock-3600000,path:'/farm',reloaded:true,refreshes:5}));
          const renderCurrent=renderFarm;window.renderFarm=()=>{renderCurrent();document.querySelector('details').remove();};`, '/farm');
        if(stop==='manual') await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();`);
        else await evaluate(`fm.error=true;fm.message='401 登录失效';renderFarm();`);
        await pulse(1000);
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
        await evaluate(`fm.error=false;fm.message='';window.renderFarm=renderCurrent;renderFarm();`);
        await pulse(3600000);
        assert.equal(await evaluate(farmCalls('plant')+'.length'),0);
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
      }
    });
    await t.test('农场导航缺失：入口缺失或隐藏时按已知地址进入农场，保留开关并正常种植',async()=>{
      for(const change of ['remove()','setAttribute("hidden","")']){
        await setupFarm(`addRuns(6);`);
        await evaluate(`document.querySelector('a[href="/farm"]').${change};`);
        await drive(`location.pathname==='/farm'&&typeof renderFarm==='function'&&!document.getElementById('ark-auto-expedition')`,'farm direct navigation without visible link',35);
        const navigation=await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:navigation:v1'))`);
        assert.equal(navigation.to,'/farm');assert.equal(navigation.reloaded,false);
        await evaluate(`addRuns(6);Math.random=()=>0;`);await evaluate(source);
        await drive(`${farmCalls('plant')}.length===1`,'plant after direct farm navigation');
        assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
        assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-expedition:navigation:v1')`),null);
      }
    });
    await t.test('农场导航缺失：等待生长或农场已暂停时可返回远征，保留日程与旧请求',async()=>{
      for(const paused of [false,true]){
        await setupFarm(`addRuns(6);fm.crops=Array.from({length:12},(_,i)=>({plot:i+1,key:fc[0].key,name:fc[0].name,at:clock+3600000}));
          ${paused?`localStorage.setItem('arkengine:auto-farm:enabled:v1','false');sessionStorage.setItem('arkengine:auto-farm:pending:v1',JSON.stringify({action:'harvest',plots:[1],at:clock-60000,reloaded:true}));`:''}`, '/farm');
        const pending=await evaluate(`sessionStorage.getItem('arkengine:auto-farm:pending:v1')`);
        await evaluate(`document.querySelector('a[href="/activities/expedition"]').remove();`);
        await drive(`location.pathname==='/activities/expedition'&&typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`,'farm direct return without link',35);
        assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:navigation:v1')).to`),'/activities/expedition');
        assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:pending:v1')`),pending);
        if(!paused)assert.ok(await evaluate(`${farmState}.nextAt>clock`));
        await evaluate(`addRuns(6);model.burst=0;Math.random=()=>0;renderExp();`);await evaluate(source);
        await until(async()=>(await expStatus())?.includes('持续等待远征归来'),'expedition works after direct return');
        await pulse(20000);
        assert.equal(await evaluate('location.pathname'),'/activities/expedition');
        assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:pending:v1')`),pending);
      }
    });
    await t.test('农场导航缺失：排队直达期间暂停或打开弹窗，撤销尚未开始的跳转',async()=>{
      for(const stop of ['farm','dialog']){
        await setupFarm(`addRuns(6);`);await evaluate(`document.querySelector('a[href="/farm"]').remove();`);
        await until(async()=>(await expStatus())?.includes('秒后切换到农场'),'farm direct navigation queued');
        if(stop==='farm')await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('farm-toggle').click();`);
        else await evaluate(`openDispatch();`);
        await pulse(60000);
        assert.equal(await evaluate('location.pathname'),'/activities/expedition');
        assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-expedition:navigation:v1')`),null);
        assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      }
    });
    await t.test('切页故障恢复：点击农场后不连续点击，30秒后整页到目标继续种植', async () => {
      await setupFarm(`addRuns(6);window.navFarm=path=>{fm.calls.push({type:'navigate',path});};`);
      await drive(`${farmCalls('navigate')}.length===1`,'first SPA navigation click');
      for(let i=0;i<5;i++) await pulse(5000);
      assert.equal(await evaluate(farmCalls('navigate')+'.length'),1);
      await pulse(6000);
      await until(()=>evaluate(`location.pathname==='/farm'&&!document.getElementById('ark-auto-expedition')`),'full navigation fallback');
      await until(()=>evaluate(`typeof renderFarm==='function'`),'farm fallback fixture');
      await evaluate(`addRuns(6);Math.random=()=>0;`);
      await evaluate(source);
      await drive('fm.crops.length===12','farm planting after fallback');
      assert.equal(await evaluate(farmCalls('plant')+'.length'),1);
    });
    await t.test('切页故障恢复：返回远征同样只点击一次，整页跳转预算跨刷新保留', async () => {
      await setupFarm(`addRuns(6);localStorage.setItem('arkengine:auto-farm:enabled:v1','false');
        window.navFarm=path=>{fm.calls.push({type:'navigate',path});};`, '/farm');
      await drive(`${farmCalls('navigate')}.length===1`,'return navigation click');
      for(let i=0;i<5;i++)await pulse(5000);
      assert.equal(await evaluate(farmCalls('navigate')+'.length'),1);
      await pulse(6000);
      await until(()=>evaluate(`location.pathname==='/activities/expedition'&&!document.getElementById('ark-auto-expedition')`),'full return navigation');
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:navigation:v1')).reloaded`),true);
      await evaluate(`addRuns(6);model.burst=0;renderExp();Math.random=()=>0;`);
      await evaluate(source);
      await until(async()=>(await expStatus())?.includes('持续等待远征归来'),'arrived at expedition');
      assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-expedition:navigation:v1')`),null);
      await setupFarm(`addRuns(6);sessionStorage.setItem('arkengine:auto-expedition:navigation:v1',
        JSON.stringify({at:clock-3600000,from:'/activities/expedition',to:'/farm',reloaded:true}));`);
      const requests=expeditionRequests;
      await pulse(3600000);
      assert.equal(expeditionRequests,requests);
      assert.equal(await evaluate(farmCalls('navigate')+'.length'),0);
      assert.match(await expStatus(),/切换农场仍未完成/);
    });
    await t.test('切页故障恢复：等待中暂停农场或出现弹窗不整页跳转', async () => {
      for(const stop of ['farm','dialog']) {
        await setupFarm(`addRuns(6);window.navFarm=path=>{fm.calls.push({type:'navigate',path});};`);
        await drive(`${farmCalls('navigate')}.length===1`,'navigation is pending');
        if(stop==='farm') await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('farm-toggle').click();`);
        else await evaluate(`openDispatch();`);
        await pulse(60000);
        assert.equal(await evaluate('location.pathname'),'/activities/expedition');
        assert.ok(await evaluate(`!!document.getElementById('ark-auto-expedition')`));
        assert.equal(await evaluate(farmCalls('navigate')+'.length'),1);
      }
    });
    await t.test('加载故障恢复：农场未决种植仍保留记录且不重种', async () => {
      await setupFarm(`addRuns(6);sessionStorage.setItem('arkengine:auto-page-wait:farm:v1',JSON.stringify({at:clock-3600000,path:'/farm',reloaded:true}));
        sessionStorage.setItem('arkengine:auto-farm:pending:v1',JSON.stringify({action:'plant',crop:'南瓜',empty:12,plots:[],at:clock-3600000}));
        const renderCurrent=renderFarm;window.renderFarm=()=>{renderCurrent();document.querySelector('details').remove();};`, '/farm');
      await pulse(1000);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-farm:enabled:v1')`),'false');
      assert.ok(await evaluate(`sessionStorage.getItem('arkengine:auto-farm:pending:v1')`));
      assert.equal(await evaluate(farmCalls('plant')+'.length'),0);
      assert.deepEqual(await evaluate('model.calls'),[]);
    });
    await t.test('远征加载恢复：后台领取后缺少请求证据，超过90秒仍等待并在数据恢复后续派', async () => {
      await setupExp(`addRuns(6,false,true);const originalClaim=claimRuns;
        window.claimRuns=()=>{originalClaim();document.querySelector('[aria-label="远征派遣额度"]').remove();};`);
      await drive(`model.calls.some(c=>c.type==='claim')`,'claim completed before loading gap');
      const foreground=await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        await until(()=>evaluate(`document.visibilityState==='hidden'`),'expedition hidden');
        await pulse(2000);
        const requests=expeditionRequests;
        await pulse(12*60000);
        assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
        assert.match(await expStatus(),/后台.*等待页面恢复/);
        assert.equal(expeditionRequests,requests,'后台缺项不触发额外整页刷新');
        await evaluate('renderExp();');
        await drive(`model.runs.length===6&&!JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:claim:v1'))`,'data restored resumes without toggle');
        assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),1);
      } finally { await cdp.send('Target.closeTarget',{targetId:foreground.targetId}); }
    });
    await t.test('远征加载恢复：后台等待跨刷新保留，前台仍缺数据90秒后暂停且不误记登录异常', async () => {
      await setupExp(`addRuns(6,false,true);const originalClaim=claimRuns;
        window.claimRuns=()=>{originalClaim();document.querySelector('[aria-label="远征派遣额度"]').remove();};`);
      await drive(`model.calls.some(c=>c.type==='claim')`,'successful claim');
      const foreground=await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        await until(()=>evaluate(`document.visibilityState==='hidden'`),'hidden loading');
        await pulse(2000);
        await pulse(12*60000);
        const snapshot=await evaluate('({model,clock})');
        await cdp.send('Page.reload',{},tab.sessionId);
        await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'manual reload while hidden');
        await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderExp();
          document.querySelector('[aria-label="远征派遣额度"]').remove();`);
        await evaluate(source);
        await pulse(1000);
        await cdp.send('Target.activateTarget',{targetId:tab.targetId});
        await until(()=>evaluate(`document.visibilityState==='visible'`),'return to foreground');
        await pulse(50000);
        assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false','后台时间不耗尽前台检查窗口');
        await pulse(41000);
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
        assert.match(await expStatus(),/原结果未确认，已暂停/);
        assert.equal(await evaluate(`${logBucket('expedition')}.events.filter(e=>e.type==='pause').at(-1).data.reason`),'pending-result');
        assert.notEqual(await evaluate(`sessionStorage.getItem('arkengine:auto-expedition:claim:v1')`),'null');
      } finally { await cdp.send('Target.closeTarget',{targetId:foreground.targetId}); }
    });
    await t.test('远征加载恢复：人工暂停后即使页面恢复也不自动继续', async () => {
      await setupExp(`addRuns(6,false,true);const originalClaim=claimRuns;
        window.claimRuns=()=>{originalClaim();document.querySelector('[aria-label="远征派遣额度"]').remove();};`);
      await drive(`model.calls.some(c=>c.type==='claim')`,'claim before manual stop');
      const foreground=await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        await until(()=>evaluate(`document.visibilityState==='hidden'`),'hidden page');
        await pulse(2000);
        await pulse(120000);
        await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();renderExp();`);
        await pulse(10000);
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
        assert.equal(await evaluate('model.runs.length'),0);
        assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),1);
      } finally { await cdp.send('Target.closeTarget',{targetId:foreground.targetId}); }
    });
    await t.test('稳定性优化：隐藏旧体力不改变农场种植决策', async () => {
      await setupFarm(`addRuns(6);fm.stamina=100;
        const renderCurrent=renderFarm;window.renderFarm=()=>{
          renderCurrent();const wrap=document.createElement('div');wrap.hidden=true;
          wrap.innerHTML='<span title="每 4 分钟自然恢复 1 点体力">体力 0/100（4:00 恢复 1 点）</span>';game.prepend(wrap);};`, '/farm');
      await drive(`fm.crops.length===12 && location.pathname==='/activities/expedition'`,'use current stamina',40);
      assert.equal(await evaluate('fm.stamina'),88);
      assert.equal(await evaluate(farmCalls('plant')+'.length'),1);
    });

    await t.test('远征区域定位：隐藏旧队数不遮挡当前输入框，当前禁用时仍等待', async () => {
      await setupExp(`model.maxTeams=1;window.disableCount=true;
        const renderCurrent=renderExp;window.renderExp=()=>{
          renderCurrent();const real=document.querySelector('#auto');
          real.querySelector('input[type="number"]').disabled=disableCount;
          const copy=real.cloneNode(true);copy.removeAttribute('id');
          copy.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
          const staleCount=copy.querySelector('input[type="number"]');staleCount.value='2';staleCount.disabled=false;
          const wrapper=document.createElement('div');wrapper.hidden=true;wrapper.append(copy);real.before(wrapper);
        };`);
      await until(async()=>(await expStatus())?.includes('派遣队数输入框不可用'),'visible disabled count waits');
      const blocked=await evaluate(`${logBucket('expedition')}.events.find(e=>e.type==='expedition-blocked')`);
      assert.equal(blocked.data.button.visible,true);
      assert.equal(blocked.data.button.disabled,true,'诊断指向当前输入框');
      assert.deepEqual(await evaluate('model.calls'),[]);
      await evaluate('disableCount=false;renderExp();');
      await drive('model.runs.length===6&&!pendingPayload','current count changed to six',30);
      assert.equal(await evaluate(`${confirmed}[0].input.maxTeams`),6);
      assert.equal(await evaluate(`document.querySelector('div[hidden] input[type="number"]').value`),'2','隐藏的旧队数不被改写');
    });
    await t.test('远征区域定位：隐藏旧页面不影响当前额度、领取、派遣与确认弹窗', async () => {
      const foreground=await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        for(const hide of ['wrapper.hidden=true;', "wrapper.style.display='none';", "wrapper.setAttribute('aria-hidden','true');"]) {
          await setupExp(`addRuns(6,false,true);${staleExpedition(hide)}`);
          assert.equal(await evaluate('document.visibilityState'),'hidden','后台标签仍有正常布局');
          const before=expeditionRequests;
          await drive(`model.runs.length===6 && model.calls.some(c=>c.type==='dispatch') && !pendingPayload`, 'visible page dispatch',30);
          assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),1);
          assert.deepEqual(await evaluate(`${confirmed}.map(c=>[c.route,c.total,c.input.maxTeams])`),[['边境巡逻',6,6]]);
          assert.equal(await evaluate('staleClicks'),0);
          assert.equal(await evaluate('model.opens'),1,'弹窗遮住底层表单仍能核对，不反复开关');
          assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-expedition:idle:v1')`),null);
          assert.equal(expeditionRequests,before,'不因隐藏副本刷新页面');
          await evaluate('model.runs.forEach(r=>r.done=true);renderExp();');
          await drive(`${confirmed}.length===2&&!pendingPayload`,'second visible cycle',30);
          assert.equal(await evaluate('staleClicks'),0);
        }
      } finally {await cdp.send('Target.closeTarget',{targetId:foreground.targetId});}
    });
    await t.test('远征区域定位：同一区域内隐藏控件和旧预览不挡住可见控件', async () => {
      await setupExp(`model.route='深渊远征';model.high=false;model.maxTeams=2;model.allowBurst=true;
        const renderCurrent=renderExp;window.staleClicks=0;
        window.renderExp=()=>{
          renderCurrent();
          for(const section of [document.querySelector('#auto'),document.querySelector('#routes')]) {
            const wrapper=document.createElement('div');wrapper.hidden=true;
            for(const child of [...section.children]) {
              if(child.tagName==='H2')continue;
              const copy=child.cloneNode(true);copy.removeAttribute('id');
              copy.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
              wrapper.append(copy);
            }
            const count=wrapper.querySelector('input[type="number"]');if(count)count.value='99';
            wrapper.addEventListener('click',()=>staleClicks++);section.prepend(wrapper);
          }
        };`);
      await drive(`model.runs.length===6&&!pendingPayload`,'visible controls and forecast',40);
      assert.deepEqual(await evaluate(`${confirmed}.map(c=>[c.route,c.total,c.input.maxTeams,c.input.allowBurst])`),[['边境巡逻',6,6,false]]);
      assert.equal(await evaluate('staleClicks'),0);
    });
    await t.test('远征区域定位：刷新后核对旧领取，忽略隐藏的过期队伍与额度', async () => {
      await setupExp(`${staleExpedition()}
        sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify({running:6,at:clock-40000,reloaded:true}));`);
      await drive(`model.runs.length===6&&!pendingPayload`,'claim reconciled on current page',30);
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),0,'已领取的旧请求不能再次领取');
      assert.equal(await evaluate(`${confirmed}.length`),1);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:claim:v1'))`),null);
      assert.equal(await evaluate('staleClicks'),0);
    });
    await t.test('远征区域定位：只有隐藏表单时仍暂停，出现可见区域也须手动开始', async () => {
      await setupExp(`model.maxTeams=1;window.hideForm=true;
        const renderCurrent=renderExp;window.renderExp=()=>{renderCurrent();document.querySelector('#auto').hidden=hideForm;};
        sessionStorage.setItem('arkengine:auto-expedition:idle:v1',JSON.stringify({at:clock-301000,since:clock-395000,reloaded:true,reason:'派遣队数输入框不可用'}));`);
      await until(async()=>(await expStatus())?.includes('一次刷新后仍无进展'),'actual hidden form pauses');
      assert.deepEqual(await evaluate('model.calls'),[]);
      await evaluate('hideForm=false;renderExp();');await pulse(5000);
      assert.deepEqual(await evaluate('model.calls'),[],'恢复布局不能自动解除暂停');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();`);
      await drive('model.runs.length===6&&!pendingPayload','manual start after layout recovery',30);
    });
    await t.test('远征停滞：不可用路线显示真实原因，恢复后后台继续派遣', async () => {
      const foreground=await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        await setupExp(`addRuns(6);model.burst=6;`);
        await evaluate(`document.querySelector('#routes').setAttribute('inert','');`);
        await until(async()=>(await expStatus())?.includes('路线按钮不可用'),'blocked route status');
        assert.equal(await evaluate('document.visibilityState'),'hidden');
        const before=expeditionRequests;
        await pulse(30000);
        assert.equal(expeditionRequests,before);
        assert.equal(await evaluate(`${logBucket('expedition')}.events.find(e=>e.type==='expedition-blocked').data.button.inert`),true);
        assert.equal(await evaluate(`${logBucket('expedition')}.counts['expedition-blocked']`),1,'持续阻塞不逐次刷日志');
        await evaluate(`document.querySelector('#routes').removeAttribute('inert');`);
        await drive(`${confirmed}.some(c=>c.route==='深渊远征')`,'route restored in background');
        assert.equal(await evaluate(`sessionStorage.getItem('arkengine:auto-expedition:idle:v1')`),null);
        const recovered=await evaluate(`${logBucket('expedition')}.events.find(e=>e.type==='expedition-unblocked')`);
        assert.ok(recovered.data.blockedMs>=30000);
        assert.equal(recovered.data.reloaded,false);
      } finally {await cdp.send('Target.closeTarget',{targetId:foreground.targetId});}
    });
    await t.test('本地诊断：区分祖先隐藏、无布局和禁用，原因变化才追加记录', async () => {
      await setupExp(`addRuns(6);model.burst=6;`);
      await evaluate(`document.querySelector('#routes').setAttribute('inert','');`);
      await until(async()=>(await expStatus())?.includes('路线按钮不可用'),'diagnostic blocked route');
      const before=expeditionRequests;
      const blocked=`${logBucket('expedition')}.events.filter(e=>e.type==='expedition-blocked')`;
      const initial=await evaluate(`${blocked}.at(-1)`);
      assert.equal(initial.data.button.inert,true);
      assert.ok(initial.data.button.blockers.some(b=>b.kind==='inert'&&b.depth>0));
      for(const [change,kind] of [
        [`routes.removeAttribute('inert');routes.hidden=true;`,'hidden'],
        [`routes.hidden=false;routes.setAttribute('aria-hidden','true');`,'aria-hidden'],
        [`routes.removeAttribute('aria-hidden');routes.style.display='none';`,'display-none'],
      ]) {
        await evaluate(`{const routes=document.querySelector('#routes');${change}}`);
        await pulse(1000);
        const event=await evaluate(`${blocked}.at(-1)`);
        assert.ok(event.data.button.blockers.some(b=>b.kind===kind),kind);
        assert.equal(event.data.blockedSince,initial.data.blockedSince,'变化不重置阻塞起点');
      }
      const hidden=await evaluate(`${blocked}.at(-1)`);
      assert.deepEqual(hidden.data.button.size,{width:0,height:0});
      assert.equal(hidden.data.button.rectCount,0);
      await evaluate(`document.querySelector('#routes').style.display='';
        document.querySelectorAll('#routes button').forEach(b=>b.disabled=true);`);
      await pulse(1000);
      assert.equal(await evaluate(`${blocked}.at(-1).data.button.disabled`),true);
      const count=await evaluate(`${blocked}.length`);
      await pulse(1000);
      assert.equal(await evaluate(`${blocked}.length`),count);
      assert.equal(expeditionRequests,before);
      assert.deepEqual(await evaluate('model.calls'),[]);
    });
    await t.test('本地诊断：真实冻结恢复留下生命周期证据且只核对原派遣', async () => {
      await setupExp(`model.resultMode='pending';`);
      await drive(`${confirmed}.length===1&&!model.busy`,'original pending before freeze');
      const foreground=await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        assert.equal(await evaluate('document.visibilityState'),'hidden');
        const original=await evaluate(`sessionStorage.getItem('expedition:77:auto')`);
        const before=expeditionRequests;
        await cdp.send('Page.setWebLifecycleState',{state:'frozen'},tab.sessionId);
        await evaluate('clock+=180000');
        assert.equal(await evaluate(`sessionStorage.getItem('expedition:77:auto')`),original);
        await cdp.send('Page.setWebLifecycleState',{state:'active'},tab.sessionId);
        await drive(`model.calls.some(c=>c.type==='recover')&&model.runs.length===6`,'same original after resume');
        const events=await evaluate(`${logBucket('expedition')}.events`);
        const frozen=events.find(e=>e.type==='page-lifecycle'&&e.data.event==='freeze');
        const resumed=events.find(e=>e.type==='page-lifecycle'&&e.data.event==='resume');
        assert.ok(frozen&&resumed,'浏览器实际派发冻结和恢复事件');
        assert.equal(frozen.data.trusted,true);
        assert.equal(resumed.data.trusted,true);
        assert.equal(frozen.pageId,resumed.pageId);
        assert.equal(resumed.data.pendingDispatch,true);
        assert.ok(resumed.data.gapMs>=180000);
        assert.ok(events.some(e=>e.type==='heartbeat-gap'&&e.data.gapMs>=180000),'生命周期记录不抹掉调度中断');
        const calls=await evaluate('model.calls');
        assert.deepEqual(calls.map(c=>c.type),['dispatch','recover']);
        assert.equal(calls[0].idempotencyKey,calls[1].idempotencyKey);
        assert.equal(JSON.stringify(events.filter(e=>e.type==='page-lifecycle')).includes(calls[0].idempotencyKey),false);
        assert.equal(expeditionRequests,before);
      } finally {
        await cdp.send('Page.setWebLifecycleState',{state:'active'},tab.sessionId);
        await cdp.send('Target.closeTarget',{targetId:foreground.targetId});
      }
    });
    await t.test('本地诊断：修仙暂停后的恢复事件只记日志，不恢复自动操作', async () => {
      await setup(`window.clock=Date.parse('2026-10-10T12:00:00+08:00');Date.now=()=>clock;choices(['修为 +1','钻石 +2']);`);
      await until(async()=>(await status())?.includes('随机等待'),'cultivation active for lifecycle');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();
        document.dispatchEvent(new Event('freeze'));clock+=180000;document.dispatchEvent(new Event('resume'));`);
      await pulse(1000);
      const events=await evaluate(`${logBucket()}.events.filter(e=>e.type==='page-lifecycle')`);
      assert.ok(events.some(e=>e.data.event==='resume'&&e.data.enabled===false));
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-encounter:enabled:v1')`),'true');
      assert.deepEqual(await clickLog(),[]);
      assert.ok(await evaluate(`${logBucket('expedition')}`));
      assert.deepEqual(await evaluate(`${logBucket()}.totals`),{});
    });
    await t.test('远征停滞：巡逻到期仍显示远征中时只刷新一次，刷新后保留上限', async () => {
      await setupExp(`addRuns(6);`);
      const stale="document.querySelector('#running button').parentElement.insertAdjacentHTML('beforeend','<span>预计 11:55 归来</span>');";
      await evaluate(stale);
      await until(async()=>(await expStatus())?.includes('已过预计归来时间'),'stale arrival detected');
      const blockedSince=await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:idle:v1')).since`);
      const previousPage=await evaluate(`${logBucket('expedition')}.events.find(e=>e.type==='page-lifecycle').pageId`);
      await pulse(91000);
      const snapshot=await evaluate('({model,clock})');
      const before=expeditionRequests;
      await pulse(3000);
      await until(()=>expeditionRequests>before,'one idle reload');
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'idle reload ready');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderExp();${stale}`);
      await evaluate(source);
      await until(async()=>(await expStatus())?.includes('已核对一次'),'reload budget preserved');
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:idle:v1')).since`),blockedSince);
      assert.notEqual(await evaluate(`${logBucket('expedition')}.events.filter(e=>e.type==='page-lifecycle').at(-1).pageId`),previousPage);
      await pulse(5*60000+5000);
      await until(async()=>(await expStatus())?.includes('一次刷新后仍无进展'),'explicit stop after one reload');
      assert.equal(expeditionRequests,before+1);
      assert.deepEqual(await evaluate('model.calls'),[]);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:idle:v1')).reloaded`),true);
    });
    await t.test('远征停滞：手动弹窗和原请求不触发空闲刷新，深渊跨日不猜到达', async () => {
      for(const code of [
        `openDispatch();`,
        `openDispatch();document.querySelector('[role="dialog"]').style.display='none';model.burst=6;`,
        `sessionStorage.setItem('expedition:77:auto',JSON.stringify({input:{routeKey:'patrol'},idempotencyKey:'manual'}));`,
        `model.runs.forEach(r=>r.route='深渊远征');renderExp();document.querySelector('#running button').parentElement.insertAdjacentHTML('beforeend','<span>预计 11:55 归来</span>');`
      ]) {
        await setupExp(`addRuns(6);${code}`);
        const before=expeditionRequests;
        await pulse(4*60000);await pulse(5000);
        assert.equal(expeditionRequests,before);
        assert.deepEqual(await evaluate('model.calls'),[]);
      }
    });
    await t.test('本地心跳：状态不变也每15分钟留证据，不发请求且不计为收入', async () => {
      await setupExp('addRuns(6);');
      await until(async()=>(await expStatus())?.includes('今日突发已使用'),'idle status');
      const before=expeditionRequests;
      const count=await evaluate(`${logBucket('expedition')}.counts.heartbeat`);
      await pulse(10*60000);
      assert.equal(await evaluate(`${logBucket('expedition')}.counts.heartbeat`),count);
      await pulse(5*60000);
      assert.equal(await evaluate(`${logBucket('expedition')}.counts.heartbeat`),count+1);
      const heartbeat=await evaluate(`${logBucket('expedition')}.events.filter(e=>e.type==='heartbeat').at(-1)`);
      assert.equal(heartbeat.data.quota.running,6);
      assert.equal(expeditionRequests,before);
      assert.deepEqual(await evaluate(`${logBucket('expedition')}.totals`),{});
    });
    await t.test('远征：重复标签页仅一个运行，关闭后接力', async () => {
      await setupExp('addRuns(6);');
      await until(async () => (await expStatus())?.includes('今日突发已使用'), 'first expedition lock');
      const second = await createTab();
      try {
        await cdp.send('Page.navigate', { url: `${origin}/activities/expedition?second=1` }, second.sessionId);
        await until(() => cdp.evaluate(second.sessionId, `typeof renderExp === 'function'`), 'second expedition page');
        await cdp.evaluate(second.sessionId, source);
        await until(() => cdp.evaluate(second.sessionId, `document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('另一挂机标签页')`), 'second expedition waits');
        assert.deepEqual(await cdp.evaluate(second.sessionId, 'model.calls'), []);
        await cdp.send('Page.navigate', { url: 'about:blank' }, tab.sessionId);
        for (let i = 0; i < 20; i++) {
          await cdp.evaluate(second.sessionId, `clock += 1000; window.dispatchEvent(new Event('focus'));`);
          await delay(160);
          if (await cdp.evaluate(second.sessionId, 'model.runs.length === 6')) break;
        }
        assert.equal(await cdp.evaluate(second.sessionId, 'model.runs.length'), 6);
      } finally { await cdp.send('Target.closeTarget', { targetId: second.targetId }); }
    });
    await t.test('减少重复操作：奇遇原结果逐次延后，刷新保留累计上限，手动开始才恢复', async () => {
      await setup(`window.clock=100000;Date.now=()=>clock;recover('encounter');`);
      await drive(`clicks.length===1`, 'first encounter recovery');
      await pulse(31000);
      assert.deepEqual(await clickLog(), ['recover']);
      await pulse(90000);
      await drive(`clicks.length===2`, 'second encounter recovery');
      const savedClock = await evaluate('clock');
      await cdp.send('Page.reload', {}, tab.sessionId);
      await until(() => evaluate(`typeof base==='function'&&!document.getElementById('ark-auto-expedition')`), 'encounter reload');
      await evaluate(`window.clock=${savedClock};Date.now=()=>clock;Math.random=()=>0;recover('encounter');`);
      await evaluate(source);
      await pulse(31000);
      assert.deepEqual(await clickLog(), [], '刷新不能重置等待');
      await pulse(270000);
      await drive(`clicks.length===1`, 'third recovery after reload');
      await pulse(301000);
      await until(async () => (await status())?.includes('恢复上限'), 'encounter recovery capped');
      await pulse(3600000);
      assert.deepEqual(await clickLog(), ['recover']);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('cultivation:operation:fixture')).idempotencyKey`), 'test-key');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto:account-stop:v1')`), null, '普通故障不升级为账号异常');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click()`);
      await drive(`clicks.length===2`, 'manual encounter resume');
    });

    await t.test('减少重复操作：远征确认三次仍未知则暂停，不新建第二批', async () => {
      await setupExp(`model.resultMode='pending';model.recoveryPending=true;`);
      await drive(`${confirmed}.length===1&&!model.busy`, 'pending expedition');
      for (const [index, wait] of [31000, 121000, 301000].entries()) {
        await pulse(wait);
        await drive(`model.calls.filter(c=>c.type==='recover').length===${index+1}`, 'bounded expedition recovery');
      }
      await pulse(301000);
      await until(async () => (await expStatus())?.includes('恢复上限'), 'expedition cap');
      await pulse(3600000);
      const calls = await evaluate('model.calls');
      assert.equal(calls.filter(c=>c.type==='dispatch').length, 1);
      assert.equal(calls.filter(c=>c.type==='recover').length, 3);
      assert.equal(new Set(calls.map(c=>c.idempotencyKey)).size, 1);
      assert.ok(await evaluate(`sessionStorage.getItem('expedition:77:auto')`));
    });

    await t.test('减少重复操作：农场成熟按钮持续失效只整页刷新一次，随后暂停农场', async () => {
      await setupFarm(`addRuns(6);fm.harvestStale=true;fm.crops=Array.from({length:12},(_,i)=>({plot:i+1,key:'crop-6',name:'蓝莓',at:clock-1}));`, '/farm');
      await drive(`location.pathname==='/activities/expedition'`, 'wait for native farm update away from farm');
      await evaluate(`clock=${farmState}.nextAt;renderExp();`);
      await drive(`location.pathname==='/farm'`, 'farm recovery visit');
      // 模拟 SPA 导航会丢掉测试查询串；重载仍应由本地服务器返回农场 fixture。
      await evaluate(`history.replaceState({},'', '/farm?farm-fixture=ready-recovery');`);
      const snapshot = await evaluate('({fm,model,clock})');
      await drive(`!document.getElementById('ark-auto-expedition')`, 'one farm reload');
      await until(() => evaluate(`typeof renderFarm==='function'&&!document.getElementById('ark-auto-expedition')`), 'farm reloaded document');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderFarm();`);
      await evaluate(source);
      await drive(`location.pathname==='/activities/expedition'`, 'post-reload wait');
      await evaluate(`clock=${farmState}.nextAt;renderExp();`);
      await drive(`localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'&&location.pathname==='/activities/expedition'`, 'farm alone pauses');
      assert.equal(await evaluate(`${farmCalls('harvest')}.length`), 0);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`), 'false');
      const visits = await evaluate(`${farmCalls('navigate')}.length`);
      await pulse(600000);
      assert.equal(await evaluate(`${farmCalls('navigate')}.length`), visits);
      assert.match(await evaluate(`${farmState}.note`), /恢复上限/);
    });

    await t.test('减少重复操作：秘境优先读取原网页倒计时，未知冷却逐步延后', async () => {
      await setupDungeon(`dm.cooledUntil=clock+37*60000;dm.cooldownLabel='秘境冷却 37:00';`, '/cultivate/dungeon');
      const before = await evaluate('clock');
      await drive(`location.pathname==='/cultivate'`, 'known cooldown scheduled');
      assert.ok(await evaluate(`${dungeonState}.nextAt >= ${before}+37*60000`));
      await pulse(60000);
      assert.equal(await evaluate('location.pathname'), '/cultivate');
      await setupDungeon(`dm.cooledUntil=clock+120*60000;`, '/cultivate/dungeon');
      for (const minutes of [5,10,20]) {
        const start = await evaluate('clock');
        await drive(`location.pathname==='/cultivate'`, 'unknown cooldown backs off');
        const next = await evaluate(`${dungeonState}.nextAt`);
        assert.ok(next >= start + minutes*60000 && next < start + minutes*60000 + 10000);
        await evaluate(`clock=${next};renderDun();`);
        await drive(`location.pathname==='/cultivate/dungeon'`, 'next sparse cooldown visit');
      }
      assert.equal(await evaluate('dm.runs'), 0);
    });

    await t.test('减少重复操作：手动暂停再开启仍保留正常秘境冷却和农场成熟预约', async () => {
      await setupDungeon(`localStorage.setItem('arkengine:auto-dungeon:state:v1',JSON.stringify({nextAt:clock+2400000,run:null,deferrals:0}));`);
      const dungeonAt=await evaluate(`${dungeonState}.nextAt`);
      await evaluate(`const button=document.getElementById('ark-auto-expedition').shadowRoot.getElementById('dungeon-toggle');button.click();button.click();`);
      await pulse(10000);
      assert.equal(await evaluate(`${dungeonState}.nextAt`),dungeonAt);
      assert.equal(await evaluate(`dm.calls.filter(call=>call[0]!=='navigate').length`),0);
      await setupFarm(`addRuns(6);localStorage.setItem('arkengine:auto-farm:schedule:v1',JSON.stringify({nextAt:clock+3600000,note:'作物生长中'}));`);
      const farmAt=await evaluate(`${farmState}.nextAt`);
      await evaluate(`const button=document.getElementById('ark-auto-expedition').shadowRoot.getElementById('farm-toggle');button.click();button.click();`);
      await pulse(10000);
      assert.equal(await evaluate(`${farmState}.nextAt`),farmAt);
      assert.equal(await evaluate(`${farmCalls('navigate')}.length`),0);
    });

    await t.test('减少重复操作：秘境持续无进展三轮后暂停，保留门票原请求并回主殿', async () => {
      await setupDungeon(`dm.mode='busy:enter';`);
      await drive(`dm.busy&&!!nativeDun()`, 'dungeon original busy');
      const original = await evaluate('nativeDun()');
      for (let i=0;i<3;i++) {
        await pulse(2000);
        await pulse(91000);
        await drive(`location.pathname==='/cultivate'`, 'stalled dungeon yields');
        if (i<2) {
          await evaluate(`clock=${dungeonState}.nextAt;renderDun();`);
          await drive(`location.pathname==='/cultivate/dungeon'`, 'limited dungeon revisit');
        }
      }
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-dungeon:enabled:v1')`), 'false');
      assert.deepEqual(await evaluate('nativeDun()'), original);
      assert.equal(await evaluate(`dm.calls.filter(c=>c[0]==='enter').length`),1);
      await evaluate('dm.encounter=true;renderDun();');
      await drive(`dm.calls.some(c=>c[0]==='encounter')`, 'encounters continue after dungeon pause');
    });



    await t.test('减少重复操作：额度兜底每天最多两次，正常领取派遣会延后检查', async () => {
      await setupExp(`addRuns(6);`);
      await until(async ()=>(await expStatus())?.includes('今日突发已使用'), 'initial quota observed');
      for (let i=0;i<2;i++) {
        const snapshot=await evaluate('({model,clock:clock+3600000})');
        const before=expeditionRequests;
        await pulse(3600000);
        await drive(`!document.getElementById('ark-auto-expedition')`, 'quota fallback reload');
        await until(()=>expeditionRequests>before,'quota request observed');
        await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'quota document ready');
        await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderExp();`);
        await evaluate(source);
        await until(async ()=>(await expStatus())?.includes('今日突发已使用'), 'quota still incomplete');
      }
      const before=expeditionRequests;
      await pulse(2*3600000);
      await pulse(3000);
      assert.equal(expeditionRequests,before,'第三次兜底不得刷新');
      await evaluate(`model.burst=6;renderExp();`);
      await drive(`${confirmed}.some(c=>c.route==='深渊远征')`, 'native update still catches burst');
      await setupExp(`addRuns(6);`);
      await pulse(50*60000);
      await evaluate(`model.runs.forEach(r=>r.done=true);renderExp();`);
      await drive(`${confirmed}.length===1&&model.runs.length===6`, 'ordinary cycle syncs state');
      await pulse(2000);
      const synced=expeditionRequests;
      await pulse(15*60000);
      await pulse(3000);
      assert.equal(expeditionRequests,synced,'正常操作已更新状态，不按旧截止时间刷新');
    });

    await t.test('减少重复操作：领取结果跨刷新保留，只核对一次后暂停', async () => {
      await setupExp(`addRuns(6,false,true);window.claimRuns=()=>model.calls.push({type:'claim'});`);
      await drive(`model.calls.some(c=>c.type==='claim')`, 'claim submitted');
      const snapshot=await evaluate('({model,clock:clock+33000})');
      await pulse(31000);
      await drive(`!document.getElementById('ark-auto-expedition')`, 'claim recovery reload');
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'claim reloaded');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;window.claimRuns=()=>model.calls.push({type:'claim'});renderExp();`);
      await evaluate(source);
      await pulse(61000);
      await until(async ()=>(await expStatus())?.includes('原领取结果仍无法确认'),'unknown claim paused');
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),1);
      assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:claim:v1')).reloaded`),true);
    });

    const claimJournal = `JSON.parse(sessionStorage.getItem('arkengine:auto-expedition:claim:v1'))`;
    const oldClaim = `sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify({running:6,at:clock-7200000,reloaded:true}));`;
    const networkClaim = `window.claimRuns=()=>{model.calls.push({type:'claim'});
      fetch('/api/activities/expedition-claim-all?network-error=1',{method:'POST'}).catch(()=>{});};`;
    const reloadedNetworkClaim = `sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify({
      running:6,ready:6,at:clock-61000,submittedAt:clock-95000,reloaded:true,reloadFrom:'previous-page',
      retries:0,attemptId:'original-attempt',result:{outcome:'network-error',status:null}}));`;
    const reloadClaimPage = async (after = '') => {
      const snapshot=await evaluate('({model,clock:clock+35000})');
      await pulse(31000);
      await drive(`!document.getElementById('ark-auto-expedition')`,'claim reload');
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'claim fixture reloaded');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;${after};renderExp();`);
      await evaluate(source);
    };
    await t.test('远征后台加载自愈：断网旧领取缺额度时有限刷新五次，恢复后仅补领一次', async () => {
      await setupExp(`addRuns(6,false,true);${reloadedNetworkClaim}
        const renderCurrent=renderExp;window.renderExp=()=>{renderCurrent();
          document.querySelector('[aria-label="远征派遣额度"]').remove();};`);
      const foreground = await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        await until(()=>evaluate('document.hidden'),'claim loading hidden');
        await pulse(1000);
        const original = await evaluate(claimJournal);
        for (const [index,wait] of [90001,300001,900001,3600001,7200001].entries()) {
          const snapshot = await evaluate(`({model,clock:clock+${wait}})`);
          const requests = expeditionRequests;
          await pulse(wait);
          await until(()=>expeditionRequests===requests+1,'bounded pending claim load refresh');
          await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'new loading document');
          await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderExp();
            document.querySelector('[aria-label="远征派遣额度"]').remove();`);
          await evaluate(source);
          await pulse(1000);
          const saved = await evaluate(claimJournal);
          for(const key of ['submittedAt','attemptId','retries','result']) assert.deepEqual(saved[key],original[key],key);
          assert.equal(await evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-page-wait:expedition:v1')).refreshes`),index+1);
          assert.deepEqual(await evaluate('model.calls'),[],'加载恢复不得重复提交领取');
        }
        const requests = expeditionRequests;
        await pulse(13*3600000);
        assert.equal(expeditionRequests,requests,'刷新上限跨页面保留');
        assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'false');
        await evaluate(`model.claimReceipts=['已领取 6 支远征，共获得 565 代币'];renderExp();`);
        await drive(`${confirmed}.length===1&&${claimJournal}===null`,'loading recovered resumes claim and dispatch');
        assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),1);
      } finally { await cdp.send('Target.closeTarget',{targetId:foreground.targetId}); }
    });
    await t.test('远征后台加载自愈：成功响应缺额度也可刷新，队伍已减少时不再领取', async () => {
      await setupExp(`${reloadedNetworkClaim}
        const saved=${claimJournal};saved.result={outcome:'ok',status:200};
        sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify(saved));
        const renderCurrent=renderExp;window.renderExp=()=>{renderCurrent();
          document.querySelector('[aria-label="远征派遣额度"]').remove();};`);
      await until(()=>evaluate(`!!sessionStorage.getItem('arkengine:auto-page-wait:expedition:v1')`),
        'successful claim enters loading wait before advancing clock');
      const snapshot=await evaluate('({model,clock:clock+92000})');
      const requests=expeditionRequests;
      await pulse(92000);
      await until(()=>expeditionRequests===requests+1,'success response permits read-page recovery');
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'fresh successful-claim page');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderExp();`);
      await evaluate(source);
      await drive(`${confirmed}.length===1&&${claimJournal}===null`,'successful claim reconciled');
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),0);
    });
    await t.test('远征后台加载自愈：离线、暂停、弹窗、原派遣和未知响应均不得刷新或重领', async () => {
      const guards = [
        `Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});`,
        `localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');`,
        `const modal=document.createElement('div');modal.setAttribute('role','dialog');modal.hidden=true;document.body.append(modal);`,
        `sessionStorage.setItem('expedition:77:auto',JSON.stringify({input:{route:'边境巡逻'},idempotencyKey:'test-pending'}));`,
        `sessionStorage.setItem('arkengine:auto-farm:pending:v1',JSON.stringify({action:'harvest',plots:[1],at:clock-1000}));`,
        `localStorage.setItem('arkengine:auto:account-stop:v1','账号异常，等待人工处理');`,
        `const saved=${claimJournal};delete saved.result;sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify(saved));`,
        `const saved=${claimJournal};saved.result={outcome:'http-error',status:400};sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify(saved));`,
      ];
      const foreground=await createTab();
      try {
        for (const guard of guards) {
          await setupExp(`addRuns(6,false,true);${reloadedNetworkClaim}${guard}
            const renderCurrent=renderExp;window.renderExp=()=>{renderCurrent();
              document.querySelector('[aria-label="远征派遣额度"]').remove();};`);
          await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
          await until(()=>evaluate('document.hidden'),'guarded loading page hidden');
          const requests=expeditionRequests;
          const saved=await evaluate(claimJournal);
          await pulse(13*3600000);
          assert.equal(expeditionRequests,requests,guard);
          assert.deepEqual(await evaluate(claimJournal),saved,'原记录完整保留');
          assert.deepEqual(await evaluate('model.calls'),[],'不重复领取或派遣');
        }
      } finally { await cdp.send('Target.closeTarget',{targetId:foreground.targetId}); }
    });
    await t.test('远征后台加载自愈：已补领一次再加载恢复不能重置补领预算', async () => {
      await setupExp(`addRuns(6,false,true);${reloadedNetworkClaim}
        const saved=${claimJournal};saved.retries=1;
        sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify(saved));
        const renderCurrent=renderExp;window.renderExp=()=>{renderCurrent();
          document.querySelector('[aria-label="远征派遣额度"]').remove();};`);
      await until(()=>evaluate(`JSON.parse(sessionStorage.getItem('arkengine:auto-page-wait:expedition:v1'))?.recoverable===true`),'recoverable load timer started before advancing clock');
      const snapshot=await evaluate('({model,clock:clock+92000})');
      const requests=expeditionRequests;
      await pulse(92000);
      await until(()=>expeditionRequests===requests+1,'retry spent page reload');
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'retry spent fresh page');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderExp();`);
      await evaluate(source);
      await pulse(61000);
      await until(async()=>/补领一次后仍未确认/.test(await expStatus()),'spent retry remains stopped');
      assert.equal(await evaluate(`${claimJournal}.retries`),1);
      assert.deepEqual(await evaluate('model.calls'),[]);
    });
    await t.test('远征领取断网：请求失败后先刷新，完整待领列表稳定后仅补领一次并继续派遣', async () => {
      await setupExp(`addRuns(6,false,true);${networkClaim}`);
      await drive(`model.calls.length===1`,'initial batch claim');
      await until(()=>evaluate(`${claimJournal}?.result?.outcome==='network-error'`),'capture original network result');
      await pulse(1000);
      assert.match(await expStatus(),/网络错误/);
      await reloadClaimPage(`model.claimReceipts=['已领取 6 支远征，共获得 573 代币'];`);
      await pulse(59000);
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),1,'核对期内不得补领');
      await pulse(3000);
      await drive(`${confirmed}.length===1&&${claimJournal}===null`,'retry claim then dispatch');
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),2);
      await until(()=>evaluate(`${logBucket('expedition')}.totals['代币']===573`),'one confirmed reward');
      assert.equal(await evaluate(`${logBucket('expedition')}.counts['expedition-claim-retry']`),1);
    });
    await t.test('远征领取断网：服务器已经完成但响应丢失，刷新后只核对不补领', async () => {
      await setupExp(`addRuns(6,false,true);${networkClaim}`);
      await drive('model.calls.length===1','lost response');
      await until(()=>evaluate(`${claimJournal}?.result?.outcome==='network-error'`),'failure captured');
      await reloadClaimPage('model.runs=[];');
      await drive(`${confirmed}.length===1&&${claimJournal}===null`,'server completion reconciled');
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),1);
      assert.equal(await evaluate(`${logBucket('expedition')}.totals['代币']||0`),0,'无回执不推测收入');
    });
    await t.test('远征领取断网：补领失败保留次数，刷新与手动开始均不重置写入预算', async () => {
      await setupExp(`addRuns(6,false,true);${reloadedNetworkClaim}${networkClaim}`);
      await drive('model.calls.length===1','one retry');
      await until(()=>evaluate(`${claimJournal}?.result?.outcome==='network-error'`),'retry failed');
      await pulse(61000);
      await until(async()=>/补领一次后仍未确认/.test(await expStatus()),'retry limit pause');
      assert.equal(await evaluate(`${claimJournal}.retries`),1);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click()`);
      await reloadClaimPage(networkClaim);
      await pulse(61000);
      assert.match(await expStatus(),/补领一次后仍未确认/);
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),1,'不得再提交第三次领取');
    });
    await t.test('远征领取断网：离线等待，恢复后重新稳定核对；人工暂停撤销补领', async () => {
      await setupExp(`addRuns(6,false,true);${reloadedNetworkClaim}
        Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});`);
      await pulse(120000);
      assert.match(await expStatus(),/网络离线/);
      assert.equal(await evaluate('model.calls.length'),0);
      await evaluate(`Object.defineProperty(navigator,'onLine',{get:()=>true});window.dispatchEvent(new Event('online'));`);
      await pulse(1000);
      assert.equal(await evaluate('model.calls.length'),0);
      await pulse(2000);
      assert.match(await expStatus(),/随机等待/);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click()`);
      await pulse(10000);
      assert.equal(await evaluate('model.calls.length'),0);
    });
    await t.test('远征领取断网：加载、旧副本、数量不符、HTTP成功或拒绝均不触发补领', async () => {
      for(const code of [
        `document.querySelector('#running').insertAdjacentHTML('beforeend','<span class="animate-spin"></span>');`,
        `document.querySelector('#running').hidden=true;`,
        `document.querySelector('#running button').textContent='一键领取（5）';`,
        `document.querySelector('#running button').disabled=true;`,
        `model.runs[0].done=false;renderOriginal();`,
        `model.error=true;model.message='领取失败';renderOriginal();`,
        `const record=${claimJournal};record.reloadFrom='same-page';crypto.randomUUID=()=> 'same-page';sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify(record));`,
        `const record=${claimJournal};record.result={outcome:'ok',status:200};sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify(record));`,
        `const record=${claimJournal};record.result={outcome:'http-error',status:403};sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify(record));`
      ]) {
        await setupExp(`addRuns(6,false,true);${reloadedNetworkClaim}renderExp();
          const renderOriginal=renderExp;window.renderExp=()=>{renderOriginal();${code}};`);
        await pulse(10000);
        assert.equal(await evaluate('model.calls.length'),0,code);
        assert.notEqual(await evaluate(claimJournal),null);
      }
    });
    await t.test('远征领取断网：旧版待领记录只凭同次请求网络错误迁移，重新刷新后恢复', async () => {
      await setupExp(`addRuns(6,false,true);${oldClaim}
        const at=clock-7200000;
        const oldRecord=${claimJournal};oldRecord.submittedAt=at;oldRecord.at=clock-3000;
        sessionStorage.setItem('arkengine:auto-expedition:claim:v1',JSON.stringify(oldRecord));
        localStorage.setItem('arkengine:auto-log:v1:expedition:2026-10-10',JSON.stringify({events:[
          {at,group:'expedition',pageId:'old-page',type:'action',data:{kind:'claim'}},
          {at:at+5000,group:'expedition',pageId:'old-page',type:'request-result',data:{
            path:'/api/activities/expedition-claim-all',startedAt:at,status:null,outcome:'network-error'}}]}));`);
      await until(()=>evaluate(`${claimJournal}?.result?.outcome==='network-error'`),'legacy request evidence');
      assert.equal(await evaluate(`${claimJournal}.reloaded`),false,'旧刷新标记必须重新核对');
      await reloadClaimPage();
      await pulse(61000);
      await drive(`${confirmed}.length===1`,'legacy claim recovered');
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),1);
    });
    await t.test('远征领取断网：其他页面的网络错误不能授权旧记录补领', async () => {
      await setupExp(`addRuns(6,false,true);${oldClaim}
        const at=clock-7200000;
        localStorage.setItem('arkengine:auto-log:v1:expedition:2026-10-10',JSON.stringify({events:[
          {at,group:'expedition',pageId:'old-page',type:'action',data:{kind:'claim'}},
          {at:at+5000,group:'expedition',pageId:'different-page',type:'request-result',data:{
            path:'/api/activities/expedition-claim-all',startedAt:at,status:null,outcome:'network-error'}}]}));`);
      await pulse(10000);
      await until(async()=>/原领取结果仍无法确认/.test(await expStatus()),'legacy log lookup rejects another page');
      assert.match(await expStatus(),/原领取结果仍无法确认/);
      assert.equal(await evaluate('model.calls.length'),0);
      assert.equal(await evaluate(`${claimJournal}.result`),undefined);
    });
    await t.test('远征领取断网：单队领取遇到服务器暂时错误，刷新后按当前按钮恢复', async () => {
      await setupExp(`addRuns(1,false,true);addRuns(5);
        window.claimRuns=()=>{model.calls.push({type:'claim'});
          fetch('/api/activities?code=503',{method:'POST'}).catch(()=>{});};`);
      await drive('model.calls.length===1','single claim submitted');
      await until(()=>evaluate(`${claimJournal}?.result?.status===503`),'single HTTP result captured');
      await reloadClaimPage();
      await pulse(61000);
      await drive(`${confirmed}.length===1&&${claimJournal}===null`,'single claim recovery');
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),2);
      assert.equal(await evaluate(`${confirmed}[0].normal`),1);
    });
    await t.test('远征领取断网：账号限流立即暂停，其他手动请求不归入脚本领取记录', async () => {
      await setupExp(`addRuns(6,false,true);window.claimRuns=()=>model.calls.push({type:'claim'});`);
      await drive('model.calls.length===1','unknown claim');
      await evaluate(`fetch('/api/activities/expedition-claim-all?network-error=1',{method:'POST'}).catch(()=>{});`);
      await pulse(1000);
      assert.equal(await evaluate(`${claimJournal}.result`),undefined,'独立手动请求不能成为本次领取错误证据');
      await setupExp(`addRuns(6,false,true);window.claimRuns=()=>{model.calls.push({type:'claim'});
        fetch('/api/activities/expedition-claim-all?code=429',{method:'POST'}).catch(()=>{});};`);
      await drive('model.calls.length===1','rate-limited claim');
      await until(()=>evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')==='false'`),'account paused');
      await pulse(120000);
      assert.match(await expStatus(),/429/);
      assert.equal(await evaluate('model.calls.length'),1);
      assert.equal(await evaluate(`${claimJournal}.retries`),0);
    });
    await t.test('远征领取恢复：相同队伍数已全为新行程时解除旧等待', async () => {
      await setupExp(`addRuns(6);${oldClaim}`);
      await until(()=>evaluate(`${claimJournal}===null`),'old claim no longer has completed targets',2000);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),null);
      assert.equal(await evaluate('model.calls.length'),0,'不能补领或新派一批');
      assert.ok(await evaluate(`${logBucket('expedition')}.events.some(e=>e.type==='expedition-claim-reconciled')`));
      await evaluate('model.runs.forEach(r=>r.done=true);renderExp();');
      await drive(`model.calls.some(c=>c.type==='claim') && model.calls.some(c=>c.type==='dispatch')`,'next round remains usable');
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),1);
    });
    await t.test('远征领取恢复：点击开始重新核对，保留原记录且不立即重复领取', async () => {
      await setupExp(`addRuns(6,false,true);${oldClaim}
        localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');
        window.claimRuns=()=>model.calls.push({type:'claim'});`);
      const original=await evaluate(claimJournal);
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();`);
      await pulse(2000);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'true');
      assert.equal(await evaluate(`${claimJournal}.submittedAt`),original.at);
      assert.equal(await evaluate(`${claimJournal}.reloaded`),false);
      assert.equal(await evaluate('model.calls.length'),0);
      const snapshot=await evaluate('({model,clock:clock+35000})');
      await pulse(31000);
      await drive(`!document.getElementById('ark-auto-expedition')`,'explicit restart permits one state reload');
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'claim restart reload');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});Math.random=()=>0;renderExp();`);
      await evaluate(source);
      await pulse(61000);
      await until(async ()=>(await expStatus())?.includes('原领取结果仍无法确认'),'still ambiguous pauses again');
      assert.equal(await evaluate('model.calls.length'),0,'核对只刷新，不重新领取');
      assert.equal(await evaluate(`${claimJournal}.submittedAt`),original.at);
    });
    await t.test('远征领取恢复：暂停期间手动领取再派满，开始后正常等待新行程', async () => {
      await setupExp(`addRuns(6);${oldClaim}localStorage.setItem('arkengine:auto-expedition:enabled:v1','false');
        model.message='已领取 6 支远征，共获得 573 代币';`);
      await pulse(5000);
      assert.notEqual(await evaluate(claimJournal),null,'暂停不自行恢复');
      await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();`);
      await until(()=>evaluate(`${claimJournal}===null`),'manual new batch reconciles');
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'true');
      assert.equal(await evaluate('model.calls.length'),0);
      assert.equal(await evaluate(`${logBucket('expedition')}.totals['代币']||0`),0,'不凭旧回执补记收益');
    });
    await t.test('远征领取恢复：旧回执、部分待领、加载或额度列表不一致不清除记录', async () => {
      for(const code of [
        `model.runs[0].done=true;model.message='已领取 6 支远征，共获得 573 代币';`,
        `window.renderExtra=()=>document.querySelector('#running').insertAdjacentHTML('beforeend','<span class="animate-spin"></span>');`,
        `window.renderExtra=()=>document.querySelector('#running button').parentElement.remove();`,
        `window.renderExtra=()=>document.querySelector('#running').hidden=true;`,
        `model.error=true;model.message='领取失败';`
      ]) {
        await setupExp(`addRuns(6);${oldClaim}${code}
          const renderBase=renderExp;window.renderExp=()=>{renderBase();window.renderExtra?.();};`);
        await pulse(2000);
        assert.notEqual(await evaluate(claimJournal),null);
        assert.equal(await evaluate('model.calls.length'),0);
      }
    });
    await t.test('远征领取恢复：真实领取处理中不清记录，完成后继续派遣', async () => {
      await setupExp(`addRuns(6,false,true);
        window.claimRuns=()=>{model.calls.push({type:'claim'});model.runs.forEach(r=>r.done=false);renderExp();
          document.querySelector('#running').insertAdjacentHTML('beforeend','<span class="animate-spin"></span>');};`);
      await drive(`model.calls.some(c=>c.type==='claim')`,'claim starts');
      await pulse(5000);
      assert.notEqual(await evaluate(claimJournal),null);
      await evaluate('model.runs=[];renderExp();');
      await drive(`model.calls.some(c=>c.type==='dispatch')`,'claim ends');
      assert.equal(await evaluate(`model.calls.filter(c=>c.type==='claim').length`),1);
    });
    await t.test('减少重复操作：账号异常跨标签暂停，单页总开关与奇遇分别恢复', async () => {
      await setupExp(`addRuns(6);`);
      const cultivate=await createTab();
      try {
        await cdp.send('Page.navigate',{url:`${origin}/cultivate?shared-stop=1`},cultivate.sessionId);
        await until(()=>cdp.evaluate(cultivate.sessionId,`typeof choices==='function'`),'shared-stop cultivation');
        await cdp.evaluate(cultivate.sessionId,`window.clock=100000;Date.now=()=>clock;Math.random=()=>0;choices(['修为 +1','钻石 +2']);`);
        await cdp.evaluate(cultivate.sessionId,source);
        await until(()=>cdp.evaluate(cultivate.sessionId,`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('另一挂机标签页')`),'cultivation waits for owner');
        await evaluate(`model.runs.forEach(r=>r.done=true);renderExp();`);
        await until(async ()=>(await expStatus())?.includes('随机等待'),'expedition claim queued');
        await cdp.evaluate(cultivate.sessionId,`notice('429 请求过于频繁',true);`);
        await until(async ()=>(await expStatus())?.includes('异常，已暂停全部'),'cross-tab account stop');
        await pulse(10000);
        await cdp.evaluate(cultivate.sessionId,`clock+=10000;window.dispatchEvent(new Event('focus'));`);
        await delay(200);
        assert.deepEqual(await evaluate('model.calls'),[]);
        assert.deepEqual(await cdp.evaluate(cultivate.sessionId,'clicks'),[]);
        await cdp.send('Page.navigate',{url:'about:blank'},tab.sessionId);
        await cdp.evaluate(cultivate.sessionId,`document.querySelector('.text-destructive').remove();document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();`);
        await cdp.evaluate(cultivate.sessionId,`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('cultivate-toggle').click();`);
        for(let i=0;i<4;i++) {
          await cdp.evaluate(cultivate.sessionId,`clock+=1000;window.dispatchEvent(new Event('focus'));`);
          await delay(160);
        }
        assert.deepEqual(await cdp.evaluate(cultivate.sessionId,'clicks'),[1]);
        assert.equal(await cdp.evaluate(cultivate.sessionId,`localStorage.getItem('arkengine:auto-expedition:enabled:v1')`),'true');
      } finally { await cdp.send('Target.closeTarget',{targetId:cultivate.targetId}); }
    });

    const noticeFixture = (title = '系统公告', buttons = '<button>知道了</button>', body = '本次维护已完成。') => `
      window.noticeClicks=0;window.notice=document.createElement('div');notice.setAttribute('role','dialog');
      notice.innerHTML=${JSON.stringify(`<h2>${title}</h2><p>${body}</p>${buttons}`)};
      notice.querySelectorAll('button').forEach(button=>button.onclick=()=>{noticeClicks++;notice.remove();});
      document.body.append(notice);`;
    await t.test('信息通知：主殿、秘境、远征和农场只关闭通知并继续原任务', async () => {
      for(const route of ['hall','dungeon','expedition','farm']) {
        if(route==='hall') await setupDungeon(noticeFixture());
        if(route==='dungeon') await setupDungeon(noticeFixture('更新说明'),'/cultivate/dungeon');

        if(route==='expedition') await setupExp(noticeFixture('公告','<button aria-label="关闭">×</button><button>我知道了</button>'));
        if(route==='farm') await setupFarm(`addRuns(6);${noticeFixture()}`,'/farm');
        await until(async()=>((route==='farm'||route==='expedition')?await expStatus():await status())?.includes('信息通知'),'notice queued');
        assert.equal(await evaluate('noticeClicks'),0,'关闭通知也保留随机等待');
        await drive('noticeClicks===1','notice dismissed');
        if(route==='expedition') await drive('model.runs.length===6','dispatch resumes');
        if(route==='dungeon') await drive('dm.runs===1','dungeon resumes');
        if(route==='farm') await drive(`${farmCalls('plant')}.length===1`,'farm resumes');
        assert.equal(await evaluate('noticeClicks'),1);
        const group=['expedition','farm'].includes(route)?'expedition':'cultivate';
        const events=await evaluate(`(await window.__arkTestLogs.read('${group}',undefined,Infinity)).events`);
        assert.equal(events.filter(e=>e.type==='notice-dismiss').length,1);
        assert.equal(JSON.stringify(events.filter(e=>e.type==='dialog-observed')).includes('本次维护已完成'),false,'不记录通知正文');
      }
    });
    await t.test('信息通知：未知标题、确认按钮、输入、登录、消费及多弹窗保留人工处理', async () => {
      const cases=[
        noticeFixture('其他事项'),noticeFixture('提示','<button>确认</button>'),
        noticeFixture('提示','<input><button>关闭</button>'),
        noticeFixture('提示',undefined,'请重新登录'),noticeFixture('系统公告',undefined,'购买礼包需要支付代币'),
        noticeFixture()+`document.body.append(notice.cloneNode(true));`
      ];
      for(const fixture of cases) {
        await setupExp(fixture);
        await until(async()=>(await expStatus())?.includes('处理当前弹窗'),'manual popup preserved');
        await pulse(10000);
        assert.equal(await evaluate('noticeClicks'),0);
        assert.equal(await evaluate('notice.isConnected'),true);
        assert.deepEqual(await evaluate('model.calls'),[]);
        const observed=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.filter(e=>e.type==='dialog-observed')`);
        assert.equal(observed.length,1,'相同弹窗不逐秒重复记录');
        assert.notEqual(observed[0].data.reason,'notice');
      }
    });
    await t.test('信息通知：等待关闭时重新核对替换窗口、人工暂停和账号异常', async () => {
      for(const group of ['cultivate','expedition']) for(const change of ['replace','pause','account']) {
        if(group==='cultivate') await setupDungeon(noticeFixture(),'/cultivate/dungeon');
        else await setupExp(noticeFixture());
        const readStatus=group==='cultivate'?status:expStatus;
        await until(async()=>(await readStatus())?.includes('信息通知'),'notice close queued');
        if(change==='replace') await evaluate(`notice.innerHTML='<h2>提示</h2><button>确认支付</button>';notice.firstElementChild.nextElementSibling.onclick=()=>noticeClicks++;`);
        if(change==='pause') await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click();`);
        if(change==='account') await evaluate(`const error=document.createElement('div');error.setAttribute('role','alert');error.className='text-destructive';error.textContent='401 登录失效';document.body.append(error);`);
        await pulse(10000);
        assert.equal(await evaluate('noticeClicks'),0);
        assert.equal(await evaluate('notice.isConnected'),true);
      }
    });
    await t.test('信息通知：关闭后窗口未消失也只点击一次，后台恢复后继续', async () => {
      await setupExp(noticeFixture()+`notice.querySelector('button').onclick=()=>noticeClicks++;`);
      const foreground=await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        await drive('noticeClicks===1','background notice close');
        await pulse(30000);await pulse(30000);
        assert.equal(await evaluate('noticeClicks'),1);
        assert.deepEqual(await evaluate('model.calls'),[]);
        await evaluate('notice.remove()');
        await drive('model.runs.length===6','background dispatch after notice gone');
      } finally {await cdp.send('Target.closeTarget',{targetId:foreground.targetId});}
    });
    await t.test('额度诊断：后台隐藏的额度不触发刷新，恢复可见后继续派遣', async () => {
      await setupExp(`const renderCurrent=renderExp;window.renderExp=()=>{renderCurrent();if(!window.showQuota){const quota=document.querySelector('[aria-label="远征派遣额度"]'),wrapper=document.createElement('div');wrapper.hidden=true;quota.before(wrapper);wrapper.append(quota);}};`);
      const foreground=await createTab();
      try{
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});await until(()=>evaluate('document.hidden'),'hidden expedition');
        const initial=expeditionRequests;await pulse(90001);await pulse(300001);
        assert.equal(expeditionRequests,initial);assert.deepEqual(await evaluate('model.calls'),[]);
        await cdp.send('Target.activateTarget',{targetId:tab.targetId});await evaluate('window.showQuota=true;renderExp()');
        await drive('model.runs.length===6','restored quota dispatch');
      }finally{await cdp.send('Target.closeTarget',{targetId:foreground.targetId});}
    });

    await t.test('额度诊断：记录不可读祖先原因且不读取隐藏额度，恢复后继续', async () => {
      for(const hidden of ['hidden','display','aria-hidden','visibility']) {
        await setupExp(`const renderCurrent=renderExp;window.renderExp=()=>{renderCurrent();
          window.quota=document.querySelector('section[aria-label="远征派遣额度"]');
          window.wrapper=document.createElement('div');quota.before(wrapper);wrapper.append(quota);
          ${hidden==='hidden'?"wrapper.hidden=true;":hidden==='display'?"wrapper.style.display='none';":hidden==='visibility'?"wrapper.style.visibility='hidden';":"wrapper.setAttribute('aria-hidden','true');"}};`);
        await until(async()=>(await expStatus())?.includes('等待远征页面和额度加载'),'quota blocked');
        const blocked=await evaluate(`(await window.__arkTestLogs.read('expedition',undefined,Infinity)).events.find(e=>e.type==='expedition-blocked')`);
        assert.equal(blocked.data.quotaRead.readable,false);
        assert.equal(blocked.data.quotaRead.layout.length,1);
        const blockers=blocked.data.quotaRead.layout[0].blockers;
        assert.ok(blockers.some(b=>b.depth===1&&(hidden==='hidden'?b.hidden:hidden==='display'?b.display==='none':hidden==='visibility'?b.visibility==='hidden':b.ariaHidden)));
        assert.deepEqual(await evaluate('model.calls'),[]);
        await evaluate(`window.renderExp=renderCurrent;wrapper.hidden=false;wrapper.removeAttribute('style');wrapper.removeAttribute('aria-hidden');`);
        await drive('model.runs.length===6','layout restored dispatches');
      }
    });

    await t.test('奇遇与远征：不同标签页统一互斥，总暂停同时生效', async () => {
      await setupExp();
      await drive('model.runs.length === 6', 'expedition running');
      const cultivate = await createTab();
      try {
        await cdp.send('Page.navigate', { url: `${origin}/cultivate?parallel=1` }, cultivate.sessionId);
        await until(() => cdp.evaluate(cultivate.sessionId, `typeof choices === 'function'`), 'parallel cultivation page');
        await cdp.evaluate(cultivate.sessionId, `localStorage.setItem('arkengine:auto-encounter:enabled:v1','true'); Math.random = () => 0; choices(['修为 +1','修为 +2','钻石 +1']);`);
        await cdp.evaluate(cultivate.sessionId, source);
        await until(()=>cdp.evaluate(cultivate.sessionId,`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('另一挂机标签页')`),'one shared owner');
        await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click()`);
        await until(()=>cdp.evaluate(cultivate.sessionId,`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent==='已暂停'`),'global pause reaches second tab');
        assert.deepEqual(await cdp.evaluate(cultivate.sessionId, 'clicks'), []);
        assert.equal(await evaluate('model.runs.length'), 6);
        assert.equal(await cdp.evaluate(cultivate.sessionId, `document.getElementById('ark-auto-expedition').hidden`), false);
        assert.equal(await evaluate(`document.getElementById('ark-auto-expedition').hidden`), false);
      } finally { await cdp.send('Target.closeTarget', { targetId: cultivate.targetId }); }
    });
  } finally {
    try {
      if (runtime) {
        await runtime.close(cdp ? () => cdp.send('Browser.close') : undefined);
        t.diagnostic(`本次测试临时目录已清理：${runtime.profile}`);
      }
    } finally {
      cdp?.socket.close();
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
  }
});
