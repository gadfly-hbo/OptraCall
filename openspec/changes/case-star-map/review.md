# Case-Star-Map 准备核对

2026-11-14（北京时间）· v0.2确认包 · **准备完成，待用户整体确认，未启动产品开发**

## 范围与候选

用户授权准备 [spec](spec.md) 和 [合成内存 UI Demo](../../../docs/prototypes/case-star-map-ui-demo.html)，整体确认后才开发。准备基线为 `OC｜Case-Star-Map`／`ef3e7d0b8703a6e22023e8099a56c542d484a69d`；开始时工作区干净。

本轮仅新增：

- `openspec/changes/case-star-map/spec.md`
- `openspec/changes/case-star-map/review.md`
- `docs/prototypes/case-star-map-ui-demo.html`

候选摘要、命令结果及截图放在本树 `.local/case-star-map-preparation/`，仅含合成材料。没有修改既有产品／测试／依赖／规格／原型，没有运行Host、读真实业务根、调用模型、提交推送或切换设备服务。本轮没有产品RED、工程实现验收、CI、真实模型或用户产品验收结论。

## v0.2 导航与命名增量

用户要求移除Demo额外增加的Decision侧栏入口、保持现有导航，只调整Case看板；同时将显示名改为Decision Case及Project Map。本次只更新同一三文件确认包，v0.1原件／摘要／预览已保存在 `.local/case-star-map-preparation/history/v0.1/`，原失败和复核记录不改写。

已按当前产品 `App.tsx:547–559` 对齐：侧栏保留新建项目、Decision Case、Project Map、语义与分析资产、插件市场、原项目导航和设置；顶部保留原分析／决策及帮助入口。Decision Case同步到标题、当前位置和模式名称，Project Map同步到项目跳转模拟。原决策功能以“决策工作台”称呼，原行动／反馈详情仍可达。Project Map仅改显示名，不新增项目图谱或改变项目工作流。

本次增量证据根为 `.local/case-star-map-preparation/v0.2/`。独立非作者增量静态复核为12项PASS／0FAIL，无必须修复项，[完整报告](../../../.local/case-star-map-preparation/v0.2/independent-review/final-review.md)与候选摘要、diff、语法结果均保留。作者用CUA实际核对Project Map跳转模拟标题、顶部原决策入口到达行动／反馈、1440px桌面布局、390px菜单及键盘打开Project Map；窄屏 `documentWidth=viewportWidth=390`，当前预览已刷新。证据为 `scope-check.json`、`browser-checks.json`、`mobile-navigation-ax.txt`及桌面／窄屏截图。

v0.1的14组逻辑结果只支持未改变的关系／历史逻辑，不自动证明v0.2导航；本轮精确脚本diff确认仅显示名替换和原导航shell动作接线变化，未重跑关系14组。非作者没有操作浏览器，作者CUA结果没有记为非作者验证。复核后spec只更新P3／P4状态，review只补实际结果；最终三文件身份见本证据根 `confirmation-manifest.json`。产品源码、测试、依赖、Git提交和运行服务均未改变。

## v0.1 自检与实际结果（历史）

| 项目 | 状态 | 范围及证据 |
| --- | --- | --- |
| 基线与复用核对 | 完成，只读 | spec第2节；图索引 `optracall-case-star-map-aada`；CaseStore schema1/2、M5工具、真实owner及M6来源已核 |
| 文档链接／范围 | 通过准备范围 | 最终引用与新增文件清单回读，见 `.local/case-star-map-preparation/final-static-check.json`；初始仅因Demo／本记录尚未建立的扫描结果原样保留 |
| Demo脚本语法／离线边界 | 通过准备范围 | 提取内嵌JS执行 `node --check`；无外部资源／network/storage API、重复静态ID；合成内存状态 |
| 桌面／窄屏／明暗／键盘 | 通过已点验范围 | 作者经CUA Chrome点验；1440×900、1024×768、390×844；窄屏页面无水平溢出，新进窄屏自动展开等价清单。工具缺失及原检查现场保留，未安装替代依赖 |
| 非作者复核 | 通过静态／独立逻辑准备范围 | 全新上下文只读；14组PASS／0FAIL。初始S01、D01–D05均关闭，无剩余必须修复项；不冒称非作者浏览器验证 |
| 四原则准备检查 | 通过本包准备范围 | spec第7节及独立报告：原owner／普通unmanaged、窄业务port、Pi/Interface复用；正常新增必做管理／逐条审批为零。产品实现仍未验证 |

