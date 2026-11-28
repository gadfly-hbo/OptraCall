import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ExternalWorkStore } from '../external-work-store.ts';
import type { ExternalAssetRef, ExternalDeliveryFacts, ExternalDeliveryRef } from '../external-work-types.ts';
import { canonicalAssetRef, denied, assertArgsSize, denialResult, verifiedPrincipal, sha256Hex } from './intersection.ts';
import { validateDeliveryFacts, validateDeliveryManifest, parseDeliveryAssetsUsed } from '../external-delivery.ts';

/**
 * S3b 工作记录工具面（Issue #155 spec §6/§8 / AB06/AB11）：
 * `work.read/claim/renew/release/deliver` 接 S1 台账 CAS。
 *
 * - 认证 principal 只来自服务端核验（S3a authInfo）；自报 Agent 名称/taskId/claimId/工单 URL
 *   一律不是身份，GitHub 留言更不代替认证。
 * - claim 原子单领取（已发布且无未核外部动作的准确 workId/revision）；renew/release 核当前
 *   领取者/epoch/授权/时效；release 不证明真实操作已经结束。
 * - deliver 为 manifest-only 声明路径：核当前领取、输入工作版本与 manifest；幂等键同内容回
 *   原收据、异内容冲突；preservation 恒为 pending，永不冒充字节已验——字节保全走 S4a
 *   `delivery.begin/upload-chunk/commit`（同注入缝、同 Bearer）。迟到不变式已回并到 S1
 *   台账 `store.recordLateDelivery` 单一来源：旧 epoch/撤销后的历史已授权身份（同一核验
 *   principal）经台账提交隔离迟到证据，不覆盖当前交付、不恢复资产资格。
 * - 分片限额与 manifest/facts 校验复用 S4a 共享实现（spec §8：单请求参数 ≤1MiB、
 *   manifest ≤256KiB、≤20 文件/累计 100MiB、单文件 ≤50MiB）；路径由 Host 分配，不接受
 *   任意本机路径/任意 URL 下载。
 */

export interface WorkToolsOptions {
  store: ExternalWorkStore;
  now?: () => number;
  /** 服务策略可配（spec §9 默认：领取租约 15 分钟、每 5 分钟续租）。 */
  lease?: { claimMinutes?: number; renewMinutes?: number; maxMinutes?: number };
}

const DEFAULT_LEASE = { claimMinutes: 15, renewMinutes: 5, maxMinutes: 60 };
const RECEIPT_CLAIM = 'delivery-receipt-proves-recorded-facts-and-scope-only';

interface IdentityArgs { workId: string }
interface ClaimArgs extends IdentityArgs { revision?: number; leaseMinutes?: number; principal?: string }
interface LeaseArgs extends IdentityArgs { claimId: string; epoch: number; leaseMinutes?: number }
interface ReleaseArgs extends IdentityArgs { claimId: string; epoch: number; reason: string }
interface DeliverArgs extends IdentityArgs {
  revision: number;
  claimId: string;
  epoch: number;
  idempotencyKey: string;
  manifest: { files: Array<{ path: string; sha256: string; bytes: number }> };
  facts?: unknown;
  assetsUsed?: unknown;
}

function iso(ms: number): string { return new Date(ms).toISOString(); }

