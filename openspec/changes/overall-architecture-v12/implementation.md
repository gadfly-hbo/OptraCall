# v1.2 实施记录

## PM-V12-01 后续修复收尾 · 2026-11-17

自主发现漏项已修正；局部UI获用户确认后实施，原App/Host/Pi合成联合观察、3,000项完整检查及非作者两轴通过，PM01特定工程差额关闭，详见[准确实现与证据](pm01-repair-result.md)。原80文件/全部FAIL/UNKNOWN/NOT_PROVED及本次依赖自链接过程事故均保留，未以绿色覆盖；新候选用`.local/v12-pm01-fix/candidate-source.json`另冻。未提交/推送/远端CI/合并、正式迁移回退、双机采用或真实模型实验，不宣称v1.2用户产品验收通过。

基线 `3a529a0e381bf67b998f2b1debd242a5eed38884`；独立工作树 `optracall-v12`，分支 `codex/v12-strategy-purpose`。用户2026-11-17批准16文件准备候选 `7fe8b90898a0500b0766d4718e88d487ec7f12f9e8dcd1b76de289240afd5d36`，原话及授权边界见[approval.md](approval.md)。原准备清单、Demo、截图和独立准备复核保留在 `.local/v12-preparation/`。原Demo进程已在开工后正常停止；实现观察使用新产品 App/CSS、隔离真实Host及合成Provider。

## 实际实现与复用

| 切片 | 改动与原权威 | 调用、保存及下游证据 |
| --- | --- | --- |
| E1 用途 | 唯一 `global-settings/usage-context.json`，原子写、revision/CAS/operation回读；用途只是背景。当前讨论/Plan记录快照和 explicit/goal/default 来源；旧记录缺字段不回填 | usage-context settings/plan/runtime/s4 长期测试，真实HTTP→Host重开→官方Pi→Provider/native；`.local/v12-implementation/usage/` |
| E2 GSA/BSC | 原战略页默认GSA，BSC/计分卡/地图及编辑字段按需展开；原Goal、关系、历史、指标不复制。未知上级的部门不强造企业，已有企业锚定仍验证；SAP/资料授权独立校验 | strategy-goals-v12、v12-strategy-ui；真实产品浏览器记录另列，旧schema1/2只读零迁移 |
| E3 战略协作 | 静态 `strategy-discussion` 域、discussionId owner，Interface v3；复用 createAgentSessionDomain、原Pi1.4.0与原native/恢复/停止。仅 strategy_goals 工具；不加载普通Task工具、任意文件/脚本、扩展/Skill/MCP。公开搜索沿原封闭factory和父取消资源；无配置准确 unavailable | strategy-discussion-runtime/host/recovery；实际官方Pi工具集合、关闭重开/native前缀、互不干扰停止与Provider记录 |
| E4 候选采用 | 窄 propose/revise/adopt 回原GoalStore；来源是实际assistant toolCall载体的session/entry/type/hash，真实用户原话或UI内容hash/CAS及稳定operation。详细讨论只在native；Goal可选摘要/方法/准确来源，新格式首次写schema3 | 原Goal/create/revise/adopt持久化与重开；讨论host、GoalStore、source tests；不由采用目标推定经营行动授权 |
| E5 准确承接 | 原GoalVersion内容、准确关系/反馈GoalBasis与用途进入轻量Plan及实际Task；准备不得代改。每请求固定basis，历史关系/反馈按hash回读；正式Task新增只读窄 read_goal_context_source，范围来自本次交付或原native分支回执 | usage S4、strategy-discussion-basis、strategy-discussion-host实际讨论→Goal→原Plan确认→实际Task→准确native来源读取；新建仅创建/确认并开始仍沿原路径 |
| E6 集成 | 原Project/资料/已发布SAP/IR/报告/无文件聊天来源，复用原有界读取；只列元信息，不试连/取DB明细。已知DB来源沿原 sourceNote、grant、实际模型出口、Task策略和固定manifest资格核查，不发明血缘。Task回读Goal讨论来源时检查准确entry祖先链的历史source投影、原Project及接收Task自身范围 | source catalog HTTP、sources、permissions、DB原manifest facet测试；跨Project/模型、撤权、排除、范围缩小、出口关闭、旧native及停止反例；完整check与独立两轴复核另列 |

