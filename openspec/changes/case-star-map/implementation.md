# Case-Star-Map v0.2 实施记录

本地工程记录原文保留。后续已按用户授权完成PR #69的准确head CI、squash和本地main首次快进；原位归档与最终设备采用按[交付结果](result.md)及各自收据核定，不以原文“未执行”覆盖后续实际结果。

2026-11-14（北京时间）· 用户已整体确认spec／UI并授权按方案启动开发 · 本地开发及工程检查完成，Git／CI与运行采用未执行

后续用户已授权I5交付：提交推送、实际head CI通过后squash合并main、快进本地main并原位归档，最后才进行获选设备的运行采用。下列本地工程收尾状态保留；实际Git、Actions、归档及设备收据分别接续，不将本地PASS当CI或运行采用。

## 固定输入与允许范围

基线 `OC｜Case-Star-Map`／`ef3e7d0b8703a6e22023e8099a56c542d484a69d`。开工前只有本任务的未提交确认包：spec、review及独立Demo；其他受版本管理文件干净，本分支只被当前aada工作树占用。未切换、重置或覆盖其他工作树。

批准v0.2原件在 `.local/case-star-map-implementation/approved-v0.2/`，对应SHA-256：

- spec：`864eca79dd754e5f734b63d0100d65905a0465a9483c5beabc88d566bc6561ce`
- UI Demo：`fe48b792d2ec29ae891d5cefa32a8ded2bd1ac69fda444a490c419faca5fb29e`
- 准备review：`94866604450c9f5c844a6b754ad47f4cc37d71ba2716bb076f61aacf5b13e436`

`baseline.json`记录开工前1421份受版本管理文件的路径／字节数／摘要及Git状态。原v0.1、v0.2准备证据继续保留；准备PASS不转写成产品PASS。

本轮执行批准清单I1–I4：Case关系的原Store增量、原普通任务Agent窄接缝、Decision Case图谱及原导航显示名、适用检查和最终全新非作者复核。锁文件安装沿既定版本，允许隔离合成Host／Pi／UI。真实业务资料／凭据、真实Provider、依赖升级／改包、运行服务切换和MacBook均不在本轮范围；Git／CI／合并与运行采用按I5另核有效授权。

## 接缝与执行清单

TDD接缝沿用户已整体确认的A01–A10：原CaseStore公开读取／修改及迁移兼容；HTTP；原Pi SDK工具／worker IPC／Host当轮归属；前端关系投影与真实UI导航。不新增一轮相同接缝确认。每次先保留可检出目标行为错误的RED，再最小实现GREEN，环境／导入失败不计RED。永久测试从行为导出，不镜像实现。

| 阶段 | 完成条件 | 实际进展 |
| --- | --- | --- |
| I1 | 关系来源／归属／准确版、独立修订／CAS、原回执、schema3懒迁移／兼容关闭 | 已完成本地实现与受影响检查；准确版、范围漂移、原回执脱敏、迁移／回滚／UNKNOWN均有反例 |
| I2 | 原project-tasks unmanaged、当轮目标Case、原call-local／IPC／取消、封闭资源拒绝 | 已完成；实际Host→原Pi→合成Provider直调／nested与禁止副作用反例通过 |
| I3 | 批准图谱／常规模式、直接导航和视图保留、关系管理及名称，原导航不扩张 | 已完成；真实1440／1024／390px、明暗、节点导航、草稿、历史与标签修复均已核 |
| I4 | 完整适用检查、隔离合成Host/Pi/UI、非作者双轴及四原则专项 | 已完成本地工程范围；完整检查2338项／2268通过／0失败／70条件跳过，双轴和四原则通过 |
| I5 | 获授权Git／实际head CI／合并／运行采用 | 已获后续明确授权，交付执行中；设备目标待核，实际进展分开留存 |

## 环境与复用

本机Node `v25.9.0`，npm `11.12.1`。`npm ci`退出0，按原锁安装234包；SDK声明／锁定／实际安装均为官方 `@earendil-works/pi-coding-agent@1.4.0`，Interface v3保持。来源URL和integrity、实际解析目录见 `dependency-identity.json`。没有修改SDK或Semantica安装包。安装提示2项moderate漏洞，保留提示，不执行强制依赖修复；最终按工程规范核适用高危审计。

Host负责原身份、权限、企业范围、取消、保存和状态；Agent自主决定是否读取／记录明确关系，可以零调用，不后台找关系或逐条人工审批。项目和任务仍由原ProjectStore持权威，关系沿CaseStore保存，不复制到第二个图数据库。

## 最终实现与复用差额

