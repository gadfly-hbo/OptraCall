import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequirementSessions, type RequirementRunResult } from '../src/host/requirement-sessions.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';
import { requirementWorkspace } from '../extensions/business-plugins/requirements-elaboration/session/workspace.ts';
import { sampleInstance } from './fixtures/requirement-sample.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startFlexProvider, type FlexReply } from './fixtures/flex-provider.ts';

const validElicit = '```json\n' + JSON.stringify({ clarifications: [{ category: '指标口径', priority: 'should_confirm', question: '退款单是否排除？', rationale: '只澄清实际缺口' }], facts: [], hypotheses: [] }) + '\n```';
async function json(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }

test('RF04: malformed completed output is corrected once in the same native conversation', async t => {
  const provider = await startFlexProvider([{ text: 'FIRST_INVALID_OUTPUT_MARKER：不是JSON' }, { text: validElicit }]); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic bounded repair', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'flex-model-a', apiKey: 'synthetic-flex-only' }));
  const { instance } = await json(await host.request('/api/requirement-instances', 'POST', { title: '合成需求格式自修', scene: 'daily' }), 201);
  const before = await json(await host.request(`/api/requirement-instances/${instance.id}`));
  const generated = await json(await host.request(`/api/requirement-instances/${instance.id}/generate`, 'POST', { call: 'elicit' }));
  assert.equal(generated.repairAttempts, 1);
  assert.equal(generated.proposal.clarifications[0].question, '退款单是否排除？');
  assert.equal(provider.requests.length, 2, 'one correction only');
  assert.deepEqual(provider.requests.map(item => item.body.model), ['flex-model-a', 'flex-model-a']);
  const correction = JSON.stringify(provider.requests[1].body.messages);
  assert.match(correction, /FIRST_INVALID_OUTPUT_MARKER/);
  assert.match(correction, /REQ_MODEL_OUTPUT_INVALID/);
  assert.deepEqual((await json(await host.request(`/api/requirement-instances/${instance.id}`))).instance, before.instance, 'generation must not adopt or confirm its own output');
  const directory = path.join(host.dataRoot, 'requirement-instances', instance.id, 'sessions');
  const names = (await readdir(directory)).filter(name => name.endsWith('.jsonl'));
  assert.equal(names.length, 1, 'correction remains in the same native session');
  const native = await readFile(path.join(directory, names[0]), 'utf8');
  assert.match(native, /FIRST_INVALID_OUTPUT_MARKER/);
  assert.match(native, /退款单是否排除/);
});

