# 规范变更结果

## 候选与实施

初次本地文档阶段基线为 `codex/four-base`，HEAD `285491bdee439daefe9cafb1f62778703dedf47b`，开始时工作区干净，当时以未提交文档固定候选；固定摘要及检查／复核证据在 `.local/host-agent-boundary-governance/`。

- 工程规范更新为 v1.2：第2节补齐 BG01–BG02，第4节新增 BG03–BG04 专项最终检查并纳入工程完成条件。
- AGENTS 增加简短原则及两处同源锚点；本目录规格记录授权、验收与范围，覆盖 BG05。
- IN01–IN07、现有业务接入、取消／UNKNOWN、原件保护及历史失败记录保持原范围。

## 检查与专项最终检查

范围仅为本次规范文字及受影响引用；未修改运行时代码、调用链或 SDK 接入，无运行采用证据要求，不将本文结论扩大为既有产品代码合规。

2026-11-02，本次文档检查及专项最终检查结论为“通过”，未申请例外，检查范围与证据如下：

- BG01–BG02：第2节覆盖完整分工、自主执行、校验反馈、验证缺口与最小适配；未增加 Host 分析流程或新的 SDK／Runtime 机制。
- BG03–BG04：第4节将专项检查纳入最终独立复核和工程完成条件，明确实际证据、三态结论、合并／发布阻断及批准例外，必要治理与业务契约继续保留。
- BG05：AGENTS 只增加简短原则及同源指针；58处本地 Markdown 引用／锚点、四份候选的空白及末尾换行检查通过，`git diff --check` 退出0。IN01–IN07所在完整统一会话规则区块与基线逐字一致，修改范围仅为规格允许的四份文档。
- 非作者独立复核：规范轴与需求轴均0项发现，实质条款通过；检查命令、固定摘要及范围见 `.local/host-agent-boundary-governance/c1/review/independent-review.md`，自检见同目录上级的 `validation.txt`、`candidate-manifest.json` 和 `snapshot/`。

c1保留结果记录更新前的原始“待验证”候选；c2为初次本地文档阶段的定稿，四文件快照／摘要及记录增量回读保存在 `.local/host-agent-boundary-governance/c2/`。后续 Git 交付的授权及结果增量另记于下节，不以旧复核覆盖新记录；上述“通过”仅适用于其固定文档范围，不是既有产品代码或运行采用验收。

初次本地文档阶段未运行产品测试、真实模型或 CI，未提交、推送、合并、安装、发布、切换服务或操作其他设备。

## Git 交付与已交付 PPT 功能保全

2026-11-02用户追加授权提交并合并 main，特别要求核对 reports-factory、PPT skill 及编辑功能。fetch 后 `origin/main` 已从初始基线前进至 `96a82222b7beea21992d69f8ff5b5c44b1262a4f`，包含已合并 PR #21 的 PPT 生成 skill／逐页编辑插件及 PR #22 的 deck 绑定模型配置；这两项未改动本次两份规范文件。

本次交付在保留四份文档的基础上集成最新 main，不重复合并已 squash 交付的功能分支。集成后以相对最新 main 的文件清单及产品 blob 一致性核对功能保全；文档阶段的58处引用及无运行时变更证据只作为原范围记录。最终候选检查、非作者复核、PR/head/main CI、合并及本机同步的实际身份分别保存在 `.local/host-agent-boundary-governance/delivery/`，未完成项不预记通过。

已创建规范提交 `c69550b`，通过普通 merge 提交 `6ae8d0c` 集成上述 main，无冲突。`origin/qoder/reports-factory` 的 `d23fd55e00b741bd98d923ea098fd49245c9efbb` 与该 main 的整棵 tree 均为 `f637b2ef4796fd5486221a19089653e109ebb9ca`，两者文件差异为空；集成候选相对该 main 仅有本次四份文档增量，`extensions/`、`src/`、`scripts/`、`tests/`、依赖和 CI 文件均与该 main 完全一致。既有 PPT 功能保全已核对，无需再次合并 reports-factory 分支。

