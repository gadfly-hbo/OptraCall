# OptraCall v1.2 现有产品增量 UI Demo

本演示回答：在当前 App 中加入战略自然语言协作、默认用途与 BSC 按需展示后，原 GSA、准确历史和 Case／项目／Task 承接是否仍然清楚、可达？它是用户开工确认前的可点击准备稿，不是产品实现或运行采用。

固定代码基线：`3a529a0e381bf67b998f2b1debd242a5eed38884`。所有页面资料、配置、保存回执和讨论回复均为合成。未运行 Host、Pi、真实模型、活库、天气、真实项目或凭据。

## 启动与停止

在本工作树根执行一个命令：

```sh
node openspec/changes/overall-architecture-v12/ui-demo/run.mjs --port=43127
```

运行于 `127.0.0.1`，使用严格独立端口；4173/4174/4175 被启动脚本拒绝。需要现有锁文件对应的独立 `node_modules`；本次依赖保全身份见 `.local/v12-preparation/dependency-setup.json`，未升级 SDK 或依赖。

- 增量：<http://127.0.0.1:43127/>
- 基线：<http://127.0.0.1:43127/?baseline=1>
- 仅 GSA：<http://127.0.0.1:43127/?scenario=no-bsc>
- 部门／业务模块：<http://127.0.0.1:43127/?scenario=department>
- 个人：<http://127.0.0.1:43127/?scenario=personal>

运行进程、端口、PID、启动时间与对应停止命令写在 `.local/v12-preparation/demo-runtime.json`。前台运行可用 Ctrl-C；本次运行的具体 PID 见该收据，用 `kill -TERM <该PID>` 停止该演示进程。不要使用产品 trial launcher、`npm run dev`、正式 start/update 或停止正式服务。

## 哪些是真实组件

`main.tsx` 在安装合成 fetch 后，动态导入真实 `src/host/ui/main.tsx`，由其挂载真实 `<App />`。没有复制 App 或另造导航平台。原 248px 侧栏、顶栏、主题、帮助、Case、Project Map、Studio、NewProjectDialog、ProjectPlanPage、Task 及原设置页面均来自产品源文件。

直接使用真实 `styles.css`、`case-board.css`、`strategy-goals.css`、`project-plan.css` 及各原页面的 CSS；`demo.css` 只提供壳外演示控制条和增量讨论区样式，并沿用原 token、字号、按钮与 Dialog。

只有两个原源文件接受 Vite 内存变换，磁盘源文件不改：

| 原源文件 | 演示变换 |
| --- | --- |
| `App.tsx` | 两个版本初始都打开原战略页便于对照；增量版本在原设置增加用途分类，原 Goal→Case/Project 入口冻结演示背景，原 Task 显示合成承接上下文 |
| `StrategyGoalsPage.tsx` | 增量版本默认 GSA、BSC 工具与字段按需、原页内讨论区、采用后刷新并选定原 Goal 准确版；部门未知上层仅演示不强选企业的拟议差额 |

`vite.config.ts` 固定上述文件 SHA-256，启动和每次变换都核对；每个替换锚点必须恰好出现一次，否则拒绝变换。变换收据写入 `.local/v12-preparation/demo-transform-*.json`。变换后的代码只在内存服务，不写入产品目录。

基线沿原 BSC 默认、原 tab 与原 GoalEditor。为方便同屏比较，基线也使用合成 API、壳外控制条并初始打开原战略页；不是正式服务截图或真实业务快照。原源码、CSS、演示代码的来源和哈希见 `source-manifest.json`。

## 拟议增量与可点击路径

