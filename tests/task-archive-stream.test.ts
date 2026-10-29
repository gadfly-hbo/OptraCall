import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHost } from '../src/host/server.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

test('LIFE-02: archive releases a read-only task subscription even when no SDK worker was opened', { timeout: 10000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  assert.equal((await host.request('/api/configuration', 'PUT', { name: 'Subscription synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-subscription-key' })).status, 200);
  const created = await host.request('/api/projects', 'POST', { name: 'Read-only subscription project' }); assert.equal(created.status, 201); const { project } = await created.json();
  const added = await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'Never activated task' }); assert.equal(added.status, 201); const { task } = await added.json();
  const controller = new AbortController(); t.after(() => controller.abort());
  const response = await host.request(`/api/projects/${project.id}/tasks/${task.id}/events`, 'GET', undefined, controller.signal); assert.equal(response.status, 200);
  const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = '';
  while (!buffer.includes('"type":"snapshot"')) { const chunk = await reader.read(); assert.equal(chunk.done, false); buffer += decoder.decode(chunk.value); }
  assert.equal((await host.request(`/api/projects/${project.id}/archive`, 'POST', {})).status, 200);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const closed = await Promise.race([reader.read(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Archive must close the pre-existing read-only SSE subscription.')), 1000); })]);
    assert.equal(closed.done, true); assert.equal(provider.requests.length, 0);
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
});

test('LIFE-02: a stale active read cannot start an SDK worker after archive succeeds', { timeout: 20000 }, async t => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-archive-admission-')), dataRoot = path.join(scratch, 'host'), marker = path.join(scratch, 'native-started.txt');
  const extensions = path.join(dataRoot, 'pi', 'extensions'); await fs.mkdir(extensions, { recursive: true });
  await fs.writeFile(path.join(extensions, 'startup.ts'), `import { appendFileSync } from 'node:fs'; export default function (pi) { pi.on('session_start', () => appendFileSync(${JSON.stringify(marker)}, 'started')); }\n`);
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = createHost({ cwd: process.cwd(), uiPorts: [4183], transportVersion: '8.12.2', dataRoot, projectsRoot: path.join(scratch, 'projects') }); await host.ready;
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve)); t.after(() => host.close()); const address = host.server.address(); assert.ok(address && typeof address === 'object');
  const api = (route: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${address.port}/api/${route}`, { method, headers: { origin: 'http://127.0.0.1:4183', 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await api('configuration', 'PUT', { name: 'Admission synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-admission-key' })).status, 200);
  const { project } = await (await api('projects', 'POST', { name: 'Atomic admission' })).json(); const { task } = await (await api(`projects/${project.id}/tasks`, 'POST', { name: 'Must stay dormant' })).json();
  let entered!: () => void, release!: () => void, armed = true; const reached = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  const original = host.projects.get.bind(host.projects); host.projects.get = async id => { const value = await original(id); if (id === project.id && armed) { armed = false; entered(); await barrier; } return value; }; t.after(() => { host.projects.get = original; release(); });
  const sending = api(`projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: 'This must not initialize after archive.', requestId: randomUUID() }); await reached;
  try { assert.equal((await api(`projects/${project.id}/archive`, 'POST', {})).status, 200); } finally { release(); }
  const rejected = await sending; assert.equal(rejected.status, 409, await rejected.clone().text()); assert.equal((await rejected.json()).code, 'project_archived');
  const started = await fs.stat(marker).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  assert.equal(started, false, 'Successful archive must prevent even a native extension startup hook from running.'); assert.equal(provider.requests.length, 0);
});
