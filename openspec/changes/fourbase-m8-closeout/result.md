# M8整体工程收尾记录

2026-11-04 · **当前候选本地工程收尾完成；非作者最终核收及Git／CI／main按下述逐项核定。**

本轮按[规格](spec.md)和用户授权的[三阶段交付](../fourbase-l1-semantic-trace/delivery-plan.md)整合M1–M7及L1；[整体验收总览](../../../docs/fourbase-delivery-acceptance.md)区分功能全貌与原专业／流程／保全限制。没有新功能、结构或强制UI步骤，沿已批准spec／Demo实施；原M2界面差异按用户选择保留。

## 当前固定工程证据

基线8425ca159bc674b73ad54b80ce523a93b4f3b900，交付前重新fetch仍无新增main（0/0），含此前#30等合并。批准／before1405项、原WIP差异、原5239树和旧记录均保留。主方案v1.2 SHA-256 7a165e26f82674b1d2bda0b79fd2fde9f246f06dccceb0c95c2db6354e947ff0不变；必要接缝增量没有重写原成果或丢弃并行main。

最终产品候选为`implementation/validation-v2/candidate.json`，SHA-256 83bb49208d9aa55baf4cb9e7f14dde53aaaf36df808cb34027446a9f980c0633，844份固定源文件。独立Git、物理副本／私有依赖和Python避免旧测试写回原`.local`；`npm run check`退出0，**1370测试／1367 PASS／0 FAIL／3原有条件SKIP**，boundary／typecheck／build通过。完整日志SHA-256 87d944e73b3b6212e522bd7aebf0a44cc3b80f78729414500015b98eb66cf5d9。npm audit高危阈值退出0，高／严重0、中等2；保留chunk>500kB提示，不在收尾擅自升级Pi。产品源冻结后仅增加收尾文档和精确生成截图忽略项，最终源文件逐字节回核；Git实际head另由CI核定。

旧v1候选6b142645…的1363／1360／0／3及原双轴两项P2不覆盖。HTTP500误映射和人的原历史资格误收窄均真实RED→GREEN；修后7项Host／客户端、14项原reader／UI通过，独立源码复核均无剩余必修。普通回复入口缺失亦保留实际浏览器RED。原夹具／定位错误、所有首次失败分别留存，不追认为TDD成功。

## M801–M809工程核收

| 范围 | 实际结论及证据 |
| --- | --- |
| 固定／保全 | 通过当前候选身份与文件差额核对。旧E02保全缺口仍保留；当前快照不补造旧SSR未知字节。580份旧生成PNG逐项hash／签名／常规文件核对，108923812字节留原路径，只新增`/output/playwright/`窄忽略规则，未删除或搬移。 |
| 连续分析／计算／再利用 | 普通任务零选材／无Case仍可开始，查询失败／保存失败后真实Python42完成；M2、M4、M7原接口仍由当前完整检查覆盖。DuckDB可选计算／SQL附件不变，md不冒充表、xlsx沿批准读取。 |
| 原稿／来源／时间／关系 | SAP准确版本、Enterprise原修订、M2固定输入／说明／citation与M5/M6原关系权威复用；记录时间未知独立保留，trace一层元数据，子目标按需读；新版本不替旧引用，关系声明不证明因果。 |
| Store／native／恢复 | 同原M2 hash／CAS／操作ID保存与重开，Pi原生details为直接回执；嵌套缺子details明确UNKNOWN，可自愿当前准确回读；缺正文仍可读完好manifest，不静默换latest。 |
| owner／profile／取消 | 实际直接／嵌套、过期ctx、取消／迟到、权限hook拒绝及禁止profile回归；仅普通project-tasks接入；公共生命周期与原工具／资源限制保留。check-agent-session-boundary仅增加精确test-only入口证明，不扩产品owner。 |
| 产品UI | 真实Host／Pi／Store浏览器核普通Python、真实来源保存、原稿与当前分离、自愿准确回读／trace、打开与切换零请求、追问仅草稿、失败仍分析、取消迟到丢弃、浅色桌面／深色375px及焦点。没有用原型结果代替产品。详见`product-ui-v2/receipt.md`。 |
| 最终非作者／四原则 | 全新规格／规范双轴绑定v2进行修后核收；代码与现有完整检查无剩余必须修复，实际UI证据再由两名非作者最终核定。最终报告位于`final-spec-review`／`final-standards-review`；结论及候选身份以回执为准。 |

以上本机原始证据统一位于`.local/fourbase-modules/m7-l1-semantic-trace/implementation/`；公开Git不包含私有根、凭据、node_modules、原生会话或大型生成物。当前来源公开性精确扫描无密钥模式／>1MiB源文件；测试中的synthetic凭据仅loopback假值。

## M804 当前同候选覆盖映射

以下全部来自v2完整检查同一次执行的实际测试，日志行号为`validation-v2/full-check-v2.log`，源码与844份固定候选一致；不是把旧模块PASS相加，也不声称下表独立fixture是一轮连续真实经营试点。

