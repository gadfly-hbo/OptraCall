# S5 L2语义基础设施工程版交接

2026-11-06（北京时间）· v0.3已整体确认 · 本地工程版限定收尾

## 交接结论与固定身份

本地语义资产、原Pi接线、来源准入、权限／生命周期、固定版本与适用工程证据可以按工程版交接。专业可靠性、正式运行采用及真实首Case分别保持后续项；完整v0.4目标和V401–V406不删除。

| 对象 | 交接身份与限制 |
| --- | --- |
| 工程源码 | 本工作树`2b9800bc181b9477109c28c85ab46057ee74243d`加既有L2变更；D16的10件相关源码／测试文件本次逐件bytes／SHA核对一致，未重跑全量工程 |
| 固定D16候选 | `98f9a725e45e13bff8ec054ec7e52e13bc697110099d93b3b2b75547ff6f06e8`；源码及完整运行依赖以原`candidate.json`、`runtime-manifest.json`和执行后回读为准，不将当前HEAD单独当成完整候选 |
| 技术版本 | Pi1.4.0／Interface v3，Node25.9.0，Python3.12.14／Semantica0.7.0；按原lock及固定归档安装，不宣称为最新版本或正式打包方案 |
| 资产 | 原Store准确发布的3核心指标＋1方法、小本体／带源快照；D16准备8个任务为空的场景项目，5份L2图／3份L1，只有K3/L2实际启动1个父任务 |
| 既有检查 | Node1509通过／30原条件跳过，Python80/80，构建及会话边界通过；实际受控Host→Pi交付／权限／收尾及非作者复核按原回执，旧失败／夹具错误保留 |
| 模型与质量 | D16 K3首稿／最高固定稿FAIL→FAIL，各27/27预定金额匹配、返修新增重要错；1/8后停止，7项NOT_RUN。19分01秒不证明产品速度，L2相对收益NOT_PROVEN |

当前交接不包含Git／CI、合并、正式安装／运行切换、其他设备更新或真实经营动作。S6接缝如有后续修改，须单独记录新差额与适用检查，不能沿用D16的SHA冒称新代码已受检。

## 已有入口与维护顺序

复用[S5原建设／更新／停用说明](s5-adoption-validation-plan.md)、[S3验证](s3-validation.md)、[S4验证](s4-validation.md)和[D16结果](s5-limited-repair-results.md)。原[S3模块README](../../../scripts/fourbase_l2/README.md)是当时私有工程说明；其中“尚无S4／真实模型”等描述是历史，不代表当前进度，也不是生产安装手册。D16隔离runbook只解释已执行研究工具，不作为日常产品入口，不重放旧operator或`scene_acceptance.py`。

| 维护操作 | 沿用入口与实际边界 |
| --- | --- |
| 准备源资产 | [prepareSemanticTrialAssets](../../../src/host/semantic-trial-assets.ts)沿原SAP／方法／企业资料／M2 Store保存、发布和冻结准确输入；来源必须获准、脱敏且有准确Ref。它不创建任务或调用模型 |
| 构建／更新图 | [build_scene](../../../scripts/fourbase_l2/build_sc01s.py)使用显式根、准确Ref和输入hash。先停妥匹配Host／资源，再离线构新UUID／label；旧快照不原位编辑或删除。只对新获准根操作，不重放旧有业务写入 |
| 工程Host接线 | [startSemanticTrialHost](../../../src/host/semantic-trial-host.ts)复用原Host；`codeRoot`／`dataRoot`／`projectsRoot`明确且互不包含，graph binding显式给`runRoot`／`snapshotId`／`python`／`codeRoot`，真实首task在首次open前绑定。它只接受任务为空项目的首task，不是通用部署器 |
| 已有项目／正式采用 | 原[Host及公共会话](../../../docs/agent-session-integration.md)继续权威；普通启动入口不会仅因Semantica已安装就自动选择图。目标环境的项目／任务绑定、已有任务及重开策略需按具体采用安排核定，不能套用试验首task限制代替正式方案 |
| 撤回／失败／停用 | [原图服务](../../../src/host/semantic-graph-service.ts)和[来源资格](../../../src/host/semantic-graph-authority.ts)逐次核当前准入；旧图不因保留而绕过撤权。错版／坏图不是ready，保留partial／UNKNOWN。移除graph binding后沿仍有权L1资料继续；必要来源失读只暂停受影响判断 |
| 保存与关闭 | 原任务／核算／固定版本各持原权威；沿原stop／close与owner收尾，未知不自动重放，不改旧稿／原native。不以执行器退出或报告生成证明关闭／业务正确 |

这些是工程维护职责，普通用户仍直接表达问题和使用原任务。Agent自主选择查图、回源、计算或复核并复用适用结果；Host不新增业务判定或固定分析顺序。

## 证据与材料归属

核心回执位于`.local/fourbase-l2-s5-limited-repair/run-20261106T050247Z/evidence/`：`final-closeout-index-001.json`、`candidate.json`／`runtime-manifest.json`、`engineering-candidate-v2.json`、`post-execution-frozen-readback.json`、独立专业gate及评分后有限采用核读。源码／文档／身份可交接；原native、凭据、评估材料和隔离业务根留在获准本机位置，不复制入仓库。

原D16持久运行根为`/Users/Shared/optracall-isolated/d16-20261106T050247Z`。其中`serving`是旧固定执行候选、`venv`是旧验证依赖，`study`保留已知场景；它们不等于正式运行目录。维护未来版本时保留原件，按明确授权选新根／新版本，不能覆写本次冻结对象来伪装同候选。

## 后续责任与尚未完成项

- 工程接线与必要修正由Codex沿原规范维护；SAP、M2、Case、Board、Feedback和经验沿各自Store负责，不新增第二业务权威。
- 正式采用仍需落实目标环境／版本、维护人及回退责任。当前不切换服务，不从既有S5订阅事实推导新模型实验。
- 真实匿名经营数据、对象／期间、人的取舍、后续观察和反馈不能由工程代填。专业可靠性见[spec后续项](spec.md#62-专业可靠性单列后续)，不作为本工程版收尾前置，旧FAIL保持。

本次交接基于原回执与当前相关文件的只读核对，新增真实模型测试0，没有新建验证工具或重开D16研究。
