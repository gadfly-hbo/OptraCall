# 重放 v1.2 批准的 UI Demo

两个演示均可用 Node.js 直接重放当时构建的页面。先取得归档的静态输出，保留以下目录结构。在仓库根执行对应命令，前台按 Ctrl-C 停止。

| 演示 | 归档目录 | 命令 | 默认本机端口 |
| --- | --- | --- | --- |
| v1.2 整体增量 | `.local/v12-preparation/demo-dist/` | `node scripts/replay-v12-demo.mjs v12` | 43127 |
| PM-V12-01 资料范围 | `.local/v12-pm01-fix/ui-preparation/build/` | `node scripts/replay-v12-demo.mjs pm01` | 43131 |

静态文件保存在原 v1.2 工作树的本地归档。新克隆需要取得这两份构建目录，或用 `--archive-root=/path/to/archive` 指向已有归档。该路径下应直接看到 `v12-preparation/` 或 `v12-pm01-fix/`。可用 `--port=43133` 指定其他隔离端口。

脚本从[文件清单](demo-replay.json)读取原最终构建日志列出的 HTML、JS 和 CSS，逐文件校验 SHA-256 后仅在 `127.0.0.1` 提供这些字节。旧批次残留文件不会对外提供。页面内数据来自原浏览器合成替身，服务端 `/api` 返回 503。两个演示的对照入口分别为 `/?baseline=1` 与 `/?before=1`。

当时的源码、源文件校验、构建及点击步骤见 [v1.2 原记录](../overall-architecture-v12/ui-demo/README.md) 和 [PM-V12-01 原记录](../overall-architecture-v12/pm01-ui-demo/README.md)。其中旧启动命令使用当时的工具链，PM-V12-01 还依赖当时未提交的产品源码快照。现行回放直接采用对应的最后一次归档构建。
