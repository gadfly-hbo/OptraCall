import { groupScopeKey } from './structured-goal.ts';
import { createGoalDecompositionAccess } from './goal-decomposition-access.ts';
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
  DecompositionThresholdInput,
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
  validateEstimateGoal?: (ref: GoalRef) => Promise<unknown>;
  validateGoal?: (input: GoalDraftInput, target?: GoalRef | 'create') => void | Promise<void>;
  validateScope?: (scope: GoalScope) => void | Promise<void>;
  listSources?: () => Promise<unknown>;
  validateFeedbackSource?: (input: GoalSourceRef) => void | Promise<void>;
  validateAdoption?: (ref: GoalRef, input: GoalAdoptionInput) => void | Promise<void>;
  readFormalStrategyPublication?: (initiativeId: string, publicationId: string) => InitiativePublication;
  listFormalStrategyPublications?: (scopeKey: string) => InitiativePublication[];
  assertGoalReadable?: (record: StrategyGoalRecord) => void | Promise<void>;
  preCommitPublishFault?: (goalId: string, operationId: string) => void;
  findMatchingCase?: (goal: GoalRef, strategy: string) => {caseId: string; title: string} | undefined;
  validateContinueExistingCase?: (input: { goalId: string; goalVersion: number; strategy: string; scope: GoalScope; caseId: string }) => void | Promise<void>;
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
  const { validateDraftRows, validateFrozenPublicationAccess, validateReviewEvidence, authorizeWorkspace } = createGoalDecompositionAccess(options);

  function applicableFormalGoals(scope: GoalScope, period: string) {
    const scopeKey = initiativeScopeKey(scope);
    return (options.listFormalStrategyPublications?.(scopeKey) ?? [])
      .filter(publication => publication.scopeKey === scopeKey && publication.state === 'active' && publication.handoffEligible)
      .flatMap(publication => (publication.formalGoals ?? [])
        .filter(goal => goal.period === period)
        .map(formalGoal => ({
          initiativeId: publication.initiativeId,
          publicationId: publication.publicationId,
          candidateId: publication.candidateId,
          candidateNo: publication.no,
          contentSha256: publication.contentSha256,
          formalGoal,
        })));
  }
  function verifyFormalOrigin(draftInput: GoalDraftInput, receivingGoalId?: string) {
    const origin = draftInput.formalOrigin;
    if (!origin) return;
    if (origin.kind === 'manual-exception') {
      const applicable = applicableFormalGoals(draftInput.scope, origin.period)[0];
      if (applicable) {
        throw new GoalDecompositionError('formal_strategy_goal_exists', 409, {
          publicationId: applicable.publicationId,
          formalGoalId: applicable.formalGoal.id,
        });
      }
      return;
    }
    if (origin.kind === 'strategy-publication') {
      if (!options.listFormalStrategyPublications) {
        throw new GoalDecompositionError('formal_strategy_origin_mismatch', 409);
      }
      const matchesPublication = (publication: { initiativeId: string; publicationId: string; candidateId: string; candidateNo: number; contentSha256: string }) =>
        publication.initiativeId === origin.initiativeId && publication.publicationId === origin.publicationId &&
        publication.candidateId === origin.candidateId && publication.candidateNo === origin.candidateNo && publication.contentSha256 === origin.contentSha256;
      let goal = applicableFormalGoals(draftInput.scope, origin.period)
        .find(item => matchesPublication(item) && item.formalGoal.id === origin.formalGoalId)?.formalGoal;
      // An explicit handoff can authorize a different destination. Bind it to its actual receiving goal.
      if (!goal && receivingGoalId && options.readFormalStrategyPublication) {
        const imported = store.get(receivingGoalId).versions.find(version => version.formalOrigin?.kind === 'strategy-publication' &&
          matchesPublication(version.formalOrigin) && version.formalOrigin.formalGoalId === origin.formalGoalId &&
          initiativeScopeKey(version.scope) === initiativeScopeKey(draftInput.scope));
        if (imported) {
          const publication = options.readFormalStrategyPublication(origin.initiativeId, origin.publicationId);
          const received = publication.handoffs.some(receipt => initiativeScopeKey(receipt.scope) === initiativeScopeKey(draftInput.scope) &&
            receipt.goals.some(ref => ref.goalId === receivingGoalId && ref.version === imported.version));
          if (received && publication.state === 'active' && publication.handoffEligible && matchesPublication({...publication, candidateNo: publication.no})) {
            goal = publication.formalGoals?.find(row => row.id === origin.formalGoalId && row.period === origin.period);
          }
        }
      }
      const metric = draftInput.measurement?.kind === 'quantitative' ? draftInput.measurement.sapMetric : undefined;
      const definitionMatches = goal?.sapMetric
        ? draftInput.measurement?.kind === 'quantitative' && typeof draftInput.measurement.target === 'string' &&
          draftInput.measurement.target.trim().replace(/\s+/g, '') === `${goal.targetValue}${goal.unit}`.replace(/\s+/g, '')
        : draftInput.measurement?.kind === 'deliverable' && draftInput.measurement.criterion === goal?.outcome;
      if (!goal || !definitionMatches || draftInput.outcome !== goal.outcome || goal.targetValue !== origin.targetValue || goal.unit !== origin.unit ||
        goal.metricKind !== origin.metricKind || goal.sapMetric?.id !== metric?.id || goal.sapMetric?.version !== metric?.version || goal.sapMetric?.metricName !== metric?.metricName) {
        throw new GoalDecompositionError('formal_strategy_origin_mismatch', 409, {
          publicationId: origin.publicationId,
          formalGoalId: origin.formalGoalId,
        });
      }
    }
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

    // GM12: Query authorized returned goal review evidences for Strategy selection
    if (pathname === '/api/strategy/goals/strategy-returns' && method === 'GET') {
      const kind = searchParams?.get('scopeKind') as GoalDraftInput['scope']['kind'] | null;
      const scopeId = searchParams?.get('scopeId');
      const enterpriseId = searchParams?.get('enterpriseId') ?? undefined;
      let filterScopeKey: string | undefined;
      if (kind || scopeId) {
        if (!kind || !scopeId || !['enterprise', 'department', 'personal'].includes(kind)) {
          throw new StrategyGoalsError('invalid_goal_scope', 400);
        }
        const scopeObj: GoalScope = { kind, id: scopeId, name: scopeId, ...(enterpriseId ? { enterpriseId } : {}) };
        await options.validateScope?.(scopeObj);
        filterScopeKey = initiativeScopeKey(scopeObj);
      }
      const all = store.listStrategyReturns();
      const visible: typeof all = [];
      for (const item of all) {
        if (filterScopeKey && initiativeScopeKey(item.goal.scope) !== filterScopeKey) continue;
        try {
          await options.validateGoal?.(item.goal);
          if (item.review) await validateReviewEvidence(item.goal.goalId, item.review.preservedCheckIds);
          visible.push(item);
        } catch {
          // Omit unauthorized goal returns fail-closed
        }
      }
      return { body: { strategyReturns: visible } };
    }

    // GM03 Pre-confirmation reachability estimate on goal-draft owner
    const draftEstimateMatch = /^\/api\/strategy\/goals\/draft-estimates\/([a-f0-9-]+)$/.exec(pathname);
    if (draftEstimateMatch) {
      const draftId = draftEstimateMatch[1]!;
      if (method === 'GET') {
        const ref = searchParams?.has('goalVersion') ? {goalId:draftId, version:Number(searchParams.get('goalVersion'))} : undefined;
        if (ref) {
          const bound = store.read(ref);
          await options.validateScope?.(bound.scope);
          await options.validateGoal?.(bound);
          await options.validateEstimateGoal?.(ref);
        }
        const record = store.getPreConfirmEstimate(draftId, ref);
        if (record) await options.validateScope?.(record.scope);
        return { body: { estimateRecord: record, estimate: record?.estimate ?? null } };
      }
      if (method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            const parsedScope = parseScope(input.scope);
            await options.validateScope?.(parsedScope);
            const ref = input.goalRef as GoalRef | undefined;
            if (ref !== undefined) {
              const {goal} = store.estimateOwnerContext(draftId, parsedScope, ref, true);
              if (!goal) throw new StrategyGoalsError('estimate_goal_unavailable', 409);
              await options.validateGoal?.(goal);
              await options.validateEstimateGoal?.(ref);
            }
            const saved = store.savePreConfirmEstimate(draftId, parsedScope, input.estimate, 'user', undefined, ref);
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
          verifyFormalOrigin(input as unknown as GoalDraftInput);
        }
        return { goal: store.create(input as unknown as GoalDraftInput & { operationId: string }) };
      }) };
    }

    const goalAction = /^\/api\/strategy\/goals\/([a-f0-9-]+)\/(workspace|reconcile-formal|gsa-plan\/confirm|gsa-plan\/draft|gsa-plans|decomposition\/draft|decomposition\/align|decomposition\/publish-preview|decomposition\/publish|decomposition\/publications|decomposition\/threshold|decomposition\/actuals|decomposition\/checks|decomposition\/handoffs\/preview|decomposition\/handoffs|case-draft-intents|cycle-reviews|review-draft|next-cycle-draft|return-to-strategy)$/.exec(pathname);
    if (goalAction) {
      const goalId = goalAction[1]!;
      const sub = goalAction[2]!;

      if (sub === 'workspace' && method === 'GET') {
        const record = await checkGoalCurrentAccess(goalId);
        const goalVerParam = searchParams?.get('goalVersion');
        const requestedVer = goalVerParam != null && goalVerParam !== '' ? Number(goalVerParam) : undefined;
        if (requestedVer !== undefined) {
          if (!Number.isSafeInteger(requestedVer) || requestedVer < 1) throw new StrategyGoalsError('invalid_goal_version', 400);
          const bound = store.read({ goalId, version: requestedVer });
          await options.validateGoal?.(bound);
        }
        const ws = store.getGoalWorkspace(goalId, requestedVer);
        await authorizeWorkspace(goalId, ws);
        const targetVerNum = requestedVer ?? (record.adoptedVersion ?? record.currentVersion);
        const currentVer = record.versions.find(v => v.version === targetVerNum);
        if (currentVer?.formalOrigin?.kind === 'manual-exception') {
          const choices = applicableFormalGoals(currentVer.scope, currentVer.formalOrigin.period);
          ws.formalReconciliation = {
            hasApplicableFormalPublication: choices.length > 0,
            manualTargetValue: currentVer.formalOrigin.targetValue,
            formalPublications: choices,
            ...(choices.length === 1 ? { formalPublication: choices[0] } : {}),
          };
        }
        if (options.findMatchingCase) {
          for (const check of ws.checks) {
            if (check.caseChoice) continue;
            const { goal, goalRef, scope, strategies } = store.checkCaseBasis(goalId, check.checkId);
            check.caseStrategies = strategies;
            if (groupScopeKey(goal.scope) !== groupScopeKey(scope)) continue;
            try {
              check.caseCandidates = strategies.flatMap(strategy => {
                const match = options.findMatchingCase!(goalRef, strategy);
                return match ? [{ ...match, strategy }] : [];
              });
            } catch { check.caseCandidatesUnavailable = true; }
          }
        }
        return { body: ws };
      }

      if (sub === 'reconcile-formal' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            store.assertDecompositionWritable();
            const record = await checkGoalCurrentAccess(goalId);
            const currentVer = record.versions.find(v => v.version === Number(input.expectedVersion));
            if (!currentVer || currentVer.formalOrigin?.kind !== 'manual-exception') {
              throw new StrategyGoalsError('strategy_goal_conflict', 409);
            }
            const choices = applicableFormalGoals(currentVer.scope, currentVer.formalOrigin.period);
            if (!choices.length) throw new StrategyGoalsError('formal_strategy_goal_not_found', 404);
            const selected = choices.find(source =>
              source.publicationId === input.publicationId && source.contentSha256 === input.contentSha256 &&
              source.formalGoal.id === input.formalGoalId);
            if (!selected) throw new GoalDecompositionError('formal_strategy_selection_required', 409);
            const { formalGoal } = selected;
            const revision = {
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
                initiativeId: selected.initiativeId,
                publicationId: selected.publicationId,
                candidateId: selected.candidateId,
                candidateNo: selected.candidateNo,
                contentSha256: selected.contentSha256,
                formalGoalId: formalGoal.id,
                targetValue: formalGoal.targetValue,
                unit: formalGoal.unit,
                period: formalGoal.period,
                metricKind: formalGoal.metricKind,
              },
            } satisfies Parameters<typeof store.revise>[1];
            await options.validateGoal?.(revision, { goalId, version: currentVer.version });
            const revised = store.revise(goalId, revision);
            return {
              goal: revised,
              comparison: {
                manualValue: currentVer.formalOrigin?.targetValue ?? null,
                publishedValue: formalGoal.targetValue,
                unit: formalGoal.unit,
                publicationId: selected.publicationId,
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
            if (input.goalRevision) {
              await options.validateGoal?.(input.goalRevision as GoalDraftInput, { goalId, version: Number(input.expectedGoalVersion) });
              verifyFormalOrigin(input.goalRevision as GoalDraftInput, goalId);
            }
            const res = store.confirmGsaPlan(goalId, input as unknown as GsaPlanConfirmInput, goal => verifyFormalOrigin(goal, goalId));
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
        const draft = store.getGoalWorkspace(goalId).draft;
        if (draft) await validateDraftRows(draft);
        return {
          status: 200,
          body: preview,
        };
      }

      if (sub === 'decomposition/publish' && method === 'POST') {
        const res = await write(async () => {
          const pubInput = input as unknown as DecompositionPublishInput;
          // Check prior operation replay first so revoked historical publication scope fails closed even if current draft changed!
          const priorCheck = typeof pubInput.operationId === 'string' && /^[0-9a-f-]{36}$/i.test(pubInput.operationId)
            ? store.getDecompositionOperation(goalId, pubInput.operationId)
            : null;
          if (priorCheck?.status === 'committed' && priorCheck.publication) {
            await validateFrozenPublicationAccess(goalId, priorCheck.publication);
          } else {
            await checkGoalCurrentAccess(goalId);
            const ws = store.getGoalWorkspace(goalId);
            if (ws.draft) await validateDraftRows(ws.draft);
          }
          const published = store.publishDecomposition(goalId, pubInput, {
            preCommitFault: options.preCommitPublishFault ? () => options.preCommitPublishFault!(goalId, pubInput.operationId) : undefined,
          });
          if (published.replayed) await validateFrozenPublicationAccess(goalId, published.publication);
          return published;
        });
        return { status: res.replayed ? 200 : 201, body: res };
      }

      if (sub === 'decomposition/publications' && method === 'GET') {
        await checkGoalCurrentAccess(goalId);
        const offset = Number(searchParams?.get('offset') ?? '0');
        const limit = Number(searchParams?.get('limit') ?? '20');
        const page = store.listDecompositionPublications(goalId, offset, limit);
        const unavailableVersions: number[] = [];
        for (const item of page.items) {
          try { await validateFrozenPublicationAccess(goalId, store.readDecompositionPublication(goalId, item.version)); }
          catch { unavailableVersions.push(item.version); }
        }
        return { body: { ...page, items: page.items.filter(p => !unavailableVersions.includes(p.version)), unavailableVersions } };
      }

      if (sub === 'decomposition/threshold' && method === 'POST') {
        return {
          status: 200,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            return { threshold: store.setThreshold(goalId, input as DecompositionThresholdInput) };
          }),
        };
      }

      if (sub === 'decomposition/actuals' && method === 'POST') {
        return {status: 201, body: await write(async () => {
          await checkGoalCurrentAccess(goalId);
          await validateFrozenPublicationAccess(goalId, store.readDecompositionPublication(goalId, Number(input.publicationVersion)));
          return store.submitActual(goalId, input as unknown as import('./strategy-goal-decomposition-types.ts').GoalActualInput);
        })};
      }

      if (sub === 'decomposition/checks' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            const pubVer = Number(input.publicationVersion);
            if (Number.isSafeInteger(pubVer) && pubVer >= 1) {
              const pub = store.readDecompositionPublication(goalId, pubVer);
              await validateFrozenPublicationAccess(goalId, pub);
            }
            return store.recordProgressCheck(goalId, input as unknown as DecompositionProgressCheckInput);
          }),
        };
      }

      if (sub === 'decomposition/handoffs/preview' && method === 'POST') {
        await checkGoalCurrentAccess(goalId);
        const pubVer = Number(input.publicationVersion);
        if (Number.isSafeInteger(pubVer) && pubVer >= 1) {
          const pub = store.readDecompositionPublication(goalId, pubVer);
          await validateFrozenPublicationAccess(goalId, pub);
        }
        return {
          status: 200,
          body: store.previewProjectHandoff(
            goalId,
            pubVer,
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
            const pubVer = Number(input.publicationVersion);
            if (Number.isSafeInteger(pubVer) && pubVer >= 1) {
              const pub = store.readDecompositionPublication(goalId, pubVer);
              await validateFrozenPublicationAccess(goalId, pub);
            }
            return store.confirmProjectHandoff(goalId, input as unknown as DecompositionProjectHandoffInput);
          }),
        };
      }

      if (sub === 'case-draft-intents' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            if (typeof input.checkId === 'string') {
              const basis = store.checkCaseBasis(goalId, input.checkId);
              await validateFrozenPublicationAccess(goalId, basis.publication);
              await options.validateGoal?.(basis.goal);
            }
            return store.createCaseDraftIntent(goalId, input as unknown as DecompositionCaseDraftIntentInput);
          }),
        };
      }

      if(sub==='review-draft'&&(method==='GET'||method==='POST')) {
        const read=async()=>{
          await checkGoalCurrentAccess(goalId);
          const ws=store.getGoalWorkspace(goalId);
          const selectedPeriod=method==='GET'?searchParams?.get('period'):input.period;
          const existing=typeof selectedPeriod==='string'?store.readReviewDraft(goalId,selectedPeriod):null;
          const evidenceChecks=ws.checks.filter(c=>existing?.conclusions.some(row=>row.sourceRef===c.checkId||row.sourceRef===c.actualSource.ref));
          await validateReviewEvidence(goalId,evidenceChecks.map(c=>c.checkId));
          for(const plan of ws.gsaPlans.filter(p=>p.formalTarget.period===selectedPeriod))await options.validateGoal?.(store.read(plan.goal));
          await authorizeWorkspace(goalId,ws);
          return {draft:method==='GET'?store.readReviewDraft(goalId,searchParams?.get('period')??''):store.saveReviewDraft(goalId,input as unknown as import('./strategy-goal-decomposition-types.ts').GoalReviewDraft & {expectedRevision:number})};
        };
        return {body:method==='GET'?await read():await write(read)};
      }
      if (sub === 'cycle-reviews' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            const ws = store.getGoalWorkspace(goalId);
            await validateReviewEvidence(goalId, ws.checks.filter(c => ws.gsaPlans.some(p => p.planVersion === c.gsaPlanVersion && p.formalTarget.period === input.period)).map(c => c.checkId));
            return store.recordCycleReview(goalId, input as unknown as DecompositionCycleReviewInput);
          }),
        };
      }

      if (sub === 'next-cycle-draft' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            const review = store.getGoalWorkspace(goalId).reviews.find(r => r.reviewId === input.reviewId);
            if (review) await validateReviewEvidence(goalId, review.preservedCheckIds);
            if (input.targetScope) await options.validateScope?.(parseScope(input.targetScope));
            return store.createNextCycleDraft(goalId, input as unknown as NextCycleDraftInput);
          }),
        };
      }

      if (sub === 'return-to-strategy' && method === 'POST') {
        return {
          status: 201,
          body: await write(async () => {
            await checkGoalCurrentAccess(goalId);
            const review = store.getGoalWorkspace(goalId).reviews.find(r => r.reviewId === input.reviewId);
            if (review) await validateReviewEvidence(goalId, review.preservedCheckIds);
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
      const pub = store.readDecompositionPublication(goalId, version);
      await validateFrozenPublicationAccess(goalId, pub);
      return { body: { publication: pub } };
    }

    const opRecoveryMatch = /^\/api\/strategy\/goals\/([a-f0-9-]+)\/decomposition\/operations\/([a-f0-9-]+)(?:\/(abandon))?$/.exec(pathname);
    if (opRecoveryMatch) {
      const goalId = opRecoveryMatch[1]!;
      const opId = opRecoveryMatch[2]!;
      const subAction = opRecoveryMatch[3];
      if (!subAction && method === 'GET') {
        const rec = store.getDecompositionOperation(goalId, opId);
        if (rec.publication) await validateFrozenPublicationAccess(goalId, rec.publication);
        else await checkGoalCurrentAccess(goalId);
        return { body: rec };
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
          const basis = store.checkCaseBasis(goalId, checkId);
          await validateFrozenPublicationAccess(goalId, basis.publication);
          await options.validateGoal?.(basis.goal);
          if (input.kind === 'continue-existing') {
            const caseId = typeof input.caseId === 'string' ? input.caseId.trim() : '';
            if (!caseId) throw new GoalDecompositionError('case_id_required', 400);
            const { goal, goalRef, scope, strategies } = basis;
            if (!options.validateContinueExistingCase || input.sameIssueConfirmed !== true ||
                groupScopeKey(goal.scope) !== groupScopeKey(scope)) {
              throw new GoalDecompositionError('case_continue_mismatch', 409);
            }
            const strategy = typeof input.strategy === 'string' ? input.strategy : strategies.length === 1 ? strategies[0] : undefined;
            if (!strategy || !strategies.includes(strategy)) throw new GoalDecompositionError('case_continue_mismatch', 409);
            await options.validateContinueExistingCase({ goalId: goalRef.goalId, goalVersion: goalRef.version, strategy, scope, caseId });
          }
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
      if (match[2] === 'revisions' && method === 'POST') return { status: 201, body: await write(async () => {
        if (!store.getOperation(input.operationId as string)) {
          await options.validateGoal?.(input as unknown as GoalDraftInput, { goalId: id, version: Number(input.expectedVersion) });
          verifyFormalOrigin(input as unknown as GoalDraftInput, id);
        }
        return { goal: store.revise(id, input as unknown as GoalRevisionInput) };
      }) };
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
