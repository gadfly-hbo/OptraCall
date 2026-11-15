import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { Client, type ClientConfig } from 'pg';
import { createDbLinkDriver } from '../src/host/db-link-driver.ts';
import type { DbLinkPgClient } from '../src/host/db-link-driver.ts';
import type { DbLinkRuntimeConnection } from '../src/host/db-link-types.ts';

const configPath = process.env.OPTRACALL_DB_PG_V05_CONFIG;
const native = { skip: configPath ? false : 'Requires the root-managed isolated v0.5 PostgreSQL fixture; no database startup' };
async function fixture(): Promise<{ runtime: DbLinkRuntimeConnection; admin: ClientConfig }> { return JSON.parse(await readFile(configPath!, 'utf8')); }

test('v0.5 real original command/transaction/end finish without an observer or pg_control_system privilege', native, async () => {
  const { runtime } = await fixture(), driver = createDbLinkDriver(), catalog = await driver.catalog(runtime);
  assert.equal(catalog.observation.queryQualified, true, JSON.stringify(catalog.observation.limitations));
  assert.deepEqual(catalog.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
  assert.equal(catalog.receiveFacts?.observer, undefined); assert.equal(catalog.receiveFacts?.original.closed, true);
  assert.deepEqual(await catalog.cleanup!(), catalog.resourceState);
});

async function blockedRead(mode: 'stop' | 'disconnect') {
  const { runtime: original, admin } = await fixture(), runtime = structuredClone(original);
  runtime.budget.queryTimeoutMs = 1500; runtime.budget.lockTimeoutMs = 250;
  const authority = new Client(admin); await authority.connect();
  let dispatched!: () => void, disconnect: (() => Promise<void>) | undefined, clients = 0, delivered = 0;
  const dispatch = new Promise<void>(resolve => { dispatched = resolve; }), statements: string[] = [], controller = new AbortController();
  const driver = createDbLinkDriver({ postgresClient(config) {
    clients++; const client = new Client(config); disconnect = () => client.end();
    const wrapper: DbLinkPgClient = { async connect() { await client.connect(); }, end: () => client.end(), on: (event, listener) => client.addListener(event, listener),
      query(input) {
        const sql = (input as { text?: string }).text;
        if (sql) statements.push(sql);
        const result = client.query(input as never);
        if (typeof (input as { read?: unknown }).read === 'function') dispatched();
        return result;
      } };
    return wrapper;
  } });
  const catalog = await driver.catalog(runtime); assert.equal(catalog.observation.queryQualified, true);
  try {
    await authority.query('BEGIN'); await authority.query('LOCK TABLE synthetic.numbers IN ACCESS EXCLUSIVE MODE');
    const running = driver.openQuery(runtime, { sql: 'SELECT n FROM synthetic.numbers ORDER BY n', parameters: [], scope: { objects: ['*'] }, signal: controller.signal,
      expectedSourceIdentity: catalog.observation.sourceIdentity, expectedPermissionBinding: catalog.observation.permissionBinding,
      onColumns() { delivered++; }, onRows() { delivered++; } });
    await dispatch;
    if (mode === 'stop') controller.abort();
    else await disconnect!();
    const terminal = await running;
    assert.equal(delivered, 0);
    assert.equal(clients, 2, 'one catalog operation and one query operation, no observer/replacement connection');
    assert.equal(statements.some(sql => /pg_control_system|pg_stat_activity|pg_cancel_backend|pg_terminate_backend/.test(sql)), false);
    return { terminal, statements, driver };
  } finally { await authority.query('ROLLBACK'); await authority.end(); }
}

test('v0.5 native stop waits for original lock_timeout response and closes portal/transaction without delivering late rows', native, async () => {
  const { terminal } = await blockedRead('stop');
  assert.equal(terminal.status, 'cancelled', terminal.errorCode ?? '');
  assert.deepEqual(terminal.resourceState, { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true });
});

test('v0.5 native original connection loss remains UNKNOWN and cleanup does not reconnect, replay or signal a PID', native, async () => {
  const { terminal, statements } = await blockedRead('disconnect');
  assert.equal(terminal.status, 'unknown'); assert.equal(terminal.remoteTerminal, false);
  const before = statements.length, state = await terminal.cleanup!();
  assert.equal(state.remoteTerminal, false); assert.equal(state.transactionEnded, false);
  assert.equal(statements.length, before);
});
