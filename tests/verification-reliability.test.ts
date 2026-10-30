import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHost } from '../src/host/server.ts';
import { createVerificationStore } from '../src/host/verification-store.ts';

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() >= deadline) assert.fail('Synthetic operation did not settle');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function fixture(t: TestContext, label: string) {
  const root = path.resolve('.local/semantic-verification/reliability-closeout', `${label}-${randomUUID()}`);
  const dataRoot = path.join(root, 'host-data'), projectsRoot = path.join(root, 'projects');
  await mkdir(root, { recursive: true });
  let hold = false, release: (() => void) | undefined;
  const requests: unknown[] = [], responses = new Set<ServerResponse>();
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    responses.add(response); response.once('close', () => responses.delete(response));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta: object, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: `synthetic-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: 'synthetic-reliability-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    send({ role: 'assistant', content: '' });
    if (hold) await new Promise<void>(resolve => { release = resolve; });
    if (response.destroyed) return;
    send({ content: 'SYNTHETIC_EXPLICIT_COMPLETED_REPLY' }); send({}, 'stop'); response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerAddress = provider.address(); assert.ok(providerAddress && typeof providerAddress !== 'string');
  const host = createHost({ cwd: process.cwd(), dataRoot, projectsRoot, uiPorts: [4183], transportVersion: 'synthetic-reliability-test' });
  await host.ready; await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address(); assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  async function request(route: string, method = 'GET', body?: object, expected = 200): Promise<any> {
    const response = await fetch(baseUrl + route, { method, headers: { 'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
  }
  t.after(async () => {
    release?.();
    await host.close().catch(() => {});
    // A failing close regression must not leave this new test's resources alive.
    // These are fixture-owned public handles, never a production/root-wide cleanup.
    await Promise.allSettled([host.cases.close(), host.projects.close()]);
    if (host.server.listening) { const closed = new Promise<void>(resolve => host.server.close(() => resolve())); host.server.closeAllConnections(); await closed; }
    for (const response of responses) response.destroy();
    await new Promise<void>(resolve => { provider.close(() => resolve()); provider.closeAllConnections(); });
    await writeFile(path.join(root, 'synthetic-requests.json'), JSON.stringify(requests, null, 2));
  });
  await request('/api/configuration', 'PUT', { name: '合成故障诊断模型', provider: 'openai-compatible', baseUrl: `http://127.0.0.1:${providerAddress.port}/v1`, model: 'synthetic-reliability-model', apiKey: 'synthetic-reliability-only' });
  const { project } = await request('/api/projects', 'POST', { name: '保留全部测试内容' }, 201);
  const { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原任务' }, 201);
  await request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'data.csv', content: Buffer.from('id,amount\na,10\n').toString('base64') }, 201);
  await request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'author.md', text: 'SYNTHETIC_ORIGINAL_AUTHOR' }, 201);
  const owner = { projectId: project.id, taskId: task.id, verificationId: randomUUID() };
  const route = `/api/projects/${project.id}/tasks/${task.id}/verifications/${owner.verificationId}`;
  const read = async () => (await request(route)).verification;
  await request(route.slice(0, route.lastIndexOf('/')), 'POST', { verificationId: owner.verificationId, question: '核对合成金额10并保留未知。', dataFiles: ['020_clean/data.csv'], authorFiles: ['060_reports/author.md'] }, 202);
  await until(read, value => value.status === 'completed');
  assert.equal(requests.length, 2);
  return { root, dataRoot, projectsRoot, project, task, owner, route, read, request, host, requests,
    holdNext: () => { hold = true; },
    release: () => { hold = false; release?.(); },
    waitForRevision: () => until(async () => requests.length, count => count === 3),
    recordPath: path.join(dataRoot, 'analysis-verifications', owner.projectId, owner.taskId, owner.verificationId, 'record.json'),
  };
}

