import { CaseStoreError, type CaseStore } from './case-store.ts';
import type { CaseDecisionService } from './case-decision-service.ts';
import type { ProjectRecord, ProjectStore } from './project-store.ts';
import { caseDecisionFields, caseDecisionId } from './case-decision-validation.ts';
import { createHash } from 'node:crypto';
import { canonical } from './project-data-context-io.ts';
import type { CaseLearningSourceRef, LearningSourceReadOptions } from './learning-source-types.ts';
import { learningSourceRef } from './learning-source-validation.ts';
import type { PersonalSourceEvidence } from './personal-retention-types.ts';
import { createNativeSnapshotReadBudget } from './native-session-snapshot.ts';

export type CaseSourcesReadOptions = LearningSourceReadOptions & { assertCurrent?: () => void };
export type CaseSourcesAgentContext = { projectId: string; taskId: string; signal: AbortSignal; assertCurrent: () => void };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const boundary = (text: string, position: number) => !(position > 0 && position < text.length && /[\uD800-\uDBFF]/.test(text[position - 1]!) && /[\uDC00-\uDFFF]/.test(text[position]!));
const current = (options: CaseSourcesReadOptions) => { options.signal?.throwIfAborted(); options.assertCurrent?.(); };
const checkTransport = <T extends { text: string }>(result: T): T => {
  if (result.text.length > 32_768 || Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new CaseStoreError('case_sources_budget_exceeded', 413);
  return result;
};
const visible = (body: string, metadata: unknown) => `准确Case来源JSON；片段范围采用UTF-16半开区间，partial为真时不代表全文。\n${JSON.stringify(metadata)}\n${body}`;

export type CaseSourcesServiceDependencies = {
  cases: CaseStore;
  projects: Pick<ProjectStore, 'get' | 'getTask'>;
  assertActive: (project: ProjectRecord) => void;
  readReference?: CaseDecisionService['source'];
};
/** Cross-Case reads use the original global Case authority, never an invented write owner. */
export function createCaseSourcesService(deps: CaseSourcesServiceDependencies) {
  function exact(raw: unknown): CaseLearningSourceRef {
    const target = learningSourceRef(raw);
    if (target.type !== 'case-decision' && target.type !== 'case-choice') throw new CaseStoreError('invalid_case_sources_target');
    if (target.caseStoreId !== deps.cases.getStatus().storeId) throw new CaseStoreError('case_sources_store_mismatch', 409);
    return target;
  }
  async function readPersonalSource(raw: CaseLearningSourceRef, options: LearningSourceReadOptions = {}): Promise<PersonalSourceEvidence> {
    current(options);
    const ref = exact(raw), value = ref.type === 'case-decision' ? deps.cases.getDecision(ref.caseId, ref.recordId, ref.revision) : deps.cases.getStrategyChoice(ref.caseId, ref.choiceId);
    const body = JSON.stringify(value, null, 2);
    let text = body;
    if (ref.excerpt) {
      const { start, end } = ref.excerpt;
      if (start < 0 || end <= start || end > body.length || !boundary(body, start) || !boundary(body, end)) throw new CaseStoreError('invalid_personal_excerpt');
      text = body.slice(start, end);
    }
    current(options);
    const record = deps.cases.getCase(ref.caseId), head = ref.type === 'case-decision' ? deps.cases.getDecision(ref.caseId, ref.recordId) : null;
    return { ref, title: 'payload' in value ? `${value.payload.title} · v${value.revision}` : `人的取舍 · ${value.choice}`, text, sha256: sha(body), status: 'available',
      caseGovernance: { caseStatus: record.status, currentRevision: head?.revision ?? null, lifecycle: head?.lifecycle ?? null },
      ...('strategyRef' in value ? { strategyRef: value.strategyRef } : {}) };
  }
  async function read(input: unknown, options: CaseSourcesReadOptions = {}) {
    current(options);
    caseDecisionFields(input, ['target', 'part', 'sourceIndex', 'continuation'], ['target']);
    const target = exact(input.target), part = input.part ?? 'content';
    if (target.excerpt !== undefined || !['content', 'reference'].includes(String(part)) || (part === 'reference' ? target.type !== 'case-decision' || !Number.isSafeInteger(input.sourceIndex) || Number(input.sourceIndex) < 0 : input.sourceIndex !== undefined)) throw new CaseStoreError('invalid_case_sources_read');
    if (input.continuation !== undefined && input.continuation !== null && (typeof input.continuation !== 'string' || input.continuation.length > 4000)) throw new CaseStoreError('invalid_case_sources_continuation');
    try {
      if (part === 'reference' && target.type === 'case-decision') {
        const card = deps.cases.getDecision(target.caseId, target.recordId, target.revision), reference = card.references[Number(input.sourceIndex)];
        if (!reference) throw new CaseStoreError('invalid_case_sources_source_index');
        if (!deps.readReference) throw new CaseStoreError('case_sources_reference_unavailable', 503);
        const identity = sha(canonical({ target, part, sourceIndex: input.sourceIndex }));
        let sourceContinuation: string | null = null, start = 0, expectedSha: string | null = null;
        if (input.continuation) {
          try {
            const cursor = JSON.parse(Buffer.from(String(input.continuation), 'base64url').toString('utf8'));
            if (cursor.identity !== identity || !(cursor.sourceContinuation === null || typeof cursor.sourceContinuation === 'string') || !Number.isSafeInteger(cursor.next) || cursor.next < 0 || !(cursor.sha256 === null || typeof cursor.sha256 === 'string')) throw new Error();
            sourceContinuation = cursor.sourceContinuation; start = cursor.next; expectedSha = cursor.sha256;
          } catch { throw new CaseStoreError('case_sources_continuation_changed', 409); }
        }
        const source = await deps.readReference(target.caseId, { target: reference.target, continuation: sourceContinuation }, options.signal,
          { ...options, audience: options.audience ?? 'agent', budget: options.budget ?? createNativeSnapshotReadBudget() });
        current(options);
        // M5 remains the accurate source/chunk authority. This outer JSON page
        // only fits its text plus observation metadata into the shared output
        // budget, including when an M4 source already occupies a complete page.
        const body = JSON.stringify({ reference, status: source.status, title: source.title, observation: source.observation ?? null,
          limitations: source.limitations, sourceRange: source.range ?? null, current: source.current ?? null,
          text: source.text ?? '准确来源暂不可读；保留UNKNOWN，不替换latest。' });
        const digest = sha(body);
        if (expectedSha !== null && digest !== expectedSha || start >= body.length || !boundary(body, start)) throw new CaseStoreError('case_sources_continuation_changed', 409);
        let end = Math.min(body.length, start + 24_000); if (!boundary(body, end)) end--;
        const continuation = end < body.length ? Buffer.from(JSON.stringify({ identity, sourceContinuation, next: end, sha256: digest })).toString('base64url')
          : source.continuation ? Buffer.from(JSON.stringify({ identity, sourceContinuation: source.continuation, next: 0, sha256: null })).toString('base64url') : null;
        const range = { start, end, total: body.length }, partial = Boolean(continuation);
        return checkTransport({ text: visible(body.slice(start, end), { target, part, sourceIndex: Number(input.sourceIndex), status: source.status, range, sourceRange: source.range ?? null, partial, continuation }), details: {
          type: 'optracall.case-source-read' as const, action: 'read' as const, target, part, sourceIndex: Number(input.sourceIndex), reference: { relation: reference.relation, target: reference.target },
          status: source.status, title: source.title, sha256: source.sha256, range, sourceRange: source.range ?? null, observation: source.observation ?? null,
          partial, continuation, current: source.current ?? null, limitations: source.limitations, ...(source.code ? { code: source.code } : {}) } });
      }
      const evidence = await readPersonalSource(target, options);
      const body = evidence.text!, digest = sha(body), identity = sha(canonical({ target, part, sourceIndex: input.sourceIndex ?? null }));
      let start = 0;
      if (input.continuation) {
        try {
          const cursor = JSON.parse(Buffer.from(String(input.continuation), 'base64url').toString('utf8'));
          if (cursor.identity !== identity || cursor.sha256 !== digest || !Number.isSafeInteger(cursor.next) || cursor.next < 0 || cursor.next >= body.length || !boundary(body, cursor.next)) throw new Error();
          start = cursor.next;
        } catch { throw new CaseStoreError('case_sources_continuation_changed', 409); }
      }
      let end = Math.min(body.length, start + 24_000); if (!boundary(body, end)) end--;
      const partial = end < body.length, continuation = partial ? Buffer.from(JSON.stringify({ identity, sha256: digest, next: end })).toString('base64url') : null;
      current(options);
      const head = target.type === 'case-decision' ? deps.cases.getDecision(target.caseId, target.recordId) : null;
      return checkTransport({ text: visible(body.slice(start, end), { target, part, range: { start, end, total: body.length }, partial, continuation, caseGovernance: evidence.caseGovernance, ...(evidence.strategyRef ? { strategyRef: evidence.strategyRef } : {}) }), details: { type: 'optracall.case-source-read' as const, action: 'read' as const, target, part, title: evidence.title, status: 'available' as const,
        sha256: evidence.sha256, range: { start, end, total: body.length }, partial, continuation, ...(evidence.strategyRef ? { strategyRef: evidence.strategyRef } : {}),
        current: head ? { revision: head.revision, lifecycle: head.lifecycle } : null,
        limitations: ['判断、人的取舍、执行及效果分别核对；业务时间不从保存时间推定。'] } });
    } catch (error) {
      current(options);
      const code = typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code) : 'case_sources_unavailable';
      if (/invalid_|mismatch|continuation|budget|excluded|forbidden/.test(code)) throw error;
      return { text: '准确来源暂不可读；保留UNKNOWN，不替换latest。', details: { type: 'optracall.case-source-read' as const, action: 'read' as const, target, part, status: 'unknown' as const, code, partial: false, continuation: null } };
    }
  }
  async function find(input: unknown = {}, options: CaseSourcesReadOptions = {}) {
    current(options);
    caseDecisionFields(input, ['query', 'caseId', 'includeArchived', 'pageSize', 'continuation']);
    const query = input.query ?? '', pageSize = input.pageSize ?? 20, includeArchived = input.includeArchived ?? false;
    if (typeof query !== 'string' || [...query].length > 200 || query.includes('\0') || typeof includeArchived !== 'boolean' || !Number.isSafeInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 50) throw new CaseStoreError('invalid_case_sources_page');
    const caseId = input.caseId === undefined ? undefined : caseDecisionId(input.caseId);
    const marker = deps.cases.getDecisionSourceDirectoryMarker(caseId), identity = createHash('sha256').update(canonical({ query, caseId: caseId ?? null, includeArchived, pageSize })).digest('hex');
    let offset = 0;
    if (input.continuation !== undefined && input.continuation !== null) {
      try {
        if (typeof input.continuation !== 'string' || input.continuation.length > 4000) throw new Error();
        const cursor = JSON.parse(Buffer.from(input.continuation, 'base64url').toString('utf8'));
        if (cursor.identity !== identity || cursor.marker !== marker || !Number.isSafeInteger(cursor.offset) || cursor.offset < 1) throw new Error();
        offset = cursor.offset;
      } catch { throw new CaseStoreError('case_sources_continuation_changed', 409); }
    }
    const rows = deps.cases.listDecisionSourceEntries({ query, includeArchived, caseId, offset, pageSize: Number(pageSize) + 1 });
    if (deps.cases.getDecisionSourceDirectoryMarker(caseId) !== marker) throw new CaseStoreError('case_sources_continuation_changed', 409);
    const items = rows.slice(0, Number(pageSize));
    const result = () => ({ caseStoreId: deps.cases.getStatus().storeId, items, continuation: rows.length > items.length
      ? Buffer.from(JSON.stringify({ identity, marker, offset: offset + items.length })).toString('base64url') : null });
    while (JSON.stringify(result()).length > 30_000 && items.length > 1) items.pop();
    current(options);
    return result();
  }
  async function qualify(context: CaseSourcesAgentContext): Promise<CaseSourcesReadOptions> {
    current(context);
    const project = await deps.projects.get(context.projectId); current(context); deps.assertActive(project);
    await deps.projects.getTask(context.projectId, context.taskId); current(context);
    return { ...context, audience: 'agent', budget: createNativeSnapshotReadBudget() };
  }
  async function findForAgent(input: unknown, context: CaseSourcesAgentContext) {
    const options = await qualify(context), result = await find(input, options); current(options);
    return checkTransport({ text: JSON.stringify(result), details: { type: 'optracall.case-source-read' as const, action: 'find' as const, partial: Boolean(result.continuation), continuation: result.continuation } });
  }
  async function readForAgent(input: unknown, context: CaseSourcesAgentContext) {
    const options = await qualify(context), result = await read(input, options); current(options); return result;
  }
  return { find, read, readPersonalSource, findForAgent, readForAgent };
}
export type CaseSourcesService = ReturnType<typeof createCaseSourcesService>;
