# T04｜Nike 会员运营主数据与本体公开参考模板

版本 v0.1 · 2026-11-12 · 公开参考草稿，供审核

建设路线：会员运营领域 T02 → Nike 会员运营公开参考 T04 → 目标企业会员运营。此处“部门”按业务功能域组织；Nike 内部会员部门名称、汇报关系、系统分工和权限尚无本次可用证据。共享企业、品牌、商品、渠道与门店引用 [T01](01-sportswear-industry.md)／[T03](03-nike-enterprise-public.md)，会员概念引用 [T02](02-membership-domain.md)。

本稿通过购物、运动内容、活动体验、服务和偏好等功能组织公开参考。这些分组是建模建议，不是对 Nike 内部部门设置的陈述。事实来源 N03–N08 及访问限制见[Nike 研究记录](nike-public-reference-sources-v0.1.md)。

## 公开参考内容

| 参考项 | 来源可支持的事实 | 建模建议及边界 |
| --- | --- | --- |
| 美国会员计划视图 | 美国会员页展示免费加入及 Nike App、NRC、NTC、SNKRS 等入口 | 建立带市场范围的计划视图及触点参考；不推断全部地区均可用或属于同一技术账户系统 |
| 中国会员计划视图 | 中国会员页展示课程、线下活动、定制、SNKRS 中国 App 和会员体验 | 建立购物、内容、活动与服务定义，不把这些功能强制折叠为购买行为 |
| 地区化权益 | 美国与中国会员页展示的权益内容和条件有所不同 | 权益定义关联市场、渠道、条件及准确来源，动态网页查阅日与业务生效日分开 |
| 条款与订单条件 | 中国销售条款说明平台附加规定、账户状态和下单条件等可影响适用规则 | 营销说明、政策和具体订单条件分别保留；无法判断优先或冲突时回源核定 |
| 偏好设置 | 澳大利亚帮助页描述部分网站／App 设置及跨平台保存 | 建立偏好记录及适用平台；不推断全球所有字段实时同步 |

