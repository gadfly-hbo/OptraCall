import path from 'node:path';
import { modelSupportsImages } from '../agent/runtime.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';
import type { ProjectStore, UploadedFile } from './project-store.ts';
import type { StrategyAttachments } from './strategy-attachments.ts';
import { StrategyDiscussionFault, discussionHash } from './strategy-discussion-store.ts';
import { isDiscussionSourceExcluded } from './strategy-discussion-source-scope.ts';
import type { StrategyDiscussion, StrategyDiscussionSource } from './strategy-discussion-types.ts';
import {
  STRATEGY_MAP_IMPORT_EXTENSIONS,
  STRATEGY_MAP_IMPORT_MAX_BYTES,
  decodeStrategyMapImportFile,
  detectImportFormat,
  renderImportPageImage,
  type DecodedStrategyMapImport,
  type RenderedPageImageResult,
} from './strategy-map-import.ts';
import { StrategyMapImportStore, type StoredMapImportSource } from './strategy-map-import-store.ts';

export interface StrategyMapImportCandidateFile {
  kind: 'discussion-attachment' | 'project-file';
  id: string;
  fileName: string;
  format: 'xlsx' | 'pptx' | 'pdf' | 'image';
  sha256: string;
  originLabel: string;
  projectId?: string;
  uploadId?: string;
  projectPath?: string;
  attachmentSourceId?: string;
}

export interface StrategyMapImportServiceOptions {
  dataRoot: string;
  codeRoot: string;
  attachments: StrategyAttachments;
  projects: Pick<ProjectStore, 'get' | 'captureFeedbackFile'>;
  owner(id: string): StrategyDiscussion;
  configuration(id?: string, revision?: number): Readonly<RuntimeModelConfiguration> | null | undefined;
  writable(owner: StrategyDiscussion): void;
  mutate<T>(action: () => Promise<T>): Promise<T>;
}

const fault = (code: string, status = 400): never => {
  throw new StrategyDiscussionFault(code, status);
};

const isEligibleImportName = (name: string) =>
  STRATEGY_MAP_IMPORT_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));

const isEligibleProjectUpload = (upload: UploadedFile) =>
  /^(020_clean|060_reports)\//.test(upload.path) &&
  isEligibleImportName(upload.originalName) &&
  upload.bytes <= STRATEGY_MAP_IMPORT_MAX_BYTES;

const mimeByFormat = (fileName: string): string => {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  return 'image/jpeg';
};