- 原CaseStore追加稳定关系身份、不可变修订／CAS、同事务operation receipt及schema3。schema1/2读取不迁移，首次显式关系写入才迁移；关闭新能力仍读schema3与历史。关系不改Case核心修订，也不复制项目／任务权威。
- 新关系HTTP与准确源读取沿原Store、M6来源resolver及ProjectStore文件读取。已结束源允许引用，目标结束禁止新写。准确artifact／decision／choice及目标的原项目来源纳入企业范围，读前后重核；范围失权投影脱敏，Store原成功receipt保持不变。
- 原ProjectAgent／worker IPC／Host mutate接入两个窄工具，owner/profile仍为原project-tasks／Interface v3。资格绑定真实当轮task_context_prepare、原call-local SDK ctx和取消信号；不修改SDK包／定义，不建立新Agent循环。模型不能自报actor或目标owner。
- Decision Case默认图谱，原方块／列表在常规模式。共享项目去重、任务渐进展开、搜索任务带出必要路径、等价清单、聚焦、缩放／平移及直接跳转。原App内存保存视图和关系草稿／待查回执；浏览任务不自动带入来路Case。Project Map仅更名及指定原详情返回接缝。
- 来源正文复用原CaseDecisionsPanel的SourceBody；准确版与状态常显，技术封套折叠。手册与下载版同源更新。既有browser脚本只同步名称及进入常规模式，保留原断言；实际浏览器由CUA执行，没有声称旧Playwright脚本已运行。

新增允许接缝仅包括原SourceBody导出／关系来源类型接受、由原帮助内容生成的`docs/user-manual.md`，分别修复本次可读正文和手册一致性直接问题。公共会话边界脚本只增加精确测试文件`tests/case-relations-agent.test.ts`例外，用于隔离原SDK工具资格验证；原自动检查拒绝记录在runtime日志，生产代码和测试目录未整体放行。

## TDD、失败和修复

原始命令／输出保留本树 `.local/case-star-map-implementation/tdd/{backend,runtime,frontend}/`，每个README／notes说明切片。代表性真实RED包括HTTP读取404、HTTP保存404、原Pi工具缺失、工具写入后持久关系仍0、共享项目缺失、任务搜索不可达、UNKNOWN原回执恢复失败。环境／导入、测试fixture及复核harness自身失误另存，不计产品RED。

| 发现 | 修复与验证；原失败保留 |
| --- | --- |
| 来源候选分页遗漏后续准确决策 | 原SQL offset与artifact阶段cursor分开，55条准确来源跨页完整到达 |
| 范围变化仍泄露changeReason／operation成功正文 | 当前list／detail／operation／同ID成功重读统一受限投影，Store原receipt逐值保全；非作者自拟反例通过 |
| 历史来源项目解绑后换企业仍可读正文 | 准确来源项目provenance参与范围核验，读取前后复核；非作者原2项FAIL及修后GREEN保留。首屏仅读origin元信息，不批量读决策正文 |
| 解除／恢复夹带正文或来源修改 | 仅允许同原值重复字段，变更拒绝；原身份追加生命周期修订 |
| 转义正文封装超预算，Agent无法读任何页 | 按最终JSON封装预算缩页，准确cursor连续且不拆emoji。作者48k及独立32k混合特殊字符全文逐页拼回，原30k／240k预算不提高 |
| 单类筛选、密集图首屏遗漏项目 | 按批准Demo只保留该类业务两端及项目结构上下文；shared只真桥梁。稳定空间行次取首屏，明确剩余节点数，清单继续到达 |
| 来源默认技术JSON、恢复后焦点丢失 | 复用原SourceBody显示正文；操作后聚焦稳定关闭按钮，真实390／1440复验 |
| 同中点标签遮挡，鼠标点击前后续却开支持 | 稳定业务身份排位避让标签与节点，纯几何RED→GREEN；真实鼠标分别打开两种正确关系，保留原几何bounds证据 |
| 空库误显示筛选无匹配 | 空库独立说明与原新建Case入口；无匹配保留清除筛选。SSR及真实空库UI均验证 |
| full-check-01 HELP-02失败 | 改名后生成手册未同步；从原manualMarkdown重新生成，未改弱断言，独立／作者定向通过。首次完整结果2336项／2265通过／1失败／70条件跳过保留，不转写为全绿 |

## 实际验证与身份

源码固定`candidate-02.json`：44份完整staged／unstaged／新增文件，清单SHA-256 `ad7bc5c2168c35b8eb621eee91f65c4d6bb5dd91c5512e19b00fbb36cdd627b8`。之后仅补spec与本实施记录执行状态；最终清单另存于同一证据根，两个非作者各自核对摘要及差集。

