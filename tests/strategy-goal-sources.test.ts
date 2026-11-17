import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { CaseStore } from '../src/host/case-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { createDecisionBoardStore, boardRecordVersion } from '../extensions/business-plugins/decision-board/storage/store.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';
import { createStrategyGoalSources, validateStrategyGoalScope } from '../src/host/strategy-goal-sources.ts';
import { EnterpriseScopeStore } from '../src/host/enterprise-scope-store.ts';

const configuration = { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic', name: 'Synthetic', baseUrl: 'https://example.invalid' };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-goal-source-'))), dataRoot = path.join(root, 'private');
  const cases = new CaseStore({ dataRoot }); await cases.initialize();
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  const board = createDecisionBoardStore({ root: path.join(root, 'board') }); await board.init();
  const metrics = createMetricLibrary(path.join(root, 'metrics'));
  t.after(async () => { board.close(); cases.close(); await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await projects.create({ name: '合成原记录项目', configuration });
  const readable: string[] = [];
  const sources = createStrategyGoalSources({ cases, projects, board, metrics, async assertBoardItemReadable(item) { readable.push(item.id); } });
  return { root, cases, projects, board, metrics, project, sources, readable };
}
async function strategyChoice(value: Awaited<ReturnType<typeof fixture>>) {
  const { cases, projects, project } = value, task = await projects.createTask(project.id, { name: '原用户对话Task' });
  const record = cases.createCase({ operationId: randomUUID(), title: '原策略Case' }); cases.linkProject({ operationId: randomUUID(), caseId: record.id, projectId: project.id, expectedRevision: record.revision });
  const caseStoreId = cases.getStatus().storeId!, draft = cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: record.id, expectedRevision: 0, kind: 'strategy', payload: { title: '合成待选方案', proposal: '先补齐明确资料' } }, { actorKind: 'agent', projectId: project.id, taskId: task.id, requestId: randomUUID(), sessionId: 'synthetic-native', toolCallId: 'synthetic-draft' });
  const strategyRef = { type: 'case-decision' as const, caseStoreId, caseId: record.id, recordId: draft.recordId, revision: draft.revision }, text = '先按这个方案补证。';
  const quoteProvenance = { schemaVersion: 1 as const, projectId: project.id, taskId: task.id, requestId: randomUUID(), sessionId: 'synthetic-native', toolCallId: 'synthetic-choice', originalUserTextSha256: createHash('sha256').update(text).digest('hex'), quote: { start: 0, end: text.length, text } };
  const choice = cases.chooseStrategy({ operationId: randomUUID(), caseStoreId, caseId: record.id, strategyRef, choice: 'gather_evidence', expectedPreviousChoiceId: null }, { quoteProvenance });
  return { record, task, strategyRef, choice, quoteProvenance };
}

test('an exact original Board feedback revision is selectable after a later revision without copying its facts into goal management', async t => {
  const { board, project, sources, readable } = await fixture(t);
  const item = board.addManualItem({ projectId: project.id, title: '核对会员窗口', rationale: '原看板依据' });
  board.decideItem(item.id, { status: 'adopted' });
  const task = board.addTask(item.id, { title: '观察行动', owner: '用户指定' });
  const old = board.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '原行动事实', metricDelta: '待核', review: '原反馈正文', score: null, effect: 'unknown' });
  board.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: old.revisionId, adopted: false, outcome: '后续事实', metricDelta: '0', review: '未验证', score: null, effect: 'unknown' });
  const ref = { authority: 'decision-board' as const, id: task.id, version: old.revisionId, taskId: task.id, projectId: project.id };
  await sources.validate(ref);
  const projection = await sources.list();
  assert.ok(projection.sources.some(value => JSON.stringify(value.ref) === JSON.stringify(ref)));
  assert.equal(JSON.stringify(projection).includes('原行动事实'), false);
  assert.equal(JSON.stringify(projection).includes('原反馈正文'), false);
  assert.ok(readable.includes(item.id));
  assert.equal(board.listFeedbackHistory(task.id).length, 2);
});

