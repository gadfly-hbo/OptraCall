# T02｜会员运营领域主数据、指标体系与本体模板

版本 v0.2 · 2026-11-12 · 建模建议，供审核


本版增加指标体系、三类资产关联和分项状态；上一版原文保留在[同名 v0.1 模板](../02-membership-domain.md)。全部候选与公开参考仍待用户审核，目标企业正式资产尚未建立。


范围覆盖会员身份、入会关系、计划与可选等级、权益、触点参与、偏好与授权、服务及购买关联。基础模型先表达稳定概念与规则位置，后续再按企业需要定义具体分析场景。统一字段、证据分类和内化工作表见[模板包说明](README.md)。

## 主数据与受管定义

下表为逻辑模型，字段并非任何企业内部表字段。每个对象附实体标识、企业范围、状态、来源和有效时间。`?` 可空，`[]` 表示集合或独立关系记录。

| 对象／粒度 | 候选关键字段 | 语义与边界 |
| --- | --- | --- |
| `Party` 主体／有证据的一名个人或一个组织 | `party_id:text`、`party_kind:code`、`identity_state:code`、`source_identifier_refs:ref[]` | 可与 T01 顾客主体共享；没有可靠关联依据时只识别账号层，不虚构自然人统一身份 |
| `Account` 账号／一个命名空间内的账户 | `account_id:text`、`source_system:text`、`external_account_key:text`、`status:code`、`created_at:datetime?` | 一人可能多账号；共享手机号或设备不直接等于同人 |
| `MemberProfile` 会员资料视图／一个来源及期间内的主体或账号资料，可选 | `profile_id:text`、`subject_ref:ref`、`display_name:text?`、`birth_date:date?`、`declared_gender:code?`、`declared_sport_refs:ref[]`、`preferred_language:code?` | 字段按获准资料选用；主动声明与推断标签分开，来源间差异保留，不默认合成唯一真实值 |
| `ContactPoint` 联系方式／一条联系值及其归属关系，可选 | `contact_id:text`、`subject_ref:ref`、`contact_type:code`、`value_or_source_ref:text`、`verification_state:code`、`valid_period:period?` | 联系方式可变更或被多个账号使用；可联系与某种用途获准分别核定 |
| `IdentityLink` 身份关联／一条有范围的对应关系 | `link_id:text`、`from_ref:ref`、`to_ref:ref`、`link_type:code`、`evidence_ref:ref`、`verification_state:code`、`valid_period:period?` | 账号绑定、合并、拆分、业务标识对应分开，保留撤销及历史；映射规则不等于实际映射记录 |
| `MemberProgram` 会员计划／一个有管理边界的计划 | `program_id:text`、`name:text`、`operator_ref:ref`、`market_refs:ref[]`、`program_rule_version:ref` | 同企业可有多计划；计划、活动、应用和账号分别建模 |
| `ProgramMembership` 会员关系／一个主体或账号加入一个计划的关系 | `membership_id:text`、`member_ref:ref`、`program_ref:ref`、`joined_at:datetime?`、`status:code`、`ended_at:datetime?` | 会员资格是有期间的关系；入会不自动证明购买或活跃 |
| `MembershipTier` 会员等级／计划内一级，可选 | `tier_id:text`、`program_ref:ref`、`name:text`、`qualification_rule_ref:ref`、`rank:int?` | 是否分级、是否有顺序、升级降级规则均由企业核定；不预置金银卡 |
| `BenefitDefinition` 权益定义／一个受管权益版本 | `benefit_id:text`、`benefit_type:code`、`description:text`、`eligibility_rule_ref:ref`、`market_refs:ref[]`、`channel_refs:ref[]`、`valid_period:period?` | 运费、服务、内容、活动机会或价格待遇可选；这是本模板扩展类型 |
| `BenefitAssignment` 权益授予关系／一条计划、等级或个体授予规则 | `assignment_id:text`、`benefit_ref:ref`、`recipient_scope:ref`、`rule_ref:ref`、`valid_period:period?` | 可获得、已领取、已使用和失效分别表达，避免把目录权益当人人实际享有 |
| `Touchpoint` 触点／一个可识别接触入口 | `touchpoint_id:text`、`touchpoint_type:code`、`name:text`、`channel_ref:ref?`、`operator_ref:ref?`、`market_refs:ref[]` | 门店、网站、应用、小程序、客服等按企业证据建立；与 T01 门店渠道关联 |
| `ContentService` 内容或服务／一个可识别服务定义 | `service_id:text`、`service_type:code`、`name:text`、`provider_ref:ref?`、`access_rule_ref:ref?` | 训练内容、咨询、社区等有则纳入；实际使用另记事件 |
| `CampaignActivity` 活动定义／一个有范围的活动，可选 | `activity_id:text`、`type:code`、`name:text`、`rule_ref:ref`、`scope_refs:ref[]`、`valid_period:period` | 活动规则、报名、参与与效果分别记录，不把参与自动当购买 |
| `PreferenceDefinition` 偏好项定义／一种可表达偏好 | `preference_id:text`、`topic:code`、`value_domain:ref`、`collection_basis:code` | 主动声明、行为推断和运营标签分开；主体偏好值带来源、时点和置信依据 |
| `PermissionPurpose` 权限或联系目的定义／一个明确目的 | `purpose_id:text`、`scope:text`、`channel_refs:ref[]`、`policy_ref:ref?` | 实际选择／撤回及依据单独留记录；账号存在、加入计划和营销联系许可分别表达 |
| `PointsScheme` 积分方案／一个规则版本，可选 | `scheme_id:text`、`program_ref:ref`、`unit:text`、`earn_rule_ref:ref`、`spend_rule_ref:ref`、`expiry_rule_ref:ref?` | 仅企业确有积分制度时使用；流水为事件，余额为时点结果 |
| `BusinessRule` 业务规则／一个有范围与期间的版本 | `rule_id:text`、`rule_kind:code`、`definition:text`、`scope_refs:ref[]`、`valid_period:period?`、`authority_ref:ref` | 等级、权益、资格与状态转换可引用；未知规则留空，不补造门槛 |

