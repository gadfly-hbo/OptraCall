# P0 前置技术验证记录 · ppt-report-extension

按 spec 适用检查要求：P0 为真实路径 spike，证据保留在本文件与 `.local/`（被忽略的本地证据目录），不写产品代码。全部本地执行，零模型调用。

## P0-3 · skill 发现与注入路径（对应 PPT-03）——已完成，结论可行

**问题**：仓库 `extensions/analysis-assets/` 中的 skill 如何被产品 Agent 会话实际发现；受保护执行下是否兼容。

**代码核查（SDK `@earendil-works/pi-coding-agent`，node_modules dist）**

- 发现规则（`core/skills.js`）：目录递归扫描，**文件名精确匹配 `SKILL.md`**（大写；`entry.name !== "SKILL.md"` 直接跳过）；含 `SKILL.md` 的目录即 skill root，不再下钻。frontmatter `name` 缺省时用目录名；`description` 必填（有校验）。
- 会话内加载（`core/resource-loader.js` `updateSkillsFromPaths`）：`loadSkills({cwd, agentDir, skillPaths, includeDefaults: false})`——**默认目录不自动进会话**，skill 来源是 settings 声明 + `additionalSkillPaths` + 扩展贡献。
- 挂载点（`core/agent-session-services.d.ts:34`）：`createAgentSessionServices({ resourceLoaderOptions })` 接受 `Omit<DefaultResourceLoaderOptions, 'cwd'|'agentDir'|'settingsManager'>`，含 **`additionalSkillPaths: string[]`**。OptraCall 的会话创建（`src/agent/project-session.ts` `createRuntime`）已使用同一入口传 `resourceLoaderOptions`。

**实测探针**（`.local/p0-skill-probe/probe.mjs`，Node 25.9.0，2026-11-01）

| 步骤 | 结果 |
| --- | --- |
| `loadSkillsFromDir`：合法 `probe-skill/SKILL.md` + 反例 `lowercase-dir/skill.md` | 仅前者被发现，无诊断；**小写 `skill.md` 不可发现** |
| `loadSkills({skillPaths:[root]})`（additionalSkillPaths 等价路径） | 发现 `probe-skill` |
| `snapshotProtectedSkills`（`src/agent/protected-skills.ts`，受保护执行注入） | copied 哈希快照 1 项，unavailable 空 |
| 软链根目录负例（快照对软链的处理） | 经 `realpathSync` 解析后快照通过（仅 skill 目录**内部**软链会被拒） |

**结论（设计决定）**

1. 挂载机制：Host 在 `createAgentSessionServices` 的 `resourceLoaderOptions.additionalSkillPaths` 中传入仓库 `extensions/analysis-assets` 目录——Host 管环境、无全局目录污染、无需软链；普通会话与受保护会话（经现有 `skillsOverride`→快照）同一路径生效，无需改 SDK 或新增接缝。
2. skill 目录规范：`extensions/analysis-assets/<skill-name>/SKILL.md`，文件名**必须大写 `SKILL.md`**（OptraCall 快照校验大小写不敏感，但 SDK 发现是精确匹配——按更严格侧取名）；目录内真实文件、无软链、不含 auth/credentials/settings 类文件、总量 ≤32MB。
3. 该挂载属 Host 侧接线（project-session.ts，Codex 归属），Extension 侧只需按上述规范落盘 skill。

## P0-1 · pptx→页图渲染管线（对应 PPT-01）——已完成，结论可行

**环境**：本机经用户授权安装 LibreOffice（brew --cask，2026-11-01）；PDF 光栅化用 `.local/p0-render/venv`（pypdfium2 + Pillow，本地隔离）。

**管线**（`.local/p0-render/`，样张为 reports-factory 合成 deck `sample-deck.pptx`，9 页 16:9）：

1. 有效性闸门：python 校验 zip 完整性与 `ppt/slides/slideN.xml` 页数（**必需**，见负例）。
2. `soffice --headless --convert-to pdf`：冷启动 6.9s（含首启 fontconfig 初始化）；**热启动 1.05s**。
3. `pypdfium2` 光栅化：9 页 1.59s，产出 1280px 全图（25–30KB/页）+ 320px 缩略（约 8KB/页）。

**页序核验**：逐页锚点法（每页前 3 个 `<a:t>` 文本框，去空白后匹配 PDF 对应页文本层）——9/9 页 eyebrow/标题锚点全部命中，`ORDER_OK`。

**降级与已知限制（重要）**：

