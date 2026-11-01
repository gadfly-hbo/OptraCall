import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, link, lstat, chmod } from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createAutomaticVerificationStore, automaticTriggerFingerprint } from '../src/host/automatic-verification-store.ts';
import type { AutomaticSettings, CreateAutomaticChainInput, AutomaticStep } from '../src/host/automatic-verification-types.ts';

const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const owner = () => ({ projectId: randomUUID(), taskId: randomUUID() });
const settings = { enabled: true, question: '核对本次报告', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/report.md', processFiles: ['020_clean/calc.py'], maxAuthorTurns: 2 as const };
async function setup() { const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'automatic-store-')); return { dataRoot, store: createAutomaticVerificationStore({ dataRoot }), who: owner() }; }
function chainInput(who: ReturnType<typeof owner>, s: AutomaticSettings): CreateAutomaticChainInput {
  return { ...who, requestId: randomUUID(), requestFingerprint: digest('message'), reportSha256: digest('report'), settingsSnapshot: s,
    native: { sessionFile: '/synthetic/native/session.jsonl', sessionId: randomUUID(), bytes: 100, sha256: digest('native') },
    configuration: { id: randomUUID(), revision: 1, provider: 'synthetic', model: 'test' }, verificationConfiguration: { id: randomUUID(), revision: 1, provider: 'synthetic', model: 'test' } };
}
function step(who: ReturnType<typeof owner>, phase: AutomaticStep['phase'], ordinal: number): AutomaticStep {
  const requestId = randomUUID(), now = new Date().toISOString();
  return { stepId: randomUUID(), requestId, phase, ordinal, domain: phase === 'author' ? 'project-tasks' : 'independent-verification', owner: { ...who, ...(phase === 'author' ? {} : { verificationId: randomUUID() }) }, status: 'completed', plannedAt: now, acceptedAt: now, settledAt: now };
}

test('missing settings are disabled and read-only, then CAS serializes competing settings updates', async () => {
  const { store, who, dataRoot } = await setup();
  assert.deepEqual(await store.readSettings(who), { ...who, formatVersion: 1, revision: 0, enabled: false, dataFiles: [], processFiles: [], maxAuthorTurns: 2 });
  await assert.rejects(lstat(path.join(dataRoot, 'automatic-verifications')), { code: 'ENOENT' });
  const saved = await store.saveSettings(who, settings, 0);
  assert.equal(saved.revision, 1);
  const attempts = await Promise.allSettled([store.saveSettings(who, { ...settings, question: 'A' }, 1), store.saveSettings(who, { ...settings, question: 'B' }, 1)]);
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal((attempts.find(x => x.status === 'rejected') as PromiseRejectedResult).reason.code, 'automatic_settings_conflict');
  const disabled = await store.saveSettings(who, { enabled: false }, 2);
  assert.equal(disabled.reportPath, settings.reportPath);
  assert.equal(disabled.enabled, false);
});

test('settings reject material overlap, traversal, invalid count, unconfirmed case and credential fields', async () => {
  const { store, who } = await setup();
  for (const bad of [
    { ...settings, processFiles: ['020_clean/source.csv'] },
    { ...settings, reportPath: '060_reports/../private.md' },
    { ...settings, dataFiles: [] },
    { ...settings, maxAuthorTurns: 4 },
    { ...settings, caseId: randomUUID(), caseRevision: 1 },
    { ...settings, apiKey: 'should-never-persist' },
  ]) await assert.rejects(store.saveSettings(who, bad as typeof settings, 0), { code: 'invalid_automatic_settings' });
});

test('automatic settings accept existing preset configuration IDs and custom configuration UUIDs', async () => {
  for (const configurationId of ['mimo-v26-flash', randomUUID()]) {
    const { store, who } = await setup();
    const saved = await store.saveSettings(who, { ...settings, configurationId }, 0);
    assert.equal(saved.configurationId, configurationId);
    assert.deepEqual(await store.readSettings(who), saved);
  }
});

