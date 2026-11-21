import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import { atomicJson, directory, exists, readBytes, safePath } from './project-data-context-io.ts';
import { StrategyDiscussionFault, type StrategyDiscussionStore, discussionHash, discussionId } from './strategy-discussion-store.ts';
import type { StrategyMapAuthor, StrategyMapDraft, StrategyMapSourceLocation, StrategyMapVersion } from './strategy-map-types.ts';
import { parseStrategyScenarioModel } from './strategy-simulation.ts';

const uuid=z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const text=z.string().max(6000);
const label=z.string().trim().min(1).max(300);
const bbox=z.tuple([z.number(),z.number(),z.number(),z.number()]).refine(([x,y,w,h])=>Number.isFinite(x)&&Number.isFinite(y)&&Number.isFinite(w)&&Number.isFinite(h)&&x>=0&&y>=0&&w>0&&h>0&&x+w<=1000&&y+h<=1000,'bbox must lie within 0..1000');
const sourceLocation=z.strictObject({sourceId:label,fileName:label.optional(),page:z.number().int().positive().optional(),sheet:label.optional(),row:z.number().int().positive().optional(),cell:label.optional(),objectId:label.optional(),label,bbox:bbox.optional(),fromBbox:bbox.optional(),toBbox:bbox.optional(),arrowBbox:bbox.optional()});
const reviewState=z.enum(['clear','needs-review','confirmed']);
const sourceConflict=z.strictObject({field:label,values:z.array(z.strictObject({value:text,label,locationLabel:label})).min(1).max(10)});
const multiImportSource=z.strictObject({sourceId:label,format:z.enum(['xlsx','pptx','pdf','image']),fileName:label,sha256:z.string().regex(/^[0-9a-f]{64}$/),origin:z.enum(['upload','discussion-attachment','project-file']),selectedPages:z.array(z.number().int().positive()).max(200).optional(),imageMeta:z.strictObject({width:z.number().int().positive(),height:z.number().int().positive(),orientation:z.number().int().min(1).max(8).optional()}).optional()});
const metricFields={metric:label,baseline:text.optional(),baselineKind:text.optional(),target:text.optional(),unit:text.optional(),period:text.optional()};
const metric=z.strictObject(metricFields);
const node=z.strictObject({...metricFields,metric:text.optional(),id:label,kind:z.enum(['goal','strategy','other']),title:label,owner:text.optional(),perspective:text.optional(),detail:text.optional(),metrics:z.array(metric).max(100).optional(),sourceLocation:sourceLocation.optional(),reviewState:reviewState.optional(),ambiguityReason:text.optional(),sourceConflicts:z.array(sourceConflict).max(20).optional()});
const reviewText=text.trim().min(1);
const review=z.strictObject({summary:reviewText,mechanism:reviewText,condition:reviewText,alternative:reviewText,risk:reviewText,scope:reviewText,test:reviewText});
const edge=z.strictObject({id:label,from:label,to:label,kind:z.enum(['supports','upstream','decomposition','hypothesis','unknown']),review:review.optional(),citationTokens:z.array(label).optional(),sourceLocation:sourceLocation.optional(),reviewState:reviewState.optional(),ambiguityReason:text.optional()});
const importSource=z.strictObject({fileName:label,sha256:z.string().regex(/^[0-9a-f]{64}$/),sheets:z.array(z.strictObject({name:label,headerRow:z.number().int().positive(),columns:z.record(label,text)})),rows:z.array(z.strictObject({nodeId:label,sheet:label,row:z.number().int().positive()}))});
const draftSchema=z.strictObject({title:label,template:z.enum(['table','tree','bsc']),choice:text.default(''),excluded:text.default(''),assumptions:text.default(''),unknowns:text.default(''),
  nodes:z.array(node).max(1000),edges:z.array(edge).max(3000),importSource:importSource.optional(),importSources:z.array(multiImportSource).max(20).optional(),scenarioModel:z.unknown().optional()});
const saveSchema=z.strictObject({operationId:uuid,mapId:uuid,expectedVersion:z.number().int().nonnegative(),reason:label,draft:draftSchema});
const fault=(message:string,status=400):never=>{throw new StrategyDiscussionFault(message,status);};
type Provenance=Pick<StrategyMapVersion,'source'> & Partial<Pick<StrategyMapVersion,'citations'|'requestId'|'importDraftEntryId'|'importDraftGroupId'>>;
type Stored=StrategyMapVersion & {requestHash:string};
function checked<T>(schema:z.ZodType<T>,value:unknown):T {
  const parsed=schema.safeParse(value);
  if(!parsed.success) return fault('invalid_strategy_map: '+parsed.error.issues.map(e=>e.path.join('.')+' '+e.message).join(' / '));
  return parsed.data;
}

