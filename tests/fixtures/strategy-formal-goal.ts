import type { StrategicFormalGoal } from '../../src/host/strategy-goal-decomposition-types.ts';

export function formalGoal(title: string, value = 1, unit = '项'): StrategicFormalGoal {
  return { id: title, title, outcome: title, metricKind: unit === '%' ? 'ratio' : 'amount',
    targetValue: value, unit, period: '2027', strategies: ['推进试点'] };
}
