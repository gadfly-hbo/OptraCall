# Pi 与开源 Agent 记忆：Phase 0／1 复用研究

2026-11-02 · 研究结论，非采用决定。依据官方文档、官方／原作者仓库和固定源码；未安装组件、下载模型、启动记忆服务、调用模型或导入业务材料。网络读取与源码下载仅用于静态研究。

## 1. 结论与原方案调整

用户指出“实际在做 Agent 记忆，应先看开源方案”，随后要求把 pi-coding-agent harness 官方能力放在同一研究中。该提醒成立：前案直接规定新增记忆存储与召回方式偏早，应先核清 SDK 和生态已有能力。

推荐按三层分工：

1. **会话记忆直接复用 Pi。** 会话 JSONL、分支、恢复、压缩、资源加载与扩展生命周期不再另建。
2. **跨会话记忆先评估现成组件。** 优先比较 Pi 生态文件记忆扩展；若有语义召回缺口，再比较 Mem0 OSS／qmd 等独立后端。OpenViking 作为覆盖更广的上下文服务候选，验证其收益与额外成本；不因“架构完整”直接引入。
3. **OptraCall 维护业务含义与权威引用。** 真实项目／Case 归属、SAP 正式口径、资料修订、报告输入、候选与人保留、实际反馈与推演性质仍须明确；能复用现成来源／版本能力就适配，不复制通用存储／检索／压缩引擎。

上述为基于本次资料的架构判断，不是性能或产品收益实测。已确认的 P01–P03 保持：双库新结构留 Phase 2、个人查找与项目数据归属分开、用两次相连工作验证复用；“四库”继续是产品逻辑分类，不倒推出四套自研底座。

## 2. Pi：已锁版本、已有能力及真实边界

### 2.1 版本和本地证据

项目 package.json、lockfile 与已安装 manifest 均为 `@earendil-works/pi-coding-agent 1.4.0`，MIT。官方 `v1.4.0` 指向 `4a080252f06caf63a525d7873c5d94d3c23887e0`；从该提交读取的 `docs/sdk.md` 与本机随包文档逐字节一致，SHA-256 `d9034ccbf2219a58712d8dd4fcdf47e687d77131e71dd5d119d8a71e9bd2a2e8`。这个比较只验证该文档，不代表整个 npm 包与源码全部逐字节审核。[固定 SDK 文档](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/docs/sdk.md)

| 能力 | 官方定义 | OptraCall 的处理 |
| --- | --- | --- |
| 保存／继续会话 | SessionManager 持有持久 entry tree 与 active leaf；默认会话可持久保存 | 沿现有 task/sessionFile 和 SessionManager，不另建会话记忆库 |
| 分支／fork／恢复 | 保留原分支，恢复上下文使用当前活动分支；可列出和读取会话 | 作为工作历史来源；列会话／读 entry 本身不等于跨 Case 相关性召回 |
| 压缩与分支摘要 | 原始记录仍在；模型请求使用摘要和保留消息；SDK 负责触发及恢复规则 | 直接复用，压缩摘要不能替代业务原件或被当作专业结论 |
| 跨会话项目约定 | agentDir／工作目录及父目录的 AGENTS／CLAUDE 上下文文件进入提示；skills 按需读取 | 稳定操作约定沿资源加载；业务事实仍作为带来源的材料，不升格成系统指令 |
| 扩展和记忆入口 | registerTool、session_start、before_agent_start、context、compaction hooks 等；appendEntry 可保存不进入模型上下文的自定义数据 | 可接查询／保留入口，不必替换 Pi；appendEntry 不自动构成长期知识召回 |

