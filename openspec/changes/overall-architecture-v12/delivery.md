# v1.2 交付、运行采用与用户验收准备

2026-11-18。本文为双机采用、用户验收准备及本变更原位归档记录。用户在独立产品PM关闭R1后明确“按顺序推进你的建议”，授权Git/CI/合并、最新正式资料保全与兼容回退准备、双机服务采用及用户验收准备；本日明确MacBook SSH已恢复。真实模型/业务实验、SDK升级及用户最终产品验收不由交付授权启动。

## 当前顺序状态

| 步骤 | 完成事实 | 待办 |
| --- | --- | --- |
| G1 Git/CI | 产品PR #80已squash合并；PR head 4c62412、合并后main d05a的实际CI分别成功 | 本次原位归档仅记录，不改变产品运行代码；归档提交本身的Git/CI按实际回执核定 |
| G2 资料与回退 | 两机各两套完整四根备份通过；兼容fa21＋只读讨论附件已在两机本地准备，隔离核验及独立复核通过 | 兼容组合为待命恢复，正式回退未执行 |
| G3 正式采用 | Mini和Book均已从原入口实际运行固定d05a；版本、进程、静态资产与原资料保全通过 | Mini观察正式界面；Book本轮核HTTP前端资源及运行，未做逐页UI交互或PPT转换验证 |
| G4 用户验收准备 | 两机实际入口、运行提交和具体试用场景已提供 | 最终产品验收由用户完成；自由模型采用、专业正确及经营效果另核 |

本轮本地原始输出、候选清单和备份/采用回执保存在工作树`.local/v12-delivery/`，不在旧固定证据路径重跑。MacBook此前SSH255/超时保持历史；本次连接恢复不追溯改写其未采用快照。检查和采用均绑定准确版本与观察时点，不从按钮、提示词、CI或Pi多会话能力推定专业/产品验收。

## Git交付、准确候选与CI

