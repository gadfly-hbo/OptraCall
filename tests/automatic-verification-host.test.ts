import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { writeFile, readdir } from 'node:fs/promises';
import { createAutomaticVerificationStore } from '../src/host/automatic-verification-store.ts';
import { readAutomaticReport, automaticReportBlob } from '../src/host/ui/automatic-verification-client.ts';
import { startLegacyTestHost as startTestHost } from './fixtures/host-process.ts'; // Explicit pre-cutover contract; default Host is tested separately.
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { readJson } from './fixtures/joint-context.ts';

async function setup(t: any) {
  const provider = await startSyntheticProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: '自动核算合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '自动核算合同项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原主Agent任务' }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'source.csv', content: Buffer.from('amount\n10\n20\n').toString('base64') }), 201);
  return { host, provider, project, task, route: `/api/projects/${project.id}/tasks/${task.id}/automatic-verification` };
}

test('automatic settings default off, CAS and all observation reads never dispatch a model', { timeout: 30000 }, async t => {
  const { host, provider, route } = await setup(t);
  const first = await readJson(await host.request(`${route}/settings`));
  assert.equal(first.settings.enabled, false); assert.equal(first.settings.revision, 0);
  const settings = { enabled: false, question: '核算本报告，不确定可以保留未知。', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/new-report.md', processFiles: [], maxAuthorTurns: 2 };
  const saved = await readJson(await host.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings }));
  assert.equal(saved.settings.revision, 1);
  await readJson(await host.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings }), 409);
  assert.deepEqual((await readJson(await host.request(`${route}/chains`))).chains, []);
  assert.equal((await readJson(await host.request(`${route}/status`))).busy, false);
  assert.equal(typeof (await readJson(await host.request(`${route}/capabilities`))).supported, 'boolean');
  assert.equal(provider.requests.length, 0);
  await readJson(await host.request(`${route}/settings`, 'PUT', { expectedRevision: 1, settings: { enabled: false } }));
  const disabled = (await readJson(await host.request(`${route}/settings`))).settings;
  assert.equal(disabled.enabled, false); assert.equal(disabled.reportPath, settings.reportPath);
});

test('automatic settings reject invalid selection and cross-owner/unknown chains without affecting ordinary tasks', { timeout: 30000 }, async t => {
  const { host, provider, project, task, route } = await setup(t);
  await readJson(await host.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings: { enabled: true, question: 'test', dataFiles: ['020_clean/missing.csv'], reportPath: '060_reports/report.md' } }), 404);
  await readJson(await host.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings: { enabled: true, question: 'test', dataFiles: ['010_draw/source.csv'], reportPath: '../bad' } }), 400);
  await readJson(await host.request(`${route}/chains/${'a'.repeat(64)}`), 404);
  await readJson(await host.request(`/api/projects/${project.id}/tasks/${randomUUID()}/automatic-verification/settings`), 404);
  const current = await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.equal(current.task.name, task.name); assert.equal(provider.requests.length, 0);
});

test('a task created by this Host can enable before its first execution, and opening its view remains read-only', { skip: process.platform !== 'darwin', timeout: 30000 }, async t => {
  const { host, provider, task, route } = await setup(t);
  assert.equal((await readJson(await host.request(`${route}/capabilities`))).supported, true);
  const settings = { enabled: true, question: '合成核算', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/initial.md' };
  await readJson(await host.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings }));
  const entries = await readdir(task.sessionDirectory);
  const state = await readJson(await host.request(route.replace('/automatic-verification', '/open'), 'POST', {}));
  assert.equal(state.task.sessionFile, undefined);
  assert.deepEqual(await readdir(task.sessionDirectory), entries);
  assert.equal(provider.requests.length, 0);
  assert.equal((await readJson(await host.request(`${route}/capabilities`))).supported, true);
});

test('an already opened unmanaged task cannot be upgraded just because it has no model requests', { timeout: 30000 }, async t => {
  const { host, provider, route } = await setup(t);
  await readJson(await host.request(route.replace('/automatic-verification', '/open'), 'POST', {}));
  const capability = await readJson(await host.request(`${route}/capabilities`));
  assert.equal(capability.supported, false);
  const response = await readJson(await host.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings: { enabled: true, question: '合成核算', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/initial.md' } }), 409);
  assert.equal(response.code, 'automatic_unmanaged_history');
  assert.equal((await readJson(await host.request(`${route}/settings`))).settings.revision, 0);
  await readJson(await host.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings: { enabled: false } }));
  assert.equal(provider.requests.length, 0);
});

test('Host restart cannot promote an empty old task directory into a trustworthy new execution origin', { timeout: 30000 }, async t => {
  const { host, provider, task, route } = await setup(t);
  const before = await readdir(task.sessionDirectory);
  await host.close();
  const reopened = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot }); t.after(() => reopened.close());
  assert.equal((await readJson(await reopened.request(`${route}/capabilities`))).supported, false);
  await readJson(await reopened.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings: { enabled: true, question: '合成核算', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/initial.md' } }), 409);
  assert.deepEqual(await readdir(task.sessionDirectory), before);
  assert.equal(provider.requests.length, 0);
});

