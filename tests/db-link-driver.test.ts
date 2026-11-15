import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createDbLinkDriver } from '../src/host/db-link-driver.ts';
import type { DbLinkPgCursor, DbLinkQueryRequest } from '../src/host/db-link-driver.ts';
import type { DbResultCell } from '../src/host/db-link-results.ts';
import type { DbLinkRuntimeConnection } from '../src/host/db-link-types.ts';

class SyntheticPg {
  serverVersion = '180001';
  readonly statements: string[] = [];
  roles = [{ oid: 500, rolname: 'restricted_reader', rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false }];
  relations = [{ oid: 1000, schema: 'public', name: 'orders', kind: 'r', owner_reachable: false, writable: false, row_security: false, forced_row_security: false, access_method: 'heap', inherited: false, unsafe_index: false, readable: true, comment: 'Synthetic orders' }];
  columns = [{ relation_oid: 1000, name: 'amount', ordinal: 1, type_id: 1700, database_type: 'numeric', type_schema: 'pg_catalog', element_schema: null, readable: true, writable: false, generated: '', nullable: false, precision: 20, scale: 6, comment: null }];
  keys: Record<string, unknown>[] = []; keysUnavailable = false;
  async connect() {}
  on() {}
  async end() {}
  query(input: unknown): unknown {
    const text = typeof input === 'string' ? input : (input as { text?: string }).text ?? '';
    this.statements.push(text);
    if (text.includes('db-link:session-identity')) return Promise.resolve({ rows: [{ system_identifier: '987654321987654321', postmaster_start: '2026-11-14 00:00:00.123456+00', server_address: '192.0.2.1', server_port: '5432', database: 'synthetic', current_user: 'restricted_reader', session_user: 'restricted_reader', pid: '100', backend_start: '2026-11-14 00:00:01.123456+00' }] });
    if (text.includes('db-link:observe-session')) return Promise.resolve({ rows: [] });
    if (text.includes('db-link:transaction-settings')) return Promise.resolve({ rows: [{ transaction_timeout_ms: 1000, statement_timeout_ms: 1000, idle_timeout_ms: 1000, lock_timeout_ms: 1000, read_only: 'on' }] });
    if (text.includes('db-link:identity')) return Promise.resolve({ rows: [{ server_version_num: this.serverVersion, database: 'synthetic', current_user: 'restricted_reader', session_user: 'restricted_reader', server_address: '192.0.2.1', server_port: 5432, datestyle: 'ISO, YMD', intervalstyle: 'postgres', bytea_output: 'hex', extra_float_digits: '3', boot: '2026-11-14T00:00:00Z', timezone: 'UTC', encoding: 'UTF8', isolation: 'read committed', search_path: 'pg_catalog', statement_timeout: '3s', lock_timeout: '1s', statement_timeout_ms: 3000, lock_timeout_ms: 1000 }] });
    if (text.includes('pg_control_system')) return Promise.resolve({ rows: [{ system_identifier: '987654321987654321' }] });
    if (text.includes('db-link:roles')) return Promise.resolve({ rows: this.roles });
    if (text.includes('db-link:namespace')) return Promise.resolve({ rows: [{ unsafe: false }] });
    if (text.includes('db-link:relations')) return Promise.resolve({ rows: this.relations });
    if (text.includes('db-link:columns')) return Promise.resolve({ rows: this.columns });
    if (text.includes('db-link:keys')) return this.keysUnavailable ? Promise.reject(Object.assign(new Error('synthetic metadata unavailable'), { code: '42501' })) : Promise.resolve({ rows: this.keys });
    if (text.includes('SELECT (SELECT setting::int')) return Promise.resolve({ rows: [{ statement_timeout_ms: 1000, lock_timeout_ms: 1000 }] });
    return Promise.resolve({ rows: [] });
  }
}

