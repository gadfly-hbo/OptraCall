# SAP 方法／IR 实施记录

2026-11-04 · **本地实现、完整适用检查、非作者双轴及四原则复核通过。** 不代表Git交付、运行采用或产品验收。

## 授权与保全

用户确认spec、UI Demo及D01–D08全部推荐A并进入开发。实际分支`codex/sap-ir`，工作区`/Users/bendandebaba/.codex/worktrees/c08a/OptraCall`；基线HEAD `57742b99d173bfa6413e83705682b0444359add4`、tree `462a29b31a7a7a4159b87e4a1b243ddb3a84104b`。未切换分支或修改其他工作树。

批准输入8份按原字节保存于[批准快照](history/approved-v0.1/manifest.json)。开工前884份受版本管理及未忽略文件保全于`.local/sap-analysis-methods/implementation/before/`，身份见`before-manifest.json`；非作者逐文件回读884/884、批准原件8/8一致。产品稿v1.2与批准Demo原字节保持。准备阶段结果、专业FAIL／UNKNOWN及各次本地失败不覆盖。

本轮仅安装锁定依赖、隔离合成Host／Pi／工具／持久化与浏览器验证。未使用真实Provider、业务根或凭据；未操作MacBook、切换现有服务或做Git提交／推送／CI。`npm ci --ignore-scripts`未改依赖清单／锁文件。Node25.9.0、Pi1.4.0、Interface v3。

## 实际实现与归属

具体结构、CAS、API、来源与profile合同见[implementation-contract](implementation-contract.md)。

| 责任 | 实际文件／行为 |
| --- | --- |
| Store作者 | `metric-factory/methods/{types,validate,store}.ts`：同SAP根methods namespace、不可变版、发布事实、幂等回执／治理；旧SAP0.2指标文件不变 |
| Runtime作者 | `sap-method-sessions.ts`、`sap-method-sources.ts`、`sap-method-extraction.ts`及原worker最小接缝：公共域附属profile、固定分支分页、只读来源工具；不加载执行扩展／skills／MCP |
| UI作者 | 新方法列表／编辑／发布／来源、提取面板／client／样式，App同级指标／方法入口；合并原SAP规划占位到实际SAP入口，保留四类目录及旧指标页面 |
| 主Agent | Host routes／feature／server注册，原semantic-context的sap-method准确发布供给，main停用参数，公共busy只读owner筛选、边界脚本精确registrar，公开Host集成及永久失败回归；复核问题修复及文档 |
| 非作者复核 | 全新上下文分别查工程规范与产品规格，候选所有staged／unstaged／新增文件只读；允许隔离诊断证据，不写产品或永久测试 |

Host不作方法内容总结、业务补算或推理编排；Agent自主读来源并输出method／reuse／none。保存自动形成未发布版，发布是准确版本的显式动作。新稿未发布时原发布版保持；确认错误立即停止默认推荐，准确历史读取仍披露当前治理。普通记忆保持原规则。无IR专属检索或另一运行资源台账。

## 切片与验证

证据统一位于`.local/sap-analysis-methods/implementation/`，完整命令与首次失败保留。