| M804子预期 | 当前具体测试／代码与运行记录 |
| --- | --- |
| 两次相连事项：旧成果、人的选择→新任务读取／整理 | `tests/experience-learning-host.test.ts:19`，日志465：`M6 actual Host/Pi/native/business stores: closed historical sources, optional v2 candidate, independent retained body, exclusion, and stop-new/read-old`。同一fixture先在历史项目／Case经真实Pi保存策略、人的gather_evidence选择并结案；新普通项目／任务自主find与read精确旧卡／选择，生成带原引用v2候选，再由人保留独立正文、排除旧候选，真实工具证明旧来源不再供给而独立正文仍可读；重开后旧native字节保持。第二事项不强制建Case。 |
| 人的保留→准确找回，正文与目录／提供区别 | `tests/personal-context-host.test.ts:65`，日志589 `RU01/03 real Host→Pi→Provider: normal question needs no selections; find gives metadata and read gives exact old body`；同fixture先原retain，再实际find元数据无正文、read确切旧正文。日志590 `RU04/05/10 human exact selection reaches native once, survives a newer draft and accepted same-ID retry never rereads damaged source`核原providedContext和新草稿不替旧稿。 |
| 声明引用与提供分开，不自动采用 | `tests/semantic-context-host.test.ts:32`，日志1065 `an ordinary Agent explicitly saves a report source through the original M2 citation store and history survives reopening`及`product-ui-v2/03-actual-source.log`；真实Pi显式保存同M2 citation、作者声明标签与原native details，读取命中不产生声明。 |
| 新反对／纠正前提与引用或拒用，旧稿保持 | 日志593 `RU06 Host→SDK automatically supplies latest candidate correction without bookmark; exclusion refuses new use and preserves then-body`（`tests/personal-context-host.test.ts`）及日志477 `EL02/05 exact native candidate sources expose current governance, while Agent indirect reads cannot resupply an excluded candidate`（`tests/experience-source-governance.test.ts:19`）核人的独立纠正、最新治理、拒绝新供给与原native不改。日志1099 `L101/L104/L106: exact old SAP and enterprise revisions survive newer definitions; conflict never substitutes latest`核原、新定义原文和准确引用可同时回读，时间不冒充因果；影响解释由Agent／人决定，工程合成回答不证明其专业正确。 |

原范围差异须明确：上述验证覆盖可读取、可纠正、可拒用、可声明及旧原件保全；没有新真实模型对反证的推理评分、自然语言自动召回质量或经营改善证明。后者仍为产品／专业试点，不是本轮偷偷新增的Host判断流程。

## 四点产品原则专项

| 原则 | 代码、调用链与运行依据／当前核收 |
| --- | --- |
| Host管环境 | 原pair／逐调用owner／权限／信号与M2路径／hash／CAS／追加保存；确定性读口只解析原记录，不选业务口径、补算或判truth。原read-only GET不初始化库。实际Host／reader／Store证据通过。 |
| Agent自主执行 | 无固定查询步骤、方法配额、来源成功门槛或Host纠错流程；普通无查询、错误后Python继续、直接／嵌套调用均由原Pi执行。实际Runtime证据通过。 |
| 优先复用Pi／既有能力 | Pi1.4.0／Interface v3、原project-tasks／M4 IPC／SessionManager、原SAP／Enterprise／M2／M5／M6权威；没有第二循环、压缩／恢复／重试引擎或语义库。导入边界和调用链通过。 |
| 减少人的操作 | 正常仅目标＋发送，新增必做0；打开／切换详情不查询，追问自愿仅草稿。空／错／缺来源均不阻原分析；明确选材和必要权限没有省略。实际浏览器通过。 |

专项最终结论须合并两份非作者回执核定，不把权限／取消／预算／原件保护误判为干涉，也不把上述工程结果升级为真实模型专业可靠或经营增益。未新增真实Provider／业务材料实验，原专业FAIL／UNKNOWN、M3/M3.1 NOT_PROVED、DuckDB E01/E02/D04限定接受及3项平台SKIP均保留。

## M810 Git交付与会话交接

用户已授权Git／CI及squash合并最新main。提交前核暂存精确清单及公开内容，之后以PR真实head CI、合并SHA与main push CI、本地main安全快进逐项为证；这些动作不由本地检查替代。最终交付事实和干净工作区读回保存在PR及阶段3的L1→L2 handoff，不在提交前预写成功。

阶段3交接在工程树外写出，记录真实branch／HEAD／tree／upstream、main祖先／树与相关worktree状态、Git／CI链接及保留限制；不得reset／clean／stash或删除WIP制造干净。其它历史脏工作树明确保留。原Mac mini运行服务、MacBook、真实数据／凭据及正式L2组件安装均不在本轮切换范围。

## 首次托管CI原始失败（PR #31）

提交23eb047982fc075aef304c7c7f654dd370b59b7a、tree063f0feff15579af51e553abe4f6d4142e3e0312，PR #31；首次[实际head CI](https://github.com/gadfly-hbo/OptraCall/actions/runs/41791319348)为1370项／1273 PASS／2 FAIL／95条件SKIP，未进入build／audit，**不通过且未合并**。本地1370／1367／0／3与该Ubuntu结果分别保留，不能互相替代。

失败为M5 CD08及M6 EL09两个scope测试直接尝试本平台不可用的managed保护，实际产品按原合同返回sdk_operation_failed／unsupported_protection。修复范围只在两份测试：不支持时验证明确拒绝及零新增Provider调用，支持时继续核受管profile不扩工具；其它profile断言保留，不跳过整个测试、不放开产品保护或修改CI。原始日志保存在本机`implementation/pr31-ci-original.log`；修后定点检查、非作者增量复核及新实际head CI继续单独核定，不覆盖首次失败或套用旧PASS。

修后两份测试在新的物理隔离目录完成Mac定点14／14 PASS、0 SKIP及typecheck PASS，原Mac受管工具断言和其它profile断言继续执行，并增加ordinary／protected双profile及零Provider访问验证。Ubuntu拒绝分支仍须新实际head CI验证，未用Mac通过推导跨平台已通过；证据在`implementation/pr31-platform-fix/run-_5oyy1iw/`。本次提交仅两份测试及本段记录，产品源码与已验收UI不变。
