# L1语义依据与关系／时间增量实施记录

2026-11-04 · 开始实施，未完成验收

用户已明确确认spec／UI、D01–D08全部A，追加L113“只作辅助、不阻断原分析流程、正常新增必做操作为零”，并授权随后M8、Git／CI／最新main合并和干净工作区／L1→L2 handoff。

开工前HEAD／origin/main均8425ca159bc674b73ad54b80ce523a93b4f3b900（fetch后差异0）。证据根`.local/fourbase-modules/m7-l1-semantic-trace/implementation/`：`approval.json`固定用户原话与14批准文件，`approved-v0.1/`保留原字节，`before-candidate.json`固定1,405份源码／文档／生成物身份，`before-source/`保存全部非output文件副本，`before-git.diff`保留原WIP差异。原准备报告／closeout回执与旧FAIL／NOT_PROVED不改写。

实施采用原Store／Pi工具／HTTP／产品UI切片；测试接缝已在批准spec／协议明确，不重复要求用户确认。各切片真实RED／GREEN、实际接缝、保全／完整检查、全新非作者与四原则最终记录按完成追加。当前只运行隔离合成工程环境，无真实Provider／业务数据／设备运行采用。

## 固定产品候选与验收（2026-11-04）

L1复用Pi1.4.0／Interface v3、原project-tasks生命周期及M4逐调用IPC；新增read_semantic_context的find／read／trace和record_analysis_sources，后者委托原M2 createCitation及schema2／CAS／hash／幂等合同。SAP、Enterprise修订、M2固定输入／说明／成果、M5／M6关系仍为原权威；没有新Registry、IR、业务时间库、采用账本、模型循环或自动查询。HTTP可选查看不打开Agent；正文及元数据分页20,000 UTF-16，trace只展开一层显式引用元数据，M4后续页仍沿原工具合同。recordedBefore只按可靠留存时间过滤，不能冒充通用业务asOf；人的原历史查看与Agent的排除供给分别保留。

真实RED／GREEN分别保留在本地implementation证据根：Host新路由404；Enterprise只读意外初始化；M2取消写守卫；普通Agent缺少来源保存工具；历史回执关联；真实前端缺Host客户端标记403；辅助来源丢失时原citation清单不可读。夹具／Provider断言错误和准备失败未充作产品RED。SDK嵌套子工具details不落盘，产品保留UNKNOWN及原准确目标，不能解析父工具文字补造保存回执。

全新双轴复核在v1发现两项P2：HTTP读口丢原400／409，以及误收窄人对已排除历史来源的原权限。各自真实RED后修复；HTTP实际Host／客户端7项及typecheck通过，原读口／UI14项通过；Agent被排除内容仍无正文。普通无查询回复的自愿入口缺失亦由实际产品浏览器RED修复，空记录明确未知且无自动请求。原始失败／v1报告未覆盖。

最终产品候选`validation-v2/candidate.json` SHA-256 `83bb49208d9aa55baf4cb9e7f14dde53aaaf36df808cb34027446a9f980c0633`，844源文件，物理隔离Git／依赖及私有Python环境；原v1候选／检查独立保留。`npm run check`退出0：**1370项，1367 PASS、0 FAIL、3原有条件SKIP**；公共接入边界、typecheck、build通过。日志`validation-v2/full-check-v2.log` SHA-256 `87d944e73b3b6212e522bd7aebf0a44cc3b80f78729414500015b98eb66cf5d9`。保留bundle>500kB提示；npm audit高危阈值退出0，高／严重0、中等2。此时Git基线stamp仍是8425ca1+local-changes，不冒充交付head CI。

实际产品UI使用上述已构建产品、隔离Host及loopback合成Provider，沿真实Pi／工具／原Store：普通仅Python→42、准确SAP1.0.0读取→Python→真实M2保存回执、查询失败→Python仍完成；原稿回执与当前引用读取分开，旧1.0.0不换1.1.0；打开／切换详情零自动请求；追问仅预填并恢复原输入焦点，未自动发送；取消后迟到响应不覆盖状态；桌面浅色、375px深色无横向溢出。证据`product-ui-v2/01-normal-green.log`、`02b-no-auto-main.log`、`03-actual-source.log`、`04c-followup-green.log`、`05b-failure-mobile-green.log`、`06-cancel-green.log`及`actual-snapshot.json`；截图`output/playwright/l1-product-v2-*.png`。原04对模态框外inert输入的定位和05流式／已保存文本短暂同名严格匹配错误保留，纠正夹具后通过，不记为产品RED。

独立最终报告、M8、Git／CI／合并与干净交接继续按[M8结果](../fourbase-m8-closeout/result.md)追加核定；本轮没有真实Provider、经营资料、专业质量、MacBook或服务切换验收。原NOT_PROVED／FAIL和DuckDB限定接受保持。
