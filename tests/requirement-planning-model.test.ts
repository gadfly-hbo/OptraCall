import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequirementSessions } from '../src/host/requirement-sessions.ts';
import { dbLinkModelOutlet } from '../src/host/db-link-host.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';
import { requirementWorkspace } from '../extensions/business-plugins/requirements-elaboration/session/workspace.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

test('PG05: preparation lease exposes the exact single captured model outlet, not a later global selection', { timeout: 25_000 }, async t => {
  const provider = await startToolProvider(), root = await mkdtemp(path.join(os.tmpdir(), 'optracall-planning-model-'));
  const models: RuntimeModelConfiguration[] = ['a', 'b'].map(id => ({ id: `model-${id}`, revision: 1, name: `Synthetic ${id}`, provider: 'synthetic', api: 'openai-completions', model: `synthetic-${id}`, apiKey: `synthetic-${id}-private`, baseUrl: provider.baseUrl }));
  let currentReads = 0;
  const manager = createRequirementSessions({ codeRoot: process.cwd(), resourceRoot: path.join(root, 'resources'), managementPorts: () => [], sessionDirectory: id => path.join(root, id, 'native'), workspaceFor: id => requirementWorkspace(path.join(root, id)), configurationSnapshot: (id, revision) => id ? models.find(model => model.id === id && model.revision === revision) : models[currentReads++ === 0 ? 0 : 1], publish: () => {}, mutate: async run => run(), isClosing: () => false });
  t.after(async () => { await manager.closeAll(); await provider.close(); await rm(root, { recursive: true, force: true }); });
  provider.setResponder(context => { assert.deepEqual(context.availableTools, []); return { text: '合成轻量准备完成' }; });
  const owner = 'req-plan-11111111-1111-4111-8111-111111111111';
  await manager.withSession(owner, async lease => {
    assert.deepEqual(lease.modelIdentity, { id: models[0]!.id, revision: 1, outlet: dbLinkModelOutlet(models[0]!) });
    assert.equal(currentReads, 1, 'reserve must use the very same captured snapshot');
    assert.ok(Object.isFrozen(lease.modelIdentity));
    assert.ok(!JSON.stringify(lease.modelIdentity).includes('private'));
    const identity = lease.modelIdentity;
    const result = await lease.run('仅核对合成来源目录，不读取业务数据', 'first-model');
    assert.equal(result.outcome, 'completed');
    assert.deepEqual(lease.modelIdentity, identity);
    assert.equal(provider.requests[0]!.body.model, models[0]!.model);
  });
  await manager.withSession(owner, async lease => {
    assert.equal(lease.modelIdentity.id, models[1]!.id);
    assert.equal(currentReads, 2, 'the next operation follows the next global selection');
    assert.equal((await lease.run('下一次轻量准备', 'second-model')).outcome, 'completed');
    assert.equal(provider.requests[1]!.body.model, models[1]!.model);
  });
  assert.deepEqual(provider.errors, []);
});
