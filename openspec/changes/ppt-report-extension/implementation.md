# ppt-report-extension 实施记录

## A · PPT 生成 skill（2026-11-02 交付）

**交付物**（`extensions/analysis-assets/ppt-report/`）

- `SKILL.md`：内容红线（不编造/数字逐字/来源绑定/单焦点/克制密度/0 emoji）+ 生成工作流 + 精修工作流 + 资源索引；Host 管环境、Agent 自主写代码自检，无确定性组装器。
- `references/design-system.md`：13.33×7.5 画布、navy/accent/paper 三色系、字体字号梯度、页型模板（封面/目录/章节/文本/KPI/图表/对比/结尾）、密度与留白规则（封面章节页留白容忍）。
- `references/python-pptx-guide.md`：主路线代码骨架与页型模板（含 eastAsia 中文字体、边距、阴影、溢出陷阱）。
- `references/pitfalls.md`：QA 循环、soffice 闸门、PDF 文本层不可信、拼回与 zipfile 陷阱。
- `references/pptxgenjs.md`、`references/editing.md`：minimax 底本原样（MIT，来源头注），可选 JS 路线参考。
- `scripts/digit_check.py`：数字逐字核对（slide `<a:t>` + 图表缓存 `<c:v>`），零依赖。
- `scripts/page_images.py`：页图管线（前后闸门→soffice→页数核对→全图+缩略）。
- `scripts/splice_slide.py`：slide 级替换，媒体 rId 重映射 + Content_Types 更新，保留目标页 layout，旧 notes 移除，其余条目字节不变。
- `LICENSES.md` + `references/LICENSE-minimax.txt`：来源与 MIT 许可；Anthropic 专有许可未采用任何材料。

**验证**

- `tests/ppt-report-skill.test.ts` 7/7 通过（数字核对正/反例含图表缓存；拼回简单/媒体/越界；页图闸门；真实 soffice 渲染）。本地 `PPT_REPORT_PYTHON` 指向隔离 venv；CI 中真实渲染用例在无 soffice 时自动跳过。
- SDK 实测：`loadSkillsFromDir(extensions/analysis-assets)` 发现 `ppt-report`；`snapshotProtectedSkills` 快照兼容（PPT-03 资产侧落地）。
- 端到端冒烟（无模型）：按 guide 骨架生成 3 页合成 deck → digit_check OK → page_images 3 页 OK。

**待接（后续任务）**：Host 挂载 `additionalSkillPaths`（Codex 侧）、报告页生成入口（PPT-05）、B 精修插件（PPT-06～09）。

## B · 逐页精修插件（2026-11-02 交付，Qoder 侧）

**交付物**（`extensions/business-plugins/ppt-refiner/`）

- `types.ts` + `storage/deck-store.ts`：deck 注册、版本快照（原子写）、回退（先存当前）、页锁定、终版导出 + 差异清单（不回写 md）。
- `scripts/edit_slide.py`：run 级文本替换，字节隔离；`--report` 锚点拦截未覆盖数字，`--allow-uncovered` 供用户确认直改。
- `session/workspace.ts`：精修会话提示词（md 锚点只读、锁定页不触碰、数字红线、页图自检、last-turn.json 差异捕获）。
- `api/routes.ts`：create/get/locks/revert/export/turn/stop/render/image；turn 按字节变化快照并消费 last-turn.json；render 直接跑确定性页图管线（不经模型）；Host 绑定 transport，插件不建会话/端口。
- `ui/RefinerPage.tsx` + `refiner-client.ts` + `refiner.css`：页网格真实页图、选页对话、版本历史回退、导出与差异清单。

**验证**：`tests/ppt-refiner-core.test.ts`（7）、`tests/ppt-refiner-api.test.ts`（3）全绿；`npx tsc --noEmit` 干净；`vite build` 通过。

**待接（Host/Codex）**：`agent-sessions.ts` 注册 `ppt-refiner` 域/profile 与 facade 适配（参照 requirement-sessions.ts）；`project-session.ts` 挂 `additionalSkillPaths`；`server.ts` 挂路由（deckRoot、pythonPath、skillScriptsDir）；`App.tsx` 精修页导航与报告页「生成 PPTX 版本」入口（PPT-05）；`catalog-data.ts` 分析资产已接入条目（PPT-12）；合成端到端与独立复核。

