import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Client, type ClientConfig } from 'pg';
import { createDbLinkDriver } from '../src/host/db-link-driver.ts';
import type { DbLinkRuntimeConnection } from '../src/host/db-link-types.ts';
import type { DbLinkQueryRequest } from '../src/host/db-link-driver.ts';
import type { DbResultCell } from '../src/host/db-link-results.ts';

const configPath = process.env.OPTRACALL_DB_PG_V05_CONFIG;
type Fixture = { admin: ClientConfig; runtime: DbLinkRuntimeConnection; subjects: Record<string, { runtime: DbLinkRuntimeConnection }>; truth: { exactId: string; exactAmount: string; exactCreatedAt: string } };
const fixture = async (): Promise<Fixture> => JSON.parse(await readFile(configPath!, 'utf8'));
async function query(runtime: DbLinkRuntimeConnection, sql: string, parameters: DbLinkQueryRequest['parameters'] = []) {
  const driver = createDbLinkDriver(), catalog = await driver.catalog(runtime), rows: DbResultCell[][] = [];
  assert.equal(catalog.observation.queryQualified, true, JSON.stringify({ user: runtime.username, reasons: catalog.observation.limitations }));
  const terminal = await driver.openQuery(runtime, { sql, parameters, scope: { objects: ['*'] },
    expectedSourceIdentity: catalog.observation.sourceIdentity, expectedPermissionBinding: catalog.observation.permissionBinding,
    onColumns() {}, onRows: batch => { rows.push(...batch); } });
  return { catalog, terminal, rows };
}
const native = { skip: configPath ? false : 'Requires the root-managed isolated v0.5 PostgreSQL fixture; does not start a database' };