- Store／service／HTTP／旧Case与M5：后端最终14项、原HTTP／Pi20项、原Case／M5回归34项通过。Runtime最终18项及既有M5/M6十四项通过；最终全仓结果另列，不把这些数量累加当独立用例总数。
- Standards独立复核：01候选45项、02受影响增量15项及自拟范围／封装反例；Spec独立复核：02目标24项、自拟Store／权限／兼容probe、实际Host→Pi→合成Provider合法nested与零调用路径。两轴源码范围均通过，0未闭合必修项。见`independent-review/standards/review-final.md`与`independent-review/spec/review.md`。两位均非本候选任何部分作者，临时资料限各自隔离目录；他们没有把作者浏览器点验冒称为独立浏览器PASS。
- 真正产品UI：Chrome＋Vite＋隔离Host／原Pi，3项目、4Case、3任务；两个M5种子用了4次合成协议请求，随后浏览／关系维护全程请求数不增加。验证任务Enter直达／未发送草稿、返回搜索／缩放／焦点，Case／项目详情及Esc返回，方块／列表、两类关系准确源／目标、纠正／解除／历史／同身份恢复、目标关闭只读与关闭源历史引用。首次未运行任务完整公开GET前后逐值相同，不生成sessionFile／lastRun。视口1440／1024／390、明暗、清单和弹窗焦点已核；测试页关闭、视口复原、两个自建UI进程精确停止。
- UI证据：`ui-validation-progress.md`、`ui/9993568b-8998-4895-8e17-6bec7f0ee06e/`、`ui/d42589b8-130e-4d40-bce2-81c4a1afc49c/`与`ui-empty/2960268a-ab85-41c3-8e6f-87ae90fc44ba/`。最终桌面截图为`02-final-map-light.jpg`，最终实际390px为`04-final-mobile-390.jpg`。`03-final-mobile.jpg`因另一个活动测试tab承接了视口设置而实际仍1440，不计390证据，原文件保留。空库旧tab临时白屏后用新tab实际验证成功，保留原观察，不计产品RED。
- 合成规模：1000Case＋400项目＋2000任务、1200项目边＋600业务关系（500活动）。默认200／3400节点并明示剩余3200；完整展开3400节点／3700边，准确任务搜索及无悬空边核过。Apple M4／darwin arm64／Node25.9，预热1轮＋20轮纯投影median4.54ms／p95 12.43ms；不含HTTP／React／绘制，不表述为浏览器大图性能验收。
- `npm audit --audit-level=high`退出0：0高危／0严重，2项moderate按原锁保留；不升级或强制修包。`preservation-final.json`回读原1421文件：1401未变，20项本任务允许修改，0丢失；批准Demo字节和package／lock未变。

最终完整检查：`npm run check`退出0（`full-check-02.log`）。公共会话边界检查、2338项测试（2268通过、0失败、0取消、70跳过）、TypeScript及Vite生产构建均通过。70项是原可选私有Python／DuckDB／Semantica／LibreOffice／固定S3–S6材料或平台条件检查；没有关闭或跳过本次关系／图谱测试。未安装这些可选环境来消除原跳过项。Vite保留单个约1.41MB minified chunk的体积提示，未调高阈值掩盖，也未在本轮扩为代码拆分项目。构建身份为`ef3e7d0+local-changes`，这是本地未提交候选，不能称CI或发布版本。

## 四原则专项结论与保留边界

本增量专项通过：Host只核当前身份／权限／预算／取消／存储和可读投影；Agent可自主选择零次或多次关系工具，没有后台关系推理、固定分析步骤、业务真伪裁决或逐边审批。复用官方Pi1.4.0／Interface v3、原项目任务生命周期／IPC／M6 resolver／CaseStore和UI正文；新差额是原本没有的业务关系身份／精确版／CAS与图投影，不建第二权威。正常用户进入图→可选展开／搜索→点击节点，不增加配置或发送确认；可选关系管理及UNKNOWN异常处置分别按需展开。独立报告按实际调用链和反例核过，未推断全部既有SDK内部风险已经合规。

保留限制：原CaseBoard概览中CaseCurrentWork／CaseEnterpriseMaterials同用Case ID key的既有React警告，经作者与非作者分别读基线确认，未在本轮顺手改动；console原输出保留，不能宣称零错误。真实大图浏览器延迟、真实Provider／业务材料质量、业务效果和用户产品验收未验证；平移／展开整对象保留由代码链与投影核对，实际返回点验重点是搜索／缩放／焦点；未额外做浏览器断网注入或所有运行中SSE导航组合。其服务端取消／冲突／UNKNOWN及原运行回归按独立测试和完整检查分别记录，不用UI单次成功外推。

Git提交／推送／CI／合并、生产运行采用和MacBook均未执行。当前可供用户核对的是本分支的本地实现与工程证据，批准Demo仍为原设计输入。
