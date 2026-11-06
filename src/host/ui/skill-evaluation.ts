export type MetricComparison = { baseline: number | null; variant: number | null };
export type SkillEvaluation = {
  date: string;
  testedRevision: string;
  revisedSinceEvaluation: boolean;
  coversEngineeringRevisions?: boolean;
  provisional?: boolean;
  limitations?: string;
  outcome: 'effective' | 'ineffective' | 'inconclusive';
  sampleCount: number;
  assertions: MetricComparison & { basis: string };
  activation: { activated: number; total: number };
  judgments: { wins: number; ties: number; losses: number; undetermined: number };
  seconds: MetricComparison;
  tokens: MetricComparison;
};

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

export function formatRate(numerator: number, denominator: number): string {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator <= 0 || numerator > denominator) return '未提供';
  return `${(numerator / denominator * 100).toFixed(1)}%`;
}

export function formatAssertionGain({ baseline, variant }: MetricComparison): string {
  if (!finite(baseline) || !finite(variant) || baseline < 0 || baseline > 100 || variant < 0 || variant > 100) return '未提供';
  const delta = Math.round((variant - baseline) * 10) / 10;
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)} 个百分点`;
}

export function formatRelativeChange({ baseline, variant }: MetricComparison): string {
  if (!finite(baseline) || !finite(variant) || baseline <= 0 || variant < 0) return '未提供';
  const delta = Math.round((variant / baseline - 1) * 100);
  return `约 ${delta > 0 ? '+' : ''}${delta}%`;
}

export function formatMetricValue(value: number | null, unit: 'percent' | 'seconds' | 'tokens'): string {
  if (!finite(value) || value < 0 || (unit === 'percent' && value > 100)) return '未提供';
  if (unit === 'percent') return `${value.toFixed(1)}%`;
  if (unit === 'seconds') return `${value.toFixed(1)} 秒`;
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
