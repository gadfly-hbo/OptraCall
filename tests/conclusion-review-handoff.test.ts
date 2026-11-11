import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHost } from '../src/host/server.ts';
import { AUTOMATIC_INITIAL_MARKER, startAutomaticProvider } from './fixtures/automatic-provider.ts';
import { providerMessageText, startToolProvider, type ToolProviderBody } from './fixtures/tool-provider.ts';
import { startLegacyTestHost, startTestHost } from './fixtures/host-process.ts';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const originalReport = '# 旧版报告\nC类在本款中最大。建议需另核业务前提。\n';
const originalData = 'category,count\nC,7\nA,3\n';
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, label: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() >= deadline) assert.fail(`${label}: ${JSON.stringify(value)}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/** Only the Host deployment option selects legacy admission. Every business
 * action below still traverses the real HTTP adapter and public SDK lifecycle. */
async function fixture(t: TestContext, provider: { baseUrl: string; requests: readonly unknown[]; close(): Promise<void> }) {
  const evidence = path.resolve('.local/conclusion-recommendation-review/handoff');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'run-')), dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  await mkdir(path.join(dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const http: object[] = [], facts: Record<string, unknown> = {};
  let host = createHost({ reviewAdmission: 'legacy', cwd: process.cwd(), dataRoot, projectsRoot, uiPorts: [4183], transportVersion: 'synthetic-conclusion-handoff' });
  let baseUrl = '';
  async function listen() {
    await host.ready;
    await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
    const address = host.server.address(); assert.ok(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}`;
  }
  async function request(route: string, method = 'GET', input?: unknown, status = 200, etag?: string): Promise<any> {
    const response = await fetch(baseUrl + route, { method,
      headers: { 'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183', ...(etag ? { 'if-match': etag } : {}) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const value = await response.json(); http.push({ route, method, status: response.status, value });
    assert.equal(response.status, status, JSON.stringify(value)); return value;
  }
  await listen();
  t.after(async () => {
    const cleanup = await Promise.allSettled([host.close(), provider.close()]);
    await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ scope: 'SYNTHETIC_REAL_HOST_SDK_HANDOFF_ONLY', name: t.name,
      savedAt: new Date().toISOString(), root, facts, modelRequestCount: provider.requests.length, http,
      shutdown: cleanup.map(result => result.status), requests: provider.requests.map(value => {
        const { authorization: _fakeCredential, ...request } = value as Record<string, unknown>; return request;
      }),
    }, null, 2));
    const failed = cleanup.find(result => result.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
  });
  t.diagnostic(root);
  await request('/api/configuration', 'PUT', { name: '交接合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-handoff', apiKey: 'synthetic-handoff-key' });
  const { project } = await request('/api/projects', 'POST', { name: '旧新审查交接合成项目' }, 201);
  const { task } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '真实同owner交接' }, 201);
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`, automaticRoute = taskRoute + '/automatic-verification', reviewRoute = taskRoute + '/conclusion-reviews';
  await request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'source.csv', content: Buffer.from(originalData).toString('base64') }, 201);
  await request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'report.md', text: originalReport }, 201);
  const settings = { enabled: true, question: '按固定资料核对本版。', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/report.md', processFiles: [], maxAuthorTurns: 1 };
  const settingsFile = path.join(dataRoot, 'automatic-verifications', project.id, task.id, 'settings.json');
  const selection = () => ({ verificationId: randomUUID(), report: { relativePath: '060_reports/report.md' } });
  const legacySelection = () => ({ verificationId: randomUUID(), question: '核对固定资料，条件不足可保留未知。', dataFiles: ['020_clean/source.csv'], authorFiles: ['060_reports/report.md'] });
  return { root, facts, request, project, task, dataRoot, taskRoute, automaticRoute, reviewRoute, settings, settingsFile, selection, legacySelection,
    get host() { return host; },
    transition: () => request(reviewRoute + '/transition'),
    readTask: () => request(taskRoute),
    saveSettings: (enabled: boolean) => request(automaticRoute + '/settings', 'PUT', { expectedRevision: 0, settings: { ...settings, enabled } }),
    reopen: async () => { await host.close(); host = createHost({ cwd: process.cwd(), dataRoot, projectsRoot, uiPorts: [4183], transportVersion: 'synthetic-default-handoff' }); await listen(); },
  };
}

async function requireAutomatic(t: TestContext, f: Awaited<ReturnType<typeof fixture>>) {
  const capability = await f.request(f.automaticRoute + '/capabilities'); f.facts.capability = capability;
  if (!capability.supported) { t.skip(`NOT_RUN: ${capability.reason}`); return false; }
  return true;
}

function calculationEnabled(body: ToolProviderBody) {
  return (body.tools ?? []).some(tool => tool.function?.name === 'review_report_calculations');
}

async function snapshotDirectory(directory: string): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) files[name] = await readFile(path.join(directory, name));
      else assert.fail(`Unexpected non-file in this fixture's preserved directory: ${name}`);
    }
  }
  await visit(); return files;
}

