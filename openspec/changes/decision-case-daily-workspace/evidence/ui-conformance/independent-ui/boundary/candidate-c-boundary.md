# 候选 c 边界独立复核（非最终；B2 未关闭）

**结论：本范围 39/39 相称永久回归及反馈 A→B→A 独立探针通过，但候选 c 已退出最终验收，不能给候选或 manifest 最终 PASS。** 主审于本轮收尾通知：另一 backend 非作者发现 B2——从请求 A 原方案 v1 进入，改选 v2、保存草稿并取消，完整重开后 planId 被重置 v1，而 reason 保留。作者将仅修恢复初始化；另有实际页轮次标识待核。以上均不被本轮绿色测试覆盖，等待固定候选 d。

## 身份与执行范围

- 基线完整清单：`.local/ui-conformance/candidate-c-complete-manifest.json`，内置 `manifestSha256=0ce32e72bcc742a3b29e6727ad54f5f346a3380719d6ba5cee4ecebccdb2c597`；manifest 文件本身 SHA256 为 `2a16f0e029d24043db3e8807af89e5a8608ad15e33e22eaa43db27151f1d8096`，二者不同且不混用。
- 01:26:34 UTC 独立逐字节核全部 2,412 文件，仅预告的 `tests/browser-case-board-navigation.mjs` 由 `160d970…`→`fff649ad…`；其余 2,411 文件（含本次全部范围）匹配。主审确认该唯一测试调整可继续范围审查，但不得把旧完整 manifest 当最终身份。证据 `candidate-c-manifest-before.json`。
- 本轮仅只读生产/永久测试/规范；写入本目录报告、probe输出、日志及 runtime 临时数据。没有生产修改、Git/Issue/PR、真实业务、真实 Provider 或操作截图 Host43150。
- 停笔再次逐字节核清单，结果 `candidate-c-manifest-stop.json`；不追逐正在准备的候选 d。所有“通过”仅指本轮所验证的具体合同/断言，不代表完整产品、三尺寸或用户验收。

## 实际独立执行

所有命令项目根运行并设置 `TMPDIR="$PWD/.local/ui-conformance/independent-review/boundary/runtime"`。

| 检查 | 结果 | 日志 |
|---|---:|---|
| `node --test tests/case-action-draft.test.ts tests/case-action-draft-recovery-ui.test.ts` | 19/19 | candidate-c-draft-tests.log |
| `node --test tests/case-request-response-ui.test.ts tests/case-feedback-dialog-ui.test.ts` | 19/19 | candidate-c-dialog-tests.log |
| `node --test --test-name-pattern='D13 frozen optional next step' tests/case-decision-store.test.ts` | 1/1 | candidate-c-next-step-tests.log |
| 原独立 `feedback-request-switch-recheck.ts` 再运行于候选 c | 正常/UNKNOWN 两路径通过 | candidate-c-feedback-request-probe.json；stderr为空 |

实际不存在 `case-choice-dialog-ui.test.ts`；取舍弹窗永久回归是 `case-request-response-ui.test.ts`（9 项），反馈入口是 `case-feedback-dialog-ui.test.ts`（10 项）。本轮没有把另非作者 backend 24/24 当作自身执行证据，也没有重复前轮归档/准备13或准备10项。

## 源码与断言逐项审查

