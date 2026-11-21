import { useEffect, useState } from 'react';
import {
  mapEdgeKinds,
  type StrategyMapDraft,
  type StrategyMapEdge,
  type StrategyMapMultiImportSource,
  type StrategyMapNode,
  type StrategyMapVersion,
} from '../strategy-map-types.ts';
import {
  downloadMapImportOriginal,
  readMapImportPreview,
  revokeMapImportSource,
  type MapImportPreviewResponse,
} from './strategy-map-import-client.ts';

const nodeKindLabels = { goal: '目标', strategy: '策略', other: '其他条目' } as const;

export function StrategyMapReviewPane({
  discussionId,
  active,
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
  active: StrategyMapVersion;
  draft: StrategyMapDraft;
  selectedNodeId: string;
  selectedEdgeId?: string;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  onChangeDraft: (next: StrategyMapDraft) => void;
  onReread?: (prompt: string, importSourceIds: string[]) => void;
  onRevoked?: () => void;
}) {
  const sources: StrategyMapMultiImportSource[] = draft.importSources ?? active.importSources ?? [];
  const [sourceId, setSourceId] = useState(sources[0]?.sourceId ?? '');
  const [page, setPage] = useState(sources[0]?.selectedPages?.[0] ?? 1);
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState<MapImportPreviewResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [onlyNeedsReview, setOnlyNeedsReview] = useState(false);
  const [mobilePane, setMobilePane] = useState<'source' | 'candidate'>('candidate');
  const [rereadText, setRereadText] = useState('');

  // Auto-sync left page when user clicks a node or edge with sourceLocation.page
  useEffect(() => {
    const node = draft.nodes.find(n => n.id === selectedNodeId);
    const edge = draft.edges.find(e => e.id === selectedEdgeId);
    const loc = selectedEdgeId ? edge?.sourceLocation : node?.sourceLocation;
    if (loc?.sourceId && sources.some(s => s.sourceId === loc.sourceId)) setSourceId(loc.sourceId);
    if (loc?.page && loc.page >= 1) setPage(loc.page);
  }, [selectedNodeId, selectedEdgeId]);

  useEffect(() => {
    if (!sourceId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    readMapImportPreview(discussionId, sourceId, page, true, controller.signal)
      .then(res => { if (!controller.signal.aborted) setPreview(res); })
      .catch(e => { if (!controller.signal.aborted) { setPreview(undefined); setError(e instanceof Error ? e.message : '原稿预览暂不可用。'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [discussionId, sourceId, page]);

  const allItems = [...draft.nodes, ...draft.edges];
  const clearCount = allItems.filter(item => item.reviewState === 'clear').length;
  const reviewCount = allItems.filter(item => item.reviewState === 'needs-review').length;
  const confirmedCount = allItems.filter(item => item.reviewState === 'confirmed').length;

  const selectedEdge = selectedEdgeId ? draft.edges.find(e => e.id === selectedEdgeId) : undefined;
  const selectedNode = !selectedEdge ? draft.nodes.find(n => n.id === selectedNodeId) : undefined;

  function acceptAllClear() {
    onChangeDraft({
      ...draft,
      nodes: draft.nodes.map(n => (n.reviewState === 'clear' ? { ...n, reviewState: 'confirmed' } : n)),
      edges: draft.edges.map(e => (e.reviewState === 'clear' ? { ...e, reviewState: 'confirmed' } : e)),
    });
    setStatus(`已批量保留 ${clearCount} 项清楚内容，请集中核对剩余待核项。`);
  }

  function updateNodeField(id: string, patch: Partial<StrategyMapNode>) {
    onChangeDraft({
      ...draft,
      nodes: draft.nodes.map(n => (n.id === id ? { ...n, ...patch } : n)),
    });
  }

  function updateEdgeField(id: string, patch: Partial<StrategyMapEdge>) {
    onChangeDraft({
      ...draft,
      edges: draft.edges.map(e => (e.id === id ? { ...e, ...patch } : e)),
    });
  }

  function flipEdge(edge: StrategyMapEdge) {
    updateEdgeField(edge.id, {
      from: edge.to,
      to: edge.from,
      reviewState: 'confirmed',
      ambiguityReason: '连线方向已由人工翻转确认。',
    });
    setStatus(`已翻转连线：${edge.to} → ${edge.from}`);
  }

  function dedupeSimilarNodes() {
    const seen = new Map<string, string>();
    const duplicates = new Set<string>();
    const remap = new Map<string, string>();
    for (const n of draft.nodes) {
      const key = `${n.kind}:${n.title.trim().replace(/（.*?）|\(.*?\)/g, '').toLowerCase()}`;
      if (seen.has(key)) {
        duplicates.add(n.id);
        remap.set(n.id, seen.get(key)!);
      } else {
        seen.set(key, n.id);
      }
    }
    if (!duplicates.size) {
      setStatus('未发现高相似重复条目。');
      return;
    }
    const nextNodes = draft.nodes.filter(n => !duplicates.has(n.id));
    const nextEdges = draft.edges
      .map(e => ({ ...e, from: remap.get(e.from) ?? e.from, to: remap.get(e.to) ?? e.to }))
      .filter((e, idx, arr) => e.from !== e.to && arr.findIndex(x => x.from === e.from && x.to === e.to && x.kind === e.kind) === idx);
    onChangeDraft({ ...draft, nodes: nextNodes, edges: nextEdges });
    setStatus(`已合并 ${duplicates.size} 个重复条目。`);
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
  const pageNodes = draft.nodes.filter(n => !n.sourceLocation?.page || n.sourceLocation.page === page);
  const pageEdges = draft.edges.filter(e => !e.sourceLocation?.page || e.sourceLocation.page === page);

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
                <select className="sg-select" value={sourceId} onChange={e => { setSourceId(e.target.value); setPage(1); }}>
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
                  onClick={() => setPage(p.page)}
                >
                  P{p.page}
                </button>
              ))}
            </div>
          )}

          <div className="map-source-canvas">
            {loading && <p role="status" className="sg-muted">正在读取原稿预览…</p>}
            {error && <p role="alert" className="case-error">{error}</p>}
            {!loading && !error && preview && (
              preview.image.available && preview.image.base64 ? (
                <div className="map-source-img-wrap" style={{ transform: `scale(${zoom})` }}>
                  <img
                    src={`data:${preview.image.mimeType};base64,${preview.image.base64}`}
                    alt={`${preview.source.fileName} 第 ${page} 页`}
                    className="map-source-img"
                  />
                  <svg className="map-source-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                    {pageNodes.filter(n => n.sourceLocation?.bbox).map(n => {
                      const [x, y, w, h] = n.sourceLocation!.bbox!;
                      const isSel = selectedNode?.id === n.id || selectedEdge?.from === n.id || selectedEdge?.to === n.id;
                      return (
                        <rect
                          key={n.id}
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
                    {pageEdges.filter(e => e.sourceLocation?.arrowBbox).map(e => {
                      const [x, y, w, h] = e.sourceLocation!.arrowBbox!;
                      const isSel = selectedEdge?.id === e.id;
                      return (
                        <rect
                          key={e.id}
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
                    <svg className="map-source-svg" viewBox="0 0 1000 720" style={{ transform: `scale(${zoom})` }}>
                      {preview.currentPage.shapes.map((sh, idx) => {
                        const [x, y, w, h] = sh.bbox ?? [40 + (idx % 2) * 480, 40 + Math.floor(idx / 2) * 140, 420, 110];
                        const linked = pageNodes.find(n => n.sourceLocation?.objectId === sh.objectId);
                        const isSel = linked && (selectedNode?.id === linked.id || selectedEdge?.from === linked.id || selectedEdge?.to === linked.id);
                        return (
                          <g key={sh.objectId} style={{ cursor: linked ? 'pointer' : 'default' }} onClick={() => linked && onSelectNode(linked.id)}>
                            <rect
                              x={x} y={Math.min(590, Math.round(y * 0.7))} width={Math.max(180, w)} height={Math.max(90, Math.round(h * 0.7))}
                              rx="10"
                              fill={isSel ? '#eeebfb' : '#f8f8fb'}
                              stroke={isSel ? '#6550c9' : '#9c9ab0'}
                              strokeWidth={isSel ? 5 : 2}
                            />
                            <text x={x + 14} y={Math.min(590, Math.round(y * 0.7)) + 30} fontSize="22" fontWeight="600" fill="#24232b">
                              {sh.text.slice(0, 26)}
                            </text>
                            <text x={x + 14} y={Math.min(590, Math.round(y * 0.7)) + 60} fontSize="18" fill="#6c6b78">
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
              <button type="button" className="text-button" onClick={dedupeSimilarNodes}>去重检查</button>
            </div>
          </div>

          <div className="map-review-list">
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
                      onClick={() => onSelectNode(n.id)}
                    >
                      <td><strong>{n.id} · {n.title}</strong></td>
                      <td>{nodeKindLabels[n.kind]}</td>
                      <td>{n.metric || '—'} · {n.baseline === undefined || n.baseline === '' ? '待定' : n.baseline} {n.baselineKind ?? ''} → {n.target === undefined || n.target === '' ? '待定' : n.target} {n.unit ?? ''}</td>
                      <td>{n.sourceLocation?.label ?? '—'} · {n.reviewState === 'needs-review' ? '待核' : n.reviewState === 'confirmed' ? '已确认' : '清楚'}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="sg-muted">当前筛选下已无待核条目。</td></tr>
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
                    onClick={() => onSelectEdge(e.id)}
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
                        onChangeDraft({
                          ...draft,
                          nodes: draft.nodes.filter(x => x.id !== selectedNode.id),
                          edges: draft.edges.filter(x => x.from !== selectedNode.id && x.to !== selectedNode.id),
                        });
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
                      <button type="button" className="secondary-button" onClick={() => updateEdgeField(selectedEdge.id, { reviewState: 'confirmed', ...(selectedEdge.kind === 'unknown' ? { kind: 'supports' } : {}) })}>确认此连线</button>
                    )}
                    <button type="button" className="text-button" onClick={() => onChangeDraft({ ...draft, edges: draft.edges.filter(x => x.id !== selectedEdge.id) })}>删除连线</button>
                  </div>
                </div>
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
                    <select value={selectedEdge.kind} onChange={e => updateEdgeField(selectedEdge.id, { kind: e.target.value as StrategyMapEdge['kind'], ...(e.target.value !== 'unknown' ? { reviewState: 'confirmed' } : {}) })}>
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
                  用自然语言让原战略 Agent 重读一页或一条线（保留已人工修改内容）
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
                        onReread(rereadText.trim(), sources.map(s => s.sourceId));
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
