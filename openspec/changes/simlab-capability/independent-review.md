# 经营推演一期 · 非作者独立复核记录

日期：2026-11-02。本文由 Codex 汇总两位非作者的原始报告与重验结果；原报告、预期清单、命令输出、独立反例及失败现场原样保存在本任务 `.local/simlab-takeover/independent/`，没有把首轮“不通过”改写为通过。

## 候选与独立性

- 初始交接：`4cc11955654e6fbb4cd788aa71ea46b0998c90eb`，基线 `d58061b08534d48d7847d8447575058a1faa45d4`；原清单31项逐项哈希一致，不含清单自身。
- 首轮：代码 `d9c9b47` 加文档 `404b34d`，完整比较 `git diff d58061b...404b34d`。修复重验：`789f607`。新增 SIM08／SIM11：`fba4773`。浏览器可达性修复：`02a2748`。最终源码：`36a9294a5db9e609700213283061da037fc7285c`，最后仅历史卡状态文案变化。
- `independent_standards` 与 `independent_spec` 均以 `fork_turns=none` 启动，未继承作者会话历史，未参与候选、修复或随候选交付的测试创作；各自另写隔离验证探针。两者先独立导出验收预期，再审查固定 git archive 副本；源文件、测试、规格及既有证据只读，验证和报告只写各自隔离根。
- 依据：当前 spec 的 SIM01–SIM13／R1–R10、产品讨论稿、工程规范 v1.3 §2／§3／§4／§5、IN01–IN07 与统一会话接入说明。后续用户明确要求 SIM08／SIM11 一并实现，复核范围同步更新。
- 接缝互查及浏览器辅助 QA 单独记录，不冒充第三位最终独立复核者。全部验证只用合成资料、合成凭据及本机合成 Provider，没有真实模型、既有业务资料、运行服务切换或 MacBook 操作。

## Standards

首轮结论：**不通过**，两项 P2；另对已知 CAS 风险作阻断评估，不算新增发现。

| 发现 | 原结论与理由 | 修复重验 |
| --- | --- | --- |
| S-01 工具错误泄露 Host 路径 | 未知 IO 的 code/message 直接进入模型工具结果，违反 IN05 的脱敏边界 | 仅受控 EngineFault／StoreFault 返回业务原因，未知错误统一安全信封；原独立断言及永久回归通过，关闭 |
| S-02 合法大额小数守恒误判 | 固定1e-6逐日残差容差把合法90天输入判为不守恒，继而拒绝固化 | 量级相关浮点舍入容差，不改变金额精度或 rows／summary；独立核对与永久回归通过，版本升v2，关闭 |
| 已知 CAS 的风险处置 | 双实例5/5轮双成功且更新丢失，单用户不消除Host／Agent并发；作者“接受”不是负责人例外 | 跨进程短文件锁，5/5轮恰一成功；双进程、快照竞态与遗留锁均通过，关闭，不依赖风险豁免 |

最终增量核对：显式建议与真实调用/回执的身份、权威快照导出、Case原有归属/revision/operation/观察摘要、归档读写、错误安全、未知引擎、旧修复、CSS和纯文案均无新增代码阻断。没有需另报的有效代码气味发现。

最终原报告：[Standards 最终增量](../../../.local/simlab-takeover/independent/standards-final/standards-final-increment.md)；历史原件为同级 `standards-first/standards-review.md`、`standards-recheck/standards-recheck.md`。

**Standards 最终限范围结论：代码与边界通过。** 新功能测试后补的历史顺序偏差及 Qoder 原接缝偏差继续保留，不能据此宣称全流程追溯合规。

## Spec

首轮结论：**不通过**，7项发现；F1为P1，F2–F7为P2。

| 发现 | 验收依据与反例 | 最终重验 |
| --- | --- | --- |
| F1 固化校验与发布之间存在同进程窗口 | R4／SIM05；读取draft后另一更新已成功，仍可固化旧revision | 发布临界区重新核revision；同进程、另一Node进程修改及无快照副作用反例均通过，关闭 |
| F2 能力外变体字段被丢弃 | 不建模能力须结构化拒绝；returnRate等输入原来被接受但未计算 | 全字段及活动窗口字段检查，拒绝后不持久化错误稿，关闭 |
| F3 默认/保留变体未校验短窗口 | R8／SIM01；7天草稿可保存却因默认split越界不能运行 | 默认窗口适配，partial update校验保留变体，7天与拒绝回归通过，关闭 |
| F4 键序影响确定性 | R1／SIM02；相同字段不同JSON键序改变inputHash及字节 | 规范化对象与输出扰动键序，独立反例及永久回归通过，关闭 |
| F5 缺逐日多方案差异 | SIM03；原界面只有汇总和单方案账本 | 补逐日并排指标及相对首方案差值；30/90天、3方案、现金/库存720个单元格与实际run逐项一致，关闭 |
| F6 固化确认忽略方案覆盖 | R4／SIM05；split实际D8–21/+40%，原确认显示D8–14/+80% | 页面及快照按选中variant有效口径展示；实际用户确认与SDK回执对应旧RUN1/split，关闭 |
| F7 历史快照缺版本口径与边界读回 | R10；只展示引擎名不足以说明规则/未建模范围 | 保留v1/v2规则映射并只读解释；中间unknown仍派生effective的残余P2也保留并修正，最终unknown不套当前规则，关闭 |