test('Board item source selection binds its exact current decision snapshot and never substitutes a later decision', async t => {
  const { board, project, sources } = await fixture(t);
  const item = board.addManualItem({ projectId: project.id, title: '原经营选项', rationale: '仅原处维护' });
  const ref = (await sources.list()).sources.find(value => value.ref.authority === 'decision-board' && value.ref.id === item.id)?.ref;
  assert.ok(ref); assert.equal(ref.version, item.updatedAt); assert.match(ref.sha256!, /^[a-f0-9]{64}$/);
  await sources.validate(ref);
  board.decideItem(item.id, { status: 'dismissed', reason: '用户明确不选' });
  await assert.rejects(sources.validate(ref), /strategy_goal_feedback_source_changed/);
  assert.equal(board.getItem(item.id).status, 'dismissed');
  assert.equal(board.listTasks().length, 0);
});

test('SAP feedback sources name a real published package version and verified bytes rather than latest or an editable draft', async t => {
  const { metrics, sources } = await fixture(t);
  const bytes = await fs.readFile(new URL('../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url));
  const first = metrics.publish(preparePublication(bytes), 'synthetic-user');
  metrics.publish(preparePublication(Buffer.from(bytes.toString('utf8').replace('version: 1.0.0', 'version: 1.1.0').replace('复购会员数', '重复购买会员数'))), 'synthetic-user');
  const ref = { authority: 'sap-metric' as const, id: first.id, version: first.version, sha256: first.bytesSha256 };
  await sources.validate(ref);
  const projection = await sources.list();
  assert.ok(projection.sources.some(value => JSON.stringify(value.ref) === JSON.stringify(ref)));
  await assert.rejects(sources.validate({ ...ref, version: 'latest' }), /strategy_goal_feedback_source_unavailable/);
  await assert.rejects(sources.validate({ ...ref, sha256: 'f'.repeat(64) }), /strategy_goal_feedback_source_changed/);
  const file = metrics.filePath(first.id, first.version), before = await fs.readFile(file);
  await fs.writeFile(file, Buffer.concat([before, Buffer.from('\n# changed')]));
  await assert.rejects(sources.validate(ref), /strategy_goal_feedback_source_unavailable/);
  assert.ok((await sources.list()).unavailable.some(value => value.authority === 'sap-metric'));
  assert.equal((await fs.readFile(file)).equals(before), false);
});

test('Case history is referenced by a genuine revision while Project and Task sources bind their current original snapshot', async t => {
  const { cases, projects, project, sources } = await fixture(t);
  const record = cases.createCase({ operationId: randomUUID(), title: '原Case', judgement: '原因待核' });
  cases.addCaseNote({ operationId: randomUUID(), caseId: record.id, expectedRevision: record.revision, note: '后续用户反馈', feedbackSource: '用户记录' });
  await sources.validate({ authority: 'case', id: record.id, version: 1 });
  await assert.rejects(sources.validate({ authority: 'case', id: record.id, version: 99 }), /strategy_goal_feedback_source_changed/);
  const task = await projects.createTask(project.id, { name: '真实分析任务' });
  const projection = await sources.list();
  const projectRef = projection.sources.find(value => value.ref.authority === 'project' && value.ref.id === project.id)?.ref;
  const taskRef = projection.sources.find(value => value.ref.authority === 'task' && value.ref.id === task.id)?.ref;
  assert.ok(projectRef); assert.ok(taskRef); assert.equal(taskRef.projectId, project.id); assert.equal(taskRef.taskId, task.id);
  await sources.validate(projectRef); await sources.validate(taskRef);
  const taskText = JSON.stringify(projection.sources.find(value => value.ref === taskRef));
  assert.equal(taskText.includes(configuration.baseUrl), false);
  await projects.saveDraft(project.id, task.id, '新的用户输入');
  await assert.rejects(sources.validate(taskRef), /strategy_goal_feedback_source_changed/);
  const other = await projects.create({ name: '其他项目', configuration });
  await assert.rejects(sources.validate({ ...taskRef, projectId: other.id }), /strategy_goal_feedback_source_unavailable/);
});

test('an unavailable authority leaves a visible directory gap while independent source choices remain usable', async t => {
  const { cases, projects, board, metrics, project } = await fixture(t);
  const record = cases.createCase({ operationId: randomUUID(), title: '独立可用Case' });
  const item = board.addManualItem({ projectId: project.id, title: '暂失权来源', rationale: '原材料权限由原入口管理' });
  const sources = createStrategyGoalSources({ cases, projects, board, metrics: { list() { throw new Error('secret metric path'); }, read: metrics.read }, async assertBoardItemReadable() { throw new Error('secret removed permission'); } });
  const projection = await sources.list();
  assert.ok(projection.sources.some(value => value.ref.id === record.id));
  assert.equal(projection.sources.some(value => value.ref.id === item.id), false);
  assert.ok(projection.unavailable.some(value => value.authority === 'sap-metric'));
  assert.ok(projection.unavailable.some(value => value.authority === 'decision-board'));
  assert.equal(JSON.stringify(projection).includes('secret'), false);
});

test('enterprise and declared department scope use the original Studio enterprise identity while personal scope needs no organization', async t => {
  const { root } = await fixture(t), directory = new EnterpriseScopeStore(path.join(root, 'private'));
  const enterprise = directory.create({ name: '合成测试企业' });
  validateStrategyGoalScope({ kind: 'enterprise', id: enterprise.id, name: enterprise.name }, directory);
  validateStrategyGoalScope({ kind: 'department', id: 'member-team', name: '用户声明的会员部', enterpriseId: enterprise.id }, directory);
  validateStrategyGoalScope({ kind: 'personal', id: 'self', name: '个人职责' }, directory);
  assert.throws(() => validateStrategyGoalScope({ kind: 'enterprise', id: randomUUID(), name: '伪企业' }, directory), /strategy_goal_scope_unavailable/);
  validateStrategyGoalScope({ kind: 'department', id: 'member-team', name: '上层组织未知的部门' }, directory);
  assert.throws(() => validateStrategyGoalScope({ kind: 'department', id: 'member-team', name: '伪企业部门', enterpriseId: randomUUID() }, directory), /strategy_goal_scope_unavailable/);
  assert.equal(directory.list().enterprises.length, 1);
});

test('a Board feedback reference cannot borrow another action or project and unreadable original provenance stays unavailable', async t => {
  const { cases, projects, board, metrics, project, sources } = await fixture(t);
  const item = board.addManualItem({ projectId: project.id, title: '原行动建议', rationale: '原记录' }); board.decideItem(item.id, { status: 'adopted' });
  const task = board.addTask(item.id, { title: '原行动' }), another = board.addTask(item.id, { title: '另一行动' });
  const feedback = board.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '原处事实', metricDelta: '', review: '', score: null, effect: 'unknown' });
  const ref = { authority: 'decision-board' as const, id: task.id, taskId: task.id, version: feedback.revisionId, projectId: project.id };
  await assert.rejects(sources.validate({ ...ref, id: another.id, taskId: another.id }), /strategy_goal_feedback_source_unavailable/);
  await assert.rejects(sources.validate({ ...ref, projectId: randomUUID() }), /strategy_goal_feedback_source_unavailable/);
  const denied = createStrategyGoalSources({ cases, projects, board, metrics, async assertBoardItemReadable() { throw new Error('private source path'); } });
  await assert.rejects(denied.validate(ref), error => { assert.equal((error as Error).message, 'strategy_goal_feedback_source_unavailable'); return true; });
  assert.equal((await denied.list()).sources.some(value => value.ref.authority === 'decision-board'), false);
  assert.deepEqual(board.getFeedbackRevision(feedback.revisionId), feedback);
});

