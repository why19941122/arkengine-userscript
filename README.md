# Ark Engine 油猴脚本

奇遇、秘境与迷雾共用修仙页，远征与农场共用另一页；包含随机点击延迟、动态农场收益比较和本地收入日志。

当前版本 **v1.7.2**：修复远征后台加载额度或派遣控件超时后，页面恢复了却仍保持暂停的问题。后台缺项只等待页面恢复，完整数据恢复后自动核对原领取并继续；这段后台等待不消耗前台加载超时预算，也不触发额外请求。前台持续缺项仍按上限处理，人工暂停及账号异常不会自动解除。保留 v1.7.1 的断网领取核对、最多补领一次和七日日志。

## 安装与更新

[安装 / 更新脚本](https://raw.githubusercontent.com/why19941122/arkengine-userscript/main/arkengine-auto-encounter.user.js)

在安装了 Tampermonkey 的浏览器中打开上方链接，确认安装或更新。已有旧版无需删除；本仓库保留原脚本名称及命名空间。

从 v1.5.2 开始配置自动更新地址。开启油猴更新检查后，发布到 `main` 的更高版本会按油猴检查周期更新。更新完成后刷新两个游戏页面即可生效。浏览器需要能访问 `raw.githubusercontent.com`。

使用方式、收入统计口径和后台运行限制见[使用说明](arkengine-auto-encounter-使用说明.md)。

## 发布文件

- `arkengine-auto-encounter.user.js`：完整安装脚本。
- `arkengine-auto-encounter.meta.js`：油猴检查更新使用的元数据，与安装脚本头部一致。
- `arkengine-auto-encounter.test.mjs` 及四个 fixture：本地浏览器回归检查，不使用游戏登录态、不向游戏提交操作。

## 开发验证

需要 Node.js 24 和本机 Chrome / Edge，也可用 `CHROME_PATH` 指定浏览器。无需安装第三方依赖。

```powershell
node --check .\arkengine-auto-encounter.user.js
node --test .\arkengine-auto-encounter.test.mjs
```

发布新版时同步增加脚本版本、日志导出版本及对应测试断言，然后重新生成元数据文件：

```powershell
node -e 'const fs=require("node:fs");const s=fs.readFileSync("arkengine-auto-encounter.user.js","utf8");const h=s.match(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/);if(!h)throw Error("Missing userscript metadata");fs.writeFileSync("arkengine-auto-encounter.meta.js",h[0]+"\n");'
```

验证通过且取得发布授权后，将安装脚本与元数据文件一起提交并推送到 `main`。仓库只包含脚本、说明和测试；本地运行日志及账户数据不应提交。


## 设计参考

本次借鉴以下项目的原则，使用浏览器原生 API 实现，不引入第三方运行依赖：

- [Playwright locators](https://github.com/microsoft/playwright/blob/83b80cfb2cc159fa2d3c4d9ee61803b55cdd06a5/docs/src/locators.md)：定位唯一当前目标，不任取首项。
- [idb](https://github.com/jakearchibald/idb/blob/654c746bef13f9fe7f5871e03ac58015cebace5a/README.md)：事务提交后确认写入，事务中不等待网络或其他外部任务。
- [TanStack Query retryer](https://github.com/TanStack/query/blob/2fb9d905f2184a32d998da657cfcc95c381014ad/packages/query-core/src/retryer.ts)：有限退避、离线等待与取消；本脚本继续支持后台执行。
- [XState](https://github.com/statelyai/xstate/tree/8f25b68f3953a9dd3c146a76f1f4972aba092a3f)：明确等待、暂停、未决操作和保存记录故障，隔离受影响功能。
