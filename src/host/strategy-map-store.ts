import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import { atomicJson, directory, exists, readBytes, safePath } from './project-data-context-io.ts';
import { StrategyDiscussionFault, type StrategyDiscussionStore, discussionHash, discussionId } from './strategy-discussion-store.ts';
import type { StrategyMapAuthor, StrategyMapDraft, StrategyMapVersion } from './strategy-map-types.ts';
import { parseStrategyScenarioModel } from './strategy-simulation.ts';

const uuid=z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const text=z.string().max(6000);
const label=z.string().trim().min(1).max(300);
const metricFields={metric:label,baseline:text.optional(),baselineKind:text.optional(),target:text.optional(),unit:text.optional(),period:text.optional()};
const metric=z.strictObject(metricFields);
const node=z.strictObject({...metricFields,metric:text.optional(),id:label,kind:z.enum(['goal','strategy','other']),title:label,owner:text.optional(),perspective:text.optional(),detail:text.optional(),metrics:z.array(metric).max(100).optional()});
const reviewText=text.trim().min(1);
const review=z.strictObject({summary:reviewText,mechanism:reviewText,condition:reviewText,alternative:reviewText,risk:reviewText,scope:reviewText,test:reviewText});
const edge=z.strictObject({id:label,from:label,to:label,kind:z.enum(['supports','upstream','decomposition','hypothesis']),review:review.optional(),citationTokens:z.array(label).optional()});
const importSource=z.strictObject({fileName:label,sha256:z.string().regex(/^[0-9a-f]{64}$/),sheets:z.array(z.strictObject({name:label,headerRow:z.number().int().positive(),columns:z.record(label,text)})),rows:z.array(z.strictObject({nodeId:label,sheet:label,row:z.number().int().positive()}))});
const draftSchema=z.strictObject({title:label,template:z.enum(['table','tree','bsc']),choice:text.default(''),excluded:text.default(''),assumptions:text.default(''),unknowns:text.default(''),
  nodes:z.array(node).max(1000),edges:z.array(edge).max(3000),importSource:importSource.optional(),scenarioModel:z.unknown().optional()});
