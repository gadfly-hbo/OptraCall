import path from 'node:path';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { DraftRecord, RunRecord, SnapshotRecord } from '../types.ts';

export class StoreFault extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'StoreFault'; this.code = code; }
}

const fail = (code: string, message: string): never => { throw new StoreFault(code, message); };
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const idPattern = /^(SNAP|RUN)-\d{4,}$/;
const maxFileBytes = 32 * 1024 * 1024;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

type Sequences = { run: number; snapshot: number };

/** 项目级推演资产文件存储：草稿/运行/快照。快照一次性写入，不提供修改与删除。 */
export class SimLabStore {
  readonly root: string;
  #gate: Promise<unknown> = Promise.resolve();
  constructor(root: string) { this.root = path.resolve(root); }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#gate.then(operation);
    this.#gate = result.then(() => {}, () => {});
    return result;
  }
  #dir(kind: 'drafts' | 'runs' | 'snapshots'): string { return path.join(this.root, kind); }
  async #ensure(kind: 'drafts' | 'runs' | 'snapshots'): Promise<string> {
    const directory = this.#dir(kind);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const entry = await fs.lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail('unsafe_store_directory', '存储目录不安全。');
    return directory;
  }
  async #readJson(file: string): Promise<unknown> {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxFileBytes) fail('store_corrupt', '存储文件状态异常。');
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const text = await handle.readFile('utf8');
      try { return JSON.parse(text); } catch { return fail('store_corrupt', '存储文件不是有效 JSON。'); }
    } finally { await handle.close(); }
  }
  async #writeJson(file: string, value: unknown, exclusive = false): Promise<void> {
    if (exclusive) {
      // 快照等一次性记录：目标已存在即冲突，绝不覆盖。
      const handle = await fs.open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
        .catch(error => { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return fail('record_conflict', '记录已存在，拒绝覆盖。'); throw error; });
      try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
      return;
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  }
  async #readSequences(): Promise<Sequences> {
    try {
      const value = await this.#readJson(path.join(this.root, 'sequences.json'));
      if (!object(value) || !Number.isSafeInteger(value.run) || !Number.isSafeInteger(value.snapshot)) return fail('store_corrupt', '序列号文件异常。');
      const { run, snapshot } = value as { run: number; snapshot: number };
      return { run, snapshot };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { run: 0, snapshot: 0 };
      throw error;
    }
  }
  async #nextSequence(kind: 'run' | 'snapshot'): Promise<number> {
    const sequences = await this.#readSequences();
    const next = sequences[kind] + 1;
    await this.#writeJson(path.join(this.root, 'sequences.json'), { ...sequences, [kind]: next });
    return next;
  }

  #draftFile(id: string): string {
    if (!uuidPattern.test(id)) fail('draft_not_found', '草稿不存在。');
    return path.join(this.#dir('drafts'), `${id}.json`);
  }
  #runFile(id: string): string {
    if (!idPattern.test(id) || !id.startsWith('RUN-')) fail('run_not_found', '运行记录不存在。');
    return path.join(this.#dir('runs'), `${id}.json`);
  }
  #snapshotFile(id: string): string {
    if (!idPattern.test(id) || !id.startsWith('SNAP-')) fail('snapshot_not_found', '快照不存在。');
    return path.join(this.#dir('snapshots'), `${id}.json`);
  }

  async #list<T>(kind: 'drafts' | 'runs' | 'snapshots', decode: (value: unknown) => T): Promise<T[]> {
    const directory = await this.#ensure(kind);
    const records: T[] = [];
    for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!item.isFile() || item.isSymbolicLink() || !item.name.endsWith('.json')) continue;
      records.push(decode(await this.#readJson(path.join(directory, item.name))));
    }
    return records;
  }

  #decodeDraft(value: unknown): DraftRecord {
    if (!object(value) || value.schemaVersion !== 1 || typeof value.id !== 'string' || !uuidPattern.test(value.id)
      || typeof value.projectId !== 'string' || typeof value.name !== 'string'
      || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
      || !object(value.parameters) || !Array.isArray(value.variants)) return fail('store_corrupt', '草稿记录异常。');
    return value as unknown as DraftRecord;
  }
  #decodeRun(value: unknown): RunRecord {
    if (!object(value) || value.schemaVersion !== 1 || typeof value.id !== 'string' || !idPattern.test(value.id)
      || typeof value.draftId !== 'string' || !Number.isSafeInteger(value.draftRevision)
      || !object(value.results)) return fail('store_corrupt', '运行记录异常。');
    return value as unknown as RunRecord;
  }
  #decodeSnapshot(value: unknown): SnapshotRecord {
    if (!object(value) || value.schemaVersion !== 1 || typeof value.id !== 'string' || !idPattern.test(value.id)
      || typeof value.draftId !== 'string' || typeof value.runId !== 'string' || !object(value.result)) return fail('store_corrupt', '快照记录异常。');
    return value as unknown as SnapshotRecord;
  }

  listDrafts(): Promise<DraftRecord[]> { return this.#serialize(() => this.#list('drafts', v => this.#decodeDraft(v))); }
  listRuns(): Promise<RunRecord[]> { return this.#serialize(() => this.#list('runs', v => this.#decodeRun(v))); }
  listSnapshots(): Promise<SnapshotRecord[]> { return this.#serialize(() => this.#list('snapshots', v => this.#decodeSnapshot(v))); }

  getDraft(id: string): Promise<DraftRecord> {
    return this.#serialize(async () => {
      try { return this.#decodeDraft(await this.#readJson(this.#draftFile(id))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail('draft_not_found', '草稿不存在。'); throw error; }
    });
  }
  getRun(id: string): Promise<RunRecord> {
    return this.#serialize(async () => {
      try { return this.#decodeRun(await this.#readJson(this.#runFile(id))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail('run_not_found', '运行记录不存在。'); throw error; }
    });
  }
  getSnapshot(id: string): Promise<SnapshotRecord> {
    return this.#serialize(async () => {
      try { return this.#decodeSnapshot(await this.#readJson(this.#snapshotFile(id))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail('snapshot_not_found', '快照不存在。'); throw error; }
    });
  }

  /** 新建草稿（revision 从 1 开始）。 */
  insertDraft(input: Omit<DraftRecord, 'revision' | 'createdAt' | 'updatedAt'>): Promise<DraftRecord> {
    return this.#serialize(async () => {
      const now = new Date().toISOString();
      const draft: DraftRecord = { ...input, revision: 1, createdAt: now, updatedAt: now };
      await this.#ensure('drafts');
      await this.#writeJson(this.#draftFile(draft.id), draft, true);
      return draft;
    });
  }

  /** CAS 更新：写前复读当前 revision，不一致即冲突；进程内串行化。 */
  updateDraft(id: string, expectedRevision: number, mutate: (current: DraftRecord) => Omit<DraftRecord, 'revision' | 'createdAt' | 'updatedAt'>): Promise<DraftRecord> {
    return this.#serialize(async () => {
      const current = this.#decodeDraft(await this.#readJson(this.#draftFile(id)).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail('draft_not_found', '草稿不存在。');
        throw error;
      }));
      if (current.revision !== expectedRevision) fail('revision_conflict', `草稿已被修改（当前 revision ${current.revision}），请刷新后重试。`);
      const next = mutate(current);
      const draft: DraftRecord = { ...next, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
      await this.#writeJson(this.#draftFile(id), draft);
      return draft;
    });
  }

  insertRun(input: Omit<RunRecord, 'id' | 'createdAt'>): Promise<RunRecord> {
    return this.#serialize(async () => {
      const sequence = await this.#nextSequence('run');
      const run: RunRecord = { ...input, id: `RUN-${String(sequence).padStart(4, '0')}`, createdAt: new Date().toISOString() };
      await this.#ensure('runs');
      await this.#writeJson(this.#runFile(run.id), run, true);
      return run;
    });
  }

  insertSnapshot(input: Omit<SnapshotRecord, 'id' | 'frozenAt'>): Promise<SnapshotRecord> {
    return this.#serialize(async () => {
      const sequence = await this.#nextSequence('snapshot');
      const snapshot: SnapshotRecord = { ...input, id: `SNAP-${String(sequence).padStart(4, '0')}`, frozenAt: new Date().toISOString() };
      await this.#ensure('snapshots');
      await this.#writeJson(this.#snapshotFile(snapshot.id), snapshot, true);
      return snapshot;
    });
  }
}
