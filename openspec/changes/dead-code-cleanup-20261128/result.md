# 2026-11-28 墓碑代码清理（第 1–9 项）

## 目标、授权与基线

用户在本会话确认「先清理 1–9 项」。基线为 `74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`，fetch 后 `origin/main` 仍为该提交；在独立分支 `codex/tombstone-cleanup-20261128` 实施。

本轮只删除已确认的无消费者代码。第 10 项 CSS、待判断的 Case 摘要状态、目标工作区回调、`maxText`、Host 校验调用及其他仅测试使用的契约均保留。依赖、Pi SDK、Host／Agent 职责、HTTP 接口、持久数据和历史材料不变；没有新增分析流程、Runtime 或用户操作。本轮不切换服务，不操作 MacBook，不调用真实模型。

## 冻结范围与执行清单

- [x] 01 删除无调用的 `readInitiative` 请求封装，保留 Host 接口。
- [x] 02 删除无调用的 `reportBadge` 展示辅助函数。
- [x] 03 删除无调用的 `assessProgressEvidence` 薄包装，保留详细证据核对实现。
- [x] 04 删除无消费者的 `actionReadNotice` 文案表。
- [x] 05 删除审计确认的 14 个未使用 import binding，保留现用定义与模块副作用。
- [x] 06 删除未读取的 `goalViews` 与 `StrategyGoalsPage` 局部 `view`。
- [x] 07 删除旧问题树模型，将仍有意义的无边、多前驱、环、失效边和缺失端点断言转向现用图模型。
- [x] 08 删除旧独立核算客户端的 preview/action/file-choice 封装，保留历史读取、下载及仍适用的校验和 Host 回归。
- [x] 09 删除旧自动核算客户端的保存、停止、UI 回应及 retryable 封装和因其删除而独占失去用途的内部辅助；保留只读历史、固定稿、归属和资源状态展示。
- [x] 清理前后定向 GREEN、类型和构建检查，核对生产前端变化及无 UI 影响依据。
- [x] 固定完整候选，完成逐项非作者独立复核和四原则检查，记录发现、失败和未验证项。
- [ ] 全量检查通过：已执行，保留 1 项在未修改基线同样复现的 CNR-A4 失败，不记工程全绿。

上述范围不改变生产界面布局、导航或交互；无新 Demo。生产构建 JS 并非逐字相同。独立复核结合实际消费者、模块副作用、完整构建语法结构、CSS／图标、HTML 和 18 组组件渲染对照，核定本轮确无用户可见 UI 影响，Demo 与产品截图门禁有依据不适用；未启动浏览器视觉验收，不把 CSS／SSR 一致单独当作视觉验收。结论仅限本轮变化，不追溯宣称此前冻结 Demo 已完整验收。

## 验证记录

原始日志和构建对照位于本任务工作树 `.local/tombstone-cleanup-20261128/`。清理前定向 7 文件 75/75 PASS，0 fail、0 skip；增强 unused 检查的既有诊断保留在 `baseline-unused.log`，不记作全通过。

清理后相同范围（问题树测试迁到现用模型）63/63 PASS，0 fail、0 skip；减少的 12 项为已删除客户端包装的专属自测。Host 基线 4 文件 30/30 PASS。普通类型检查通过，增强 unused 的产品诊断由 27 条降至 11 条，剩余为用户本轮保留的待判断项；该增强检查仍 exit 1，不记为全通过。

生产 CSS 和图标逐字一致；JS 由 3,548,897 降至 3,548,839 bytes（减少 58 bytes），HTML 仅 JS 文件 hash 引用变化。可读构建／metafile 对照无增减模块，差异为原未用局部变量消失、声明合并及原依赖模块遍历／输出顺序变化。18 组目标／战略页面与导航的服务端组件渲染逐字一致；此检查不替代浏览器视觉验收。

首轮定向／类型检查因测试块删除时连带移除了 `fixedReport` 夹具失败，已原样恢复夹具，原日志保留。首轮完整检查因临时复用依赖的符号链接不符合 SDK 路径检查而失败；已将基线既有依赖原样复制到本工作树（未安装、升级或修改包），原边界检查随后通过。最初“前端所有产物逐字相同”的断言失败，JS 差异保留在 `frontend-equivalence.json` 与 `readable-diff.txt`，不追改为逐字等价。

