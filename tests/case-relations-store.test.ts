import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CaseStore } from '../src/host/case-store.ts';
import type { CaseRelationWriteInput } from '../src/host/case-relation-types.ts';

const user={actorKind:'user' as const,projectId:null,taskId:null,requestId:null,sessionId:null,toolCallId:null};
const agent=()=>({actorKind:'agent' as const,projectId:randomUUID(),taskId:randomUUID(),requestId:randomUUID(),sessionId:'synthetic-native',toolCallId:'synthetic-call'});
function draft(store:CaseStore,input:Parameters<CaseStore['saveDecisionDraft']>[0]){const origin=agent();store.linkProject({operationId:randomUUID(),caseId:input.caseId,expectedRevision:store.getCase(input.caseId).revision,projectId:origin.projectId});return store.saveDecisionDraft(input,origin);}
async function fixture(t:{after:(fn:()=>void)=>void}){
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'case-relations-store-'));
 const store=new CaseStore({dataRoot:root});await store.initialize();t.after(()=>store.close());
 const a=store.createCase({operationId:randomUUID(),title:'来源Case'}),b=store.createCase({operationId:randomUUID(),title:'目标Case'}),c=store.createCase({operationId:randomUUID(),title:'另一个Case'});
 const input:CaseRelationWriteInput={operationId:randomUUID(),caseStoreId:store.getStatus().storeId!,fromCaseId:a.id,toCaseId:b.id,kind:'follows_up',expectedRelationRevision:0,explanation:'明确由前事项引出后续核对。'};
 return{root,store,a,b,c,input,file:path.join(root,'decision-cases.sqlite3')};
}
function sqlState(file:string){const db=new DatabaseSync(file,{readOnly:true});try{return{version:db.prepare('PRAGMA user_version').get()!.user_version,inventory:db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),rows:Object.fromEntries(['store_metadata','cases','case_project_links','project_work','case_artifact_links','operation_receipts','work_events',...(db.prepare("SELECT name FROM sqlite_master WHERE name='case_decision_revisions'").get()?['case_decision_revisions']:[])].map(name=>[name,db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()])),integrity:db.prepare('PRAGMA integrity_check').get()!.integrity_check,foreignKeys:db.prepare('PRAGMA foreign_key_check').all()};}finally{db.close();}}

test('CASE-REL-STORE-01: history appends correction/unlink/restore, preserves identities and rejects stale overwrites',async t=>{
 const{store,a,b,input}=await fixture(t);const before=[store.getCase(a.id),store.getCase(b.id)];
 const first=store.saveRelation(input,user);assert.equal(first.revision,1);
 const second=store.saveRelation({...input,operationId:randomUUID(),relationId:first.relationId,expectedRelationRevision:1,explanation:'新说明保留原稿。'},user);
 assert.equal(second.revision,2);assert.equal(second.relationId,first.relationId);assert.deepEqual(store.getRelation(first.relationId,1),first);
 assert.throws(()=>store.saveRelation({...input,operationId:randomUUID(),relationId:first.relationId,expectedRelationRevision:1,explanation:'过期修改'},user),/case_relation_revision_conflict/);
 const unlinked=store.saveRelation({operationId:randomUUID(),caseStoreId:input.caseStoreId,toCaseId:b.id,relationId:first.relationId,expectedRelationRevision:2,action:'unlink'},user);
 assert.equal(unlinked.revision,3);assert.equal(store.listRelations().items.length,0);assert.equal(store.listRelations({includeUnlinked:true}).items.length,1);
 const restored=store.saveRelation({operationId:randomUUID(),caseStoreId:input.caseStoreId,toCaseId:b.id,relationId:first.relationId,expectedRelationRevision:3,action:'restore'},user);
 assert.equal(restored.revision,4);assert.equal(restored.relationId,first.relationId);assert.equal(restored.explanation,second.explanation);
 const history=store.listRelationRevisions(first.relationId,{pageSize:2});assert.deepEqual(history.items.map(item=>item.revision),[4,3]);
 assert.deepEqual(store.listRelationRevisions(first.relationId,{pageSize:2,continuation:history.continuation}).items.map(item=>item.revision),[2,1]);
 assert.deepEqual([store.getCase(a.id),store.getCase(b.id)],before);
});

test('CASE-REL-STORE-02: a closed source remains reusable; closed target and cancellation reject new writes but replay is stable',async t=>{
 const{store,a,b,input}=await fixture(t);store.closeCase({operationId:randomUUID(),caseId:a.id,expectedRevision:a.revision,closeReason:'保留原经验'});
 const first=store.saveRelation(input,user);store.closeCase({operationId:randomUUID(),caseId:b.id,expectedRevision:b.revision,closeReason:'本事项结束'});
 assert.deepEqual(store.saveRelation(input,user,{assertWritable:()=>{throw new Error('cancelled_after_commit');}}),first);
 assert.throws(()=>store.saveRelation({...input,operationId:randomUUID(),relationId:first.relationId,expectedRelationRevision:1},user),/case_closed/);
 assert.throws(()=>store.saveRelation({...input,explanation:'同ID不同意图'},user),/operation_conflict/);
});

