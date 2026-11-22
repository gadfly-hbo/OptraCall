import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { ProjectStore } from './project-store.ts';
import type { EnterpriseScopeStore } from './enterprise-scope-store.ts';
import type { StudioStore } from '../../extensions/business-plugins/studio/store.ts';
import type { StudioSourceRef } from '../../extensions/business-plugins/studio/contracts.ts';
import type { ProjectSnapshot } from '../agent/project-runtime.ts';
import { StudioError, object, text, uuid, sourceRef, sources as parseSources } from '../../extensions/business-plugins/studio/validation.ts';
import { evaluateResourceAccess, type DomainReferenceDomain, type EnterpriseDomainPack, type ResourceAccessQuery } from '../../extensions/business-plugins/studio/enterprise-pack.ts';
import { DomainReferenceStore, BUILTIN_REPO_TEMPLATES } from './domain-reference-store.ts';
import { ResourceGrantStore } from './resource-grant-store.ts';
import { EnterprisePackStore } from './enterprise-pack-store.ts';

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
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
}

export function createMemberPackFeature(options: MemberPackHostOptions) {
  const enabled = options.memberPackEnabled !== false;
  const references = new DomainReferenceStore(options.dataRoot, options.codeRoot ?? process.cwd());
  const grants = new ResourceGrantStore(options.dataRoot);
  const packs = new EnterprisePackStore(options.dataRoot, { readOnlyMode: !enabled });

  async function assertWritableProject(projectId: string, enterpriseId: string) {
    const project = await options.projects.get(uuid(projectId));
    if (project.archivedAt !== null) throw new StudioError('studio_project_read_only', 409);
    const ownerEnterprise = options.enterpriseScopes.enterpriseIdForProject(project.id);
    if (ownerEnterprise !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
    return project;
  }

  function authorizeProjectDataPath(projectId: string, relativePath: string): { allowed: boolean; reason?: string } {
    const enterpriseId = options.enterpriseScopes.enterpriseIdForProject(projectId);
    if (!enterpriseId) return { allowed: true };
    const subjectGrants = grants.listForSubject(enterpriseId, projectId);
    // Preserve ordinary unmanaged project behavior when no resource grants are configured for this project.
    if (!subjectGrants.length) return { allowed: true };
    const evalResult = evaluateResourceAccess(subjectGrants, {
      operation: 'read-detail-recalculate',
      dataPath: relativePath,
    });
    return evalResult.allowed
      ? { allowed: true }
      : { allowed: false, reason: evalResult.restrictionReason ?? 'resource_detail_not_authorized' };
  }

  function assertProjectDataPathAllowed(projectId: string, relativePath: string): void {
    const result = authorizeProjectDataPath(projectId, relativePath);
    if (!result.allowed) throw new StudioError(result.reason ?? 'resource_detail_not_authorized', 403);
  }

  function buildPackCatalogSummary(enterpriseId: string, projectId?: string, taskId?: string) {
    if (!enabled) return [];
    const list = packs.list(enterpriseId);
    const subjectGrants = projectId ? grants.listForSubject(enterpriseId, projectId) : [];
    const hasGrantRestrictions = Boolean(projectId && subjectGrants.length > 0);
    const summaries: Record<string, unknown>[] = [];

    for (const pack of list) {
      const activeRev = pack.packRevisions.find(r => r.status === 'active') ?? pack.packRevisions.at(-1);
      let pinnedVersion = activeRev?.version;
      let pinnedManifest = activeRev;

      if (projectId && taskId && activeRev) {
        const existingPin = packs.getTaskPin(pack.id, projectId, taskId);
        if (existingPin) {
          pinnedVersion = existingPin.packVersion;
          pinnedManifest = pack.packRevisions.find(r => r.version === existingPin.packVersion) ?? activeRev;
        } else {
          try {
            const scopeDesc = hasGrantRestrictions
              ? subjectGrants.filter(g => !g.revokedAt).map(g => `${g.operations.join(',')}:${g.scope.stores?.join('/') || g.scope.grain || g.scope.brand || '*'}`).join(';') || 'restricted'
              : 'enterprise-project-default';
            const pin = packs.pinTaskVersion(pack.id, { projectId, taskId, authorizedScope: scopeDesc });
            pinnedVersion = pin.packVersion;
            pinnedManifest = pack.packRevisions.find(r => r.version === pin.packVersion) ?? activeRev;
          } catch { /* No active revision yet or read-only mode */ }
        }
      }

      const visiblePurposes = (pinnedManifest?.purposeManifests ?? [])
        .filter(pm => pm.status === 'eligible')
        .map(pm => {
          if (!hasGrantRestrictions) {
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
              accessLevels: ['read-definition', 'cite-summary', 'read-detail-recalculate'],
            };
          }
          const canDef = evaluateResourceAccess(subjectGrants, { operation: 'read-definition', purposeKey: pm.purposeKey });
          const canSummary = evaluateResourceAccess(subjectGrants, { operation: 'cite-summary', purposeKey: pm.purposeKey });
          const canDetail = evaluateResourceAccess(subjectGrants, { operation: 'read-detail-recalculate', purposeKey: pm.purposeKey, stores: pm.scope.stores });
          if (!canDef.allowed && !canSummary.allowed && !canDetail.allowed) return null;
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
            accessLevels: [
              ...(canDef.allowed ? ['read-definition'] : []),
              ...(canSummary.allowed ? ['cite-summary'] : []),
              ...(canDetail.allowed ? ['read-detail-recalculate'] : []),
            ],
            ...(canDetail.deniedStores.length ? { restrictedDetailNote: '部分门店明细未授权，不可将未授权门店再购当作零' } : {}),
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
        purposes: visiblePurposes,
      });
    }
    return summaries;
  }

  async function handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    // 1. Domain References (Settings -> 领域资产包)
    if (url.pathname === '/api/studio/domain-references' && request.method === 'GET') {
      const enterpriseId = url.searchParams.get('enterpriseId') || undefined;
      const domain = (url.searchParams.get('domain') || undefined) as DomainReferenceDomain | undefined;
      const sourceId = url.searchParams.get('sourceId') || undefined;
      const query = url.searchParams.get('query') || undefined;
      json(response, 200, {
        references: references.list({ enterpriseId, domain, sourceId, query }),
        builtinTemplates: Object.values(BUILTIN_REPO_TEMPLATES).map(t => ({ sourceId: t.sourceId, version: t.version, title: t.title, domain: t.domain, locator: t.relativePath })),
      });
      return true;
    }
    if (url.pathname === '/api/studio/domain-references' && request.method === 'POST') {
      const input = await options.readBody(request, 4 * 1024 * 1024);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        const result = references.register(input as unknown as Parameters<DomainReferenceStore['register']>[0]);
        return { statusCode: 200, result: result as unknown as Record<string, unknown> };
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }
    if (url.pathname === '/api/studio/domain-references/repo-template' && request.method === 'POST') {
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const templateId = text(input.templateId, 20, false) as keyof typeof BUILTIN_REPO_TEMPLATES;
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, templateId }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        const result = references.registerRepoTemplate(templateId);
        return { statusCode: 200, result: result as unknown as Record<string, unknown> };
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }
    const refOriginalMatch = /^\/api\/studio\/domain-references\/([a-f0-9-]+)\/original$/.exec(url.pathname);
    if (refOriginalMatch && request.method === 'GET') {
      const section = url.searchParams.get('section') || undefined;
      json(response, 200, references.readOriginal(refOriginalMatch[1]!, section));
      return true;
    }

    // 2. Resource Authorization Grants
    if (url.pathname === '/api/studio/resource-grants' && request.method === 'GET') {
      const enterpriseId = url.searchParams.get('enterpriseId') || undefined;
      const subjectId = url.searchParams.get('subjectId') || undefined;
      const list = enterpriseId && subjectId ? grants.listForSubject(enterpriseId, subjectId) : grants.list(enterpriseId);
      json(response, 200, { grants: list });
      return true;
    }
    if (url.pathname === '/api/studio/resource-grants' && request.method === 'POST') {
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        const enterpriseId = uuid(input.enterpriseId);
        options.enterpriseScopes.get(enterpriseId);
        if (input.subjectType === 'project') {
          const projectId = uuid(input.subjectId);
          await options.projects.get(projectId);
          if (options.enterpriseScopes.enterpriseIdForProject(projectId) !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
        }
        const record = grants.grant(input as unknown as Parameters<ResourceGrantStore['grant']>[0]);
        return { statusCode: 200, result: { grant: record } as unknown as Record<string, unknown> };
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }
    const revokeMatch = /^\/api\/studio\/resource-grants\/([a-f0-9-]+)\/revoke$/.exec(url.pathname);
    if (revokeMatch && request.method === 'POST') {
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        const record = grants.revoke(revokeMatch[1]!, text(input.reason ?? '显式撤回授权', 2000, false));
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
      const domain = url.searchParams.get('domain') || undefined;
      const list = packs.list(enterpriseId).filter(p => !domain || p.domain === domain);
      json(response, 200, { packs: list, readOnlyRollback: !enabled });
      return true;
    }
    if (url.pathname === '/api/studio/enterprise-packs' && request.method === 'POST') {
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        const enterpriseId = uuid(input.enterpriseId);
        options.enterpriseScopes.get(enterpriseId);
        const systemId = uuid(input.systemId);
        const system = options.studio.get(systemId);
        if (system.enterpriseId !== enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
        if (input.projectId !== undefined) await assertWritableProject(String(input.projectId), enterpriseId);
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
      const projectId = url.searchParams.get('projectId');
      if (projectId) {
        const ownerEnterprise = options.enterpriseScopes.enterpriseIdForProject(uuid(projectId));
        if (ownerEnterprise !== pack.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
      }
      json(response, 200, { pack, readOnlyRollback: !enabled });
      return true;
    }

    const packActionMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/(panorama|entries|purposes|previews|confirm|reconcile|pin|uses|feedback|upgrade-impact)$/.exec(url.pathname);
    if (packActionMatch && request.method === 'POST') {
      const packId = packActionMatch[1]!;
      const action = packActionMatch[2]!;
      const input = await options.readBody(request, 4 * 1024 * 1024);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        const currentPack = packs.get(packId);
        if (input.projectId !== undefined && action !== 'feedback') {
          await assertWritableProject(String(input.projectId), currentPack.enterpriseId);
        }

        if (action === 'panorama') {
          const pack = packs.savePanorama(packId, input as unknown as Parameters<EnterprisePackStore['savePanorama']>[1]);
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
          const revision = packs.confirmPreview(packId, input as unknown as Parameters<EnterprisePackStore['confirmPreview']>[1]);
          return { result: { pack: packs.get(packId), revision } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'reconcile') {
          const version = text(input.version, 50, false);
          const revision = packs.reconcileModuleReceipt(packId, version, input.receipt as Parameters<EnterprisePackStore['reconcileModuleReceipt']>[2]);
          return { result: { pack: packs.get(packId), revision } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'pin') {
          const pin = packs.pinTaskVersion(packId, input as unknown as Parameters<EnterprisePackStore['pinTaskVersion']>[1]);
          return { result: { pin, pack: packs.get(packId) } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'uses') {
          const use = packs.recordUse(packId, input as unknown as Parameters<EnterprisePackStore['recordUse']>[1]);
          return { result: { use, pack: packs.get(packId) } as unknown as Record<string, unknown>, systemId: currentPack.systemId };
        }
        if (action === 'feedback') {
          let reportPayload = input.report as Record<string, unknown> | undefined;
          if (object(input.origin)) {
            const origin = input.origin;
            const pid = uuid(origin.projectId), tid = uuid(origin.taskId);
            if (options.enterpriseScopes.enterpriseIdForProject(pid) !== currentPack.enterpriseId) throw new StudioError('studio_owner_mismatch', 403);
            const selection = { sessionId: text(origin.sessionId, 200, false), messageId: text(origin.messageId, 200, false) };
            const original = await options.readTaskReply(pid, tid, selection);
            const replySha = createHash('sha256').update(original.text).digest('hex');
            const pin = packs.getTaskPin(packId, pid, tid);
            const usedAssetRefs: StudioSourceRef[] = parseSources(input.usedAssetRefs ?? []);
            if (options.taskSnapshot) {
              try {
                const snap = await options.taskSnapshot(pid, tid);
                const idx = snap.messages.findIndex(m => m.role === 'assistant' && m.nativeSessionId === selection.sessionId && m.nativeEntryId === selection.messageId);
                if (idx >= 0) {
                  for (let at = idx - 1; at >= 0 && snap.messages[at]?.role !== 'user'; at--) {
                    const msg = snap.messages[at] as Record<string, any>;
                    if (msg.role === 'toolResult' && !msg.isError && msg.details?.type === 'optracall.studio' && ['read-source', 'read'].includes(msg.details.action) && msg.details.result?.ref) {
                      usedAssetRefs.push(sourceRef(msg.details.result.ref));
                    }
                  }
                }
              } catch { /* snapshot optional when origin verified via readTaskReply */ }
            }
            reportPayload = {
              projectId: pid,
              taskId: tid,
              sessionId: selection.sessionId,
              messageId: selection.messageId,
              reportRef: { authority: 'task', id: tid, projectId: pid, taskId: tid, version: replySha, sha256: replySha, locator: JSON.stringify({ kind: 'native-reply', ...selection }) },
              usedPackVersion: pin?.packVersion ?? (typeof input.packVersion === 'string' ? input.packVersion : '1.0'),
              usedAssetRefs,
              dataCutoffAt: pin?.dataCutoffAt ?? (typeof input.dataCutoffAt === 'string' ? input.dataCutoffAt : undefined),
              evidenceNote: text(input.evidenceNote ?? input.problem ?? '', 5000, false),
            };
          }
          if (!reportPayload) throw new StudioError('invalid_pack_feedback_report');
          const result = packs.submitFeedback(packId, {
            problemKey: text(input.problemKey ?? input.title, 200, false),
            packVersion: text(input.packVersion ?? (reportPayload.usedPackVersion as string) ?? '1.0', 50, false),
            purposeIds: Array.isArray(input.purposeIds) ? input.purposeIds.map(String) : [],
            title: text(input.title, 300, false),
            category: (input.category as Parameters<EnterprisePackStore['submitFeedback']>[1]['category']) ?? 'shared_refund_mapping',
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

    const useVerifyMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/uses\/([a-f0-9-]+)\/verify$/.exec(url.pathname);
    if (useVerifyMatch && request.method === 'POST') {
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
        const use = packs.verifyUse(useVerifyMatch[1]!, useVerifyMatch[2]!, input as unknown as Parameters<EnterprisePackStore['verifyUse']>[2]);
        return { result: { use, pack: packs.get(useVerifyMatch[1]!) } as unknown as Record<string, unknown> };
      }));
      json(response, receipt.statusCode || 200, receipt.result);
      return true;
    }

    const restrictRevMatch = /^\/api\/studio\/enterprise-packs\/([a-f0-9-]+)\/revisions\/([^/]+)\/restrict$/.exec(url.pathname);
    if (restrictRevMatch && request.method === 'POST') {
      const input = await options.readBody(request);
      const requestId = input.requestId === undefined ? randomUUID() : uuid(input.requestId);
      const receipt = await options.mutate(() => options.operations.run(requestId, { path: url.pathname, input }, async () => {
        if (options.closing()) throw new StudioError('host_closing', 503);
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
    authorizeProjectDataPath,
    assertProjectDataPathAllowed,
    buildPackCatalogSummary,
    handle,
  };
}
