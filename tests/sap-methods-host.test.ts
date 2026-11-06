import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import fs from 'node:fs/promises';
import { createHost } from '../src/host/server.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

for (const mode of ['late-save', 'memory-governance', 'failed-close']) {
  test(`SAM09/10 permanent public feature regression: ${mode}`, { timeout: 30_000 }, async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ['--experimental-test-module-mocks', 'tests/fixtures/sap-method-feature-regression.ts', mode], { timeout: 25_000 });
    assert.match(stdout, /"result":"PASS"/);
  });
}

async function json(response: Response, expected = 200): Promise<any> {
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() - started > 20_000) assert.fail(`Host operation did not settle: ${JSON.stringify(value)}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('SAM06/07 public Host: saved methods stay out of reference until exact explicit publication', { timeout: 60_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const input = {
    requestId: randomUUID(), title: '可比观察窗口检查',
    content: { conditions: '比较不同新客批次的复购', logic: '先核对观察窗口是否完整，再比较可比批次。', judgment: '', limits: '窗口未完整时保留未知。' }, sources: [],
  };
  const saved = await json(await host.request('/api/sap/methods', 'POST', input), 201);
  const id = saved.method.id;
  const draft = await json(await host.request(`/api/sap/methods/${id}/versions/1`));
  assert.equal(draft.method.selectedVersion, 1);
  assert.deepEqual((await json(await host.request('/api/sap/methods/published'))).methods, []);
  const published = await json(await host.request(`/api/sap/methods/${id}/publish`, 'POST', { requestId: randomUUID(), version: 1, expectedSha256: saved.version.contentSha256 }));
  assert.equal(published.version.contentSha256, saved.version.contentSha256);
  const references = await json(await host.request('/api/sap/methods/published'));
  assert.equal(references.methods.length, 1);
  assert.equal(references.methods[0].id, id);
  assert.equal((await json(await host.request(`/api/sap/methods/${id}/versions/1`))).method.versions[0].contentSha256, saved.version.contentSha256);
});

test('SAM03/06/11: actual Host and Pi extract to an unpublished method without changing the source native', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  provider.setResponder(context => {
    if (!context.availableTools.includes('read_sap_method_source')) return { text: '分析已交付：先核对观察窗口，再比较可比批次；证据不足时保留未知。' };
    assert.deepEqual(context.availableTools, ['read_sap_method_source']);
    if (!context.recentToolResults.length) return { calls: [{ name: 'read_sap_method_source', arguments: { action: 'read-session', start: 0, length: 1024 } }] };
    assert.match(providerMessageText(context.recentToolResults[0].content), /观察窗口/);
    return { text: JSON.stringify({ kind: 'method', title: 'Session提炼的窗口方法', content: { conditions: '可比新客批次', logic: '先核观察窗口，再分析结构变化。', judgment: '', limits: '这是合成工程材料，未验证专业收益。' } }) };
  });
  await json(await host.request('/api/configuration', 'PUT', { name: '隔离合成提炼模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-sap-extraction', apiKey: 'synthetic-sap-extraction' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '合成后置提炼' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原分析保留' }), 201);
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`;
  await json(await host.request(`${taskRoute}/messages`, 'POST', { requestId: randomUUID(), text: '请解释合成资料的观察窗口，明确交付。' }), 202);
  const before = await until(() => host.request(taskRoute).then(response => json(response)), value => value.task.lastRun?.status === 'completed' && value.snapshot.status === 'idle');
  const native = await fs.readFile(before.task.sessionFile), requestId = randomUUID();
  const route = `${taskRoute}/sap-method-extractions`;
  await json(await host.request(route, 'POST', { requestId, incomplete: false }), 202);
  const result = await until(() => host.request(`${route}/${requestId}`).then(response => json(response)), value => value.extraction.status !== 'running');
  assert.equal(result.extraction.status, 'saved', JSON.stringify(result));
  const saved = await json(await host.request(`/api/sap/methods/${result.extraction.methodId}/versions/${result.extraction.version}`));
  assert.equal(saved.method.origin, 'ir');
  assert.deepEqual(saved.method.publications, []);
  assert.equal(saved.method.versions[0].sources[0].type, 'session');
  assert.deepEqual((await json(await host.request('/api/sap/methods/published'))).methods, []);
  const requests = provider.requests.length;
  const repeated = await json(await host.request(route, 'POST', { requestId, incomplete: false }), 202);
  assert.equal(repeated.extraction.methodId, result.extraction.methodId);
  assert.equal(provider.requests.length, requests, 'duplicate request must not repeat model or create');
  const after = await json(await host.request(taskRoute));
  assert.equal(after.task.sessionFile, before.task.sessionFile);
  assert.deepEqual(await fs.readFile(before.task.sessionFile), native);
  const source = await json(await host.request(`/api/sap/methods/${result.extraction.methodId}/versions/1/sources/0`));
  assert.match(source.text, /观察窗口/);
  assert.equal(source.complete, true);
  await json(await host.request(`${taskRoute}/messages`, 'POST', { requestId: randomUUID(), text: '补充一次独立合成讨论。' }), 202);
  await until(() => host.request(taskRoute).then(response => json(response)), value => value.task.lastRun?.status === 'completed' && value.snapshot.status === 'idle');
  const laterSource = await json(await host.request(`/api/sap/methods/${result.extraction.methodId}/versions/1/sources/0`));
  assert.equal(laterSource.text, source.text);
  assert.match(laterSource.limitation, /会话.*变化/);
  assert.deepEqual(provider.errors, []);
});