test('a completed manual executable verifier remains a project writer blocker instead of being mistaken for closed text-only work', { skip: process.platform !== 'darwin', timeout: 30000 }, async t => {
  const { host, provider, project, task, route } = await setup(t);
  assert.equal((await readJson(await host.request(`${route}/capabilities`))).supported, true);
  await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'manual-author.md', text: '# 合成手动核算原稿\n' }), 201);
  const verificationId = randomUUID(), manualRoute = route.replace('/automatic-verification', '/verifications');
  await readJson(await host.request(manualRoute, 'POST', { verificationId, question: '合成手动核算', dataFiles: ['020_clean/source.csv'], authorFiles: ['060_reports/manual-author.md'] }), 202);
  const deadline = Date.now() + 15000;
  for (;;) {
    const result = await readJson(await host.request(`${manualRoute}/${verificationId}`));
    if (result.verification.status === 'completed') break;
    if (Date.now() >= deadline) assert.fail(`manual verification did not complete: ${JSON.stringify(result)}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const capability = await readJson(await host.request(`${route}/capabilities`));
  assert.equal(capability.supported, false); assert.match(capability.reason, /项目/);
  await readJson(await host.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings: { enabled: true, question: '不把手动核算completed当进程证明', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/initial.md' } }), 409);
  assert.equal((await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}`))).task.sessionFile, undefined);
  assert.equal(provider.requests.length, 2, 'readback and rejected automatic settings cannot add model calls');
});

test('fixed report readback uses the historical owner/version bytes, including long UTF-8 and binary, without models', { timeout: 30000 }, async t => {
  const { host, provider, project, task, route } = await setup(t);
  const fetchOriginal = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url: any, init?: RequestInit) => typeof url === 'string' && url.startsWith('/api/')
    ? fetchOriginal(host.baseUrl + url, { ...init, headers: host.headers }) : fetchOriginal(url, init));
  const store = createAutomaticVerificationStore({ dataRoot: host.dataRoot });
  const owner = { projectId: project.id, taskId: task.id };
  const settings = await store.saveSettings(owner, { enabled: true, question: '合成只读历史稿测试', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/initial.md' }, 0);
  const configuration = { id: task.configuration.id, revision: task.configuration.revision, provider: task.configuration.provider, model: task.configuration.model };
  const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
  for (const bytes of [Buffer.from('历史固定全文😀\n'.repeat(5000)), Buffer.from('\uFEFF# 含BOM的历史原稿\n'), Buffer.from([0xff, 0x00, 0x80])]) {
    const requestId = randomUUID();
    const { chain } = await store.createChain({ ...owner, requestId, requestFingerprint: digest(requestId), reportSha256: digest(bytes), settingsSnapshot: settings,
      configuration, verificationConfiguration: configuration, native: { sessionFile: path.join(task.sessionDirectory, 'fixture.jsonl'), sessionId: randomUUID(), bytes: 1, sha256: digest('fixture') } });
    const chainOwner = { ...owner, chainId: chain.chainId };
    const material = await store.fixMaterial(chainOwner, { key: 'report-1', kind: 'report', relativePath: settings.reportPath!, bytes });
    const version = { ...material, version: 1, requestId };
    await store.updateChain(chainOwner, { materials: [material], versions: [version] });
    await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'initial.md', text: '当前同名文件已变化，不是历史稿' }), 201);
    const endpoint = `${route}/chains/${chain.chainId}/reports/1`;
    const { report } = await readJson(await host.request(endpoint));
    assert.equal(report.version, 1); assert.equal(report.sha256, digest(bytes)); assert.equal(report.bytes, bytes.length);
    assert.deepEqual(Buffer.from(report.contentBase64, 'base64'), bytes);
    const readByClient = await readAutomaticReport(project.id, task.id, chain.chainId, version);
    assert.deepEqual(Buffer.from(await automaticReportBlob(readByClient).arrayBuffer()), bytes);
    if (bytes[0] === 0xff) { assert.equal(report.textStatus, 'not-utf8'); assert.equal(report.text, undefined); }
    else { assert.equal(report.textStatus, 'utf8'); assert.equal(report.text, bytes.toString('utf8')); }
    await readJson(await host.request(`${route}/chains/${chain.chainId}/reports/2`), 404);
    await readJson(await host.request(`/api/projects/${project.id}/tasks/${randomUUID()}/automatic-verification/chains/${chain.chainId}/reports/1`), 404);
    await writeFile(store.materialPath(chainOwner, version), 'corrupted fixed bytes');
    await readJson(await host.request(endpoint), 409);
  }
  assert.equal(provider.requests.length, 0);
  assert.equal((await readJson(await host.request(`/api/projects/${project.id}/tasks/${task.id}`))).task.lastRun, undefined);
});
