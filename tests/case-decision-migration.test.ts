import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CaseStore } from '../src/host/case-store.ts';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-m5-migration-')));
  const dataRoot = path.join(root, 'private'), store = new CaseStore({ dataRoot });
  await store.initialize();
  t.after(async () => { store.close(); });
  const record = store.createCase({ operationId: randomUUID(), title: '原Case', judgement: '原判断，尚未验证' });
  const projectId = randomUUID();
  store.linkProject({ operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: 1 });
  store.addCaseNote({ operationId: randomUUID(), caseId: record.id, expectedRevision: 2, note: '原说明保留' });
  store.saveProjectWork({ operationId: randomUUID(), projectId, expectedRevision: 0, workStatus: 'awaiting_feedback', workScope: '原项目范围', nextStep: '等反馈', assignee: '原负责人' });
  store.saveArtifact({ operationId: randomUUID(), caseId: record.id, expectedRevision: 3, projectId, relativePath: '060_reports/original.md' });
  store.reserveProjectCreation({ operationId: randomUUID(), caseId: record.id, expectedRevision: 4, projectId: randomUUID(), projectInput: { name: '原待承接项目', configurationId: 'synthetic' } });
  const caseStoreId = store.getStatus().storeId!;
  const origin = { actorKind: 'agent' as const, projectId, taskId: randomUUID(), requestId: randomUUID(), sessionId: 'synthetic-native', toolCallId: 'call-1' };
  const input = { operationId: randomUUID(), caseStoreId, caseId: record.id, expectedRevision: 0, kind: 'hypothesis' as const, payload: { title: '新草案', statement: '补货权限待核' } };
  return { root, dataRoot, store, caseId: record.id, caseStoreId, origin, input, databasePath: path.join(dataRoot, 'decision-cases.sqlite3'), markerPath: path.join(dataRoot, 'decision-cases-store.json') };
}
function databaseState(file: string) {
  const db = new DatabaseSync(file, { readOnly: true, allowExtension: false });
  try {
    const tables = ['store_metadata', 'cases', 'case_project_links', 'project_work', 'case_artifact_links', 'operation_receipts', 'work_events'];
    return {
      version: db.prepare('PRAGMA user_version').get()!.user_version,
      inventory: db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),
      rows: Object.fromEntries(tables.map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()])),
      integrity: db.prepare('PRAGMA integrity_check').get()!.integrity_check,
      foreignKeys: db.prepare('PRAGMA foreign_key_check').all(),
    };
  } finally { db.close(); }
}

test('M5-MIG-01: only explicit M5 write upgrades v1; every old row/JSON/identity remains and disabled compatible code maintains new work', async t => {
  const { store, dataRoot, caseId, caseStoreId, input, origin, databasePath, markerPath } = await fixture(t);
  const before = databaseState(databasePath), bytes = await fs.readFile(databasePath), marker = await fs.readFile(markerPath);
  assert.equal(before.version, 1);
  assert.deepEqual(store.listDecisions(caseId).items, []);
  assert.deepEqual(await fs.readFile(databasePath), bytes, 'GET has no schema or database write');
  const saved = store.saveDecisionDraft(input, origin), after = databaseState(databasePath);
  assert.equal(after.version, 2); assert.equal(after.integrity, 'ok'); assert.deepEqual(after.foreignKeys, []);
  assert.deepEqual(await fs.readFile(markerPath), marker);
  const added = after.inventory.filter(r => r.type === 'table').map(r => r.name).filter(name => !before.inventory.some(r => r.type === 'table' && r.name === name));
  assert.deepEqual(added, ['case_decision_revisions']);
  for (const [table, rows] of Object.entries(before.rows)) for (const original of rows) assert.ok(after.rows[table]!.some(current => JSON.stringify(current) === JSON.stringify(original)), `original ${table} row and exact JSON preserved`);
  store.close();
  const compatible = new CaseStore({ dataRoot, decisionsEnabled: false });
  try {
    assert.equal((await compatible.init()).storeId, caseStoreId);
    assert.equal(compatible.isDecisionWritingEnabled(), false);
    assert.deepEqual(compatible.getDecision(caseId, saved.recordId, 1), saved);
    assert.deepEqual(compatible.saveDecisionDraft(input, origin), saved, 'old completed operation is a read, not disabled new write');
    assert.throws(() => compatible.saveDecisionDraft({ ...input, operationId: randomUUID() }, origin), /case_decisions_disabled/);
    const addedCase = compatible.createCase({ operationId: randomUUID(), title: '关闭M5后新增的Case' });
    const old = compatible.getCase(caseId);
    compatible.updateCase({ operationId: randomUUID(), caseId, expectedRevision: old.revision, judgement: '关闭M5后原Case仍能维护' });
    assert.equal(compatible.getCase(addedCase.id).title, '关闭M5后新增的Case');
    assert.deepEqual(compatible.getDecision(caseId, saved.recordId, 1), saved);
  } finally { compatible.close(); }
  assert.equal((await store.init()).storeId, caseStoreId);
  assert.equal(store.listCases().length, 2); assert.equal(store.getCase(caseId).judgement, '关闭M5后原Case仍能维护');
  assert.deepEqual(store.getDecision(caseId, saved.recordId, 1), saved);
});

