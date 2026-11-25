import { randomUUID } from 'node:crypto';

export function makeNormalDraftPayload(gsaPlan: { planId: string; planVersion: number; contentSha256: string }, overrides: Record<string, unknown> = {}) {
  return {
    operationId: randomUUID(),
    gsaPlanId: gsaPlan.planId,
    gsaPlanVersion: gsaPlan.planVersion,
    gsaPlanSha256: gsaPlan.contentSha256,
    expectedDraftRevision: 0,
    estimate: {
      metricKind: 'amount',
      unit: '万元',
      period: '2027-01',
      scopeDescription: '零售事业部 · 全渠道与门店',
      scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' },
      formalTargetValue: 120,
      estimatedValue: 112,
      gapValue: 8,
      basis: '可比门店与渠道历史净销售额及供货节奏测算可达 112 万元',
      evidence: [
        { category: 'internal', summary: '可比经营数据 r2，基准可达 112 万' },
        { category: 'market', summary: '平台 1 月活动日历' },
      ],
      methodNote: '按渠道与品类可比基线加供货约束测算',
    },
    rows: [
      {
        rowId: 'G-01', title: '线下 × 羽绒服净销售额', outcome: '1 月线下羽绒服净销售额达到 50 万元',
        scope: { kind: 'department', id: 'retail-offline', name: '零售线下门店' }, scopeLabel: '线下 × 羽绒服',
        responsible: '门店负责人', strategy: '重点门店新品陈列', contributionNature: 'allocation',
        commitAsGoal: true, metricKind: 'amount', targetValue: 50, unit: '万元',
        crossCellId: 'offline:down-jacket', dimensions: { channel: '线下', category: '羽绒服' },
        basis: '门店目标表 r4', tracked: true,
        checkpoints: [{ id: 'CP-G01-202701-END', label: '月末核对', date: '2027-01-31', targetValue: 50, unit: '万元', status: 'planned', evidenceSource: '门店 POS 净销售额汇总' }],
      },
      {
        rowId: 'G-02', title: '线上 × 羽绒服净销售额', outcome: '1 月线上羽绒服净销售额达到 30 万元',
        scope: { kind: 'department', id: 'retail-online', name: '零售电商渠道' }, scopeLabel: '线上 × 羽绒服',
        responsible: '电商负责人', strategy: '平台活动增量', contributionNature: 'allocation',
        commitAsGoal: true, metricKind: 'amount', targetValue: 30, unit: '万元',
        crossCellId: 'online:down-jacket', dimensions: { channel: '线上', category: '羽绒服' },
        basis: '门店目标表 r4', tracked: true,
        checkpoints: [{ id: 'CP-G02-202701-END', label: '月末核对', date: '2027-01-31', targetValue: 30, unit: '万元', status: 'planned', evidenceSource: '电商平台净销售额汇总' }],
      },
      {
        rowId: 'G-03', title: '线上 × 针织净销售额', outcome: '1 月线上针织净销售额达到 20 万元',
        scope: { kind: 'department', id: 'retail-online', name: '零售电商渠道' }, scopeLabel: '线上 × 针织',
        responsible: '电商负责人', strategy: '会员专属组合', contributionNature: 'allocation',
        commitAsGoal: true, metricKind: 'amount', targetValue: 20, unit: '万元',
        crossCellId: 'online:knitwear', dimensions: { channel: '线上', category: '针织' },
        basis: '会员组合测算 r1', tracked: true,
        checkpoints: [{ id: 'CP-G03-202701-END', label: '月末核对', date: '2027-01-31', targetValue: 20, unit: '万元', status: 'planned', evidenceSource: '电商平台净销售额汇总' }],
      },
      {
        rowId: 'G-04', title: '线下 × 针织净销售额', outcome: '1 月线下针织净销售额达到 15 万元',
        scope: { kind: 'department', id: 'retail-offline', name: '零售线下门店' }, scopeLabel: '线下 × 针织',
        responsible: '门店负责人', strategy: '基础款连带销售', contributionNature: 'allocation',
        commitAsGoal: true, metricKind: 'amount', targetValue: 15, unit: '万元',
        crossCellId: 'offline:knitwear', dimensions: { channel: '线下', category: '针织' },
        basis: '基础款连带测算 r1', tracked: true,
        checkpoints: [{ id: 'CP-G04-202701-END', label: '月末核对', date: '2027-01-31', targetValue: 15, unit: '万元', status: 'planned', evidenceSource: '门店 POS 净销售额汇总' }],
      },
    ],
    reserves: [
      { id: 'RES-01', amount: 5, unit: '万元', purpose: '新品上市预留', owner: '商品负责人', basis: '用于新品供货与上新节奏波动' },
    ],
    gapStrategies: [
      { id: 'GAP-01', name: '新品非活动期增量', strategy: '重点门店新品陈列与回访', expectedContribution: 5, unit: '万元', nonOverlappingScope: '非活动期新品净增量', scopeKey: 'non-promo-new-product', basis: '按历史新品非活动期转化测算', kind: 'expected-increment' },
      { id: 'GAP-02', name: '平台额外增量', strategy: '平台大促专属流量转化', expectedContribution: 3, unit: '万元', nonOverlappingScope: '平台活动额外增量（不含新品非活动期）', scopeKey: 'platform-promo-extra', basis: '平台活动资源位增量估算', kind: 'expected-increment' },
    ],
    views: [
      {
        viewId: 'channel-view', viewName: '渠道计划', metricId: 'net-sales-v2', period: '2027-01', coverageScope: 'retail-all', reserveIncluded: 5,
        cells: [
          { crossCellId: 'offline:down-jacket', label: '线下 × 羽绒服', value: 50, unit: '万元', basis: '门店目标表 r4' },
          { crossCellId: 'online:down-jacket', label: '线上 × 羽绒服', value: 30, unit: '万元', basis: '门店目标表 r4' },
          { crossCellId: 'online:knitwear', label: '线上 × 针织', value: 20, unit: '万元', basis: '门店目标表 r4' },
          { crossCellId: 'offline:knitwear', label: '线下 × 针织', value: 15, unit: '万元', basis: '门店目标表 r4' },
        ],
      },
      {
        viewId: 'category-view', viewName: '商品计划', metricId: 'net-sales-v2', period: '2027-01', coverageScope: 'retail-all', reserveIncluded: 5,
        cells: [
          { crossCellId: 'offline:down-jacket', label: '线下 × 羽绒服', value: 50, unit: '万元', basis: '商品配置表 r4' },
          { crossCellId: 'online:down-jacket', label: '线上 × 羽绒服', value: 30, unit: '万元', basis: '商品配置表 r4' },
          { crossCellId: 'online:knitwear', label: '线上 × 针织', value: 20, unit: '万元', basis: '商品配置表 r4' },
          { crossCellId: 'offline:knitwear', label: '线下 × 针织', value: 15, unit: '万元', basis: '商品配置表 r4' },
        ],
      },
    ],
    timePlan: [
      { periodId: 'W1', granularity: 'week', label: '第 1 周', startDate: '2027-01-01', endDate: '2027-01-07', targetValue: 25, unit: '万元', status: 'planned', checkpointId: 'CP-202701-W1-TOTAL' },
      { periodId: 'W2', granularity: 'week', label: '第 2 周', startDate: '2027-01-08', endDate: '2027-01-14', targetValue: 30, unit: '万元', status: 'planned', checkpointId: 'CP-202701-W2-TOTAL' },
      { periodId: 'W3', granularity: 'week', label: '第 3 周', startDate: '2027-01-15', endDate: '2027-01-21', targetValue: 35, unit: '万元', status: 'planned', checkpointId: 'CP-202701-W3-TOTAL' },
      { periodId: 'W4', granularity: 'week', label: '第 4 周', startDate: '2027-01-22', endDate: '2027-01-31', targetValue: 25, unit: '万元', status: 'planned', checkpointId: 'CP-202701-W4-TOTAL' },
    ],
    ...overrides,
  };
}
