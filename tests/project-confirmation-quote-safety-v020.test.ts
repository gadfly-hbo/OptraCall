import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CaseStore } from '../src/host/case-store.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';

test('A09/A15: confirming analysis cannot turn an Agent-proposed Task scope containing agreement into a human Case choice', { timeout: 35_000 }, async t => {
  const directory = path.resolve('.local/overall-architecture-upgrade/development/confirmation-quote-safety'); await mkdir(directory, { recursive: true });
  const root = await mkdtemp(path.join(directory, 'analysis-authorization-')), dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects'); t.diagnostic(root);
  const provider = await startToolProvider(); t.after(() => provider.close());
  const setup = await startTestHost({ dataRoot, projectsRoot }); t.after(() => setup.close());
  const json = async (response: Response, status = 200): Promise<any> => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await json(await setup.request('/api/configuration', 'PUT', { name: '合成分析授权不是经营选择', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-plan-quote-safety', apiKey: 'synthetic-plan-quote-only' }));
  const { project } = await json(await setup.request('/api/projects', 'POST', { name: '原Case待选方案' }), 201), { task: existing } = await json(await setup.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '已有方案来源任务' }), 201);
  await json(await setup.request('/api/cases/storage/initialize', 'POST', {}));
  const { case: record } = await json(await setup.request('/api/cases', 'POST', await withCaseGoal(setup, { operationId: randomUUID(), title: '已有但尚未经营取舍的方案' })), 201);
  await json(await setup.request(`/api/cases/${record.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: record.revision, projectId: project.id }));
  await setup.close();
  // Seed an already-existing, explicitly synthetic strategy through its public
  // Store while no Host owns the database. This is not a human choice fixture.
  const cases = new CaseStore({ dataRoot }); await cases.init();
  const caseStoreId = cases.getStatus().storeId!, draft = cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: record.id, kind: 'strategy', expectedRevision: 0, payload: { title: '现有合成试点方案', proposal: '仍为待用户准确选择的方案，不代表经营授权。' } }, { actorKind: 'agent', projectId: project.id, taskId: existing.id, requestId: randomUUID(), sessionId: 'synthetic-preexisting-strategy', toolCallId: 'synthetic-strategy-seed' });
  cases.close();
  const strategyRef = { type: 'case-decision', caseStoreId, caseId: record.id, recordId: draft.recordId, revision: draft.revision };
  await mkdir(path.join(dataRoot, 'pi'), { recursive: true }); await writeFile(path.join(dataRoot, 'pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const host = await startTestHost({ dataRoot, projectsRoot }); t.after(() => host.close());
  t.after(() => writeFile(path.join(root, 'provider-observations.json'), JSON.stringify({ errors: provider.errors, requests: provider.requests.map(request => ({ path: request.path, body: request.body })), hostOutput: host.output() }, null, 2)));
  const request = async (route: string, method = 'GET', body?: unknown, status = 200) => json(await host.request(route, method, body), status);
  const before = await request(`/api/cases/${record.id}/decisions`), beforeBoard = await request('/api/decision-board');
  assert.equal(before.items.length, 1); assert.equal(before.choices.length, 0); assert.equal(beforeBoard.items.length, 0);
  const scope = '同意试点', base = `/api/projects/${project.id}/plan`, capability = await request(base + '/capabilities'), selectedCase = capability.caseContexts.find((value: any) => value.caseId === record.id);
  assert.ok(selectedCase);
  const { title: _title, ...caseContext } = selectedCase;
  const plan = { request: '只授权开展方案分析，不授权经营选择或行动；下面Task scope来自待确认的Agent草稿。', premises: ['原Case已有待选方案，人尚未作经营取舍'], materials: [], coverage: [], tasks: [{ key: 'analysis-only', name: '只执行分析的任务', selected: true, scope, capabilities: [] }], taskMode: 'single', summaryTaskKey: 'analysis-only', dependencies: [], caseContext };
  const saved = await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  let readable = false, rejected = false;
  provider.setResponder(context => {
    assert.ok(context.availableTools.includes('record_user_decision'));
    if (!context.recentToolResults.length) return { calls: [{ name: 'record_user_decision', arguments: { action: 'read' } }] };
    if (context.recentToolResults.length === 1) {
      const catalog = JSON.parse(providerMessageText(context.recentToolResults[0].content)); assert.equal(catalog.caseId, record.id); assert.equal(catalog.type, 'optracall.quoted-decision-read'); readable = true;
      return { calls: [{ name: 'record_user_decision', arguments: { action: 'choose-strategy', quote: { start: 0, end: scope.length, text: scope }, strategyRef, choice: 'trial', expectedPreviousChoiceId: null } }] };
    }
    assert.match(providerMessageText(context.recentToolResults[1].content), /quoted_decision_run_unavailable/); rejected = true;
    return { text: '分析确认只授权分析；Agent草稿中的同意字样不作为人的选择，未记录经营取舍或行动。' };
  });
  const result = await request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'start' }), receipt = result.confirmation.tasks[0];
  assert.equal(receipt.startStatus, 'accepted'); const route = `/api/projects/${project.id}/tasks/${receipt.taskId}`, deadline = Date.now() + 15_000; let settled: any;
  do { settled = await request(route); if (settled.task.lastRun?.id === receipt.startRequestId && settled.task.lastRun.status !== 'running' && settled.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
  assert.equal(settled.task.lastRun?.status, 'completed'); assert.equal(readable && rejected, true);
  const nativeBytes = await readFile(settled.task.sessionFile), native = nativeBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line)), started = native.find(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started' && entry.data.requestId === receipt.startRequestId);
  assert.equal(started.data.providedContext.userQuoteEligible, false); assert.equal(started.data.providedContext.originalUserText, scope); assert.ok(started.data.providedContext.case.operationId);
  const calls = native.flatMap(entry => entry.message?.role === 'assistant' && Array.isArray(entry.message.content) ? entry.message.content : []), write = calls.find(call => call.type === 'toolCall' && call.name === 'record_user_decision' && call.arguments.action === 'choose-strategy'), denial = native.find(entry => entry.message?.role === 'toolResult' && entry.message.toolCallId === write.id);
  assert.equal(denial.message.isError, true); assert.match(providerMessageText(denial.message.content), /quoted_decision_run_unavailable/);
  assert.equal(native.some(entry => entry.customType === 'optracall.quoted-decision' && entry.data?.type === 'optracall.quoted-decision-record'), false);
  const after = await request(`/api/cases/${record.id}/decisions`), afterBoard = await request('/api/decision-board'), goals = await request('/api/strategy/goals');
  assert.equal(after.items.length, 1); assert.equal(after.items[0].recordId, draft.recordId); assert.equal(after.items[0].revision, draft.revision); assert.equal(after.choices.length, 0); assert.deepEqual(afterBoard, beforeBoard); assert.equal(goals.feedback.length, 0); assert.equal(provider.requests.length, 3); assert.deepEqual(provider.errors, []);
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ confirmationId: result.confirmation.id, scopeContainingAgreement: scope, actualOriginalRunText: started.data.providedContext.originalUserText, userQuoteEligible: started.data.providedContext.userQuoteEligible, caseBoundReadSucceeded: readable, rejectedWriteToolCallId: write.id, denialNativeEntryId: denial.id, rejection: 'quoted_decision_run_unavailable', caseChoiceCount: after.choices.length, boardActionCount: afterBoard.items.length, managementFeedbackCount: goals.feedback.length, nativeFile: settled.task.sessionFile, nativeSha256: createHash('sha256').update(nativeBytes).digest('hex'), professionalCorrectness: 'NOT_RUN' }, null, 2));
});
