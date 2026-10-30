import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequirementSessions } from '../src/host/requirement-sessions.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';
import { requirementWorkspace } from '../extensions/business-plugins/requirements-elaboration/session/workspace.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { controlledRequirementProcess } from './fixtures/requirement-lifecycle-process.ts';

async function json(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}

test('RR04: selecting another model on the same endpoint changes the next requirement request and preserves history', async t => {
  const provider = await startSyntheticProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());
  const configuration = (model: string) => ({ name: model, provider: 'openai-compatible', baseUrl: provider.baseUrl, model, apiKey: 'synthetic-lifecycle-only-key' });
  await json(await host.request('/api/configuration', 'PUT', configuration('requirement-model-a')));
  const created = await json(await host.request('/api/requirement-instances', 'POST', { title: '合成需求模型身份回归', scene: 'topic' }), 201);
  const id = created.instance.id as string;
  const sessions = path.join(host.dataRoot, 'requirement-instances', id, 'sessions');
  provider.setChunks(['```json\n' + JSON.stringify({ clarifications: [{ category: '指标口径', priority: 'should_confirm', question: '合成口径是否一致？', rationale: '生命周期回归' }], facts: ['FIRST_MODEL_HISTORY_MARKER'], hypotheses: [] }) + '\n```']);
  await json(await host.request(`/api/requirement-instances/${id}/generate`, 'POST', { call: 'elicit' }));
  const firstFile = (await readdir(sessions)).find(name => name.endsWith('.jsonl'));
  assert.ok(firstFile, 'the first requirement run must have a durable native session');
  const originalBytes = await readFile(path.join(sessions, firstFile));

  await json(await host.request('/api/configuration', 'PUT', configuration('requirement-model-b')));
  provider.setChunks(['```json\n' + JSON.stringify({ clarifications: [{ category: '指标口径', priority: 'should_confirm', question: '合成口径是否一致？', rationale: '生命周期回归' }], facts: ['SECOND_MODEL_HISTORY_MARKER'], hypotheses: [] }) + '\n```']);
  await json(await host.request(`/api/requirement-instances/${id}/generate`, 'POST', { call: 'elicit' }));

  const models = provider.requests.map(request => request.body.model);
  t.diagnostic(`Observed synthetic requirement model sequence: ${JSON.stringify(models)}`);
  assert.deepEqual(models, ['requirement-model-a', 'requirement-model-b']);
  assert.deepEqual((await readFile(path.join(sessions, firstFile))).subarray(0, originalBytes.length), originalBytes, 'changing model must retain previous native session bytes');
  assert.match(originalBytes.toString(), /FIRST_MODEL_HISTORY_MARKER/, 'the first model conversation remains available in its original native file');
});

test('RR05: provider close cancels an opening requirement and leaves another provider alive', async t => {
  const f = await controlledRequirementProcess(t);
  const first = f.manager.run('req-opening-a', 'first generation', 'opening-a');
  void first.catch(() => {});
  const childA = await f.spawned('req-opening-a');
  f.select('provider-b');
  const second = f.manager.run('req-opening-b', 'second generation', 'opening-b');
  void second.catch(() => {});
  const childB = await f.spawned('req-opening-b');
  await f.manager.closeAll({ provider: 'provider-a' });
  await f.release(childA);
  await f.release(childB);
  await assert.rejects(first, 'a closed opening must not become a live generation');
  assert.equal((await second).outcome, 'completed');
  assert.equal(await f.prompted(childA), false, 'the closed provider must not receive the pending prompt');
  assert.equal(f.manager.live('req-opening-a'), false);
  assert.equal(f.manager.live('req-opening-b'), true);
});

test('RR05: stop cancels an opening instance without stopping another live instance', async t => {
  const f = await controlledRequirementProcess(t);
  const other = f.manager.run('req-other', 'other instance', 'other-run');
  const otherChild = await f.spawned('req-other');
  await f.release(otherChild);
  await other;
  const pending = f.manager.run('req-stopping', 'must not start', 'pending-stop');
  void pending.catch(() => {});
  const child = await f.spawned('req-stopping');
  assert.equal(await f.manager.stop('req-stopping'), true);
  await assert.rejects(pending);
  assert.equal(await f.prompted(child), false);
  assert.equal(f.manager.live('req-other'), true);
  assert.equal((await f.manager.run('req-other', 'other instance continues', 'other-next')).outcome, 'completed');
});

test('RR05: closing before mutation admission cancels queued opening without a prompt', async t => {
  const f = await controlledRequirementProcess(t);
  const pending = f.manager.run('req-queued', 'must not start', 'queued-close');
  void pending.catch(() => {});
  await f.manager.closeAll();
  await assert.rejects(pending);
  assert.equal(f.manager.live('req-queued'), false);
  assert.equal(f.manager.busy('req-queued'), false);
});

