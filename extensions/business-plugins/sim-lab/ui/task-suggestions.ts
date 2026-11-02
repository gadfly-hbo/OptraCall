import type { NativeMessage } from '../../../../src/host/ui/project-types.ts';

export type FreezeSuggestion = { projectId: string; draftId: string; draftRevision: number; runId: string; variantId: string; reason: string; engineVersion: string; inputHash: string };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Project a real successful tool receipt only when its matching Agent call explicitly proposed freezing. */
export function freezeSuggestionFor(messages: NativeMessage[], index: number, projectId: string): FreezeSuggestion | undefined {
  const result = messages[index];
  if (!result || result.role !== 'toolResult' || result.toolName !== 'simulation_run' || result.isError || !result.toolCallId) return;
  const call = messages.slice(0, index).flatMap(message => message.role === 'assistant' && Array.isArray(message.content) ? message.content : [])
    .reverse().find(part => part.type === 'toolCall' && part.name === 'simulation_run' && part.id === result.toolCallId);
  const args = call?.arguments;
  if (!object(args) || !object(args.suggestFreeze) || typeof args.suggestFreeze.reason !== 'string') return;
  try {
    const text = typeof result.content === 'string' ? result.content : result.content?.filter(part => part.type === 'text').map(part => part.text ?? '').join('') ?? '';
    const envelope = JSON.parse(text), suggestion = envelope.data?.freezeSuggestion;
    if (envelope.status !== 'succeeded' || !suggestion || suggestion.projectId !== projectId
      || suggestion.draftId !== args.draftId || suggestion.variantId !== args.suggestFreeze.variantId
      || suggestion.reason !== args.suggestFreeze.reason.trim()
      || suggestion.runId !== envelope.data.runId || suggestion.draftRevision !== envelope.data.draftRevision || suggestion.engineVersion !== envelope.data.engineVersion
      || !/^[a-f0-9-]{36}$/.test(suggestion.draftId) || !/^RUN-\d{4,}$/.test(suggestion.runId)
      || !Number.isSafeInteger(suggestion.draftRevision) || suggestion.draftRevision < 1
      || typeof suggestion.reason !== 'string' || !suggestion.reason || suggestion.reason.length > 1000
      || typeof suggestion.engineVersion !== 'string' || !/^[a-f0-9]{64}$/.test(suggestion.inputHash)) return;
    return suggestion;
  } catch { return; }
}
