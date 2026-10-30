import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runDiagnostic, readRunDiagnostic, runtimeDiagnostic } from '../src/agent/run-diagnostics.ts';
import { ProjectStore } from '../src/host/project-store.ts';

test('ER01: diagnostic classification only reports explicit failure facts and never echoes error payload', () => {
  for (const [error, code] of [['401 synthetic-private-detail', 'authentication_failed'], ['403: synthetic-private-detail', 'authentication_failed'], ['429 synthetic-private-detail', 'rate_limited'], ['terminated', 'request_terminated'], ['Any ambiguous provider error synthetic-private-detail', 'request_failed'], [{ code: 401, secret: 'synthetic-private-detail' }, 'request_failed']]) {
    const result = runDiagnostic({ outcome: 'failed', kind: 'prompt', error, retryCount: 2 });
    assert.equal(result?.code, code); assert.equal(result?.retryCount, 2);
    assert.ok(!JSON.stringify(result).includes('synthetic-private-detail'));
    if (code === 'request_terminated') assert.match(result!.message, /尚未确定/);
  }
  assert.equal(runDiagnostic({ outcome: 'completed', kind: 'prompt', retryCount: 0 }), undefined);
  assert.equal(runDiagnostic({ outcome: 'completed', kind: 'prompt', retryCount: 2 })?.code, 'completed_after_retry');
  assert.equal(runDiagnostic({ outcome: 'cancelled', kind: 'command', error: '401 raw-detail', retryCount: 1 })?.code, 'cancelled');
  assert.equal(runtimeDiagnostic({ code: 'runtime_process_stopped', cause: 'synthetic-private-detail' }).code, 'runtime_stopped');
  assert.equal(runtimeDiagnostic({ code: 'runtime_start_failed', cause: 'synthetic-private-detail' }).code, 'runtime_start_failed');
  assert.equal(runtimeDiagnostic({ code: 'runtime_start_timeout', cause: 'synthetic-private-detail' }).code, 'runtime_start_timeout');
  assert.ok(!JSON.stringify(runtimeDiagnostic(new Error('synthetic-private-detail'))).includes('synthetic-private-detail'));
});

test('ER01: saved diagnostics are rebuilt from safe enums while legacy absence remains absent', () => {
  assert.equal(readRunDiagnostic(undefined), undefined);
  assert.equal(readRunDiagnostic({ code: 'synthetic-private-detail', stage: 'native_request', retryCount: 0 }), undefined);
  assert.equal(readRunDiagnostic({ code: 'request_failed', stage: 'private-detail', retryCount: 0 }), undefined);
  assert.equal(readRunDiagnostic({ code: 'request_failed', stage: ['native_request'], retryCount: 0 }), undefined);
  assert.equal(readRunDiagnostic({ code: 'request_failed', stage: 'native_request', retryCount: -1 }), undefined);
  assert.equal(readRunDiagnostic({ code: 'request_failed', stage: 'native_request', retryCount: 0.2 }), undefined);
  const decoded = readRunDiagnostic({ code: 'request_failed', stage: 'native_request', retryCount: 2, message: 'synthetic-private-detail', extraPayload: 'synthetic-private-detail' });
  assert.equal(decoded?.code, 'request_failed');
  assert.ok(!JSON.stringify(decoded).includes('synthetic-private-detail'));
});

test('ER01: project run compatibility preserves old metadata bytes and safely reopens new diagnostics', async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-diagnostic-storage-'));
  const options = { dataRoot: path.join(scratch, 'host'), projectsRoot: path.join(scratch, 'workspaces') };
  const store = new ProjectStore(options); await store.init();
  const configuration = { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic-model', name: 'Synthetic', baseUrl: 'http://127.0.0.1:1/v1' };
  const project = await store.create({ name: 'Diagnostic compatibility', configuration });
  const task = await store.createTask(project.id, { name: 'Old saved run' });
  const legacy = { id: randomUUID(), status: 'failed' as const, startedAt: '2026-10-30T00:00:00.000Z', settledAt: '2026-10-30T00:01:00.000Z' };
  await store.markRun(project.id, task.id, legacy);
  const metadata = path.join(options.dataRoot, 'projects', project.id, 'project.json'), legacyBytes = await readFile(metadata);
  await store.close();
  const reopened = new ProjectStore(options); await reopened.init();
  t.after(async () => { await reopened.close(); await rm(scratch, { recursive: true, force: true }); });
  assert.deepEqual((await reopened.getTask(project.id, task.id)).lastRun, legacy);
  assert.deepEqual(await readFile(metadata), legacyBytes, 'Reading legacy runs does not migrate or rewrite them');
  const diagnostic = runDiagnostic({ outcome: 'failed', kind: 'prompt', error: 'terminated', retryCount: 3 })!;
  const next = { ...legacy, id: randomUUID(), diagnostic };
  await reopened.markRun(project.id, task.id, next);
  assert.deepEqual((await reopened.getTask(project.id, task.id)).lastRun, next);
  const stored = JSON.parse(await readFile(metadata, 'utf8'));
  assert.equal(stored.schemaVersion, 2);
  const nextBytes = await readFile(metadata); await reopened.close();
  const reader = new ProjectStore(options);
  try {
    await reader.init();
    assert.deepEqual((await reader.getTask(project.id, task.id)).lastRun, next);
    assert.deepEqual(await readFile(metadata), nextBytes, 'Reopening new optional diagnostics does not rewrite metadata either');
  } finally { await reader.close(); }
});
