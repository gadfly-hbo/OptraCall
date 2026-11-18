# T01｜运动鞋服行业主数据、指标体系与本体模板

版本 v0.2 · 2026-11-12 · 建模建议，供审核


本版增加指标体系、三类资产关联和分项状态；上一版原文保留在[同名 v0.1 模板](../01-sportswear-industry.md)。全部候选与公开参考仍待用户审核，目标企业正式资产尚未建立。


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
| `Party` 主体／有证据的一名个人或一个组织 | `party_id:text`、`party_kind:code`、`source_identifier_refs:ref[]`、`identity_state:code` | 与会员领域共享；顾客是主体参与业务的角色，账号另建；未知自然人关系留待核定 |
| `Assortment` 商品组合／范围和期间内的上架集合，可选 | `assortment_id:text`、`scope_refs:ref[]`、`product_refs:ref[]`、`valid_period:period` | 上架资格不是库存余额；可按门店、渠道、市场配置 |
| `MaterialSpecification` 材料规格／一个规格，可选 | `material_id:text`、`name:text`、`composition_refs:ref[]`、`uom_ref:ref` | 用于设计制造；成品与物料、材料成分及批次分别表达 |

`ColorCode`、`SizeSystem`、`UnitOfMeasure`、`Currency`、`CountryRegion`、`StatusCode`、`OperationMode` 是参考值域候选，应记录体系、代码、名称及版本。价格表／报价条件可作为受管规则对象；成交价、库存余额和销售金额带业务时点，分别进入交易或分析资产。

## 标准词汇候选对齐

