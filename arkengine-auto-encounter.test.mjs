import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { expeditionMarkup } from './arkengine-expedition.fixture.mjs';
import { dungeonMarkup } from './arkengine-dungeon.fixture.mjs';
import { farmMarkup } from './arkengine-farm.fixture.mjs';
import { fogMarkup } from './arkengine-fog.fixture.mjs';

// 无第三方依赖。使用独立的无头浏览器和本地模拟页面，不连接游戏、不使用玩家账号。
const source = await readFile(new URL('./arkengine-auto-encounter.user.js', import.meta.url), 'utf8');
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
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
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

test('自动奇遇、秘境、迷雾、远征与农场：真实 Chromium DOM 集成检查', { timeout: 600000 }, async t => {
  let expeditionRequests = 0;
  const server = createServer((req, res) => {
    const expedition = req.url.startsWith('/activities/expedition');
    if (expedition) expeditionRequests++;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.url.includes('fog-fixture') ? fogMarkup : req.url.includes('farm-fixture') ? farmMarkup : expedition ? expeditionMarkup : req.url.includes('dungeon-fixture') ? dungeonMarkup : markup);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = await mkdtemp(join(tmpdir(), 'ark-encounter-browser-'));
  const browser = spawn(executable, ['--headless=new', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });
  let cdp;
  try {
    const portFile = join(profile, 'DevToolsActivePort');
    await until(() => existsSync(portFile), 'Chrome debugging port', 15000);
    const [port, wsPath] = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
    const socket = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    cdp = new CDP(socket);
    const createTab = async () => {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      return { targetId, sessionId };
    };
    const tab = await createTab();
    const evaluate = expression => cdp.evaluate(tab.sessionId, expression);
    const status = () => evaluate(`document.getElementById('ark-auto-encounter')?.shadowRoot.getElementById('status').textContent`);
    const clickLog = () => evaluate('clicks');
    let pageSerial = 0;
    const setup = async (code = '', path = '/cultivate') => {
      await cdp.send('Page.navigate', { url: `${origin}${path}?test=${++pageSerial}` }, tab.sessionId);
      await until(() => evaluate(`location.search === '?test=${pageSerial}' && typeof window.base === 'function'`), 'fixture ready');
      await evaluate(`localStorage.clear(); sessionStorage.clear(); Math.random = () => 0; ${code}`);
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
      await evaluate(`document.getElementById('ark-auto-encounter').shadowRoot.getElementById('toggle').click(); clock = 20000; game.append(document.createElement('hr'));`);
      await until(async () => (await status()) === '已暂停', 'cancel queued choice');
      assert.deepEqual(await clickLog(), []);
      await evaluate(`document.getElementById('ark-auto-encounter').shadowRoot.getElementById('toggle').click()`);
      await until(async () => (await status())?.includes('随机等待 2.0 秒'), 'resume with fresh delay');
      assert.deepEqual(await clickLog(), []);
      await evaluate(`clock = 22000; game.append(document.createElement('hr'));`);
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
      await setup(`window.removeAfterChoice = true; window.round = 0; seek.onclick = () => { clicks.push('seek'); seek.disabled = true; seek.textContent = '奇遇冷却 5:30'; choices(++round === 1 ? ['修为 +20', '修为 +5'] : ['修为 +20', '修为 +5', '修为 +10']); };`);
      await until(async () => (await status())?.includes('奇遇冷却'), 'cooldown');
      assert.deepEqual(await clickLog(), []);
      await evaluate(`seek.textContent = '寻找奇遇'; seek.disabled = false;`);
      await until(async () => (await clickLog()).length === 2, 'first round', 15000);
      assert.deepEqual(await clickLog(), ['seek', 0]);
      await until(async () => (await status())?.includes('奇遇冷却'), 'next cooldown');
      await evaluate(`seek.textContent = '寻找奇遇'; seek.disabled = false;`);
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
      await evaluate(`document.getElementById('ark-auto-encounter').shadowRoot.getElementById('toggle').click()`);
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
      await until(async () => (await clickLog()).length === 3, 'retry choice');
      assert.deepEqual(await clickLog(), [2, 'refresh', 2]);
    });
    await t.test('其他路径不点击，SPA 进入主殿后启动', async () => {
      await setup(`choices(['修为 +1', '修为 +2', '修为 +3']);`, '/farm');
      await delay(400);
      assert.deepEqual(await clickLog(), []);
      assert.equal(await evaluate(`document.getElementById('ark-auto-encounter').hidden`), true);
      await evaluate(`history.pushState({}, '', '/cultivate'); game.append(document.createElement('hr'));`);
      await expectClick(2);
    });
    await t.test('两个标签页只允许一个自动操作，关闭后接力', async () => {
      await setup();
      await until(async () => (await status())?.includes('奇遇冷却'), 'first tab owns lock');
      const second = await createTab();
      try {
        await cdp.send('Page.navigate', { url: `${origin}/cultivate?second=1` }, second.sessionId);
        await until(() => cdp.evaluate(second.sessionId, `location.search === '?second=1' && typeof base === 'function'`), 'second fixture');
        await cdp.evaluate(second.sessionId, `choices(['修为 +1', '修为 +2', '修为 +3']);`);
        await cdp.evaluate(second.sessionId, source);
        await until(() => cdp.evaluate(second.sessionId, `document.getElementById('ark-auto-encounter').shadowRoot.getElementById('status').textContent.includes('另一游戏标签页')`), 'second tab waits');
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
      await evaluate(`localStorage.clear(); sessionStorage.clear(); Math.random = () => 0; model.burst=0; ${code}; renderExp();`);
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
      throw new Error(`${label}: ${await expStatus()} / ${await status()}`);
    };
    const confirmed = `model.calls.filter(c => c.type === 'dispatch')`;

    const farmState = `JSON.parse(localStorage.getItem('arkengine:auto-farm:schedule:v1'))`;
    const farmCalls = type => `fm.calls.filter(c=>c.type==='${type}')`;
    const setupFarm = async (code = '', path = '/activities/expedition') => {
      await cdp.send('Page.navigate', { url:`${origin}${path}?farm-fixture=${++pageSerial}` },tab.sessionId);
      await until(()=>evaluate(`location.search==='?farm-fixture=${pageSerial}' && typeof renderFarm==='function'`),'farm fixture');
      await evaluate(`localStorage.clear();sessionStorage.clear();Math.random=()=>0;model.burst=0;${code};
        if(location.pathname==='/farm')renderFarm();else renderExp();`);
      await evaluate(source);
    };
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
    await t.test('农场：体力不足时预约恢复再返回远征，不发出失败的批量种植', async () => {
      await setupFarm('addRuns(6);fm.stamina=5;fm.nextRegen=120;', '/farm');
      await drive(`location.pathname==='/activities/expedition'`,'wait stamina');
      const state=await evaluate(farmState);
      assert.match(state.note,/12 点再种植/);
      assert.deepEqual(await evaluate(farmCalls('plant')),[]);
      assert.equal(await evaluate('fm.reads'),0);
      await evaluate(`clock=${state.nextAt};fm.stamina=12;renderExp();`);
      await drive(`fm.crops.length===12 && location.pathname==='/activities/expedition'`,'plant after stamina regeneration');
      assert.equal(await evaluate('fm.stamina'),0);
    });
    const oldStaminaWait = `localStorage.setItem('arkengine:auto-farm:schedule:v1',JSON.stringify({nextAt:clock+15*60000,note:'等待体力恢复到 12 点再种植'}));`;
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
    await t.test('农场体力：顶部旧12但农场8时只检查一次，不反复切页或查询接口', async () => {
      await setupFarm(`addRuns(6);fm.stamina=8;fm.headerStamina=12;${oldStaminaWait}`);
      await drive(`${farmCalls('navigate')}.length===2&&location.pathname==='/activities/expedition'`,'stale top value checked once',20);
      const nextAt=await evaluate(`${farmState}.nextAt`);
      await pulse(5*60000);
      assert.equal(await evaluate('fm.reads'),0);
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
      assert.equal(await evaluate('fm.reads'),0);
      await evaluate('fm.stamina=13;fm.headerStamina=13;renderExp();');
      await drive(`fm.crops.length===12`,'new displayed value allows another check');
      assert.equal(await evaluate('fm.reads'),1);
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
      await drive(`localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'`,'failed planting preflight');
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      assert.equal(await evaluate('fm.reads'),1);
    });
    await t.test('农场体力：顶部和农场都残留12但接口只有8时不种植', async () => {
      await setupFarm(`addRuns(6);fm.stamina=12;fm.headerStamina=12;fm.apiStamina=8;${oldStaminaWait}`);
      await drive(`localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'`,'authoritative preflight rejects stale farm display');
      assert.equal(await evaluate(`${farmCalls('plant')}.length`),0);
      assert.equal(await evaluate('fm.reads'),1);
      assert.match(await evaluate(`${farmState}.note`),/最新体力不足/);
    });
    await t.test('农场：状态接口401、403或429时整组暂停，远征归来后也不再自动请求', async () => {
      for(const statusCode of [401,403,429]) {
        await setupFarm(`addRuns(6);fm.httpStatus=${statusCode};`);
        await drive(`localStorage.getItem('arkengine:auto-expedition:enabled:v1')==='false'`,'farm HTTP error stops expedition group');
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
        await drive(`localStorage.getItem('arkengine:auto-farm:enabled:v1')==='false'`,'farm pause on missing data');
        assert.deepEqual(await evaluate(farmCalls('plant')),[]);
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
      // 新场景不能继承上一场景保存的游戏模型。
      await evaluate(`localStorage.clear(); sessionStorage.clear();`);
      await cdp.send('Page.reload', {}, tab.sessionId);
      await until(() => evaluate(`typeof renderDun === 'function' && !document.getElementById('ark-auto-encounter')`), 'fresh dungeon document');
      await evaluate(`Math.random = () => 0; ${code}; renderDun();`);
      await evaluate(source);
    };

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
    const logBucket = (group='cultivate', day='2026-10-10') => `JSON.parse(localStorage.getItem('arkengine:auto-log:v1:${group}:${day}'))`;
    const fogJournal = `JSON.parse(sessionStorage.getItem('arkengine:auto-fog:pending:v1'))`;
    const fogState = `JSON.parse(localStorage.getItem('arkengine:auto-fog:state:v1'))`;
    const fogCalls = kind => `fo.calls.filter(c=>c[0]==='${kind}')`;
    const fogToggle = `document.getElementById('ark-auto-encounter').shadowRoot.getElementById('fog-toggle').click()`;
    const setupFog = async (code = '', path = '/cultivate') => {
      await cdp.send('Page.navigate', {url:`${origin}${path}?fog-fixture=${++pageSerial}`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?fog-fixture=${pageSerial}'&&typeof openFog==='function'`),'fog fixture');
      await evaluate('localStorage.clear();sessionStorage.clear();');
      await cdp.send('Page.reload',{},tab.sessionId);
      await until(()=>evaluate(`typeof openFog==='function'&&!document.getElementById('ark-auto-encounter')`),'fresh fog fixture');
      await evaluate(`Math.random=()=>0;localStorage.setItem('arkengine:auto-dungeon:enabled:v1','false');${code};renderDun();`);
      await evaluate(source);
    };
    await t.test('迷雾：199 灵力留在主殿，200 触发，余数不足20返回且继续奇遇', async () => {
      await setupFog('fo.spirit=199;');
      await pulse(10000);
      assert.equal(await evaluate('location.pathname'),'/cultivate','体力999不触发迷雾');
      await evaluate('fo.spirit=205;renderDun();');
      await drive(`fo.runs===10&&location.pathname==='/cultivate'`,'consume ten runs and return',130);
      assert.equal(await evaluate('fo.spirit'),5);
      assert.equal(await evaluate(`${fogState}.draining`),false);
      assert.equal(await evaluate(`${fogCalls('start')}.length`),10);
      assert.equal(await evaluate(`${fogCalls('wrong-entry')}.length`),0);
      assert.equal(await evaluate(`${logBucket()}.counts['fog-reward']`),10);
      assert.deepEqual(await evaluate(`${logBucket()}.totals`),{修为:3250,法宝碎片:120});
      await evaluate('fo.seek=true;renderDun();');
      await drive(`${fogCalls('seek')}.length===1`,'encounters continue after fog');
      await pulse(60000);
      assert.equal(await evaluate('fo.runs'),10,'不能用剩余5点重新进入');
    });
    await t.test('迷雾：灵力恰好200时独立随机等待打开及确认，沿用当前预设', async () => {
      await setupFog(`fo.route='south';fo.strategy='strike';fo.hp=40;`,'/cultivate/fog');
      await until(async()=>(await status())?.includes('随机等待'),'delay before entry');
      await pulse(1999);
      assert.equal(await evaluate(`${fogCalls('open')}.length`),0);
      await pulse(1);
      assert.equal(await evaluate(`${fogCalls('open')}.length`),1);
      assert.equal(await evaluate(`${fogCalls('start')}.length`),0);
      await pulse(1500);await pulse(1999);
      assert.equal(await evaluate(`${fogCalls('start')}.length`),0,'确认也独立等待2秒');
      await pulse(1);
      await drive('fo.runs===1','first quick request');
      assert.deepEqual(await evaluate(`${fogCalls('start')}[0][1]`),{action:'start',quick:{route:'south',strategy:'strike',retreatHp:40}});
      assert.equal(await evaluate('fo.spirit'),180);
    });
    await t.test('迷雾：先领取当前奇遇，先做已到期秘境，再按剩余灵力判断', async () => {
      await setupFog(`dm.encounter=true;localStorage.setItem('arkengine:auto-dungeon:enabled:v1','true');`);
      await drive(`dm.runs===1&&!dm.current&&location.pathname==='/cultivate'`,'due dungeon before fog',100);
      assert.equal(await evaluate('dm.calls[0][0]'),'encounter');
      assert.equal(await evaluate('fo.spirit'),180);
      await pulse(10000);
      assert.equal(await evaluate(`${fogCalls('open')}.length`),0,'秘境消耗后不足200不进入');
      await evaluate('fo.spirit=200;renderDun();');
      await drive('fo.runs===1','spirit replenished');
    });
    await t.test('迷雾：主殿不额外定时刷新，正常页面更新到200灵力后进入', async () => {
      await setupFog('fo.spirit=199;fo.freshSpirit=200;');
      for(let i=0;i<5;i++) await pulse(60000);
      assert.equal(await evaluate(`${fogCalls('refresh-hall')}.length`),0,'不按分钟刷新或查询灵力');
      assert.equal(await evaluate('location.pathname'),'/cultivate');
      assert.equal(await evaluate('fo.runs'),0);
      await evaluate('fo.spirit=200;renderDun();');
      await drive('fo.runs===1','normal page update reaches threshold');
      assert.equal(await evaluate(`${fogCalls('refresh-hall')}.length`),0);
    });
    await t.test('迷雾：请求中断和刷新后只恢复同一个原请求，继续到不足20', async () => {
      await setupFog(`fo.mode='pending';`);
      await drive('!!nativeFog()&&!fo.busy','pending quick result');
      const record=await evaluate('nativeFog()');
      const before=await evaluate('clock');
      await cdp.send('Page.navigate',{url:`${origin}/cultivate/fog?fog-fixture=recover`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?fog-fixture=recover'&&typeof openFog==='function'`),'reload fog');
      await evaluate(`clock=${before+31000};Math.random=()=>0;fo.mode='';renderDun();`);
      await evaluate(source);
      await drive(`fo.runs===10&&location.pathname==='/cultivate'`,'recovered complete drain',130);
      assert.equal(await evaluate(`${fogCalls('recover')}[0][2]`),record.idempotencyKey);
      assert.deepEqual(await evaluate(`${fogCalls('recover')}[0][1]`),record.input);
      assert.equal(await evaluate(`${fogCalls('start')}.length`),10);
      assert.equal(await evaluate(`${logBucket()}.counts['fog-reward']`),10);
    });
    await t.test('迷雾：处理中超过90秒让出主殿，五分钟后仅确认原请求', async () => {
      await setupFog(`fo.mode='busy';`);
      await drive('!!nativeFog()','busy fog');
      const record=await evaluate('nativeFog()');
      await pulse(91000);
      await drive(`location.pathname==='/cultivate'`,'busy fog yields hall');
      await evaluate('fo.seek=true;renderDun();');
      await drive(`${fogCalls('seek')}.length===1`,'seek while fog deferred');
      await pulse(60000);
      assert.equal(await evaluate('location.pathname'),'/cultivate');
      assert.equal(await evaluate(`${fogCalls('start')}.length`),1);
      await evaluate(`clock=${fogState}.nextAt;fo.busy=false;fo.mode='';renderDun();`);
      await drive(`${fogCalls('recover')}.length===1&&fo.runs===1`,'recover deferred fog');
      assert.equal(await evaluate(`${fogCalls('recover')}[0][2]`),record.idempotencyKey);
      assert.equal(await evaluate(`${fogCalls('start')}.length`),1);
    });
    await t.test('迷雾：手动弹窗、原请求或正在探索的手动局不被接管', async () => {
      await setupFog('openFog();','/cultivate/fog');
      await pulse(10000);
      assert.equal(await evaluate(`${fogCalls('start')}.length`),0);
      assert.equal(await evaluate(`!!document.querySelector('[role="alertdialog"]')`),true);
      for(const manual of [true,false]) {
        await setupFog(manual?'fo.manual=true;':`sessionStorage.setItem('fog:77',JSON.stringify({idempotencyKey:'manual',input:{action:'start'}}));`,'/cultivate/fog');
        await drive(`location.pathname==='/cultivate'`,'manual fog preserved');
        assert.equal(await evaluate(`${fogCalls('start')}.length+${fogCalls('recover')}.length+${fogCalls('manual-taken')}.length`),0);
        assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-fog:enabled:v1')`),'false');
      }
    });
    await t.test('迷雾：单独暂停取消自己的未提交弹窗并回主殿，总暂停撤销点击', async () => {
      await setupFog();
      await drive(`!!document.querySelector('[role="alertdialog"]')`,'own quick dialog');
      await evaluate(fogToggle);
      await drive(`location.pathname==='/cultivate'`,'pause fog returns');
      assert.equal(await evaluate(`${fogCalls('start')}.length`),0);
      assert.equal(await evaluate(fogJournal),null);
      await evaluate('fo.seek=true;renderDun();');
      await drive(`${fogCalls('seek')}.length===1`,'encounter remains enabled');
      await setupFog('', '/cultivate/fog');
      await until(async()=>(await status())?.includes('随机等待'),'queued fog click');
      await evaluate(`document.getElementById('ark-auto-encounter').shadowRoot.getElementById('toggle').click()`);
      await pulse(30000);
      assert.equal(await evaluate(`${fogCalls('open')}.length`),0);
    });
    await t.test('迷雾：确认等待时换成同名手动弹窗，不确认或取消替换窗口', async () => {
      await setupFog();
      await drive(`!!document.querySelector('[role="alertdialog"]')`,'original fog dialog');
      await pulse(1500);
      await evaluate(`document.querySelector('[role="alertdialog"] button').click();openFog();window.manualFogDialog=document.querySelector('[role="alertdialog"]');`);
      await pulse(10000);
      assert.equal(await evaluate(`${fogCalls('start')}.length`),0);
      await evaluate(fogToggle);
      await pulse(10000);
      assert.equal(await evaluate('manualFogDialog.isConnected'),true);
      assert.equal(await evaluate('location.pathname'),'/cultivate/fog');
    });
    await t.test('迷雾：网页刷新保留耗尽本轮的进度，即使当前灵力不足200', async () => {
      await setupFog();
      await drive(`fo.runs===1&&${fogJournal}===null`,'settled first run');
      const before=await evaluate('clock');
      await cdp.send('Page.navigate',{url:`${origin}/cultivate/fog?fog-fixture=drain`},tab.sessionId);
      await until(()=>evaluate(`location.search==='?fog-fixture=drain'&&typeof openFog==='function'`),'reload draining');
      await evaluate(`clock=${before};Math.random=()=>0;renderDun();`);await evaluate(source);
      await drive(`fo.runs===10&&location.pathname==='/cultivate'`,'resumed draining below threshold',130);
      assert.equal(await evaluate('fo.spirit'),0);
    });
    await t.test('迷雾：费用变化或未开放时退回主殿，失败回执不误算旧奖励', async () => {
      for(const config of ['fo.cost=30;','fo.quick=false;',`fo.mode='reject';fo.paid='旧回执 已到账：修为 325 · 法宝碎片 12';`]) {
        await setupFog(config);
        await drive(`location.pathname==='/cultivate'&&${fogState}?.nextAt>clock`,'unavailable fog yields');
        assert.equal(await evaluate(`${logBucket()}?.totals['修为']||0`),0);
        await pulse(10000);
        assert.equal(await evaluate('location.pathname'),'/cultivate');
        assert.equal(await evaluate('fo.runs'),0);
      }
    });
    await t.test('迷雾：后台动画帧停止、主线程定时器延迟时仍由 Worker 处理确认', async () => {
      await setupFog(`fo.animation=true;window.requestAnimationFrame=()=>1;window.setTimeout=(callback,ms,...args)=>fixtureTimeout(callback,Math.max(ms||0,60000),...args);`,'/cultivate/fog');
      const foreground=await createTab();
      try {
        await cdp.send('Target.activateTarget',{targetId:foreground.targetId});
        assert.equal(await evaluate('document.visibilityState'),'hidden');
        // 不派发 focus/DOM 事件，真正依赖后台 Worker 唤醒。
        for(let i=0;i<3;i++) {await evaluate('clock+=6000');await delay(2300);}
        await until(()=>evaluate('fo.runs>=1'),'worker confirms background quick request',5000);
        assert.equal(await evaluate(`!!document.querySelector('[role="alertdialog"]')`),false);
        assert.equal(await evaluate(`${fogCalls('wrong-entry')}.length`),0);
      } finally {await cdp.send('Target.closeTarget',{targetId:foreground.targetId});}
    });
    await t.test('迷雾：游戏登录限流异常暂停整组，不自动继续尝试', async () => {
      await setupFog(`fo.error='请求频率过高';`,'/cultivate/fog');
      await until(async()=>(await status())?.includes('已暂停'),'fog rate limit stops');
      await pulse(100000);
      assert.equal(await evaluate(`${fogCalls('open')}.length`),0);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-encounter:enabled:v1')`),'false');
    });
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
      assert.match(await evaluate(`document.getElementById('ark-auto-encounter').shadowRoot.getElementById('log-summary').textContent`),/代币 1001234\.5/);
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
        document.getElementById('ark-auto-expedition').shadowRoot.querySelector('details button').click();`);
      const exported=await evaluate('exportedBlob.text().then(JSON.parse)');
      assert.equal(exported.days[0].totals['代币'],247);
      assert.equal(exported.version,'1.6.1');
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
        localStorage.setItem('arkengine:auto-log:v1:cultivate:2026-10-08',JSON.stringify({events:[]}));
        localStorage.setItem('arkengine:auto-log:v1:expedition:2026-10-09',JSON.stringify({day:'2026-10-09',events:[{detail:'昨夜'}]}));
      `);
      await drive(`dm.runs===1&&!dm.current&&location.pathname==='/cultivate'`, 'completed dungeon log');
      assert.equal(await evaluate(`${logBucket()}.totals['修为']`),12345);
      assert.equal(await evaluate(`${logBucket()}.counts['dungeon-reward']`),1);
      assert.ok(await evaluate(`${logBucket()}.counts['dungeon-node-reward']`)>0);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-log:v1:cultivate:2026-10-08')`),null);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-log:v1:expedition:2026-10-09')`),null);
      await evaluate(`window.exportedBlob=null;URL.createObjectURL=b=>{exportedBlob=b;return 'blob:local';};
        HTMLAnchorElement.prototype.click=function(){};
        document.getElementById('ark-auto-encounter').shadowRoot.querySelector('details button').click();`);
      const exported = await evaluate(`exportedBlob.text().then(JSON.parse)`);
      assert.equal(exported.version,'1.6.1');
      assert.equal(exported.days.length,2);
      assert.ok(!JSON.stringify(exported).includes('idempotencyKey'));
      await evaluate(`clock=Date.parse('2026-10-11T00:01:00+08:00');window.dispatchEvent(new Event('focus'));`);
      await delay(200);
      assert.notEqual(await evaluate(`localStorage.getItem('arkengine:auto-log:v1:cultivate:2026-10-10')`),null);
      assert.equal(await evaluate(`localStorage.getItem('arkengine:auto-log:v1:expedition:2026-10-09')`),null);
    });
    await t.test('夜间回归：暂停和离开自动化路由会恢复原动画设置', async () => {
      await setup(`globalThis.BASE_UI_ANIMATIONS_DISABLED=false;`);
      assert.equal(await evaluate('BASE_UI_ANIMATIONS_DISABLED'),true);
      await evaluate(`document.getElementById('ark-auto-encounter').shadowRoot.getElementById('toggle').click()`);
      await until(()=>evaluate('BASE_UI_ANIMATIONS_DISABLED===false'),'restore on pause');
      await evaluate(`document.getElementById('ark-auto-encounter').shadowRoot.getElementById('toggle').click()`);
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
      await until(async ()=>(await expStatus())?.includes('重新读取今日突发额度'),'idle quota refresh queued');
      await pulse(2000);
      await until(()=>expeditionRequests>before,'reload stale quota');
      await until(()=>evaluate(`typeof renderExp==='function'&&!document.getElementById('ark-auto-expedition')`),'reloaded document');
      await evaluate(`Object.assign(window,${JSON.stringify(snapshot)});clock=Date.parse('2026-10-10T04:05:03+08:00');model.burst=6;Math.random=()=>0;renderExp();`);
      await evaluate(source);
      await drive(`${confirmed}.length===1&&model.burst===0`,'fresh allowance caught up');
      assert.equal(await evaluate(`${confirmed}[0].route`),'深渊远征');
      assert.equal(await evaluate(`${confirmed}[0].normal`),0);
      assert.equal(await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('log-summary').textContent.includes('钻石 0')`),true,'队伍变化不能虚构钻石收入');
    });
    await t.test('夜间回归：日志写入失败不阻断奇遇', async () => {
      await setup(`window.clock=Date.parse('2026-10-10T10:00:00+08:00');Date.now=()=>clock;
        const originalSet=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){if(key.startsWith('arkengine:auto-log:'))throw new DOMException('full','QuotaExceededError');return originalSet.call(this,key,value);};
        choices(['修为 +1','钻石 +2']);`);
      await drive(`clicks.length===1`,'storage-full automation continues');
      assert.deepEqual(await clickLog(),[1]);
      assert.match(await evaluate(`document.getElementById('ark-auto-encounter').shadowRoot.getElementById('log-summary').textContent`),/日志存储失败/);
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
      await until(async () => (await status())?.includes('奇遇冷却'), 'main hall resumes');
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
      await evaluate(`clock=Date.parse('2026-10-11T00:00:01+08:00'); dm.remaining=5; dm.cooledUntil=0; renderDun();`);
      await drive(`dm.runs===6`, 'new-day allowance');
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
      await evaluate(`document.getElementById('ark-auto-encounter').shadowRoot.getElementById('dungeon-toggle').click()`);
      await pulse(10000);
      assert.deepEqual(await evaluate('dm.calls'),[]);
      await evaluate(`document.getElementById('ark-auto-encounter').shadowRoot.getElementById('dungeon-toggle').click()`);
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
    await t.test('远征：跨午夜先重新载入今日额度', async () => {
      await setupExp(`clock = Date.parse('2026-10-10T23:59:59+08:00'); addRuns(6); model.burst = 0;`);
      await until(async () => (await expStatus())?.includes('今日突发已使用'), 'previous day used');
      const before = expeditionRequests;
      await pulse(1001);
      await until(async () => (await expStatus())?.includes('刷新今日突发额度'), 'new-day refresh queued');
      await pulse(2000);
      await until(() => expeditionRequests > before, 'new-day reload');
    });
    await t.test('远征：重复标签页仅一个运行，关闭后接力', async () => {
      await setupExp('addRuns(6);');
      await until(async () => (await expStatus())?.includes('今日突发已使用'), 'first expedition lock');
      const second = await createTab();
      try {
        await cdp.send('Page.navigate', { url: `${origin}/activities/expedition?second=1` }, second.sessionId);
        await until(() => cdp.evaluate(second.sessionId, `typeof renderExp === 'function'`), 'second expedition page');
        await cdp.evaluate(second.sessionId, source);
        await until(() => cdp.evaluate(second.sessionId, `document.getElementById('ark-auto-expedition').shadowRoot.getElementById('status').textContent.includes('另一远征标签页')`), 'second expedition waits');
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
    await t.test('奇遇与远征：不同标签页并行，暂停远征不影响奇遇', async () => {
      await setupExp();
      await drive('model.runs.length === 6', 'expedition running');
      const cultivate = await createTab();
      try {
        await cdp.send('Page.navigate', { url: `${origin}/cultivate?parallel=1` }, cultivate.sessionId);
        await until(() => cdp.evaluate(cultivate.sessionId, `typeof choices === 'function'`), 'parallel cultivation page');
        await cdp.evaluate(cultivate.sessionId, `Math.random = () => 0; choices(['修为 +1','修为 +2','钻石 +1']);`);
        await cdp.evaluate(cultivate.sessionId, source);
        await evaluate(`document.getElementById('ark-auto-expedition').shadowRoot.getElementById('toggle').click()`);
        await until(async () => (await cdp.evaluate(cultivate.sessionId, 'clicks')).length === 1, 'cultivation continues after expedition pause');
        assert.deepEqual(await cdp.evaluate(cultivate.sessionId, 'clicks'), [2]);
        assert.equal(await evaluate('model.runs.length'), 6);
        assert.equal(await cdp.evaluate(cultivate.sessionId, `document.getElementById('ark-auto-expedition').hidden`), true);
        assert.equal(await evaluate(`document.getElementById('ark-auto-encounter').hidden`), true);
      } finally { await cdp.send('Target.closeTarget', { targetId: cultivate.targetId }); }
    });
  } finally {
    if (cdp) {
      try { await cdp.send('Browser.close'); } catch { /* 只关闭测试浏览器 */ }
      cdp.socket.close();
    }
    if (browser.exitCode === null) browser.kill();
    await new Promise(resolve => server.close(resolve));
  }
});