function validateLocationAgainstSources(
  loc: StrategyMapSourceLocation | undefined,
  sourceMap: ReadonlyMap<string, NonNullable<StrategyMapDraft['importSources']>[number]>,
  itemLabel: string,
) {
  if (!loc) return;
  const src = sourceMap.get(loc.sourceId);
  if (!src) fault(`invalid_strategy_map: ${itemLabel} 的 sourceLocation.sourceId（${loc.sourceId}）未包含在 importSources 清单中`);
  if (loc.fileName !== undefined && loc.fileName !== src!.fileName) {
    fault(`invalid_strategy_map: ${itemLabel} 的 sourceLocation.fileName 与 importSources 不一致`);
  }
  if (loc.page !== undefined && src!.selectedPages?.length && !src!.selectedPages.includes(loc.page)) {
    fault(`invalid_strategy_map: ${itemLabel} 的 sourceLocation.page（${loc.page}）超出 importSources.selectedPages 范围`);
  }
}

export function validateStrategyMapDraft(
  rawDraft: unknown,
  options: { previous?: StrategyMapVersion; author?: StrategyMapAuthor } = {},
): StrategyMapDraft {
  const parsed = checked(draftSchema, rawDraft);
  const { scenarioModel, ...rest } = parsed;
  const draft: StrategyMapDraft = { ...rest, ...(scenarioModel !== undefined && { scenarioModel: parseStrategyScenarioModel(scenarioModel) }) };
  const nodes = new Set(draft.nodes.map(n => n.id)), edges = new Set(draft.edges.map(e => e.id));
  if (nodes.size !== draft.nodes.length || edges.size !== draft.edges.length) fault('invalid_strategy_map: 重复的节点或连线编号');
  for (const e of draft.edges) {
    if (e.from === e.to || !nodes.has(e.from) || !nodes.has(e.to)) fault('invalid_strategy_map: ' + e.id + ' 的起点或终点无效');
    if (e.review && e.kind !== 'hypothesis') fault('invalid_strategy_map: ' + e.id + ' 不是因果假设');
  }
  const previous = options.previous;
  if (options.author && options.author !== 'import' && draft.importSource && discussionHash(draft.importSource) !== discussionHash(previous?.importSource ?? null)) {
    fault('invalid_strategy_map_import_source');
  }
  if (previous?.importSource && !draft.importSource) draft.importSource = previous.importSource;
  if (previous?.importSources && !draft.importSources) draft.importSources = previous.importSources;

  const sourceMap = new Map<string, NonNullable<StrategyMapDraft['importSources']>[number]>();
  for (const src of draft.importSources ?? []) {
    if (sourceMap.has(src.sourceId)) fault('invalid_strategy_map: 重复的 importSources 来源编号');
    if (src.selectedPages && new Set(src.selectedPages).size !== src.selectedPages.length) {
      fault('invalid_strategy_map: importSources.selectedPages 存在重复页码');
    }
    sourceMap.set(src.sourceId, src);
  }
  for (const n of draft.nodes) validateLocationAgainstSources(n.sourceLocation, sourceMap, `节点 ${n.id}`);
  for (const e of draft.edges) validateLocationAgainstSources(e.sourceLocation, sourceMap, `连线 ${e.id}`);

  if (!draft.nodes.length && !((draft.importSource || draft.importSources?.length) && draft.unknowns.trim())) {
    fault('invalid_strategy_map: 请提供节点或说明待核的图形来源');
  }
  return draft;
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
    const versions=await this.list(id), previous=versions.filter(v=>v.mapId===mapId).at(-1);
    const requestHash=discussionHash({id,raw,author}), repeated=versions.find(v=>v.operationId===operationId);
    if(repeated){
      const saved=await this.entry(id,repeated.mapId,repeated.version);
      if(requestHash!==saved.requestHash)fault('strategy_map_operation_conflict',409);
      return repeated;
    }
    if(expectedVersion!==(previous?.version??0))fault('strategy_map_version_conflict',409);
    const draft=validateStrategyMapDraft(parsed,{previous,author});
    for(const edge of draft.edges){
      const old=previous?.edges.find(e=>e.id===edge.id);
      if(old?.review && edge.review && discussionHash(old.review)===discussionHash(edge.review))delete edge.review;
    }
    const citations=[...(previous?.citations??[])];
    for(const citation of provenance.citations??[])if(!citations.some(c=>c.token===citation.token))citations.push(citation);
    for(const e of draft.edges)if(e.citationTokens?.some(t=>!citations.some(c=>c.token===t)))fault('strategy_map_citation_unavailable');
    const requestId=author==='agent'&&provenance.requestId?discussionId(provenance.requestId):undefined;
    const version=expectedVersion+1,record={...(requestId&&{requestId}),...draft,discussionId:id,mapId,version,reason,operationId,requestHash,author,createdAt:new Date().toISOString(),citations,...((provenance.source??previous?.source)&&{source:provenance.source??previous?.source}),...(provenance.importDraftEntryId&&{importDraftEntryId:provenance.importDraftEntryId}),...(provenance.importDraftGroupId&&{importDraftGroupId:provenance.importDraftGroupId})};
    const file=await safePath(this.owner(id),'maps/'+mapId+'/'+version+'.json',true);
    assertCurrent?.();
    await atomicJson(file,{...record,contentSha256:discussionHash(record)});
    return this.read(id,mapId,version);
  }
}
