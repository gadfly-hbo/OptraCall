# M3复用与缺口核查

2026-11-03 · 只读源码／固定材料核对；不是组件采用、召回质量或产品验收。

## 固定范围

当前HEAD `0f8ee5b`加已验证M2本地候选；图谱`optracall-m2-verified-candidate-20261103`可用，已定位但图谱未覆盖的类型／闭包／固定上游缓存按真实路径补读。产品247份source／test／script与M2固定检查一致，未读真实dataRoot或凭据，未安装／加载组件或调用模型。

主方案v1.2与原[Pi研究](../personal-assets-phase01/agent-memory-research.md)保持不变。本次只核M3需要的差额，不重做21域全产品盘点，也不把M1的49项或M2的939项当M3新能力测试。

## 产品能力对照

| 已有能力／权威 | 本次核到的事实与入口 | 对M3的意义 |
| --- | --- | --- |
| Enterprise原资料 | [字段](../../../src/host/enterprise-materials-types.ts)、[Store](../../../src/host/enterprise-materials-store.ts)已有title/body/source/owner/scope/effectiveTime、附件、draft、revision、hash及启停 | 复用正文／原件及版本，不另造编辑器、正文库或修订引擎。缺个人保留、独立归档及多来源关系 |
| 正文固化与启用 | `enable`会新增revision并设enabled／active；`readRevision`可读精确disabled旧稿；`referenceIndex`只读元信息 | 不能将enable重命名为保留。需最小freezeExact，保持原schema1并不切启用状态 |
| 目录可见性 | `catalog`对enabled资料导出其全部revision，不只activeRevision | 新整理先独立disabled；若用户另行启用，后续revision也会目录可见。个人归档不承诺撤回源资料／私有隔离 |
| 现有资料UI | [EnterpriseMaterialsPage](../../../src/host/ui/EnterpriseMaterialsPage.tsx)已有草稿、启停、历史与正文；当前筛选以title/category/scope为主 | 复用编辑能力；M3仅扩个人分类／别名／保留入口与聚合查找，不以已有筛选冒称完整正文／别名召回 |
| M2固定成果 | [createCitation/readCitationEvidence](../../../src/host/project-data-context-store.ts)保存明确报告、附件字节与refs，精确回读 | M3引用`projectId/citationId`及明确报告／附件。不重复固定同稿，也不绕私有证据路径 |
| 原生准确回复 | [readSavedTaskReply](../../../src/host/project-history.ts)按真实project/task/sessionId/messageId读assistant文本，不开Agent | 复用原生历史；保留时核全文SHA／可选片段，不搬完整JSONL，不把M2 nativeEvidence当已具全文hash的同一合同 |
| 反馈修订 | [Board Store](../../../extensions/business-plugins/decision-board/storage/store.ts)已有追加revision、CAS／operation；Host已有真实Project关联核对 | 直接引用反馈revision，避免重建反馈库。不能用task/item updatedAt冒充旧正文 |
| 现有交接 | [decision-feedback-routes](../../../src/host/decision-feedback-routes.ts)已有准确回复／文件预览及源读取；当前handoff仍绑定原sourceProjectId并核feedbackOrigin | 可抽取已有只读原语，不能为复用而调用创建需求／handoff并产生副作用。任意跨项目消费留M4，不写成已支持 |
| Case／Board当前行 | [CaseStore](../../../src/host/case-store.ts)读取当前行；未见按任意Case revision读完整正文的入口 | 历史决定用固定报告或反馈revision，不为统一来源枚举预建Case快照 |
| Pi运行与检索 | [project-session](../../../src/agent/project-session.ts)原生会话／资源加载及grep/read/find等已有；固定SDK1.4.0 | 直接复用历史、工具与生命周期；M3不新增memory会话／SDK循环，用户查找不调用Agent |
| 规划能力目录 | 现有Catalog含规划／虚构示例，不是用户个人资产集合 | 个人查找须投影真实资料、M2明确概念ref和项目数据登记；空库显示空态 |

M2 citation读取会验证报告、全部附件及绑定数据／说明；任一缺失可能使整条读取不可用。M3只能按权威报缺失／不可用，不能回落当前同名报告或偷读内层路径。原资料`list()`会刷新派生catalog，不能把所有原入口笼统称零写入；新个人浏览优先元信息投影与精确按需读取。

## 已固定记忆组件

| 候选 | 已核事实 | 本期选择与限制 |
| --- | --- | --- |
| Pi 1.4.0原生 | 会话树、分支、恢复、压缩及原生文件工具已接入 | 直接复用；这些不自动代表人的长期保留或业务可信度 |
| pi-memory 0.4.2，固定`1e276a7…` | `EXIT_SUMMARY=0`只关闭退出摘要；session_start仍探测／可能配置qmd；before_compact仍写交接；默认正文注入不能由关闭搜索开关推定关闭；memory_search连keyword模式也依赖qmd | 未安装／加载。借鉴文件组织，不将其默认全量行为引入M3。不能说已证明兼容或完全无副作用 |
| pi-memory-md 0.1.38，固定`3002f4e…` | 缓存有入口／package，入口依赖的hooks、Git、recall、tools等实现未全部缓存 | 保留候选；不能只凭入口配置声明“同步／默认注入已安全关闭”或精确历史读回已验证，也不据此判“不兼容” |
| qmd／Mem0等 | 原研究已记录召回与外部模型／索引成本；本期尚无原生关键词／别名基线不足的运行证据 | 不引入新搜索／模型服务；真实不足后再做有共同基线的增量评估 |

两份本地固定入口重新核对：`.local/agent-memory-research/root-sources/pi-memory-index.ts` SHA-256 `535a7ce239c80244c7853ed4da093d0a3c176a37af96aea10746a66a12faedaf`；`pi-memory-md-index.ts` SHA-256 `f359784cda49f3e6f523cc8ee04e216ae9f28eb5a6ab26f1555265afcd67e05a`。它们只是固定源码证据，不代表发布包包含性、加载兼容或实际副作用开关验证。

## 设计收敛与待验证

推荐“Enterprise精确正文／revision＋个人引用／决定小文件＋真实聚合查找”。新个人字段、局部pending及UI都在[6项决定包](structure-decisions.md)待整体确认；不将本调查写成已经创建MemoryBase或采用第三方组件。

只读架构复核修正了一个部分成功缺口：若freeze正文后才首次写个人记录，同operationId可换分类／来源而无法证明原请求。候选现先保存完整局部intent再固化，最后发表保留决定；这只为本保留操作恢复，不建跨库事务平台。真正代码、故障注入、检索代表样本、profile兼容与用户体验均待确认后实施和验证。

当前明确未做：产品开发／schema写入、组件运行、真实中文召回质量、模型专业效果、Git／CI、安装／运行切换、MacBook及真实经营试点。
