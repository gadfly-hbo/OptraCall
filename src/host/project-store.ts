import path from 'node:path';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

export const PROJECT_DIRECTORIES = ['010_draw', '020_clean', '060_reports'] as const;
export type ProjectDirectory = typeof PROJECT_DIRECTORIES[number];
export interface ProjectConfiguration { id: string; revision: number; provider: string; model: string; name: string; baseUrl: string; api?: string; thinkingLevel?: string }
export interface ProjectRun { id: string; status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'; startedAt: string; settledAt?: string }
export interface UploadedFile { id: string; originalName: string; path: string; bytes: number; sha256: string; uploadedAt: string; source: { kind: 'upload' | 'copy' | 'user-save-report'; from?: string } }
export interface TaskRecord { id: string; name: string; createdAt: string; updatedAt: string; draft: string; configuration: ProjectConfiguration; sessionStorage: 'legacy' | 'task'; sessionFile?: string; lastRun?: ProjectRun; sessionDirectory: string }
export interface ProjectRecord { schemaVersion: 2; id: string; name: string; createdAt: string; updatedAt: string; configuration: ProjectConfiguration; uploads: UploadedFile[]; archivedAt: string | null; tasks: TaskRecord[]; rootPath: string }
export interface FileNode { name: string; path: string; kind: 'file' | 'directory'; bytes?: number; children?: FileNode[] }
export class ProjectStoreFault extends Error { code: string; constructor(code: string) { super(code); this.code = code; } }

type StoredTask = Omit<TaskRecord, 'sessionDirectory'>;
type StoredProject = Omit<ProjectRecord, 'rootPath' | 'tasks'> & { tasks: StoredTask[] };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const runStates = new Set(['running', 'completed', 'cancelled', 'failed', 'interrupted']);
const maxUploadBytes = 10 * 1024 * 1024;
const maxMetadataBytes = 2 * 1024 * 1024;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const inside = (root: string, candidate: string) => candidate !== root && candidate.startsWith(root + path.sep);
const fail = (code: string): never => { throw new ProjectStoreFault(code); };
const isoDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
function publicConfiguration(input: unknown): ProjectConfiguration {
  if (!object(input)) return fail('invalid_configuration');
  for (const key of ['id', 'name', 'provider', 'model', 'baseUrl']) if (typeof input[key] !== 'string' || !(input[key] as string).trim() || (input[key] as string).length > 2000) fail('invalid_configuration');
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 1) fail('invalid_configuration');
  for (const key of ['api', 'thinkingLevel']) if (input[key] !== undefined && (typeof input[key] !== 'string' || (input[key] as string).length > 100)) fail('invalid_configuration');
  return { id: input.id as string, name: input.name as string, provider: input.provider as string, model: input.model as string, baseUrl: input.baseUrl as string, revision: input.revision as number, ...(input.api === undefined ? {} : { api: input.api as string }), ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel as string }) };
}
function projectName(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(value)) return fail('invalid_project_name'); return value.trim(); }
function validRun(value: unknown): ProjectRun {
  if (!object(value) || typeof value.id !== 'string' || !uuid.test(value.id) || typeof value.status !== 'string' || !runStates.has(value.status) || !isoDate(value.startedAt) || (value.status === 'running' ? value.settledAt !== undefined : !isoDate(value.settledAt))) return fail('invalid_run');
  return { id: value.id, status: value.status as ProjectRun['status'], startedAt: value.startedAt, ...(value.settledAt === undefined ? {} : { settledAt: value.settledAt as string }) };
}

