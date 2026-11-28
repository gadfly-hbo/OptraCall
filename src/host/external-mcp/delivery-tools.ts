import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EXTERNAL_DELIVERY_LIMITS, ExternalDeliveryPreservation } from '../external-delivery.ts';
import type { ExternalDeliveryRef } from '../external-work-types.ts';
import type { ExternalWorkStore } from '../external-work-store.ts';
import { assertArgsSize, denialResult, verifiedPrincipal } from './intersection.ts';

/**
 * S4a MCP 上传工具面（Issue #155 spec §8 / AB11）：`delivery.begin` /
 * `delivery.upload-chunk` / `delivery.commit` 经 S3a `registerTools` 注入缝注册，
 * 自动处于同一 Bearer/路径白名单/限流之下；接入 ExternalDeliveryPreservation 保全服务。
 *
 * 认证 principal 只来自服务端核验（S3a authInfo）；单请求参数 ≤1MiB；工具层不携带任何
 * 正文字节以外的持久状态——会话/分片/台账全部由 Host 保全服务与 S1 台账管理。
 */

export interface DeliveryToolsOptions {
  store: ExternalWorkStore;
  /** dataRoot：Host 在其下分配 external-delivery 存储路径（非 native 060_reports）。 */
  dataRoot: string;
  now?: () => number;
  readGithubBlob?: import('../external-delivery.ts').GithubBlobReader;
}

const RECEIPT_CLAIM = 'delivery-receipt-proves-recorded-facts-and-scope-only';

export function registerDeliveryTools(server: McpServer, options: DeliveryToolsOptions): void {
  const preservation = new ExternalDeliveryPreservation({ store: options.store, dataRoot: options.dataRoot, now: options.now, readGithubBlob: options.readGithubBlob });

  server.registerTool('delivery.begin', {
    description: '为单个文件开启 Host 分配的分块上传会话（≤50MiB，512KiB/片）；核当前领取/授权；同一文件同内容回原会话，异内容冲突。',
    inputSchema: z.looseObject({ workId: z.string(), claimId: z.string(), epoch: z.number().int(), fileName: z.string(), totalBytes: z.number().int(), sha256: z.string() }),
    annotations: { title: 'delivery.begin' },
  }, async (rawArgs: unknown, extra: unknown) => {
    try {
      const args = rawArgs as { workId: string; claimId: string; epoch: number; fileName: string; totalBytes: number; sha256: string };
      const principal = verifiedPrincipal(extra);
      assertArgsSize(args, EXTERNAL_DELIVERY_LIMITS.maxArgsBytes);
      const began = await preservation.beginFile({ workId: args.workId, claimId: args.claimId, epoch: args.epoch, principal, logicalPath: args.fileName, totalBytes: args.totalBytes, sha256: args.sha256 });
      return {
        structuredContent: { kind: 'delivery-upload', uploadId: began.uploadId, chunkBytes: began.chunkBytes, totalChunks: began.totalChunks, idempotent: began.idempotent, claim: RECEIPT_CLAIM },
        content: [{ type: 'text', text: `ok: upload session ${began.uploadId}` }],
      };
    } catch (error) { return denialResult(error); }
  });

  server.registerTool('delivery.upload-chunk', {
    description: '向已开启会话写入一个 ≤512KiB 的 base64 分片（偏移按 512KiB 对齐）；每次写前核当前领取/授权；同偏移同内容回原收据，异内容冲突。',
    inputSchema: z.looseObject({ workId: z.string(), claimId: z.string(), epoch: z.number().int(), uploadId: z.string(), offset: z.number().int(), sha256: z.string(), bytesBase64: z.string() }),
    annotations: { title: 'delivery.upload-chunk' },
  }, async (rawArgs: unknown, extra: unknown) => {
    try {
      const args = rawArgs as { workId: string; claimId: string; epoch: number; uploadId: string; offset: number; sha256: string; bytesBase64: string };
      const principal = verifiedPrincipal(extra);
      assertArgsSize(args, EXTERNAL_DELIVERY_LIMITS.maxArgsBytes);
      const chunk = await preservation.writeChunk({ uploadId: args.uploadId, workId: args.workId, claimId: args.claimId, epoch: args.epoch, principal, offset: args.offset, sha256: args.sha256, bytesBase64: args.bytesBase64 });
      return {
        structuredContent: { kind: 'delivery-chunk', uploadId: chunk.uploadId, offset: chunk.offset, received: true, idempotent: chunk.idempotent, claim: RECEIPT_CLAIM },
        content: [{ type: 'text', text: `ok: chunk @${chunk.offset}` }],
      };
    } catch (error) { return denialResult(error); }
  });

  server.registerTool('delivery.commit', {
    description: '提交交付：完整 manifest（uploadId 字节 / 精确 GitHub blob / 仅链接）＋必报 facts；全量校验后原子保全并落独立 ExternalDeliveryRef；幂等键同内容回原收据、异内容冲突；缺件/过期领取不标完整。',
    inputSchema: z.looseObject({
      workId: z.string(), revision: z.number().int(), claimId: z.string(), epoch: z.number().int(), idempotencyKey: z.string(),
      manifest: z.looseObject({ files: z.array(z.looseObject({
        path: z.string(), sha256: z.string().optional(), bytes: z.number().int().optional(),
        uploadId: z.string().optional(),
        blob: z.looseObject({ repo: z.string(), commit: z.string(), blobPath: z.string() }).optional(),
        link: z.string().optional(),
      })) }),
      facts: z.looseObject({ done: z.array(z.string()), notDone: z.array(z.string()), failed: z.array(z.string()), unknown: z.array(z.string()) }).optional(),
      assetsUsed: z.array(z.object({ authority: z.string(), id: z.string(), version: z.string(), hash: z.string() })).optional(),
    }),
    annotations: { title: 'delivery.commit' },
  }, async (rawArgs: unknown, extra: unknown) => {
    try {
      const args = rawArgs as {
        workId: string; revision: number; claimId: string; epoch: number; idempotencyKey: string;
        manifest: unknown; facts?: unknown; assetsUsed?: unknown;
      };
      const principal = verifiedPrincipal(extra);
      assertArgsSize(args, EXTERNAL_DELIVERY_LIMITS.maxArgsBytes);
      const committed = await preservation.commit({
        workId: args.workId, revision: args.revision, claimId: args.claimId, epoch: args.epoch, principal,
        idempotencyKey: args.idempotencyKey, manifest: args.manifest, facts: args.facts, assetsUsed: args.assetsUsed,
      });
      const delivery = committed.delivery as ExternalDeliveryRef;
      return {
        structuredContent: {
          kind: 'external-delivery', deliveryId: delivery.deliveryId, workId: delivery.workId, revision: delivery.revision,
          idempotencyKey: delivery.idempotencyKey, manifestHash: delivery.manifestHash, preservation: delivery.preservation,
          storage: delivery.storage, links: delivery.links, preservationReason: delivery.preservationReason,
          late: delivery.late, idempotent: committed.idempotent, facts: delivery.facts, claim: RECEIPT_CLAIM,
        },
        content: [{ type: 'text', text: committed.late ? `ok: late evidence ${delivery.deliveryId} (isolated; never overrides the current delivery)` : `ok: delivery ${delivery.deliveryId} preserved as ${delivery.preservation}` }],
      };
    } catch (error) { return denialResult(error); }
  });
}