- PR：[v1.2交付 #80](https://github.com/gadfly-hbo/OptraCall/pull/80)。提交`4c62412eea44b110207d20fa8ba468cd7354ec23`，squash main `d05a7b3706b987f64d9d6fa72ea14869fba1efdd`，tree `b36dcc9b89f12596245b907145a3cd6fa3446f1a`，两树一致。
- [PR实际head CI 44107159958](https://github.com/gadfly-hbo/OptraCall/actions/runs/44107159958)及[main push CI 44110818103](https://github.com/gadfly-hbo/OptraCall/actions/runs/44110818103)分别SUCCESS；每轮3005项、2808 PASS／197 SKIP／0 FAIL／0 cancelled。类型、构建及高危依赖审计通过，2项moderate没有借此升级SDK；SKIP不当成执行通过。main CI本日已重新只读核实仍为准确d05a的push/completed/success。
- 原PM复核100文件组合`6e52f593786aa552eecb8c8477539d6e1cb9b9ec83cf31b448ee90b5a20cd402`，68运行/测试/脚本组合`399f0770ef7c3c2d72478be0098f945f6175e9fa2475e7ce28c3292c925d3fd2`；PM报告SHA256 `e7c34db7dd4ba33f31efcd2e1eb9d21706fd96a109b79f33297b4997e8ac6ef5`，R1详见[修正记录](pm01-r1-result.md)。
- 原100文件/清单/PM报告在`reviewed-source/`及同根完整保全。Git101文件清单`git-candidate-02.json`摘要`a55c21fb88ccb8555481d26013875ad36a5f7686dd7312bd5e86386814d96f64`；增加交付记录及文档时点/末尾空行修正，68运行集不变。原本地完整2894 PASS／111 SKIP／0 FAIL仍对应原候选，不替代CI；环境SKIP差异另有逐项回读。

CI原日志与准确head/checkout核对位于`review/git-ci/`、`review/main-ci/`及`main-ci-success.json`。最初暂存EOF检查失败和过期全局credential helper造成的push128保留；已修正文档尾空行，并仅对该次Git命令使用现有有效gh凭据适配，不改全局配置。

## Mac mini实际采用

新独立release为`/Users/bendandebaba/.local/share/optracall/releases/v12-20261117-d05a7b3706b9`，准确commit/tree见上，构建`2026-11-17T16:03:47.651Z`、dirty=false；正式入口`http://127.0.0.1:4173/`。采用时instance `9f57510d-a83f-469e-ab8a-5f979e1bfa75`，wrapper66702→Host66703。Pi1.4.0、undici8.12.2与原授权版本一致，未改/升级SDK。

最新同机备份`/Users/bendandebaba/.local/share/optracall/backups/v12-d05a7b3706b9-20261117T170911Z-mini-ad7222b0`，before-stop/stopped各完整包含`.optracall`、`OptraCallProjects`、外部semantic runRoot及完整semantic runtime。非作者独立重hash21690/21687 entries，零差异；每阶段3个SQLite只在另建scratch副本quick_check，冻结原库不打开SQLite连接。

原旧服务正常停止、新版通过原入口启动；G2/start/Desktop实际退出均0。新Host/控制/父子进程/4静态构建文件一致，停止基线到新版仅8项准确控制、锁、新日志及父mtime差异。正式UI观察后独立四根双读零漂移、相对采用verifier零新增差异。三原名Desktop包装先保全旧字节，再逐份原子rename及SHA/0755回读；0临时残留，不把三次rename称整体事务。无关开发服务未停。

证据：`g3-executions/mini-20261117T170911Z-e58d7b/`、`review/mini-adoption/{verdict.json,review.md}`。非作者只签实际版本/进程/静态资产/备份与资料保全/桌面入口；`formal-ui-mini/`的原战略页、GSA默认/BSC按需、用途设置及无Project限选说明由Root通过实际正式前端只读观察。没有保存用途、创建正式Goal/讨论/Plan/Task或发送模型。

## MacBook实际采用

2026-11-18重新只读核：`/Users/huangbo/Dev/OptraCall`为官方独立main浅克隆、clean `3a529a0e381bf67b998f2b1debd242a5eed38884`，push DISABLED；四根canonical存在，未见新Goal/讨论/用途记录。4173 connection-refused，lsof出口1且stdout/stderr为空、无正式clone/release进程、无instance/operation.lock。服务已经停止，停止过程与旧Host退出码未被本轮观察，保持UNKNOWN，不伪造正常停止回执，也不为旧G2检查前置启动旧服务。

已停机备份v2复用原G2的paths/copy/manifest/SQLite函数，经全新非作者复核后实际执行退出0/PASS。最新同机根为`/Users/huangbo/.local/share/optracall/backups/v12-d05a7b3706b9-20261117T235608Z-macbook-already-stopped-6e95efa5`；before-stop与stopped均准确标already-stopped，各24254 entries，四根源漂移/副本差异为0，各3个SQLite只在独立scratch副本quick_check通过。末次停机检查之后追加源manifest，原末端普通资料变化漏检F1已由独立同一反例关闭；原v1/RED保留。原G2-result字节SHA256为`5b06be7ec4c1d24feff0868a05951d1163aeb63b6f92d0d7efa733ae4525dae5`。未调用stop/start，停止前过程和观察后窗口仍UNKNOWN。实际执行与只读摘要位于`book-resume/20261117T233414Z/g2-20261117T235611Z-9a4d74/`。

兼容准备首轮16件code-only接收成功；Book本机prepare在dist内层白名单处退出1，尚未build/targeted/launcher/sidecar或正式启动。原因是原macOS归档含7份AppleDouble元信息，最初独立门只覆盖外层包与静态边界，内层实际覆盖缺口及首轮失败均保留。新r2只精确核准7份既定元信息的名称/类型/长度/hash及两固定目录，核验后只落5个原产品文件；未知或篡改仍拒绝。原冻结archive/组合/SDK不改，新增17项独立内层正反例通过，r2使用全新`-r2` inbox/release，不复用或清理原失败根。证据分别位于`book-compat-plan-20261118-r2/`、`review/book-adoption/compat-r2-*`及首轮`book-resume/20261117T233414Z/compat-20261117T235136Z-072960/`。

第二次连接前的r2投递因SSH超时退出255，未执行远端接收；重核原连接超时、已知Bonjour未解析，主机密钥校验保持。用户再次确认SSH恢复后才接续，以有时限的系统防休眠进程保护操作期，不改永久电源配置。r2随后实际接收16件通过，Book独立构建fa21成功，4项新格式回归通过；隔离原launcher同实例启动、4静态资源回读、Goal GET200／新讨论GET404及正常停止通过。额外单目录Node读取限制挡住原有逐层祖先检查，sidecar正控返回ERR_ACCESS_DENIED，原prepare退出1和日志保留。补验只使用原已审CLI、原副作用探针和新合成根，未改读取器、SDK、正式权限或旧失败根；准确哈希取得预期UTF-16分页、错误完整哈希拒绝且无正文、合成内容和空HOME零改变。非作者独立核定1700原源码文件、20380依赖普通文件及13内部链接、20380不同inode、Book本机构建及6份原日志准确，兼容组合就绪。证据为`book-resume/continue-20261118T014102Z/compat-*`、`book-compat-sidecar-followup-20261118/`与`review/book-adoption/compat-actual-ready-verdict.json`；Book兼容包仍仅待命，不在正式资料上启动。

正式更新前重新检查Book已停、干净main及两份备份与当前四根，源差异0。使用原main-only updater与原操作锁，核准确d05a的main成功CI后快进、按锁安装并构建；原固定目标钩子只允许d05a。原更新及原启动均退出0，Book源码仍在`/Users/huangbo/Dev/OptraCall`，三个原clone入口不需换指向。运行commit `d05a7b3706b987f64d9d6fa72ea14869fba1efdd`、tree `b36dcc9b89f12596245b907145a3cd6fa3446f1a`，构建`2026-11-18T01:52:13.556Z`，dirty=false；采用时实例`f5719ce3-b83d-4b1d-8dce-d9ed02d8ab8e`，wrapper16144→Host16145；使用Book私有Node25.9.0、Pi1.4.0和undici8.12.2。该机入口`http://127.0.0.1:4173/`。

启动后实际只读校验退出0：确认扫描前后同实例，私有Node/进程归属/控制文件与源码及4个磁盘、HTTP静态资源哈希一致；两阶段共8个冻结备份根重新哈希无差异，实时四根双读零漂移。相对已停机基线仅8项明确的控制、锁、日志及父目录mtime变化，其他字节、业务元信息和目录变化均为0。未打开正式SQLite或调用模型/业务API。旧Host退出、全域idle/drain及有界采集后的窗口保持UNKNOWN。实际回执位于`book-resume/continue-20261118T014102Z/formal-update-20261118T015136Z/`；Book本机结果SHA256 `10f6c9622eb1af2523395f2271c9f8a1940124567f75093cbae2afbdf445a8c7`。非作者独立通过当前四根全量回读（与正式采集四根差异0）、同一实例/控制/父子进程、实际源码与HTTP静态资产校验；原clone三个启动、停止和更新入口均为0755，字节与旧3a及固定d05a对应Git文件一致，无需改桌面。独立证据在`review/book-adoption/`。本轮没有为部署证明写入Goal schema3。

## 兼容组合、迁移与回退边界

兼容旧3a行为的产品包为`fa21cb5c286e88bd9acb7694b5fd6e3a51c8334a`，tree `d79c85dd88a8af15e1682daf9ba4aaae12f72890`；Mini准备在`/Users/bendandebaba/.local/share/optracall/releases/v12-compat-20261117-3a529a0e-storage`。完整检查2819 PASS／111 SKIP／0 FAIL；原launcher隔离启动/版本/新记录读取/停止/保全及最终非作者product24/24、sidecar21/21通过。最终门`review/rollback/fa21cb5-independent-20261118/g3-compatibility-gate.json`，SHA256 `b2aab274c600f67662471592302a641e03d1f0d715b48f9c9384eb42b0ec08e4`，绑定`compatibility/recovery-combination.json` SHA256 `9990afeece9d0a9a17114dba232f935bc9a439e1cb81018588979b7c913019a5`；原作者manifest当时PENDING与后来独立门分别保留。

该组合可读Goal1/2/3及Plan新增字段并保留后来合法资料；受新语义影响的继续工作只读/派发前拒绝，旧独立工作可继续。只读讨论附件沿准确owner/session/entry/hash窄读原native，不提供新版讨论UI/HTTP；继续/修改新讨论应恢复v1.2。它不等同完整新版功能，不把同一新版副本冒称旧行为回退。正式回退没有执行。

本轮Goal schema3指原`strategy-goals/index.json`格式，不与Board/GSA/Case版本混淆。旧schema1/2只读不强迁移，首次合法新增格式写入才升级；不为部署证明强造正式目标/战略/决定。回退不使用旧库覆盖后来成果；若异常，先保全届时最新资料和现场、正常停止，再按已核组合与隔离副本处理。关键不兼容/未知需保持受影响隔离，不自动启动未兼容旧3a或剪裁native。

## 用户验收准备与分层

可体验的增量：原战略页自然语言讨论；GSA直接承接且BSC按需展开；默认组织/部门/个人用途与本工作用途分开；明确背景范围内自主查找/准确窄读与手选限定/排除；开放方法组合及更换保留原讨论/资料；候选经用户采用进入原Goal/GSA准确版本，再沿Case/Project轻量方案和单/多Task承接。两种确认、明确Task综合、逐稿审查、原反馈与资产治理继续沿原能力。范围冲突保留输入与原native，不自动重发或暗换latest。

用户可在准确设备/版本下逐项记录操作、预期与实际、PASS/FAIL/NOT_RUN/UNKNOWN及可公开截图。原R1反例已有独立产品PM关闭，不通过改写正式旧记录重演；需要复现时复用已固定的合成隔离证据。具体试用入口及场景见[当前版本试用说明](../../../docs/current-version-trial.md)。

| 层次 | 本轮状态 |
| --- | --- |
| 工程实现与合成接线 | 原主体/PM01/R1工程差额已关闭；Git/CI已交付，未重开已闭合范围 |
| 运行采用 | Mini与Book分别实际采用d05a，版本、静态资源、原资料各自回读；运行快照绑定观察时点 |
| 真实Agent自主采用 | 本轮未跑自由模型，不由合成Provider/提示词/目录返回推定 |
| 专业正确 | TOC/TP与所选Skill/IR实质采用、方法组合、因果/综合/补证/审查质量等待验证 |
| 用户产品验收 | 场景准备；尚未由用户对固定候选给出实现验收结论 |
| 经营效果 | 待真实行动与成熟窗口，不预设找到根因或业绩改善 |

原FAIL/UNKNOWN/SKIP、已接受限范围NOT_PROVED、四份旧GREEN不可恢复及归属UNKNOWN、已知依赖自链接事故和撤回隔离声明、原PPT FAIL/check03 GET409/Book.git严格mtime FAIL及写入者UNKNOWN均保留。本轮兼容中间H14/H16/H18、sidecar与夹具失败、G2/G3操作包RED和中间回归另保留，不用后来绿色覆盖历史。操作包作者一度把自己的连续编辑误判为“他人写入”，已据原trace纠正为作者自身；与旧四GREEN归属UNKNOWN分开。全域idle/drain无统一证明，detached旧Host退出码UNKNOWN，与原launcher命令退出0分别记。

本变更规格、批准、实施、验收与证据索引留在本目录原位归档。归档提交只维护本文、规格/任务/结果和试用说明，设备运行仍固定产品提交d05a，不为纯文档归档重复安装或重启。归档自身的PR/main提交与CI事实按Git／Actions和本机回执给出，不在本页自引用。用户最终产品验收、专业验证和经营观察继续各自记录。
