export const catalogCategories = ['assets', 'scenarios', 'connectors', 'plugins'] as const;
export type CatalogCategory = typeof catalogCategories[number];
export type CatalogEntry = 'metric' | 'requirement' | 'enterprise-materials';
export type CatalogItem = {
  id: string; category: CatalogCategory; name: string; description: string;
  tags: string[]; source: string; note: string;
} & ({ status: '已接入'; entry: CatalogEntry } | {
  status: '规划示例' | '预留接入'; entry?: never;
});
export const catalogMeta: Record<CatalogCategory, { label: string; description: string; symbol: string }> = {
  assets: { label: '分析资产', description: '复用业务定义、分析方法与表达规范，让每次分析都有依据。', symbol: '◈' },
  scenarios: { label: '场景组合', description: '围绕一个业务问题，组合目标、所需能力与交付材料。', symbol: '◇' },
  connectors: { label: '连接器', description: '连接获准的数据与业务来源，保留来源和访问边界。', symbol: '⌘' },
  plugins: { label: '业务插件', description: '为具体问题提供专业能力，与统一 Agent 底座协同。', symbol: '▧' },
};
function planned(category: CatalogCategory, id: string, name: string, description: string, tags: string[], note: string): CatalogItem {
  return { category, id, name, description, tags, note: `尚未接入 OptraCall。${note}`, source: `JuanerAI 候选规划 v0.1 · ${id}`, status: '规划示例' };
}
export const catalogItems: CatalogItem[] = [
  { id: 'enterprise-business-materials', category: 'assets', name: '企业业务资料', description: '集中维护企业背景原文与修订，Case 引用明确版本并补充本案资料。', tags: ['企业背景', '资料原文'], source: 'OptraCall 企业业务资料', note: '公共资料、明确修订与本案补充各自保留来源。', status: '已接入', entry: 'enterprise-materials' },
  { id: 'metric-factory', category: 'assets', name: '指标体系', description: '维护可复用的指标定义、业务口径与 SAP 发布版本，并按需关联项目。', tags: ['指标口径', '业务定义'], source: 'OptraCall 指标体系', note: '使用现有指标体系工作台。', status: '已接入', entry: 'metric' },
  planned('assets', 'A02', '分析方法资产包', '组织漏斗、Cohort、RFM 与变化分解等常用方法。', ['分析方法', '适用条件'], '方法是 Agent 可参考的材料，不是宿主强制执行的阶段。'),
  planned('assets', 'A03', '假设与策略资产包', '保留候选解释、反证要求和策略适用条件。', ['假设策略', '反证'], '候选假设不等于已确认事实，策略也不等于实际执行。'),
  planned('assets', 'A04', '实验与效果评估资产包', '明确实验单位、评价窗口与效果解释边界。', ['实验评估', '统计约定'], '未来需结合真实实验设计与数据质量判断适用性。'),
  planned('assets', 'A05', '报告与表达规范资产包', '复用经营复盘、实验报告的结构与证据表达要求。', ['报告模板', '表达规范'], '此处没有生成报告，模板是否生效需在接入任务中验证。'),
  planned('scenarios', 'S01', '月度经营复盘', '围绕经营变化，组合指标、解释材料和行动候选。', ['经营复盘', '周期分析'], '场景仅组织目标与依赖，分析路线仍由 Agent 按上下文选择。'),
  planned('scenarios', 'S02', '会员复购诊断', '围绕复购变化，组织 Cohort、人群与渠道调查材料。', ['会员经营', 'Cohort'], '未来需核对会员口径、观察窗口和数据覆盖。'),
  planned('scenarios', 'S03', '优惠券效果评估', '连接发券前测算与执行后评估，区分预测和实际效果。', ['营销活动', '实验评估'], '此处没有发券或测算，也不代表存在增量效果。'),
  planned('scenarios', 'S04', '目标与预测纠偏', '对照目标、预测和实际，组织差距判断与行动反馈。', ['目标管理', '预测反馈'], '场景组合不复制底层插件实现，也不建立独立 Runtime。'),
  planned('scenarios', 'S05', '用户反馈诊断', '整理评论、工单主题，形成进一步调查的问题。', ['用户反馈', '文本分析'], '未来按授权读取资料，文本提及不能代表全体用户发生率。'),
  planned('scenarios', 'S06', '门店空间经营分析', '组合门店与区域材料，支持覆盖和选址研究。', ['门店经营', '空间分析'], '此处没有地图计算，候选区域只作为示例。'),
  planned('connectors', 'C01', '数据库与数据仓库', '发现获准访问的表、字段与查询结果。', ['数据库', '只读查询'], '尚无连接实例、凭据、查询或数据读取。'),
  planned('connectors', 'C02', 'BI 指标与报表', '复用既有报表、指标定义与刷新信息。', ['BI', '语义模型'], '正式业务定义与来源访问分别核对，不自动采用映射。'),
  planned('connectors', 'C03', '业务系统', '按授权获取订单、会员、库存等有限业务对象。', ['ERP', 'CRM', '电商'], '目录不授予 ERP/CRM 访问或业务写入权限。'),
  planned('connectors', 'C04', '办公文件与协作', '连接工作簿、文档与获准的文件来源。', ['Excel', '文档'], '本 Demo 仍不包含上传、文件读取或协作发送。'),
  planned('connectors', 'C05', '外部情报与专业数据', '补充天气、区域与行业等外部变量。', ['外部情报', '行业数据'], '没有联网采集，来源许可和更新时间将在实际接入中确定。'),
  planned('connectors', 'C06', '业务行动', '将已批准建议衔接到待办、工单和执行回执。', ['行动反馈', '工单'], '没有创建任务或发送通知，真实动作仍需相应授权。'),
  { id: 'requirements-elaboration', category: 'plugins', name: '需求梳理', description: '梳理业务问题、确认信息与未知，维护 RAP，并显式送入项目任务。', tags: ['需求澄清', 'RAP'], source: 'OptraCall 需求梳理', note: '使用现有需求梳理插件和统一会话入口。', status: '已接入', entry: 'requirement' },
  planned('plugins', 'P01', '数据质量与业务对账', '检查缺失、重复、期间可比性与跨表差异。', ['数据质量', '业务对账'], '没有执行检查，不显示任何验证通过结论。'),
  planned('plugins', 'P02', '非结构化内容分析', '将评论、工单与访谈整理为可核对的结构化记录。', ['文本分析', '主题分类'], '没有读取文本或调用模型，未来需独立评估分类质量。'),
  planned('plugins', 'P03', '分析结果验证器', '核对指标、计算、图表与证据是否相互一致。', ['结果验证', '证据检查'], '目录不是验证器结果，未运行项不能标为通过。'),
  planned('plugins', 'P04', '地理空间分析', '为距离、覆盖与区域聚合提供专业计算。', ['空间分析', '门店经营'], '尚无坐标、地图服务或空间计算。'),
  planned('plugins', 'P05', 'Excel／BI 资产复用', '登记已有测算表和查询，说明参数与重算限制。', ['Excel', '资产复用'], '没有重算工作簿，缓存值与实际计算将在接入时区分。'),
  { id: 'decision-platform', category: 'plugins', name: '决策工作台', description: '为项目、建议、行动与结果复盘预留协同工作区。', tags: ['决策协同', '行动反馈'], source: 'decision-platform 项目 README · 只读核对', status: '预留接入', note: '尚未接入 OptraCall。仅借用项目化看板的布局语义；不复制旧独立 Runtime，不读取远端数据，不执行业务动作。' },
];

export function filterCatalog(category: CatalogCategory, query: string, tag: string): CatalogItem[] {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  return catalogItems.filter(item => item.category === category
    && (tag === '全部' || item.tags.includes(tag))
    && (!needle || [item.name, item.description, item.id, ...item.tags].join(' ').toLocaleLowerCase('zh-CN').includes(needle)));
}
