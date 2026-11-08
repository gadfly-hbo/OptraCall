# S4 接入验证结果

2026-11-05 · D13.1–D13.8 全部 A · S4 工程实现与适用检查完成 · 不进入 S5

## 实际完成的接入

同一 `read_semantic_context` 增加 `graph` 分支，支持 find、definition、neighbors、dependencies、impact、source 六类有限只读操作。普通 unmanaged 和 managed 父任务沿原 HTTP／project-tasks／Pi 1.4.0／Interface v3 取得语义内容；managed 只新增 graph，不取得旧目录动作或 record 写权限。定义、方法、字段角色、适用条件、未知／争议、来源性质和准确版本随 content 进入下一轮模型请求，Agent 自主决定如何使用、计算和解释。

查询沿原 Resource 跟踪实际请求、可信 Python job 和 Host 原 Store 权威回调。完成、取消、关闭与清理等待实际退出及在途权威读取；清理不能证明时保留 UNKNOWN 和占用，显式重试只处理失败清理。没有新增 Runtime、业务 busy／generation 台账、Host 分析循环或自动口径裁决。

本轮使用 S3 的 3 个核心指标、1 份方法、小本体与 54 节点／63 边带源图；337 个 JSON Pointer、平行边、减项方向、方法依赖、业务时间与 unknown 保留。run 固定准确快照，不选 latest；分页绑定当前 run／查询／快照／来源资格，完整 JSON content 上限 24 KiB，整条路径的节点、边、方向与来源一起分页。

前端只扩展原回答依据详情的可选展示。关键口径与冲突交给 Agent 在回答中解释；没有独立业务含义页面或新增用户必做操作。旧结果继续走原 L1 展示，新记录只认实际 SDK 结果，缺失或嵌套记录保持 UNKNOWN，不回查补历史。

## 固定基线和工程验证

隔离管理工作树：`fourbase-l2-s4/OptraCall`，固定 base `2b9800bc181b9477109c28c85ab46057ee74243d`。原 `0e3f/OptraCall@57742b9` 及其 WIP 不改动。具体准备、责任和失败保全见[实施记录](s4-implementation.md)；批准合同仍为[整体方案](s4-integration-plan.md)，其中“尚未实施”是开工前确认时状态。

本次 evidence 根：`.local/fourbase-l2-s4/sc01s-v0.1/run-20261105T095713Z/evidence/`。代码／配置／测试冻结清单 `code-candidate-v1.json` 共 607 件，清单 SHA-256 `14bad212d7c0d530e90cdcb6bbdf2615e7e52d12f1c191710ad485dfb980356c`；文档完稿另核。未变 package.json／package-lock；按原锁在隔离候选安装 234 包。Python 3.12.14／Semantica 0.7.0 只读复用 S2 venv；生产查询不调用 S3 的 NativeAuthority／Node 桥。

| 验证层 | 实际结果与证据 | 结论边界 |
|---|---|---|
| Python 完整回归 | 60／60 PASS，`python-full-v1.log/json` | 包含 S3 45 项和新增有限查询／worker 15 项；worker 权威资格使用测试代理 |
| Resource／实际 Pi SDK | 21／21 PASS，`runtime-final-targeted-v3.log` | 两普通模式、受限 profile、伪造上下文、取消等待／迟到清理／失败隔离；不是实际 Python 子树全链路测试 |
| 真实 Python 进程与 Host 服务 | 16／16 PASS，`sec-pre-01-service-targeted-final.log` | 实际子树、退出证明、权威读取排空，以及原 Store＋原生 Semantica 的六操作；大 Unicode／极限分页主要在服务组件验证 |
| 原 Store 准入和精确声明 | 3／3 PASS，`authority-exact-ref-green.log` | 原项目启用、禁用、confirmed 方法问题、M2 递归准入、精确 Ref／build 位置及原始交易／控制值隔离 |
| 实际 HTTP→Pi→Python→原 Store | 7／7 PASS，`runtime-host-final-v2.log`；完整检查再次覆盖 | 两普通模式跑 definition／impact／source 并进入下一轮合成 Provider 请求，原生 bash 计算可继续；find／neighbors／dependencies 的实际六操作核验在服务层，不冒充完整 Pi 回合覆盖 |
| UI／历史 | 26／26 PASS，`ui-green-v2.log` | 8 项新增＋18 项 L1 回归；SSR／纯函数使用合成历史。实际 HTTP 验证 native 追加、重开／GET 无副作用；浏览器布局／焦点／交互 NOT_RUN |
| 统一会话导入门禁 | PASS，`boundary-loader-final.json` | 只增两个精确 SDK 测试文件与一个既有工程 Store-loader 表达式；同文件任意动态 import／SDK import 仍拒绝 |
| 全应用适用检查 | `npm run check` PASS，`fullcheck-v2.log/json` | 会话门禁、1517 项中 1487 PASS／0 FAIL／30 SKIP、tsc／Vite／stamp 完成；首轮 FAIL 保留 |
| 全新非作者复核 | 固定源码／证据两轴均 0 未关闭必须修复项 | 规格安全 `security-final-v1.md/json`，工程规范／四原则 `standards-final-v1.md/json`；最终文档身份回读以各报告实际结果核定，不以作者验证替代 |

各层存在重叠，不将这些数量相加为独立用例总数。30 项原有条件性 SKIP：27 项未配置的私有／portable 计算环境、1 项本机不适用的平台反例、2 项真实 Office 渲染器；S4 新增必测项无 SKIP。没有把这些未执行项改成通过。构建保留 bundle 大小提示，不影响退出码。

## S4A01–11 核对

