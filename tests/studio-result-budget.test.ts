import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { studioQuestionContext } from '../extensions/business-plugins/studio/contracts.ts';
import type { StudioWorkItem } from '../extensions/business-plugins/studio/contracts.ts';
import { createStudioFeature } from '../src/host/studio-host.ts';
import type { SemanticContextCallContext } from '../src/agent/semantic-context.ts';
const context = (): SemanticContextCallContext => ({ signal: new AbortController().signal, requestId: randomUUID(), sessionId: 'synthetic-budget', toolCallId: randomUUID(), assertCurrent() {} });
const answerContext = (item: StudioWorkItem) => createHash('sha256').update(studioQuestionContext(item)).digest('hex');
const parsed = (response: { content: { text: string }[] }) => { assert.ok(response.content[0]!.text.length < 30_000); return JSON.parse(response.content[0]!.text); };
async function fixture(t: any) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-result-budget-')), dataRoot = path.join(root, 'host');
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await projects.create({ name: '合成预算', configuration: { id: 'synthetic', revision: 1, name: '合成', provider: 'synthetic', model: 'synthetic', baseUrl: 'http://127.0.0.1:1' } }), task = await projects.createTask(project.id, { name: '建设' });
  const enterpriseMaterials = new EnterpriseMaterialsStore(dataRoot), material = await enterpriseMaterials.create({ title: '合成来源', body: 'Refund follows original order.' });
  const enabled = await enterpriseMaterials.enable(material.material.id, material.material.version), index = await enterpriseMaterials.referenceIndex({ readOnly: true }), revision = index.materials[0]!.revisions[0]!;
  const ref = { authority: 'enterprise' as const, id: material.material.id, version: revision.revisionId, sha256: revision.bodySha256, locator: index.storeId };
  let gate = Promise.resolve(); const mutate = <T>(operation: () => T | Promise<T>): Promise<T> => { const result = gate.then(operation); gate = result.then(() => {}, () => {}); return result; };
  const feature = createStudioFeature({ dataRoot, projects, enterpriseMaterials, mutate, readBody: async () => ({}), running: () => false, closing: () => false, readTaskReply: async () => { throw Error('No native/model in budget test'); } });
  const system = feature.store.create({ name: '合成体系', projectId: project.id, taskId: task.id, topicTitle: '销售退款', goal: '准确有界回执' });
  const port = feature.port(project.id, task.id), invoke = async (action: Parameters<typeof port>[0], payload: Record<string, unknown>, ctx = context()) => parsed(await port(action, { payload }, ctx));
  const assetInput = (body = '规则'.repeat(2_500)) => ({ kind: 'rule', title: '合成规则', body, scope: '合成范围', sources: [ref], checks: [{ name: 'synthetic', status: 'pass', detail: '工程示例，非业务真值' }], readyForPublication: true });
  return { root, dataRoot, projects, project, task, feature, system, ref, enterpriseMaterials, material, enabled, mutate, port, invoke, assetInput };
}
async function collectRead(f: Awaited<ReturnType<typeof fixture>>, payload: Record<string, unknown>) {
  let next = { ...payload, format: 'json-text' }, text = '', pages = 0;
  for (;;) {
    const value = await f.invoke('read', next); text += value.text; pages++;
    assert.equal(value.encoding, 'json-text'); assert.equal(value.range.unit, 'unicode-codepoints');
    if (!value.continuation) { assert.equal(value.range.end, value.range.total); assert.equal(createHash('sha256').update(text).digest('hex'), value.jsonSha256); return { value: JSON.parse(text), pages }; }
    next = value.continuation;
  }
}

test('six normal assets do not turn a committed topic update into a failed tool reply', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 6; i++) await f.invoke('save-asset', { ...f.assetInput(), title: `规则${i}` });
  const before = f.feature.store.get(f.system.id), value = await f.invoke('update-topic', { expectedRevision: before.revision, topic: { progress: '准确保存进度' } });
  assert.equal(value.system.revision, before.revision + 1); assert.equal(value.transport.complete, false);
  const recovered = await collectRead(f, value.transport.continuation.payload);
  assert.equal(recovered.value.progress, '准确保存进度'); assert.equal(f.feature.store.get(f.system.id).revision, before.revision + 1);
});

