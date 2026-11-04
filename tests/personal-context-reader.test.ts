import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EnterpriseMaterialsStore, enterpriseDraftSha256 } from '../src/host/enterprise-materials-store.ts';
import { PersonalRetentionStore } from '../src/host/personal-retention-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { AgentCandidateControls } from '../src/host/agent-candidate-controls.ts';
import { createAgentCandidateReader } from '../src/host/agent-candidate-reader.ts';
import { createPersonalContextReader } from '../src/host/personal-context-reader.ts';
import type { PersonalContextTarget } from '../src/host/personal-context-types.ts';
import { candidateToolName, type AgentCandidateDetails } from '../src/agent/agent-candidate.ts';
import { readSavedTaskReply } from '../src/host/project-history.ts';
import type { PersonalSourceRef } from '../src/host/personal-retention-types.ts';
import { createNativeSnapshotReadBudget } from '../src/host/native-session-snapshot.ts';

const evidence = path.resolve('.local/fourbase-modules/m4/implementation/reader');
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  await fs.mkdir(path.join(evidence, 'roots'), { recursive: true });
  const root = await fs.mkdtemp(path.join(evidence, 'roots', 'context-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const materials = new EnterpriseMaterialsStore(projects.dataRoot);
  const retention = new PersonalRetentionStore({ dataRoot: projects.dataRoot, materials, readSource: async ref => {
    if (ref.type !== 'native-reply') throw new Error('source_not_needed');
    const project = await projects.get(ref.projectId), task = await projects.getTask(ref.projectId, ref.taskId);
    const reply = await readSavedTaskReply(project, task, { sessionId: ref.sessionId, messageId: ref.messageId });
    return { ref, title: task.name, text: reply.text, sha256: createHash('sha256').update(reply.text).digest('hex'), status: 'available' };
  } });
  const controls = new AgentCandidateControls({ dataRoot: projects.dataRoot, readTarget: async ref => { await candidates.read(ref); } });
  const candidates = createAgentCandidateReader({ projects, controls });
  const reader = createPersonalContextReader({ projects, retention, controls });
  async function retain(title: string, body: string, scope = '', sourceRefs: PersonalSourceRef[] = []) {
    const created = await materials.create({ title, body, scope }), operationId = randomUUID();
    const result = await retention.retain(created.material.id, { operationId, expectedRevision: 0, target: { type: 'draft', expectedMaterialVersion: created.material.version, expectedDraftSha256: enterpriseDraftSha256(created.material.draft) }, metadata: { kind: 'knowledge', aliases: ['历史别名'], caution: '范围仍需判断', sourceRefs }, personalLabel: null });
    const target: PersonalContextTarget = { type: 'retained', storeId: created.storeId, materialId: created.material.id, decisionId: operationId, revisionId: result.decision!.contentRef!.revisionId, expectedBodySha256: result.decision!.bodySha256! };
    return { created, result, target };
  }
  return { root, projects, materials, retention, controls, candidates, reader, retain };
}

async function candidate(f: Awaited<ReturnType<typeof fixture>>, title = 'Agent合成经验', body = '未收藏也可读取的准确候选正文', sourceRefs: PersonalSourceRef[] = []) {
  const project = await f.projects.create({ name: '候选合成项目', configuration: { id: 'synthetic', revision: 1, name: '合成', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const task = await f.projects.createTask(project.id, { name: '候选合成任务' });
  const sessionId = randomUUID(), requestId = randomUUID(), timestamp = '2026-11-03T08:00:00.000Z';
  const details: AgentCandidateDetails = { schemaVersion: 1, type: 'optracall.agent-candidate', claim: 'agent-generated-unconfirmed', origin: { projectId: project.id, taskId: task.id, sessionId, requestId, toolCallId: 'candidate-call' }, createdAt: timestamp, content: { kind: 'experience', title, bodyMd: body, aliases: ['候选别名'], scope: '候选适用范围', caution: null }, sourceRefs };
  const lines = [
    { type: 'session', version: 3, id: sessionId, timestamp, cwd: path.join(project.rootPath, '020_clean') },
    { type: 'custom', id: 'started', parentId: null, timestamp, customType: 'optracall.run', data: { phase: 'started', requestId, sessionId, kind: 'prompt' } },
    { type: 'message', id: 'call', parentId: 'started', timestamp, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'candidate-call', name: candidateToolName, arguments: { content: details.content, sourceRefs } }] } },
    { type: 'message', id: 'result', parentId: 'call', timestamp, message: { role: 'toolResult', toolName: candidateToolName, toolCallId: 'candidate-call', details, content: [{ type: 'text', text: '已接受、待保存' }], isError: false, timestamp: Date.parse(timestamp) } },
    { type: 'custom', id: 'settled', parentId: 'result', timestamp, customType: 'optracall.run', data: { phase: 'settled', requestId, sessionId, outcome: 'completed' } },
  ];
  const file = path.join(task.sessionDirectory, 'origin_' + sessionId + '.jsonl');
  await fs.writeFile(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  const row = (await f.candidates.lookup()).rows.find(row => row.details?.content.title === title)!;
  assert.ok(row.ref);
  const target: PersonalContextTarget = { type: 'agent-candidate', candidate: row.ref };
  return { project, task, sessionId, file, lines, target, ref: row.ref };
}

test('RU04: reading an older exact retained decision never follows its material to the latest retained body', async t => {
  const f = await fixture(t), old = await f.retain('同名资料', '准确旧正文');
  const current = await f.materials.get(old.created.material.id);
  const updated = await f.materials.update(current.material.id, current.material.version, { body: '新稿不应替换旧引用' });
  await f.retention.retain(current.material.id, { operationId: randomUUID(), expectedRevision: old.result.item.revision, target: { type: 'draft', expectedMaterialVersion: updated.material.version, expectedDraftSha256: enterpriseDraftSha256(updated.material.draft) }, metadata: old.result.decision!.metadata, personalLabel: null });
  const provided = await f.reader.read({ target: old.target });
  assert.match(provided.text, /准确旧正文/);
  assert.doesNotMatch(provided.text, /新稿不应替换旧引用/);
});

test('RU03: find matches exact revision scope without preloading retained bodies or source evidence', async t => {
  const f = await fixture(t);
  await f.retain('旧门店口径', '目录不能提前交付的秘密正文', '华东试点');
  let bodyReads = 0;
  const read = f.materials.readRevision.bind(f.materials);
  t.mock.method(f.materials, 'readRevision', async (...args: Parameters<typeof f.materials.readRevision>) => { bodyReads++; return read(...args); });
  const found = await f.reader.find({ query: '华东' });
  assert.match(found.text, /旧门店口径/);
  assert.doesNotMatch(found.text, /秘密正文/);
  assert.equal(bodyReads, 0, 'catalog must use revision metadata, not readItem/readRevision');
  assert.equal((await f.reader.find({ query: '秘密正文' })).details.items.length, 0);
});

test('RU03/06: one combined catalog page lists unfavorited candidates and retained metadata, without candidate body delivery', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 21; i++) await f.retain(`人工资料${String(i).padStart(2, '0')}`, '不应出现在目录的正文');
  await candidate(f);
  const first = await f.reader.find();
  assert.equal(first.details.items.length, 20);
  assert.ok(first.details.continuation);
  assert.doesNotMatch(first.text, /不应出现在目录的正文|准确候选正文/);
  const next = await f.reader.find({ continuation: first.details.continuation });
  assert.equal(next.details.items.length, 2);
  assert.equal(next.details.continuation, null);
  assert.equal([...first.details.items, ...next.details.items].filter(item => item.target.type === 'agent-candidate').length, 1);
});

