import type { PersonalSourceRef, PersonalMetadata, PersonalContentTarget, RetainPersonalInput, PersonalStateInput } from './personal-retention-types.ts';
import { object, canonical, digest } from './project-data-context-io.ts';
import { learningSourceRef } from './learning-source-validation.ts';
export class PersonalRetentionFault extends Error { readonly code: string; readonly status: number; constructor(code: string, status=400) { super(code); this.code=code; this.status=status; } }
export const fail=(code:string,status=400):never=>{throw new PersonalRetentionFault(code,status);};
export function keys(value: Record<string,unknown>, allowed: string[], required=allowed):void { if(Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!(key in value))) fail('invalid_personal_retention_fields'); }
export const id=(value:unknown):string=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)?value:fail('invalid_personal_retention_id');
export const hash=(value:unknown):string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:fail('invalid_personal_retention_hash');
export const integer=(value:unknown):number=>Number.isSafeInteger(value)&&(value as number)>=0?value as number:fail('invalid_personal_retention_revision');
export const text=(value:unknown,max:number):string=>typeof value==='string'&&value.length<=max&&!value.includes('\0')?value:fail('invalid_personal_retention_text');
export const label=(value:unknown):string|null=>value===null?null:text(value,200);
export function sourceRef(value:unknown):PersonalSourceRef {
  if(!object(value)) return fail('invalid_personal_source_ref');
  let result:PersonalSourceRef;
  const optional=['excerpt'];
  if(value.type==='enterprise') {keys(value,['type','storeId','materialId','revisionId',...optional],['type','storeId','materialId','revisionId']);result={type:'enterprise',storeId:id(value.storeId),materialId:id(value.materialId),revisionId:id(value.revisionId)};}
  else if(value.type==='citation') {
    keys(value,['type','projectId','citationId','target',...optional],['type','projectId','citationId','target']);
    if(!object(value.target))return fail('invalid_personal_source_ref');
    let target:{type:'report'}|{type:'attachment';attachmentIndex:number};
    if(value.target.type==='report'){keys(value.target,['type']);target={type:'report'};}
    else if(value.target.type==='attachment'){keys(value.target,['type','attachmentIndex']);target={type:'attachment',attachmentIndex:integer(value.target.attachmentIndex)};}
    else return fail('invalid_personal_source_ref');
    result={type:'citation',projectId:id(value.projectId),citationId:id(value.citationId),target};
  } else if(value.type==='native-reply') {
    keys(value,['type','projectId','taskId','sessionId','messageId','expectedTextSha256',...optional],['type','projectId','taskId','sessionId','messageId','expectedTextSha256']);
    const sessionId=text(value.sessionId,1000),messageId=text(value.messageId,1000);if(!sessionId||!messageId)return fail('invalid_personal_source_ref');
    result={type:'native-reply',projectId:id(value.projectId),taskId:id(value.taskId),sessionId,messageId,expectedTextSha256:hash(value.expectedTextSha256)};
  } else if(value.type==='feedback') {
    keys(value,['type','sourceProjectId','boardTaskId','feedbackRevisionId',...optional],['type','sourceProjectId','boardTaskId','feedbackRevisionId']);
    result={type:'feedback',sourceProjectId:id(value.sourceProjectId),boardTaskId:id(value.boardTaskId),feedbackRevisionId:id(value.feedbackRevisionId)};
  } else return fail('invalid_personal_source_ref');
  if(value.excerpt!==undefined){if(!object(value.excerpt))return fail('invalid_personal_excerpt');keys(value.excerpt,['start','end']);const start=integer(value.excerpt.start),end=integer(value.excerpt.end);if(end<=start)return fail('invalid_personal_excerpt');result.excerpt={start,end};}
  return result;
}
export function metadata(value:unknown,allowLearningSources=true):PersonalMetadata {
  if(!object(value))return fail('invalid_personal_metadata');keys(value,['kind','aliases','caution','sourceRefs']);
  if(value.kind!=='knowledge'&&value.kind!=='experience'||!Array.isArray(value.aliases)||value.aliases.length>20||!Array.isArray(value.sourceRefs))return fail('invalid_personal_metadata');
  const aliases=value.aliases.map(alias=>text(alias,100).trim());if(aliases.some(alias=>!alias)||new Set(aliases).size!==aliases.length)return fail('invalid_personal_aliases');
  const sourceRefs=value.sourceRefs.map(allowLearningSources?learningSourceRef:sourceRef);if(new Set(sourceRefs.map(canonical)).size!==sourceRefs.length)return fail('duplicate_personal_source');
  return {kind:value.kind,aliases,caution:value.caution===null?null:text(value.caution,2000),sourceRefs};
}
export function target(value:unknown):PersonalContentTarget {
  if(!object(value))return fail('invalid_personal_content_target');
  if(value.type==='revision'){keys(value,['type','revisionId','expectedBodySha256']);return {type:'revision',revisionId:id(value.revisionId),expectedBodySha256:hash(value.expectedBodySha256)};}
  if(value.type==='draft'){keys(value,['type','expectedMaterialVersion','expectedDraftSha256']);const expectedMaterialVersion=integer(value.expectedMaterialVersion);if(!expectedMaterialVersion)return fail('invalid_personal_content_target');return {type:'draft',expectedMaterialVersion,expectedDraftSha256:hash(value.expectedDraftSha256)};}
  return fail('invalid_personal_content_target');
}
export function retainInput(value:unknown,allowLearningSources=true):RetainPersonalInput {
  if(!object(value))return fail('invalid_personal_retain_request');keys(value,['operationId','expectedRevision','target','metadata','personalLabel']);
  return {operationId:id(value.operationId),expectedRevision:integer(value.expectedRevision),target:target(value.target),metadata:metadata(value.metadata,allowLearningSources),personalLabel:label(value.personalLabel)};
}
export function stateInput(value:unknown):PersonalStateInput {
  if(!object(value))return fail('invalid_personal_state_request');keys(value,['operationId','expectedRevision','personalLabel']);return {operationId:id(value.operationId),expectedRevision:integer(value.expectedRevision),personalLabel:label(value.personalLabel)};
}
export const fingerprint=(storeId:string,materialId:string,action:string,request:unknown):string=>digest(canonical({storeId,materialId,action,request}));

