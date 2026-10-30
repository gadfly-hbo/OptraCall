import test from 'node:test';
import assert from 'node:assert/strict';
import { observeTask, watchTask, type TaskObservationState } from '../src/host/ui/runtime-client.ts';
import type { ClientProject, ClientTask, ProjectEvent, SessionSnapshot, TaskState } from '../src/host/ui/project-types.ts';

const projectId = 'project-a', taskId = 'task-a', requestId = 'request-a';
const configuration: ClientTask['configuration'] = { id: 'model', revision: 1, name: 'Synthetic', api: 'openai-completions', provider: 'custom', baseUrl: 'https://example.invalid/v1', model: 'synthetic' };
function taskState(status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' = 'completed', id = requestId): TaskState {
  const task: ClientTask = { id: taskId, name: 'A', draft: 'unsent', configuration, createdAt: '', updatedAt: '', sessionStorage: 'task', lastRun: { id, status, startedAt: '' } };
  const project: ClientProject = { schemaVersion: 2, id: projectId, name: 'A', configuration, rootPath: '/synthetic', createdAt: '', updatedAt: '', archivedAt: null, tasks: [task] };
  const snapshot: SessionSnapshot = { sessionId: 'session-a', messages: [{ role: 'assistant', content: 'preserved' }], status: status === 'running' ? 'running' : 'idle', tools: [], sdkVersion: 'synthetic', lastRun: { requestId: id, ...(status === 'completed' || status === 'failed' || status === 'cancelled' ? { outcome: status } : {}) } };
  return { project, task, snapshot };
}
function stream(snapshot: SessionSnapshot, signal?: AbortSignal) {
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`: heartbeat\n\ndata: ${JSON.stringify({ type: 'snapshot', projectId, taskId, snapshot })}\n\n`));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const requestMethod = (init?: RequestInit) => init?.method ?? 'GET';

test('OBS-01: disconnected observation reads exact request terminal and reconnects with GET only', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(), calls: { url: string; method: string }[] = [], readbacks: TaskState[] = [], states: TaskObservationState[] = [];
  let connections = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: requestMethod(init) });
    if (String(url).endsWith('/events')) return stream(taskState(connections++ === 0 ? 'running' : 'completed').snapshot, init?.signal ?? undefined);
    return Response.json(taskState());
  });
  const run = observeTask(projectId, taskId, event => { if (connections === 2 && event.type === 'snapshot') controller.abort(); }, controller.signal, { expectedRequestId: () => requestId, onReadback: value => readbacks.push(value), onConnection: value => states.push(value) });
  await flush(); t.mock.timers.tick(500); await run;
  assert.equal(readbacks.length, 1);
  assert.equal(readbacks[0]?.task.lastRun?.id, requestId);
  assert.equal(readbacks[0]?.snapshot.lastRun?.outcome, 'completed');
  assert.ok(states.some(value => value.state === 'recovering' && value.message?.includes('已完成')));
  assert.deepEqual(calls.map(value => value.method), ['GET', 'GET', 'GET']);
  assert.equal(calls.filter(value => !value.url.endsWith('/events')).length, 1);
});

test('OBS-02: a newer request cannot settle the older request being observed', async t => {
  const controller = new AbortController(), readbacks: TaskState[] = [], states: TaskObservationState[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => String(url).endsWith('/events') ? stream(taskState('running').snapshot) : Response.json(taskState('completed', 'newer-request')));
  await observeTask(projectId, taskId, () => {}, controller.signal, { expectedRequestId: () => requestId, onReadback: value => readbacks.push(value), onConnection: value => { states.push(value); if (value.state === 'recovering' && value.message?.includes('无法确认')) controller.abort(); } });
  assert.equal(readbacks.length, 0);
  assert.ok(states.some(value => value.message?.includes('无法确认')));
});

