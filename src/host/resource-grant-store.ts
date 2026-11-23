import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, object, sourceRef, StudioError, text, uuid } from '../../extensions/business-plugins/studio/validation.ts';
import type {
  ResourceAuthorizationGrant,
  ResourceGrantInput,
  ResourceGrantKind,
  ResourceGrantOperation,
} from '../../extensions/business-plugins/studio/enterprise-pack.ts';

type StoredGrantIndex = { schemaVersion: 1; grants: ResourceAuthorizationGrant[] };
const MAX_BYTES = 16 * 1024 * 1024;
const now = () => new Date().toISOString();
const clone = <T>(value: T): T => structuredClone(value);

const KINDS: readonly ResourceGrantKind[] = ['definition', 'summary', 'detail', 'pack-purpose'];
const OPS: readonly ResourceGrantOperation[] = ['read-definition', 'cite-summary', 'read-detail-recalculate'];

/**
 * Minimal Host-managed resource authorization store.
 * Client-supplied role names never grant access; every permission must derive
 * from an explicit, non-revoked, in-period grant bound to a verified enterprise
 * and Host-owned project/principal identity.
 */
export class ResourceGrantStore {
  readonly dataRoot: string;
  readonly root: string;
  readonly file: string;
  readonly readOnlyMode: boolean;

  constructor(dataRoot: string, options?: { readOnlyMode?: boolean }) {
    this.dataRoot = path.resolve(dataRoot);
    this.root = path.join(this.dataRoot, 'member-packs');
    this.file = path.join(this.root, 'resource-grants.json');
    this.readOnlyMode = Boolean(options?.readOnlyMode);
  }

  private assertWritable(): void {
    if (this.readOnlyMode) fail('member_pack_disabled_readonly', 503);
  }

  private directory(dir: string, create: boolean): boolean {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('unsafe_resource_grant_storage', 503);
      if (!create) return false;
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      stat = fs.lstatSync(dir);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_resource_grant_storage', 503);
    return true;
  }

