import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { CaseStore } from '../src/host/case-store.ts';
import { createRequirementStore } from '../extensions/business-plugins/requirements-elaboration/storage/store.ts';
import { createDecisionFeedbackFeature } from '../src/host/decision-feedback-routes.ts';
import type { FeedbackSource } from '../src/host/decision-feedback-types.ts';

const configuration: ProjectConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'https://example.invalid' };
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'feedback-host-')), dataRoot = path.join(root, 'data');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  const cases = new CaseStore({ dataRoot }); await cases.init();
  const project = await projects.create({ name: '合成反馈项目', configuration }), original = await projects.createTask(project.id, { name: '原作者任务' });
  await projects.saveDraft(project.id, original.id, '原草稿');
  const source: FeedbackSource = { sourceProjectId: project.id, boardItemId: randomUUID(), boardTaskId: randomUUID(), item: { title: '合成建议', rationale: '保持未知' }, task: { title: '尚未执行', status: 'todo' }, feedbackRevision: null, latestFeedbackRevisionId: null, report: null };
  const requirements = createRequirementStore(path.join(dataRoot, 'requirement-instances'));
  const reply = { value: '条件不同，旧经验不足以支持本轮结论。' };
  const feature = createDecisionFeedbackFeature({ dataRoot, projects, cases, requirements, readSource: (taskId, revisionId) => { assert.equal(taskId, source.boardTaskId); if (revisionId) throw new Error('revision_not_found'); return structuredClone(source); }, readReply: async (_projectId, _taskId, selection) => { assert.equal(selection.messageId, 'native-message'); return { ...selection, text: reply.value }; }, assertActive: async id => { if ((await projects.get(id)).archivedAt) throw new Error('project_archived'); }, mutate: async operation => await operation() });
  feature.init(); t.after(async () => { feature.close(); cases.close(); await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const call = async (method: string, route: string, input?: unknown) => {
    const result = await feature.handle({ method, pathname: '/api/decision-feedback' + route, input }); assert.ok(result); return result;
  };
  return { root, dataRoot, projects, cases, project, original, source, requirements, feature, call, reply };
}

test('feedback preview is read-only and creates one new ordinary draft without altering original work', async t => {
  const { call, feature, source, projects, project, original } = await fixture(t);
  const previewResult = await call('POST', '/preview', { boardTaskId: source.boardTaskId, feedbackRevisionId: null, question: '尚无反馈，也可以普通提问吗？', taskName: '普通复盘', materials: [{ id: 'advice', kind: 'recommendation', mode: 'full' }] });
  assert.equal(previewResult.status, 200);
  const preview = (previewResult.body as any).preview; assert.equal((await projects.get(project.id)).tasks.length, 1);
  const operationId = randomUUID(), created = await call('POST', '/handoffs', { operationId, previewId: preview.previewId });
  assert.equal(created.status, 201); const { handoff, task } = created.body as any;
  assert.notEqual(task.id, original.id); assert.equal(task.draft, '尚无反馈，也可以普通提问吗？'); assert.equal(task.sessionFile, undefined);
  assert.equal((await projects.getTask(project.id, original.id)).draft, '原草稿');
  await projects.saveDraft(project.id, task.id, '后来编辑');
  const retry = await call('POST', '/handoffs', { operationId, previewId: preview.previewId }); assert.equal((retry.body as any).task.draft, '后来编辑'); assert.equal((await projects.get(project.id)).tasks.length, 2);
  const identity = await feature.requestIdentity(project.id, task.id, { handoffId: handoff.handoffId, selectedMaterialIds: ['advice'] });
  const prepared = await feature.prepareFeedbackContext(project.id, task.id, { handoffId: handoff.handoffId, selectedMaterialIds: ['advice'] }, randomUUID());
  assert.match(prepared.text, /合成建议/); assert.deepEqual(prepared.fingerprint, identity);
  const cleared = await feature.prepareFeedbackContext(project.id, task.id, { handoffId: handoff.handoffId, selectedMaterialIds: [] }, randomUUID());
  assert.equal(cleared.text, ''); assert.deepEqual(cleared.receipt?.materials, []); assert.equal(cleared.receipt?.applicability, '');
});

test('selected UTF8 file bytes stay fixed, changes need preview, and missing reference has no hidden body', async t => {
  const { call, projects, project, source, feature } = await fixture(t);
  const file = await projects.upload({ projectId: project.id, name: '反馈.md', directory: '020_clean', bytes: Buffer.from('\ufeff正面\n😀未知\r\n') });
  const input = { boardTaskId: source.boardTaskId, feedbackRevisionId: null, taskName: '文件复盘', question: '条件是什么？', materials: [{ id: 'file', kind: 'file', mode: 'full', relativePath: file.path }] };
  const first = await call('POST', '/preview', input), preview = (first.body as any).preview;
  assert.equal(preview.materials[0].body, '\ufeff正面\n😀未知\r\n');
  await fs.writeFile(path.join(project.rootPath, file.path), '已变更');
  const changed = await call('POST', '/handoffs', { operationId: randomUUID(), previewId: preview.previewId }); assert.equal(changed.status, 409); assert.equal((changed.body as any).code, 'feedback_source_changed');
  const next = (await call('POST', '/preview', input)).body as any;
  const saved = (await call('POST', '/handoffs', { operationId: randomUUID(), previewId: next.preview.previewId })).body as any;
  const identity = await feature.requestIdentity(project.id, saved.task.id, { handoffId: saved.handoff.handoffId, selectedMaterialIds: ['file'] });
  await fs.writeFile(path.join(project.rootPath, file.path), '发送前又变化');
  assert.deepEqual(await feature.requestIdentity(project.id, saved.task.id, { handoffId: saved.handoff.handoffId, selectedMaterialIds: ['file'] }), identity);
  await assert.rejects(feature.prepareFeedbackContext(project.id, saved.task.id, { handoffId: saved.handoff.handoffId, selectedMaterialIds: ['file'] }, randomUUID()), /feedback_source_changed/);
  const missing = await call('POST', '/preview', { ...input, materials: [{ id: 'missing', kind: 'file', mode: 'reference', relativePath: '020_clean/not-present.csv' }] });
  assert.equal(missing.status, 200); assert.equal((missing.body as any).preview.materials[0].body, null); assert.equal((missing.body as any).preview.materials[0].availability, 'missing');
});

test('explicit file and requirement actions retain fixed sources, deduplicate and preserve editable background', async t => {
  const { call, project, projects, source, requirements } = await fixture(t);
  const preview = ((await call('POST', '/preview', { boardTaskId: source.boardTaskId, feedbackRevisionId: null, question: '普通复盘', taskName: '下一轮', materials: [{ id: 'advice', kind: 'recommendation', mode: 'full' }] })).body as any).preview;
  const { handoff, task } = (await call('POST', '/handoffs', { operationId: randomUUID(), previewId: preview.previewId })).body as any;
  const fileCommand = { operationId: randomUUID(), selectedMaterialIds: ['advice'], caseSelection: null };
  const savedFile = await call('POST', `/handoffs/${handoff.handoffId}/files`, fileCommand);
  assert.equal(savedFile.status, 201); const file = (savedFile.body as any).file; assert.match(file.path, /^020_clean\/feedback-/);
  const retry = await call('POST', `/handoffs/${handoff.handoffId}/files`, fileCommand); assert.deepEqual((retry.body as any).file, file);
  assert.equal((await projects.get(project.id)).uploads.filter(item => item.path === file.path).length, 1);
  const command = { operationId: randomUUID(), title: '下一轮问题', scene: 'topic', caseSelection: null, sourceSelection: { kind: 'reply', projectId: project.id, taskId: task.id, sessionId: 'native-session', messageId: 'native-message', start: 0, end: 5, expectedTextSha256: createHash('sha256').update('条件不同，旧经验不足以支持本轮结论。').digest('hex') }, background: '用户编辑的新背景' };
  const created = await call('POST', `/handoffs/${handoff.handoffId}/requirements`, command); assert.equal(created.status, 201);
  const { instanceId, instance } = created.body as any;
  assert.equal(instance.context.background, '用户编辑的新背景'); assert.deepEqual(instance.facts, []); assert.equal(instance.snapshot, undefined);
  requirements.save({ ...instance, context: { ...instance.context, background: '后续编辑' } });
  const replay = await call('POST', `/handoffs/${handoff.handoffId}/requirements`, command); assert.equal((replay.body as any).instance.context.background, '后续编辑');
  const fixed = await call('GET', `/requirements/${instanceId}/source`); assert.equal(fixed.status, 200); assert.equal((fixed.body as any).sourceMaterial.body, '条件不同，');
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/requirements`, { ...command, title: '异载荷' })).status, 409);
});

test('requirement reply creation rejects missing preview identity and changed content under the same native ID', async t => {
  const { call, source, project, reply } = await fixture(t);
  const preview = ((await call('POST', '/preview', { boardTaskId: source.boardTaskId, feedbackRevisionId: null, question: '复盘', taskName: '报告来源', materials: [] })).body as any).preview;
  const { handoff, task } = (await call('POST', '/handoffs', { operationId: randomUUID(), previewId: preview.previewId })).body as any;
  const selection = { kind: 'reply', projectId: project.id, taskId: task.id, sessionId: 'native-session', messageId: 'native-message' };
  const missing = await call('POST', `/handoffs/${handoff.handoffId}/requirements`, { operationId: randomUUID(), title: '下一轮', scene: 'topic', caseSelection: null, sourceSelection: selection });
  assert.equal(missing.status, 409); assert.equal((missing.body as any).code, 'feedback_source_preview_required');
  const expectedTextSha256 = createHash('sha256').update(reply.value).digest('hex'); reply.value = '同一个native消息被外部修改';
  const changed = await call('POST', `/handoffs/${handoff.handoffId}/requirements`, { operationId: randomUUID(), title: '下一轮', scene: 'topic', caseSelection: null, sourceSelection: { ...selection, expectedTextSha256 } });
  assert.equal(changed.status, 409); assert.equal((changed.body as any).code, 'feedback_source_changed');
});

test('lost target acknowledgement is queried and resumed explicitly with the same task and preserved later draft', async t => {
  const { call, source, projects, project } = await fixture(t);
  const preview = ((await call('POST', '/preview', { boardTaskId: source.boardTaskId, feedbackRevisionId: null, question: '初始问题', taskName: '中断创建', materials: [] })).body as any).preview;
  const original = projects.createTaskWithFeedback.bind(projects);
  const hook = t.mock.method(projects, 'createTaskWithFeedback', async (...args: Parameters<ProjectStore['createTaskWithFeedback']>) => { await original(...args); throw new Error('lost_acknowledgement'); });
  const command = { operationId: randomUUID(), previewId: preview.previewId };
  const interrupted = await call('POST', '/handoffs', command); assert.equal(interrupted.status, 409); hook.mock.restore();
  const query = (await call('GET', `/operations/${command.operationId}`)).body as any;
  assert.equal(query.operation.phase, 'needs_review'); assert.equal(query.observations.task.exists, true); assert.equal(query.observations.task.originMatches, true);
  const taskId = query.operation.planned.taskId; await projects.saveDraft(project.id, taskId, '中断后用户继续写的内容');
  assert.equal((await call('POST', '/handoffs', command)).status, 409); assert.equal((await projects.get(project.id)).tasks.length, 2);
  const recovered = await call('POST', `/operations/${command.operationId}/continue`, { requestHash: query.operation.requestHash }); assert.equal(recovered.status, 200); assert.equal((recovered.body as any).task.id, taskId); assert.equal((recovered.body as any).task.draft, '中断后用户继续写的内容');
});

test('feedback source guards reject unsafe files, UTF16 split ranges, cross-owner delivery and archived writes', async t => {
  const { call, source, project, projects, feature } = await fixture(t);
  const file = await projects.upload({ projectId: project.id, name: 'emoji.txt', bytes: Buffer.from('A😀B'), directory: '020_clean' });
  const input = { boardTaskId: source.boardTaskId, feedbackRevisionId: null, question: '问题', taskName: '边界', materials: [{ id: 'file', kind: 'file', mode: 'excerpt', relativePath: file.path, start: 1, end: 2 }] };
  assert.equal((await call('POST', '/preview', input)).status, 400);
  assert.equal((await call('POST', '/preview', { ...input, materials: [{ id: 'raw', kind: 'file', mode: 'reference', relativePath: '010_draw/x.csv' }] })).status, 400);
  const outside = path.join(project.rootPath, 'outside'); await fs.writeFile(outside, 'not selected'); await fs.symlink(outside, path.join(project.rootPath, '020_clean/unsafe.txt'));
  assert.equal((await call('POST', '/preview', { ...input, materials: [{ id: 'unsafe', kind: 'file', mode: 'reference', relativePath: '020_clean/unsafe.txt' }] })).status, 400);
  const preview = ((await call('POST', '/preview', { ...input, materials: [] })).body as any).preview;
  const saved = (await call('POST', '/handoffs', { operationId: randomUUID(), previewId: preview.previewId })).body as any;
  const other = await projects.createTask(project.id, { name: '普通其他任务' });
  await assert.rejects(feature.requestIdentity(project.id, other.id, { handoffId: saved.handoff.handoffId, selectedMaterialIds: [] }), /feedback_owner_mismatch/);
  await projects.archive(project.id);
  assert.equal((await call('POST', `/handoffs/${saved.handoff.handoffId}/files`, { operationId: randomUUID(), selectedMaterialIds: [], caseSelection: null })).status, 400);
  const archived = await call('POST', '/handoffs', { operationId: randomUUID(), previewId: preview.previewId }); assert.equal(archived.status, 409); assert.equal((archived.body as any).code, 'project_archived');
});

test('later file and requirement actions select their own current Case without changing the original handoff', async t => {
  const { call, source, project, projects, cases, reply } = await fixture(t);
  cases.initialize(); const record = cases.createCase({ operationId: randomUUID(), title: '明确的Case' });
  const linked = cases.linkProject({ operationId: randomUUID(), caseId: record.id, expectedRevision: record.revision, projectId: project.id });
  const originalSelection = { caseId: record.id, expectedRevision: linked.case.revision };
  const preview = ((await call('POST', '/preview', { boardTaskId: source.boardTaskId, feedbackRevisionId: null, question: '普通复盘', taskName: '选定Case', caseSelection: originalSelection, materials: [{ id: 'advice', kind: 'recommendation', mode: 'full' }] })).body as any).preview;
  const { handoff, task } = (await call('POST', '/handoffs', { operationId: randomUUID(), previewId: preview.previewId })).body as any;
  const updated = (await call('POST', `/handoffs/${handoff.handoffId}/case-judgement`, { operationId: randomUUID(), expectedRevision: originalSelection.expectedRevision, caseId: record.id, fields: { judgement: '复盘后明确的新判断' } })).body as any;
  const currentSelection = { caseId: record.id, expectedRevision: updated.case.revision };
  const fileCommand = { operationId: randomUUID(), selectedMaterialIds: ['advice'], caseSelection: null };
  const file = await call('POST', `/handoffs/${handoff.handoffId}/files`, fileCommand); assert.equal(file.status, 201);
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/files`, { ...fileCommand, operationId: randomUUID(), caseSelection: currentSelection })).status, 201);
  const requirement = { operationId: randomUUID(), title: '新需求', scene: 'topic', caseSelection: currentSelection, sourceSelection: { kind: 'reply', projectId: project.id, taskId: task.id, sessionId: 'native-session', messageId: 'native-message', expectedTextSha256: createHash('sha256').update(reply.value).digest('hex') } };
  const created = await call('POST', `/handoffs/${handoff.handoffId}/requirements`, requirement); assert.equal(created.status, 201);
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/requirements`, { ...requirement, operationId: randomUUID(), caseSelection: null })).status, 201);
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/files`, { ...fileCommand, caseSelection: currentSelection })).status, 409);
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/requirements`, { ...requirement, caseSelection: null })).status, 409);
  const unrelated = cases.createCase({ operationId: randomUUID(), title: '未关联Case' });
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/files`, { ...fileCommand, operationId: randomUUID(), caseSelection: { caseId: unrelated.id, expectedRevision: unrelated.revision } })).status, 409);
  cases.closeCase({ operationId: randomUUID(), caseId: record.id, expectedRevision: currentSelection.expectedRevision, closeReason: '结束' });
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/requirements`, { ...requirement, operationId: randomUUID(), caseSelection: { caseId: record.id, expectedRevision: cases.getCase(record.id).revision } })).status, 409);
  assert.deepEqual(((await call('GET', `/handoffs/${handoff.handoffId}`)).body as any).handoff.caseSelection, originalSelection);
  await projects.archive(project.id);
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/files`, fileCommand)).status, 201);
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/requirements`, requirement)).status, 201);
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/files`, { ...fileCommand, operationId: randomUUID() })).status, 409);
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/requirements`, { ...requirement, operationId: randomUUID(), caseSelection: null })).status, 409);
});

test('unknown requirement creation resumes its explicit no-Case action and preserves later edits despite old handoff Case advancing', async t => {
  const { call, source, project, cases, requirements, reply } = await fixture(t);
  cases.initialize(); const record = cases.createCase({ operationId: randomUUID(), title: '历史Case' });
  const linked = cases.linkProject({ operationId: randomUUID(), caseId: record.id, expectedRevision: record.revision, projectId: project.id });
  const originalSelection = { caseId: record.id, expectedRevision: linked.case.revision };
  const preview = ((await call('POST', '/preview', { boardTaskId: source.boardTaskId, feedbackRevisionId: null, question: '后续问题', taskName: '恢复测试', caseSelection: originalSelection, materials: [] })).body as any).preview;
  const { handoff, task } = (await call('POST', '/handoffs', { operationId: randomUUID(), previewId: preview.previewId })).body as any;
  cases.updateCase({ operationId: randomUUID(), caseId: record.id, expectedRevision: linked.case.revision, judgement: '已推进到新判断' });
  const create = requirements.createFromFeedback.bind(requirements);
  const hook = t.mock.method(requirements, 'createFromFeedback', (...args: Parameters<typeof requirements.createFromFeedback>) => { create(...args); throw new Error('lost_acknowledgement'); });
  const command = { operationId: randomUUID(), title: '恢复原需求', scene: 'topic', caseSelection: null, sourceSelection: { kind: 'reply', projectId: project.id, taskId: task.id, sessionId: 'native-session', messageId: 'native-message', expectedTextSha256: createHash('sha256').update(reply.value).digest('hex') } };
  const interrupted = await call('POST', `/handoffs/${handoff.handoffId}/requirements`, command); assert.equal(interrupted.status, 409); hook.mock.restore();
  const query = (await call('GET', `/operations/${command.operationId}`)).body as any;
  assert.equal(query.operation.phase, 'needs_review'); assert.equal(query.operation.request.caseSelection, null); assert.equal(query.observations.requirement.originMatches, true);
  const existing = requirements.read(query.operation.planned.instanceId); requirements.save({ ...existing, context: { ...existing.context, background: '中断后继续编辑的背景' } });
  cases.closeCase({ operationId: randomUUID(), caseId: record.id, expectedRevision: cases.getCase(record.id).revision, closeReason: '历史Case结束' });
  const recovered = await call('POST', `/operations/${command.operationId}/continue`, { requestHash: query.operation.requestHash }); assert.equal(recovered.status, 200); assert.equal((recovered.body as any).instance.instance.id, existing.instance.id); assert.equal((recovered.body as any).instance.context.background, '中断后继续编辑的背景');
  assert.deepEqual(((await call('GET', `/handoffs/${handoff.handoffId}`)).body as any).handoff.caseSelection, originalSelection);
});

test('feedback judgement uses current explicit Case revision and rechecks source project and association', async t => {
  const { call, source, projects, project, cases } = await fixture(t);
  cases.initialize(); const record = cases.createCase({ operationId: randomUUID(), title: '同项目Case' });
  const linked = cases.linkProject({ operationId: randomUUID(), caseId: record.id, expectedRevision: record.revision, projectId: project.id });
  const preview = ((await call('POST', '/preview', { boardTaskId: source.boardTaskId, feedbackRevisionId: null, question: '复盘', taskName: '普通任务', materials: [] })).body as any).preview;
  const { handoff } = (await call('POST', '/handoffs', { operationId: randomUUID(), previewId: preview.previewId })).body as any;
  const input = { operationId: randomUUID(), expectedRevision: linked.case.revision, caseId: record.id, fields: { judgement: '用户明确确认的新判断' } };
  const saved = await call('POST', `/handoffs/${handoff.handoffId}/case-judgement`, input); assert.equal(saved.status, 200); assert.equal((saved.body as any).case.judgement, '用户明确确认的新判断');
  const retried = await call('POST', `/handoffs/${handoff.handoffId}/case-judgement`, input); assert.equal(retried.status, 200); assert.deepEqual(retried.body, saved.body);
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/case-judgement`, { ...input, fields: { judgement: '相同意图不同内容' } })).status, 409);
  const unicode = await call('POST', `/handoffs/${handoff.handoffId}/case-judgement`, { operationId: randomUUID(), expectedRevision: cases.getCase(record.id).revision, caseId: record.id, fields: { description: '😀'.repeat(15000) } }); assert.equal(unicode.status, 200);
  const latest = cases.getCase(record.id); cases.unlinkProject({ operationId: randomUUID(), caseId: record.id, expectedRevision: latest.revision, projectId: project.id });
  const unlinked = await call('POST', `/handoffs/${handoff.handoffId}/case-judgement`, { ...input, operationId: randomUUID(), expectedRevision: cases.getCase(record.id).revision }); assert.equal(unlinked.status, 409); assert.equal((unlinked.body as any).code, 'project_not_linked');
  const relinked = cases.linkProject({ operationId: randomUUID(), caseId: record.id, expectedRevision: cases.getCase(record.id).revision, projectId: project.id });
  await projects.archive(project.id);
  const archived = await call('POST', `/handoffs/${handoff.handoffId}/case-judgement`, { ...input, operationId: randomUUID(), expectedRevision: relinked.case.revision }); assert.equal(archived.status, 409); assert.equal(cases.getCase(record.id).judgement, '用户明确确认的新判断');
  assert.equal((await call('POST', `/handoffs/${handoff.handoffId}/case-judgement`, input)).status, 200);
});
