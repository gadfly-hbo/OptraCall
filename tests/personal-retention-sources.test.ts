import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';
import { createPersonalSourceReader } from '../src/host/personal-retention-sources.ts';

const evidenceRoot = path.resolve('.local/fourbase-modules/m3/implementation/sources/test-roots');
const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  await fs.mkdir(evidenceRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(evidenceRoot, 'sources-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  const enterprise = new EnterpriseMaterialsStore(projects.dataRoot), dataContext = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects });
  const board = createDecisionBoardStore({ root: path.join(root, 'board') }); await board.init();
  t.after(async () => { board.close(); await projects.close(); });
  const project = await projects.create({ name: '合成来源项目', configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  return { root, projects, enterprise, dataContext, board, project, read: createPersonalSourceReader({ enterprise, projects, dataContext, board }) };
}

test('PR05: exact enterprise source keeps the disabled old revision and validates UTF-16 excerpts', async t => {
  const { enterprise, read } = await fixture(t);
  const created = await enterprise.create({ title: '原条款', body: '甲😀乙旧条款' });
  const enabled = await enterprise.enable(created.material.id, created.material.version), revisionId = enabled.material.activeRevisionId!;
  const updated = await enterprise.update(created.material.id, enabled.material.version, { title: '新条款', body: '今天的新内容' });
  await enterprise.disable(created.material.id, updated.material.version);
  const ref = { type: 'enterprise' as const, storeId: created.storeId, materialId: created.material.id, revisionId };
  const whole = await read(ref);
  assert.equal(whole.text, '甲😀乙旧条款'); assert.equal(whole.title, '原条款'); assert.equal(whole.status, 'disabled'); assert.equal(whole.sha256, digest('甲😀乙旧条款'));
  assert.equal((await read({ ...ref, excerpt: { start: 1, end: 3 } })).text, '😀');
  await assert.rejects(read({ ...ref, excerpt: { start: 2, end: 3 } }), /invalid_personal_excerpt/);
  await assert.rejects(read({ ...ref, revisionId: randomUUID() }), /enterprise_revision_not_found/);
  await assert.rejects(read({ ...ref, storeId: randomUUID() }), /personal_source_store_mismatch/);
});

test('PR05: fixed report and attachment use M2 authority even when the working files change or a sibling evidence file is missing', async t => {
  const { projects, dataContext, project, root, read } = await fixture(t);
  const reportPath = '060_reports/result.md', attachmentPath = '020_clean/check.py', report = '# 旧报告😀\n', attachment = 'print(3)\n';
  await fs.writeFile(path.join(project.rootPath, reportPath), report); await fs.writeFile(path.join(project.rootPath, attachmentPath), attachment);
  const citationId = randomUUID();
  const saved = await dataContext.createCitation(project.id, { operationId: citationId, citationId, baseIndexRevision: 0, report: { path: reportPath, sha256: digest(report), bytes: Buffer.byteLength(report) }, attachments: [{ path: attachmentPath, sha256: digest(attachment), bytes: Buffer.byteLength(attachment) }], selections: [], conceptRefs: [], sapRefs: [], declarer: 'user', declaration: '合成固定稿' });
  await fs.writeFile(path.join(project.rootPath, reportPath), '今天同名新稿');
  const ref = { type: 'citation' as const, projectId: project.id, citationId, target: { type: 'report' as const } };
  assert.equal((await read(ref)).text, report);
  assert.equal((await read({ ...ref, target: { type: 'attachment', attachmentIndex: 0 } })).text, attachment);
  await projects.archive(project.id);
  assert.equal((await read(ref)).project?.archived, true);
  await fs.unlink(path.join(root, 'data', 'projects', project.id, 'data-context', saved.record.attachments[0].evidencePath));
  await assert.rejects(read(ref), { code: 'personal_source_missing' });
  assert.equal(await fs.readFile(path.join(project.rootPath, reportPath), 'utf8'), '今天同名新稿');
});

test('PR05/09: native assistant source checks the entire original reply hash before selecting an excerpt and never rewrites JSONL', async t => {
  const { projects, project, read } = await fixture(t), task = await projects.createTask(project.id, { name: '合成任务' });
  const sessionId = randomUUID(), messageId = 'selected-reply', file = path.join(task.sessionDirectory, 'native.jsonl'), text = '旧回复😀：效果未知。', timestamp = new Date().toISOString();
  const message = { role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions', provider: 'synthetic', model: 'synthetic', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
  const bytes = Buffer.from([{ type: 'session', version: 3, id: sessionId, timestamp, cwd: path.join(project.rootPath, '020_clean') }, { type: 'message', id: messageId, parentId: null, timestamp, message }].map(value => JSON.stringify(value)).join('\n') + '\n');
  await fs.writeFile(file, bytes, { mode: 0o600 });
  const ref = { type: 'native-reply' as const, projectId: project.id, taskId: task.id, sessionId, messageId, expectedTextSha256: digest(text) };
  assert.equal((await read(ref)).text, text);
  assert.equal((await read({ ...ref, excerpt: { start: 3, end: 5 } })).text, '😀');
  await assert.rejects(read({ ...ref, expectedTextSha256: digest('😀'), excerpt: { start: 3, end: 5 } }), /personal_source_text_changed/);
  const other = await projects.createTask(project.id, { name: '另一任务' });
  await assert.rejects(read({ ...ref, taskId: other.id }), /reply_not_found/);
  assert.deepEqual(await fs.readFile(file), bytes);
});

test('PR05: feedback source binds revision to its real Task → Item → Project and keeps the selected historical content', async t => {
  const { projects, project, board, read } = await fixture(t);
  const item = board.addManualItem({ projectId: project.id, title: '合成行动', rationale: '合成原因' }); board.decideItem(item.id, { status: 'adopted' });
  const task = board.addTask(item.id, { title: '合成试点' });
  const first = board.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '第一稿：效果未知', metricDelta: '未知', review: '范围有限', score: null, effect: 'unknown' });
  board.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: first.revisionId, adopted: true, outcome: '今天的新反馈', metricDelta: '未知', review: '后续材料', score: null, effect: 'unknown' });
  const ref = { type: 'feedback' as const, sourceProjectId: project.id, boardTaskId: task.id, feedbackRevisionId: first.revisionId };
  const evidence = await read(ref);
  assert.equal(JSON.parse(evidence.text!).outcome, '第一稿：效果未知');
  await projects.archive(project.id); assert.equal((await read(ref)).project?.archived, true);
  const otherTask = board.addTask(item.id, { title: '另一行动任务' });
  await assert.rejects(read({ ...ref, boardTaskId: otherTask.id }), /personal_source_feedback_mismatch/);
  await assert.rejects(read({ ...ref, sourceProjectId: randomUUID() }), /personal_source_project_mismatch/);
  await assert.rejects(read({ ...ref, feedbackRevisionId: randomUUID() }), /personal_source_feedback_missing/);
});

