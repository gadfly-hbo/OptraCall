# 天气 MCP 连接器 · 实施与验证记录

2026-11-03 · 分支 `qoder/weather-mcp`（基于合并后 main `351d835`）· 状态：Codex 接缝、修复、本地完整检查和非作者独立复核均完成；真实 API、Git/CI、模型及设备未授权未执行。下列 Qoder 记录保留接管前原范围，当前增量见文末。

## 授权与流程

- 商圈连接器经 PR #27 squash `2c56dd2` 合并 main＋归档 `351d835` 后，用户指示"核对后，开发天气 mcp"。核对：squash 单父 `7109a6e`、树 `ea140d4` 与 Codex 记录一致；本地 main 已快进；原 Qoder 工作树已按移交模式游离。
- TDD：`tests/weather-mcp.test.ts` 先行（RED：模块缺失）→ 实现 GREEN。过程修正：①`service.history` 最初为同步函数但内部调用异步适配器（未 await），改为 async 并让 MCP handler await；②stale 夹具直写缓存请求缺 `fields`（夹具缺陷）；③缺必需顶级键的实际行为是 SDK 协议级拒绝（isError 结果文本 `MCP error -32602`），按实测行为断言并注明标准 §3 口径；④3 处 tsc 严格类型修正。无跳过断言、无放宽检查。

## 实施范围（实际交付物）

```
extensions/connectors/weather-mcp/
├── connector.json   # 标准清单 v1：kind=remote-api、stdio transport、egress=[archive-api.open-meteo.com]、credentials=none、1 工具
├── types.ts         # 字段/请求/覆盖类型、错误信封类、10 城内置坐标、时区与跨度常量
├── coverage.ts      # 期望日期键核对：缺失/重复/null 值如实报告
├── open-meteo.ts    # 适配器：URL 白名单域自限自检、失败分类（429+Retry-After/400/401/403/5xx/超时/网络/取消）、不自动重试
├── cache.ts         # 请求指纹内容寻址缓存：原子写入、TTL 72h、过期不冒充新数据
├── service.ts       # 参数校验（城市/坐标二选一、日期格式/顺序/跨度/非未来、字段白名单）→ 缓存 → 获取 → 覆盖核对 → 回写
├── server.ts        # McpServer + weather_history（looseObject 保留未知键+实现精确拒绝；readOnlyHint；信封错误）
├── main.ts          # stdio 入口（WEATHER_CACHE_ROOT / --cache-root，缺失明确退出）
└── README.md
tests/weather-mcp.test.ts   # 10 项测试（合成 HTTP 夹具，零真实网络）
```

零新增依赖（复用标准 v1 的 `@modelcontextprotocol/sdk@1.32.2`、`zod@4.6.7`；package.json/lock 无变化）。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `node --test tests/weather-mcp.test.ts` | **10/10 PASS**：覆盖核对（complete/partial/missing/duplicate/null）、缓存指纹稳定性与字段区分、TTL 过期与新鲜判定、适配器 URL 白名单自检与解析、失败分类（429+Retry-After 37s/quota 语义/400 带上游原因/503/20ms 超时）、服务参数信封（未知城市列出内置清单、city 与坐标冲突、单坐标、越界、日期格式/倒序/2030 未来/超 366 天/未知字段）、缓存命中零网络（fetchNever 哨兵）、过期重取不冒充、部分覆盖＋null 值不填零、MCP 协议往返（单工具/只读标注/额外键信封拒绝/缺必需键协议级拒绝）、stdio 预热缓存冒烟 |
| `npm run check` | **exit 0**：943 项、940 PASS、0 FAIL、3 条件 SKIP（商圈合并基线 933＋天气 10）；边界检查/tsc/构建通过；日志 `/tmp/weather-check.log`（Trial build `351d835+local-changes`） |
| 真实网络 | **0 次调用**——全部合成 HTTP 夹具；真实 API 冒烟属外部副作用，按规格未决项另行授权后执行 |

## Qoder 移交时验收映射（历史范围）

| 标识 | 状态 | 说明 |
| --- | --- | --- |
| WX02 | PASS | 期望键核对/缺失清单/空区间语义（单测）；无填零/插值 |
| WX03 | PASS | 限流/超时/无效参数/坐标越界分类；不自动重试（单测；取消传播经 signal 接线，产品路径随接缝验） |
| WX04 | PASS | 缓存命中标注时效；过期重取不冒充；缓存数据不外发（无网络路径） |
| WX05 | 部分 | 连接器侧 URL 白名单域自限＋自检＋清单声明；Host 传输层强制待接缝（Codex） |
| WX08 | PASS | 目录/清单/工具合同与标准 v1 一致（含 source_unavailable 扩展码 README 记录） |
| WX09 | 部分 | `npm run check` 全量通过；产品链路回归随接缝 |
| WX01 | 待接缝 | 适配器层已按合成夹具验证；产品任务会话端到端与真实 API 实测待接缝/授权 |
| WX06 | 待接缝 | 默认关闭/任务级开启/受管不注入依赖 Host 接线 |
| WX07 | 待接缝 | 浏览器点验目录第二个条目（Codex） |

