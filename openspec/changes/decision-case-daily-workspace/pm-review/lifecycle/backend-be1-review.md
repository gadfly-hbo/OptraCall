# Issue #149 后端修后独立终审

- 完整固定候选：`be1fd36ad449d89d2fc21655ccbbb61cf8b6bdbf`；原终审候选 `7fe8e936d2463e514f2d8b08deae23f8c0467e24`；基线 `699e425cb0900b50385377d638495069fa726761`。
- **结论：原三个 P1 已独立重验关闭，但本候选仍不可合并。** 请求没有完整复用原回应入口的当前生命周期准入，方案归档、Case 关闭与项目归档后仍有不能回应的正式待处理，详见 FBE04。已按 Root 要求一次收敛同类边界，没有把仍合法的历史回应泛化为失败。
- 原 `backend-review.md`、原三个负例和 `backend/results.json` 完整保留。本次没有修改产品、测试、依赖、规格、原证据或进行 commit/push；只写 `.local/pm-final/` 探针／收据／报告。起始 HEAD 正确、工作树干净。本人未参与任一候选实现。

## 剩余必须修复

### FBE04 / P1 / DW08–09、DW16：请求未完整复用原回应的当前生命周期准入

- 位置：新增 `src/host/case-issues.ts:70–79` 的 `chooseRequestStatus` 和 `src/host/case-store.ts:873–879` 的请求保存资格只读取 `getDecision(caseId,recordId,原revision)`。合法归档追加了新修订，原准确旧版仍为 `active`；两处未核当前方案的 lifecycle。
- 原回应权威：`src/host/case-store.ts:935–943` 读取精确版和当前版，并在当前版 `archived` 时直接报 `case_decision_archived`，即使 `allowHistorical:true` 也不能回应。
- 独立真实 CaseStore + 原 service/home：
  1. 原 `acceptIssuePlan` 建立事项 A 的正式方案 rev1，再保存准确 choose 请求。
  2. 原 `reviseDecisionByUser(action:'archive')` 合法归档该方案，当前 rev2 为 archived，精确 rev1 保持 active。
  3. 既有请求仍显示 open 并进入首页 pending；还可以新保存另一个指向原 rev1 的请求，也为 open/pending。
  4. 原 `chooseStrategy` 传准确事项、策略、请求引用、选择链及 `allowHistorical:true`，仍报 `case_decision_archived`。这两个正式请求都不能按原业务保存动作完成。
- 收据：`backend/lifecycle-probe.mjs`、`backend/lifecycle-results.json`、`backend/lifecycle-output.jsonl`。这是产品正常归档写入口的真实反例；没有修改数据库或模拟旧记录。
- 验收：新建／修订取舍请求沿原当前方案生命周期准入，归档对象不能成为可回应目标；已有未答请求在方案归档后按实际状态显示待核或替代并退出正式 pending。保留准确历史引用及原已完成回执；恢复方案后可按原业务规则继续。不得通过允许原取舍选用已归档方案或覆盖历史来制造通过。

**同类生命周期已一次收敛：**

- **Case closed / choose：** be1 上，先建合法未答 choose 请求再原 `closeCase`，旧请求仍 open/pending；新请求保存与原 choose 均报 `case_closed`。应修投影，不需修改原写准入。
- **Project archived / observe：** 真实 ProjectStore 创建项目／原行动与两条准确观察请求，一条已答一条未答；原 `projects.archive` 后，原 Board feedback HTTP handler 对未答请求返回409 `project_archived`，Case request service（已传同一真实 projects/assertActive）仍能新建请求，两个未答均 open/pending。已答仍 answered。恢复原项目后原反馈 handler200。需复用原项目可写资格，不能靠放宽原反馈归档限制解决。
- 这两项的固定实证在 `backend/lifecycle-matrix-fixed-be1-results.json`／`lifecycle-matrix-fixed-be1-output.jsonl`。为避免与获 Root 授权的修复并发读到漂移源码，使用 `git archive be1fd36a src extensions` 提取到隔离 `backend/be1-snapshot/`，探针全部产品导入指向该精确快照。此前 `lifecycle-matrix-output.jsonl` 有修复进行中样本，**不是固定候选证据**，不得混作 be1 结果。

**实际仍合法或已经正确的边界，不能新增阻断：**

- Case closed＋Board task done，原 Board feedback handler仍200，准确引用会 answered；Board task只有todo/doing/done，没有archive字段。不能据 Case 或任务 done 禁止观察。
- active 策略更新为rev2后，原默认choose报 `case_decision_revision_conflict`，显式 `allowHistorical:true` 仍可准确回应rev1并 answered。不能把全部旧版一律当无效。
- 原显式 Board authorization revoke 和换 choice，已能让未答 superseded、新请求分别拒 `case_do_authorization_unavailable`／`case_choice_conflict`，已答仍 answered。此处不需新增权威或重写历史。
- 先准确回答 choose 再归档方案／关闭 Case，answered 保留；观察先准确回答再归档项目，answered 保留。新生命周期检查必须放在准确历史回应识别之后，来源撤权的可读保护仍沿原资格单独处理。

## 原三个 P1 的修后结果

独立探针由原 `backend/probe.mjs` 另存为 `backend/afterfix-probe.mjs`，仅适配新增 async 接口、明确断言修后错误／状态并补正常／恢复路径；没有覆盖原探针或反例。

