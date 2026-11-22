import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { ProjectStore } from './project-store.ts';
import type { EnterpriseScopeStore } from './enterprise-scope-store.ts';
import type { StudioStore } from '../../extensions/business-plugins/studio/store.ts';
import { studioExecutionOwner, type StudioSourceRef } from '../../extensions/business-plugins/studio/contracts.ts';
import type { ProjectSnapshot } from '../agent/project-runtime.ts';
import { StudioError, object, text, uuid, sourceRef, sources as parseSources, digest } from '../../extensions/business-plugins/studio/validation.ts';
import {
  evaluateResourceAccess,
  sameExactSourceRef,
  type DomainReferenceDomain,
  type EnterpriseDomainPack,
  type EnterprisePackDependency,
  type EnterprisePackPreview,
  type EnterprisePackReadEvidence,
  type FeedbackAdoptionBasis,
  type PackFeedbackCategory,
  type PackModulePublicationReceipt,
  type ResourceAccessQuery,
  type ResourceGrantOperation,
} from '../../extensions/business-plugins/studio/enterprise-pack.ts';
import { DomainReferenceStore, BUILTIN_REPO_TEMPLATES } from './domain-reference-store.ts';
import { ResourceGrantStore } from './resource-grant-store.ts';
import { EnterprisePackStore } from './enterprise-pack-store.ts';

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

export interface ProjectMemberPackFileScope {
  mode: 'deny-detail' | 'allowlist';
  enterpriseId: string;
  projectId: string;
  allowedPaths: string[];
  allowedStores: string[];
  summary: string;
}

export interface RestrictedTaskWorkspace {
  workspaceRoot: string;
  cleanDir: string;
  reportsDir: string;
  projectRoot: string;
  scope: ProjectMemberPackFileScope;
}

export interface MemberPackHostOptions {
  dataRoot: string;
  codeRoot?: string;
  memberPackEnabled?: boolean;
  projects: ProjectStore;
  enterpriseScopes: EnterpriseScopeStore;
  studio: StudioStore;
  operations: { run: (requestId: string, fingerprintInput: unknown, operation: () => Promise<{ statusCode?: number; result: Record<string, unknown>; systemId?: string }>) => Promise<{ statusCode?: number; result?: Record<string, unknown> }> };
  readBody(request: IncomingMessage, limit?: number): Promise<Record<string, unknown>>;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>;
  closing(): boolean;
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

export function createMemberPackFeature(options: MemberPackHostOptions) {
  const enabled = options.memberPackEnabled !== false;
  const references = new DomainReferenceStore(options.dataRoot, options.codeRoot ?? process.cwd(), { readOnlyMode: !enabled });
  const grants = new ResourceGrantStore(options.dataRoot, { readOnlyMode: !enabled });
  const packs = new EnterprisePackStore(options.dataRoot, { readOnlyMode: !enabled });
  const activeWorkspaces = new Map<string, Map<string, RestrictedTaskWorkspace>>();

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
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return undefined;
    const subjectGrants = grants.listForSubject(enterpriseId, projectId);
    // Preserve ordinary unmanaged project behavior when no resource grants are configured for this project.
    if (!subjectGrants.length) return undefined;

    const nowMs = Date.now();
    const activeDetailGrants = subjectGrants.filter(g =>
      !g.revokedAt
      && (!g.validFrom || Date.parse(g.validFrom) <= nowMs)
      && (!g.validTo || Date.parse(g.validTo) >= nowMs)
      && g.operations.includes('read-detail-recalculate'),
    );
    if (!activeDetailGrants.length) {
      return {
        mode: 'deny-detail',
        enterpriseId,
        projectId,
        allowedPaths: [],
        allowedStores: [],
        summary: 'detail_access_not_authorized: 当前项目仅获定义/汇总授权或明细授权已撤回，禁止读取项目 020_clean 明细文件（不可将不可读门店视为 0）。',
      };
    }

    const allowedPaths = [...new Set(activeDetailGrants.flatMap(g => (g.scope.allowedDataPaths ?? []).map(normalizeRelativeDataPath)))];
    const allowedStores = [...new Set(activeDetailGrants.flatMap(g => g.scope.stores ?? []))];
    // If all active detail grants omit allowedDataPaths (explicit full-project detail grant), check stores; otherwise enforce strict allowlist
    if (activeDetailGrants.some(g => !g.scope.allowedDataPaths?.length)) {
      return undefined;
    }
    return {
      mode: 'allowlist',
      enterpriseId,
      projectId,
      allowedPaths,
      allowedStores,
      summary: `当前项目仅获准读取指定明细路径：${allowedPaths.join('、')}${allowedStores.length ? `（获准门店：${allowedStores.join('、')}）` : ''}；未授权门店与文件不可读取，且不可视为 0。`,
    };
  }