- **soffice 对损坏 pptx 不报错**：`broken.pptx`（纯文本）被按 Writer 文档静默转换成功（exit 0，出 1 页 PDF）。管线必须自带前后闸门：转换前验 zip + 页数；转换后核 PDF 页数 == slide 数，不符即报错、不出图。
- LO 导出 PDF 的部分子集字体缺 ToUnicode 映射：个别中文长文本在 PDF 文本层提不出（渲染正常、出图不受影响）。**文本级核对必须读 pptx XML 原文，不能依赖 PDF 文本层**。
- 首次运行有约 5s 的 LO 初始化；产品内调用应预期冷热差异。

**产品接线要点**：页图管线以"闸门→转换→光栅化→页数核对"顺序实现为确定性工具（B 插件环境能力），转换失败/页数不符时明确报错并保留原文件不动。

## P0-2 · html2pptx 单页重生成拼回（对应 PPT-02）——阻塞：底本许可证

**许可证核对结论（2026-11-01，GitHub API + LICENSE.txt 原文）**：

| 仓库 | 许可证 | 可否进入 OptraCall 公开仓库 |
| --- | --- | --- |
| anthropics/skills（pptx） | **专有**（© Anthropic PBC，All rights reserved；明确禁止复制/衍生/分发/在 Services 外保留副本） | **不可** |
| minimax-ai/skills（pptx-generator） | MIT | 可（保留版权声明） |
| claude-office-skills/skills（pptx-manipulation） | MIT | 可 |
| genspark-ai/genoffice | Apache-2.0 | 可 |
| GordenSun/GordenPPTSkill | NOASSERTION（未定） | 待查 |

**影响**：用户已确认的"以 Anthropic 官方 pptx skill 为底本"在公开仓库分发场景下不可行（其许可证禁止任何形式的复制与衍生）。需用户重新确定底本组合；Anthropic skill 只能作为方法论参考（总结方法、不复制任何文本/代码）。

**拼回机制验证（2026-11-01 完成）**：与底本解耦的机制实验，全部通过。

实验（`.local/p0-splice/`）：pptxgenjs（Node，LAYOUT_WIDE 13.33×7.5，与样张 sldSz 12192000×6858000 EMU 一致）生成单页替换 deck → python zipfile 把 `ppt/slides/slide4.xml` 替换进样张副本（`splice.py`）。

| 验证项 | 结果 |
| --- | --- |
| 其他条目字节隔离 | 71 个 zip 条目中除 slide4.xml 外 **0 个差异**（sha256 逐条目比对） |
| 可打开 | python-pptx 打开：9 页，第 4 页文本 = 替换页内容 |
| 页序 | sldIdLst 未动，页序天然保持 |
| 可渲染 | soffice → PDF 成功，9 页（回环渲染验证） |

**结论与实现要点**

1. **slide 级替换机制可行**：`.pptx` 是唯一事实工件的前提下，单页重生成 = 生成同画布单页 deck + slide part 替换，其他页字节不变。
2. **简单路径约束**：无 rels 引用（纯文本/形状）的替换页可直接换 slide XML；**含图片/图表的替换页需 rels 感知拼回**（带 slide rels + 媒体部件、rId 重映射、[Content_Types].xml 增补）——这是实施期工作项，非可行性风险。
3. **画布约束**：单页生成必须先读目标 deck 的 `p:sldSz` 并按其尺寸生成（本次 13.33×7.5 验证一致）。
4. **生成工具**：pptxgenjs（minimax skill 路线）单页生成可用，Node 运行；MIT。
5. **实现陷阱（已踩已记）**：python `zipfile.writestr(zinfo, data)` 会改写传入的 ZipInfo（header_offset 等）——拼回必须用新建 ZipInfo 承载原条目元数据，否则源包句柄被污染。

## P0 汇总

| 项 | 结论 |
| --- | --- |
| P0-3 skill 发现 | 可行：Host `additionalSkillPaths` 挂载仓库资产目录；skill 文件名必须 `SKILL.md`（大写） |
| P0-1 页图管线 | 可行：闸门→soffice（热 1.05s）→pypdfium2（1.6s/9页）；损坏文件必须前后闸门；文本核对读 XML 不读 PDF |
| P0-2 单页拼回 | 可行：字节级隔离验证通过；含媒体页需 rels 感知拼回（实施项）；sldSz 对齐必须 |

P0 三项全部完成，进入主体开发（A skill 交付 + B 插件交付）。
