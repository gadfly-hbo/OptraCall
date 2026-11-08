import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import { EnterpriseMaterialsStore } from '../src/host/enterprise-materials-store.ts';
import { createStudioFeature } from '../src/host/studio-host.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { StudioStore } from '../extensions/business-plugins/studio/store.ts';
import type { SemanticContextCallContext } from '../src/agent/semantic-context.ts';
const ctx = (): SemanticContextCallContext => ({ signal: new AbortController().signal, requestId:randomUUID(), sessionId:'synthetic-publication-context', toolCallId:randomUUID(), assertCurrent(){} });
const parse = (value:any) => JSON.parse(value.content[0].text);
const decoded = (value:any) => JSON.parse(value.text.split('\n')[1]);
async function fixture(t:any, long=false) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-publication-context-')), dataRoot=path.join(root,'host');
 const projects=new ProjectStore({dataRoot,projectsRoot:path.join(root,'projects')});await projects.init();
 t.after(async()=>{await projects.close();await fs.rm(root,{recursive:true,force:true});});
 const config={id:'synthetic',revision:1,name:'synthetic',provider:'synthetic',model:'synthetic',baseUrl:'http://127.0.0.1:1'};
 const project=await projects.create({name:'Construction',configuration:config}),task=await projects.createTask(project.id,{name:'Construction'});
 const using=await projects.create({name:'Using',configuration:config}),usingTask=await projects.createTask(using.id,{name:'Analysis'});
 const unrelated=await projects.create({name:'Unrelated',configuration:config});
 const enterprise=new EnterpriseMaterialsStore(dataRoot),material=await enterprise.create({title:'Synthetic source',body:'Actual source only'});const enabled=await enterprise.enable(material.material.id,material.material.version);
 const index=await enterprise.referenceIndex({readOnly:true}),revision=index.materials[0]!.revisions[0]!;
 const source={authority:'enterprise' as const,id:material.material.id,version:revision.revisionId,sha256:revision.bodySha256,locator:index.storeId};
 const feature=createStudioFeature({dataRoot,projects,enterpriseMaterials:enterprise,mutate:async op=>op(),readBody:async()=>({}),running:()=>false,closing:()=>false,readTaskReply:async()=>{throw Error('No model');}}),store=feature.store;
 const system=store.create({name:'System',projectId:project.id,taskId:task.id,topicTitle:'Payments',goal:'Independent analysis'});store.linkUsageProject(system.id,using.id,usingTask.id);
 const asset=store.saveAsset(system.id,{kind:'rule',title:'Formal rule',body:'Net amount formula',scope:'Original synthetic input only',sources:[source],checks:[{name:'Author check',status:'pass',detail:'not a business score'}],readyForPublication:true});
 const limitations=long?Array.from({length:20},(_,i)=>`QUALIFIER_${i}:`+'条件🙂'.repeat(900)):['Only the approved source format','Method is excluded; its scenario is not ready'];
 const blocked={authority:'sap-method' as const,id:randomUUID(),version:'1',sha256:'f'.repeat(64)};
 const p=store.preparePublication(system.id,{assetIds:[asset.id],refs:[blocked],summary:'Prepared, not yet published (stale author text)',scope:'Exact limited use',limitations,excluded:['Unpublished method','Construction reports'],checks:[{name:'Author evidence',status:'pass',detail:'SOURCE_RESULT_SECRET_DO_NOT_SUPPLY'}]});
 store.confirmPublication(system.id,p.id,p.fingerprint);
 const formal={authority:'studio-source' as const,id:asset.id,version:'1',sha256:asset.revisions[0]!.sha256,projectId:project.id,locator:system.id};
 store.recordPublicationResult(system.id,p.id,{module:'sap-method',status:'unknown',refs:[blocked],detail:'Original outcome unknown; never claim published'});
 store.recordAdoption(system.id,{projectId:using.id,refs:[formal],status:'succeeded',detail:'Exact project adoption receipt'});
 store.recordAdoption(system.id,{projectId:unrelated.id,refs:[formal],status:'failed',detail:'UNRELATED_ADOPTION_SECRET'});
 store.update(system.id,{topic:{progress:'STALE_CONSTRUCTION_SAYS_UNPUBLISHED',coverage:['CANDIDATE_HISTORY_SECRET'],gaps:['OLD_GAPS_SECRET']}});
 const unconfirmed=store.preparePublication(system.id,{assetIds:[asset.id],summary:'UNCONFIRMED_PREVIEW_SECRET',scope:'Unconfirmed'});
 return {feature,store,system,asset,formal,p,limitations,using,usingTask,project,task,unrelated,unconfirmed,enterprise,material,enabled,port:feature.port(using.id,usingTask.id)};
}