公开方法合同默认优先参考 Playing to Win，允许 Rumelt、麦肯锡、BCG、贝恩、BSC或其他方法组合/更换；用户已选方法与TOC/TP、因果类型/替代/前提/未知/补证及三层反馈沿共同上下文承接。Host不规定专业顺序、树数量、资源比例或推断经营选择；没有新增Skill库、战略正式主库、因果账本或Runtime。合成Provider只证明合同送达和工具/持久化接线，**不证明上述方法已由自由模型实质采用或专业正确**。

## 真实失败、修正与复验

本地原始证据根 `.local/v12-implementation/`。命令日志保留原始RED、fixture/导入问题与中间回归，不以末次绿色覆盖。独立复核源于产品/规范先导预期，非作者且只读产品源码；作者修正，复核者沿原反例重验。

| 发现 | 实际修正 | 证据与限制 |
| --- | --- | --- |
| 封闭讨论仍继承普通工具 | 原runtime资源策略增加明确能力白名单和Host绑定native恢复资格 | runtime/01 RED→02 GREEN；SDK原包未改 |
| 候选来源误引用用户问题 | 改为真实持久化assistant toolCall候选载体，区分普通message与tool-result并核hash | runtime/09 RED→10 GREEN；不伪称报告全文 |
| 准备失败前丢输入 | 单份pendingInput先存，202或metadata ID不当接收回执；仅实际native用户消息与run匹配才清理 | runtime/11 RED→12 GREEN；UI/Host重开证据 |
| S1 请求途中改关系导致读最新 | providedContext固定本请求GoalBasis，工具只读对应历史 | 独立request-basis原FAIL与修后证据、runtime/13 |
| S2 战略讨论用户气泡显示Host包装全文 | 原originalUserText投影复用到live与关闭历史 | ui/user-projection真实Host/client/renderer；raw native仍保留 |
| S3 输入以metadata ID提前清空 | 以准确requestReceipt及native entry为准；UNKNOWN保留原ID与输入 | 独立失败恢复、client/renderer测试；不得自动重发 |
| S4 默认用途误当明确选择 | usageContextOrigin区分来源；仅未确认的非显式派生可随显式Goal/Case更新 | usage/s4-result.md；实际HTTP/重开/Provider/native |
| S5 派发前取消后无法续接 | failed/cancelled且非busy/无native receipt时，用户可明确准备新的请求；new UUID+准确replacePendingRequestId，旧请求留cancelled | 独立cancelled-before-dispatch-data原FAIL及rechecked；ui cancelled RED/GREEN。UNKNOWN不开放、不自动send |
| Standards S1 下游可借Goal carrier读跨Project私有内容 | 准确来源entry祖先链保留原Project/来源投影，不以今日清空的选材洗权限；实际接收模型/当前grant复核 | 独立downstream-grant原Provider实测FAIL及修后阻止；runtime/18含清空当前选材后再形成候选版本 |
| Standards S2 SDK已接受而末次metadata ACK失败被写failed | sdkAccepted后未完成可靠回执记UNKNOWN，保留实际native完成记录及原请求 | 独立metadata-unknown原FAIL/修后证据；runtime/19 |
| 可选企业资料库未建立误挡独立Project文档 | 清单仅隔离明确enterprise_source_missing；选中失读及其他权限/损坏错误仍拒绝 | source-catalog-http真实HTTP200、Provider0；不吞任意错误 |
| 采用后卡片仍待采用 | 成功回调沿原Goal刷新后单次GET原discussion，绑定准确owner，不重发采用/模型；浏览目标标签与实际绑定分开 | 实际App截图03故障、08修后，两永久UI回归；39项受影响检查通过 |
| 接收Task DB排除未参与Goal来源回读 | 仅Host注入真实receivingTask，原来源与接收Task均调用原planningSources；对象scope交集、出口flags交集 | runtime/20实际RED、21 GREEN、22补合法/排除/窄scope/出口/归属与停止/历史回归12 PASS |