test('admission and chain snapshots preserve preset and custom configuration identities', async () => {
  const { store, who, dataRoot } = await setup(), s = await store.saveSettings(who, settings, 0);
  const input = chainInput(who, s);
  input.configuration = { id: 'mimo-v26-flash', revision: 2, provider: 'xiaomi-token-plan-cn', model: 'mimo-v2.6-flash' };
  const observed = await store.saveObservation({ ...who, requestId: input.requestId, requestFingerprint: input.requestFingerprint,
    settingsSnapshot: s, configuration: input.configuration, verificationConfiguration: input.verificationConfiguration, before: { exists: false } });
  assert.deepEqual(observed.configuration, input.configuration);
  assert.deepEqual(observed.verificationConfiguration, input.verificationConfiguration);
  input.verificationConfiguration = { ...input.configuration, revision: 3 };
  const { chain } = await store.createChain(input);
  const reopened = createAutomaticVerificationStore({ dataRoot });
  assert.deepEqual((await reopened.readChain(chain)).configuration, input.configuration);
  assert.deepEqual((await reopened.readChain(chain)).verificationConfiguration, input.verificationConfiguration);
});

test('configuration identity validation retains existing identifier bounds and rejects paths, reserved and unknown fields', async () => {
  const { store, who } = await setup(), s = await store.saveSettings(who, settings, 0), input = chainInput(who, s);
  for (const id of ['', '../mimo-v26-flash', '/mimo-v26-flash', 'mimo.v26', 'mimo v26', 'mimo\nv26', 'a'.repeat(101), '__proto__', 'prototype', 'constructor']) {
    await assert.rejects(store.saveSettings(who, { ...settings, configurationId: id }, s.revision), { code: 'invalid_automatic_settings' });
    for (const field of ['configuration', 'verificationConfiguration'] as const) {
      await assert.rejects(store.createChain({ ...input, [field]: { ...input[field], id } }), { code: 'invalid_automatic_configuration' });
    }
  }
  await assert.rejects(store.createChain({ ...input, configuration: { ...input.configuration, apiKey: 'never-persist' } } as CreateAutomaticChainInput), { code: 'invalid_automatic_configuration' });
  assert.deepEqual(await store.listChains(who), []);
  assert.equal((await store.readSettings(who)).revision, s.revision);
});

test('chain trigger is idempotent and settings snapshot survives later changes and a new store instance', async () => {
  const { store, who, dataRoot } = await setup(); const s = await store.saveSettings(who, settings, 0), input = chainInput(who, s);
  const first = await store.createChain(input), again = await store.createChain(input);
  assert.equal(first.created, true); assert.equal(again.created, false);
  assert.equal(first.chain.chainId, automaticTriggerFingerprint(input));
  await store.saveSettings(who, { ...settings, reportPath: '060_reports/new.md' }, 1);
  const fresh = createAutomaticVerificationStore({ dataRoot });
  const old = await fresh.readChain(first.chain);
  assert.equal(old.settingsSnapshot.reportPath, '060_reports/report.md');
  assert.equal(old.state, 'preparing');
  assert.equal((await fresh.listChains(who)).length, 1);
  await assert.rejects(store.createChain({ ...input, native: { ...input.native, sessionId: randomUUID() } }), { code: 'automatic_chain_conflict' });
});