const saveSchema=z.strictObject({operationId:uuid,mapId:uuid,expectedVersion:z.number().int().nonnegative(),reason:label,draft:draftSchema});
const fault=(message:string,status=400):never=>{throw new StrategyDiscussionFault(message,status);};
type Provenance=Pick<StrategyMapVersion,'source'> & Partial<Pick<StrategyMapVersion,'citations'|'requestId'>>;
type Stored=StrategyMapVersion & {requestHash:string};
function checked<T>(schema:z.ZodType<T>,value:unknown):T {
  const parsed=schema.safeParse(value);
  if(!parsed.success) return fault('invalid_strategy_map: '+parsed.error.issues.map(e=>e.path.join('.')+' '+e.message).join(' / '));
  return parsed.data;
}
export class StrategyMapStore {
  readonly #discussions:StrategyDiscussionStore;
  constructor(discussions:StrategyDiscussionStore){this.#discussions=discussions;}
  private owner(id:string){
    if(this.#discussions.get(id).businessOwner)fault('strategy_discussion_not_found',404);
    return this.#discussions.directory(id);
  }
  private async entry(id:string,mapId:string,version:number):Promise<Stored>{
    if(!Number.isSafeInteger(version)||version<1)fault('invalid_strategy_map_version');
    const file=await safePath(this.owner(id),'maps/'+discussionId(mapId)+'/'+version+'.json');
    if(!await exists(file))return fault('strategy_map_not_found',404);
    const record=JSON.parse((await readBytes(file,2*1024*1024)).toString()) as Stored;
    const {contentSha256,...body}=record;
    if(record.discussionId!==id || record.mapId!==mapId || record.version!==version || discussionHash(body)!==contentSha256) fault('strategy_map_corrupt',503);
    return record;
  }
  async read(id:string,mapId:string,version:number):Promise<StrategyMapVersion>{
    try{const {requestHash:_,...body}=await this.entry(id,mapId,version);return body;}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return fault('strategy_map_not_found',404);throw e;}
  }
  async list(id:string):Promise<StrategyMapVersion[]>{
    const root=await safePath(this.owner(id),'maps');
    if(!await exists(root))return [];
    await directory(root);
    const results:StrategyMapVersion[]=[];
    for(const mapId of await readdir(root)){
      if(!uuid.safeParse(mapId).success)continue;
      const dir=await safePath(root,mapId); await directory(dir);
      const versions=(await readdir(dir)).filter(f=>/^[1-9]\d*\.json$/.test(f)).map(f=>Number(f.slice(0,-5))).sort((a,b)=>a-b);
      for(const [i,v] of versions.entries()){if(v!==i+1)fault('strategy_map_corrupt',503);results.push(await this.read(id,mapId,v));}
    }
    return results.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.version-b.version);
  }
  /** Called inside the Host's existing mutation queue, including Agent tool calls. */
  async save(id:string,raw:unknown,author:StrategyMapAuthor,provenance:Provenance={},assertCurrent?:()=>void):Promise<StrategyMapVersion>{
    const {expectedVersion,operationId,mapId,reason,draft:parsed}=checked(saveSchema,raw);
    const {scenarioModel,...rest}=parsed;
    const draft:StrategyMapDraft={...rest,...(scenarioModel!==undefined&&{scenarioModel:parseStrategyScenarioModel(scenarioModel)})};
    const nodes=new Set(draft.nodes.map(n=>n.id)),edges=new Set(draft.edges.map(e=>e.id));
    if(nodes.size!==draft.nodes.length || edges.size!==draft.edges.length)fault('invalid_strategy_map: 重复的节点或连线编号');
    for(const e of draft.edges){
      if(e.from===e.to || !nodes.has(e.from)||!nodes.has(e.to))fault('invalid_strategy_map: '+e.id+' 的起点或终点无效');
      if(e.review && e.kind!=='hypothesis')fault('invalid_strategy_map: '+e.id+' 不是因果假设');
    }
    const versions=await this.list(id), previous=versions.filter(v=>v.mapId===mapId).at(-1);
    const requestHash=discussionHash({id,raw,author}), repeated=versions.find(v=>v.operationId===operationId);
    if(repeated){
      const saved=await this.entry(id,repeated.mapId,repeated.version);
      if(requestHash!==saved.requestHash)fault('strategy_map_operation_conflict',409);
      return repeated;
    }
    if(expectedVersion!==(previous?.version??0))fault('strategy_map_version_conflict',409);
    if(author!=='import' && draft.importSource && discussionHash(draft.importSource)!==discussionHash(previous?.importSource??null)) fault('invalid_strategy_map_import_source');
    if(previous?.importSource&&!draft.importSource)draft.importSource=previous.importSource;
    for(const edge of draft.edges){
      const old=previous?.edges.find(e=>e.id===edge.id);
      if(old?.review && edge.review && discussionHash(old.review)===discussionHash(edge.review))delete edge.review;
    }
    const citations=[...(previous?.citations??[])];
    for(const citation of provenance.citations??[])if(!citations.some(c=>c.token===citation.token))citations.push(citation);
    for(const e of draft.edges)if(e.citationTokens?.some(t=>!citations.some(c=>c.token===t)))fault('strategy_map_citation_unavailable');
    if(!draft.nodes.length && !(draft.importSource && draft.unknowns.trim()))fault('invalid_strategy_map: 请提供节点或说明待核的图形来源');
    const requestId=author==='agent'&&provenance.requestId?discussionId(provenance.requestId):undefined;
    const version=expectedVersion+1,record={...(requestId&&{requestId}),...draft,discussionId:id,mapId,version,reason,operationId,requestHash,author,createdAt:new Date().toISOString(),citations,...((provenance.source??previous?.source)&&{source:provenance.source??previous?.source})};
    const file=await safePath(this.owner(id),'maps/'+mapId+'/'+version+'.json',true);
    assertCurrent?.();
    await atomicJson(file,{...record,contentSha256:discussionHash(record)});
    return this.read(id,mapId,version);
  }
}
