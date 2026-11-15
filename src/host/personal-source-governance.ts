import type { PersonalSourceGovernance } from '../agent/personal-context.ts';
import { CandidateControlError, candidateControlState, candidateOccurrenceKey, type AgentCandidateControls, type CandidateControlRecords } from './agent-candidate-controls.ts';
import type { LearningSourceRef } from './learning-source-types.ts';
import type { PersonalContextResult } from './personal-context-types.ts';
import { PersonalContextError } from './personal-context-validation.ts';

const clip = (text: string, limit: number) => {
  let end = Math.max(0, Math.min(text.length, limit));
  if (end && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end] ?? '')) end--;
  return text.slice(0, end);
};
type State = Omit<PersonalSourceGovernance['items'][number], 'sourceIndex'>;

/** One read/prepare snapshot of the existing ledger. Never reads candidate content. */
export function createSourceGovernanceOperation(controls: AgentCandidateControls, signal?: AbortSignal, selections = 1) {
  let records: Promise<CandidateControlRecords | null> | undefined;
  const inspected = new Map<string, State>();
  let remainingText = 4096, remainingSelections = selections;
  const abort = () => { if (signal?.aborted) throw new PersonalContextError('personal_context_cancelled', 409); };
  async function read(refs: LearningSourceRef[]): Promise<PersonalSourceGovernance | undefined> {
    const result: PersonalSourceGovernance = { totalReferences: 0, inspectedReferences: 0, uncheckedReferences: 0, sourceBodyAvailability: 'not-checked', items: [] };
    const seen = new Set<string>();
    for (const [sourceIndex, ref] of refs.entries()) {
      if (ref.type !== 'agent-candidate') continue;
      result.totalReferences++;
      const key = candidateOccurrenceKey(ref.candidate) + ':' + ref.candidate.expectedDetailsSha256;
      let state = inspected.get(key);
      if (!state && inspected.size < 8) {
        abort();
        try {
          records ??= controls.getRecords();
          const snapshot = await records; abort();
          const current = candidateControlState(snapshot, ref.candidate), note = current.notes[0];
          state = { state: current.targetRevision ? 'known' : 'no-controls', reason: null, excluded: current.targetRevision ? current.excluded : null, targetRevision: current.targetRevision, latestCorrectionOperationId: note?.operationId ?? null, correction: current.excluded ? null : note?.note ?? null, correctionTruncated: false };
        } catch (error) {
          abort();
          state = { state: 'unknown', reason: error instanceof CandidateControlError && error.code === 'candidate_control_target_changed' ? 'exact-reference-conflict' : 'ledger-unavailable', excluded: null, targetRevision: null, latestCorrectionOperationId: null, correction: null, correctionTruncated: false };
        }
        inspected.set(key, state);
      }
      if (!state) { result.uncheckedReferences++; continue; }
      result.inspectedReferences++;
      if (!seen.has(key)) { result.items.push({ sourceIndex, ...state }); seen.add(key); }
    }
    abort();
    return result.totalReferences ? result : undefined;
  }
  // Every selection reserves its equal share before note excerpts can consume it.
  // At most eight compact status rows fit each 512-unit minimum reservation.
  function allocate(summary: PersonalSourceGovernance | undefined) {
    const quota = Math.floor(remainingText / remainingSelections--);
    if (!summary) return;
    const originals = summary.items.map(item => item.correction);
    minimizeSourceGovernance(summary);
    if (sourceGovernanceText(summary).length > quota) throw new PersonalContextError('personal_context_metadata_too_large', 413);
    for (const [index, original] of originals.entries()) {
      if (!original) continue;
      const item = summary.items[index]!;
      item.correction = '';
      const room = quota - sourceGovernanceText(summary).length;
      if (room > 0) item.correction = clip(original, room);
      else item.correction = null;
      item.correctionTruncated = item.correction !== original;
    }
    remainingText -= sourceGovernanceText(summary).length;
  }
  return { read, allocate };
}

export function minimizeSourceGovernance(summary: PersonalSourceGovernance) {
  for (const item of summary.items) {
    if (item.correction !== null) item.correctionTruncated = true;
    item.correction = null;
  }
}

/** The actual model-visible reminder; metadata alone does not deliver it. */
export function sourceGovernanceText(summary: PersonalSourceGovernance): string {
  const rows = summary.items.map(item => {
    const state = item.state === 'unknown' ? `UNKNOWN（${item.reason === 'exact-reference-conflict' ? '准确引用冲突' : '治理账不可用'}）` : item.state === 'no-controls' ? '无控制记录' : item.excluded ? '已排除' : '未排除';
    const correction = !item.latestCorrectionOperationId ? '' : item.correction === null
      ? `／纠正:${item.latestCorrectionOperationId}`
      : `／纠正 ${item.latestCorrectionOperationId}（${item.correctionTruncated ? '片段，已截短' : '完整注记'}）：${item.correction}`;
    return `[${item.sourceIndex}]${state}${correction}`;
  });
  return `\n\n来源治理提醒：已查${summary.inspectedReferences}/${summary.totalReferences}条候选引用；未查${summary.uncheckedReferences}=UNKNOWN。来源正文可用性未核；无控制记录不证明来源存在或可靠，经验自身治理独立。注记未列文字即未提供。\n${rows.join('\n')}`;
}

/** Drop only optional correction text when a fixed selection hits its old cap. */
export function minimizeSourceGovernanceResult(result: PersonalContextResult) {
  const summary = result.details.items[0]?.sourceGovernance;
  if (!summary) return;
  const suffix = sourceGovernanceText(summary);
  if (!result.text.endsWith(suffix)) throw new Error('personal_source_governance_suffix_mismatch');
  minimizeSourceGovernance(summary);
  result.text = result.text.slice(0, -suffix.length) + sourceGovernanceText(summary);
}
