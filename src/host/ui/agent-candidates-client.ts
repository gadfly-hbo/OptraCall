import type { ExactCandidateRef, CandidateControlInput, CandidateControlEvent, CandidateControlState } from '../agent-candidate-controls.ts';
import { personalJsonEqual, request } from './personal-retention-client.ts';

import type { CandidateParentState, CandidateRow, CandidateLookupInput, CandidateLookupResult } from '../agent-candidate-reader.ts';
export type { CandidateParentState, CandidateRow, CandidateLookupInput, CandidateLookupResult } from '../agent-candidate-reader.ts';
export type CandidateView = NonNullable<CandidateLookupInput['view']>;
export type CandidateOperationRead = { storeId: string; event: CandidateControlEvent | null; state: CandidateControlState | null };
export type CandidateWriteResult = CandidateOperationRead & { event: CandidateControlEvent; state: CandidateControlState; replayed: boolean };
const prefix = '/api/personal-retention/candidates';
export const agentCandidatesApi = {
  lookup(input: CandidateLookupInput): Promise<CandidateLookupResult> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) if (value !== undefined) query.set(key, String(value));
    return request(`${prefix}/lookup?${query}`);
  },
  read: (ref: ExactCandidateRef) => request<CandidateRow>(`${prefix}/read`, 'POST', { ref }),
  control: (input: CandidateControlInput) => request<CandidateWriteResult>(`${prefix}/controls`, 'POST', input),
  operation: (operationId: string) => request<CandidateOperationRead>(`${prefix}/operations/${encodeURIComponent(operationId)}`),
};
export type AgentCandidatesApi = typeof agentCandidatesApi;
/** After an old receipt or source failure, only a fresh governance read can supply current flags. */
export async function readCandidateAfterOperation(api: Pick<AgentCandidatesApi, 'operation' | 'read'>, row: CandidateRow, operationId: string): Promise<CandidateRow> {
  if (!row.ref) throw new Error('准确候选引用尚未核对。');
  const latest = await api.operation(operationId);
  if (!latest.event || !latest.state) throw new Error('原操作回执尚未核对；保留原请求。');
  try { return await api.read(row.ref); }
  catch {
    return { ...row, control: latest.state, details: null, status: 'unknown', reason: '原生来源未能精确回读；人的最新操作已核定', parentState: 'unknown', locations: [] };
  }
}


type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const journalKey = 'optracall.agent-candidates.pending.v1';
/** Human request identities/notes only. No candidate payload, model state or automatic replay. */
export function createCandidateOperationJournal(storage?: JournalStorage) {
  let memory: CandidateControlInput[] = [];
  function read(): CandidateControlInput[] {
    if (!storage) return structuredClone(memory);
    const raw = storage.getItem(journalKey);
    if (raw === null) return [];
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('候选原操作记录不可读，请保留现场并核对原回执。'); }
    if (!Array.isArray(parsed) || parsed.some(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
      const input = value as Record<string, unknown>, target = input.target as Record<string, unknown> | undefined;
      return Object.keys(input).length !== (input.action === 'correct' ? 4 : 5) || Object.keys(input).some(key => !['operationId', 'target', 'action', 'note', 'expectedTargetRevision'].includes(key)) || typeof input.operationId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.operationId) || !['bookmark', 'unbookmark', 'correct', 'exclude', 'restore'].includes(String(input.action))
        || !target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).length !== 6 || Object.keys(target).some(key => !['projectId', 'taskId', 'originSessionId', 'entryId', 'toolCallId', 'expectedDetailsSha256'].includes(key)) || ['projectId', 'taskId', 'originSessionId', 'entryId', 'toolCallId'].some(key => typeof target[key] !== 'string' || !(target[key] as string).trim() || (target[key] as string).length > 1024 || /[\u0000-\u001f\u007f]/.test(target[key] as string))
        || typeof target.expectedDetailsSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(target.expectedDetailsSha256)
        || (input.action === 'correct' ? typeof input.note !== 'string' || !input.note.trim() || input.note.length > 4000 || input.note.includes('\0') || 'expectedTargetRevision' in input : input.note !== null || !Number.isSafeInteger(input.expectedTargetRevision) || Number(input.expectedTargetRevision) < 0);
    })) throw new Error('候选原操作记录不可读，请保留现场并核对原回执。');
    const values = parsed as CandidateControlInput[];
    if (new Set(values.map(value => value.operationId)).size !== values.length) throw new Error('候选原操作标识重复，请保留现场。');
    return structuredClone(values);
  }
  const write = (values: CandidateControlInput[]) => { if (storage) storage.setItem(journalKey, JSON.stringify(values)); else memory = structuredClone(values); };
  return {
    entries: read,
    remember(input: CandidateControlInput) {
      const entries = read(), previous = entries.find(value => value.operationId === input.operationId);
      if (previous && !personalJsonEqual(previous, input)) throw new Error('同一操作须保留原请求，不能更改意见或目标。');
      if (!previous) write([...entries, structuredClone(input)]);
    },
    settle(operationId: string) { write(read().filter(value => value.operationId !== operationId)); },
  };
}
