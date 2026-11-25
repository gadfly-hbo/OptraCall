import type { GoalMeasurement } from './strategy-goals-types.ts';
import type {
  DecompositionFrozenCheckpoint, DecompositionPublicationSnapshot, DecompositionTimePeriod,
  ProgressComparability, ProgressEvidenceBasis,
} from './strategy-goal-decomposition-types.ts';

export function progressMetric(snapshot: DecompositionPublicationSnapshot | undefined, measurement: GoalMeasurement): string {
  const sap = snapshot?.estimate.sapMetric ?? (measurement.kind === 'quantitative' ? measurement.sapMetric : undefined);
  if (sap) return `${sap.id}@${sap.version}`;
  return measurement.kind === 'deliverable' ? measurement.criterion : '';
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

export function assessProgressEvidence(
  basis: ProgressEvidenceBasis | undefined,
  expected: { metric: string; unit: string; scope: string; period: DecompositionTimePeriod; observationDate: string; planned: boolean },
  cutoff: string,
  actual: number | null,
  assessment: ProgressComparability,
): ProgressComparability {
  const start = Date.parse(expected.period.startDate), end = Date.parse(expected.period.endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || !Number.isFinite(Date.parse(expected.observationDate))) return 'incomparable';
  if (!basis || !expected.metric || basis.metric !== expected.metric || basis.scope !== expected.scope ||
      basis.unit !== expected.unit || basis.periodId !== expected.period.periodId) return 'incomparable';
  if (assessment === 'incomparable') return assessment;
  if (basis.coverage !== 'complete' || actual === null || assessment === 'partial-missing') return 'partial-missing';
  if (basis.maturity !== 'closed' || !expected.planned ||
      Date.parse(cutoff) < Date.parse(expected.observationDate) || assessment === 'observing') return 'observing';
  return 'comparable';
}