for (const enabled of [true, false]) test(`CNR-A4: saved legacy enabled=${enabled} stays byte-for-byte historical after default restart and cannot gate ordinary foreground review`, { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(), f = await fixture(t, provider);
  if (enabled && !await requireAutomatic(t, f)) return;
  await f.saveSettings(enabled);
  const requestId = randomUUID();
  await f.request(f.taskRoute + '/messages', 'POST', { requestId, text: '建立原主会话，仅回答合成已知条件，不改原报告。' }, 202);
  await until(() => f.request(f.automaticRoute + '/status'), value => !value.busy, 'old ordinary public lifecycle close');
  const oldTask = await f.readTask(); assert.equal(oldTask.task.lastRun?.id, requestId); assert.equal(oldTask.task.lastRun.status, 'completed');
  const legacy = f.legacySelection(), legacyRoute = f.taskRoute + '/verifications/' + legacy.verificationId;
  await f.request(f.taskRoute + '/verifications', 'POST', legacy, 202);
  const oldReview = await until(async () => (await f.request(legacyRoute)).verification, value => value.status === 'completed', 'historical old manual review');
  await f.host.activateConclusionReviews(); await until(f.transition, value => value.state === 'ready', 'manual domain real close');
  const settingsBefore = await readFile(f.settingsFile), recordPath = path.join(f.dataRoot, 'analysis-verifications', f.project.id, f.task.id, legacy.verificationId);
  const oldRecordBefore = await readFile(path.join(recordPath, 'record.json')), oldReviewNative = await snapshotDirectory(path.join(recordPath, 'native'));
  const oldTaskNative = await readFile(oldTask.task.sessionFile), count = provider.requests.length;
  f.facts.historicalNative = { file: oldTask.task.sessionFile, bytes: oldTaskNative.length, sha256: sha(oldTaskNative), verification: oldReview.verificationId };
  await f.reopen();
  assert.equal((await f.transition()).state, 'ready');
  assert.equal((await f.request(f.automaticRoute + '/settings')).settings.enabled, enabled);
  assert.equal((await f.request(legacyRoute)).verification.status, 'completed');
  assert.equal((await f.request(f.taskRoute + '/verifications')).verifications.length, 1);
  assert.equal(provider.requests.length, count, 'default restart and history GETs cannot replay an old model');
  assert.deepEqual(await readFile(f.settingsFile), settingsBefore);
  assert.deepEqual(await readFile(path.join(recordPath, 'record.json')), oldRecordBefore);
  assert.deepEqual(await snapshotDirectory(path.join(recordPath, 'native')), oldReviewNative);
  assert.deepEqual(await readFile(oldTask.task.sessionFile), oldTaskNative);
  for (const [route, method, body] of [
    [f.taskRoute + '/verifications', 'POST', f.legacySelection()],
    [f.taskRoute + '/verifications/preview', 'POST', f.legacySelection()],
    [legacyRoute + '/author-revision', 'POST', {}], [legacyRoute + '/recheck', 'POST', {}],
    [f.automaticRoute + '/settings', 'PUT', { expectedRevision: 1, settings: { enabled: !enabled } }],
  ] as const) assert.equal((await f.request(route, method, body, 409)).code, 'review_entry_replaced');
  const newId = randomUUID();
  await f.request(f.taskRoute + '/messages', 'POST', { requestId: newId, text: '切换后普通新请求，保留既有文件。' }, 202);
  await until(f.readTask, value => value.task.lastRun?.id === newId && value.task.lastRun.status === 'completed' && value.snapshot.status === 'idle', 'post-cutover ordinary');
  assert.equal(provider.requests.length, count + 1, 'one new ordinary turn, without legacy cold/compare or fallback model');
  assert.equal(calculationEnabled(provider.requests[count].body), true, 'a saved legacy switch cannot disable the current foreground tool');
  const supplied = (await f.request(f.taskRoute + '/context-receipts')).receipts.find((value: any) => value.requestId === newId);
  assert.equal(supplied.providedContext.reportCalculationReview.contract, 'foreground-report-calculation-v1');
  assert.deepEqual((await f.request(f.automaticRoute + '/chains')).chains, []);
  const newNative = await readFile(oldTask.task.sessionFile);
  assert.deepEqual(newNative.subarray(0, oldTaskNative.length), oldTaskNative, 'normal explicit continuation appends without migrating old native bytes');
  const commandId = randomUUID();
  await f.request(f.taskRoute + '/commands', 'POST', { requestId: commandId, text: '/tools' });
  assert.equal(provider.requests.length, count + 1, 'the existing local native command neither re-admits automatic review nor dispatches a model');
  assert.deepEqual(await readFile(f.settingsFile), settingsBefore);
  assert.deepEqual(await readFile(path.join(recordPath, 'record.json')), oldRecordBefore);
  assert.deepEqual(await snapshotDirectory(path.join(recordPath, 'native')), oldReviewNative);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/report.md'), 'utf8'), originalReport);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), originalData);
});

