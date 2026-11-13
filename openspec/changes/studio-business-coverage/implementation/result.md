# Studio覆盖报告与36格全景：实施与工程核验

2026-11-13 · 本稿记录Git前固定候选的实际产品实施。用户已批准原BC01–BC12＋C01–C10、v0.3方案及UI v0.2，并授权Git／CI／main／Mini服务后停止。Git后的事实见本机执行收据；不以本稿的计划代替实际运行。

## 结果与最小实现

现有Studio业务资产body可保存独立`reportProfile:studio-coverage/1`派生报告，复用原精确修订、sources／dependencies及发布机制。纯内容解析、原读者资格和React只读视图分离；原foundation/1、foundation/2、SAP0.2、SourceRef、七种资产kind及依赖版本保持。

新报告所有method／basis／evidence／sourceSelection引用都是必需依据，自动纳入原外层引用闭包。保存、预览／指纹、确认、企业供给及准确read-source都核同一资格，普通目录按实际消费项目核定，不能借建设项目读取私有原始资料。sourceSelection回原item／metric读者核存在性；本版fragmentLocator明确为所选准确正文中存在的非空原文片段，不声称支持任意行号或JSONPath。

原准确来源可读不等于报告仍适用于当前：依据当前正式版前移时，本首版收窄报告的当前供给／投影，不撤回原材料或给它自动标issue。原历史来源沿原读者，原报告／任务native不回写；另存候选不能恢复旧正式资格。循环、坏hash、外企业、非本消费项目必需依据及不完整读源均保留限制。未知版本可保存工作稿，按原权限看原文，不假装结构支持。

企业基础资产首位增加36格全景，原总览／三类资产／参考／核验及发布使用页面保留。完整36格、14首批参考、报告关注及临时高亮分开；逐格与资料反查只依实际标注。资料、方法、三类结构资产与类别未核分别去重；单个混合资产可同时含主数据与本体标签，整体仍计一次，类型子数不能相加。格子不生成四维成熟度。

界面先按准确报告修订GET当前资格，再展示证据；跨企业／报告切换使用scope／generation／AbortController同时防止迟到响应和旧缓存。无报告、读取失败、损坏或未知格式仍有静态框架，但数量未知，原分析不阻断。新增普通使用导航沿原“发布与使用→用这套资产分析”，复用原任务、采用和使用记录，不产品化Demo的预置聊天。已有报告的盘点复用原建设任务／原send及busy、归档、连接、owner守卫；没有报告才沿原建设表单。待核问题仍回原工作项。

## 授权身份与来源

[批准输入](approved-inputs.json)固定20份输入，独立回读字节／SHA无漂移。原始feature e78d7199、已交付main a4eca5e1均为同树f285c425；本轮安全整合main ancestry得到85a80920160bc102fbe023e03923688236aa80f6，该提交仍是同一基线树，原工作改动及主main README WIP均保留。最终源文件清单见[candidate-manifest](candidate-manifest.json)，提交身份及CI另按实际Git核定，不用Git前dirty build当正式运行版。

## 实际验证

| 验证 | 已观察结果与边界 |
| --- | --- |
| 连续TDD | 内容／host／发布及消费资格／精确引用、前端投影／client／DOM／原任务路由均保留RED→GREEN；后端56项及前端43项相关回归通过，不把检查器准备错误当产品RED |
| 真实依赖与普通使用 | 实际Host进程、官方Pi1.4.0、Interface v3和本机协议Provider执行保存→预览→发布→普通catalog/read-source→新候选仍formal r1→新发布r2→旧native字节及重启读取保全。合成协议不证明模型自主质量 |
| 最终完整检查 | `npm run check`：2294 tests、2243 PASS、0 FAIL、51 SKIP；会话边界、TypeScript、Vite build通过。使用既有官方Semantica0.7.0私有Python运行适用旧回归，未升级或改包 |
| 依赖审计 | `npm audit --audit-level=high`通过：0 high／0 critical，保留原Pi间接依赖2 moderate；package／lock无改动 |
| 产品浏览器 | 真实React＋隔离Host原存储；36／14、实际2资料／1混合资产、准确源正文、反查、空格、unknown原文／未知、切空企业不借旧证据、普通分析原入口、Enter／Esc通过。390页面390／矩阵1070／格约143.3且容器横滚；688／1280无整页横溢；亮暗截图保留 |
| 新鲜非作者 | 未参与创作者从批准输入独立导出验收、读完整20项源码／测试和原接缝，独立回放原检查及自写权限／无报告／精确投影反例；F1／F2修后复核关闭。37项最终受影响隔离检查通过，浏览器明确由作者实走，非作者另核证据及最终文稿 |

详细证据保存在`.local/studio-business-coverage-implementation/`，包括`tdd-backend/`、`tdd-ui/`、`tdd-runtime/`、`runtime/`、`browser/ui/`、`independent-review/`、`check-final.log`与`audit.json`。这些私有记录不含正式企业建设结果，不上传原生会话或凭据。

## 发现、失败与修订

- **F1坐标身份。** 初版按对象JSON字面顺序去重，使`row/column`交换顺序可重复同格。非作者独立复现，作者补关注集及注记双反例RED，改为语义`[row,column]`身份；重复明确报错，不默删／改稿。独立重核恰有两个duplicate_coordinate后关闭。
- **F2来源返回焦点。** 实际界面从格详情读取原来源，关闭原来源弹层后曾回BODY。最小修订只将仍连接的初始格／资料按钮经前端可选returnFocus传给原PersonalDialog；不进API、SourceRef、owner或持久历史。同路径实际Esc返回原R2:What按钮，独立读回后关闭。
- **首轮TF01 FAIL及初始原因UNKNOWN保留。** 首轮完整检查2290项：2238 PASS、1 FAIL、51 SKIP；原目标预测测试轮询GET返回409/session_history_unavailable。保留首轮原件并在旧main／当前未修改reader的真实HTTP边界确定性证明：合法closed记录追加与安全snapshot读取相交时拒绝不稳定读，稳定后成功。原fixture技能快照字节正确，但首轮精确底层异常日志不可恢复，仍UNKNOWN。仅修测试settled，在原60s期限内重试这一精确409；其它状态／坏JSON／网络／失败终态／其它request及永久409仍失败，最终skill字节和请求数量断言不变。作者8项及非作者9项拒绝／期限控制通过，最终全量通过不覆盖原FAIL。

私有界面fixture的旧原生路径复制、未获Agent就绪的人工发布、创建项目早于选本机Provider等准备失败也保留，均按实际原因纠正，不当产品通过。未修改SDK或放宽历史读取来通过测试。

## 四原则与后续停止线

Host只核格式、原资格／归属、资源、保存及只读投影；Agent自主选资料、标注、核口径和工具，不按格／八步编排推理。复用既有Pi1.4.0、Interface v3的construction与普通analysisOnly接口，未新增域/profile/SDK会话循环。普通分析新增必做操作零；格子与报告不是普通供给前置，不自动issue／发布／采用／重建图。SDK及官方依赖未改，新适配均为OptraCall自身模块。

本次工程与合成协议结果不等于真实模型专业通过、企业口径正确或用户产品验收。目标企业主数据、指标体系、本体与会员业务实际建设M阶段仍未启动。Git／CI、main、Mini实际源码／build／runtime及持久资料保全分别记录在后续[本机执行进度](../../../../.local/studio-business-coverage-implementation/delivery/progress.md)与最终收据；完成后停住，不自动更新MacBook或启动资产建设。
