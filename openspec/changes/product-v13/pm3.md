# 无看板历史轮次的 Teach

原 PM 已关闭产品提交 `abe1d16` 的四项差额和六个修正场景。本轮目标是让用户在同一事项进入 B 轮之后，仍能依 A 轮的暂缓或不行动取舍启动 Teach，提交后来取得的观察，并在重开后回看。产品依据为框架 v0.8 C7/C12、规格 v0.3 §3 与 T3。PM 报告 SHA-256 为 `ca9439a531455754b762635bab74a4b4b001f5d34588d0e7b7acf52a97acdf40`。[原 PM 复核报告](/Users/bendandebaba/.codex/plans/optracall-architecture-product-v1.3/product-review/OptraCall_v1.3_PM_Repair_Product_Review_abe1d16_2026-11-19.md)

沿用 Case 的取舍及原依据、人工建 Task 表单、Interface v3 的 project/task owner、现有普通任务 profile 与官方 Pi 1.4.0。Host 负责交付选中的轮次、校验权限及保存身份。用户确认是否建 Task 和保存复盘，Teach 负责解释实际观察。继续由看板保存实际行动和授权。

- [x] 已核对开工 HEAD `61c7330`，相对受审提交仅六份工程记录。工作树干净，远端分支、main 和 Mini 正式服务均为 `69e766f`。
- [x] 旧版 Chrome 的两种 A 历史卡片均无可用的建 Teach 入口。通用表单只带入 B，A 的复盘表单没有可选回复。[原失败](../../../.local/product-v13/pm3/author/recall-red.log)
- [x] 两种会员召回 A 轮均可打开原表单，取消后任务、看板、Case 及模型请求数保持原值。确认后 Pi 收到 A 的计划及理由，两份观察保存、重开后对应原 A，B 原记录逐字段一致。[浏览器点验](../../../.local/product-v13/pm3/author/recall-green.log)
- [x] 已验证缺观察、无改善、效果未知、关闭、失权与恢复、原号重试和已有看板的 A 轮。撤去原方案项目、保留接收项目时，新增模型请求为 0。[Host 与 Pi](../../../.local/product-v13/pm3/host/baseline.log) · [跨项目](../../../.local/product-v13/pm3/host/baseline-separate-project-rights.log)
- [x] 工程候选已固定，整仓检查与两项非作者复核完成。以下为本次 PM 回交记录。

## 固定候选与正常入口

产品提交 `01b7820cd7ceffb4d2f7f78f9c0ab4cbbd1c8793`，Git 树 `40526f2ab6bac952b4204c7425b57984610ae2ac`。在「决策星图 → 原 Case → 会员召回 → 历次取舍与实际反馈」，找到暂缓或本次不行动的历史 A，点「按本轮取舍准备 Teach」。原建任务表单显示事项、取舍、方案及版本、原理由。用户可以取消，或确认后再把外部观察发给 Teach。原回复可在 A 下选用、核对并保存。[受审旧版现场](../../../.local/product-v13/pm3/final/prior.log) · [固定候选浏览器点验](../../../.local/product-v13/pm3/final/candidate.log)

| 会员召回的 A 轮 | 一周后取得的资料 | 保存并重开后的结果 | Pi 原件 |
| --- | --- | --- | --- |
| 暂缓 | 一周后两店会员召回到店率持平 | 未见改善，原复盘 `6bbe1f6d-283f-4804-8834-a4e2f37c38c3` | [实际请求与原回复 92e82939](../../../.local/product-v13/pm3/final/candidate/defer-IyF6dR/receipt.json) |
| 本次不行动 | 两店会员召回的外部观察窗口尚未结束 | 效果未知，原复盘 `7e98498c-eae4-48b1-9116-c0fba24c3b32` | [实际请求与原回复 5caefdff](../../../.local/product-v13/pm3/final/candidate/no_action-AXcTJs/receipt.json) |

