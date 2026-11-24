import path from 'node:path';
import {existsSync, lstatSync, openSync, readFileSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, constants} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {StrategyDiscussionFault} from './strategy-discussion-fault.ts';
import {StrategyInitiativeStore} from './strategy-initiative-store.ts';
import {initiativeScopeKey, type KickoffApplication, type KickoffFields, type KickoffReportVersion, type KickoffSourceRef, type KickoffAnchor, type RevisionProposal} from './strategy-initiative-types.ts';
import type {GoalScope} from './strategy-goals-types.ts';

const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : x;
const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
function invalid(path: string, reason: string, code = 'strategy_kickoff_schema_invalid', status = 400): never {
  const message = code === 'strategy_kickoff_schema_invalid'
    ? '开题字段校验失败，请按 details.issues 的 path/reason 修正；本次未写入。'
    : '开题来源不可用，请按 details.issues 核对文件身份、指纹和范围；本次未写入。';
  throw new StrategyDiscussionFault(code, status, {message, details: {issues: [{reason, path}]}});
}
const safeChildPath = (base: string, key: string) => /^[A-Za-z0-9_.[\]]{1,100}$/.test(key) ? `${base}.${key}` : base;
const text = (x: unknown, max: number, allowEmpty: boolean, path: string): string => {
  if (x === undefined) invalid(path, 'required');
  if (typeof x !== 'string') invalid(path, 'invalid_type');
  if (x.length > max) invalid(path, 'too_long');
  if (!allowEmpty && !x.trim()) invalid(path, 'required');
  return x;
};
function validateFields(input: unknown): KickoffFields {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('fields', 'invalid_type');
  const raw = input as Record<string, unknown>;
  const allowed = ['horizon', 'diagnosis', 'propositions', 'assumptions', 'evidenceGaps', 'followUp', 'priorReview'];
  const unknown = Object.keys(raw).find(key => !allowed.includes(key));
  if (unknown) invalid(safeChildPath('fields', unknown), 'unknown_field');
  const propositions = raw.propositions;
  if (!Array.isArray(propositions)) invalid('fields.propositions', propositions === undefined ? 'required' : 'invalid_type');
  if (propositions.length < 3 || propositions.length > 5) invalid('fields.propositions', 'proposition_count');
  const ids = new Set<string>();
  const parsed = propositions.map((entry, index) => {
    const base = `fields.propositions[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid(base, 'invalid_type');
    const p = entry as Record<string, unknown>;
    const allowed = ['id', 'question', 'whyItMatters', 'evidence', 'gaps'];
    const unknown = Object.keys(p).find(key => !allowed.includes(key));
    if (unknown) invalid(safeChildPath(base, unknown), 'unknown_field');
    if (p.id === undefined) invalid(`${base}.id`, 'required');
    if (typeof p.id !== 'string') invalid(`${base}.id`, 'invalid_type');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(p.id)) invalid(`${base}.id`, 'invalid_id');
    if (ids.has(p.id)) invalid(`${base}.id`, 'duplicate_id');
    ids.add(p.id);
    return {
      id: p.id, question: text(p.question, 2000, false, `${base}.question`), whyItMatters: text(p.whyItMatters, 2000, false, `${base}.whyItMatters`),
      ...(p.evidence !== undefined ? {evidence: text(p.evidence, 4000, true, `${base}.evidence`)} : {}),
      ...(p.gaps !== undefined ? {gaps: text(p.gaps, 4000, true, `${base}.gaps`)} : {}),
    };
  });
  if (raw.priorReview !== undefined && raw.priorReview !== 'applicable' && raw.priorReview !== 'not-applicable') invalid('fields.priorReview', 'invalid_value');
  return {
    horizon: text(raw.horizon, 500, false, 'fields.horizon'), diagnosis: text(raw.diagnosis, 8000, false, 'fields.diagnosis'), propositions: parsed,
    assumptions: text(raw.assumptions, 8000, true, 'fields.assumptions'), evidenceGaps: text(raw.evidenceGaps, 8000, true, 'fields.evidenceGaps'), followUp: text(raw.followUp, 8000, true, 'fields.followUp'),
    ...(raw.priorReview !== undefined ? {priorReview: raw.priorReview} : {}),
  };
}
function validateSources(input: unknown): KickoffSourceRef[] {
  if (!Array.isArray(input)) invalid('sources', 'invalid_type');
  if (input.length > 100) invalid('sources', 'too_many');
  return input.map((entry, index) => {
    const base = `sources[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid(base, 'invalid_type');
    const s = entry as Record<string, unknown>;
    const allowed = ['kind', 'ref', 'title', 'fileId', 'sha256'];
    const unknown = Object.keys(s).find(key => !allowed.includes(key));
    if (unknown) invalid(safeChildPath(base, unknown), 'unknown_field');
    if (s.kind === undefined) invalid(`${base}.kind`, 'required');
    if (s.kind !== 'file' && s.kind !== 'public') invalid(`${base}.kind`, 'invalid_source_kind');
    if (s.ref === undefined) invalid(`${base}.ref`, 'required');
    if (typeof s.ref !== 'string') invalid(`${base}.ref`, 'invalid_type');
    if (!s.ref.trim()) invalid(`${base}.ref`, 'required');
    if (s.ref.length > 500) invalid(`${base}.ref`, 'too_long');
    if (s.title !== undefined && typeof s.title !== 'string') invalid(`${base}.title`, 'invalid_type');
    if (typeof s.title === 'string' && s.title.length > 300) invalid(`${base}.title`, 'too_long');
    if (s.sha256 !== undefined && typeof s.sha256 !== 'string') invalid(`${base}.sha256`, 'invalid_type');
    if (typeof s.sha256 === 'string' && !/^[a-f0-9]{64}$/.test(s.sha256)) invalid(`${base}.sha256`, 'invalid_sha256');
    if (s.kind === 'file') {
      if (s.fileId === undefined) invalid(`${base}.fileId`, 'required', 'strategy_kickoff_source_invalid');
      if (typeof s.fileId !== 'string') invalid(`${base}.fileId`, 'invalid_type', 'strategy_kickoff_source_invalid');
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s.fileId)) invalid(`${base}.fileId`, 'invalid_id', 'strategy_kickoff_source_invalid');
      if (s.sha256 === undefined) invalid(`${base}.sha256`, 'required', 'strategy_kickoff_source_invalid');
    }
    return {kind: s.kind, ref: s.ref, ...(s.title !== undefined ? {title: s.title} : {}), ...(s.fileId !== undefined ? {fileId: s.fileId as string} : {}), ...(s.sha256 !== undefined ? {sha256: s.sha256} : {})};
  });
}

