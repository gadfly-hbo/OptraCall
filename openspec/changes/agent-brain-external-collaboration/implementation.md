# Agent 大脑外部协作一期 · 实施记录（E01–E07）

2026-11-28 · 领取方 Qoder · Issue #155 · 任务分支 `work/qoder/issue-155-agent-brain-external-collaboration`

## 本轮目标与交付

按用户已确认的 v0.3 冻结包（提交 `2f6013fd`，spec `56522ef4…` / tasks `fe12198a…` / ui-demo `9a5626d5…`）实施 E01–E07 工程：原 Task 内部/外派选择与授权、GitHub 独立发布与通用认证领取、原实例受保护资产/工作远端 MCP、交付保全与同 owner 续接、WorkBuddy 可选适配工程合同、UI 与回归、隔离核心闭环与非作者复核。E08 真实账号/公网/设备采用不在本次授权。

验收以 spec AB01–AB18、tasks E01–E07 与冻结 Demo 共同为准。开 PR（含 draft）前须向用户展示真实产品截图并取得明确确认。

## 基线与身份

- 基线 main：`74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`
- 冻结包导入提交：`5d201f56de469947c62ce1f1803335db20079fa7`
- 阅读回执提交：`fe0eb95581181d71b392315b639ad2f9e8ddc3f5`
- Interface v3 · 官方 Pi `@earendil-works/pi-coding-agent@1.4.0` · MCP `@modelcontextprotocol/sdk@1.32.2`（不升级、不改包）
- 检查入口：`npm run check` = `check:agent-sessions` + `node --test tests/*.test.ts` + `build`

## 开工阅读（已完成）

- 根 AGENTS.md、工程规范 v1.17、统一会话接入说明（IN01–IN07）已读。
- 冻结 Demo 浏览器实际阅读回执：[evidence/implementation/reading/receipt.md](evidence/implementation/reading/receipt.md)（46 组截图，1440/1024/390 亮暗，9 条场景路径）。
- 生产映射：[ui-implementation-mapping.md](ui-implementation-mapping.md)。

## 执行清单（逐项更新）

- [x] P-read 冻结 Demo 浏览器阅读 + DOM/CSS 骨架 + 生产映射 + Issue 回执
- [x] D01 最小接口/持久迁移与回退设计 → [design.md](design.md)；后端接缝实测 [seam-report](evidence/implementation/seam-report.md)
- [ ] E01 内部/外派选择与授权、身份/持久记录；内部/取消零外部动作
- [ ] E02 GitHub 独立发布/修订/回执 + 通用认证领取、原子单 claim/UNKNOWN 幂等
- [ ] E03 受保护资产/工作 MCP、OAuth/精确交集/只读/错误与分片边界
- [ ] E04 字节保全/ExternalDeliveryRef、原 owner 指纹/providedContext/非用户原话、busy/重启/暂停/取消/迟到、Agent 核验/原工具保存
- [ ] E05 WorkBuddy 可选适配工程合同（默认未验证禁用）
- [ ] E06 UI 编码（沿映射）+ 三路径 + 1440/1024/390 亮暗/键盘/焦点 + 原消费者回归
- [ ] E07 隔离 Host/Pi/标准 MCP/TLS/OAuth/GitHub 模拟供应商核心闭环 + 三冻结基准逐项非作者复核
- [ ] G01 真实产品同视口对照 + 开 PR 前截图用户确认（PM 门禁）
- [ ] G02 实际 PR head CI + 授权合并 + main push CI + 结案回填

## 设计（D01，已完成）

见 [design.md](design.md)：记录权威与持久化（external-work-store，原子 JSON CAS）、owner-bound 外派 port、Host-only GitHub 发布入口、远端 MCP/OAuth 复用与净新边界、续接/停止/取消合同、WorkBuddy 可选适配、迁移与回退、S1–S7 切片与 TDD 负例。后端接缝实测见 [seam-report](evidence/implementation/seam-report.md)。

## 验证与限制

（随切片更新：真实 RED/GREEN、命令、失败/跳过/未验证、兼容回退。）