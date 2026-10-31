# OptraCall

**持续做出更好的决策。**

OptraCall（Optima 最优 + tra 迭代 + call 决策）面向数据驱动决策者，提供分析与决策工作台。产品体验参考 WorkBuddy，围绕分析、判断、行动选择与反馈学习逐步建设。

## 当前状态

2026-10-29：本地候选 `0.1.0-mvp.4` 已完成Case一期功能、兼容迁移及独立复核，并获用户通过；当前按授权交付Git／CI并集成最新main，实际状态见[Case交付记录](openspec/changes/decision-case/result.md)。统计方法与模型报告质量单列，不以Case功能通过代替分析质量通过。

2026-10-29：已通过PR #3合入main的第一个真实业务插件"指标体系 · Metric Factory"：Pi 会话起草 SAP 0.2 指标体系草稿（落 020_clean），资产页人工审核发布到本机全局库 `~/.optracall/metric-assets/`，项目按精确版本启用后分析会话注入指标索引（软引导，Agent 直读库文件并注明版本）。范围、验收与实际结果见[规格](openspec/changes/metric-factory-mvp/spec.md)与[结果记录](openspec/changes/metric-factory-mvp/result.md)；实际验收与后续观察分别以该结果记录为准。

2026-10-29：版本 `0.1.0-mvp.3` 增加本地试用的启动、停止和单向更新三个双击入口，构建UI由Host同源提供，实际运行版本可回读。[试用方式](docs/macbook-trial.md)与[交付记录](openspec/changes/macbook-trial-delivery/result.md)分别说明操作和验证状态。前版 `0.1.0-mvp.2` 已通过用户本轮真实模型多任务验收，在持久项目与完整Pi运行时上增加项目多任务、重命名、归档及恢复。每个任务有独立会话／草稿／模型和运行状态，文件按项目共享；原有项目兼容升级为包含首个任务的项目。范围、迁移和实际检查见[已确认方案](docs/project-tasks-and-archive.md)、[规格](openspec/changes/project-tasks-and-archive/spec.md)与[结果记录](openspec/changes/project-tasks-and-archive/result.md)；本轮用户通过、观察项及合并／测试数据清理分别记录。本机合成验收项目和QA运行数据已按用户授权清除，模型配置及必要交付证据保留。

原 `first-chat-mvp` 四项开发与五模型合成数据验证证据保留，用户修正由当前变更承接。四类能力目录仍为占位（侧栏"指标体系"除外，见当前状态）；顶部"决策"已接入决策看板：跨项目汇总 060_reports 报告、模型抽取建议与采纳/驳回/任务/反馈闭环。不预装数据分析skill，用户可按Pi原生方式自行安装。

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
| [项目多任务与归档方案](docs/project-tasks-and-archive.md) | 已确认的任务边界、归档生命周期、兼容迁移与回退 |
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

`src/host/` 承接启动、装配、环境与前端接缝，`ui/` 放对话和配置界面；`src/agent/` 是全产品统一 Pi SDK 接入的代码归属。根目录 `extensions/` 同时容纳代码与声明性资产，三类目录对应产品分类，仍属于同一个产品，不代表独立包、插件市场或第二套 Runtime；`extensions/business-plugins/metric-factory/` 是第一个真实业务插件（自包含模块 + Host 薄挂载），`tests/` 在真实测试出现后再细分，`openspec/changes/` 保存变更规格与结果，`docs/` 保存长期产品与工程资料。

目录职责沿用第 1 项；目前选择浏览器 React / TypeScript / Vite 与 Node Host，实际 Agent 代码已替代空标记。`scripts/` 负责隔离启动与开发进程，不属于产品 Extension；指标体系插件已落地，其余预留目录按后续任务接入，不预建插件市场或平行Runtime。

## 运行底座

当前采用 Node.js 25+ / TypeScript、单包与官方 `@earendil-works/pi-coding-agent@1.4.0`。SDK统一经 `src/agent/sdk.ts` 引入，项目运行直接使用官方会话／工具／上下文与harness；Host不补分析计算或自建推理循环。项目进程使用标准Node和清理过的环境变量，不把第3项受限连接探针的权限旗标传入完整SDK。