test('normal Studio context supplies actual confirmed qualifiers, component outcomes and exact project adoption instead of stale construction progress',async t=>{
 const f=await fixture(t),provided=await f.feature.prepareContext(f.using.id,f.usingTask.id,{systemId:f.system.id,purpose:'analysis'}),value=decoded(provided);
 assert.doesNotMatch(provided!.text,/STALE_CONSTRUCTION|CANDIDATE_HISTORY_SECRET|OLD_GAPS_SECRET/);
 assert.equal(value.publications[0].preview.id,f.p.id);assert.equal(value.publications[0].preview.fingerprint,f.p.fingerprint);
 assert.deepEqual(value.publications[0].preview.limitations,f.limitations);assert.equal(value.publications[0].results.find((r:any)=>r.module==='sap-method').status,'unknown');
 assert.deepEqual(value.adoptions.map((r:any)=>r.projectId),[f.using.id]);assert.equal(value.adoptions[0].status,'succeeded');assert.deepEqual(value.adoptions[0].refs,[f.formal]);
 assert.doesNotMatch(JSON.stringify(value),/UNCONFIRMED_PREVIEW_SECRET|UNRELATED_ADOPTION_SECRET|SOURCE_RESULT_SECRET_DO_NOT_SUPPLY/);
 const catalog=parse(await f.port('catalog',{},ctx()));assert.doesNotMatch(JSON.stringify(catalog.systems),/STALE_CONSTRUCTION|CANDIDATE_HISTORY_SECRET|OLD_GAPS_SECRET/);
 const sourceRead=parse(await f.port('read-source',{systemId:f.system.id,payload:{ref:f.formal}},ctx()));assert.equal(sourceRead.publications[0].preview.id,f.p.id);assert.deepEqual(sourceRead.publications[0].preview.limitations,f.limitations);
 const read=parse(await f.port('read',{systemId:f.system.id,payload:{section:'publications',publicationId:f.p.id}},ctx()));
 assert.equal(read.preview.id,f.p.id);assert.deepEqual(read.preview.limitations,f.limitations);
 await assert.rejects(()=>f.port('read',{systemId:f.system.id,payload:{section:'publications',publicationId:f.unconfirmed.id}},ctx()),/studio_publication_not_available/);
 const construction=await f.feature.prepareContext(f.project.id,f.task.id,{systemId:f.system.id,purpose:'construction'});assert.match(construction!.text,/STALE_CONSTRUCTION/);
});

test('normal publication qualifier reads recheck current source qualification and never expose an unrelated or unconfirmed decision',async t=>{
 const f=await fixture(t);await f.enterprise.disable(f.material.material.id,f.enabled.material.version);
 const provided=await f.feature.prepareContext(f.using.id,f.usingTask.id,{systemId:f.system.id,purpose:'analysis'}),value=decoded(provided);
 assert.deepEqual(value.publications,[]);await assert.rejects(()=>f.port('read',{systemId:f.system.id,payload:{section:'publications',publicationId:f.p.id}},ctx()),/studio_publication_not_available/);
 const unrelatedTask=await f.feature.store.get(f.system.id);assert.ok(unrelatedTask);
});

