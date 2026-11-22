import { studioRequest, StudioRequestError } from './studio-api.ts';
import type {
  DomainReferenceDomain,
  DomainReferenceRecord,
  DomainReferenceRegisterInput,
  EnterpriseDomainPack,
  EnterprisePackFeedback,
  EnterprisePackPreview,
  EnterprisePackPurpose,
  EnterprisePackRevision,
  EnterprisePackTaskPin,
  EnterprisePackUpgradeImpact,
  EnterprisePackUseRecord,
  ResourceAccessEvaluation,
  ResourceAccessQuery,
  ResourceAuthorizationGrant,
  ResourceGrantInput,
} from '../../../extensions/business-plugins/studio/enterprise-pack.ts';

export type {
  DomainReferenceRecord,
  EnterpriseDomainPack,
  EnterprisePackFeedback,
  EnterprisePackPreview,
  EnterprisePackPurpose,
  EnterprisePackRevision,
  EnterprisePackUseRecord,
  ResourceAuthorizationGrant,
};

export interface BuiltinTemplateSummary {
  sourceId: 'T01' | 'T02' | 'T03' | 'T04';
  version: string;
  title: string;
  domain: DomainReferenceDomain;
  locator: string;
}

export async function listDomainReferences(
  params?: { enterpriseId?: string; domain?: DomainReferenceDomain; sourceId?: string; query?: string },
  signal?: AbortSignal,
): Promise<{ references: DomainReferenceRecord[]; builtinTemplates: BuiltinTemplateSummary[]; readOnlyRollback?: boolean }> {
  const qs = new URLSearchParams();
  if (params?.enterpriseId) qs.set('enterpriseId', params.enterpriseId);
  if (params?.domain) qs.set('domain', params.domain);
  if (params?.sourceId) qs.set('sourceId', params.sourceId);
  if (params?.query) qs.set('query', params.query);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return studioRequest(`domain-references${suffix}`, 'GET', undefined, signal);
}

export async function registerDomainReference(
  input: DomainReferenceRegisterInput & { requestId: string },
): Promise<{ record: DomainReferenceRecord; outcome: 'created' | 'reused' | 'conflict' }> {
  return studioRequest('domain-references', 'POST', input);
}

export async function registerRepoTemplate(
  templateId: 'T01' | 'T02' | 'T03' | 'T04',
  requestId: string,
): Promise<{ record: DomainReferenceRecord; outcome: 'created' | 'reused' | 'conflict' }> {
  return studioRequest('domain-references/repo-template', 'POST', { requestId, templateId });
}