1. **已有 GSA 直接用。** 默认查看同一目标 v1；目标卡仍区分当前 v2 候选和正式采用 v1。“GSA承接”“版本与反馈”沿原页面；不补四个 BSC 视角。原准确版本选择仍可查看 v1/v2，原关系的旧 revision 和三层反馈保留。
2. **原页内讨论。** 可直接输入问题，或先点“围绕此目标讨论”带入当前准确版。方法参考按需展开，默认参考 Playing to Win，可组合 Rumelt、麦肯锡构建要素、BCG 调色板、贝恩核心相邻和 BSC。换选后点击继续讨论，可看判断视角如何变化；已有消息、来源及目标 v1 保持。
3. **候选到原 Goal/GSA。** 讨论后点击“核对并采用”，集中核对预填内容。原目标讨论走原 Goal API 的 revise→adopt；独立新目标走 create→adopt。必要责任信息未明确时不代填、不允许冒充承诺，可继续讨论或在同一核对表单补充。保存后刷新原列表并选中返回的 GoalRef，原 GSA 和 Case/项目按钮继续引用它。不是再建一套正式战略权威。
4. **默认与本次分开。** 原设置→使用用途，选择组织／部门或业务模块／个人，背景可留空，未设不阻断。默认仅用演示专属 localStorage key 保存。本次讨论可明确覆盖；围绕已有目标准确版时，未明确或固定本轮用途则沿原目标范围，高于全局默认。已有明确或固定用途不同则显示两者差异，不自动改写。已开始讨论的背景已固定，改变全局默认不更改该讨论、目标、项目入口或旧 Plan。不同用途共用同一结构，不增加资料权限。
5. **BSC 按需。** 原“按需工具”可打开 BSC／战略目标关系。原分组、目标、来源、版本、关系历史仍在。原 GoalEditor 的 BSC 字段也放在按需区。它是原目标视图，不是另一套记录。
6. **实际进入原下游页面。** 采用后点击原“从此目标创建Case”或“从此目标开始项目”。项目路径使用原 NewProjectDialog→ProjectPlanPage，选择实际工作类型，核对原任务范围，点击原“仅确认并创建”或“确认并开始”，再从原结果入口打开原 Task。Task 背景显示冻结的用途和准确 GoalRef。所有状态是合成回执，不表示真实 Pi 已开始。
7. **保留未知与取舍。** 依据／条件／因果细节按需查看，区分必要、贡献、假设、替代路径及未知；不新增因果树、独立台账、评分或固定专业步骤。

## 代表场景

壳外控制条可切换场景和基线／增量。切换场景重新加载合成内存状态；“重置合成状态”还清除演示专属默认用途。不会清理任何产品数据。

| 场景 | 观察重点 |
| --- | --- |
| 服饰组织／已有 BSC 历史 | 已采用 v1、待采用 v2、关系及历史、三层反馈；BSC 隐藏和展开不丢准确历史 |
| 服饰组织／仅 GSA | 原 GSA 无需 BSC；已有目标直接讨论和下游承接 |
| 部门／上层未知 | 原部门对象保留；企业和 SAP 目录为空，不强建上级、不自动获得企业资料权限 |
| 个人／家庭事业 | 同一目标、讨论和采用结构，按本人价值与生活背景讨论，不套财务树或强造公司 |

“下一次目标保存”可设置一次性版本冲突或 UNKNOWN：

- 冲突返回原 API 的 409，表单和来源保留；核对当前版后可另存新候选，不覆盖旧版。
- UNKNOWN 在内存写入后模拟 503。表单保留原 operationId，“核对原保存结果”先只读查询原回执，恢复原采用意图；不换编号重复创建。
- 控制条“查看演示状态”可查看内存记录、准确版本、请求日志和冻结上下文，便于核对上述差异；不属于拟议产品流程。

## 合成 transport 和真实边界

`stub.ts` 在浏览器内存处理原客户端 URL，支持配置／项目目录、Goal create/revise/adopt/operation、Case 创建与准确目标绑定、Project 新建、Plan 草稿／固定轻量准备／两种确认、Task snapshot/events 及必要空目录。原项目／Task 自动读取的数据库来源、结果和方法提取历史仅返回空目录；数据库授权、查询和方法提取执行不开放。目标采用有原 expectedVersion 和 operationId 去重语义，未修改原客户端或服务端。

