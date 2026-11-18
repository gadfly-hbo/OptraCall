# Case-Star-Map：合并交付与原位归档

2026-11-14 · 本页接续[批准spec](spec.md)、[准备复核](review.md)和[本地实施记录](implementation.md)。用户先确认v0.2并授权开发，随后明确授权提交推送、CI通过后squash合并main、快进本地main并原位归档，最后更新MacBook并启动试用；又明确“Mac mini也更新掉”，因此最终采用范围为两端。设备采用最后执行，不运行真实Provider、业务实验或企业资产建设，不升级或改造SDK。

## 已核工程候选与检查

原工程固定清单为44份文件，SHA-256 `8d563cbca27d161e469990db65719a74be28e86b5c9893e9754f7ea7db5f73d8`。Standards／Spec两位非作者分别完成完整身份与受影响行为复核，0未闭合必修问题。交付前再由非作者检查公开内容、源码不漂移与提交blob；原44份中仅spec／implementation追加交付授权，其余42份字节未变，没有纳入主工作树README修改、原生会话、凭据、业务数据或`.local`证据。

本地完整检查2338项／2268通过／0失败／70原条件跳过，边界、类型与生产构建通过；原HELP-02失败、权限漂移／来源分页／标签遮挡发现及修后结果分别保留。原Pi1.4.0／Interface v3、call-local资格和既有生命周期复用，Host核身份／权限／取消／持久化，Agent自主零次或多次关系调用，图不建立第二业务权威或正常必做审批。

## Git 与实际 CI

| 阶段 | 准确身份与结果 |
| --- | --- |
| 基线／合并前更新 | `ef3e7d0b8703a6e22023e8099a56c542d484a69d`；提交前与合并前分别fetch，main均未前进；未改写历史 |
| 唯一功能PR | [#69](https://github.com/gadfly-hbo/OptraCall/pull/69)，分支`OC｜Case-Star-Map`，实际head `436d47b25163b51db9a4c4aea8b526528358971e`，44文件 |
| 实际PR head CI | [Check #181](https://github.com/gadfly-hbo/OptraCall/actions/runs/43561519099)，event pull_request、attempt 1、checkout为上述完整head、success；2338项／2182通过／0失败／156条件跳过，边界／类型／构建／高危审计通过 |
| squash | `6fee3b5a6d213174324cdf8b2aa0c606d834e028`，父提交为基线；完整tree `a356a7ac0d262881e70861d5f9644b897dfc90f4`与受检feature head相同，无合并引入的源码差额 |
| 本地main首次快进 | `/Users/bendandebaba/DevWorkSpace/OptraCall`从基线`merge --ff-only origin/main`至6fee3b5；README为已有未暂存修改且本次提交不涉及该文件，快进前后原字节／binary patch均相同。该主树仍保留README WIP，不宣称全树清洁 |
| 合并main push CI | [Check #182](https://github.com/gadfly-hbo/OptraCall/actions/runs/43562224555)，event push／main、attempt 1、checkout为6fee3b5完整SHA、success；2338项／2182通过／0失败／156条件跳过，边界／类型／构建／高危审计通过 |

PR CI与本地macOS检查的跳过数因平台／可选私有环境不同而分开保存，不宣称跳过能力已经通过。npm高危阈值审计成功，高／严重0；原2项moderate、Vite大chunk及Ubuntu镜像提示保留，未强升SDK或修改锁文件。首次push因本机旧credential-helper路径不存在失败，随后仅该命令使用现有gh helper重试成功，全局凭据配置未改。

## 原位归档与保全

本目录原路径保留spec、准备review、实施记录及本结果；批准v0.1／v0.2副本、原FAIL／UNKNOWN、迁移／取消／恢复、独立复核与真实合成Host／Pi／UI证据仍在原本机证据根。原位归档只补这三份Markdown，不更改产品源码、测试、依赖、Demo原件或签署过的报告／清单。归档完整树仅因这些文档不同，其提交SHA、push CI及本地main最终快进以Git／Actions和仓外最终收据核定，不为自引用无限追加提交。

源证据根为原开发树 `.local/case-star-map-implementation/`；交付日志／精确CI元信息／公开内容复核／main README保全及后续收据在其`delivery/`。原功能分支及开发树保留；不把“OpenSpec原位归档”等同于删除工作树或历史。Mac mini主树README WIP及其他工作树不纳入归档。

## 最后设备采用与回退边界

归档main的准确SHA通过push CI后，分别更新Mac mini独立正式release和MacBook原独立main浅克隆，沿原launcher正常生命周期；采用前即时核空闲、原实例／控制文件和准确目标，先保全旧代码／依赖／构建、原配置、项目、会话、文件及引用。运行后再核health的commit／tree／codeRoot／instance、全部HTTP构建资产及原数据，不以Git HEAD前进代替运行采用。两端各自使用原本机数据／凭据，Mini不复制数据到Book，不替用户创建正式业务关系或发送消息。

2026-11-14 13:31北京时间只读核Mac mini：4173为旧正式Host常驻，已核任务／链／核算／SAP／PPT busy、Host后代及活动TCP均0；未发现训练进程或共享源码／dist消费者。需求／Studio缺完整内存busy投影，稳定采样及进程／网络旁证范围保持。MacBook同版干净clone处于停止态，原Node25.9.0可用。此为采用前快照，不能替代真正切换时再核，也不能称已部署。

两端现有Case schema1。启动和GET不迁移；首次明确关系写入才事务升级schema3。**旧ef3e7d0程序不保证读取schema3**：迁移后不得用旧数据库备份覆盖新关系或其他成果，应保留最新数据并采用已兼容schema3的关闭新写候选或隔离数据根。Host原生`--disable-case-relations`已核，但原trial CLI未转发该参数，不能宣称桌面已有一键兼容关闭回退。未迁移时也须正常停止并核当前实例后才能考虑旧源；不重放模型或盲目恢复数据。

设备实际执行与非作者最终回读按各自本机私有收据及`delivery/delivery-receipt.json`记录；本归档文档创建时尚未执行两端采用，不预写成功。真实模型质量、专业收益、业务效果及用户产品验收仍未验证。原Case详情同key警告、大图浏览器性能及未逐项真实点验的SSE／断网组合仍沿实施记录边界，不因Git／CI／运行采用关闭。
