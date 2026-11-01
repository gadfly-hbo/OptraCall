# Host 接入交付说明 · ppt-report-extension（Qoder → Codex）

2026-11-02 · 用户决定：Host 薄挂载由 Codex 执行。本文按工程规范 §6 给出可独立理解的接入说明；Extension 交付物已完成并通过检查，Codex 接线后按本说明验收与回归。

## 1. 已交付（Qoder，分支 qoder/reports-factory）

| 模块 | 路径 | 内容 |
| --- | --- | --- |
| A · PPT 生成 skill（分析资产首个） | `extensions/analysis-assets/ppt-report/` | `SKILL.md`（内容红线+生成/精修工作流）、`references/`（版式系统、python-pptx 指南、陷阱、MIT 底本参考）、`scripts/`（digit_check.py、page_images.py、splice_slide.py）、`LICENSES.md` + MIT 许可 |
| B · 逐页精修插件 | `extensions/business-plugins/ppt-refiner/` | `types.ts`、`storage/deck-store.ts`（版本/锁定/导出差异清单）、`scripts/edit_slide.py`（锚点拦截文本编辑）、`session/workspace.ts`（精修提示词）、`api/routes.ts`（路由工厂）、`ui/`（RefinerPage + client + css） |
| 测试 | `tests/ppt-report-skill.test.ts`（7）、`tests/ppt-refiner-core.test.ts`（7）、`tests/ppt-refiner-api.test.ts`（3）、`tests/fixtures/ppt-report/`（合成） | 全绿；`npm run check` 771 pass / 0 fail（3 个环境相关用例按需跳过） |

## 2. Codex 接线清单（5 项）

### 2.1 skill 发现挂载（PPT-03 已验证机制）

`src/agent/project-session.ts` 的 `createAgentSessionServices({ resourceLoaderOptions })` 增加：

```ts
additionalSkillPaths: [path.resolve('<repo>/extensions/analysis-assets')]
```

- 普通会话与受保护会话共用此发现路径；受保护执行经现有 `skillsOverride`→`snapshotProtectedSkills`（已验证兼容）。
- skill 文件名必须大写 `SKILL.md`（SDK 精确匹配；已交付即此名）。skill 目录内无软链、无凭据文件、总量 <32MB。

### 2.2 `ppt-refiner` 域/profile 注册（Interface v3，IN02/IN03）

参照 `src/host/requirement-sessions.ts` 新增 `src/host/ppt-refiner-sessions.ts`：`agent-sessions.ts` 静态注册域与 profile，owner 绑定 projectId + deckId；业务侧只拿 `AgentSessionPort`/`SessionRef`。

profile 差异（IN04 只声明真实差异）：
- 准入：用户从报告页/精修页显式打开 deck（无自动发起）。
- 模型：项目绑定配置；视觉自检需图像输入，不支持时降级提示。
- 工作区：`refinerWorkspace(deckDir)`（cwd = deck 目录）；系统提示词 `refinerSystemPrompt(meta, { skillScriptsDir, editScript })`。
- 工具：原生 bash/read/write/edit（执行 python 脚本与 python-pptx 生成）；多 turn、取消/停止走公共生命周期。

facade 适配（业务路由只依赖此形状）：

```ts
type RefinerSessionFacade = {
  run: (deckDir: string, turn: { text: string; requestId: string }) => Promise<{ text: string }>;
  stop: (deckDir: string) => Promise<void>;
};
```

### 2.3 路由挂载（`src/host/server.ts`）

```ts
createPptRefinerRoutes({
  deckRoot,                 // 建议：项目 060_reports/ppt-decks（deck 为报告衍生工件，随项目归档）
  sessions,                 // 2.2 的 facade
  readBody,                 // 现有 HTTP body 读取
  skillScriptsDir,          // <repo>/extensions/analysis-assets/ppt-report/scripts
  pythonPath,               // 见 §4 环境
})
```

URL 映射（transport 按现有插件同法绑定）：

