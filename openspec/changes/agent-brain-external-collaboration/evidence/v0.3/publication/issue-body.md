> **v0.3整包预览已更新，等待用户整体确认；未开放领取，未安排产品实现。**

预览完整提交：`2f6013fd759ebac5b37999c82817e3461a245107`（工作分支 `codex/agent-brain-external-collaboration`，main核对为 `74030911ade7a9e06ad1a0213d1fcb93ecbba6dd`）。这份预览尚未取得v0.3设计确认；用户确认后在本Issue登记确认记录，再按用户安排领取。

| 确认件 | SHA-256 |
| --- | --- |
| [spec.md](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/spec.md) | `56522ef4db656ed047864cd9cc897fec0544bb627dd5fcf8bf26af82a27d9375` |
| [tasks.md](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/tasks.md) | `fe12198ab553abc388b74dc3dc94818d09b358b2e27bde527b0b9fed45fbd9bd` |
| [ui-demo.html](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/ui-demo.html) | `9a5626d5efe69f2d5a4c22ee234919a4abd07e4c190a0fb996a9449cd062fcb4` |

已完成作者浏览器检查与[非作者准备复核](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/preparation-review.md)，仅证明设计/合成原型，不代表真实产品或WorkBuddy联调。

---

# Issue #155 · v0.3 同步正文

v0.3 · 2026-11-28 · PM Agent：Codex

**状态：整包已更新，等待用户确认；本单保持Open跟踪，不安排Agent领取，不启动产品实现。** 用户已确认原v0.2并发布本Issue；本轮用户追加决定形成v0.3，旧确认不自动覆盖新设计。确认后在同一Issue登记确认版SHA和摘要，再按用户安排开放领取，无需新建Issue或新方案。

## 目标与执行方式

OptraCall负责方向、目标、计划、任务与成果/反馈/资产闭环；外部Agent承担授权工作片段。原六类普通合格Task保留内部执行，外派不新增Task域。

1. **内部完成始终可选。** Agent推荐外派也可选择“在OptraCall内完成”；沿原工具/权限/会话继续，保留草稿、Task及准确Case来源。全部外部连接未配也可内部继续，零Issue发布、零外部触发、零外派授权/资产增权；能力不足如实说明，不假报已完成。
2. **GitHub Issue通用外派为基础。** 明确授权后在指定可信仓库发Issue；获准通用Agent认证领取、按任务调用受保护资产/工作MCP、交回材料，原Task Agent核验/保存/续接。无WorkBuddy账号、在线助手、OAuth、Connector或联合测试也须独立闭环；无人领取显示等待，不自动唤起其他执行器。GitHub评论/assignee/关单不代表认证、资产权或验收。
3. **WorkBuddy远程触发仅为可选适配。** 默认未验证禁用；具体配置真实API→同一MCP领取/查读→交付→原Task核验联合测试通过后，才可由用户主动选择。单项API/在线/Connector成功不足。可跨环境调用已在线授权助手，不承诺开机、唤醒睡眠MacBook、启动已退出应用或同账号多设备精确路由，不做WorkBuddy云任务。离线/未配/失败不阻断基础路径，不静默切换已发工作或重派。Demo启用状态仅模拟，真实联调未完成。

每份外派授权默认1work/24h、较低已批准策略优先；GitHub/MCP适用额度/未知费用与WorkBuddy分开。只有选用WorkBuddy才额外占最多3次API触发含修订，submitted/UNKNOWN占额，跨turn/revision不重置。内部和纯GitHub不申请或消耗WorkBuddy额度。

## 基线与本轮确认件

本轮origin/main：74030911ade7a9e06ad1a0213d1fcb93ecbba6dd，含#150–#153，准备分支已合入；领取/集成前重核最新main。分支codex/agent-brain-external-collaboration。当前预览提交的完整SHA/三个摘要由PM在本Issue顶部发布并读回；它是待确认候选，尚非获准实施基准。

- [spec v0.3](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/spec.md)、[任务清单v0.3](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/tasks.md)、[可点击UI Demo](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/ui-demo.html)，下载HTML后用浏览器打开，无真实外部调用。
- [Demo指南](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/demo-guide.md)、[本版取舍与覆盖](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/changes-v0.3.md)、[用户决定](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/decisions.md)、[UI骨架/生产映射](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/ui-mapping.md)。
- [main接缝](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/main-alignment.md)、[复用核对](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/reuse-audit.md)、[官方接入研究及未证明项](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/integration-research.md)、[准备结果](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/result.md)、[独立准备复核](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/preparation-review.md)。

