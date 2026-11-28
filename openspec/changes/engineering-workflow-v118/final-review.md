# 最终PR前增量复验

**结论：PASS。** 固定 `release-candidate-3` 的7文件增量复验无新增必须修复项；原独立结论继续有效，**本轮 Demo／真实产品截图／产品运行仍为有依据的不适用**。此结论不预记PR、实际headCI、合并、main pushCI、设备采用或用户产品验收成功。

复核者：`independent_draft_review`，非作者；被审工作树、配置及原证据只读。本报告为外部独立输出，尚不属于下表7文件。

## 固定身份

输入清单：`release-candidate-3`，文件名 `candidate-3.json`，清单本身SHA-256=`90495ab1778ae123da75faf0442a9dd17a471a621d695157d1c256f0b181c2d9`。实施基线为 `032e8dddb7a677d0a55babe7cb3c74b56b5080ee`，前序5文件提交为 `87077872894337a0a2a410fb810e354993872dda`。当前完整候选包括其后的结果追加与两份新增报告，不能仅用该HEAD代表全部7文件。

| 仓库相对路径 | 字节 | SHA-256 |
| --- | --- | --- |
| `AGENTS.md` | 5639 | `6444be652979ada8284d5eda7fbd2ebf836a8e94204adb4d1d5c42ac1dc95b98` |
| `docs/engineering-workflow.md` | 66816 | `52acc3fd2fc770a47892f38a118dd8d2423925fc01ce5678c68b34e5c6de16f9` |
| `docs/engineering-workflow-history.md` | 52668 | `0cc30b376ad832aa593c3e3bbc1eced67b1809fba292d2285b63ee17830f62bf` |
| `openspec/changes/engineering-workflow-v118/spec.md` | 4391 | `2c4beed6ec0584cc1acef239d98633aaca0483abd61ab4cc0e5e892ccfb82103` |
| `openspec/changes/engineering-workflow-v118/result.md` | 4559 | `dfe486009c63138eb5d5e20f1ce141f02f750b3bc1c39db65eab0d434bdf4bea` |
| `openspec/changes/engineering-workflow-v118/report-release-candidate-2.md` | 11262 | `ca3c7af920b73d4a138579fc5ec7c70dc8ba3d8be7ca3f8c86c4ba9336ab8cc4` |
| `openspec/changes/engineering-workflow-v118/coverage-release-candidate-2.md` | 12001 | `fadbb065fe50ddfc21608aceb94b0f49337d2b1df86fa7e33cd4ed4d9a683102` |

检查开始及报告固定前，7文件均与清单匹配；前序5文件完整快照也逐项匹配原 `release-candidate-2` 清单。

## 全部增量与结论有效性

- **4文件未改**：AGENTS、工程规范、历史附件及本轮spec与原5文件候选逐字节相同。专项停用、旧锚点兼容且不改旧权属、D01/D02、SDK/IN/Host边界、两道UI门禁、F01/F02修正、停止与测试反削弱、CI原文和配置均未再变。原9节、237行主矩阵及37项UI专项按上一份正式报告的受影响映射继续有效，不重新抄写。
- **result仅追加10行**：实际逐行比较，原内容全保留；新增段准确限定8707787当时的5文件检查、90处引用和独立PASS范围，链接两份固定报告，保留N01与原失败，说明最终候选另做本次复验；没有提前宣称PR/CI/合并成功，没有改变授权或验收要求。
- **推送故障补录**：只读核对 `delivery-events.jsonl`，保留首次推送FAIL/exit128和旧凭据助手缺失原因，以及随后使用已有GitHub CLI作单命令适配的PASS和远端8707787收据。结果摘要与该记录一致，未新增认证/凭据读取权限或泄露秘密；不将作者保存的时序记录冒称本复核重新执行过认证。此前远端完整SHA已独立回读。
- **两份报告原字节复制**：[正式独立报告](report-release-candidate-2.md)与[增量矩阵](coverage-release-candidate-2.md)均与独立输出原件相同，内部互链和result新链接可达。没有改写前轮候选失败、范围、N/A或限制，也没有把公开报告升级成产品运行验收。
- **公开范围**：新增报告和result均未发现本机绝对路径、凭据或私有业务内容。旧文档历史中的已批准原文没有借本轮证据追加被清理或改写。

7文件全部为文档/记录；实际增量只含结果摘要及原字节证据，没有产品视图、组件、CSS、接口、构建、运行配置、数据输入、SDK或用户操作路径变化。因此本次四原则文本核定和UI不适用依据保持有效，无需产品Demo、截图或浏览器，不据此豁免未来产品UI工作。

## 实际增量检查

1. Python `json.loads`、`read_bytes`、`hashlib.sha256`核当前7文件、原5文件快照、两份复制报告，全部匹配；Python `difflib.unified_diff`核全部最终差异，只有上述result追加及两份证据新增。
2. Python解析7文件活跃Markdown引用，**94处本地文件/锚点引用均可达**；规范及其原锚点原字节未变，上一轮入站检查和N01既有旧v1问题继续有效。result中的90处明确绑定原5文件提交，不冒充当前总数。
3. `git diff --check`及7文件严格UTF-8/BOM/NUL/尾空白/末尾换行检查，无问题；`git diff 8707787... -- .github/workflows/check.yml`为空。新增result和两份公开报告的私有路径/凭据标记检查通过。
4. 初始状态为result修改、两份报告未跟踪，其余4文件未改；逐件清单覆盖这些未提交/新增文件，没有只检查HEAD。未运行npm、产品、SDK、模型、设备，未安装依赖、读取凭据或写入源工作树。

本次未重跑未变的全套文本矩阵、产品/模型/设备实验、远端CI，也未逐件重验历史私有收据或所有在线链接；旧报告限制保持。原N01不因本次PASS消失，不宣称全仓零断链。

## 本报告作为第8份证据的附加边界

本报告仅说明既定7文件的复验结果，不修改其任何规则、输入、验收要求、配置或运行行为。允许作者将本报告按**完全相同字节和文件名 `final-review.md`**加入同一变更目录，作为第8份纯证据附件；作者须核外部原件与入库副本的摘要、UTF-8、引用、公开范围及最终8文件清单，再提交并回读实际完整SHA。

在其余7文件不变、没有其他修改且本报告原字节附加的条件下，这一步不需要复核者再对自己的报告循环出具新报告；本报告不自引用其未来提交SHA，也不要求为追加结果摘要制造无限提交。若改动任一被审文件、改写本报告或追加其他实质内容，应按影响核对有效性，不能自动沿用本次结论。PR/headCI/main pushCI必须对应最终实际交付提交，并按Issue #158授权和工程规范推进；设备/运行服务不在本轮范围。

固定时间：2026-11-28 15:36:08 UTC。
