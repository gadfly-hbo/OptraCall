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
- [~] E01 内部/外派选择与授权、身份/持久记录；内部/取消零外部动作 —— S1 切片完成（store＋grant＋internal/external choice＋owner-bound port）；Host 接线（server.ts/工作方式卡）待后续切片
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

### S1（E01，2026-11-28）：外派业务记录权威 + owner-bound 授权 port

**本轮交付**（自包含，不接 server.ts/UI；真实 Studio/语义资格与发布/触发接线属后续切片）：

- `src/host/external-work-types.ts`：WorkGrant / ExternalWork / PublicationAttempt / Claim / ExternalDeliveryRef / ReviewDecision / InboxEvent / ResumeReceipt / InternalChoice（内部选择意图）记录类型与严格校验；全部绑定真实 `projectId/taskId`，与 Case `assignment.issue` 身份分离（`sourceCaseRef` 仅为可选准确引用，不反向派生）。
- `src/host/external-work-store.ts`：`dataRoot/external-work/ledger.json` 原子 JSON 台账，镜像 ServiceConnectionStore：0700 目录/0600 文件、`O_NOFOLLOW`、tmp+rename+目录 fsync、`.store.lock` inode 校验、公开 `mutate(state, expectedVersion)` CAS、严格 schema:1 解析（含引用完整性与唯一身份检查）、启动把外来进程 `submitted` 标 `unknown`、过期领取标 `expired`、64MiB/10000 记录上限；进程标识可注入以测试真实重启语义。Claim 同 (workId, revision) 至多一个有效领取（原子 CAS，同 principal 幂等、竞争者冲突、错 epoch/过期/撤销拒绝、租约封顶于授权有效期）。
- `src/host/external-dispatch.ts`：Host 构造的窄 facade `summarize / chooseInternal / authorize / cancelWork`。authorize 校验允许执行者集合、仓库稳定 ID+可见性、精确资产 refs 与注入的 `qualifyAssets(projectId, refs)` 原资格回调取交集（越权 ref 整体拒绝）、显式企业必填（无 legacy 默认放行）、有效期须为未来、资源策略默认 1work/24h 且较低已批准策略优先、超默认拒绝、限 1work/窗口（取消后可同窗重派）。chooseInternal 记录意图零外部动作；已有未取消外派拒绝静默切回。受限 profile 经注入 `profiles` 回调拒绝外派、内部路径不受限（AB01）。

**TDD 证据（先真实 RED 后最小 GREEN）**：

- RED（桩阶段，行为缺失导致断言失败，非导入/环境错误）：`evidence/implementation/red/s1-external-work-store-red.log`、`red/s1-external-dispatch-red.log`、`red/s1-combined-red.log`（均 exit=1，61 个失败子测试，全部 `external_*_unimplemented` 行为错误）。
- GREEN：`node --test tests/external-work-store.test.ts tests/external-dispatch.test.ts` → 35/35 PASS（`green/s1-combined-green.log`；store 用例连跑 8 次、dispatch 用例连跑 4 次无抖动）。
- 检查：`npm run check:agent-sessions` PASS（`green/s1-check-agent-sessions-green.log`）；`npm run build` PASS（`green/s1-build-green.log`）。
- 全量 `npm test`：3721 测试，3608 PASS，2 FAIL，111 skipped（约 9 分钟）。2 个失败为 `conclusion-review-handoff` 的 CNR-A4 一例（隔离复跑仍 9/10）与 `service-connection-manager` 一例（隔离复跑 29/29，属负载抖动）。已用 `git stash` 在干净基线 `7decc3b` 复核：CNR-A4 在未含本切片改动的基线上同样失败（9/10），判定为既有问题，与本切片无关；两例均已如实保留，不在本切片内修复。本切片新增测试已包含在上述全量统计中且全部 PASS。

**关键负例覆盖**：store CAS 版本竞争单一胜者；外来 submitted→unknown 保留不重试、本进程 submitted 不误标；9 类损坏 schema（版本升位/未知键/悬挂引用/坏 hash/重复身份/坏时间戳/复核 hash 不符/非法 mode/非 JSON）一律 `external_store_corrupt` 拒绝；失败变更零半份记录（文件字节不变、无 tmp 残留）；并发/重复领取至多一个有效；错 epoch/过期/撤销/未发布/越集 principal 拒绝；租约封顶授权有效期、过期事实先持久化再报错；发布身份按 (work,revision,action) 去重、异文冲突、转移表守卫、unknown 仅 reconciled 可核定；交付幂等键同文回执/异文冲突、复核绑定准确 delivery hash；受限 profile/缺企业/越权资产 refs/超默认策略/窗口限流/过期有效期拒绝；chooseInternal 零 Issue/零触发/零资产增权且已有外派不静默切回；取消零外部记录并撤销有效领取。

**失败/跳过/未验证项**：

- S1 未验证（明确不在本轮范围）：真实 GitHub/WorkBuddy 出站动作（E02/E05）、远端 MCP 与真实资产资格接线（E03，`qualifyAssets` 本轮为合成回调）、交付字节保全与续接/停止/取消外部请求（E04）、UI（E06）、真实公网部署（E08）。store 层未做跨进程文件锁的破坏性压测（沿用与 ServiceConnectionStore 相同的 inode 校验模式，其既有覆盖不重复）。
- 兼容回退：ledger 为新增可选业务记录；旧项目/会话/native/草稿不迁移不改写；缺 `external-work/` 目录按空台账读取（AB15 legacy 读取已测）；损坏台账拒绝服务不静默重建；新增记录含 UNKNOWN/撤销事实，回退不重放外部动作。