test('SAM06/12: existing SAP semantic lookup supplies only published exact method versions', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '统一参考合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-sap-methods', apiKey: 'synthetic-only' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '方法统一参考合成项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '统一SAP查读' }), 201);
  const input = { requestId: randomUUID(), title: '窗口方法', content: { conditions: '可比批次', logic: 'PUBLISHED_LOGIC_V1', judgment: '', limits: '' }, sources: [] };
  const saved = await json(await host.request('/api/sap/methods', 'POST', input), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}/semantic-context`;
  const find = () => host.request(route, 'POST', { action: 'find', kinds: ['sap-method'], query: '窗口' });
  assert.deepEqual((await json(await find())).items, []);
  await json(await host.request(`/api/sap/methods/${saved.method.id}/publish`, 'POST', { requestId: randomUUID(), version: 1, expectedSha256: saved.version.contentSha256 }));
  const found = await json(await find());
  assert.equal(found.items.length, 1);
  assert.deepEqual(found.items[0].target, { kind: 'sap-method', methodId: saved.method.id, version: 1, publishedHash: saved.version.contentSha256 });
  await json(await host.request(`/api/sap/methods/${saved.method.id}/versions`, 'POST', { ...input, requestId: randomUUID(), baseVersion: 1, title: 'UNPUBLISHED_TITLE_V2', content: { ...input.content, logic: 'UNPUBLISHED_LOGIC_V2' } }), 201);
  const exact = await json(await host.request(route, 'POST', { action: 'read', target: found.items[0].target }));
  assert.match(exact.items[0].body, /PUBLISHED_LOGIC_V1/);
  assert.doesNotMatch(JSON.stringify(exact), /UNPUBLISHED_/);
  const hidden = await json(await host.request(route, 'POST', { action: 'read', target: { kind: 'sap-method', methodId: saved.method.id, version: 2 } }));
  assert.equal(hidden.items[0].body, null);
  assert.doesNotMatch(JSON.stringify(hidden), /UNPUBLISHED_/);
  provider.setResponder(context => {
    assert.ok(context.availableTools.includes('read_semantic_context'));
    if (!context.recentToolResults.length) return { calls: [{ name: 'read_semantic_context', arguments: { action: 'find', kinds: ['sap-method'], query: '窗口' } }] };
    if (context.recentToolResults.length === 1) {
      const directory = JSON.parse(providerMessageText(context.recentToolResults[0].content));
      assert.equal(directory.items[0].target.version, 1);
      assert.doesNotMatch(JSON.stringify(directory), /UNPUBLISHED_/);
      return { calls: [{ name: 'read_semantic_context', arguments: { action: 'read', target: directory.items[0].target } }] };
    }
    const exact = providerMessageText(context.recentToolResults[1].content);
    assert.match(exact, /PUBLISHED_LOGIC_V1/); assert.doesNotMatch(exact, /UNPUBLISHED_/);
    return { text: '普通Agent通过同一SAP入口读取确定发布版，无需提炼或发布步骤。' };
  });
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`;
  await json(await host.request(taskRoute + '/messages', 'POST', { requestId: randomUUID(), text: '按需查看合适的已发布窗口方法。' }), 202);
  const completed = await until(() => host.request(taskRoute).then(response => json(response)), value => value.task.lastRun?.status === 'completed' && value.snapshot.status === 'idle');
  assert.equal(completed.task.lastRun.status, 'completed');
  assert.equal(provider.requests.length, 3); assert.deepEqual(provider.errors, []);
});

