# M5 现状、复用与四原则核对

2026-11-03 · spec／UI准备的作者侧核对；不是产品实现或独立验收。

固定源码来自M4完整本地工程候选，HEAD为`0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`，当前分支`codex/fourbase-phase01-design`另含M2／M3／M3.1／M4 WIP。408份工程源输入及此前交付完整回读见`.local/fourbase-modules/m5/baseline.json`，不能只用HEAD指认当前代码。没有打开业务dataRoot或真实记录；进入M5的依据是用户本轮明确要求，未证明真实持续使用频次。

## 复用和真实差额

| 当前能力与可核对位置 | M5处理 |
| --- | --- |
| [Case类型](../../../src/host/case-types.ts)／[CaseStore](../../../src/host/case-store.ts)：Case描述、总判断、下一步、说明、项目链接、产物、操作回执、before/after事件；[原Case界面](../../../src/host/ui/CaseBoard.tsx)已有“按此Case继续” | Case身份／权限／普通任务入口／原成果与历史直接复用。缺口是多条假设／策略的稳定ID、独立修订、准确关系与人的策略取舍史，不能只把总判断改名。 |
| [RAP](../../../extensions/business-plugins/requirements-elaboration/storage/store.ts)：发布实例／版本及内容指纹；方法假设不是已证实业务判断 | 可显式固定原发布版作为依据，不迁移或自动晋升全部RAP假设，不另造需求包或方法库。 |
| [Board存储](../../../extensions/business-plugins/decision-board/storage/store.ts)：建议状态、行动owner/dueDate/note与todo/doing/done；建议采纳／驳回更新当前值，没有完整取舍史 | 原行动保持权威。只补Case策略的独立人选择及指向原行动的关系；不会重建Board或以Case选择替换原采纳/执行。原行动公开口并非完整计划编辑器，本期不顺带改造。 |
| [Feedback类型](../../../extensions/business-plugins/decision-board/types.ts)／[回流类型](../../../src/host/decision-feedback-types.ts)：追加FeedbackRevision和CAS；观察期、来源性质、局限在handoff／receipt而非每条反馈正文 | 固定反馈revision，可得时另带原handoff；不声称每条旧反馈都有业务观察范围。实际执行陈述、人的选择和经营效果分别展示。 |
| [反馈回流](../../../src/host/decision-feedback-routes.ts)：原任务续问、另存、RAP草稿及显式更新Case | 不重建复盘服务，只让Case当前记录可以引用原权威。 |
| [M3准确来源](../../../src/host/personal-retention-types.ts)／[M4准确读取](../../../src/host/personal-context-reader.ts)：资料、成果/附件、原生回复、反馈和个人保留／候选 | 沿原ref与reader，不复制证据正文为第二内容库；只新增当前确实缺少的Case卡片／准确RAP发布／可变行动观察关系。来源失读和专业反驳分开。 |
| [Pi依赖](../../../package.json)、[原项目会话](../../../src/agent/project-session.ts)／[Runtime](../../../src/agent/project-runtime.ts)、[统一接入](../../../docs/agent-session-integration.md)：Pi1.4.0、project-tasks Interface v3业务子集、公共生命周期；M3.1原生候选，M4同prompt find/read及call-local权限模式 | 沿原Pi会话／循环／工具执行／恢复／压缩／取消；增加两个窄Case业务读／草案保存工具是业务写口差额，不是记忆Runtime。无需另装记忆组件或新Agent、推理队列、重试循环。 |
| 原CaseStore对`sqlite_master`完整库存与`user_version=1`严格核对 | 不声称旧程序会忽略新增表。D07推荐沿原SQLite加一张修订表并升级schema2，以复用Case事务和回执；必须先备妥可读v1/v2的关闭M5兼容版本，才允许将来真实迁移。独立侧存储作为替代B，代价是新存储身份／恢复和跨库准入；本次没有实施任何候选。 |

详细24项事实、原始源码hash、独立的职责精简审计和存储比较分别在`.local/fourbase-modules/m5/audit/`下。首次审计曾偏好独立侧存储，其后补查同库方案与兼容代价；两份原记录均保留，不能把后续建议冒充首次结论。

## 四点产品原则的设计前置检查

| 原则 | 本包可审阅的设计证据 | 不得暗增的行为 |
| --- | --- | --- |
| Host管环境 | D02/06/07：真实作者、Case绑定、权限／lease／取消、容量、追加保存／CAS、原意图查询、展示和保全 | 不判真假、算经营因果、替人选方案、自动改行动。校验只反馈具体问题，由Agent自主修正。 |
| Agent自主执行 | CD01/04/08，D01/03/06：直接提问，Agent自选材料／方法／执行次序，草案可零条或多条；影响解释由作者表达 | 无先查后写固定链、假设数量／方法配额、逐读批准、必填完整计划、自动遍历推断依赖。 |
| 优先复用Pi | 原Pi1.4.0及统一接入/M3.1/M4模式，业务SQL单独权威，native只证明实际留存内容 | 不新消息库／摘要服务／fork/compact/retry/恢复机制；不为native子正文未知禁止合法nested，不造跨native/SQL两阶段事务。 |
| 减少人的操作 | 原Case继续工作→正常发送；机器ID由Host；Agent整理草案；人的准确取舍一击、理由可选、计划来源按需展开；原反馈只录一次 | 不要求每日记忆维护、先收藏／建Case、全量证据编目、逐条审批草稿或重复填写原行动字段。 |

设计层面按上述边界形成候选；真实产品符合性仍待用户批准后的实现、动态前置RED／GREEN和独立专项检查。必要权限／只读／预算／原件保护不视为越界；不得为了降低操作而绕开它们。本包最终非作者结果另见[result](result.md)。
