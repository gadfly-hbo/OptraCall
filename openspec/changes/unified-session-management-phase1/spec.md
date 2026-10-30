# 统一会话接入与生命周期管理一期

2026-10-30 · IMPLEMENTING · 用户已整体确认方案v0.3的US01–US12，授权本地实现、兼容验证、联合回归、非作者复核及Git/CI交付并合并main；合并前须更新main。运行服务采用、其他设备更新及真实模型调用不在本次实施中自动执行。

## 固定依据与范围

- 已确认的[方案v0.3](proposal.md)：SHA256 `fe965a442bc68543bb5e300827b8ffa0fbb8a0208e9597d36e43e4cf7575c98c`。保留讨论时的状态文字作为历史，本文件记录后续授权与实施状态。
- 开工基线：`cb178d4b714b7aef559b67ebb52f4265c884a860`；已fetch并核对origin/main，没有新增提交。交付前再次fetch/集成，基线变化后重验失效范围。
- 公共Interface为内部v1：共同代码创建隔离域实例，域内按owner持有运行资源；业务策略和Store保留，Host跨域协调不建第二本会话账。
- 保留现有项目、任务、会话、文件、schema与原生回执。无新库/表/持久ID、全局队列、UI重设计、SDK升级或分析补算。原项目运行服务不切换；工程验证只用隔离合成根与合成Provider。

## 允许修改路径与责任

| 范围 | 实施责任 |
| --- | --- |
| `src/host/agent-sessions.ts`，必要小型Host技术适配 | 公共资源生命周期、归属/配置/取消/代际/事件与域控制 |
| `src/host/server.ts`、`src/host/project-history.ts` | 项目接线、原HTTP/SSE、业务准入/回执/lastRun、跨域关闭；原生只读历史/去重读取独立为受约束适配，不改变marker |
| `src/host/requirement-sessions.ts` | 需求接入；保留选模、workspace/tools、业务两turn与原facade |
| `src/agent/project-runtime.ts` | 仅为原生command的accepted/completion及交互委派做等价薄适配 |
| `tests/`及必要合成fixture/本地验证脚本 | 公共Interface、Host正常入口、三消费者隔离、兼容/回退、联合背景、UI与规范正反检查 |
| `AGENTS.md`、`docs/engineering-workflow.md`、`docs/agent-session-integration.md`、实际必要的Qoder项目入口 | IN01–IN07同源规则、必读触发与实际读取验证；不改全局工具配置 |
| `scripts/check-agent-session-boundary.mjs`及类型声明、`package.json` | 公共接入导入/构造约束接入既有check/CI；不更换依赖 |
| 本变更目录 | 规格、结果与范围明确的复核记录 |

业务Store、`project-session.ts`、原生JSONL/marker、前端页面/布局、真实数据和服务配置默认不改。实际需要扩大范围或改变已确认业务语义时先同步依据，不能借重构顺带实施。

## 验收与方法

以方案SM01–SM14为完整可观察验收，IN01–IN07为规范交付条件：

1. **行为等价与新增保护：** 已有项目/需求相关测试先GREEN；新增公共Interface行为逐个纵向RED→GREEN，保留原始失败。验证seam为已确认公共Interface、现有HTTP/UI和实际SDK合成Provider，不测试私有Map形状。
2. **占用/配置/隔离：** 同owner准入覆盖等待、opening、UI与turn间隙；停止撤销后续派发但收尾前仍busy；旧代际事件/完成不覆盖新状态；旧A资源清理不误停新B；不同域独立。
3. **第三消费者：** 仅profile/业务声明复用公共实现；无SDK构造、生命周期Map或专属公共业务分支。删除原重复实现并核对实际调用链。
4. **保全与回退：** 隔离旧schema2/schema1兼容、原session路径/字节/父链、草稿、lastRun、Case SQLite逻辑数据、RAP/SAP发布物与三目录；区分静态保全与合法业务追加/既有GET校正。兼容基线代码打开新产生记录，不回滚数据、不重放未知调用。
5. **联合与正常路径：** RAP精确版本、SAP启用和Case/work修订共同进入实际SDK请求；stale背景在Provider前拒绝；原需求四项、202/SSE/命令/UI/历史/归档不退化。
6. **规范：** IN01–IN07进入唯一工程规范；准确类型、guide、入口指针、导入约束及合规/绕过正反例一并交付。Mac mini分别记录Codex/Qoder实际入口与读取证据；无法核验如实NOT_RUN，不宣称该项完成。
7. **完整交付：** `npm run check`、适用浏览器路径、依赖审计；固定完整候选由非作者按Standards/Spec两轴独立复核。合并前更新main并重验受影响范围；PR实际head CI及合并main CI分别核对。Git合并不等于运行采用或产品验收。

原始日志、候选清单、失败及复核现场保留于忽略目录 `.local/unified-session-management-phase1/`；公开结果仅放合成信息及可追溯摘要，不含密钥、真实会话或业务资料。

## 结果

实际进度、SM验收矩阵、检查/复核/Git/CI与未完成项见[result.md](result.md)。工程完成与工具读取、运行采用和用户产品验收分别记录。
