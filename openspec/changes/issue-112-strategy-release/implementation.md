# #112 实施记录

## 2026-11-22 阶段二实施

### 确认与边界

- 用户确认：「D01–D07 按建议确认，Demo 通过，进入实施。」
- 实施范围：战略选择页签与发布 UI、地图发布记录存储、发布／撤销 Host 路由、目标承接发布门禁、目标候选发布身份、旧承接标识、手册／内置帮助。
- 不改变 Agent 会话、Pi SDK、模型配置、地图共创／编辑／导入／模拟算法；不新建目标库或 Agent Runtime；不迁移旧地图与旧目标记录。

### 开发过程

1. 为独立工作树安装锁定依赖（`npm install --ignore-scripts`，仅环境准备，不改依赖文件）。
2. 先添加真实 Host 回归 `tests/strategy-map-publication-host.test.ts`。首次运行时发布列表路由尚不存在，产品 RED 为 `GET /api/strategy/discussions/:id/maps/:mapId/publications → 404 not_found`；依赖缺失导致的启动失败已与产品 RED 分开，不作为 RED 证据。
3. 新增 `StrategyMapPublicationStore`：
   - 发布记录独立追加在 `maps/{mapId}/publications.json`，不修改地图版本 JSON；
   - 记录绑定 `discussionId + mapId + version + contentSha256`；
   - 同地图单一 `active`，新版发布自动将旧 `active` 标为 `superseded`；
   - 撤销标记 `withdrawn` 并保留记录；同版本不允许再次发布；
   - 发布与撤销均支持同一 operation 幂等重试，存储整体带完整性指纹。
4. 新增发布记录列表、发布、撤销 Host 路由，并全部走现有 mutation queue 和 Host 关闭检查。
5. `strategyWorkbookRoutes.handoff` 增加 Host 权威门禁：
   - 必须携带准确 `publicationId`；
   - 发布记录必须与所选地图准确身份一致且当前 `active`；
   - 未发布／已撤销／已被替代均拒绝写入；
   - 保留原归属、指纹、目标选择与期望版本校验。
6. 目标候选的 `structured.map` 保持原准确引用，并新增 `structured.publication` 身份；旧目标不回填。
7. `StrategyGoalsStore.mapHandoffs` 返回发布身份与 `historical` 标识，供 UI 区分历史承接。
8. 新增「战略发布」页签与 `StrategyReleasePanel`：
   - 列出全部地图版本的未发布／当前发布／已被替代／已撤销状态；
   - 显示准确身份、指纹、来源、范围、取舍、目标与策略；
   - 支持发布取消／确认、撤销取消／确认、发布后唯一承接入口；
   - 复用「核对承接的目标与策略」和保存目标候选流程；
   - 显示发布记录与承接记录。
9. 从战略地图和版本与来源移除地图承接按钮；版本与来源仅保留历史战略文稿入口并改名为「将此版带入 GSA（历史战略文稿）」。
10. 同步用户手册与内置帮助。

### 当前验证

- `node --test tests/strategy-map-publication-host.test.ts`
  - PASS：1 test。
  - 覆盖：未发布拒绝、错误指纹、发布幂等、新版替代、发布 ID 缺失／错误、active 承接、目标候选发布身份、撤销、同版重发布拒绝、旧承接 historical 标识、重开持久读回、新版候选恢复承接、无目标地图可发布但不可承接。
- `node --test tests/strategy-workbook-host.test.ts tests/strategy-map-store.test.ts tests/strategy-goals-store.test.ts`
  - PASS：24 tests。
  - 覆盖：既有 Excel 地图导入与承接、手工地图修订、地图存储、目标存储和历史兼容。
- `node tests/browser-strategy-release.mjs`
  - PASS。
  - 覆盖：战略地图／版本与来源无地图承接；发布页发布取消与确认；新版替代旧版；唯一承接入口；人工选择目标并保存候选；发布后承接记录；撤销取消与确认；撤销后 Host 负例；390px 深色模式无横向文档溢出、无外发、无页面错误。
- `npm run typecheck`
  - PASS。
- `npm run build`
  - PASS。
- `npm run check`
  - PASS：Agent session boundary 通过；测试 3121 项，其中 3010 PASS、111 SKIP、0 FAIL；TypeScript 检查、前端构建和 build stamp 通过。
  - 本地完整检查不表述为远端 CI PASS。

### 待完成

- ~~`npm run check` 完整检查~~ 已完成。
- 受影响旧浏览器回归按需复跑。
- 非作者独立复核。
- 候选固定、实现回执、PR／CI 与用户后续验收／设备采用分别另行授权和记录。

## 集成阶段复核及修正

非作者复核固定在初交 `3e1934e10ef0a7b265fbaeb689f5817f4c361f86`。隔离 Host 复现旧候选恢复发布、发布操作编号被撤销复用、失读原稿阻断撤销及归属与视角不匹配。实际旧版 Host 回读新承接数据时，还复现了整库返回 `503 invalid_strategy_goals_storage`。产品浏览器复现多地图选择不完整、等待发布状态时提前可操作、失答后更换操作编号和 390 px 深色界面裁切，另核实发布记录行及帮助缺项。初交的原始验证结果保留。

- 发布曾完成后，只允许更高版本候选接替。发布和撤销按准确动作、版本与指纹持久去重，允许同一操作读回。来源失读时，仍可按已储存的准确发布身份撤销；新发布和新承接继续核验地图来源。
- 发布身份写入同一原子保存产生的准确目标承接回执。旧版读取和采用沿用既有目标正文及内容指纹，重新升级可读回发布身份。旧代码回退期间，发布操作及新承接门禁随产品版本回到旧行为。
- 发布页分地图展示可读版本与状态，补齐回看、来源核对和导出。等待状态时保留准确所选版本，暂停发布动作；失答后以同一操作编号重试。独立复验覆盖取消、窄屏深色和键盘切换。
