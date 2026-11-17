# PM-V12-01-R1 旧讨论兼容修正

2026-11-17。依据最新独立产品报告§3/5/8—10及v1.2 §1.1、§2.4—2.5、§7.4，修复旧缺字段讨论仅取消已读手选资料时的范围核对偏差；不重开已补齐的自主发现或原七模块。**R1工程差额关闭**：实际UI/旧API及独立正反例通过，完整check 2894 PASS/111 SKIP/0 FAIL，非作者Spec/Standards与四原则均0项未解决。不预签v1.2整体产品验收。

## 基线与最小实现

分支`codex/v12-strategy-purpose`、HEAD `3a529a0e381bf67b998f2b1debd242a5eed38884`。修前98文件组合`9cccb075f123d29a713ab00bdae36fface3373541f98251440d3d5dd068431a8`逐份零漂移，全部源码/原清单及本次PM报告备份在`.local/v12-pm01-r1/before/`；原两证据根的35,637份非依赖/Git常规文件固定摘要，不覆盖旧清单。

唯一产品改动为`strategy-discussion-host.ts`原历史出站守卫的一行：两个直接可选字段mode判断改用既有`discussionSourceMode(owner)`。缺字段有效selected-only语义，与正式UI及实际read-source一致；仍核成功read的历史正文，refs/catalog不提升为正文。

原Interface v3/strategy-discussion owner/profile、公共lease/verifyBeforeDispatch、native权威、resolver/权限和实际接收Task复核全部复用。没有GET回填、旧记录迁移、新scope字段强写、native裁剪、新会话/请求自动重放、SDK修改或新权限/资料平台。正式UI和已批准交互未改，不需新增Demo或逐项审批。

## 因果RED与永久回归

用户明确指定的公开接缝为正式Background勾选→原客户端PATCH/GET→实际Host/官方Pi/Provider/native，以及旧API省略字段。新增永久测试`tests/pm01-legacy-source-scope-r1.test.ts`在全新合成库通过原API建背景A/选择，关闭Host后仅去掉该合成owner的新字段，再原根重开、GET原字节不变，实际官方Pi成功读A，native marker也无scope；不读或修改真实旧记录。

- 修前`author-red-01.log`与强化原始证据的`author-red-02.log`真实失败在202≠409；第二根`author/legacy-read-baplCb/`明确原客户端省略scope、同Project仅取消A后Provider2→3且新请求含合成A正文。此为本轮隔离复现，不是原PM新增动态证据，也不推定生产发生外传。
- 最小修正后`author-green-01.log`同一反例PASS；`author-green-02.log`5项PASS，typecheck-01退出0。正式组件和旧API都在派发前409/history_scope_changed，Provider不增、输入/请求/选择/缺字段及native原字节保留。
- refs-only和catalog-only未读旧记录，清空后正常继续；已读且仍选准确A正常继续；同Project另一独立讨论仍可运行，冲突原ID重送仅回原失败回执，不再派发或假称完成。

原始source/hash/range、HTTP、Provider、native-before/after及owner保全在各新`author/legacy-*`根；不是只测helper返回值或提示词。旧API无需先迁移或切换控件。

## 正式App、旧API和受影响兼容

新实际App fixture只用原App/CSS/Host/SDK及本地合成Provider，运行根`.local/v12-pm01-r1/ui/actual-legacy-app-uorR1J/`。Root在原战略页打开合成旧讨论，保持Project及显示的selected-only不变、排除0，仅取消A“本次使用”再续发；界面准确显示本次未发送、原输入/选择/历史保留。正式浏览器不是重新造的Demo，也不是正式服务或用户验收。

`final-browser-readback.json`回读唯一PATCH200，随后原GET仍无sourceScope、sources为空、同Project；续发HTTP409/code=`strategy_discussion_history_scope_changed`/accepted=false。Provider原2次不增，native原12,846字节/SHA `deb2e1c34b920d38eed45b48ac0f678cf442f81f6e2d224edc65708a399dd79d`不变，新请求未写入native。原输入、请求ID及fingerprint一致；讨论1/Goal0/Task0，没有另建或重放。截图/完整AX在`ui/screenshots/01-legacy-before.*`、`02-only-unchecked.*`、`03-legacy-conflict.*`。

| 验收接缝 | 实际结果与证据 |
| --- | --- |
| 正式组件及旧API取消真实已读A | 永久5项测试中两条路径通过；旧客户端只清空sources、不传scope、不必GET迁移，同样派发前409。原输入、选择、请求身份、native保留 |
| 不误阻 | refs-only/catalog-only清空可继续，已读仍选准确A可继续；同项目另一独立讨论可继续。没有将目录或手选提升为已读正文 |
| 新自主/限选/排除/无Project | 非作者自有8场景含零手选自主实际find/read、显式空限选、无Project正常独立工作；其余准确版本、持续排除及项目边界由受影响长期测试复验 |
| grant/模型出口/来源Task/接收Task | 原资格resolver、实际接收者读取口无改动；非作者受影响回归与完整检查核原拒绝/允许，不借旧讨论资格绕过接收者核权 |
| 停止/重复/UNKNOWN及原主链 | 原公共生命周期保持；相同失败请求只返回原回执。Goal→Plan→所选单多Task、两种确认、明确综合责任继续由原主链回归核对，不新建替代流程 |

