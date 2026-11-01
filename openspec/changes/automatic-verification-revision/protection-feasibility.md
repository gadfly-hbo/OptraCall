# 原件保护：实施前可行性诊断

2026-11-01（Asia/Shanghai）。范围仅为新建合成目录中的操作系统权限、SDK原生持久化和本地TCP诊断；没有读写真实项目/会话，没有产品代码、配置或模型请求，没有切换服务。此页不代表原件保护已经完成产品验收。

## 已证事实与保留的失败

本机macOS 26.3.1(a)、arm64存在`/usr/bin/sandbox-exec`；Apple本机man标记DEPRECATED，不把它当成跨平台或永久稳定的接口。限制会继承给新子进程，但不能收回已继承的可写文件描述符，也不保护经已有外部进程代理执行的操作。

| 诊断 | 观察 | 限度 |
| --- | --- | --- |
| 基础写边界8项 | Python新文件计算成功；原件覆盖/删除/递归删除、符号链接越界、新建越界硬链接及子进程覆盖均被拒绝 | **预先存在的硬链接写入成功，合成原件被改。FAIL原样保留**；不能仅靠路径profile宣称安全 |
| 默认拒绝profile | 不放行Mach/网络时，Python及shell子进程计算可运行 | 不证明真实模型、MCP或所有依赖可用 |
| SDK单独11项 | SDK1.4.0公开`SessionManager.open(copy,stageDir,cwdOverride)`保留v3同session ID、完整header/parent/上下文与原始前缀，实际追加原生记录 | 不证明公共生命周期、回执或OS联合保护 |
| OS+SDK联合14项 | 默认拒绝profile下Node/SDK同会话续接、写新计算文件成功；原native覆盖、源覆盖/删除被拒；Host追加实际SDK字节尾后与执行文件一致 | 没有模型、MCP、部分写、崩溃或真实accepted回执测试 |
| OS+SDK独立新根复跑14项 | 可复跑脚本在全新合成根重现相同有界结果 | 不是补跑旧FAIL变绿；硬链接失败仍保留 |
| 网络profile语法 | 数字地址字符串`127.0.0.1:port`被本机编译器拒绝，不能据此拼出生产策略 | 该失败诊断单列，不冒充产品RED |
| 专用本地端口 | `localhost:端口A`可连接新建合成监听；邻近的端口B立即EPERM | 只证明端口边界；尚未实现Provider转发，不证明HTTP流、鉴权、重定向及真实线路 |

证据均在本机`.local/automatic-verification-revision/implementation-preflight/`：

- `protection-probe-20261101T003256482536Z/result.json`：8项及硬链接FAIL。
- `deny-default-probe-20261101T003427588992Z/result.json`。
- `sdk-proof-2026-11-01T00-34-38-957Z-6d07c5/result.json`：11项。
- `os-sdk-proof-2026-11-01T00-37-58-790Z-e6d33f/result.json`、同目录`reproduce.mjs`：联合14项及复跑入口。
- `os-sdk-replay-2026-11-01T00-38-33-068Z-e30862/result.json`：新根复跑。
- `network-boundary-probe-20261101T003739423639Z/result.json`：语法失败。
- `network-localhost-probe-20261101T003837507151Z/result.json`：专用端口可达、另一端口拒绝。

## 原候选保护合同（已撤下）

以下是独立复核前的候选，不属于当前待批准的推荐方案。复核指出：工具与SDK共享可写执行journal时，工具可以保留旧前缀并伪造新增尾；前缀/SHA不证明新增记录来自SDK。新合成反例`journal-forgery-counterexample-20261101T004612931775Z/result.json`已复现这一点，旧候选不进入实现。SDK11项、联合14项及端口探针继续按原范围保留，不扩大为防伪造证明。原候选决定稿另存`implementation-preflight/structure-decisions-draft-1.md`。

