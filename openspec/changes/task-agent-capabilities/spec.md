# 任务 Agent 的委派与联网能力

2026-11-03，当前分支 `codex/Host-Agent-Extension`，初始 HEAD `fa52ae2f2507309dcb204b3cef616397a19bf62d`。用户指定本分支长期负责 Host、Agent 与 Extension 协调；Codex 为唯一写入者，Qoder 在 `qoder/ext-skills` 维护 skill 本体。完成或合并单次任务不删除本分支，不改变其他工作树或运行服务。

**2026-11-04工程原位归档：** 用户已授权“合并main，并更新给到qoder的回执”；PR #30已按最终受检head squash为main `f174ebbf7dfd1eb6cd63f4be4a9a013b166d51a9`。本目录原位保留全部规格、研究、独立报告及真实FAIL/UNKNOWN；合并身份、CI、Qoder回执与运行采用分别见 [result.md](result.md) 和 [qoder-receipt.md](qoder-receipt.md)。工程合并不追认为模型全条件或用户产品验收通过。

## 依据与授权

用户转发 R1/R2 任务书并要求核实落地、给 Qoder 回执。遵守工程规范 §2–§8、IN01–IN07 及 `docs/agent-session-integration.md`。本次开展本机 Host/Agent 实施、合成 Provider 验证、适用检查和非作者复核；真实检索的供应商、凭据使用与计费路径须按 R2 的决策方案确定。没有 MacBook 操作、真实经营数据、服务切换、模型线路变更或自动合并授权。Git/CI 与运行采用分别报告。

2026-11-04用户首次明确授权“提交、推送本分支，并创建 PR、运行 CI”。交付至长期分支 `codex/Host-Agent-Extension`，PR目标为 `main`；实际head检查结果另核对。该次授权当时不包含合并、设备更新或运行服务采用；后续明确合并授权见上述归档状态，不扩大为设备或服务采用。

同日用户新增授权“deepseek不再测试，重新真实测试下minimax和MiMo”。按已交付源码 `2a6b34f`，仅以四个原MiniMax/MiMo配置各一次真实产品问答补证，不再测试DeepSeek，不换端点/模型，不改产品搜索参数；新根、先验验收、独立官方参考、300秒截止、失败保全及结果见 [重测记录](product-live-retest-validation.md)。本次补充不追溯关闭原未完成问题或扩大运行采用。

## R1：同一父生命周期中的 Pi 原生子会话

- 继续锁定 SDK 1.4.0。官方 subagent 是示例扩展，不是自动启用的 Runtime；其 CLI spawn 不继承本产品内存 Provider。1.5.0 示例无变化且有 schema 兼容变更，本期不为此升级。证据见 `sdk-research.md`。
- Interface v3、既有 project/task owner/profile 与公共 busy/retirement 权威保持；只在产品 SDK 薄层添加附属工具资源，不另建域、业务 ID、持久结构、模型循环或全局队列。每个子任务由 SDK 新建独立内存会话，共用父冻结 ModelRuntime/model/thinking；不复制父对话，不保存独立 native，不改变父指针。
- 普通项目任务及受管 ordinary 项目任务提供 `subagent`。业务 workspace、正式独立核算 protected、fixed-draft、text-only 不提供；不从拒绝回退到普通执行。受管子工具复用父 protectedTools 与 scope，执行 ID 加委派命名空间，不能绕过原件保护、drain/close 或凭据不可见边界。
- 仅前台 single/parallel/chain：工具返回前等待全部子分支完成与 dispose。父 SDK 工具信号取消传播到所有子 session；异步创建后、prompt 前再次核对取消。父 stop 先 abort，再关闭受管 scope，最后等待 SDK idle；所有子资源仍在父公共占用内。失败/未知如实回传，不补造成功或自动重放。
- 不启动 pi CLI、加载用户执行扩展、递归委派或接受任意 cwd/model/auth 参数。子会话不调用父 bindSession/UI；子进展以父原生工具事件承接，返回和保存仍经过父脱敏入口。独立上下文不等于 OS 安全隔离。

### skill 角色发现契约 v1

从父 SDK **实际已加载**的每个 `Skill.baseDir/agents/*.md` 发现，名称为 `<skill.name>/<role.name>`。不手工安装全局 agents，不扫描其他项目。每个角色用 YAML frontmatter `name`、`description`、可选 `tools`（逗号字符串或字符串数组），正文为角色指令。相对附件由 role 所属 skill 路径读取；不接受 model/cwd 覆盖。技能目录、agents 目录及角色文件须保持真实路径包含关系，不跟随越界链接；无效或同名冲突定义拒绝，不按扫描顺序覆盖。

角色 `tools` 只可收窄父当时激活工具及已接通的服务端 `web_search`；缺省继承可安全提供的父工具。显式 `tools: [read]` 不授予原生搜索，`tools: [read, web_search]` 提供只读文件与原生搜索；不提供独立 `web_fetch` 工具。子会话不加载任意执行扩展；父独有、不能在子环境提供的工具不自动注入。联网可用性以 R2 实际工具接线为准；普通 bash 可联网不等于已完成可溯源检索。目录/写权限继承父环境，受管仍走同一 scope。

```json
{"agent":"deep-research/researcher","task":"核对公开来源并给出证据"}
{"tasks":[{"agent":"deep-research/researcher","task":"调查甲"},{"agent":"deep-research/reviewer","task":"独立调查乙"}]}
{"chain":[{"agent":"deep-research/researcher","task":"调查"},{"agent":"deep-research/reviewer","task":"复查以下结果：{previous}"}]}
```