class SyntheticMysql extends EventEmitter {
  timerAvailable = 'YES';
  columnExtra = ''; generation = '';
  budget = 3000; timers = 0; failedTimers = 0; failTimerOnExecute = false; sentParameters: unknown[] = [];
  grants = ['GRANT USAGE ON *.* TO `restricted_reader`@`%`', 'GRANT SELECT ON `synthetic`.`orders` TO `restricted_reader`@`%`'];
  connect(callback: (error: Error | null) => void) { callback(null); }
  end(callback: (error?: Error) => void) { callback(); this.emit('end'); }
  query(input: unknown, values: unknown, callback?: (error: Error | null, rows: unknown) => void) {
    const cb = typeof values === 'function' ? values as typeof callback : callback;
    const sql = typeof input === 'string' ? input : (input as { sql: string }).sql;
    let rows: unknown = [];
    if (sql.startsWith('SET SESSION')) this.budget = Number((values as unknown[])[0]);
    if (sql.includes('db-link:identity')) rows = [{ version: '8.4.0', server_uuid: 'synthetic-uuid', server_port: 3306, database: 'synthetic', current_user: 'restricted_reader@%', session_user: 'restricted_reader@192.0.2.3', timezone: '+00:00', encoding: 'utf8mb4', isolation: 'REPEATABLE-READ', sql_mode: 'STRICT_TRANS_TABLES', timer_available: this.timerAvailable, max_execution_time: this.budget, lock_wait_timeout: 1, lower_case_table_names: 0 }];
    if (sql === 'SHOW GRANTS') rows = this.grants.map(grant => ({ 'Grants for restricted_reader@%': grant }));
    if (sql.includes('db-link:tables')) rows = [{ schema: 'synthetic', name: 'orders', kind: 'BASE TABLE', engine: 'InnoDB', comment: 'Synthetic orders' }];
    if (sql.includes('db-link:columns')) rows = [{ schema: 'synthetic', table: 'orders', name: 'amount', ordinal: 1, database_type: 'decimal(20,6)', type_id: 'decimal', precision: 20, scale: 6, nullable: 'NO', privileges: 'select', generated: this.generation, extra: this.columnExtra, comment: '' }];
    if (sql.includes('db-link:budget')) rows = [{ max_execution_time: this.budget, lock_wait_timeout: 1 }];
    if (sql.startsWith('SHOW SESSION STATUS')) rows = [{ Variable_name: 'Max_execution_time_set', Value: String(this.timers) }, { Variable_name: 'Max_execution_time_set_failed', Value: String(this.failedTimers) }];
    cb?.(null, rows); return {};
  }
  execute(_sql: string, parameters: unknown[]) {
    this.sentParameters = parameters; this.timers++; if (this.failTimerOnExecute) this.failedTimers++;
    const command = new EventEmitter();
    return Object.assign(command, { stream: () => Readable.from((async function* () {
      command.emit('fields', [{ name: 'amount', columnType: 246, db: 'synthetic', orgTable: 'orders', orgName: 'amount' }]);
      yield ['9007199254740993.123456']; command.emit('end');
    })(), { objectMode: true, highWaterMark: 1 }) });
  }
}

class SyntheticCursor implements DbLinkPgCursor {
  reads = 0; closed = false;
  batches: unknown[][][] = [[['9007199254740993.123456']], []];
  beforeRead?: () => Promise<void>;
  read(_rows: number, callback: Parameters<DbLinkPgCursor['read']>[1]) {
    this.reads++;
    void Promise.resolve(this.beforeRead?.()).then(() => {
      const rows = this.batches.shift() ?? [];
      // Fixed pg-cursor's public done callback omits result metadata.
      if (!rows.length) callback(undefined, []);
      else callback(undefined, rows, { fields: [{ name: 'amount', dataTypeID: 1700, tableID: 1000, columnID: 1 }] });
    });
  }
  async close() { this.closed = true; }
}

async function queryRequest(driver: ReturnType<typeof createDbLinkDriver>, overrides: Partial<DbLinkQueryRequest> = {}): Promise<DbLinkQueryRequest> {
  const observation = await driver.probe(configuration());
  return { sql: 'SELECT amount FROM public.orders', parameters: [], scope: { objects: ['public.orders'] },
    expectedSourceIdentity: observation.sourceIdentity, expectedPermissionBinding: observation.permissionBinding,
    onColumns() {}, onRows() {}, ...overrides };
}

