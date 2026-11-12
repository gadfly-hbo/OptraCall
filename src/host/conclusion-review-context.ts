import { createHash } from 'node:crypto';
import type { ConclusionReviewContextEvidence, ConclusionReviewRecord } from './conclusion-review-contract.ts';
import { suppliedRequest, type VerificationRuntimeEvidence } from './verification-context.ts';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : object(value)
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);

/** Read-time projection of the original SDK journal, never a second receipt store. */
export function conclusionReviewContextEvidence(record: ConclusionReviewRecord, runtime: VerificationRuntimeEvidence): ConclusionReviewContextEvidence {
  const sessionFile = record.reviewResult?.sessionFile ?? record.native?.sessionFile;
  const evidence: ConclusionReviewContextEvidence = {
    prepared: record.preparedAt ? { status: 'fixed', note: '所列报告、材料与计划提供范围已固定；固定或准备完成不证明已送入审查会话。' } : { status: 'incomplete', note: '本次选择及计划范围已记录，完整固定尚未核定；不能视为实际提供。' },
    provided: { status: runtime.native ? 'unrecorded' : sessionFile ? 'unavailable' : 'unrecorded', fragments: [],
      note: '尚无身份及整包摘要匹配的原生请求正文证据，实际提供范围未知；不从准备包或当前文件补造。' },
    reads: { status: 'unproven', note: '本角色没有文件读取或执行工具。原生请求正文只能证明向审查会话提供了材料，不能证明模型已读取、理解、核查或采用。' },
  };
  if (!sessionFile || [record.reviewResult?.requestId, record.native?.requestId].some(id => id !== undefined && id !== record.verificationId) ||
    [record.reviewResult?.sessionFile, record.native?.sessionFile].some(file => file !== undefined && file !== sessionFile)) return evidence;
  const supplied = suppliedRequest(record, runtime.native, { requestId: record.verificationId, sessionFile });
  if (!supplied?.requestText || supplied.requestText !== record.review.providedText || hash(supplied.requestText) !== record.review.providedTextSha256) return evidence;
  let packet: unknown;
  try { packet = JSON.parse(supplied.requestText); } catch { return evidence; }
  if (!object(packet) || packet.schemaVersion !== 1 || canonical(packet.report) !== canonical(record.review.report) ||
    canonical(packet.materials) !== canonical(record.review.materials) || !Array.isArray(packet.content)) return evidence;
  const materials = new Map(record.review.materials.map(material => [material.id, material]));
  const fragments: ConclusionReviewContextEvidence['provided']['fragments'] = [], seen = new Set<string>();
  for (const raw of packet.content) {
    if (!object(raw) || typeof raw.id !== 'string' || typeof raw.text !== 'string' || seen.has(raw.id)) return evidence;
    seen.add(raw.id);
    const material = materials.get(raw.id), range = material?.rangeUtf16;
    if (!material || !['provided','truncated'].includes(material.state) || !range || raw.text.length !== range.end - range.start) return evidence;
    fragments.push({ ...material, text: raw.text });
  }
  const report = fragments.find(fragment => fragment.id === 'report');
  if (!report || report.rangeUtf16?.start !== 0 || report.rangeUtf16.end !== report.rangeUtf16.total || hash(report.text) !== record.review.report.sha256) return evidence;
  evidence.provided = { status: 'recorded', requestId: supplied.requestId, sessionId: supplied.sessionId,
    ...(supplied.messageId ? { messageId: supplied.messageId } : {}), requestTextSha256: hash(supplied.requestText), fragments,
    note: '来自本审查原生会话中准确请求身份及整包SHA匹配的实际用户正文；只证明所列文字被提供给审查会话，不证明理解、核查或采用。' };
  return evidence;
}