for (const stop of [false, true]) test(`CNR-A4: admitted old manual review ${stop ? 'explicitly stops' : 'naturally completes'} through the original lifecycle before new review admission`, { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(), f = await fixture(t, provider);
  await f.saveSettings(false);
  const ordinaryId = randomUUID();
  await f.request(f.taskRoute + '/messages', 'POST', { requestId: ordinaryId, text: '保存原主会话。' }, 202);
  const original = await until(f.readTask, value => value.task.lastRun?.status === 'completed' && value.snapshot.status === 'idle', 'original native');
  const originalNative = await readFile(original.task.sessionFile);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  provider.setResponder(async ({ messages }) => {
    const lastUser = providerMessageText(messages.filter(value => value.role === 'user').at(-1)?.content);
    if (lastUser.includes('独立核算任务：')) { if (stop) return { text: '旧冷读在途。', hold: true }; await held; return { text: '旧首次依据：仅固定资料可支持本款描述。' }; }
    const system = messages.filter(value => ['system','developer'].includes(value.role)).map(value => providerMessageText(value.content)).join('\n');
    if (system.includes('conclusion-and-recommendation reviewer')) {
      const packet = JSON.parse(lastUser), version = packet.report.sha256;
      return { text: JSON.stringify({ schemaVersion: 1, reportVersion: version, claims: [{ id: 'claim-1', quote: 'C类在本款中最大。', location: '第2行', reportVersion: version, verdict: 'insufficient', evidence: [], evidenceGaps: ['没有提供外部同口径基准。'], conditions: [], reason: '报告重述不能补足依据。', impact: '保留适用范围。' }], scope: { reviewed: '固定报告的重要结论。', unreviewed: ['经营行动。'], limitations: ['仅固定材料。'] } }) };
    }
    return { text: '旧对照意见：仅按原合同返回，无自动修订。' };
  });
  const old = f.legacySelection(), oldRoute = f.taskRoute + '/verifications/' + old.verificationId;
  await f.request(f.taskRoute + '/verifications', 'POST', old, 202); await provider.waitForRequests(2);
  const count = provider.requests.length, settingsBefore = await readFile(f.settingsFile);
  await f.host.activateConclusionReviews(); const pending = await f.transition(); f.facts.pending = pending;
  assert.equal(pending.state, 'waiting'); assert.equal(pending.reason, 'legacy_running');
  assert.equal(provider.requests.length, count); assert.equal(provider.requests[1].closedEarly, false, 'activation does not stop the admitted old stream');
  assert.equal((await f.request(f.taskRoute + '/verifications', 'POST', f.legacySelection(), 409)).code, 'review_entry_replaced');
  assert.equal((await f.request(f.reviewRoute + '/preview', 'POST', f.selection(), 409)).code, 'review_transition_pending');
  const refused = await f.request(f.reviewRoute, 'POST', f.selection(), 409, '"pending-preview"');
  assert.ok(['review_transition_pending','session_busy'].includes(refused.code), 'the existing public occupancy or the handoff gate must reject a new review');
  assert.equal((await f.transition()).state, 'waiting'); assert.equal(provider.requests.length, count);
  assert.deepEqual((await f.request(f.reviewRoute)).reviews, [], 'refused new reviews cannot create a saved operation');
  if (stop) await f.request(oldRoute + '/stop', 'POST', {}); else release();
  const oldResult = await until(async () => (await f.request(oldRoute)).verification, value => value.status === (stop ? 'cancelled' : 'completed'), 'old operation terminal');
  f.facts.oldTerminal = oldResult;
  await until(f.transition, value => value.state === 'ready', 'real old manual resource release');
  assert.equal(provider.requests.length, stop ? count : count + 1, 'only the admitted legacy comparison may follow its cold turn');
  const legacyDirectory = path.join(f.dataRoot, 'analysis-verifications', f.project.id, f.task.id, old.verificationId);
  const legacyBefore = await snapshotDirectory(legacyDirectory), reviewCount = provider.requests.length;
  const selected = f.selection(), preview = (await f.request(f.reviewRoute + '/preview', 'POST', selected)).preview;
  await f.request(f.reviewRoute, 'POST', selected, 202, preview.etag);
  const result = await until(async () => (await f.request(f.reviewRoute + '/' + selected.verificationId)).review, value => ['completed','failed','cancelled','unknown'].includes(value.state), 'explicit new conclusion review');
  f.facts.newReview = result;
  assert.equal(result.state, 'completed', JSON.stringify(result));
  assert.equal(provider.requests.length, reviewCount + 1); assert.deepEqual(provider.requests.at(-1)!.body.tools ?? [], []);
  await f.request(oldRoute); await f.request(f.taskRoute + '/verifications'); await f.request(f.reviewRoute); await f.transition();
  assert.equal(provider.requests.length, reviewCount + 1, 'historical reads cannot replay either contract');
  assert.deepEqual(await snapshotDirectory(legacyDirectory), legacyBefore);
  assert.deepEqual(await readFile(original.task.sessionFile), originalNative);
  assert.deepEqual(await readFile(f.settingsFile), settingsBefore);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/report.md'), 'utf8'), originalReport);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), originalData);
  release();
});