test('a Board decision changed while original source readability is awaited cannot retain the prior snapshot qualification', async t => {
  const { cases, projects, board, metrics, project, sources } = await fixture(t);
  const item = board.addManualItem({ projectId: project.id, title: '待核选择', rationale: '原记录' });
  const ref = (await sources.list()).sources.find(value => value.ref.id === item.id)!.ref;
  const changing = createStrategyGoalSources({ cases, projects, board, metrics, async assertBoardItemReadable() { await Promise.resolve(); board.decideItem(item.id, { status: 'adopted' }); } });
  await assert.rejects(changing.validate(ref), /strategy_goal_feedback_source_changed/);
  assert.equal(board.getItem(item.id).status, 'adopted');
  assert.equal(board.listTasks().length, 0);
});

test('an original quoted Case choice is referenced by its immutable choice ID and exact original project and conversation Task', async t => {
  const value = await fixture(t), { cases, sources, project } = value, { record, task, choice, strategyRef, quoteProvenance } = await strategyChoice(value);
  const ref = { authority: 'case' as const, id: record.id, version: choice.choiceId, projectId: project.id, taskId: task.id };
  await sources.validate(ref);
  cases.chooseStrategy({ operationId: randomUUID(), caseStoreId: strategyRef.caseStoreId, caseId: record.id, strategyRef, choice: 'defer', expectedPreviousChoiceId: choice.choiceId }, { quoteProvenance });
  await sources.validate(ref);
  assert.deepEqual((await sources.list()).sources.find(value => value.ref.version === choice.choiceId)?.ref, ref);
  await assert.rejects(sources.validate({ ...ref, taskId: randomUUID() }), /strategy_goal_feedback_source_unavailable/);
  await assert.rejects(sources.validate({ ...ref, projectId: randomUUID() }), /strategy_goal_feedback_source_unavailable/);
  assert.equal(JSON.stringify(await sources.list()).includes(quoteProvenance.quote.text), false);
});

