# Studio 首期实施规格

当前授权：用户已追加真实模型专业验收、Git交付及Mac mini/MacBook两机更新，见[交付补充](delivery-spec.md)及`delivery-authorization.json`。真实模型完整专业验收未通过，详细范围见[专业记录](professional-evaluation.md)；工程/CI、运行采用及用户产品验收分别核定。

首轮授权状态（历史）：用户已于2026-11-07确认 spec / UI Demo 与两项推荐呈现，授权本地实施；未授权Git交付、真实数据迁移或运行服务切换。

## 冻结输入

- 已确认产品基线：仓库外《OptraCall Studio 首期产品方案 v1.0》，原文件保留。
- 已确认 UI/spec：`approval.json`记录原评审包绝对位置与逐文件SHA-256；开工前副本位于`.local/studio-phase1/approved-inputs/`。本规格仅补实施接缝，不更改ST01–ST20与FA01–FA06。
- 两项选择均按推荐：Studio建设主入口，Metric Factory保留指标与方法同源快捷入口；主Agent与资源默认并排、资源可折叠、小屏纵向。
- 本地分支`codex/Semantic_Analytical_Asset_Studio`，开工HEAD及已fetch main为`98ee477eb1a3f9bdb0d64f1eed7cbb613b4e00bc`，开工工作区干净。

## 实施与允许路径

新增业务模块`extensions/business-plugins/studio/`、Host Studio接缝、现有Pi工具/IPC薄适配、Studio UI及App同源导航、受影响测试与本变更记录。主Agent仍是建设项目内真实任务，不增加Agent循环、专家队列或阶段审批。SAP/资料/RAP/M2/Case保留原权威，Studio只存本模块语义源/Binding与准确业务关联。

工程规范v1.9、Interface v3，官方Pi1.4.0、Semantica0.7.0保持，不升级或修改原包。主建设和普通分析沿`project-tasks`真project/task。官方文字抽取使用Host静态profile `studio-semantic-generation`，真实owner为projectId/taskId/systemId/jobId及配置准确revision；闭合text-only资源没有文件、工具、skills、MCP或extensions权限。构图准备及worker也在同一公共lease内，但不open模型。共用生命周期、配置、预算、取消和失败清理，不由插件自建Runtime。旧profile及权限子集不扩张。

公共域仅新增Host-only `closeAll(filter?,ownerMatches?)`第二可选谓词以停止准确task，旧调用兼容、Interface仍v3，业务port仍不暴露closeAll。实际IN01–IN07范围、原SDK及组件证据见[实施记录](implementation.md#in01in07及实际ownerprofile)。

首期仍须形成：体系与主题；六领域全景；资料状态与源稿/Binding的候选建设编辑；原SAP指标方法建设/引用/发布；集中明确版本预览与各模块真实结果；原项目准确采用；图更新与资格；原分析使用、固定出处反馈、原体系接手、修订和再使用。支付/退款后金额与期间比较两题不可删减。官方经Pi的LLM实体/关系抽取→候选出处/核查→源稿→图更新为必交付；独立文字生成整套本体后置。

## 公开验证接缝与TDD

已批准ST/FA作为接缝确认依据：Studio业务Store公开保存/重开、精确版本发布/CAS及UNKNOWN；HTTP对真实项目归属/归档/来源/操作回执；Host→现有Pi工具IPC的绑定owner/迟到/取消与普通供给；官方组件公开provider适配；两主页面及原分析入口。逐个垂直切片保留行为RED→最小GREEN，集成使用隔离合成根与合成Provider。

不得只以mock/结构通过代替真实产品或专业验收。首轮边界（历史）：真实Provider/业务材料测试当时未新增明确授权，使用隔离合成工程检查。后续用户授权及实际模型结果沿上述交付补充和专业记录核定，未通过的专业要求不以工程通过关闭，仍不声称首期产品已验收。

## 首轮保全与停止边界（历史）

以下是首轮本地实施的停止边界；后续追加授权按[交付补充](delivery-spec.md)执行，原文件/会话及FAIL保全要求继续有效。

新Store仅在测试隔离根或未来显式采用环境创建；本阶段不启动真实业务根、不迁移旧项目/会话/native，不切换Mac mini或MacBook服务。普通历史仍保留。原FAIL/UNKNOWN/NOT_RUN及Demo首次复核失败不改写。Git仅只读核对/fetch，不stage/commit/push/CI/merge；工程实施与用户产品验收、Git和运行采用分别记录。

## 首轮结果（历史）

下文“等待后续交付授权”已经后续用户明确授权替代；本轮实际结果见[result.md](result.md)及[专业记录](professional-evaluation.md)。

实际切片、命令、测试与未验证见[实施记录](implementation.md)。完成适用检查、全新非作者复核与四原则专项后，只报告已证明范围，等待后续交付授权。
