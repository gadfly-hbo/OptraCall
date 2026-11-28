# 任务目标与清单

目标：修复本包spec已证CF01–07，保留原业务权威、用户输入与已确认布局；不按错误预期更改G/S、共享或发送门禁。

- [x] T01 有效领取/回读；核最新main、独立工作树和唯一写入者；实际浏览冻结Demo/产品并在Issue记阅读、页面/状态、骨架和实现映射；盘点IN01–07/原工具/观察/恢复契约。（领取 `#issuecomment-7235350681`；Demo 阅读/DOM-CSS 映射/IN01–07 `#issuecomment-7235447476`；`implementation.md`）
- [x] T02 CF01：保留clean EOF确定复现，修复Case普通请求观察恢复；正常、thinking/工具错误、断流/漏终态/切owner及受影响共享business-role/第三合成消费者覆盖，不stop/open/messages重放。（含单次返工 FR01：`src/host/server.ts`、`src/host/ui/strategy-discussion-client.ts` `eventIdleTimeoutMs`、`src/host/ui/BusinessRoleConversation.tsx` 有界只读 `GET` 对账；`tests/case-trial-followup-fixes.test.ts` + `tests/browser-case-trial-followup.mjs` `CF01+CF04` & `FR01` + `tests/agent-sessions.test.ts`）
- [x] T03 CF02：保留有心跳无首帧复现，补有界首帧/安全错误诊断与显式重连；正常Case Plan首发及真实失联恢复均验证，不解除connected门禁、不提前开SDK。（`src/host/server.ts`、`src/host/ui/runtime-client.ts`；`tests/case-trial-followup-fixes.test.ts` + `tests/browser-case-trial-followup.mjs` `CF02` 含耗尽进 `disconnected` → 显式重连 → 真发完成）
- [x] T04 CF03：补无方案的说明和原Plan准备/接回路径，连到准确Case/事项；实际跑Plan→交回→取舍→历史及原授权/反馈入口回归，保留草稿；不自动物化G/S/造方案/扩写权限。（`src/host/ui/CaseBoard.tsx`、`src/host/ui/CaseIssuePanel.tsx`；`tests/case-trial-followup-fixes.test.ts` + `tests/browser-case-trial-followup.mjs` `CF03` 含授权/反馈/原记录/原方案/原看板反馈/历史弹窗全链路）
- [x] T05 CF04：补既有请求工具target/新建修订/null/CAS说明及字段级安全错误；合法choose/observe保存和首页派生通过，缺授权/错事项/旧基线拒绝，保留分页/UNKNOWN。（`src/agent/strategy-discussion.ts`、`src/agent/project-session.ts`、`src/host/strategy-discussion-host.ts`；`tests/case-trial-followup-fixes.test.ts` + `tests/browser-case-trial-followup.mjs` `CF01+CF04`）
- [x] T06 CF05：缺个人归属名等确定字段错误定位正确、动作提示一致；无业务误写，补正后正常，旧回执/部分成功/UNKNOWN不丢不重放。（`src/host/ui/CasePreparation.tsx`、`tests/case-preparation-ui.test.ts`、`tests/case-trial-followup-fixes.test.ts` + `tests/browser-case-trial-followup.mjs` `CF05`）
- [x] T07 CF06：创建后直接返回总览自动正确显示唯一Case，三个分支/不同来源/读取失败与筛选草稿回归，不靠手动刷新。（`src/host/ui/CaseBoard.tsx`、`src/host/ui/App.tsx`、`src/host/ui/CasePreparation.tsx`；`tests/case-trial-followup-fixes.test.ts` + `tests/browser-case-trial-followup.mjs` `CF06`）
- [x] T08 CF07：归档/恢复动作AX名称含可区分项目上下文，原ID/准入/只读语义和键盘焦点保留，作用域正确。（`src/host/ui/ProjectNavigation.tsx`、`src/host/ui/ProjectBoard.tsx`；`tests/case-trial-followup-fixes.test.ts` + `tests/browser-case-trial-followup.mjs` `CF07`）
- [x] T09 固定完整候选；适用完整检查、真实Host/SDK/浏览器、非作者逐项及四原则复核；FAIL/SKIP/UNKNOWN和原Mac未核边界不抹去；补当前结果与兼容回退，推任务分支回读SHA并在同Issue交回PM，停止写入。（单次返工完整 524 测试文件 3694 项 / `0` 失败 / `0` 取消 + `build` + `check:agent-sessions` + `audit` + 浏览器 E2E 7/7 + 全新第二轮独立只读复核 `1c9c303711cf8d2eb3193c3e1d12a38c` PASS，详见 `implementation.md` 与 `verification/second-review.md`）
- [ ] T10 PM审核集成最新main；展示新候选真实产品截图获用户明确确认后开PR；核实际head CI、获授权合并及main push CI；补结案回执。设备采用/真实模型质量另核。

T01–T09 已由领取方完成单次返工、全量清洁去重验证、第二轮全新独立非作者复核及 `implementation.md`/`verification/second-review.md` 归档，停止写入并交回 PM 二审；T10（向用户展示新候选真实产品截图并取得明确确认后开 PR、核对 CI、合并与结案）留待 PM 执行。

PM二审追加：已接收3c2fb5f并直接完成剩余接修，没有第三次领取。T09当前候选依据更新为[PM最终记录](pm-final-review.md)及[最终非作者原文](verification/pm-final-independent/final-review.md)，原作者报告/首审及e72发现保留。实际生产截图候选为a643bf00（产品代码b88af4aa），本证据补充对产品/测试零漂移；T10仍未勾选，等待用户新图明确确认后才开PR并核实际CI/合并/main CI。
