import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { createCaseDecisionService } from '../src/host/case-decision-service.ts';
import { createWorkspaceDailyRoutes } from '../src/host/workspace-daily-routes.ts';
import { createWorkspaceDraftStore } from '../src/host/workspace-draft-store.ts';
import { syntheticNativeHistory } from './fixtures/synthetic-native-history.ts';
import { listTaskResultSources } from '../src/host/project-task-result-sources.ts';
import { readSavedTaskReply } from '../src/host/project-history.ts';

test('DW-PLAN-REQUEST-01: original checkPlan governs new writes and unanswered projections across real Project/Task/native/recipient loss', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-request-plan-'));
  const cases = new CaseStore({ dataRoot: path.join(root, 'cases') }); await cases.initialize(); t.after(() => cases.close());
  const projects = new ProjectStore({ dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') }); await projects.init(); t.after(() => projects.close());
  const project = await projects.create({ name: '原方案来源', configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', api: 'openai-completions', baseUrl: 'http://127.0.0.1:9' } });
  const record = cases.createCase({ operationId: randomUUID(), title: '原方案资格' }); const rev = () => cases.getCase(record.id).revision;
  cases.linkProject({ operationId: randomUUID(), caseId: record.id, projectId: project.id, expectedRevision: rev() });
  const issue = cases.createDecisionIssue({ operationId: randomUUID(), caseId: record.id, expectedRevision: rev(), title: '原事项' });
  const task = await projects.createTask(project.id, { name: '真实Plan任务', assignment: { type: 'plan', skill: null, issue: { caseId: record.id, issueId: issue.id } } });
  await fs.mkdir(task.sessionDirectory, { recursive: true });
  const ledger = syntheticNativeHistory(task.sessionDirectory, path.join(project.rootPath, '020_clean')), requestId = randomUUID(), sessionId = path.basename(ledger.file, '.jsonl');
  const text = 'Synthetic final plan, exact original ledger; no Provider call.';
  ledger.append({ type: 'custom', customType: 'optracall.run', data: { phase: 'started', requestId, sessionId } });
  ledger.message('user', '原方案请求'); ledger.message('assistant', text);
  ledger.append({ type: 'custom', customType: 'optracall.run', data: { phase: 'settled', outcome: 'completed', requestId, sessionId } });
  const native = ledger.file; await projects.setSession(project.id, task.id, native); const originalBytes = await fs.readFile(native);
  const exact = (await listTaskResultSources(await projects.get(project.id), await projects.getTask(project.id, task.id))).replies[0]!;
  const source = { type: 'native-reply' as const, projectId: project.id, taskId: task.id, sessionId: exact.sessionId, messageId: exact.messageId, expectedTextSha256: exact.sha256 };
  let recipientAllowed = true;
  const service = createCaseDecisionService({ cases, projects, assertActive: p => { if (p.archivedAt !== null) throw Object.assign(Error('project_archived'), { code: 'project_archived', statusCode: 409 }); },
    readSource: async source => { if (source.type !== 'native-reply') throw Error('synthetic_source_type'); const p = await projects.get(source.projectId), task = await projects.getTask(p.id, source.taskId); const reply = await readSavedTaskReply(p, task, source); return { status: 'available', text: reply.text, sha256: createHash('sha256').update(reply.text).digest('hex') } as never; },
    qualifyPlanReply: async () => { if (!recipientAllowed) throw Object.assign(Error('source recipient revoked'), { code: 'case_issue_recipient_unavailable' }); },
    mutate: async fn => fn(),
  });
  const { revision: strategy } = await service.issueWrite(record.id, issue.id, 'plans', { operationId: randomUUID(), source }) as any;
  const strategyRef = { type: 'case-decision' as const, caseStoreId: strategy.caseStoreId, caseId: record.id, recordId: strategy.recordId, revision: strategy.revision };
  await service.checkPlan(strategyRef);
  const input = (previous: string | null) => ({ operationId: randomUUID(), expectedRevision: rev(), expectedRequestRevision: 0, issueId: issue.id, kind: 'choose', text: '请对准确方案取舍', source: { kind: 'user-declaration', ref: 'synthetic/user/message' }, assignee: { label: '负责人', source: '原用户声明' }, target: { kind: 'choose', strategyRef, expectedPreviousChoiceId: previous } });
  const answered = await service.saveDecisionRequest(record.id, input(null));
  const choice = await service.choose(record.id, strategy.recordId, { operationId: randomUUID(), caseStoreId: strategy.caseStoreId, strategyRef, issueId: issue.id, choice: 'trial', expectedPreviousChoiceId: null, respondsToRequest: { requestId: answered.requestId, revision: answered.revision } });
  const waitingInput = input(choice.choiceId), waiting = await service.saveDecisionRequest(record.id, waitingInput);
  const withdrawable = await service.saveDecisionRequest(record.id, input(choice.choiceId));
  const replaceable = await service.saveDecisionRequest(record.id, input(choice.choiceId));
  const dailyDeps = { cases, drafts: createWorkspaceDraftStore({ root }), checkPlan: service.checkPlan, adoptGoal: async () => { throw Error('unused'); }, createCase: async () => { throw Error('unused'); } };
  const daily = createWorkspaceDailyRoutes(dailyDeps as never);
  const withoutQualifier = createWorkspaceDailyRoutes({ ...dailyDeps, checkPlan: undefined } as never);
  const disruptions = [
    { name: 'project', code: 'project_archived', disable: () => projects.archive(project.id), restore: () => projects.restore(project.id) },
    { name: 'task', code: 'case_issue_source_scope_mismatch', disable: () => projects.archiveTask(project.id, task.id), restore: () => projects.restoreTask(project.id, task.id) },
    { name: 'native', code: 'case_issue_reply_unavailable', disable: () => fs.rename(native, native + '.offline'), restore: () => fs.rename(native + '.offline', native) },
    { name: 'recipient', code: 'case_issue_recipient_unavailable', disable: async () => { recipientAllowed = false; }, restore: async () => { recipientAllowed = true; } },
  ];
  for (const disruption of disruptions) {
    await disruption.disable();
    try {
      await assert.rejects(service.choose(record.id, strategy.recordId, { operationId: randomUUID(), caseStoreId: strategy.caseStoreId, strategyRef, issueId: issue.id, choice: 'trial', expectedPreviousChoiceId: choice.choiceId, allowHistorical: true }), { code: disruption.code });
      await assert.rejects(service.saveDecisionRequest(record.id, input(choice.choiceId)), { code: disruption.code });
      await assert.rejects(service.saveDecisionRequest(record.id, { operationId: randomUUID(), expectedRevision: rev(), requestId: waiting.requestId, expectedRequestRevision: waiting.revision, text: '仅改请求文字仍重核来源', source: waitingInput.source }), { code: disruption.code });
      const statuses = await service.decisionRequests(record.id);
      assert.equal(statuses.find(row => row.requestId === waiting.requestId)!.status, 'unverifiable', disruption.name);
      assert.equal(statuses.find(row => row.requestId === answered.requestId)!.status, 'answered', disruption.name);
      assert.equal(((await daily({ pathname: '/api/workspace/home-pending', method: 'GET' }))!.body as any).pending.length, 0);
      const declarations = await service.readDeclarations(record.id, issue.id, { section: 'requests', limit: 20 }) as any;
      assert.equal(declarations.items.find((row: any) => row.requestId === waiting.requestId).status, 'unverifiable');
      assert.deepEqual(await service.saveDecisionRequest(record.id, waitingInput), waiting, 'completed operation remains read-only across source loss');
      if (disruption.name === 'project') {
        for (const [request, action] of [[withdrawable, 'withdraw'], [replaceable, 'supersede']] as const) {
          const saved = await service.saveDecisionRequest(record.id, { operationId: randomUUID(), expectedRevision: rev(), requestId: request.requestId, expectedRequestRevision: request.revision, action, source: waitingInput.source });
          assert.equal(saved.lifecycle, action === 'withdraw' ? 'withdrawn' : 'superseded');
        }
      }
    } finally { await disruption.restore(); }
  }
  assert.equal(((await withoutQualifier({ pathname: '/api/workspace/home-pending', method: 'GET' }))!.body as any).pending.length, 0, 'missing original source qualification cannot fabricate actionable pending');
  assert.deepEqual(await fs.readFile(native), originalBytes);
  assert.equal((await service.decisionRequests(record.id)).find(row => row.requestId === waiting.requestId)!.status, 'open');
  const final = await service.choose(record.id, strategy.recordId, { operationId: randomUUID(), caseStoreId: strategy.caseStoreId, strategyRef, issueId: issue.id, choice: 'continue', expectedPreviousChoiceId: choice.choiceId, allowHistorical: true, respondsToRequest: { requestId: waiting.requestId, revision: waiting.revision } });
  assert.ok(final.choiceId); assert.equal((await service.decisionRequests(record.id)).find(row => row.requestId === waiting.requestId)!.status, 'answered');
});
