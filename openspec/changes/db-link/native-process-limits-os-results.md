# macOS 原生进程限额：隔离合成探针结果

日期：2026-11-14。范围：本轮获准的 OS／Node 合成可行性验证，不连接数据库或 Provider，不实施产品接线。

**结论：本机当前候选不能作为已证明的进程内存硬边界，保持 DB 原硬准入。** `RLIMIT_AS` 的 512 MiB、1 GiB、4 GiB 请求全部在 `setrlimit` 阶段返回 `EINVAL(22)`，读取仍为无限，启动器在 exec 前退出；这些不是“Node 已在限额内启动后 OOM”。CPU 默认信号退出、单文件和精确所属进程截止的有限场景分别得到证明；忽略 CPU 信号的附加反例需要父进程截止收尾，不能把默认信号退出称为不可绕过的 CPU 终止保证。这些结果不能补内存、目录总量、网络／磁盘速率或远端查询总预算。

## 目标与执行清单

- [x] 开工前读取 AGENTS、工程规范第 2–4／7–8 节、产品讨论稿及本变更原生限额研究；固定计划、环境、原有文件身份和探针源文件身份。
- [x] 私有 C launcher 经现有 clang 编译；仅改变自身随后 exec 的子进程，逐项保留 get-before／set／get-after 和 soft／hard；失败或不匹配立即拒派。
- [x] 验证原生／Node baseline、AS 设置与启动阻断；有限 AS 继承及其保护下的分配因前置失败保持 NOT_RUN。
- [x] 在无 AS 条件下观测合成 heap、Buffer、ArrayBuffer、UTF-8 字符串和 native mmap 路径；这些仅为 reference，不计入内存准入。
- [x] 验证 CPU、FSIZE、限额设置失败 sentinel、父进程截止与 wait 收尾；保存所有原始失败／信号／退出。
- [x] 回读既有 Node／安装收据、原双引擎 fixture、package／lock 身份，均未变化；全部 19 案的所属子进程观察到 exit，wait 后即时 PID 检查均不存在。第 19 案为独立源文件的附加反例，未改原 18 案或原探针身份。

本任务为能力探索，未制造产品 RED；无产品代码或 UI 变化，UI Demo 不适用。本记录是探针作者结果；完整候选非作者复核及 DB 运行验证由本轮总记录分别核定，不以本文件替代。

## 冻结环境与可复用入口

| 项目 | 实测身份 |
| --- | --- |
| OS | macOS 26.3.1(a)，build `25D771280a`；Darwin `25.3.0`，`xnu-12377.91.3~2/RELEASE_ARM64_T8132`，arm64 |
| 设备物理内存 | 17,179,869,184 bytes（16 GiB） |
| Node | 既有 Homebrew `25.9.0_3`，运行版本 `v25.9.0`；`/opt/homebrew/Cellar/node/25.9.0_3/bin/node` |
| Node SHA256 | `fba87e4402c55ea4fc7ca9b9838790c32534e3e77c9c7834c37073752d070678`；本轮前后相同 |
| 编译器 | 现有 Apple clang `17.0.0 (clang-1700.6.4.2)`，CLT |
| launcher SHA256 | `d6a1b788e9f7c6d93430f4ab810c20051c3d797ddae08e00a7bec2408153d055` |

实际 Node 是现有 Homebrew 安装，保留其 `INSTALL_RECEIPT.json`；本轮没有将其与 nodejs.org 发布归档作字节比对，不能称为“已核验上游官方二进制”。没有替换、升级、改包或改变其运行时能力开关。

私有实现根：`/Users/bendandebaba/.codex/worktrees/48da/OptraCall/.local/db-link/native-process-limits/os-probes/`。

launcher 最小 CLI：

```text
native-limit-launcher [--as-bytes N] [--cpu-seconds N] [--fsize-bytes N] -- COMMAND ARG...
```

只设置明确传入的限额，均设 soft=hard；未传入的项保持继承。另将所属 child 的 core soft/hard 置零，避免失败生成 core。stderr 是逐行结构 JSON，stdout 完全由执行目标使用。成功核对才输出 `pre-exec` 并 exec，限额错误退出 78，exec 错误退出 126。该程序不是产品依赖或准入接线；无需消费其私有对象或协议即可复用 CLI。

私有 runner 最小 CLI：

```text
python3 run-case.py --id UNIQUE --out ABS_EVIDENCE_DIR --timeout 10 -- COMMAND ARG...
```