test('v0.5 native local account reads exact numerics and timestamps with no control/observer permission', native, async () => {
  const { runtime, truth } = await fixture();
  const { terminal, rows, catalog } = await query(runtime, 'SELECT id,amount,created_at FROM sales.orders WHERE id=$1', [{ kind: 'number', value: truth.exactId, databaseType: 'BIGINT' }]);
  assert.equal(terminal.status, 'completed', JSON.stringify(terminal));
  assert.deepEqual(rows, [[truth.exactId, truth.exactAmount, truth.exactCreatedAt]]);
  assert.equal(terminal.serverRowCount, '1');
  assert.equal(catalog.session.loginRole, runtime.username); assert.equal(catalog.session.effectiveRole, runtime.username);
  assert.equal(catalog.session.visibleScope, 'current-account-visible'); assert.equal(catalog.session.serverVersionNum, '180001');
  assert.ok(catalog.limitations.includes('db_endpoint_identity_not_physical_instance_proof'));
  assert.deepEqual(terminal.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
  assert.ok(terminal.receiveFacts?.original.closed); assert.equal(terminal.receiveFacts?.observer, undefined);
});

test('v0.5 native local orders, members and inventory support a Chinese grouped join and date filter', native, async () => {
  const { runtime, admin } = await fixture(), authority = new Client(admin), schema = `v05_business_${randomBytes(5).toString('hex')}`;
  await authority.connect();
  try {
    await authority.query(`CREATE SCHEMA ${schema}`);
    await authority.query(`CREATE TABLE ${schema}.members(id bigint PRIMARY KEY,tier text); CREATE TABLE ${schema}.inventory(sku text PRIMARY KEY,on_hand integer); CREATE TABLE ${schema}.orders(id bigint,member_id bigint,sku text,quantity integer,amount numeric(20,4),created_at timestamptz)`);
    await authority.query(`INSERT INTO ${schema}.members VALUES(7,'会员'); INSERT INTO ${schema}.inventory VALUES('A',10),('B',5); INSERT INTO ${schema}.orders VALUES(1,7,'A',2,12.30,'2026-11-14T12:34:56.123456Z'),(2,7,'B',1,7.70,'2026-11-14T13:00:00Z')`);
    await authority.query(`GRANT USAGE ON SCHEMA ${schema} TO oc_reader; GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO oc_reader`);
    const sql = `SELECT m.tier,sum(o.amount),sum(o.quantity),min(i.on_hand),date_trunc('day',o.created_at) AS day FROM ${schema}.orders o JOIN ${schema}.members m ON o.member_id=m.id JOIN ${schema}.inventory i ON o.sku=i.sku WHERE o.created_at >= $1 GROUP BY m.tier,date_trunc('day',o.created_at) ORDER BY m.tier`;
    const result = await query(runtime, sql, [{ kind: 'text', value: '2026-11-14T00:00:00Z' }]);
    assert.equal(result.terminal.status, 'completed', result.terminal.errorCode ?? '');
    assert.deepEqual(result.rows, [['会员', '20.0000', '3', '5', '2026-11-14 00:00:00+00']]);
    assert.equal(result.terminal.session.serverVersionNum, '180001');
  } finally { await authority.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await authority.end(); }
});

test('v0.5 native RLS identities return their own exact scope on independent physical connections', native, async () => {
  const { subjects } = await fixture();
  const a = await query(subjects.oc_analyst_a.runtime, 'SELECT id,amount FROM enterprise.raw_orders ORDER BY id');
  const b = await query(subjects.oc_analyst_b.runtime, 'SELECT id,amount FROM enterprise.raw_orders ORDER BY id');
  assert.equal(a.terminal.status, 'completed', a.terminal.errorCode ?? ''); assert.equal(b.terminal.status, 'completed', b.terminal.errorCode ?? '');
  assert.deepEqual(a.rows.map(row => row[0]), ['101','102']); assert.deepEqual(b.rows.map(row => row[0]), ['201']);
  assert.ok(a.terminal.limitations.includes('db_current_role_policy_visible_scope'));
  assert.notEqual(a.catalog.observation.permissionBinding, b.catalog.observation.permissionBinding);
  assert.equal(a.terminal.session.loginRole, 'oc_analyst_a'); assert.equal(a.terminal.session.effectiveRole, 'oc_analyst_a');
  assert.equal(b.terminal.session.loginRole, 'oc_analyst_b'); assert.equal(b.terminal.session.effectiveRole, 'oc_analyst_b');
  const empty = await query(subjects.oc_analyst_a.runtime, 'SELECT id FROM enterprise.raw_orders WHERE id=$1', [{ kind: 'number', value: '201' }]);
  assert.equal(empty.terminal.status, 'completed'); assert.equal(empty.terminal.serverRowCount, '0'); assert.deepEqual(empty.rows, []);
  assert.ok(empty.terminal.limitations.includes('db_current_role_policy_visible_scope'));
});

test('v0.5 native view-only account reads the formal owner view while security_invoker fails without a fallback identity', native, async () => {
  const { subjects } = await fixture(), runtime = subjects.oc_viewer.runtime;
  const owner = await query(runtime, 'SELECT id,amount FROM enterprise.a_orders ORDER BY id');
  assert.equal(owner.terminal.status, 'completed', owner.terminal.errorCode ?? '');
  assert.deepEqual(owner.rows.map(row => row[0]), ['101','102']);
  assert.equal(owner.catalog.objects.some(object => object.object === 'enterprise.raw_orders'), false);
  assert.ok(owner.terminal.limitations.includes('db_view_scope_not_independently_verified'));
  const invoker = await query(runtime, 'SELECT id FROM enterprise.invoker_orders ORDER BY id');
  assert.equal(invoker.terminal.status, 'error'); assert.equal(invoker.terminal.errorCode, '42501');
  assert.equal(invoker.terminal.remoteTerminal, true); assert.equal(invoker.terminal.connectionEnded, true);
});

test('v0.5 native ordinary aggregation and explicit huge-field prefix work without a universal output prover', native, async () => {
  const { runtime } = await fixture();
  const aggregate = await query(runtime, 'SELECT count(*),sum(n) FROM synthetic.numbers');
  assert.equal(aggregate.terminal.status, 'completed', aggregate.terminal.errorCode ?? ''); assert.deepEqual(aggregate.rows, [['128','8256']]);
  const prefix = await query(runtime, 'SELECT left(note,3),octet_length(note) FROM sales.orders WHERE id=$1', [{ kind: 'number', value: '9007199254740993' }]);
  assert.equal(prefix.terminal.status, 'completed', prefix.terminal.errorCode ?? ''); assert.deepEqual(prefix.rows, [['Aé🧪','1835015']]);
  const oversized = await query(runtime, 'SELECT note FROM sales.orders WHERE id=$1', [{ kind: 'number', value: '9007199254740993' }]);
  assert.equal(oversized.terminal.status, 'error'); assert.equal(oversized.terminal.errorCode, 'db_result_cell_limit'); assert.equal(oversized.rows.length, 0);
  assert.equal(oversized.terminal.remoteTerminal, true); assert.equal(oversized.terminal.connectionEnded, true);
});


test('v0.5 native read-only qualification includes effective PUBLIC write privileges on a scratch object', native, async () => {
  const { runtime, admin } = await fixture(), authority = new Client(admin);
  const schema = `v05_driver_${randomBytes(5).toString('hex')}`;
  const driver = createDbLinkDriver(); await authority.connect();
  try {
    await authority.query(`CREATE SCHEMA ${schema}`);
    await authority.query(`CREATE TABLE ${schema}.data(id integer)`);
    await authority.query(`GRANT USAGE ON SCHEMA ${schema} TO PUBLIC`);
    await authority.query(`GRANT SELECT ON ${schema}.data TO PUBLIC`);
    assert.equal((await driver.catalog(runtime)).observation.queryQualified, true);
    await authority.query(`GRANT UPDATE ON ${schema}.data TO PUBLIC`);
    const publicWrite = await driver.catalog(runtime);
    assert.equal(publicWrite.observation.queryQualified, false); assert.ok(publicWrite.observation.limitations.includes('db_native_write_privilege'));
    await authority.query(`REVOKE UPDATE ON ${schema}.data FROM PUBLIC`);
    assert.equal((await driver.catalog(runtime)).observation.queryQualified, true, 'temporary unsafe PUBLIC grant was actually revoked');
  } finally { await authority.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await authority.end(); }
});

test('v0.5 native wrong password closes the no-SQL connection attempt without creating a permanent UNKNOWN', native, async () => {
  const { runtime } = await fixture(), rejected = structuredClone(runtime); rejected.password = 'intentionally-invalid-synthetic-password';
  const catalog = await createDbLinkDriver().catalog(rejected);
  assert.equal(catalog.observation.reachable, false); assert.equal(catalog.observation.queryQualified, false);
  assert.ok(catalog.observation.limitations.includes('db_connection_failed'));
  assert.equal(catalog.observation.limitations.includes('db_probe_connection_close_unknown'), false);
  assert.deepEqual(catalog.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
  assert.equal(catalog.receiveFacts?.original.closed, true);
  assert.deepEqual(await catalog.cleanup!(), catalog.resourceState);
  const healthy = await createDbLinkDriver().catalog(runtime);
  assert.equal(healthy.observation.queryQualified, true, JSON.stringify(healthy.observation.limitations));
  assert.deepEqual(healthy.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
});

test('v0.5 native project and task subsets stay within the account domain without requiring access to every readable table', native, async () => {
  const { runtime } = await fixture(), driver = createDbLinkDriver(), catalog = await driver.catalog(runtime);
  const rows: DbResultCell[][] = [], base: DbLinkQueryRequest = { sql: 'SELECT n FROM synthetic.numbers WHERE n=$1', parameters: [{ kind: 'number', value: 1 }],
    nativeScope: { objects: ['synthetic.numbers'] }, scope: { objects: ['synthetic.numbers'] },
    expectedSourceIdentity: catalog.observation.sourceIdentity, expectedPermissionBinding: catalog.observation.permissionBinding, onColumns() {}, onRows: batch => { rows.push(...batch); } };
  assert.ok(catalog.objects.some(object => object.object === 'sales.orders')); assert.ok(catalog.objects.some(object => object.object === 'synthetic.numbers'));
  const allowed = await driver.openQuery(runtime, base);
  assert.equal(allowed.status, 'completed', allowed.errorCode ?? ''); assert.deepEqual(rows, [['1']]);
  const inherited = await driver.openQuery(runtime, { ...base, scope: { objects: ['*'] }, onRows() {} });
  assert.equal(inherited.status, 'completed', inherited.errorCode ?? '');
  const unknown = await driver.openQuery(runtime, { ...base, nativeScope: { objects: ['synthetic.numbers','sales.unknown'] } });
  assert.equal(unknown.errorCode, 'db_native_scope_mismatch');
  const outsideProject = await driver.openQuery(runtime, { ...base, scope: { objects: ['synthetic.numbers','sales.orders'] } });
  assert.equal(outsideProject.errorCode, 'db_task_scope_exceeds_project');
  const outsideTask = await driver.openQuery(runtime, { ...base, sql: 'SELECT id FROM sales.orders', parameters: [], nativeScope: { objects: ['synthetic.numbers','sales.orders'] } });
  assert.equal(outsideTask.errorCode, 'db_query_object_not_authorized');
});

test('v0.5 native optional key-metadata failure recovers the real aborted transaction before running business SQL', native, async () => {
  const { runtime } = await fixture(), errors: string[] = [], statements: string[] = [];
  const driver = createDbLinkDriver({ postgresClient(config) {
    const client = new Client(config);
    return { async connect() { await client.connect(); }, end: () => client.end(), on: (event, listener) => client.addListener(event, listener),
      query(input: unknown) {
        const sql = (input as { text?: string }).text;
        if (sql?.includes('db-link:keys')) {
          statements.push('injected-native-keys-permission-error');
          return client.query('SELECT system_identifier FROM pg_catalog.pg_control_system()').catch(error => { errors.push((error as { code: string }).code); throw error; });
        }
        if (sql) statements.push(sql);
        return client.query(input as never);
      } };
  } });
  const catalog = await driver.catalog(runtime); assert.equal(catalog.observation.queryQualified, true, JSON.stringify(catalog.observation.limitations));
  assert.equal(catalog.completeness, 'partial'); assert.ok(catalog.limitations.includes('db_relationships_unknown'));
  const rows: DbResultCell[][] = [];
  const terminal = await driver.openQuery(runtime, { sql: 'SELECT count(*) FROM synthetic.numbers', parameters: [], scope: { objects: ['*'] },
    expectedSourceIdentity: catalog.observation.sourceIdentity, expectedPermissionBinding: catalog.observation.permissionBinding,
    onColumns() {}, onRows: batch => { rows.push(...batch); } });
  assert.equal(terminal.status, 'completed', terminal.errorCode ?? ''); assert.deepEqual(rows, [['128']]);
  assert.deepEqual(errors, ['42501','42501']);
  assert.ok(statements.filter(sql => /^SAVEPOINT /.test(sql)).length >= 2);
  assert.ok(statements.filter(sql => /^ROLLBACK TO SAVEPOINT /.test(sql)).length >= 2);
  assert.ok(statements.filter(sql => /^RELEASE SAVEPOINT /.test(sql)).length >= 2);
  assert.deepEqual(terminal.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
});

test('v0.5 native failed savepoint recovery refuses business dispatch instead of claiming partial usable metadata', native, async () => {
  const { runtime } = await fixture(), healthy = await createDbLinkDriver().catalog(runtime), errors: string[] = [];
  let businessDispatches = 0;
  const driver = createDbLinkDriver({ postgresClient(config) {
    const client = new Client(config);
    return { async connect() { await client.connect(); }, end: () => client.end(), on: (event, listener) => client.addListener(event, listener),
      query(input: unknown) {
        const sql = (input as { text?: string }).text;
        if (typeof (input as { read?: unknown }).read === 'function') businessDispatches++;
        if (sql?.includes('db-link:keys') || sql?.startsWith('ROLLBACK TO SAVEPOINT ')) {
          const replacement = sql.includes('db-link:keys') ? 'SELECT system_identifier FROM pg_catalog.pg_control_system()' : 'SELECT 1/0';
          return client.query(replacement).catch(error => { errors.push((error as { code: string }).code); throw error; });
        }
        return client.query(input as never);
      } };
  } });
  const terminal = await driver.openQuery(runtime, { sql: 'SELECT count(*) FROM synthetic.numbers', parameters: [], scope: { objects: ['*'] },
    expectedSourceIdentity: healthy.observation.sourceIdentity, expectedPermissionBinding: healthy.observation.permissionBinding,
    onColumns() { assert.fail('failed recovery must refuse business dispatch'); }, onRows() { assert.fail('failed recovery must refuse business dispatch'); } });
  assert.equal(terminal.status, 'error'); assert.equal(terminal.errorCode, '25P02'); assert.deepEqual(errors, ['42501','25P02']);
  assert.equal(businessDispatches, 0);
  assert.deepEqual(terminal.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
});

test('v0.5 native catalog parent stop after a delayed original identity response prevents subsequent discovery SQL', native, async () => {
  const { runtime } = await fixture(), controller = new AbortController(), statements: string[] = [];
  let entered!: () => void, release!: () => void;
  const observed = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const driver = createDbLinkDriver({ postgresClient(config) {
    const client = new Client(config);
    return { async connect() { await client.connect(); }, end: () => client.end(), on: (event, listener) => client.addListener(event, listener),
      async query(input: unknown) {
        const sql = (input as { text?: string }).text; if (sql) statements.push(sql);
        const result = await client.query(input as never);
        if (sql?.includes('db-link:identity')) { entered(); await held; }
        return result;
      } };
  } });
  const running = driver.catalog(runtime, { signal: controller.signal, remainingBudgetMs: () => runtime.budget.queryTimeoutMs });
  await observed; controller.abort(); const stoppedAt = statements.length; release();
  const catalog = await running;
  assert.equal(catalog.observation.queryQualified, false); assert.ok(catalog.observation.limitations.includes('db_query_stopped'));
  assert.deepEqual(statements.slice(stoppedAt), ['ROLLBACK']);
  assert.equal(statements.some(sql => /db-link:roles|db-link:namespace|db-link:relations|db-link:columns/.test(sql)), false);
  assert.deepEqual(catalog.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
});

test('v0.5 native ordinary CREATE UNIQUE INDEX CONCURRENTLY coexists with a paused read and preserves all original rows', { ...native, timeout: 15000 }, async context => {
  const { runtime, admin } = await fixture(), driver = createDbLinkDriver(), catalog = await driver.catalog(runtime);
  const ddl = new Client({ ...admin, statement_timeout: 10000 }), observer = new Client({ ...admin, statement_timeout: 2000 });
  const index = `v05_driver_standard_${randomBytes(5).toString('hex')}`;
  let entered!: () => void, release!: () => void, first = true, ddlSettled = false;
  const paused = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const rows: DbResultCell[][] = [], phases: string[] = [];
  let running: ReturnType<typeof driver.openQuery> | undefined, building: Promise<unknown> | undefined;
  await ddl.connect(); await observer.connect();
  try {
    const pid = (await ddl.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    running = driver.openQuery(runtime, { sql: 'SELECT n FROM synthetic.numbers ORDER BY n', parameters: [], scope: { objects: ['synthetic.numbers'] },
      nativeScope: { objects: ['synthetic.numbers'] }, expectedSourceIdentity: catalog.observation.sourceIdentity,
      expectedPermissionBinding: catalog.observation.permissionBinding, onColumns() {}, async onRows(batch) {
        rows.push(...batch); if (first) { first = false; entered(); await held; }
      } });
    await paused;
    // Submit the standard native DDL during the original read. Its completion
    // may wait for this old snapshot; do not await it while holding that read.
    building = ddl.query(`CREATE UNIQUE INDEX CONCURRENTLY ${index} ON synthetic.numbers(n)`);
    void building.then(() => { ddlSettled = true; }, () => { ddlSettled = true; });
    for (let attempt = 0; attempt < 150 && !ddlSettled; attempt++) {
      const progress = await observer.query('SELECT phase FROM pg_catalog.pg_stat_progress_create_index WHERE pid=$1', [pid]);
      for (const row of progress.rows) if (!phases.includes(String(row.phase))) phases.push(String(row.phase));
      if (phases.some(phase => phase.includes('waiting for old snapshots'))) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(phases.length > 0 || ddlSettled, 'native index creation really started during the paused read');
    const completedWhileReadPaused = ddlSettled;
    release();
    const terminal = await running;
    assert.equal(terminal.status, 'completed', terminal.errorCode ?? ''); assert.equal(terminal.rowsReceived, 128);
    assert.deepEqual(rows.map(row => row[0]), Array.from({ length: 128 }, (_value, ordinal) => String(ordinal + 1)));
    assert.deepEqual(terminal.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
    await building;
    const actual = await observer.query('SELECT indisvalid,indisready FROM pg_catalog.pg_index WHERE indexrelid=$1::regclass', [`synthetic.${index}`]);
    assert.deepEqual(actual.rows, [{ indisvalid: true, indisready: true }]);
    const after = await driver.catalog(runtime); assert.equal(after.observation.queryQualified, true);
    context.diagnostic(JSON.stringify({ progressPhases: phases, completedWhileReadPaused, originalRows: terminal.rowsReceived, originalResourceState: terminal.resourceState, indexValid: true, accountStillQualified: after.observation.queryQualified }));
  } finally {
    release(); if (running) await running; if (building) await building.catch(() => {});
    await ddl.query(`DROP INDEX CONCURRENTLY IF EXISTS synthetic.${index}`);
    await ddl.end(); await observer.end();
  }
});
