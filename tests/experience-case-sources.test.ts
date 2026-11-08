import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { createCaseSourcesService } from '../src/host/case-sources-service.ts';

async function fixture(t: { after(fn: () => void): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-m6-case-sources-'));
  const cases = new CaseStore({ dataRoot: root }); await cases.initialize(); t.after(() => cases.close());
  const record = cases.createCase({ operationId: randomUUID(), title: '旧事项的原判断' });
  const projectId = randomUUID(); cases.linkProject({ operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: 1 });
  const origin = { actorKind: 'agent' as const, projectId, taskId: randomUUID(), requestId: randomUUID(), sessionId: 'synthetic-m6-session', toolCallId: 'seed' };
  const first = cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId: cases.getStatus().storeId!, caseId: record.id, expectedRevision: 0, kind: 'strategy', payload: { title: '先核执行', proposal: 'SYNTHETIC_EXACT_V1' } }, origin);
  const target = { type: 'case-decision' as const, caseStoreId: first.caseStoreId, caseId: first.caseId, recordId: first.recordId, revision: 1 };
  const choice = cases.chooseStrategy({ operationId: randomUUID(), caseStoreId: first.caseStoreId, caseId: record.id, strategyRef: target, choice: 'gather_evidence', reason: '仅补证，不代表执行', expectedPreviousChoiceId: null });
  const service = createCaseSourcesService({ cases, projects: { get: async () => { throw new Error('source-project-must-not-own-global-read'); }, getTask: async () => { throw new Error('unused'); } }, assertActive() {} });
  return { root, cases, record, origin, first, target, choice, service };
}

test('EL01/02 ended Cases and precise human choices are discoverable without reading source-project state or starting a session', async t => {
  const f = await fixture(t), core = f.cases.getCase(f.record.id);
  f.cases.closeCase({ operationId: randomUUID(), caseId: core.id, expectedRevision: core.revision, closeReason: '结束后仍可借鉴' });
  const before = f.cases.getEvents('case', core.id);
  const result = await f.service.find({ query: '旧事项', pageSize: 20 });
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.find((item: any) => item.target.type === 'case-decision')?.target, f.target);
  assert.equal(result.items.some((item: any) => item.target.choiceId === f.choice.choiceId), true);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_EXACT_V1'), false);
  assert.deepEqual(f.cases.getEvents('case', core.id), before);
});

test('EL02 exact old card and original choice remain separate after a newer draft; forged source store is rejected', async t => {
  const f = await fixture(t);
  f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId: f.first.caseStoreId, caseId: f.record.id, recordId: f.first.recordId, expectedRevision: 1, kind: 'strategy', payload: { title: '新稿', proposal: 'SYNTHETIC_V2_MUST_NOT_REPLACE_V1' } }, f.origin);
  const original = await f.service.read({ target: f.target });
  assert.ok(original.text.includes('SYNTHETIC_EXACT_V1'));
  assert.equal(original.text.includes('SYNTHETIC_V2_MUST_NOT_REPLACE_V1'), false);
  const choice = await f.service.read({ target: { type: 'case-choice', caseStoreId: f.first.caseStoreId, caseId: f.record.id, choiceId: f.choice.choiceId } });
  assert.ok(choice.text.includes('gather_evidence')); assert.ok(choice.text.includes('仅补证，不代表执行'));
  await assert.rejects(f.service.read({ target: { ...f.target, caseStoreId: randomUUID() } }), /store_mismatch/);
});

test('EL02 card sourceIndex resolves the original source reader and preserves UNKNOWN when that exact source is unavailable', async t => {
  const { createCaseDecisionService } = await import('../src/host/case-decision-service.ts');
  const f = await fixture(t);
  const draft = f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId: f.first.caseStoreId, caseId: f.record.id, expectedRevision: 0, kind: 'hypothesis', payload: { title: '缺失原发布来源', statement: '卡片不能代替来源' }, references: [{ relation: 'background', note: null, target: { type: 'rap', instanceId: 'req-missing-synthetic', version: '1.0.0' } }] }, f.origin);
  const { ProjectStore } = await import('../src/host/project-store.ts');
  const projects = new ProjectStore({ dataRoot: path.join(f.root, 'project-data'), projectsRoot: path.join(f.root, 'projects') }); await projects.init();
  t.after(() => projects.close());
  const decisions = createCaseDecisionService({ cases: f.cases, projects, assertActive() {}, mutate: async fn => fn() });
  const service = createCaseSourcesService({ cases: f.cases, projects, assertActive() {}, readReference: decisions.source });
  const result = await service.read({ target: { ...f.target, recordId: draft.recordId }, part: 'reference', sourceIndex: 0 });
  assert.equal(result.details.status, 'unknown'); assert.ok(result.text.includes('UNKNOWN'));
  await assert.rejects(service.read({ target: f.target, part: 'reference', sourceIndex: 9 }), /source_index/);
});

test('EL09 stale or cancelled Agent calls cannot read cross-Case bodies through the public service', async t => {
  const f = await fixture(t), controller = new AbortController();
  const context = { projectId: randomUUID(), taskId: randomUUID(), signal: controller.signal, assertCurrent() { throw new Error('synthetic_stale_sdk_call'); } };
  await assert.rejects(f.service.findForAgent({}, context), /synthetic_stale_sdk_call/);
  controller.abort();
  await assert.rejects(f.service.readForAgent({ target: f.target }, { ...context, assertCurrent() {} }), { name: 'AbortError' });
});

