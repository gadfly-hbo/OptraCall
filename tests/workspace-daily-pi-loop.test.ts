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
    if (!running && msgs.some((m: { role?: string }) => m.role === 'assistant')) return view;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('timeout waiting for Pi business-role completion');
}

test('DW-PI-LOOP-01: real Host -> official Pi 1.4.0 -> synthetic Provider invokes case-directory on goal-draft and save-issue-edge/save-decision-request on {role:case}', { timeout: 60_000 }, async t => {
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

  // 1) goal-draft owner invokes case-directory through real Pi 1.4.0
  let directoryToolResult = '';
  provider.setResponder(ctx => {
    if (ctx.recentToolResults.length === 0) {
      assert.ok(ctx.availableTools.includes('strategy_goals'), `expected strategy_goals tool, got ${ctx.availableTools.join(',')}`);
      return { calls: [{ name: 'strategy_goals', arguments: { action: 'case-directory', query: '华东', limit: 10 } }] };
    }
    directoryToolResult = providerMessageText(ctx.recentToolResults[0]?.content);
    return { text: `找到匹配 Case：${record.title}（${record.id}）` };
  });

  const draftOwner = JSON.stringify({ role: 'goal-draft', draftId: randomUUID(), scope: { kind: 'personal', id: 'pi-scope', name: 'Pi测试' } });
  await readJson(await host.request(`/api/business-role?owner=${encodeURIComponent(draftOwner)}&action=messages`, 'POST', {
    requestId: randomUUID(), text: '华东三家门店复购波动，帮我找相关 Case', expectedRevision: 0,
  }), 202);
  await waitForRoleIdle(host, draftOwner);
  assert.ok(directoryToolResult.includes(record.id), `expected case-directory tool result to include ${record.id}, got ${directoryToolResult}`);
  assert.ok(directoryToolResult.includes(a.id));

  // 2) {role:'case', caseId, itemId} owner invokes case-save-issue-edge AND case-save-decision-request through real Pi 1.4.0
  const strategyRef = { type: 'case-decision', caseStoreId, caseId: record.id, recordId: strategy.recordId, revision: strategy.revision };
  let caseStep = 0;
  provider.setResponder(ctx => {
    caseStep++;
    if (caseStep === 1) {
      assert.ok(ctx.availableTools.includes('strategy_goals'), `expected strategy_goals on role:case, got ${ctx.availableTools.join(',')}`);
      return {
        calls: [
          {
            name: 'strategy_goals',
            arguments: {
              action: 'case-save-issue-edge', fromIssueId: a.id, toIssueId: b.id,
              explanation: '用户声明：试点范围承接到扩围取舍', expectedEdgeRevision: 0, sourceKind: 'user-declaration',
            },
          },
          {
            name: 'strategy_goals',
            arguments: {
              action: 'case-save-decision-request', kind: 'choose', text: '请华东负责人对先扩三家方案作取舍',
              assignee: { label: '华东负责人', source: '对话明确声明' },
              target: { kind: 'choose', strategyRef, expectedPreviousChoiceId: null }, expectedRequestRevision: 0,
            },
          },
        ],
      };
    }
    return { text: '已按你的明确声明保存事项承接关系与取舍请求。' };
  });

  const caseOwner = JSON.stringify({ role: 'case', caseId: record.id, itemId: b.id });
  await readJson(await host.request(`/api/business-role?owner=${encodeURIComponent(caseOwner)}&action=messages`, 'POST', {
    requestId: randomUUID(), text: '把试点范围承接到扩围取舍，并请华东负责人对先扩三家方案作取舍', expectedRevision: 0,
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
});
