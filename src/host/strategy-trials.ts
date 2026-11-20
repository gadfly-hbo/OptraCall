import path from 'node:path';
import {z} from 'zod';
import { readdir } from 'node:fs/promises';
import { atomicJson, directory, exists, readBytes } from './project-data-context-io.ts';
import { discussionHash, discussionId, StrategyDiscussionFault, type StrategyDiscussionStore } from './strategy-discussion-store.ts';
import { compareStrategyScenarios, parseStrategyScenarioModel, type StrategyScenarioConditions, type StrategyScenarioModel } from './strategy-simulation.ts';

export interface TrialMapRef {mapId:string;version:number;contentSha256:string;liftPoints?:number;service?:{remote:number;parts:number;fixed:number}}
export interface StrategyTrialInput { mode?:'conditions'|'assumptions';operationId:string; name:string; maps:TrialMapRef[]; conditions?:StrategyScenarioConditions; edge?:{mapId:string;version:number;edgeId:string} }
export interface StrategyTrial extends StrategyTrialInput {createdAt:string;fingerprint:string}
type TrialVersion={mapId:string;version:number;contentSha256:string;scenarioModel?:StrategyScenarioModel;edges:readonly {id:string;kind:string}[]};
type ReadMap=(discussionId:string,mapId:string,version:number)=>Promise<TrialVersion>;

const versionRef=z.object({mapId:z.string().uuid(),version:z.number().int().positive()});
const trialSchema=z.strictObject({
  mode:z.enum(['conditions','assumptions']).optional(),operationId:z.string().uuid(),name:z.string().trim().min(1).max(200),
  maps:z.array(versionRef.extend({contentSha256:z.string().regex(/^[0-9a-f]{64}$/),liftPoints:z.number().finite().optional(),service:z.strictObject({remote:z.number().min(0).max(100),parts:z.number().min(0).max(100),fixed:z.number().nonnegative()}).optional()}).strict()).min(2),
  conditions:z.strictObject({populationSize:z.number().int().positive(),coverage:z.number().min(0).max(100).optional(),unitCost:z.number().finite().nonnegative().optional(),baselineRate:z.number().min(0).max(100).optional()}).optional(),
  edge:versionRef.extend({edgeId:z.string().min(1).max(300)}).strict().optional(),
});

export function createStrategyTrials(store:StrategyDiscussionStore, readMap:ReadMap) {
  function folder(id:string) {
    if(store.get(id).businessOwner) throw new StrategyDiscussionFault('strategy_discussion_not_found',404);
    return path.join(store.directory(id),'scenario-records');
  }
  async function verify(id:string, data:StrategyTrialInput) {
    if(new Set(data.maps.map(m=>m.mapId+':'+m.version)).size!==data.maps.length)
      throw new StrategyDiscussionFault('invalid_scenario_versions',400);
    const models=await Promise.all(data.maps.map(async m=>{
      if(!m || !Number.isSafeInteger(m.version) || m.version<1) throw new StrategyDiscussionFault('invalid_scenario_versions',400);
      const v=await readMap(id,discussionId(m.mapId),m.version);
      if(v.contentSha256!==m.contentSha256) throw new StrategyDiscussionFault('strategy_map_version_changed',409);
      if(data.edge?.mapId===v.mapId && data.edge.version===v.version && !v.edges.some(e=>e.id===data.edge!.edgeId && e.kind==='hypothesis')) throw new StrategyDiscussionFault('invalid_scenario_edge',400);
      if(m.service){
        if(v.scenarioModel?.model!=='repeat-visits-v1' || m.liftPoints!==undefined)throw new StrategyDiscussionFault('invalid_scenario_model',400);
        return parseStrategyScenarioModel({...v.scenarioModel,...m.service});
      }
      if(m.liftPoints!==undefined && v.scenarioModel?.model==='repeat-visits-v1')throw new StrategyDiscussionFault('invalid_scenario_liftPoints',400);
      return m.liftPoints===undefined ? v.scenarioModel : parseStrategyScenarioModel({...v.scenarioModel,liftPoints:m.liftPoints});
    }));
    if(data.edge && !data.maps.some(m=>m.mapId===data.edge!.mapId && m.version===data.edge!.version)) throw new StrategyDiscussionFault('invalid_scenario_edge',400);
    if(data.conditions && compareStrategyScenarios(models,data.conditions).kind!=='quantitative') throw new StrategyDiscussionFault('invalid_scenario_conditions',400);
  }
  async function readRecord(dir:string,operationId:string):Promise<StrategyTrial> {
    const record=JSON.parse((await readBytes(path.join(dir,discussionId(operationId)+'.json'),65536)).toString('utf8')) as StrategyTrial;
    const {createdAt,fingerprint,...input}=record;
    if(record.operationId!==operationId||!createdAt||discussionHash(input)!==fingerprint) throw new StrategyDiscussionFault('strategy_simulation_record_changed',409);
    return record;
  }
  return {
    async save(id:string,input:Record<string,unknown>) {
      const dir=folder(id);
      const parsed=trialSchema.safeParse(input);
      if(!parsed.success) throw new StrategyDiscussionFault('invalid_scenario_input: '+parsed.error.issues.map(e=>e.path.join('.')).join(', '),400);
      const data=parsed.data,operationId=data.operationId;
      await verify(id,data);
      await directory(dir,true);
      const file=path.join(dir,operationId+'.json'),fingerprint=discussionHash(data);
      if(await exists(file)){
        const old=await readRecord(dir,operationId);
        if(old.fingerprint!==fingerprint) throw new StrategyDiscussionFault('strategy_simulation_operation_conflict');
        return old;
      }
      const record={...data,createdAt:new Date().toISOString(),fingerprint};
      if(Buffer.byteLength(JSON.stringify(record))>=65536)throw new StrategyDiscussionFault('strategy_simulation_record_too_large',413);
      await atomicJson(file,record);
      return record;
    },
    async list(id:string) {
      const dir=folder(id);
      if(!await exists(dir)) return {trials:[],unavailable:0};
      await directory(dir);
      const trials:StrategyTrial[]=[];
      let unavailable=0;
      for(const name of await readdir(dir)){
        if(!name.endsWith('.json')) continue;
        const record=await readRecord(dir,name.slice(0,-5));
        try{await verify(id,record);}
        catch(error){
          if(!error || typeof error!=='object' || !('status' in error) || ![403,404,409].includes(Number(error.status))) throw error;
          unavailable++;continue;
        }
        trials.push(record);
      }
      return {trials:trials.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),unavailable};
    },
  };
}
