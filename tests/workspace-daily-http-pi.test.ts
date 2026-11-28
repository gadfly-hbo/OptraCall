import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { editableGoalTool } from '../src/agent/strategy-discussion.ts';
import { saveCaseIssueEdgeParameters, saveCaseDecisionRequestParameters } from '../src/agent/case-decisions.ts';

test('DW-HTTP-01: real Host HTTP round-trip for issue edges, explicit requests -> choice response -> home-pending update, drafts, and case-directory', { timeout: 30_000 }, async t => {
  const host = await startTestHost();
  t.after(() => host.close());

  await readJson(await host.request('/api/configuration', 'PUT', {
    name: 'DW合成', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1', model: 'synthetic', apiKey: 'synthetic-only',
  }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'DW合成项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'DW任务' }), 201);
  await readJson(await host.request('/api/cases/storage/initialize', 'POST', {}));

  // Create Case with XSS-like title to verify plain-data round-trip
  const xssTitle = '华东扩围 <img src=x onerror=alert(1)>';
  const { case: created } = await readJson(await host.request('/api/cases', 'POST', await withCaseGoal(host, {
    operationId: randomUUID(), title: xssTitle, description: '合成验收用例',
  })), 201);
  await readJson(await host.request(`/api/cases/${created.id}/projects`, 'POST', {
    operationId: randomUUID(), expectedRevision: created.revision, projectId: project.id,
  }));

  // Create 3 issues & declare multi-predecessor convergence A->C and B->C over HTTP
  const getRev = async () => (await readJson(await host.request(`/api/cases/${created.id}`))).case.revision as number;
  const { issue: a } = await readJson(await host.request(`/api/cases/${created.id}/decisions/issues`, 'POST', { operationId: randomUUID(), expectedRevision: await getRev(), title: '试点范围' }), 201);
  const { issue: b } = await readJson(await host.request(`/api/cases/${created.id}/decisions/issues`, 'POST', { operationId: randomUUID(), expectedRevision: await getRev(), title: '客流访谈' }), 201);
  const { issue: c } = await readJson(await host.request(`/api/cases/${created.id}/decisions/issues`, 'POST', { operationId: randomUUID(), expectedRevision: await getRev(), title: '扩围决策' }), 201);

  await readJson(await host.request(`/api/cases/${created.id}/decisions/issue-edges`, 'POST', {
    operationId: randomUUID(), expectedRevision: await getRev(), fromIssueId: a.id, toIssueId: c.id, explanation: '试点汇入', expectedEdgeRevision: 0, source: { kind: 'user-declaration', ref: 'http-test-1' },
  }), 201);
  await readJson(await host.request(`/api/cases/${created.id}/decisions/issue-edges`, 'POST', {
    operationId: randomUUID(), expectedRevision: await getRev(), fromIssueId: b.id, toIssueId: c.id, explanation: '访谈汇入', expectedEdgeRevision: 0, source: { kind: 'user-declaration', ref: 'http-test-2' },
  }), 201);
  const { edges } = await readJson(await host.request(`/api/cases/${created.id}/decisions/issue-edges`));
  assert.equal(edges.length, 2);

  // Seed one strategy draft on the Case store (same approved pattern as case-decision-host.test.ts)
  await host.close();
  const store = new CaseStore({ dataRoot: host.dataRoot });
  await store.init();
  const caseStoreId = store.getStatus().storeId!;
  const strategy = store.saveDecisionDraft(
    { operationId: randomUUID(), caseStoreId, caseId: created.id, expectedRevision: 0, kind: 'strategy', payload: { title: '先扩三家门店', proposal: '观察两周' } },
    { actorKind: 'agent', projectId: project.id, taskId: task.id, requestId: randomUUID(), sessionId: 'syn-s1', toolCallId: 'syn-t1' },
  );
  store.close();

  const host2 = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot });
  t.after(() => host2.close());
  const rev2 = (await readJson(await host2.request(`/api/cases/${created.id}`))).case.revision as number;

  // Save explicit choose request via HTTP
  const strategyRef = { type: 'case-decision', caseStoreId, caseId: created.id, recordId: strategy.recordId, revision: strategy.revision };
  const { request: decReq } = await readJson(await host2.request(`/api/cases/${created.id}/decisions/requests`, 'POST', {
    operationId: randomUUID(), expectedRevision: rev2, expectedRequestRevision: 0,
    issueId: c.id, kind: 'choose', text: '请确认是否先扩三家门店',
    source: { kind: 'user-declaration', ref: 'http-msg-1' },
    assignee: { label: '华东负责人', source: 'http-msg-1' },
    target: { kind: 'choose', strategyRef, expectedPreviousChoiceId: null },
  }), 201);

  // Home pending projection shows 1 open request with heading "待处理事项"
  const homeBefore = await readJson(await host2.request('/api/workspace/home-pending'));
  assert.equal(homeBefore.pendingHeading, '待处理事项');
  assert.equal(homeBefore.pending.length, 1);
  assert.equal(homeBefore.pending[0].requestId, decReq.requestId);
  assert.equal(homeBefore.pending[0].caseTitle, xssTitle);

  // Respond with exact respondsToRequest via choose endpoint -> home pending updates to 0
  await readJson(await host2.request(`/api/cases/${created.id}/decisions/${strategy.recordId}/choice`, 'POST', {
    operationId: randomUUID(), caseStoreId, strategyRef, choice: 'trial', expectedPreviousChoiceId: null,
    issueId: c.id, respondsToRequest: { requestId: decReq.requestId, revision: decReq.revision },
  }));
  const homeAfter = await readJson(await host2.request('/api/workspace/home-pending'));
  assert.equal(homeAfter.pending.length, 0);

  // Bounded Case directory returns the Case and its 3 issues
  const dir = await readJson(await host2.request('/api/workspace/case-directory?query=%E5%8D%8E%E4%B8%9C'));
  assert.equal(dir.storeState, 'ready');
  assert.equal(dir.items.length, 1);
  assert.equal(dir.items[0].issues.length, 3);

  // Persistent drafts + idempotent fragment append over HTTP
  const draftId = `issue:${created.id}:${c.id}`;
  const fragId = `frag-${randomUUID()}`;
  const { draft: d1 } = await readJson(await host2.request(`/api/workspace/drafts/issue-draft/${encodeURIComponent(draftId)}`, 'PUT', {
    expectedRevision: 0, payload: { caseId: created.id, issueId: c.id, text: '已有草稿', appendedFragmentIds: [] },
  }));
  await readJson(await host2.request(`/api/workspace/drafts/carry-over/${encodeURIComponent(fragId)}`, 'PUT', {
    expectedRevision: 0, payload: { originalText: '首页新输入', origin: { kind: 'home-input', label: '工作台首页', ref: 'home' }, targetCaseId: created.id, targetIssueId: c.id, appendedAt: null },
  }));
  const app1 = await readJson(await host2.request('/api/workspace/drafts/append-fragment', 'POST', {
    fragmentId: fragId, issueDraftId: draftId, caseId: created.id, issueId: c.id, expectedDraftRevision: d1.revision,
  }));
  assert.equal(app1.alreadyAppended, false);
  assert.equal(app1.draft.payload.text, '已有草稿\n\n首页新输入');
  const app2 = await readJson(await host2.request('/api/workspace/drafts/append-fragment', 'POST', {
    fragmentId: fragId, issueDraftId: draftId, caseId: created.id, issueId: c.id, expectedDraftRevision: app1.draft.revision,
  }));
  assert.equal(app2.alreadyAppended, true);
  assert.equal(app2.draft.payload.text, '已有草稿\n\n首页新输入');
});

