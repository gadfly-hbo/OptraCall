import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import type { DecompositionDraftInput } from '../src/host/strategy-goal-decomposition-types.ts';
import { resolveUpstreamCarryover, savedUpstreamMergeDraft } from '../src/host/ui/goal-upstream-carryover.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { makeNormalDraftPayload } from './fixtures/goal-decomposition-draft.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';

const evidence = process.env.ISSUE148_RECOVERY_EVIDENCE_ROOT ?? tmpdir();
async function json(response: Response, status = 200): Promise<any> {
  const body = await response.text();
  assert.equal(response.status, status, body);
  return JSON.parse(body);
}
async function setup(t: test.TestContext) {
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'issue148-host-native-'));
  const host = await startTestHost({ cwd: process.cwd(), dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  const provider = await startToolProvider();
  t.after(async () => { await provider.close(); await host.close(); });
  await json(await host.request('/api/configuration', 'PUT', {
    name: '承接恢复合成', provider: 'openai-compatible', baseUrl: provider.baseUrl,
    model: 'synthetic-carryover', apiKey: 'synthetic-carryover-only',
  }));
  const goalInput = {
    title: '恢复路径净销售额', outcome: '净销售额达到120万元', perspective: 'profit',
    scope: { kind: 'department', id: 'retail-dept', name: '零售事业部' },
    measurement: { kind: 'deliverable', criterion: '净销售额' }, baseline: { state: 'known', description: '108万元' },
    responsible: '林负责人', strategies: ['新品陈列与会员回访'], dueAt: '2027-01-31',
    formalOrigin: { kind: 'manual-exception', reason: '隔离合成', period: '2027-01', targetValue: 120, unit: '万元', metricKind: 'amount' },
  };
  const { goal } = await json(await host.request('/api/strategy/goals', 'POST', { ...goalInput, operationId: randomUUID() }), 201);
  const route = `/api/strategy/goals/${goal.goalId}`;
  const { gsaPlan: oldPlan } = await json(await host.request(`${route}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(), expectedGoalVersion: 1, expectedAdoptedVersion: null, expectedPlanVersion: 0,
    plannedActions: [{ id: 'A1', summary: '旧版计划', checkpoint: '2027-01-31', observationBasis: 'POS' }], decision: '确认旧版',
  }), 201);
  const originalInput = makeNormalDraftPayload(oldPlan, { notes: '原版负责人备注，不得丢弃' });
  const { draft: original } = await json(await host.request(`${route}/decomposition/draft`, 'POST', originalInput), 201);
  const { gsaPlan: plan } = await json(await host.request(`${route}/gsa-plan/confirm`, 'POST', {
    operationId: randomUUID(), expectedGoalVersion: 1, expectedAdoptedVersion: 1, expectedPlanVersion: 1,
    goalRevision: { ...goalInput, outcome: '净销售额达到150万元', strategies: ['新品陈列与团购'], formalOrigin: { ...goalInput.formalOrigin, targetValue: 150 } },
    plannedActions: [{ id: 'A1', summary: '新版计划', checkpoint: '2027-01-31', observationBasis: 'POS' }], decision: '确认新版', supersedesReason: '调整目标与策略',
  }), 201);
  const ownerUrl = '/api/business-role?owner=' + encodeURIComponent(JSON.stringify({ role: 'goal', goalId: goal.goalId, version: 2, analysisVariant: 'goal-decomposition' }));
  async function turn(text: string) {
    const before = await json(await host.request(ownerUrl));
    const requestId = randomUUID();
    await json(await host.request(ownerUrl + '&action=messages', 'POST', { requestId, text, expectedRevision: before.discussion?.revision ?? 0 }), 202);
    for (let i = 0; i < 600; i++) {
      const detail = await json(await host.request(ownerUrl + '&requestId=' + requestId));
      if (!detail.busy && detail.discussion?.lastRun?.id === requestId && detail.discussion.lastRun.status !== 'accepted') {
        assert.equal(detail.discussion.lastRun.status, 'completed');
        return { detail, requestId };
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail('native turn did not settle');
  }
  const workspace = () => host.request(`${route}/workspace`).then(response => json(response));
  t.diagnostic(root);
  return { host, provider, route, plan, original, turn, workspace, root };
}

function nativeMerge(provider: Awaited<ReturnType<typeof startToolProvider>>, note: string) {
  provider.setResponder(context => {
    if (!context.recentToolResults.length) return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-read-context' } }] };
    if (context.recentToolResults.length === 1) {
      const source = JSON.parse(providerMessageText(context.recentToolResults[0].content));
      const draft = source.draft ?? source.draftInputTemplate;
      const input = Object.fromEntries(['gsaPlanId', 'gsaPlanVersion', 'gsaPlanSha256', 'estimate', 'rows', 'reserves', 'gapStrategies', 'views', 'timePlan'].map(key => [key, draft[key]]));
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'goal-save-decomposition-draft', ...input, expectedDraftRevision: source.expectedDraftRevision, notes: `${draft.notes ?? ''}\n${note}` } }] };
    }
    return { text: '以原工具实际保存回执为准，不发布。' };
  });
}

test('A1/R2: original Host user carryover unlocks native Pi merge without relaxing upstream review or losing the old draft', { timeout: 90_000 }, async t => {
  const { host, provider, route, plan, original, turn, workspace, root } = await setup(t);
  nativeMerge(provider, '人工未保存备注');
  const blocked = await turn('尝试直接合并，Host 必须继续阻止 Agent 代为承接。');
  assert.equal((await workspace()).draft, null, 'Agent cannot bypass human review');
  assert.match(JSON.stringify(blocked.detail.snapshot.messages), /gsa_upstream_review_required/);
  assert.equal(savedUpstreamMergeDraft(blocked.detail, blocked.requestId, { gsaPlanId: plan.planId, gsaPlanVersion: 2, gsaPlanSha256: plan.contentSha256, revision: 1 }), null);

  const before = await workspace();
  const dirty = resolveUpstreamCarryover({ currentGoalVersion: 2, currentActivePlan: plan, latestWorkspace: before, hadLocalEdits: true, startEditSerial: 1, currentEditSerial: 1 });
  assert.equal(dirty.kind, 'conflict');
  const review = resolveUpstreamCarryover({ currentGoalVersion: 2, currentActivePlan: plan, latestWorkspace: before, hadLocalEdits: false, startEditSerial: 1, currentEditSerial: 1 });
  assert.equal(review.kind, 'carryover');
  if (review.kind !== 'carryover') return;
  const { draft: carried } = await json(await host.request(`${route}/decomposition/draft`, 'POST', review.draftForm), 201);
  assert.equal(carried.updatedBy, 'user');
  assert.deepEqual(carried.rows, original.rows);
  assert.deepEqual(carried.reserves, original.reserves);
  assert.equal(carried.notes, original.notes);
  const completed = await turn('负责人已经核对承接，请把人工未保存备注合并到最新草稿。');
  const after = await workspace();
  assert.equal(after.draft.updatedBy, 'agent');
  assert.equal(after.draft.revision, 3);
  assert.equal(after.draft.gsaPlanSha256, plan.contentSha256);
  assert.deepEqual(after.draft.rows, original.rows);
  assert.match(after.draft.notes, /原版负责人备注，不得丢弃\n人工未保存备注/);
  assert.equal(after.publications.length, 0);
  await writeFile(path.join(root, 'native-recovery-before-adoption.json'), JSON.stringify({ completed: completed.detail, carried, after }, null, 2));
  assert.deepEqual(savedUpstreamMergeDraft(completed.detail, completed.requestId, carried), { revision: 3, contentSha256: after.draft.contentSha256 });
  const historical = await json(await host.request(`${route}/workspace?goalVersion=1`));
  assert.equal(historical.goal.versions.find((version: any) => version.version === 1).outcome, '净销售额达到120万元', 'the prior exact goal version remains unchanged');
  assert.deepEqual(after.draft.gapStrategies, original.gapStrategies);
  assert.deepEqual(after.draft.timePlan, original.timePlan);
  assert.deepEqual(after.draft.views, original.views);
  await writeFile(path.join(root, 'native-recovery.json'), JSON.stringify({ blocked: blocked.detail, carried, completed: completed.detail, after, historical }, null, 2));
});

test('A1/R2: another client current draft remains the merge baseline, normal CAS and exact native receipt checks still hold', { timeout: 90_000 }, async t => {
  const { host, provider, route, plan, original, turn, workspace } = await setup(t);
  const review = resolveUpstreamCarryover({ currentGoalVersion: 2, currentActivePlan: plan, latestWorkspace: await workspace(), hadLocalEdits: false, startEditSerial: 0, currentEditSerial: 0 });
  assert.equal(review.kind, 'carryover');
  if (review.kind !== 'carryover') return;
  const { draft: current } = await json(await host.request(`${route}/decomposition/draft`, 'POST', { ...review.draftForm, notes: '另一端服务器备注' }), 201);
  const latest = await workspace();
  const result = resolveUpstreamCarryover({ currentGoalVersion: 2, currentActivePlan: plan, latestWorkspace: latest, hadLocalEdits: false, startEditSerial: 0, currentEditSerial: 0 });
  assert.equal(result.kind, 'already-current');
  nativeMerge(provider, '本地改稿');
  const completed = await turn('对照已存在的当前草稿合并本地改稿，保留服务器备注。');
  const after = await workspace();
  assert.match(after.draft.notes, /另一端服务器备注\n本地改稿/);
  assert.deepEqual(after.draft.rows, original.rows);
  assert.equal(after.draft.revision, 3);
  assert.deepEqual(savedUpstreamMergeDraft(completed.detail, completed.requestId, current), { revision: 3, contentSha256: after.draft.contentSha256 });
  assert.equal(savedUpstreamMergeDraft(completed.detail, randomUUID(), current), null, 'a different request cannot claim this save');
  assert.equal(savedUpstreamMergeDraft(completed.detail, completed.requestId, { ...current, gsaPlanSha256: '0'.repeat(64) }), null, 'a different exact GSA cannot adopt the result');
  await json(await host.request(`${route}/decomposition/draft`, 'POST', { ...review.draftForm, expectedDraftRevision: 2 } satisfies DecompositionDraftInput), 409);
  assert.equal((await workspace()).draft.contentSha256, after.draft.contentSha256, 'stale CAS cannot overwrite the merge');
  provider.setResponder(() => ({ text: '草稿已保存。' }));
  const noSave = await turn('仅回复文字，不调用保存工具。');
  assert.equal(savedUpstreamMergeDraft(noSave.detail, noSave.requestId, current), null, 'a later completed reply cannot claim an older turn save');
  assert.equal((await workspace()).draft.revision, 3);
});
