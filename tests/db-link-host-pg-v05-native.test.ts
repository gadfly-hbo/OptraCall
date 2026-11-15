import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { ProjectDataContextStore } from '../src/host/project-data-context-store.ts';
import { createDbLinkHost } from '../src/host/db-link-host.ts';
import type { RuntimeModelConfiguration } from '../src/host/config-store.ts';
import type { DbLinkConnectionInput, DbLinkPublicConnection, DbLinkRuntimeConnection, DbLinkTestReceipt } from '../src/host/db-link-types.ts';
import type { DbLinkCallContext } from '../src/agent/db-link-tools.ts';

const configPath = process.env.OPTRACALL_DB_PG_V05_CONFIG;
const nativeOptions = { skip: configPath ? false : 'Requires the explicitly managed isolated PostgreSQL v0.5 fixture' };
type NativeInput = {
  runtime: DbLinkRuntimeConnection;
  subjects: Record<'oc_analyst_a' | 'oc_analyst_b' | 'oc_viewer', { runtime: DbLinkRuntimeConnection }>;
  truth: { exactId: string; exactAmount: string; exactCreatedAt: string; note: { bytes: number }; enterprise: { aIds: string[]; bIds: string[] } };
};
const ended = { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true };
async function fixture(t: TestContext) {
  const native = JSON.parse(await readFile(configPath!, 'utf8')) as NativeInput;
  const root = await mkdtemp(join(tmpdir(), 'db-host-pg-v05-'));
  const projects = new ProjectStore({ dataRoot: join(root, 'host'), projectsRoot: join(root, 'projects') }); await projects.init();
  const configuration: RuntimeModelConfiguration = { id: 'pg-v05-unused-model', revision: 1, name: 'Synthetic unused model', provider: 'synthetic', api: 'openai-completions', model: 'unused', baseUrl: 'https://synthetic.invalid/v1', apiKey: 'synthetic-unused-only' };
  const project = await projects.create({ name: 'PG v0.5 Host public ports', configuration }), task = await projects.createTask(project.id, { name: 'Synthetic database analysis' });
  let tail: Promise<unknown> = Promise.resolve();
  const host = createDbLinkHost({ dataRoot: projects.dataRoot, projects, data: new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects }),
    configurationSnapshot: (id, revision) => id === configuration.id && (revision === undefined || revision === configuration.revision) ? structuredClone(configuration) : undefined,
    mutate: operation => { const next = tail.then(operation); tail = next.catch(() => {}); return next; }, isClosing: () => false });
  await host.init();
  const cleanups: ((options: { retryFailed?: boolean }) => Promise<void>)[] = [];
  t.after(async () => { try { for (const cleanup of cleanups) await cleanup({ retryFailed: true }); } finally { await projects.close(); await rm(root, { recursive: true, force: true }); } });
  const context = (): DbLinkCallContext => { const controller = new AbortController(); return { signal: controller.signal, requestId: randomUUID(), sessionId: randomUUID(), toolCallId: randomUUID(), runToken: {}, assertCurrent: () => controller.signal.throwIfAborted(), registerCleanup: cleanup => cleanups.push(cleanup) }; };
  const port = host.port(project.id, task.id, configuration);
  async function source(runtime: DbLinkRuntimeConnection, objects: string[]) {
    const { id: _id, revision: _revision, fingerprint: _fingerprint, ...input } = runtime;
    const tested = await host.request('POST', '/api/db-link/connections/test', input as DbLinkConnectionInput);
    assert.equal(tested?.status, 200, String(tested?.body.code ?? 'test receipt unavailable'));
    const receipt = tested!.body.receipt as DbLinkTestReceipt; assert.equal(receipt.reachable, true);
    const saved = await host.request('POST', '/api/db-link/connections', { configuration: input, testReceiptId: receipt.id }); assert.equal(saved?.status, 200);
    const connection = saved!.body.connection as DbLinkPublicConnection;
    assert.equal(JSON.stringify(connection).includes(runtime.password), false);
    const granted = await host.request('POST', `/api/projects/${project.id}/db-link/sources`, { connectionId: connection.id, scope: { objects }, modelExport: { targets: [configuration.id], structure: true, comments: false, queryText: true, results: true } }); assert.equal(granted?.status, 200);
    return { connection, receipt };
  }
  async function query(connectionId: string, sql: string, parameters: Record<string, unknown>[] = [], scopeNote?: string) {
    const result = await port('query', { connectionId, sql, parameters, ...(scopeNote ? { scopeNote } : {}) }, context());
    assert.deepEqual(result.details.resourceState, ended);
    return result;
  }
  return { native, host, project, projects, task, configuration, context, port, source, query };
}

