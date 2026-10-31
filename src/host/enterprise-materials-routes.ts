import type { IncomingMessage, ServerResponse } from 'node:http';
import { CaseStoreError, type CaseStore } from './case-store.ts';
import { EnterpriseMaterialsError, EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import type { EnterpriseCaseContextInput, EnterpriseMaterialFields } from './enterprise-materials-types.ts';

export type EnterpriseMaterialsRouteOptions = {
  request: IncomingMessage; response: ServerResponse; url: URL; store: EnterpriseMaterialsStore; cases: CaseStore;
  mutate?: <T>(operation: () => T | Promise<T>) => Promise<T>;
};

const messages: Record<string, string> = {
  enterprise_title_required: '请填写资料标题。', enterprise_content_required: '启用需要正文或一个已保存的来源文件。',
  enterprise_version_conflict: '资料已变化，请重新读取后再保存；当前输入未覆盖新稿。',
  enterprise_case_version_conflict: '本案资料已变化，请重新读取后再保存。',
  enterprise_case_store_mismatch: 'Case 或企业资料库身份已变化，未自动重新关联。',
  enterprise_material_disabled: '资料已停用，不能新增选用；既有历史仍可回读。',
  enterprise_source_not_utf8: '文件不是可读取的 UTF-8 文本，可改为仅登记原件。',
  enterprise_source_changed: '保存的来源字节已变化，未替换为其他版本。',
  enterprise_source_missing: '保存的来源文件缺失，未替换为最新版。',
  enterprise_case_closed: '已关闭 Case 的资料只读。',
  enterprise_case_revision_conflict: 'Case 已变化，请重新读取后再保存。',
  enterprise_case_storage_unavailable: 'Case 存储尚未就绪。',
  enterprise_body_too_large: '正文超过 1 MiB，未裁剪或保存，请减少正文后重试。',
  enterprise_file_too_large: '来源文件超过 10 MiB，未上传或裁剪，请选择较小文件。',
  enterprise_text_too_large: '说明文字超过保存上限，未覆盖原内容，请缩短后重试。',
  enterprise_request_too_large: '本次提交过大，未裁剪为片段，请减少内容后重试。',
};
function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}
async function readInput(request: IncomingMessage, limit: number): Promise<Record<string, any>> {
  const contentType = request.headers['content-type']?.split(';')[0].trim();
  if (contentType !== 'application/json') throw new EnterpriseMaterialsError('invalid_enterprise_content_type', 415);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new EnterpriseMaterialsError('enterprise_request_too_large', 413);
    chunks.push(bytes);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value;
  } catch { throw new EnterpriseMaterialsError('invalid_enterprise_request'); }
}
function only(input: Record<string, any>, keys: readonly string[]) {
  if (Object.keys(input).some(key => !keys.includes(key))) throw new EnterpriseMaterialsError('invalid_enterprise_fields');
}

/** Business-resource routes only. No model, session constructor, or analysis policy lives here. */
export async function handleEnterpriseMaterialsRoute(options: EnterpriseMaterialsRouteOptions): Promise<boolean> {
  const { request, response, url, store, cases } = options;
  const prefix = '/api/enterprise-materials';
  const caseMatch = /^\/api\/cases\/([^/]+)\/enterprise-materials$/.exec(url.pathname);
  if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/') && !caseMatch) return false;
  const mutate = options.mutate ?? (async <T>(operation: () => T | Promise<T>) => operation());
  try {
    if (caseMatch) {
      const caseId = caseMatch[1]!;
      if (!['GET', 'PUT'].includes(request.method ?? '')) throw new EnterpriseMaterialsError('enterprise_method_not_allowed', 405);
      const input = request.method === 'PUT' ? await readInput(request, 2_097_152) : undefined;
      const result = await mutate(async () => {
        const status = cases.getStatus();
        if (status.state !== 'ready' || !status.storeId) throw new EnterpriseMaterialsError('enterprise_case_storage_unavailable', 503);
        const record = cases.getCase(caseId);
        if (!input) return store.getCaseContext(status.storeId, caseId);
        only(input, ['caseRevision', 'expectedRevision', 'materials', 'supplements']);
        if (record.status === 'closed') throw new EnterpriseMaterialsError('enterprise_case_closed', 409);
        if (input.caseRevision !== record.revision) throw new EnterpriseMaterialsError('enterprise_case_revision_conflict', 409);
        const { caseRevision: _caseRevision, ...context } = input;
        return store.saveCaseContext(status.storeId, caseId, context as EnterpriseCaseContextInput);
      });
      json(response, 200, result); return true;
    }
    const segments = url.pathname.slice(prefix.length).split('/').filter(Boolean);
    if (!segments.length) {
      if (request.method === 'GET') { json(response, 200, await store.list()); return true; }
      if (request.method === 'POST') {
        const input = await readInput(request, 8_388_608);
        json(response, 201, await mutate(() => store.create(input as Partial<EnterpriseMaterialFields>))); return true;
      }
      throw new EnterpriseMaterialsError('enterprise_method_not_allowed', 405);
    }
    const materialId = segments[0]!;
    if (segments.length === 1) {
      if (request.method === 'GET') { json(response, 200, await store.get(materialId)); return true; }
      if (request.method === 'PUT') {
        const { expectedVersion, ...fields } = await readInput(request, 8_388_608);
        json(response, 200, await mutate(() => store.update(materialId, expectedVersion, fields))); return true;
      }
      throw new EnterpriseMaterialsError('enterprise_method_not_allowed', 405);
    }
    const operation = segments[1];
    if (segments.length === 2 && request.method === 'POST') {
      const input = await readInput(request, operation === 'files' ? 15_728_640 : 65_536);
      if (operation === 'enable') { only(input, ['expectedVersion', 'revisionId']); json(response, 200, await mutate(() => store.enable(materialId, input.expectedVersion, input.revisionId))); return true; }
      if (operation === 'disable') { only(input, ['expectedVersion']); json(response, 200, await mutate(() => store.disable(materialId, input.expectedVersion))); return true; }
      if (operation === 'files') {
        const { expectedVersion, ...file } = input;
        json(response, 200, await mutate(() => store.addFile(materialId, expectedVersion, file as { name: string; base64: string; importText?: boolean }))); return true;
      }
    }
    if (segments.length === 3 && operation === 'revisions' && request.method === 'GET') {
      const index = await store.list(), revision = await store.readRevision(materialId, segments[2]!);
      json(response, 200, { storeId: index.storeId, materialId, revision }); return true;
    }
    if (segments.length === 3 && operation === 'source-file' && request.method === 'GET') {
      const { file, bytes } = await store.readSourceFile(materialId, segments[2]!);
      const encodedName = encodeURIComponent(file.name).replace(/['()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length, 'content-disposition': `attachment; filename*=UTF-8''${encodedName}`, 'x-content-type-options': 'nosniff' });
      response.end(bytes); return true;
    }
    throw new EnterpriseMaterialsError('enterprise_route_not_found', 404);
  } catch (error) {
    const fault = error instanceof EnterpriseMaterialsError ? error : error instanceof CaseStoreError ? new EnterpriseMaterialsError(error.code, error.statusCode) : new EnterpriseMaterialsError('enterprise_storage_unavailable', 503);
    json(response, fault.status, { error: fault.code, message: messages[fault.code] ?? '企业资料操作未完成，请检查输入或重新读取；现有资料保留。' });
    return true;
  }
}
