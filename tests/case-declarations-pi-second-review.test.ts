import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { readJson } from './fixtures/joint-context.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';
import { CaseStore } from '../src/host/case-store.ts';

async function waitForRoleIdle(host: Awaited<ReturnType<typeof startTestHost>>, ownerParam: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const view = await readJson(await host.request(`/api/business-role?owner=${encodeURIComponent(ownerParam)}`));
    const running = view.snapshot?.running;
    const msgs = view.snapshot?.messages ?? [];
    if (view.discussion?.lastRun?.status === 'completed' && !running && msgs.some((m: { role?: string }) => m.role === 'assistant')) return view;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('timeout waiting for Pi business-role completion');
}

test('DW-PI-SECOND-01: official Pi reads exact declaration identities, saves parallel edge/request, then revises both using returned CAS', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider();
  t.after(() => provider.close());
  let host = await startTestHost();
  t.after(() => host.close());

  const { configuration } = await readJson(await host.request('/api/configuration', 'PUT', {
    name: 'Pi合成Provider', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-pi', apiKey: 'synthetic-only',
  }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'Pi合成项目', configurationId: configuration.id }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'Pi任务' }), 201);
  await readJson(await host.request('/api/cases/storage/initialize', 'POST', {}));

  const { case: record } = await readJson(await host.request('/api/cases', 'POST', await withCaseGoal(host, {
    operationId: randomUUID(), title: 'Pi实测华东扩围', description: '合成Pi回环',
  })), 201);
  await readJson(await host.request(`/api/cases/${record.id}/projects`, 'POST', {
    operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id,
  }));
  const getRev = async () => (await readJson(await host.request(`/api/cases/${record.id}`))).case.revision as number;
  const { issue: a } = await readJson(await host.request(`/api/cases/${record.id}/decisions/issues`, 'POST', { operationId: randomUUID(), expectedRevision: await getRev(), title: '试点范围' }), 201);
  const { issue: b } = await readJson(await host.request(`/api/cases/${record.id}/decisions/issues`, 'POST', { operationId: randomUUID(), expectedRevision: await getRev(), title: '扩围取舍' }), 201);

  // Seed a strategy draft so Case Agent can save a real choose request targeting it
  await host.close();
  const store = new CaseStore({ dataRoot: host.dataRoot });
  await store.init();
  const caseStoreId = store.getStatus().storeId!;
  const strategy = store.saveDecisionDraft(
    { operationId: randomUUID(), caseStoreId, caseId: record.id, expectedRevision: 0, kind: 'strategy', payload: { title: '先扩三家', proposal: '观察两周' } },
    { actorKind: 'agent', projectId: project.id, taskId: task.id, requestId: randomUUID(), sessionId: 'pi-seed', toolCallId: 'pi-t1' },
  );
  store.close();
  host = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot });
  t.after(() => host.close());

  // All edit identities come from the real narrow tool read, not from hidden fixture IDs.
  let step = 0;
  let readStrategy: any, readA: any, readB: any, savedEdge: any, savedRequest: any;
  provider.setResponder(ctx => {
    step++;
    const pages = ctx.recentToolResults.map(result => JSON.parse(providerMessageText(result.content)));
    if (step === 1) return { calls: ['issues','strategies'].map(section => ({ name: 'strategy_goals', arguments: { action: 'case-read-declarations', section, limit: 10 } })) };
    if (step === 2) {
      const issues = pages.find(row => row.page?.section === 'issues').page.items;
      readA = issues.find((row: any) => row.title === '试点范围');
      readB = issues.find((row: any) => row.title === '扩围取舍');
      readStrategy = pages.find(row => row.page?.section === 'strategies').page.items[0].strategyRef;
      assert.deepEqual(readStrategy, { type: 'case-decision', caseStoreId, caseId: record.id, recordId: strategy.recordId, revision: strategy.revision });
      return { calls: [
        { name: 'strategy_goals', arguments: { action: 'case-save-issue-edge', fromIssueId: readA.id, toIssueId: readB.id, explanation: '明确承接', expectedEdgeRevision: 0 } },
        { name: 'strategy_goals', arguments: { action: 'case-save-decision-request', kind: 'choose', text: '请负责人取舍', assignee: { label: '华东负责人', source: '本轮明确声明' }, dueDate: '2026-12-01', target: { kind: 'choose', strategyRef: readStrategy, expectedPreviousChoiceId: null }, expectedRequestRevision: 0 } },
      ] };
    }
    if (step === 3) {
      assert.ok(pages.some(row => row.claim === 'case-issue-edge-saved'));
      assert.ok(pages.some(row => row.claim === 'case-decision-request-saved'));
      return { calls: ['edges','requests','choices','observations'].map(section => ({ name: 'strategy_goals', arguments: { action: 'case-read-declarations', section, limit: 1 } })) };
    }
    if (step === 4) {
      savedEdge = pages.find(row => row.page?.section === 'edges').page.items[0];
      savedRequest = pages.find(row => row.page?.section === 'requests').page.items[0];
      assert.equal(savedRequest.assignee.label, '华东负责人');
      assert.ok(pages.some(row => row.page?.section === 'choices'));
      assert.ok(pages.some(row => row.page?.section === 'observations'));
      return { calls: [
        { name: 'strategy_goals', arguments: { action: 'case-save-issue-edge', edgeId: savedEdge.edgeId, expectedEdgeRevision: savedEdge.revision, explanation: '修订承接说明' } },
        { name: 'strategy_goals', arguments: { action: 'case-save-decision-request', requestId: savedRequest.requestId, expectedRequestRevision: savedRequest.revision, text: '仅修订请求文字' } },
      ] };
    }
    assert.ok(pages.some(row => row.edge?.revision === 2));
    assert.ok(pages.some(row => row.request?.revision === 2));
    return { text: '已按原身份保存并修订，承接人和日期保留。' };
  });

  const caseOwner = JSON.stringify({ role: 'case', caseId: record.id, itemId: b.id });
  await readJson(await host.request(`/api/business-role?owner=${encodeURIComponent(caseOwner)}&action=messages`, 'POST', {
    requestId: randomUUID(), text: '把试点范围承接到扩围取舍，并请华东负责人对先扩三家方案作取舍，日期12月1日；然后仅修订关系说明和请求文字', expectedRevision: 0,
  }), 202);
  await waitForRoleIdle(host, caseOwner);

  // Verify real persisted edge, real persisted request, and real home-pending projection!
  const { edges } = await readJson(await host.request(`/api/cases/${record.id}/decisions/issue-edges`));
  assert.equal(edges.length, 1);
  assert.equal(edges[0].fromIssueId, a.id);
  assert.equal(edges[0].toIssueId, b.id);
  assert.ok(edges[0].source.ref && edges[0].source.ref.includes('/'), 'edge source ref must carry real Pi sessionId/requestId/toolCallId');

  const home = await readJson(await host.request('/api/workspace/home-pending'));
  assert.equal(home.pending.length, 1);
  assert.equal(home.pending[0].issueId, b.id);
  assert.equal(home.pending[0].assignee.label, '华东负责人');
  assert.equal(home.pending[0].dueDate, '2026-12-01');
  assert.equal(home.pending[0].revision, 2);
  assert.equal(home.pending[0].text, '仅修订请求文字');
  assert.equal(edges[0].revision, 2);
  assert.equal(edges[0].explanation, '修订承接说明');
  assert.equal(step, 5);
  assert.deepEqual(provider.errors, []);
  t.diagnostic(JSON.stringify({ dataRoot: host.dataRoot, providerRequests: provider.requests.length, edgeId: edges[0].edgeId, requestId: home.pending[0].requestId, requestRevision: home.pending[0].revision }));
});