test('PR05: an attachment-only exact Enterprise revision exposes verified binary identity without inventing text or OCR', async t => {
  const { enterprise, read } = await fixture(t);
  const created = await enterprise.create({ title: '无文字原附件', body: '' });
  const attached = await enterprise.addFile(created.material.id, created.material.version, { name: 'synthetic.bin', base64: Buffer.from([0xff, 0x00, 0xfe]).toString('base64'), importText: false });
  const fixed = await enterprise.enable(created.material.id, attached.material.version), file = fixed.material.files[0];
  const ref = { type: 'enterprise' as const, storeId: created.storeId, materialId: created.material.id, revisionId: fixed.material.activeRevisionId! };
  const evidence = await read(ref);
  assert.equal(evidence.text, null); assert.deepEqual(evidence.attachment, { name: 'synthetic.bin', bytes: 3, sha256: file.sha256 });
  await assert.rejects(read({ ...ref, excerpt: { start: 0, end: 1 } }), /invalid_personal_excerpt/);
});

test('PR05: an unsupported attachment format is not exposed as prose merely because its bytes decode as UTF-8', async t => {
  const { enterprise, projects, project, board } = await fixture(t);
  // Current M2 writers reject PDF. This exercises the public reader port's
  // defensive format boundary, not a claim that PDF citation creation exists.
  const bytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
  const file = { originalPath: '060_reports/synthetic.pdf', evidencePath: 'citations/synthetic/attachment.pdf', bytes: bytes.length, sha256: digest(bytes) };
  const read = createPersonalSourceReader({ enterprise, projects, board, dataContext: { readCitationEvidence: async () => ({ file, bytes }) } });
  const ref = { type: 'citation' as const, projectId: project.id, citationId: randomUUID(), target: { type: 'attachment' as const, attachmentIndex: 0 } };
  const evidence = await read(ref);
  assert.equal(evidence.text, null); assert.equal(evidence.sha256, digest(bytes));
  assert.deepEqual(evidence.attachment, { name: 'synthetic.pdf', bytes: bytes.length, sha256: digest(bytes) });
  await assert.rejects(read({ ...ref, excerpt: { start: 0, end: 8 } }), /invalid_personal_excerpt/);
});
