import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DbLinkStore, DbLinkStoreError } from '../src/host/db-link-store.ts';
import type { DbLinkConnectionInput, DbLinkStoreOptions } from '../src/host/db-link-types.ts';

const configuration = (): DbLinkConnectionInput => ({
  name: '合成经营库', engine: 'postgresql', host: 'db.example.test', port: 5432,
  database: 'synthetic', username: 'restricted_reader', password: 'synthetic-private-password',
  tls: { rejectUnauthorized: true, verifyIdentity: true },
  budget: { connectTimeoutMs: 3000, queryTimeoutMs: 10000, lockTimeoutMs: 1000, maxRows: 1000, maxBytes: 1048576, maxCellBytes: 65536, chunkBytes: 262144, maxConcurrent: 2 },
});
const owner = { projectId: 'project-a', taskId: 'task-a', requestId: 'request-a', operationId: 'operation-a' };
const options = (dataRoot: string): DbLinkStoreOptions => ({
  dataRoot, projectState: id => id === 'project-a' ? { archived: false } : null,
  taskProject: id => id === 'task-a' ? 'project-a' : null,
  probe: async () => ({ observation: { reachable: true, sourceIdentity: 'synthetic-server', permissionBinding: 'restricted-reader', queryQualified: true, cancelCapability: 'unverified', limitations: ['strong cancellation unavailable'] }, resourceState: { remoteTerminal: true, connectionEnded: true, commandTerminal: true, transactionEnded: true } }),
});
const errorCode = (code: string) => (error: unknown): boolean => error instanceof DbLinkStoreError && error.code === code;

