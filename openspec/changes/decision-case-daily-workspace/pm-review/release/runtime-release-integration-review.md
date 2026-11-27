# Issue #149 最终集成 source 增量 Runtime 终检

**结论：通过。本 Runtime 子审建议集成/合并 source `2eb30a51e31333a4252d4b6564bb0ad3a66326b8`，无新增必须修复项。** 工作树 `/workspace/OptraCall-issue149-check-followup`，分支 `codex/issue149-check-followup`；开始/结束核对同一 SHA。tracked source无漂移；`git status` 显示的唯一untracked项是 Root已说明的 `node_modules` 符号链接，指向原final物理依赖，未当作源码clean或官方包物理路径验收证据。

本轮独立静态审查相对原已通过 source `6bc7be2849d280e5e6a6e598ee6b7a68dd5e48eb` 的完整差异，准确仅4文件：`CaseIssuePanel.tsx`、新增 `case-request-response-ui.test.ts`、`conclusion-review-handoff.test.ts`、`fr01-03-05-repro.test.ts`。未修改tracked文件、依赖或SDK；只在原final的 `.local/pm-final/` 写本报告。未重跑整包/真实Provider，未与另一独立UI浏览器复验重叠。

## UI 与原业务权威接缝

- 历史方案新增读取调用已有 `readCaseDecisionRevision(record.id,recordId,revision)`，沿原HTTP错误/权限处理；不拼任意workspace/native路径。收到结果后核准确caseStoreId、caseId、recordId、revision、strategy种类与事项归属，并要求当前record仍active。401/403/归档/错owner失败不把历史版本加入可选项；异步读取用effect cleanup抑制旧归属迟到结果。
- 选项使用 `recordId@revision` 区分准确历史版/当前版；只有实际原请求历史版与当前版不同时才显示历史确认，切换方案/请求或重读会撤销该确认。保存只在用户点击后调用原 `saveCaseStrategyChoice`，历史分支显式确认后才附 `allowHistorical:true`；当前版本保持原普通路径。
- `respondsToRequest` 仍从当前事项的准确requestId/revision派生，并同时匹配strategy Store/record/revision及原expectedPreviousChoiceId与当前选择链。显式切换事项时原请求focus仅在其issueId匹配时传入child；`IssueWork key={selected}`使另一事项取得独立局部状态。旧请求A不能在事项B中维持焦点或冒充B的回答；B的唯一准确请求可沿原单请求匹配回应。
- `planSelectionTouched` 防止原请求异步回读覆盖用户明确改选；拒绝的准确历史读取不暗换latest。新5项UI单测实际包含历史确认/切换复位、A→B、403、401/archived/错owner、当前版本普通回应及精确request/strategy断言。它是局部模拟renderer，不能冒充实际产品浏览器；真实Host/固定UI overlay验证由Root另一独立子审提供。
- 本次没有增加模型发送、模型读取审批、权限、会话生命周期、后台operation或业务完成权威。新React状态只表示本屏选择/历史确认；原后端 `checkPlan`、`assertStrategyChoiceTarget`、CAS及准确业务回应保存仍作最终权威。

## 测试适配没有削弱原失败/UNKNOWN保护

已读取原final的 `fullcheck-failures-review.md`，并独立核对两个测试的完整patch及patch后的原断言：

1. **FR03** 只把异步 `CaseIssueService.saveDecisionRequest` 的同步 `assert.throws` 换为 `await assert.rejects`。输入和预期错误码 **project_not_linked** 均原样保留；同步CaseStore的其它throws断言未替换。没有把拒绝改成成功、无条件catch或跳过。
2. **CNR-A4** 杀Host前只捕获本fixture实际子SDK driver的PID及Linux `/proc/<pid>/stat` startTicks；杀Host后接受原ESRCH，或**原同PID、非空且相同startTicks、当前Z**的精确已退出writer。不是看见任意zombie就通过；复用PID/非Z/缺身份不满足，非Linux仍只接受ESRCH，ENOENT竞态继续等待。stat索引对应state字段3与starttime字段22。
3. driver等待仍为原 **5000ms**，未加sleep/延长超时、额外杀driver或跳过。只证明原native writer退出后才冻结字节，并额外保存driverIdentities/driverRetirement；`proof`仍明确 **driver exit only; unrelated tool cleanup remains unproved**。
4. 原后续业务断言均保留：interrupted及`host_restarted_before_confirmed_completion`、持续waiting/`legacy_cleanup_unknown`、preview/新请求409 `review_transition_pending`、no-op stop不能证明清理、Provider无重放、旧native/设置/原报告/输入字节保全。该环境适配不把UNKNOWN或未证后代清理改成完成。

本次未在隔离树执行完整包检查：它的deps符号链接与工程物理包路径核验条件不同。Root将于原final物理依赖工作树对实际交付候选执行完整check及准确CI；当前报告没有把未执行的检查写成PASS。

## 原 Runtime 证据适用范围

本人实际 `git diff --exit-code 6bc..2eb --` 核对 server、case-issues/store、strategy-discussion-host、公共agent-sessions、Case目录、整个src/agent、package/lock及scripts **无差异**。因此原 `runtime-release-review.md` 绑定6bc的以下结论继续适用：真实owner/来源、取消及COMMIT前捕获配置资格、SDK1.4.0/Interface v3、并行总revision和实体CAS、新旧operation回放、Plan异步资格取消/配置失效窗口、原库保全；原be1/a571各次真实Pi证据仍保持原准确SHA边界。**没有宣称这些运行已全部在2eb重跑。**

四原则对这次增量仍通过：Host沿原读取/保存资格管环境；Agent执行机制未变；历史读取、选择及回执复用原业务/Pi底座；普通当前选择不加确认，只有主动选用已更新的原历史方案时才保留必要明确确认。原全量FAIL、UNKNOWN、平台限制与CI/部署/用户产品验收继续分别记录。
