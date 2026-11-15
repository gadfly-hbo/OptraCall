# db-link：首批驱动精确版本证据

2026-11-13 · 只读选型说明 · **建议待用户确认，未采用、未安装、未连接数据库。**

首批 MySQL + PostgreSQL、成熟驱动薄适配的方向已由用户明确；以下精确版本仍是建议。仅查官方 npm registry、上游 tag／发布说明与固定源码，未改产品、`package.json` 或锁文件，未下载／执行发行包。

## 建议冻结组合

| npm 包 | 建议精确版本 | npm 发布日（UTC） | npm `gitHead`／tag 对应 commit |
| --- | --- | --- | --- |
| `pg` | `8.23.1` | 2026-09-30 15:39:58.489 | `0980cefebe0ae461da8883703be049fe13ca96cf` |
| `pg-cursor` | `2.22.1` | 2026-09-30 15:39:56.716 | 同上 |
| `mysql2` | `3.24.6` | 2026-10-13 14:33:39.196 | `7f65d9af6e2cc87fea33cce9319c11faf266363a` |

三者是查询当日 registry `latest` 的非预发布版本，但本建议依据还包括以下来源一致性、修复与公开接口边界；`latest` 本身不是采用授权。[N1][N2][N3]

- `pg@8.23.1` annotated tag object 为 `07968bc4287ab7d98b6721183ce6860767a76fe9`，`pg-cursor@2.22.1` 为 `b16821694898b31ec86df90ba4d1d2ee1dc31f14`；两者解引用均为上述 commit，与 npm `gitHead` 和该 commit 的两个 package 版本一致。tag API 均标注 unsigned；不宣称签名已验证。[P1][P2][P3]
- `mysql2` 的 `v3.24.6` tag 直接指向上述 commit，与 registry `gitHead`、固定 package 及 GitHub release 一致；release 2026-10-13、npm 发布时间晚约两分钟。[M1][M2]
- 三包 package 均声明 MIT。`pg` engines 为 Node `>=16.0.0`，可选 peer 为 `pg-native >=3.0.1`；建议使用纯 JS 路径，不新增 native/libpq。`pg-cursor` 未声明 engines、无运行依赖、peer 为 `pg ^8`；`mysql2` engines 为 Node `>=8.0`、peer 为 `@types/node >=8`。当前 OptraCall 要求 Node `>=25.0.0`，已有 `@types/node 26.6.5`，范围满足不等于已做运行兼容验证。[N1][N2][N3][P3][M2]
- `pg` 固定上游 CI 配置包含 Node 24／26，不能据此声称 OptraCall Node 25 已通过；`pg`／`pg-cursor` package 未自带 `types` 字段，TypeScript 声明包选择留待获授权实施时核对，不暗中增加依赖。[P3][P4]
- registry 的 `pg.dependencies` 同时展示 `pg-cloudflare ^1.4.1`，固定源码在 `optionalDependencies` 声明同范围，registry 也保留该 optional 字段；这是元数据归并，未发现该项版本冲突。[N1][P3]
- 当日上游 master：node-postgres `2a5850fb0db18f5e40a642bbb4a4743de412ab54`（2026-10-23），mysql2 `91b0801160c5e22bf711683457be8f1027214f31`（2026-11-02），package 仍写上述版本；master 已有后续提交，不能用同版本号把 master 当已发布代码。建议身份只指向 npm 对应 tag／commit。[P5][M3]

## 选型依据与相关修复

