import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAutomaticActionSettingsStore } from '../src/host/automatic-action-settings-store.ts';

async function isolated(run: (dataRoot: string) => Promise<void>) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-automatic-actions-'));
  try { await run(dataRoot); } finally { await rm(dataRoot, { recursive: true, force: true }); }
}

test('new global automatic settings start with all five nodes off', () => isolated(async dataRoot => {
  assert.deepEqual(await createAutomaticActionSettingsStore({ dataRoot }).read(), {
    formatVersion: 1, revision: 0, nodes: { save: false, review: false, ir: false, case: false, assets: false },
  });
}));

test('one global value is saved and read after reopening the settings store', () => isolated(async dataRoot => {
  const store = createAutomaticActionSettingsStore({ dataRoot });
  const nodes = { save: true, review: false, ir: true, case: false, assets: false };
  const saved = await store.update({ operationId: 'e7277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 0, nodes });
  assert.equal(saved.replayed, false);
  assert.equal(saved.settings.revision, 1);
  assert.deepEqual((await createAutomaticActionSettingsStore({ dataRoot }).read()).nodes, nodes);
}));

test('an outdated page cannot overwrite a newer global choice', () => isolated(async dataRoot => {
  const store = createAutomaticActionSettingsStore({ dataRoot });
  const off = (await store.read()).nodes;
  await store.update({ operationId: 'a7277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 0, nodes: { ...off, ir: true } });
  await assert.rejects(store.update({ operationId: 'b7277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 0, nodes: { ...off, review: true } }), { code: 'automatic_action_settings_conflict' });
  assert.deepEqual((await store.read()).nodes, { save: false, review: false, ir: true, case: false, assets: false });
}));

test('repeating an accepted operation preserves the later choice and reports its original revision', () => isolated(async dataRoot => {
  const store = createAutomaticActionSettingsStore({ dataRoot });
  const off = (await store.read()).nodes;
  const first = { operationId: 'c7277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 0, nodes: { ...off, ir: true } };
  await store.update(first);
  await store.update({ operationId: 'd7277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 1, nodes: off });
  const replayed = await createAutomaticActionSettingsStore({ dataRoot }).update(first);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.operationRevision, 1);
  assert.equal(replayed.settings.revision, 2);
  assert.equal(replayed.settings.nodes.ir, false);
  await assert.rejects(store.update({ ...first, nodes: { ...off, review: true } }), { code: 'automatic_action_operation_conflict' });
}));

test('each pending action reads the current global choice across tasks instead of a startup snapshot', () => isolated(async dataRoot => {
  const taskA = createAutomaticActionSettingsStore({ dataRoot }), taskB = createAutomaticActionSettingsStore({ dataRoot });
  const facts = { authorized: true, applicable: true, cancelled: false };
  assert.deepEqual(await taskB.readCurrent('ir', facts), { allowed: false, reason: 'disabled', settingsRevision: 0 });
  const off = (await taskA.read()).nodes;
  await taskA.update({ operationId: 'e7277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 0, nodes: { ...off, ir: true } });
  assert.deepEqual(await taskB.readCurrent('ir', facts), { allowed: true, reason: 'enabled', settingsRevision: 1 });
  await taskA.update({ operationId: 'f7277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 1, nodes: off });
  assert.deepEqual(await taskB.readCurrent('ir', facts), { allowed: false, reason: 'disabled', settingsRevision: 2 });
}));

test('enabled preferences never override cancellation, authorization or applicability', () => isolated(async dataRoot => {
  const store = createAutomaticActionSettingsStore({ dataRoot });
  await store.update({ operationId: '17277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 0, nodes: { save: true, review: true, ir: true, case: true, assets: true } });
  assert.deepEqual(await store.readCurrent('review', { authorized: true, applicable: true, cancelled: true }), { allowed: false, reason: 'cancelled', settingsRevision: 1 });
  assert.deepEqual(await store.readCurrent('case', { authorized: false, applicable: true, cancelled: false }), { allowed: false, reason: 'not_authorized', settingsRevision: 1 });
  assert.deepEqual(await store.readCurrent('assets', { authorized: true, applicable: false, cancelled: false }), { allowed: false, reason: 'not_applicable', settingsRevision: 1 });
}));

test('two stale local controls cannot both commit a change to the global settings', () => isolated(async dataRoot => {
  const store = createAutomaticActionSettingsStore({ dataRoot }), off = (await store.read()).nodes;
  const results = await Promise.allSettled([
    store.update({ operationId: '27277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 0, nodes: { ...off, ir: true } }),
    store.update({ operationId: '37277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 0, nodes: { ...off, review: true } }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await store.read()).revision, 1);
}));

test('global settings reject project-scoped or malformed writes instead of creating a separate preference', () => isolated(async dataRoot => {
  const store = createAutomaticActionSettingsStore({ dataRoot }), off = (await store.read()).nodes;
  await assert.rejects(store.update({ operationId: '47277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 0, nodes: off, projectId: 'untrusted-project' } as never), { code: 'invalid_automatic_action_settings' });
  await assert.rejects(store.update({ operationId: 'not-an-id', expectedRevision: 0, nodes: off }), { code: 'invalid_automatic_action_settings' });
  await assert.rejects(store.update({ operationId: '57277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 0, nodes: { ...off, ir: 1 } } as never), { code: 'invalid_automatic_action_settings' });
  assert.equal((await store.read()).revision, 0);
}));


test('unknown or corrupt persisted settings are not silently reset or overwritten', () => isolated(async dataRoot => {
  const directory = path.join(dataRoot, 'global-settings'), file = path.join(directory, 'automatic-actions.json');
  await mkdir(directory, { mode: 0o700 });
  const unknown = JSON.stringify({ formatVersion: 2, revision: 40, nodes: { ir: true } });
  await writeFile(file, unknown, { mode: 0o600 });
  const store = createAutomaticActionSettingsStore({ dataRoot });
  await assert.rejects(store.read(), { code: 'automatic_action_settings_corrupt' });
  await assert.rejects(store.update({ operationId: '67277778-354a-49c2-9b0e-9f784b687210', expectedRevision: 0, nodes: { save: false, review: false, ir: false, case: false, assets: false } }), { code: 'automatic_action_settings_corrupt' });
  assert.equal(await readFile(file, 'utf8'), unknown);
  await writeFile(file, '{broken');
  await assert.rejects(store.readCurrent('ir', { authorized: true, applicable: true, cancelled: false }), { code: 'automatic_action_settings_corrupt' });
}));

test('a symlink cannot redirect the global settings file to another authority', () => isolated(async dataRoot => {
  const directory = path.join(dataRoot, 'global-settings'), outside = path.join(dataRoot, 'foreign.json');
  await mkdir(directory, { mode: 0o700 }); await writeFile(outside, 'retain this original', { mode: 0o600 });
  await symlink(outside, path.join(directory, 'automatic-actions.json'));
  const store = createAutomaticActionSettingsStore({ dataRoot });
  await assert.rejects(store.read(), { code: 'automatic_action_settings_unsafe_file' });
  assert.equal(await readFile(outside, 'utf8'), 'retain this original');
}));

test('an unknown settings acknowledgement can read its exact original operation without writing or reverting a later setting', () => isolated(async dataRoot => {
  const store = createAutomaticActionSettingsStore({ dataRoot });
  const input = { operationId: 'a7277778-354a-49c2-9b0e-9f784b687219', expectedRevision: 0, nodes: { save: true, review: false, ir: false, case: false, assets: false } };
  await store.update(input);
  await store.update({ operationId: 'b7277778-354a-49c2-9b0e-9f784b687219', expectedRevision: 1, nodes: { ...input.nodes, save: false } });
  const receipt = await store.readOperation(input.operationId);
  assert.equal(receipt?.revision, 1); assert.match(receipt!.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal((await store.read()).revision, 2); assert.equal((await store.read()).nodes.save, false);
  assert.equal(await store.readOperation('c7277778-354a-49c2-9b0e-9f784b687219'), null);
}));
