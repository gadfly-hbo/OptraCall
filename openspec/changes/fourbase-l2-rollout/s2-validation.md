# S2 Semantica 隔离验证结果

2026-11-05 · SC-01S · 验证执行完成，存在采用前缺口；停在S2，未进入S3

## 1. 结论和有效范围

**建议保留 Semantica 作为首场景的后台语义组件，后续走原生 Python API＋既有语义工具的最小适配方向。原生 MCP 不宜直接成为本场景的完整查询入口。**

本轮实际证明了：人工明确业务定义、条件和来源后，固定组件能从结构化输入生成候选类／属性、构建图，并在本样例保存重开后读回所需语义；真实SHACL路径能检出所设工程约束负例。它不会仅凭安装就自动取得企业口径，也未证明自然语言问题理解、经营推理或Agent分析质量改善。

本轮也实际检出了查询投影有损、撤回不自动限制新查询、加载失败仍报ready等缺口。**“验证完成”不等于八类能力全部通过，更不等于上线。**这些原始结果保留，不以工程脚本补出的内容冒充组件原生能力。

用户本轮明确授权进入S2、必要依赖安装和工程验证，仅使用脱敏资料与合成数据，完成后给能力／缺口、结果和建议，暂不进入S3。沿用[S1定稿计划](s1-isolated-validation-plan.md)及[首场景六类查询](scenario-scope.md)，无界面变更，UI Demo不适用；原确认稿与UI保持。

## 2. 实际环境、输入及证据

| 项目 | 实际值／边界 |
| --- | --- |
| 工程环境 | arm64／macOS26.3.1，bundled Python3.12.14创建独立venv；未在系统或bundled依赖目录安装 |
| 固定组件 | Semantica0.7.0，wheel SHA-256 `faf27d6259ae813ddb44c5213e2f8867592f27e6e3d6b47cea10f1844513799f`；安装后446件原生包文件与wheel逐件一致，未改包 |
| 验证依赖 | 实际解析69个发行包，含rdflib7.6.0、pyshacl0.40.2、官方MCP Python SDK2.3.0；pip check通过，安装来源／发行hash及完整版本清单留存；本次venv约553MiB，不预写轻量或性能收益 |
| 固定输入 | 获准去标识指标候选、SC-01S合成input、S1字段设计及核心定义四份；先核hash再复制。input SHA-256 `ec996f92bed8c18b5a9809760827a59ddde85d115ad905df96a3dfac7f63372d` |
| 工程图 | 45节点／73边：8候选及工程版本、方法正文、范围／时间／字段角色、未知／歧义、来源和引用探针；未逐笔搬入32订单／16退款，未放控制金额、参考答案或决策结论 |
| 原生主路径 | `OntologyEngine.from_data`、`GraphBuilder.build`、`ContextGraph.add_nodes/add_edges` → `save_to_file/load_from_file`；配置`min_occurrences=1`、`merge_entities=False`、`resolve_conflicts=False`；Python查询使用完整node／edge API |
| 运行隔离 | 本run独立环境、工作目录、临时／日志／缓存；仅工程Python及stdio子进程。运行阶段Python audit拒绝网络与run外写入；不是OS沙箱，不声称覆盖原生扩展全部系统调用 |
| 工程接入 | 官方MCP SDK连接未修改的Semantica stdio server；额外wrapper只记PID／退出及audit。未连接产品Host／原Pi，未注册生产MCP；原Pi1.4.0／Interface v3／真实owner路径留S4 |

固定run根为 `.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/`（下文简称run）。证据留在本机隔离根，未作Git交付或运行采用：

- [环境与发布物](../../../.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/evidence/dependency-closure.json)、[实际导入](../../../.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/evidence/imports-v1.json)、[原生包完整性](../../../.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/evidence/native-package-integrity.json)。
- [建图与往返](../../../.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/evidence/core-v3.json)、[六类结构化查询及反例](../../../.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/evidence/queries-v1.json)、[实际SHACL](../../../.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/evidence/shacl-v3.json)。
- [MCP完整结果](../../../.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/evidence/mcp-v2.json)、[MCP判据回读](../../../.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/evidence/mcp-assessment.json)、[协议负例／EOF停止](../../../.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/evidence/protocol-negative-v1.json)。
- [独立于图的数值复算](../../../.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/evidence/numeric-derived.json)、[事后参考核对](../../../.local/fourbase-l2-s2/sc01s-v0.1/run-20261105T063716Z/evidence/numeric-reference-check.json)。参考留在核对侧，未复制到run inputs或图。

