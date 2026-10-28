# OptraCall

**持续做出更好的决策。**

OptraCall（Optima 最优 + tra 迭代 + call 决策）面向数据驱动决策者，提供分析与决策工作台。产品体验参考 WorkBuddy，围绕分析、判断、行动选择与反馈学习逐步建设。

## 当前状态

2026-10-29：`first-chat-mvp` 四项开发已完成本地检查及独立复核，版本 `0.1.0-mvp.1` 提供真实持久项目、文件上传和完整Pi对话／工具运行。五个目标模型已使用合成数据验证；第4项用户产品验收待进行。见[规格](openspec/changes/first-chat-mvp/spec.md)、[第4项方案](docs/stage4-persistent-projects-and-agent.md)和[结果记录](openspec/changes/first-chat-mvp/result.md)。

四项完成后统一Git／CI交付。四类能力目录和决策大屏仍为明确标记的占位；本期不预装数据分析skill，用户可按Pi原生方式自行安装。

## 产品结构

采用 **Host + Agent + Extension**：Host 提供交互、业务上下文与决策学习环境；Agent 自主完成分析；Extension 提供分析资产、连接器和业务插件。

整个产品统一采用 **pi-coding-agent SDK** 承担 Agent Runtime，插件通过产品统一入口使用 Agent 能力。统一底座支持按任务隔离会话与上下文；插件不自建 SDK 接入层或独立 Runtime。完整责任边界见[产品讨论稿 v0.2](docs/OptraCall_产品讨论稿_v0.2.md)。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [产品讨论稿 v0.2](docs/OptraCall_产品讨论稿_v0.2.md) | 当前已确认原则、工程分工、体验建议与待确认事项 |
| [工程规范](docs/engineering-workflow.md) | Codex / Qoder 分工、SDD / TDD、独立复核及 Git / CI 规则 |
| [Agent 执行入口](AGENTS.md) | 工程 Agent 开始任务时的阅读与执行入口 |
| [最小对话批次规格](openspec/changes/first-chat-mvp/spec.md) | 四项边界、逐项确认与目录准备验收 |
| [批次结果记录](openspec/changes/first-chat-mvp/result.md) | 当前授权、检查证据及下一步 |
| [WorkBuddy 调研](docs/workbuddy-research.md) | 实机、官方资料、采用范围与未验证项 |
| [UI 与 Agent 接缝](docs/ui-and-agent-seam.md) | 浏览器设计、演示源边界与后续 SDK 责任 |
| [Demo 目录与双工作区修订](docs/demo-capabilities-revision.md) | 四类能力页面、决策占位与参考资料边界 |
| [Demo 项目空间与文件栏](docs/demo-project-space.md) | 项目为唯一创建入口、默认三文件夹及虚拟目录范围 |
| [第 3 项 SDK 与 LLM 准备](docs/stage3-sdk-and-llm.md) | 原内存／空工具连接探针阶段的历史范围 |
| [第4项持久项目与完整Pi](docs/stage4-persistent-projects-and-agent.md) | 当前确认、目录软约束、持久配置／项目与完整SDK接缝 |
| [原始讨论稿 v0.1](OptraCall_产品讨论稿_v0.1.md) | 原样保留的历史讨论，不作为当前分工依据 |

## 目录与职责

```text
src/
  host/
    ui/
  agent/
extensions/
  analysis-assets/
  connectors/
  business-plugins/
tests/
openspec/changes/first-chat-mvp/
docs/
.local/                         # 本地证据，忽略且不进入仓库
```

`src/host/` 承接启动、装配、环境与前端接缝，`ui/` 放对话和配置界面；`src/agent/` 是全产品统一 Pi SDK 接入的代码归属。根目录 `extensions/` 同时容纳代码与声明性资产，三类目录对应产品分类，仍属于同一个产品，不代表独立包、插件市场或第二套 Runtime。`tests/` 在真实测试出现后再细分，`openspec/changes/` 保存变更规格与结果，`docs/` 保存长期产品与工程资料。

目录职责沿用第 1 项；目前选择浏览器 React / TypeScript / Vite 与 Node Host，实际 Agent 代码已替代空标记。`scripts/` 负责隔离启动与开发进程，不属于产品 Extension；三类 Extension 仍以空标记保留，未预建数据库或插件协议。

## 运行底座

