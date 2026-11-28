# Decision Case 试用后续：观察恢复与首次使用修正

v1.0 · 2026-11-28 · PM Codex 核实与外发依据；只准备规格/证据，尚未修复产品。

## 1. 目标、基准与授权

用户提交《试用反馈交接单.md》《试用记录.md》，明确要求复核发现，属实后创建外发 Issue。本包固定已证缺口及准确边界，供一位领取方整单实施；不将试用 Agent 的推测直接作为修复方案。

- 最新 main：`74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`，tree `a4c3ef782943692cdbc3bc4f5e6298610f1502dd`；领取/集成时重核最新主线。
- 报告记载 Mac 实际运行：`1fd351f74df6e1113e6bda3c136144975c35febd`、tree `d51ff4e50158ea846cb3b98bd6ce123a8f5f3872`、builtAt `2026-11-28T03:43:07.952Z`、dirty=false。PM本轮未连接Mac；仅取得两份Markdown，没有其中引用的74张原截图或native日志。该运行版本包含PR #152；与当前main仅差规范文档，不能将问题归因于未更新。
- PM独立比较现有诊断源根64a808a与main：1,296个产品/测试/依赖输入逐字节相同。诊断使用实际App/Host、官方Pi1.4.0、Node25.9.0、Chromium；仅隔离合成数据及本地合成Provider，不是GLM真实模型或Mac现场复跑。
- 原视觉/业务基准：[冻结Demo](../decision-case-daily-workspace/demo.html)、[原spec](../decision-case-daily-workspace/spec.md) DW01–18及§4、[用户确认的实际产品图](../decision-case-daily-workspace/evidence/ui-conformance/product-g/README.md)。图库README保留生成时的待确认快照；实际后续状态见[用户明确确认回执](https://github.com/gadfly-hbo/OptraCall/issues/149#issuecomment-7232617547)及[PR#152/最终结案](https://github.com/gadfly-hbo/OptraCall/issues/149#issuecomment-7233217870)，不能从旧快照推断当前未确认。Demo冻结提交5f15cf3，SHA256 `adff576ba604b35b95806ab6a5c0f7bf93de5f0124c1ce0540e14577572bf911`。
- 沿[工程规范v1.17](../../../docs/engineering-workflow.md)、[统一会话接入](../../../docs/agent-session-integration.md) IN01–07/Interface v3。本文是原确认功能的缺陷/说明修正，不授权全页重设计、新权限、自动业务动作或依赖升级。

## 2. 本轮核实与修复合同

### CF01：Case观察流正常EOF后的只读恢复（P1）

实际Case普通对话2/2、带推理与每轮6次被拒工具调用的对话2/2均正常完成。另在浏览器将原Case观察SSE控制为“真实合法初始idle snapshot后正常EOF”，再由实际Host/SDK/合成Provider运行普通消息：后端completed/busy=false/idle，5秒观察时UI仍显示“正在回复…”与停止；点停止返回stopped=false并读回全文，原运行仍completed。此为独立已证恢复缺口；没有证明Mac当时也发生EOF，也未复现原7.5分钟时长。

定位：`strategy-discussion-client.ts:50–55`正常done直接break，无恢复；`BusinessRoleConversation.tsx:173–208`普通消息依赖事件load，有限receipt回读只覆盖带keep的外部请求。

要求：观察层对clean EOF、读异常、无字节/漏终态等情况有限时间发现并只读核对准确owner/request；恢复全文和权威终态，或准确显示未恢复。不得通过自动stop/open/messages、重发、伪造idle或改写completed为cancelled解决；切事项/卸载清理订阅、计时器和迟到读结果。保留正常流式显示和推理/工具过程；共享business-role观察消费者（含Case、goal-draft及既有战略/目标/Project角色）和第三合成消费者按真实影响回归，不因Case修复改变其它owner/profile的取消、历史或恢复合同。

### CF02：任务观察首帧期限与安全诊断（P2）

实际Case→准备Plan Task→创建(type=plan)→首条消息→SDK完成通过；普通新Task约84ms收到合法空snapshot。受控四次stream.error/EOF后GET均idle，UI保持禁发；恢复原SSE再显式重连后发送恢复、草稿完整，未自动open/messages/stop。因此未证“新Task普遍不能首发”或“有效重连后必然禁发”。新任务首发前sessions为空是原设计。

独立已证：产品observeTask的字节空闲看门狗会被comment心跳重置，但没有首个有效snapshot的独立期限；受控只有心跳无snapshot可持续connecting。server首帧读取失败仅通用stream.error，客户端最终泛化提示也缺少可定位的安全类别。

要求：即使心跳持续，无有效同owner首帧仍须在明确有限期限内退出无解释等待，保留可公开的失败类别；区分HTTP/解析/owner/首帧读取/EOF等适用原因，不能泄露路径、凭据或原始业务内容。正常与失效配置、新/旧任务、Case Plan/普通任务均覆盖。持续故障不假报连接成功；仅GET idle不解除原connected门禁。合法snapshot恢复后显式重连应恢复发送资格和原草稿；不提前创建native、不暗启SDK资源、不重发业务。Mac原自然首帧失败原因继续待核，不据此宣称已定位/修复全部现场问题。

### CF03：无本轮方案的取舍空态与原路径引导（P1）

实际新Case无kind=strategy记录时，取舍弹窗只有“选择方案版本”，填理由仍禁用保存，未解释缺少什么或提供下一步。既有准确项目下“准备Plan Task”可打开原事项Plan创建弹窗；本轮另有正常Plan首发证据，尚未完整跑通Plan产出→交回事项→取舍，领取方必须补全此链。

要求：说明缺少的是本事项可取舍的准确方案版本，保留理由/下一步草稿，并把用户引到现有准确事项的Plan准备/原回复接回路径；无项目时说明并提供原项目关联/创建路径。真实准确方案就绪后可选择、保存并更新本轮及历史。取消/往返不丢输入或串事项。

**不得将goalBinding.strategy复制成Case内方案作为“修复”。** G/S目标策略与strategyRef方案是不同原对象；不得伪造Plan、自动采纳/授权，或默认扩展CaseAgent写strategy权限。若拟新增直接保存方案等业务能力，先由PM补必要契约/设计决定，当前不在已授权实现范围内。保持已确认整页/侧栏/四tab/同页弹窗结构，沿原入口作局部说明修正；需实质改版时先提交受影响Demo确认。

### CF04：请求工具目标合同与可纠正错误说明（P2）

本轮经CaseAgent owner→官方Pi→合成Provider工具调用→Host，合法choose/observe各保存revision1，首页pending均为1。无行动空Case的observe缺target/缺内部身份分别可得到invalid_case_decision_request和invalid_case_decision_id，即使完全未带requestId；因此不能把后一错误码专指requestId，也不能要求无原授权的observe任意成功。

实际下发schema的target仅任意键object，缺choose/observe字段结构、新建requestId省略、修订及null/CAS/原反馈基线说明；错误只有通用码。此说明/诊断缺口成立，不是请求存储故障。

要求：补清两类准确target、沿原只读记录获得身份的方式、新建/修订语义及安全字段定位；沿原授权/来源/owner校验，不新增请求权威、伪造ID/授权/原消息。没有准确方案或原行动时说明前置条件、保留原输入，不反复猜ID。有效保存与首页派生保持；错事项/旧授权/旧反馈基线/来源不足继续拒绝，保留分页/partial与操作回执、CAS、UNKNOWN。采用原Pi工具schema/描述与最小Host适配，不编码分析方法或新增固定内部推理步骤。

### CF05：准备页必填错误与恢复动作一致（P1）

生产React组件独立探针：其余字段完整、个人归属名称空/空白时，本地校验普通Error被caseError泛化为“本地服务暂时不可用”，并提示使用不存在的“核对原操作并继续”。没有Goal/Create POST或真实HTTP503；仅草稿持久保存。补全姓名后可到Goal API。

要求：确定的本地字段错误指明“个人归属名称”等准确缺失项并提供关联/焦点，保留输入，未有效前不发候选/采纳/Case创建写请求。区分本地校验、4xx、确定失败、部分成功与UNKNOWN。提示提到的按钮必须存在且对应原动作；“重试保存草稿”不能冒充重试创建。保留已发生采纳/创建回执，按原operation查询恢复，不重复采纳/创建。

定位：`CasePreparation.tsx:253,294,358–366`、`CaseDialogs.tsx:15`。

### CF06：创建后直接返回的Case总览失效（P2）

完整App/实际Host：总览先2个Case→从准备UI创建新Case及第一事项→待事务完全收尾→点“返回工作台·保留草稿”。API已有3个，UI仍2个且新Case不可见；返回前后Case列表GET计数6→6。手动刷新后出现新Case。不是所有返回路径都已证失败；进入新Case的openHomeCase存在seq刷新路径。

要求：按准确创建结果使已挂载总览失效/重读；三创建/继续分支、直接返回、先进入详情再返回、首页准备后去总览分别验证。无需手动刷新、唯一新Case可见，保留搜索/筛选/来源和草稿；纯继续不重复建案，部分成功准确表达。读取失败时标清旧快照/未恢复，不伪称列表已最新。

定位：`App.tsx:1293`、`CaseBoard.tsx:155–182`及`openHomeCase`。

### CF07：归档/恢复动作的可访问名称（P2）

多个项目的菜单触发器有项目名，但动作button的AX名称仅“归档项目”/“恢复项目”。按所属项目行准确操作时实际API命中正确ID；没有证据说明产品把A归档请求发给B。试用Agent的全局文字选择误点不作为产品身份/权限漏洞。

要求：动作可访问名称能区分所属项目，沿原ID闭包、空闲准入和归档写保护；保留键盘/Esc/焦点，按项目A操作仅作用A，不改变B及其任务/文件/Case。无需额外增加正常流程确认。

定位：`ProjectNavigation.tsx:15`、`App.tsx:728–733`。

## 3. 排除错误预期、保留待核

- 原问题07：共享为**单一项目关联>1个Case**，不是≥1。生产与冻结Demo一致；两个项目各关联同一Case时共享0，再给项目A加第二Case即共享1。不要更改阈值来迎合报告。
- 原问题09：同一项目archive/restore均200，恢复横幅即时更新，旧归档文本0、archivedAt=null。未复现原陈旧横幅；若后续有原现场，须区分globalNotice/任务归档条/项目只读提示、同项目ID和请求时序。正常通过不否认原报告，但本单不按“恢复必现不更新”修复。
- 原问题02“首页永远0”、原问题03“点停止一定改取消”、原问题04“空sessions证明初始化失败”等说法不采纳。保留原报告及本次反例。
- 原Mac的03/04自然诱因、74张截图/native原始六次参数、GLM协议/质量未重新验证；不因本轮受控复现宣称Mac自然根因已证明。设备复测由用户另行安排。

## 4. 范围、责任与四原则

允许的最小相关路径：`src/host/ui/strategy-discussion-client.ts`、`BusinessRoleConversation.tsx`、`runtime-client.ts`、`CaseIssuePanel.tsx`、`CasePreparation.tsx`、`CaseDialogs.tsx`、`CaseBoard.tsx`、`ProjectNavigation.tsx`及必要的`App.tsx`接缝；`src/agent/strategy-discussion.ts`、`src/host/strategy-discussion-host.ts`、`case-decision-validation.ts`/原错误映射、`server.ts`仅限观察错误/既有工具合同安全诊断；相应原业务接口消费者、测试和本目录记录。先确认真实调用链，未涉及路径不顺手修改。

一位领取方整单负责；多个切片共用App/观察接入时必须先明确唯一写入者。Host/Agent接缝按IN01–07与PM Codex协调，Codex领取可整单承担。只允许隔离合成验证；不读用户Mac/真实业务/凭据、不调用付费Provider、不部署或切换服务、不升级/改造官方Pi1.4.0/依赖/锁文件。

Host保留身份、权限、观察、状态及输入环境责任，不替Agent造方案/判断；Agent沿原工具自主执行，不加入固定分析流水线。复用原Pi、业务权威、草稿、operation/CAS/历史；不新建Runtime、对话循环或第二套请求完成库。通过准确错误、正常入口与自动列表刷新减少操作，不自动代作业务采纳/授权。

## 5. 验证与交回

逐项先保留可检测本缺口的RED/因果证据，再最小修复及永久回归。CF01/02须真实Host/官方Pi/合成Provider及实际产品浏览器，正常和受控异常分开；CF03–07按实际入口补全准确方案/原Plan接回、字段错误、三分支返回、辅助范围/草稿、旧版本、跨owner/迟到、CAS/UNKNOWN与归档负例。按最终影响运行完整适用检查、原边界/正式build及既有CI，保留失败/跳过/未验证。

领取者编码前必须用浏览器实际看冻结Demo和原产品布局，留下阅读与映射回执；不能只读spec/guide/hash/innerText。完整候选（含新增/未提交文件）由非作者按冻结Demo、原spec、本spec、任务逐项复核并核四原则。**开PR（含draft）前，PM向用户展示该候选真实产品截图并取得明确确认**，不沿用上轮图或确认。分支提交/推送可先行；交回后停止写入，PM审核/实际head CI/获授权合并/main CI后结案。实质改UI先补受影响Demo确认，设备采用不列工程关闭条件。
