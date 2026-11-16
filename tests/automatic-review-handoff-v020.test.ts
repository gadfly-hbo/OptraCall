import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { AnalysisDeliveryReceipt } from '../src/host/analysis-delivery.ts';
import type { CaseDetail, CaseRecord, CaseContextSelection } from '../src/host/case-types.ts';
import type { ProjectPlanContent, ProjectPlanDraftResult, ProjectPlanConfirmResult, ProjectPlanState } from '../src/host/project-plan-types.ts';
import type { GoalRef, GoalVersion } from '../src/host/strategy-goals-types.ts';
import type { ClientProject, ClientTask, TaskState } from '../src/host/ui/project-types.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { providerMessageText, startToolProvider, type ToolProviderContext } from './fixtures/tool-provider.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';

const declaration = {
  completion: 'organize-partial', format: 'chat-summary', summary: '仅整理合成范围和局限，不作经营效果主张。',
  limitations: ['合成协议回归，不代表专业正确或业务效果验收。'], selfCheck: { performed: true, findings: ['已核明确范围与限制。'] }, methodChecks: [], reports: [],
};
const userText = (context: ToolProviderContext) => providerMessageText([...context.messages].reverse().find(message => message.role === 'user')?.content);
const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
async function entered(gate: ReturnType<typeof deferred>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([gate.promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Expected actual SDK continuation did not start.')), 15_000); })]); }
  finally { clearTimeout(timer); }
}
type NativeEntry = { type?: string; customType?: string; data?: Record<string, any> };

/** Original Host + its installed Pi SDK; the loopback provider only supplies
 * synthetic protocol replies. It never executes tools or starts another runtime. */
async function fixture(t: TestContext) {
  const evidence = path.resolve('.local/overall-architecture-upgrade/development/automatic-review-handoff');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence, 'sdk-'));
  const provider = await startToolProvider(), releases: (() => void)[] = [];
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  t.after(async () => {
    for (const release of releases) release();
    try { await host.close(); } finally {
      await provider.close();
      await writeFile(path.join(root, 'provider-requests.json'), JSON.stringify(provider.requests, null, 2));
      await writeFile(path.join(root, 'provider-errors.json'), JSON.stringify(provider.errors, null, 2));
      await writeFile(path.join(root, 'host-output.json'), JSON.stringify(host.output(), null, 2));
    }
  });
  const request = async <T = any>(route: string, method = 'GET', input?: unknown, status = 200): Promise<T> => {
    const response = await host.request(route, method, input);
    assert.equal(response.status, status, await response.clone().text()); return response.json() as Promise<T>;
  };
  await mkdir(path.join(host.dataRoot, 'pi'), { recursive: true });
  await writeFile(path.join(host.dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  await request('/api/configuration', 'PUT', { name: '合成审查交接', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-review-handoff', apiKey: 'synthetic-review-handoff-only' });
  const { project } = await request<{ project: ClientProject }>('/api/projects', 'POST', { name: '合成审查交接回归' }, 201);
  const { task } = await request<{ task: ClientTask }>(`/api/projects/${project.id}/tasks`, 'POST', { name: '原作者任务' }, 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const settings = async (patch: Record<string, boolean>) => {
    const current = await request('/api/automatic-actions/settings');
    return request('/api/automatic-actions/settings', 'POST', { operationId: randomUUID(), expectedRevision: current.revision, nodes: { ...current.nodes, ...patch } });
  };
  const idle = async () => {
    const deadline = Date.now() + 20_000; let state: TaskState | undefined;
    do {
      state = await request<TaskState>(route);
      // Host status includes the original domain's busy lease, so this waits
      // through review, author revision and all subsequent automatic actions.
      if (state.task.lastRun?.status && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') {
        assert.ok(state.task.sessionFile);
        const entries: NativeEntry[] = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        await writeFile(path.join(root, 'native-entries.json'), JSON.stringify(entries, null, 2));
        return { state, entries };
      }
      await delay(20);
    } while (Date.now() < deadline);
    assert.fail(`Original Task lease did not settle: ${JSON.stringify({ task: state?.task, status: state?.snapshot.status })}`);
  };
  const observe = (name: string, value: unknown) => writeFile(path.join(root, name + '.json'), JSON.stringify(value, null, 2));
  t.diagnostic(root);
  return { root, provider, host, releases, project, task, route, request, settings, idle, observe };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function linkedCase(f: Fixture) {
  await f.request('/api/cases/storage/initialize', 'POST', {});
  const { case: record } = await f.request<{ case: CaseRecord }>('/api/cases', 'POST', await withCaseGoal(f.host, { operationId: randomUUID(), title: '合成原目标审查Case' }), 201);
  await f.request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: f.project.id });
  const detail = await f.request<CaseDetail>(`/api/cases/${record.id}`), { project } = await f.request<{ project: ClientProject }>(`/api/projects/${f.project.id}`);
  assert.ok(detail.goalBinding); assert.ok(project.work);
  const selection: CaseContextSelection = { caseId: record.id, caseRevision: detail.case.revision, projectWorkRevision: project.work.revision, selectedReferenceIds: [] };
  return { detail, project, selection };
}
function reviewReply(context: ToolProviderContext) {
  const packet = JSON.parse(userText(context));
  return { text: JSON.stringify({ schemaVersion: 1, reportVersion: packet.report.sha256, claims: [], scope: { reviewed: '合成准确报告', unreviewed: [], limitations: ['合成协议回归。'] } }) };
}
function reportFinding(f: Fixture, version: 'v1' | 'v2', content: string) {
  const relativePath = `060_reports/${version === 'v1' ? 'initial-v1' : 'revised-v2'}.md`;
  return { kind: 'knowledge', title: `已发现问题-${version}`, body: `仅${version}已有明确发现，未授权经营行动。`, sources: [{ type: 'report', ref: `project-report:${f.project.id}:${f.task.id}:${relativePath}`, version: sha256(content), sha256: sha256(content) }] };
}

test('A22 actual SDK closing review during an in-flight reviewer blocks its not-yet-started author return', { timeout: 35_000 }, async t => {
  const f = await fixture(t), reviewerEntered = deferred(), release = deferred(); f.releases.push(release.resolve);
  await f.settings({ save: true, review: true }); let authorReturns = 0;
  f.provider.setResponder(async context => {
    if (!context.availableTools.length) { reviewerEntered.resolve(); await release.promise; return reviewReply(context); }
    if (userText(context).includes('自动接回的准确稿件审查意见')) { authorReturns++; return { text: '本不应开始的作者修订。' }; }
    return context.recentToolResults.length ? { text: '初稿已交付。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, save: { filename: 'toggle-review.md', content: '# 合成原稿' } } }] };
  });
  await f.request(f.route + '/messages', 'POST', { requestId: randomUUID(), text: '明确整理当前合成资料。' }, 202);
  await entered(reviewerEntered); await f.settings({ review: false }); release.resolve();
  const result = await f.idle(), reviews = await f.request(f.route + '/conclusion-reviews');
  await f.observe('review-toggle', { authorReturns, reviews, state: result.state.task.lastRun, errors: f.provider.errors });
  assert.deepEqual(f.provider.errors, []);
  assert.equal(reviews.reviews.length, 1); assert.equal(reviews.reviews[0].state, 'completed', 'an already-started reviewer is allowed to finish');
  assert.equal(authorReturns, 0, 'the current global value must be read before dispatching a new author continuation');
  assert.equal(result.entries.some(entry => entry.customType === 'optracall.run' && entry.data?.phase === 'started' && entry.data.providedContext?.automaticSource?.kind === 'review-feedback'), false);
});

test('A14/A15/A18 actual SDK Case and asset handoff use the explicitly retained v2 delivery and exact new sources', { timeout: 40_000 }, async t => {
  const f = await fixture(t); await f.settings({ save: true, review: true, case: true, assets: true });
  const c = await linkedCase(f), v1 = '# 合成初稿v1', v2 = '# 合成修订稿v2';
  let authorReturns = 0, reviewerCalls = 0; const assetPrompts: string[] = [];
  f.provider.setResponder(context => {
    const text = userText(context);
    if (!context.availableTools.length) { reviewerCalls++; return reviewReply(context); }
    if (text.includes('自动整理本轮分析中已经发现的资产问题')) { assetPrompts.push(text); return { text: '仅保留准确的新版本已发现问题，未发布资产或执行行动。' }; }
    if (text.includes('自动接回的准确稿件审查意见')) {
      if (context.recentToolResults.length) return { text: '已明确本轮修订交付。' };
      authorReturns++;
      return { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, summary: '修订结论及限制；复查后明确保留v2。', assetFindings: [reportFinding(f, 'v2', v2)], ...(authorReturns === 1 ? { save: { filename: 'revised-v2.md', content: v2 } } : { reports: [{ relativePath: '060_reports/revised-v2.md', sha256: sha256(v2) }] }) } }] };
    }
    return context.recentToolResults.length ? { text: '已明确交付初稿。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, save: { filename: 'initial-v1.md', content: v1 }, assetFindings: [reportFinding(f, 'v1', v1)] } }] };
  });
  await f.request(f.route + '/messages', 'POST', { requestId: randomUUID(), text: '明确整理合成报告，按当前节点继续审查及既有发现。', caseContext: c.selection }, 202);
  const result = await f.idle(), after = await f.request<CaseDetail>(`/api/cases/${c.selection.caseId}`);
  const deliveries = result.entries.filter(entry => entry.customType === 'optracall.analysis-delivery').map(entry => entry.data as unknown as AnalysisDeliveryReceipt);
  const latest = deliveries.at(-1)!;
  await f.observe('version-handoff', { artifacts: after.artifacts, authorReturns, reviewerCalls, deliveries, assetPrompts, errors: f.provider.errors });
  assert.deepEqual(f.provider.errors, []); assert.equal(authorReturns, 2); assert.equal(reviewerCalls, 2); assert.equal(deliveries.length, 3);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/initial-v1.md'), 'utf8'), v1);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/revised-v2.md'), 'utf8'), v2);
  assert.deepEqual(after.artifacts.map(item => [item.relativePath, item.observedSha256, item.taskId]), [['060_reports/revised-v2.md', sha256(v2), f.task.id]], 'Case must receive the final explicit v2, preserving v1 only as history');
  assert.equal(assetPrompts.length, 1); assert.ok(assetPrompts[0].includes('已发现问题-v2')); assert.ok(!assetPrompts[0].includes('已发现问题-v1'));
  const exactLine = (marker: string) => JSON.parse(assetPrompts[0].slice(assetPrompts[0].indexOf(marker) + marker.length).split('\n')[0]);
  assert.deepEqual(exactLine('本轮交付声明准确来源：'), latest.source);
  assert.deepEqual(exactLine('本轮准确报告来源：'), latest.reportSources);
  assert.equal(result.entries.filter(entry => entry.type === 'session').length, 1);
});

