import type { DecompositionRow, GoalMetricKind, GsaPlanVersion } from './strategy-goal-decomposition-types.ts';
import type { GoalDraftInput, GoalVersion } from './strategy-goals-types.ts';

export function allocatedTarget(rows: readonly DecompositionRow[], kind: GoalMetricKind, unit: string): number | null {
  const allocation = rows.filter(row => row.contributionNature === 'allocation');
  if (kind === 'milestone' || allocation.some(row => row.metricKind !== kind || row.unit !== unit || row.targetValue === null)) return null;
  if (kind === 'amount') return Number(allocation.reduce((sum, row) => sum + row.targetValue!, 0).toFixed(6));
  if (!allocation.length) return null;
  let numerator = 0;
  let denominator = 0;
  for (const row of allocation) {
    if (!row.ratio || row.ratio.denominator <= 0 || row.ratio.definition !== allocation[0]!.ratio?.definition) return null;
    numerator += row.ratio.numerator;
    denominator += row.ratio.denominator;
  }
  return Number((numerator / denominator * (/%|％|百分/.test(unit) ? 100 : 1)).toFixed(6));
}

export function decompositionChildGoal(parent: GoalVersion, plan: GsaPlanVersion, row: DecompositionRow, publicationVersion: number): GoalDraftInput {
  const source = `总目标 ${parent.goalId} 拆解表 v${publicationVersion} · 行 ${row.rowId}`;
  const inheritsMetric = row.contributionNature === 'allocation' && parent.measurement.kind === 'quantitative' &&
    plan.formalTarget.metricKind === row.metricKind && plan.formalTarget.unit === row.unit;
  const measurement = inheritsMetric && parent.measurement.kind === 'quantitative'
    ? { ...parent.measurement, target: `${row.targetValue} ${row.unit}` }
    : { kind: 'deliverable' as const, criterion: row.milestoneCriterion || `${row.scopeLabel}：${row.outcome}` };
  return {
    title: row.title, outcome: row.outcome, perspective: parent.perspective, scope: row.scope, measurement,
    baseline: { state: 'pending', description: row.basis || '由上层目标拆解发布承接' }, responsible: row.responsible,
    ...(parent.dueAt ? { dueAt: parent.dueAt } : {}), strategies: [row.strategy],
    strategyContext: { summary: `来自${source}` },
    ...(row.targetValue !== null ? { formalOrigin: {
      kind: 'manual-exception' as const, reason: `由${source}承接`, period: plan.formalTarget.period,
      targetValue: row.targetValue, unit: row.unit, metricKind: row.metricKind,
    } } : {}),
  };
}
