import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import { studioQuestionContext } from '../extensions/business-plugins/studio/contracts.ts';
import type { StudioWorkItem } from '../extensions/business-plugins/studio/contracts.ts';
import { createHost } from '../src/host/server.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
const hash = (item: StudioWorkItem) => createHash('sha256').update(studioQuestionContext(item)).digest('hex');

test('an answer CAS rejects changed meaning and missing context without writing, while progress and unrelated revisions do not conflict', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-question-cas-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new StudioStore(root), system = store.create({ name: '合成题意CAS', projectId: randomUUID(), taskId: randomUUID(), topicTitle: '合成', goal: '保持人的回答归属' });
  const input = { topicId: system.currentTopicId, kind: 'question' as const, title: '原问题A', detail: 'A的业务前提', impact: 'A的用途', sources: [{ authority: 'enterprise' as const, id: 'synthetic-source', version: 'v1', sha256: 'a'.repeat(64), locator: 'synthetic-store' }], nextStep: '等待回答', status: 'waiting' as const }, item = store.setWorkItem(system.id, input), seen = structuredClone(item);
  store.setWorkItem(system.id, { ...input, id: item.id, title: '新问题B', detail: 'B的业务前提' });
  const before = store.get(system.id);
  assert.throws(() => store.answerWorkItem(system.id, item.id, '对A的答复', hash(seen)), /studio_question_changed/);
  assert.deepEqual(new StudioStore(root).get(system.id), before);
  assert.throws(() => store.answerWorkItem(system.id, item.id, '没有已读上下文', undefined), /studio_question_context_required/);
  store.setWorkItem(system.id, { ...input, id: item.id, sources: [{ ...input.sources[0]!, version: 'v2', sha256: 'b'.repeat(64) }] });
  assert.throws(() => store.answerWorkItem(system.id, item.id, '基于原来源的答复', hash(seen)), /studio_question_changed/);
  store.setWorkItem(system.id, { ...input, id: item.id, nextStep: '只推进执行' }); store.update(system.id, { name: '无关的体系改名' });
  const saved = store.answerWorkItem(system.id, item.id, '对A的答复', hash(seen)); assert.equal(saved.answer, '对A的答复'); assert.equal(saved.nextStep, '只推进执行');
  assert.throws(() => store.answerWorkItem(system.id, item.id, '另一份旧上下文答复', hash(seen)), /studio_question_changed/);
  assert.equal(new StudioStore(root).get(system.id).workItems[0]!.answer, '对A的答复');
});