test('CASE-REL-STORE-03: support requires an exact source from its source Case and an accurate target in its target Case',async t=>{
 const{store,a,b,c,input}=await fixture(t);
 const source=draft(store,{operationId:randomUUID(),caseStoreId:input.caseStoreId,caseId:a.id,expectedRevision:0,kind:'hypothesis',payload:{title:'待核判断',statement:'保留支持条件。'}});
 const target=draft(store,{operationId:randomUUID(),caseStoreId:input.caseStoreId,caseId:b.id,expectedRevision:0,kind:'strategy',payload:{title:'目标方案',proposal:'先补齐证据。'}});
 const sourceRef={type:'case-decision' as const,caseStoreId:input.caseStoreId,caseId:a.id,recordId:source.recordId,revision:source.revision};
 const targetRef={type:'case-decision' as const,caseStoreId:input.caseStoreId,caseId:b.id,recordId:target.recordId,revision:target.revision};
 assert.throws(()=>store.saveRelation({...input,kind:'supports',targetScope:'目标方案'},user),/requires_source_and_target/);
 assert.throws(()=>store.saveRelation({...input,kind:'supports',targetScope:'目标方案',sources:[{...sourceRef,caseId:c.id}]},user),/source_mismatch/);
 assert.throws(()=>store.saveRelation({...input,kind:'supports',targetScope:'目标方案',sources:[sourceRef],targetRef:{...targetRef,caseId:c.id}},user),/target_mismatch/);
 const first=store.saveRelation({...input,kind:'supports',targetScope:'目标方案',sources:[sourceRef],targetRef},user);
 const next=draft(store,{operationId:randomUUID(),caseStoreId:input.caseStoreId,caseId:a.id,recordId:source.recordId,expectedRevision:1,kind:'hypothesis',payload:{title:'新判断',statement:'条件变化，尚待解释。'}});
 assert.equal(next.revision,2);assert.equal(store.getRelation(first.relationId).sources[0]!.type,'case-decision');
 assert.deepEqual(store.getRelation(first.relationId).sources,[sourceRef]);
 assert.throws(()=>store.saveRelation({...input,operationId:randomUUID(),fromCaseId:b.id},user),/self_link/);
});

test('CASE-REL-STORE-04: populated schema2 values survive relation migration and compatible disabled code reads schema3',async t=>{
 const{store,a,b,input,file,root}=await fixture(t);
 const card=draft(store,{operationId:randomUUID(),caseStoreId:input.caseStoreId,caseId:a.id,expectedRevision:0,kind:'strategy',payload:{title:'原策略',proposal:'保留旧判断和人的决定。'}});
 store.chooseStrategy({operationId:randomUUID(),caseStoreId:input.caseStoreId,caseId:a.id,strategyRef:{type:'case-decision',caseStoreId:input.caseStoreId,caseId:a.id,recordId:card.recordId,revision:1},choice:'gather_evidence',expectedPreviousChoiceId:null});
 const before=sqlState(file),beforeRead=await fs.readFile(file);assert.equal(before.version,2);assert.deepEqual(store.listRelations().items,[]);assert.deepEqual(await fs.readFile(file),beforeRead);
 const saved=store.saveRelation(input,user),after=sqlState(file);assert.equal(after.version,3);assert.equal(after.integrity,'ok');assert.deepEqual(after.foreignKeys,[]);
 for(const[table,rows]of Object.entries(before.rows))for(const row of rows)assert.ok(after.rows[table]!.some(value=>JSON.stringify(value)===JSON.stringify(row)),`${table} old SQL values preserved`);
 store.close();const disabled=new CaseStore({dataRoot:root,relationsEnabled:false});try{assert.equal((await disabled.init()).state,'ready');assert.deepEqual(disabled.getRelation(saved.relationId),saved);assert.deepEqual(disabled.saveRelation(input,user),saved);assert.throws(()=>disabled.saveRelation({...input,operationId:randomUUID(),relationId:saved.relationId,expectedRelationRevision:1},user),/case_relations_disabled/);assert.equal(disabled.getDecision(a.id,card.recordId).revision,1);}finally{disabled.close();}
});

