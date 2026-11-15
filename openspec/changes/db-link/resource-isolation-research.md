# db-link：本地执行资源隔离调研

2026-11-14。**只读官方资料研究；保留硬准入，未选定、引入或验证新组件。** 用户最新方向为“保留硬准入，先评估成熟的资源隔离方案”。本文件不改已批准 spec、驱动、Pi `1.4.0`、Interface v3 或 parser 决定，不调整当前 `queryQualified=false`。没有安装、启动组件／服务／数据库、执行模型或业务 SQL，也未对 MacBook 作操作。

## 目标、范围与结果

- [x] 按[工程规范四原则](../../../docs/engineering-workflow.md#四点产品原则)核对职责及复用边界，读取[执行资源决定](execution-resource-decision.md)与[驱动补充](driver-selection.md)。
- [x] 核对无需容器的 Node／macOS 公开能力，再比较 Apple container、Docker 资源限制及 Colima／Lima 本地部署路径。
- [x] 分清 guest、macOS 关联进程、并发总量、本地截止和远端终结，列出证据、未知及最小后续验证。
- [x] 仅新增本研究文件；组件与镜像的精确版本、安装／运行、实现和实验均留待后续决定。

已有有限驱动候选在 PG `18.1`／MySQL `8.4.0` 的第三轮真实检查为 19/19；前两轮失败及修复保留。这个事实来自本项目[资源决定](execution-resource-decision.md)，不是本研究重测。当前两个独立缺口为：官方驱动在回调前完整解码单值，事后 `maxCellBytes` 不能约束此前本地内存；MySQL `max_execution_time` 不提供整个 PREPARE 阶段的远端总截止。本地隔离可针对前一项提供成熟的强制资源域，**没有一个本地候选能单独补齐后一项**。

## 结论与候选顺序

**先保留一个很小的无需容器可行性检查，再考虑已有 VM／容器产品。** Node Worker 或独立子进程本身不提供所需完整内存上限；macOS 的公开 `RLIMIT_AS` 值得验证，但现在只证明存在地址空间限制实现，未证明目标 Node 在产品内存预算下可运行。不能据此宣称无需容器路径已成功，也不能照旧资料一概声称 macOS 没有此机制。[Node Worker][N1]、[XNU setrlimit][O1]、[XNU VM][O2]

对于已知 **Apple silicon＋macOS 26.3.1** 的 Mac mini，Apple 官方 `container` 是值得优先验证的原生候选：每容器一个 Linux VM，并有公开 guest 内存／CPU 配置和生命周期命令。若更需要成熟的每工作负载 CPU 配额与 Linux 内存控制证据，则 Docker Engine 的 cgroup 路径更明确；它可由 Docker Desktop 提供，或经 Colima／Lima 提供。后两者是部署选项，不是三套都要引入。直接以 Virtualization.framework 自建 VM 管理器需要额外维护 guest 引导、镜像、网络和收尾，不是本次最小建议。[Apple 架构][A2]、[Apple 资源][A3]、[Docker 约束][D1]、[Colima][C1]、[Apple VM 示例][A7]

这只是下一轮验证的排序。Apple／Docker 等官方能力的存在，不能代替 OptraCall 的精确组件身份、实际负载、Host 通道及远端取消实证。所有候选都保持原 `owner/operation/lease` 归属；DB worker 只执行已授权数据库工作，不建立新 Agent Runtime，不改变 Agent 选择 SQL／参数／方法的权利，不改官方驱动或 SDK，不自研数据库 wire parser、业务 SQL 重写或固定查询库。

## 1. 先明确需要约束的资源

| 资源域 | 可审查的定义／后续要证明的事实 | 不应混为一谈 |
| --- | --- | --- |
| 单 operation 的解码执行域 | 官方驱动、TLS、协议接收、JS 字符串、Buffer／ArrayBuffer、原生分配和结果编码均放入被限制的进程或 guest；超限允许本操作失败 | 事后字段检查不是解码前逐 field 精确上限；限制 guest 总内存也不是承诺大字段一定成功 |
| guest／cgroup | 明确内存额、swap、进程数、CPU 配额或 vCPU 数、结果临时空间，以及超限后的失败与退出证据 | JS heap、进程 RSS、Linux cgroup 计费、guest 可见物理内存是不同量 |
| macOS Host | 原 Host 自身、IPC／stdout 接收与编码、VM 进程、网络／文件共享 helper、镜像／日志服务的附加内存分别记录；结果不能以无界对象整批回灌 Host | guest 配置值不是所有 macOS 关联进程的总 RSS 上限；Host 轮询 RSS 后 kill 不是预分配上限 |
| 并发与设备总量 | 在已有公共资源准入中，以最大活动数和每个执行域预算预留设备余量；把共享 VM 基线与每 operation 增量分开核算 | N 个均合格 worker 的总量仍会过大；单个容器参数不能决定整机容量 |
| 时间／I/O | 分别指定本地墙钟截止、累计 CPU 时间或速率、结果总字节、单文件／临时空间、磁盘速率／网络速率是否受控 | 文件大小不是 I/O 带宽；CPU 配额不是墙钟截止；本地停止不是远端查询停止 |

这是**供下一轮审查的分层描述**，没有变更当前已批硬准入。成熟机制的工程上限应按其官方执行语义验证并保留例外：例如 Linux `memory.max` 会在回收失败时触发该 cgroup 的 OOM 处理，官方也记录特定情况可短时超限；不应因此把成熟机制一概判为不可用，也不能承诺精确到零字节超调。VM guest 内存与 macOS 额外开销同理必须分别计入。[Linux cgroup v2][L1]、[Apple memorySize][A6]

## 2. 无需容器的能力：有用，但当前不能直接准入

| 主张 | 官方证据 | 无法证明／决定 |
| --- | --- | --- |
| `worker_threads.resourceLimits` 可限制 V8 引擎部分堆与栈 | Node 明确排除 external data／ArrayBuffer，进程仍可能因全局 OOM 中止。[N1] | 不覆盖驱动 Buffer、TLS 等全部分配；Worker 与 Host 共进程，不能补当前内存缺口 |
| `--max-old-space-size` 可辅助压低老生代 heap | Node 将其定义为 V8 old space 大小。[N5] | 不等于 RSS 或总 native／Buffer 上限，不能单独晋级准入 |
| `child_process.spawn/fork` 可将崩溃和本地终止移到独立进程 | 公开 API 有 timeout／AbortSignal／killSignal；`maxBuffer` 只约束特定 API 收集的 stdout／stderr。[N2] | API 没有总内存、CPU、磁盘／网络 I/O 配额参数；独立进程还需 OS 强制限制；发出 kill 信号不等于观察到退出，更不是远端终结 |
| `setrlimit`／已有 OS 启动能力有无需新服务的可能 | Apple 公开 XNU `xnu-12377.81.4` 的 `RLIMIT_AS` 分支调用 `vm_map_set_size_limit`；当前 main 的 VM 映射超过限制时返回 `KERN_NO_SPACE`。[O1][O2] | **地址空间上限，不是可直接换算的物理内存额度。** 限制必须在数据库首次接收前成功设置，覆盖实际 Node 分配路径；预算下的可用性与失败方式未证明 |
| `RLIMIT_CPU`／`RLIMIT_FSIZE` 提供局部限制 | Apple 的归档 man page 定义累计 CPU 秒、单文件大小及继承语义。[O3] | 归档资料不能独立证明 macOS 26.3.1 当前行为；CPU 秒不是墙钟，单文件不是目录总量或带宽，也不覆盖远端数据库 |

**RLIMIT_AS 的版本与可用性保留 UNKNOWN。** 本次仅只读 `uname -a`，得到 Mac mini 内核 `25.3.0`／`xnu-12377.91.3~2`／`arm64`；官方同名 `xnu-12377.91.3` raw 源码地址返回 404，未获得与实机完全相同的源码身份。上面的 `.81.4` 和 main 不能冒充同版本证明。当前 main 头文件还把 `RLIMIT_RSS` 定义为 `RLIMIT_AS` 兼容别名，而 Apple 旧 man page 的 RSS 说明偏向内存紧张时回收偏好；不能仅看名称或旧文断言它是当前 RSS 硬限额。[XNU header][O4]、[归档 man][O3]

Node／V8 会使用虚拟保留区域：Node `25.9.0` 文档明确某些 WebAssembly 内存路径的 trap-handler 需要约 10GB 虚拟 cage，并展示地址空间不足时失败。这只证明“虚拟额度与驻留预算不能直接等同”；不表示纯 JS DB worker 一定触发 Wasm，也不表示目标 Node 必然启用某种 pointer-compression cage。目标二进制的启动、V8 保留映射、驱动／TLS 与正常结果能否在拟定额度工作，应实际测量；不能写成“设 512MiB 就能用”。不为绕过这个问题擅自替换／重编 Node、关闭 SDK 能力或依赖内部内存接口。[Node CLI][N3]

因此无需容器路径的合理下一步，是**获准后进行一个隔离合成可行性探针**。若原系统公开能力能在合适预算运行官方驱动且超限确实被内核阻断，它可能免去 VM／容器常驻服务；现在不把它淘汰，也不把它当成已证明方案。仅靠定时查看 `process.memoryUsage()` 再终止应淘汰：观测发生在分配后；Node 还明确 Buffer 包含在 `arrayBuffers/external`，Worker 的 RSS 为整个进程。[Node memoryUsage][N4]

## 3. 相关成熟 VM／容器能力比较

下表依据 2026-11-14 读取的官方公开文档。引用 main／在线文档只证明查阅时能力，**不选择精确版本**；Apple 本身也提醒当前分支文档须在采用时换为目标 release tag 复核。[A2]

| 维度 | Apple `container` | Docker Engine，通常由 Desktop 或 Colima／Lima 提供 |
| --- | --- | --- |
| macOS／ARM64 条件 | Apple silicon、macOS 26+；符合已知 Mac mini 前提。MacBook 的 OS／架构未读验，需届时核对。[A1] | Desktop 有 Apple silicon 发行，支持当时当前及前两代 macOS；Colima 支持 Apple silicon，Lima VZ 要求 macOS 13+，VZ guest 架构须与 Host 匹配。[D3][C1][C2] |
| 单 operation 内存域 | 每容器独立 Linux VM；`--memory` 配置 guest 内存。将驱动解码留在该 VM，可把增长限制在 guest 可用内存域内，超限失败路径待实证。[A2][A3] | `--memory` 对 Linux cgroup 施加强制内存限制；`--memory-swap` 与 memory 相同可禁止该容器 swap。OOM 行为有官方合同，controller 实际可用性仍要检查。[D1][L1] |
| 范围与额外内存 | guest OS、驱动及 guest 缓存消耗该 guest 内存；VZ `memorySize` 是 guest 识别的物理内存，不是 macOS 总 RSS；API/helper 另计。[A6] | cgroup 包括其计费范围内的进程／缓存；Linux VM、engine、网络／共享目录 helper 的 macOS 开销另计。Desktop／Colima 另有共享 VM 内存额度。[L1][D2][C1] |
| CPU | `--cpus` 是分配的 vCPU 数，不能当成 Docker 的分数 CPU 节流比例；公开 ulimit 有累计 CPU 时间选项。[A3][A4] | `--cpus`／quota-period 提供 Linux 调度配额；shares 为权重，不是硬上限。VM 层 CPU 数另计。[D1][D2] |
| 本地墙钟 | 有 `stop` signal＋超时后 SIGKILL；该超时是**请求停止之后的宽限期**，不是从查询起算的运行期限。[A5] | 同样有 stop signal／grace／SIGKILL，`wait` 可观察容器停止；不是自动的查询绝对截止。[D5][D6] |
| I/O | 公开 CLI 支持只读 rootfs、tmpfs、volume、单文件 ulimit；stats 的 I/O 是观测。所查文档没有证明适合本场景的磁盘／网络每 operation 硬速率控制。[A4][A5] | 有设备级读写 BPS／IOPS，blkio 权重只针对 direct I/O；Linux io controller 依赖实际设备／文件系统，允许短时 burst。[D4][L1] |
| 最小产品部署 | 已安装官方 CLI、kernel、ARM64 OCI worker 镜像与后台服务；不是“系统自带、零依赖”。按已授权环境首次配置后，Host 可经 CLI 自动启动／停止所属容器。[A1][A5] | Desktop 需应用／VM／engine、条款接受；Colima 路径需 Colima、Lima、VM 镜像、engine 与 Docker CLI。Host 可自动操作已配置实例，不需要用户每条查询开关容器。[D3][C1] |
| 成熟性与剩余验证 | Apple 官方组件、公开 API／CLI，有 release；不以官方身份替代精确发行、网络／TLS、OOM、重启残留和产品打包验证。[A1][A2] | cgroup 资源限制证据更完整；多层组件、全局 context／socket、Desktop 商业许可和 guest I/O 路径增加部署核对项。[D1][D3][C1] |

**墙钟**应由既有 Host operation 在工作开始前绑定到所有阶段，使用成熟 API 停止精确所属 worker／容器，并观察实际退出；它是必要的最小环境接缝，不需要第二个全局队列或第二套 Agent Runtime。Host 调度暂停、设备睡眠、API 服务不可达与原进程未退出时仍要保留未收尾事实，不能把“超时已触发”写成资源已经释放。

**I/O**至少拆成结果总字节、临时空间、磁盘带宽、网络带宽四项。Docker 的 Linux 设备限速不能直接推出 macOS bind mount／VirtioFS 也受同一限制；容器网络也不是该 block-I/O controller 的对象。这些路径当前均未实测。若硬准入实际要求磁盘／网络速率上限，必须把真实挂载与网络路径列为专门验证；若只要求有界结果与临时空间，则沿原文件预算验证，不应擅自把范围升级成整机所有 I/O 保证。[Docker block I/O][D4]、[Linux io controller][L1]

**并发**不是容器工具替 Host 完成的决定。Apple 文档明确允许单个或多个 VM 的 CPU／内存配置超过物理容量；应沿原公共 operation 准入限定最大活动量并留足 macOS 余量。Docker／Colima 共享 VM 的额度是总 guest 层额度，单 operation 限制仍应独立；不能因共享 VM 有顶就容许一个 operation 吞掉其他操作。[Apple overcommit][A3]、[Docker VM 资源][D2]、[Colima VM][C1]

## 4. 配置、自动化与商业分发

| 路径 | 初次环境动作及后续自动化 | 商业分发的已知事实与未完成项 |
| --- | --- | --- |
| 原生进程＋OS 限制 | 原系统能力无需常驻 VM；Host 后续可自动创建所属进程。OS 版本／Node 二进制／限额设置成功及继承必须实证；不能用全局 `launchctl limit` 影响用户其他进程来替代私有域 | 不增加容器发行物，但 Node、驱动及现有应用发布义务仍沿原依赖；本研究未修改打包合同 |
| Apple container | 官方签名安装包会要求管理员权限写 `/usr/local`；服务通过 launchd／API helpers 工作，首次 kernel 设置默认可提示用户，公开选项可在获准部署时预配置。运行无需每查询确认；镜像／kernel 拉取与升级不等于每次查询行为。[A1][A2][A5] | container 项目为 Apache-2.0，允许按许可证条件再分发；这不覆盖所有 Linux kernel、guest 镜像、Node 与传递组件的许可证。完整发布物、NOTICE／源码等义务需按实际包清单核查，不从 CLI 许可证推断全部可直接嵌入。[Apple LICENSE][A8] |
| Docker Desktop | 一次安装与接受条款，使用 Apple silicon 发行；可经公开 CLI／API 管理本地 worker。无需为 db-link 打开 Kubernetes、模型服务或其他功能。[D3][D5] | Desktop 不是 Apache-2.0 的 Docker CLI。官方协议按用途／组织规模设订阅条件，并限制向第三方分发 Services；不能直接把 Desktop 嵌进商业产品再分发视为已授权。[Docker 条款][D7] |
| Colima＋Lima＋Docker Engine | 可创建专属 VM/profile、设 CPU／内存／磁盘；Docker runtime 需要 Docker CLI。Lima 有用户登录自动启动路径，系统开机守护则另需管理员配置；不意味着必须给每次查询增加手动步骤。[C1][C3] | Colima 为 MIT，Lima、Docker CLI、Moby 为 Apache-2.0；此路径无需以 Desktop 的发行许可作为依据。实际 guest、engine 发行和全部依赖仍须逐项清单核查，不能说“全链路没有许可要求”。[C4][C5][D8][D9] |

直接使用 Virtualization.framework 是 Apple 提供的公开底层能力，需要 virtualization entitlement，应用自行提供 Linux 镜像与设备配置。其 `memorySize/cpuCount` 可复用，但本研究不建议为了绕过现成产品的初次配置而自建 VM 产品；框架使用／签名及实际 guest 的完整分发安排本轮未完成审查。[Apple VM 示例][A7]、[Apple VM 配置][A9]

## 5. 远端数据库总截止仍需单独闭合

本地进程／容器／VM 的资源限制只作用于本地；观察到其实际终止，才可证明该本地 worker 不能继续运行或收包。远端 MySQL／PostgreSQL 是另一资源域，其 CPU、磁盘、锁与会话不会自动受本地 cgroup 或 VM 配置控制。将测试数据库也装进同一个本地 VM 再 kill，不能证明用户实际远端数据库的查询被终结。

MySQL 8.4 文档把 `max_execution_time` 定义为适用只读 SELECT 的执行超时，没有给整个 PREPARE 阶段总截止保证；`KILL` 是置标志，服务器在检查点处理，命令返回不等待确认，清理另花时间。因此“本地截止→断 socket／kill worker”以及“控制连接收到 KILL 应答”都不能补当前 `db_prepare_total_budget_unenforced`。仍需针对原会话身份、同节点路由、PREPARE／执行阶段、取消／清理及断线 UNKNOWN 单独研究和证明；不得按缓存 connection ID 盲重试或自动重放 SQL。[MySQL timeout][R1]、[MySQL KILL][R2]、[原驱动取消合同](driver-selection.md#4-查询取消从请求到远端终结)

PostgreSQL 官方 `statement_timeout` 对 extended protocol 的 Parse／Bind／Execute／Describe 起算语义较明确，但其不可绕过配置和所属取消证据仍沿当前候选与部署合同核验。它不能为 MySQL 提供等价证明，容器化也不改变这点。[PostgreSQL timeout][R3]

## 6. 后续最小验证建议与淘汰条件

**以下仅是待确认方案，不在本轮运行。** 不先安装多个候选，也不因研究结论擅自选择 runtime／kernel／镜像的精确版本；用户确定增量后，再冻结对应官方发行物和预算。

| 顺序 | 最小隔离合成探针 | 保留／淘汰条件 |
| --- | --- | --- |
| 1. 无容器快速可行性 | 对目标 macOS／ARM64／实际 Node 官方二进制验证 pre-exec OS hard limit：启动与 TLS／官方驱动正常路径、JS heap、单个巨大 Buffer／ArrayBuffer、字符串解码、原生分配、已保留地址空间；记录 AS、RSS／footprint、设置失败、退出／分配失败与父 Host 存活 | 在需要的驻留预算下无法启动，必须给出远大于设备容量的 AS，或任一实际分配路径无约束，则淘汰它作为本地内存主边界。普通样本通过只证明可行，不能泛化为全部分配已受控 |
| 2. 仅选一种 VM／容器 | 先证官方组件身份／ARM64 guest；以同一官方驱动作巨大单值、连续块、慢消费／背压、guest 内存耗尽、CPU 密集、临时盘／结果满、停止超时。观察 guest／cgroup 强制事实、VM／helper 总开销、Host 通道峰值及原 pending 文件保全 | 限制只是监测、未生效、超限拖垮 Host、结果整批回灌 Host，或清理错 owner／原件，则不准入；真实 OOM 使所属操作明确失败且原 Host 可继续，可作为预期行为记录，不把失败掩盖成成功 |
| 3. 设备总预算／恢复 | 按拟定最大并发叠加正常与恶意合成负载；量共享服务基线与每 worker 增量，覆盖服务退出、Host 退出、设备睡眠／恢复、无服务／无镜像、离线启动与残留资源发现 | 无整体容量余量、必须逐查询手动启停、会自动重放、无法证明所属收尾，则回到方案；保留 UNKNOWN 与占用，不靠重启清掉证据 |
| 4. 远端独立关卡 | 在另一个受控合成 DB 上覆盖 PREPARE／执行／锁等待、控制通道失败、断线、路由／身份竞态与实际远端结束；独立记录本地退出及服务端事实 | 任一阶段只有本地 kill 或 KILL 回应，没有已批合同所需远端总预算／结束证据，MySQL 保持不合格；本地内存通过不解除此门槛 |

若后续采用容器，最小接缝只应把原 operation 的 DB 执行资源放入该资源域，保留同一公共生命周期／取消／占用和原精确结果文件合同。Host 一次配置并自动执行预算、启动、健康检查与所属停止；Agent 自主选 SQL、分批和纠错。不得为了资源隔离引入第二个 Pi、SQL 代理／解析重写平台、通用作业编排器或要求用户逐查询配置。

**本轮判定：** 研究完成；无需容器路径可行性 UNKNOWN；Apple container／Docker cgroup 为有直接官方能力依据的本地强制隔离候选，产品整合、整体资源预算与真实故障验证均 NOT_PROVED；MySQL PREPARE 远端总截止／收尾缺口仍未解决。保持原硬准入与原 FAIL／UNKNOWN，不宣称“全部已满足”。

## 官方来源（查阅日 2026-11-14）

本文仅使用官方文档／源码；`.81.4` 是研究源码身份，Node `25.9.0` 是沿原驱动补充查证公开契约的文档身份，均不构成升级或新采用决定。main／master／在线文档可能继续变化，采用时必须按用户选定精确版本复核。

[N1]: https://nodejs.org/download/release/v25.9.0/docs/api/worker_threads.html#new-workerfilename-options
[N2]: https://nodejs.org/download/release/v25.9.0/docs/api/child_process.html
[N3]: https://nodejs.org/download/release/v25.9.0/docs/api/cli.html#--disable-wasm-trap-handler
[N4]: https://nodejs.org/download/release/v25.9.0/docs/api/process.html#processmemoryusage
[N5]: https://nodejs.org/download/release/v25.9.0/docs/api/cli.html#--max-old-space-sizesize-in-mib
[O1]: https://github.com/apple-oss-distributions/xnu/blob/xnu-12377.81.4/bsd/kern/kern_resource.c#L1554-L1567
[O2]: https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/vm/vm_map.c
[O3]: https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/getrlimit.2.html
[O4]: https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/resource.h
[A1]: https://github.com/apple/container/blob/main/README.md
[A2]: https://github.com/apple/container/blob/main/docs/technical-overview.md
[A3]: https://github.com/apple/container/blob/main/docs/resource-usage.md
[A4]: https://github.com/apple/container/blob/main/docs/ulimits.md
[A5]: https://github.com/apple/container/blob/main/docs/command-reference.md
[A6]: https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/memorysize
[A7]: https://developer.apple.com/documentation/virtualization/creating-and-running-a-linux-virtual-machine
[A8]: https://github.com/apple/container/blob/main/LICENSE
[A9]: https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration
[D1]: https://docs.docker.com/engine/containers/resource_constraints/
[D2]: https://docs.docker.com/desktop/settings-and-maintenance/settings/#vm-resources
[D3]: https://docs.docker.com/desktop/setup/install/mac-install/
[D4]: https://docs.docker.com/engine/containers/run/#block-io-bandwidth-blkio-constraint
[D5]: https://docs.docker.com/reference/cli/docker/container/stop/
[D6]: https://docs.docker.com/reference/cli/docker/container/wait/
[D7]: https://www.docker.com/legal/docker-subscription-service-agreement/
[D8]: https://github.com/docker/cli/blob/master/LICENSE
[D9]: https://github.com/moby/moby/blob/master/LICENSE
[C1]: https://github.com/abiosoft/colima/blob/main/README.md
[C2]: https://lima-vm.io/docs/config/vmtype/vz/
[C3]: https://lima-vm.io/docs/usage/autostart/
[C4]: https://github.com/abiosoft/colima/blob/main/LICENSE
[C5]: https://github.com/lima-vm/lima/blob/master/LICENSE
[L1]: https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html
[R1]: https://dev.mysql.com/doc/refman/8.4/en/server-system-variables.html#sysvar_max_execution_time
[R2]: https://dev.mysql.com/doc/refman/8.4/en/kill.html
[R3]: https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-STATEMENT-TIMEOUT