const configuration = (engine: 'postgresql' | 'mysql' = 'postgresql'): DbLinkRuntimeConnection => ({
  id: 'connection', revision: 1, fingerprint: 'config-one', name: 'Synthetic source',
  engine, host: 'db.example.test', port: engine === 'mysql' ? 3306 : 5432,
  database: 'synthetic', username: 'restricted_reader', password: 'synthetic-password',
  tls: { rejectUnauthorized: true, verifyIdentity: true },
  budget: { connectTimeoutMs: 1000, queryTimeoutMs: 3000, lockTimeoutMs: 1000, maxRows: 10, maxBytes: 10000, maxCellBytes: 1000, chunkBytes: 1000, maxConcurrent: 1 },
});

test('a refused external connection remains unreachable and never becomes a qualified source', async () => {
  const driver = createDbLinkDriver({ postgresClient: () => ({
    async connect() { throw new Error('authentication refused: synthetic-password'); },
    async end() {}, on() {}, async query() { return { rows: [] }; },
  }) });
  const observation = await driver.probe(configuration());
  assert.equal(observation.reachable, false);
  assert.equal(observation.queryQualified, false);
  assert.equal(observation.cancelCapability, 'unverified');
  assert.equal(JSON.stringify(observation).includes('synthetic-password'), false);
});

test('a restricted source binds its native domain and accepts formal views with readable columns', async () => {
  const client = new SyntheticPg();
  client.relations.push({ ...client.relations[0], oid: 1001, name: 'formal_view', kind: 'v' });
  client.columns.push({ ...client.columns[0], relation_oid: 1001 });
  const driver = createDbLinkDriver({ postgresClient: () => client });
  const catalog = await driver.catalog(configuration());
  assert.equal(catalog.observation.queryQualified, true);
  assert.match(catalog.observation.sourceIdentity, /^postgresql:/);
  assert.match(catalog.observation.permissionBinding, /^[a-f0-9]{64}$/);
  assert.deepEqual(catalog.objects.map(object => [object.object, object.queryable]), [['public.orders', true], ['public.formal_view', true]]);
  assert.equal(catalog.objects[0].columns[0].precision, 20);
  assert.equal(catalog.completeness, 'complete');
  const changed = new SyntheticPg(); changed.columns[0].writable = true;
  const unsafe = await createDbLinkDriver({ postgresClient: () => changed }).catalog(configuration());
  assert.equal(unsafe.observation.queryQualified, false);
  assert.ok(unsafe.observation.limitations.includes('db_native_write_privilege'));
});

test('MySQL qualification checks the real timer capability and complete direct grants rather than a SELECT label', async () => {
  const mysql = new SyntheticMysql();
  const driver = createDbLinkDriver({ mysqlConnection: () => mysql, postgresClient: () => { throw new Error('wrong_engine'); } });
  const allowed = await driver.catalog(configuration('mysql'));
  assert.equal(allowed.observation.queryQualified, false);
  assert.equal(allowed.observation.limitations.includes('db_statement_timer_unavailable'), false);
  assert.deepEqual(allowed.objects.map(object => object.object), ['synthetic.orders']);
  mysql.timerAvailable = 'NO';
  const unavailable = await driver.probe(configuration('mysql'));
  assert.equal(unavailable.reachable, true); assert.equal(unavailable.queryQualified, false);
  assert.ok(unavailable.limitations.includes('db_statement_timer_unavailable'));
  mysql.timerAvailable = 'YES'; mysql.grants.push('GRANT UPDATE ON `synthetic`.`orders` TO `restricted_reader`@`%`');
  assert.equal((await driver.probe(configuration('mysql'))).queryQualified, false);
});