type ReportFile = { formatVersion: 1; versions: KickoffReportVersion[]; applications: KickoffApplication[]; proposals: RevisionProposal[] };
type UnavailableKickoffReport = Pick<KickoffReportVersion, 'no' | 'contentSha256' | 'scopeKeys' | 'parent' | 'generation' | 'lock'> & { unavailable: 'scope' };
export type KickoffReportReadback = KickoffReportVersion | UnavailableKickoffReport;
export interface ScopedKickoffReportsView { versions: KickoffReportReadback[]; anchors: Record<string, KickoffAnchor> }

function canReadReport(version: KickoffReportVersion, scopeKeys: string[]): boolean {
  return scopeKeys.every(key => (version.scopeKeys ?? []).includes(key));
}

export class StrategyInitiativeReports {
  private readonly initiatives: StrategyInitiativeStore;
  private readonly files?: { list(id: string, scopeKey?: string): { name: string; directory: string }[]; read(id: string, fileId: string): { file: { sha256: string; scopeKey?: string } } };
  constructor(initiatives: StrategyInitiativeStore, files?: { list(id: string, scopeKey?: string): { name: string; directory: string }[]; read(id: string, fileId: string): { file: { sha256: string; scopeKey?: string } } }) { this.initiatives = initiatives; this.files = files; }
  private assertSources(id: string, sources: KickoffSourceRef[]): void {
    for (const [index, source] of sources.entries()) {
      if (source.kind !== 'file') continue;
      if (!this.files || !source.fileId) invalid(`sources[${index}].fileId`, 'source_unavailable', 'strategy_kickoff_source_invalid', 409);
      if (!source.sha256) invalid(`sources[${index}].sha256`, 'required', 'strategy_kickoff_source_invalid', 409);
      let read;
      try { read = this.files.read(id, source.fileId); } catch { invalid(`sources[${index}].fileId`, 'source_unavailable', 'strategy_kickoff_source_invalid', 409); }
      if (read.file.sha256 !== source.sha256) invalid(`sources[${index}].sha256`, 'source_sha256_mismatch', 'strategy_kickoff_source_invalid', 409);
    }
  }
  private file(id: string) { return path.join(this.initiatives.directory(id), 'reports.json'); }
  private read(id: string): ReportFile {
    const file = this.file(id);
    if (!existsSync(file)) return {formatVersion: 1, versions: [], applications: [], proposals: []};
    const s = lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 2 * 1024 * 1024) throw new StrategyDiscussionFault('strategy_kickoff_unsafe_file');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let x: any;
    try { x = JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
    if (x.formatVersion !== 1 || !Array.isArray(x.versions) || !Array.isArray(x.applications) || x.versions.some((v: any, i: number) => !v || v.no !== i + 1 || typeof v.contentSha256 !== 'string'))
      throw new StrategyDiscussionFault('strategy_kickoff_corrupt');
    if (!Array.isArray(x.proposals)) x.proposals = [];
    return x;
  }
  private write(id: string, value: ReportFile): void {
    const dir = this.initiatives.directory(id);
    const file = this.file(id), temp = path.join(dir, '.' + randomUUID() + '.tmp');
    let renamed = false;
    const contents = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(contents) > 2 * 1024 * 1024) throw new StrategyDiscussionFault('strategy_kickoff_storage_limit', 413);
    try {
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, file); renamed = true;
      const d = openSync(dir, 'r'); try { fsyncSync(d); } finally { closeSync(d); }
    } catch {
      if (!renamed) try { unlinkSync(temp); } catch {}
      throw new StrategyDiscussionFault(renamed ? 'strategy_kickoff_write_unknown' : 'strategy_kickoff_write_failed', 503);
    }
  }
  view(id: string): { versions: KickoffReportVersion[]; anchors: Record<string, KickoffAnchor> } {
    this.initiatives.get(id);
    const {versions, applications} = this.read(id);
    const anchors: Record<string, KickoffAnchor> = {};
    for (const application of applications) anchors[application.scopeKey] = {...application};
    return {versions: structuredClone(versions), anchors};
  }
  private readScopeKeys(id: string, scopeKey?: string): string[] {
    const keys = this.initiatives.get(id).scopes.map(initiativeScopeKey);
    if (scopeKey === undefined) return keys;
    if (!keys.includes(scopeKey)) throw new StrategyDiscussionFault('strategy_initiative_scope_unknown');
    return [scopeKey];
  }
  viewForScope(id: string, scopeKey?: string): ScopedKickoffReportsView {
    const keys = this.readScopeKeys(id, scopeKey);
    const {versions, anchors} = this.view(id);
    return {
      versions: versions.map(version => {
        if (canReadReport(version, keys)) return version;
        const {no, contentSha256, scopeKeys, parent, generation, lock} = version;
        return {no, contentSha256, scopeKeys: scopeKeys ?? [], parent, generation, lock, unavailable: 'scope'};
      }),
      anchors: scopeKey === undefined ? anchors : anchors[scopeKey] ? {[scopeKey]: anchors[scopeKey]!} : {},
    };
  }
  version(id: string, no: number): KickoffReportVersion {
    const {versions} = this.read(id);
    const version = versions.find(v => v.no === no);
    if (!version) throw new StrategyDiscussionFault('strategy_kickoff_version_not_found', 404);
    return version;
  }
  versionForScope(id: string, no: number, scopeKey?: string): KickoffReportVersion {
    const keys = this.readScopeKeys(id, scopeKey);
    const version = this.version(id, no);
    if (!canReadReport(version, keys)) throw new StrategyDiscussionFault('strategy_kickoff_scope_unknown');
    return version;
  }
  save(id: string, input: { operationId: string; fields: KickoffFields; sources?: KickoffSourceRef[]; scopeKeys?: string[]; parent?: number; kind?: 'agent' | 'revision' | 'manual'; requestId?: string }, authorScopeKey?: string): KickoffReportVersion {
    const initiative = this.initiatives.get(id);
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['operationId', 'fields', 'sources', 'scopeKeys', 'parent', 'kind', 'requestId'].includes(key))) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
    if (typeof input.operationId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.operationId)) throw new StrategyDiscussionFault('strategy_kickoff_operation_invalid', 400);
    const fields = validateFields(input.fields), sources = validateSources(input.sources === undefined ? [] : input.sources);
    this.assertSources(id, sources);
    const initiativeKeys = initiative.scopes.map(s => initiativeScopeKey(s));
    let allowed = initiativeKeys;
    if (this.files) {
      for (const [index, source] of sources.entries()) {
        if (source.kind !== 'file' || !source.fileId) continue;
        let file;
        try { file = this.files.read(id, source.fileId).file; } catch { invalid(`sources[${index}].fileId`, 'source_unavailable', 'strategy_kickoff_source_invalid', 409); }
        if (file.scopeKey !== undefined) allowed = allowed.filter(key => key === file.scopeKey);
      }
    }
    const scopeKeys = input.scopeKeys === undefined ? allowed : input.scopeKeys;
    if (!Array.isArray(scopeKeys) || !scopeKeys.length || scopeKeys.some(k => typeof k !== 'string' || !allowed.includes(k))) throw new StrategyDiscussionFault('strategy_kickoff_scope_unknown', 400);
    if (authorScopeKey !== undefined && !scopeKeys.includes(authorScopeKey)) throw new StrategyDiscussionFault('strategy_kickoff_scope_unknown');
    const file = this.read(id);
    const existing = file.versions.find(v => v.generation.operationId === input.operationId);
    const contentSha256 = hash({fields, sources});
    if (existing) {
      if (existing.contentSha256 !== contentSha256 || existing.parent !== input.parent) throw new StrategyDiscussionFault('strategy_kickoff_operation_conflict');
      if (authorScopeKey !== undefined && !(existing.scopeKeys ?? []).includes(authorScopeKey)) throw new StrategyDiscussionFault('strategy_kickoff_scope_unknown');
      return structuredClone(existing);
    }
    if (input.parent !== undefined && (!Number.isSafeInteger(input.parent) || input.parent < 1 || input.parent > file.versions.length)) throw new StrategyDiscussionFault('strategy_kickoff_parent_invalid', 400);
    const kind = input.kind ?? 'manual';
    if (!['agent', 'revision', 'manual'].includes(kind)) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
    const version: KickoffReportVersion = {
      no: file.versions.length + 1, fields, sources, scopeKeys: [...new Set(scopeKeys)], contentSha256,
      ...(input.parent !== undefined ? {parent: input.parent} : {}),
      generation: {operationId: input.operationId, kind, at: new Date().toISOString(), ...(input.requestId ? {requestId: input.requestId} : {})},
    };
    file.versions.push(version);
    this.write(id, file);
    return structuredClone(version);
  }
  lock(id: string, no: number, input: { operationId: string; sha256: string; operator?: string }): KickoffReportVersion {
    this.initiatives.get(id);
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['operationId', 'sha256', 'operator'].includes(key))) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
    if (typeof input.operationId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.operationId)) throw new StrategyDiscussionFault('strategy_kickoff_operation_invalid', 400);
    const file = this.read(id);
    const version = file.versions.find(v => v.no === no);
    if (!version) throw new StrategyDiscussionFault('strategy_kickoff_version_not_found', 404);
    if (typeof input.sha256 !== 'string' || input.sha256 !== version.contentSha256) throw new StrategyDiscussionFault('strategy_kickoff_version_conflict');
    this.assertSources(id, version.sources);
    if (version.lock) {
      if (version.lock.operationId === input.operationId && version.lock.fingerprint === input.sha256) return structuredClone(version);
      throw new StrategyDiscussionFault('strategy_kickoff_already_locked');
    }
    const operator = input.operator === undefined ? '决策者' : input.operator;
    if (typeof operator !== 'string' || !operator.trim() || operator.length > 100) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
    version.lock = {operationId: input.operationId, operator: operator.trim(), at: new Date().toISOString(), fingerprint: version.contentSha256};
    this.write(id, file);
    return structuredClone(version);
  }
  apply(id: string, no: number, input: { operationId: string; sha256: string; scope: GoalScope }): KickoffAnchor {
    const initiative = this.initiatives.get(id);
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['operationId', 'sha256', 'scope'].includes(key))) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
    if (typeof input.operationId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.operationId)) throw new StrategyDiscussionFault('strategy_kickoff_operation_invalid', 400);
    const file = this.read(id);
    const prior = file.applications.find(a => a.operationId === input.operationId);
    if (prior) {
      if (prior.reportNo !== no || prior.contentSha256 !== input.sha256 || prior.scopeKey !== initiativeScopeKey(input.scope as GoalScope)) throw new StrategyDiscussionFault('strategy_kickoff_operation_conflict');
      return {...prior};
    }
    const version = file.versions.find(v => v.no === no);
    if (!version) throw new StrategyDiscussionFault('strategy_kickoff_version_not_found', 404);
    if (!version.lock) throw new StrategyDiscussionFault('strategy_kickoff_not_locked');
    if (typeof input.sha256 !== 'string' || input.sha256 !== version.contentSha256 || version.lock.fingerprint !== input.sha256) throw new StrategyDiscussionFault('strategy_kickoff_version_conflict');
    const scope = input.scope;
    if (!scope || !initiative.scopes.some(s => initiativeScopeKey(s) === initiativeScopeKey(scope))) throw new StrategyDiscussionFault('strategy_initiative_scope_unknown');
    if (!version.scopeKeys.includes(initiativeScopeKey(scope))) throw new StrategyDiscussionFault('strategy_kickoff_scope_unknown');
    this.assertSources(id, version.sources);
    const application: KickoffApplication = {operationId: input.operationId, scopeKey: initiativeScopeKey(scope), scope, reportNo: no, contentSha256: version.contentSha256, at: new Date().toISOString()};
    file.applications.push(application);
    this.write(id, file);
    return {...application};
  }
  anchor(id: string, scope: GoalScope): KickoffAnchor | undefined {
    const {anchors} = this.view(id);
    return anchors[initiativeScopeKey(scope)];
  }
  revise(id: string, no: number, input: { operationId: string; baseSha256: string; request: string; patches: { blockId: string; expectedOldSha256: string; newText: string }[]; proposalId?: string }): KickoffReportVersion {
    this.initiatives.get(id);
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['operationId', 'baseSha256', 'request', 'patches', 'proposalId'].includes(key))) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
    if (typeof input.operationId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.operationId)) throw new StrategyDiscussionFault('strategy_kickoff_operation_invalid', 400);
    if (typeof input.request !== 'string' || !input.request.trim() || input.request.length > 2000) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
    if (!Array.isArray(input.patches) || input.patches.length < 1 || input.patches.length > 20) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
    const file = this.read(id);
    const base = file.versions.find(v => v.no === no);
    if (!base) throw new StrategyDiscussionFault('strategy_kickoff_version_not_found', 404);
    const prior = file.versions.find(v => v.revision?.operationId === input.operationId);
    if (prior) {
      if (prior.parent !== no || prior.revision!.request !== input.request || hash(prior.revision!.patches) !== hash(input.patches.map(p => ({blockId: p.blockId, oldSha256: p.expectedOldSha256, newSha256: createHash('sha256').update(String(p.newText ?? '')).digest('hex')})))) throw new StrategyDiscussionFault('strategy_kickoff_operation_conflict');
      return structuredClone(prior);
    }
    if (typeof input.baseSha256 !== 'string' || input.baseSha256 !== base.contentSha256) throw new StrategyDiscussionFault('strategy_kickoff_version_conflict');
    if (input.proposalId !== undefined) {
      const proposal = file.proposals.find(p => p.proposalId === input.proposalId);
      if (!proposal || proposal.status !== 'proposed' || proposal.target.kind !== 'report' || proposal.target.no !== no || input.patches.length !== 1 || input.patches[0]!.blockId !== proposal.blockId || input.patches[0]!.newText !== proposal.newText) throw new StrategyDiscussionFault('strategy_proposal_unavailable');
    }
    const fields = structuredClone(base.fields);
    const applied: { blockId: string; oldSha256: string; newSha256: string }[] = [];
    const seen = new Set<string>();
    for (const patch of input.patches) {
      if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !['blockId', 'expectedOldSha256', 'newText'].includes(key))) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
      if (typeof patch.blockId !== 'string' || seen.has(patch.blockId)) throw new StrategyDiscussionFault('strategy_kickoff_patch_target_invalid', 400);
      seen.add(patch.blockId);
      if (typeof patch.newText !== 'string' || !patch.newText.trim() || patch.newText.length > 8000) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
      const segments = patch.blockId.split(':');
      let current: string | undefined;
      let assign: (value: string) => void;
      if (segments.length === 1 && ['horizon', 'diagnosis', 'assumptions', 'evidenceGaps', 'followUp'].includes(segments[0]!)) {
        const key = segments[0] as 'horizon' | 'diagnosis' | 'assumptions' | 'evidenceGaps' | 'followUp';
        current = fields[key];
        assign = value => { fields[key] = value; };
      } else if (segments.length === 3 && segments[0] === 'proposition' && ['question', 'whyItMatters', 'evidence', 'gaps'].includes(segments[2]!)) {
        const proposition = fields.propositions.find(p => p.id === segments[1]);
        if (!proposition) throw new StrategyDiscussionFault('strategy_kickoff_patch_target_invalid', 400);
        const key = segments[2] as 'question' | 'whyItMatters' | 'evidence' | 'gaps';
        current = proposition[key];
        assign = value => { proposition[key] = value; };
      } else {
        throw new StrategyDiscussionFault('strategy_kickoff_patch_target_invalid', 400);
      }
      const oldSha256 = createHash('sha256').update(current ?? '').digest('hex');
      if (typeof patch.expectedOldSha256 !== 'string' || patch.expectedOldSha256 !== oldSha256) throw new StrategyDiscussionFault('strategy_kickoff_old_value_conflict');
      assign(patch.newText);
      applied.push({blockId: patch.blockId, oldSha256, newSha256: createHash('sha256').update(patch.newText).digest('hex')});
    }
    const validated = validateFields(fields);
    this.assertSources(id, base.sources);
    const now = new Date().toISOString();
    const version: KickoffReportVersion = {
      no: file.versions.length + 1, fields: validated, sources: structuredClone(base.sources), scopeKeys: structuredClone(base.scopeKeys), contentSha256: hash({fields: validated, sources: base.sources}),
      parent: no, generation: {operationId: input.operationId, kind: 'revision', at: now},
      revision: {operationId: input.operationId, request: input.request, baseNo: no, patches: applied, at: now},
    };
    file.versions.push(version);
    this.write(id, file);
    if (input.proposalId) this.markAdopted(id, input.proposalId);
    return structuredClone(version);
  }
  createProposal(id: string, no: number, input: { operationId: string; blockId: string; request: string }): RevisionProposal {
    this.initiatives.get(id);
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['operationId', 'blockId', 'request'].includes(key))) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
    if (typeof input.operationId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.operationId)) throw new StrategyDiscussionFault('strategy_kickoff_operation_invalid', 400);
    if (typeof input.request !== 'string' || !input.request.trim() || input.request.length > 2000) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
    const file = this.read(id);
    const existing = file.proposals.find(p => p.proposalId === input.operationId);
    if (existing) {
      if (existing.target.kind !== 'report' || existing.target.no !== no || existing.blockId !== input.blockId || existing.request !== input.request) throw new StrategyDiscussionFault('strategy_kickoff_operation_conflict');
      return structuredClone(existing);
    }
    const version = file.versions.find(v => v.no === no);
    if (!version) throw new StrategyDiscussionFault('strategy_kickoff_version_not_found', 404);
    const baseline = reportBlockText(version.fields, input.blockId);
    if (baseline === undefined) throw new StrategyDiscussionFault('strategy_kickoff_patch_target_invalid', 400);
    const now = new Date().toISOString();
    const proposal: RevisionProposal = {proposalId: input.operationId, initiativeId: id, target: {kind: 'report', no}, blockId: input.blockId, request: input.request, baselineSha256: createHash('sha256').update(baseline).digest('hex'), status: 'pending', at: now, updatedAt: now};
    file.proposals.push(proposal);
    this.write(id, file);
    return structuredClone(proposal);
  }
  proposal(id: string, proposalId: string): RevisionProposal | undefined {
    return structuredClone(this.read(id).proposals.find(p => p.proposalId === proposalId));
  }
  markProposed(id: string, proposalId: string, newText: string, requestId: string): RevisionProposal {
    const file = this.read(id);
    const proposal = file.proposals.find(p => p.proposalId === proposalId);
    if (!proposal || proposal.status !== 'pending') throw new StrategyDiscussionFault('strategy_proposal_unavailable');
    if (typeof newText !== 'string' || !newText.trim() || newText.length > 8000) throw new StrategyDiscussionFault('strategy_kickoff_fields_invalid', 400);
    proposal.newText = newText;
    proposal.status = 'proposed';
    proposal.requestId = requestId;
    proposal.updatedAt = new Date().toISOString();
    this.write(id, file);
    return structuredClone(proposal);
  }
  markAdopted(id: string, proposalId: string): void {
    const file = this.read(id);
    const proposal = file.proposals.find(p => p.proposalId === proposalId);
    if (!proposal || proposal.status !== 'proposed') throw new StrategyDiscussionFault('strategy_proposal_unavailable');
    proposal.status = 'adopted';
    proposal.updatedAt = new Date().toISOString();
    this.write(id, file);
  }
  markTerminal(id: string, proposalId: string, status: 'ended' | 'failed', feedback?: import('./strategy-initiative-types.ts').RevisionProposalFeedback): void {
    const file = this.read(id);
    const proposal = file.proposals.find(p => p.proposalId === proposalId);
    if (!proposal || proposal.status !== 'pending') return;
    proposal.status = status;
    if (feedback) {
      proposal.requestId = feedback.requestId;
      proposal.feedback = structuredClone(feedback);
    }
    proposal.updatedAt = new Date().toISOString();
    this.write(id, file);
  }
}
export function reportBlockText(fields: KickoffFields, blockId: string): string | undefined {
  const segments = blockId.split(':');
  if (segments.length === 1 && ['horizon', 'diagnosis', 'assumptions', 'evidenceGaps', 'followUp'].includes(segments[0]!)) return fields[segments[0] as 'horizon' | 'diagnosis' | 'assumptions' | 'evidenceGaps' | 'followUp'];
  if (segments.length === 3 && segments[0] === 'proposition' && ['question', 'whyItMatters', 'evidence', 'gaps'].includes(segments[2]!)) {
    const proposition = fields.propositions.find(p => p.id === segments[1]);
    return proposition ? proposition[segments[2] as 'question' | 'whyItMatters' | 'evidence' | 'gaps'] : undefined;
  }
  return undefined;
}
export function reportBlockCatalog(fields: KickoffFields): { blockId: string; label: string }[] {
  const labels: Record<'horizon' | 'diagnosis' | 'assumptions' | 'evidenceGaps' | 'followUp', string> = {
    horizon: '时间视野', diagnosis: '诊断摘要', assumptions: '事实与假设', evidenceGaps: '证据缺口', followUp: '后续方案形成要求',
  };
  const items: { blockId: string; label: string }[] = (['horizon', 'diagnosis', 'assumptions', 'evidenceGaps', 'followUp'] as const).map(key => ({blockId: key, label: labels[key]}));
  for (const proposition of fields.propositions) {
    items.push({blockId: `proposition:${proposition.id}:question`, label: `命题 ${proposition.id} · 关键问题`});
    items.push({blockId: `proposition:${proposition.id}:whyItMatters`, label: `命题 ${proposition.id} · 为何影响选择`});
    if (proposition.evidence !== undefined) items.push({blockId: `proposition:${proposition.id}:evidence`, label: `命题 ${proposition.id} · 依据`});
    if (proposition.gaps !== undefined) items.push({blockId: `proposition:${proposition.id}:gaps`, label: `命题 ${proposition.id} · 缺口`});
  }
  return items;
}
