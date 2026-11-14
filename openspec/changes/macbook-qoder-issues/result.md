# MacBook Qoder 试用反馈提交流程

2026-11-14。用户授权：将 MacBook 端 Qoder 整理反馈、向 `gadfly-hbo/OptraCall` 提交 Issue 的流程写入工程规范，并同步更新 MacBook，供 Qoder 后续执行。

## 目标与阶段清单

目标：在工程规范固定 MacBook Qoder 的反馈职责与提交步骤，同步规范到产品源码／试用副本，提供可转交 Qoder 的持久规则实施 prompt；Mac mini 继续承接修复。

用户后续明确：Qoder 会话绑定 `/Users/huangbo/Dev/OptraCall-Test-And-Repair` 反馈工作区，Git 初始化尚未执行、另行安排；本地提交规则由 Qoder 按交接 prompt 后续建立。原 `待修复`／`已修复` 子目录已由用户删除，停止该目录流程，后续不重建。历史工程回执保留当时事实，不回写旧归档结论。

- [x] 固定基线及设备预检：从最新 `origin/main`（`742ff66748622b38b8c3fdc51b2c808324cb90de`）建立 `codex/macbook-qoder-issues`。MacBook `/Users/huangbo/Dev/OptraCall` 为干净 main `a21cab0`，代码 push 仍禁用；4173 正式服务使用同一版本，4186 未监听。私有 GitHub CLI 2.98.0 可访问指定仓库，Qoder CN 0.5.11 已安装。
- [x] 更新规范与入口：工程规范维护完整流程，`AGENTS.md`、README 和 MacBook 说明明确两个目录与读取路径；不复制完整规则，不宣称跨项目自动加载。
- [x] 相称验证及非作者复核：检查内容、引用、提交目标、权限与失败处理通过，发现已修正并复核。
- [ ] Git／CI 交付：合并前检查最新 main，实际 PR head 与合并 main push CI 通过，交付证据关联固定提交。
- [ ] MacBook 同步及读回：保持本地工作和业务资料，按现有更新入口核验空闲、更新与构建身份，读回规范及入口；确认代码 push 禁用和工作树干净。
- [ ] 提供 Qoder 交接 prompt：明确本次只建立反馈项目规则，后续按用户指令提交 Issue；Git 初始化、创建测试 Issue及产品修复不由此次规则创建自动启动。

## 范围与依据

本轮为规范和 Agent 入口更新，无产品 UI、SDK、依赖或 CI 改动；不需要 UI Demo 或独立产品规格，沿用本记录管理目标与验收。复用 Qoder 的原生规则能力及现有 GitHub 工具，不安装新的 SDK／CLI，不提交测试 Issue，不读取 Pi Agent 凭据或迁移历史报告。本轮不在反馈工作区创建规则或初始化 Git；反馈项目规则由用户转交 prompt 后让 Qoder 建立，Git 初始化仍由用户另行安排，不属于该 prompt。

Qoder [官方 Rules](https://docs.qoder.com/user-guide/rules)说明 IDE 自动识别当前项目 `AGENTS.md`；产品源码根入口不能据此自动跨目录作用于反馈工作区。交接要求 Qoder 在反馈项目建立薄入口，明确读取源码副本中的工程规范绝对路径，避免规则副本漂移。规则是 Agent 上下文，本次只核实规范交付文件及工具可用性，不发起 Qoder 模型任务；反馈规则创建、实际读取及未来执行由 Qoder 后续分别核验。

MacBook 的启动器比较整个源码提交／tree 与构建身份，单独快进文档会使冷启动身份不匹配。因此此次已授权的 MacBook 更新复用既有停止／更新／启动入口，保留业务资料并核实空闲；Mac mini 运行服务及其他训练／用户任务不在切换范围。仍有活动任务或不安全现场时先保留并记录，不覆盖或强制停止。

## 验证与交付记录

作者静态检查通过：9 处新增本地引用／锚点有效；反馈工作区和规范绝对路径、固定仓库参数、附件／部分错误处理、结果读回、后续规则创建及已删目录约定一致。产品代码、测试、脚本、依赖、锁文件及 GitHub 配置相对基线未修改。本地未运行无关产品测试；既有 PR／main CI 照常执行。

非作者全新上下文独立复核通过规范／需求及四原则范围：5 文件候选闭合，139 个本地引用／锚点有效，固定仓库、两个工作区、后续规则实施和已删目录边界清楚，无开放发现。初始结果记录中对 Git 初始化的指代歧义已修正并复核；回执位于 `.local/macbook-qoder-issues/review/static-review.json`。此结论不包含尚未执行的 CI、设备更新或 Qoder 实际加载。

其余门禁待完成。此记录在提交前固定；实际 PR／main CI、设备同步及最后阶段完成状态在本变更关联 PR 的交付记录维护，未核实状态不提前标记完成。临时证据保留于本工作区 `.local/macbook-qoder-issues/`，不进入公开仓库。