test('an exact original Board authorization remains a distinct historical source after revocation without confusing its action Task with the quoting conversation Task', async t => {
  const value = await fixture(t), { board, project, sources } = value, { choice, strategyRef, quoteProvenance } = await strategyChoice(value);
  const item = board.addManualItem({ projectId: project.id, title: '原行动建议', rationale: '原处维护事实' }); board.decideItem(item.id, { status: 'adopted' });
  const task = board.addTask(item.id, { title: '合成行动' }), source = { caseStoreId: strategyRef.caseStoreId, caseId: strategyRef.caseId, choiceId: choice.choiceId, strategyRef };
  const input = { operationId: randomUUID(), projectId: project.id, itemId: item.id, taskId: task.id, itemVersion: boardRecordVersion(board.getItem(item.id)), taskVersion: boardRecordVersion(task), expectedPreviousAuthorizationId: null, decision: 'authorize' as const, scope: '只登记合成行动授权，不执行', source, quoteProvenance };
  const authorization = board.recordActionAuthorization(input), ref = { authority: 'decision-board' as const, id: task.id, version: authorization.authorizationId, projectId: project.id, taskId: task.id };
  await sources.validate(ref);
  board.recordActionAuthorization({ ...input, operationId: randomUUID(), expectedPreviousAuthorizationId: authorization.authorizationId, decision: 'revoke' });
  await sources.validate(ref); await sources.validate({ ...ref, taskId: undefined });
  assert.deepEqual((await sources.list()).sources.find(value => value.ref.version === authorization.authorizationId)?.ref, ref);
  await assert.rejects(sources.validate({ ...ref, taskId: quoteProvenance.taskId }), /strategy_goal_feedback_source_unavailable/);
  await assert.rejects(sources.validate({ ...ref, id: item.id }), /strategy_goal_feedback_source_unavailable/);
  const feedback = board.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: false, outcome: '仅用户报告的事实', metricDelta: '', review: '', score: null, effect: 'unknown' });
  await sources.validate({ authority: 'decision-board', id: task.id, version: feedback.revisionId, projectId: project.id });
  assert.equal(board.getTask(task.id).status, 'todo'); assert.equal(board.listActionAuthorizations(task.id).length, 2);
});
