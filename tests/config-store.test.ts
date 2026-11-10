import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtemp, readFile, stat, writeFile, symlink, rename, mkdir, link } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { ConfigurationStore, ConfigurationStoreError, type ModelConfiguration } from '../src/host/config-store.ts';

// The prior release's persisted profiles are independent of the new seed list.
const legacyTrialProfiles: ModelConfiguration[] = [
  { id: 'minimax-m3', name: 'MiniMax M3', provider: 'minimax-cn', api: 'anthropic-messages', baseUrl: 'https://api.minimaxi.com/anthropic', model: 'MiniMax-M3', revision: 0 },
  { id: 'minimax-m31-flash', name: 'MiniMax M3.1 Flash', provider: 'minimax-cn', api: 'anthropic-messages', baseUrl: 'https://api.minimaxi.com/anthropic', model: 'MiniMax-M3.1-Flash', revision: 0 },
  { id: 'deepseek-flash', name: 'DeepSeek Flash', provider: 'deepseek', api: 'openai-completions', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', revision: 0 },
  { id: 'mimo-v26-pro', name: 'MiMo V2.6 Pro', provider: 'xiaomi-token-plan-cn', api: 'openai-completions', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'mimo-v2.6-pro', revision: 0 },
  { id: 'mimo-v26-flash', name: 'MiMo V2.6 Flash', provider: 'xiaomi-token-plan-cn', api: 'openai-completions', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'mimo-v2.6-flash', revision: 0 },
];
const activeTrialIds = ['deepseek-flash', 'glm-53-flash', 'minimax-m31-flash'];
const removedTrialIds = ['mimo-v26-flash', 'mimo-v26-pro', 'minimax-m3'];
const glmTrialPreset: ModelConfiguration = {
  id: 'glm-53-flash', name: 'GLM-5.3-Flash [zai] · 付费 API', provider: 'zai', api: 'openai-completions',
  baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-5.3-flash', revision: 0,
};

function legacyTrialSettings(selectedId: string | null = null) {
  return { schema: 1, selectedId, profiles: legacyTrialProfiles.map(profile => ({ ...profile })), versions: [] as ModelConfiguration[] };
}

async function writeLegacyTrialRoot(settings = legacyTrialSettings(), auth: Record<string, { type: 'api_key'; key: string }> = {}) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-legacy-trial-'));
  await writeFile(path.join(dataRoot, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await writeFile(path.join(dataRoot, 'auth.json'), `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  return dataRoot;
}

test('TR10-3: a fresh configuration offers only the three approved models and the native GLM route', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-trial-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = new ConfigurationStore({ dataRoot });
  await store.init();
  assert.deepEqual(store.list().map(profile => profile.id).sort(), activeTrialIds);
  assert.deepEqual(store.read('glm-53-flash'), { ...glmTrialPreset, hasApiKey: false });
  assert.equal(store.read(), null);
});

test('TR10-4: the old store can save the missing GLM preset only with its approved identity', async t => {
  const dataRoot = await writeLegacyTrialRoot(legacyTrialSettings('deepseek-flash'), {
    deepseek: { type: 'api_key', key: 'synthetic-existing-deepseek' },
  });
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = new ConfigurationStore({ dataRoot });
  await store.init();
  assert.equal(store.read('glm-53-flash'), null);
  const settingsBefore = await readFile(store.settingsPath), authBefore = await readFile(store.authPath);
  for (const override of [
    { baseUrl: 'https://unexpected.example.invalid/v1' },
    { model: 'glm-5.3' },
  ]) {
    await assert.rejects(store.save({ ...glmTrialPreset, ...override, apiKey: 'synthetic-rejected-glm' }), ConfigurationStoreError);
    assert.deepEqual(await readFile(store.settingsPath), settingsBefore);
    assert.deepEqual(await readFile(store.authPath), authBefore);
  }

  const saved = await store.save({ ...glmTrialPreset, apiKey: 'synthetic-new-glm' });
  assert.deepEqual(saved, { ...glmTrialPreset, revision: 1, hasApiKey: true });
  const reopened = new ConfigurationStore({ dataRoot });
  await reopened.init();
  assert.deepEqual(reopened.read('glm-53-flash'), saved);
  assert.equal(reopened.snapshot('glm-53-flash', 1)?.apiKey, 'synthetic-new-glm');
  assert.equal(reopened.snapshot()?.apiKey, 'synthetic-existing-deepseek');
});

test('TR10-4: saving the paid GLM route preserves an inactive Coding Plan revision and the default', async t => {
  const settings = legacyTrialSettings('deepseek-flash');
  const previous = { ...glmTrialPreset, name: 'GLM-5.3-Flash', provider: 'zai-coding-cn', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', revision: 1 };
  settings.profiles.push(previous);
  const dataRoot = await writeLegacyTrialRoot(settings, {
    deepseek: { type: 'api_key', key: 'synthetic-default' },
    'zai-coding-cn': { type: 'api_key', key: 'synthetic-previous-coding' },
  });
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = new ConfigurationStore({ dataRoot });
  await store.init();
  assert.equal(store.read('glm-53-flash')?.hasApiKey, false);
  assert.throws(() => store.snapshot('glm-53-flash', 1), { code: 'configuration_not_found' });
  await assert.rejects(store.save({ ...previous, apiKey: 'synthetic-coding-rejected' }), { code: 'invalid_configuration' });
  for (const baseUrl of [
    'https://api.z.ai/api/coding/paas/v4',
    'https://api.z.ai/api/%63oding/paas/v4',
    'https://api.z.ai/api/coding%2Fpaas/v4',
    'https://api.z.ai/api/%2563oding/paas/v4',
    'https://api.z.ai//api/coding/paas/v4',
  ]) {
    await assert.rejects(store.save({
      ...glmTrialPreset, id: undefined, provider: 'openai-compatible',
      baseUrl, apiKey: 'synthetic-coding-rejected',
    }), { code: 'invalid_configuration' });
  }
  await store.save({ ...glmTrialPreset, apiKey: 'synthetic-new-paid' });
  await store.reconcileTrialModelPresets();
  const reopened = new ConfigurationStore({ dataRoot });
  await reopened.init();
  assert.deepEqual(reopened.read('glm-53-flash'), { ...glmTrialPreset, revision: 2, hasApiKey: true });
  assert.throws(() => reopened.snapshot('glm-53-flash', 1), { code: 'configuration_not_found' });
  assert.deepEqual(JSON.parse(await readFile(reopened.settingsPath, 'utf8')).versions.find((value: ModelConfiguration) => value.id === previous.id), previous);
  assert.ok(!Object.hasOwn(JSON.parse(await readFile(reopened.authPath, 'utf8')), 'zai-coding-cn'));
  assert.equal(reopened.snapshot('glm-53-flash', 2)?.apiKey, 'synthetic-new-paid');
  assert.equal(reopened.read()?.id, 'deepseek-flash');
});

test('TR10-3: the old trial root loses only retired profiles, versions and unshared credentials', async t => {
  const settings = legacyTrialSettings('deepseek-flash');
  settings.profiles = settings.profiles.map(profile => ({ ...profile, revision: 2 }));
  settings.versions = settings.profiles.map(profile => ({ ...profile, revision: 1 }));
  const auth = {
    'minimax-cn': { type: 'api_key', key: 'synthetic-shared-minimax' },
    deepseek: { type: 'api_key', key: 'synthetic-deepseek' },
    'xiaomi-token-plan-cn': { type: 'api_key', key: 'synthetic-retired-mimo' },
  } as const;
  const dataRoot = await writeLegacyTrialRoot(settings, auth);
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = new ConfigurationStore({ dataRoot });
  await store.init();
  const retained = ['deepseek-flash', 'minimax-m31-flash'].map(id => ({ current: store.snapshot(id), previous: store.snapshot(id, 1) }));

  const result = await store.reconcileTrialModelPresets();
  assert.deepEqual([...result.removedIds].sort(), removedTrialIds);
  assert.deepEqual(result.removedProviders, ['xiaomi-token-plan-cn']);

  const reopened = new ConfigurationStore({ dataRoot });
  await reopened.init();
  assert.deepEqual(reopened.list().map(profile => profile.id).sort(), activeTrialIds);
  assert.equal(reopened.read()?.id, 'deepseek-flash');
  for (const { current, previous } of retained) {
    assert.ok(current && previous);
    assert.deepEqual(reopened.snapshot(current.id), current);
    assert.deepEqual(reopened.snapshot(previous.id, previous.revision), previous);
  }
  assert.equal(reopened.read('glm-53-flash')?.hasApiKey, false);
  for (const id of removedTrialIds) {
    assert.equal(reopened.read(id), null);
    assert.throws(() => reopened.snapshot(id, 1), { code: 'configuration_not_found' });
  }
  const authAfter = await readFile(reopened.authPath, 'utf8');
  assert.deepEqual(JSON.parse(authAfter), { 'minimax-cn': auth['minimax-cn'], deepseek: auth.deepseek });
  const settingsAfter = await readFile(reopened.settingsPath, 'utf8');
  assert.deepEqual(await reopened.reconcileTrialModelPresets(), { removedIds: [], removedProviders: [] });
  assert.equal(await readFile(reopened.settingsPath, 'utf8'), settingsAfter);
  assert.equal(await readFile(reopened.authPath, 'utf8'), authAfter);
});

test('TR10-3: removing the selected old model leaves the default awaiting selection', async t => {
  const dataRoot = await writeLegacyTrialRoot(legacyTrialSettings('minimax-m3'), {
    'minimax-cn': { type: 'api_key', key: 'synthetic-shared-minimax' },
  });
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = new ConfigurationStore({ dataRoot });
  await store.init();
  await store.reconcileTrialModelPresets();
  const reopened = new ConfigurationStore({ dataRoot });
  await reopened.init();
  assert.equal(reopened.read(), null);
  assert.equal(reopened.snapshot(), null);
  assert.equal(reopened.read('minimax-m31-flash')?.hasApiKey, true);
});

test('TR10-3: unexpected profiles and routes block cleanup with both original files intact', async t => {
  const invalidCases: [string, (settings: ReturnType<typeof legacyTrialSettings>) => void][] = [
    ['unknown profile', settings => {
      settings.profiles.push({ ...settings.profiles[0]!, id: 'unexpected-model' });
    }],
    ['changed route', settings => {
      settings.profiles.find(profile => profile.id === 'deepseek-flash')!.baseUrl = 'https://unexpected.example.invalid/v1';
    }],
    ['changed model at a retained id', settings => {
      settings.profiles.find(profile => profile.id === 'deepseek-flash')!.model = 'unexpected-model';
    }],
    ['changed historical route', settings => {
      const retired = settings.profiles.find(profile => profile.id === 'mimo-v26-flash')!;
      settings.versions.push({ ...retired, baseUrl: 'https://unexpected.example.invalid/v1' });
    }],
  ];
  for (const [label, makeInvalid] of invalidCases) {
    await t.test(label, async testCase => {
      const settings = legacyTrialSettings('deepseek-flash');
      makeInvalid(settings);
      const dataRoot = await writeLegacyTrialRoot(settings, { deepseek: { type: 'api_key', key: 'synthetic-preserve-on-rejection' } });
      testCase.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
      const store = new ConfigurationStore({ dataRoot });
      await store.init();
      const settingsBefore = await readFile(store.settingsPath), authBefore = await readFile(store.authPath);
      await assert.rejects(async () => store.reconcileTrialModelPresets(), ConfigurationStoreError);
      assert.deepEqual(await readFile(store.settingsPath), settingsBefore);
      assert.deepEqual(await readFile(store.authPath), authBefore);
      await assert.rejects(stat(path.join(dataRoot, '.configuration-transaction.json')), { code: 'ENOENT' });
    });
  }
});

async function crashConfigurationWriter(dataRoot: string, endpoint: string, mode = 'save-auth'): Promise<number | null> {
  const source = `
    import fsp from 'node:fs/promises';
    import path from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const { ConfigurationStore } = await import(${JSON.stringify(new URL('../src/host/config-store.ts', import.meta.url).href)});
    const [dataRoot, endpoint, mode] = process.argv.slice(1);
    const store = new ConfigurationStore({ dataRoot });
    const original = fsp.rename, originalUnlink = fsp.unlink;
    let armed = mode === 'recover-auth';
    fsp.rename = async (...args) => {
      const value = await original(...args);
      const target = path.join(dataRoot, mode === 'save-settings' ? 'settings.json' : 'auth.json');
      if (armed && mode !== 'commit-unlink' && args[1] === target) process.exit(77);
      return value;
    };
    fsp.unlink = async (...args) => {
      const value = await originalUnlink(...args);
      if (armed && mode === 'commit-unlink' && args[0] === path.join(dataRoot, '.configuration-transaction.json')) process.exit(77);
      return value;
    };
    syncBuiltinESMExports();
    await store.init();
    if (mode === 'recover-auth') throw new Error('Recovery did not reach its injected rename');
    armed = true;
    if (mode === 'clear-auth') await store.clear();
    else if (mode === 'reconcile-auth') await store.reconcileTrialModelPresets();
    else await store.save({ ...(store.read() ?? { name: 'Synthetic first save', provider: 'openai-compatible', api: 'openai-completions', model: 'synthetic-crash' }), baseUrl: endpoint, apiKey: 'synthetic-endpoint-B-private-key' });
    throw new Error('Crash hook was not reached');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, dataRoot, endpoint, mode], { env: { PATH: process.env.PATH ?? '', TMPDIR: os.tmpdir() }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const [code] = await once(child, 'exit');
  assert.equal(code, 77, `writer must exit at the injected rename: ${stderr}`);
  return code;
}

async function localEndpoint() {
  const authorizations: string[] = [];
  const server = createServer((request, response) => { authorizations.push(request.headers.authorization ?? ''); request.resume(); response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"ok":true}'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Local endpoint unavailable');
  return { baseUrl: `http://127.0.0.1:${address.port}`, authorizations, close: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }) };
}

test('CFG-04: save and restart preserve five legacy profiles with shared, masked credentials before explicit reconciliation', async () => {
  const dataRoot = await writeLegacyTrialRoot();
  const store = new ConfigurationStore({ dataRoot });
  await store.init();
  assert.equal(store.list().length, 5);
  const profile = store.list().find(entry => entry.model === 'MiniMax-M3')!;
  const key = '!literal-$synthetic-secret';
  const saved = await store.save({ ...profile, apiKey: key });
  assert.equal(saved.hasApiKey, true);
  assert.equal(store.list().filter(entry => entry.provider === 'minimax-cn' && entry.hasApiKey).length, 2);
  assert.equal(store.read('minimax-m31-flash')?.revision, 1, 'a shared-key sibling is immediately usable as a persisted project configuration');
  assert.ok(!JSON.stringify(store.list()).includes(key));
  assert.ok(!(await readFile(path.join(dataRoot, 'settings.json'), 'utf8')).includes(key));
  assert.deepEqual(JSON.parse(await readFile(path.join(dataRoot, 'auth.json'), 'utf8')), { 'minimax-cn': { type: 'api_key', key } });
  const reopened = new ConfigurationStore({ dataRoot });
  await reopened.init();
  assert.deepEqual(reopened.read(), saved);
  assert.equal(reopened.snapshot()?.apiKey, key);
  assert.equal((await stat(dataRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(dataRoot, 'auth.json'))).mode & 0o777, 0o600);
});

test('CFG-04: selected model is explicit and durable, including when its credential is unavailable', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-'));
  const store = new ConfigurationStore({ dataRoot }); await store.init();
  await store.save({ ...store.read('minimax-m31-flash'), apiKey: 'synthetic-minimax' });
  await store.save({ ...store.read('deepseek-flash'), apiKey: 'synthetic-deepseek' });
  await store.select('deepseek-flash');
  assert.equal(store.read()?.id, 'deepseek-flash');
  const reopened = new ConfigurationStore({ dataRoot }); await reopened.init();
  assert.equal(reopened.read()?.id, 'deepseek-flash');
  await reopened.clear('deepseek');
  assert.equal(reopened.read()?.id, 'deepseek-flash');
  assert.throws(() => reopened.snapshot(), error => error instanceof ConfigurationStoreError && error.code === 'configuration_required');
  await assert.rejects(reopened.select('not-a-profile'), error => error instanceof ConfigurationStoreError && error.code === 'configuration_not_found');
  assert.equal(reopened.read()?.id, 'deepseek-flash');
});

