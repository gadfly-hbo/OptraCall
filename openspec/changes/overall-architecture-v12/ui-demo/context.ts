// Demo-only context projection. Defaults/scenario are deliberately not inputs to a Goal entrance.
import type { GoalRef, GoalVersion, StrategyGoalsIndex } from '../../../../src/host/strategy-goals-types.ts';
export type PurposeKind = '' | 'organization' | 'department' | 'personal';
export type DemoPurpose = { kind: PurposeKind; background: string };
export type GoalWorkContext = { goal: GoalRef; purpose: DemoPurpose; discussionId?: string; sourceGoal?: GoalRef };
const copy = <T,>(value: T): T => structuredClone(value);
const matches = (first: GoalRef, second: GoalRef) => first.goalId === second.goalId && first.version === second.version;
export function purposeForGoal(goal: Pick<GoalVersion, 'scope' | 'version'>): DemoPurpose {
  const kind = goal.scope.kind === 'enterprise' ? 'organization' : goal.scope.kind === 'department' ? 'department' : 'personal';
  return { kind, background: `${goal.scope.name}；沿目标 v${goal.version} 的准确范围。${goal.scope.kind === 'department' && !goal.scope.enterpriseId ? '上层组织与战略未知，不增加企业资料权限。' : ''}` };
}
export function contextForGoal(ref: GoalRef, index: StrategyGoalsIndex, adoptedContexts: ReadonlyMap<string, GoalWorkContext>): GoalWorkContext {
  const exact = index.goals.find(record => record.id === ref.goalId)?.versions.find(version => version.version === ref.version);
  if (!exact) throw new Error('Demo exact Goal version is unavailable; no fallback to another Goal/default/scenario.');
  const bound = adoptedContexts.get(`${ref.goalId}:${ref.version}`);
  if (bound) { if (!matches(bound.goal, ref)) throw new Error('Demo Goal context identity mismatch.'); return copy(bound); }
  return { goal: copy(ref), sourceGoal: copy(ref), purpose: purposeForGoal(exact) };
}