完整 `npm run check` exit 1：3,674 项，3,562 PASS、1 FAIL、111 条件跳过、0 取消。唯一失败为 `tests/conclusion-review-handoff.test.ts:139` 的 CNR-A4（历史 `enabled=true` 重启兼容），合成 Provider 请求次数实际 5、预期 4。未修改的主仓固定基线与本候选分别定向运行同一测试，均在同一断言 exit 1（`baseline-cnr-a4.log`／`candidate-cnr-a4.log`）。原全量失败收据的第 5 条请求为 SDK 上下文摘要，签名记录在 `cnr-a4-diagnosis.json`。本轮未修复或放宽该既有断言，不将其消隐，也不把清理范围复核通过写成全量通过。

会话边界检查通过。全量测试失败使 `check` 未进入其末尾 build，已单独运行 `npm run build`：类型检查、生产构建及构建身份生成全部 exit 0，日志 `build.log`。

## 测试去留与独立复核

- 旧问题树 3 项测试迁为 `tests/compact-case-issue-graph.test.ts` 的 3 项现用生产图模型回归，保留无隐推关系、多前驱汇合／唯一节点、环、失效边和缺失端点断言。
- 独立核算移除 4 项、自动核算移除 8 项退场客户端封装专属 mock 自测。仍适用的源数据／作者隔离、已知拒绝文案和真实 Host 只读预览断言保留或改走保留入口；归属、固定稿身份／字节／范围、下载、历史与 UNKNOWN 显示检查保留。
- Host 版本冲突、原件保全、停止／取消／实际清理及 UNKNOWN 历史保全回归不改，完整检查覆盖原路径；不为减少断言而改写现用业务合同。
- 非作者独立复核的 01–09 验收矩阵、测试去留、无 UI 影响适用性与四原则专项通过，必须修复项 0。独立定向 57/57 PASS，0 fail／skip，类型检查与生产构建复现通过；独立解析可读 bundle，去除等价声明合并／导入别名和模块输出排序后，只有本轮删除的未用局部 `view` 声明存在差异。报告与独立日志：`.local/tombstone-cleanup-20261128/independent/REVIEW.md`。

产品源码净删除 155 行；全部 CSS、依赖／锁文件、Agent 与 Host 接口实现保持基线字节。原候选清单及后续仅结果记录更新分别留证；没有真实模型质量、真实业务资料、运行服务或设备采用结论。

首轮收尾时，改动保留在上述独立工作分支，尚未提交／推送、创建 PR、运行远端 CI 或合并；主工作区仍干净且在原基线。当时清理实施和限范围复核完成，全量检查保留失败，不能宣称完整工程验收通过。后续执行按下节授权与实际记录核对。

## 后续授权：基线失败修复及 Git／CI／main 合并

2026-11-28 用户明确要求「把这项基线已有失败也排查修复，检查通过后完成 Git/CI 并合并 main」。上文原始 FAIL 及先前阶段状态保留；以下记录后续修复和交付，不追改历史检查结论。运行服务和设备采用不在本次授权中。

- [x] T01 用同一 CNR-A4 真实 Host／SDK 复现并定位基线失败，固定隔离夹具的 SDK 配置，保留逐请求及历史保全断言。
- [x] T02 对完整候选运行受影响检查、全量检查及高危依赖审计，保留原 FAIL／条件跳过；本机完整检查采用下述显式并发 4，远端原 CI 待执行。
- [x] T03 对完整候选补非作者逐项及四原则复核，重新核定 UI 门禁适用性；新增 Store 修复需用户截图确认。
- [ ] T04 整合最新 main，提交／推送、PR 实际 head CI、获授权 squash 合并、main push CI 和安全快进主工作区，逐项回执。

Interface v3、原 project/task owner/profile 和生产 Pi 1.4.0 接入不变。诊断依据为原请求收据、SDK 随包官方 compaction 文档及真实 SDK snapshot；仅使用 SDK 已有公开设置，不修改或升级 SDK，不新增 Runtime／计数分类平台，也不改变产品自动压缩默认。