## Qoder 移交时缺口（历史原记录）

- Host 接缝归 Codex 未实施：`TASK_CAPABILITIES` 增加天气条目、`registerMcpServer('weather-mcp', …)` 注册＋目录指纹冻结复用、能力目录条目＋导航、新建任务/会话内开启交互（UI Demo 已确认形态，含 D12 一次性出境说明卡）、`<dataRoot>/connectors/weather/` 分配、**首个 remote-api 的出境白名单传输层强制**（新机制，需 Codex 设计）。
- 真实 Open-Meteo 请求 0 次：参数格式与真实响应结构未经真实 API 核对（规格"实施核对为准"项仍开放）；授权后建议单次冒烟（湖州 2025-10 全月）并记录限流/延迟实测。
- 时区固定 Asia/Shanghai、城市表 10 城、TTL 72h、跨度 366 天、end<今天 为 v1 实施决定，已在规格与 README 记录，可随后续变更调整。


## Codex 接管、修复与本地验收（2026-11-03）

### 候选身份与授权

原14/14文件逐项 SHA-256 前16位一致后才改动。原 `candidate-manifest.txt` SHA256 `0582c9d2ff482aef6afc2d97139cb4ffef7425083f11360ba7cf185d9d7b6641`；基线 `351d835b65db8c72a41f8d07961e6fac3c05f2c9`，交接HEAD `d042110655e1b9de576a4541b2ad01fef589f1e2`。原清单和移交包不回写；Qoder 原工作树核清洁后游离释放分支，Codex 在独立 `weather-delivery/OptraCall` 工作树单一写入。用户只授权本地接缝/强制出境设计与修复、适用测试及非作者复核；天气的真实 API/Git/合并、真实模型及 MacBook 仍分别待授权。没有沿用商圈的合并授权，没有切换运行服务。

证据根 `/Users/bendandebaba/OptraCall-artifacts/weather-handoff-20261103/`（0700），固定候选收据/checkout所有权、各RED/GREEN日志、浏览器证据均仓外保存；公开仓无经营数据或凭据。工程辅助 `weather-transport-notes-kxLfeL/` 的作者探针与最终非作者复核分开。

### 接缝及结构决定

- [结构决定 S1–S5](structure-decisions.md) 在实现前记录：schema2只增可选 `weatherTools`，旧数据不补写，能力独立；Interface v3、project-tasks域/owner/profile不变，agentOptions只增Host构造的cacheRoot。
- 同一公共会话生命周期先close再持久化空闲开关；SDK1.4.0注册单weather_history direct，server默认hidden。两个连接器共用目录摘要算法、分别持续冻结。保留namespace过滤复用商圈IN06同一个薄层loader例外；`sdk.ts`/边界例外清单无新增导入面。
- 可信Host P只转接MCP与固定天气HTTP，连接器仅在无直接网络/子进程能力的Q执行；继承fd3有界协议、固定域/路径/六参数/GET、公开IPv4解析固定与原域TLS证书校验、禁重定向/重试。仅Seatbelt可用的macOS启用，其它平台fail-closed，Node权限不单独充当恶意代码沙箱。SDK仍管理原进程组，P/Q不另起Runtime或产品端口。
- 能力目录第二条目和项目导航、创建/会话两入口开关、D12启用手势内联说明卡完成；无弹窗/阻断/逐调用确认/持久同意结构。许可/出境/结果进入所选模型上下文如实说明。[标准v1](../../../docs/mcp-connector-integration.md) §5补首个remote-api事实；standalone main仅适配器自限，不冒充Host强制。

### 发现与修复（保留失败）

| 发现 | 修复与因果回归 |
| --- | --- |
| API创建未传天气可选标志、task metadata未持久化 | 复用固定能力清单及可选bool；`host-capability-red/green`、`task-capability-red/green`；旧schema2字节不变、能力互不覆盖 |
| JSON合法但结构损坏的缓存可抛TypeError，日期无效可抛RangeError；跨度原比较少算首尾一天 | 损坏当miss，有限/真实日期、非空字段、Shanghai历史截止与包含首尾≤366天；`cache-corruption-red/green`、`query-bounds-red/green` |
| 取消/超时但上游忽略signal可迟到成功；实际Headers的Retry-After漏读，缺列元素被补为null | 有界取消race与落盘前取消核对；Record/Headers及HTTP-date如实解析；逐日日期/列/数值无效拒绝、仅显式null保留；`adapter-edge-red-bounded`→`adapter-edge-green`（19/19） |
| 增加flush写入后实际受限Q因fsync权限失败 | 保留该新增修复引入的RED；撤销flush，继续唯一临时文件+原子rename，不宣称断电持久性；`permission-cache-red/green` |
| 天气目录有note但页面原只渲染商圈note | 泛化已接入连接器说明显示；保留 `ui-qa/catalog-before-note-fix.*`，修正后 `ui-qa-v2/catalog.*` 许可与域可见 |

