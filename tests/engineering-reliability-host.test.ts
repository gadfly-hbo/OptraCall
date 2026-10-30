import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHost } from '../src/host/server.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

async function harness(roots?: { dataRoot: string; projectsRoot: string }) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-er-host-'));
  const dataRoot = roots?.dataRoot ?? path.join(scratch, 'host'), projectsRoot = roots?.projectsRoot ?? path.join(scratch, 'projects');
  const host = createHost({ cwd: process.cwd(), uiPorts: [4183], transportVersion: 'synthetic', dataRoot, projectsRoot, heartbeatIntervalMs: 20 });
  await host.ready;
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { origin: url, 'content-type': 'application/json', 'x-optracall-client': '1' };
  return { host, dataRoot, projectsRoot, close: () => host.close(), request: (route: string, method = 'GET', body?: unknown, signal?: AbortSignal) => fetch(url + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal }) };
}
async function json(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }
async function until(response: Response, match: (text: string) => boolean): Promise<string> {
  assert.equal(response.status, 200); assert.ok(response.body);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let text = '';
  try { while (!match(text)) { const item = await reader.read(); if (item.done) break; text += decoder.decode(item.value, { stream: true }); } }
  catch (error) { if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error; }
  finally { await reader.cancel().catch(() => {}); }
  return text;
}
async function setup(h: Awaited<ReturnType<typeof harness>>, baseUrl: string) {
  await json(await h.request('/api/configuration', 'PUT', { name: '可靠性合成配置', provider: 'openai-compatible', baseUrl, model: 'synthetic-reliability', apiKey: 'synthetic-reliability-private-key' }));
  const { project } = await json(await h.request('/api/projects', 'POST', { name: '可靠性合成项目' }), 201);
  const { task } = await json(await h.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '可靠性独立任务' }), 201);
  return { project, task, route: `/api/projects/${project.id}/tasks/${task.id}` };
}

test('ER03: idle task and requirement observations receive heartbeats without opening runtime or calling a model', { timeout: 15_000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const h = await harness(); t.after(() => h.close());
  const f = await setup(h, provider.baseUrl);
  const { instance } = await json(await h.request('/api/requirement-instances', 'POST', { title: '只读连接观察', scene: 'topic' }), 201);
  for (const route of [f.route + '/events', `/api/requirement-instances/${instance.id}/events`]) {
    const response = await h.request(route, 'GET', undefined, AbortSignal.timeout(800));
    const text = await until(response, value => value.includes(': heartbeat\n\n'));
    assert.match(text, /: heartbeat\n\n/, 'An idle observer must receive periodic comments');
  }
  assert.equal(provider.requests.length, 0);
  const state = await json(await h.request(f.route));
  assert.equal(state.task.sessionFile, undefined); assert.equal(state.task.lastRun, undefined);
});

test('ER01/ER02/ER10: safe failure detail survives final SSE, exact-request GET and restart without replay', { timeout: 45_000 }, async t => {
  const provider = await startSyntheticProvider(); provider.setMode('failure'); t.after(() => provider.close());
  let h = await harness(); t.after(() => h.close());
  const f = await setup(h, provider.baseUrl), requestId = randomUUID();
  const stream = await h.request(f.route + '/events', 'GET', undefined, AbortSignal.timeout(30_000));
  const terminal = until(stream, value => value.split('\n').some(line => line.startsWith('data: ') && line.includes('"type":"run.settled"')));
  await json(await h.request(f.route + '/messages', 'POST', { requestId, text: '只做合成失败验收' }), 202);
  const capture = await terminal;
  const settled = capture.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(event => event.type === 'run.settled');
  assert.equal(settled.requestId, requestId); assert.equal(settled.outcome, 'failed');
  assert.equal(settled.diagnostic?.code, 'authentication_failed');
  assert.equal(settled.diagnostic?.stage, 'native_request'); assert.equal(settled.diagnostic?.retryCount, 0);
  assert.ok(!capture.includes('synthetic-reliability-private-key')); assert.ok(!JSON.stringify(settled.diagnostic).includes('synthetic-private-detail'), 'The new diagnostic must not copy raw provider detail; native history remains separate');
  const before = await json(await h.request(f.route));
  assert.deepEqual(before.task.lastRun.diagnostic, settled.diagnostic);
  assert.deepEqual(before.snapshot.lastRun.diagnostic, settled.diagnostic);
  const nativeBefore = await readFile(before.task.sessionFile);
  const roots = { dataRoot: h.dataRoot, projectsRoot: h.projectsRoot };
  await h.close(); h = await harness(roots);
  const after = await json(await h.request(f.route));
  assert.equal(after.task.lastRun.id, requestId); assert.equal(after.task.lastRun.status, 'failed');
  assert.deepEqual(after.task.lastRun.diagnostic, settled.diagnostic);
  assert.deepEqual(after.snapshot.lastRun.diagnostic, settled.diagnostic);
  assert.deepEqual(await readFile(before.task.sessionFile), nativeBefore);
  const duplicate = await json(await h.request(f.route + '/messages', 'POST', { requestId, text: '只做合成失败验收' }), 202);
  assert.equal(duplicate.deduplicated, true); assert.equal(duplicate.status, 'failed');
  assert.equal(provider.requests.length, 1, 'Reading/reopening/duplicate receipts must not resend or switch routes');
});


