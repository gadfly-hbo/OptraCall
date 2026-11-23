import { createServer, type ServerResponse } from 'node:http';

export interface AnthropicToolCall { name: string; arguments: Record<string, unknown>; fragments?: number }
export interface AnthropicProviderReply { text?: string; calls?: AnthropicToolCall[]; hold?: boolean }
export interface AnthropicRequestRecord {
  body: any;
  closedEarly: boolean;
  emitted: { id: string; name: string; arguments: Record<string, unknown>; fragments: string[] }[];
}
export interface AnthropicProviderContext { request: AnthropicRequestRecord; requestNumber: number }
export type AnthropicProviderResponder = (context: AnthropicProviderContext) => AnthropicProviderReply | Promise<AnthropicProviderReply>;

export async function startAnthropicToolProvider() {
  const requests: AnthropicRequestRecord[] = [], errors: string[] = [];
  const responses = new Set<ServerResponse>();
  let responder: AnthropicProviderResponder = () => ({ text: 'Synthetic ordinary completion.' });
  const server = createServer(async (request, response) => {
    responses.add(response);
    response.on('close', () => responses.delete(response));
    const record: AnthropicRequestRecord = { body: undefined, closedEarly: false, emitted: [] };
    try {
      const route = request.url ? new URL(request.url, 'http://127.0.0.1').pathname.replace(/\/$/, '') : '';
      if (request.method !== 'POST' || !route.endsWith('/messages')) { response.writeHead(404); response.end(); return; }
      if (!request.headers['x-api-key']?.toString().startsWith('synthetic-')) { response.writeHead(401); response.end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      record.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(record);
      response.on('close', () => { record.closedEarly = !response.writableEnded; });
      const reply = await responder({ request: record, requestNumber: requests.length });
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      const send = (type: string, value: unknown) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value as object })}\n\n`);
      send('message_start', { message: { id: `synthetic-anthropic-${requests.length}`, type: 'message', role: 'assistant', model: record.body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
      let index = 0;
      if (reply.text) {
        send('content_block_start', { index, content_block: { type: 'text', text: '' } });
        send('content_block_delta', { index, delta: { type: 'text_delta', text: reply.text } });
        send('content_block_stop', { index });
        index++;
      }
      for (const call of reply.calls ?? []) {
        const id = `call_${requests.length}_${index}`, json = JSON.stringify(call.arguments);
        const count = Math.max(1, Math.min(call.fragments ?? 2, json.length));
        const size = Math.ceil(json.length / count), fragments = Array.from({ length: count }, (_, part) => json.slice(part * size, (part + 1) * size)).filter(Boolean);
        record.emitted.push({ id, name: call.name, arguments: call.arguments, fragments });
        send('content_block_start', { index, content_block: { type: 'tool_use', id, name: call.name, input: {} } });
        for (const partial of fragments) send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: partial } });
        send('content_block_stop', { index });
        index++;
      }
      if (reply.hold) return;
      send('message_delta', { delta: { stop_reason: reply.calls?.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
      send('message_stop', {});
      response.end();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Synthetic Anthropic fixture error.');
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Synthetic Anthropic fixture error.' } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Synthetic Anthropic provider address missing.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    errors,
    setResponder: (next: AnthropicProviderResponder) => { responder = next; },
    waitForRequests: (count: number, timeoutMs = 15_000) => new Promise<void>((resolve, reject) => {
      const started = Date.now(), timer = setInterval(() => {
        if (requests.length >= count) { clearInterval(timer); resolve(); }
        else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error('Synthetic Anthropic request missing.')); }
      }, 10);
    }),
    close: () => new Promise<void>(resolve => {
      for (const response of responses) response.destroy();
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

export function anthropicToolResults(body: any): { id: string; content: string }[] {
  return (body.messages ?? []).flatMap((message: any) => (message.content ?? []).filter?.((part: any) => part.type === 'tool_result') ?? [])
    .map((part: any) => ({ id: part.tool_use_id, content: typeof part.content === 'string' ? part.content : (part.content ?? []).map((item: any) => item.text ?? '').join('') }));
}
