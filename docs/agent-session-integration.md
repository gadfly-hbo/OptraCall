# Agent会话接入说明

适用Interface v1。强制接入规则的唯一来源是[工程规范IN01–IN07](engineering-workflow.md)；本说明提供类型定位、使用方法及验证入口，不维护另一套规则。准确字段和返回类型以[src/host/agent-sessions.ts](../src/host/agent-sessions.ts)导出的`AGENT_SESSION_INTERFACE_VERSION`、`AgentSessionPort`、`SessionProfile`等为准。

## 开始接入前

在当前变更规格中记录：工程规范版本、Interface版本、真实owner、Host注册位置/profile、允许修改路径、模型/工具/历史策略与验收。遇到新能力时先核对现有Interface是否表达得了，按IN06补齐适配与验收；有实质业务差异的部分留在业务模块。

实际参考入口：

- [项目任务Host接线](../src/host/server.ts)：任务绑定配置、历史/草稿、202及后台完成投影。
- [需求梳理Host适配器](../src/host/requirement-sessions.ts)：当前配置捕获、独立workspace、生成及一次修正的会话占用。
- [公共接口与实现](../src/host/agent-sessions.ts)：启动、占用、配置身份、取消/关闭及代际保护。
- [公共行为及第三合成消费者测试](../tests/agent-sessions.test.ts)：通过同一实现接入不同profile，验证状态/事件/取消的隔离。测试消费者不代表新增产品插件。

## 接入关系与类型

Host静态注册profile，用`createAgentSessionDomain(options)`创建独立域实例；项目域和需求域共用代码，各自持有owner的运行资源。Host持域管理引用，业务只获得`AgentSessionPort<Owner>`及Host核验后产生的`SessionRef<Owner>`。`AgentSessionPort`排除`name`、`ref`和`closeAll`；现有业务入口也可以继续注入更窄的业务facade，如需求的`run/withSession/stop`。

| 类型 | 用途 |
| --- | --- |
| `SessionRef<Owner>` | 不透明的内存调用资格，绑定域和owner；不表示worker已经启动，不是新的持久会话ID |
| `SessionTurn` | 实际一轮请求的`text`、`requestId`及可选`kind`、`requestFingerprint`；沿用任务内请求关联 |
| `SessionRun<Owner>` | 单turn句柄，包含`accepted`、`completion`和操作`context` |
| `SessionLease<Owner>` | 一个获准业务操作内的临时使用权，提供`run/start`与操作`context`，可以在原生同会话中执行多turn |
| `SessionContext<Owner>` | Host提供的owner、可用requestId及`isCurrent()`；用于业务写入前核对归属和代际，不由业务自填generation |
| `AgentSessionDomain<Owner>` | Host管理表面，另有注册Ref及按范围关闭能力；不传给Extension |

TypeScript类型本身不构成安全隔离。Host仍负责封闭注册、验证真实业务归属和授权；调用方拿到合法Ref也不能扩大数据、工具或经营动作权限。域与owner隔离是同进程逻辑隔离，不是进程隔离或敏感数据沙箱。

## 最小业务调用

下面是获得Host注入后的一次调用。它不构造SDK或会话管理器，不决定凭据、绝对路径或Provider。调用方仍按自己的HTTP/业务协议展示结果。

```ts
import type { AgentSessionPort, SessionRef, SessionTurn } from '../host/agent-sessions.ts';

async function runFeature(
  port: AgentSessionPort<string>,
  ref: SessionRef<string>,
  turn: SessionTurn,
) {
  const run = port.start(ref, turn);
  await run.accepted;
  return await run.completion;
}
```

导入相对路径按接入文件位置调整。对于项目消息，`accepted`之后仍按原协议返回202，由后台`completion`更新业务结果；对于需求生成，业务入口继续等到结果返回。`accepted`表示原生请求回执可读，不能拿它代替计算完成或供应商结算。