test('asset revision six returns its exact identity and recovers its original revision without accumulated history overflow', async t => {
  const f = await fixture(t); let value = await f.invoke('save-asset', f.assetInput()); const id = value.asset.id;
  for (let revision = 2; revision <= 6; revision++) value = await f.invoke('save-asset', { ...f.assetInput(`版本${revision}：` + '规则'.repeat(2_500)), assetId: id, expectedRevision: revision - 1 });
  assert.equal(value.asset.candidateRevision, 6); assert.equal(value.transport.complete, false); assert.equal(value.ref.version, '6');
  const recovered = await collectRead(f, value.transport.continuation.payload), exact = f.feature.store.get(f.system.id).assets[0]!.revisions[5];
  assert.deepEqual(recovered.value, exact); assert.equal(value.ref.sha256, exact.sha256); assert.equal(f.feature.store.get(f.system.id).assets[0]!.revisions.length, 6);
  const read = await f.invoke('read', { assetId: id, revision: 6 }); assert.ok(JSON.stringify(read).length < 30_000);
  const section = await f.invoke('read', { section: 'assets', start: 0, length: 1 }); assert.equal(section.transport.complete, false);
});

test('legal 32K SAP method returns the accurate candidate ref and recovers from the original source authority', async t => {
  const f = await fixture(t), payload = { title: '合成大方法', content: { conditions: 'c'.repeat(4_000), logic: 'l'.repeat(20_000), judgment: 'j'.repeat(4_000), limits: 'm'.repeat(4_000) }, sources: [f.ref] };
  const value = await f.invoke('save-sap-method', payload); assert.equal(value.status, 'saved-unpublished'); assert.equal(value.transport.complete, false); assert.equal(value.ref.locator, 'candidate');
  let start = 0, text = '';
  for (;;) { const page = await f.invoke('read-source', { ref: value.ref, start, length: 20_000 }); text += page.text; if (!page.continuation) break; start = page.continuation.start; }
  assert.deepEqual(JSON.parse(text).content, payload.content);
  assert.equal(f.feature.store.get(f.system.id).assetRefs.filter(ref => ref.id === value.ref.id).length, 1);
});

test('legal large publication preview is acknowledged once and fully recoverable through the same Store', async t => {
  const f = await fixture(t), asset = await f.invoke('save-asset', f.assetInput()), before = f.feature.store.get(f.system.id);
  const value = await f.invoke('prepare-publication', { assetIds: [asset.asset.id], summary: 'S'.repeat(16_000), scope: 'R'.repeat(16_000) });
  assert.equal(value.claim, 'prepared-not-approved'); assert.equal(value.transport.complete, false);
  const saved = f.feature.store.get(f.system.id); assert.equal(saved.publications.length, before.publications.length + 1);
  assert.equal(value.preview.id, saved.publications[0]!.preview.id); assert.equal(value.preview.fingerprint, saved.publications[0]!.preview.fingerprint);
  const recovered = await collectRead(f, value.transport.continuation.payload); assert.deepEqual(recovered.value, saved.publications[0]); assert.ok(recovered.pages > 1);
});

test('ordinary Agent updates preserve an answered question and cannot rewrite its meaning, owner or human answer', async t => {
  const f = await fixture(t), store = f.feature.store, original = { kind: 'question' as const, topicId: f.system.currentTopicId, title: '是否按原销售门店归属退款？', detail: '合成原问题', impact: '影响口径', nextStep: '等用户答复', sources: [f.ref], status: 'waiting' as const };
  const item = store.setWorkItem(f.system.id, original); store.answerWorkItem(f.system.id, item.id, '是，沿原销售门店归属。', answerContext(item));
  const value = await f.invoke('work-item', { ...original, id: item.id, nextStep: '按已答决定继续建设' });
  assert.equal(value.item.answer, '是，沿原销售门店归属。'); assert.equal(value.item.status, 'resolved');
  const reopened = new StudioStore(f.dataRoot).get(f.system.id).workItems[0]; assert.equal(reopened.answer, value.item.answer);
  const other = store.addTopic(f.system.id, { title: '另一主题', goal: '新问题应新建', scope: '合成' });
  for (const change of [{ title: '换成完全不同问题' }, { detail: '改写前提' }, { topicId: other.id }, { kind: 'task' }, { answer: '伪造用户不同决定' }]) {
    await assert.rejects(() => f.invoke('work-item', { ...original, id: item.id, ...change }), /studio_answered_question_immutable|studio_work_item_answer_requires_user/);
  }
  await assert.rejects(() => f.invoke('work-item', { ...original, answer: 'Agent伪造新答复' }), /studio_work_item_answer_requires_user/);
});

