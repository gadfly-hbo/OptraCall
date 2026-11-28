import { createHash } from 'node:crypto';
import { ExternalMcpDenied } from './types.ts';
import type { ExternalWorkStore } from '../external-work-store.ts';
import type { Claim, ExternalAssetRef, ExternalWork, WorkGrant } from '../external-work-types.ts';
import { ExternalWorkError } from '../external-work-types.ts';

/**
 * S3b 资产只读交集（Issue #155 spec §7 / §11 AB07/AB08）。
 *
 * 每次目录/正文/来源/trace/分页均同时核对：可信 principal（服务端核验）∩ 有效 grant ∩
 * 有效 work/claim epoch ∩ 显式企业 ∩ 工作资产精确 allowlist ∩ 原项目/Studio 当前资格 ∩
 * 准确 authority/id/version/hash。实际调用前由 authorize() 核对；异步读取后/下一片发送前
 * 由 recheck() 复核当前资格——撤销/取消不返回尚未交付的迟到正文。未领取者一律拒绝
 * （不给元信息或正文）；旧项目无企业/legacy 默认放行不外露；版本缺失、hash 不符、资格撤回、
 * 工作过期分别明确拒绝，绝不落 latest。
 */

export type AssetQualificationVerdict = 'revoked' | 'missing' | 'hash-mismatch' | 'legacy-no-enterprise' | 'enterprise-mismatch';
export type AssetQualification = { ok: true } | { ok: false; reason: AssetQualificationVerdict };

/** 原项目/Studio 当前资格接缝（真实装配经 createSemanticContextReadPort / studio.port({analysisOnly:true}) 收窄，属 E07；本轮为注入回调）。 */
export type QualifyAsset = (input: { projectId: string; taskId: string; enterprise: string; ref: ExternalAssetRef }) => Promise<AssetQualification>;

export interface AssetReadRequest {
  principal: string;
  workId: string;
  claimId: string;
  epoch: number;
  /** 省略 = 目录范围（对整个 allowlist 核当前资格）；给出 = 精确 ref 读取。 */
  ref?: Partial<ExternalAssetRef>;
}

export interface AssetReadAuthorization {
  grant: WorkGrant;
  work: ExternalWork;
  claim: Claim;
  ref: ExternalAssetRef | null;
  /** 异步读取后、返回正文/下一片发送前复核当前资格；撤销/取消不得返回迟到正文。 */
  recheck(): Promise<void>;
}

export interface AssetIntersection {
  authorize(request: AssetReadRequest): Promise<AssetReadAuthorization>;
}

export interface AssetIntersectionOptions {
  store: ExternalWorkStore;
  qualify: QualifyAsset;
  now?: () => number;
}

const QUALIFICATION_DENIALS: Record<AssetQualificationVerdict, { code: string; status: number }> = {
  'revoked': { code: 'external_asset_qualification_revoked', status: 403 },
  'missing': { code: 'external_asset_source_missing', status: 404 },
  'hash-mismatch': { code: 'external_asset_source_hash_mismatch', status: 409 },
  'legacy-no-enterprise': { code: 'external_asset_legacy_not_exposed', status: 403 },
  'enterprise-mismatch': { code: 'external_asset_enterprise_mismatch', status: 403 },
};

