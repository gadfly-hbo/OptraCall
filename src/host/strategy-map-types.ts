import type { GoalDiscussionSourceRef } from './strategy-goals-types.ts';
import type { StrategyScenarioModel } from './strategy-simulation.ts';
import type { StrategyAttachmentCitation } from './strategy-attachment-types.ts';

export const mapTemplates = { table: '条目表', tree: '目标与策略树', bsc: '平衡计分卡（BSC）' } as const;
export const mapEdgeKinds = { supports:'支持 / 贡献', upstream:'上游策略', decomposition:'分解 / 归属', hypothesis:'因果假设', unknown:'未知关系（待核）' } as const;
export const reviewFields = {summary:'审查判断',mechanism:'作用机制',condition:'必要条件',alternative:'其他解释',risk:'可能副作用',scope:'证据范围',test:'如何检验'} as const;
export type StrategyMapReviewState = 'clear' | 'needs-review' | 'confirmed';
export type StrategyMapBBox = [number, number, number, number];
export interface StrategyMapSourceLocation {
  sourceId: string;
  fileName?: string;
  page?: number;
  sheet?: string;
  row?: number;
  cell?: string;
  objectId?: string;
  label: string;
  bbox?: StrategyMapBBox;
  fromBbox?: StrategyMapBBox;
  toBbox?: StrategyMapBBox;
  arrowBbox?: StrategyMapBBox;
}
export interface StrategyMapSourceConflict {
  field: string;
  values: Array<{ value: string; label: string; locationLabel: string }>;
}
export interface StrategyMapMultiImportSource {
  sourceId: string;
  format: 'xlsx' | 'pptx' | 'pdf' | 'image';
  fileName: string;
  sha256: string;
  origin: 'upload' | 'discussion-attachment' | 'project-file';
  selectedPages?: number[];
  imageMeta?: { width: number; height: number; orientation?: number };
}
export interface StrategyMapRef { mapId:string; version:number }
export interface StrategyMapMetric { metric:string; baseline?:string; baselineKind?:string; target?:string; unit?:string; period?:string }
export interface StrategyMapNode extends Partial<StrategyMapMetric> {
  id:string; kind:'goal'|'strategy'|'other'; title:string; owner?:string; perspective?:string; detail?:string; metrics?:StrategyMapMetric[];
  sourceLocation?: StrategyMapSourceLocation;
  reviewState?: StrategyMapReviewState;
  ambiguityReason?: string;
  sourceConflicts?: StrategyMapSourceConflict[];
}
export interface StrategyMapEdge {
  id:string; from:string; to:string; kind:keyof typeof mapEdgeKinds; review?:Record<keyof typeof reviewFields,string>; citationTokens?:string[];
  sourceLocation?: StrategyMapSourceLocation;
  reviewState?: StrategyMapReviewState;
  ambiguityReason?: string;
}
export interface StrategyMapImportSource {
  fileName:string; sha256:string; sheets:{name:string;headerRow:number;columns:Record<string,string>}[]; rows:{nodeId:string;sheet:string;row:number}[];
}
export interface StrategyMapDraft {
  title:string; template:keyof typeof mapTemplates; choice:string; excluded:string; assumptions:string; unknowns:string;
  nodes:StrategyMapNode[]; edges:StrategyMapEdge[]; scenarioModel?:StrategyScenarioModel; importSource?:StrategyMapImportSource; importSources?:StrategyMapMultiImportSource[];
}
export type StrategyMapAuthor = 'user'|'agent'|'import';
export interface StrategyMapVersion extends StrategyMapDraft, StrategyMapRef {
  discussionId:string; contentSha256:string; createdAt:string; author:StrategyMapAuthor; reason:string;
  requestId?:string; source?:GoalDiscussionSourceRef; replySource?:GoalDiscussionSourceRef; citations:StrategyAttachmentCitation[]; operationId:string;
  importDraftEntryId?:string; importDraftGroupId?:string;
}
export type StrategyMapPublicationState = 'active' | 'superseded' | 'withdrawn';
export interface StrategyMapPublicationIdentity {
  publicationId:string; publishedAt:string;
}
export interface StrategyMapPublication extends StrategyMapPublicationIdentity {
  discussionId:string; mapId:string; version:number; contentSha256:string;
  state:StrategyMapPublicationState; goalCount:number; strategyCount:number;
  operationId:string; supersededAt?:string; withdrawnAt?:string; withdrawOperationId?:string;
}
export function mapDraft(version:StrategyMapVersion):StrategyMapDraft {
  const {title,template,choice,excluded,assumptions,unknowns,nodes,edges,scenarioModel,importSource,importSources}=version;
  return {title,template,choice,excluded,assumptions,unknowns,nodes,edges,...(scenarioModel&&{scenarioModel}),...(importSource&&{importSource}),...(importSources&&{importSources})};
}

const optionalMetricFields = ['baseline', 'baselineKind', 'target', 'unit', 'period'] as const;

function metricValues(name: string, fields: Partial<StrategyMapMetric>): StrategyMapMetric {
  const result: StrategyMapMetric = { metric: name.trim() };
  for (const field of optionalMetricFields) {
    const value = fields[field]?.trim();
    if (value) result[field] = value;
  }
  return result;
}

/** Workbook imports may supply only the list. Manual edits may also define a primary metric. */
export function mapNodeMetrics(node: StrategyMapNode): StrategyMapMetric[] {
  const additional = (node.metrics ?? []).map(row => metricValues(row.metric, row));
  if (!node.metric?.trim()) return additional;
  const primary = metricValues(node.metric, node);
  return [primary, ...additional.filter(row =>
    row.metric !== primary.metric || optionalMetricFields.some(field => row[field] !== primary[field])
  )];
}