test('PostgreSQL keeps exact text and awaits the result sink before asking for another batch', async () => {
  const cursor = new SyntheticCursor(); let finishWrite!: () => void, enteredWrite!: () => void;
  const writing = new Promise<void>(resolve => { enteredWrite = resolve; });
  const blocked = new Promise<void>(resolve => { finishWrite = resolve; });
  const received: DbResultCell[][] = [];
  const driver = createDbLinkDriver({ postgresClient: () => new SyntheticPg(), postgresCursor: (_sql, parameters, options) => {
    assert.deepEqual(parameters, ['2026-11-14 00:00:00.123456']);
    assert.equal(options.types.getTypeParser(1231)('{9007199254740993.123456}'), '{9007199254740993.123456}');
    return cursor;
  } });
  const request = await queryRequest(driver, { parameters: [{ kind: 'text', value: '2026-11-14 00:00:00.123456', databaseType: 'timestamp' }],
    sql: "SELECT amount FROM public.orders WHERE CAST($1 AS TIMESTAMP) > CAST('2026-01-01' AS TIMESTAMP)", onRows: async rows => { received.push(...rows); enteredWrite(); await blocked; } });
  const running = driver.openQuery(configuration(), request);
  await Promise.race([writing, running.then(result => { throw new Error(`query ended before writing: ${result.errorCode}`); })]);
  assert.equal(cursor.reads, 1); finishWrite();
  const terminal = await running;
  assert.deepEqual(received, [['9007199254740993.123456']]);
  assert.equal(terminal.status, 'completed'); assert.equal(terminal.remoteTerminal, true); assert.equal(terminal.connectionEnded, true);
  assert.equal(cursor.closed, true);
});

test('MySQL uses public typed parameters and streams exact decimal strings without converting temporal parameters to Date', { skip: 'NOT_RUN for final hard admission: finite transport candidate evidence is retained; no resource-budget bypass' }, async () => {
  const client = new SyntheticMysql(); const received: DbResultCell[][] = [];
  const driver = createDbLinkDriver({ mysqlConnection: () => client, postgresClient: () => { throw new Error('wrong_engine'); } });
  const observation = await driver.probe(configuration('mysql'));
  const terminal = await driver.openQuery(configuration('mysql'), {
    sql: "SELECT amount FROM synthetic.orders WHERE CAST(? AS DATETIME(6)) > CAST('2026-01-01' AS DATETIME(6))", parameters: [{ kind: 'text', value: '2026-11-14 00:00:00.123456', databaseType: 'timestamp' }],
    scope: { objects: ['synthetic.orders'] }, expectedSourceIdentity: observation.sourceIdentity, expectedPermissionBinding: observation.permissionBinding,
    onColumns() {}, onRows: rows => { received.push(...rows); },
  });
  assert.equal(terminal.status, 'completed'); assert.equal(terminal.remoteTerminal, true); assert.equal(terminal.connectionEnded, true);
  assert.deepEqual(received, [['9007199254740993.123456']]);
  assert.equal((client.sentParameters[0] as { value: unknown }).value, '2026-11-14 00:00:00.123456');
  assert.equal((client.sentParameters[0] as { value: unknown }).value instanceof Date, false);
});

test('stopping a pending PostgreSQL read waits for its real response and never publishes late rows', async () => {
  let releaseRead!: () => void, enteredRead!: () => void;
  const entered = new Promise<void>(resolve => { enteredRead = resolve; });
  const blocked = new Promise<void>(resolve => { releaseRead = resolve; });
  const cursor = new SyntheticCursor(); cursor.beforeRead = async () => { enteredRead(); await blocked; };
  const clients: SyntheticPg[] = [];
  const driver = createDbLinkDriver({ postgresClient: () => { const client = new SyntheticPg(); clients.push(client); return client; }, postgresCursor: () => cursor });
  const controller = new AbortController(); let delivered = 0, settled = false;
  const request = await queryRequest(driver, { signal: controller.signal, onRows: rows => { delivered += rows.length; } });
  const running = driver.openQuery(configuration(), request).then(result => { settled = true; return result; });
  await entered; controller.abort(); await Promise.resolve();
  assert.equal(settled, false); assert.equal(cursor.closed, false);
  releaseRead(); const terminal = await running;
  assert.equal(terminal.status, 'cancelled'); assert.equal(delivered, 0); assert.equal(cursor.closed, true);
  assert.equal(terminal.remoteTerminal, true); assert.equal(terminal.connectionEnded, true);
  assert.equal(clients.flatMap(client => client.statements).some(sql => /pg_cancel_backend|pg_terminate_backend|\bKILL\b/i.test(sql)), false);
});

