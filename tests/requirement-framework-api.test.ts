import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequirementRoutes } from '../extensions/business-plugins/requirements-elaboration/api/routes.ts';

test('RAF-A4: confirmation applies the exact persisted proposal once and preserves requirement confirmation', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'requirement-framework-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const modelReply = {
    metrics: [], dataNeeds: [], analysisPaths: [], reportFramework: [],
    openQuestions: ['缺少同口径退货记录'], risks: [],
    assessment: { value: '决定是否扩大试点', feasibility: '先做门店覆盖核对', scope: '已登记门店', gaps: ['补同口径记录'] },
  };
  let input: Record<string, unknown>;
  const model = async () => ({ outcome: 'completed' as const, text: JSON.stringify(modelReply) });
  const { routes, store } = createRequirementRoutes({
    storeRoot: root,
    readBody: async () => input,
    sessions: { run: model, withSession: async (_id, use) => use({ run: model }), stop: async () => true, busy: () => false },
  });
  const { instance: { id } } = store.create({ title: '核对试点', scene: 'topic' });
  const api = async (method: string, operation = '', body: Record<string, unknown> = {}) => {
    input = body;
    return (await routes({ method } as never, new URL('http://local/api/requirement-instances/' + id + operation)))! as { status: number; value: any };
  };
  const generated = await api('POST', '/generate', { call: 'framework', frameworkReview: true });
  assert.equal(generated.status, 200);
  const { frameworkProposal: proposal } = (await api('GET')).value;
  assert.ok(proposal?.version, 'generation must persist the displayed proposal version');
  assert.equal(proposal.assessment.scope, '已登记门店');
  assert.equal((await api('POST', '/confirm-framework', { version: '00000000-0000-4000-8000-000000000000', confirmedBy: '测试' })).status, 409);
  const accepted = await api('POST', '/confirm-framework', { version: proposal.version, confirmedBy: '测试' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.value.confirmedFramework.version, proposal.version);
  assert.equal(accepted.value.instance.snapshot, undefined);
  assert.deepEqual(accepted.value.releases, []);
  assert.equal((await api('POST', '/confirm-framework', { version: proposal.version, confirmedBy: '其他操作人' })).value.frameworkProposal.confirmedBy, '测试');

  const detail = await api('GET');
  const updated = { ...detail.value.instance, context: { ...detail.value.instance.context, goal: '已改变的目标' } };
  assert.equal((await api('PATCH', '', { instance: updated })).status, 200);
  assert.equal((await api('GET')).value.frameworkProposal.status, 'stale');
  assert.equal((await api('POST', '/confirm-framework', { version: proposal.version, confirmedBy: '测试' })).status, 409);
});

