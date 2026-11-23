import path from 'node:path';
import {existsSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, constants} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {StrategyDiscussionFault} from './strategy-discussion-fault.ts';
import {StrategyInitiativeStore} from './strategy-initiative-store.ts';
import {initiativeScopeKey} from './strategy-initiative-types.ts';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
export interface InitiativeFile {
  fileId: string;
  operationId: string;
  name: string;
  directory: '010_draw' | '020_clean';
  scopeKey?: string;
  size: number;
  sha256: string;
  uploadedAt: string;
}
type FileIndex = { formatVersion: 1; files: (InitiativeFile & { storedName: string })[] };

export class StrategyInitiativeFiles {
  private readonly initiatives: StrategyInitiativeStore;
  constructor(initiatives: StrategyInitiativeStore) { this.initiatives = initiatives; }
  private dir(id: string) { return path.join(this.initiatives.directory(id), 'files'); }
  private indexFile(id: string) { return path.join(this.initiatives.directory(id), 'files.json'); }
  private readIndex(id: string): FileIndex {
    const file = this.indexFile(id);
    if (!existsSync(file)) return {formatVersion: 1, files: []};
    const s = lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 2 * 1024 * 1024) throw new StrategyDiscussionFault('strategy_file_unsafe_file');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let x: any;
    try { x = JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
    if (x.formatVersion !== 1 || !Array.isArray(x.files)) throw new StrategyDiscussionFault('strategy_file_corrupt');
    return x;
  }
  private writeIndex(id: string, value: FileIndex): void {
    const dir = this.initiatives.directory(id);
    const file = this.indexFile(id), temp = path.join(dir, '.' + randomUUID() + '.tmp');
    let renamed = false;
    const contents = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(contents) > 2 * 1024 * 1024) throw new StrategyDiscussionFault('strategy_file_storage_limit', 413);
    try {
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, file); renamed = true;
      const d = openSync(dir, 'r'); try { fsyncSync(d); } finally { closeSync(d); }
    } catch {
      if (!renamed) try { unlinkSync(temp); } catch {}
      throw new StrategyDiscussionFault(renamed ? 'strategy_file_write_unknown' : 'strategy_file_write_failed', 503);
    }
  }
  list(id: string, scopeKey?: string): InitiativeFile[] {
    const initiative = this.initiatives.get(id);
    if (scopeKey !== undefined && !initiative.scopes.some(s => initiativeScopeKey(s) === scopeKey)) throw new StrategyDiscussionFault('strategy_initiative_scope_unknown');
    const {files} = this.readIndex(id);
    return files
      .filter(f => scopeKey === undefined || f.scopeKey === undefined || f.scopeKey === scopeKey)
      .map(({storedName: _, ...file}) => structuredClone(file));
  }
  upload(id: string, input: { operationId: string; directory: string; name: string; contentBase64: string; scopeKey?: string }): InitiativeFile {
    const initiative = this.initiatives.get(id);
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['operationId', 'directory', 'name', 'contentBase64', 'scopeKey'].includes(key))) throw new StrategyDiscussionFault('strategy_file_fields_invalid', 400);
    if (typeof input.operationId !== 'string' || !uuid.test(input.operationId)) throw new StrategyDiscussionFault('strategy_file_operation_invalid', 400);
    if (input.directory !== '010_draw' && input.directory !== '020_clean') throw new StrategyDiscussionFault('strategy_file_directory_invalid', 400);
    const directory: '010_draw' | '020_clean' = input.directory === '010_draw' ? '010_draw' : '020_clean';
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 || /[\/\\\u0000-\u001f]/.test(input.name) || input.name.includes('..')) throw new StrategyDiscussionFault('strategy_file_name_invalid', 400);
    if (typeof input.contentBase64 !== 'string') throw new StrategyDiscussionFault('strategy_file_content_invalid', 400);
    if (input.scopeKey !== undefined && !initiative.scopes.some(s => initiativeScopeKey(s) === input.scopeKey)) throw new StrategyDiscussionFault('strategy_initiative_scope_unknown');
    const bytes = Buffer.from(input.contentBase64, 'base64');
    if (bytes.length > MAX_FILE_BYTES) throw new StrategyDiscussionFault('strategy_file_too_large', 413);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const index = this.readIndex(id);
    const existing = index.files.find(f => f.operationId === input.operationId);
    if (existing) {
      if (existing.sha256 !== sha256 || existing.name !== input.name || existing.directory !== input.directory || (existing.scopeKey ?? undefined) !== (input.scopeKey ?? undefined)) throw new StrategyDiscussionFault('strategy_file_operation_conflict');
      const {storedName: _, ...file} = existing;
      return structuredClone(file);
    }
    const fileId = randomUUID();
    const storedName = `${fileId}${path.extname(input.name).slice(0, 16)}`;
    const target = path.join(this.dir(id), directory, storedName);
    mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
    const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    const record = {fileId, operationId: input.operationId, name: input.name, directory, ...(input.scopeKey !== undefined ? {scopeKey: input.scopeKey} : {}), size: bytes.length, sha256, uploadedAt: new Date().toISOString(), storedName};
    index.files.push(record);
    this.writeIndex(id, index);
    const {storedName: _, ...file} = record;
    return structuredClone(file);
  }
  read(id: string, fileId: string): { file: InitiativeFile; contentBase64: string } {
    this.initiatives.get(id);
    if (typeof fileId !== 'string' || !uuid.test(fileId)) throw new StrategyDiscussionFault('strategy_file_not_found', 404);
    const index = this.readIndex(id);
    const record = index.files.find(f => f.fileId === fileId);
    if (!record) throw new StrategyDiscussionFault('strategy_file_not_found', 404);
    const target = path.join(this.dir(id), record.directory, record.storedName);
    const s = lstatSync(target);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > MAX_FILE_BYTES) throw new StrategyDiscussionFault('strategy_file_unsafe_file');
    const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try { bytes = readFileSync(fd); } finally { closeSync(fd); }
    if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new StrategyDiscussionFault('strategy_file_corrupt');
    const {storedName: _, ...file} = record;
    return {file: structuredClone(file), contentBase64: bytes.toString('base64')};
  }
}