import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProjectAgent, type ProjectEvent } from '../src/agent/project-runtime.ts';
import { createHost } from '../src/host/server.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

test('SM05/SM07: restored task rejects stale editor events and preserves native snapshot/UI event order', { timeout: 30_000 }, async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-resource-guard-'));
  const provider = await startSyntheticProvider();
  const host = createHost({ cwd: process.cwd(), uiPorts: [4183], transportVersion: '8.12.2', dataRoot: path.join(scratch, 'host'), projectsRoot: path.join(scratch, 'projects') });
  t.after(async () => { await host.close(); await provider.close(); });
  await host.ready;
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address(); assert.ok(address && typeof address === 'object');
  const request = async (route: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/${route}`, { method, headers: { 'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(response.status, method === 'POST' && (route === 'projects' || route.endsWith('/tasks')) ? 201 : 200, await response.clone().text());
    return response.json();
  };
  const delivered: Array<(event: ProjectEvent) => void> = [];
  const original = ProjectAgent.prototype.subscribe;
  ProjectAgent.prototype.subscribe = function (listener) { delivered.push(listener); return original.call(this, listener); };
  t.after(() => { ProjectAgent.prototype.subscribe = original; });

  await request('configuration', 'PUT', { name: 'Guard synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-guard', apiKey: 'synthetic-guard-key' });
  const { project } = await request('projects', 'POST', { name: 'Retained workspace' });
  const { task } = await request(`projects/${project.id}/tasks`, 'POST', { name: 'Retained task' });
  const route = `projects/${project.id}/tasks/${task.id}`;
  await request(`${route}/open`, 'POST', {});
  assert.equal(delivered.length, 1);
  const retired = delivered[0]!;
  await request(`projects/${project.id}/archive`, 'POST', {});
  await request(`projects/${project.id}/restore`, 'POST', {});
  await request(`${route}/open`, 'POST', {});
  assert.equal(delivered.length, 2);
  await request(`${route}/draft`, 'PATCH', { text: 'Current user draft' });

  // A callback already delivered by the transport can outlive resource disposal.
  retired({ type: 'ui.editor', text: 'STALE_RESOURCE_DRAFT' });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await request(route)).task.draft, 'Current user draft');

  delivered[1]!({ type: 'ui.editor', text: 'Current extension draft' });
  const deadline = Date.now() + 3000;
  while ((await request(route)).task.draft !== 'Current extension draft') {
    assert.ok(Date.now() < deadline, 'The current resource editor update must remain supported');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const response = await fetch(`http://127.0.0.1:${address.port}/api/${route}/events`, { headers: { 'x-optracall-client': '1' } });
  assert.equal(response.status, 200); assert.ok(response.body);
  const reader = response.body.getReader(), decoder = new TextDecoder(), events: ProjectEvent[] = [];
  const pump = (async () => {
    let buffer = '';
    for (;;) {
      const next = await reader.read(); if (next.done) return;
      buffer += decoder.decode(next.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const line = block.split('\n').find(value => value.startsWith('data: '));
        if (line) events.push(JSON.parse(line.slice(6)));
      }
    }
  })();
  try {
    const latest = await request(route);
    delivered[1]!({ type: 'snapshot', snapshot: { ...latest.snapshot, capabilities: { eventOrderMarker: true } } });
    delivered[1]!({ type: 'ui.request', request: { id: 'synthetic-event-order', method: 'confirm', title: 'Synthetic event order' } });
    const until = Date.now() + 3000;
    while (!events.some(event => event.type === 'snapshot' && event.snapshot.capabilities.eventOrderMarker) || !events.some(event => event.type === 'ui.request' && event.request.id === 'synthetic-event-order')) {
      assert.ok(Date.now() < until, 'Both native events must reach the current owner stream');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const snapshot = events.findIndex(event => event.type === 'snapshot' && event.snapshot.capabilities.eventOrderMarker);
    const question = events.findIndex(event => event.type === 'ui.request' && event.request.id === 'synthetic-event-order');
    assert.ok(snapshot < question, 'An earlier native snapshot must not arrive after and dismiss a newer UI question');
  } finally { await reader.cancel(); await pump; }
  assert.equal(provider.requests.length, 0, 'Open, archive/restore and editor events must not send model requests');
});