test('RU06: exact candidate consumption supplies latest independent correction, excludes automatically, then restores without favoriting', async t => {
  const f = await fixture(t), c = await candidate(f);
  const note1 = await f.controls.apply({ operationId: randomUUID(), target: c.ref, action: 'correct', note: '旧的独立意见' });
  const note2 = await f.controls.apply({ operationId: randomUUID(), target: c.ref, action: 'correct', note: '最新独立意见，不改候选原文' });
  const provided = await f.reader.read({ target: c.target });
  assert.match(provided.text, /准确候选正文/);
  assert.match(provided.text, /最新独立意见/);
  assert.doesNotMatch(provided.text, /旧的独立意见/);
  assert.equal(provided.details.items[0]?.governance.latestCorrectionOperationId, note2.event.operationId);
  await f.controls.apply({ operationId: randomUUID(), target: c.ref, action: 'exclude', note: null, expectedTargetRevision: note2.state.targetRevision });
  await assert.rejects(f.reader.read({ target: c.target }), { code: 'personal_context_excluded' });
  assert.equal((await f.reader.find()).details.items.length, 0);
  const state = await f.controls.readState(c.ref);
  await f.controls.apply({ operationId: randomUUID(), target: c.ref, action: 'restore', note: null, expectedTargetRevision: state.targetRevision });
  assert.match((await f.reader.read({ target: c.target, part: 'corrections' })).text, new RegExp(note1.event.note!));
  assert.equal((await f.reader.find()).details.items.length, 1);
});

