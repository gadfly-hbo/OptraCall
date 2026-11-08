import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { readSemanticContext, SemanticContextRequestError } from '../src/host/ui/semantic-context-client.ts';

async function queryFaultFixture(t: TestContext) {
  const root = path.resolve('.local/fourbase-modules/m7-l1-semantic-trace/implementation/host-client', randomUUID());
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'Synthetic L1 query faults', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', model: 'synthetic', apiKey: 'synthetic-l1-client-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'Typed auxiliary query faults' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'Original task remains usable' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}/semantic-context`;
  const createRule = async (title: string) => {
    const { material } = await readJson(await host.request('/api/enterprise-materials', 'POST', { title, body: 'Synthetic original rule.' }), 201);
    await readJson(await host.request(`/api/enterprise-materials/${material.id}/enable`, 'POST', { expectedVersion: material.version }));
  };
  const changedDirectoryQuery = async () => {
    for (const title of ['Synthetic first rule', 'Synthetic second rule']) await createRule(title);
    const input = { action: 'find' as const, kinds: ['enterprise' as const], pageSize: 1 };
    const first = await readJson(await host.request(route, 'POST', input));
    assert.equal(first.items.length, 1); assert.ok(first.coverage.continuation, 'the original directory must produce a real continuation');
    await createRule('Synthetic later rule');
    return { ...input, continuation: first.coverage.continuation as string };
  };
  return { host, project, task, route, changedDirectoryQuery };
}

test('the optional product source client reaches the real Host through its existing client qualification', { timeout: 30_000 }, async t => {
  const root = path.resolve('.local/fourbase-modules/m7-l1-semantic-trace/implementation/host-client', randomUUID());
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  t.after(() => host.close());
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'Synthetic L1 client', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', model: 'synthetic', apiKey: 'synthetic-l1-client-only' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'Auxiliary source client' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'No extra setup' }), 201);
  const actualFetch = globalThis.fetch;
  // Browser-origin headers are simulated only at the network boundary; the
  // actual product client must supply its own existing Host client marker.
  globalThis.fetch = (input, init) => actualFetch(new URL(String(input), host.baseUrl), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin: 'http://127.0.0.1:4183' } });
  t.after(() => { globalThis.fetch = actualFetch; });
  const result = await readSemanticContext(project.id, task.id, { action: 'find' });
  assert.equal(result.type, 'optracall.semantic-context-result');
  assert.deepEqual(result.items, []);
});

test('the real Host preserves typed validation and stale-continuation feedback for optional source queries', { timeout: 30_000 }, async t => {
  const f = await queryFaultFixture(t);
  await t.test('invalid request is a typed 400', async () => {
    const response = await f.host.request(f.route, 'POST', { action: 'find', pageSize: 101 });
    const value = await response.json();
    assert.equal(response.status, 400, 'invalid auxiliary query must retain its declared HTTP status');
    assert.equal(value.code, 'invalid_semantic_context_request');
  });
  await t.test('a changed original directory is a typed 409', async () => {
    const response = await f.host.request(f.route, 'POST', await f.changedDirectoryQuery());
    const value = await response.json();
    assert.equal(response.status, 409, 'a real stale continuation must retain its declared HTTP status');
    assert.equal(value.code, 'semantic_context_continuation_stale');
  });
  const usable = await readJson(await f.host.request(f.route, 'POST', { action: 'find', kinds: ['enterprise'] }));
  assert.equal(usable.items.length, 3, 'failed optional queries do not alter the original task or prevent a corrected read');
});

test('the product source client keeps the actual Host error code and status for corrected-query feedback', { timeout: 30_000 }, async t => {
  const f = await queryFaultFixture(t), staleInput = await f.changedDirectoryQuery();
  const actualFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => actualFetch(new URL(String(input), f.host.baseUrl), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin: 'http://127.0.0.1:4183' } });
  t.after(() => { globalThis.fetch = actualFetch; });
  await t.test('invalid input retains the Host validation code', async () => {
    await assert.rejects(readSemanticContext(f.project.id, f.task.id, { action: 'find', pageSize: 101 }), error => {
      assert.ok(error instanceof SemanticContextRequestError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'invalid_semantic_context_request');
      return true;
    });
  });
  await t.test('stale continuation retains the Host conflict code', async () => {
    await assert.rejects(readSemanticContext(f.project.id, f.task.id, staleInput), error => {
      assert.ok(error instanceof SemanticContextRequestError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'semantic_context_continuation_stale');
      return true;
    });
  });
  const corrected = await readSemanticContext(f.project.id, f.task.id, { action: 'find', kinds: ['enterprise'] });
  assert.equal(corrected.items.length, 3);
});