test('observation keeps admission authority and cannot be completed twice with different facts', async () => {
  const { store, who } = await setup(), s = await store.saveSettings(who, settings, 0), input = chainInput(who, s);
  const admission = { ...who, requestId: input.requestId, requestFingerprint: input.requestFingerprint, settingsSnapshot: s, native: input.native, configuration: input.configuration, before: { exists: false as const } };
  const saved = await store.saveObservation(admission);
  await store.saveSettings(who, { ...settings, reportPath: '060_reports/later.md' }, 1);
  const done = await store.saveObservation({ ...admission, after: { exists: true as const, sha256: input.reportSha256, bytes: 5 }, observedAt: new Date().toISOString(), reason: 'none' });
  assert.equal(done.settingsSnapshot.revision, saved.settingsSnapshot.revision);
  assert.equal((await store.readObservation(who, input.requestId)).settingsSnapshot.reportPath, '060_reports/report.md');
  await assert.rejects(store.saveObservation({ ...admission, after: { exists: false }, observedAt: done.observedAt, reason: 'report_missing' }), { code: 'automatic_observation_conflict' });
});

test('project concurrency is recorded as a technical non-trigger reason without creating or replaying a chain', async () => {
  const { store, who, dataRoot } = await setup(), s = await store.saveSettings(who, settings, 0), input = chainInput(who, s);
  const admission = { ...who, requestId: input.requestId, requestFingerprint: input.requestFingerprint, settingsSnapshot: s, configuration: input.configuration, before: { exists: false as const } };
  await store.saveObservation(admission);
  const observed = await store.saveObservation({ ...admission, after: { exists: true, sha256: input.reportSha256, bytes: 5 }, observedAt: new Date().toISOString(), reason: 'external_change' });
  assert.equal(observed.reason, 'external_change');
  const fresh = createAutomaticVerificationStore({ dataRoot });
  assert.deepEqual(await fresh.readLatestObservation(who), observed);
  assert.deepEqual(await fresh.listChains(who), []);
  const { chain } = await store.createChain({ ...input, requestId: randomUUID() });
  await store.updateChain(chain, { state: 'paused', phase: 'ended', reason: 'external_change' });
  assert.equal((await fresh.readChain(chain)).reason, 'external_change');
  await assert.rejects(store.saveObservation({ ...admission, requestId: randomUUID(), reason: 'unregistered_reason' as typeof observed.reason }), { code: 'automatic_record_corrupt' });
});

test('known technical terminal states cannot revive or append new steps', async () => {
  const { store, who } = await setup(), s = await store.saveSettings(who, settings, 0);
  const { chain } = await store.createChain(chainInput(who, s));
  const stopped = await store.updateChain(chain, { state: 'cancelled', phase: 'ended', reason: 'user_stopped' }, chain.revision);
  await assert.rejects(store.updateChain(stopped, { state: 'running', phase: 'cold' }), { code: 'automatic_terminal' });
  await assert.rejects(store.updateChain(stopped, { steps: [step(who, 'cold', 1)] }), { code: 'automatic_terminal' });
  assert.equal((await store.readChain(stopped)).state, 'cancelled');
});

test('phase and accepted-count guards prevent false author handoff and exceeding configured cap', async () => {
  const { store, who } = await setup(), s = await store.saveSettings(who, { ...settings, maxAuthorTurns: 1 }, 0);
  const { chain } = await store.createChain(chainInput(who, s));
  await assert.rejects(store.updateChain(chain, { state: 'running', phase: 'author', steps: [step(who, 'author', 1)], authorAccepted: 1 }), { code: 'automatic_phase_conflict' });
  let c = await store.updateChain(chain, { state: 'running', phase: 'cold', steps: [step(who, 'cold', 1)] });
  c = await store.updateChain(c, { phase: 'compare', steps: [...c.steps, step(who, 'compare', 2)] });
  c = await store.updateChain(c, { phase: 'author', steps: [...c.steps, step(who, 'author', 3)], authorAccepted: 1 });
  assert.equal(c.authorAccepted, 1);
  await assert.rejects(store.updateChain(c, { authorAccepted: 0 }), { code: 'automatic_acceptance_count' });
  c = await store.updateChain(c, { phase: 'recheck', steps: [...c.steps, step(who, 'recheck', 4)] });
  await assert.rejects(store.updateChain(c, { phase: 'author', steps: [...c.steps, step(who, 'author', 5)], authorAccepted: 2 }), { code: 'automatic_followup_limit' });
});

