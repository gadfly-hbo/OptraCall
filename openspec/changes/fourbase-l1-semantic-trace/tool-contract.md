# 最小工具合同（确认用，未实施）

v0.1 · 不新增持久schema；[D01–D08](structure-decisions.md)整体确认的一部分

## 只读：read_semantic_context

动作：`find` 按原名称／关键词查目录，`read` 按准确目标读取，`trace` 读取根目标的一层显式引用；继续展开由Agent自主再调用，不含Host多跳规划或隐藏自然语言抽取。

- 目标复用原生元组：SAP package/version/metric（附已知hash或明确未记录）、Enterprise store/material/revision、M2 project/dataset/inputVersion/descriptionRevision或citationId、M5 decision精确revision／choiceId、原M4/M6已允许的准确来源。它们是工具入参的组合，不是重编号的持久SemanticRef。
- `find`范围由Host注入当前项目、真实Case关联与原已授权目录；可请求具体已准入来源种类。不能从关键词扩根、枚举另一项目数据字节或扫描全部native。名称相同返回并列身份／scope，Agent判断是否需要澄清。
- `read/trace`必须给精确目标，禁止省略版本的latest解析。citation manifest返回其原selections/conceptRefs/sapRefs／报告附件及原保存声明，再交相应原权威读口；不发明直接SAP→Case关系。
- 可选`recordedBefore`要求有时区的ISO8601时点，表示合格原系统保存／发布／事件证据不晚于该时点（含边界）；不接受无时区日期并猜当天末。缺可信留存时点、导入时间含义不清或业务时间只有文本的项单列未知，不能当“不存在”。不返回完整历史知识快照的保证。
- 一页默认20个目录／关系项，调用者可请求1–100项；正文累计最多20,000 UTF-16。正文优先原精确片段，未提供部分明确标出位置和可继续读方式，不能摘要替原文。分页／片段是资源保护，不限制Agent总调用次数或分析步骤；continuation绑定原owner、查询与对象版本，变化报stale而非拼接成完整结果。
- 结果字段组：原目标／版次／可校验hash、原文或实际片段、显式关系与准确目标、原留存证据／业务时间原文／提供证据或作者引用声明、当前治理、来源状态与覆盖／续页／缺口。`createdAt/savedAt`等保留原字段含义；无值为null或未记录，不默认填now或“有效”。
- 来源状态应能区分available、missing、hash-conflict、forbidden、excluded／disabled、unknown及partial；不把技术错误当零命中。权限不足不返回不应可见的标题／正文／敏感路径；治理限制沿M4/M6原audience合同。

查看历史通过只读快照／原Store读口，不初始化Pi会话，不触发迁移、摘要／抽取、embedding或组件连接。正式状态按原权威，不给所有来源强加draft/validated/published枚举。结果只在本次调用／原native工具结果存在，无新缓存／索引权威或sidecar。

## 写入：record_analysis_sources

参数沿原 `CreateDataCitation`：operationId、citationId、baseIndexRevision、report、attachments、selections、conceptRefs、sapRefs、declaration及可选revisionReason／已可核nativeEvidence。真实projectId和`declarer='agent'`由当前资格绑定；工具不接受自造身份改变保存归属。所需技术ID从原对象／目录／M2 indexRevision取得，Agent可自行处理，用户不填机器字段。

只委托原 `createCitation`，同一M2版本检查／CAS／hash／路径／资源限额与固定证据机制；无新数据库／ledger。当前操作资格来自原ProjectAgent／公共生命周期，写前再次核任务、项目和取消状态；读到索引后并发变化按原CAS返回具体冲突，由Agent在原操作自行决定如何修正。

回执含原citationId／indexRevision及原replayed等真实结果，明确标“Agent作者声明”。工具调用native entry在SDK实际产生后保存；没有已可核的nativeEvidence则null，不能预造entry ID或从目录记录推导采用。

ACK不明不得返回成功，也不能擅自新建另一个operation；用原M2操作／索引读口核同operation结果。取消后如果原保存已经发生，真实已保存与本轮取消分别保留；迟到结果不能修改另一请求或触发下一轮。查询工具不可借trace触发写入。该工具不调用Provider、不冻结任意输入、不发布／启用SAP、不改企业资料或人的Case选择。

## 兼容／profile

新工具仅原普通project-tasks；禁止profile不会因为接口存在取得它。原用户HTTP／UI保存入口与schema2不变；无迁移、字段回填或新会话域。正式实现如果发现原M2操作查询不足，不得另造跨重启“恰好一次”系统：先在原Store最小读适配并按既有合同验证；若需新持久语义则补受影响决定。普通任务旧工具与未选择材料的行为保持。
