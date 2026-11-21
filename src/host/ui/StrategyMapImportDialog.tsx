import { useEffect, useId, useRef, useState } from 'react';
import { mapTemplates } from '../strategy-map-types.ts';
import type { StrategyMapDraft } from '../strategy-map-types.ts';
import type { StrategyMapImportCandidateFile } from '../strategy-map-import-routes.ts';
import type { ParsedImportPage, RenderedPageImageResult } from '../strategy-map-import.ts';
import {
  listMapImportLibrary,
  readMapImportPreview,
  registerMapImportAttachment,
  registerMapImportProjectFile,
  registerMapImportUpload,
  type MapImportLibraryResponse,
  type MapImportRegisterResponse,
} from './strategy-map-import-client.ts';
import { CaseDialog } from './CaseDialogs.tsx';
import { fileBase64 } from './runtime-client.ts';

export interface StrategyMapExtractRequest {
  sourceId: string;
  fileName: string;
  format: 'xlsx' | 'pptx' | 'pdf' | 'image';
  selectedPages: number[];
  template: StrategyMapDraft['template'];
  prompt: string;
}

function MiniWireframeThumb({ page }: { page: ParsedImportPage }) {
  if (page.shapes.length > 0) {
    return (
      <svg className="map-import-thumb-svg" viewBox="0 0 1000 1000" aria-hidden="true">
        {page.shapes.slice(0, 12).map((sh, idx) => {
          const [x, y, w, h] = sh.bbox ?? [60 + (idx % 2) * 460, 80 + Math.floor(idx / 2) * 160, 420, 120];
          return (
            <rect
              key={sh.objectId}
              x={x}
              y={y}
              width={Math.max(80, w)}
              height={Math.max(50, h)}
              rx="18"
              fill={sh.kind === 'chart' ? 'rgba(201,130,18,0.18)' : 'rgba(101,80,201,0.12)'}
              stroke={sh.kind === 'chart' ? '#c98212' : '#6550c9'}
              strokeWidth="14"
            />
          );
        })}
      </svg>
    );
  }
  return (
    <div className="map-import-thumb-text" aria-hidden="true">
      {(page.text || '无文字层 / 扫描页').slice(0, 72)}
    </div>
  );
}

