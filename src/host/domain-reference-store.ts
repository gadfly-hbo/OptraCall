import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fail, object, StudioError, text, uuid } from '../../extensions/business-plugins/studio/validation.ts';
import type {
  DomainReferenceDomain,
  DomainReferenceEvidenceNature,
  DomainReferenceRecord,
  DomainReferenceRegisterInput,
  DomainReferenceRoute,
  DomainReferenceVisibility,
} from '../../extensions/business-plugins/studio/enterprise-pack.ts';

type StoredReferenceIndex = { schemaVersion: 1; references: DomainReferenceRecord[] };
const MAX_BYTES = 32 * 1024 * 1024;
const now = () => new Date().toISOString();
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);

const DOMAINS: readonly DomainReferenceDomain[] = ['member', 'product', 'store', 'supply', 'marketing', 'enterprise', 'benchmark', 'other'];
const ROUTES: readonly DomainReferenceRoute[] = ['enterprise', 'domain'];
const NATURES: readonly DomainReferenceEvidenceNature[] = ['generic-draft', 'public-benchmark', 'third-party-research', 'enterprise-official', 'synthetic-fixture'];
const VISIBILITIES: readonly DomainReferenceVisibility[] = ['public', 'shared', 'enterprise'];

export interface BuiltinRepoTemplateSpec {
  sourceId: 'T03' | 'T04' | 'T01' | 'T02';
  version: string;
  title: string;
  domain: DomainReferenceDomain;
  routes: DomainReferenceRoute[];
  maintainer: string;
  scope: string;
  evidenceNature: DomainReferenceEvidenceNature;
  evidenceRestrictions: string[];
  relativePath: string;
}

export const BUILTIN_REPO_TEMPLATES: Record<'T01' | 'T02' | 'T03' | 'T04', BuiltinRepoTemplateSpec> = {
  T01: {
    sourceId: 'T01',
    version: '0.2',
    title: '运动鞋服行业通用参考 T01',
    domain: 'enterprise',
    routes: ['enterprise'],
    maintainer: 'OptraCall 仓库模板维护',
    scope: '行业主数据、渠道与通用指标背景起点',
    evidenceNature: 'generic-draft',
    evidenceRestrictions: ['通用行业背景参考，不替代目标企业正式依据'],
    relativePath: 'docs/reference-templates/v0.2/01-sportswear-industry.md',
  },
  T02: {
    sourceId: 'T02',
    version: '0.2',
    title: '会员运营领域通用参考 T02',
    domain: 'member',
    routes: ['domain'],
    maintainer: 'OptraCall 仓库模板维护',
    scope: '会员领域事件、对象与指标用途参考起点',
    evidenceNature: 'generic-draft',
    evidenceRestrictions: ['通用领域参考，不替代目标企业正式依据'],
    relativePath: 'docs/reference-templates/v0.2/02-membership-domain.md',
  },
  T03: {
    sourceId: 'T03',
    version: '0.2',
    title: 'Nike 企业公开参考 T03',
    domain: 'enterprise',
    routes: ['enterprise'],
    maintainer: 'OptraCall 仓库模板维护',
    scope: '企业渠道、触点与披露范围标杆参考',
    evidenceNature: 'public-benchmark',
    evidenceRestrictions: ['公开披露范围，未披露的内部销售归属保持未知'],
    relativePath: 'docs/reference-templates/v0.2/03-nike-enterprise-public.md',
  },
  T04: {
    sourceId: 'T04',
    version: '0.2',
    title: 'Nike 会员运营公开参考 T04',
    domain: 'member',
    routes: ['domain'],
    maintainer: 'OptraCall 仓库模板维护',
    scope: '购物、活动参与、到店与服务触点区分参考',
    evidenceNature: 'public-benchmark',
    evidenceRestrictions: ['公开披露范围，内部 KPI 与归属保持未知'],
    relativePath: 'docs/reference-templates/v0.2/04-nike-membership-public.md',
  },
};

export interface DomainReferenceRegisterResult {
  record: DomainReferenceRecord;
  outcome: 'created' | 'reused' | 'conflict';
}

export class DomainReferenceStore {
  readonly dataRoot: string;
  readonly root: string;
  readonly file: string;
  readonly codeRoot: string;

  constructor(dataRoot: string, codeRoot = process.cwd()) {
    this.dataRoot = path.resolve(dataRoot);
    this.root = path.join(this.dataRoot, 'member-packs');
    this.file = path.join(this.root, 'domain-references.json');
    this.codeRoot = path.resolve(codeRoot);
  }

