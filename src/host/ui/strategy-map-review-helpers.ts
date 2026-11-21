import {
  mapTemplates,
  type StrategyMapDraft,
  type StrategyMapEdge,
  type StrategyMapNode,
  type StrategyMapSourceLocation,
} from '../strategy-map-types.ts';

export type DraftTopLevelField =
  | 'title'
  | 'template'
  | 'choice'
  | 'excluded'
  | 'assumptions'
  | 'unknowns'
  | 'scenarioModel';

export type DraftTopLevelPatch = Partial<Pick<StrategyMapDraft, DraftTopLevelField>>;

const draftFieldLabels: Record<DraftTopLevelField, string> = {
  title: '方案名称',
  template: '地图模板',
  choice: '本版选择',
  excluded: '放弃的方向',
  assumptions: '成立条件',
  unknowns: '待核依据',
  scenarioModel: '情景模拟模型',
};

const formatDraftFieldValue = (key: DraftTopLevelField, val: unknown): string => {
  if (key === 'template' && typeof val === 'string' && val in mapTemplates) {
    return mapTemplates[val as keyof typeof mapTemplates];
  }
  if (key === 'scenarioModel') {
    return val ? '已配置情景模型' : '已清除情景模型';
  }
  const str = String(val ?? '').trim();
  return str.length > 24 ? `${str.slice(0, 24)}…` : str || '空';
};

export interface ManualEditOverlay {
  draftFields: DraftTopLevelPatch;
  nodeFields: Record<string, Partial<StrategyMapNode>>;
  addedNodes: Record<string, StrategyMapNode>;
  deletedNodeIds: string[];
  edgeFields: Record<string, Partial<StrategyMapEdge>>;
  addedEdges: Record<string, StrategyMapEdge>;
  deletedEdgeIds: string[];
}

export const emptyManualEditOverlay = (): ManualEditOverlay => ({
  draftFields: {},
  nodeFields: {},
  addedNodes: {},
  deletedNodeIds: [],
  edgeFields: {},
  addedEdges: {},
  deletedEdgeIds: [],
});

export const hasManualEdits = (o: ManualEditOverlay): boolean =>
  Object.keys(o.draftFields).length > 0 ||
  Object.keys(o.nodeFields).length > 0 ||
  Object.keys(o.addedNodes).length > 0 ||
  o.deletedNodeIds.length > 0 ||
  Object.keys(o.edgeFields).length > 0 ||
  Object.keys(o.addedEdges).length > 0 ||
  o.deletedEdgeIds.length > 0;

export type ManualEditRecord =
  | { kind: 'draft-patch'; patch: DraftTopLevelPatch }
  | { kind: 'node-patch'; id: string; patch: Partial<StrategyMapNode> }
  | { kind: 'node-add'; node: StrategyMapNode }
  | { kind: 'node-delete'; id: string }
  | { kind: 'edge-patch'; id: string; patch: Partial<StrategyMapEdge> }
  | { kind: 'edge-add'; edge: StrategyMapEdge }
  | { kind: 'edge-delete'; id: string }
  | { kind: 'batch-confirm-clear'; nodeIds: string[]; edgeIds: string[] }
  | { kind: 'merge-duplicate'; keepId: string; dropId: string };

