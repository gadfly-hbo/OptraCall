import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDbLinkDriver } from '../src/host/db-link-driver.ts';
import type { DbLinkPgCursor } from '../src/host/db-link-driver.ts';
import type { ClientConfig } from 'pg';
import type { DbLinkRuntimeConnection } from '../src/host/db-link-types.ts';

const configuration = (): DbLinkRuntimeConnection => ({
  id: 'lifecycle-source', revision: 1, fingerprint: 'lifecycle-one', name: 'Synthetic lifecycle source', engine: 'postgresql',
  host: 'db.example.test', port: 5432, database: 'synthetic', username: 'restricted_reader', password: 'synthetic-password',
  tls: { rejectUnauthorized: true, verifyIdentity: true },
  budget: { connectTimeoutMs: 100, queryTimeoutMs: 100, lockTimeoutMs: 50, maxRows: 10, maxBytes: 10000, maxCellBytes: 1000, chunkBytes: 1000, maxConcurrent: 1 },
});
function lifecycleServer() {
  const statements: string[] = [], configs: ClientConfig[] = [];
  let ends = 0, transactionSetting: string | null = '0', wireLoss = false;
  let endHold: Promise<void> | undefined, rollbackHold: Promise<void> | undefined;
  const connect = (config: ClientConfig) => {
    configs.push(config);
    return { async connect() {}, async end() { ends++; await endHold; }, on() {}, async query(input: unknown) {
      const sql = (input as { text?: string }).text ?? ''; statements.push(sql);
      if (sql.includes('db-link:capabilities')) return { rows: [{ transaction_timeout: transactionSetting }] };
      if (sql.includes('db-link:transaction-settings')) return { rows: [{ transaction_timeout_ms: 50, statement_timeout_ms: 50, idle_timeout_ms: 50, lock_timeout_ms: 50, read_only: 'on' }] };
      if (sql.includes('db-link:identity')) return { rows: [{ server_version_num: transactionSetting === null ? '150000' : '180001', database: 'synthetic', current_user: 'restricted_reader', session_user: 'restricted_reader', server_address: '192.0.2.1', server_port: 5432, timezone: 'UTC', encoding: 'UTF8', isolation: 'repeatable read', search_path: 'pg_catalog', statement_timeout_ms: 100, lock_timeout_ms: 50, datestyle: 'ISO, YMD', intervalstyle: 'postgres', bytea_output: 'hex', extra_float_digits: '3' }] };
      if (sql.includes('db-link:roles')) {
        if (wireLoss) throw Object.assign(new Error('lost original metadata response'), { code: 'ECONNRESET' });
        return { rows: [{ oid: 500, rolname: 'restricted_reader', rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false }] };
      }
      if (sql === 'ROLLBACK') await rollbackHold;
      return { rows: [] };
    } };
  };
  return { connect, statements, configs, get ends() { return ends; }, olderPg() { transactionSetting = null; },
    loseWire() { wireLoss = true; }, holdEnd(promise: Promise<void>) { endHold = promise; }, holdRollback(promise: Promise<void>) { rollbackHold = promise; } };
}
const complete = { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true };

test('v0.5 startup uses portable native read-only/statement/lock/idle bounds and sets transaction_timeout only when available', async () => {
  const server = lifecycleServer(); server.olderPg();
  const catalog = await createDbLinkDriver({ postgresClient: server.connect }).catalog(configuration());
  assert.equal(catalog.observation.queryQualified, false);
  assert.ok(catalog.observation.limitations.includes('db_pg_version_not_validated'));
  assert.doesNotMatch(server.configs[0].options ?? '', /(?:^|\s)-c transaction_timeout=/);
  assert.match(server.configs[0].options ?? '', /(?:^|\s)-c default_transaction_read_only=on(?:\s|$)/);
  assert.match(server.configs[0].options ?? '', /(?:^|\s)-c idle_in_transaction_session_timeout=100(?:\s|$)/);
  assert.equal(server.statements.some(sql => sql.includes("set_config('transaction_timeout'")), false);
  assert.deepEqual(catalog.resourceState, complete);
});

