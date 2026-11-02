import { UNMODELED_CAPABILITIES, type SnapshotRecord } from '../types.ts';

// Retain each released/candidate engine's interpretation for existing evidence.
// Unknown versions must not silently inherit today's rules.
export function engineRules(version: string) {
  if (version !== 'optracall-sim-1' && version !== 'optracall-sim-2') return {
    status: 'unknown' as const, engineVersion: version,
    disclaimer: '该引擎版本的口径未知；保留原记录，不以当前规则解释。',
  };
  return {
    status: 'known' as const, engineVersion: version,
    caliber: {
      eventOrder: ['到货入库', '需求承接（可按变体限流）', 'FIFO 发货', '超期订单取消', '现金费用与周期补货'],
      procurement: '每 7 天（D1/D8/D15/…）按 7 天基础需求量下单，提前期到货，采购当日付款',
      demandShock: '开启后 D8–D21 需求 ×1.3', supplyShock: '开启后补货到货 +3 天',
      contribution: '发货 ×（单价 − 进价 − 单件履约成本）',
      cashRule: '发货确认收入；D0 额外现货按进价即刻扣款',
      perturbations: ['demandMultiplier', 'capacityMultiplier', 'leadTimeDelta', 'priceMultiplier'],
      cashValidation: version === 'optracall-sim-1'
        ? 'IEEE-754 浮点；逐日残差 <1e-6、累计残差 <0.01，可能误拒大额小数输入'
        : 'IEEE-754 浮点；逐日1e-6/累计0.01底限加量级相关舍入容差，不对金额另行四舍五入',
    },
    unmodeled: [...UNMODELED_CAPABILITIES],
    disclaimer: '确定性假设模型：输出是假设的严谨展开，不是现实预测、概率、优化推荐或因果效果。',
  };
}

/** Read-time interpretation by the record's engine identity; never rewrites stored evidence. */
export function snapshotRules(snapshot: SnapshotRecord) {
  const model = engineRules(snapshot.engineVersion);
  if (model.status === 'unknown') return model;
  return { ...model, effective: {
    promoWindow: snapshot.variant.promoWindow ?? { start: snapshot.parameters.promoStart, end: snapshot.parameters.promoEnd },
    promoLift: snapshot.parameters.promoLift * (snapshot.variant.promoLiftScale ?? 1),
    acceptanceCap: snapshot.variant.acceptanceCap, openingExtraStock: snapshot.variant.openingExtraStock,
  } };
}
