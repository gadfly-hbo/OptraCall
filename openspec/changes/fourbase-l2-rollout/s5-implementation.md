# S5 隔离实施记录

> 当前执行结果（2026-11-06）：原19次任务全部关闭，16条正式链及32份首／终稿独立评价、解盲与采用审计已完成。工程链路可用；完整报告专业质量未达标，5个首次原pair跨候选，完整L2收益未证实。结果及建议统一见[S5能力、缺口与结果](s5-results.md)，最终文件一致性按该页证据核。下文旧计数、暂缓或准备状态均保留历史；不进入S6、Git交付或正式运行采用。

> 当前服务代码为必要参数修正后的v3，完整验证候选code-v4；原T010–T019已在原19次上限内恢复。原612／334件及code-v2事实属于构建与旧运行阶段，当前613／335件身份、检查和限制见末节。

2026-11-05 · 实施中 · 仅脱敏资料与合成数据

用户确认D14.1–D14.9全部A后授权独立环境、必要依赖和符合前置的真实模型验证。后续明确改用MiniMax，其他决定不变。当前完成独立环境与开放工程集成；正式模型研究状态按[S5验证](s5-validation.md)核。未做Git交付、现有服务切换、其他设备、真实经营或S6。

## 固定身份与实际安装

- 工作树为`fourbase-l2-s4/OptraCall`，base为`2b9800bc181b9477109c28c85ab46057ee74243d`。改前994件hash／mode及批准5件原文已保全；原0e3f树和S2／S3／S4历史证据保留。
- 运行根为`/private/tmp/optracall-s5-20261105T121254Z`。固定完整代码候选612件，manifest SHA256为`4267fff079fafe3d515a99fa95868d66816b3e8408205ee29ed904171a0b0bc9`；实际独立生产源码334件（runtime-source-v2），不含tests／openspec／评估答案／凭据。
- 新Python3.12.14 venv按69件固定发行归档及hash安装Semantica0.7.0；新Node依赖沿原lock执行`npm ci --ignore-scripts --no-audit --no-fund`，234包。无复制旧venv、无旧S2／S3导入路径，无全局配置／依赖修改。

## 代码差额与原接口复用

`semantic-trial-assets.ts`通过原ProjectStore、SAP发布／项目启用、方法保存后发布、企业资料和M2接口准备无任务项目。生成去控制值的新分析视图、实际新输入hash／字段位置与准确Ref；保留未确认／工程推断身份。共同平铺语义资料同时供L1／L2，图不独占合法条件或答案。

builder新增一次性完整显式根／Ref／原字节hash参数，实际核M2证据与输入相同，冻结原7种来源字节及2份工程投影；新适用SAP发布版0.2.0沿原发布。readmodel与真实SHACL绑定准确3个指标Ref／版本，保留依赖／方向约束和旧版兼容；不把旧开放样本7日成熟度等断言灌入新变体。

`semantic-trial-host.ts`薄封装原Host及可信binding：无任务源准备→释放Store→离线构图→最终Host启动→原POST新建首task→首次open／messages前绑定实际taskId。每链独立data／projects／企业资料／历史根，顺序一Host；L1不注入graph binding。沿原Resource及close，不另造模型循环或生命周期。

包装器仅做词法根检查，不能当任意调用者的物理隔离保证。本轮可信driver逐段lstat／realpath核实际根无链接、规范且互不包含，真实managed沙箱再验证允许及拒绝；共享源码／依赖的只读性指managed工具限制及固定hash，不宣称文件所有者本身不可写。

## 模型、费用与样本

原MiMo没有模型请求。用户明确换MiniMax后选现有`MiniMax-M3.1-Flash`、`minimax-cn`、`anthropic-messages`与原`https://api.minimaxi.com/anthropic`；源revision5、thinkingLevel未设。锁定SDK实际识别原生型号，未套32000／4096的custom默认。新隔离配置走原保存接口，实际task配置另记source→target revision映射，项目准备时public配置保留历史，不手改原持久文件。

MiniMax官方订阅规则、选定Key类型和额度GET证据已留存。用户确认S5独占、自动续费已关闭、无自动接续积分包；仅用现有订阅，无按量／fallback／购买／充值。全部角色、重试、失败和取消均计入原100元新增支出与19次任务启动上限，既有订阅分摊成本未知不记免费。