原PG01 fixture因新增上下文白名单未回传而失败，后续只补回传可选字段，原断言保留；该fixture失败不当产品RED。环境/导入失败均不改写为专业或功能失败。

**历史TDD证明缺口**：新增 Task `read_goal_context_source` 初版从静态差额进入实现，永久实际Host/Provider回归在后补（runtime/14）。没有开实现前的因果RED，记 `NOT_PROVED`，不由当前GREEN或后来权限RED补造历史。该小接缝功能与后来权限修正另有运行证据；最终流程评价由独立规范复核单列。

## 检查与候选

- check01 完整命令已退出0：2,970 tests，2,859 PASS／111 SKIP／0 FAIL／0 cancelled，tsc/Vite/stamp通过。绑定当时76文件清单 `check-01-source.json`，组合摘要 `3f731927842e42cef36d8b9a9ffc10aba26fdb0cdf82bb8bf8beb9ecc39266c2`。运行期间有已记录合法修正，**它只是中间快照**。
- check02固定80文件（61运行相关），实际完整检查2,865 PASS／111 SKIP／0 FAIL，tsc/Vite/stamp通过、exit0；日志/结果及最终doc-only候选绑定见[result.md](result.md)，旧check不冒充新候选。
- 原工具边界检查仅增当前Host薄适配/直接官方Pi隔离测试的精确允许路径，不放开插件创建Runtime；原旁路反例保留在完整check。
- 开发依赖为同基线/同lock的既有release独立APFS副本；无网络安装、package/lock/SDK/Skill修改。官方Pi版本保持1.4.0。

## 保全和后续采用

只操作当前worktree与隔离证据/数据。正式main、其他工作树、业务项目/Task/native、正式服务及两机配置未修改。原v1.1 FAIL/UNKNOWN/SKIP、隔离PPT FAIL、MacBook .git mtime FAIL/写入者UNKNOWN及先前check-03状态GET409保留各自历史范围；本轮不重新验证或改写这些结论。

新增Goal字段/schema3写入后旧binary可能不可读；正式采用前须另获授权、保全届时最新资料，并准备/实测可读新结构的兼容回退；目前未做，不声称已有回退包。不得用旧代码/旧数据库覆盖后来合法记录。Git/远端CI/合并、正式迁移/双机更新及真实模型/业务资料均未执行、未自动继承v1.1授权。

真实产品App入口已用CUA观察（实际Host/Pi与合成Provider），GSA/BSC旧v1、用途保存重开且旧个人上下文保留、候选采用到原Goal→原Plan→实际Task及准确来源回读均见 `.local/v12-implementation/browser/observations/observations.md`。界面续聊发现流式尾部与已完成snapshot重复，已沿原snapshot/idle语义修正投影；实际Host/Pi/SSE重连RED renderer1/3→GREEN1/2，40项受影响检查通过。原2条native同文为fixture每轮预置，未删除历史或按文本去重。Root再次CUA独立观察：重开原讨论两条，新增第三轮恰三条；完整AX/实际文本与截图12保留。

最终发现图谱重新索引实际WIP，项目为 `Users-bendandebaba-.codex-worktrees-optracall-v12-OptraCall`，14,692节点/46,338边，persistence=false；排除范围及runtime候选摘要见 `.local/v12-implementation/final-graph-receipt.json`。图谱不替代当前文件或遗漏的非代码/fixture直接核查。

