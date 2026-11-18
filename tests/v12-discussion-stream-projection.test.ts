import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './fixtures/register-ui.ts';
import type { NativeMessage } from '../src/host/ui/project-types.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import * as client from '../src/host/ui/strategy-discussion-client.ts';
import { projectDiscussionSnapshot, projectDiscussionStreaming } from '../src/host/ui/strategy-discussion-projection.ts';
import type { ProjectEvent, ProjectSnapshot } from '../src/agent/project-runtime.ts';

test('two real Pi turns keep both legitimate identical replies while snapshot and stream render no extra copy', { timeout: 65000 }, async t => {
  const host = await startTestHost(), provider = await startToolProvider();
  let stopWatching = () => {};
  t.after(async () => { stopWatching(); await host.close(); await provider.close(); });
  const originalFetch = globalThis.fetch, reply = '合成同文回复必须按两个原生条目保留。';
  const req = async (route: string, method = 'GET', body?: unknown) => { const response = await originalFetch(host.baseUrl + route, { method, headers: host.headers, ...(body ? { body: JSON.stringify(body) } : {}) }); assert.ok(response.ok, `${route}: ${response.status}`); return response.json(); };
  await req('/api/configuration', 'PUT', { name: 'Stream projection fixture', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-stream-projection', apiKey: 'synthetic-projection-only' });
  provider.setResponder(context => context.recentToolResults.length ? { text: reply } : { calls: [{ name: 'strategy_goals', arguments: { action: 'read-goals' } }] });
  const id = randomUUID(); await req('/api/strategy/discussions', 'POST', { operationId: id });
  t.mock.method(globalThis, 'fetch', (resource: RequestInfo | URL, init?: RequestInit) => { const route = String(resource); return originalFetch(route.startsWith('/api/') ? host.baseUrl + route : resource, { ...init, headers: route.startsWith('/api/') ? { ...init?.headers, ...host.headers } : init?.headers }); });
  let detail = await client.readStrategyDiscussion(id), snapshot: ProjectSnapshot = detail.snapshot, streaming = '';
  const events: ProjectEvent[] = [], projection: { label: string; messages: number; streaming: string; count: number }[] = [];
  const { StrategyDiscussionTranscript } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  const render = () => renderToStaticMarkup(createElement(StrategyDiscussionTranscript, { messages: snapshot.messages.filter((message): message is NativeMessage => message.role === 'user' || message.role === 'assistant'), streaming }));
  const apply = (event: ProjectEvent, label: string = event.type) => { const previousSnapshot = snapshot; snapshot = projectDiscussionSnapshot(snapshot, event); streaming = projectDiscussionStreaming(streaming, event, previousSnapshot); projection.push({ label, messages: snapshot.messages.length, streaming, count: render().split(reply).length - 1 }); };
  let disconnectAfterFinalSnapshot = false, disconnectedBeforeSettled = false;
  const controllers: AbortController[] = [], watches: Promise<void>[] = [];
  const startWatching = () => {
    const controller = new AbortController(); controllers.push(controller);
    const watching = client.watchStrategyDiscussion(id, event => {
      events.push(event); apply(event);
      if (disconnectAfterFinalSnapshot && event.type === 'snapshot' && event.snapshot.messages.filter(message => message.role === 'assistant' && JSON.stringify(message.content).includes(reply)).length === 2) {
        disconnectedBeforeSettled = true; disconnectAfterFinalSnapshot = false; controller.abort();
      }
    }, controller.signal).catch(error => { if (!controller.signal.aborted) throw error; }); watches.push(watching);
  };
  stopWatching = () => { controllers.forEach(controller => controller.abort()); };
  t.after(async () => { stopWatching(); await Promise.all(watches); });
  startWatching();
  for (let attempt = 0; attempt < 100 && !events.length; attempt++) await delay(10);
  const rounds: { html: string; nativeCount: number; getCount: number; projectedCount: number }[] = [];
  for (let round = 1; round <= 2; round++) {
    detail = await client.readStrategyDiscussion(id);
    if (round === 2) { await client.updateStrategyDiscussion(id, { expectedRevision: detail.discussion.revision, methods: [{ id: 'rumelt', name: 'Rumelt' }] }); detail = await client.readStrategyDiscussion(id); disconnectAfterFinalSnapshot = true; }
    await client.sendStrategyDiscussionMessage(id, { requestId: randomUUID(), expectedRevision: detail.discussion.revision, text: `第${round}轮问题，保留原讨论与同文合法回复。` });
    for (let attempt = 0; attempt < 400; attempt++) { detail = await client.readStrategyDiscussion(id); if (!detail.busy && ['completed', 'failed', 'cancelled'].includes(detail.discussion.lastRun?.status || '')) break; await delay(10); }
    assert.equal(detail.discussion.lastRun?.status, 'completed'); await delay(25);
    if (round === 2) { assert.equal(disconnectedBeforeSettled, true); const before = events.length; startWatching(); for (let attempt = 0; attempt < 100 && events.length === before; attempt++) await delay(10); }
    // A user-triggered GET is authoritative, but must also retire a stream already represented by it.
    apply({ type: 'snapshot', snapshot: detail.snapshot }, 'GET');
    const native = (await readFile(detail.snapshot.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const nativeCount = native.filter(entry => entry.type === 'message' && entry.message.role === 'assistant' && JSON.stringify(entry.message.content).includes(reply)).length;
    const getCount = detail.snapshot.messages.filter(message => message.role === 'assistant' && JSON.stringify(message.content).includes(reply)).length;
    rounds.push({ html: render(), nativeCount, getCount, projectedCount: render().split(reply).length - 1 });
  }
  const oldRunning = { ...snapshot, status: 'running' as const };
  assert.equal(projectDiscussionStreaming(reply, { type: 'snapshot', snapshot: oldRunning }, oldRunning), reply, 'old same-text history does not retire the current stream');
  const projectedAssistant = snapshot.messages.filter(message => message.role === 'assistant').at(-1)!;
  const raw = { ...projectedAssistant }; delete raw.nativeEntryId; delete raw.nativeSessionId;
  assert.equal(projectDiscussionSnapshot(snapshot, { type: 'native', event: { type: 'message_end', message: raw } }), snapshot, 'raw message_end cannot append a second copy or bypass originalUserText projection');
  const evidence = new URL('../.local/v12-implementation/ui/stream-projection/', import.meta.url); await mkdir(evidence, { recursive: true }); await writeFile(new URL('events-get-renderer.json', evidence), JSON.stringify({ events, projection, rounds, disconnectedBeforeSettled }, null, 2));
  assert.equal(Math.max(...projection.map(frame => frame.count)), 2, 'no frame appends the committed reply and its streaming tail together');
  assert.deepEqual(rounds.map(round => round.nativeCount), [1, 2]); assert.deepEqual(rounds.map(round => round.getCount), [1, 2]); assert.deepEqual(rounds.map(round => round.projectedCount), [1, 2]);
});
