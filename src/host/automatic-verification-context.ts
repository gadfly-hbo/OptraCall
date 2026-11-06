import { VerificationStoreError } from './verification-store.ts';
import { OUTPUT_EVIDENCE_GUIDANCE } from '../agent/output-evidence.ts';
import { AUTOMATIC_FEEDBACK_EVIDENCE_GUIDANCE } from './verification-context.ts';

type FixedResult = { text: string; file: string; sha256: string };
export type AutomaticAuthorContextInput = {
  question: string; report: { version: number; path: string; fixedPath: string; sha256: string };
  authorTurn: { number: number; limit: number };
  coldResult: FixedResult; opinion: FixedResult; output: { reportPath: string };
};
export type AutomaticRecheckContextInput = { version: number; sha256: string; fixedPath: string; processPath: string; text: string };
type Fragment = { start: 0; end: number; totalLength: number; text: string };
const LIMIT = 20_000;
const authorPrefix = '自动核算意见已交回原主Agent\n';
const recheckPrefix = '修订复查（已知作者信息，不是新冷读）\n';
const identity = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const version = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
function endAt(text: string, requested: number): number {
  let end = Math.min(text.length, requested);
  if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end--;
  return end;
}
function fragment(text: string): Fragment { return { start: 0, end: 0, totalLength: text.length, text: '' }; }

/** Budget the serialized envelope, not just raw fragments. Identity and scope
 * explanations are never sliced, including when JSON escaping expands text. */
function bounded(compose: () => string, parts: { source: string; target: Fragment; cap: number }[], code: string): string {
  if (compose().length > LIMIT) throw new VerificationStoreError(code, 400);
  for (const { source, target, cap } of parts) {
    let low = 0, high = Math.min(source.length, cap), best = 0;
    while (low <= high) {
      const midpoint = Math.floor((low + high) / 2), end = endAt(source, midpoint);
      target.end = end; target.text = source.slice(0, end);
      if (compose().length <= LIMIT) { best = end; low = midpoint + 1; } else high = midpoint - 1;
    }
    target.end = best; target.text = source.slice(0, best);
  }
  return compose();
}

export function automaticAuthorContext(input: AutomaticAuthorContextInput): string {
  if (!input || typeof input.question !== 'string' || !version(input.report?.version) || !identity(input.report?.path) || !identity(input.report?.fixedPath) || !hash(input.report?.sha256)
    || !version(input.authorTurn?.number) || ![1, 2, 3].includes(input.authorTurn?.limit) || input.authorTurn.number > input.authorTurn.limit
    || !identity(input.output?.reportPath) || ![input.coldResult, input.opinion].every(v => v && typeof v.text === 'string' && identity(v.file) && hash(v.sha256))) {
    throw new VerificationStoreError('invalid_automatic_author_context', 400);
  }
  const coldResult = { file: input.coldResult.file, sha256: input.coldResult.sha256, ...fragment(input.coldResult.text) };
  const opinion = { file: input.opinion.file, sha256: input.opinion.sha256, ...fragment(input.opinion.text) };
  const packet = {
    operation: 'automatic-author-feedback', question: input.question,
    report: { version: input.report.version, path: input.report.path, fixedPath: input.report.fixedPath, sha256: input.report.sha256 },
    authorTurn: { ...input.authorTurn, remainingAfterAccept: input.authorTurn.limit - input.authorTurn.number },
    coldResult, opinion, output: { reportPath: input.output.reportPath },
    outputEvidenceGuidance: OUTPUT_EVIDENCE_GUIDANCE,
    feedbackEvidenceGuidance: AUTOMATIC_FEEDBACK_EVIDENCE_GUIDANCE,
    note: '本请求主动提供的文字范围为各结果的[start,end)/totalLength，按UTF-16计；每段最多5000，实际还受完整消息20000限制，可能更短或为0。file与SHA指向完整固定结果，片段不表示全文已读。核算意见可能有误报或新增错误，请由原主Agent自主核查、计算和判断；可以改稿、不改稿、有依据地反驳或保留未知。需要修改时另存到所给新增报告位置，原件只读；不要求固定方法、工具、报告模板或检查数量。',
  };
  return bounded(() => authorPrefix + JSON.stringify(packet), [
    { source: input.coldResult.text, target: coldResult, cap: 5000 },
    { source: input.opinion.text, target: opinion, cap: 5000 },
  ], 'automatic_author_context_too_large');
}

export function automaticRecheckContext(input: AutomaticRecheckContextInput): string {
  if (!input || !version(input.version) || !hash(input.sha256) || !identity(input.fixedPath) || !identity(input.processPath) || typeof input.text !== 'string') {
    throw new VerificationStoreError('invalid_automatic_recheck_context', 400);
  }
  const packet = {
    operation: 'automatic-recheck', version: input.version, sha256: input.sha256,
    fixedPath: input.fixedPath, processPath: input.processPath, ...fragment(input.text),
    note: '这是已知作者信息后的修订复查，不是新冷读。fixedPath与SHA定位本版本完整固定稿；[start,end)/totalLength仅为本请求主动提供的UTF-16范围。完整序列化消息限20000字符，全文能装下时完整提供，否则仅提供预算内最大合法连续前缀；主动提供不表示已读或已核查全文。源数据、旧稿和固定新稿只读。processPath只定位作者计算目录，内容未逐项固定，不表示全部可读或已核查。请自主复查前次分歧、新稿重要内容及新增主张，说明实际依据、范围和未知；可以一致或无需新增，不要求固定方法、工具、步骤或检查数量。',
  };
  return bounded(() => recheckPrefix + JSON.stringify(packet), [{ source: input.text, target: packet, cap: LIMIT }], 'automatic_recheck_context_too_large');
}
