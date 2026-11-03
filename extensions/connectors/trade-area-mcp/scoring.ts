/** 选址评分（四因子）。数学承接 trade-area 原仓 src/scoring/model.ts @2ba41d2：
 * 客流三档子权重 40/40/20 缺档按比例分摊；任一权重>0 的因子缺失 → score=null（严格模式，
 * 2026-09-25 用户决策，不做权重分摊）；权重归一加权，结果 1 位小数。
 * 输入为数据快照中的全体百分位分（逆向指标已翻转），不在此重算百分位。 */

import type { PercentileMap } from './types.ts';

export const SCORING_ENGINE_VERSION = 'optracall-tradearea-score-1';

export type FactorKey = 'traffic' | 'pop' | 'crowd' | 'parking';

export interface ScoreWeights {
  traffic: number;
  pop: number;
  crowd: number;
  parking: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = { traffic: 30, pop: 20, crowd: 15, parking: 10 };

export const FACTOR_LABELS: Record<FactorKey, string> = {
  traffic: '客流',
  pop: '3公里人口',
  crowd: '客群匹配',
  parking: '停车便利',
};

export interface ScoreFactor {
  key: FactorKey;
  label: string;
  value: number | null;
  weight: number;
}

export interface ScoreResult {
  score: number | null;
  factors: ScoreFactor[];
}

function trafficScore(p: PercentileMap): number | null {
  const parts: [number, number][] = [];
  if (p.trafficWeekday !== undefined) parts.push([p.trafficWeekday, 0.4]);
  if (p.trafficWeekend !== undefined) parts.push([p.trafficWeekend, 0.4]);
  if (p.trafficPeak !== undefined) parts.push([p.trafficPeak, 0.2]);
  if (!parts.length) return null;
  const totalWeight = parts.reduce((sum, [, weight]) => sum + weight, 0);
  return parts.reduce((sum, [value, weight]) => sum + (value * weight) / totalWeight, 0);
}

export function computeFactors(percentiles: PercentileMap): Record<FactorKey, number | null> {
  return {
    traffic: trafficScore(percentiles),
    pop: percentiles.pop3km ?? null,
    crowd: percentiles.crowdAB ?? null,
    parking: percentiles.parkingPer10k ?? null,
  };
}

export function computeScore(percentiles: PercentileMap, weights: ScoreWeights = DEFAULT_WEIGHTS): ScoreResult {
  const values = computeFactors(percentiles);
  const factors = (Object.keys(weights) as FactorKey[]).map(key => ({
    key,
    label: FACTOR_LABELS[key],
    value: values[key],
    weight: weights[key],
  })).filter(factor => factor.value !== null && factor.weight > 0);

  if (!factors.length) return { score: null, factors: [] };

  const enabled = (Object.keys(weights) as FactorKey[]).filter(key => weights[key] > 0);
  if (!enabled.every(key => values[key] !== null)) return { score: null, factors };

  // Normalize before any weight sums/products, preserving proportional semantics
  // at huge and subnormal scales. Keep original weights for completeness above
  // and for the returned receipt, even if a relative weight rounds down to zero.
  const maximum = Math.max(...factors.map(factor => factor.weight));
  const denominator = factors.reduce((sum, factor) => sum + factor.weight / maximum, 0);
  const numerator = factors.reduce((sum, factor) => sum + (factor.value as number) * (factor.weight / maximum), 0);
  return { score: Math.round((numerator / denominator) * 10) / 10, factors };
}