## 组织零售联合补验

`.local/v12-implementation/retail-acceptance/` 先固定protocol，最终隔离运行 `run-2026-11-17T07-30-05-757Z`：26/26项工程核对通过、30次本地合成Provider请求、errors=[]。沿原HTTP建明确合成企业、无BSC复用同一个Goal/GSA；Agent工具按原goalId修订，组合/改选方法保留资料与native前缀，真实原话和hash采用v3；原Plan先“仅确认并创建”（新增Provider0），同确认再“确认并开始”三个Task，明确综合Task实际find/read两份子报告并核准确字节/hash。默认改个人、同Goal采用v4后，原综合Task续问仍组织用途/旧v3/Rumelt，既有native字节保留。完整ID/HTTP/native/Provider/文件清单见其result.md与receipt.json。首次26PASS因本地证据导出字段不全，保留原run并仅修导出脚本后新根重跑；产品/测试源码不变。不把预置报告当方法实质使用或因果专业通过。

## 独立复跑派生证据写入事件

Spec复核者重跑既有UI测试时，测试内固定输出路径更新了四份派生GREEN JSON：`ui/stream-projection/events-get-renderer.json`、`ui/user-projection/host-client-ssr.json`、`ui/adoption-card-sync/before-after.json`、`ui/cancelled-recovery/host-client-renderer.json`。这不符合本轮要求复核临时产物只写自身隔离目录，不能签“作者证据零写入”。源码/测试/spec、原RED JSON/RED-GREEN命令日志、check02日志、CUA及后端联合回执均未被改写；61运行文件与check02日志hash复核一致。复核者将新产物复制进自己的review目录，明确新运行时点；四份派生JSON的旧字节未有可核副本时记不可恢复，不补造、不伪称原件保全。当前新执行是独立复跑证据，不能冒原作者当时捕获；Standards单列其流程影响。

Spec轴最终功能结论为0项未解决产品行为缺陷；S1—S5、两UI修正及接收Task资格均闭合。非作者自有权限探针6场景通过，最后UI三文件新运行5项通过；零售26项只读文件交叉复核不冒重新运行。61运行候选维持 `14eb3712911db6f9df7eca0b1ac2b4c00de3d4c60950adc1bd97f1d19397d53b`。两轮独立测试误写派生GREEN的旧字节无备份，不可恢复/旧代际UNKNOWN；该过程FAIL单列，不否认当前运行的真结果。

规范轴对上述派生JSON写入事件的最后判断：有限影响未造成候选、原输入/原FAIL或关键原始运行证据缺失，四份新隔离副本hash一致；按保全/披露关闭处理，不新增用户审批门，也不能改写只读规则PASS。旧字节不可恢复、前代归属UNKNOWN保留。证据 `review/standards/derived-write-copy-verification.json`。当时本轮唯一待用户决定的工程流程事项是Task窄来源初版TDD历史NOT_PROVED；用户2026-11-17后续已明确限范围接受，见下方原话记录。

测试fixture已正常关闭，仅当前隔离PID62072/62075与43129；`browser/stop-receipt.json`核无进程/监听，合成库/原native和截图保留。没有切换正式服务。

## 后续用户限范围接受 · 2026-11-17

用户原话：

> 接受这项[限范围流程保留](/Users/bendandebaba/.codex/worktrees/optracall-v12/OptraCall/openspec/changes/overall-architecture-v12/process-exception.md)。

按process-exception.md限定范围关闭该单项本地流程门，状态“已接受的NOT_PROVED”。保留原缺口、两轴复核及派生证据事件FAIL/不可恢复旧字节/UNKNOWN，不补造RED。此次仅更新五份工程决定/结果文档，产品/测试/SDK和已测运行摘要不变；Git/CI、合并、双机及真实模型均未执行。原五文档、已接受的候选清单和当前原话收据保全于 `.local/v12-implementation/process-acceptance-20261117/`。
