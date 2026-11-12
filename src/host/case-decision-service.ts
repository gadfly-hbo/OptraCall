import type { BoardItemRecord } from '../../extensions/business-plugins/decision-board/types.ts';
import { CaseStoreError, type CaseStore } from './case-store.ts';
import type { CaseDecisionListOptions, CaseDecisionTarget, CaseDecisionRevision, CaseDecisionReference } from './case-decision-types.ts';
import { caseDecisionFields, parseCaseDecisionTarget, parseCaseDecisionDraft, caseDecisionId, parseCaseDecisionRef, parseCaseDecisionGovernance, parseCaseStrategyChoice } from './case-decision-validation.ts';
import { createHash } from 'node:crypto';
import { canonical } from './project-data-context-io.ts';
import type { ProjectStore, ProjectRecord } from './project-store.ts';
import type { ReadPersonalSource } from './personal-retention-types.ts';
import type { createPersonalContextReader } from './personal-context-reader.ts';
import type { createDecisionBoardStore } from '../../extensions/business-plugins/decision-board/storage/store.ts';
import type { createRequirementStore } from '../../extensions/business-plugins/requirements-elaboration/storage/store.ts';
import type { FeedbackHandoff } from './decision-feedback-types.ts';
import type { LearningSourceReadOptions } from './learning-source-types.ts';

type ReadRelease = ReturnType<ReturnType<typeof createRequirementStore>['readRelease']>;
type DecisionSourceReadOptions = LearningSourceReadOptions & { projectId?: string };
export type CaseDecisionServiceDependencies = {
  cases: CaseStore;
  projects: ProjectStore;
  mutate: <T>(operation: () => T | Promise<T>) => Promise<T>;
  assertActive: (project: ProjectRecord) => void;
  readSource?: ReadPersonalSource;
  personalContext?: Pick<ReturnType<typeof createPersonalContextReader>, 'read'>;
  board?: Pick<ReturnType<typeof createDecisionBoardStore>, 'getTask' | 'getItem' | 'getFeedbackRevision' | 'listTasks' | 'listFeedbackHistory'>;
  assertBoardItemReadable?: (item: BoardItemRecord) => Promise<void>;
  requirements?: { readRelease: (id: string, version: string, projectId?: string) => ReadRelease | Promise<ReadRelease> };
  readHandoff?: (id: string) => FeedbackHandoff | null | Promise<FeedbackHandoff | null>;
};

export type CaseDecisionSourceView = {
  target: CaseDecisionTarget; status: 'available' | 'disabled' | 'metadata' | 'unknown'; title: string;
  text: string | null; sha256: string | null; limitations: string[]; code?: string;
  range?: { start: number; end: number; total: number }; partial?: boolean; continuation?: string | null; current?: unknown;
  observation?: { handoffId: string; sourceNature: NonNullable<FeedbackHandoff['sourceNature']> | null;
    observationPeriod: string | null; applicability: string | null; limitations: string | null };
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const boundary = (text: string, position: number) => position === 0 || position === text.length || !(text.charCodeAt(position - 1) >= 0xd800 && text.charCodeAt(position - 1) <= 0xdbff && text.charCodeAt(position) >= 0xdc00 && text.charCodeAt(position) <= 0xdfff);
const sourceFailureCode = (error: unknown): string => {
  const value = (error as { code?: unknown })?.code;
  return typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,120}$/.test(value) ? value : 'case_decision_source_unavailable';
};
const strictSourceFailure = (code: string) => /invalid_|mismatch|rejected|unsafe_|permission|forbidden|excluded/i.test(code);

/** Only the Host constructs this from the current Pi call and accepted Case snapshot. */
export type CaseDecisionAgentContext = {
  caseStoreId: string; caseId: string; projectId: string; taskId: string; requestId: string;
  sessionId: string; toolCallId: string; operationId: string; signal: AbortSignal; assertCurrent: () => void;
};
const exactIdentity = (target: CaseDecisionTarget) => {
  if (target.type !== 'board-task') return canonical(target);
  const { observation: _observed, ...identity } = target; return canonical(identity);
};

