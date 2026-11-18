# db-link PostgreSQL 一期交付与双端采用

2026-11-15。用户本次明确要求：“db-link的开发是否能告一段落了？如果可以，就先做git/c/合并，切换双端服务。”据此在已通过的v0.5普通PostgreSQL范围收口，授权Git／实际head CI／squash合并及Mac mini、MacBook正式服务采用。原“无Git／运行采用授权”为历史阶段事实，不再构成本次停止线。

交付范围：PostgreSQL 18.1合格只读查询、跨项目复用、原Pi自主发现／纠错、按需大字段、视图／RLS、说明／Studio材料及固定完整文件核算。MySQL、其他未验PG版本、DB12受管活库独立／自动链保持未开放；不引入auto-ontology、容器／代理，不扩权／改SDK，不启动真实Provider／业务分析／企业资产建设。

## 执行清单

| 阶段 | 完成条件 | 当前状态 |
| --- | --- | --- |
| G01 固定与盘点 | 原候选104件与清单一致、14批准原件不改；最新main／tracking／worktree／merge状态、双端代码与忙状态确认 | 完成；原候选零漂移／14批准保留，main=c62d682；双端正式a21cab0且闲置／clean，实际停机前重核 |
| G02 保留feature历史 | 明确暂存清单、公开内容与依赖检查后提交；保留OC｜db-link及全部本地证据，不reset／rebase／force | 完成；feature提交4d456cb6869a9e624d410249b7cbfef6b798c600，106件明确暂存，历史与原件保留 |
| G03 集成与验收 | merge最新main，保留Case-Star-Map与db-link各自owner／port；新完整check／受影响原生25项、实际链路与非作者复核 | 完成；2文件6块最小union，完整check2604项／2493PASS／0FAIL／111条件SKIP，PG25/25、独立SDK/HTTP38/38和联合原生Pi链通过 |
| G04 Git／CI／合并 | 单PR，核实际head与成功CI；合并前再核main和head，squash后核main push CI并安全快进本机main | 待执行 |
| G05 双端切换 | 逐端再次核闲置、共享进程、精确备份／停止后基线；经原入口采用目标main；不操作其他开发／训练服务 | 待实际main CI通过后执行 |
| G06 采用读回 | 两端分别核源码／tree／build／PID／health／静态资源、原数据与会话及SDK；独立非作者读回，记录未验证项与范围 | 待执行 |

原v0.5冻结清单及candidate-01/02、FAIL／UNKNOWN／late recovery与条件SKIP保持；集成或交付记录不重写原批准字节，也不把普通读取通过当作所有db-link能力完成。部署只操作被核定的正式服务，busy、共享源码活动、脏目标或未知资源会阻止该端切换；仍继续其他获准且独立的步骤。收据根：`/Users/bendandebaba/.codex/visualizations/2026/11/15/db-link-git-delivery`。

暂存检查补充：首次标准whitespace检查发现3件末尾空行；当前SQL源码仅移除1个多余换行，后续完整检查覆盖。两件历史研究原件`native-process-limits-pg-plan.md`、`selection-research.md`保留原字节与旧摘要，不为末尾空行改写原件。其余路径用标准`git diff --cached --check`；仅这两件保全原件以原检查保留FAIL、另按blank-at-eol／space-before-tab核查，精确例外不外推源码或其他文件。

## 最新main集成验证

保留feature4d456cb后merge origin/main c62d682，冲突仅ProjectRuntime和ProjectSession，联合保留Case关系与db-link的owner／port／IPC／工具上下文，不新增业务流程。server/App/check-boundary自动合并与独立预演逐字一致。新完整`npm run check`退出0，2604项中2493PASS／0FAIL／111条件跳过；原生PG25项另实跑PASS。独立Case/dbLink SDK＋HTTP38/38、同会话两类能力组合探针通过；新真实全Host→官方Pi→本地合成Provider→PG→两类说明／Case关系保存回读通过，10次本地模型HTTP请求／9工具回执，技术SQL拒绝和自主改写保留，无真实模型专业声明。

本轮测试fixture在CPU并发下出现TCP已监听但PG仍starting-up的启动竞态；原失败、PID正常收尾和端口关闭已保全，仅改测试控制器复用官方`pg_isready`等待accepting，再运行原25项通过。不是产品RED，不改运行驱动／权限／SDK或准入。`npm audit --audit-level=high`退出0，0high／0critical，既有2moderate另留。完整来源与命令见本轮收据根。