- `pg` 上游 [release 页](https://github.com/brianc/node-postgres/releases)没有 release 条目，根 [CHANGELOG](https://github.com/brianc/node-postgres/blob/0980cefebe0ae461da8883703be049fe13ca96cf/CHANGELOG.md)明确不逐条列 patch；以 `pg@8.23.0...pg@8.23.1` 官方 compare 核 patch，而不编造 release note。[P6]
- `8.23.1` 同批包含 IP 连接的 TLS 主机名验证修复（#3756）、extended-query Sync 不再吞连接错误（#3772）、查询配置不原位污染（#3720），均与薄适配的来源／失败可信度相关。[P6]
- `pg-cursor 2.22.1` 同批 #3785 修复关闭后迟到描述／行响应重置状态、重复 Close/Sync 及下一查询错配；该提交明确**未解决已排队 read 的结算**。建议每 cursor 至多一个未完成 `read`，不启用 pipeline；#3737 已明确拒绝 pipeline 下的 portal 查询。[P6][P7]
- `pg-cursor` 是同仓官方游标组件；其公开 `read(n)`／`close()` 复用后端 portal，适合有界批次读取，不自建 wire protocol，也不需要同时引入 `pg-query-stream`。[P8]
- `mysql2 3.24.6` 最新 patch 修复 LOCAL INFILE 终止包复用；它不授予文件导入资格。继承的 `3.24.5` 修复 IPv6 URI；`3.24.0` 修复 `dateStrings` 零日期；`3.23.4` 修复 TIME 小数前导零；`3.23.0` 支持 JSON 内不安全整数保留字符串（Node 22+）；`3.21.1` 修复安全整数边界判断。这些是推荐当前完整 patch 的依据，不是无缺陷保证。[M1][M4]

## 公开接口及取消边界

- PostgreSQL 使用公开 `Client`／`Pool`、参数查询、query 级 `types` 和官方 cursor；首期显式保持 `pipeline:false`。`statement_timeout` 是服务器执行限制，`query_timeout` 是调用等待限制，二者不能互换。[P9][P10]
- 固定 `pg` 的非 pipeline `query_timeout` 只处理回调／队列，不发送 server cancel；`client.end()` 对活动普通查询走断连，但本地关闭也不是数据库执行已经结束的回执。[P10]
- 固定源码存在 `Client.cancel(client, query)`，当前公开 Client 文档未列此方法；它依赖 activeQuery／进程密钥及队列细节，pipeline 部分分支只丢弃回调。首期不把该未文档化路径作为公开取消合同，不读写驱动内部状态。[P9][P10]
- `cursor.close()` 发送 Close/Sync 后等待 readyForQuery，不能抢占正在执行的慢查询。客户端等待结束、游标关闭、远端执行结束必须分别记录；网络丢失／结束未知保留 UNKNOWN。[P11]
- `pg-cursor` 在线页把 `read(n)` 标为 `Promise<pg.Result>` 并示例解构 `rows`，但固定 `2.22.1` 源码 Promise 实际 resolve **rows 数组**。实施按固定发行接口核验，不照抄漂移文档。[P8][P11]
- `mysql2` 公开 callback query 提供 `.stream()`、连接提供 `.destroy()`；Promise query 返回整批结果，若要流式读取应选官方 callback API，不下钻 PromiseConnection 内部对象。[M5][M6]
- `mysql2` 的 QueryOptions.timeout 注释说超时销毁连接，但固定 `query.js` 超时实现只 callback／emit 错误，无 KILL／destroy；stream destroy 也只移除监听并恢复消费。`Connection.destroy()` 实际调用 close→stream.end，均不提供远端查询结束证明，不能从 API 名称推断强取消。[M5][M7][M8]
- 权限可行性、数据库侧取消语句与独立控制连接的所有权核验另见本变更规格；不能因驱动有 timeout 就省略。失败连接不回池、迟到结果不保存成成功、取消失败保留 UNKNOWN；此处是候选产品合同，尚无实测证明。

## 类型与精度合同建议

- `pg 8.23.1` 固定依赖 `pg-types 2.2.0`：text 模式 int8 默认 string，numeric 标量无 parser 时保留 string；float4／float8 为 Number。**numeric[] 的 OID 1231 默认 parseFloatArray，会损失精度**，不能笼统宣称 pg 数字默认无损。[P3][T1]
- `pg` 的 date／timestamp／timestamptz 默认 JS Date，涉及进程时区和微秒截断；JSON／JSONB 默认 JSON.parse，也可能舍入 JSON 内大整数／小数。建议通过公开 query 级 `types` 对精确数值数组、日期和 JSON 保留文本；其他数组／嵌套类型逐项核验，不全局改 parser。[P9][T1][T2]
- `mysql2` 默认 decimalNumbers=false（DECIMAL string），但 supportBigNumbers=false、dateStrings=false、jsonStrings=false。建议显式 `supportBigNumbers:true, bigNumberStrings:true, decimalNumbers:false, dateStrings:true, jsonStrings:true`，统一保留 BIGINT、DECIMAL、日期及原 JSON 文本；分别核验 text query 和 prepared execute 的 parser。[M9][M10]
- JSON 大整数修复不代表 JSON 任意小数都无损；保留原文本／类型元数据后由 Agent 自主采用合适计算方法，Host 不转 Number 补算。NULL、空串、NaN／Infinity、正负／unsigned边界、零日期、时区和微秒需有不同合成样例；不把文本留存宣称为数据库原始字节／统一跨库精度。[T1][M9]

## 四原则与未验证范围

- Host 仅绑定凭据、TLS、权限、限额、资源归属、取消与结果类型／来源；Agent 自选 SQL、批次与分析方法。驱动／cursor 为公开能力薄包装，Pi 运行入口复用，不改 Pi、Semantica 或数据库驱动源码，不另造协议或 Agent 循环。
- 用户仍只需配置连接和项目资格；正常取数／精度留存／收尾不逐条询问，不要求用户手工 KILL、分页搬运或导出再上传。真实权限缺口不能通过额外人工作业掩盖。
- 本轮只有来源与源码核查：未安装、未执行驱动、未连真实／合成数据库、未验证 TLS／取消／池清理／分页内存／精度／平台打包，也未做 tarball 字节比对、签名验证、依赖闭包审计或漏洞扫描。Node engine、npm integrity／provenance 元数据、tag 对应都不等于这些检查通过。
- 精确 tuple、配置与最小接缝均待用户确认；版本确认也不自动授权开发、安装、数据库访问、真实模型实验、Git／CI或运行采用。

## 官方来源（查阅日：2026-11-13）

[N1]: https://registry.npmjs.org/pg
[N2]: https://registry.npmjs.org/pg-cursor
[N3]: https://registry.npmjs.org/mysql2
[P1]: https://api.github.com/repos/brianc/node-postgres/git/tags/07968bc4287ab7d98b6721183ce6860767a76fe9
[P2]: https://api.github.com/repos/brianc/node-postgres/git/tags/b16821694898b31ec86df90ba4d1d2ee1dc31f14
[P3]: https://github.com/brianc/node-postgres/commit/0980cefebe0ae461da8883703be049fe13ca96cf
[P4]: https://github.com/brianc/node-postgres/blob/0980cefebe0ae461da8883703be049fe13ca96cf/.github/workflows/ci.yml
[P5]: https://api.github.com/repos/brianc/node-postgres/branches/master
[P6]: https://github.com/brianc/node-postgres/compare/pg%408.23.0...pg%408.23.1
[P7]: https://github.com/brianc/node-postgres/commit/17ab6e5921e16fd584645ac6a6f9869ba4a10eba
[P8]: https://node-postgres.com/apis/cursor
[P9]: https://node-postgres.com/apis/client
[P10]: https://github.com/brianc/node-postgres/blob/0980cefebe0ae461da8883703be049fe13ca96cf/packages/pg/lib/client.js
[P11]: https://github.com/brianc/node-postgres/blob/0980cefebe0ae461da8883703be049fe13ca96cf/packages/pg-cursor/index.js
[M1]: https://github.com/sidorares/node-mysql2/releases/tag/v3.24.6
[M2]: https://github.com/sidorares/node-mysql2/blob/7f65d9af6e2cc87fea33cce9319c11faf266363a/package.json
[M3]: https://api.github.com/repos/sidorares/node-mysql2/branches/master
[M4]: https://github.com/sidorares/node-mysql2/blob/7f65d9af6e2cc87fea33cce9319c11faf266363a/Changelog.md
[M5]: https://github.com/sidorares/node-mysql2/blob/7f65d9af6e2cc87fea33cce9319c11faf266363a/typings/mysql/lib/protocol/sequences/Query.d.ts
[M6]: https://github.com/sidorares/node-mysql2/blob/7f65d9af6e2cc87fea33cce9319c11faf266363a/lib/promise/connection.js
[M7]: https://github.com/sidorares/node-mysql2/blob/7f65d9af6e2cc87fea33cce9319c11faf266363a/lib/commands/query.js
[M8]: https://github.com/sidorares/node-mysql2/blob/7f65d9af6e2cc87fea33cce9319c11faf266363a/lib/base/connection.js
[M9]: https://github.com/sidorares/node-mysql2/tree/7f65d9af6e2cc87fea33cce9319c11faf266363a/lib/parsers
[M10]: https://github.com/sidorares/node-mysql2/blob/7f65d9af6e2cc87fea33cce9319c11faf266363a/lib/connection_config.js
[T1]: https://github.com/brianc/node-pg-types/blob/v2.2.0/lib/textParsers.js
[T2]: https://node-postgres.com/features/types
