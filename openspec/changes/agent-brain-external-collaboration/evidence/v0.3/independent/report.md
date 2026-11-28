# Agent 大脑 v0.3 独立准备复核

结论：**准备范围 PASS**。spec、任务清单和合成可点击Demo可交用户整包确认；未发现剩余必须修复项。P05待用户确认，E01–E08全部仍待实施/验证。该结论不表示真实产品、持久化/原子权限、标准客户端、TLS/OAuth、GitHub供应商、模型、真实账号、WorkBuddy或MacBook已联通。

复核者：`brain_v03_preparation_review`，未参与候选创作，独立聚焦上下文。按AGENTS和engineering-workflow §4，先读spec/tasks/ui-demo、固定身份并独立写expectations.md，再读作者指南/映射/结果、实际浏览器与DOM/CSS；源代码、规格、测试与仓库证据全程只读。自身产物只写`.local/brain-v03-independent/`，没有领取、发布GitHub消息、产品修改、安装、服务切换或设备操作。

## 候选与适用性

初读时间2026-11-28T11:17:14Z，HEAD `452e9c5a2fd91f427df3cddec68124c9f0c492e6`，origin/main `74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`。完整staged/unstaged/新增文件及各文件字节/hash见input-manifest.json；不以HEAD替代未提交候选身份。

- spec SHA256 `56522ef4db656ed047864cd9cc897fec0544bb627dd5fcf8bf26af82a27d9375`。
- tasks 初读 SHA256 `081590164b9d4f7e3a8abac465e85eb5f4d1cb1f5e5b6c4a2ced93ce6beda8a1`，当时P04/P05未勾、E全未勾。完成复核后PM可仅更新P04和索引，需单独delta核定。
- Demo初读 `06804f28f668b2acceb9a22e65647ed2ea9b48dc708610a366f5bd9505630efe`；最终 `9a5626d5efe69f2d5a4c22ee234919a4abd07e4c190a0fb996a9449cd062fcb4`，仅choose-internal `if(state.auth)`→`if(ownAuth())`。静态反向还原摘要与初读一致，受影响跨Task路径独立重验，其余页面/样式/合同字节无改动，原证据限范围继续适用。

分支相对origin/main仅准备目录、已有README和讨论稿；相对452起点只有本轮准备目录，未见产品/测试/依赖/锁文件/CI差异。旧v0.2固定 `0ff60301fed16321b35f315f15329e415a178450` 存在，result-v0.2、preparation-review-v0.2、integration-research-v0.2与原提交对应正文逐字节相同。旧PASS不外推。

## 结果与发现

1. 全外部未配时六类原Task均可选择内部，保留草稿，未创建授权/读取/事件/API触发。纯GitHub在WB完全未配下模拟发布、有效领取、准确资产读取、交付、原Task核验/保存；默认1work/24h，WB触发额度与占用均0。WB默认禁用，API/Connector单项不足，显著模拟联合配置后可主动选择；其修订共占2/3次，没有跨revision重置。
2. 未领取拒读、发布UNKNOWN仅核原请求且重开仍UNKNOWN；busy/暂停后空闲不接受，恢复后接受；缺件/只链接不接受；补充旧FAIL保留；超范围先介入、保持原范围后恢复；身份变化/实例离线/授权过期阻读；取消迟到隔离、不复活授权。以上是合成UI行为，不是实际安全/原子性/恢复实现验证。
3. Case事项/页签/手选范围及原触发焦点准确返回，Task与各Case事项草稿独立；独立项目入口不猜来源；接受不清原待回应、不改原项目等待、不把ExternalDeliveryRef写Case正式依据。原Case/Task/native/目标权威合同未放宽。
4. 真实Chromium渲染、点击、键盘与截图检查覆盖15路由×1440/1024/390×亮暗，90组页面无document横溢；授权抽屉内容独立滚动，资源快照可达、Escape/Tab/焦点正常。实际查看代表原图：内部未配、WB授权、1024Task、390暗色Case/授权顶部及底部、失败manifest、桌面暗色delivery与跨Task内部图。读相关DOM/CSS（rail/双圆mark/Case事项区/主区、media断点、theme、dialog滚动/焦点），生产映射明确仍待实施。
5. **F01（复核发现，已关闭）**：integration-research旧文本将WB首个链路/未验证整体准入混在一起。作者原样保存v0.2研究，当前v0.3明确GH通用基础及独立门槛、WB-only gate，增加核心标准客户端路径，官方核查日期未伪更新。阅读全文重验一致。
6. **F02（作者主动发现，独立重验关闭）**：另一Task已有外派时，当前Task内部选择误拦。最终ownAuth判定允许另一Task内部，原auth/status/history/reads/API不变、另一Task草稿保留；同Task已有外派仍不提供静默内部切换。

## 证据和保留失败

- check.cjs/checks.json/run.log：初轮150项，149通过；唯一“准确来源焦点”在hashchange渲染前立即观测失败。supplement.cjs/supplement.json等待实际Case页面与目标焦点后通过，19项全通过，原失败不删。
- 首轮暗色授权截图在scenarioChanged重置主题后实际为亮色，文件名失真。原图保留，不作暗色证据；corrected-*明确先切真实主题并核data-theme，包含六种视口/主题的授权顶部和资源底部图。
- delta.cjs/delta.json：最终HTML增量10项全通过，单独验证跨Task保全及纯GitHub回归。delta-csp-failed原脚本用了eval，被CSP正确拒绝；未放宽CSP，改用直接只读状态。delta-locator-failed误定位已关闭dialog隐藏控件，6个目标增量断言已通过后脚本超时；改核同Task确实无可见切换控件再完成。均属复核脚本问题，原脚本/JSON/log保留，不称产品RED。
- static-check.py/static-checks.json：本地Markdown引用无缺失、原v0.2逐字节保全、产品范围无差异、核心spec/tasks未改及HTML唯一守卫差额、F01范围修订。初次关键词判定过窄和预期HTML变化检测记录亦保留。
- issue155-readback.json：只读GitHub连接器回读，Issue Open、owner gadfly-hbo、comments0，正文明确v0.3待确认/不领取。PM后续绑定预览完整SHA/摘要与更新索引是另一次收尾delta，不据旧正文声称已发布新预览。
- matrix.md逐项覆盖spec§1–12/AB01–18、tasks P01–05/E01–08及Demo全部页面/状态；结论区分准备通过、工程待验、用户确认待执行。

file协议本独立复核NOT_RUN；作者已保留环境管理员ERR_BLOCKED_BY_ADMINISTRATOR，HTTP4317实际浏览器可用。本轮不扩产品工程或真实外部测试，未运行npm完整检查/CI，纯准备适用检查与工程检查分别记录。没有真实产品可截图，本轮Demo截图不能登记为未来开PR前的真实产品截图确认。

四原则准备结论通过：Host只承诺权限/环境/记录/收件，Agent方法与专业判断自主；沿Interface v3/原owner/固定官方Pi1.4.0/MCP1.32.2，新增最小业务协议而非第二Runtime/资产库；正常内部无需外配，外派一次必要范围授权，其后不逐条读取审批；高级追溯按需。真实链路仍须E01–E07及将来非作者产品矩阵和截图确认，E08真实采用独立留证。