| 方法/路径 | handler |
| --- | --- |
| POST `/api/ppt-refiner/decks` | `create(body)` |
| GET `/api/ppt-refiner/decks/:id` | `get(id)` |
| POST `/api/ppt-refiner/decks/:id/locks` | `setLock(id, body)` |
| POST `/api/ppt-refiner/decks/:id/revert` | `revert(id, body)` |
| POST `/api/ppt-refiner/decks/:id/export` | `exportDeck(id, body)` |
| POST `/api/ppt-refiner/decks/:id/turns` | `turn(id, body)` |
| POST `/api/ppt-refiner/decks/:id/stop` | `stopSession(id)` |
| POST `/api/ppt-refiner/decks/:id/render` | `render(id)` |
| GET `/api/ppt-refiner/decks/:id/images/:name` | `image(id, name)` |

错误经 `routes.mapFault` 映射为 `{code, message}`（含 page_locked=409、deck_not_found=404、render_failed=422 等）。

### 2.4 UI 挂载（`src/host/ui/App.tsx`）

- 新增视图：`RefinerPage`（`initialDeckId?`、`onBack`）。导航放「业务插件」目录或报告页入口旁。
- 报告页「生成 PPTX 版本」入口（PPT-05）：显式按钮 → 创建普通任务会话预填生成引导（MF-03 同型），skill 由 2.1 发现；产物候选版 .pptx 落 060_reports；分析需求已声明 PPTX 的任务报告完成后提示直接生成；无声明不生成不打扰。
- 生成完成后可「打开逐页精修」→ `createPptRefinerRoutes.create`（sourcePptx=候选版路径、reportPath=md 路径）→ 进入 RefinerPage。

### 2.5 能力目录条目（PPT-12，`catalog-data.ts`）

`assets` 分类新增已接入条目：PPT 报告生成（说明、版本、适用条件；入口指向报告页生成按钮）。无安装/市场入口。

## 3. 权限与数据出口

- deck 工作区只含 deck.pptx、meta.json、versions/、pages/；md 报告只读锚定，精修不改写 md；导出目录由用户/Host 指定（默认 deckDir/exports，可归项目 060_reports）。
- 页图渲染（soffice）本地执行；视觉自检会把页图随模型请求外发（沿用项目模型配置与数据出口边界，内容源自已审 md 报告）。
- 编辑/拼回均字节级隔离：未改页与锁定页 zip 条目不变；测试已固化。
- 合成数据验收；公开仓库只含合成 fixture。

## 4. 环境前提（Host 管环境）

- LibreOffice（soffice）：Mac mini 已装（brew --cask libreoffice）；可用 `SOFFICE` 环境变量指定路径。
- python venv：`extensions/analysis-assets/ppt-report/scripts/requirements.txt`（pypdfium2、Pillow、python-pptx）。渲染与精修会话用同一 venv 的 python（`pythonPath` / `PPT_REPORT_PYTHON`）。
- 无 soffice/pypdfium2 的环境：render 路由报 503/422，相关测试自动跳过；其余功能不受影响。

## 5. 适用测试与验收

- `npm run check`（含接入边界检查与全部测试）；新增用例随本包已绿。
- 接线后回归：普通分析任务不受影响（skill 发现为增量）；受保护任务快照正常。
- 端到端（PPT-11，合成）：md → 报告页手动生成候选版 → 打开精修 → 选页对话改（数字锚点拦截演示 +3%→+3.2% 被拒）→ 锁定页字节不变 → 版本回退 → 导出终版 + 差异清单。
- 独立复核：完整候选由非作者复核（Codex 主链路 + Qoder Extension）。

## 6. 已知限制

- 含媒体拼回会移除被替换页的旧 notes；媒体重命名带 `spliced-<slide>-` 前缀。
- 视觉自检依赖支持图像输入的模型配置；不支持时仅降级提示。
- 首期只面向本产品生成的候选版；不做外部 .pptx 导入/通用编辑器。
- last-turn.json 由 Agent 写盘（软约束）；字节变化是快照硬条件，无变化不存版本。
- PDF 文本层不可用于数字核对（LO 子集字体缺 ToUnicode）——digit_check 一律读 XML。

## 7. 停用方式

移除 2.5 目录条目与 2.4 页面入口；server.ts 卸载路由；agent-sessions.ts 移除域注册；project-session.ts 移除 additionalSkillPaths。skill 与插件文件保留即不生效，无数据迁移。