开发与工程测试集中在 Mac mini，MacBook 用于用户体验和问题反馈；MacBook按最新授权接收main浅克隆和本机凭据配置，只单向更新、试用与反馈。详细职责及交付以工程规范为准。

## 公开内容边界

本仓库公开。提交内容应适合公开；凭据、客户数据、私有经营资料、原始会话及运行日志保留在授权的本地位置。`.gitignore` 只减少误提交，提交前仍需检查实际文件内容。

## 本地试用

部署完成后，在项目文件夹双击 `启动 OptraCall.command`，浏览器打开 http://127.0.0.1:4173/ 。重复启动会复用实例；停止使用 `停止 OptraCall.command`。需要新版时先停止，再双击 `更新并启动 OptraCall.command`。普通启动不联网更新，不运行开发服务器。配置、项目、会话保存在本机用户目录，更新代码不搬动这些数据。首次部署及失败处理见[完整说明](docs/macbook-trial.md)。

## 开发与工程验证（Mac mini）

需要 Node.js 25+，当前开发机为 v25.9.0。

```sh
npm install --ignore-scripts
npm run dev
```

入口为 http://127.0.0.1:4173/ 。开发脚本先启动 loopback Host（4175），再启动UI；Ctrl+C结束两者。`npm run host`仅启动Host，`npm run check`运行本地测试、类型与构建，不代表CI或产品审核。

[CI入口](.github/workflows/check.yml)仅运行一个Ubuntu／Node25.9.0任务，锁文件安装、相同本地检查及依赖审计；不使用真实凭据或供应商。macOS真实模型及浏览器验证与托管CI分开记录，最终状态以交付PR对应提交的检查为准。

先在模型设置选择预置模型并保存凭据，或通过文件选择导入Pi格式的 `auth.json`。手动保存与导入共用同一入口，密钥保存后清空输入框且不回显；独立文件在 `~/.optracall/`，目录0700／凭据0600，为权限保护的本地明文保存，重启可恢复。保存／导入／读取不自动调用模型，主动连接测试只发固定短句；清除Provider凭据会停止相关运行，但保留项目和历史。

新项目先是空工作空间，点击项目行的“＋新建任务”，填写任务名并选择模型后对话。模型默认继承项目配置，可在创建任务时另选；每个任务保留自己的快照。任务只能在项目内创建，切换任务不会停止后台运行，停止及原生确认框均作用于所属任务。实际项目位于 `~/OptraCallProjects/<项目ID>/`，各任务共享三个文件夹：

- `010_draw`：上传原件归档。当前不提供敏感数据隔离，请勿放入敏感资料。
- `020_clean`：用户放入或显式复制的分析资料；Agent过程文件默认保存在这里。
- `060_reports`：Agent最终报告；也可点击回复旁的“保存为最终报告”，由用户明确保存。

系统提示词软约束Agent分析不读取010、使用020资料，并说明过程／报告目录用途；没有禁读沙箱或文件工具拦截。上传默认010，可显式选择020；010中的原件可点“复制到分析区”。上传、复制、打开项目和刷新不自动发模型请求。共享目录允许任务并行使用，Agent同名写入仍沿原生工具规则，Host不替Agent划分分析流程或自动搬运产物。

项目行“更多”可重命名或归档：重命名只改显示名，UUID目录不变；归档收纳到“已归档项目”，可查看历史／下载文件并恢复，不能删除。归档后先恢复才能继续编辑、上传或执行任务；有执行／打开／待回应任务时先停止或等待，再归档。

首批支持UTF-8 CSV／JSON／Markdown／TXT，单文件10 MiB、单次最多10个，同名不覆盖。右侧文件栏可展开／收起并下载真实文件；项目、草稿、上传件及SDK原生对话历史刷新／重启可恢复。运行中可停止，失败可显式重试；中断／未知结果保留，不自动重发。