test('ER01/ER02: requirements failure returns the same safe reason without a format-repair model call', { timeout: 30_000 }, async t => {
  const provider = await startSyntheticProvider(); provider.setMode('failure'); t.after(() => provider.close());
  const h = await harness(); t.after(() => h.close()); await setup(h, provider.baseUrl);
  const created = await json(await h.request('/api/requirement-instances', 'POST', { title: '失败诊断合成需求', scene: 'topic' }), 201);
  const route = `/api/requirement-instances/${created.instance.id}`;
  const before = await json(await h.request(route));
  const value = await json(await h.request(route + '/generate', 'POST', { call: 'elicit' }), 502);
  assert.equal(value.outcome, 'failed'); assert.equal(value.repairAttempts, 0);
  assert.equal(value.diagnostic?.code, 'authentication_failed'); assert.equal(value.diagnostic?.stage, 'native_request');
  assert.equal(value.diagnostic?.retryCount, 0);
  assert.ok(!JSON.stringify(value).includes('synthetic-reliability-private-key'));
  assert.ok(!JSON.stringify(value).includes('synthetic-private-detail'));
  assert.deepEqual((await json(await h.request(route))).instance, before.instance);
  assert.equal(provider.requests.length, 1);
});


test('ER01 recovery window: same-request native settlement restores safe cause before Host lastRun was saved', { timeout: 30_000 }, async t => {
  const provider = await startSyntheticProvider(); provider.setMode('failure'); t.after(() => provider.close());
  let h = await harness(); t.after(() => h.close());
  const f = await setup(h, provider.baseUrl), requestId = randomUUID();
  const stream = await h.request(f.route + '/events', 'GET', undefined, AbortSignal.timeout(20_000));
  const terminal = until(stream, text => text.includes('"type":"run.settled"'));
  await json(await h.request(f.route + '/messages', 'POST', { requestId, text: '恢复窗口合成请求' }), 202); await terminal;
  const completed = await json(await h.request(f.route));
  const expected = completed.task.lastRun.diagnostic, nativeBytes = await readFile(completed.task.sessionFile);
  assert.equal(expected.code, 'authentication_failed');
  const roots = { dataRoot: h.dataRoot, projectsRoot: h.projectsRoot }; await h.close();
  // Recreate the on-disk crash window in this isolated fixture: native settlement
  // exists, but the Host's earlier running marker is the last persisted value.
  const metadataFile = path.join(roots.dataRoot, 'projects', f.project.id, 'project.json');
  const metadata = JSON.parse(await readFile(metadataFile, 'utf8'));
  const stored = metadata.tasks.find((task: { id: string }) => task.id === f.task.id);
  stored.lastRun = { id: requestId, status: 'running', startedAt: completed.task.lastRun.startedAt };
  await writeFile(metadataFile, JSON.stringify(metadata));
  h = await harness(roots);
  const restored = await json(await h.request(f.route));
  assert.equal(restored.task.lastRun.id, requestId); assert.equal(restored.task.lastRun.status, 'failed');
  assert.deepEqual(restored.task.lastRun.diagnostic, expected);
  assert.deepEqual(restored.snapshot.lastRun.diagnostic, expected);
  assert.deepEqual(await readFile(completed.task.sessionFile), nativeBytes);
  assert.equal(provider.requests.length, 1, 'Recovery reads native evidence and does not send another model request');
});

test('ER01 terminal reconciliation: proven native completion clears an earlier uncertain runtime diagnosis', { timeout: 30_000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  let h = await harness(); t.after(() => h.close());
  const f = await setup(h, provider.baseUrl), requestId = randomUUID();
  const stream = await h.request(f.route + '/events', 'GET', undefined, AbortSignal.timeout(20_000));
  const terminal = until(stream, text => text.includes('"type":"run.settled"'));
  await json(await h.request(f.route + '/messages', 'POST', { requestId, text: '原生已完成的合成请求' }), 202); await terminal;
  const completed = await json(await h.request(f.route)), nativeBytes = await readFile(completed.task.sessionFile);
  assert.equal(completed.task.lastRun.status, 'completed');
  const roots = { dataRoot: h.dataRoot, projectsRoot: h.projectsRoot }; await h.close();
  const file = path.join(roots.dataRoot, 'projects', f.project.id, 'project.json'), metadata = JSON.parse(await readFile(file, 'utf8'));
  const stored = metadata.tasks.find((task: { id: string }) => task.id === f.task.id);
  stored.lastRun = { ...stored.lastRun, status: 'interrupted', diagnostic: { code: 'runtime_stopped', stage: 'runtime', retryCount: 0, message: 'earlier uncertain runtime observation' } };
  await writeFile(file, JSON.stringify(metadata));
  h = await harness(roots);
  const restored = await json(await h.request(f.route));
  assert.equal(restored.task.lastRun.status, 'completed'); assert.equal(restored.snapshot.lastRun.outcome, 'completed');
  assert.equal(restored.task.lastRun.diagnostic, undefined, 'A proven successful result must not retain an old runtime failure cause');
  assert.equal(restored.snapshot.lastRun.diagnostic, undefined);
  assert.deepEqual(await readFile(completed.task.sessionFile), nativeBytes);
  assert.equal(provider.requests.length, 1);
  await h.close();
  stored.lastRun.status = 'completed';
  const staleCompletedBytes = Buffer.from(JSON.stringify(metadata));
  await writeFile(file, staleCompletedBytes);
  h = await harness(roots);
  const alreadyCompleted = await json(await h.request(f.route));
  assert.equal(alreadyCompleted.task.lastRun.status, 'completed');
  assert.equal(alreadyCompleted.task.lastRun.diagnostic, undefined, 'Known saved terminal must also filter a contradictory optional diagnostic');
  assert.equal(alreadyCompleted.snapshot.lastRun.diagnostic, undefined);
  assert.deepEqual(await readFile(file), staleCompletedBytes, 'A read must not rewrite old metadata to clean optional diagnostics');
  assert.deepEqual(await readFile(completed.task.sessionFile), nativeBytes);
  assert.equal(provider.requests.length, 1);
});