test('OBS-03: abort during readback cancels GET and never reconnects or posts', async t => {
  const controller = new AbortController(); let reads = 0, connects = 0, readSignal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(requestMethod(init), 'GET');
    if (String(url).endsWith('/events')) { connects++; return stream(taskState('running').snapshot); }
    reads++; readSignal = init?.signal ?? undefined;
    return await new Promise<Response>((_, reject) => readSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  });
  const run = observeTask(projectId, taskId, () => {}, controller.signal);
  await flush(); assert.equal(reads, 1); controller.abort(); await run;
  assert.equal(readSignal?.aborted, true); assert.equal(connects, 1); assert.equal(reads, 1);
});

test('OBS-04: abort during recovery backoff ends promptly without another GET', async t => {
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => { calls++; assert.equal(requestMethod(init), 'GET'); return String(url).endsWith('/events') ? stream(taskState('running').snapshot) : Response.json(taskState('running')); });
  const run = observeTask(projectId, taskId, () => {}, controller.signal);
  await flush(); assert.equal(calls, 2); controller.abort(); await run;
  assert.equal(calls, 2);
});

test('OBS-05: repeated connection/read failures stop after bounded backoff and leave state unknown', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(), states: TaskObservationState[] = []; let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => { calls++; assert.equal(requestMethod(init), 'GET'); throw new TypeError('synthetic disconnect'); });
  const run = observeTask(projectId, taskId, () => {}, controller.signal, { onConnection: value => states.push(value) });
  await flush(); for (const ms of [500, 1500, 3000]) { t.mock.timers.tick(ms); await flush(); } await run;
  assert.equal(calls, 8);
  assert.equal(states.at(-1)?.state, 'disconnected'); assert.match(states.at(-1)?.message ?? '', /未知/);
});

test('OBS-06: inconsistent snapshot versus saved terminal is not adopted as completion', async t => {
  const controller = new AbortController(); let adopted = false;
  const inconsistent = taskState(); inconsistent.snapshot.lastRun!.outcome = 'cancelled';
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => String(url).endsWith('/events') ? stream(taskState('running').snapshot) : Response.json(inconsistent));
  await observeTask(projectId, taskId, () => {}, controller.signal, { expectedRequestId: () => requestId, onReadback: () => { adopted = true; }, onConnection: value => { if (value.state === 'recovering' && value.message?.includes('无法确认')) controller.abort(); } });
  assert.equal(adopted, false);
});

test('OBS-07: mismatched task/project readback is rejected without updating UI', async t => {
  const controller = new AbortController(); let adopted = false;
  const wrongOwner = taskState(); wrongOwner.task.id = 'other-task';
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => String(url).endsWith('/events') ? stream(taskState('running').snapshot) : Response.json(wrongOwner));
  await observeTask(projectId, taskId, () => {}, controller.signal, { onReadback: () => { adopted = true; }, onConnection: value => { if (value.state === 'recovering' && value.message?.includes('无法确认')) controller.abort(); } });
  assert.equal(adopted, false);
});

test('OBS-08: comment heartbeat and foreign owner data do not become task events', async () => {
  const controller = new AbortController(), events: ProjectEvent[] = [];
  const encoder = new TextEncoder(); const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(encoder.encode(`: keepalive\n\ndata: ${JSON.stringify({ type: 'snapshot', projectId: 'other-project', taskId, snapshot: taskState().snapshot })}\n\ndata: ${JSON.stringify({ type: 'snapshot', projectId, taskId, snapshot: taskState().snapshot })}\n\n`)); stream.close(); } }));
  try { await watchTask(projectId, taskId, event => { events.push(event); controller.abort(); }, controller.signal); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(events.length, 1); assert.equal(events[0]?.projectId, projectId);
});

test('OBS-09: adopting another request during GET cannot apply the stale readback', async t => {
  const controller = new AbortController(); let expected = requestId, adopted = false;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    if (String(url).endsWith('/events')) return stream(taskState('running').snapshot);
    expected = 'newer-request'; return Response.json(taskState());
  });
  await observeTask(projectId, taskId, () => {}, controller.signal, { expectedRequestId: () => expected, onReadback: () => { adopted = true; }, onConnection: value => { if (value.state === 'recovering' && value.message?.includes('无法确认')) controller.abort(); } });
  assert.equal(adopted, false);
});

