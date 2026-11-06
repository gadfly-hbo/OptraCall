# S3 有限资产与带源图验证结果

2026-11-05 · D12七项A已批准并实施 · 隔离合成工程验证 · 停在S3

## 1. 交付范围

已完成本次S3的首切片和有限资产建设：先实现准确版本／hash核对、当前有效来源筛选、加载失败保护，再用原Store实际发布的3指标、1方法、企业资料修订与M2输入／说明构建小本体和带源图。不是把S2 fixture直接改名，也没有新增产品页面或用户必做步骤。

当前实现是[私有工程模块](../../../scripts/fourbase_l2/README.md)，不接产品Host／Pi，不建立另一套业务权威。SAP、方法、企业资料、M2仍各自权威；图只读派生、可重建、不写回。S4工具接线、真实Agent分析、运行采用及真实经营闭环尚未开展；不能据本结果宣称Agent已更快、更准或Semantica已在产品上线。

本次run为`.local/fourbase-l2-s3/sc01s-v0.1/run-20261105T075754Z/`。下文证据名均相对其`evidence/`，完整执行材料只留本机隔离根。上一轮原合同资产及失败仍在`run-20261105T072031Z/`，S2仍在`run-20261105T063716Z/`，未覆写。

## 2. 基线与实际资产

活动工作树仍为`codex/four-base-L2@57742b99d173bfa6413e83705682b0444359add4`。准确原Store／validator源来自固定`2b9800bc181b9477109c28c85ab46057ee74243d`的185文件只读投影，范围为run/source/src及run/source/extensions全部文件，未改原实现；投影顶层package.json／package-lock.json是此前工程yaml安装的私有依赖元数据，不计入原源码不变声明。Node25.9.0和隔离投影已有yaml2.9.1继续复用。Python3.12.14／Semantica0.7.0沿S2已有venv，只读使用，未新装依赖、Graphiti或LLM组件。

| 对象 | 实际隔离身份／内容 |
| --- | --- |
| SAP | `optracall-sc01s-retail@0.1.0`；C02 `terminal_sales_amount`、C03 `retail_refund_amount`、C04 `net_retail_sales`，仍按同包原发布粒度 |
| SAP发布字节hash | `1b368f8991b31a87d3021d6d0e9fc436835b65cf93da092a8d0b9e40184f94a5` |
| 方法 | `9e8cc37d-46ba-4e63-b14f-d617f82af3cf@1`；S1原四组conditions／logic／judgment／limits，other／manual |
| 方法发布内容hash | `d3f9370863d758d4194205687898541918e8a6df0a5a1c764c50f334cdcaa456` |
| 输入／说明 | 原固定输入`394dcc76-2143-46a3-bb85-49dec333f7d7`；说明`62654ca5-6c83-4586-a875-9dffc6df75cb`；337个不同JSON Pointer |
| 修正版第一代快照 | `5e982ef2-e411-402b-a254-ece186dc6e9e`，原企业修订`b25b8511-330d-4be3-96b8-c5953eba1312` |
| 修正版第二代快照 | `fbaba342-4e0d-41d0-8196-1ee27b34d13c`，工程说明更新后的修订`ea6326f9-cdaa-4337-9cec-2ec74646a424`；业务口径未借更新被重新确认 |

两代均为54节点／63边、8类小本体。保留准确指标／方法版本、概念、来源修订、输入版、声明、条件和字段角色。原生OntologyEngine由同一实际图生成候选本体，`min_occurrences=1`、`build_hierarchy=False`；保留原生类名规范化结果，不声称已完成企业本体治理或OWL推理。

每代只含原生`graph.json`、候选`ontology.json`和`receipt.json`。回执固定Semantica组件hash、输入及图／本体实际hash。修正版每代冻结9项：准确SAP原发布YAML、方法原版本JSON、企业准确修订原正文TXT、M2原输入record及原说明JSON、原获准摘录与合成输入JSON共7份原记录字节；另加解析SAP与复合企业API响应的2份JSON工程投影，显式标engineering-design，供原JSON定位使用，不冒充原发布字节。不复制会变化的原Store索引。

