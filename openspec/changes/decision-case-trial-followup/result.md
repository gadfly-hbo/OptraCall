# PM 核实与发单准备结果

2026-11-28 · 当前只完成核实和修正规格/任务/公开证据准备，未修复产品、未运行新候选CI、未请求本轮产品截图确认或合并。用户授权为“读取两份试用材料，复核问题，属实则创建外发Issue”。本包不追溯改写#149/PR#152的历史工程、UI确认或后续用户试用结果。图库及旧补修文档含生成时“待确认/待PR”快照，后续实际确认/交付分别按[用户确认回执](https://github.com/gadfly-hbo/OptraCall/issues/149#issuecomment-7232617547)与[最终结案](https://github.com/gadfly-hbo/OptraCall/issues/149#issuecomment-7233217870)核定，不把旧快照误作当前状态。

## 1. 输入与方法

- 原文件为用户上传的《试用反馈交接单.md》《试用记录.md》，固定摘要见[输入清单](evidence/input-manifest.json)。其中指向Mac本机的74张图片及native日志没有上传；PM没有把这些路径当作已查看/已上传证据，也未访问Mac。外发范围由当前源/本轮隔离实跑核定，不直接采用报告的原因推测或建议修法。
- main7403091只比报告运行1fd351f多规范文档；实际产品相同。主源工作树7403091与诊断依赖源64a808a的1296个产品/测试/依赖文件逐字节相同。源码/长期测试/规范/SDK未在诊断中修改。
- 三个分工审计均读原规范/冻结合同并只写各自隔离根：contracts、runtime、ui-state。使用官方Pi1.4.0、Node25.9.0、实际createHost、React/原CSS及Chromium；仅合成数据/本地合成Provider。contracts合法模型工具走Case owner→Pi→Host，预置方案/授权只作明确标记的前置夹具，不冒称自然生成；ui-state完整App前端从740源码编译、后端从等价64a导入。runtime诊断build stamp为全零commit/tree、dirty=true、diagnostic版本，明确不代表发布构建；实际源按64a及文件摘要追溯。
- [本轮原图与哈希](evidence/image-manifest.json)中除05为实际React组件+HTTP替身且无生产CSS之外，均为本轮实际App/Host的隔离合成截图；不是Mac原截图、不是冻结Demo或修改后效果图，不作为修复验收。05只证明校验/提示逻辑，不证明整页视觉。
- 原诊断脚本/HTTP/事件/native合成记录/详细报告留于本次获准工作区`.local/trial-feedback-review/{contracts,runtime,ui-state}`；未将数据库、配置、凭据、bundle或原用户会话放入公开包。元数据/定位器/临时路径/探针编码错误均原样保留并单列，不算产品RED。各自Host/浏览器已关闭。

## 2. 报告九项逐项核实

