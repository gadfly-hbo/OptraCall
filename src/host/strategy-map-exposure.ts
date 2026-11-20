import { discussionHash, StrategyDiscussionFault } from './strategy-discussion-store.ts';
import type { StrategyMapVersion } from './strategy-map-types.ts';
import type { readNativeSessionSnapshot } from './native-session-snapshot.ts';

type Entry=Awaited<ReturnType<typeof readNativeSessionSnapshot>>['entries'][number];
type Ref=Pick<StrategyMapVersion,'mapId'|'version'|'contentSha256'>;
export type MapExposure=Ref & {kind:'catalog'|'body'|'page'};
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const unknown=():never=>{throw new StrategyDiscussionFault('strategy_map_history_source_unverified',409);};
function exposure(value:unknown,kind:MapExposure['kind']):MapExposure{
  if(!object(value)||typeof value.mapId!=='string'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.mapId)||
    !Number.isSafeInteger(value.version)||Number(value.version)<1||typeof value.contentSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.contentSha256))return unknown();
  return {mapId:value.mapId,version:Number(value.version),contentSha256:value.contentSha256,kind};
}
export function promptMapExposure(context:{mapCandidates?:unknown;currentMap?:unknown}):MapExposure[]{
  if(context.currentMap===undefined && context.mapCandidates===undefined)return [];
  if(!object(context.currentMap)||!Array.isArray(context.mapCandidates))return unknown();
  const current=exposure(context.currentMap,context.currentMap.bodyIncluded===false?'catalog':'body');
  const refs=context.mapCandidates.map(v=>exposure(v,'catalog'));
  const index=refs.findIndex(r=>r.mapId===current.mapId&&r.version===current.version);
  if(index<0)refs.push(current);else {if(refs[index].contentSha256!==current.contentSha256)return unknown();refs[index]=current;}
  return refs;
}

/** Inspect the actual native branch prefix. A partial page and a directory entry
 * carry the same access boundary while remaining distinct from a full body. */
export function nativeMapExposure(entries:readonly Entry[]){
  const records=new Map<string,MapExposure & {at:number}>(), positions=new Map<string,number>();
  const calls=new Map<string,{action:'read-map'|'save-map';args:Record<string,unknown>}>();
  let run:Record<string,unknown>|undefined;
  function add(ref:MapExposure,at:number){
    const key=ref.mapId+':'+ref.version+':'+ref.kind;
    const old=records.get(key);if(old&&old.contentSha256!==ref.contentSha256)unknown();if(!old)records.set(key,{...ref,at});
  }
  for(const [at,entry] of entries.entries()){
    positions.set(entry.id,at);
    if(entry.type==='custom' && entry.customType==='optracall.run' && object(entry.data) && entry.data.phase==='started'){
      calls.clear();const pc=entry.data.providedContext;
      run=object(pc)&&object(pc.strategyDiscussion)&&!pc.businessRole?pc:undefined;
    }
    if(entry.type!=='message'||!run)continue;
    const message=entry.message;
    if(message.role==='user'){
      const text=typeof message.content==='string'?message.content:message.content.filter(p=>p.type==='text').map(p=>p.text).join('');
      const marker=(run.strategyDiscussion as Record<string,unknown>).mapExposure;
      // Pre-map sessions have no projection. For earlier map sessions reconstruct
      // it from the original Host-hashed JSON envelope without altering the file.
      if(marker===undefined&&!text.includes('"currentMap":')&&!text.includes('"mapCandidates":'))continue;
      const suffix='\n\n用户本轮原话：\n'+run.originalUserText;
      if(typeof run.originalUserText!=='string'||!text.endsWith(suffix)||discussionHash(text)!==run.requestTextSha256)return unknown();
      let envelope:unknown;try{envelope=JSON.parse(text.slice(0,-suffix.length));}catch{return unknown();}
      if(!object(envelope))return unknown();
      const actual=promptMapExposure(envelope);
      if(marker!==undefined&&discussionHash(marker)!==discussionHash(actual))return unknown();
      for(const ref of actual)add(ref,at);
    }
    if(message.role==='assistant'){
      for(const p of message.content){
        if(p.type!=='toolCall'||p.name!=='strategy_goals'||!object(p.arguments))continue;
        const action=p.arguments.action;
        if(action==='read-map'||action==='save-map')calls.set(p.id,{action,args:p.arguments});
      }
    }
    if(message.role!=='toolResult'||message.toolName!=='strategy_goals')continue;
    const call=calls.get(message.toolCallId);if(!call)continue;
    calls.delete(message.toolCallId);if(message.isError)continue;
    if(message.content.length!==1||message.content[0].type!=='text')return unknown();
    let result:unknown;try{result=JSON.parse(message.content[0].text);}catch{return unknown();}
    if(!object(result)||message.details!==undefined&&discussionHash(message.details)!==discussionHash(result))return unknown();
    if(call.action==='save-map'){add(exposure(result.map,'catalog'),at);continue;}
    if(!call.args.mapId&&!call.args.version){
      if(!Array.isArray(result.maps))return unknown();
      for(const row of result.maps)add(exposure(row,'catalog'),at);
    }else{
      const ref=result.map?exposure(result.map,'body'):exposure(result.ref,'page');
      if(ref.mapId!==call.args.mapId||ref.version!==call.args.version)return unknown();
      if(ref.kind==='page'&&(!object(result.range)||typeof result.text!=='string'||result.range.start!==(call.args.offset??0)||
        Number(result.range.end)-Number(result.range.start)!==result.text.length))return unknown();
      add(ref,at);
    }
  }
  return {records:[...records.values()],positions};
}
