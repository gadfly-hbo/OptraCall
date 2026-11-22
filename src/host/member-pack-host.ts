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
import { buildAuthorizedDataView } from './member-pack-data-view.ts';
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

  function projectPermissionFingerprint(projectId: string): string {
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return `unscoped:${enabled ? '1' : '0'}`;
    const nowMs = Date.now();
    // Do NOT hash activeRev here: publishing v1.1 must never disrupt or re-gear unaffected tasks pinned to v1.0!
    const activePacks = packs.list(enterpriseId).map(p => ({
      id: p.id,
      owner: isConstructionOwnerProject(p, projectId),
    }));
    // Include live activeNow status so natural validTo expiration immediately changes the fingerprint!
    const subjectGrants = grants.listForSubject(enterpriseId, projectId).map(g => {
      const activeNow = isGrantActive(g, nowMs);
      return {
        id: g.id,
        activeNow,
        ops: activeNow ? g.operations : [],
        scope: activeNow ? g.scope : null,
        purposeKeys: activeNow ? (g.purposeKeys ?? []) : [],
        revokedAt: g.revokedAt ?? null,
      };
    });
    return createHash('sha256')
      .update(JSON.stringify({ enabled, enterpriseId, activePacks, subjectGrants }))
      .digest('hex');
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

  async function assertWritablePackProject(pack: EnterpriseDomainPack, requestedProjectId?: unknown) {
    if (requestedProjectId !== undefined && requestedProjectId !== null && String(requestedProjectId).trim() !== '') {
      return assertWritableProject(String(requestedProjectId), pack.enterpriseId);
    }
    const system = options.studio.get(pack.systemId);
    const ownerProjectId = pack.activeOwnerProjectId ?? studioExecutionOwner(system).projectId;
    return assertWritableProject(ownerProjectId, pack.enterpriseId);
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
    // R6: In --disable-member-pack rollback mode, stop creating restricted workspaces or copying files!
    if (!enabled) return undefined;
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return undefined;
    const enterprisePacks = packs.list(enterpriseId);
    const subjectGrants = grants.listForSubject(enterpriseId, projectId);
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
    const osSandboxAvailable = hasOsSandboxAvailable();
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
    if (!enabled) return;
    ensurePrivateDir(workspaceCleanDir);
    // Clear existing files in sandbox clean dir first so revoked files are immediately purged!
    for (const entry of fs.readdirSync(workspaceCleanDir, { withFileTypes: true })) {
      fs.rmSync(path.join(workspaceCleanDir, entry.name), { recursive: true, force: true });
    }
    // R2: When OS managed sandbox is unavailable, NEVER copy raw detail files to an unprotected filesystem directory!
    if (!scope || scope.mode !== 'allowlist' || !hasOsSandboxAvailable()) return;
    const subjectGrants = grants.listForSubject(scope.enterpriseId, scope.projectId);
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
    if (!enabled) return undefined;
    const scope = getProjectToolScope(projectId);
    if (!scope) return undefined;
    const osSandboxAvailable = hasOsSandboxAvailable();
    const workspaceRoot = path.resolve(options.dataRoot, 'member-pack-workspaces', uuid(projectId), uuid(taskId));
    const cleanDir = path.join(workspaceRoot, '020_clean');
    const reportsDir = path.join(workspaceRoot, '060_reports');
    const workDir = path.join(workspaceRoot, 'work');
    const committedReportsDir = path.join(workspaceRoot, 'committed-reports');
    ensurePrivateDir(workspaceRoot);
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

  function syncActiveWorkspacesForProject(projectId: string) {
    if (!enabled) return;
    const byTask = activeWorkspaces.get(projectId);
    if (!byTask) return;
    const nextScope = getProjectToolScope(projectId);
    for (const ws of byTask.values()) {
      syncCleanDir(ws.cleanDir, ws.projectRoot, nextScope);
      if (nextScope) ws.scope = nextScope;
    }
  }

  function syncWorkspaceReportsToProject(projectId: string, taskId: string, projectRoot: string) {
    if (!enabled) return;
    const pid = uuid(projectId), tid = uuid(taskId);
    const wsRoot = path.resolve(options.dataRoot, 'member-pack-workspaces', pid, tid);
    const workspaceReports = path.join(wsRoot, '060_reports');
    const committedReports = path.join(wsRoot, 'committed-reports');
    if (!fs.existsSync(workspaceReports)) return;
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

  function authorizeProjectDataPath(projectId: string, relativePath: string): { allowed: boolean; reason?: string } {
    if (!enabled) return { allowed: true };
    const scope = getProjectToolScope(projectId);
    if (!scope) return { allowed: true };
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return { allowed: true };
    const subjectGrants = grants.listForSubject(enterpriseId, projectId);
    const normalized = normalizeRelativeDataPath(relativePath);
    const evalResult = evaluateResourceAccess(subjectGrants, {
      operation: 'read-detail-recalculate',
      dataPath: normalized,
    });
    return evalResult.allowed
      ? { allowed: true }
      : { allowed: false, reason: evalResult.restrictionReason ?? 'resource_detail_not_authorized' };
  }

  function assertProjectDataPathAllowed(projectId: string, relativePath: string): void {
    const result = authorizeProjectDataPath(projectId, relativePath);
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

  function filterAuthorizedProjectData(projectId: string, relativePath: string, rawBytes: Buffer): { bytes: Buffer; filtered?: boolean; restrictionNote?: string } {
    if (!enabled) return { bytes: rawBytes, filtered: false };
    const scope = getProjectToolScope(projectId);
    if (!scope) return { bytes: rawBytes, filtered: false };
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return { bytes: rawBytes, filtered: false };
    const subjectGrants = grants.listForSubject(enterpriseId, projectId);
    const view = buildAuthorizedDataView(rawBytes, relativePath, subjectGrants);
    if (!view.allowed) {
      throw Object.assign(new StudioError(view.reason, 403), { code: view.code });
    }
    return {
      bytes: view.bytes,
      filtered: view.filtered,
      ...(view.restrictionNote ? { restrictionNote: view.restrictionNote } : {}),
    };
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
      if (!enabled) return undefined;
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

    // R2: Live natural-expiry enforcement — if grants expired/shrank since workspace preparation,
    // immediately purge stale authorized views from workspace 020_clean before executing ANY tool!
    if (workspaceRoot && fs.existsSync(effectiveCleanDir)) {
      const existingByTask = activeWorkspaces.get(projectId);
      let wsMatches: RestrictedTaskWorkspace | undefined;
      if (existingByTask) {
        for (const ws of existingByTask.values()) {
          if (path.resolve(ws.workspaceRoot) === effectiveRoot) {
            wsMatches = ws;
            break;
          }
        }
      }
      const prevPaths = wsMatches?.scope.allowedPaths ?? [];
      const prevMode = wsMatches?.scope.mode;
      const scopeChanged = prevMode !== scope.mode
        || prevPaths.length !== scope.allowedPaths.length
        || prevPaths.some((p, i) => p !== scope.allowedPaths[i]);
      if (scopeChanged || scope.mode === 'deny-detail') {
        syncCleanDir(effectiveCleanDir, resolvedProjectRoot, scope);
        if (wsMatches) wsMatches.scope = scope;
      }
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

  function packContainsSourceRef(pack: EnterpriseDomainPack, ref: StudioSourceRef): boolean {
    if (pack.purposes.some(p => p.dependencies.some(d => sameExactSourceRef(d.ref, ref)))) return true;
    if (pack.packRevisions.some(r => r.purposeManifests.some(pm => pm.dependencies.some(d => sameExactSourceRef(d.ref, ref))))) return true;
    return false;
  }

  function buildPackCatalogSummary(enterpriseId: string, projectId?: string, taskId?: string) {
    const list = packs.list(enterpriseId);
    const subjectGrants = projectId ? grants.listForSubject(enterpriseId, projectId) : [];
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
            const pin = packs.pinTaskVersion(pack.id, { projectId, taskId, authorizedScope: scopeDesc });
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

    const subjectGrants = grants.listForSubject(enterpriseId, projectId);
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
    let resolvedSelection: { sessionId: string; messageId: string } | undefined = upToSelection;

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
          break;
        }
      }
    }

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
      resolvedSelection,
    };
  }

  /**
   * R4: Inspects an independent verifier task's OWN native transcript & assessment report to confirm:
   *  1. Exact assessment turn (`assessmentTurnIndex`, `assessmentMessageId`) and explicit attribution of
   *     which required authority reads happened in this turn vs carried from earlier turns (`carriedFromTurnIndices`).
   *  2. Verifier actually read ALL required original authority dependencies completely.
   *  3. For calculation tiers, verifier actually inspected authorized `020_clean/` input data or the target
   *     report (not a meaningless `echo`/`pwd` command), AND the assessment report on disk explicitly binds
   *     to the target report/use record with concrete recalculation/comparison evidence.
   */
  async function inspectVerifierTaskEvidence(
    verifierProjectId: string,
    verifierTaskId: string,
    pack: EnterpriseDomainPack,
    useRecord: EnterprisePackUseRecord,
    assessmentReportRef?: StudioSourceRef,
  ): Promise<{
    verifierReads: {
      ref: StudioSourceRef;
      complete: boolean;
      readAt: string;
      turnIndex?: number;
      entryId?: string;
      fromAssessmentTurn?: boolean;
    }[];
    requiredCount: number;
    readRequiredAssetsCount: number;
    allRequiredReadByVerifier: boolean;
    hadDataOrCalcEvidence: boolean;
    assessmentTurnIndex?: number;
    assessmentMessageId?: string;
    carriedFromTurnIndices: number[];
    targetReportChecked: boolean;
    authorizedInputChecked: boolean;
    assessmentReportBoundToTarget: boolean;
    missingReason?: string;
  }> {
    const rev = pack.packRevisions.find(r => r.version === useRecord.packVersion);
    const pm = rev?.purposeManifests.find(p => p.purposeId === useRecord.purposeId);
    const requiredRefs = pm
      ? pm.dependencies.filter(d => d.requiredFor.includes(pm.tier)).map(d => d.ref)
      : [];
    const verifierReads: {
      ref: StudioSourceRef;
      complete: boolean;
      readAt: string;
      turnIndex?: number;
      entryId?: string;
      fromAssessmentTurn?: boolean;
    }[] = [];
    const seen = new Set<string>();
    let targetReportChecked = false;
    let authorizedInputChecked = false;
    let assessmentTurnIndex: number | undefined;
    let assessmentMessageId: string | undefined;

    const targetLocator = useRecord.reportRef.locator ?? '';
    const targetBasename = targetLocator ? path.basename(targetLocator).toLowerCase() : '';
    const targetShaPrefix = useRecord.reportRef.sha256 ? useRecord.reportRef.sha256.slice(0, 8).toLowerCase() : '';
    const assessLocator = assessmentReportRef?.locator ?? '';
    const assessBasename = assessLocator ? path.basename(assessLocator).toLowerCase() : '';

    if (options.taskSnapshot) {
      try {
        const snap = await options.taskSnapshot(verifierProjectId, verifierTaskId);
        const rawMessages = snap.messages as Record<string, any>[];
        // Map toolCallId -> { name, argsText, turnIndex } from assistant toolCall blocks
        const toolCallMeta = new Map<string, { name: string; argsText: string; turnIndex: number }>();
        let curTurn = 0;
        let lastAssistantTurn = 0;
        let lastAssistantMsgId: string | undefined;

        for (let i = 0; i < rawMessages.length; i++) {
          const msg = rawMessages[i];
          if (!msg) continue;
          if (msg.role === 'user') {
            curTurn += 1;
            continue;
          }
          if (msg.role === 'assistant') {
            lastAssistantTurn = curTurn;
            if (typeof msg.id === 'string') lastAssistantMsgId = msg.id;
            const blocks = Array.isArray(msg.content) ? msg.content : [];
            for (const blk of blocks) {
              if (blk && typeof blk === 'object' && blk.type === 'toolCall' && typeof blk.id === 'string') {
                const argsText = typeof blk.arguments === 'string'
                  ? blk.arguments
                  : JSON.stringify(blk.arguments ?? {});
                toolCallMeta.set(blk.id, { name: String(blk.name ?? ''), argsText, turnIndex: curTurn });
                const lowerArgs = argsText.toLowerCase();
                if (
                  (blk.name === 'studio_assets' && lowerArgs.includes('assess-use') && (!assessBasename || lowerArgs.includes(assessBasename)))
                  || (assessBasename && ['write', 'edit', 'write_report', 'write_project_report'].includes(String(blk.name ?? '')) && lowerArgs.includes(assessBasename))
                ) {
                  assessmentTurnIndex = curTurn;
                  if (typeof msg.id === 'string') assessmentMessageId = msg.id;
                }
              }
            }
          }
          if (msg.role === 'toolResult' && !msg.isError) {
            if (msg.details?.type === 'optracall.studio' && msg.details.action === 'assess-use') {
              assessmentTurnIndex = curTurn;
            }
          }
        }
        if (assessmentTurnIndex === undefined && lastAssistantTurn > 0) {
          assessmentTurnIndex = lastAssistantTurn;
        }
        if (!assessmentMessageId && lastAssistantMsgId) {
          assessmentMessageId = lastAssistantMsgId;
        }

        // Second pass: collect reads & substantive data/report inspection with exact turnIndex attribution
        curTurn = 0;
        for (const msg of rawMessages) {
          if (!msg) continue;
          if (msg.role === 'user') {
            curTurn += 1;
            continue;
          }
          if (msg.role !== 'toolResult' || msg.isError) continue;
          const toolName = String(msg.toolName ?? '');
          const callId = typeof msg.toolCallId === 'string' ? msg.toolCallId : (typeof msg.id === 'string' ? msg.id : undefined);
          const meta = callId ? toolCallMeta.get(callId) : undefined;
          const argsLower = (meta?.argsText ?? '').toLowerCase();
          const resultTextLower = messageText(msg).toLowerCase();

          // Detect target report inspection
          if (
            targetBasename
            && ['read', 'read_input', 'read_project_input', 'bash', 'powershell', 'codemode'].includes(toolName)
            && (argsLower.includes(targetBasename) || (targetLocator && argsLower.includes(targetLocator.toLowerCase())))
          ) {
            targetReportChecked = true;
          }

          // Detect authorized input data reading or genuine calculation/recalculation tool call
          if (['read_input', 'read_project_input'].includes(toolName)) {
            authorizedInputChecked = true;
          } else if (toolName === 'read') {
            if (argsLower.includes('020_clean') || /\.(?:csv|tsv|json)\b/i.test(argsLower)) {
              authorizedInputChecked = true;
            }
          } else if (['bash', 'powershell', 'codemode'].includes(toolName)) {
            const isDataOrCalcCmd =
              argsLower.includes('020_clean')
              || /\.(?:csv|tsv|json)\b/i.test(argsLower)
              || (targetBasename ? argsLower.includes(targetBasename) : false)
              || /\b(?:python3?|node|awk|jq|csv|pandas|sqlite3)\b/i.test(argsLower)
              || (resultTextLower.includes('020_clean') || /\b(?:repeat|refund|repurchase|复购|退款|订单)\b/i.test(resultTextLower));
            if (isDataOrCalcCmd) {
              authorizedInputChecked = true;
            }
          }

          if (msg.details?.type === 'optracall.studio' && ['read-source', 'read'].includes(msg.details.action) && msg.details.result?.ref) {
            try {
              const ref = sourceRef(msg.details.result.ref);
              if (ref.authority === 'data') authorizedInputChecked = true;
              if (
                ref.authority === 'task'
                && (
                  digest(ref) === digest(useRecord.reportRef)
                  || (useRecord.reportRef.sha256 && ref.sha256 === useRecord.reportRef.sha256)
                  || (targetLocator && ref.locator === targetLocator)
                )
              ) {
                targetReportChecked = true;
              }
              const key = digest(ref);
              const existingIdx = verifierReads.findIndex(r => digest(r.ref) === key);
              const readItem = {
                ref,
                complete: msg.details.result.complete === true,
                readAt: new Date().toISOString(),
                turnIndex: curTurn,
                ...(callId ? { entryId: callId } : {}),
                ...(assessmentTurnIndex !== undefined ? { fromAssessmentTurn: curTurn === assessmentTurnIndex } : {}),
              };
              if (existingIdx === -1) {
                seen.add(key);
                verifierReads.push(readItem);
              } else if (curTurn === assessmentTurnIndex && !verifierReads[existingIdx]!.fromAssessmentTurn) {
                verifierReads[existingIdx] = readItem;
              }
            } catch { /* ignore */ }
          }
          if (msg.details?.type === 'optracall.semantic-context-result' && ['read', 'trace'].includes(msg.details.action)) {
            for (const item of [...(msg.details.items ?? []), ...(msg.details.unknownTime ?? [])]) {
              if (typeof item?.body === 'string' && item?.target && typeof item.sha256 === 'string') {
                const t = item.target;
                let ref: StudioSourceRef | undefined;
                if (t.kind === 'sap') ref = sourceRef({ authority: 'sap-metric', id: t.packageId, version: t.version, sha256: item.sha256 });
                else if (t.kind === 'sap-method') ref = sourceRef({ authority: 'sap-method', id: t.methodId, version: String(t.version), sha256: item.sha256 });
                else if (t.kind === 'enterprise') ref = sourceRef({ authority: 'enterprise', id: t.materialId, version: t.revisionId, sha256: item.sha256, locator: t.storeId });
                else if (t.kind === 'studio-source') ref = sourceRef({ authority: 'studio-source', id: t.assetId, version: String(t.version), sha256: item.sha256, locator: t.systemId });
                if (ref) {
                  const key = digest(ref);
                  const existingIdx = verifierReads.findIndex(r => digest(r.ref) === key);
                  const readItem = {
                    ref,
                    complete: item.complete !== false,
                    readAt: new Date().toISOString(),
                    turnIndex: curTurn,
                    ...(callId ? { entryId: callId } : {}),
                    ...(assessmentTurnIndex !== undefined ? { fromAssessmentTurn: curTurn === assessmentTurnIndex } : {}),
                  };
                  if (existingIdx === -1) {
                    seen.add(key);
                    verifierReads.push(readItem);
                  } else if (curTurn === assessmentTurnIndex && !verifierReads[existingIdx]!.fromAssessmentTurn) {
                    verifierReads[existingIdx] = readItem;
                  }
                }
              }
            }
          }
        }
      } catch { /* snapshot unavailable */ }
    }

    // Read & verify the assessment report text binds to THIS target report/use record!
    let assessmentReportBoundToTarget = false;
    const isCalcTier = useRecord.tier === 'formal-calculation' || useRecord.tier === 'limited-calculation';
    if (assessmentReportRef?.projectId && assessmentReportRef.locator?.startsWith('060_reports/')) {
      try {
        const effLoc = resolveTaskReportLocator(assessmentReportRef.projectId, verifierTaskId, assessmentReportRef.locator, assessmentReportRef.sha256);
        const preserved = readPreservedReportBytes(assessmentReportRef.projectId, verifierTaskId, effLoc, assessmentReportRef.sha256);
        const bytes = preserved ?? (await options.projects.readFile(assessmentReportRef.projectId, effLoc)).bytes;
        const reportText = bytes.toString('utf8');
        const lowerReport = reportText.toLowerCase();
        const referencesTarget = Boolean(
          (targetBasename && lowerReport.includes(targetBasename))
          || (targetLocator && lowerReport.includes(targetLocator.toLowerCase()))
          || (targetShaPrefix && lowerReport.includes(targetShaPrefix))
          || lowerReport.includes(useRecord.taskId.slice(0, 8).toLowerCase())
          || lowerReport.includes(useRecord.purposeKey.toLowerCase())
          || lowerReport.includes(`v${useRecord.packVersion.toLowerCase()}`)
          || lowerReport.includes(useRecord.packVersion.toLowerCase()),
        );
        const hasCalcComparisonContent = !isCalcTier || (
          /\d/.test(reportText)
          && /(?:复算|复核|核对|对比|一致|偏差|口径|笔|率|通过|失败|退款|复购|recalc|recomput|compar|verify|verified|checked|match|diff|pass|fail|rate|ratio|orders?|refund)/i.test(reportText)
        );
        assessmentReportBoundToTarget = referencesTarget && hasCalcComparisonContent;
      } catch {
        assessmentReportBoundToTarget = false;
      }
    } else if (!assessmentReportRef) {
      assessmentReportBoundToTarget = true;
    }

    const completeVerifierReads = verifierReads.filter(r => r.complete);
    const matchedRequiredReads = requiredRefs
      .map(req => completeVerifierReads.find(vr => sameExactSourceRef(vr.ref, req)))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    const readRequiredAssetsCount = matchedRequiredReads.length;
    const allRequiredReadByVerifier = requiredRefs.length > 0
      ? readRequiredAssetsCount === requiredRefs.length
      : completeVerifierReads.length > 0;

    const carriedFromTurnIndices = [...new Set(
      matchedRequiredReads
        .filter(r => typeof r.turnIndex === 'number' && assessmentTurnIndex !== undefined && r.turnIndex < assessmentTurnIndex)
        .map(r => r.turnIndex!),
    )].sort((a, b) => a - b);

    const hadDataOrCalcEvidence = authorizedInputChecked || targetReportChecked;
    let missingReason: string | undefined;
    if (!allRequiredReadByVerifier) {
      missingReason = `独立核验任务 ${verifierTaskId.slice(0, 8)} 尚未完整实读适用原依赖（已完整实读 ${readRequiredAssetsCount}/${requiredRefs.length} 项），缺乏核验实证，保持待验证`;
    } else if (isCalcTier && !hadDataOrCalcEvidence) {
      missingReason = `独立核验任务 ${verifierTaskId.slice(0, 8)} 未记录对获准明细数据或原报告的实查/复算工具轨迹（空命令不算复算依据），保持待验证`;
    } else if (assessmentReportRef && !assessmentReportBoundToTarget) {
      missingReason = `独立核验报告 ${assessLocator || assessmentReportRef.id} 未绑定目标报告（${targetBasename || useRecord.taskId.slice(0, 8)}）或缺少复算对照内容，保持待验证`;
    }
    return {
      verifierReads,
      requiredCount: requiredRefs.length,
      readRequiredAssetsCount,
      allRequiredReadByVerifier,
      hadDataOrCalcEvidence,
      ...(assessmentTurnIndex !== undefined ? { assessmentTurnIndex } : {}),
      ...(assessmentMessageId ? { assessmentMessageId } : {}),
      carriedFromTurnIndices,
      targetReportChecked,
      authorizedInputChecked,
      assessmentReportBoundToTarget,
      ...(missingReason ? { missingReason } : {}),
    };
  }

  function redactPackForConsumer(pack: EnterpriseDomainPack, projectId: string): EnterpriseDomainPack {
    if (isConstructionOwnerProject(pack, projectId)) return pack;
    const subjectGrants = grants.listForSubject(pack.enterpriseId, projectId);
    const nowMs = Date.now();
    const activeGrants = subjectGrants.filter(g => !g.revokedAt && (!g.validFrom || Date.parse(g.validFrom) <= nowMs) && (!g.validTo || Date.parse(g.validTo) >= nowMs));
    const ownPins = pack.taskPins.filter(p => p.projectId === projectId);
    const ownUses = pack.useRecords.filter(u => u.projectId === projectId);
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
        ...pack,
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
        })),
        feedbackItems: ownFeedback.map(f => ({
          ...f,
          targetAssetRef: undefined,
          authorityHandling: undefined,
          revisionLink: undefined,
          reports: f.reports.map(r => ({ ...r, usedAssetRefs: [] })),
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
      ...pack,
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
        actualReads: u.actualReads.filter(r => isRefAllowed(r.ref)),
        ...(u.authorDeclaration ? {
          authorDeclaration: {
            ...u.authorDeclaration,
            declaredRefs: u.authorDeclaration.declaredRefs.filter(isRefAllowed),
          },
        } : {}),
      })),
      feedbackItems: ownFeedback.map(f => ({
        ...f,
        ...(f.targetAssetRef && !isRefAllowed(f.targetAssetRef) ? { targetAssetRef: undefined } : {}),
        reports: f.reports.map(r => ({ ...r, usedAssetRefs: r.usedAssetRefs.filter(isRefAllowed) })),
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
      const effectiveOperatorId = operator?.operatorId?.trim() || 'local:host';
      if (pack) {
        if (!isConstructionOwnerProject(pack, pid)) return undefined;
        const boundOp = getBoundSystemOperator(pack.systemId);
        if (boundOp && boundOp !== effectiveOperatorId) return undefined;
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
      const boundOp = getBoundSystemOperator(ownedSystem.id);
      if (boundOp && boundOp !== effectiveOperatorId) return undefined;
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
    const subjectGrants = grants.listForSubject(enterpriseId, input.projectId);
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
        const already = pack.useRecords.find(u =>
          u.projectId === input.projectId
          && u.taskId === input.taskId
          && u.purposeId === pm.purposeId
          && Boolean(u.authorDeclaration)
          && (
            digest(u.reportRef) === digest(input.studioUse.report)
            || (input.studioUse.report.sha256 && u.reportRef.sha256 === input.studioUse.report.sha256)
          ),
        );
        if (already) {
          created.push(already);
          continue;
        }
        const hasDetailGrant = isConstruction || activeGrants.some(g => g.operations.includes('read-detail-recalculate'));
        const hasSummaryGrant = activeGrants.some(g => g.operations.includes('cite-summary'));
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

  /**
   * R4: Synchronizes a `studio_assets assess-use` assessment onto matching EnterprisePackUseRecord(s).
   * Strictly separates same-task author self-assessment (kept `pending`) from independent-task
   * verification, AND requires the independent verifier task ITSELF to possess actual complete
   * native reads of the required original dependencies (plus target-bound recalculation/comparison
   * evidence for calculation tiers) before granting `status = 'pass'`.
   */
  async function syncAssessmentFromStudio(input: {
    systemId: string;
    studioUse: StudioUseRecord;
    assessment: StudioUseAssessment;
    assessorProjectId: string;
    assessorTaskId: string;
  }): Promise<EnterprisePackUseRecord[]> {
    if (!enabled) return [];
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(input.studioUse.projectId);
    if (!enterpriseId) return [];
    const matchingPacks = packs.list(enterpriseId).filter(p => p.systemId === input.systemId);
    if (!matchingPacks.length) return [];

    let assessmentDiskVerified = false;
    if (input.assessment.report.projectId && input.assessment.report.locator?.startsWith('060_reports/')) {
      try {
        const file = await options.projects.readFile(input.assessment.report.projectId, input.assessment.report.locator);
        const actualSha = createHash('sha256').update(file.bytes).digest('hex');
        if (!input.assessment.report.sha256 || input.assessment.report.sha256 === actualSha) {
          assessmentDiskVerified = true;
          preserveImmutableReportSnapshot(input.assessment.report.projectId, input.assessment.report.locator, file.bytes, actualSha);
        }
      } catch {
        assessmentDiskVerified = false;
      }
    }

    const updated: EnterprisePackUseRecord[] = [];
    for (const pack of matchingPacks) {
      const matchedUses = pack.useRecords.filter(u =>
        u.projectId === input.studioUse.projectId
        && u.taskId === input.studioUse.taskId
        && (
          digest(u.reportRef) === digest(input.studioUse.report)
          || (u.reportRef.locator && input.studioUse.report.locator && u.reportRef.locator === input.studioUse.report.locator)
          || (u.reportRef.sha256 && input.studioUse.report.sha256 && u.reportRef.sha256 === input.studioUse.report.sha256)
        ),
      );
      for (const useRecord of matchedUses) {
        const isIndependentAssessor = Boolean(
          input.assessorTaskId
          && input.assessorTaskId !== useRecord.taskId
          && digest(input.assessment.report) !== digest(useRecord.reportRef),
        );
        const verifierEv = isIndependentAssessor
          ? await inspectVerifierTaskEvidence(input.assessorProjectId, input.assessorTaskId, pack, useRecord, input.assessment.report)
          : undefined;
        const verifierEvidenceSufficient = Boolean(verifierEv && !verifierEv.missingReason);
        const independentConfirmed = Boolean(
          isIndependentAssessor
          && input.assessment.status === 'pass'
          && assessmentDiskVerified
          && verifierEvidenceSufficient,
        );
        const wrongVersionConfirmedByVerifier = Boolean(
          isIndependentAssessor
          && input.assessment.status === 'fail'
          && assessmentDiskVerified
          && /(?:旧版|错版|wrong.?version|误用旧)/i.test(input.assessment.result ?? ''),
        );
        const verdictDetail = !isIndependentAssessor
          ? `仅见原分析任务作者自评（同任务 ${input.assessorTaskId.slice(0, 8)}），缺少独立任务核验，保持待验证`
          : input.assessment.status === 'fail'
            ? `独立任务核验未通过：${input.assessment.result}`
            : !assessmentDiskVerified
              ? '独立核验报告未通过落盘摘要核对，保持待验证'
              : verifierEv?.missingReason
                ? verifierEv.missingReason
                : input.assessment.result || '已通过独立任务实读、复算与落盘报告核验';

        const verified = packs.verifyUse(pack.id, useRecord.id, {
          verifierRole: isIndependentAssessor ? '独立核验任务' : '原任务作者自评',
          verifierProjectId: input.assessorProjectId,
          verifierTaskId: input.assessorTaskId,
          assessmentReportRef: input.assessment.report,
          selfAssessmentOnly: !isIndependentAssessor,
          ...(verifierEv ? {
            verifierActualReads: verifierEv.verifierReads,
            verifierEvidenceSummary: {
              requiredAssetsCount: verifierEv.requiredCount,
              readRequiredAssetsCount: verifierEv.readRequiredAssetsCount,
              allRequiredReadByVerifier: verifierEv.allRequiredReadByVerifier,
              hadDataOrCalcEvidence: verifierEv.hadDataOrCalcEvidence,
              ...(verifierEv.assessmentTurnIndex !== undefined ? { assessmentTurnIndex: verifierEv.assessmentTurnIndex } : {}),
              ...(verifierEv.assessmentMessageId ? { assessmentMessageId: verifierEv.assessmentMessageId } : {}),
              ...(verifierEv.carriedFromTurnIndices.length ? { carriedFromTurnIndices: verifierEv.carriedFromTurnIndices } : {}),
              targetReportChecked: verifierEv.targetReportChecked,
              authorizedInputChecked: verifierEv.authorizedInputChecked,
              assessmentReportBoundToTarget: verifierEv.assessmentReportBoundToTarget,
              ...(verifierEv.missingReason ? { missingReason: verifierEv.missingReason } : {}),
            },
          } : {}),
          independentConfirmed,
          ...(wrongVersionConfirmedByVerifier ? { wrongVersionConfirmedByVerifier: true } : {}),
          checkedRefs: input.assessment.sources,
          verdictDetail,
        });
        updated.push(verified);
      }
    }
    return updated;
  }

  interface SourceTransactionRow {
    filePath: string;
    rowNumber: number;
    itemId: string;
    originalOrderId?: string;
    refundDate?: string;
    fullRefund?: string;
    store?: string;
  }

  function parseSimpleCsvLine(line: string, delimiter: string): string[] {
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
    cells.push(cur);
    return cells;
  }

  async function inspectSourceTransactions(projectIds: readonly string[]): Promise<SourceTransactionRow[]> {
    const rows: SourceTransactionRow[] = [];
    const ITEM_KEYS = new Set(['account', 'member_id', 'member', 'user_id', 'item_id', 'customer_id', '会员账号', '账号', '会员id', '记录编号']);
    const ORDER_KEYS = new Set(['repeat_order_id', 'original_order_id', 'order_id', 'source_order_id', '原订单号', '订单号', '关联订单', '复购订单号']);
    const REFUND_DATE_KEYS = new Set(['refund_date', 'refunded_at', '退款日期', '退单日期']);
    const FULL_REFUND_KEYS = new Set(['full_refund', 'is_full_refund', 'refund_status', '是否全额退款', '全额退款', '退款状态']);
    const STORE_KEYS = new Set(['store', 'store_name', 'shop', '门店', '门店名称']);

    for (const pid of [...new Set(projectIds)]) {
      let proj: { rootPath: string };
      try { proj = await options.projects.get(pid); } catch { continue; }
      const cleanRoot = path.resolve(proj.rootPath, '020_clean');
      if (!fs.existsSync(cleanRoot)) continue;
      const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(pid);
      const subjectGrants = enterpriseId ? grants.listForSubject(enterpriseId, pid) : [];
      const scope = getProjectToolScope(pid);

      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          const st = fs.lstatSync(full);
          if (st.isSymbolicLink()) continue;
          if (st.isDirectory()) { walk(full); continue; }
          if (!st.isFile()) continue;
          const ext = path.extname(entry.name).toLowerCase();
          if (!['.csv', '.tsv', '.json'].includes(ext)) continue;
          const rel = normalizeRelativeDataPath(path.relative(proj.rootPath, full));
          let rawBytes: Buffer;
          try { rawBytes = fs.readFileSync(full); } catch { continue; }
          if (scope) {
            const view = buildAuthorizedDataView(rawBytes, rel, subjectGrants);
            if (!view.allowed) continue;
            rawBytes = view.bytes;
          }
          const txt = rawBytes.toString('utf8');
          if (ext === '.csv' || ext === '.tsv') {
            const delim = ext === '.tsv' ? '\t' : ',';
            const lines = txt.split(/\r?\n/).filter(l => l.trim().length > 0);
            if (lines.length < 2) continue;
            const headers = parseSimpleCsvLine(lines[0]!, delim).map(h => h.replace(/^\uFEFF/, '').trim().toLowerCase());
            const itemIdx = headers.findIndex(h => ITEM_KEYS.has(h));
            const orderIdx = headers.findIndex(h => ORDER_KEYS.has(h));
            const refundDateIdx = headers.findIndex(h => REFUND_DATE_KEYS.has(h));
            const fullRefundIdx = headers.findIndex(h => FULL_REFUND_KEYS.has(h));
            const storeIdx = headers.findIndex(h => STORE_KEYS.has(h));
            if (itemIdx === -1 && orderIdx === -1) continue;
            for (let i = 1; i < lines.length; i++) {
              const cells = parseSimpleCsvLine(lines[i]!, delim);
              const itemVal = itemIdx >= 0 ? (cells[itemIdx] ?? '').trim() : '';
              const orderVal = orderIdx >= 0 ? (cells[orderIdx] ?? '').trim() : '';
              if (!itemVal && !orderVal) continue;
              rows.push({
                filePath: rel,
                rowNumber: i + 1,
                itemId: itemVal || orderVal,
                ...(orderVal ? { originalOrderId: orderVal } : {}),
                ...(refundDateIdx >= 0 && (cells[refundDateIdx] ?? '').trim() ? { refundDate: (cells[refundDateIdx] ?? '').trim() } : {}),
                ...(fullRefundIdx >= 0 && (cells[fullRefundIdx] ?? '').trim() ? { fullRefund: (cells[fullRefundIdx] ?? '').trim() } : {}),
                ...(storeIdx >= 0 && (cells[storeIdx] ?? '').trim() ? { store: (cells[storeIdx] ?? '').trim() } : {}),
              });
            }
          } else if (ext === '.json') {
            try {
              const parsed = JSON.parse(txt);
              if (!Array.isArray(parsed)) continue;
              parsed.forEach((rec, idx) => {
                if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return;
                const obj = rec as Record<string, unknown>;
                const findVal = (keys: Set<string>) => {
                  const k = Object.keys(obj).find(name => keys.has(name.trim().toLowerCase()));
                  return k && obj[k] !== null && obj[k] !== undefined ? String(obj[k]).trim() : '';
                };
                const itemVal = findVal(ITEM_KEYS);
                const orderVal = findVal(ORDER_KEYS);
                if (!itemVal && !orderVal) return;
                const refundDateVal = findVal(REFUND_DATE_KEYS);
                const fullRefundVal = findVal(FULL_REFUND_KEYS);
                const storeVal = findVal(STORE_KEYS);
                rows.push({
                  filePath: rel,
                  rowNumber: idx + 1,
                  itemId: itemVal || orderVal,
                  ...(orderVal ? { originalOrderId: orderVal } : {}),
                  ...(refundDateVal ? { refundDate: refundDateVal } : {}),
                  ...(fullRefundVal ? { fullRefund: fullRefundVal } : {}),
                  ...(storeVal ? { store: storeVal } : {}),
                });
              });
            } catch { /* ignore malformed JSON */ }
          }
        }
      };
      walk(cleanRoot);
    }
    return rows;
  }

  function textWindowCoOccurs(diskTexts: readonly string[], anchor: string, relatedTokens: readonly string[]): boolean {
    const aLow = anchor.trim().toLowerCase();
    if (!aLow) return false;
    const reqTokens = relatedTokens.map(t => t.trim().toLowerCase()).filter(Boolean);
    for (const raw of diskTexts) {
      const lines = raw.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]!.toLowerCase().includes(aLow)) continue;
        // Check a tight local context window (same JSON object/table row or +/- 4 lines)
        const slice = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 5)).join('\n').toLowerCase();
        if (reqTokens.every(tok => slice.includes(tok))) return true;
      }
      // Also support compact single-line JSON arrays/objects within +/- 280 chars around anchor
      const lowerRaw = raw.toLowerCase();
      let pos = lowerRaw.indexOf(aLow);
      while (pos !== -1) {
        const win = lowerRaw.slice(Math.max(0, pos - 240), Math.min(lowerRaw.length, pos + aLow.length + 280));
        if (reqTokens.every(tok => win.includes(tok))) return true;
        pos = lowerRaw.indexOf(aLow, pos + aLow.length);
      }
    }
    return false;
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
      if (projectId) {
        const projectEnterprise = options.enterpriseScopes.enterpriseIdForProject(uuid(projectId));
        if (enterpriseId && projectEnterprise !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
      }
      const list = enterpriseId && subjectId ? grants.listForSubject(enterpriseId, subjectId) : grants.list(enterpriseId);
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
      if (boundOperator && boundOperator !== binding.operator.operatorId) {
        throw new StudioError('resource_operator_not_authorized', 403);
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
        // Immediately synchronize active task sandboxes AND re-gear open sessions for this subject project!
        if (record.subjectType === 'project') {
          syncActiveWorkspacesForProject(record.subjectId);
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
        // Immediately purge revoked files from active sandboxes AND re-gear open sessions for this subject project!
        if (record.subjectType === 'project') {
          syncActiveWorkspacesForProject(record.subjectId);
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
      const enterprisePacks = enterpriseId ? packs.list(enterpriseId) : [];
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
      const enterpriseId = url.searchParams.get('enterpriseId') || undefined;
      const projectId = url.searchParams.get('projectId') || undefined;
      let scopedEnterpriseId = enterpriseId;
      if (projectId) {
        const pid = uuid(projectId);
        await options.projects.get(pid);
        const ownerEnterprise = options.enterpriseScopes.enterpriseIdForProject(pid);
        if (enterpriseId && ownerEnterprise !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
        scopedEnterpriseId = ownerEnterprise;
      }
      const domain = url.searchParams.get('domain') || undefined;
      const rawList = packs.list(scopedEnterpriseId).filter(p => !domain || p.domain === domain);
      const list = rawList.map(p => (projectId ? redactPackForConsumer(p, projectId) : p));
      const operator = resolveRequestOperator(request);
      // ONLY mint grantAuthority when an explicit projectId is passed AND current verified Host operator owns it!
      const grantAuthority = projectId && scopedEnterpriseId
        ? await resolveGrantAuthorityForProject(scopedEnterpriseId, projectId, rawList[0], operator)
        : undefined;
      json(response, 200, {
        packs: list,
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
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const enterpriseId = uuid(input.enterpriseId);
        options.enterpriseScopes.get(enterpriseId);
        const systemId = uuid(input.systemId);
        const system = options.studio.get(systemId);
        if (system.enterpriseId !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
        // Always enforce non-archived active project check (explicit projectId or system execution owner project)
        const targetProjectId = input.projectId !== undefined ? String(input.projectId) : studioExecutionOwner(system).projectId;
        await assertWritableProject(targetProjectId, enterpriseId);
        if (operator.verified && operator.operatorId.trim()) {
          bindSystemOperator(systemId, operator.operatorId);
        }
        const pack = packs.ensurePack({
          enterpriseId,
          systemId,
          domain: typeof input.domain === 'string' ? input.domain : 'member-operations',
          name: text(input.name ?? `${system.name} · 会员运营资产包`, 200, false),
          ...(typeof input.packCode === 'string' ? { packCode: input.packCode } : {}),
        });
        return { statusCode: 200, result: { pack } as unknown as Record<string, unknown>, systemId };
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }

    const packGetMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)$/.exec(url.pathname);
    if (packGetMatch && request.method === 'GET') {
      const pack = packs.get(packGetMatch[1]!);
      const enterpriseId = url.searchParams.get('enterpriseId');
      if (enterpriseId && uuid(enterpriseId) !== pack.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
      const projectId = url.searchParams.get('projectId');
      if (projectId) {
        const pid = uuid(projectId);
        await options.projects.get(pid);
        const ownerEnterprise = options.enterpriseScopes.enterpriseIdForProject(pid);
        if (ownerEnterprise !== pack.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
      }
      const operator = resolveRequestOperator(request);
      const grantAuthority = projectId
        ? await resolveGrantAuthorityForProject(pack.enterpriseId, projectId, pack, operator)
        : undefined;
      json(response, 200, {
        pack: projectId ? redactPackForConsumer(pack, projectId) : pack,
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
      if (!locator.startsWith('060_reports/')) throw new StudioError('invalid_report_locator', 400);
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
      if (expectedSha256 && actualSha !== expectedSha256) throw new StudioError('studio_use_report_hash_mismatch', 409);
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
      const input = await options.readBody(request, 4 * 1024 * 1024);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const currentPack = packs.get(packId);
        // Unconditionally enforce active non-archived project for all pack-mutating construction actions!
        let activeProject: { id: string } | undefined;
        if (['panorama', 'panorama-select', 'entries', 'purposes', 'previews', 'confirm', 'reconcile', 'upgrade-impact'].includes(action)) {
          activeProject = await assertWritablePackProject(currentPack, input.projectId);
          // Bind continuation owner when the previous owner project has been archived and an active same-enterprise project takes over construction!
          const origSystem = options.studio.get(currentPack.systemId);
          const currentOwnerPid = currentPack.activeOwnerProjectId ?? studioExecutionOwner(origSystem).projectId;
          if (activeProject.id !== currentOwnerPid) {
            const currentOwnerProj = await options.projects.get(currentOwnerPid).catch(() => null);
            if (!currentOwnerProj || currentOwnerProj.archivedAt !== null) {
              packs.bindContinuationOwner(
                packId,
                activeProject.id,
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
          const pid = uuid(input.projectId), tid = uuid(input.taskId);
          if (options.enterpriseScopes.enterpriseIdForProject(pid) !== currentPack.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
          const pin = packs.pinTaskVersion(packId, input as unknown as Parameters<EnterprisePackStore['pinTaskVersion']>[1]);
          return { result: { pin, pack: packs.get(packId) } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
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
                digest(u.report) === digest(verifiedReportRef)
                || (verifiedReportRef.locator && u.report.locator === verifiedReportRef.locator && (!u.report.sha256 || u.report.sha256 === verifiedReportRef.sha256))
                || (rawReportRef.locator && u.report.locator === rawReportRef.locator && (!u.report.sha256 || u.report.sha256 === verifiedReportRef.sha256))
              ),
            );
            const declaredInThisTurn = !options.taskSnapshot
              ? Boolean(studioUse)
              : Boolean(studioUse && nativeEv.turnDeclaredStudioUseIds.includes(studioUse.id));
            if (studioUse && declaredInThisTurn && studioUse.sources.length > 0) {
              resolvedDeclaration = {
                declaredPurposeId: pm.purposeId,
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
            accessLevel: (input.accessLevel as 'definition' | 'summary' | 'recalculate') ?? 'recalculate',
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
          let reportPayload = input.report as Record<string, unknown> | undefined;
          let resolvedPackVersion: string | undefined;
          let resolvedTargetRef: StudioSourceRef | undefined;
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
            // Match a recorded use bound to THIS EXACT turn (messageId OR same-turn saved report / declared studio use)
            const studioSys = options.studio.get(currentPack.systemId);
            const turnDeclaredReportRefs = studioSys.uses
              .filter(u => u.projectId === pid && u.taskId === tid && nativeEv.turnDeclaredStudioUseIds.includes(u.id))
              .map(u => u.report);
            const sameTurnReportCandidates = [...nativeEv.turnWrittenReports, ...turnDeclaredReportRefs];
            const matchingTurnUse = [...currentPack.useRecords].reverse().find(u =>
              u.projectId === pid
              && u.taskId === tid
              && (
                (u.sessionId === selection.sessionId && u.messageId === selection.messageId)
                || sameTurnReportCandidates.some(ref =>
                  digest(ref) === digest(u.reportRef)
                  || (ref.locator && u.reportRef.locator === ref.locator && (!ref.sha256 || !u.reportRef.sha256 || ref.sha256 === u.reportRef.sha256)),
                )
              )
              && u.actualReads.some(r => r.complete && packDepRefs.some(dep => sameExactSourceRef(r.ref, dep))),
            );
            const hasActualUse = Boolean(matchingTurnUse || packMatchedReads.length > 0);
            const matchedRefs = packMatchedReads.length > 0
              ? packMatchedReads.map(r => r.ref)
              : matchingTurnUse
                ? matchingTurnUse.actualReads.filter(r => r.complete && packDepRefs.some(dep => sameExactSourceRef(r.ref, dep))).map(r => r.ref)
                : [];

            // R4: Link feedback to the actual saved 060_reports/ file from THIS turn while preserving replyRef!
            let linkedSavedReportRef: StudioSourceRef | undefined;
            if (matchingTurnUse?.reportRef.locator?.startsWith('060_reports/')) {
              linkedSavedReportRef = matchingTurnUse.reportRef;
            } else if (nativeEv.turnWrittenReports.length > 0) {
              linkedSavedReportRef = nativeEv.turnWrittenReports.at(-1);
            } else if (turnDeclaredReportRefs.some(r => r.locator?.startsWith('060_reports/'))) {
              linkedSavedReportRef = turnDeclaredReportRefs.filter(r => r.locator?.startsWith('060_reports/')).at(-1);
            } else if (object(input.reportRef)) {
              const explicitRep = sourceRef(input.reportRef);
              if (explicitRep.projectId === pid && explicitRep.locator?.startsWith('060_reports/')) {
                linkedSavedReportRef = explicitRep;
              }
            }
            if (linkedSavedReportRef?.locator?.startsWith('060_reports/')) {
              try {
                const effLoc = resolveTaskReportLocator(pid, tid, linkedSavedReportRef.locator, linkedSavedReportRef.sha256);
                const f = await options.projects.readFile(pid, effLoc);
                const fSha = createHash('sha256').update(f.bytes).digest('hex');
                preserveImmutableReportSnapshot(pid, effLoc, f.bytes, fSha);
                linkedSavedReportRef = sourceRef({ ...linkedSavedReportRef, locator: effLoc, version: fSha, sha256: fSha });
              } catch { /* fallback to existing ref */ }
            }

            const extractDecisionTitle = (dec: { payload?: unknown; recordId: string }): string | undefined => {
              if (!dec.payload || typeof dec.payload !== 'object') return undefined;
              const p = dec.payload as Record<string, unknown>;
              for (const k of ['title', 'statement', 'name', 'summary', 'goal', 'question']) {
                if (typeof p[k] === 'string' && p[k].trim()) return p[k].trim().slice(0, 280);
              }
              return undefined;
            };
            // R5: Verify or auto-link original Case & exact decision revision from CaseStore!
            let resolvedOriginalCaseRef: EnterprisePackOriginalCaseRef | undefined;
            const rawCaseInput = object(input.originalCaseRef)
              ? input.originalCaseRef
              : typeof input.originalCaseId === 'string' && input.originalCaseId.trim()
                ? { caseId: input.originalCaseId.trim(), ...(typeof input.originalDecisionId === 'string' ? { decisionId: input.originalDecisionId.trim() } : {}) }
                : undefined;
            if (rawCaseInput) {
              const cid = uuid(rawCaseInput.caseId);
              let did = typeof rawCaseInput.decisionId === 'string' && rawCaseInput.decisionId.trim() ? uuid(rawCaseInput.decisionId.trim()) : undefined;
              let drev = typeof rawCaseInput.decisionRevision === 'number' ? rawCaseInput.decisionRevision : undefined;
              let caseSummary = typeof rawCaseInput.summary === 'string' && rawCaseInput.summary.trim() ? rawCaseInput.summary.trim() : undefined;
              let caseTitle: string | undefined;
              let caseRevision: number | undefined;
              let decisionKind: string | undefined;
              let decisionTitle: string | undefined;
              let choiceId: string | undefined;
              if (options.cases) {
                let caseRec: ReturnType<CaseStore['getCase']>;
                try { caseRec = options.cases.getCase(cid); } catch { throw new StudioError('feedback_verification_case_not_found', 409); }
                caseTitle = caseRec.title;
                caseRevision = caseRec.revision;
                caseSummary ??= caseRec.title;
                if (did) {
                  try {
                    const dec = options.cases.getDecision(cid, did, drev);
                    drev = dec.revision;
                    decisionKind = dec.kind;
                    decisionTitle = extractDecisionTitle(dec);
                  } catch {
                    throw new StudioError('feedback_verification_case_not_found', 409);
                  }
                } else {
                  const latestDec = options.cases.listDecisions(cid).items.at(-1);
                  if (latestDec) {
                    did = latestDec.recordId;
                    drev = latestDec.revision;
                    decisionKind = latestDec.kind;
                    decisionTitle = extractDecisionTitle(latestDec);
                  }
                }
                if (did) {
                  const latestChoice = options.cases.getStrategyChoices(cid).filter(c => c.strategyRef.recordId === did).at(-1);
                  if (latestChoice) choiceId = latestChoice.choiceId;
                }
              }
              resolvedOriginalCaseRef = {
                caseId: cid,
                ...(caseTitle ? { caseTitle } : {}),
                ...(caseRevision !== undefined ? { caseRevision } : {}),
                ...(did ? { decisionId: did } : {}),
                ...(drev !== undefined ? { decisionRevision: drev } : {}),
                ...(decisionKind ? { decisionKind } : {}),
                ...(decisionTitle ? { decisionTitle } : {}),
                ...(choiceId ? { choiceId } : {}),
                ...(caseSummary ? { summary: caseSummary } : {}),
              };
            } else if (options.cases) {
              try {
                const projLink = options.cases.listProjectLinks().find(l => l.projectId === pid);
                if (projLink) {
                  const caseRec = options.cases.getCase(projLink.caseId);
                  const latestDecision = options.cases.listDecisions(projLink.caseId).items.at(-1);
                  const latestChoice = latestDecision
                    ? options.cases.getStrategyChoices(projLink.caseId).filter(c => c.strategyRef.recordId === latestDecision.recordId).at(-1)
                    : undefined;
                  const decTitle = latestDecision ? extractDecisionTitle(latestDecision) : undefined;
                  resolvedOriginalCaseRef = {
                    caseId: caseRec.id,
                    caseTitle: caseRec.title,
                    caseRevision: caseRec.revision,
                    ...(latestDecision ? {
                      decisionId: latestDecision.recordId,
                      decisionRevision: latestDecision.revision,
                      decisionKind: latestDecision.kind,
                      ...(decTitle ? { decisionTitle: decTitle } : {}),
                    } : {}),
                    ...(latestChoice ? { choiceId: latestChoice.choiceId } : {}),
                    summary: caseRec.title,
                  };
                }
              } catch { /* no linked case */ }
            }

            let adoptionBasis: FeedbackAdoptionBasis;
            if (hasActualUse) {
              adoptionBasis = 'verified_actual_read';
            } else if (observedDirVer) {
              adoptionBasis = 'directory_only_unverified';
            } else {
              adoptionBasis = 'clue_only_no_pack_read';
            }

            // NEVER overwrite the task/question cutoff date with the pack's dataCutoffAt!
            const explicitTaskCutoff = typeof input.taskCutoffAt === 'string' && input.taskCutoffAt.trim()
              ? input.taskCutoffAt.trim()
              : nativeEv.taskCutoffAt;
            const packCutoff = pin?.dataCutoffAt ?? rev?.dataCutoffAt;

            // Resolve matching target authority asset ref from pinned revision when available
            if (rev) {
              const wantedRole = category === 'shared_refund_mapping' ? 'shared-asset' : category === 'sap_formula' ? 'sap-metric' : category === 'member_policy' ? 'member-rule' : undefined;
              if (wantedRole) {
                resolvedTargetRef = rev.purposeManifests.flatMap(pm => pm.dependencies).find(d => d.role === wantedRole)?.ref;
              }
            }

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
              ...(explicitTaskCutoff ? { taskCutoffAt: explicitTaskCutoff } : {}),
              ...(packCutoff ? { packDataCutoffAt: packCutoff } : {}),
              evidenceNote: text(input.evidenceNote ?? input.problem ?? '', 5000, false),
            };
          }
          if (!reportPayload) throw new StudioError('invalid_pack_feedback_report');
          const result = packs.submitFeedback(packId, {
            problemKey: text(input.problemKey ?? input.title, 200, false),
            packVersion: text(resolvedPackVersion ?? (typeof input.packVersion === 'string' ? input.packVersion : 'unconfirmed'), 50, false),
            purposeIds: Array.isArray(input.purposeIds) ? input.purposeIds.map(String) : [],
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
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }

    const feedbackCaseHistoryMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/feedback\/([a-f0-9-]+)\/case-history$/.exec(url.pathname);
    if (feedbackCaseHistoryMatch && request.method === 'GET') {
      const currentPack = packs.get(feedbackCaseHistoryMatch[1]!);
      const fb = currentPack.feedbackItems.find(f => f.id === uuid(feedbackCaseHistoryMatch[2]!));
      if (!fb) throw new StudioError('enterprise_pack_feedback_not_found', 404);
      const pinnedRef = fb.revisionLink?.itemVerification?.originalCaseRef ?? fb.reports.map(r => r.originalCaseRef).find(Boolean);
      if (!pinnedRef) {
        json(response, 200, { feedbackId: fb.id, originalCaseRef: null, caseRecord: null, historicalDecision: null });
        return true;
      }
      let caseRecord: ReturnType<CaseStore['getCase']> | null = null;
      let historicalDecision: ReturnType<CaseStore['getDecision']> | null = null;
      let latestDecision: ReturnType<CaseStore['getDecision']> | null = null;
      if (options.cases) {
        try { caseRecord = options.cases.getCase(pinnedRef.caseId); } catch { caseRecord = null; }
        if (caseRecord && pinnedRef.decisionId) {
          try {
            historicalDecision = options.cases.getDecision(pinnedRef.caseId, pinnedRef.decisionId, pinnedRef.decisionRevision);
          } catch { historicalDecision = null; }
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
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const currentPack = packs.get(feedbackHandleMatch[1]!);
        await assertWritablePackProject(currentPack, input.projectId);
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

        // R5: When closing feedback as 'verified', verify real Studio declare-use + INDEPENDENT assess-use +
        //     structured co-occurring disk evidence + REAL 020_clean source transaction cross-check +
        //     original & new cutoff boundaries + exact pinned Case decision revision!
        let verifiedItemEvidence: EnterprisePackFeedbackItemVerification | undefined;
        if (targetStatus === 'verified' && typeof input.verifiedByUseId === 'string') {
          const verifyingUse = currentPack.useRecords.find(u => u.id === uuid(input.verifiedByUseId));
          if (verifyingUse && (verifyingUse.tier === 'formal-calculation' || verifyingUse.tier === 'limited-calculation')) {
            const studioSys = options.studio.get(currentPack.systemId);
            const matchedStudioUse = [...studioSys.uses].reverse().find(u =>
              u.projectId === verifyingUse.projectId
              && u.taskId === verifyingUse.taskId
              && (
                digest(u.report) === digest(verifyingUse.reportRef)
                || (verifyingUse.reportRef.locator && u.report.locator === verifyingUse.reportRef.locator)
                || (u.report.sha256 && u.report.sha256 === verifyingUse.reportRef.sha256)
              ),
            );
            const latestAssess = matchedStudioUse?.assessments?.at(-1);
            const assessTaskId = latestAssess?.assessorTaskId ?? latestAssess?.report.taskId;
            const isIndependentAssess = Boolean(assessTaskId && assessTaskId !== verifyingUse.taskId);
            if (!matchedStudioUse || !latestAssess || latestAssess.status !== 'pass' || !isIndependentAssess) {
              throw new StudioError('feedback_verification_requires_independent_use_assessment', 409);
            }
            if (!object(input.itemVerification)) {
              throw new StudioError('feedback_verification_missing_item_evidence', 409);
            }
            const rawIv = input.itemVerification as unknown as EnterprisePackFeedbackItemVerification;
            const rawShouldChange = Array.isArray(rawIv.shouldChange) ? rawIv.shouldChange : [];
            const rawPostCutoff = Array.isArray(rawIv.postCutoffNewEvents) ? rawIv.postCutoffNewEvents : [];
            const rawShouldRetain = Array.isArray(rawIv.shouldRetain) ? rawIv.shouldRetain : [];
            if (!rawShouldRetain.length || (!rawShouldChange.length && !rawPostCutoff.length)) {
              throw new StudioError('feedback_verification_missing_item_evidence', 409);
            }
            // Read actual report & independent assessment bytes from disk (or immutable preserved snapshot)
            const diskTexts: string[] = [];
            if (verifyingUse.reportRef.projectId && verifyingUse.reportRef.locator?.startsWith('060_reports/')) {
              const effLoc = resolveTaskReportLocator(verifyingUse.reportRef.projectId, verifyingUse.taskId, verifyingUse.reportRef.locator, verifyingUse.reportRef.sha256);
              const preserved = readPreservedReportBytes(verifyingUse.reportRef.projectId, verifyingUse.taskId, effLoc, verifyingUse.reportRef.sha256);
              if (preserved) {
                diskTexts.push(preserved.toString('utf8'));
              } else {
                const repFile = await options.projects.readFile(verifyingUse.reportRef.projectId, effLoc);
                diskTexts.push(repFile.bytes.toString('utf8'));
              }
            }
            if (latestAssess.report.projectId && latestAssess.report.locator?.startsWith('060_reports/')) {
              const effAssessLoc = resolveTaskReportLocator(latestAssess.report.projectId, assessTaskId!, latestAssess.report.locator, latestAssess.report.sha256);
              const preservedAssess = readPreservedReportBytes(latestAssess.report.projectId, assessTaskId!, effAssessLoc, latestAssess.report.sha256);
              if (preservedAssess) {
                diskTexts.push(preservedAssess.toString('utf8'));
              } else {
                const assessFile = await options.projects.readFile(latestAssess.report.projectId, effAssessLoc);
                diskTexts.push(assessFile.bytes.toString('utf8'));
              }
            }
            const combinedEvidence = diskTexts.join('\n').toLowerCase();
            if (!combinedEvidence) {
              throw new StudioError('feedback_verification_item_evidence_uncorroborated', 409);
            }

            // 1. Cutoff corroboration: originalCutoffChecked MUST match the feedback's recorded original cutoff (if any) AND appear in disk bytes!
            const checkedCutoff = String(rawIv.originalCutoffChecked ?? '').trim();
            const checkedNewCutoff = String(rawIv.newCutoffChecked ?? '').trim();
            const recordedOriginalCutoff = existingFb.reports.map(r => r.taskCutoffAt || r.packDataCutoffAt).find(Boolean)?.trim();
            if (!checkedCutoff) {
              throw new StudioError('feedback_verification_cutoff_uncorroborated', 409);
            }
            if (recordedOriginalCutoff && checkedCutoff !== recordedOriginalCutoff) {
              throw new StudioError('feedback_verification_cutoff_mismatch', 409);
            }
            if (!combinedEvidence.includes(checkedCutoff.toLowerCase())) {
              throw new StudioError('feedback_verification_cutoff_uncorroborated', 409);
            }
            if (rawPostCutoff.length > 0) {
              if (!checkedNewCutoff) {
                throw new StudioError('feedback_verification_missing_new_cutoff', 409);
              }
              if (checkedNewCutoff <= checkedCutoff) {
                throw new StudioError('feedback_verification_invalid_new_cutoff', 409);
              }
              if (!combinedEvidence.includes(checkedNewCutoff.toLowerCase())) {
                throw new StudioError('feedback_verification_cutoff_uncorroborated', 409);
              }
            }

            // 2. Load REAL authorized source transactions from 020_clean/ to cross-check original order & refund dates!
            const sourceProjectIds = [
              verifyingUse.projectId,
              ...existingFb.reports.map(r => r.projectId),
            ];
            const sourceRows = await inspectSourceTransactions(sourceProjectIds);
            const findSourceRows = (id: string, orderId?: string) => {
              const idLow = id.toLowerCase();
              const orderLow = orderId?.toLowerCase();
              const matches = sourceRows.filter(row =>
                row.itemId.toLowerCase() === idLow
                || (row.originalOrderId && row.originalOrderId.toLowerCase() === idLow)
                || (orderLow && row.originalOrderId && row.originalOrderId.toLowerCase() === orderLow),
              );
              return matches;
            };

            // 2A. Deep per-item corroboration for shouldChange (pre-cutoff mapping corrections)
            for (const item of rawShouldChange) {
              const id = String(item?.itemId ?? '').trim();
              const orderId = String(item?.originalOrderId ?? '').trim();
              const refundDate = String(item?.refundDate ?? '').trim();
              const reason = String(item?.reason ?? '').trim();
              if (!id || (!orderId && !refundDate)) {
                throw new StudioError('feedback_verification_item_evidence_uncorroborated', 409);
              }
              // Require co-occurrence of itemId with its originalOrderId & refundDate in the SAME local report/assessment block!
              const coTokens = [orderId, refundDate].filter(Boolean);
              if (!textWindowCoOccurs(diskTexts, id, coTokens)) {
                throw new StudioError('feedback_verification_item_evidence_uncorroborated', 409);
              }
              if (refundDate && checkedCutoff && refundDate > checkedCutoff) {
                throw new StudioError('feedback_verification_post_cutoff_misclassified', 409);
              }
              if (item?.classification === 'post_cutoff_new_event') {
                throw new StudioError('feedback_verification_post_cutoff_misclassified', 409);
              }
              if (reason && reason.length >= 2 && !combinedEvidence.includes(reason.toLowerCase()) && !orderId) {
                throw new StudioError('feedback_verification_item_evidence_uncorroborated', 409);
              }
              // Real source transaction cross-check!
              if (sourceRows.length > 0) {
                const matched = findSourceRows(id, orderId);
                if (!matched.length) {
                  throw new StudioError('feedback_verification_source_transaction_mismatch', 409);
                }
                if (orderId && !matched.some(r => r.originalOrderId?.toLowerCase() === orderId.toLowerCase())) {
                  throw new StudioError('feedback_verification_source_transaction_mismatch', 409);
                }
                if (refundDate && !matched.some(r => r.refundDate === refundDate)) {
                  throw new StudioError('feedback_verification_source_transaction_mismatch', 409);
                }
                const matchingRow = matched.find(r => (!orderId || r.originalOrderId?.toLowerCase() === orderId.toLowerCase()) && (!refundDate || r.refundDate === refundDate)) ?? matched[0]!;
                if (matchingRow.refundDate && checkedCutoff && matchingRow.refundDate > checkedCutoff) {
                  throw new StudioError('feedback_verification_post_cutoff_misclassified', 409);
                }
              }
            }

            // 2B. Deep per-item corroboration for postCutoffNewEvents (legitimate post-cutoff refunds under newCutoffChecked)
            for (const item of rawPostCutoff) {
              const id = String(item?.itemId ?? '').trim();
              const orderId = String(item?.originalOrderId ?? '').trim();
              const refundDate = String(item?.refundDate ?? '').trim();
              if (!id || !orderId || !refundDate) {
                throw new StudioError('feedback_verification_item_evidence_uncorroborated', 409);
              }
              if (item.classification !== 'post_cutoff_new_event' && item.classification !== 'post_cutoff_update') {
                throw new StudioError('feedback_verification_invalid_post_cutoff_classification', 409);
              }
              if (refundDate <= checkedCutoff) {
                throw new StudioError('feedback_verification_pre_cutoff_misclassified', 409);
              }
              if (checkedNewCutoff && refundDate > checkedNewCutoff) {
                throw new StudioError('feedback_verification_post_cutoff_out_of_range', 409);
              }
              if (!textWindowCoOccurs(diskTexts, id, [orderId, refundDate])) {
                throw new StudioError('feedback_verification_item_evidence_uncorroborated', 409);
              }
              if (sourceRows.length > 0) {
                const matched = findSourceRows(id, orderId);
                if (!matched.length) {
                  throw new StudioError('feedback_verification_source_transaction_mismatch', 409);
                }
                if (!matched.some(r => r.originalOrderId?.toLowerCase() === orderId.toLowerCase())) {
                  throw new StudioError('feedback_verification_source_transaction_mismatch', 409);
                }
                if (!matched.some(r => r.refundDate === refundDate)) {
                  throw new StudioError('feedback_verification_source_transaction_mismatch', 409);
                }
                const matchingRow = matched.find(r => r.originalOrderId?.toLowerCase() === orderId.toLowerCase() && r.refundDate === refundDate);
                if (!matchingRow?.refundDate || matchingRow.refundDate <= checkedCutoff) {
                  throw new StudioError('feedback_verification_pre_cutoff_misclassified', 409);
                }
              }
            }

            // 2C. Deep per-item corroboration for shouldRetain (unchanged valid rows)
            for (const item of rawShouldRetain) {
              const id = String(item?.itemId ?? '').trim();
              const orderId = String(item?.originalOrderId ?? '').trim();
              const refundDate = String(item?.refundDate ?? '').trim();
              if (!id) {
                throw new StudioError('feedback_verification_item_evidence_uncorroborated', 409);
              }
              if (!orderId && !refundDate && !String(item?.reason ?? '').trim()) {
                throw new StudioError('feedback_verification_item_evidence_uncorroborated', 409);
              }
              const coTokens = [orderId, refundDate].filter(Boolean);
              if (coTokens.length > 0) {
                if (!textWindowCoOccurs(diskTexts, id, coTokens)) {
                  throw new StudioError('feedback_verification_item_evidence_uncorroborated', 409);
                }
              } else if (!combinedEvidence.includes(id.toLowerCase())) {
                throw new StudioError('feedback_verification_item_evidence_uncorroborated', 409);
              }
              if (sourceRows.length > 0) {
                const matched = findSourceRows(id, orderId);
                if (!matched.length) {
                  throw new StudioError('feedback_verification_source_transaction_mismatch', 409);
                }
                if (orderId && !matched.some(r => r.originalOrderId?.toLowerCase() === orderId.toLowerCase())) {
                  throw new StudioError('feedback_verification_source_transaction_mismatch', 409);
                }
                if (refundDate && !matched.some(r => r.refundDate === refundDate)) {
                  throw new StudioError('feedback_verification_source_transaction_mismatch', 409);
                }
              }
            }

            // 3. Original Case decision verification against real CaseStore (pin & verify exact decisionId + decisionRevision)!
            const fbCaseRef = existingFb.reports.map(r => r.originalCaseRef).find(Boolean);
            const ivCaseRef = rawIv.originalCaseRef;
            if (fbCaseRef && !ivCaseRef) {
              throw new StudioError('feedback_verification_missing_case_ref', 409);
            }
            let enrichedCaseRef: EnterprisePackOriginalCaseRef | undefined = ivCaseRef ? { ...ivCaseRef } : undefined;
            if (ivCaseRef) {
              if (!ivCaseRef.caseId) throw new StudioError('feedback_verification_case_not_found', 409);
              if (fbCaseRef && ivCaseRef.caseId !== fbCaseRef.caseId) {
                throw new StudioError('feedback_verification_case_mismatch', 409);
              }
              if (fbCaseRef?.decisionId && ivCaseRef.decisionId && ivCaseRef.decisionId !== fbCaseRef.decisionId) {
                throw new StudioError('feedback_verification_case_decision_mismatch', 409);
              }
              if (fbCaseRef?.decisionRevision !== undefined && ivCaseRef.decisionRevision !== undefined && ivCaseRef.decisionRevision !== fbCaseRef.decisionRevision) {
                throw new StudioError('feedback_verification_case_decision_mismatch', 409);
              }
              if (rawIv.caseDecisionsPreserved !== true) {
                throw new StudioError('feedback_verification_case_not_preserved', 409);
              }
              let caseTitle: string | undefined;
              let pinnedDecisionId = ivCaseRef.decisionId ?? fbCaseRef?.decisionId;
              let pinnedDecisionRev = ivCaseRef.decisionRevision ?? fbCaseRef?.decisionRevision;
              let decisionTitle: string | undefined = ivCaseRef.decisionTitle ?? fbCaseRef?.decisionTitle;
              if (options.cases) {
                let origCase: ReturnType<CaseStore['getCase']>;
                try { origCase = options.cases.getCase(ivCaseRef.caseId); } catch { throw new StudioError('feedback_verification_case_not_found', 409); }
                caseTitle = origCase.title;
                if (!pinnedDecisionId) {
                  const decs = options.cases.listDecisions(ivCaseRef.caseId).items;
                  if (decs.length > 0) {
                    pinnedDecisionId = decs.at(-1)!.recordId;
                    pinnedDecisionRev ??= decs.at(-1)!.revision;
                  }
                }
                if (pinnedDecisionId) {
                  let decRec: ReturnType<CaseStore['getDecision']>;
                  try {
                    decRec = options.cases.getDecision(ivCaseRef.caseId, pinnedDecisionId, pinnedDecisionRev);
                  } catch {
                    throw new StudioError('feedback_verification_case_decision_mismatch', 409);
                  }
                  const pObj = decRec.payload && typeof decRec.payload === 'object' ? (decRec.payload as Record<string, unknown>) : undefined;
                  const payloadTitle = pObj
                    ? (['title', 'statement', 'name', 'summary', 'goal', 'question'].map(k => (typeof pObj[k] === 'string' && pObj[k].trim() ? pObj[k].trim().slice(0, 280) : undefined)).find(Boolean))
                    : undefined;
                  decisionTitle = payloadTitle ?? decisionTitle;
                  enrichedCaseRef = {
                    ...ivCaseRef,
                    caseTitle: origCase.title,
                    caseRevision: fbCaseRef?.caseRevision ?? origCase.revision,
                    decisionId: decRec.recordId,
                    decisionRevision: decRec.revision,
                    decisionKind: decRec.kind,
                    ...(decisionTitle ? { decisionTitle } : {}),
                    ...(fbCaseRef?.choiceId ? { choiceId: fbCaseRef.choiceId } : {}),
                  };
                } else {
                  enrichedCaseRef = {
                    ...ivCaseRef,
                    caseTitle: origCase.title,
                    caseRevision: fbCaseRef?.caseRevision ?? origCase.revision,
                  };
                }
              }
              const caseMentioned = combinedEvidence.includes(ivCaseRef.caseId.toLowerCase())
                || (pinnedDecisionId ? combinedEvidence.includes(pinnedDecisionId.toLowerCase()) : false)
                || (decisionTitle ? combinedEvidence.includes(decisionTitle.toLowerCase()) : false)
                || (caseTitle ? combinedEvidence.includes(caseTitle.toLowerCase()) : false);
              if (!caseMentioned) {
                throw new StudioError('feedback_verification_case_uncorroborated', 409);
              }
            }

            verifiedItemEvidence = {
              ...rawIv,
              ...(enrichedCaseRef ? { originalCaseRef: enrichedCaseRef } : {}),
              assessmentReportRef: rawIv.assessmentReportRef ? sourceRef(rawIv.assessmentReportRef) : latestAssess.report,
            };
          } else if (object(input.itemVerification)) {
            verifiedItemEvidence = input.itemVerification as unknown as EnterprisePackFeedbackItemVerification;
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
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }

    const useVerifyMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/uses\/([a-f0-9-]+)\/verify$/.exec(url.pathname);
    if (useVerifyMatch && request.method === 'POST') {
      assertEnabledWritable();
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const currentPack = packs.get(useVerifyMatch[1]!);
        const useRecord = currentPack.useRecords.find(u => u.id === uuid(useVerifyMatch[2]!));
        if (!useRecord) throw new StudioError('enterprise_pack_use_not_found', 404);

        const studioSys = options.studio.get(currentPack.systemId);
        const studioUse = [...studioSys.uses].reverse().find(u =>
          u.projectId === useRecord.projectId
          && u.taskId === useRecord.taskId
          && (
            digest(u.report) === digest(useRecord.reportRef)
            || (useRecord.reportRef.locator && u.report.locator === useRecord.reportRef.locator)
            || (u.report.sha256 && u.report.sha256 === useRecord.reportRef.sha256)
          ),
        );

        // Allow recording a disk-verified independent assessment report into studio.uses when provided
        const rawAssessRef = input.assessmentReportRef ?? input.verificationReportRef;
        if (studioUse && object(rawAssessRef)) {
          const parsedAssessRef = sourceRef(rawAssessRef);
          if (
            parsedAssessRef.authority !== 'task'
            || !parsedAssessRef.projectId
            || !parsedAssessRef.taskId
            || !parsedAssessRef.locator?.startsWith('060_reports/')
          ) {
            throw new StudioError('studio_use_report_mismatch', 403);
          }
          if (options.enterpriseScopes.enterpriseIdForProject(parsedAssessRef.projectId) !== currentPack.enterpriseId) {
            throw new StudioError('studio_owner_mismatch', 403);
          }
          const assessProj = await options.projects.get(parsedAssessRef.projectId);
          syncWorkspaceReportsToProject(parsedAssessRef.projectId, parsedAssessRef.taskId, assessProj.rootPath);
          const effectiveAssessLoc = resolveTaskReportLocator(parsedAssessRef.projectId, parsedAssessRef.taskId, parsedAssessRef.locator, parsedAssessRef.sha256);
          const assessFile = await options.projects.readFile(parsedAssessRef.projectId, effectiveAssessLoc);
          const actualAssessSha = createHash('sha256').update(assessFile.bytes).digest('hex');
          if (parsedAssessRef.sha256 && parsedAssessRef.sha256 !== actualAssessSha) {
            throw new StudioError('studio_use_report_hash_mismatch', 409);
          }
          preserveImmutableReportSnapshot(parsedAssessRef.projectId, effectiveAssessLoc, assessFile.bytes, actualAssessSha);
          const verifiedAssessRef = sourceRef({ ...parsedAssessRef, locator: effectiveAssessLoc, version: actualAssessSha, sha256: actualAssessSha });
          if (digest(verifiedAssessRef) === digest(useRecord.reportRef)) {
            throw new StudioError('studio_use_assessment_same_as_report', 409);
          }
          options.studio.recordUseAssessment(currentPack.systemId, studioUse.id, {
            status: input.independentConfirmed === false ? 'fail' : 'pass',
            report: verifiedAssessRef,
            sources: studioUse.sources,
            result: text(input.verdictDetail ?? '独立复核报告已核对落盘', 20_000, false),
            assessorProjectId: verifiedAssessRef.projectId,
            assessorTaskId: verifiedAssessRef.taskId,
          });
        }

        // CRITICAL (R4): NEVER trust client-supplied boolean independentConfirmed OR same-task author self-assessment OR blind verifier without reads!
        // Only a disk-verified StudioUseAssessment authored by an INDEPENDENT task (`assessorTaskId !== useRecord.taskId`) that has its OWN native reads & calc/data evidence may achieve 'pass'!
        const latestStudioSys = options.studio.get(currentPack.systemId);
        const latestStudioUse = studioUse ? latestStudioSys.uses.find(u => u.id === studioUse.id) : undefined;
        const latestAssessment = latestStudioUse?.assessments?.at(-1);
        const assessorProjectId = latestAssessment?.assessorProjectId ?? latestAssessment?.report.projectId;
        const assessorTaskId = latestAssessment?.assessorTaskId ?? latestAssessment?.report.taskId;
        const isIndependentAssessor = Boolean(assessorTaskId && assessorTaskId !== useRecord.taskId);
        const selfAssessmentOnly = Boolean(latestAssessment && !isIndependentAssessor);

        let assessmentDiskVerified = false;
        if (latestStudioUse && latestAssessment && latestAssessment.status === 'pass' && latestAssessment.report.projectId && latestAssessment.report.locator?.startsWith('060_reports/')) {
          try {
            const effAssessLoc = resolveTaskReportLocator(latestAssessment.report.projectId, assessorTaskId ?? useRecord.taskId, latestAssessment.report.locator, latestAssessment.report.sha256);
            const assessFile = await options.projects.readFile(latestAssessment.report.projectId, effAssessLoc);
            const actualSha = createHash('sha256').update(assessFile.bytes).digest('hex');
            if (!latestAssessment.report.sha256 || latestAssessment.report.sha256 === actualSha) {
              preserveImmutableReportSnapshot(latestAssessment.report.projectId, effAssessLoc, assessFile.bytes, actualSha);
              assessmentDiskVerified = true;
            }
          } catch {
            assessmentDiskVerified = false;
          }
        }

        let verifierEv: Awaited<ReturnType<typeof inspectVerifierTaskEvidence>> | undefined;
        if (isIndependentAssessor && assessorProjectId && assessorTaskId) {
          verifierEv = await inspectVerifierTaskEvidence(assessorProjectId, assessorTaskId, currentPack, useRecord, latestAssessment?.report);
        }

        const hostVerifiedIndependentConfirmed = Boolean(
          input.independentConfirmed === true
          && latestStudioUse
          && latestAssessment
          && latestAssessment.status === 'pass'
          && assessmentDiskVerified
          && isIndependentAssessor
          && (!verifierEv || !verifierEv.missingReason),
        );
        const effectiveVerdictDetail = selfAssessmentOnly && input.independentConfirmed === true
          ? '仅见原分析任务作者自评（同任务），缺少独立任务/独立身份核验，保持待验证'
          : verifierEv?.missingReason && input.independentConfirmed === true
            ? verifierEv.missingReason
            : typeof input.verdictDetail === 'string'
              ? input.verdictDetail
              : undefined;

        const use = packs.verifyUse(useVerifyMatch[1]!, useVerifyMatch[2]!, {
          ...(input as unknown as Parameters<EnterprisePackStore['verifyUse']>[2]),
          ...(effectiveVerdictDetail ? { verdictDetail: effectiveVerdictDetail } : {}),
          ...(assessorProjectId ? { verifierProjectId: assessorProjectId } : {}),
          ...(assessorTaskId ? { verifierTaskId: assessorTaskId } : {}),
          ...(latestAssessment?.report ? { assessmentReportRef: latestAssessment.report } : {}),
          ...(verifierEv ? {
            verifierActualReads: verifierEv.verifierReads,
            verifierEvidenceSummary: {
              requiredAssetsCount: verifierEv.requiredCount,
              readRequiredAssetsCount: verifierEv.readRequiredAssetsCount,
              allRequiredReadByVerifier: verifierEv.allRequiredReadByVerifier,
              hadDataOrCalcEvidence: verifierEv.hadDataOrCalcEvidence,
              ...(verifierEv.assessmentTurnIndex !== undefined ? { assessmentTurnIndex: verifierEv.assessmentTurnIndex } : {}),
              ...(verifierEv.assessmentMessageId ? { assessmentMessageId: verifierEv.assessmentMessageId } : {}),
              ...(verifierEv.carriedFromTurnIndices.length ? { carriedFromTurnIndices: verifierEv.carriedFromTurnIndices } : {}),
              targetReportChecked: verifierEv.targetReportChecked,
              authorizedInputChecked: verifierEv.authorizedInputChecked,
              assessmentReportBoundToTarget: verifierEv.assessmentReportBoundToTarget,
              ...(verifierEv.missingReason ? { missingReason: verifierEv.missingReason } : {}),
            },
          } : {}),
          selfAssessmentOnly,
          independentConfirmed: hostVerifiedIndependentConfirmed,
        });
        return { result: { use, pack: packs.get(useVerifyMatch[1]!) } as unknown as Record<string, unknown> };
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }

    const restrictRevMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/revisions\/([^/]+)\/restrict$/.exec(url.pathname);
    if (restrictRevMatch && request.method === 'POST') {
      assertEnabledWritable();
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const currentPack = packs.get(restrictRevMatch[1]!);
        await assertWritablePackProject(currentPack, input.projectId);
        const revision = packs.restrictRevision(restrictRevMatch[1]!, decodeURIComponent(restrictRevMatch[2]!), text(input.reason, 2000, false));
        return { result: { revision, pack: packs.get(restrictRevMatch[1]!) } as unknown as Record<string, unknown> };
      }));
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
    getProjectToolScope,
    prepareRestrictedTaskWorkspace,
    syncActiveWorkspacesForProject,
    syncWorkspaceReportsToProject,
    discardUncommittedWorkspaceReports,
    resolveTaskReportLocator,
    authorizeProjectDataPath,
    assertProjectDataPathAllowed,
    filterAuthorizedProjectData,
    evaluateNativeToolCall,
    buildPackCatalogSummary,
    inspectPinnedSourceRead,
    resolveGrantAuthorityForProject,
    recordUseFromStudioDeclaration,
    syncAssessmentFromStudio,
    handle,
  };
}
