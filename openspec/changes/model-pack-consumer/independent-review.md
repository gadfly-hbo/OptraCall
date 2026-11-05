# 模型包消费端 · 非作者独立复核

当前状态：固定 v2 适用工程复验通过，三个 P2 由原复核者重验关闭，无剩余必须修复项。v1 不通过原结论及历史 NOT_PROVED 保留；MP09仍NOT_RUN。

## 独立性与固定输入

规格轴 `modelpack_independent_spec`、规范轴 `modelpack_independent_standards` 均以全新 `fork_turns=none` 启动，未参与候选任何创作。二者先从规格 MP01–MP10／R1–R8、已确认 Demo 和工程规范导出预期，再看实现及作者测试；原树只读，各自隔离副本验证。UI、工具、安全测试作者未担任独立复核者。

初始完整 v1 为 938 文件，清单 SHA-256 `cf86bec127ff0293f001658b5a273b1f85413002e8c3fb3751ff711940eaddf2`；原 Qoder 10 项清单仍追溯移交 `380d5ab`，不回写为新候选。v2 完整清单另存 `.local/model-pack-delivery/candidate-v2.json`。

## v1 原始结论与证据

- 规格轴：96 项目标测试、边界、tsc 与自编沙箱／不可变／恢复／原 manifest 探针通过；实际反例发现非法 training.groups 被丢弃、未来 SQLite schema 被降级改写，结论不通过。
- 规范轴：107 项目标测试、边界、tsc、实际 Node 权限／网络／代码生成、AST 转义／计算索引、多进程导入及晋级检查；实际反例发现未知数据库 schema/失败缓存绕过，以及步骤 AX 在失败和未运行时仍读出勾，结论不通过。
- 两者核对 root 的 23 份 AX／截图固定证据，并不声称自己操作浏览器。Node 权限与 AST 合用，未把单个扫描或权限旗标当通用恶意代码隔离证明。
- 源报告及有效反例在工作树 `.local/model-pack-delivery/review-spec-3wjmdmdt/` 与 `review-standards-20261105T235923-37d8eac0/`；原报告 SHA 分别 `3bb39b9eea6bfe4b9be315e33c503ab56a5f7648360cc34fb6207039b1f7666b`、`8e792fa9d4323fd21607787a776a1b405abd8412285f921af25d5d2a6c119e36`。原始报告、补充报告、脚手架失败和真实产品失败分别保留。

## 修正及待复验范围

1. P2-SCHEMA：仅新库事务初始化，已有库先校版本和表/索引 inventory；校验失败连接不缓存，重复只读/写调用不能绕过。保留未来库完整字节；root RED/GREEN 22/23/26。
2. P2-GROUPS：已提供非法 groups 明确拒绝，省略仍兼容；原类型测试保留，root RED/GREEN 24/25/26。
3. P2-STEP-AX：装饰符号 aria-hidden，失败×、未运行无勾，每步有实际通过/失败/未运行文字；原 AX 和有效组件行为 RED 保留，作者定向35项和 tsc 通过，等待真实浏览器和非作者复验。

## 结论边界

最终 Host／Agent 职责及复用专项结论由复验续记。既有项目、会话、历史、文件与其他入口不因本复核改变。MP09真实包、真实Provider、设备更新及运行采用均未授权／NOT_RUN，不以合成工程检查替代。Qoder 原切片逐项行为前置TDD的历史证明仍 NOT_PROVED；如实披露该缺口与当前功能和独立验证分别判断。

## v2 原复核者复验（2026-11-06）

v2 为939文件，清单 SHA `9ba1d746865f70adbbecf2dfed17a0d3bfc0adb62fb803cbfd716239af9d844e`。两位复核者各自新建隔离副本逐项核对，运行后939文件零漂移。

- 规格轴100/100目标测试、boundary、tsc、自编schema四组重复list/promote/import/只读与DB字节/size/mode/mtime、groups八非法及省略/合法兼容、既有CLI/沙箱/恢复探针均通过；已报两P2关闭，步骤可访问性亦通过。源报告 `review-spec-v2-ae1j9p4_/report-v2.md` SHA `942380ef9dafc9ad7bbf0ea2b0be7179ff2c37621b0176773aecc4603821492c`。
- 规范轴111项适用用例通过，schema未知/失败缓存、旧v1只读兼容、四进程安装及并发晋级、UI组件与3份新AX/截图复验通过；已报两P2关闭，无剩余必须修复项。首轮7项为复核副本未建.local的夹具初始化失败，原日志保留，补自己目录后7/7；不计产品RED。源报告 `review-standards-20261105T235923-37d8eac0/closure-v2.md` SHA `9dab2ee195fa69e77cd251c2b9b0ce10caad6993e62a0fffbeed7a68ad6bc1de`。
- **职责边界及复用专项：通过本变更适用范围。** 实际复用project-tasks／Interface v3、原Pi工具/会话入口和能力开关；模型选择、备数、调用、纠错和解释由Agent决定，Host只治理导入、存储、权限、沙箱和成果保存；没有新Runtime/owner/profile/模型循环或必经分析流程。额外人工仅显式导入、业务上线确认，原任务开关沿既有模式。结论不扩至未检查的其他模块或真实经营效果。
- root固定v2完整检查29随后exit0：1558项／1528通过／0失败／30原条件跳过，边界、tsc、构建通过；独立者自身目标检查与root完整检查分别记录。`final-local-check-receipt.json` 及原日志 SHA `48f3f6f676e38b2beec839ae207bb7a3925c485f53771d24c81410e7ce51b191` 可回读。GitHub CI 尚待实际交付head，不以本报告代替。