夹具失败也保留：SDK合成上游测试最初仅复制天气源导致缺project-entry，随后trusted上游函数形状/参数修正（`sdk-cache-lifecycle-green/recheck/recheck2`）；移植的权限测试先继承NODE_TEST_CONTEXT二进制事件、随后脚本路径权限先失败，改独立报告环境与无文件权限的inline探针，未削弱网络拒绝断言（`transport-permanent-green/recheck/recheck2/recheck3`）。这些是测试夹具修正，不能算产品缺陷的因果RED。

### 已运行验证与范围

| 检查 | 实际范围/结果 |
| --- | --- |
| weather-mcp + weather-egress | `adapter-edge-green.log` 19/19，含子进程Host网络策略11项；无真实API/DNS |
| 真Host/SDK weather | `stdio-weather-green.log` 2/2；`sdk-cache-lifecycle` 中开关/碰撞/停止/两进程close及protected排除通过；缓存产品miss/hit/过期重取最终 `sdk-cache-lifecycle-recheck2.log` 1/1，通过次数1→1→2，不含真实模型 |
| 商圈与共享目录防护回归 | `tradearea-guard-regression.log` 10/10，含实际SDK direct/codemode目录变化/恢复/reload仍冻结；商圈既有路径未回退 |
| 传输与OS负向 | `transport-permanent-recheck3.log` 外层2/2；内部fd客户端13项、Host14项。任意非清单域broker拒绝；实际Q的net/tls/http/fetch/UDP/Unix/子进程拒绝，Seatbelt单独一层也拒绝，loopback TCP/Unix监听0命中；MCP取消不落缓存、随后复用、P/Q同组及关闭退出。该组是SDK形状进程组；真正SDK产品生命周期另由weather-agent-flow验证 |
| 类型/会话边界 | `tsc-current.log`、`boundary-current.log` exit0；新增Host文件无Pi SDK导入，原薄层loader/例外清单无变化 |
| 浏览器点验 | `ui-qa-v2/`：两条目/描边按钮/导航；三能力默认关、天气开关独立、创建与会话D12内联卡；继承开启时不重复出卡；空闲关闭/重开文案；合成查询源/coverage/cache；console warning/error均0。页面/开关操作Provider请求0，发送后共2；缓存命中，真实API/DNS/模型0；隔离QA已正常关闭 |
| `npm run check` | 当前进行中，最终退出/计数另记；不以目标测试代替全量 |
| 独立复核 | 两名干净上下文非作者已先冻结独立预期，完整候选复核进行中，报告与修复/重验另记 |

当前可声明：WX01合成真实SDK路径、WX02/03/04目标合同、WX05本机macOS强制、WX06默认/受管/开关生命周期、WX07浏览器形态、WX08标准复用已有本地证据。WX09全量与非作者复核仍待闭合。Linux CI尚未运行，macOS条件OS测试与跨平台策略/fd/unsupported测试分别记录。真实Open-Meteo参数/响应/限流/延迟仍未实测；单次湖州2025-10全月冒烟必须先获用户授权；真实模型分析正确性、商业使用条件、设备采用不由合成工程测试代替。


### 非作者发现与修复轨迹（最终复核报告另附）

1. 两轴在独立副本首次天气目标检查均23/25，保留2 FAIL：夹具code/node_modules指向独立副本node_modules，形成中间跨根链接，被Q的Node文件权限如实拒绝（不是源目录过长）。仅两处夹具链接改为最终realpath，产品权限不扩大；固定候选v2，两个复核者各重验25/25通过。
2. Spec轴独立10项探针发现3个同根因P2：原型名 `__proto__`/`constructor`/`toString` 会命中城市表继承属性，无效坐标送入上游并误分类。新增长期测试先RED（`prototype-city-red.log`）后 `Object.hasOwn` 查表修复，`prototype-city-green.log`17/17；v3交复核者重验。
3. Standards轴提示历史TDD主张须限定：原Qoder“RED模块缺失”原文保留，它只证明当时测试不可运行，按工程§3不算产品行为因果RED，不在当前收尾追认。移植夹具失败同样不算产品RED。
4. Standards额外12阶段真实SDK探针：天气direct基线、codemode/direct目录变化拒绝、恢复与reload仍拒绝；商圈继续可用；公共close重建后天气恢复；再改商圈则只冻商圈。工程源码/权限不改，动态合成server只在隔离副本；首次fs.watch夹具失败保留，改只读轮询后通过。

