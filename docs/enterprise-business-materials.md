# 企业业务资料：维护与接入

2026-10-31。依据为[已确认的五项结构决定](../openspec/changes/enterprise-business-context/structure-decisions.md)；实施及检查见[结果](../openspec/changes/enterprise-business-context/result.md)。沿用工程规范 IN01–IN07、Interface v1、`project-tasks` 原 owner，资料模块不拥有 Agent 生命周期。

## 正常使用

1. 分析资产 → 企业业务资料。编写正文或登记获准文件；来源、维护人、范围和业务生效时间未知可留空。保存工作稿不自动启用。
2. 明确启用后可选用固定修订；编辑新稿、启用新版和停用均不覆盖旧版。UTF-8 可显式导入正文，其他文件只登记，不能声称已经提取。
3. Case 详情可引用公共修订、补本案短说明，并沿用原入口关联项目文件。项目文件继续共享，020 优先展示；本案约定不自动成为企业规则。
4. 原任务的“本轮企业资料”是可展开辅助区。勾选后先提供来源定位，可明确改为全文或 UTF-16 半开区间 `[start,end)`。未选材料、没有 Case 也能直接提问并自主读取授权公共目录。
5. 最近请求与历史请求分别回看实际提供回执；旧回执读固定修订，不切换到当前版本。历史缺记录保留未知。资料提供、工具读取、Agent 声明采用和用户采用报告分别理解。

正文每份最多 1 MiB，显式来源文件每个最多 10 MiB；本轮选中正文与本案补充正文合计最多 20,000 UTF-16 字符，超限不自动截断。普通 Host 包含来源说明的合成输入最多 131,072 字符；用户问题仍最多 20,000，附属 fixed-draft 全文仍最多 20,000。库不可用时普通问题仍可发送，界面不补造来源。

## 接入合同

准确 TS 字段以 [`enterprise-materials-types.ts`](../src/host/enterprise-materials-types.ts) 为准。

| 入口 | 行为 |
| --- | --- |
| GET/POST `/api/enterprise-materials` | 列出资料索引／新建工作稿 |
| GET/PUT `/:materialId` | 读取完整资料／以 expectedVersion 修改工作稿 |
| POST `/:materialId/enable` | expectedVersion；默认从工作稿生成不可变新修订，也可显式 revisionId 重新启用历史修订 |
| POST `/:materialId/disable` | expectedVersion；停止新选择，保留旧字节 |
| POST `/:materialId/files` | expectedVersion、name、base64、可选 importText；不得提交宿主源路径 |
| GET `/:materialId/revisions/:revisionId` | 身份核对后读明确修订，允许停用后的历史回读 |
| GET `/:materialId/source-file/:fileId` | 核对实际源字节后下载登记原件 |
| GET/PUT `/api/cases/:caseId/enterprise-materials` | 原 Case 状态与版本核验；PUT 同时有 caseRevision 和 sidecar expectedRevision |
| GET `/api/projects/:projectId/tasks/:taskId/context-receipts` | 按已绑定原生会话只读投影历史回执，不创建 worker，不续跑或回写历史 |

资料路由失败为 `{error,message}`，原任务消息失败沿用 `{code,message}`；前端客户端兼容两者并显示受控服务端文案。新路由继续位于原 Host origin／client 校验之后，写操作复用原 mutate；不新增队列。

每次消息可选 `enterpriseMaterials`：`{storeId,materialId,revisionId,mode,start?,end?}[]`，mode 为 full/excerpt/location。选择按明确身份固定，excerpt 范围必须完整且不切断代理对；全文超限不能悄悄变片段。可选 `enterpriseCaseContext` 捕获两库身份、CaseId 和 sidecar revision，且必须同时选同一个原 Case 上下文。普通 task schema 不保存默认材料集合。

提供回执仍为原 `optracall.run` 中的 v1，新增可选 enterprise 子项记录目录位置、固定来源、正文指纹、实际范围、文本与时点。RAP／SAP／Case 原字段不重定义。原问题 `originalUserText` 是精确 HTTP 输入，仅用于在原生合成消息哈希匹配时改善读取投影；完整原生消息未被改写，可在 UI 展开。

库文件保存于 Host dataRoot 的 `enterprise-business-materials/`；测试全部使用隔离根。index 为权威元数据，catalog 为可重建的查找辅助，正文／原文件只追加；Case sidecar 同时绑定 CaseStore 与资料库身份。未知版本、损坏或身份不符准确报错，保留原字节，不用旧副本覆盖或自动重新绑定。

本增量不迁移旧 Case SQLite、项目 JSON、原生 JSONL 或 RAP/SAP 发布物；显式新消息只正常追加自己的原生记录。回退源码保留新资料根，旧功能仍按原数据读取；再次采用兼容代码后可继续读取新资料。没有自动物理删除或自动复制经营数据集，因此不能承诺历史完整复算。

Host 只提供资源、技术身份和记录，不判断业务口径胜负、挑数据列、算公式或安排分析顺序。真实模型效果、旧核算失败及运行采用的范围仍以本变更结果为准。