## Host 接线（2026-11-02 由 Qoder 一次性完成，用户改派）

用户先选「留给 Codex」，随后改为主 Agent 一次做完。完成：

- `project-session.ts`：`additionalSkillPaths` 挂 `extensions/analysis-assets`（普通 + 受保护会话）；服务级实测 `ppt-report` 发现为 true。
- `src/host/ppt-refiner-sessions.ts`：Interface v3 域/profile 适配（deck 工作区、md 锚点提示词、facade）；`agent-sessions.ts` 统一生命周期，无自建 Runtime。
- `server.ts`：`/api/ppt-refiner` 路由挂载、closeAll 协调、pythonPath 自动发现（`~/.optracall/ppt-venv`，已建环境并装 requirements）。
- `App.tsx` / `ProjectSpace.tsx` / `catalog-data.ts`：精修工作台视图、分析资产与业务插件已接入条目、报告文件「生成 PPTX」动作（创建任务并预填生成引导草稿，用户确认才发送——手动触发，无自动模型调用）。
- `scripts/check-agent-session-boundary.mjs`：`ppt-refiner-sessions.ts` 登记为域注册方（IN06 契约维护）。

**验证**：`npm run check` 全绿（772 pass / 0 fail / 3 环境跳过 + 构建）。真实 host HTTP 冒烟（无模型）：create/get/locks/export/render/image/stop 全通。dev server 浏览器实测：目录进入精修页、打开 deck（3 页真实页图）、选页、锁定/解锁、版本历史、导出差异清单、报告文件「生成 PPTX」按钮渲染正常。

**尚未做（留待授权/后续）**：真实模型端到端（生成候选版、精修对话、视觉自检——需另行模型调用授权）；非作者独立复核；Git PR/CI 交付。

## 真实模型端到端（2026-11-02，用户授权，合成数据）

环境：dev server + 项目【合成试跑20261029-464ae3】（MiniMax M3）+ `~/.optracall/ppt-venv`。

| 验收 | 实测结果 |
| --- | --- |
| PPT-04/05 生成 | 报告文件「生成 PPTX」按钮 → 任务 `PPT 生成 · simulated_execution`（预填草稿确认后发送）→ 真实模型产出 `060_reports/simulated_execution_候选版.pptx`（9 页，46KB）。`digit_check` 全绿（数字逐字含图表缓存）；`page_images` 9 页；页型结构合理（封面/目录/章节/KPI/对比/结论）。 |
| PPT-06 单页精修 | turn1 仅改第 3 页眉标题为结论句（edit_slide.py run 级替换），**仅 slide3.xml 变化**，快照 v2（pages[3]+diff）。 |
| PPT-09 锚点与差异 | turn2 改 42.5%→43.9%：先 `ANCHOR_REFUSED` 拦截 → 用户显式指定后 `--allow-uncovered` 直改 + `uncovered-confirmed` 差异记录，md 未动；Agent 还指出旧推导「≈8pp」失效。 |
| PPT-07 视觉自检 | turn3 全 9 页视觉+几何检查：抓到柱高与改后数值不符、8pp 旧推导、accent/navy 对比度 2.33:1、眉标序列断裂等真实问题；未修改任何页。 |
| PPT-08 锁定（发现并已修复的 bug） | 初版只有提示词约束，锁 P6 后仍被改（v4）。修复：`edit_slide.py`/`splice_slide.py` 读 meta.json 硬门禁（exit 5）+ turn 路由预检引用页码（409 不开会话）。实机复验：Agent 两次被脚本门禁拒绝、deck 字节不变；单测覆盖路由预检。 |
| PPT-08 版本回退 | revert(v2)：先存当前（v5）再回滚，deck 与 v2 一致，版本链完整。 |
| PPT-11 导出 | `final.pptx` + `final.diff.md`：含 v2/v3/v4 全部差异与锚点状态（covered / uncovered-confirmed），标注不回写 md。 |

其他并发修复：soffice 每次转换使用独立 `UserInstallation` profile（并行转换不再冲突）。

**未做视觉盲评**：候选版观感对照（reports-factory 一版 skill 水准）留用户验收；我侧只验证结构、数字与管线。
