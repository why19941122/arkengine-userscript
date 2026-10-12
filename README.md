# Ark Engine 油猴脚本

奇遇与秘境、远征与农场自动操作，包含随机点击延迟、动态农场收益比较和本地收入日志。

## 安装与更新

[安装 / 更新脚本](https://raw.githubusercontent.com/why19941122/arkengine-userscript/main/arkengine-auto-encounter.user.js)

在安装了 Tampermonkey 的浏览器中打开上方链接，确认安装或更新。已有旧版无需删除；本仓库保留原脚本名称及命名空间。

从 v1.5.2 开始配置自动更新地址。开启油猴更新检查后，发布到 `main` 的更高版本会按油猴检查周期更新。更新完成后刷新两个游戏页面即可生效。浏览器需要能访问 `raw.githubusercontent.com`。

使用方式、收入统计口径和后台运行限制见[使用说明](arkengine-auto-encounter-使用说明.md)。

## 发布文件

- `arkengine-auto-encounter.user.js`：完整安装脚本。
- `arkengine-auto-encounter.meta.js`：油猴检查更新使用的元数据，与安装脚本头部一致。
- `arkengine-auto-encounter.test.mjs` 及三个 fixture：本地浏览器回归检查，不使用游戏登录态、不向游戏提交操作。

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
