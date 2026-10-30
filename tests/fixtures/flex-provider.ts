import { createServer, type ServerResponse } from 'node:http';

export type FlexReply = { text: string; hold?: boolean; status?: number };

/** An isolated external HTTP Provider with a fixed, observable reply sequence. */
export async function startFlexProvider(replies: readonly FlexReply[]) {
  const requests: { body: any; closedEarly: boolean }[] = [];
  const held = new Map<number, () => void>();
  const responses = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = []; for await (const chunk of request) parts.push(Buffer.from(chunk));
    const index = requests.length;
    const record = { body: JSON.parse(Buffer.concat(parts).toString()), closedEarly: false };
    requests.push(record); responses.add(response);
    response.on('close', () => { record.closedEarly = !response.writableEnded; responses.delete(response); held.delete(index); });
    const reply = replies[index] ?? { text: 'unexpected extra provider call', status: 400 };
    const send = () => {
      if (reply.status) { response.writeHead(reply.status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'synthetic provider failure' } })); return; }
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      for (const delta of [{ role: 'assistant', content: reply.text }, {}]) response.write(`data: ${JSON.stringify({ id: 'synthetic-flex', object: 'chat.completion.chunk', created: 1, model: record.body.model, choices: [{ index: 0, delta, finish_reason: 'content' in delta ? null : 'stop' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
    };
    if (reply.hold) held.set(index, send); else send();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Synthetic provider address missing');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, requests,
    release: (index: number) => { const send = held.get(index); if (!send) throw new Error('No held synthetic reply'); held.delete(index); send(); },
    waitForRequests: (count: number) => new Promise<void>((resolve, reject) => { const start = Date.now(); const timer = setInterval(() => { if (requests.length >= count) { clearInterval(timer); resolve(); } else if (Date.now() - start > 10_000) { clearInterval(timer); reject(new Error('Synthetic request missing')); } }, 5); }),
    close: () => new Promise<void>((resolve, reject) => { for (const response of responses) response.destroy(); server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }),
  };
}
