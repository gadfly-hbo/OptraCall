import { z } from 'zod';
import type { GoalDraftInput, GoalScope, GoalVersion } from './strategy-goals-types.ts';
import {mapNodeMetrics} from './strategy-map-types.ts';
import type { StrategyMapNode, StrategyMapEdge, StrategyMapImportSource, StrategyMapVersion } from './strategy-map-types.ts';

const label=z.string().trim().min(1).max(6000), uuid=z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/), sha=z.string().regex(/^[a-f0-9]{64}$/);
const originSchema=z.strictObject({
  groupId:uuid,nodeId:label,planTitle:label,
  map:z.strictObject({discussionId:uuid,mapId:uuid,version:z.number().int().positive(),sha256:sha}).optional(),
  workbook:z.strictObject({fileName:label,sha256:sha,rows:z.array(z.strictObject({sheet:label,row:z.number().int().positive(),columns:z.record(label,label)})).max(2000)}).optional(),
  parents:z.array(label),strategies:z.array(z.strictObject({id:label,title:label})),
  metrics:z.array(z.strictObject({metric:label,baseline:label.optional(),target:label.optional(),unit:label.optional(),period:label.optional(),baselineKind:label.optional()})).max(100)
}).refine(v=>v.map||v.workbook);
export type StructuredGoal = z.infer<typeof originSchema>;
export const parseStructuredGoal=(input:unknown):StructuredGoal=>originSchema.parse(input);
export const strategyText=(s:{id:string;title:string})=>s.id+' · '+s.title;
export const groupScopeKey=(scope:GoalScope)=>JSON.stringify([scope.kind,scope.id,scope.enterpriseId??'']);
export function goalCandidatesFromRows(input:{groupId:string;planTitle:string;nodes:StrategyMapNode[];edges:StrategyMapEdge[];scope:GoalScope;perspective:GoalDraftInput['perspective'];selected:string[];map?:StrategyMapVersion;workbook?:StrategyMapImportSource}):GoalDraftInput[]{
  const nodes=new Map(input.nodes.map(n=>[n.id,n]));
  const {map,workbook}=input;
  const unique=new Set(input.selected);
  if(!unique.size||unique.size!==input.selected.length||input.selected.some(id=>nodes.get(id)?.kind!=='goal'))throw new Error('invalid_strategy_goal_selection');
  return input.selected.map(id=>{
    const n=nodes.get(id)!;
    const rows=workbook?.rows.filter(r=>r.nodeId===id).map(r=>({sheet:r.sheet,row:r.row,columns:workbook.sheets.find(s=>s.name===r.sheet)?.columns??{}}));
    const metrics=mapNodeMetrics(n);
    const strategies=Array.from(new Set(input.edges.filter(e=>e.to===id && (e.kind==='supports'||e.kind==='hypothesis') && nodes.get(e.from)?.kind==='strategy').map(e=>e.from))).map(id=>({id,title:nodes.get(id)!.title}));
    const structured=parseStructuredGoal({groupId:input.groupId,nodeId:id,planTitle:input.planTitle,metrics,strategies,
      parents:input.edges.filter(e=>e.to===id&&e.kind==='decomposition').map(e=>e.from),
      ...(map&&{map:{discussionId:map.discussionId,mapId:map.mapId,version:map.version,sha256:map.contentSha256}}),
      ...(workbook&&rows?.length&&{workbook:{fileName:workbook.fileName,sha256:workbook.sha256,rows}})});
    const baseline=metrics.filter(m=>m.baseline!==undefined).map(m=>m.metric+' '+m.baseline+' '+(m.baselineKind??'性质待核')).join('、');
    const criterion=metrics.map(m=>m.metric+' '+(m.target??'目标值待定')+(m.unit&&!m.target?.endsWith(m.unit)?' '+m.unit:'')+(m.period?' · '+m.period:'')).join('；');
    return {structured,title:n.title,outcome:n.detail||n.title,scope:input.scope,perspective:input.perspective,
      baseline:{state:baseline?'known':'pending',description:baseline||'基线待补'},responsible:n.owner||'责任人待明确',
      measurement:{kind:'deliverable',criterion:criterion||'指标与衡量口径待明确'},strategies:strategies.map(strategyText),
      ...(n.perspective&&{bscPerspective:n.perspective}),...(map?.source&&{source:map.source})};
  });
}
export function structuredGoalRows(v:GoalVersion) {
  if(v.structured?.metrics.length)return v.structured.metrics;
  return [{metric:v.measurement.kind==='quantitative'?v.measurement.sapMetric.metricName??'SAP 指标':'成果标准',baseline:v.baseline.description,
    baselineKind:v.baseline.state==='pending'?'待补':undefined,target:v.measurement.kind==='quantitative'?v.measurement.target:v.measurement.criterion,unit:undefined,period:v.dueAt}];
}
