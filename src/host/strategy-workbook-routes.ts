import {createHash} from 'node:crypto';
import { z } from 'zod';
import {decodeStrategyWorkbook,workbookLimit} from './strategy-workbook.ts';
import {mapStrategyWorkbook,unstableWorkbookMatches} from './strategy-workbook-types.ts';
import {StrategyGoalsStore,StrategyGoalsError} from './strategy-goals-store.ts';
import {groupScopeKey,goalCandidatesFromRows} from './structured-goal.ts';
import {readWorkbookOriginal,withWorkbookOriginal} from './strategy-workbook-source.ts';
import {discussionHash} from './strategy-discussion-store.ts';
import type {GoalRef,GoalDraftInput,GoalVersion} from './strategy-goals-types.ts';
import type {StrategyMapVersion} from './strategy-map-types.ts';

const id=z.string().uuid(), number=z.number().int().positive(), label=z.string().trim().min(1).max(300);
const ref=z.object({goalId:id,version:number});
const destination=z.object({scope:z.object({kind:z.enum(['enterprise','department','personal']),id:label,name:label,enterpriseId:id.optional()}),perspective:z.enum(['profit','nonprofit','personal']),expected:z.record(z.string(),ref.nullable()).optional()});
const mapRef=z.object({discussionId:id,mapId:id,version:number,sha256:z.string().regex(/^[a-f0-9]{64}$/)});
const handoffSchema=destination.extend({map:mapRef,selected:z.array(label).min(1).max(500)});
const fileSchema=z.object({fileName:label,bytes:z.string().min(1).max(Math.ceil(workbookLimit/3)*4)});
const mapping=z.object({name:label,headerRow:number,columns:z.record(z.string(),z.string().max(3))});
const commitSchema=fileSchema.extend({selection:z.object({strategy:mapping.optional(),goals:mapping.optional()}),target:z.enum(['map','goals']),title:label,template:z.enum(['table','tree','bsc']).default('table'),discussionId:id.optional(),base:mapRef.optional(),groupId:id.optional(),destination:destination.optional(),drawingsOnly:z.boolean().optional()});
const fail=(code:string,status=400):never=>{throw new StrategyGoalsError(code,status);};
function decode<T>(schema:z.ZodType<T>,value:unknown):T{const parsed=schema.safeParse(value);return parsed.success?parsed.data:fail('invalid_strategy_workbook_input');}
function stableId(value:unknown):string{
  const bytes=createHash('sha256').update(discussionHash(value)).digest().subarray(0,16);
  bytes[6]=(bytes[6]!&15)|80;bytes[8]=(bytes[8]!&63)|128;
  const hex=bytes.toString('hex');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
function decodeFile(encoded:string){
  const bytes=Buffer.from(encoded,'base64');
  if(!bytes.length||bytes.toString('base64')!==encoded)return fail('invalid_strategy_workbook');
  return bytes;
}
export async function checkWorkbookSource(dataRoot:string,scope:GoalDraftInput['scope'],origin:NonNullable<GoalDraftInput['structured']>){
  const source=origin.workbook;if(!source)return;
  const owner=origin.map?'discussion-'+origin.map.discussionId:discussionHash(['scope',groupScopeKey(scope)]);
  await readWorkbookOriginal(dataRoot,owner,source.sha256);
}
export interface WorkbookServices {
  goals:StrategyGoalsStore;
  mapMetadata:(id:string)=>Promise<StrategyMapVersion[]>;
  readMap:(id:string,mapId:string,version:number)=>Promise<StrategyMapVersion>;
  saveMap:(id:string,input:Record<string,unknown>,author:'import')=>Promise<StrategyMapVersion>;
  mutate:<T>(fn:()=>T|Promise<T>)=>Promise<T>;
  validateScope:(scope:GoalDraftInput['scope'])=>void;
  verifyGoal:(goal:GoalVersion)=>Promise<void>;
  isClosing:()=>boolean;
}
export function strategyWorkbookRoutes(services:WorkbookServices){
  const {goals}=services;
  async function readMap(ref:z.infer<typeof mapRef>){
    const map=await services.readMap(ref.discussionId,ref.mapId,ref.version);
    if(map.contentSha256!==ref.sha256)fail('strategy_map_version_conflict',409);
    return map;
  }
  function persistGoals(rows:GoalDraftInput[],expected:Record<string,GoalRef|null>={}){
    const id=stableId(['goal-table',rows]);
    const previous=goals.getOperation(id);
    if(previous) {
      const prior=goals.tableResult(id);
      if(prior.length!==rows.length)fail('strategy_goal_table_conflict',409);
      return prior;
    }
    return goals.saveTable(id,rows.map(input=>({input,expected:expected[input.structured!.nodeId]??null})));
  }
  async function saveSourceForGoal(v:GoalVersion){
    const source=v.structured?.workbook;
    if(!source)return fail('strategy_workbook_source_unavailable',404);
    const owner=v.structured?.map?'discussion-'+v.structured.map.discussionId:discussionHash(['scope',groupScopeKey(v.scope)]);
    return {fileName:source.fileName,bytes:(await readWorkbookOriginal(goals.dataRoot,owner,source.sha256)).toString('base64')};
  }
  return async function route(action:string,raw:unknown):Promise<unknown>{
    if(action==='goal-source'){
      const v=goals.read(decode(ref,raw));await services.verifyGoal(v);return saveSourceForGoal(v);
    }
    if(action==='map-source'){
      const map=await readMap(decode(mapRef,raw)),src=map.importSource;
      if(!src)return fail('strategy_workbook_source_unavailable',404);
      return {fileName:src.fileName,bytes:(await readWorkbookOriginal(goals.dataRoot,'discussion-'+map.discussionId,src.sha256)).toString('base64')};
    }
    if(action==='handoff'){
      const input=decode(handoffSchema,raw);
      return services.mutate(async()=>{
        if(services.isClosing())fail('host_closing',409);
        services.validateScope(input.scope);
        const map=await readMap(input.map);
        if(input.selected.some(id=>!map.nodes.some(n=>n.id===id&&n.kind==='goal'))||new Set(input.selected).size!==input.selected.length)fail('invalid_strategy_goal_selection');
        const rows=goalCandidatesFromRows({...input,groupId:map.mapId,planTitle:map.title,nodes:map.nodes,edges:map.edges,map,workbook:map.importSource});
        return {goals:persistGoals(rows,input.expected)};
      });
    }
    if(action!=='preview'&&action!=='commit')return fail('strategy_workbook_not_found',404);
    const file=decode(fileSchema,raw),bytes=decodeFile(file.bytes);
    const book=await decodeStrategyWorkbook(file.fileName,bytes);
    if(action==='preview')return {book};
    const input=decode(commitSchema,raw);
    const mapped=mapStrategyWorkbook(book,input.selection);
    const imageOnly=input.target==='map' && input.drawingsOnly===true && book.drawings && !Object.keys(input.selection).length;
    if(mapped.errors.length&&!imageOnly)return {errors:mapped.errors};
    return services.mutate(async()=>{
      if(services.isClosing())fail('host_closing',409);
      if(input.target==='map'){
        const discussionId=input.discussionId;if(!discussionId)return fail('strategy_discussion_required');
        if(input.base && input.base.discussionId!==discussionId)return fail('strategy_workbook_owner_mismatch',403);
        const previous=input.base&&await readMap(input.base);
        if(previous && unstableWorkbookMatches(previous.nodes.map(n=>({id:n.id,sha:previous.importSource?.sha256})),mapped).length)fail('strategy_workbook_unstable_ids',409);
        const mapId=previous?.mapId??stableId(['map',discussionId,book.sha256,input.selection,input.template,input.title]);
        const draft={title:input.title,template:input.template,choice:previous?.choice??'',excluded:previous?.excluded??'',assumptions:previous?.assumptions??'',unknowns:imageOnly?'待核对节点和连线':previous?.unknowns??'',nodes:mapped.nodes,edges:mapped.edges,importSource:mapped.importSource};
        const operationId=stableId([discussionId,mapId,previous?.version??0,draft]);
        const catalog=await services.mapMetadata(discussionId),repeat=catalog.find(v=>v.operationId===operationId);
        if(repeat)return {version:await services.readMap(discussionId,repeat.mapId,repeat.version)};
        const current=catalog.filter(v=>v.mapId===mapId).at(-1);
        if((current?.version??0)!==(previous?.version??0))fail('strategy_map_version_conflict',409);
        const version=await withWorkbookOriginal(goals.dataRoot,'discussion-'+discussionId,book.sha256,bytes,
          ()=>services.saveMap(discussionId,{operationId,mapId,expectedVersion:previous?.version??0,reason:imageOnly?'导入图形工作簿，待核对节点和连线':'核对 Excel 栏目与原行后生成地图草稿',draft},'import'),
          async()=>(await services.mapMetadata(discussionId)).some(v=>v.importSource?.sha256===book.sha256));
        return {version};
      }
      const dest=input.destination;if(!dest)return fail('strategy_goal_scope_required');
      services.validateScope(dest.scope);
      const owner=discussionHash(['scope',groupScopeKey(dest.scope)]),groupId=input.groupId??stableId(['goals',owner,book.sha256,input.selection]);
      if(input.groupId && !goals.list().goals.some(g=>g.versions.some(v=>v.structured?.groupId===input.groupId && !v.structured?.map && groupScopeKey(v.scope)===groupScopeKey(dest.scope))))fail('strategy_workbook_owner_mismatch',409);
      if (input.groupId) {
        const previous=goals.list().goals.flatMap(g=>{
          const v=g.versions.at(-1)!;
          return v.structured?.groupId===groupId && groupScopeKey(v.scope)===groupScopeKey(dest.scope)
            ?[{id:v.structured.nodeId,sha:v.structured.workbook?.sha256}]:[];
        });
        if(unstableWorkbookMatches(previous,mapped).length)fail('strategy_workbook_unstable_ids',409);
      }
      const selected=mapped.nodes.filter(n=>n.kind==='goal').map(n=>n.id);
      if(!selected.length)return fail('invalid_strategy_goal_selection');
      const rows=goalCandidatesFromRows({...dest,selected,groupId,planTitle:input.title,nodes:mapped.nodes,edges:mapped.edges,workbook:mapped.importSource});
      const expected=dest.expected??{};
      if(!goals.getOperation(stableId(['goal-table',rows])))goals.checkTable(rows.map(input=>({input,expected:expected[input.structured!.nodeId]??null})));
      const used=()=>goals.list().goals.some(g=>g.versions.some(v=>!v.structured?.map&&groupScopeKey(v.scope)===groupScopeKey(dest.scope)&&v.structured?.workbook?.sha256===book.sha256));
      if(used())await readWorkbookOriginal(goals.dataRoot,owner,book.sha256);
      return withWorkbookOriginal(goals.dataRoot,owner,book.sha256,bytes,async()=>({goals:persistGoals(rows,expected)}),async()=>used());
    });
  };
}