export function StrategyMapImportDialog({
  open,
  discussionId,
  busy: outerBusy,
  ensureDiscussionId,
  onClose,
  onExtract,
  onOpenExcelFast,
}: {
  open: boolean;
  discussionId?: string;
  busy?: boolean;
  ensureDiscussionId: () => Promise<string>;
  onClose: () => void;
  onExtract: (req: StrategyMapExtractRequest) => Promise<void>;
  onOpenExcelFast?: () => void;
}) {
  const fileInputId = useId();
  const [activeDiscussionId, setActiveDiscussionId] = useState(discussionId);
  const [library, setLibrary] = useState<MapImportLibraryResponse>();
  const [registered, setRegistered] = useState<MapImportRegisterResponse>();
  const [thumbs, setThumbs] = useState<Record<number, RenderedPageImageResult>>({});
  const [thumbFallbackNotice, setThumbFallbackNotice] = useState('');
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [template, setTemplate] = useState<StrategyMapDraft['template']>('table');
  const [extraNote, setExtraNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setRegistered(undefined);
    setThumbs({});
    setThumbFallbackNotice('');
    setSelectedPages([]);
    setExtraNote('');
    setError('');
    setActiveDiscussionId(discussionId);
    if (!discussionId) {
      setLibrary(undefined);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    listMapImportLibrary(discussionId, controller.signal)
      .then(res => { if (!controller.signal.aborted) setLibrary(res); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '无法读取已有资料列表。'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, discussionId]);

  // D02: Load lightweight page thumbnails for multi-page documents (cleanly degrading to wireframe + reason if renderer absent)
  useEffect(() => {
    if (!open || !registered || !activeDiscussionId || registered.decoded.pages.length <= 1) return;
    const controller = new AbortController();
    setThumbs({});
    setThumbFallbackNotice('');
    const sourceId = registered.source.sourceId;
    const pagesToFetch = registered.decoded.pages.slice(0, 12);
    void (async () => {
      for (const p of pagesToFetch) {
        if (controller.signal.aborted) return;
        try {
          const res = await readMapImportPreview(activeDiscussionId, sourceId, p.page, true, controller.signal, { thumbnail: true });
          if (controller.signal.aborted) return;
          setThumbs(prev => ({ ...prev, [p.page]: res.image }));
          if (!res.image.available && res.image.reason) {
            setThumbFallbackNotice(old => old || res.image.reason!);
            // For PPTX/PDF when local renderer is missing on page 1, stop retrying subsequent pages needlessly
            if (registered.source.format === 'pptx' || registered.source.format === 'pdf') break;
          }
        } catch {
          if (controller.signal.aborted) return;
          break;
        }
      }
    })();
    return () => controller.abort();
  }, [open, registered?.source.sourceId, activeDiscussionId]);

  if (!open) return null;

  const busy = Boolean(outerBusy || loading || submitting);

  async function resolveDiscussionId() {
    if (activeDiscussionId) return activeDiscussionId;
    const id = await ensureDiscussionId();
    setActiveDiscussionId(id);
    return id;
  }

  function applyRegistered(res: MapImportRegisterResponse) {
    setRegistered(res);
    const pages = res.decoded.pages;
    const preferred = pages.filter(p => p.shapes.length > 0 || p.needsVisualReview || p.hasTextLayer).map(p => p.page);
    setSelectedPages(preferred.length ? preferred : pages.map(p => p.page));
  }

  async function pickReusable(item: StrategyMapImportCandidateFile) {
    const token = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const id = await resolveDiscussionId();
      const res = item.kind === 'discussion-attachment'
        ? await registerMapImportAttachment(id, item.attachmentSourceId!)
        : await registerMapImportProjectFile(id, item.uploadId!);
      if (token === seq.current) applyRegistered(res);
    } catch (e) {
      if (token === seq.current) setError(e instanceof Error ? e.message : '无法读取所选来源。');
    } finally {
      if (token === seq.current) setLoading(false);
    }
  }

  async function pickLocalFile(file: File) {
    const token = ++seq.current;
    setLoading(true);
    setError('');
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error('单份导入原稿须在 16 MiB 以内。');
      const id = await resolveDiscussionId();
      const base64 = await fileBase64(file);
      const res = await registerMapImportUpload(id, file.name, base64);
      if (token === seq.current) applyRegistered(res);
    } catch (e) {
      if (token === seq.current) setError(e instanceof Error ? e.message : '无法解析所选文件。');
    } finally {
      if (token === seq.current) setLoading(false);
    }
  }

  function togglePage(pageNum: number, checked: boolean) {
    setSelectedPages(prev =>
      checked ? [...new Set([...prev, pageNum])].sort((a, b) => a - b) : prev.filter(p => p !== pageNum),
    );
  }

  async function startExtract() {
    if (!registered || !selectedPages.length || busy) return;
    setSubmitting(true);
    setError('');
    try {
      const pageDesc = registered.decoded.pages.length > 1 ? `第 ${selectedPages.join('、')} 页` : '原稿';
      const defaultPrompt = `请严格在本轮授权页范围内调用 read-import-source 读取已获准原稿「${registered.source.fileName}」（importSourceId: ${registered.source.sourceId}）的${pageDesc}，提取目标（G）、策略（S）、指标与数值（区分基线/目标、估计/实测、零/待定与单位）及连线（区分分解、支持、待验证因果与未知关系；可见箭头不等于因果），并调用 propose-map-draft 返回带精确 sourceLocation、reviewState 与 importSources 的待核草稿（不要直接调用 save-map 写入正式版本，由用户对照原稿核对后一次保存）。清楚项标 clear，遮挡/低清/冲突/跨页同名处标 needs-review 并说明原因；若纯文本模型无法看清扫描图且无可读节点，允许 nodes 为空并在 unknowns 说明。${extraNote.trim() ? `\n补充说明：${extraNote.trim()}` : ''}`;
      await onExtract({
        sourceId: registered.source.sourceId,
        fileName: registered.source.fileName,
        format: registered.source.format,
        selectedPages,
        template,
        prompt: defaultPrompt,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '发起提取未完成，请重试。');
    } finally {
      setSubmitting(false);
    }
  }

  const vision = registered?.vision ?? library?.vision;

  return (
    <CaseDialog
      title="导入线下战略图"
      subtitle="支持 Excel（.xlsx）、PowerPoint（.pptx）、PDF（.pdf）及图片（.png/.jpg）。由原战略 Agent 先提取待核草稿，对照原稿核对后再一次保存。"
      className="sg-workbook-dialog"
      busy={busy}
      onClose={onClose}
    >
      {vision && !vision.supportsImages && (
        <div className="map-import-notice" role="status">
          <strong>当前模型仅支持纯文本（{vision.model || '未配置'}）：</strong>
          {vision.reason || '将优先提取可读文字、单元格与原生形状/连接符；扫描页或图片区域可切换已配置且获准的视觉模型，或先生成待核草稿对照原稿手工核对。'}
        </div>
      )}

      {!registered && (
        <>
          {library && library.reusable.length > 0 && (
            <fieldset>
              <legend>已有讨论附件与关联项目文件（免重复上传）</legend>
              <div className="map-import-source-list">
                {library.reusable.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className="sg-goal-choice"
                    disabled={busy}
                    onClick={() => void pickReusable(item)}
                  >
                    <strong>{item.fileName}</strong>
                    <small>{item.originLabel} · {item.format.toUpperCase()} · {item.sha256.slice(0, 10)}</small>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          <div className="case-field">
            <label htmlFor={fileInputId}>从电脑选择线下战略图（.xlsx / .pptx / .pdf / .png / .jpg）</label>
            <input
              id={fileInputId}
              type="file"
              accept=".xlsx,.pptx,.pdf,.png,.jpg,.jpeg"
              disabled={busy}
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void pickLocalFile(file);
              }}
            />
          </div>

          {onOpenExcelFast && (
            <p className="sg-muted">
              如果是纯结构化 Excel 表且只需按列映射快速生成：
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => { onClose(); onOpenExcelFast(); }}
              >
                改用 #98 结构化 Excel 快速列映射
              </button>
            </p>
          )}
        </>
      )}

      {registered && (
        <div className="map-import-selected">
          <div className="sg-row-between">
            <div>
              <strong>{registered.source.fileName}</strong>
              <p className="sg-muted">
                格式：{registered.source.format.toUpperCase()} · 共 {registered.decoded.pages.length} 页/工作表 · SHA-256 {registered.source.sha256.slice(0, 14)}
              </p>
            </div>
            <button type="button" className="text-button" disabled={busy} onClick={() => setRegistered(undefined)}>
              更换文件
            </button>
          </div>

          {registered.source.format === 'xlsx' && registered.decoded.workbook && onOpenExcelFast && (
            <div className="map-import-notice">
              检测到结构化工作表{registered.decoded.hasDrawings ? '与绘图/嵌入图/图表混排' : ''}。
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => { onClose(); onOpenExcelFast(); }}
              >
                切换 #98 快速列映射导入
              </button>
            </div>
          )}

          {registered.decoded.pages.length > 1 && (
            <fieldset>
              <legend>选择含战略图的页（缩略预览 · 仅读取勾选项）</legend>
              {thumbFallbackNotice && (
                <p className="sg-muted" role="status">{thumbFallbackNotice}</p>
              )}
              <div className="map-import-thumb-grid">
                {registered.decoded.pages.map(p => {
                  const thumb = thumbs[p.page];
                  const checked = selectedPages.includes(p.page);
                  return (
                    <label key={p.page} className={`map-import-thumb-card ${checked ? 'selected' : ''}`}>
                      <div className="map-import-thumb-preview">
                        {thumb?.available && thumb.base64 ? (
                          <img
                            className="map-import-thumb"
                            src={`data:${thumb.mimeType};base64,${thumb.base64}`}
                            alt={`第 ${p.page} 页缩略图`}
                          />
                        ) : (
                          <MiniWireframeThumb page={p} />
                        )}
                      </div>
                      <div className="map-import-thumb-meta">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          onChange={e => togglePage(p.page, e.target.checked)}
                        />
                        <span>
                          <strong>第 {p.page} 页</strong> · {p.title}
                          <small>
                            {p.shapes.length ? `${p.shapes.length} 形状/图表` : ''}
                            {p.connectors.length ? ` · ${p.connectors.length} 连线` : ''}
                            {p.embeddedImages?.length ? ` · ${p.embeddedImages.length} 嵌入图` : ''}
                            {!p.hasTextLayer ? ' · 无文字层（需视觉或手工核对）' : ''}
                          </small>
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div className="case-form-row">
            <label className="case-field">
              默认展示视图
              <select
                className="sg-select"
                value={template}
                disabled={busy}
                onChange={e => setTemplate(e.target.value as StrategyMapDraft['template'])}
              >
                {Object.entries(mapTemplates).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </label>
            <label className="case-field">
              给 Agent 的补充说明（可选）
              <input
                value={extraNote}
                disabled={busy}
                maxLength={500}
                placeholder="例如：第 4 页是方案 A，第 5 页是方案 B，请保持边界"
                onChange={e => setExtraNote(e.target.value)}
              />
            </label>
          </div>
        </div>
      )}

      {loading && <p role="status" className="sg-muted">正在读取并解析原稿结构…</p>}
      {error && <p role="alert" className="case-error">{error}</p>}

      <div className="case-dialog-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button>
        {registered && (
          <button
            type="button"
            className="primary-button"
            disabled={busy || !selectedPages.length}
            onClick={() => void startExtract()}
          >
            {submitting ? '正在发送给原战略 Agent…' : '由原战略 Agent 提取候选'}
          </button>
        )}
      </div>
    </CaseDialog>
  );
}