test('CNR-A4: crashed old manual request stays unproved and read-only across default restart without replay or invented cleanup', { timeout: 60_000 }, async t => {
  const base = path.resolve('.local/conclusion-recommendation-review/handoff'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'crash-')), provider = await startToolProvider();
  const first = await startLegacyTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  let crashed = false, reopened: Awaited<ReturnType<typeof startTestHost>> | undefined;
  const reads: object[] = [];
  async function request(host: typeof first, route: string, method = 'GET', input?: unknown, expected = 200, etag?: string): Promise<any> {
    const response = await fetch(host.baseUrl + route, { method, headers: { ...host.headers, ...(etag ? { 'if-match': etag } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    const value = await response.json(); reads.push({ route, method, status: response.status, value }); assert.equal(response.status, expected, JSON.stringify(value)); return value;
  }
  t.after(async () => {
    const shutdown = await Promise.allSettled([...(crashed ? [] : [first.close()]), ...(reopened ? [reopened.close()] : []), provider.close()]);
    await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ scope: 'SYNTHETIC_REAL_HOST_PROCESS_CRASH_ONLY', name: t.name, root, reads,
      requests: provider.requests.map(({ authorization: _fakeCredential, ...value }) => value), originalOutput: first.output(), reopenedOutput: reopened?.output(), shutdown: shutdown.map(value => value.status),
    }, null, 2));
    const failure = shutdown.find(value => value.status === 'rejected'); if (failure?.status === 'rejected') throw failure.reason;
  });
  t.diagnostic(root);
  await request(first, '/api/configuration', 'PUT', { name: '崩溃交接合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-crash', apiKey: 'synthetic-crash-key' });
  const { project } = await request(first, '/api/projects', 'POST', { name: '旧未知资源项目' }, 201);
  const { task } = await request(first, `/api/projects/${project.id}/tasks`, 'POST', { name: '保留未知' }, 201);
  await request(first, `/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'source.csv', content: Buffer.from(originalData).toString('base64') }, 201);
  await request(first, `/api/projects/${project.id}/files/save-report`, 'POST', { name: 'report.md', text: originalReport }, 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`, oldId = randomUUID(), oldRoute = route + '/verifications/' + oldId;
  await request(first, route + '/automatic-verification/settings', 'PUT', { expectedRevision: 0, settings: { enabled: false } });
  provider.setResponder(() => ({ text: '旧冷读尚未返回终态。', hold: true }));
  await request(first, route + '/verifications', 'POST', { verificationId: oldId, question: '核对固定资料。', dataFiles: ['020_clean/source.csv'], authorFiles: ['060_reports/report.md'] }, 202);
  await provider.waitForRequests(1);
  const directory = path.join(first.dataRoot, 'analysis-verifications', project.id, task.id, oldId), running = await request(first, oldRoute);
  assert.equal(running.verification.status, 'running');
  await writeFile(path.join(root, 'before-crash-record.json'), await readFile(path.join(directory, 'record.json')));
  const driverPids = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').map(line => /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line))
    .filter(match => match && Number(match[2]) === first.pid && match[3].includes(path.join(process.cwd(), 'scripts/project-entry.mjs'))).map(match => Number(match![1]));
  assert.equal(driverPids.length, 1, 'the held manual operation has one actual child SDK driver');
  // Only the child process created by this exact fixture is terminated. Its
  // persisted in-flight record is reconciled by the real default Host startup.
  process.kill(first.pid, 'SIGKILL'); crashed = true;
  await until(async () => { try { process.kill(first.pid, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; } }, Boolean, 'owned Host process exited', 5000);
  await until(async () => driverPids.every(pid => { try { process.kill(pid, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; } }), Boolean, 'owned SDK driver exited after IPC disconnect', 5000);
  // IPC shutdown can legitimately append an aborted native turn. Freeze the
  // exact bytes only after the real writer has exited; startup cannot add any.
  const nativeBefore = await snapshotDirectory(path.join(directory, 'native'));
  await writeFile(path.join(root, 'retired-driver.json'), JSON.stringify({ driverPids, native: Object.entries(nativeBefore).map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: sha(bytes) })), proof: 'driver exit only; unrelated tool cleanup remains unproved' }, null, 2));
  reopened = await startTestHost({ dataRoot: first.dataRoot, projectsRoot: first.projectsRoot });
  const historical = (await request(reopened, oldRoute)).verification;
  assert.equal(historical.status, 'interrupted'); assert.equal(historical.error, 'host_restarted_before_confirmed_completion'); assert.equal(historical.comparisonResult, undefined);
  assert.deepEqual(await snapshotDirectory(path.join(directory, 'native')), nativeBefore, 'recovery cannot fabricate or rewrite the old native result');
  const before = await snapshotDirectory(directory), settingsFile = path.join(first.dataRoot, 'automatic-verifications', project.id, task.id, 'settings.json'), settings = await readFile(settingsFile), count = provider.requests.length;
  const selection = { verificationId: randomUUID(), report: { relativePath: '060_reports/report.md' } };
  for (let i = 0; i < 3; i++) {
    const pending = await request(reopened, route + '/conclusion-reviews/transition'); assert.equal(pending.state, 'waiting'); assert.equal(pending.reason, 'legacy_cleanup_unknown');
    await request(reopened, oldRoute); await request(reopened, route + '/verifications'); await request(reopened, route + '/conclusion-reviews');
    assert.equal((await request(reopened, route + '/conclusion-reviews/preview', 'POST', selection, 409)).code, 'review_transition_pending');
  }
  await request(reopened, oldRoute + '/stop', 'POST', {});
  assert.equal((await request(reopened, route + '/conclusion-reviews/transition')).state, 'waiting', 'a terminal interrupted request is not made proven by a no-op stop');
  assert.equal((await request(reopened, route + '/conclusion-reviews', 'POST', selection, 409, '"unknown-preview"')).code, 'review_transition_pending');
  assert.deepEqual(await snapshotDirectory(directory), before); assert.deepEqual(await readFile(settingsFile), settings); assert.equal(provider.requests.length, count);
  assert.equal(await readFile(path.join(project.rootPath, '060_reports/report.md'), 'utf8'), originalReport);
  assert.equal(await readFile(path.join(project.rootPath, '020_clean/source.csv'), 'utf8'), originalData);
});

