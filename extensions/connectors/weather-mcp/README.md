# 历史天气连接器（weather-mcp）

OptraCall 第二个 MCP 连接器（kind=remote-api，复用[标准 v1](../../../docs/mcp-connector-integration.md) 验证其可复用性）：把 **Open-Meteo 历史天气 API（Archive API）**适配为单只读工具 `weather_history`，供项目任务 Agent 在分析中补充历史天气变量（日均温、日降水）。按讨论稿 D1–D13 与 [weather-mcp 规格](../../../openspec/changes/weather-mcp/spec.md) 交付；data-mcps R1 天气闭环仅作失败路径语义参考（缺失不填零、限流/超时/取消不盲重试、缓存时效如实标注）。

## 解决的任务

Agent 回答"去年 10 月连续降水有没有压住周末客流"这类问题时，用坐标＋日期区间查历史日天气；期望日期与实际返回逐日核对，缺失日期如实列出，不填零不插值；结果带来源、获取时间与缓存时效，可进分析报告溯源。**本工具只提供历史观测数据，不做预报、不产出业务结论**。

## 工具

`weather_history`（唯一工具；来源/许可说明并入描述，可推导不设 meta 工具）：

- 定位二选一：`city`（内置 上海/杭州/湖州/南京/北京/广州/深圳/成都/武汉/重庆）或经纬度 `lat`+`lon`；
- `start`/`end`：YYYY-MM-DD，历史区间（end 须早于今天），跨度 ≤366 天；
- `fields`：`temperature_2m_mean`（°C）、`precipitation_sum`（mm），默认两者；
- 输出：`source`（含许可说明）、`timezone`（固定 Asia/Shanghai 并标注）、`coverage`（expected/actual/missingDates/duplicateDates/nullValueDates）、`daily`、`cache`（hit/fetchedAt/ageHours）；
- 错误信封：`invalid_param`（参数）与 `source_unavailable`（detail.reason ∈ rate_limited/quota_exhausted/timeout/cancelled/network/upstream_error/auth_invalid，含 Retry-After 秒数）；**不自动重试**，取消/超时结果未知由调用方与 Host 语义承担。

## 出境与凭据

- 出境白名单：仅 `archive-api.open-meteo.com`（connector.json `egress` 声明；适配器内 URL 构造自限于该域并自检）。请求内容仅坐标、日期、字段参数与时区；无密钥（credentials=none）；**Host 侧传输层强制为接缝职责（Codex，首个 remote-api 实例）**。
- 许可：Open-Meteo 免费档限非商业用途，条款以官方为准，工具描述与结果中如实标注。

## 缓存

- 落位 `<dataRoot>/connectors/weather/entries/`（清单 `data.location`）；请求指纹（坐标+区间+字段，排序规范化）内容寻址，原子写入；
- 默认 TTL 72 小时（可配置）：新鲜命中直接返回并标注 `cache.hit=true` 与时效；**过期不冒充新数据，重新获取**；获取失败不回落旧缓存；
- 缓存是性能层：损坏条目按未命中处理。

## 运行与接入

- stdio MCP server：`node extensions/connectors/weather-mcp/main.ts`（缓存根来自 `WEATHER_CACHE_ROOT` 或 `--cache-root`，缺失明确退出）；
- Host 注册（Codex 归属接缝，形态对齐 trade-area 先例）：任务能力开关、`registerMcpServer(name, config)`、目录条目、受管/封闭任务不注入、出境白名单强制；
- 依赖：`@modelcontextprotocol/sdk`、`zod`（随标准 v1 既有依赖，无新增）。

## 测试与停用

- `tests/weather-mcp.test.ts`（10 项）：覆盖核对（缺失/重复/null）、缓存指纹稳定性与过期、适配器失败分类（429+Retry-After/400/5xx/超时）、参数信封、缓存命中零网络、过期重取、MCP 协议往返（单工具/只读标注/精确键拒绝/必需键协议级拒绝）、stdio 预热缓存冒烟——全部合成 HTTP 夹具，**不触真实网络**；
- 真实 API 冒烟属外部副作用，按规格另行授权后执行并记录；
- 停用：Host 侧取消注册即可；删缓存＝删 `<dataRoot>/connectors/weather/` 目录。

## 已知边界

- 只查历史（Archive），不做预报、订阅刷新、定时采集；最近几天上游未归档，覆盖核对如实报缺失；
- 城市坐标表 v1 仅 10 个内置城市，其余用经纬度（工具描述列明）；
- 时区固定 Asia/Shanghai（中国经营分析场景），其他时区需求未来另行增补。
