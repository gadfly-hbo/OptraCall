import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider,providerMessageText } from './fixtures/tool-provider.ts';
import type { StrategyAttachmentCitation } from '../src/host/strategy-attachment-types.ts';

test('original Pi session reads a standalone source by locator and reopens its cited bytes; project library stays scoped', {timeout:60000},async t=>{
  const provider=await startToolProvider(),host=await startTestHost();
  t.after(async()=>{await host.close();await provider.close();});
  const req=async(route:string,method='GET',body?:unknown,status=200):Promise<any>=>{
    const response=await host.request(route,method,body);assert.equal(response.status,status,await response.clone().text());return response.json();
  };
  await req('/api/configuration','PUT',{name:'附件回归',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'isolated-attachments',apiKey:'synthetic-attachments-only'});
  const a=(await req('/api/strategy/discussions','POST',{operationId:randomUUID()},201)).discussion;
  const route='/api/strategy/discussions/'+a.id, marker='ONLY_SYNTHETIC_PROMOTION_WEEK';
  const add=(base:string,text:string,revision:number)=>req(base+'/attachments','POST',{name:'回访记录.txt',content:Buffer.from(text).toString('base64'),expectedRevision:revision});
  const original=(await add(route,'第一行\n'+marker,1)).source;
  const {discussion:bound}=await req(route,'PATCH',{expectedRevision:1,sources:[original]});
  let citation:StrategyAttachmentCitation|undefined;
  assert.equal(provider.requests.length,0);
  provider.setResponder(call=>{
    if(!call.recentToolResults.length)return {calls:[{name:'strategy_goals',arguments:{action:'read-source',sourceId:original.id,query:'第 2 行'}}]};
    const result=JSON.parse(providerMessageText(call.recentToolResults.at(-1)?.content));
    citation=result.read?.locations[0];return {text:'本轮观察限定于促销周 [[资料:'+citation?.token+']]'};
  });
  await req(route+'/messages','POST',{requestId:randomUUID(),text:'',attachmentIds:[original.id],expectedRevision:bound.revision},202);
  let state=await req(route);
  for(let i=0;i<300&&(state.busy||!state.attachmentReferences?.length);i++){await delay(20);state=await req(route);}
  assert.ok(citation);assert.match(JSON.stringify(provider.requests.at(-1)?.body),new RegExp(marker));
  const supplied=provider.requests[0].body.messages?.find(m=>m.role==='user');
  assert.match(providerMessageText(supplied?.content),/selectedAttachmentIds/);
  assert.doesNotMatch(JSON.stringify(provider.requests[0].body),new RegExp(marker));
  assert.equal(state.attachmentReferences.length,1);
  assert.deepEqual(state.attachmentReferences[0].citations,[citation]);
  const another=(await add(route,'另一时期不同观察',state.discussion.revision)).source;
  await req(route,'PATCH',{expectedRevision:state.discussion.revision,sources:[another]});
  assert.equal((await req(route+'/attachments/excerpt','POST',{citation})).text,marker);
  const other=(await req('/api/strategy/discussions','POST',{operationId:randomUUID()},201)).discussion;
  await req('/api/strategy/discussions/'+other.id+'/attachments/excerpt','POST',{citation},403);
  state=await req(route);
  await req(route,'PATCH',{expectedRevision:state.discussion.revision,sources:[]});
  await req(route+'/attachments/excerpt','POST',{citation},403);
  const count=provider.requests.length;
  const revoked=(await req(route)).discussion;
  await req(route+'/messages','POST',{requestId:randomUUID(),text:'再核一次。',expectedRevision:revoked.revision},409);
  assert.equal(provider.requests.length,count);

  const project=(await req('/api/projects','POST',{name:'合成关联项目'},201)).project;
  const linked=(await req('/api/strategy/discussions','POST',{operationId:randomUUID(),projectId:project.id},201)).discussion;
  const base='/api/strategy/discussions/'+linked.id;
  const stored=(await add(base,'项目资料',linked.revision)).source;
  assert.equal(stored.target.projectId,project.id);
  assert.match(stored.target.path,/^020_clean\//);
  assert.deepEqual((await req(base+'/attachments')).sources,[stored]);
  assert.deepEqual((await req('/api/projects/'+project.id+'/strategy-attachments')).sources,[stored]);
  t.diagnostic(host.scratch);
});

test('a project selection grants only its selected upload and an excluded project name is refused before publication', {timeout:30000}, async t=>{
  const host=await startTestHost(),provider=await startToolProvider();t.after(async()=>{await host.close();await provider.close();});
  const request=async(route:string,method='GET',body?:unknown,expected=200):Promise<any>=>{
    const res=await host.request(route,method,body);assert.equal(res.status,expected,await res.clone().text());return res.json();
  };
  const {attachmentCitation}=await import('../src/host/strategy-attachment-document.ts');
  await request('/api/configuration','PUT',{name:'附件授权',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic-scope',apiKey:'synthetic-only'});
  const {project}=await request('/api/projects','POST',{name:'已选附件'},201);
  const fileRoute='/api/projects/'+project.id+'/files',name='上期复盘.txt';
  const upload=(text:string)=>request(fileRoute+'/upload','POST',{name,directory:'020_clean',content:Buffer.from(text).toString('base64')},201);
  const first=(await upload('第一份')).file;
  const second=(await upload('同目录另一份')).file;
  const report=(await request(fileRoute+'/save-report','POST',{name,text:'成果区原件'},201)).file;
  const {discussion}=await request('/api/strategy/discussions','POST',{operationId:randomUUID(),projectId:project.id,sourceScope:{mode:'selected-only'}},201);
  const route='/api/strategy/discussions/'+discussion.id;
  const files=(await request(route+'/attachments')).sources as import('../src/host/strategy-discussion-types.ts').StrategyDiscussionSource[];
  const [a,b,c]=[first,second,report].map(file=>files.find(s=>s.target.uploadId===file.id)!);
  const selected=(await request(route,'PATCH',{expectedRevision:1,sources:[a]})).discussion;
  const check=(source:typeof a,status:number)=>request(route+'/attachments/excerpt','POST',{citation:attachmentCitation(source,'第 1 行')},status);
  assert.equal((await check(a,200)).text,'第一份');
  await check(b,403);await check(c,403);
  const replacement=(await request(route+'/attachments','POST',{expectedRevision:selected.revision,name,content:Buffer.from('明确加入的新版').toString('base64')})).source;
  await check(replacement,403);
  const both=(await request(route,'PATCH',{expectedRevision:selected.revision,sources:[a,replacement]})).discussion;
  assert.equal((await check(replacement,200)).text,'明确加入的新版');
  assert.equal((await check(a,200)).text,'第一份');
  const sourceScope={mode:'selected-only',excludedSources:[a]};
  const excluded=(await request(route,'PATCH',{expectedRevision:both.revision,sourceScope,sources:[replacement,b,c]})).discussion;
  await check(a,403);await check(replacement,403);await check(b,200);await check(c,200);
  await request(route+'/attachments','POST',{expectedRevision:excluded.revision,name,content:Buffer.from('新版待评审').toString('base64')},403);
  assert.equal((await request('/api/projects/'+project.id+'/strategy-attachments')).sources.length,4);
});