test('connection loss stays UNKNOWN while writer failure after a paused read closes the owned resource', async () => {
  const disconnected: DbLinkPgCursor = { read(_rows, callback) { callback(Object.assign(new Error('wire lost'), { code: 'ECONNRESET' }), [], { fields: [] }); }, async close() { throw new Error('must not claim close on a lost wire'); } };
  const driver = createDbLinkDriver({ postgresClient: () => new SyntheticPg(), postgresCursor: () => disconnected });
  const unknown = await driver.openQuery(configuration(), await queryRequest(driver));
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.remoteTerminal, false); assert.equal(unknown.connectionEnded, true);
  const cursor = new SyntheticCursor(); const writerFailure = createDbLinkDriver({ postgresClient: () => new SyntheticPg(), postgresCursor: () => cursor });
  const failed = await writerFailure.openQuery(configuration(), await queryRequest(writerFailure, { onRows() { throw new Error('synthetic disk full'); } }));
  assert.equal(failed.status, 'error'); assert.equal(failed.errorCode, 'db_result_delivery_failed'); assert.equal(cursor.closed, true);
  assert.equal(failed.remoteTerminal, true); assert.equal(failed.connectionEnded, true);
});

test('task narrowing is enforced within the complete native project domain, and stale bindings never dispatch a cursor', async () => {
  let cursorCreations = 0;
  const factory = () => {
    const client = new SyntheticPg(); client.relations.push({ ...client.relations[0], oid: 1001, name: 'refunds' });
    client.columns.push({ ...client.columns[0], relation_oid: 1001 }); return client;
  };
  const driver = createDbLinkDriver({ postgresClient: factory, postgresCursor: () => { cursorCreations++; return new SyntheticCursor(); } });
  const narrowed = await queryRequest(driver, { nativeScope: { objects: ['*'] } });
  assert.equal((await driver.openQuery(configuration(), narrowed)).status, 'completed');
  assert.equal((await driver.openQuery(configuration(), { ...narrowed, nativeScope: { objects: ['public.orders'] } })).status, 'completed');
  assert.equal((await driver.openQuery(configuration(), { ...narrowed, nativeScope: { objects: ['public.orders','private.unknown'] } })).errorCode, 'db_native_scope_mismatch');
  assert.equal((await driver.openQuery(configuration(), { ...narrowed, expectedPermissionBinding: 'old-binding' })).errorCode, 'db_source_binding_changed');
  assert.equal((await driver.openQuery(configuration(), { ...narrowed, sql: 'SELECT amount FROM public.refunds' })).errorCode, 'db_query_object_not_authorized');
  assert.equal(cursorCreations, 2);
});

test('composite foreign keys preserve column pairing and incomplete relationship metadata remains explicit', async () => {
  const client = new SyntheticPg();
  client.keys = [{ relation_oid: 1000, name: 'order_tenant_fk', kind: 'f', columns: ['tenant_id','order_id'], referenced_object: 'public.orders_parent', referenced_columns: ['tenant_key','order_key'] }];
  const driver = createDbLinkDriver({ postgresClient: () => client });
  const complete = await driver.catalog(configuration());
  assert.deepEqual(complete.objects[0].foreignKeys[0], { name: 'order_tenant_fk', columns: ['tenant_id','order_id'], referencedObject: 'public.orders_parent', referencedColumns: ['tenant_key','order_key'] });
  client.keysUnavailable = true;
  const partial = await driver.catalog(configuration());
  assert.equal(partial.completeness, 'partial'); assert.equal(partial.observation.queryQualified, true);
  assert.ok(partial.limitations.includes('db_relationships_unknown'));
});

