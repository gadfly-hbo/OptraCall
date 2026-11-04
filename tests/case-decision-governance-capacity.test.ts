import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {CaseStore} from '../src/host/case-store.ts';
import type {CaseDecisionReference} from '../src/host/case-decision-types.ts';

test('M5 review F1: all 32 legal business references survive human archive/restore; Host lineage never expands Agent input authority',async t=>{
  const root=path.resolve('.local/fourbase-modules/m5/implementation/capacity',randomUUID());await fs.mkdir(root,{recursive:true});
  const store=new CaseStore({dataRoot:root});t.after(()=>store.close());await store.initialize();
  let c=store.createCase({operationId:randomUUID(),title:'32来源的合成判断'});const projectId=randomUUID();c=store.linkProject({operationId:randomUUID(),caseId:c.id,projectId,expectedRevision:c.revision}).case;
  const caseStoreId=store.getStatus().storeId!,origin={actorKind:'agent' as const,projectId,taskId:randomUUID(),requestId:randomUUID(),sessionId:'synthetic-only',toolCallId:'synthetic-only'};
  const references:CaseDecisionReference[]=Array.from({length:32},(_,i)=>({relation:'background',target:{type:'rap',instanceId:`req-source-${i}`,version:'1.0.0'},note:null}));
  const draft=store.saveDecisionDraft({operationId:randomUUID(),caseStoreId,caseId:c.id,expectedRevision:0,kind:'hypothesis',payload:{title:'待核解释',statement:'32个准确合成来源，仍未证实。'},references},origin);
  assert.equal(draft.references.length,32);
  const govern=(action:'archive'|'restore',expectedRevision:number)=>store.reviseDecisionByUser({operationId:randomUUID(),caseStoreId,caseId:c.id,recordId:draft.recordId,expectedRevision,action});
  const archived=govern('archive',1);assert.equal(archived.lifecycle,'archived');assert.deepEqual(archived.references.filter(r=>r.relation!=='derived_from'),references);
  const restored=govern('restore',2);assert.equal(restored.revision,3);assert.equal(restored.references.length,33);assert.deepEqual(store.getDecision(c.id,draft.recordId,1),draft);assert.deepEqual(store.getDecision(c.id,draft.recordId),restored);
  assert.equal(restored.references.filter(r=>r.relation==='derived_from').length,1);
  assert.throws(()=>store.saveDecisionDraft({operationId:randomUUID(),caseStoreId,caseId:c.id,recordId:draft.recordId,expectedRevision:3,kind:'hypothesis',payload:restored.payload,references:restored.references},origin),/case_decision_input_too_large/);
  assert.throws(()=>store.reviseDecisionByUser({operationId:randomUUID(),caseStoreId,caseId:c.id,recordId:draft.recordId,expectedRevision:3,action:'add_reference',reference:{relation:'background',target:{type:'rap',instanceId:'req-extra',version:'1.0.0'},note:null}}),/case_decision_input_too_large/);
});

test('M5 review F2: a request just below 256KiB remains exactly readable and governable after Host normalization',async t=>{
  const root=path.resolve('.local/fourbase-modules/m5/implementation/capacity',randomUUID());await fs.mkdir(root,{recursive:true});
  const store=new CaseStore({dataRoot:root});t.after(()=>store.close());await store.initialize();
  const record=store.createCase({operationId:randomUUID(),title:'合法请求容量边界'}),projectId=randomUUID();store.linkProject({operationId:randomUUID(),caseId:record.id,projectId,expectedRevision:record.revision});
  const caseStoreId=store.getStatus().storeId!,origin={actorKind:'agent' as const,projectId,taskId:randomUUID(),requestId:randomUUID(),sessionId:'synthetic',toolCallId:'synthetic'};
  const references:CaseDecisionReference[]=Array.from({length:32},(_,i)=>({relation:'background',target:{type:'rap',instanceId:`req-capacity-${i}`,version:'1.0.0'},note:'x'.repeat(7800)}));
  const input={operationId:randomUUID(),caseStoreId,caseId:record.id,expectedRevision:0,kind:'strategy' as const,payload:{title:'仍待核实',proposal:'合成容量资料不代表真实效果'},references};
  const padding=256*1024-1-Buffer.byteLength(JSON.stringify(input));assert.ok(padding>=0&&padding<12000);references[31].note+='x'.repeat(padding);assert.equal(Buffer.byteLength(JSON.stringify(input)),262143);
  const saved=store.saveDecisionDraft(input,origin);assert.deepEqual(store.getDecision(record.id,saved.recordId,1),saved,'successful accepted input must not become corrupt solely from Host defaults/record identity');
  const archived=store.reviseDecisionByUser({operationId:randomUUID(),caseStoreId,caseId:record.id,recordId:saved.recordId,expectedRevision:1,action:'archive'});assert.equal(archived.lifecycle,'archived');
  const restored=store.reviseDecisionByUser({operationId:randomUUID(),caseStoreId,caseId:record.id,recordId:saved.recordId,expectedRevision:2,action:'restore'});assert.deepEqual(store.getDecision(record.id,saved.recordId),restored);assert.deepEqual(restored.references.filter(r=>r.relation!=='derived_from'),saved.references);
  references[31].note+='xx';assert.throws(()=>store.saveDecisionDraft({...input,operationId:randomUUID()},origin),/case_decision_input_too_large/,'public input budget remains 256KiB');
  const removed=store.reviseDecisionByUser({operationId:randomUUID(),caseStoreId,caseId:record.id,recordId:saved.recordId,expectedRevision:3,action:'remove_reference',reference:saved.references[0]});
  const added=store.reviseDecisionByUser({operationId:randomUUID(),caseStoreId,caseId:record.id,recordId:saved.recordId,expectedRevision:removed.revision,action:'add_reference',reference:{relation:'background',target:{type:'rap',instanceId:'req-later-source',version:'1.0.0'},note:'y'.repeat(20000)}});
  assert.ok(Buffer.byteLength(JSON.stringify(added))>256*1024,'individually legal governance requests can accumulate more than one request envelope');
  assert.deepEqual(store.getDecision(record.id,saved.recordId),added);
  const laterArchive=store.reviseDecisionByUser({operationId:randomUUID(),caseStoreId,caseId:record.id,recordId:saved.recordId,expectedRevision:added.revision,action:'archive'});assert.equal(laterArchive.lifecycle,'archived');
  const laterRestore=store.reviseDecisionByUser({operationId:randomUUID(),caseStoreId,caseId:record.id,recordId:saved.recordId,expectedRevision:laterArchive.revision,action:'restore'});assert.deepEqual(store.getDecision(record.id,saved.recordId),laterRestore);
});
