import path from 'node:path';
import {existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, constants} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {StrategyDiscussionFault} from './strategy-discussion-fault.ts';
import {initiativeScopeKey, type StrategyInitiative, type StrategyInitiativeCreate, type StrategyInitiativeUpdate} from './strategy-initiative-types.ts';
import type {GoalScope} from './strategy-goals-types.ts';

const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : x;
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function initiativeId(x: unknown): string {
  if (typeof x !== 'string' || !uuid.test(x)) throw new StrategyDiscussionFault('invalid_strategy_initiative_id', 400);
  return x;
}
function validateScopes(input: unknown): GoalScope[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 50) throw new StrategyDiscussionFault('strategy_initiative_scopes_invalid', 400);
  const seen = new Set<string>();
  return input.map(entry => {
    if (!entry || typeof entry !== 'object') throw new StrategyDiscussionFault('strategy_initiative_scopes_invalid', 400);
    const {kind, id, name, enterpriseId} = entry as Record<string, unknown>;
    if (!['enterprise', 'department', 'personal'].includes(kind as string) || typeof id !== 'string' || !id.trim() || id.length > 100 || typeof name !== 'string' || !name.trim() || name.length > 200 || (enterpriseId !== undefined && (typeof enterpriseId !== 'string' || enterpriseId.length > 100)))
      throw new StrategyDiscussionFault('strategy_initiative_scopes_invalid', 400);
    const scope: GoalScope = {kind: kind as GoalScope['kind'], id, name, ...(enterpriseId !== undefined ? {enterpriseId: enterpriseId as string} : {})};
    const key = initiativeScopeKey(scope);
    if (seen.has(key)) throw new StrategyDiscussionFault('strategy_initiative_scope_conflict');
    seen.add(key);
    return scope;
  });
}

export class StrategyInitiativeStore {
  readonly root: string;
  constructor(dataRoot: string) { this.root = path.join(path.resolve(dataRoot), 'strategy-initiatives'); }
  directory(id: string) { return path.join(this.root, initiativeId(id)); }
  private safe(create = false) {
    if (!existsSync(this.root)) { if (!create) return false; mkdirSync(this.root, {recursive: true, mode: 0o700}); }
    let dir = this.root;
    while (true) {
      const s = lstatSync(dir);
      if (!(s.isSymbolicLink() && process.platform === 'darwin' && dir === '/var') && (!s.isDirectory() || s.isSymbolicLink())) throw new StrategyDiscussionFault('strategy_initiative_unsafe_path');
      const p = path.dirname(dir); if (p === dir) break; dir = p;
    }
    return true;
  }
  private read(id: string): StrategyInitiative & {createFingerprint: string} {
    initiativeId(id);
    if (!this.safe()) throw new StrategyDiscussionFault('strategy_initiative_not_found', 404);
    const dir = this.directory(id);
    if (existsSync(dir) && (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink())) throw new StrategyDiscussionFault('strategy_initiative_unsafe_path');
    const file = path.join(dir, 'initiative.json');
    if (!existsSync(file)) throw new StrategyDiscussionFault('strategy_initiative_not_found', 404);
    const s = lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 2 * 1024 * 1024) throw new StrategyDiscussionFault('strategy_initiative_unsafe_file');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let x: any;
    try { x = JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
    if (x.formatVersion !== 1 || x.id !== id || !Number.isSafeInteger(x.revision) || x.revision < 1 || !Array.isArray(x.scopes)) throw new StrategyDiscussionFault('strategy_initiative_corrupt');
    return x;
  }
  get(id: string): StrategyInitiative {
    const {createFingerprint: _, ...value} = this.read(id);
    return value;
  }
  list(): StrategyInitiative[] {
    if (!this.safe()) return [];
    return readdirSync(this.root).filter(x => uuid.test(x)).map(x => this.get(x)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  private write(value: StrategyInitiative & {createFingerprint: string}): void {
    this.safe(true);
    const dir = this.directory(value.id);
    mkdirSync(dir, {recursive: true, mode: 0o700});
    if (lstatSync(dir).isSymbolicLink()) throw new StrategyDiscussionFault('strategy_initiative_unsafe_path');
    const file = path.join(dir, 'initiative.json'), temp = path.join(dir, '.' + randomUUID() + '.tmp');
    let renamed = false;
    const contents = JSON.stringify({formatVersion: 1, ...value}) + '\n';
    if (Buffer.byteLength(contents) > 2 * 1024 * 1024) throw new StrategyDiscussionFault('strategy_initiative_storage_limit', 413);
    try {
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, file); renamed = true;
      const d = openSync(dir, 'r'); try { fsyncSync(d); } finally { closeSync(d); }
    } catch {
      if (!renamed) try { unlinkSync(temp); } catch {}
      throw new StrategyDiscussionFault(renamed ? 'strategy_initiative_write_unknown' : 'strategy_initiative_write_failed', 503);
    }
  }
  create(input: StrategyInitiativeCreate): StrategyInitiative {
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['operationId', 'title', 'scopes'].includes(key))) throw new StrategyDiscussionFault('strategy_initiative_fields_invalid', 400);
    const id = initiativeId(input?.operationId), fingerprint = hash(input);
    try {
      const existing = this.read(id);
      if (existing.createFingerprint !== fingerprint) throw new StrategyDiscussionFault('strategy_initiative_operation_conflict');
      return this.get(id);
    } catch (e) {
      if (!(e instanceof StrategyDiscussionFault) || e.status !== 404) throw e;
    }
    const now = new Date().toISOString();
    const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : '战略事项';
    if (title.length > 200) throw new StrategyDiscussionFault('strategy_initiative_title_invalid', 400);
    const scopes = input.scopes === undefined ? [{kind: 'personal' as const, id: 'self', name: '个人工作'}] : validateScopes(input.scopes);
    const value = {id, title, revision: 1, scopes, createdAt: now, updatedAt: now, createFingerprint: fingerprint};
    this.write(value);
    return this.get(id);
  }
  update(id: string, input: StrategyInitiativeUpdate): StrategyInitiative {
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['expectedRevision', 'title', 'scopes'].includes(key))) throw new StrategyDiscussionFault('strategy_initiative_fields_invalid', 400);
    const old = this.read(id);
    if (!Number.isSafeInteger(input?.expectedRevision) || old.revision !== input.expectedRevision) throw new StrategyDiscussionFault('strategy_initiative_context_changed');
    const patch: Partial<StrategyInitiative> = {};
    if (input.title !== undefined) {
      if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) throw new StrategyDiscussionFault('strategy_initiative_title_invalid', 400);
      patch.title = input.title.trim();
    }
    if (input.scopes !== undefined) patch.scopes = validateScopes(input.scopes);
    const value = {...old, ...patch, revision: old.revision + 1, updatedAt: new Date().toISOString()};
    this.write(value);
    const {createFingerprint: _, ...result} = value;
    return structuredClone(result);
  }
}