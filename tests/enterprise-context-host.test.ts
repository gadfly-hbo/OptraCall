import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { prepareJointContext, readJson } from './fixtures/joint-context.ts';
import { sessionEvents } from './fixtures/session-events.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';

test('EB09: an unknown selected material fails before any model call and does not create a run', { timeout: 30000 }, async t => {
  const provider = await startSyntheticProvider();
  t.after(() => provider.close());
  const host = await startTestHost();
  t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'Enterprise synthetic', provider: 'openai-compatible',
    baseUrl: provider.baseUrl, model: 'synthetic-enterprise', apiKey: 'enterprise-context-only-test-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '企业资料独立合成项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '未选Case的任务' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const response = await host.request(`${route}/messages`, 'POST', { text: '只描述可知事项。', requestId: randomUUID(),
    enterpriseMaterials: [{ storeId: randomUUID(), materialId: randomUUID(), revisionId: randomUUID(), mode: 'full' }] });
  assert.equal(response.status, 404);
  assert.equal(provider.requests.length, 0);
  assert.equal((await readJson(await host.request(route))).task.lastRun, undefined);
});

test('EB05/10/12: RAP SAP Case and fixed enterprise revisions share one native request and retain old source receipts', { timeout: 90000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  let host = await startTestHost(); t.after(() => host.close());
  const f = await prepareJointContext(host, provider.baseUrl);
  const source = '单位元。😀退款是否净额未知。';
  const created = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '合成结算规则', body: source }), 201);
  const enabled = await readJson(await host.request(`/api/enterprise-materials/${created.material.id}/enable`, 'POST', { expectedVersion: created.material.version }));
  const v1 = enabled.material.revisions[0];
  const ref = { storeId: enabled.storeId, materialId: enabled.material.id, revisionId: v1.revisionId };
  const changed = await readJson(await host.request(`/api/enterprise-materials/${ref.materialId}`, 'PUT', { expectedVersion: enabled.material.version, body: '新版正文不得替换原引用' }));
  const v2 = await readJson(await host.request(`/api/enterprise-materials/${ref.materialId}/enable`, 'POST', { expectedVersion: changed.material.version }));
  const sidecar = await readJson(await host.request(`/api/cases/${f.case.id}/enterprise-materials`, 'PUT', { caseRevision: f.case.revision,
    expectedRevision: 0, materials: [ref], supplements: [{ text: '本案例外尚未确认', source: '', scope: '仅本活动', confirmation: '未知' }] }));
  const enterpriseCaseContext = { caseId: f.case.id, storeId: sidecar.storeId, caseStoreId: sidecar.caseStoreId, revision: sidecar.revision };
  const route = `/api/projects/${f.project.id}/tasks/${f.task.id}`;
  const input = { requestId: randomUUID(), text: '解释现有资料中的未知条件，不做实际经营动作。', caseContext: f.caseContext,
    requirementContext: f.requirementContext, enterpriseMaterials: [{ ...ref, mode: 'excerpt', start: 0, end: 6 }], enterpriseCaseContext };
  const stream = await sessionEvents(host, f.project.id, f.task.id); t.after(() => stream.close());
  await readJson(await host.request(`${route}/messages`, 'POST', input), 202);
  await stream.terminal;
  const sent = JSON.stringify(provider.requests[0].body.messages?.filter(message => message.role === 'user'));
  for (const expected of ['单位元。😀', '本案例外尚未确认', f.case.title, 'RR07_RAP_1_9_GOAL', '不是执行指令']) assert.ok(sent.includes(expected), expected);
  assert.ok(!sent.includes('新版正文不得替换原引用'));
  const state = await readJson(await host.request(route));
  assert.equal(state.snapshot.messages.filter((message: { role: string }) => message.role === 'user').at(-1).originalUserText, input.text, 'Presentation retains the original question without stripping source strings heuristically');
  const receipt = state.snapshot.capabilities.semanticContext;
  assert.equal(receipt.version, 1); assert.equal(receipt.claim, 'provided-not-adopted');
  assert.equal(receipt.enterprise.materials[0].revisionId, v1.revisionId);
  assert.equal(receipt.enterprise.materials[0].providedText, '单位元。😀');
  assert.deepEqual([receipt.enterprise.materials[0].start, receipt.enterprise.materials[0].end], [0, 6]);
  assert.equal(receipt.enterprise.case.supplements[0].text, '本案例外尚未确认');
  assert.equal(receipt.rap.version, '1.9.0');
  assert.match(receipt.sap.indexText, /membership-repurchase@1\.0\.0/);
  const originalBytes = await readFile(path.join(f.project.rootPath, '020_clean/joint-input.csv'));
  await readJson(await host.request(`/api/enterprise-materials/${ref.materialId}/disable`, 'POST', { expectedVersion: v2.material.version }));
  await readJson(await host.request(`/api/cases/${f.case.id}/enterprise-materials`, 'PUT', { caseRevision: f.case.revision,
    expectedRevision: sidecar.revision, materials: [], supplements: [{ text: '后来的补充不能改写过去', source: '', scope: '', confirmation: '' }] }));
  await readJson(await host.request(`${route}/messages`, 'POST', input), 202);
  await readJson(await host.request(`${route}/messages`, 'POST', { ...input, enterpriseMaterials: [{ ...ref, mode: 'location' }] }), 409);
  assert.equal(provider.requests.length, 1, 'Native retry never selects a newer source or replays after sidecar edit/deactivation');
  const history = await readJson(await host.request(`/api/enterprise-materials/${ref.materialId}/revisions/${ref.revisionId}`));
  assert.equal(history.revision.body, source);
  await stream.close(); await host.close();
  const nativeBefore = await readFile(state.task.sessionFile);
  host = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot });
  const saved = await readJson(await host.request(route));
  assert.deepEqual(saved.snapshot.capabilities.semanticContext, receipt);
  assert.deepEqual(await readFile(state.task.sessionFile), nativeBefore);
  assert.deepEqual(await readFile(path.join(f.project.rootPath, '020_clean/joint-input.csv')), originalBytes);
  assert.equal(provider.requests.length, 1);
});

