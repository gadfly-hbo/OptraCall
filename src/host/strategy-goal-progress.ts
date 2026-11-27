import type { GoalMeasurement } from './strategy-goals-types.ts';
import type {
  DecompositionFrozenCheckpoint, DecompositionPublicationSnapshot, DecompositionTimePeriod,
  ProgressCheckIssue, ProgressComparability, ProgressEvidenceBasis,
} from './strategy-goal-decomposition-types.ts';

export function progressMetric(snapshot: DecompositionPublicationSnapshot | undefined, measurement: GoalMeasurement): string {
  const sap = snapshot?.estimate.sapMetric ?? (measurement.kind === 'quantitative' ? measurement.sapMetric : undefined);
  if (sap) return `${sap.id}@${sap.version}`;
  return measurement.kind === 'deliverable' ? measurement.criterion : '';
}

export function granularityLabel(granularity: DecompositionTimePeriod['granularity'] | undefined): string {
  if (granularity === 'day') return '日';
  if (granularity === 'week') return '周';
  if (granularity === 'month') return '月';
  return '当前';
}

export function comparabilityLabel(comparability: ProgressComparability): string {
  if (comparability === 'comparable') return '可比';
  if (comparability === 'partial-missing') return '部分未出数';
  if (comparability === 'observing') return '观察窗未满';
  return '口径/期间不可比';
}

const UNIT_SCALE_FAMILIES: readonly Record<string, number>[] = [
  { '元': 1, '千元': 1e3, '万元': 1e4, '亿元': 1e8 },
  { '件': 1, '千件': 1e3, '万件': 1e4 },
  { '人': 1, '千人': 1e3, '万人': 1e4 },
  { '克': 1, 'g': 1, '千克': 1e3, '公斤': 1e3, 'kg': 1e3, '吨': 1e6, 't': 1e6 },
];

/** Returns exact arithmetic factor (sourceValue * factor = targetValue) when both units belong to a known scale family; null otherwise. */
export function knownUnitScale(sourceUnit: string, targetUnit: string): number | null {
  const src = sourceUnit.trim();
  const dst = targetUnit.trim();
  if (!src || !dst) return null;
  for (const family of UNIT_SCALE_FAMILIES) {
    if (Object.hasOwn(family, src) && Object.hasOwn(family, dst)) {
      return family[src]! / family[dst]!;
    }
  }
  return null;
}

/** Verify literal source spans against their full-report boundaries, not a semantic scope/metric classifier. */
export function quotedMeasurementEvidence(quote: string, value: number, reportText: string): { hasExactValue: boolean; units: string[] } {
  const normalize = (text: string) => text.replace(/(?<=\d)[,，](?=\d{3}(?:\D|$))/g, '');
  const text = normalize(reportText), excerpt = normalize(quote);
  const names = [...new Set(UNIT_SCALE_FAMILIES.flatMap(family => Object.keys(family)))].sort((a, b) => b.length - a.length);
  const numbers = /[+-]?(?:\d+\.\d+|\d+|\.\d+)/g;
  const fullNumbers = new Map([...text.matchAll(numbers)].map(match => [match.index!, match[0]]));
  const quotedNumbers = [...excerpt.matchAll(numbers)].filter(match => Number(match[0]) === value);
  const found = new Set<string>();
  let hasExactValue = false;
  for (let offset = text.indexOf(excerpt); excerpt && offset >= 0; offset = text.indexOf(excerpt, offset + 1)) {
    for (const match of quotedNumbers) {
      const start = offset + match.index!;
      if (fullNumbers.get(start) !== match[0]) continue;
      hasExactValue = true;
      // Inspect the full source even when the chosen excerpt ends before /人, an exponent, etc.
      const suffix = text.slice(start + match[0].length).trimStart();
      const unit = names.find(name => suffix.startsWith(name));
      if (!unit) continue;
      const next = suffix.slice(unit.length);
      const compound = next.match(/^[A-Za-z/%／·⋅×*^²³⁻⁰¹⁴⁵⁶⁷⁸⁹]+/) ?? next.trimStart().match(/^[/%／·⋅×*^²³⁻⁰¹⁴⁵⁶⁷⁸⁹]+/);
      found.add(compound ? unit + compound[0] : unit);
    }
  }
  return { hasExactValue, units: [...found] };
}

/** A row checkpoint can fall in a planned reporting period or stand on its own dated milestone. */
export function checkpointPeriods(plan: DecompositionTimePeriod[], checkpoint: DecompositionFrozenCheckpoint): DecompositionTimePeriod[] {
  const matches = plan.filter(p => p.startDate <= checkpoint.date && checkpoint.date <= p.endDate);
  if (matches.length) return matches;
  return [{
    periodId: checkpoint.checkpointId, granularity: 'day', label: checkpoint.label,
    startDate: checkpoint.date, endDate: checkpoint.date, targetValue: checkpoint.targetValue,
    unit: checkpoint.unit, status: checkpoint.status, checkpointId: checkpoint.checkpointId,
  }];
}

