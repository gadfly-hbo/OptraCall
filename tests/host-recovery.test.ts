import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHost } from '../src/host/server.ts';
import { ProjectAgent } from '../src/agent/project-runtime.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function configure(host: Awaited<ReturnType<typeof startTestHost>>, provider: Awaited<ReturnType<typeof startSyntheticProvider>>) {
  const saved = await host.request('/api/configuration', 'PUT', { name: 'Recovery synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-recovery-only-key' });
  assert.equal(saved.status, 200); const created = await host.request('/api/projects', 'POST', { name: 'Recovery project' }); assert.equal(created.status, 201); return (await created.json()).project;
}
async function waitRun(host: Awaited<ReturnType<typeof startTestHost>>, id: string, requestId: string) {
  const started = Date.now();
  for (;;) { const state = await (await host.request(`/api/projects/${id}`)).json(); if (state.project.lastRun?.id === requestId && state.project.lastRun.status !== 'running') return state; if (Date.now() - started > 10_000) throw new Error('Synthetic run did not settle.'); await pause(10); }
}

test('CHAT-04: every accepted native request UUID stays deduplicated after later turns and across a restart', async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close()); const project = await configure(host, provider);
  const ids = [randomUUID(), randomUUID()];
  for (const [index, requestId] of ids.entries()) { assert.equal((await host.request(`/api/projects/${project.id}/messages`, 'POST', { text: `original-${index}`, requestId })).status, 202); assert.equal((await waitRun(host, project.id, requestId)).project.lastRun.status, 'completed'); }
  const replay = await host.request(`/api/projects/${project.id}/messages`, 'POST', { text: 'original-0', requestId: ids[0] });
  assert.equal(replay.status, 202); assert.equal((await replay.json()).deduplicated, true); assert.equal(provider.requests.length, 2);
  await host.close(); const reopened = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot }); t.after(() => reopened.close());
  assert.equal((await reopened.request(`/api/projects/${project.id}/messages`, 'POST', { text: 'original-0', requestId: ids[0] })).status, 202); assert.equal(provider.requests.length, 2);
  const state = await (await reopened.request(`/api/projects/${project.id}`)).json(); assert.equal(state.snapshot.messages.filter((message: any) => message.role === 'user').length, 2);
});

