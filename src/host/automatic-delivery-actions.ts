import type { AnalysisDeliveryReceipt } from './analysis-delivery.ts';
import type { SessionLease, SessionResult } from './agent-sessions.ts';
import type { AutomaticActionStartDecision, AutomaticActionStartFacts } from './automatic-action-settings-types.ts';
import { createHash } from 'node:crypto';
import { canonicalDataContextValue } from './project-data-context-request.ts';
export type AutomaticDeliveryNode = 'review' | 'ir' | 'case' | 'assets';
export interface AutomaticDeliveryObservation {
  node: AutomaticDeliveryNode; requestId: string; parentRequestId: string; reportHash: string;
  phase: 'decision' | 'settled'; decision?: AutomaticActionStartDecision; outcome?: 'returned' | 'unknown'; code?: string;
}
export interface AutomaticDeliveryParent<Owner> { context: SessionLease<Owner>['context']; onCancel: SessionLease<Owner>['onCancel']; assertCurrent(): void | Promise<void> }
export interface AutomaticDeliveryActionInput<Owner> { requestId: string; parentRequestId: string; delivery: AnalysisDeliveryReceipt; parent: AutomaticDeliveryParent<Owner>; reviewResult?: unknown }
export interface AutomaticDeliveryAction<Owner> { authorized: boolean; applicable: boolean | ((delivery: AnalysisDeliveryReceipt) => boolean); run(input: AutomaticDeliveryActionInput<Owner>): Promise<unknown> }
export interface AutomaticDeliveryActionsInput<Owner> {
  delivery?: AnalysisDeliveryReceipt; getDelivery?(): AnalysisDeliveryReceipt | undefined; runResult: Pick<SessionResult, 'outcome'>; requestId: string;
  lease: Pick<SessionLease<Owner>, 'context' | 'onCancel'>; assertCurrent(): void | Promise<void>;
  readCurrent(node: AutomaticDeliveryNode, facts: AutomaticActionStartFacts): Promise<AutomaticActionStartDecision>;
  review?: AutomaticDeliveryAction<Owner>; ir?: AutomaticDeliveryAction<Owner>; case?: AutomaticDeliveryAction<Owner>; assets?: AutomaticDeliveryAction<Owner>;
  record?(observation: AutomaticDeliveryObservation): void | Promise<void>; notify?(observation: AutomaticDeliveryObservation): void | Promise<void>;
}
export interface AutomaticDeliveryOutcome { node: AutomaticDeliveryNode; requestId: string; outcome: 'skipped' | 'returned' | 'unknown'; reason?: string; result?: unknown; code?: string }
const sha = (value: unknown) => createHash('sha256').update(canonicalDataContextValue(value)).digest('hex');
const nodeOrder: AutomaticDeliveryNode[] = ['review', 'ir', 'case', 'assets'];
export async function runAutomaticDeliveryActions<Owner>(input: AutomaticDeliveryActionsInput<Owner>): Promise<AutomaticDeliveryOutcome[]> {
  const { delivery, lease } = input;
  // Root supplies the exact declaration read from the original native history.
  // Neither a file observation nor an ordinary completed turn is an intent.
  if (input.runResult.outcome !== 'completed' || !delivery || delivery.schemaVersion !== 1 || delivery.type !== 'optracall.analysis-delivery' || delivery.claim !== 'declared-not-professionally-verified' || delivery.requestId !== input.requestId || !delivery.sessionId || !delivery.toolCallId || !delivery.selfCheck?.performed || !['complete', 'organize-partial'].includes(delivery.completion) || !['full-report', 'chat-summary'].includes(delivery.format) || !Array.isArray(delivery.reports) || delivery.completion === 'complete' && delivery.format === 'full-report' && !delivery.reports.length || delivery.reports.some(report => report.projectId !== delivery.projectId || report.taskId !== delivery.taskId || !/^[a-f0-9]{64}$/.test(report.sha256))) return [];
  let cancelled = false;
  const current = async () => {
    if (cancelled || !lease.context.isCurrent()) return false;
    try { await input.assertCurrent(); return !cancelled && lease.context.isCurrent(); } catch { return false; }
  };
  if (!await current()) return [];
  let unsubscribe: () => void;
  try { unsubscribe = lease.onCancel(() => { cancelled = true; }); } catch { return []; }
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const reportIdentity = (delivery: AnalysisDeliveryReceipt) => {
  const reports = delivery.reports.map(({ relativePath, sha256 }) => ({ relativePath, sha256 })).sort((a, b) => compare(a.relativePath, b.relativePath) || compare(a.sha256, b.sha256));
  return sha(reports.length ? reports : { format: delivery.format, summary: delivery.summary, methodChecks: delivery.methodChecks });
  };
  const outcomes: AutomaticDeliveryOutcome[] = [];
  let reviewResult: unknown;
  const parent: AutomaticDeliveryParent<Owner> = { context: lease.context, onCancel: lease.onCancel, assertCurrent: input.assertCurrent };
  const observe = async (observation: AutomaticDeliveryObservation) => { if (await current()) await input.record?.(observation); await input.notify?.(observation); };
  try {
    // These are already-declared post-delivery services, not an analysis plan.
    // Each callback keeps its original owner, cancellation and receipt authority.
    for (const node of nodeOrder) {
      const action = input[node]; if (!action) continue;
      if (!await current()) break;
      const active = input.getDelivery ? input.getDelivery() : delivery;
      // A later author turn must explicitly declare its own delivery. Never fall back to an older draft.
      if (!active || active.projectId !== delivery.projectId || active.taskId !== delivery.taskId || active.sessionId !== delivery.sessionId) break;
      const reportHash = reportIdentity(active);
      const hex = sha([active.projectId, active.taskId, input.requestId, node, reportHash]);
      const requestId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      const decision = await input.readCurrent(node, { authorized: action.authorized, applicable: typeof action.applicable === 'function' ? action.applicable(active) : action.applicable, cancelled });
      if (!await current()) break;
      const base = { node, requestId, parentRequestId: input.requestId, reportHash };
      await observe({ ...base, phase: 'decision', decision });
      if (!decision.allowed) { outcomes.push({ node, requestId, outcome: 'skipped', reason: decision.reason }); continue; }
      if (!await current()) break;
      let result: unknown;
      try { result = await action.run({ requestId, parentRequestId: input.requestId, delivery: active, parent, ...(node !== 'review' && reviewResult !== undefined ? { reviewResult } : {}) }); }
      catch (error) {
        const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(error.code) ? error.code : 'automatic_action_result_unknown';
        outcomes.push({ node, requestId, outcome: 'unknown', code });
        await observe({ ...base, phase: 'settled', outcome: 'unknown', code });
        continue;
      }
      if (node === 'review') reviewResult = result;
      outcomes.push({ node, requestId, outcome: 'returned', result });
      await observe({ ...base, phase: 'settled', outcome: 'returned' });
    }
    return outcomes;
  } finally { unsubscribe(); }
}
