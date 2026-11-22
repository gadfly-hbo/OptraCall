import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ProjectStore } from './project-store.ts';
import type { EnterpriseScopeStore } from './enterprise-scope-store.ts';
import type { CaseStore } from './case-store.ts';
import type { StudioStore } from '../../extensions/business-plugins/studio/store.ts';
import { studioExecutionOwner, type StudioSourceRef, type StudioUseAssessment, type StudioUseRecord } from '../../extensions/business-plugins/studio/contracts.ts';
import type { ProjectSnapshot } from '../agent/project-runtime.ts';
import { StudioError, object, text, uuid, sourceRef, sources as parseSources, digest } from '../../extensions/business-plugins/studio/validation.ts';
import {
  evaluateResourceAccess,
  isGrantActive,
  sameExactSourceRef,
  type DomainReferenceDomain,
  type EnterpriseDomainPack,
  type EnterprisePackDependency,
  type EnterprisePackFeedbackItemVerification,
  type EnterprisePackFeedbackSourceRead,
  type EnterprisePackOriginalCaseRef,
  type EnterprisePackPreview,
  type EnterprisePackReadEvidence,
  type EnterprisePackUseRecord,
  type FeedbackAdoptionBasis,
  type PackFeedbackCategory,
  type PackModulePublicationReceipt,
  type ResourceAccessQuery,
  type ResourceGrantOperation,
} from '../../extensions/business-plugins/studio/enterprise-pack.ts';
import { DomainReferenceStore, BUILTIN_REPO_TEMPLATES } from './domain-reference-store.ts';
import { ResourceGrantStore } from './resource-grant-store.ts';
import { EnterprisePackStore } from './enterprise-pack-store.ts';
import { buildAuthorizedDataView, isPeriodCovered, type AuthorizedDataPurpose } from './member-pack-data-view.ts';
import { collectNativeEvidence, exactTaskReport, nativeAssessmentEvidence, projectFileLocator, qualifyAssessmentClaims, readCoversSource, readNativeFileEvidence, readStudioEvidence, studioPagesComplete } from './member-pack-verification.ts';
import { createProtectedExecutionScope, type ProtectedExecutionScope } from '../agent/protected-tools.ts';

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

export interface AuthorityPublicationOutcome {
  status: 'succeeded' | 'failed' | 'unknown';
  detail: string;
  authorityOperationId?: string;
  authorityPublishedBy?: string;
}

export interface VerifiedSummaryAuthority {
  summaryAssetId: string;
  summaryVersion: string;
  summaryAuthority: string;
  summarySha256: string;
  verifiedScopeSummary: string;
  ownerProjectId?: string;
  ownerSystemId?: string;
  resourceRef: StudioSourceRef;
}

export interface TrustedHostOperator {
  operatorId: string;
  displayName?: string;
  activeProjectId?: string;
  authorityProjectId?: string;
  verified: boolean;
}

export interface ProjectMemberPackFileScope {
  mode: 'deny-detail' | 'allowlist';
  enterpriseId: string;
  projectId: string;
  allowedPaths: string[];
  allowedStores: string[];
  osSandboxAvailable: boolean;
  summary: string;
}

export interface RestrictedTaskWorkspace {
  workspaceRoot: string;
  cleanDir: string;
  reportsDir: string;
  workDir: string;
  committedReportsDir: string;
  projectRoot: string;
  osSandboxAvailable: boolean;
  scope: ProjectMemberPackFileScope;
  policyFingerprint: string;
  contextStartAt: number;
  protectedScope: ProtectedExecutionScope;
}

export interface GrantAuthorityCredential {
  enterpriseId: string;
  systemId: string;
  ownerProjectId: string;
  ownerTaskId?: string;
  operatorId?: string;
  authorityToken: string;
}

interface TaskReportLedgerEntry {
  projectId: string;
  ownerTaskId: string;
  relativePath: string;
  sha256: string;
  bytesLength: number;
  committedAt: string;
}

interface TaskSyncedReportEntry {
  sha256: string;
  effectiveRelativePath: string;
  committedAt: string;
  revisions?: { sha256: string; effectiveRelativePath: string; committedAt: string }[];
}

interface TaskReportLedger {
  projectFiles: Record<string, TaskReportLedgerEntry>;
  taskSyncedFiles: Record<string, TaskSyncedReportEntry>;
}

export interface MemberPackHostOptions {
  dataRoot: string;
  codeRoot?: string;
  memberPackEnabled?: boolean;
  projects: ProjectStore;
  enterpriseScopes: EnterpriseScopeStore;
  cases?: CaseStore;
  studio: StudioStore;
  operations: { run: (requestId: string, fingerprintInput: unknown, operation: () => Promise<{ statusCode?: number; result: Record<string, unknown>; systemId?: string }>) => Promise<{ statusCode?: number; result?: Record<string, unknown> }> };
  readBody(request: IncomingMessage, limit?: number): Promise<Record<string, unknown>>;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>;
  closing(): boolean;
  resolveRequestOperator?(request: IncomingMessage): TrustedHostOperator;
  manageOperatorSession?(request: IncomingMessage, response: ServerResponse, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
  onProjectPermissionChanged?(projectId: string): void;
  taskSnapshot?(projectId: string, taskId: string): Promise<ProjectSnapshot>;
  readTaskReply(projectId: string, taskId: string, selection: { sessionId: string; messageId: string }): Promise<{ text: string }>;
  publishAuthorityDependency?: (pack: EnterpriseDomainPack, preview: EnterprisePackPreview, dep: EnterprisePackDependency, requestId: string) => Promise<AuthorityPublicationOutcome>;
  inspectAuthorityDependency?: (pack: EnterpriseDomainPack, ref: StudioSourceRef, originalReceipt?: PackModulePublicationReceipt) => Promise<AuthorityPublicationOutcome>;
  verifySummaryAuthority?: (enterpriseId: string, scope: { summaryAssetId?: string; summaryVersion?: string; resourceRef?: StudioSourceRef; grain?: string; periodFrom?: string; periodTo?: string }) => Promise<VerifiedSummaryAuthority>;
}

function extractTaskCutoffFromText(rawText: string): string | undefined {
  // Never match injected JSON metadata keys like "dataCutoffAt":"2026-10-31"
  const cleaned = rawText.replace(/"(?:pack)?[dD]ataCutoffAt"\s*:\s*"[^"]*"/g, '');
  // Match explicit Chinese/ISO date near 截止 / 截至 / cutoff
  const cnMatch = /(?:数据截止|截止日|截止|截至|cutoff)[^\n\d"]{0,12}(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/i.exec(cleaned);
  if (cnMatch) {
    return `${cnMatch[1]}-${cnMatch[2]!.padStart(2, '0')}-${cnMatch[3]!.padStart(2, '0')}`;
  }
  const isoMatch = /(?:数据截止|截止日|截止|截至|cutoff)[^\n\d"]{0,12}(\d{4}-\d{2}-\d{2})/i.exec(cleaned);
  if (isoMatch) return isoMatch[1]!;
  return undefined;
}

function messageText(msg: Record<string, unknown> | undefined): string {
  if (!msg) return '';
  if (msg.role === 'user' && typeof msg.originalUserText === 'string') return msg.originalUserText;
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map(block => (block && typeof block === 'object' && 'text' in block && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : ''))
      .join('\n');
  }
  return '';
}

function normalizeRelativeDataPath(rawPath: string): string {
  const cleaned = rawPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  return cleaned;
}

function ensurePrivateDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dirPath, 0o700); } catch { /* ignore if not owner */ }
}

function hasOsSandboxAvailable(): boolean {
  return process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec');
}