依据：[官方会话说明](https://pi.dev/docs/latest/sessions)、[压缩参考](https://pi.dev/docs/latest/compaction)、[上下文配置](https://pi.dev/docs/latest/configuration)、[SDK](https://pi.dev/docs/latest/sdk)、[扩展](https://pi.dev/docs/latest/extensions)、[entry 格式](https://pi.dev/docs/latest/session-format)。latest 页面核对于本日，并与本机相关随包文档交叉阅读；不将日后 latest 的新增能力自动算入锁定版本。

当前产品[project-session.open](../../../src/agent/project-session.ts)已经使用 SessionManager.open/create 与 createAgentSessionRuntime，并把 SDK compaction 能力投影到 snapshot；[project-history](../../../src/host/project-history.ts)从 native custom entry 读取实际回执。普通分析可以发现资源；受管任务显式 noContextFiles/noExtensions，并限制可用资源；fixed-draft 也关闭这些发现。这说明“Pi 支持某扩展”不能直接推导“所有产品 profile 已能加载它”。新记忆接线须核对 owner、取消、封闭出稿和冷读边界，不能为兼容插件全局打开资源。

本次已核对的 Pi core 文档没有承诺自动把多份业务 Case 提炼为已确认经验并跨 Case 按业务版本召回。应准确区分“SDK 会话／上下文原语”与“生态长期记忆扩展”，不笼统声称 Pi 没有记忆，也不把扩展算作默认内置。

### 2.2 同一组织的文件记忆参考

`earendil-works/pi-chat` 的实际实现使用账号级 `/shared/memory.md`、频道级 `/workspace/memory.md`，每轮提供记忆，Agent 在被要求记住时写入；另有 chat_history 工具。这是 Pi 组织下具体应用的设计先例，证明“持久文件＋作用域＋原生工具”是一条可行组织方式；它不是 coding-agent SDK 默认的通用记忆服务，也无需引入其聊天渠道、微型 VM 与运行环境。[官方仓库 Memory／Tools](https://github.com/earendil-works/pi-chat#memory)

## 3. 开源候选对照

下面“适合度”是针对当前个人工作台与既有 Pi Runtime 的判断，不是行业排名。许可仅记录查到的项目层事实，不代表递归依赖、模型或商业集成已完成审查。

| 候选 | 核验到的能力与身份 | 对 OptraCall 的判断／需补验证 |
| --- | --- | --- |
| **pi-memory-md** | MIT；Git-backed Markdown、描述／标签索引、按需读全文、项目／全局目录；固定 `3002f4e58a14c02876d1b343f4737465fc4abcb4`，包目录列 0.1.38 | 优先研究其渐进读取与文件工作流；默认 sessionStart pull、可选 push／sessionBridge 不能照搬。Git 项目作用域须映射真实业务 ID；nodejieba 等原生依赖和 Pi1.4.0 API 兼容未验。[包目录](https://pi.dev/packages/pi-memory-md)、[固定仓库](https://github.com/VandeeFeng/pi-memory-md/tree/3002f4e58a14c02876d1b343f4737465fc4abcb4) |
| **pi-memory** | MIT，0.4.2；长期 Markdown、daily log、scratchpad、可恢复删除，qmd 搜索可选；固定 `1e276a762a666a7031459fdf7af018cc7966663e` | 更接近现成 Pi 记忆工具；当前源码退出时默认另调模型写摘要，可用 `PI_MEMORY_EXIT_SUMMARY=0` 关闭。qmd 自动 update/embed 默认后台；不能当成无模型／无副作用插件原样启用。[包目录](https://pi.dev/packages/pi-memory)、[固定摘要／退出源码](https://github.com/jayzeng/pi-memory/blob/1e276a762a666a7031459fdf7af018cc7966663e/index.ts#L420-L516) |
| **Mem0 OSS** | Apache-2.0，Python 与 TS 均有 OSS；TS 入口 `mem0ai/oss`。固定 `753496cf1435d76c3a711f3af51303f7fdcb6420`，源码声明 Python2.2.1／TS3.3.1；支持抽取、检索、metadata 与历史 | 是独立后端候选，无需换 Pi；TS 默认向量库是内存，不能误认为 SQLite history 已保证向量持久化。默认 LLM／embedding 有外部调用；需固定实际持久化、scope 和模型路径。[TS 导出](https://github.com/mem0ai/mem0/blob/753496cf1435d76c3a711f3af51303f7fdcb6420/mem0-ts/package.json)、[OSS 配置](https://docs.mem0.ai/open-source/configuration) |
| **OpenViking** | v0.5.3，`178a8cdfb41b51e7d24c4bf79a13cc54981e0ee8`；服务端 AGPL-3.0、examples Apache-2.0；VFS／层次摘要／检索／记忆抽取／provenance／快照，已有官方 Pi 扩展 | 覆盖面广，值得对照，但部署与模型环节较多。插件自动捕获／召回默认开启；takeover 当前默认关闭。独立抽取有内部模型／工具循环，需按真实需要取用。[发布](https://github.com/volcengine/OpenViking/releases/tag/v0.5.3)、[Pi 扩展](https://github.com/volcengine/OpenViking/tree/178a8cdfb41b51e7d24c4bf79a13cc54981e0ee8/examples/pi-coding-agent-extension) |
| **qmd** | MIT，2.8.3，`86d2365d17fc682e491c2c53d1e4a884aee8682a`；TS＋SQLite，CLI／MCP／库，BM25／向量／扩展与重排 | 可复用检索组件，不负责决定记什么。BM25 可不调用模型，语义／重排另有模型依赖；索引含内容副本，需纳入归档／清理。若原生查找已够用，不为“有记忆”强制安装。[固定接口与源码](https://github.com/tobi/qmd/blob/86d2365d17fc682e491c2c53d1e4a884aee8682a/src/index.ts#L296-L398) |
| **LangMem** | MIT，0.0.30，`839c3fa0fc2c118734611d5d86503e52fc3a3dd1`；语义／情景／程序性记忆、主动工具写入和后台整理。Core API 不绑定存储，stateful 层依赖 LangGraph Store | 分类与触发方式值得借鉴；不能说它只能换成 LangGraph 才能用。但 Python 包本身带 LangChain／LangGraph 等依赖，为当前 TS＋Pi 引入它须证明组件收益。[概念与分层](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)、[包依赖](https://github.com/langchain-ai/langmem/blob/839c3fa0fc2c118734611d5d86503e52fc3a3dd1/pyproject.toml) |
| **Graphiti** | Apache-2.0，0.31.2，`16bf514380de4e44884aed6779bece220e6fe470`；时态实体／关系、episode 来源、有效期、混合检索 | 对未来复杂概念关系与时间变化有价值；当前需图存储、LLM／embedding 等，对简单个人经验检索成本偏高。Graphiti 是开源框架，Zep 托管能力不能全部算入。[官方仓库与依赖](https://github.com/getzep/graphiti/tree/16bf514380de4e44884aed6779bece220e6fe470) |
| **Letta／MemGPT** | 旧 Python V1 已归 archive；当前 Letta-code 0.34.38，`6155d9f562f13eb1f352240a7fd07a87933ac76a`，Apache-2.0（品牌排除）。MemFS 为 Git＋Markdown，当前 harness 自管执行与生命周期 | 学习少量常驻信息、目录渐进读和版本化；直接接对话接口会带另一套运行时。本次未查到当前可即插即用的通用 memory-only SDK；旧 blocks/archival API 不能当现版本默认能力。[入口仓库](https://github.com/letta-ai/letta/blob/8816d3a8516893bfdc0fa14bfb1235226012e295/README.md)、[MemFS](https://docs.letta.com/concepts/memfs)、[App Server](https://docs.letta.com/self-hosting/app-server) |

Pi Packages 是分发目录。pi-memory／pi-memory-md 在目录可见，不代表由 Pi 核心团队维护或已包含在 SDK；目录也明确要求安装前审查第三方源代码。

## 4. 关键发现：避免按旧印象选型

### 4.1 Mem0 的 OSS、云插件与历史不能混淆

官方 Pi 插件使用 `new MemoryClient({apiKey})`，接 **Mem0 Platform 云**；不是 OSS `Memory`。自动捕获与检索注入可分别关闭。其项目 appId 来自 git root/cwd 的 basename，不能直接当 OptraCall 真实 projectId/taskId 的隔离；Peer 版本声明也不证明兼容嵌入式 Pi1.4.0。[官方 Pi 指南](https://docs.mem0.ai/integrations/pi-agent)、[固定插件入口](https://github.com/mem0ai/mem0/blob/753496cf1435d76c3a711f3af51303f7fdcb6420/integrations/pi-agent-plugin/src/entry.ts)、[scope 源码](https://github.com/mem0ai/mem0/blob/753496cf1435d76c3a711f3af51303f7fdcb6420/integrations/pi-agent-plugin/src/memory/scoping.ts)

当前官方迁移到 V3 ADD-only 抽取，不能照旧资料说 add 会自动 UPDATE/DELETE，或 OSS 当前有完整图记忆。`infer=false` 可直接写已确定文本，但仍生成 embedding。history 有文本变更，不包含每次完整 metadata、业务文件字节和人工确认材料，不能独自当精确业务版本库。[V3 迁移](https://docs.mem0.ai/migration/oss-v2-to-v3)、[Python history](https://github.com/mem0ai/mem0/blob/753496cf1435d76c3a711f3af51303f7fdcb6420/mem0/memory/storage.py)、[TS history](https://github.com/mem0ai/mem0/blob/753496cf1435d76c3a711f3af51303f7fdcb6420/mem0-ts/src/oss/src/storage/SQLiteManager.ts)

### 4.2 OpenViking 确实已有版本与 provenance，但不能当成业务审批

固定版本已有 Snapshot commit/show/log/diff/restore、记忆更新版本数字、extraction/session/archive/task/trace 来源和 memory_diff before/after。不能笼统说它缺乏版本或出处。快照并不自动覆盖所有写入，恢复存在覆盖未提交路径的效果；历史文件快照也不等于历史向量索引／ACL 一并固定。[Snapshot API](https://github.com/volcengine/OpenViking/blob/178a8cdfb41b51e7d24c4bf79a13cc54981e0ee8/docs/en/api/11-snapshot.md)、[会话与变更记录](https://github.com/volcengine/OpenViking/blob/178a8cdfb41b51e7d24c4bf79a13cc54981e0ee8/docs/en/concepts/08-session.md)

配置源码的 takeoverEnabled=false、Working Memory=false，与部分旧文档默认开启的文字有差异；autoCapture/autoRecall=true。应按固定版本核对开关，不通过接管 Pi 上下文解决简单记忆查询。主项目许可与 examples 不同，README 还有额外重写／翻译声明；这里仅记录事实，未作法律可用性结论。[配置 schema](https://github.com/volcengine/OpenViking/blob/178a8cdfb41b51e7d24c4bf79a13cc54981e0ee8/examples/memory-plugin-shared/lib/config-schema.mjs)、[LICENSE](https://github.com/volcengine/OpenViking/blob/178a8cdfb41b51e7d24c4bf79a13cc54981e0ee8/LICENSE)、[组件说明](https://github.com/volcengine/OpenViking/blob/178a8cdfb41b51e7d24c4bf79a13cc54981e0ee8/README.md#license)

### 4.3 文件记忆也可能有自动调用与同步

pi-memory 当前源码的退出摘要默认开启，调用 pi-ai complete；真实退出和 reload/new/resume/fork 的处理还不一样。仅因主体是 Markdown 不能宣称它没有额外模型调用。pi-memory-md 默认会话开始拉 Git；push 与 sessionBridge 有独立开关。研究参考可复用，不代表按其默认全量安装／自动运行。[pi-memory 退出行为](https://github.com/jayzeng/pi-memory/blob/1e276a762a666a7031459fdf7af018cc7966663e/index.ts#L1497-L1574)、[pi-memory-md hooks](https://github.com/VandeeFeng/pi-memory-md/blob/3002f4e58a14c02876d1b343f4737465fc4abcb4/README.md#hooks)

## 5. 对本次落地路线的修订建议

**第一优先：Pi 原生＋文件式长期记忆的窄接入。** 优先比较两种 Pi 生态扩展的工具／索引／文件组织，保留项目现有会话和取消合同。先核对 Pi1.4.0 API、业务项目 scope、是否能关闭额外模型／同步／默认注入、能否给受管任务提供受限接口；根据实际缺口选择复用、最小适配或仅借鉴。第三方包目前均未证明可直接装入产品。

**第二优先：需要更强召回时比较 Mem0 OSS TS 与 qmd。** 用固定中文案例检查异词表达、修订纠错、反例／过期、同名项目隔离和来源读回，再看是否比现有文件检索有实质收益。模型抽取、embedding／重排调用必须计入真实配置与授权，不能绕过 Host 生命周期／数据出口记录。不能由研究本身启动新真实模型实验。

**OpenViking 为更广覆盖备选。** 如果实际需要上下文资源管理、层次摘要及记忆版本服务，再评估可否复用其服务；优先受限查询，单独决定是否开放捕获、抽取与整理。Graphiti、LangMem、Letta 主要作为机制参考或真实复杂需求下的候选，不为本轮重建运行时／图平台。

OptraCall 本轮仍需要表达的产品合同：谁保留了哪条知识／经验、依据哪个资料或报告版本、适用哪个业务范围、是否有真实反馈、当前是否归档／冲突，以及实际向 Agent 提供过什么。这些可以映射到选中组件的文件、metadata、版本和来源能力，不预先写成必须新建的通用资产数据库。

阶段性验收仍是 Case A 留下可靠来源和少量经验，Case B 实际找回、核对并复用；增加“哪些能力由 Pi／选中组件承担”的逐项证据。数据目录与业务口径属于业务材料基础，长期经验属于 Agent 记忆；两者关联，但不能把原始数据、指标发布与全部会话都交给模型自动摘要后当作权威。

## 6. 未运行与证据限制

- 未安装／导入任何候选、修改依赖、加载 Pi 插件、运行组件测试或迁移；只读源码不是运行兼容证明。
- 未测中文召回、延迟、磁盘／内存、模型费用、macOS 原生依赖、取消与迟到写入、业务权限／归档或历史版本一致性。
- 上游 main 与已发布 npm／PyPI 字节不同，研究固定源码不能自动证明发布包内容。Pi SDK 仅一份官方文档与随包字节交叉比对。
- 未用官网 benchmark 百分比、stars 或宣传性能替代 OptraCall 的样本验证；未作全量许可证或模型再分发审查。
- 原始分项研究和读取清单位于本机 `.local/agent-memory-research/`（mem0.md、letta-qmd.md、openviking.md、root-sources/manifest.json），公开结论均附官方链接，不包含业务资料／凭据。

本轮研究完成后，原结构包保持未批准，相关技术路线按本文重新整理；没有新增结构批准、采用、模型调用或 Git／设备交付授权。