以上事实分别见 [Nike 美国会员页](https://www.nike.com/membership)、[Nike 中国会员页](https://www.nike.com.cn/membership)、[中国销售条款](https://agreementservice.svs.nike.com.cn/rest/agreement?agreementType=termsOfSale&country=CN&language=zh&requestType=redirect&uxId=com.nike.tos)及[澳大利亚设置帮助](https://www.nike.com/au/help/a/nike-settings/app)。实际资格与权益履行须回到相应地区、期间和具体规则。

## 主数据模板：公开填充与企业待定

字段类型和统一来源／时间字段沿 T02 与[包说明](README.md)。下表字段均为本包逻辑字段，不是 Nike 内部字段。

| 对象 | 建议关键字段 | 公开资料可填充 | 保持未知／企业内化时填写 |
| --- | --- | --- | --- |
| `MemberProgramView` 计划公开视图 | `view_id:text`、`public_name:text`、`market_scope:ref[]`、`source_ref:ref`、`underlying_program_ref:ref?` | 中国／美国页面名称、地区及展示内容 | 不同视图是否属于同一全球计划、实际计划主键和运营组织；本对象是资料视图而非认定独立计划 |
| `Account`／`ProgramMembership` | `account_id:text`、`source_namespace:text`、`membership_id:text`、`program_ref:ref`、`status:code`、`valid_period:period?` | 可定义账号和入会关系两个概念；不创建真实个人实例 | 企业注册与入会是否同一动作、状态、退出流程及账号映射 |
| `Touchpoint` | `touchpoint_id:text`、`public_name:text`、`touchpoint_type:code`、`market_scope:ref[]`、`source_ref:ref` | 来源明确地区内的官网、App 或活动入口 | 全部可用国家、账号共享、接口和事件可得性 |
| `BenefitDefinition` | `benefit_id:text`、`type:code`、`description:text`、`eligibility_rule_ref:ref?`、`market_scope:ref[]`、`valid_period:period?` | 资料展示的权益类别及明确条件 | 未公开门槛、实际领取对象、目标企业是否采用此权益 |
| `BusinessRule`／`PolicyDocumentVersion` | `rule_id:text`、`document_ref:ref`、`scope:map`、`conditions:text?`、`exceptions:text?`、`effective_period:period?` | 官方规则原文、版本和明示范围 | 没有写明的例外、生效时间及优先关系 |
| `ContentService` | `service_id:text`、`name:text`、`service_type:code`、`touchpoint_refs:ref[]`、`access_rule_ref:ref?` | 公开提及的课程、定制或其他服务定义 | 完整内容库、服务资格及内部服务目录 |
| `CampaignActivity` | `activity_id:text`、`public_name:text`、`type:code`、`market_scope:ref[]`、`rule_ref:ref?` | 有来源的活动类别或公开活动定义 | 全量活动、实际报名／到场数据及内部活动码 |
| `PreferenceDefinition`／偏好记录 | `preference_key:text`、`value_domain:ref`、`platform_scope:ref[]`、`source_ref:ref`、`valid_period:period?` | 帮助页明确的设置类别和适用平台 | 内部字段、实时同步承诺、每名会员实际选择 |
| `IdentityLink` | `from_ref:ref`、`to_ref:ref`、`link_type:code`、`evidence_ref:ref`、`verification_state:code` | 只能提供结构槽位，不从公共页面填真实关联 | 身份归并规则、历史合并拆分和目标企业实际映射 |
| 权限／用途定义与记录 | `purpose_id:text`、`scope:text`、`policy_ref:ref?`、`record_source:ref?`、`effective_period:period?` | 官方政策可作为范围和概念参考，细节限已取得原文 | 内部同意记录结构、全部数据流及目标企业适用依据 |

本次资料未足以核定 Nike 的等级、积分、家庭会员、付费订阅及内部优惠券体系；这些内容继续作为 T02 可选模块。未知不表达为“不存在”。内部会员数、活跃阈值、生命周期分层、留存与复购定义均保持未知。

## 本体模板

以下均为建模建议；只有明确引用的名称、体验及条款内容作为公开事实。

| 关系／事件 | 含义与约束候选 |
| --- | --- |
| 计划公开视图—描述—会员计划 | 页面是计划说明来源；先保留地区视图，不因名称相同就合并全球制度 |
| 会员关系—连接—账号／主体与会员计划 | 入会关系引用准确计划范围；自然人身份和账号一致性需证据 |
| 计划—通过—触点提供内容／服务／活动 | 触点、服务定义与参与事实分别建模；有入口不等于某会员已参与 |
| 权益定义—受限于—业务规则版本 | 明确地区、期间、渠道、商品和资格；条件未知时不得写“全员无条件” |
| 会员关系—符合资格／获授／领取／使用—权益 | 四类语义及相应事件分开；公开营销信息只支持权益介绍，不证明个体资格或使用 |
| 账号—具有—偏好记录 | 偏好项、值、来源、适用平台与有效期分别记录；推断标签另有方法依据 |
| 账号／主体—参与—交易角色 | 购买者、付款者、收件人和会员可能不同；访客订单允许会员关联未知 |
| 注册／入会／退出／身份关联变更 | 作为候选事件骨架；内部状态机、必经步骤和真实事件字段待企业资料 |
| 报名／活动参与／课程使用／服务履行 | 区分定义与实际事件、报名与到场、访问与使用，不直接推断营销效果 |
| 权限选择／撤回—引用—目的及政策版本 | 模型表达有范围的历史记录；具体制度和获准数据由目标企业核定 |

```mermaid
flowchart LR
    P[主体或账号] --> M[会员关系]
    M --> G[会员计划]
    V[地区公开视图] -.描述.-> G
    G --> B[权益／内容／服务／活动定义]
    R[政策与业务规则版本] --> B
    T[触点] --> B
    P --> E[参与或使用事件]
    E --> B
```

图是本包模型建议，不描述 Nike 内部架构。真实账号关联、事件采集和资格计算都须由企业证据补齐。

## 目标企业内化示例工作表

| 参考内容 | 企业可选动作 | 必需依据 |
| --- | --- | --- |
| 账号、计划与会员关系分离 | 采用，或保留概念分离并映射同一来源记录 | 实际注册入会流程、主键、资格与状态定义 |
| 多触点内容、活动和服务 | 按已有业务取舍或扩展 | 企业实际触点、服务、活动清单及数据覆盖 |
| 地区化、条件化权益 | 采用规则结构，重新填写企业制度 | 企业权益条款、门槛、例外、期间与权威来源 |
| 等级／积分等可选机制 | 有证据时启用 | 企业实际制度和流水定义；不因标杆模板就默认存在 |
| 共享身份与偏好 | 采用追溯结构，核定具体事实 | 获准关联资料、业务规则和状态历史 |

正式企业资产的发布、后续普通分析实际使用及任务贡献，并回现有 Studio 两层体系。本轮成果到参考模板为止，用户提供资料后再进行企业内化。
