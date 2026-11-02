# 真实模型与委托产品检查：非作者独立复核原文

以下分别来自干净上下文、未参与产品候选创作的数学／产品复核者和原生轨迹复核者。源文件、测试与规格保持只读，探针与报告写入各自隔离目录。正文逐字复制；其中相对文件名指原本地证据目录，不指本OpenSpec目录。复核固定时的UNKNOWN／设备状态不因入库追溯改写，后续采用事实见[实际记录](live-validation.md)。

| 原文 | 原本地路径 | SHA-256 |
| --- | --- | --- |
| 数学与产品流程复核原文 | `/Users/bendandebaba/.codex/worktrees/simlab-archive/OptraCall/.local/live-acceptance-independent-review-20261102/review-summary.md` | `19a8188a576dc505c2c722a52785a9b5aa81ddf7b7af5da23d6e3e1cf398d8ab` |
| 第二次明确纠正后的专业评价原文 | `/Users/bendandebaba/.codex/worktrees/simlab-archive/OptraCall/.local/live-acceptance-independent-review-20261102/correction2-professional-evaluation/correction2-professional-evaluation.md` | `10454215c9263223f018c01682e7b8487653d8c3c97e9d8eaabbcfa66c324f47` |
| 原生轨迹与保全复核原文 | `/Users/bendandebaba/.codex/worktrees/simlab-live-acceptance/OptraCall/.local/simlab-live-acceptance/trace-audit-bb19502b-9a1a-488e-81c1-3d140e79d5e7/final-report.md` | `f31a38bb6cf000032884aa9bfaf3cd0193d889602778c0b84bf6bb5f6e197492` |

---

## 数学与产品流程复核原文

# SimLab真实产品验收独立复核汇总

日期2026-11-02；复核者为非作者Agent。起点为archive树固定候选636ac3a，源码/规格/测试/Git均只读；所有复核输出仅在本隔离.local目录。结束时archive树Git仍干净。未由复核者启动产品、调用Provider或操作MacBook。

## 核心结论

**本次所核引擎数值、原生工具/快照读取及若干产品证据链限定通过；专业文字首稿与二稿不通过，第三稿已关闭主要旧错但仍有P3事实误述，不能写完全专业PASS。用户本人产品验收与MacBook体验不由这些复核代替。**

| 对象 | 独立结果 | 固定证据/报告 |
| --- | --- | --- |
| 预注册固定输入与隐藏oracle | 已独立建立；未把答案提供给运行Agent | plan-and-oracle.md、scenario-input.json、independent-oracle.py |
| 首轮真实探索算术 | 132组无差异；5run、17份7日账本119日、18项压力，全部输入Hash可追溯 | first-professional-evaluation/first-terminal-arithmetic-audit.json |
| 首稿专业解释 | **FAIL**：现金混库存、无依据相对偏差、活动增量、有效产能及现金外推等 | first-professional-evaluation/professional-evaluation.md |
| SNAP1真实Agent读回 | 列表+详情两次simulation_evidence，13项身份/数值一致性通过；专业解释重复错误仍FAIL | snapshot-readback-evaluation/readback-evaluation.md |
| 有提示二稿 | 新6run/11份账本77日/2压力算术无差异；专业**FAIL**，新增已付库存扣12误算 | correction-professional-evaluation/correction-professional-evaluation.md |
| 再次明确提示后的第三稿 | 旧实质问题撤回、RUN15四结果与RUN5完整一致、原SNAP1不变；仍未完全通过，**P3：正文和新卡minCash范围108–192应96–192** | correction2-professional-evaluation/correction2-professional-evaluation.md |
| 页面30/90天独立操作 | 六个输入Hash匹配；360日账本独立算术、720DOM值、480Δ、72汇总格无差异；不混入Agent样本 | page-30-90-independent-review/review.md |
| 固化快照导出→Case/Board | 两份新文件不覆盖、7910字节/同SHA，完整权威快照相同；Case路径/摘要/revision/operation正确、Board可见且未自动采纳 | case-board-default-off-review/review.md |
| 默认关闭任务 | 实际SDK openResponse无simulation工具，普通九工具保留，历史空/idle | case-board-default-off-review/review.md |
| 归档保护子集 | 归档/恢复保全、SNAP读回、export/create/messages三写入口409、native字节不变，共7项通过 | archive-independent-review/independent-checks.json |