test('immutable material and result files are not replaceable and integrity is verified on read', async () => {
  const { store, who } = await setup(), s = await store.saveSettings(who, settings, 0); const { chain } = await store.createChain(chainInput(who, s));
  const material = await store.fixMaterial(chain, { key: 'source-1', kind: 'data', relativePath: '020_clean/source.csv', bytes: Buffer.from('x\n1\n') });
  assert.equal((await store.readMaterial(chain, material)).toString(), 'x\n1\n');
  await assert.rejects(store.fixMaterial(chain, { key: 'source-1', kind: 'data', relativePath: '020_clean/source.csv', bytes: Buffer.from('changed') }), { code: 'automatic_snapshot_conflict' });
  const requestId = randomUUID(), result = await store.saveResult(chain, { requestId, text: 'This is an opinion, not truth.' });
  assert.equal(await store.readResult(chain, result), 'This is an opinion, not truth.');
  await assert.rejects(store.saveResult(chain, { requestId, text: 'replacement' }), { code: 'automatic_result_conflict' });
  await writeFile(store.materialPath(chain, material), 'corrupt');
  await assert.rejects(store.readMaterial(chain, material), { code: 'automatic_snapshot_changed' });
});

test('store rejects symlink and hardlink aliases rather than reaching outside its authority', async () => {
  const { store, who, dataRoot } = await setup(); const outside = path.join(dataRoot, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(dataRoot, 'automatic-verifications'));
  await assert.rejects(store.saveSettings(who, settings, 0), { code: 'automatic_unsafe_path' });
  const second = await setup(); await second.store.saveSettings(second.who, settings, 0);
  const file = path.join(second.dataRoot, 'automatic-verifications', second.who.projectId, second.who.taskId, 'settings.json');
  await link(file, path.join(second.dataRoot, 'settings-alias'));
  await assert.rejects(second.store.readSettings(second.who), { code: 'automatic_unsafe_file' });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).question, settings.question);
});

test('workspace allocation is exclusive and never follows externally planted directory aliases', async () => {
  const { store, who, dataRoot } = await setup(), s = await store.saveSettings(who, settings, 0); const { chain } = await store.createChain(chainInput(who, s));
  const work = await store.prepareWorkDirectory(chain, 'author-1');
  assert.equal((await lstat(work)).isDirectory(), true);
  await assert.rejects(store.prepareWorkDirectory(chain, 'author-1'), { code: 'automatic_workspace_exists' });
  const other = path.join(dataRoot, 'other'); await mkdir(other);
  await symlink(other, path.join(store.chainDirectory(chain), 'work', 'author-2'));
  await assert.rejects(store.prepareWorkDirectory(chain, 'author-2'), { code: 'automatic_unsafe_path' });
});

test('explicit deselection clears optional context, while disabled-only preserves selected materials', async () => {
  const { store, who } = await setup();
  const first = await store.saveSettings(who, { ...settings, caseId: randomUUID(), caseRevision: 1, caseBackgroundIsPrior: true }, 0);
  const cleared = await store.saveSettings(who, settings, first.revision);
  assert.equal(cleared.caseId, undefined);
  assert.equal(cleared.caseBackgroundIsPrior, undefined);
  const disabled = await store.saveSettings(who, { enabled: false }, cleared.revision);
  assert.deepEqual(disabled.dataFiles, settings.dataFiles);
});

test('new-task observation may start without native and preserves distinct completed native evidence', async () => {
  const { store, who } = await setup(), s = await store.saveSettings(who, settings, 0), input = chainInput(who, s);
  const admission = { ...who, requestId: input.requestId, requestFingerprint: input.requestFingerprint, settingsSnapshot: s, configuration: input.configuration, before: { exists: false as const } };
  const initial = await store.saveObservation(admission);
  assert.equal(initial.native, undefined);
  const completed = await store.saveObservation({ ...admission, after: { exists: true, sha256: input.reportSha256, bytes: 1 }, observedAt: new Date().toISOString(), completedNative: input.native });
  assert.deepEqual(completed.completedNative, input.native);
  assert.deepEqual(await store.saveObservation(admission), completed);
  assert.equal((await store.readLatestObservation(who))?.requestId, input.requestId);
});