| 合同 | 本轮独立源码事实与断言 | 结论/限界 |
|---|---|---|
| action draft owner | `case-action-draft.ts:37–43` 检查 kind/id/revision/Case/issue/action kind，拒非空普通 issue text 和 appendedFragmentIds 混入。`useCaseActionDraft.ts:13–35` 按 id/Case/issue/kind 分 controller，active controller 防旧异步结果污染新 owner；原 Host issue-draft CAS接线。永久测试覆盖错误owner不可ready/write、迟到读不能替换另一Case弹窗、读前用户编辑不覆盖未见草稿。 | 已检范围通过。不是完整草稿权限后端安全审计。 |
| 403 与 503 | `case-action-draft.ts:52–72` 403/401清value/saved/conflict/backup引用，ready=false，只把本轮实际编辑过的路径放 retainedInput，未编辑远端内容不得伪装为本轮输入；同一mounted owner不继续读写。`useCaseActionDraft` 不因read失败创建草稿；未编辑可取消。choice和feedback区分busy/readOnly，403禁止业务提交。永久测试验证初读403、save403、unknown后的readback403、旧敏感内容移除、本轮字段保留、无DELETE、重复flush无请求；503禁保存但可取消且0业务POST。 | 已检范围通过。主审另核真实UI403清除/恢复与三尺寸。 |
| CAS/冲突/副本保全 | `case-action-draft.ts:103–127` save失败只允许相同owner+内容读回当确认；其他内容进入conflict，不覆盖。`:133–154` 必须明确当前reviewedRevision，稳定backup ID先保存完整对方版本并验证回执，才采纳CAS baseline；needsExplicitSave阻自动保存。再次并发仍由原CAS拒绝。`useCaseActionDraft.ts:20–31` 副本丢确认按原backup ID准确回读，无第二个副本。`CaseActionDraftRecovery.tsx:25–32` 精确副本id/Case/issue/kind/originalId/sourceRevision及serial防旧响应；先清旧正文，403/错归属不可保留伪原文。 | 永久断言覆盖backup失败零覆盖、保持两版本、同backup重试、晚到旧副本/错原owner移除、discard遇在途save不反向重写。通过范围合同。 |
| UNKNOWN | choice网络前flush原pending intent；500/网络未知不清pending，query只读原timeline匹配operation/Case/issue/store/strategy；提交成功或准确原回执才清。feedback网络前存unknownOperation，原feedbackOperation查询；`CaseFeedbackDialog.tsx:81–82` 还核反馈taskId+operationId，异常仍保留未知。没有autoRetry或单独完成请求写。 | UI断言选择lost-ack仅1业务POST、query后无第二写；反馈重开保原operation，再明确重试同ID，查到原回执不重复保存。通过；组件harness非真实崩溃/丢网络整链路。 |
| B03 反馈 A→B→A | 明确反馈请求草稿key包含task+requestId+revision，普通key含Case/issue/task；form React key也按request身份区分。`FeedbackDialog` requestScope仅允许准确点击的请求，错scope有错误并拒save。 | 独立正常/UNKNOWN探针再次通过：B确切关联B；返回A正文、request、operation、UNKNOWN均保留；正常0POST，UNKNOWN只有原一次503POST，切换不重发。永久第9项补了同task两请求隔离。旧FAIL及此前修复探针均保留。 |
| entrySeq 重开 | App准确pending入口→caseFocusSeq；CaseBoard传entrySeq；IssueWork key包含请求+revision+entrySeq，打开逻辑核Case/issue/request/version并记录该entry；再次明确进入新的seq可以重开，普通render不反复重开。 | 9项choice中明确覆盖“取消后seq2重开”理由保留、0业务POST。**不覆盖 B2 的改选方案全卸载重开**；不能以此解除B2。 |
| 可选 nextStep | `CaseIssuePanel`草稿字段nextStep参与保存pending intent，UI maxLength200；service原choice白名单仅加nextStep；`case-decision-validation.ts:73–75`非空文本最大200；CaseStore旧历史无字段保持无字段，新字段属于不可变choice事件与返回值，不更新Case.nextStep，不授权行动。 | UI lost-ack测试携带原nextStep且不重复提交；独立真实CaseStore测试准确同操作幂等、改内容operation_conflict、非法类型/201字符零新增event、旧操作指纹/事件不变、重启仍保存字段、Case计划不改。1/1通过。 |

## B2 与最终限界

B2 由另一非作者报告，**本报告不冒称独立复现**。本轮读到的 `CaseIssuePanel` 请求初始化确有两段逻辑：ready/initialRequest变化时重置 planSelectionTouched=false，随后按原请求策略设置 planId。上述设计只在“尚无用户选择”条件下应生效；永久用例覆盖理由保留、历史明确确认、请求/事项切换、entrySeq重开与UNKNOWN，未覆盖“已有持久草稿planId=v2，原请求planId=v1”的全重开。因此39/39不能证明该恢复路径，候选 c 保持未通过。

四原则在本检查范围内：Host继续管理owner/CAS/权限与原保存合同；没有新Agent流程编排；项目/native、choice、Board反馈与保存能力复用原实现；自动保存/重开降低重复输入，冲突/历史版本/UNKNOWN只要求其合同必要的明确动作。B2会增加用户纠错操作并破坏保存的准确选择，须在候选 d 关闭。

本报告不证明实际Host身份、真实modal的1440/1024/390尺寸、原来源403实际UI、主页面轮次一致性或T18用户截图确认。等待主审提供候选 d 固定身份后，仅复验受影响路径及摘要；不将候选 c 结果外推到后续改动。