export function applyManualEditRecord(overlay: ManualEditOverlay, rec: ManualEditRecord): ManualEditOverlay {
  const next: ManualEditOverlay = {
    draftFields: { ...overlay.draftFields },
    nodeFields: { ...overlay.nodeFields },
    addedNodes: { ...overlay.addedNodes },
    deletedNodeIds: [...overlay.deletedNodeIds],
    edgeFields: { ...overlay.edgeFields },
    addedEdges: { ...overlay.addedEdges },
    deletedEdgeIds: [...overlay.deletedEdgeIds],
  };
  if (rec.kind === 'draft-patch') {
    next.draftFields = { ...next.draftFields, ...rec.patch };
  } else if (rec.kind === 'node-patch') {
    next.nodeFields[rec.id] = { ...(next.nodeFields[rec.id] ?? {}), ...rec.patch };
    if (next.addedNodes[rec.id]) next.addedNodes[rec.id] = { ...next.addedNodes[rec.id]!, ...rec.patch };
  } else if (rec.kind === 'node-add') {
    next.addedNodes[rec.node.id] = { ...rec.node };
    next.deletedNodeIds = next.deletedNodeIds.filter(id => id !== rec.node.id);
  } else if (rec.kind === 'node-delete') {
    if (!next.deletedNodeIds.includes(rec.id)) next.deletedNodeIds.push(rec.id);
    delete next.addedNodes[rec.id];
    delete next.nodeFields[rec.id];
  } else if (rec.kind === 'edge-patch') {
    next.edgeFields[rec.id] = { ...(next.edgeFields[rec.id] ?? {}), ...rec.patch };
    if (next.addedEdges[rec.id]) next.addedEdges[rec.id] = { ...next.addedEdges[rec.id]!, ...rec.patch };
  } else if (rec.kind === 'edge-add') {
    next.addedEdges[rec.edge.id] = { ...rec.edge };
    next.deletedEdgeIds = next.deletedEdgeIds.filter(id => id !== rec.edge.id);
  } else if (rec.kind === 'edge-delete') {
    if (!next.deletedEdgeIds.includes(rec.id)) next.deletedEdgeIds.push(rec.id);
    delete next.addedEdges[rec.id];
    delete next.edgeFields[rec.id];
  } else if (rec.kind === 'batch-confirm-clear') {
    for (const id of rec.nodeIds) {
      next.nodeFields[id] = { ...(next.nodeFields[id] ?? {}), reviewState: 'confirmed' };
      if (next.addedNodes[id]) next.addedNodes[id] = { ...next.addedNodes[id]!, reviewState: 'confirmed' };
    }
    for (const id of rec.edgeIds) {
      next.edgeFields[id] = { ...(next.edgeFields[id] ?? {}), reviewState: 'confirmed' };
      if (next.addedEdges[id]) next.addedEdges[id] = { ...next.addedEdges[id]!, reviewState: 'confirmed' };
    }
  } else if (rec.kind === 'merge-duplicate') {
    if (!next.deletedNodeIds.includes(rec.dropId)) next.deletedNodeIds.push(rec.dropId);
    delete next.addedNodes[rec.dropId];
    delete next.nodeFields[rec.dropId];
  }
  return next;
}

/**
 * Deterministically merges an incoming Agent reread draft with the user's unsaved manual edits.
 * Untouched fields/nodes/edges take the Agent's reread updates; user-edited top-level fields,
 * node/edge edits, deletions, and additions are preserved with explicit conflict notices.
 */
