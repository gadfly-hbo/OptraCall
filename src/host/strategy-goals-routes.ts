import { StrategyGoalsStore, StrategyGoalsError } from './strategy-goals-store.ts';
import type { GoalDraftInput, GoalRef, GoalRevisionInput, GoalAdoptionInput, GoalRelationInput, GoalFeedbackInput, GoalSourceRef } from './strategy-goals-types.ts';

export function createStrategyGoalRoutes(options: { store: StrategyGoalsStore; mutate: <T>(fn: () => T | Promise<T>) => Promise<T>; isClosing: () => boolean; validateGoal?: (input: GoalDraftInput) => void | Promise<void>; listSources?: () => Promise<unknown>; validateFeedbackSource?: (input: GoalSourceRef) => void | Promise<void> }) {
  const { store } = options;
  const write = <T>(fn: () => T | Promise<T>) => options.mutate(() => { if (options.isClosing()) throw new StrategyGoalsError('host_closing', 409); return fn(); });
  return async (pathname: string, method: string, input: Record<string, unknown> = {}): Promise<{ status?: number; body: unknown } | null> => {
    if (pathname === '/api/strategy/sources' && method === 'GET' && options.listSources) return { body: await options.listSources() };
    if (pathname === '/api/strategy/goals') {
      if (method === 'GET') return { body: store.list() };
      if (method === 'POST') return { status: 201, body: await write(async () => { if (!store.getOperation(input.operationId as string)) await options.validateGoal?.(input as unknown as GoalDraftInput); return { goal: store.create(input as unknown as GoalDraftInput & { operationId: string }) }; }) };
    }
    const match = /^\/api\/strategy\/goals\/([a-f0-9-]+)(?:\/(adopt|revisions))?$/.exec(pathname);
    if (match) {
      const id = match[1]!;
      if (!match[2] && method === 'GET') return { body: { goal: store.get(id) } };
      if (match[2] === 'adopt' && method === 'POST') return { body: await write(async () => { if (!store.getOperation(input.operationId as string)) await options.validateGoal?.(store.read({ goalId: id, version: input.version as number })); return { goal: store.adopt({ goalId: id, version: input.version as number }, input as unknown as GoalAdoptionInput) }; }) };
      if (match[2] === 'revisions' && method === 'POST') return { status: 201, body: await write(async () => { if (!store.getOperation(input.operationId as string)) await options.validateGoal?.(input as unknown as GoalDraftInput); return { goal: store.revise(id, input as unknown as GoalRevisionInput) }; }) };
    }
    if (pathname === '/api/strategy/relations' && method === 'POST') return { status: 201, body: await write(() => ({ relation: store.relate(input as unknown as GoalRelationInput & { operationId: string }) })) };
    const relation = /^\/api\/strategy\/relations\/([a-f0-9-]+)\/revisions$/.exec(pathname);
    if (relation && method === 'POST') return { status: 201, body: await write(() => ({ relation: store.reviseRelation(relation[1]!, input as unknown as GoalRelationInput & { operationId: string; expectedRevision: number }) })) };
    if (pathname === '/api/strategy/feedback' && method === 'POST') return { status: 201, body: await write(async () => {
      if (!store.getOperation(input.operationId as string)) await options.validateFeedbackSource?.(input.source as GoalSourceRef);
      return { feedback: store.recordFeedback(input as unknown as GoalFeedbackInput & { operationId: string }) };
    }) };
    const operation = /^\/api\/strategy\/operations\/([a-f0-9-]+)$/.exec(pathname);
    if (operation && method === 'GET') return { body: { operation: store.getOperation(operation[1]!) } };
    return null;
  };
}

export function assertAdoptedGoalRefs(store: StrategyGoalsStore, value: unknown): { primary: GoalRef; related: GoalRef[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StrategyGoalsError('case_primary_goal_required', 400);
  const input = value as { primary?: GoalRef; related?: GoalRef[] };
  if (!input.primary || !Array.isArray(input.related) || input.related.length > 20) throw new StrategyGoalsError('invalid_case_goal_binding');
  for (const ref of [input.primary, ...input.related]) {
    if (!ref || store.read(ref).status !== 'adopted') throw new StrategyGoalsError('goal_not_adopted', 409);
  }
  return { primary: input.primary, related: input.related };
}
