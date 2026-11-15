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
import type { DbResultCell, DbResultValueRef } from '../src/host/db-link-results.ts';

const configPath = process.env.OPTRACALL_DB_PG_V04_CONFIG;
const nativeOptions = { skip: configPath ? false : 'Requires the explicitly managed isolated PostgreSQL v0.4 fixture' };
type NativeInput = { runtime: DbLinkRuntimeConnection; truth: { exactId: string; exactAmount: string; exactCreatedAt: string; payload: { bytes: number; sha256: string } } };

async function fixture(t: TestContext, maxCellBytes?: number) {
  const native = JSON.parse(await readFile(configPath!, 'utf8')) as NativeInput;
  const root = await mkdtemp(join(tmpdir(), 'db-host-pg-native-'));
  const projects = new ProjectStore({ dataRoot: join(root, 'host'), projectsRoot: join(root, 'projects') });
  await projects.init();
  const configuration: RuntimeModelConfiguration = { id: 'pg-native-unused-model', revision: 1, name: 'Synthetic model configuration only', provider: 'synthetic', api: 'openai-completions', model: 'unused-native-model', baseUrl: 'https://synthetic.invalid/v1', apiKey: 'synthetic-unused-native-only' };
  const project = await projects.create({ name: 'PG native Host admission', configuration }), task = await projects.createTask(project.id, { name: 'Source query' });
  const data = new ProjectDataContextStore({ dataRoot: projects.dataRoot, projects });
  let tail: Promise<unknown> = Promise.resolve();
  const host = createDbLinkHost({ dataRoot: projects.dataRoot, projects, data, configurationSnapshot: (id, revision) => id === configuration.id && (revision === undefined || revision === configuration.revision) ? structuredClone(configuration) : undefined,
    mutate: operation => { const next = tail.then(operation); tail = next.catch(() => {}); return next; }, isClosing: () => false });
  await host.init();
  const cleanups: ((options: { retryFailed?: boolean }) => Promise<void>)[] = [];
  t.after(async () => {
    try { for (const cleanup of cleanups) await cleanup({ retryFailed: true }); }
    finally { await projects.close(); await rm(root, { recursive: true, force: true }); }
  });
  const context = (): DbLinkCallContext => {
    const controller = new AbortController();
    return { signal: controller.signal, requestId: randomUUID(), sessionId: randomUUID(), toolCallId: randomUUID(), runToken: {}, assertCurrent: () => controller.signal.throwIfAborted(), registerCleanup: cleanup => { cleanups.push(cleanup); } };
  };
  const { id: _id, revision: _revision, fingerprint: _fingerprint, ...input } = native.runtime;
  const connection: DbLinkConnectionInput = { ...input, budget: { ...input.budget, ...(maxCellBytes === undefined ? {} : { maxCellBytes }) } };
  const tested = await host.request('POST', '/api/db-link/connections/test', connection);
  assert.equal(tested?.status, 200, `the real native connection test must return a Host receipt (${String(tested?.body.code ?? 'no error code')})`);
  const testReceipt = tested!.body.receipt as DbLinkTestReceipt;
  assert.equal(testReceipt.reachable, true);
  const saved = await host.request('POST', '/api/db-link/connections', { configuration: connection, testReceiptId: testReceipt.id });
  assert.equal(saved?.status, 200);
  const selected = saved!.body.connection as DbLinkPublicConnection;
  assert.equal(JSON.stringify(selected).includes(native.runtime.password), false, 'the public saved connection never returns the source credential');
  const grant = await host.request('POST', `/api/projects/${project.id}/db-link/sources`, { connectionId: selected.id, scope: { objects: ['sales.orders', 'synthetic.numbers'] }, modelExport: { targets: [configuration.id], structure: true, comments: false, queryText: true, results: true } });
  assert.equal(grant?.status, 200);
  return { root, host, project, projects, task, configuration, selected, testReceipt, truth: native.truth, context,
    port: host.port(project.id, task.id, configuration),
    async cleanup() { for (const cleanup of cleanups.splice(0)) await cleanup({ retryFailed: true }); },
    async results() { const response = await host.request('GET', `/api/projects/${project.id}/db-link/results?taskId=${task.id}`); assert.equal(response?.status, 200); return response!.body.results as { id: string; status: string; rows: number }[]; } };
}

test('real PostgreSQL Host preserves the closed native admission and publishes no result rows', nativeOptions, async t => {
  const f = await fixture(t);
  assert.equal(f.testReceipt.queryQualified, false, 'current source admission stays closed until key native counterexamples are proved');
  const index = await f.port('sources', {}, f.context()), sources = index.details.sources as { connectionId: string; queryQualified: boolean }[];
  assert.equal(sources.length, 1); assert.equal(sources[0]!.connectionId, f.selected.id); assert.equal(sources[0]!.queryQualified, false);
  await assert.rejects(f.port('query', { connectionId: f.selected.id, sql: 'SELECT id,amount FROM sales.orders WHERE id=$1', parameters: [{ kind: 'number', value: f.truth.exactId, databaseType: 'BIGINT' }] }, f.context()), /db_query_not_qualified/);
  assert.deepEqual(await f.results(), []);
});

