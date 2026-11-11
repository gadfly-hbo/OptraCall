import type { ExtensionFactory } from './sdk.ts';
import { randomUUID } from 'node:crypto';

type Configuration = { provider: string; api: string; model: string };
type Mode = 'anthropic' | 'mimo';
type Source = { title: string; url: string };
type SearchReceipt = { version: 1; api: string; originalText: string; projectedText: string; content?: Record<string, any>[]; stopReason?: string; continuationMarker?: string; sources: Source[]; usage?: unknown };
const receiptKey = 'optracallNativeSearch';
const continuationType = 'optracall.native-search-continuation';
const maxReceiptBytes = 8 * 1024 * 1024;
const textOf = (content: any) => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text).join('') : '';

/** The existing configured protocol/model is preserved. Other routes are not guessed. */
export function nativeSearchMode(configuration: Configuration): Mode | undefined {
  if (configuration.provider === 'minimax-cn' && configuration.api === 'anthropic-messages' && ['MiniMax-M3', 'MiniMax-M3.1-Flash'].includes(configuration.model)) return 'anthropic';
  if (['mimo', 'xiaomi-token-plan-cn'].includes(configuration.provider) && configuration.api === 'openai-completions' && ['mimo-v2.6-pro', 'mimo-v2.6-flash'].includes(configuration.model)) return 'mimo';
}

