import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import type { GoalDraftInput, GoalVersion } from '../src/host/strategy-goals-types.ts';
import type { ProjectPlanContent } from '../src/host/project-plan-types.ts';

async function fixture(t: TestContext) {
  const evidence = path.resolve('.local/overall-architecture-product-gaps/pm01');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'goal-context-'));
  const provider = await startToolProvider();
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  t.after(async () => { await host.close(); await provider.close(); await writeFile(path.join(root, 'host-output.json'), JSON.stringify(host.output(), null, 2)); });
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(host.dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const response = await host.request(route, method, body);
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  await request('/api/configuration', 'PUT', { name: 'PG01合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-goal-content', apiKey: 'synthetic-goal-content-only' });
  const { project } = await request('/api/projects', 'POST', { name: '准确目标内容接续' }, 201);
  t.diagnostic(root);
  return { root, host, provider, request, project };
}
const goalDraft = (version: number): GoalDraftInput => ({
  title: '同一诉求的准确目标版本', outcome: '核对会员复购改善安排', perspective: 'personal',
  scope: { kind: 'personal', id: 'pg01-synthetic', name: '合成责任范围' }, responsible: '合成负责人',
  measurement: { kind: 'deliverable', criterion: `PG01_V${version}_RESULT_${version === 1 ? 23 : 41}` },
  baseline: { state: 'known', description: `PG01_V${version}_BASELINE_${version === 1 ? 9 : 17}` },
  dueAt: version === 1 ? '2026-12-01' : '2026-12-31', necessaryConditions: [`PG01_V${version}_CONDITION`],
});

test('PG01: the same request carries each exact adopted goal version into lightweight Pi preparation and actual Task execution without retyping', { timeout: 65_000 }, async t => {
  const f = await fixture(t);
  let goal = (await f.request('/api/strategy/goals', 'POST', { ...goalDraft(1), operationId: randomUUID() }, 201)).goal as GoalVersion;
  const goalId = goal.goalId;
  await f.request(`/api/strategy/goals/${goalId}/adopt`, 'POST', { operationId: randomUUID(), version: 1, expectedVersion: 1, decision: '明确采纳合成目标第一版' });
  goal = (await f.request(`/api/strategy/goals/${goalId}/revisions`, 'POST', { ...goalDraft(2), operationId: randomUUID(), expectedVersion: 1 }, 201)).goal;
  await f.request(`/api/strategy/goals/${goalId}/adopt`, 'POST', { operationId: randomUUID(), version: 2, expectedVersion: 2, decision: '明确采纳合成目标第二版，第一版历史保持' });
  let firstNative: { file: string; bytes: Buffer } | undefined;
  for (const version of [1, 2]) {
    const plan: ProjectPlanContent = { request: '请核对本次已确认目标的达成条件', premises: ['只提供目标和诉求，不提前分析明细'], materials: [], coverage: [],
      tasks: [{ key: 'analysis', name: '核对与综合', selected: true, scope: '使用已确认目标准确版本，说明未知', capabilities: [] }],
      taskMode: 'single', summaryTaskKey: 'analysis', dependencies: [], caseContext: null, goalContext: { goal: { goalId, version }, purpose: 'query' } };
    let prepareText = '', executionText = '';
    f.provider.setResponder(context => {
      // The preparation session and reused Tasks retain history. Check this request's
      // delivered user context, while separately asserting the old native bytes remain.
      const text = providerMessageText([...context.messages].reverse().find(message => message.role === 'user')?.content);
      if (context.availableTools.length === 0) {
        prepareText = text;
        return { text: JSON.stringify({ plan, mece: { sameLevel: '同层范围一致', coverage: '只覆盖已确认目标', boundaries: '不扩全组织目标', depth: '不读明细' }, limitations: [] }) };
      }
      executionText = text;
      return { text: '依据已确认目标准确版本核对，合成输入不证明业务效果。' };
    });
    const base = `/api/projects/${f.project.id}/plan`, previous = await f.request(base);
    const prepared = await f.request(base + '/prepare', 'POST', { operationId: randomUUID(), expectedRevision: previous.revision, plan });
    assert.equal(prepared.preparation.status, 'completed');
    const expected = goalDraft(version);
    assert.ok(prepareText.includes(expected.measurement.kind === 'deliverable' ? expected.measurement.criterion : ''), 'the preparation Agent must receive the original exact goal result criterion, not only its ID');
    assert.ok(prepareText.includes(expected.baseline.description));
    assert.ok(prepareText.includes(expected.necessaryConditions![0]));
    assert.ok(prepareText.includes(expected.dueAt!));
    assert.ok(!prepareText.includes(goalDraft(version === 1 ? 2 : 1).baseline.description), 'the Host must not silently replace this goal by another version');
    const confirmed = await f.request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: prepared.state.revision, mode: 'start' });
    const receipt = confirmed.confirmation.tasks[0]; assert.equal(receipt.startStatus, 'accepted');
    let state: any; const deadline = Date.now() + 15_000;
    do { state = await f.request(`/api/projects/${f.project.id}/tasks/${receipt.taskId}`); if (state.task.lastRun?.id === receipt.startRequestId && state.task.lastRun.status === 'completed' && state.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
    assert.equal(state.task.lastRun?.status, 'completed');
    assert.ok(executionText.includes(expected.baseline.description), 'the actual Task Pi request must carry the same exact goal content');
    assert.ok(executionText.includes(expected.necessaryConditions![0]));
    assert.ok(executionText.includes(expected.dueAt!));
    assert.ok(!executionText.includes(goalDraft(version === 1 ? 2 : 1).baseline.description));
    const bytes = await readFile(state.task.sessionFile);
    if (firstNative) assert.deepEqual((await readFile(firstNative.file)).subarray(0, firstNative.bytes.length), firstNative.bytes, 'later goal/task version use must not rewrite the original native context');
    else firstNative = { file: state.task.sessionFile, bytes };
    await writeFile(path.join(f.root, `version-${version}-observations.json`), JSON.stringify({ goalRef: plan.goalContext!.goal, prepareText, executionText, confirmation: confirmed.confirmation }, null, 2));
  }
  assert.equal(f.provider.requests.length, 4);
  assert.deepEqual(f.provider.errors, []);
});

test('PG01: an unreadable exact goal version is reported before preparation and never guessed or replaced', async t => {
  const f = await fixture(t);
  const created = (await f.request('/api/strategy/goals', 'POST', { ...goalDraft(1), operationId: randomUUID() }, 201)).goal as GoalVersion;
  await f.request(`/api/strategy/goals/${created.goalId}/adopt`, 'POST', { operationId: randomUUID(), version: 1, expectedVersion: 1, decision: '只采纳准确第一版' });
  const plan: ProjectPlanContent = { request: '无需用户重抄目标', premises: [], materials: [], coverage: [], tasks: [{ key: 'check', name: '目标核对', selected: true, scope: '', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'check', dependencies: [], caseContext: null, goalContext: { goal: { goalId: created.goalId, version: 2 }, purpose: 'query' } };
  const response = await f.host.request(`/api/projects/${f.project.id}/plan/prepare`, 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  assert.equal(response.status, 404);
  assert.match(await response.text(), /strategy_goal_version_not_found/);
  assert.equal(f.provider.requests.length, 0, 'an unavailable authority is never presented as a read goal');
  const state = await f.request(`/api/projects/${f.project.id}/plan`);
  assert.equal(state.revision, 0);
  assert.equal(state.draft, undefined);
});
