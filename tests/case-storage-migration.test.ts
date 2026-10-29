import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CaseStore } from '../src/host/case-store.ts';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';

const configuration: ProjectConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic model', provider: 'test-provider', model: 'test-model', baseUrl: 'https://example.invalid', api: 'anthropic-messages' };
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-case-migration-')));
  const dataRoot = path.join(root, 'private'), store = new CaseStore({ dataRoot });
  const beforeCleanup: (() => Promise<void>)[] = [];
  t.after(async () => { store.close(); for (const close of beforeCleanup) await close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, dataRoot, store, beforeCleanup, databasePath: path.join(dataRoot, 'decision-cases.sqlite3'), markerPath: path.join(dataRoot, 'decision-cases-store.json') };
}
async function inventory(root: string): Promise<Record<string, { mode: number; sha256: string | null; bytes: number }>> {
  const result: Record<string, { mode: number; sha256: string | null; bytes: number }> = {};
  async function visit(relative: string) {
    const absolute = path.join(root, relative), stat = await fs.lstat(absolute);
    result[relative] = { mode: stat.mode & 0o777, sha256: stat.isFile() ? createHash('sha256').update(await fs.readFile(absolute)).digest('hex') : null, bytes: stat.isFile() ? stat.size : 0 };
    if (stat.isDirectory()) for (const name of (await fs.readdir(absolute)).sort()) await visit(path.join(relative, name));
  }
  await visit(''); return result;
}

test('MIG-01/02: enabling SQLite preserves schema2 JSON, independent tasks, native JSONL parent bytes, directories and backups', async t => {
  const { root, dataRoot, store, beforeCleanup } = await fixture(t);
  const projects = new ProjectStore({ dataRoot, projectsRoot: path.join(root, 'workspace') }); await projects.init();
  beforeCleanup.push(() => projects.close());
  const project = await projects.create({ name: '合成旧项目', configuration });
  const task = await projects.createTask(project.id, { name: '原任务' });
  await projects.saveDraft(project.id, task.id, '原有草稿');
  const parent = path.join(task.sessionDirectory, 'parent.jsonl'), history = path.join(task.sessionDirectory, 'native.jsonl');
  await fs.writeFile(parent, '{"type":"session","id":"synthetic-parent"}\n', { mode: 0o600 });
  await fs.writeFile(history, `{"type":"session","parentSession":${JSON.stringify(parent)}}\n{"type":"message","role":"user","content":"合成历史"}\n`, { mode: 0o600 });
  await projects.setSession(project.id, task.id, history);
  await fs.writeFile(path.join(project.rootPath, '010_draw', 'source.csv'), 'group,value\nA,10\n', { mode: 0o600 });
  await fs.writeFile(path.join(project.rootPath, '020_clean', 'working.csv'), 'group,value\nA,10\n', { mode: 0o600 });
  await fs.writeFile(path.join(project.rootPath, '060_reports', 'report.md'), '# 合成报告\n', { mode: 0o600 });
  const metadataRoot = path.join(dataRoot, 'projects');
  const metadata = path.join(metadataRoot, project.id, 'project.json');
  await fs.copyFile(metadata, path.join(metadataRoot, project.id, 'project.schema1.backup.json'));
  const before = { metadata: await inventory(metadataRoot), files: await inventory(project.rootPath) };
  assert.equal((await store.init()).state, 'uninitialized'); assert.equal((await store.initialize()).state, 'ready');
  assert.deepEqual(store.listCases(), []); assert.equal(store.getProjectWork(project.id).revision, 0);
  assert.equal(store.getProjectWork(project.id).statusChangedAt, null);
  const caseA = store.createCase({ operationId: randomUUID(), title: '旧项目进入Case' });
  store.linkProject({ operationId: randomUUID(), caseId: caseA.id, projectId: project.id, expectedRevision: 1 });
  store.saveProjectWork({ operationId: randomUUID(), projectId: project.id, expectedRevision: 0, workStatus: 'completed', workScope: '原项目业务说明', nextStep: '', assignee: null });
  assert.deepEqual({ metadata: await inventory(metadataRoot), files: await inventory(project.rootPath) }, before);
  store.close(); const reopened = new CaseStore({ dataRoot });
  try {
    assert.equal((await reopened.init()).state, 'ready'); assert.equal(reopened.listCases().length, 1); assert.equal(reopened.listProjectLinks().length, 1);
    assert.equal(reopened.getProjectWork(project.id).workStatus, 'completed');
    assert.equal((await projects.getTask(project.id, task.id)).draft, '原有草稿');
    assert.deepEqual({ metadata: await inventory(metadataRoot), files: await inventory(project.rootPath) }, before);
  } finally { reopened.close(); }
});

