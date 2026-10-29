import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { ProjectStore, type ProjectConfiguration } from '../src/host/project-store.ts';
import { backupCaseStorage } from '../src/host/case-backup.ts';

const configuration: ProjectConfiguration = { id: 'synthetic', revision: 1, name: 'Synthetic', provider: 'test', model: 'test', baseUrl: 'https://example.invalid', api: 'anthropic-messages' };
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-case-backup-')));
  const options = { dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'workspace') };
  const projects = new ProjectStore(options); await projects.init();
  const store = new CaseStore(options); await store.initialize();
  t.after(async () => { store.close(); await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, options, projects, store };
}

test('D11: explicit offline backup preserves matched structures and checksums with secure permissions', async t => {
  const { options, projects, store } = await fixture(t);
  const project = await projects.create({ name: '结构备份', configuration });
  const metadata = path.join(options.dataRoot, 'projects', project.id, 'project.json');
  const original = await fs.readFile(metadata), legacy = { ...JSON.parse(original.toString()), schemaVersion: 1, draft: '合成旧草稿' };
  await fs.writeFile(path.join(path.dirname(metadata), 'project.v1.backup.json'), JSON.stringify(legacy), { mode: 0o600 });
  await fs.writeFile(path.join(options.dataRoot, 'credentials.json'), 'synthetic-secret-do-not-copy', { mode: 0o600 });
  await fs.writeFile(path.join(project.rootPath, '060_reports', 'report.md'), 'synthetic file do not copy');
  const record = store.createCase({ operationId: randomUUID(), title: '结构保全' });
  store.linkProject({ operationId: randomUUID(), caseId: record.id, projectId: project.id, expectedRevision: 1 });
  const identity = store.getStatus().storeId;
  await assert.rejects(backupCaseStorage(options), /case_database_open|project_store_locked/);
  store.close(); await assert.rejects(backupCaseStorage(options), /project_store_locked/);
  await projects.close();
  const result = await backupCaseStorage(options);
  assert.ok(result.backupPath.startsWith(path.join(options.dataRoot, 'backups', 'decision-case') + path.sep));
  assert.equal((await fs.stat(result.backupPath)).mode & 0o777, 0o700);
  const manifest = JSON.parse(await fs.readFile(path.join(result.backupPath, 'manifest.json'), 'utf8'));
  assert.equal(manifest.storeId, identity); assert.equal(manifest.scope, 'case-structure-only'); assert.equal(manifest.state, 'complete');
  assert.deepEqual(await fs.readFile(path.join(result.backupPath, 'projects', project.id, 'project.json')), original);
  assert.equal((await fs.stat(path.join(result.backupPath, 'projects', project.id, 'project.v1.backup.json'))).mode & 0o777, 0o600);
  for (const file of manifest.files) {
    const bytes = await fs.readFile(path.join(result.backupPath, file.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256); assert.equal(bytes.length, file.bytes);
    assert.equal((await fs.stat(path.join(result.backupPath, file.path))).mode & 0o777, 0o600);
  }
  await assert.rejects(fs.stat(path.join(result.backupPath, 'credentials.json')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(result.backupPath, '060_reports')), { code: 'ENOENT' });
  const recovered = new CaseStore({ dataRoot: result.backupPath });
  try { assert.equal((await recovered.init()).storeId, identity); assert.equal(recovered.getCase(record.id).revision, 2); }
  finally { recovered.close(); }
  const another = await backupCaseStorage(options); assert.notEqual(another.backupPath, result.backupPath);
  assert.deepEqual(await fs.readFile(metadata), original);
});

test('D11: existing foreign lock and unsafe source metadata are preserved without adoption or deletion', async t => {
  const { options, projects, store } = await fixture(t); store.close(); await projects.close();
  const lock = path.join(options.dataRoot, '.project-store.lock');
  await fs.writeFile(lock, '{"untrusted":"leave intact"}', { mode: 0o600 });
  await assert.rejects(backupCaseStorage(options), /project_store_locked/); assert.equal(await fs.readFile(lock, 'utf8'), '{"untrusted":"leave intact"}');
  await fs.unlink(lock);
  const directory = path.join(options.dataRoot, 'projects', randomUUID()); await fs.mkdir(directory);
  const outside = path.join(options.dataRoot, 'do-not-follow.json'); await fs.writeFile(outside, 'synthetic private source'); await fs.symlink(outside, path.join(directory, 'project.json'));
  await assert.rejects(backupCaseStorage(options), /unsafe_case_backup_source/); assert.equal(await fs.readFile(outside, 'utf8'), 'synthetic private source');
  await assert.rejects(fs.stat(lock), { code: 'ENOENT' });
});
