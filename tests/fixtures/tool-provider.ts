import { createServer, type ServerResponse } from 'node:http';

export interface ToolProviderMessage { role: string; content?: unknown; tool_call_id?: string; tool_calls?: unknown[] }
export interface ToolProviderBody { model?: string; messages?: ToolProviderMessage[]; tools?: { function?: { name?: string; parameters?: unknown } }[] }
export interface ToolProviderRequest { path: string; authorization?: string; body: ToolProviderBody; closedEarly: boolean }
export interface SyntheticToolCall { name: string; arguments: Record<string, unknown> }
export interface ToolProviderReply { text?: string; calls?: SyntheticToolCall[]; hold?: boolean; status?: number }
export interface ToolProviderContext { request: ToolProviderRequest; requestNumber: number; messages: ToolProviderMessage[]; recentToolResults: ToolProviderMessage[]; availableTools: string[] }
export type ToolProviderResponder = (context: ToolProviderContext) => ToolProviderReply | Promise<ToolProviderReply>;

export function providerMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string' ? part.text : '').join('');
  return '';
}

/** Local protocol fixture: every requested tool is executed by the actual SDK, not this server. */
export async function startToolProvider() {
  const requests: ToolProviderRequest[] = [], errors: string[] = [];
  const responses = new Set<ServerResponse>();
  let responder: ToolProviderResponder = () => ({ text: '合成普通回复' });
  const server = createServer(async (request, response) => {
    responses.add(response);
    response.on('close', () => responses.delete(response));
    try {
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.writeHead(404); response.end(); return; }
      if (!request.headers.authorization?.startsWith('Bearer synthetic-')) { response.writeHead(401); response.end(JSON.stringify({ error: { message: 'Synthetic fixture requires a fake credential.' } })); return; }
      const parts: Buffer[] = []; for await (const chunk of request) parts.push(Buffer.from(chunk));
      const record: ToolProviderRequest = { path: request.url, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(parts).toString('utf8')), closedEarly: false };
      requests.push(record);
      response.on('close', () => { record.closedEarly = !response.writableEnded; });
      const messages = record.body.messages ?? [];
      let userIndex = -1; for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { userIndex = i; break; }
      const context: ToolProviderContext = { request: record, requestNumber: requests.length, messages, recentToolResults: messages.slice(userIndex + 1).filter(message => message.role === 'tool'), availableTools: (record.body.tools ?? []).map(tool => tool.function?.name ?? '') };
      const reply = await responder(context);
      if (reply.status && reply.status !== 200) { response.writeHead(reply.status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'Synthetic provider failure.' } })); return; }
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: `synthetic-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: record.body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      send({ role: 'assistant', content: '' });
      if (reply.text) { const cut = Math.max(1, Math.floor(reply.text.length / 2)); send({ content: reply.text.slice(0, cut) }); send({ content: reply.text.slice(cut) }); }
      if (reply.hold) return;
      if (reply.calls?.length) {
        for (const [index, call] of reply.calls.entries()) {
          send({ tool_calls: [{ index, id: `call_${requests.length}_${index}`, type: 'function', function: { name: call.name, arguments: '' } }] });
          const argumentsText = JSON.stringify(call.arguments), cut = Math.floor(argumentsText.length / 2);
          send({ tool_calls: [{ index, function: { arguments: argumentsText.slice(0, cut) } }] });
          send({ tool_calls: [{ index, function: { arguments: argumentsText.slice(cut) } }] });
        }
      }
      send({}, reply.calls?.length ? 'tool_calls' : 'stop'); response.write('data: [DONE]\n\n'); response.end();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Synthetic fixture error.');
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Synthetic fixture error.' } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Synthetic tool provider address missing.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, requests, errors,
    setResponder: (next: ToolProviderResponder) => { responder = next; },
    waitForRequests: (count: number, timeoutMs = 15_000) => new Promise<void>((resolve, reject) => {
      const started = Date.now(), timer = setInterval(() => { if (requests.length >= count) { clearInterval(timer); resolve(); } else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error('Synthetic tool request missing.')); } }, 10);
    }),
    close: () => new Promise<void>(resolve => { for (const response of responses) response.destroy(); server.close(() => resolve()); server.closeAllConnections(); }),
  };
}
