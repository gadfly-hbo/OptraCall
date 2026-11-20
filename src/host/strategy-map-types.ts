import type { GoalDiscussionSourceRef } from './strategy-goals-types.ts';
import type { StrategyScenarioModel } from './strategy-simulation.ts';
import type { StrategyAttachmentCitation } from './strategy-attachment-types.ts';

export const mapTemplates = { table: '条目表', tree: '目标与策略树', bsc: '平衡计分卡（BSC）' } as const;
export const mapEdgeKinds = { supports:'支持 / 贡献', upstream:'上游策略', decomposition:'分解 / 归属', hypothesis:'因果假设' } as const;
export const reviewFields = {summary:'审查判断',mechanism:'作用机制',condition:'必要条件',alternative:'其他解释',risk:'可能副作用',scope:'证据范围',test:'如何检验'} as const;
export interface StrategyMapRef { mapId:string; version:number }
export interface StrategyMapMetric { metric:string; baseline?:string; baselineKind?:string; target?:string; unit?:string; period?:string }
export interface StrategyMapNode extends Partial<StrategyMapMetric> {
  id:string; kind:'goal'|'strategy'|'other'; title:string; owner?:string; perspective?:string; detail?:string; metrics?:StrategyMapMetric[];
}
export interface StrategyMapEdge { id:string; from:string; to:string; kind:keyof typeof mapEdgeKinds; review?:Record<keyof typeof reviewFields,string>; citationTokens?:string[] }
export interface StrategyMapImportSource {
  fileName:string; sha256:string; sheets:{name:string;headerRow:number;columns:Record<string,string>}[]; rows:{nodeId:string;sheet:string;row:number}[];
}
export interface StrategyMapDraft {
  title:string; template:keyof typeof mapTemplates; choice:string; excluded:string; assumptions:string; unknowns:string;
  nodes:StrategyMapNode[]; edges:StrategyMapEdge[]; scenarioModel?:StrategyScenarioModel; importSource?:StrategyMapImportSource;
}
export type StrategyMapAuthor = 'user'|'agent'|'import';
export interface StrategyMapVersion extends StrategyMapDraft, StrategyMapRef {
  discussionId:string; contentSha256:string; createdAt:string; author:StrategyMapAuthor; reason:string;
  requestId?:string; source?:GoalDiscussionSourceRef; replySource?:GoalDiscussionSourceRef; citations:StrategyAttachmentCitation[]; operationId:string;
}
export function mapDraft(version:StrategyMapVersion):StrategyMapDraft {
  const {title,template,choice,excluded,assumptions,unknowns,nodes,edges,scenarioModel,importSource}=version;
  return {title,template,choice,excluded,assumptions,unknowns,nodes,edges,...(scenarioModel&&{scenarioModel}),...(importSource&&{importSource})};
}

/** Workbook imports may supply only the list. Manual edits may also define a primary metric. */
export function mapNodeMetrics(node:StrategyMapNode):StrategyMapMetric[] {
  const additional=node.metrics??[];
  if(!node.metric)return additional;
  const {metric,baseline,baselineKind,target,unit,period}=node;
  const primary={metric,baseline,baselineKind,target,unit,period};
  return [primary,...additional.filter(m=>m.metric!==metric || m.baseline!==baseline || m.baselineKind!==baselineKind || m.target!==target || m.unit!==unit || m.period!==period)];
}