test('A05/A07/J02 ordinary followup retains its confirmed Plan after automatic report linking, but explicit stale or changed goals still conflict', { timeout: 40_000 }, async t => {
  const f = await fixture(t); await f.settings({ save: true, case: true }); const c = await linkedCase(f);
  f.provider.setResponder(context => {
    if (userText(context).includes('FOLLOWUP-PROBE')) return { text: '仅解释原报告范围，不改已确认目标或方案。' };
    return context.recentToolResults.length ? { text: '已正常整理并保存原报告。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, save: { filename: 'plan-case-source.md', content: '# 合成已确认方案报告' } } }] };
  });
  const plan: ProjectPlanContent = { request: '已确认合成范围，仅作有边界整理。', premises: [], materials: [], coverage: [], tasks: [{ key: 'author', name: f.task.name, taskId: f.task.id, selected: true, scope: '整理合成已知事实。', capabilities: [] }], taskMode: 'single', summaryTaskKey: 'author', dependencies: [], caseContext: { caseId: c.selection.caseId, primaryGoal: c.detail.goalBinding!.primary, relatedGoals: c.detail.goalBinding!.related, caseRevision: c.selection.caseRevision, projectWorkRevision: c.selection.projectWorkRevision } };
  const saved = await f.request<ProjectPlanDraftResult>(`/api/projects/${f.project.id}/plan/draft`, 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const confirmed = await f.request<ProjectPlanConfirmResult>(`/api/projects/${f.project.id}/plan/confirm`, 'POST', { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'start' });
  await f.idle(); const after = await f.request<CaseDetail>(`/api/cases/${c.selection.caseId}`);
  assert.equal(after.artifacts.length, 1); assert.ok(after.case.revision > c.selection.caseRevision);
  const before = f.provider.requests.length;
  await f.request(f.route + '/messages', 'POST', { requestId: randomUUID(), text: 'FOLLOWUP-PROBE 用户明确提交旧选择。', caseContext: c.selection }, 409);
  assert.equal(f.provider.requests.length, before, 'an explicit stale user selection must fail before any model dispatch');
  const followupId = randomUUID(), response = await f.host.request(f.route + '/messages', 'POST', { requestId: followupId, text: 'FOLLOWUP-PROBE 仅解释报告范围，沿原确认方案继续。' });
  const body = await response.json();
  await f.observe('plan-followup', { status: response.status, body, confirmationId: confirmed.confirmation.id, oldCaseRevision: c.selection.caseRevision, currentCaseRevision: after.case.revision, errors: f.provider.errors });
  assert.equal(response.status, 202, 'the Plan remains usable after its own report association increments only Case revision');
  const continued = await f.idle();
  const started = continued.entries.find(entry => entry.customType === 'optracall.run' && entry.data?.phase === 'started' && entry.data.requestId === followupId);
  assert.equal(started?.data?.providedContext?.projectPlan?.confirmationId, confirmed.confirmation.id);
  const { goal } = await f.request<{ goal: GoalVersion }>('/api/strategy/goals', 'POST', { operationId: randomUUID(), title: '明确新增合成目标', outcome: '不同目标需要另有准确安排', perspective: 'personal', scope: { kind: 'personal', id: 'synthetic-scope-change', name: '合成用户' }, measurement: { kind: 'deliverable', criterion: '独立核对新范围' }, baseline: { state: 'pending', description: '合成基线待核' }, responsible: '合成用户' }, 201);
  const adopted = (await f.request<{ goal: GoalVersion }>(`/api/strategy/goals/${goal.goalId}/adopt`, 'POST', { operationId: randomUUID(), version: goal.version, expectedVersion: goal.version, decision: '用户明确采纳不同合成目标，不授权变更旧Plan。' })).goal;
  const ref: GoalRef = { goalId: adopted.goalId, version: adopted.version };
  const calls = f.provider.requests.length;
  for (const binding of [{ primary: c.detail.goalBinding!.primary, related: [ref] }, { primary: ref, related: [] }]) {
    const current = await f.request<CaseDetail>(`/api/cases/${c.selection.caseId}`);
    await f.request(`/api/cases/${c.selection.caseId}/goals`, 'POST', { operationId: randomUUID(), expectedRevision: current.case.revision, goalBinding: binding });
    await f.request(f.route + '/messages', 'POST', { requestId: randomUUID(), text: 'FOLLOWUP-PROBE 目标已变，不得隐式改绑原方案。' }, 409);
    assert.equal(f.provider.requests.length, calls);
  }
  const finalPlan = await f.request<ProjectPlanState>(`/api/projects/${f.project.id}/plan`);
  assert.deepEqual(finalPlan.confirmed?.plan.caseContext, confirmed.confirmation.plan.caseContext, 'implicit runtime continuation must not rewrite the immutable confirmation');
  assert.deepEqual(f.provider.errors, []);
});

for (const mode of ['failed', 'no-declaration', 'stopped'] as const) test(`A14/A22 actual SDK author ${mode} cannot fall back to an old delivery for automatic Case or assets`, { timeout: 35_000 }, async t => {
  const f = await fixture(t); await f.settings({ save: true, review: true, case: true, assets: true });
  const c = await linkedCase(f), authorEntered = deferred(), v1 = '# 合成原声明保留', v2 = '# 已另存但作者运行失败，不是可后续采用的成功交付';
  let authorReturns = 0, caseTurns = 0, assetTurns = 0;
  f.provider.setResponder(context => {
    const text = userText(context);
    if (!context.availableTools.length) return reviewReply(context);
    if (text.includes('自动整理本轮已声明的Case发现')) { caseTurns++; return { text: '不应派发Case接续。' }; }
    if (text.includes('自动整理本轮分析中已经发现的资产问题')) { assetTurns++; return { text: '不应派发资产接续。' }; }
    if (text.includes('自动接回的准确稿件审查意见')) {
      if (!context.recentToolResults.length) { authorReturns++; authorEntered.resolve(); }
      if (mode === 'stopped') return { text: '原作者正在核对，尚未完成。', hold: true };
      if (mode === 'no-declaration') return { text: '当前只有聊天说明，未明确声明本次准确交付。' };
      // A failed author may already have saved a new declaration and file. The
      // real provider failure after that tool must still block later adoption.
      return context.recentToolResults.length ? { status: 500 } : { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, save: { filename: 'revised-v2.md', content: v2 }, assetFindings: [reportFinding(f, 'v2', v2)] } }] };
    }
    return context.recentToolResults.length ? { text: '原分析已成功整理；后续作者结果另核。' } : { calls: [{ name: 'declare_analysis_delivery', arguments: { ...declaration, save: { filename: 'initial-v1.md', content: v1 }, assetFindings: [reportFinding(f, 'v1', v1)], caseFindings: [{ kind: 'strategy', title: '仅原稿已发现问题', body: '等待作者本次准确声明，不自动当作最新结论。', sources: [] }] } }] };
  });
  const originalRequest = randomUUID();
  await f.request(f.route + '/messages', 'POST', { requestId: originalRequest, text: '明确整理合成材料，保留每轮运行的真实结果。', caseContext: c.selection }, 202);
  await entered(authorEntered);
  if (mode === 'stopped') await f.request(f.route + '/stop', 'POST', {});
  const result = await f.idle(), after = await f.request<CaseDetail>(`/api/cases/${c.selection.caseId}`);
  const deliveries = result.entries.filter(entry => entry.customType === 'optracall.analysis-delivery');
  await f.observe('author-' + mode, { authorReturns, caseTurns, assetTurns, artifacts: after.artifacts, deliveries, state: result.state.task.lastRun, errors: f.provider.errors });
  assert.deepEqual(f.provider.errors, []); assert.equal(authorReturns, 1);
  assert.equal(result.state.task.lastRun?.status, mode === 'failed' ? 'failed' : mode === 'stopped' ? 'cancelled' : 'completed');
  const initial = result.entries.find(entry => entry.customType === 'optracall.run' && entry.data?.requestId === originalRequest && entry.data.phase === 'settled');
  assert.equal(initial?.data?.outcome, 'completed', 'subsequent failure/cancellation must not rewrite the original completion');
  assert.equal(deliveries.length, mode === 'failed' ? 2 : 1);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/initial-v1.md'), 'utf8'), v1);
  if (mode === 'failed') assert.equal(await readFile(path.join(f.project.rootPath, '060_reports/revised-v2.md'), 'utf8'), v2);
  assert.equal(after.artifacts.length, 0, 'no fallback to a previous report or unsuccessful revised declaration');
  assert.equal(caseTurns, 0); assert.equal(assetTurns, 0);
  assert.equal(result.entries.some(entry => entry.customType === 'optracall.automatic-action' && ['case', 'assets'].includes(entry.data?.node) && entry.data?.phase === 'decision' && entry.data.decision?.allowed === true), false, 'later automatic nodes must not start after an unsuccessful or undeclared author handoff');
  assert.equal(result.entries.filter(entry => entry.type === 'session').length, 1);
  assert.equal((await f.request<{ project: ClientProject }>(`/api/projects/${f.project.id}`)).project.tasks.length, 1);
});