test('RU08: disabled Enterprise material remains readable; archive is filtered only by find and explicitly available as history', async t => {
  const f = await fixture(t), retained = await f.retain('未启用的人工知识', '完整历史正文');
  const found = await f.reader.find();
  assert.equal(found.details.items[0]?.governance.enterpriseEnabled, false);
  await f.retention.archive(retained.created.material.id, { operationId: randomUUID(), expectedRevision: 1, personalLabel: null });
  assert.equal((await f.reader.find()).details.items.length, 0);
  assert.equal((await f.reader.find({ includeArchived: true })).details.items.length, 1);
  const read = await f.reader.read({ target: retained.target });
  assert.match(read.text, /完整历史正文/);
  assert.equal(read.details.items[0]?.governance.archived, true);
});

test('RU04/10: sourceIndex reads only the exact native source using the original reply text projection and preserves bytes/mtime', async t => {
  const f = await fixture(t), c = await candidate(f), timestamp = '2026-11-03T08:01:00.000Z';
  const reply = { type: 'message', id: 'source-reply', parentId: 'settled', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] } };
  const bytes = Buffer.from([...c.lines, reply].map(line => JSON.stringify(line)).join('\n') + '\n'); await fs.writeFile(c.file, bytes);
  const ref: PersonalSourceRef = { type: 'native-reply', projectId: c.project.id, taskId: c.task.id, sessionId: c.sessionId, messageId: 'source-reply', expectedTextSha256: createHash('sha256').update('第一段第二段').digest('hex') };
  const retained = await f.retain('含来源整理', '人的独立正文', '', [ref]), before = await fs.stat(c.file);
  const read = await f.reader.read({ target: retained.target, part: 'source', sourceIndex: 0 });
  assert.match(read.text, /第一段第二段/);
  assert.deepEqual(read.details.items[0]?.sourceRef, ref);
  await assert.rejects(f.reader.read({ target: retained.target, part: 'source', sourceIndex: 1 }), { code: 'personal_context_source_index_invalid' });
  assert.deepEqual(await fs.readFile(c.file), bytes); assert.equal((await fs.stat(c.file)).mtimeMs, before.mtimeMs);
});

