# MacBook同步与真实全链路：记录

2026-10-31 · 部署和技术链路完成，非作者工程复核PASS_WITH_LIMITS，专业质量未通过。依据为[MB01–MB07](spec.md)。本轮没有修改产品源码、测试、依赖、权限或分析提示词，没有新增产品修复。

## 同步和两个按钮

SSH核对设备为用户`huangbo`的MacBook，产品目录`/Users/huangbo/Dev/OptraCall`。原为干净main `c00bd7dc9a8f954abc24d792b826b1e10a8ce74e`，构建同SHA、正式4173未运行，push禁用。正常入口`/bin/bash scripts/trial-command.sh update --no-open --json`完成安全快进、按锁文件安装、构建和启动，没有绕过更新检查、复制Mini凭据或接管其他进程。

实际采用main `8948f3b4e3d12e9ae53e80913118c7ee6b632d93`，tree `7cdeb8a51e1affb32fca3ccfff7b7d37c7376cf5`，重复启动复用同实例。其GitHub Check [41187340412 / attempt 1](https://github.com/gadfly-hbo/OptraCall/actions/runs/41187340412)为success；这是部署代码的CI，文档提交CI另记。updater输出目标SHA和启动身份，没有输出所选CI run ID；上述run由收尾单独查询复核，不冒称updater记录了它。

用户澄清的两个禁用现象均为现有前提条件，并通过实际UI验证：

| 入口 | 不满足前提时 | 满足前提后的实际操作 |
| --- | --- | --- |
| 指标体系 → 发起建模任务 | 无项目时禁用 | 在新合成项目中创建任务`a594cd49-1fe0-45a9-9e53-bfe95e8a3600`，有预填草稿、lastRun为null，没有自动发模型。 |
| 需求梳理 → 创建并进入工作台 | 标题为空时禁用 | 输入标题后创建`req-7634625af71b`，原生模型会话文件0。 |

因此不将条件误解记为已复现产品bug，不制造代码修复。正式页面的分析资产、指标体系、企业业务资料、业务插件、需求梳理、Case及看板均能打开；真实入口正常显示，规划卡片灰色并标明未接入。普通SSH PATH无node/gh，但产品专用Node25.9.0存在，正常更新成功，不认定为缺失运行时故障。

## Book真实模型链路

本轮新根：`/Users/huangbo/OptraCallEvaluation/macbook-live-flow-20261031-2e50c47a-35bb-4845-8a2e-0350704214d7`。Host4197使用Book安装的同一源码/静态构建，独立dataRoot和projectsRoot，不向正式用户项目写测试数据。浏览器为Mini IAB通过同端口SSH访问；模型、SDK、工具、Python和文件保存均在Book，不是Book物理Safari/Chrome验收。

采用Book原选中MiniMax M3.1 Flash revision3、官方`minimax-cn` / `anthropic-messages` / `https://api.minimaxi.com/anthropic`，SDK1.4.0、transport8.12.2。实际SDK注册零请求核对reasoning=true、thinking=high、contextWindow=1,000,000、maxTokens=524,288、forceAdaptiveThinking=true；不拿Mini revision5代替。隔离配置经正常保存入口写合成密钥，实例内存只替换为Book本机实际密钥，未复制Mini密钥或持久化真实密钥。本轮不证明凭据重新导入/保存流程。未设模型预算上限，未更换模型或自动重发整个失败任务；供应商实际结算费用未核对。

| 阶段 | 实际结果与限制 |
| --- | --- |
| 资料/背景 | 上传固定合成CSV/字典/Case事前例外；创建企业公共资料并钉住修订；Case关联公共资料及本案补充。没有把工程答案、旧稿或评分放入Agent根。 |
| 需求 | `req-438d0fdbc96a`真实生成elicit和framework；操作者逐项审核事实、重复澄清、未知和业务范围，保留生成原稿及人工编辑，不提供计算答案。有限格式修正次数均0。 |
| RAP/SAP | RAP正常confirm/publish至1.0.0。SAP为外部手工草稿，经正常validate/publish/enable；不是YAML上传或模型自动生成。方法由执行Agent选择。 |
| 分析 | 项目`9be4f1d6-cea9-47f3-b0ab-3a9ca24568c6`、任务`f7facfd3-ca86-455c-9b19-79ac824aa250`，首请求completed。Agent自行读取企业正文、SAP、RAP、Case与数据，编写执行计算并保存完整报告。KeyError、edit未匹配、精度断言及片段NameError等过程失败保留，不等于最终请求中断。 |
| 独立核算 | `2c48a052-188c-4309-b0fc-a13fa729715f`，先固定资料独立计算保存冷稿，再揭示本轮作者稿对照。冷稿保存09:49:13.544Z，作者揭示09:49:13.586Z。捕获活动未见提前读目标产物，不能推成硬隔离或完整访问证明。 |
| 看板抽取 | 完整单报告抽取11条，source bytes/SHA保持，保存的26条引文全部为报告子串，抽取执行工具0。原始27条有1条非逐字引文被保存层去除，原始引用评估PARTIAL；引文忠实不代表建议正确。 |
| 人工决策演练 | 只采用“补充South试点成功/观察期/延续退出标准”这一有独立依据的建议；纯模拟任务走todo→doing→done、回录反馈。明确无经营动作、指标变化UNKNOWN、3分仅为演练值。拒绝含未核实新增资料权限断言的North组合建议；其余9条待判断，不整稿采用到Case。 |
| 回读 | 浏览器刷新和测试Host同根重启后保存指纹完全相同：`531066b3da422e4b29d424672fcb4eb3e35829b0f13992e6fc0bef3f55b6fa33`。RAP/SAP、企业资料、Case、任务历史、作者报告、看板状态和反馈可回读，重启未发模型。宽屏/390px窄屏及来源回执UI检查完成，最终console warn/error为空。 |

作者实际报告`060_reports/hechuan_month_review_2026-06_SAP0.2.md`，31254 bytes，SHA256 `0098b5cfe41a681a6f737855285329950ee7e5161018f6dcb1a16430b4b58d07`。过程产物9件保留在项目`020_clean/process/`。Host没有补算、编辑计算答案或强制方法；专业复算在Mini离线工程侧进行，完整评分答案未回传产品。只将无答案的FAIL摘要交工程helper记录。

## 专业质量

作者全文非作者评估 **FAIL**：核心数值28/28通过，语义槽12/15通过，仍有5项问题，不能由自报“46项PASS”抵消：

1. North已低于20%，正文却说收入再少375/成本再多300才跌破，方向与回线表相反。
2. 两月订单数相同不能排除订单/商品结构变化。
3. South严格低于12%的触发条件混用舍入值和等线值：按分精度收入至少下降261.37或成本至少增加230.01才触发，不能把261或230等同触发。
4. 引用计算产物把企业两月已结算退款1000重复加区域及合计成2000；主体表未因此出错。
5. 不能从现有订单总额数据保证取得单价/品类/退款原因等明细“不需新增数据权限”；提请复核合理，权限断言待证。

冷稿离线评分28/28数值、15/15语义PASS；对照稿28/28数值、11/15语义，全文FAIL。作者正文可核4项中：检出North方向和订单mix问题2项（mix被弱化为措辞），漏掉South严格边界及具体资料权限断言2项。作者错误小计所在过程文件未提供给产品核算，其明确不可核，列NOT_ASSESSABLE/UNKNOWN，不虚报为漏报。

对照稿新增问题保留：详细稿分节检查数加总186却写216，实际CSV216行仅192个不同标签；同额退款/活动被分别列第3/4而非并列；推荐合并South敏感度时仍采信错误严格边界。核心业务金额和替代分解仍正确，没有确认“作者原本正确却被判数值错”的实质误报；编辑建议不凑作实质检出。看板保存后引用忠实PASS、原始引用PARTIAL，权限及mix两项原稿错误仍被传播，专业可采用性PARTIAL。不能把completed或“216/216”自报当正确。

旧Mini试验和错误稿原封保留，本轮没有改稿再跑到通过，不宣称全部问题已解决或完整产品验收。

## 保全、收尾与证据

正式Book原有项目0、Case0、模型配置5。原8文件（配置/凭据/Case存储和历史日志）前后bytes/SHA/mode全同；真实文件散列仅存Book受限基线，对外结果仅布尔。关停测试Host后扫描owned根306文件，真实密钥匹配0，settings/auth/选中身份未变。新增正式运行日志和空业务存储不冒称原目录完全零变化。

测试Host4197、临时浏览器、SSH转发与REPL已关闭。正式4173保持运行：PID22954、instance `06f50d07-54ef-4c24-8bd8-304b0939f6a7`、main8948、dirty=false、health ready；没有切换Mini运行服务。未清理测试原件、旧失败、项目、会话或文件。

Mini持久证据根`.local/macbook-sync-live-20261031/`：

- `update-first.log`、`installed-main-ci.json`、`post-update-probe.json`、`preservation-final.json`：同步/CI/最后保全；`host-closed-final.json`：关停和密钥匹配审计。
- `ui-entry-real-operations-corrected.json`、`ui-modeling-entry-observed.json`及UI文本/宽窄截图：实际按钮和回读。原摘要误读嵌套响应漏写需求ID，保留原件并以corrected纠正，不算产品故障。
- `downloads/898918c1-6249-4898-bab9-8e2d848702c7/`：核算/抽取终态183件；`downloads/d7068840-3546-4c6a-a007-5ff3d3c105b1/`：反馈和重启后236件。两包whole SHA及逐文件size/SHA验证，不执行下载作者脚本；仅白名单稳定文件，不是OS原子快照、整根备份或热SQLite备份。
- `reviews/quality-author.md`、后续核算/看板独立报告及Mini-only `evaluator-only/results/`：独立复算、全文问题和固定评分。原生会话、完整答案和原始日志不进Git。
- `harness/`、`transfer-tools/`：冻结helper与安全传输器；纯准备检查27、评分self-check18、packer联验15、解包检查30通过，只证明helper相应行为，不冒充产品全量检查。

测试设置失败保留：最初44273→4173转发触发host_rejected，改同端口恢复，未放松安全检查；一次未等scp完成即校验得到SHA不符，传输完成后同一原SHA通过；收尾API探针遗漏`x-optracall-client: 1`得到403，补正常标记后成功。均非产品RED。

非作者工程报告为`reviews/engineering/independent-review.md`：独立重算两包所有成员size/SHA、核对固定输入、保存core、原生活动与UI，限定工程交付PASS_WITH_LIMITS；未替代专业评分或用户验收。文档交付只含本目录2个MD，本地差异/引用/范围检查通过；实际head CI和Git合并由本PR检查及`.local/macbook-sync-live-20261031/delivery-receipt.json`最终记录，不预写成功。纯文档提交后不重复切换Book已验证的8948服务。
