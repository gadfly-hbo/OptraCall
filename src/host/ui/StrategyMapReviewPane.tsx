import { useEffect, useRef, useState } from 'react';
import {
  mapEdgeKinds,
  type StrategyMapDraft,
  type StrategyMapEdge,
  type StrategyMapMultiImportSource,
  type StrategyMapNode,
} from '../strategy-map-types.ts';
import {
  downloadMapImportOriginal,
  readMapImportPreview,
  revokeMapImportSource,
  type MapImportPreviewResponse,
} from './strategy-map-import-client.ts';
import {
  findSafeDuplicateCandidates,
  matchesSourcePage,
  matchesSourcePageAndImage,
  mergeDuplicatePairInDraft,
  resolveEmbeddedImageIndex,
  type DuplicateCandidatePair,
  type ManualEditRecord,
} from './strategy-map-review-helpers.ts';

const nodeKindLabels = { goal: '目标', strategy: '策略', other: '其他条目' } as const;

export function StrategyMapReviewPane({
  discussionId,
  draft,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  onChangeDraft,
  onReread,
  onRevoked,
}: {
  discussionId: string;
  draft: StrategyMapDraft;
  selectedNodeId: string;
  selectedEdgeId?: string;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onChangeDraft: (next: StrategyMapDraft, editRecord?: ManualEditRecord) => void;
  onReread?: (prompt: string, importSourceIds: string[], selectedPagesBySource?: Record<string, number[]>) => void;
  onRevoked?: () => void;
}) {
  const sources: StrategyMapMultiImportSource[] = draft.importSources ?? [];
  const [sourceId, setSourceId] = useState(sources[0]?.sourceId ?? '');
  const [page, setPage] = useState(sources[0]?.selectedPages?.[0] ?? 1);
  const [imageIndex, setImageIndex] = useState<number>(1);
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState<MapImportPreviewResponse>();
  const [loadedKey, setLoadedKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [mobilePane, setMobilePane] = useState<'source' | 'candidate'>('candidate');
  const [rereadText, setRereadText] = useState('');
  const [dupCandidates, setDupCandidates] = useState<DuplicateCandidatePair[] | null>(null);
  const [locateSeq, setLocateSeq] = useState(0);
  const pendingImageSyncRef = useRef<{ sourceId: string; page: number; loc: StrategyMapNode['sourceLocation'] } | null>(null);
  const activePreviewKey = `${discussionId}:${sourceId}:${page}:${imageIndex}`;

  function focusNode(id: string) {
    onSelectNode(id);
    setLocateSeq(s => s + 1);
  }
  function focusEdge(id: string) {
    onSelectEdge(id);
    setLocateSeq(s => s + 1);
  }

  // Sync active sourceId if sources list changed (e.g. new draft arrived)
  useEffect(() => {
    if (!sources.length) {
      setSourceId('');
      return;
    }
    if (!sources.some(s => s.sourceId === sourceId)) {
      setSourceId(sources[0]!.sourceId);
      setPage(sources[0]!.selectedPages?.[0] ?? 1);
      setImageIndex(1);
    }
  }, [sources.map(s => s.sourceId).join(',')]);

  // Auto-sync left source/page/same-sheet embedded image when user selects or re-clicks a node or edge
  useEffect(() => {
    const node = draft.nodes.find(n => n.id === selectedNodeId);
    const edge = draft.edges.find(e => e.id === selectedEdgeId);
    const loc = selectedEdgeId ? edge?.sourceLocation : node?.sourceLocation;
    if (!loc) {
      pendingImageSyncRef.current = null;
      return;
    }
    const targetSourceId = loc.sourceId && sources.some(s => s.sourceId === loc.sourceId) ? loc.sourceId : sourceId;
    const targetPage = loc.page && loc.page >= 1 ? loc.page : page;
    let switched = false;
    if (targetSourceId && targetSourceId !== sourceId) {
      setSourceId(targetSourceId);
      setImageIndex(1);
      switched = true;
    }
    if (targetPage !== page) {
      setPage(targetPage);
      setImageIndex(1);
      switched = true;
    }
    if (
      !switched &&
      preview &&
      preview.source.sourceId === targetSourceId &&
      preview.currentPage.page === targetPage &&
      preview.currentPage.embeddedImages &&
      preview.currentPage.embeddedImages.length > 1
    ) {
      const targetImg = resolveEmbeddedImageIndex(loc, preview.currentPage.embeddedImages);
      if (targetImg !== undefined && targetImg !== imageIndex) setImageIndex(targetImg);
      pendingImageSyncRef.current = null;
    } else if (targetSourceId) {
      pendingImageSyncRef.current = { sourceId: targetSourceId, page: targetPage, loc };
    }
  }, [selectedNodeId, selectedEdgeId, locateSeq]);

  // Complete deferred same-sheet image switch once target page preview loads (never overrides manual switches)
  useEffect(() => {
    const pending = pendingImageSyncRef.current;
    if (!pending || !preview) return;
    if (preview.source.sourceId !== pending.sourceId || preview.currentPage.page !== pending.page) return;
    pendingImageSyncRef.current = null;
    if (preview.currentPage.embeddedImages && preview.currentPage.embeddedImages.length > 1) {
      const targetImg = resolveEmbeddedImageIndex(pending.loc, preview.currentPage.embeddedImages);
      if (targetImg !== undefined && targetImg !== imageIndex) setImageIndex(targetImg);
    }
  }, [preview?.source.sourceId, preview?.currentPage.page, preview?.currentPage.embeddedImages?.length]);

  useEffect(() => {
    if (!sourceId) return;
    const controller = new AbortController();
    const requestKey = `${discussionId}:${sourceId}:${page}:${imageIndex}`;
    setLoading(true);
    setError('');
    readMapImportPreview(discussionId, sourceId, page, true, controller.signal, imageIndex > 1 ? { imageIndex } : undefined)
      .then(res => { if (!controller.signal.aborted) { setPreview(res); setLoadedKey(requestKey); } })
      .catch(e => { if (!controller.signal.aborted) { setPreview(undefined); setLoadedKey(''); setError(e instanceof Error ? e.message : '原稿预览暂不可用。'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [discussionId, sourceId, page, imageIndex]);

  const allItems = [...draft.nodes, ...draft.edges];
  const clearCount = allItems.filter(item => item.reviewState === 'clear').length;
  const reviewCount = allItems.filter(item => item.reviewState === 'needs-review').length;
  const confirmedCount = allItems.filter(item => item.reviewState === 'confirmed').length;

  const selectedEdge = selectedEdgeId ? draft.edges.find(e => e.id === selectedEdgeId) : undefined;
  const selectedNode = !selectedEdge ? draft.nodes.find(n => n.id === selectedNodeId) : undefined;

  function acceptAllClear() {
    const clearNodeIds = draft.nodes.filter(n => n.reviewState === 'clear').map(n => n.id);
    const clearEdgeIds = draft.edges.filter(e => e.reviewState === 'clear').map(e => e.id);
    onChangeDraft(
      {
        ...draft,
        nodes: draft.nodes.map(n => (n.reviewState === 'clear' ? { ...n, reviewState: 'confirmed' } : n)),
        edges: draft.edges.map(e => (e.reviewState === 'clear' ? { ...e, reviewState: 'confirmed' } : e)),
      },
      { kind: 'batch-confirm-clear', nodeIds: clearNodeIds, edgeIds: clearEdgeIds },
    );
    setStatus(`已批量保留 ${clearCount} 项清楚内容，请集中核对剩余待核项。`);
  }

  function updateNodeField(id: string, patch: Partial<StrategyMapNode>) {
    onChangeDraft(
      {
        ...draft,
        nodes: draft.nodes.map(n => (n.id === id ? { ...n, ...patch } : n)),
      },
      { kind: 'node-patch', id, patch },
    );
  }

  function addManualNode(kind: StrategyMapNode['kind']) {
    const prefix = { goal: 'G', strategy: 'S', other: 'N' }[kind];
    let idx = 1;
    while (draft.nodes.some(n => n.id === `${prefix}${idx}`)) idx++;
    const newNode: StrategyMapNode = {
      id: `${prefix}${idx}`,
      kind,
      title: kind === 'goal' ? '手工补录目标' : kind === 'strategy' ? '手工补录策略' : '手工补录条目',
      reviewState: 'confirmed',
      ...(sourceId ? { sourceLocation: { sourceId, page, label: `人工补录 · 第 ${page} 页` } } : {}),
    };
    onChangeDraft({ ...draft, nodes: [...draft.nodes, newNode] }, { kind: 'node-add', node: newNode });
    onSelectNode(newNode.id);
  }

  function updateEdgeField(id: string, patch: Partial<StrategyMapEdge>) {
    onChangeDraft(
      {
        ...draft,
        edges: draft.edges.map(e => (e.id === id ? { ...e, ...patch } : e)),
      },
      { kind: 'edge-patch', id, patch },
    );
  }

  function flipEdge(edge: StrategyMapEdge) {
    // Flipping direction never silently reclassifies an 'unknown' relation as 'supports'
    const patch: Partial<StrategyMapEdge> = {
      from: edge.to,
      to: edge.from,
      ...(edge.kind === 'unknown'
        ? { reviewState: 'needs-review', ambiguityReason: '连线方向已翻转；关系类型仍为未知，请明确选择关系类型后再确认。' }
        : { reviewState: 'confirmed', ambiguityReason: '连线方向已由人工翻转确认。' }),
    };
    updateEdgeField(edge.id, patch);
    setStatus(`已翻转连线：${edge.to} → ${edge.from}${edge.kind === 'unknown' ? '（关系类型仍待选择）' : ''}`);
  }

  function runSafeDedupeCheck() {
    const pairs = findSafeDuplicateCandidates(draft.nodes);
    if (!pairs.length) {
      setDupCandidates(null);
      setStatus('未发现重复条目（分客群、分方案或不同口径条目均已保留）。');
      return;
    }
    setDupCandidates(pairs);
    setStatus(`发现 ${pairs.length} 组疑似重复条目，请逐项确认合并或分别保留。`);
  }

  function confirmMergePair(pair: DuplicateCandidatePair) {
    const next = mergeDuplicatePairInDraft(draft, pair.keep.id, pair.duplicate.id);
    onChangeDraft(next, { kind: 'merge-duplicate', keepId: pair.keep.id, dropId: pair.duplicate.id });
    setDupCandidates(old => {
      const rest = (old ?? []).filter(p => p.duplicate.id !== pair.duplicate.id && p.keep.id !== pair.duplicate.id);
      return rest.length ? rest : null;
    });
    setStatus(`已按你的确认合并 ${pair.duplicate.id} 到 ${pair.keep.id}。`);
  }

  function dismissDuplicatePair(pair: DuplicateCandidatePair) {
    setDupCandidates(old => {
      const rest = (old ?? []).filter(p => !(p.keep.id === pair.keep.id && p.duplicate.id === pair.duplicate.id));
      return rest.length ? rest : null;
    });
    setStatus(`已保留 ${pair.keep.id} 与 ${pair.duplicate.id} 为独立条目。`);
  }

  async function handleDownload() {
    if (!sourceId) return;
    try {
      const res = await downloadMapImportOriginal(discussionId, sourceId);
      const raw = Uint8Array.from(atob(res.bytes), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([raw], { type: res.mimeType }));
      const a = document.createElement('a');
      a.href = url;
      a.download = res.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '原文件下载失败。');
    }
  }

  async function handleRevoke() {
    if (!sourceId) return;
    try {
      await revokeMapImportSource(discussionId, sourceId);
      setPreview(undefined);
      setStatus('已撤权：后续读取与发往模型已停止。');
      onRevoked?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : '撤权未完成。');
    }
  }

  const visibleNodes = onlyNeedsReview ? draft.nodes.filter(n => n.reviewState === 'needs-review') : draft.nodes;
  const visibleEdges = onlyNeedsReview ? draft.edges.filter(e => e.reviewState === 'needs-review') : draft.edges;
  // Strict sourceId + page + same-sheet embedded image hotspot isolation
  const sheetImages = preview?.currentPage.embeddedImages ?? [];
  const pageNodes = draft.nodes.filter(n => matchesSourcePage(n.sourceLocation, sourceId, page));
  const overlayNodes = draft.nodes.filter(n =>
    matchesSourcePageAndImage(n.sourceLocation, sourceId, page, imageIndex, sheetImages),
  );
  const overlayEdges = draft.edges.filter(e =>
    matchesSourcePageAndImage(e.sourceLocation, sourceId, page, imageIndex, sheetImages),
  );

  return (
    <div className="map-review-workspace">
      <div className="map-mobile-pane-tabs">
        <button type="button" className={mobilePane === 'source' ? 'primary-button' : 'secondary-button'} onClick={() => setMobilePane('source')}>查看原稿</button>
        <button type="button" className={mobilePane === 'candidate' ? 'primary-button' : 'secondary-button'} onClick={() => setMobilePane('candidate')}>核对候选</button>
      </div>

      <div className="map-review-split" data-mobile-pane={mobilePane}>
        {/* LEFT: Original Source Canvas & Bidirectional Highlight */}
        <section className="map-source-pane" aria-label="原稿对照">
          <div className="sg-row-between map-pane-head">
            <div className="sg-row">
              {sources.length > 1 ? (
                <select
                  className="sg-select"
                  aria-label="切换原稿来源"
                  value={sourceId}
                  onChange={e => {
                    const nextId = e.target.value;
                    const nextSrc = sources.find(s => s.sourceId === nextId);
                    pendingImageSyncRef.current = null;
                    setSourceId(nextId);
                    setPage(nextSrc?.selectedPages?.[0] ?? 1);
                    setImageIndex(1);
                  }}
                >
                  {sources.map(s => <option key={s.sourceId} value={s.sourceId}>{s.fileName}</option>)}
                </select>
              ) : (
                <strong>原稿 · {sources[0]?.fileName ?? '未绑定多格式原稿'}</strong>
              )}
            </div>
            <div className="sg-row">
              <button type="button" className="text-button" onClick={() => setZoom(z => Math.max(0.75, +(z - 0.15).toFixed(2)))}>－</button>
              <span className="sg-muted">{Math.round(zoom * 100)}%</span>
              <button type="button" className="text-button" onClick={() => setZoom(z => Math.min(1.5, +(z + 0.15).toFixed(2)))}>＋</button>
              {sourceId && <button type="button" className="text-button" onClick={() => void handleDownload()}>下载原件</button>}
              {sourceId && <button type="button" className="text-button" onClick={() => void handleRevoke()}>撤权停读</button>}
            </div>
          </div>

          {preview && preview.pages.length > 1 && (
            <div className="sg-row map-page-strip">
              {preview.pages.map(p => (
                <button
                  key={p.page}
                  type="button"
                  className={p.page === page ? 'primary-button' : 'secondary-button'}
                  onClick={() => { pendingImageSyncRef.current = null; setPage(p.page); setImageIndex(1); }}
                >
                  P{p.page}
                </button>
              ))}
            </div>
          )}

          {sheetImages.length > 1 && (
            <div className="sg-row map-page-strip" aria-label="本工作表嵌入图片切换">
              {sheetImages.map((img, idx) => (
                <button
                  key={img.id}
                  type="button"
                  data-sheet-image-index={idx + 1}
                  aria-pressed={imageIndex === idx + 1}
                  className={imageIndex === idx + 1 ? 'primary-button' : 'secondary-button'}
                  onClick={() => { pendingImageSyncRef.current = null; setImageIndex(idx + 1); }}
                >
                  图 {idx + 1} · {img.name}
                </button>
              ))}
            </div>
          )}

          <div className="map-source-canvas">
            {(loading || (preview && loadedKey !== activePreviewKey)) && <p role="status" className="sg-muted">正在读取原稿预览…</p>}
            {error && <p role="alert" className="case-error">{error}</p>}
            {!loading && !error && preview && loadedKey === activePreviewKey && (
              preview.image.available && preview.image.base64 ? (
                <div className="map-source-img-wrap" style={{ transform: `scale(${zoom})` }}>
                  <img
                    src={`data:${preview.image.mimeType};base64,${preview.image.base64}`}
                    alt={`${preview.source.fileName} 第 ${page} 页`}
                    className="map-source-img"
                  />
                  <svg className="map-source-overlay" data-active-image-index={imageIndex} viewBox="0 0 1000 1000" preserveAspectRatio="none">
                    {overlayNodes.filter(n => n.sourceLocation?.bbox).map(n => {
                      const [x, y, w, h] = n.sourceLocation!.bbox!;
                      const isSel = selectedNode?.id === n.id || selectedEdge?.from === n.id || selectedEdge?.to === n.id;
                      return (
                        <rect
                          key={n.id}
                          data-hotspot-node={n.id}
                          data-hotspot-source={n.sourceLocation!.sourceId}
                          x={x} y={y} width={w} height={h}
                          fill={isSel ? 'rgba(101,80,201,0.18)' : n.reviewState === 'needs-review' ? 'rgba(229,190,116,0.22)' : 'rgba(101,80,201,0.06)'}
                          stroke={isSel ? '#6550c9' : n.reviewState === 'needs-review' ? '#c98212' : '#7a7890'}
                          strokeWidth={isSel ? 8 : 4}
                          strokeDasharray={n.reviewState === 'needs-review' ? '14 8' : undefined}
                          style={{ cursor: 'pointer' }}
                          onClick={() => onSelectNode(n.id)}
                        />
                      );
                    })}
                    {overlayEdges.filter(e => e.sourceLocation?.arrowBbox).map(e => {
                      const [x, y, w, h] = e.sourceLocation!.arrowBbox!;
                      const isSel = selectedEdge?.id === e.id;
                      return (
                        <rect
                          key={e.id}
                          data-hotspot-edge={e.id}
                          data-hotspot-source={e.sourceLocation!.sourceId}
                          x={x} y={y} width={w} height={h}
                          fill={isSel ? 'rgba(101,80,201,0.25)' : 'rgba(229,190,116,0.25)'}
                          stroke={isSel ? '#6550c9' : '#c98212'}
                          strokeWidth={isSel ? 8 : 5}
                          strokeDasharray="10 6"
                          style={{ cursor: 'pointer' }}
                          onClick={() => onSelectEdge(e.id)}
                        />
                      );
                    })}
                  </svg>
                </div>
              ) : (
                <div className="map-source-fallback">
                  {preview.image.reason && <p className="sg-muted">{preview.image.reason}</p>}
                  {preview.currentPage.shapes.length > 0 ? (
                    <svg className="map-source-svg" viewBox="0 0 1000 1000" style={{ transform: `scale(${zoom})` }}>
                      {preview.currentPage.shapes.map((sh, idx) => {
                        const [x, y, w, h] = sh.bbox ?? [40 + (idx % 2) * 480, 40 + Math.floor(idx / 2) * 180, 420, 130];
                        const linked = pageNodes.find(n => n.sourceLocation?.objectId === sh.objectId);
                        const isSel = linked && (selectedNode?.id === linked.id || selectedEdge?.from === linked.id || selectedEdge?.to === linked.id);
                        return (
                          <g key={sh.objectId} data-fallback-shape={sh.objectId} style={{ cursor: linked ? 'pointer' : 'default' }} onClick={() => linked && onSelectNode(linked.id)}>
                            <rect
                              x={x} y={y} width={Math.max(120, w)} height={Math.max(80, h)}
                              rx="10"
                              fill={isSel ? '#eeebfb' : sh.kind === 'chart' ? '#fff7e6' : '#f8f8fb'}
                              stroke={isSel ? '#6550c9' : sh.kind === 'chart' ? '#c98212' : '#9c9ab0'}
                              strokeWidth={isSel ? 6 : 3}
                            />
                            <text x={x + 14} y={y + 34} fontSize="24" fontWeight="600" fill="#24232b">
                              {sh.text.slice(0, 26)}
                            </text>
                            <text x={x + 14} y={y + 68} fontSize="20" fill="#6c6b78">
                              {sh.name} {linked ? `→ ${linked.id}` : ''}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  ) : (
                    <pre className="map-source-text">{preview.currentPage.text || '当前页无文字层，请对照原件或切换视觉模型。'}</pre>
                  )}
                </div>
              )
            )}
          </div>

          {preview && (
            <div className="sg-muted map-source-foot">
              SHA-256 {preview.source.sha256.slice(0, 16)} · {preview.currentPage.title}
              {!preview.vision.supportsImages && ' · 当前模型仅支持纯文本'}
            </div>
          )}
        </section>

        {/* RIGHT: Batch Review Controls, Filter, Conflicts, Flip Edge, Local Reread */}
        <section className="map-candidate-pane" aria-label="候选核对">
          <div className="sg-row-between map-pane-head">
            <div className="sg-row">
              <span className="sg-badge">清楚 {clearCount} · 已确认 {confirmedCount}</span>
              <span className={`sg-badge ${reviewCount ? 'pending' : ''}`}>待核 {reviewCount}</span>
            </div>
            <div className="sg-row">
              <button type="button" className="secondary-button" disabled={clearCount === 0} onClick={acceptAllClear}>
                {clearCount > 0 ? `一键保留清楚项 (${clearCount})` : '清楚项已全部保留'}
              </button>
              <button type="button" className="secondary-button" onClick={() => setOnlyNeedsReview(v => !v)}>
                {onlyNeedsReview ? '显示全部' : `仅看待核 (${reviewCount})`}
              </button>
              <button type="button" className="text-button" onClick={runSafeDedupeCheck}>去重检查</button>
            </div>
          </div>

          <div className="map-review-list">
            {dupCandidates && dupCandidates.length > 0 && (
              <div className="map-conflict-box" role="region" aria-label="疑似重复条目确认">
                <strong>发现 {dupCandidates.length} 组疑似重复条目（由你决定合并或分别保留）：</strong>
                {dupCandidates.map(pair => (
                  <div key={`${pair.keep.id}:${pair.duplicate.id}`} className="sg-row-between" style={{ marginTop: 6 }}>
                    <span>{pair.keep.id}（{pair.keep.title}）与 {pair.duplicate.id}（{pair.duplicate.title}）· {pair.reason}</span>
                    <span className="sg-row">
                      <button type="button" className="secondary-button" onClick={() => confirmMergePair(pair)}>合并为 {pair.keep.id}</button>
                      <button type="button" className="text-button" onClick={() => dismissDuplicatePair(pair)}>保留两项</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {draft.nodes.length === 0 && (
              <div className="map-conflict-box" role="status">
                <strong>当前草稿暂无自动识别出的节点（待核草稿）：</strong>
                <p style={{ margin: '4px 0 8px' }}>{draft.unknowns || '原稿无文字层或当前模型未能识别节点，请切换视觉模型重读，或对照左侧原稿手工补录。'}</p>
                <div className="sg-row">
                  <button type="button" className="secondary-button" onClick={() => addManualNode('goal')}>＋ 手工补录目标</button>
                  <button type="button" className="secondary-button" onClick={() => addManualNode('strategy')}>＋ 手工补录策略</button>
                </div>
              </div>
            )}

            <div className="sg-table-scroll">
              <table className="sg-table">
                <thead>
                  <tr><th>条目</th><th>类型</th><th>数值口径</th><th>出处与状态</th></tr>
                </thead>
                <tbody>
                  {visibleNodes.length ? visibleNodes.map(n => (
                    <tr
                      key={n.id}
                      className={`${selectedNode?.id === n.id ? 'map-row-selected' : ''} ${n.reviewState === 'needs-review' ? 'map-row-review' : ''}`}
                      onClick={() => focusNode(n.id)}
                    >
                      <td><strong>{n.id} · {n.title}</strong></td>
                      <td>{nodeKindLabels[n.kind]}</td>
                      <td>{n.metric || '—'} · {n.baseline === undefined || n.baseline === '' ? '待定' : n.baseline} {n.baselineKind ?? ''} → {n.target === undefined || n.target === '' ? '待定' : n.target} {n.unit ?? ''}</td>
                      <td>{n.sourceLocation?.label ?? '—'} · {n.reviewState === 'needs-review' ? '待核' : n.reviewState === 'confirmed' ? '已确认' : '清楚'}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="sg-muted">{draft.nodes.length === 0 ? '尚无节点，可点击上方按钮手工补录或先保存待核草稿。' : '当前筛选下已无待核条目。'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="map-review-edges">
              <strong className="sg-muted">提取连线（点击高亮原稿两端与箭头；可见箭头 ≠ 因果）</strong>
              <ul className="map-edge-list">
                {visibleEdges.map(e => (
                  <li
                    key={e.id}
                    className={`${selectedEdge?.id === e.id ? 'map-row-selected' : ''} ${e.reviewState === 'needs-review' ? 'map-row-review' : ''}`}
                    onClick={() => focusEdge(e.id)}
                  >
                    <span><strong>{e.from} → {e.to}</strong> · {mapEdgeKinds[e.kind]}</span>
                    <small>{e.sourceLocation?.label ?? ''} · {e.reviewState === 'needs-review' ? '待核' : e.reviewState === 'confirmed' ? '已确认' : '清楚'}</small>
                  </li>
                ))}
              </ul>
            </div>

            {/* Selected Node / Edge Quick Inspector */}
            {selectedNode && (
              <div className="map-inspector">
                <div className="sg-row-between">
                  <strong>核对条目 · {selectedNode.id}</strong>
                  <div className="sg-row">
                    {selectedNode.reviewState !== 'confirmed' && (
                      <button type="button" className="secondary-button" onClick={() => updateNodeField(selectedNode.id, { reviewState: 'confirmed' })}>确认此项</button>
                    )}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        onChangeDraft(
                          {
                            ...draft,
                            nodes: draft.nodes.filter(x => x.id !== selectedNode.id),
                            edges: draft.edges.filter(x => x.from !== selectedNode.id && x.to !== selectedNode.id),
                          },
                          { kind: 'node-delete', id: selectedNode.id },
                        );
                      }}
                    >
                      删除误项
                    </button>
                  </div>
                </div>
                {selectedNode.ambiguityReason && <p className="map-conflict-box">待核原因：{selectedNode.ambiguityReason}</p>}
                {selectedNode.sourceConflicts?.map((conflict, idx) => (
                  <div key={idx} className="map-conflict-box">
                    <strong>源表与图上数值不一致（并列原值）：</strong>
                    <div className="sg-row">
                      {conflict.values.map((v, vIdx) => (
                        <button
                          key={vIdx}
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            updateNodeField(selectedNode.id, {
                              [conflict.field]: v.value,
                              reviewState: 'confirmed',
                              ambiguityReason: `已采纳 ${v.label}（${v.locationLabel}）`,
                            } as Partial<StrategyMapNode>);
                            setStatus(`已采纳 ${v.label}`);
                          }}
                        >
                          采纳 {v.label} · {v.locationLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="map-edit-grid">
                  <label>条目名称<input value={selectedNode.title} onChange={e => updateNodeField(selectedNode.id, { title: e.target.value })} /></label>
                  <label>类型
                    <select value={selectedNode.kind} onChange={e => updateNodeField(selectedNode.id, { kind: e.target.value as StrategyMapNode['kind'] })}>
                      {Object.entries(nodeKindLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label>指标<input value={selectedNode.metric ?? ''} onChange={e => updateNodeField(selectedNode.id, { metric: e.target.value })} /></label>
                  <label>基线（0 保留，空=待定）<input value={selectedNode.baseline ?? ''} onChange={e => updateNodeField(selectedNode.id, { baseline: e.target.value })} /></label>
                  <label>基线性质
                    <select value={selectedNode.baselineKind ?? ''} onChange={e => updateNodeField(selectedNode.id, { baselineKind: e.target.value })}>
                      <option value="">待定</option>
                      <option value="实测基线">实测基线</option>
                      <option value="估计基线">估计基线</option>
                    </select>
                  </label>
                  <label>目标值（空=待定）<input value={selectedNode.target ?? ''} onChange={e => updateNodeField(selectedNode.id, { target: e.target.value })} /></label>
                  <label>单位<input value={selectedNode.unit ?? ''} onChange={e => updateNodeField(selectedNode.id, { unit: e.target.value })} /></label>
                </div>
              </div>
            )}

            {selectedEdge && (
              <div className="map-inspector">
                <div className="sg-row-between">
                  <strong>核对连线 · {selectedEdge.from} → {selectedEdge.to}</strong>
                  <div className="sg-row">
                    <button type="button" className="secondary-button" onClick={() => flipEdge(selectedEdge)}>⇄ 翻转方向</button>
                    {selectedEdge.reviewState !== 'confirmed' && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={selectedEdge.kind === 'unknown'}
                        title={selectedEdge.kind === 'unknown' ? '请先在下方明确选择具体关系类型，系统不会自动把未知关系改为支持' : undefined}
                        onClick={() => {
                          if (selectedEdge.kind === 'unknown') return;
                          updateEdgeField(selectedEdge.id, { reviewState: 'confirmed' });
                        }}
                      >
                        确认此连线
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        onChangeDraft(
                          { ...draft, edges: draft.edges.filter(x => x.id !== selectedEdge.id) },
                          { kind: 'edge-delete', id: selectedEdge.id },
                        )
                      }
                    >
                      删除连线
                    </button>
                  </div>
                </div>
                {selectedEdge.kind === 'unknown' && (
                  <p className="map-conflict-box">
                    当前连线关系仍为「未知关系（待核）」，请先在下方“关系类型”明确选择具体关系后再确认（系统不会自动改为支持）。
                  </p>
                )}
                {selectedEdge.ambiguityReason && <p className="map-conflict-box">待核原因：{selectedEdge.ambiguityReason}</p>}
                <div className="map-edit-grid">
                  <label>起点
                    <select value={selectedEdge.from} onChange={e => updateEdgeField(selectedEdge.id, { from: e.target.value })}>
                      {draft.nodes.map(n => <option key={n.id} value={n.id}>{n.id} · {n.title}</option>)}
                    </select>
                  </label>
                  <label>终点
                    <select value={selectedEdge.to} onChange={e => updateEdgeField(selectedEdge.id, { to: e.target.value })}>
                      {draft.nodes.map(n => <option key={n.id} value={n.id}>{n.id} · {n.title}</option>)}
                    </select>
                  </label>
                  <label>关系类型（可见箭头 ≠ 因果）
                    <select
                      value={selectedEdge.kind}
                      onChange={e => {
                        const nextKind = e.target.value as StrategyMapEdge['kind'];
                        updateEdgeField(selectedEdge.id, {
                          kind: nextKind,
                          reviewState: nextKind === 'unknown' ? 'needs-review' : 'confirmed',
                        });
                      }}
                    >
                      {Object.entries(mapEdgeKinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            )}

            {/* Natural Language Local Reread */}
            {onReread && sources.length > 0 && (
              <div className="map-reread-bar">
                <label>
                  用自然语言让原战略 Agent 重读一页或一条线（保留你当前全部手工修改）
                  <div className="sg-row">
                    <input
                      value={rereadText}
                      placeholder="例如：重读第 4 页被遮挡的箭头，仅更新该连线"
                      onChange={e => setRereadText(e.target.value)}
                    />
                    <button
                      type="button"
                      className="primary-button"
                      disabled={!rereadText.trim()}
                      onClick={() => {
                        const pagesBySource: Record<string, number[]> = {};
                        for (const s of sources) {
                          if (s.selectedPages?.length) pagesBySource[s.sourceId] = s.selectedPages;
                        }
                        onReread(
                          rereadText.trim(),
                          sources.map(s => s.sourceId),
                          Object.keys(pagesBySource).length ? pagesBySource : undefined,
                        );
                        setRereadText('');
                      }}
                    >
                      局部重读
                    </button>
                  </div>
                </label>
              </div>
            )}

            {status && <p role="status" className="sg-muted">{status}</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
