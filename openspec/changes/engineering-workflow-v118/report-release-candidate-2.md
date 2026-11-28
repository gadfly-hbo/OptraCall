# 工程规范 v1.18 正式候选独立复核

**结论：PASS（固定5文件的文本、约束保留、历史和引用检查范围）。没有新增必须修复项。** Demo/真实产品截图和产品运行检查经本轮实际差异分析核定为不适用。PR、实际headCI、合并main及main pushCI仍待执行；本结论不等于完整工程交付完成，也不直接覆盖随后追加报告/结果的最终候选。

## 身份与验收依据

复核者：`independent_draft_review`，未参与本候选任一部分创作。源、配置和旧证据只读，报告独立写出，尚未写入被审工作树。先核文件清单和基线/本轮决定，再独立读取实际差异、源规则与结果，不采用作者检查PASS作为结论来源。

- 正式任务：[Issue #158](https://github.com/gadfly-hbo/OptraCall/issues/158)，已只读获取正文及领取评论；发布/领取账号为仓库所有者，WF01–WF06、用户正式落库授权和停用专项决定明确。
- 任务规格：`openspec/changes/engineering-workflow-v118/spec.md`；结果：同目录 `result.md`。两份新文件均在固定候选内，未预记未发生的CI/合并。
- 实施基线：`032e8dddb7a677d0a55babe7cb3c74b56b5080ee`；原v1.17来源：`76558ec6405b6852092fcf5d4bc85b025524710f`。两提交的AGENTS、规范和check.yml已逐字节核对相同。
- 批准输入：`v0.2-candidate-2`，三正文SHA及全部规则映射见[本轮覆盖矩阵](coverage-release-candidate-2.md)。前序237/37矩阵原件保持；原草案候选1的NEEDS_FIX没有回改。
- 当前清单：`release-candidate-2`（输入清单名 `candidate-2.json`），其文件本身SHA-256=`04628acd2c022966aef9847e2b0f0ad79d5c8b2fd802854458de954a2b175f07`。
- 本轮开始时候选包含2份已跟踪修改及3份未跟踪新文件，已逐一检查实际字节；不能仅报HEAD。检查中作者已原字节提交并推送为 [`87077872894337a0a2a410fb810e354993872dda`](https://github.com/gadfly-hbo/OptraCall/commit/87077872894337a0a2a410fb810e354993872dda)。已再次核5个Git对象与清单/当前文件完全相同，提交路径只有该5文件，工作树干净；`git ls-remote --heads origin codex/workflow-v118`独立回读远端分支同为8707787完整SHA。

## 固定候选身份

| 仓库相对路径 | 字节 | SHA-256 | 实际文件／提交 |
| --- | --- | --- | --- |
| `AGENTS.md` | 5639 | `6444be652979ada8284d5eda7fbd2ebf836a8e94204adb4d1d5c42ac1dc95b98` | 匹配 |
| `docs/engineering-workflow.md` | 66816 | `52acc3fd2fc770a47892f38a118dd8d2423925fc01ce5678c68b34e5c6de16f9` | 匹配 |
| `docs/engineering-workflow-history.md` | 52668 | `0cc30b376ad832aa593c3e3bbc1eced67b1809fba292d2285b63ee17830f62bf` | 匹配 |
| `openspec/changes/engineering-workflow-v118/spec.md` | 4391 | `2c4beed6ec0584cc1acef239d98633aaca0483abd61ab4cc0e5e892ccfb82103` | 匹配 |
| `openspec/changes/engineering-workflow-v118/result.md` | 3204 | `6d20463058e063c18b4a86486c1aa5aa33bbeddb565c1323512f726c67602c57` | 匹配 |

## 独立检查结果

1. **正式化差异闭合。** 实际逐行比较批准v0.2与正式三文档：AGENTS只去草案包装；规范改正式版本与结果指针、去草案阶段说明、移除已批准停用专项并增加兼容定位说明；历史附件改正式说明/固定Git原件指针，并追加原专项档案。新增spec/result与本轮决定和WF清单一致。没有发现其他有效规则被删除或范围变窄。
2. **专项停用有效，通用边界未放宽。** 现行第2节没有旧专项标题/三步流程；`docs/engineering-workflow.md:302–306` 的HTML id仅定位现行共享流程，明确模式已停用、档案位置及旧工单授权/写入归属不能追溯更改。第2节一般Codex接入责任、IN06、SDK原包/用户版本、公共生命周期/owner权限等完整区段与批准版逐字相同。
3. **D01/D02及原修正保留。** 原草案确认提示被移除，但用户批准原则例外、普通技术自主、不得一般例外豁免SDK/版本/设计/截图/独立/扩权的正文保持；工程维护复用正式Issue、按影响适用、只读外部草案不强行发单保持。Skill测评展示与Skill编写仍为独立触发；Git“不得改写历史”、测试反削弱和用户明确停止任务均仍明确存在。
4. **两道UI确认和全部原门禁保留。** 四原则/SDK/IN、Demo浏览器阅读六项、SDK升级、独立复核至UI门禁/工程完成、CI五个区段与批准版精确相同；本轮以实际差异重新核定旧矩阵有效性。亲看图/DOM-CSS/生产映射/同视口、三冻结基准与逐项矩阵、全作者独立、真实运行身份/全部页态、用户实际展示确认、PR含draft禁止绕过、变更失效重核和有据N/A均未被专项停用削弱。
5. **历史和原FAIL保全。** 原六组历史原文及v1.17专项W102–114连续精确包含于历史附件；新档案明确“不供新任务采用”。原事故SHA、旧PASS边界、当事Agent自述未取得原transcript的界限、FAIL/UNKNOWN/NOT_PROVED/限定接受保留。旧私有收据未逐件重验，不宣布旧任务当前全部完成。
6. **原失败与兼容修正核定。** 原作者首次检查的新增断链失败JSON仍保留。已独立核两份未改旧文档的引用，经兼容id均可达，停用说明没有恢复原步骤。原有效锚点缺失0；候选90个本地引用均可达；仓库71个本地入站引用只剩原N01。另核活跃Issue模板3处blob/main链接以及9处固定Git版本的行号/章节引用。不是全仓零断链声明。
7. **CI排除范围遵守。** 整个CI小节等于原v1.17及批准版，check.yml在基线与实际提交间无差异。本轮没有借文档任务修改CI选择、扩轻CI范围或跳过现有工作流；远端实际选择的检查留待PR回执。

## 先外部移除再落库的证据边界

顺序收据 `release-source.json` 与[领取评论](https://github.com/gadfly-hbo/OptraCall/issues/158#issuecomment-7241415485)均记录先在仓库外移除再写入源码。旧批准专项段另有原字节保留；先行副本与现行规范都没有活跃专项步骤。

该顺序收据绑定的是补兼容锚点前的初始规范：66466字节、SHA-256=`fdc3c2b5be6bacbb40e0717a810cf62df1432ae8356a20a85977cb7204a9716e`，不能将它当作本轮66816字节规范的当前摘要。独立在内存只剥离后补HTML id和停用兼容说明，精确得到上述初始字节/摘要；AGENTS和历史附件与顺序收据身份相同。初次断链检查的失败与随后兼容修正顺序一致。本轮核定文本/副本/收据的一致性，未重新执行写入操作，也不声称直接观察过去每一次文件写入时刻。

## 四原则及UI适用性独立核定

实际提交只含5份Markdown，没有产品视图、组件、CSS、接口、数据场景、构建、运行配置、依赖或SDK变化。Host环境/权限与产品Agent自主执行的实际代码未改，没有新增Runtime/SDK机制或用户正常产品操作。专项停用改变工程交接规则，按用户明确决定沿已有共享流程，不为产品增加人工作业。

因此本次四原则专项检查在“文本保留、职责边界、不新增机制/权限/操作”范围通过，不外推既有代码已全部合规；不需要产品运行或真实SDK探针。按规格40及实际文件差异，Demo、真实产品截图和产品浏览器检查不适用；这是独立影响核定，不是因文件名含docs而自动豁免。未来UI工作仍按未变的完整门禁执行。

## 实际命令和范围

以下命令均在被审工作树只读运行，路径使用仓库相对表示；辅助Python只在独立报告目录输出本两份文档。

- `git status --short`、`git status --porcelain=v1`、`git rev-parse HEAD`、`git rev-parse origin/main`、`git branch --show-current`、`git ls-files --others --exclude-standard`：先核完整未提交/新增范围，后核提交和干净状态；无进行中合并/变基。
- Python `json.loads`/`read_bytes`/`hashlib.sha256`：开始及固定报告前逐一核清单5文件、批准输入及历史原件；`git show <SHA>:<path>`交叉核原基线、实施基线及8707787实际5个Git对象。所有候选摘要匹配。
- Python `difflib.unified_diff`：完整比较正式三正文与批准输入；完整读取spec/result及Issue158正文和领取评论；按验收重新导出本轮差异/覆盖矩阵。
- Python精确区段比较：四原则-SDK-IN、六项Demo阅读、SDK升级、独立复核/UI门禁、CI五段均相同；CI与原v1.17也相同。对六组历史及旧专项连续全文包含校验均为true。
- Python对比全部原有效标题slug/HTML id、检查5文件活跃Markdown本地链接；`git ls-files --cached --others --exclude-standard -z -- '*.md'`枚举入站链接。结果为90候选本地引用无缺失、71本地入站只剩N01；另对非Markdown字符串命中分类，两个Issue模板的3处main链接有效，一份既有诊断收据内旧提示词属于历史快照而非活跃入口。
- 对9处固定Git提交入站链接用 `git show <固定SHA>:docs/engineering-workflow.md`核其行号/章节，均可达；不拿旧固定内容要求当前规则回滚。
- `git diff --check`、5文件严格UTF-8/BOM/NUL/尾空白/末尾换行检查：无问题。`git diff 032e8dd... 8707787... -- .github/workflows/check.yml`为空；`git diff-tree --no-commit-id --name-only -r 8707787...`仅5文件。
- `git ls-remote --heads origin codex/workflow-v118`：远端分支完整SHA与87077872894337a0a2a410fb810e354993872dda相同。
- 原作者 `local-check-candidate-1.json` 的断链FAIL仍在；本轮自己的GitHub评论只读调用首次因参数名校验失败，改用连接器要求的`repo_full_name`后成功。该工具调用失败不当作产品RED、不隐藏，也没有写入Issue。
- 未运行npm、产品/浏览器、真实SDK、模型或设备；没有安装依赖、读取凭据、切服务、创建PR或执行合并。报告公开文本已检查无本机绝对路径或私有内容。

## 发现、进度与限制

没有新增必修发现。两处专项旧引用的新增断链已按最小兼容修正核定关闭，保留原失败。原N01：`docs/enterprise-business-context-proposal.md:172` 的旧 `#统一会话接入规范interface-v1` 在基线已失效，本轮不改，不把它写成新问题或全部链接PASS。

WF01–WF05在上述文本/适用性范围通过；WF06的PR/headCI/main合并/main pushCI/关单尚未发生，保持待执行。源8707787与冻结5文件相同不代表随后附加证据/结果后的完整最终候选自动通过；PM追加本报告/矩阵和结果摘要后，应固定新完整候选，再复验新增差异、身份/引用/公开范围和旧结论有效性后推进PR。

未在线逐一访问全部GitHub链接、未逐件重验历史私有日志/收据、未验证既有产品实现/专业质量/运行采用；Git对象本地验证仅证明固定源码内容及引用，不证明正在运行的设备版本。用户对规范的批准、此文本复核、Git/CI、设备采用和用户产品验收分别记录。报告不授予双端服务切换或本轮范围外业务/SDK动作。

固定时间：2026-11-28 15:32:05 UTC。
