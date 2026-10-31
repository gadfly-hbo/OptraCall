/** Draft text used by the existing modeling-task entry; it does not execute calculations. */
export const MODELING_GUIDE = `请帮我起草一份分析指标体系（SAP 0.2 语义资产包），沉淀可复用的业务含义、指标口径与适用条件。它提供分析资料，不规定必须执行的固定计算步骤；实际分析由 Agent 自主选方法。

业务口径与未决内容：
- 仅围绕本次决策相关内容明确金额或数量单位、业务对象粒度、分母、去重、退款或取消处理、时间归属、适用范围及来源；已有明确共识直接复用，不要求每项都新增问题。
- 使用已有 definition、caliber_switches 和 provenance.note 说明业务含义及其来源；type_params 继续表达支持的指标组合，不增加字段或建立另一套步骤协议。
- 缺失口径保留为未知，不自行补成已确认；冲突并列保留各自来源和差异，交由用户澄清。场景方法引用仅是可调整建议，不能把相关性写成因果已成立。
- 引用已发布资产时注明指标名与版本；起草、人工审核发布、项目启用和分析采用是不同动作，不自动升级旧版本。

建议步骤：
1. 先理解业务背景：要支持什么决策、有哪些维度与时间粒度、已有哪些口径共识；仅对影响任务的真实缺口向我确认。
2. 起草 YAML 草稿并保存到 020_clean/，文件名建议 <体系id>@<版本>.draft.yaml。
3. SAP 0.2 结构（未知字段会被拒绝）：
   - sap: "0.2"
   - package: { id: 小写字母与中划线, version: 语义化版本, namespace: mf.<id>, fingerprint: "" }
   - dimensions: 顶层维度清单（小写下划线命名）
   - metrics: name/display_name/type(simple|ratio|derived|cumulative)/definition(中文口径)/dimensions/time_grains(day|week|month|quarter|year)/owner_role/caliber_switches/type_params(numerator|denominator/expr/measure/window/grain_to_date)/provenance(origin: llm, model: 当前模型, reviewed_by: 留待用户审核)
   - scenarios: id/version/title/decision_purpose/metric_usages(metric + role: outcome|driver|guardrail)/method_refs/evidence_requirements
4. 校验规则：指标 dimensions 必须取自顶层清单；场景引用的指标必须存在；ratio 必须有 numerator 与 denominator；type_params 引用的指标必须存在。
5. 完成后提醒我到「指标体系」页审核发布；发布后草稿仍保留在 020_clean。
如存在已发布包，可参考 ~/.optracall/metric-assets/<id>/<版本>.sap.yaml 的写法。`;
