import { decompositionChildGoal } from './strategy-goal-allocation.ts';
import type { StrategyGoalsStore } from './strategy-goals-store.ts';
import type { GoalDraftInput, GoalScope, GoalVersion } from './strategy-goals-types.ts';
import type { DecompositionDraft, DecompositionPublication, GoalWorkspaceView } from './strategy-goal-decomposition-types.ts';
import { GoalDecompositionError } from './strategy-goal-decomposition-validation.ts';

export async function checkPublicationAccess(
  store: StrategyGoalsStore,
  goalId: string,
  publication: DecompositionPublication,
  checkGoal?: (goal: GoalVersion) => void | Promise<void>,
  checkScope?: (scope: GoalScope) => void | Promise<void>,
) {
  await checkGoal?.(store.read({ goalId, version: publication.snapshot.gsaPlan.goal.version }));
  for (const row of publication.snapshot.rows) await checkScope?.(row.scope);
  for (const child of publication.committedGoals) {
    await checkGoal?.(store.read({ goalId: child.goalId, version: child.version }));
  }
}

export function createGoalDecompositionAccess(options: {
  store: StrategyGoalsStore;
  validateGoal?: (goal: GoalDraftInput) => void | Promise<void>;
  validateScope?: (scope: GoalScope) => void | Promise<void>;
}) {
  const { store } = options;
  async function validateDraftRows(draft: DecompositionDraft) {
    const plan = store.listGsaPlans(draft.goalId).find(version => version.planId === draft.gsaPlanId && version.planVersion === draft.gsaPlanVersion && version.contentSha256 === draft.gsaPlanSha256);
    if (!plan) throw new GoalDecompositionError('gsa_plan_changed', 409);
    const parent = store.read(plan.goal);
    await options.validateGoal?.(parent);
    for (const row of draft.rows) {
      if (row.commitAsGoal) await options.validateGoal?.(decompositionChildGoal(parent, plan, row, 0));
      await options.validateScope?.(row.scope);
      if (row.linkedGoalId) {
        for (const goal of store.get(row.linkedGoalId).versions) await options.validateGoal?.(goal);
      }
    }
  }
  async function validateFrozenPublicationAccess(goalId: string, pub: DecompositionPublication) {
    await checkPublicationAccess(store, goalId, pub, options.validateGoal, options.validateScope);
  }
  async function validateReviewEvidence(goalId: string, checkIds: string[]) {
    if (!checkIds.length) return;
    const ws = store.getGoalWorkspace(goalId);
    const versions = new Set(checkIds.map(id => {
      const check = ws.checks.find(c => c.checkId === id);
      if (!check) throw new GoalDecompositionError('progress_check_not_found', 404);
      return check.publicationVersion;
    }));
    for (const version of versions) {
      await validateFrozenPublicationAccess(goalId, store.readDecompositionPublication(goalId, version));
    }
  }
  async function authorizeWorkspace(goalId: string, ws: GoalWorkspaceView) {
    const unreadable = new Set<number>();
    for (const summary of ws.publications) {
      try {
        const pub = summary.version === ws.activePublicationVersion && ws.activePublication
          ? ws.activePublication : store.readDecompositionPublication(goalId, summary.version);
        await validateFrozenPublicationAccess(goalId, pub);
      } catch {
        unreadable.add(summary.version);
      }
    }
    if (ws.draft) {
      try { await validateDraftRows(ws.draft); }
      catch { ws.draft = null; ws.validation = null; ws.draftUnavailable = true; }
    }
    if (ws.priorDraft) {
      try { await validateDraftRows(ws.priorDraft); }
      catch { ws.priorDraft = null; ws.draftUnavailable = true; }
    }
    if (!unreadable.size) return;
    ws.unavailablePublicationVersions = [...unreadable];
    ws.publications = ws.publications.filter(p => !unreadable.has(p.version));
    if (ws.activePublicationVersion && unreadable.has(ws.activePublicationVersion)) ws.activePublication = null;
    const blockedChecks = new Set(ws.checks.filter(c => unreadable.has(c.publicationVersion)).map(c => c.checkId));
    ws.submittedActuals = ws.submittedActuals.filter(a => !unreadable.has(a.input.publicationVersion));
    ws.checks = ws.checks.filter(c => !blockedChecks.has(c.checkId));
    ws.handoffs = ws.handoffs.filter(h => !unreadable.has(h.publicationVersion));
    ws.caseDraftIntents = ws.caseDraftIntents.filter(i => !i.publicationRef || !unreadable.has(i.publicationRef.version));
    ws.reviews = ws.reviews.filter(r => r.preservedCheckIds.every(id => !blockedChecks.has(id)));
    const readableReviewIds = new Set(ws.reviews.map(r => r.reviewId));
    ws.nextCycleDrafts = ws.nextCycleDrafts.filter(d => readableReviewIds.has(d.sourceReviewId));
    ws.strategyReturns = ws.strategyReturns.filter(r => readableReviewIds.has(r.reviewId));
  }
  return { validateDraftRows, validateFrozenPublicationAccess, validateReviewEvidence, authorizeWorkspace };
}
