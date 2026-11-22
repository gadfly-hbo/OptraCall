import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {atomicJson, exists, isMissing, readBytes, safePath} from './project-data-context-io.ts';
import {StrategyDiscussionFault, type StrategyDiscussionStore, discussionHash, discussionId} from './strategy-discussion-store.ts';
import type {StrategyMapPublication} from './strategy-map-types.ts';

const uuid=z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const sha256=z.string().regex(/^[0-9a-f]{64}$/);
const timestamp=z.string().datetime({precision:3});
const publication=z.strictObject({
  publicationId:uuid, discussionId:uuid, mapId:uuid, version:z.number().int().positive(),
  contentSha256:sha256, state:z.enum(['active','superseded','withdrawn']),
  goalCount:z.number().int().nonnegative().max(1000), strategyCount:z.number().int().nonnegative().max(1000),
  operationId:uuid, publishedAt:timestamp, supersededAt:timestamp.optional(), withdrawnAt:timestamp.optional(), withdrawOperationId:uuid.optional(),
});
const stored=z.strictObject({records:z.array(publication).max(10000), storageSha256:sha256});
const input=z.strictObject({operationId:uuid, sha256:sha256});
const withdrawInput=input.extend({publicationId:uuid});
const fault=(message:string,status=400):never=>{throw new StrategyDiscussionFault(message,status);};
const parsed=<T>(schema:z.ZodType<T>,value:unknown):T=>{
  const result=schema.safeParse(value);
  if(!result.success)fault('invalid_strategy_map_publication_input');
  return result.data!;
};
const identityOf=(record:StrategyMapPublication)=>({discussionId:record.discussionId,mapId:record.mapId,version:record.version,contentSha256:record.contentSha256});

export class StrategyMapPublicationStore {
  readonly #discussions:StrategyDiscussionStore;
  constructor(discussions:StrategyDiscussionStore){this.#discussions=discussions;}
  #owner(id:string){
    if(this.#discussions.get(id).businessOwner)fault('strategy_discussion_not_found',404);
    return this.#discussions.directory(id);
  }
  async #file(id:string,mapId:string,create=false){
    return safePath(this.#owner(id),'maps/'+discussionId(mapId)+'/publications.json',create);
  }
  async #read(id:string,mapId:string):Promise<StrategyMapPublication[]>{
    const file=await this.#file(id,mapId).catch(error=>{
      if(isMissing(error)) return fault('strategy_map_not_found',404);
      throw error;
    });
    if(!await exists(file))return [];
    let value:unknown;
    try{value=JSON.parse((await readBytes(file,2*1024*1024)).toString());}
    catch{fault('strategy_map_publication_corrupt',503);}
    const parsed=stored.safeParse(value);
    if(!parsed.success)fault('strategy_map_publication_corrupt',503);
    const {storageSha256,records}=parsed.data!;
    if(discussionHash(records)!==storageSha256)fault('strategy_map_publication_corrupt',503);
    this.#validate(records,id,mapId);
    return structuredClone(records);
  }
  async #write(id:string,mapId:string,records:StrategyMapPublication[]){
    this.#validate(records,id,mapId);
    const file=await this.#file(id,mapId,true);
    await atomicJson(file,{records,storageSha256:discussionHash(records)});
  }
  #validate(records:StrategyMapPublication[],id:string,mapId:string){
    const publicationIds=new Set<string>(), versions=new Set<number>(), operations=new Set<string>();
    let active=0;
    for(const record of records){
      if(record.discussionId!==id||record.mapId!==mapId)fault('strategy_map_publication_corrupt',503);
      if(publicationIds.has(record.publicationId)||versions.has(record.version)||operations.has(record.operationId))fault('strategy_map_publication_corrupt',503);
      publicationIds.add(record.publicationId);versions.add(record.version);operations.add(record.operationId);
      if(record.withdrawOperationId){
        if(operations.has(record.withdrawOperationId))fault('strategy_map_publication_corrupt',503);
        operations.add(record.withdrawOperationId);
      }
      if(record.state==='active')active++;
      if(record.state==='superseded'&&!record.supersededAt)fault('strategy_map_publication_corrupt',503);
      if(record.state==='withdrawn'&&(!record.withdrawnAt||!record.withdrawOperationId))fault('strategy_map_publication_corrupt',503);
    }
    if(active>1)fault('strategy_map_publication_corrupt',503);
  }
  async list(id:string,mapId:string){discussionId(id);discussionId(mapId);return this.#read(id,mapId);}
  async publish(id:string,mapId:string,version:number,raw:unknown,readSummary:()=>Promise<{contentSha256:string;goalCount:number;strategyCount:number}>):Promise<StrategyMapPublication>{
    const request=parsed(input,raw), records=await this.#read(id,mapId);
    const repeated=records.find(record=>record.operationId===request.operationId||record.withdrawOperationId===request.operationId);
    if(repeated){
      if(repeated.operationId!==request.operationId||discussionHash(identityOf(repeated))!==discussionHash({discussionId:id,mapId,version,contentSha256:request.sha256}))
        fault('strategy_map_publication_operation_conflict',409);
      return structuredClone(repeated);
    }
    if(records.some(record=>record.version===version))fault('strategy_map_publication_already_published',409);
    if(records.some(record=>record.version>version))fault('strategy_map_publication_version_outdated',409);
    const summary=await readSummary();
    if(request.sha256!==summary.contentSha256)fault('strategy_map_version_conflict',409);
    const now=new Date().toISOString();
    const active=records.find(record=>record.state==='active');
    if(active)active.supersededAt=now,active.state='superseded';
    const record:StrategyMapPublication={
      publicationId:randomUUID(),discussionId:id,mapId,version,contentSha256:request.sha256,state:'active',
      goalCount:summary.goalCount,strategyCount:summary.strategyCount,operationId:request.operationId,publishedAt:now,
    };
    records.push(record);await this.#write(id,mapId,records);return structuredClone(record);
  }
  async withdraw(id:string,mapId:string,version:number,raw:unknown):Promise<StrategyMapPublication>{
    const request=parsed(withdrawInput,raw), records=await this.#read(id,mapId);
    const expected=discussionHash({discussionId:id,mapId,version,contentSha256:request.sha256});
    const matches=(record:StrategyMapPublication)=>record.publicationId===request.publicationId&&discussionHash(identityOf(record))===expected;
    const repeated=records.find(record=>record.operationId===request.operationId||record.withdrawOperationId===request.operationId);
    if(repeated){
      if(repeated.withdrawOperationId!==request.operationId||!matches(repeated))
        return fault('strategy_map_publication_operation_conflict',409);
      return structuredClone(repeated);
    }
    const record=records.find(matches);
    if(!record)return fault('strategy_map_publication_conflict',409);
    if(record.state!=='active')return fault('strategy_map_not_published',409);
    record.state='withdrawn';record.withdrawnAt=new Date().toISOString();record.withdrawOperationId=request.operationId;
    await this.#write(id,mapId,records);return structuredClone(record);
  }
  async active(id:string,mapId:string,version:number,contentSha256:string,publicationId:string):Promise<StrategyMapPublication>{
    const record=(await this.#read(id,mapId)).find(item=>item.publicationId===publicationId);
    if(!record)fault('strategy_map_publication_conflict',409);
    if(discussionHash(identityOf(record!))!==discussionHash({discussionId:id,mapId,version,contentSha256}))fault('strategy_map_publication_conflict',409);
    if(record!.state!=='active')fault('strategy_map_not_published',409);
    return structuredClone(record!);
  }
}