两例在 A 没有行动、没有预建 Teach，B 已有自己的取舍、行动授权及复盘之后开始。打开表单和取消后，任务数、Case 时间线、看板及模型请求数与原值相同。每例由用户确认一次并发送一次。Pi 收到 A 的原方案、理由、回复编号和本次观察。保存重开后，B 与其修前记录逐字段相同，A 的行动数仍为 0。已有看板观察的迟到 Teach 和双上游路径另跑通过。[完整浏览器收据](../../../.local/product-v13/pm3/author/final/summary.json) · [原看板路径](../../../.local/product-v13/pm3/author/previous-chrome.log)

Case 与项目继续按原身份校验权限。单独解除原方案项目的关联、保留 Teach 接收项目关联时，真实首发返回 409，模型请求增加 0。恢复原方案项目后原任务能收到 A 的原文。无观察不能保存。换用 B 回复或更改原操作内容均被拒。重复原操作返回同一复盘。Case 关闭后仍按原权限回读，新的业务写入及派发遵循原规则。[三种轮次](../../../.local/product-v13/pm3/host/bd8b91d.log) · [撤权与恢复](../../../.local/product-v13/pm3/host/bd8b91d-separate-project-rights.json)

## 回归、复核与回退

干净候选运行 `npm run check`，共 3,064 项，2,953 通过，111 跳过，0 失败、0 取消。统一会话边界、TypeScript 和构建通过，构建标记 `01b7820`。七个官方 Pi 1.4.0 包共 2,530 个文件与官方包一致。[整仓回归](../../../.local/product-v13/pm3/check-01b7820.log) · [官方包逐项核对](../../../.local/product-v13/pm3/official-pi.log)

**非作者规格轴通过。** 在最终 Git 归档，复核者用两个项目、同一事项四轮取舍，把两个历史 A 的外部观察按相反顺序补回。两次 Pi 派发都取得各自的原计划与理由，B 的取舍、授权、原反馈和已保存复盘保持一致。另验已有看板的迟到 Teach 及目标、战略两个上游。旧轮保有真实的前序取舍编号，能回溯原关系。[独立规格报告](../../../.local/product-v13/pm3/spec/review.md)

**非作者工程规范轴通过。** 独立归档开启和关闭证据采集分别跑通两种 Chrome 场景。双项目三轮组合中，打开表单后撤掉接收项目资格，提交返回 403。单独撤掉原 Plan 项目，新的派发返回 409。两者的模型增量均为 0。Case 关闭后，新建或新派发受限，原复盘仍能按权限读回。错误的测试时序、独立脚本初次定位或预期失败及复验均有记录。[独立规范报告](../../../.local/product-v13/pm3/standards/01b7820-zR301H/standards.md)

产品源码固定在前一提交 `bd8b91d`，与最终提交逐字节相同。第一次非作者归档点验发现，测试从项目返回 Case 后，在历史行载入前就读取了按钮数量，两条测试均报失败。最终提交的测试会等待原 A 行显示后再检查入口，并在开启或关闭取证时均走一次项目普通表单。旧产品和新产品使用同一份修正后的脚本重跑，两条旧场景均缺入口，两条新场景均通过。中间提交的整仓检查在测试修订就绪后停止，完整检查另在最终提交上取得。[原检查记录](../../../.local/product-v13/pm3/check-bd8b91d.stop.txt)

回退在已停写的隔离根实际演练。用前版 `abe1d16` 打开候选生成的记录，A/B 的复盘号及正文一致，三份原回复和四个原生会话文件 SHA-256 一致。回到旧界面后，未预建 Teach 的旧暂缓或不行动轮次仍有原来的建任务入口缺口。正式采用前保全完整数据根，采用期间新增资料保留独立副本。正式设备的全根恢复待验。[同根前版回读](../../../.local/product-v13/pm3/host/rollback-bd8b91d-defer.json)

批准包 56 个文件和前三次索引的 35、118、426 份原始资料已重算摘要。本次产品变更文件及 216 份原始记录列在[本轮证据索引](pm3-verification.json)。本分支冻结在本机。远端工作分支、main 及 Mini 正式服务依旧是 `69e766f`。五份专业 Skill 的独立测评与确版、开放模型真实专业表现、远端交付及 CI、正式运行采用与用户产品验收分别待核。[版本与运行身份](../../../.local/product-v13/pm3/runtime-01b7820.json)
