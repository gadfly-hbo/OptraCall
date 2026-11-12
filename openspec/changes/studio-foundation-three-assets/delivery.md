# 三类资产工具与流程：Git／CI／main及双机采用

2026-11-12 · 用户在本地实施核验完成后明确授权：“完成 Git／CI／main 交付，并切换服务及更新 MacBook。目标企业基础层建设仍不启动，等我提供资料后再推进。”准确原指令见[本次授权](delivery-authorization.json)。本接续仅启动I08，不启动M01–M05或真实模型业务实验。

## 输入与公开范围

产品/测试固定为[实施清单](implementation-manifest.json)的15文件；本轮逐项SHA一致。本地完整check为2155 PASS／67 SKIP／0 FAIL，会话边界和构建通过；实际Host＋官方Pi合成Provider及最终29项foundation测试通过。两名新上下文非作者已关闭6项P2，交付范围又经第三位非作者独立核对。旧13文件基线、批准21文件原身份保留；批准原件仅执行清单随后更新，其余方案、spec、四模板及Demo不改。

fetch后的main为`e0d41043594fb96e4d6e0d0d665467fd40ba137a`，与原实施HEAD`87eef1db50667e3e69c827f6f897bf7d57ccb03a`树完全相同；main是原Studio产品PR的squash身份。本次正常合入main历史后核产品文件SHA，不能把旧head的本地check称为新提交的远端CI。

只纳入三类资产实现/测试、已批准方案/模板/Demo及本变更记录。公开截图使用明确合成资料，[实施图](screenshots/implemented-overview.jpg)随Git保存；原命令输出、凭据、运行数据和保全副本继续留本机授权根。没有修改SDK、依赖或锁文件，没有发布或建设目标企业资产。

## 逐项执行

| ID | 目标 | 完成条件 |
| --- | --- | --- |
| D01 | 固定与提交 | 明确暂存清单、公开内容核对、差异检查；产品15文件与固定候选一致，正常commit/push，无历史改写 |
| D02 | PR与CI | 单一产品PR目标main；核实际head、checkout SHA、job/step结论、测试/构建/审计；原FAIL、SKIP保留 |
| D03 | main交付 | 合并前重fetch核base/head及CI；squash树匹配被测树，main push CI成功；安全快进本地main，保留README WIP与其它worktree |
| D04 | Mac mini切换 | 全owner停机前准入及本机数据保全；新建准确main的干净release，原入口正常停止/启动；回读health、build、PID/cwd与三个桌面入口 |
| D05 | MacBook更新 | 原独立clean main clone、官方origin及push禁用；全owner准入、同机保全后，经原stop/update入口核main成功CI、只快进安装构建并启动 |
| D06 | 最终读回 | 两机源码/构建/实际runtime与成功main身份对应；项目/会话/配置/文件/语义环境与图绑定保全，差异单列；CI、采用与业务验收分别记录 |

本文件写入提交时D01–D06按事实执行，不预填尚未发生的结果。最新执行表、命令与最终收据在本机持久位置[delivery/progress.md](../../../.local/studio-foundation-implementation/delivery/progress.md)及同目录`final-receipt.json`，并回填本轮产品PR说明；最终PR/CI链接和两机实际版本一并交用户。

## 服务与保全

Mac mini当前4173使用独立release `~/.local/share/optracall/releases/trial-20261112-e0d41043594f`，三个Desktop入口都指向该release。开发main的README有既有WIP，不在该目录执行trial update；此改动不纳入本次提交，先私下保全，main快进只在确认变更不碰README且正常Git操作可保留时执行。

MacBook沿SSH目标`macbook`，独立clone `/Users/huangbo/Dev/OptraCall`，初始clean main和实际运行均为`e0d4104`，push=DISABLED。使用原`/bin/bash scripts/trial-command.sh stop|update --json --no-open`入口，不重写凭据、不复制Mini业务数据，不更换第三方SDK版本。

停机前检查公共会话/各owner的实际占用；缺直接busy投影的域保留证据缺口，并用进程/连接/文件稳定等只读证据交叉核定，不调用会reconcile写入的GET伪装只读检查。busy或保全冲突时保留原服务和资料，不强杀/覆盖/重放任务。正常停止后进行同机绝对路径清单备份，核副本/原件；启动后分离预期控制文件变化与项目、会话、资料及图绑定变化。

## 停止范围

本次交付采用不等于用户产品验收或真实模型专业质量通过。目标企业资料、主数据模型、指标体系、本体及M01–M05都未启动，等待用户提供获准资料。旧FAIL/UNKNOWN、原v0.1与原报告依据保留；未来企业主题落地不从本次服务升级自动开始。