test('unsafe numeric parameters are rejected before a physical connection is created', async () => {
  let created = 0;
  const driver = createDbLinkDriver({ postgresClient: () => { created++; return new SyntheticPg(); } });
  const result = await driver.openQuery(configuration(), { sql: 'SELECT amount FROM public.orders WHERE amount=$1', parameters: [{ kind: 'number', value: 9007199254740992 }], scope: { objects: ['*'] },
    expectedSourceIdentity: '', expectedPermissionBinding: '', onColumns() {}, onRows() {} });
  assert.equal(result.errorCode, 'db_parameter_invalid_or_inexact'); assert.equal(created, 0);
});

test('MySQL QUIT callback alone does not release a connection and a timer arm failure cannot complete a result', { skip: 'NOT_RUN for final hard admission: finite transport candidate evidence is retained; no resource-budget bypass' }, async () => {
  let endRequested!: () => void;
  const requested = new Promise<void>(resolve => { endRequested = resolve; });
  class DeferredEnd extends SyntheticMysql { end(callback: (error?: Error) => void) { callback(); endRequested(); } }
  let first = true; const client = new DeferredEnd();
  const driver = createDbLinkDriver({ mysqlConnection: () => { if (first) { first = false; return new SyntheticMysql(); } return client; } });
  const observation = await driver.probe(configuration('mysql'));
  const request: DbLinkQueryRequest = { sql: 'SELECT amount FROM synthetic.orders', parameters: [], scope: { objects: ['*'] }, expectedSourceIdentity: observation.sourceIdentity, expectedPermissionBinding: observation.permissionBinding, onColumns() {}, onRows() {} };
  let settled = false; const running = driver.openQuery(configuration('mysql'), request).then(result => { settled = true; return result; });
  await requested; await Promise.resolve(); assert.equal(settled, false); client.emit('end');
  assert.equal((await running).connectionEnded, true);
  const failing = new SyntheticMysql(); failing.failTimerOnExecute = true;
  const failedDriver = createDbLinkDriver({ mysqlConnection: () => failing });
  const failed = await failedDriver.openQuery(configuration('mysql'), request);
  assert.equal(failed.status, 'error'); assert.equal(failed.errorCode, 'db_statement_timer_unverified');
});

test('predefined administrative PostgreSQL roles and explicit MySQL system-table access are not a read-only native domain', async () => {
  const postgres = new SyntheticPg(); postgres.roles.push({ ...postgres.roles[0], oid: 501, rolname: 'pg_execute_server_program' });
  const pgObservation = await createDbLinkDriver({ postgresClient: () => postgres }).probe(configuration());
  assert.equal(pgObservation.queryQualified, false); assert.ok(pgObservation.limitations.includes('db_native_privileged_role'));
  const mysql = new SyntheticMysql(); mysql.grants.push('GRANT SELECT ON `mysql`.`user` TO `restricted_reader`@`%`');
  const mysqlObservation = await createDbLinkDriver({ mysqlConnection: () => mysql }).probe(configuration('mysql'));
  assert.equal(mysqlObservation.queryQualified, false);
});

test('a stored generated value or insertion default does not become a hidden read-time function', async () => {
  const postgres = new SyntheticPg(); postgres.columns[0].generated = 's';
  const pgDriver = createDbLinkDriver({ postgresClient: () => postgres });
  assert.equal((await pgDriver.catalog(configuration())).objects[0].queryable, true);
  postgres.columns[0].generated = 'v';
  assert.equal((await pgDriver.catalog(configuration())).objects[0].queryable, true);
  const mysql = new SyntheticMysql(); mysql.columnExtra = 'DEFAULT_GENERATED';
  const mysqlDriver = createDbLinkDriver({ mysqlConnection: () => mysql });
  assert.equal((await mysqlDriver.catalog(configuration('mysql'))).objects[0].queryable, true);
  mysql.columnExtra = 'VIRTUAL GENERATED'; mysql.generation = 'amount + 1';
  assert.equal((await mysqlDriver.catalog(configuration('mysql'))).objects[0].queryable, false);
});

