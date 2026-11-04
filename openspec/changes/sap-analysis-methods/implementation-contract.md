# 批准范围内的实施合同

2026-11-04 · v0.1 · D01–D08全部A确认后的技术闭合。仅将批准逻辑落实到实际消费者，不新增产品阶段／审批或分析流程。

## SAP方法结构与发布

既有`<dataRoot>/metric-assets`下增加同一SAP资产管理的`methods`业务namespace，两个来源共享；不建立IR专属根，不改旧`index.json`／SAP0.2指标包。方法内部格式显式schema版本；稳定UUID方法身份与确定正整数版次分开。

公开方法保存入口接受`requestId`、可选`methodId/baseVersion`、`title`、`content`（`conditions/logic/judgment/limits`可读正文组）、`sources`及必要`relation`。这些字段对应D02已批准信息组；正文不要求全填，但不允许只凭空标题创建记录。来源分类`ir/other`由实际创建入口产生，后续不变。

来源引用是`{type,label,ref,version,sha256}`，类型为session／memory／report／method／manual。引用指原权威的确定身份，不是客户端任意可读路径；未知版次／摘要为null，不猜补。IR必须有Host固定的准确Session源和内容SHA-256；相关来源只有明确声明且经实际读源资格核对才附入。

方法版本文件不可变；保存不发布。独立发布事实指向确定已保存版，发布时核内容身份；修订v2未发布时已发布v1保持。namespace内部采用原子索引与不可变操作回执实现CAS／幂等，同请求不同载荷冲突，不因创建回执不明重建另一ID；具体落盘细节由同业务Store封闭，不引入跨库事务平台。

编辑历史版时，relation.target记录用户明确选中的原版，baseVersion独立记录打开详情时看到的最新保存头，执行CAS；不能把正文漂到latest或把CAS降至历史版。列表query搜索最新保存版的名称、条件、逻辑、判断与局限，不混入历史版本正文；这属于人的管理视图，不扩大Agent已发布供给。

管理回读可查看未发布内容；统一供给回读仅限发布版本。已确认错误停止默认推荐，精确旧发布版本读取仍披露当前治理；纠正版也必须发布。普通Agent记忆规则保持。

## HTTP与UI消费者

全部沿现有单用户Host同源／`x-optracall-client`入口，无新认证系统或手填发布人字段。

| 入口 | 输入／结果 |
| --- | --- |
| GET `/api/sap/methods` | 来源、状态、query筛选；返回`{methods}` |
| GET `/api/sap/methods/operations/:requestId` | 仅回读准确请求的pending／committed事实及确定方法版；不重复保存或发布 |
| POST `/api/sap/methods` | 人工方法保存，Host固定other；返回实际save回执，不发布 |
| GET `/api/sap/methods/:id` | `{method}`含各确定版、发布事实、治理及selectedVersion |
| GET `/api/sap/methods/:id/versions/:version` | 人的准确历史版，入口不漂移latest |
| POST `/api/sap/methods/:id/versions` | baseVersion＋requestId及方法内容；保存为新的未发布确定版 |
| POST `/api/sap/methods/:id/publish` | 确定version＋requestId＋expectedSha256；仅发布，无模型调用 |
| POST `/api/sap/methods/:id/issues` | 疑似／确认问题、原因、准确受影响版与可选替代ref；沿治理CAS |
| GET `/api/sap/methods/:id/versions/:version/sources/:index` | 按已保存准确ref回原权威与当次固定材料；返回label/text/complete/limitation及可选独立governance，不接任意FS路径 |
| GET／POST `/api/projects/:p/tasks/:t/sap-method-extractions` | GET仅列历史；POST requestId＋incomplete显式意图，202返回`{extraction}` |
| GET／POST stop `…/sap-method-extractions/:requestId[/stop]` | 准确本源owner的状态／取消；不重跑原任务 |

