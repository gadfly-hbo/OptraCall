import type { IncomingMessage, ServerResponse } from 'node:http';
import { CandidateControlError, type AgentCandidateControls, type CandidateControlInput } from './agent-candidate-controls.ts';
import { CandidateReadError, type CandidateLookupInput, type createAgentCandidateReader } from './agent-candidate-reader.ts';

type Options = { request: IncomingMessage; response: ServerResponse; url: URL; reader: ReturnType<typeof createAgentCandidateReader>; controls: AgentCandidateControls; readBody: (request: IncomingMessage, limit?: number) => Promise<Record<string, unknown>>; isClosing: () => boolean; experienceLearningEnabled?: boolean };
function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(body));
}
export async function handleAgentCandidateRoute({ request, response, url, reader, controls, readBody, isClosing, experienceLearningEnabled = true }: Options): Promise<boolean> {
  const prefix = '/api/personal-retention/candidates';
  if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return false;
  try {
    if (url.pathname === prefix + '/lookup' && request.method === 'GET') {
      const names = ['query', 'includeBody', 'category', 'view', 'parentState', 'savedPath', 'cursor', 'pageSize'];
      if ([...url.searchParams.keys()].some(k => !names.includes(k)) || names.some(k => url.searchParams.getAll(k).length > 1)) throw new CandidateReadError('invalid_candidate_query', 400);
      const raw = Object.fromEntries(url.searchParams);
      if (raw.includeBody !== undefined && !['true', 'false'].includes(raw.includeBody) || raw.pageSize !== undefined && !/^[1-9][0-9]*$/.test(raw.pageSize)) throw new CandidateReadError('invalid_candidate_query', 400);
      const input = { ...raw, ...(raw.includeBody === undefined ? {} : { includeBody: raw.includeBody === 'true' }), ...(raw.pageSize === undefined ? {} : { pageSize: Number(raw.pageSize) }) } as CandidateLookupInput;
      send(response, 200, { ...await reader.lookup(input), experienceLearningAvailable: experienceLearningEnabled }); return true;
    }
    if (url.pathname === prefix + '/read' && request.method === 'POST') {
      const input = await readBody(request, 32768);
      if (Object.keys(input).length !== 1 || !('ref' in input)) throw new CandidateReadError('invalid_candidate_ref', 400);
      send(response, 200, await reader.read(input.ref as Parameters<typeof reader.read>[0])); return true;
    }
    if (url.pathname === prefix + '/controls' && request.method === 'POST') {
      if (isClosing()) throw new CandidateReadError('candidate_host_closing', 503);
      const input = await readBody(request, 65536);
      const result = await controls.apply(input as CandidateControlInput);
      send(response, result.replayed ? 200 : 201, result); return true;
    }
    const match = /^\/api\/personal-retention\/candidates\/operations\/([a-f0-9-]+)$/.exec(url.pathname);
    if (match && request.method === 'GET') {
      const original = await controls.operation(match[1]!);
      send(response, 200, original ? { ...original, state: await controls.readState(original.event.target) } : { storeId: null, event: null, state: null }); return true;
    }
    send(response, 404, { code: 'candidate_route_not_found', message: '未找到候选操作。' }); return true;
  } catch (e) {
    const known = e instanceof CandidateControlError || e instanceof CandidateReadError;
    if (!known && e && typeof e === 'object' && 'status' in e) throw e;
    const code = known ? e.code : 'candidate_history_unavailable', status = known ? e.status : 503;
    const message = code === 'candidate_controls_capacity_exceeded' || code.includes('too_large') ? '记录已达到容量边界，旧记录保持，请保留输入。'
      : e instanceof CandidateControlError && e.currentState ? '同一候选已变化，请核对现状态；原意图保留，未自动覆盖。'
      : code.includes('operation_conflict') ? '原操作标识已绑定另一请求，请回查原操作。'
      : '精确候选或人的记录未能核对（UNKNOWN）；原文与历史保持，不改用最新稿或重放。';
    send(response, status, { code, message, ...(e instanceof CandidateControlError && e.currentState ? { currentState: e.currentState } : {}) }); return true;
  }
}
