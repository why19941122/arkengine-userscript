import { mkdir, mkdtemp, lstat, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// 浏览器配置固定留在项目所在磁盘，不依赖系统 TEMP/TMP。
export const browserTestRoot = fileURLToPath(new URL('./.test-tmp/', import.meta.url));

export async function launchTestBrowser(executable) {
  await mkdir(browserTestRoot, { recursive: true });
  const root = await realpath(browserTestRoot);
  const profile = await mkdtemp(join(root, 'ark-encounter-browser-'));
  let browser, closed = false, launchError, cleanup;
  let onClosed;
  const closedPromise = new Promise(resolve => { onClosed = resolve; });
  const waitForClose = async milliseconds => {
    if (closed) return true;
    let timer;
    try {
      return await Promise.race([closedPromise.then(() => true),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]);
    } finally { clearTimeout(timer); }
  };
  const removeProfile = async () => {
    // 仅删除本次 mkdtemp 返回的项目内直接子目录，拒绝根目录及替换后的链接。
    if (dirname(resolve(profile)) !== root || !/^ark-encounter-browser-[A-Za-z0-9]+$/.test(basename(profile)))
      throw new Error(`测试目录不在预期范围内，已保留：${profile}`);
    let info;
    try { info = await lstat(profile); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(profile) !== resolve(profile))
      throw new Error(`测试目录路径已变化，已保留：${profile}`);
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  const close = graceful => cleanup ??= (async () => {
    if (browser) {
      if (!closed && graceful) {
        try { await graceful(); } catch { /* 已退出或 CDP 断开时仍核对本次子进程。 */ }
      }
      if (!await waitForClose(10000)) {
        // 只控制本函数创建的浏览器子进程，不枚举或结束其他浏览器/CLI。
        browser.kill();
        if (!await waitForClose(30000)) throw new Error(`测试浏览器未确认退出，已保留目录：${profile}；pid=${browser.pid}, exit=${browser.exitCode}, signal=${browser.signalCode}`);
      }
    }
    await removeProfile();
  })();
  try {
    const temporary = join(profile, 'tmp');
    await mkdir(temporary);
    browser = spawn(executable, ['--headless=new', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-features=BackForwardCache', `--user-data-dir=${profile}`,
      '--remote-debugging-port=0', 'about:blank'], { windowsHide: true, stdio: 'ignore',
        env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary } });
    browser.once('close', () => { closed = true; onClosed(); });
    browser.on('error', error => { launchError = error; });
    await new Promise((resolve, reject) => {
      const failed = error => { browser.removeListener('spawn', ready); reject(error); };
      const ready = () => { browser.removeListener('error', failed); resolve(); };
      browser.once('spawn', ready); browser.once('error', failed);
    });
    return { profile, browser, close, get error() { return launchError; } };
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], '浏览器启动与测试目录清理均失败'); }
    throw error;
  }
}
