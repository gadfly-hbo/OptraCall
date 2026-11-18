import {parseCaseCreationSource} from './case-creation-source.ts';
import { discussionHash, discussionId, StrategyDiscussionFault } from './strategy-discussion-store.ts';
import { businessRoleNames, type BusinessRoleOwner } from './business-role-types.ts';
import type { createStrategyDiscussionHost, RoleContextReader } from './strategy-discussion-host.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';

function invalid(): never { throw new StrategyDiscussionFault('invalid_business_role_owner',400); }
function object(value:unknown): value is Record<string,unknown> {return !!value && typeof value === 'object' && !Array.isArray(value);}
function keys(value:Record<string,unknown>, permitted:string[]) { if (Object.keys(value).some(k=>!permitted.includes(k))) invalid(); }
function shortText(value:unknown):string { if(typeof value!=='string'||!value.trim()||value.length>200||value.includes('\0'))invalid();return value; }
export function parseBusinessRoleOwner(input: unknown): BusinessRoleOwner {
  if (!object(input)) return invalid();
  switch(input.role) {
    case 'strategy':
    case 'goal':{
      keys(input,['role','goalId','version','caseSource','teachReview']);
      if(!Number.isSafeInteger(input.version)||Number(input.version)<1) return invalid();
      if(input.teachReview!==undefined){
        if(input.caseSource || !object(input.teachReview))return invalid();
        const review=input.teachReview;keys(review,['caseId','issueId','choiceId','reviewId']);
        return {role:input.role,goalId:discussionId(input.goalId),version:Number(input.version),teachReview:{
          caseId:discussionId(review.caseId),issueId:discussionId(review.issueId),choiceId:discussionId(review.choiceId),reviewId:discussionId(review.reviewId),
        }};
      }
      if(input.role==='strategy')return invalid();
      return {role:'goal',goalId:discussionId(input.goalId),version:Number(input.version),...(input.caseSource===undefined?{}:{caseSource:parseCaseCreationSource(input.caseSource)})};
    }
    case 'case':
      keys(input,['role','caseId','itemId']);
      return {role:'case',caseId:discussionId(input.caseId),itemId:discussionId(input.itemId)};
    case 'project':
      keys(input,['role','projectId','issue']);
      if (input.issue !== undefined) {
        if (!object(input.issue)) return invalid();
        keys(input.issue, ['caseId','issueId']);
        return {role:'project',projectId:discussionId(input.projectId),issue:{caseId:discussionId(input.issue.caseId),issueId:discussionId(input.issue.issueId)}};
      }
      return {role:'project',projectId:discussionId(input.projectId)};
    case 'goal-draft': {
      keys(input,['role','draftId','scope','strategyChoice','caseSource']);
      let strategyChoice;
      if(input.strategyChoice!==undefined){
        if(!object(input.strategyChoice))return invalid();
        const selected=input.strategyChoice;
        keys(selected,['discussionId','version']);
        if(!Number.isSafeInteger(selected.version)||Number(selected.version)<1)return invalid();
        strategyChoice={discussionId:discussionId(selected.discussionId),version:Number(selected.version)};
      }
      if(!object(input.scope)) return invalid();
      const scope=input.scope;keys(scope,['kind','id','name','enterpriseId']);
      const kind=scope.kind;
      if(kind!=='enterprise'&&kind!=='department'&&kind!=='personal') return invalid();
      return {role:'goal-draft',draftId:discussionId(input.draftId),...(input.caseSource===undefined?{}:{caseSource:parseCaseCreationSource(input.caseSource)}),...(strategyChoice?{strategyChoice}:{}),scope:{kind,id:shortText(scope.id),name:shortText(scope.name),...(scope.enterpriseId===undefined?{}:{enterpriseId:shortText(scope.enterpriseId)})}};
    }
    default: return invalid();
  }
}
export function businessRoleConversationId(owner:BusinessRoleOwner):string {
  const h=discussionHash(owner);return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20,32)].join('-');
}
type RoleHost=ReturnType<typeof createStrategyDiscussionHost>;
export function createBusinessRoleConversations(options:{
  host:RoleHost; context:RoleContextReader;
  initialConfiguration(owner:BusinessRoleOwner):Promise<Readonly<RuntimeModelConfiguration>|null|undefined>;
  configuration(id?:string, revision?:number):Readonly<RuntimeModelConfiguration>|null|undefined;
  mutate<T>(fn:()=>T|Promise<T>):Promise<T>;
}) {
  return async function handle(rawOwner:string|null,action:string|null,method:string,input:Record<string,unknown>){
    let raw:unknown;try{raw=JSON.parse(rawOwner??'null');}catch{return invalid();}
    const owner=parseBusinessRoleOwner(raw), id=businessRoleConversationId(owner);
    const host=options.host;
    let record;
    try { record=host.store.get(id); }
    catch(error){if(!(error instanceof StrategyDiscussionFault)||error.status!==404)throw error;}
    if(record&&discussionHash(record.businessOwner)!==discussionHash(owner)) throw new StrategyDiscussionFault('business_role_owner_changed',409);
    if (action==='stop'&&method==='POST') {
      keys(input,['expectedRequestId']);
      const requestId=discussionId(input.expectedRequestId);
      return record ? host.stop(id,requestId) : {stopped:false};
    }
    if (action==='close'&&method==='POST') {
      keys(input,[]);
      return record ? host.close(id) : {closed:true};
    }
    if(action==='origin'&&method==='GET'){
      const review='teachReview' in owner&&owner.teachReview;
      if(owner.role!=='project'&&!review&&((owner.role!=='goal'&&owner.role!=='goal-draft')||!owner.caseSource))invalid();
      const config=record?options.configuration(record.configurationId,record.configurationRevision):await options.initialConfiguration(owner);
      const context=await options.context(owner,config??undefined,false);
      if(owner.role==='project'){if(!object(context)||!object(context.workBasis))throw new StrategyDiscussionFault('project_goal_scope_unavailable',409);return {origin:context.workBasis};}
      if(review&&object(context)&&object(context.teachReview))return {origin:context.teachReview};
      if(!object(context)||!object(context.caseOrigin))throw new StrategyDiscussionFault('goal_origin_unavailable',409);
      return {origin:context.caseOrigin};
    }
    if(!action&&method==='GET'){
      const requestId = input.requestId === undefined ? undefined : discussionId(input.requestId);
      if(!record){
        const initial=await options.initialConfiguration(owner);
        await options.context(owner,initial??undefined,false);
        return {discussion:null,busy:false,configurationId:initial?.id};
      }
      return host.detail(id,requestId,true);
    }
    if (action==='configuration'&&method==='POST'&&record){
      keys(input,['configurationId','expectedRevision']);
      const config=options.configuration(shortText(input.configurationId));
      if(!config)throw new StrategyDiscussionFault('configuration_required');
      await options.context(owner,config,true);
      await host.verifyRoleHistory(id,config);
      if(host.domain.busy(host.domain.ref(record)))throw new StrategyDiscussionFault('session_busy');
      await host.domain.close(host.domain.ref(record));
      return options.mutate(()=>({discussion:host.store.update(id,{expectedRevision:Number(input.expectedRevision),configurationId:config.id},config)}));
    }
    if(action!=='messages'||method!=='POST') throw new StrategyDiscussionFault('business_role_action_not_found',404);
    keys(input,['requestId','text','expectedRevision','replacePendingRequestId']);
    discussionId(input.requestId);
    if(typeof input.text!=='string'||!input.text.trim()||input.text.length>20000||!Number.isSafeInteger(input.expectedRevision))invalid();
    if(!record){
      if(input.expectedRevision!==0)throw new StrategyDiscussionFault('strategy_discussion_context_changed');
      const config=await options.initialConfiguration(owner);
      if(!config)throw new StrategyDiscussionFault('configuration_required');
      await options.context(owner,config,true);
      await options.mutate(()=>host.store.create({operationId:id,title:businessRoleNames[owner.role],methods:[],...(owner.role==='project'?{projectId:owner.projectId}:{}),...(owner.role==='goal'?{goal:{goalId:owner.goalId,version:owner.version}}:{})},config,owner));
    }
    if(record){
      if(record.lastRun?.id===input.requestId)await host.verifyRoleHistory(id);
      else await options.context(owner,options.configuration(record.configurationId,record.configurationRevision)??undefined,true);
    }
    return host.send(id,{...input,expectedRevision:input.expectedRevision===0?1:input.expectedRevision});
  };
}