原JSON记录与权威payload一致、SAP字节与原library及observedHash一致、企业正文与准确修订bodySha256／正文一致后才冻结。**冻结文件hash核实际原件／工程投影各自的字节；SAP／方法publishedHash仍核原发布字节／内容，版本记录整体hash不替代方法内容hash。** 企业当前enabled、方法治理及权限资格不由冻结输入替代。修前两代`b142be76…`／`ddad4762…`和原7项输入保持原字节，仅作已发现问题候选的历史证据，不作为最终候选。

## 3. D12逐项落实

| 已批准决定 | 实际实现与证据 |
| --- | --- |
| D12.1 权威／粒度 | 原Store读取，8类派生对象；无公式／事实第二写库。原发布资产与337映射复用，不补造Case或业务确认 |
| D12.2 身份／字段 | 按原canonical的UTF-16键排序；身份排除publishedHash，省略／null／已知hash不分裂同一版；冲突拒绝。原生磁盘properties与完整API往返逐项核对，保留平行边；核心原21项及修后22项均留证 |
| D12.3 来源／关系 | 节点和每条边保留所有必要来源，正文不借其他可用来源洗白；C04两操作数及减项角色固定，未采用概念只保留声明／待核条件；实际图六类检查及SHACL反例 |
| D12.4 保存／版本 | 新UUID目录、先图与本体后独占回执，校验成功才返回；无global current／覆盖旧版。两代都实际创建，原记录字节及投影分开冻结，旧三件hash不变；`scene-acceptance-corrected-v1.json` |
| D12.5 当前资格 | 每次查询批量重查原准确Ref、enabled及方法confirmed错误；五种既有Ref，无新Ref／M2 schema；同一已加载实例观察到停用／恢复，`authority-final-v2.json`及实际场景回执 |
| D12.6 失败／刷新 | 选准确UUID、不回退latest；缺失／损坏／错hash／错身份／半写／空核心／路径或链接异常先失败，再禁止原生装载。旧快照重新读取也核当前资格；`test_readmodel.py`与实际两代回执 |
| D12.7 阶段／验收 | 真实行为RED、最小实现、45项修后整合回归、实际全图约束与六类查读；原独立规格2项P2及其修正／复验分别保留，不以作者报告代替 |

没有未批准的结构偏离。未采用概念的候选依赖留在来源声明和Condition中，不创建只有正式资产版才允许的depends_on／requires／has_source边。真实成熟度两项仍unknown，所有M2映射业务confirmed仍false。

## 4. 验证结果

### 4.1 首切片与回归

修后完整私有模块回归45项通过、0失败、0跳过：核心身份／装载／筛选22项、实际原Store来源检查9项、图约束9项、场景构建4项、复制原库实际构建并核原记录字节1项。日志`integrated-unit-v3.stderr.log`，退出码0；Python audit记录无事件。修前41项通过仍保留，不能覆盖独立发现；第一轮遗漏显式authority根而跳过该类，原`integrated-unit-v1`保留，不算完整通过。

新增authority.mjs的Node语法检查通过。额外尝试既有会话边界检查器，因活动工作树未安装typescript而在导入阶段退出，原日志保留于`auxiliary-checks.json`及对应stderr；不计通过。本次未改TypeScript产品源码、会话接线或主项目依赖，未为此安装完整产品依赖，也未运行／宣称全应用npm检查通过；适用验收为本私有模块的完整回归及隔离原Store／Semantica实际路径。

