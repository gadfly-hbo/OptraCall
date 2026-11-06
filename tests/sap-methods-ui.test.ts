import test from 'node:test';
import assert from 'node:assert/strict';
import { listSapMethods } from '../src/host/ui/sap-method-client.ts';

test('the product method list uses the qualified Host boundary and returns the saved catalogue', async t => {
  const expected = { id: 'e1db282b-cb09-49b1-b785-ddbb008d3f1e', title: '可比窗口检查', origin: 'ir', latestVersion: 2, publishedVersion: 1, updatedAt: '2026-11-04T00:00:00.000Z', hasUnpublishedChanges: true, issue: null };
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    assert.equal(String(input), '/api/sap/methods');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.credentials, 'omit');
    assert.equal(new Headers(init?.headers).get('x-optracall-client'), '1');
    return new Response(JSON.stringify({ methods: [expected] }), { status: 200 });
  });
  assert.deepEqual(await listSapMethods(), [expected]);
  assert.equal(calls, 1);
});

test('opening a historical method requests that exact version and refuses a drifting latest reply', async t => {
  const { readSapMethod, SapMethodRequestError } = await import('../src/host/ui/sap-method-client.ts');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    assert.equal(String(input), '/api/sap/methods/method-old/versions/1');
    assert.equal(init?.method, 'GET');
    return new Response(JSON.stringify({ method: { id: 'method-old', selectedVersion: 2, versions: [] } }));
  });
  await assert.rejects(readSapMethod('method-old', 1), error => error instanceof SapMethodRequestError && error.code === 'sap_method_response_mismatch');
  assert.equal(calls, 1);
});

test('saving an edited method sends its base version and never publishes it', async t => {
  const { saveSapMethod } = await import('../src/host/ui/sap-method-client.ts');
  const version = { methodId: 'method-existing', version: 2, contentSha256: 'a'.repeat(64) };
  const receipt = { method: { id: 'method-existing', selectedVersion: 2, versions: [version] }, version, replayed: false };
  const input = { requestId: 'save-fixed-request', methodId: 'method-existing', baseVersion: 1, title: '改进窗口检查', content: { conditions: '新客复购比较', logic: '核对可比期间。', judgment: '', limits: '窗口不完整时不直接排名。' }, sources: [] };
  const calls: { path: string; method: string | undefined; body: unknown }[] = [];
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(path), method: init?.method, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(receipt));
  });
  assert.deepEqual(await saveSapMethod(input), receipt);
  assert.deepEqual(calls, [{ path: '/api/sap/methods/method-existing/versions', method: 'POST', body: input }]);
});

test('a lost save receipt remains unknown and is never automatically retried or published', async t => {
  const { saveSapMethod, SapMethodRequestError } = await import('../src/host/ui/sap-method-client.ts');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; throw new TypeError('synthetic response lost'); });
  await assert.rejects(saveSapMethod({ requestId: 'lost-receipt', title: '观察窗口检查', content: { conditions: '', logic: '核对完整观察窗口。', judgment: '', limits: '' }, sources: [] }), error => error instanceof SapMethodRequestError && error.uncertain);
  assert.equal(calls, 1, 'a response loss must not replay the save or advance to publication');
});

test('publication targets the saved content identity and requires a matching publication receipt', async t => {
  const { publishSapMethod, SapMethodRequestError } = await import('../src/host/ui/sap-method-client.ts');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (path: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    assert.equal(String(path), '/api/sap/methods/method-existing/publish');
    assert.deepEqual(JSON.parse(String(init?.body)), { requestId: 'publish-existing', version: 2, expectedSha256: 'b'.repeat(64) });
    const version = { methodId: 'method-existing', version: 2, contentSha256: 'a'.repeat(64) };
    return new Response(JSON.stringify({ method: { id: 'method-existing', selectedVersion: 2, versions: [version], publications: [] }, version, replayed: false }));
  });
  await assert.rejects(publishSapMethod('method-existing', { requestId: 'publish-existing', version: 2, expectedSha256: 'b'.repeat(64) }), error => error instanceof SapMethodRequestError && error.uncertain);
  assert.equal(calls, 1);
});

test('an unreadable successful save response cannot become a known failure or an invented saved version', async t => {
  const { saveSapMethod, SapMethodRequestError } = await import('../src/host/ui/sap-method-client.ts');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return new Response(JSON.stringify({ ok: true })); });
  await assert.rejects(saveSapMethod({ requestId: 'missing-save-receipt', title: '窗口检查', content: { conditions: '', logic: '核对比较期间。', judgment: '', limits: '' }, sources: [] }), error => error instanceof SapMethodRequestError && error.uncertain);
  assert.equal(calls, 1);
});

test('a foreign extraction receipt is rejected as unknown without starting another source task', async t => {
  const { startSapMethodExtraction, SapMethodRequestError } = await import('../src/host/ui/sap-method-client.ts');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1; assert.equal(String(input), '/api/projects/project-a/tasks/task-a/sap-method-extractions');
    assert.deepEqual(JSON.parse(String(init?.body)), { requestId: 'extract-identity', incomplete: true });
    return new Response(JSON.stringify({ extraction: { requestId: 'extract-identity', projectId: 'project-b', taskId: 'task-b', status: 'saved', methodId: 'method-b', version: 1 } }), { status: 202 });
  });
  await assert.rejects(startSapMethodExtraction('project-a', 'task-a', 'extract-identity', true), error => error instanceof SapMethodRequestError && error.uncertain);
  assert.equal(calls, 1);
});

test('an unknown save is read back by its original request without performing another mutation', async t => {
  const { readSapMethodOperation } = await import('../src/host/ui/sap-method-client.ts');
  const version = { methodId: 'saved-method', version: 3, contentSha256: 'd'.repeat(64) };
  const response = { operation: { requestId: 'original-save', kind: 'save', methodId: 'saved-method', version: 3, status: 'committed' }, method: { id: 'saved-method', selectedVersion: 3, versions: [version] } };
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1; assert.equal(String(input), '/api/sap/methods/operations/original-save'); assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    return new Response(JSON.stringify(response));
  });
  assert.deepEqual(await readSapMethodOperation('original-save'), response);
  assert.equal(calls, 1);
});
