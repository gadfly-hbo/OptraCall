# Studio 36格全景审核包 v0.3

2026-11-13 · 待用户审核 · 暂不产品开发或目标企业建设。

本包承接v0.2，按用户反馈将完整36格提升为重要的首个主要视图，修正资料份数与14关注格混用、按列跳同一片段的对应问题。原学习目录八稿、全部v0.2文稿、旧spec与Demo冻结不覆盖。当前产品基线仍为已交付main `a4eca5e1`及其同树工作分支；本次只修审核文稿与静态合成Demo。

| 入口 | 本次重点 |
| --- | --- |
| [结合实施方案](implementation-plan.md) | 原能力复用、视图与证据投影的受影响修订、停止边界 |
| [D1 36格范围与证据对照](lattice-map.md) | 全36逐格含义、首批14与非重点22、多对多及独立计数 |
| [D2 资料盘点参考指导](survey-playbook.md) | Agent自主盘点、准确逐格对应与来源反查、用途依赖 |
| [D3 方法接续入口候选](optracall-readme-patch.md) | 待应用说明，不修改旧README或原模型字段 |
| [原Spec基线](../../../openspec/changes/studio-business-coverage/spec.md) | BC01–BC12报告正文、来源／权限／版本／普通使用合同保持 |
| [36格视图增补Spec v0.2](../../../openspec/changes/studio-business-coverage/amendments/36-cell-view-v0.2/spec.md) | C01–C10主视图、具体含义、计数及正反向对应 |
| [可点击UI Demo v0.2](../../prototypes/studio-business-coverage-v0.2/standalone.html) | 36格全景→逐格证据／资产→反向来源→普通任务与历史 |
| [增补目标任务清单](../../../openspec/changes/studio-business-coverage/amendments/36-cell-view-v0.2/tasks.md) | 当前准备真实进度、未启动产品与企业阶段 |
| [增补准备复核记录](../../../openspec/changes/studio-business-coverage/amendments/36-cell-view-v0.2/review.md) | 固定候选、作者走验、非作者结论及未验范围 |

## 这版改变什么

“36格全景”是首个主要页签，默认全36格可见，每格有固定坐标与具体含义；首批14参考关注格高亮，其余22格可看含义、关联参考和本轮边界。不重点建设、不适用、缺资料、未调查分别表达。首批参考建议、本报告实际关注集与用户临时高亮分开。

资料、片段、三类资产与格子多对多。各格只展示实际带该坐标及依据的条目，可反向从准确来源／资产修订查看对应格。资料按准确source／revision去重，资产按准确asset／revision去重，方法独立列数；不累加各格资料数，不把格数当文档份数。旧Demo六问3＋2＋2＋1＋2＋3是无独立来源集合支撑的合成硬编码，不能据此核定13份资料或14格覆盖；新Demo须由逐条fixture准确身份和对应驱动数量。

原spec提出的business正文派生报告及独立`reportProfile:'studio-coverage/1'`保持；本版只改视图与证据投影规格，不修改报告body/profile、三类资产合同或原工具，不设36格治理库、覆盖率引擎或填格门禁。

沿用原三类资产、两层、两条参考路线，原资料及SAP、来源／发布／工作项、普通catalog/read-source/reason及历史。未标坐标、无报告或关注格没填满都不阻断原分析。坐标不赋予资格，疑似冲突不直接停用正式源。

无报告、读取失败或未知格式时，框架36格标题／含义仍可看；本报告证据与数量显示未知，不能填0或沿用旧读取结果。候选只沿原建设权限查看，普通Agent继续合格正式来源准入。

## 建议审核路径

先打开Demo的完整36格，查看首批14和其余22的具体含义；逐格核对证据／三类资产与反向来源，再查资料、资产和方法各自清单及去重口径。随后查看无报告／读取失败仍可读框架、合法多版本、无报告普通分析与历史。最后对照本次增补C01–C10及原BC02／BC07–09，审核主视图与计数、对应、资格和停止线。

全部Demo为合成预置、页面内存，无产品API、SDK／模型或实际业务动作。文稿和原型准备通过不证明产品已实现、目标企业正确或真实模型专业通过。旧专业FAIL／UNKNOWN按原记录保留。

原件位置、SHA及基线在[baseline](../../../openspec/changes/studio-business-coverage/baseline-manifest.json)；本包修订原件不代表原学习目录内容已更新。后续若交付MacBook审核副本，需与本固定包核对清单，不能将副本误认为已挂载产品。

框架依据见[Zachman官方精确定义](https://zachman-feac.com/resources/ea-articles-reference/166-the-concise-definition-of-the-zachman-framework-by-john-a-zachman)。六行六列用于分类，不是实施阶段；本地中文标题、首批范围及交互是OptraCall适配，非官方图复制。