test('SAM03/09: actual extraction binds the exact read method and source preview rechecks later governance', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  const prior = await json(await host.request('/api/sap/methods', 'POST', { requestId: randomUUID(), title: '原始窗口方法', content: { conditions: '', logic: 'FIXED_ORIGINAL_METHOD', judgment: '', limits: '' }, sources: [] }), 201);
  await json(await host.request(`/api/sap/methods/${prior.method.id}/publish`, 'POST', { requestId: randomUUID(), version: 1, expectedSha256: prior.version.contentSha256 }));
  provider.setResponder(context => {
    if (!context.availableTools.includes('read_sap_method_source')) return { text: '分析已交付。' };
    if (!context.recentToolResults.length) return { calls: [{ name: 'read_sap_method_source', arguments: { action: 'read-method', input: { target: { kind: 'sap-method', methodId: prior.method.id, version: 1 } } } }] };
    const material = JSON.parse(providerMessageText(context.recentToolResults[0].content));
    assert.equal(material.source.type, 'method', 'the model must see the exact reference it can declare');
    return { text: JSON.stringify({ kind: 'method', title: '对原方法的场景补充', content: { conditions: '', logic: 'Explicit extra reasoning for a new scenario', judgment: '', limits: '' }, sources: [material.source] }) };
  });
  await json(await host.request('/api/configuration', 'PUT', { name: '准确来源合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-sap-source', apiKey: 'synthetic-sap-source' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '准确方法来源' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '来源治理' }), 201);
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`;
  await json(await host.request(taskRoute + '/messages', 'POST', { requestId: randomUUID(), text: '完成合成分析。' }), 202);
  await until(() => host.request(taskRoute).then(response => json(response)), value => value.task.lastRun?.status === 'completed' && value.snapshot.status === 'idle');
  const requestId = randomUUID(), route = taskRoute + '/sap-method-extractions';
  await json(await host.request(route, 'POST', { requestId, incomplete: false }), 202);
  const result = await until(() => host.request(route + '/' + requestId).then(response => json(response)), value => value.extraction.status !== 'running');
  assert.equal(result.extraction.status, 'saved', JSON.stringify(result));
  const sourceRoute = `/api/sap/methods/${result.extraction.methodId}/versions/1/sources/1`;
  const before = await json(await host.request(sourceRoute));
  assert.match(before.text, /FIXED_ORIGINAL_METHOD/);
  await json(await host.request(`/api/sap/methods/${prior.method.id}/issues`, 'POST', { requestId: randomUUID(), version: 1, expectedRevision: 0, status: 'confirmed', note: '窗口条件遗漏，停止默认推荐' }));
  const after = await json(await host.request(sourceRoute));
  assert.equal(after.text, before.text, 'fixed source content must never be replaced by current content');
  assert.match(after.governance, /窗口条件遗漏/);
  assert.match(after.limitation, /治理/);
  assert.deepEqual(provider.errors, []);
});

test('SAM10: stop settles the exact attached extraction without replay or an unpublished method', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  provider.setResponder(context => context.availableTools.includes('read_sap_method_source') ? { text: '提炼正在运行', hold: true } : { text: '原分析完成，报告和已知限制保持。' });
  await json(await host.request('/api/configuration', 'PUT', { name: '取消合成提炼', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-sap-stop', apiKey: 'synthetic-sap-stop' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '取消提炼合成项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '原任务' }), 201);
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`;
  await json(await host.request(`${taskRoute}/messages`, 'POST', { requestId: randomUUID(), text: '请完成合成简析。' }), 202);
  const original = await until(() => host.request(taskRoute).then(response => json(response)), value => value.task.lastRun?.status === 'completed' && value.snapshot.status === 'idle');
  const native = await fs.readFile(original.task.sessionFile);
  const requestId = randomUUID(), route = `${taskRoute}/sap-method-extractions`;
  await json(await host.request(route, 'POST', { requestId, incomplete: false }), 202);
  await provider.waitForRequests(2);
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}), 409);
  const stopped = await json(await host.request(`${route}/${requestId}/stop`, 'POST', {}));
  assert.equal(stopped.extraction.status, 'cancelled', JSON.stringify(stopped));
  assert.deepEqual((await json(await host.request('/api/sap/methods'))).methods, []);
  assert.deepEqual(await fs.readFile(original.task.sessionFile), native);
  const repeated = await json(await host.request(route, 'POST', { requestId, incomplete: false }), 202);
  assert.equal(repeated.extraction.status, 'cancelled');
  assert.equal(provider.requests.length, 2);
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
});