runner 每案最多 10 秒墙钟截止，串行运行，绑定自己 `Popen` 持有的 child PID；截止时只向该 PID 发 SIGKILL，随后 communicate／wait，保存实际退出而非只记“已发信号”。它不停止数据库或任何其他进程。清空继承 `NODE_OPTIONS` 使本次 Node 调用无额外运行参数；未向 Node 传 `--max-old-space-size`、禁用 Wasm 或其他调参。

## 原始结果

全部原始命令、PID、限额、stdout／stderr、退出和哈希按下列 case ID 保存。成功／错误退出均不自动等于业务操作成功。

| ID | 目的／输入 | 观察 | 结论范围 |
| --- | --- | --- | --- |
| 01 | 原生 baseline，CPU 2s／FSIZE 64KiB | exit 0；子程序读回 CPU／FSIZE soft=hard，与父 exec 前核对值相同 | 这两项设置／继承通过 |
| 02 | Node baseline，同上 | exit 0；Node 内私有 N-API 只读指标再次读回 CPU／FSIZE soft=hard | 当前实际 Node 可运行；没有 AS 内存上限 |
| 03 | 先把 FSIZE hard 设 1KiB，再 exec 同 launcher 尝试升为 2KiB，目标为新 sentinel | 第二次 set 返回 EPERM(1)，exit 78；stdout 0 bytes；sentinel 不存在 | 设置失败不会执行目标 |
| 04 | 原生目标，AS 512MiB | set -1／EINVAL(22)，get 仍无限，exit 78，stdout 0 bytes | AS 设置失败；原生目标未启动 |
| 05 | Node 目标，AS 512MiB | 同上 | Node 未启动 |
| 06 | Node 目标，AS 1GiB | 同上 | Node 未启动 |
| 07 | Node 目标，AS 4GiB | 同上 | Node 未启动 |
| 08 | 无 AS；4,194,304 项数字数组，约 32MiB 数据 | exit 0；RSS 45.33→80.75MiB，footprint 14.13→47.06MiB | heap 路径 reference |
| 09 | 无 AS；单个 64MiB Buffer 全触碰 | exit 0；RSS 45.11→110.41MiB，footprint 13.85→78.78MiB；heapUsed 仅约 4.17MiB | Buffer 与 JS heap 指标分别记录；不证明受 AS 保护 |
| 10 | 无 AS；单个 64MiB ArrayBuffer 全触碰 | exit 0；RSS 45.25→110.52MiB，footprint 14.02→78.86MiB | ArrayBuffer 路径 reference |
| 11 | 无 AS；16MiB ASCII Buffer 解码为 UTF-8 字符串，两者保留 | exit 0；RSS 45.09→78.28MiB，footprint 13.89→46.69MiB | 固定字符串路径 reference，不代表全部编码／解码 |
| 12 | 无 AS；native mmap 64MiB RW，逐字节触碰 | mmap 成功；RSS 1.23→65.25MiB，footprint 0.89→64.95MiB；unmap 后下降，exit 0 | 原生分配路径 reference |
| 13 | 无 AS；native mmap 1GiB PROT_NONE，完全不触碰 | virtual 增加恰好 1GiB，RSS／footprint 仅各增 16KiB，exit 0 | 虚拟映射与驻留量不能等同 |
| 14 | native CPU 忙循环，CPU soft=hard=1s | SIGXCPU，约 1.0065s；父 deadline 未触发 | 默认信号处理下该负载被终止 |
| 15 | Node CPU 忙循环，同上 | SIGXCPU，约 1.0046s；父 deadline 未触发 | 同上，不推成 CPU 速率配额或墙钟上限 |
| 16 | native FSIZE 16KiB，最多尝试 64KiB 顺序写入新文件 | SIGXFSZ；保留文件正好 16,384 bytes | 这个单文件写入路径被限额阻断 |
| 17 | Node 同样 FSIZE／写入 | 捕获 EFBIG，exit 2；新文件正好 16,384 bytes | Node 失败处理路径明确；不是目录／所有 I/O 总量 |
| 18 | Node 20s timer，parent deadline 0.5s | 父 SIGKILL，观察 exit -9／wait 完成，约 0.5085s | 当前父进程可调度条件下的所属收尾；不是远端终结 |
| 19 | 独立 native 忙循环显式忽略 SIGXCPU，CPU soft=hard=1s，parent deadline 1.5s | 在父截止前未自行退出；`timed_out=true`、`kill_sent=true`，父 SIGKILL 后 wait 完成，约 1.50236s | 原默认信号退出不能当作不可绕过的 CPU 截止证明；本案未单独测得实际累计 CPU 秒，不推断后续系统行为 |

