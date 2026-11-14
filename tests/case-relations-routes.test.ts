import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CaseStore } from '../src/host/case-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { createCaseRelationsService } from '../src/host/case-relations-service.ts';
import { createCaseRelationRoutes } from '../src/host/case-relation-routes.ts';

test('CASE-REL-ROUTE-01: empty graph relation read works on a real legacy store and preserves its bytes', async t => {
  const scratch = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'case-relations-route-'));
  const dataRoot=path.join(scratch,'private');
  const cases = new CaseStore({dataRoot}); await cases.initialize(); t.after(() => cases.close());
  const projects = new ProjectStore({dataRoot,projectsRoot:path.join(scratch,'projects')}); await projects.init();
  const database = path.join(dataRoot, 'decision-cases.sqlite3'), before = await fs.readFile(database);
  const service = createCaseRelationsService({cases,projects,mutate: async fn => fn(),assertActive: () => {}});
  const route = createCaseRelationRoutes(service);
  const result = await route({pathname:'/api/case-relations',method:'GET'});
  assert.deepEqual(result?.body,{caseStoreId:cases.getStatus().storeId,items:[],continuation:null,hasMore:false,writingEnabled:true});
  assert.deepEqual(await fs.readFile(database), before);
});

test('CASE-REL-SOURCES-02: pagination keeps every source beyond the first 51 records',async t=>{
 const {randomUUID}=await import('node:crypto');const scratch=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'case-relation-sources-'));const dataRoot=path.join(scratch,'private');
 const cases=new CaseStore({dataRoot});await cases.initialize();t.after(()=>cases.close());const projects=new ProjectStore({dataRoot,projectsRoot:path.join(scratch,'projects')});await projects.init();
 const record=cases.createCase({operationId:randomUUID(),title:'多来源Case'}),caseStoreId=cases.getStatus().storeId!;
 const user={actorKind:'agent' as const,projectId:randomUUID(),taskId:randomUUID(),requestId:randomUUID(),sessionId:'synthetic-native',toolCallId:'synthetic-call'};
 cases.linkProject({operationId:randomUUID(),caseId:record.id,expectedRevision:record.revision,projectId:user.projectId});
 for(let i=0;i<55;i++)cases.saveDecisionDraft({operationId:randomUUID(),caseStoreId,caseId:record.id,expectedRevision:0,kind:'hypothesis',payload:{title:`独立来源${i+1}`,statement:'各自准确的判断。'}},user);
 const service=createCaseRelationsService({cases,projects,mutate:async fn=>fn(),assertActive:()=>{}});let continuation:string|null=null;const ids:string[]=[];
 do{const page=service.sources(record.id,{pageSize:20,continuation});ids.push(...page.items.map(item=>JSON.stringify(item.ref)));continuation=page.continuation;}while(continuation);
 assert.equal(ids.length,55);assert.equal(new Set(ids).size,55);
});