截至本汇总直接查看的材料，重启历史、页面阶段服务端无外发、受管/封闭资源对照、归档其他写入口与忙态准入尚未由本复核独立核实，保持UNKNOWN/NOT_RUN；应由主任务按自身固定证据分别记录，不从上述PASS外推。

## 专业剩余问题的实际范围

首稿和二稿的实质现金/库存等错误曾真实出现，第二次明确提示后才撤回，不能追溯写成首次通过或盲测可靠。第三稿遗漏的96来自已实际测过的B在priceMultiplier0.8下的最低现金；此前48项与新增RUN15后的52项范围均96–192，minCashDay全1。该P3不改变A/B/C基准比较、已核模型数值、不可变快照或原生调用链，也不支持将文字误述直接归为代码缺陷。

保留原稿、原卡、原SNAP1和所有首次失败/纠错。复核者首次中途探针把新版草稿套历史run的KeyError已单独保留，纠正后通过；属于复核脚本错误，不是产品RED。主任务页面验证器rows/ledger命名错误同样不能冒充产品因果失败。

本汇总无需再触发模型。后续若交付MacBook，应分别说明工程版本、功能流程范围、专业可靠性限制及用户体验边界；不将本独立复核当成用户本人已验收。

## 补充：同根重开与收尾（原专业评级不变）

随后收到固定重开/收尾材料，已补充独立核对，报告为 `same-root-reopen-close-review/review.md`。独立重算8项逻辑/字节保全、6项固定UI/历史及5项关闭收据均通过。before/after完整task逻辑对象相同，SNAP/Case/Board/草稿相同；403428字节canonical原生JSONL与重开前逐字节一致，61条历史与最后completed请求保持。固定DOM计数保留RUN5/RUN11/RUN15三张历史建议卡，完整AX树能定位RUN15、原草稿revision2、SNAP1与engine2。最初把AX差异响应当完整树的false探针原样保留，属于验证器错误，不冒充产品RED。

两份固定Host日志确认旧实例正常close、同根新实例正常启动并最终close；两次关闭收据都记录源settings/auth字节未变。复核者只读这些固定收据与当前原始数据，未HTTP、未再开浏览器/Host/Provider。上述补充将本汇总此前“重启历史尚未核实”的状态更新为**同根正常重开限定PASS**；异常恢复、无外发及受管资源等未核范围保持原限定。

首稿FAIL、读回FAIL、二稿FAIL及第三稿残余P3评价不改；生命周期和数据保全通过不替代专业完整准确性。主任务已向用户披露专业PARTIAL；MacBook按已测功能源码636的实际接收收据仍另核，不提前宣称更新或用户本人验收。

---

## 第二次明确纠正后的专业评价原文

# 第二次明确纠正后的第三稿：原实质问题已关闭，完整准确性仍未通过

固定请求 `9cf8cb5d-dcab-4f12-badc-0b5a9eff3f7a`，completed/idle；61条累计消息。原API终态、全文、业务读回与RUN15均单独固定在本目录，来源SHA与逐项核对见 `correction2-audit.json`。先前首稿FAIL、读回FAIL、二稿FAIL原文保留不变。本稿收到现金独立余额、扣12无依据、减48改输入、取消/积压区分和D3到货等明确解释，属于**有提示修订**，不能作为首次盲测或自主专业可靠性通过的证据。

结论：现金恒等式、固定输入边界、旧稿保全与新运行的正确数值限定PASS；完整专业正文及RUN15新卡仍含一项**P3局部事实汇总错误**，不能写成完全PASS。无需为此再跑模型；也不从这项文字错误推出引擎、Host、SDK或产品接线缺陷。

## 已关闭的实际问题