/** Adapt native protocol blocks through Pi's existing loop and persistence hooks. */
export function createNativeSearchExtension(configuration: Configuration, onFailure?: (code: string) => void, inject = true): ExtensionFactory {
  const mode = nativeSearchMode(configuration);
  return pi => {
    if (!mode) return;
    let contextAssistants: any[] = [];
    let contextContinuations = new Set<string>();
    let blocks: Record<string, any>[] = [], partialInputs = new Map<number, string>();
    let openBlocks = new Set<number>(), streamBytes = 0;
    let sources = new Map<string, Source>(), stopReason: string | undefined, usage: unknown;
    let hasNativeBlocks = false, responseFailed = false, lastReceipt: SearchReceipt | undefined;
    const collectSources = (root: unknown) => {
      const pending = [{ value: root as any, depth: 0 }];
      let nodes = 0;
      while (pending.length) {
        const { value, depth } = pending.pop()!;
        if (!value || typeof value !== 'object') continue;
        if (++nodes > 100_000 || depth > 128) throw new Error('native_search_response_unavailable');
        if (['web_search_result', 'url_citation'].includes(value.type) && typeof value.url === 'string') {
          try {
            const url = new URL(value.url);
            if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && value.url.length <= 8192) sources.set(value.url, { title: typeof value.title === 'string' ? value.title.replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 512) : '', url: value.url });
          } catch { /* A malformed Provider URL is not a source. */ }
        }
        const values = Object.values(value);
        for (let index = values.length - 1; index >= 0; index--) if (typeof values[index] === 'object') pending.push({ value: values[index], depth: depth + 1 });
      }
    };
    pi.on('context', event => {
      contextAssistants = event.messages.filter(message => message.role === 'assistant');
      contextContinuations = new Set(event.messages.flatMap(message => message.role === 'custom' && message.customType === continuationType ? [textOf(message.content)] : []));
    });
    pi.on('before_provider_request', (event, context) => {
      try {
        const payload = event.payload as Record<string, any>;
        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) throw new Error('native_search_payload_unsupported');
        if (mode === 'anthropic') {
          const assistants = payload.messages.filter((message: any) => message.role === 'assistant');
          if (contextAssistants.some(message => message[receiptKey]?.api === 'anthropic-messages')) {
            if (assistants.length !== contextAssistants.length) throw new Error('native_search_context_mismatch');
            for (let index = 0; index < assistants.length; index++) {
              const original = contextAssistants[index], receipt = original[receiptKey] as SearchReceipt | undefined;
              if (!receipt || receipt.api !== 'anthropic-messages') continue;
              // Bind exact SDK-projected text and ordinal before restoring opaque native blocks.
              if (receipt.version !== 1 || receipt.projectedText !== textOf(original.content) || receipt.projectedText !== textOf(assistants[index].content) || !Array.isArray(receipt.content) || receipt.originalText !== textOf(receipt.content) || Buffer.byteLength(JSON.stringify(receipt), 'utf8') > maxReceiptBytes) throw new Error('native_search_context_mismatch');
              assistants[index].content = structuredClone(receipt.content);
              if (receipt.continuationMarker) {
                const next = payload.messages[payload.messages.indexOf(assistants[index]) + 1];
                if (!contextContinuations.has(receipt.continuationMarker) || next?.role !== 'user' || textOf(next.content) !== receipt.continuationMarker) throw new Error('native_search_continuation_mismatch');
                // Pi 1.4.0 needs a boundary entry to schedule its continuation.
                // Remove that exact Host entry from the wire: the Provider sees
                // its original paused assistant, not an invented user question.
                payload.messages = payload.messages.filter((message: any) => message !== next);
              }
            }
          }
        }
        blocks = []; partialInputs = new Map(); openBlocks = new Set(); streamBytes = 0; sources = new Map(); stopReason = undefined; usage = undefined;
        hasNativeBlocks = false; responseFailed = false; lastReceipt = undefined;
        // Restore native history without advertising another search route.
        if (!inject) return payload;
        const tools = Array.isArray(payload.tools) ? [...payload.tools] : [];
        if (!tools.some((tool: any) => tool.type === (mode === 'anthropic' ? 'web_search_20250305' : 'web_search'))) tools.push(mode === 'anthropic'
          ? { type: 'web_search_20250305', name: 'web_search' }
          : { type: 'web_search', max_keyword: 3, force_search: false, limit: 1 });
        return { ...payload, tools };
      } catch {
        responseFailed = true; onFailure?.('native_search_context_mismatch'); context.abort();
        return event.payload;
      }
    });
    if (!inject) return;
    pi.on('provider_stream_event', (event, context) => {
      try {
        const data = event.data as Record<string, any>;
        if (!data || typeof data !== 'object') return;
        streamBytes += Buffer.byteLength(JSON.stringify(data), 'utf8');
        if (streamBytes > 2 * maxReceiptBytes) throw new Error('native_search_response_unavailable');
        collectSources(data);
        if (mode === 'mimo') {
          if (data.usage?.web_search_usage) usage = structuredClone(data.usage.web_search_usage);
          return;
        }
        const index = data.index;
        if (data.type === 'content_block_start' && Number.isInteger(index) && index >= 0 && index < 1024) {
          if (openBlocks.has(index) || blocks[index]) throw new Error('native_search_response_unavailable');
          openBlocks.add(index);
          blocks[index] = structuredClone(data.content_block);
          if (['server_tool_use', 'web_search_tool_result'].includes(data.content_block?.type)) hasNativeBlocks = true;
        }
        if (data.type === 'content_block_delta' && blocks[index]) {
          const block = blocks[index], delta = data.delta;
          if (delta?.type === 'text_delta') block.text = (block.text ?? '') + delta.text;
          if (delta?.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + delta.thinking;
          if (delta?.type === 'signature_delta') block.signature = (block.signature ?? '') + delta.signature;
          if (delta?.type === 'input_json_delta') partialInputs.set(index, (partialInputs.get(index) ?? '') + delta.partial_json);
          if (delta?.type === 'citations_delta') block.citations = [...(block.citations ?? []), delta.citation];
        }
        if (data.type === 'content_block_stop') {
          if (!openBlocks.delete(index)) throw new Error('native_search_response_unavailable');
          if (partialInputs.has(index)) {
            blocks[index].input = JSON.parse(partialInputs.get(index)!);
            partialInputs.delete(index);
          }
        }
        if (data.type === 'message_delta' && typeof data.delta?.stop_reason === 'string') stopReason = data.delta.stop_reason;
        if (data.type === 'error') responseFailed = true;
      } catch {
        responseFailed = true; lastReceipt = undefined; onFailure?.('native_search_response_unavailable'); context.abort();
      }
    });
    pi.on('message_end', (event, context) => {
      if (event.message.role !== 'assistant') return;
      if (event.message.stopReason === 'error' || event.message.stopReason === 'aborted') { lastReceipt = undefined; return; }
      if (!hasNativeBlocks && !sources.size && usage === undefined && stopReason !== 'pause_turn') return;
      const content = [...event.message.content];
      if (sources.size) content.push({ type: 'text', text: '\n\n本次联网检索来源（供应商回执）：\n' + [...sources.values()].map(source => `- ${source.title}: <${source.url}>`).join('\n') });
      const receipt: SearchReceipt = { version: 1, api: configuration.api, originalText: textOf(event.message.content), projectedText: textOf(content), sources: [...sources.values()],
        ...(mode === 'anthropic' ? { content: blocks, stopReason } : {}), ...(usage === undefined ? {} : { usage }) };
      if (stopReason === 'pause_turn') receipt.continuationMarker = `[optracall-native-search:${randomUUID()}]`;
      if (responseFailed || openBlocks.size || partialInputs.size || Buffer.byteLength(JSON.stringify(receipt), 'utf8') > maxReceiptBytes) {
        responseFailed = true; lastReceipt = undefined; onFailure?.('native_search_response_unavailable'); context.abort();
        return { message: { ...event.message, content: [...event.message.content, { type: 'text', text: '\nNative search response could not be retained; this request is incomplete.' }] } };
      }
      lastReceipt = receipt;
      return { message: { ...event.message, content, [receiptKey]: receipt } };
    });
    pi.on('agent_before_settle', event => {
      // Provider pause_turn is a technical continuation inside Pi's own loop.
      // Aborts/errors never become another request and no failed request is replayed.
      if (event.outcome === 'completed' && !responseFailed && lastReceipt?.stopReason === 'pause_turn' && lastReceipt.continuationMarker) return {
        entries: [{ type: 'custom_message', customType: continuationType, display: false, content: lastReceipt.continuationMarker }], continue: true,
      };
    });
  };
}
