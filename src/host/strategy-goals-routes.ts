import { normalizeGoalText, sameGoalRequirement } from './strategy-goals-types.ts';
import { StrategyGoalsStore, StrategyGoalsError } from './strategy-goals-store.ts';
import { GoalDecompositionError, parseScope } from './strategy-goal-decomposition-validation.ts';
import type { CaseGoalBindingInput } from './case-types.ts';
import type { GoalDraftInput, GoalRef, GoalRevisionInput, GoalAdoptionInput, GoalRelationInput, GoalFeedbackInput, GoalScope, GoalSourceRef, StrategyGoalRecord } from './strategy-goals-types.ts';

import type {
  DecompositionAlignmentInput,
  DecompositionCaseDraftIntentInput,
  DecompositionCycleReviewInput,
  DecompositionDraftInput,
  DecompositionProgressCheckInput,
  DecompositionProjectHandoffInput,
  DecompositionPublishInput,
  DecompositionThresholdConfig,
  GsaPlanConfirmInput,
  NextCycleDraftInput,
  StrategyReturnInput,
} from './strategy-goal-decomposition-types.ts';
import type { InitiativePublication } from './strategy-initiative-publications.ts';
import { initiativeScopeKey } from './strategy-initiative-types.ts';

export function createStrategyGoalRoutes(options: {
  store: StrategyGoalsStore;
  mutate: <T>(fn: () => T | Promise<T>) => Promise<T>;
  isClosing: () => boolean;
  validateGoal?: (input: GoalDraftInput, target?: GoalRef | 'create') => void | Promise<void>;
  validateScope?: (scope: GoalScope) => void | Promise<void>;
  listSources?: () => Promise<unknown>;
  validateFeedbackSource?: (input: GoalSourceRef) => void | Promise<void>;
  validateAdoption?: (ref: GoalRef, input: GoalAdoptionInput) => void | Promise<void>;
  listFormalStrategyPublications?: (scopeKey: string) => InitiativePublication[];
  assertGoalReadable?: (record: StrategyGoalRecord) => void | Promise<void>;
  preCommitPublishFault?: (goalId: string, operationId: string) => void;
}) {
  const { store } = options;
  const write = <T>(fn: () => T | Promise<T>) => options.mutate(() => { if (options.isClosing()) throw new StrategyGoalsError('host_closing', 409); return fn(); });
  async function checkRecord(record:StrategyGoalRecord){
    for(const goal of record.versions)if(goal.structured)await options.validateGoal?.(goal);
    await options.assertGoalReadable?.(record);
    return record;
  }
  async function checkGoalCurrentAccess(goalId: string): Promise<StrategyGoalRecord> {
    const record = store.get(goalId);
    await checkRecord(record);
    const currentVer = record.versions.find(v => v.version === (record.adoptedVersion ?? record.currentVersion));
    if (currentVer) await options.validateGoal?.(currentVer);
    return record;
  }
  function findApplicableFormalPublication(scope: GoalDraftInput['scope'], period?: string) {
    if (!options.listFormalStrategyPublications) return undefined;
    const key = initiativeScopeKey(scope);
    const activePubs = options.listFormalStrategyPublications(key).filter(p => p.state === 'active' && p.handoffEligible && p.formalGoals?.length);
    for (const pub of activePubs) {
      const match = period ? pub.formalGoals!.find(g => g.period === period) : pub.formalGoals![0];
      if (match) return { publication: pub, formalGoal: match };
    }
    return undefined;
  }

  return async (pathname: string, method: string, input: Record<string, unknown> = {}, searchParams?: URLSearchParams): Promise<{ status?: number; body: unknown } | null> => {
    if (pathname === '/api/strategy/sources' && method === 'GET' && options.listSources) return { body: await options.listSources() };

    // GM01: Query active formal strategy publications for a scope (separating handoffEligible vs record-only)
    if (pathname === '/api/strategy/goals/formal-sources' && method === 'GET') {
      const kind = searchParams?.get('scopeKind') as GoalDraftInput['scope']['kind'] | null;
      const scopeId = searchParams?.get('scopeId');
      const enterpriseId = searchParams?.get('enterpriseId') ?? undefined;
      if (!kind || !scopeId || !['enterprise', 'department', 'personal'].includes(kind)) {
        throw new StrategyGoalsError('invalid_goal_scope', 400);
      }
      const scopeObj: GoalScope = { kind, id: scopeId, name: scopeId, ...(enterpriseId ? { enterpriseId } : {}) };
      await options.validateScope?.(scopeObj);
      const key = initiativeScopeKey(scopeObj);
      const active = options.listFormalStrategyPublications?.(key) ?? [];
      return {
        body: {
          scopeKey: key,
          formalPublications: active.filter(p => p.handoffEligible && p.formalGoals?.length),
          recordOnlyPublications: active.filter(p => !p.handoffEligible || !p.formalGoals?.length),
        },
      };
    }

    // GM03 Pre-confirmation reachability estimate on goal-draft owner
    const draftEstimateMatch = /^\/api\/strategy\/goals\/draft-estimates\/([a-f0-9-]+)$/.exec(pathname);
    if (draftEstimateMatch) {
      const draftId = draftEstimateMatch[1]!;
      if (method === 'GET') {
        const record = store.getPreConfirmEstimate(draftId);
        if (record) await options.validateScope?.(record.scope);
        return { body: { estimateRecord: record, estimate: record?.estimate ?? null } };
      }
      if (method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            const parsedScope = parseScope(input.scope);
            await options.validateScope?.(parsedScope);
            const saved = store.savePreConfirmEstimate(
              draftId,
              parsedScope,
              input.estimate,
              'user',
            );
            return { estimateRecord: saved, estimate: saved.estimate };
          }),
        };
      }
    }

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
      if (method === 'POST') return { status: 201, body: await write(async () => {
        if (!store.getOperation(input.operationId as string)) {
          await options.validateGoal?.(input as unknown as GoalDraftInput, 'create');
          const draftInput = input as unknown as GoalDraftInput;
          if (draftInput.formalOrigin?.kind === 'manual-exception') {
            const applicable = findApplicableFormalPublication(draftInput.scope, draftInput.formalOrigin.period);
            if (applicable) {
              throw new GoalDecompositionError('formal_strategy_goal_exists', 409, {
                publicationId: applicable.publication.publicationId,
                formalGoalId: applicable.formalGoal.id,
              });
            }
          }
        }
        return { goal: store.create(input as unknown as GoalDraftInput & { operationId: string }) };
      }) };
    }

    const goalAction = /^\/api\/strategy\/goals\/([a-f0-9-]+)\/(workspace|reconcile-formal|gsa-plan\/confirm|gsa-plan\/draft|gsa-plans|decomposition\/draft|decomposition\/align|decomposition\/publish-preview|decomposition\/publish|decomposition\/publications|decomposition\/threshold|decomposition\/checks|decomposition\/handoffs\/preview|decomposition\/handoffs|case-draft-intents|cycle-reviews|next-cycle-draft|return-to-strategy)$/.exec(pathname);
    if (goalAction) {
      const goalId = goalAction[1]!;
      const sub = goalAction[2]!;

      if (sub === 'workspace' && method === 'GET') {
        const record = await checkGoalCurrentAccess(goalId);
        const ws = store.getGoalWorkspace(goalId);
        const currentVer = record.versions.find(v => v.version === (record.adoptedVersion ?? record.currentVersion));
        if (currentVer?.formalOrigin?.kind === 'manual-exception') {
          const applicable = findApplicableFormalPublication(currentVer.scope, currentVer.formalOrigin.period);
          ws.formalReconciliation = {
            hasApplicableFormalPublication: Boolean(applicable),
            manualTargetValue: currentVer.formalOrigin.targetValue,
            ...(applicable ? {
              formalPublication: {
                initiativeId: applicable.publication.initiativeId,
                publicationId: applicable.publication.publicationId,
                candidateId: applicable.publication.candidateId,
                candidateNo: applicable.publication.no,
                contentSha256: applicable.publication.contentSha256,
                formalGoal: applicable.formalGoal,
              },
            } : {}),
          };
        }
        return { body: ws };
      }

      if (sub === 'reconcile-formal' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            const record = await checkGoalCurrentAccess(goalId);
            const currentVer = record.versions.find(v => v.version === record.currentVersion)!;
            const applicable = findApplicableFormalPublication(currentVer.scope, currentVer.formalOrigin?.period);
            if (!applicable) throw new StrategyGoalsError('formal_strategy_goal_not_found', 404);
            const { publication, formalGoal } = applicable;
            const revised = store.revise(goalId, {
              ...currentVer,
              operationId: String(input.operationId),
              expectedVersion: Number(input.expectedVersion ?? record.currentVersion),
              title: formalGoal.title,
              outcome: formalGoal.outcome,
              measurement: formalGoal.sapMetric
                ? { kind: 'quantitative', sapMetric: formalGoal.sapMetric, target: `${formalGoal.targetValue} ${formalGoal.unit}` }
                : { kind: 'deliverable', criterion: formalGoal.outcome },
              strategies: formalGoal.strategies?.length ? formalGoal.strategies : currentVer.strategies,
              formalOrigin: {
                kind: 'strategy-publication',
                initiativeId: publication.initiativeId,
                publicationId: publication.publicationId,
                candidateId: publication.candidateId,
                candidateNo: publication.no,
                contentSha256: publication.contentSha256,
                formalGoalId: formalGoal.id,
                targetValue: formalGoal.targetValue,
                unit: formalGoal.unit,
                period: formalGoal.period,
                metricKind: formalGoal.metricKind,
              },
            });
            return {
              goal: revised,
              comparison: {
                manualValue: currentVer.formalOrigin?.targetValue ?? null,
                publishedValue: formalGoal.targetValue,
                unit: formalGoal.unit,
                publicationId: publication.publicationId,
              },
            };
          }),
        };
      }

      if (sub === 'gsa-plan/draft' && method === 'POST') {
        return {
          status: 200,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return { gsaDraft: store.saveGsaPlanDraft(goalId, input) };
          }),
        };
      }

      if (sub === 'gsa-plan/confirm' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            if (input.goalRevision) await options.validateGoal?.(input.goalRevision as GoalDraftInput, { goalId, version: Number(input.expectedGoalVersion) });
            const res = store.confirmGsaPlan(goalId, input as unknown as GsaPlanConfirmInput);
            return res;
          }),
        };
      }

      if (sub === 'gsa-plans' && method === 'GET') {
        await checkGoalCurrentAccess(goalId);
        return { body: { gsaPlans: store.listGsaPlans(goalId) } };
      }

      if (sub === 'decomposition/draft' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return store.saveDecompositionDraft(goalId, input as unknown as DecompositionDraftInput, { updatedBy: 'user' });
          }),
        };
      }

      if (sub === 'decomposition/align' && method === 'POST') {
        return {
          status: 200,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return store.alignDecompositionCrossConflict(goalId, input as unknown as DecompositionAlignmentInput);
          }),
        };
      }

      if (sub === 'decomposition/publish-preview' && method === 'POST') {
        await checkGoalCurrentAccess(goalId);
        const preview = store.previewDecompositionPublish(goalId, input as { gsaPlanId: string; gsaPlanVersion: number; gsaPlanSha256: string; draftRevision: number; draftSha256: string; expectedActiveVersion: number | null });
        for (const committed of preview.committedGoals) {
          await options.validateScope?.(committed.scope);
        }
        return {
          status: 200,
          body: preview,
        };
      }

      if (sub === 'decomposition/publish' && method === 'POST') {
        const res = await write(async () => {
          await checkGoalCurrentAccess(goalId);
          const pubInput = input as unknown as DecompositionPublishInput;
          const ws = store.getGoalWorkspace(goalId);
          for (const row of ws.draft?.rows ?? []) {
            if (row.commitAsGoal) await options.validateScope?.(row.scope);
          }
          return store.publishDecomposition(goalId, pubInput, {
            preCommitFault: options.preCommitPublishFault ? () => options.preCommitPublishFault!(goalId, pubInput.operationId) : undefined,
          });
        });
        return { status: res.replayed ? 200 : 201, body: res };
      }

      if (sub === 'decomposition/publications' && method === 'GET') {
        await checkGoalCurrentAccess(goalId);
        const offset = Number(searchParams?.get('offset') ?? '0');
        const limit = Number(searchParams?.get('limit') ?? '20');
        return { body: store.listDecompositionPublications(goalId, offset, limit) };
      }

      if (sub === 'decomposition/threshold' && method === 'POST') {
        return {
          status: 200,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return { threshold: store.setThreshold(goalId, input as Partial<DecompositionThresholdConfig>) };
          }),
        };
      }

      if (sub === 'decomposition/checks' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return store.recordProgressCheck(goalId, input as unknown as DecompositionProgressCheckInput);
          }),
        };
      }

      if (sub === 'decomposition/handoffs/preview' && method === 'POST') {
        await checkGoalCurrentAccess(goalId);
        return {
          status: 200,
          body: store.previewProjectHandoff(
            goalId,
            Number(input.publicationVersion),
            String(input.rowId ?? ''),
            input.checkpointId !== undefined ? String(input.checkpointId) : undefined,
          ),
        };
      }

      if (sub === 'decomposition/handoffs' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return store.confirmProjectHandoff(goalId, input as unknown as DecompositionProjectHandoffInput);
          }),
        };
      }

      if (sub === 'case-draft-intents' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return store.createCaseDraftIntent(goalId, input as unknown as DecompositionCaseDraftIntentInput);
          }),
        };
      }

      if (sub === 'cycle-reviews' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return store.recordCycleReview(goalId, input as unknown as DecompositionCycleReviewInput);
          }),
        };
      }

      if (sub === 'next-cycle-draft' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return store.createNextCycleDraft(goalId, input as unknown as NextCycleDraftInput);
          }),
        };
      }

      if (sub === 'return-to-strategy' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return store.recordStrategyReturn(goalId, input as unknown as StrategyReturnInput);
          }),
        };
      }
    }

    // Parameterized decomposition sub-routes: publications/:ver, operations/:opId, operations/:opId/abandon, checks/:checkId/case-choice
    const pubVerMatch = /^\/api\/strategy\/goals\/([a-f0-9-]+)\/decomposition\/publications\/(\d+)$/.exec(pathname);
    if (pubVerMatch && method === 'GET') {
      const goalId = pubVerMatch[1]!;
      const version = Number(pubVerMatch[2]);
      await checkGoalCurrentAccess(goalId);
      const pub = store.readDecompositionPublication(goalId, version);
      const boundGoal = store.read({ goalId, version: pub.snapshot.gsaPlan.goal.version });
      await options.validateGoal?.(boundGoal);
      return { body: { publication: pub } };
    }

    const opRecoveryMatch = /^\/api\/strategy\/goals\/([a-f0-9-]+)\/decomposition\/operations\/([a-f0-9-]+)(?:\/(abandon))?$/.exec(pathname);
    if (opRecoveryMatch) {
      const goalId = opRecoveryMatch[1]!;
      const opId = opRecoveryMatch[2]!;
      const subAction = opRecoveryMatch[3];
      if (!subAction && method === 'GET') {
        await checkGoalCurrentAccess(goalId);
        return { body: store.getDecompositionOperation(goalId, opId) };
      }
      if (subAction === 'abandon' && method === 'POST') {
        return {
          status: 200,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return { operation: store.abandonDecompositionOperation(goalId, opId, Number(input.expectedStateRevision)) };
          }),
        };
      }
    }

    const checkChoiceMatch = /^\/api\/strategy\/goals\/([a-f0-9-]+)\/decomposition\/checks\/([^/]+)\/case-choice$/.exec(pathname);
    if (checkChoiceMatch && method === 'POST') {
      const goalId = checkChoiceMatch[1]!;
      const checkId = decodeURIComponent(checkChoiceMatch[2]!);
      return {
        status: 200,
        body: await write(async () => {
          await checkGoalCurrentAccess(goalId);
          return store.setCheckCaseChoice(goalId, checkId, input as Parameters<StrategyGoalsStore['setCheckCaseChoice']>[2]);
        }),
      };
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
