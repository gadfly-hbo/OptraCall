import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createSapMethodStore } from '../extensions/business-plugins/metric-factory/methods/store.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import type { ProjectPlanContent } from '../src/host/project-plan-types.ts';

const evidenceRoot = path.resolve('.local/overall-architecture-product-gaps/pm02');
async function environment(t: TestContext, name: string) {
  await mkdir(evidenceRoot, { recursive: true });
  const root = await mkdtemp(path.join(evidenceRoot, `${name}-`)), dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  const methods = createSapMethodStore(path.join(dataRoot, 'metric-assets'));
  const old = methods.save({ requestId: randomUUID(), origin: 'other', title: '合成窗口约定v1', content: { conditions: '仅合成资料', logic: 'BAD_V1_BODY_MUST_NOT_BE_DELIVERED', judgment: '原前提错误待纠正', limits: '不得因保存或声明推断专业正确' }, sources: [] });
  methods.publish(old.method.id, { requestId: randomUUID(), version: 1, expectedSha256: old.version.contentSha256 });
  const newer = methods.save({ requestId: randomUUID(), methodId: old.method.id, baseVersion: 1, origin: 'other', title: '合成窗口约定v2', content: { ...old.version.content, logic: 'PUBLISHED_V2_IS_ONLY_AN_EXPLICIT_REPLACEMENT_OPTION' }, sources: [] });
  methods.publish(old.method.id, { requestId: randomUUID(), version: 2, expectedSha256: newer.version.contentSha256 });
  await mkdir(path.join(dataRoot, 'pi'), { recursive: true }); await writeFile(path.join(dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ dataRoot, projectsRoot }); t.after(() => host.close()); t.diagnostic(root);
  t.after(() => writeFile(path.join(root, 'provider-observations.json'), JSON.stringify({ requests: provider.requests.map(request => request.body), errors: provider.errors, host: host.output() }, null, 2)));
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const response = await host.request(route, method, body); assert.equal(response.status, status, `${method} ${route}: ${await response.clone().text()}`); return response.json();
  };
  await request('/api/configuration', 'PUT', { name: '合成按影响承接', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-method-adjustment', apiKey: 'synthetic-method-adjustment-only' });
  const { project } = await request('/api/projects', 'POST', { name: '错法与独立工作' }, 201);
  const plan: ProjectPlanContent = { request: '按影响安排工作，错误方法不得采用，独立资料核对继续', premises: ['仅合成资料；不推断根因'], materials: [], coverage: [], tasks: [
    { key: 'bad', name: '受错误方法影响的工作', selected: true, scope: '待明确处置错误方法后再工作', capabilities: [{ kind: 'sap-method', id: old.method.id, version: '1' }] },
    { key: 'good', name: '独立事实核对及综合', selected: true, scope: '不依赖错误方法核对独立事实并保留证据限制', capabilities: [] },
  ], taskMode: 'multi', summaryTaskKey: 'good', dependencies: [], caseContext: null };
  // Use the same public route spelling as the shipped SAP method feature.
  const mark = async () => request(`/api/sap/methods/${old.method.id}/issues`, 'POST', { requestId: randomUUID(), version: 1, expectedRevision: 0, status: 'confirmed', note: '合成已确认问题：v1观察窗口前提错误，v2仅可作为明确替代建议', replacement: { methodId: old.method.id, version: 2 } });
  return { root, host, provider, request, project, old, newer, plan, base: `/api/projects/${project.id}/plan`, markInvalid: mark };
}
async function completed(f: Awaited<ReturnType<typeof environment>>, taskId: string, requestId: string) {
  let state: any; const deadline = Date.now() + 20_000;
  do { state = await f.request(`/api/projects/${f.project.id}/tasks/${taskId}`); if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed', JSON.stringify(state.task.lastRun));
  const native = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  return { state, native };
}
function capabilityIssues(prompt: string): any[] {
  for (const line of prompt.split('\n')) {
    const start = line.indexOf('['); if (start < 0) continue;
    try { const value = JSON.parse(line.slice(start)); if (Array.isArray(value) && value.some(item => item?.code === 'project_plan_method_unavailable')) return value; } catch { /* Other prompt metadata is not the issue directory. */ }
  }
  return [];
}

test('PG02: a known-error method stays in an editable draft and fails only its new Task while independent work starts through actual Pi', { timeout: 40_000 }, async t => {
  const f = await environment(t, 'new-task-impact'); await f.markInvalid();
  f.provider.setResponder(context => {
    const text = context.messages.filter(message => message.role === 'user').map(message => providerMessageText(message.content)).join('\n');
    assert.match(text, /"currentTask":\{"id":"[^"]+","key":"good"/);
    return { text: '合成独立事实核对完成；受错误方法影响的工作未执行，根因仍未知。' };
  });
  const saved = await f.request(f.base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan: f.plan });
  assert.equal(saved.draft.plan.tasks[0].capabilities[0].version, '1', 'drafting must preserve the exact known-error reference for explicit adjustment');
  const input = { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'start' }, result = await f.request(f.base + '/confirm', 'POST', input);
  const bad = result.confirmation.tasks.find((receipt: any) => receipt.taskKey === 'bad'), good = result.confirmation.tasks.find((receipt: any) => receipt.taskKey === 'good');
  assert.equal(bad.createStatus, 'failed'); assert.equal(bad.createCode, 'project_plan_method_unavailable'); assert.equal(bad.startStatus, 'not-requested');
  assert.equal(good.createStatus, 'created'); assert.equal(good.startStatus, 'accepted');
  const observed = await completed(f, good.taskId, good.startRequestId);
  assert.deepEqual(observed.native.find(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started').data.providedContext.projectPlan.methods, []);
  assert.equal((await f.request(`/api/projects/${f.project.id}`)).project.tasks.length, 1);
  const replay = await f.request(f.base + '/confirm', 'POST', input); assert.equal(replay.replayed, true); assert.equal(f.provider.requests.length, 1);
  assert.equal((await f.request(f.base)).confirmed.plan.tasks[0].capabilities[0].version, '1'); assert.deepEqual(f.provider.errors, []);
  await writeFile(path.join(f.root, 'receipt.json'), JSON.stringify({ bad, good, oldVersionPreserved: true, modelRequests: f.provider.requests.length, professionalQuality: 'NOT_RUN' }, null, 2));
});

test('PG02: actual lightweight Pi receives the exact known-error issue and can defer its original Task without silently substituting v2', { timeout: 40_000 }, async t => {
  const f = await environment(t, 'prepare-deferral'); await f.markInvalid();
  const deferred = structuredClone(f.plan); deferred.tasks[0].selected = false; deferred.taskMode = 'single';
  deferred.coverage = [{ key: 'affected', label: '受错误前提影响的范围', disposition: 'deferred', reason: '原v1已确认错误，待明确选择后再采用替代，独立事实核对继续', taskKeys: ['bad'] }];
  let preparedPrompt = '';
  f.provider.setResponder(context => {
    if (!context.availableTools.length) {
      preparedPrompt = context.messages.filter(message => message.role === 'user').map(message => providerMessageText(message.content)).join('\n');
      return { text: JSON.stringify({ plan: deferred, mece: { sameLevel: '区分受影响方法与独立核对', coverage: '受影响部分暂缓并保留任务', boundaries: '独立部分无需错误方法', depth: '仅轻量安排，不读明细' }, limitations: ['v1已确认前提错误，暂缓原任务；v2只是候选替代，需由原集中确认决定，未静默采用'] }) };
    }
    return { text: '合成独立工作继续，未运行受错误方法影响的任务。' };
  });
  const input = { operationId: randomUUID(), expectedRevision: 0, plan: f.plan }, result = await f.request(f.base + '/prepare', 'POST', input);
  assert.equal(result.preparation.status, 'completed');
  const issues = capabilityIssues(preparedPrompt), issue = issues.find(item => item.taskKey === 'bad');
  assert.ok(issue, 'the actual preparation Agent must receive per-Task capabilityIssues');
  assert.deepEqual(issue.capability, { kind: 'sap-method', id: f.old.method.id, version: '1' }); assert.equal(issue.code, 'project_plan_method_unavailable');
  assert.ok(issue.reason); assert.equal(issue.issue.status, 'confirmed'); assert.equal(issue.issue.version, 1); assert.deepEqual(issue.issue.replacement, { methodId: f.old.method.id, version: 2 });
  assert.doesNotMatch(preparedPrompt, /BAD_V1_BODY_MUST_NOT_BE_DELIVERED|PUBLISHED_V2_IS_ONLY_AN_EXPLICIT_REPLACEMENT_OPTION/);
  assert.equal(result.draft.plan.tasks[0].selected, false); assert.deepEqual(result.draft.plan.tasks[0].capabilities, f.plan.tasks[0].capabilities);
  assert.equal((await f.request(`/api/projects/${f.project.id}`)).project.tasks.length, 0);
  const replay = await f.request(f.base + '/prepare', 'POST', input); assert.equal(replay.replayed, true); assert.equal(f.provider.requests.length, 1);
  const confirmed = await f.request(f.base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: result.state.revision, mode: 'start' });
  assert.deepEqual(confirmed.confirmation.tasks.map((receipt: any) => receipt.taskKey), ['good']);
  await completed(f, confirmed.confirmation.tasks[0].taskId, confirmed.confirmation.tasks[0].startRequestId);
  assert.equal((await f.request(`/api/projects/${f.project.id}`)).project.tasks.length, 1); assert.deepEqual(f.provider.errors, []);
  await writeFile(path.join(f.root, 'receipt.json'), JSON.stringify({ issues, preparedPlan: result.draft.plan, confirmation: confirmed.confirmation, preparationModelRequests: 1, professionalQuality: 'NOT_RUN' }, null, 2));
});

test('PG02: a later known-error change fails only the existing affected Task start and its precise semantic read remains refused', { timeout: 40_000 }, async t => {
  const f = await environment(t, 'existing-task-impact');
  const saved = await f.request(f.base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan: f.plan });
  const created = await f.request(f.base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'create' });
  assert.equal(f.provider.requests.length, 0); await f.markInvalid();
  let refused: any;
  f.provider.setResponder(context => {
    if (!context.recentToolResults.length) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'read', target: { kind: 'sap-method', methodId: f.old.method.id, version: 1, publishedHash: f.old.version.contentSha256 } } }] };
    refused = JSON.parse(providerMessageText(context.recentToolResults[0].content));
    return { text: '原错误v1明确不可读，不把v2暗当原版；独立事实核对继续。' };
  });
  const result = await f.request(f.base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: created.state.revision, mode: 'start' });
  const bad = result.confirmation.tasks.find((receipt: any) => receipt.taskKey === 'bad'), good = result.confirmation.tasks.find((receipt: any) => receipt.taskKey === 'good');
  assert.equal(bad.createStatus, 'created'); assert.equal(bad.startStatus, 'failed'); assert.equal(bad.startCode, 'project_plan_method_unavailable'); assert.equal(good.startStatus, 'accepted');
  await completed(f, good.taskId, good.startRequestId);
  assert.equal(refused.items[0].state, 'disabled'); assert.equal(refused.items[0].body, null); assert.ok(refused.items[0].gaps.includes('known-error-not-current-evidence'));
  assert.equal(refused.items[0].target.version, 1); assert.equal(refused.items[0].target.publishedHash, f.old.version.contentSha256);
  const original = await f.request(`/api/projects/${f.project.id}/tasks/${bad.taskId}`); assert.equal(original.task.lastRun, undefined); assert.equal(original.task.sessionFile, undefined);
  assert.equal(result.confirmation.plan.tasks[0].capabilities[0].version, '1'); assert.equal((await f.request(`/api/projects/${f.project.id}`)).project.tasks.length, 2); assert.deepEqual(f.provider.errors, []);
  await writeFile(path.join(f.root, 'receipt.json'), JSON.stringify({ bad, good, refused, noSilentReplacement: true, professionalQuality: 'NOT_RUN' }, null, 2));
});