test('CFG-04: credential replacement preserves in-flight snapshots and provider clear keeps unrelated models and history', async () => {
  const dataRoot = await writeLegacyTrialRoot();
  const store = new ConfigurationStore({ dataRoot }); await store.init();
  const first = store.read('minimax-m3')!;
  const saved = await store.save({ ...first, apiKey: 'synthetic-old-key' });
  const active = store.snapshot('minimax-m3')!;
  await store.save({ ...saved, name: '新名称', apiKey: 'synthetic-new-key' });
  await store.save({ ...store.read('deepseek-flash'), apiKey: 'synthetic-other-provider' });
  assert.equal(active.apiKey, 'synthetic-old-key');
  assert.equal(active.name, first.name);
  assert.ok(Object.isFrozen(active));
  assert.equal(store.snapshot('minimax-m3')?.apiKey, 'synthetic-new-key');
  assert.equal(store.snapshot('minimax-m3', saved.revision)?.name, first.name);
  await store.clear('minimax-cn');
  assert.equal(store.read('minimax-m3')?.hasApiKey, false);
  assert.equal(store.read('minimax-m31-flash')?.hasApiKey, false);
  assert.equal(store.read('deepseek-flash')?.hasApiKey, true);
  assert.throws(() => store.snapshot('minimax-m3'), error => error instanceof ConfigurationStoreError && error.code === 'configuration_required');
  assert.throws(() => store.snapshot('minimax-m3', saved.revision), error => error instanceof ConfigurationStoreError && error.code === 'configuration_required');
  const reopened = new ConfigurationStore({ dataRoot }); await reopened.init();
  assert.equal(reopened.list().length, 5);
  assert.equal(reopened.read('minimax-m3')?.name, '新名称');
  assert.equal(reopened.read('minimax-m3')?.hasApiKey, false);
  assert.equal(reopened.snapshot('deepseek-flash')?.apiKey, 'synthetic-other-provider');
  assert.equal(reopened.read()?.id, 'minimax-m3');
});

