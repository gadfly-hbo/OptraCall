import type { IncomingMessage } from 'node:http';
import { createMetricLibrary, MetricLibraryFault, type LibraryEntry } from '../library/store.ts';
import { createProjectEnablement, EnablementFault, type EnablementRecord } from '../project/enablement.ts';
import { parseSapDraft, preparePublication, SapFault, type SapDocument } from '../sap/validate.ts';

class ApiFault extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  constructor(status: number, code: string, message: string, detail?: string) { super(message); this.status = status; this.code = code; this.detail = detail; }
}

export type MetricFactoryRoutesOptions = {
  libraryRoot: string;
  projectDataDirectory: (projectId: string) => string;
  projectExists: (projectId: string) => Promise<boolean>;
  readProjectFile: (projectId: string, relativePath: string) => Promise<{ name: string; bytes: Buffer }>;
  readBody: (request: IncomingMessage) => Promise<Record<string, unknown>>;
};

const packageIdPattern = /^[a-z][a-z0-9-]*$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const projectIdPattern = /^[a-f0-9-]{36}$/;
const draftPathPattern = /^020_clean\/[A-Za-z0-9][A-Za-z0-9 .@_\-\/]*\.ya?ml$/;

/** Host-owned HTTP transport calls these handlers; the plugin never binds a port itself. */
export function createMetricFactoryRoutes(options: MetricFactoryRoutesOptions) {
  const library = createMetricLibrary(options.libraryRoot);
  const enablementOf = (projectId: string) => createProjectEnablement(options.projectDataDirectory(projectId));

  const draftInput = async (input: Record<string, unknown>) => {
    const projectId = String(input.projectId ?? '');
    if (!projectIdPattern.test(projectId) || !(await options.projectExists(projectId))) throw new ApiFault(404, 'project_not_found', '项目不存在或不可用。');
    const draftPath = String(input.path ?? '');
    if (!draftPathPattern.test(draftPath) || draftPath.split('/').includes('..')) throw new ApiFault(400, 'invalid_draft_path', '草稿必须是 020_clean 目录下的 .yaml 文件。');
    const file = await options.readProjectFile(projectId, draftPath);
    return { projectId, draftPath, bytes: new Uint8Array(file.bytes) };
  };

  const publishDraft = async (input: Record<string, unknown>, publish: boolean) => {
    const { bytes } = await draftInput(input);
    const publishedBy = String(input.publishedBy ?? '');
    if (publish && (!publishedBy.trim() || publishedBy.length > 200)) throw new ApiFault(400, 'publisher_invalid', '请填写审核人后再发布。');
    try {
      const publication = preparePublication(bytes);
      if (!publish) return { status: 200, value: { document: publication.document, packageFingerprint: publication.packageFingerprint, contentFingerprint: publication.contentFingerprint } };
      try {
        const existing = library.read(publication.document.package.id, publication.document.package.version);
        if (existing.entry.bytesSha256 === publication.bytesSha256) return { status: 200, value: { entry: existing.entry } };
      } catch (error) {
        if (!(error instanceof MetricLibraryFault) || error.code !== 'LIBRARY_NOT_FOUND') throw error;
      }
      const entry = library.publish(publication, publishedBy);
      return { status: 201, value: { entry } };
    } catch (error) {
      if (error instanceof SapFault) throw new ApiFault(422, error.code, `草稿未通过 SAP 0.2 校验（${error.code}）。`, error.path);
      if (error instanceof MetricLibraryFault) throw new ApiFault(409, error.code, libraryMessage(error.code));
      throw error;
    }
  };

  const libraryMessage = (code: string): string => ({
    LIBRARY_SAME_CONTENT: '内容与既有版本完全一致，已拒绝重新发版。',
    LIBRARY_VERSION_CONFLICT: '该版本号已存在且内容不同，版本不可覆盖。',
    LIBRARY_CORRUPT: '指标库状态异常，已停止写入；请检查本地数据后重试。',
  }[code] ?? '指标库操作未完成，请检查后重试。');

  const projectInput = async (input: Record<string, unknown> | undefined, projectIdFromPath: string) => {
    if (!projectIdPattern.test(projectIdFromPath) || !(await options.projectExists(projectIdFromPath))) throw new ApiFault(404, 'project_not_found', '项目不存在或不可用。');
    return input ?? {};
  };

  const enabledRecords = (projectId: string) => {
    const enabled = enablementOf(projectId).list();
    return enabled.map(record => {
      try { return { ...record, entry: library.read(record.packageId, record.version).entry }; }
      catch { return { ...record, entry: undefined }; }
    });
  };

  return async function metricFactoryRoutes(request: IncomingMessage, url: URL): Promise<{ status: number; value: unknown } | undefined> {
    if (!url.pathname.startsWith('/api/metric-factory/')) return undefined;
    try {
      const segments = url.pathname.slice('/api/metric-factory/'.length).split('/');
      if (request.method === 'GET' && segments[0] === 'library' && segments.length === 1) return { status: 200, value: { entries: library.list() } };
      if (request.method === 'GET' && segments[0] === 'library' && segments.length === 3 && packageIdPattern.test(segments[1]!) && semverPattern.test(segments[2]!)) {
        const { entry, canonicalYaml } = library.read(segments[1]!, segments[2]!);
        return { status: 200, value: { entry, document: parseSapDraft(new Uint8Array(Buffer.from(canonicalYaml, 'utf8'))) } };
      }
      if (request.method === 'POST' && segments[0] === 'draft' && segments[1] === 'validate') return await publishDraft(await options.readBody(request), false);
      if (request.method === 'POST' && segments[0] === 'publish') return await publishDraft(await options.readBody(request), true);
      if (segments[0] === 'projects' && segments.length >= 2) {
        const projectId = segments[1]!;
        if (request.method === 'GET' && segments.length === 2) { await projectInput(undefined, projectId); return { status: 200, value: { records: enabledRecords(projectId) } }; }
        if (request.method === 'POST' && segments[2] === 'enable' && segments.length === 3) {
          const input = await projectInput(await options.readBody(request), projectId);
          const packageId = String(input.packageId ?? ''), version = String(input.version ?? '');
          if (!packageIdPattern.test(packageId) || !semverPattern.test(version)) throw new ApiFault(400, 'enablement_invalid', '请选择要启用的资产包与精确版本。');
          try { const { entry } = library.read(packageId, version); enablementOf(projectId).enable(packageId, version); return { status: 200, value: { record: enablementOf(projectId).enabled(packageId), entry } }; }
          catch (error) { if (error instanceof MetricLibraryFault) throw new ApiFault(404, 'version_not_published', '该资产包版本不在全局库中，无法启用。'); throw error; }
        }
        if (request.method === 'POST' && segments[2] === 'disable' && segments.length === 3) {
          const input = await projectInput(await options.readBody(request), projectId);
          const packageId = String(input.packageId ?? '');
          if (!packageIdPattern.test(packageId)) throw new ApiFault(400, 'enablement_invalid', '请选择要停用的资产包。');
          try { enablementOf(projectId).disable(packageId); } catch (error) { if (error instanceof EnablementFault && error.code === 'ENABLEMENT_CORRUPT') throw new ApiFault(409, 'enablement_corrupt', '项目启用记录异常，已停止写入；请检查本地数据后重试。'); throw error; }
          return { status: 200, value: { records: enabledRecords(projectId) } };
        }
      }
      return undefined;
    } catch (error) {
      if (error instanceof ApiFault) return { status: error.status, value: { code: error.code, message: error.message, ...(error.detail ? { detail: error.detail } : {}) } };
      if (error instanceof MetricLibraryFault) return {
        status: error.code === 'LIBRARY_NOT_FOUND' ? 404 : 409,
        value: { code: error.code, message: error.code === 'LIBRARY_NOT_FOUND' ? '未找到该资产包或版本。' : libraryMessage(error.code) },
      };
      if (error instanceof EnablementFault) return { status: 409, value: { code: error.code, message: '项目启用记录异常，已停止写入；请检查本地数据后重试。' } };
      throw error;
    }
  };
}

export type { LibraryEntry, EnablementRecord, SapDocument };