test('CNR-A4: actual old unknown after its input contract changes blocks new review and is never replayed on restart', { timeout: 45_000 }, async t => {
  const provider = await startToolProvider(), f = await fixture(t, provider); await f.saveSettings(false);
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  provider.setResponder(async () => { await held; return { text: '旧首次依据已返回，保存前须核对原固定输入。' }; });
  const old = f.legacySelection(), oldRoute = f.taskRoute + '/verifications/' + old.verificationId;
  await f.request(f.taskRoute + '/verifications', 'POST', old, 202); await provider.waitForRequests(1);
  await f.host.activateConclusionReviews(); assert.equal((await f.transition()).state, 'waiting');
  // The fixture changes its own live input while the already fixed old copy
  // remains intact. The old adapter must preserve the resulting UNKNOWN.
  const updatedData = 'category,count\nC,8\nA,2\n'; await writeFile(path.join(f.project.rootPath, '020_clean/source.csv'), updatedData);
  release();
  const unknown = await until(async () => (await f.request(oldRoute)).verification, value => value.status === 'unknown', 'real legacy fixed-input mismatch');
  assert.equal(unknown.comparisonResult, undefined); assert.equal(provider.requests.length, 1);
  const pending = await until(f.transition, value => value.state === 'waiting' && value.reason === 'legacy_cleanup_unknown', 'old unknown remains unproved');
  f.facts.unknown = unknown; f.facts.unknownTransition = pending;
  const directory = path.join(f.dataRoot, 'analysis-verifications', f.project.id, f.task.id, old.verificationId), before = await snapshotDirectory(directory), settings = await readFile(f.settingsFile);
  assert.equal(await readFile(path.join(directory, 'data/020_clean/source.csv'), 'utf8'), originalData, 'the fixed original input is retained separately');
  const selection = f.selection();
  assert.equal((await f.request(f.reviewRoute + '/preview', 'POST', selection, 409)).code, 'review_transition_pending');
  assert.equal((await f.request(f.reviewRoute, 'POST', selection, 409, '"unknown-preview"')).code, 'review_transition_pending');
  await f.request(oldRoute + '/stop', 'POST', {});
  assert.equal((await f.transition()).state, 'waiting', 'terminal UNKNOWN cannot be certified by a no-op stop');
  await f.reopen();
  assert.equal((await f.transition()).state, 'waiting'); assert.equal((await f.request(oldRoute)).verification.status, 'unknown');
  await f.request(f.taskRoute + '/verifications'); await f.request(f.reviewRoute);
  assert.deepEqual(await snapshotDirectory(directory), before); assert.deepEqual(await readFile(f.settingsFile), settings); assert.equal(provider.requests.length, 1);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), updatedData, 'Host cannot undo a later live-source change');
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/report.md'), 'utf8'), originalReport);
});