test('CFG-04: automated credential import and UI input use the same native profile identity and save path', async () => {
  const dataRoot = await writeLegacyTrialRoot();
  const store = new ConfigurationStore({ dataRoot }); await store.init();
  const { id: _id, revision: _revision, hasApiKey: _mask, ...input } = store.read('mimo-v26-pro')!;
  const saved = await store.save({ ...input, apiKey: '!literal-imported-$synthetic', ignoredSecret: 'not-persisted' });
  assert.equal(saved.id, 'mimo-v26-pro');
  assert.equal(store.list().length, 5);
  assert.equal(store.read('mimo-v26-flash')?.hasApiKey, true);
  const replaced = await store.save({ ...saved, apiKey: 'synthetic-replacement' });
  assert.equal(replaced.id, saved.id);
  assert.equal(replaced.revision, saved.revision + 1);
  assert.ok(!(await readFile(store.settingsPath, 'utf8')).includes('not-persisted'));
  assert.equal(store.snapshot(saved.id)?.apiKey, 'synthetic-replacement');
});

test('CFG-04: old endpoint snapshots never receive a credential saved for a different endpoint', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-'));
  const store = new ConfigurationStore({ dataRoot }); await store.init();
  const original = await store.save({ name: '自定义', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:49001/v1', model: 'synthetic', apiKey: 'synthetic-endpoint-A' });
  await assert.rejects(store.save({ ...original, baseUrl: 'http://127.0.0.1:49002/v1', apiKey: '' }), ConfigurationStoreError);
  await store.save({ ...original, baseUrl: 'http://127.0.0.1:49002/v1', apiKey: 'synthetic-endpoint-B' });
  assert.equal(store.snapshot(original.id)?.apiKey, 'synthetic-endpoint-B');
  assert.throws(() => store.snapshot(original.id, original.revision), error => error instanceof ConfigurationStoreError && error.code === 'configuration_changed');
});

test('CFG-04: unsafe fields and endpoint changes fail without persisting submitted keys', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-'));
  const store = new ConfigurationStore({ dataRoot }); await store.init();
  const profile = store.read('minimax-m31-flash')!;
  const secret = 'synthetic-rejected-secret';
  for (const baseUrl of ['javascript:alert(1)', 'https://user:password@api.example.invalid', 'https://api.example.invalid?key=private', 'https://api.example.invalid/#secret', 'https://other.example.invalid/v1']) {
    await assert.rejects(store.save({ ...profile, baseUrl, apiKey: secret }), error => error instanceof ConfigurationStoreError && !JSON.stringify(error).includes(secret));
  }
  await assert.rejects(store.save({ name: '保留名', provider: '__proto__', api: 'openai-completions', baseUrl: 'https://api.example.invalid/v1', model: 'synthetic', apiKey: secret }), ConfigurationStoreError);
  assert.ok(!(await readFile(store.authPath, 'utf8')).includes(secret));
  assert.ok(!(await readFile(store.settingsPath, 'utf8')).includes(secret));
  assert.equal(store.read(), null);
});

