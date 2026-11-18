import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StudioError, object, text, uuid } from '../../extensions/business-plugins/studio/validation.ts';

export interface EnterpriseRecord { id: string; name: string; revision: number; createdAt: string }
export interface EnterpriseProjectAssignment { projectId: string; enterpriseId: string }
export interface EnterpriseCaseAssignment { caseId: string; enterpriseId: string }
export interface EnterpriseAssetAssignment { authority: string; id: string; enterpriseId: string }
export interface EnterpriseScopeIndex {
  enterprises: EnterpriseRecord[];
  projectAssignments: EnterpriseProjectAssignment[];
  caseAssignments: EnterpriseCaseAssignment[];
  assetAssignments: EnterpriseAssetAssignment[];
}
type StoredIndex = EnterpriseScopeIndex & { schemaVersion: 1 };
const empty = (): StoredIndex => ({ schemaVersion: 1, enterprises: [], projectAssignments: [], caseAssignments: [], assetAssignments: [] });
const fail = (): never => { throw new StudioError('invalid_enterprise_scope_storage', 503); };
const MAX_BYTES = 4 * 1024 * 1024;

/** Enterprise membership metadata only. Source content and publication stay in their existing authorities. */
export class EnterpriseScopeStore {
  readonly dataRoot: string;
  readonly root: string;
  readonly file: string;
  constructor(dataRoot: string) { this.dataRoot = path.resolve(dataRoot); this.root = path.join(this.dataRoot, 'enterprise-scopes'); this.file = path.join(this.root, 'index.json'); }
  private directory(name: string, create: boolean): boolean {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return fail(); if (!create) return false; fs.mkdirSync(name, { recursive: true, mode: 0o700 }); stat = fs.lstatSync(name); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
    return true;
  }
  private load(): StoredIndex {
    if (!this.directory(path.resolve(this.dataRoot), false) || !this.directory(this.root, false)) return empty();
    let before: fs.BigIntStats;
    try { before = fs.lstatSync(this.file, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && fs.readdirSync(this.root).length === 0) return empty(); return fail(); }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(MAX_BYTES)) fail();
    const fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const initial = fs.fstatSync(fd, { bigint: true });
      if (initial.ino !== before.ino || initial.dev !== before.dev || initial.nlink !== 1n || initial.size !== before.size) fail();
      const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd, { bigint: true }), current = fs.lstatSync(this.file, { bigint: true });
      if (BigInt(bytes.length) !== before.size || after.mtimeNs !== initial.mtimeNs || after.ctimeNs !== initial.ctimeNs || current.ino !== initial.ino || current.dev !== initial.dev || current.nlink !== 1n) fail();
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!object(value) || value.schemaVersion !== 1 || !['enterprises', 'projectAssignments', 'caseAssignments', 'assetAssignments'].every(key => Array.isArray(value[key]))) fail();
      const index = value as unknown as StoredIndex, ids = new Set<string>();
      for (const item of index.enterprises) {
        uuid(item.id); text(item.name, 200, false);
        if (item.revision !== 1 || ids.has(item.id) || !Number.isFinite(Date.parse(item.createdAt))) fail();
        ids.add(item.id);
      }
      for (const list of [index.projectAssignments, index.caseAssignments, index.assetAssignments]) {
        for (const item of list) if (!ids.has(item.enterpriseId)) fail();
      }
      const projects = new Set<string>();
      for (const item of index.projectAssignments) { uuid(item.projectId); if (projects.has(item.projectId)) fail(); projects.add(item.projectId); }
      const cases = new Set<string>(), assets = new Set<string>();
      for (const item of index.caseAssignments) { uuid(item.caseId); if (cases.has(item.caseId)) fail(); cases.add(item.caseId); }
      for (const item of index.assetAssignments) {
        text(item.id, 1000, false);
        if (!['enterprise', 'sap-metric', 'sap-method'].includes(item.authority)) fail();
        const key = JSON.stringify([item.authority, item.id]); if (assets.has(key)) fail(); assets.add(key);
      }
      return index;
    } catch (error) { if (error instanceof StudioError) throw error; return fail(); }
    finally { fs.closeSync(fd); }
  }
  private write(index: StoredIndex): void {
    this.directory(path.resolve(this.dataRoot), true); this.directory(this.root, true);
    const bytes = Buffer.from(JSON.stringify(index, null, 2) + '\n');
    if (bytes.length > MAX_BYTES) throw new StudioError('enterprise_scope_too_large', 413);
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.renameSync(temporary, this.file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    const directory = fs.openSync(this.root, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  }
  list(): EnterpriseScopeIndex { const { schemaVersion: _, ...value } = this.load(); return structuredClone(value); }
  get(id: string): EnterpriseRecord {
    const value = this.load().enterprises.find(item => item.id === uuid(id));
    if (!value) throw new StudioError('enterprise_not_found', 404);
    return structuredClone(value);
  }
  create(input: { name: string }): EnterpriseRecord {
    const name = text(input.name, 200, false), index = this.load();
    const value = { id: randomUUID(), name, revision: 1, createdAt: new Date().toISOString() };
    index.enterprises.push(value); this.write(index); return structuredClone(value);
  }
  enterpriseIdForProject(projectId: string): string | undefined { return this.load().projectAssignments.find(item => item.projectId === projectId)?.enterpriseId; }
  enterpriseIdForCase(caseId: string): string | undefined { return this.load().caseAssignments.find(item => item.caseId === caseId)?.enterpriseId; }
  assetEnterpriseId(authority: string, id: string): string | undefined { return this.load().assetAssignments.find(item => item.authority === authority && item.id === id)?.enterpriseId; }
  associateProject(projectId: string, enterpriseId: string): EnterpriseProjectAssignment {
    uuid(projectId); this.get(enterpriseId); const index = this.load();
    const previous = index.projectAssignments.find(item => item.projectId === projectId);
    if (previous) {
      if (previous.enterpriseId !== enterpriseId) throw new StudioError('enterprise_assignment_conflict', 409);
      return structuredClone(previous);
    }
    const value = { projectId, enterpriseId }; index.projectAssignments.push(value); this.write(index); return value;
  }
  associateCase(caseId: string, enterpriseId: string): EnterpriseCaseAssignment {
    uuid(caseId); this.get(enterpriseId); const index = this.load();
    const previous = index.caseAssignments.find(item => item.caseId === caseId);
    if (previous) {
      if (previous.enterpriseId !== enterpriseId) throw new StudioError('enterprise_assignment_conflict', 409);
      return structuredClone(previous);
    }
    const value = { caseId, enterpriseId }; index.caseAssignments.push(value); this.write(index); return value;
  }
  associateAsset(authority: string, id: string, enterpriseId: string): EnterpriseAssetAssignment {
    if (!['enterprise', 'sap-metric', 'sap-method'].includes(authority)) throw new StudioError('invalid_enterprise_asset_authority');
    text(id, 1000, false); this.get(enterpriseId); const index = this.load();
    const previous = index.assetAssignments.find(item => item.authority === authority && item.id === id);
    if (previous) {
      if (previous.enterpriseId !== enterpriseId) throw new StudioError('enterprise_assignment_conflict', 409);
      return structuredClone(previous);
    }
    const value = { authority, id, enterpriseId }; index.assetAssignments.push(value); this.write(index); return value;
  }
}