  function syncCleanDir(workspaceCleanDir: string, projectRoot: string, scope: ProjectMemberPackFileScope | undefined) {
    fs.mkdirSync(workspaceCleanDir, { recursive: true, mode: 0o700 });
    // Clear existing files in sandbox clean dir first so revoked files are immediately purged!
    for (const entry of fs.readdirSync(workspaceCleanDir, { withFileTypes: true })) {
      fs.rmSync(path.join(workspaceCleanDir, entry.name), { recursive: true, force: true });
    }
    if (!scope || scope.mode !== 'allowlist') return;
    const resolvedProjectRoot = path.resolve(projectRoot);
    for (const rel of scope.allowedPaths) {
      if (!rel.startsWith('020_clean/') || rel.includes('..')) continue;
      const src = path.resolve(resolvedProjectRoot, rel);
      if (!src.startsWith(path.resolve(resolvedProjectRoot, '020_clean') + path.sep)) continue;
      if (!fs.existsSync(src)) continue;
      const stat = fs.lstatSync(src);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      const subRel = rel.slice('020_clean/'.length);
      const dst = path.resolve(workspaceCleanDir, subRel);
      if (!dst.startsWith(path.resolve(workspaceCleanDir) + path.sep)) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
      fs.copyFileSync(src, dst);
      fs.chmodSync(dst, 0o400);
    }
  }

  function prepareRestrictedTaskWorkspace(projectId: string, taskId: string, projectRoot: string): RestrictedTaskWorkspace | undefined {
    const scope = getProjectToolScope(projectId);
    if (!scope) return undefined;
    const workspaceRoot = path.resolve(options.dataRoot, 'member-pack-workspaces', uuid(projectId), uuid(taskId));
    const cleanDir = path.join(workspaceRoot, '020_clean');
    const reportsDir = path.join(workspaceRoot, '060_reports');
    fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
    fs.mkdirSync(reportsDir, { recursive: true, mode: 0o700 });
    syncCleanDir(cleanDir, projectRoot, scope);
    const ws: RestrictedTaskWorkspace = { workspaceRoot, cleanDir, reportsDir, projectRoot: path.resolve(projectRoot), scope };
    let byTask = activeWorkspaces.get(projectId);
    if (!byTask) {
      byTask = new Map();
      activeWorkspaces.set(projectId, byTask);
    }
    byTask.set(taskId, ws);
    return ws;
  }

  function syncActiveWorkspacesForProject(projectId: string) {
    const byTask = activeWorkspaces.get(projectId);
    if (!byTask) return;
    const nextScope = getProjectToolScope(projectId);
    for (const ws of byTask.values()) {
      syncCleanDir(ws.cleanDir, ws.projectRoot, nextScope);
      if (nextScope) ws.scope = nextScope;
    }
  }