test('MIG-03: interrupted initialization resumes the same store identity before DB and after schema commit', async t => {
  const { dataRoot, store, databasePath, markerPath } = await fixture(t); await fs.mkdir(dataRoot, { mode: 0o700 });
  const marker = { formatVersion: 1, storeId: randomUUID(), databaseFile: 'decision-cases.sqlite3', state: 'initializing', createdAt: new Date().toISOString() };
  await fs.writeFile(markerPath, JSON.stringify(marker), { mode: 0o600 });
  assert.deepEqual(await store.init(), { state: 'ready', storeId: marker.storeId });
  store.close(); await fs.writeFile(markerPath, JSON.stringify(marker), { mode: 0o600 });
  const before = await fs.readFile(databasePath);
  assert.deepEqual(await store.init(), { state: 'ready', storeId: marker.storeId });
  assert.deepEqual(await fs.readFile(databasePath), before);
  store.close(); await fs.unlink(databasePath);
  assert.equal((await store.init()).state, 'unavailable');
  await assert.rejects(fs.stat(databasePath), { code: 'ENOENT' });
});

test('MIG-04: missing marker, unknown schema, mismatched identity and corrupt DB remain unavailable and unchanged', async t => {
  const { store, dataRoot, databasePath, markerPath } = await fixture(t); await store.initialize(); store.close();
  const marker = await fs.readFile(markerPath), original = await fs.readFile(databasePath);
  await fs.unlink(markerPath);
  assert.equal((await store.init()).state, 'unavailable'); assert.equal((await store.initialize()).state, 'unavailable');
  assert.deepEqual(await fs.readFile(databasePath), original);
  await fs.writeFile(markerPath, marker);
  const unknown = new DatabaseSync(databasePath); unknown.exec('PRAGMA user_version=987'); unknown.close();
  const unknownBytes = await fs.readFile(databasePath);
  assert.equal((await store.init()).code, 'unsupported_case_schema'); assert.deepEqual(await fs.readFile(databasePath), unknownBytes);
  await fs.writeFile(databasePath, original);
  const changed = JSON.parse(marker.toString()); changed.storeId = randomUUID(); await fs.writeFile(markerPath, JSON.stringify(changed));
  assert.equal((await store.init()).code, 'case_store_identity_mismatch'); assert.deepEqual(await fs.readFile(databasePath), original);
  await fs.writeFile(markerPath, marker); const broken = Buffer.from('not-a-sqlite-database'); await fs.writeFile(databasePath, broken);
  assert.equal((await store.init()).state, 'unavailable'); assert.deepEqual(await fs.readFile(databasePath), broken);
  await fs.unlink(markerPath); await fs.unlink(databasePath);
  assert.equal((await store.init()).state, 'uninitialized'); assert.deepEqual(await fs.readdir(dataRoot), []);
});

