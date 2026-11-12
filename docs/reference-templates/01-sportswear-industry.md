# T01｜运动鞋服行业主数据与本体模板

版本 v0.1 · 2026-11-12 · 建模建议，供审核

范围为运动鞋、服装及配件企业的共享业务骨架，覆盖品牌商品、组织、零售批发及合作经营、门店渠道、地点与供应合作。行业企业可按自身经营模式取舍。统一记录头及证据标记见[模板包说明](README.md)。本稿所有逻辑字段与基数均为建议，不要求目标企业使用同名数据库字段。

## 主数据模型

下表字段是各对象的候选业务字段；每个对象还带实体标识、企业范围、状态、来源与有效时间。`?` 表示按场景可空，`[]` 表示多值或独立关系集合。日期使用日期类型，金额需同时表达币种，分类值引用有版本的值域。

| 对象／粒度 | 候选关键字段 | 关键语义与边界 |
| --- | --- | --- |
| `Enterprise` 企业／一个经营主体或企业组 | `enterprise_id:text`、`name:text`、`enterprise_kind:code`、`parent_enterprise_id:text?`、`market_refs:ref[]` | 集团、法律实体与经营单元用类型区分；层级和控制关系须有来源 |
| `OrganizationUnit` 组织单元／一个单元 | `unit_id:text`、`enterprise_ref:ref`、`name:text`、`unit_type:code`、`parent_unit_ref:ref?`、`function_refs:ref[]` | 部门、事业部、销售区域与法人不混同；业务功能可由多个单元承担 |
| `Brand` 品牌／一个有范围的品牌身份 | `brand_id:text`、`name:text`、`owner_ref:ref?`、`license_relation_refs:ref[]` | 所有权、许可权和经营权分开记录，带地域与期间 |
| `ProductStyle` 商品款／企业定义的一款 | `style_id:text`、`brand_ref:ref`、`name:text`、`category_ref:ref`、`sport_refs:ref[]`、`collection_refs:ref[]` | 款的粒度需企业核定，不能凭款号字符串猜测 |
| `ProductColorway` 款色／一款的一组配色，可选 | `colorway_id:text`、`style_ref:ref`、`color_refs:ref[]`、`display_name:text` | 适用于存在独立款色层的企业；可以使用变体属性而不设此层 |
| `SellableSKU` 可售变体／一个可区分销售品项 | `sku_id:text`、`style_ref:ref`、`colorway_ref:ref?`、`size_ref:ref?`、`variant_attributes:map`、`gtin_refs:ref[]`、`uom_ref:ref` | SKU 是企业标识；GTIN 是外部贸易项目标识。包装层级、套装与单件须明确，不能强行一一等同 |
| `SizeSpecification` 尺码规格／体系内一个规格 | `size_id:text`、`system_ref:ref`、`label:text`、`category_scope:code[]`、`measurement_refs:ref[]` | 不把同一数字跨国家、鞋服类别或成人儿童体系直接等同 |
| `ProductClassification` 商品分类／分类体系一个节点 | `category_id:text`、`scheme_id:text`、`parent_ref:ref?`、`label:text`、`version:text` | 品类、运动项目、目标客群与季节分别建分类维度，避免混成一棵树 |
| `CollectionSeason` 系列／季节／一个企业定义集合 | `collection_id:text`、`kind:code`、`label:text`、`calendar_scope:text?`、`effective_period:period?` | 自然季、上市季与商品系列可并存；归类关系可多值 |
| `Market` 经营市场／一个明确范围 | `market_id:text`、`name:text`、`country_region_refs:ref[]`、`currency_refs:ref[]`、`timezone_refs:ref[]` | 财报地区、销售市场与行政区不同；本地来源核定其对应关系 |
| `Channel` 渠道／一种接触或销售路径 | `channel_id:text`、`channel_type:code`、`name:text`、`operator_ref:ref?`、`market_refs:ref[]` | 直营零售、电商、批发、合作平台按企业定义；渠道不是门店或法人 |
| `Store` 门店／一个经营单元 | `store_id:text`、`name:text`、`physical_site_ref:ref?`、`operator_ref:ref`、`operation_mode:code`、`channel_refs:ref[]`、`open_close_dates:period?` | 门店业务身份与地址分开；自营、加盟、合作等经营方式保留归属与有效期 |
| `FacilitySite` 地点设施／一个物理地点 | `site_id:text`、`site_type:code`、`address_ref:ref?`、`gln_refs:ref[]`、`operator_ref:ref?` | 仓库、工厂、办公室、零售地点；GLN 按真实分配及识别范围填写，不生成模拟正式码 |
| `BusinessPartner` 业务伙伴／一个可识别伙伴 | `partner_id:text`、`party_type:code`、`name:text`、`legal_entity_ref:ref?`、`role_refs:ref[]` | 供应商、代工、物流、经销等是关系角色，同一主体可有多个角色 |
| `Party` 主体／有证据的一名个人或一个组织 | `party_id:text`、`party_kind:code`、`source_identifier_refs:ref[]`、`verification_state:code` | 与会员领域共享；顾客是主体参与业务的角色，账号另建；未知自然人关系留待核定 |
| `Assortment` 商品组合／范围和期间内的上架集合，可选 | `assortment_id:text`、`scope_refs:ref[]`、`product_refs:ref[]`、`valid_period:period` | 上架资格不是库存余额；可按门店、渠道、市场配置 |
| `MaterialSpecification` 材料规格／一个规格，可选 | `material_id:text`、`name:text`、`composition_refs:ref[]`、`uom_ref:ref` | 用于设计制造；成品与物料、材料成分及批次分别表达 |