export function mergeRereadDraftWithManualEdits(
  incomingDraft: StrategyMapDraft,
  overlay: ManualEditOverlay,
): { merged: StrategyMapDraft; preservedCount: number; notices: string[] } {
  if (!hasManualEdits(overlay)) {
    return { merged: structuredClone(incomingDraft), preservedCount: 0, notices: [] };
  }
  const base = structuredClone(incomingDraft);
  const deletedNodes = new Set(overlay.deletedNodeIds);
  const deletedEdges = new Set(overlay.deletedEdgeIds);
  let preservedCount = 0;
  const notices: string[] = [];

  for (const key of Object.keys(overlay.draftFields) as DraftTopLevelField[]) {
    const val = overlay.draftFields[key];
    const incomingVal = base[key];
    if (JSON.stringify(incomingVal) !== JSON.stringify(val)) {
      notices.push(
        `已保留「${draftFieldLabels[key]}」的手工修改（当前：${formatDraftFieldValue(key, val)}；重读返回：${formatDraftFieldValue(key, incomingVal)}）`,
      );
    }
    if (key === 'scenarioModel' && val === undefined) {
      delete base.scenarioModel;
    } else {
      (base as unknown as Record<string, unknown>)[key] = structuredClone(val);
    }
    preservedCount++;
  }

  const mergedNodes: StrategyMapNode[] = [];
  for (const node of base.nodes) {
    if (deletedNodes.has(node.id)) {
      preservedCount++;
      continue;
    }
    const patch = overlay.nodeFields[node.id];
    if (patch) {
      for (const [k, val] of Object.entries(patch)) {
        const incomingVal = (node as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(incomingVal) !== JSON.stringify(val) && k !== 'reviewState' && k !== 'ambiguityReason') {
          notices.push(`已保留条目 ${node.id} 的手工修改（${k}: ${String(val ?? '')}）`);
        }
      }
      mergedNodes.push({ ...node, ...patch });
      preservedCount++;
    } else {
      mergedNodes.push(node);
    }
  }
  for (const added of Object.values(overlay.addedNodes)) {
    if (!mergedNodes.some(n => n.id === added.id)) {
      mergedNodes.push(structuredClone(added));
      preservedCount++;
    }
  }

  const validNodeIds = new Set(mergedNodes.map(n => n.id));
  const mergedEdges: StrategyMapEdge[] = [];
  for (const edge of base.edges) {
    if (deletedEdges.has(edge.id)) {
      preservedCount++;
      continue;
    }
    const patch = overlay.edgeFields[edge.id];
    if (patch) {
      for (const [k, val] of Object.entries(patch)) {
        const incomingVal = (edge as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(incomingVal) !== JSON.stringify(val) && k !== 'reviewState' && k !== 'ambiguityReason') {
          notices.push(`已保留连线 ${edge.id} 的手工修改（${k}: ${String(val ?? '')}）`);
        }
      }
    }
    const nextEdge = patch ? { ...edge, ...patch } : edge;
    if (patch) preservedCount++;
    if (nextEdge.from !== nextEdge.to && validNodeIds.has(nextEdge.from) && validNodeIds.has(nextEdge.to)) {
      mergedEdges.push(nextEdge);
    }
  }
  for (const added of Object.values(overlay.addedEdges)) {
    if (
      !mergedEdges.some(e => e.id === added.id) &&
      added.from !== added.to &&
      validNodeIds.has(added.from) &&
      validNodeIds.has(added.to)
    ) {
      mergedEdges.push(structuredClone(added));
      preservedCount++;
    }
  }

  return {
    merged: { ...base, nodes: mergedNodes, edges: mergedEdges },
    preservedCount,
    notices,
  };
}

/**
 * Strict multi-source + page matching so hotspots from source B page 1 never render on source A page 1.
 */
export function matchesSourcePage(
  loc: StrategyMapSourceLocation | undefined,
  activeSourceId: string,
  activePage: number,
): boolean {
  if (!loc || !activeSourceId) return false;
  if (loc.sourceId !== activeSourceId) return false;
  if (loc.page !== undefined && loc.page !== activePage) return false;
  return true;
}

export interface EmbeddedImageRef {
  id: string;
  name: string;
  objectId?: string;
}

/**
 * Resolves the 1-based embedded image index on a multi-image worksheet/page for a sourceLocation.
 */