## 3. E01–E08结果

| 编号 | 实际结果 | 证明及限制 |
| --- | --- | --- |
| E01 环境与来源 | 通过本次环境 | 固定wheel安装成功，所需7个模块导入成功，完整解析版本／hash留存，pip check通过；不外推其他Python／系统／新发行。首次所选模块冷导入进程约21.5秒，不是Agent延迟基准 |
| E02 本体语义表达 | 通过本次结构化表达，保留配置条件 | min=1保留13类及单例谓词，定义／条件／未知／歧义有独立身份和依据；min=2反例会少7个单例类。生成的是从已整理实体关系推导的候选类／属性，通用validator的valid不证明业务规则或OWL推理成立 |
| E03 构图与往返 | 本fixture通过，通用字典往返有损 | 45节点／73边的身份、方向、语义metadata、内容及平行声明通过11项核查。另造metadata/properties同键冲突反例时文件格式合并两字典、有损；不能外推任意对象完整往返 |
| E04 六类查询 | Python完整API通过；原生MCP部分满足 | 六类结构化查读共46项断言通过；是已知身份／关系的工程查询，不是自然语言解析或Agent自主检索。MCP node保留节点metadata；neighbors/search删metadata，neighbors折叠平行关系且不返回边证据，完整回答依据仍有缺口 |
| E05 真实约束 | 最小工程约束通过 | OntologyEngine实际生成25条RDF shape三元组；正例命中4个目标实例并符合；删除来源与删除C04减项依赖的负例各检出对应MinCount违规；未知条件仍可表达。执行为pyshacl、inference=none，非完整OWL或经营真值判断；数据为独立4实例RDF探针，并非ContextGraph的45节点／73边导出，全图到RDF／SHACL映射未验证 |
| E06 刷新／撤回／损坏 | 部分满足，发现关键缺口 | 同进程不见文件v2，显式关闭重开后可见v2且旧准确引用保持；撤回指标／来源仍被原生MCP返回。损坏／缺失文件给空结果，summary仍graph_ready=true，未满足失败显式化与新查询准入要求 |
| E07 协议与停止 | 握手／读取／EOF通过；执行中取消未证 | 官方SDK完成6会话、16次读取，实际15项工具清单；全部观察到自然finally和PID退出。原始协议负例收到-32700，EOF后约0.112秒退出且returncode=0、无剩余stdout。快速查询后的取消通知未阻断响应；不能证明在途取消或副作用回滚 |
| E08 数值与语义职责 | 工程复算通过，职责分开 | 独立Python按原支付归属复算A净额133000元、B118000元、差额−15000元，8个跨期／窗外退款及门店上升反例保留，匹配原参考。不是Semantica算出数值、Agent更准、更快或真实独立业务对账的证据 |

六类查询覆盖：指标辨义及减法方向；退款业务时间／截数；条件及未证适用性；字段映射与影响关系；数量歧义及条件扩展；旧引用与显式版本装载。影响链逐段核对相邻边，未执行完整动态影响遍历；expectations中的说明性路径／公式字段不算新增已执行断言。查询结果和工程预期分别留存，图内没有预填六段决策答案；完整候选内容已人工整理，不能把检索正确归因为组件自动学懂原材料。

## 4. 能力与缺口及采用建议