test('CASE-REL-STORE-05: failed migration rolls back old values and no completed receipt; lost commit remains read-only UNKNOWN',async t=>{
 const{store,input,file}=await fixture(t);const before=sqlState(file),original=DatabaseSync.prototype.exec;
 const failure=t.mock.method(DatabaseSync.prototype,'exec',function(this:DatabaseSync,sql:string){if(sql.startsWith('CREATE TEMP TABLE relation_old_events')){original.call(this,sql);throw new Error('synthetic_relation_migration_failure');}return original.call(this,sql);});
 try{assert.throws(()=>store.saveRelation(input,user),/synthetic_relation_migration_failure/);}finally{failure.mock.restore();}
 assert.deepEqual(sqlState(file),before);assert.equal(store.getOperation(input.operationId),null);
 let armed=true;const lost=t.mock.method(DatabaseSync.prototype,'exec',function(this:DatabaseSync,sql:string){const result=original.call(this,sql);if(armed&&sql==='COMMIT'){armed=false;throw new Error('synthetic_relation_commit_ack_lost');}return result;});
 try{assert.throws(()=>store.saveRelation(input,user),/case_transaction_outcome_unknown/);}finally{lost.mock.restore();}
 assert.equal(store.getStatus().code,'case_transaction_outcome_unknown');const receipt=store.getOperation(input.operationId);assert.equal(receipt?.phase,'completed');assert.equal(store.listRelations().items.length,1);
 assert.throws(()=>store.saveRelation({...input,operationId:randomUUID()},user),/case_transaction_outcome_unknown/);
});

test('CASE-REL-STORE-06: unlink cannot smuggle replacement source identities into its history', async t => {
  const { store, input, b, c } = await fixture(t);
  const first = store.saveRelation(input, user);
  assert.throws(() => store.saveRelation({
    operationId: randomUUID(), caseStoreId: input.caseStoreId, toCaseId: b.id,
    relationId: first.relationId, expectedRelationRevision: 1, action: 'unlink',
    sources: [{ type: 'case-artifact', caseStoreId: input.caseStoreId, caseId: c.id, artifactId: randomUUID(), observedSha256: null }],
  }, user), /case_relation_lifecycle_body_immutable/);
  assert.deepEqual(store.getRelation(first.relationId), first);
});

test('CASE-REL-STORE-07: artifact references must use their reliable stored observation, while old relation observations survive refresh', async t => {
  const { store, input, a, b } = await fixture(t);
  const projectId = randomUUID();
  store.linkProject({ operationId: randomUUID(), caseId: a.id, expectedRevision: a.revision, projectId });
  const artifact = store.saveArtifact({ operationId: randomUUID(), caseId: a.id, expectedRevision: store.getCase(a.id).revision, projectId,
    relativePath: '060_reports/original.md', observedSha256: 'a'.repeat(64), observedBytes: 8, observedAt: new Date().toISOString() }).artifact;
  const ref = { type: 'case-artifact' as const, caseStoreId: input.caseStoreId, caseId: a.id, artifactId: artifact.id, observedSha256: artifact.observedSha256 };
  assert.throws(() => store.saveRelation({ ...input, kind: 'supports', targetScope: '待核问题', sources: [{ ...ref, observedSha256: 'b'.repeat(64) }] }, user), /artifact_observation_mismatch/);
  const saved = store.saveRelation({ ...input, kind: 'supports', targetScope: '待核问题', sources: [ref] }, user);
  store.saveArtifact({ operationId: randomUUID(), caseId: a.id, expectedRevision: store.getCase(a.id).revision, projectId,
    relativePath: artifact.relativePath, observedSha256: 'c'.repeat(64), observedBytes: 9, observedAt: new Date().toISOString() });
  const revised = store.saveRelation({ operationId: randomUUID(), caseStoreId: input.caseStoreId, toCaseId: b.id, relationId: saved.relationId,
    expectedRelationRevision: 1, explanation: '保留原观察，更新说明。' }, user);
  assert.deepEqual(revised.sources, [ref]);
});

test('CASE-REL-STORE-08: exact Case excerpts reject missing ranges and split emoji before committing', async t => {
  const { store, input, a } = await fixture(t);
  const source = draft(store, { operationId: randomUUID(), caseStoreId: input.caseStoreId, caseId: a.id,
    expectedRevision: 0, kind: 'hypothesis', payload: { title: '准确😀来源', statement: '保留完整字符和准确范围。' } });
  const body = JSON.stringify(store.getDecision(a.id, source.recordId, 1), null, 2), emoji = body.indexOf('😀');
  const ref = { type: 'case-decision' as const, caseStoreId: input.caseStoreId, caseId: a.id, recordId: source.recordId, revision: 1 };
  for (const excerpt of [{ start: body.length + 1, end: body.length + 5 }, { start: emoji + 1, end: emoji + 2 }]) {
    assert.throws(() => store.saveRelation({ ...input, kind: 'supports', targetScope: '待核范围', sources: [{ ...ref, excerpt }] }, user), /invalid_personal_excerpt/);
    assert.equal(store.getOperation(input.operationId), null);
  }
  const saved = store.saveRelation({ ...input, kind: 'supports', targetScope: '待核范围', sources: [{ ...ref, excerpt: { start: emoji, end: emoji + 2 } }] }, user);
  assert.equal(saved.sources.length, 1);
});