`MembershipStatus`、`AccountStatus`、`BenefitType`、`TouchpointType`、`IdentityLinkType` 等是待核定值域。退会、冻结、注销等是否等同及其允许转换，由企业制度明确。

## 可选扩展模块

这些模块只提供选用位置，目标企业有相应制度与资料后再启用。

| 模块 | 候选定义及字段 | 与事件或派生结果的区别 |
| --- | --- | --- |
| 会员卡／资格凭证 | `credential_id`、`membership_ref`、`issuer_ref`、`credential_type`、`valid_period`、`status` | 实体卡、电子卡或资格证明与账号分别表达；发卡、换卡、挂失为事件 |
| 券与个体权益实例 | 券模板或权益定义、发行者、资格、期限、可用范围；实例另有 `instance_id`、`definition_ref`、`recipient_ref` | 模板与实际实例、领取及核销事件分开；有计划不代表有券 |
| 积分／储值 | 各自的方案、账户引用、单位、获取／使用／有效期规则 | 积分与资金单位分开；流水和截至时点余额分别管理 |
| 付费订阅 | 方案定义、订阅关系、期限、续订及资格规则、相关支付引用 | 方案、合同关系、付款与续订事件分别表达 |
| 家庭／推荐关系 | 关系类型、两端主体、计划范围、证据及有效期 | 不从同地址等属性自动推出家庭或推荐事实 |
| 分群与标签 | `segment_id`、`definition`、`rule_or_model_ref`、`version`、`scope` | 定义与成员名单分开；派生成员关系带输入期间、计算时点和方法版本 |

## 本体引用的关联记录

以下记录用于表达状态事实、参与及案件，分别管理，不统一列为稳定主数据。

