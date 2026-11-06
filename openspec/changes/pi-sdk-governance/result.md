# 官方 Pi SDK 规则核对结果

2026-11-06 · 规则文档已建立，非作者只读复核PASS（限本轮文档与核对范围）；当前实现不能整体声明完全合规。范围见[规格](spec.md)，规则唯一来源为[工程规范](../../../docs/engineering-workflow.md#官方-pi-sdk-来源与版本约束)。

## 已核实符合或已有基础

| 对象 | 本次实际结果 |
| --- | --- |
| 声明／解析版本 | `package.json:21` 精确锁定 `@earendil-works/pi-coding-agent@1.4.0`；`package-lock.json:480` 起为官方 npm registry 归档与 SHA-512，实际安装包同为1.4.0，未指向私有 fork、本地替代或 symlink |
| 安装包原始性 | 从对应官方 registry 版本元数据取归档，先核与锁文件完整性相符，再对本工作区6个官方Pi包逐文件比对：coding-agent 1279、agent-core 26、ai 845、codemode 66、mcp 76、tui 204，共2496个文件，变更／缺失／额外非依赖文件均0。只读归档与安装目录，未安装／改包 |
| 统一入口与版本回读 | 实际SDK包导入集中在 `src/agent/sdk.ts`；`src/agent/runtime.ts:7` 从 SDK 导出 VERSION 提供 SDK_VERSION；官方传递依赖 agent-core／ai 均1.4.0，不等于另建Runtime |
| 现有接入治理 | Interface v3及IN01–IN07已有owner、生命周期、取消／恢复与消费者检查；新规则补齐来源、版本决定及升级专门验收，不替代现有边界 |
| 未发现的改包手段 | 所检查源码、依赖配置及脚本未发现SDK patch-package、私有fork、本地SDK替代或安装后改包脚本；测试中的postinstall字符串为“不执行生命周期脚本”的合成fixture，不能当成产品改包事实 |

上述原始性核验只覆盖当前工作区安装的6个官方Pi包，不证明其他依赖全部原始、其他工作树／全局Pi／运行服务／MacBook已核验，也不能证明此前从未修改过包。

## 需要后续处理的风险

| 优先级／事项 | 当前证据与影响 | 后续规范及处理方向 |
| --- | --- | --- |
| 高：SDK工具定义运行时原位改写 | `src/agent/project-session.ts:71–102` 的 `bindPersonalToolContexts` 在82行改写 `getToolDefinition()` 返回对象的 `execute`。官方1.4.0 `dist/core/agent-session.js:1110–1111` 返回内部注册表中的原definition引用；即使官方包字节不变，启用个人资料／Case／经验／语义或source-reader相关上下文时仍会原位改变已注册工具执行。当前不能视作已符合“不以其他方式改变官方实现” | 后续单独核定并改造为官方支持的公开事件／注册／扩展及Host自有包装对象，保留上下文归属、取消和原权限保护；先补针对性因果回归。不能直接删除保护，也不能以“代码在Host里”豁免。这里只登记，不实施修复或静默批准例外 |
| 中：内部MCP导入绑定版本及安装布局 | `src/agent/sdk.ts:6` 直接导入 `node_modules/.../dist/extensions/mcp/config.js`；11行只允许 VERSION1.4.0。原理由见[商圈IN06](../trade-area-mcp/spec.md#codex-接管补充2026-11-03)：官方入口缺少loader，复用原解析器。静态import可能在版本检查前因移动／exports变化失败，影响统一SDK入口加载 | 保留为已知只读内部接口依赖，不当公开稳定API。升级前记录owner Codex、目标版本／文件布局和失败影响，优先改用目标版本公开能力；旧IN06理由不能自动覆盖新版本，更不授予改包权限 |
| 中：第三方依赖覆盖及网络环境 | `package.json:30–31` 覆盖undici8.12.2，而SDK1.4.0声明8.10.2；`scripts/http-transport.mjs:26–29` 使用公开dispatcher／install建立宿主fetch环境。不是修改SDK文件，但会影响其传输行为 | 升级时重核依赖树、fetch、TLS、超时、取消、Provider/MCP及模型原生联网；不能仅因安全修复／版本号更新认定兼容 |
| 中：原生历史及生命周期假设 | `src/agent/project-session.ts:281`、`src/host/native-session-snapshot.ts:68` 使用原生会话version3；project-session 488–507依赖空会话导出、header保留、setSessionFile及上下文刷新 | 新版本须回归旧历史、空会话首次追加、fork／branch／恢复、指针与原件保全；本轮没有尝试迁移或读取真实历史 |
| 流程缺口：现有门禁覆盖有限 | `scripts/check-agent-session-boundary.mjs` 检查统一导入／构造入口；不证明官方包原始性、版本已由用户指定或不存在运行时原位改写。既有测试PASS不代表本轮新规则全满足 | 本轮已将这些内容纳入开发前检查、升级回归及非作者专项验收；今后若需要自动门禁，在独立任务实现，不能声称本轮已新增CI技术阻断 |

`native-search.ts` 的官方事件钩子、`protected-tools.ts:427–434` 创建新ToolDefinition经公开入口注册，以及读取Theme原型的UI代理，不应一概当成改写官方SDK。关键是官方契约、对象归属及实际调用链。

## 本次文档与证据

- AGENTS提供工程级必读提示；工程规范v1.7集中维护官方包／用户版本决定／适配例外、升级回归矩阵、交付及回退门槛；产品讨论稿与会话接入说明引用同一来源。
- 官方身份参考：[Pi官方仓库](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)、[固定1.4.0 registry元数据](https://registry.npmjs.org/@earendil-works%2Fpi-coding-agent/1.4.0)。仓库main资料只用于确认官方扩展方向，具体已装1.4.0行为以已验证归档代码／文档为准，不把最新文档当本版本合同。
- 核对脚本／完整包结果在 `.local/pi-sdk-governance/verify-official.py`、`official-material.json`、`official-material.log`；开工前文件和Git身份在 `before.json`／`before/`。源码审计含非作者只读核查，最后文档复核另记。
- 本轮未升级SDK，未改官方包／产品代码／测试／依赖／锁文件，未安装、运行模型、读取业务或凭据、切服务或操作MacBook。未运行产品全量测试、动态兼容／真实Provider或托管CI；这些未运行项不表述为通过。规则建立与当前实现合规、将来升级成功／运行采用分别判断。


## 相称检查与收尾

非作者在全新上下文核对六份候选文档、当前源码及风险依据，137个本地链接／锚点零问题，`git diff --check`通过；独立重新核验六份官方归档与本机安装文件，2496文件零差异。非作者报告 `.local/pi-sdk-governance/independent-review.md`（SHA-256 `0ef382a5399d0bf3dca5080052e89330ab1707d6fd14b288d3d5ed281629871e`）结论为本轮文档／风险记录PASS、必须修正文案0；不是既有实现全部合规、SDK升级成功或产品验收。收尾仅补Interface v3／owner范围及本段已发生事实，另作小差异核对。

本工作区规则文件已更新；未提交／推送或运行CI，未验证其他工作树／工具实际加载，不宣称全员已采用。本轮无SDK升级、依赖／锁文件或产品行为改动，故不运行产品全量测试、不制造TDD RED。下一步若要处理工具定义改写或内部接口风险，应另按有效用户任务实施适配和验收；本次只列出问题，不自动修复或默许原实现。