test('EB07/09: zero selections and no Case still permit real native discovery and reading of the authorized public library', { timeout: 60000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'Enterprise tools synthetic', provider: 'openai-compatible',
    baseUrl: provider.baseUrl, model: 'synthetic-enterprise-tools', apiKey: 'synthetic-enterprise-tools-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '自主读取合成项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '无Case且无选材' }), 201);
  const created = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '自主检索来源', body: 'AUTONOMOUS_SOURCE_退款前提未知' }), 201);
  await readJson(await host.request(`/api/enterprise-materials/${created.material.id}/enable`, 'POST', { expectedVersion: created.material.version }));
  provider.setResponder(context => {
    assert.ok(context.availableTools.includes('read'));
    const user = providerMessageText(context.messages.filter(message => message.role === 'user').at(-1)?.content);
    if (!context.recentToolResults.length) {
      assert.ok(!user.includes('AUTONOMOUS_SOURCE_退款前提未知'), 'Directory visibility is not full-text provision');
      const index = /目录索引: ("[^\n]+")/.exec(user);
      assert.ok(index);
      return { calls: [{ name: 'read', arguments: { path: JSON.parse(index[1]) } }] };
    }
    if (context.recentToolResults.length === 1) {
      const directory = providerMessageText(context.recentToolResults[0].content);
      const bodyPath = /"bodyPath":\s*("[^"\n]+")/.exec(directory);
      assert.ok(bodyPath, directory);
      return { calls: [{ name: 'read', arguments: { path: JSON.parse(bodyPath[1]) } }] };
    }
    assert.ok(providerMessageText(context.recentToolResults.at(-1)?.content).includes('AUTONOMOUS_SOURCE_退款前提未知'));
    return { text: '合成协议已实际读取授权原文；不证明模型理解质量。' };
  });
  const stream = await sessionEvents(host, project.id, task.id); t.after(() => stream.close());
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  await readJson(await host.request(`${route}/messages`, 'POST', { text: '自行查找需要的公共资料。', requestId: randomUUID(), enterpriseMaterials: [] }), 202);
  await stream.terminal;
  assert.equal(provider.requests.length, 3);
  const system = JSON.stringify(provider.requests[0].body.messages?.filter(message => message.role === 'system'));
  assert.ok(system.includes('authorized shared business materials'), 'System workspace guidance must authorize the shared sources outside 020_clean');
  assert.deepEqual(provider.errors, []);
  const saved = await readJson(await host.request(route));
  assert.equal(saved.snapshot.capabilities.semanticContext.enterprise.materials.length, 0);
  assert.equal(saved.snapshot.capabilities.semanticContext.enterprise.directory.claim, 'directory-visible-not-read');
  const native = await readFile(saved.task.sessionFile, 'utf8');
  assert.ok(native.includes('AUTONOMOUS_SOURCE_退款前提未知'));
  assert.ok(saved.snapshot.messages.some((message: { role: string; toolName?: string }) => message.role === 'toolResult' && message.toolName === 'read'));
});