| 记录／粒度 | 候选字段 | 语义 |
| --- | --- | --- |
| `PreferenceValue`／某主体或账号对某偏好项在一个期间的值 | `value_id: text`、`subject_ref:ref`、`preference_ref:ref`、`value:map`、`collection_basis:code`、`method_ref:ref?`、`observed_at:datetime`、`valid_period:period?` | 声明值与推断值分开；来源与方法可查 |
| `PermissionRecord`／某主体或账号针对明确目的范围的一条状态记录 | `record_id:text`、`subject_ref:ref`、`purpose_ref:ref`、`scope:map`、`status:code`、`policy_ref:ref?`、`evidence_ref:ref`、`effective_at:datetime?`、`recorded_at:datetime` | 保留选择、撤回、更正和来源；实际状态和值域待企业制度核定 |
| `ServiceCase`／一个服务案件 | `case_id:text`、`subject_refs:ref[]`、`related_order_refs:ref[]`、`benefit_refs:ref[]`、`case_type:code`、`status:code`、`opened_at:datetime`、`closed_at:datetime?` | 案件与服务定义分别表达；处理动作可另记事件，不覆盖历史 |

## 可复用词汇与本地扩展

[Schema.org MemberProgram](https://schema.org/MemberProgram)、[ProgramMembership](https://schema.org/ProgramMembership) 和 [MemberProgramTier](https://schema.org/MemberProgramTier) 分别为计划、会员关系、等级提供候选词汇。`BenefitDefinition`、身份核验记录和完整权限历史是本包建模建议，不冒称该词汇库已有同名完整模型。来源与映射限制见[标准研究](../generic-reference-sources-v0.1.md)。

## 本体：核心关系

| 关系 | 含义及建议约束 |
| --- | --- |
| `Party — holdsAccount → Account` | 由有依据的 IdentityLink 支持；缺证据时保持账号范围 |
| `ProgramMembership — member → Party/Account` | 指明采用主体层还是账号层口径；与加入计划的关系共同确定资格 |
| `ProgramMembership — belongsToProgram → MemberProgram` | 一条关系只指向一个明确计划；多计划分别建关系 |
| `MemberProgram — operatedBy → Enterprise/OrganizationUnit` | 责任归属以企业证据核定；未公开部门保持未知 |
| `ProgramMembership — assignedTier → MembershipTier` | 可选且带期间；当前等级与历史等级分别可查 |
| `MemberProgram/MembershipTier — offers → BenefitDefinition` | 计划权益或等级权益，不推断每个会员均满足实际领取条件 |
| `BenefitAssignment — grants → BenefitDefinition` | 指明授予对象范围、规则与时间；与领取及使用事件关联 |
| `BenefitDefinition — governedBy → BusinessRule` | 规则限定地区、渠道、商品、人群、期间及例外 |
| `Touchpoint — providesAccessTo → MemberProgram/ContentService/CampaignActivity` | 入口与服务分开；可访问不等于实际参与 |
| `Party/Account — expressesPreference → PreferenceValue` | 记录主动或推断来源、时点，不自动转化成固定会员属性 |
| `Party/Account — hasPermissionRecord → PermissionRecord` | 保留目的、范围、状态、来源和更正；技术模型不替代企业制度核定 |
| `Order — associatedWith → Party/Account/ProgramMembership` | 订单身份匹配、购买者角色与会员资格依据分开，不默认入会前交易均有资格 |
| `ServiceCase — concerns → Party/Account/Order/BenefitDefinition` | 服务与投诉是事件／案件，关联稳定对象及处理状态 |

关系如含多方、限定条件或有效期间，应使用独立关系记录，而非把所有内容压缩成一个无时间的边。

## 本体：事件与状态变化

事件公共字段为身份、来源、发生／记录时间、参与者、触点、状态及更正关系。具体事件是否存在、采集粒度和可得性，由企业资料核定。

| 事件族 | 候选事件 | 需要保持的区别 |
| --- | --- | --- |
| 身份与账号 | 注册、验证、绑定、解绑、合并、拆分、注销 | 账号操作与自然人身份判断分开；历史身份映射可追溯 |
| 会员资格 | 申请、加入、暂停、恢复、退出、到期 | 入会时间、关系有效时间、系统记录时间分别表达 |
| 等级变化，可选 | 获得、升级、降级、续期、到期 | 变化依据与规则版本；不以现等级覆盖历史 |
| 权益生命周期 | 授予、领取、预约、使用、撤销、过期 | 可用权益、券实例和使用记录分开；部分使用及退回有明确规则 |
| 触点参与 | 访问、内容参与、报名、到场、服务使用 | 具体事件及“活跃”阈值由企业定义，登录不自动代表有效参与 |
| 偏好与权限 | 声明、更新、同意、拒绝、撤回、更正 | 主动声明与推断、目的与渠道分别记录；适用依据待核定 |
| 购买及售后 | 订购、支付、完成、取消、退货、退款、换货 | 引用 T01 交易身份；实际购买资格与观察规则进入相应分析定义 |
| 积分，可选 | 获取、消费、失效、冲正 | 记录流水依据、单位和关联业务；余额为截至时点计算结果 |

生命周期阶段、价值分层、活跃状态、购买频次、留存或复购等，是需要方法、期间和数据范围的派生定义，可作为分析资产引用。基础本体先预留明确引用关系，不将某一计算结果写成永恒身份。

## 规则与质量检查模板

| 检查项 | 需表达或核定的内容 |
| --- | --- |
| 主体与账号 | 键命名空间、关联证据、合并拆分和撤销；未知与冲突的显式状态 |
| 会员关系 | 计划、资格状态、入会／退会时间，账号注册与入会是否为同一事件 |
| 可选机制 | 等级、积分、付费计划、家庭关系等有证据再启用，缺省不代表存在 |
| 权益适用性 | 具体地区、渠道、身份、商品、门槛、活动和期间；未知不是无条件适用 |
| 行为事件 | 事件粒度、重复上报、机器人／测试等质量规则和数据覆盖情况 |
| 时间 | 发生、记录、生效和观察截止分开；迟到数据与更正留历史 |
| 交易关联 | 会员、账号、订单、支付及退款映射均有依据，无法关联的数量和影响可查 |
| 推断标签 | 保存方法版本、输入期间及证据；不把推断偏好表述为会员主动声明 |

## 目标企业内化资料

优先核对现有会员计划制度、注册与入会流程、系统及字段字典、账号与身份关联依据、权益与活动规则、触点和服务清单、偏好与权限说明、获准记录样本及变更历史。Agent 据材料提出差异和精准缺口，人处理材料无法裁定的业务选择。SAP 指标定义、体系关系与本体同步核定；实际使用场景随后选择并验证。

## 指标体系：主题与候选目录

指标体系与主数据、本体同步起草。下表为领域候选，`metricKey` 不是已发布 SAP 身份。骨架用于核定统计对象、事件及资格；内化后的准确指标定义归原 SAP，主题和本体只引用包 ID＋版本＋指标名。

| 主题／用途 | 指标族 | 与基础模型的关系 |
| --- | --- | --- |
| 规模与发展 | 账号、会员资格、主体规模及新增 | 区分账号、计划内关系与可确认自然人，不混用分母 |
| 参与活跃 | 合格触点参与、内容、活动、服务使用 | 活跃需要事件、身份、期间和资格定义；访问、报名和到场分别表达 |
| 权益运营 | 资格、授予、领取、使用与到期 | 权益定义、具体实例及使用事件分别管理 |
| 交易与价值 | 购买会员、会员交易、期间贡献 | 身份和交易关联、有效购买、退款和成本分摊需依据 |
| 留存与发展质量 | 队列后续参与、资格延续、可选升级 | 队列、事件类型、观察资格与截止核定后才有比率 |
| 服务与联系 | 案件处理、许可范围和偏好资料质量 | 可联系、发送、到达、阅读及效果不互代 |

| metricKey／候选名称 | 定义或测量骨架 | 对象、粒度、单位 | 维度、时间及资格 | 必要数据与来源 |
| --- | --- | --- | --- | --- |
| `mem.scale.registered_accounts` 注册账号数 | 范围内截至时点存在的合格不同账号数；注销等处理待核 | `Account`；系统命名空间内账号；个 | 系统、市场、触点；注册与状态有效时间 | 账号字典、注册／注销事件和状态定义 |
| `mem.scale.active_memberships` 有效会员关系数 | 截至时点满足计划资格和状态规则的不同会员关系数 | `ProgramMembership`；关系；个 | 计划、市场、品牌；有效期间与状态规则 | 会员关系、状态历史及计划制度；不以账号数代替 |
| `mem.scale.new_memberships` 新增会员关系数 | 期间内符合新加入条件的不同关系数 | 入会关系；个／期间 | 计划、入会触点；重入、迁移和补录资格待核 | 入会及退出历史、来源与迁移规则 |
| `mem.identity.verified_parties` 可确认主体数 | 在有证据身份映射覆盖内去重的主体数 | `Party`；主体；人／组织分列 | 身份来源、核验状态、有效时点 | 已核身份关联；未识别账号量另列，不估成自然人 |
| `mem.engagement.participants` 合格参与会员关系数 | 期间内有约定参与事件的不同合格关系数 | 会员关系；个／期间 | 触点、内容／活动、计划；事件及去重规则 | 参与事件、身份映射与当时资格 |
| `mem.engagement.participation_rate` 参与率 | 同一资格队列中有合格参与的关系数占该队列数量 | 会员关系队列；比率 | 队列资格时点、期间、事件与覆盖完整性待核 | 队列、参与事件、排除与未知数量 |
| `mem.benefit.eligible_memberships` 权益合格会员关系数 | 对某权益版本及范围满足资格的不同关系数 | 会员关系×权益规则；个 | 权益、计划、市场、渠道、期间 | 权益资格规则及当时资格事实 |
| `mem.benefit.granted_instances` 已授予权益实例数 | 同一授予队列中有效实例按稳定实例键去重 | 权益实例；份等企业单位 | 权益、活动、发放触点；撤销和冲正规则 | 授予、撤销、实例身份及规则版本 |
| `mem.benefit.redemption_rate` 权益实例使用率 | 同一授予队列内已完成约定观察资格的实例中，至少一次有效使用的比例 | 权益实例队列；比率 | 领取／使用分开；部分使用、有效期、晚到记录待核 | 授予与使用事件、实例关联、观察截止；未成熟不填未使用 |
| `mem.purchase.purchasing_memberships` 购买会员关系数 | 期间内有合格购买事件并能准确关联的不同关系数 | 会员关系；个／期间 | 计划、商品、门店渠道；有效购买和退款影响待核 | 交易、会员映射、状态与退款规则 |
| `mem.purchase.net_sales` 会员交易净额 | 能归属指定会员范围的合格交易净金额 | 交易行及会员归属；货币 | 商品、门店渠道、市场；期间和币种一致 | 交易退款、分摊与身份依据；多会员关联不能重复计入 |
| `mem.retention.cohort_return_rate` 队列后续参与率 | 约定基础队列中，在完整后续窗口发生指定合格事件的比例 | 入会／参与等企业核定队列；比率 | 队列起点、事件、窗口、截止和历史覆盖待核 | 完整历史、资格、事件、映射；观察不足单列 |
| `mem.service.resolution_rate` 服务案件解决率 | 同范围符合观察资格的案件中按规则完成解决的比例 | `ServiceCase`；案件；比率 | 类型、触点、优先级；重开、关闭与解决含义待核 | 案件状态历史、时限及截止 |

价值分层、生命周期、升级、积分／储值、付费订阅及推荐等按企业制度选用；有需要时增加带方法与版本的指标，不能因本模板列出主题就默认企业拥有对应机制。

## 指标关系与状态

| 关系类别 | 候选表达 | 不能混淆的内容 |
| --- | --- | --- |
| 目录归属 | 规模、参与、权益、交易和服务指标分别进入主题 | 目录父子不自动形成加总 |
| 公式依赖 | 参与率引用同资格队列的参与关系数与队列数；权益使用率引用同实例队列的使用与授予资格 | 分子属于分母集合、统计单位与观察资格一致；不能用人数除券数 |
| 统计分解 | 同一计划有效关系数按入会渠道分组 | 同人多计划关系可多条；跨计划关系数之和不能称自然人数，多触点分类需防重复 |
| 分析用途关联 | 权益、参与、交易和服务可作结果／驱动／约束用途组合 | 用途不证明权益导致购买；效果需另外证据 |

每项保留定义待核／已核、数据未映射／部分／已映射、当前可算性和实际使用结论，另保留候选／正式身份。没有真实资料时四项均不能由模板完成推断为企业已通过。

## 三类资产关联与内化

共享逻辑 ID 为 `md.party`、`md.account`、`md.program_membership`、`md.store`、`md.sku`；`ont.*` 是本模板拟建规则／关系项。实际主键和本体正式身份仍由企业来源及资产版本核定。

| 主数据项／粒度 | 参考 metricKey | 事件、维度、时间及资格 | 本体项候选 | Binding 与待核 |
| --- | --- | --- | --- | --- |
| `md.program_membership`；计划内关系 | `mem.scale.active_memberships` | 加入、暂停、恢复、退出；计划、有效期间、状态资格 | `ont.membership_valid_at`、`ont.membership_in_program` | 关系键、状态历史和有效期间待核；注册不直接等于入会 |
| `md.party`、`md.account`；主体／账号 | `mem.identity.verified_parties`、账号及关系规模 | 身份关联、合并拆分；来源范围和有效时间 | `ont.account_held_by`、`ont.identity_link_supported_by` | 真实关联证据与未知覆盖；不从电话号码猜同人 |
| `BenefitDefinition`、具体实例 | `mem.benefit.redemption_rate` | 资格、授予、领取、使用及撤销；同队列和窗口 | `ont.eligible_for`、`ont.granted_instance`、`ont.redeems_instance` | 规则版本、实例键、使用量与截止待核 |
| `Touchpoint`、内容／活动、会员关系 | `mem.engagement.participants` | 参与、报名、到场、内容使用；事件及去重条件 | `ont.participates_in`、`ont.access_via_touchpoint` | 事件真实性、覆盖、身份及机器人／测试规则待核 |
| 会员关系、`md.store`、`md.sku` | `mem.purchase.net_sales` | 订单、付款、退货退款；资格和期间归属 | `ont.transaction_associated_with_membership` | 会员—交易键、分摊和跨系统身份待核 |
| `ServiceCase`、主体／账号 | `mem.service.resolution_rate` | 打开、处理、解决、关闭、重开及观察截止 | `ont.case_concerns`、`ont.resolved_under_rule` | 状态含义与时限待核，不把关闭直接当解决 |

### 虚构的跨资产版本示例

为与 UI Demo 对照，使用企业 A 的模拟指标 `demo-member-foundation@1.0.0::active_memberships`，它对应上述有效会员关系数参考项。模拟旧政策将“正常＋宽限”纳入有效资格；候选 v1.1 改为“仅正常”。这要求核查资格规则、本体项 `ont.membership_valid_at`、状态 Binding 与 SAP 准确新版本是否一致，并显示受影响用途。`md.program_membership` 的稳定身份不因此被重建。

该包、字段、政策及结果均为虚构；不属于 Nike 或目标企业制度，不填入企业正式 SAP 引用。示例用于审核版本、差异及影响呈现，不是实际模型或业务验收。
