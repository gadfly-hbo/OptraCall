import { createServer, type ServerResponse } from 'node:http';

type WireMessage = { role: string; content?: unknown; tool_call_id?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] };
export type AutomaticSyntheticStage = 'ordinary' | 'cold' | 'compare' | 'author' | 'recheck' | 'compaction';
export type AutomaticSyntheticScenario = 'repair' | 'retain';
export type AutomaticProviderRequest = {
  method: string; path: string; body: { model?: string; messages?: WireMessage[]; tools?: unknown[] };
  stage: AutomaticSyntheticStage; lastUser: string; toolReply: boolean; closedEarly: boolean;
};
export const AUTOMATIC_INITIAL_MARKER = 'AUTOMATIC_FLOW_INITIAL';
export const AUTOMATIC_WARMUP_MARKER = 'AUTOMATIC_FLOW_WARMUP';

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? part.text : '').join('\n');
  return '';
}
/** Extract one JSON object without interpreting report or business content. */
function firstObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
    if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { const value: unknown = JSON.parse(text.slice(start, i + 1)); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
      catch { return undefined; }
    }
  }
  return undefined;
}
function stageOf(text: string): AutomaticSyntheticStage {
  // SDK compaction quotes prior user messages. Quoted markers are history,
  // never another instruction to execute a write tool.
  if (text.startsWith('<conversation>\n')) return 'compaction';
  if (text.includes('自动核算意见已交回原主Agent')) return 'author';
  if (text.includes('修订复查（已知作者信息，不是新冷读）')) return 'recheck';
  if (text.includes('独立核算任务：')) return 'cold';
  if (text.includes('首次回复已保存。现在开放以下固定作者副本')) return 'compare';
  return 'ordinary';
}

/** Synthetic streaming transport only. Values and responses are predeclared;
 * this fixture does not score analysis or prove a real model's reliability. */
export async function startAutomaticProvider(options: { scenario?: AutomaticSyntheticScenario; revisedText?: string } = {}) {
  const requests: AutomaticProviderRequest[] = [];
  let scenario = options.scenario ?? 'repair', holdCold = false, holdOrdinary = false;
  const responses = new Set<ServerResponse>(), coldResponses = new Set<{ response: ServerResponse; finish(): void }>(), ordinaryResponses = new Set<{ response: ServerResponse; finish(): void }>();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    let body: AutomaticProviderRequest['body'];
    try { body = JSON.parse(Buffer.concat(chunks).toString()); }
    catch { response.writeHead(400); response.end(); return; }
    const messages = body.messages ?? [], lastUser = contentText(messages.filter(message => message.role === 'user').at(-1)?.content);
    const stage = stageOf(lastUser), toolReply = messages.at(-1)?.role === 'tool';
    const record: AutomaticProviderRequest = { method: request.method ?? '', path: request.url ?? '', body, stage, lastUser, toolReply, closedEarly: false };
    requests.push(record); responses.add(response);
    response.on('close', () => { record.closedEarly = !response.writableEnded; responses.delete(response); });
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: `automatic-synthetic-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const finish = (text: string) => { if (response.destroyed || response.writableEnded) return; send({ content: text }); send({}, 'stop'); response.write('data: [DONE]\n\n'); response.end(); };
    const writeTool = (reportPath: string, content: string) => {
      send({ tool_calls: [{ index: 0, id: `write_${requests.length}`, type: 'function', function: { name: 'write', arguments: JSON.stringify({ path: reportPath, content }) } }] });
      send({}, 'tool_calls'); response.write('data: [DONE]\n\n'); response.end();
    };
    send({ role: 'assistant', content: '' });
    if (stage === 'compaction') { finish('合成SDK会话摘要：已有两次普通分析及其独立核算返修记录，保留原件，后续按新的用户消息继续。此摘要仅用于合成工程测试。'); return; }
    if (toolReply) {
      if (stage === 'ordinary' && holdOrdinary) { send({ content: '合成普通分析尚在返回最终回复，报告已由write工具生成。' }); const held = { response, finish: () => finish('合成普通分析完成。') }; ordinaryResponses.add(held); response.on('close', () => ordinaryResponses.delete(held)); return; }
      finish(stage === 'author' ? '合成主Agent已通过原生write工具另存修订稿，原稿保留。' : '合成普通分析已通过原生write工具写入指定报告。'); return;
    }
    if (stage === 'cold') {
      if (holdCold) { send({ content: '合成独立核算正在等待，用于验证停止和变化边界。' }); const held = { response, finish: () => finish('合成首次依据：本例核算值为1,900。') }; coldResponses.add(held); response.on('close', () => coldResponses.delete(held)); return; }
      finish('合成首次独立依据：核对源数据后，本例数值为1,900。仅用于技术路径验证。'); return;
    }
    if (stage === 'compare') { finish(scenario === 'retain' ? '合成误报意见：建议将原稿1,900改为2,000。此意见用于测试主Agent不采纳路径。' : '合成对照意见：作者反事实2,120应为1,900，原稿待作者自行核查修订。'); return; }
    if (stage === 'recheck') { finish('合成知情复查：已核对所提供修订版本。此回复不是新的冷读，也不代表真实专业验证。'); return; }
    if (stage === 'author') {
      if (scenario === 'retain') { finish('合成主Agent认为该核算建议不成立，保留原稿1,900；未提交新稿。'); return; }
      const payload = firstObject(lastUser.slice(lastUser.indexOf('自动核算意见已交回原主Agent')));
      const output = payload?.output;
      const reportPath = output && typeof output === 'object' && 'reportPath' in output ? output.reportPath : undefined;
      if (typeof reportPath !== 'string') { finish('合成传输错误：未取得返修输出路径，未代写报告。'); return; }
      writeTool(reportPath, options.revisedText ?? '# 合成修订报告\n\n退款反事实：1,900元。\n'); return;
    }
    const marker = lastUser.indexOf(AUTOMATIC_INITIAL_MARKER);
    if (marker >= 0) {
      const payload = firstObject(lastUser.slice(marker + AUTOMATIC_INITIAL_MARKER.length));
      if (typeof payload?.reportPath === 'string' && typeof payload.content === 'string') { writeTool(payload.reportPath, payload.content); return; }
      finish('合成传输错误：初稿路径或正文未提供。'); return;
    }
    finish(lastUser.includes(AUTOMATIC_WARMUP_MARKER) ? '合成原主会话已建立，尚未生成报告。' : '合成普通回复。');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Synthetic automatic provider address missing.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, requests,
    setScenario(next: AutomaticSyntheticScenario) { scenario = next; },
    holdCold(value = true) { holdCold = value; },
    releaseCold() { for (const value of coldResponses) value.finish(); coldResponses.clear(); },
    holdOrdinaryReplies(value = true) { holdOrdinary = value; },
    releaseOrdinaryReplies() { for (const value of ordinaryResponses) value.finish(); ordinaryResponses.clear(); },
    async waitForStage(stage: AutomaticSyntheticStage, count = 1, timeoutMs = 10000) {
      const deadline = Date.now() + timeoutMs;
      while (requests.filter(request => request.stage === stage).length < count) { if (Date.now() >= deadline) throw new Error(`Synthetic ${stage} request missing; stages=${requests.map(value => value.stage).join(',')}`); await new Promise(resolve => setTimeout(resolve, 10)); }
    },
    close: () => new Promise<void>(resolve => { for (const response of responses) response.destroy(); coldResponses.clear(); ordinaryResponses.clear(); server.close(() => resolve()); server.closeAllConnections(); }),
  };
}