test('EB07/09: exact user limit remains usable when the optional library is unavailable, with no source claims or reset', { timeout: 60000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'Unavailable library synthetic', provider: 'openai-compatible',
    baseUrl: provider.baseUrl, model: 'synthetic-enterprise', apiKey: 'synthetic-unavailable-library-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '可选库损坏保全项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '边界长度直接提问' }), 201);
  await readJson(await host.request('/api/enterprise-materials'));
  const indexPath = path.join(host.dataRoot, 'enterprise-business-materials/index.json');
  const corrupt = '{"schemaVersion":99,"preserve":"UNKNOWN"}\n';
  await writeFile(indexPath, corrupt);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const stream = await sessionEvents(host, project.id, task.id); t.after(() => stream.close());
  const text = '问'.repeat(20000);
  await readJson(await host.request(`${route}/messages`, 'POST', { requestId: randomUUID(), text }), 202);
  await stream.terminal;
  const sent = JSON.stringify(provider.requests[0].body.messages?.filter(message => message.role === 'user'));
  assert.ok(sent.includes(text)); assert.ok(sent.includes('目录当前不可用'));
  const state = await readJson(await host.request(route));
  assert.equal(state.snapshot.capabilities.semanticContext.enterprise, undefined);
  assert.equal(await readFile(indexPath, 'utf8'), corrupt, 'Unavailable optional sources must not be reset or backfilled');
});

test('EB09: explicit ranges, attachment limits and stopped selections fail before a run, without silent clipping', { timeout: 60000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'Material boundary synthetic', provider: 'openai-compatible',
    baseUrl: provider.baseUrl, model: 'synthetic-enterprise', apiKey: 'synthetic-material-boundary-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '资料边界合成项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '正文边界' }), 201);
  const create = async (body: string) => {
    const draft = await readJson(await host.request('/api/enterprise-materials', 'POST', { title: '合成资料', body }), 201);
    return readJson(await host.request(`/api/enterprise-materials/${draft.material.id}/enable`, 'POST', { expectedVersion: draft.material.version }));
  };
  const small = await create('😀abcd'), large = await create('长'.repeat(20001));
  const ref = (value: typeof small) => ({ storeId: value.storeId, materialId: value.material.id, revisionId: value.material.activeRevisionId });
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  for (const [selection, status] of [
    [{ ...ref(small), mode: 'excerpt', start: 1, end: 3 }, 400],
    [{ ...ref(small), mode: 'excerpt', start: 0, end: 50 }, 400],
    [{ ...ref(small), mode: 'location', start: 0, end: 1 }, 400],
    [{ ...ref(large), mode: 'full' }, 413],
  ] as const) await readJson(await host.request(`${route}/messages`, 'POST', { requestId: randomUUID(), text: '直接提问', enterpriseMaterials: [selection] }), status);
  await readJson(await host.request(`/api/enterprise-materials/${small.material.id}/disable`, 'POST', { expectedVersion: small.material.version }));
  await readJson(await host.request(`${route}/messages`, 'POST', { requestId: randomUUID(), text: '直接提问', enterpriseMaterials: [{ ...ref(small), mode: 'location' }] }), 409);
  assert.equal(provider.requests.length, 0);
  assert.equal((await readJson(await host.request(route))).task.lastRun, undefined);
  assert.equal((await readJson(await host.request(`/api/enterprise-materials/${large.material.id}/revisions/${large.material.activeRevisionId}`))).revision.body.length, 20001);
});