test('escaped large source and JSON section pages remain exact; changed mutable selections reject stale continuation', async t => {
  const f = await fixture(t), body = '\u0001"\\😺'.repeat(12_000), saved = await f.invoke('save-asset', f.assetInput(body));
  assert.equal(saved.transport.complete, false);
  let start = 0, text = '', pages = 0;
  for (;;) { const page = await f.invoke('read-source', { ref: saved.ref, start, length: 20_000 }); assert.equal(Array.from(page.text).length, page.range.end - start); text += page.text; pages++; if (!page.continuation) break; start = page.continuation.start; }
  assert.equal(text, body); assert.ok(pages > 2);
  const recovered = await collectRead(f, saved.transport.continuation.payload); assert.equal(recovered.value.body, body); assert.ok(recovered.pages > 2);
  await f.invoke('update-topic', { topic: { progress: 'x'.repeat(19_000) } });
  const first = await f.invoke('read', { section: 'topics', format: 'json-text', length: 100 }); assert.ok(first.continuation);
  await f.invoke('update-topic', { topic: { progress: '改为新的当前进度' } });
  await assert.rejects(() => f.invoke('read', first.continuation), /studio_read_changed/);
});

test('small responses and visible contracts remain usable without introducing a result authority', async t => {
  const f = await fixture(t), asset = await f.invoke('save-asset', f.assetInput('small-body'));
  assert.equal(asset.asset.revisions[0].body, 'small-body'); assert.equal(asset.transport, undefined);
  const topic = await f.invoke('update-topic', { topic: { progress: 'small-progress' } }); assert.equal(topic.system.topics[0].progress, 'small-progress'); assert.equal(topic.transport, undefined);
  const preview = await f.invoke('prepare-publication', { assetIds: [asset.asset.id], summary: 'small', scope: 'small' }); assert.equal(preview.preview.summary, 'small'); assert.equal(preview.transport, undefined);
  const method = await f.invoke('save-sap-method', { title: 'small-method', content: { conditions: 'a', logic: 'b', judgment: 'c', limits: 'd' }, sources: [f.ref] }); assert.equal(method.version.content.logic, 'b'); assert.equal(method.transport, undefined);
  const read = await f.invoke('read', {}); assert.ok(read.system.assetRefs.some((ref: { id: string }) => ref.id === method.ref.id));
  const catalog = await f.invoke('catalog', {}), actions = catalog.contract.actions;
  assert.match(actions['update-topic'], /topic\?:/); assert.match(actions['declare-use'], /id is taskId/); assert.match(actions['save-sap-method'], /locator:candidate/); assert.match(actions['work-item'], /human-only/);
  assert.match(actions['prepare-publication'], /assetIds/); assert.match(actions['prepare-publication'], /professional outputs/); assert.match(catalog.contract.publication, /asset sources/);
  const sap = catalog.contract.sap0_2;
  assert.deepEqual(Object.keys(sap.SapDocument), ['sap', 'package', 'dimensions', 'metrics', 'scenarios']);
  assert.deepEqual(Object.keys(sap.SapMetric), ['name', 'display_name', 'type', 'definition', 'dimensions', 'time_grains', 'owner_role', 'caliber_switches', 'type_params?', 'provenance']);
  assert.deepEqual(Object.keys(sap.SapScenario), ['id', 'version', 'title', 'decision_purpose', 'metric_usages', 'method_refs', 'evidence_requirements']);
  assert.deepEqual(sap.enums.metric_type, ['simple', 'ratio', 'derived', 'cumulative']); assert.deepEqual(sap.enums.usage_role, ['outcome', 'driver', 'guardrail']); assert.deepEqual(sap.enums.origin, ['template', 'llm', 'manual']); assert.deepEqual(sap.enums.time_grain, ['day', 'week', 'month', 'quarter', 'year']);
  assert.match(sap.registration, /fingerprint may be empty/); assert.match(sap.registration, /canonical/); assert.match(sap.registration, /returned ref/); assert.match(sap.registration, /raw file SHA/); assert.match(sap.semanticReview, /Agent/); assert.match(sap.semanticReview, /definition/);
  assert.match(catalog.contract.saveAsset, /extraction\?:\{method,sourceRefs:SourceRef\[\],failures:string\[\],fallbacks:string\[\],reviewed:boolean\}/);
  assert.match(catalog.contract.graphProjection.body, /JSON string.*entities.*relationships.*local entity keys/);
  assert.match(catalog.contract.graphProjection.meaning, /source -> target/); assert.match(catalog.contract.graphProjection.meaning, /weak clues/); assert.match(catalog.contract.graphProjection.meaning, /Plain text is a legal statement/); assert.match(catalog.contract.graphProjection.meaning, /does not guess business direction/);
  await assert.rejects(() => fs.lstat(path.join(f.dataRoot, 'studio-extractions')), { code: 'ENOENT' });
});

