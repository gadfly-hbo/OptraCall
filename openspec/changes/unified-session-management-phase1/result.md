# 一期实施记录

2026-10-30 · LOCAL_VERIFIED / REVIEW_PENDING，尚未Git交付。

用户已确认v0.3 US01–US12并授权本地检查、兼容验证、联合回归、独立复核与Git/CI合main。基线 `cb178d4b714b7aef559b67ebb52f4265c884a860`；开工fetch后origin/main未前移。已确认proposal保持原字节，实际实施依据见[spec.md](spec.md)。

| 验收 | 当前结果/证据 |
| --- | --- |
| SM01 统一接入/复用 | LOCAL PASS：项目/需求独立域共用实现；旧业务生命周期台账删除；第三合成profile无专属公共分支，公共Interface回归21项 |
| SM02 并发/隔离 | LOCAL PASS：多域/多任务并行、跨域Ref拒绝、opening/UI/准入取消及关闭门闩反例；任务Host回归 |
| SM03 占用/lease | LOCAL PASS：202后仍占用、两turn间隙、漏await/抛错/外泄、活跃关闭及失败关闭均不早释放；保留新旧RED/GREEN |
| SM04 配置 | LOCAL PASS：任务绑定与需求当前选模、操作内固定、完整配置身份及失效无重放 |
| SM05 Provider/代际 | LOCAL PASS：旧A/新B按具体资源过滤；旧close/editor不能影响替代资源或草稿；Host迟到editor真RED→GREEN |
| SM06 业务/跨域关闭 | LOCAL PASS：项目真实归属、需求隔离、Provider/global覆盖pending/lease/UI；关闭错误收集并保留失败资源 |
| SM07 原生交互 | LOCAL PASS：SDK命令/UI/editor/fork父链；浏览器11次命令、8次明确回应及启动UI通过；snapshot/UI乱序真RED→GREEN |
| SM08 恢复/只读 | LOCAL PASS：保存历史/被动GET/SSE不建worker、不发模型或重放；native回执、legacy与lastRun证据校正保持 |
| SM09 需求四项 | LOCAL PASS：原18项及新增3项需求回归；完整检查包含未确认/无假设/有限修正/来源冲突 |
| SM10 RAP+SAP+Case | LOCAL PASS：joint-context、requirement-flexible-joint及需求闭环，实际合成Provider输入/精确版本/stale拒绝 |
| SM11 保全/回退 | LOCAL PASS：schema1原4项、需求重建、永久兼容及真实旧Host回退演练；25个非DB文件、SQLite schema/7表逻辑数据、native父链/草稿/发布物保持 |
| SM12 工程/独立复核/CI | 本地354/354、类型/构建/边界检查及审计0漏洞；首轮独立复核发现P1/P2已修复，待固定新候选重验及PR/main CI，不继承旧PASS |
| SM13 UI范围 | LOCAL PASS：无前端源码/布局变化；正常浏览器命令/UI和项目/文件/草稿/刷新不重放路径通过，外部请求及浏览器异常均0 |
| SM14 标准固化/工具读取 | IN01–IN07、入口、guide、类型、AST约束及6项正反回归到位；Codex只读接入任务实际读取4文件并正确给出v1规划；Qoder SDK预检无CLI登录未进模型；用户授权的Qoder应用任务实际Read4成功、v1回读正确；显式文件清单验证不冒称自动项目加载 |

## 实现与证据

公共实现见`src/host/agent-sessions.ts`，Host项目/需求分别注入profile，原生历史读取拆至受限制的`project-history.ts`。`ProjectAgent`只增加command的accepted/completion薄委派；SDK、native marker、Store schema和前端未改。

工程规范v1.0是IN01–IN07唯一规则源，AGENTS必读指针与接入guide同源；AST导入/构造约束进入既有`npm run check`/CI，只列明确技术/历史/连接探针/测试例外。工具文件可达与实际任务读取分别记录，不把类型当权限沙箱。

原始证据根：`.local/unified-session-management-phase1/`。

- 基线：`baseline-check-materialized.log`，原main 320/320 GREEN。首次隔离依赖symlink触发Node权限路径错误，原日志保留，随后materialized依赖树重验；不计为产品RED。
- 最终本地：`full-check-reviewed-final.log`，354/354，含约束/类型/构建；`npm-audit-reviewed-final.log`为0漏洞。先前352/352及首轮修复353/353记录保留。
- 真实行为RED/GREEN：`core/admission-*`、`core/close-drain-*`；需求`requirements/`；`project-late-editor-baseline-red.log`→`project-late-editor-green.log`；`native-event-order-red.log`→`native-event-order-green.log`。中途完整检查3项失败为SSE终态早于业务收尾/最终快照，后修为业务完成后发布一次终态，`terminal-order-green.log`及最终完整检查关闭这些失败。
- 需求受控fixture补齐实际合成JSONL/accepted，不以假ACK弱化持久语义。RR05旧finally保护改用idle旧资源被hold的场景；活跃operation关闭另按SM03阻止竞争，原因及原断言保留见`rr05-fixture-adjustment.md`。
- 兼容：`compatibility/cross-version-reviewed-final.log`及`latest-cross-version-result.json`。实际旧版`cb178d4` Host打开新资料并用已完成UUID重试；请求数3→4→4，193个基线blob身份一致。永久测试不依赖本地archive或Git历史。
- 浏览器：`browser/command-ui-order-fixed.log`，11命令/8回应/1合成请求；`browser/live-projects-final.log`，保存/读取/草稿/报告/刷新/窄屏及显式连接测试。最初确认弹窗失败为native snapshot/UI投影乱序，已新增长期反例并修复，原失败`command-ui-final.log`保留。
- 工具读取：`governance/codex-entry-readback.md`记录Codex当前只读子任务，不冒称安装CLI另进程；Qoder原始安装版入口/加载器核查、SDK登录预检失败与应用实际任务记录分别保存（`governance/qoder-app-readback.md`/`.json`）。应用任务“接入规范验证”使用原GLM-5.3，4次Read逐项允许；2模型迭代成功，未执行其他工具。四文件与已核定规范候选字节相同，未修改全局规则/账户/模型或创建Worktree。

原有项目、会话、文件和原运行服务未纳入写入式工程验证；不操作MacBook，产品试验只使用合成Provider。Qoder工程读取验证另获用户明确授权，权限仅限4个公开工程文件。失败、NOT_RUN及UNKNOWN保留；Git/CI、运行采用和产品验收分别报告。

## 独立复核发现与修复

首轮固定候选383a19d由非作者Standards/Spec并行复核，分别独立27/27与52/52；发现真实问题而非放行：

- P1 / SM06：Provider清理等待期间，新需求owner能发出请求。独立反例日志保留`review/spec/provider-clear-admission.log`；永久反例在旧候选返回200/产生请求，而新候选返回409/0请求，另一Provider仍正常。Host用同一可用配置投影对项目/需求按实际捕获Provider准入；全局清理另覆盖期间新增Provider，计数防止重叠清理过早解除。`global-clear-admission-red.log`→`all-clear-admission-green.log`，完整354/354。首个临时fixture缺少noChangeReason产生422的现场保留，已使用有效输出复现200→409，不把fixture错误当产品RED。
- P2 / IN02：TypeScript窄类型未移除实际对象的closeAll，完整需求管理对象曾被注入插件。Host现明确构造冻结的run/withSession/stop/busy业务facade，管理能力只留Host。独立实读证据`review/standards/capability-readback.log`保留，待新固定候选实际能力重验。

原始报告和失败均保留；修复后的完整候选须由同两条独立复核线重新核定，作者修复/354绿色不代替独立PASS。