test('reopening a saved revision preserves its unconfirmed read and blocks same-domain probes until the matching owner finishes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-recovery-'));
  try {
    const setup = options(directory), initial = new DbLinkStore(setup); await initial.init(); const input = configuration();
    const receipt = await initial.testConnection(input), saved = await initial.saveConnection(input, receipt.id);
    const persisted = JSON.parse(await readFile(initial.settingsPath, 'utf8'));
    persisted.connections[0].unconfirmedRead = { owner, startedAt: '2026-11-15T01:00:00.000Z' };
    await writeFile(initial.settingsPath, JSON.stringify(persisted));
    let probes = 0; const baseProbe = setup.probe; setup.probe = async value => { probes++; return baseProbe(value); };
    const reopened = new DbLinkStore(setup); await reopened.init();
    const snapshot = reopened.connectionSnapshot(saved.id);
    assert.throws(() => reopened.assertReadClear(snapshot), errorCode('db_read_unconfirmed'));
    await assert.rejects(reopened.testConnection({ ...input, name: 'same domain alias', host: 'DB.EXAMPLE.TEST' }), errorCode('db_read_unconfirmed'));
    await assert.rejects(reopened.saveConnection({ ...input, id: saved.id, budget: { ...input.budget, maxRows: 1 } }, 'old-receipt'), errorCode('db_read_unconfirmed'));
    assert.equal(probes, 0);
    assert.equal(JSON.stringify([reopened.list(), reopened.read(saved.id), snapshot]).includes('unconfirmedRead'), false);
    assert.equal(JSON.stringify([reopened.list(), reopened.read(saved.id), snapshot]).includes(owner.operationId), false);
    await assert.rejects(reopened.recordReadFinished(saved.id, saved.revision, { ...owner, operationId: 'other-operation' }), errorCode('db_read_owner_mismatch'));
    assert.throws(() => reopened.assertReadClear(snapshot), errorCode('db_read_unconfirmed'));
    await reopened.recordReadFinished(saved.id, saved.revision, owner);
    reopened.assertReadClear(snapshot);
    const clean = new DbLinkStore(setup); await clean.init(); clean.assertReadClear(clean.connectionSnapshot(saved.id));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('recording a read persists before admission and follows its original revision across aliases and target edits', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-read-start-'));
  try {
    const setup = { ...options(directory), now: () => Date.parse('2026-11-15T02:00:00.000Z') }, store = new DbLinkStore(setup); await store.init(); const input = configuration();
    const receipt = await store.testConnection(input), saved = await store.saveConnection(input, receipt.id);
    const aliasInput = { ...input, name: 'alias', host: 'DB.EXAMPLE.TEST' }, aliasReceipt = await store.testConnection(aliasInput), alias = await store.saveConnection(aliasInput, aliasReceipt.id);
    const changedName = { ...input, id: saved.id, name: 'new name', budget: { ...input.budget, maxRows: 1 } }, earlierReceipt = await store.testConnection(changedName);
    const original = store.connectionSnapshot(saved.id), markedOwner = { ...owner, requestId: 'request:a', operationId: 'read:operation:a' };
    await store.recordReadStarted(saved.id, saved.revision, markedOwner);
    const marked = JSON.parse(await readFile(store.settingsPath, 'utf8'));
    assert.deepEqual(marked.connections[0].unconfirmedRead, { owner: markedOwner, startedAt: '2026-11-15T02:00:00.000Z' });
    assert.throws(() => store.assertReadClear(original), errorCode('db_read_unconfirmed'));
    assert.throws(() => store.assertReadClear(store.connectionSnapshot(alias.id)), errorCode('db_read_unconfirmed'));
    await assert.rejects(store.recordReadStarted(alias.id, alias.revision, { ...markedOwner, operationId: 'another:operation' }), errorCode('db_read_unconfirmed'));
    await assert.rejects(store.saveConnection(changedName, earlierReceipt.id), errorCode('db_read_unconfirmed'));
    const targetEdit = { ...input, id: saved.id, database: 'another_database' }, targetReceipt = await store.testConnection(targetEdit), revised = await store.saveConnection(targetEdit, targetReceipt.id);
    assert.equal(revised.revision, 2); store.assertReadClear(store.connectionSnapshot(saved.id));
    const reopened = new DbLinkStore(setup); await reopened.init();
    assert.throws(() => reopened.assertReadClear(original), errorCode('db_read_unconfirmed'));
    await reopened.recordReadFinished(saved.id, revised.revision, markedOwner);
    assert.throws(() => reopened.assertReadClear(reopened.connectionSnapshot(alias.id)), errorCode('db_read_unconfirmed'));
    for (const changed of [{ engine: 'mysql' as const }, { host: 'different.example.test' }, { port: 5433 }, { database: 'another_database' }, { username: 'other_reader' }]) reopened.assertReadClear({ ...original, ...changed });
    await reopened.recordReadFinished(saved.id, saved.revision, markedOwner);
    reopened.assertReadClear(original); reopened.assertReadClear(reopened.connectionSnapshot(alias.id));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('old schema1 sources are not backfilled and an unsaved probe never persists candidate credentials', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-recovery-compat-'));
  try {
    const setup = options(directory), store = new DbLinkStore(setup); await store.init(); const input = configuration();
    const empty = await readFile(store.settingsPath, 'utf8');
    const receipt = await store.testConnection(input);
    assert.equal(await readFile(store.settingsPath, 'utf8'), empty);
    const saved = await store.saveConnection(input, receipt.id), savedBytes = await readFile(store.settingsPath, 'utf8');
    assert.equal(savedBytes.includes('unconfirmedRead'), false);
    const reopened = new DbLinkStore(setup); await reopened.init();
    reopened.assertReadClear(reopened.connectionSnapshot(saved.id));
    assert.equal(await readFile(reopened.settingsPath, 'utf8'), savedBytes);
    await assert.rejects(reopened.recordReadStarted('never-saved', 1, owner), errorCode('db_connection_not_found'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('failed read-start or read-finish persistence freezes further Store access rather than clearing an uncertain read', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-recovery-write-'));
  try {
    for (const phase of ['start', 'finish'] as const) {
      const setup = options(path.join(directory, phase)), store = new DbLinkStore(setup); await store.init(); const input = configuration();
      const receipt = await store.testConnection(input), saved = await store.saveConnection(input, receipt.id), snapshot = store.connectionSnapshot(saved.id);
      if (phase === 'finish') await store.recordReadStarted(saved.id, saved.revision, owner);
      const original = await readFile(store.settingsPath, 'utf8'), outside = path.join(directory, `${phase}-outside`);
      await writeFile(outside, 'outside bytes are preserved'); await unlink(store.settingsPath); await symlink(outside, store.settingsPath);
      const operation = phase === 'start' ? store.recordReadStarted(saved.id, saved.revision, owner) : store.recordReadFinished(saved.id, saved.revision, owner);
      await assert.rejects(operation, errorCode('db_store_write_failed'));
      assert.equal(await readFile(outside, 'utf8'), 'outside bytes are preserved');
      assert.throws(() => store.assertReadClear(snapshot), errorCode('db_store_not_initialized'));
      // Restore the protected fixture file, then check what an actual restart observes.
      await unlink(store.settingsPath); await writeFile(store.settingsPath, original);
      const reopened = new DbLinkStore(setup); await reopened.init();
      if (phase === 'finish') assert.throws(() => reopened.assertReadClear(snapshot), errorCode('db_read_unconfirmed'));
      else reopened.assertReadClear(snapshot);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('corrupt persisted read markers are rejected and serialized starts cannot replace another owner', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-recovery-owner-'));
  try {
    const setup = options(directory), store = new DbLinkStore(setup); await store.init(); const input = configuration();
    const receipt = await store.testConnection(input), saved = await store.saveConnection(input, receipt.id);
    const [first, second] = await Promise.allSettled([store.recordReadStarted(saved.id, saved.revision, owner), store.recordReadStarted(saved.id, saved.revision, { ...owner, requestId: 'other-request' })]);
    assert.equal(first.status, 'fulfilled'); assert.equal(second.status, 'rejected');
    if (second.status === 'rejected') assert.equal(errorCode('db_read_unconfirmed')(second.reason), true);
    for (const change of [{ projectId: 'project-b' }, { taskId: 'task-b' }, { requestId: 'different-request' }, { operationId: 'different-operation' }]) await assert.rejects(store.recordReadFinished(saved.id, saved.revision, { ...owner, ...change }), errorCode('db_read_owner_mismatch'));
    const validBytes = await readFile(store.settingsPath, 'utf8');
    for (const marker of [null, { owner, startedAt: 'invalid' }, { owner: { ...owner, requestId: 'bad\nrequest' }, startedAt: '2026-11-15T02:00:00.000Z' }, { owner: { ...owner, extra: 'invalid' }, startedAt: '2026-11-15T02:00:00.000Z' }]) {
      const persisted = JSON.parse(validBytes); persisted.connections[0].unconfirmedRead = marker; await writeFile(store.settingsPath, JSON.stringify(persisted));
      await assert.rejects(new DbLinkStore(setup).init(), errorCode('db_store_corrupt'));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an unsaved UNKNOWN probe persists only its unfinished receipt domain and retry cleans the original resource before a new probe', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-unsaved-probe-'));
  try {
    let probes = 0, cleanups = 0, ended = false; const setup = options(directory), baseProbe = setup.probe;
    let atDispatch: Record<string, unknown> | undefined;
    setup.probe = async runtime => {
      probes++; atDispatch = JSON.parse(await readFile(path.join(directory, 'db-link', 'connections.json'), 'utf8'));
      const ordinary = await baseProbe(runtime);
      return { observation: ordinary.observation, resourceState: { remoteTerminal: probes > 1, connectionEnded: probes > 1, commandTerminal: probes > 1, transactionEnded: probes > 1 }, cleanup: async () => { cleanups++; return { remoteTerminal: ended, connectionEnded: ended, commandTerminal: ended, transactionEnded: ended }; } };
    };
    const store = new DbLinkStore(setup); await store.init(); const input = configuration();
    await assert.rejects(store.testConnection(input), errorCode('db_read_unconfirmed'));
    const pending = (atDispatch!.unconfirmedTests as { id: string; engine: string; host: string; port: number; database: string; username: string; startedAt: string }[])[0];
    assert.deepEqual(Object.keys(pending).sort(), ['database', 'engine', 'host', 'id', 'port', 'startedAt', 'username']);
    assert.equal(atDispatch!.connections instanceof Array && atDispatch!.connections.length, 0);
    assert.equal(JSON.stringify(atDispatch).includes(input.password!), false);
    await assert.rejects(store.testConnection(input), errorCode('db_read_unconfirmed')); assert.equal(probes, 1); assert.equal(cleanups, 1);
    await assert.rejects(store.testConnection({ ...input, name: 'alias', host: 'DB.EXAMPLE.TEST' }), errorCode('db_read_unconfirmed')); assert.equal(cleanups, 1);
    ended = true; const receipt = await store.testConnection(input);
    assert.equal(cleanups, 2); assert.equal(probes, 2); assert.notEqual(receipt.id, pending.id);
    const cleared = await readFile(store.settingsPath, 'utf8'); assert.equal(cleared.includes('unconfirmedTests'), false); assert.equal(cleared.includes(input.password!), false);
    await store.saveConnection(input, receipt.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('UNKNOWN test receipts survive expiry and restart without credentials, automatic cleanup or an alias probe', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-probe-restart-'));
  try {
    let now = Date.parse('2026-11-15T03:00:00.000Z'), probes = 0, cleanups = 0; const setup = { ...options(directory), now: () => now, testReceiptTtlMs: 1 }, ordinaryProbe = setup.probe;
    setup.probe = async runtime => {
      probes++; const result = await ordinaryProbe(runtime);
      return runtime.host === 'db.example.test' ? { ...result, resourceState: { remoteTerminal: false, connectionEnded: true, commandTerminal: false, transactionEnded: false }, cleanup: async () => { cleanups++; return { remoteTerminal: false, connectionEnded: true, commandTerminal: false, transactionEnded: false }; } } : result;
    };
    const store = new DbLinkStore(setup); await store.init(); const input = configuration();
    await assert.rejects(store.testConnection(input), errorCode('db_read_unconfirmed'));
    now += 10000000; await store.testConnection({ ...input, host: 'independent.example.test' });
    await assert.rejects(store.testConnection(input), errorCode('db_read_unconfirmed')); assert.equal(cleanups, 1);
    const beforeRestart = await readFile(store.settingsPath, 'utf8'); assert.equal(JSON.parse(beforeRestart).unconfirmedTests.length, 1); assert.equal(beforeRestart.includes(input.password!), false);
    const reopened = new DbLinkStore(setup); await reopened.init();
    await assert.rejects(reopened.testConnection(input), errorCode('db_read_unconfirmed'));
    await assert.rejects(reopened.testConnection({ ...input, name: 'new alias', host: 'DB.EXAMPLE.TEST', budget: { ...input.budget, maxRows: 1 } }), errorCode('db_read_unconfirmed'));
    await assert.rejects(reopened.saveConnection(input, 'forged-receipt'), errorCode('db_read_unconfirmed'));
    assert.equal(probes, 2); assert.equal(cleanups, 1); assert.equal(await readFile(store.settingsPath, 'utf8'), beforeRestart);
    await assert.rejects(reopened.testConnection({ ...input, unconfirmedTests: [] } as DbLinkConnectionInput), errorCode('invalid_db_configuration'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('missing original resource proof stays UNKNOWN but a fully closed no-command failure permits a later corrected test', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-probe-proof-'));
  try {
    const input = configuration(), setup = options(directory), ordinaryProbe = setup.probe; let probes = 0;
    setup.probe = async runtime => { probes++; return (await ordinaryProbe(runtime)).observation as unknown as Awaited<ReturnType<DbLinkStoreOptions['probe']>>; };
    const store = new DbLinkStore(setup); await store.init();
    await assert.rejects(store.testConnection(input), errorCode('db_read_unconfirmed'));
    await assert.rejects(store.testConnection(input), errorCode('db_read_unconfirmed')); assert.equal(probes, 1);
    assert.equal(JSON.parse(await readFile(store.settingsPath, 'utf8')).unconfirmedTests.length, 1);
    let failConnect = true;
    setup.probe = async runtime => { const result = await ordinaryProbe(runtime); return failConnect ? { ...result, observation: { ...result.observation, reachable: false, queryQualified: false } } : result; };
    const independent = { ...input, host: 'connect-failure.example.test' };
    await assert.rejects(store.testConnection(independent), errorCode('db_test_failed'));
    assert.equal(JSON.parse(await readFile(store.settingsPath, 'utf8')).unconfirmedTests.length, 1, 'only the unrelated UNKNOWN remains');
    failConnect = false; const receipt = await store.testConnection(independent); await store.saveConnection(independent, receipt.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a probe never dispatches when its credential-free receipt cannot be persisted', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-probe-persist-'));
  try {
    const setup = options(directory); let probes = 0; const originalProbe = setup.probe; setup.probe = async runtime => { probes++; return originalProbe(runtime); };
    const store = new DbLinkStore(setup); await store.init(); const outside = path.join(directory, 'outside'); await writeFile(outside, 'preserve outside');
    await unlink(store.settingsPath); await symlink(outside, store.settingsPath);
    await assert.rejects(store.testConnection(configuration()), errorCode('db_store_write_failed'));
    assert.equal(probes, 0); assert.equal(await readFile(outside, 'utf8'), 'preserve outside');
    assert.throws(() => store.list(), errorCode('db_store_not_initialized'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a saved source cannot bypass an unfinished test receipt through read admission or a read-finish call', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-probe-domain-'));
  try {
    const setup = options(directory), store = new DbLinkStore(setup); await store.init(); const input = configuration(), receipt = await store.testConnection(input), saved = await store.saveConnection(input, receipt.id);
    const baseProbe = setup.probe; setup.probe = async runtime => ({ ...await baseProbe(runtime), resourceState: { remoteTerminal: false, connectionEnded: false, commandTerminal: false, transactionEnded: false } });
    await assert.rejects(store.testConnection({ ...input, id: saved.id }), errorCode('db_read_unconfirmed'));
    assert.throws(() => store.assertReadClear(store.connectionSnapshot(saved.id)), errorCode('db_read_unconfirmed'));
    await assert.rejects(store.recordReadStarted(saved.id, saved.revision, owner), errorCode('db_read_unconfirmed'));
    await store.recordReadFinished(saved.id, saved.revision, owner);
    assert.throws(() => store.assertReadClear(store.connectionSnapshot(saved.id)), errorCode('db_read_unconfirmed'));
    assert.equal(JSON.stringify([store.list(), store.read(saved.id), store.connectionSnapshot(saved.id)]).includes('unconfirmedTests'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('failed removal of a closed probe receipt never returns a savable result or releases Store admission', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'optracall-db-probe-finish-persist-'));
  try {
    const setup = options(directory), baseProbe = setup.probe; let dispatchedBytes = '';
    const store = new DbLinkStore(setup); await store.init(); const outside = path.join(directory, 'outside'); await writeFile(outside, 'preserve outside');
    setup.probe = async runtime => {
      dispatchedBytes = await readFile(store.settingsPath, 'utf8');
      await unlink(store.settingsPath); await symlink(outside, store.settingsPath); return baseProbe(runtime);
    };
    await assert.rejects(store.testConnection(configuration()), errorCode('db_store_write_failed'));
    assert.throws(() => store.list(), errorCode('db_store_not_initialized')); assert.equal(await readFile(outside, 'utf8'), 'preserve outside');
    await unlink(store.settingsPath); await writeFile(store.settingsPath, dispatchedBytes);
    const reopened = new DbLinkStore(options(directory)); await reopened.init();
    await assert.rejects(reopened.testConnection(configuration()), errorCode('db_read_unconfirmed'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
