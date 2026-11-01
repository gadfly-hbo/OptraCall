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