### CNR-A4 诊断与修正

`node --test --test-name-pattern='CNR-A4: saved legacy enabled=true' tests/conclusion-review-handoff.test.ts` 再次在原断言复现 RED：请求数 5 而预期 4（`cnr-repair-red.log`）。三个候选原因分别为 SDK 自动摘要被计作业务重放、旧链重新准入、旧请求迟到；原收据中唯一额外请求的专用摘要 system 和 conversation 封套、无旧链记录及实际请求顺序支持第一项。固定版本随包官方 `docs/compaction.md` 说明自动压缩默认开启且使用模型生成摘要。

修正仅在 `tests/conclusion-review-handoff.test.ts` 的隔离 Host 夹具既有 `pi/settings.json` 中增加官方公开 `compaction.enabled=false`，与原 `retry.enabled=false` 一起固定严格计数的独立前提。所有原业务／HTTP／SDK调用、原精确请求计数、历史字节保全、重启后不开旧链、前台工具和 `/tools` 不调模型断言保持不变；未过滤请求、放宽计数或关闭生产自动压缩。现有其他原生 SDK／自动核算压缩回归保持原设置和断言。

修正后 `CNR-A4: saved legacy enabled=` 两项真实重启场景 2/2 GREEN，0 fail／skip（`cnr-repair-green.log`）。临时追加的已关闭 snapshot 能力探针因该状态不提供 compaction 字段而失败（`cnr-repair-fixture-red.log`），不算产品 RED，已移除该不适用探针；正式回归仍以原业务计数断言为准。

高危级别依赖审计 exit 0（`audit.log`）；既有 minimatch／Pi 相关 2 项 moderate 提示保留，不执行会将 Pi 目标改成 1.7.0 的强制修复。后续完整检查、非作者复核及 Git／CI 结果按实际完成回填。

### 全量检查发现的直接阻塞：服务连接 Store 锁释放窗口

修复 CNR 后的 `full-check-r3.log` exit 1：3,674 项中 3,562 PASS、1 FAIL、111 skip，CNR-A4 两种开关均通过；唯一新发现失败为 `service-connection-store.test.ts` 的跨实例 CAS 检查。该文件和 Store 在本轮首次发现时均与基线相同。定向运行也复现了正常并发写中的 `unsafe_service_storage`，原日志 `service-cas-target.log` 保留；一次未修改基线定向运行通过（`baseline-service-cas.log`），不把偶发竞态说成每次必现。

按工程规范第3节的直接检查阻塞规则，将最小修复纳入本轮，允许增加 `src/host/service-connection-store.ts` 和其原测试文件。固定交错顺序的永久回归使用两个真实 Store 和真实文件系统：原 owner 在公开凭据操作持锁，contender 的真实 O_EXCL 返回 EEXIST 后，等待 owner 正常释放，再进行原路径检查。原代码稳定复现 RED：已消失锁路径被误报不安全（`service-cas-controlled-red.log`）。

修正仅在 `#locked` 的 EEXIST 分支复用既有 `#regular(lockPath, true)`，允许 owner 已正常释放导致的 ENOENT，然后沿原截止时间／退避／O_EXCL 路径竞争。符号链接、硬链接、非普通文件及其他错误继续拒绝；没有删除其他 owner 锁，也没有放宽凭据文件／目录校验、CAS、资源权限或持久结构。原链接保护测试追加锁硬链接不可移除的断言，原跨实例 CAS 及其他断言保留。测试只用合成凭据，Node 文件打开钩子仅控制真实操作的交错并在 finally 恢复，不改 SDK。

- [x] T05 固定交错 RED→GREEN、服务 Store 完整回归与安全反例，纳入最终全量及非作者复核。

修正后原服务 Store 整文件 28/28 PASS、0 fail／skip（`service-store-green.log`），包含新增确定性锁释放回归和锁硬链接保护；普通类型检查与差异检查通过。最终全量及本修复的独立复核按下一候选执行。

### 新增修复的 UI 门禁

