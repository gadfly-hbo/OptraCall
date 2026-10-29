import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';
async function read(response:Response,status=200):Promise<any>{assert.equal(response.status,status,await response.clone().text());return response.json();}
test('CASE-CONTEXT: reject changed Case before runtime/model, pin selected background on original task, never replay accepted requests', {timeout:60000},async t=>{
 const provider=await startSyntheticProvider();t.after(()=>provider.close());const host=await startTestHost();t.after(()=>host.close());
 await read(await host.request('/api/configuration','PUT',{name:'Context synthetic',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic-context',apiKey:'synthetic-context-only'}));
 const {project}=await read(await host.request('/api/projects','POST',{name:'Original project'}),201);
 const {task}=await read(await host.request(`/api/projects/${project.id}/tasks`,'POST',{name:'Original task'}),201);
 await read(await host.request('/api/cases/storage/initialize','POST',{}));
 let record=(await read(await host.request('/api/cases','POST',{operationId:randomUUID(),title:'复购率下滑5%'}),201)).case;
 record=(await read(await host.request(`/api/cases/${record.id}/projects`,'POST',{operationId:randomUUID(),expectedRevision:record.revision,projectId:project.id}))).case;
 const stale={caseId:record.id,caseRevision:record.revision,projectWorkRevision:0,selectedReferenceIds:[]};
 record=(await read(await host.request(`/api/cases/${record.id}`,'PATCH',{operationId:randomUUID(),expectedRevision:record.revision,title:record.title,description:'合成背景',judgement:'未确定原因',nextStep:'核对人群'}))).case;
 await read(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`,'POST',{requestId:randomUUID(),text:'过期背景不得发送',caseContext:stale}),409);
 assert.equal(provider.requests.length,0);
 const selection={...stale,caseRevision:record.revision}, requestId=randomUUID(),stream=await sessionEvents(host,project.id,task.id);t.after(()=>stream.close());
 await read(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`,'POST',{requestId,text:'请研究原因',caseContext:selection}),202);
 await stream.terminal;assert.equal(provider.requests.length,1);
 const sent=JSON.stringify(provider.requests[0].body);assert.ok(sent.includes('复购率下滑5%'));assert.ok(sent.includes('合成背景'));assert.ok(sent.includes('未确定原因'));assert.ok(sent.includes('请研究原因'));
 await read(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`,'POST',{requestId,text:'请研究原因',caseContext:selection}),202);
 assert.equal(provider.requests.length,1);
 await read(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`,'POST',{requestId,text:'不同输入',caseContext:selection}),409);
 assert.equal(provider.requests.length,1);
 const {task:independent}=await read(await host.request(`/api/projects/${project.id}/tasks`,'POST',{name:'独立任务'}),201),directStream=await sessionEvents(host,project.id,independent.id);t.after(()=>directStream.close());
 const directRequestId=randomUUID();await read(await host.request(`/api/projects/${project.id}/tasks/${independent.id}/messages`,'POST',{requestId:directRequestId,text:'独立项目问题'}),202);await directStream.terminal;
 await read(await host.request(`/api/projects/${project.id}/tasks/${independent.id}/messages`,'POST',{requestId:directRequestId,text:'独立项目问题',caseContext:selection}),409);
 assert.equal(provider.requests.length,2);assert.ok(!JSON.stringify(provider.requests[1].body).includes('复购率下滑5%'));
 const detail=await read(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));assert.equal(detail.task.id,task.id);assert.equal(detail.project.tasks.length,2);
});
test('CASE-WORK: rename, archive and restore responses retain global work projection and revision',async t=>{
 const host=await startTestHost();t.after(()=>host.close());
 await read(await host.request('/api/configuration','PUT',{name:'Projection fixture',provider:'openai-compatible',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-projection',apiKey:'synthetic-only'}));
 const {project}=await read(await host.request('/api/projects','POST',{name:'Projection project'}),201);
 await read(await host.request('/api/cases/storage/initialize','POST',{}));
 const {work}=await read(await host.request(`/api/projects/${project.id}/work`,'PATCH',{operationId:randomUUID(),expectedRevision:0,workStatus:'in_progress',workScope:'共享研究范围',assignee:'A',nextStep:'核对证据',statusReason:null}));
 assert.equal(work.revision,1);
 for(const [route,method,input] of [[`/api/projects/${project.id}`,'PATCH',{name:'Renamed project'}],[`/api/projects/${project.id}/archive`,'POST',{}],[`/api/projects/${project.id}/restore`,'POST',{}]] as const){
  const result=await read(await host.request(route,method,input));assert.deepEqual(result.project.work,work);assert.equal(result.project.workUnavailable,false);
 }
});
test('CASE-LIFECYCLE: closing a Case preserves an already accepted native run and blocks only subsequent Case work', {timeout:60000},async t=>{
 const {startToolProvider}=await import('./fixtures/tool-provider.ts');const provider=await startToolProvider();t.after(()=>provider.close());provider.setResponder(()=>({text:'已接受任务的部分输出',hold:true}));
 const host=await startTestHost();t.after(()=>host.close());
 await read(await host.request('/api/configuration','PUT',{name:'Lifecycle fixture',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic-lifecycle',apiKey:'synthetic-only'}));
 const {project}=await read(await host.request('/api/projects','POST',{name:'原项目'}),201),{task}=await read(await host.request(`/api/projects/${project.id}/tasks`,'POST',{name:'原任务'}),201);
 await read(await host.request('/api/cases/storage/initialize','POST',{}));let record=(await read(await host.request('/api/cases','POST',{operationId:randomUUID(),title:'持续运行事项'}),201)).case;
 record=(await read(await host.request(`/api/cases/${record.id}/projects`,'POST',{operationId:randomUUID(),expectedRevision:record.revision,projectId:project.id}))).case;
 const selection={caseId:record.id,caseRevision:record.revision,projectWorkRevision:0,selectedReferenceIds:[]},stream=await sessionEvents(host,project.id,task.id);t.after(()=>stream.close());
 await read(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`,'POST',{requestId:randomUUID(),text:'持续执行合成请求',caseContext:selection}),202);await provider.waitForRequests(1);
 await read(await host.request(`/api/cases/${record.id}/close`,'POST',{operationId:randomUUID(),expectedRevision:record.revision,reason:'停止以本Case发起新工作'}));
 assert.equal((await read(await host.request(`/api/projects/${project.id}/tasks/${task.id}`))).snapshot.status,'running');assert.equal(provider.requests[0].closedEarly,false);
 await read(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`,'POST',{requestId:randomUUID(),text:'已结束Case不得继续发起',caseContext:selection}),409);assert.equal(provider.requests.length,1);
 await read(await host.request(`/api/projects/${project.id}/tasks/${task.id}/stop`,'POST',{}));const settled=await stream.terminal;assert.equal(settled.type,'run.settled');if(settled.type==='run.settled')assert.equal(settled.outcome,'cancelled');
 const saved=(await read(await host.request(`/api/projects/${project.id}`))).project;assert.equal(saved.archivedAt,null);assert.equal(saved.work.workStatus,null);assert.equal(saved.id,project.id);
});
test('CASE-BOUNDS: legal Chinese fields fit the public API limits together',async t=>{
 const host=await startTestHost();t.after(()=>host.close());await read(await host.request('/api/cases/storage/initialize','POST',{}));
 let record=(await read(await host.request('/api/cases','POST',{operationId:randomUUID(),title:'字段边界'}),201)).case;
 const description='背'.repeat(20000),judgement='判'.repeat(20000),nextStep='下'.repeat(5000);
 record=(await read(await host.request(`/api/cases/${record.id}`,'PATCH',{operationId:randomUUID(),expectedRevision:record.revision,title:record.title,description,judgement,nextStep}))).case;
 assert.equal(record.description,description);assert.equal(record.judgement,judgement);assert.equal(record.nextStep,nextStep);
});
