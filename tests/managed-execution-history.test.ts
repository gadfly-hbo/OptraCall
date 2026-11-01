import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, link } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { readManagedExecutionHistory } from '../src/host/managed-execution-history.ts';

const start = '2026-11-01T03:00:00.000Z', openedAt = '2026-11-01T03:00:00.100Z', closedAt = '2026-11-01T03:00:01.000Z';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'managed-history-')), sessionDirectory = path.join(root, 'sessions');
  const owner = { projectId: randomUUID(), taskId: randomUUID() }, sessionId = randomUUID(), requestId = randomUUID(), executionId = randomUUID(), cwd = path.join(root, '020_clean');
  const file = path.join(sessionDirectory, `${sessionId}.jsonl`);
  const header = { type: 'session', version: 3, id: sessionId, cwd, timestamp: start };
  const receipt = (phase: 'opened' | 'closed', changes = {}) => ({ type: 'custom', customType: 'optracall.execution', data: { version: 1, phase, executionId, sessionId, scopeId: 'ordinary-scope', profile: 'ordinary', at: phase === 'opened' ? openedAt : closedAt, ...changes } });
  const run = { type: 'custom', customType: 'optracall.run', data: { phase: 'started', sessionId, requestId } };
  const observation: any = { ...owner, requestId, admittedAt: start };
  const readObservation = async (id: string) => id === requestId ? observation : undefined;
  const input = { ...owner, sessionDirectory, sessionFile: file, cwd, trustedOwner: true, allowFresh: true, readObservation };
  const save = async (entries: unknown[]) => { await mkdir(sessionDirectory, { mode: 0o700 }); await writeFile(file, entries.map(v => JSON.stringify(v)).join('\n') + '\n', { mode: 0o600 }); };
  return { root, input, file, header, receipt, run, observation, save };
}

test('a fresh start requires the current Host registration, no run and no native files; an empty directory alone proves nothing', async () => {
  const f = await fixture();
  assert.equal((await readManagedExecutionHistory({ ...f.input, sessionFile: undefined })).state, 'fresh');
  await mkdir(f.input.sessionDirectory);
  assert.equal((await readManagedExecutionHistory({ ...f.input, sessionFile: undefined })).state, 'fresh');
  assert.equal((await readManagedExecutionHistory({ ...f.input, sessionFile: undefined, trustedOwner: false })).state, 'unknown');
  assert.equal((await readManagedExecutionHistory({ ...f.input, sessionFile: undefined, allowFresh: false })).state, 'unknown');
});

test('managed closed history is proven by same-session ordered receipts and the original no-native admission', async () => {
  const f = await fixture(); await f.save([f.header, f.receipt('opened'), f.run, { type: 'message', message: { role: 'user', content: 'ordinary request' } }, f.receipt('closed')]);
  const result = await readManagedExecutionHistory(f.input);
  assert.equal(result.state, 'closed'); assert.equal(result.sessionId, f.header.id);
  assert.equal(result.firstRequestId, f.run.data.requestId);
});

test('an unmatched current opening is evidence only, not a clean restart proof', async () => {
  const f = await fixture(); await f.save([f.header, f.receipt('opened'), f.run]);
  const result = await readManagedExecutionHistory(f.input);
  assert.equal(result.state, 'open');
  assert.deepEqual(result.active, { executionId: f.receipt('opened').data.executionId, scopeId: 'ordinary-scope', profile: 'ordinary' });
});

test('later protected executions retain the original observed native prefix, and changed prefixes cannot qualify', async () => {
  const f = await fixture();
  const initial = [f.header, f.receipt('opened'), f.run, f.receipt('closed')], prefix = Buffer.from(initial.map(v => JSON.stringify(v)).join('\n') + '\n');
  f.observation.completedNative = { sessionId: f.header.id, sessionFile: f.file, bytes: prefix.length, sha256: createHash('sha256').update(prefix).digest('hex') };
  const nextId = randomUUID(), next = (phase: 'opened' | 'closed') => f.receipt(phase, { executionId: nextId, profile: 'protected', scopeId: 'protected-scope', at: phase === 'opened' ? '2026-11-01T03:00:02.000Z' : '2026-11-01T03:00:03.000Z' });
  await f.save([...initial, next('opened'), next('closed')]);
  assert.equal((await readManagedExecutionHistory(f.input)).state, 'closed');
  f.observation.completedNative.sha256 = 'a'.repeat(64);
  assert.equal((await readManagedExecutionHistory(f.input)).state, 'unknown');
});