  private load(): StoredGrantIndex {
    if (!this.directory(this.dataRoot, false) || !this.directory(this.root, false)) return { schemaVersion: 1, grants: [] };
    if (!fs.existsSync(this.file)) return { schemaVersion: 1, grants: [] };
    const stat = fs.lstatSync(this.file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(MAX_BYTES)) fail('unsafe_resource_grant_storage', 503);
    const fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const bytes = fs.readFileSync(fd);
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!object(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.grants)) fail('invalid_resource_grant_storage', 503);
      return parsed as unknown as StoredGrantIndex;
    } catch (error) {
      if (error instanceof StudioError) throw error;
      return fail('invalid_resource_grant_storage', 503);
    } finally {
      fs.closeSync(fd);
    }
  }

  private save(index: StoredGrantIndex): void {
    this.assertWritable();
    this.directory(this.dataRoot, true);
    this.directory(this.root, true);
    const bytes = Buffer.from(JSON.stringify(index, null, 2) + '\n');
    if (bytes.length > MAX_BYTES) fail('resource_grant_storage_too_large', 413);
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try {
      fs.renameSync(tmp, this.file);
      const dirFd = fs.openSync(this.root, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch {}
      throw error;
    }
  }

  list(enterpriseId?: string): ResourceAuthorizationGrant[] {
    const all = this.load().grants;
    return clone(enterpriseId ? all.filter(g => g.enterpriseId === uuid(enterpriseId)) : all);
  }

  listForSubject(enterpriseId: string, subjectId: string): ResourceAuthorizationGrant[] {
    const eid = uuid(enterpriseId);
    const sid = text(subjectId, 200, false);
    return clone(this.load().grants.filter(g => g.enterpriseId === eid && g.subjectId === sid));
  }

  hasAnyGrants(enterpriseId: string, subjectId?: string): boolean {
    const eid = uuid(enterpriseId);
    return this.load().grants.some(g => g.enterpriseId === eid && (subjectId === undefined || g.subjectId === subjectId));
  }

  get(grantId: string): ResourceAuthorizationGrant {
    const found = this.load().grants.find(g => g.id === uuid(grantId));
    if (!found) fail('resource_grant_not_found', 404);
    return clone(found);
  }

  grant(input: ResourceGrantInput & { grantorVerifiedBy?: 'host' }): ResourceAuthorizationGrant {
    this.assertWritable();
    const enterpriseId = uuid(input.enterpriseId);
    const grantor = text(input.grantor, 500, false).trim();
    const grantBasis = text(input.grantBasis, 2000, false).trim();
    if (!['project', 'principal'].includes(input.subjectType)) fail('invalid_grant_subject_type');
    const subjectId = input.subjectType === 'project' ? uuid(input.subjectId) : text(input.subjectId, 200, false).trim();
    if (!KINDS.includes(input.resourceKind)) fail('invalid_grant_resource_kind');
    if (!Array.isArray(input.operations) || !input.operations.length || input.operations.some(op => !OPS.includes(op))) fail('invalid_grant_operations');
    const operations = [...new Set(input.operations)];
    const resourceRef = input.resourceRef ? sourceRef(input.resourceRef) : undefined;
    if (input.purposeKeys !== undefined && !Array.isArray(input.purposeKeys)) fail('invalid_grant_purpose_keys');
    const purposeKeys = input.purposeKeys?.map(k => text(k, 200, false).trim());
    if (input.purposeKeys !== undefined && Array.isArray(input.purposeKeys) && input.purposeKeys.length === 0) fail('invalid_grant_purpose_keys');

    const scope = input.scope ?? {};
    if (operations.includes('cite-summary')) {
      if (!scope.summaryAssetId || !scope.summaryVersion || !scope.summaryAuthority || !scope.grain) {
        fail('invalid_summary_grant_scope');
      }
    }
    if (input.validFrom !== undefined && !Number.isFinite(Date.parse(input.validFrom))) fail('invalid_grant_valid_from');
    if (input.validTo !== undefined && !Number.isFinite(Date.parse(input.validTo))) fail('invalid_grant_valid_to');
    if (input.validFrom && input.validTo && Date.parse(input.validFrom) > Date.parse(input.validTo)) fail('invalid_grant_period');

    const stamp = now();
    const record: ResourceAuthorizationGrant = {
      id: randomUUID(),
      enterpriseId,
      grantor,
      ...(input.grantorVerifiedBy ? { grantorVerifiedBy: input.grantorVerifiedBy } : {}),
      ...(input.grantorProjectId ? { grantorProjectId: uuid(input.grantorProjectId) } : {}),
      ...(input.grantorTaskId ? { grantorTaskId: uuid(input.grantorTaskId) } : {}),
      ...(input.grantorSystemId ? { grantorSystemId: uuid(input.grantorSystemId) } : {}),
      ...(input.grantorOperatorId ? { grantorOperatorId: text(input.grantorOperatorId, 200, false) } : {}),
      ...(input.grantorOperatorVerified !== undefined ? { grantorOperatorVerified: Boolean(input.grantorOperatorVerified) } : {}),
      ...(input.grantorCredentialVerified !== undefined ? { grantorCredentialVerified: Boolean(input.grantorCredentialVerified) } : {}),
      ...(input.grantorAuthorityType ? { grantorAuthorityType: input.grantorAuthorityType } : {}),
      grantBasis,
      subjectType: input.subjectType,
      subjectId,
      resourceKind: input.resourceKind,
      ...(resourceRef ? { resourceRef } : {}),
      ...(purposeKeys?.length ? { purposeKeys } : {}),
      operations,
      scope: {
        ...(scope.brand ? { brand: text(scope.brand, 200, false) } : {}),
        ...(scope.channel ? { channel: text(scope.channel, 200, false) } : {}),
        ...(scope.stores?.length ? { stores: [...new Set(scope.stores.map(s => text(s, 200, false)))] } : {}),
        ...(scope.periodFrom ? { periodFrom: text(scope.periodFrom, 100, false) } : {}),
        ...(scope.periodTo ? { periodTo: text(scope.periodTo, 100, false) } : {}),
        ...(scope.grain ? { grain: text(scope.grain, 200, false) } : {}),
        ...(scope.summaryAssetId ? { summaryAssetId: text(scope.summaryAssetId, 200, false) } : {}),
        ...(scope.summaryVersion ? { summaryVersion: text(scope.summaryVersion, 100, false) } : {}),
        ...(scope.summaryAuthority ? { summaryAuthority: text(scope.summaryAuthority, 200, false) } : {}),
        ...(scope.summarySha256 ? { summarySha256: text(scope.summarySha256, 128, false) } : {}),
        ...(scope.verifiedScopeSummary ? { verifiedScopeSummary: text(scope.verifiedScopeSummary, 500, false) } : {}),
        ...(scope.sourcePeriodFrom ? { sourcePeriodFrom: text(scope.sourcePeriodFrom, 100, false) } : {}),
        ...(scope.sourcePeriodTo ? { sourcePeriodTo: text(scope.sourcePeriodTo, 100, false) } : {}),
        ...(scope.metricRef ? { metricRef: sourceRef(scope.metricRef) } : {}),
        ...(scope.allowedDataPaths?.length ? { allowedDataPaths: [...new Set(scope.allowedDataPaths.map(p => text(p, 1000, false)))] } : {}),
      },
      ...(input.validFrom ? { validFrom: input.validFrom } : {}),
      ...(input.validTo ? { validTo: input.validTo } : {}),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const index = this.load();
    index.grants.push(record);
    this.save(index);
    return clone(record);
  }

  revoke(grantId: string, reason: string, actor?: { revokedBy?: string; revokedByProjectId?: string; revokedByTaskId?: string; revokedByOperatorId?: string }): ResourceAuthorizationGrant {
    this.assertWritable();
    const id = uuid(grantId);
    const revokedReason = text(reason, 2000, false).trim();
    const index = this.load();
    const found = index.grants.find(g => g.id === id);
    if (!found) fail('resource_grant_not_found', 404);
    const stamp = now();
    found.revokedAt = found.revokedAt ?? stamp;
    found.revokedReason = revokedReason;
    if (actor?.revokedBy) found.revokedBy = text(actor.revokedBy, 200, false);
    if (actor?.revokedByProjectId) found.revokedByProjectId = uuid(actor.revokedByProjectId);
    if (actor?.revokedByTaskId) found.revokedByTaskId = uuid(actor.revokedByTaskId);
    if (actor?.revokedByOperatorId) found.revokedByOperatorId = text(actor.revokedByOperatorId, 200, false);
    found.updatedAt = stamp;
    this.save(index);
    return clone(found);
  }
}