test('PostgreSQL v0.5 Host retains the native verified capability through test, save and project grant', nativeOptions, async t => {
  const f = await fixture(t), saved = await f.source(f.native.runtime, ['sales.orders']);
  assert.equal(saved.receipt.queryQualified, true);
  assert.equal(saved.connection.observation.queryQualified, true);
  const queried = await f.query(saved.connection.id, 'SELECT id FROM sales.orders');
  assert.equal(queried.details.status, 'complete');
  const listed = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results?taskId=${f.task.id}`);
  assert.equal((listed?.body.results as unknown[]).length, 1);
});

test('PostgreSQL v0.5 Host catalogue records actual login/effective actors under current-account scope', nativeOptions, async t => {
  const f = await fixture(t);
  for (const [runtime, object] of [[f.native.runtime, 'sales.orders'], [f.native.subjects.oc_viewer.runtime, 'enterprise.a_orders'], [f.native.subjects.oc_analyst_a.runtime, 'enterprise.raw_orders'], [f.native.subjects.oc_analyst_b.runtime, 'enterprise.raw_orders']] as const) {
    const saved = await f.source(runtime, [object]);
    const described = await f.port('describe', { connectionId: saved.connection.id, object }, f.context());
    assert.deepEqual((described.details.observation as { source: { actor?: unknown } }).source.actor, { loginRole: runtime.username, effectiveRole: runtime.username, visibleScope: 'current-account-visible' });
  }
});

test('PostgreSQL v0.5 Host wrong synthetic password ends without fencing a corrected connection test', nativeOptions, async t => {
  const f = await fixture(t), { id: _id, revision: _revision, fingerprint: _fingerprint, ...input } = f.native.runtime;
  const failed = await f.host.request('POST', '/api/db-link/connections/test', { ...input, password: `invalid-synthetic-${randomUUID()}` });
  assert.equal(failed?.body.code, 'db_test_failed', 'authentication failure is reported without exposing the native error or credential');
  const state = JSON.parse(await readFile(join(f.projects.dataRoot, 'db-link', 'connections.json'), 'utf8')) as { unconfirmedTests?: unknown[] };
  assert.deepEqual(state.unconfirmedTests ?? [], [], 'known no-SQL connect/end completion clears its original unfinished test fact');
  const corrected = await f.source(f.native.runtime, ['sales.orders']);
  assert.equal(corrected.receipt.reachable, true);
  assert.equal(corrected.connection.username, f.native.runtime.username);
});

test('PostgreSQL v0.5 Host original scalar and explicit prefix queries retain exact SQL, precision and coverage', nativeOptions, async t => {
  const f = await fixture(t), saved = await f.source(f.native.runtime, ['sales.orders']);
  assert.equal(saved.receipt.queryQualified, true, 'Actual native qualification is required; no gate override exists');
  const sql = 'SELECT id,amount,created_at FROM sales.orders WHERE id=$1', parameters = [{ kind: 'number', value: f.native.truth.exactId, databaseType: 'BIGINT' }];
  const scalar = await f.query(saved.connection.id, sql, parameters); assert.equal(scalar.details.status, 'complete');
  const read = await f.port('read-result', { resultId: scalar.details.resultId }, f.context());
  assert.deepEqual(read.details.rows, [[f.native.truth.exactId, f.native.truth.exactAmount, f.native.truth.exactCreatedAt]]);
  assert.equal((read.details.source as { sql: string }).sql, sql);
  const session = (read.details.source as { session: { loginRole?: string; effectiveRole?: string; visibleScope?: string } }).session;
  assert.equal(session.loginRole, f.native.runtime.username); assert.equal(session.effectiveRole, f.native.runtime.username); assert.equal(session.visibleScope, 'current-account-visible');
  const prefixSql = 'SELECT id,octet_length(note) AS original_bytes,substring(note,CAST($1 AS INTEGER),CAST($2 AS INTEGER)) AS prefix FROM sales.orders WHERE id=$3';
  const prefix = await f.query(saved.connection.id, prefixSql, [{ kind: 'number', value: '1' }, { kind: 'number', value: '3' }, ...parameters], 'Explicit first three characters only; original note body was not requested.');
  assert.equal(prefix.details.status, 'complete');
  const preview = await f.port('read-result', { resultId: prefix.details.resultId }, f.context());
  assert.deepEqual(preview.details.rows, [[f.native.truth.exactId, String(f.native.truth.note.bytes), 'Aé🧪']]);
  assert.equal((preview.details.source as { sql: string }).sql, prefixSql);
  assert.match((preview.details.source as { scopeNote: { text: string } }).scopeNote.text, /first three characters/);
});

test('PostgreSQL v0.5 Host no-resource segmented and inexact parameter rejections permit a new supported query', nativeOptions, async t => {
  const f = await fixture(t), saved = await f.source(f.native.runtime, ['sales.orders']);
  assert.equal(saved.receipt.queryQualified, true, 'Actual native qualification is required; no gate override exists');
  const segmented = await f.port('query', { connectionId: saved.connection.id, sql: 'SELECT id,octet_length(payload) AS total,substring(payload,$1,$2) AS piece FROM sales.orders WHERE id=$3', parameters: [{ kind: 'number', value: '1' }, { kind: 'number', value: '32' }, { kind: 'number', value: f.native.truth.exactId }], segmentRead: { valueColumn: 2, totalBytesColumn: 1, keyColumns: [0] } }, f.context());
  assert.deepEqual({ status: segmented.details.status, code: segmented.details.code, phase: segmented.details.phase, dispatched: segmented.details.dispatched }, { status: 'rejected', code: 'db_segment_read_unsupported', phase: 'pre-dispatch', dispatched: false });
  const inexact = await f.port('query', { connectionId: saved.connection.id, sql: 'SELECT id FROM sales.orders WHERE payload=$1', parameters: [{ kind: 'binary', value: 'AB==' }] }, f.context());
  assert.deepEqual({ status: inexact.details.status, code: inexact.details.code, phase: inexact.details.phase, dispatched: inexact.details.dispatched }, { status: 'rejected', code: 'db_parameter_invalid_or_inexact', phase: 'pre-dispatch', dispatched: false });
  const before = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results?taskId=${f.task.id}`); assert.deepEqual(before?.body.results, []);
  const corrected = await f.query(saved.connection.id, 'SELECT id FROM sales.orders WHERE id=$1', [{ kind: 'number', value: f.native.truth.exactId }]);
  assert.equal(corrected.details.status, 'complete');
  const read = await f.port('read-result', { resultId: corrected.details.resultId }, f.context()); assert.deepEqual(read.details.rows, [[f.native.truth.exactId]]);
});