新增 SIM08／SIM11 已一并复核：实际 SDK 显式建议形成唯一卡片，无建议的第二次run不出卡；指定历史run不默换最新，缺失/错配/过期阻断；用户页面固化，Agent读取真实回执。已固化快照导出固定报告，Case引用的文件摘要与浏览器重算/下载一致，决策板报告可见且未自动抽取。保存后关闭/重启Host，原建议卡仍可读、canonical字节未变、无额外Provider请求。

最终原报告：[Spec 最终增量](../../../.local/simlab-takeover/independent/spec-final/feature-spec-review.md)；历史原件为同级 `spec-first/spec-review.md`、`spec-recheck/recheck-report.md`。

**Spec 最终限范围结论：通过，F1–F7全部关闭，新增SIM08／SIM11无未解决的可行动发现。** 本结论不是CI、合并、真实模型评价或用户产品验收。

## Host–Agent 职责边界及复用专项检查

检查对象限上述候选与实际受影响接缝，不外推整个既有产品。

| 检查 | 代码/运行证据与结论 |
| --- | --- |
| Host管环境，Agent自主选择 | Host交付权限、工具、存储、身份与确认；suggestFreeze只能来自Agent显式工具参数，Host不猜方案或理由、不补跑任务分析。页面推演是用户直接通道。通过 |
| 共用SDK／Runtime | 复用project-tasks原owner/profile及公共生命周期，声明式agentOptions经原worker传输；无新域/平行Runtime/业务运行Map。5工具经实际Pi SDK被调用。通过 |
| 工具权限 | 开关默认关，仅非受管普通任务注入；普通read/bash/edit/write保留。ordinary/protected/fixed-draft/text-only实际SDK open均无推演工具。defineTool单能力例外的正反例通过 |
| 生命周期与历史 | 空闲开关经公共close，下一次open/send生效；busy拒绝、canonical路径及旧字节前缀保留。Store短锁仅包文件操作，不含模型、引擎计算或会话占用；SIGKILL后锁和旧字节保留，busy/UNKNOWN不自清或盲重放。通过 |
| 固化与证据 | Agent没有freeze工具；用户确认不可变快照，Case/Board只复用固定报告和既有引用合同；engine输入hash与文件字节hash分开，原v1和未知版本不改写。通过 |

专项最终结论：**通过（本变更及受影响接缝范围）**，没有以批准例外替代代码问题的通过结论。

## 实际验证与限制

- 两位独立复核者各自运行29项SimLab测试、边界检查及tsc，退出0。Standards另有5项独立断言及CAS5轮；Spec另有54组账本、手算例、7项Case回归、13个卡片错误对照、跨进程/崩溃及真实SDK重启读回探针，均见原报告，不能将作者运行冒充独立运行。
- Root在固定源码 `02a2748` 运行 `npm run check`，exit0：823项中820 PASS、3 SKIP、0 FAIL；边界与构建通过。SKIP为当前macOS不适用的unsupported-platform保护分支及两个LibreOffice真实渲染用例；非阻断bundle体积警告保留。日志 `.local/simlab-takeover/check-final.log`。其后 `36a9294` 仅历史卡文案变化，独立窄复核和 `npm run build` 均通过，日志 `build-final-copy.log`。
- [浏览器报告](../../../.local/simlab-takeover/browser-final/qa-report.md)和 `qa-matrix.json` 有11项：3视窗真实鼠标可达、720单元格、指定旧run、错误身份、Tab/Shift+Tab/Esc与焦点返回、导出/Case/下载。源码7/7及SHA清单76/76匹配。整轮合成Provider为7请求，页面操作阶段7→7；不能把整轮说成零请求。
- 浏览器原点击失败RED、测试定位/错误入口失败及日志均保留，不宣称控制台零错误。两个本任务QA及其子进程/浏览器会话已优雅停止，端口读回无监听；原目录及证据未删除，见 `browser-final/shutdown-readback.json`。
- 新SIM08／SIM11的测试是实现后补，再在789基线验证缺功能时失败；这是候选对照，不是历史先测试RED。历史顺序无法通过补测追溯消除，保留为流程偏差，不宣称全流程合规。
- 本轮没有真实模型端到端、MacBook体验、原仓退役或产品验收。最新main尚未集成，Git/CI尚待用户授权；基线变化后须重验受影响范围及必要复核，当前PASS不自动沿用到未来提交。

双轴汇总：Standards首轮2项／最严重P2，Spec首轮7项／最严重P1；两轴发现现均关闭，最终无未解决代码阻断。历史流程偏差与后续交付门槛分别保留。