提炼结果状态为running／saved／reused／empty／failed／cancelled／unknown，实际methodId/version仅在保存或准确复用核实后显示。状态记录是业务回执，不是另一运行资格台账；实际busy／取消／关闭始终投影公共会话域。

Host参数`--disable-sap-methods`／构造选项`sapMethodsEnabled:false`用于同程序兼容停用：拒绝新保存、发布、治理写入和提取，不向Agent供给新方法；已有方法／版本／回执／来源仍可准确查看。不恢复旧数据副本，不让未认识该种类的旧程序导入新结构。当前Store按一个Host管理一个数据根的同步模型工作，不声明多Host并发写能力。

## 附属资源与来源读取

Host静态`createSapMethodSessions`以`source projectId/taskId + extractionId + capturedConfiguration`作内部owner，沿Interface v3注册`sap-method-extraction`，独立原生目录。来源任务配置在开始时捕获，配置清除／归档／退出纳入原关闭和占用协调，不续聊原`sessionFile`或修改原任务指针。

在既有Pi资源加载及worker IPC内增加`source-reader`最小业务能力：不加载执行扩展／skills／MCP／上下文文件或任意原生执行／FS工具，只提供一个获准来源查读工具，支持catalog、准确Session分页、记忆find/read及已发布SAP方法find/read。Agent自主选择顺序和内容；这不是IR检索系统，记忆与方法委托原reader／SAP统一资产入口。

源Session仍用原SDK快照安全读取和50MiB等已有预算，固定截止位置、内容身份及来源完整性；超限或失读明确未完成，不静默截断。必要只读提取材料随本次附属资源保留供追溯，不构成第二Session／记忆权威。工具结果可能含未核实历史文本，只作为来源，不升级为系统指令。

记忆／方法来源归档原reader的准确target、range／分页输入和当次元信息，连同固定材料摘要；模型可见工具正文中同时给出可声明的准确source ref。历史预览重新通过原reader核当前权限和治理；失效／排除／仅元信息时不重新提供旧正文，原固定文件及引用保留。后续纠正／问题单列当前治理，不替换旧正文，不回落latest。源Session当前身份变化或失读时单列限制，固定分支原文保持。人的预览最多30,000 UTF-16字符并明确局部范围，不作为Agent全文覆盖证据。

Agent输出method／reuse／none业务结果，在公共lease内由Host校验来源与当前owner，再通过同SAP入口另存未发布版或准确关联；不根据HTTP200、模型完成文本或source工具read次数假定已保存。异常格式、取消、归属变化或资源关闭失败保留失败／UNKNOWN，不自动重放模型或发布。

新Host注册文件需要会话边界检查新增精确`src/host/sap-method-sessions.ts` registrar条目，附正向及绕过反例测试；不开放任意模块SDK构造，也不为新测试增加ProjectAgent直接构造例外。Interface v3公共类型／SDK版本不因本增量升级。

实际缺口：原`SessionFilter`仅表达project/provider，无法表达同任务的多个提取owner及失败retirement。公共域Host只读`busyInScope`因此增加可选owner谓词，与原filter联合，沿原operation/opening/resource/closingResources统一投影；仅新Host facade的`busyForTask`消费，不进入业务Port／worker／JSON，不维护第二owner台账。关闭失败的公共busy残留即使业务promise已结算也阻止同task新提取，同项目其他task仍可用。停止先核真实project/task并撤精确公共owner资格，再等业务回执；写回前在异步读记录后重核lease。业务promise集合仅用于结算/退出等待，等待不持业务mutation gate，归档关闭不在该gate内等业务flush。

## 验证边界

沿已批准SAM06–SAM14公共边界：Store真实保存重开及不可变发布；公开HTTP资格与输入输出；公共域／真实Pi SDK＋loopback合成Provider／来源工具／取消及配置关闭；产品UI与准确来源查看。各切片必须有真正可触发目标缺陷的RED，再最小实现，最后跑完整适用检查和新非作者复核。Mock／预置Demo只代表相应局部范围，真实模型专业效果、Git／CI及运行采用另证。
