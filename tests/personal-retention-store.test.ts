import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EnterpriseMaterialsStore, enterpriseDraftSha256 } from '../src/host/enterprise-materials-store.ts';
import { PersonalRetentionStore } from '../src/host/personal-retention-store.ts';
import { createPersonalSourceReader } from '../src/host/personal-retention-sources.ts';
import type { PersonalMetadata, RetainPersonalInput } from '../src/host/personal-retention-types.ts';
const evidence=path.resolve('.local/fourbase-modules/m3/implementation/store/roots');
const meta:PersonalMetadata={kind:'knowledge',aliases:['合成'],caution:null,sourceRefs:[]};
async function fixture(){await fs.mkdir(evidence,{recursive:true});const root=await fs.mkdtemp(path.join(evidence,'personal-')),materials=new EnterpriseMaterialsStore(root);const created=await materials.create({title:'Synthetic original',body:'Saved original'});const options={dataRoot:root,materials,readSource:async()=>{throw new Error('unexpected_source');}};return {root,materials,created,options,store:new PersonalRetentionStore(options)};}
test('PR03 saving personal draft metadata survives reopen without retaining or enabling the material',async()=>{
  const {materials,created,options,store}=await fixture();assert.equal((await store.getRecords()).items.length,0);
  const saved=await store.saveDraftMeta(created.material.id,{expectedRevision:0,metadata:meta});
  assert.equal(saved.revision,1);assert.equal(saved.currentDecisionId,null);assert.equal(saved.pending,null);
  assert.deepEqual((await new PersonalRetentionStore(options).getItem(created.material.id))?.draftMeta,meta);
  assert.equal((await materials.get(created.material.id)).material.enabled,false);
  await assert.rejects(store.saveDraftMeta(created.material.id,{expectedRevision:0,metadata:meta}),/personal_revision_conflict/);
});
function request(created:Awaited<ReturnType<typeof fixture>>['created'],expectedRevision=0):RetainPersonalInput{return {operationId:randomUUID(),expectedRevision,target:{type:'draft',expectedMaterialVersion:created.material.version,expectedDraftSha256:enterpriseDraftSha256(created.material.draft)},metadata:meta,personalLabel:null};}
test('PR03/04 explicit retention publishes an exact snapshot; editing metadata keeps the previous retained content and full-request replay identity',async()=>{
  const {materials,created,options,store}=await fixture(),input=request(created);
  const first=await store.retain(created.material.id,input);assert.equal(first.replayed,false);assert.equal(first.decision?.action,'retain');
  assert.equal((await store.readItem(created.material.id)).content?.body,'Saved original');
  const frozen=await materials.get(created.material.id);assert.equal(frozen.material.enabled,false);assert.equal(frozen.material.activeRevisionId,null);
  const changed=await materials.update(created.material.id,frozen.material.version,{body:'New unretained draft'});
  await store.saveDraftMeta(created.material.id,{expectedRevision:first.item.revision,metadata:{...meta,kind:'experience',aliases:['新版']}});
  const read=await new PersonalRetentionStore(options).readItem(created.material.id);assert.equal(read.content?.body,'Saved original');assert.equal(read.decision?.metadata.kind,'knowledge');assert.equal(read.item.draftMeta.kind,'experience');
  const replay=await store.retain(created.material.id,input);assert.equal(replay.replayed,true);assert.equal(replay.decision?.operationId,input.operationId);
  await assert.rejects(store.retain(created.material.id,{...input,metadata:{...meta,kind:'experience'}}),/personal_operation_conflict/);
  assert.equal((await materials.get(created.material.id)).material.version,changed.material.version);
});
test('PR08 interrupted freeze keeps UNKNOWN and local intent; explicit identical retry after reopen publishes the old target despite a new draft',async()=>{
  const {created,options,materials}=await fixture(),input=request(created);let once=true;
  const store=new PersonalRetentionStore({...options,fault:point=>{if(once&&point==='after-freeze'){once=false;throw new Error('synthetic_power_loss');}}});
  await assert.rejects(store.retain(created.material.id,input),/synthetic_power_loss/);
  const pending=await store.getItem(created.material.id);assert.equal(pending?.currentDecisionId,null);assert.equal(pending?.pending?.failure?.outcome,'UNKNOWN');
  await assert.rejects(store.saveDraftMeta(created.material.id,{expectedRevision:0,metadata:meta}),/personal_pending_conflict/);
  await assert.rejects(store.retain(created.material.id,{...input,metadata:{...meta,caution:'different request'}}),/personal_operation_conflict/);
  const other=await materials.create({title:'Other synthetic item',body:'Other'});assert.equal((await store.saveDraftMeta(other.material.id,{expectedRevision:0,metadata:meta})).revision,1);
  const frozen=await materials.get(created.material.id);await materials.update(created.material.id,frozen.material.version,{body:'New draft after failure'});
  const reopened=new PersonalRetentionStore(options),saved=await reopened.retain(created.material.id,input);
  assert.equal(saved.decision?.operationId,input.operationId);assert.equal((await reopened.readItem(created.material.id)).content?.body,'Saved original');
  assert.equal((await materials.get(created.material.id)).material.revisions.length,1);
});
test('PR04 archive and restore only change personal discovery; history and the old retained pointer survive new drafts',async()=>{
  const {created,store,materials}=await fixture(),retained=await store.retain(created.material.id,request(created)),current=retained.item.currentDecisionId;
  const changed=await materials.get(created.material.id);await materials.update(created.material.id,changed.material.version,{body:'Unretained changed draft'});
  const archive={operationId:randomUUID(),expectedRevision:retained.item.revision,personalLabel:'User'};
  const archived=await store.archive(created.material.id,archive);assert.equal(archived.item.archived,true);assert.equal(archived.item.currentDecisionId,current);
  assert.equal((await store.archive(created.material.id,archive)).replayed,true);
  const restored=await store.restore(created.material.id,{operationId:randomUUID(),expectedRevision:archived.item.revision,personalLabel:null});assert.equal(restored.item.archived,false);assert.equal(restored.item.currentDecisionId,current);
  assert.equal((await store.readItem(created.material.id)).content?.body,'Saved original');assert.equal((await materials.get(created.material.id)).material.enabled,false);
  assert.equal((await store.readItem(created.material.id,archive.operationId)).content?.body,'Saved original');
});
test('PR08 explicit end preserves failed intent and frozen evidence, releases this item, and permanently prevents revival of the old operation',async()=>{
  const {created,materials,options}=await fixture();const store=new PersonalRetentionStore(options),first=await store.retain(created.material.id,request(created));
  const frozen=await materials.get(created.material.id),changed=await materials.update(created.material.id,frozen.material.version,{body:'Second saved draft'}),second=request(changed,first.item.revision);
  const interrupted=new PersonalRetentionStore({...options,fault:point=>{if(point==='after-freeze')throw new Error('synthetic_freeze_ack_lost');}});
  await assert.rejects(interrupted.retain(created.material.id,second),/synthetic_freeze_ack_lost/);
  const ended=await store.endPending(created.material.id,second.operationId);assert.equal(ended.termination?.outcome,'ended-unpublished');assert.equal(ended.termination?.contentRef?.revisionId,second.operationId);assert.equal(ended.termination?.failure?.code,'synthetic_freeze_ack_lost');
  assert.equal(ended.item.currentDecisionId,first.item.currentDecisionId);assert.equal(ended.item.pending,null);
  assert.equal((await new PersonalRetentionStore(options).retain(created.material.id,second)).termination?.operationId,second.operationId);
  assert.equal((await materials.readRevision(created.material.id,second.operationId)).body,'Second saved draft');
  const third={...second,operationId:randomUUID(),expectedRevision:ended.item.revision,target:{type:'revision' as const,revisionId:second.operationId,expectedBodySha256:(await materials.readRevision(created.material.id,second.operationId)).bodySha256}};
  const success=await store.retain(created.material.id,third);assert.equal(success.item.currentDecisionId,third.operationId);assert.equal(success.item.terminations.length,1);
  const endSuccessful=await store.endPending(created.material.id,third.operationId);assert.equal(endSuccessful.decision?.operationId,third.operationId);assert.equal(endSuccessful.termination,null);
});
test('PR08 damaged personal decision identity is rejected without resetting the file or moving its old pointer',async()=>{
  const {root,created,store,options}=await fixture();await store.retain(created.material.id,request(created));const file=path.join(root,'personal-retention','records.json');
  const stored=JSON.parse(await fs.readFile(file,'utf8'));stored.items[0].decisions[0].request.metadata.kind='experience';const damaged=JSON.stringify(stored);await fs.writeFile(file,damaged);
  await assert.rejects(new PersonalRetentionStore(options).getRecords(),/corrupt_personal_retention_records/);
  assert.equal(await fs.readFile(file,'utf8'),damaged);
});
test('PR08 ending a cached request before its intent arrives records UNKNOWN and permanently blocks its late original POST',async()=>{
  const {created,materials,store,options}=await fixture();const draft=await store.saveDraftMeta(created.material.id,{expectedRevision:0,metadata:meta}),input=request(created,draft.revision);
  const ended=await store.endPending(created.material.id,input.operationId,input);assert.equal(ended.termination?.outcome,'ended-unpublished');assert.equal(ended.termination?.failure?.outcome,'UNKNOWN');assert.equal(ended.item.currentDecisionId,null);
  const late=await new PersonalRetentionStore(options).retain(created.material.id,input);assert.equal(late.replayed,true);assert.equal(late.decision,null);assert.equal(late.termination?.operationId,input.operationId);assert.equal((await materials.get(created.material.id)).material.revisions.length,0);
  await assert.rejects(store.retain(created.material.id,{...input,metadata:{...meta,kind:'experience'}}),/personal_operation_conflict/);
});
test('PR08 short file writes and per-item in-flight checks permit another item while protecting end/save on this active operation',async()=>{
  const {created,materials,options}=await fixture();let entered!:()=>void,release!:()=>void;const admitted=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
  const store=new PersonalRetentionStore({...options,fault:async point=>{if(point==='after-intent'){entered();await held;}}}),input=request(created),running=store.retain(created.material.id,input);await admitted;
  const second=new PersonalRetentionStore(options);
  await assert.rejects(second.endPending(created.material.id,input.operationId,input),/personal_item_in_flight/);
  await assert.rejects(second.saveDraftMeta(created.material.id,{expectedRevision:0,metadata:meta}),/personal_item_in_flight/);
  const other=await materials.create({title:'Concurrent other',body:'Other'});await second.saveDraftMeta(other.material.id,{expectedRevision:0,metadata:meta});
  assert.equal((await second.getItem(created.material.id))?.currentDecisionId,null);release();const saved=await running;assert.equal(saved.decision?.operationId,input.operationId);
  assert.equal((await second.endPending(created.material.id,input.operationId)).decision?.operationId,input.operationId);
});
test('PR08 an interrupted intent cannot freeze a changed draft and explicit ending preserves the original UNKNOWN before a corrected new request',async()=>{
  const {created,materials,options}=await fixture(),input=request(created);const interrupted=new PersonalRetentionStore({...options,fault:point=>{if(point==='after-intent')throw new Error('synthetic_before_freeze');}});
  await assert.rejects(interrupted.retain(created.material.id,input),/synthetic_before_freeze/);assert.equal((await materials.referenceIndex()).materials[0].revisions.length,0);
  const changed=await materials.update(created.material.id,created.material.version,{body:'Changed after interrupted intent'}),store=new PersonalRetentionStore(options);
  await assert.rejects(store.retain(created.material.id,input),/enterprise_version_conflict/);assert.equal((await store.getItem(created.material.id))?.pending?.failure?.code,'synthetic_before_freeze');
  const ended=await store.endPending(created.material.id,input.operationId);assert.equal(ended.termination?.contentRef,null);assert.equal(ended.termination?.failure?.outcome,'UNKNOWN');
  const corrected=request(changed,ended.item.revision),saved=await store.retain(created.material.id,corrected);assert.equal(saved.decision?.operationId,corrected.operationId);assert.equal((await store.readItem(created.material.id)).content?.body,'Changed after interrupted intent');
});
test('PR04 two independent retention decisions can select one exact old revision without freezing the current new draft',async()=>{
  const {created,materials,store}=await fixture(),first=await store.retain(created.material.id,request(created));const current=await materials.get(created.material.id);await materials.update(created.material.id,current.material.version,{body:'New draft excluded'});
  const old=await materials.readRevision(created.material.id,first.decision!.contentRef!.revisionId),input:RetainPersonalInput={operationId:randomUUID(),expectedRevision:first.item.revision,target:{type:'revision',revisionId:old.revisionId,expectedBodySha256:old.bodySha256},metadata:{...meta,kind:'experience',caution:'Different human decision'},personalLabel:null};
  const second=await store.retain(created.material.id,input);assert.equal(second.item.decisions.length,2);assert.equal(second.decision?.contentRef?.revisionId,old.revisionId);assert.equal((await store.readItem(created.material.id,first.decision!.operationId)).decision?.metadata.kind,'knowledge');assert.equal((await materials.referenceIndex()).materials[0].revisions.length,1);
});
test('PR08 failure immediately before personal publication leaves frozen content unpublished until explicit readback and continuation',async()=>{
  const {created,options,materials}=await fixture(),input=request(created),store=new PersonalRetentionStore({...options,fault:point=>{if(point==='before-publish')throw new Error('synthetic_publish_not_acknowledged');}});
  await assert.rejects(store.retain(created.material.id,input),/synthetic_publish_not_acknowledged/);assert.equal((await store.getItem(created.material.id))?.currentDecisionId,null);assert.equal((await materials.readRevision(created.material.id,input.operationId)).body,'Saved original');
  const reopened=new PersonalRetentionStore(options),result=await reopened.retain(created.material.id,input);assert.equal(result.decision?.failure?.code,'synthetic_publish_not_acknowledged');assert.equal(result.item.pending,null);
});
test('PR08 personal metadata capacity rejects an oversized update and preserves the prior readable ledger',async()=>{
  const {created,store,materials,root}=await fixture();
  const refs=Array.from({length:100},(_,index)=>({type:'native-reply' as const,projectId:randomUUID(),taskId:randomUUID(),sessionId:'s'.repeat(1000),messageId:String(index)+'m'.repeat(995),expectedTextSha256:'a'.repeat(64)}));
  const large={...meta,sourceRefs:refs};let last:Awaited<ReturnType<typeof store.saveDraftMeta>>|null=null;let before='';let rejected=false;
  for(let index=0;index<14;index++){
    const material=index===0?created:await materials.create({title:'Synthetic capacity '+index,body:'Body'});
    try{before=(await fs.readFile(path.join(root,'personal-retention','records.json'),'utf8').catch(()=>''));last=await store.saveDraftMeta(material.material.id,{expectedRevision:0,metadata:large});}
    catch(error){assert.match(String(error),/data_context_metadata_too_large/);rejected=true;assert.equal(await fs.readFile(path.join(root,'personal-retention','records.json'),'utf8'),before);break;}
  }
  assert.equal(rejected,true);assert.ok(last);assert.ok((await store.getRecords()).items.length>0);
});
test('PR08 unsafe personal paths and linked record files are rejected without following or overwriting them',async()=>{
  const first=await fixture();await first.store.saveDraftMeta(first.created.material.id,{expectedRevision:0,metadata:meta});
  const file=path.join(first.root,'personal-retention','records.json'),outside=path.join(first.root,'linked-record.json');await fs.link(file,outside);const bytes=await fs.readFile(outside);
  await assert.rejects(first.store.getRecords(),/unsafe_data_context_file/);await assert.rejects(first.store.saveDraftMeta(first.created.material.id,{expectedRevision:1,metadata:meta}),/unsafe_data_context_file/);assert.deepEqual(await fs.readFile(outside),bytes);
  const second=await fixture(),target=path.join(second.root,'outside-personal');await fs.mkdir(target);await fs.symlink(target,path.join(second.root,'personal-retention'));
  await assert.rejects(second.store.getRecords(),/unsafe_data_context_path/);assert.deepEqual(await fs.readdir(target),[]);
});
test('PR05 disabled exact sources remain bindable; later corrupt source blocks new binding while retained personal content remains independently readable',async()=>{
  const {created,materials,options}=await fixture(),source=await materials.create({title:'Source',body:'Exact source text'}),enabled=await materials.enable(source.material.id,source.material.version);await materials.disable(source.material.id,enabled.material.version);
  const unreachable=()=>{throw new Error('unexpected_domain_access');},reader=createPersonalSourceReader({enterprise:materials,projects:{get:async()=>unreachable(),getTask:async()=>unreachable()},dataContext:{readCitationEvidence:async()=>unreachable()},board:{getTask:unreachable,getItem:unreachable,getFeedbackRevision:unreachable}});
  const sourceRef={type:'enterprise' as const,storeId:enabled.storeId,materialId:source.material.id,revisionId:enabled.material.activeRevisionId!,excerpt:{start:0,end:5}};assert.equal((await reader(sourceRef)).status,'disabled');
  const store=new PersonalRetentionStore({...options,readSource:reader}),input={...request(created),metadata:{...meta,sourceRefs:[sourceRef]}};const saved=await store.retain(created.material.id,input);
  const originalSource=await materials.readRevision(source.material.id,sourceRef.revisionId);await fs.writeFile(originalSource.bodyPath,'Damaged source text');
  const exact=await store.readItem(created.material.id);assert.equal(exact.content?.body,'Saved original');assert.deepEqual(exact.decision?.metadata.sourceRefs,[sourceRef]);
  const replacement={...input,operationId:randomUUID(),expectedRevision:saved.item.revision,target:{type:'revision' as const,revisionId:saved.decision!.contentRef!.revisionId,expectedBodySha256:saved.decision!.bodySha256!}};
  await assert.rejects(store.retain(created.material.id,replacement),/enterprise_source_changed/);assert.equal((await store.getItem(created.material.id))?.currentDecisionId,saved.decision!.operationId);assert.equal((await store.getItem(created.material.id))?.pending,null);
});
test('PR08 strict request validation rejects unknown fields and preserves incomplete personal drafts without inventing a source',async()=>{
  const {created,store}=await fixture(),input=request(created);
  await assert.rejects(store.retain(created.material.id,{...input,unexpectedPath:'/tmp/arbitrary'} as RetainPersonalInput),/invalid_personal_retention_fields/);
  await assert.rejects(store.saveDraftMeta(created.material.id,{expectedRevision:0,metadata:{...meta,aliases:['x'.repeat(101)]}}),/invalid_personal_retention_text/);
  await assert.rejects(store.saveDraftMeta(created.material.id,{expectedRevision:0,metadata:{...meta,sourceRefs:[{type:'citation',projectId:randomUUID(),citationId:randomUUID(),target:{type:'report'},path:'/tmp/arbitrary'} as never]}}),/invalid_personal_retention_fields/);
  assert.equal((await store.getRecords()).items.length,0);
  const draft=await store.saveDraftMeta(created.material.id,{expectedRevision:0,metadata:meta});assert.equal(draft.currentDecisionId,null);assert.deepEqual(draft.draftMeta.sourceRefs,[]);
});
test('PR03 source lists within the approved file budget are preserved without an unapproved source-count limit',async()=>{
  const {created,store}=await fixture();const sourceRefs=Array.from({length:101},()=>({type:'enterprise' as const,storeId:randomUUID(),materialId:randomUUID(),revisionId:randomUUID()}));
  const saved=await store.saveDraftMeta(created.material.id,{expectedRevision:0,metadata:{...meta,sourceRefs}});assert.equal(saved.draftMeta.sourceRefs.length,101);
});
test('PR08 a missing records file inside an established personal root fails closed and never recreates lost history',async()=>{
  const {root,created,store,options,materials}=await fixture();assert.deepEqual((await store.getRecords()).items,[]);
  const draft=await store.saveDraftMeta(created.material.id,{expectedRevision:0,metadata:meta}),input=request(created,draft.revision),retained=await store.retain(created.material.id,input);
  const file=path.join(root,'personal-retention','records.json'),original=await fs.readFile(file);await fs.writeFile(path.join(root,'removed-records.synthetic-evidence.json'),original);await fs.unlink(file);
  const reopened=new PersonalRetentionStore(options);await assert.rejects(reopened.getRecords(),/personal_records_missing/);
  await assert.rejects(reopened.saveDraftMeta(created.material.id,{expectedRevision:0,metadata:meta}),/personal_records_missing/);
  await assert.rejects(reopened.retain(created.material.id,input),/personal_records_missing/);
  await assert.rejects(fs.lstat(file),{code:'ENOENT'});assert.equal((await materials.readRevision(created.material.id,retained.decision!.contentRef!.revisionId)).body,'Saved original');
});
test('PR08 ending an unobserved first retain registers only its UNKNOWN termination and prevents the late original POST from publishing',async()=>{
  const {created,store,options,materials}=await fixture(),input=request(created);assert.equal(await store.getItem(created.material.id),null);
  const ended=await store.endPending(created.material.id,input.operationId,input);
  assert.equal(ended.item.revision,1);assert.deepEqual(ended.item.draftMeta,input.metadata);assert.equal(ended.item.currentDecisionId,null);assert.equal(ended.item.pending,null);assert.equal(ended.item.decisions.length,0);assert.equal(ended.item.terminations.length,1);assert.equal(ended.termination?.failure?.outcome,'UNKNOWN');assert.equal(ended.termination?.contentRef,null);
  const reopened=new PersonalRetentionStore(options),late=await reopened.retain(created.material.id,input);assert.equal(late.replayed,true);assert.equal(late.decision,null);assert.equal(late.termination?.operationId,input.operationId);
  assert.equal((await materials.referenceIndex()).materials[0].revisions.length,0);assert.equal((await materials.get(created.material.id)).material.enabled,false);
});
test('PR08 first-retain termination requires a real material and revision zero while preserving unrelated entries and unreadable bodies',async()=>{
  const {created,store,materials}=await fixture(),input=request(created);
  await assert.rejects(store.endPending(created.material.id,input.operationId),/personal_item_not_found/);
  await assert.rejects(store.endPending(created.material.id,input.operationId,{...input,expectedRevision:1}),/personal_revision_conflict/);
  await assert.rejects(store.endPending(randomUUID(),input.operationId,input),/personal_material_not_found/);assert.equal((await store.getRecords()).items.length,0);
  const other=await materials.create({title:'Unrelated synthetic',body:'Unrelated body'}),saved=await store.saveDraftMeta(other.material.id,{expectedRevision:0,metadata:{...meta,aliases:['Other saved entry']}}),frozen=await materials.freezeExact(other.material.id,other.material.version,randomUUID(),enterpriseDraftSha256(other.material.draft));await fs.writeFile(frozen.bodyPath,'Corrupted unrelated body');
  const ended=await store.endPending(created.material.id,input.operationId,input);assert.equal(ended.termination?.failure?.outcome,'UNKNOWN');assert.deepEqual(await store.getItem(other.material.id),saved);assert.equal((await store.getRecords()).items.length,2);assert.equal((await materials.referenceIndex()).materials.find(material=>material.materialId===created.material.id)?.revisions.length,0);
});

test('PR08 a known first-write capacity refusal leaves a genuinely empty personal library usable after correcting the input', async () => {
  const { root, created, store } = await fixture();
  const sourceRefs = Array.from({ length: 935 }, (_, index) => ({ type: 'native-reply' as const, projectId: randomUUID(), taskId: randomUUID(), sessionId: 's'.repeat(1000), messageId: String(index).padStart(4, '0') + 'm'.repeat(996), expectedTextSha256: 'a'.repeat(64) }));
  const input = { expectedRevision: 0, metadata: { ...meta, aliases: [], caution: 'c'.repeat(1690), sourceRefs } };
  assert.ok(Buffer.byteLength(JSON.stringify(input)) < 2 * 1024 * 1024, 'the request fits transport but its ledger wrapping exceeds the approved file budget');
  await assert.rejects(store.saveDraftMeta(created.material.id, input), /metadata_too_large/);
  await assert.rejects(fs.lstat(path.join(root, 'personal-retention')), { code: 'ENOENT' });
  assert.deepEqual((await store.getRecords()).items, []);
  const saved = await store.saveDraftMeta(created.material.id, { expectedRevision: 0, metadata: meta });
  assert.equal(saved.revision, 1); assert.equal(saved.currentDecisionId, null);
});