/** Case business records reuse their original store; this is not an Agent runtime. */
export function createCaseDecisionService(deps: CaseDecisionServiceDependencies) {
  function list(caseId: string, options: CaseDecisionListOptions = {}) {
    return { ...deps.cases.listDecisions(caseId, options), writingEnabled: deps.cases.isDecisionWritingEnabled() && deps.cases.getStatus().state === 'ready' };
  }
  function read(caseId: string, recordId: string, revision?: number) {
    return deps.cases.getDecision(caseId, recordId, revision);
  }
  async function links(caseId: string) {
    deps.cases.getCase(caseId);
    if (!deps.board) throw new CaseStoreError('case_decision_board_unavailable', 503);
    const projects = new Map<string, ProjectRecord>();
    for (const link of deps.cases.listProjectLinks(caseId)) projects.set(link.projectId, await deps.projects.get(link.projectId));
    const actions = [];
    for (const task of deps.board.listTasks()) {
      const item = deps.board.getItem(task.itemId), project = projects.get(item.projectId);
      if (!project) continue;
      if (item.sourceKind === 'report-confirmation') { try { if (!deps.assertBoardItemReadable) continue; await deps.assertBoardItemReadable(item); } catch { continue; } }
      actions.push({ target: { type: 'board-task' as const, projectId: project.id, itemId: item.id, taskId: task.id },
        title: task.title, projectName: project.name, projectArchived: project.archivedAt !== null, itemTitle: item.title,
        status: task.status, owner: task.owner, dueDate: task.dueDate, note: task.note, updatedAt: task.updatedAt,
        feedbackRevisions: deps.board.listFeedbackHistory(task.id).map(revision => ({ revisionId: revision.revisionId, revisionNumber: revision.revisionNumber,
          savedAt: revision.savedAt, origin: revision.origin, adopted: revision.adopted, effect: revision.effect })),
      });
    }
    return { actions };
  }
  async function resolveSource(caseId: string, target: CaseDecisionTarget, signal?: AbortSignal, continuation?: string | null, options: DecisionSourceReadOptions = {}): Promise<CaseDecisionSourceView> {
    signal?.throwIfAborted();
    const limitations = ['来源及关系是作者声明，不是Host的事实或因果核定；未代作人的选择或经营动作。'];
    let value: CaseDecisionSourceView;
    if (target.type === 'source') {
      if (!deps.readSource) throw new CaseStoreError('case_decision_source_unavailable', 503);
      const source = await deps.readSource(target.source, { ...options, signal });
      if (source.status === 'excluded' || source.status === 'governance-unknown') return { target, title: source.title, status: 'unknown', text: null, sha256: null, code: 'case_decision_source_excluded', limitations: [...limitations, '原候选当前不可新供给；不交付正文或摘要。'], partial: false, continuation: null };
      value = { target, title: source.title, status: source.text === null ? 'metadata' : source.status, text: source.text, sha256: source.sha256, limitations };
      if (source.text === null) limitations.push('仅元信息，没有进行OCR或文件正文提取。');
      if (source.project?.archived) limitations.push('来源项目现已归档；历史引用与专业判断分别保留。');
    } else if (target.type === 'personal') {
      if (!deps.personalContext) throw new CaseStoreError('case_decision_source_unavailable', 503);
      const result = await deps.personalContext.read({ target: target.target, continuation }, { signal, budget: options.budget });
      signal?.throwIfAborted();
      return { target, title: result.details.items[0]?.title ?? '准确个人资料', status: 'available', text: result.text, sha256: sha(result.text),
        limitations: [...limitations, '沿原个人资料准确读口提供；未复制为新的证据正文库。'], partial: result.details.partial, continuation: result.details.continuation,
        current: { provided: result.details.items[0] ?? null } };
    } else if (target.type === 'rap') {
      if (!deps.requirements) throw new CaseStoreError('case_decision_source_unavailable', 503);
      const released = await deps.requirements.readRelease(target.instanceId, target.version, options.projectId);
      const text = JSON.stringify(released.rap, null, 2);
      value = { target, title: `${released.entry.title} · RAP ${released.entry.version}`, status: 'available', text, sha256: sha(text), current: { packageFingerprint: released.entry.packageFingerprint, contentFingerprint: released.entry.contentFingerprint },
        limitations: [...limitations, '原权威已校验的准确发布版JSON投影，不是YAML原字节；RAP方法假设不自动成为已检验业务假设。'] };
    } else if (target.type === 'case-decision') {
      if (target.caseId !== caseId || target.caseStoreId !== deps.cases.getStatus().storeId) throw new CaseStoreError('case_decision_source_case_mismatch', 409);
      const revision = deps.cases.getDecision(caseId, target.recordId, target.revision), text = JSON.stringify(revision, null, 2);
      value = { target, title: `${revision.payload.title} · v${revision.revision}`, status: 'available', text, sha256: sha(text), limitations };
    } else {
      if (!deps.board) throw new CaseStoreError('case_decision_board_unavailable', 503);
      const taskId = target.type === 'board-task' ? target.taskId : target.boardTaskId;
      const projectId = target.type === 'board-task' ? target.projectId : target.sourceProjectId;
      const task = deps.board.getTask(taskId), item = deps.board.getItem(task.itemId);
      if (item.sourceKind === 'report-confirmation') { if (!deps.assertBoardItemReadable) throw new CaseStoreError('confirmation_source_unavailable', 409); await deps.assertBoardItemReadable(item); }
      if (item.projectId !== projectId || target.type === 'board-task' && item.id !== target.itemId) throw new CaseStoreError('case_decision_source_project_mismatch', 409);
      await deps.projects.get(projectId);
      if (target.type === 'board-task') {
        const text = JSON.stringify({ associatedObservation: target.observation ?? null, currentTask: task }, null, 2);
        value = { target, title: task.title, status: 'available', text, sha256: sha(text), current: task,
          limitations: [...limitations, '原行动为可变对象；关联时观察与当前状态分开，不冒称不可变行动版本。'] };
      } else {
        const revision = deps.board.getFeedbackRevision(target.feedbackRevisionId);
        if (!revision) throw new CaseStoreError('case_decision_source_feedback_missing', 404);
        if (revision.taskId !== task.id) throw new CaseStoreError('case_decision_source_feedback_mismatch', 409);
        let handoff = null;
        if (target.handoffId) {
          handoff = await deps.readHandoff?.(target.handoffId);
          if (!handoff) throw new CaseStoreError('case_decision_feedback_handoff_missing', 404);
          if (handoff.source.sourceProjectId !== projectId || handoff.source.boardTaskId !== task.id || handoff.source.feedbackRevision?.revisionId !== revision.revisionId) throw new CaseStoreError('case_decision_feedback_handoff_mismatch', 409);
        }
        const observation = handoff ? { handoffId: handoff.handoffId, sourceNature: handoff.sourceNature ?? null, observationPeriod: handoff.observationPeriod ?? null, applicability: handoff.applicability ?? null, limitations: handoff.limitations ?? null } : undefined;
        const text = JSON.stringify({ feedback: revision, ...(observation ? { observation } : {}) }, null, 2);
        value = { target, title: `反馈修订 v${revision.revisionNumber}`, status: 'available', text, sha256: sha(text), ...(observation ? { observation } : {}),
          current: { latestFeedbackRevisionId: deps.board.listFeedbackHistory(task.id).at(-1)?.revisionId ?? null },
          limitations: [...limitations, handoff ? '观察范围来自指定原handoff，未替换准确反馈。' : '未关联handoff，观察期／来源性质／适用性／局限未记录，不能从反馈正文补造。', '是否执行、指标变化与专业效果／因果分别表达。'] };
      }
    }
    signal?.throwIfAborted();
    if (value.text === null) return { ...value, partial: false, continuation: null };
    const contentSha = sha(value.text), identity = sha(canonical(target));
    let start = 0;
    if (continuation) {
      try {
        const cursor = JSON.parse(Buffer.from(continuation, 'base64url').toString('utf8'));
        if (cursor.identity !== identity || cursor.contentSha !== contentSha || !Number.isSafeInteger(cursor.next) || cursor.next < 0 || cursor.next >= value.text.length || !boundary(value.text, cursor.next)) throw new Error();
        start = cursor.next;
      } catch { throw new CaseStoreError('case_decision_source_continuation_changed', 409); }
    }
    let end = Math.min(value.text.length, start + 24000);
    if (!boundary(value.text, end)) end--;
    const partial = end < value.text.length;
    return { ...value, text: value.text.slice(start, end), range: { start, end, total: value.text.length }, partial,
      continuation: partial ? Buffer.from(JSON.stringify({ identity, contentSha, next: end })).toString('base64url') : null };
  }
  async function source(caseId: string, input: unknown, signal?: AbortSignal, options: DecisionSourceReadOptions = {}): Promise<CaseDecisionSourceView> {
    deps.cases.getCase(caseId);
    caseDecisionFields(input, ['target', 'continuation'], ['target']);
    const target = parseCaseDecisionTarget(input.target), continuation = input.continuation;
    if (continuation !== undefined && continuation !== null && (typeof continuation !== 'string' || continuation.length > 2000)) throw new CaseStoreError('invalid_case_decision_continuation');
    try { return await resolveSource(caseId, target, signal, continuation as string | null | undefined, options); }
    catch (error) {
      signal?.throwIfAborted();
      const code = sourceFailureCode(error);
      if (strictSourceFailure(code) || code.includes('continuation')) throw new CaseStoreError(code, code.startsWith('invalid_') ? 400 : 409);
      return { target, status: 'unknown', title: '准确来源暂不可读', text: null, sha256: null, code, limitations: ['保留准确引用／UNKNOWN，不替换latest，也不据此宣布主张被反驳。'], partial: false, continuation: null };
    }
  }
  function current(context: CaseDecisionAgentContext) { context.signal.throwIfAborted(); context.assertCurrent(); }
  async function agentOwner(context: CaseDecisionAgentContext) {
    current(context);
    if (deps.cases.getStatus().storeId !== context.caseStoreId) throw new CaseStoreError('case_decision_store_mismatch', 409);
    deps.cases.getCase(context.caseId);
    if (!deps.cases.listProjectLinks(context.caseId).some(link => link.projectId === context.projectId)) throw new CaseStoreError('project_not_linked', 409);
    const project = await deps.projects.get(context.projectId); current(context); deps.assertActive(project);
    await deps.projects.getTask(context.projectId, context.taskId); current(context);
    return project;
  }
  async function prepareReferences(caseId: string, references: CaseDecisionReference[], original: CaseDecisionReference[], replayed: boolean, signal?: AbortSignal) {
    const result: CaseDecisionReference[] = [];
    for (const reference of references) {
      signal?.throwIfAborted();
      const target = reference.target;
      const saved = original.find(ref => ref.relation === reference.relation && exactIdentity(ref.target) === exactIdentity(target));
      if (target.type === 'board-task') {
        if (saved?.target.type === 'board-task') {
          if (target.observation && canonical(target.observation) !== canonical(saved.target.observation)) throw new CaseStoreError('case_action_observation_host_owned', 400);
          result.push({ ...reference, target: { ...target, observation: saved.target.observation } }); continue;
        }
        if (target.observation) throw new CaseStoreError('case_action_observation_host_owned', 400);
        if (replayed) { result.push(reference); continue; } // Store digest will reject a different original intent.
        if (!deps.board) throw new CaseStoreError('case_decision_board_unavailable', 503);
        const task = deps.board.getTask(target.taskId), item = deps.board.getItem(task.itemId);
        if (item.sourceKind === 'report-confirmation') { if (!deps.assertBoardItemReadable) throw new CaseStoreError('confirmation_source_unavailable', 409); await deps.assertBoardItemReadable(item); }
        if (item.projectId !== target.projectId || item.id !== target.itemId) throw new CaseStoreError('case_decision_source_project_mismatch', 409);
        if (!deps.cases.listProjectLinks(caseId).some(link => link.projectId === target.projectId)) throw new CaseStoreError('project_not_linked', 409);
        const project = await deps.projects.get(target.projectId); signal?.throwIfAborted(); deps.assertActive(project);
        result.push({ ...reference, target: { ...target, observation: { updatedAt: task.updatedAt, title: task.title, owner: task.owner, dueDate: task.dueDate, status: task.status, note: task.note } } }); continue;
      }
      if (!replayed && target.type !== 'case-decision') {
        if (target.type === 'feedback') {
          if (!deps.cases.listProjectLinks(caseId).some(link => link.projectId === target.sourceProjectId)) throw new CaseStoreError('project_not_linked', 409);
          const project = await deps.projects.get(target.sourceProjectId); signal?.throwIfAborted(); deps.assertActive(project);
        }
        await source(caseId, { target }, signal); // Missing exact prose remains UNKNOWN, never latest.
      }
      result.push(reference);
    }
    return result;
  }
  async function readForAgent(input: unknown, context: CaseDecisionAgentContext) {
    caseDecisionFields(input, ['recordId', 'revision', 'includeArchived', 'history', 'pageSize', 'continuation']);
    if (input.revision !== undefined && (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1) || input.continuation !== undefined && input.continuation !== null && (typeof input.continuation !== 'string' || input.continuation.length > 2000)) throw new CaseStoreError('invalid_case_decision_read');
    await agentOwner(context);
    const details = { type: 'optracall.case-decision-read' as const, action: input.recordId === undefined ? 'list' : 'read', caseStoreId: context.caseStoreId, caseId: context.caseId };
    if (input.recordId === undefined) {
      if (input.revision !== undefined) throw new CaseStoreError('case_decision_id_required');
      const listing = list(context.caseId, input as CaseDecisionListOptions);
      const items = listing.items.map(revision => {
        const chosen = listing.choices.filter(choice => choice.strategyRef.recordId === revision.recordId).at(-1);
        return { recordId: revision.recordId, revision: revision.revision, kind: revision.kind, title: revision.payload.title, lifecycle: revision.lifecycle, actorKind: revision.origin.actorKind,
          ...(chosen ? { latestChoice: { choiceId: chosen.choiceId, revision: chosen.strategyRef.revision, choice: chosen.choice } } : {}) };
      });
      current(context);
      return { text: JSON.stringify({ caseStoreId: listing.caseStoreId, caseId: context.caseId, items, decisionUpdatedAt: listing.decisionUpdatedAt, continuation: listing.continuation }),
        details: { ...details, partial: Boolean(listing.continuation), continuation: listing.continuation } };
    }
    const recordId = caseDecisionId(input.recordId);
    let revisionNumber = input.revision === undefined ? undefined : Number(input.revision), start = 0, expectedSha: string | undefined;
    if (input.continuation) {
      try {
        const cursor = JSON.parse(Buffer.from(String(input.continuation), 'base64url').toString('utf8'));
        if (cursor.caseStoreId !== context.caseStoreId || cursor.caseId !== context.caseId || cursor.recordId !== recordId || !Number.isSafeInteger(cursor.revision) || revisionNumber !== undefined && revisionNumber !== cursor.revision || !Number.isSafeInteger(cursor.next) || cursor.next < 0 || typeof cursor.sha256 !== 'string') throw new Error();
        revisionNumber = cursor.revision; start = cursor.next; expectedSha = cursor.sha256;
      } catch { throw new CaseStoreError('case_decision_continuation_changed', 409); }
    }
    const revision = read(context.caseId, recordId, revisionNumber), body = JSON.stringify(revision), digest = sha(body);
    if (expectedSha && expectedSha !== digest || start >= body.length || !boundary(body, start)) throw new CaseStoreError('case_decision_continuation_changed', 409);
    let end = Math.min(body.length, start + 24000); if (!boundary(body, end)) end--;
    const partial = end < body.length, continuation = partial ? Buffer.from(JSON.stringify({ caseStoreId: context.caseStoreId, caseId: context.caseId, recordId, revision: revision.revision, sha256: digest, next: end })).toString('base64url') : null;
    current(context);
    return { text: partial || start ? `准确Case修订JSON片段 UTF-16 [${start},${end}) / ${body.length}；按continuation继续，不代表已提供全文。\n${body.slice(start, end)}` : body,
      details: { ...details, recordId, revision: revision.revision, partial, continuation } };
  }
  async function saveForAgent(input: unknown, context: CaseDecisionAgentContext) {
    caseDecisionFields(input, ['recordId', 'expectedRevision', 'kind', 'payload', 'references', 'impactNotes', 'changeReason'], ['expectedRevision', 'kind', 'payload']);
    return deps.mutate(async () => {
      const clean = parseCaseDecisionDraft({ ...input, operationId: context.operationId, caseStoreId: context.caseStoreId, caseId: context.caseId });
      const previous = deps.cases.getOperation(context.operationId), replayed = previous?.phase === 'completed';
      const original = replayed ? (previous.result as CaseDecisionRevision).references ?? [] : clean.recordId ? deps.cases.getDecision(clean.caseId, clean.recordId, clean.expectedRevision).references : [];
      const project = replayed ? null : await agentOwner(context);
      const references = await prepareReferences(clean.caseId, clean.references, original, replayed, replayed ? undefined : context.signal);
      if (!replayed) current(context);
      const revision = deps.cases.saveDecisionDraft({ ...clean, references }, { actorKind: 'agent', projectId: context.projectId, taskId: context.taskId, requestId: context.requestId, sessionId: context.sessionId, toolCallId: context.toolCallId },
        { assertWritable: () => { current(context); if (project) deps.assertActive(project); } });
      return { saved: true, caseStoreId: revision.caseStoreId, caseId: revision.caseId, recordId: revision.recordId, revision: revision.revision, lifecycle: revision.lifecycle, operationId: revision.operationId, createdAt: revision.createdAt, actorKind: revision.origin.actorKind };
    });
  }
  async function choose(caseId: string, recordId: string, input: unknown) {
    caseDecisionFields(input, ['operationId', 'caseStoreId', 'strategyRef', 'choice', 'reason', 'expectedPreviousChoiceId', 'allowHistorical'], ['operationId', 'caseStoreId', 'strategyRef', 'choice', 'expectedPreviousChoiceId']);
    const target = parseCaseDecisionRef(input.strategyRef);
    if (target.caseId !== caseId || target.recordId !== recordId) throw new CaseStoreError('case_decision_scope_mismatch', 409);
    // This global Case endpoint does not write a Project. An unrelated archived
    // linked Project must not become a new Case-wide permission owner.
    return deps.mutate(() => deps.cases.chooseStrategy(parseCaseStrategyChoice({ ...input, caseId, strategyRef: target })));
  }
  async function govern(caseId: string, recordId: string, input: unknown) {
    caseDecisionFields(input, ['operationId', 'caseStoreId', 'expectedRevision', 'action', 'reference'], ['operationId', 'caseStoreId', 'expectedRevision', 'action']);
    const command = parseCaseDecisionGovernance({ ...input, caseId, recordId });
    return deps.mutate(async () => {
      const prior = deps.cases.getOperation(caseDecisionId(command.operationId)), replayed = prior?.phase === 'completed';
      if (!replayed) {
        if (deps.cases.getCase(caseId).status === 'closed') throw new CaseStoreError('case_closed', 409);
        const current = deps.cases.getDecision(caseId, recordId);
        if (current.revision !== command.expectedRevision) throw new CaseStoreError('case_decision_revision_conflict', 409);
        if (current.lifecycle === 'archived' && command.action !== 'restore') throw new CaseStoreError('case_decision_archived', 409);
      }
      if (input.reference !== undefined) {
        const reference = command.reference!;
        const original = replayed && command.action === 'add_reference'
          ? (prior.result as CaseDecisionRevision).references ?? []
          : deps.cases.getDecision(caseId, recordId, command.expectedRevision).references;
        command.reference = (await prepareReferences(caseId, [reference], original, replayed || command.action === 'remove_reference'))[0];
      }
      return deps.cases.reviseDecisionByUser(command);
    });
  }
  return { list, read, links, source, readForAgent, saveForAgent, choose, govern };
}

export type CaseDecisionService = ReturnType<typeof createCaseDecisionService>;
