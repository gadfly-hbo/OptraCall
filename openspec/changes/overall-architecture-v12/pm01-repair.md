# PM-V12-01：明确背景范围内的自主发现与准确窄读

## R1 旧讨论兼容修正 · 2026-11-17

用户授权按独立PM复核修正PM-V12-01-R1（P2）。修前98文件`9cccb075…`已逐份核对并保全到`.local/v12-pm01-r1/before/`。旧owner缺sourceScope的有效语义仍为selected-only；真实已读A后，仅取消A并省略新字段的合法UI/PATCH更新，下一次派发前必须核当前范围，历史grant/hash通过不能代替。复用discussionSourceMode、sourceAccesses、原Interface v3/strategy-discussion owner/profile/公共lease/native，不新增SDK、权限或持久结构。

这是已批准语义内的Host纠错，正式UI不新增或改变交互，沿原86de局部批准，不需另做Demo。用户已指定正式Background勾选回调→原客户端PATCH/GET→公共派发→实际Provider/native及旧API验收接缝。先真实旧记录RED，再最小修正，补仅refs/catalog未读和仍选A可继续的正向，保留新自主/限选/排除/权限/下游/停止/UNKNOWN及单多Task回归和完整检查。

新输出仅`.local/v12-pm01-r1/`或明确独立副本，旧固定证据只读，不创建共享依赖链接/安装。非作者独立导出预期、冻结后复核。保留历史失败、TDD NOT_PROVED接受和data-analysis免测；无真实模型、业务/活库、设备、SDK或Git交付授权。原工程关闭意见属于修前时点，当前R1修后重新核定。

R1实际修正与关闭证据见[本次结果](pm01-r1-result.md)：正式UI/旧API派发前409、原输入/native保全、未读/仍选正向、完整隔离check 2894 PASS/111 SKIP/0 FAIL及非作者两轴通过。新固定清单在`.local/v12-pm01-r1/candidate-source.json`，旧9ccc及全部历史失败保留；工程关闭不等于Git交付、正式采用或用户产品验收。

2026-11-17。承接原v1.2 spec与用户修复授权，不重做七模块或已闭合v1.1差额。PM报告SHA256 `b9da756271f838d75a56211cd34ce3c1d17c6ebc5efff1fe9f993e56524467ee`；修前80文件组合摘要 `dfeb5b6534723e5cf9e27c88112f828573df543a431db146276fd43deac995a3` 已逐份核对零漂移并完整复制到 `.local/v12-pm01-fix/before/source/`，旧清单与证据不改。

## 目标与公开验证接缝

Agent在用户本次已明确的项目背景范围和原权限内，可自主发现目录、选择并准确窄读；人工手选可限定或补充，明确排除优先。目录、正文返回、后续采用和专业正确分别表达。

用户已指定A—E验收，公共接缝为原discussion HTTP/strategy_goals工具、原来源facet/权限口、官方Pi native、原Goal→Plan→实际Task。沿同一Interface v3、原strategy-discussion owner及Pi1.4.0，没有新增Runtime、权限库、资料库或专业选材编排。已选方法与TOC/TP合同保持。

## 范围合同与兼容

- `sourceScope.mode`：`project-background` 或 `selected-only`。前者只开放本次明确Project中原资格允许的背景目录，不开放业务明细/DB/凭据；后者只允许准确手选sources，空清单就是不使用项目背景。
- 没有Project不得凭空开放项目范围。新讨论明确选择资料Project且尚未手选时，捕获合理默认；旧owner缺sourceScope继续原selected-only语义，不因读取/升级默扩权。
- 人工sources在自主模式为可选优先/补充，在限选模式为唯一允许清单。`excludedSources`保留完整原ref，以原逻辑locator持续排除同一资料的新版本，排除不授予新权限。Agent工具不能自行改用户scope或解除排除。
- 复用原目录、resolver、资格和准确版本校验，不能只删selected检查。自动来源须在当前原资格目录中匹配准确tuple，正文再经原resolver及权限/hash；换版准确拒绝，不静默换latest。
- 各次实际发现/窄读沿原native工具调用/结果记录request、session、toolCall、准确source/hash及返回范围；发现不是正文读取。实际读取不回写为人工选择，不把全目录登记成已读。
- 续聊、Goal准确来源及下游实际Task重查历史实际来源，按当前真实接收者项目/模型/授权/Task排除核；旧native与准确引用保持。Scope收窄遇到既有历史内容时说明真实冲突，不冒称已忘记或自动重放。

## 仅受影响的UI确认

在原战略页“调整本次背景、模型与资料”内，增加一项背景使用范围：

1. 在本项目获准背景内自主查找（新工作已明确Project时合理默认，无需逐件勾选）。
2. 仅使用我手选的资料（空清单不回退为自主）。

原资料行保留可选手选/优先参考，并增加明确排除；两者互斥。旧讨论缺scope显示原限选，用户明确改选才改变后续范围。未明确Project仍可正常讨论已有说明，不扩大来源资格。

这是原手选含义的关键交互增量，依据工程规范第3节先确认受影响Demo再改正式UI。Demo：[pm01-ui-demo/README.md](pm01-ui-demo/README.md)，`http://127.0.0.1:43131/`；沿原App/Panel/原CSS，只内存变换资料区和合成stub，无Host/Pi/真实模型。Demo摘要 `86de9481f3a349ec19691a4ef5b7ca8eabc3a3b40e78654758dc8f5c76cddbe7`；Root已浏览器观察自主未手选、空限选、手选与排除状态，截图/完整AX在 `.local/v12-pm01-fix/ui-preparation/browser/`。用户已明确答复“确认此局部交互，继续实施”，见[准确确认记录](pm01-ui-approval.md)；现在实施正式资料区并验证真实Host承接，不重问整体方向。

## A—E关闭证据

- A：真实Host/官方Pi+合成Provider，新Project已有020背景，sources空且未限选，实际find/read准确正文/range/hash；不要求人点目录勾选。修前Host实际反例已失败在空目录断言（`host/01-discovery-red.log`），不是导入或fixture失败。
- B：显式空/非空限选、明确排除（含换版）、原手选和无Project保持；Agent不可借目录或猜ID绕过。
- C：跨项目/企业、grant/模型出口/来源Task/受管来源、换版/撤权仍按原机制；Plan前不取明细、不试连库。
- D：取消/停止/旧lease、重复、部分成功/UNKNOWN与原输入保留；准确发现和实际读回原native，未读不冒已读，不自动重放。
- E：自动读取→候选/采用→原Goal/GSA→Plan→实际Task准确回源；实际接收者权限/排除收窄仍拒绝。原两种确认/单多Task/明确综合及来源外传修复不回归。

## 执行与证据

只写当前工作树及 `.local/v12-pm01-fix/` 新证据根。先检查命令副作用；不在原路径重跑已知会覆盖旧四份GREEN JSON的UI脚本。完整回归使用隔离候选副本或专用输出根，并核实际候选hash，不引入新验证平台。

先真实RED再最小GREEN逐接缝推进，长期回归保留。非作者干净上下文独立复核固定候选及四原则；先导验收不从实现反推。

历史NOT_PROVED已被用户限范围接受，不重索同批准或补造历史；旧四GREEN不可恢复/归属UNKNOWN、原FAIL/SKIP及专业待验证继续保留。data-analysis本体和免测决定不变。Git/CI/merge、正式迁移/兼容回退、双机、真实模型/业务资料及SDK升级仍不由本轮自动授权。