export function resolveEmbeddedImageIndex(
  loc: StrategyMapSourceLocation | undefined,
  embeddedImages: readonly EmbeddedImageRef[] | undefined,
): number | undefined {
  if (!loc || !embeddedImages || embeddedImages.length <= 1) return undefined;
  const objId = loc.objectId?.trim();
  if (objId) {
    const objLower = objId.toLowerCase();
    for (let i = 0; i < embeddedImages.length; i++) {
      const img = embeddedImages[i]!;
      if ((img.objectId && img.objectId === objId) || img.id === objId) return i + 1;
    }
    for (let i = 0; i < embeddedImages.length; i++) {
      const img = embeddedImages[i]!;
      const imgObj = img.objectId?.toLowerCase();
      const imgId = img.id.toLowerCase();
      const imgName = img.name.toLowerCase();
      if (
        (imgObj && (objLower === imgObj || objLower.startsWith(`${imgObj}:`) || objLower.startsWith(`${imgObj}#`))) ||
        objLower === imgId ||
        objLower.startsWith(`${imgId}:`) ||
        objLower.startsWith(`${imgId}#`) ||
        objLower === imgName
      ) {
        return i + 1;
      }
    }
  }
  const label = loc.label?.trim();
  if (label) {
    const labelLower = label.toLowerCase();
    const matchedIndices: number[] = [];
    for (let i = 0; i < embeddedImages.length; i++) {
      const img = embeddedImages[i]!;
      const tokens = [img.objectId, img.id, img.name].filter((t): t is string => Boolean(t && t.trim().length >= 2));
      if (tokens.some(t => labelLower.includes(t.toLowerCase()))) {
        matchedIndices.push(i + 1);
      }
    }
    if (matchedIndices.length === 1) return matchedIndices[0];
    const numMatch = /(?:图\s*|image\s*#?\s*)(\d+)/i.exec(label);
    if (numMatch) {
      const idx = Number(numMatch[1]);
      if (Number.isInteger(idx) && idx >= 1 && idx <= embeddedImages.length) return idx;
    }
  }
  return undefined;
}

/**
 * Strict sourceId + page + same-sheet embedded image isolation.
 * On a worksheet with multiple embedded images, hotspots bound to Image 2 never render on Image 1 and vice versa.
 */
export function matchesSourcePageAndImage(
  loc: StrategyMapSourceLocation | undefined,
  activeSourceId: string,
  activePage: number,
  activeImageIndex: number,
  embeddedImages: readonly EmbeddedImageRef[] | undefined,
): boolean {
  if (!matchesSourcePage(loc, activeSourceId, activePage)) return false;
  if (!embeddedImages || embeddedImages.length <= 1) return true;
  const resolved = resolveEmbeddedImageIndex(loc, embeddedImages);
  if (resolved !== undefined) return resolved === activeImageIndex;
  if (loc?.objectId?.trim()) return false;
  return activeImageIndex === 1;
}

export interface DuplicateCandidatePair {
  keep: StrategyMapNode;
  duplicate: StrategyMapNode;
  reason: string;
}

const normalizeExactTitle = (title: string): string =>
  title.trim().replace(/\s+/g, ' ').toLowerCase();

const distinctQualifierFields = (a: StrategyMapNode, b: StrategyMapNode): boolean => {
  const keys = ['perspective', 'owner', 'metric', 'baseline', 'baselineKind', 'target', 'unit', 'period'] as const;
  for (const k of keys) {
    const va = (a[k] ?? '').trim();
    const vb = (b[k] ?? '').trim();
    if (va && vb && va.toLowerCase() !== vb.toLowerCase()) return true;
  }
  return false;
};

/**
 * Advisory-only duplicate check:
 * - NEVER strips parenthetical qualifiers such as （新客） / （老客） / (方案A) / (方案B).
 * - NEVER flags items with differing segment/plan/metric/baseline/target/period qualifiers.
 * - NEVER mutates the draft automatically; returns candidate pairs for explicit user decision.
 */
export function findSafeDuplicateCandidates(nodes: readonly StrategyMapNode[]): DuplicateCandidatePair[] {
  const pairs: DuplicateCandidatePair[] = [];
  const seen = new Map<string, StrategyMapNode[]>();
  for (const node of nodes) {
    const normTitle = normalizeExactTitle(node.title);
    if (!normTitle) continue;
    const key = `${node.kind}:${normTitle}`;
    const priorList = seen.get(key) ?? [];
    for (const prior of priorList) {
      if (!distinctQualifierFields(prior, node)) {
        pairs.push({
          keep: prior,
          duplicate: node,
          reason: `类型与完整名称一致且未见口径冲突（${prior.id} 与 ${node.id}）`,
        });
        break;
      }
    }
    priorList.push(node);
    seen.set(key, priorList);
  }
  return pairs;
}

export function mergeDuplicatePairInDraft(
  draft: StrategyMapDraft,
  keepId: string,
  dropId: string,
): StrategyMapDraft {
  const nextNodes = draft.nodes.filter(n => n.id !== dropId);
  const nextEdges = draft.edges
    .map(e => ({
      ...e,
      from: e.from === dropId ? keepId : e.from,
      to: e.to === dropId ? keepId : e.to,
    }))
    .filter(
      (e, idx, arr) =>
        e.from !== e.to &&
        arr.findIndex(x => x.from === e.from && x.to === e.to && x.kind === e.kind) === idx,
    );
  return { ...draft, nodes: nextNodes, edges: nextEdges };
}