| 验收 | 实际观察 |
| --- | --- |
| S3A01 准确版 | 三核心、方法、M2和原企业修订准确读取；错误版／hash、同键冲突及空字符串方法hash拒绝；省略／null合法hash保持原语义与missing-hash限制 |
| S3A02 当前筛选 | 复制隔离库通过原Store停用来源，同一图查询变partial，只剩3个无该必要来源节点、0边；三核心与方法不再返回，停用来源定位／正文不泄出；禁用时新构建拒绝。重新启用恢复54节点。方法confirmed错误后默认查询排除，但原历史getPublished及issue仍可核 |
| S3A03 加载失败 | 缺回执、损坏JSON／hash、半写、错UUID、核心缺失、方法缺少任一已声明核心依赖、越界／软硬链接、冻结输入损坏及来源不明／错版均有明确失败；校验在原生加载之前，旧文件与失败目录保留 |
| S3A04 业务语义 | 3正式指标＋1正式方法，小本体、GMV辨义、数量冲突、支付归属／退款事件时间、7天合成截数、真实成熟未知、字段角色与源限制均可查；不把要求写成条件成立 |
| S3A05 原生往返 | 实际GraphBuilder／ContextGraph保存，销毁工程调用后新实例load，完整节点／边API逐项核metadata、来源、操作数、两条同端点异依据version_of关系；原生保留content副本逐项核同值 |
| S3A06 六类查询 | 修正版`scene-acceptance-corrected-v1.json`中15项结构断言全真；原生PathFinder在本有限依赖视图找到2条预期完整影响路径；下节限定遍历口径 |
| S3A07 实际图约束 | 同一54／63完整图投影后经Semantica OntologyEngine→pyshacl实跑正负例，下节列命中与失败数；无LLM或OWL真值推理 |
| S3A08 更新／恢复 | 原Store已实际生成新企业修订；修正后沿已存在的准确两修订分别重建两代，不重复业务写入。两代显式装载可读，准确新旧Ref分别保留，C04业务版身份稳定，旧三文件hash不变。独立复核和最终保全以本run对应报告为准 |

### 4.2 六类问题与实际全图约束

六类查读覆盖：①GMV／成交额／退款额／零售额及减项；②原支付归属、退款事件时间与未知成熟；③方法四组及适用要求；④337位置映射、来源定位与影响关系；⑤数量歧义、暂缓扩展、渠道分母区别；⑥准确版本及来源回溯。金额核心不依赖有争议数量，C04无直接原始净额映射，原合成数值答案未预填图。

影响查读由查询后合格的完整图构造有限依赖视图，只将depends_on反向用于影响方向，maps_to保持原方向；Semantica原生PathFinder返回`订单关联字段→C03→方法`和`订单关联字段→C03→C04→方法`两条预期路径。该结果只证明本有限依赖视图的遍历，不代表任意图全部路径枚举、计算已经执行或经营因果成立。

修正版实际原生图全部54节点／63边投影为4,105 RDF triples；213条shape triples。NodeShape命中54、EdgeShape63、EvidenceShape117、ConditionShape10、MethodDependencyShape1，两个真实成熟未知条件不被提升。MetricRefShape／MethodRefShape属于嵌套引用形状，无直接target；准确Ref验证还由原Store和装载器执行，不把0个直接target报告为已独立命中。

| 全图病例 | conforms／违规数 | 预期 |
| --- | --- | --- |
| 原图 | true／0 | 通过 |
| 删除一条Statement全部来源 | false／1 | 正确拒绝 |
| 删除C04减项依赖 | false／1 | 正确拒绝 |
| 对调C04两操作数角色 | false／4 | 正确拒绝 |
| 删除方法→C02／C03，只保留C04 | false／2 | 正确拒绝 |
| 保持两项unknown | true／0 | 未知允许保留 |

修正版完整映射、target命中、原生图／9输入前后hash及原始SHACL报告见`constraints-actual-summary-corrected-v2.json`及同名前缀TTL／JSON；修前a2及其说明保留，不能沿用为新约束验证。这些实际图检查不以独立玩具RDF替代。

## 5. 失败、修正与证据保全

核心装载／来源、权威适配、约束与构建各有可执行错误实现导致的真实断言RED及源码副本；不是导入或fixture错误冒充产品失败。`core-red-v1`、`authority-red-v2`、`constraints-red-isolated`、`builder-red-v1`分别保留，后续GREEN及最终代码hash独立记录。