| 原发现 | 修后因果复验 | 结论 |
| --- | --- | --- |
| FBE01 跨事项专属方案 | 原反例保存现拒 `case_issue_scope_mismatch`，无操作回执／无请求落盘；本事项正常请求 open，准确原选择回应后 answered。 | 原反例关闭。生命周期准入仍有 FBE04。 |
| FBE02 假反馈基线 | 原随机不存在基线保存现拒 `case_feedback_conflict`，无操作回执；旧坏基线投影 unverifiable；合法 null 基线请求由原反馈 CAS＋准确引用回应 answered；原保存重试仍核同一回执。 | 关闭。 |
| FBE03 确认来源撤权 | 真实 report-confirmation item 下，原 `assertBoardItemReadable` callback 撤权后，新保存拒绝；旧请求 unverifiable，首页不进入 pending；另一条同 Case 合法 manual 行动请求仍 open/pending；Case 保存／读取／首页调用原 gate 共3次。原 Board feedback/history 同时409。恢复原资格后旧请求回到 open，完成原操作重放仍只读。 | 关闭。 |

实际门禁仍由原注入 callback 抛403来表示撤权，并与真实 Board route 核对；未声称制造真实账号撤权或网络 HTTP。新 delta 已静态追到 `server.ts` 将同一 `conclusionHandoff.assertItemReadable` 注入首页、原 Case service 保存／读取；`CaseDecisionRoutes` 已 await 新异步读取。没有另建权限表／完成表。

## 新 delta 与保持正常的路径

- 重读 7fe→be1 的全部后端变化：Case 请求保存／读取、逐请求 home、CaseDirectory 分页、server 注入与原普通项目声明工具接缝。目录实现限制整行／事项数量并保留准确身份和显式后续 offset；本后端范围未发现新增目录阻塞。普通项目实际 Pi／配置／取消验证由 Runtime 独立审查，本文不据静态代码授予整链路 PASS。
- 独立复跑真实 GoalStore＋原 CaseRoutes：candidate 冒认采纳、不存在目标、虚构具体策略仍分别拒绝；正常候选明确采纳建 Case 有原回执；v2 采纳后，v1 原 Case 即使已结束仍能准确 continue，身份相同且未自动重开。
- 原 Case 编辑后，原 createOperationId＋原输入仍返回原不可变回执；同 operation 换成后来编辑文字仍 `operation_conflict`。原当前 Case 的编辑保留。
- 原 `case_transaction_outcome_unknown/503` 合同仍得到 `unknown/partial_unknown`，保留原意图。此项为生产错误类型的依赖注入，没有损坏磁盘／DB。
- 同根双 WorkspaceDraftStore 并发 CAS 仍一胜一409；非空正文追加保全、片段原文／来处、防重及跨事项拒绝仍正常。
- 再次独立验证 Board schema4 普通反馈→schema6 请求引用反馈→关闭重开→普通反馈→再次关闭重开，3条记录逐值保全。收据 `backend/afterfix-schema-results.json`。

## 命令与证据

使用现锁定依赖及 Node 25.9.0。没有启动 Host，与 Root 的完整 `npm run check` 分开，不把 Host 启动资源竞争当产品失败。

- `node .local/pm-final/backend/afterfix-probe.mjs`：exit0，8组输出；`backend/afterfix-results.json`、`backend/afterfix-probe-output.jsonl`。
- `node .local/pm-final/backend/lifecycle-probe.mjs`：exit0，确认 FBE04 的两个 open/pending 请求及原 `case_decision_archived` 拒绝，非 fixture 失败。
- `node .local/pm-final/backend/lifecycle-matrix-fixed-be1.mjs`：exit0，8组固定快照生命周期结果，覆盖上述缺口和合法历史边界。
- `node .local/pm-final/backend/afterfix-schema-probe.mjs`：exit0，schema4→6／两次重开／3值保全。
- `TMPDIR=$PWD/.local/pm-final/backend/tmp node --test tests/case-preparation-recovery.test.ts tests/case-declarations-second-review.test.ts tests/case-decision-requests.test.ts tests/workspace-daily-backend.test.ts tests/case-directory-pagination.test.ts`：**21/21 PASS**，`backend/afterfix-targeted-tests.log`。这些测试尚未覆盖 FBE04，不足以消除该实证缺陷。

## 四原则专项结论（本后端范围）

| 原则 | 结论与实际依据 |
| --- | --- |
| Host 管环境 | 原读取 gate、owner／CAS 和准确基线修复正确，但 FBE04 仍漏原当前方案生命周期，**不通过**。 |
| Agent 自主执行 | 本后端 delta 仅治理来源、目标身份、版本与保存，未见 Host 代作计算／分析方法或强制推理流程，**本范围通过**。 |
| 优先复用 Pi／既有权威 | async 读取用于复用原确认来源 gate；创建、选择、反馈和原不可变操作仍各用原 Store/route，无新增 Runtime 或平行完成权威，**本业务复用范围通过**。官方 SDK 实际包及整链路由 Runtime 审查。 |
| 减少人的操作 | 已关闭原三项，合法请求仍可原保存动作回应；FBE04 制造必须人工额外整理的不可回应待处理，**受缺陷影响不通过**。 |

本报告只对 be1 完整候选有效。Root 的全量检查、CI、用户产品验收、实际模型质量及设备采用另报；旧 FAIL 不因后续候选修复删除。FBE04 修复后须再固定并独立重验受影响范围。