test('late SDK facts enrich an existing stopped request without reviving or adding requests', async () => {
  const { store, who } = await setup(), s = await store.saveSettings(who, settings, 0), { chain } = await store.createChain(chainInput(who, s));
  let c = await store.updateChain(chain, { state: 'running', phase: 'cold', steps: [step(who, 'cold', 1)] });
  c = await store.updateChain(c, { phase: 'compare', steps: [...c.steps, step(who, 'compare', 2)] });
  const planned = { ...step(who, 'author', 3), status: 'planned' as const, acceptedAt: undefined, settledAt: undefined };
  c = await store.updateChain(c, { phase: 'author', steps: [...c.steps, planned] });
  c = await store.updateChain(c, { state: 'cancelled', phase: 'ended', reason: 'user_stopped' });
  const acceptedAt = new Date().toISOString();
  c = await store.recordStepFacts(c, planned.requestId, { status: 'accepted', acceptedAt });
  assert.equal(c.authorAccepted, 1); assert.equal(c.state, 'cancelled'); assert.equal(c.phase, 'ended');
  const result = await store.saveResult(c, { requestId: planned.requestId, text: 'actual late SDK result' });
  c = await store.recordStepFacts(c, planned.requestId, { status: 'completed', settledAt: new Date().toISOString(), result });
  assert.equal(c.state, 'cancelled'); assert.equal(c.steps.length, 3);
  assert.equal(c.steps.at(-1)?.status, 'completed');
  await assert.rejects(store.recordStepFacts(c, randomUUID(), { status: 'accepted', acceptedAt }), { code: 'invalid_automatic_step_facts' });
  await assert.rejects(store.updateChain(c, { state: 'running', phase: 'author' }), { code: 'automatic_terminal' });
});

test('idempotent immutable writes return stable identities and timestamps', async () => {
  const { store, who } = await setup(), s = await store.saveSettings(who, settings, 0), { chain } = await store.createChain(chainInput(who, s));
  const material = { key: 'source', kind: 'data' as const, relativePath: '020_clean/source.csv', bytes: Buffer.from('source') };
  assert.deepEqual(await store.fixMaterial(chain, material), await store.fixMaterial(chain, material));
  const result = { requestId: randomUUID(), text: 'same result' };
  assert.deepEqual(await store.saveResult(chain, result), await store.saveResult(chain, result));
});

test('mutable-by-others storage directories and records are rejected before reading or replacing authority', async () => {
  const { store, who, dataRoot } = await setup(); await store.saveSettings(who, settings, 0);
  const home = path.join(dataRoot, 'automatic-verifications', who.projectId, who.taskId);
  await chmod(home, 0o777);
  await assert.rejects(store.readSettings(who), { code: 'automatic_unsafe_path' });
  await chmod(home, 0o700);
  const file = path.join(home, 'settings.json'); await chmod(file, 0o666);
  await assert.rejects(store.readSettings(who), { code: 'automatic_unsafe_file' });
  await assert.rejects(store.saveSettings(who, settings, 1), { code: 'automatic_unsafe_file' });
});