test('SAM10: an exact saved request receipt can be read without repeating save or publish', { timeout: 60_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const requestId = randomUUID(), input = { requestId, title: '回执核对', content: { conditions: '', logic: '保留相同请求的确定结果，不重复生成。', judgment: '', limits: '' }, sources: [] };
  const saved = await json(await host.request('/api/sap/methods', 'POST', input), 201);
  const receipt = await json(await host.request(`/api/sap/methods/operations/${requestId}`));
  assert.equal(receipt.operation.status, 'committed');
  assert.equal(receipt.method.id, saved.method.id);
  assert.equal(receipt.method.selectedVersion, 1);
  assert.deepEqual(receipt.method.publications, []);
  assert.equal((await json(await host.request('/api/sap/methods'))).methods.length, 1);
});

test('SAM12: compatibility disable keeps exact method history readable and refuses new writes', { timeout: 60_000 }, async t => {
  const host = await startTestHost(); t.after(() => host.close());
  const input = { requestId: randomUUID(), title: '停用仍可回看', content: { conditions: '', logic: '原确定版本保持可读，不用旧副本覆盖。', judgment: '', limits: '' }, sources: [] };
  const saved = await json(await host.request('/api/sap/methods', 'POST', input), 201);
  await host.close();
  const disabledHost = createHost({ cwd: process.cwd(), uiPorts: [4183], transportVersion: 'isolated-compatibility-test', dataRoot: host.dataRoot, projectsRoot: host.projectsRoot, sapMethodsEnabled: false });
  t.after(() => disabledHost.close()); await disabledHost.ready;
  await new Promise<void>(resolve => disabledHost.server.listen(0, '127.0.0.1', resolve));
  const address = disabledHost.server.address(); assert.ok(address && typeof address !== 'string');
  const disabled = { request: (route: string, method = 'GET', body?: unknown) => fetch(`http://127.0.0.1:${address.port}${route}`, { method, headers: host.headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) };
  const old = await json(await disabled.request(`/api/sap/methods/${saved.method.id}/versions/1`));
  assert.equal(old.method.versions[0].contentSha256, saved.version.contentSha256);
  const denied = await json(await disabled.request('/api/sap/methods', 'POST', { ...input, requestId: randomUUID() }), 409);
  assert.equal(denied.code, 'METHOD_FEATURE_DISABLED');
  await json(await disabled.request(`/api/sap/methods/${saved.method.id}/publish`, 'POST', { requestId: randomUUID(), version: 1, expectedSha256: saved.version.contentSha256 }), 409);
  assert.equal((await json(await disabled.request('/api/sap/methods'))).methods.length, 1);
});
