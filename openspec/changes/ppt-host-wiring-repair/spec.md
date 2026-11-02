# PPT Host 接线修复

2026-11-02用户明确授权“你直接修复ppt功能接线，不要留着，授权你”。本变更修复 [上轮检查](../host-agent-boundary-governance/result.md#用户追加ppt-host-接线复查bg06) 的实际缺陷，沿用 [PPT 原规格](../ppt-report-extension/spec.md) 和已确认 D4–D8，不重建报告工厂或 Agent Runtime。

## 责任与范围

工程规范 v1.2、Interface v3、IN01–IN07。Host 静态 `ppt-refiner` profile，真实 owner 为现有 projectId + deckId；生成继续走普通项目任务，精修走原公共生命周期。Host负责实际项目／配置／文件权限、完整操作归属和技术保护；Agent自主选择分析与编辑方式。保留全部既有项目、deck、版本、会话、原件和原始FAIL现场；不重放旧任务、不自动换模型、不切换运行服务、不操作MacBook。

允许修改 PPT 插件的 api/session/storage/types/ui、Host接入与项目报告入口、必要的 Agent 模型能力只读适配、受影响测试、规范入口及本目录记录。授权本地修复、适用完整工程与合成路径检查、非作者独立复核、实际head CI及Git交付后合并main；本轮不调用真实Provider／业务资料，不安装或发布产品服务，不代替用户视觉／产品验收。

## 验收

| 标识 | 可观察结果 |
| --- | --- |
| PW01 | 从真实项目060_reports候选PPTX及同项目md报告显式进入精修；Host验证项目、来源、配置revision，不接受任意绝对路径或全局当前模型回退；无明确归属的旧deck保留可读，写入与模型执行拒绝并说明原因。 |
| PW02 | 公共profile声明真实projectId，项目归档的忙碌准入和匹配关闭包含精修；归档后无新增精修／回退／导出写入；不同project/deck继续隔离。 |
| PW03 | 副本、run、保护核对、快照提交处于同一公共operation；busy拒绝无文件副作用，锁定／回退／导出与活动改稿冲突时拒绝；取消、配置变化、迟到结果不复活或污染后续轮次。 |
| PW04 | 正常UI可停止并等待实际终态；failed/cancelled仍保留服务端部分成果／快照／诊断，读回版本和页图，展示与实际导出一致；导航不丢弃在途收尾。 |
| PW05 | guard执行／解析／恢复失败不报成功、不删除前态或失败现场；锁定与只读检查所需技术保护继续有效，恢复成功才记实际回滚；完整保护未核定时明确失败／未知并禁止正常成果导出。 |
| PW06 | Host推导本deck真实项目060_reports导出位置；已有PPTX或差异清单碰撞拒绝，原件／历史／别的项目／010和020不被覆盖；失败不虚报完整导出。 |
| PW07 | 连续修改及回退、恢复旧版本后，差异清单覆盖当前工件真实有效谱系；新记录保留父版本与当前版本，旧谱系缺失或外部未记录编辑明确披露未知，不猜成无差异。 |
| PW08 | 报告候选→精修入口、已有deck列表、运行中停止与失败恢复、视觉自检／模型不支持图像时的降级在合成浏览器路径核对；不要求用户手填绝对路径，不自动调模型。 |
| PW09 | 正常、失败、停止、配置变化、迟到结果、保存／恢复、归档、跨owner及旧资料兼容有适用覆盖；完整检查与非作者专项边界／复用复核、实际head及main CI分别记录，不以测试绿覆盖专业／运行验收缺口。 |

## 既有结构的最小修复映射

- 复用原 `meta.json`／`versions/vN.json`／PPTX文件和现有ID；真实项目从Host核验的现有 `sourceReport` 与 ProjectStore 归属解析，不新建项目表或业务ID，不扫描并自动升级执行资格。
- 复用已有 `configuration` 引用并在创建时由Host写入项目绑定的id/revision；旧配置缺失仅在Host确认真实项目且其固定配置有效时解析该项目配置，不回落全局当前选择；不匹配／不可核定的旧deck保留只读。
- 为落实既定D7版本／差异完整性，`DeckMeta.currentVersion?: number` 指向实际采用版本；`VersionEntry.parentVersion?: number|null` 表示已记录父版，null为已知根，字段缺失为旧格式未知；`diffsKnown?: boolean` 的显式false表示本轮内容差异未核定。新快照与回退维护真实指针／父链；既有元数据与版本不被迁移覆盖。外部手改、机器记录缺失和缺失旧谱系以字节核对披露，不伪造历史。导出返回技术字段 `diffHistoryKnown`。
- 保护检查未核定时，在原deck目录保留唯一前态副本、失败稿和技术隔离记录，不将其当新业务对象或运行权威；后续正常改稿／导出拒绝，显式选择有效版本恢复后才解除隔离，并以改名方式保留失败现场。没有旧副本被自动采用、旧任务重放或猜测性回填。
- 业务会话调用子集及Interface v3不变，不新增业务运行状态机：完整模型操作使用现有withSession/context；短文件操作复用Host mutate及公共域busy。已验证的技术缺口是原域无法按project/provider只读查询其权威占用，Host新增`busyInScope`直接投影原operation/resource/retirement，排除于业务port；不引入业务busy/代际Map、资源台账、运行队列或平行SDK。模型能力按已锁SDK的实际元数据只读核对；不新增模型路由或fallback。

原五项复验、两轴“不通过”和损坏原件合成现场保留在 `.local/host-agent-boundary-governance/delivery/ppt-host-review/`。新RED/GREEN、兼容、浏览器及独立复核证据保存 `.local/ppt-host-wiring-repair/`。结果见 [result.md](result.md)。