1. 明确撤回“现金含库存占用”与A72/B136/C112/A+372的付款来源拆分，将库存数量与现金余额并列。新的现金表中400+回款−周期采购−D0新增现货−履约−持有，A588/B544/C498/A+3603全部正确。
2. 明确撤回把另减48当作原输入更正确口径；固定cash400与期初库存12分别给定，扣48属于另一场景。
3. 活动总增量10与有效产能7已在二稿纠正，本稿未再引入旧值。无活动/含活动的取消8/18与期末积压10/10分别列示，避免再次混用取消和积压。
4. 明确撤回增加D1采购量能弥补D2缺口，承认D3才到货。
5. 最低现金时点改为已观察事实，没有再把采购节奏当无条件规律。A有条件保留理由限定于三个指定方案的当前输入与基准；不再把价格/产能压力都说成必然守线。

本稿把两组活动对照差额的因果表述全部撤回，属于谨慎限缩；如未来解读本确定性模型的输入效应，应仍与真实经营因果分开。本复核不因其谨慎不归因而判新增错误。

## 残余P3：最低现金范围漏掉已实际观察的96

正文事实陈述及**RUN15新建议卡reason都声称**：此前11次运行、9组扰动共48个变体结果，minCash范围108–192。

固定原生记录中，首轮 `simulation_stress` 的 `b-stock`、`priceMultiplier=0.8` 已实际返回 **minCash=96、minCashDay=1**（原生call `call_01a19cc17ba57096809ba156`，首次审计亦已独立核算）。因此正确历史48项范围为**96–192**。第三稿新增RUN15的4个变体后累计52项，范围仍96–192，所有观察的minCashDay确实均1。

这不是新计算失败，而是汇总既有证据时遗漏一个低值；受影响范围是正文与卡片的压力观察范围说明。A基准192、B基准112、C基准174、A+3基准180以及A现金588等主比较数字没有变化；B在96与原112两种情形下均已低于180，因此不改变该稿在三个指定基准方案内保留A的有条件理由。仍不能据此把含错的新卡整体定为专业正确。

“本次11次运行/48项”的计数仅在明确指第三稿新增RUN15之前的历史样本时成立；当前Agent原生累计12次run（不含页面操作者的RUN12/13/14）与9组压力，共52个变体级结果。宜在摘要中注明“此前48项”以避免样本范围混淆。

## 原生路径与数值保全核对

第三稿只新增一次simulation_run，原草稿、revision2与全部变体仍在；RUN15四个result对象与首次已独立计算的RUN5四个result对象**完整一致**，aggregateHash相同。新卡来自显式suggestFreeze成功回执，绑定RUN15/rev2/a-normal，完整inputHash仍 `6a7dbc73bd0ae158d3c804332d1e1e5ca13318b0939fe0aee5e8fb0688f38a9e`。旧SNAP1完整对象与首次快照读回相同，新卡未自动固化，旧卡/稿/快照没有被覆盖。

三次专业评级分别保留：首稿FAIL（实质口径/解释错误），二稿FAIL（未解决现金错误并新增库存扣12错误），第三稿仍未完全通过（重大旧错已撤回，残余P3观察范围误述）。数值、工具调用、页面证据链可各自限定通过；这些不等于专业全通过或用户本人产品验收。

---

## 原生轨迹与保全复核原文

# Final independent trace, preservation and Host shutdown audit

Candidate `636ac3a53f69c524030cc6294d6eeccbdae3f6d7`. This is an append-only follow-up report; earlier report.md/report.json retain their original scoped conclusions. No product source, tests, specifications, fixed evidence or Git state were written. All new audit artifacts are confined to this directory. No API was requested and no Host, Provider, browser or business tool was started or controlled during this follow-up.

## Verdict

The inspected Host–Agent integration, native evidence, preservation and normal shutdown boundaries PASS within this scope. The professional answer remains PARTIAL. Native execution completion, correct stored model numbers, UI operation and a closed Host do not promote the original FAIL or the latest professional text to full product acceptance.

The last answer explicitly withdraws earlier major cash and unsupported attribution statements. It still describes the observed minCash range as 108–192. Read-only aggregation of its 48 prior run/stress variant observations gives 96–192; native line 27 records b-stock under priceMultiplier=0.8 with minCash=96. This is a model interpretation/summary error, not evidence of Host output rewriting. See final-professional-range-crosscheck.json. Preserve the prior drafts/cards/FAIL and the remaining P3 error; this report initiates no further model repair or MacBook update.

## Four-turn trace