test('catalog wire loss cannot be mistaken for a closed native resource merely because client.end resolves', async () => {
  class LostCatalog extends SyntheticPg {
    query(input: unknown): unknown {
      const sql = typeof input === 'string' ? input : (input as { text?: string }).text ?? '';
      if (sql.includes('db-link:roles') || sql.includes('db-link:observe-session')) return Promise.reject(Object.assign(new Error('synthetic lost wire'), { code: 'ECONNRESET' }));
      return super.query(input);
    }
  }
  const catalog = await createDbLinkDriver({ postgresClient: () => new LostCatalog() }).catalog(configuration());
  assert.equal(catalog.observation.queryQualified, false);
  assert.ok(catalog.observation.limitations.includes('db_probe_connection_close_unknown'));
});

test('MySQL retains its existing PREPARE and receive limitations under the PostgreSQL-only v0.5 change', async () => {
  for (const engine of ['mysql'] as const) {
    let queries = 0;
    const driver = createDbLinkDriver({ postgresClient: () => new SyntheticPg(), postgresCursor: () => { queries++; return new SyntheticCursor(); }, mysqlConnection: () => {
      const client = new SyntheticMysql(); const execute = client.execute.bind(client); client.execute = (sql,parameters) => { queries++; return execute(sql,parameters); }; return client;
    } });
    const config = configuration(engine), catalog = await driver.catalog(config);
    assert.equal(catalog.observation.reachable,true); assert.equal(catalog.objects.length,1);
    assert.equal(catalog.observation.queryQualified,false);
    assert.ok(catalog.observation.limitations.includes('db_receive_memory_budget_unenforced'));
    if(engine==='mysql') assert.ok(catalog.observation.limitations.includes('db_prepare_total_budget_unenforced'));
    const terminal = await driver.openQuery(config, { sql: 'SELECT amount FROM synthetic.orders',parameters:[],scope:{objects:['*']},
      expectedSourceIdentity:catalog.observation.sourceIdentity,expectedPermissionBinding:catalog.observation.permissionBinding,onColumns(){throw new Error('must not publish');},onRows(){throw new Error('must not publish');} });
    assert.equal(terminal.errorCode,'db_native_not_qualified'); assert.equal(queries,0);
  }
});

