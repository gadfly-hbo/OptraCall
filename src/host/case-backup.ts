import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CaseStore, CaseStoreError } from './case-store.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type FileRecord = { path: string; bytes: number; sha256: string };
type BackupManifest = {
  formatVersion: 1; state: 'complete'; scope: 'case-structure-only'; createdAt: string; storeId: string; schemaVersion: 1;
  sourceDataRoot: string; sourceProjectsRoot: string; files: FileRecord[]; caseRevisions: { id: string; revision: number }[];
  projectWorkRevisions: { projectId: string; revision: number }[]; missingReferencedProjectIds: string[];
  excluded: string[];
};
function fail(code: string): never { throw new CaseStoreError(code, 409); }
async function directory(file: string) { const stat = await fs.lstat(file); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_case_backup_source'); }
async function exists(file: string) { try { await fs.lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
async function bytes(file: string): Promise<Buffer> {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail('unsafe_case_backup_source');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat(); if (opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== 1) fail('case_backup_source_changed');
    const result = await handle.readFile(), after = await handle.stat();
    const current = await fs.lstat(file);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || current.ino !== before.ino || current.dev !== before.dev || current.nlink !== 1) fail('case_backup_source_changed');
    return result;
  } finally { await handle.close(); }
}
function digest(value: Buffer) { return createHash('sha256').update(value).digest('hex'); }
async function secureDirectory(file: string) { await fs.mkdir(file, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; }); await directory(file); await fs.chmod(file, 0o700); }
async function durable(file: string, value: Buffer) {
  const handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(file: string) { const handle = await fs.open(file, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }

/** Explicit offline structure backup. It shares the Host's root lock without opening
 * ProjectStore (which would migrate schema1). Session/file disaster recovery is outside this copy. */
export async function backupCaseStorage(options: { dataRoot: string; projectsRoot: string }): Promise<{ backupPath: string; manifest: BackupManifest }> {
  await directory(options.dataRoot); await directory(options.projectsRoot);
  const dataRoot = await fs.realpath(options.dataRoot), projectsRoot = await fs.realpath(options.projectsRoot);
  if (dataRoot === projectsRoot || projectsRoot.startsWith(dataRoot + path.sep) || dataRoot.startsWith(projectsRoot + path.sep)) fail('overlapping_data_roots');
  if (CaseStore.hasOpenDatabase(dataRoot)) fail('case_database_open');
  const lockPath = path.join(dataRoot, '.project-store.lock'), token = randomUUID();
  let lock: Awaited<ReturnType<typeof fs.open>>;
  try { lock = await fs.open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('project_store_locked'); throw error; }
  const lockStat = await lock.stat(), lockValue = JSON.stringify({ pid: process.pid, token });
  try {
    await lock.writeFile(lockValue); await lock.sync(); await lock.close();
    const databasePath = path.join(dataRoot, 'decision-cases.sqlite3'), markerPath = path.join(dataRoot, 'decision-cases-store.json');
    for (const suffix of ['-journal', '-wal', '-shm']) if (await exists(databasePath + suffix)) fail('case_backup_recovery_files_present');
    const markerBytes = await bytes(markerPath), databaseBytes = await bytes(databasePath);
    const marker = JSON.parse(markerBytes.toString());
    if (marker.formatVersion !== 1 || marker.state !== 'ready' || marker.databaseFile !== 'decision-cases.sqlite3' || !UUID.test(marker.storeId)) fail('invalid_case_marker');
    const db = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false });
    let caseRevisions: BackupManifest['caseRevisions'], projectWorkRevisions: BackupManifest['projectWorkRevisions'], referencedIds: string[];
    try {
      const metadata = db.prepare('SELECT store_id FROM store_metadata').all();
      if (db.prepare('PRAGMA user_version').get()?.user_version !== 1 || metadata.length !== 1 || metadata[0]!.store_id !== marker.storeId || db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) fail('invalid_case_backup_database');
      caseRevisions = db.prepare('SELECT id,revision FROM cases ORDER BY id').all() as { id: string; revision: number }[];
      projectWorkRevisions = db.prepare('SELECT project_id AS projectId,revision FROM project_work ORDER BY project_id').all() as { projectId: string; revision: number }[];
      referencedIds = db.prepare('SELECT project_id FROM case_project_links UNION SELECT project_id FROM project_work UNION SELECT project_id FROM case_artifact_links').all().map(row => String(row.project_id));
    } finally { db.close(); }
    // The source stays closed for the byte copy. The cooperative root lock excludes every Host.
    const sources = new Map<string, Buffer>([['decision-cases-store.json', markerBytes], ['decision-cases.sqlite3', databaseBytes]]);
    const metadataRoot = path.join(dataRoot, 'projects'); await directory(metadataRoot);
    const projectIds = new Set<string>();
    for (const entry of (await fs.readdir(metadataRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!UUID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) fail('unsafe_case_backup_source');
      const relative = path.join('projects', entry.name), projectJson = await bytes(path.join(dataRoot, relative, 'project.json'));
      const value = JSON.parse(projectJson.toString());
      if (value.id !== entry.name || ![1, 2].includes(value.schemaVersion)) fail('invalid_project_backup_metadata');
      projectIds.add(entry.name); sources.set(path.join(relative, 'project.json'), projectJson);
      const migrationBackup = path.join(relative, 'project.v1.backup.json');
      if (await exists(path.join(dataRoot, migrationBackup))) sources.set(migrationBackup, await bytes(path.join(dataRoot, migrationBackup)));
    }
    const createdAt = new Date().toISOString();
    const backups = path.join(dataRoot, 'backups'), caseBackups = path.join(backups, 'decision-case'); await secureDirectory(backups); await secureDirectory(caseBackups);
    const backupPath = path.join(caseBackups, `${createdAt.replace(/[:.]/g, '-')}-${randomUUID()}`);
    await fs.mkdir(backupPath, { mode: 0o700 });
    const files: FileRecord[] = [];
    for (const [relative, value] of sources) {
      if (relative.startsWith('projects' + path.sep)) { await secureDirectory(path.join(backupPath, 'projects')); await secureDirectory(path.join(backupPath, path.dirname(relative))); }
      await durable(path.join(backupPath, relative), value);
      const copied = await bytes(path.join(backupPath, relative)); if (digest(copied) !== digest(value)) fail('case_backup_copy_mismatch');
      files.push({ path: relative.split(path.sep).join('/'), bytes: value.length, sha256: digest(value) });
    }
    // Detect uncooperative source changes, preserving this partial backup rather than
    // publishing a manifest that claims a consistent snapshot.
    for (const [relative, value] of sources) if (!value.equals(await bytes(path.join(dataRoot, relative)))) fail('case_backup_source_changed');
    const manifest: BackupManifest = { formatVersion: 1, state: 'complete', scope: 'case-structure-only', createdAt, storeId: marker.storeId, schemaVersion: 1, sourceDataRoot: dataRoot, sourceProjectsRoot: projectsRoot, files, caseRevisions, projectWorkRevisions, missingReferencedProjectIds: referencedIds.filter(id => !projectIds.has(id)).sort(), excluded: ['credentials and model configuration stores', 'native task/session JSONL and parents', '010_draw', '020_clean', '060_reports'] };
    await durable(path.join(backupPath, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    const manifestReadback = JSON.parse((await bytes(path.join(backupPath, 'manifest.json'))).toString()); if (manifestReadback.storeId !== manifest.storeId) fail('case_backup_copy_mismatch');
    for (const id of projectIds) await syncDirectory(path.join(backupPath, 'projects', id));
    if (projectIds.size) await syncDirectory(path.join(backupPath, 'projects'));
    await syncDirectory(backupPath); await syncDirectory(caseBackups);
    return { backupPath, manifest };
  } finally {
    await lock.close().catch(() => {});
    const stat = await fs.lstat(lockPath);
    if (stat.ino !== lockStat.ino || stat.dev !== lockStat.dev || stat.nlink !== 1 || (await bytes(lockPath)).toString() !== lockValue) fail('project_store_lock_changed');
    await fs.unlink(lockPath); await syncDirectory(dataRoot);
  }
}