test('RAF-A4: a withdrawn exact source redacts a confirmed proposal without changing its history or allowing new delivery', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'requirement-framework-revoked-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const reference = {
    id: 'source-fixed', kind: 'enterprise' as const, title: 'PRIVATE_SOURCE_TITLE', version: 'v-fixed',
    target: { kind: 'enterprise' as const, storeId: 'store', materialId: 'material', revisionId: 'v-fixed' },
    digest: '0'.repeat(64), extent: 'full' as const,
  };
  const model = async () => ({ outcome: 'completed' as const, text: JSON.stringify({
    metrics: [], dataNeeds: [], analysisPaths: [], reportFramework: [], openQuestions: ['PRIVATE_SOURCE_EXCERPT'], risks: [],
    assessment: {
      value: '评估是否调整门店方案', feasibility: '资料暂有缺口', scope: '本轮明确的门店范围', gaps: [],
      evidence: [{ sourceId: reference.id, claim: 'PRIVATE_SOURCE_EXCERPT' }, { sourceId: 'fabricated', claim: 'FAKE_SOURCE' }],
    },
  }) });
  let withdrawn = false;
  const { routes, store, review } = createRequirementRoutes({
    storeRoot: root,
    readBody: async request => (request as unknown as { data: Record<string, unknown> }).data,
    revalidateFrameworkSources: async () => withdrawn ? [{ id: reference.id, status: 'unavailable' }] : [],
    sessions: {
      run: model, stop: async () => true, busy: () => false,
      withSession: async (_id, use) => use({
        run: model,
        withFramework: (operationId, _topic, _targets, _assertInput, run) => run({ run: model }, { operationId, status: 'not_searched', sources: [] }, () => [reference]),
      }),
    },
  });
  const instance = store.create({ title: '门店方案', scene: 'topic' });
  const { id } = instance.instance;
  const api = async (method: string, suffix = '', data: Record<string, unknown> = {}) =>
    (await routes({ method, data } as never, new URL('http://local/api/requirement-instances/' + id + suffix)))! as { status: number; value: any };

  const draft = await api('POST', '/generate', { call: 'framework', frameworkReview: true });
  const version = draft.value.frameworkProposal.version;
  assert.deepEqual(draft.value.frameworkProposal.assessment.evidence.map((claim: any) => claim.sourceId), [reference.id]);
  assert.equal((await api('POST', '/confirm-framework', { version, confirmedBy: '测试' })).status, 200);
  assert.equal((await review.confirmed(instance, version))?.version, version);
  const saved = (await api('GET')).value;
  assert.equal((await api('PATCH', '', { instance: saved.instance })).status, 200);
  withdrawn = true;
  const current = await api('GET'), history = await api('GET', '/framework-proposals/' + version);
  for (const result of [current, history]) {
    assert.equal(result.value.frameworkProposal.status, 'stale');
    assert.equal(result.value.frameworkProposal.version, version);
    assert.doesNotMatch(JSON.stringify(result.value), /PRIVATE_SOURCE_/);
  }
  assert.equal(history.value.frameworkProposal.confirmedBy, '测试');
  assert.equal((await api('POST', '/confirm-framework', { version, confirmedBy: '另一次' })).status, 409);
  await assert.rejects(review.confirmed(instance, version), { code: 'REQ_PROPOSAL_SOURCE_CHANGED' });
});

test('RAF-A4: changing an explicitly selected material during generation keeps the previous version and rejects late output', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'requirement-framework-race-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let releaseLate!: () => void, requestStarted!: () => void;
  const held = new Promise<void>(resolve => { releaseLate = resolve; });
  const started = new Promise<void>(resolve => { requestStarted = resolve; });
  let hold = false;
  const model = async () => {
    if (hold) { requestStarted(); await held; }
    return { outcome: 'completed' as const, text: JSON.stringify({
      metrics: [], dataNeeds: [], analysisPaths: [], reportFramework: [], openQuestions: ['证据待补'], risks: [],
      assessment: { value: '值得做', feasibility: '待补证', scope: '单店', gaps: [] },
    }) };
  };
  const { routes, store } = createRequirementRoutes({
    storeRoot: root,
    readBody: async request => (request as unknown as { data: Record<string, unknown> }).data,
    sessions: { run: model, withSession: async (_id, use) => use({ run: model }), stop: async () => true, busy: () => false },
  });
  const { instance: { id } } = store.create({ title: '并发切换', scene: 'topic' });
  const api = async (method: string, suffix = '', data: Record<string, unknown> = {}) =>
    (await routes({ method, data } as never, new URL('http://local/api/requirement-instances/' + id + suffix)))! as { status: number; value: any };
  const generate = () => api('POST', '/generate', { call: 'framework', frameworkReview: true });
  const first = await generate(), firstVersion = first.value.frameworkProposal.version;
  hold = true;
  const late = generate();
  await started;
  const material = { kind: 'data-input', projectId: 'project', datasetId: 'input', inputVersionId: 'fixed' };
  assert.equal((await api('PUT', '/framework-input', { materialTargets: [material] })).status, 200);
  releaseLate();
  assert.equal((await late).status, 409);
  const { frameworkProposal: retained } = (await api('GET')).value;
  assert.equal(retained.version, firstVersion);
  assert.equal(retained.status, 'stale');
  assert.equal((await api('POST', '/confirm-framework', { version: firstVersion, confirmedBy: '测试' })).status, 409);
});
