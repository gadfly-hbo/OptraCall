import type { SkillEvaluation } from './skill-evaluation.ts';

export const catalogCategories = ['assets', 'scenarios', 'connectors', 'plugins'] as const;
export type CatalogCategory = typeof catalogCategories[number];
export type CatalogEntry = 'metric' | 'requirement' | 'enterprise-materials' | 'decision' | 'refiner' | 'ppt-report' | 'simlab' | 'target-forecast' | 'coupon-forecast' | 'roi-forecast' | 'deep-research' | 'trade-area-mcp' | 'weather-mcp';
export type CatalogItem = {
  id: string; category: CatalogCategory; name: string; description: string;
  tags: string[]; source: string; note: string;
  skill?: { evaluation?: SkillEvaluation };
} & ({ status: '已接入'; entry: CatalogEntry } | {
  status: '规划示例' | '预留接入'; entry?: never;
});
const deepResearchEvaluation: SkillEvaluation = {
  date: '2026-11-04', testedRevision: 'a78a478', revisedSinceEvaluation: true,
  outcome: 'effective', sampleCount: 10,
  assertions: { basis: '条目累计', baseline: 16.2, variant: 29.4 },
  activation: { activated: 8, total: 10 },
  judgments: { wins: 3, ties: 1, losses: 0, undetermined: 6 },
  seconds: { baseline: 278.9, variant: 460.8 },
  tokens: { baseline: 1_110_000, variant: 1_720_000 },
};
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
  { id: 'metric-factory', category: 'assets', name: 'SAP 分析资产', description: '统一管理分析指标与分析方法；方法先保存、后发布，发布后供后续任务按需参考。', tags: ['指标口径', '指标体系', '分析方法', '适用条件'], source: 'OptraCall 分析资产', note: '指标定义保留原发布边界；IR 与非 IR 方法共用保存、发布、版本与纠错规则，不另建调用流程。', status: '已接入', entry: 'metric' },
  { id: 'ppt-report', category: 'assets', skill: {}, name: 'PPT 报告生成', description: '以正式 md 报告生成候选版 PPTX：内容红线（不编造、数字逐字）+ 版式规范 + 单页重生成与核对脚本，随产品内置。', tags: ['PPT 生成', '报告表达'], source: 'OptraCall 分析资产 · ppt-report skill', note: '无需安装：随产品分发，版本随 OptraCall 更新。使用入口＝项目文件 060_reports 中 md 报告的「生成 PPTX」按钮；分析需求已声明 PPTX 的任务在报告完成后可直接生成。', status: '已接入', entry: 'ppt-report' },
  { id: 'target-forecast', category: 'assets', skill: {}, name: '经营目标测算', description: '内置分析 skill，随 OptraCall 更新。在项目任务对话中使用。人、货、场三视角 GMV 目标测算：数据三级校验、口径确认、多情景计算与交叉校验，确定性脚本随产品内置。', tags: ['目标测算', '人货场'], source: 'OptraCall 分析资产 · target-forecast skill', note: '无需安装 skill：随产品分发，版本随 OptraCall 更新。使用入口＝项目任务对话，直接提出目标测算问题；Agent 按需使用 skill 与脚本，报告落 060_reports。脚本需要 Python 与 openpyxl；测算属于情景推演，不是预测承诺。', status: '已接入', entry: 'target-forecast' },
  { id: 'coupon-forecast', category: 'assets', skill: {}, name: '优惠券测算', description: '内置分析 skill，随 OptraCall 更新。在项目任务对话中使用。满减券四子模型情景测算：保留无券基线，比较回本所需转化提升、约束过滤与压力结果，确定性脚本随产品内置。', tags: ['优惠券', '营销测算'], source: 'OptraCall 分析资产 · coupon-forecast skill', note: '无需安装 skill：随产品分发，版本随 OptraCall 更新。使用入口＝项目任务对话，直接提出发券决策问题；Agent 按需使用 skill 与脚本，报告落 060_reports。脚本需要 Python，表格导入另需 openpyxl；允许不发券的结论。', status: '已接入', entry: 'coupon-forecast' },
  { id: 'roi-forecast', category: 'assets', skill: {}, name: '投放 ROI 测算', description: '内置分析 skill，随 OptraCall 更新。在项目任务对话中使用。多投放计划盈亏链路测算：保本转化率、情景敏感度、净贡献排名与跨档稳定性，确定性脚本随产品内置。', tags: ['投放 ROI', '盈亏测算'], source: 'OptraCall 分析资产 · roi-forecast skill', note: '无需安装 skill：随产品分发，版本随 OptraCall 更新。使用入口＝项目任务对话，直接提出投放盈亏问题；Agent 按需使用 skill 与脚本，报告落 060_reports。脚本需要 Python；测算属于情景推演，允许净亏损的结论。', status: '已接入', entry: 'roi-forecast' },
  { id: 'deep-research', category: 'assets', skill: { evaluation: deepResearchEvaluation }, name: '深度研究', description: '内置分析 skill，随 OptraCall 更新。在项目任务对话中开展多源研究与报告写作，按需委派调研、审稿子角色，保留来源引用与研究局限。', tags: ['深度研究', '研究报告'], source: 'OptraCall 分析资产 · deep-research skill', note: '使用入口＝项目任务对话，提出行业研究、竞品分析或专题调研问题，最终报告落 060_reports。检索取决于当前配置路线：MiniMax M3/M3.1-Flash、MiMo v2.6 系列接通原生检索；DeepSeek flash 路线未接通时如实声明，仅基于用户材料综述。没有可引用来源不等于路线未接通；重要决策请核验来源和结论。', status: '已接入', entry: 'deep-research' },
  planned('assets', 'A03', '假设与策略资产包', '保留候选解释、反证要求和策略适用条件。', ['假设策略', '反证'], '候选假设不等于已确认事实，策略也不等于实际执行。'),
  planned('assets', 'A04', '实验与效果评估资产包', '明确实验单位、评价窗口与效果解释边界。', ['实验评估', '统计约定'], '未来需结合真实实验设计与数据质量判断适用性。'),
  planned('assets', 'A05', '报告与表达规范资产包', '复用经营复盘、实验报告的结构与证据表达要求。', ['报告模板', '表达规范'], '此处没有生成报告，模板是否生效需在接入任务中验证。'),
  planned('scenarios', 'S01', '月度经营复盘', '围绕经营变化，组合指标、解释材料和行动候选。', ['经营复盘', '周期分析'], '场景仅组织目标与依赖，分析路线仍由 Agent 按上下文选择。'),
  planned('scenarios', 'S02', '会员复购诊断', '围绕复购变化，组织 Cohort、人群与渠道调查材料。', ['会员经营', 'Cohort'], '未来需核对会员口径、观察窗口和数据覆盖。'),
  planned('scenarios', 'S03', '优惠券效果评估', '连接发券前测算与执行后评估，区分预测和实际效果。', ['营销活动', '实验评估'], '此处没有发券或测算，也不代表存在增量效果。'),
  planned('scenarios', 'S04', '目标与预测纠偏', '对照目标、预测和实际，组织差距判断与行动反馈。', ['目标管理', '预测反馈'], '场景组合不复制底层插件实现，也不建立独立 Runtime。'),
  planned('scenarios', 'S05', '用户反馈诊断', '整理评论、工单主题，形成进一步调查的问题。', ['用户反馈', '文本分析'], '未来按授权读取资料，文本提及不能代表全体用户发生率。'),
  planned('scenarios', 'S06', '门店空间经营分析', '组合门店与区域材料，支持覆盖和选址研究。', ['门店经营', '空间分析'], '此处没有地图计算，候选区域只作为示例。'),
  { id: 'trade-area-mcp', category: 'connectors', name: '商圈数据', description: '按省市、评级、关键词与指标筛选商圈，读取完整档案及来源、可信度，按自定义权重计算选址评分。数据快照在本机，连接器无网络外发。', tags: ['商圈', '选址', '本机数据'], source: 'OptraCall 连接器 · trade-area-mcp', note: '使用入口＝项目任务对话，任务级显式开启后由 Agent 自主查询，结果带数据版本。未公开字段如实保留；查询结果会进入所选任务模型上下文，不代表整段对话零数据外发。', status: '已接入', entry: 'trade-area-mcp' },
  { id: 'weather-mcp', category: 'connectors', name: '历史天气', description: '按城市或坐标和日期查询 Open-Meteo 历史日均温与降水，缺失不填零，结果标明来源、获取时间与缓存时效。', tags: ['天气', '历史日级', '外部网络'], source: 'OptraCall 连接器 · weather-mcp', note: '使用入口＝项目任务对话，需任务级开启。仅向 archive-api.open-meteo.com 发送坐标、日期、字段和时区，无密钥；免费 API 仅限非商业，按 Open-Meteo 条款使用。结果会进入所选模型上下文。', status: '已接入', entry: 'weather-mcp' },
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
  { id: 'decision-platform', category: 'plugins', name: '决策看板', description: '跨项目汇总分析报告，抽取建议并跟进采纳、行动与复盘。', tags: ['决策协同', '行动反馈'], source: '本仓库决策看板 · 顶部“决策”入口', status: '已接入', entry: 'decision', note: '读取各项目 060_reports 报告并显式触发模型抽取；进入决策看板页面后，实际能力以该页面为准。' },
  { id: 'ppt-refiner', category: 'plugins', name: 'PPT 逐页精修', description: '读取候选版 PPTX，在独立会话中逐页对话修改：页图预览、数字锚点拦截、页锁定、版本回退、差异清单导出。', tags: ['PPT 精修', '报告编审'], source: 'OptraCall 业务插件 · ppt-refiner', note: '仅面向本产品生成的候选版；md 报告只读锚定，不回写；使用统一 Agent 底座与独立精修会话。', status: '已接入', entry: 'refiner' },
  { id: 'sim-lab', category: 'plugins', name: '经营推演', description: '把备货与促销假设展开成可审计的逐日账本：多方案对比、自定义扰动、固化不可变快照作为决策证据；页面直接推演，也可在任务中由 Agent 工具化推演。', tags: ['经营仿真', '决策证据'], source: 'OptraCall 业务插件 · sim-lab', note: '确定性假设模型，不是预测；探索自由、固化由用户确认。Agent 工具需在任务级显式开启。', status: '已接入', entry: 'simlab' },
];

export function filterCatalog(category: CatalogCategory, query: string, tag: string): CatalogItem[] {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  return catalogItems.filter(item => item.category === category
    && (tag === '全部' || item.tags.includes(tag))
    && (!needle || [item.name, item.description, item.id, ...item.tags].join(' ').toLocaleLowerCase('zh-CN').includes(needle)));
}