多turn用`withSession(ref, async lease => { ... })`。每次`await lease.run(turn)`等待该turn终态，业务自己决定是否进行下一轮；需求的有限格式修正只是需求业务策略。整个回调期间保持同一个捕获配置及操作占用，turn之间仍busy。一个lease最多一轮在途调用；回调结束后lease失效。漏await、抛错、取消或外泄lease按公共实现收尾，业务不能另建运行台账补救。

## profile与业务策略

`SessionProfile<Owner>`只提供现有差异：`key`、可选真实`projectId`、`configuration`、`agentOptions`、可选`admit`和能力声明`capabilities`。`configuration`同步选择配置；公共实现捕获完整快照，并在打开和后续派发前核对。`agentOptions`只交出已有获准原生参数，生产路径由公共实现创建`ProjectAgent`。

企业资料与决策看板联合接入继续使用 Interface v1。普通任务提供授权公共目录及可选材料，不改变其工具或分析方式；决策抽取在既有独立 owner/profile 声明非持久 `text-only` 能力，复用封闭文本资源路径而不加载执行扩展／技能／MCP／祖先上下文，也不续接历史或开放命令。它保留原报告 20,000 码点的显式截断合同，包装后的技术传输上限为 65,536 UTF-16；原 `fixed-draft` 的完整输入仍限 20,000。两种封闭文本能力与普通分析的差异不写入额外业务队列，实施证据见[企业资料交付记录](../openspec/changes/enterprise-business-context/delivery.md)。

Host提供`configurationSnapshot`、原有`mutate`、`isClosing`与事件`publish`。测试中的`createAgent`用于受控替换传输，不是Extension自行创建Runtime的接入口。业务校验、文件保存、RAP/SAP/Case解析、lastRun/草稿、发布及结果解释留在原业务适配器。

| 策略 | 项目任务 | 需求梳理 |
| --- | --- | --- |
| owner | 原projectId+taskId | 原需求instanceId，独立feature命名空间；选中的目标项目不改变其会话归属 |
| 模型 | 任务绑定configuration id/revision | operation开始时选中的配置，生成与修正期间固定；下一次operation再采用当前选择 |
| 历史 | 保存的sessionFile、draft及原生父链；原生命令/fork继续更新指针 | 进程内同配置可复用；重建沿用原新建native路径，不自动扫描历史续接 |
| 环境 | 项目三目录、020工作区、现有工具、010软约束和060报告位置 | 原需求独立workspace、需求提示词和空defaultTools |
| 业务 | 项目/任务、归档、lastRun、请求回执、Case/RAP/SAP | 澄清、假设、框架、source指纹、提案采纳、确认/发布及一次格式修正 |

## 状态、事件与关闭

| 调用 | 说明 |
| --- | --- |
| `read/subscribe` | 读取当前资源状态或订阅自身事件；不新建worker、不发模型或重放。原任务历史读取和native证据校正继续在业务读取适配器中完成 |
| `open` | 显式初始化原生环境，不自动发送业务消息；原生启动UI仍由声明能力的入口处理 |
| `start/withSession` | 从准入开始占用，覆盖既有Host门闩等待、opening、UI等待及多turn间隙；同owner竞争拒绝，不增加全局队列 |
| `busy/live` | 分别表示运行占用/可用原生资源；不能把worker存在当成业务完成，也不能只看底层agent.busy决定归档 |
| `stop` | 取消本owner的当前操作和后续派发资格；在途安全收尾前仍占用，不停止其他owner |
| `close` | 释放本owner资源，不删除业务资料或原生历史；旧代际收尾不能移除新资源 |
| `respondUI/setEditorState` | 只有声明对应能力时委派原生交互；回答已有启动问题不重新申请运行占用，过期回答明确拒绝 |

事件附带Host产生的context。运行结果/lastRun等使用操作context及原requestId；无请求ID的启动或空闲editor事件使用资源context，不编造请求ID。业务写入在原Host `mutate`回调内先核对`context.isCurrent()`及当前请求身份，再写入；不能在外面检查后异步等待，回来覆盖新草稿或结果。取消仍可记录本次取消/中断，是否为当前请求以对应context和业务记录共同判断。

