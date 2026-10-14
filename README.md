# Ark Engine 油猴脚本

奇遇、秘境与迷雾共用修仙页，远征与农场共用另一页；包含随机点击延迟、动态农场收益比较和本地收入日志。

当前版本 **v1.6.6**：增加登录失效诊断。被动观察网站已有的已知游戏请求，记录时间、固定接口路径和 HTTP 状态；从游戏页进入登录首页时记录来源。401、403、429 或已知游戏请求跳回登录入口时暂停两组，保留待确认操作，手动登录后分别点击“开始”核对原结果。普通网络中断、取消与 5xx 只记录，不据此判定登出。诊断不增加请求、不读取请求或响应正文，不记录 URL 参数、Cookie 或登录凭据。保留 v1.6.4 秘境旧入场核对、v1.6.5 远征领取恢复及其他既有规则。

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

验证通过后，将安装脚本与元数据文件一起提交并推送到 `main`。仓库只包含脚本、说明和测试；本地运行日志及账户数据不应提交。