export function registerWorkTools(server: McpServer, options: WorkToolsOptions): void {
  const store = options.store;
  const now = options.now ?? Date.now;
  const lease = { ...DEFAULT_LEASE, ...options.lease };

  function leaseDeadline(minutes: unknown): string {
    if (!Number.isSafeInteger(minutes) || (minutes as number) < 1 || (minutes as number) > lease.maxMinutes) throw denied('external_work_lease_invalid', 400, `lease minutes must be between 1 and ${lease.maxMinutes}`);
    return iso(now() + (minutes as number) * 60_000);
  }

  server.registerTool('work.read', {
    description: '只列出当前服务端核验 principal 被明确允许的工作与非敏感说明；不暴露其他 Task/企业目录。',
    inputSchema: z.looseObject({}),
    annotations: { title: 'work.read', readOnlyHint: true },
  }, async (_rawArgs: unknown, extra: unknown) => {
    try {
      const principal = verifiedPrincipal(extra);
      assertArgsSize(_rawArgs, 1024 * 1024);
      const works = [];
      for (const work of await store.listWorks()) {
        if (work.status !== 'authorized') continue;
        const grant = await store.getGrant(work.grantId);
        if (!grant || grant.grantVersion !== work.grantVersion) continue;
        if (!grant.allowedExecutors.includes(principal)) continue;
        if (!(Date.parse(grant.validFrom) <= now() && now() < Date.parse(grant.validUntil))) continue;
        const publications = await store.listPublications(work.workId, work.revision);
        const succeeded = publications.some(item => item.status === 'succeeded');
        const unverified = publications.some(item => item.status === 'unknown');
        const active = (await store.listClaims(work.workId)).find(item => item.status === 'active' && item.revision === work.revision);
        works.push({
          workId: work.workId, revision: work.revision, summary: work.summary, deliveryCriteria: work.deliveryCriteria,
          goal: grant.goal, scope: grant.scope, forbidden: grant.forbidden,
          assetRefs: grant.assetRefs, repository: grant.repository, enterprise: grant.enterprise,
          validFrom: grant.validFrom, validUntil: grant.validUntil, targetExecutor: work.targetExecutor ?? null,
          publication: unverified ? 'unverified' : succeeded ? 'published' : 'pending',
          phase: active ? (active.principal === principal ? 'claimed-by-you' : 'claimed-elsewhere')
            : unverified ? 'awaiting-verification' : succeeded ? 'available' : 'awaiting-publication',
          mine: active?.principal === principal,
          leaseDeadline: active?.principal === principal ? active.leaseDeadline : null,
        });
      }
      return { structuredContent: { works, claim: RECEIPT_CLAIM }, content: [{ type: 'text', text: `ok: ${works.length} work(s)` }] };
    } catch (error) { return denialResult(error); }
  });

  server.registerTool('work.claim', {
    description: '对已发布且无未核外部动作的准确 workId/revision 原子领取；返回服务端 claim/epoch 与期限。',
    inputSchema: z.looseObject({ workId: z.string(), revision: z.number().int().optional(), leaseMinutes: z.number().int().optional(), principal: z.string().optional() }),
    annotations: { title: 'work.claim' },
  }, async (rawArgs: unknown, extra: unknown) => {
    try {
      const args = rawArgs as ClaimArgs;
      const principal = verifiedPrincipal(extra);
      assertArgsSize(args, 1024 * 1024);
      // args.principal 永不作为身份；仅防误解回显提示。
      const work = await store.getWork(args.workId);
      if (!work) throw denied('external_work_not_found', 404, 'no such work');
      if (work.status === 'cancelled') throw denied('external_work_cancelled', 409, 'the work has been cancelled');
      const revision = args.revision ?? work.revision;
      if (revision !== work.revision) throw denied('external_work_claim_stale_revision', 409, 'only the current work revision is claimable');
      const publications = await store.listPublications(work.workId, revision);
      if (publications.some(item => item.status === 'unknown')) throw denied('external_work_unverified_action', 409, 'an unverified external action must be reconciled before claiming');
      const deadline = leaseDeadline(args.leaseMinutes ?? lease.claimMinutes);
      const result = await store.recordClaim({ workId: work.workId, revision, principal, leaseDeadline: deadline });
      return {
        structuredContent: { kind: 'work-claim', claimId: result.claim.claimId, workId: result.claim.workId, revision: result.claim.revision, principal: result.claim.principal, epoch: result.claim.epoch, leaseDeadline: result.claim.leaseDeadline, idempotent: result.idempotent },
        content: [{ type: 'text', text: `ok: claim ${result.claim.claimId} epoch ${result.claim.epoch}` }],
      };
    } catch (error) { return denialResult(error); }
  });

  server.registerTool('work.renew', {
    description: '续租当前领取；核对当前领取者、epoch、授权及时效。',
    inputSchema: z.looseObject({ workId: z.string(), claimId: z.string(), epoch: z.number().int(), leaseMinutes: z.number().int().optional() }),
    annotations: { title: 'work.renew' },
  }, async (rawArgs: unknown, extra: unknown) => {
    try {
      const args = rawArgs as LeaseArgs;
      const principal = verifiedPrincipal(extra);
      assertArgsSize(args, 1024 * 1024);
      const claim = await store.getClaim(args.claimId);
      if (!claim || claim.workId !== args.workId) throw denied('external_work_claim_not_found', 404, 'no such claim for this work');
      if (claim.principal !== principal) throw denied('external_work_claim_not_owned', 403, 'only the current claimant may renew the lease');
      const deadline = leaseDeadline(args.leaseMinutes ?? lease.renewMinutes);
      const renewed = await store.renewClaim({ workId: claim.workId, revision: claim.revision, claimId: claim.claimId, epoch: args.epoch, leaseDeadline: deadline });
      return { structuredContent: { kind: 'work-renew', ...renewed }, content: [{ type: 'text', text: `ok: lease until ${renewed.leaseDeadline}` }] };
    } catch (error) { return denialResult(error); }
  });

  server.registerTool('work.release', {
    description: '释放当前领取；release 不证明真实操作已经结束。',
    inputSchema: z.looseObject({ workId: z.string(), claimId: z.string(), epoch: z.number().int(), reason: z.string() }),
    annotations: { title: 'work.release' },
  }, async (rawArgs: unknown, extra: unknown) => {
    try {
      const args = rawArgs as ReleaseArgs;
      const principal = verifiedPrincipal(extra);
      assertArgsSize(args, 1024 * 1024);
      const claim = await store.getClaim(args.claimId);
      if (!claim || claim.workId !== args.workId) throw denied('external_work_claim_not_found', 404, 'no such claim for this work');
      if (claim.principal !== principal) throw denied('external_work_claim_not_owned', 403, 'only the current claimant may release the lease');
      const released = await store.releaseClaim({ workId: claim.workId, revision: claim.revision, claimId: claim.claimId, epoch: args.epoch, reason: args.reason });
      return { structuredContent: { kind: 'work-release', ...released, note: 'release 仅释放领取；不证明真实操作已经结束。' }, content: [{ type: 'text', text: `ok: claim released` }] };
    } catch (error) { return denialResult(error); }
  });

  server.registerTool('work.deliver', {
    description: '有效交付（manifest-only 声明路径）：核当前领取/输入工作版本/manifest；幂等键同内容回原收据、异内容冲突；preservation=pending 永不冒充字节已验——字节保全走 delivery.begin/upload-chunk/commit。',
    inputSchema: z.looseObject({
      workId: z.string(), revision: z.number().int(), claimId: z.string(), epoch: z.number().int(),
      idempotencyKey: z.string(),
      manifest: z.looseObject({ files: z.array(z.looseObject({ path: z.string(), sha256: z.string(), bytes: z.number().int() })) }),
      assetsUsed: z.array(z.object({ authority: z.string(), id: z.string(), version: z.string(), hash: z.string() })).optional(),
    }),
    annotations: { title: 'work.deliver' },
  }, async (rawArgs: unknown, extra: unknown) => {
    try {
      const args = rawArgs as DeliverArgs;
      const principal = verifiedPrincipal(extra);
      assertArgsSize(args, 1024 * 1024);
      const facts = validateDeliveryFacts(args.facts);
      const { manifestHash } = validateDeliveryManifest(args.manifest, { extended: false });
      const assetsUsed = parseDeliveryAssetsUsed(args.assetsUsed);
      const claim = await store.getClaim(args.claimId);
      if (!claim || claim.workId !== args.workId || claim.revision !== args.revision) throw denied('external_delivery_claim_invalid', 409, 'the delivery must cite a real claim of this work revision');
      if (claim.principal !== principal) throw denied('external_work_claim_not_owned', 403, 'only the claimant may deliver; foreign material is never accepted via a borrowed claim id');
      const work = await store.getWork(args.workId);
      if (!work) throw denied('external_work_not_found', 404, 'no such work');
      if (assetsUsed.length) {
        const grant = await store.getGrant(work.grantId);
        const allow = new Set((grant?.assetRefs ?? []).map(canonicalAssetRef));
        if (assetsUsed.some(item => !allow.has(canonicalAssetRef(item)))) throw denied('external_delivery_asset_out_of_scope', 403, 'declared asset use exceeds the exact authorization allowlist');
      }
      if (claim.status === 'active') {
        if (claim.epoch !== args.epoch) throw denied('external_delivery_epoch_conflict', 409, 'the delivery epoch does not match the current lease');
        if (claim.revision !== work.revision) throw denied('external_work_claim_stale_revision', 409, 'an old-revision claim lost validity; claim the current revision');
        if (work.status === 'cancelled') throw denied('external_work_cancelled', 409, 'the work has been cancelled');
        const result = await store.recordDelivery({ workId: work.workId, revision: args.revision, claimId: claim.claimId, idempotencyKey: args.idempotencyKey, manifestHash, assetsUsed, facts, late: false });
        return {
          structuredContent: { kind: 'work-delivery', deliveryId: result.delivery.deliveryId, workId: result.delivery.workId, revision: result.delivery.revision, idempotencyKey: result.delivery.idempotencyKey, manifestHash: result.delivery.manifestHash, preservation: result.delivery.preservation, late: result.delivery.late, idempotent: result.idempotent, facts: result.delivery.facts, claim: RECEIPT_CLAIM },
          content: [{ type: 'text', text: `ok: delivery ${result.delivery.deliveryId}` }],
        };
      }
      // 旧 epoch/工作撤销后的历史已授权身份（同一核验 principal）→ 隔离迟到证据（台账单一不变式来源）。
      const late = await store.recordLateDelivery({ workId: work.workId, revision: args.revision, claimId: claim.claimId, idempotencyKey: args.idempotencyKey, manifestHash, assetsUsed, facts });
      return {
        structuredContent: { kind: 'work-delivery', deliveryId: late.delivery.deliveryId, workId: late.delivery.workId, revision: late.delivery.revision, idempotencyKey: late.delivery.idempotencyKey, manifestHash: late.delivery.manifestHash, preservation: late.delivery.preservation, late: late.delivery.late, idempotent: late.idempotent, facts: late.delivery.facts, claim: RECEIPT_CLAIM },
        content: [{ type: 'text', text: `ok: late evidence ${late.delivery.deliveryId} (isolated; never overrides the current delivery)` }],
      };
    } catch (error) { return denialResult(error); }
  });
}
