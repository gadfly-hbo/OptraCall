import path from 'node:path';
import { modelSupportsImages } from '../agent/runtime.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';
import type { ProjectStore, UploadedFile } from './project-store.ts';
import type { StrategyAttachments } from './strategy-attachments.ts';
import { createStrategyDiscussionSource } from './strategy-discussion-sources.ts';
import { StrategyDiscussionFault, discussionHash } from './strategy-discussion-store.ts';
import { isDiscussionSourceExcluded, isDiscussionSourceSelected } from './strategy-discussion-source-scope.ts';
import type { StrategyDiscussion } from './strategy-discussion-types.ts';
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

// Covers the full supported 16 MiB raw import limit encoded as base64 (~21.33 MiB), safely inside the 24 MiB IPC bound.
const MODEL_IMAGE_BASE64_LIMIT = Math.ceil(STRATEGY_MAP_IMPORT_MAX_BYTES / 3) * 4;

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

/** Unified project-file exclusion check (exact ID, resource path, and projectAttachmentLineages). */
function isProjectUploadExcluded(owner: StrategyDiscussion, projectId: string, upload: UploadedFile): boolean {
  const docSource = createStrategyDiscussionSource(
    upload.originalName,
    { kind: 'project-document', projectId, uploadId: upload.id, path: upload.path },
    upload.sha256,
    upload.uploadedAt,
  );
  const attSource = createStrategyDiscussionSource(
    upload.originalName,
    { kind: 'strategy-attachment', projectId, fileId: upload.id, uploadId: upload.id, path: upload.path },
    upload.sha256,
    upload.uploadedAt,
  );
  const legacyAttSource = createStrategyDiscussionSource(
    upload.originalName,
    { kind: 'strategy-attachment', projectId, fileId: discussionHash([projectId, upload.originalName]), uploadId: upload.id, path: upload.path },
    upload.sha256,
    upload.uploadedAt,
  );
  return (
    isDiscussionSourceExcluded(owner, docSource) ||
    isDiscussionSourceExcluded(owner, attSource) ||
    isDiscussionSourceExcluded(owner, legacyAttSource)
  );
}