test('CFG-04: corrupt and unknown-version settings are preserved and rejected, never reset', async () => {
  for (const invalid of ['{broken', JSON.stringify({ schema: 999, profiles: [], versions: [], selectedId: null })]) {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-'));
    const file = path.join(dataRoot, 'settings.json'); await writeFile(file, invalid);
    const store = new ConfigurationStore({ dataRoot });
    await assert.rejects(store.init(), ConfigurationStoreError);
    assert.equal(await readFile(file, 'utf8'), invalid);
    assert.throws(() => store.list(), error => error instanceof ConfigurationStoreError && error.code === 'configuration_not_initialized');
  }
});

test('CFG-04: credential file links and malformed credential records are rejected without altering their targets', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-'));
  const outside = path.join(dataRoot, 'outside.json'); const contents = JSON.stringify({ 'minimax-cn': { type: 'api_key', key: 'synthetic-linked-key' } });
  await writeFile(outside, contents); await symlink(outside, path.join(dataRoot, 'auth.json'));
  await assert.rejects(new ConfigurationStore({ dataRoot }).init(), ConfigurationStoreError);
  assert.equal(await readFile(outside, 'utf8'), contents);
  const otherRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-'));
  const auth = path.join(otherRoot, 'auth.json'); const malformed = JSON.stringify({ 'minimax-cn': { type: 'api_key', key: 'synthetic\ninvalid' } });
  await writeFile(auth, malformed);
  await assert.rejects(new ConfigurationStore({ dataRoot: otherRoot }).init(), ConfigurationStoreError);
  assert.equal(await readFile(auth, 'utf8'), malformed);
});

