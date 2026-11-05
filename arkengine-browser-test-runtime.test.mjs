import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { launchTestBrowser, browserTestRoot } from './arkengine-browser-test-runtime.mjs';

test('测试目录：固定在项目磁盘，等待子进程退出后删除，重复清理不影响另一轮目录', async () => {
  // Node 不接受 Chrome 参数，会正常启动后以非零码退出，用于验证退出与失败清理。
  const first = await launchTestBrowser(process.execPath);
  let second;
  try {
    second = await launchTestBrowser(process.execPath);
    assert.equal(dirname(first.profile), await realpath(browserTestRoot));
    assert.notEqual(first.profile, second.profile);
    const keep = join(second.profile, 'preserved.txt');
    await writeFile(keep, 'another run');
    await first.close();
    assert.ok(first.browser.exitCode !== null || first.browser.signalCode !== null);
    await assert.rejects(access(first.profile), { code: 'ENOENT' });
    assert.equal(await readFile(keep, 'utf8'), 'another run');
    await first.close();
    assert.equal(await readFile(keep, 'utf8'), 'another run');
  } finally {
    await first.close();
    await second?.close();
  }
  await assert.rejects(access(second.profile), { code: 'ENOENT' });
});

test('测试启动失败：无法启动浏览器时删除已创建目录，不吞掉原始错误', async () => {
  await mkdir(browserTestRoot, { recursive: true });
  const before = (await readdir(browserTestRoot)).sort();
  await assert.rejects(launchTestBrowser(join(browserTestRoot, 'missing-browser-executable.exe')), { code: 'ENOENT' });
  assert.deepEqual((await readdir(browserTestRoot)).sort(), before);
});
