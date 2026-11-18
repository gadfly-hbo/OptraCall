import type { MethodIssueCallContext, MethodIssueResult } from '../agent/method-issue.ts';
import type { SapMethodIssueOrigin, SapMethodSource } from '../../extensions/business-plugins/metric-factory/methods/types.ts';
import type { SapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';

export type MethodIssueHostContext = MethodIssueCallContext & { operationId: string; projectId: string; taskId: string };
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
const canonical = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);

/** Narrow writeback to the existing SAP method authority; no sessions, extraction or publication. */
export function createMethodIssueAdapter(options: {
  methods: SapMethodStore;
  admit(context: MethodIssueHostContext): void | Promise<void>;
  sourceAllowed(methodId: string, version: number, context: MethodIssueHostContext): boolean | Promise<boolean>;
  qualifySources(sources: readonly SapMethodSource[], context: MethodIssueHostContext): void | Promise<void>;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>;
}) {
  return async (input: Record<string, unknown>, context: MethodIssueHostContext): Promise<MethodIssueResult> => {
    const check = () => { context.signal.throwIfAborted(); context.assertCurrent(); };
    check();
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['methodId', 'version', 'expectedRevision', 'note', 'sources'].includes(key)) || typeof input.methodId !== 'string' || !Number.isSafeInteger(input.version) || Number(input.version) < 1 || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0 || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 20000 || !Array.isArray(input.sources) || !input.sources.length || input.sources.length > 32) fail('invalid_method_issue');
    const sources: SapMethodSource[] = (input.sources as unknown[]).map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid_method_issue_source');
      const source = value as Record<string, unknown>;
      if (Object.keys(source).some(key => !['type', 'label', 'ref', 'version', 'sha256'].includes(key)) || !['session', 'report', 'memory', 'method'].includes(String(source.type)) || typeof source.label !== 'string' || source.label.length > 500 || typeof source.ref !== 'string' || !source.ref.trim() || source.ref.length > 8000 || typeof source.version !== 'string' || !source.version.trim() || source.version.length > 500 || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) return fail('invalid_method_issue_source');
      return { type: source.type as SapMethodSource['type'], label: source.label, ref: source.ref, version: source.version, sha256: source.sha256 };
    });
    const methodId = input.methodId as string, version = Number(input.version);
    const origin: SapMethodIssueOrigin = { actorKind: 'agent', projectId: context.projectId, taskId: context.taskId, requestId: context.requestId, sessionId: context.sessionId, toolCallId: context.toolCallId };
    await options.admit(context); check();
    if (!await options.sourceAllowed(methodId, version, context)) fail('method_issue_source_forbidden');
    options.methods.getPublished(methodId, version);
    check(); await options.qualifySources(sources, context); check();
    const previous = options.methods.read(methodId, version).governance.find(row => row.requestId === context.operationId);
    let pinnedOrigin = origin;
    if (previous?.origin) {
      const { toolCallId: _nextCall, ...next } = origin, { toolCallId: _firstCall, ...first } = previous.origin;
      if (canonical(next) !== canonical(first) || canonical(sources) !== canonical(previous.sources)) fail('method_issue_operation_conflict');
      pinnedOrigin = previous.origin;
    }
    try {
      const saved = await options.mutate(async () => {
        check(); await options.admit(context); check();
        if (!await options.sourceAllowed(methodId, version, context)) fail('method_issue_source_forbidden');
        options.methods.getPublished(methodId, version);
        check();
        return options.methods.markIssue(methodId, { requestId: context.operationId, version, expectedRevision: Number(input.expectedRevision), status: 'suspected', note: input.note as string }, { origin: pinnedOrigin, sources, assertWritable: check });
      });
      const issue = saved.governance.find(row => row.requestId === context.operationId);
      const details = { type: 'optracall.method-issue', status: 'saved', operationId: context.operationId, methodId, version, governanceRevision: issue?.revision, issueStatus: 'suspected', claim: 'agent-reported-not-confirmed; original method versions and publications preserved' };
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if ((error as { name?: string }).name === 'AbortError' || code === 'generation_cancelled' || code?.startsWith('METHOD_') || code?.startsWith('method_issue_')) throw error;
      const details = { type: 'optracall.method-issue', status: 'unknown', operationId: context.operationId, methodId, version, claim: 'Read the original method operation before retry; no new method or operation id was created.' };
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    }
  };
}
