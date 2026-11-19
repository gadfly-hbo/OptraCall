import { goalContentSha256, parseGoalDraft } from './strategy-goals-store.ts';
import type { GoalOperationReceipt, GoalVersion } from './strategy-goals-types.ts';
import { StrategyDiscussionFault } from './strategy-discussion-store.ts';

export const goalToolPayloadLimit = 32768;

export function goalReceipt(goal: GoalVersion) {
  return { goalId: goal.goalId, version: goal.version, status: goal.status, goalContentSha256: goalContentSha256(goal) };
}

export function goalWriteResult(goal: GoalVersion, operationId: string, claim: string) {
  const { goalContentSha256, ...identity } = goalReceipt(goal);
  const full = { goal, goalContentSha256, operationId, claim };
  return JSON.stringify(full).length <= goalToolPayloadLimit ? full : { ...full, goal: identity, bodyIncluded: false };
}

/** Retain the original mutation identity and hash even when its Goal body needs several tool responses. */
export function goalOperationResult(receipt: GoalOperationReceipt) {
  const result = receipt.result;
  if ((receipt.kind === 'create' || receipt.kind === 'revise' || receipt.kind === 'adopt') && 'perspective' in result &&
      JSON.stringify({ operation: receipt }).length > goalToolPayloadLimit) {
    const { goalContentSha256, ...identity } = goalReceipt(result);
    return { ...receipt, result: identity, goalContentSha256, bodyIncluded: false };
  }
  return receipt;
}

export function goalBodyPage(goal: GoalVersion, offset: unknown, limit: unknown) {
  const body = JSON.stringify({ goalId: goal.goalId, version: goal.version, ...parseGoalDraft(goal) });
  const start = offset ?? 0, size = limit ?? 4096;
  if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0 || start >= body.length ||
      typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1 || size > 8192) throw new StrategyDiscussionFault('strategy_source_page_invalid', 400);
  // JSON can escape each character; 4096 keeps even control-heavy slices inside the native transport limit.
  const end = Math.min(start + Math.min(size, 4096), body.length);
  return { ...goalReceipt(goal), text: body.slice(start, end), range: { start, end, total: body.length }, complete: end === body.length,
    ...(end < body.length ? { nextOffset: end } : {}) };
}