test('revision reports a proven source overwrite as failed even when the real SDK completed', { timeout: 30_000 }, async t => {
  const f = await fixture(t, 'source-overwrite');
  const original = await f.read(); f.holdNext();
  await f.request(f.route + '/author-revision', 'POST', { instructions: '只修订回复，不改原件。' }, 202);
  await f.waitForRevision();
  await writeFile(path.join(f.project.rootPath, '060_reports/author.md'), 'SYNTHETIC_EXTERNAL_OVERWRITE');
  f.release();
  const failed = await until(f.read, value => value.revision?.status && value.revision.status !== 'running');
  await writeFile(path.join(f.root, 'failed-readback.json'), JSON.stringify(failed, null, 2));
  const persisted = JSON.parse(await readFile(f.recordPath, 'utf8'));
  const owner = await f.request(`/api/projects/${f.project.id}/tasks/${f.task.id}`);
  const native = (await readFile(owner.task.sessionFile, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const settled = native.find(entry => entry.customType === 'optracall.run' && entry.data.phase === 'settled' && entry.data.requestId === persisted.authorRevision.requestId);
  assert.equal(settled?.data.outcome, 'completed', 'the regression must exercise an SDK-completed revision');
  await writeFile(path.join(f.root, 'native-termination.json'), JSON.stringify(settled, null, 2));
  assert.equal(failed.revision.status, 'failed');
  assert.equal(failed.diagnostic.code, 'verification_source_changed');
  assert.match(failed.diagnostic.message, /原始文件.*变化/);
  assert.equal(failed.coldResult.text, original.coldResult.text);
  assert.equal(failed.comparisonResult.text, original.comparisonResult.text);
  assert.equal(failed.revision.text, undefined, 'SDK completion must not become an accepted revision');
  assert.equal(failed.revisionCount, 1); assert.equal(failed.recheckCount ?? 0, 0);
  assert.equal(f.requests.length, 3, 'source failure must not replay or begin recheck');
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/author.md'), 'utf8'), 'SYNTHETIC_EXTERNAL_OVERWRITE', 'failure handling must not silently restore the source');
});

test('revision persists a proven missing project as failed without recreating its directory', { timeout: 30_000 }, async t => {
  const f = await fixture(t, 'source-directory-missing'); f.holdNext();
  const store = createVerificationStore({ dataRoot: f.dataRoot });
  await f.request(f.route + '/author-revision', 'POST', {}, 202); await f.waitForRevision();
  const retained = f.project.rootPath + '.retained';
  await rename(f.project.rootPath, retained); f.release();
  // The existing persisted-record interface remains readable independently of
  // a missing project; no new HTTP read-only/recovery capability is introduced.
  const failed = await until(() => store.read(f.owner), value => Boolean(value.authorRevision && value.authorRevision.status !== 'running'));
  await writeFile(path.join(f.root, 'failed-readback.json'), JSON.stringify(failed, null, 2));
  assert.equal(failed.authorRevision?.status, 'failed');
  assert.equal(failed.diagnostic?.code, 'verification_source_missing');
  assert.equal(failed.authorRevision?.reportText, undefined);
  assert.equal(await readFile(path.join(retained, '020_clean/data.csv'), 'utf8'), 'id,amount\na,10\n');
  assert.equal(await readFile(path.join(retained, '060_reports/author.md'), 'utf8'), 'SYNTHETIC_ORIGINAL_AUTHOR');
  await assert.rejects(readFile(path.join(f.project.rootPath, '020_clean/data.csv')), { code: 'ENOENT' });
  assert.equal(f.requests.length, 3, 'source loss must not start another request');
});

test('Host close reports a missing-owner error while releasing its HTTP, SQLite and project lock', { timeout: 30_000 }, async t => {
  const f = await fixture(t, 'close-after-directory-loss');
  await f.request('/api/cases/storage/initialize', 'POST', {});
  assert.equal(f.host.cases.getStatus().state, 'ready'); f.holdNext();
  await f.request(f.route + '/author-revision', 'POST', {}, 202); await f.waitForRevision();
  const retained = f.project.rootPath + '.retained'; await rename(f.project.rootPath, retained);
  let closeError: unknown;
  try { await f.host.close(); } catch (error) { closeError = error; }
  const lock = path.join(f.dataRoot, '.project-store.lock');
  const lockPresent = await readFile(lock).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  await writeFile(path.join(f.root, 'close-readback.json'), JSON.stringify({ rejected: Boolean(closeError), message: closeError instanceof Error ? closeError.message : null, httpListening: f.host.server.listening, caseStatus: f.host.cases.getStatus(), lockPresent }, null, 2));
  assert.ok(closeError instanceof AggregateError, 'a close failure must remain visible to the caller');
  assert.equal(f.host.server.listening, false, 'one owner failure must not leave the owned HTTP listener alive');
  assert.deepEqual(f.host.cases.getStatus(), { state: 'unavailable', code: 'case_store_closed' });
  assert.equal(lockPresent, false, 'the owned ProjectStore lock must still be released');
  assert.equal(await readFile(path.join(retained, '020_clean/data.csv'), 'utf8'), 'id,amount\na,10\n');
  assert.equal(f.requests.length, 3, 'close must not create another model request');
});