原v0.2确认提交0ff60301fed16321b35f315f15329e415a178450及[原结果](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/result-v0.2.md)/[复核](https://github.com/gadfly-hbo/OptraCall/blob/2f6013fd759ebac5b37999c82817e3461a245107/openspec/changes/agent-brain-external-collaboration/preparation-review-v0.2.md)/evidence/v0.2原样保全；旧PASS不覆盖v0.3。旧Issue发布回执publication.md/published-issue.md仅为历史。

## 工程范围与验收

以spec全部条款/AB01–AB18、任务清单E01–E07及用户确认的Demo共同验收；E08真实采用单列。全部工程任务未实施。

- E01内部/外派明确选择、授权、资源和原Task/Case/草稿保全；E02完全不依赖WorkBuddy的GitHub发布/修订/通用认证领取与UNKNOWN幂等。
- E03原实例资产/工作远端MCP：标准Streamable HTTP/OAuth/可信principal、显式企业、精确ref/version/hash与原资格相交；无claim不给资产，目录/trace/分页不泄漏，仅读不执行/写入。
- E04有效claim/epoch/租约/交付字节与manifest保全、修订和迟到历史；原Agent专业核验/原工具保存、同owner一次新turn续接，精确work/revision/delivery/hash/grant进原指纹/providedContext，外部输入非用户原话。busy/暂停/取消/重启/UNKNOWN不重放、不覆盖新稿。
- E05可选WorkBuddy工程合同/禁用与启用门槛独立验；跨环境限制、账号消息关联/同连接安全占用及触发额度不污染通用路径。真实联合验证另列E08，未做就不启用。
- E06沿最新Decision Case日常工作台，Task为主入口、准确原项目/Case行只读摘要；不新增首页收件，不把外部接受冒认Case回应/ProjectWork等待/目标实绩或资产发布。亮暗1440/1024/390、键盘/焦点/长内容、原消费者兼容。
- E07固定官方Pi1.4.0/MCP1.32.2、Interface v3、project-tasks普通合格owner/profile和统一Runtime；Host管权限/环境，Agent管方法。先有效RED/反例，再最小实现；实际Host/Pi/标准MCP/TLS/OAuth/模拟供应商与通用客户端核心闭环，可选适配另验。

允许修改范围按spec第12节；Codex负责Host/Agent/SDK接缝与整合，领取时明确实际唯一写入者。飞书/邮箱完整外派、WorkBuddy云任务、第二Runtime/正式资产库、远端计算/Skill分发/正式资产写入均不在本期。原项目/会话/native/草稿/文件/原始FAIL与UNKNOWN保全。真实账号/公网部署/设备服务/模型及业务动作另核有效授权。

## 领取、审核与交付门禁

**本版确认前不得领取。** 用户确认后PM在本单记录确认原意、时间、完整提交/三个摘要；其后领取者核最新正文评论、AGENTS/工程规范、origin/main和工作树，回执实际Agent/实例、分支和完整基线。

受影响UI编码前，领取者亲自在真实浏览器渲染/操作确认Demo、查看画面/截图、读DOM/CSS，回执页面/状态与生产组件/真实数据映射。切片/返工同视口对照。最终独立复核者须非完整候选任一作者，按每条spec/每项任务/Demo页面布局导航状态交互形成矩阵，不能只核innerText、hash或作者总PASS。

PM开PR（含draft）前必须实际向用户展示该候选真实产品截图及差异，记录源码/构建/环境/合成数据/页面状态/视口/原图与明确确认；静态Demo和本轮准备截图不替代。任务分支可按授权先提交推送回执。确认后main/代码/构建/配置/输入变化影响UI时补受影响复核/截图/用户确认。之后核实际PR head全量Check、有效合并授权、准确main push Check，再同Issue工程回填/关单。当前不创建PR、不合并。

首次审核可退回一次；二审终审仍有问题时PM在同Issue直接接手修复—非作者复核—开PR—CI—合并，遵守相同截图和授权门禁。回执列远端完整SHA、三基准/阅读映射、AB/E全矩阵、命令/截图/运行身份、FAIL/UNKNOWN/NOT_RUN/跳过、兼容/回退。提交/PR用Refs #155，不用合并自动关单关键字。工程CI、真实采用、专业质量和用户产品体验分别报告。