test('RU03/05: bounded UTF16 reads resume without splitting emoji; human explicit whole selections fail instead of silently truncating', async t => {
  const f = await fixture(t), body = '甲'.repeat(32_500) + '😀' + '乙'.repeat(5000), retained = await f.retain('长的准确原文', body);
  const first = await f.reader.read({ target: retained.target });
  assert.ok(first.text.length <= 32_768); assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 256 * 1024);
  assert.equal(first.details.items[0]?.extent, 'fragment'); assert.ok(first.details.continuation);
  const second = await f.reader.read({ target: retained.target, continuation: first.details.continuation });
  assert.equal(second.details.items[0]?.range?.start, first.details.items[0]?.range?.end);
  assert.equal(second.details.continuation, null);
  const end = first.details.items[0]!.range!.end;
  assert.equal(body.slice(0, end) + body.slice(second.details.items[0]!.range!.start), body);
  await assert.rejects(f.reader.read({ target: retained.target, range: { start: 32_500, end: 32_501 } }), { code: 'invalid_personal_context_range' });
  await assert.rejects(f.reader.prepare([{ target: retained.target }]), error => {
    assert.equal((error as { code: string }).code, 'personal_context_selection_unavailable');
    assert.equal((error as { unavailableTargets: { index: number; code: string }[] }).unavailableTargets[0]?.code, 'personal_context_selection_too_large'); return true;
  });
  const excerpt = await f.reader.prepare([{ target: retained.target, range: { start: 32_500, end: 32_502 } }]);
  assert.match(excerpt.text, /😀/); assert.equal(excerpt.details.items[0]?.extent, 'fragment');
});

test('RU05/07: preparation shares one native budget and reports every unavailable exact selection without sending partial text', async t => {
  const f = await fixture(t), one = await candidate(f, '第一准确候选'), two = await candidate(f, '第二准确候选');
  const budget = createNativeSnapshotReadBudget(); budget.files = 1;
  await assert.rejects(f.reader.prepare([{ target: one.target }, { target: two.target }], { budget }), error => {
    const failure = error as { code: string; unavailableTargets: { index: number; target: PersonalContextTarget }[] };
    assert.equal(failure.code, 'personal_context_selection_unavailable'); assert.equal(failure.unavailableTargets.length, 1);
    assert.equal(failure.unavailableTargets[0]?.index, 1); assert.deepEqual(failure.unavailableTargets[0]?.target, two.target); return true;
  });
  assert.equal(budget.files, 0);
  await assert.rejects(f.reader.prepare(Array.from({ length: 9 }, () => ({ target: one.target }))), { code: 'invalid_personal_context_selections' });
});

test('RU05/10: cancellation before and during exact reading releases no late payload; changed hashes and query cursors never rebind', async t => {
  const f = await fixture(t), retained = await f.retain('取消和固定身份', '原文固定'), controller = new AbortController();
  controller.abort(); await assert.rejects(f.reader.read({ target: retained.target }, { signal: controller.signal }), { code: 'personal_context_cancelled' });
  const live = new AbortController(), original = f.retention.readItem.bind(f.retention);
  t.mock.method(f.retention, 'readItem', async (...args: Parameters<typeof f.retention.readItem>) => { const result = await original(...args); live.abort(); return result; });
  await assert.rejects(f.reader.read({ target: retained.target }, { signal: live.signal }), { code: 'personal_context_cancelled' });
  const wrong = { ...retained.target, expectedBodySha256: '0'.repeat(64) } as PersonalContextTarget;
  await assert.rejects(f.reader.read({ target: wrong }), { code: 'personal_context_target_changed' });
  await f.retain('另一份目录', '无关正文'); const page = await f.reader.find({ pageSize: 1 }); assert.ok(page.details.continuation);
  await assert.rejects(f.reader.find({ query: 'changed', continuation: page.details.continuation }), { code: 'personal_context_continuation_changed' });
  for (const pageSize of [0, 51, 1.5]) await assert.rejects(f.reader.find({ pageSize }), { code: 'invalid_personal_context_find' });
});

test('RU06/10: candidate governance changes invalidate a partially consumed catalog batch instead of silently skipping a later candidate', async t => {
  const f = await fixture(t); await candidate(f, '候选甲'); await candidate(f, '候选乙');
  const first = await f.reader.find({ pageSize: 1 }); assert.ok(first.details.continuation);
  const target = first.details.items[0]!.target; assert.equal(target.type, 'agent-candidate');
  if (target.type !== 'agent-candidate') throw new Error('unexpected retained fixture');
  await f.controls.apply({ operationId: randomUUID(), target: target.candidate, action: 'exclude', note: null, expectedTargetRevision: 0 });
  await assert.rejects(f.reader.find({ pageSize: 1, continuation: first.details.continuation }), { code: 'personal_context_continuation_changed' });
});