export async function readDomainReferenceOriginal(
  id: string,
  section?: string,
  enterpriseId?: string,
  signal?: AbortSignal,
): Promise<{
  record: DomainReferenceRecord;
  text: string;
  sha256: string;
  excerptSha256?: string;
  isExcerpt?: boolean;
  lineRange?: { start: number; end: number; total: number };
  matchedHeading?: string;
  sectionLocator?: string;
}> {
  const qs = new URLSearchParams();
  if (section) qs.set('section', section);
  if (enterpriseId) qs.set('enterpriseId', enterpriseId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return studioRequest(`domain-references/${encodeURIComponent(id)}/original${suffix}`, 'GET', undefined, signal);
}

export interface GrantAuthorityCredential {
  enterpriseId: string;
  systemId: string;
  ownerProjectId: string;
  ownerTaskId?: string;
  authorityToken: string;
}

export async function listResourceGrants(
  enterpriseId?: string,
  subjectId?: string,
  signal?: AbortSignal,
): Promise<{ grants: ResourceAuthorizationGrant[]; readOnlyRollback?: boolean }> {
  const qs = new URLSearchParams();
  if (enterpriseId) qs.set('enterpriseId', enterpriseId);
  if (subjectId) qs.set('subjectId', subjectId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return studioRequest(`resource-grants${suffix}`, 'GET', undefined, signal);
}

export async function createResourceGrant(
  input: Omit<ResourceGrantInput, 'grantor'> & {
    grantor?: string;
    grantorProjectId?: string;
    grantorSystemId?: string;
    grantorTaskId?: string;
    authorityToken?: string;
    requestId: string;
  },
): Promise<{ grant: ResourceAuthorizationGrant }> {
  return studioRequest('resource-grants', 'POST', input);
}

export async function revokeResourceGrant(
  grantId: string,
  reason: string,
  requestId: string,
  revokerProjectId?: string,
  authority?: { authorityToken?: string; revokerSystemId?: string; revokerTaskId?: string },
): Promise<{ grant: ResourceAuthorizationGrant }> {
  return studioRequest(`resource-grants/${encodeURIComponent(grantId)}/revoke`, 'POST', {
    requestId,
    reason,
    ...(revokerProjectId ? { revokerProjectId } : {}),
    ...(authority?.authorityToken ? { authorityToken: authority.authorityToken } : {}),
    ...(authority?.revokerSystemId ? { revokerSystemId: authority.revokerSystemId } : {}),
    ...(authority?.revokerTaskId ? { revokerTaskId: authority.revokerTaskId } : {}),
  });
}

export async function evaluateResourceAccessApi(
  input: ResourceAccessQuery & { enterpriseId: string; subjectId: string },
): Promise<{ evaluation: ResourceAccessEvaluation }> {
  return studioRequest('resource-grants/evaluate', 'POST', input);
}

export async function listEnterprisePacks(
  enterpriseId?: string,
  domain?: string,
  signal?: AbortSignal,
  projectId?: string,
): Promise<{ packs: EnterpriseDomainPack[]; readOnlyRollback: boolean; grantAuthority?: GrantAuthorityCredential }> {
  const qs = new URLSearchParams();
  if (enterpriseId) qs.set('enterpriseId', enterpriseId);
  if (domain) qs.set('domain', domain);
  if (projectId) qs.set('projectId', projectId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return studioRequest(`enterprise-packs${suffix}`, 'GET', undefined, signal);
}

export async function ensureEnterprisePack(input: {
  requestId: string;
  enterpriseId: string;
  systemId: string;
  projectId?: string;
  domain?: string;
  name?: string;
}): Promise<{ pack: EnterpriseDomainPack }> {
  return studioRequest('enterprise-packs', 'POST', input);
}

export async function readEnterprisePack(
  packId: string,
  projectId?: string,
  signal?: AbortSignal,
): Promise<{ pack: EnterpriseDomainPack; readOnlyRollback: boolean; grantAuthority?: GrantAuthorityCredential }> {
  const suffix = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}${suffix}`, 'GET', undefined, signal);
}

export async function savePackPanorama(packId: string, input: Record<string, unknown>): Promise<{ pack: EnterpriseDomainPack }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/panorama`, 'POST', input);
}

export async function selectPanoramaRecommendation(
  packId: string,
  input: { requestId: string; projectId?: string; purposeKey: string; selected: boolean; targetPurposeId?: string; scopeKey?: string; title?: string },
): Promise<{ pack: EnterpriseDomainPack }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/panorama-select`, 'POST', input);
}

export async function upsertPackEntry(packId: string, input: Record<string, unknown>): Promise<{ pack: EnterpriseDomainPack }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/entries`, 'POST', input);
}

export async function upsertPackPurpose(packId: string, input: Record<string, unknown>): Promise<{ pack: EnterpriseDomainPack; purpose: EnterprisePackPurpose; created: boolean }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/purposes`, 'POST', input);
}

export async function preparePackPreview(packId: string, input: Record<string, unknown>): Promise<{ pack: EnterpriseDomainPack; preview: EnterprisePackPreview }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/previews`, 'POST', input);
}

export async function confirmPackPreview(packId: string, input: {
  requestId: string;
  projectId?: string;
  previewId: string;
  fingerprint: string;
  confirmedBy?: string;
}): Promise<{ pack: EnterpriseDomainPack; revision: EnterprisePackRevision }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/confirm`, 'POST', input);
}

export async function reconcilePackReceipt(packId: string, input: {
  requestId: string;
  projectId?: string;
  version: string;
  targetRequestId: string;
}): Promise<{ pack: EnterpriseDomainPack; revision: EnterprisePackRevision }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/reconcile`, 'POST', input);
}

export async function pinPackTaskVersion(packId: string, input: Record<string, unknown>): Promise<{ pin: EnterprisePackTaskPin; pack: EnterpriseDomainPack }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/pin`, 'POST', input);
}

export async function recordPackUse(packId: string, input: Record<string, unknown>): Promise<{ use: EnterprisePackUseRecord; pack: EnterpriseDomainPack }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/uses`, 'POST', input);
}

export async function verifyPackUse(packId: string, useId: string, input: Record<string, unknown>): Promise<{ use: EnterprisePackUseRecord; pack: EnterpriseDomainPack }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/uses/${encodeURIComponent(useId)}/verify`, 'POST', input);
}

export async function submitPackFeedback(packId: string, input: Record<string, unknown>): Promise<{ pack: EnterpriseDomainPack; feedback: EnterprisePackFeedback; created: boolean }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/feedback`, 'POST', input);
}

export async function handlePackFeedback(packId: string, feedbackId: string, input: Record<string, unknown>): Promise<{ pack: EnterpriseDomainPack; feedback: EnterprisePackFeedback }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/feedback/${encodeURIComponent(feedbackId)}/handle`, 'POST', input);
}

export async function recordPackUpgradeImpact(packId: string, input: Record<string, unknown>): Promise<{ impact: EnterprisePackUpgradeImpact; pack: EnterpriseDomainPack }> {
  return studioRequest(`enterprise-packs/${encodeURIComponent(packId)}/upgrade-impact`, 'POST', input);
}

export { StudioRequestError };