未列出的 `/api` 返回明确 503。Vite 没有任何 Host proxy，即使浏览器 stub 漏接，服务端 `/api` 也失败。跨 origin fetch 被拒绝，CSP 只允许同源连接和本地 HMR；没有正式 4175 兜底。Task 的 messages/commands 明确拒绝模型执行。配置是虚构的 public config，不含任何密钥；`hasApiKey:true` 只用于走原 NewProjectDialog 的可点击演示。

自然语言回复是有限合成示例，方法名字与变化内容用于展示交互，不证明实际 LLM 或 Skill 已采用方法。讨论/候选在页面内存，默认用途是专属 localStorage；刷新后不保留讨论或 Goal 模拟写入，不证明真实磁盘保存恢复。

集中采用表单复用真实 CaseDialog 和真实 Goal 客户端，新增预填逻辑本身是演示组件。为不假装真实讨论已接通，模拟保存用原 GoalSourceRef 可表达的合成 task 来源；演示讨论 ID、原 sourceGoal 和用途另保留在合成工作上下文。拟议产品实施仍需按 spec 接入 Interface v3 strategy-discussion profile、真实 owner/native 来源，并落实原 GoalStore 权威与恢复合同。该真实接缝本 Demo 未实现。

## 本次检查与证据

- Vite 8.3.5 实际构建通过；原 App 整体载入产生大 chunk 提示，保留于 `demo-build.log`，未为此改产品分包。
- 新增演示文件独立 TypeScript 检查通过，命令见下。
- 本地 HTTP smoke：增量/基线/部门入口及两个被变换模块均 200；直接 `/api/strategy/goals` 返回 503，证明没有 Host 代理。
- Root 首轮点击到原 Task 后发现两个自动读取的演示空目录缺口；已只补数据库来源／结果 GET 和 SAP 方法提取历史 GET。实际读取客户端对合成 transport 的 8 项 Node 检查通过，POST 方法提取、未知 API 与外网仍拒绝，见 `.local/v12-preparation/demo-task-empty-read-check.json`。原产品源未改。
- 准备复核 R2/R3 已修：Goal 入口经原客户端读取准确版本，`context.ts` 只接受该 Goal 已绑定的冻结上下文或该版本 scope，不回退默认／场景或无关讨论；个人及部门的合成回复、候选依据按用途表达。8 组演示上下文反例通过，见 `.local/v12-preparation/demo-goal-purpose-check.json`。这些是 UI 示例与内存上下文检查，不是专业或真实模型验证；Root 的原发现截图 10 保留，修后由 Root 重拍。
- Stub 作者的 Node 纯内存 smoke 覆盖 v1/v2、create/replay、UNKNOWN 回执、409、Plan→Task、冻结上下文、Case 目标、未知 API 与外网拒绝；属于合成 transport 检查。
- 本子任务没有打开浏览器；实际外观、点击与流程观察由 Root 统一执行，另留其证据。构建通过不替代这些观察。

```sh
node_modules/.bin/tsc --ignoreConfig --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --jsx react-jsx --allowImportingTsExtensions --skipLibCheck --types node,vite/client openspec/changes/overall-architecture-v12/ui-demo/main.tsx openspec/changes/overall-architecture-v12/ui-demo/v12-ui.tsx openspec/changes/overall-architecture-v12/ui-demo/vite.config.ts
node_modules/.bin/vite build --config openspec/changes/overall-architecture-v12/ui-demo/vite.config.ts
```

实际证据位于 `.local/v12-preparation/demo-typecheck.log`、`demo-build.log`、`demo-http-smoke.json`、`demo-runtime.json`、`demo-transform-App.tsx.json`、`demo-transform-StrategyGoalsPage.tsx.json`。最终完整确认稿与非作者检查由上级 spec/result 固定；本 Demo 不可直接作为产品实现合入。