test('CFG-04: failed metadata save restores the prior credential instead of adopting a half-saved key', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-'));
  const store = new ConfigurationStore({ dataRoot }); await store.init();
  const profile = await store.save({ ...store.read('minimax-m31-flash'), apiKey: 'synthetic-established-key' });
  const before = await readFile(store.authPath, 'utf8');
  await rename(store.settingsPath, path.join(dataRoot, 'preserved-settings.json')); await mkdir(store.settingsPath);
  await assert.rejects(store.save({ ...profile, apiKey: 'synthetic-uncommitted-key' }), ConfigurationStoreError);
  assert.equal(await readFile(store.authPath, 'utf8'), before);
  assert.equal(store.snapshot(profile.id)?.apiKey, 'synthetic-established-key');
});

test('CFG-04: abrupt exit between credential and settings renames cannot send endpoint B credentials to endpoint A', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-crash-'));
  const endpointA = await localEndpoint(), endpointB = await localEndpoint();
  try {
    const store = new ConfigurationStore({ dataRoot }); await store.init();
    const profile = await store.save({ name: 'Synthetic endpoint A', provider: 'openai-compatible', api: 'openai-completions', baseUrl: endpointA.baseUrl, model: 'synthetic-crash', apiKey: 'synthetic-endpoint-A-private-key' });
    await crashConfigurationWriter(dataRoot, endpointB.baseUrl);
    const reopened = new ConfigurationStore({ dataRoot }); await reopened.init();
    const snapshot = reopened.snapshot(profile.id)!;
    await fetch(snapshot.baseUrl, { headers: { authorization: `Bearer ${snapshot.apiKey}` } });
    assert.deepEqual(endpointA.authorizations, ['Bearer synthetic-endpoint-A-private-key']);
    assert.deepEqual(endpointB.authorizations, []);
    assert.equal(snapshot.baseUrl, endpointA.baseUrl);
    assert.equal(snapshot.apiKey, 'synthetic-endpoint-A-private-key');
  } finally { await endpointA.close(); await endpointB.close(); }
});

