import path from 'node:path';
import { createHash } from 'node:crypto';
import { VerificationStoreError, type VerificationRecord } from './verification-store.ts';

export type VerificationMaterialPreview = {
  relativePath: string; sha256: string; bytes: number; sourcePath?: string;
  textStatus: 'utf8' | 'not-utf8'; totalLength?: number;
};
export type VerificationSelectedMaterials = { dataFiles: VerificationMaterialPreview[]; authorFiles: VerificationMaterialPreview[] };
export type VerificationAuthorFragment = {
  relativePath: string; sha256: string; bytes: number; fixedPath: string;
  textStatus: 'utf8' | 'not-utf8'; start: number | null; end: number | null;
  totalLength: number | null; text: string | null;
};
export type VerificationAuthorPreview = {
  path: string; sha256: string; bytes: number; fixedPath: string; text: string;
  textStatus: 'utf8' | 'not-utf8'; start: number | null; end: number | null;
  totalLength: number | null; truncated: boolean;
};
export type VerificationReadClue = {
  requestId: string; toolCallId?: string; toolName: string; relativePath: string;
  offset?: number; limit?: number; outcome: 'started' | 'completed' | 'failed'; note: string;
};
export type VerificationContextEvidence = {
  provided: {
    status: 'recorded' | 'unrecorded' | 'unavailable'; requestId?: string; sessionFile?: string;
    messageId?: string; requestText?: string; fragments: VerificationAuthorFragment[]; note: string;
  };
  reads: { status: 'observed' | 'unrecorded' | 'unavailable'; items: VerificationReadClue[]; note: string };
  revisionAssociation: {
    status: 'recorded' | 'unknown' | 'none'; revisionRequestId?: string; reportFiles?: string[];
    recheckRequestId?: string; note: string;
  };
};
export type VerificationRuntimeEvidence = {
  native?: { sessionFile: string; entries: unknown[] }; events?: unknown[];
};
type FixedBytes = { relativePath: string; sha256: string; bytes: Uint8Array; sourcePath?: string };
const OPEN = '[OPTRACALL_AUTHOR_CONTEXT_V1]\n';
const CLOSE = '\n[/OPTRACALL_AUTHOR_CONTEXT_V1]';
/** Business guidance for the existing automatic feedback handoff. This is
 * supplied text, not a Host truth check or a persisted feedback protocol. */
export const AUTOMATIC_FEEDBACK_EVIDENCE_GUIDANCE = '重要分歧应定位固定稿中的原句或位置，注明所依赖的固定来源及适用前提、相反证据或依据，解释为何不成立或尚不能成立，再提出保留或修改的建议及新增主张需要的前提。区分已给事实、未知、假设、反事实和建议。无相反依据的疑虑只列为待核，不能写成事实更正；通用未确认标记不能自动覆盖本题来源已明确给出的声明。核算意见及其新增主张也可能有错，作者应按实际源证据取舍，可保持、修改或有据反驳。允许无分歧和自由文本，不要求固定表格、条数、工具或分析顺序。Host仅交付固定材料、位置及范围，不裁决业务真伪或强制采纳意见。';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function decode(bytes: Uint8Array): string | undefined {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return undefined; }
}
function endAt(text: string, limit: number): number {
  let end = Math.min(text.length, limit);
  if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!) && /[\uDC00-\uDFFF]/.test(text[end]!)) end--;
  return end;
}
export function materialPreview(file: FixedBytes): VerificationMaterialPreview {
  const text = decode(file.bytes);
  return { relativePath: file.relativePath, sha256: file.sha256, bytes: file.bytes.length,
    ...(file.sourcePath ? { sourcePath: file.sourcePath } : {}), textStatus: text === undefined ? 'not-utf8' : 'utf8',
    ...(text === undefined ? {} : { totalLength: text.length }) };
}
export function authorPreview(file: FixedBytes, workspace: string): VerificationAuthorPreview {
  const text = decode(file.bytes), end = text === undefined ? null : endAt(text, 100_000);
  return { path: file.relativePath, sha256: file.sha256, bytes: file.bytes.length,
    fixedPath: path.join(workspace, 'author', file.relativePath), textStatus: text === undefined ? 'not-utf8' : 'utf8',
    text: text === undefined ? '' : text.slice(0, end!), start: text === undefined ? null : 0,
    end, totalLength: text === undefined ? null : text.length, truncated: text !== undefined && end! < text.length };
}
/** Build the actual supplied text once; the native user message is its readback authority. */
export function authorContext(files: readonly FixedBytes[], workspace: string, options: { automaticFeedback?: boolean } = {}): string {
  const texts = files.map(file => decode(file.bytes));
  const fragments: VerificationAuthorFragment[] = files.map((file, index) => {
    const text = texts[index];
    return { relativePath: file.relativePath, sha256: file.sha256, bytes: file.bytes.length,
      fixedPath: path.join(workspace, 'author', file.relativePath), textStatus: text === undefined ? 'not-utf8' : 'utf8',
      start: text === undefined ? null : 0, end: text === undefined ? null : 0, totalLength: text === undefined ? null : text.length,
      text: text === undefined ? null : '' };
  });
  const compose = () => '首次回复已保存。现在开放以下固定作者副本。清单中的[start,end)为本请求主动附带的UTF-16文字范围，totalLength为原解码长度；完整副本可按需自主读取。text为空表示本请求未主动附正文；not-utf8表示无UTF-8文字摘要，完整字节仍可用。单文件正文最多4000、合计最多12000 UTF-16；完整请求沿原20000限制，因此实际片段也可能更短。材料可用不表示已经读取或核查。\n' +
    OPEN + JSON.stringify({ version: 1, files: fragments }) + CLOSE +
    '\n请自主决定对照方式，说明实际核查范围、依据、分歧及无法确认事项。可以一致、保留未知或说明尚未核到；不要求固定工具、方法、步骤或检查数量。重跑作者代码与独立计算的含义不同；不要修改作者原稿或将一致、程序完成当成业务成立。' +
    (options.automaticFeedback ? '\n' + AUTOMATIC_FEEDBACK_EVIDENCE_GUIDANCE : '');
  if (compose().length > 20_000) throw new VerificationStoreError('verification_author_context_too_large', 400);
  let remaining = 12_000;
  for (const [index, text] of texts.entries()) {
    if (text === undefined) continue;
    let low = 0, high = Math.min(4_000, remaining, text.length), best = 0;
    while (low <= high) {
      const midpoint = Math.floor((low + high) / 2), end = endAt(text, midpoint);
      fragments[index]!.end = end; fragments[index]!.text = text.slice(0, end);
      if (compose().length <= 20_000) { best = end; low = midpoint + 1; } else high = midpoint - 1;
    }
    fragments[index]!.end = best; fragments[index]!.text = text.slice(0, best); remaining -= best;
  }
  return compose();
}