最终 Git 候选的文档检查及独立复核另存上述 delivery 目录；实际 head CI、PR 合并、合并后 main CI 和本机同步以执行后的 receipt 回读为准。没有进行新的模型试验、安装、产品运行采用或其他设备操作。

## 用户追加：PPT Host 接线复查（BG06）

用户说明 Host 接线已改派 Qoder，要求再次检查是否正常。本轮以 `285491b...96a8222` 的 PR #21/#22 功能增量和集成候选 `677228602a5c9a11b64410975d2a79d7d29d0534` 为固定输入，读取已确认 PPT 规格及接入合同，通过图检索和实际源调用链核对，并由两名非作者分别做规范轴／规格轴复核。**PPT Host 接线结论为“不通过”，未申请例外，以下缺陷尚未修复。** 功能字节完整保留与规范文档验收通过，均不代表 PPT 接线合格。

已确认 Host 静态注册 `ppt-refiner` 域并复用公共生命周期和 SDK；普通／受管分析的 skill 发现路径已挂载。隔离真实 Host 的 create/get/lock/空闲 stop HTTP 冒烟通过。以下五项经独立复核及无真实模型合成复验确认，全部现场保留：

| 问题 | 复验范围与实际结果 |
| --- | --- |
| 项目模型未绑定 | 按正常 UI 请求形状经真实 Host 创建 deck，meta 无项目／配置绑定；原配置解析函数因此调用全局当前 `snapshot()`。未调用模型，不声称已实测数据发向另一 Provider。真实项目归属、归档忙碌与范围关闭缺口另有源码证据。 |
| 导出覆盖原件 | 隔离真实 Host 接受 `projects/.../010_draw` 导出目标，HTTP 200并替换同名合成原件；原件前后 SHA 不同。没有触碰用户原件。 |
| busy 请求破坏在途差异 | 路由组件配合有门闩的合成 session facade：第二轮被 busy 拒绝、HTTP 409，但先删除第一轮 `last-turn.json`，第一轮快照的 diffs 变为空。 |
| guard 失败误报成功 | 合成 session facade 将 deck 写成无效 zip，真实 Python guard 失败；路由仍返回 completed/200、生成损坏稿快照且删除 before 副本。没有把未知保护结果标记为成功。 |
| 多次回退漏差异 | 纯 Store 复验 v1→v2(A)→v3(B)→回退v1→恢复v3：deck字节恢复到含A+B的v3，但导出清单只有B，漏A。 |

规范轴5项确定问题、规格轴5项问题分别保存在 `delivery/ppt-host-review/standards/report.md` 与 `delivery/ppt-host-review/spec/review.md`；二者有重叠，分别保留判断，不把条数相加当独立缺陷数。规格轴另指出 UI 无运行中停止入口、失败／取消后不读回已保存快照、报告候选到精修缺直接入口；这些为源码／已确认规格对照，本轮未做浏览器动态复验。

工程检查：在本工作树执行锁文件依赖准备 `npm ci --ignore-scripts --no-audit` 后，`npm run check` 退出0：792项，789 PASS、0 FAIL、3 SKIP，接入边界与构建通过；完整日志见 `.local/host-agent-boundary-governance/delivery/local-full-check.log`。跳过项为环境或平台条件，不能替代渲染与产品验收。现有测试未覆盖上述失败，故测试全绿不改变“不通过”。独立报告路径以上述 `.local/host-agent-boundary-governance/` 为根；合成脚本、输出、摘要及失败现场在 `delivery/ppt-host-review/probes/`，脚本共记录1项基础路由通过及5项缺陷成立，使用现有测试 Host 的隔离根、合成材料／session facade，无真实 Provider 请求。

本次仅合并规范与检查记录，未修改已在 main 的 PPT 实现，也未修复或关闭上述问题；其后续修订应按原 PPT 规格及必要归属／兼容决定实施并复验。未重跑真实模型端到端、视觉盲评或用户产品验收，未切换运行服务或操作 MacBook。最终文档候选重新核对记录增量；PPT 代码字节与本轮已检查版本保持一致。
