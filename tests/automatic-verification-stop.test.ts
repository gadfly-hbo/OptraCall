import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createAutomaticVerificationFeature } from '../src/host/automatic-verification-host.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
async function fixture() {
  const who = { projectId: randomUUID(), taskId: randomUUID() }, requestId = randomUUID();
  let state = { mode: 'protected', unmanagedSeen: false, freshRegistered: true, busy: true }, stopCalls = 0, closeCalls = 0, revoked = false;
  let resolveStop!: () => void, rejectStop!: (error: Error) => void, closeFailure = false;
  let signalStop!: () => void; const stopEntered = new Promise<void>(resolve => { signalStop = resolve; });
  const stopped = new Promise<void>((resolve, reject) => { resolveStop = resolve; rejectStop = reject; });
  const owner = { project: { id: who.projectId }, task: { id: who.taskId, lastRun: { id: requestId } } };
  const sessions = { ref: (value: unknown) => value, executionState: () => state, busy: () => state.busy, stop: async () => {
    stopCalls++; revoked = true; signalStop();
    try { await stopped; state = { ...state, mode: 'none', busy: false }; return true; }
    catch (error) { state = { ...state, mode: 'unknown' }; throw error; }
  }, close: async () => { closeCalls++; if (closeFailure) throw Object.assign(new Error('protected_cleanup_unknown'), { code: 'protected_cleanup_unknown' }); state = { ...state, mode: 'none', busy: false }; } };
  const feature = createAutomaticVerificationFeature({ dataRoot: await mkdtemp(path.join(os.tmpdir(), 'automatic-stop-')), projects: {}, verification: { automatic: {} }, sessions, pair: async () => owner, configuration() {}, selectedConfiguration() {}, mutate: async (use: () => unknown) => use(), settle: async () => {}, notify() {} } as any);
  const settings = await feature.store.saveSettings(who, { enabled: true, question: '合成停止合同', dataFiles: ['020_clean/input.csv'], reportPath: '060_reports/report.md' }, 0);
  const configuration = { id: randomUUID(), revision: 1, provider: 'synthetic', model: 'none' };
  const { chain } = await feature.store.createChain({ ...who, requestId, requestFingerprint: sha('request'), reportSha256: sha('report'), settingsSnapshot: settings, configuration, verificationConfiguration: configuration, native: { sessionFile: '/synthetic/native.jsonl', sessionId: randomUUID(), bytes: 1, sha256: sha('native') } });
  return { feature, chain, who, stopEntered, resolveStop, rejectStop, failClose(value: boolean) { closeFailure = value; }, untrust() { state = { ...state, freshRegistered: false, mode: 'none', busy: false }; }, facts: () => ({ stopCalls, closeCalls, revoked, state }) };
}

test('automatic stop revokes dispatch immediately but cannot record cancelled before actual cleanup acknowledgement', async () => {
  const f = await fixture(), pending = f.feature.stop(f.chain);
  await f.stopEntered;
  assert.equal(f.facts().revoked, true);
  assert.notEqual((await f.feature.store.readChain(f.chain)).state, 'cancelled');
  f.resolveStop(); const result = await pending;
  assert.equal(result.state, 'cancelled'); assert.equal(result.cleanup?.state, 'confirmed');
  await f.feature.stop(f.chain);
  assert.equal(f.facts().stopCalls, 1);
});

test('failed stop stays UNKNOWN; explicit close retries cleanup without rewriting that historical result or replaying dispatch', async () => {
  const f = await fixture(), pending = f.feature.stop(f.chain);
  await f.stopEntered;
  f.rejectStop(Object.assign(new Error('protected_cleanup_unknown'), { code: 'protected_cleanup_unknown' }));
  await assert.rejects(pending);
  const failed = await f.feature.readChain(f.chain);
  assert.equal(failed.state, 'unknown'); assert.equal(failed.reason, 'request_unknown');
  assert.equal(failed.cleanup?.state, 'unknown'); assert.equal(failed.cleanup?.retryable, true);
  const historical = await f.feature.store.readChain(f.chain);
  f.failClose(true); await assert.rejects(f.feature.stop(f.chain));
  assert.deepEqual(await f.feature.store.readChain(f.chain), historical);
  f.failClose(false); const cleaned = await f.feature.stop(f.chain);
  assert.equal(cleaned.state, 'unknown'); assert.equal(cleaned.reason, 'request_unknown');
  assert.equal(cleaned.revision, failed.revision, 'an explicit successful cleanup cannot rewrite immutable UNKNOWN analysis history');
  assert.equal(cleaned.cleanup?.state, 'confirmed');
  assert.deepEqual(f.facts().state, { mode: 'none', unmanagedSeen: false, freshRegistered: true, busy: false });
  assert.equal(f.facts().stopCalls, 1); assert.equal(f.facts().closeCalls, 2);
});

test('an old unknown owner cannot gain a cleanup proof from an empty public close', async () => {
  const f = await fixture();
  await f.feature.store.updateChain(f.chain, { state: 'unknown', phase: 'ended', reason: 'request_unknown' }); f.untrust();
  await assert.rejects(f.feature.stop(f.chain), { code: 'automatic_cleanup_unproven' });
  assert.equal(f.facts().closeCalls, 0);
  assert.equal((await f.feature.readChain(f.chain)).cleanup?.state, 'unknown');
});

test('settings CAS revokes later dispatch but failed cleanup must stay UNKNOWN rather than prematurely paused', async () => {
  const f = await fixture(), pending = f.feature.saveSettings(f.who, { enabled: false }, 1);
  await f.stopEntered;
  const waiting = await f.feature.store.readChain(f.chain);
  assert.equal(waiting.reason, 'settings_changed'); assert.equal(waiting.state, 'preparing');
  assert.equal(f.facts().revoked, true);
  f.rejectStop(Object.assign(new Error('protected_cleanup_unknown'), { code: 'protected_cleanup_unknown' }));
  await assert.rejects(pending);
  assert.equal((await f.feature.store.readChain(f.chain)).state, 'unknown');
  assert.equal((await f.feature.store.readSettings(f.who)).enabled, false, 'the already committed setting is retained without pretending resource cleanup succeeded');
});

test('outer public completion preserves settings pause intent and requires its actual cleanup acknowledgement', async () => {
  const f = await fixture(), pending = f.feature.saveSettings(f.who, { enabled: false }, 1);
  await f.stopEntered;
  f.resolveStop();
  await f.feature.operationFinished(f.chain, f.chain.requestId, { outcome: 'completed', text: '', automaticCancellation: true });
  await pending;
  const observed = await f.feature.readChain(f.chain);
  assert.equal(observed.state, 'paused'); assert.equal(observed.reason, 'settings_changed');
  assert.equal(observed.cleanup.state, 'confirmed');
});
