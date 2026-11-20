import { normalizeGoalText, sameGoalRequirement } from './strategy-goals-types.ts';
import { StrategyGoalsStore, StrategyGoalsError } from './strategy-goals-store.ts';
import type { CaseGoalBindingInput } from './case-types.ts';
import type { GoalDraftInput, GoalRef, GoalRevisionInput, GoalAdoptionInput, GoalRelationInput, GoalFeedbackInput, GoalSourceRef, StrategyGoalRecord } from './strategy-goals-types.ts';

export function createStrategyGoalRoutes(options: { store: StrategyGoalsStore; mutate: <T>(fn: () => T | Promise<T>) => Promise<T>; isClosing: () => boolean; validateGoal?: (input: GoalDraftInput, target?: GoalRef | 'create') => void | Promise<void>; listSources?: () => Promise<unknown>; validateFeedbackSource?: (input: GoalSourceRef) => void | Promise<void>; validateAdoption?: (ref: GoalRef, input: GoalAdoptionInput) => void | Promise<void> }) {
  const { store } = options;
  const write = <T>(fn: () => T | Promise<T>) => options.mutate(() => { if (options.isClosing()) throw new StrategyGoalsError('host_closing', 409); return fn(); });
  async function checkRecord(record:StrategyGoalRecord){
    for(const goal of record.versions)if(goal.structured)await options.validateGoal?.(goal);
    return record;
  }
  return async (pathname: string, method: string, input: Record<string, unknown> = {}): Promise<{ status?: number; body: unknown } | null> => {
    if (pathname === '/api/strategy/sources' && method === 'GET' && options.listSources) return { body: await options.listSources() };
    if (pathname === '/api/strategy/goals') {
      if (method === 'GET') {
        const index=store.list(), hidden=new Set<string>(), reasons:string[]=[];
        for(const record of index.goals)try{await checkRecord(record);}catch(error){
          hidden.add(record.id);reasons.push(error instanceof Error?error.message:'strategy_goal_source_unavailable');
        }
        if(!hidden.size)return {body:index};
        return {body:{...index,goals:index.goals.filter(g=>!hidden.has(g.id)),relations:index.relations.filter(r=>![r,...r.history].some(v=>hidden.has(v.from.goalId)||hidden.has(v.to.goalId))),
          feedback:index.feedback.filter(f=>!hidden.has(f.goal.goalId)),arrangements:index.arrangements?.filter(a=>!hidden.has(a.goal.goalId)),unavailableGoalSources:[...new Set(reasons)]}};
      }
      if (method === 'POST') return { status: 201, body: await write(async () => { if (!store.getOperation(input.operationId as string)) await options.validateGoal?.(input as unknown as GoalDraftInput,'create'); return { goal: store.create(input as unknown as GoalDraftInput & { operationId: string }) }; }) };
    }
    const match = /^\/api\/strategy\/goals\/([a-f0-9-]+)(?:\/(adopt|revisions))?$/.exec(pathname);
    if (match) {
      const id = match[1]!;
      if (!match[2] && method === 'GET') return { body: { goal: await checkRecord(store.get(id)) } };
      if (match[2] === 'adopt' && method === 'POST') return { body: await write(async () => {
        const ref = { goalId: id, version: input.version as number };
        if (!store.getOperation(input.operationId as string)) {
          if (input.provenance !== undefined && !options.validateAdoption) throw new StrategyGoalsError('strategy_goal_adoption_provenance_unavailable', 409);
          await options.validateGoal?.(store.read(ref));
          await options.validateAdoption?.(ref, input as unknown as GoalAdoptionInput);
        }
        return { goal: store.adopt(ref, input as unknown as GoalAdoptionInput) };
      }) };
      if (match[2] === 'revisions' && method === 'POST') return { status: 201, body: await write(async () => { if (!store.getOperation(input.operationId as string)) await options.validateGoal?.(input as unknown as GoalDraftInput,{goalId:id,version:Number(input.expectedVersion)}); return { goal: store.revise(id, input as unknown as GoalRevisionInput) }; }) };
    }
    if (pathname === '/api/strategy/relations' && method === 'POST') return { status: 201, body: await write(() => ({ relation: store.relate(input as unknown as GoalRelationInput & { operationId: string }) })) };
    const relation = /^\/api\/strategy\/relations\/([a-f0-9-]+)\/revisions$/.exec(pathname);
    if (relation && method === 'POST') return { status: 201, body: await write(() => ({ relation: store.reviseRelation(relation[1]!, input as unknown as GoalRelationInput & { operationId: string; expectedRevision: number }) })) };
    if (pathname === '/api/strategy/feedback' && method === 'POST') return { status: 201, body: await write(async () => {
      if (!store.getOperation(input.operationId as string)) await options.validateFeedbackSource?.(input.source as GoalSourceRef);
      return { feedback: store.recordFeedback(input as unknown as GoalFeedbackInput & { operationId: string }) };
    }) };
    const operation = /^\/api\/strategy\/operations\/([a-f0-9-]+)$/.exec(pathname);
    if (operation && method === 'GET') {
      const receipt=store.getOperation(operation[1]!);
      if(receipt)for(const context of store.operationContext(receipt))for(const goal of context.goals)if(goal.structured)await options.validateGoal?.(goal);
      return {body:{operation:receipt}};
    }
    return null;
  };
}

export function assertAdoptedGoalRefs(store: StrategyGoalsStore, value: unknown, purpose: 'new-case' | 'binding' = 'binding'): CaseGoalBindingInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StrategyGoalsError('case_primary_goal_required', 400);
  const input = value as { primary?: GoalRef; related?: GoalRef[] };
  if (!input.primary || !Array.isArray(input.related) || input.related.length > 20) throw new StrategyGoalsError('invalid_case_goal_binding');
  for (const ref of [input.primary, ...input.related]) {
    if (!ref || store.read(ref).status !== 'adopted') throw new StrategyGoalsError('goal_not_adopted', 409);
  }
  const raw = value as CaseGoalBindingInput;
  const record = store.get(input.primary.goalId), adopted = store.read(input.primary);
  if (purpose === 'new-case' || raw.strategy !== undefined || raw.effectiveFrom !== undefined) {
    if (typeof raw.strategy !== 'string' || !raw.strategy.trim()) throw new StrategyGoalsError('case_strategy_required');
    if (!adopted.strategies?.includes(raw.strategy)) throw new StrategyGoalsError('case_strategy_not_found', 409);
    if (purpose === 'new-case') {
      if (raw.effectiveFrom !== undefined) throw new StrategyGoalsError('invalid_case_effective_date');
      const previous = record.versions.filter(v => v.status === 'adopted' && v.version < adopted.version).at(-1);
      if (previous && sameGoalRequirement(adopted, previous) && previous.strategies?.some(s => normalizeGoalText(s) === normalizeGoalText(raw.strategy!))) {
        throw new StrategyGoalsError('case_goal_strategy_unchanged', 409);
      }
    }
  }
  return { primary: input.primary, related: input.related, ...(raw.strategy !== undefined ? { strategy: raw.strategy } : {}), ...(raw.effectiveFrom !== undefined ? { effectiveFrom: raw.effectiveFrom } : {}) };
}
