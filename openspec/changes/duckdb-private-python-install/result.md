# 私有Python部署修复记录

2026-11-04 · 本地工程检查通过；最终复核、Git／CI与目标安装按后续回执核定。

原MacBookmain bee3ae0和已有数据保留；核心Host运行，私有计算环境缺失已如实记录。已核锁定解释器及扩展的Homebrew绝对依赖；目标macOS26.5.2 arm64。官方下载初始误猜release20260415得到404、宽release列表504保留为来源发现失败，未充作产品RED；现固定官方20260414包、18,349,137字节、archive SHA6f304f4ec30854611f23316578302235fb517cd970519ecdd11a8c4db87fd843，实际Mach-O SHA bf4ea26231212e330b8e9b6f24969a30f894fec88665bf42754070d114ac7fc6，私有目录中真实启动3.14.4/arm64，主加载为@rpath/libpython3.14.dylib。

新worktree codex/duckdb-private-python基于main bee3ae0，与运行中的normal main分离。原两个安装／运行失败、旧DuckDB限定接受、数据／native及L1/M8已交付事实保持。目标TDD、真实安装／原工具、完整检查、非作者、Git/CI和SSH安装回读按实际追加；本记录不提前预写PASS。

## 当前工程证据（Git／MacBook采用前）

安装器已有目标／坏cache的真实CLI RED→GREEN保留；safeextract／边界及pip隔离最终11项通过、0skip，typecheck通过。独立发现并修复pip读取配置导致outside写入：合成SITE配置的真实旧路径外写9类wheel，固定PIP_CONFIG_FILE=/dev/null与非交互选项后只写私有site，原sentinel不变。原首轮测试沙箱遗漏Darwin一个USER配置目录，旧访问范围NOT_PROVED，不追读真实配置或追认；补全阻断后最终GREEN保留。此限制不否定原合成外写缺陷，生产修复跳过全部配置。

Runtime三轮字段／marker／源前缀和一轮封装拒绝共23项通过、0skip，含真实旧Homebrew副本兼容、全私有CPython及用户site隔离、库漂移拒绝；-B身份探针硬化单列等价检查，不补造RED。原主锁SHA54325566f21864e659f4cbd4be375fd413ce83fc8881f10a658cb04e2336f864逐字节不变。

本机隔离默认根实际安装完成，2215份运行文件hash及read-only模式经非作者独立回算，root555／ready444，另ready本体，共2216文件；prefix/basePrefix同私有根、无Homebrew加载路径、三库版本正确。原Pi／Host／受管工具25项通过、0skip，覆盖普通／保护／cold、原工具、XLSX＋DuckDB关联／保存重开／权限／取消／另一owner。数据为合成，仅loopback Provider，没有真实模型／业务分析。

当前证据根 /Users/bendandebaba/OptraCall-artifacts/macbook-duckdb-private-20261104/，作者定点及四轮RED日志在新tree .local/setup-* 与 .local/private-python-portable/runtime/。完整检查、最终非作者双轴／四原则、实际head CI、main合并CI及MacBook实际安装／启动／保全待按真实结果补核；不把本机READY当目标READY。

## 首轮完整检查失败保留

固定candidate e143989305bfc2cbde611e5ead47b5f3ae2200cabcbbb5322d3ab37ca11e4597，855源文件；独立Git／依赖与私有Python环境下npm run check为1404项／1400 PASS／1 FAIL／3 SKIP，测试阶段失败，未进入完整build。原日志validation/full-check.log及failure根只读保留，不沿用定点绿为整包绿。

唯一失败AV03 managed background report created after the SDK turn settles...：原夹具后台python stdout/stderr丢到/dev/null，shell只echo background-started；测试在SDK completed后立即读ready得到ENOENT。原native仅证明shell已返回，不能唯一判定后台调度慢还是早退；after-close可能随后终止尚未就绪者，原根因保持UNKNOWN。已批准只修测试的真实ready限时握手和stderr/退出诊断，保留busy、原稿不存在、未先核算、明确release、drain及准确报告全部断言；不改产品SDK、权限或Host分析流程。新物理copy中因果实验、受影响回归及新完整候选另记。

## 修后固定候选工程核收

新物理validation-v2候选3092337cfe748e3565202ec98a1d653c87c8d32e93021cfe2034e366a271f206，855源文件；官方原installer生成该验证根自己的私有CPython，未拷原venv冒充安装。独立受控诊断在测试copy内延迟Python启动：旧立即read ENOENT后同一进程1032ms生成ready；修后同延迟完整链通过，早退真实Traceback/exit1与超时stderr/nullExit均正确失败。正式候选无新增sleep；目标automatic-flow23项／22通过／0失败／1原条件跳过，tsc通过。原一次根因仍UNKNOWN，原failure根、native／receipt字节不动。

修后npm run check工具实际退出0：1404项／1401通过／0失败／3原条件SKIP，boundary／tsc／build通过。日志SHA8e18a142d34e6e546debf08348e796c21950eaa94e085495ef6ff863ea598a53及check-summary位于validation-v2；保留bundle>500kB提示。spec/standards两位全新非作者对原/新完整候选、全部新增、来源包、实际安装文件／mode、目标/完整检查进行限范围核收，原报告与失败另保留。最后本文仅追加实证/状态，不改已测产品／测试。

四原则：Host仅安装/核依赖与权限，Agent原Pi自主选计算；Pi1.4.0／Interface v3和原owner/profile/工具／普通默认PATH不变；既有原锁／环境继续读，private root不覆盖；用户无新配置或必做动作。没有新UI Demo适用变化，也未扩权或重建Agent机制。当前工程通过不预写Git/CI合并、目标MacBook READY、真实模型专业或用户验收。最终Git／目标回读及保全以PR和仓外采用回执核定，避免自引用提交循环。