test('RF01: an unconfirmed framework can be explored but cannot publish or silently adopt over changed input', async t => {
  const base = sampleInstance().framework!;
  const framework = { ...base, analysisPaths: base.analysisPaths.map(item => ({ ...item, hypothesis: '' })) };
  const provider = await startFlexProvider([{ text: '```json\n' + JSON.stringify(framework) + '\n```' }]); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic draft', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'draft-model', apiKey: 'synthetic-draft-only' }));
  const { instance } = await json(await host.request('/api/requirement-instances', 'POST', { title: '合成经营日报', scene: 'daily' }), 201);
  const route = `/api/requirement-instances/${instance.id}`;
  const before = await json(await host.request(route));
  const generated = await json(await host.request(route + '/generate', 'POST', { call: 'framework' }));
  assert.equal(generated.source.confirmation, 'unconfirmed');
  assert.match(generated.source.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(generated.repairAttempts, 0);
  assert.equal(generated.proposal.framework.analysisPaths[0].hypothesis, '');
  assert.deepEqual((await json(await host.request(route))).instance, before.instance);
  const blocked = await json(await host.request(route + '/publish', 'POST', { version: '1.0.0', releasedBy: 'synthetic-user' }), 409);
  assert.equal(blocked.code, 'REQ_SNAPSHOT_REQUIRED');
  const changed = { ...before.instance, context: { ...before.instance.context, goal: '新目标，旧提案不得覆盖' } };
  await json(await host.request(route, 'PATCH', { instance: changed }));
  const rejected = await json(await host.request(route, 'PATCH', { instance: { ...before.instance, framework: generated.proposal.framework }, proposalSourceFingerprint: generated.source.fingerprint }), 409);
  assert.equal(rejected.code, 'REQ_PROPOSAL_SOURCE_CHANGED');
  const after = await json(await host.request(route));
  assert.equal(after.instance.context.goal, changed.context.goal);
  assert.equal(after.instance.framework, undefined);
  assert.equal(provider.requests.length, 1);
});

test('RF01: adopting a proposal preserves a concurrent user confirmation and cannot invent one', async t => {
  const provider = await startFlexProvider([{ text: validElicit, hold: true }, { text: validElicit }]); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic confirmation race', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'confirm-race-model', apiKey: 'synthetic-confirm-race-only' }));
  const { instance } = await json(await host.request('/api/requirement-instances', 'POST', { title: '合成确认并发', scene: 'daily' }), 201);
  const route = `/api/requirement-instances/${instance.id}`;
  const before = await json(await host.request(route));
  const pending = host.request(route + '/generate', 'POST', { call: 'elicit' });
  await provider.waitForRequests(1);
  const confirmed = await json(await host.request(route + '/confirm', 'POST', { confirmedBy: 'synthetic-user' }));
  provider.release(0);
  const generated = await json(await pending);
  const adopted = await json(await host.request(route, 'PATCH', { instance: { ...before.instance, clarifications: generated.proposal.clarifications }, proposalSourceFingerprint: generated.source.fingerprint }));
  assert.deepEqual(adopted.instance.snapshot, confirmed.instance.snapshot, 'adoption must retain the user-created immutable confirmation reference');

  const next = await json(await host.request('/api/requirement-instances', 'POST', { title: '合成未确认实例', scene: 'daily' }), 201);
  const nextRoute = `/api/requirement-instances/${next.instance.id}`;
  const unconfirmed = await json(await host.request(nextRoute));
  const proposal = await json(await host.request(nextRoute + '/generate', 'POST', { call: 'elicit' }));
  const notConfirmed = await json(await host.request(nextRoute, 'PATCH', { instance: { ...unconfirmed.instance, clarifications: proposal.proposal.clarifications, snapshot: confirmed.instance.snapshot }, proposalSourceFingerprint: proposal.source.fingerprint }));
  assert.equal(notConfirmed.instance.snapshot, undefined, 'an adoption payload cannot turn an unconfirmed instance into a confirmed one');
});

test('RF04: two completed invalid replies stop with a specific reason and never dispatch a third turn', async t => {
  const provider = await startFlexProvider([{ text: 'bad first output' }, { text: '```json\n{}\n```' }]); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic repair exhausted', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'repair-exhausted', apiKey: 'synthetic-exhausted-only' }));
  const { instance } = await json(await host.request('/api/requirement-instances', 'POST', { title: '合成结构失败', scene: 'daily' }), 201);
  const result = await json(await host.request(`/api/requirement-instances/${instance.id}/generate`, 'POST', { call: 'elicit' }), 422);
  assert.equal(result.repairAttempts, 1);
  assert.equal(result.validation.code, 'REQ_MODEL_OUTPUT_INVALID');
  assert.equal(typeof result.validation.path, 'string');
  assert.match(result.message, /一次格式修复/);
  assert.equal(provider.requests.length, 2);
});

test('RF04: cancelled initial and correction turns never cause another dispatch', async t => {
  for (const initial of [true, false]) {
    const provider = await startFlexProvider(initial ? [{ text: validElicit, hold: true }] : [{ text: 'bad output' }, { text: validElicit, hold: true }]);
    const host = await startTestHost();
    try {
      await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic cancellation', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'cancel-model', apiKey: 'synthetic-cancel-only' }));
      const { instance } = await json(await host.request('/api/requirement-instances', 'POST', { title: '合成停止', scene: 'topic' }), 201);
      const pending = host.request(`/api/requirement-instances/${instance.id}/generate`, 'POST', { call: 'elicit' });
      await provider.waitForRequests(initial ? 1 : 2);
      await json(await host.request(`/api/requirement-instances/${instance.id}/stop`, 'POST', {}));
      const result = await json(await pending, 502);
      assert.equal(result.outcome, 'cancelled');
      assert.equal(result.repairAttempts, initial ? 0 : 1);
      assert.equal(provider.requests.length, initial ? 1 : 2);
      assert.equal(provider.requests.at(-1)!.closedEarly, true);
    } finally { await host.close(); await provider.close(); }
  }
});

test('RF04: a failed initial or correction request is never retried as a format issue', async t => {
  for (const initial of [true, false]) {
    const provider = await startFlexProvider(initial ? [{ text: '', status: 401 }] : [{ text: 'bad output' }, { text: '', status: 401 }]);
    const host = await startTestHost();
    try {
      await json(await host.request('/api/configuration', 'PUT', { name: 'Synthetic failed request', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'failed-model', apiKey: 'synthetic-failure-only' }));
      const { instance } = await json(await host.request('/api/requirement-instances', 'POST', { title: '合成失败不重放', scene: 'daily' }), 201);
      const result = await json(await host.request(`/api/requirement-instances/${instance.id}/generate`, 'POST', { call: 'elicit' }), 502);
      assert.equal(result.outcome, 'failed');
      assert.equal(result.repairAttempts, initial ? 0 : 1);
      assert.equal(provider.requests.length, initial ? 1 : 2);
    } finally { await host.close(); await provider.close(); }
  }
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

async function leaseFixture(t: import('node:test').TestContext, replies: readonly FlexReply[] = [{ text: validElicit }, { text: validElicit }]) {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-flex-lease-'));
  const provider = await startFlexProvider(replies);
  const first: Readonly<RuntimeModelConfiguration> = { id: 'profile-a', revision: 1, name: 'Synthetic lease A', provider: 'provider-a', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'lease-model-a', apiKey: 'synthetic-lease-only' };
  const second = { ...first, id: 'profile-b', provider: 'provider-b', model: 'lease-model-b' };
  let selected: Readonly<RuntimeModelConfiguration> = first;
  const configurations = new Map([[first.id, first], [second.id, second]]);
  let closing = false;
  let manager: ReturnType<typeof createRequirementSessions> | undefined;
  t.after(async () => { await manager?.closeAll(); await provider.close(); await rm(scratch, { recursive: true, force: true }); });
  manager = createRequirementSessions({
    codeRoot: process.cwd(), resourceRoot: path.join(scratch, 'resources'), managementPorts: () => [],
    sessionDirectory: id => path.join(scratch, id, 'sessions'), workspaceFor: id => requirementWorkspace(path.join(scratch, id)),
    configurationSnapshot: (id, revision) => { const value = id ? configurations.get(id) : selected; return value && (revision === undefined || value.revision === revision) ? value : undefined; },
    publish: () => {}, mutate: async operation => operation(), isClosing: () => closing,
  });
  return { manager, provider, selectOther: () => { selected = second; }, invalidate: () => configurations.delete(first.id), closeHost: () => { closing = true; } };
}

test('RF04 lease: another global selection does not move the admitted correction to another model', { timeout: 20_000 }, async t => {
  const f = await leaseFixture(t), gap = deferred(), resume = deferred();
  const pending = f.manager.withSession('req-lease-switch', async lease => {
    await lease.run('first generation', 'lease-first'); gap.resolve(); await resume.promise;
    return lease.run('single correction', 'lease-correction');
  });
  await gap.promise;
  assert.equal(f.manager.busy('req-lease-switch'), true);
  await assert.rejects(f.manager.run('req-lease-switch', 'must not overlap', 'overlap'), { code: 'session_busy' });
  f.selectOther(); resume.resolve();
  assert.equal((await pending).outcome, 'completed');
  assert.deepEqual(f.provider.requests.map(item => item.body.model), ['lease-model-a', 'lease-model-a']);
  assert.equal(f.manager.busy('req-lease-switch'), false);
});

test('RF04 lease: stop and invalid configuration in the between-turn gap prevent a correction', { timeout: 20_000 }, async t => {
  for (const action of ['stop', 'invalidate', 'shutdown'] as const) {
    const f = await leaseFixture(t), gap = deferred(), resume = deferred();
    const id = `req-lease-${action}`;
    const pending = f.manager.withSession(id, async lease => { await lease.run('first generation', 'first'); gap.resolve(); await resume.promise; return lease.run('must not dispatch', 'correction'); });
    void pending.catch(() => {});
    await gap.promise;
    if (action === 'stop') await f.manager.stop(id);
    else if (action === 'invalidate') f.invalidate();
    else { f.closeHost(); await f.manager.closeAll(); }
    resume.resolve();
    await assert.rejects(pending);
    assert.equal(f.provider.requests.length, 1, action);
    assert.equal(f.manager.busy(id), false);
  }
});

test('RF04 lease: closing provider A blocks replacement until its operation drains, then B can run', { timeout: 20_000 }, async t => {
  const f = await leaseFixture(t, [{ text: validElicit }, { text: validElicit, hold: true }]), gap = deferred(), resume = deferred();
  const id = 'req-lease-replacement';
  const previous = f.manager.withSession(id, async lease => { await lease.run('provider A first', 'first-a'); gap.resolve(); await resume.promise; return lease.run('provider A must not resume', 'correction-a'); });
  void previous.catch(() => {});
  await gap.promise;
  await f.manager.closeAll({ provider: 'provider-a' });
  f.selectOther();
  assert.equal(f.manager.busy(id), true, 'the cancelled callback still owns its admission until it drains');
  await assert.rejects(f.manager.run(id, 'must wait for safe drain', 'premature-b'), { code: 'session_busy' });
  resume.resolve();
  await assert.rejects(previous);
  const replacement = f.manager.run(id, 'provider B new explicit generation', 'generation-b');
  await f.provider.waitForRequests(2);
  assert.equal(f.manager.busy(id), true, 'the replacement operation keeps its own admission');
  f.provider.release(1);
  assert.equal((await replacement).outcome, 'completed');
  assert.deepEqual(f.provider.requests.map(item => item.body.model), ['lease-model-a', 'lease-model-b']);
  assert.equal(f.manager.live(id), true);
});

test('SM03 requirement lease: returning before its turn finishes cancels and drains the abandoned run', { timeout: 20_000 }, async t => {
  const f = await leaseFixture(t, [{ text: validElicit, hold: true }]);
  let abandoned: Promise<RequirementRunResult> | undefined;
  const pending = f.manager.withSession('req-abandoned-return', async lease => {
    abandoned = lease.run('a synthetic turn that must not escape its operation', 'abandoned-return');
    void abandoned.catch(() => {});
    await f.provider.waitForRequests(1);
    return 'callback returned before the SDK turn';
  });
  await assert.rejects(pending, 'an operation must not report normal success while abandoning a running turn');
  await abandoned?.catch(() => {});
  assert.equal(f.provider.requests.length, 1);
  assert.equal(f.provider.requests[0]!.closedEarly, true, 'the abandoned provider request must be stopped before releasing its operation');
  assert.equal(f.manager.busy('req-abandoned-return'), false);
});

test('SM03 requirement lease: a throwing callback drains its in-flight turn and preserves the callback error', { timeout: 20_000 }, async t => {
  const f = await leaseFixture(t, [{ text: validElicit, hold: true }]);
  const callbackError = new Error('synthetic callback failure');
  let abandoned: Promise<RequirementRunResult> | undefined;
  const pending = f.manager.withSession('req-abandoned-throw', async lease => {
    abandoned = lease.run('a synthetic turn must be stopped after callback failure', 'abandoned-throw');
    void abandoned.catch(() => {});
    await f.provider.waitForRequests(1);
    throw callbackError;
  });
  await assert.rejects(pending, error => error === callbackError);
  assert.equal(f.provider.requests[0]!.closedEarly, true, 'throwing business code must not leave its SDK turn running');
  await abandoned?.catch(() => {});
  assert.equal(f.provider.requests.length, 1);
  assert.equal(f.manager.busy('req-abandoned-throw'), false);
});
