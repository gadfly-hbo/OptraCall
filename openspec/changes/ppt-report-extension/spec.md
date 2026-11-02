# ppt-report-extension

2026-11-01 · 讨论候选：本规格与 [UI 演示](clickable/index.html) 同步提交用户确认；确认后申请实施授权，当前不改产品代码。

已确认决定（[产品讨论稿 v0.7](../../../docs/ppt-report-extension-proposal.md)）：两部分方案——A「PPT 生成 skill」（分析资产首个 skill，**MIT 组合底本**：生成向 `minimax-ai/skills@pptx-generator` + 编辑向 `claude-office-skills@pptx-manipulation`；Anthropic pptx skill 专有许可仅作方法论参考，任何文本/代码不入仓；用户手动触发）+ B「逐页精修插件」（reports-factory 仅逐页修改工具接入，独立会话 + md 报告只读锚点）；D1 编辑链路为 XML/ooxml 级编辑为主 + 单页重生成为辅，不引入自定义可重渲源工件，.pptx 是唯一事实工件；D4–D8 与视觉基线按讨论稿 v0.5/v0.6 确认执行。

## 范围与责任

- **A · PPT 生成 skill**：Qoder 交付 `extensions/analysis-assets/ppt-report/`（暂名，下同）：`SKILL.md`（内容守则红线：不编造、来源绑定、数字逐字、推断明示、0 emoji）+ 底本工具集脚本（编辑向 ooxml/python-pptx、生成向单页重生成——MIT 资产引入并保留版权与许可声明）+ **版式规范资源**（色彩系统、字体栈、页型模板——吸收 reports-factory 实测设计系统与用户参考 skill 的优势项）。使用者是产品 Agent；输入 `060_reports` 正式 md 报告，产出候选版 .pptx（唯一工件，归档 060_reports）。
- **A · 触发入口与生成会话**（Codex 薄挂载，MF-03「发起建模任务」同型）：报告页显式「生成 PPTX 版本」入口，在项目内创建普通任务会话并预填生成引导，skill 经分析资产发现；分析需求已显式声明 PPTX 的任务在报告完成后提示直接生成。不新增会话域。
- **B · 逐页精修插件**：Qoder 交付 `extensions/business-plugins/ppt-refiner/`（api/session/ui/storage/types + 版本快照与差异清单存储）。读取候选版 .pptx，独立对话逐页精修：页网格预览、选页对话修改（Agent 底层 ooxml 编辑/单页重生成，用户不接触 XML）、视觉自检（页图回传模型，页型区分留白容忍）、页锁定、版本快照回退、终版导出 + 与 md 报告的差异清单。
- **Host 接入**（Codex，IN06 契约共同维护）：`agent-sessions.ts` 静态注册 `ppt-refiner` 域/profile；`server.ts` 路由、`App.tsx` 导航与报告页入口；`project-session.ts` skill 发现/任务预填挂载核对；能力目录「分析资产」新增 PPT 报告生成「已接入」条目（catalog-data）。

IN01 记录：工程规范 v1.1；Interface **v3**（公共会话入口，无新接缝能力诉求）；`ppt-refiner` 域 owner 绑定 projectId + 报告/deck 标识；profile 差异仅声明：准入（报告页显式打开候选版）、模型（项目绑定配置，需图像输入，不支持时视觉自检降级并提示）、工作区（对应 060_reports 报告目录）；多 turn 精修无自动重放。

## 验收标识（全部使用合成数据）

