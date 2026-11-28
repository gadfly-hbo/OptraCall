# Issue #149：真实 UI 补修证据入口

**当前候选 g：完整检查通过，等待用户真实产品截图确认，未开 PR。** 原交付的旧 PASS、补修 a–f 的失败/取消均保留，不追溯改写。

## 从这里审核

1. [26 张当前真实产品截图](product-g/README.md)：实际 Host、实际产品组件/CSS、隔离合成数据，覆盖主页面、弹窗、窄屏与深色。主构建输入摘要 `2f8ee75d4da2c5aca3240e9b26abc4ab7c6a5f798ae6ea650def9195db436f16`。
2. [冻结 Demo／spec／任务逐项非作者矩阵](independent-ui/final-review.md)：18 条 spec、18 项任务、26 个页面/状态/交互，共62行；任务交付门禁单列待执行。含真实产品与冻结参考的差异、证据方法和四原则检查。
3. [另一非作者的后端/草稿/兼容综合审查](independent-backend/final-f/review.json)与[g 增量审查](independent-backend/g-focus-delta/review.json)：原存储与 HTTP、schema7兼容、输入保全及当前消费者覆盖；保留通用hook限制。[交付记录措辞复核](independent-backend/g-focus-delta/doc-review.json)。
4. [最终完整检查](checks/candidate-g-check-status.json)（3,490通过、0失败、196条件跳过、构建/高危审计通过），[作者检查与原失败解释](checks/README.md)、[独立失败历史](independent-ui/review-history.md)：测试统计、超时重跑、locator错误与实际产品错误分别记录，不拼接为一次完整 PASS。
5. [完整补修记录与兼容/回退](../../ui-conformance-repair.md)：规范固化、实际修正、当前门禁及数据格式限制。

## 候选与复现

- [g 实际构建输入](source-manifest-g.json)包含639个产品/构建输入文件；运行 HEAD 是规范提交5dd5990且dirty，实际修正以逐文件摘要为准。
- [g 完整检查起始候选](candidate-g-complete-manifest.json)涵盖2601文件，其文件 SHA256 为 `d38d54e580de9d59e64021599b3ab4ebb2cc65701bb829737b267d764883f386`。后续整理文档和公开证据不改产品/测试；提交后的身份映射另记录，不把旧完整manifest说成包含后加证据。
- [独立 UI 发布清单](independent-ui/evidence-publish-list.json)、[独立后端发布清单](independent-backend/evidence-publish-list.json)是审查者按原件 SHA256 核定的公开子集；未带数据库、配置、真实凭据、业务目录、依赖或bundle。
- [隔离环境复现说明](reproduction/README.md)：同源码与原CSS构建、实际Host、合成业务与本地合成Provider的边界；未使用真实外部模型或用户设备。
- [冻结原件字节检查](frozen-baseline-check.json)：Demo/spec与冻结版本一致；tasks中已有旧main交付记录保留，本轮没有修改原任务要求。

## 原证据保留与当前结论

[历史 f 图库](product/README.md)不是当前确认候选，原 f 反复 SPA 进入反馈弹窗的 BODY 焦点失败已由 g 原路径重验关闭。独立报告引用的 e/f未变页面、真实保存或三分支证据均有代码适用映射，不冒称在 g 重新写入或拍摄。root g图库的每张原图则绑定 g 实际进程及源码。

截图归档、作者测试和独立复核均不等于用户确认。PR创建（含draft）前，PM须实际展示本候选真实截图并取得用户明确确认。Git任务分支提交/推送允许先行；PR/CI/main合并/设备采用分别记录。

原始证据的换行和空白按字节保留：本目录 `.gitattributes` 禁止文本换行转换，仅原始日志、diff及HTTP头原件豁免 Git 空白错误检查。生产代码、测试和说明文档仍做通常格式检查；这不是调整原失败或修改证据。