test('CFG-04: clearing a Provider invalidates an in-flight SDK open before its old credential can be used', async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-clear-opening-'));
  const host = createHost({ cwd: process.cwd(), uiPorts: [4183], transportVersion: '8.12.2', dataRoot: path.join(scratch, 'host'), projectsRoot: path.join(scratch, 'projects') }); await host.ready;
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve)); t.after(() => host.close());
  const address = host.server.address(); assert.ok(address && typeof address === 'object');
  const request = (route: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${address.port}/api/${route}`, { method, headers: { 'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  await request('configuration', 'PUT', { name: 'Opening', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-pending-key' });
  const { project } = await (await request('projects', 'POST', { name: 'Opening project' })).json();
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const original = ProjectAgent.prototype.open;
  ProjectAgent.prototype.open = async function () { const state = await original.call(this); entered(); await barrier; return state; };
  t.after(() => { ProjectAgent.prototype.open = original; release(); });
  const command = request(`projects/${project.id}/commands`, 'POST', { text: '/SYNTHETIC_MUST_NOT_RUN', requestId: randomUUID() });
  await started;
  const cleared = await request('configuration', 'DELETE'); assert.equal(cleared.status, 200);
  release(); const stopped = await command; assert.equal(stopped.status, 409, await stopped.clone().text());
  assert.equal(provider.requests.length, 0);
  const state = await (await request(`projects/${project.id}`)).json(); assert.equal(state.snapshot.capabilities.requiresConfiguration, true);
});

test('CHAT-04: a terminated native child is replaced only when the user explicitly submits a new request', async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-host-native-exit-')), dataRoot = path.join(scratch, 'host'), projectsRoot = path.join(scratch, 'projects');
  const startupCount = path.join(scratch, 'startup-count.txt');
  const extensions = path.join(dataRoot, 'pi', 'extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'controlled-exit.ts'), `import { appendFileSync } from 'node:fs'; export default function (pi) { pi.on('session_start', () => { appendFileSync(${JSON.stringify(startupCount)}, 'start\\n'); }); pi.registerCommand('CRASH_FOR_RECOVERY', { handler: async () => { process.kill(process.pid, 'SIGTERM'); await new Promise(() => {}); } }); }\n`);
  const provider = await startSyntheticProvider(); t.after(() => provider.close()); const host = await startTestHost({ dataRoot, projectsRoot }); t.after(() => host.close()); const project = await configure(host, provider);
  assert.equal((await host.request(`/api/projects/${project.id}`)).status, 200);
  const initialCount = await readFile(startupCount, 'utf8');
  const crashed = await host.request(`/api/projects/${project.id}/commands`, 'POST', { text: '/CRASH_FOR_RECOVERY', requestId: randomUUID() }); assert.equal(crashed.status, 500);
  assert.equal(provider.requests.length, 0);
  const readback = await (await host.request(`/api/projects/${project.id}`)).json();
  assert.equal(readback.project.lastRun.status, 'interrupted'); assert.equal(readback.snapshot.capabilities.runtimeInterrupted, true);
  assert.equal(await readFile(startupCount, 'utf8'), initialCount, 'GET after a crash must not rerun extension startup');
  const controller = new AbortController();
  try {
    const stream = await host.request(`/api/projects/${project.id}/events`, 'GET', undefined, controller.signal), reader = stream.body!.getReader(), decoder = new TextDecoder();
    let wire = ''; while (!wire.includes('"type":"snapshot"')) { const chunk = await reader.read(); assert.equal(chunk.done, false); wire += decoder.decode(chunk.value); }
    assert.equal(await readFile(startupCount, 'utf8'), initialCount, 'SSE reconnect must only read the saved history');
  } finally { controller.abort(); }
  await host.close(); const reopened = await startTestHost({ dataRoot, projectsRoot }); t.after(() => reopened.close());
  const afterRestart = await (await reopened.request(`/api/projects/${project.id}`)).json(); assert.equal(afterRestart.project.lastRun.status, 'interrupted');
  assert.equal(await readFile(startupCount, 'utf8'), initialCount, 'Host restart does not turn an interrupted run into extension startup');
  const requestId = randomUUID(), retried = await reopened.request(`/api/projects/${project.id}/messages`, 'POST', { text: 'Explicit recovery using the same project.', requestId });
  assert.equal(retried.status, 202, await retried.clone().text()); assert.equal((await waitRun(reopened, project.id, requestId)).project.lastRun.status, 'completed'); assert.equal(provider.requests.length, 1);
  assert.equal(await readFile(startupCount, 'utf8'), initialCount + initialCount, 'Only the explicit new request starts the replacement');
});

test('SDK-04: an initial non-model command is durably accepted before any assistant message exists', async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close()); const host = await startTestHost(); t.after(() => host.close()); const project = await configure(host, provider);
  const inspectedId = randomUUID(), inspected = await host.request(`/api/projects/${project.id}/commands`, 'POST', { text: '/tools', requestId: inspectedId });
  assert.equal(inspected.status, 200, await inspected.clone().text()); assert.equal((await inspected.json()).outcome, 'completed'); assert.equal(provider.requests.length, 0);
  const laterId = randomUUID(); await host.request(`/api/projects/${project.id}/messages`, 'POST', { text: 'A later synthetic turn.', requestId: laterId }); await waitRun(host, project.id, laterId);
  await host.close(); const reopened = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot }); t.after(() => reopened.close());
  const replay = await reopened.request(`/api/projects/${project.id}/commands`, 'POST', { text: '/tools', requestId: inspectedId }); assert.equal(replay.status, 200); assert.equal((await replay.json()).result.deduplicated, true); assert.equal(provider.requests.length, 1);
});

test('SDK-04: startup extension UI reaches SSE and can be answered before SDK open completes', async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-startup-question-')), dataRoot = path.join(scratch, 'host'), projectsRoot = path.join(scratch, 'projects');
  const extensions = path.join(dataRoot, 'pi', 'extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'startup-question.ts'), "export default function (pi) { pi.on('session_start', async (_event, ctx) => { if (!await ctx.ui.confirm('Synthetic startup', 'Allow this synthetic environment?')) throw new Error('Synthetic startup declined'); }); }\n");
  const provider = await startSyntheticProvider(); t.after(() => provider.close()); const host = await startTestHost({ dataRoot, projectsRoot }); t.after(() => host.close()); const project = await configure(host, provider);
  const controller = new AbortController(); t.after(() => controller.abort());
  const events = await host.request(`/api/projects/${project.id}/events`, 'GET', undefined, controller.signal); assert.equal(events.status, 200); assert.ok(events.body);
  const reader = events.body.getReader(), decoder = new TextDecoder(); let pending = '', question: any, idle = false;
  const timeout = setTimeout(() => controller.abort(), 10_000); t.after(() => clearTimeout(timeout));
  for (;;) {
    const { done, value } = await reader.read(); assert.equal(done, false); pending += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = pending.indexOf('\n\n')) >= 0) {
      const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2); const line = block.split('\n').find(part => part.startsWith('data: ')); if (!line) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === 'ui.request') { question = event.request; assert.equal(question.method, 'confirm'); assert.equal(question.title, 'Synthetic startup'); const answered = await host.request(`/api/projects/${project.id}/ui-response`, 'POST', { id: question.id, value: true }); assert.equal(answered.status, 200, await answered.clone().text()); }
      if (event.type === 'snapshot' && question && event.snapshot.status === 'idle' && !event.snapshot.uiRequests?.length) idle = true;
    }
    if (idle) break;
  }
  clearTimeout(timeout); controller.abort(); assert.ok(question); assert.equal(provider.requests.length, 0);
});