export function assessProgressEvidenceDetails(
  basis: ProgressEvidenceBasis | undefined,
  expected: { metric: string; unit: string; scope: string; period: DecompositionTimePeriod; observationDate: string; planned: boolean },
  cutoff: string,
  actual: number | null,
  assessment: ProgressComparability,
): { comparability: ProgressComparability; issues: ProgressCheckIssue[] } {
  const issues: ProgressCheckIssue[] = [];
  const start = Date.parse(expected.period.startDate), end = Date.parse(expected.period.endDate);
  const obsTs = Date.parse(expected.observationDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || !Number.isFinite(obsTs)) {
    issues.push({ field: 'plan', kind: 'invalid', message: '冻结计划期间或观察日期无效，无法核对可比性。' });
  }
  if (!expected.metric) {
    issues.push({ field: 'metric', kind: 'missing', message: '冻结计划缺少可核对的指标定义。' });
  }
  if (!basis) {
    issues.push({
      field: 'metric',
      kind: 'missing',
      message: `缺少实绩口径依据（计划要求指标「${expected.metric || '未定'}」、范围「${expected.scope}」、单位「${expected.unit}」、期间「${expected.period.periodId}」）。`,
      expected: expected.metric,
    });
  } else {
    if (!basis.metric) {
      issues.push({ field: 'metric', kind: 'missing', message: `指标未填写（计划要求「${expected.metric}」）。`, expected: expected.metric });
    } else if (expected.metric && basis.metric !== expected.metric) {
      issues.push({ field: 'metric', kind: 'mismatch', message: `指标不匹配：计划要求「${expected.metric}」，当前凭证为「${basis.metric}」。`, expected: expected.metric, observed: basis.metric });
    }
    if (!basis.scope) {
      issues.push({ field: 'scope', kind: 'missing', message: `业务范围未填写（计划要求「${expected.scope}」）。`, expected: expected.scope });
    } else if (basis.scope !== expected.scope) {
      issues.push({ field: 'scope', kind: 'mismatch', message: `业务范围不匹配：计划要求「${expected.scope}」，当前凭证为「${basis.scope}」。`, expected: expected.scope, observed: basis.scope });
    }
    if (!basis.unit) {
      issues.push({ field: 'unit', kind: 'missing', message: `单位未填写（计划要求「${expected.unit}」）。`, expected: expected.unit });
    } else if (basis.unit !== expected.unit) {
      issues.push({ field: 'unit', kind: 'mismatch', message: `单位不匹配：计划要求「${expected.unit}」，当前凭证为「${basis.unit}」。`, expected: expected.unit, observed: basis.unit });
    }
    if (!basis.periodId) {
      issues.push({ field: 'period', kind: 'missing', message: `归属期间未填写（计划要求「${expected.period.periodId}」）。`, expected: expected.period.periodId });
    } else if (basis.periodId !== expected.period.periodId) {
      issues.push({ field: 'period', kind: 'mismatch', message: `归属期间不匹配：计划要求「${expected.period.periodId}」，当前凭证为「${basis.periodId}」。`, expected: expected.period.periodId, observed: basis.periodId });
    }
    if (basis.coverage === 'partial') {
      issues.push({ field: 'coverage', kind: 'incomplete', message: '覆盖范围不完整（部分门店或范围未出数），不自动折算整体偏差。', expected: 'complete', observed: 'partial' });
    } else if (basis.coverage === 'unknown') {
      issues.push({ field: 'coverage', kind: 'missing', message: '覆盖范围尚未核实（unknown），请由原文或负责人补充确认。', expected: 'complete', observed: 'unknown' });
    }
    if (basis.maturity === 'open') {
      issues.push({ field: 'maturity', kind: 'observing', message: '观察窗尚未结账（open），当前保持待观察。', expected: 'closed', observed: 'open' });
    } else if (basis.maturity === 'unknown') {
      issues.push({ field: 'maturity', kind: 'missing', message: '观察窗结账状态尚未核实（unknown），请由原文或负责人补充确认。', expected: 'closed', observed: 'unknown' });
    }
  }
  if (actual === null) {
    issues.push({ field: 'actual', kind: 'missing', message: '缺少实绩数值，无法计算整体偏差。' });
  }
  if (!expected.planned) {
    issues.push({ field: 'plan', kind: 'observing', message: '本期冻结计划值为待定/观察状态，暂不计算确认偏离。' });
  }
  const cutoffTs = Date.parse(cutoff);
  if (!Number.isFinite(cutoffTs)) {
    issues.push({ field: 'cutoff', kind: 'missing', message: '缺少有效数据截至时间。', expected: expected.observationDate });
  } else if (Number.isFinite(obsTs) && cutoffTs < obsTs) {
    issues.push({ field: 'cutoff', kind: 'observing', message: `数据截至时间（${cutoff}）早于计划观察日（${expected.observationDate}），观察窗未满。`, expected: expected.observationDate, observed: cutoff });
  }

  let comparability: ProgressComparability;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || !Number.isFinite(obsTs) ||
      !basis || !expected.metric || basis.metric !== expected.metric || basis.scope !== expected.scope ||
      basis.unit !== expected.unit || basis.periodId !== expected.period.periodId || assessment === 'incomparable') {
    comparability = 'incomparable';
  } else if (basis.coverage !== 'complete' || actual === null || assessment === 'partial-missing') {
    comparability = 'partial-missing';
  } else if (basis.maturity !== 'closed' || !expected.planned || !Number.isFinite(cutoffTs) || cutoffTs < obsTs || assessment === 'observing') {
    comparability = 'observing';
  } else {
    comparability = 'comparable';
  }

  if (comparability !== 'comparable' && issues.length === 0) {
    issues.push({
      field: comparability === 'partial-missing' ? 'coverage' : comparability === 'observing' ? 'maturity' : 'metric',
      kind: comparability === 'partial-missing' ? 'incomplete' : comparability === 'observing' ? 'observing' : 'mismatch',
      message: `核对判定为「${comparabilityLabel(comparability)}」，整体暂不计算确认偏离。`,
    });
  }

  return { comparability, issues };
}

export function assessProgressEvidence(
  basis: ProgressEvidenceBasis | undefined,
  expected: { metric: string; unit: string; scope: string; period: DecompositionTimePeriod; observationDate: string; planned: boolean },
  cutoff: string,
  actual: number | null,
  assessment: ProgressComparability,
): ProgressComparability {
  return assessProgressEvidenceDetails(basis, expected, cutoff, actual, assessment).comparability;
}
