# Agent 大脑外部协作准备包独立复核

2026-11-27 · 非作者复核者：`brain_preparation_review`。

**结论：通过本次规格与合成静态原型的准备复核，可提交用户确认。当前无剩余必修项。** 本结论不表示产品实现、真实 WorkBuddy/MCP 联用、部署、专业交付或用户产品验收通过；最终 spec、清单和 Demo 尚待用户整体确认，不能据本报告提前发布正式开发 Issue。

## 复核独立性与输入身份

本复核未参与准备包任何候选文件的创作或修改，未继承作者的实现会话；仅在独立 `.local/agent-brain-external-preparation/` 中写入复核脚本、截图、结果及本报告。另请未参与候选创作的 `contract_audit` 只读交叉检查六份合同文档，其结论与本复核一致。未操作 Git，未修改产品/依赖/配置，未运行产品全量检查、真实模型、实号调用、部署或设备服务操作。

先读根 `AGENTS.md`、工程规范四原则/IN01–IN07/新产品发单流程、统一会话接入说明、产品讨论稿 v0.4 及 Agent 大脑讨论稿，再从用户 D01–D04 导出预期。主任务提供的 main 基线为 `4132a39d336c22d46c5bc57ae9d9b544a7ebac5f`，讨论稿提交为 `41264eb5c584c1cf4e09c532e8842823a870c469`；本复核未自行运行 Git 核定基线。

最终十份输入已逐项执行 `sha256sum -c .local/agent-brain-external-preparation/review-input-sha256.txt`，全部 OK。以下为固定输入；本报告及其后续原样副本是复核输出，不包含在输入中。

| 文件 | SHA-256 |
| --- | --- |
| decisions.md | `da792502720ee646cbaec3aa825f683e92d3c807e5fcc2ca567c978efcabd05e` |
| demo-guide.md | `5de0c3704f8e5c3f089d57df9eda2bf478fc3d9b9fe4593d4b5dee81242c8f3c` |
| demo-notes.md | `430f879c33c3ee1527a7eaa740767a8b974103b26197e8de0bf4490b95261a2e` |
| integration-research.md | `2cd2d38011baa6aa3c6ab35dfb69a7a1482675cba3924d91a20c3d9326e4430e` |
| issue-draft.md | `b50dd009113b5770408df624c77edad03acef5cf137adbf10402adf3bcf2b9d9` |
| result.md | `13c1a583999ad4700ebed3e54e5f274614b39b4122de03875eaf6e586ad43ede` |
| reuse-audit.md | `115894ba92501e583330557346a7e06d47985bfc4b7384cb6c4b226de54700fd` |
| spec.md | `636a0da0f926c5c8fb8d75774c53bc1f8564557f79125ac3e818286355f7db5d` |
| tasks.md | `3159a7e2b2d1190cc4ab1a92ecfe0ae9aafee64eba55300fcd0384a94606abad` |
| ui-demo.html（107113 字节） | `770fcd371694554df18a2a482f2c5170c8210dead488539d2d2561d640d54933` |

## 由用户目标核对的重点

独立预期是“原 Task 委派具体工作→外部取得获准准确依据并执行→保全交付→原 Agent 核验续接”，不能以发 Issue、关闭工单或握手代替。最终合同覆盖 D01–D04：GitHub＋资产 MCP 一期完整链路、一次必要范围授权后自主、资产留原实例、通用协议＋WorkBuddy 官方本机助手首适配，无云任务替代。

核对了工作记录写入与资产只读分离；OAuth/principal、显式企业及精确 allowlist 与原资格相交；跨 turn/revision 的 UNKNOWN 去重；单一 claim/租约/迟到与取消不假停；外部 Ref 与字节保全不伪 native；busy/重启/accepted 未知沿原 owner 新 turn 且不重放；经营取舍/资产发布/实际效果分开。未发现相互矛盾或阻断实现的剩余合同缺口。

