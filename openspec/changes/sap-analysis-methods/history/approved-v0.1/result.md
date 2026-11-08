# SAP 分析方法／IR：准备结果

2026-11-04 · v0.1 · **spec／UI准备完成，限准备范围检查及非作者复核通过，待用户整体审核；产品未开发。**

## 固定依据与范围

- 用户已确认[产品讨论稿v1.2](../../../docs/OptraCall_Analysis_IR_产品讨论稿_v1.2.md)，SHA-256 `12e5be381afdb5c5d6c7cb506259fb907df6bf852d4dfa150c83055c5899dd96`；先保存后发布、发布后才参考的规则是当前依据。
- 分支 `codex/sap-ir`，准备起点HEAD `57742b99d173bfa6413e83705682b0444359add4`，tree `462a29b31a7a7a4159b87e4a1b243ddb3a84104b`。原工作区已有讨论稿未提交文件，保留其字节。
- 当前只读核查、spec／结构建议、虚构单文件内存Demo和准备检查；不实施产品、持久结构、依赖或测试，不调用真实Provider／业务材料，不切服务／MacBook，不做Git提交推送／CI。
- 开工前只读回执：`.local/sap-analysis-methods/preparation/input-manifest.json`。本轮输出以[spec](spec.md)、[D01–D08](structure-decisions.md)、[审核摘要](review-summary.html)、[复用核查](reuse-evidence.md)、[UI审阅路径](ui-review.md)及[Demo](../../../docs/prototypes/sap-analysis-methods-ui-demo.html)为准。
- 最终Demo SHA-256：`01d608ae25d6a15787e3a3cbd162bea114c8e3d4ca889cd018108be99ccb2a78`。原业务主路径检查后，新增三项独立发现分别定向修正／重验，不沿用失效的旧候选声明。

## 现状与差额

当前SAP有不可覆盖的正式指标包发布、项目固定启用和全局已发布准确读取；尚无完整方法资产及后置提取链路。原普通记忆可按自身治理查读，不能被方法发布规则一并改成必须发布。现有text-only／fixed-draft无工具或有全文限制，不能宣称完整长Session提炼已经具备。详细实码位置见[复用核查](reuse-evidence.md)。

本次候选将两类方法共用SAP管理／发布、准确版本、来源、纠错与附属提炼profile作为最小待审建议，不将未批准的技术结构或原型fixture写成产品已实现能力。

## 检查与复核

| 项目 | 当前结果 | 证据／限制 |
| --- | --- | --- |
| 产品稿原件与基线保留 | 通过准备范围回读 | 产品稿hash、HEAD／tree、原附件字节保持，tracked diff和暂存区均无变化 |
| 图索引与只读能力核查 | 完成 | [实码证据](reuse-evidence.md)；project `optracall-sap-ir-preparation-20261104`，非产品运行 |
| 文档／引用／范围检查 | 通过准备候选 | 7份新增准备文件的本地Markdown引用、行号边界及表格结构；无缺链接或尾随空格，原产品稿hash保持，见本地static-check.json |
| 单文件原型／语法／浏览器 | 已通过作者语法与root浏览器核对 | Playwright独立测试浏览器；保存／发布／旧版／两类来源、失败、来源、键盘、390px及亮暗；非真实保存 |
| 非作者独立复核 | 限准备范围通过，F1–F3已独立重验关闭 | 初轮范围／维护归属补充已加入spec§4.3；[独立报告](../../../.local/sap-analysis-methods/review/final-review.md)，另有独立浏览器8项定向结果 |
| 四原则专项准备复核 | 限准备范围通过 | [spec§2、5](spec.md)、[实码核查§5](reuse-evidence.md)及非作者独立报告；非运行期合规结论 |
| 产品TDD／全量回归／真实SDK保存重开 | 未运行 | 当前无产品实现，不制造RED |
| 真实模型／专业效果／用户产品验收 | 未运行／未验收 | 预置Demo文本不证明提炼质量 |
| Git／CI／安装／运行采用 | 未执行 | 本轮只交审核材料 |

### 浏览器证据与发现保留

内置CUA浏览器因Work设置禁用未能打开，未修改设置。使用已安装Playwright技能的独立浏览器，仅访问本机静态原型。技能脚本直接执行受限，改用bash读取同一脚本；未改产品依赖。

root核心脚本首轮把HTML搜索框误定位为textbox，定位超时；修正检查脚本为searchbox后通过，未为此改原型。失败及原因保留于 `.local/sap-analysis-methods/preparation/check-history.md`。实际执行脚本为同目录 `browser-core.js`、`browser-scenarios.js` 和 `browser-findings-recheck.js`，均仅操作合成页面状态。浏览器控制台当前0错误／0警告。

验证按实际候选分开：核心24项在`8c25a3cc…`通过；情境／可访问性16项在F1修正后的`e42958e6…`通过；F2／F3修正后的最终`01d608ae…`另以8项定向核对准确旧版入口、发布前后正文不变／无过期状态、旧错误及键盘入口。改动仅影响这些范围，未将早先截图或失效的旧版本结论冒充最终完整产品验收。

| 发现 | 原问题 | 修正及复验范围 |
| --- | --- | --- |
| F1 | “跳到主要内容”键盘聚焦仍被裁成1px | 仅补focus可见CSS；root实际Tab检查显示尺寸／clip，并Enter进入main |
| F2 | 门店及纠正版fixture把“尚未发布”写进方法局限，发布后与动态状态相反 | 方法正文改为真实业务局限，note明确保存时历史；root发布两类方法，确认正文不被发布改写且无过期状态 |
| F3 | 声明采用v1的分析／完整复用入口误打开最新v2草稿 | 两个准确入口传固定版次；root先保存v2草稿，再分别点击旧引用，确认仍进入已发布v1；列表仍可默认最新 |

浏览器截图位于 `.local/sap-analysis-methods/preparation/output/playwright/`，覆盖桌面分析／方法库及亮暗、390px分析／方法库。部分在单次调用中改变视口后立即截取的fullPage图片尾部合成重复，另用稳定视口截图及DOM核对页面仅一个导航、无文档横向溢出；不以该图片异常声称产品DOM重复。原截图保持，稳定截图另存。

所有结果只证明合成原型和准备材料。未模拟真实CAS、来源权限变化和未知副作用的产品行为，也未运行真实SDK／工具／Store／长来源读取；这些继续是SAM10–SAM14的实施验收范围。

## 审核与后续

产品方向已确认，本spec／D01–D08及UI仍待用户整体审核。当前不据准备检查或审阅材料生成启动产品开发。后续如获实施授权，按spec从保存／发布边界及兼容切片开始真实RED-TDD，再验证附属会话、来源权限、真实隔离SDK／工具／保存重开、UI和全新非作者复核；原件、FAIL／UNKNOWN保留。