所有内存负载串行；可触碰的最大单个合成额外数据为 64MiB；受控分配没有超过 128MiB。1GiB PROT_NONE 为地址预留且从不触碰。本轮没有寻找数百 GiB 的可启动 AS 额度，没有大物理分配或 OOM 压机，没有自动重试。

## 内存判定与保留边界

1. `setrlimit` 的返回码与读回结果直接证明本轮预算未建立；有限 AS 下的 Node 启动、继承、驱动／TLS、heap／Buffer／ArrayBuffer／解码／mmap 超限行为均 **NOT_RUN**，不能用无 AS 的成功补齐。
2. launcher exec 前的 Mach `virtual_size` 约 415.14GiB，原生 baseline 也约 415.14GiB；Node baseline 约 415.92GiB，而 Node RSS 约 45MiB、footprint 约 14MiB。不能把全部虚拟映射归因于 V8 或当成实际物理内存使用。本轮未枚举映射构成，未将“低于既有虚拟映射”推断成 EINVAL 的已证明根因，也没有将失败泛化为所有 macOS 版本均不支持 AS。
3. 本机 CLT 头文件预处理直接得到 `RLIMIT_RSS RLIMIT_AS`、`RLIMIT_AS 5`，因此改用 RSS 名称不提供另一项独立限额。`RLIMIT_DATA` 常量为 2，本轮未测试或采用它，不能宣称其覆盖 mmap／Buffer／全部 native 分配。
4. RSS、physical footprint、AS、Node heap／external／arrayBuffers 各保留原指标，不相互换算预算。Node 私有只读 N-API 指标中的无限值经 JS Number 有精度舍入，精确 `RLIM_INFINITY=9223372036854775807` 以 C launcher／native 记录为准；本轮有限 CPU／FSIZE 值均可精确表示。
5. CPU／FSIZE 限额的有限成功不能开放缺失内存硬边界的 DB 查询。CPU 第 19 案仅证明显式忽略 SIGXCPU 的这个子程序在本案 1.5s 墙钟范围内需要父进程截止收尾；不能把第 14／15 案默认处理的成功泛化为任意程序不可绕过的累计 CPU 强制终止。父墙钟 probe 没有证明设备睡眠、Host 失去调度或父异常退出时仍按同一时间收尾；没有证明子孙进程域或远端数据库终结。

四原则自检：探针只核环境治理，不规定分析方法或业务 SQL；复用系统 set/getrlimit、exec、公开 Node API／N-API 和现有 clang，没有改造 SDK、创建 Runtime 或实现内存引擎；不增加用户日常操作。没有容器、代理、全局 launchctl limit、服务安装／切换、系统设置变更、依赖安装或其他设备操作。原硬准入、原 FAIL／UNKNOWN 继续保留。

## 证据索引

持久原始证据根：`/Users/bendandebaba/.codex/visualizations/2026/11/14/db-link-native-process-limits/os-probes/`。

- `plan.md`：运行前计划；`pre-run-environment.json`：环境命令、原 WIP status／HEAD、既有文件与源身份；`node-homebrew-install-receipt.json`：原安装收据。
- `pre-execution-identity.json`：运行前全部探针源／编译物 SHA256；原源和二进制副本均在同一证据根。
- `01-…19-*.json`：每案完整 argv、parent／child PID、deadline、elapsed、退出、wait 与输出哈希；同名 `.stdout`／`.stderr` 为原字节。
- `batch02-plan.json`：明确 AS 失败后只执行无 AS 基线和其他局部限额，不扩大候选。
- `installed-header-rlimit-macros.json`、`case-summary.json`、`post-run-checks.json`：常量、原 18 案汇总、sentinel／文件字节／既有身份不变和收尾核对；原证据不覆写。
- `batch03-cpu-counterexample-plan.json`、`case19-pre-execution-identity.json`、`final-case-summary.json`、`post-run-final-checks.json`：第 19 案计划／身份及全部 19 案最终回读。
- `build-receipt.json`、`evidence-index.json`：实际编译命令、完整证据文件清单与哈希。

原始 FSIZE 两个新文件保留在私有实现根并复制到外部证据根；没有覆盖原文件。完整产品检查、真实模型、数据库／TLS 和远端预算不属于本独立 OS 探针结果。
