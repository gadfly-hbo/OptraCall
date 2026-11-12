# T02｜会员运营领域主数据与本体模板

版本 v0.1 · 2026-11-12 · 建模建议，供审核

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

[Schema.org MemberProgram](https://schema.org/MemberProgram)、[ProgramMembership](https://schema.org/ProgramMembership) 和 [MemberProgramTier](https://schema.org/MemberProgramTier) 分别为计划、会员关系、等级提供候选词汇。`BenefitDefinition`、身份核验记录和完整权限历史是本包建模建议，不冒称该词汇库已有同名完整模型。来源与映射限制见[标准研究](generic-reference-sources-v0.1.md)。

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

优先核对现有会员计划制度、注册与入会流程、系统及字段字典、账号与身份关联依据、权益与活动规则、触点和服务清单、偏好与权限说明、获准记录样本及变更历史。Agent 据材料提出差异和精准缺口，人处理材料无法裁定的业务选择。具体分析问题与 SAP 指标方法在后续实际使用阶段确定。
