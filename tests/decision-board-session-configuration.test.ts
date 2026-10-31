import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ConfigurationStore } from '../src/host/config-store.ts';
import { createDecisionBoardSessions } from '../src/host/decision-board-sessions.ts';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';

for (const change of ['selection', 'revision'] as const) test(`DB03/IN07: extraction pins its recorded configuration across ${change} changes before dispatch`, { timeout: 30000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  provider.setChunks(['```json\n[]\n```']);
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-board-configuration-'));
  const configuration = new ConfigurationStore({ dataRoot: path.join(root, 'host') }); await configuration.init();
  const save = (name: string, id?: string) => configuration.save({ ...(id ? { id } : {}), name, provider: 'openai-compatible',
    baseUrl: provider.baseUrl, model: `synthetic-${name}`, apiKey: `synthetic-key-${name}` });
  const a = await save('A'), b = await save('B'); await configuration.select(a.id);
  const store = createDecisionBoardStore({ root: path.join(root, 'board') }); await store.init();
  const reportPath = path.join(root, 'report.md'); await writeFile(reportPath, '# 合成报告\n建议：继续观察，效果未知。');
  let release!: () => void, enter!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { enter = resolve; });
  const sessions = createDecisionBoardSessions({ store, extractionRoot: path.join(root, 'extractions'), codeRoot: process.cwd(), resourceRoot: path.join(root, 'pi'), managementPorts: () => [],
    configurationSnapshot: (id?: string, revision?: number) => configuration.snapshot(id, revision),
    projectAccess: async () => ({ name: '合成项目' }), projectName: async () => '合成项目',
    observeFile: async () => { const bytes = await readFile(reportPath); return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, observedAt: new Date().toISOString() }; },
    readFile: async () => { enter(); await held; return { name: 'report.md', bytes: await readFile(reportPath) }; },
    mutate: async operation => operation(), isClosing: () => false,
  });
  t.after(async () => { release(); await sessions.closeAll(); store.close(); });
  const starting = sessions.start(randomUUID(), '060_reports/report.md');
  await entered;
  if (change === 'selection') await configuration.select(b.id);
  else await save('A-updated', a.id);
  release();
  const started = await starting;
  const deadline = Date.now() + 15000;
  let result = store.readExtraction(started.id)!;
  while (result.status === 'running' && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 20)); result = store.readExtraction(started.id)!; }
  assert.equal(result.configuration.id, a.id); assert.equal(result.configuration.revision, a.revision);
  if (change === 'selection') {
    assert.equal(result.status, 'completed');
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0].body.model, a.model, 'Recorded model and actual native request must be identical');
  } else {
    assert.equal(result.status, 'failed', 'A changed captured revision is rejected instead of silently adopting the newer credentials/model');
    assert.equal(provider.requests.length, 0);
  }
});

test('DB03/IN07: a provider credential change cannot enter an extraction whose profile revision is unchanged', { timeout: 30000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  provider.setChunks(['```json\n[]\n```']);
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-board-credential-'));
  const store = createDecisionBoardStore({ root: path.join(root, 'board') }); await store.init();
  let key = 'synthetic-original-provider-key', enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const base = { id: randomUUID(), revision: 1, name: 'Synthetic shared provider', provider: 'synthetic-shared', api: 'openai-completions' as const, baseUrl: provider.baseUrl, model: 'synthetic-model' };
  const bytes = Buffer.from('建议：保留原文，不操作真实业务。');
  const sessions = createDecisionBoardSessions({ store, extractionRoot: path.join(root, 'extractions'), codeRoot: process.cwd(), resourceRoot: path.join(root, 'pi'), managementPorts: () => [],
    configurationSnapshot: () => ({ ...base, apiKey: key }),
    projectAccess: async () => ({ name: 'Synthetic' }), projectName: async () => 'Synthetic',
    observeFile: async () => ({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, observedAt: new Date().toISOString() }),
    readFile: async () => { enter(); await held; return { name: 'report.md', bytes }; }, mutate: async operation => operation(), isClosing: () => false,
  });
  t.after(async () => { release(); await sessions.closeAll(); store.close(); });
  const starting = sessions.start(randomUUID(), '060_reports/report.md');
  await entered; key = 'synthetic-changed-shared-provider-key'; release();
  const record = await starting;
  const deadline = Date.now() + 15000;
  while (store.readExtraction(record.id)!.status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(store.readExtraction(record.id)!.status, 'failed');
  assert.equal(store.readExtraction(record.id)!.configuration.revision, 1);
  assert.equal(provider.requests.length, 0);
});

test('DB03/IN07: immediate stop before resource reservation prevents a late provider dispatch', { timeout: 30000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  provider.setChunks(['```json\n[]\n```']);
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-board-immediate-stop-'));
  const configuration = new ConfigurationStore({ dataRoot: path.join(root, 'host') }); await configuration.init();
  await configuration.save({ name: 'Synthetic stop', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-stop-key' });
  const store = createDecisionBoardStore({ root: path.join(root, 'board') }); await store.init();
  const bytes = Buffer.from('建议：只保留合成报告。');
  const sessions = createDecisionBoardSessions({ store, extractionRoot: path.join(root, 'extractions'), codeRoot: process.cwd(), resourceRoot: path.join(root, 'pi'), managementPorts: () => [],
    configurationSnapshot: (id, revision) => configuration.snapshot(id, revision),
    projectAccess: async () => ({ name: 'Synthetic' }), projectName: async () => 'Synthetic',
    observeFile: async () => ({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, observedAt: new Date().toISOString() }),
    readFile: async () => ({ name: 'report.md', bytes }), mutate: async operation => operation(), isClosing: () => false,
  });
  t.after(async () => { await sessions.closeAll(); store.close(); });
  const record = await sessions.start(randomUUID(), '060_reports/report.md');
  assert.equal((await sessions.stop(record.id)).status, 'cancelled');
  // Keep the store and domain open while the deferred directory/open path gets
  // an opportunity to run; closing either immediately would mask a late send.
  await new Promise(resolve => setTimeout(resolve, 1800));
  await sessions.closeAll();
  assert.equal(store.readExtraction(record.id)!.status, 'cancelled');
  assert.equal(provider.requests.length, 0);
});
