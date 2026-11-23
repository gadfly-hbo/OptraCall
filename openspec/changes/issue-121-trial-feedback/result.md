# Issue #121 实施与验证记录

状态：实施中；以下项目未实际完成前均不为 PASS。

## 身份与证据位置

- 基线：`166c7136bc65c3cc37c237ef62f4652c01a79f2a`
- 试用原始版本：`e1264c23db8c8dfa2e4d080f123f9558eaecaea3`；Issue 正文保留默认 Skill 3 次失败、关闭后 2 次成功的原始事实，本记录不改写。
- 工作树：Qoder 独立任务工作树，分支 `work/qoder/issue-121-trial-feedback`。
- 规范：工程规范 v1.12；Interface v3；Pi SDK `1.4.0`；传输依赖 `8.12.2`。
- 本地证据：任务工作树被忽略的 `.local/issue-121/`。公开结果只保留脱敏摘要。

## 过程偏差保留

首次准备时两条 shell 命令未显式 `cd`，误在主工作区执行：一次 `npm ci` 完成，一次 `npm run check` 被立即停止。主工作区 Git 仍清洁、源码和锁文件未改，该检查不采作任何基线证据；未启停服务。之后所有 shell 命令显式进入隔离工作树，重新安装并验证。

## 分项结果

| 项目 | 当前结果 | 证据与未覆盖点 |
| --- | --- | --- |
| BASE | PASS（工程基线） | 已领取并回读；独立工作树 HEAD 与开工基线一致；实际 Pi `1.4.0` / undici `8.12.2`；最新主线隔离 `npm run check` 退出 0，日志 `.local/issue-121/baseline-check.log`。 |
| P1 | PASS（工程范围） | 最新主线无碰撞时开启/取消均 202 并完成；隔离同名 Skill 后精确复现 500，底层 RED 为 `task_skill_version_changed`。修复后真实 Pi 开关、候选 UI 和安全恢复提示通过；试用版同因复现保留。MacBook 实机与真实 GLM 配置未重跑。 |
| P1-REG | PASS（已选影响面） | 普通/受管会话与恢复、可选 Skill、手工 Task、Studio 建设、诊断兼容共 6+12 项通过；另完整基线/最终检查分别记录。 |
| P2-TOOL | PASS（四类指定场景） | Studio sources、SAP package.id、member-pack scope、交付声明预算均完成真实工具路径 RED→GREEN，含字段路径、修正、结构化脱敏和改正后继续。 |
| P2-AUTH | PASS（工程范围） | 真实运行时未授权/定义与汇总/有效明细/越界/撤权及 macOS Python 重算通过；完整 Chromium 覆盖用途/期间表单、非权责只读、创建/撤回及第二上下文隔离。 |
| MSG | PASS（指定对照） | Skill 初始化提示给出恢复/取消下一步；权限拒绝区分授权操作、Studio 入口和授权方，db-link 与启动错误不再共用泛化原因。 |
| PREVIEW | PASS（Agent 判断）/ 产品缺陷已修 | 未见样例三类陷阱 Agent 判断全部正确；首稿保留；发现 3 个产品供给缺陷（remainingGaps 类型、SAP 缺文件、delivery 缺文件）均已 RED→GREEN 修复。详见下方 PREVIEW 专项。 |
| DONE | PASS | 完整检查 3212/3101/0/111、真实 UI、三轮非作者复核 CLOSED、候选已提交推送。 |

## 实际修改与验证日志

### P1：同名 Skill 碰撞