for (const changed of [true, false]) test(`CNR-A4: admitted legacy ordinary ${changed ? 'changed' : 'unchanged'} report waits through cutover without falling into the new contract`, { timeout: 90_000 }, async t => {
  const provider = await startAutomaticProvider({ scenario: 'retain' }), f = await fixture(t, provider);
  if (!await requireAutomatic(t, f)) return;
  await f.saveSettings(true); const settingsBefore = await readFile(f.settingsFile);
  provider.holdOrdinaryReplies();
  const requestId = randomUUID(), reportPath = path.join(f.project.rootPath, '060_reports/report.md');
  const text = `${AUTOMATIC_INITIAL_MARKER}\n${JSON.stringify({ reportPath, content: changed ? '# 本轮新稿\n退款反事实：1,900元。\n' : originalReport })}`;
  await f.request(f.taskRoute + '/messages', 'POST', { requestId, text }, 202);
  await provider.waitForStage('ordinary', 2);
  const requestCount = provider.requests.length;
  assert.equal((await f.request(f.automaticRoute + '/status')).busy, true);
  assert.deepEqual((await f.request(f.automaticRoute + '/chains')).chains, [], 'the legacy observation exists before its chain is materialized');
  await f.host.activateConclusionReviews();
  const transition = await f.transition(); f.facts.heldOrdinaryTransition = transition;
  assert.equal(transition.state, 'waiting', 'the admitted legacy owner remains occupied before chain creation');
  assert.equal(transition.reason, 'legacy_running');
  assert.equal(provider.requests.length, requestCount, 'activation cannot dispatch a model');
  assert.equal(provider.requests.some(value => value.closedEarly), false, 'activation cannot cancel or restart the admitted stream');
  const newSelection = f.selection();
  assert.equal((await f.request(f.reviewRoute + '/preview', 'POST', newSelection, 409)).code, 'review_transition_pending');
  assert.equal((await f.request(f.reviewRoute, 'POST', newSelection, 409, '"waiting-preview"')).code, 'review_transition_pending');
  assert.equal((await f.request(f.taskRoute + '/verifications', 'POST', f.legacySelection(), 409)).code, 'review_entry_replaced');
  assert.deepEqual(await readFile(f.settingsFile), settingsBefore);
  provider.holdOrdinaryReplies(false); provider.releaseOrdinaryReplies();
  const observation = await until(async () => (await f.request(f.automaticRoute + '/status')).observation,
    value => value?.requestId === requestId && Boolean(value.observedAt), 'legacy observation');
  f.facts.observation = observation;
  if (changed) {
    const chain = await until(async () => (await f.request(f.automaticRoute + '/chains')).chains[0], value => Boolean(value) && ['completed','failed','cancelled','unknown','paused'].includes(value.state), 'old chain after activation');
    f.facts.chain = await until(async () => (await f.request(f.automaticRoute + '/chains/' + chain.chainId)).chain, value => value.cleanup.state === 'confirmed', 'real old-chain cleanup');
    assert.equal(chain.state, 'completed'); assert.deepEqual(chain.steps.map((value: any) => value.phase), ['cold','compare','author']);
    const fixed = (await f.request(f.automaticRoute + '/chains/' + chain.chainId + '/reports/1')).report;
    assert.equal(Buffer.from(fixed.contentBase64, 'base64').toString('utf8'), '# 本轮新稿\n退款反事实：1,900元。\n');
  } else {
    assert.equal(observation.chainId, undefined); assert.equal(observation.reason, 'report_unchanged');
    assert.deepEqual((await f.request(f.automaticRoute + '/chains')).chains, []);
  }
  await until(f.transition, value => value.state === 'ready', 'owner cutover after real cleanup');
  const receipts = (await f.request(f.taskRoute + '/context-receipts')).receipts;
  assert.equal(receipts.find((value: any) => value.requestId === requestId).providedContext.reportCalculationReview, undefined);
  assert.ok(provider.requests.every(value => !(value.body.tools as { function?: { name?: string } }[] | undefined)?.some(tool => tool.function?.name === 'review_report_calculations')));
  const count = provider.requests.length;
  const task = await f.readTask(), nativeBefore = await readFile(task.task.sessionFile);
  const duplicate = await f.request(f.taskRoute + '/messages', 'POST', { requestId, text }, 202);
  assert.equal(duplicate.deduplicated, true, 'the same admitted request identity stays bound to its original contract after cutover');
  await f.transition(); await f.request(f.automaticRoute + '/status'); await f.request(f.reviewRoute);
  assert.equal(provider.requests.length, count, 'report change or lack of change cannot supplement the other route');
  assert.deepEqual(await readFile(task.task.sessionFile), nativeBefore);
  assert.deepEqual(await readFile(f.settingsFile), settingsBefore);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), originalData);
});

