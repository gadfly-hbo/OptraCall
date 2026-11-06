# S1 实施基线与 SAP 复用决定

2026-11-05 · 仅锁定后续实施依据；未整合、安装、发布或进入S2

## 1. 固定基线

| 对象 | 本轮核定结果 |
| --- | --- |
| 当前工作树 | `codex/four-base-L2`，HEAD `57742b99d173bfa6413e83705682b0444359add4` |
| 后续源码实施基线 | `2b9800bc181b9477109c28c85ab46057ee74243d`，tree `6fd8815a3d714a370888c01bcec34827cf6f328d` |
| 远端核验 | 2026-11-05以只读 `git ls-remote --heads origin main codex/four-base-L2`核到main为上述2b9800bc、codex分支仍57742b9；不是仅凭旧跟踪引用 |
| 差额 | 当前分支独有0、基线新增1个提交，包含已交付SAP方法；57个路径变化。当前无tracked diff，未跟踪资料与该差额的路径交集为0 |
| 本轮动作 | 未fetch、merge、切分支、创建新工作树或更新其他机器；当前HEAD不变。代码存在不代表已安装／运行采用 |

后续获准实施时，先重核远端和当前WIP／占用。若基线仍相同且无新冲突，保全已确认资料后安全快进当前开发分支；不reset／clean／stash或覆盖他人改动。若远端或接缝已有新变化，只评估差额及受影响检查，不静默把未核版本当本轮基线。

已确认的方案及合成材料作为版本化输入叠加到该源码基线，不拷贝旧工作树覆盖新方法模块。当前图索引只对应57742b9，对方法符号无结果；方法部分因此通过固定Git对象定点读取，M2相关合同在该基线差额中无变化。

## 2. 沿用现有指标与方法合同

以下代码定位均指固定提交 `2b9800bc`，不表示文件已存在于当前旧HEAD。

| 内容 | 精确复用点与决定 |
| --- | --- |
| 3个核心指标 | 沿 `SapDocument sap:'0.2'`，可在同一指标包发布；引用沿包ID＋semver＋包内指标名。单位、时间、限制写既有definition／provenance，不新增unit／formula字段 |
| 原始金额表达 | C02可用simple且省略type_params；C03在本样本作为已分类事件金额聚合量可采用simple，但必须保留源5类退款组成及样本仅2类的限制，不据simple宣称源已认定原子 |
| 派生净额 | C04可用derived及expr文字表达，计算仍由Agent自主完成，Host不解释表达式补算 |
| 禁止误填 | simple.measure若提供必须引用包内指标名，不放JSON路径或为凑格式自引用；28天是任务筛选窗口，不新增time_grains枚举；caliber_switches仍仅boolean |
| 方法存储 | 复用 `methods/store.ts`的 `createSapMethodStore.save/publish/listPublished/getPublished`，位于原metric-assets的methods空间，不在指标包新增methods字段、不建IR专库 |
| 方法身份与版本 | 首存由Store生成UUID，版本为递增正整数；修订沿baseVersion CAS。`MTH-01`只是方案代号，不能填methodId；不套指标包semver |
| 方法正文 | 原 `content.conditions/logic/judgment/limits` 四组普通字符串，长度上限20k／40k／20k／20k，不能全空。[本轮正文草案](s1-core-definitions.md)按这四组组织，无需新schema |
| 保存与发布 | 保存仍为未发布；publish绑定准确version及expectedSha256；普通查询只找可用发布版，准确旧版读取保留治理状态。原修订／错误提示／归档不被图覆盖 |
| 准确引用 | 指标在M2中用 `packageId/version/metricName/publishedHash`；方法经原semantic工具用 `kind:'sap-method',methodId,version:number,publishedHash?`，两者不混用 |
| 读取与项目策略 | 方法全局find／准确read不新增项目enablement门槛；指标项目索引仍按已启用准确包版本。`SapScenario.method_refs`仍为string[]，不塞方法Ref对象或声称字符串已解析成准确发布版 |
| 可选后置提取 | 复用现有 `createSapMethodFeature/createSapMethodSessions`与统一Pi／Interface v3；这次整理MTH-01无需运行提取或另开Agent会话 |

合同证据：`metric-factory/sap/validate.ts:7–20,115–148`、`methods/types.ts:3–11,62–72`、`methods/validate.ts:18–40`、`methods/store.ts:141–218`、`semantic-context/types.ts:6–7`、`semantic-context-service.ts:74–94,214–232`、`project/index-text.ts:10–39`。

`publishedHash`沿既有可空／可选语义：M2指标Ref保留该字段但值可为null，方法semantic Ref可省略该字段或取null。有实际hash时固定并核对；未知不编造，保留缺失限制，不新增全局非空hash门槛。

## 3. 来源与产品材料化边界

来源采用手工整理的other／manual路径，不伪造IR、native Session、实际使用或发布回执。manual source可以记录获准脱敏资料的定位、修订及hash；**现有来源预览不自动访问任意manual文件**，只解析已归档的sap-session／sap-material引用（`sap-method-feature.ts:201–205`）。因此不为本轮预览新增任意文件读取入口，也不承诺“已可点击取原企业原文”。

S1交付的是三定义语义卡、方法正文草案及[可核查字段映射设计](data/sc01-synthetic-v0.1/field-map.design.json)。本轮不生成或保存虚构UUID／业务Ref、不写SAP库或M2、不发布资产；S3再沿上述真实入口创建并记录实际身份。