function savedDate(value:unknown):void {if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value)||!Number.isFinite(Date.parse(value)))fail('corrupt_personal_retention_records',503);}
function savedFailure(value:unknown):void {if(value===null)return;if(!object(value))return fail('corrupt_personal_retention_records',503);keys(value,['code','outcome','at']);text(value.code,200);if(value.outcome!=='FAIL'&&value.outcome!=='UNKNOWN')fail('corrupt_personal_retention_records',503);savedDate(value.at);}
function savedRef(value:unknown,storeId:string,materialId:string):void {if(!object(value))return fail('corrupt_personal_retention_records',503);keys(value,['storeId','materialId','revisionId']);if(value.storeId!==storeId||value.materialId!==materialId)fail('corrupt_personal_retention_records',503);id(value.revisionId);}
/** Decode every history identity before any mutation; a malformed ledger is never an empty library. */
export function records(value:unknown,storeId:string):import('./personal-retention-types.ts').PersonalRetentionRecords {
  try {
    if(!object(value))return fail('corrupt_personal_retention_records',503);keys(value,['schemaVersion','storeId','revision','items']);
    if(value.schemaVersion!==1&&value.schemaVersion!==2||value.storeId!==storeId||!Array.isArray(value.items))return fail('corrupt_personal_retention_records',503);id(value.storeId);integer(value.revision);
    const allowLearningSources=value.schemaVersion===2;
    const materialIds=new Set<string>(),operations=new Set<string>();let itemRevisions=0;
    for(const item of value.items){
      if(!object(item))return fail('corrupt_personal_retention_records',503);keys(item,['materialId','revision','draftMeta','currentDecisionId','archived','decisions','terminations','pending']);
      const materialId=id(item.materialId);if(materialIds.has(materialId))return fail('corrupt_personal_retention_records',503);materialIds.add(materialId);itemRevisions+=integer(item.revision);
      if(canonical(metadata(item.draftMeta,allowLearningSources))!==canonical(item.draftMeta)||typeof item.archived!=='boolean'||!Array.isArray(item.decisions)||!Array.isArray(item.terminations))return fail('corrupt_personal_retention_records',503);
      let current:Record<string,unknown>|null=null,archived=false;
      const claim=(operationId:unknown)=>{const operation=id(operationId);if(operations.has(operation))fail('corrupt_personal_retention_records',503);operations.add(operation);return operation;};
      for(const decision of item.decisions){
        if(!object(decision)||!['retain','archive','restore'].includes(decision.action as string))return fail('corrupt_personal_retention_records',503);
        keys(decision,['operationId','action','decidedAt','personalLabel','contentRef','bodySha256','metadata','requestFingerprint','request','failure']);const operationId=claim(decision.operationId),action=decision.action as string;
        savedDate(decision.decidedAt);label(decision.personalLabel);savedFailure(decision.failure);
        if(canonical(metadata(decision.metadata,allowLearningSources))!==canonical(decision.metadata))return fail('corrupt_personal_retention_records',503);
        const request=action==='retain'?retainInput(decision.request,allowLearningSources):stateInput(decision.request);
        if(canonical(request)!==canonical(decision.request)||request.operationId!==operationId||request.personalLabel!==decision.personalLabel||fingerprint(storeId,materialId,action,request)!==decision.requestFingerprint||request.expectedRevision>=(item.revision as number))return fail('corrupt_personal_retention_records',503);
        if(action==='retain'){
          const retain=request as RetainPersonalInput;savedRef(decision.contentRef,storeId,materialId);hash(decision.bodySha256);
          const targetId=retain.target.type==='draft'?operationId:retain.target.revisionId;
          if((decision.contentRef as Record<string,unknown>).revisionId!==targetId||canonical(retain.metadata)!==canonical(decision.metadata)||retain.target.type==='revision'&&retain.target.expectedBodySha256!==decision.bodySha256)return fail('corrupt_personal_retention_records',503);
          current=decision;
        } else {
          if(canonical(decision.contentRef)!==canonical(current?.contentRef??null)||decision.bodySha256!==(current?.bodySha256??null)||current&&canonical(decision.metadata)!==canonical(current.metadata))return fail('corrupt_personal_retention_records',503);
          archived=action==='archive';
        }
      }
      if(item.currentDecisionId!==(current?.operationId??null)||item.archived!==archived)return fail('corrupt_personal_retention_records',503);
      for(const receipt of item.terminations){
        if(!object(receipt))return fail('corrupt_personal_retention_records',503);keys(receipt,['operationId','action','endedAt','requestFingerprint','request','failure','contentRef','outcome']);const operationId=claim(receipt.operationId),request=retainInput(receipt.request,allowLearningSources);
        if(receipt.action!=='end-pending'||receipt.outcome!=='ended-unpublished'||request.operationId!==operationId||canonical(request)!==canonical(receipt.request)||request.expectedRevision>=(item.revision as number)||receipt.requestFingerprint!==fingerprint(storeId,materialId,'retain',request))return fail('corrupt_personal_retention_records',503);
        savedDate(receipt.endedAt);savedFailure(receipt.failure);
        if(receipt.contentRef!==null){savedRef(receipt.contentRef,storeId,materialId);if((receipt.contentRef as Record<string,unknown>).revisionId!==(request.target.type==='draft'?operationId:request.target.revisionId))return fail('corrupt_personal_retention_records',503);}
      }
      if(item.pending!==null){
        const pending=item.pending;if(!object(pending))return fail('corrupt_personal_retention_records',503);keys(pending,['operationId','requestFingerprint','request','targetRevisionId','createdAt','failure']);const operationId=claim(pending.operationId),request=retainInput(pending.request,allowLearningSources);
        if(request.operationId!==operationId||canonical(request)!==canonical(pending.request)||request.expectedRevision!==item.revision||pending.requestFingerprint!==fingerprint(storeId,materialId,'retain',request)||pending.targetRevisionId!==(request.target.type==='draft'?operationId:request.target.revisionId))return fail('corrupt_personal_retention_records',503);
        savedDate(pending.createdAt);savedFailure(pending.failure);
      }
    }
    if(itemRevisions>(value.revision as number))return fail('corrupt_personal_retention_records',503);
    return value as unknown as import('./personal-retention-types.ts').PersonalRetentionRecords;
  } catch { return fail('corrupt_personal_retention_records',503); }
}