- 最新主线正常 UI：同一合成项目、同一 loopback `synthetic` 配置下，无碰撞时默认开启与明确取消均创建原生会话、POST messages 返回 202、收到合成回复。提交/持久化分别为固定 `data-analysis@2.0.0-candidate.1` 和 `skill:null`；原生系统上下文只在前者包含内置准确路径。
- 最新主线弹窗及 DOM 仅一个默认 Skill 复选项；本隔离入口未复现第二个同名复选项。已建任务另有 Skill 编辑入口，不能与弹窗控件混计；MacBook 原“隐藏副本”现场保留为未覆盖项。
- 在合成项目上级 `.agents/skills/data-analysis` 放入不同内容的同名 Skill 后，默认开启首条消息精确复现 HTTP 500 和泛化提示；未生成任务 sessions。这证明“无碰撞正常”不能覆盖同名资源环境。
- RED：`node --test --test-name-pattern='typed default skill keeps' tests/project-runtime.test.ts`，1 失败；实际 `sdk_operation_failed`，`cause.message=task_skill_version_changed`。日志 `.local/issue-121/p1-collision-red.log`。
- 原因：Pi 先按公开资源顺序让用户/项目同名 Skill 获胜，Host 后又要求内置固定路径，开启时拒绝；取消会过滤该名称，因此成功。
- 修复：`src/agent/project-session.ts` 通过 SDK 公开 `loadSkills` 精确加载固定内置文件，再替换同名外部项；不改官方包、不放宽版本/SHA 校验，其他 Skill 保留。
- GREEN：`node --test --test-name-pattern='typed' tests/project-runtime.test.ts`，2/2 通过；覆盖碰撞下开/关、实际内置路径、首条回复及原无碰撞开关。日志 `.local/issue-121/p1-collision-green.log`。
- 试用版补充复验：同一夹具在 `e1264c2` 真实 Pi open 上拒绝，`sdk_operation_failed/task_skill_version_changed`、0 次 Provider 请求；`.local/issue-121/old-version-repro.log`。
- 候选正常 UI：同一碰撞仍在时创建默认开启任务，POST messages 202，UI 收到合成回复；Provider 实际系统上下文含内置 `extensions/analysis-assets/data-analysis/SKILL.md`，不含合成碰撞路径。
- 初始化失败提示：`runtimeDiagnostic` 仅白名单识别 `task_skill_version_changed/task_skill_unavailable`，HTTP 与诊断提供恢复/明确取消下一步；未知异常仍保留脱敏 `request_failed/host_tool_failed`。新增 Host 提示测试、诊断兼容和 12 项回归通过。
- 受影响回归：`PP01/02` 普通/受管首次使用与恢复、`DA08/DA01` 可选 Skill、`v1.3 manual` 手工 Task、`ST07/14` Studio 建设会话通过，日志 `.local/issue-121/p1-affected-regression.log`、`.local/issue-121/p1-diagnostics-green.log`。

### P2-TOOL：四类定位修复

- 复用公共 `safe-tool-error-v1` 白名单；生产者只补充安全 `message` 和 `issues{reason,path}`，不回显原始资料或本机路径。
- `studio_assets`：Agent 侧非数组与 Host 侧 201 项上限均给出 `payload.sources`、期望形状/数量和修正方式；单元索引错误带 `payload.sources[i]`。SAP `package.id/version` 拆分精确字段，映射给出规则、示例和 `package.id` 路径。member-pack 缺 `scope` 给出 required 与处理提示。交付声明超预算给出总回包限制、可缩减字段和 `declaration` 定位，不回显原文。
- 每类均完成真实工具路径 RED→GREEN，改正后继续并保存成功；日志 `.local/issue-121/p2-*red.log` / `p2-*green.log`。
- 兼容影响：`metric-sap` 既有断言按更精确 `package.id/version` 路径更新，不放宽校验。

### P2-AUTH：指引、准确范围与 UI

- 运行时对照：未授权目录仅给 `authorizationRequired` 与三层授权指引；定义/汇总项目读 020 明细被拒并说明缺 `read-detail-recalculate`、Studio「三层资源授权」入口及 grantAuthority 持有方；有效授权含项目、门店、`2026-09-01..2026-09-30` 期间和用途，macOS 沙箱内柳岸/路径越界仍拒，Agent 用 Python 独立重算并保存，随后撤权立即阻断并清空沙箱文件。`db-link` 403 指向受控工具与授权入口。日志 `.local/issue-121/p2-auth-red.log`、`.local/issue-121/p2-auth-green.log`。
- 表单：补齐 #111 已确认的 `purposeKeys`、期间起止字段并在授权列表显示；产品原有权限判定、grantAuthority 或撤销逻辑不变。
- 完整 Chromium：初跑因本地 Python 无 playwright 未启动；随后三次失败均为脚本前置状态错误——浏览器无原权责操作者、API Cookie 先切到消费项目、当前项目未回到 owner。修正为通过现有 operator login API 在浏览器上下文认证、创建体系前恢复 owner 上下文、对照前显式选择消费项目，原未授权/非权责/授权/撤回/第二浏览器上下文断言全部保留；最终 PASS、0 page errors。日志 `member-browser-green-1..6.log`，失败与修正过程保留。
- 测试环境：私有 `.local/issue-121/browser-venv` 和 Chromium 下载，未改全局 Python；未引入产品依赖或 SDK 版本变化。

### 完整检查

- 候选隔离 `npm run check` 退出 0：3210 tests，3099 pass，0 fail，111 skipped，duration 361.8s；构建身份 `0.1.0-mvp.4 166c713+local-changes`。日志 `.local/issue-121/candidate-check.log`。

### 非作者独立复核与返修

