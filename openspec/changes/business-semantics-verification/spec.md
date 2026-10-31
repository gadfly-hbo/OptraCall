# 业务语义增强与独立核算 Agent 一期

2026-10-30 · 用户已确认方案 v0.1 SV01–SV12并授权实施／验证／GitCI合并

2026-10-31状态：历史完整SV11保全FAIL保留；用户已确认并实施[权限与修订收尾方案](../../../docs/verification-revision-preservation-followup.md)。工程/保全、专业PARTIAL、最终非作者复核、CI/合并及运行采用分别见[记录](result.md)；适用门槛和复核未完成前不得合并，不以工程交付冒称产品验收。

基线 origin/main `e30dd19`；工作分支 `codex/business-semantics-verification`。完整决定与逻辑结构以[确认方案](../../../docs/business-semantics-and-independent-verification-phase1-proposal.md)为准，12项用户决定均为确认、一致。沿用工程规范v1.1、IN01–IN07、Agent Session Interface v1。

## 目标和修改范围

复用RAP/SAP/Case：传递实际未决内容，保存新请求实际提供的上下文来源，说明存活会话初始化SAP版本；不改RAP/SAP0.2格式。用户从任务显式发起核算，固定选定输入，在独立owner／Pi新会话／项目外工作区先自主核算再对照作者。新增业务记录不成为运行资源台账；不建IR、固定方法库、硬沙箱或第二SDK接入。

允许修改：需求插件上下文／提示、指标插件建模引导及局部预览；Host核算记录／业务适配／HTTP薄接线；项目SDK传输和原生JSONL可选上下文元数据；原任务局部UI；合成fixture和行为测试；本规格、结果、帮助及工程接入说明。公共接口只作向后兼容的可选信息扩展。保留现有项目schema1/2、SQLite表列、ID、父链、发布字节与三目录。

核算owner为真实projectId/taskId/verificationId；Host静态注册profile并注入受限port；provider／项目／退出关闭由现有公共域协调。原任务sessionFile/draft/lastRun不由核算更改。记录目录与workspace按SV08执行；原件先固定，新结果另存。

## 验收接缝

用户批准SV08/SV11的公开保存/读取、Host HTTP／真实SDK、原生记录及UI操作接缝作为TDD/回归表面。按确定性行为逐片RED→GREEN，不以私有Map断言或源码匹配代替行为。

### 已确认的作者修订收尾

- 使用原Interface v1公共生命周期的附属出稿资源，owner仍绑定原project/task/verification。只接收固定材料正文和核算意见，生成完整新稿，由Host使用唯一文件名保存。原任务sessionFile/父链/历史、普通分析工具配置不改写；新资源仍按项目/Provider/退出范围取消和关闭，不建第二SDK入口或运行台账。
- 出稿资源从创建时不注册执行工具，不加载skills/prompts/context files、MCP或动态扩展；不能以隐藏工具名代替撤销可调用能力。若完整固定材料超出可承载范围，明确拒绝并保留未知，不截断或回落全工具。此项为修订资源权限，不是普通分析或独立核算的OS沙箱。
- 通过实际SDK受控调用证明write/edit/bash、codemode/deferred、MCP及动态工具均不能执行；失败/取消/配置变化/迟到/关闭/重开不污染普通分析。新稿必须新增，固定输入、原项目目录和原native前缀前后核对，旧unknown和事故现场不回填/恢复。
- 有限真实复测在全新隔离合成根复用预先固定的六个修订条件，分别保留3个自然错误、固定错误/正确对照和1个后验不当建议诊断，不能伪装新独立收益样本。每条件最多一次新出稿及一次显式复查，先冻结新稿评分再显式发起复查；不重跑旧事故或无限追加。保持原模型及原生配置保真，模型专业质量和权限保全分开评分。

修订附属记录沿用已批准SV08的可选执行证据/结果引用逻辑组，保持record format 1和旧对象可读，不改项目schema、SQLite、RAP/SAP格式。确有必要新增的物理指针及缺失处理须在实现前固定并验证，不能以缺省值触发旧全工具修订。

物理接缝固定在既有record目录`<dataRoot>/analysis-verifications/<projectId>/<taskId>/<verificationId>/`：`revision-workspace`为附属cwd，`revision-native`保存独立JSONL，`revision-resources`为干净SDK资源根。复用`authorRevision.sessionFile`记录附属native，可选新增`mode:'fixed-draft'`及非敏感`configuration`（id/revision/provider/model/name?/thinkingLevel?）；会话未创建时sessionFile缺省，配置不包含凭据。新mode仅允许本记录的revision-native/cwd及内部父引用；旧无mode记录保持可读，不当成新附属资源，不恢复旧全工具策略。Host静态profile为`verification-author-draft`，公共工作区可选能力标识`capabilityPolicy:'fixed-draft'`不由前端自由注册。

| ID | 验收 |
| --- | --- |
| SV01–03 | 既有语义权威不复制；RAP未决具体内容／精确来源送达；SAP显示实际资源初始化版本；新上下文回执与请求关联，旧记录不回写，提供不冒称采用 |
| SV04–06 | 显式选输入与目标；固定副本；先保存cold再开放author；新会话无作者父链；Interface v1同实现与独立owner，配置捕获，取消／迟到／断线／退出正确 |
| SV07 | 不自动修稿／采用；显式一次作者修订和一次复查，输入变化不沿用旧核算；分歧/未知保留，不循环至通过 |
| SV08 | UUID身份及载荷去重；派发前持久；失败／重启不重放；损坏不清空；路径/普通文件/摘要检查；新增业务记录和旧资料只读兼容；新文件导出不覆盖原件 |
| SV09 | Extension复用原统一入口；不安装或强制步骤；实际资源可见性和软约束限制有说明；产品核算不替代工程复核 |
| SV10–11 | 固定60份作者试验、48次核算；先独立评分依据，不泄漏金标；初始156/最多252业务turn，SDK交互另计。受控检错≥15/18且每份≥2/3，正确对照误报≤1/12；自然结果净不退化，证据不足不宣称收益；完整兼容和RAP+SAP+Case联合回归 |
| SV12 | 固定候选非作者双轴复核；更新main并集成后重验，实际head CI后合并。运行采用和产品验收另记，不切现有服务／MacBook |

## 验证与证据

隔离dataRoot/projectsRoot、合成Provider验证工程接线；真实模型只使用现有获准配置和合成资料，不静默换模型，不把历史无限预算授权扩成无限追加试验。首次基线保存257份既有文件、配置和SQLite逻辑摘要；凭据只进程内比较。原资料只读，模型调用使用隔离数据根和独立会话；原服务不重启。

证据根 `.local/semantic-verification/`。原始失败、候选身份、实际命令、模型请求/结果与usage、各轮评分、兼容比较及非作者复核分别保留。模型未达标时不宣称产品完整验收或默认开启核算，不加专用方法凑通过。

## 完成记录

见[result.md](result.md)。工程、兼容、模型质量、非作者复核、Git/CI和运行采用分别记录，不以局部通过代替整体验收。