| 验收项 | 证据和实际边界 |
|---|---|
| S4A01 内容可见 | 两普通模式真实 HTTP／SDK 请求记录含定义、方法／字段依赖、条件、unknown、来源性质；content 与 details 同源，非只填详情 |
| S4A02 查询保真 | 原生图＋原 Store 服务逐一核六操作，默认深度 2 明示未穷尽，深度 4 核两条既有影响链；平行边独立、减项方向与三指标依赖保留；不以图推导真实经营结论 |
| S4A03 越权拒绝 | 当前 owner／run 非序列化绑定，跨任务／run 句柄和模型传根路径／任意字段拒绝；managed 旧目录／record、受限 profile／子角色无能力；内部 authority 也仅认快照精确声明 |
| S4A04 当前来源 | 原 Store 当前项目启用、企业禁用、confirmed 方法问题与 M2 来源失效排除内容、边和路径；续页与原文重核资格；nullable hash／未确认粒度不伪装已核实 |
| S4A05 在途取消 | 实际 Python leader 与故意忽略 TERM 的后代退出，平行 owner 不受影响；实际 SDK 与原 Resource 分别核取消／关闭／迟到回调／排空，在途原 Store Promise 也纳入排空 |
| S4A06 清理失败 | 人为失败与 leader 提前退出保留 UNKNOWN；只有原身份清理可显式重试，不重放查询，不向已回收或可能复用的 PGID 发信号 |
| S4A07 准确快照／分页 | 固定两代准确身份；跨 run／查询／资格／输入版本的 cursor 拒绝；24 KiB 预算、UTF-16 坐标、Unicode 重建、整路径与 too-large 入口可核 |
| S4A08 故障继续 | 缺组件／坏快照／UUID／hash／半写与输入漂移不显示 ready；未配置 graph 的实际 HTTP 普通任务保留 L1 和 Python 计算，不绕过来源撤权 |
| S4A09 原生保存 | 实际 SDK/native JSONL 追加，既有记录前缀保留；GET／重开不启动模型／查询；新 UI 仅投影已保存结果，缺失嵌套不补齐 |
| S4A10 兼容／入口 | 精确导入门禁及完整原测试覆盖 L1、SAP 方法、M2／M4／M5／M6、需求、核算、修订、子 Agent 和第三合成消费者；全量第二轮 PASS，未执行范围按上表保留 |
| S4A11 四原则／复核 | 原调用链和固定候选由两位非作者分轴核；Host 只管环境／权限／生命周期，Agent 自主执行，复用 Pi，正常新增必做 0；两轴源码与证据均 0 未关闭必须修复项，最终文档身份按实际回执核 |

## 已发现问题及修复

确定性 RED、当时源码和 GREEN 保留在 evidence。包括 SDK 原先未获得 Host 读能力、提前 idle／取消后迟到清理、原始来源过宽、schema 类型强制转换、整路径来源句柄超预算、异常 leader 退出和在途权威读取排空。夹具时序／UUID／测试记录器错误单列，不能当产品 RED。

独立预审的两项 P2 已采纳并修复：

1. **返回前复核时机。**原先在最终来源复核后继续异步读快照，可能在回包前失权。现先完成快照核验和预算，再做最终来源复核；不再在其后等待无关 IO。原独立反例及永久回归保留在 `security-pre-review.*`、`sec-pre-01-service-red.log`／`sec-pre-01-service-green.log`。
2. **内部精确来源范围。**原内部 authority 只核来源类型和原库准入，未拒绝把指标 Ref 改成整包 Ref。现从按 receipt/hash 验证的固定图取得精确 Ref 与 build 位置集合，拒绝未声明读取；原 M2 递归来源只在内部核资格，不扩为可读声明。真实原 Store 回归保留在 `authority-exact-ref-red.log`／`authority-exact-ref-green.log`，同时拒绝未声明的 `/metrics` 整包位置。

全应用首轮两项旧测试失败的原因是本次运行器把 TMPDIR 置于仓库内：需求插件因此继承祖先 AGENTS，受限 rg 因访问祖先 `.git` 被拒绝。保留首轮失败，不放松产品沙箱、不改旧断言；改用任务专属 `/private/tmp/optracall-s4-check-pegbgzuj` 隔离测试临时目录，两旧消费者 17／17 PASS，再对同一 607 件源码候选做完整检查 PASS。两轮环境、退出码、日志和固定身份分别保存，不以重跑覆盖首轮 FAIL。

## 保全、未验证范围及下一步

已回读原工作树 932 件无差异；S2 166 件、S3 初轮 77 件、S3 修正版 281 件既有清单无差异；新隔离 S3 固定夹具 463 件与原副本一致。依赖锁、原批准材料、首次 FAIL／UNKNOWN 和旧图均保留。最终完整候选、文档／证据身份与评审回执分别按本 run 的 `candidate-final-v1.json`、`artifact-manifest-v1.json`、`final-static.json` 和 `closeout.json` 回读核定。

这些结论只适用于脱敏资料和合成数据的隔离工程实现。未读原企业附件／真实经营数据／真实凭据，未运行真实 Provider、真实闭环或 Graphiti，未切换服务／设备，未做 Git 提交／推送／合并／CI。Semantica 目前由 Host 明确绑定的工程夹具运行，未安装或采用到正式产品环境。

剩余范围为浏览器交互验证、正式运行绑定／依赖打包与采用、真实模型是否自主正确使用语义及质量／耗时、真实业务条件和经营闭环反馈。后几项留在 S5／后续阶段，需要按对应阶段确认；当前不进入 S5，不把本次工程可用等同于真实分析质量或产品验收。