test('chain listing ignores only an uncommitted record window and never hides a corrupt committed record', async () => {
  const { store, who } = await setup(), s = await store.saveSettings(who, settings, 0);
  const { chain } = await store.createChain(chainInput(who, s));
  const pending = { ...who, chainId: '0'.repeat(64) }, home = store.chainDirectory(pending);
  await mkdir(home, { mode: 0o700 });
  assert.deepEqual((await store.listChains(who)).map(c => c.chainId), [chain.chainId]);
  await assert.rejects(store.readChain(pending), { code: 'automatic_chain_not_found' });
  assert.equal((await lstat(home)).isDirectory(), true, 'read must not delete an uncommitted directory');
  await assert.rejects(lstat(path.join(home, 'record.json')), { code: 'ENOENT' });
  await writeFile(path.join(store.chainDirectory(chain), 'record.json'), '{invalid JSON');
  await assert.rejects(store.listChains(who), { code: 'automatic_record_corrupt' });
});

test('published-record readers wait for the complete link/unlink commit without accepting persistent hardlinks', async () => {
  const { store, who, dataRoot } = await setup(), s = await store.saveSettings(who, settings, 0), input = chainInput(who, s);
  const chainOwner = { ...who, chainId: automaticTriggerFingerprint(input) }, target = path.join(store.chainDirectory(chainOwner), 'record.json');
  const originalLink = fsPromises.link;
  let linked!: () => void, release!: () => void;
  const entered = new Promise<void>(r => { linked = r; }), gap = new Promise<void>(r => { release = r; });
  fsPromises.link = async (source, destination) => { await originalLink(source, destination); if (String(destination) === target) { linked(); await gap; } };
  syncBuiltinESMExports();
  const creating = store.createChain(input);
  await entered; assert.equal((await lstat(target)).nlink, 2, 'hold the real publication window open');
  let readFinished = false;
  const listed = store.listChains(who).then(value => { readFinished = true; return { value }; }, error => { readFinished = true; return { error }; });
  const detail = store.readChain(chainOwner).then(value => ({ value }), error => ({ error }));
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(readFinished, false, 'read must wait for the in-process commit, not observe nlink=2');
  } finally { release(); fsPromises.link = originalLink; syncBuiltinESMExports(); }
  const [created, list, one] = await Promise.all([creating, listed, detail]);
  assert.ok('value' in list); assert.ok('value' in one);
  assert.equal(list.value!.length, 1); assert.equal(one.value!.chainId, created.chain.chainId);
  await link(target, path.join(dataRoot, 'persistent-record-alias'));
  await assert.rejects(store.readChain(chainOwner), { code: 'automatic_unsafe_file' });
  await assert.rejects(store.listChains(who), { code: 'automatic_unsafe_file' });
});

test('a new publication cannot enter while an earlier listing holds its filesystem snapshot gate', async () => {
  const { store, who } = await setup(), s = await store.saveSettings(who, settings, 0);
  await store.createChain(chainInput(who, s));
  const second = chainInput(who, s), target = path.join(store.chainDirectory({ ...who, chainId: automaticTriggerFingerprint(second) }), 'record.json');
  const chains = path.join(store.taskDirectory(who), 'chains'), originalReadDir = fsPromises.readdir, originalLink = fsPromises.link;
  let listed!: () => void, release!: () => void, secondPublished = false;
  const entered = new Promise<void>(r => { listed = r; }), gap = new Promise<void>(r => { release = r; });
  fsPromises.readdir = (async (...args: Parameters<typeof fsPromises.readdir>) => {
    const entries = await originalReadDir(...args);
    if (String(args[0]) === chains) { listed(); await gap; }
    return entries;
  }) as typeof fsPromises.readdir;
  fsPromises.link = async (source, destination) => { await originalLink(source, destination); if (String(destination) === target) secondPublished = true; };
  syncBuiltinESMExports();
  const firstRead = store.listChains(who); await entered;
  const creating = store.createChain(second);
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(secondPublished, false, 'new publication must queue after the active complete read');
  } finally { release(); fsPromises.readdir = originalReadDir; fsPromises.link = originalLink; syncBuiltinESMExports(); }
  assert.equal((await firstRead).length, 1); await creating;
  assert.equal((await store.listChains(who)).length, 2);
});
