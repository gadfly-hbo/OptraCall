# Nike 企业与会员运营公开参考依据

版本 v0.1 · 检索日期 2026-11-12 · 参考候选，供审核与目标企业内化

本稿为“运动鞋服行业—标杆企业—目标企业”和“会员运营领域—标杆部门／业务域—目标部门／业务域”两条建设线提供 Nike 公开参考。范围覆盖企业业务骨架与会员运营，不围绕某一分析问题裁剪。企业公开材料能够支持业务概念和公开制度，却不等于 Nike 内部主数据、数据库模式或内部本体。本稿的标识符、字段名、关系名均为建议的模板名称。

证据类型：`F` 为来源直接支持的公开事实；`M` 为参考这些事实提出的建模建议；`U` 为目前查阅的公开资料不能确定的内容。所有目标企业记录、身份关系、系统字段及实际规则，后续由用户提供的获准企业资料核定。

## 一手资料与可用事实

以下链接于本次实际检索／打开。事实摘要按来源限量整理；建模建议与事实分列。

| 编号 | 一手来源及范围 | F：支持的事实 | M：可以启发的模板 | U：不能据此认定 |
| --- | --- | --- | --- | --- |
| N01 | [NIKE FY2026 Form 10-K](https://investors.nike.com/sec-filings/all-sec-filings/content/0000320187-26-000088/nke-20260531.htm)，2026-07-15提交；财年截至2026-05-31；Item 1 Business、Products、Our Markets、Manufacturing | 企业涉及鞋类、服装、器材等，公开披露 NIKE、Jordan、Converse 品牌；NIKE Direct包含自营门店与数字平台，另有批发渠道；NIKE Brand按四个地理分部报告，Converse单列；合同制造商与其工厂是不同对象 | 企业／品牌／产品类别／渠道／零售地点／批发伙伴／报告分部／制造商／工厂分开建模 | 内部组织全图、系统编码、SKU编码算法、全量门店和工厂主表、会员业务归属部门、内部数据血缘 |
| N02 | [Nike中国商品页：Everyday All-Court 8P](https://www.nike.com.cn/t/everyday-all-court-8p-%E7%AF%AE%E7%90%83-5DG2xC)，中国站当次页面；产品展示示例 | 页面展示商品名、显示颜色、款式号 `DO8258-097`，并提示配色间材质可能存在差异 | 商品模型中保留公开款式标识、颜色、规格与材料适用条件；公开款式号作为外部标识 | 该号在Nike内部等同于SPU或SKU、拆分末段即可获得颜色主键、仅靠款式号能唯一确定尺码库存 |
| N03 | [Nike Membership美国站](https://www.nike.com/membership)，美国站当次内容，含美元门槛；动态页面未标政策生效日 | 免费加入；公开列出Nike App、NRC、NTC、SNKRS及会员体验；当次页面列有$50以上配送、60天试穿等带条件权益 | 会员计划、触点、权益、参与体验；权益记录附地区、门槛、期限、例外与版本 | 美国权益适用于中国／全球、会员普遍有积分和等级、所有渠道与经销商自动共享会员记录 |
| N04 | [Nike中国会员页](https://www.nike.com.cn/membership)，中国站当次内容；动态页面未标政策生效日 | 展示NTC线上课程、线下活动、Nike By You、SNKRS中国App、会员节和本地会员礼遇 | 会员业务域覆盖购物、运动、服务和活动；建立触点、活动、服务、权益对象，按地区独立维护 | “会员运营部”内部组织与职责划分、活动参加即已购买、生日礼物人人无条件获得、某一公开权益永远有效 |
| N05 | [中国销售条款](https://agreementservice.svs.nike.com.cn/rest/agreement?agreementType=termsOfSale&country=CN&language=zh&requestType=redirect&uxId=com.nike.tos)，2026-09-21修订生效，中国大陆；§1、§2、§4.1、§6、§8 | 可有平台附加规定；运费依账户状态、配送方式与下单页面条件；存在访客订单、拆分交付、取消、退货和退款流程 | 规则附地区、渠道、商品、版本及例外；账户与订单可不全关联；订单／付款／交付／退货／退款分开表示 | 所有会员订单永远免运费、支付等于交付、退货等于退款到账、公开条款已给出首购／复购统计定义 |
| N06 | [中国隐私政策](https://agreementservice.svs.nike.com.cn/rest/agreement?agreementType=privacyPolicy&country=CN&language=zh&requestType=redirect&uxId=com.nike.unite)，页面更新与生效日期2026年7月，中国站 | 注册会员账户涉及手机号、验证码、密码，可选择完善生日等身份信息；交易另涉及收件与支付信息 | 会员账户、可选资料、交易参与角色分开表示；授权与数据用途保留来源 | 收件人必为会员本人、手机号就是永久自然人主键、可从隐私政策还原Nike账户表；分析模板应储存验证码或密码 |
| N07 | [Nike澳大利亚会员资料设置帮助](https://www.nike.com/au/help/a/nike-settings/app)，澳大利亚站当次帮助 | 可在网站及部分App维护资料设置，页面说明更改跨平台保存；所列设置包括通知、可见性、购物及沟通偏好等 | 账户设置与偏好分对象，保留适用平台与有效时间 | 所有国家所有字段实时同步、Nike采用某一身份合并算法、全部偏好在所有App可编辑 |
| N08 | [Nike香港隐私政策](https://www.nike.com.hk/help/43.htm?locale=en_US)，香港站当次政策 | 页面描述网站、App、门店互动及部分会员信息／购买历史；不同互动和地区存在负责主体差异 | 主体、地区、触点、用途与资料来源分开；身份映射保留证据和范围 | 香港政策自动适用于中国大陆；可收集等于目标企业已获准提供；共享安排证明批发全渠道数据完整 |

N03与N04的会员营销页、N05销售条款及下单／商品页的适用粒度不同；权益参考应关联精确规则，而不能仅抽取营销标题。动态页面的检索日不是生效日，生效日未知时保留未知。N06当次读取成功取得政策概要与注册信息，随后正文重取出现超时；本稿只采用已获取的明确内容，不扩展为完整隐私制度解读。

## 企业公开参考：主数据模板建议

本表全部为 `M`。它是可用于建设的字段骨架，不代表Nike内部实际表结构。建议主键均为模板内稳定标识；Nike公开名称、代码或URL只作为带来源的外部标识。状态、负责人、权威系统及具体记录仍待目标企业内化。

| 模板对象 | 建议核心字段 | 参考依据／内化关注 |
| --- | --- | --- |
| Enterprise／LegalEntity 企业与法律主体 | `entity_id, entity_type, official_name, external_ids, jurisdiction, valid_from, valid_to` | N01；企业集团、品牌、子公司分别处理；法律主体以实际材料为准 |
| Brand 品牌 | `brand_id, name, owner_entity_ref, licensing_scope, source_ref` | N01；品牌归属和授权关系均需适用时间 |
| ReportingSegment 报告分部 | `segment_id, name, covered_market_refs, reporting_scope, effective_period` | N01；报告分部不直接等同于法律实体或运营组织 |
| Market 市场 | `market_id, country_region, language, currency, timezone, valid_period` | N01、N03–N05；地理经营范围、配送地区与政策辖域可分别定义 |
| ProductModel 商品款／模型 | `model_id, brand_ref, category_ref, name, sport_use_refs, external_ids` | N01–N02；目标企业核定款层粒度与权威标识 |
| ProductVariant 商品变体 | `variant_id, model_ref, colour_ref, size_ref, material_ref, external_ids, lifecycle_status` | N02；颜色／尺码／材质组合只是模板结构，不能宣称Nike公开款式号等于该主键 |
| Category／SportUse 类别与运动用途 | `classification_id, parent_ref, label, classification_version, scope` | N01；商品类别、用途、系列分别分类，避免一棵树混用 |
| SizeSpecification 尺码规格 | `size_id, size_system, display_value, product_scope, measurement_unit` | N02的规格触点；具体尺码体系及换算规则待企业资料，不自行换算 |
| SalesChannel 销售渠道 | `channel_id, name, channel_type, operator_entity_ref, market_ref, valid_period` | N01；直销与批发是经营关系，网站／App／门店是触点，维度可关联但不互代 |
| RetailLocation 零售地点 | `location_id, name, operator_entity_ref, ownership_type, market_ref, address_ref, status, valid_period` | N01；自营、经销、厂店等分类按企业证据确定 |
| BusinessPartner 业务伙伴 | `partner_id, role_types, legal_entity_ref, market_refs, relationship_period` | N01；客户、经销商、许可方、制造商等允许多角色且有时间范围 |
| Facility 工厂／仓库等设施 | `facility_id, facility_type, operator_ref, location_ref, status, valid_period` | N01直接支持制造商与工厂分离；仓库详细网络需要另取实际来源 |
| PolicyVersion 政策版本 | `policy_id, version, subject, market_scope, channel_scope, product_scope, effective_from, effective_to, source_ref, exceptions` | N03–N05；生效时间与采集时间分别保存 |

订单、支付、发货、退货、退款、库存变动是业务事件或事实记录，不因为出现在企业模板里就一律称为主数据。企业主数据为这些记录提供可关联对象；指标定义与具体计算另行管理。

## 企业公开参考：本体模板建议

以下同为 `M`，表达关系语义与待验证约束；内部真实基数与具体组织层级保持待核。公开事实不支持将每个Nike概念直接映射到某个内部系统表。

| 关系／事件骨架 | 语义与建议约束 | 来源启发 |
| --- | --- | --- |
| 企业—经营／拥有／许可—品牌 | 关系类型和生效区间分开；品牌不是法律实体的同义词 | N01 |
| 企业—按…报告—报告分部；分部—覆盖—市场 | 报告范围独立于法律层级与业务组织 | N01 |
| 商品模型—属于—品牌／类别／用途；变体—变体于—模型 | 类别可多维；款色码粒度经企业资料确定 | N01–N02 |
| 渠道—由…经营—主体；零售地点—参与—渠道 | 区分销售方、经营方和客户所见触点；关系含有效时间 | N01 |
| 制造商—经营—工厂；商品—由…制造—制造商／工厂 | 供应关系须有资料；不能将所有制造商与所有商品全连接 | N01 |
| 订单—包含—订单行；订单行—指向—商品变体 | 订单与行粒度分离；实际商品标识和数量单位待映射 | N02、N05 |
| 订单—具有—付款事件／交付事件 | 下单、付款、发货、交付的时间和状态分别保留；拆分交付不自动产生新购买 | N05 |
| 退货—关联—订单行；退款—关联—付款／退货 | 退货与资金退款分开；支付/退款到账均保留时间与来源；是否必有关联依企业资料核定 | N05 |
| 政策版本—约束—权益／交易／渠道／商品 | 适用范围、优先规则与例外显式保存；营销页面不可替代具体政策 | N03–N05 |

## 会员运营公开参考：主数据模板建议

这里的“部门”按会员运营业务域处理。公开来源不能建立Nike内部会员部门、汇报关系或岗位权限模型；目标企业可以按真实组织资料补齐业务负责人和治理归属。

| 模板对象 | 建议核心字段 | 参考依据／边界 |
| --- | --- | --- |
| CustomerParty 顾客主体 | `party_id, party_type, source_ids, identity_status, evidence_refs` | N05–N06启发；与账号、收件人和购买人分别处理；真实自然人归并待证据 |
| MemberAccount 会员账户 | `account_id, external_ids, account_status, market_ref, registration_source_ref, created_at, closed_at` | N03、N06；不保存密码、验证码；手机号作为受控联系／验证标识，不预定为永久主键 |
| MemberProgram 会员计划 | `program_id, name, operator_ref, market_scope, participation_rules_ref, policy_version_ref` | N03–N04；不能仅凭名称认定各国是同一制度实例 |
| ProgramMembership 入会关系 | `membership_id, account_ref, program_ref, joined_at, ended_at, status, source_ref` | N03–N04启发；账号和计划间的业务关系，实际是否一对一待核 |
| Touchpoint 触点 | `touchpoint_id, name, touchpoint_type, market_ref, operator_ref, service_scope` | N03–N04；Nike App、SNKRS中国App、运动触点可作有来源外部参考实例 |
| BenefitDefinition 权益定义 | `benefit_id, benefit_type, program_ref, rule_version_ref, eligibility, channel_scope, market_scope, product_scope, effective_period, exceptions` | N03–N05；条件化表达配送、体验、商品访问等权益，不写成全球永久承诺 |
| Service／ExperienceDefinition 服务与体验 | `service_id, name, service_type, provider_ref, touchpoint_refs, participation_rule_ref` | N03–N04；定制、课程、线下体验等有不同资格与履约方式 |
| Campaign／EventDefinition 活动 | `event_definition_id, name, type, market_ref, venue_or_touchpoint_ref, schedule, eligibility_rule_ref` | N04；活动定义与具体报名／参加事实分开 |
| PreferenceDefinition 偏好定义 | `preference_key, value_domain, applicable_platforms, purpose, rule_source_ref` | N07；通知、购物、沟通和可见性不混成同一开关 |
| IdentityLink 身份关联记录 | `link_id, subject_ref, external_system, external_id, relationship_type, evidence_ref, valid_period, verification_state` | 建模建议；资料是否允许关联、有效范围和归并算法需目标企业证据，N06不提供内部实现 |
| Consent／PermissionRecord 授权与用途记录 | `record_id, subject_ref, purpose, scope, source_ref, effective_at, withdrawn_at, rule_version_ref` | N06、N08启发；这是治理骨架，不推断Nike内部同意数据库及目标企业合法依据 |

会员等级、积分计划、积分账户、券模板可作为通用领域的可选扩展，但本次已查来源不足以把它们列为Nike会员制度事实。没有出现的内部规则应记为未知，不能写成“不存在”。

## 会员运营公开参考：本体模板建议

| 关系／事件骨架 | 语义与建议约束 | 来源启发 |
| --- | --- | --- |
| 顾客主体—持有／使用—账户；账户—参加—会员计划 | 自然人、顾客、账号和入会关系分开；不得仅由电话号码或收件人信息自动认定同一主体 | N03、N05–N06 |
| 账户—通过—触点登录／互动 | 登录、浏览、运动、参加活动、购买是不同事件；某一种互动不能替代另一种 | N03–N04 |
| 会员计划—提供—权益；会员关系—符合—权益资格 | 资格判断引用具体地区、日期、渠道、商品和政策版本；“提供”不等于该会员已经获得或使用 | N03–N05 |
| 服务／活动—可通过—触点提供；主体—报名／参加—活动 | 定义、报名与实际参与分离；参与事实需获准数据 | N04 |
| 账户—具有—偏好记录；偏好记录—针对—用途／平台 | 记录值、来源和生效区间；设置跨平台保存不等于所有字段即时同步 | N07 |
| 账户／主体—与…关联—交易参与角色 | 购买人、收件人、付款人、会员账户可不同；访客订单允许会员引用为空 | N05–N06 |
| 权益授予／领取／使用／失效—引用—权益定义版本 | 作为可选事件骨架；Nike公开营销页不能证明各事件均有对应内部表 | N03–N05启发 |
| 授权记录—允许—特定用途／范围；撤回事件—改变—授权状态 | 保留用途、对象、时间与证据；任何实际适用规则依目标企业材料核定 | N06、N08启发 |

会员状态、生命周期、活跃、购买、留存、复购和价值等，可在通用领域模板里先保留概念与规则槽位；本稿不从Nike网页推导其内部指标公式、分层阈值或营销决策算法，也不以某一道分析题倒推所有基础概念。

## 供目标企业内化的差异表

模板采用时逐项记录：`reference_asset_id + reference_version + concept_or_field + action(采用/修改/删除/新增/待核) + enterprise_definition + evidence_ref + effective_scope + system_mapping + owner + validation_result`。

最先需要目标企业补充的事实包括：真实组织和系统清单、对象粒度与权威编码、商品款色码体系、渠道／门店经营关系、会员计划与权益制度、真实身份映射依据、业务事件状态和时间含义。参考模板可先完成；这些未知不阻止起草，但会限制正式企业资产的核定与发布。

当前稿仅为公开参考依据与候选模板。没有读取目标企业资料、创建正式企业资产、调用OptraCall运行时、执行模型实验或修改产品代码。