export function createMemberPackFeature(options: MemberPackHostOptions) {
  const enabled = options.memberPackEnabled !== false;
  const references = new DomainReferenceStore(options.dataRoot, options.codeRoot ?? process.cwd(), { readOnlyMode: !enabled });
  const grants = new ResourceGrantStore(options.dataRoot, { readOnlyMode: !enabled });
  const packs = new EnterprisePackStore(options.dataRoot, { readOnlyMode: !enabled });
  const activeWorkspaces = new Map<string, Map<string, RestrictedTaskWorkspace>>();
  const reportLedgerPath = path.join(options.dataRoot, 'member-packs', 'task-report-ledger.json');
  const authoritySecretPath = path.join(options.dataRoot, 'member-packs', '.authority-secret');
  const operatorBindingsPath = path.join(options.dataRoot, 'member-packs', 'operator-bindings.json');
  const preservedReportsRoot = path.join(options.dataRoot, 'member-packs', 'preserved-reports');
  let cachedAuthoritySecret: Buffer | undefined;

  function resolveRequestOperator(request: IncomingMessage): TrustedHostOperator {
    if (options.resolveRequestOperator) return options.resolveRequestOperator(request);
    return { operatorId: 'local:host', verified: true };
  }

  function readOperatorBindings(): Record<string, string> {
    try {
      if (fs.existsSync(operatorBindingsPath)) {
        const parsed = JSON.parse(fs.readFileSync(operatorBindingsPath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, string>;
      }
    } catch { /* ignore */ }
    return {};
  }

  function bindSystemOperator(systemId: string, operatorId: string) {
    if (!enabled || !operatorId.trim()) return;
    const bindings = readOperatorBindings();
    if (bindings[systemId]) return;
    bindings[systemId] = operatorId.trim();
    ensurePrivateDir(path.dirname(operatorBindingsPath));
    const tmp = `${operatorBindingsPath}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(bindings, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, operatorBindingsPath);
  }

  function getBoundSystemOperator(systemId?: string): string | undefined {
    if (!systemId) return undefined;
    return readOperatorBindings()[systemId];
  }

  function preserveImmutableReportSnapshot(projectId: string, locator: string, bytes: Buffer, sha256?: string): string {
    const actualSha = sha256 ?? createHash('sha256').update(bytes).digest('hex');
    if (!enabled) return actualSha;
    try {
      const pid = uuid(projectId);
      const dir = path.resolve(preservedReportsRoot, pid);
      ensurePrivateDir(dir);
      const target = path.join(dir, `${actualSha}.bin`);
      if (!fs.existsSync(target)) {
        const tmp = `${target}.${randomUUID()}.tmp`;
        fs.writeFileSync(tmp, bytes, { mode: 0o400 });
        fs.renameSync(tmp, target);
      }
      const metaTarget = path.join(dir, `${actualSha}.meta.json`);
      if (!fs.existsSync(metaTarget)) {
        fs.writeFileSync(metaTarget, JSON.stringify({ projectId: pid, locator: normalizeRelativeDataPath(locator), sha256: actualSha, bytesLength: bytes.length, preservedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
      }
    } catch { /* never fail caller */ }
    return actualSha;
  }

  function readPreservedReportBytes(projectId: string, taskId: string, locator: string, expectedSha256?: string): Buffer | undefined {
    try {
      const pid = uuid(projectId);
      if (expectedSha256 && /^[a-f0-9]{64}$/i.test(expectedSha256)) {
        const snapPath = path.resolve(preservedReportsRoot, pid, `${expectedSha256.toLowerCase()}.bin`);
        if (snapPath.startsWith(path.resolve(preservedReportsRoot) + path.sep) && fs.existsSync(snapPath)) {
          const bytes = fs.readFileSync(snapPath);
          if (createHash('sha256').update(bytes).digest('hex') === expectedSha256.toLowerCase()) {
            return bytes;
          }
        }
      }
      if (locator.startsWith('060_reports/')) {
        const resolvedLoc = resolveTaskReportLocator(pid, taskId, locator, expectedSha256);
        const rel = normalizeRelativeDataPath(resolvedLoc.slice('060_reports/'.length));
        const ledger = readReportLedger();
        const entry = ledger.projectFiles[`${pid}:${rel}`];
        if (entry && (!expectedSha256 || entry.sha256 === expectedSha256)) {
          const snapPath = path.resolve(preservedReportsRoot, pid, `${entry.sha256}.bin`);
          if (fs.existsSync(snapPath)) return fs.readFileSync(snapPath);
        }
      }
    } catch { /* ignore */ }
    return undefined;
  }

  function projectGrants(enterpriseId: string, projectId: string) {
    return grants.listForSubject(enterpriseId, projectId).filter(grant => grant.subjectType === 'project');
  }

  function projectPermissionFingerprint(projectId: string): string {
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return `unscoped:${enabled ? '1' : '0'}`;
    const nowMs = Date.now();
    // Do NOT hash activeRev here: publishing v1.1 must never disrupt or re-gear unaffected tasks pinned to v1.0!
    const activePacks = packs.list(enterpriseId).map(p => ({
      id: p.id,
      owner: isConstructionOwnerProject(p, projectId),
    }));
    const subjectGrants = projectGrants(enterpriseId, projectId)
      .filter(grant => isGrantActive(grant, nowMs))
      .map(({ id, operations, scope, purposeKeys, resourceRef }) => ({ id, operations, scope, purposeKeys, resourceRef }));
    return createHash('sha256')
      .update(JSON.stringify({ enabled, enterpriseId, activePacks, subjectGrants }))
      .digest('hex');
  }

  function currentTaskPolicyStart(projectId: string, taskId: string): number | undefined {
    const policyFile = path.resolve(options.dataRoot, 'member-pack-workspaces', uuid(projectId), uuid(taskId), '.policy');
    try {
      const [fingerprint, start] = fs.readFileSync(policyFile, 'utf8').split('\n');
      const since = Number(start);
      if (fingerprint === projectPermissionFingerprint(projectId) && Number.isSafeInteger(since) && since > 0) return since;
    } catch { /* A missing or unreadable receipt cannot attest to current scope. */ }
    return undefined;
  }

  function presentTaskHistory(projectId: string, taskId: string, snapshot: ProjectSnapshot): ProjectSnapshot {
    if (!getProjectToolScope(projectId) || !snapshot.messages.length) return snapshot;
    const since = currentTaskPolicyStart(projectId, taskId);
    const messages = snapshot.messages.map(message => {
      if (message.role === 'user') return message;
      const stamp = typeof message.timestamp === 'number' ? message.timestamp : Date.parse(message.timestamp ?? message.createdAt ?? '');
      if (since !== undefined && stamp >= since) return message;
      return {
        role: message.role,
        timestamp: message.timestamp,
        nativeSessionId: message.nativeSessionId,
        nativeEntryId: message.nativeEntryId,
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        content: [{ type: 'text', text: '此条历史内容按原权限保留，当前权限未能核对。' }],
      };
    });
    return { ...snapshot, messages };
  }

  function assertCurrentReportFile(projectId: string, locator: string, sha: string) {
    if (!getProjectToolScope(projectId)) return;
    const report = readReportLedger().projectFiles[`${projectId}:${locator.slice('060_reports/'.length)}`];
    if (!report || report.sha256 !== sha) return;
    const since = currentTaskPolicyStart(projectId, report.ownerTaskId);
    if (since === undefined || Date.parse(report.committedAt) < since) {
      throw new StudioError('member_pack_report_current_authority_required', 403);
    }
  }

  function nextProjectGrantExpiry(projectId: string): number | undefined {
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return undefined;
    const at = Date.now();
    const next = projectGrants(enterpriseId, projectId)
      .filter(grant => grant.validTo && isGrantActive(grant, at))
      .map(grant => Date.parse(grant.validTo!) + 1)
      .sort((a, b) => a - b)[0];
    return Number.isFinite(next) ? next : undefined;
  }

  function getAuthoritySecret(): Buffer {
    if (cachedAuthoritySecret) return cachedAuthoritySecret;
    try {
      if (fs.existsSync(authoritySecretPath)) {
        const raw = fs.readFileSync(authoritySecretPath, 'utf8').trim();
        if (/^[a-f0-9]{64}$/i.test(raw)) {
          cachedAuthoritySecret = Buffer.from(raw, 'hex');
          return cachedAuthoritySecret;
        }
      }
    } catch { /* generate fresh secret */ }
    const fresh = randomBytes(32);
    cachedAuthoritySecret = fresh;
    if (enabled) {
      try {
        ensurePrivateDir(path.dirname(authoritySecretPath));
        const tmp = `${authoritySecretPath}.${randomUUID()}.tmp`;
        fs.writeFileSync(tmp, fresh.toString('hex') + '\n', { mode: 0o600 });
        fs.renameSync(tmp, authoritySecretPath);
      } catch { /* keep in-memory secret */ }
    }
    return fresh;
  }

  function mintGrantAuthorityCredential(input: {
    enterpriseId: string;
    systemId: string;
    ownerProjectId: string;
    ownerTaskId?: string;
    operatorId?: string;
  }): GrantAuthorityCredential {
    const op = input.operatorId?.trim() || 'local:host';
    const payload = `${input.enterpriseId}:${input.systemId}:${input.ownerProjectId}:${input.ownerTaskId ?? ''}:${op}`;
    const authorityToken = createHmac('sha256', getAuthoritySecret()).update(payload).digest('hex');
    return {
      enterpriseId: input.enterpriseId,
      systemId: input.systemId,
      ownerProjectId: input.ownerProjectId,
      ...(input.ownerTaskId ? { ownerTaskId: input.ownerTaskId } : {}),
      operatorId: op,
      authorityToken,
    };
  }

  function verifyGrantAuthorityCredential(
    token: unknown,
    expected: { enterpriseId: string; systemId?: string; ownerProjectId: string; ownerTaskId?: string; operatorId: string },
  ): boolean {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token.trim())) return false;
    if (!expected.systemId || !expected.operatorId.trim()) return false;
    const candidate = Buffer.from(token.trim().toLowerCase(), 'hex');
    const checks = [
      mintGrantAuthorityCredential({
        enterpriseId: expected.enterpriseId,
        systemId: expected.systemId,
        ownerProjectId: expected.ownerProjectId,
        ownerTaskId: expected.ownerTaskId,
        operatorId: expected.operatorId,
      }).authorityToken,
      ...(expected.ownerTaskId ? [
        mintGrantAuthorityCredential({
          enterpriseId: expected.enterpriseId,
          systemId: expected.systemId,
          ownerProjectId: expected.ownerProjectId,
          operatorId: expected.operatorId,
        }).authorityToken,
      ] : []),
    ];
    for (const expectedHex of checks) {
      const expectedBuf = Buffer.from(expectedHex, 'hex');
      if (candidate.length === expectedBuf.length && timingSafeEqual(candidate, expectedBuf)) {
        return true;
      }
    }
    return false;
  }

  function readReportLedger(): TaskReportLedger {
    try {
      if (fs.existsSync(reportLedgerPath)) {
        const parsed = JSON.parse(fs.readFileSync(reportLedgerPath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          return {
            projectFiles: object(parsed.projectFiles) ? (parsed.projectFiles as Record<string, TaskReportLedgerEntry>) : {},
            taskSyncedFiles: object(parsed.taskSyncedFiles) ? (parsed.taskSyncedFiles as TaskReportLedger['taskSyncedFiles']) : {},
          };
        }
      }
    } catch { /* fallback to empty ledger */ }
    return { projectFiles: {}, taskSyncedFiles: {} };
  }

  function writeReportLedger(ledger: TaskReportLedger) {
    if (!enabled) return;
    fs.mkdirSync(path.dirname(reportLedgerPath), { recursive: true });
    const tmp = `${reportLedgerPath}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
    fs.renameSync(tmp, reportLedgerPath);
  }

  function isReportLockedByUseOrFeedback(projectId: string, locator: string, candidateSha: string): boolean {
    const normLoc = normalizeRelativeDataPath(locator);
    const matchRef = (ref: StudioSourceRef | undefined) => {
      if (!ref || ref.projectId !== projectId || !ref.locator) return false;
      if (normalizeRelativeDataPath(ref.locator) !== normLoc) return false;
      return !ref.sha256 || ref.sha256 !== candidateSha;
    };
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    for (const pack of packs.list(enterpriseId)) {
      if (pack.useRecords.some(u => matchRef(u.reportRef) || matchRef(u.independentVerification.assessmentReportRef))) {
        return true;
      }
      if (pack.feedbackItems.some(f => f.reports.some(r => matchRef(r.reportRef)))) {
        return true;
      }
    }
    for (const sys of options.studio.list()) {
      if (sys.uses.some(u => matchRef(u.report) || (u.assessments ?? []).some(a => matchRef(a.report)))) {
        return true;
      }
      if (sys.feedback.some(f => f.sources.some(s => matchRef(s)))) {
        return true;
      }
      if ((sys.contributions ?? []).some(c => c.revisions.some(rev => matchRef(rev.report)))) {
        return true;
      }
    }
    return false;
  }

  function assertEnabledWritable() {
    if (!enabled) throw new StudioError('member_pack_disabled_readonly', 503);
  }

  async function assertWritableProject(projectId: string, enterpriseId: string) {
    const project = await options.projects.get(uuid(projectId));
    if (project.archivedAt !== null) throw new StudioError('studio_project_read_only', 409);
    const ownerEnterprise = options.enterpriseScopes.enterpriseIdForProject(project.id);
    if (ownerEnterprise !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
    return project;
  }

  function activeOperatorProject(operator: TrustedHostOperator): string | undefined {
    return operator.verified && operator.operatorId.trim()
      ? operator.activeProjectId ?? operator.authorityProjectId
      : undefined;
  }

  function assertOperatorProject(operator: TrustedHostOperator, projectId: string) {
    if (activeOperatorProject(operator) !== projectId) throw new StudioError('member_pack_operator_context_required', 403);
  }

  function hasSystemAuthority(systemId: string, projectId: string, operator: TrustedHostOperator): boolean {
    const bound = getBoundSystemOperator(systemId);
    return activeOperatorProject(operator) === projectId
      && (bound ? bound === operator.operatorId : operator.authorityProjectId === projectId);
  }

  function canReadConstructionPack(pack: EnterpriseDomainPack, projectId: string, operator: TrustedHostOperator) {
    return isConstructionOwnerProject(pack, projectId) && hasSystemAuthority(pack.systemId, projectId, operator);
  }

  async function assertWritablePackProject(pack: EnterpriseDomainPack, operator: TrustedHostOperator, requestedProjectId?: unknown) {
    const target = requestedProjectId === undefined ? activeOperatorProject(operator) : uuid(requestedProjectId);
    if (!target || !hasSystemAuthority(pack.systemId, target, operator)) throw new StudioError('member_pack_construction_authority_required', 403);
    const project = await assertWritableProject(target, pack.enterpriseId);
    const ownerProjectId = pack.activeOwnerProjectId ?? studioExecutionOwner(options.studio.get(pack.systemId)).projectId;
    if (ownerProjectId !== target && (await options.projects.get(ownerProjectId)).archivedAt === null) {
      throw new StudioError('member_pack_construction_authority_required', 403);
    }
    return project;
  }

  async function packReaderProject(operator: TrustedHostOperator, requestedProjectId: string | null, enterpriseId?: string) {
    const projectId = activeOperatorProject(operator);
    if (requestedProjectId && projectId && uuid(requestedProjectId) !== projectId) throw new StudioError('member_pack_operator_context_required', 403);
    if (!projectId) return undefined;
    await options.projects.get(projectId);
    const projectEnterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (enterpriseId && projectEnterpriseId !== enterpriseId) {
      if (requestedProjectId) throw new StudioError('studio_owner_mismatch', 403);
      return undefined;
    }
    return { projectId, enterpriseId: projectEnterpriseId };
  }

  function scopedPack(pack: EnterpriseDomainPack, projectId: string, operator: TrustedHostOperator) {
    return canReadConstructionPack(pack, projectId, operator) ? pack : redactPackForConsumer(pack, projectId);
  }

  function isConstructionOwnerProject(pack: EnterpriseDomainPack, projectId: string): boolean {
    if (pack.activeOwnerProjectId === projectId) return true;
    try {
      const system = options.studio.get(pack.systemId);
      const owner = studioExecutionOwner(system);
      return owner.projectId === projectId;
    } catch {
      return false;
    }
  }

  function getProjectToolScope(projectId: string): ProjectMemberPackFileScope | undefined {
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return undefined;
    const enterprisePacks = packs.list(enterpriseId);
    const subjectGrants = projectGrants(enterpriseId, projectId);
    // Preserve ordinary unmanaged project behavior when no member pack and no resource grants exist for this enterprise/project.
    if (!subjectGrants.length && !enterprisePacks.length) return undefined;
    // Active Studio construction owner projects without subject grants keep their construction workspace.
    if (
      !subjectGrants.length
      && (
        enterprisePacks.some(p => isConstructionOwnerProject(p, projectId))
        || options.studio.list().some(s => s.enterpriseId === enterpriseId && studioExecutionOwner(s).projectId === projectId)
      )
    ) {
      return undefined;
    }

    const nowMs = Date.now();
    const activeDetailGrants = subjectGrants.filter(g =>
      !g.revokedAt
      && (!g.validFrom || Date.parse(g.validFrom) <= nowMs)
      && (!g.validTo || Date.parse(g.validTo) >= nowMs)
      && g.operations.includes('read-detail-recalculate'),
    );
    const allowedPaths = [...new Set(activeDetailGrants.flatMap(g => (g.scope.allowedDataPaths ?? []).map(normalizeRelativeDataPath)))];
    const allowedStores = [...new Set(activeDetailGrants.flatMap(g => g.scope.stores ?? []))];
    const osSandboxAvailable = enabled && hasOsSandboxAvailable();
    // Default-deny detail access whenever there are no active detail grants OR when allowedDataPaths was omitted!
    if (!activeDetailGrants.length || allowedPaths.length === 0) {
      return {
        mode: 'deny-detail',
        enterpriseId,
        projectId,
        allowedPaths: [],
        allowedStores,
        osSandboxAvailable,
        summary: !activeDetailGrants.length
          ? 'detail_access_not_authorized: 当前项目仅获定义/汇总授权或明细授权已撤回，禁止读取项目 020_clean 明细文件（不可将不可读门店视为 0）。'
          : 'store_detail_not_authorized: 当前明细重算授权未配置 allowedDataPaths 白名单路径，默认拒绝读取项目 020_clean 明细文件（不可将不可读门店视为 0）。',
      };
    }
    return {
      mode: 'allowlist',
      enterpriseId,
      projectId,
      allowedPaths,
      allowedStores,
      osSandboxAvailable,
      summary: osSandboxAvailable
        ? `当前项目仅获准读取指定明细路径：${allowedPaths.join('、')}${allowedStores.length ? `（获准门店：${allowedStores.join('、')}）` : ''}；未授权门店与文件不可读取，且不可视为 0。`
        : `当前运行环境缺少操作系统受管隔离边界（sandbox-exec 不可用），已禁用原生文件系统/Shell 执行工具并停止复制底层明细到工作区；仅开放受 Host 权限校验的 read_project_input（获准路径：${allowedPaths.join('、')}）与 write_project_report 及 studio_assets。未授权门店与文件不可读取，且不可视为 0。`,
    };
  }

  function syncCleanDir(workspaceCleanDir: string, projectRoot: string, scope: ProjectMemberPackFileScope | undefined) {
    ensurePrivateDir(workspaceCleanDir);
    // Clear existing files in sandbox clean dir first so revoked files are immediately purged!
    for (const entry of fs.readdirSync(workspaceCleanDir, { withFileTypes: true })) {
      fs.rmSync(path.join(workspaceCleanDir, entry.name), { recursive: true, force: true });
    }
    // R2: When OS managed sandbox is unavailable, NEVER copy raw detail files to an unprotected filesystem directory!
    if (!scope || scope.mode !== 'allowlist' || !scope.osSandboxAvailable) return;
    const subjectGrants = projectGrants(scope.enterpriseId, scope.projectId);
    const resolvedProjectRoot = path.resolve(projectRoot);
    for (const rel of scope.allowedPaths) {
      if (!rel.startsWith('020_clean/') || rel.includes('..')) continue;
      const src = path.resolve(resolvedProjectRoot, rel);
      if (!src.startsWith(path.resolve(resolvedProjectRoot, '020_clean') + path.sep)) continue;
      if (!fs.existsSync(src)) continue;
      const stat = fs.lstatSync(src);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      const rawBytes = fs.readFileSync(src);
      const view = buildAuthorizedDataView(rawBytes, rel, subjectGrants);
      if (!view.allowed) continue; // Fail closed: unfilterable mixed source is NEVER copied to sandbox!
      const subRel = rel.slice('020_clean/'.length);
      const dst = path.resolve(workspaceCleanDir, subRel);
      if (!dst.startsWith(path.resolve(workspaceCleanDir) + path.sep)) continue;
      let curDir = path.dirname(dst);
      ensurePrivateDir(curDir);
      while (curDir.startsWith(path.resolve(workspaceCleanDir)) && curDir !== path.resolve(workspaceCleanDir)) {
        try { fs.chmodSync(curDir, 0o700); } catch { /* ignore */ }
        curDir = path.dirname(curDir);
      }
      fs.writeFileSync(dst, view.bytes);
      fs.chmodSync(dst, 0o400);
    }
  }

  async function prepareRestrictedTaskWorkspace(projectId: string, taskId: string, projectRoot: string): Promise<RestrictedTaskWorkspace | undefined> {
    const scope = getProjectToolScope(projectId);
    if (!scope) return undefined;
    const { osSandboxAvailable } = scope;
    const workspaceRoot = path.resolve(options.dataRoot, 'member-pack-workspaces', uuid(projectId), uuid(taskId));
    const cleanDir = path.join(workspaceRoot, '020_clean');
    const reportsDir = path.join(workspaceRoot, '060_reports');
    const workDir = path.join(workspaceRoot, 'work');
    const committedReportsDir = path.join(workspaceRoot, 'committed-reports');
    const policyFingerprint = projectPermissionFingerprint(projectId);
    ensurePrivateDir(workspaceRoot);
    const policyPath = path.join(workspaceRoot, '.policy');
    const previousPolicy = fs.existsSync(policyPath) ? fs.readFileSync(policyPath, 'utf8').split('\n') : undefined;
    const priorContextStart = Number(previousPolicy?.[1]);
    const samePolicy = previousPolicy?.[0] === policyFingerprint && Number.isSafeInteger(priorContextStart);
    const contextStartAt = samePolicy ? priorContextStart : Date.now();
    if (!samePolicy) {
      const archived = path.join(workspaceRoot, 'retired', randomUUID());
      for (const dir of [cleanDir, reportsDir, workDir]) {
        if (!fs.existsSync(dir)) continue;
        ensurePrivateDir(archived);
        fs.renameSync(dir, path.join(archived, path.basename(dir)));
      }
      fs.writeFileSync(policyPath, [policyFingerprint, contextStartAt].join('\n'), { mode: 0o600 });
    }
    ensurePrivateDir(cleanDir);
    ensurePrivateDir(reportsDir);
    ensurePrivateDir(workDir);
    ensurePrivateDir(committedReportsDir);
    syncCleanDir(cleanDir, projectRoot, scope);
    // Ensure all existing subdirectories inside reportsDir / workDir also satisfy 0o700 for createProtectedExecutionScope
    const tightenDirs = (dir: string) => {
      try { fs.chmodSync(dir, 0o700); } catch { /* ignore */ }
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) tightenDirs(path.join(dir, entry.name));
      }
    };
    tightenDirs(reportsDir);
    tightenDirs(workDir);
    const protectedScope = await createProtectedExecutionScope({
      id: `member-pack-${uuid(projectId)}-${uuid(taskId)}`,
      profile: 'ordinary',
      cwd: cleanDir,
      writableRoot: workDir,
      writeRoots: [cleanDir, reportsDir],
      readRoots: [cleanDir, reportsDir],
    });
    const ws: RestrictedTaskWorkspace = {
      workspaceRoot,
      cleanDir,
      reportsDir,
      workDir,
      committedReportsDir,
      projectRoot: path.resolve(projectRoot),
      osSandboxAvailable,
      scope,
      policyFingerprint,
      contextStartAt,
      protectedScope,
    };
    let byTask = activeWorkspaces.get(projectId);
    if (!byTask) {
      byTask = new Map();
      activeWorkspaces.set(projectId, byTask);
    }
    byTask.set(taskId, ws);
    return ws;
  }

  function retireRestrictedWorkspaceInputs(projectId: string) {
    const workspaces = activeWorkspaces.get(projectId);
    if (!workspaces) return;
    const fingerprint = projectPermissionFingerprint(projectId);
    for (const workspace of workspaces.values()) {
      if (workspace.policyFingerprint === fingerprint || !fs.existsSync(workspace.cleanDir)) continue;
      const retired = path.join(workspace.workspaceRoot, 'retired', randomUUID());
      ensurePrivateDir(retired);
      fs.renameSync(workspace.cleanDir, path.join(retired, '020_clean'));
    }
  }

  function syncWorkspaceReportsToProject(projectId: string, taskId: string, projectRoot: string) {
    if (!enabled) return;
    const pid = uuid(projectId), tid = uuid(taskId);
    const wsRoot = path.resolve(options.dataRoot, 'member-pack-workspaces', pid, tid);
    const workspaceReports = path.join(wsRoot, '060_reports');
    const committedReports = path.join(wsRoot, 'committed-reports');
    if (!fs.existsSync(workspaceReports)) return;
    const policyPath = path.join(wsRoot, '.policy');
    if (!fs.existsSync(policyPath) || fs.readFileSync(policyPath, 'utf8').split('\n')[0] !== projectPermissionFingerprint(pid)) {
      // Previously committed reports remain available by their exact locators.
      return;
    }
    ensurePrivateDir(committedReports);
    const targetReports = path.resolve(projectRoot, '060_reports');
    fs.mkdirSync(targetReports, { recursive: true });
    const ledger = readReportLedger();
    let changed = false;

    const recordTaskRevision = (taskKey: string, sha256: string, effectiveRelativePath: string, stamp: string) => {
      const prev = ledger.taskSyncedFiles[taskKey];
      const priorRevisions = prev?.revisions ?? (prev ? [{ sha256: prev.sha256, effectiveRelativePath: prev.effectiveRelativePath, committedAt: prev.committedAt }] : []);
      const alreadyHas = priorRevisions.some(r => r.sha256 === sha256 && r.effectiveRelativePath === effectiveRelativePath);
      const nextRevisions = alreadyHas
        ? priorRevisions
        : [...priorRevisions, { sha256, effectiveRelativePath, committedAt: stamp }];
      ledger.taskSyncedFiles[taskKey] = {
        sha256,
        effectiveRelativePath,
        committedAt: stamp,
        revisions: nextRevisions,
      };
    };

    const walk = (srcDir: string, relBase: string) => {
      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const srcPath = path.join(srcDir, entry.name);
        const rel = normalizeRelativeDataPath(relBase ? path.join(relBase, entry.name) : entry.name);
        const st = fs.lstatSync(srcPath);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) {
          walk(srcPath, rel);
          continue;
        }
        if (!st.isFile()) continue;
        const srcBytes = fs.readFileSync(srcPath);
        const srcSha = createHash('sha256').update(srcBytes).digest('hex');
        const taskKey = `${pid}:${tid}:${rel}`;
        const prevTaskSync = ledger.taskSyncedFiles[taskKey];
        // Always persist immutable copy in this task's committed-reports directory
        const committedCopyPath = path.resolve(committedReports, rel);
        if (committedCopyPath.startsWith(committedReports + path.sep)) {
          ensurePrivateDir(path.dirname(committedCopyPath));
          fs.writeFileSync(committedCopyPath, srcBytes);
        }
        // If this task already synced this exact SHA-256 in a previous run, never re-copy over project 060_reports!
        if (prevTaskSync && prevTaskSync.sha256 === srcSha) {
          continue;
        }
        const projKey = `${pid}:${rel}`;
        const dstPath = path.resolve(targetReports, rel);
        if (!dstPath.startsWith(targetReports + path.sep)) continue;
        const dstExists = fs.existsSync(dstPath);
        const existingDiskSha = dstExists ? createHash('sha256').update(fs.readFileSync(dstPath)).digest('hex') : undefined;
        const locator = `060_reports/${rel}`;
        // R5 IMMUTABILITY: NEVER overwrite ANY existing file in <projectRoot>/060_reports with different bytes
        // (neither across tasks nor across same-task revisions, nor when referenced by Studio/pack)!
        const hasCollision = Boolean(
          (dstExists && existingDiskSha && existingDiskSha !== srcSha)
          || isReportLockedByUseOrFeedback(pid, locator, srcSha),
        );
        const stamp = new Date().toISOString();
        if (hasCollision) {
          const ext = path.extname(rel);
          const stem = rel.slice(0, rel.length - ext.length);
          let altRel = `${stem}.task-${tid.slice(0, 8)}${ext}`;
          let altDst = path.resolve(targetReports, altRel);
          if (fs.existsSync(altDst)) {
            const altDiskSha = createHash('sha256').update(fs.readFileSync(altDst)).digest('hex');
            if (altDiskSha !== srcSha) {
              altRel = `${stem}.task-${tid.slice(0, 8)}.rev-${srcSha.slice(0, 8)}${ext}`;
              altDst = path.resolve(targetReports, altRel);
            }
          }
          if (altDst.startsWith(targetReports + path.sep)) {
            fs.mkdirSync(path.dirname(altDst), { recursive: true });
            if (!fs.existsSync(altDst)) {
              fs.writeFileSync(altDst, srcBytes);
            }
            ledger.projectFiles[`${pid}:${altRel}`] = {
              projectId: pid,
              ownerTaskId: tid,
              relativePath: altRel,
              sha256: srcSha,
              bytesLength: srcBytes.length,
              committedAt: stamp,
            };
            recordTaskRevision(taskKey, srcSha, altRel, stamp);
            changed = true;
          }
        } else {
          fs.mkdirSync(path.dirname(dstPath), { recursive: true });
          fs.writeFileSync(dstPath, srcBytes);
          ledger.projectFiles[projKey] = {
            projectId: pid,
            ownerTaskId: tid,
            relativePath: rel,
            sha256: srcSha,
            bytesLength: srcBytes.length,
            committedAt: stamp,
          };
          recordTaskRevision(taskKey, srcSha, rel, stamp);
          changed = true;
        }
      }
    };
    walk(workspaceReports, '');
    if (changed) writeReportLedger(ledger);
  }

  function discardUncommittedWorkspaceReports(projectId: string, taskId: string) {
    if (!enabled) return;
    const pid = uuid(projectId), tid = uuid(taskId);
    const wsRoot = path.resolve(options.dataRoot, 'member-pack-workspaces', pid, tid);
    const workspaceReports = path.join(wsRoot, '060_reports');
    const committedReports = path.join(wsRoot, 'committed-reports');
    if (!fs.existsSync(workspaceReports)) return;
    for (const entry of fs.readdirSync(workspaceReports, { withFileTypes: true })) {
      fs.rmSync(path.join(workspaceReports, entry.name), { recursive: true, force: true });
    }
    if (!fs.existsSync(committedReports)) return;
    const restoreWalk = (srcDir: string, relBase: string) => {
      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const srcPath = path.join(srcDir, entry.name);
        const rel = relBase ? path.join(relBase, entry.name) : entry.name;
        const dstPath = path.resolve(workspaceReports, rel);
        if (!dstPath.startsWith(workspaceReports + path.sep)) continue;
        const st = fs.lstatSync(srcPath);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) {
          ensurePrivateDir(dstPath);
          restoreWalk(srcPath, rel);
        } else if (st.isFile()) {
          ensurePrivateDir(path.dirname(dstPath));
          fs.copyFileSync(srcPath, dstPath);
        }
      }
    };
    restoreWalk(committedReports, '');
  }

  function resolveTaskReportLocator(projectId: string, taskId: string, requestedLocator: string, expectedSha256?: string): string {
    if (!requestedLocator.startsWith('060_reports/')) return requestedLocator;
    const rel = normalizeRelativeDataPath(requestedLocator.slice('060_reports/'.length));
    const ledger = readReportLedger();
    const mapped = ledger.taskSyncedFiles[`${projectId}:${taskId}:${rel}`];
    if (mapped) {
      if (expectedSha256) {
        if (Array.isArray(mapped.revisions)) {
          const exact = mapped.revisions.find(r => r.sha256 === expectedSha256);
          if (exact) return `060_reports/${exact.effectiveRelativePath}`;
        }
        if (mapped.sha256 === expectedSha256 && mapped.effectiveRelativePath) {
          return `060_reports/${mapped.effectiveRelativePath}`;
        }
        return requestedLocator;
      }
      if (mapped.effectiveRelativePath) {
        return `060_reports/${mapped.effectiveRelativePath}`;
      }
    }
    return requestedLocator;
  }

  function resolveTaskDataPurpose(projectId: string, taskId: string, purposeId: string): AuthorizedDataPurpose {
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (enterpriseId) {
      const requested = text(purposeId, 100, false);
      for (const pack of packs.list(enterpriseId).filter(candidate => candidate.domain === 'member-operations')) {
        const pin = packs.getTaskPin(pack.id, projectId, taskId);
        const revision = pack.packRevisions.find(revision => pin ? revision.version === pin.packVersion : revision.status === 'active');
        const manifest = revision?.purposeManifests.find(purpose => purpose.purposeId === requested && purpose.status === 'eligible');
        if (!manifest) continue;
        const access = evaluatePurposeAccessForSubject(projectGrants(enterpriseId, projectId), manifest);
        if (isConstructionOwnerProject(pack, projectId) || access?.hasPartialOrFullDetail) {
          const { brand, channel, stores } = manifest.scope;
          return { purposeKey: manifest.purposeKey, purposeScope: { brand, channel, stores } };
        }
      }
    }
    throw new StudioError('member_pack_purpose_detail_not_authorized', 403);
  }

  function authorizeProjectDataPath(
    projectId: string,
    relativePath: string,
    query: { purposeKey?: string; grain?: string } = {},
  ): { allowed: boolean; reason?: string } {
    const scope = getProjectToolScope(projectId);
    if (!scope) return { allowed: true };
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return { allowed: true };
    const subjectGrants = projectGrants(enterpriseId, projectId);
    const normalized = normalizeRelativeDataPath(relativePath);
    if (normalized.startsWith('010_draw/') || normalized === '010_draw') {
      return { allowed: false, reason: 'raw_draw_access_not_authorized: 受限资源授权项目禁止读取 010_draw 原始目录' };
    }
    const evalResult = evaluateResourceAccess(subjectGrants, {
      operation: 'read-detail-recalculate',
      dataPath: normalized,
      ...(query.purposeKey ? { purposeKey: query.purposeKey } : {}),
      ...(query.grain ? { grain: query.grain } : {}),
    });
    return evalResult.allowed
      ? { allowed: true }
      : { allowed: false, reason: evalResult.restrictionReason ?? 'resource_detail_not_authorized' };
  }

  function assertProjectDataPathAllowed(
    projectId: string,
    relativePath: string,
    query: { purposeKey?: string; grain?: string } = {},
  ): void {
    const result = authorizeProjectDataPath(projectId, relativePath, query);
    if (!result.allowed) {
      const sanitized = (result.reason ?? 'resource_detail_not_authorized')
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 96) || 'resource_detail_not_authorized';
      const code = sanitized.includes('not_authorized') || sanitized.includes('no_active_grant')
        ? sanitized
        : `detail_access_not_authorized_${sanitized}`.slice(0, 100);
      throw Object.assign(new StudioError(result.reason ?? code, 403), { code });
    }
  }

  function filterAuthorizedProjectData(
    projectId: string,
    relativePath: string,
    rawBytes: Buffer,
    query: AuthorizedDataPurpose = {},
  ): { bytes: Buffer; filtered?: boolean; restrictionNote?: string } {
    const scope = getProjectToolScope(projectId);
    if (!scope) return { bytes: rawBytes, filtered: false };
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return { bytes: rawBytes, filtered: false };
    const subjectGrants = projectGrants(enterpriseId, projectId);
    const view = buildAuthorizedDataView(rawBytes, relativePath, subjectGrants, query);
    if (!view.allowed) {
      throw Object.assign(new StudioError(view.reason, 403), { code: view.code });
    }
    return {
      bytes: view.bytes,
      filtered: view.filtered,
      ...(view.restrictionNote ? { restrictionNote: view.restrictionNote } : {}),
    };
  }

  function filterProjectFileTree<T extends { path: string; type?: string; children?: T[] }>(projectId: string, nodes: T[]): T[] {
    const scope = getProjectToolScope(projectId);
    if (!scope) return nodes;
    const walk = (items: T[]): T[] => {
      const out: T[] = [];
      for (const node of items) {
        const norm = normalizeRelativeDataPath(node.path);
        if (norm === '010_draw' || norm.startsWith('010_draw/')) {
          // Never expose raw 010_draw filenames to restricted member-pack consumer projects!
          if (norm === '010_draw' && Array.isArray(node.children)) {
            out.push({ ...node, children: [] });
          }
          continue;
        }
        if (norm === '020_clean' && Array.isArray(node.children)) {
          out.push({ ...node, children: walk(node.children) });
          continue;
        }
        if (norm.startsWith('020_clean/')) {
          if (Array.isArray(node.children)) {
            const sub = walk(node.children);
            if (sub.length > 0) out.push({ ...node, children: sub });
          } else if (authorizeProjectDataPath(projectId, norm).allowed) {
            out.push(node);
          }
          continue;
        }
        out.push(Array.isArray(node.children) ? { ...node, children: walk(node.children) } : node);
      }
      return out;
    };
    return walk(nodes);
  }

  function evaluateNativeToolCall(
    projectId: string,
    projectRoot: string,
    call: { toolName: string; input: Record<string, unknown> },
    workspaceRoot?: string,
  ): { allowed: boolean; reason?: string } {
    const resolvedProjectRoot = path.resolve(projectRoot);
    const projectReportsDir = path.resolve(resolvedProjectRoot, '060_reports');
    const isInside = (target: string, dir: string) => target === dir || target.startsWith(dir + path.sep);

    // R5: Guard Studio/Pack-referenced reports in 060_reports/ against overwrite EVEN on ordinary & owner-construction projects!
    const guardOrdinaryReferencedReport = (): { allowed: boolean; reason?: string } | undefined => {
      if (['write', 'edit'].includes(call.toolName)) {
        const rawTarget = call.input.path ?? call.input.file_path ?? call.input.target;
        if (typeof rawTarget === 'string' && rawTarget.trim()) {
          const target = path.resolve(resolvedProjectRoot, rawTarget.trim());
          if (isInside(target, projectReportsDir)) {
            const rel = normalizeRelativeDataPath(path.relative(resolvedProjectRoot, target));
            if (fs.existsSync(target) && isReportLockedByUseOrFeedback(projectId, rel, 'overwrite-check')) {
              return {
                allowed: false,
                reason: `referenced_report_immutable_save_new_file: 报告 ${rel} 已被 Studio 或企业会员包引用，禁止覆盖原文件，请另存新文件名保留原稿。`,
              };
            }
          }
        }
      }
      if (['bash', 'powershell', 'codemode'].includes(call.toolName)) {
        const cmd = String(call.input.command ?? call.input.code ?? '');
        if (cmd.includes('060_reports') && fs.existsSync(projectReportsDir)) {
          const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const targetsFileForMutation = (fileName: string, relSub: string): boolean => {
            const namePat = `(?:${escapeRe(relSub)}|${escapeRe(fileName)})`;
            const patterns = [
              // Shell output redirection into the referenced file
              new RegExp(`>{1,2}\\s*['"]?[^'"\\s;&|\\n]*${namePat}`, 'i'),
              // Shell destructive / overwrite commands mentioning the referenced file
              new RegExp(`\\b(?:rm|mv|cp|tee|truncate|unlink|sed\\s+-i)\\b[^\\n;&|]*${namePat}`, 'i'),
              // Python open(..., 'w'|'a'|'x'|'r+') / write_text / write_bytes on the referenced file
              new RegExp(`open\\s*\\([^\\n\\)]*${namePat}[^\\n\\)]*,\\s*['"][wax+]|open\\s*\\([^\\n\\)]*${namePat}[^\\n\\)]*mode\\s*=\\s*['"][wax+]`, 'i'),
              new RegExp(`Path\\s*\\([^\\n\\)]*${namePat}[^\\n\\)]*\\)\\s*\\.\\s*write_(?:text|bytes)`, 'i'),
              // Node fs.writeFile/appendFile/unlink/rename on the referenced file
              new RegExp(`(?:writeFile|appendFile|rm|unlink|rename)(?:Sync)?\\s*\\([^\\n,]*${namePat}`, 'i'),
            ];
            return patterns.some(re => re.test(cmd));
          };
          const walkLocked = (dir: string, relBase: string): string | undefined => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const subRel = relBase ? `${relBase}/${entry.name}` : entry.name;
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                const found = walkLocked(full, subRel);
                if (found) return found;
              } else if (entry.isFile()) {
                const locator = `060_reports/${subRel}`;
                if (targetsFileForMutation(entry.name, subRel) && isReportLockedByUseOrFeedback(projectId, locator, 'overwrite-check')) {
                  return locator;
                }
              }
            }
            return undefined;
          };
          const hit = walkLocked(projectReportsDir, '');
          if (hit) {
            return {
              allowed: false,
              reason: `referenced_report_immutable_save_new_file: 报告 ${hit} 已被 Studio 或企业会员包引用，禁止通过命令覆盖原文件，请另存新文件名保留原稿。`,
            };
          }
        }
      }
      return undefined;
    };

    const scope = getProjectToolScope(projectId);
    if (!scope) {
      return guardOrdinaryReferencedReport() ?? { allowed: true };
    }

    const projectCleanDir = path.resolve(resolvedProjectRoot, '020_clean');
    const projectDrawDir = path.resolve(resolvedProjectRoot, '010_draw');
    const effectiveRoot = workspaceRoot ? path.resolve(workspaceRoot) : resolvedProjectRoot;
    const effectiveCleanDir = path.resolve(effectiveRoot, '020_clean');
    const effectiveReportsDir = path.resolve(effectiveRoot, '060_reports');

    const workspace = workspaceRoot && [...(activeWorkspaces.get(projectId)?.values() ?? [])]
      .find(candidate => candidate.workspaceRoot === effectiveRoot);
    if (workspace && workspace.policyFingerprint !== projectPermissionFingerprint(projectId)) {
      return { allowed: false, reason: 'member_pack_workspace_permission_changed' };
    }

    const resolveTarget = (rawTarget: unknown): string | undefined => {
      if (typeof rawTarget !== 'string' || !rawTarget.trim()) return undefined;
      return path.resolve(effectiveCleanDir, rawTarget.trim());
    };

    // Block subagent escape attempts in restricted member-pack projects
    if (call.toolName === 'subagent') {
      return { allowed: false, reason: 'member_pack_subagent_restricted: 受限资源授权项目禁用子会话委派，请直接按获准范围执行分析' };
    }

    if (['read', 'write', 'edit'].includes(call.toolName)) {
      const target = resolveTarget(call.input.path ?? call.input.file_path ?? call.input.target);
      if (!target) return { allowed: false, reason: scope.summary };
      // Writing/reading own 060_reports deliverables inside the task workspace remains allowed
      if (isInside(target, effectiveReportsDir) || (!workspaceRoot && isInside(target, projectReportsDir))) return { allowed: true };
      // NEVER allow direct access to project's raw 010_draw or original projectRoot when isolated workspace is active
      if (isInside(target, projectDrawDir) || (workspaceRoot && isInside(target, resolvedProjectRoot))) {
        return { allowed: false, reason: 'member_pack_path_outside_workspace: 受限资源授权项目禁止越过任务隔离目录访问原项目资料' };
      }
      if (!isInside(target, effectiveRoot)) {
        return { allowed: false, reason: 'member_pack_path_outside_project: 受限资源授权项目禁止访问工作区外路径' };
      }
      if (scope.mode === 'deny-detail') {
        return { allowed: false, reason: scope.summary };
      }
      const rel = normalizeRelativeDataPath(path.relative(effectiveRoot, target));
      if (!scope.allowedPaths.includes(rel)) {
        return { allowed: false, reason: `store_detail_not_authorized: 当前项目无权读取 ${rel}（仅获准：${scope.allowedPaths.join('、')}），不可将未授权门店再购当作零` };
      }
      // Keep clean files strictly read-only for write/edit
      if (call.toolName !== 'read') {
        return { allowed: false, reason: 'member_pack_clean_readonly: 获准明细资料为只读，请将分析产出写入 060_reports' };
      }
      return { allowed: true };
    }

    if (['ls', 'find', 'grep'].includes(call.toolName)) {
      if (scope.mode === 'deny-detail') {
        return { allowed: false, reason: scope.summary };
      }
      const target = resolveTarget(call.input.path ?? '.');
      if (target && (isInside(target, effectiveReportsDir) || (!workspaceRoot && isInside(target, projectReportsDir)))) return { allowed: true };
      if (call.toolName === 'grep' && target && isInside(target, effectiveCleanDir)) {
        const rel = normalizeRelativeDataPath(path.relative(effectiveRoot, target));
        if (scope.allowedPaths.includes(rel)) return { allowed: true };
      }
      return { allowed: false, reason: `store_detail_not_authorized: 受限资源授权项目禁止扫描 020_clean 目录，请直接按获准路径读取：${scope.allowedPaths.join('、')}` };
    }

    if (['bash', 'powershell', 'codemode'].includes(call.toolName)) {
      if (scope.mode === 'deny-detail') {
        return { allowed: false, reason: scope.summary };
      }
      const cmd = String(call.input.command ?? call.input.code ?? '');
      // Block any reference to projectRoot, projects parent root, 010_draw, or escaping workspace via ../../ or encoded path construction
      const projectsParentDir = path.dirname(resolvedProjectRoot);
      if (
        cmd.includes(resolvedProjectRoot)
        || cmd.includes(projectCleanDir)
        || cmd.includes(projectsParentDir)
        || /\b010_draw\b|\.\.\/\.\.|\.\.\\\.\.|\b(?:atob|b64decode|fromhex|fromCharCode|realpath|readlink)\b|\/proc\//i.test(cmd)
      ) {
        return { allowed: false, reason: 'member_pack_path_outside_workspace: 受限资源授权项目命令禁止越出任务隔离工作区访问原项目目录' };
      }
      // Enumerate all unauthorized files currently present in original project 020_clean
      const unauthorizedNames: string[] = [];
      try {
        const walk = (dir: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else {
              const rel = normalizeRelativeDataPath(path.relative(resolvedProjectRoot, full));
              if (!scope.allowedPaths.includes(rel)) {
                unauthorizedNames.push(entry.name, rel);
              }
            }
          }
        };
        if (fs.existsSync(projectCleanDir)) walk(projectCleanDir);
      } catch { /* ignore */ }

      const lowerCmd = cmd.toLowerCase();
      for (const forbidden of unauthorizedNames) {
        if (forbidden && lowerCmd.includes(forbidden.toLowerCase())) {
          return { allowed: false, reason: `store_detail_not_authorized: 命令涉及未授权明细文件（${forbidden}）；仅获准读取 ${scope.allowedPaths.join('、')}，不可将未授权门店再购当作零` };
        }
      }
      // Block directory listing / globbing / recursive sweeps that could bypass filename checks
      if (/\b(?:ls|find|glob|iglob|rglob|listdir|scandir|walk|dir)\b|\*\.[a-z0-9]+|\b020_clean\/?\s*[*?]/i.test(cmd)) {
        return { allowed: false, reason: `store_detail_not_authorized: 受限资源授权项目禁止通配/枚举目录，请显式读取获准文件：${scope.allowedPaths.join('、')}` };
      }
      return { allowed: true };
    }

    return { allowed: true };
  }

  function reportUseCovered(
    use: EnterprisePackUseRecord,
    purpose: EnterpriseDomainPack['packRevisions'][number]['purposeManifests'][number] | undefined,
    subjectGrants: ReturnType<typeof projectGrants>,
  ) {
    const reportIdentity = digest(sourceRef(use.reportRef));
    if (!purpose || purpose.status !== 'eligible') return false;
    const operation = use.accessLevel === 'recalculate' ? 'read-detail-recalculate' : use.accessLevel === 'summary' ? 'cite-summary' : 'read-definition';
    return subjectGrants.some(grant => {
      if (!grant.operations.includes(operation)) return false;
      if (grant.purposeKeys?.length && !grant.purposeKeys.includes('*') && !grant.purposeKeys.includes(purpose.purposeKey)) return false;
      if (grant.scope.brand && grant.scope.brand !== purpose.scope.brand) return false;
      if (grant.scope.channel && grant.scope.channel !== purpose.scope.channel) return false;
      if (grant.scope.stores?.length && (!purpose.scope.stores?.length || !purpose.scope.stores.every(store => grant.scope.stores?.includes(store)))) return false;
      if (!isPeriodCovered(purpose.scope.period, grant.scope.periodFrom, grant.scope.periodTo)) return false;
      if (operation === 'read-detail-recalculate' && !grant.scope.allowedDataPaths?.length) return false;
      if (operation === 'cite-summary') {
        const summary = purpose.summaryAccess;
        return Boolean(summary && grant.resourceRef && digest(sourceRef(grant.resourceRef)) === digest(sourceRef(summary.summaryRef))
          && grant.scope.grain === summary.grain && grant.scope.summaryVersion === summary.summaryRef.version);
      }
      return (!grant.scope.grain || grant.scope.grain === purpose.subjectUnit)
        && (!grant.resourceRef || digest(sourceRef(grant.resourceRef)) === reportIdentity);
    });
  }

  function assertDeclaredReportAccess(systemId: string, projectId: string, declaration: StudioUseRecord) {
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId || options.enterpriseScopes.enterpriseIdForProject(declaration.projectId) !== enterpriseId) {
      throw new StudioError('studio_report_permission_denied', 403);
    }
    const grantsNow = projectGrants(enterpriseId, projectId)
      .filter(grant => isGrantActive(grant, Date.now()));
    const qualifications = packs.list(enterpriseId).filter(pack => pack.systemId === systemId).flatMap(pack =>
      pack.useRecords.filter(use => matchesStudioUse(use, declaration))
        .map(use => ({ use, purpose: pack.packRevisions.find(revision => revision.version === use.packVersion)
          ?.purposeManifests.find(purpose => purpose.purposeId === use.purposeId && purpose.purposeKey === use.purposeKey) })),
    );
    const entitled = qualifications.length > 0 && qualifications.every(({ use, purpose }) => reportUseCovered(use, purpose, grantsNow));
    if (!entitled) throw new StudioError('studio_report_permission_denied', 403);
  }

  function filterDependenciesForAccess(
    deps: EnterprisePackDependency[],
    access: { canDef: boolean; canSummary: boolean; canDetail: boolean },
  ): EnterprisePackDependency[] {
    if (access.canDetail) return deps;
    return deps.filter(d => {
      if (d.role === 'member-rule' || d.role === 'studio-source') return access.canDef || access.canSummary;
      if (d.role === 'summary-result') return access.canSummary;
      if (d.role === 'shared-asset') return access.canDef || access.canSummary;
      // sap-metric / sap-method calculation specs require detail or explicit definition/summary view
      if (d.role === 'sap-metric' || d.role === 'sap-method') return access.canDef || access.canSummary;
      return false;
    });
  }

  function evaluatePurposeAccessForSubject(
    subjectGrants: readonly import('../../extensions/business-plugins/studio/enterprise-pack.ts').ResourceAuthorizationGrant[],
    pm: EnterpriseDomainPack['packRevisions'][number]['purposeManifests'][number],
  ) {
    if (pm.status !== 'eligible') return null;
    const canDef = evaluateResourceAccess(subjectGrants, {
      operation: 'read-definition',
      purposeKey: pm.purposeKey,
      brand: pm.scope.brand,
      channel: pm.scope.channel,
    });
    const canSummary = evaluateResourceAccess(subjectGrants, {
      operation: 'cite-summary',
      purposeKey: pm.purposeKey,
      brand: pm.scope.brand,
      channel: pm.scope.channel,
    });
    const canDetail = evaluateResourceAccess(subjectGrants, {
      operation: 'read-detail-recalculate',
      purposeKey: pm.purposeKey,
      brand: pm.scope.brand,
      channel: pm.scope.channel,
      stores: pm.scope.stores,
    });
    const hasPartialOrFullDetail = canDetail.allowed || canDetail.grantedStores.length > 0;
    if (!canDef.allowed && !canSummary.allowed && !hasPartialOrFullDetail) return null;
    const visibleDeps = filterDependenciesForAccess(pm.dependencies, {
      canDef: canDef.allowed,
      canSummary: canSummary.allowed,
      canDetail: hasPartialOrFullDetail,
    });
    return {
      canDef,
      canSummary,
      canDetail,
      hasPartialOrFullDetail,
      visibleDeps,
    };
  }

  function qualifiedPinPurposes(pack: EnterpriseDomainPack, projectId: string, construction: boolean, revision?: EnterpriseDomainPack['packRevisions'][number]) {
    const subjectGrants = projectGrants(pack.enterpriseId, projectId);
    return (revision?.purposeManifests ?? []).flatMap(purpose => {
      if (purpose.status !== 'eligible') return [];
      if (construction) return [purpose];
      const access = evaluatePurposeAccessForSubject(subjectGrants, purpose);
      return access ? [{ purposeId: purpose.purposeId, dependencies: access.visibleDeps }] : [];
    });
  }

  function packContainsSourceRef(pack: EnterpriseDomainPack, ref: StudioSourceRef): boolean {
    if (pack.purposes.some(p => p.dependencies.some(d => sameExactSourceRef(d.ref, ref)))) return true;
    if (pack.packRevisions.some(r => r.purposeManifests.some(pm => pm.dependencies.some(d => sameExactSourceRef(d.ref, ref))))) return true;
    return false;
  }

  function buildPackCatalogSummary(enterpriseId: string, projectId?: string, taskId?: string) {
    const list = packs.list(enterpriseId);
    const subjectGrants = projectId ? projectGrants(enterpriseId, projectId) : [];
    const summaries: Record<string, unknown>[] = [];

    for (const pack of list) {
      const activeRev = pack.packRevisions.find(r => r.status === 'active') ?? pack.packRevisions.at(-1);
      const isConstruction = Boolean(projectId && isConstructionOwnerProject(pack, projectId));
      const existingPin = projectId && taskId ? packs.getTaskPin(pack.id, projectId, taskId) : undefined;

      // R6: In --disable-member-pack read-only rollback mode, STOP supplying pack purposes/dependencies to NEW tasks!
      if (!enabled && !existingPin) {
        if (activeRev) {
          summaries.push({
            packId: pack.id,
            packCode: pack.packCode,
            domain: pack.domain,
            name: pack.name,
            systemId: pack.systemId,
            pinnedVersion: null,
            revisionStatus: activeRev.status,
            readOnlyRollback: true,
            authorizationRequired: true,
            authorizationNote: '当前处于回退只读模式（--disable-member-pack）：已停止向新任务供给企业会员包用途与依赖；历史记录保留只读。',
            purposes: [],
          });
        }
        continue;
      }

      let pinnedVersion = activeRev?.version;
      let pinnedManifest = activeRev;

      // Determine whether this project holds any active grant on this member pack
      const activeGrants = subjectGrants.filter(g => {
        if (g.revokedAt) return false;
        const nowMs = Date.now();
        if (g.validFrom && Date.parse(g.validFrom) > nowMs) return false;
        if (g.validTo && Date.parse(g.validTo) < nowMs) return false;
        return true;
      });

      if (projectId && taskId && activeRev && (isConstruction || activeGrants.length > 0)) {
        if (existingPin) {
          pinnedVersion = existingPin.packVersion;
          pinnedManifest = pack.packRevisions.find(r => r.version === existingPin.packVersion) ?? activeRev;
        } else if (enabled) {
          try {
            const scopeDesc = isConstruction
              ? 'construction-owner'
              : activeGrants.map(g => `${g.operations.join(',')}:${g.scope.stores?.join('/') || g.scope.grain || g.scope.brand || '*'}`).join(';') || 'restricted';
            const qualifiedPurposes = qualifiedPinPurposes(pack, projectId, isConstruction, activeRev);
            if (!qualifiedPurposes.length) throw new StudioError('member_pack_purpose_not_authorized', 403);
            const pin = packs.pinTaskVersion(pack.id, { projectId, taskId, authorizedScope: scopeDesc, qualifiedPurposes });
            pinnedVersion = pin.packVersion;
            pinnedManifest = pack.packRevisions.find(r => r.version === pin.packVersion) ?? activeRev;
          } catch { /* No active revision yet or read-only mode */ }
        }
      }

      // Default-deny for new member packs: mere enterprise membership does NOT grant 3-tier access!
      if (!isConstruction && activeGrants.length === 0) {
        if (activeRev) {
          summaries.push({
            packId: pack.id,
            packCode: pack.packCode,
            domain: pack.domain,
            name: pack.name,
            systemId: pack.systemId,
            pinnedVersion: null,
            revisionStatus: activeRev.status,
            authorizationRequired: true,
            authorizationNote: subjectGrants.length > 0
              ? '当前项目的资源授权已撤回或失效，停止供给包用途与原依赖；历史报告保留只读。'
              : '新企业会员包需显式配置项目资源授权（定义查阅 / 汇总引用 / 明细重算），仅凭企业归属不自动授予使用权。',
            purposes: [],
          });
        }
        continue;
      }

      const visiblePurposes = (pinnedManifest?.purposeManifests ?? [])
        .filter(pm => pm.status === 'eligible')
        .map(pm => {
          if (isConstruction) {
            return {
              purposeId: pm.purposeId,
              purposeKey: pm.purposeKey,
              title: pm.title,
              tier: pm.tier,
              ...(pm.limitedCalculationName ? { limitedCalculationName: pm.limitedCalculationName } : {}),
              subjectUnit: pm.subjectUnit,
              ...(pm.windowDays !== undefined ? { windowDays: pm.windowDays } : {}),
              policyEffectiveFrom: pm.policyEffectiveFrom,
              dataCutoffAt: pm.dataCutoffAt,
              exclusions: pm.exclusions,
              gaps: pm.gaps,
              dependencies: pm.dependencies.map(d => ({ id: d.id, role: d.role, authority: d.authority, ref: d.ref })),
              accessLevels: ['read-definition', 'cite-summary', 'read-detail-recalculate'] as ResourceGrantOperation[],
            };
          }
          const access = evaluatePurposeAccessForSubject(subjectGrants, pm);
          if (!access) return null;
          const { canDef, canSummary, canDetail, hasPartialOrFullDetail, visibleDeps } = access;

          const matchedDetailGrants = subjectGrants.filter(g => canDetail.matchedGrantIds.includes(g.id));
          const allowedDataPaths = [...new Set(matchedDetailGrants.flatMap(g => g.scope.allowedDataPaths ?? []))];
          const summaryGrant = canSummary.allowed ? subjectGrants.find(g => canSummary.matchedGrantIds.includes(g.id)) : undefined;

          return {
            purposeId: pm.purposeId,
            purposeKey: pm.purposeKey,
            title: pm.title,
            tier: pm.tier,
            ...(pm.limitedCalculationName ? { limitedCalculationName: pm.limitedCalculationName } : {}),
            subjectUnit: pm.subjectUnit,
            ...(pm.windowDays !== undefined ? { windowDays: pm.windowDays } : {}),
            policyEffectiveFrom: pm.policyEffectiveFrom,
            dataCutoffAt: pm.dataCutoffAt,
            exclusions: pm.exclusions,
            gaps: pm.gaps,
            dependencies: visibleDeps.map(d => ({ id: d.id, role: d.role, authority: d.authority, ref: d.ref })),
            accessLevels: [
              ...(canDef.allowed ? ['read-definition' as const] : []),
              ...(canSummary.allowed ? ['cite-summary' as const] : []),
              ...(hasPartialOrFullDetail ? ['read-detail-recalculate' as const] : []),
            ],
            ...(summaryGrant ? {
              authorizedSummary: {
                summaryAssetId: summaryGrant.scope.summaryAssetId,
                summaryVersion: summaryGrant.scope.summaryVersion,
                summaryAuthority: summaryGrant.scope.summaryAuthority,
                summarySha256: summaryGrant.scope.summarySha256,
                verifiedScopeSummary: summaryGrant.scope.verifiedScopeSummary,
                grain: summaryGrant.scope.grain,
                periodFrom: summaryGrant.scope.periodFrom,
                periodTo: summaryGrant.scope.periodTo,
                ...(summaryGrant.resourceRef ? { ref: summaryGrant.resourceRef } : {}),
              },
            } : {}),
            ...(hasPartialOrFullDetail ? {
              grantedStores: canDetail.grantedStores,
              ...(allowedDataPaths.length ? { allowedDataPaths } : {}),
            } : {}),
            ...(canDetail.deniedStores.length ? {
              deniedStores: canDetail.deniedStores,
              restrictedDetailNote: `部分门店明细未授权（${canDetail.deniedStores.join('、')}），不可将未授权门店再购当作零`,
            } : {}),
          };
        })
        .filter(Boolean);

      summaries.push({
        packId: pack.id,
        packCode: pack.packCode,
        domain: pack.domain,
        name: pack.name,
        systemId: pack.systemId,
        pinnedVersion: pinnedVersion ?? null,
        revisionStatus: pinnedManifest?.status ?? 'draft',
        ...(!enabled ? { readOnlyRollback: true } : {}),
        purposes: visiblePurposes,
      });
    }
    return summaries;
  }

  /**
   * Validates whether an ordinary task's `read-source` call for `ref` matches a
   * pinned dependency of a member pack and is still permitted by current Host grants.
   */
  function inspectPinnedSourceRead(projectId: string, taskId: string, ref: StudioSourceRef): {
    matchedPack?: { packId: string; packVersion: string; purposeIds: string[]; summaryAuthorized?: boolean };
  } {
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return {};
    const list = packs.list(enterpriseId);
    if (!list.length) return {};

    const subjectGrants = projectGrants(enterpriseId, projectId);
    for (const pack of list) {
      if (isConstructionOwnerProject(pack, projectId)) continue;
      const pin = packs.getTaskPin(pack.id, projectId, taskId);
      const belongsToPack = packContainsSourceRef(pack, ref);
      // In read-only rollback mode, unpinned new tasks receive NO pack-mediated supply!
      if (!enabled && !pin) {
        if (belongsToPack) throw new StudioError('member_pack_disabled_readonly', 403);
        continue;
      }
      const rev = pin
        ? pack.packRevisions.find(r => r.version === pin.packVersion)
        : pack.packRevisions.find(r => r.status === 'active');
      if (!rev) {
        if (belongsToPack) throw new StudioError('resource_access_denied', 403);
        continue;
      }

      // Check if ref is a Host-authorized summary ref (live active check + purposeKey consistency)
      const nowMs = Date.now();
      const matchedSummaryGrant = subjectGrants.find(g =>
        isGrantActive(g, nowMs)
        && g.operations.includes('cite-summary')
        && g.resourceRef
        && sameExactSourceRef(g.resourceRef, ref),
      );
      if (matchedSummaryGrant) {
        const eligiblePurposeKeys = rev.purposeManifests.filter(pm => pm.status === 'eligible').map(pm => pm.purposeKey);
        const matchingPurposeKey = matchedSummaryGrant.purposeKeys?.length
          ? matchedSummaryGrant.purposeKeys.find(pk => eligiblePurposeKeys.includes(pk))
          : eligiblePurposeKeys[0];
        if (matchedSummaryGrant.purposeKeys?.length && !matchingPurposeKey) {
          throw new StudioError('resource_access_denied', 403);
        }
        const evalSummary = evaluateResourceAccess(subjectGrants, {
          operation: 'cite-summary',
          ...(matchingPurposeKey ? { purposeKey: matchingPurposeKey } : {}),
          grain: matchedSummaryGrant.scope.grain,
          summaryVersion: matchedSummaryGrant.scope.summaryVersion,
        });
        if (!evalSummary.allowed) throw new StudioError('resource_grant_revoked', 403);
        return { matchedPack: { packId: pack.id, packVersion: rev.version, purposeIds: pin?.purposeIds ?? [], summaryAuthorized: true } };
      }
      if (subjectGrants.some(g => !isGrantActive(g, nowMs) && g.operations.includes('cite-summary') && g.resourceRef && sameExactSourceRef(g.resourceRef, ref))) {
        throw new StudioError('resource_grant_revoked', 403);
      }

      // Check if ref belongs to any dependency in the pinned revision using the EXACT unified purpose/dependency filter!
      const matchedPurposes = rev.purposeManifests.filter(pm =>
        pm.status === 'eligible' && pm.dependencies.some(d => sameExactSourceRef(d.ref, ref)),
      );
      if (matchedPurposes.length > 0) {
        const allowedPurposes = matchedPurposes.filter(pm => {
          const access = evaluatePurposeAccessForSubject(subjectGrants, pm);
          return Boolean(access && access.visibleDeps.some(d => sameExactSourceRef(d.ref, ref)));
        });
        if (!allowedPurposes.length) {
          throw new StudioError(subjectGrants.some(g => Boolean(g.revokedAt)) ? 'resource_grant_revoked' : 'resource_access_denied', 403);
        }
        return { matchedPack: { packId: pack.id, packVersion: rev.version, purposeIds: allowedPurposes.map(pm => pm.purposeId) } };
      }

      // If this project has a revoked summary grant for this exact ref, or if ref belongs to another unpinned/suspended purpose in this pack, block immediately!
      if (subjectGrants.some(g => g.revokedAt && g.resourceRef && sameExactSourceRef(g.resourceRef, ref))) {
        throw new StudioError('resource_grant_revoked', 403);
      }
      if (belongsToPack) {
        throw new StudioError(subjectGrants.some(g => Boolean(g.revokedAt)) ? 'resource_grant_revoked' : 'resource_access_denied', 403);
      }
    }
    return {};
  }

  /**
   * Collects actual Host-verified tool evidence STRICTLY scoped to the specific reply's turn
   * `[turnStartIdx .. endIdx]` so a later tool-free turn NEVER inherits reads or declarations from an earlier turn!
   */
  async function inspectTaskNativeEvidence(projectId: string, taskId: string, pack: EnterpriseDomainPack, upToSelection?: { sessionId: string; messageId: string }) {
    const turnActualReads: EnterprisePackReadEvidence[] = [];
    const seenReadKeys = new Set<string>();
    const turnDeclaredStudioUseIds: string[] = [];
    const otherTurnDeclaredStudioUseIds: string[] = [];
    const turnWrittenReports: StudioSourceRef[] = [];
    let turnWroteOrRanTools = false;
    let hadDataOrCalcTool = false;
    let earlierTurnHadReadsOrWrites = false;
    let observedDirectoryVersion: string | undefined;
    let sessionObservedDirectoryVersion: string | undefined;
    let catalogSuppliedAt: string | undefined;
    let catalogPurposeIds: string[] = [];
    let catalogAssetRefs: StudioSourceRef[] = [];
    let taskCutoffAt: string | undefined;
    let turnIndex: number | undefined;
    let replyTimestampMs: number | undefined;
    let resolvedSelection: { sessionId: string; messageId: string } | undefined = upToSelection;

    const parseMsgTimestamp = (msg: Record<string, any> | undefined): number | undefined => {
      if (!msg) return undefined;
      for (const raw of [msg.timestamp, msg.createdAt, msg.created_at, msg.at]) {
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 1e12 ? raw : raw * 1000;
        if (typeof raw === 'string' && raw.trim()) {
          const parsed = Date.parse(raw);
          if (Number.isFinite(parsed)) return parsed;
        }
      }
      return undefined;
    };

    if (!options.taskSnapshot) {
      return {
        actualReads: turnActualReads,
        turnDeclaredStudioUseIds,
        otherTurnDeclaredStudioUseIds,
        turnWrittenReports,
        turnWroteOrRanTools,
        hadDataOrCalcTool,
        earlierTurnHadReadsOrWrites,
        observedDirectoryVersion,
        sessionObservedDirectoryVersion,
        catalogSuppliedAt,
        catalogPurposeIds,
        catalogAssetRefs,
        taskCutoffAt,
        turnIndex,
        replyTimestampMs,
        resolvedSelection,
      };
    }
    const snap = await options.taskSnapshot(projectId, taskId);
    let endIdx = snap.messages.length - 1;
    if (upToSelection) {
      const idx = snap.messages.findIndex(m => m.role === 'assistant' && m.nativeSessionId === upToSelection.sessionId && m.nativeEntryId === upToSelection.messageId);
      if (idx >= 0) endIdx = idx;
    } else {
      for (let i = snap.messages.length - 1; i >= 0; i--) {
        const msg = snap.messages[i] as Record<string, any>;
        if (msg?.role === 'assistant' && typeof msg.nativeSessionId === 'string' && typeof msg.nativeEntryId === 'string') {
          resolvedSelection = { sessionId: msg.nativeSessionId, messageId: msg.nativeEntryId };
          endIdx = i;
          break;
        }
      }
    }
    replyTimestampMs = parseMsgTimestamp(snap.messages[endIdx] as Record<string, any> | undefined);

    // Locate the start of THIS specific turn (the user message immediately preceding endIdx)
    let turnStartIdx = 0;
    for (let i = endIdx; i >= 0; i--) {
      const m = snap.messages[i] as Record<string, any>;
      if (m?.role === 'user') {
        turnStartIdx = i;
        turnIndex = i;
        const parsed = extractTaskCutoffFromText(messageText(m));
        if (parsed) taskCutoffAt = parsed;
        break;
      }
    }

    // Check earlier/other turns ONLY for session-level directory pin observation and other-turn declare-use detection (NEVER reads!)
    for (let i = 0; i < snap.messages.length; i++) {
      if (i >= turnStartIdx && i <= endIdx) continue;
      const m = snap.messages[i] as Record<string, any>;
      if (!m || m.role !== 'toolResult' || m.isError) continue;
      if (i < turnStartIdx) {
        earlierTurnHadReadsOrWrites = true;
      }
      if (m.details?.type === 'optracall.studio') {
        if (i < turnStartIdx && m.details.action === 'catalog' && Array.isArray(m.details.result?.memberPacks)) {
          const entry = m.details.result.memberPacks.find((p: any) => p?.packId === pack.id);
          if (entry && typeof entry.pinnedVersion === 'string') {
            sessionObservedDirectoryVersion = entry.pinnedVersion;
          }
        }
        if (m.details.action === 'declare-use' && typeof m.details.result?.use?.id === 'string') {
          otherTurnDeclaredStudioUseIds.push(m.details.result.use.id);
        }
      }
    }

    // Collect ACTUAL reads, declare-use, written reports, & catalog supply STRICTLY within THIS turn [turnStartIdx + 1 .. endIdx]!
    for (let i = turnStartIdx + 1; i <= endIdx; i++) {
      const m = snap.messages[i] as Record<string, any>;
      if (!m || m.role !== 'toolResult' || m.isError) continue;
      turnWroteOrRanTools = true;
      if (['read_input', 'read', 'bash', 'powershell', 'codemode'].includes(String(m.toolName ?? ''))) {
        hadDataOrCalcTool = true;
      }
      if (m.details?.type === 'optracall.project-report-write' && typeof m.details.relativePath === 'string' && typeof m.details.sha256 === 'string') {
        try {
          turnWrittenReports.push(sourceRef({
            authority: 'task',
            id: taskId,
            projectId,
            taskId,
            version: m.details.sha256,
            sha256: m.details.sha256,
            locator: m.details.relativePath,
          }));
        } catch { /* ignore */ }
      }
      if (m.details?.type === 'optracall.studio') {
        const action = m.details.action;
        const result = m.details.result;
        if (action === 'catalog' && Array.isArray(result?.memberPacks)) {
          const entry = result.memberPacks.find((p: any) => p?.packId === pack.id);
          if (entry && typeof entry.pinnedVersion === 'string') {
            observedDirectoryVersion = entry.pinnedVersion;
            sessionObservedDirectoryVersion = entry.pinnedVersion;
            catalogSuppliedAt = new Date().toISOString();
            if (Array.isArray(entry.purposes)) {
              catalogPurposeIds = entry.purposes.map((p: any) => String(p.purposeId)).filter(Boolean);
              for (const p of entry.purposes) {
                for (const d of Array.isArray(p.dependencies) ? p.dependencies : []) {
                  if (d?.ref) catalogAssetRefs.push(sourceRef(d.ref));
                }
              }
            }
          }
        }
        if (action === 'declare-use' && typeof result?.use?.id === 'string') {
          turnDeclaredStudioUseIds.push(result.use.id);
          if (result.use.report) {
            try { turnWrittenReports.push(sourceRef(result.use.report)); } catch { /* ignore */ }
          }
        }
        if (['read-source', 'read'].includes(action) && result?.ref) {
          try {
            const ref = sourceRef(result.ref);
            if (ref.authority === 'data' || ref.authority === 'task') {
              hadDataOrCalcTool = true;
            }
            const key = `${digest(ref)}:${String(m.toolCallId ?? i)}`;
            if (!seenReadKeys.has(key)) {
              seenReadKeys.add(key);
              turnActualReads.push({
                ref,
                ...(ref.sha256 ? { sha256: ref.sha256 } : {}),
                complete: result.complete === true,
                readAt: new Date().toISOString(),
                turnIndex: i,
                ...(typeof m.toolCallId === 'string' ? { toolCallId: m.toolCallId } : {}),
              });
            }
          } catch { /* ignore non-source ref */ }
        }
      }
      if (m.details?.type === 'optracall.semantic-context-result' && ['read', 'trace'].includes(m.details.action)) {
        for (const item of [...(m.details.items ?? []), ...(m.details.unknownTime ?? [])]) {
          if (typeof item?.body === 'string' && item?.target && typeof item.sha256 === 'string') {
            const t = item.target;
            let ref: StudioSourceRef | undefined;
            if (t.kind === 'sap') ref = sourceRef({ authority: 'sap-metric', id: t.packageId, version: t.version, sha256: item.sha256 });
            else if (t.kind === 'sap-method') ref = sourceRef({ authority: 'sap-method', id: t.methodId, version: String(t.version), sha256: item.sha256 });
            else if (t.kind === 'enterprise') ref = sourceRef({ authority: 'enterprise', id: t.materialId, version: t.revisionId, sha256: item.sha256, locator: t.storeId });
            else if (t.kind === 'studio-source') ref = sourceRef({ authority: 'studio-source', id: t.assetId, version: String(t.version), sha256: item.sha256, locator: t.systemId });
            if (ref) {
              const key = `${digest(ref)}:${String(m.toolCallId ?? i)}`;
              if (!seenReadKeys.has(key)) {
                seenReadKeys.add(key);
                turnActualReads.push({
                  ref,
                  sha256: ref.sha256,
                  complete: item.complete !== false,
                  readAt: new Date().toISOString(),
                  turnIndex: i,
                  ...(typeof m.toolCallId === 'string' ? { toolCallId: m.toolCallId } : {}),
                });
              }
            }
          }
        }
      }
    }

    catalogAssetRefs = [...new Map(catalogAssetRefs.map(r => [digest(r), r])).values()];
    const uniqueWrittenReports = [...new Map(turnWrittenReports.map(r => [digest(r), r])).values()];
    return {
      actualReads: turnActualReads,
      turnDeclaredStudioUseIds,
      otherTurnDeclaredStudioUseIds,
      turnWrittenReports: uniqueWrittenReports,
      turnWroteOrRanTools,
      hadDataOrCalcTool,
      earlierTurnHadReadsOrWrites,
      observedDirectoryVersion,
      sessionObservedDirectoryVersion,
      catalogSuppliedAt,
      catalogPurposeIds,
      catalogAssetRefs,
      taskCutoffAt,
      turnIndex,
      replyTimestampMs,
      resolvedSelection,
    };
  }

  async function inspectVerifierTaskEvidence(
    verifierProjectId: string,
    verifierTaskId: string,
    pack: EnterpriseDomainPack,
    use: EnterprisePackUseRecord,
    studioUseId: string,
    assessment: StudioUseAssessment,
  ) {
    const revision = pack.packRevisions.find(item => item.version === use.packVersion);
    const purpose = revision?.purposeManifests.find(item => item.purposeId === use.purposeId);
    const requiredRefs = purpose?.dependencies.filter(dep => dep.requiredFor.includes(purpose.tier)).map(dep => dep.ref) ?? [];
    const report = assessment.report;
    const target = use.reportRef;
    const evidence = assessment.evidence;
    const verifierReads: NonNullable<EnterprisePackUseRecord['independentVerification']['verifierActualReads']> = [];
    const summary: NonNullable<EnterprisePackUseRecord['independentVerification']['verifierEvidenceSummary']> = {
      requiredAssetsCount: requiredRefs.length,
      readRequiredAssetsCount: 0,
      allRequiredReadByVerifier: false,
      hadDataOrCalcEvidence: false,
      targetReportChecked: false,
      authorizedInputChecked: false,
      assessmentReportBoundToTarget: false,
      assessmentDisclaimerRejected: false,
    };
    const pending = (missingReason: string) => ({
      verifierReads, summary: { ...summary, missingReason }, wrongVersion: false, failed: false,
    });
    if (!options.taskSnapshot || !purpose || report.projectId !== verifierProjectId || report.taskId !== verifierTaskId ||
        report.id !== verifierTaskId || report.authority !== 'task' || !projectFileLocator(report.locator, '060_reports') ||
        !report.sha256 || report.version !== report.sha256) {
      return pending('独立核验缺少准确的用途、核验任务或原生评估报告身份，保持待验证');
    }
    const [snapshot, project] = await Promise.all([
      options.taskSnapshot(verifierProjectId, verifierTaskId), options.projects.get(verifierProjectId),
    ]).catch(() => [undefined, undefined] as const);
    if (!snapshot || !project) return pending('独立核验原生会话当前不可读，保持待验证');

    const native = nativeAssessmentEvidence(snapshot.messages, pack.systemId, studioUseId, assessment, ref => ({
      ...ref, locator: ref.locator
        ? resolveTaskReportLocator(verifierProjectId, verifierTaskId, ref.locator, ref.sha256)
        : undefined,
    }));
    if (!native) return pending('缺少对应本报告与用途的原生独立评估调用，保持待验证');
    const { boundary, results } = native;
    summary.assessmentTurnIndex = boundary.turnIndex;
    summary.assessmentMessageId = boundary.entryId;
    summary.assessmentSessionId = boundary.sessionId;
    summary.assessmentToolCallId = boundary.id;

    const workspaceRoot = getProjectToolScope(verifierProjectId)
      ? path.resolve(options.dataRoot, 'member-pack-workspaces', verifierProjectId, verifierTaskId) : project.rootPath;
    const owner = {
      projectId: verifierProjectId, taskId: verifierTaskId,
      cleanDir: path.join(workspaceRoot, '020_clean'), reportsDir: path.join(workspaceRoot, '060_reports'),
    };
    const sourceReads = results.flatMap(result => readStudioEvidence(result).map(item => ({ ...item, call: result.call })));
    for (const result of results) {
      const file = readNativeFileEvidence(result, owner);
      if (!file) continue;
      if (target.projectId === verifierProjectId && file.locator === target.locator && file.sha256 === target.sha256) {
        sourceReads.push({ ref: target, complete: true, body: file.body, call: result.call });
      } else if (projectFileLocator(file.locator, '020_clean')) {
        sourceReads.push({
          ref: {
            authority: 'data', id: createHash('sha256').update(file.locator).digest('hex'),
            projectId: verifierProjectId, taskId: verifierTaskId, locator: file.locator, version: file.sha256, sha256: file.sha256,
          },
          complete: true, body: file.body, call: result.call,
        });
      }
    }

    const inputPaths = evidence?.coverage?.inputPaths ?? [];
    const publishedUse = use.authorDeclaration?.studioUseId;
    const originInputs = inputPaths.length && publishedUse
      ? (await readReportInputSnapshots(use.projectId, use.taskId, target, undefined, publishedUse)).snapshots
      : [];
    const originInputDigests = new Set(originInputs.map(({ binding }) => binding.ref.sha256));
    const authorizedInputs = new Map<string, string>();
    const purposeData = { purposeKey: use.purposeKey, purposeScope: {
      brand: purpose.scope.brand, channel: purpose.scope.channel, stores: purpose.scope.stores,
    } };
    for (const locator of inputPaths) {
      if (!authorizeProjectDataPath(verifierProjectId, locator, { purposeKey: use.purposeKey }).allowed) continue;
      try {
        const actual = await options.projects.readFile(verifierProjectId, locator);
        const visible = filterAuthorizedProjectData(verifierProjectId, locator, actual.bytes, purposeData);
        const sha = createHash('sha256').update(visible.bytes).digest('hex');
        if (originInputDigests.has(sha)) authorizedInputs.set(locator, sha);
      } catch { /* absence of matching authorized bytes remains unknown */ }
    }
    const groups = new Map<string, typeof sourceReads>();
    for (const read of sourceReads) {
      const { title: _title, ...identity } = read.ref;
      const key = digest(identity);
      const group = groups.get(key) ?? [];
      group.push(read);
      groups.set(key, group);
    }
    // Full source reads supersede an earlier incomplete read. Disjoint pages only
    // count together when the same exact source identity and full range are covered.
    for (const group of groups.values()) {
      const full = group.filter(read => read.complete).at(-1);
      const complete = Boolean(full) || studioPagesComplete(group);
      for (const read of full ? [full] : group) {
        verifierReads.push({
          ref: read.ref,
          complete,
          readAt: new Date().toISOString(),
          turnIndex: read.call.turnIndex,
          entryId: read.call.entryId,
          sessionId: read.call.sessionId,
          toolCallId: read.call.id,
          fromAssessmentTurn: read.call.turnIndex === boundary.turnIndex,
        });
      }
    }

    const complete = verifierReads.filter(read => read.complete);
    const required = requiredRefs.flatMap(ref => complete.filter(read => readCoversSource(read.ref, ref)));
    const targetReads = complete.filter(read => exactTaskReport(read.ref, target));
    const inputs = complete.filter(({ ref }) => ref.authority === 'data' && ref.projectId === verifierProjectId &&
      projectFileLocator(ref.locator, '020_clean') && !!ref.sha256 && authorizedInputs.get(ref.locator) === ref.sha256);
    for (const read of inputs) read.authorizedInput = true;
    const summaryRef = purpose.summaryAccess?.summaryRef;
    const summaryReads = summaryRef && evidence?.coverage?.summaryRef && readCoversSource(evidence.coverage.summaryRef, summaryRef)
      ? complete.filter(read => readCoversSource(read.ref, summaryRef)) : [];
    const numberOfRequired = requiredRefs.filter(ref => required.some(read => readCoversSource(read.ref, ref))).length;
    const isSummary = use.accessLevel === 'summary';
    const isRecalculation = !isSummary && use.tier !== 'definition-reference';
    summary.readRequiredAssetsCount = numberOfRequired;
    summary.allRequiredReadByVerifier = numberOfRequired === requiredRefs.length;
    summary.targetReportChecked = targetReads.length > 0;
    summary.targetReportReadTurnIndex = targetReads.at(-1)?.turnIndex;
    summary.authorizedInputChecked = inputPaths.length > 0 && inputPaths.every(locator => inputs.some(read => read.ref.locator === locator));
    summary.authorizedInputReadTurnIndices = [...new Set(inputs.flatMap(read => read.turnIndex ?? []))].sort((a, b) => a - b);
    summary.carriedFromTurnIndices = [...new Set([...required, ...targetReads, ...inputs, ...summaryReads]
      .flatMap(read => read.turnIndex !== undefined && read.turnIndex < boundary.turnIndex ? [read.turnIndex] : []))].sort((a, b) => a - b);
    summary.hadDataOrCalcEvidence = summary.targetReportChecked &&
      (!isRecalculation || summary.authorizedInputChecked) && (!isSummary || summaryReads.length > 0);
    let reportBytes = readPreservedReportBytes(verifierProjectId, verifierTaskId, report.locator, report.sha256);
    if (!reportBytes) {
      try { reportBytes = (await options.projects.readFile(verifierProjectId, report.locator)).bytes; }
      catch { return pending('独立核验报告未通过原件摘要核对，保持待验证'); }
    }
    if (createHash('sha256').update(reportBytes).digest('hex') !== report.sha256) {
      return pending('独立核验报告未通过原件摘要核对，保持待验证');
    }
    preserveImmutableReportSnapshot(verifierProjectId, report.locator, reportBytes, report.sha256);
    // The Agent's explicit statement of non-comparison is negative evidence only.
    // The use, report, input and call receipts establish every positive check.
    const declinedComparison = /(?:未(?:查看|读取|阅览|核对|对照|复核|重算|复算)(?:原|目标|待核)?(?:报告|原稿|正文|数据|明细)|(?:没有|并未|尚未)(?:查看|读取|核对|对照|复核|重算|复算)(?:原|目标|待核)?(?:报告|原稿|正文|数据|明细)|未读取也未对照|未查看[、，,\s]*未对照|did\s+not\s+(?:read|inspect|view|compare|recalculate|verify)\s+(?:the\s+)?(?:original|target)\s+(?:report|data))/iu;
    summary.assessmentDisclaimerRejected = declinedComparison.test(`${reportBytes.toString('utf8')}\n${assessment.result}`);
    if (summary.assessmentDisclaimerRejected) {
      return pending('独立核验明确说明未查阅或未对照原报告／明细，保持待验证');
    }
    if (!summary.targetReportChecked) return pending('独立任务未在对应评估前完整读取这份报告的准确版本，保持待验证');
    if (evidence && (!exactTaskReport(evidence.targetReport, target) || (evidence.purposeId && evidence.purposeId !== use.purposeId))) {
      return pending('独立核验声明引用了不同的报告版本或用途，保持待验证');
    }

    summary.assessmentReportBoundToTarget = true;

    let targetBody: string | undefined;
    if (evidence?.finding && target.sha256) {
      targetBody = sourceReads.find(read => read.complete && exactTaskReport(read.ref, target) && read.body !== undefined &&
        createHash('sha256').update(read.body).digest('hex') === target.sha256)?.body;
      if (targetBody === undefined && target.projectId && target.taskId && projectFileLocator(target.locator, '060_reports')) {
        let bytes = readPreservedReportBytes(target.projectId, target.taskId, target.locator, target.sha256);
        try {
          bytes ??= (await options.projects.readFile(target.projectId, target.locator)).bytes;
          if (createHash('sha256').update(bytes).digest('hex') === target.sha256) targetBody = bytes.toString('utf8');
        } catch { /* the exact report body is unavailable */ }
      }
    }
    const claim = qualifyAssessmentClaims({
      assessment, targetBody, requiredRefs,
      actuallyRead: complete.map(read => read.ref),
      comparisonSources: [...required, ...inputs, ...summaryReads].map(read => read.ref),
    });
    if (claim.contradictoryPass) return pending('核验结论为通过，但提交的报告值与独立复算值不一致，保持待验证');
    if (claim.wrongVersion) return { verifierReads, summary, wrongVersion: true, failed: true };
    if (!summary.allRequiredReadByVerifier) return pending(`独立核验尚未完整实读适用原依赖（${numberOfRequired}/${requiredRefs.length}），保持待验证`);
    if (!summary.hadDataOrCalcEvidence) return pending('独立核验尚未完整实读与原报告相符的获准输入或准确汇总，保持待验证');
    if ((isRecalculation || isSummary || assessment.status === 'fail') && !claim.usefulComparison && !claim.auditableFinding) {
      return pending('独立核验缺少带覆盖依据的对照结果或可回查的核验发现，保持待验证');
    }
    if (assessment.status === 'unknown') return pending('独立任务声明本次核验结果待查');
    return { verifierReads, summary, wrongVersion: false, failed: assessment.status === 'fail' };
  }

  function redactPackForConsumer(pack: EnterpriseDomainPack, projectId: string): EnterpriseDomainPack {
    const { activeOwnerProjectId: _owner, continuationHistory: _continuations, ...visiblePack } = pack;
    const subjectGrants = projectGrants(pack.enterpriseId, projectId);
    const nowMs = Date.now();
    const activeGrants = subjectGrants.filter(g => !g.revokedAt && (!g.validFrom || Date.parse(g.validFrom) <= nowMs) && (!g.validTo || Date.parse(g.validTo) >= nowMs));
    const ownPins = pack.taskPins.filter(p => p.projectId === projectId);
    const ownUses = pack.useRecords.filter(u => u.projectId === projectId);
    const purposeForUse = (use: EnterprisePackUseRecord) => pack.packRevisions.find(revision => revision.version === use.packVersion)
      ?.purposeManifests.find(purpose => purpose.purposeId === use.purposeId);
    const mayReadUse = (use: EnterprisePackUseRecord) => reportUseCovered(use, purposeForUse(use), activeGrants);
    const unavailableEvidence = (use: EnterprisePackUseRecord): EnterprisePackUseRecord['independentVerification'] => ({
      status: use.independentVerification.status,
      verdictDetail: '当前权限不足以展示原核验资料。历史记录已保留。',
    });
    const publicFeedbackReport = (report: EnterpriseDomainPack['feedbackItems'][number]['reports'][number]) => {
      const linked = ownUses.find(use => use.id === report.linkedUseRecordId);
      return linked && mayReadUse(linked) ? report : {
        ...report, usedAssetRefs: [], sourceReads: undefined, assessmentReportRef: undefined,
        ...(linked ? { evidenceNote: '当前权限不足以展示原采用资料。' } : {}),
      };
    };
    const ownFeedback = pack.feedbackItems
      .filter(f => f.reports.some(r => r.projectId === projectId))
      .map(f => ({ ...f, reports: f.reports.filter(r => r.projectId === projectId) }));
    const ownPinnedVersions = new Set([...ownPins.map(p => p.packVersion), ...ownUses.map(u => u.packVersion)]);

    // Unified purpose & dependency filter identical to buildPackCatalogSummary & inspectPinnedSourceRead!
    const filterPurposeManifest = (pm: EnterpriseDomainPack['packRevisions'][number]['purposeManifests'][number]) => {
      const access = evaluatePurposeAccessForSubject(subjectGrants, pm);
      if (!access) return null;
      return {
        ...pm,
        dependencies: access.visibleDeps,
      };
    };

    if (activeGrants.length === 0) {
      // Ungranted or revoked project: strip ALL unauthorized purpose manifests, dependencies, and module receipts!
      const strippedRevisions = pack.packRevisions
        .filter(r => ownPinnedVersions.has(r.version))
        .map(r => ({
          ...r,
          decisionsSnapshot: [],
          purposeManifests: [],
          moduleReceipts: [],
        }));
      return {
        ...visiblePack,
        upgradeImpacts: [],
        panorama: undefined,
        panoramaHistory: [],
        entries: [],
        purposes: [],
        previews: [],
        packRevisions: strippedRevisions,
        taskPins: ownPins.map(p => ({ ...p, purposeIds: [], pinnedAuthorityRefs: [] })),
        useRecords: ownUses.map(u => ({
          ...u,
          catalogSupplied: { ...u.catalogSupplied, purposeIds: [], assetRefs: [] },
          actualReads: [],
          authorDeclaration: undefined,
          independentVerification: unavailableEvidence(u),
        })),
        feedbackItems: ownFeedback.map(f => ({
          ...f,
          targetAssetRef: undefined,
          authorityHandling: undefined,
          revisionLink: undefined,
          reports: f.reports.map(publicFeedbackReport),
        })),
      };
    }

    const activeSummaryRefs = activeGrants
      .filter(g => g.operations.includes('cite-summary') && g.resourceRef)
      .map(g => g.resourceRef!);

    // Active consumer project (or rollback mode with existing pins & active grants):
    // filter revisions, purposeManifests, dependencies, AND moduleReceipts using the exact same permission filter!
    const filteredRevisions = pack.packRevisions
      .filter(r => enabled || ownPinnedVersions.has(r.version))
      .map(r => {
        const manifests = r.purposeManifests.map(filterPurposeManifest).filter((x): x is NonNullable<typeof x> => Boolean(x));
        if (!manifests.length && !ownPinnedVersions.has(r.version)) return null;
        const allowedRevPurposeIds = new Set(manifests.map(m => m.purposeId));
        const allowedRevRefs = [
          ...manifests.flatMap(m => m.dependencies.map(d => d.ref)),
          ...activeSummaryRefs,
        ];
        const filteredReceipts = r.moduleReceipts
          .filter(rec =>
            allowedRevRefs.some(ar => sameExactSourceRef(ar, rec.targetRef))
            && rec.purposeIds.some(pid => allowedRevPurposeIds.has(pid)),
          )
          .map(rec => ({
            ...rec,
            purposeIds: rec.purposeIds.filter(pid => allowedRevPurposeIds.has(pid)),
          }));
        return {
          ...r,
          decisionsSnapshot: [],
          purposeManifests: manifests,
          moduleReceipts: filteredReceipts,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    const allowedPurposeIds = new Set(filteredRevisions.flatMap(r => r.purposeManifests.map(pm => pm.purposeId)));
    const allAllowedRefs = [
      ...filteredRevisions.flatMap(r => r.purposeManifests.flatMap(pm => pm.dependencies.map(d => d.ref))),
      ...activeSummaryRefs,
    ];
    const isRefAllowed = (ref: StudioSourceRef) => allAllowedRefs.some(ar => sameExactSourceRef(ar, ref));

    return {
      ...visiblePack,
        upgradeImpacts: [],
      panorama: undefined,
      panoramaHistory: [],
      entries: [],
      purposes: pack.purposes
        .filter(p => allowedPurposeIds.has(p.id))
        .map(p => ({ ...p, dependencies: p.dependencies.filter(d => isRefAllowed(d.ref)) })),
      previews: [],
      packRevisions: filteredRevisions,
      taskPins: ownPins.map(p => ({
        ...p,
        purposeIds: p.purposeIds.filter(pid => allowedPurposeIds.has(pid)),
        pinnedAuthorityRefs: p.pinnedAuthorityRefs.filter(isRefAllowed),
      })),
      useRecords: ownUses.map(u => ({
        ...u,
        catalogSupplied: {
          ...u.catalogSupplied,
          purposeIds: u.catalogSupplied.purposeIds.filter(pid => allowedPurposeIds.has(pid)),
          assetRefs: u.catalogSupplied.assetRefs.filter(isRefAllowed),
        },
        actualReads: mayReadUse(u) ? u.actualReads.filter(r => isRefAllowed(r.ref)) : [],
        independentVerification: mayReadUse(u) ? {
          ...u.independentVerification,
          verifierActualReads: u.independentVerification.verifierActualReads?.filter(read => isRefAllowed(read.ref)),
        } : unavailableEvidence(u),
        ...(u.authorDeclaration && mayReadUse(u) ? {
          authorDeclaration: {
            ...u.authorDeclaration,
            declaredRefs: u.authorDeclaration.declaredRefs.filter(isRefAllowed),
          },
        } : { authorDeclaration: undefined }),
      })),
      feedbackItems: ownFeedback.map(f => ({
        ...f,
        ...(f.targetAssetRef && !isRefAllowed(f.targetAssetRef) ? { targetAssetRef: undefined } : {}),
        reports: f.reports.map(report => { const visible = publicFeedbackReport(report); return { ...visible, usedAssetRefs: visible.usedAssetRefs.filter(isRefAllowed) }; }),
      })),
    };
  }

  async function resolveGrantAuthorityForProject(
    enterpriseId: string,
    projectId: string,
    pack?: EnterpriseDomainPack,
    operator?: TrustedHostOperator,
  ): Promise<GrantAuthorityCredential | undefined> {
    try {
      const pid = uuid(projectId);
      const proj = await options.projects.get(pid);
      if (proj.archivedAt !== null) return undefined;
      if (options.enterpriseScopes.enterpriseIdForProject(pid) !== enterpriseId) return undefined;
      if (operator) {
        if (!operator.verified || !operator.operatorId.trim()) return undefined;
        // If Host-signed HttpOnly operator context cookie pins an active project, refuse cross-project spoofing!
        if (operator.activeProjectId && operator.activeProjectId !== pid) return undefined;
      }
      const effectiveOperatorId = operator?.operatorId?.trim() || '';
      if (!effectiveOperatorId) return undefined;
      const isOperatorAllowedForSystem = (systemId: string): boolean => {
        const boundOp = getBoundSystemOperator(systemId);
        if (boundOp) return boundOp === effectiveOperatorId;
        // Only a trusted owner mapping can qualify legacy unbound systems.
        return operator?.authorityProjectId === pid;
      };
      if (pack) {
        if (!isConstructionOwnerProject(pack, pid)) return undefined;
        if (!isOperatorAllowedForSystem(pack.systemId)) return undefined;
        let ownerTaskId: string | undefined;
        try {
          const sys = options.studio.get(pack.systemId);
          const execOwner = studioExecutionOwner(sys);
          if (execOwner.projectId === pid) ownerTaskId = execOwner.taskId;
          else ownerTaskId = pack.continuationHistory?.filter(h => h.projectId === pid).at(-1)?.taskId;
        } catch {
          ownerTaskId = pack.continuationHistory?.filter(h => h.projectId === pid).at(-1)?.taskId;
        }
        return mintGrantAuthorityCredential({
          enterpriseId,
          systemId: pack.systemId,
          ownerProjectId: pid,
          ...(ownerTaskId ? { ownerTaskId } : {}),
          operatorId: effectiveOperatorId,
        });
      }
      const enterprisePacks = packs.list(enterpriseId);
      for (const p of enterprisePacks) {
        if (isConstructionOwnerProject(p, pid)) {
          return resolveGrantAuthorityForProject(enterpriseId, pid, p, operator);
        }
      }
      const ownedSystem = options.studio.list().find(s => s.enterpriseId === enterpriseId && studioExecutionOwner(s).projectId === pid);
      if (!ownedSystem) return undefined;
      if (!isOperatorAllowedForSystem(ownedSystem.id)) return undefined;
      const execOwner = studioExecutionOwner(ownedSystem);
      return mintGrantAuthorityCredential({
        enterpriseId,
        systemId: ownedSystem.id,
        ownerProjectId: pid,
        ownerTaskId: execOwner.taskId,
        operatorId: effectiveOperatorId,
      });
    } catch {
      return undefined;
    }
  }

  /**
   * R4: Automatically records an EnterprisePackUseRecord when normal analysis calls
   * `studio_assets declare-use`, strictly scoped to THIS turn's native reads and starting
   * at `independentVerification.status = 'pending'` (never self-verified as pass).
   */
  async function recordUseFromStudioDeclaration(input: {
    systemId: string;
    projectId: string;
    taskId: string;
    studioUse: StudioUseRecord;
  }): Promise<EnterprisePackUseRecord[]> {
    if (!enabled) return [];
    // R5: Always preserve immutable copy of any Studio-declared report (both restricted & ordinary/owner tasks)!
    if (input.studioUse.report.projectId && input.studioUse.report.locator?.startsWith('060_reports/')) {
      try {
        const repFile = await options.projects.readFile(input.studioUse.report.projectId, input.studioUse.report.locator);
        preserveImmutableReportSnapshot(input.studioUse.report.projectId, input.studioUse.report.locator, repFile.bytes, input.studioUse.report.sha256);
      } catch { /* best-effort preservation */ }
    }
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(input.projectId);
    if (!enterpriseId) return [];
    const matchingPacks = packs.list(enterpriseId).filter(p => p.systemId === input.systemId);
    if (!matchingPacks.length) return [];

    const created: EnterprisePackUseRecord[] = [];
    const subjectGrants = projectGrants(enterpriseId, input.projectId);
    const nowMs = Date.now();
    const activeGrants = subjectGrants.filter(g => !g.revokedAt && (!g.validFrom || Date.parse(g.validFrom) <= nowMs) && (!g.validTo || Date.parse(g.validTo) >= nowMs));

    for (const pack of matchingPacks) {
      const existingPin = packs.getTaskPin(pack.id, input.projectId, input.taskId);
      const rev = existingPin
        ? pack.packRevisions.find(r => r.version === existingPin.packVersion)
        : pack.packRevisions.find(r => r.status === 'active');
      if (!rev) continue;

      const nativeEv = await inspectTaskNativeEvidence(input.projectId, input.taskId, pack);
      const declaredRefs = input.studioUse.sources;
      const readRefs = nativeEv.actualReads.filter(r => r.complete).map(r => r.ref);
      const candidateRefs = [...declaredRefs, ...readRefs];

      const isConstruction = isConstructionOwnerProject(pack, input.projectId);
      const eligiblePurposes = rev.purposeManifests.filter(pm => {
        if (pm.status !== 'eligible') return false;
        if (!isConstruction && !evaluatePurposeAccessForSubject(subjectGrants, pm)) return false;
        return pm.dependencies.some(dep => candidateRefs.some(ref => sameExactSourceRef(dep.ref, ref)));
      });

      if (!eligiblePurposes.length) continue;

      // Prefer calculation-tier purposes when their dependencies match, otherwise record each matched purpose once
      const sortedPurposes = [...eligiblePurposes].sort((a, b) => {
        const score = (tier: string) => (tier === 'formal-calculation' ? 2 : tier === 'limited-calculation' ? 1 : 0);
        return score(b.tier) - score(a.tier);
      });

      for (const pm of sortedPurposes) {
        const already = pack.useRecords.find(use => use.purposeId === pm.purposeId && matchesStudioUse(use, input.studioUse));
        if (already) {
          created.push(already);
          continue;
        }
        const purposeAccess = evaluatePurposeAccessForSubject(activeGrants, pm);
        const hasDetailGrant = isConstruction || Boolean(purposeAccess?.hasPartialOrFullDetail);
        const hasSummaryGrant = Boolean(purposeAccess?.canSummary.allowed);
        const accessLevel: 'definition' | 'summary' | 'recalculate' =
          (pm.tier === 'formal-calculation' || pm.tier === 'limited-calculation') && hasDetailGrant
            ? 'recalculate'
            : hasSummaryGrant && !hasDetailGrant
              ? 'summary'
              : 'definition';

        const recorded = packs.recordUse(pack.id, {
          projectId: input.projectId,
          taskId: input.taskId,
          ...(nativeEv.resolvedSelection ? { sessionId: nativeEv.resolvedSelection.sessionId, messageId: nativeEv.resolvedSelection.messageId } : {}),
          ...(nativeEv.turnIndex !== undefined ? { turnIndex: nativeEv.turnIndex } : {}),
          reportRef: input.studioUse.report,
          packVersion: rev.version,
          purposeId: pm.purposeId,
          purposeKey: pm.purposeKey,
          tier: pm.tier,
          accessLevel,
          ...(pm.policyEffectiveFrom ? { policyEffectiveFrom: pm.policyEffectiveFrom } : {}),
          ...(nativeEv.taskCutoffAt ? { dataCutoffAt: nativeEv.taskCutoffAt } : {}),
          catalogSupplied: {
            packVersion: nativeEv.observedDirectoryVersion ?? nativeEv.sessionObservedDirectoryVersion ?? existingPin?.packVersion ?? rev.version,
            purposeIds: nativeEv.catalogPurposeIds.length ? nativeEv.catalogPurposeIds : (existingPin?.purposeIds ?? [pm.purposeId]),
            assetRefs: nativeEv.catalogAssetRefs.length ? nativeEv.catalogAssetRefs : (existingPin?.pinnedAuthorityRefs ?? pm.dependencies.map(d => d.ref)),
            suppliedAt: nativeEv.catalogSuppliedAt ?? existingPin?.pinnedAt ?? new Date().toISOString(),
          },
          actualReads: nativeEv.actualReads,
          authorDeclaration: {
            declaredPurposeId: pm.purposeId,
            studioUseId: input.studioUse.id,
            declaredRefs: input.studioUse.sources,
            summaryText: input.studioUse.result || '来自原 Studio declare-use 本轮作者采用声明',
            declaredAt: input.studioUse.createdAt,
          },
        });
        created.push(recorded);
      }
    }
    return created;
  }

  function matchesStudioUse(use: EnterprisePackUseRecord, studioUse: StudioUseRecord) {
    const declaration = use.authorDeclaration;
    return Boolean(declaration && use.projectId === studioUse.projectId && use.taskId === studioUse.taskId &&
      exactTaskReport(use.reportRef, studioUse.report) &&
      (declaration.studioUseId ? declaration.studioUseId === studioUse.id : declaration.declaredAt === studioUse.createdAt));
  }

  async function applyStudioAssessment(
    pack: EnterpriseDomainPack,
    use: EnterprisePackUseRecord,
    studioUse: StudioUseRecord,
    assessment: StudioUseAssessment,
  ) {
    const verifierProjectId = assessment.assessorProjectId;
    const verifierTaskId = assessment.assessorTaskId;
    const independent = !!verifierProjectId && !!verifierTaskId &&
      (verifierProjectId !== use.projectId || verifierTaskId !== use.taskId) && !exactTaskReport(use.reportRef, assessment.report);
    let verification: Awaited<ReturnType<typeof inspectVerifierTaskEvidence>> | undefined;
    let verdictDetail = '仅见原任务自评或缺少核验任务身份，保持待验证';
    if (independent) {
      const verifyReportAccess = () => {
        if (verifierProjectId !== use.projectId) assertDeclaredReportAccess(pack.systemId, verifierProjectId, studioUse);
      };
      try {
        verifyReportAccess();
        verification = await inspectVerifierTaskEvidence(verifierProjectId, verifierTaskId, pack, use, studioUse.id, assessment);
        verifyReportAccess();
        verdictDetail = verification.summary.missingReason ?? assessment.result;
      } catch (error) {
        if (!(error instanceof StudioError) || error.status !== 403) throw error;
        verification = undefined;
        verdictDetail = '当前核验任务缺少对该用途原报告的有效授权，保持待验证';
      }
    }
    return packs.verifyUse(pack.id, use.id, {
      verifierRole: independent ? '独立核验任务' : '原任务作者自评',
      ...(verifierProjectId ? { verifierProjectId } : {}),
      ...(verifierTaskId ? { verifierTaskId } : {}),
      assessmentReportRef: assessment.report,
      selfAssessmentOnly: !independent,
      ...(verification ? {
        verifierActualReads: verification.verifierReads,
        verifierEvidenceSummary: verification.summary,
        wrongVersionConfirmedByVerifier: verification.wrongVersion,
        independentFailed: verification.failed,
      } : {}),
      independentConfirmed: assessment.status === 'pass' && !!verification && !verification.summary.missingReason,
      checkedRefs: assessment.sources,
      verdictDetail,
    });
  }

  async function syncAssessmentFromStudio(input: {
    systemId: string;
    studioUse: StudioUseRecord;
    assessment: StudioUseAssessment;
    assessorProjectId: string;
    assessorTaskId: string;
  }): Promise<EnterprisePackUseRecord[]> {
    if (!enabled) return [];
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(input.studioUse.projectId);
    if (!enterpriseId || options.enterpriseScopes.enterpriseIdForProject(input.assessorProjectId) !== enterpriseId ||
        input.assessment.assessorProjectId !== input.assessorProjectId || input.assessment.assessorTaskId !== input.assessorTaskId) return [];
    const updated: EnterprisePackUseRecord[] = [];
    for (const pack of packs.list(enterpriseId).filter(item => item.systemId === input.systemId)) {
      const matched = pack.useRecords.filter(use => matchesStudioUse(use, input.studioUse));
      const purposeId = input.assessment.evidence?.purposeId;
      if (!purposeId && new Set(matched.map(use => use.purposeId)).size > 1) continue;
      for (const use of matched.filter(use => !purposeId || use.purposeId === purposeId)) {
        updated.push(await applyStudioAssessment(pack, use, input.studioUse, input.assessment));
      }
    }
    return updated;
  }

  function businessDate(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      const captured = new Date(value);
      if (Number.isFinite(captured.getTime())) value = captured.toISOString();
    }
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return undefined;
    const day = value.slice(0, 10);
    const midnight = Date.parse(`${day}T00:00:00Z`);
    return Number.isFinite(Date.parse(value)) && Number.isFinite(midnight) && new Date(midnight).toISOString().startsWith(day) ? day : undefined;
  }

  function isTaskReport(ref: StudioSourceRef, projectId: string, taskId: string): boolean {
    return ref.projectId === projectId && ref.taskId === taskId && exactTaskReport(ref, ref)
      && projectFileLocator(ref.locator, '060_reports');
  }

  async function readExactTaskReport(ref: StudioSourceRef, projectId: string, taskId: string): Promise<Buffer | undefined> {
    if (!isTaskReport(ref, projectId, taskId)) return undefined;
    const locator = ref.locator!;
    const preserved = readPreservedReportBytes(projectId, taskId, locator, ref.sha256);
    if (preserved && createHash('sha256').update(preserved).digest('hex') === ref.sha256) return preserved;
    try {
      const resolved = resolveTaskReportLocator(projectId, taskId, locator, ref.sha256);
      const { bytes } = await options.projects.readFile(projectId, resolved);
      return createHash('sha256').update(bytes).digest('hex') === ref.sha256 ? bytes : undefined;
    } catch { return undefined; }
  }

  interface InputSnapshot {
    binding: EnterprisePackFeedbackSourceRead;
    body: string;
    observedOn?: string;
  }

  async function readSourceSnapshots(projectId: string, taskId: string, receipts: ReturnType<typeof collectNativeEvidence>['results']): Promise<InputSnapshot[]> {
    const project = await options.projects.get(projectId).catch(() => undefined);
    if (!project) return [];
    const workspace = path.resolve(options.dataRoot, 'member-pack-workspaces', projectId, taskId);
    const root = fs.existsSync(workspace) ? workspace : project.rootPath;
    return receipts.flatMap(receipt => {
      const { call, message } = receipt;
      if (!call.sessionId || !call.entryId) return [];
      const read = readNativeFileEvidence(receipt, {
        projectId, taskId,
        cleanDir: path.join(root, '020_clean'), reportsDir: path.join(root, '060_reports'),
      });
      if (!read?.locator.startsWith('020_clean/')) return [];
      return [{
        binding: {
          ref: sourceRef({
            authority: 'data', id: createHash('sha256').update(read.locator).digest('hex'),
            projectId, taskId, locator: read.locator, sha256: read.sha256, version: read.sha256,
          }),
          sessionId: call.sessionId, entryId: call.entryId, toolCallId: call.id,
        },
        body: read.body,
        observedOn: businessDate(message.details?.observedAt ?? message.timestamp ?? message.createdAt),
      }];
    });
  }

  async function readReportInputSnapshots(
    projectId: string,
    taskId: string,
    report: StudioSourceRef,
    reply?: { sessionId: string; messageId: string },
    studioUseId?: string,
  ): Promise<{ snapshots: InputSnapshot[]; cutoff?: string }> {
    if (!isTaskReport(report, projectId, taskId) || !options.taskSnapshot) return { snapshots: [] };
    const snapshot = await options.taskSnapshot(projectId, taskId).catch(() => undefined);
    if (!snapshot) return { snapshots: [] };
    const { messages } = snapshot;
    const replyIndex = reply ? messages.findIndex(m =>
      m.role === 'assistant' && m.nativeSessionId === reply.sessionId && m.nativeEntryId === reply.messageId,
    ) : messages.length - 1;
    if (replyIndex < 0) return { snapshots: [] };
    const { results } = collectNativeEvidence(messages);
    const latestUserIndex = (endIndex: number) => {
      for (let i = endIndex; i >= 0; i--) if (messages[i]?.role === 'user') return i;
      return -1;
    };
    const userIndex = reply ? latestUserIndex(replyIndex) : -1;
    const reportReceipt = results.find(({ call, message, index }) => {
      if (index > replyIndex || call.index <= userIndex || (reply && call.sessionId !== reply.sessionId) || message.isError) return false;
      const details = message.details;
      if (details?.type === 'optracall.studio' && details.action === 'declare-use') {
        const declared = details.result?.use;
        return declared?.report && (!studioUseId || declared.id === studioUseId) && exactTaskReport(declared.report, report);
      }
      return !studioUseId && details?.type === 'optracall.project-report-write'
        && details.projectId === projectId && details.taskId === taskId
        && details.relativePath === report.locator && details.sha256 === report.sha256 && !details.reused;
    });
    if (!reportReceipt) return { snapshots: [] };
    const turnStart = latestUserIndex(reportReceipt.call.index);
    if (turnStart < 0) return { snapshots: [] };
    const receipts = results.filter(({ call, index }) => call.index > turnStart
      && index < reportReceipt.call.index && call.sessionId === reportReceipt.call.sessionId);
    return {
      snapshots: await readSourceSnapshots(projectId, taskId, receipts),
      cutoff: businessDate(extractTaskCutoffFromText(messageText(messages[turnStart]))),
    };
  }

  async function readAssessorInputSnapshots(use: EnterprisePackUseRecord): Promise<InputSnapshot[]> {
    const verification = use.independentVerification;
    if (!verification.verifierProjectId || !verification.verifierTaskId || !options.taskSnapshot) return [];
    const snapshot = await options.taskSnapshot(verification.verifierProjectId, verification.verifierTaskId).catch(() => undefined);
    if (!snapshot) return [];
    const { results } = collectNativeEvidence(snapshot.messages);
    const verifiedData = verification.verifierActualReads?.filter(r => r.complete && r.authorizedInput === true && r.ref.authority === 'data') ?? [];
    const receipts = results.filter(({ call }) => verifiedData.some(r => r.sessionId === call.sessionId
      && r.entryId === call.entryId && r.toolCallId === call.id));
    const snapshots = await readSourceSnapshots(verification.verifierProjectId, verification.verifierTaskId, receipts);
    return snapshots.filter(({ binding }) => verifiedData.some(r =>
      r.sessionId === binding.sessionId && r.entryId === binding.entryId && r.toolCallId === binding.toolCallId
      && r.ref.projectId === binding.ref.projectId && r.ref.taskId === binding.ref.taskId
      && r.ref.locator === binding.ref.locator && r.ref.sha256 === binding.ref.sha256,
    ));
  }

  type DecisionRevision = ReturnType<CaseStore['getDecision']>;

  function resolveOriginalCase(input: {
    projectId: string;
    taskId: string;
    selection: { sessionId: string; messageId: string };
    replySha: string;
    originTime?: number;
    requested?: Record<string, unknown>;
  }): EnterprisePackOriginalCaseRef | undefined {
    const cases = options.cases;
    if (!cases) return undefined;
    const { projectId, taskId, selection, replySha, originTime, requested } = input;
    // Case decision and choice custodies have their own exact revisions.
    const atOrigin = (value: string) => originTime !== undefined && Date.parse(value) <= originTime;
    const exactReply = (ref: { type: string } & Record<string, unknown>) =>
      ref.type === 'native-reply' && ref.projectId === projectId && ref.taskId === taskId
      && ref.sessionId === selection.sessionId && ref.messageId === selection.messageId
      && ref.expectedTextSha256 === replySha;
    const referencesReply = (decision: DecisionRevision) => decision.references.some(({ target }) =>
      target.type === 'source' && exactReply(target.source),
    );

    let linkedCaseIds: string[];
    try { linkedCaseIds = cases.listHistoricallyLinkedCaseIds(projectId); }
    catch { return undefined; }
    const requestedCaseId = requested ? uuid(requested.caseId) : undefined;
    const relevant = linkedCaseIds.filter(caseId => !requestedCaseId || caseId === requestedCaseId);
    const candidates = relevant.flatMap(caseId => {
      const events = cases.getEvents('case', caseId);
      const originalEvents = events.filter(event => atOrigin(event.occurredAt));
      const originalLink = originalEvents.filter(event =>
        ['project_linked', 'project_unlinked'].includes(event.eventType)
        && [event.changes.projectLink?.after, event.changes.projectLink?.before].some(value =>
          object(value) && value.projectId === projectId,
        ),
      ).at(-1)?.eventType === 'project_linked';

      const history: DecisionRevision[] = [];
      let cursor: string | null | undefined;
      do {
        const page = cases.listDecisions(caseId, { history: true, includeArchived: true, continuation: cursor });
        history.push(...page.items);
        cursor = page.continuation;
      } while (cursor);

      const headsAtOrigin = new Map<string, DecisionRevision>();
      for (const decision of history.filter(item => atOrigin(item.createdAt))) {
        if ((headsAtOrigin.get(decision.recordId)?.revision ?? 0) < decision.revision) {
          headsAtOrigin.set(decision.recordId, decision);
        }
      }
      const sourceMatches = history.filter(decision => referencesReply(decision)
        && (atOrigin(decision.createdAt) || decision.revision === 1));
      const atOriginMatches = [...headsAtOrigin.values()].filter(decision =>
        sourceMatches.some(source => source.recordId === decision.recordId)
        || (originalLink && decision.origin.actorKind === 'agent' && decision.origin.projectId === projectId
          && decision.origin.taskId === taskId && decision.origin.sessionId === selection.sessionId),
      );
      // A first decision made in response to this exact reply is attributable. A later
      // revision cannot turn an old report into its own original supporting decision.
      const matches = [
        ...atOriginMatches,
        ...sourceMatches.filter(item => item.revision === 1 && !headsAtOrigin.has(item.recordId)),
      ];
      if (!originalLink && !matches.length) return [];
      const decision = matches.length === 1 ? matches[0] : undefined;
      const choice = decision && cases.getStrategyChoices(caseId).filter(item =>
        item.strategyRef.recordId === decision.recordId && item.strategyRef.revision === decision.revision
        && atOrigin(item.occurredAt),
      ).at(-1);
      const knownCaseEvent = originalEvents.at(-1);
      const title = (knownCaseEvent
        ? originalEvents.filter(event => typeof event.changes.title?.after === 'string').at(-1)?.changes.title?.after
        : events.find(event => event.eventType === 'case_created')?.changes.title?.after) as string | undefined;
      return [{
        caseId,
        ...(title ? { caseTitle: title, summary: title } : {}),
        ...(knownCaseEvent ? { caseRevision: knownCaseEvent.revision } : {}),
        ...(decision ? {
          decisionId: decision.recordId, decisionRevision: decision.revision,
          decisionKind: decision.kind, decisionTitle: decision.payload.title,
          originReplySha256: replySha,
        } : {}),
        ...(choice ? { choiceId: choice.choiceId } : {}),
        ...(originTime !== undefined ? { originTimestamp: new Date(originTime).toISOString() } : {}),
        decisionResolutionStatus: decision ? 'pinned' as const : 'unresolved_ambiguous' as const,
        ...(!decision ? { resolutionNote: '原回复没有可唯一归属的 Case 决策修订，保留待核。' } : {}),
      }];
    });
    const selected = candidates.length === 1 ? candidates[0] : undefined;
    if (requestedCaseId && !selected) throw new StudioError('feedback_verification_case_not_attributable', 409);
    if (requested && selected && (
      (requested.decisionId !== undefined && requested.decisionId !== selected.decisionId)
      || (requested.decisionRevision !== undefined && requested.decisionRevision !== selected.decisionRevision)
      || (requested.choiceId !== undefined && requested.choiceId !== selected.choiceId)
    )) throw new StudioError('feedback_verification_case_decision_mismatch', 409);
    return selected;
  }

  interface SourceTransactionRow {
    source: EnterprisePackFeedbackSourceRead;
    rowNumber: number;
    itemId: string;
    originalOrderId: string;
    orderDate: string;
    store?: string;
    refundDate?: string;
    fullRefund?: boolean;
    visibleOn: string;
  }

  function parseFullRefundFlag(raw: string): boolean | undefined {
    const low = raw.trim().toLowerCase();
    if (!low) return undefined;
    if (['true', '1', 'yes', 'y', 'full', 'full_refund', '是', '全额', '全额退款', '已全退'].includes(low)) return true;
    if (['false', '0', 'no', 'n', 'partial', 'none', '否', '未退款', '部分退款'].includes(low)) return false;
    return undefined;
  }

  function parseSimpleCsvLine(line: string, delimiter: string): string[] | undefined {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        cells.push(cur); cur = '';
      } else {
        cur += ch;
      }
    }
    if (inQuotes) return undefined;
    cells.push(cur);
    return cells;
  }

  function inspectSourceTransactions(snapshots: readonly InputSnapshot[], cutoff: string): SourceTransactionRow[] {
    const fields = {
      itemId: ['account', 'member_id', 'member', 'user_id', 'item_id', 'customer_id', '会员账号', '账号', '会员id', '记录编号'],
      originalOrderId: ['repeat_order_id', 'original_order_id', 'order_id', 'source_order_id', '原订单号', '订单号', '关联订单', '复购订单号'],
      orderDate: ['repeat_order_date', 'order_date', 'purchase_date', '下单日期', '复购日期', '交易日期'],
      store: ['store', 'store_id', 'store_name', 'shop', 'shop_id', '门店', '门店名称', '门店编码'],
      refundDate: ['refund_date', 'refunded_at', '退款日期', '退单日期'],
      fullRefund: ['full_refund', 'is_full_refund', 'refund_status', '是否全额退款', '全额退款', '退款状态'],
      availableAt: ['data_available_at', 'available_at', '可见日期', '资料可见日期'],
      snapshotAsOf: ['snapshot_as_of', 'snapshot_cutoff', '快照截止日'],
    };

    return snapshots.flatMap(snapshot => {
      const ext = path.extname(snapshot.binding.ref.locator!).toLowerCase();
      let records: { record: Record<string, unknown>; rowNumber: number }[] = [];
      if (ext === '.csv' || ext === '.tsv') {
        const delimiter = ext === '.tsv' ? '\t' : ',';
        const lines = snapshot.body.split(/\r?\n/);
        const headings = parseSimpleCsvLine(lines[0] ?? '', delimiter);
        if (!headings) return [];
        const header = headings.map(h => h.replace(/^\uFEFF/, '').trim().toLowerCase());
        if (new Set(header).size !== header.length) return [];
        for (const [index, line] of lines.slice(1).entries()) {
          if (!line.trim()) continue;
          const cells = parseSimpleCsvLine(line, delimiter);
          if (!cells || cells.length !== header.length) return [];
          records.push({ record: Object.fromEntries(header.map((key, i) => [key, cells[i]!])), rowNumber: index + 2 });
        }
      } else if (ext === '.json') {
        try {
          const parsed: unknown = JSON.parse(snapshot.body);
          if (!Array.isArray(parsed)) return [];
          records = parsed.flatMap((value: unknown, index) => object(value) ? [{ record: value, rowNumber: index + 1 }] : []);
        } catch { return []; }
      }

      return records.flatMap(({ record, rowNumber }) => {
        const read = (field: keyof typeof fields): string => {
          for (const name of fields[field]) {
            const value = record[name];
            if (typeof value === 'string' && value.trim()) return value.trim();
            if (typeof value === 'boolean' || typeof value === 'number') return String(value);
          }
          return '';
        };
        const itemId = read('itemId'), originalOrderId = read('originalOrderId');
        const orderDate = businessDate(read('orderDate'));
        const store = read('store');
        const rawRefundDate = read('refundDate'), refundDate = businessDate(rawRefundDate);
        const fullRefund = parseFullRefundFlag(read('fullRefund'));
        const rawAvailableAt = read('availableAt'), availableAt = businessDate(rawAvailableAt);
        const rawSnapshotAsOf = read('snapshotAsOf'), snapshotAsOf = businessDate(rawSnapshotAsOf);
        // Transaction dates describe events. A recorded availability date, a cutoff-labelled
        // snapshot, or an actual read by cutoff establishes when these facts were visible.
        if (!itemId || !originalOrderId || !orderDate || orderDate > cutoff
          || (rawRefundDate && !refundDate) || (rawAvailableAt && !availableAt)
          || (rawSnapshotAsOf && !snapshotAsOf)
          || (availableAt && availableAt > cutoff) || (snapshotAsOf && snapshotAsOf > cutoff)) return [];
        const visibleOn = availableAt ?? snapshotAsOf ?? snapshot.observedOn;
        if (!visibleOn || visibleOn > cutoff || visibleOn < orderDate || (refundDate && visibleOn < refundDate)) return [];
        return [{
          source: snapshot.binding,
          rowNumber,
          itemId,
          originalOrderId,
          orderDate,
          ...(store ? { store } : {}),
          ...(refundDate ? { refundDate } : {}),
          ...(fullRefund !== undefined ? { fullRefund } : {}),
          visibleOn,
        }];
      });
    });
  }

  function reportTableItems(body: string): string[][] {
    return body.split(/\r?\n/)
      .filter(line => line.trim().startsWith('|'))
      .map(line => line.split('|').map(cell => cell.trim().replace(/^`([^`]*)`$/, '$1')));
  }

  function structuredReport(body: string): Record<string, unknown> | undefined {
    try {
      const parsed: unknown = JSON.parse(body);
      return object(parsed) ? parsed : undefined;
    } catch { return undefined; }
  }

  function reportShowsDisposition(report: Buffer, itemId: string, orderId: string, disposition: string): boolean {
    const body = report.toString('utf8');
    const structured = structuredReport(body);
    if (structured && Array.isArray(structured.transactions)) {
      const rows = structured.transactions.filter(row => object(row) && row.itemId === itemId && row.originalOrderId === orderId);
      return rows.length > 0 && rows.every(row => row.disposition === disposition);
    }
    return reportTableItems(body).some(cells => [itemId, orderId, disposition].every(value => cells.includes(value)));
  }

  function exactAssessmentItem(
    assessment: string,
    structured: Record<string, unknown> | undefined,
    list: 'shouldChange' | 'postCutoffNewEvents' | 'shouldRetain',
    item: { itemId: string; originalOrderId: string; refundDate?: string; beforeValue?: string; afterValue?: string; unchangedValue?: string; classification?: string },
  ): boolean {
    const entries = structured?.[list];
    if (Array.isArray(entries)) {
      return entries.some(entry => object(entry)
        && entry.itemId === item.itemId && entry.originalOrderId === item.originalOrderId
        && entry.refundDate === item.refundDate && entry.beforeValue === item.beforeValue
        && entry.afterValue === item.afterValue && entry.unchangedValue === item.unchangedValue
        && (list !== 'postCutoffNewEvents' || entry.classification === item.classification));
    }
    const required = [item.itemId, item.originalOrderId,
      ...[item.refundDate, item.beforeValue, item.afterValue, item.unchangedValue].filter((value): value is string => Boolean(value))];
    return reportTableItems(assessment).some(cells => required.every(value => cells.includes(value)));
  }

  async function verifyFeedbackItems(
    feedback: EnterpriseDomainPack['feedbackItems'][number],
    use: EnterprisePackUseRecord,
    originalUse: EnterprisePackUseRecord | undefined,
    raw: EnterprisePackFeedbackItemVerification,
  ): Promise<EnterprisePackFeedbackItemVerification> {
    const fail = (code = 'feedback_verification_item_evidence_uncorroborated'): never => {
      throw new StudioError(code, 409);
    };
    const original = feedback.reports[0];
    const verification = use.independentVerification;
    const assessmentRef = verification.assessmentReportRef;
    if (!original || verification.status !== 'pass' || !assessmentRef
      || !verification.verifierProjectId || !verification.verifierTaskId
      || !verification.verifierEvidenceSummary?.assessmentToolCallId
      || verification.verifierTaskId === use.taskId || use.taskId === original.taskId) {
      return fail('feedback_verification_requires_independent_use_assessment');
    }
    const oldCutoff = businessDate(original.taskCutoffAt);
    const changed = Array.isArray(raw.shouldChange) ? raw.shouldChange : [];
    const retained = Array.isArray(raw.shouldRetain) ? raw.shouldRetain : [];
    const newEvents = Array.isArray(raw.postCutoffNewEvents) ? raw.postCutoffNewEvents : [];
    if (!retained.length || (!changed.length && !newEvents.length)) return fail('feedback_verification_missing_item_evidence');
    const originalDeclaration = originalUse?.authorDeclaration;
    const originalAdoption = originalUse && originalDeclaration?.studioUseId
      && originalUse.packVersion === original.usedPackVersion && exactTaskReport(originalUse.reportRef, original.reportRef)
      && originalDeclaration.declaredRefs.some(ref =>
        original.usedAssetRefs.some(used => sameExactSourceRef(used, ref))
        && originalUse.actualReads.some(read => read.complete && sameExactSourceRef(read.ref, ref)));
    if (!oldCutoff || !original.sourceReads?.length || original.adoptionBasis !== 'verified_actual_read' || !originalAdoption) {
      return fail('feedback_verification_original_snapshot_unavailable');
    }
    if (raw.originalCutoffChecked !== oldCutoff) return fail('feedback_verification_cutoff_mismatch');
    const newCutoff = businessDate(raw.newCutoffChecked);
    if (newEvents.length && (!newCutoff || newCutoff <= oldCutoff)) return fail('feedback_verification_invalid_new_cutoff');
    const cutoff = newEvents.length ? newCutoff! : oldCutoff;
    if (raw.assessmentReportRef && !exactTaskReport(raw.assessmentReportRef, assessmentRef)) return fail();
    const [oldReport, currentReport, assessment, originalRun, currentRun, assessorInputs] = await Promise.all([
      readExactTaskReport(original.reportRef, original.projectId, original.taskId),
      readExactTaskReport(use.reportRef, use.projectId, use.taskId),
      readExactTaskReport(assessmentRef, verification.verifierProjectId, verification.verifierTaskId),
      readReportInputSnapshots(original.projectId, original.taskId, original.reportRef, {
        sessionId: original.sessionId, messageId: original.messageId,
      }),
      readReportInputSnapshots(use.projectId, use.taskId, use.reportRef, undefined, use.authorDeclaration?.studioUseId),
      readAssessorInputSnapshots(use),
    ]);
    if (!oldReport || !currentReport || !assessment || originalRun.cutoff !== oldCutoff || currentRun.cutoff !== cutoff) {
      return fail('feedback_verification_cutoff_uncorroborated');
    }
    const assessmentText = assessment.toString('utf8');
    const assessmentData = structuredReport(assessmentText);
    if (assessmentData) {
      if (assessmentData.originalCutoffChecked !== oldCutoff
        || (newEvents.length > 0 && assessmentData.newCutoffChecked !== newCutoff)) return fail('feedback_verification_cutoff_uncorroborated');
    } else if (!assessmentText.includes(oldCutoff) || (newEvents.length > 0 && !assessmentText.includes(cutoff))) {
      return fail('feedback_verification_cutoff_uncorroborated');
    }
    if (newEvents.length > 0 && !currentReport.toString('utf8').includes(cutoff)) return fail('feedback_verification_cutoff_uncorroborated');
    const originalReceipts = original.sourceReads.map(read => digest(read));
    const originals = inspectSourceTransactions(
      originalRun.snapshots.filter(({ binding }) => originalReceipts.includes(digest(binding))),
      oldCutoff,
    );
    const revised = inspectSourceTransactions(currentRun.snapshots.filter(({ binding }) => assessorInputs.some(({ binding: checked }) =>
      checked.ref.locator === binding.ref.locator && checked.ref.sha256 === binding.ref.sha256,
    )), cutoff);
    if (!originals.length || !revised.length) return fail('feedback_verification_source_transaction_mismatch');

    const isRefund = feedback.category === 'shared_refund_mapping';
    const sameOrder = (row: SourceTransactionRow, itemId: string, orderId: string) => row.itemId === itemId && row.originalOrderId === orderId;
    const rowCustody = (old: SourceTransactionRow, next: SourceTransactionRow, current = false) => {
      const basis = current ? next : old;
      return {
        basisSourceRef: basis.source.ref,
        sourceFileLocator: basis.source.ref.locator,
        sourceFileSha256: basis.source.ref.sha256,
        sourceRowNumber: basis.rowNumber,
        sourceOrderDate: basis.orderDate,
        sourceFullRefund: basis.fullRefund,
        originalSourceRead: old.source,
        originalSourceRowNumber: old.rowNumber,
        originalSourceVisibleOn: old.visibleOn,
        revisedSourceRead: next.source,
        revisedSourceRowNumber: next.rowNumber,
        revisedSourceVisibleOn: next.visibleOn,
      };
    };

    const sameTransaction = (a: SourceTransactionRow, b: SourceTransactionRow) =>
      a.orderDate === b.orderDate && a.store === b.store;
    const unambiguousRow = (rows: SourceTransactionRow[], itemId: string, orderId: string) => {
      const matches = rows.filter(row => sameOrder(row, itemId, orderId));
      const first = matches[0];
      if (first && matches.every(row => sameTransaction(first, row)
        && row.refundDate === first.refundDate && row.fullRefund === first.fullRefund)) return first;
    };
    const retainedRow = (rows: SourceTransactionRow[], itemId: string, orderId: string) => {
      const row = unambiguousRow(rows, itemId, orderId);
      return row && (!isRefund || row.fullRefund === false) ? row : undefined;
    };
    const refundRow = (rows: SourceTransactionRow[], itemId: string, orderId: string, refundDate?: string) => {
      const row = unambiguousRow(rows, itemId, orderId);
      return row && (!refundDate || row.refundDate === refundDate)
        && (!isRefund || (refundDate && row.fullRefund === true)) ? row : undefined;
    };
    const seen = new Set<string>();
    const validateDisposition = (itemId: string, orderId: string, before: string, after: string) => {
      const key = JSON.stringify([itemId, orderId]);
      if (!itemId || !orderId || !before || !after || seen.has(key)
        || !reportShowsDisposition(oldReport, itemId, orderId, before)
        || !reportShowsDisposition(currentReport, itemId, orderId, after)) return fail();
      seen.add(key);
    };
    const verifiedChanges = changed.map(item => {
      const { itemId, originalOrderId: orderId, beforeValue, afterValue } = item;
      const refundDate = businessDate(item.refundDate);
      if (!orderId || beforeValue === afterValue || (isRefund && !refundDate)
        || (item.classification && item.classification !== 'mapping_correction')
        || (refundDate && refundDate > oldCutoff)) return fail();
      validateDisposition(itemId, orderId, beforeValue, afterValue);
      if (!exactAssessmentItem(assessmentText, assessmentData, 'shouldChange', { ...item, originalOrderId: orderId })) return fail();
      const old = refundRow(originals, itemId, orderId, refundDate);
      const next = refundRow(revised, itemId, orderId, refundDate);
      if (!old || !next || !sameTransaction(old, next)) return fail('feedback_verification_source_transaction_mismatch');
      return { ...item, evidenceLocator: use.reportRef.locator, ...rowCustody(old, next) };
    });
    const verifiedNewEvents = newEvents.map(item => {
      const { itemId, originalOrderId: orderId, beforeValue, afterValue } = item;
      const refundDate = businessDate(item.refundDate);
      if (!refundDate || refundDate > cutoff || beforeValue === afterValue
        || (item.classification === 'post_cutoff_new_event' && refundDate <= oldCutoff)
        || (item.classification !== 'post_cutoff_new_event' && item.classification !== 'post_cutoff_update')) return fail();
      validateDisposition(itemId, orderId, beforeValue, afterValue);
      if (!exactAssessmentItem(assessmentText, assessmentData, 'postCutoffNewEvents', item)) return fail();
      const old = retainedRow(originals, itemId, orderId);
      const next = refundRow(revised, itemId, orderId, refundDate);
      if (!old || !next || !sameTransaction(old, next) || next.visibleOn <= oldCutoff) return fail('feedback_verification_new_cutoff_not_actually_read');
      return { ...item, evidenceLocator: use.reportRef.locator, ...rowCustody(old, next, true) };
    });
    const verifiedRetain = retained.map(item => {
      const { itemId, originalOrderId: orderId, unchangedValue } = item;
      if (!orderId) return fail();
      validateDisposition(itemId, orderId, unchangedValue, unchangedValue);
      if (!exactAssessmentItem(assessmentText, assessmentData, 'shouldRetain', { ...item, originalOrderId: orderId })) return fail();
      const old = retainedRow(originals, itemId, orderId);
      const next = retainedRow(revised, itemId, orderId);
      if (!old || !next || !sameTransaction(old, next)
        || (item.refundDate && (old.refundDate !== item.refundDate || next.refundDate !== item.refundDate))) {
        return fail('feedback_verification_source_transaction_mismatch');
      }
      return { ...item, evidenceLocator: use.reportRef.locator, ...rowCustody(old, next) };
    });

    const pinnedCase = original.originalCaseRef;
    if (pinnedCase || raw.originalCaseRef) {
      const submittedCase = raw.originalCaseRef;
      if (!pinnedCase || !submittedCase || raw.caseDecisionsPreserved !== true
        || pinnedCase.caseId !== submittedCase.caseId
        || (submittedCase.decisionId !== undefined && pinnedCase.decisionId !== submittedCase.decisionId)
        || (submittedCase.decisionRevision !== undefined && pinnedCase.decisionRevision !== submittedCase.decisionRevision)) {
        return fail('feedback_verification_case_mismatch');
      }
      if (!options.cases || pinnedCase.decisionResolutionStatus !== 'pinned'
        || !pinnedCase.decisionId || pinnedCase.decisionRevision === undefined
        || !pinnedCase.originReplySha256 || pinnedCase.originReplySha256 !== original.replyRef?.sha256) {
        return fail('feedback_verification_case_decision_unresolved');
      }
      try { options.cases.getDecision(pinnedCase.caseId, pinnedCase.decisionId, pinnedCase.decisionRevision); }
      catch { return fail('feedback_verification_case_decision_mismatch'); }
      if (assessmentData && (
        assessmentData.originalCaseId !== pinnedCase.caseId
        || assessmentData.originalDecisionId !== pinnedCase.decisionId
        || assessmentData.originalDecisionRevision !== pinnedCase.decisionRevision
        || assessmentData.caseDecisionsPreserved !== true
        || (pinnedCase.choiceId && assessmentData.originalChoiceId !== pinnedCase.choiceId)
      )) return fail('feedback_verification_case_uncorroborated');
      if (!assessmentData && (!assessmentText.includes(pinnedCase.caseId) || !assessmentText.includes(pinnedCase.decisionId)
        || (pinnedCase.choiceId && !assessmentText.includes(pinnedCase.choiceId)))) return fail('feedback_verification_case_uncorroborated');
    }
    return {
      originalCutoffChecked: oldCutoff,
      ...(newCutoff ? { newCutoffChecked: newCutoff } : {}),
      transactionAssociationNote: raw.transactionAssociationNote,
      shouldChange: verifiedChanges,
      ...(verifiedNewEvents.length ? { postCutoffNewEvents: verifiedNewEvents } : {}),
      shouldRetain: verifiedRetain,
      ...(pinnedCase ? { originalCaseRef: pinnedCase, caseDecisionsPreserved: true } : {}),
      assessmentReportRef: assessmentRef,
    };
  }

  async function handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    // 0. Host Operator Session Management (R2 real-product operator identity binding)
    if (url.pathname === '/api/studio/operators/session' && (request.method === 'GET' || request.method === 'POST')) {
      if (options.manageOperatorSession) {
        const input = request.method === 'POST' ? await options.readBody(request) : undefined;
        const result = await options.manageOperatorSession(request, response, input);
        json(response, 200, result);
        return true;
      }
      const operator = resolveRequestOperator(request);
      json(response, 200, { operator, customResolver: Boolean(options.resolveRequestOperator) });
      return true;
    }

    // 1. Domain References (Settings -> 领域资产包)
    if (url.pathname === '/api/studio/domain-references' && request.method === 'GET') {
      const enterpriseId = url.searchParams.get('enterpriseId') || undefined;
      const projectId = url.searchParams.get('projectId') || undefined;
      let verifiedEnterpriseId = enterpriseId;
      if (projectId) {
        const projectEnterprise = options.enterpriseScopes.enterpriseIdForProject(uuid(projectId));
        if (enterpriseId && projectEnterprise !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
        verifiedEnterpriseId = projectEnterprise;
      }
      const domain = (url.searchParams.get('domain') || undefined) as DomainReferenceDomain | undefined;
      const sourceId = url.searchParams.get('sourceId') || undefined;
      const query = url.searchParams.get('query') || undefined;
      json(response, 200, {
        references: references.list({ enterpriseId: verifiedEnterpriseId, domain, sourceId, query }),
        builtinTemplates: Object.values(BUILTIN_REPO_TEMPLATES).map(t => ({ sourceId: t.sourceId, version: t.version, title: t.title, domain: t.domain, locator: t.relativePath })),
        readOnlyRollback: !enabled,
      });
      return true;
    }
    if (url.pathname === '/api/studio/domain-references' && request.method === 'POST') {
      assertEnabledWritable();
      const input = await options.readBody(request, 4 * 1024 * 1024);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        if (input.visibility === 'enterprise' && input.enterpriseId) {
          options.enterpriseScopes.get(uuid(input.enterpriseId));
        }
        const result = references.register(input as unknown as Parameters<DomainReferenceStore['register']>[0]);
        return { statusCode: 200, result: result as unknown as Record<string, unknown> };
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }
    if (url.pathname === '/api/studio/domain-references/repo-template' && request.method === 'POST') {
      assertEnabledWritable();
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const templateId = text(input.templateId, 20, false) as keyof typeof BUILTIN_REPO_TEMPLATES;
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, templateId }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const result = references.registerRepoTemplate(templateId);
        return { statusCode: 200, result: result as unknown as Record<string, unknown> };
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }
    const refOriginalMatch = /^\/api\/studio\/domain-references\/([a-f0-9-]+)\/original$/.exec(url.pathname);
    if (refOriginalMatch && request.method === 'GET') {
      const record = references.get(refOriginalMatch[1]!);
      const enterpriseId = url.searchParams.get('enterpriseId') || undefined;
      const projectId = url.searchParams.get('projectId') || undefined;
      if (projectId) {
        const pid = uuid(projectId);
        await options.projects.get(pid);
        const projectEnterprise = options.enterpriseScopes.enterpriseIdForProject(pid);
        if (enterpriseId && projectEnterprise !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
        if (record.visibility === 'enterprise' && projectEnterprise !== record.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
      } else if (record.visibility === 'enterprise') {
        if (!enterpriseId || uuid(enterpriseId) !== record.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
      }
      const section = url.searchParams.get('section') || undefined;
      json(response, 200, references.readOriginal(refOriginalMatch[1]!, section));
      return true;
    }

    // 2. Resource Authorization Grants
    if (url.pathname === '/api/studio/resource-grants/authority' && request.method === 'GET') {
      const enterpriseId = uuid(url.searchParams.get('enterpriseId'));
      const projectId = uuid(url.searchParams.get('projectId'));
      const packId = url.searchParams.get('packId') || undefined;
      const targetPack = packId ? packs.get(packId) : undefined;
      if (targetPack && targetPack.enterpriseId !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
      const operator = resolveRequestOperator(request);
      if (!operator.verified) throw new StudioError('resource_operator_not_authorized', 403);
      if (operator.activeProjectId && operator.activeProjectId !== projectId) {
        throw new StudioError('resource_operator_context_mismatch', 403);
      }
      const grantAuthority = await resolveGrantAuthorityForProject(enterpriseId, projectId, targetPack, operator);
      if (!grantAuthority) throw new StudioError('resource_grantor_not_authorized', 403);
      json(response, 200, { grantAuthority });
      return true;
    }
    if (url.pathname === '/api/studio/resource-grants' && request.method === 'GET') {
      const enterpriseId = url.searchParams.get('enterpriseId') || undefined;
      const subjectId = url.searchParams.get('subjectId') || undefined;
      const projectId = url.searchParams.get('projectId') || undefined;
      let effectiveSubjectId = subjectId;
      if (projectId) {
        const pid = uuid(projectId);
        const projectEnterprise = options.enterpriseScopes.enterpriseIdForProject(pid);
        if (enterpriseId && projectEnterprise !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
        const operator = resolveRequestOperator(request);
        const isOwner = Boolean(
          projectEnterprise
          && await resolveGrantAuthorityForProject(projectEnterprise, pid, undefined, operator),
        );
        // Non-owner consumer project MUST ONLY see its own grants (never another project's stores/paths)!
        if (!isOwner) {
          if (subjectId && subjectId !== pid) throw new StudioError('studio_owner_mismatch', 403);
          effectiveSubjectId = pid;
        }
      }
      const list = enterpriseId && effectiveSubjectId ? grants.listForSubject(enterpriseId, effectiveSubjectId) : grants.list(enterpriseId);
      json(response, 200, { grants: list, readOnlyRollback: !enabled });
      return true;
    }
    async function resolveVerifiedGrantAuthority(
      enterpriseId: string,
      requestedActorProjectId: unknown,
      mode: 'grant' | 'revoke',
      binding: {
        requiredOwnerProjectIds: string[];
        requiredSystemId?: string;
        requestedSystemId?: unknown;
        requestedTaskId?: unknown;
        authorityToken?: unknown;
        operator: TrustedHostOperator;
      },
    ): Promise<{
      actorLabel: string;
      actorProjectId: string;
      actorTaskId?: string;
      actorSystemId?: string;
      actorOperatorId: string;
      authorityType: 'studio-system-owner' | 'enterprise-authority-asset' | 'resource-owner-project';
    }> {
      const failCode = mode === 'grant' ? 'resource_grantor_not_authorized' : 'resource_revoker_not_authorized';
      if (!binding.operator.verified || !binding.operator.operatorId.trim()) {
        throw new StudioError('resource_operator_not_authorized', 403);
      }
      if (requestedActorProjectId === undefined || requestedActorProjectId === null || String(requestedActorProjectId).trim() === '') {
        throw new StudioError(failCode, 403);
      }
      const pid = uuid(requestedActorProjectId);
      // If Host-signed HttpOnly operator context cookie binds an active project, refuse cross-project spoofing!
      if (binding.operator.activeProjectId && binding.operator.activeProjectId !== pid) {
        throw new StudioError('resource_operator_context_mismatch', 403);
      }
      const proj = await options.projects.get(pid);
      if (proj.archivedAt !== null) throw new StudioError('studio_project_read_only', 409);
      if (options.enterpriseScopes.enterpriseIdForProject(pid) !== enterpriseId) throw new StudioError(failCode, 403);

      let verifiedTaskId: string | undefined;
      if (binding.requestedTaskId !== undefined && binding.requestedTaskId !== null && String(binding.requestedTaskId).trim() !== '') {
        verifiedTaskId = uuid(binding.requestedTaskId);
        await options.projects.getTask(pid, verifiedTaskId);
      }
      if (binding.requestedSystemId !== undefined && binding.requestedSystemId !== null && String(binding.requestedSystemId).trim() !== '') {
        const reqSysId = uuid(binding.requestedSystemId);
        if (binding.requiredSystemId && reqSysId !== binding.requiredSystemId) {
          throw new StudioError(failCode, 403);
        }
      }

      if (!binding.requiredOwnerProjectIds.length || !binding.requiredOwnerProjectIds.includes(pid)) {
        throw new StudioError(failCode, 403);
      }

      let matchedSystem: { id: string; name: string; ownerTaskId?: string } | undefined;
      if (binding.requiredSystemId) {
        try {
          const s = options.studio.get(binding.requiredSystemId);
          const execOwner = studioExecutionOwner(s);
          matchedSystem = { id: s.id, name: s.name, ...(execOwner.projectId === pid ? { ownerTaskId: execOwner.taskId } : {}) };
        } catch { /* ignore */ }
      } else {
        const s = options.studio.list().find(sys => sys.enterpriseId === enterpriseId && studioExecutionOwner(sys).projectId === pid);
        if (s) {
          const execOwner = studioExecutionOwner(s);
          matchedSystem = { id: s.id, name: s.name, ownerTaskId: execOwner.taskId };
        }
      }

      // R2 AUTHENTIC OPERATOR BINDING: Verify current Host operator matches bound system owner operator AND HMAC authorityToken!
      const effectiveSystemId = matchedSystem?.id ?? binding.requiredSystemId;
      const boundOperator = getBoundSystemOperator(effectiveSystemId);
      if (boundOperator) {
        if (boundOperator !== binding.operator.operatorId) {
          throw new StudioError('resource_operator_not_authorized', 403);
        }
      } else if (binding.operator.authorityProjectId !== pid) {
        throw new StudioError('resource_operator_not_bound', 403);
      }
      const effectiveOwnerTaskId = verifiedTaskId ?? matchedSystem?.ownerTaskId;
      const tokenValid = verifyGrantAuthorityCredential(binding.authorityToken, {
        enterpriseId,
        systemId: effectiveSystemId,
        ownerProjectId: pid,
        ownerTaskId: effectiveOwnerTaskId,
        operatorId: binding.operator.operatorId,
      });
      if (!tokenValid) {
        throw new StudioError(failCode, 403);
      }

      const opTag = binding.operator.displayName ? `${binding.operator.displayName} (${binding.operator.operatorId})` : binding.operator.operatorId;
      return {
        actorLabel: matchedSystem
          ? `Studio体系·${matchedSystem.name}（原权责项目：${proj.name} · 操作者：${opTag}）`
          : `原权责项目·${proj.name}（操作者：${opTag}）`,
        actorProjectId: proj.id,
        ...(effectiveOwnerTaskId ? { actorTaskId: effectiveOwnerTaskId } : {}),
        ...(matchedSystem ? { actorSystemId: matchedSystem.id } : {}),
        actorOperatorId: binding.operator.operatorId,
        authorityType: matchedSystem ? 'studio-system-owner' : 'resource-owner-project',
      };
    }

    if (url.pathname === '/api/studio/resource-grants' && request.method === 'POST') {
      assertEnabledWritable();
      const operator = resolveRequestOperator(request);
      const input = await options.readBody(request);
      const headerAuthorityToken = request.headers['x-optracall-authority-token'];
      const suppliedAuthorityToken = input.authorityToken ?? input.grantorAuthorityToken ?? (typeof headerAuthorityToken === 'string' ? headerAuthorityToken : undefined);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const enterpriseId = uuid(input.enterpriseId);
        options.enterpriseScopes.get(enterpriseId);
        if (input.subjectType === 'project') {
          const projectId = uuid(input.subjectId);
          await options.projects.get(projectId);
          if (options.enterpriseScopes.enterpriseIdForProject(projectId) !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
        }
        const ops = Array.isArray(input.operations) ? input.operations.map(String) : [];
        const rawScope = object(input.scope) ? { ...input.scope } : {};
        let verifiedResourceRef: StudioSourceRef | undefined = input.resourceRef ? sourceRef(input.resourceRef) : undefined;
        let summaryOwnerProjectId: string | undefined;
        let summaryOwnerSystemId: string | undefined;
        let summaryVerifiedAuthority: string | undefined;

        if (ops.includes('cite-summary')) {
          if (options.verifySummaryAuthority) {
            const verified = await options.verifySummaryAuthority(enterpriseId, {
              summaryAssetId: typeof rawScope.summaryAssetId === 'string' ? rawScope.summaryAssetId : undefined,
              summaryVersion: typeof rawScope.summaryVersion === 'string' ? rawScope.summaryVersion : undefined,
              resourceRef: verifiedResourceRef,
              grain: typeof rawScope.grain === 'string' ? rawScope.grain : undefined,
              periodFrom: typeof rawScope.periodFrom === 'string' ? rawScope.periodFrom : undefined,
              periodTo: typeof rawScope.periodTo === 'string' ? rawScope.periodTo : undefined,
            });
            rawScope.summaryAssetId = verified.summaryAssetId;
            rawScope.summaryVersion = verified.summaryVersion;
            rawScope.summaryAuthority = verified.summaryAuthority;
            rawScope.summarySha256 = verified.summarySha256;
            rawScope.verifiedScopeSummary = verified.verifiedScopeSummary;
            verifiedResourceRef = verified.resourceRef;
            summaryOwnerProjectId = verified.ownerProjectId;
            summaryOwnerSystemId = verified.ownerSystemId;
            summaryVerifiedAuthority = verified.summaryAuthority;
          }
        }

        // Resolve the EXACT owning Studio system & active owner project for the target member pack / resource!
        const enterprisePacks = packs.list(enterpriseId);
        const requestedPurposeKeys = Array.isArray(input.purposeKeys) ? input.purposeKeys.map(String) : [];
        const targetPack = (typeof input.packId === 'string' && input.packId.trim() ? enterprisePacks.find(p => p.id === uuid(input.packId)) : undefined)
          ?? (requestedPurposeKeys.length ? enterprisePacks.find(p => p.purposes.some(pur => requestedPurposeKeys.includes(pur.purposeKey)) || p.packRevisions.some(r => r.purposeManifests.some(pm => requestedPurposeKeys.includes(pm.purposeKey)))) : undefined)
          ?? enterprisePacks[0];

        let packOwnerProjectId: string | undefined;
        let packOwnerSystemId: string | undefined;
        if (targetPack) {
          packOwnerSystemId = targetPack.systemId;
          try {
            const packSys = options.studio.get(targetPack.systemId);
            const origOwnerPid = studioExecutionOwner(packSys).projectId;
            packOwnerProjectId = targetPack.activeOwnerProjectId ?? origOwnerPid;
          } catch {
            packOwnerProjectId = targetPack.activeOwnerProjectId;
          }
        } else {
          const enterpriseSystems = options.studio.list().filter(s => s.enterpriseId === enterpriseId);
          if (typeof input.grantorSystemId === 'string' && input.grantorSystemId.trim()) {
            const reqSys = enterpriseSystems.find(s => s.id === uuid(input.grantorSystemId));
            if (reqSys) {
              packOwnerSystemId = reqSys.id;
              packOwnerProjectId = studioExecutionOwner(reqSys).projectId;
            }
          } else if (enterpriseSystems.length === 1) {
            packOwnerSystemId = enterpriseSystems[0]!.id;
            packOwnerProjectId = studioExecutionOwner(enterpriseSystems[0]!).projectId;
          }
        }

        const needsPackOwner = ops.includes('read-definition') || ops.includes('read-detail-recalculate') || !ops.includes('cite-summary');
        const needsSummaryOwner = ops.includes('cite-summary');
        let requiredOwnerProjectIds: string[] = [];
        let requiredSystemId: string | undefined;

        if (needsSummaryOwner && needsPackOwner) {
          const sumOwners = summaryOwnerProjectId ? [summaryOwnerProjectId] : (packOwnerProjectId ? [packOwnerProjectId] : []);
          const pkOwners = packOwnerProjectId ? [packOwnerProjectId] : sumOwners;
          requiredOwnerProjectIds = sumOwners.filter(id => pkOwners.includes(id));
          requiredSystemId = summaryOwnerSystemId ?? packOwnerSystemId;
        } else if (needsSummaryOwner) {
          requiredOwnerProjectIds = summaryOwnerProjectId ? [summaryOwnerProjectId] : (packOwnerProjectId ? [packOwnerProjectId] : []);
          requiredSystemId = summaryOwnerSystemId ?? packOwnerSystemId;
        } else {
          requiredOwnerProjectIds = packOwnerProjectId ? [packOwnerProjectId] : [];
          requiredSystemId = packOwnerSystemId;
        }

        const verifiedActor = await resolveVerifiedGrantAuthority(
          enterpriseId,
          input.grantorProjectId,
          'grant',
          {
            requiredOwnerProjectIds,
            requiredSystemId,
            requestedSystemId: input.grantorSystemId,
            requestedTaskId: input.grantorTaskId,
            authorityToken: suppliedAuthorityToken,
            operator,
          },
        );
        if (Array.isArray(rawScope.allowedDataPaths)) {
          rawScope.allowedDataPaths = rawScope.allowedDataPaths.map((p: unknown) => {
            const cleaned = normalizeRelativeDataPath(text(p, 1000, false));
            if (cleaned.includes('..') || cleaned.includes('*') || !cleaned.startsWith('020_clean/')) {
              throw new StudioError('invalid_grant_data_path', 400);
            }
            return cleaned;
          });
        }

        const record = grants.grant({
          ...(input as unknown as Parameters<ResourceGrantStore['grant']>[0]),
          grantor: summaryVerifiedAuthority
            ? `${summaryVerifiedAuthority} / ${verifiedActor.actorLabel}`
            : verifiedActor.actorLabel,
          grantorVerifiedBy: 'host',
          grantorProjectId: verifiedActor.actorProjectId,
          ...(verifiedActor.actorTaskId ? { grantorTaskId: verifiedActor.actorTaskId } : {}),
          ...(verifiedActor.actorSystemId ? { grantorSystemId: verifiedActor.actorSystemId } : {}),
          grantorOperatorId: verifiedActor.actorOperatorId,
          grantorOperatorVerified: true,
          grantorCredentialVerified: true,
          grantorAuthorityType: summaryVerifiedAuthority ? 'enterprise-authority-asset' : verifiedActor.authorityType,
          ...(verifiedResourceRef ? { resourceRef: verifiedResourceRef } : {}),
          scope: rawScope as Parameters<ResourceGrantStore['grant']>[0]['scope'],
        });
        if (record.subjectType === 'project' && isGrantActive(record, Date.now())) {
          options.onProjectPermissionChanged?.(record.subjectId);
        }
        return { statusCode: 200, result: { grant: record } as unknown as Record<string, unknown> };
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }
    const revokeMatch = /^\/api\/studio\/resource-grants\/([a-f0-9-]+)\/revoke$/.exec(url.pathname);
    if (revokeMatch && request.method === 'POST') {
      assertEnabledWritable();
      const operator = resolveRequestOperator(request);
      const input = await options.readBody(request);
      const headerAuthorityToken = request.headers['x-optracall-authority-token'];
      const suppliedAuthorityToken = input.authorityToken ?? input.revokerAuthorityToken ?? input.grantorAuthorityToken ?? (typeof headerAuthorityToken === 'string' ? headerAuthorityToken : undefined);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const existingGrant = grants.get(revokeMatch[1]!);
        // Only the original grantor project (if active) or its active continuation owner (if original grantor was archived) may revoke!
        const allowedRevokers: string[] = [];
        if (existingGrant.grantorProjectId) {
          const origGrantorProj = await options.projects.get(existingGrant.grantorProjectId).catch(() => null);
          if (origGrantorProj && origGrantorProj.archivedAt === null) {
            allowedRevokers.push(origGrantorProj.id);
          } else if (existingGrant.grantorSystemId) {
            const packForSys = packs.list(existingGrant.enterpriseId).find(p => p.systemId === existingGrant.grantorSystemId);
            if (packForSys?.activeOwnerProjectId) {
              allowedRevokers.push(packForSys.activeOwnerProjectId);
            }
          }
        }
        const revokerActor = await resolveVerifiedGrantAuthority(
          existingGrant.enterpriseId,
          input.revokerProjectId ?? input.grantorProjectId,
          'revoke',
          {
            requiredOwnerProjectIds: allowedRevokers,
            requiredSystemId: existingGrant.grantorSystemId,
            requestedSystemId: input.revokerSystemId ?? input.grantorSystemId,
            requestedTaskId: input.revokerTaskId ?? input.grantorTaskId,
            authorityToken: suppliedAuthorityToken,
            operator,
          },
        );
        const record = grants.revoke(revokeMatch[1]!, text(input.reason ?? '显式撤回授权', 2000, false), {
          revokedBy: revokerActor.actorLabel,
          revokedByProjectId: revokerActor.actorProjectId,
          ...(revokerActor.actorTaskId ? { revokedByTaskId: revokerActor.actorTaskId } : {}),
          revokedByOperatorId: revokerActor.actorOperatorId,
        });
        if (record.subjectType === 'project' && isGrantActive(existingGrant, Date.now())) {
          options.onProjectPermissionChanged?.(record.subjectId);
        }
        return { statusCode: 200, result: { grant: record } as unknown as Record<string, unknown> };
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }
    if (url.pathname === '/api/studio/resource-grants/evaluate' && request.method === 'POST') {
      const input = await options.readBody(request);
      const enterpriseId = uuid(input.enterpriseId);
      const subjectId = text(input.subjectId, 200, false);
      const subjectGrants = grants.listForSubject(enterpriseId, subjectId);
      const evaluation = evaluateResourceAccess(subjectGrants, input as unknown as ResourceAccessQuery);
      json(response, 200, { evaluation });
      return true;
    }

    // 3. Enterprise Domain Packs
    if (url.pathname === '/api/studio/enterprise-packs/turn-evidence' && request.method === 'GET') {
      const projectId = uuid(url.searchParams.get('projectId'));
      const taskId = uuid(url.searchParams.get('taskId'));
      const sessionId = url.searchParams.get('sessionId') || undefined;
      const messageId = url.searchParams.get('messageId') || undefined;
      await options.projects.get(projectId);
      await options.projects.getTask(projectId, taskId);
      const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
      const operator = resolveRequestOperator(request);
      if (enterpriseId) assertOperatorProject(operator, projectId);
      const enterprisePacks = enterpriseId ? packs.list(enterpriseId).map(pack => scopedPack(pack, projectId, operator)) : [];
      const matchingUses: Array<{
        packId: string;
        packCode: string;
        packName: string;
        use: EnterprisePackUseRecord;
      }> = [];
      const matchingFeedback: Array<{
        packId: string;
        feedbackId: string;
        feedbackCode: string;
        title: string;
        status: string;
        reportRef: StudioSourceRef;
        replyRef?: StudioSourceRef;
        independentVerificationStatus?: string;
        assessmentReportRef?: StudioSourceRef;
        originalCaseRef?: EnterprisePackOriginalCaseRef;
      }> = [];
      const turnWrittenReports: StudioSourceRef[] = [];
      for (const p of enterprisePacks) {
        if (sessionId && messageId) {
          const ev = await inspectTaskNativeEvidence(projectId, taskId, p, { sessionId, messageId });
          for (const wr of ev.turnWrittenReports) turnWrittenReports.push(wr);
          for (const u of p.useRecords) {
            if (u.projectId !== projectId || u.taskId !== taskId) continue;
            const sameMsg = Boolean(u.sessionId === sessionId && u.messageId === messageId);
            const sameTurnReport = ev.turnWrittenReports.some(wr =>
              digest(wr) === digest(u.reportRef) || (wr.sha256 && u.reportRef.sha256 === wr.sha256),
            );
            const sameTurnDecl = ev.turnDeclaredStudioUseIds.length > 0 && u.turnIndex === ev.turnIndex;
            if (sameMsg || sameTurnReport || sameTurnDecl) {
              matchingUses.push({ packId: p.id, packCode: p.packCode, packName: p.name, use: u });
            }
          }
        } else {
          for (const u of p.useRecords) {
            if (u.projectId === projectId && u.taskId === taskId) {
              matchingUses.push({ packId: p.id, packCode: p.packCode, packName: p.name, use: u });
            }
          }
        }
        for (const fb of p.feedbackItems) {
          for (const rep of fb.reports) {
            if (rep.projectId !== projectId || rep.taskId !== taskId) continue;
            if (sessionId && messageId && (rep.sessionId !== sessionId || rep.messageId !== messageId)) continue;
            matchingFeedback.push({
              packId: p.id,
              feedbackId: fb.id,
              feedbackCode: fb.feedbackCode,
              title: fb.title,
              status: fb.status,
              reportRef: rep.reportRef,
              ...(rep.replyRef ? { replyRef: rep.replyRef } : {}),
              ...(rep.independentVerificationStatus ? { independentVerificationStatus: rep.independentVerificationStatus } : {}),
              ...(rep.assessmentReportRef ? { assessmentReportRef: rep.assessmentReportRef } : {}),
              ...(rep.originalCaseRef ? { originalCaseRef: rep.originalCaseRef } : {}),
            });
          }
        }
      }
      const uniqueReports = [...new Map([
        ...turnWrittenReports,
        ...matchingUses.map(m => m.use.reportRef),
      ].map(r => [digest(r), r])).values()];
      json(response, 200, {
        projectId,
        taskId,
        ...(sessionId ? { sessionId } : {}),
        ...(messageId ? { messageId } : {}),
        savedReports: uniqueReports,
        useRecords: matchingUses,
        feedbackLinks: matchingFeedback,
      });
      return true;
    }

    if (url.pathname === '/api/studio/enterprise-packs' && request.method === 'GET') {
      const enterpriseId = url.searchParams.get('enterpriseId');
      const enterprise = enterpriseId ? uuid(enterpriseId) : undefined;
      const operator = resolveRequestOperator(request);
      const reader = await packReaderProject(operator, url.searchParams.get('projectId'), enterprise);
      const domain = url.searchParams.get('domain') || undefined;
      const rawList = reader?.enterpriseId ? packs.list(reader.enterpriseId).filter(pack => !domain || pack.domain === domain) : [];
      const owned = reader && rawList.find(pack => canReadConstructionPack(pack, reader.projectId, operator));
      const grantAuthority = owned && reader ? await resolveGrantAuthorityForProject(owned.enterpriseId, reader.projectId, owned, operator) : undefined;
      json(response, 200, {
        packs: reader ? rawList.map(pack => scopedPack(pack, reader.projectId, operator)) : [],
        readOnlyRollback: !enabled,
        ...(grantAuthority ? { grantAuthority } : {}),
      });
      return true;
    }
    if (url.pathname === '/api/studio/enterprise-packs' && request.method === 'POST') {
      assertEnabledWritable();
      const operator = resolveRequestOperator(request);
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const enterpriseId = uuid(input.enterpriseId);
        options.enterpriseScopes.get(enterpriseId);
        const systemId = uuid(input.systemId);
        const system = options.studio.get(systemId);
        if (system.enterpriseId !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
        const domain = typeof input.domain === 'string' ? input.domain : 'member-operations';
        const existing = packs.list(enterpriseId).find(pack => pack.systemId === systemId && pack.domain === domain);
        if (existing) {
          await assertWritablePackProject(existing, operator, input.projectId);
        } else {
          const originalProjectId = studioExecutionOwner(system).projectId;
          const targetProjectId = input.projectId === undefined ? originalProjectId : uuid(input.projectId);
          if (targetProjectId !== originalProjectId || !hasSystemAuthority(systemId, targetProjectId, operator)) {
            throw new StudioError('member_pack_construction_authority_required', 403);
          }
          await assertWritableProject(targetProjectId, enterpriseId);
        }
        return options.operations.run(requestId, { path: url.pathname, input }, async () => {
          const pack = packs.ensurePack({
            enterpriseId,
            systemId,
            domain,
            name: text(input.name ?? `${system.name} · 会员运营资产包`, 200, false),
            ...(typeof input.packCode === 'string' ? { packCode: input.packCode } : {}),
          });
          return { statusCode: 200, result: { pack } as unknown as Record<string, unknown>, systemId };
        });
      });
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }

    const packGetMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)$/.exec(url.pathname);
    if (packGetMatch && request.method === 'GET') {
      const pack = packs.get(packGetMatch[1]!);
      const enterpriseId = url.searchParams.get('enterpriseId');
      if (enterpriseId && uuid(enterpriseId) !== pack.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
      const operator = resolveRequestOperator(request);
      const reader = await packReaderProject(operator, url.searchParams.get('projectId'), pack.enterpriseId);
      if (!reader) throw new StudioError('member_pack_operator_context_required', 403);
      const grantAuthority = await resolveGrantAuthorityForProject(pack.enterpriseId, reader.projectId, pack, operator);
      json(response, 200, {
        pack: scopedPack(pack, reader.projectId, operator),
        readOnlyRollback: !enabled,
        ...(grantAuthority ? { grantAuthority } : {}),
      });
      return true;
    }

    const packReportSnapMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/report-snapshot$/.exec(url.pathname);
    if (packReportSnapMatch && request.method === 'GET') {
      const pack = packs.get(packReportSnapMatch[1]!);
      const projectId = uuid(url.searchParams.get('projectId'));
      const taskId = url.searchParams.get('taskId') ? uuid(url.searchParams.get('taskId')) : undefined;
      const locator = text(url.searchParams.get('locator') ?? '', 500, false);
      const expectedSha256 = url.searchParams.get('sha256') || undefined;
      if (options.enterpriseScopes.enterpriseIdForProject(projectId) !== pack.enterpriseId) {
        throw new StudioError('studio_owner_mismatch', 403);
      }
      const operator = resolveRequestOperator(request);
      const borrowerProjectId = operator.activeProjectId ?? operator.authorityProjectId;
      if (!operator.verified || !borrowerProjectId || options.enterpriseScopes.enterpriseIdForProject(borrowerProjectId) !== pack.enterpriseId) {
        throw new StudioError('studio_report_permission_denied', 403);
      }
      if (!locator.startsWith('060_reports/')) throw new StudioError('invalid_report_locator', 400);
      const matchesReport = (ref: StudioSourceRef) => ref.projectId === projectId && ref.taskId === taskId
        && ref.locator === locator && ref.sha256 === expectedSha256;
      if (!taskId || !expectedSha256 || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
        throw new StudioError('invalid_report_locator', 400);
      }
      await options.projects.getTask(projectId, taskId);
      const assertCurrentAccess = () => {
        const latest = packs.get(pack.id);
        const retained = latest.useRecords.some(use => matchesReport(use.reportRef)
          || Boolean(use.independentVerification.assessmentReportRef && matchesReport(use.independentVerification.assessmentReportRef)))
          || latest.feedbackItems.some(feedback => feedback.reports.some(report => matchesReport(report.reportRef)
            || Boolean(report.assessmentReportRef && matchesReport(report.assessmentReportRef))));
        if (!retained) throw new StudioError('studio_report_permission_denied', 403);
        const boundOperator = getBoundSystemOperator(latest.systemId);
        const constructionAuthority = isConstructionOwnerProject(latest, borrowerProjectId)
          && (boundOperator ? boundOperator === operator.operatorId : operator.authorityProjectId === borrowerProjectId);
        if (constructionAuthority) return;
        const declarations = options.studio.get(latest.systemId).uses.filter(use => use.projectId === projectId
          && use.taskId === taskId && matchesReport(use.report));
        if (!declarations.length) throw new StudioError('studio_report_permission_denied', 403);
        for (const declaration of declarations) assertDeclaredReportAccess(latest.systemId, borrowerProjectId, declaration);
      };
      assertCurrentAccess();
      let bytes: Buffer | undefined;
      let resolvedLocator = locator;
      try {
        resolvedLocator = taskId ? resolveTaskReportLocator(projectId, taskId, locator, expectedSha256) : locator;
        const disk = await options.projects.readFile(projectId, resolvedLocator);
        const diskSha = createHash('sha256').update(disk.bytes).digest('hex');
        if (!expectedSha256 || diskSha === expectedSha256) {
          bytes = disk.bytes;
        }
      } catch { /* fall back to preserved snapshot */ }
      if (!bytes && expectedSha256) {
        bytes = readPreservedReportBytes(projectId, taskId ?? '', locator, expectedSha256);
      }
      if (!bytes) throw new StudioError('report_snapshot_not_found', 404);
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      if (actualSha !== expectedSha256) throw new StudioError('studio_use_report_hash_mismatch', 409);
      assertCurrentAccess();
      json(response, 200, {
        projectId,
        ...(taskId ? { taskId } : {}),
        locator: resolvedLocator,
        sha256: actualSha,
        bytesLength: bytes.length,
        text: bytes.toString('utf8'),
      });
      return true;
    }

    const packActionMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/(panorama|panorama-select|entries|purposes|previews|confirm|reconcile|pin|uses|feedback|upgrade-impact)$/.exec(url.pathname);
    if (packActionMatch && request.method === 'POST') {
      assertEnabledWritable();
      const packId = packActionMatch[1]!;
      const action = packActionMatch[2]!;
      const operator = resolveRequestOperator(request);
      const input = await options.readBody(request, 4 * 1024 * 1024);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        const currentPack = packs.get(packId);
        const taskAction = action === 'pin' || action === 'uses' || action === 'feedback';
        const feedbackOrigin = object(input.origin) ? input.origin : input.report;
        const origin = action === 'feedback' && object(feedbackOrigin) ? feedbackOrigin : input;
        const project = taskAction ? await assertWritableProject(uuid(origin.projectId), currentPack.enterpriseId)
          : await assertWritablePackProject(currentPack, operator, input.projectId);
        if (taskAction) assertOperatorProject(operator, project.id);
        const taskId = origin.taskId === undefined ? undefined : uuid(origin.taskId);
        if (taskId) {
          const task = await options.projects.getTask(project.id, taskId);
          if (task.archivedAt) throw new StudioError('studio_project_read_only', 409);
        }
        if (taskAction && !taskId) throw new StudioError('studio_source_task_required', 403);
        const construction = canReadConstructionPack(currentPack, project.id, operator);
        const existingPin = taskId ? packs.getTaskPin(packId, project.id, taskId) : undefined;
        const version = existingPin?.packVersion ?? (typeof input.version === 'string' ? input.version : undefined);
        const pinRevision = version ? currentPack.packRevisions.find(revision => revision.version === version) : currentPack.packRevisions.find(revision => revision.status === 'active');
        const permitted = action === 'pin' || action === 'uses' ? qualifiedPinPurposes(currentPack, project.id, construction, pinRevision) : undefined;
        if (permitted && (permitted.length === 0 || (action === 'uses' && !permitted.some(purpose => purpose.purposeId === input.purposeId)))) {
          throw new StudioError('member_pack_purpose_not_authorized', 403);
        }
        if (action === 'pin' && !existingPin && pinRevision?.status !== 'active') throw new StudioError('enterprise_pack_no_published_revision', 409);
        const performAction = async () => {
          if (!taskAction) {
          // Bind continuation owner when the previous owner project has been archived and an active same-enterprise project takes over construction!
          const origSystem = options.studio.get(currentPack.systemId);
          const currentOwnerPid = currentPack.activeOwnerProjectId ?? studioExecutionOwner(origSystem).projectId;
          if (project.id !== currentOwnerPid) {
            const currentOwnerProj = await options.projects.get(currentOwnerPid).catch(() => null);
            if (!currentOwnerProj || currentOwnerProj.archivedAt !== null) {
              packs.bindContinuationOwner(
                packId,
                project.id,
                typeof input.taskId === 'string' ? input.taskId : undefined,
                '原建设归属项目已归档，同企业活跃项目接续建设同一企业会员包',
              );
            }
          }
        }

        if (action === 'panorama') {
          const pack = packs.savePanorama(packId, input as unknown as Parameters<EnterprisePackStore['savePanorama']>[1]);
          return { result: { pack } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'panorama-select') {
          const pack = packs.selectPanoramaRecommendation(
            packId,
            text(input.purposeKey, 200, false),
            Boolean(input.selected),
            {
              ...(typeof input.targetPurposeId === 'string' && input.targetPurposeId.trim() ? { targetPurposeId: input.targetPurposeId.trim() } : {}),
              ...(typeof input.scopeKey === 'string' && input.scopeKey.trim() ? { scopeKey: input.scopeKey.trim() } : {}),
              ...(typeof input.title === 'string' && input.title.trim() ? { title: input.title.trim() } : {}),
            },
          );
          return { result: { pack } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'entries') {
          const pack = packs.upsertEntry(packId, input as unknown as Parameters<EnterprisePackStore['upsertEntry']>[1]);
          return { result: { pack } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'purposes') {
          const result = packs.upsertPurpose(packId, {
            ...(input as unknown as Parameters<EnterprisePackStore['upsertPurpose']>[1]),
            ...(input.projectId && input.taskId ? { taskOwner: { projectId: String(input.projectId), taskId: String(input.taskId) } } : {}),
          });
          return { result: result as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'previews') {
          const preview = packs.preparePreview(packId, input as unknown as Parameters<EnterprisePackStore['preparePreview']>[1]);
          return { result: { pack: packs.get(packId), preview } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'confirm') {
          const previewId = uuid(input.previewId);
          const fingerprint = text(input.fingerprint, 128, false);
          // CRITICAL (R1.1): Validate frozen preview, fingerprint, AND draftFingerprint BEFORE ANY original authority write!
          const precheck = packs.validateConfirmPreconditions(packId, previewId, fingerprint);
          if (precheck.existingRevision) {
            return { result: { pack: precheck.pack, revision: precheck.existingRevision } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
          }
          const preview = precheck.preview;
          // Host executes publication/verification directly against REAL original authorities — NEVER trusts client-supplied moduleReceipts!
          const hostReceipts: {
            requestId: string;
            authority: PackModulePublicationReceipt['authority'];
            targetRef: StudioSourceRef;
            status: 'succeeded' | 'failed' | 'unknown';
            detail: string;
            purposeIds: string[];
            authorityOperationId?: string;
            authorityPublishedBy?: string;
          }[] = [];
          const depGroups = new Map<string, { dep: EnterprisePackDependency; purposeIds: string[] }>();
          for (const pm of preview.purposeSnapshots) {
            for (const dep of pm.dependencies) {
              const key = digest([dep.role, dep.ref]);
              const existing = depGroups.get(key);
              if (existing) {
                if (!existing.purposeIds.includes(pm.purposeId)) existing.purposeIds.push(pm.purposeId);
              } else {
                depGroups.set(key, { dep, purposeIds: [pm.purposeId] });
              }
            }
          }
          let seq = 0;
          for (const { dep, purposeIds } of depGroups.values()) {
            seq += 1;
            const depReqId = `P-${preview.version}-${seq}`;
            const mappedAuthority: PackModulePublicationReceipt['authority'] = dep.role === 'summary-result' ? 'studio-source' : dep.role;
            let outcome: AuthorityPublicationOutcome;
            if (options.publishAuthorityDependency) {
              outcome = await options.publishAuthorityDependency(precheck.pack, preview, dep, depReqId);
            } else {
              outcome = { status: 'failed', detail: '未配置原权威发布适配器，拒绝伪造成功回执' };
            }
            hostReceipts.push({
              requestId: depReqId,
              authority: mappedAuthority,
              targetRef: dep.ref,
              status: outcome.status,
              detail: outcome.detail,
              purposeIds,
              ...(outcome.authorityOperationId ? { authorityOperationId: outcome.authorityOperationId } : {}),
              ...(outcome.authorityPublishedBy ? { authorityPublishedBy: outcome.authorityPublishedBy } : {}),
            });
          }

          const revision = packs.confirmPreview(packId, {
            previewId,
            fingerprint,
            ...(typeof input.confirmedBy === 'string' && input.confirmedBy.trim() ? { confirmedBy: input.confirmedBy.trim() } : {}),
            moduleReceipts: hostReceipts,
          });
          // Do NOT broadcast onProjectPermissionChanged on pack publication: unaffected in-flight tasks pinned to
          // earlier pack versions MUST remain undisturbed; new tasks automatically pick up the newly active revision.
          return { result: { pack: packs.get(packId), revision } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'reconcile') {
          const version = text(input.version, 50, false);
          const rev = currentPack.packRevisions.find(r => r.version === version);
          if (!rev) throw new StudioError('enterprise_pack_revision_not_found', 404);
          const targetRequestId = typeof input.targetRequestId === 'string'
            ? text(input.targetRequestId, 200, false)
            : object(input.receipt) && typeof input.receipt.requestId === 'string'
              ? text(input.receipt.requestId, 200, false)
              : '';
          if (!targetRequestId) throw new StudioError('invalid_reconcile_target_request', 400);
          const receiptsForReq = rev.moduleReceipts.filter(r => r.requestId === targetRequestId);
          const firstReceipt = receiptsForReq[0];
          const latestReceipt = receiptsForReq.at(-1);
          if (!firstReceipt || !latestReceipt) throw new StudioError('enterprise_pack_receipt_not_found', 404);
          if (latestReceipt.status === 'succeeded') {
            return { result: { pack: currentPack, revision: rev } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
          }
          // Host performs read-only check against the REAL original authority, passing the ORIGINAL receipt so failed requests
          // and unrelated external publishes can NEVER be falsely attributed to the original request!
          const outcome: AuthorityPublicationOutcome = options.inspectAuthorityDependency
            ? await options.inspectAuthorityDependency(currentPack, firstReceipt.targetRef, firstReceipt)
            : { status: firstReceipt.status === 'failed' ? 'failed' : 'unknown', detail: '未配置原权威只读查证器，保持原未知/失败状态' };
          const revision = packs.reconcileModuleReceipt(packId, version, {
            requestId: firstReceipt.requestId,
            authority: firstReceipt.authority,
            targetRef: firstReceipt.targetRef,
            status: firstReceipt.status === 'failed' ? 'failed' : outcome.status,
            detail: outcome.detail,
            purposeIds: firstReceipt.purposeIds,
            ...(outcome.authorityOperationId ? { authorityOperationId: outcome.authorityOperationId } : firstReceipt.authorityOperationId ? { authorityOperationId: firstReceipt.authorityOperationId } : {}),
            ...(outcome.authorityPublishedBy ? { authorityPublishedBy: outcome.authorityPublishedBy } : firstReceipt.authorityPublishedBy ? { authorityPublishedBy: firstReceipt.authorityPublishedBy } : {}),
            supersedesReceiptId: latestReceipt.receiptId,
          });
          return { result: { pack: packs.get(packId), revision } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'pin') {
          const pin = packs.pinTaskVersion(packId, {
            projectId: project.id, taskId: taskId!, authorizedScope: 'host-qualified', version: pinRevision?.version,
            qualifiedPurposes: permitted,
          });
          return { result: { pin } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'uses') {
          const pid = uuid(input.projectId), tid = uuid(input.taskId);
          const project = await options.projects.get(pid);
          await options.projects.getTask(pid, tid);
          if (options.enterpriseScopes.enterpriseIdForProject(pid) !== currentPack.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
          const pin = packs.getTaskPin(packId, pid, tid);
          if (!pin) throw new StudioError('enterprise_pack_task_not_pinned', 409);

          // Sync any deliverables written inside a restricted task workspace into project 060_reports/
          syncWorkspaceReportsToProject(pid, tid, project.rootPath);

          // Host verifies the actual report file bytes & SHA-256 on disk!
          const rawReportRef = sourceRef(input.reportRef);
          if (rawReportRef.projectId !== pid || (rawReportRef.taskId && rawReportRef.taskId !== tid)) {
            throw new StudioError('studio_use_report_mismatch', 403);
          }
          let verifiedReportRef = rawReportRef;
          let selectionForTurn: { sessionId: string; messageId: string } | undefined =
            typeof input.sessionId === 'string' && typeof input.messageId === 'string'
              ? { sessionId: input.sessionId, messageId: input.messageId }
              : undefined;

          if (rawReportRef.locator && rawReportRef.locator.startsWith('060_reports/')) {
            const effectiveLocator = resolveTaskReportLocator(pid, tid, rawReportRef.locator, rawReportRef.sha256);
            const file = await options.projects.readFile(pid, effectiveLocator);
            const actualSha = createHash('sha256').update(file.bytes).digest('hex');
            if (rawReportRef.sha256 && rawReportRef.sha256 !== actualSha) {
              throw new StudioError('studio_use_report_hash_mismatch', 409);
            }
            preserveImmutableReportSnapshot(pid, effectiveLocator, file.bytes, actualSha);
            verifiedReportRef = sourceRef({ ...rawReportRef, locator: effectiveLocator, version: actualSha, sha256: actualSha });
          } else if (rawReportRef.locator) {
            try {
              const parsed = JSON.parse(rawReportRef.locator);
              if (parsed?.kind === 'native-reply' && typeof parsed.sessionId === 'string' && typeof parsed.messageId === 'string') {
                const reply = await options.readTaskReply(pid, tid, { sessionId: parsed.sessionId, messageId: parsed.messageId });
                const actualSha = createHash('sha256').update(reply.text).digest('hex');
                verifiedReportRef = sourceRef({ ...rawReportRef, version: actualSha, sha256: actualSha });
                selectionForTurn ??= { sessionId: parsed.sessionId, messageId: parsed.messageId };
              }
            } catch {
              throw new StudioError('studio_use_report_unavailable', 409);
            }
          }

          // Host extracts REAL directory supply & ACTUAL read receipts STRICTLY from THIS specific turn!
          const nativeEv = await inspectTaskNativeEvidence(pid, tid, currentPack, selectionForTurn);
          const rev = currentPack.packRevisions.find(r => r.version === pin.packVersion);
          const purposeId = text(input.purposeId, 100, false);
          const pm = rev?.purposeManifests.find(item => item.purposeId === purposeId);
          if (!pm) throw new StudioError('enterprise_pack_purpose_not_found', 404);

          // CRITICAL (R4): NEVER trust client-supplied input.authorDeclaration from the HTTP request body!
          // Author adoption declaration MUST come from a real Studio declare-use record in studio.uses for THIS exact turn & report!
          let resolvedDeclaration: Parameters<EnterprisePackStore['recordUse']>[1]['authorDeclaration'] | undefined;
          try {
            const studioSys = options.studio.get(currentPack.systemId);
            const studioUse = [...studioSys.uses].reverse().find(u =>
              u.projectId === pid
              && u.taskId === tid
              && (
                exactTaskReport(u.report, verifiedReportRef)
              ),
            );
            const declaredInThisTurn = !options.taskSnapshot
              ? Boolean(studioUse)
              : Boolean(studioUse && nativeEv.turnDeclaredStudioUseIds.includes(studioUse.id));
            if (studioUse && declaredInThisTurn && studioUse.sources.length > 0) {
              resolvedDeclaration = {
                declaredPurposeId: pm.purposeId,
                studioUseId: studioUse.id,
                declaredRefs: studioUse.sources,
                summaryText: studioUse.result || '来自原 Studio declare-use 本轮作者采用声明',
                declaredAt: studioUse.createdAt,
              };
            }
          } catch { /* no studio declaration */ }

          const effectiveSelection = selectionForTurn ?? nativeEv.resolvedSelection;
          const use = packs.recordUse(packId, {
            projectId: pid,
            taskId: tid,
            ...(effectiveSelection ? { sessionId: effectiveSelection.sessionId, messageId: effectiveSelection.messageId } : {}),
            ...(nativeEv.turnIndex !== undefined ? { turnIndex: nativeEv.turnIndex } : {}),
            reportRef: verifiedReportRef,
            packVersion: pin.packVersion,
            purposeId: pm.purposeId,
            purposeKey: pm.purposeKey,
            tier: pm.tier,
            accessLevel: (() => {
              const access = evaluatePurposeAccessForSubject(projectGrants(currentPack.enterpriseId, pid), pm);
              if (pm.tier !== 'definition-reference' && (construction || access?.hasPartialOrFullDetail)) return 'recalculate';
              if (access?.canSummary.allowed && !access?.hasPartialOrFullDetail) return 'summary';
              return 'definition';
            })(),
            ...(pm.policyEffectiveFrom ? { policyEffectiveFrom: pm.policyEffectiveFrom } : {}),
            ...(nativeEv.taskCutoffAt ? { dataCutoffAt: nativeEv.taskCutoffAt } : typeof input.dataCutoffAt === 'string' ? { dataCutoffAt: input.dataCutoffAt } : {}),
            catalogSupplied: {
              packVersion: nativeEv.observedDirectoryVersion ?? nativeEv.sessionObservedDirectoryVersion ?? pin.packVersion,
              purposeIds: nativeEv.catalogPurposeIds.length ? nativeEv.catalogPurposeIds : pin.purposeIds,
              assetRefs: nativeEv.catalogAssetRefs.length ? nativeEv.catalogAssetRefs : pin.pinnedAuthorityRefs,
              suppliedAt: nativeEv.catalogSuppliedAt ?? pin.pinnedAt,
            },
            actualReads: nativeEv.actualReads,
            ...(resolvedDeclaration ? { authorDeclaration: resolvedDeclaration } : {}),
          });
          return { result: { use, pack: packs.get(packId) } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'feedback') {
          let reportPayload: Record<string, unknown> | undefined;
          if (!object(input.origin) && object(input.report)) {
            const clue = input.report;
            const projectId = uuid(clue.projectId);
            if (options.enterpriseScopes.enterpriseIdForProject(projectId) !== currentPack.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
            reportPayload = {
              projectId, taskId: clue.taskId, sessionId: clue.sessionId, messageId: clue.messageId,
              reportRef: clue.reportRef, evidenceNote: clue.evidenceNote,
              adoptionBasis: 'clue_only_no_pack_read', usedAssetRefs: [],
            };
          }
          let resolvedPackVersion: string | undefined;
          let resolvedTargetRef: StudioSourceRef | undefined;
          const requestedPurposes = Array.isArray(input.purposeIds) ? input.purposeIds.map(String) : [];
          let resolvedPurposes = requestedPurposes;
          const category = (input.category as PackFeedbackCategory) ?? 'shared_refund_mapping';

          if (object(input.origin)) {
            const origin = input.origin;
            const pid = uuid(origin.projectId), tid = uuid(origin.taskId);
            const originProj = await options.projects.get(pid);
            if (options.enterpriseScopes.enterpriseIdForProject(pid) !== currentPack.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
            syncWorkspaceReportsToProject(pid, tid, originProj.rootPath);
            const selection = { sessionId: text(origin.sessionId, 200, false), messageId: text(origin.messageId, 200, false) };
            const original = await options.readTaskReply(pid, tid, selection);
            const replySha = createHash('sha256').update(original.text).digest('hex');
            const replyRef = sourceRef({
              authority: 'task',
              id: tid,
              projectId: pid,
              taskId: tid,
              version: replySha,
              sha256: replySha,
              locator: JSON.stringify({ kind: 'native-reply', ...selection }),
            });
            const pin = packs.getTaskPin(packId, pid, tid);
            const nativeEv = await inspectTaskNativeEvidence(pid, tid, currentPack, selection);

            const observedDirVer = nativeEv.observedDirectoryVersion ?? nativeEv.sessionObservedDirectoryVersion ?? pin?.packVersion;
            const rev = currentPack.packRevisions.find(r => r.version === (pin?.packVersion ?? observedDirVer));
            const packDepRefs = [
              ...(pin?.pinnedAuthorityRefs ?? []),
              ...(rev ? rev.purposeManifests.flatMap(pm => pm.dependencies.map(d => d.ref)) : []),
            ];

            // STRICT (R4.1 + R5.1): Only COMPLETE reads from THIS specific turn matching an actual PACK dependency count!
            const packMatchedReads = nativeEv.actualReads.filter(r =>
              r.complete && packDepRefs.some(dep => sameExactSourceRef(r.ref, dep)),
            );
            const studioSys = options.studio.get(currentPack.systemId);
            const turnDeclaredUses = studioSys.uses
              .filter(u => u.projectId === pid && u.taskId === tid && nativeEv.turnDeclaredStudioUseIds.includes(u.id));
            const savedReports = [...nativeEv.turnWrittenReports, ...turnDeclaredUses.map(use => use.report)]
              .filter(ref => isTaskReport(ref, pid, tid));
            const evidenceRefs = (use: EnterprisePackUseRecord) => use.actualReads
              .filter(read => read.complete
                && packDepRefs.some(dep => sameExactSourceRef(read.ref, dep))
                && use.authorDeclaration?.declaredRefs.some(declared => sameExactSourceRef(read.ref, declared)))
              .map(read => read.ref);
            const matchingTurnUses = [...currentPack.useRecords].reverse().filter(use =>
              turnDeclaredUses.some(declared => matchesStudioUse(use, declared)) && evidenceRefs(use).length > 0,
            );
            const hasActualUse = matchingTurnUses.length > 0;
            const observedPurposes = new Set(matchingTurnUses.map(use => use.purposeId));
            if (!observedPurposes.size && packMatchedReads.length) {
              for (const manifest of rev?.purposeManifests ?? []) {
                if (packMatchedReads.every(read => manifest.dependencies.some(dep => sameExactSourceRef(dep.ref, read.ref)))) {
                  observedPurposes.add(manifest.purposeId);
                }
              }
            }
            const selectedPurposes = [...observedPurposes].filter(id => !requestedPurposes.length || requestedPurposes.includes(id));
            if (observedPurposes.size) resolvedPurposes = selectedPurposes.length ? selectedPurposes : [...observedPurposes];
            const selectedPurpose = resolvedPurposes.length === 1 && observedPurposes.has(resolvedPurposes[0]!)
              ? resolvedPurposes[0] : undefined;
            const matchingTurnUse = selectedPurpose ? matchingTurnUses.find(use => use.purposeId === selectedPurpose) : undefined;
            const matchedRefs = (matchingTurnUse ? evidenceRefs(matchingTurnUse) : matchingTurnUses.flatMap(evidenceRefs))
              .filter((ref, index, all) => all.findIndex(other => sameExactSourceRef(ref, other)) === index);

            // A later file at the same path cannot change the original reference.
            const uniqueSavedReports = [...new Map(savedReports.map(ref => [`${ref.locator}:${ref.sha256}`, ref])).values()];
            const linkedSavedReportRef = matchingTurnUse && isTaskReport(matchingTurnUse.reportRef, pid, tid)
              ? matchingTurnUse.reportRef
              : uniqueSavedReports.length === 1 ? uniqueSavedReports[0] : undefined;
            if (linkedSavedReportRef) {
              const bytes = await readExactTaskReport(linkedSavedReportRef, pid, tid);
              if (bytes) preserveImmutableReportSnapshot(pid, linkedSavedReportRef.locator!, bytes, linkedSavedReportRef.sha256);
            }

            const rawCaseInput = object(input.originalCaseRef)
              ? input.originalCaseRef
              : typeof input.originalCaseId === 'string' && input.originalCaseId.trim()
                ? { caseId: input.originalCaseId, decisionId: input.originalDecisionId }
                : undefined;
            const resolvedOriginalCaseRef = resolveOriginalCase({
              projectId: pid, taskId: tid, selection, replySha,
              ...(nativeEv.replyTimestampMs !== undefined ? { originTime: nativeEv.replyTimestampMs } : {}),
              ...(rawCaseInput ? { requested: rawCaseInput } : {}),
            });

            let adoptionBasis: FeedbackAdoptionBasis;
            if (hasActualUse) {
              adoptionBasis = 'verified_actual_read';
            } else if (observedDirVer) {
              adoptionBasis = 'directory_only_unverified';
            } else {
              adoptionBasis = 'clue_only_no_pack_read';
            }

            const taskCutoff = businessDate(nativeEv.taskCutoffAt);
            const packCutoff = pin?.dataCutoffAt ?? rev?.dataCutoffAt;
            const sourceReads = linkedSavedReportRef
              ? (await readReportInputSnapshots(pid, tid, linkedSavedReportRef, selection)).snapshots
                .map(({ binding }) => binding)
              : [];

            const wantedRole = category === 'shared_refund_mapping' ? 'shared-asset' : category === 'sap_formula' ? 'sap-metric' : category === 'member_policy' ? 'member-rule' : undefined;
            const originalPurpose = rev?.purposeManifests.find(pm => pm.purposeId === selectedPurpose);
            const targets = (originalPurpose?.dependencies ?? []).filter(dep =>
              dep.role === wantedRole && matchedRefs.some(ref => sameExactSourceRef(dep.ref, ref)));
            if (targets.length === 1) resolvedTargetRef = targets[0]?.ref;

            resolvedPackVersion = adoptionBasis === 'verified_actual_read'
              ? (matchingTurnUse?.packVersion ?? pin?.packVersion ?? observedDirVer ?? 'unconfirmed')
              : (observedDirVer ?? 'unconfirmed');

            reportPayload = {
              projectId: pid,
              taskId: tid,
              sessionId: selection.sessionId,
              messageId: selection.messageId,
              reportRef: linkedSavedReportRef ?? replyRef,
              replyRef,
              ...(matchingTurnUse ? {
                linkedUseRecordId: matchingTurnUse.id,
                independentVerificationStatus: matchingTurnUse.independentVerification.status,
                ...(matchingTurnUse.independentVerification.assessmentReportRef ? { assessmentReportRef: matchingTurnUse.independentVerification.assessmentReportRef } : {}),
              } : {}),
              ...(resolvedOriginalCaseRef ? { originalCaseRef: resolvedOriginalCaseRef } : {}),
              adoptionBasis,
              ...(observedDirVer ? { observedDirectoryVersion: observedDirVer } : {}),
              // ONLY populate usedPackVersion when actual reading/use of THIS pack in THIS turn was verified!
              ...(adoptionBasis === 'verified_actual_read' && resolvedPackVersion !== 'unconfirmed' ? { usedPackVersion: resolvedPackVersion } : {}),
              usedAssetRefs: matchedRefs,
              ...(taskCutoff ? { taskCutoffAt: taskCutoff } : {}),
              ...(sourceReads.length ? { sourceReads } : {}),
              ...(packCutoff ? { packDataCutoffAt: packCutoff } : {}),
              evidenceNote: text(input.evidenceNote ?? input.problem ?? '', 5000, false),
            };
          }
          if (!reportPayload) throw new StudioError('invalid_pack_feedback_report');
          const result = packs.submitFeedback(packId, {
            problemKey: text(input.problemKey ?? input.title, 200, false),
            packVersion: text(resolvedPackVersion ?? (typeof input.packVersion === 'string' ? input.packVersion : 'unconfirmed'), 50, false),
            purposeIds: resolvedPurposes,
            title: text(input.title, 300, false),
            category,
            ...(resolvedTargetRef ? { targetAssetRef: resolvedTargetRef } : {}),
            report: reportPayload as unknown as Parameters<EnterprisePackStore['submitFeedback']>[1]['report'],
          });
          return { result: result as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        // upgrade-impact
        const impact = packs.recordUpgradeImpact(packId, input as unknown as Parameters<EnterprisePackStore['recordUpgradeImpact']>[1]);
        return { result: { impact, pack: packs.get(packId) } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        };
        const result = await options.operations.run(requestId, { path: url.pathname, input }, performAction);
        if (!taskAction || !result.result) return result;
        const pack = scopedPack(packs.get(packId), project.id, operator);
        const resultBody = result.result;
        return { ...result, result: {
          ...resultBody, pack,
          ...(action === 'pin' ? { pin: pack.taskPins.find(pin => pin.projectId === project.id && pin.taskId === taskId) } : {}),
          ...(action === 'uses' && object(resultBody.use) ? { use: pack.useRecords.find(use => use.id === (resultBody.use as { id?: string }).id) } : {}),
          ...(action === 'feedback' && object(resultBody.feedback) ? { feedback: pack.feedbackItems.find(item => item.id === (resultBody.feedback as { id?: string }).id) } : {}),
        } };
      });
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }

    const feedbackCaseHistoryMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/feedback\/([a-f0-9-]+)\/case-history$/.exec(url.pathname);
    if (feedbackCaseHistoryMatch && request.method === 'GET') {
      const currentPack = packs.get(feedbackCaseHistoryMatch[1]!);
      const operator = resolveRequestOperator(request), reader = activeOperatorProject(operator);
      if (!reader || options.enterpriseScopes.enterpriseIdForProject(reader) !== currentPack.enterpriseId) throw new StudioError('member_pack_operator_context_required', 403);
      const canReadAny = canReadConstructionPack(currentPack, reader, operator);
      const fb = currentPack.feedbackItems.find(f => f.id === uuid(feedbackCaseHistoryMatch[2]!));
      if (!fb) throw new StudioError('enterprise_pack_feedback_not_found', 404);
      const original = fb.reports[0];
      if (!canReadAny && original?.projectId !== reader) throw new StudioError('member_pack_operator_context_required', 403);
      const recordedRef = original?.originalCaseRef;
      if (!recordedRef) {
        json(response, 200, { feedbackId: fb.id, originalCaseRef: null, caseRecord: null, historicalDecision: null });
        return true;
      }
      const pinnedRef = recordedRef.decisionResolutionStatus === 'pinned'
        && (!recordedRef.originReplySha256 || recordedRef.originReplySha256 !== original.replyRef?.sha256)
        ? { ...recordedRef, decisionResolutionStatus: 'unresolved_ambiguous' as const, resolutionNote: '旧记录缺少原回复的决策归属凭据，保留待核。' }
        : recordedRef;
      let caseRecord: ReturnType<CaseStore['getCase']> | null = null;
      let historicalDecision: ReturnType<CaseStore['getDecision']> | null = null;
      let latestDecision: ReturnType<CaseStore['getDecision']> | null = null;
      if (options.cases) {
        try { caseRecord = options.cases.getCase(pinnedRef.caseId); } catch { caseRecord = null; }
        if (caseRecord && pinnedRef.decisionId) {
          if (pinnedRef.decisionResolutionStatus === 'pinned' && Number.isSafeInteger(pinnedRef.decisionRevision)) {
            try {
              historicalDecision = options.cases.getDecision(pinnedRef.caseId, pinnedRef.decisionId, pinnedRef.decisionRevision);
            } catch { historicalDecision = null; }
          }
          try {
            latestDecision = options.cases.getDecision(pinnedRef.caseId, pinnedRef.decisionId);
          } catch { latestDecision = null; }
        }
      }
      json(response, 200, {
        feedbackId: fb.id,
        originalCaseRef: pinnedRef,
        caseRecord,
        historicalDecision,
        latestDecision,
      });
      return true;
    }

    const feedbackHandleMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/feedback\/([a-f0-9-]+)\/handle$/.exec(url.pathname);
    if (feedbackHandleMatch && request.method === 'POST') {
      assertEnabledWritable();
      const operator = resolveRequestOperator(request);
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const currentPack = packs.get(feedbackHandleMatch[1]!);
        await assertWritablePackProject(currentPack, operator, input.projectId);
        return options.operations.run(requestId, { path: url.pathname, input }, async () => {
        const existingFb = currentPack.feedbackItems.find(f => f.id === uuid(feedbackHandleMatch[2]!));
        if (!existingFb) throw new StudioError('enterprise_pack_feedback_not_found', 404);

        let verifiedRevisedRef: StudioSourceRef | undefined;
        if (input.revisedRef !== undefined) {
          verifiedRevisedRef = sourceRef(input.revisedRef);
          if (options.inspectAuthorityDependency) {
            const check = await options.inspectAuthorityDependency(currentPack, verifiedRevisedRef);
            if (check.status !== 'succeeded') throw new StudioError('revised_authority_ref_not_published', 409);
          }
        }

        // R5.2: When routing to an original authority (investigating / revision_prepared), create REAL linked Studio workItem & feedback!
        let studioWorkItemId = existingFb.authorityHandling?.studioWorkItemId;
        let studioFeedbackId = existingFb.authorityHandling?.studioFeedbackId;
        const targetStatus = input.status as Parameters<EnterprisePackStore['handleFeedback']>[2]['status'];
        if (['investigating', 'revision_prepared'].includes(targetStatus) && existingFb.targetAuthority !== 'task' && !studioWorkItemId) {
          const studioSys = options.studio.get(currentPack.systemId);
          const linkSources: StudioSourceRef[] = [
            ...(existingFb.targetAssetRef ? [existingFb.targetAssetRef] : []),
            ...existingFb.reports.map(r => r.reportRef),
          ];
          const uniqueLinkSources = [...new Map(linkSources.map(r => [digest(r), r])).values()];
          const workItem = options.studio.setWorkItem(currentPack.systemId, {
            topicId: studioSys.currentTopicId,
            kind: 'review',
            title: `[会员包反馈 ${existingFb.feedbackCode}] ${existingFb.title}`,
            detail: `来自企业会员包 ${currentPack.packCode} v${existingFb.packVersion}（归属原权威：${existingFb.targetAuthority}）。处置说明：${text(input.note, 2000, false)}`,
            impact: `受影响用途：${(Array.isArray(input.impactedPurposeIds) && input.impactedPurposeIds.length ? input.impactedPurposeIds : existingFb.purposeIds).join('、') || '待核定受影响用途'}；未受影响用途保持不变。`,
            nextStep: '在对应原权威修订资产并形成新版包预览，随后由独立新任务按新版实读并复算核验后闭环。',
            sources: uniqueLinkSources,
            status: 'in_progress',
          });
          studioWorkItemId = workItem.id;
          const studioFb = options.studio.addFeedback(currentPack.systemId, {
            title: `[会员包 ${existingFb.feedbackCode}] ${existingFb.title}`,
            problem: existingFb.reports.map(r => r.evidenceNote).join('；') || existingFb.title,
            currentHandling: `已由会员包转入原权威修订（关联工作项 ${workItem.id}，归属 ${existingFb.targetAuthority}）`,
            sources: uniqueLinkSources,
          });
          studioFeedbackId = studioFb.id;
        }

        let verifiedItemEvidence: EnterprisePackFeedbackItemVerification | undefined;
        if (targetStatus === 'verified' && typeof input.verifiedByUseId === 'string') {
          const use = currentPack.useRecords.find(u => u.id === uuid(input.verifiedByUseId));
          if (use && (use.tier === 'formal-calculation' || use.tier === 'limited-calculation')) {
            if (!object(input.itemVerification)) throw new StudioError('feedback_verification_missing_item_evidence', 409);
            const originalUse = currentPack.useRecords.find(record => record.id === existingFb.reports[0]?.linkedUseRecordId);
            verifiedItemEvidence = await verifyFeedbackItems(
              existingFb, use, originalUse, input.itemVerification as unknown as EnterprisePackFeedbackItemVerification,
            );
          }
        }

        const handled = packs.handleFeedback(feedbackHandleMatch[1]!, feedbackHandleMatch[2]!, {
          status: targetStatus,
          note: text(input.note, 5000, false),
          ...(input.targetRef ? { targetRef: sourceRef(input.targetRef) } : {}),
          ...(verifiedRevisedRef ? { revisedRef: verifiedRevisedRef } : {}),
          ...(typeof input.revisedPackVersion === 'string' ? { revisedPackVersion: input.revisedPackVersion } : {}),
          ...(studioWorkItemId ? { studioWorkItemId } : {}),
          ...(studioFeedbackId ? { studioFeedbackId } : {}),
          ...(Array.isArray(input.impactedPurposeIds) ? { impactedPurposeIds: input.impactedPurposeIds.map(String) } : {}),
          ...(typeof input.verifiedByUseId === 'string' ? { verifiedByUseId: input.verifiedByUseId } : {}),
          ...(verifiedItemEvidence ? { itemVerification: verifiedItemEvidence } : {}),
        });
        return { result: { ...handled, ...(studioWorkItemId ? { studioWorkItemId } : {}), ...(studioFeedbackId ? { studioFeedbackId } : {}) } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        });
      });
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }

    const useVerifyMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/uses\/([a-f0-9-]+)\/verify$/.exec(url.pathname);
    if (useVerifyMatch && request.method === 'POST') {
      assertEnabledWritable();
      const operator = resolveRequestOperator(request);
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const currentPack = packs.get(useVerifyMatch[1]!);
        const useRecord = currentPack.useRecords.find(u => u.id === uuid(useVerifyMatch[2]!));
        if (!useRecord) throw new StudioError('enterprise_pack_use_not_found', 404);
        const reader = activeOperatorProject(operator);
        if (!reader || options.enterpriseScopes.enterpriseIdForProject(reader) !== currentPack.enterpriseId
          || (!canReadConstructionPack(currentPack, reader, operator) && reader !== useRecord.projectId)) {
          throw new StudioError('member_pack_operator_context_required', 403);
        }
        const result = await options.operations.run(requestId, { path: url.pathname, input }, async () => {
        const studioSys = options.studio.get(currentPack.systemId);
        const candidates = studioSys.uses.filter(studioUse => matchesStudioUse(useRecord, studioUse));
        const studioUse = candidates.length === 1 ? candidates[0] : undefined;
        const rawAssessment = input.assessmentReportRef ?? input.verificationReportRef;
        const exactAssessment = rawAssessment === undefined ? undefined : sourceRef(rawAssessment);
        const latest = studioUse?.assessments?.filter(item =>
          !item.evidence?.purposeId || item.evidence.purposeId === useRecord.purposeId,
        ).at(-1);
        const linkedPurposes = new Set(studioUse
          ? currentPack.useRecords.filter(use => matchesStudioUse(use, studioUse)).map(use => use.purposeId)
          : []);
        const use = studioUse && latest && (!exactAssessment || exactTaskReport(latest.report, exactAssessment)) &&
          (linkedPurposes.size === 1 || latest.evidence?.purposeId === useRecord.purposeId)
          ? await applyStudioAssessment(currentPack, useRecord, studioUse, latest)
          : useRecord;
        return { result: { use, pack: packs.get(useVerifyMatch[1]!) } as unknown as Record<string, unknown> };
        });
        const pack = scopedPack(packs.get(currentPack.id), reader, operator);
        return { ...result, result: { ...result.result, pack, use: pack.useRecords.find(use => use.id === useRecord.id) } };
      });
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }

    const restrictRevMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/revisions\/([^/]+)\/restrict$/.exec(url.pathname);
    if (restrictRevMatch && request.method === 'POST') {
      assertEnabledWritable();
      const operator = resolveRequestOperator(request);
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const currentPack = packs.get(restrictRevMatch[1]!);
        await assertWritablePackProject(currentPack, operator, input.projectId);
        return options.operations.run(requestId, { path: url.pathname, input }, async () => {
        const revision = packs.restrictRevision(restrictRevMatch[1]!, decodeURIComponent(restrictRevMatch[2]!), text(input.reason, 2000, false));
        return { result: { revision, pack: packs.get(restrictRevMatch[1]!) } as unknown as Record<string, unknown> };
        });
      });
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }

    return false;
  }

  return {
    enabled,
    references,
    grants,
    packs,
    bindSystemOperator,
    preserveImmutableReportSnapshot,
    readPreservedReportBytes,
    isReportLockedByUseOrFeedback,
    projectPermissionFingerprint,
    presentTaskHistory,
    assertCurrentReportFile,
    nextProjectGrantExpiry,
    getProjectToolScope,
    prepareRestrictedTaskWorkspace,
    retireRestrictedWorkspaceInputs,
    syncWorkspaceReportsToProject,
    discardUncommittedWorkspaceReports,
    resolveTaskReportLocator,
    authorizeProjectDataPath,
    resolveTaskDataPurpose,
    assertProjectDataPathAllowed,
    filterAuthorizedProjectData,
    filterProjectFileTree,
    evaluateNativeToolCall,
    buildPackCatalogSummary,
    inspectPinnedSourceRead,
    assertDeclaredReportAccess,
    resolveGrantAuthorityForProject,
    recordUseFromStudioDeclaration,
    syncAssessmentFromStudio,
    handle,
  };
}
