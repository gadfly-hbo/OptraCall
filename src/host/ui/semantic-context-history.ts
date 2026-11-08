import { isSemanticGraphResult, isSemanticQueryResult, isSemanticSourcesRecorded, type SemanticContextRecord, type SemanticQueryInput, type SemanticGraphQuery } from './semantic-context-client.ts';
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

/** Read-only projection from the actual current task transcript. */
export function semanticRecordsForAssistant(messages: readonly Record<string, any>[], index: number, sessionId?: string, owner?: { projectId: string; taskId: string }): SemanticContextRecord[] {
  if (messages[index]?.role !== 'assistant') return [];
  let start = index - 1;
  while (start >= 0 && messages[start]?.role !== 'user' && !(messages[start]?.role === 'assistant' && hasText(messages[start]!))) start--;
  const calls = new Map<string, unknown>(), records: SemanticContextRecord[] = [];
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
    } else if (message.toolName === 'record_analysis_sources') {
      const receipt = !message.isError && isSemanticSourcesRecorded(message.details) && (!owner || message.details.projectId === owner.projectId) ? message.details : undefined;
      records.push(receipt ? { receipt, native } : { native, issue: '来源保存回执未能核定 · UNKNOWN。不能认定已保存，也不改变原分析结果。' });
    }
    if (!Array.isArray(message.nestedCalls?.calls)) continue;
    for (const call of message.nestedCalls.calls) {
      if (!object(call) || !['read_semantic_context', 'record_analysis_sources'].includes(call.name)) continue;
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