test('EL02/10 exact source callback keeps full original JSON, UTF-16 excerpts and complete choice strategy identity', async t => {
  const f = await fixture(t);
  const full = await f.service.readPersonalSource(f.target, { audience: 'human' });
  assert.deepEqual(JSON.parse(full.text!), f.first);
  const selected = await f.service.readPersonalSource({ ...f.target, excerpt: { start: 0, end: 15 } }, { audience: 'agent' });
  assert.equal(selected.text, full.text!.slice(0, 15)); assert.equal(selected.sha256, full.sha256);
  const choice = await f.service.readPersonalSource({ type: 'case-choice', caseStoreId: f.first.caseStoreId, caseId: f.record.id, choiceId: f.choice.choiceId });
  assert.deepEqual(choice.strategyRef, f.target);
  assert.deepEqual(JSON.parse(choice.text!), f.choice);
});

test('EL02 directory cursors bind query and original-table changes; archive filters discovery but never exact history', async t => {
  const f = await fixture(t);
  const page = await f.service.find({ pageSize: 1 }); assert.ok(page.continuation);
  await assert.rejects(f.service.find({ query: 'changed query', pageSize: 1, continuation: page.continuation }), /continuation_changed/);
  await assert.rejects(f.service.find({ pageSize: 51 }), /invalid_case_sources_page/);
  await assert.rejects(f.service.find({ query: '甲'.repeat(201) }), /invalid_case_sources_page/);
  const archived = f.cases.reviseDecisionByUser({ operationId: randomUUID(), caseStoreId: f.first.caseStoreId, caseId: f.record.id, recordId: f.first.recordId, expectedRevision: 1, action: 'archive' });
  await assert.rejects(f.service.find({ pageSize: 1, continuation: page.continuation }), /continuation_changed/);
  assert.equal((await f.service.find({})).items.filter(item => item.target.type === 'case-decision').length, 0);
  const visible = (await f.service.find({ includeArchived: true })).items.find(item => item.target.type === 'case-decision');
  assert.equal(visible?.target.type === 'case-decision' && visible.target.revision, archived.revision);
  assert.ok((await f.service.read({ target: f.target })).text.includes('SYNTHETIC_EXACT_V1'));
  await assert.rejects(f.service.read({ target: { type: 'case-choice', caseStoreId: f.first.caseStoreId, caseId: f.record.id, choiceId: f.choice.choiceId }, sourceIndex: 0 }), /invalid_case_sources_read/);
});

test('EL02 model-visible content includes exact range and usable continuation while long card pages remain bounded', async t => {
  const f = await fixture(t);
  const revision = f.cases.saveDecisionDraft({ operationId: randomUUID(), caseStoreId: f.first.caseStoreId, caseId: f.record.id, expectedRevision: 0, kind: 'strategy', payload: { title: '长原稿', proposal: '甲😀'.repeat(3000) }, references: [{ relation: 'background', note: '乙'.repeat(16000), target: { type: 'rap', instanceId: 'req-long-source', version: '1.0.0' } }] }, f.origin);
  const result = await f.service.read({ target: { ...f.target, recordId: revision.recordId } });
  assert.equal(result.details.partial, true); assert.ok(result.details.continuation);
  assert.ok(result.text.includes(result.details.continuation!));
  assert.ok(result.text.includes('UTF-16'));
  assert.ok(result.text.length <= 32768); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 256 * 1024);
  let page = result, body = '';
  do {
    body += page.text.split('\n').slice(2).join('\n');
    if (!page.details.continuation) break;
    page = await f.service.read({ target: { ...f.target, recordId: revision.recordId }, continuation: page.details.continuation });
    assert.ok(page.text.length <= 32768); assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 256 * 1024);
  } while (true);
  assert.deepEqual(JSON.parse(body), revision);
});

test('EL01/09 a real ordinary task without a Case can read global history, while its own archived project blocks later Agent reads', async t => {
  const { ProjectStore } = await import('../src/host/project-store.ts');
  const f = await fixture(t), projects = new ProjectStore({ dataRoot: path.join(f.root, 'current-project-data'), projectsRoot: path.join(f.root, 'current-projects') });
  await projects.init(); t.after(() => projects.close());
  const project = await projects.create({ name: '无Case的普通任务', configuration: { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } });
  const task = await projects.createTask(project.id, { name: '比较旧事项' }), controller = new AbortController();
  const service = createCaseSourcesService({ cases: f.cases, projects, assertActive(project) { if (project.archivedAt !== null) throw new Error('project_archived'); } });
  const context = { projectId: project.id, taskId: task.id, signal: controller.signal, assertCurrent() {} };
  const result = await service.findForAgent({}, context); assert.ok(result.text.includes(f.first.recordId));
  assert.ok((await service.readForAgent({ target: f.target }, context)).text.includes('SYNTHETIC_EXACT_V1'));
  await projects.archive(project.id);
  await assert.rejects(service.readForAgent({ target: f.target }, context), /project_archived/);
  assert.ok((await service.read({ target: f.target })).text.includes('SYNTHETIC_EXACT_V1'), 'human/global reads do not inherit current-task permissions');
});
