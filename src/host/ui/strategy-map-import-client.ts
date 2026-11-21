import type { DecodedStrategyMapImport, ParsedImportPage, RenderedPageImageResult } from '../strategy-map-import.ts';
import type { StoredMapImportSource } from '../strategy-map-import-store.ts';
import type { StrategyMapImportCandidateFile } from '../strategy-map-import-routes.ts';
import { StrategyDiscussionRequestError } from './strategy-discussion-client.ts';

export interface MapImportVisionCapability {
  supportsImages: boolean;
  model: string;
  provider: string;
  reason?: string;
}

export interface MapImportLibraryResponse {
  sources: StoredMapImportSource[];
  reusable: StrategyMapImportCandidateFile[];
  vision: MapImportVisionCapability;
}

export interface MapImportRegisterResponse {
  source: StoredMapImportSource;
  decoded: DecodedStrategyMapImport;
  vision: MapImportVisionCapability;
}

export interface MapImportPreviewResponse {
  source: StoredMapImportSource;
  pageCount: number;
  pages: Array<{
    page: number;
    title: string;
    hasTextLayer: boolean;
    needsVisualReview: boolean;
    shapeCount: number;
    connectorCount: number;
  }>;
  currentPage: ParsedImportPage;
  image: RenderedPageImageResult;
  imageMeta?: { width: number; height: number; orientation: number; mimeType: 'image/png' | 'image/jpeg' };
  vision: MapImportVisionCapability;
}

const errorMessages: Readonly<Record<string, string>> = {
  strategy_map_import_format_unsupported: '请选择 Excel（.xlsx）、PowerPoint（.pptx）、PDF（.pdf）或图片（.png/.jpg/.jpeg）。',
  strategy_map_import_too_large: '单份导入原稿须在 16 MiB 以内。',
  strategy_map_import_invalid_image: '图片文件无法读取或格式与扩展名不一致，请核对原图。',
  strategy_map_import_invalid_document: '文档结构无法解析，请确认原文件未损坏或加密。',
  strategy_map_import_pdf_unreadable: 'PDF 无法读取，请检查是否加密或损坏。',
  strategy_map_import_revoked: '此导入来源已撤权，已停止后续读取与发送。',
  strategy_map_import_not_authorized: '当前讨论无权读取此来源，请核对项目归属或讨论权限。',
  strategy_map_import_source_changed: '原文件指纹已变化，请重新核对原件。',
  strategy_map_import_source_unavailable: '原文件当前不可读取，请核对存储位置。',
  session_busy: '当前讨论正在运行，请等待本轮完成或停止后再操作。',
};

async function mapImportRequest<T>(
  discussionId: string,
  suffix = '',
  method = 'GET',
  input?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const url = `/api/strategy/discussions/${encodeURIComponent(discussionId)}/map-imports${suffix}`;
  let response: Response;
  let value: Record<string, unknown>;
  try {
    response = await fetch(url, {
      method,
      mode: 'same-origin',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-optracall-client': '1' },
      ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
      ...(signal ? { signal } : {}),
    });
    value = await response.json();
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new StrategyDiscussionRequestError('strategy_map_import_request_failed', 0, method !== 'GET', '导入服务暂时不可用，请重试。');
  }
  if (!response.ok) {
    const code = typeof value.code === 'string' ? value.code : 'strategy_map_import_failed';
    throw new StrategyDiscussionRequestError(
      code,
      response.status,
      method !== 'GET' && response.status >= 500,
      errorMessages[code] || (typeof value.message === 'string' ? value.message : code),
    );
  }
  return value as T;
}

export const listMapImportLibrary = (discussionId: string, signal?: AbortSignal) =>
  mapImportRequest<MapImportLibraryResponse>(discussionId, '', 'GET', undefined, signal);

export const registerMapImportUpload = (discussionId: string, fileName: string, bytes: string) =>
  mapImportRequest<MapImportRegisterResponse>(discussionId, '', 'POST', { kind: 'upload', fileName, bytes });

export const registerMapImportAttachment = (discussionId: string, attachmentSourceId: string) =>
  mapImportRequest<MapImportRegisterResponse>(discussionId, '', 'POST', { kind: 'attachment', attachmentSourceId });

export const registerMapImportProjectFile = (discussionId: string, uploadId: string) =>
  mapImportRequest<MapImportRegisterResponse>(discussionId, '', 'POST', { kind: 'project-file', uploadId });

export const readMapImportPreview = (
  discussionId: string,
  sourceId: string,
  page = 1,
  includeImage = true,
  signal?: AbortSignal,
) =>
  mapImportRequest<MapImportPreviewResponse>(
    discussionId,
    `/${encodeURIComponent(sourceId)}/preview?page=${page}&includeImage=${includeImage ? '1' : '0'}`,
    'GET',
    undefined,
    signal,
  );

export const revokeMapImportSource = (discussionId: string, sourceId: string) =>
  mapImportRequest<{ source: StoredMapImportSource }>(discussionId, `/${encodeURIComponent(sourceId)}/revoke`, 'POST', {});

export const downloadMapImportOriginal = (discussionId: string, sourceId: string) =>
  mapImportRequest<{ fileName: string; mimeType: string; sha256: string; bytes: string }>(
    discussionId,
    `/${encodeURIComponent(sourceId)}/download`,
    'GET',
  );