| 原条目 | PM结论及本轮证据 | 本单处理 |
| --- | --- | --- |
| 01 新Case取舍无方案 | 实际modal只有占位、填理由仍禁用，无前置条件/继续入口说明。[原图](evidence/01-empty-choice.png)。原Plan准备入口在准确项目下可打开带Case/事项的任务弹窗。 | CF03修说明/原路径；不能自动复制G/S或默认新增CaseAgent写方案权限。 |
| 02 请求不能保存/首页永远0 | 实际Host/官方Pi/合成Provider中，合法choose与observe各保存rev1，首页各pending1。空Case无行动、缺target分别重现两种错误码，完全不带requestId也可有invalid_case_decision_id；不能逐一归因原六次请求。 | 否定存储普遍失效；只以CF04改已证tool target结构/新建修订/安全字段说明缺口。无授权必须拒绝，不造target。 |
| 03 完成后一直回复 | 普通2/2及带推理/每轮6次失败工具2/2均正常；受控合法初始snapshot后clean EOF，再正常发消息，实际后端completed/busy=false而5秒时UI仍等待。[等待](evidence/03-case-eof-waiting.png)/[回读后](evidence/03-case-after-readback.png)。点停止返回stopped=false，终态仍completed。 | CF01修独立已证EOF恢复；Mac自然根因和7.5分钟时长未重现，不能称已定位，更不能称停止必改取消。 |
| 04 新Plan Task不能首发 | 精确Case→准备Plan→创建→空idle snapshot→输入发送→SDK completed通过。受控四次stream.error/EOF后GETidle仍禁发；恢复有效SSE并显式重连后资格/草稿恢复。另产品客户端只心跳无首帧缺独立期限已证。 | CF02只修有界首帧与安全诊断；不称新Task普遍坏、不移除connected门禁。Mac自然失败原因仍待原证。 |
| 05 缺个人名称报服务故障 | 生产React独立组件：空/空白名称→本地Error变服务不可用，并引用不存在按钮；零Goal/Create POST/无真实503；补全后到达Goal API。[逻辑截图](evidence/05-component-missing-name.png)。 | CF05字段及恢复指引修正。 |
| 06 创建后总览不刷新 | 实际准备UI创建成功、事务收尾后直接返回：API3个、UI2个，list GET6→6；手动刷新才见新Case。[前](evidence/06-before-refresh.png)/[后](evidence/06-after-refresh.png)。先进入新Case是另一条seq刷新路径，本轮未冒称同样失败。 | CF06精确返回路径修复与其他分支回归。 |
| 07 共享0 | 冻结Demo及代码每项目关联>1Case才共享；两项目各关联同一Case共享0正确，再给项目A加第二Case共享1。[单Case](evidence/07-single-case-shared-zero.png)/[双Case](evidence/07-two-cases-shared-one.png)。 | 原预期不成立，不改阈值；未取得Mac关联全集，不杜撰其具体库状态。 |
| 08 同名归档/恢复误点 | 菜单summary含项目名，但button AX仅通用动作名，缺项目上下文。准确按项目A所属行操作，唯一API命中A并200。 | CF07可访问命名改善；不称产品错归档B、权限漏洞或数据损坏。试用Agent全局文字误选性质保留。 |
| 09 恢复横幅不更新 | 实际同项目archive/restore均200，恢复文本即时更新，旧归档文本0、archivedAt=null。[恢复图](evidence/09-after-restore.png)。 | 本轮未复现，保留原现场待核；不作为“恢复必现不更新”外发修复。 |

## 3. 实跑回执摘要与边界

- contracts：实际Pi工具10次合成Provider请求、0 Provider夹具错误；合法choose/observe各rev1+pending1；3张真实产品截图、原Plan创建弹窗可达，源1298项回读无变。其Plan执行/交回未覆盖，不称唯一绕行；runtime补首发，但完整Plan产出→交回→取舍仍是领取方T04验收。
- runtime：普通消息2轮、推理+6次失败工具消息2轮均自动完成。受控EOF、受控Task观察故障与显式恢复分别实跑；后者无自动open/messages/stop，只有用户输入产生原草稿PATCH。只心跳无首帧探针为产品observeTask+进程内Fetch替身，20ms空闲/5ms心跳下80ms人工结束仍connecting，不冒称自然Host或Mac复现。
- ui-state：完整App/Host最终探针exit0，零页面错误/外部请求；真实创建、共享0→1、按准确项目归档/恢复均有HTTP和UI状态互证。05另有生产组件负例/补全正例及后端纯校验对照。
- 普通路径PASS、受控故障FAIL、原报告自然观察、探针基础设施失败分别保留。没有真实GLM质量复测、原Mac日志逐条归因、完整DW01–18/所有权限/旧版本/多标签验收；不宣称完整用户验收。

## 4. 发单与后续

本包spec与tasks冻结本轮已证修正范围；一条整单任务统一管理共享App/观察接缝，避免多单重叠写入。已查当前开放工单：#77专业验证后续、#78 PPT局部UI与本单无重复；#149、#142、#131、#121均已工程关闭，提供历史合同/接缝参考，不是同一未完开放任务。按本次用户明确要求发布新试用修正单并关联#149，保留原结案和严重事故历史，不将新单当作改写旧验收或无授权第三次领取原冻结UI。

外发Issue须引用本包固定提交、最新main、冻结Demo及已确认产品图；明确真实证据边界及CF01–07验收。当前未创建本轮修复PR，未来实际产品截图仍须用户确认后才可开PR。