独立准备者已封存6个新变体及逐项金标准，合法材料和gold分根，原手算事实表与独立重算相符。root与代码作者不读取封存答案／输入金额，正式评分由非作者另做；材料准备者不是最终独立评价者。19条中16条managed正式链、2条unmanaged开放冒烟、1条取消，正式首稿主评、原自动链次评，最多一次作者修订；任务失败不从分母删除或追加挑选。

## 工程与边界

实际开放工程集成在两种普通模式都沿原HTTP／Pi取得六类图操作，并在下一轮请求和native保存；原SDK发生的上下文压缩保留，不将fixture修正当产品修复。managed实际权限探针和完整检查见[S5验证](s5-validation.md)。这些使用本地受控协议Provider，不冒充真实模型采用或专业质量。

证据根为`.local/fourbase-l2-s5/run-20261105T121254Z/evidence/`：`before`、`approved-files`、`code-candidate-v1／v2`、`runtime-source-v1／v2`、独立安装回执、`builder`、`assets`、`runner`、`open-integration`、`materials`及`minimax-*`。历史RED、fixture错误、首轮全量失败与UNKNOWN保留，不覆盖为最终PASS。

## 公开输入结构兼容修正

封存准备者只回报顶层键结构，指出新合法输入使用conditions而无旧scope／synthetic_assumptions。代码作者未读取私有金额或gold；另用公开合成夹具经原M2固定新输入，实际RED为KeyError(scope)，修后GREEN。条件节点只投影实际存在的scope／periods及synthetic_assumptions／conditions，来源locator对应真实键；两类条件并存时保留各自封装，不静默合并。原封存字节／gold／评分协议不改，T003原失败现场保留，全部正式图改以v2准确来源重建，旧候选／旧图保留。完整Python复验70／70通过；完整Node v3退出0：1495通过／0失败／30原有跳过；非作者受影响复核按实际回执核。

## 实际维护与运行前完整性

公共已知合成材料另建maintenance根，原Store与准确Ref经新企业修订／新M2说明形成两代快照，当前源资格、错误快照、graph-off原L1 HTTP兼容和资源收尾九项实测通过；旧代完整保留，不动19研究链。非作者按21份证据及旧代16文件核通过。

两个开放模型任务均已保存报告，正式研究按冻结次序开展。每次新任务前外部operator实际校验334源码文件及19916依赖条目；依赖基准是另一次同lock、禁install scripts的独立安装，并逐件比较字节／mode／symlink target／文件集合，不以清单自身hash冒充实际树未变。ignored driver错误仅存安全固定文案，凭据解析异常不写原text。原worker不继承HOME变量，原Host通过每链dataRoot/pi明确指定Pi资源根；operator自己的HOME/TMP与每链运行根分开，不宣传所有子进程有独立HOME或unmanaged具备盲测隔离。

操作观察边界：最初study-driver-v1及实际首轮driver已在首次真实请求前固定默认单链20分钟、最多再观察2分钟收尾；所有正式两臂一致，未传单独max-ms覆盖。到时仅沿原stop／close收尾并保留取消／未交付，不重开补样本；首稿主评与整链次评分开。该operator观察上限不是模型正确性门槛，不把时限内技术完成当专业通过。实际触发情况按每attempt stop-requested和原chain/native核。

## 已应用的参数声明修正与续跑

原始9次任务（2开放、7正式）全部正常close后退役旧coordinator；终止码143属于operator，不改成模型失败。锁定SDK丢失顶层Union字段已用三种实际schema／本地Provider复现。复用public before_provider_request从已注册原参数派生wire字段，只clone当前payload，不改registry参数／schema／symbols、不注入未注册工具，不改其他API、原graphDescription、模型或owner/profile。

修正的原ProjectAgent实际SDK回归、120组验参等价、追加工具保全及非作者原型证据完整保留。必要source变更为project-session的公共hook与semantic-context-wire.ts；原semantic-context-runtime测试新增实际回归，旧断言前缀不改。全量中发现旧SIM测试terminal/公共idle等待条件不足，另以同GET权威snapshot.idle加强test-only同步；生产生命周期与busy门禁没有改变，轻载未复现及原FAIL均保留。

当前code-v4／runtime-v3及完整fullcheck-v5和非作者续测准入见[S5验证](s5-validation.md)。v2构图身份、原始9来源、Store／实际Ref／graph snapshot与剩余项目不改；新serving adapter明确区分构建与运行版本，每条真实任务前再核实际源码／Node依赖／供应商配额。用户明确额度足够可直接调用，已恢复原T010–T019，不增加次数、不另组题、不换first/repeat，不把跨v2/v3结果混为固定候选的完整收益。