  private directory(dir: string, create: boolean): boolean {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(dir); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail('unsafe_domain_reference_storage', 503);
      if (!create) return false;
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      stat = fs.lstatSync(dir);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe_domain_reference_storage', 503);
    return true;
  }

  private load(): StoredReferenceIndex {
    if (!this.directory(this.dataRoot, false) || !this.directory(this.root, false)) return { schemaVersion: 1, references: [] };
    if (!fs.existsSync(this.file)) return { schemaVersion: 1, references: [] };
    const stat = fs.lstatSync(this.file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > BigInt(MAX_BYTES)) fail('unsafe_domain_reference_storage', 503);
    const fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const bytes = fs.readFileSync(fd);
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!object(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.references)) fail('invalid_domain_reference_storage', 503);
      return parsed as unknown as StoredReferenceIndex;
    } catch (error) {
      if (error instanceof StudioError) throw error;
      return fail('invalid_domain_reference_storage', 503);
    } finally {
      fs.closeSync(fd);
    }
  }

  private save(index: StoredReferenceIndex): void {
    this.directory(this.dataRoot, true);
    this.directory(this.root, true);
    const bytes = Buffer.from(JSON.stringify(index, null, 2) + '\n');
    if (bytes.length > MAX_BYTES) fail('domain_reference_storage_too_large', 413);
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

  list(filter?: { enterpriseId?: string; domain?: DomainReferenceDomain; sourceId?: string; query?: string }): DomainReferenceRecord[] {
    const all = this.load().references;
    return clone(all.filter(item => {
      if (item.visibility === 'enterprise' && item.enterpriseId !== filter?.enterpriseId) return false;
      if (filter?.domain && item.domain !== filter.domain) return false;
      if (filter?.sourceId && item.sourceId !== filter.sourceId) return false;
      if (filter?.query?.trim()) {
        const needle = filter.query.trim().toLowerCase();
        const hay = `${item.sourceId} ${item.version} ${item.title} ${item.scope} ${item.maintainer} ${item.locator}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    }));
  }

  get(id: string): DomainReferenceRecord {
    const found = this.load().references.find(item => item.id === uuid(id));
    if (!found) fail('domain_reference_not_found', 404);
    return clone(found);
  }

  readOriginal(id: string, sectionLocator?: string): { record: DomainReferenceRecord; text: string; sha256: string; sectionLocator?: string } {
    const record = this.get(id);
    if (record.contentStatus !== 'available' || !record.contentSha256 || typeof record.contentBody !== 'string') {
      fail('domain_reference_source_unavailable', 409);
    }
    if (sha(record.contentBody) !== record.contentSha256) {
      fail('domain_reference_source_changed', 409);
    }
    return {
      record,
      text: record.contentBody,
      sha256: record.contentSha256,
      ...(sectionLocator ? { sectionLocator } : {}),
    };
  }

  register(input: DomainReferenceRegisterInput): DomainReferenceRegisterResult {
    const sourceId = text(input.sourceId, 200, false).trim();
    const version = text(input.version, 100, false).trim();
    const title = text(input.title, 300, false).trim();
    if (!DOMAINS.includes(input.domain)) fail('invalid_domain_reference_domain');
    if (!Array.isArray(input.routes) || !input.routes.length || input.routes.some(r => !ROUTES.includes(r))) fail('invalid_domain_reference_routes');
    const routes = [...new Set(input.routes)];
    const maintainer = text(input.maintainer, 200, false).trim();
    const scope = text(input.scope, 20_000, false).trim();
    if (!NATURES.includes(input.evidenceNature)) fail('invalid_domain_reference_nature');
    if (!VISIBILITIES.includes(input.visibility)) fail('invalid_domain_reference_visibility');
    const locator = text(input.locator, 2000, false).trim();
    const enterpriseId = input.visibility === 'enterprise' ? uuid(input.enterpriseId) : undefined;
    const evidenceRestrictions = (input.evidenceRestrictions ?? []).map(item => text(item, 2000, false));

    let contentBody: string | undefined;
    let contentSha256: string | undefined;
    if (typeof input.contentBody === 'string' && input.contentBody.length > 0) {
      contentBody = text(input.contentBody, 2 * 1024 * 1024, false);
      const computed = sha(contentBody);
      if (input.contentSha256 && input.contentSha256 !== computed) fail('domain_reference_hash_mismatch', 409);
      contentSha256 = computed;
    } else if (input.contentSha256 !== undefined) {
      if (typeof input.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.contentSha256)) fail('invalid_domain_reference_hash');
      // Hash without readable body cannot claim available original text
    }
    const contentStatus = contentBody !== undefined && contentSha256 !== undefined ? 'available' : 'pending_source';

    const index = this.load();
    const existing = index.references.find(item =>
      item.sourceId === sourceId
      && item.version === version
      && (item.visibility !== 'enterprise' || item.enterpriseId === enterpriseId),
    );
    const stamp = now();

    if (existing) {
      // Case A: Both have verified contentSha256 and they DIFFER -> preserve original, record pending conflict!
      if (existing.contentStatus === 'available' && contentStatus === 'available' && existing.contentSha256 !== contentSha256) {
        const alreadyLogged = existing.conflicts.some(c => c.incomingSha256 === contentSha256);
        if (!alreadyLogged) {
          existing.conflicts.push({
            id: randomUUID(),
            incomingSha256: contentSha256!,
            incomingLocator: locator,
            incomingBody: contentBody,
            ...(input.submittedBy ? { submittedBy: text(input.submittedBy, 200, false) } : {}),
            note: input.conflictNote ? text(input.conflictNote, 2000, false) : '同源同版正文摘要不一致；保留原获准版本，待维护方核实',
            detectedAt: stamp,
            status: 'pending',
          });
          existing.updatedAt = stamp;
          this.save(index);
        }
        return { record: clone(existing), outcome: 'conflict' };
      }

      // Case B: Existing was pending_source and incoming now provides verified original body
      let changed = false;
      for (const route of routes) {
        if (!existing.routes.includes(route)) { existing.routes.push(route); changed = true; }
      }
      for (const restriction of evidenceRestrictions) {
        if (!existing.evidenceRestrictions.includes(restriction)) { existing.evidenceRestrictions.push(restriction); changed = true; }
      }
      if (existing.contentStatus === 'pending_source' && contentStatus === 'available') {
        existing.contentStatus = 'available';
        existing.contentBody = contentBody;
        existing.contentSha256 = contentSha256;
        existing.missingFields = undefined;
        existing.locator = locator;
        changed = true;
      }
      if (changed) {
        existing.updatedAt = stamp;
        this.save(index);
      }
      return { record: clone(existing), outcome: 'reused' };
    }

    const record: DomainReferenceRecord = {
      id: randomUUID(),
      sourceId,
      version,
      title,
      domain: input.domain,
      routes,
      maintainer,
      scope,
      evidenceNature: input.evidenceNature,
      evidenceRestrictions,
      locator,
      visibility: input.visibility,
      ...(enterpriseId ? { enterpriseId } : {}),
      contentStatus,
      ...(contentSha256 ? { contentSha256 } : {}),
      ...(contentBody !== undefined ? { contentBody } : {}),
      ...(contentStatus === 'pending_source' ? { missingFields: input.missingFields?.length ? input.missingFields.map(f => text(f, 500, false)) : ['原件正文尚未核准接入，暂不具备原文可回查资格'] } : {}),
      ...(input.sections?.length ? { sections: input.sections } : {}),
      conflicts: [],
      createdAt: stamp,
      updatedAt: stamp,
    };
    index.references.push(record);
    this.save(index);
    return { record: clone(record), outcome: 'created' };
  }

  registerRepoTemplate(templateId: keyof typeof BUILTIN_REPO_TEMPLATES): DomainReferenceRegisterResult {
    const spec = BUILTIN_REPO_TEMPLATES[templateId];
    if (!spec) fail('domain_reference_template_not_found', 404);
    const absPath = path.resolve(this.codeRoot, spec.relativePath);
    if (!fs.existsSync(absPath)) {
      return this.register({
        sourceId: spec.sourceId,
        version: spec.version,
        title: spec.title,
        domain: spec.domain,
        routes: spec.routes,
        maintainer: spec.maintainer,
        scope: spec.scope,
        evidenceNature: spec.evidenceNature,
        evidenceRestrictions: spec.evidenceRestrictions,
        locator: spec.relativePath,
        visibility: 'public',
        missingFields: [`仓库路径 ${spec.relativePath} 当前不可读`],
      });
    }
    const bytes = fs.readFileSync(absPath);
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return this.register({
      sourceId: spec.sourceId,
      version: spec.version,
      title: spec.title,
      domain: spec.domain,
      routes: spec.routes,
      maintainer: spec.maintainer,
      scope: spec.scope,
      evidenceNature: spec.evidenceNature,
      evidenceRestrictions: spec.evidenceRestrictions,
      locator: spec.relativePath,
      visibility: 'public',
      contentBody: body,
      contentSha256: sha(bytes),
    });
  }
}
