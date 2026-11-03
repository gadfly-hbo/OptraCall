# 天气连接器接缝与出境结构决定

2026-11-03。依据用户明确接管/实施指令、已确认D8/D12及四场景Demo。传输层强制设计由用户交给Codex；以下为该范围内实现决定，不虚构逐字段确认。原14项移交清单全部SHA匹配，基线351d835、HEADd042110，原清单及移交包保持历史原件；Git/CI、真实API冒烟、模型与设备仍分别授权。

| 项 | 决定与理由 | 兼容、生命周期与验收 |
| --- | --- | --- |
| S1 任务能力 | schema2新增可选 `weatherTools?: boolean`，缺省/false关闭，与simulationTools/tradeAreaTools各自独立；既有固定能力清单/API复用，不新增集合/owner/profile/域/会话ID。 | 旧元数据读取不补写；空闲变更沿同一公共close成功后才保存，忙碌/归档/失败不扩大能力。agentOptions只传Host构造cacheRoot，IPC不传函数/凭据。 |
| S2 MCP接缝 | 使用既有SDK1.4.0双参数registerMcpServer；固定weather-mcp namespace、hidden+仅weather_history direct。商圈/天气共用目录摘要逻辑，各自资源内摘要/冻结状态独立，reload/改回不解冻。 | 复用同一个sdk.ts loader例外，过滤两个产品保留namespace，不增加私有SDK导入面或allowlist。受管ordinary/protected、fixed-draft/text-only继续不注入；其它用户MCP及普通工具保留。摘要仅观察已刷新的SDK适配目录，不是raw/原子RPC pin。 |
| S3 Host强制出境 | SDK stdio启动可信Host传输入口P；P仅转接MCP字节与受限天气HTTP请求，不import连接器。唯一执行worker Q经macOS Seatbelt deny-default（无网络/无fork）及Node权限运行，使用继承fd3的有限请求/取消协议，不能直接net/tls/http/fetch/UDP/Unix/DNS。 | Pi仍为会话/进程组唯一收尾权威，Q不detached/不setsid，留原SDK组；不创建产品监听端口、独立服务、另一Agent/Runtime或guardian。P的在途HTTP Map仅为传输请求资源，非会话运行状态。stop传播取消并保留可复用server，close/reload沿SDK释放P/Q；实际退出须测。 |
| S3a Host网络策略 | P独立精确核HTTPS、固定archive-api.open-meteo.com:443/v1/archive、无URL凭据/片段、六个唯一参数、有限坐标/真实历史日期/≤366天/两字段枚举/Asia/Shanghai；固定GET，无任意headers/body/proxy或CONNECT。 | HTTPS不跟随重定向、不重试；Host仅解析固定域，核准公开IPv4并把同一地址固定用于本次连接，保留原域SNI/证书验证；v1不回退IPv6或私网地址。校验发生在DNS/连接前，限制帧/并发/响应字节与超时；迟到结果不重放。生产入口没有env修改上游/白名单的测试开关。 |
| S3b 支持边界 | 当前产品设备为Mac mini/MacBook。仅darwin且Seatbelt可用才启动天气执行；不支持平台fail-closed，不退回无OS网络隔离的普通Node。 | 本机实际Seatbelt和SDK路径单列验收；Linux CI测纯Host策略、Node权限/fd协议及明确unsupported分支，不以SKIP冒充全平台OS隔离。Node权限只是可信代码误用防护，不能单独声称恶意代码安全沙箱。 |
| S4 出境说明 | 不增加持久同意表或ACK字段。新建/会话两入口从关闭勾选天气时显示一次内联说明卡，不弹窗、不阻断、不逐调用确认；关闭再开启属于新一次启用。 | 说明仅发送坐标、日期、字段与固定时区，不发送项目正文/档案；查询结果进入所选模型上下文。免费服务仅非商业，许可/使用条款给官方链接，不将其标为无限制免费或商业已授权。 |
| S5 缓存与未知 | 继续同一cacheRoot/72小时和原CacheEntry形状，缓存是性能层。参数、覆盖、取消、错误及损坏行为的发现直接修复并留因果回归，不为缓存建立第二证据权威。 | 不改历史记录/默认模型/商圈数据；坏缓存当未命中、并发写唯一临时文件；已取消/超时及迟到响应不保存成功缓存、不自动重试。原Qoder检查范围及夹具失败保留，新增修正另记。 |

Host/Agent职责：Host仅管理启用、权限、路径、网络资源和记录；Agent自主选择何时查询、变量与分析。确定性天气覆盖核对留连接器，Host不计算业务结论或编排分析步骤。

实际能力缺口证据：Node25.9 `--allow-net=host:port`实测仍全局放行；无allow-net及Seatbelt均可阻断直接网络，已继承fd3可双向通信；Pi实际stdio使用同进程组收尾。工程探针位于仓外 `/Users/bendandebaba/OptraCall-artifacts/weather-transport-notes-kxLfeL/`，不是非作者最终复核。官方依据：[Node权限](https://nodejs.org/download/release/v25.9.0/docs/api/permissions.html)、[Open-Meteo Archive](https://open-meteo.com/en/docs/historical-weather-api)、[条款](https://open-meteo.com/en/terms)。这一步只读取文档，没有真实天气查询或该API域DNS请求。