test('the original mutation sequence preserves a human answer in both interleavings with an Agent update', async t => {
  for (const order of ['human-first', 'agent-first'] as const) await t.test(order, async t => {
    const f = await fixture(t), store = f.feature.store, input = { kind: 'question' as const, topicId: f.system.currentTopicId, title: '合成已知问题', detail: '保持原前提', impact: '合成影响', sources: [f.ref], nextStep: '等回答', status: 'waiting' as const }, item = store.setWorkItem(f.system.id, input);
    if (order === 'human-first') {
      const get = f.projects.get.bind(f.projects); let enter!: () => void, release!: () => void, once = false;
      const reached = new Promise<void>(resolve => { enter = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
      f.projects.get = async (...args) => { const value = await get(...args); if (!once) { once = true; enter(); await blocked; } return value; };
      const pending = f.invoke('work-item', { ...input, id: item.id, nextStep: '执行已答内容' });
      await reached; await f.mutate(() => store.answerWorkItem(f.system.id, item.id, '保留真实人的答案', answerContext(item))); release(); await pending;
    } else {
      const validate = f.feature.sources.validate.bind(f.feature.sources); let enter!: () => void, release!: () => void;
      const reached = new Promise<void>(resolve => { enter = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
      f.feature.sources.validate = async (...args) => { await validate(...args); enter(); await blocked; };
      const pending = f.invoke('work-item', { ...input, id: item.id, nextStep: '等待已排队回答' }); await reached;
      let answered = false; const answer = f.mutate(() => { answered = true; return store.answerWorkItem(f.system.id, item.id, '保留真实人的答案', answerContext(item)); });
      await Promise.resolve(); assert.equal(answered, false); release(); await Promise.all([pending, answer]);
    }
    const saved = new StudioStore(f.dataRoot).get(f.system.id).workItems[0]!;
    assert.equal(saved.answer, '保留真实人的答案'); assert.equal(saved.status, 'resolved'); assert.equal(saved.title, input.title); assert.equal(saved.detail, input.detail);
  });
});

test('concurrent bounded writes use existing revisions and exact preview identities', async t => {
  const f = await fixture(t), asset = await f.invoke('save-asset', f.assetInput('s'.repeat(32_000))), current = f.feature.store.get(f.system.id);
  const updates = await Promise.allSettled([
    f.invoke('update-topic', { expectedRevision: current.revision, topic: { progress: 'A' } }),
    f.invoke('update-topic', { expectedRevision: current.revision, topic: { progress: 'B' } }),
  ]);
  assert.equal(updates.filter(value => value.status === 'fulfilled').length, 1); assert.equal(updates.filter(value => value.status === 'rejected').length, 1);
  const payload = { assetIds: [asset.asset.id], summary: 'S'.repeat(16_000), scope: 'R'.repeat(16_000) }, previews = await Promise.all([f.invoke('prepare-publication', payload), f.invoke('prepare-publication', payload)]);
  assert.notEqual(previews[0].preview.id, previews[1].preview.id); assert.equal(f.feature.store.get(f.system.id).publications.length, 2);
  for (const value of previews) { const recovered = await collectRead(f, value.transport.continuation.payload); assert.equal(recovered.value.preview.id, value.preview.id); }
});