test('RR05: finishing an older close cannot remove a replacement generation', async t => {
  const f = await controlledRequirementProcess(t);
  const completed = f.manager.run('req-replaced', 'old generation', 'old-run');
  const old = await f.spawned('req-replaced');
  await f.release(old);
  await completed;
  // The old resource is idle. An active operation retains its admission until
  // safe drain, covered separately by SM03 in the public Interface tests.
  await f.holdClose(old);
  const closing = f.manager.close('req-replaced');
  await f.waitClosing(old);
  const replacement = f.manager.run('req-replaced', 'replacement generation', 'replacement-run');
  const current = await f.spawned('req-replaced');
  await f.release(current);
  assert.equal((await replacement).outcome, 'completed');
  await f.releaseClose(old);
  await closing;
  assert.equal(f.manager.live('req-replaced'), true);
  assert.equal((await f.manager.run('req-replaced', 'replacement continues', 'replacement-next')).outcome, 'completed');
});

test('RR05: provider close of an older entry does not cancel a different-provider replacement opening', async t => {
  const f = await controlledRequirementProcess(t);
  const first = f.manager.run('req-provider-replaced', 'provider A', 'provider-a');
  const old = await f.spawned('req-provider-replaced');
  await f.release(old);
  await first;
  await f.holdClose(old);
  f.select('provider-b');
  const replacement = f.manager.run('req-provider-replaced', 'provider B', 'provider-b');
  void replacement.catch(() => {});
  await f.waitClosing(old);
  const closeA = f.manager.closeAll({ provider: 'provider-a' });
  await f.releaseClose(old);
  await closeA;
  const observed = await Promise.race([
    f.spawned('req-provider-replaced').then(child => ({ child })),
    replacement.then(() => ({ ended: true }), error => ({ error })),
  ]);
  assert.ok('child' in observed, 'closing provider A must not cancel the provider B opening on the same instance');
  await f.release(observed.child);
  assert.equal((await replacement).outcome, 'completed');
  assert.equal(f.manager.live('req-provider-replaced'), true);
});

test('SM11 requirement compatibility: rebuilding with the same configuration retains old files without implicitly resuming them', async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-requirement-rebuild-'));
  const provider = await startSyntheticProvider();
  const configuration: Readonly<RuntimeModelConfiguration> = { id: 'stable-requirement-profile', revision: 1, name: 'Synthetic restart', provider: 'openai-compatible', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'rebuild-model', apiKey: 'synthetic-rebuild-only' };
  const create = () => createRequirementSessions({
    codeRoot: process.cwd(), resourceRoot: path.join(scratch, 'resources'), managementPorts: () => [],
    sessionDirectory: id => path.join(scratch, id, 'sessions'), workspaceFor: id => requirementWorkspace(path.join(scratch, id)),
    configurationSnapshot: (id, revision) => (!id || id === configuration.id) && (revision === undefined || revision === configuration.revision) ? configuration : undefined,
    publish: () => {}, mutate: async operation => operation(), isClosing: () => false,
  });
  let manager: ReturnType<typeof createRequirementSessions> | undefined;
  t.after(async () => { await manager?.closeAll(); await provider.close(); await rm(scratch, { recursive: true, force: true }); });
  manager = create();
  const id = 'req-same-configuration-rebuild';
  provider.setChunks(['ORIGINAL_REQUIREMENT_NATIVE_CONTEXT_MARKER']);
  assert.equal((await manager.run(id, 'first explicit synthetic request', 'rebuild-first')).outcome, 'completed');
  await manager.closeAll();
  const directory = path.join(scratch, id, 'sessions');
  const originalFiles = (await readdir(directory)).filter(name => name.endsWith('.jsonl'));
  assert.equal(originalFiles.length, 1);
  const originalPath = path.join(directory, originalFiles[0]!);
  const originalBytes = await readFile(originalPath);
  assert.match(originalBytes.toString(), /ORIGINAL_REQUIREMENT_NATIVE_CONTEXT_MARKER/);

  manager = create();
  assert.equal(manager.live(id), false);
  assert.equal(manager.busy(id), false);
  provider.setChunks(['REBUILT_REQUIREMENT_NATIVE_CONTEXT_MARKER']);
  assert.equal((await manager.run(id, 'second explicit synthetic request', 'rebuild-second')).outcome, 'completed');
  assert.equal(provider.requests.length, 2, 'reconstruction must not replay the previous operation');
  const secondContext = JSON.stringify(provider.requests[1]!.body.messages);
  assert.doesNotMatch(secondContext, /ORIGINAL_REQUIREMENT_NATIVE_CONTEXT_MARKER/, 'no persisted native pointer is added to the requirement profile');
  assert.deepEqual(await readFile(originalPath), originalBytes, 'the historical file remains at its original path and retains every byte');
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.jsonl')).length, 2, 'the explicit operation after reconstruction creates its own native session');
});