test('RU03/10: unreadable neighboring native files stay explicit partial/UNKNOWN when the exact original can still be provided', async t => {
  const f = await fixture(t), c = await candidate(f);
  await fs.writeFile(path.join(c.task.sessionDirectory, 'z-invalid.jsonl'), '{broken}\n');
  const read = await f.reader.read({ target: c.target });
  assert.match(read.text, /准确候选正文/);
  assert.equal(read.details.partial, true);
  assert.ok(read.details.issues.some(issue => issue.code === 'session_history_unavailable'));
  assert.match(read.text, /不完整|UNKNOWN/);
});

test('RU05: candidate resolution and native source share file/byte budgets rather than refreshing budget at sourceIndex', async t => {
  const f = await fixture(t), origin = await candidate(f, '来源所在任务');
  const reply = { type: 'message', id: 'original-reply', parentId: 'settled', timestamp: '2026-11-03T08:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '原生来源正文' }] } };
  await fs.writeFile(origin.file, [...origin.lines, reply].map(line => JSON.stringify(line)).join('\n') + '\n');
  const sourceRef: PersonalSourceRef = { type: 'native-reply', projectId: origin.project.id, taskId: origin.task.id, sessionId: origin.sessionId, messageId: 'original-reply', expectedTextSha256: createHash('sha256').update('原生来源正文').digest('hex') };
  const target = await candidate(f, '带原生依据的候选', '自己的正文', [sourceRef]);
  const files = createNativeSnapshotReadBudget(); files.files = 1;
  await assert.rejects(f.reader.read({ target: target.target, part: 'source', sourceIndex: 0 }, { budget: files }), { code: 'native_snapshot_budget_exhausted' });
  const bytes = createNativeSnapshotReadBudget(); bytes.bytes = (await fs.stat(target.file)).size + (await fs.stat(origin.file)).size - 1;
  await assert.rejects(f.reader.read({ target: target.target, part: 'source', sourceIndex: 0 }, { budget: bytes }), { code: 'native_snapshot_budget_exhausted' });
  const success = await f.reader.read({ target: target.target, part: 'source', sourceIndex: 0 });
  assert.match(success.text, /原生来源正文/); assert.deepEqual(success.details.items[0]?.sourceRef, sourceRef);
});

test('RU03: attachment-only retained content provides metadata and does not claim a full text delivery or OCR', async t => {
  const f = await fixture(t), empty = await f.materials.create({ title: '只有附件' });
  const attached = await f.materials.addFile(empty.material.id, empty.material.version, { name: 'scan.pdf', base64: Buffer.from('%PDF synthetic only').toString('base64') });
  const decisionId = randomUUID(), saved = await f.retention.retain(empty.material.id, { operationId: decisionId, expectedRevision: 0, target: { type: 'draft', expectedMaterialVersion: attached.material.version, expectedDraftSha256: enterpriseDraftSha256(attached.material.draft) }, metadata: { kind: 'knowledge', aliases: [], caution: null, sourceRefs: [] }, personalLabel: null });
  const target: PersonalContextTarget = { type: 'retained', storeId: empty.storeId, materialId: empty.material.id, decisionId, revisionId: saved.decision!.contentRef!.revisionId, expectedBodySha256: saved.decision!.bodySha256! };
  const read = await f.reader.read({ target });
  assert.equal(read.details.items[0]?.extent, 'metadata'); assert.equal(read.details.items[0]?.range, null);
  assert.match(read.text, /未.*OCR|没有.*文字|仅.*元信息/);
  await assert.rejects(f.reader.read({ target, range: { start: 0, end: 1 } }), { code: 'invalid_personal_context_range' });
});