test('OBS-10: guarded adopted-version download reports changed bytes instead of downloading', async t => {
  const { downloadFile, HostRequestError } = await import('../src/host/ui/runtime-client.ts');
  const sha256 = 'a'.repeat(64); let requested = '';
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => { requested = String(url); return Response.json({ code: 'artifact_version_changed', message: 'synthetic changed bytes' }, { status: 409 }); });
  await assert.rejects(downloadFile(projectId, { path: '060_reports/adopted.md', name: 'adopted.md', kind: 'file' }, sha256), error => error instanceof HostRequestError && error.code === 'artifact_version_changed' && error.message.includes('保存版本'));
  assert.equal(new URL(requested, 'http://localhost').searchParams.get('expectedSha256'), sha256);
});

test('OBS-11: failed and cancelled terminals are read back distinctly; interrupted remains unknown', async t => {
  for (const status of ['failed', 'cancelled', 'interrupted'] as const) await t.test(status, async child => {
    const controller = new AbortController(), states: TaskObservationState[] = [], readbacks: TaskState[] = [];
    child.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => String(url).endsWith('/events') ? stream(taskState('running').snapshot) : Response.json(taskState(status)));
    await observeTask(projectId, taskId, () => {}, controller.signal, { onReadback: value => readbacks.push(value), onConnection: value => { states.push(value); if (value.state === 'recovering' && (value.message?.includes('已读回') || value.message?.includes('无法确认'))) controller.abort(); } });
    assert.equal(readbacks.length, status === 'interrupted' ? 0 : 1);
    assert.ok(states.some(value => value.message?.includes(status === 'failed' ? '已失败' : status === 'cancelled' ? '已停止' : '未知')));
  });
});

test('OBS-12: silent observation watchdog aborts observation only and reads back the same request', { timeout: 1000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(); let calls = 0, wireAborted = false, adopted = false;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls++; assert.equal(requestMethod(init), 'GET');
    if (String(url).endsWith('/events')) return new Response(new ReadableStream({ start(body) {
      body.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'snapshot', projectId, taskId, snapshot: taskState('running').snapshot })}\n\n`));
      init?.signal?.addEventListener('abort', () => { wireAborted = true; body.error(new DOMException('Synthetic observation abort', 'AbortError')); }, { once: true });
    } }));
    assert.equal(controller.signal.aborted, false, 'Idle watchdog must not abort the owner/model control signal');
    return Response.json(taskState());
  });
  const run = observeTask(projectId, taskId, () => {}, controller.signal, { idleTimeoutMs: 20, onReadback: () => { adopted = true; }, onConnection: value => { if (value.state === 'recovering' && value.message?.includes('已完成')) controller.abort(); } });
  await flush(); t.mock.timers.tick(20); await run;
  assert.equal(wireAborted, true); assert.equal(adopted, true); assert.equal(calls, 2);
});

test('OBS-13: comment heartbeat resets idle watchdog; outer abort clears it immediately', { timeout: 1000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(); let body: ReadableStreamDefaultController<Uint8Array>, wireSignal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    wireSignal = init?.signal ?? undefined;
    return new Response(new ReadableStream<Uint8Array>({ start(stream) { body = stream; wireSignal?.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')), { once: true }); } }));
  });
  const run = watchTask(projectId, taskId, () => assert.fail('Comment must not become a business event'), controller.signal, { idleTimeoutMs: 20 });
  await flush(); t.mock.timers.tick(10); body!.enqueue(new TextEncoder().encode(': heartbeat\n\n')); await flush();
  t.mock.timers.tick(15); await flush(); assert.equal(wireSignal?.aborted, false);
  controller.abort(); await run; t.mock.timers.tick(100); assert.equal(wireSignal?.aborted, true);
});