原 01–09 与 CNR 夹具修正的无 UI 影响结论仅覆盖其原范围。Store 修正会使保存／断开在正常锁释放竞态中由错误转为成功，实际前端分别显示错误和保存提示；追加独立复核核定它具有用户可见反馈影响，不能仅凭前端字节不变延续整批豁免。新变更不新增布局或交互，无新 Demo；按工程规范第4节补实际运行产品截图、独立核对及用户明确确认，确认前不得创建 PR。

- [ ] T06 在隔离合成 Host 的真实产品入口检查连接保存成功／失败／只读查询及适用窄屏，展示实际候选原图，取得用户对该候选的明确截图确认，再执行 PR／CI／合并。

### 验证资源约束记录

Store 修正后的本机默认并发尝试 `full-check-r4.log` 出现未修改的长参数嵌套交付测试失败：其原 6 秒观测窗口内只记录 IR 准入，尚未发出 IR Provider 请求。相同源码的定向命令已通过（`nested-long-target.log`），前两轮完整运行中该项亦通过。原测试、6 秒断言和 SDK 均未修改，不将此失败归作本轮已修复的产品缺陷。

该轮随后有测试 worker 在 Host 子进程已退出后仍保留合成 Provider listener，阻止有序结果收尾。保留进程／监听器观察及已知失败后，仅向本轮自身 runner 发送 SIGINT 并核其测试 worker 消失（`full-check-r4-interrupt.json`）；该轮为中止且未完成的验证，不记完整套件已通过或已全部执行。没有终止原运行服务或隔离 UI Host。

后续本机完整检查保持原边界检查、全部 `tests/*.test.ts` 和生产 build 三阶段，仅将 Node 文件并发固定为 4，避免本机多 worker／SDK 子进程竞争；没有用例过滤、条件跳过变更或放宽时间断言。命令为 `npm run check:agent-sessions && node --test --test-concurrency=4 tests/*.test.ts && npm run build`，输入清单在 `limited-test-inputs.json`，结果在 `full-check-limited.log`。该资源控制的实际结论与原默认并发失败／中止分别记录；远端 CI 仍使用仓库原 `npm run check`。


### 完整检查发现的第二个 Store 竞态：读取已被原子替换的旧快照

第一次受限并发完整检查 `full-check-limited.log` 已有完整退出结果：3,675 项，3,563 PASS、1 FAIL、111 skip，0 cancelled；未进入末尾 build。原长参数嵌套交付检查和 CNR 两种开关均通过，唯一失败为未修改的 Manager 授权隔离检查读取状态时报 `service_store_corrupt`。随后原 Manager 整文件在另一个授权／401 场景同样从 `#load` 复现该错误（`service-manager-file.log`），单项曾通过的记录亦保留，不能把间歇失败说成始终失败。

按第3节的直接验证阻塞规则纳入同一 Store 最小修复；没有改 Manager 或放宽原用例。排查依次核对：已打开文件的正常 unlink、授权快照混代、实际 JSON 损坏。两个真实 Store 固定交错：reader 真实 open 后、fstat 前，让 writer 经公开保存完成真实原子 rename。独立探针及永久回归均稳定 RED（`read-replace-probe-red.log`、`read-replace-controlled-red.log`）：旧 inode 的 nlink 由 1 变为 0，被原 `nlink !== 1` 错当损坏，而当前完整 JSON 已正确持久化。

修正仅在已通过 O_NOFOLLOW 打开的普通文件描述符检查中允许 nlink=0，仍拒绝 nlink>1、非普通文件、超限、无效 UTF-8／JSON／schema。命名路径的 `#regular` 和 lock 的单链接限制不变。这样一次已开始读取可返回完整旧快照，随后读取返回完整新快照；没有合并两个版本、重试掩盖坏文件或放宽命名凭据文件的链接保护。永久回归同时核旧快照一致、真实 nlink=0、新 Gmail 配置和原 GitHub 凭据保全；文件打开 hook 只排定真实操作顺序并在 finally 恢复。