export class ProjectStore {
  readonly dataRoot: string;
  readonly projectsRoot: string;
  #ready = false;
  #token = randomUUID();
  #ownsLock = false;
  #gate: Promise<unknown> = Promise.resolve();
  constructor(options: { dataRoot: string; projectsRoot: string }) {
    this.dataRoot = path.resolve(options.dataRoot); this.projectsRoot = path.resolve(options.projectsRoot);
    if (this.dataRoot === this.projectsRoot || inside(this.dataRoot, this.projectsRoot) || inside(this.projectsRoot, this.dataRoot)) fail('overlapping_data_roots');
  }
  async #directory(directory: string, recursive = false, secure = true): Promise<void> {
    try { await fs.mkdir(directory, { recursive, mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const entry = await fs.lstat(directory); if (!entry.isDirectory() || entry.isSymbolicLink()) fail('unsafe_directory');
    if (secure) await fs.chmod(directory, 0o700);
  }
  async #lock(): Promise<void> {
    const lockPath = path.join(this.dataRoot, '.project-store.lock');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const handle = await fs.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, token: this.#token })); await handle.sync(); } finally { await handle.close(); }
        this.#ownsLock = true; return;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const stat = await fs.lstat(lockPath); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4096) fail('project_store_locked');
      let previous: unknown; try { previous = JSON.parse(await fs.readFile(lockPath, 'utf8')); } catch { fail('project_store_locked'); }
      if (!object(previous) || !Number.isSafeInteger(previous.pid) || (previous.pid as number) <= 0 || typeof previous.token !== 'string' || !uuid.test(previous.token)) return fail('project_store_locked');
      try { process.kill(previous.pid as number, 0); fail('project_store_locked'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      const current = await fs.lstat(lockPath); if (current.ino !== stat.ino || current.dev !== stat.dev || await fs.readFile(lockPath, 'utf8') !== JSON.stringify(previous)) fail('project_store_locked');
      await fs.unlink(lockPath);
    }
    fail('project_store_locked');
  }
  async init(): Promise<void> {
    if (this.#ready) return;
    await this.#directory(this.dataRoot, true); await this.#lock();
    try {
      await this.#directory(path.join(this.dataRoot, 'projects'));
      await this.#directory(this.projectsRoot, true, false);
      for (const item of await fs.readdir(this.projectsRoot, { withFileTypes: true })) {
        if (!uuid.test(item.name) || !item.isDirectory() || item.isSymbolicLink()) fail('unrecognized_project_root');
        try { await fs.access(this.#metadataPath(item.name)); } catch { fail('unrecognized_project_root'); }
      }
      this.#ready = true;
      for (const item of await fs.readdir(path.join(this.dataRoot, 'projects'), { withFileTypes: true })) {
        if (!uuid.test(item.name) || !item.isDirectory() || item.isSymbolicLink()) fail('invalid_project_metadata');
        const original = await this.#readValue(item.name);
        if (object(original.value) && original.value.schemaVersion === 1) await this.#migrate(item.name, original.value, original.bytes);
      }
      await this.list();
      await fs.chmod(this.projectsRoot, 0o700);
    } catch (error) { await this.close(); throw error; }
  }
  #id(id: string): string { if (typeof id !== 'string' || !uuid.test(id)) return fail('invalid_project_id'); return id; }
  #requireReady(): void { if (!this.#ready) fail('project_store_closed'); }
  projectDirectory(id: string): string { return path.join(this.projectsRoot, this.#id(id)); }
  sessionDirectory(id: string): string { return path.join(this.dataRoot, 'projects', this.#id(id), 'sessions'); }
  #metadataPath(id: string): string { return path.join(this.dataRoot, 'projects', this.#id(id), 'project.json'); }
  #taskDirectory(projectId: string, task: StoredTask): string { return task.sessionStorage === 'legacy' ? this.sessionDirectory(projectId) : path.join(this.dataRoot, 'projects', this.#id(projectId), 'tasks', this.#id(task.id), 'sessions'); }
  #decorateTask(projectId: string, task: StoredTask): TaskRecord { return { ...task, sessionDirectory: this.#taskDirectory(projectId, task) }; }
  #decorate(project: StoredProject): ProjectRecord { return { ...project, rootPath: this.projectDirectory(project.id), tasks: project.tasks.map(task => this.#decorateTask(project.id, task)) }; }
  async #assertDirectory(directory: string): Promise<void> { const entry = await fs.lstat(directory); if (!entry.isDirectory() || entry.isSymbolicLink()) fail('unsafe_directory'); }
  async #assertProject(id: string): Promise<void> {
    this.#requireReady(); this.#id(id);
    await this.#assertDirectory(this.dataRoot); await this.#assertDirectory(path.join(this.dataRoot, 'projects')); await this.#assertDirectory(path.join(this.dataRoot, 'projects', id));
    await this.#assertDirectory(this.projectsRoot); await this.#assertDirectory(this.projectDirectory(id));
    for (const directory of PROJECT_DIRECTORIES) await this.#assertDirectory(path.join(this.projectDirectory(id), directory));
    await this.#assertDirectory(this.sessionDirectory(id));
  }
  #mutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#gate.then(() => { this.#requireReady(); return operation(); });
    this.#gate = result.catch(() => {}); return result;
  }
  async #write(project: StoredProject): Promise<ProjectRecord> {
    await this.#assertProject(project.id);
    const bytes = this.#metadataBytes(project);
    const file = this.#metadataPath(project.id), temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file); await this.#syncDirectory(path.dirname(file)); return this.#decorate(structuredClone(project));
  }
  #metadataBytes(project: StoredProject): Buffer { const bytes = Buffer.from(JSON.stringify(project, null, 2) + '\n'); if (bytes.length > maxMetadataBytes) fail('project_metadata_too_large'); return bytes; }
  async #syncDirectory(directory: string): Promise<void> { const handle = await fs.open(directory, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }
  async #controlBytes(file: string): Promise<Buffer> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > maxMetadataBytes) return fail('invalid_project_metadata');
      if (stat.nlink === 0) continue;
      const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const current = await handle.stat();
        if (!current.isFile() || current.nlink > 1 || current.size > maxMetadataBytes) return fail('invalid_project_metadata');
        // A valid atomic writer can replace the name after lstat or unlink the
        // opened old inode before fstat. Re-read that race; never relax actual
        // symlink/hardlink checks or read an unverified descriptor.
        if (current.nlink !== 1 || current.ino !== stat.ino || current.dev !== stat.dev) continue;
        return await handle.readFile();
      } finally { await handle.close(); }
    }
    return fail('project_metadata_changed');
  }
  async #readValue(id: string): Promise<{ value: unknown; bytes: Buffer }> {
    await this.#assertProject(id); const bytes = await this.#controlBytes(this.#metadataPath(id));
    let value: unknown; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('invalid_project_metadata'); }
    return { value, bytes };
  }
  async #read(id: string): Promise<StoredProject> { return this.#decodeProject(id, (await this.#readValue(id)).value); }
  async #decodeProject(id: string, value: unknown): Promise<StoredProject> {
    if (!object(value) || value.schemaVersion !== 2 || value.id !== id || !isoDate(value.createdAt) || !isoDate(value.updatedAt) || !Array.isArray(value.uploads) || !Array.isArray(value.tasks) || (value.archivedAt !== null && !isoDate(value.archivedAt))) return fail('invalid_project_metadata');
    const name = projectName(value.name), configuration = publicConfiguration(value.configuration);
    const uploads: UploadedFile[] = value.uploads.map(item => {
      if (!object(item) || typeof item.id !== 'string' || !uuid.test(item.id) || typeof item.originalName !== 'string' || typeof item.path !== 'string' || !Number.isSafeInteger(item.bytes) || (item.bytes as number) < 0 || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || !isoDate(item.uploadedAt) || !object(item.source) || !['upload', 'copy', 'user-save-report'].includes(item.source.kind as string)) return fail('invalid_project_metadata');
      this.#relative(item.path);
      if (item.source.from !== undefined) { if (typeof item.source.from !== 'string') fail('invalid_project_metadata'); this.#relative(item.source.from as string); }
      return { id: item.id, originalName: item.originalName, path: item.path, bytes: item.bytes as number, sha256: item.sha256, uploadedAt: item.uploadedAt, source: { kind: item.source.kind as UploadedFile['source']['kind'], ...(item.source.from === undefined ? {} : { from: item.source.from as string }) } };
    });
    const tasks: StoredTask[] = [], ids = new Set<string>(); let legacy = 0;
    for (const input of value.tasks) {
      if (!object(input) || typeof input.id !== 'string' || !uuid.test(input.id) || ids.has(input.id) || !isoDate(input.createdAt) || !isoDate(input.updatedAt) || typeof input.draft !== 'string' || input.draft.length > 20000 || !['legacy', 'task'].includes(input.sessionStorage as string)) return fail('invalid_project_metadata');
      ids.add(input.id); if (input.sessionStorage === 'legacy' && ++legacy > 1) fail('invalid_project_metadata');
      const task: StoredTask = { id: input.id, name: projectName(input.name), createdAt: input.createdAt, updatedAt: input.updatedAt, draft: input.draft, configuration: publicConfiguration(input.configuration), sessionStorage: input.sessionStorage as StoredTask['sessionStorage'] };
      await this.#assertTaskDirectory(id, task);
      if (input.sessionFile !== undefined) { if (typeof input.sessionFile !== 'string') fail('invalid_project_metadata'); await this.#validateSession(id, task, input.sessionFile as string); task.sessionFile = input.sessionFile as string; }
      if (input.lastRun !== undefined) task.lastRun = validRun(input.lastRun);
      tasks.push(task);
    }
    return { schemaVersion: 2, id, name, createdAt: value.createdAt, updatedAt: value.updatedAt, configuration, uploads, archivedAt: value.archivedAt as string | null, tasks };
  }
  async #migrate(id: string, legacy: Record<string, unknown>, original: Buffer): Promise<void> {
    const task = { id: randomUUID(), name: '原有任务', createdAt: legacy.createdAt, updatedAt: legacy.updatedAt, configuration: legacy.configuration, draft: legacy.draft, sessionStorage: 'legacy', ...(legacy.sessionFile === undefined ? {} : { sessionFile: legacy.sessionFile }), ...(legacy.lastRun === undefined ? {} : { lastRun: legacy.lastRun }) };
    // Validate the complete target before writing a backup or changing the old
    // metadata. Native JSONL files and their absolute fork lineage stay in place.
    const migrated = await this.#decodeProject(id, { ...legacy, schemaVersion: 2, archivedAt: null, tasks: [task] });
    const backup = path.join(this.dataRoot, 'projects', id, 'project.v1.backup.json');
    let handle;
    try { handle = await fs.open(backup, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await this.#controlBytes(backup)).equals(original)) return fail('migration_backup_conflict');
    }
    if (handle) { try { await handle.writeFile(original); await handle.sync(); } finally { await handle.close(); } }
    await fs.chmod(backup, 0o600); await this.#syncDirectory(path.dirname(backup));
    await this.#write(migrated);
  }
  async create(input: { name: string; configuration: ProjectConfiguration }): Promise<ProjectRecord> {
    const name = projectName(input.name), configuration = publicConfiguration(input.configuration);
    return this.#mutation(async () => {
      const id = randomUUID(), now = new Date().toISOString();
      await this.#directory(path.join(this.dataRoot, 'projects', id)); await this.#directory(this.sessionDirectory(id));
      await this.#directory(this.projectDirectory(id));
      for (const directory of PROJECT_DIRECTORIES) await this.#directory(path.join(this.projectDirectory(id), directory));
      return this.#write({ schemaVersion: 2, id, name, configuration, uploads: [], archivedAt: null, tasks: [], createdAt: now, updatedAt: now });
    });
  }
  async list(): Promise<ProjectRecord[]> {
    this.#requireReady(); const projects: ProjectRecord[] = [];
    for (const item of await fs.readdir(path.join(this.dataRoot, 'projects'), { withFileTypes: true })) {
      if (!uuid.test(item.name) || !item.isDirectory() || item.isSymbolicLink()) fail('invalid_project_metadata');
      projects.push(this.#decorate(await this.#read(item.name)));
    }
    return projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  async get(id: string): Promise<ProjectRecord> { return this.#decorate(await this.#read(id)); }
  #active(project: StoredProject): void { if (project.archivedAt !== null) fail('project_archived'); }
  rename(id: string, input: string): Promise<ProjectRecord> {
    const name = projectName(input);
    return this.#mutation(async () => { const project = await this.#read(id); this.#active(project); return this.#write({ ...project, name, updatedAt: new Date().toISOString() }); });
  }
  archive(id: string): Promise<ProjectRecord> {
    return this.#mutation(async () => { const project = await this.#read(id); if (project.archivedAt !== null) return this.#decorate(project); const now = new Date().toISOString(); return this.#write({ ...project, archivedAt: now, updatedAt: now }); });
  }
  restore(id: string): Promise<ProjectRecord> {
    return this.#mutation(async () => { const project = await this.#read(id); if (project.archivedAt === null) return this.#decorate(project); return this.#write({ ...project, archivedAt: null, updatedAt: new Date().toISOString() }); });
  }
  async #assertTaskDirectory(projectId: string, task: StoredTask): Promise<void> {
    if (task.sessionStorage === 'legacy') { await this.#assertDirectory(this.sessionDirectory(projectId)); return; }
    const tasks = path.join(this.dataRoot, 'projects', this.#id(projectId), 'tasks');
    await this.#assertDirectory(tasks); await this.#assertDirectory(path.join(tasks, this.#id(task.id))); await this.#assertDirectory(this.#taskDirectory(projectId, task));
  }
  #task(project: StoredProject, taskId: string): StoredTask { this.#id(taskId); const task = project.tasks.find(task => task.id === taskId); if (!task) return fail('task_not_found'); return task; }
  async getTask(projectId: string, taskId: string): Promise<TaskRecord> { return this.#decorateTask(projectId, this.#task(await this.#read(projectId), taskId)); }
  createTask(projectId: string, input: { name: string; configuration?: ProjectConfiguration }): Promise<TaskRecord> {
    const name = projectName(input.name);
    return this.#mutation(async () => {
      const project = await this.#read(projectId); this.#active(project);
      const configuration = publicConfiguration(input.configuration ?? project.configuration), id = randomUUID(), now = new Date().toISOString();
      const task: StoredTask = { id, name, createdAt: now, updatedAt: now, configuration, draft: '', sessionStorage: 'task' };
      const next = { ...project, tasks: [...project.tasks, task], updatedAt: now }; this.#metadataBytes(next);
      const tasks = path.join(this.dataRoot, 'projects', projectId, 'tasks');
      await this.#directory(tasks); await this.#directory(path.join(tasks, id)); await this.#directory(this.#taskDirectory(projectId, task));
      await this.#write(next); return this.#decorateTask(projectId, task);
    });
  }
  #updateTask(projectId: string, taskId: string, update: (task: StoredTask) => StoredTask | Promise<StoredTask>): Promise<TaskRecord> {
    return this.#mutation(async () => {
      const project = await this.#read(projectId); this.#active(project);
      const previous = this.#task(project, taskId), now = new Date().toISOString(), task = { ...await update(previous), updatedAt: now };
      await this.#write({ ...project, tasks: project.tasks.map(item => item.id === taskId ? task : item), updatedAt: now }); return this.#decorateTask(projectId, task);
    });
  }
  saveDraft(projectId: string, taskId: string, draft: string): Promise<TaskRecord> {
    if (typeof draft !== 'string' || draft.length > 20000) return Promise.reject(new ProjectStoreFault('invalid_draft'));
    return this.#updateTask(projectId, taskId, task => ({ ...task, draft }));
  }
  async #validateSession(projectId: string, task: StoredTask, file: string): Promise<void> {
    const relative = path.relative(this.#taskDirectory(projectId, task), file);
    if (!path.isAbsolute(file) || !relative || relative.includes(path.sep) || relative.startsWith('..') || path.extname(file) !== '.jsonl') fail('invalid_session_file');
    try { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('invalid_session_file'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  setSession(projectId: string, taskId: string, file: string): Promise<TaskRecord> {
    return this.#updateTask(projectId, taskId, async task => { await this.#validateSession(projectId, task, file); return { ...task, sessionFile: file }; });
  }
  markRun(projectId: string, taskId: string, run: ProjectRun): Promise<TaskRecord> {
    const clean = validRun(run);
    return this.#updateTask(projectId, taskId, task => ({ ...task, lastRun: clean }));
  }
  #relative(relative: string): string[] {
    if (typeof relative !== 'string' || relative.length > 2000 || /[\\\u0000-\u001f\u007f]/.test(relative) || path.isAbsolute(relative)) return fail('invalid_file_path');
    const parts = relative.split('/');
    if (!PROJECT_DIRECTORIES.includes(parts[0] as ProjectDirectory) || parts.some(part => !part || part === '.' || part === '..' || part.length > 255)) return fail('invalid_file_path');
    return parts;
  }
  async #safePath(id: string, relative: string, missingLeaf = false): Promise<string> {
    await this.#assertProject(id); const parts = this.#relative(relative); let target = this.projectDirectory(id);
    for (let index = 0; index < parts.length; index++) {
      target = path.join(target, parts[index]);
      try {
        const entry = await fs.lstat(target);
        if (entry.isSymbolicLink() || (index !== parts.length - 1 && !entry.isDirectory()) || (!entry.isDirectory() && (!entry.isFile() || entry.nlink !== 1))) fail('unsafe_file_path');
      } catch (error) { if (!(missingLeaf && index === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error; }
    }
    const projectRoot = await fs.realpath(this.projectDirectory(id));
    const actual = await fs.realpath(target).catch(async error => { if (missingLeaf && (error as NodeJS.ErrnoException).code === 'ENOENT') return path.join(await fs.realpath(path.dirname(target)), path.basename(target)); throw error; });
    if (!inside(projectRoot, actual)) fail('unsafe_file_path'); return target;
  }
  #uploadInput(name: string, value: Uint8Array): { originalName: string; bytes: Buffer } {
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(name) || !['.csv', '.json', '.md', '.txt'].includes(path.extname(name.trim()).toLowerCase())) fail('invalid_upload_name');
    if (!(value instanceof Uint8Array) || value.byteLength > maxUploadBytes) fail('upload_too_large');
    const bytes = Buffer.from(value); try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('upload_requires_utf8'); }
    return { originalName: name, bytes };
  }
  async #upload(id: string, input: { originalName: string; bytes: Buffer }, directory: ProjectDirectory, source: UploadedFile['source']): Promise<UploadedFile> {
    const project = await this.#read(id); this.#active(project); const fileId = randomUUID();
    const original = input.originalName.trim(), extension = path.extname(original), stem = original.slice(0, -extension.length);
    let relative = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const name = attempt === 0 ? original : `${stem}__${randomUUID().slice(0, 8)}${extension}`;
      relative = `${directory}/${name}`;
      const target = await this.#safePath(id, relative, true);
      const uploaded: UploadedFile = { id: fileId, originalName: input.originalName, path: relative, bytes: input.bytes.length, sha256: createHash('sha256').update(input.bytes).digest('hex'), uploadedAt: new Date().toISOString(), source };
      const next = { ...project, uploads: [...project.uploads, uploaded], updatedAt: uploaded.uploadedAt }; this.#metadataBytes(next);
      let handle;
      try { handle = await fs.open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
      try { await handle.writeFile(input.bytes); await handle.sync(); } finally { await handle.close(); }
      await this.#write(next); return uploaded;
    }
    return fail('upload_name_conflict');
  }
  upload(input: { projectId: string; name: string; bytes: Uint8Array; directory?: '010_draw' | '020_clean' }): Promise<UploadedFile> {
    const prepared = this.#uploadInput(input.name, input.bytes), directory = input.directory ?? '010_draw';
    if (directory !== '010_draw' && directory !== '020_clean') return Promise.reject(new ProjectStoreFault('invalid_upload_directory'));
    return this.#mutation(() => this.#upload(input.projectId, prepared, directory, { kind: 'upload' }));
  }
  copyToClean(projectId: string, relativeRawPath: string): Promise<UploadedFile> {
    const parts = this.#relative(relativeRawPath);
    if (parts[0] !== '010_draw' || parts.length < 2) return Promise.reject(new ProjectStoreFault('copy_requires_raw_file'));
    return this.#mutation(async () => {
      const project = await this.#read(projectId); this.#active(project); const source = await this.readFile(projectId, relativeRawPath);
      const originalName = project.uploads.find(item => item.path === relativeRawPath)?.originalName ?? source.name;
      return this.#upload(projectId, this.#uploadInput(originalName, source.bytes), '020_clean', { kind: 'copy', from: relativeRawPath });
    });
  }
  async tree(projectId: string): Promise<FileNode[]> {
    await this.#assertProject(projectId);
    const node = async (relative: string): Promise<FileNode> => {
      const target = await this.#safePath(projectId, relative), stat = await fs.lstat(target), name = path.basename(target);
      if (stat.isFile()) return { name, path: relative, kind: 'file', bytes: stat.size };
      const children: FileNode[] = [];
      for (const entry of (await fs.readdir(target)).sort((a, b) => a.localeCompare(b))) children.push(await node(`${relative}/${entry}`));
      return { name, path: relative, kind: 'directory', children };
    };
    return Promise.all(PROJECT_DIRECTORIES.map(directory => node(directory)));
  }
  async readFile(projectId: string, relativePath: string): Promise<{ name: string; bytes: Buffer }> {
    const target = await this.#safePath(projectId, relativePath), before = await fs.lstat(target);
    if (!before.isFile()) return fail('file_not_found');
    const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const actual = await handle.stat();
      if (!actual.isFile() || actual.nlink !== 1 || actual.ino !== before.ino || actual.dev !== before.dev) return fail('unsafe_file_path');
      return { name: path.basename(target), bytes: await handle.readFile() };
    } finally { await handle.close(); }
  }
  async saveReport(projectId: string, name: string, text: string): Promise<UploadedFile> {
    if (typeof name !== 'string' || !['.md', '.txt'].includes(path.extname(name.trim()).toLowerCase())) return fail('invalid_report_name');
    if (typeof text !== 'string') return fail('invalid_report_text');
    const prepared = this.#uploadInput(name, Buffer.from(text, 'utf8'));
    return this.#mutation(() => this.#upload(projectId, prepared, '060_reports', { kind: 'user-save-report' }));
  }
  async close(): Promise<void> {
    await this.#gate; this.#ready = false;
    if (!this.#ownsLock) return;
    const file = path.join(this.dataRoot, '.project-store.lock');
    const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) fail('project_store_lock_changed');
    let value: unknown; try { value = JSON.parse(await fs.readFile(file, 'utf8')); } catch { fail('project_store_lock_changed'); }
    if (!object(value) || value.token !== this.#token || value.pid !== process.pid) fail('project_store_lock_changed');
    await fs.unlink(file); this.#ownsLock = false;
  }
}
