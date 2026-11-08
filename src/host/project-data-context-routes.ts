import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProjectStore } from './project-store.ts';
import { ProjectDataContextStore, ProjectDataContextFault } from './project-data-context-store.ts';
import type { CreateDataCitation, FreezeProjectInput, SaveDataDescription } from './project-data-context-types.ts';

type Options = {
  request: IncomingMessage; response: ServerResponse; url: URL; store: ProjectDataContextStore; projects: ProjectStore;
  readBody: (request: IncomingMessage, limit?: number) => Promise<Record<string, unknown>>;
  choices: () => Promise<unknown>;
  sourceStatuses: (input: { conceptRefs: unknown; sapRefs: unknown }) => Promise<unknown>;
  conceptSource: (ref: unknown) => Promise<unknown>;
  mutate: <T>(operation: () => T | Promise<T>) => Promise<T>;
  isClosing: () => boolean;
};
const messages: Record<string, string> = {
  data_context_revision_conflict: '数据说明已变化，请刷新后再保存；当前草稿保留。',
  data_context_operation_conflict: '此操作标识已绑定其他内容，请核对原操作结果后再新建保存。',
  data_context_materials_too_large: '本轮数据说明超过20,000字符，请减少选材；未截断、未发送模型。',
  data_context_analysis_copy_changed: '020分析副本已变化，原固定版本仍保留；请先另存工作内容并核对版本。本次未覆盖副本。',
  data_context_analysis_copy_not_prepared: '请先为本轮准备明确的数据版本，未自动替换分析文件。',
  data_context_concept_disabled: '概念说明资料已停用，新选材不可使用；历史引用保留。',
};
export function dataContextErrorResponse(error: ProjectDataContextFault) {
  const code = error.code;
  const status = /too_large|too_many/.test(code) ? 413 : /not_found|missing/.test(code) ? 404 : /corrupt|incomplete|uncommitted|unknown/.test(code) ? 503 : /conflict|changed|archived|disabled|mismatch|not_prepared/.test(code) ? 409 : 400;
  return { status, body: { code, message: messages[code] ?? '数据版本或来源未能核对，请保留草稿并检查明确版本；未自动改用最新内容。' } };
}
const send = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(value));
};
const binary = (response: ServerResponse, bytes: Buffer, name: string) => {
  response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(bytes);
};

/** Thin project resource transport; no Agent, model call, scanner or business judgement. */
export async function handleProjectDataContextRoute(options: Options): Promise<boolean> {
  const match = /^\/api\/projects\/([a-f0-9-]+)\/data-context(?:\/(.*))?$/.exec(options.url.pathname);
  if (!match) return false;
  const { request, response, store, projects } = options;
  const projectId = match[1]!, route = match[2] ?? '', method = request.method ?? 'GET';
  await projects.get(projectId);
  const write = async <T>(operation: () => Promise<T>) => options.mutate(async () => {
    if (options.isClosing()) throw new ProjectDataContextFault('data_context_host_closing');
    if ((await projects.get(projectId)).archivedAt !== null) throw new ProjectDataContextFault('data_context_project_archived');
    return operation();
  });
  try {
    if (!route && method === 'GET') { send(response, 200, await store.summary(projectId)); return true; }
    if (route === 'references' && method === 'GET') { send(response, 200, await options.choices()); return true; }
    if (route === 'concept-source' && method === 'POST') {
      const input = await options.readBody(request);
      if (Object.keys(input).some(key => key !== 'ref')) throw new ProjectDataContextFault('data_context_invalid_selection');
      send(response, 200, await options.conceptSource(input.ref)); return true;
    }
    if (route === 'source-status' && method === 'POST') {
      const input = await options.readBody(request);
      if (Object.keys(input).some(key => !['conceptRefs', 'sapRefs'].includes(key))) throw new ProjectDataContextFault('data_context_invalid_selection');
      send(response, 200, await options.sourceStatuses({ conceptRefs: input.conceptRefs, sapRefs: input.sapRefs })); return true;
    }
    if (route === 'preview' && method === 'POST') {
      const input = await options.readBody(request);
      if (typeof input.path !== 'string' || Object.keys(input).some(key => key !== 'path') || !/^(020_clean|060_reports)\//.test(input.path)) throw new ProjectDataContextFault('data_context_invalid_source_path');
      send(response, 200, { path: input.path, ...await projects.observeFile(projectId, input.path) }); return true;
    }
    if (['inputs', 'descriptions', 'citations'].includes(route) && method === 'POST') {
      const input = await options.readBody(request, 1_048_576);
      const result = route === 'inputs' ? await write(() => store.freezeInput(projectId, input as unknown as FreezeProjectInput))
        : route === 'descriptions' ? await write(() => store.saveDescription(projectId, input as unknown as SaveDataDescription))
        : await write(() => store.createCitation(projectId, input as unknown as CreateDataCitation));
      send(response, result.replayed ? 200 : 201, result); return true;
    }
    if (route === 'prepare' && method === 'POST') {
      const input = await options.readBody(request);
      if (typeof input.datasetId !== 'string' || typeof input.inputVersionId !== 'string' || (input.replaceChanged !== undefined && typeof input.replaceChanged !== 'boolean') || Object.keys(input).some(key => !['datasetId', 'inputVersionId', 'replaceChanged'].includes(key))) throw new ProjectDataContextFault('data_context_invalid_selection');
      const copy = await write(() => store.prepareAnalysisCopy(projectId, input.datasetId as string, input.inputVersionId as string, input.replaceChanged === true));
      send(response, 200, { copy }); return true;
    }
    const version = /^datasets\/([a-f0-9-]+)\/versions\/([a-f0-9-]+)(\/evidence)?$/.exec(route);
    if (version && method === 'GET') {
      if (version[3]) { const result = await store.readInputEvidence(projectId, version[1]!, version[2]!); binary(response, result.bytes, result.record.sourcePath.split('/').at(-1)!); }
      else send(response, 200, { record: await store.readVersion(projectId, version[1]!, version[2]!) });
      return true;
    }
    const description = /^datasets\/([a-f0-9-]+)\/descriptions\/([a-f0-9-]+)$/.exec(route);
    if (description && method === 'GET') { send(response, 200, { record: await store.readDescription(projectId, description[1]!, description[2]!) }); return true; }
    const citation = /^citations\/([a-f0-9-]+)(\/evidence)?$/.exec(route);
    if (citation && method === 'GET') {
      if (citation[2]) {
        const raw = options.url.searchParams.get('attachmentIndex');
        if (raw !== null && !/^(0|[1-9][0-9]*)$/.test(raw)) throw new ProjectDataContextFault('data_context_invalid_attachment');
        const result = await store.readCitationEvidence(projectId, citation[1]!, raw === null ? null : Number(raw));
        binary(response, result.bytes, result.file.originalPath.split('/').at(-1)!);
      } else send(response, 200, { record: await store.readCitation(projectId, citation[1]!) });
      return true;
    }
    send(response, 404, { code: 'data_context_not_found', message: '未找到该数据来源操作。' }); return true;
  } catch (error) {
    if (!(error instanceof ProjectDataContextFault)) throw error;
    const result = dataContextErrorResponse(error); send(response, result.status, result.body); return true;
  }
}
