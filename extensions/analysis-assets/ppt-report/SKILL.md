---
name: ppt-report
description: PPT 报告生成与逐页精修规范——内容红线 + 版式系统 + python-pptx 代码指南 + 核对脚本。用于把 OptraCall 正式 md 报告生成候选版 PPTX，或对既有 PPTX 做逐页修改（对话驱动、XML 级编辑或单页重生成拼回）。凡为 PPT 生成内容或写渲染代码的环节一律遵循。
---

# PPT 报告生成与精修规范

你在为 OptraCall 的中文经营分析 PPT 做内容或渲染工作。输入通常是 `060_reports` 的正式 md 报告（唯一内容权威）；产物是**候选版 PPTX**（唯一工件，不附带自定义源码）。你自主决定页面结构、布局与代码——本文件是守则与工具，不是固定步骤模板。

## 一、内容红线（最高优先，违反即拒绝）

1. **不编造**：所有数字、事实、结论必须来自输入报告；报告没有的明确标注「报告未覆盖」，宁可留白不可杜撰。
2. **数字逐字**：引用报告数字照抄，不改写口径、不做心算；比例与百分比保留原口径。交付前必须用 `scripts/digit_check.py` 核对（含图表缓存数值）。
3. **来源绑定**：关键主张可追溯到报告章节；推断与报告原话区分，不把推断伪装成事实。
4. **单焦点**：每页只讲一件事；headline 直接陈述该页结论，不写「关于XX的分析」式空标题。
5. **克制密度**：每页要点 ≤6 条，每条一个完整信息点；正文是摘要提炼而非原文照抄。
6. **0 emoji**：任何输出内容不出现 emoji 与装饰性 Unicode 符号。

## 二、生成工作流（正式 md 报告 → 候选版 PPTX）

1. **读报告**：通读 md 全文，提取结论、关键数字、行动建议；数字清单先行。
2. **页规划**：按报告结构规划页序与页型（封面 / 目录 / 章节页 / 内容页（文本、KPI、图表、对比）/ 结尾），每页一句话结论 + 使用数字清单。页数由内容决定，不凑数。
3. **逐页写代码**：用 python-pptx 按 `references/design-system.md` 的版式系统与 `references/python-pptx-guide.md` 的页型骨架写生成代码（画布 13.33×7.5，读目标 deck 时对齐 sldSz）。
4. **自检循环**：生成 → `scripts/page_images.py` 出页图 → 逐页看图（遮挡/溢出/对比/字号；封面与章节页大留白属设计容忍）→ `scripts/digit_check.py` 数字核对 → 发现问题改代码重渲，直到通过。
5. **交付**：候选版 PPTX 写入 `060_reports`。生成即分析流程终点；后续修改进入逐页精修（独立会话），不回原分析会话。

## 三、精修工作流（对话驱动的逐页修改）

1. 用户选中一页并描述修改意图；你只动这一页，不重写全本，未改页与锁定页字节不变。
2. **小编辑**（措辞/数字/位置/字号/颜色）：直接 XML 级编辑该 slide 的文本与属性。
3. **整页重构**：按原 sldSz 生成单页 deck，`scripts/splice_slide.py` 拼回（自动处理媒体 rId 与 Content_Types，保留该页 layout）。
4. 修改后重出页图给用户看；数字改动先与 md 锚点核对——**报告没有的数字不静默写入**，提示用户确认依据，直改须记入差异清单。
5. md 报告不被自动改写；回填由用户在报告侧另行处理。

## 四、资源索引

| 资源 | 内容 |
| --- | --- |
| `references/design-system.md` | 版式系统：画布、三色系、字体、字号/间距梯度、页型模板、密度与留白规则 |
| `references/python-pptx-guide.md` | python-pptx 代码指南：环境、骨架、页型模板、中文字体等陷阱 |
| `references/pitfalls.md` | QA 流程与已知陷阱（soffice 闸门、PDF 文本层不可信、zipfile 陷阱） |
| `references/pptxgenjs.md` | （可选 JS 路线）PptxGenJS API 参考，源自 minimax pptx-generator（MIT） |
| `references/editing.md` | （可选 JS 路线）XML 编辑工作流参考，源自 minimax pptx-generator（MIT） |

## 五、脚本（确定性工具，只校验/转换，不做内容判断）

环境：python venv（`scripts/requirements.txt`：pypdfium2、Pillow、python-pptx）；页图渲染需要 LibreOffice（`soffice`，可用 `SOFFICE` 环境变量指定）。

```bash
# 数字逐字核对：deck 每个数字必须在报告中逐字出现（含图表缓存）
python scripts/digit_check.py --deck out.pptx --report 报告.md [--json]

# 页图渲染：闸门（zip/页数）→ soffice → 页数核对 → 全图+缩略
python scripts/page_images.py --deck out.pptx --out pages/ [--width 1280]

# 单页重生成拼回：替换第 N 页，其他页字节不变
python scripts/splice_slide.py --deck deck.pptx --replacement page.pptx --slide N --out deck-new.pptx
```

## 六、边界

- 触发由用户显式发起（分析需求已声明 PPTX 除外），不自行猜测 PPT 需求。
- Host 管环境（材料、权限、会话）；你自主选方法、写代码、自检——不要要求 Host 代渲染或代计算。
- `.pptx` 是唯一事实工件：用户在 PowerPoint/WPS 手改后的 deck 仍可继续精修；不要重建「源码工程」概念。
- 首期只处理本产品生成的候选版或用户明确提供的 deck，不做通用 PPT 编辑器承诺。
