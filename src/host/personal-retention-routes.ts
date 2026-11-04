import type { IncomingMessage, ServerResponse } from 'node:http';
import { PersonalRetentionStore, PersonalRetentionFault } from './personal-retention-store.ts';
import { PersonalSourceError } from './personal-retention-sources.ts';
import { learningSourceRef } from './learning-source-validation.ts';
import { EnterpriseMaterialsError, enterpriseDraftSha256, type EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import type { ReadPersonalSource, RetainPersonalInput, SavePersonalDraftInput, PersonalStateInput } from './personal-retention-types.ts';
import type { PersonalLookupInput, PersonalLookupResult } from './personal-retention-lookup.ts';

type Options = {
  request: IncomingMessage; response: ServerResponse; url: URL; store: PersonalRetentionStore;
  materials: EnterpriseMaterialsStore;
  lookup: (input: PersonalLookupInput) => Promise<PersonalLookupResult>; readSource: ReadPersonalSource;
  readBody: (request: IncomingMessage, limit?: number) => Promise<Record<string, unknown>>;
  mutate: <T>(operation: () => T | Promise<T>) => Promise<T>; isClosing: () => boolean;
};
const send = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(value));
};
const messages: Record<string, string> = {
  personal_revision_conflict: '这份个人条目已变化，请核对版本；当前输入保留，未自动覆盖。',
  personal_operation_conflict: '同一操作标识已绑定另一份完整请求，请先核对原操作结果。',
  personal_pending_conflict: '此条目有待完成保留，请核对同一请求或明确结束；旧保留版仍在。',
  personal_item_in_flight: '此条目的保存仍在核定中，请稍后明确回查；其他条目可以继续使用。',
  personal_content_conflict: '准确内容已变化或与预览身份不符，未保留另一份草稿；原输入与旧保留版保持。',
  personal_records_missing: '个人记录文件缺失，当前无法核对保留历史；未重建空库，原资料与正文保持。',
  invalid_personal_lookup_query: '查找词最多200个UTF-16字符，请缩短后重试。',
  personal_retention_host_closing: '本地服务正在关闭，请保留输入并核对原操作结果。',
};
function flag(url: URL, key: string) {
  const value = url.searchParams.get(key);
  if (value !== null && value !== 'true' && value !== 'false') throw new PersonalRetentionFault('invalid_personal_lookup', 400);
  return value === 'true';
}
function integer(url: URL, key: string, fallback: number) {
  const value = url.searchParams.get(key);
  if (value !== null && !/^[1-9][0-9]*$/.test(value)) throw new PersonalRetentionFault('invalid_personal_lookup', 400);
  return value === null ? fallback : Number(value);
}