| 标识 | 可观察验收 |
| --- | --- |
| PPT-01 | （P0）页图渲染管线：合成 .pptx 逐页导出页图（全尺寸 + 缩略），页数页序正确、耗时与环境依赖记录成文；所选管线不可用时降级行为明确。环境安装（如 LibreOffice）另获授权。 |
| PPT-02 | （P0）单页重生成拼回：用生成向工具重做单页拼回原 deck 后，其他页 XML 字节不变、页序正确、关系/媒体引用完整（可正常打开）。 |
| PPT-03 | （P0）skill 发现与注入：仓库分析资产目录中的 skill 被产品 Agent 会话实际发现、可调用；受保护执行下经快照可用；发现挂载方式成文记录。 |
| PPT-04 | A 生成 skill：合成 md 报告 → 候选版 .pptx——数字与 md 逐字一致（程序化核对，含文本框与图表数值缓存）、结构完整（封面/目录/章节/结尾）、0 emoji、原生可编辑文本框；**视觉基线（已确认）：版式规范随 skill 入仓，候选版与基线样张并排核验，观感不低于底本示例与 reports-factory 一版 skill 实测产出**；内容红线写入 skill.md；Agent 不自动触发。 |
| PPT-05 | A 触发入口：报告页显式「生成 PPTX 版本」；生成会话独立于原分析会话，产物落 060_reports；已显式声明 PPTX 的任务在报告完成后提示直接生成；无声明不生成、不提示打扰。 |
| PPT-06 | B 精修闭环：读取候选版 → 页网格预览 → 选页对话修改（文字/数字/位置）→ 页图刷新；未改页与锁定页 XML 字节不变；用户全程对话，不接触 XML。 |
| PPT-07 | B 视觉自检：选页截图回传模型出问题清单（遮挡/溢出/对比/字号），按页型区分留白容忍（封面/章节页大留白不算缺陷）；模型不支持图像输入时降级提示。 |
| PPT-08 | B 版本与锁定：每轮修改自动存快照（文件副本 + 元数据），可回退任意版，首期不自动清理；锁定/解锁显式；锁定页不被修改、单页重生成与批量操作触碰；导出不受锁定影响。 |
| PPT-09 | B md 锚点与差异清单：精修会话只读携带 md 报告；数字/事实改动与 md 的出入被标记；md 中不存在的数字不静默写入（提示确认依据）；导出终版生成差异清单；不自动改写 md 报告。 |
| PPT-10 | 统一会话接入合规：`ppt-refiner` 域经 Host 静态注册（IN02）、公共生命周期（IN03）、无平行 Runtime/SDK 直连；导入约束检查进 `npm run check` 与 CI（IN07）；精修取消/关闭/迟到结果路径有测试。 |
| PPT-11 | 端到端合成验收（D8）：md → 手动生成候选版 → 逐页精修 → 终版导出 060_reports；① 终版数字与 md 逐字一致（程序化核对）② 单页修改隔离（未改页与锁定页字节不变）③ 原分析会话不受污染 ④ 版本回退可用 ⑤ 页图预览与视觉自检可用。 |
| PPT-12 | 资产目录可见性：能力目录「分析资产」出现「PPT 报告生成」已接入条目（名称、说明、版本、适用条件，使用入口指向报告页生成按钮）；skill 随产品内置分发，无用户安装步骤；不出现市场或第三方导入入口。 |

## 允许修改

`extensions/analysis-assets/ppt-report/`（新建全部）；`extensions/business-plugins/ppt-refiner/`（新建全部）；`src/host/server.ts`、`src/host/ui/`（路由、导航、报告页入口、精修页）；`src/host/agent-sessions.ts`（域注册）；`src/agent/project-session.ts`（skill 发现/任务预填，按需）；`tests/`；`package.json`/lockfile（最小新增依赖）；`docs/` 与 README 适用条目；`openspec/changes/ppt-report-extension/`。不改 SDK 版本，不动三目录规则与 `project.json` schema，不建插件注册框架，不新增第二个 Runtime。

## 关键边界

- 触发仅用户显式（分析需求已声明 PPTX 除外）；生成与精修会话均用户发起，不自动调模型。
- md 报告是内容权威：精修直改允许但必标记差异，不自动改写 md；回填由用户在报告侧另行处理。
- reports-factory 只有逐页修改工具的**机制**进入本变更（移植重写，非代码整搬）；其会话宿主、服务端、材料摄取、预算账本、双机同步不进入 OptraCall；精修会话严格走统一 Agent Runtime 底座与 IN01–IN07。
- 首期只面向本产品 A 产出；不提供外部 .pptx 导入入口与兼容承诺。
- 视觉自检页图随模型请求外发：内容源自已审 md 报告，沿用项目模型配置与数据出口边界；公开仓库只含合成样例。
- 环境安装：LibreOffice 已获用户授权并完成安装（2026-11-01，brew --cask）；底本引入按 MIT 许可执行（minimax-ai/skills、claude-office-skills/skills，入仓时保留版权与许可声明）；**Anthropic pptx skill 为专有许可，仅方法论参考，任何文本/代码/资产不入仓**。
- skill 对分析会话是可检索引用的软资产（按需选用），对精修会话是核心工具集；不承诺模板数量丰富度，但承诺版式规范基线与视觉验收（PPT-04）；skill 随产品内置分发，无用户安装步骤，不提供市场/第三方导入入口。

## 适用检查

P0 三项（PPT-01/02/03）为前置技术验证：真实路径 spike、证据成文、不写产品代码；A/B 主体按 TDD 先行（差异核对、字节断言、锁定拦截等纯函数优先）；Host 挂载纳入既有 HTTP/UI 测试与浏览器合成 fixture 回归；完整候选走非作者独立复核与 CI（`npm run check` + 依赖审计，覆盖新增依赖）；Git 交付按工程规范第 5 节执行。

## 未决问题

- skill 目录/名称定名与 MIT 底本工具集进入仓库的精简范围（含版权声明放置）。
- A 生成会话与原任务的关联呈现（是否在任务区显示生成记录指针，实施时按统一会话规范定）。
- 页图渲染管线最终选型（以 PPT-01 结论为准）。

UI 细节以 [clickable 演示](clickable/index.html) 确认为准，确认后冻结为本变更验收组成；演示标注的交互为验收对照，静态演示不构成实现证据。