test('CNR-A4: old automatic cold stop waits for the actual shared parent/child cleanup before cutover and keeps fixed history', { timeout: 90_000 }, async t => {
  const provider = await startAutomaticProvider({ scenario: 'repair' }), f = await fixture(t, provider);
  if (!await requireAutomatic(t, f)) return;
  await f.saveSettings(true); const settingsBefore = await readFile(f.settingsFile);
  provider.holdCold();
  const report = '# 在途自动核算原稿\n退款反事实：2,120元。\n', requestId = randomUUID();
  await f.request(f.taskRoute + '/messages', 'POST', { requestId, text: `${AUTOMATIC_INITIAL_MARKER}\n${JSON.stringify({ reportPath: path.join(f.project.rootPath, '060_reports/report.md'), content: report })}` }, 202);
  await provider.waitForStage('cold');
  const chain = (await f.request(f.automaticRoute + '/chains')).chains[0]; assert.ok(chain); assert.equal(chain.requestId, requestId);
  const beforeCount = provider.requests.length;
  await f.host.activateConclusionReviews();
  const pending = await f.transition(); f.facts.pendingCold = pending;
  assert.equal(pending.state, 'waiting'); assert.equal(pending.reason, 'legacy_running');
  assert.equal(provider.requests.length, beforeCount); assert.equal(provider.requests.at(-1)!.closedEarly, false);
  assert.equal((await f.request(f.taskRoute + '/verifications', 'POST', f.legacySelection(), 409)).code, 'review_entry_replaced');
  const denied = await f.request(f.reviewRoute, 'POST', f.selection(), 409, '"old-cold-preview"'); assert.ok(['session_busy','review_transition_pending'].includes(denied.code));
  assert.deepEqual((await f.request(f.reviewRoute)).reviews, []);
  await f.request(f.automaticRoute + '/chains/' + chain.chainId + '/stop', 'POST', {});
  const closed = await until(async () => (await f.request(f.automaticRoute + '/chains/' + chain.chainId)).chain, value => value.cleanup.state === 'confirmed' && value.state === 'cancelled', 'actual parent and cold-child stop');
  f.facts.stoppedChain = closed;
  assert.deepEqual(closed.steps.map((step: any) => step.phase), ['cold']); assert.equal(closed.cleanup.retryable, false);
  await until(f.transition, value => value.state === 'ready', 'cold stop owner cutover');
  const task = await f.readTask(), mainNative = await readFile(task.task.sessionFile);
  const fixed = (await f.request(f.automaticRoute + '/chains/' + chain.chainId + '/reports/1')).report;
  assert.equal(Buffer.from(fixed.contentBase64, 'base64').toString('utf8'), report);
  const childDirectory = path.join(f.dataRoot, 'analysis-verifications', f.project.id, f.task.id, chain.firstVerification.verificationId), oldChild = await snapshotDirectory(childDirectory);
  await f.request(f.taskRoute + '/verifications/' + chain.firstVerification.verificationId);
  await f.request(f.automaticRoute + '/chains/' + chain.chainId); await f.transition();
  assert.equal(provider.requests.length, beforeCount, 'stop and all readbacks cannot start compare, author, recheck or new review');
  assert.deepEqual(await readFile(task.task.sessionFile), mainNative); assert.deepEqual(await snapshotDirectory(childDirectory), oldChild);
  assert.deepEqual(await readFile(f.settingsFile), settingsBefore);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/report.md'), 'utf8'), report);
  assert.equal(await readFile(path.join(f.project.rootPath, '020_clean/source.csv'), 'utf8'), originalData);
});