/** User-controlled material management only; no Agent lifecycle, model or task injection. */
export async function handlePersonalRetentionRoute(options: Options): Promise<boolean> {
  const prefix = '/api/personal-retention', { request, response, url, store } = options;
  if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return false;
  const method = request.method ?? 'GET';
  const write = <T>(operation: () => Promise<T>) => options.mutate(() => {
    if (options.isClosing()) throw new PersonalRetentionFault('personal_retention_host_closing', 503);
    return operation();
  });
  try {
    if (url.pathname === prefix + '/lookup' && method === 'GET') {
      const allowed = ['query', 'category', 'includeBody', 'includeDrafts', 'includeArchived', 'page', 'pageSize'];
      if ([...url.searchParams.keys()].some(key => !allowed.includes(key)) || allowed.some(key => url.searchParams.getAll(key).length > 1)) throw new PersonalRetentionFault('invalid_personal_lookup', 400);
      const input = { query: url.searchParams.get('query') ?? '', category: url.searchParams.get('category') ?? 'all', includeBody: flag(url, 'includeBody'), includeDrafts: flag(url, 'includeDrafts'), includeArchived: flag(url, 'includeArchived'), page: integer(url, 'page', 1), pageSize: integer(url, 'pageSize', 20) };
      send(response, 200, await options.lookup(input as PersonalLookupInput)); return true;
    }
    if (url.pathname === prefix + '/sources/read' && method === 'POST') {
      const input = await options.readBody(request, 131_072);
      if (Object.keys(input).length !== 1 || !('ref' in input)) throw new PersonalRetentionFault('invalid_personal_retention_fields');
      send(response, 200, await options.readSource(learningSourceRef(input.ref))); return true;
    }
    const match = /^\/api\/personal-retention\/items\/([^/]+)(?:\/(draft|retain|archive|restore|end-pending|operations|editor)(?:\/([^/]+))?)?$/.exec(url.pathname);
    if (match) {
      const materialId = match[1]!, action = match[2], operationId = match[3];
      if (action === 'editor' && !operationId && method === 'GET') {
        const result = await options.materials.get(materialId);
        send(response, 200, { ...result, draftTarget: { type: 'draft', expectedMaterialVersion: result.material.version, expectedDraftSha256: enterpriseDraftSha256(result.material.draft) } }); return true;
      }
      if (!action && method === 'GET') {
        const decisionId = url.searchParams.get('decisionId');
        if ([...url.searchParams.keys()].some(key => key !== 'decisionId') || url.searchParams.getAll('decisionId').length > 1) throw new PersonalRetentionFault('invalid_personal_retention_fields');
        const item = await store.getItem(materialId);
        const index = await options.materials.referenceIndex(), material = index.materials.find(value => value.materialId === materialId);
        const materialState = material ? { materialId, enabled: material.enabled } : null;
        send(response, 200, { ...(item ? await store.readItem(materialId, decisionId ?? undefined) : { item: null, decision: null, content: null }), materialState }); return true;
      }
      if (action === 'operations' && operationId && method === 'GET') {
        const result = await options.mutate(async () => {
          const item = await store.getItem(materialId);
          const decision = item?.decisions.find(value => value.operationId === operationId) ?? null;
          const termination = item?.terminations.find(value => value.operationId === operationId) ?? null;
          const pending = item?.pending?.operationId === operationId ? item.pending : null;
          return { state: decision ? 'committed' : termination ? 'ended' : pending ? 'pending' : 'not-found', item, decision, termination, pending };
        });
        send(response, 200, result); return true;
      }
      if (action && !operationId && action !== 'operations' && action !== 'editor' && method === 'POST') {
        const input = await options.readBody(request, 2_097_152);
        if (action === 'draft') { send(response, 200, { item: await write(() => store.saveDraftMeta(materialId, input as SavePersonalDraftInput)) }); return true; }
        if (action === 'end-pending') {
          if (Object.keys(input).some(key => !['operationId', 'request'].includes(key)) || typeof input.operationId !== 'string') throw new PersonalRetentionFault('invalid_personal_retention_fields');
          send(response, 200, await write(() => store.endPending(materialId, input.operationId as string, input.request as RetainPersonalInput | undefined))); return true;
        }
        const result = action === 'retain' ? await write(() => store.retain(materialId, input as RetainPersonalInput))
          : action === 'archive' ? await write(() => store.archive(materialId, input as PersonalStateInput))
          : await write(() => store.restore(materialId, input as PersonalStateInput));
        send(response, result.replayed ? 200 : 201, result); return true;
      }
    }
    send(response, 404, { code: 'personal_retention_not_found', message: '未找到该个人资料操作。' }); return true;
  } catch (error) {
    const known = error instanceof PersonalRetentionFault || error instanceof PersonalSourceError || error instanceof EnterpriseMaterialsError;
    if (!known && typeof (error as { code?: unknown })?.code === 'string' && typeof (error as { status?: unknown })?.status === 'number') throw error;
    const code = known ? error.code : 'personal_retention_unavailable', status = known ? error.status : 503;
    const message = messages[code] ?? (/missing|not_found/.test(code) ? '指定条目或精确来源缺失／不存在，原引用保持；未改用当前同名内容。'
      : /source_changed|text_changed|corrupt|hash_mismatch/.test(code) ? '精确来源内容与保存身份不符，可能已变化或损坏；原引用保持，未改用最新版。'
      : /mismatch/.test(code) ? '精确来源的归属或身份不符，未绑定到其他项目／修订；原引用保持。'
      : '个人资料或精确来源未能核对；请保留输入与原操作标识，不会自动改用最新版本或重放。');
    send(response, status, { code, message }); return true;
  }
}
