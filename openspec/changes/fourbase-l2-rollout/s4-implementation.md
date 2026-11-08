# S4 实施与验证记录

2026-11-05 · D13.1–D13.8全部A已确认并获明确开工 · S4工程实现与适用检查完成 · 不进入S5

## 本次授权和基线

用户明确要求开始实施S4，从S4.1权限及生命周期骨架开始，允许必要依赖安装和工程验证，仅用脱敏资料与合成数据，完成后给结果与剩余缺口，暂不进入S5。此前准备文档中的“未开工”保留其批准时状态，不再构成本次实施停止线；已确认技术合同沿用[整体方案](s4-integration-plan.md)，不重新申请D13。

原`0e3f/OptraCall`工作树保持不变，HEAD为57742b9；932件开工前身份与56件未提交L2资料／源码／测试复制清单保全。已只读核验远端main为固定`2b9800bc181b9477109c28c85ab46057ee74243d`，在该基线上创建本聊天的管理工作树`fourbase-l2-s4/OptraCall`并复制所需WIP，原件不移除。复用该基线已交付的SAP方法模块，不整包覆盖原工作树，也未提交／推送／合并或切换服务。

隔离run：`.local/fourbase-l2-s4/sc01s-v0.1/run-20261105T095713Z/`。候选改前971件为准确2b Git对象＋复制WIP身份，原批准3件原文与D13确认回执另存evidence。固定S3资料复制到本工作树`.local/fourbase-l2-s3/sc01s-v0.1/run-s3-fixture-s4/`，两代图及9输入原字节保留；测试原Store只操作各自复制库。

依赖：沿精确package-lock在隔离管理工作树执行npm ci（ignore-scripts、独立HOME／TMPDIR／npm配置／cache），安装234包，未改锁文件或全局配置。Pi1.4.0／Interface v3沿原底座；Python3.12.14／Semantica0.7.0只读复用S2固定venv，查询job不使用S3 NativeAuthority／Node桥。不安装额外模型／Graphiti／embedding。

## 责任、接缝与实际实施

仍为原`project-tasks`真实projectId/taskId、当前run及Resource，不新建Agent profile、模型循环、业务busy／代际Map。Host绑定读权限与准确快照、原Store准入、资源收尾和成果记录；Agent自主选择查询／方法／计算／解释。正常新增必做0，仅原回答依据详情的必要类型投影。

同目录作者按文件隔离：runtime作者负责原SDK／Resource及工具定义；graph作者负责有限Python查询、可信worker及独立graph传输类型，并补原可选依据投影；Host service作者负责查询job／cursor／有界结果；主Agent负责原Store资格、Host注入、跨接缝整合、文档及最终完整核查。作者互查不作为最终独立复核。

验证接缝沿已批准S4A01–11：原HTTP／project-tasks→真实Pi SDK工具→Host读facet→实际Python／Semantica→Host原Store→模型可见content→原native保存／重开；另核两个普通模式及受限profile反例、当前源变化、取消／后代收尾／UNKNOWN、分页／准确版／失败继续和旧消费者。

## 失败与验证证据

每个确定性切片保留可执行行为RED、当时源码与最小GREEN，依赖／fixture／记录器错误另记，不能当产品RED。当前已记录Resource权限／提前释放失败、真实SDK未供给失败、source项目启用／原始控制值泄漏失败、有限查询与schema反例、Python leader提前退出而后代未退出反例，以及实际路径来源句柄过大。原日志与修正分别留run/evidence，不把作者测试预写为整体S4完成。

## 本轮结果与停止位置

S4.1已完成原Resource权限及生命周期骨架，S4.2完成6类语义操作、当前来源、准确版及有界结果，S4.3完成两普通模式实际HTTP→Pi→Python→原Store→模型content→native保存／重开，S4.4完成适用全量工程检查和非作者分轴源码／证据复核。逐项证据、覆盖层级和限制见[验证结果](s4-validation.md)。

Python完整60／60 PASS；真实HTTP／SDK闭环7／7 PASS；最终`npm run check`退出0，1517项中1487 PASS、0 FAIL、30原有条件性SKIP，tsc／Vite／stamp构建完成。S4新增必测项无SKIP。完整首轮两旧测试因本次仓库内TMPDIR继承祖先AGENTS／rg读.git失败，保留FAIL；只改测试隔离位置，17项旧消费者及同一源码完整复验通过，未放松沙箱／断言。

全新非作者规格安全及工程规范／四原则源码与证据均0未关闭必须修复项；两项预审P2已独立反例核实并修复，原报告／RED不删。最终文档身份与复核回执分别见本run/evidence的security-final-v1、standards-final-v1、candidate-final-v1、artifact-manifest-v1、final-static及closeout。作者互查不替代这些回执。

会话导入门禁只加入两条精确的合成SDK测试路径及S3工程Store-loader的精确动态表达式；同文件其他动态导入、SDK／ProjectAgent或新脚本仍拒绝。生产worker只用Host窄权威代理，不复用工程Store桥。

原工作树932件、S2 166件、S3初轮77件、修正版281件及新固定夹具463件回读一致，依赖锁未变。当前在隔离管理工作树保留未提交实现，没有Git／CI／合并／服务／设备采用。浏览器交互NOT_RUN，真实Provider质量／耗时、正式Semantica运行绑定与打包、真实经营及反馈留后续阶段。本轮停在S4，不进入S5。
