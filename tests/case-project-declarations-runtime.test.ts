import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { readJson } from './fixtures/joint-context.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';
import { CaseStore } from '../src/host/case-store.ts';

test('DW-FINAL-PROJECT-01: actual project owner Pi saves parallel declarations and public stop rejects its delayed next declaration batch', { timeout: 60000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  let host = await startTestHost(); t.after(() => host.close());
  const { configuration } = await readJson(await host.request('/api/configuration', 'PUT', { name: '普通项目声明回环', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-project-declarations', apiKey: 'synthetic-project-declarations-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '普通项目声明' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '普通任务' }), 201);
  await readJson(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const { case: record } = await readJson(await host.request('/api/cases', 'POST', await withCaseGoal(host, { operationId: randomUUID(), title: '普通项目Case' })), 201);
  await readJson(await host.request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id }));
  await host.close();
  const cases = new CaseStore({ dataRoot: host.dataRoot }); await cases.init();
  const a = cases.createDecisionIssue({ operationId: randomUUID(), caseId: record.id, expectedRevision: cases.getCase(record.id).revision, title: 'A' });
  const b = cases.createDecisionIssue({ operationId: randomUUID(), caseId: record.id, expectedRevision: cases.getCase(record.id).revision, title: 'B' });
  const caseStoreId = cases.getStatus().storeId!;
  const strategy = cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: record.id, kind: 'strategy', expectedRevision: 0, payload: { title: '合成方案', proposal: '仅在明确范围内观察' } }, { actorKind: 'agent', projectId: project.id, taskId: task.id, requestId: randomUUID(), sessionId: 'seed', toolCallId: 'seed' });
  cases.close();
  host = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot });
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const idle = async (requestId: string) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const view = await readJson(await host.request(route));
      if (view.task.lastRun?.id === requestId && view.task.lastRun.status !== 'running' && view.snapshot.status === 'idle') return view;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw Error('project declaration run did not settle');
  };
  const start = async (text: string) => {
    const current = await readJson(await host.request(`/api/cases/${record.id}`));
    const requestId = randomUUID();
    await readJson(await host.request(route + '/messages', 'POST', { requestId, text, caseContext: { caseId: record.id, caseRevision: current.case.revision, projectWorkRevision: 0, selectedReferenceIds: [] } }), 202);
    return requestId;
  };
  let toolReplies: string[] = [];
  provider.setResponder(context => {
    if (context.recentToolResults.length) { toolReplies = context.recentToolResults.map(row => providerMessageText(row.content)); return { text: '已按明确声明保存两项。' }; }
    assert.ok(context.availableTools.includes('read_case_decisions'));
    assert.ok(context.availableTools.includes('save_case_decision_draft'));
    return { calls: [
      { name: 'save_case_issue_edge', arguments: { fromIssueId: a.id, toIssueId: b.id, explanation: '原用户明确承接', expectedEdgeRevision: 0 } },
      { name: 'save_case_decision_request', arguments: { issueId: b.id, kind: 'choose', text: '请负责人取舍', assignee: { label: '负责人', source: '原用户声明' }, target: { kind: 'choose', strategyRef: { type: 'case-decision', caseStoreId, caseId: record.id, recordId: strategy.recordId, revision: strategy.revision }, expectedPreviousChoiceId: null }, expectedRequestRevision: 0 } },
    ] };
  });
  const first = await start('把A承接到B，并明确请负责人取舍合成方案');
  const completed = await idle(first); assert.equal(completed.task.lastRun.status, 'completed');
  let { edges } = await readJson(await host.request(`/api/cases/${record.id}/decisions/issue-edges`));
  let { requests } = await readJson(await host.request(`/api/cases/${record.id}/decisions/requests`));
  assert.equal(edges.length, 1); assert.equal(requests.length, 1); assert.equal(toolReplies.length, 2);
  assert.ok(toolReplies.every(text => !text.includes('case_revision_conflict')));
  assert.ok(edges[0].source.ref.includes(first)); assert.ok(requests[0].source.ref.includes(first));
  const native = (await readFile(completed.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const saved = native.filter(row => row.message?.role === 'toolResult' && ['save_case_issue_edge', 'save_case_decision_request'].includes(row.message.toolName));
  assert.equal(saved.length, 2); assert.ok(saved.every(row => row.message.isError === false));

  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  provider.setResponder(async () => { entered(); await held; return { calls: [
    { name: 'save_case_issue_edge', arguments: { edgeId: edges[0].edgeId, action: 'remove', expectedEdgeRevision: 1 } },
    { name: 'save_case_decision_request', arguments: { requestId: requests[0].requestId, action: 'withdraw', expectedRequestRevision: 1 } },
  ] }; });
  const cancelled = await start('解除原承接并撤回请求，随后在迟到返回前取消');
  await waiting;
  await readJson(await host.request(route + '/stop', 'POST', {}));
  release();
  const stopped = await idle(cancelled); assert.equal(stopped.task.lastRun.status, 'cancelled');
  ({ edges } = await readJson(await host.request(`/api/cases/${record.id}/decisions/issue-edges`)));
  ({ requests } = await readJson(await host.request(`/api/cases/${record.id}/decisions/requests`)));
  assert.equal(edges[0].revision, 1); assert.equal(requests[0].revision, 1); assert.equal(requests[0].lifecycle, 'open');
  let enteredConfig!: () => void, releaseConfig!: () => void;
  const waitingConfig = new Promise<void>(resolve => { enteredConfig = resolve; });
  const heldConfig = new Promise<void>(resolve => { releaseConfig = resolve; });
  const beforeConfig = provider.requests.length;
  provider.setResponder(async () => { enteredConfig(); await heldConfig; return { calls: [
    { name: 'save_case_issue_edge', arguments: { edgeId: edges[0].edgeId, action: 'remove', expectedEdgeRevision: 1 } },
    { name: 'save_case_decision_request', arguments: { requestId: requests[0].requestId, action: 'withdraw', expectedRequestRevision: 1 } },
  ] }; });
  const changed = await start('明确解除原承接并撤回请求，模型配置随后改变'); await waitingConfig;
  await readJson(await host.request('/api/configuration', 'PUT', { id: configuration.id, name: '普通项目声明回环', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-project-declarations', apiKey: 'synthetic-new-credential-only' }));
  releaseConfig();
  const afterConfig = await idle(changed); assert.notEqual(afterConfig.task.lastRun.status, 'completed');
  ({ edges } = await readJson(await host.request(`/api/cases/${record.id}/decisions/issue-edges`)));
  ({ requests } = await readJson(await host.request(`/api/cases/${record.id}/decisions/requests`)));
  assert.equal(edges[0].revision, 1); assert.equal(requests[0].revision, 1);
  assert.equal(provider.requests.length, beforeConfig + 1, 'the original public lifecycle must revoke this owner before a stale route continues');
  const nextProvider = await startToolProvider(); t.after(() => nextProvider.close());
  let enteredRoute!: () => void, releaseRoute!: () => void;
  const waitingRoute = new Promise<void>(resolve => { enteredRoute = resolve; });
  const heldRoute = new Promise<void>(resolve => { releaseRoute = resolve; });
  const beforeRoute = provider.requests.length;
  provider.setResponder(async () => { enteredRoute(); await heldRoute; return { calls: [
    { name: 'save_case_issue_edge', arguments: { edgeId: edges[0].edgeId, action: 'remove', expectedEdgeRevision: 1 } },
    { name: 'save_case_decision_request', arguments: { requestId: requests[0].requestId, action: 'withdraw', expectedRequestRevision: 1 } },
  ] }; });
  const routeChanged = await start('明确解除承接并撤回请求，Provider线路随后改变'); await waitingRoute;
  await readJson(await host.request('/api/configuration', 'PUT', { id: configuration.id, name: '普通项目声明回环', provider: 'openai-compatible', baseUrl: nextProvider.baseUrl, model: 'synthetic-project-declarations', apiKey: 'synthetic-new-route-only' }));
  releaseRoute();
  let settled: any;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const currentNative = (await readFile(completed.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    settled = currentNative.find(row => row.customType === 'optracall.run' && row.data?.requestId === routeChanged && row.data.phase === 'settled');
    if (settled) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(settled, 'the original native must record this invalidated run terminal state'); assert.notEqual(settled.data.outcome, 'completed');
  ({ edges } = await readJson(await host.request(`/api/cases/${record.id}/decisions/issue-edges`)));
  ({ requests } = await readJson(await host.request(`/api/cases/${record.id}/decisions/requests`)));
  assert.equal(edges[0].revision, 1); assert.equal(requests[0].revision, 1);
  assert.equal(provider.requests.length, beforeRoute + 1); assert.equal(nextProvider.requests.length, 0);
  assert.deepEqual(provider.errors, []);
  t.diagnostic(JSON.stringify({ dataRoot: host.dataRoot, native: completed.task.sessionFile, completedRequest: first, cancelledRequest: cancelled, changedConfigurationRequest: changed, changedRouteRequest: routeChanged, providerRequests: provider.requests.length }));
});