只约束受影响讨论的历史派发；不裁剪旧正文，用户无需重抄、重建Task或重编Plan。

## 检查、固定候选及独立复核

实现冻结`.local/v12-pm01-r1/implementation-source-01.json`：100文件组合`cd7aea7bee846a8f31b779f38cc4795c0d296fe314ecd0080c312bbb8e944e66`，68运行/测试/脚本文件组合`399f0770ef7c3c2d72478be0098f945f6175e9fa2475e7ce28c3292c925d3fd2`。相对旧98文件，只有1行产品源、1份新增永久回归和3份工程文档有差额。最终结果文档补齐后另冻`candidate-source.json`，不改写实现冻结01或旧清单；组合算法为路径排序数组、键排序紧凑UTF-8 JSON的SHA256。

完整检查在`/Users/Shared/optracall-r1-check-0_kamk2l/source`独立普通目录副本执行；1773份实际源码及现有依赖作普通APFS副本，不创建共享链接、不安装或改SDK。测试临时根在正常OS目录、在所有codeRoot外；祖先目录无仓库/AGENTS/CLAUDE。旧固定输出脚本只在新副本运行，原证据不被覆盖。`npm run check`退出0：3005项，**2894 PASS/111 SKIP/0 FAIL/0 cancelled/0 todo**；公共会话边界、类型检查、Vite构建及stamp均通过，原bundle大于500kB警告保留。实际输入/命令/日志/回读见`.local/v12-pm01-r1/full-check-copy.json`、`full-check-result.json`、`full-check.log`；日志SHA `f998a2e8c9e84c8ecff2fdda1e1cf61184aaaa54859ace427293e7203f8b6277`。

- Spec非作者先从产品/PM报告导出独立oracle，冻结后自有真实Host/Pi探针8/8通过、22次本地Provider请求errors=[]；两个取消已读反例均409/Provider增量0/native精确不变；另6份受影响长期测试22/22通过。报告`.local/v12-pm01-r1/review/spec/review.md`及`verification-receipt.json`。
- Standards非作者独立4场景通过（已读取消2→2、12,480字节native保全，另外三个正控可继续），5份受影响长期测试50/50通过，公共会话边界脚本PASS；四原则及规范0项未解决。报告`.local/v12-pm01-r1/review/standards/final-review.md`。两位复核均独立复算100/68文件组合和实际Git文件集合，未以作者GREEN代断言。
- `.local/v12-pm01-r1/preservation-readback-01.json`及完整检查后的`full-check-result.json`复核：原98源码备份、原候选清单和35,637份历史常规证据零漂移；完整检查副本1773份源码及100候选逐份零漂移，原工作树68运行文件与已检实现完全相同。两处node_modules均普通目录、无嵌套自链。最终收尾只补本结果/清单/spec文字，按新清单再由非作者回读运行集不变，不重复伪签完整检查。

实际UI隔离服务已停，仅本轮进程/三个loopback端口核退出；wrapper实际SIGTERM/143，Host单独退出码未捕获为UNKNOWN，未冒称normal0，见`services-stopped.json`。Spec首轮探针7场景通过后，自己的无Project准备错误地预期能查另一Project，Host正确403；原失败/脚本/cleanup保留，修正探针后8场景完整重验通过。这不是产品RED，也不隐藏为绿色。

## 分层与历史

本轮未执行真实模型/业务资料/活库/外部业务请求、设备、Git提交/推送/远端CI/合并、正式schema3迁移及兼容回退或SDK升级；未重新核定正式服务版本。候选未提交，仍保留原HEAD与分支。正式采用前须另核有效授权、保全届时最新资料并准备且实测兼容回退，当前不能宣称已准备或采用。

| 层次 | 本轮状态 |
| --- | --- |
| R1工程实现/隔离接线 | 已关闭；正反例、真实App、完整check及非作者Spec/Standards/四原则通过 |
| 真实自由Agent自主采用/专业正确 | 未新增实验；自主选材、补证、TOC/TP/所选Skill及IR实质采用、因果/综合/审查修订质量均待验证 |
| 后续资产纠错与新任务复用 | 原接缝不变；IR/Studio/记忆/Case完整专业采用链不由R1判通过 |
| Git/CI交付、正式运行采用 | 未执行；正式迁移/兼容回退/双机及SDK按各自授权另办 |
| 用户产品验收及经营效果 | 未发生；正式PPT/活库/天气网络和真实经营反馈/成熟观察窗口亦待验证 |

可交用户/产品PM核对的固定候选场景为：旧合成讨论已经成功读取A→仅取消A→409保留原输入与历史；旧API同路径；refs/catalog未读清空及仍选A正控。以上均是隔离合成环境，不代表生产发生外传或v1.2整体产品验收。

原FAIL/UNKNOWN/SKIP、已接受范围的历史TDD NOT_PROVED、四份旧派生GREEN不可恢复/旧归属UNKNOWN、依赖自链接事故及撤回的隔离声明保留；data-analysis本体/免测决定不动。新绿色不覆盖历史，不能宣布v1.2全部产品验收通过。
