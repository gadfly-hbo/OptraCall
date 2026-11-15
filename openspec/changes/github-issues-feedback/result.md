# GitHub Issues 反馈入口落地

2026-11-14。用户已确认：新问题统一走 GitHub Issues，旧报告目录保留历史，按约定的工程交付条件关闭 Issue。

## 目标与阶段清单

目标：在默认分支提供可用的问题表单，将工程规范和入口说明切换到 Issues，并保留原开发、验证及运行采用边界。

- [x] 核对基线和范围：从最新 `origin/main`（`a21cab0e1d71da46ec3730c97b312b0dd2196ddf`）建立 `codex/github-issues-feedback`；保留长期 `Test-And-Repair` 分支及历史报告。
- [x] 更新同源工程规则：新入口、处理步骤、关闭条件和历史目录边界一致，其他入口引用规则。
- [x] 提供原生 Issue Form：最少必填字段，支持粘贴报告／附文件，无额外标签或项目看板依赖。
- [x] 完成相称验证和非作者独立复核：YAML、表单结构、引用、内容及范围检查通过，无必须修复项。
- [ ] 交付并启用：检查最新 main，PR 实际 head CI 和 main push CI，通过后核对默认分支上的模板及工作区状态。

## 设计与范围

详细规则唯一维护在[工程规范第 6 节](../../../docs/engineering-workflow.md#github-issues-问题收件与结案)。继续使用 `Test-And-Repair` 修复产品问题；本次规范／配置变更使用独立分支。复用 GitHub 原生 Issues 和表单，不建立后台自动接单服务、标签状态机或新的 Agent 运行机制。

本次不改产品代码、SDK、依赖、CI 或运行数据；不 SSH 读取／移动旧报告，不切换 Mac mini 服务或更新 MacBook。无 OptraCall 产品界面变更，UI Demo 不适用；用户已确认方案，本记录兼作本次简化规格及执行清单。验证采用纯文档和 GitHub 配置的相称检查，自动触发的既有 CI 照常核对。

## 验证与交付

作者相称验证通过：两份 YAML 可解析且无重复键；表单五个信息字段、仅问题描述必填，报告附件区使用普通 textarea；原生模板配置关闭普通空白入口，无标签／看板依赖。四处新增本地引用目标存在，新锚点及旧历史锚点保留；差异和当前入口巡查通过，历史 OpenSpec 报告记录未修改。临时检查及收据保留于本工作区 `.local/github-issues-feedback/`，不进入公开仓库。既有 `Check` 工作流保持原样；本地未额外运行产品全套测试，实际 PR／main CI 另行核对。

按 GitHub 官方的[模板配置](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)、[表单结构](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema)及[Issue 关联](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)核对：模板须进入默认分支后启用；关闭空白入口是引导配置，维护者／API 仍可绕过，不将其当作权限控制。显示用 markdown 不会进入提交正文，修复清单由执行者接单后在 Issue 评论维护。

全新上下文非作者复核通过规范／需求及四原则专项：7 文件范围闭合，YAML 与表单结构、9 处定向引用及新旧锚点通过，规范和模板无必须修复项。独立复核收据保留于 `.local/github-issues-feedback/review/independent-review.json`。复核者首轮引用检查器未处理仅锚点链接而退出 1，修正检查器后退出 0，候选未因此修改；这是检查器失败，原始情况保留。

交付门禁尚在执行。此记录在 PR 交付前固定，后续实际 head、PR／main CI、默认分支核验与最后一项清单的完成状态记录在本变更关联 PR 的交付记录中；未核实的状态不记为完成。其他工作树的未提交改动不纳入本次提交，也不覆盖或清理。
