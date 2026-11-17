import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createUsageContextStore } from '../src/host/usage-context-store.ts';
import { createUsageContextRoutes } from '../src/host/usage-context-routes.ts';

test('A01: saving the single default through HTTP survives reopening, while unset does not require a background', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-usage-http-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  let routes = createUsageContextRoutes({ store: createUsageContextStore({ dataRoot }), mutate: async run => run(), isClosing: () => false });
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString('utf8');
      const result = await routes(new URL(request.url!, 'http://localhost').pathname, request.method!, raw ? JSON.parse(raw) : {});
      response.writeHead(result ? 200 : 404, { 'content-type': 'application/json' }); response.end(JSON.stringify(result?.body ?? {}));
    } catch (error) { response.writeHead((error as { status?: number }).status || 500, { 'content-type': 'application/json' }); response.end(JSON.stringify({ code: (error as { code?: string }).code })); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/settings/usage-context`;
  assert.deepEqual(await (await fetch(base)).json(), { formatVersion: 1, revision: 0, context: null });
  const context = { kind: 'department', background: '会员服务团队，上层战略未知。' };
  const operationId = randomUUID();
  const saved = await (await fetch(base, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId, expectedRevision: 0, context }) })).json();
  assert.equal(saved.settings.revision, 1);
  routes = createUsageContextRoutes({ store: createUsageContextStore({ dataRoot }), mutate: async run => run(), isClosing: () => false });
  assert.deepEqual((await (await fetch(base)).json()).context, context);
});

test('A01: a stale default cannot replace a later choice, and UNKNOWN readback identifies the original accepted operation', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-usage-cas-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const store = createUsageContextStore({ dataRoot });
  const first = { operationId: randomUUID(), expectedRevision: 0, context: { kind: 'organization' as const, background: '已明确的组织背景' } };
  await store.update(first);
  await store.update({ operationId: randomUUID(), expectedRevision: 1, context: { kind: 'personal', background: '家庭长期安排' } });
  await assert.rejects(store.update({ operationId: randomUUID(), expectedRevision: 0, context: first.context }), { code: 'usage_context_settings_conflict' });
  const replayed = await createUsageContextStore({ dataRoot }).update(first);
  assert.equal(replayed.replayed, true); assert.equal(replayed.operationRevision, 1);
  assert.deepEqual(replayed.settings.context, { kind: 'personal', background: '家庭长期安排' });
  assert.deepEqual((await store.readOperation(first.operationId))?.context, first.context);
  await assert.rejects(store.update({ ...first, context: null }), { code: 'usage_context_operation_conflict' });
  assert.equal((await store.read()).revision, 2);
});

test('A01/A15: concurrent settings owners cannot both commit the same revision or overwrite unknown persisted bytes', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-usage-race-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const first = createUsageContextStore({ dataRoot }), second = createUsageContextStore({ dataRoot });
  const outcomes = await Promise.allSettled([
    first.update({ operationId: randomUUID(), expectedRevision: 0, context: { kind: 'organization', background: '组织' } }),
    second.update({ operationId: randomUUID(), expectedRevision: 0, context: { kind: 'personal', background: '个人' } }),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((await first.read()).revision, 1);
  const file = path.join(dataRoot, 'global-settings', 'usage-context.json'), unknown = '{"formatVersion":77,"revision":99,"context":null}';
  await writeFile(file, unknown, { mode: 0o600 });
  await assert.rejects(first.read(), { code: 'usage_context_settings_corrupt' });
  await assert.rejects(second.update({ operationId: randomUUID(), expectedRevision: 0, context: null }), { code: 'usage_context_settings_corrupt' });
  assert.equal(await readFile(file, 'utf8'), unknown);
});

test('A01/A14: invalid purpose, injected resource authority and a redirected file never create a second default', async t => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-usage-boundary-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  const store = createUsageContextStore({ dataRoot });
  await assert.rejects(store.update({ operationId: randomUUID(), expectedRevision: 0, context: { kind: 'administrator', background: '' } } as never), { code: 'invalid_usage_context' });
  await assert.rejects(store.update({ operationId: randomUUID(), expectedRevision: 0, context: { kind: 'organization', background: '', projectId: randomUUID() } } as never), { code: 'invalid_usage_context' });
  assert.equal((await store.read()).revision, 0);
  await mkdir(path.join(dataRoot, 'global-settings'), { mode: 0o700 });
  const foreign = path.join(dataRoot, 'foreign.json'); await writeFile(foreign, 'original foreign record', { mode: 0o600 });
  await symlink(foreign, path.join(dataRoot, 'global-settings', 'usage-context.json'));
  await assert.rejects(store.read(), { code: 'usage_context_settings_unsafe_file' });
  await assert.rejects(store.update({ operationId: randomUUID(), expectedRevision: 0, context: null }), { code: 'usage_context_settings_unsafe_file' });
  assert.equal(await readFile(foreign, 'utf8'), 'original foreign record');
});