test('the trusted SDK private temp directory is not a second history, but aliases and unknown sibling directories are rejected', async () => {
  for (const mode of ['sdk-temp', 'symlink', 'unknown'] as const) {
    const f = await fixture(); await f.save([f.header, f.receipt('opened'), f.run, f.receipt('closed')]);
    const temp = path.join(f.input.sessionDirectory, mode === 'unknown' ? 'unrecorded-history' : '.protected-tmp');
    if (mode === 'symlink') await symlink(f.root, temp); else await mkdir(temp, { mode: 0o700 });
    assert.equal((await readManagedExecutionHistory(f.input)).state, mode === 'sdk-temp' ? 'closed' : 'unknown');
    if (mode === 'sdk-temp') assert.equal((await readManagedExecutionHistory({ ...f.input, sessionFile: undefined })).state, 'unknown', 'a private temp directory alone cannot establish a fresh owner');
  }
});

test('legacy, fork, wrong-session or mismatched closure histories never qualify', async () => {
  for (const mode of ['legacy', 'fork', 'wrong-session', 'wrong-close', 'early-user', 'outside-user', 'duplicate-close', 'foreign-native'] as const) {
    const f = await fixture();
    let entries: unknown[] = [f.header, f.receipt('opened'), f.run, f.receipt('closed')];
    if (mode === 'legacy') entries = [f.header, f.run];
    if (mode === 'fork') entries[0] = { ...f.header, parentSession: '/old/parent.jsonl' };
    if (mode === 'wrong-session') entries[1] = f.receipt('opened', { sessionId: randomUUID() });
    if (mode === 'wrong-close') entries[3] = f.receipt('closed', { scopeId: 'another' });
    if (mode === 'early-user') entries.splice(1, 0, { type: 'message', message: { role: 'user' } });
    if (mode === 'outside-user') entries.push({ type: 'message', message: { role: 'user' } });
    if (mode === 'duplicate-close') entries.push(f.receipt('closed'));
    await f.save(entries);
    if (mode === 'foreign-native') await writeFile(path.join(f.input.sessionDirectory, 'other.jsonl'), JSON.stringify(f.header) + '\n');
    assert.equal((await readManagedExecutionHistory(f.input)).state, 'unknown', mode);
  }
});

test('the first actual request needs the immutable pre-native admission, not a later observation or copied identity', async () => {
  for (const change of [{ native: { sessionId: 'already-existed' } }, { admittedAt: closedAt }, { taskId: randomUUID() }, { requestId: randomUUID() }]) {
    const f = await fixture(); Object.assign(f.observation, change);
    await f.save([f.header, f.receipt('opened'), f.run, f.receipt('closed')]);
    assert.equal((await readManagedExecutionHistory(f.input)).state, 'unknown');
  }
  const f = await fixture(); await f.save([f.header, f.receipt('opened'), f.run, f.receipt('closed')]);
  assert.equal((await readManagedExecutionHistory({ ...f.input, readObservation: async () => undefined })).state, 'unknown');
  assert.equal((await readManagedExecutionHistory({ ...f.input, trustedOwner: false })).state, 'unknown', 'matching JSON receipts and observations cannot self-certify an old or restarted owner');
});

test('unsafe native paths, symlink directories, hardlinks and truncated JSON remain unknown and unchanged', async () => {
  for (const mode of ['symlink', 'hardlink', 'truncated', 'outside'] as const) {
    const f = await fixture(); await f.save([f.header, f.receipt('opened'), f.run, f.receipt('closed')]);
    let input = f.input;
    if (mode === 'symlink') { const alias = path.join(f.root, 'alias'); await symlink(f.input.sessionDirectory, alias); input = { ...input, sessionDirectory: alias, sessionFile: path.join(alias, path.basename(f.file)) }; }
    if (mode === 'hardlink') await link(f.file, path.join(f.root, 'alias.jsonl'));
    if (mode === 'truncated') await writeFile(f.file, JSON.stringify(f.header));
    if (mode === 'outside') input = { ...input, sessionFile: path.join(f.root, 'outside.jsonl') };
    assert.equal((await readManagedExecutionHistory(input)).state, 'unknown', mode);
  }
});