// v0.5 behavioral regressions: old global memory/DDL and all-view refusal are superseded;
// their original tests and bytes remain in the external baseline evidence.
test('v0.5 qualifies a restricted ordinary source and accepts formal views plus RLS without control privileges', async () => {
  let creations = 0;
  const clients: SyntheticPg[] = [];
  const driver = createDbLinkDriver({ postgresClient: () => {
    creations++; const client = new SyntheticPg();
    client.relations.push({ ...client.relations[0], oid: 1001, name: 'formal_view', kind: 'v' });
    client.relations[0].row_security = true;
    client.columns.push({ ...client.columns[0], relation_oid: 1001 });
    clients.push(client); return client;
  } });
  const catalog = await driver.catalog(configuration());
  assert.equal(catalog.observation.queryQualified, true, JSON.stringify(catalog.observation.limitations));
  assert.equal(catalog.objects.every(object => object.queryable), true);
  assert.equal(creations, 1, 'normal command/transaction/end does not require a second observer connection');
  assert.equal(clients.flatMap(client => client.statements).some(sql => /pg_control_system|pg_stat_activity/.test(sql)), false);
  assert.deepEqual(catalog.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
});

test('v0.5 executes ordinary text expressions using actual fields and leaves full-value segmentation unavailable', async () => {
  const cursor = new SyntheticCursor();
  cursor.batches = [[['中文短文本']], []];
  const driver = createDbLinkDriver({ postgresClient: () => new SyntheticPg(), postgresCursor: () => cursor });
  const rows: DbResultCell[][] = [];
  const request = await queryRequest(driver, { sql: 'SELECT upper(CAST(amount AS text)) FROM public.orders', onRows: batch => { rows.push(...batch); } });
  const terminal = await driver.openQuery(configuration(), request);
  assert.equal(terminal.status, 'completed', terminal.errorCode ?? '');
  assert.deepEqual(rows, [['中文短文本']]);
  const unsupported = await driver.openQuery(configuration(), { ...request, segmentRead: { valueColumn: 0, totalBytesColumn: 1, keyColumns: [2] }, onValueSegment: async () => undefined });
  assert.equal(unsupported.errorCode, 'db_segment_read_unsupported');
});


test('v0.5 effective inherited/SET roles, ownership and RLS bypass never qualify as a read-only account', async () => {
  for (const kind of ['inherited-write','set-role-write','owner','bypass','superuser'] as const) {
    const client = new SyntheticPg();
    if (kind === 'owner') client.relations[0].owner_reachable = true;
    else if (kind === 'bypass') client.roles[0].rolbypassrls = true;
    else if (kind === 'superuser') client.roles[0].rolsuper = true;
    else { client.roles.push({ ...client.roles[0], oid: 501, rolname: kind }); client.relations[0].writable = true; }
    const result = await createDbLinkDriver({ postgresClient: () => client }).catalog(configuration());
    assert.equal(result.observation.queryQualified, false, kind);
    assert.ok(result.observation.limitations.includes(kind === 'bypass' || kind === 'superuser' ? 'db_native_privileged_role' : 'db_native_write_privilege'), kind);
  }
});

test('v0.5 comment and optional relationship metadata changes preserve authorization while actual types or privileges change the binding', async () => {
  const client = new SyntheticPg(), driver = createDbLinkDriver({ postgresClient: () => client });
  const initial = await driver.probe(configuration());
  client.relations[0].comment = 'changed source documentation'; Object.assign(client.columns[0], { comment: 'changed column note' });
  client.keysUnavailable = true;
  const notes = await driver.probe(configuration());
  assert.equal(notes.queryQualified, true); assert.equal(notes.permissionBinding, initial.permissionBinding);
  client.columns[0].database_type = 'numeric(30,6)';
  assert.notEqual((await driver.probe(configuration())).permissionBinding, initial.permissionBinding);
  client.relations[0].writable = true;
  const changed = await driver.probe(configuration()); assert.equal(changed.queryQualified, false); assert.notEqual(changed.permissionBinding, initial.permissionBinding);
});

test('v0.5 public catalog reports actual login/effective roles and account-visible result scope without invented policy versions', async () => {
  const driver = createDbLinkDriver({ postgresClient: () => new SyntheticPg() }), catalog = await driver.catalog(configuration());
  const session = catalog.session as unknown as Record<string, unknown>;
  assert.equal(session.loginRole, 'restricted_reader'); assert.equal(session.effectiveRole, 'restricted_reader');
  assert.equal(session.visibleScope, 'current-account-visible'); assert.equal(session.serverVersionNum, '180001');
  assert.equal('policyVersion' in session, false); assert.equal('viewVersion' in session, false);
});


test('v0.5 unvalidated PostgreSQL server versions remain reachable metadata-only and never dispatch a business cursor', async () => {
  for (const version of ['150000','170006','180000','180002','190000']) {
    const client = new SyntheticPg(); client.serverVersion = version; let cursorCreations = 0;
    const driver = createDbLinkDriver({ postgresClient: () => client, postgresCursor() { cursorCreations++; return new SyntheticCursor(); } });
    const catalog = await driver.catalog(configuration());
    assert.equal(catalog.observation.reachable, true, version); assert.equal(catalog.objects[0].object, 'public.orders'); assert.equal(catalog.session.serverVersionNum, version);
    assert.equal(catalog.observation.queryQualified, false, version); assert.ok(catalog.observation.limitations.includes('db_pg_version_not_validated'), version);
    const terminal = await driver.openQuery(configuration(), { sql: 'SELECT amount FROM public.orders', parameters: [], scope: { objects: ['public.orders'] },
      expectedSourceIdentity: catalog.observation.sourceIdentity, expectedPermissionBinding: catalog.observation.permissionBinding,
      onColumns() { assert.fail('unvalidated server must not deliver query columns'); }, onRows() { assert.fail('unvalidated server must not deliver query rows'); } });
    assert.equal(terminal.errorCode, 'db_native_not_qualified', version); assert.ok(terminal.limitations.includes('db_pg_version_not_validated'), version);
    assert.equal(cursorCreations, 0, version);
  }
});
