# OptraCall v1.3 增量工程与验收清单

## 开工依据

用户在工程会话授权执行开发包，PM 确认回执覆盖送审时的状态。固定目录 `/Users/bendandebaba/.codex/plans/optracall-architecture-product-v1.3/OptraCall-v1.3-development-package`。`manifest.sha256` 逐文件核对通过。框架 v0.8 `5262d89aa802344ac666c43dbfb7f46aaa5ce27524eb94d0e7de4e50cb35bd9a`，规格 v0.3 `be1b89591be747a3fdc674350e9c10783e789afedb3d1eef2f266eba58399ea6`，角色和 Skill 补充 `4cf471ef0e58223af419d4192bfbc04f87dc8d80818abffad21af8d7f537cd44`，界面清单 `ca29be242a21f1a5057e8f2499b381f62e4e77c7bb4b1cabd7b38cd99a9575c2`。Demo 身份以包内逐文件清单为准。

独立工作树 67e5 起始无 WIP，首次 fetch 后 `OC｜upgrade-v0.3.0` 跟踪同名远端，分支未被占用。基线、origin/main、Mini 主仓和正式 `/api/health` 的加载提交均为 `69e766f10c1034cb335bdbb7b22540a0b26cd074`，正式服务 ready、Pi `1.4.0`。固定输入与本轮实现、独立复核和采用分别记录。

## 工程边界及任务

沿工程规范 v1.12、IN01–IN07 和 Interface v3。Host 绑定准确来源、owner、模型、工具权限、SDK 生命周期和写入结果。Agent 自主选择读取、工具、顺序、因果分析、补证和修订。原 Pi 1.4.0 公开契约，沿既有共享工作区、SAP、SCR、看板和业务插件。用户只在创建任务、采用、取舍、授权或需固定业务事实时决定。

| 规格 | 工作与正式验收入口 | 进度 |
| --- | --- | --- |
| T0/C5 | 固定框架、规格、补充、审核清单与可点击 Demo，核对远端及运行身份 | 已完成 |
| T1/C1,C2,C6,C10 | G/S 对应实变、准确采用、Case 创建/重试/跨年、旧记录；按 Case/事项与跨范围验证 | 进行中 |
| T1–4 | 战略讨论 owner、范围/Goal 或草稿、Case/事项、Project owner，各自 role system prompt 真正进入 Pi；保存重开、停止、撤权、迟到结果 | 进行中 |
| T2/C3,C4,C10–12 | Project 独立与阶段、六类用户建 Task、同类多建、配置默认/取消与旧会话；单 Task 首发、按需约定、精确交接和无 Plan 综合 | 进行中 |
| T3/C2,C7,C12 | 同问题多轮取舍、准确 Plan、单独人授权、原看板实际、Teach 原回复、无改善及暂缓、共享 Project 隔离 | 进行中 |
| T4/C8,C9 | 因果与改判条件，SCR 当前语义和版本，SAP 已发布 IR，跨粒度、权限与原成果；工程与专业质量分记 | 进行中 |
| 专业 Skill | 五个候选、自检、冻结、交用户组织独立测评，确认相同身份后采用；Analysis 复用 data-analysis 2.0.0-candidate.1 | 进行中 |
| UI §6–8 | 批准导航、设置、原 Studio 资产和准确链接、三处独立收起、七个同会话抽屉、草稿与操作保全 | 进行中 |
| 导出 §9 | 战略准确原稿单独保存，GSA 同版 G/S/A；单 HTML 离线、历史/失读/撤权和无副作用 | 进行中 |
| T5 | RED/GREEN、完整回归、正常入口隔离点验、非作者规范及规格双轴复核，固定候选、回退与 PM 回交 | 待执行 |

按附录规格 §1.1 的 owner/profile 与来源验证，具体接线、许可和证据记入各项实施记录。兼容采用追加/选填字段，原业务记录、native 会话和固定版本保全。开发、测评、Git 交付、生产迁移、双端采用与用户产品验收均按各自实际授权和证据记录。
