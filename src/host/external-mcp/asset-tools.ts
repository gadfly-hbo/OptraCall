import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ExternalAssetRef } from '../external-work-types.ts';
import { canonicalAssetRef, denied, assertArgsSize, denialResult, verifiedPrincipal } from './intersection.ts';
import type { AssetIntersection, AssetIntersectionOptions } from './intersection.ts';

/**
 * S3b 资产只读工具面（Issue #155 spec §7 / AB08/AB10）：`asset.catalog/read/read-source/trace`。
 *
 * - 白名单子集，永不含 reason/pack-read/写图/修订/发布/任意代码 SQL；工具经同一 S3a
 *   Bearer/白名单/管理面守卫接入，合法读取不逐条审批（交集裁定自动完成）。
 * - `OriginalAssetReader` 为包注入接缝：代表原实例 createSemanticContextReadPort /
 *   studio.port({analysisOnly:true}) 的收窄只读；本轮测试用合成实现，真实 Studio 装配属 E07。
 * - 每工具先经 intersection 复核（调用前），异步读取后/返回前再次 recheck；返回保留准确
 *   authority/id/version/hash/来源/限制；读取回执只证交付内容与范围，不证专业正确。
 * - 分片限额（spec §8）：单请求参数 ≤1MiB、原始片段 ≤512KiB；超限明确拒绝或分页。
 */

export interface AssetToolsOptions {
  intersection: AssetIntersection;
  reader: OriginalAssetReader;
  now?: () => number;
  limits?: { maxArgsBytes?: number; maxFragmentBytes?: number };
}

/** 原实例收窄读取接缝（本轮合成实现；真实装配经原 Host-bound port，属 E07）。 */
export interface OriginalAssetReader {
  catalog(refs: readonly ExternalAssetRef[]): Promise<Array<{ ref: ExternalAssetRef; title: string; applicability: string; sha256: string; source: string }>>;
  read(ref: ExternalAssetRef): Promise<{ title: string; body: string; sha256: string; source: string; limitations: string[] }>;
  readSource(ref: ExternalAssetRef, location?: { start: number; end: number }): Promise<{ title: string; fragment: string; sha256: string; locator: string; source: string; limitations: string[] }>;
  trace(ref: ExternalAssetRef): Promise<Array<{ relation: string; target: ExternalAssetRef }>>;
}

const RECEIPT_CLAIM = '读取回执只证交付内容与范围，不证专业正确';
const DEFAULT_MAX_ARGS_BYTES = 1024 * 1024;
const DEFAULT_MAX_FRAGMENT_BYTES = 512 * 1024;

const refSchema = z.object({
  authority: z.string(),
  id: z.string(),
  version: z.string().optional(),
  hash: z.string().optional(),
});
const identitySchema = { workId: z.string(), claimId: z.string(), epoch: z.number().int() };

interface IdentityArgs { workId: string; claimId: string; epoch: number }
interface ReadArgs extends IdentityArgs { ref: Partial<ExternalAssetRef>; offset?: number; bytes?: number }
interface ReadSourceArgs extends IdentityArgs { ref: Partial<ExternalAssetRef>; location?: { start: number; end: number } }
interface TraceArgs extends IdentityArgs { ref: Partial<ExternalAssetRef> }

/** 按 UTF-16 码元分页，字节预算在实切片上复核；超出预算收缩到合法页。 */
function pageSlice(body: string, offset: number, maxBytes: number): { text: string; bytes: number; nextOffset: number | null } {
  const total = body.length;
  if (offset > total) throw denied('external_asset_offset_out_of_range', 400, 'the requested page offset is beyond the exact content');
  if (offset === total) return { text: '', bytes: 0, nextOffset: null };
  let end = Math.min(offset + maxBytes, total);
  let text = body.slice(offset, end);
  let bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) {
    end = Math.max(offset + 1, end - (bytes - maxBytes));
    text = body.slice(offset, end);
    bytes = Buffer.byteLength(text, 'utf8');
    while (bytes > maxBytes && end > offset + 1) {
      end -= 1;
      text = body.slice(offset, end);
      bytes = Buffer.byteLength(text, 'utf8');
    }
    if (bytes > maxBytes) throw denied('external_asset_fragment_limit', 413, 'the exact fragment exceeds the 512KiB slice ceiling');
  }
  return { text, bytes, nextOffset: end < total ? end : null };
}

