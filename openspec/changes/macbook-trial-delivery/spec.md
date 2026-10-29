# macbook-trial-delivery

2026-10-29 · 用户已整体确认上一轮方案并明确授权执行：先Mac mini实现三个双击入口，经本地检查、非作者独立复核、CI并合入main，再clone部署MacBook `/Users/huangbo/Dev/OptraCall`；MacBook只单向更新／使用／反馈，不开发／提交／回推。通过现有导入流程配置MacBook本机Pi凭据，保留已有配置、项目、会话。具体结果见[result.md](result.md)。

## 已确认公开验证接缝与验收

| 标识 | 可观察结果 |
| --- | --- |
| STATIC-01 | 构建后的静态前端由现有Node Host同源提供，loopback绑定，API安全检查保持；SPA正常、资产类型正确、路径越界／外部链接／缺失资源不暴露代码或用户文件。 |
| LAUNCH-01 | Finder双击“启动 OptraCall.command”核对真实独立干净Git源码的HEAD／tree／包版本与构建一致后启动并打开浏览器；旧dist／脏构建拒绝，重复／并发启动复用同一实例；启动不联网更新／安装。实际运行健康信息绑定版本／构建提交及本实例身份。 |
| STOP-01 | “停止 OptraCall.command”只关闭已核实属于本clone的进程／SDK worker，正常退出；端口被其它服务占用或PID复用不误杀。 |
| UPDATE-01 | “更新并启动 OptraCall.command”仅在应用停机及Git工作区干净的main副本中执行，核对origin与目标main提交的成功push CI，固定目标SHA后只ff；拒绝本地ahead/diverged、脏树、运行实例／端口占用，保留失败现场，不reset／stash／clean／force。按锁文件安装及构建成功后才启动；启动与更新互斥。 |
| DATA-01 | clone、运行依赖与持久业务数据分离；控制PID/日志为可丢弃本机启动记录，不改变项目schema/配置格式或AgentRuntime。既有配置、Pi、项目、原生会话保持；Host只管环境，不增加分析步骤或工具拦截。 |
| DEPLOY-01 | Mini工程通过并合入main后，MacBook原目录为空才git shallow clone main；非空先只读识别保留，不覆盖。禁用该副本默认push。核对Node/Python/端口，独立安装运行依赖，不复制Mini node_modules。 |
| CONFIG-01 | 凭据只在MacBook本机经现有configuration/import或同一save路径导入；已有配置保留，缺项补齐，不输出／提交密钥、不复制Mini密钥／项目／会话。 |
| VERIFY-01 | Mini运行适用完整检查、真实正常启动／停止／更新、固定候选非作者独立复核及实际head CI。MacBook仅部署和最小运行回读，不承担开发、工程回归或自动真实模型调用；记录实际运行SHA和反馈方式。 |

用户整体确认覆盖上述正常CLI／Host HTTP静态与健康／真实Git更新及浏览器入口这些公开接缝；测试使用隔离根、合成Provider/CI响应与本地Git仓库，不读正式密钥或触碰Mini空项目。实施先因果RED，再最小GREEN；常规修正复用本规格，不重复要求同一授权。

## 允许修改与边界

`scripts/`启动／更新／构建标记、三个根目录`.command`、Host静态服务与健康元数据及必要CLI装配、适用`tests/`、`package.json`脚本（必要产品版本）、README/工程入口/规范和本变更记录。不变SDK版本、分析流程、插件能力或项目持久结构，不新增后台自动同步／launchd／DMG，不从本次部署扩大到其它MacBook仓库或业务资料。Node/前端构建属于部署准备，不使MacBook成为开发端。

执行顺序：Mini实现与验证 → 固定候选独立复核 → PR/CI/获准合并main → MacBook只读部署前核对与保全 → clone/依赖/构建/本机凭据导入 → 三入口最小运行回读。Git与产品／安装验收分别报告；失败保留原件，不通过rsync覆盖替代clone。
