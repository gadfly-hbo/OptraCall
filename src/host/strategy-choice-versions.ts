import { randomUUID } from 'node:crypto';
import type { GoalScope, GoalSourceRef } from './strategy-goals-types.ts';
import { parseGoalSourceRef } from './strategy-goals-store.ts';
import { discussionHash, StrategyDiscussionFault, type StrategyDiscussionStore } from './strategy-discussion-store.ts';
import type { GoalDiscussionSourceRef } from './strategy-goals-types.ts';
import type { StrategyChoiceDraft, StrategyChoiceVersion } from './strategy-discussion-types.ts';
import type { VersionDocument } from './management-documents.ts';

const fields = ['options','choice','rationale','assumptions','unknowns'] as const;
function payload(input: Record<string,unknown>): StrategyChoiceDraft {
  const draft = {} as StrategyChoiceDraft;
  for (const key of fields) {
    const value = input[key];
    if (typeof value !== 'string' || value.length > 6000) throw new StrategyDiscussionFault('invalid_strategy_choice',400);
    draft[key] = value.trim();
  }
  return draft;
}
function identity(version: StrategyChoiceDraft & Pick<StrategyChoiceVersion,'source'|'title'|'scope'>) {
  return discussionHash([version.title,version.scope,version.source,...fields.map(key=>version[key])]);
}
export function createStrategyChoices(store: StrategyDiscussionStore, readReply: (id:string, source:GoalDiscussionSourceRef)=>Promise<string>, busy:(id:string)=>boolean) {
  function writable(id:string, expected:unknown) {
    const owner=store.get(id);
    if(busy(id) || owner.revision!==expected) throw new StrategyDiscussionFault('strategy_discussion_context_changed');
    return owner;
  }
  function find(id:string,number:number) {
    const version=store.versions(id).find(v=>v.version===number);
    if(!version) throw new StrategyDiscussionFault('strategy_version_not_found',404);
    if(identity(version)!==version.contentSha256) throw new StrategyDiscussionFault('strategy_version_corrupt',503);
    return version;
  }
  async function read(id:string, number:number) {
    const version=find(id,number);
    const reply=await readReply(id,version.source);
    return {version,reply};
  }
  async function save(id:string,input:Record<string,unknown>) {
    let ref:GoalSourceRef;
    try { ref = parseGoalSourceRef(input.source as GoalSourceRef); }
    catch { throw new StrategyDiscussionFault('invalid_strategy_choice_source',400); }
    if (ref.authority !== 'strategy-discussion' || ref.id !== id || ref.entryType !== 'message') throw new StrategyDiscussionFault('invalid_strategy_choice_source',400);
    const source = ref as GoalDiscussionSourceRef;
    await readReply(id,source);
    const owner=store.get(id), draft={...payload(input),source,title:owner.title,scope:owner.usageContext?.background||(owner.usageContext ? {organization:'组织',department:'部门',personal:'个人'}[owner.usageContext.kind] : '范围未声明')};
    const contentSha256=identity(draft),versions=store.versions(id);
    const existing=versions.find(v=>v.contentSha256===contentSha256);
    if(existing)return find(id,existing.version);
    writable(id,input.expectedRevision);
    const now=new Date().toISOString();
    const version={...draft,contentSha256,version:versions.length+1,createdAt:now};
    store.write({...owner,revision:owner.revision+1,updatedAt:now},[...versions,version]);
    return version;
  }
  async function handoff(id:string,number:number,expected:unknown,scope:GoalScope) {
    const {version}=await read(id,number);
    if(version.handedOffAt){
      if(discussionHash(version.destination?.scope)!==discussionHash(scope))throw new StrategyDiscussionFault('strategy_handoff_scope_changed');
      return version;
    }
    const owner=writable(id,expected),now=new Date().toISOString(), next={...version,handedOffAt:now,destination:{draftId:randomUUID(),scope}};
    store.write({...owner,revision:owner.revision+1,updatedAt:now},store.versions(id).map(v=>v.version===number?next:v));
    return next;
  }
  return {save,read,handoff,list:(id:string)=>store.versions(id).map(({version,createdAt,handedOffAt})=>({version,createdAt,handedOffAt}))};
}
export function strategyDocument(v: StrategyChoiceVersion, reply:string):VersionDocument {
  return {kind:'战略选择表',title:v.title,scope:v.scope,version:v.version,status:v.handedOffAt?'已交接至目标管理':'候选稿',createdAt:v.createdAt,identity:v.source.id,tables:[
    {title:'选择与交接',columns:['条目','本版正文'],rows:[
      ['备选方向',v.options||'见原回复'],['选择或候选意见',v.choice||'见原回复'],['比较依据',v.rationale||'见原回复'],['关键假设',v.assumptions||'尚未另记'],['待核项',v.unknowns||'尚未另记'],['所选原回复',reply]]},
    {title:'版本依据',columns:['条目','准确引用'],rows:[['原会话',v.source.sessionId],['原回复',String(v.source.version)],['原回复 SHA-256',v.source.sha256],['文稿 SHA-256',v.contentSha256]]},
  ]};
}
