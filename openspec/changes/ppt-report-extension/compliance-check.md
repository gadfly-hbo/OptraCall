# 产品原则遵守检查 · Host 管环境 / Agent 自主执行

2026-11-02 · ppt-report-extension 收尾专项（开发方自核 + 独立复核覆盖项汇总）

依据：AGENTS.md「Host 管环境，Agent 管分析，不自建推理循环或 Host 补计算」、工程规范 IN01–IN07、产品讨论稿 v0.2 §2。本清单区分**已验证事实**与**设计意图**，不含未验证宣称。

## 1. 不做确定性组装器 / Host 不代算内容

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| 生成候选版由 Agent 会话自主写代码完成，非 Host 确定性 md→pptx 组装 | ✅ | `ProjectSpace.tsx` 的「生成 PPTX」仅创建任务并预填引导草稿；生成代码由 Agent 在会话内写 python-pptx（真实模型端到端产出 simulated_execution_候选版.pptx） |
| 精修由 Agent 自主判断编辑方式与内容 | ✅ | `session/workspace.ts` 只给规则与边界；turn1–3 中 Agent 自选 edit_slide.py / 生成+拼回 / 视觉检查路径 |
| Host/脚本不做内容判断、不改写文字、不替 Agent 决定布局 | ✅ | `digit_check.py`（只列未命中）、`page_images.py`（只渲染）、`edit_slide.py`/`splice_slide.py`（机械执行 Agent 指令）、`slide_guard.py`（只回滚锁定页字节） |
| 无「Host 补计算/另建分析循环」 | ✅ | 无独立分析编排；精修 turn 走统一会话，不重建推理循环 |

## 2. 统一 Agent Runtime / 无平行底座

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| 精修会话经统一会话接口（Interface v3），非插件自建 SDK 会话/Runtime | ✅ | `src/host/ppt-refiner-sessions.ts` 用 `createAgentSessionDomain`；插件只拿 facade（run/stop），无 `new ProjectAgent`、无 SDK 直连 |
| 域由 Host 静态注册，业务只获 owner 绑定 port | ✅ | 域注册方已登记进 `scripts/check-agent-session-boundary.mjs` 的 `domainRegistrars`；`npm run check:agent-sessions` 通过 |
| 会话生命周期（启动/占用/停止/关闭/取消）走公共入口 | ✅ | `domain.withSession/stop/close/closeAll`；server.ts `closeAgents` 协调含 refiner |
| Host 不直接组合 pi-agent-core + pi-ai 自建底座 | ✅ | 仅经 `src/agent/sdk.ts` 统一出口（pi-coding-agent） |

## 3. Host 管环境（材料、权限、资源、记录）

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| skill 发现由 Host 挂载，非 Agent 自行安装 | ✅ | `project-session.ts` 的 `additionalSkillPaths`（普通+受保护会话），服务级实测 ppt-report 发现为 true |
| 环境依赖由 Host 预置与发现 | ✅ | LibreOffice（用户授权安装）、`~/.optracall/ppt-venv`（requirements 入仓）、pythonPath 自动发现 |
| 资源/路径权限边界为可执行控制，非仅提示词 | ✅ | `allowedRoots` 含 realpath/符号链接处理；页锁定有脚本硬门禁 + 路由预检 + turn 后 slide_guard 回滚（软约束失效的实证已修复） |
| 产物保存与记录归 Host | ✅ | deck-store 原子快照/版本/差异清单/导出；060_reports 归档；md 报告只读且不回写 |
| 目录约定（过程 020 / 报告 060，不读 010） | ✅ | 生成产物落 060_reports；deck 工作区独立；报告锚点只读 |

## 4. 触发与副作用边界

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| 生成默认手动触发，无自动模型调用 | ✅ | 仅报告文件按钮创建任务+草稿，用户确认才发送；目录/精修打开不触发模型 |
| 精修为独立会话，不污染原分析会话 | ✅ | 独立域 `ppt-refiner:<deckId>`；e2e 原任务未受影响 |
| 失败/取消/异常不静默成功、不盲目重放 | ✅ | outcome failed→422、cancelled→409、thrown→映射（session_busy→409）；字节变化照快照，UNKNOWN 不伪造成功 |
| 数据出口仅限已授权路径 | ✅ | 视觉自检页图随模型请求外发（沿用项目模型配置）；无其他外传；验收全部合成数据 |

## 5. 独立复核覆盖

非作者独立复核三轮至 PASS，其中合同项专门核查：无平行 Runtime、域注册一致性、locked/锚点等边界的确定性强制（含提示词不可依赖的实证与修复）。证据：.local/review-ppt-report/{review,review-followup,review-final}.md。

## 灰区与说明（如实记录）

- **预填生成草稿是引导而非步骤**：`generatePptx` 的草稿文本只说「读报告 + 用 skill + 保存到 060 + 数字逐字 + 遵循版式」，不含分析步骤；Agent 自行决定页序/页型/代码——符合 Host 不指定分析步骤。
- **`render` 路由直接跑页图管线**：确定性环境能力（Host 管环境），不是 Host 做内容分析；不经模型。
- **`slide_guard` 回滚锁定页**：机械恢复字节，属权限执行而非内容修改；违规记录随快照返回给用户。
- **diff 记录来自 Agent 的 last-turn.json**：Host 只读取落盘，不代写差异判断；字节变化才是快照硬条件（未改不存）。
- **模型配置**：精修会话取当前选中配置（与需求梳理同型的 per-operation 快照），D4 的「项目绑定配置」在此以会话配置快照实现；视觉自检依赖图像输入模型，不支持时按 D4 降级提示。
- **2026-11-02 用户决定改为 deck 绑定**：注册时可存 `meta.configuration{id,revision}`，精修会话经 `refinerConfiguration` 优先使用该绑定（缺省回退当前选中）；deck-e2e 已按用户指示绑定 `minimax-m3`。生成与精修模型一致性由 deck 元数据保证，不再随全局选中切换漂移。

**结论**：本变更符合「Host 管环境，Agent 自主执行」。确定性代码只承担校验、渲染、权限执行与记录；内容生成、编辑判断、方法与迭代均由 Agent 在统一会话内自主完成。无宿主代算、无平行 Runtime、无自动触发。
