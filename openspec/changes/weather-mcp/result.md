# 天气 MCP 连接器 · 实施与验证记录

2026-11-03 · 分支 `qoder/weather-mcp`（基于合并后 main `351d835`）· 状态：Qoder 侧连接器本体已完成并本地验证（全合成夹具）；Host 接缝（Codex 归属）未实施；真实 API 冒烟按规格另行授权未执行。

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

## 验收映射（WX01–WX09 当前状态）

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

## 如实缺口与未验证项

- Host 接缝归 Codex 未实施：`TASK_CAPABILITIES` 增加天气条目、`registerMcpServer('weather-mcp', …)` 注册＋目录指纹冻结复用、能力目录条目＋导航、新建任务/会话内开启交互（UI Demo 已确认形态，含 D12 一次性出境说明卡）、`<dataRoot>/connectors/weather/` 分配、**首个 remote-api 的出境白名单传输层强制**（新机制，需 Codex 设计）。
- 真实 Open-Meteo 请求 0 次：参数格式与真实响应结构未经真实 API 核对（规格"实施核对为准"项仍开放）；授权后建议单次冒烟（湖州 2025-10 全月）并记录限流/延迟实测。
- 时区固定 Asia/Shanghai、城市表 10 城、TTL 72h、跨度 366 天、end<今天 为 v1 实施决定，已在规格与 README 记录，可随后续变更调整。