test('M5-MIG-02: failed rollback must not expose an uncommitted completed receipt as a durable save', async t => {
  const { store, input, origin, databasePath } = await fixture(t);
  const before = databaseState(databasePath), originalExec = DatabaseSync.prototype.exec;
  const fault = t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
    if (sql === 'COMMIT') throw new Error('synthetic IO before commit');
    if (sql === 'ROLLBACK') throw new Error('synthetic rollback IO failure');
    return originalExec.call(this, sql);
  });
  try { assert.throws(() => store.saveDecisionDraft(input, origin), /case_transaction_outcome_unknown/); }
  finally { fault.mock.restore(); }
  assert.equal(store.getStatus().code, 'case_transaction_outcome_unknown');
  assert.equal(store.getOperation(input.operationId), null, 'uncommitted receipt must be discarded with the failed connection');
  assert.deepEqual(databaseState(databasePath), before);
  assert.throws(() => store.createCase({ operationId: randomUUID(), title: '不能在未知存储继续新写' }), /case_transaction_outcome_unknown/);
});

test('M5-MIG-03: migration statement failure and pre-COMMIT IO roll back to the exact known v1 structure without rewriting marker', async t => {
  for (const boundary of ['after_rebuild', 'before_commit']) await t.test(boundary, async t => {
    const { store, input, origin, databasePath, markerPath } = await fixture(t);
    const before = databaseState(databasePath), marker = await fs.readFile(markerPath), originalExec = DatabaseSync.prototype.exec;
    const fault = t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      if (boundary === 'after_rebuild' && sql.startsWith('CREATE TEMP TABLE m5_old_events')) {
        originalExec.call(this, sql); throw new Error('synthetic migration statement acknowledgment failed');
      }
      if (boundary === 'before_commit' && sql === 'COMMIT') throw new Error('synthetic precommit IO failure');
      return originalExec.call(this, sql);
    });
    try { assert.throws(() => store.saveDecisionDraft(input, origin), /synthetic/); }
    finally { fault.mock.restore(); }
    assert.deepEqual(databaseState(databasePath), before);
    assert.deepEqual(await fs.readFile(markerPath), marker);
    assert.equal(store.getOperation(input.operationId), null);
    assert.equal(store.listDecisions(input.caseId).items.length, 0);
    assert.equal(store.saveDecisionDraft(input, origin).revision, 1, 'only an explicit retry after proven rollback writes');
  });
});

test('M5-MIG-04: actual COMMIT followed by lost acknowledgment retains v2 and one saved record; only original readback is allowed', async t => {
  const { store, input, origin, databasePath, markerPath, caseId, caseStoreId } = await fixture(t);
  const marker = await fs.readFile(markerPath), originalExec = DatabaseSync.prototype.exec;
  let armed = true;
  const fault = t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
    const result = originalExec.call(this, sql);
    if (armed && sql === 'COMMIT') { armed = false; throw new Error('synthetic postcommit lost acknowledgment'); }
    return result;
  });
  try { assert.throws(() => store.saveDecisionDraft(input, origin), /case_transaction_outcome_unknown/); }
  finally { fault.mock.restore(); }
  assert.equal(store.getStatus().code, 'case_transaction_outcome_unknown');
  assert.equal(databaseState(databasePath).version, 2);
  assert.equal(store.getStatus().storeId, caseStoreId, 'verified read-only history retains its original store identity despite UNKNOWN');
  assert.deepEqual(await fs.readFile(markerPath), marker);
  const receipt = store.getOperation(input.operationId)!;
  assert.equal(receipt.phase, 'completed'); assert.equal(receipt.result!.revision, 1);
  assert.equal(store.listDecisions(caseId).items.length, 1);
  assert.throws(() => store.saveDecisionDraft({ ...input, operationId: randomUUID() }, origin), /case_transaction_outcome_unknown/);
  store.close(); const compatible = new CaseStore({ dataRoot: path.dirname(databasePath), decisionsEnabled: false });
  try {
    assert.equal((await compatible.init()).storeId, caseStoreId);
    assert.deepEqual(compatible.saveDecisionDraft(input, origin), receipt.result);
    assert.equal(compatible.listDecisions(caseId).items.length, 1);
  } finally { compatible.close(); }
});

test('M5-MIG-05: unknown schema2 inventory is refused unchanged instead of deleting it to pass', async t => {
  const { store, input, origin, databasePath, markerPath } = await fixture(t);
  store.saveDecisionDraft(input, origin); store.close();
  const external = new DatabaseSync(databasePath);
  external.exec('CREATE INDEX unrecognized_m5_index ON case_decision_revisions(created_at)'); external.close();
  const bytes = await fs.readFile(databasePath), marker = await fs.readFile(markerPath);
  assert.deepEqual(await store.init(), { state: 'unavailable', code: 'unsupported_case_schema' });
  assert.deepEqual(await fs.readFile(databasePath), bytes); assert.deepEqual(await fs.readFile(markerPath), marker);
});
