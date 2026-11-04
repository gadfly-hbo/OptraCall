import { createHash } from 'node:crypto';
import { readNativeSessionSnapshot } from './native-session-snapshot.ts';
import type { SapMethodSource } from '../../extensions/business-plugins/metric-factory/methods/types.ts';
import type { SapMethodSourceContext, SapMethodSourcePort, SapMethodSourceToolResult } from '../agent/sap-method-extraction.ts';

export type SapMethodSessionIdentity = {
  projectId: string; taskId: string; sessionId: string; cutoffEntryId: string | null;
  nativeSha256: string; bytes: number; projectionSha256: string; incomplete: boolean;
};
export type SapMethodSources = {
  sourceRef: SapMethodSource;
  sessionIdentity: SapMethodSessionIdentity;
  sessionText: string;
  promptContext: string;
  read: SapMethodSourcePort;
  references(): SapMethodSource[];
  assertUnchanged(): Promise<void>;
};
export type SapMethodAdditionalSources = (action: 'find' | 'read', input: Record<string, unknown>, context: SapMethodSourceContext) => Promise<SapMethodSourceToolResult>;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const fail = (code: string): never => { const error = new Error(code); Object.assign(error, { code }); throw error; };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const source = (value: unknown): value is SapMethodSource => record(value) && ['session','memory','report','method','manual'].includes(String(value.type)) && typeof value.label === 'string' && typeof value.ref === 'string' && (value.version === null || typeof value.version === 'string') && (value.sha256 === null || typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256));

/** A read-only projection of the SDK-selected branch. Thinking blocks are not source material. */
function projectEntries(entries: unknown[]): string {
  const visible: unknown[] = [];
  for (const value of entries) {
    if (!record(value) || value.type !== 'message' || !record(value.message)) continue;
    const message = value.message;
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : Array.isArray(message.content) ? message.content.flatMap<unknown>(part => {
      if (!record(part)) return [];
      if (part.type === 'text' && typeof part.text === 'string') return [{ type: 'text', text: part.text }];
      if (part.type === 'toolCall' && typeof part.name === 'string') return [{ type: 'toolCall', name: part.name, arguments: part.arguments }];
      if (part.type === 'image') return [{ type: 'limitation', text: '图片未在文字来源中展开。' }];
      return [];
    }) : [];
    visible.push({ entryId: value.id, timestamp: value.timestamp, role: message.role, ...(typeof message.toolName === 'string' ? { toolName: message.toolName } : {}), content });
  }
  return visible.map(value => JSON.stringify(value)).join('\n');
}

/** No source path is accepted from the model; Host binds the exact original native. */
export async function createSapMethodSources(options: {
  projectId: string; taskId: string; extractionId: string; sessionFile: string; sessionDirectory: string; cwd: string;
  incomplete?: boolean; personal?: SapMethodAdditionalSources; methods?: SapMethodAdditionalSources;
}): Promise<SapMethodSources> {
  const snapshot = await readNativeSessionSnapshot(options.sessionFile, options.sessionDirectory, options.cwd);
  const nativeSha256 = 'sha256' in snapshot && typeof snapshot.sha256 === 'string' ? snapshot.sha256 : fail('sap_method_native_identity_unavailable');
  const branch = snapshot.entries.filter(entry => snapshot.branchIds.has(entry.id));
  const sessionText = projectEntries(branch), projectionSha256 = hash(sessionText);
  const sessionIdentity: SapMethodSessionIdentity = { projectId: options.projectId, taskId: options.taskId, sessionId: snapshot.manager.getSessionId(), cutoffEntryId: branch.at(-1)?.id ?? null, nativeSha256, bytes: snapshot.bytes, projectionSha256, incomplete: options.incomplete === true };
  const sourceRef: SapMethodSource = { type: 'session', label: '原任务 Session 的固定可读来源', ref: `sap-session:${options.extractionId}`, version: sessionIdentity.cutoffEntryId, sha256: projectionSha256 };
  const references = [sourceRef];
  const result = (text: string, details: unknown): SapMethodSourceToolResult => ({ content: [{ type: 'text', text }], details });
  const promptContext = JSON.stringify({ source: sourceRef, identity: sessionIdentity, chars: sessionText.length, limitations: ['只读固定分支的可见对话、工具调用和工具文字结果；隐藏思维不作提炼来源。', ...(options.incomplete ? ['来源任务尚未完成，只能整理已有材料，必须披露不完整。'] : [])], memoryAvailable: Boolean(options.personal), publishedMethodsAvailable: Boolean(options.methods) });
  const read: SapMethodSourcePort = async (action, input, context) => {
    context.assertCurrent(); context.signal.throwIfAborted();
    if (action === 'catalog') return result(promptContext, { source: sourceRef, identity: sessionIdentity, chars: sessionText.length });
    if (action === 'read-session') {
      const start = input.start ?? 0, length = input.length ?? 16000;
      if (!Number.isSafeInteger(start) || Number(start) < 0 || Number(start) > sessionText.length || !Number.isSafeInteger(length) || Number(length) < 1 || Number(length) > 30000) return fail('invalid_sap_method_source_range');
      const boundary = (position: number) => !(position > 0 && position < sessionText.length && /[\uD800-\uDBFF]/.test(sessionText[position - 1]!) && /[\uDC00-\uDFFF]/.test(sessionText[position]!));
      if (!boundary(Number(start))) return fail('invalid_sap_method_source_range');
      let end = Math.min(Number(start) + Number(length), sessionText.length);
      if (!boundary(end)) end--;
      return result(sessionText.slice(Number(start), end), { source: sourceRef, start, end, total: sessionText.length, partial: end < sessionText.length, continuation: end < sessionText.length ? end : null });
    }
    if (!['find-memory','read-memory','find-methods','read-method'].includes(action)) return fail('invalid_sap_method_source_action');
    const port = action.endsWith('memory') ? options.personal : options.methods;
    if (!port) return fail('sap_method_source_unavailable');
    const response = await port(action.startsWith('find-') ? 'find' : 'read', record(input.input) ? input.input : input, context);
    context.assertCurrent(); context.signal.throwIfAborted();
    if (action.startsWith('read-') && record(response.details) && Array.isArray(response.details.sources)) {
      for (const ref of response.details.sources) if (source(ref) && !references.some(saved => JSON.stringify(saved) === JSON.stringify(ref))) references.push(structuredClone(ref));
    }
    return response;
  };
  return {
    sourceRef, sessionIdentity, sessionText, promptContext, read,
    references: () => structuredClone(references),
    assertUnchanged: async () => {
      const current = await readNativeSessionSnapshot(options.sessionFile, options.sessionDirectory, options.cwd);
      if (!('sha256' in current) || current.sha256 !== nativeSha256 || current.manager.getSessionId() !== sessionIdentity.sessionId) fail('sap_method_source_changed');
    },
  };
}
