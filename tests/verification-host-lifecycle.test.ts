import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider, type SyntheticMode } from './fixtures/synthetic-provider.ts';
import { readJson } from './fixtures/joint-context.ts';
import { runtimeEnvironment, workspaceRoot } from '../scripts/runtime-process.ts';

async function crashableHost(dataRoot: string, projectsRoot: string) {
  const entry = fileURLToPath(new URL('../scripts/host-entry.mjs', import.meta.url));
  const child = spawn(process.execPath, [entry, '--port=0', '--ui-port=4183', '--connection-timeout-ms=2000', `--data-root=${dataRoot}`, `--projects-root=${projectsRoot}`], { cwd: workspaceRoot, env: runtimeEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Isolated lifecycle Host startup timeout')); }, 10000);
    child.stdout.on('data', () => { for (const line of stdout.split('\n')) { try { const parsed = JSON.parse(line); if (parsed.kind === 'host-ready') { clearTimeout(timer); resolve(parsed.port); } } catch {} } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Isolated lifecycle Host exited: ${stderr}`)); });
  });
  const baseUrl = `http://127.0.0.1:${port}`, headers = { 'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183' };
  return { baseUrl, dataRoot, projectsRoot, output: () => ({ stdout, stderr }),
    request: (route: string, method = 'GET', body?: unknown) => fetch(baseUrl + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    async crash() { assert.ok(child.pid, 'Only the child created by this fixture may be killed'); const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; },
    async close() { if (child.exitCode !== null || child.signalCode !== null) return; const exited = once(child, 'exit'); child.kill('SIGTERM'); const [code] = await exited; assert.equal(code, 0, stderr); },
  };
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, description: string, timeout = 15_000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) { const value = await read(); if (done(value)) return value; if (Date.now() > deadline) assert.fail(`${description}: ${JSON.stringify(value)}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}

async function fixture(t: TestContext, label: string, mode: SyntheticMode = 'success') {
  const provider = await startSyntheticProvider(), host = await startTestHost(); provider.setMode(mode);
  const evidence = path.resolve('.local/semantic-verification/host-lifecycle', `${label}-${randomUUID()}`);
  await mkdir(evidence, { recursive: true });
  t.after(async () => {
    await host.close(); await provider.close();
    await writeFile(path.join(evidence, 'host-output.json'), JSON.stringify(host.output(), null, 2));
    await writeFile(path.join(evidence, 'provider-requests.json'), JSON.stringify(provider.requests.map(({ authorization: _authorization, ...request }) => request), null, 2));
    for (const name of ['analysis-verifications', 'verification-workspaces']) await cp(path.join(host.dataRoot, name), path.join(evidence, name), { recursive: true }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  });
  await readJson(await host.request('/api/configuration', 'PUT', { name: '生命周期合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-lifecycle-model', apiKey: 'synthetic-only-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: `核算生命周期 ${label}` }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原分析任务' }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'input.csv', content: Buffer.from('member,orders\na,2\nb,1\n').toString('base64') }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'author.md', text: 'AUTHOR_LIFECYCLE_ANSWER：复购率50%。' }), 201);
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`, route = `${taskRoute}/verifications`;
  const selection = { verificationId: randomUUID(), question: '核对会员复购率及分母口径。', dataFiles: ['020_clean/input.csv'], authorFiles: ['060_reports/author.md'] };
  const read = async () => (await readJson(await host.request(`${route}/${selection.verificationId}`))).verification;
  return { host, provider, project, task, taskRoute, route, selection, read, evidence };
}

test('SV06 lifecycle: cancelling cold calculation prevents comparison and preserves the author task', { timeout: 60_000 }, async t => {
  const f = await fixture(t, 'cold-cancel', 'slow');
  const original = (await readJson(await f.host.request(f.taskRoute))).task;
  const originalReport = await readFile(path.join(f.project.rootPath, '060_reports/author.md'));
  await readJson(await f.host.request(f.route, 'POST', f.selection), 202);
  await f.provider.waitForRequests(1);
  assert.equal((await f.read()).phase, 'cold');
  await readJson(await f.host.request(`${f.route}/${f.selection.verificationId}/stop`, 'POST', {}));
  const settled = await until(f.read, value => value.status === 'cancelled', 'cold cancellation did not settle');
  assert.equal(settled.comparisonResult, undefined);
  assert.equal(settled.authorRevealedAt, undefined);
  assert.equal(settled.authorReports.length, 0);
  assert.equal(f.provider.requests.length, 1, 'cancellation must prevent the comparison turn');
  assert.deepEqual((await readJson(await f.host.request(f.taskRoute))).task, original);
  assert.deepEqual(await readFile(path.join(f.project.rootPath, '060_reports/author.md')), originalReport);
  await readJson(await f.host.request(f.route, 'POST', f.selection), 200);
  await f.read();
  assert.equal(f.provider.requests.length, 1, 'duplicate and GET after cancellation must not replay');
  await writeFile(path.join(f.evidence, 'readback.json'), JSON.stringify(settled, null, 2));
});

test('SV06 lifecycle: provider failure stops before comparison and requires an explicit new attempt', { timeout: 60_000 }, async t => {
  const f = await fixture(t, 'provider-failure', 'failure');
  await readJson(await f.host.request(f.route, 'POST', f.selection), 202);
  const failed = await until(f.read, value => ['failed', 'unknown'].includes(value.status), 'provider failure did not settle');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.comparisonResult, undefined);
  assert.equal(failed.authorRevealedAt, undefined);
  assert.equal(f.provider.requests.length, 1, '401 must not be replayed by the Host');
  assert.ok(!JSON.stringify(failed).includes('synthetic-only-key'), 'public readback must not leak configuration credentials');
  assert.ok(!JSON.stringify(failed).includes('synthetic-private-detail'), 'public diagnostic must not copy private Provider payload');
  await readJson(await f.host.request(f.route, 'POST', f.selection), 200);
  await f.read();
  assert.equal(f.provider.requests.length, 1);
  const next = { ...f.selection, verificationId: randomUUID(), retryOf: f.selection.verificationId };
  await readJson(await f.host.request(f.route, 'POST', next), 202);
  const retried = await until(async () => (await readJson(await f.host.request(`${f.route}/${next.verificationId}`))).verification, value => value.status === 'failed', 'explicit retry did not settle');
  assert.equal(retried.retryOf, f.selection.verificationId);
  assert.equal(f.provider.requests.length, 2, 'only an explicit new intent sends another request');
  assert.equal((await f.read()).status, 'failed');
  await writeFile(path.join(f.evidence, 'readback.json'), JSON.stringify({ failed, retried }, null, 2));
});

test('SV06 lifecycle: busy verification blocks archive and configuration clearing leaves a readable terminal record', { timeout: 60_000 }, async t => {
  const f = await fixture(t, 'configuration-close', 'slow');
  await readJson(await f.host.request(f.route, 'POST', f.selection), 202);
  await f.provider.waitForRequests(1);
  await readJson(await f.host.request(`/api/projects/${f.project.id}/archive`, 'POST', {}), 409);
  await readJson(await f.host.request('/api/configuration', 'DELETE'));
  const settled = await until(f.read, value => ['cancelled', 'interrupted', 'unknown', 'failed'].includes(value.status), 'configuration clearing left stale running verification', 3000);
  assert.equal(settled.comparisonResult, undefined);
  assert.equal(settled.authorRevealedAt, undefined);
  assert.equal(f.provider.requests.length, 1, 'cleared credentials must not dispatch comparison');
  const configurations = await readJson(await f.host.request('/api/configurations'));
  assert.ok(configurations.configurations.length > 0, 'clearing credentials must retain the configured model definitions');
  assert.ok(configurations.configurations.every((entry: { hasApiKey: boolean }) => entry.hasApiKey === false), 'all credentials must be cleared');
  const archived = await readJson(await f.host.request(`/api/projects/${f.project.id}/archive`, 'POST', {}));
  assert.ok(archived.project.archivedAt);
  await writeFile(path.join(f.evidence, 'readback.json'), JSON.stringify({ settled, configurations, archived }, null, 2));
});

test('SV06 lifecycle: a crashed Host reopens running verification as interrupted without replay', { timeout: 60_000 }, async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-host-test-lifecycle-')), dataRoot = path.join(scratch, 'host'), projectsRoot = path.join(scratch, 'projects');
  const evidence = path.resolve('.local/semantic-verification/host-lifecycle', `restart-${randomUUID()}`); await mkdir(evidence, { recursive: true });
  const provider = await startSyntheticProvider(); provider.setMode('slow');
  const first = await crashableHost(dataRoot, projectsRoot); let restarted: Awaited<ReturnType<typeof crashableHost>> | undefined;
  t.after(async () => {
    await restarted?.close(); await first.close(); await provider.close();
    await writeFile(path.join(evidence, 'host-output.json'), JSON.stringify({ first: first.output(), restarted: restarted?.output() }, null, 2));
    await writeFile(path.join(evidence, 'provider-requests.json'), JSON.stringify(provider.requests.map(({ authorization: _authorization, ...request }) => request), null, 2));
    await cp(path.join(dataRoot, 'analysis-verifications'), path.join(evidence, 'analysis-verifications'), { recursive: true }).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  });
  await readJson(await first.request('/api/configuration', 'PUT', { name: '重启合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-restart-model', apiKey: 'synthetic-only-restart-key' }));
  const { project } = await readJson(await first.request('/api/projects', 'POST', { name: '重启保留项目' }), 201);
  const { task } = await readJson(await first.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原任务' }), 201);
  await readJson(await first.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'input.csv', content: Buffer.from('id,value\na,10\n').toString('base64') }), 201);
  await readJson(await first.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'author.md', text: 'RESTART_AUTHOR_ORIGINAL' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}/verifications`, input = { verificationId: randomUUID(), question: '核对10这个数值。', dataFiles: ['020_clean/input.csv'], authorFiles: ['060_reports/author.md'] };
  await readJson(await first.request(route, 'POST', input), 202); await provider.waitForRequests(1);
  const before = (await readJson(await first.request(`${route}/${input.verificationId}`))).verification;
  assert.equal(before.status, 'running'); assert.equal(before.phase, 'cold');
  await first.crash();
  restarted = await crashableHost(dataRoot, projectsRoot);
  const reopened = (await readJson(await restarted.request(`${route}/${input.verificationId}`))).verification;
  assert.equal(reopened.status, 'interrupted');
  assert.equal(reopened.id, input.verificationId); assert.equal(reopened.comparisonResult, undefined);
  assert.equal(provider.requests.length, 1, 'Host readiness and GET must not recreate a model request');
  await readJson(await restarted.request(route, 'POST', input), 200);
  assert.equal(provider.requests.length, 1, 'same interrupted intent must not restart');
  assert.equal(await readFile(path.join(project.rootPath, '060_reports/author.md'), 'utf8'), 'RESTART_AUTHOR_ORIGINAL');
  const retry = { ...input, verificationId: randomUUID(), retryOf: input.verificationId };
  await readJson(await restarted.request(route, 'POST', retry), 202); await provider.waitForRequests(2);
  await readJson(await restarted.request(`${route}/${retry.verificationId}/stop`, 'POST', {}));
  assert.equal((await readJson(await restarted.request(`${route}/${input.verificationId}`))).verification.status, 'interrupted');
  await writeFile(path.join(evidence, 'readback.json'), JSON.stringify({ before, reopened }, null, 2));
});

test('SV07 lifecycle: explicit author revision and one recheck export new reports while preserving originals', { timeout: 60_000 }, async t => {
  const f = await fixture(t, 'revision-recheck-export');
  const originalData = await readFile(path.join(f.project.rootPath, '020_clean/input.csv')), originalAuthor = await readFile(path.join(f.project.rootPath, '060_reports/author.md'));
  await readJson(await f.host.request(f.route, 'POST', f.selection), 202);
  const initial = await until(f.read, value => value.status === 'completed', 'initial verification did not complete');
  assert.equal(f.provider.requests.length, 2);
  f.provider.setChunks(['EXPLICIT_AUTHOR_REVISION_REPLY']);
  await readJson(await f.host.request(`${f.route}/${f.selection.verificationId}/author-revision`, 'POST', { instructions: '请保留原稿，另存修订，并说明未知。' }), 202);
  const revised = await until(f.read, value => value.revision?.status === 'completed', 'author revision did not complete');
  assert.equal(f.provider.requests.length, 3);
  assert.equal(revised.revisionCount, 1);
  assert.match(revised.revision.text, /EXPLICIT_AUTHOR_REVISION_REPLY/);
  assert.equal(revised.revision.files.length, 1);
  const revisionFile = revised.revision.files[0];
  assert.ok(revisionFile.startsWith('060_reports/')); assert.notEqual(revisionFile, '060_reports/author.md');
  assert.match(await readFile(path.join(f.project.rootPath, revisionFile), 'utf8'), /EXPLICIT_AUTHOR_REVISION_REPLY/);
  f.provider.setChunks(['EXPLICIT_FOLLOWUP_RECHECK_REPLY']);
  await readJson(await f.host.request(`${f.route}/${f.selection.verificationId}/recheck`, 'POST', {}), 202);
  const rechecked = await until(f.read, value => value.status === 'completed' && Boolean(value.recheckResult), 'one recheck did not complete');
  assert.equal(f.provider.requests.length, 4);
  assert.equal(rechecked.recheckCount, 1);
  assert.match(rechecked.recheckResult.text, /EXPLICIT_FOLLOWUP_RECHECK_REPLY/);
  assert.equal(rechecked.coldResult.text, initial.coldResult.text);
  assert.equal(rechecked.comparisonResult.text, initial.comparisonResult.text);
  await readJson(await f.host.request(`${f.route}/${f.selection.verificationId}/author-revision`, 'POST', {}), 409);
  await readJson(await f.host.request(`${f.route}/${f.selection.verificationId}/recheck`, 'POST', {}), 409);
  const exported = await readJson(await f.host.request(`${f.route}/${f.selection.verificationId}/export`, 'POST', {}), 201);
  assert.ok(exported.exportedFile.startsWith('060_reports/'));
  assert.notEqual(exported.exportedFile, '060_reports/author.md');
  assert.equal(exported.verification.exportedFile, exported.exportedFile, 'detail projection must retain the export identity');
  const exportBytes = await readFile(path.join(f.project.rootPath, exported.exportedFile));
  assert.match(exportBytes.toString(), /EXPLICIT_FOLLOWUP_RECHECK_REPLY/);
  const repeated = await readJson(await f.host.request(`${f.route}/${f.selection.verificationId}/export`, 'POST', {}), 201);
  assert.equal(repeated.exportedFile, exported.exportedFile, 'repeated explicit export reads the same saved report');
  assert.deepEqual(await readFile(path.join(f.project.rootPath, exported.exportedFile)), exportBytes);
  assert.deepEqual(await readFile(path.join(f.project.rootPath, '020_clean/input.csv')), originalData);
  assert.deepEqual(await readFile(path.join(f.project.rootPath, '060_reports/author.md')), originalAuthor);
  assert.equal(f.provider.requests.length, 4, 'rejected extra actions and export must not call a model');
  await writeFile(path.join(f.evidence, 'readback.json'), JSON.stringify({ initial, revised, rechecked, exported, repeated }, null, 2));
});

test('SV05 lifecycle: Case uses only confirmed prior description and rejects a stale revision', { timeout: 60_000 }, async t => {
  const f = await fixture(t, 'case-prior-background');
  await readJson(await f.host.request('/api/cases/storage/initialize', 'POST', {}));
  let record = (await readJson(await f.host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '业务背景', description: 'CASE_PRIOR_DESCRIPTION_ONLY：本次分析前已知的会员定义。' }), 201)).case;
  record = (await readJson(await f.host.request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: f.project.id }))).case;
  record = (await readJson(await f.host.request(`/api/cases/${record.id}`, 'PATCH', { operationId: randomUUID(), expectedRevision: record.revision, title: record.title, description: record.description, judgement: 'FORBIDDEN_CASE_JUDGEMENT_事后结论', nextStep: 'FORBIDDEN_CASE_NEXT_STEP_事后建议' }))).case;
  const valid = { ...f.selection, caseId: record.id, caseRevision: record.revision, caseBackgroundIsPrior: true };
  await readJson(await f.host.request(f.route, 'POST', { ...valid, caseRevision: record.revision - 1 }), 409);
  await readJson(await f.host.request(f.route, 'POST', { ...valid, caseBackgroundIsPrior: false }), 409);
  assert.equal(f.provider.requests.length, 0, 'invalid Case selection must fail before a model request');
  await readJson(await f.host.request(f.route, 'POST', valid), 202);
  const settled = await until(f.read, value => value.status === 'completed', 'Case verification did not complete');
  const first = JSON.stringify(f.provider.requests[0]!.body.messages);
  assert.match(first, /inputs\/business-context\.md/, 'cold prompt must identify the actual copied context file');
  const suppliedContext = await readFile(path.join(settled.workspace, 'inputs/business-context.md'), 'utf8');
  assert.equal(suppliedContext, settled.semantics.text, 'the supplied context copy must match the frozen record');
  assert.match(suppliedContext, /CASE_PRIOR_DESCRIPTION_ONLY/);
  assert.ok(!first.includes('FORBIDDEN_CASE_JUDGEMENT'));
  assert.ok(!first.includes('FORBIDDEN_CASE_NEXT_STEP'));
  assert.ok(!first.includes('AUTHOR_LIFECYCLE_ANSWER'));
  assert.ok(!suppliedContext.includes('FORBIDDEN_CASE_JUDGEMENT'));
  assert.ok(!suppliedContext.includes('FORBIDDEN_CASE_NEXT_STEP'));
  assert.equal(settled.semantics.sources.find((source: { kind: string }) => source.kind === 'case').version, String(record.revision));
  await writeFile(path.join(f.evidence, 'readback.json'), JSON.stringify(settled, null, 2));
});

test('SV06 lifecycle: stopping a verifier does not cancel a concurrent original analysis request', { timeout: 60_000 }, async t => {
  const f = await fixture(t, 'concurrent-author-isolation', 'slow');
  await readJson(await f.host.request(f.route, 'POST', f.selection), 202); await f.provider.waitForRequests(1);
  const authorRequestId = randomUUID();
  await readJson(await f.host.request(`${f.taskRoute}/messages`, 'POST', { requestId: authorRequestId, text: '原作者独立任务：只查看本轮合成资料，保留文件。' }), 202);
  await f.provider.waitForRequests(2);
  await readJson(await f.host.request(`${f.route}/${f.selection.verificationId}/stop`, 'POST', {}));
  const cancelled = await until(f.read, value => value.status === 'cancelled', 'verifier did not cancel');
  const author = await readJson(await f.host.request(f.taskRoute));
  assert.equal(author.task.lastRun.id, authorRequestId);
  assert.equal(author.task.lastRun.status, 'running');
  assert.equal(author.snapshot.status, 'running');
  assert.equal(cancelled.comparisonResult, undefined);
  assert.equal(f.provider.requests.length, 2, 'no comparison or replacement author request may be dispatched');
  await readJson(await f.host.request(`${f.taskRoute}/stop`, 'POST', {}));
  await writeFile(path.join(f.evidence, 'readback.json'), JSON.stringify({ cancelled, author }, null, 2));
});

test('SV07 lifecycle: changed source data refuses old-context author revision before any model request', { timeout: 60_000 }, async t => {
  const f = await fixture(t, 'source-version-change');
  await readJson(await f.host.request(f.route, 'POST', f.selection), 202);
  const initial = await until(f.read, value => value.status === 'completed', 'initial verification did not complete');
  assert.equal(f.provider.requests.length, 2);
  // Simulate an explicit external edit of this isolated synthetic source, not a product migration.
  await writeFile(path.join(f.project.rootPath, '020_clean/input.csv'), 'member,orders\na,8\nb,1\n');
  const conflict = await readJson(await f.host.request(`${f.route}/${f.selection.verificationId}/author-revision`, 'POST', {}), 409);
  assert.equal(conflict.code, 'verification_source_changed');
  assert.equal(f.provider.requests.length, 2);
  const after = await f.read();
  assert.equal(after.revisionCount ?? 0, 0, 'rejected admission must not consume a repair turn');
  assert.equal(after.authorRevision, undefined);
  assert.equal(after.coldResult.text, initial.coldResult.text);
  assert.equal(after.comparisonResult.text, initial.comparisonResult.text);
  assert.equal(await readFile(path.join(after.dataFiles[0].snapshotPath), 'utf8'), 'member,orders\na,2\nb,1\n');
  await writeFile(path.join(f.evidence, 'readback.json'), JSON.stringify({ conflict, initial, after }, null, 2));
});