test('MIG-04 links: root/control symlinks and control hardlinks cannot redirect Case writes', async t => {
  const { store, root, dataRoot, databasePath } = await fixture(t); await store.initialize(); store.close();
  const outside = path.join(root, 'outside.sqlite3'); await fs.rename(databasePath, outside);
  const bytes = await fs.readFile(outside);
  await fs.symlink(outside, databasePath); assert.equal((await store.init()).code, 'unsafe_case_storage');
  await fs.unlink(databasePath); await fs.link(outside, databasePath); assert.equal((await store.init()).code, 'unsafe_case_storage');
  await fs.unlink(databasePath); await fs.rename(outside, databasePath); assert.deepEqual(await fs.readFile(databasePath), bytes);
  const alias = path.join(root, 'root-link'); await fs.symlink(dataRoot, alias);
  const unsafe = new CaseStore({ dataRoot: alias });
  assert.equal((await unsafe.initialize()).code, 'unsafe_case_storage');
});

test('AC-10: injected event statement failure rolls back current state, event and operation receipt together', async t => {
  const { store, databasePath } = await fixture(t); await store.initialize();
  const record = store.createCase({ operationId: randomUUID(), title: '事务故障测试' });
  const injected = new DatabaseSync(databasePath);
  injected.exec("CREATE TRIGGER fail_event BEFORE INSERT ON work_events BEGIN SELECT RAISE(ABORT,'synthetic event IO fault'); END;");
  const operationId = randomUUID();
  assert.throws(() => store.updateCase({ operationId, caseId: record.id, expectedRevision: 1, judgement: '不应半提交' }), /synthetic event IO fault/);
  assert.deepEqual(store.getCase(record.id), record); assert.equal(store.getEvents('case', record.id).length, 1); assert.equal(store.getOperation(operationId), null);
  injected.exec('DROP TRIGGER fail_event'); injected.close();
  const saved = store.updateCase({ operationId, caseId: record.id, expectedRevision: 1, judgement: '不应半提交' });
  assert.equal(saved.revision, 2); assert.equal(store.getEvents('case', record.id).length, 2); assert.equal(store.getOperation(operationId)!.phase, 'completed');
});

test('AC-10 commit boundary: injected SQLITE_FULL and SQLITE_IOERR preserve atomic retryability', async t => {
  const { store } = await fixture(t); await store.initialize();
  const record = store.createCase({ operationId: randomUUID(), title: '提交故障边界' });
  const originalExec = DatabaseSync.prototype.exec;
  for (const code of ['SQLITE_FULL', 'SQLITE_IOERR']) {
    let armed = true;
    const operationId = randomUUID();
    const fault = t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
      if (armed && sql === 'COMMIT') { armed = false; throw Object.assign(new Error(`synthetic ${code} before COMMIT`), { code }); }
      return originalExec.call(this, sql);
    });
    try { assert.throws(() => store.updateCase({ operationId, caseId: record.id, expectedRevision: 1, judgement: code }), new RegExp(code)); }
    finally { fault.mock.restore(); }
    assert.deepEqual(store.getCase(record.id), record); assert.equal(store.getEvents('case', record.id).length, 1); assert.equal(store.getOperation(operationId), null);
  }
  const success = store.updateCase({ operationId: randomUUID(), caseId: record.id, expectedRevision: 1, judgement: '故障解除后保存' });
  assert.equal(success.revision, 2);
});