export function createStrategyMapImportService(options: StrategyMapImportServiceOptions) {
  const store = new StrategyMapImportStore(options.dataRoot);

  async function resolveExternalBytes(owner: StrategyDiscussion, source: StoredMapImportSource): Promise<Buffer> {
    if (source.origin === 'discussion-attachment') {
      const att = owner.sources.find(s => s.id === source.attachmentSourceId && s.target.kind === 'strategy-attachment');
      if (!att || isDiscussionSourceExcluded(owner, att) || !isDiscussionSourceSelected(owner, att)) {
        fault('strategy_map_import_revoked', 403);
      }
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
      if (isProjectUploadExcluded(owner, project.id, upload!)) fault('strategy_map_import_revoked', 403);
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
            if (isProjectUploadExcluded(owner, project.id, upload)) continue;
            if (reusable.some(r => r.sha256 === upload.sha256 && r.fileName === upload.originalName)) continue;
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
      if (!att || isDiscussionSourceExcluded(owner, att) || !isDiscussionSourceSelected(owner, att)) {
        fault('strategy_map_import_not_authorized', 403);
      }
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
      if (isProjectUploadExcluded(owner, project.id, upload!)) fault('strategy_map_import_not_authorized', 403);
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

  async function readPreview(
    owner: StrategyDiscussion,
    sourceId: string,
    pageNumber = 1,
    includeImage = true,
    thumbnail = false,
    imageIndex?: number,
  ) {
    const { source, bytes, decoded } = await readDecodedAndBytes(owner, sourceId);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > decoded.pages.length) {
      fault('strategy_map_import_page_invalid', 400);
    }
    const page = decoded.pages[pageNumber - 1]!;
    let image: RenderedPageImageResult = { available: false, reason: '未请求图像渲染' };
    if (includeImage) {
      image = await renderImportPageImage({
        fileName: source.fileName,
        format: source.format,
        bytes,
        page: pageNumber,
        codeRoot: options.codeRoot,
        thumbnail,
        imageIndex,
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
        embeddedImageCount: p.embeddedImages?.length ?? 0,
      })),
      currentPage: page,
      image,
      imageMeta: decoded.imageMeta,
      embeddedImages: page.embeddedImages ?? [],
      hasDrawings: decoded.hasDrawings,
      workbook: decoded.workbook,
      vision: await visionCapability(cfg),
    };
  }

  async function readForAgent(
    owner: StrategyDiscussion,
    configuration: Readonly<RuntimeModelConfiguration>,
    sourceId: string,
    readOpts: { page?: number; includeImage?: boolean; imageIndex?: number; allowedPages?: number[] } = {},
  ): Promise<{
    content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
    details: Record<string, unknown>;
  }> {
    const { source, bytes, decoded } = await readDecodedAndBytes(owner, sourceId);
    const vision = await visionCapability(configuration);
    const includeImage = readOpts.includeImage !== false;

    const allValidPages = decoded.pages.map(p => p.page);
    const hasRestrictedPages = Array.isArray(readOpts.allowedPages) && readOpts.allowedPages.length > 0;
    const effectiveAllowedPages = hasRestrictedPages
      ? [...new Set(readOpts.allowedPages!.filter(p => Number.isInteger(p) && p >= 1 && p <= decoded.pages.length))].sort((a, b) => a - b)
      : allValidPages;
    if (!effectiveAllowedPages.length) {
      fault('strategy_map_import_page_not_authorized', 403);
    }

    if (readOpts.page !== undefined) {
      if (!Number.isInteger(readOpts.page) || readOpts.page < 1 || readOpts.page > decoded.pages.length) {
        fault('strategy_map_import_page_invalid', 400);
      }
      if (hasRestrictedPages && !effectiveAllowedPages.includes(readOpts.page)) {
        fault('strategy_map_import_page_not_authorized', 403);
      }
    }

    // Strict page scoping:
    // - Explicit page: read that exact page only
    // - Omitted page & single allowed page: read that single allowed page only
    // - Omitted page & multiple allowed pages: return allowed-page directory ONLY (never dump full-file text!)
    const directoryOnly = readOpts.page === undefined && effectiveAllowedPages.length > 1;
    const targetPageNum = readOpts.page ?? (effectiveAllowedPages.length === 1 ? effectiveAllowedPages[0]! : undefined);
    const targetPage = targetPageNum !== undefined ? decoded.pages[targetPageNum - 1]! : undefined;

    const sourceSummary = {
      sourceId: source.sourceId,
      format: source.format,
      fileName: source.fileName,
      sha256: source.sha256,
      origin: source.origin,
      pageCount: decoded.pages.length,
      allowedPages: effectiveAllowedPages,
      ...(decoded.imageMeta ? { imageMeta: decoded.imageMeta } : {}),
    };

    const deliveredBlocks: Array<{ type: 'image'; data: string; mimeType: string }> = [];
    let imageDelivery: Record<string, unknown>;

    if (directoryOnly) {
      imageDelivery = {
        delivered: false,
        count: 0,
        reason: 'page-required-for-multipage',
        guidance: `本轮允许读取第 ${effectiveAllowedPages.join('、')} 页；请传入具体 page 逐页读取正文、形状与图像。`,
      };
    } else if (!includeImage) {
      imageDelivery = { delivered: false, count: 0, page: targetPage!.page, reason: 'image-not-requested' };
    } else if (!vision.supportsImages) {
      imageDelivery = {
        delivered: false,
        count: 0,
        page: targetPage!.page,
        reason: 'text-only-model',
        guidance: '当前模型仅支持纯文本。请优先使用上方可读文字、单元格与原生形状/连接符提取候选；若页面为纯扫描或纯图且无可读节点，允许在 propose-map-draft 中传 nodes: [] 并在 unknowns 说明需视觉模型或人工补录。',
      };
    } else {
      const renderedImage = await renderImportPageImage({
        fileName: source.fileName,
        format: source.format,
        bytes,
        page: targetPage!.page,
        codeRoot: options.codeRoot,
        imageIndex: readOpts.imageIndex,
        includeAllSheetImages: readOpts.imageIndex === undefined,
      });

      if (!renderedImage.available || !renderedImage.base64 || !renderedImage.mimeType) {
        imageDelivery = {
          delivered: false,
          count: 0,
          page: targetPage!.page,
          reason: renderedImage.reason ?? 'render-unavailable',
          guidance: '本页未能生成可送达模型的图像，请仅依据结构化文字/形状起稿并将视觉盲区标为 needs-review。',
        };
      } else {
        const candidates: Array<{ data: string; mimeType: string; name?: string; width?: number; height?: number }> = [
          {
            data: renderedImage.base64,
            mimeType: renderedImage.mimeType,
            name: renderedImage.imageName,
            width: renderedImage.width,
            height: renderedImage.height,
          },
          ...(renderedImage.extraImages ?? []).map(extra => ({
            data: extra.base64,
            mimeType: extra.mimeType,
            name: extra.imageName,
            width: extra.width,
            height: extra.height,
          })),
        ];
        let usedBase64 = 0;
        const deliveredMeta: Array<{ name?: string; mimeType: string; width?: number; height?: number; base64Length: number }> = [];
        const omittedMeta: Array<{ name?: string; reason: string }> = [];

        for (const cand of candidates) {
          if (usedBase64 + cand.data.length <= MODEL_IMAGE_BASE64_LIMIT) {
            deliveredBlocks.push({ type: 'image', data: cand.data, mimeType: cand.mimeType });
            usedBase64 += cand.data.length;
            deliveredMeta.push({
              ...(cand.name ? { name: cand.name } : {}),
              mimeType: cand.mimeType,
              ...(cand.width ? { width: cand.width } : {}),
              ...(cand.height ? { height: cand.height } : {}),
              base64Length: cand.data.length,
            });
          } else {
            omittedMeta.push({
              ...(cand.name ? { name: cand.name } : {}),
              reason: 'image-payload-exceeds-limit',
            });
          }
        }

        if (deliveredBlocks.length > 0) {
          imageDelivery = {
            delivered: true,
            count: deliveredBlocks.length,
            page: targetPage!.page,
            mimeType: deliveredBlocks[0]!.mimeType,
            renderer: renderedImage.renderer,
            images: deliveredMeta,
            ...(omittedMeta.length ? { omittedImages: omittedMeta } : {}),
            ...(renderedImage.totalSheetImages !== undefined ? { totalSheetImages: renderedImage.totalSheetImages } : {}),
          };
        } else {
          imageDelivery = {
            delivered: false,
            count: 0,
            page: targetPage!.page,
            reason: 'image-payload-exceeds-limit',
            guidance: '该页图像体积超出模型视觉单次传输上限，未向模型送达图像；请仅依据结构化文字起稿或请用户压缩图片后重试。',
          };
        }
      }
    }

    const summaryPayload: Record<string, unknown> = directoryOnly
      ? {
          source: sourceSummary,
          directoryOnly: true,
          pages: effectiveAllowedPages.map(pNum => {
            const p = decoded.pages[pNum - 1]!;
            return {
              page: p.page,
              title: p.title,
              hasTextLayer: p.hasTextLayer,
              needsVisualReview: p.needsVisualReview,
              shapeCount: p.shapes.length,
              connectorCount: p.connectors.length,
              embeddedImageCount: p.embeddedImages?.length ?? 0,
            };
          }),
          imageDelivery,
          vision,
          claim: 'provided-source-not-adopted',
        }
      : {
          source: sourceSummary,
          directoryOnly: false,
          pages: [
            {
              page: targetPage!.page,
              title: targetPage!.title,
              ...(targetPage!.sheetName ? { sheetName: targetPage!.sheetName } : {}),
              hasTextLayer: targetPage!.hasTextLayer,
              needsVisualReview: targetPage!.needsVisualReview,
              text: targetPage!.text.slice(0, 12000),
              shapes: targetPage!.shapes.slice(0, 80),
              connectors: targetPage!.connectors.slice(0, 120),
              ...(targetPage!.embeddedImages?.length ? { embeddedImages: targetPage!.embeddedImages } : {}),
              ...(targetPage!.notes ? { notes: targetPage!.notes } : {}),
            },
          ],
          imageDelivery,
          vision,
          claim: 'provided-source-not-adopted',
        };

    const serialized = JSON.stringify(summaryPayload);
    const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [
      { type: 'text', text: serialized.length > 60000 ? serialized.slice(0, 60000) : serialized },
      ...deliveredBlocks,
    ];

    return {
      content,
      details: {
        source: sourceSummary,
        page: targetPage?.page ?? null,
        pagesRead: directoryOnly ? [] : [targetPage!.page],
        allowedPages: effectiveAllowedPages,
        imageDelivered: deliveredBlocks.length > 0,
        deliveredImageCount: deliveredBlocks.length,
        visionSupportsImages: vision.supportsImages,
        contentSha256: discussionHash(sourceSummary),
      },
    };
  }

  async function verifySources(
    owner: StrategyDiscussion,
    refs: Array<{
      sourceId: string;
      sha256?: string;
      fileName?: string;
      format?: string;
      origin?: string;
      selectedPages?: number[];
    }>,
  ): Promise<Map<string, StoredMapImportSource>> {
    const verified = new Map<string, StoredMapImportSource>();
    for (const ref of refs) {
      const item = await store.assertActive(owner.id, ref.sourceId);
      if (ref.sha256 && item.sha256 !== ref.sha256) fault('strategy_map_import_source_changed', 409);
      if (ref.fileName && item.fileName !== ref.fileName) fault('strategy_map_import_source_changed', 409);
      if (ref.format && item.format !== ref.format) fault('strategy_map_import_source_changed', 409);
      if (ref.origin && item.origin !== ref.origin) fault('strategy_map_import_source_changed', 409);
      if (ref.selectedPages) {
        if (
          !Array.isArray(ref.selectedPages) ||
          new Set(ref.selectedPages).size !== ref.selectedPages.length ||
          ref.selectedPages.some(p => !Number.isInteger(p) || p < 1 || p > item.pageCount)
        ) {
          fault('strategy_map_import_page_invalid', 400);
        }
      }
      await store.readBytes(owner.id, ref.sourceId, ext => resolveExternalBytes(owner, ext));
      verified.set(item.sourceId, item);
    }
    return verified;
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
      const thumbnail = searchParams.get('thumbnail') === '1';
      const rawIdx = searchParams.get('imageIndex');
      const imageIndex = rawIdx !== null ? Number(rawIdx) : undefined;
      return readPreview(owner, sourceId, page, includeImage, thumbnail, imageIndex);
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
