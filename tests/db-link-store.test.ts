import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DbLinkStore, DbLinkStoreError } from '../src/host/db-link-store.ts';
import type { DbLinkConnectionInput, DbLinkStoreOptions } from '../src/host/db-link-types.ts';

const configuration = (): DbLinkConnectionInput => ({
  name: '合成经营库', engine: 'postgresql', host: 'db.example.test', port: 5432,
  database: 'synthetic', username: 'restricted_reader', password: 'synthetic-private-password',
  tls: { ca: 'synthetic-ca', rejectUnauthorized: true, verifyIdentity: true },
  budget: { connectTimeoutMs: 3000, queryTimeoutMs: 10000, lockTimeoutMs: 1000, maxRows: 1000, maxBytes: 1048576, maxCellBytes: 65536, chunkBytes: 262144, maxConcurrent: 2 },
});

const grantInput = (connectionId: string) => ({ connectionId, scope: { objects: ['public.orders', 'public.refunds'] }, modelExport: { targets: ['model-a'], structure: true, comments: true, queryText: true, results: true } });
const errorCode = (code: string) => (error: unknown): boolean => error instanceof DbLinkStoreError && error.code === code;

test('db-link project grants are explicit, inherited by real tasks, and revoke without waiting for a connection probe', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-grants-'));
  try {
    const setup = options(directory); let probeEntered!: () => void, releaseProbe!: () => void;
    const entered = new Promise<void>(resolve => { probeEntered = resolve; });
    const blocked = new Promise<void>(resolve => { releaseProbe = resolve; });
    const baseProbe = setup.probe;
    const store = new DbLinkStore(setup); await store.init();
    const input = configuration(); const receipt = await store.testConnection(input); const saved = await store.saveConnection(input, receipt.id);
    assert.deepEqual(store.listTaskSources('project-a', 'task-a'), []);
    const grant = await store.grantProject('project-a', grantInput(saved.id));
    assert.equal(grant.permissionBinding, 'restricted_reader:domain-a');
    assert.equal(store.requireTaskSource('project-a', 'task-a', saved.id).connection.fingerprint, saved.fingerprint);
    assert.deepEqual(store.listTaskSources('project-b', 'task-b'), []);
    assert.throws(() => store.requireTaskSource('project-b', 'task-a', saved.id), errorCode('db_task_not_found'));
    setup.probe = async candidate => { probeEntered(); await blocked; return baseProbe(candidate); };
    const probing = store.testConnection({ ...input, id: saved.id }); await entered;
    try {
      const revoking = store.revokeProject('project-a', saved.id);
      assert.throws(() => store.requireTaskSource('project-a', 'task-a', saved.id), errorCode('db_source_not_authorized'));
      await revoking;
      assert.deepEqual(store.listTaskSources('project-a', 'task-a'), []);
      assert.throws(() => store.requireTaskSource('project-a', 'task-a', saved.id), errorCode('db_source_not_authorized'));
    } finally { releaseProbe(); await probing; }
    assert.equal(store.listProjectSources('project-a')[0].grant.revokedAt !== null, true);
    const reopened = new DbLinkStore(options(directory)); await reopened.init();
    assert.deepEqual(reopened.listTaskSources('project-a', 'task-a'), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('db-link rejects forged, changed, expired and replayed test receipts and retains prior revision identity', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-receipts-'));
  try {
    let now = Date.now(); const setup = { ...options(directory), now: () => now, testReceiptTtlMs: 1000 };
    const store = new DbLinkStore(setup); await store.init(); const input = configuration();
    await assert.rejects(store.saveConnection(input, 'client-forged-receipt'), errorCode('db_test_required'));
    const firstTest = await store.testConnection(input);
    for (const changed of [{ ...input, database: 'different' }, { ...input, password: 'rotated-secret' }, { ...input, budget: { ...input.budget, maxRows: 999 } }, { ...input, tls: { ...input.tls, ca: 'different-ca' } }]) await assert.rejects(store.saveConnection(changed, firstTest.id), errorCode('db_test_required'));
    now += 1000; await assert.rejects(store.saveConnection(input, firstTest.id), errorCode('db_test_required'));
    const receipt = await store.testConnection(input); const saved = await store.saveConnection(input, receipt.id);
    await assert.rejects(store.saveConnection(input, receipt.id), errorCode('db_test_required'));
    const captured = store.connectionSnapshot(saved.id); await store.grantProject('project-a', grantInput(saved.id));
    const changed = { ...input, id: saved.id, password: 'new-synthetic-password' }; const retest = await store.testConnection(changed); const revised = await store.saveConnection(changed, retest.id);
    assert.equal(revised.revision, 2); assert.notEqual(revised.fingerprint, saved.fingerprint);
    assert.equal(captured.password, input.password); assert.equal(store.connectionSnapshot(saved.id, 1).password, input.password);
    assert.throws(() => store.requireTaskSource('project-a', 'task-a', saved.id), errorCode('db_connection_changed'));
    assert.equal(store.listProjectSources('project-a')[0].configurationChanged, true);
    await store.grantProject('project-a', grantInput(saved.id));
    assert.equal(store.requireTaskSource('project-a', 'task-a', saved.id).connection.revision, 2);
    const reopened = new DbLinkStore(setup); await reopened.init();
    assert.equal(reopened.connectionSnapshot(saved.id, 1).password, input.password);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('db-link task policies only narrow project scope and model export; archived and foreign owners cannot write', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-owner-'));
  try {
    let archived = false; const setup = options(directory); const projectState = setup.projectState;
    setup.projectState = id => { const state = projectState(id); return state ? { archived } : null; };
    const store = new DbLinkStore(setup); await store.init(); const input = configuration(); const testReceipt = await store.testConnection(input); const saved = await store.saveConnection(input, testReceipt.id);
    await store.grantProject('project-a', grantInput(saved.id));
    await assert.rejects(store.setTaskPolicy('project-b', 'task-a', saved.id, { excluded: true }), errorCode('db_task_not_found'));
    await assert.rejects(store.setTaskPolicy('project-a', 'task-a', saved.id, { excluded: false, scope: { objects: ['public.secrets'] } }), errorCode('db_task_scope_expanded'));
    await assert.rejects(store.setTaskPolicy('project-a', 'task-a', saved.id, { excluded: false, modelExport: { ...grantInput(saved.id).modelExport, targets: ['model-b'] } }), errorCode('db_task_scope_expanded'));
    await store.setTaskPolicy('project-a', 'task-a', saved.id, { excluded: false, scope: { objects: ['public.orders'] }, modelExport: { ...grantInput(saved.id).modelExport, comments: false } });
    assert.deepEqual(store.requireTaskSource('project-a', 'task-a', saved.id).scope.objects, ['public.orders']);
    assert.throws(() => store.requireTaskSource('project-a', 'task-a', saved.id, { modelTarget: 'model-b', content: 'results' }), errorCode('db_model_export_not_authorized'));
    assert.throws(() => store.requireTaskSource('project-a', 'task-a', saved.id, { modelTarget: 'model-a', content: 'comments' }), errorCode('db_model_export_not_authorized'));
    await store.setTaskPolicy('project-a', 'task-a', saved.id, { excluded: true }); assert.deepEqual(store.listTaskSources('project-a', 'task-a'), []);
    await store.setTaskPolicy('project-a', 'task-a', saved.id, { excluded: false });
    archived = true;
    assert.equal(store.listProjectSources('project-a').length, 1);
    assert.throws(() => store.requireTaskSource('project-a', 'task-a', saved.id), errorCode('db_project_archived'));
    await assert.rejects(store.grantProject('project-a', grantInput(saved.id)), errorCode('db_project_archived'));
    await assert.rejects(store.revokeProject('project-a', saved.id), errorCode('db_project_archived'));
    await assert.rejects(store.setTaskPolicy('project-a', 'task-a', saved.id, { excluded: true }), errorCode('db_project_archived'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('db-link validates TLS, DNS and budgets before probing and never exposes driver credential errors', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-redaction-'));
  try {
    const setup = options(directory); let calls = 0; const baseProbe = setup.probe;
    setup.probe = async value => { calls++; return baseProbe(value); };
    const store = new DbLinkStore(setup); await store.init(); const input = configuration();
    for (const value of [{ ...input, host: '127.0.0.1' }, { ...input, host: 'db.example.test?sslmode=disable' }, { ...input, tls: { ...input.tls, rejectUnauthorized: false } }, { ...input, budget: { ...input.budget, queryTimeoutMs: Infinity } }, { ...input, connectionString: 'postgres://sensitive' }]) await assert.rejects(store.testConnection(value as DbLinkConnectionInput), errorCode('invalid_db_configuration'));
    assert.equal(calls, 0);
    setup.probe = async () => { throw new Error(`driver failure ${input.password}`); };
    await assert.rejects(store.testConnection(input), error => errorCode('db_read_unconfirmed')(error) && !JSON.stringify(error).includes(input.password!));
    setup.probe = async value => { const result = await baseProbe(value); return { ...result, observation: { ...result.observation, permissionBinding: input.password! } }; };
    await assert.rejects(store.testConnection({ ...input, host: 'independent.example.test' }), errorCode('db_test_failed'));
    assert.deepEqual(store.list(), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('db-link refuses corrupt authorization records instead of silently widening sources on reopen', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-corrupt-'));
  try {
    const store = new DbLinkStore(options(directory)); await store.init(); const input = configuration(); const testReceipt = await store.testConnection(input); const saved = await store.saveConnection(input, testReceipt.id);
    await store.grantProject('project-a', grantInput(saved.id));
    const file = path.join(directory, 'db-link', 'connections.json'); const persisted = JSON.parse(await readFile(file, 'utf8')); persisted.grants[0].connectionFingerprint = 'forged'; await writeFile(file, JSON.stringify(persisted));
    const reopened = new DbLinkStore(options(directory)); await assert.rejects(reopened.init(), errorCode('db_store_corrupt'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('db-link refuses linked persistence and freezes further access after an uncertain save without exposing credentials', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-private-'));
  try {
    const store = new DbLinkStore(options(directory)); await store.init(); const input = configuration(); const receipt = await store.testConnection(input);
    const outside = path.join(directory, 'outside.json'); await writeFile(outside, 'preserve outside bytes');
    await unlink(store.settingsPath); await symlink(outside, store.settingsPath);
    await assert.rejects(store.saveConnection(input, receipt.id), errorCode('db_store_write_failed'));
    assert.equal(await readFile(outside, 'utf8'), 'preserve outside bytes');
    assert.throws(() => store.list(), errorCode('db_store_not_initialized'));
    const reopened = new DbLinkStore(options(directory)); await assert.rejects(reopened.init(), errorCode('db_store_corrupt'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('db-link detects changed persisted configuration under an unchanged fingerprint', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-fingerprint-'));
  try {
    const store = new DbLinkStore(options(directory)); await store.init(); const input = configuration(); const receipt = await store.testConnection(input); await store.saveConnection(input, receipt.id);
    const persisted = JSON.parse(await readFile(store.settingsPath, 'utf8')); persisted.connections[0].database = 'changed-without-test'; await writeFile(store.settingsPath, JSON.stringify(persisted));
    const reopened = new DbLinkStore(options(directory)); await assert.rejects(reopened.init(), errorCode('db_store_corrupt'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
const options = (dataRoot: string): DbLinkStoreOptions => ({
  dataRoot, projectState: id => ['project-a', 'project-b'].includes(id) ? { archived: false } : null,
  taskProject: id => id === 'task-a' ? 'project-a' : id === 'task-b' ? 'project-b' : null,
  probe: async () => ({ observation: { reachable: true, sourceIdentity: 'synthetic-server-1', permissionBinding: 'restricted_reader:domain-a', queryQualified: false, cancelCapability: 'unverified', limitations: ['server termination is unverified'] }, resourceState: { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true } }),
});

test('db-link saves only the exactly tested configuration and reopens private credentials without publishing them', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-store-'));
  try {
    const store = new DbLinkStore(options(directory)); await store.init();
    const input = configuration();
    const receipt = await store.testConnection(input);
    assert.equal(receipt.reachable, true);
    const saved = await store.saveConnection(input, receipt.id);
    assert.equal(saved.revision, 1);
    assert.equal(saved.hasPassword, true);
    assert.equal(saved.observation.queryQualified, false);
    assert.equal(JSON.stringify(saved).includes(input.password!), false);
    const reopened = new DbLinkStore(options(directory)); await reopened.init();
    assert.deepEqual(reopened.list(), [saved]);
    const file = path.join(directory, 'db-link', 'connections.json');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
    assert.equal((await readFile(file, 'utf8')).includes(input.password!), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('ordinary read qualification may lack strong cancellation while JSON cannot forge a Host probe fact', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-read-qualified-'));
  try {
    const setup = options(directory); let calls = 0;
    setup.probe = async () => { calls++; return { observation: { reachable: true, sourceIdentity: 'synthetic-server-1', permissionBinding: 'restricted_reader:domain-a', queryQualified: true, cancelCapability: 'unverified', limitations: ['read command and transaction terminals verified; strong cancellation unavailable'] }, resourceState: { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true } }; };
    const store = new DbLinkStore(setup); await store.init(); const input = configuration();
    const receipt = await store.testConnection(input);
    const saved = await store.saveConnection(input, receipt.id);
    assert.equal(saved.observation.queryQualified, true); assert.equal(saved.observation.cancelCapability, 'unverified');
    const reopened = new DbLinkStore(setup); await reopened.init(); assert.equal(reopened.read(saved.id)!.observation.queryQualified, true);
    for (const forged of [{ ...input, queryQualified: true }, { ...input, observation: saved.observation }, { ...input, unconfirmedRead: null }]) await assert.rejects(store.testConnection(forged), errorCode('invalid_db_configuration'));
    assert.equal(calls, 1, 'qualification only came from the configured Host probe');
    const unqualified = new DbLinkStore(options(await mkdtemp(path.join(directory, 'unqualified-')))); await unqualified.init();
    const unqualifiedReceipt = await unqualified.testConnection(input);
    await assert.rejects(unqualified.saveConnection({ ...input, queryQualified: true } as DbLinkConnectionInput, unqualifiedReceipt.id), errorCode('invalid_db_configuration'));
    assert.equal((await unqualified.saveConnection(input, unqualifiedReceipt.id)).observation.queryQualified, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
