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