全量轨迹保留：初次 `full-check.log` 959项955通过/1失败/3条件SKIP，失败是移植权限夹具；夹具修复后 `full-check-fixed.log` exit0，959项956通过/0失败/3条件SKIP并完成构建。随后 `full-check-v2.log` 运行期间收到并加入原型城市因果RED及修复，混合在途源码，不作为固定候选验收：960项956通过/1失败/3SKIP（该新增RED）。收敛后冻结候选，再以 `full-check-final.log` 对最终完整版本检查；后者结果另记，不用在途运行证明最终通过。

收尾补查：v4全量 `full-check-final.log` exit0（960项957通过/0失败/3条件SKIP）。其后补验发现D12卡片的临时显示状态在A→B任务切换时复用，能力开关未串用；原浏览器现场 `ui-qa-v3/b-inherits-a-before.*` 保留。仅为会话TaskCapabilityList增加既有activeKey React key，随任务重建临时UI状态，无持久ACK或能力变更；最终v5构建、A/B浏览器复验及非作者增量另记。


## 本地阶段最终结果（固定v5，2026-11-03）

- 最终完整运行清单v5 SHA256 `749737412b9263cf85a79ee632f1aacfdce84ad59f661663b090acede41bd05b`，554文件；`full-check-v5.log` 实际exit0：960项957 PASS/0 FAIL/0 cancelled/3条件SKIP，agent-session边界、tsc、Vite及stamp全部完成。原日志SHA256 `e91a4ce6d84c142d74be7c5f5e67c254b7717bd842da5122b19d4e738be79851`；收据 `full-check-v5-receipt.json` SHA256 `05c9a8d0f2f534eda9e2d94a435edfc55333bfe134cbbdbe3629155dc0e96348`。检查后、两轴最终补证均全554哈希零差异。
- 3条件SKIP保留：本机Mac/新owner支持受管profile而未跑unsupported平台分支；两项真实soffice页面图像SKIP；Vite保留>500kB chunk提示。天气实际OS传输、四模式排除均已在本机实跑，不以SKIP代替；不声明PPT真实图像或Linux平台已验。
- Spec轴：最终天气26/26、独立反例/覆盖/缓存/取消10/10、SDK排除/旧任务保全3/3、共享目录冻结1/1、边界/类型通过。原P2城市与夹具发现均独立关闭。
- Standards轴：天气25/25修复复验，v3受影响19/19，四模式实际SDK排除、12阶段天气/商圈目录互不误冻、真实Host A/B两资源隔离通过；Host–Agent§4职责/SDK复用及IN06既有loader例外复用通过。未新增SDK导入/边界例外/依赖/Runtime。
- 最后UI修复v5：`ui-build-task-key.log` exit0；`ui-qa-v4/`完整AX证明A本次开启卡1→B保持开启卡0→返回A卡0→B自身关再开卡1，能力值保留，截图/console[]/provider0/正常关闭。两轴分别核读证据及唯一key源码差异，明确不冒称自己操作浏览器；v4旧单任务覆盖漏项、暂停及失败现场保留，v5增量关闭。
- [independent-review.md](independent-review.md)为root汇总并附两名非作者原报告、UI增量与最终完整检查补证全文/原哈希；无未关闭可行动发现。汇总/spec/result属于验证后的纯文档收尾，不改已验代码/测试；后续收尾清单单列其身份。

本地验收映射：WX01合成真实SDK路径通过（真实API/真实模型待验）；WX02/03/04、WX05本机macOS强制、WX06能力/资源边界、WX07目录及D12、WX08标准复用、WX09本地完整工程检查通过。没有真实API或该API域DNS、真实模型、Git提交/推送/PR/CI/合并、MacBook或生产服务切换；主仓main保持清洁。下一授权门：单次湖州2025-10全月真实API冒烟；集成main、提交推送、单PR、实际head CI；squash合并仍待用户明确确认。真实模型和MacBook更新按用户首句另行授权，不自动执行。

收尾时共享主仓已由其他变更前进到 `4a3be3d36b6c2511635b2c044de2068b6b6ca4df`（PR #28，trial uploads/analysis setup修复），main及origin/main读回同头且清洁。本任务未移动main。该增量触及App/server/project-store等共用接缝；上文本地v5验证仍只对应原base351d835上的天气候选，没有集成或覆盖该新main。后续Git获授权后必须先集成最新main并重验受影响部分及独立复核增量，重新取得实际head CI，不沿用旧基线绿色。