export function canonicalAssetRef(ref: ExternalAssetRef): string {
  return `${ref.authority} ${ref.id} ${ref.version} ${ref.hash}`;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function denied(code: string, status: number, description: string): ExternalMcpDenied {
  return new ExternalMcpDenied(code, status, description);
}

/** 服务端核验的认证 principal（S3a authInfo）；自报名称一律拒绝。 */
export function verifiedPrincipal(extra: unknown): string {
  const authInfo = (extra as { authInfo?: { principal?: unknown; clientId?: unknown } } | undefined)?.authInfo;
  const principal = authInfo?.principal ?? authInfo?.clientId;
  if (typeof principal !== 'string' || !principal) throw denied('external_principal_unverified', 401, 'the server-verified bearer principal is required');
  return principal;
}

/** spec §8 单请求参数 ≤ 1 MiB；超限明确拒绝。 */
export function assertArgsSize(args: unknown, maxBytes = 1024 * 1024): void {
  if (Buffer.byteLength(JSON.stringify(args ?? {}), 'utf8') > maxBytes) throw denied('external_args_limit_exceeded', 413, 'request arguments exceed the 1MiB control-plane limit');
}

/** 工具层拒绝信封：明确 code，不携带任何正文或额外元信息；非拒绝错误原样上抛给 SDK。 */
export function denialResult(error: unknown): { isError: true; content: { type: 'text'; text: string }[]; structuredContent: { denied: string; message: string } } {
  const code = error instanceof ExternalMcpDenied ? error.code : error instanceof ExternalWorkError ? error.code : null;
  if (code === null) throw error;
  return { isError: true, content: [{ type: 'text', text: code }], structuredContent: { denied: code, message: error instanceof Error && error.message ? error.message : code } };
}

export function createAssetIntersection(options: AssetIntersectionOptions): AssetIntersection {
  const now = options.now ?? Date.now;
  const noClaim = () => denied('external_asset_no_claim', 403, 'asset reads require the current active claim of this verified principal');

  async function checkEligibility(workId: string, claimId: string, epoch: number, principal: string): Promise<{ grant: WorkGrant; work: ExternalWork; claim: Claim }> {
    const work = await options.store.getWork(workId);
    // 未知工作与未领取同样按“无资格”拒绝，不泄露工作存在性等元信息。
    if (!work) throw noClaim();
    const claim = await options.store.getClaim(claimId);
    if (!claim || claim.workId !== work.workId || claim.revision !== work.revision) throw noClaim();
    if (claim.principal !== principal) throw noClaim();
    if (claim.epoch !== epoch) throw denied('external_asset_claim_epoch_conflict', 409, 'the claim epoch does not match the current lease');
    if (work.status === 'cancelled') throw denied('external_asset_work_cancelled', 409, 'the work has been cancelled; authorization is withdrawn');
    if (claim.status !== 'active') throw noClaim();
    const grant = await options.store.getGrant(work.grantId);
    if (!grant || grant.grantVersion !== work.grantVersion || grant.projectId !== work.projectId || grant.taskId !== work.taskId) throw denied('external_asset_grant_missing', 403, 'the referenced authorization is not resolvable');
    if (!(Date.parse(grant.validFrom) <= now() && now() < Date.parse(grant.validUntil))) throw denied('external_asset_grant_not_valid', 409, 'the authorization window is not currently valid');
    if (Date.parse(claim.leaseDeadline) <= now()) throw denied('external_asset_claim_expired', 409, 'the claim lease has lapsed');
    return { grant, work, claim };
  }

  function resolveExactRef(input: Partial<ExternalAssetRef>, allowlist: readonly ExternalAssetRef[]): ExternalAssetRef {
    if (typeof input.authority !== 'string' || !input.authority || typeof input.id !== 'string' || !input.id) throw denied('external_asset_ref_incomplete', 400, 'authority and id are required for an exact asset read');
    const candidates = allowlist.filter(item => item.authority === input.authority && item.id === input.id);
    if (!candidates.length) throw denied('external_asset_not_allowlisted', 403, 'the requested asset is not on the exact allowlist of this authorization');
    if (typeof input.version !== 'string' || !input.version) throw denied('external_asset_version_required', 400, 'an exact version is required; this service never falls back to latest');
    const exact = candidates.find(item => item.version === input.version);
    if (!exact) throw denied('external_asset_version_missing', 404, 'the requested version is not authorized; this service never falls back to latest');
    if (typeof input.hash !== 'string' || !input.hash) throw denied('external_asset_hash_required', 400, 'an exact hash is required; this service never falls back to latest');
    if (exact.hash !== input.hash) throw denied('external_asset_hash_mismatch', 409, 'the requested hash differs from the authorized exact hash');
    return exact;
  }

  async function qualifyCurrent(grant: WorkGrant, work: ExternalWork, ref: ExternalAssetRef): Promise<void> {
    const verdict = await options.qualify({ projectId: work.projectId, taskId: work.taskId, enterprise: grant.enterprise, ref });
    if (!verdict.ok) {
      const denial = QUALIFICATION_DENIALS[verdict.reason];
      throw denied(denial.code, denial.status, 'the original project/Studio currently does not qualify this asset');
    }
  }

  return {
    async authorize(request: AssetReadRequest): Promise<AssetReadAuthorization> {
      const principal = typeof request.principal === 'string' && request.principal ? request.principal : (() => { throw denied('external_principal_unverified', 401, 'the server-verified bearer principal is required'); })();
      const eligibility = await checkEligibility(request.workId, request.claimId, request.epoch, principal);
      const exactRef = request.ref === undefined ? null : resolveExactRef(request.ref, eligibility.grant.assetRefs);
      // 目录范围：对整个精确 allowlist 逐一核当前资格；精确读取：核该 ref。
      for (const ref of exactRef === null ? eligibility.grant.assetRefs : [exactRef]) await qualifyCurrent(eligibility.grant, eligibility.work, ref);
      const recheck = async (): Promise<void> => {
        const fresh = await checkEligibility(request.workId, request.claimId, request.epoch, principal);
        for (const ref of exactRef === null ? fresh.grant.assetRefs : [exactRef]) await qualifyCurrent(fresh.grant, fresh.work, ref);
      };
      return { grant: eligibility.grant, work: eligibility.work, claim: eligibility.claim, ref: exactRef, recheck };
    },
  };
}