  function syncWorkspaceReportsToProject(projectId: string, taskId: string, projectRoot: string) {
    const workspaceReports = path.resolve(options.dataRoot, 'member-pack-workspaces', uuid(projectId), uuid(taskId), '060_reports');
    if (!fs.existsSync(workspaceReports)) return;
    const targetReports = path.resolve(projectRoot, '060_reports');
    fs.mkdirSync(targetReports, { recursive: true });
    const walk = (srcDir: string, relBase: string) => {
      for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const srcPath = path.join(srcDir, entry.name);
        const rel = relBase ? path.join(relBase, entry.name) : entry.name;
        const dstPath = path.resolve(targetReports, rel);
        if (!dstPath.startsWith(targetReports + path.sep)) continue;
        const st = fs.lstatSync(srcPath);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) {
          fs.mkdirSync(dstPath, { recursive: true });
          walk(srcPath, rel);
        } else if (st.isFile()) {
          fs.mkdirSync(path.dirname(dstPath), { recursive: true });
          fs.copyFileSync(srcPath, dstPath);
        }
      }
    };
    walk(workspaceReports, '');
  }

  function authorizeProjectDataPath(projectId: string, relativePath: string): { allowed: boolean; reason?: string } {
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return { allowed: true };
    const subjectGrants = grants.listForSubject(enterpriseId, projectId);
    // Preserve ordinary unmanaged project behavior when no resource grants are configured for this project.
    if (!subjectGrants.length) return { allowed: true };
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
    if (!result.allowed) throw new StudioError(result.reason ?? 'resource_detail_not_authorized', 403);
  }

  function evaluateNativeToolCall(
    projectId: string,
    projectRoot: string,
    call: { toolName: string; input: Record<string, unknown> },
    workspaceRoot?: string,
  ): { allowed: boolean; reason?: string } {
    const scope = getProjectToolScope(projectId);
    if (!scope) return { allowed: true };

    const resolvedProjectRoot = path.resolve(projectRoot);
    const projectCleanDir = path.resolve(resolvedProjectRoot, '020_clean');
    const projectDrawDir = path.resolve(resolvedProjectRoot, '010_draw');
    const projectReportsDir = path.resolve(resolvedProjectRoot, '060_reports');
    const effectiveRoot = workspaceRoot ? path.resolve(workspaceRoot) : resolvedProjectRoot;
    const effectiveCleanDir = path.resolve(effectiveRoot, '020_clean');
    const effectiveReportsDir = path.resolve(effectiveRoot, '060_reports');

    const resolveTarget = (rawTarget: unknown): string | undefined => {
      if (typeof rawTarget !== 'string' || !rawTarget.trim()) return undefined;
      return path.resolve(effectiveCleanDir, rawTarget.trim());
    };

    const isInside = (target: string, dir: string) => target === dir || target.startsWith(dir + path.sep);

    // Block subagent escape attempts in restricted member-pack projects
    if (call.toolName === 'subagent') {
      return { allowed: false, reason: 'member_pack_subagent_restricted: 受限资源授权项目禁用子会话委派，请直接按获准范围执行分析' };
    }

    if (['read', 'write', 'edit'].includes(call.toolName)) {
      const target = resolveTarget(call.input.path ?? call.input.file_path ?? call.input.target);
      if (!target) return { allowed: false, reason: scope.summary };
      // Writing/reading own 060_reports deliverables remains allowed
      if (isInside(target, effectiveReportsDir) || isInside(target, projectReportsDir)) return { allowed: true };
      // NEVER allow direct access to project's raw 010_draw or original project 020_clean when isolated workspace is active
      if (isInside(target, projectDrawDir) || (workspaceRoot && isInside(target, projectCleanDir))) {
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
      if (target && (isInside(target, effectiveReportsDir) || isInside(target, projectReportsDir))) return { allowed: true };
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
      // Block any reference to projectRoot, 010_draw, or escaping workspace via ../../
      if (cmd.includes(resolvedProjectRoot) || cmd.includes(projectCleanDir) || /\b010_draw\b|\.\.\/\.\./.test(cmd)) {
        return { allowed: false, reason: 'member_pack_path_outside_workspace: 受限资源授权项目命令禁止越出任务隔离工作区访问原项目目录' };
      }
      // Enumerate all unauthorized files currently present in original project 020_clean
      let unauthorizedNames: string[] = [];
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
          const canDef = evaluateResourceAccess(subjectGrants, { operation: 'read-definition', purposeKey: pm.purposeKey, brand: pm.scope.brand, channel: pm.scope.channel });
          const canSummary = evaluateResourceAccess(subjectGrants, { operation: 'cite-summary', purposeKey: pm.purposeKey, brand: pm.scope.brand, channel: pm.scope.channel });
          const canDetail = evaluateResourceAccess(subjectGrants, { operation: 'read-detail-recalculate', purposeKey: pm.purposeKey, brand: pm.scope.brand, channel: pm.scope.channel, stores: pm.scope.stores });
          const hasPartialOrFullDetail = canDetail.allowed || canDetail.grantedStores.length > 0;
          if (!canDef.allowed && !canSummary.allowed && !hasPartialOrFullDetail) return null;

          const matchedDetailGrants = subjectGrants.filter(g => canDetail.matchedGrantIds.includes(g.id));
          const allowedDataPaths = [...new Set(matchedDetailGrants.flatMap(g => g.scope.allowedDataPaths ?? []))];
          const summaryGrant = canSummary.allowed ? subjectGrants.find(g => canSummary.matchedGrantIds.includes(g.id)) : undefined;
          const visibleDeps = filterDependenciesForAccess(pm.dependencies, {
            canDef: canDef.allowed,
            canSummary: canSummary.allowed,
            canDetail: hasPartialOrFullDetail,
          });

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
      // In read-only rollback mode, unpinned new tasks receive NO pack-mediated supply!
      if (!enabled && !pin) continue;
      const rev = pin
        ? pack.packRevisions.find(r => r.version === pin.packVersion)
        : pack.packRevisions.find(r => r.status === 'active');
      if (!rev) continue;

      // Check if ref is a Host-authorized summary ref
      const matchedSummaryGrant = subjectGrants.find(g =>
        !g.revokedAt
        && g.operations.includes('cite-summary')
        && g.resourceRef
        && sameExactSourceRef(g.resourceRef, ref),
      );
      if (matchedSummaryGrant) {
        const evalSummary = evaluateResourceAccess(subjectGrants, { operation: 'cite-summary' });
        if (!evalSummary.allowed) throw new StudioError('resource_grant_revoked', 403);
        return { matchedPack: { packId: pack.id, packVersion: rev.version, purposeIds: pin?.purposeIds ?? [], summaryAuthorized: true } };
      }

      // Check if ref belongs to any dependency in the pinned revision
      const matchedPurposes = rev.purposeManifests.filter(pm =>
        pm.status === 'eligible' && pm.dependencies.some(d => sameExactSourceRef(d.ref, ref)),
      );
      if (matchedPurposes.length > 0) {
        // Re-verify active Host grant on every read (immediate revocation!)
        const allowedForAny = matchedPurposes.some(pm => {
          const canDef = evaluateResourceAccess(subjectGrants, { operation: 'read-definition', purposeKey: pm.purposeKey }).allowed;
          const canSummary = evaluateResourceAccess(subjectGrants, { operation: 'cite-summary', purposeKey: pm.purposeKey }).allowed;
          const detailEval = evaluateResourceAccess(subjectGrants, { operation: 'read-detail-recalculate', purposeKey: pm.purposeKey, stores: pm.scope.stores });
          const canDetail = detailEval.allowed || detailEval.grantedStores.length > 0;
          const visible = filterDependenciesForAccess(pm.dependencies, { canDef, canSummary, canDetail });
          return visible.some(d => sameExactSourceRef(d.ref, ref));
        });
        if (!allowedForAny) {
          throw new StudioError(subjectGrants.some(g => Boolean(g.revokedAt)) ? 'resource_grant_revoked' : 'resource_access_denied', 403);
        }
        return { matchedPack: { packId: pack.id, packVersion: rev.version, purposeIds: matchedPurposes.map(pm => pm.purposeId) } };
      }

      // If this project has a revoked summary grant for this exact ref, block immediately!
      if (subjectGrants.some(g => g.revokedAt && g.resourceRef && sameExactSourceRef(g.resourceRef, ref))) {
        throw new StudioError('resource_grant_revoked', 403);
      }
    }
    return {};
  }

  /**
   * Collects actual Host-verified tool evidence STRICTLY scoped to the specific reply's turn
   * `[turnStartIdx .. endIdx]` so a later tool-free turn NEVER inherits reads from an earlier turn!
   */
  async function inspectTaskNativeEvidence(projectId: string, taskId: string, pack: EnterpriseDomainPack, upToSelection?: { sessionId: string; messageId: string }) {
    const turnActualReads: EnterprisePackReadEvidence[] = [];
    const seenReadKeys = new Set<string>();
    let observedDirectoryVersion: string | undefined;
    let sessionObservedDirectoryVersion: string | undefined;
    let catalogSuppliedAt: string | undefined;
    let catalogPurposeIds: string[] = [];
    let catalogAssetRefs: StudioSourceRef[] = [];
    let taskCutoffAt: string | undefined;
    let turnIndex: number | undefined;

    if (!options.taskSnapshot) {
      return {
        actualReads: turnActualReads,
        observedDirectoryVersion,
        sessionObservedDirectoryVersion,
        catalogSuppliedAt,
        catalogPurposeIds,
        catalogAssetRefs,
        taskCutoffAt,
        turnIndex,
      };
    }
    const snap = await options.taskSnapshot(projectId, taskId);
    let endIdx = snap.messages.length - 1;
    if (upToSelection) {
      const idx = snap.messages.findIndex(m => m.role === 'assistant' && m.nativeSessionId === upToSelection.sessionId && m.nativeEntryId === upToSelection.messageId);
      if (idx >= 0) endIdx = idx;
    } else {
      for (let i = snap.messages.length - 1; i >= 0; i--) {
        if ((snap.messages[i] as Record<string, any>)?.role === 'assistant') { endIdx = i; break; }
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

    // Check earlier turns ONLY for session-level directory pin observation (NEVER reads!)
    for (let i = 0; i < turnStartIdx; i++) {
      const m = snap.messages[i] as Record<string, any>;
      if (!m || m.role !== 'toolResult' || m.isError) continue;
      if (m.details?.type === 'optracall.studio' && m.details.action === 'catalog' && Array.isArray(m.details.result?.memberPacks)) {
        const entry = m.details.result.memberPacks.find((p: any) => p?.packId === pack.id);
        if (entry && typeof entry.pinnedVersion === 'string') {
          sessionObservedDirectoryVersion = entry.pinnedVersion;
        }
      }
    }

    // Collect ACTUAL reads & catalog supply STRICTLY within THIS turn [turnStartIdx + 1 .. endIdx]!
    for (let i = turnStartIdx + 1; i <= endIdx; i++) {
      const m = snap.messages[i] as Record<string, any>;
      if (!m || m.role !== 'toolResult' || m.isError) continue;
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
        if (['read-source', 'read'].includes(action) && result?.ref) {
          try {
            const ref = sourceRef(result.ref);
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
    return {
      actualReads: turnActualReads,
      observedDirectoryVersion,
      sessionObservedDirectoryVersion,
      catalogSuppliedAt,
      catalogPurposeIds,
      catalogAssetRefs,
      taskCutoffAt,
      turnIndex,
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

    // Helper: filter purposeManifests identically to buildPackCatalogSummary!
    const filterPurposeManifest = (pm: EnterpriseDomainPack['packRevisions'][number]['purposeManifests'][number]) => {
      if (pm.status !== 'eligible') return null;
      const canDef = evaluateResourceAccess(subjectGrants, { operation: 'read-definition', purposeKey: pm.purposeKey, brand: pm.scope.brand, channel: pm.scope.channel });
      const canSummary = evaluateResourceAccess(subjectGrants, { operation: 'cite-summary', purposeKey: pm.purposeKey, brand: pm.scope.brand, channel: pm.scope.channel });
      const canDetail = evaluateResourceAccess(subjectGrants, { operation: 'read-detail-recalculate', purposeKey: pm.purposeKey, brand: pm.scope.brand, channel: pm.scope.channel, stores: pm.scope.stores });
      const hasDetail = canDetail.allowed || canDetail.grantedStores.length > 0;
      if (!canDef.allowed && !canSummary.allowed && !hasDetail) return null;
      return {
        ...pm,
        dependencies: filterDependenciesForAccess(pm.dependencies, {
          canDef: canDef.allowed,
          canSummary: canSummary.allowed,
          canDetail: hasDetail,
        }),
      };
    };

    if (!enabled || activeGrants.length === 0) {
      // Rollback mode or ungranted/revoked project: see ONLY own historical pinned/used revisions — zero new active catalog supply!
      const historicalRevisions = pack.packRevisions
        .filter(r => ownPinnedVersions.has(r.version))
        .map(r => {
          const pinnedPurposeIds = new Set([
            ...ownPins.filter(p => p.packVersion === r.version).flatMap(p => p.purposeIds),
            ...ownUses.filter(u => u.packVersion === r.version).map(u => u.purposeId),
          ]);
          return {
            ...r,
            purposeManifests: r.purposeManifests.filter(pm => pinnedPurposeIds.has(pm.purposeId)),
            moduleReceipts: [],
          };
        });
      return {
        ...pack,
        panorama: undefined,
        panoramaHistory: [],
        entries: [],
        purposes: [],
        previews: [],
        packRevisions: historicalRevisions,
        taskPins: ownPins,
        useRecords: ownUses,
        feedbackItems: ownFeedback,
      };
    }

    // Active consumer project: filter revisions & purposes identically to catalog rules, never exposing unpublished drafts or other projects' records!
    const filteredRevisions = pack.packRevisions
      .map(r => {
        const manifests = r.purposeManifests.map(filterPurposeManifest).filter((x): x is NonNullable<typeof x> => Boolean(x));
        if (!manifests.length && !ownPinnedVersions.has(r.version)) return null;
        return {
          ...r,
          purposeManifests: manifests,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    const allowedPurposeIds = new Set(filteredRevisions.flatMap(r => r.purposeManifests.map(pm => pm.purposeId)));
    return {
      ...pack,
      panorama: undefined,
      panoramaHistory: [],
      entries: [],
      purposes: pack.purposes.filter(p => allowedPurposeIds.has(p.id)),
      previews: [],
      packRevisions: filteredRevisions,
      taskPins: ownPins,
      useRecords: ownUses,
      feedbackItems: ownFeedback,
    };
  }

  async function handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
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
      extraAllowedProjectIds: string[] = [],
    ): Promise<{
      actorLabel: string;
      actorProjectId: string;
      actorSystemId?: string;
      authorityType: 'studio-system-owner' | 'enterprise-authority-asset' | 'resource-owner-project';
    }> {
      const enterpriseSystems = options.studio.list().filter(s => s.enterpriseId === enterpriseId);
      const enterprisePacks = packs.list(enterpriseId);
      const activeOwnerCandidates: { projectId: string; systemId?: string; systemName?: string }[] = [];
      for (const sys of enterpriseSystems) {
        const ownerPid = studioExecutionOwner(sys).projectId;
        try {
          const proj = await options.projects.get(ownerPid);
          if (proj.archivedAt === null && options.enterpriseScopes.enterpriseIdForProject(proj.id) === enterpriseId) {
            activeOwnerCandidates.push({ projectId: proj.id, systemId: sys.id, systemName: sys.name });
          }
        } catch { /* ignore unavailable */ }
      }
      for (const pk of enterprisePacks) {
        if (pk.activeOwnerProjectId) {
          try {
            const proj = await options.projects.get(pk.activeOwnerProjectId);
            if (proj.archivedAt === null && options.enterpriseScopes.enterpriseIdForProject(proj.id) === enterpriseId) {
              activeOwnerCandidates.push({ projectId: proj.id, systemId: pk.systemId, systemName: pk.name });
            }
          } catch { /* ignore */ }
        }
      }
      for (const extraPid of extraAllowedProjectIds) {
        try {
          const proj = await options.projects.get(uuid(extraPid));
          if (proj.archivedAt === null && options.enterpriseScopes.enterpriseIdForProject(proj.id) === enterpriseId) {
            activeOwnerCandidates.push({ projectId: proj.id });
          }
        } catch { /* ignore */ }
      }

      const failCode = mode === 'grant' ? 'resource_grantor_not_authorized' : 'resource_revoker_not_authorized';

      if (requestedActorProjectId === undefined || requestedActorProjectId === null || String(requestedActorProjectId).trim() === '') {
        throw new StudioError(failCode, 403);
      }
      const pid = uuid(requestedActorProjectId);
      const proj = await options.projects.get(pid);
      if (proj.archivedAt !== null) throw new StudioError('studio_project_read_only', 409);
      if (options.enterpriseScopes.enterpriseIdForProject(pid) !== enterpriseId) throw new StudioError(failCode, 403);
      const matchedOwner = activeOwnerCandidates.find(c => c.projectId === pid);
      if (!matchedOwner) throw new StudioError(failCode, 403);
      return {
        actorLabel: matchedOwner.systemName
          ? `Studio体系·${matchedOwner.systemName}（原权责项目：${proj.name}）`
          : `原权责项目·${proj.name}`,
        actorProjectId: proj.id,
        ...(matchedOwner.systemId ? { actorSystemId: matchedOwner.systemId } : {}),
        authorityType: matchedOwner.systemId ? 'studio-system-owner' : 'resource-owner-project',
      };
    }

    if (url.pathname === '/api/studio/resource-grants' && request.method === 'POST') {
      assertEnabledWritable();
      const input = await options.readBody(request);
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
            summaryVerifiedAuthority = verified.summaryAuthority;
          }
        }
        const verifiedActor = await resolveVerifiedGrantAuthority(
          enterpriseId,
          input.grantorProjectId,
          'grant',
          summaryOwnerProjectId ? [summaryOwnerProjectId] : [],
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
          ...(verifiedActor.actorSystemId ? { grantorSystemId: verifiedActor.actorSystemId } : {}),
          grantorAuthorityType: summaryVerifiedAuthority ? 'enterprise-authority-asset' : verifiedActor.authorityType,
          ...(verifiedResourceRef ? { resourceRef: verifiedResourceRef } : {}),
          scope: rawScope as Parameters<ResourceGrantStore['grant']>[0]['scope'],
        });
        // Immediately synchronize any active task sandboxes for this subject project
        if (record.subjectType === 'project') syncActiveWorkspacesForProject(record.subjectId);
        return { statusCode: 200, result: { grant: record } as unknown as Record<string, unknown> };
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }
    const revokeMatch = /^\/api\/studio\/resource-grants\/([a-f0-9-]+)\/revoke$/.exec(url.pathname);
    if (revokeMatch && request.method === 'POST') {
      assertEnabledWritable();
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        assertEnabledWritable();
        const existingGrant = grants.get(revokeMatch[1]!);
        const revokerActor = await resolveVerifiedGrantAuthority(
          existingGrant.enterpriseId,
          input.revokerProjectId ?? input.grantorProjectId,
          'revoke',
          existingGrant.grantorProjectId ? [existingGrant.grantorProjectId] : [],
        );
        const record = grants.revoke(revokeMatch[1]!, text(input.reason ?? '显式撤回授权', 2000, false), {
          revokedBy: revokerActor.actorLabel,
          revokedByProjectId: revokerActor.actorProjectId,
        });
        // Immediately purge revoked files from all active restricted sandboxes of this subject project!
        if (record.subjectType === 'project') syncActiveWorkspacesForProject(record.subjectId);
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
      const list = packs.list(scopedEnterpriseId)
        .filter(p => !domain || p.domain === domain)
        .map(p => (projectId ? redactPackForConsumer(p, projectId) : p));
      json(response, 200, { packs: list, readOnlyRollback: !enabled });
      return true;
    }
    if (url.pathname === '/api/studio/enterprise-packs' && request.method === 'POST') {
      assertEnabledWritable();
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
      json(response, 200, { pack: projectId ? redactPackForConsumer(pack, projectId) : pack, readOnlyRollback: !enabled });
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
          const pack = packs.selectPanoramaRecommendation(packId, text(input.purposeKey, 200, false), Boolean(input.selected));
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
            const file = await options.projects.readFile(pid, rawReportRef.locator);
            const actualSha = createHash('sha256').update(file.bytes).digest('hex');
            if (rawReportRef.sha256 && rawReportRef.sha256 !== actualSha) {
              throw new StudioError('studio_use_report_hash_mismatch', 409);
            }
            verifiedReportRef = sourceRef({ ...rawReportRef, version: actualSha, sha256: actualSha });
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

          // Resolve real author adoption declaration: either explicit authorDeclaration OR matching Studio declare-use record for this exact report!
          let resolvedDeclaration: Parameters<EnterprisePackStore['recordUse']>[1]['authorDeclaration'] | undefined;
          if (object(input.authorDeclaration)) {
            resolvedDeclaration = input.authorDeclaration as Parameters<EnterprisePackStore['recordUse']>[1]['authorDeclaration'];
          } else {
            try {
              const studioSys = options.studio.get(currentPack.systemId);
              const studioUse = [...studioSys.uses].reverse().find(u =>
                u.projectId === pid
                && u.taskId === tid
                && (digest(u.report) === digest(verifiedReportRef) || (verifiedReportRef.locator && u.report.locator === verifiedReportRef.locator)),
              );
              if (studioUse) {
                resolvedDeclaration = {
                  declaredPurposeId: pm.purposeId,
                  declaredRefs: studioUse.sources,
                  summaryText: studioUse.result || '来自原 Studio declare-use 作者采用声明',
                  declaredAt: studioUse.createdAt,
                };
              }
            } catch { /* no studio declaration */ }
          }

          const use = packs.recordUse(packId, {
            projectId: pid,
            taskId: tid,
            ...(selectionForTurn ? { sessionId: selectionForTurn.sessionId, messageId: selectionForTurn.messageId } : {}),
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
            if (options.enterpriseScopes.enterpriseIdForProject(pid) !== currentPack.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
            const selection = { sessionId: text(origin.sessionId, 200, false), messageId: text(origin.messageId, 200, false) };
            const original = await options.readTaskReply(pid, tid, selection);
            const replySha = createHash('sha256').update(original.text).digest('hex');
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
            // Only match a recorded use bound to THIS EXACT message (sessionId + messageId) with real complete pack reads!
            const matchingTurnUse = currentPack.useRecords.find(u =>
              u.projectId === pid
              && u.taskId === tid
              && u.sessionId === selection.sessionId
              && u.messageId === selection.messageId
              && u.actualReads.some(r => r.complete && packDepRefs.some(dep => sameExactSourceRef(r.ref, dep))),
            );
            const hasActualUse = Boolean(matchingTurnUse || packMatchedReads.length > 0);
            const matchedRefs = packMatchedReads.length > 0
              ? packMatchedReads.map(r => r.ref)
              : matchingTurnUse
                ? matchingTurnUse.actualReads.filter(r => r.complete && packDepRefs.some(dep => sameExactSourceRef(r.ref, dep))).map(r => r.ref)
                : [];

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
              reportRef: { authority: 'task', id: tid, projectId: pid, taskId: tid, version: replySha, sha256: replySha, locator: JSON.stringify({ kind: 'native-reply', ...selection }) },
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
        const use = packs.verifyUse(useVerifyMatch[1]!, useVerifyMatch[2]!, input as unknown as Parameters<EnterprisePackStore['verifyUse']>[2]);
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
    getProjectToolScope,
    prepareRestrictedTaskWorkspace,
    syncActiveWorkspacesForProject,
    syncWorkspaceReportsToProject,
    authorizeProjectDataPath,
    assertProjectDataPathAllowed,
    evaluateNativeToolCall,
    buildPackCatalogSummary,
    inspectPinnedSourceRead,
    handle,
  };
}
