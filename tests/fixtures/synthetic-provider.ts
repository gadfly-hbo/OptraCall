import { createServer, type ServerResponse } from 'node:http';

export type SyntheticMode = 'success' | 'failure' | 'slow';
/** Canned decision-board extraction reply, keyed by model name so existing
 * synthetic consumers keep their default plain-text chunks. */
const BOARD_EXTRACT_MODEL = 'synthetic-board-extract';
const BOARD_EXTRACT_REPLY = '好的\n```json\n' + JSON.stringify([
  { title: '补发高价值会员召回权益', rationale: '高价值会员复购显著下滑。', expectedImpact: '挽回部分流失订单', priority: 'high', effort: '2人日', evidence: { level: '数据支撑', reasoning: '复购结论来自清洗数据。', facts: [{ text: '复购率下滑', quote: 'BOARD_QUOTE_MARKER_复购率42%→31%' }] } },
  { title: '核对渠道投放记录', rationale: '渠道贡献主要降幅。', expectedImpact: '', priority: 'medium', effort: '', evidence: { level: '逻辑推断', reasoning: '由渠道结构推断。', facts: [{ text: '渠道降幅最大' }] } },
]) + '\n```\n完';
export async function startSyntheticProvider() {
  const requests: { path: string; authorization?: string; body: { model?: string; messages?: { role: string; content: unknown }[]; tools?: unknown[] }; closedEarly: boolean }[] = [];
  let mode: SyntheticMode = 'success', chunks = ['SDK ', '合成回复'];
  const responses = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/__qa') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ requestCount: requests.length, requests: requests.map(value => ({ path: value.path, model: value.body.model, messages: value.body.messages, closedEarly: value.closedEarly })) })); return; }
    responses.add(response);
    const parts: Buffer[] = []; for await (const chunk of request) parts.push(Buffer.from(chunk));
    const record = { path: request.url ?? '', authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(parts).toString()), closedEarly: false };
    requests.push(record);
    response.on('close', () => { record.closedEarly = !response.writableEnded; responses.delete(response); });
    const requestMode = request.url?.startsWith('/failure/') ? 'failure' : request.url?.startsWith('/slow/') ? 'slow' : mode;
    if (requestMode === 'failure') { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: `synthetic-private-detail ${record.authorization}`, type: 'authentication_error' } })); return; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: 'synthetic', object: 'chat.completion.chunk', created: 1, model: record.body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (requestMode === 'slow') { send({ content: '部分合成回复' }); return; }
    for (const text of record.body.model === BOARD_EXTRACT_MODEL ? [BOARD_EXTRACT_REPLY] : chunks) send({ content: text });
    send({}, 'stop'); response.write('data: [DONE]\n\n'); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Synthetic provider address missing.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, requests,
    setMode: (next: SyntheticMode) => { mode = next; }, setChunks: (next: string[]) => { chunks = next; },
    waitForRequests: (count: number) => new Promise<void>((resolve, reject) => { const started = Date.now(); const timer = setInterval(() => { if (requests.length >= count) { clearInterval(timer); resolve(); } else if (Date.now() - started > 5000) { clearInterval(timer); reject(new Error('Synthetic request missing.')); } }, 5); }),
    close: () => new Promise<void>(resolve => { for (const response of responses) response.destroy(); server.close(() => resolve()); server.closeAllConnections(); }),
  };
}