test('v0.5 normal command and rollback plus public end finish the operation without observing backend disappearance', async () => {
  const server = lifecycleServer();
  const catalog = await createDbLinkDriver({ postgresClient: server.connect }).catalog(configuration());
  assert.deepEqual(catalog.resourceState, complete); assert.equal(server.configs.length, 1);
  assert.equal(server.statements.some(sql => /pg_control_system|pg_stat_activity|pg_cancel_backend|pg_terminate_backend/.test(sql)), false);
  const begin = server.statements.indexOf('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const timers = server.statements.findIndex(sql => sql.includes("set_config('transaction_timeout'"));
  const roles = server.statements.findIndex(sql => sql.includes('db-link:roles'));
  assert.ok(timers >= 0 && timers < begin && begin < roles && roles < server.statements.indexOf('ROLLBACK'));
  const count = server.statements.length; assert.deepEqual(await catalog.cleanup!(), complete); assert.equal(server.statements.length, count);
});

test('v0.5 a lost original response remains UNKNOWN even if public client.end resolves; cleanup never reconnects or replays', async () => {
  const server = lifecycleServer(); server.loseWire();
  const catalog = await createDbLinkDriver({ postgresClient: server.connect }).catalog(configuration());
  assert.equal(catalog.resourceState?.remoteTerminal, false); assert.equal(catalog.resourceState?.connectionEnded, true);
  assert.ok(catalog.observation.limitations.includes('db_probe_connection_close_unknown'));
  const before = server.statements.length;
  assert.equal((await catalog.cleanup!()).remoteTerminal, false);
  assert.equal(server.statements.length, before); assert.equal(server.configs.length, 1);
});

test('v0.5 original public end must really resolve; cleanup retains and awaits the same end handle', async () => {
  const server = lifecycleServer(); let release!: () => void;
  server.holdEnd(new Promise<void>(resolve => { release = resolve; }));
  const catalog = await createDbLinkDriver({ postgresClient: server.connect }).catalog(configuration());
  assert.equal(catalog.resourceState?.remoteTerminal, true); assert.equal(catalog.resourceState?.connectionEnded, false);
  assert.equal((await catalog.cleanup!()).connectionEnded, false); assert.equal(server.ends, 1);
  release(); assert.deepEqual(await catalog.cleanup!(), complete); assert.equal(server.ends, 1); assert.equal(server.configs.length, 1);
});

test('v0.5 original late ROLLBACK response can finish cleanup without a replacement connection or another ROLLBACK', async () => {
  const server = lifecycleServer(); let release!: () => void;
  server.holdRollback(new Promise<void>(resolve => { release = resolve; }));
  const catalog = await createDbLinkDriver({ postgresClient: server.connect }).catalog(configuration());
  assert.equal(catalog.resourceState?.transactionEnded, false); assert.equal(server.ends, 0);
  release(); assert.deepEqual(await catalog.cleanup!(), complete);
  assert.equal(server.statements.filter(sql => sql === 'ROLLBACK').length, 1); assert.equal(server.configs.length, 1);
});

test('v0.5 a pending original cursor read blocks close/rollback until its real callback and suppresses stopped late rows', async () => {
  const server = lifecycleServer(), driver = createDbLinkDriver({ postgresClient: server.connect, postgresCursor: () => cursor });
  const catalog = await driver.catalog(configuration()), controller = new AbortController();
  let callback: Parameters<DbLinkPgCursor['read']>[1] | undefined, cursorClosed = 0, delivered = 0, entered!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const cursor: DbLinkPgCursor = { read(_rows, cb) { callback = cb; entered(); }, async close() { cursorClosed++; } };
  const baselineRollbacks = server.statements.filter(sql => sql === 'ROLLBACK').length;
  const running = driver.openQuery(configuration(), { sql: 'SELECT 1', parameters: [], scope: { objects: ['*'] }, signal: controller.signal,
    expectedSourceIdentity: catalog.observation.sourceIdentity, expectedPermissionBinding: catalog.observation.permissionBinding,
    onColumns() { delivered++; }, onRows() { delivered++; } });
  await reading; controller.abort(); await Promise.resolve(); assert.equal(cursorClosed, 0);
  assert.equal(server.statements.filter(sql => sql === 'ROLLBACK').length, baselineRollbacks);
  callback!(undefined, [['1']], { fields: [{ name: '?column?', dataTypeID: 23 }] });
  const terminal = await running;
  assert.equal(terminal.status, 'cancelled'); assert.equal(delivered, 0); assert.equal(cursorClosed, 1); assert.deepEqual(terminal.resourceState, complete);
});

test('v0.5 unsupported complete segmentation is rejected before any physical connection', async () => {
  let created = 0;
  const driver = createDbLinkDriver({ postgresClient() { created++; throw new Error('must not connect'); } });
  const terminal = await driver.openQuery(configuration(), { sql: 'SELECT 1,2,3', parameters: [], scope: { objects: ['*'] }, expectedSourceIdentity: '', expectedPermissionBinding: '',
    segmentRead: { valueColumn: 0, totalBytesColumn: 1, keyColumns: [2] }, onValueSegment: async () => undefined, onColumns() {}, onRows() {} });
  assert.equal(terminal.errorCode, 'db_segment_read_unsupported'); assert.equal(created, 0);
});

test('invalid full-value plans and native timer values fail before connection creation', async () => {
  let created = 0; const driver = createDbLinkDriver({ postgresClient() { created++; throw new Error('must not connect'); } });
  const terminal = await driver.openQuery(configuration(), { sql: 'SELECT 1', parameters: [], scope: { objects: ['*'] }, expectedSourceIdentity: '', expectedPermissionBinding: '',
    segmentRead: { valueColumn: 0, totalBytesColumn: 0, keyColumns: [] }, onValueSegment: async () => undefined, onColumns() {}, onRows() {} });
  assert.equal(terminal.errorCode, 'db_segment_plan_invalid');
  const config = configuration(); config.budget.queryTimeoutMs = 2147483648;
  assert.ok((await driver.catalog(config)).observation.limitations.includes('db_budget_invalid')); assert.equal(created, 0);
});

test('a task-excluded PostgreSQL object cannot acquire any native connection', async () => {
  let created = 0;
  const terminal = await createDbLinkDriver({ postgresClient() { created++; throw new Error('must not connect'); } }).openQuery(configuration(), {
    sql: 'SELECT amount FROM private.payroll', parameters: [], scope: { objects: ['public.orders'] },
    expectedSourceIdentity: '', expectedPermissionBinding: '', onColumns() {}, onRows() {},
  });
  assert.equal(terminal.errorCode, 'db_query_object_not_authorized'); assert.equal(created, 0);
});

test('v0.5 a timed-out result consumer stays on the original operation until its real promise settles', async () => {
  const server = lifecycleServer(); let release!: () => void, entered!: () => void, closed = 0, reads = 0;
  const held = new Promise<void>(resolve => { release = resolve; }), writing = new Promise<void>(resolve => { entered = resolve; });
  const cursor: DbLinkPgCursor = { read(_rows, callback) { reads++; callback(undefined, reads === 1 ? [['1']] : [], { fields: [{ name: '?column?', dataTypeID: 23 }] }); }, async close() { closed++; } };
  const driver = createDbLinkDriver({ postgresClient: server.connect, postgresCursor: () => cursor }), catalog = await driver.catalog(configuration());
  const running = driver.openQuery(configuration(), { sql: 'SELECT 1', parameters: [], scope: { objects: ['*'] }, expectedSourceIdentity: catalog.observation.sourceIdentity,
    expectedPermissionBinding: catalog.observation.permissionBinding, onColumns() {}, async onRows() { entered(); await held; } });
  await writing;
  const terminal = await running;
  assert.equal(terminal.status, 'unknown'); assert.equal(terminal.resourceState?.connectionEnded, false); assert.equal(closed, 0); assert.equal(reads, 1);
  release(); assert.deepEqual(await terminal.cleanup!(), complete); assert.equal(closed, 1); assert.equal(reads, 1);
});

test('v0.5 settled connect rejection and settled local end finish an operation that dispatched no SQL', async () => {
  for (const code of ['28P01','ECONNREFUSED','CERT_HAS_EXPIRED']) {
    let queries = 0, ends = 0;
    const catalog = await createDbLinkDriver({ postgresClient() { return {
      async connect() { throw Object.assign(new Error('synthetic connection rejection'), { code }); },
      async end() { ends++; }, on() {}, async query() { queries++; throw new Error('must not dispatch SQL'); },
    }; } }).catalog(configuration());
    assert.equal(catalog.observation.reachable, false); assert.equal(catalog.observation.queryQualified, false);
    assert.deepEqual(catalog.resourceState, complete, code); assert.equal(queries, 0); assert.equal(ends, 1);
    assert.equal(catalog.observation.limitations.includes('db_probe_connection_close_unknown'), false, code);
  }
});

test('v0.5 an unsettled original connect cannot finish even when no SQL has been dispatched', async () => {
  let release!: () => void, ends = 0, queries = 0;
  const held = new Promise<void>(resolve => { release = resolve; }), config = configuration(); config.budget.queryTimeoutMs = 30;
  const catalog = await createDbLinkDriver({ postgresClient() { return {
    async connect() { await held; }, async end() { ends++; }, on() {}, async query() { queries++; throw new Error('must not dispatch SQL'); },
  }; } }).catalog(config);
  assert.equal(catalog.resourceState?.remoteTerminal, false); assert.equal(catalog.resourceState?.connectionEnded, false);
  assert.equal(ends, 0); assert.equal(queries, 0);
  release(); assert.deepEqual(await catalog.cleanup!(), complete); assert.equal(ends, 1); assert.equal(queries, 0);
});

test('v0.5 loss of the first dispatched metadata SQL response remains UNKNOWN before any BEGIN', async () => {
  let queries = 0, ends = 0;
  const catalog = await createDbLinkDriver({ postgresClient() { return {
    async connect() {}, async end() { ends++; }, on() {}, async query() {
      queries++; throw Object.assign(new Error('original first SQL response lost'), { code: 'ECONNRESET' });
    },
  }; } }).catalog(configuration());
  assert.equal(catalog.observation.reachable, true); assert.equal(catalog.observation.queryQualified, false);
  assert.equal(catalog.resourceState?.remoteTerminal, false); assert.equal(catalog.resourceState?.commandTerminal, false);
  assert.equal(catalog.resourceState?.connectionEnded, true); assert.equal(catalog.resourceState?.transactionEnded, true);
  assert.equal(queries, 1); assert.equal(ends, 1); assert.ok(catalog.observation.limitations.includes('db_probe_connection_close_unknown'));
  assert.equal((await catalog.cleanup!()).remoteTerminal, false); assert.equal(queries, 1); assert.equal(ends, 1);
});

test('v0.5 public openQuery reports a settled no-SQL connect refusal as error rather than UNKNOWN', async () => {
  for (const code of ['28P01','ECONNREFUSED','CERT_HAS_EXPIRED']) {
    let queries = 0;
    const terminal = await createDbLinkDriver({ postgresClient() { return {
      async connect() { throw Object.assign(new Error('synthetic refused connection'), { code }); }, async end() {}, on() {},
      async query() { queries++; throw new Error('no SQL may dispatch'); },
    }; } }).openQuery(configuration(), { sql: 'SELECT 1', parameters: [], scope: { objects: ['*'] }, expectedSourceIdentity: '', expectedPermissionBinding: '', onColumns() {}, onRows() {} });
    assert.equal(terminal.status, 'error', code); assert.equal(terminal.errorCode, code); assert.deepEqual(terminal.resourceState, complete); assert.equal(queries, 0);
  }
});

test('v0.5 public openQuery preserves cancellation after the original no-SQL connection attempt settles', async () => {
  let rejectConnect!: (error: Error) => void, entered!: () => void;
  const connecting = new Promise<void>((_resolve, reject) => { rejectConnect = reject; }), started = new Promise<void>(resolve => { entered = resolve; });
  const controller = new AbortController(), driver = createDbLinkDriver({ postgresClient() { return {
    async connect() { entered(); await connecting; }, async end() {}, on() {}, async query() { throw new Error('no SQL may dispatch'); },
  }; } });
  const running = driver.openQuery(configuration(), { sql: 'SELECT 1', parameters: [], scope: { objects: ['*'] }, signal: controller.signal,
    expectedSourceIdentity: '', expectedPermissionBinding: '', onColumns() {}, onRows() {} });
  await started; controller.abort(); rejectConnect(Object.assign(new Error('synthetic refused connection'), { code: 'ECONNREFUSED' }));
  const terminal = await running; assert.equal(terminal.status, 'cancelled'); assert.deepEqual(terminal.resourceState, complete);
});

test('v0.5 public catalog honors the parent stop after a late original metadata response and dispatches only technical cleanup', async () => {
  const server = lifecycleServer(); let entered!: () => void, release!: () => void, settled = false;
  const held = new Promise<void>(resolve => { release = resolve; }), observed = new Promise<void>(resolve => { entered = resolve; }), controller = new AbortController();
  const driver = createDbLinkDriver({ postgresClient(config) {
    const client = server.connect(config);
    return { ...client, async query(input: unknown) {
      if ((input as { text?: string }).text?.includes('db-link:identity')) { entered(); await held; }
      return client.query(input);
    } };
  } });
  const running = driver.catalog(configuration(), { signal: controller.signal, remainingBudgetMs: () => 100 }).then(value => { settled = true; return value; });
  await observed; controller.abort(); const stoppedAt = server.statements.length; await Promise.resolve(); assert.equal(settled, false);
  release(); const catalog = await running;
  assert.equal(catalog.observation.queryQualified, false); assert.ok(catalog.observation.limitations.includes('db_query_stopped'));
  assert.equal(server.statements.some(sql => /db-link:roles|db-link:namespace|db-link:relations|db-link:columns/.test(sql)), false);
  assert.deepEqual(server.statements.slice(stoppedAt).filter(sql => !sql.includes('db-link:identity')), ['ROLLBACK']);
  assert.deepEqual(catalog.resourceState, complete);
});

test('v0.5 public catalog refuses an exhausted parent budget before creating a native client', async () => {
  let created = 0;
  const catalog = await createDbLinkDriver({ postgresClient(config) { created++; return lifecycleServer().connect(config); } })
    .catalog(configuration(), { remainingBudgetMs: () => 0 });
  assert.equal(created, 0); assert.equal(catalog.observation.queryQualified, false);
  assert.ok(catalog.observation.limitations.includes('db_operation_budget_exhausted')); assert.deepEqual(catalog.resourceState, complete);
});

test('v0.5 public openQuery pure technical rejections prove no native resource was dispatched', async () => {
  let created = 0; const controller = new AbortController(); controller.abort();
  const driver = createDbLinkDriver({ postgresClient() { created++; throw new Error('no native client may be created'); } });
  const base = { sql: 'SELECT 1', parameters: [], scope: { objects: ['*'] }, expectedSourceIdentity: '', expectedPermissionBinding: '', onColumns() {}, onRows() {} };
  const segmented = await driver.openQuery(configuration(), { ...base, segmentRead: { valueColumn: 0, totalBytesColumn: 1, keyColumns: [2] }, onValueSegment: async () => undefined });
  const inexact = await driver.openQuery(configuration(), { ...base, parameters: [{ kind: 'number', value: 9007199254740992 }] });
  const stopped = await driver.openQuery(configuration(), { ...base, signal: controller.signal });
  for (const [terminal, status, code] of [[segmented,'error','db_segment_read_unsupported'], [inexact,'error','db_parameter_invalid_or_inexact'], [stopped,'cancelled','db_query_stopped']] as const) {
    assert.equal(terminal.status, status); assert.equal(terminal.errorCode, code); assert.equal(terminal.dispatched, false);
    assert.deepEqual(terminal.resourceState, complete); assert.equal(terminal.remoteTerminal, true); assert.equal(terminal.connectionEnded, true);
  }
  assert.equal(created, 0);
});

test('v0.5 actual first decoded batch is counted before stop or failing column delivery without publishing late rows', async () => {
  for (const mode of ['stopped-first-batch','columns-consumer-fails'] as const) {
    const server = lifecycleServer(), controller = new AbortController(); let entered!: () => void, callback: Parameters<DbLinkPgCursor['read']>[1] | undefined, delivered = 0;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const cursor: DbLinkPgCursor = { read(_rows, cb) { callback = cb; entered(); }, async close() {} };
    const driver = createDbLinkDriver({ postgresClient: server.connect, postgresCursor: () => cursor }), catalog = await driver.catalog(configuration());
    const running = driver.openQuery(configuration(), { sql: 'SELECT 1', parameters: [], scope: { objects: ['*'] }, signal: controller.signal,
      expectedSourceIdentity: catalog.observation.sourceIdentity, expectedPermissionBinding: catalog.observation.permissionBinding,
      onColumns() { if (mode === 'columns-consumer-fails') throw new Error('synthetic column sink failure'); }, onRows() { delivered++; } });
    await reading; if (mode === 'stopped-first-batch') controller.abort();
    callback!(undefined, [['1']], { fields: [{ name: 'one', dataTypeID: 23 }] });
    const terminal = await running;
    assert.equal(terminal.rowsReceived, 1, mode); assert.equal(delivered, 0, mode);
    assert.equal(terminal.status, mode === 'stopped-first-batch' ? 'cancelled' : 'error');
    assert.equal(terminal.errorCode, mode === 'stopped-first-batch' ? 'db_query_stopped' : 'db_result_delivery_failed');
    assert.deepEqual(terminal.resourceState, complete);
  }
});

test('v0.5 a decoded callback after the read deadline records only its real late row count and never delivers business data', async () => {
  const server = lifecycleServer(); let entered!: () => void, callback: Parameters<DbLinkPgCursor['read']>[1] | undefined, delivered = 0;
  const reading = new Promise<void>(resolve => { entered = resolve; }), cursor: DbLinkPgCursor = { read(_rows, cb) { callback = cb; entered(); }, async close() {} };
  const driver = createDbLinkDriver({ postgresClient: server.connect, postgresCursor: () => cursor }), catalog = await driver.catalog(configuration());
  const running = driver.openQuery(configuration(), { sql: 'SELECT 1', parameters: [], scope: { objects: ['*'] },
    expectedSourceIdentity: catalog.observation.sourceIdentity, expectedPermissionBinding: catalog.observation.permissionBinding,
    onColumns() { delivered++; }, onRows() { delivered++; } });
  await reading; const terminal = await running;
  assert.equal(terminal.status, 'unknown'); assert.equal(terminal.rowsReceived, 0, 'no callback means no row count can yet be claimed');
  callback!(undefined, [['1'],['2']], { fields: [{ name: 'one', dataTypeID: 23 }] });
  assert.deepEqual(await terminal.cleanup!(), complete);
  assert.equal(terminal.rowsReceived, 2); assert.equal(delivered, 0);
});