test('CFG-04: interrupted rollback remains recoverable until both prior files are restored', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-recovery-'));
  const store = new ConfigurationStore({ dataRoot }); await store.init();
  const profile = await store.save({ name: 'Original', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:49001/v1', model: 'synthetic', apiKey: 'synthetic-original-key' });
  await crashConfigurationWriter(dataRoot, 'http://127.0.0.1:49002/v1');
  const journal = path.join(dataRoot, '.configuration-transaction.json');
  assert.equal((await stat(journal)).mode & 0o777, 0o600);
  await crashConfigurationWriter(dataRoot, 'http://127.0.0.1:49002/v1', 'recover-auth');
  await stat(journal);
  const reopened = new ConfigurationStore({ dataRoot }); await reopened.init();
  assert.equal(reopened.snapshot(profile.id)?.baseUrl, 'http://127.0.0.1:49001/v1');
  assert.equal(reopened.snapshot(profile.id)?.apiKey, 'synthetic-original-key');
  await assert.rejects(stat(journal), { code: 'ENOENT' });
});

test('CFG-04: uncommitted settings and interrupted first saves restore the prior coherent configuration', async () => {
  const existingRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-settings-crash-'));
  const existing = new ConfigurationStore({ dataRoot: existingRoot }); await existing.init();
  const profile = await existing.save({ name: 'Original', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:49001/v1', model: 'synthetic', apiKey: 'synthetic-original-key' });
  await crashConfigurationWriter(existingRoot, 'http://127.0.0.1:49002/v1', 'save-settings');
  const reopened = new ConfigurationStore({ dataRoot: existingRoot }); await reopened.init();
  assert.equal(reopened.snapshot(profile.id)?.baseUrl, 'http://127.0.0.1:49001/v1');
  assert.equal(reopened.snapshot(profile.id)?.apiKey, 'synthetic-original-key');
  const freshRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-first-crash-'));
  await crashConfigurationWriter(freshRoot, 'http://127.0.0.1:49002/v1');
  const fresh = new ConfigurationStore({ dataRoot: freshRoot }); await fresh.init();
  assert.equal(fresh.read(), null); assert.equal(fresh.snapshot(), null);
  assert.equal(fresh.list().length, 3); assert.ok(fresh.list().every(value => !value.hasApiKey));
  assert.deepEqual(JSON.parse(await readFile(fresh.authPath, 'utf8')), {});
});

test('CFG-04: interruption after the commit marker is removed exposes only the complete new pair', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-committed-'));
  const store = new ConfigurationStore({ dataRoot }); await store.init();
  const profile = await store.save({ name: 'Original', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:49001/v1', model: 'synthetic', apiKey: 'synthetic-original-key' });
  await crashConfigurationWriter(dataRoot, 'http://127.0.0.1:49002/v1', 'commit-unlink');
  const reopened = new ConfigurationStore({ dataRoot }); await reopened.init();
  assert.equal(reopened.snapshot(profile.id)?.baseUrl, 'http://127.0.0.1:49002/v1');
  assert.equal(reopened.snapshot(profile.id)?.apiKey, 'synthetic-endpoint-B-private-key');
  await assert.rejects(stat(path.join(dataRoot, '.configuration-transaction.json')), { code: 'ENOENT' });
});

test('CFG-04: an unacknowledged clear rolls back safely, and an acknowledged clear stays cleared after restart', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-clear-crash-'));
  const store = new ConfigurationStore({ dataRoot }); await store.init();
  const profile = await store.save({ ...store.read('minimax-m31-flash'), apiKey: 'synthetic-original-key' });
  await crashConfigurationWriter(dataRoot, '', 'clear-auth');
  const recovered = new ConfigurationStore({ dataRoot }); await recovered.init();
  assert.equal(recovered.snapshot(profile.id)?.apiKey, 'synthetic-original-key');
  await recovered.clear('minimax-cn');
  const restarted = new ConfigurationStore({ dataRoot }); await restarted.init();
  assert.equal(restarted.read(profile.id)?.hasApiKey, false);
  assert.throws(() => restarted.snapshot(profile.id), error => error instanceof ConfigurationStoreError && error.code === 'configuration_required');
  await assert.rejects(stat(path.join(dataRoot, '.configuration-transaction.json')), { code: 'ENOENT' });
});

test('TR10-3: restart rolls back trial cleanup interrupted between auth and settings writes', async t => {
  const dataRoot = await writeLegacyTrialRoot(legacyTrialSettings('mimo-v26-flash'), {
    'xiaomi-token-plan-cn': { type: 'api_key', key: 'synthetic-mimo-before-interruption' },
  });
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = new ConfigurationStore({ dataRoot });
  await store.init();
  const settingsBefore = await readFile(store.settingsPath), authBefore = await readFile(store.authPath);
  await crashConfigurationWriter(dataRoot, '', 'reconcile-auth');
  const journal = path.join(dataRoot, '.configuration-transaction.json');
  assert.equal((await stat(journal)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(store.authPath, 'utf8')), {});
  assert.deepEqual(await readFile(store.settingsPath), settingsBefore);

  const reopened = new ConfigurationStore({ dataRoot });
  await reopened.init();
  assert.deepEqual(await readFile(reopened.authPath), authBefore);
  assert.deepEqual(await readFile(reopened.settingsPath), settingsBefore);
  assert.equal(reopened.read()?.id, 'mimo-v26-flash');
  await assert.rejects(stat(journal), { code: 'ENOENT' });
});

test('CFG-04: ordinary settings rename failure restores both prior files and removes the completed rollback journal', async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-write-rollback-'));
  const store = new ConfigurationStore({ dataRoot }); await store.init();
  const profile = await store.save({ name: 'Original', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:49001/v1', model: 'synthetic', apiKey: 'synthetic-original-key' });
  const authBefore = await readFile(store.authPath, 'utf8'), settingsBefore = await readFile(store.settingsPath, 'utf8');
  const original = fs.rename; let failed = false;
  fs.rename = async (...args: Parameters<typeof fs.rename>) => { if (args[1] === store.settingsPath && !failed) { failed = true; throw Object.assign(new Error('synthetic storage failure'), { code: 'EIO' }); } return original(...args); };
  syncBuiltinESMExports();
  try { await assert.rejects(store.save({ ...profile, baseUrl: 'http://127.0.0.1:49002/v1', apiKey: 'synthetic-endpoint-B-private-key' }), ConfigurationStoreError); }
  finally { fs.rename = original; syncBuiltinESMExports(); }
  assert.equal(failed, true);
  assert.equal(await readFile(store.authPath, 'utf8'), authBefore);
  assert.equal(await readFile(store.settingsPath, 'utf8'), settingsBefore);
  assert.equal(store.snapshot(profile.id)?.apiKey, 'synthetic-original-key');
  await assert.rejects(stat(path.join(dataRoot, '.configuration-transaction.json')), { code: 'ENOENT' });
});

test('CFG-04: corrupt or unknown journals stop initialization without replacing configuration or clearing evidence', async () => {
  for (const invalid of ['{broken', JSON.stringify({ schema: 999 }), JSON.stringify({ schema: 1, before: { settings: {}, auth: {} } })]) {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-journal-corrupt-'));
    const store = new ConfigurationStore({ dataRoot }); await store.init();
    await store.save({ ...store.read('minimax-m31-flash'), apiKey: 'synthetic-original-key' });
    const auth = await readFile(store.authPath, 'utf8'), settings = await readFile(store.settingsPath, 'utf8');
    const journal = path.join(dataRoot, '.configuration-transaction.json'); await writeFile(journal, invalid, { mode: 0o600 });
    const reopened = new ConfigurationStore({ dataRoot }); await assert.rejects(reopened.init(), ConfigurationStoreError);
    assert.throws(() => reopened.list(), error => error instanceof ConfigurationStoreError && error.code === 'configuration_not_initialized');
    assert.equal(await readFile(journal, 'utf8'), invalid);
    assert.equal(await readFile(store.authPath, 'utf8'), auth); assert.equal(await readFile(store.settingsPath, 'utf8'), settings);
  }
});

test('CFG-04: journal symbolic and hard links are refused without following or removing the linked file', async () => {
  for (const makeLink of [symlink, link]) {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-config-journal-link-'));
    const store = new ConfigurationStore({ dataRoot }); await store.init();
    const outside = path.join(dataRoot, 'synthetic-linked-journal.json'); const content = JSON.stringify({ schema: 1, before: { settings: JSON.parse(await readFile(store.settingsPath, 'utf8')), auth: {} } });
    await writeFile(outside, content, { mode: 0o600 }); const journal = path.join(dataRoot, '.configuration-transaction.json'); await makeLink(outside, journal);
    await assert.rejects(new ConfigurationStore({ dataRoot }).init(), ConfigurationStoreError);
    assert.equal(await readFile(outside, 'utf8'), content); await stat(journal);
  }
});
