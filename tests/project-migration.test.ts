import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ProjectStore } from '../src/host/project-store.ts';
import { SessionManager } from '../src/agent/sdk.ts';
import { savedTaskHistory } from '../src/host/project-history.ts';
import { runDiagnostic } from '../src/agent/run-diagnostics.ts';

async function legacyFixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-legacy-migration-')), id = randomUUID();
  const options = { dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') };
  const privateProject = path.join(options.dataRoot, 'projects', id), projectRoot = path.join(options.projectsRoot, id), sessions = path.join(privateProject, 'sessions');
  await fs.mkdir(sessions, { recursive: true, mode: 0o700 });
  for (const directory of ['010_draw', '020_clean', '060_reports']) await fs.mkdir(path.join(projectRoot, directory), { recursive: true, mode: 0o700 });
  const parentFile = path.join(sessions, 'parent.jsonl'), sessionFile = path.join(sessions, 'fork.jsonl'), now = '2026-10-28T12:00:00.000Z';
  const header = { type: 'session', version: 3, id: randomUUID(), timestamp: now, cwd: path.join(projectRoot, '020_clean') };
  const custom = { type: 'custom', id: 'native-run', parentId: null, timestamp: now, customType: 'optracall.run', data: { requestId: randomUUID(), phase: 'settled', outcome: 'completed' } };
  const parentBytes = Buffer.from(JSON.stringify(header) + '\n' + JSON.stringify(custom) + '\n');
  const forkBytes = Buffer.from(JSON.stringify({ ...header, id: randomUUID(), parentSession: parentFile }) + '\n' + JSON.stringify(custom) + '\n');
  await fs.writeFile(parentFile, parentBytes, { mode: 0o600 }); await fs.writeFile(sessionFile, forkBytes, { mode: 0o600 });
  const raw = path.join(projectRoot, '010_draw', '原始合成.csv'), clean = path.join(projectRoot, '020_clean', '准备合成.csv'), report = path.join(projectRoot, '060_reports', '报告.md');
  await fs.writeFile(raw, 'id,value\n1,7\n', { mode: 0o600 }); await fs.writeFile(clean, 'id,value\n1,7\n', { mode: 0o600 }); await fs.writeFile(report, '# 原有合成报告\n', { mode: 0o600 });
  const record = { schemaVersion: 1, id, name: '旧合成项目', createdAt: now, updatedAt: now, configuration: { id: 'synthetic-model', name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1/v1', revision: 1 }, draft: '迁移前未发送的草稿', uploads: [], sessionFile, lastRun: { id: custom.data.requestId, status: 'completed', startedAt: now, settledAt: now } };
  const metadata = path.join(privateProject, 'project.json'), backup = path.join(privateProject, 'project.v1.backup.json'), original = Buffer.from(JSON.stringify(record, null, 2) + '\n');
  await fs.writeFile(metadata, original, { mode: 0o600 });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, id, options, metadata, backup, original, record, sessions, sessionFile, parentFile, parentBytes, forkBytes, raw, clean, report };
}

test('MIGRATE-01: v1 becomes one legacy task without changing project identity, file bytes or native fork parent paths', async t => {
  const f = await legacyFixture(t), store = new ProjectStore(f.options); await store.init(); t.after(() => store.close());
  const project = await store.get(f.id); assert.equal(project.schemaVersion, 2); assert.equal(project.id, f.id); assert.equal(project.archivedAt, null); assert.equal(project.tasks.length, 1);
  const task = project.tasks[0]!; assert.equal(task.name, '原有任务'); assert.equal(task.sessionStorage, 'legacy'); assert.equal(task.sessionDirectory, f.sessions); assert.equal(task.sessionFile, f.sessionFile);
  assert.equal(task.draft, f.record.draft); assert.deepEqual(task.configuration, f.record.configuration); assert.deepEqual(task.lastRun, f.record.lastRun); assert.equal(task.createdAt, f.record.createdAt); assert.equal(task.updatedAt, f.record.updatedAt);
  assert.deepEqual(await fs.readFile(f.backup), f.original); assert.equal((await fs.stat(f.backup)).mode & 0o777, 0o600);
  assert.deepEqual(await fs.readFile(f.parentFile), f.parentBytes); assert.deepEqual(await fs.readFile(f.sessionFile), f.forkBytes);
  assert.equal(SessionManager.open(f.sessionFile, f.sessions).getHeader()?.parentSession, f.parentFile);
  assert.equal(await fs.readFile(f.raw, 'utf8'), 'id,value\n1,7\n'); assert.equal(await fs.readFile(f.clean, 'utf8'), 'id,value\n1,7\n'); assert.equal(await fs.readFile(f.report, 'utf8'), '# 原有合成报告\n');
  const metadataAfter = await fs.readFile(f.metadata); await store.close(); const restarted = new ProjectStore(f.options); await restarted.init();
  try { assert.equal((await restarted.get(f.id)).tasks[0]?.id, task.id); assert.deepEqual(await fs.readFile(f.metadata), metadataAfter); assert.deepEqual(await fs.readFile(f.backup), f.original); }
  finally { await restarted.close(); }
});

test('MIGRATE-02: actual process exit after backup sync resumes one migration and keeps every native file unchanged', async t => {
  const f = await legacyFixture(t), moduleUrl = new URL('../src/host/project-store.ts', import.meta.url).href;
  const script = `import fs from 'node:fs/promises'; import { ProjectStore } from ${JSON.stringify(moduleUrl)};
const rename = fs.rename; fs.rename = async (from, to) => { if (to === ${JSON.stringify(f.metadata)}) process.exit(77); return rename(from, to); };
const store = new ProjectStore(${JSON.stringify(f.options)}); await store.init(); process.exit(9);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  assert.equal(code, 77, stderr); assert.deepEqual(await fs.readFile(f.metadata), f.original); assert.deepEqual(await fs.readFile(f.backup), f.original);
  const resumed = new ProjectStore(f.options); await resumed.init();
  const taskId = (await resumed.get(f.id)).tasks[0]?.id; assert.ok(taskId); await resumed.close();
  const again = new ProjectStore(f.options); await again.init();
  try { const result = await again.get(f.id); assert.equal(result.tasks.length, 1); assert.equal(result.tasks[0]?.id, taskId); }
  finally { await again.close(); }
  assert.deepEqual(await fs.readFile(f.backup), f.original); assert.deepEqual(await fs.readFile(f.parentFile), f.parentBytes); assert.deepEqual(await fs.readFile(f.sessionFile), f.forkBytes);
});

test('MIGRATE-03: conflicting or unsafe existing backups and unknown schemas are preserved instead of overwritten', async t => {
  const f = await legacyFixture(t); const conflict = Buffer.from('{"different":"retain this backup"}\n'); await fs.writeFile(f.backup, conflict, { mode: 0o600 });
  const conflicting = new ProjectStore(f.options); await assert.rejects(conflicting.init(), /migration_backup_conflict/); await conflicting.close();
  assert.deepEqual(await fs.readFile(f.backup), conflict); assert.deepEqual(await fs.readFile(f.metadata), f.original);
  await fs.unlink(f.backup); await fs.symlink(f.raw, f.backup);
  const unsafe = new ProjectStore(f.options); await assert.rejects(unsafe.init(), /invalid_project_metadata/); await unsafe.close();
  assert.equal(await fs.readFile(f.raw, 'utf8'), 'id,value\n1,7\n'); assert.deepEqual(await fs.readFile(f.metadata), f.original);
  await fs.unlink(f.backup);
  const unknown = Buffer.from(JSON.stringify({ ...f.record, schemaVersion: 999 }) + '\n'); await fs.writeFile(f.metadata, unknown);
  const unsupported = new ProjectStore(f.options); await assert.rejects(unsupported.init(), /invalid_project_metadata/); await unsupported.close();
  assert.deepEqual(await fs.readFile(f.metadata), unknown); await assert.rejects(fs.stat(f.backup), { code: 'ENOENT' });
});

test('MIGRATE-04: malformed UTF-8 metadata stays untouched instead of being migrated with replacement characters', async t => {
  const f = await legacyFixture(t), marker = Buffer.from('旧合成项目'), index = f.original.indexOf(marker); assert.ok(index >= 0);
  const corrupt = Buffer.concat([f.original.subarray(0, index), Buffer.from([0xff]), f.original.subarray(index + marker.length)]);
  await fs.writeFile(f.metadata, corrupt);
  const store = new ProjectStore(f.options); await assert.rejects(store.init(), /invalid_project_metadata/); await store.close();
  assert.deepEqual(await fs.readFile(f.metadata), corrupt); await assert.rejects(fs.stat(f.backup), { code: 'ENOENT' });
});


async function historyFixture(t: { after: (fn: () => Promise<void>) => void }, markers: (sessionId: string) => Record<string, unknown>[]) {
  const f = await legacyFixture(t), header = JSON.parse(f.forkBytes.toString().split('\n')[0]!);
  let parentId: string | null = null;
  const entries = markers(header.id).map(data => {
    const entry = { type: 'custom', id: randomUUID(), parentId, timestamp: header.timestamp, customType: 'optracall.run', data };
    parentId = entry.id; return entry;
  });
  const bytes = Buffer.from([header, ...entries].map(value => JSON.stringify(value)).join('\n')+'\n');
  await fs.writeFile(f.sessionFile, bytes);
  const store = new ProjectStore(f.options); await store.init();
  const project = await store.get(f.id), task = project.tasks[0]!; await store.close();
  return { ...f, project, task, bytes, read: () => savedTaskHistory(project, task, 'synthetic-history') };
}

for (const outcome of ['completed', 'failed', 'cancelled'] as const) test(`ER01 recovery: same-request ${outcome} diagnostic survives native-only history read`, async t => {
  const id = randomUUID(), diagnostic = runDiagnostic({ outcome, kind: 'prompt', error: 'terminated', retryCount: 2 })!;
  const f = await historyFixture(t, sessionId => [
    { phase: 'started', requestId: id, sessionId },
    { phase: 'settled', requestId: id, sessionId, outcome, diagnostic: { ...diagnostic, message: 'synthetic-private-provider-payload', rawError: 'synthetic-private-provider-payload' } },
  ]);
  assert.deepEqual(f.read().lastRun, { requestId: id, outcome, diagnostic });
  assert.equal(JSON.stringify(f.read().lastRun).includes('synthetic-private-provider-payload'), false);
  assert.deepEqual(await fs.readFile(f.sessionFile), f.bytes, 'Native history reads do not rewrite old JSONL');
});

test('ER01 recovery: legacy markers and unknown optional diagnostics remain readable without invented causes', async t => {
  const id = randomUUID();
  const f = await historyFixture(t, () => [
    { phase: 'started', requestId: id },
    { phase: 'settled', requestId: id, outcome: 'failed', diagnostic: { code: 'future_unknown_code', stage: 'native_request', message: 'synthetic-private-provider-payload', retryCount: 4 } },
  ]);
  assert.deepEqual(f.read().lastRun, { requestId: id, outcome: 'failed' });
  assert.deepEqual(await fs.readFile(f.sessionFile), f.bytes);
});

test('ER01 recovery: copied fork-parent markers cannot become the current session terminal or diagnostic', async t => {
  const id = randomUUID(), parent = randomUUID(), parentDiagnostic = runDiagnostic({ outcome: 'failed', kind: 'prompt', error: 'terminated', retryCount: 3 });
  const f = await historyFixture(t, sessionId => [
    { phase: 'started', requestId: id, sessionId },
    { phase: 'settled', requestId: id, sessionId: parent, outcome: 'failed', diagnostic: parentDiagnostic },
  ]);
  assert.deepEqual(f.read().lastRun, { requestId: id });
  assert.deepEqual(await fs.readFile(f.sessionFile), f.bytes);
});

test('ER01 recovery: a late terminal for an earlier request cannot supply outcome or diagnostic to a newer started run', async t => {
  const first = randomUUID(), next = randomUUID(), oldDiagnostic = runDiagnostic({ outcome: 'failed', kind: 'prompt', error: 'terminated', retryCount: 3 });
  const f = await historyFixture(t, sessionId => [
    { phase: 'started', requestId: first, sessionId },
    { phase: 'settled', requestId: first, sessionId, outcome: 'failed', diagnostic: oldDiagnostic },
    { phase: 'started', requestId: next, sessionId },
    { phase: 'settled', requestId: first, sessionId, outcome: 'failed', diagnostic: oldDiagnostic },
  ]);
  assert.deepEqual(f.read().lastRun, { requestId: next });
  assert.deepEqual(await fs.readFile(f.sessionFile), f.bytes);
});

test('ER01 recovery: nonterminal or invalid-outcome markers never promote a run to a known terminal', async t => {
  const id = randomUUID(), diagnostic = runDiagnostic({ outcome: 'failed', kind: 'prompt', error: 'terminated' });
  const f = await historyFixture(t, sessionId => [
    { requestId: id, startedAt: '2026-10-28T12:00:00.000Z' },
    { phase: 'started', requestId: id, sessionId, outcome: 'failed', diagnostic },
    { phase: 'settled', requestId: id, sessionId, outcome: 'not-a-terminal', diagnostic },
  ]);
  assert.deepEqual(f.read().lastRun, { requestId: id });
  assert.deepEqual(await fs.readFile(f.sessionFile), f.bytes);
});


test('ER01 recovery: completed, failed and cancelled histories keep each request diagnostic separate', async t => {
  for (const previousOutcome of ['completed', 'failed', 'cancelled'] as const) for (const outcome of ['completed', 'failed', 'cancelled'] as const) {
    const previous = randomUUID(), current = randomUUID();
    const previousDiagnostic = runDiagnostic({ outcome: previousOutcome, kind: 'command', error: 'terminated', retryCount: 3 });
    const diagnostic = runDiagnostic({ outcome, kind: 'prompt', error: 'terminated', retryCount: 1 });
    const f = await historyFixture(t, sessionId => [
      { phase: 'started', requestId: previous, sessionId },
      { phase: 'settled', requestId: previous, sessionId, outcome: previousOutcome, diagnostic: previousDiagnostic },
      { phase: 'started', requestId: current, sessionId },
      { phase: 'settled', requestId: current, sessionId, outcome, diagnostic },
    ]);
    assert.deepEqual(f.read().lastRun, { requestId: current, outcome, diagnostic });
    assert.deepEqual(await fs.readFile(f.sessionFile), f.bytes);
  }
});

test('ER01 recovery: a diagnostic contradictory to its native outcome is ignored without rewriting evidence', async t => {
  for (const outcome of ['completed', 'failed', 'cancelled'] as const) {
    const id = randomUUID(), wrongOutcome = outcome === 'failed' ? 'cancelled' : 'failed';
    const diagnostic = runDiagnostic({ outcome: wrongOutcome, kind: 'prompt', error: 'terminated', retryCount: 4 });
    const f = await historyFixture(t, sessionId => [
      { phase: 'started', requestId: id, sessionId },
      { phase: 'settled', requestId: id, sessionId, outcome, diagnostic },
    ]);
    assert.deepEqual(f.read().lastRun, { requestId: id, outcome });
    assert.deepEqual(await fs.readFile(f.sessionFile), f.bytes);
  }
});