旧schema1项目在Host启动时一次升级为schema2，原对话成为“原有任务”；旧JSONL路径和fork父引用不改变，三目录和文件不搬动。升级前保存0600的 `project.v1.backup.json`，未知／冲突元数据保留并报错。升级后产生新任务或新历史时，不能用v1备份覆盖回退；应保留全部v2数据并使用兼容构建。浏览列表、归档项目及恢复不会批量打开历史任务Runtime，SDK原生fork／branch仍属于原任务。

原生macOS工具read、bash、edit、write、grep、find、ls全部启用，Python通过bash执行；官方codemode、tool_search、MCP和资源加载机制接入。PowerShell上游后端仅支持Windows。独立SDK资源目录为 `.optracall/pi/`，用户自行安装skill／扩展或配置MCP后可重载；没有配置的第三方服务不视为已连接。会话能力面板提供原生工具、统计、树、fork、压缩、重载等入口。

原生扩展的选择、确认、输入及编辑对话框在浏览器中响应；通知／状态与输入框草稿同步，原生命令也可停止。终端专用装饰会提示忽略，必须依赖终端组件的交互明确报不支持；不会伪造用户回答。配置中断恢复、请求去重及异常child重建只管理运行环境，不代替Agent分析。

工程浏览器验证必须使用 `node tests/fixtures/browser-environment.ts` 创建的隔离Host／合成Provider和4183 UI，再运行 `tests/browser-project-tasks.js`、`browser-live-projects.js`、`browser-catalog.js`、`browser-metric-factory.js`；原生命令／扩展交互使用独立的 `command-browser-environment.ts` 与 `browser-command-ui.js`，两种fixture不能同时占用4183。不要对已配置真实凭据的服务运行会改配置的合成回归。其余旧Demo浏览器脚本及证据保留为历史阶段，当前产品以本项适用脚本和证据为准。


## Case 一期（0.1.0-mvp.4）

Case看板位于项目看板上方；具体项目仍列在“项目空间”。两个看板各有方块／列表视图。Case多对多关联现有项目，项目下仍是原任务Session；同一项目的工作状态、范围、承接人、下一步与历史全局共用。结束Case填写原因，重开后才可按该Case继续；项目独立发送仍可使用。

本期仅增加Node内置SQLite，无新增数据库依赖。普通启动不自动建空库：首次在Case看板点击“启用本机Case记录”；若曾启用而记录丢失，应先核对备份，不把它当作首次空白。数据库／身份标记异常会明确提示，原项目JSON、任务、原生JSONL与三目录保留原身份。项目业务字段缺省“未设置”，不从任务是否运行或项目归档猜测进度。

按Case继续任务时先核对背景及修订，实际发送才固定本次背景；旧任务历史可能含其他Case信息，需要独立上下文时在原项目中新建任务。引用记录保存真实项目路径及观察摘要，不复制文件；文件缺失、变化、项目解绑及历史解除分别提示。新建项目后关联部分成功会保留原项目和操作回执，在Case详情“未完成的项目创建”中核对续办，不重复创建。

已启用Case库的升级或代码回退前，先正常停止Host，确认任务和未知运行已核对，再执行显式离线结构备份：

```sh
node scripts/decision-case-backup.mjs --data-root "$HOME/.optracall" --projects-root "$HOME/OptraCallProjects"
```

实际使用自定义目录时必须传入原来的两条路径。脚本拒绝活动Host锁、活动库或残留恢复日志，备份写入dataRoot/backups/decision-case/下新的唯一目录；仅含SQLite、标记、匹配项目元数据与既有迁移备份、校验清单，不含凭据，也不是会话／三目录的完整灾备。首次尚无库时此命令会拒绝，不能声称备份了不存在的Case库；首次启用应先清点并保全原项目元数据、JSONL及文件。回退只切兼容代码并保留最新数据，不用旧快照覆盖后续Case、任务、历史或文件。

开发验收使用新建隔离合成根运行 `npm run check`，UI新增脚本为 `tests/fixtures/browser-case-board.js`，须从全新 `browser-environment.ts` fixture开始并串行运行；与其他脚本共享fixture并发执行会污染Provider计数。DuckDB下一项建设，Semantica后置。