当前采用 Node.js 25+ / TypeScript、单包与官方 `@earendil-works/pi-coding-agent@1.4.0`。SDK统一经 `src/agent/sdk.ts` 引入，项目运行直接使用官方会话／工具／上下文与harness；Host不补分析计算或自建推理循环。项目进程使用标准Node和清理过的环境变量，不把第3项受限连接探针的权限旗标传入完整SDK。

开发与工程测试集中在 Mac mini，MacBook 用于用户体验和问题反馈；本项另有用户明确授权的只读SSH凭据提取。详细职责及交付以工程规范为准。

## 公开内容边界

本仓库公开。提交内容应适合公开；凭据、客户数据、私有经营资料、原始会话及运行日志保留在授权的本地位置。`.gitignore` 只减少误提交，提交前仍需检查实际文件内容。

## 本地使用

需要 Node.js 25+，当前开发机为 v25.9.0。

```sh
npm install --ignore-scripts
npm run dev
```

入口为 http://127.0.0.1:4173/ 。开发脚本先启动 loopback Host（4175），再启动UI；Ctrl+C结束两者。`npm run host`仅启动Host，`npm run check`运行本地测试、类型与构建，不代表CI或产品审核。

[CI入口](.github/workflows/check.yml)仅运行一个Ubuntu／Node25.9.0任务，锁文件安装、相同本地检查及依赖审计；不使用真实凭据或供应商。macOS真实模型及浏览器验证与托管CI分开记录，最终状态以交付PR对应提交的检查为准。

先在模型设置选择预置模型并保存凭据，或通过文件选择导入Pi格式的 `auth.json`。手动保存与导入共用同一入口，密钥保存后清空输入框且不回显；独立文件在 `/Users/bendandebaba/.optracall/`，目录0700／凭据0600，为权限保护的本地明文保存，重启可恢复。保存／导入／读取不自动调用模型，主动连接测试只发固定短句；清除Provider凭据会停止相关运行，但保留项目和历史。

命名创建项目后，在项目内发送问题，不能独立创建聊天。实际项目位于 `/Users/bendandebaba/OptraCallProjects/<项目ID>/`，默认三个文件夹：

- `010_draw`：上传原件归档。当前不提供敏感数据隔离，请勿放入敏感资料。
- `020_clean`：用户放入或显式复制的分析资料；Agent过程文件默认保存在这里。
- `060_reports`：Agent最终报告；也可点击回复旁的“保存为最终报告”，由用户明确保存。

系统提示词软约束Agent分析不读取010、使用020资料，并说明过程／报告目录用途；本期没有禁读沙箱或文件工具拦截。上传默认010，可显式选择020；归档文件可点“复制到分析区”。上传、复制、打开项目和刷新不自动发模型请求。

首批支持UTF-8 CSV／JSON／Markdown／TXT，单文件10 MiB、单次最多10个，同名不覆盖。右侧文件栏可展开／收起并下载真实文件；项目、草稿、上传件及SDK原生对话历史刷新／重启可恢复。运行中可停止，失败可显式重试；中断／未知结果保留，不自动重发。

原生macOS工具read、bash、edit、write、grep、find、ls全部启用，Python通过bash执行；官方codemode、tool_search、MCP和资源加载机制接入。PowerShell上游后端仅支持Windows。独立SDK资源目录为 `.optracall/pi/`，用户自行安装skill／扩展或配置MCP后可重载；没有配置的第三方服务不视为已连接。会话能力面板提供原生工具、统计、树、fork、压缩、重载等入口。

原生扩展的选择、确认、输入及编辑对话框在浏览器中响应；通知／状态与输入框草稿同步，原生命令也可停止。终端专用装饰会提示忽略，必须依赖终端组件的交互明确报不支持；不会伪造用户回答。配置中断恢复、请求去重及异常child重建只管理运行环境，不代替Agent分析。

工程浏览器验证必须使用 `node tests/fixtures/browser-environment.ts` 创建的隔离Host／合成Provider和4183 UI，再运行 `tests/browser-live-projects.js`、`browser-catalog.js`；原生命令／扩展交互使用独立的 `command-browser-environment.ts` 与 `browser-command-ui.js`，两种fixture不能同时占用4183。不要对已配置真实凭据的服务运行会改配置的合成回归。其余旧Demo浏览器脚本及证据保留为历史阶段，当前持久产品以本项适用脚本和证据为准。