export function createStrategyMapImportService(options: StrategyMapImportServiceOptions) {
  const store = new StrategyMapImportStore(options.dataRoot);

  async function resolveExternalBytes(owner: StrategyDiscussion, source: StoredMapImportSource): Promise<Buffer> {
    if (source.origin === 'discussion-attachment') {
      const att = owner.sources.find(s => s.id === source.attachmentSourceId && s.target.kind === 'strategy-attachment');
      if (!att || isDiscussionSourceExcluded(owner, att)) fault('strategy_map_import_revoked', 403);
      return options.attachments.bytes(owner, att!);
    }
    if (source.origin === 'project-file') {
      if (!owner.projectId || owner.projectId !== source.projectId || !source.uploadId || !source.projectPath) {
        fault('strategy_map_import_revoked', 403);
      }
      const project = await options.projects.get(owner.projectId!);
      if (project.archivedAt !== null) fault('strategy_map_import_revoked', 403);
      const upload = project.uploads.find(f => f.id === source.uploadId && f.path === source.projectPath && isEligibleProjectUpload(f));
      if (!upload) fault('strategy_map_import_source_unavailable', 404);
      const pseudoSource: StrategyDiscussionSource = {
        id: 'project-check',
        title: upload!.originalName,
        target: { kind: 'strategy-attachment', projectId: project.id, uploadId: upload!.id, path: upload!.path },
        sha256: upload!.sha256,
        version: upload!.uploadedAt,
      };
      if (isDiscussionSourceExcluded(owner, pseudoSource)) fault('strategy_map_import_revoked', 403);
      const captured = await options.projects.captureFeedbackFile(project.id, upload!.path, STRATEGY_MAP_IMPORT_MAX_BYTES);
      return captured.bytes;
    }
    return fault('strategy_map_import_source_unavailable', 404);
  }

  async function visionCapability(configuration: Readonly<RuntimeModelConfiguration> | null | undefined) {
    if (!configuration) {
      return { supportsImages: false, model: '', provider: '', reason: '尚未配置可用模型' };
    }
    const provider = configuration.provider;
    let supports = false;
    try {
      supports = await modelSupportsImages(configuration);
    } catch {
      supports = false;
    }
    return {
      supportsImages: supports,
      model: configuration.model,
      provider,
      ...(supports ? {} : { reason: '当前模型仅支持纯文本，已优先提取可读文字与原生结构；扫描页或图片区域可切换已配置且获准的视觉模型，或对照原稿手工核对。' }),
    };
  }

  async function listLibrary(owner: StrategyDiscussion) {
    const registered = await store.list(owner.id);
    const reusable: StrategyMapImportCandidateFile[] = [];

    for (const att of owner.sources) {
      if (att.target.kind !== 'strategy-attachment' || isDiscussionSourceExcluded(owner, att)) continue;
      if (!isEligibleImportName(att.title)) continue;
      reusable.push({
        kind: 'discussion-attachment',
        id: att.id,
        attachmentSourceId: att.id,
        fileName: att.title,
        format: detectImportFormat(att.title),
        sha256: att.sha256,
        originLabel: '原战略讨论已有附件（免重复上传）',
      });
    }

    if (owner.projectId) {
      try {
        const project = await options.projects.get(owner.projectId);
        if (project.archivedAt === null) {
          for (const upload of project.uploads) {
            if (!isEligibleProjectUpload(upload)) continue;
            if (reusable.some(r => r.sha256 === upload.sha256 && r.fileName === upload.originalName)) continue;
            const excluded = owner.sourceScope?.excludedSources?.some(
              ex => ex.target.projectId === project.id && (ex.target.uploadId === upload.id || ex.target.path === upload.path),
            );
            if (excluded) continue;
            reusable.push({
              kind: 'project-file',
              id: `project-file:${upload.id}`,
              fileName: upload.originalName,
              format: detectImportFormat(upload.originalName),
              sha256: upload.sha256,
              originLabel: `关联项目「${project.name}」· ${upload.path}（免重复上传）`,
              projectId: project.id,
              uploadId: upload.id,
              projectPath: upload.path,
            });
          }
        }
      } catch {
        // Ignore unavailable project catalog when listing reusable sources
      }
    }

    const cfg = options.configuration(owner.configurationId, owner.configurationRevision);
    return {
      sources: registered,
      reusable,
      vision: await visionCapability(cfg),
    };
  }

  async function registerSource(owner: StrategyDiscussion, input: Record<string, unknown>) {
    const kind = input.kind;
    if (kind === 'upload') {
      if (typeof input.fileName !== 'string' || typeof input.bytes !== 'string' || !input.bytes) {
        fault('invalid_strategy_map_import_input', 400);
      }
      const maxEncoded = Math.ceil(STRATEGY_MAP_IMPORT_MAX_BYTES / 3) * 4;
      if ((input.bytes as string).length > maxEncoded) fault('strategy_map_import_too_large', 413);
      const bytes = Buffer.from(input.bytes as string, 'base64');
      if (!bytes.length || bytes.toString('base64') !== input.bytes) fault('invalid_strategy_map_import_input', 400);
      const saved = await options.mutate(async () => {
        const latest = options.owner(owner.id);
        options.writable(latest);
        return store.saveUpload(latest.id, input.fileName as string, bytes);
      });
      const cfg = options.configuration(owner.configurationId, owner.configurationRevision);
      return { ...saved, vision: await visionCapability(cfg) };
    }

    if (kind === 'attachment') {
      const attachmentSourceId = typeof input.attachmentSourceId === 'string' ? input.attachmentSourceId : '';
      const att = owner.sources.find(s => s.id === attachmentSourceId && s.target.kind === 'strategy-attachment');
      if (!att || isDiscussionSourceExcluded(owner, att)) fault('strategy_map_import_not_authorized', 403);
      const bytes = await options.attachments.bytes(owner, att!);
      const saved = await options.mutate(async () => {
        const latest = options.owner(owner.id);
        options.writable(latest);
        return store.registerExternal(latest.id, {
          origin: 'discussion-attachment',
          fileName: att!.title,
          bytes,
          attachmentSourceId: att!.id,
        });
      });
      const cfg = options.configuration(owner.configurationId, owner.configurationRevision);
      return { ...saved, vision: await visionCapability(cfg) };
    }

    if (kind === 'project-file') {
      if (!owner.projectId) fault('strategy_map_import_not_authorized', 403);
      const uploadId = typeof input.uploadId === 'string' ? input.uploadId : '';
      const project = await options.projects.get(owner.projectId!);
      if (project.archivedAt !== null) fault('strategy_map_import_not_authorized', 403);
      const upload = project.uploads.find(u => u.id === uploadId && isEligibleProjectUpload(u));
      if (!upload) fault('strategy_map_import_not_found', 404);
      const excluded = owner.sourceScope?.excludedSources?.some(
        ex => ex.target.projectId === project.id && (ex.target.uploadId === upload!.id || ex.target.path === upload!.path),
      );
      if (excluded) fault('strategy_map_import_not_authorized', 403);
      const captured = await options.projects.captureFeedbackFile(project.id, upload!.path, STRATEGY_MAP_IMPORT_MAX_BYTES);
      const saved = await options.mutate(async () => {
        const latest = options.owner(owner.id);
        options.writable(latest);
        return store.registerExternal(latest.id, {
          origin: 'project-file',
          fileName: upload!.originalName,
          bytes: captured.bytes,
          projectId: project.id,
          uploadId: upload!.id,
          projectPath: upload!.path,
        });
      });
      const cfg = options.configuration(owner.configurationId, owner.configurationRevision);
      return { ...saved, vision: await visionCapability(cfg) };
    }

    return fault('invalid_strategy_map_import_input', 400);
  }

  async function readDecodedAndBytes(owner: StrategyDiscussion, sourceId: string): Promise<{
    source: StoredMapImportSource;
    bytes: Buffer;
    decoded: DecodedStrategyMapImport;
  }> {
    const source = await store.assertActive(owner.id, sourceId);
    const bytes = await store.readBytes(owner.id, sourceId, ext => resolveExternalBytes(owner, ext));
    const decoded = await decodeStrategyMapImportFile(source.fileName, bytes);
    return { source, bytes, decoded };
  }

  async function readPreview(owner: StrategyDiscussion, sourceId: string, pageNumber = 1, includeImage = true) {
    const { source, bytes, decoded } = await readDecodedAndBytes(owner, sourceId);
    const safePage = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= decoded.pages.length ? pageNumber : 1;
    const page = decoded.pages[safePage - 1]!;
    let image: RenderedPageImageResult = { available: false, reason: '未请求图像渲染' };
    if (includeImage) {
      image = await renderImportPageImage({
        fileName: source.fileName,
        format: source.format,
        bytes,
        page: safePage,
        codeRoot: options.codeRoot,
      });
    }
    const cfg = options.configuration(owner.configurationId, owner.configurationRevision);
    return {
      source,
      pageCount: decoded.pages.length,
      pages: decoded.pages.map(p => ({
        page: p.page,
        title: p.title,
        hasTextLayer: p.hasTextLayer,
        needsVisualReview: p.needsVisualReview,
        shapeCount: p.shapes.length,
        connectorCount: p.connectors.length,
      })),
      currentPage: page,
      image,
      imageMeta: decoded.imageMeta,
      embeddedImages: decoded.embeddedImages,
      hasDrawings: decoded.hasDrawings,
      workbook: decoded.workbook,
      vision: await visionCapability(cfg),
    };
  }

  async function readForAgent(
    owner: StrategyDiscussion,
    configuration: Readonly<RuntimeModelConfiguration>,
    sourceId: string,
    pageNumber?: number,
    includeImage = true,
  ): Promise<{
    content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
    details: Record<string, unknown>;
  }> {
    const { source, bytes, decoded } = await readDecodedAndBytes(owner, sourceId);
    const vision = await visionCapability(configuration);
    const requestedPage = pageNumber !== undefined && Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= decoded.pages.length
      ? pageNumber
      : undefined;

    const selectedPages = requestedPage ? [decoded.pages[requestedPage - 1]!] : decoded.pages;
    const summaryPayload: Record<string, unknown> = {
      source: {
        sourceId: source.sourceId,
        format: source.format,
        fileName: source.fileName,
        sha256: source.sha256,
        origin: source.origin,
        pageCount: decoded.pages.length,
        ...(decoded.imageMeta ? { imageMeta: decoded.imageMeta } : {}),
      },
      pages: selectedPages.map(p => ({
        page: p.page,
        title: p.title,
        hasTextLayer: p.hasTextLayer,
        needsVisualReview: p.needsVisualReview,
        text: p.text.slice(0, 12000),
        shapes: p.shapes.slice(0, 80),
        connectors: p.connectors.slice(0, 120),
        ...(p.notes ? { notes: p.notes } : {}),
      })),
      ...(decoded.embeddedImages?.length ? { embeddedImages: decoded.embeddedImages } : {}),
      vision,
      claim: 'provided-source-not-adopted',
    };

    const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];

    const pageToRender = requestedPage ?? 1;
    let renderedImage: RenderedPageImageResult | undefined;
    if (includeImage && vision.supportsImages) {
      renderedImage = await renderImportPageImage({
        fileName: source.fileName,
        format: source.format,
        bytes,
        page: pageToRender,
        codeRoot: options.codeRoot,
      });
      summaryPayload.imageDelivery = renderedImage.available
        ? { delivered: true, page: pageToRender, mimeType: renderedImage.mimeType, renderer: renderedImage.renderer }
        : { delivered: false, page: pageToRender, reason: renderedImage.reason };
    } else if (includeImage && !vision.supportsImages) {
      summaryPayload.imageDelivery = {
        delivered: false,
        page: pageToRender,
        reason: 'text-only-model',
        guidance: '当前模型仅支持纯文本。请优先使用上方可读文字、单元格与原生形状/连接符提取候选；无法看清的视觉/扫描区域请标为 reviewState="needs-review" 并说明需视觉模型或人工核对。',
      };
    }

    const serialized = JSON.stringify(summaryPayload);
    content.push({ type: 'text', text: serialized.length > 60000 ? serialized.slice(0, 60000) : serialized });

    if (renderedImage?.available && renderedImage.base64 && renderedImage.mimeType) {
      // Bound raw image payload to 8 MiB encoded to stay safely within IPC limits
      if (renderedImage.base64.length <= 8 * 1024 * 1024) {
        content.push({
          type: 'image',
          data: renderedImage.base64,
          mimeType: renderedImage.mimeType,
        });
      }
    }

    return {
      content,
      details: {
        source: summaryPayload.source,
        page: requestedPage ?? null,
        imageDelivered: content.some(c => c.type === 'image'),
        visionSupportsImages: vision.supportsImages,
        contentSha256: discussionHash(summaryPayload.source),
      },
    };
  }

  async function verifySources(owner: StrategyDiscussion, refs: Array<{ sourceId: string; sha256?: string }>) {
    for (const ref of refs) {
      const item = await store.assertActive(owner.id, ref.sourceId);
      if (ref.sha256 && item.sha256 !== ref.sha256) fault('strategy_map_import_source_changed', 409);
      await store.readBytes(owner.id, ref.sourceId, ext => resolveExternalBytes(owner, ext));
    }
  }

  async function revoke(owner: StrategyDiscussion, sourceId: string) {
    return options.mutate(async () => {
      const latest = options.owner(owner.id);
      options.writable(latest);
      return store.revoke(latest.id, sourceId);
    });
  }

  async function downloadOriginal(owner: StrategyDiscussion, sourceId: string) {
    const source = await store.assertActive(owner.id, sourceId);
    const bytes = await store.readBytes(owner.id, sourceId, ext => resolveExternalBytes(owner, ext));
    return {
      fileName: source.fileName,
      mimeType: mimeByFormat(source.fileName),
      sha256: source.sha256,
      bytes: bytes.toString('base64'),
    };
  }

  async function route(
    match: RegExpExecArray,
    method: string,
    searchParams: URLSearchParams,
    body: (limit?: number) => Promise<Record<string, unknown>>,
  ) {
    const discussionIdValue = match[1]!;
    const sourceId = match[2];
    const action = match[3];
    const owner = options.owner(discussionIdValue);
    if (owner.businessOwner) fault('strategy_discussion_not_found', 404);

    if (!sourceId && method === 'GET') {
      return listLibrary(owner);
    }
    if (!sourceId && method === 'POST') {
      const maxBody = Math.ceil(STRATEGY_MAP_IMPORT_MAX_BYTES / 3) * 4 + 16384;
      return registerSource(owner, await body(maxBody));
    }
    if (sourceId && action === 'preview' && method === 'GET') {
      const page = Number(searchParams.get('page') ?? '1');
      const includeImage = searchParams.get('includeImage') !== '0';
      return readPreview(owner, sourceId, page, includeImage);
    }
    if (sourceId && action === 'download' && method === 'GET') {
      return downloadOriginal(owner, sourceId);
    }
    if (sourceId && action === 'revoke' && method === 'POST') {
      return { source: await revoke(owner, sourceId) };
    }
    return fault('strategy_map_import_not_found', 404);
  }

  return {
    store,
    listLibrary,
    registerSource,
    readPreview,
    readForAgent,
    verifySources,
    revoke,
    downloadOriginal,
    visionCapability,
    route,
  };
}

export type StrategyMapImportService = ReturnType<typeof createStrategyMapImportService>;