1. 自动核算/返修使用Host新建的私有执行目录，固定源与旧稿在不可写部分；计算、新稿、临时文件及SDK执行缓存分别在批准的新增可写目录。复制字节，不使用硬链接；启动前核目录真实路径、链接与inode/nlink，拒绝可写区内的预存符号链接/硬链接和越界别名。普通分析原有全工具策略不变。
2. 从worker进程外施加默认拒绝权限，覆盖原生工具、代码执行和新建子进程；不得继承原件/原native可写FD。只授予本轮新输出所需写权限，不授予AppleEvents、已有代理进程、任意Mach服务、Host管理API或资产发布/经营操作。
3. 为保留模型能力而不开放管理接口，受限worker只可连接本轮专用的Provider传输端口。Host传输只转发本次捕获配置的固定上游/API路径，原模型、协议和上游线路不变；拒绝任意目标、CONNECT、业务/文件API与重定向。真实密钥留在Host，worker仅有本轮临时能力凭据。该通道是待实现的网络权限措施，不是新的Agent工具或推理Runtime。
4. 自动受保护阶段不连接已有/远程MCP服务，不启动可逃出边界的执行扩展；可使用原生Python/bash/文件工具、只读skills和继承限制的新本地子进程。能力不足时保留未知，不静默退回无保护。该限制只约束自动核算/返修资源，不收窄普通分析/原手动功能。
5. 原native仍是唯一权威，task.sessionFile不变。受限worker在同session的逐字节执行缓存上由SDK追加，Host只传输真实SDK完整JSONL尾，不构造assistant或重写旧历史。提交前核基线长度/SHA、完整前缀和实际请求；fsync后才承认canonical回执。冲突/部分提交/崩溃保留UNKNOWN及现场，不恢复覆盖或重放。

## 当前推荐：SDK唯写历史，Agent代码隔离执行

保留一个原Pi SDK Runtime和同一原会话。可信SDK驱动直接使用原生SessionManager写canonical，不引入执行native副本、Host字节尾导入或Provider relay。Agent可执行工具全部交给同一受限工具进程，不能读写journal/凭据，也不能借网络/Mach/AppleEvents操作已有代理。模型仍由可信SDK沿原Provider/模型/线路调用，不把密钥放进执行器。

read/edit/write/bash、Python、codemode任意代码和动态/间接工具均须经过边界；可信驱动不执行Agent代码、不载可任意执行的用户扩展。IPC由驱动绑定owner/阶段/toolCallId，只把返回值作为对应toolResult数据，执行器不能发会话/配置/Provider/管理事件。数据化skills和批准的只读资源可用，工具名称/参数/结果沿原生能力，不加入计算模式或专业方法。

读取白名单须覆盖系统运行库、已批准只读资源和各阶段获准资料，不把初始探针的`allow file-read*`当作产品策略。冷读只开放源/事前语义，作者资料保存首次依据后才开放；原主Agent可按权限读本项目资料，工具不能读Host native/凭据。新工作区复制不hardlink，检查链接与FD；同UID其他未受限进程的敌对改动不在隔离承诺内，已知变化即暂停，不把0700/启动扫描当并发防护。

新的SDK/执行器分离探针已在新合成根完成：Python工具20/20、实际SDK `createReadTool/createWriteTool` 21/21项为true，均为`PASS_BOUNDED`。工具可读inputs、写work、执行计算，但journal/合成凭据读写/追加、源覆盖和网络连接被拒；可信父SDK直接保存真实toolResult，同session/header/字节前缀保持，工具给出的伪造native JSON只是toolResult文本，没有变成assistant记录。

证据：`trusted-driver-replay-2026-11-01T00-49-28-395Z-6c000a/result.json`、`trusted-native-tools-proof-2026-11-01T00-50-48-122Z-e8c330/result.json`及`trusted-boundary-summary.json`。脚本可在新根复跑，保留严格环境Python启动、错误socket断言及SDK homedir依赖的原始失败；没有放宽Mach/网络或原件内容读取来制造通过。SDK路径处理需要真实HOME值，未改写HOME用途或放行其凭据内容。

两项均0真实模型/服务/产品修改。尚未证明完整codemode/MCP委派、实际tool-call对话/RPC、公共生命周期、真实accepted/settled或生产读取白名单；不能称全工具接通或全面原件保护PASS。旧缓存14项不作为当前防伪造证明。

## 实施后仍必须验证

所有原生工具和codemode/间接调用确实委派到受限进程、journal/凭据不可读写、IPC角色/owner/callId校验、原SDK真实started/accepted/settled、部分保存与重启、公共lease受控重开/停止传播、既有/远程MCP拒绝及普通功能兼容。真实模型仅用合成资料验证，工程保全与全文专业收益分开报告。

在这些联合验收完成前，不宣称全面隔离、敏感数据沙箱或原件保护PASS。无法满足合同的机器/配置明确不支持本次自动功能，不退回全工具、只读出稿或擅自切换Provider。