| 范围 | 结果与证据 |
| --- | --- |
| 方法Store | 14项通过：保存重开／准确发布／v2草稿保留v1／CAS／幂等／I/O不明／旧SAP保留／正文搜索／历史版来源。`store/`各RED与GREEN，复核修复`review-search-history-*` |
| 提炼Runtime | 实际Pi唯一source工具、90k长材料分页、思维过滤、拒绝未公布write／扩展、IPC取消、重复请求及失败关闭task占用。`runtime/`首败与通过分别保留 |
| 公开Host | 10项通过：真实Host/Pi/loopback工具保存，源native原字节及指针保持，普通Agent经原read_semantic_context读发布版，未发布不泄露，来源当前治理／Session变化、stop／归档、operation核对、停用兼容。`host/permanent-regressions-v2.log` |
| 永久失败回归 | `tests/fixtures/sap-method-feature-regression.ts`由公开测试子进程调用，公共feature/domain/store真实，传输／读I/O受控：最终读记录期间取消、记忆治理与metadata-only排除、失败关闭残留。它不代替前述实际SDK集成。首个fixture语法／类型问题属NOT_RED，日志保留；原因果RED来自独立反例 |
| 产品UI | 真实隔离Host＋Pi＋合成Provider，核心6组、失败读取重试7组、当前操作不被旧真实响应覆盖均通过，外部请求／浏览器异常0。含最新准确回执、保存→发布→v2草稿、从v1编辑v3且pub仍v1、来源懒读／Escape归焦、未保存保输入／默认焦点、dark390px。作者mock局部证据单列，不当实际Host结果。永久入口`tests/browser-sap-methods.js`；证据与10文件摘要见`ui/author-receipt-final.json` |
| 原目录浏览器 | 按README的`tests/fixtures/browser-environment.ts`独立4183环境执行`tests/browser-catalog.js`，六组通过、外部请求0、浏览器异常0；含旧指标／需求／决策入口、草稿、运行中切页／停止、390/320px、深色模式。`catalog-browser-v1.log` |
| 完整检查 | `npm run check` v1因目录合并遗留2条旧断言失败；作者按实际目录更新精确断言，未删分类／键盘覆盖。v2、v3均1454项、1424通过、30有原因跳过、0失败并构建通过。追加永久反例后的最终`check-final.log`：1457项、1427通过、30有原因跳过、失败／取消／todo均0；会话边界、TypeScript与生产构建通过，命令退出0 |
| 依赖与构建 | `npm audit --audit-level=high --json`退出0，`audit-final.json`为high／critical0、moderate2，Pi1.4.0间接minimatch告警保持，未强升SDK；Vite仍报大于500kB的chunk提示，不调低门槛掩盖。最终bundle `index-Cm8I5MvN.js` |

## 独立发现与修复

首次完整候选检查为FAIL，所有发现由作者核算后修复，再由原非作者独立复验；报告在`review/spec/`与`review/standards/`，原v1发现不删。

- 规格轴：API历史降序但UI选末项；管理搜索只含名称；历史版正文目标与保存头CAS错误耦合。修复后独立真实产品复验全部通过，另验证stale CAS拒绝、归档源项目仍可管理全局IR方法、已知错误与未发布替代供给边界。
- 工程轴：业务promise结算后漏掉公共域失败关闭残留；来源未保留准确reader定位及当前治理资格；最终异步读记录期间取消仍可迟到保存。修复采用公共owner busy投影、准确locator＋原reader重核、停止先撤公共owner再等回执及异步返回后lease校验。三个原反例均独立通过，补充记忆纠正／metadata-only排除、源Session变化／失读及真实Host/Pi取消证据。
- UI作者实际浏览器另修：来源返回焦点、发布待回执显示、结果不明回读、窄屏布局、初始dialog优先焦点；真实故障与脚本时序／fixture错误分别记，不以绿色覆盖。

完整候选56份文件固定于`review/candidate-v2.json`（SHA-256 `694b63ab2b982de66a488402c4eb34f1169bdb4083498778e137c7d428be3792`），两位非作者逐项核hash后分别在`review/standards/final.md`、`review/spec/final.md`给出适用范围PASS，三项工程P1和三项规格P2均关闭。四原则结合实际SDK／调用链与浏览器路径通过，不只凭测试全绿。最终仅回填本文件与result的已完成统计，产品／测试／合同不变；最终全范围身份见`review/candidate-final.json`及两轴文档差额复核。

## 边界与交付状态

正常分析新增必做动作0；提取为自愿一次点击并自动保存未发布版，来源／owner无需手填。高级版本、关系、来源和治理按需展开。当前SAP方法是全局发布后按需参考，未新增方法项目启用或自动采用系统；旧指标项目固定版本规则保持。

真实模型提炼质量、专业收益及用户产品验收未做。合成Provider只证明工程协议／权限／生命周期／持久化链路，不证明方法内容正确。单Host管理一个数据根，不声明多Host同时写。停用新功能仍可回看既有记录，不用旧副本覆盖新结构。前次本地实施阶段未执行Git／CI；用户随后已授权本分支提交推送、CI及通过后合并main，新增[交付记录](delivery.md)跟踪实际回执及原位归档，不预写未知成功。服务及设备采用仍不在本次范围。
