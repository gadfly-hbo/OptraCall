export type ReviewAdmissionContract = 'legacy' | 'conclusion';
export type ReviewTransitionOwner = { projectId: string; taskId: string };
export type LegacyReviewState = { busy: boolean; unknown: boolean };
export type ReviewTransitionState = { state: 'legacy' | 'waiting' | 'ready'; reason?: 'legacy_running' | 'legacy_cleanup_unknown' };

/** A Host deployment contract, not another resource lifecycle. All owner state
 * is read from the existing verification stores and public session domains. */
export function createAnalysisReviewTransition(options: {
  initial?: ReviewAdmissionContract;
  legacyState(owner: ReviewTransitionOwner): Promise<LegacyReviewState>;
}) {
  let requested = options.initial !== 'legacy';
  return {
    legacyAdmissionAllowed: () => !requested,
    // Host calls this under its existing admission gate. No cancellation,
    // settings rewrite, model call or per-owner migration state is created.
    activate: () => { requested = true; },
    async status(owner: ReviewTransitionOwner): Promise<ReviewTransitionState> {
      if (!requested) return { state: 'legacy' };
      const legacy = await options.legacyState(owner);
      return legacy.unknown ? { state: 'waiting', reason: 'legacy_cleanup_unknown' }
        : legacy.busy ? { state: 'waiting', reason: 'legacy_running' }
        : { state: 'ready' };
    },
  };
}
