# 运营数据分析 Skill 新契约候选

2026-11-16 · 原M3/A11候选准备记录。当前用户已授权免运行独立测评、直接通过并接入，见[接入记录](skill-adoption.md)。下列准备时状态保留为历史，不再构成等待门禁。

原记录：2026-11-16 · M3/A11并行准备。用户已确认整体spec/UI并开始实施；本项仅固定独立Skill候选，不改变当前有效Skill、原测评回执或Host接入状态。

## 候选身份与范围

- 候选：`2.0.0-candidate.1`，入口`data-analysis/SKILL.md`，完整目录[本机候选](../../../.local/overall-architecture-upgrade/development/skill-candidate/data-analysis/)。
- 整目录SHA-256：`f7fd87d384b197ed22913b4772ec3006c949c63bdd77053645448cdd309d7106`。按排序相对路径、NUL、文件SHA、LF串接后取SHA-256；8文件完整清单见[manifest](../../../.local/overall-architecture-upgrade/development/skill-candidate/candidate-manifest.json)，其文件SHA为`446841fca6bcb7006d3cfdda1015e63c19022e9d5e26a380a16560f44a6ee881`。
- 来源：当前工程基线`3ebaa01d2fd6d81a6605f408f9f414a4b8bd7a19`的OptraCall自有data-analysis有效目录。六份原文件复制后独立修订；`calc.py`逐字节保持，公式/精度/输入拒绝不改。
- 能力：运营数据描述、可比对比、异常、拆解及体检；预期改善为“可交有依据诊断而不编执行承诺，完整报告和聊天摘要按实际约定分工，同时保留专业检查”。目标测算、发券/投放、深度研究沿原分流，不把全部项目分析等同本Skill。
- 运行条件：Python3标准库，无新增包、网络、会话、凭据或SDK接入；正式执行仍沿原Task、Interface v3及项目目录/权限。

## 旧冲突与候选修订

| 原有效契约差额 | 候选改动及通用规则 |
| --- | --- |
| 归因一律在聊天贴六段全文，文件一律副本 | 分开分析意图、建议类型及交付载体。专业报告保留适用六段；文件为正式成果时完整内容在文件并读回，聊天摘要给准确入口；明确约定正文全文时仍交正文。项目综合引用子成果并核分歧，不复制所有全文 |
| 每条建议一律有责任人/时限，quality R2同步强制 | 诊断建议允许建议角色、试点、建议期限和待确认事项；正式行动计划才写真实确认的责任、时限、授权/必要资源及跟踪依据。缺确认交诊断/草案，不编造经营承诺 |
| 报告检查不识别两类载体/建议 | `quality_check.py`新增开头声明：`交付形态：完整报告/聊天摘要`、`建议类型：诊断建议/正式行动计划`；冲突/未知声明拒绝。摘要继续检查适用专业红线；正式计划字段只核存在性，不自证授权。计划摘要另提示完整原计划未在此验证 |
| 项目方法、专业Skill和输出约定易混同 | SKILL分别承接准确项目方案、Skill专业检查及交付约定；TOC/TP为项目整体约定，具体方法/工具/顺序自主；已选Skill/IR须实质采用并留准确版本/限制 |
| 随包方法/示例仍反向强制旧输出 | method、sample-data、examples同步修订，新增delivery-contract/selfcheck-cases两个被入口引用资源。样例分别给完整诊断、聊天摘要、另有明确合成确认前提的正式计划；不把样例人选或授权当真实事实 |

现有未声明旧报告仍沿旧六段/行动检查兼容；没有批量回写历史，也没有把新候选规则套为旧版已采用。旧Skill和旧测评身份保持，不能沿旧回执宣称本候选通过。

## 作者自检及原始失败

证据根：`.local/overall-architecture-upgrade/development/skill-candidate/`。先复制保留`baseline/`及`baseline-identity.json`，再按独立可观察行为逐片RED→GREEN：

1. 完整诊断不编造责任/时限：旧检查缺末段及R2拒绝，`red-01.log`；修后`green-01.log`。
2. 聊天摘要不重复六段：F1拒绝，`red-02.log`；修后`green-02.log`。
3. 正式计划缺授权不能通过：原规则错误PASS，`red-03.log`；修后`green-03.log`。
4. 多/未知声明不能选择较松检查：原规则错误PASS，`red-04.log`；修后`green-04.log`。
5. 计划摘要不冒充完整计划验证：原缺独立提示，`red-05.log`；修后`green-05.log`。

| 检查 | 实际结果与位置 |
| --- | --- |
| 原quality兼容自检 | 25/25 PASS，`legacy-selftest.log`（添加新内置用例前）；原数值/数据/红线均保留 |
| 候选quality自检 | 36/36 PASS，`candidate-quality-selftest.log`；包含11项新契约、模式冲突及摘要专业红线反例 |
| 原calc自检 | 21/21 PASS，`candidate-calc-selftest.log`；calc文件与有效版相同 |
| 新独立行为回归 | 6个unittest方法PASS，含3种冲突声明子例，`contract-final.log`；runner为`contract-regression.py` |
| 3种实际样例正文 | full-diagnostic/chat-summary/formal-plan分别提取、CLI检查exit0，`*-check.json`；整份参考文档不当一份报告送检 |
| 示例数值独立字面真值 | 609500/28天→612950/31天：总量+0.57%、日均-9.17%、日均21767.86→19772.58，与`compare-check.json`一致 |
| 完整目录/链接/保全 | 8文件清单已固定；包内Markdown相对资源无缺链；原有效6文件SHA保持，见`author-checks.json`及baseline身份 |
| 跨场景作者夹具 | 完整诊断、另有确认前提的正式计划/摘要、首购资料缺失、缺授权失败、模式冲突及术语翻译负向路由，见候选selfcheck-cases.md |

上述只证明确定性自检和静态路由契约，不证明模型真实激活、专业正确性、增益、误触发率、文件真实保存或经营授权/效果。有限文本检查器可能漏判语义，原限制保留；首购缺证和翻译负向的真实模型行为均NOT_RUN。未运行新增真实模型或业务数据实验。

## 原候选准备时的测评与接入状态（历史）

- **可提交独立测评**：完整候选及作者自检已准备并固定。
- 本机已只读核`DevWorkSpace`及其Projects、用户常用开发根和Codex工作树下已命名目录，未发现可确认的`skill-eval/pending/`仓库；原历史记录仅给MacBook路径`/Users/huangbo/Dev/Projects/skill-eval/pending/data-analysis/`，该历史位置尚未现场重核。本项未SSH/写MacBook、未覆盖历史pending或新建伪仓库。候选保持在上述持久本地目录，交由既有测评流程接收。
- 独立测评、用户通过回执、正式有效Skill接入、真实Agent采用及专业/产品验收：**NOT_RUN**。整体M3/A11仍未完成；其余工程工作可以并行，不用等待本项伪造通过。
- 按工程规范第5节，取得绑定此候选且经用户明确确认通过的独立测评回执后，再由Codex在原变更接入、工程验证和非作者复核。当前有效`extensions/analysis-assets/data-analysis/`六文件、目录展示、旧分数/暂定结论/历史FAIL均未改动。