for (const mode of ['human-first', 'agent-first', 'agent-first-changed-meaning'] as const) test(`actual Host/Pi answer order: ${mode}`, { timeout: 60_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-answer-host-')), dataRoot = path.join(root, 'host'), provider = await startToolProvider();
  const host = createHost({ cwd: process.cwd(), uiPorts: [4183], transportVersion: 'synthetic-question-cas', dataRoot, projectsRoot: path.join(root, 'projects'), connectionTimeoutMs: 15_000 });
  const original = EnterpriseMaterialsStore.prototype.readRevision; let pendingAnswer: Promise<{ status: number; value: any }> | undefined, answered = false, armed = false, queued = false;
  t.after(async () => { EnterpriseMaterialsStore.prototype.readRevision = original; if (pendingAnswer) await pendingAnswer.catch(() => {}); await host.close(); await provider.close(); await fs.rm(root, { recursive: true, force: true }); });
  await host.ready; await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${(host.server.address() as { port: number }).port}`;
  const request = (route: string, method = 'GET', body?: unknown) => fetch(base + route, { method, headers: { 'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4183' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = async (response: Response, status = 200): Promise<any> => { const text = await response.text(); assert.equal(response.status, status, text); return JSON.parse(text); };
  await json(await request('/api/configuration', 'PUT', { name: 'Synthetic CAS', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-answers', apiKey: 'synthetic-only' }));
  const { project } = await json(await request('/api/projects', 'POST', { name: '合成回答归属' }), 201), created = await json(await request('/api/enterprise-materials', 'POST', { title: '合成来源', body: 'Synthetic source.', scope: 'Engineering' }), 201);
  await json(await request(`/api/enterprise-materials/${created.material.id}/enable`, 'POST', { expectedVersion: created.material.version }));
  const material = (await json(await request(`/api/studio/materials?projectId=${project.id}`))).materials[0];
  const { system } = await json(await request('/api/studio/systems', 'POST', { requestId: randomUUID(), name: '合成题意', projectId: project.id, goal: 'CAS', topicTitle: '合成', materials: [material] }), 201), store = new StudioStore(dataRoot);
  const a = { topicId: system.currentTopicId, kind: 'question' as const, title: 'Original question A', detail: 'Choose original A', impact: 'A only', nextStep: 'Wait', sources: [material.ref], status: 'waiting' as const }, item = store.setWorkItem(system.id, a);
  const seen = (await json(await request(`/api/studio/systems/${system.id}`))).system.workItems.find((value: StudioWorkItem) => value.id === item.id), answer = () => request(`/api/studio/systems/${system.id}/answers`, 'POST', { requestId: randomUUID(), workItemId: item.id, answer: 'Human answer for A', expectedQuestionContextSha256: hash(seen) }).then(async response => { const value = await response.json(); answered = true; return { status: response.status, value }; });
  if (mode === 'human-first') {
    const missing = await json(await request(`/api/studio/systems/${system.id}/answers`, 'POST', { requestId: randomUUID(), workItemId: item.id, answer: 'No pinned context', expectedRevision: system.revision }), 400);
    assert.equal(missing.code, 'studio_question_context_required'); assert.equal(store.get(system.id).workItems[0]!.answer, undefined);
  }
  if (mode !== 'human-first') {
    EnterpriseMaterialsStore.prototype.readRevision = async function (...args) { const value = await original.apply(this, args); if (armed && args[0] === created.material.id) { armed = false; pendingAnswer = answer(); await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(answered, false); queued = true; } return value; }; armed = true;
  }
  provider.setResponder(async ctx => { if (!ctx.recentToolResults.length) { if (mode === 'human-first') { pendingAnswer = answer(); assert.equal((await pendingAnswer).status, 200); } return { calls: [{ name: 'studio_assets', arguments: { action: 'work-item', systemId: system.id, payload: { ...a, id: item.id, ...(mode === 'agent-first-changed-meaning' ? { title: 'Different question B', detail: 'Choose B' } : {}), nextStep: 'Advance execution' } } }] }; } if (pendingAnswer) await pendingAnswer; return { text: 'SYNTHETIC_CAS_FINISHED' }; });
  const route = `/api/projects/${project.id}/tasks/${system.taskId}`; await json(await request(`${route}/messages`, 'POST', { requestId: randomUUID(), text: 'Execute the synthetic work item.', studioContext: { systemId: system.id, purpose: 'construction' } }), 202);
  let state: any; const deadline = Date.now() + 30_000;
  do { state = await json(await request(route)); if (state.task.lastRun?.status === 'completed') break; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < deadline);
  assert.equal(state.task.lastRun?.status, 'completed'); assert.match(JSON.stringify(state.snapshot.messages), /SYNTHETIC_CAS_FINISHED/); assert.deepEqual(provider.errors, []); if (mode !== 'human-first') assert.equal(queued, true);
  const response = await pendingAnswer!, saved = (await json(await request(`/api/studio/systems/${system.id}`))).system.workItems.find((value: StudioWorkItem) => value.id === item.id);
  if (mode === 'agent-first-changed-meaning') { assert.equal(response.status, 409); assert.equal(response.value.code, 'studio_question_changed'); assert.equal(saved.answer, undefined); assert.equal(saved.title, 'Different question B'); }
  else { assert.equal(response.status, 200); assert.equal(saved.title, seen.title); assert.equal(saved.answer, 'Human answer for A'); assert.equal(saved.status, 'resolved'); assert.equal(saved.nextStep, 'Advance execution'); }
});
