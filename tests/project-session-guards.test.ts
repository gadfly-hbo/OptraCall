import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { ProjectAgent, type ProjectEvent } from '../src/agent/project-runtime.ts';
import { createHost } from '../src/host/server.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

test('fixed-draft worker refuses command RPC instead of restoring tools or executing native bash', { timeout: 30_000 }, async t => {
  const scratch = path.resolve('.local/semantic-verification/revision-closeout', `worker-${randomUUID()}`);
  const provider = await startSyntheticProvider();
  const agent = new ProjectAgent({ projectId: 'synthetic-revision', codeRoot: process.cwd(),
    workspace: { cwd: path.join(scratch, 'workspace'), capabilityPolicy: 'fixed-draft', systemPrompt: ['Use only supplied fixed materials and return a new draft.'] },
    sessionDirectory: path.join(scratch, 'native'), resourceRoot: path.join(scratch, 'resources'), managementPorts: [],
    configuration: { id: 'synthetic-revision', revision: 1, name: 'Synthetic revision', provider: 'custom-synthetic-revision', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'synthetic-guard', apiKey: 'synthetic-only-key' },
  });
  t.after(async () => { await agent.close(); await provider.close(); });
  assert.deepEqual((await agent.open()).tools, []);
  for (const command of ['/reload', '/fork', '/new', '/tools', '! echo MUST_NOT_EXECUTE', '/model other', '/skill:unsafe']) {
    await assert.rejects(agent.command(command), error => Boolean(error && typeof error === 'object' && 'cause' in error && /fixed_draft_commands_not_allowed/.test(JSON.stringify(error.cause))));
    assert.deepEqual((await agent.snapshot()).tools, []);
  }
  assert.equal(provider.requests.length, 0, 'native commands must be refused before prompt/tool execution');
  const turn = agent.start('Complete fixed UTF-8 material: amount=10. Return new draft only.', randomUUID());
  await turn.accepted; assert.equal((await turn.completion).outcome, 'completed');
  assert.equal(provider.requests[0]!.body.tools?.length ?? 0, 0);
  assert.deepEqual((await agent.snapshot()).tools, []);
});

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

for (const clearAll of [false, true]) test(`SM06: ${clearAll ? 'global' : 'provider'} clearing blocks its scope and preserves other-provider admission`, { timeout: 30_000 }, async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-clear-admission-'));
  const a = await startSyntheticProvider(), b = await startSyntheticProvider();
  const answer = '```json\n' + JSON.stringify({ clarifications: [{ category: '指标口径', priority: 'should_confirm', question: '是否排除退款？', rationale: 'Synthetic provider isolation' }], facts: [], hypotheses: [] }) + '\n```';
  a.setChunks([answer]); b.setChunks([answer]);
  const host = createHost({ cwd: process.cwd(), uiPorts: [4183], transportVersion: '8.12.2', dataRoot: path.join(scratch, 'host'), projectsRoot: path.join(scratch, 'projects') });
  await host.ready;
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address(); assert.ok(address && typeof address === 'object');
  const request = (route: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${address.port}/api/${route}`, { method, headers: { 'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const original = ProjectAgent.prototype.close;
  let enter!: () => void, release!: () => void, held = false;
  const entered = new Promise<void>(resolve => { enter = resolve; }), drain = new Promise<void>(resolve => { release = resolve; });
  let deletion: Promise<Response> | undefined;
  t.after(async () => { release(); await deletion; ProjectAgent.prototype.close = original; await host.close(); await a.close(); await b.close(); });
  const { configuration } = await (await request('configuration', 'PUT', { name: 'Clear A', provider: 'openai-compatible', baseUrl: a.baseUrl, model: 'synthetic-a', apiKey: 'synthetic-clear-a' })).json();
  const { project } = await (await request('projects', 'POST', { name: 'Idle resource blocker' })).json();
  const { task } = await (await request(`projects/${project.id}/tasks`, 'POST', { name: 'Idle task' })).json();
  assert.equal((await request(`projects/${project.id}/tasks/${task.id}/open`, 'POST', {})).status, 200);
  const { instance } = await (await request('requirement-instances', 'POST', { title: 'New owner during clear', scene: 'topic' })).json();
  ProjectAgent.prototype.close = function () { if (!held) { held = true; enter(); return drain.then(() => original.call(this)); } return original.call(this); };
  deletion = request(clearAll ? 'configuration' : 'configuration?provider=' + encodeURIComponent(configuration.provider), 'DELETE');
  await entered;
  const rejected = await request(`requirement-instances/${instance.id}/generate`, 'POST', { call: 'elicit' });
  assert.equal(rejected.status, 409, await rejected.clone().text());
  assert.equal(a.requests.length, 0, 'A new owner cannot dispatch through the closing provider');

  const selected = await request('configuration', 'PUT', { name: 'Independent B', provider: 'openai-compatible', baseUrl: b.baseUrl, model: 'synthetic-b', apiKey: 'synthetic-clear-b' });
  assert.equal(selected.status, 200);
  assert.equal((await request(`requirement-instances/${instance.id}/generate`, 'POST', { call: 'elicit' })).status, clearAll ? 409 : 200);
  assert.equal(b.requests.length, clearAll ? 0 : 1, 'Only a provider-specific clear permits another provider to dispatch');
  release(); assert.equal((await deletion).status, 200);
  if (clearAll) {
    assert.equal((await request('configuration', 'PUT', { name: 'Explicit after global clear', provider: 'openai-compatible', baseUrl: b.baseUrl, model: 'synthetic-b', apiKey: 'synthetic-clear-b-after' })).status, 200);
    assert.equal((await request(`requirement-instances/${instance.id}/generate`, 'POST', { call: 'elicit' })).status, 200);
  }
  assert.equal(b.requests.length, 1);
  assert.equal(b.requests[0]!.body.model, 'synthetic-b');
  assert.equal(a.requests.length, 0);
});