Host的`closeAll({ provider?, projectId? })`在注册域间协调，各域权威管理自己的资源。Provider按live/opening/operation实际捕获的配置过滤，不能仅凭owner删整组资源；真实项目范围由Host解析，需求目标项目不作为关闭条件。应用退出先阻止新准入，关闭失败/未知分别记录，不能把一域失败当成其余域已经关闭。

## 兼容与错误

工程可靠性收尾沿用Interface v1，新增的是结果/事件/新lastRun的可选安全诊断，不改变owner、profile或启动资格。类型及固定安全文案见[run-diagnostics.ts](../src/agent/run-diagnostics.ts)：诊断只表达可证的失败类别、阶段及本轮原生重试计数，未知保持未知；不复制原始Provider错误载荷。计数不等于供应商HTTP总数，也不意味着Host发起了第二轮请求。旧记录缺诊断或包含未来未知诊断时兼容读取，不为填充字段批量回写旧项目。

观察连接和任务运行分开：项目SSE与需求SSE发送周期comment心跳；前端任务观察收包空闲时只关闭该观察连接，随后GET同owner/request并有限重连。终态须与保存记录和snapshot对应，不能借别的请求结束状态。耗尽后明确未知/尚未恢复，用户可显式重新连接；观察恢复不调用open/messages/stop、不更改模型、不补造丢失的逐token事件。退出/切换owner清理观察计时器和请求。

本期不增加持久表、业务会话ID或需求续接指针。迁移是替换接线；旧项目、会话、父链、草稿、发布物和文件原位读取。正常显式续聊可继续追加JSONL和保存原业务结果，原GET证据校正及schema1前置兼容保留；这些合法写入与迁移性改写分别验收。回退使用能读取最新资料的兼容代码，不覆盖为旧数据副本，不热接管活worker。

错误继续按原业务入口映射：配置缺失/变化、busy、取消、原生交互过期、能力不支持、Runtime异常及结果未知。配置失效不静默fallback或重放；格式不合格仍由业务按自己的有限策略处理。原task去重、native回执、Case/RAP身份及legacy ACK/409/UNKNOWN边界继续有效；统一接入不提供所有插件跨重启恰好一次的保证。

## 接入验证与工具读取

按当前变更实际范围关联SM01–SM14证据。检查入口由`package.json`提供：`check:agent-sessions`检查导入/构造路径，`check`同时运行约束、长期测试及构建，CI沿用同一入口。共享行为测试与实际Host/SDK合成Provider、正常HTTP/UI、保存/重开、取消及RAP+SAP+Case联合回归互补；不能只靠import通过或内部Map断言宣称完成。

边界脚本使用当前锁定TypeScript的AST解析，识别静态导入、重导出、require、动态import及已知直接构造；忽略注释、字符串、JSX和模板正文，仍检查模板表达式中的调用。准确例外及理由在[scripts/check-agent-session-boundary.mjs](../scripts/check-agent-session-boundary.mjs)，覆盖SDK薄层、公共实现、原生历史读取、固定连接探针和明确测试路径。没有Host或tests全目录豁免。检查不解释所有反射/动态代码，也不替代资源归属和业务策略的独立复核。

工具读取证据分开记录：先核对当前安装版Codex/Qoder实际项目入口，再用触发IN01的只读接入规划任务观察实际读取记录和规则版本。AGENTS、加载器代码或入口文件可访问只证明可达，不能证明任务已读取；某工具不可用或未现场核验，记NOT_RUN。工具项目入口只引用本工程规范与本说明，不复制正文、修改全局配置或开启MacBook开发。完整结果由[本变更记录](../openspec/changes/unified-session-management-phase1/result.md)保存，不能从文档存在推导SM14已通过。
