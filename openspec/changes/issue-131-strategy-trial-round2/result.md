# Issue #131 实施与验证记录

本记录按实际执行追加。PASS 只覆盖明确候选和命令；原始失败、环境失败、跳过、NOT_RUN、UNKNOWN 与待定位现象分开保留。

## 1. 领取与环境

- Issue：`#131`（`[开发任务] 战略选择第二轮试用修正｜上传失联诊断与恢复、候选校验及拟改、承接预警`），2026-11-24 领取前回读为 Open、0 评论。
- 领取评论：`issuecomment-7133309069`（`IC_kwDOVaDnXM8AAAABqS2ojQ`），`Antigravity/d3aa91c3`。
- 领取基线：`f9994cb7b5ad4f9ab52141f278085d9e21f05d45`（tree `74f5977d9518c1ccce93a44c8702a0da42ac3725`），与远端 `origin/main` 一致。
- 任务分支：`work/antigravity/issue-131-strategy-trial-round2`。
- 实际环境：Linux Ubuntu 24.04，Node `v25.9.0`，npm `11.12.1`，`@earendil-works/pi-coding-agent` `1.4.0`，`/usr/bin/google-chrome` + Python Playwright。
- 真实 Provider、真实业务数据、真实 MacBook 现场取证、凭据读取、设备更新／服务切换：NOT_RUN，非本单授权范围。
- 待定位／未复现事实保留：
  - Mac 原现场「上传小 TXT 后 host-entry 进程消失」根因未在云端隔离环境复现，按待定位继续跟踪。
  - 原报告所称「空归属标识创建静默失败」在基线正常浏览器未复现（实际拦截并显示红字错误，零创建），本单按必填语义与定位提示改善纳入。

## 2. 分项实施记录（每项先 RED 后 GREEN）

RED／GREEN 原始日志保存在被忽略的本地目录 `.local/issue-131/`（`item-{a,b,c,d}-{red,green}.log`、`item-*-ui-*.log`），不入库。

| 项 | 新增／扩展测试 | GREEN 结果 |
| --- | --- | --- |
| A 上传诊断与恢复 | `tests/strategy-upload-diagnostics-and-recovery.test.ts`（上传／并发／故障矩阵、SIGTERM 优雅退出、外部 SIGKILL、启动失败与 `uncaughtExceptionMonitor` 致命退出诊断）；`strategy-initiative-ui.test.ts` I131-A | 3/3；UI 见下 |
| B 候选校验定位 | `strategy-candidate-host.test.ts` I131-B（真实 Host+Pi 校验与自修）；`strategy-save-cancel-queue.test.ts` I131-B（`candidateGoals` 校验、密钥字段脱敏、旧 `lastSave` 兼容、锁定后零写入） | 通过 |
| C 限定修改与澄清 | `tests/strategy-revision-feedback-host.test.ts`（真实 Host+Pi 全矩阵）；`strategy-save-cancel-queue.test.ts` I131-C（提交前取消）；UI I131-C | 1/1 |
| D 目标承接与补目标 | `tests/strategy-goal-supplementation-host.test.ts`（真实 Host+Pi：未锁定补目标、锁后父版新建候选、新会话／新指纹／重锁） | 1/1 |
| E 必填提示 | `strategy-initiative-ui.test.ts` I131-E（`aria-required`、`role="alert"`、`aria-invalid`、自动聚焦、半填范围行不静默丢弃） | `strategy-initiative-ui.test.ts` 13/13 |

事实保留：Mac 现场宿主消失根因仍为**待定位**（云端隔离环境未复现，A 项只新增退出／启动／致命错误诊断与上传矩阵，不宣称已修复根因）；「空归属标识静默失败」在基线**未复现**，浏览器 E2E 再次确认为「拦截并红字提示、零创建」，E 项仅为提示改善。

## 3. 联合验证（作者自检，云端 2 vCPU VM）

| 命令／范围 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run check:agent-sessions` | PASS |
| `npm run build` | PASS |
| `npm audit --audit-level=high` | PASS（exit 0；0 high／critical；2 个 moderate 来自锁定的 `@earendil-works/pi-coding-agent@1.4.0` → `minimatch`，按规范未执行 `npm audit fix`，依赖未改） |
| 批次 1：17 个战略 initiative／candidate／revision／kickoff／publication／verification／history／skills／UI／upload／cancel 测试文件，`node --test --test-concurrency=1` | 48/48 PASS |
| 批次 2：`strategy-rework-*`、`host`、`host-recovery`、`agent-session*`、`trial-launcher`、`trial-update` 测试，`--test-concurrency=1` | 162/162 PASS |
| 批次 3：issue-108／115、strategy-attachment／discussion／goal／map／permission／workbench／workbook／teach-source、`v12-strategy-ui`，`--test-concurrency=1` | 152/152 PASS |
| 无头 Chromium E2E `python3 tests/browser-issue-131-strategy-trial-round2.py`（隔离 Host、官方 Pi 1.4.0、合成 Provider） | PASS：A–E、版本台账、1440×900 与 390×844（无横向溢出）、Escape 键；外部请求 0、页面错误 0、非预期 console 错误 0 |
| 无过滤完整 `npm run check`（467 个测试文件） | **环境超时，未完成**：在本 VM 单条命令 600s 上限处被终止，截止前已执行的测试 0 失败。按批次分段执行替代，上表为实际分段范围；分段 PASS **不等同**于完整 `npm run check` 通过，完整套件由 PM／CI 在 PR 上运行 |
| 并发 4 的批量运行 | 在 2 vCPU 上因 `startTestHost()` 10s 启动超时（CPU 争用）产生 5 例环境性失败，已终止并改 `--test-concurrency=1` 重跑；该次结果不计入通过 |

批次 1–3 与并发 1 的覆盖未必包含全部 467 个文件；未覆盖文件为 NOT_RUN（逐个文件对账交由 CI）。

## 4. 四原则与 IN01–IN07 自检（作者自检）

- Host 管环境：仅做诊断日志、上传身份／范围核对、字段与权限门禁、proposal 归属、安全错误投影；不替 Agent 做战略判断、不自动重发、不自动拉起进程。
- Agent 自主执行：候选保存按 `path/reason` 自修；拟改自主澄清；补目标由 Agent 读回正文形成。
- 优先复用 Pi：Pi 固定 `1.4.0`、`package.json`／`package-lock.json` 无改动，复用 `safe-tool-error-v1` 与既有候选会话生命周期，无平行推理循环。
- 减少人的操作：待核上传一键核对并沿原编号重试；拟改前直见基线；目标影响前置提示与一键回会话／父版新建；必填项自动聚焦。
- IN01–IN07：Interface 沿用 v3，新增字段均为可选且向后兼容，`check:agent-sessions` PASS；详见 spec 第 5 节。

## 5. 兼容与回退

见 spec 第 7 节：`RevisionProposal.feedback` 可选，旧 `reports.json`／`candidates.json` 原位可读；`sessionStorage` 仅存带版本前缀的元数据；日志追加输出，`host-ready`／`instance.json` 格式不变。回退切回基线 `f9994cb7b5ad4f9ab52141f278085d9e21f05d45` 即可。

## 6. NOT_RUN／未声明

- 非作者独立复核、远端 PR 与 CI、`npm run check` 无过滤完整通过：NOT_RUN／未完成。
- 真实 LLM Provider、真实业务数据、MacBook 现场取证、设备更新／服务切换、用户产品验收：NOT_RUN。
- 作者自检不等于独立复核、CI 或用户验收；Issue #131 保持 Open，由 Codex PM 接回。