function receipt(scope: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { kind: 'asset-read', scope, claim: RECEIPT_CLAIM, ...extra };
}

function textResult(payload: Record<string, unknown>): { structuredContent: Record<string, unknown>; content: { type: 'text'; text: string }[] } {
  return { structuredContent: payload, content: [{ type: 'text', text: `ok: ${String(payload.kind ?? 'asset-read')}` }] };
}

export function registerAssetTools(server: McpServer, options: AssetToolsOptions): void {
  const maxArgsBytes = options.limits?.maxArgsBytes ?? DEFAULT_MAX_ARGS_BYTES;
  const maxFragmentBytes = options.limits?.maxFragmentBytes ?? DEFAULT_MAX_FRAGMENT_BYTES;
  const intersection: AssetIntersection = options.intersection;

  server.registerTool('asset.catalog', {
    description: '查获准资产目录和适用条件；仅返回当前授权 allowlist 内的精确条目，目录元数据先筛选后返回。',
    inputSchema: z.looseObject({ ...identitySchema }),
    annotations: { title: 'asset.catalog', readOnlyHint: true },
  }, async (rawArgs: unknown, extra: unknown) => {
    try {
      const args = rawArgs as IdentityArgs;
      const principal = verifiedPrincipal(extra);
      assertArgsSize(args, maxArgsBytes);
      const authz = await intersection.authorize({ principal, workId: args.workId, claimId: args.claimId, epoch: args.epoch });
      const listed = await options.reader.catalog(authz.grant.assetRefs);
      // 先筛选后返回：仅 (authority,id,version) 命中 allowlist 的条目；hash 不符显式标记，绝不回退 latest。
      const byKey = new Map(authz.grant.assetRefs.map(item => [`${item.authority} ${item.id} ${item.version}`, item]));
      const entries = [];
      for (const entry of listed) {
        const allowed = byKey.get(`${entry.ref.authority} ${entry.ref.id} ${entry.ref.version}`);
        if (!allowed) continue;
        entries.push({ ref: allowed, title: entry.title, applicability: entry.applicability, source: entry.source, state: entry.sha256 === allowed.hash ? 'available' : 'hash-conflict' });
      }
      await authz.recheck();
      return textResult({ kind: 'asset-catalog', workId: args.workId, entries, receipt: receipt('exact-allowlist-directory', { deliveredEntries: entries.length }) });
    } catch (error) { return denialResult(error); }
  });

  server.registerTool('asset.read', {
    description: '按精确 authority/id/version/hash 读取已发布语义/指标/方法正文；片段 ≤512KiB，超限分页；绝不回退 latest。',
    inputSchema: z.looseObject({ ...identitySchema, ref: refSchema, offset: z.number().int().min(0).optional(), bytes: z.number().int().min(1).optional() }),
    annotations: { title: 'asset.read', readOnlyHint: true },
  }, async (rawArgs: unknown, extra: unknown) => {
    try {
      const args = rawArgs as ReadArgs;
      const principal = verifiedPrincipal(extra);
      assertArgsSize(args, maxArgsBytes);
      const authz = await intersection.authorize({ principal, workId: args.workId, claimId: args.claimId, epoch: args.epoch, ref: args.ref });
      if (!authz.ref) throw denied('external_asset_ref_required', 400, 'asset.read requires an exact ref');
      const body = await options.reader.read(authz.ref);
      if (body.sha256 !== authz.ref.hash) throw denied('external_asset_hash_mismatch', 409, 'the original content no longer matches the exact authorized hash');
      await authz.recheck();
      if (args.bytes !== undefined && args.bytes > maxFragmentBytes) throw denied('external_asset_fragment_limit', 413, 'a single read may return at most 512KiB; paginate with offset');
      const totalBytes = Buffer.byteLength(body.body, 'utf8');
      const page = pageSlice(body.body, args.offset ?? 0, Math.min(args.bytes ?? maxFragmentBytes, maxFragmentBytes));
      const payload: Record<string, unknown> = {
        kind: 'asset-read', ref: authz.ref, title: body.title, source: body.source, limitations: body.limitations,
        sha256: body.sha256, totalBytes, offset: args.offset ?? 0, bytes: page.bytes, text: page.text,
        nextOffset: page.nextOffset, truncated: page.nextOffset !== null,
        receipt: receipt('exact-ref-read', { deliveredBytes: page.bytes }),
      };
      return textResult(payload);
    } catch (error) { return denialResult(error); }
  });

  server.registerTool('asset.read-source', {
    description: '取获准来源的准确片段、版本/hash/位置；片段 ≤512KiB，超限明确拒绝。',
    inputSchema: z.looseObject({ ...identitySchema, ref: refSchema, location: z.object({ start: z.number().int().min(0), end: z.number().int().min(1) }).optional() }),
    annotations: { title: 'asset.read-source', readOnlyHint: true },
  }, async (rawArgs: unknown, extra: unknown) => {
    try {
      const args = rawArgs as ReadSourceArgs;
      const principal = verifiedPrincipal(extra);
      assertArgsSize(args, maxArgsBytes);
      if (args.location !== undefined && args.location.end <= args.location.start) throw denied('external_asset_location_invalid', 400, 'the requested source location is empty');
      const authz = await intersection.authorize({ principal, workId: args.workId, claimId: args.claimId, epoch: args.epoch, ref: args.ref });
      if (!authz.ref) throw denied('external_asset_ref_required', 400, 'asset.read-source requires an exact ref');
      const source = await options.reader.readSource(authz.ref, args.location);
      if (Buffer.byteLength(source.fragment, 'utf8') > maxFragmentBytes) throw denied('external_asset_fragment_limit', 413, 'the source fragment exceeds the 512KiB ceiling');
      if (source.sha256 !== authz.ref.hash) throw denied('external_asset_hash_mismatch', 409, 'the original source no longer matches the exact authorized hash');
      await authz.recheck();
      const payload: Record<string, unknown> = {
        kind: 'asset-read-source', ref: authz.ref, title: source.title, source: source.source, locator: source.locator,
        sha256: source.sha256, limitations: source.limitations, fragment: source.fragment,
        bytes: Buffer.byteLength(source.fragment, 'utf8'),
        receipt: receipt('exact-source-fragment', { locator: source.locator }),
      };
      return textResult(payload);
    } catch (error) { return denialResult(error); }
  });

  server.registerTool('asset.trace', {
    description: '关系查询和 trace 仅在已授权 refs 范围内展开；范围外目标在返回前丢弃，不泄露。',
    inputSchema: z.looseObject({ ...identitySchema, ref: refSchema }),
    annotations: { title: 'asset.trace', readOnlyHint: true },
  }, async (rawArgs: unknown, extra: unknown) => {
    try {
      const args = rawArgs as TraceArgs;
      const principal = verifiedPrincipal(extra);
      assertArgsSize(args, maxArgsBytes);
      const authz = await intersection.authorize({ principal, workId: args.workId, claimId: args.claimId, epoch: args.epoch, ref: args.ref });
      if (!authz.ref) throw denied('external_asset_ref_required', 400, 'asset.trace requires an exact ref');
      const relations = await options.reader.trace(authz.ref);
      const allowSet = new Set(authz.grant.assetRefs.map(canonicalAssetRef));
      const scoped = relations.filter(item => allowSet.has(canonicalAssetRef(item.target)));
      await authz.recheck();
      const payload: Record<string, unknown> = {
        kind: 'asset-trace', ref: authz.ref, relations: scoped,
        receipt: receipt('trace-within-authorized-refs', { deliveredRelations: scoped.length }),
      };
      return textResult(payload);
    } catch (error) { return denialResult(error); }
  });
}

export type { AssetIntersectionOptions };
