import { createHash } from 'node:crypto';
import { parseUserQuoteProvenance, type QuotedDecisionAction, type QuotedDecisionCallContext, type QuotedDecisionToolResult, type UserQuoteProvenance } from '../agent/quoted-decisions.ts';
import type { CaseStore } from './case-store.ts';
import type { ProjectStore } from './project-store.ts';
import type { CaseDecisionRef, CaseStrategyChoice, CaseStrategyChoiceValue } from './case-decision-types.ts';
import { parseCaseDecisionRef } from './case-decision-validation.ts';
import { boardRecordVersion, type createDecisionBoardStore } from '../../extensions/business-plugins/decision-board/storage/store.ts';
import type { BoardItemRecord, BoardActionAuthorization, TaskFeedbackRevision, SaveFeedbackInput, BoardWorkContext, BoardAuthorizationSource, BoardArrangeAction, BoardArrangementReceipt } from '../../extensions/business-plugins/decision-board/types.ts';
import type { StrategyGoalsStore } from './strategy-goals-store.ts';
import type { GoalSourceRef } from './strategy-goals-types.ts';

export type QuotedDecisionHostContext = QuotedDecisionCallContext & {
  projectId: string; taskId: string; originalUserText: string;
  /** Supplied only from the current accepted Case context, never tool arguments. */
  caseContext: { caseStoreId: string; caseId: string; caseRevision: number; projectWorkRevision: number } | null;
  workContext?: BoardWorkContext | null;
};
export class QuotedDecisionFault extends Error {
  code: string; status: number;
  constructor(code: string, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code: string, status = 409): never => { throw new QuotedDecisionFault(code, status); };
const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const operationId = (value: unknown) => {
  const hex = sha(canonical(value));
  // UUIDv8 keeps the application-defined stable digest while setting RFC version/variant bits.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const errorCode = (error: unknown) => typeof (error as { code?: unknown })?.code === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,120}$/.test(String((error as { code: string }).code)) ? String((error as { code: string }).code) : 'quoted_decision_write_unknown';
function replayProvenance(current: UserQuoteProvenance, prior?: UserQuoteProvenance): UserQuoteProvenance {
  if (!prior) return current;
  const { toolCallId: _currentCall, ...next } = current, { toolCallId: _originalCall, ...original } = prior;
  if (canonical(next) !== canonical(original)) fail('quoted_decision_operation_conflict');
  return prior;
}

/** Binds existing business authorities to a qualified original Task tool call. No runtime ownership. */
export function createQuotedDecisionAdapter(options: {
  cases: CaseStore; projects: Pick<ProjectStore, 'get' | 'getTask'>; board: ReturnType<typeof createDecisionBoardStore>;
  goals?: Pick<StrategyGoalsStore, 'recordFeedback' | 'getOperation'> & Partial<Pick<StrategyGoalsStore, 'read' | 'list' | 'recordArrangement'>>;
  checkPlan?(ref: CaseDecisionRef): Promise<void>;
  assertBoardItemReadable?(item: BoardItemRecord): Promise<void>;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>; isClosing(): boolean;
}) {
  const check = (context: QuotedDecisionHostContext) => { context.signal.throwIfAborted(); context.assertCurrent(); if (options.isClosing()) fail('host_closing'); };
  async function owner(context: QuotedDecisionHostContext, writable = false) {
    check(context);
    const bound = context.caseContext ?? fail('quoted_decision_case_required');
    if (bound.caseStoreId !== options.cases.getStatus().storeId) fail('quoted_decision_scope_mismatch');
    const record = options.cases.getCase(bound.caseId), project = await options.projects.get(context.projectId); check(context);
    await options.projects.getTask(context.projectId, context.taskId); check(context);
    if (!options.cases.listProjectLinks(bound.caseId).some(link => link.projectId === context.projectId)) fail('project_not_linked');
    if (writable && (project.archivedAt !== null || record.status === 'closed')) fail(project.archivedAt !== null ? 'project_archived' : 'case_closed');
    return record;
  }
  function provenance(input: Record<string, unknown>, context: QuotedDecisionHostContext): UserQuoteProvenance {
    if (!input.quote || typeof input.quote !== 'object' || Array.isArray(input.quote) || typeof context.originalUserText !== 'string') fail('quoted_decision_clarification_required');
    const quoted = input.quote as { start: number; end: number; text: string };
    if (!Number.isSafeInteger(quoted.start) || !Number.isSafeInteger(quoted.end) || quoted.start < 0 || quoted.end > context.originalUserText.length || quoted.end <= quoted.start ||
        typeof quoted.text !== 'string' || !quoted.text.trim() || context.originalUserText.slice(quoted.start, quoted.end) !== quoted.text || Buffer.from(quoted.text).toString('utf8') !== quoted.text) fail('quoted_decision_quote_mismatch');
    return parseUserQuoteProvenance({ schemaVersion: 1, projectId: context.projectId, taskId: context.taskId, requestId: context.requestId, sessionId: context.sessionId, toolCallId: context.toolCallId,
      originalUserTextSha256: sha(context.originalUserText), quote: quoted });
  }
  function strategy(input: Record<string, unknown>, context: QuotedDecisionHostContext, replayed = false): CaseDecisionRef {
    if (!input.strategyRef) fail('quoted_decision_clarification_required');
    const ref = parseCaseDecisionRef(input.strategyRef), bound = context.caseContext!;
    if (ref.caseStoreId !== bound.caseStoreId || ref.caseId !== bound.caseId) fail('quoted_decision_scope_mismatch');
    const exact = options.cases.getDecision(ref.caseId, ref.recordId, ref.revision), latest = options.cases.getDecision(ref.caseId, ref.recordId);
    if (exact.kind !== 'strategy') fail('case_choice_requires_strategy');
    if (!replayed && latest.lifecycle !== 'active') fail('case_decision_archived');
    if (!replayed && latest.revision !== ref.revision && input.allowHistorical !== true) fail('case_decision_revision_conflict');
    return ref;
  }
  async function boardTarget(input: Record<string, unknown>, context: QuotedDecisionHostContext) {
    const itemId = typeof input.itemId === 'string' ? input.itemId : fail('quoted_decision_clarification_required');
    const taskId = typeof input.taskId === 'string' ? input.taskId : fail('quoted_decision_clarification_required');
    const task = options.board.getTask(taskId), item = options.board.getItem(itemId);
    if (task.itemId !== item.id || item.projectId !== context.projectId) fail('quoted_decision_scope_mismatch');
    if (item.sourceKind === 'report-confirmation') { const assertReadable = options.assertBoardItemReadable ?? fail('confirmation_source_unavailable'); await assertReadable(item); }
    check(context); return { item, task };
  }
  function choiceSource(input: Record<string, unknown>, ref: CaseDecisionRef) {
    const choiceId = typeof input.choiceId === 'string' ? input.choiceId : fail('quoted_decision_clarification_required');
    const choice = options.cases.getStrategyChoice(ref.caseId, choiceId);
    if (canonical(choice.strategyRef) !== canonical(ref)) fail('quoted_decision_scope_mismatch');
    return choice;
  }
  async function management(choice: CaseStrategyChoice, source: GoalSourceRef, id: string, context: QuotedDecisionHostContext) {
    if (!options.goals) return { status: 'pending', code: 'strategy_goals_unavailable' };
    try {
      const original = options.goals.getOperation(id);
      if (original) return { status: 'linked', reference: original.result };
      const event = options.cases.getEvents('case', choice.caseId).find(value => value.id === choice.choiceId);
      const binding = event ? options.cases.getGoalBindingHistory(choice.caseId).filter(value => value.caseRevision <= event.revision).at(-1) : undefined;
      if (!binding) return { status: 'not-applicable', code: 'case_goal_binding_missing' };
      await owner(context, true); check(context);
      const reference = await options.mutate(() => { check(context); return options.goals!.recordFeedback({ operationId: id, goal: binding.primary, level: source.authority === 'case' ? 'strategy' : 'execution', source,
        note: '准确原记录的管理承接；选择、行动授权、用户报告和效果验证分别留据。' }); });
      return { status: 'linked', reference };
    } catch (error) { return { status: 'pending', code: errorCode(error) }; }
  }
  function result(details: Record<string, unknown>): QuotedDecisionToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
  }
  async function projectOwner(context: QuotedDecisionHostContext, writable = false) {
    check(context); const project = await options.projects.get(context.projectId); check(context);
    const task = await options.projects.getTask(context.projectId, context.taskId); check(context);
    if (writable && (project.archivedAt !== null || task.archivedAt != null)) fail('project_archived');
  }
  const arrangementReceipt = (receipt: BoardArrangementReceipt) => ({ operationId: receipt.operationId, projectId: receipt.projectId, source: receipt.source, scope: receipt.scope, title: receipt.title, checks: receipt.checks, actions: receipt.actions, requestSha256: receipt.requestSha256, createdAt: receipt.createdAt,
    quoteSource: receipt.quoteProvenance ? { projectId: receipt.quoteProvenance.projectId, taskId: receipt.quoteProvenance.taskId, requestId: receipt.quoteProvenance.requestId, sessionId: receipt.quoteProvenance.sessionId, toolCallId: receipt.quoteProvenance.toolCallId, originalUserTextSha256: receipt.quoteProvenance.originalUserTextSha256, rangeUtf16: { start: receipt.quoteProvenance.quote.start, end: receipt.quoteProvenance.quote.end } } : undefined });
  async function readArrangement(operation: unknown, context: QuotedDecisionHostContext) {
    if (typeof operation !== 'string') fail('invalid_quoted_decision', 400);
    const prior = options.board.getArrangementOperation(operation as string);
    if (!prior) return null;
    if (prior.projectId !== context.projectId || prior.quoteProvenance?.taskId !== context.taskId) fail('quoted_decision_scope_mismatch');
    for (const action of prior.actions) await boardTarget(action, context);
    return prior;
  }
  async function arrange(input: Record<string, unknown>, context: QuotedDecisionHostContext) {
    await projectOwner(context); const supplied = provenance(input, context);
    const id = operationId(['quoted-arrangement-v1', context.projectId, context.taskId, context.requestId, supplied.quote.start, supplied.quote.end]);
    const prior = await readArrangement(id, context);
    if (context.caseContext) await owner(context, !prior);
    let source: BoardAuthorizationSource, goal = context.workContext?.goal;
    if (input.strategyRef !== undefined || input.choiceId !== undefined) {
      await owner(context, !prior); const ref = strategy(input, context, Boolean(prior)), choice = choiceSource(input, ref);
      source = { caseStoreId: ref.caseStoreId, caseId: ref.caseId, choiceId: choice.choiceId, strategyRef: ref };
      const event = options.cases.getEvents('case', choice.caseId).find(value => value.id === choice.choiceId);
      goal = event ? options.cases.getGoalBindingHistory(choice.caseId).filter(value => value.caseRevision <= event.revision).at(-1)?.primary : undefined;
    } else source = { kind: 'work', projectId: context.projectId, taskId: context.taskId, requestId: context.requestId, ...(context.workContext ? { workContext: context.workContext } : {}) };
    if (!prior) {
      await projectOwner(context, true);
      if (!Array.isArray(input.actions)) fail('invalid_arrangement', 400);
      for (const action of input.actions as BoardArrangeAction[]) {
        if (action?.kind === 'reuse') await boardTarget(action, context);
        else if (action?.kind === 'create' && action.itemId) {
          const item = options.board.getItem(action.itemId); if (item.projectId !== context.projectId) fail('quoted_decision_scope_mismatch');
          if (item.sourceKind === 'report-confirmation') await (options.assertBoardItemReadable ?? fail('confirmation_source_unavailable'))(item);
        }
      }
    }
    let authority: BoardArrangementReceipt;
    try {
      authority = await options.mutate(async () => {
        if (!('kind' in source) && !options.board.getArrangementOperation(id)) await options.checkPlan?.(source.strategyRef);
        check(context); return options.board.arrangeActions({ operationId: id, projectId: context.projectId, source,
        quoteProvenance: replayProvenance(supplied, prior?.quoteProvenance), scope: input.scope as string, title: input.title as string, checks: input.checks as string[], actions: input.actions as BoardArrangeAction[] }, { assertWritable: () => check(context) }); });
    } catch (error) {
      const code = errorCode(error);
      if ((error as { name?: string }).name === 'AbortError' || code === 'generation_cancelled' || /^(invalid_|authorization_|arrangement_operation_conflict|quoted_decision_|task_|item_)/.test(code)) throw error;
      return result({ type: 'optracall.quoted-arrangement-record', operationId: id, status: 'unknown', code, authority: { status: 'unknown' }, management: { status: 'pending' }, claim: 'Original Board result requires readback; no management write or new intent was attempted.' });
    }
    let managementResult: Record<string, unknown> = { status: 'not-applicable', code: 'work_goal_missing' };
    if (goal) {
      const managementId = operationId([id, 'management-arrangement']);
      try {
        const saved = options.goals?.getOperation(managementId);
        if (saved) { const reference = saved.result as import('./strategy-goals-types.ts').GoalActionArrangement; managementResult = { status: 'linked', reference: { id: reference.id, goal: reference.goal, boardOperationId: reference.boardOperationId } }; }
        else {
          if (!options.goals?.recordArrangement) fail('strategy_goals_unavailable', 503);
          await projectOwner(context, true); check(context);
          const reference = await options.mutate(() => { check(context); return options.goals!.recordArrangement!({ operationId: managementId, goal: goal!, projectId: context.projectId,
            title: authority.title, scope: authority.scope, checks: authority.checks, actions: authority.actions, source: authority.source, boardOperationId: id, quoteProvenance: authority.quoteProvenance ?? fail('quoted_decision_scope_mismatch') }, { assertWritable: () => check(context) }); });
          managementResult = { status: 'linked', reference: { id: reference.id, goal: reference.goal, boardOperationId: reference.boardOperationId } };
        }
      } catch (error) { managementResult = { status: 'pending', code: errorCode(error) }; }
    }
    return result({ type: 'optracall.quoted-arrangement-record', operationId: id, status: managementResult.status === 'pending' ? 'partial' : 'completed', authority: arrangementReceipt(authority), management: managementResult, claim: 'arranged-not-executed-not-effect-verified' });
  }
  function authorityReceipt(authority: CaseStrategyChoice | BoardActionAuthorization | TaskFeedbackRevision) {
    const quote = authority.quoteProvenance;
    const quoteSource = quote ? { projectId: quote.projectId, taskId: quote.taskId, requestId: quote.requestId, sessionId: quote.sessionId, toolCallId: quote.toolCallId,
      originalUserTextSha256: quote.originalUserTextSha256, rangeUtf16: { start: quote.quote.start, end: quote.quote.end } } : undefined;
    if ('choiceId' in authority) return { choiceId: authority.choiceId, caseId: authority.caseId, strategyRef: authority.strategyRef, choice: authority.choice, previousChoiceId: authority.previousChoiceId, operationId: authority.operationId, actorKind: authority.actorKind, quoteSource };
    if ('authorizationId' in authority) return { authorizationId: authority.authorizationId, revision: authority.revision, previousAuthorizationId: authority.previousAuthorizationId, projectId: authority.projectId, itemId: authority.itemId, taskId: authority.taskId,
      itemVersion: authority.itemVersion, taskVersion: authority.taskVersion, decision: authority.decision, source: authority.source, operationId: authority.operationId, actorKind: authority.actorKind, quoteSource };
    return { taskId: authority.taskId, revisionId: authority.revisionId, revisionNumber: authority.revisionNumber, operationId: authority.operationId, adopted: authority.adopted, effect: authority.effect, origin: authority.origin, quoteSource };
  }
  async function revokeWork(input: Record<string, unknown>, context: QuotedDecisionHostContext) {
    await projectOwner(context); const supplied = provenance(input, context);
    if (typeof input.expectedPreviousAuthorizationId !== 'string' || typeof input.scope !== 'string' || !input.scope.trim() || typeof input.itemVersion !== 'string' || typeof input.taskVersion !== 'string' || input.choiceId !== undefined) fail('quoted_decision_clarification_required');
    const target = await boardTarget(input, context), original = options.board.getActionAuthorization(input.expectedPreviousAuthorizationId as string) ?? fail('quoted_decision_scope_mismatch');
    if (original.projectId !== context.projectId || original.itemId !== target.item.id || original.taskId !== target.task.id || !('kind' in original.source) || original.source.taskId !== context.taskId || canonical(original.source.workContext ?? null) !== canonical(context.workContext ?? null)) fail('quoted_decision_scope_mismatch');
    const id = operationId(['quoted-work-revoke-v1', context.projectId, context.taskId, context.requestId, supplied.quote.start, supplied.quote.end, target.task.id]);
    const prior = options.board.getActionAuthorizationOperation(id);
    if (!prior) await projectOwner(context, true);
    let authority: BoardActionAuthorization;
    try {
      authority = await options.mutate(() => { check(context); return options.board.recordActionAuthorization({ operationId: id, projectId: context.projectId, itemId: target.item.id, taskId: target.task.id,
        itemVersion: input.itemVersion as string, taskVersion: input.taskVersion as string, expectedPreviousAuthorizationId: original.authorizationId, decision: 'revoke', scope: input.scope as string,
        source: original.source, quoteProvenance: replayProvenance(supplied, prior?.quoteProvenance) }, { assertWritable: () => check(context) }); });
    } catch (error) {
      const code = errorCode(error), status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode;
      if ((error as { name?: string }).name === 'AbortError' || code === 'generation_cancelled' || status !== undefined && status < 500 || /^(invalid_|authorization_|quoted_decision_)/.test(code)) throw error;
      return result({ type: 'optracall.quoted-decision-record', operationId: id, status: 'unknown', code, authority: { status: 'unknown' }, management: { status: 'not-applicable' }, claim: 'Original Board result requires readback; no new operation id was attempted.' });
    }
    return result({ type: 'optracall.quoted-decision-record', operationId: id, status: 'completed', authority: authorityReceipt(authority), management: { status: 'not-applicable', code: 'original_board_authority' }, claim: 'authorization-revoked-execution-and-feedback-preserved' });
  }
  return async (action: QuotedDecisionAction, input: Record<string, unknown>, context: QuotedDecisionHostContext): Promise<QuotedDecisionToolResult> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_quoted_decision', 400);
    const allowed: Record<QuotedDecisionAction, string[]> = {
      read: ['pageSize', 'actionContinuation', 'decisionContinuation', 'operationId'], 'choose-strategy': ['quote', 'strategyRef', 'choice', 'reason', 'expectedPreviousChoiceId', 'allowHistorical'],
      'authorize-action': ['quote', 'strategyRef', 'choiceId', 'itemId', 'taskId', 'itemVersion', 'taskVersion', 'expectedPreviousAuthorizationId', 'decision', 'scope', 'allowHistorical'],
      'record-feedback': ['quote', 'strategyRef', 'choiceId', 'itemId', 'taskId', 'expectedLatestRevisionId', 'adopted', 'outcome', 'metricDelta', 'review', 'score', 'effect', 'allowHistorical'],
      'arrange-actions': ['quote', 'scope', 'title', 'checks', 'actions', 'strategyRef', 'choiceId', 'allowHistorical'],
    };
    if (!allowed[action] || input.action !== undefined && input.action !== action || Object.keys(input).some(key => key !== 'action' && !allowed[action].includes(key))) fail('invalid_quoted_decision', 400);
    if (action === 'arrange-actions') return arrange(input, context);
    if (action === 'authorize-action' && input.decision === 'revoke' && input.strategyRef === undefined) return revokeWork(input, context);
    if (action === 'read' && (input.operationId !== undefined || !context.caseContext)) {
      await projectOwner(context);
      if (input.operationId !== undefined) {
        const operation = await readArrangement(input.operationId, context);
        if (operation) return result({ type: 'optracall.quoted-arrangement-read', operation: arrangementReceipt(operation) });
        const authorization = options.board.getActionAuthorizationOperation(input.operationId as string);
        if (!authorization) return result({ type: 'optracall.quoted-arrangement-read', operation: null });
        if (authorization.projectId !== context.projectId || authorization.quoteProvenance?.taskId !== context.taskId) fail('quoted_decision_scope_mismatch');
        await boardTarget(authorization, context);
        return result({ type: 'optracall.quoted-authorization-read', authorization: authorityReceipt(authorization) });
      }
      const rows = [];
      for (const task of options.board.listTasks()) {
        const item = options.board.getItem(task.itemId); if (item.projectId !== context.projectId) continue;
        try { await boardTarget({ itemId: item.id, taskId: task.id }, context); } catch { check(context); continue; }
        const authorization = options.board.listActionAuthorizations(task.id).at(-1);
        rows.push({ item: { id: item.id, title: item.title }, task: { id: task.id, title: task.title, owner: task.owner, dueDate: task.dueDate, status: task.status }, itemVersion: boardRecordVersion(item), taskVersion: boardRecordVersion(task), authorization: authorization?.authorizationId ?? null,
          authorizations: authorization ? [authorityReceipt(authorization)] : [] });
      }
      const pageSize = input.pageSize === undefined ? 5 : Number(input.pageSize), version = sha(canonical(rows)); let offset = 0;
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 5) fail('invalid_quoted_decision', 400);
      if (input.actionContinuation !== undefined) {
        try { const cursor = JSON.parse(Buffer.from(String(input.actionContinuation), 'base64url').toString('utf8')); if (cursor.version !== version || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset >= rows.length) fail('quoted_decision_catalog_changed'); offset = cursor.offset; }
        catch { fail('quoted_decision_catalog_changed'); }
      }
      return result({ type: 'optracall.quoted-decision-read', actions: rows.slice(offset, offset + pageSize), actionContinuation: offset + pageSize < rows.length ? Buffer.from(JSON.stringify({ version, offset: offset + pageSize })).toString('base64url') : null, claim: 'Observed original Board facts; no Case was inferred.' });
    }
    const record = await owner(context);
    if (action === 'read') {
      const pageSize = input.pageSize === undefined ? 5 : Number(input.pageSize);
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 5 || ['actionContinuation', 'decisionContinuation'].some(key => input[key] !== undefined && (typeof input[key] !== 'string' || String(input[key]).length > 2000))) fail('invalid_quoted_decision', 400);
      const rows = [];
      for (const task of options.board.listTasks()) {
        const item = options.board.getItem(task.itemId); if (item.projectId !== context.projectId) continue;
        try { await boardTarget({ itemId: item.id, taskId: task.id }, context); } catch { check(context); continue; }
        rows.push({ item, task, itemVersion: boardRecordVersion(item), taskVersion: boardRecordVersion(task), authorization: options.board.listActionAuthorizations(task.id).at(-1), feedback: options.board.listFeedbackHistory(task.id).at(-1) });
      }
      const catalogVersion = sha(canonical([record.id, context.projectId, rows.map(row => [row.task.id, row.itemVersion, row.taskVersion, row.authorization?.authorizationId, row.feedback?.revisionId])]));
      let offset = 0;
      if (input.actionContinuation !== undefined) {
        try {
          const cursor = JSON.parse(Buffer.from(input.actionContinuation as string, 'base64url').toString('utf8'));
          if (cursor.version !== catalogVersion || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset >= rows.length) fail('quoted_decision_catalog_changed');
          offset = cursor.offset;
        } catch { fail('quoted_decision_catalog_changed'); }
      }
      const actions = rows.slice(offset, offset + pageSize).map(row => ({
        item: { id: row.item.id, projectId: row.item.projectId, title: row.item.title, status: row.item.status, sourceKind: row.item.sourceKind },
        task: { id: row.task.id, itemId: row.task.itemId, title: row.task.title, status: row.task.status, owner: row.task.owner, dueDate: row.task.dueDate, priority: row.task.priority },
        itemVersion: row.itemVersion, taskVersion: row.taskVersion,
        authorizations: row.authorization ? [{ authorizationId: row.authorization.authorizationId, revision: row.authorization.revision, decision: row.authorization.decision, scope: row.authorization.scope, source: row.authorization.source }] : [],
        feedback: row.feedback ? [{ revisionId: row.feedback.revisionId, revisionNumber: row.feedback.revisionNumber, adopted: row.feedback.adopted, effect: row.feedback.effect }] : [],
      }));
      const listing = options.cases.listDecisions(record.id, { pageSize, continuation: input.decisionContinuation as string | undefined });
      const catalog = { caseStoreId: listing.caseStoreId, caseId: record.id,
        items: listing.items.map(row => ({ strategyRef: { type: 'case-decision', caseStoreId: row.caseStoreId, caseId: row.caseId, recordId: row.recordId, revision: row.revision }, kind: row.kind, title: row.payload.title, lifecycle: row.lifecycle })),
        choices: listing.items.flatMap(row => { const choice = listing.choices.filter(value => value.strategyRef.recordId === row.recordId).at(-1); return choice ? [{ choiceId: choice.choiceId, strategyRef: choice.strategyRef, choice: choice.choice, operationId: choice.operationId }] : []; }), continuation: listing.continuation };
      check(context);
      return result({ type: 'optracall.quoted-decision-read', caseId: record.id, catalog, actions, actionContinuation: offset + pageSize < rows.length ? Buffer.from(JSON.stringify({ version: catalogVersion, offset: offset + pageSize })).toString('base64url') : null,
        claim: 'Exact authorities and observed versions; adopted does not imply authorized, executed or verified.' });
    }
    const supplied = provenance(input, context);
    if (!input.strategyRef) fail('quoted_decision_clarification_required');
    const ref = parseCaseDecisionRef(input.strategyRef);
    if (ref.caseId !== context.caseContext!.caseId || ref.caseStoreId !== context.caseContext!.caseStoreId) fail('quoted_decision_scope_mismatch');
    const id = operationId(['quoted-decision-v1', context.projectId, context.taskId, context.requestId, action, supplied.quote.start, supplied.quote.end, ref.recordId, input.taskId ?? null]);
    let authority: CaseStrategyChoice | BoardActionAuthorization | TaskFeedbackRevision, choice: CaseStrategyChoice, source: GoalSourceRef;
    try {
    const replayed = action === 'choose-strategy' ? options.cases.getOperation(id) !== null
      : action === 'authorize-action' ? options.board.getActionAuthorizationOperation(id) !== null : options.board.getFeedbackOperation(id) !== null;
    strategy(input, context, replayed);
    if (action === 'choose-strategy') {
      if (!input.choice || !Object.hasOwn(input, 'expectedPreviousChoiceId')) fail('quoted_decision_clarification_required');
      const prior = options.cases.getOperation(id), saved = prior?.kind === 'case_strategy_choice' && prior.phase === 'completed' ? prior.result as unknown as CaseStrategyChoice : undefined;
      const quoteProvenance = replayProvenance(supplied, saved?.quoteProvenance);
      if (!saved) await owner(context, true);
      authority = await options.mutate(() => options.cases.chooseStrategy({ operationId: id, caseStoreId: ref.caseStoreId, caseId: ref.caseId, strategyRef: ref, choice: input.choice as CaseStrategyChoiceValue,
        expectedPreviousChoiceId: input.expectedPreviousChoiceId as string | null, ...(input.reason === undefined ? {} : { reason: input.reason as string }), ...(input.allowHistorical === true ? { allowHistorical: true } : {}) }, { quoteProvenance, assertWritable: () => check(context) }));
      choice = authority; source = { authority: 'case', id: choice.caseId, version: choice.choiceId, projectId: context.projectId, taskId: context.taskId };
    } else {
      choice = choiceSource(input, ref);
      const target = await boardTarget(input, context); if (!replayed) await owner(context, true);
      if (action === 'authorize-action') {
        if (!input.decision || typeof input.scope !== 'string' || !input.scope.trim() || typeof input.itemVersion !== 'string' || typeof input.taskVersion !== 'string' || !Object.hasOwn(input, 'expectedPreviousAuthorizationId')) fail('quoted_decision_clarification_required');
        const prior = options.board.getActionAuthorizationOperation(id), quoteProvenance = replayProvenance(supplied, prior?.quoteProvenance);
        authority = await options.mutate(async () => {
          if (input.decision === 'authorize' && !options.board.getActionAuthorizationOperation(id)) await options.checkPlan?.(ref);
          return options.board.recordActionAuthorization({ operationId: id, projectId: context.projectId, itemId: target.item.id, taskId: target.task.id,
          itemVersion: input.itemVersion as string, taskVersion: input.taskVersion as string, expectedPreviousAuthorizationId: input.expectedPreviousAuthorizationId as string | null, decision: input.decision as 'authorize' | 'revoke', scope: input.scope as string,
          source: { caseStoreId: ref.caseStoreId, caseId: ref.caseId, strategyRef: ref, choiceId: choice.choiceId }, quoteProvenance }, { assertWritable: () => check(context) }); });
        source = { authority: 'decision-board', id: target.task.id, version: authority.authorizationId, projectId: context.projectId, taskId: target.task.id };
      } else {
        if (!Object.hasOwn(input, 'expectedLatestRevisionId') || typeof input.adopted !== 'boolean' || ['outcome', 'metricDelta', 'review'].some(key => typeof input[key] !== 'string') || !Object.hasOwn(input, 'score')) fail('quoted_decision_clarification_required');
        const prior = options.board.getFeedbackOperation(id), quoteProvenance = replayProvenance(supplied, prior?.quoteProvenance);
        authority = await options.mutate(() => options.board.saveFeedback(target.task.id, { operationId: id, expectedLatestRevisionId: input.expectedLatestRevisionId, adopted: input.adopted, outcome: input.outcome,
          metricDelta: input.metricDelta, review: input.review, score: input.score, effect: input.effect ?? 'unknown' } as SaveFeedbackInput, { quoteProvenance, assertWritable: () => check(context) }));
        source = { authority: 'decision-board', id: target.task.id, version: authority.revisionId, projectId: context.projectId, taskId: target.task.id };
      }
    }
    } catch (error) {
      const code = errorCode(error), status = (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode;
      if ((error as { name?: string }).name === 'AbortError' || code === 'generation_cancelled' || status !== undefined && status < 500 || /^(invalid_|case_(choice|decision)_|authorization_(operation_conflict|revision_conflict|source_changed|scope_mismatch|requires_)|feedback_(operation_conflict|revision_conflict)|quoted_decision_.*(mismatch|conflict|required))/.test(code)) throw error;
      return result({ type: 'optracall.quoted-decision-record', operationId: id, status: 'unknown', code, strategyRef: ref, authority: { status: 'unknown' }, management: { status: 'pending' },
        claim: 'Original authority result requires readback; no new operation id or management write was attempted.' });
    }
    const managementResult = await management(choice, source, operationId([id, 'management-reference']), context);
    return result({ type: 'optracall.quoted-decision-record', operationId: id, status: managementResult.status === 'pending' ? 'partial' : 'completed', authority: authorityReceipt(authority), management: managementResult,
      claim: action === 'record-feedback' ? 'user-reported-not-independently-verified' : 'recorded-not-executed-not-effect-verified' });
  };
}