## R2：现有模型的原生检索通路（2026-11-04补充）

用户明确否定另接搜索服务的方向，要求测试现有模型自带联网能力。原5模型各一次真实Provider探针见 `native-search-validation.md`：MiniMax两模型与MiMo两模型均返回真实结构化来源；DeepSeek现有Chat Completions以422拒绝探索声明。研究候选不是产品路线，本期不新增DeepSeek独立Search/Fetch，不跨用密钥、不改端点、不默认换模型。

对普通项目任务及其附属子会话，使用同一SDK扩展钩子声明供应商原生 `web_search`：MiniMax为版本化服务端工具，MiMo为插件工具，保留原函数工具声明。由Agent自行决定是否搜索，不对每轮强制联网。正式protected、fixed-draft/text-only及专属业务workspace不开放。当前DeepSeek配置明确告知无此原生接线，不把模型口头拒答推成所有Provider线路均不支持。

SDK 1.4.0的原始流事件钩子可以观察来源，但原生assistant投影未保存搜索块、MiMo annotations；MiniMax pause_turn被当普通stop。最小适配仅用 `before_provider_request` / `provider_stream_event` / `message_end` / `context` / `agent_before_settle`：保持原生搜索响应元数据、来源及pause状态，在SDK原有settle边界按Provider pause_turn继续本次技术请求，不建立Host模型循环或重放失败请求。

新assistant可选 `optracallNativeSearch` 元数据（原文、来源投影及专用搜索usage）随SDK原JSONL追加保存，用于原生块续接和来源回读；旧assistant不回填，原历史不改写。MiniMax恢复请求必须按本次context中实际assistant顺序和正文核对后还原原始块，不用模型编造块；丢失/不符时拒绝继续。来源仅从Provider结构化URL收集，并机械追加供应商来源清单；不访问这些网页、不把来源可访问当报告正确。取消/错误不触发pause续接；同一SDK turn正常工具与搜索并存、保存/重开及下一普通消息均须回归。

查询与网页内容发往当前已选模型Provider，并可能按厂商原生工具收费，模型费用与工具费用分开。当前真实探针没有供应商结算，不能记免费。本期既有模型能力请求与该公开问题验证沿用户明确指示，运行服务不自动采用。

## 验收与修改范围

允许修改 `src/agent/` 的必要薄层、`src/host/agent-sessions.ts` 中既有公共 finish/drain 健康检查接缝、对应边界脚本/测试、统一接入/工程规范及本变更记录；不修改 Qoder deep-research 本体。公共 finish 对普通 unmanaged 资源新增附属 SDK 清理健康核对，失败沿原 operation/retirement 保留 UNKNOWN/busy；既有 optional drain 在无附属资源时仍无额外模型或执行 scope，不改变 owner/profile 或 Interface v3。

| 标识 | 可观察验收 |
| --- | --- |
| SA01 | 实际任务 SDK 以合成 Provider 调用 subagent；single/parallel/chain 均有独立角色结果，父模型/凭据继承、上下文隔离 |
| SA02 | 角色随已加载 skill 发现、命名空间、冲突/越界/非法工具与参数拒绝；工具收窄不扩大父能力 |
| SA03 | 父取消覆盖创建中和运行中子任务，全部 settle/dispose 后返回；失败不重放，父指针/历史保全、重开可用 |
| SA04 | 受管 ordinary 同 scope 的文件/bash执行及禁止越界可验；protected/固定文本/业务workspace无 subagent |
| SA05 | SDK边界、完整 npm run check、非作者完整候选复核和 Host/Agent职责复用检查；平台 SKIP、失败与缺口分别记录 |
| WEB01 | 选定路线后任务实际检索，回答引用能对应本轮工具结果，逐URL独立核验；无能力/失败如实声明 |
| WEB02 | 实际出境、凭据、费用、取消/超时/迟到结果边界；真实验证与合成工程证据分别记录 |

本阶段不新增明显 UI 变化，无需 UI Demo。R2 若涉及设置/能力入口，先确定实际影响与相称 Demo。工程验收、Git/CI、模型内容质量、用户产品验收及运行采用分别记载。

## pi-subagents 参考核查与本期选择

用户补充 https://pi.dev/packages/pi-subagents 后，核查了 npm 0.84.0 的完整发布物与公开API，见 `pi-subagents-research.md`。其前台确实是独立SDK会话，支持运行时角色注册及能力上限；但直接引入整包仍需本产品凭据/受管工具桥、配置根隔离及附属资源实际收尾核定。后台、调度、自动恢复并非本次默认授权。当前采用同类前台single/parallel/chain用法，直接复用已接入SDK及冻结ModelRuntime和原scope，不安装整包，不新增模型循环；此选择来自已验证的公开接缝缺口，不把所有subagent实现说成CLI spawn。

SDK 1.4.0 settle边界要求待处理上下文才会再次请求，单纯continue=true不够。因此MiniMax pause_turn使用带随机身份的隐藏技术custom记录让SDK调度下一请求；wire转换只删除绑定于实际原生pause回执、位置和正文都匹配的该条记录，Provider仍收到原assistant原生块及原用户问题。真实用户内容不按通用文本匹配删除。任何原块/身份/上下文不符均取消技术派发并保留失败；不把失败重放为新的搜索。
