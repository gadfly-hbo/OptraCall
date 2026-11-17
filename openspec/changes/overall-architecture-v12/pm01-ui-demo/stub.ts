/** Pure UI scope preview. No Host, Pi, Provider, credentials or business records. */
import { installDemoStub, ids } from '../ui-demo/stub.ts';
import { isBaseline, previewScope } from './scope.tsx';
const clone = <T,>(value: T): T => structuredClone(value);
type Data = Record<string, any>;
const catalog = [
  { id: 'plan-v1', title: '经营计划.md（合成）', target: { kind: 'project-document', projectId: ids.project, uploadId: 'plan', path: '020_clean/经营计划.md' }, version: 'v1', sha256: '1'.repeat(64) },
  { id: 'period-v2', title: '会员口径说明.md（合成）', target: { kind: 'project-document', projectId: ids.project, uploadId: 'period', path: '020_clean/会员口径说明.md' }, version: 'v2', sha256: '2'.repeat(64) },
  { id: 'supply-v1', title: '库存背景.md（合成）', target: { kind: 'project-document', projectId: ids.project, uploadId: 'supply', path: '020_clean/库存背景.md' }, version: 'v1', sha256: '3'.repeat(64) },
];
const bodies: Record<string, string> = { 'plan-v1': '合成经营计划：本期先核对会员群体、可比期间和商品可得性；现金预算与当期费用分别记录，季节变化仍是替代解释，不据此认定因果。', 'period-v2': '合成口径说明：本期尚未取得可比完整期间；退款、会员范围和重复购买口径待核对。', 'supply-v1': '合成库存背景：关键尺码可得性待补证，库存资金、供应周期和替代商品均为未知前提。' };
const owners = new Map<string, Data>(), messages = new Map<string, Data[]>(), receipts = new Map<string, Data>();
const traces: Data[] = [];
const time = () => new Date().toISOString();
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const snapshot = (owner: Data) => ({ sessionId: `demo-${owner.id}`, messages: clone(messages.get(owner.id) || []), tools: [], status: 'idle', sdkVersion: '1.4.0 · 未运行', capabilities: {} });
const detail = (owner: Data) => ({ discussion: clone(owner), busy: false, snapshot: snapshot(owner), goals: [], goalContentHashes: {}, replies: [], ...(receipts.has(owner.id) ? { requestReceipt: clone(receipts.get(owner.id)) } : {}) });
const scenario = new URL(location.href).searchParams.get('scopeScenario');
if (scenario === 'legacy' || scenario === 'selected-empty') {
  const id = 'de000000-0000-4000-8000-000000000001'; owners.set(id, { id, title: scenario === 'legacy' ? '原讨论 · 保持原手选范围（合成）' : '明确空限选 · 不使用项目背景（合成）', revision: 1, configurationId: 'synthetic-demo', configurationRevision: 1, projectId: ids.project, sources: scenario === 'legacy' ? [catalog[0]] : [], methods: [], usageContext: { kind: 'organization', background: '服饰零售；全为合成' }, createdAt: time(), updatedAt: time() });
}
export function installScopeDemo() {
  installDemoStub(); const fallback = window.fetch.bind(window);
  window.fetch = (async (resource: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource), location.href);
    if (url.origin !== location.origin) throw new TypeError('Pure scope preview blocks external requests');
    const method = (options?.method || 'GET').toUpperCase();
    if (url.pathname === '/api/settings/usage-context') return response({ formatVersion: 1, revision: 1, context: { kind: 'organization', background: '合成服饰零售背景' }, operations: [] });
    if (!url.pathname.startsWith('/api/strategy/discussions')) return fallback(resource, options);
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let input: Data = {}; try { input = typeof options?.body === 'string' ? JSON.parse(options.body) : {}; } catch { return response({ code: 'invalid_demo_input' }, 400); }
    const suffix = url.pathname.slice('/api/strategy/discussions'.length), parts = suffix.split('/').filter(Boolean), id = parts[0];
    if (!id && method === 'GET') return response({ discussions: [...owners.values()] });
    if (!id && method === 'POST') { const owner = { ...input, id: input.operationId, title: input.title || '合成背景讨论', revision: 1, configurationId: input.configurationId || 'synthetic-demo', configurationRevision: 1, methods: input.methods || [], sources: input.sources || [], sourceScope: previewScope(), createdAt: time(), updatedAt: time() }; owners.set(owner.id, owner); return response({ discussion: clone(owner) }, 201); }
    const owner = owners.get(id); if (!owner) return response({ code: 'demo_discussion_missing' }, 404);
    if (!parts[1] && method === 'GET') return response(detail(owner));
    if (!parts[1] && method === 'PATCH') { if (input.expectedRevision !== owner.revision) return response({ code: 'strategy_discussion_conflict' }, 409); Object.assign(owner, input, { sourceScope: previewScope(), revision: owner.revision + 1, updatedAt: time() }); return response({ discussion: clone(owner) }); }
    if (parts[1] === 'sources') return response({ sources: scenario === 'empty' ? [] : catalog });
    if (parts[1] === 'events') { let timer: ReturnType<typeof setInterval>; return new Response(new ReadableStream({ start(controller) { const emit = (value: string) => { try { controller.enqueue(new TextEncoder().encode(value)); } catch { clearInterval(timer); } }; emit(`data: ${JSON.stringify({ type: 'snapshot', projectId: owner.id, snapshot: snapshot(owner) })}\n\n`); timer = setInterval(() => emit(': UI-preview-heartbeat\n\n'), 15000); options?.signal?.addEventListener('abort', () => { clearInterval(timer); try { controller.close(); } catch {} }, { once: true }); }, cancel() { clearInterval(timer); } }), { headers: { 'content-type': 'text/event-stream' } }); }
    if (parts[1] === 'messages' && method === 'POST') {
      const scope = previewScope(), selected = clone(owner.sources || []), candidates = !owner.projectId || scenario === 'empty' ? [] : (isBaseline || scope.mode === 'selected-only' ? selected : catalog).filter((item: Data) => !scope.excludedSources.some(excluded => excluded.id === item.id));
      const read = candidates[0], body = read ? bodies[read.id] || '' : ''; const trace = { requestId: input.requestId, sourceScope: scope, directory: candidates.map((item: Data) => ({ id: item.id, version: item.version, sha256: item.sha256, bodyRead: false })), actualReads: read ? [{ id: read.id, version: read.version, sha256: read.sha256, range: { start: 0, end: body.length, total: body.length }, complete: true, body }] : [] }; traces.push(trace);
      const text = read ? `交互演示：发现 ${candidates.length} 项适用背景，按需读取“${read.title}”准确 ${read.version}，返回范围 0–${body.length}/${body.length}。原文：${body} 目录其他项目未读。这里没有真实模型或专业判断。` : owner.projectId && scope.mode === 'selected-only' ? '交互演示：本次明确仅限手选且清单为空，未读取项目背景。我可以继续讨论当前说明，并具体指出需要补充的资料。' : '交互演示：当前范围没有可用背景，未读取资料；可继续围绕已有说明讨论，不推断资料已经齐备。';
      const userId = crypto.randomUUID(), list = messages.get(id) || []; list.push({ role: 'user', originalUserText: input.text, content: [{ type: 'text', text: input.text }], nativeEntryId: userId }, { role: 'assistant', content: [{ type: 'text', text }], nativeEntryId: crypto.randomUUID() }); messages.set(id, list);
      owner.lastRun = { id: input.requestId, fingerprint: 'synthetic-preview', status: 'completed' }; owner.revision++; owner.updatedAt = time(); receipts.set(id, { requestId: input.requestId, originalUserText: input.text, nativeEntryId: userId, sessionId: `demo-${id}` }); return response({ discussion: clone(owner), requestId: input.requestId }, 202);
    }
    if (parts[1] === 'stop' || parts[1] === 'close') return response(parts[1] === 'stop' ? { stopped: false } : { closed: true });
    return response({ code: 'scope_preview_endpoint_unavailable', synthetic: true }, 503);
  }) as typeof window.fetch;
}
export function scopeDemoState() { return clone({ synthetic: true, scope: previewScope(), owners: [...owners.values()], traces }); }
