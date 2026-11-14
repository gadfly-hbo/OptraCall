import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

async function json(response: Response, status = 200): Promise<any> {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}

async function fixture(t: TestContext, disabled = false) {
  const root = path.resolve('.local/case-star-map-implementation/tdd/runtime/host-fixtures', randomUUID());
  await mkdir(root, { recursive: true });
  const provider = await startToolProvider();
  const host = await startTestHost({ dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects'), disableCaseRelations: disabled });
  t.after(async () => { await host.close(); await provider.close(); });
  const saved = await json(await host.request('/api/configuration', 'PUT', { name: 'Case relationship synthetic', provider: 'openai-compatible', model: 'relation-synthetic-model', baseUrl: provider.baseUrl, apiKey: 'synthetic-relation-host-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '合成原项目', configurationId: saved.configuration.id }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '合成原分析任务' }), 201);
  await json(await host.request('/api/cases/storage/initialize', 'POST', {}));
  const { case: source } = await json(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '已结束的合成前项' }), 201);
  const closed = await json(await host.request(`/api/cases/${source.id}/close`, 'POST', { operationId: randomUUID(), expectedRevision: source.revision, reason: '历史结论保留为待核参考' }));
  const { case: target } = await json(await host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '当前合成目标事项' }), 201);
  const linked = await json(await host.request(`/api/cases/${target.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: target.revision, projectId: project.id }));
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  return { root, provider, host, project, task, route, source: closed.case, target: linked.case,
    context: { caseId: target.id, caseRevision: linked.case.revision, projectWorkRevision: 0, selectedReferenceIds: [] } };
}

async function send(f: Awaited<ReturnType<typeof fixture>>, text: string, withCase = true) {
  const requestId = randomUUID();
  await json(await f.host.request(f.route + '/messages', 'POST', { requestId, text, ...(withCase ? { caseContext: f.context } : {}) }), 202);
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    const value = await json(await f.host.request(f.route));
    if (value.task.lastRun?.id === requestId && value.task.lastRun.status !== 'running') return { requestId, ...value };
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Synthetic original Host task did not settle.');
}

test('SM07/A04 original HTTP task and real Pi can save/read a relation to its bound target with a closed historical source', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const command = { fromCaseId: f.source.id, kind: 'follows_up', expectedRelationRevision: 0, explanation: '当前问题延续历史事项的补证工作。', targetScope: '当前事项的补证范围', sources: [], assertionNature: 'explicit' };
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length === 0
    ? { calls: [{ name: 'save_case_relation', arguments: command }] }
    : recentToolResults.length === 1 ? { calls: [{ name: 'read_case_relations', arguments: { includeUnlinked: true } }] } : { text: '关系声明已留存，不代表因果或效果。' });
  const result = await send(f, '请在需要时记录明确的前后续关系。');
  assert.equal(result.task.lastRun.status, 'completed');
  const list = await json(await f.host.request('/api/case-relations'));
  assert.equal(list.items.length, 1, 'the real original task must save through the Host callback rather than merely advertise a tool');
  const relation = list.items[0];
  assert.equal(relation.fromCaseId, f.source.id); assert.equal(relation.toCaseId, f.target.id);
  assert.equal(relation.origin.actorKind, 'agent'); assert.equal(relation.origin.projectId, f.project.id); assert.equal(relation.origin.taskId, f.task.id);
  assert.equal(relation.origin.requestId, result.requestId); assert.ok(relation.origin.sessionId); assert.ok(relation.origin.toolCallId);
  assert.equal((await json(await f.host.request(`/api/cases/${f.source.id}`))).case.status, 'closed', 'historical source must not be reopened');
  assert.equal((await json(await f.host.request(`/api/cases/${f.target.id}`))).case.revision, f.target.revision, 'relation revisions do not edit target Case core');
  const native = await readFile(result.task.sessionFile, 'utf8');
  assert.ok(native.includes('save_case_relation')); assert.ok(native.includes('read_case_relations')); assert.ok(native.includes(relation.operationId));
  assert.ok(JSON.stringify(f.provider.requests.at(-1)?.body.messages).includes(relation.relationId));
});

test('SM04/SM07 real Host artifact sources read the actual bounded text and keep changed bytes distinct from the historical observation', { timeout: 30_000 }, async t => {
  const f = await fixture(t), content = '合成明确来源🙂'.repeat(2600);
  const { case: evidence } = await json(await f.host.request('/api/cases', 'POST', { operationId: randomUUID(), title: '合成历史来源事项' }), 201);
  const linked = await json(await f.host.request(`/api/cases/${evidence.id}/projects`, 'POST', { operationId: randomUUID(), expectedRevision: evidence.revision, projectId: f.project.id }));
  const { file } = await json(await f.host.request(`/api/projects/${f.project.id}/files/upload`, 'POST', { name: 'relation-source.txt', directory: '020_clean', content: Buffer.from(content).toString('base64') }), 201);
  const saved = await json(await f.host.request(`/api/cases/${evidence.id}/artifacts`, 'POST', { operationId: randomUUID(), expectedRevision: linked.case.revision, projectId: f.project.id, relativePath: file.path, taskId: f.task.id, role: 'report' }));
  await json(await f.host.request(`/api/cases/${evidence.id}/close`, 'POST', { operationId: randomUUID(), expectedRevision: saved.case.revision, reason: '历史来源仍可准确引用' }));
  const store = await json(await f.host.request('/api/cases/storage'));
  const ref = { type: 'case-artifact', caseStoreId: store.storeId, caseId: evidence.id, artifactId: saved.artifact.id, observedSha256: file.sha256 };
  let relationId = ''; const parts: any[] = [];
  f.provider.setResponder(({ recentToolResults }) => {
    if (!recentToolResults.length) return { calls: [{ name: 'save_case_relation', arguments: { fromCaseId: evidence.id, kind: 'supports', expectedRelationRevision: 0, explanation: '引用原文件的明确支持声明。', targetScope: '当前Case的合成材料核对', sources: [ref] } }] };
    if (recentToolResults.length === 1) {
      relationId = JSON.parse(providerMessageText(recentToolResults[0].content)).relationId;
      return { calls: [{ name: 'read_case_relations', arguments: { relationId, revision: 1, sourceIndex: 0 } }] };
    }
    const part = JSON.parse(providerMessageText(recentToolResults.at(-1)!.content)); parts.push(part);
    return part.partial ? { calls: [{ name: 'read_case_relations', arguments: { relationId, revision: 1, sourceIndex: 0, continuation: part.continuation } }] } : { text: '准确来源已分段读取，关系仍是声明。' };
  });
  assert.equal((await send(f, '自主记录和核对原文件依据。')).task.lastRun.status, 'completed');
  assert.ok(relationId); assert.ok(parts.length > 1); assert.equal(parts[0].status, 'available');
  assert.equal(parts.map(part => part.text).join(''), content);
  assert.equal(parts.at(-1).partial, false);
  await writeFile(path.join(f.project.rootPath, file.path), 'CHANGED_CURRENT_BYTES_MUST_NOT_REPLACE_THE_OBSERVED_VERSION');
  let changed: any;
  f.provider.setResponder(({ recentToolResults }) => {
    if (!recentToolResults.length) return { calls: [{ name: 'read_case_relations', arguments: { relationId, revision: 1, sourceIndex: 0 } }] };
    changed = JSON.parse(providerMessageText(recentToolResults[0].content)); return { text: '文件变化，保留原观察身份和缺口。' };
  });
  assert.equal((await send(f, '只核对原观察引用，不换成当前新字节。')).task.lastRun.status, 'completed');
  assert.equal(changed.status, 'changed'); assert.equal(changed.text, null); assert.equal(changed.ref.observedSha256, file.sha256);
});

test('SM07/SM10 original Host task denies unbound or model-selected owners while a zero-call ordinary answer stays usable', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '没有目标绑定，保留普通回答。' } : { calls: [{ name: 'save_case_relation', arguments: { fromCaseId: f.source.id, kind: 'follows_up', expectedRelationRevision: 0, explanation: '无Case绑定不能保存。' } }] });
  assert.equal((await send(f, '没有Case绑定的原分析请求。', false)).task.lastRun.status, 'completed');
  assert.equal((await json(await f.host.request('/api/case-relations'))).items.length, 0);
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '不能伪造目标Case。' } : { calls: [{ name: 'save_case_relation', arguments: { fromCaseId: f.source.id, toCaseId: f.source.id, kind: 'follows_up', expectedRelationRevision: 0, explanation: '模型不能授予目标owner。' } }] });
  assert.equal((await send(f, '尝试给出未授权目标。')).task.lastRun.status, 'completed');
  assert.equal((await json(await f.host.request('/api/case-relations'))).items.length, 0);
  f.provider.setResponder(() => ({ text: '本次无需关系，继续原分析。' }));
  assert.equal((await send(f, '零关系调用也正常完成。')).task.lastRun.status, 'completed');
});

test('SM08/SM10 disabled compatibility mode removes new tools and preserves original Case tools and readable relation API', { timeout: 30_000 }, async t => {
  const f = await fixture(t, true);
  const { snapshot } = await json(await f.host.request(f.route + '/open', 'POST', {}));
  assert.ok(!snapshot.tools.includes('read_case_relations')); assert.ok(!snapshot.tools.includes('save_case_relation'));
  assert.ok(snapshot.tools.includes('read_case_decisions')); assert.ok(snapshot.tools.includes('save_case_decision_draft'));
  assert.equal(f.provider.requests.length, 0, 'opening a task cannot call the Provider');
  const list = await json(await f.host.request('/api/case-relations'));
  assert.equal(list.writingEnabled, false); assert.deepEqual(list.items, []);
  f.provider.setResponder(() => ({ text: '关闭新关系能力仍能普通分析。' }));
  assert.equal((await send(f, '原分析可继续。')).task.lastRun.status, 'completed');
});

test('SM05/SM12 closing the target during the accepted native run rejects a late new relationship write without stopping the run', { timeout: 30_000 }, async t => {
  const f = await fixture(t); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  f.provider.setResponder(async ({ recentToolResults }) => {
    if (recentToolResults.length) return { text: '目标已关闭，关系未保存，原分析仍可结束。' };
    entered(); await barrier;
    return { calls: [{ name: 'save_case_relation', arguments: { fromCaseId: f.source.id, kind: 'follows_up', expectedRelationRevision: 0, explanation: '目标关闭后不能新增。' } }] };
  });
  const pending = send(f, '当轮分析已经接受。'); await started;
  await json(await f.host.request(`/api/cases/${f.target.id}/close`, 'POST', { operationId: randomUUID(), expectedRevision: f.target.revision, reason: '结束当前事项的新写入' }));
  assert.equal((await json(await f.host.request(f.route))).snapshot.status, 'running');
  release(); assert.equal((await pending).task.lastRun.status, 'completed');
  assert.equal((await json(await f.host.request('/api/case-relations'))).items.length, 0);
  assert.ok(JSON.stringify(f.provider.requests.at(-1)?.body.messages).includes('case_closed'));
});

test('SM12 stopping or clearing configuration before a late Provider tool call cannot persist or replay a relationship', { timeout: 60_000 }, async t => {
  for (const clear of [false, true]) await t.test(clear ? 'configuration invalidation' : 'user stop', async t => {
    const f = await fixture(t); let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
    t.after(() => release());
    f.provider.setResponder(async () => { entered(); await barrier; return { calls: [{ name: 'save_case_relation', arguments: { fromCaseId: f.source.id, kind: 'follows_up', expectedRelationRevision: 0, explanation: '取消后不能提交。' } }] }; });
    const pending = send(f, '等待中的合成关系。'); await started;
    await json(await f.host.request(clear ? '/api/configuration' : f.route + '/stop', clear ? 'DELETE' : 'POST', clear ? undefined : {}));
    release(); assert.equal((await pending).task.lastRun.status, 'cancelled');
    assert.equal((await json(await f.host.request('/api/case-relations'))).items.length, 0);
    if (!clear) {
      f.provider.setResponder(() => ({ text: '显式新请求不重放前一条关系调用。' }));
      assert.equal((await send(f, '全新请求，不自动重放。')).task.lastRun.status, 'completed');
      assert.equal((await json(await f.host.request('/api/case-relations'))).items.length, 0);
    }
  });
});

test('SM08/SM12 a committed relation receipt survives later target close, cancellation and restart with new writes disabled', { timeout: 30_000 }, async t => {
  const f = await fixture(t); let entered!: () => void;
  const committed = new Promise<void>(resolve => { entered = resolve; });
  f.provider.setResponder(({ recentToolResults }) => {
    if (!recentToolResults.length) return { calls: [{ name: 'save_case_relation', arguments: { fromCaseId: f.source.id, kind: 'follows_up', expectedRelationRevision: 0, explanation: '提交后保留原操作回执。' } }] };
    entered(); return { text: '保存后尚未完成的合成回复', hold: true };
  });
  const pending = send(f, '保存后仍可能取消本轮分析。'); await committed;
  const before = await json(await f.host.request('/api/case-relations')); assert.equal(before.items.length, 1);
  const relation = before.items[0], receiptRoute = `/api/cases/${f.target.id}/relations/operations/${relation.operationId}`;
  const receipt = await json(await f.host.request(receiptRoute)); assert.equal(receipt.operation.phase, 'completed');
  await json(await f.host.request(`/api/cases/${f.target.id}/close`, 'POST', { operationId: randomUUID(), expectedRevision: f.target.revision, reason: '关闭新业务写入，历史回执仍可读' }));
  await json(await f.host.request(f.route + '/stop', 'POST', {}));
  assert.equal((await pending).task.lastRun.status, 'cancelled');
  assert.deepEqual(await json(await f.host.request(receiptRoute)), receipt);
  await f.host.close();
  const compatible = await startTestHost({ dataRoot: f.host.dataRoot, projectsRoot: f.host.projectsRoot, disableCaseRelations: true }); t.after(() => compatible.close());
  const after = await json(await compatible.request('/api/case-relations'));
  assert.equal(after.writingEnabled, false); assert.deepEqual(after.items, before.items);
  assert.deepEqual(await json(await compatible.request(receiptRoute)), receipt);
  const { snapshot } = await json(await compatible.request(f.route + '/open', 'POST', {}));
  assert.ok(!snapshot.tools.includes('read_case_relations')); assert.ok(!snapshot.tools.includes('save_case_relation')); assert.ok(snapshot.tools.includes('save_case_decision_draft'));
  await json(await compatible.request(`/api/cases/${f.target.id}/relations`, 'POST', { operationId: randomUUID(), caseStoreId: after.caseStoreId, expectedRelationRevision: 0, fromCaseId: f.source.id, kind: 'follows_up', explanation: '关闭能力时不得新增。' }), 409);
  assert.equal((await json(await compatible.request('/api/case-relations'))).items.length, 1);
});