test('PG02: preparation cannot move an unavailable original method from its deferred Task into independent selected work', { timeout: 30_000 }, async t => {
  const f = await environment(t, 'reject-method-transfer'); await f.markInvalid();
  const moved = structuredClone(f.plan); moved.tasks[0].selected = false; moved.tasks[0].capabilities = []; moved.tasks[1].capabilities = structuredClone(f.plan.tasks[0].capabilities); moved.taskMode = 'single';
  f.provider.setResponder(() => ({ text: JSON.stringify({ plan: moved, mece: { sameLevel: '合成反例', coverage: '不应接受错误方法换归属', boundaries: '独立工作不应被赋予旧错误方法', depth: '只验证原选择保护' }, limitations: ['错误引用被移到另一任务，必须拒绝此草稿'] }) }));
  const response = await f.host.request(f.base + '/prepare', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan: f.plan }), result = await response.json();
  assert.equal(response.status, 422, `an unavailable reference must stay with its original deferred task: ${JSON.stringify(result)}`);
  assert.ok(['project_plan_preparation_reference', 'project_plan_preparation_selection'].includes(result.code));
  assert.equal((await f.request(f.base)).draft, undefined); assert.equal((await f.request(`/api/projects/${f.project.id}`)).project.tasks.length, 0); assert.deepEqual(f.provider.errors, []);
});