test('long confirmed qualifiers remain bounded and recover exactly with pinned JSON pages rather than disappearing from normal analysis',async t=>{
 const f=await fixture(t,true),provided=await f.feature.prepareContext(f.using.id,f.usingTask.id,{systemId:f.system.id,purpose:'analysis'}),value=decoded(provided);
 assert.ok(provided!.text.length<48000);const summary=value.publications[0];assert.equal(summary.transport.complete,false);
 let next=summary.transport.continuation.payload,text='';
 for(let i=0;i<100;i++){const page=parse(await f.port('read',{systemId:f.system.id,payload:next},ctx()));assert.equal(page.encoding,'json-text');assert.ok(JSON.stringify(page).length<30000);text+=page.text;if(!page.continuation){assert.equal(createHash('sha256').update(text).digest('hex'),page.jsonSha256);break;}next=page.continuation;}
 const exact=JSON.parse(text);assert.deepEqual(exact.preview.limitations,f.limitations);assert.equal(exact.preview.id,f.p.id);assert.equal(exact.results.find((r:any)=>r.module==='sap-method').status,'unknown');
 assert.doesNotMatch(text,/UNCONFIRMED_PREVIEW_SECRET|UNRELATED_ADOPTION_SECRET|SOURCE_RESULT_SECRET_DO_NOT_SUPPLY/);
});

test('publication reads preserve cancellation and refuse changed continuation after source withdrawal',async t=>{
 const f=await fixture(t,true),provided=decoded(await f.feature.prepareContext(f.using.id,f.usingTask.id,{systemId:f.system.id,purpose:'analysis'}));
 const first=parse(await f.port('read',{systemId:f.system.id,payload:provided.publications[0].transport.continuation.payload},ctx()));assert.ok(first.continuation);
 await f.enterprise.disable(f.material.material.id,f.enabled.material.version);
 await assert.rejects(()=>f.port('read',{systemId:f.system.id,payload:first.continuation},ctx()),/studio_publication_not_available/);
 const g=await fixture(t);let enter!:()=>void,release!:()=>void,current=true;const reached=new Promise<void>(r=>enter=r),blocked=new Promise<void>(r=>release=r),validate=g.feature.sources.validate.bind(g.feature.sources);
 g.feature.sources.validate=async(...args)=>{await validate(...args);enter();await blocked;};
 const pending=g.port('read',{systemId:g.system.id,payload:{section:'publications',publicationId:g.p.id}},{...ctx(),assertCurrent(){if(!current)throw Error('synthetic-current-revoked');}});
 await reached;current=false;release();await assert.rejects(()=>pending,/synthetic-current-revoked/);
});

test('source body transport budgets its publication qualifiers and retains exact escaped source text',async t=>{
 const f=await fixture(t),body='\u0001"\\🙂'.repeat(7000),asset=f.store.saveAsset(f.system.id,{assetId:f.asset.id,expectedRevision:1,kind:'rule',title:'Large source',body,scope:'Synthetic',sources:f.asset.revisions[0]!.sources,readyForPublication:true}),p=f.store.preparePublication(f.system.id,{assetIds:[asset.id],summary:'New large source',scope:'Same limited use',limitations:f.limitations});f.store.confirmPublication(f.system.id,p.id,p.fingerprint);
 const ref={...f.formal,version:'2',sha256:asset.revisions[1]!.sha256};let start=0,text='';
 for(let i=0;i<100;i++){const page=parse(await f.port('read-source',{systemId:f.system.id,payload:{ref,start,length:20000}},ctx()));assert.ok(JSON.stringify(page).length<30000);assert.equal(page.publications.length,1,'Superseded publication is not current default supply');assert.equal(page.publications[0].preview.id,p.id);text+=page.text;if(!page.continuation)break;start=page.continuation.start;}
 assert.equal(text,body);
 const read=parse(await f.port('read',{systemId:f.system.id,payload:{assetId:asset.id}},ctx()));assert.equal(read.transport.complete,false);let next=read.transport.continuation.payload,recovered='';
 for(let i=0;i<100;i++){const page=parse(await f.port('read',{systemId:f.system.id,payload:next},ctx()));recovered+=page.text;if(!page.continuation)break;next=page.continuation;}
 assert.equal(JSON.parse(recovered).body,body);assert.deepEqual(JSON.parse(recovered).publications[0].preview.limitations,f.limitations);
});