- 全新上下文复核结论 PASS with findings（3 minor、0 blocker/major），报告 `.local/issue-121/independent-review.md`，SHA-256 `94428cd74abcdec30b4452d2dcb157b12be53dbfed417c8b934367cfc87e427c`。其核验包含 SDK 公开导出、四项 Skill 身份校验、安全回包、测试真实性、四原则与 targeted 实跑。
- 发现 1：项目 `.pi/skills` 同名副本仍使 Host 预检 409。新增公共 Host 首条消息真实回归先 RED 后 GREEN；`projectSkillCatalog` 用公开 `loadSkills(includeDefaults:false)` 精确装载内置分析资产并覆盖同名默认 winner，非同名用户/项目 Skill 保留。
- 发现 2：Skill 恢复文案硬编码重复。改为从 `approvedTaskSkills` 派生单一导出，Host 复用。
- 发现 3：SAP fallback message 内嵌未清洗 path。改为与安全 details 相同的字符/长度白名单，失配降级通用 `document` 文案。
- 增量复核结论 CLOSED：三项全部关闭，无新增阻塞；抽跑 run-diagnostics/metric-sap/project-host/studio-host/project-runtime 全绿。保留两条 info：`task_skill_unavailable` 文案仍双份；bundled 同名覆盖使用户副本在能力目录中不可见（与固定内置优先级一致）。
- 真实首版预验进行中发现三个产品供给缺陷并另行修复：
  1. `pack-upsert-purpose` 对字符串 `remainingGaps` 抛 TypeError → `invalid_purpose_remaining_gaps`（expected_string_array / payload.remainingGaps）。
  2. `register-sap-metric` 读取不存在 YAML 时 ENOENT → `studio_metric_candidate_unavailable`（candidate_file_unavailable / payload.path）。
  3. `declare_analysis_delivery` 的 `reviewBasis`/`reports` 引用不存在文件时 ENOENT → `analysis_delivery_basis_unavailable` / `analysis_delivery_report_unavailable`（basis_file_unavailable / reviewBasis 或 report_file_unavailable / reports）。
  三处均 RED→GREEN，改正后继续；增量非作者复核 CLOSED。日志 `.local/issue-121/preview-found-*red/green.log`、`preview-found-fix-regression.log`、`preview-found-delivery-basis-*.log`。
- 返修回归：4 项针对性测试通过，`npm run typecheck` 与 `git diff --check` 通过；日志 `.local/issue-121/p1-pi-collision-red.log`、`p1-pi-collision-green.log`、`review-fix-regression.log`。
- 返修后全量检查（final-check.log）：3211 tests / 3100 pass / 0 fail / 111 skipped。
- 全部修复后最终全量检查（final-check-4.log）退出 0：**3212 tests / 3101 pass / 0 fail / 111 skipped**，duration 461.2s；构建 `0.1.0-mvp.4 166c713+local-changes`。中间两次全量检查各有一个预存时序抖动测试失败（verification-revision-preservation / db-link-pg-lifecycle），均与本次修改无关且隔离运行通过，最终重跑全绿。

### PREVIEW：真实首版复验专项

**授权与配置。** 用户 2026-11-23 单独授权本次首版复验。模型 GLM-5.3-Flash [zai]（付费 API，baseUrl `https://api.z.ai/api/paas/v4`），凭据经产品现有导入入口进入隔离运行根，不写入日志/公开记录。Pi SDK 1.4.0，Interface v3，普通 unmanaged project-tasks owner。

**输入身份（未见独立合成样例）。**
- `member-policy.md` SHA-256 `e9de1dc4193f3317f93f99373c71367878d089f19f1bf4a7c2897e7d2aa44b53`
- `monthly-note.md` SHA-256 `e28e70e0611c1948661796445e883caa8516427ad76fa4590019e77d93eebede`
- `orders.csv` SHA-256 `f081e366d6cc05d488233f4d38c9c4c4236614fb88b5424b400d7db5d7a557cb`
- 覆盖：南湾 2026-08 缺档、A002/B002 未成熟 30 日窗、B001 首购历史不足（仅 9/1 起可见）。

**运行身份。** 项目 `0b89b280`，任务 `10a77bd7`，体系 `872da0e2`，原生会话 `2026-11-23T07-59-42-238Z_01a2076a…jsonl`。startedAt 07:59:41 → settledAt 08:34:47（约 35 min）。53 次 HTTP 200；token 用量 input 176,734 / output 108,956（SDK 记录，非供应商结算）。

