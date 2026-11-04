import path from 'node:path';
import { enterpriseDraftSha256, type EnterpriseMaterialsStore } from './enterprise-materials-store.ts';
import type { PersonalRetentionRecords, PersonalItem, PersonalMetadata, ReadPersonalSource, SavePersonalDraftInput, RetainPersonalInput, PersonalWriteResult, PersonalStateInput, PersonalItemRead, PersonalRetentionFailurePoint } from './personal-retention-types.ts';
import { atomicJson, jsonBytes, exists, safePath, directory, readBytes, parse, object } from './project-data-context-io.ts';
import { fail, id, integer, metadata, keys, retainInput, stateInput, fingerprint, records as decodeRecords } from './personal-retention-validation.ts';
import { isLearningSourceRef } from './learning-source-validation.ts';
import { canonical } from './project-data-context-io.ts';
export { PersonalRetentionFault } from './personal-retention-validation.ts';
const fileGates=new Map<string,Promise<void>>();
const inFlight=new Map<string,Set<string>>();
const clone=<T>(value:T):T=>structuredClone(value);
export class PersonalRetentionStore {
  readonly options:{dataRoot:string;materials:EnterpriseMaterialsStore;readSource:ReadPersonalSource;allowNewLearningSources?:boolean;fault?:(point:PersonalRetentionFailurePoint)=>void|Promise<void>};
  constructor(options:PersonalRetentionStore['options']) {if(path.resolve(options.dataRoot)!==options.materials.dataRoot)fail('personal_retention_root_mismatch');this.options=options;}
  async #file<T>(work:()=>Promise<T>):Promise<T>{const key=path.resolve(this.options.dataRoot),before=fileGates.get(key)??Promise.resolve();let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});fileGates.set(key,held);await before;try{return await work();}finally{release();if(fileGates.get(key)===held)fileGates.delete(key);}}
  async #item<T>(materialId:string,work:()=>Promise<T>):Promise<T>{const root=path.resolve(this.options.dataRoot),items=inFlight.get(root)??new Set<string>();if(items.has(materialId))return fail('personal_item_in_flight',409);inFlight.set(root,items);items.add(materialId);try{return await work();}finally{items.delete(materialId);if(!items.size)inFlight.delete(root);}}
  async getRecords():Promise<PersonalRetentionRecords>{
    const refs=await this.options.materials.referenceIndex(),root=path.join(this.options.dataRoot,'personal-retention');
    if(!await exists(root))return {schemaVersion:1,storeId:refs.storeId,revision:0,items:[]};
    await directory(root);const file=await safePath(root,'records.json');
    if(!await exists(file))return fail('personal_records_missing',503);
    return decodeRecords(parse(await readBytes(file,2*1024*1024)),refs.storeId);
  }
  async #save(records:PersonalRetentionRecords):Promise<void>{
    if(records.items.some(item=>this.#metadataHistory(item).some(meta=>meta.sourceRefs.some(isLearningSourceRef))))records.schemaVersion=2;
    records.revision++;
    // A known budget refusal must not create an empty root that looks like lost
    // history on the next read. atomicJson repeats this check at publication.
    if(jsonBytes(records).length>2*1024*1024)fail('data_context_metadata_too_large',413);
    const file=await safePath(this.options.dataRoot,'personal-retention/records.json',true);await atomicJson(file,records);
  }
  #newItem(materialId:string,draftMeta:PersonalMetadata):PersonalItem{return {materialId,revision:0,draftMeta,currentDecisionId:null,archived:false,decisions:[],terminations:[],pending:null};}
  #metadataHistory(item:PersonalItem):PersonalMetadata[]{return [item.draftMeta,...item.decisions.map(value=>value.metadata),...item.decisions.flatMap(value=>'metadata' in value.request?[value.request.metadata]:[]),...item.terminations.map(value=>value.request.metadata),...(item.pending?[item.pending.request.metadata]:[])];}
  #checkLearningSources(meta:PersonalMetadata,prior:PersonalItem|undefined):void{
    if(this.options.allowNewLearningSources!==false)return;
    const known=new Set((prior?this.#metadataHistory(prior):[]).flatMap(value=>value.sourceRefs.filter(isLearningSourceRef).map(canonical)));
    if(meta.sourceRefs.some(ref=>isLearningSourceRef(ref)&&!known.has(canonical(ref))))fail('learning_sources_disabled',409);
  }
  async getItem(materialId:string):Promise<PersonalItem|null>{return (await this.getRecords()).items.find(item=>item.materialId===id(materialId))??null;}
  async saveDraftMeta(materialId:string,input:SavePersonalDraftInput):Promise<PersonalItem>{
    id(materialId);if(!object(input))return fail('invalid_personal_draft_request');keys(input,['expectedRevision','metadata']);const expectedRevision=integer(input.expectedRevision),draftMeta=metadata(input.metadata);
    return this.#item(materialId,()=>this.#file(async()=>{await this.options.materials.get(materialId);const records=await this.getRecords(),prior=records.items.find(item=>item.materialId===materialId);this.#checkLearningSources(draftMeta,prior);const item=prior??this.#newItem(materialId,draftMeta);
      if(item.pending)return fail('personal_pending_conflict',409);if(item.revision!==expectedRevision)return fail('personal_revision_conflict',409);
      if(!records.items.includes(item))records.items.push(item);item.draftMeta=draftMeta;item.revision++;await this.#save(records);return clone(item);}));
  }
  #operation(records:PersonalRetentionRecords,materialId:string,operationId:string,requestFingerprint:string):PersonalWriteResult|null{
    for(const item of records.items){
      const decision=item.decisions.find(decision=>decision.operationId===operationId),termination=item.terminations.find(receipt=>receipt.operationId===operationId),pending=item.pending?.operationId===operationId?item.pending:null;
      if(!decision&&!termination&&!pending)continue;
      if(item.materialId!==materialId||(decision??termination??pending)!.requestFingerprint!==requestFingerprint)return fail('personal_operation_conflict',409);
      return decision||termination?{item:clone(item),decision:decision?clone(decision):null,termination:termination?clone(termination):null,replayed:true}:null;
    }return null;
  }
  async retain(materialId:string,value:RetainPersonalInput):Promise<PersonalWriteResult>{
    id(materialId);const input=retainInput(value);
    return this.#item(materialId,async()=>{
      let attemptedFingerprint:string|null=null;
      try {
      const original=await this.getRecords(),requestFingerprint=fingerprint(original.storeId,materialId,'retain',input);attemptedFingerprint=requestFingerprint;const replay=this.#operation(original,materialId,input.operationId,requestFingerprint);if(replay)return replay;
      const prior=original.items.find(item=>item.materialId===materialId);
      this.#checkLearningSources(input.metadata,prior);
      if(prior?.pending&&(prior.pending.operationId!==input.operationId||prior.pending.requestFingerprint!==requestFingerprint))return fail('personal_pending_conflict',409);
      if(!prior?.pending){
        if((prior?.revision??0)!==input.expectedRevision)return fail('personal_revision_conflict',409);
        if(input.target.type==='draft'){const saved=await this.options.materials.get(materialId);if(saved.material.version!==input.target.expectedMaterialVersion||enterpriseDraftSha256(saved.material.draft)!==input.target.expectedDraftSha256)return fail('personal_content_conflict',409);}
        else {const content=await this.options.materials.readRevision(materialId,input.target.revisionId);if(content.bodySha256!==input.target.expectedBodySha256)return fail('personal_content_conflict',409);}
      }
      for(const ref of input.metadata.sourceRefs)await this.options.readSource(ref);
      if(!prior?.pending)await this.#file(async()=>{
        const records=await this.getRecords();const duplicate=this.#operation(records,materialId,input.operationId,requestFingerprint);if(duplicate)return fail('personal_operation_conflict',409);
        const item=records.items.find(item=>item.materialId===materialId)??this.#newItem(materialId,input.metadata);
        if(item.pending)return fail('personal_pending_conflict',409);if(item.revision!==input.expectedRevision)return fail('personal_revision_conflict',409);
        if(!records.items.includes(item))records.items.push(item);
        item.pending={operationId:input.operationId,requestFingerprint,request:input,targetRevisionId:input.target.type==='draft'?input.operationId:input.target.revisionId,createdAt:new Date().toISOString(),failure:null};await this.#save(records);
      });
      await this.options.fault?.('after-intent');
      const content=input.target.type==='draft'?await this.options.materials.freezeExact(materialId,input.target.expectedMaterialVersion,input.operationId,input.target.expectedDraftSha256):await this.options.materials.readRevision(materialId,input.target.revisionId);
      await this.options.fault?.('after-freeze');
      if(input.target.type==='revision'&&content.bodySha256!==input.target.expectedBodySha256)return fail('personal_content_conflict',409);
      if(!content.body.trim()&&(!content.sourceFile||!content.sourceFile.bytes))return fail('personal_content_required');
      await this.options.fault?.('before-publish');
      return await this.#file(async()=>{
        const records=await this.getRecords(),replay=this.#operation(records,materialId,input.operationId,requestFingerprint);if(replay)return replay;
        const item=records.items.find(item=>item.materialId===materialId);if(!item||item.pending?.requestFingerprint!==requestFingerprint||item.pending.operationId!==input.operationId)return fail('personal_pending_conflict',409);
        if(item.revision!==input.expectedRevision)return fail('personal_revision_conflict',409);
        const decision={operationId:input.operationId,action:'retain' as const,decidedAt:new Date().toISOString(),personalLabel:input.personalLabel,contentRef:{storeId:records.storeId,materialId,revisionId:content.revisionId},bodySha256:content.bodySha256,metadata:clone(input.metadata),requestFingerprint,request:input,failure:clone(item.pending.failure)};
        item.decisions.push(decision);item.currentDecisionId=decision.operationId;item.pending=null;item.revision++;await this.#save(records);return {item:clone(item),decision:clone(decision),termination:null,replayed:false};
      });
      } catch(error) {
        // A failed acknowledgement cannot erase the persisted intent or the original failure.
        try { await this.#file(async()=>{const records=await this.getRecords(),item=records.items.find(item=>item.materialId===materialId);if(item?.pending?.operationId===input.operationId&&item.pending.requestFingerprint===attemptedFingerprint&&!item.pending.failure){const status=(error as {status?:number})?.status;item.pending.failure={code:(typeof (error as {code?:unknown})?.code==='string'?(error as {code:string}).code:String((error as Error)?.message??'personal_retention_unknown')).slice(0,200),outcome:status!==undefined&&status>=400&&status<500?'FAIL':'UNKNOWN',at:new Date().toISOString()};await this.#save(records);}}); } catch { /* The original error and authority stay available for explicit readback. */ }
        throw error;
      }
    });
  }
  async readItem(materialId:string,decisionId?:string):Promise<PersonalItemRead>{
    const item=await this.getItem(materialId);if(!item)return fail('personal_item_not_found',404);
    const selected=decisionId===undefined?item.currentDecisionId:id(decisionId),decision=selected===null?null:item.decisions.find(decision=>decision.operationId===selected)??fail('personal_decision_not_found',404);
    const content=decision?.contentRef?await this.options.materials.readRevision(materialId,decision.contentRef.revisionId):null;
    if(content&&content.bodySha256!==decision!.bodySha256)return fail('personal_content_conflict',409);return {item,decision,content};
  }
  async #state(materialId:string,value:PersonalStateInput,action:'archive'|'restore'):Promise<PersonalWriteResult>{
    id(materialId);const input=stateInput(value);return this.#item(materialId,()=>this.#file(async()=>{
      const records=await this.getRecords(),requestFingerprint=fingerprint(records.storeId,materialId,action,input),replay=this.#operation(records,materialId,input.operationId,requestFingerprint);if(replay)return replay;
      const item=records.items.find(item=>item.materialId===materialId);if(!item)return fail('personal_item_not_found',404);if(item.pending)return fail('personal_pending_conflict',409);if(item.revision!==input.expectedRevision)return fail('personal_revision_conflict',409);
      const current=item.decisions.find(decision=>decision.operationId===item.currentDecisionId),decision={operationId:input.operationId,action,decidedAt:new Date().toISOString(),personalLabel:input.personalLabel,contentRef:current?.contentRef??null,bodySha256:current?.bodySha256??null,metadata:clone(current?.metadata??item.draftMeta),requestFingerprint,request:input,failure:null};
      item.decisions.push(decision);item.archived=action==='archive';item.revision++;await this.#save(records);return {item:clone(item),decision:clone(decision),termination:null,replayed:false};
    }));
  }
  async archive(materialId:string,input:PersonalStateInput):Promise<PersonalWriteResult>{return this.#state(materialId,input,'archive');}
  async restore(materialId:string,input:PersonalStateInput):Promise<PersonalWriteResult>{return this.#state(materialId,input,'restore');}
  async endPending(materialId:string,operationId:string,originalRequest?:RetainPersonalInput):Promise<PersonalWriteResult>{
    id(materialId);id(operationId);const supplied=originalRequest===undefined?undefined:retainInput(originalRequest);if(supplied&&supplied.operationId!==operationId)return fail('personal_operation_conflict',409);
    return this.#item(materialId,()=>this.#file(async()=>{
      const records=await this.getRecords();let item=records.items.find(item=>item.materialId===materialId);
      if(supplied)this.#checkLearningSources(supplied.metadata,item);
      if(!item){
        if(!supplied)return fail('personal_item_not_found',404);
        if(supplied.expectedRevision!==0)return fail('personal_revision_conflict',409);
        const authority=await this.options.materials.referenceIndex();
        if(authority.storeId!==records.storeId)return fail('personal_content_conflict',409);
        if(!authority.materials.some(material=>material.materialId===materialId))return fail('personal_material_not_found',404);
        item=this.#newItem(materialId,clone(supplied.metadata));
      }
      const decision=item.decisions.find(decision=>decision.operationId===operationId),receipt=item.terminations.find(receipt=>receipt.operationId===operationId);
      const suppliedFingerprint=supplied?fingerprint(records.storeId,materialId,'retain',supplied):null;
      if(suppliedFingerprint)this.#operation(records,materialId,operationId,suppliedFingerprint);
      if(decision||receipt)return {item:clone(item),decision:decision?clone(decision):null,termination:receipt?clone(receipt):null,replayed:true};
      if(item.pending&&item.pending.operationId!==operationId)return fail('personal_pending_conflict',409);
      const pending=item.pending??(supplied?{operationId,requestFingerprint:suppliedFingerprint!,request:supplied,targetRevisionId:supplied.target.type==='draft'?operationId:supplied.target.revisionId,failure:{code:'personal_request_not_observed_unknown',outcome:'UNKNOWN' as const,at:new Date().toISOString()}}:null);
      if(!pending)return fail('personal_pending_not_found',404);
      if(!item.pending&&item.revision!==supplied!.expectedRevision)return fail('personal_revision_conflict',409);
      // Index metadata establishes whether a target was published by Enterprise, even when its bytes later became unavailable.
      const authority=await this.options.materials.referenceIndex();if(authority.storeId!==records.storeId)return fail('personal_content_conflict',409);
      const exists=authority.materials.find(material=>material.materialId===materialId)?.revisions.some(revision=>revision.revisionId===pending.targetRevisionId)??false;
      const termination={operationId,action:'end-pending' as const,endedAt:new Date().toISOString(),requestFingerprint:pending.requestFingerprint,request:clone(pending.request),failure:clone(pending.failure),contentRef:exists?{storeId:records.storeId,materialId,revisionId:pending.targetRevisionId}:null,outcome:'ended-unpublished' as const};
      if(!records.items.includes(item))records.items.push(item);
      item.terminations.push(termination);item.pending=null;item.revision++;await this.#save(records);return {item:clone(item),decision:null,termination:clone(termination),replayed:false};
    }));
  }
}