test('real PostgreSQL Host rejects another project, excluded task and unapproved model before any result publication', nativeOptions, async t => {
  const f = await fixture(t), other = await f.projects.create({ name: 'No source grant', configuration: f.configuration }), otherTask = await f.projects.createTask(other.id, { name: 'Unqualified source task' });
  const foreign = f.host.port(other.id, otherTask.id, f.configuration);
  assert.deepEqual((await foreign('sources', {}, f.context())).details.sources, []);
  await assert.rejects(foreign('query', { connectionId: f.selected.id, sql: 'SELECT id FROM sales.orders' }, f.context()), /db_source_not_authorized/);
  const wrongModel = f.host.port(f.project.id, f.task.id, { ...f.configuration, model: 'another-model-outlet' });
  assert.deepEqual((await wrongModel('sources', {}, f.context())).details.sources, []);
  await assert.rejects(wrongModel('query', { connectionId: f.selected.id, sql: 'SELECT id FROM sales.orders' }, f.context()), /db_model_export_not_authorized/);
  const excluded = await f.host.request('PUT', `/api/projects/${f.project.id}/tasks/${f.task.id}/db-link/sources/${f.selected.id}`, { excluded: true });
  assert.equal(excluded?.status, 200);
  await assert.rejects(f.port('query', { connectionId: f.selected.id, sql: 'SELECT id FROM sales.orders' }, f.context()), /db_source_not_authorized/);
  assert.deepEqual(await f.results(), []);
});

test('real PostgreSQL Host saves exact scalar result bytes only after actual source qualification', nativeOptions, async t => {
  const f = await fixture(t, 65536);
  if (!f.testReceipt.queryQualified) { t.skip('NOT_RUN: real source is not queryQualified; no test-only override'); return; }
  const result = await f.port('query', { connectionId: f.selected.id, sql: 'SELECT id,amount,created_at FROM sales.orders WHERE id=$1', parameters: [{ kind: 'number', value: f.truth.exactId, databaseType: 'BIGINT' }] }, f.context());
  assert.equal(result.details.status, 'complete');
  assert.deepEqual(result.details.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
  const loaded = await f.port('read-result', { resultId: result.details.resultId }, f.context());
  const rows = loaded.details.rows as DbResultCell[][];
  assert.deepEqual(rows, [[f.truth.exactId, f.truth.exactAmount, f.truth.exactCreatedAt]]);
  assert.equal((loaded.details.coverage as { complete: boolean }).complete, true);
  assert.deepEqual((await f.results()).map(item => ({ status: item.status, rows: item.rows })), [{ status: 'complete', rows: 1 }]);
  await f.cleanup();
  const fresh = await f.port('query', { connectionId: f.selected.id, sql: 'SELECT id FROM sales.orders WHERE id=$1', parameters: [{ kind: 'number', value: f.truth.exactId, databaseType: 'BIGINT' }] }, f.context());
  assert.equal(fresh.details.status, 'complete', 'only a new explicit request starts the next database observation');
  assert.deepEqual(fresh.details.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
});

test('real PostgreSQL Host retains a complete same-operation bytea value as bounded segments and enforces read ownership', nativeOptions, async t => {
  const f = await fixture(t, 65536);
  if (!f.testReceipt.queryQualified) { t.skip('NOT_RUN: real source is not queryQualified; no test-only override'); return; }
  const sql = 'SELECT id,octet_length(payload) AS total,substring(payload,$1,$2) AS piece FROM sales.orders WHERE id=$3';
  const result = await f.port('query', { connectionId: f.selected.id, sql, parameters: [{ kind: 'number', value: '1' }, { kind: 'number', value: '16384' }, { kind: 'number', value: f.truth.exactId, databaseType: 'BIGINT' }], segmentRead: { valueColumn: 2, totalBytesColumn: 1, keyColumns: [0] } }, f.context());
  assert.equal(result.details.status, 'complete');
  assert.deepEqual(result.details.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
  const loaded = await f.port('read-result', { resultId: result.details.resultId }, f.context());
  const rows = loaded.details.rows as DbResultCell[][], value = rows[0]![2] as DbResultValueRef;
  assert.equal(rows.length, 1); assert.equal(value.type, 'segmented');
  assert.equal(value.bytes, f.truth.payload.bytes); assert.equal(value.sha256, f.truth.payload.sha256);
  assert.equal((loaded.details.coverage as { complete: boolean }).complete, false);
  const source = loaded.details.source as { sql: string; parameters: unknown[]; session: { isolation: string } };
  assert.equal(source.sql, sql);
  assert.deepEqual(source.parameters, [{ kind: 'number', value: '1' }, { kind: 'number', value: '16384' }, { kind: 'number', value: f.truth.exactId, databaseType: 'BIGINT' }]);
  assert.equal(source.session.isolation, 'repeatable read');
  const page = await f.port('read-result', { resultId: result.details.resultId, valueId: value.valueId, startByte: 16382, maxBytes: 17 }, f.context());
  assert.equal((page.details.value as { coverage: { providedBytes: number; complete: boolean } }).coverage.providedBytes, 17);
  assert.equal((page.details.value as { coverage: { complete: boolean } }).coverage.complete, false);
  const anotherTask = await f.projects.createTask(f.project.id, { name: 'No original result owner' });
  await assert.rejects(f.host.port(f.project.id, anotherTask.id, f.configuration)('read-result', { resultId: result.details.resultId, valueId: value.valueId }, f.context()), /db_result_foreign_owner/);
  await f.host.request('PUT', `/api/projects/${f.project.id}/tasks/${f.task.id}/db-link/sources/${f.selected.id}`, { excluded: true });
  await assert.rejects(f.port('read-result', { resultId: result.details.resultId, valueId: value.valueId }, f.context()), /db_source_not_authorized/);
  await f.cleanup();
});
