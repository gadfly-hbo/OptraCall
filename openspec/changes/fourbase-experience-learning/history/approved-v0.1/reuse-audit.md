# M6 现状、最小差额与四原则前置检查

2026-11-04 · 只读代码／固定文档核查；不是运行验证或开工批准。

## 核查身份与方法

沿M5最终产品清单431工程输入，HEAD `0f8ee5ba0e3c626e517457cd08289a5ddd0d4cd9`、分支`codex/fourbase-phase01-design`及现有WIP；M5交付380071 bytes、SHA-256 `3a529696c0cd5d619ea3b96b2a93e0006b63a25d956ee167309d7d3500544e8a`已完整回读零漂移。基线和475份开工前准备副本见`.local/fourbase-modules/m6/baseline.json`及before，不以旧HEAD代替未提交内容。

代码发现优先graph `optracall-m5-product-final-20261104`（5698节点／18029边），按符号／路径读具体实现；图对闭包／依赖注入不完备时定向补读，不把无命中当不存在。两个只读调查分别核产品全貌与代码接缝，候选作者不是最终非作者复核者。

项目声明与已安装manifest均为`@earendil-works/pi-coding-agent 1.4.0`，随包docs/sdk.md SHA-256仍为`d9034ccbf2219a58712d8dd4fcdf47e687d77131e71dd5d119d8a71e9bd2a2e8`，与[前次研究](../personal-assets-phase01/agent-memory-research.md)固定官方文档一致。本轮没有重新联网调查第三方候选现况、安装包或运行其能力；不把旧研究当新兼容／性能实测。

## 代码能力与差额

| 能力／准确证据 | 当前事实 | M6最小处理 |
| --- | --- | --- |
| [原Pi会话接入](../../../src/agent/project-session.ts)、[候选解析／工具](../../../src/agent/agent-candidate.ts) | 正文20,000字符、最多8来源；同一普通任务可自主留下候选，原native唯一保存 | 继续Pi持久化和原工具，不新建会话／消息／候选正文库；只补新source类型及相应版本 |
| [M3源类型](../../../src/host/personal-retention-types.ts)、[严格解析](../../../src/host/personal-retention-validation.ts) | 只有enterprise／citation／native-reply／feedback，M31复用同解析；没有准确M5卡片／choice／另一候选 | D02三类最窄准确ref；不伪称现成能力，不按标题或路径代替 |
| [原企业资料Store](../../../src/host/enterprise-materials-store.ts) create／update／freezeExact | materialId稳定，草稿version CAS、准确正文revision；create随机新ID且没有operationId | 预填现编辑器，原正文修订作为正式经验权威；不包装成跨Store原子create+retain |
| [原个人保留Store](../../../src/host/personal-retention-store.ts) saveDraftMeta／retain／endPending | item CAS、fingerprint、pending、freezeExact和发表／FAIL／UNKNOWN已有 | 原保留决定是正式发表入口，不新增pattern head、发表引擎或运行账 |
| [原候选UI](../../../src/host/ui/AgentCandidatesPanel.tsx)、[原个人资料UI](../../../src/host/ui/PersonalMaterialsPage.tsx) beginEntry／saveEditor | 候选只有收藏／纠正／排除／恢复／加入任务；新建无ID／正文已存metadata未知等阶段已区分 | 新窄预填入口及明确更新目标；复用阶段语义，不要求人重抄候选，不承诺无法证明的整步回滚 |
| [M31人的控制](../../../src/host/agent-candidate-controls.ts) apply | 只是人的引用控制，不编辑候选正文 | 收藏仍直接可用；持续正文修订沿M3，不用取消收藏＋收藏假扮修订 |
| [M4 reader](../../../src/host/personal-context-reader.ts) find／resolve／read | 发现保留条目和候选，准确正文／sourceIndex／预算／续片与当前治理已有；不枚举全部Case | 原找回可直接用；为未留候选的旧Case补窄只读发现，正常分析不先人工维护目录 |
| [M5源解析](../../../src/host/case-decision-service.ts) resolveSource、[CaseStore](../../../src/host/case-store.ts) getDecision／listDecisions／getStrategyChoices | 准确卡片get可复用；原M5工具／关系约束同Case，choice是独立原事件，不在卡片内 | 新跨Case读口独立只读，准确choice查原事件；原M5写源与新个人union分开，保Case SQL schema2 |
| M4 retained与candidate两条resolve路径 | 整理稿只回M3正文／metadata；候选路径才附当前纠正／排除 | 精确来源回看时披露治理，不假装已经自动传播到派生稿，不自动重写或归档 |
| PersonalRetention records严格遍历schema1／metadata；M31 details只认v1 | 零新表仍有格式兼容代价；旧二进制遇新source会失读，可能整个人账503 | 明示个人账v2、含新来源candidate v2，GET不升级；先固定可读新旧且可关新写的兼容候选 |
| [原任务／报告入口](../../../src/host/server.ts)、[原项目存储](../../../src/host/project-store.ts) | 草稿、真实配置、native、文件及准确成果引用已可用 | 可选评估草稿／原Markdown报告，记录可比性与结果；无新EvalStore／自动评分或实验调度 |

### 特别防止的重复建设

不从“模式”“成熟”这些产品词推导一套实体状态机；不从多事项推导Learning Agent、后台抽取模型、图数据库或全局依赖引擎。没有新检索质量／关系缺口证据时，不安装pi-memory、qmd、Mem0、DuckDB或Semantica。原Pi及现有业务来源负责其已有能力，M6补可证明的业务接口差额。

新ref不能简单直接扩大原`PersonalSourceRef`在全产品的写集合：M5 `target.type=source`也引用它，会影响严格Case旧行校验。D06要求旧四类Case写合同保留，新个人学习来源用分开的扩展类型／解析入口；不借共用类型意外升级Case库。

## 四原则前置检查

| 原则 | 设计与UI行为 | 实施后必须验证 |
| --- | --- | --- |
| Host管环境 | 绑定真实读权限、来源／版次、原保存／状态／UNKNOWN；不从反馈或引用数计算真假／成熟 | 原Store及HTTP／SDK链，来源伪造／失读／同名／取消晚到拒绝；无业务自动派发 |
| Agent自主执行 | 同原任务自主发现、读、比较、提炼，允许零候选／未知，合法组合／nested保留 | 不增加强制先读后写、方法配额、固定步骤或隐式模型纠错循环 |
| 优先复用Pi | Pi原件、M3资料修订／保留、M4预算／IPC／取消、M5原Case事件；仅必要只读port和union适配 | 实际接口v3、owner/profile、native真实结果和无平行Runtime／队列 |
| 减少人的操作 | 正常提问零新增必做；收藏一击，正式整理才进入预填原编辑器，理由／来源渐进显示；对照任务完全可选 | 实际产品流程无先建比较／先收藏Case／填写机器字段／逐条读取批准；异常处置与正常使用分开 |

两处必要人的决定不替代：选择长期保留哪份解释、选择更新哪个既有个人条目。原分段保存已经发生的副作用必须展示，不能为了文案简短说“什么都没保存”；这属于环境／历史治理，不是要求人每天写日记。

## 验证与未完成

当前仅静态事实和虚构Demo审阅；没有运行产品测试／SDK／模型、访问真实业务dataRoot或取得真实反馈。本期工程准备通过也不能标模式成熟、专业增益或真实业务试点。未来按spec EL01–EL10执行真实行为前置RED、原消费者回归、隔离合成产品链与全新非作者专项，旧FAIL／UNKNOWN／NOT_PROVED不重评。