test('PostgreSQL v0.5 Host row-limit receipts preserve actual decoded rows separately from saved rows', nativeOptions, async t => {
  const f = await fixture(t), runtime = { ...f.native.runtime, budget: { ...f.native.runtime.budget, maxRows: 1 } }, saved = await f.source(runtime, ['synthetic.numbers']);
  assert.equal(saved.receipt.queryQualified, true, 'Actual native qualification is required; no gate override exists');
  const result = await f.query(saved.connection.id, 'SELECT n FROM synthetic.numbers ORDER BY n');
  assert.notEqual(result.details.status, 'complete'); assert.ok(result.details.resultId);
  const acquired = result.details.acquisition as { driverReceivedRows: number; rowAccounting: string; transport: { scope: string } };
  assert.equal(acquired.rowAccounting, 'after-driver-decode'); assert.equal(acquired.transport.scope, 'physical-connection');
  assert.ok(acquired.driverReceivedRows > Number(result.details.persistedRows));
  const read = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results/${result.details.resultId}`);
  const manifest = read!.body.manifest as { persistedRows: number; acquisition: { driverReceivedRows: number } };
  assert.equal(manifest.acquisition.driverReceivedRows, acquired.driverReceivedRows); assert.ok(manifest.acquisition.driverReceivedRows > manifest.persistedRows);
});

test('PostgreSQL v0.5 Host reuses one parent request for seven finite reads beyond the single-operation row allowance', nativeOptions, async t => {
  const f = await fixture(t), runtime = { ...f.native.runtime, budget: { ...f.native.runtime.budget, maxRows: 1 } }, saved = await f.source(runtime, ['sales.orders']);
  assert.equal(saved.receipt.queryQualified, true);
  const parent = f.context(); let received = 0;
  for (let attempt = 0; attempt < 7; attempt++) {
    const result = await f.port('query', { connectionId: saved.connection.id, sql: 'SELECT id FROM sales.orders WHERE id=$1', parameters: [{ kind: 'number', value: f.native.truth.exactId }] }, { ...parent, toolCallId: randomUUID() });
    assert.equal(result.details.status, 'complete'); assert.deepEqual(result.details.resourceState, ended);
    assert.equal(result.details.persistedRows, 1); received += Number(result.details.persistedRows);
  }
  assert.equal(received, 7); assert.ok(received > runtime.budget.maxRows);
  const history = await f.host.request('GET', `/api/projects/${f.project.id}/db-link/results?taskId=${f.task.id}`);
  assert.equal((history!.body.results as unknown[]).length, 7, 'each independent read is retained; the parent has no cumulative SQL limit');
});

test('PostgreSQL v0.5 Host consumes a formal owner view without base-table grant and retains invoker permission failure', nativeOptions, async t => {
  const f = await fixture(t), saved = await f.source(f.native.subjects.oc_viewer.runtime, ['enterprise.a_orders', 'enterprise.invoker_orders']);
  assert.equal(saved.receipt.queryQualified, true, 'Actual native qualification is required; no gate override exists');
  const result = await f.query(saved.connection.id, 'SELECT id,amount FROM enterprise.a_orders ORDER BY id'); assert.equal(result.details.status, 'complete');
  const read = await f.port('read-result', { resultId: result.details.resultId }, f.context());
  assert.deepEqual((read.details.rows as string[][]).map(row => row[0]), f.native.truth.enterprise.aIds);
  assert.equal((read.details.source as { session: { effectiveRole?: string } }).session.effectiveRole, 'oc_viewer', 'a formal owner view does not change the captured calling identity into its internal owner');
  assert.ok((read.details.source as { limitations?: string[] }).limitations?.includes('db_view_scope_not_independently_verified'), 'fixed material retains the formal-view coverage limitation');
  await assert.rejects(f.port('query', { connectionId: saved.connection.id, sql: 'SELECT id FROM enterprise.raw_orders' }, f.context()), /db_object_not_authorized/);
  const invoker = await f.query(saved.connection.id, 'SELECT id FROM enterprise.invoker_orders ORDER BY id');
  assert.notEqual(invoker.details.status, 'complete');
  assert.ok(invoker.details.errorCode, 'the original native permission failure is returned; no alternative identity is selected');
});

test('PostgreSQL v0.5 Host keeps two existing RLS identities isolated across normal fresh operations', nativeOptions, async t => {
  const f = await fixture(t), a = await f.source(f.native.subjects.oc_analyst_a.runtime, ['enterprise.raw_orders', 'enterprise.invoker_orders']), b = await f.source(f.native.subjects.oc_analyst_b.runtime, ['enterprise.raw_orders', 'enterprise.invoker_orders']);
  assert.equal(a.receipt.queryQualified, true, 'Actual native qualification is required; no gate override exists'); assert.equal(b.receipt.queryQualified, true);
  for (const [connectionId, expected] of [[a.connection.id, f.native.truth.enterprise.aIds], [b.connection.id, f.native.truth.enterprise.bIds], [a.connection.id, f.native.truth.enterprise.aIds]] as const) {
    const result = await f.query(connectionId, 'SELECT id,amount FROM enterprise.raw_orders ORDER BY id'); assert.equal(result.details.status, 'complete');
    const read = await f.port('read-result', { resultId: result.details.resultId }, f.context());
    assert.deepEqual((read.details.rows as string[][]).map(row => row[0]), expected);
    const expectedRole = connectionId === a.connection.id ? 'oc_analyst_a' : 'oc_analyst_b';
    assert.equal((read.details.source as { session: { loginRole?: string; effectiveRole?: string; visibleScope?: string } }).session.loginRole, expectedRole);
    assert.equal((read.details.source as { session: { effectiveRole?: string } }).session.effectiveRole, expectedRole);
    assert.equal((read.details.source as { session: { visibleScope?: string } }).session.visibleScope, 'current-account-visible');
    assert.ok((read.details.source as { limitations?: string[] }).limitations?.includes('db_current_role_policy_visible_scope'), 'fixed material retains the RLS scope limitation');
    assert.ok((result.details.limitations as string[]).some(limitation => /(?:rls|policy|account|identity|visible)/i.test(limitation)), 'current identity coverage must accompany complete SQL reception');
  }
});
