# metric-factory-mvp 结果记录

2026-10-29 · 实施分支 `qoder/ext-metric-factory`；规格与 [UI 演示](clickable/index.html)已获用户确认后实施。

## 实现范围

| 组成 | 位置 | 说明 |
| --- | --- | --- |
| SAP 0.2 校验器 | `extensions/business-plugins/metric-factory/sap/validate.ts` | 严格 schema（未知字段拒绝）、canonical 序列化（UTF16 键排序/NFC/两空格 YAML）、双指纹；`origin=llm` 必须 `reviewed_by`；交叉引用闭合（含 type_params 前向引用，两遍校验）；YAML 别名/锚点拒绝 |
| 全局库 | `library/store.ts` | `<dataRoot>/metric-assets/<id>/<version>.sap.yaml` + `index.json`；0700/0600、O_EXCL/原子写、损坏报错不清空；同内容拒绝重发（content 指纹）、版本冲突拒绝、幂等重发返回原条目 |
| 项目启用 | `project/enablement.ts` | `<dataRoot>/projects/<id>/metric-assets.json` 启用/停用/升级精确版本；严格读写，损坏拒绝 |
| 索引生成 | `project/index-text.ts` | 启用记录 → 索引文本（包、版本、指标名+显示名、场景、库文件绝对路径、注明版本要求）；损坏降级为不注入 |
| HTTP 路由 | `api/routes.ts` | 库列表/详情、草稿校验（422 带精确 code/path）、发布（幂等 200/新建 201）、项目启用/停用；草稿路径限 `020_clean/*.ya?ml` |
| 资产页 | `ui/MetricFactoryPage.tsx` | 库总览/包详情/审核发布/项目启用四视图；"发起建模任务"= 项目内普通任务 + 预填 SAP 0.2 引导草稿；发布须逐项口径确认+审核人署名 |
| Host 挂载（Codex 边界，最小 diff） | `src/host/server.ts`、`src/host/ui/App.tsx`、`src/host/ui/styles.css`、`src/agent/project-session.ts`、`src/agent/project-runtime.ts` | 路由注册 3 处、导航/页面/标题挂载、`appendSystemPrompt` 追加索引一行、`ProjectAgentOptions.metricIndexText` 透传 |
| fixtures | `fixtures/membership-repurchase@1.0.0.draft.yaml` | 合成样例（四指标/两场景），仓库内唯一 SAP 样例，无真实业务数据 |

依赖：新增 `yaml@^2.9.1`（用户知情确认的首个新增产品依赖）。产品版本维持 `0.1.0-mvp.3`（本变更规格未授权改版本号）。

## 检查与证据

- 单元/集成：`npm run check` 203 项全 GREEN（含 metric-sap 15、metric-library 9、metric-project-enable 6、metric-api 7、metric-index 5、metric-e2e 2）；tsc/build 通过；复核处置提交后同套全绿并经非作者复验确认。
- TDD 说明：切片 1-4 按先 RED（模块缺失或断言失败）后 GREEN 实施；`metric-index` 测试先于实现编写、首跑即 GREEN，未单独保留 RED 现场（断言源自 MF-04 验收，断言力见测试本体）。
- 浏览器（4183 隔离 Host + 合成 Provider）：新增 `tests/browser-metric-factory.js` 连续两次 PASS（`.local/metric-factory/browser-metric-factory-run{,2}.txt`）——空库诚实展示、建模任务预填、校验→逐项确认→署名→发布门槛（未确认不可发布）、`SAP_UNREVIEWED` 拒绝示例、包详情、启用/停用、深色+390/320px 无横向溢出、0 外部请求、0 浏览器异常、无存储残留。既有 `browser-catalog`、`browser-project-tasks`、`browser-live-projects` 回归 PASS。
- 合成端到端（MF-05）：草稿（Agent 写入 020_clean 路径模拟）→ 校验 → 发布 → 项目启用 → 新任务系统提示含索引且不含全文本；未启用项目不注入；草稿发布后原样保留。
- MF-06：见 [observation.md](observation.md)——合成通路证据完成；真实模型对照观察待用户验收回填，不宣称上下文增益成立。
- 本地证据根：`.local/metric-factory/`（浏览器运行记录、QA 探针、runner）。

## 过程记录（偏离与修正）

- TRIAL-07 回归：fixture 未复制新增的 `extensions/` 目录导致 Host 启动失败；修正 `tests/trial-launcher.test.ts` 的 `actualHostFixture` 增加复制 extensions（环境构成修正，非断言削弱），13 项恢复 GREEN。
- 草稿入库路径澄清：产品上传白名单（CSV/JSON/MD/TXT）保持不变；SAP 草稿按设计由 Agent 会话写入 020_clean，用户手写 YAML 需经 Agent 或直接落盘后走"审核发布"导入——作为已知限制记录。
- 4183 与并行 Codex 会话两次冲突，等待释放后执行，未动对方进程。

## 已知限制与未验证项

1. 真实模型闭环（MF-05 产品面）与上下文增益观察（MF-06）待用户验收；工程侧不自动调用真实模型。
2. 资产页无包级"标题"字段（SAP 0.2 无此字段），以包 id 展示。
3. 库损坏（index.json 或包字节被改）时资产页各操作报错并停止写入，未提供自动修复。
4. 索引为系统提示软引导，无读取拦截（与三目录软约束一致的哲学）。
5. 升级启用版本需在"项目启用"页显式选择新版本；包详情的版本历史可查各版本与启用项目，但无版本间差异对比视图。

## 独立复核与处置（2026-10-29）

非作者复核结论：**PASS with findings**（无严重发现）。发现与处置：

| 级别 | 发现 | 处置 |
| --- | --- | --- |
| 一般 | MF-03 详情缺"版本历史、各项目启用状态"且未声明 | 已补实现：包详情新增版本历史表与各项目启用状态表（新端点 `GET /api/metric-factory/usage/<packageId>`，挂载注入项目清单），补 API 测试 |
| 轻微 | UI 丢弃 422 校验的精确 path | `metricRequest` 将 `detail` 传入 `HostRequestError.fields`，校验失败展示 code + path |
| 轻微 | 校验器不查 package.id/version 格式，反馈晚且不精确 | `checkShape` 增加 id/semver 格式检查（SAP_STRUCTURE @ package），补测试 |
| 轻微 | UI 草稿列表只扫 020_clean 根目录，API 允许子目录 | `draftFilesOf` 改为递归收集 |
| 轻微 | result.md 限制#5 描述与 e2e 标题言过其实 | 已修正措辞 |

## Git/CI 与交付状态

- 分支提交：2ab04cf（切片 1-3）、e195a36（切片 4-6）、400768f（文档收尾）、413b2e0（复核处置）。
- 独立复核：已完成，结论 PASS with findings，发现已全部处置（见上节）；处置经非作者复验确认有效（2026-10-29，`npm run check` 203 项全绿）。
- PR/CI/合并：按工程规范第 5 节执行；squash 合并需用户另行授权。