test('DW-AGENT-02: Pi tool schemas expose case-directory on goal-draft and save-issue-edge/save-decision-request on Case Agent', () => {
  assert.ok(editableGoalTool.description.includes('case-directory'));
  assert.ok(JSON.stringify(editableGoalTool.parameters).includes('case-directory'));
  assert.ok(JSON.stringify(saveCaseIssueEdgeParameters).includes('fromIssueId'));
  assert.ok(JSON.stringify(saveCaseDecisionRequestParameters).includes('assignee'));
});

test('DW-HTTP-03: real Host HTTP POST /api/workspace/create-case adopts candidate goal via StrategyGoalsStore and continues on exact G/S', { timeout: 30_000 }, async t => {
  const host = await startTestHost();
  t.after(() => host.close());
  await readJson(await host.request('/api/cases/storage/initialize', 'POST', {}));

  // Create an unadopted candidate goal via real /api/strategy/goals
  const { goal: candidate } = await readJson(await host.request('/api/strategy/goals', 'POST', {
    operationId: randomUUID(),
    title: '合成候选目标：华东会员复购',
    outcome: '验证通过 /api/workspace/create-case 明确采纳并建案',
    perspective: 'personal',
    scope: { kind: 'personal', id: 'dw-http-03-scope', name: '测试范围' },
    measurement: { kind: 'deliverable', criterion: '建案回执与采纳回执分开保存' },
    baseline: { state: 'pending', description: '合成基线' },
    responsible: '合成负责人',
    strategies: ['高价值会员分层召回'],
  }), 201);
  assert.equal(candidate.status, 'candidate');

  // Branch 3: adopt candidate + create Case over real HTTP
  const adoptOp = randomUUID();
  const createOp = randomUUID();
  const res = await readJson(await host.request('/api/workspace/create-case', 'POST', {
    draftId: `prep-${randomUUID()}`,
    title: '华东会员复购试点',
    description: '从首页准备草稿建案',
    rawInput: '华东会员复购下滑',
    adoptOperationId: adoptOp,
    createOperationId: createOp,
    goal: { goalId: candidate.goalId, version: candidate.version, strategy: '高价值会员分层召回', alreadyAdopted: false },
  }), 201);
  assert.equal(res.branch, 'created');
  assert.equal(res.adoptionReceipt.goalId, candidate.goalId);
  assert.equal(res.adoptionReceipt.operationId, adoptOp);
  assert.equal(res.creationReceipt.operationId, createOp);

  // Branch 1: same exact G/S with a new title -> returns 'continue', never creates a duplicate
  const cont = await readJson(await host.request('/api/workspace/create-case', 'POST', {
    draftId: `prep-${randomUUID()}`,
    title: '换标题尝试重复建案',
    description: '新输入背景',
    rawInput: '补充信息',
    adoptOperationId: randomUUID(),
    createOperationId: randomUUID(),
    goal: { goalId: candidate.goalId, version: candidate.version, strategy: '高价值会员分层召回', alreadyAdopted: true },
  }), 200);
  assert.equal(cont.branch, 'continue');
  assert.equal(cont.existingCase.id, res.createdCase.id);
});