### 实际浏览器检查

作者核对了默认图谱与共享项目去重、Case／项目／分析任务直接打开、库存任务搜索显露必要路径、返回保留搜索和缩放、常规方块／列表、支持的准确源和目标、纠正v2保留v1、解除v3后Case详情历史仍可达。源Case结束仍能引用，目标Case结束后的纠正／解除禁用；来源新版与失读保留原准确引用。加载／空白／全量失败／部分缺失／聚合状态有不同表达。

1440明暗及1024布局已视看，390首次加载有展开的等价清单，`documentWidth=viewportWidth=390`；1024也无页面水平溢出。键盘Enter可打开Case详情，Esc回到原节点；新建Case弹窗首焦点为名称，Tab循环及Esc返回触发按钮已核。浏览器错误控制台读回为空。证据为 `browser-checks.json`、`keyboard-check.json`、`state-1.txt`至`state-5.txt`、AX记录和截图；不是完整WCAG审计或产品性能验收。

### 独立复核、发现及修正

非作者[完整报告](../../../.local/case-star-map-preparation/independent-review/final-review.md)与首轮失败／候选快照保留。S01为前后续零外部来源时缺声明定位，已补原操作＋关系修订或真实请求入口，并区分声明与独立证据。Demo初轮D01–D05分别为缺声明入口、缺准确支持目标、解除历史不可达及重补新身份、修订内容／作者覆盖、缺原新建Case入口；作者修正后，独立逻辑验证同R2解除v2／恢复v3及旧版本值保全、准确目标与未绑定目标区分、声明入口和内存新建Case等14组通过。

作者浏览器另发现前后续连线被未关联项目遮挡，已改路由并视看关闭；两处关系性质／只读范围文案随后收窄。浏览器曾在已解除R2的内存状态点击该当前边而定位失败；先核实际UI，再刷新合成种子验证目标结束只读，没有把该定位失败当产品失败或无解释重试。非作者最后文案身份核对也曾因脚本转述文字不精确失败，实际diff核对后关闭，原记录均保留。

### v0.1 候选身份（历史）

- 最终Demo SHA-256：`b04a952d85244c2413c8af0da943cf13583a69f01bca8e707c6e5d0952f42d6d`。
- 非作者合同spec SHA-256：`c3d93f6def1014b5096fb58a01dc65722194ee6bf6c276fa62f56adce88a55f2`。之后只将P2–P4准备状态更新为完成，未改合同，差异保存在 `spec-preparation-status-only.diff`。
- 14组逻辑实际Demo为 `ba7167fb8deb894c5486df28684a41f38ef068a286d93151904297ac5a41e42f`；最终仅一段只读提示文字不同，非作者已做精确diff核对，无行为变化，旧逻辑证据仍适用。
- 当时三文件摘要已保留在 `.local/case-star-map-preparation/history/v0.1/confirmation-manifest.json`；review自身不内嵌自己的哈希，避免循环身份。

## Demo边界

页面中的Case、项目、分析任务、策略、人的选择、行动任务、反馈、来源及关系历史均为虚构。打开任务只是模拟已有工作台；关系补充、纠正、解除只改页面内存。预置来源和响应不能证明真实Pi工具、CaseStore迁移、权限或业务效果已实现。

大图24项为聚合示意，仅提供3项代表条目，不能表述为完整24节点的搜索／性能验证。人的选择以“绑定原策略准确版本”表达，没有逐项展示具体choice ref；确认后的产品须沿原准确取舍入口核实。Demo未模拟真实CAS冲突、保存UNKNOWN、从未启用、SDK取消或迁移，这些仍按spec第8节留在产品开发验收。没有为准备包安装产品依赖或运行产品全量测试。

开发后仍须完成spec第8节的真实动态行为RED、产品实现、完整适用检查、隔离合成Host／Pi路径、迁移与保全、非作者及四原则专项。Demo点验仅用于本包的界面和合同确认。

## 当前停止线

v0.2增量核对已完成，现提交整体确认。用户确认并允许继续后沿spec清单进入开发；若另要求等通知，保持停止。不因准备复核通过、浏览器可点或文件已存在自行启动产品开发、Git交付或运行采用。
