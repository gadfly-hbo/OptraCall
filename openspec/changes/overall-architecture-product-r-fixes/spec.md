# 产品差额续修 R-03／R-01／R-02

2026-11-16。用户认可最新独立产品复核，授权继续完成三个具体修正和相称隔离工程验证。沿既有七模块和已补的五组能力实施，不重新访谈方向或缩减单/多Task范围。

## 输入、权限及保全

- v1.1稳定副本：`/Users/bendandebaba/.codex/plans/optracall-upgrade-v0.2.0/input/OptraCall_Overall_Architecture_Product_Plan_v1.1.md`，SHA `98461897225f0e69d3d6619e93dc6ef02fdf5912d685d11fe7f5ad08157cd5f5`。
- 最新PM复核：`/Users/bendandebaba/.codex/plans/optracall-upgrade-v0.2.0/product-review/OptraCall_v1.1_Product_Gap_Candidate_Review_5a295491_2026-11-16.md`，SHA `4d69fda0e2528d97320699338347665055f96657318d860f285395f03c22c41c`。全文和产品方案继续在仓库外。
- HEAD／main／新fetch后的origin/main均为 `9607e53daddaf38cac1c7a0b16a56dcb251e7eff`；当前分支 `codex/overall-architecture-product-gaps`，复用用户指定e741工作区，不切换其他工作树。
- 原39个源码/测试文件无漂移，原摘要 `5a295491834f549d8af46d2cb63fd490796d6f25c622edcbe40f4cf7103580a4`。开工前另存39文件清单和全部44个源码/工程文档于 `.local/overall-architecture-product-r-fixes/input-5a295491/`。旧清单、旧检查、旧复核及原失败保留，修后另冻新清单。
- 授权当前三项实现、合成数据、官方Pi＋本地合成Provider、适用本地完整检查和独立复核。Git公开提交/推送/远端CI/合并、正式迁移/双机更新、真实模型/活库/天气、安装/SDK升级未新增授权。

## 产品验收与最小接缝

| 标识 | 产品条款及完整可观察结果 | 必须覆盖的正反例 |
| --- | --- | --- |
| R-03 P1 | v1.1 §1.1/4.3/4.4/6.1/6.2/11.3/11.5。在原首次派发校验中，按同一lease实际模型、当前原grant/出口及Task策略，复核实际将发送的全部DB投影和原预选引用。变化时准确拒绝或重建输入，选择保持，不暗删/扩权/重复grant/读明细。 | 官方worker打开受控等待；目录生成后撤销未预选来源或改出口，Provider不得收到旧元信息；预选项目资料和Task能力同窗口；Task排除/范围变化；无关未出站来源变化不误阻；原A/B、初始拒绝、正式Task原工具权限及driver0保持。 |
| R-01 P2 | §2.1/3.1/3.3/4.5/11.3/11.5。合法旧Task从Case直接续问，也经原GoalVersion准确供给主/相关目标正文。明确本次Case上下文优先于不一致的历史Plan，不把旧A背景冒充本次B。 | 同一旧Task无Plan、Case准确目标两版进入实际请求；失读/无权准确提示，原选择/历史保持，不新建Plan/Task。旧Plan/CaseA→显式CaseB一致性；原新Plan两版、轻量准备、两种确认兼容。 |
| R-02 P2 | §3.2/8.2/9.2。复用原work/Goal/Plan资格、真实用户原话和Board授权CAS，对对应原授权追加revoke，保留原authorize/安排/实际发生及效果。 | 实际Pi无Case安排→明确撤回；准确原行动追加一条revoke，重复不增；越权/含糊/版本变化拒绝或集中澄清；GSA/Board读原授权状态；旧Case授权撤回、create/reuse、partial/UNKNOWN及停止兼容。 |

R-03原PM发现是静态调用链结论，本轮动态反例获得前不写成已实测泄露，更不推断正式业务泄露。R-01是保留兼容支路缺口，R-02/03是上一候选新增接缝回归；原PM-02/04和PM-03安排主能力保留。

## 接入、职责、允许修改路径及测试接缝

工程规范v1.12、Interface v3；原project-tasks普通profile、requirements-elaboration真实owner/配置捕获/续接策略、Case/Goal/Board/DB权威不变。Host提供准确上下文、权限和记录，Agent决定方法、分析、补证及协作，不新增专业流水线、Runtime或SDK实现。Pi1.4.0及原获准官方依赖保持，不改包、不升级、不增加底层导入白名单。

- R-03沿 `createProjectPlanPreparationHost` → 原 `RequirementSessionLease.run(verifyBeforeDispatch)` → 公共 `agent-sessions` 原首次派发gate。预先固定的出站投影只为本操作验证，不成为持久权限台账，不全程扫描或追回已发内容。允许修改准备Host/其薄投影校验及原错误展示。
- 为准确控制原worker打开等待，requirements Host options只透传公共域已有的可选 `createAgent` 依赖注入，默认仍由公共域创建；不改变Agent port/Interface或生命周期。测试在原已获准 `tests/requirement-runtime.test.ts` 包装OptraCall自有ProjectAgent公开open，实际官方worker打开后等屏障，仍经原domain派发；不改SDK对象/原型，不扩白名单。
- R-01沿原server请求/CaseContext、GoalStore准确读取及既有Plan目标供给，必要时提取同源薄helper。server由R-01作者单写，R-02所需callback接缝通过其代接；不跨写他人文件。
- R-02沿原quoted-decision工具/session/runtime业务资格、Host callback、原Board Store授权/操作回执和原GSA/Board来源展示；不新增权限/经营执行平台，不扩大无Case自动反馈范围。必要UI仅原位只读授权状态，不新增表单/导航/关键确认流程。
- 用户已明确指定的公开验收接缝：原Host HTTP/业务facade、原公共会话派发、实际官方Pi/本地合成Provider、原Goal/Plan/native和Board授权回读。以这些接缝做动态RED→GREEN；不照实现重述，不用fixture/环境失败代产品RED。原始日志/唯一现场持久留在本轮.local根。

## UI、验证及完成条件

沿批准v0.2原Case“继续提问”、聊天表达授权/撤回、原GSA/Board展示和原Project准备交互，无明显布局/关键流程变化，故不另造Demo。必要精确错误与原位事实显示做相称验证；若实际必须实质改变界面流程，再仅为受影响部分准备Demo并确认，其余独立实现继续。

各项有效动态反例、正向/关键禁止副作用、原功能兼容完成后，重新冻结全部源码/测试及工程文档，运行届时完整 `npm run check`，由全新上下文且非任一部分作者的复核者按规范/产品规格独立审查。当前旧2801/111/0及两轴0只是原候选证据，不代本轮结果。

收尾更新七模块矩阵及上下游，分别报告工程、自由Agent自主采用、专业、运行采用、用户验收和经营效果。真实专业全链、正式PPT/活库/天气/全App仍待验证；data-analysis免测决定保持。原check03 GET409、PPT FAIL、MacBook .git mtime FAIL/写入者UNKNOWN及全部历史保留。正式Board4→5/GSA1→2未迁移，不触真实库；将来采用与可读新schema的兼容回退仍按有效授权核定。
