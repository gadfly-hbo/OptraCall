import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isValidElement } from 'react';
import './fixtures/register-ui.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { readStrategyDiscussion, updateStrategyDiscussion } from '../src/host/ui/strategy-discussion-client.ts';
import type { StrategyDiscussionBackgroundSelection } from '../src/host/ui/StrategyDiscussionPanel.tsx';

// User-specified seams: real background controls -> existing HTTP client ->
// actual Host/Pi/Provider/native. No old fixed-output test or shared dependency.
const parent = path.resolve('.local/v12-pm01-r1/author');
await mkdir(parent, { recursive: true });
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const missingScope = (owner: unknown) => !Object.hasOwn(owner as object, 'sourceScope');
function input(tree: unknown, id: string): any {
  if (Array.isArray(tree)) return tree.map(node => input(node, id)).find(Boolean);
  if (!isValidElement(tree)) return;
  const props = tree.props as { id?: string; children?: unknown };
  return tree.type === 'input' && props.id === id ? tree : input(props.children, id);
}

async function fixture(t: TestContext, first: 'read' | 'refs' | 'catalog' = 'read') {
  const evidence = await mkdtemp(path.join(parent, `legacy-${first}-`));
  const provider = await startToolProvider();
  const options = { dataRoot: path.join(evidence, 'host'), projectsRoot: path.join(evidence, 'projects') };
  let host = await startTestHost(options);
  t.after(async () => { await host.close(); await provider.close(); });
  const rawFetch = globalThis.fetch;
  const wire: unknown[] = [];
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => {
    const response = await rawFetch(host.baseUrl + route, { method, headers: host.headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); wire.push({ route, method, body, status: response.status, value });
    assert.equal(response.status, status, JSON.stringify(value)); return value;
  };
  await request('/api/configuration', 'PUT', { name: 'R1 isolated synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-r1', apiKey: 'synthetic-r1-only' });
  const { project } = await request('/api/projects', 'POST', { name: 'R1旧讨论合成背景' }, 201);
  const body = 'R1_EXACT_BACKGROUND_A：仅合成经营计划；不含交易明细，不授权发券。';
  await request(`/api/projects/${project.id}/files/upload`, 'POST', { name: '原经营计划A.md', directory: '020_clean', content: Buffer.from(body).toString('base64') }, 201);
  const { discussion } = await request('/api/strategy/discussions', 'POST', { operationId: randomUUID(), projectId: project.id, sources: [] }, 201);
  const base = `/api/strategy/discussions/${discussion.id}`;
  const source = (await request(base + '/sources')).sources[0];
  await request(base, 'PATCH', { expectedRevision: discussion.revision, sources: [source] });
  // Only this fresh synthetic fixture is downgraded to the actual old shape.
  // Close first, never edit live owner state or any old author/native evidence.
  await host.close();
  const ownerFile = path.join(options.dataRoot, 'strategy-discussions', discussion.id, 'owner.json');
  const seeded = JSON.parse(await readFile(ownerFile, 'utf8')); delete seeded.sourceScope;
  await writeFile(ownerFile, JSON.stringify(seeded) + '\n');
  const oldBytes = await readFile(ownerFile);
  host = await startTestHost(options);
  let detail = await request(base); assert.ok(missingScope(detail.discussion));
  assert.deepEqual(await readFile(ownerFile), oldBytes, 'GET does not migrate the old owner');
  let actualRead: any;
  provider.setResponder(call => {
    if (!call.recentToolResults.length) return first === 'refs' ? { text: '只按已有诉求讨论，没有读取资料。' } : { calls: [{ name: 'strategy_goals', arguments: first === 'read' ? { action: 'read-source', sourceId: source.id } : { action: 'find-sources' } }] };
    const value = JSON.parse(providerMessageText(call.recentToolResults.at(-1)?.content));
    if (value.read) actualRead = value;
    return { text: first === 'read' ? '准确背景已返回，未形成经营判断。' : '只看目录，没有读正文。' };
  });
  const settle = async () => {
    for (let i = 0; i < 400; i++) { const value = await request(base); if (!value.busy && value.discussion.lastRun?.status !== 'accepted') return value; await delay(20); }
    throw new Error('isolated discussion did not settle');
  };
  await request(base + '/messages', 'POST', { requestId: randomUUID(), expectedRevision: detail.discussion.revision, text: '沿原讨论已选的准确背景A继续，保留未知。' }, 202);
  detail = await settle(); assert.equal(detail.discussion.lastRun.status, 'completed'); assert.ok(missingScope(detail.discussion));
  if (first === 'read') { assert.equal(actualRead?.read?.text, body); assert.equal(actualRead.source.sha256, sha(body)); assert.equal(actualRead.read.complete, true); }
  const native = await readFile(detail.snapshot.sessionFile);
  await writeFile(path.join(evidence, 'native-before.jsonl'), native);
  await writeFile(path.join(evidence, 'owner-before.json'), await readFile(ownerFile));
  if (first !== 'read') assert.ok(!native.toString().includes(body), 'references/catalog are not body delivery');
  await writeFile(path.join(evidence, 'seed.json'), JSON.stringify({ project, source, first, body, actualRead, detail, nativeSha256: sha(native), nativeBytes: native.length }, null, 2));
  provider.setResponder(() => ({ text: '只响应本次明确输入，保留原记录。' }));
  return { evidence, provider, project, source, base, ownerFile, detail, native, request, settle, wire, host: () => host, rawFetch, body };
}

test('R1: cancelling a truly read legacy selection through the real background component and original client prevents native redispatch', { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const { StrategyDiscussionBackground } = await import('../src/host/ui/StrategyDiscussionPanel.tsx');
  let selection: StrategyDiscussionBackgroundSelection = { projectId: f.project.id, sources: f.detail.discussion.sources, sourceScope: undefined };
  const tree = StrategyDiscussionBackground({ id: 'legacy', selection, projects: [f.project], locked: false, isExistingDiscussion: true, onChange(value: StrategyDiscussionBackgroundSelection) { selection = value; }, onList() {} });
  const checkbox = input(tree, 'legacy-use-0'); assert.equal(checkbox.props.checked, true);
  checkbox.props.onChange({ target: { checked: false } });
  assert.deepEqual(selection.sources, []); assert.equal(selection.projectId, f.project.id); assert.equal(selection.sourceScope, undefined);
  const clientWire: any[] = [];
  t.mock.method(globalThis, 'fetch', async (resource: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(String(resource), f.host().baseUrl);
    const response = await f.rawFetch(target, { ...init, headers: { ...f.host().headers, ...Object.fromEntries(new Headers(init?.headers)) } });
    clientWire.push({ route: target.pathname, method: init?.method || 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}), status: response.status, result: await response.clone().json() }); return response;
  });
  await updateStrategyDiscussion(f.detail.discussion.id, { expectedRevision: f.detail.discussion.revision, projectId: selection.projectId, sources: selection.sources, sourceScope: selection.sourceScope });
  const reopened = await readStrategyDiscussion(f.detail.discussion.id);
  assert.ok(missingScope(reopened.discussion)); assert.ok(!Object.hasOwn(clientWire[0].body, 'sourceScope'));
  assert.deepEqual(reopened.discussion.sources, []); assert.equal(reopened.discussion.projectId, f.project.id);
  const next = { requestId: randomUUID(), expectedRevision: reopened.discussion.revision, text: '只取消原A的本次使用，不切范围、不排除，继续独立可行部分。' };
  const count = f.provider.requests.length;
  const response = await f.rawFetch(f.host().baseUrl + f.base + '/messages', { method: 'POST', headers: f.host().headers, body: JSON.stringify(next) });
  const result = await response.json() as any;
  const after = response.status === 202 ? await f.settle() : await f.request(f.base);
  const nativeAfter = await readFile(f.detail.snapshot.sessionFile);
  const observed = { status: response.status, result, clientWire, next, beforeProvider: count, afterProvider: f.provider.requests.length, nativeBeforeSha256: sha(f.native), nativeAfterSha256: sha(nativeAfter), requestContainsPriorBody: f.provider.requests.slice(count).some(r => JSON.stringify(r.body).includes(f.body)), after };
  await writeFile(path.join(f.evidence, 'observation.json'), JSON.stringify(observed, null, 2));
  await writeFile(path.join(f.evidence, 'http.json'), JSON.stringify(f.wire, null, 2));
  await writeFile(path.join(f.evidence, 'provider.json'), JSON.stringify({ requests: f.provider.requests, errors: f.provider.errors }, null, 2));
  await writeFile(path.join(f.evidence, 'native-after.jsonl'), nativeAfter);
  t.diagnostic(f.evidence);
  assert.equal(response.status, 409, 'an old absent scope is selected-only at the actual dispatch boundary');
  assert.equal(result.code, 'strategy_discussion_history_scope_changed'); assert.match(result.message, /本次未发送给模型/);
  assert.equal(f.provider.requests.length, count); assert.deepEqual(nativeAfter, f.native);
  assert.deepEqual(after.discussion.pendingInput, { requestId: next.requestId, text: next.text, expectedRevision: next.expectedRevision });
  assert.equal(after.discussion.lastRun.id, next.requestId); assert.deepEqual(after.discussion.sources, []); assert.ok(missingScope(after.discussion));
});