`ColorCode`、`SizeSystem`、`UnitOfMeasure`、`Currency`、`CountryRegion`、`StatusCode`、`OperationMode` 是参考值域候选，应记录体系、代码、名称及版本。价格表／报价条件可作为受管规则对象；成交价、库存余额和销售金额带业务时点，分别进入交易或分析资产。

## 标准词汇候选对齐

商品家族和变体可参考 [Schema.org ProductGroup](https://schema.org/ProductGroup) 的 `hasVariant`、`isVariantOf` 和 `variesBy`；`ProductStyle`、款色及 SKU 层级仍属本模板建议。GTIN 的识别用途参考 [GS1 GTIN 管理标准](https://ref.gs1.org/standards/gtin-management/)；GLN 的对象区分参考[标准研究 S02](generic-reference-sources-v0.1.md)中列明的官方资料及访问限制。组织层级可参考 [W3C ORG](https://www.w3.org/TR/vocab-org/)。

## 本体：关系模板

以下关系按“主体—关系—客体”填写；`1`、`0..1`、`0..n` 等仅表达建议基数，企业内化时核定。

| 关系 | 含义及建议条件 |
| --- | --- |
| `OrganizationUnit — unitOf → Enterprise/OrganizationUnit` | 一个单元在指定期间归属一个确定组织范围；矩阵管理另设职责关系 |
| `Enterprise — owns/licenses/operates → Brand` | 三类关系分开；带市场和有效期 |
| `ProductStyle — hasVariant → SellableSKU` | 一款可有多个变体；SKU 的款归属在同一企业版本中应明确 |
| `ProductColorway — colorwayOf → ProductStyle` | 存在款色层时使用；颜色名称不是跨企业统一标识 |
| `SellableSKU — hasSize → SizeSpecification` | 有尺码的品项关联体系内尺码；均码和无尺码有明确表达 |
| `ProductStyle — classifiedAs → ProductClassification` | 多个分类维度分别记录所属体系，不把分类继承当品牌所有权 |
| `Store — locatedAt → FacilitySite` | 经营身份与物理地点关联；搬迁或更名保留历史 |
| `Store — operatedBy → BusinessPartner/Enterprise` | 经营者与品牌所有者、物业所有者分别记录 |
| `Channel/Store — serves → Market` | 实际可服务范围，不从财报分部直接推定每一门店覆盖 |
| `BusinessPartner — supplies/manufactures/distributesFor → Enterprise` | 带产品、市场、合作类型和期间，事实须有来源 |
| `SellableSKU — includedIn → Assortment` | 范围和有效期内的商品组合关系，不推断可售库存 |
| `Party — holdsAccount → Account` | 复用 T02 身份模型；同人跨系统关联须有证据 |

## 本体：业务事件模板

事件共享字段候选为 `event_id`、`event_type`、`occurred_at`、`recorded_at`、`source_ref`、参与对象、状态及更正关系。金额事件附金额、币种；数量事件附数量、单位。发生、记录和生效时间分开。

| 事件族 | 参与对象与区分 |
| --- | --- |
| 商品建立、发布、上架、下架 | 款／SKU、组合、渠道和市场；不同生命周期动作分别表达 |
| 门店开业、停业、迁址、经营者变更 | 门店、地点、经营方与有效期间 |
| 订购、支付、履约、收货 | 订单、订单行、支付及履约单独保留身份与关联，允许一对多 |
| 退货、退款、换货 | 退回实物、资金退还和替换商品分别表达；允许部分数量／金额与关联缺口 |
| 调拨、入库、出库、盘点 | SKU、地点、库存业务事件；余额是截至时点的结果 |
| 合作建立、终止与范围变更 | 企业与伙伴、角色、市场、产品及期间 |

这些事件提供行业本体背景，不要求本轮实现所有业务流程。

## 约束与核对模板

- 同一标识命名空间内的主键唯一；跨来源键记录映射依据，不能只因编码同名就合并。
- 款、款色、SKU、包装和 GTIN 粒度分别说明；组合属性唯一性按商品类别及有效版本核定。
- 尺码映射注明体系、类别和依据；无法证明的换算保持未知。
- 组织、经营方、门店地点、品牌权利的变化保留有效期间，不覆盖历史交易归属。
- 交易引用当时有效的对象或保留交易快照；无法关联的记录给出缺口状态。
- 货币、税费、单位与汇率转换由具体业务定义约束；没有单位的数量不直接相加。
- 退款、退货与换货各有事件身份；是否及如何影响销售指标由对应 SAP 定义核定。

## 留给目标企业的填写项

企业组织与经营模式、品牌权利、商品实际层级、编码与外部标识、尺码体系、分类、门店和地点、渠道定义、合作角色及权威来源均待提供。对本模板逐项记录采用、修改、排除或新增及其依据，形成目标企业基础层版本。随后选择具体任务核验可用性。