商品家族和变体可参考 [Schema.org ProductGroup](https://schema.org/ProductGroup) 的 `hasVariant`、`isVariantOf` 和 `variesBy`；`ProductStyle`、款色及 SKU 层级仍属本模板建议。GTIN 的识别用途参考 [GS1 GTIN 管理标准](https://ref.gs1.org/standards/gtin-management/)；GLN 的对象区分参考[标准研究 S02](../generic-reference-sources-v0.1.md)中列明的官方资料及访问限制。组织层级可参考 [W3C ORG](https://www.w3.org/TR/vocab-org/)。

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

企业组织与经营模式、品牌权利、商品实际层级、编码与外部标识、尺码体系、分类、门店和地点、渠道定义、合作角色及权威来源均待提供。对本模板逐项记录采用、修改、排除或新增及其依据，形成目标企业基础层版本。本稿下文同时提供指标体系与三类关联，随后选择实际任务核验使用。

## 指标体系：主题与候选目录

下列均为建模建议，`metricKey` 是参考项 ID，尚无目标企业 SAP 包或正式资格。测量骨架用于核定含义；内化后定义及公式写入原 SAP，体系目录只引用准确包版本及指标名。单位、状态、税费、退款归属、币种与截止以企业资料核定，未核定时定义仍待核。

| 主题／用途 | 候选指标族 | 覆盖及取舍 |
| --- | --- | --- |
| 商品与组合 | 商品规模、上架与供给覆盖 | 依据实际款／款色／SKU 粒度选用，保持层级分别度量 |
| 销售与经营价值 | 成交、退款、净销售、数量、价格与毛利 | 零售和批发、业务流水与财务报表范围分开 |
| 库存与供应 | 库存规模、可售覆盖、周转 | 库存时点和期间流量分别表达；有成本资料才能形成成本口径周转 |
| 门店与渠道 | 规模、结构、可比表现 | 开闭店、经营方和渠道变化保留历史；不同维度交叉不重复求和 |
| 履约与服务 | 交付数量、及时性、退换货 | 承诺、发生、记录及退款到账时间各有含义 |

| metricKey／候选名称 | 定义或测量骨架 | 对象、粒度、单位 | 维度、时间及资格 | 必要数据与来源 |
| --- | --- | --- | --- | --- |
| `ind.product.effective_skus` 有效可售品项数 | 截至时点满足上架及经营资格的不同 SKU 数 | `SellableSKU`；SKU；个 | 品牌、类目、市场、渠道；状态与上架有效期待核 | 商品字典、组合／上架规则及变更记录 |
| `ind.sales.terminal_amount` 退款前成交额 | 约定合格成交事件金额合计，金额组成明确 | 订单行／付款分摊；货币 | 门店、渠道、商品；支付／完成时间取舍待核，排除测试取消等规则 | 交易、付款、分摊、币种／税费规则 |
| `ind.sales.refund_amount` 退款额 | 对应范围内有效退款金额正值合计 | 退款分录；货币 | 退款发生期或原订单群分别定义，部分退款不重复 | 退款状态、原交易关联、到账／发生时间 |
| `ind.sales.net_amount` 净零售额 | 在相同资格与范围下，退款前成交额减对应退款额 | 业务范围；货币 | 两项必须同币种、税费、归属范围及截止；期间差异单列 | 上两项及明确期间归属政策 |
| `ind.sales.order_count` 合格订单数 | 按真实订单身份去重的合格订单数 | 订单；单 | 订单合并、拆单、有效状态和退款后资格待核 | 订单头行关系、状态与规则 |
| `ind.sales.net_units` 净销售数量 | 合格销售数量减对应退回数量；资金退款不直接代实物退回 | 订单行／退货行；统一计量单位 | 商品、门店；单位与退货归属一致 | 销售行、实物退货、单位换算依据 |
| `ind.sales.average_unit_price` 平均净销售单价 | 同范围净销售额除净销售数量，零／负分母另说明 | 商品集合；货币／件等 | 产品组合、渠道、期间一致；不能简单平均各 SKU 单价 | 净金额与净数量的准确指标引用 |
| `ind.inventory.end_quantity` 期末库存量 | 截止时点 SKU×地点的核定库存量 | SKU×地点快照；数量单位 | 区分在手、可售、在途、冻结；跨时点不可直接相加 | 库存快照或可复算流水与状态说明 |
| `ind.inventory.availability` 可售品项覆盖率 | 同范围应经营且符合比较条件品项中，满足可售库存条件的比例 | SKU×经营范围；比率 | 上架组合、库存时点及缺货判定待核；未知库存不填零 | 组合、库存及可售阈值规则 |
| `ind.inventory.turnover` 成本口径库存周转 | 同期间销售成本与约定平均成本库存的比值 | 业务范围；次／期间 | 成本计价、平均方法、币种和范围须一致；收入不能代销售成本 | 成本、库存估值及期间／平均规则 |
| `ind.fulfillment.on_time_rate` 按时交付率 | 符合观察资格的履约单位中，实际交付满足承诺条件的比例 | 订单／包裹择一；比率 | 承诺版本、拆包、取消、未到观察截止的单位分别表达 | 承诺与交付事件、单位关联与截止 |
| `ind.value.gross_margin` 毛利率 | 同会计范围收入与成本核定后形成毛利占收入比例 | 财务或经营范围；比率 | 收入确认、成本、币种和期间一致；零收入另处理 | 财务规则、收入与成本原始依据 |

以上覆盖是参考目录，不要求每企业启用全部指标。指标定义中的单位、分子分母、状态和时间仍需核定，不因给出名称或算式就认定可算。

## 指标关系：分开表达四种语义

| 关系类别 | 本模板候选例子 | 检查条件 |
| --- | --- | --- |
| 目录归属 | 净零售额归入销售主题，库存周转归入库存主题 | 用于导航，不产生计算或聚合关系 |
| 公式依赖 | 净额依赖成交额和退款额；平均单价依赖净额和净数量 | 准确引用同范围指标，核币种、数量单位、资格及零分母 |
| 统计分解 | 净额按门店／商品／渠道分组；SKU 计数按品类分类 | 分组互斥完备、层级和多标签口径明确；不能将不同维度分组结果再次相加 |
| 分析用途关联 | 可售覆盖、销售和履约可共同支持经营诊断 | 关联或 `driver` 用途不证明因果，解释需另有证据 |

## 三类资产关联与内化

参考逻辑 ID：`md.sku` 对应 `SellableSKU`，`md.store` 对应 `Store`，`md.party` 对应 `Party`；其企业主键另由资料核定。下表给出需查证的联合片段，`ont.*` 为拟建本体项而非已实现图节点。

| 主数据项／粒度 | 参考 metricKey | 事件、维度、时间及资格 | 本体关联候选 | 实际 Binding 与核验 |
| --- | --- | --- | --- | --- |
| `md.sku`、`md.store` | `ind.sales.net_amount`、`ind.sales.net_units` | 订单行、付款、退货、退款；商品与门店归属；期间一致 | `ont.order_line_sale`、`ont.refund_of_transaction`；实物退货与资金退款分开 | 企业交易／退款键、粒度、金额单位及分摊待映射 |
| `md.sku`、地点 | `ind.inventory.end_quantity`、`ind.inventory.availability` | 时点库存、经营组合、可售条件 | `ont.inventory_at`、`ont.sku_in_assortment` | 快照时间、状态及组合有效期待核；缺失不作零库存 |
| 业务组织、市场 | `ind.value.gross_margin`、`ind.inventory.turnover` | 收入与成本／估值；相同合并范围和期间 | `ont.recognized_revenue`、`ont.cost_scope` | 账务口径与业务流水差异、计价及币种待核 |
| 经营方、渠道、`md.store` | 门店规模及门店分组指标 | 开闭店、经营权变更、可比条件 | `ont.operated_by_during`、`ont.store_at_site` | 门店历史有效区间与交易时点关联待核 |

每片段记录参考版本／item、目标 item、采用动作、企业依据和差异影响。当前为参考建议：企业定义待核、数据未映射、当前不可计算、实际使用未验；四项状态和治理身份分别保存。完成企业定义不要求所有库存或财务资料已经具备，但不得把受限定义发布为无条件计算标准。