for (const scenario of ['old-api-read-clear', 'refs-only-clear', 'catalog-only-clear', 'read-still-selected'] as const) test(`R1 legacy compatibility: ${scenario}`, { timeout: 60000 }, async t => {
  const first = scenario === 'refs-only-clear' ? 'refs' : scenario === 'catalog-only-clear' ? 'catalog' : 'read';
  const f = await fixture(t, first);
  const narrowed = scenario !== 'read-still-selected';
  if (narrowed) await f.request(f.base, 'PATCH', { expectedRevision: f.detail.discussion.revision, sources: [] });
  const beforeGet = await readFile(f.ownerFile);
  const reopened = await f.request(f.base);
  assert.deepEqual(await readFile(f.ownerFile), beforeGet, 'reopening does not backfill or migrate scope');
  assert.ok(missingScope(reopened.discussion)); assert.equal(reopened.discussion.projectId, f.project.id);
  assert.deepEqual(reopened.discussion.sources, narrowed ? [] : [f.source]);
  const next = { requestId: randomUUID(), expectedRevision: reopened.discussion.revision, text: '按当前准确选择继续独立可行工作，不自动换编号或重放。' };
  const count = f.provider.requests.length;
  const response = await f.rawFetch(f.host().baseUrl + f.base + '/messages', { method: 'POST', headers: f.host().headers, body: JSON.stringify(next) });
  const result = await response.json() as any;
  const after = response.status === 202 ? await f.settle() : await f.request(f.base);
  const afterBytes = await readFile(f.detail.snapshot.sessionFile);
  const blocked = scenario === 'old-api-read-clear';
  await writeFile(path.join(f.evidence, 'observation.json'), JSON.stringify({ scenario, first, next, status: response.status, result, beforeProvider: count, afterProvider: f.provider.requests.length, nativeBeforeSha256: sha(f.native), nativeAfterSha256: sha(afterBytes), after }, null, 2));
  await writeFile(path.join(f.evidence, 'provider.json'), JSON.stringify({ requests: f.provider.requests, errors: f.provider.errors }, null, 2));
  await writeFile(path.join(f.evidence, 'http.json'), JSON.stringify(f.wire, null, 2));
  await writeFile(path.join(f.evidence, 'native-after.jsonl'), afterBytes);
  assert.ok(missingScope(after.discussion)); assert.deepEqual(f.provider.errors, []);
  if (blocked) {
    assert.equal(response.status, 409); assert.equal(result.code, 'strategy_discussion_history_scope_changed');
    assert.equal(f.provider.requests.length, count); assert.deepEqual(afterBytes, f.native);
    assert.equal(after.discussion.pendingInput.requestId, next.requestId); assert.equal(after.discussion.pendingInput.text, next.text);
    assert.equal(after.discussion.lastRun.id, next.requestId); assert.deepEqual(after.discussion.sources, []);
    const repeated = await f.request(f.base + '/messages', 'POST', next, 202);
    assert.equal(repeated.replayed, true); assert.equal(repeated.discussion.lastRun.status, 'failed'); assert.equal(f.provider.requests.length, count);
    assert.deepEqual(await readFile(f.detail.snapshot.sessionFile), f.native);
    // The conflicting discussion does not block other work in the same Project.
    const independent = (await f.request('/api/strategy/discussions', 'POST', { operationId: randomUUID(), projectId: f.project.id, sources: [], sourceScope: { mode: 'selected-only' } }, 201)).discussion;
    await f.request(`/api/strategy/discussions/${independent.id}/messages`, 'POST', { requestId: randomUUID(), expectedRevision: independent.revision, text: '仅按本轮已知说明继续独立讨论。' }, 202);
    for (let i = 0; i < 300; i++) { const value = await f.request(`/api/strategy/discussions/${independent.id}`); if (!value.busy && value.discussion.lastRun?.status === 'completed') break; await delay(20); }
    assert.equal(f.provider.requests.length, count + 1);
    assert.ok(!JSON.stringify(f.provider.requests.at(-1)?.body).includes(f.body));
    assert.deepEqual(await readFile(f.detail.snapshot.sessionFile), f.native);
    await writeFile(path.join(f.evidence, 'independent-project-work.json'), JSON.stringify({ repeated, independent, providerRequests: f.provider.requests.length, originalNativeUnchanged: true }, null, 2));
  } else {
    assert.equal(response.status, 202); assert.equal(after.discussion.lastRun.status, 'completed');
    assert.equal(f.provider.requests.length, count + 1); assert.deepEqual(afterBytes.subarray(0, f.native.length), f.native);
    assert.equal(JSON.stringify(f.provider.requests.at(-1)?.body).includes(f.body), first === 'read', 'metadata-only is not body, while a still-selected actual read may continue');
  }
  t.diagnostic(f.evidence);
});
