import { isSemanticGraphResult, isSemanticQueryResult, isSemanticSourcesRecorded, type SemanticContextRecord, type SemanticQueryInput, type SemanticGraphQuery } from './semantic-context-client.ts';
import type { StudioSourceRef } from '../../../extensions/business-plugins/studio/contracts.ts';
import { parseSemanticGraphQuery } from '../../../extensions/business-plugins/semantic-context/graph.ts';

const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasText = (message: Record<string, any>) => typeof message.content === 'string' ? Boolean(message.content.trim()) : Array.isArray(message.content) && message.content.some(part => part.type === 'text' && typeof part.text === 'string' && part.text.trim());
function query(value: unknown): SemanticQueryInput | undefined {
  if (!object(value) || !['find', 'read', 'trace'].includes(value.action)) return undefined;
  return value as SemanticQueryInput;
}
function graphQuery(value: unknown): SemanticGraphQuery | undefined {
  try { parseSemanticGraphQuery(value); return value as SemanticGraphQuery; } catch { return undefined; }
}

export type StudioContextEvidence = {
  action: 'catalog' | 'read' | 'read-source' | 'declare-use';
  stage: 'directory' | 'asset' | 'source' | 'declaration';
  result: Record<string, unknown>; input?: Record<string, unknown>;
  ref?: StudioSourceRef; body?: string; complete?: boolean;
  range?: { start: number; end: number; total: number }; declaration?: true;
};
export type AssetContextRecord = SemanticContextRecord & { studio?: StudioContextEvidence };
const studioActions = ['catalog', 'read', 'read-source', 'declare-use'];
function studioEvidence(value: unknown, input: unknown, owner?: { projectId: string; taskId: string }): StudioContextEvidence | undefined {
  if (!object(value) || value.type !== 'optracall.studio' || !studioActions.includes(value.action) || !object(value.result)) return;
  if (object(input) && input.action !== value.action) return;
  const result = value.result, action = value.action as StudioContextEvidence['action'];
  const evidence: StudioContextEvidence = { action, stage: action === 'catalog' ? 'directory' : action === 'read-source' ? 'source' : action === 'declare-use' ? 'declaration' : 'asset', result, ...(object(input) ? { input } : {}) };
  if (action === 'declare-use') {
    if (result.claim !== 'author-declaration-not-professional-verification' || !object(result.use) || typeof result.use.id !== 'string'
      || owner && (result.use.projectId !== owner.projectId || result.use.taskId !== owner.taskId)) return;
    evidence.declaration = true;
  }
  if (typeof result.complete === 'boolean') evidence.complete = result.complete;
  if (object(result.transport) && result.transport.complete === false) evidence.complete = false;
  if (action === 'read-source' && typeof result.text === 'string') evidence.body = result.text;
  if (action === 'read' && typeof result.body === 'string') evidence.body = result.body;
  if (action === 'read' && result.encoding === 'json-text' && typeof result.text === 'string') evidence.body = result.text;
  if (object(result.ref) && ['enterprise','rap','data','sap-metric','sap-method','studio-source','task','case'].includes(result.ref.authority)
    && typeof result.ref.id === 'string' && typeof result.ref.version === 'string') evidence.ref = result.ref as StudioSourceRef;
  const range = result.range;
  if (object(range) && ['start','end','total'].every(key => Number.isSafeInteger(range[key]) && range[key] >= 0)
    && range.start <= range.end && range.end <= range.total) evidence.range = { start: range.start, end: range.end, total: range.total };
  return evidence;
}

/** Read-only projection from the actual current task transcript. */
export function semanticRecordsForAssistant(messages: readonly Record<string, any>[], index: number, sessionId?: string, owner?: { projectId: string; taskId: string }): AssetContextRecord[] {
  if (messages[index]?.role !== 'assistant') return [];
  let start = index - 1;
  while (start >= 0 && messages[start]?.role !== 'user' && !(messages[start]?.role === 'assistant' && hasText(messages[start]!))) start--;
  const calls = new Map<string, unknown>(), records: AssetContextRecord[] = [];
  for (let i = Math.max(0, start); i < index; i++) {
    const message = messages[i]!;
    if (message.role === 'assistant' && Array.isArray(message.content)) for (const part of message.content) {
      if (part.type === 'toolCall' && typeof part.id === 'string') calls.set(part.id, part.arguments);
    }
    if (message.role !== 'toolResult') continue;
    const native = typeof message.entryId === 'string' && sessionId ? { sessionId, entryId: message.entryId, ...(typeof message.toolCallId === 'string' ? { toolCallId: message.toolCallId } : {}) } : undefined;
    const input = query(calls.get(message.toolCallId));
    const graphInput = graphQuery(calls.get(message.toolCallId));
    if (message.toolName === 'read_semantic_context') {
      records.push(!message.isError && isSemanticGraphResult(message.details) ? { graphResult: message.details, graphInput, native }
        : !message.isError && isSemanticQueryResult(message.details) ? { result: message.details, input, native }
          : { input, graphInput, native, issue: '辅助查询失败或原生结构化结果未记录 · UNKNOWN。原分析流程仍可继续。' });
    } else if (message.toolName === 'studio_assets' && (studioActions.includes(message.details?.action) || object(calls.get(message.toolCallId)) && studioActions.includes((calls.get(message.toolCallId) as Record<string, any>).action))) {
      const evidence = !message.isError ? studioEvidence(message.details, calls.get(message.toolCallId), owner) : undefined;
      records.push(evidence ? { studio: evidence, native } : { native, issue: 'Studio目录／正文／作者声明的原生结果未能核定 · UNKNOWN。不能从调用名或成功文本补造已读或已采用。' });
    } else if (message.toolName === 'record_analysis_sources') {
      const receipt = !message.isError && isSemanticSourcesRecorded(message.details) && (!owner || message.details.projectId === owner.projectId) ? message.details : undefined;
      records.push(receipt ? { receipt, native } : { native, issue: '来源保存回执未能核定 · UNKNOWN。不能认定已保存，也不改变原分析结果。' });
    }
    if (!Array.isArray(message.nestedCalls?.calls)) continue;
    for (const call of message.nestedCalls.calls) {
      if (!object(call) || !['read_semantic_context', 'record_analysis_sources', 'studio_assets'].includes(call.name)) continue;
      let parameters = call.arguments;
      if (typeof parameters === 'string' && parameters.length <= 65_536) { try { parameters = JSON.parse(parameters); } catch { parameters = undefined; } }
      let original = query(parameters);
      if (call.name === 'record_analysis_sources' && owner && object(parameters) && typeof parameters.citationId === 'string' && /^[a-f0-9-]{36}$/i.test(parameters.citationId)) original = { action: 'read', target: { kind: 'data-citation', projectId: owner.projectId, citationId: parameters.citationId } };
      // Pi retains nested call metadata, not the child's result.details. The
      // parent entry and status cannot manufacture a child receipt or body.
      records.push({ input: original, graphInput: graphQuery(parameters), native, issue: '原生记录保留了嵌套调用信息，子工具正文／保存回执未记录 · UNKNOWN。可自愿按原引用回读当前状态，不能据此补写当时结果。' });
    }
  }
  return records;
}
