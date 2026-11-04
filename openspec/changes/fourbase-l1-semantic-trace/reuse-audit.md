# L1 现状与最小差额核查

2026-11-04 · 只读实码审计，非产品运行验收

基线 main／HEAD `8425ca159bc674b73ad54b80ce523a93b4f3b900`；`git fetch origin main` 后二者差异0。已包含 `f174ebb`（#30前台子Agent／原生搜索）等既有合并。当前候选叠加 M2–M7 已开发 WIP，不是干净 main；开工前1,384文件身份在 `.local/fourbase-modules/m7-l1-semantic-trace/preparation/before-candidate.json`。保全原件和旧限定，不提前提交／清理它们。

代码发现优先现有 codebase-memory-mcp 项目 `Users-bendandebaba-.codex-worktrees-duckdb-phase1-OptraCall`，再核对原代码位置；索引不代替实际文件。另有未参与创作的只读能力核查 Agent；该能力核查不是最终确认包独立复核。

| 已有模块 | 实际依据 | 可直接复用与边界 |
| --- | --- | --- |
| SAP0.2 | [validate.ts](../../../extensions/business-plugins/metric-factory/sap/validate.ts)、[library/store.ts](../../../extensions/business-plugins/metric-factory/library/store.ts) | 定义、参数／维度、统计时间粒度和来源；精确发布版及完整字节hash；不覆写／同内容换版也拒绝。严格字段不支持直接加valid_from，time_grains不表示生效期 |
| SAP usage／运行提供 | [api/routes.ts](../../../extensions/business-plugins/metric-factory/api/routes.ts)、[enablement.ts](../../../extensions/business-plugins/metric-factory/project/enablement.ts)、[project-session.ts](../../../src/agent/project-session.ts) | usage枚举当前启用，不是历史实际使用；原semanticProvision是runtime-initialization／provided-not-adopted |
| M2准确输入／说明／来源 | [types](../../../src/host/project-data-context-types.ts)、[store](../../../src/host/project-data-context-store.ts)、[references](../../../src/host/project-data-context-references.ts) | 固定字节、说明修订、字段位置、来源性质、确认和争议；SAP／概念ref、报告／附件citation已齐。校验身份不证明键唯一、JOIN口径或业务正确 |
| 企业资料 | [types](../../../src/host/enterprise-materials-types.ts)、[store](../../../src/host/enterprise-materials-store.ts) | 原正文修订、scope、source、owner、effectiveTime文本、createdAt和hash；不是已核业务规则库或双时间表 |
| M4原生历史／治理 | [personal-context-history.ts](../../../src/host/personal-context-history.ts)、[personal-context-reader.ts](../../../src/host/personal-context-reader.ts) | 实际entry及交付内容范围、当前排除／纠正；缺失／嵌套未知保持；不建第二会话库 |
| M5判断／关系 | [case-decision-types.ts](../../../src/host/case-decision-types.ts)、[service](../../../src/host/case-decision-service.ts) | 有向supports/opposes/limits等、准确revision、影响说明；source目标已经支持M2 citation。人的choice、行动和反馈各有权威，不能由判断状态推断 |
| M6跨事项准确来源 | [case-sources-service.ts](../../../src/host/case-sources-service.ts)、[learning-source-types.ts](../../../src/host/learning-source-types.ts) | 可读准确decision/choice和治理，分页／未知，沿原refs；不扩跨Case写入或反证级联 |
| citation读取差额 | [personal-retention-sources.ts](../../../src/host/personal-retention-sources.ts) | 当前来源读返回固定报告／附件正文；本次需要一并读取原citation manifest，才能继续展开SAP／输入／概念refs |
| citation写资格差额 | [原M2-D06](../fourbase-multisource-context/structure-decisions.md#第6项成果计算产物与明确引用)、[routes](../../../src/host/project-data-context-routes.ts) | declarer已有agent，原批准准入仍限用户显式记录；D05须明确批准才给Agent同一保存能力 |
| analysis-ir | [原业务语义规格](../business-semantics-verification/spec.md) | 明确“不建IR”，当前未核得现成接线；不照附件假定其已存在，不作为依赖 |

## 复用结论

新差额限于有界的精确语义依据查询／citation清单读取、原Pi工具接线、原citation的Agent显式保存资格和按需UI。无新存储根、SQLite表、SAP版本协议、M5/M6来源枚举、业务时间引擎或全域采用账本。

数据映射不等于完整Binding验证；本版能暴露缺口并让Agent按原计算路径核查，不能宣称Host已具备自动JOIN安全或事实裁判。业务有效时间只在原文明示时引用；当前保存时刻不能补造Agent当时已知。原稿声明、实际提供、计算真实遵循三者不能合并。

原Pi随包 `docs/session-format.md`／`sdk.md` 与锁文件仍为1.4.0：entry tree、custom tools／toolResult、保存、分支、恢复及压缩可复用。历史只读查看继续使用项目的只读快照读取，不能为了追溯调用会迁移／写入的SDK加载路径。新工具返回保存到原native，不另写逐轮上下文或消息镜像。
