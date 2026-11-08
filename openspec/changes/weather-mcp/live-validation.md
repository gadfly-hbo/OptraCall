# 商圈与天气连接器 · 有限真实模型验证

2026-11-03。用户在PR #29合并确认时另行授权：先完成OpenSpec归档，再真实模型测试，最后更新MacBook。工程合并、模型执行、内容质量和设备采用分别记录。**两轮真实工具／报告闭环完成；两份报告仍有数值或错误归因问题，内容验收FAIL，不宣称专业通过或用户产品验收。**

## 固定版本、环境与预期

- 功能合并 `722af86fd2bf5a9972bbbc6dc537e4c0bd79941b`；原位归档 `6af3ed7d3343d99c8078fb47a12043adf18e641d`，后者实际main push [Check #83](https://github.com/gadfly-hbo/OptraCall/actions/runs/41647428317)成功后才发送模型。两提交间仅AGENTS/spec/result三份文档；模型运行的产品代码与已验PR一致。
- 隔离普通项目任务，商圈和天气两个能力开启，经营推演及自动核算关闭。正常`createHost`、配置保存／选择、项目／任务／消息API、Pi SDK 1.4.0及生产MCP stdio路径；没有直调模型、替换Runtime、mock Provider、改写配置快照方法或Host补计算。
- 既有批准配置 `minimax-m31-flash` revision 5，模型 `MiniMax-M3.1-Flash`，provider `minimax-cn`，协议`anthropic-messages`，线路`https://api.minimaxi.com/anthropic`，有效thinking high。新隔离配置revision 1，SDK运行provider `optracall-minimax-m31-flash-1`；原配置／凭据前后字节一致，新隔离根0700、auth0600。未换模型或增加fallback。
- 商圈为本仓两个合成样例，快照digest `4875f00ad434d88a6c60c01dc999bb941e7a9d524697de37747d5ba5a7ba829e`，sourceHead `synthetic-only`；未将正式经营数据送入模型。天气为先前获授权单次实取的湖州2025-10整月缓存，原SHA `f364106990add7b643df26618ed605bd23a43af2d9189f768c6c5569fccf4277`，fetchedAt `2026-11-03T13:05:22.580Z`，没有改时间冒充新数据。
- 非作者先冻结输入全SHA与独立预期，再看模型输出；预期不送给模型。两商圈四因子分别全60／80，故合法非零权重评分恒60／80；该夹具**不能验证权重敏感性**。天气独立oracle：31日、月内日均温平均21.393548°C、总降水29.4mm、正降水日15天。湖州仅为共同外部情景，不冒称两合成商圈位于湖州或证明经营因果。

## 实际两轮与保存回读

| 对象 | 实际结果 |
| --- | --- |
| 普通任务／会话 | 同一task，原生session `01a1a1af-f18d-7740-b7be-477aaab93102`；两个不同用户request，均completed，无人工自动重发 |
| 首轮 | 13:53:44.171–13:56:12.709 UTC；25次工具调用／25结果，实际包含商圈搜索、档案、评分及weather_history。17条模型HTTP记录均200完成 |
| 第二轮 | 13:57:00.447–14:00:05.075 UTC；新增24次工具调用／24结果，停车权重份额20%→65%，评分仍60／80。15条新增模型HTTP记录均200完成；复用前轮天气 |
| 天气 | 唯一weather_history调用固定lat30.8671／lon120.1023、2025-10-01..31、日均温／降水、Asia/Shanghai；命中原缓存，31/31齐全。缓存文件前后SHA不变；未观察到新增天气请求，不把模型HTTP记录当作天气API调用或供应商费用结算 |
| v1 | `060_reports/商圈天气联合验收-v1.md`，18558字节，SHA `baa2dba7bfb9fc50f19869823d9f7320644a1d5284b4645985f8f148152ddf52` |
| v2 | `060_reports/商圈天气联合验收-v2.md`，19310字节，SHA `04acc8f08965ef8fdf13a02e025b5749e39d6213799dabdfdf959bf92eae5b7b`；第二轮未改v1字节 |
| 文件闭环 | Agent正常文件工具写入及打开；Host独立磁盘／产品files/content API读回，两稿均200且逐字节一致。产品界面可见两个报告文件，独立核证据不冒称亲自操作界面 |
| 关闭与恢复 | 正常Host.close后重开，显式正常task/open恢复同原生session，只读两稿；原生331668字节与第二轮末完全一致，工具／模型HTTP零增量。再正常关闭，原settings/auth字节保全，针对本隔离源／Host的node进程匹配为空。本次未在关闭前捕获P/Q PID，不能挪用旧生命周期探针冒充本次PID观察 |

两次用户发送不等于两次模型请求；模型为工具执行自行多轮续接。累计49次工具调用、32条模型HTTP记录，SSE中auto_retry／summarization_retry事件0；SDK默认设置没有为测试改写。

本次没有另加“cache miss即禁止所有天气出境”的测试护栏，也没有包级网络／DNS观测；该护栏要求记为NOT_PROVED。实际唯一天气调用的hit与固定字节有证据，不扩大成抓包级零DNS、零HTTP或费用结算证明。生产的白名单与OS隔离验收仍由原工程测试证明，不能拿两者互相替代。

## 失败与内容质量

全部首次失败、工具实参／回执和报告保留，不因最终run completed抹去：首轮两个MCP invalid_param（四权重未完整给出；pop3km错嵌套在parking内）及一次edit文本不匹配；第二轮未知筛选指标parkingPer10k及一次Python NameError。共5个工具失败，由Agent在同一次用户请求内自行处理，Host未替其改参、补算或重发。

内容不能判为专业通过：首稿将“前半月−后半月”的温差写成负数，并把分段降水合计置于“均值”表述；错误嵌套筛选实参被误记成合法并列条件，进而错误归因为parking筛选不支持。第二稿虽证实parking单指标可用，仍把两次不同实参说成相同请求的“间歇性误报”，不是已证实的工具缺陷；也未完整关闭首稿数值／表述问题，并混淆停车总量相等与标准化分位不同。末轮聊天另把经度120.1023抄成120.2023，实际工具与落盘报告仍为固定正确坐标，未据此追加天气请求。完整非作者发现与范围见独立原件及本地交付回执。

首轮模型还曾把8组权重都写成工具实调，随后在同一首轮自行改为4组实调／4组本机复算；该过程保留在原生write/edit记录。首稿最终交付字节另封存；从初次write请求重建的内容只标为“工具请求正文”，不冒称当时另有独立磁盘快照。没有用oracle纠错第三轮或Host改稿把两稿追认为PASS。

功能与内容分别判定：正常产品→真实模型→两个MCP→文件保存／回读／恢复已有有限通过证据；报告内容FAIL，不能用于真实经营决策，也不提升为广泛分析可靠性、天气因果或用户本人产品验收。原simlab／target-forecast等历史专业FAIL／PARTIAL不因本次测试改变。

## 设备采用与证据

模型阶段已结束；MacBook随后按用户授权，通过既有main试用更新入口核对实际main push CI、安全快进、锁文件安装、构建与启动，不开展开发或该机模型实验。预检发现其尚无商圈数据；采用范围包括Mini已批准同一2835条v2不可变快照（digest `6bbaa68cf255b8213d5641ce49de681e3cd2b227584eb3c58ff62b2e76e0fffd`），只在不存在的新连接器根落位，保留原来源仓WIP。60文件／21758644字节白名单、stage核SHA／权限后独占原子改名；不导入新来源版本、不回推、不覆盖本机项目／配置／会话。

本记录在设备执行前写入，不能预写设备成功。最终main提交自身CI、MacBook实际loaded runtime／源码／构建、正式快照版本、保全差异与失败由Git/Actions、设备回读和仓外`weather-model-delivery-20261103/`最终收据核定，避免为记录自身未来SHA无限追加文档提交。Mac mini原运行服务未切换。

私有原始模型／合成项目／SSE／报告与harness位于`weather-real-model-plan-w2hhfP/`；独立冻结预期与结果在`weather-model-independent-m65io6v0/`，职责／路径复核在`weather-model-review-standards-20261103-tnCGmq/`，设备保全／复制清单在`weather-live-macbook-preflight-20261103T133744Z-2e69878e/`，均位于本机`/Users/bendandebaba/OptraCall-artifacts/`仓外。公开仓只保留脱敏摘要，真实经营快照、凭据和原始模型记录未提交。
