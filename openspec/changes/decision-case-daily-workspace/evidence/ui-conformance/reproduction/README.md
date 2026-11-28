# 隔离合成环境的截图复现

这些脚本是本轮实际使用的验收辅助脚本原件，不是生产启动器。运行目录为仓库根；Node 25.9.0，依赖按原锁文件安装，官方 Pi 1.4.0 未修改。本机 Chromium 位于 `/usr/bin/chromium`，Playwright 使用验收环境已有绝对路径；其他环境需先提供同等浏览器运行工具，并记录其差异。

在全新的隔离检出中，将本目录全部 `.mjs` 复制到 `.local/ui-conformance/`，依次执行：

```sh
node .local/ui-conformance/demo-aligned-serve.mjs
# 等待 READY 后在另一个终端中：
node .local/ui-conformance/demo-aligned-extend.mjs
node .local/ui-conformance/capture.mjs reproduction
node .local/ui-conformance/capture-extra.mjs reproduction
CASE_UI_FIXTURE="$PWD/.local/ui-conformance/demo-aligned/fixture-ids.json" CASE_HOME_REQUEST_RUN=reproduction node tests/browser-case-home-requests.mjs
```

`demo-aligned-serve.mjs` 使用实际 `createHost`、原产品入口/组件/CSS，在 `.local/ui-conformance/demo-aligned/` 下建立三个 Case、六个项目、六类任务、明确请求、原观察/资料等合成记录。首次创建时调用官方 Pi 和本地合成 Provider 生成一段 Teach 原记录；示例凭据字面量为 `synthetic-only-not-a-real-key`，没有真实外部 Provider。截图只读实际记录，弹窗及准备页输入沿原草稿保存路径。额外脚本补充准确原行动的 observe 请求。脚本不包含真实业务数据库、配置或凭据；不得把 dataRoot 改为在用目录。

复用已存在 fixture 时不会重建原记录。重启后原合成配置的 Provider 端口可能已失效，因此重启后的读界面截图不代表模型调用可用；需要重新验证模型时使用新的隔离根。后端变更必须停止并重启整个进程，不能以 SIGUSR2 的前端重建代替后端模块刷新。

新运行将产生新 UUID、时间和构建摘要，因此不得将复现图冒充本轮 g 原图。原图由 `product-g/` 的回执和 SHA256 绑定；源码见 `source-manifest-g.json`。正式 `npm run build` 另行检查，截图构建用同一实际源码和原 CSS 经 esbuild 输出；未注入临时 DOM、样式或 Demo 对话。