test('CNR-A4: a newly admitted ordinary request keeps the new contract while busy and is not reclassified as old work', { timeout: 30_000 }, async t => {
  const provider = await startToolProvider(), f = await fixture(t, provider); await f.saveSettings(false); await f.host.activateConclusionReviews();
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  provider.setResponder(async () => { await held; return { text: '新合同普通分析结束，原稿保留。' }; });
  const requestId = randomUUID(); await f.request(f.taskRoute + '/messages', 'POST', { requestId, text: '新准入普通请求。' }, 202); await provider.waitForRequests(1);
  assert.equal((await f.request(f.automaticRoute + '/status')).busy, true);
  assert.equal((await f.transition()).state, 'ready', 'new ordinary occupancy is not an old-contract transition blocker');
  assert.equal(calculationEnabled(provider.requests[0].body), true);
  assert.equal((await f.request(f.reviewRoute + '/preview', 'POST', f.selection(), 409)).code, 'session_busy');
  assert.deepEqual((await f.request(f.reviewRoute)).reviews, []);
  await f.host.activateConclusionReviews(); assert.equal(provider.requests.length, 1); assert.equal(provider.requests[0].closedEarly, false);
  release(); await until(() => f.request(f.automaticRoute + '/status'), value => !value.busy, 'new ordinary public resource release');
  const receipts = (await f.request(f.taskRoute + '/context-receipts')).receipts;
  assert.equal(receipts.find((value: any) => value.requestId === requestId).providedContext.reportCalculationReview.contract, 'foreground-report-calculation-v1');
  assert.equal(provider.requests.length, 1); assert.deepEqual((await f.request(f.automaticRoute + '/chains')).chains, []);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/report.md'), 'utf8'), originalReport);
});