function messageText(entry: Record<string, unknown>): string | undefined {
  const message = object(entry.message);
  if (!message || message.role !== 'user') return undefined;
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content) || message.content.some(part => !object(part) || object(part)!.type !== 'text' || typeof object(part)!.text !== 'string')) return undefined;
  return message.content.map(part => object(part)!.text).join('');
}
export function suppliedRequest(record: VerificationRecord, native: VerificationRuntimeEvidence['native'], identity = { requestId: record.comparisonResult?.requestId, sessionFile: record.comparisonResult?.sessionFile }): (Omit<VerificationContextEvidence['provided'], 'status' | 'note' | 'fragments'> & { sessionId: string }) | undefined {
  const requestId = identity.requestId;
  if (!requestId || !native || native.sessionFile !== identity.sessionFile) return undefined;
  const header = object(native.entries[0]);
  if (header?.type !== 'session' || header.cwd !== record.workspace || typeof header.id !== 'string') return undefined;
  let requestHash: string | undefined;
  for (const raw of native.entries.slice(1)) {
    const entry = object(raw); if (!entry) continue;
    if (entry.type === 'custom' && entry.customType === 'optracall.run') {
      const data = object(entry.data);
      if (!data || data.sessionId !== header.id) continue;
      if (data.phase === 'started') {
        if (data.requestId !== requestId) { requestHash = undefined; continue; }
        const provided = object(data.providedContext);
        requestHash = typeof provided?.requestTextSha256 === 'string' ? provided.requestTextSha256 : undefined;
        continue;
      }
      if (data.phase === 'settled' && data.requestId === requestId) requestHash = undefined;
    }
    if (!requestHash) continue;
    const text = messageText(entry);
    if (text !== undefined && sha(text) === requestHash) return { requestId, sessionId: header.id, sessionFile: native.sessionFile,
      ...(typeof entry.id === 'string' ? { messageId: entry.id } : {}), requestText: text };
  }
  return undefined;
}
function recordedFragments(record: VerificationRecord, requestText: string): VerificationAuthorFragment[] | undefined {
  const start = requestText.indexOf(OPEN), end = requestText.indexOf(CLOSE, start + OPEN.length);
  if (start < 0 || end < 0) return undefined;
  let packet: Record<string, unknown> | undefined;
  try { packet = object(JSON.parse(requestText.slice(start + OPEN.length, end))); } catch { return undefined; }
  if (packet?.version !== 1 || !Array.isArray(packet.files) || packet.files.length !== record.authorFiles.length) return undefined;
  const fragments: VerificationAuthorFragment[] = [];
  for (const [index, raw] of packet.files.entries()) {
    const value = object(raw), file = record.authorFiles[index];
    if (!value || !file || value.relativePath !== file.relativePath || value.sha256 !== file.sha256 || value.bytes !== file.bytes || value.fixedPath !== path.join(record.workspace, 'author', file.relativePath)) return undefined;
    if (value.textStatus === 'not-utf8') {
      if (value.start !== null || value.end !== null || value.totalLength !== null || value.text !== null) return undefined;
    } else if (value.textStatus === 'utf8') {
      if (value.start !== 0 || !Number.isSafeInteger(value.end) || !Number.isSafeInteger(value.totalLength) || Number(value.end) < 0 || Number(value.totalLength) < Number(value.end) || typeof value.text !== 'string' || value.text.length !== value.end) return undefined;
    } else return undefined;
    fragments.push(value as VerificationAuthorFragment);
  }
  return fragments;
}
function readClues(record: VerificationRecord, events: unknown[]): VerificationReadClue[] {
  const requestIds = new Set([record.coldResult?.requestId, record.comparisonResult?.requestId, record.recheckResult?.requestId].filter((value): value is string => Boolean(value)));
  const clues = new Map<string, VerificationReadClue>();
  for (const raw of events) {
    const item = object(raw), event = object(item?.event);
    if (item?.type !== 'native' || typeof item.requestId !== 'string' || !requestIds.has(item.requestId) || !event || typeof event.toolCallId !== 'string') continue;
    const key = `${item.requestId}/${event.toolCallId}`;
    if (event.type === 'tool_execution_start' && event.toolName === 'read') {
      const args = object(event.args ?? event.input); if (typeof args?.path !== 'string') continue;
      const resolved = path.isAbsolute(args.path) ? path.normalize(args.path) : path.resolve(record.workspace, args.path);
      const candidates = [...record.dataFiles.map(file => ({ file, group: 'inputs' })), ...record.authorFiles.map(file => ({ file, group: 'author' }))];
      const fixed = candidates.find(({ file, group }) => resolved === path.join(record.workspace, group, file.relativePath));
      if (!fixed) continue;
      const offset = Number.isSafeInteger(args.offset) && Number(args.offset) > 0 ? Number(args.offset) : undefined;
      const limit = Number.isSafeInteger(args.limit) && Number(args.limit) > 0 ? Number(args.limit) : undefined;
      clues.set(key, { requestId: item.requestId, toolCallId: event.toolCallId, toolName: 'read', relativePath: fixed.file.relativePath,
        ...(offset === undefined ? {} : { offset }), ...(limit === undefined ? {} : { limit }), outcome: 'started',
        note: '捕获的read请求参数；不证明读取成功、全文覆盖、理解或采用。' });
    } else if (event.type === 'tool_execution_end' && clues.has(key)) {
      const clue = clues.get(key)!;
      clue.outcome = event.isError === true ? 'failed' : event.isError === false ? 'completed' : 'started';
      clue.note = event.isError === true ? '捕获工具执行失败；不能作为成功读取证据。' : event.isError === false ? '捕获工具执行结束；范围仅限所列参数，不证明全文覆盖、理解或采用。' : '捕获工具结束事件，但结果状态未记录；不能确认成功读取。';
    }
  }
  return [...clues.values()];
}
/** Read-only projection; missing old metadata is never reconstructed using current files or limits. */
export function contextEvidence(record: VerificationRecord, runtime: VerificationRuntimeEvidence): VerificationContextEvidence {
  const supplied = suppliedRequest(record, runtime.native), fragments = supplied?.requestText ? recordedFragments(record, supplied.requestText) : undefined;
  const clues = runtime.events ? readClues(record, runtime.events) : [];
  const revision = record.authorRevision;
  const association: VerificationContextEvidence['revisionAssociation'] = !revision ? { status: 'none', note: '尚无本记录新稿。' } :
    revision.mode === 'fixed-draft' && record.revisionCount === 1 && typeof revision.requestId === 'string' && Boolean(revision.requestId.trim()) &&
      (!record.recheckResult || record.recheckCount === 1 && typeof record.recheckResult.requestId === 'string' && Boolean(record.recheckResult.requestId.trim())) ? {
      status: 'recorded', revisionRequestId: revision.requestId, ...(revision.files ? { reportFiles: revision.files } : {}),
      ...(record.recheckResult?.requestId ? { recheckRequestId: record.recheckResult.requestId } : {}),
      note: record.recheckResult ? '本记录唯一新稿与一次知情复查；复查不是新冷读。' : '本记录唯一新稿；尚未取得已保存复查。',
    } : { status: 'unknown', note: '旧记录缺少可确认的唯一新稿对应信息，不从当前文件回填。' };
  return {
    provided: fragments && supplied ? { status: 'recorded', ...supplied, fragments, note: '来自本记录请求身份与SHA核对的实际native用户正文；片段不是全文阅读证明。' } :
      { status: runtime.native ? 'unrecorded' : record.comparisonResult?.sessionFile ? 'unavailable' : 'unrecorded', ...(supplied ?? {}), fragments: [], note: '未取得可确认的实际片段范围；旧请求不按当前常数或当前文件重建。' },
    reads: { status: clues.length ? 'observed' : runtime.events ? 'unrecorded' : 'unavailable', items: clues,
      note: '仅展示可与本记录请求及固定文件对应的read线索；未捕获不表示未读，bash等访问不能据此认定未读。' },
    revisionAssociation: association,
  };
}