已独立打开 [WorkBuddy Open API](https://open.workbuddy.cn/en/docs/openapi)、[Connector](https://open.workbuddy.cn/en/docs/connector) 与 [MCP Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) 官方资料。它们支持研究方向，不能证明 API 本机任务与目标 Connector 已联用；规格保留 `integration_unverified`、首次明确合成测试及实号 NOT_RUN，没有假报就绪。

## 发现、修正与复验

四项 P2 均已处理；三项 UI 问题在旧 HTML `a37d37256a71d3af525b786d5a2e93826f10784082bb6e6d96486724ad27d190` 的实际页面中确认。旧候选的通过记录不作为修后候选证明。

| 发现 | 必要修正与最终复验 |
| --- | --- |
| WorkBuddy `message_id` 被表述为取得工作“状态/回复”，容易把账号级历史游标当任务关联 | spec §6、AB03/AB13、研究及决策已明确：不是 task/session ID，不按消息先后/最近触发归属；无法可信关联的正文不入原 Task/模型，工作 MCP 收据为权威。首期同 WorkBuddy 连接单项有效触发/执行是有公开接口缺口依据的准入默认，通用协议并行与 Agent 方法自主保留；该默认随整版待用户确认。 |
| 正常交付 v1.0，原报告新增成果误写 v1.1 | 最终 HTML 正常统一 v1.0；补充 revision 2 才 v1.1。报告、交付与附件一致，旧交付/失败原因仍可查看。 |
| 排除 mapping 授权后，差异表仍宣称按该映射解释并自动接受 | 最终按获准资产与实际读取相交；排除后正文、引用及核验明确“映射未取用/未核验”，不补造使用或扩大权限。接受片段时保留适用限制。 |
| 附件只有外部来源/hash/预览，没有可见的字节保全状态 | 最终逐件显示模拟待保全/已保存字节/仅链接/缺件及声明与本机摘要。未完整保全不接受，失败产物不展示为完整内容；补充版重新保全并保留旧版。所有字节数/摘要/保存均清楚标为合成模拟。 |

旧候选实际证据：`ui-review-old-candidate-findings.json`、`shrink-difference.png`、`accepted-report.png`。其中三个缺陷观察均为 true，且与源文件相符。修后完整关键交互采用新 HTML 770fcd 的实际 HTTP 页面复验，无剩余必修。

## 独立 UI 与四原则结论

用现有 Playwright＋`/usr/bin/chromium` 经内部 `http://127.0.0.1:4317/ui-demo.html` 加载固定 HTML，阻止并记录外部请求。该 localhost 不是用户可访问的托管演示。

- `ui-review-final.mjs`：**70 项检查通过，0 页面运行时错误、0 外部请求**。覆盖六类原 Task、缩小/取消授权、一次授权自主接受、原成果/草稿、接入门槛、UNKNOWN 重开、重复领取、同 Issue 补充/旧交付、执行器等待、必要业务取舍、busy/暂停/恢复、取消/迟到、资产拒绝及三项 UI 修复。
- `ui-review-visual.mjs`：1440/1024/390 × 亮暗共六组抽屉 viewport，无横向溢出，dialog 在视口内；另验证 390 Tab 循环、Escape/焦点返回。已目视初始桌面、修后交付/报告、390 亮色和 1024 暗色截图，无剩余必修。与 70 项交互有重叠，数量不相加。

四原则在准备范围通过：Host 只承担身份、权限、资源、记录、保存及续接，Agent 保留拆分/方法/专业核验；复用原 owner/Interface v3/Pi1.4.0 和既有连接器/读取/保存接缝，固定官方 Pi/MCP1.32.2 原包、不升级改包。正常路径只有一次必要范围确认，无普通读取/评论/接受逐条审批；首次接入、第三方必要许可及重大经营取舍保留。演示控制/历史/候选管理不是日常必经步骤。实际实现仍须另据代码与运行证据核验。

## 证据、失败与限制

独立证据在 `.local/agent-brain-external-preparation/`：`ui-review-final-results.json`、`ui-review-visual-results.json` 和 `final-` 截图。旧候选缺陷证据保留；初轮完整摘要误匹配、id/testid 笔误、保全措辞断言过窄、后台重绘竞态分别保存在 `ui-review-results-initial-script-failure.json`、`ui-review-results-second-script-failure.json`、`ui-review-final-script-failures.json`。只修脚本范围/等待后通过，未将脚本 FAIL 算产品缺陷。曾怀疑的“保持原范围”遗漏经当前源/实页核对不成立，未据此改产品。

最终 tasks/result/guide/notes 已回读：历史与当前候选、作者/PM/独立结果、原失败及 NOT_RUN 分开；用户确认/发单仍未完成，工程 E01–E08 未冒充已实现。十份输入再次摘要核对全部 OK。

本次不证明真实 Host/Pi/MCP/TLS/OAuth 产品闭环、标准外部客户端/实号联用、真实附件保全、专业内容、经营效果或设备采用，未运行产品全量检查与 PR/main CI。`file://` 策略阻止按作者/PM原记录保留未验证，本复核未改策略；独立交互证据仅覆盖内部 HTTP 合成静态原型。

当前无剩余必修，可将该固定准备包交用户审核；确认后的推送、完整 SHA 回读与正式 Issue 发布仍按工程规范执行。