**首稿判断（三类陷阱）。**
| 陷阱 | 首稿处理 | 判定 |
| --- | --- | --- |
| A002 未成熟 30 日窗（9/25 首购，截止 10/15 仅 20 天） | 列"观察中"，窗内已见复购仍不计入成熟分母 | 正确 |
| B001 首购历史不足（仅 9/1 起可见） | 命名"首次可见购买"，复购资格待定，不称真实首购 | 正确 |
| 南湾 2026-08 缺档 | 明确"缺档=未知，未填零" | 正确 |
| 跨店排名 | 未排名，列限制与补证问题 | 正确 |

**结论：Agent 判断偏差 = 无。** 三类陷阱全部正确处理。首稿保留于 `.local/issue-121/preview-first-draft.md`。

**产品供给/发布缺陷（首稿过程中暴露）。**
- `pack-upsert-purpose` ×3：字符串 remainingGaps → TypeError → host_tool_failed。**产品缺陷，已修。**
- `register-sap-metric` ×2：YAML 尚未写入即注册 → ENOENT → host_tool_failed。**产品缺陷，已修。**
- `declare_analysis_delivery` ×2：reviewBasis 引用不存在文件 → ENOENT → host_tool_failed。**产品缺陷，已修。**
- `extract`（Semantica）不可用：隔离环境未配置 Python/Semantica，Agent 正确降级为人工核读，未伪造 extraction 证据。**环境限制，非缺陷。**
- `prepare-publication` ×7 返回 `studio_source_not_ready`：Agent 保存的资产 checks 未全 pass（作者自查证据不足），Host 正确拒绝发布。Agent 最终调整 excluded 列表后成功准备 definition-reference 预览。**Host 门禁正确；Agent 迭代属正常自主纠错。**
- 重复规则资产 `e1b3434c`：保存重试产生，mark-issue 因 revision conflict 未标记，Agent 在发布 excluded 中披露。**已知限制，非本轮新增缺陷。**

**发布预览状态。** Studio 体系 `872da0e2` 含 6 个 prepared-not-approved 预览（最终 `23c4f34f`，definition-reference，3 资产，排除 rule-execution 与 SAP）。会员包 PACK-MEM-001 全景 v1 + 4 条目 + 3 工作项已保存；purposes 因 remainingGaps 缺陷未写入（已修，修复后同载荷可成功）。报告 `060_reports/chengchuan-member-repurchase-build-v1.md` SHA `153f9faa…ba40c` 已保存。

**未验证项。** 修复后未重放真实模型（用户授权仅一次首版）；会员包 purposes 修复后的真实模型端到端未验；MacBook 实机未操作；供应商结算费用未知（SDK token 计数非账单）。

### PM 复核返工（三组）

PM 接管后独立复核发现三组阻断问题，退回原领取方。已在原分支追加修正：

1. **Skill 目录覆盖收窄。** `projectSkillCatalog` 恢复 SDK 原始选择顺序（项目/用户同名优先），供 Project Plan 能力校验使用。新增 `loadFixedBuiltInSkill` 仅供 `checkAssignmentSkill` 的固定内置校验路径，不影响通用目录。新增测试验证项目 `.pi/skills/deep-research` 在目录中保持项目版本。
2. **用途语义统一。** 表单仅分隔符输入拒绝（零写入）；汇总读取路径 `purposeKeys: ['*']` 按通配处理（与 `evaluateResourceAccess` 一致）。新增测试覆盖 `*` 匹配任意用途、精确键不扩大、空键不限（legacy）。
3. **SAP 未知键不回显。** `SAP_UNKNOWN_FIELD` 错误路径剥离末段未知键名，只保留结构父位置；message 和 details 均不含原始键。新增测试用 `SYNTHETIC_RAW_CUSTOMER_1234` 验证不回显。

返工回归 14 项通过；全量检查另行记录。

### PM 二次返工（两组残留）

1. **SAP 键回显更严格。** 校验器 `caliber_switches` 类型错误不再将业务键放入错误路径。回包侧改为逐段白名单（小写 snake_case / 纯数字索引），首个不安全段即截断，覆盖单段、含点号、动态键三类。新增测试：三种原始键（下划线、点号、业务开关键）均不进入正文、details 或下一轮模型请求。
2. **用途/范围一致性。** 表单不再按空格拆分用途键（仅顿号/逗号）。存储拒绝显式空 `purposeKeys: []`（legacy 缺字段仍不限）。汇总读取改为遍历全部匹配授权（不再首张阻断），并从用途 scope 传入 brand/channel/period 到 `evaluateResourceAccess`，品牌/渠道不匹配拒绝。新增测试：空数组拒绝、品牌匹配/不匹配、通配不限制品牌、precise 不扩大。