- [x] T07 已打开快照的原子替换 RED→GREEN、完整 Store／Manager／安全反例、最终全量与非作者复核，并刷新受影响的实际 UI 证据；用户截图确认仍按 T06 单列待执行。

修正后 Store／Manager 两文件 58/58 PASS，0 fail／skip（`read-replace-green.log`）；原全量及 Manager 失败记录保留。原 UI 截图绑定前一 Store 候选，只作为历史证据；本修复会影响状态读取，须对新运行候选补受影响 UI 独立复核和用户明确确认，不能直接沿用前一候选确认。


## 最终候选检查与 PR 前状态

固定代码清单为 `read-replace-candidate-manifest.json` 的 24 路径（含删除状态），其中 23 项代码／测试摘要在最终检查和追加独立复核期间不变；本节只更新结果记录。最新 fetch 后 `origin/main` 仍为原基线，无需整合额外提交。

本机最终完整命令 `npm run check:agent-sessions && node --test --test-concurrency=4 tests/*.test.ts && npm run build` exit 0（`full-check-final.log`）：**3,676 项，3,565 PASS、0 FAIL、111 条件跳过、0 cancelled**，耗时约 604 秒；边界检查、普通类型检查、生产构建和构建身份生成均通过。523 个测试文件全部执行，无筛选；111 条条件跳过保留原日志，不记已运行。原默认并发失败／中止及第一次受限全量失败仍按前文单列；此结果不是默认并发压力组合或远端 CI 通过声明。依赖和锁文件不变，前述高危审计通过及 2 项既有 moderate 提示继续适用。

完整非作者复核由同一未参与候选创作的复核者分冻结增量完成：原 01–09 的 `REVIEW.md`，CNR 的 `REPAIR-REVIEW.md`，锁释放的 `STORE-REVIEW.md`／`STORE-UI-REVIEW.md`，以及最终读取竞态的 `READ-REPLACE-REVIEW.md`。追加独立 Store／Manager 58/58、损坏 JSON／UTF-8 的真实 detached inode 反例 2/2、类型及差异检查通过，必须修改项 0；Host 环境治理、Agent 自主、原 SDK 复用和最少人工作业四原则专项通过。以上仅核本变化及受影响接缝，不宣称所有既有实现合规。

最终 UI 实跑使用本工作树标准 Host、独立合成根和真实生产页面／接口，新进程 PID 13838、runtime instance `14bc2d66-c32b-4682-8964-f1981a8bc4cb`，启动晚于最终 Store 源修改。前端截图使用此前已复现的生产构建；其源码及 JS／CSS 字节未再变化，构建时间与 dirty 身份如实记录，后续最终 build 单独通过，不把旧 build 时间改写为新 build。未提交身份由完整文件清单及摘要绑定，不只报 HEAD。

受影响入口为设置→连接配置→GitHub PAT；实际保存 200、安全锁拒绝 503、只读 GET 查询、移除本人测试锁后的正常恢复，以及 1440×1000／390×844 视口、弹窗滚动和关闭均通过。安全拒绝期间存储／marker 字节不变，查询未重放 PUT，本人测试锁核身份后移除。5 张新原图在 `output/playwright/tombstone-20261128/final-independent-*.png`，原图摘要及运行身份见 `.local/tombstone-cleanup-20261128/ui-proof/final-screenshot-receipt.json`；独立复核者已查看全部原图，作者已查看成功、错误和手机滚动原图。确定性微小时序由真实 Store 回归证明，截图只证明实际呈现和交互。

**T06 用户对最终候选的截图明确确认仍待执行，尚未创建 PR。** 已有 Git／合并授权允许先提交和推送任务分支；截图确认后才创建 PR，随后核实际 head 的原始 CI、按授权 squash 合并并核 main push CI，再安全快进干净的主工作区。提交／推送／PR／CI／合并的实际 SHA 与回执继续记录在本地 `delivery.json` 和关联 PR，不在本快照中预填成功。

原第 10 项 CSS 和待判断项仍保留。本轮没有数据格式迁移，回退为获授权的代码 revert；历史证据、持久记录与已有业务文件不需要覆盖或恢复。没有真实外部账号核验、真实模型质量、服务切换或设备采用结论。
