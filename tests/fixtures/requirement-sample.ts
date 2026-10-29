import { upstreamDigest, upstreamFingerprint, type RequirementInstance } from '../../extensions/business-plugins/requirements-elaboration/contract/validate.ts';

const created = '2026-10-30T00:00:00.000Z', updated = '2026-10-30T01:00:00.000Z';
const sampleWithoutSnapshot = (): RequirementInstance => ({
  instance: { version: '0.1', id: 'req-demo-001', scene: 'topic', title: '双11复购下滑归因', createdAt: created, updatedAt: updated },
  context: { background: '双11后大盘复购走低', goal: '定位下滑主驱动因素', decisionScenario: '指导下季度预算分配' },
  clarifications: [
    { id: 'clr-1', category: '指标口径', priority: 'must_confirm', question: '复购口径是否剔除退款单？', rationale: '直接影响分子', status: 'pending' },
    { id: 'clr-2', category: '风险', priority: 'must_confirm', question: '是否排除内部测试账号？', rationale: '口径一致性', status: 'answered', answer: '排除，名单由数据组维护' },
    { id: 'clr-3', category: '可用数据', priority: 'can_defer', question: '会员等级标签以哪个版本为准？', rationale: '后置确认', status: 'deferred' },
  ],
  facts: ['双11大促首购会员30天复购率从28%下滑至19%'],
  hypotheses: [
    { id: 'hyp-1', statement: '高额满减券吸引低客单羊毛党', evidence: '券核销订单占比显著上升', validationCondition: '券核销用户复购率显著低于无券首购用户', status: 'confirmed' },
    { id: 'hyp-2', statement: '品类结构变化解释整体下滑', evidence: '美妆新客占比上升且复购基线更低', validationCondition: '品类内部复购率不变则结构效应为主因', status: 'deferred' },
  ],
  framework: {
    metrics: [{ name: '30日会员复购率', definition: '首购后30天内二次有效支付会员数/首购会员总数', dimensions: ['首购渠道', '价格带'], source: '实例新增口径' }],
    dataNeeds: [{ table: 'dwd_trade_order_di', fields: ['user_id', 'order_id', 'order_time', 'pay_amount', 'channel_id'], priority: 'P0', purpose: '订单明细宽表：复购周期与漏斗' }],
    analysisPaths: [{ question: '不同首购渠道复购率是否存在显著差异？', hypothesis: 'hyp-1', method: '渠道分层交叉对比+卡方检验', requiredData: ['dwd_trade_order_di'], expectedOutput: '渠道30日复购率对比与显著性结论' }],
    reportFramework: [{ section: '01 核心摘要与归因总览', purpose: '给出第一贡献因子与影响金额', keyQuestions: ['下滑核心驱动因素？量化贡献度？'], evidence: ['渠道贡献度分解树'], zeroHallucinationCheck: '相关性推测不得表述为确定性因果' }],
    openQuestions: ['退款未发货订单是否剔除，当前暂按支付成功口径'],
    risks: ['大促期间渠道投放策略同期变化，归因存在混杂'],
  },
});

export const sampleInstance = (): RequirementInstance => {
  const base = sampleWithoutSnapshot();
  return { ...base, snapshot: { fingerprint: upstreamFingerprint(base), confirmedAt: created, upstreamDigest: upstreamDigest(base), confirmedBy: 'huangbo' } };
};
export const sampleWithoutSnapshotExport = sampleWithoutSnapshot;