整合实跑还暴露两项并修复：来源修订节点具有自身Ref及另一必要来源时，准确自身身份选择应与全部来源准入分开；未采用概念不能占用正式资产关系方向。前者有`core-red-composite-v1`→`core-green-v4`，后者有`builder-direction-red`及永久回归。最初两次实际构建分别在写快照之前失败，保留`scene-native-build-v1/v2`，第三次成功。原方法Ref的空字符串hash试放宽不符合原reader合同，已恢复拒绝并加反例，试验原记录不删。

约束探针首次结果记录器用JSON键顺序比较导致失败，保留attempt1，改用规范化比较后的a2才作实际结果。初次约束RED曾从repo cwd执行，写入仍被audit限制在run，原现场保留；相同字节随后从run cwd重跑。可选openai库缺失只产生日志，本轮无LLM调用，不以安装LLM组件消警告。

独立规格v1实际发现两项P2，原报告不改写：①方法只核至少一条依赖，删去已声明C02／C03仍可加载且SHACL通过；②冻结JSON投影未保存D12原发布字节。修正分别有真实RED及永久回归：loader／SHACL部分依赖子项失败后补齐全三项和唯一方法约束；复制实际库构建后5条原字节／性质断言失败，再补7份原字节与2份工程投影。前者见`method-fix-result-v1.json`，后者见`byte-copy-red/green.*`。新45项回归与修正版实际图查读／六例SHACL通过，修前候选和旧两代均保留。

修后全图探针第一次更名时误改UUID片段，读取前失败；原脚本／日志保留，不算图失败或产品RED。仅修记录器准确UUID后，以`actual-constraints-corrected-v2`重新完成六例，产品模块未因此修改。

本次开工前913文件身份和三个旧文档全文已保全。获准修改仅D12确认状态、进展与结果记录，新增私有脚本／测试／README及本报告；原讨论稿／spec／计划／UI、去标识源、合成输入、参考答案、旧资产与历史证据均应零漂移。最终文件清单、链接／语法检查、旧S2／S3的166／77件保全和无残留锁检查见`final-static.json`。audit仅为Python工程审计，不声称OS级沙箱或Node全部系统调用审计。

## 6. 独立复核与四原则

完整候选最初固定于`candidate-v1.json`，补记检查器导入失败后固定为v2。全新非作者规格／正确性轴v1发现2项P2，标准／职责复用轴v1为0必须修复；两份原报告保留。修正与新证据另固定`candidate-v3.json`，两轴受影响复验分别写`review-spec-v2.md`、`review-standards-v2.md`。作者测试与本报告不替代这些结论，也不预写尚未返回的复验结果。最终收尾状态以本run的复核报告、`closeout.json`和`final-static.json`共同核定。

本轮专项检查范围是隔离工程模块及其原Store接缝：环境侧提供准确资料、来源资格及失败状态，不补算经营结论；没有会话／推理循环，未重建Pi原语。新增适配对应S2已观察的有损MCP、撤回未筛选和损坏仍ready缺口，Semantica包及原Store均未改。无前端变更、正常新增用户必做0，原“业务含义在可选回答依据内”定位不变。真实Host owner／权限、Pi1.4.0／Interface v3会话接线及产品体验留S4验证，不能从工程资格回调推定通过。

## 7. 留给后续阶段的边界

S2原生MCP的元数据／平行边有损、撤回和ready问题仍是原组件事实；本S3经Python完整API与私有适配完成隔离保护，没有修补原生MCP或把它上线。S4才决定沿原semanticContext port的最小Pi工具适配及参数、分页、模型可见content、owner／权限、取消／迟到、公共生命周期验证；在途取消仍NOT_RUN。

S5运行采用／部署、真实模型准确率／耗时对照、真实经营V404及反馈V405均未证明。合成32订单／16退款用于有限语义和关系建设，不能代替实际企业口径、数据成熟或决策反馈。当前停在S3，不进入S4、不操作其他设备、不切服务、不执行Git写入／CI。