| 能力／缺口 | 实际观察 | 后续最小处理方向（本轮未实施） |
| --- | --- | --- |
| 结构化语义与带源图可用 | 定义、方法四组正文、字段角色、范围、条件、未知和相反声明能存并从Python完整API读回 | 继续整理首场景内容；业务规则由获准资产／来源给定，Semantica组织与查询，不替代SAP／M2／Case权威 |
| 默认频率／合并需显式设置 | 默认频率会丢单例；本轮关闭实体合并及冲突覆盖后，两个同名异义节点和两条平行声明均保持 | S3按准确身份及来源整理，固定已验证配置；同node_id覆盖和schema的完整冲突政策尚未验证，不把“关闭模糊合并”当全部冲突防护 |
| 原生MCP查询投影不足 | node有metadata，neighbors/search无；完整边API保存2条同端点关系，邻居投影只给1个目标 | 后续S4优先评估沿既有semanticContext port薄适配Python完整API，带回节点与边依据、限制及准确Ref；不另建Runtime或图查询引擎。本轮未写适配器 |
| 刷新需要明确装载版本 | 替换同路径文件后旧进程继续读v1，重开读v2 | 单一构建者、版本快照、显式关闭／重载；物理并发／发布合同仍须在实际持久结构实施前收敛，不把同JSON当同步机制 |
| 撤回及加载失败缺口 | active API排除撤回节点，但普通node／MCP仍读出；缺失／损坏图的summary误报ready | 当前权威准入与加载／版本状态需由后续适配显式检查；新查询排除撤回／失权依据，失败返回错误；历史准确引用沿原合同保留。实际Host权限变化未测试 |
| SHACL配置表示兼容限制 | range为`xsd:string`时生成错误datatype；绝对IRI输入又生成非法Turtle；按本发行支持的`string` alias才正确 | 保留两次失败，后续固定受测格式并做目标命中／负例；业务约束待实际资产及适用结构决定，不把工程shape晋升正式schema |
| 存储／错误／取消不是产品合同 | 文件合并metadata/properties同键；业务error藏于正常工具文本；取消notification在原生dispatcher中被忽略 | 后续适配明确字段保真及语义错误处理，复用原Pi公共生命周期管理取消／关闭。实际在途取消、强制终止及迟到接缝留S4验证 |
| Agent收益与真实闭环未知 | 本轮没有Pi分析、真实模型、真实经营资料或人的反馈 | S4验证真实接缝；后续获准条件下同源L1/L2对照，分开初建／维护／运行／人工成本。V404／V405仍未证 |

没有证据要求本轮增加Graphiti、向量库、模型抽取或额外图数据库。这些仍是针对具体缺口再比较的方向；本轮不作跨组件优劣结论。

## 5. 初始失败、隔离观察与保全

- `core-v1`失败来自工程fixture helper的`name`参数与metadata重名；修正后`core-v2`又在将重载metadata传入`add_node`时与保留字段`content`冲突，改用原生`add_nodes`后`core-v3`完成。初稿脚本、失败日志及v2已生成图副本保留；这两次不是产品RED或组件语义失败。
- `shacl-v1`出现错误datatype，`shacl-v2`生成Turtle解析失败；静态核本发行range解析后采用`string` alias，v3正负例通过，原shape／日志／报告未覆盖。
- `mcp-v1`的工程记录器误用SDK旧字段`isError`，实际SDK2.3字段为`is_error`；保留原异常与自然退出记录，v2修正后完成全部读取。不把记录器失败算原生协议不兼容。
- 运行阶段audit没有记录socket连接／DNS／bind事件。最初拒绝了run外stdlib pycache写入／mkdir尝试；早期记录未带路径，补充定点诊断所见路径是bundled Python的字节码缓存，未逐条回溯早期事件；后续关闭bytecode写入再诊断。原事件保留，不宣称原生导入零写入意图或OS隔离已经成立。依赖下载属已授权安装阶段。
- 本轮工程安装目标、脚本和输出限定在run，仓库可见变更仅本报告／result补记；开工前908件身份、原result全文、固定输入和既有S1／确认稿保留。最终保全与独立复核分别见run的`evidence/final-static.json`、`review-spec-v1.md`、`review-standards-v1.md`；它们只证明各自明示的范围。

## 6. 下一步建议及停止位置

**下一步建议批准S3有限资产建设，沿已验证的Python语义组件路径，先形成3核心指标＋1方法的实际资产及准确版本、字段映射和小本体。**既有SAP save→publish及M2合同沿用；所需正式持久表示／生命周期决定按S1与适用结构边界收敛后才写，不把本轮工程fixture当生产本体或发布数据。

原生MCP的完整依据、撤回、失败显式化与生命周期缺口，作为后续S4最小接入适配的输入；当前结果不足以直接接入产品或上线。S3也不能自动视这些缺口已修复。若正式场景需求超出本次已证能力，再补针对性验证或比较替代路径。

**本轮停在S2。**未创建正式SAP／M2／Case记录、未改产品源码／测试／依赖／schema、未接产品Host／Pi、未调用真实或额外模型／embedding／NER、未运行完整OWL reasoner、未启动Explorer／REST／浏览器、未切服务或操作其他设备，未执行Git写入／CI。无实际经营数据与反馈，原完整目标及历史FAIL／UNKNOWN／NOT_PROVED保持。