test('MIG-03 fault boundaries: initialization interruptions preserve identity and resume without replacing business state', async t => {
  for (const phase of ['before_marker', 'after_marker', 'during_schema', 'after_commit_before_ready']) {
    await t.test(phase, async inner => {
      const { store, dataRoot, markerPath, databasePath } = await fixture(inner);
      let armed = true;
      const open = fsSync.openSync, exec = DatabaseSync.prototype.exec, rename = fsSync.renameSync;
      const fault = phase === 'during_schema'
        ? inner.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
          if (armed && sql.includes('CREATE TABLE store_metadata')) { armed = false; throw new Error('synthetic initializing schema fault'); } return exec.call(this, sql);
        })
        : phase === 'after_commit_before_ready'
          ? inner.mock.method(fsSync, 'renameSync', (source: Parameters<typeof fsSync.renameSync>[0], destination: Parameters<typeof fsSync.renameSync>[1]) => { if (armed && destination === markerPath) { armed = false; throw new Error('synthetic ready publication fault'); } return rename(source, destination); })
          : inner.mock.method(fsSync, 'openSync', (file: Parameters<typeof fsSync.openSync>[0], flags: Parameters<typeof fsSync.openSync>[1], mode: Parameters<typeof fsSync.openSync>[2]) => { if (armed && String(file) === (phase === 'before_marker' ? markerPath : databasePath) && flags === 'wx') { armed = false; throw new Error('synthetic initializing open fault'); } return open(file, flags, mode); });
      try { assert.equal((await store.initialize()).state, 'unavailable'); }
      finally { fault.mock.restore(); }
      let storeId: string | undefined;
      if (phase === 'before_marker') {
        assert.equal((await store.init()).state, 'uninitialized');
      } else {
        const marker = JSON.parse(await fs.readFile(markerPath, 'utf8')); storeId = marker.storeId; assert.equal(marker.state, 'initializing');
      }
      const resumed = await store.initialize(); assert.equal(resumed.state, 'ready'); if (storeId) assert.equal(resumed.storeId, storeId);
      assert.deepEqual(store.listCases(), []); assert.equal((await fs.stat(dataRoot)).mode & 0o777, 0o700);
    });
  }
});

test('MIG-05: an offline consistent structure copy reopens with the same identity and revisions; original JSON stays old-build-readable', async t => {
  const { root, store, dataRoot, databasePath, markerPath } = await fixture(t); await store.initialize();
  const record = store.createCase({ operationId: randomUUID(), title: '备份保留' });
  const projectId = randomUUID(); store.linkProject({ operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: 1 });
  const identity = store.getStatus().storeId; store.close();
  const backup = path.join(root, `offline-structure-copy-${randomUUID()}`); await fs.mkdir(backup, { mode: 0o700 });
  for (const file of [databasePath, markerPath]) await fs.copyFile(file, path.join(backup, path.basename(file)));
  const checksums = await inventory(backup); assert.ok(checksums['decision-cases.sqlite3']!.sha256); assert.ok(checksums['decision-cases-store.json']!.sha256);
  const recovered = new CaseStore({ dataRoot: backup });
  try {
    assert.deepEqual(await recovered.init(), { state: 'ready', storeId: identity });
    assert.equal(recovered.getCase(record.id).revision, 2); assert.equal(recovered.getEvents('case', record.id).length, 2); assert.equal(recovered.listProjectLinks().length, 1);
    assert.equal((await fs.stat(path.join(dataRoot, 'decision-cases.sqlite3'))).size, (await fs.stat(path.join(backup, 'decision-cases.sqlite3'))).size);
  } finally { recovered.close(); }
});

test('MIG-04 SQLite constraints reject NULL loopholes, invalid enums and partial observed versions', async t => {
  const { store, databasePath } = await fixture(t); await store.initialize();
  const record = store.createCase({ operationId: randomUUID(), title: '数据库约束' }), db = new DatabaseSync(databasePath);
  const time = new Date().toISOString();
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN');
    assert.throws(() => db.prepare('UPDATE cases SET status=?,closed_at=?,close_reason=NULL WHERE id=?').run('closed', time, record.id), /CHECK/);
    assert.throws(() => db.prepare('UPDATE cases SET status=? WHERE id=?').run('invented-status', record.id), /CHECK/);
    assert.throws(() => db.prepare('INSERT INTO project_work VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'cancelled', '', null, '', null, time, 1, time, time), /CHECK/);
    assert.throws(() => db.prepare('INSERT INTO case_artifact_links VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), record.id, randomUUID(), '020_clean/x.csv', null, null, 'file', null, null, 1, time, time, time, null), /CHECK/);
  } finally { db.exec('ROLLBACK'); db.close(); }
});