All four explicit user requests are native completed in the same owner/session. Final retained native has 95 lines, 403428 bytes and SHA-256 `e3b1b59c9f9ac70a04fc0da1d6a6afe9513c67f088b71c46e85d9f27aac05790`. Its bytes equal both the final fixed native copy and pre-reopen-native.jsonl. Eight prior native copies are exact prefixes. Every tool call ID has its matching result: 33 calls/results in total, including the preserved invalid_parameters rejection at native line 63. All 23 native HTTP response steps are 200/completed. The fourth request `9cf8cb5d-dcab-4f12-badc-0b5a9eff3f7a` starts at native line 88 and completes at 95; it makes one simulation_run call and produces the new RUN-0015 suggestion, with two HTTP response steps. It does not create a new draft or execute freeze.

Model/API/provider alias/high thinking remain `MiniMax-M3.1-Flash` / `anthropic-messages` / `optracall-minimax-m31-flash-1` / `high` throughout. No observed retry, summarization retry, compaction or transport error appears in any of the four preserved SSE streams. HTTP step count is not an SDK retry count or a supplier-wide billing count. Installed SDK metadata and payload mapping were checked in the earlier report; exact outgoing HTTP body bytes were not captured, and adaptive/effort/max-token fields remain source-derived conclusions.

All four settled snapshots have matching task lastRun, snapshot lastRun and idle. Their message counts are 29,35,57,61; native-identified assistant messages match source content/model/API/usage/stop fields at every stage (11,14,21,23 respectively, zero mismatches). Messages lacking native identity were not promoted to independent native proof. The defaults-off task opens with the nine ordinary native tools, no simulation tools and no requested model messages. The tool-enabled task retains all ordinary tools plus the five simulation tools.

## Usage

Fourth-turn persisted SDK usage is input 9217, output 5394, cacheRead 145801, totalTokens 160412; SDK cost estimate 0.0067729091. Across four prompts: input 79697, output 52958, cacheRead 846905, totalTokens 979560; estimate 0.0561733171. Reasoning 38399 is separately reported and must not be added again. These are sums of persisted per-response SDK usage, including repeatedly cached context. They are neither distinct token counts nor independently verified currency or supplier settlement; supplier settlement remains UNKNOWN.

## Archive, same-root reopen and UI evidence

Frozen archive evidence records the explicit idle archive as 200, snapshot GET as 200, and export/new-draft/message writes as 409 project_archived. Restored archivedAt is null. Native bytes and SNAP-0001 remain unchanged. Earlier attempts to toggle tools or archive while the real request was running were rejected 409 session_busy/project_busy, preserving the active request.

The same synthetic root reopened after the first normal close. Independently compared before/after logical task, snapshot, Case, board and draft objects are exactly equal; all eight stored reopen checks pass, including canonical session path, native bytes, messages and lastRun. The full reopened accessibility tree contains RUN-0015, SNAP-0001 and optracall-sim-2; refresh-proof records the three RUN-0005/RUN-0011/RUN-0015 cards. The earlier false probe treated a collapsed-panel AX diff as a complete tree; its original file remains preserved and is not a product FAIL.

## Source credentials and final process state

Both normal close receipts independently record source settings/auth byte equality: old PID88820 and final PID2468. Final ready.json records instance65d53e93-0f15-4104-b105-44d0c8ce257b as closed at 2026-11-02T15:19:11.719Z. Current source settings SHA still equals ready. The exact selected real-key scan at 2026-11-02T15:22:22Z covered 191 files across the synthetic root and all current acceptance evidence: zero plaintext matches, zero read errors and no unscanned symlinks. The key value and its digest were never printed or retained by this audit. This is an exact known-key scan, not a claim about arbitrary transformed secrets.

Read-only ps checks found neither known Host PID; lsof found no LISTEN socket on either acceptance port54270 or55862. Each command returned exit1 with empty stdout/stderr. The 465 files captured by source-manifest-before-live.json still match their fixed hashes. Current Git status remains limited to the root operator's spec/result documentation changes.

Detailed machine-readable evidence: final-four-turn-native-summary.json, final-preservation-and-host-state.json, final-credential-scan.json, final-sse-observation-summary.json, final-source-manifest-compare.json and final-report.json.