test('the actual Host and Pi normal task receive confirmed qualifications and can read the exact decision through their original Studio tool',{timeout:45000},async t=>{
 const provider=await startToolProvider();t.after(()=>provider.close());const host=await startTestHost();t.after(()=>host.close());
 async function json(response:Response,status=200):Promise<any>{assert.equal(response.status,status,await response.clone().text());return response.json();}
 await json(await host.request('/api/configuration','PUT',{name:'Synthetic D3 host',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic-publication-context',apiKey:'synthetic-only'}));
 const {project}=await json(await host.request('/api/projects','POST',{name:'Construction'}),201),{project:using}=await json(await host.request('/api/projects','POST',{name:'Normal use'}),201);
 const {system}=await json(await host.request('/api/studio/systems','POST',{requestId:randomUUID(),name:'Synthetic D3',projectId:project.id,topicTitle:'Payments',goal:'Qualified ordinary use'}),201);
 const enterprise=new EnterpriseMaterialsStore(host.dataRoot),material=await enterprise.create({title:'Synthetic',body:'Source formula'});await enterprise.enable(material.material.id,material.material.version);const index=await enterprise.referenceIndex({readOnly:true}),revision=index.materials[0]!.revisions[0]!;
 const ref={authority:'enterprise' as const,id:material.material.id,version:revision.revisionId,sha256:revision.bodySha256,locator:index.storeId},store=new StudioStore(host.dataRoot);
 const asset=store.saveAsset(system.id,{kind:'rule',title:'Formal source',body:'Formula only',scope:'A only',sources:[ref],readyForPublication:true}),p=store.preparePublication(system.id,{assetIds:[asset.id],summary:'Prepared author words',scope:'EXACT_APPROVED_SYNTHETIC_SCOPE',limitations:['METHOD_HOLD_DO_NOT_TREAT_AS_READY'],excluded:['UNPUBLISHED_METHOD']});store.confirmPublication(system.id,p.id,p.fingerprint);store.update(system.id,{topic:{progress:'STALE_CONSTRUCTION_SAYS_UNPUBLISHED'}});
 const {task}=await json(await host.request(`/api/studio/systems/${system.id}/use`,'POST',{requestId:randomUUID(),projectId:using.id}));
 provider.setResponder(context=>{
  const text=context.messages.map(m=>providerMessageText(m.content)).join('\n');
  if(!text.includes('EXACT_APPROVED_SYNTHETIC_SCOPE')||!text.includes('METHOD_HOLD_DO_NOT_TREAT_AS_READY')||text.includes('STALE_CONSTRUCTION_SAYS_UNPUBLISHED'))return{text:'D3_CONTEXT_MISSING_OR_STALE'};
  if(!context.recentToolResults.length)return{calls:[{name:'studio_assets',arguments:{action:'read',systemId:system.id,payload:{section:'publications',publicationId:p.id}}}]};
  const result=providerMessageText(context.recentToolResults[0].content);
  return{text:result.includes(p.id)&&result.includes('METHOD_HOLD_DO_NOT_TREAT_AS_READY')?'D3_ACTUAL_CONTEXT_AND_TOOL_PASSED':'D3_DECISION_READ_MISSING'};
 });
 const route=`/api/projects/${using.id}/tasks/${task.id}`;await json(await host.request(route+'/messages','POST',{requestId:randomUUID(),text:'Use qualified sources autonomously.',studioContext:{systemId:system.id,purpose:'analysis'}}),202);
 let saved:any;const deadline=Date.now()+25000;do{saved=await json(await host.request(route));if(saved.task.lastRun?.status!=='running'&&saved.snapshot.status==='idle')break;await new Promise(r=>setTimeout(r,20));}while(Date.now()<deadline);
 assert.equal(saved.task.lastRun.status,'completed');assert.match(JSON.stringify(saved.snapshot.messages),/D3_ACTUAL_CONTEXT_AND_TOOL_PASSED/);assert.deepEqual(provider.errors,[]);assert.ok(provider.requests.length>=2);
});


test('retained known-incorrect historical source inspection never becomes current publication eligibility',async t=>{
 const f=await fixture(t);f.store.markAssetIssue(f.system.id,f.asset.id,'Confirmed source issue');
 const read=parse(await f.port('read',{systemId:f.system.id,payload:{assetId:f.asset.id,revision:1}},ctx()));
 assert.equal(read.historical,true);assert.equal(read.defaultRecommendation,false);assert.deepEqual(read.publications,[]);
 await assert.rejects(()=>f.port('read',{systemId:f.system.id,payload:{section:'publications',publicationId:f.p.id}},ctx()),/studio_publication_not_available/);
});
