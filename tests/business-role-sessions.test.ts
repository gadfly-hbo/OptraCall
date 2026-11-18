import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { withCaseGoal } from './fixtures/case-goal.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

test('goal draft uses the scoped native Pi role, retains replies across close, and rejects a forged owner', {timeout:60000}, async t => {
  const host = await startTestHost();t.after(()=>host.close());
  const provider=await startToolProvider();t.after(()=>provider.close());
  const req = async (route:string,method='GET',body?:unknown,status=200) => {
    const response = await host.request(route, method, body);
    assert.equal(response.status,status,await response.clone().text()); return response.json();
  };
  await req('/api/configuration','PUT',{name:'Synthetic',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'role-test',apiKey:'synthetic-only'});
  const owner = {role:'goal-draft', draftId:randomUUID(),scope:{kind:'personal',id:'self',name:'测试个人范围'}};
  const route = '/api/business-role?owner='+encodeURIComponent(JSON.stringify(owner));
  const read = () => req(route);
  assert.equal((await read()).discussion,null);
  const requestId = randomUUID(), input = {requestId,text:'GSA_DRAFT_FIRST',expectedRevision:0};
  const api = (action:string) => route+'&action='+action;
  provider.setResponder(ctx => {
    const system = ctx.messages.filter(m => ['developer','system'].includes(m.role)).map(m=>providerMessageText(m.content)).join(' ');
    assert.match(system,/目标管理 Agent/); assert.match(system,/1\.3\.0/);
    assert.ok(ctx.messages.some(m=>m.role==='user'&&providerMessageText(m.content).includes('测试个人范围')));
    return {text:'GSA_DRAFT_REPLY'};
  });
  await req(api('messages'),'POST',input,202);
  let result=await read();
  for(let i=0;i<180 && result.busy;i++){await delay(30);result=await read();}
  assert.equal(result.discussion.lastRun.status,'completed');
  assert.equal(result.requestReceipt.requestId,requestId);
  assert.deepEqual(result.replies,[]);
  assert.ok(result.snapshot.messages.some((m:{role:string;content:unknown})=>m.role==='assistant'&&providerMessageText(m.content)==='GSA_DRAFT_REPLY'));
  assert.equal((await req(api('messages'),'POST',input,202)).replayed,true);
  await req(api('close'),'POST',{});
  assert.equal((await read()).snapshot.sessionId,result.snapshot.sessionId);
  assert.equal((await req('/api/business-role?owner='+encodeURIComponent(JSON.stringify({...owner,draftId:randomUUID()})))).discussion,null);
  await req('/api/business-role?owner='+encodeURIComponent(JSON.stringify({...owner,sessionFile:result.snapshot.sessionFile})),'GET',undefined,400);
  assert.deepEqual(provider.errors,[]);
});

test('zero-task Project uses only its scoped source reader, keeps exact replies after restart and can stop without affecting peers', {timeout:65000}, async t=>{
  const host=await startTestHost();t.after(()=>host.close());
  const provider=await startToolProvider();t.after(()=>provider.close());
  const req=async(route:string,method='GET',body?:unknown,status=200)=>{
    const response=await host.request(route,method,body);assert.equal(response.status,status,await response.clone().text());return response.json();
  };
  await req('/api/configuration','PUT',{name:'Project model',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'role-test',apiKey:'synthetic-only'});
  const make=async(name:string)=>(await req('/api/projects','POST',{name},201)).project;
  const a=await make('Project A'), b=await make('Project B');
  await req('/api/projects/'+a.id+'/files/upload','POST',{directory:'020_clean',name:'selected.md',content:Buffer.from('PROJECT_A_ORIGINAL').toString('base64')},201);
  await req('/api/projects/'+b.id+'/files/upload','POST',{directory:'020_clean',name:'forbidden.md',content:Buffer.from('PROJECT_B_PRIVATE').toString('base64')},201);
  const route=(id:string)=>'/api/business-role?owner='+encodeURIComponent(JSON.stringify({role:'project',projectId:id}));
  const path=route(a.id), peer=route(b.id);
  assert.equal((await req(peer)).discussion,null);
  provider.setResponder(ctx=>{
    assert.ok(ctx.messages.filter(m=>m.role==='system'||m.role==='developer').some(m=>providerMessageText(m.content).includes('Project Agent')));
    assert.deepEqual(ctx.availableTools,['strategy_goals']);
    const tool=ctx.request.body.tools?.find(t=>t.function?.name==='strategy_goals');
    assert.doesNotMatch(JSON.stringify(tool?.function?.parameters),/adopt-goal|public-search/);
    const bodies=ctx.recentToolResults.map(t=>providerMessageText(t.content));
    assert.doesNotMatch(bodies.join('|'),/forbidden.md|PROJECT_B_PRIVATE/);
    if(!bodies.length)return {calls:[{name:'strategy_goals',arguments:{action:'find-sources',query:'selected.md'}}]};
    if(bodies.length===1){
      const catalog=JSON.parse(bodies[0]);assert.equal(catalog.sources.length,1);
      return {calls:[{name:'strategy_goals',arguments:{action:'read-source',sourceId:catalog.sources[0].id}}]};
    }
    assert.match(bodies.at(-1)!,/PROJECT_A_ORIGINAL/);
    return {text:'核到甲项目的准确原文。'};
  });
  await req(path+'&action=messages','POST',{requestId:randomUUID(),text:'请阅读本项目所选文件',expectedRevision:0},202);
  const settle=async()=>{let value;for(let i=0;i<300;i++){value=await req(path);if(!value.busy&&value.discussion?.lastRun?.status!=='accepted')return value;await delay(20);}throw Error('project discussion did not settle');};
  const done=await settle();assert.equal(done.discussion.lastRun.status,'completed');assert.equal(providerMessageText(done.snapshot.messages.at(-1).content),'核到甲项目的准确原文。');
  assert.equal((await req('/api/strategy/discussions')).discussions.length,0);
  await req(path+'&action=close','POST',{});
  provider.setResponder(ctx=>{
    assert.ok(ctx.messages.some(m=>providerMessageText(m.content).includes('核到甲项目的准确原文')));
    return {text:'准备继续',hold:true};
  });
  const requestId=randomUUID(), count=provider.requests.length;
  await req(path+'&action=messages','POST',{requestId,text:'继续',expectedRevision:done.discussion.revision},202);
  await provider.waitForRequests(count+1);
  assert.equal((await req(path+'&action=stop','POST',{expectedRequestId:requestId})).stopped,true);
  const stopped=await settle();assert.equal(stopped.discussion.lastRun.status,'cancelled');
  assert.equal((await req(peer)).discussion,null);
  const calls=provider.requests.length;
  await writeFile(join(a.rootPath,'020_clean','selected.md'),'changed version');
  const denied=await host.request(path);
  assert.ok([403,409].includes(denied.status),await denied.clone().text());
  const next=await host.request(path+'&action=messages','POST',{requestId:randomUUID(),text:'重新发送历史',expectedRevision:stopped.discussion.revision});
  assert.ok([403,409].includes(next.status),await next.clone().text());
  assert.equal(provider.requests.length,calls);
  assert.deepEqual(provider.errors,[]);
});

test('Case Agent runs without a Project on an exact issue, rejects cross-Case use and preserves the closed record', {timeout:45000}, async t=>{
  const host=await startTestHost();t.after(()=>host.close());
  const provider=await startToolProvider();t.after(()=>provider.close());
  const req=async(route:string,method='GET',body?:unknown,status=200)=>{
    const r=await host.request(route,method,body);assert.equal(r.status,status,await r.clone().text());return r.json();
  };
  await req('/api/configuration','PUT',{name:'Case model',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'role-test',apiKey:'synthetic-only'});
  await req('/api/cases/storage/initialize','POST',{});
  const create=async(title:string)=>(await req('/api/cases','POST',await withCaseGoal(host,{operationId:randomUUID(),title}),201)).case;
  const a=await create('季度回访'),b=await create('另一个独立 Case');
  const issue=async(id:string,title:string,revision:number)=>(await req('/api/cases/'+id+'/decisions/issues','POST',{operationId:randomUUID(),expectedRevision:revision,title},201)).issue;
  const one=await issue(a.id,'先联系哪些客户',a.revision);
  const two=await issue(a.id,'独立问题保密标记',a.revision+1);
  const route=(caseId:string,itemId:string)=>'/api/business-role?owner='+encodeURIComponent(JSON.stringify({role:'case',caseId,itemId}));
  const path=route(a.id,one.id), peer=route(a.id,two.id);
  assert.equal((await host.request(route(b.id,one.id))).status,404);
  provider.setResponder(ctx=>{
    assert.ok(ctx.messages.some(m=>['developer','system'].includes(m.role)&&providerMessageText(m.content).includes('Decision Case Agent')));
    const inputs=ctx.messages.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).join(' ');
    assert.match(inputs,/先联系哪些客户/);assert.match(inputs,/核对本次议题的原资料/);
    assert.doesNotMatch(inputs,/独立问题保密标记/);
    assert.deepEqual(ctx.availableTools,[]);return {text:'所选事项沿本轮准确 G 与 S 讨论。'};
  });
  const requestId=randomUUID();
  await req(path+'&action=messages','POST',{requestId,text:'讨论所选事项',expectedRevision:0},202);
  let result=await req(path);
  for(let i=0;i<180&&result.busy;i++){await delay(25);result=await req(path);}
  assert.equal(result.discussion.lastRun.status,'completed');
  assert.equal(result.requestReceipt.requestId,requestId);
  assert.equal((await req(peer)).discussion,null);
  await req('/api/cases/'+a.id+'/close','POST',{operationId:randomUUID(),expectedRevision:a.revision+2,reason:'观察结束'});
  await req(path+'&action=messages','POST',{requestId:randomUUID(),expectedRevision:result.discussion.revision,text:'再发一条'},409);
  assert.equal((await req(path)).requestReceipt.requestId,requestId);
  assert.equal(provider.requests.length,1);assert.deepEqual(provider.errors,[]);
});

test('a handed strategy version reaches the Goal system turn, whose native editable suggestion is checked on human save',{timeout:45000},async t=>{
  const host=await startTestHost();t.after(()=>host.close());
  const provider=await startToolProvider();t.after(()=>provider.close());
  const req=async(route:string,method='GET',body?:unknown,status=200)=>{
    const response=await host.request(route,method,body);assert.equal(response.status,status,await response.clone().text());return response.json();
  };
  const settle=async(route:string)=>{
    for(let i=0;i<200;i++){const detail=await req(route);if(!detail.busy&&detail.discussion.lastRun?.status==='completed')return detail;await delay(25);}
    throw Error('未收到原生完成回执：'+provider.errors.join(' '));
  };
  await req('/api/configuration','PUT',{name:'策略与目标',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'review-1',apiKey:'synthetic-only'});
  const id=randomUUID(),strategy='/api/strategy/discussions/'+id;
  await req('/api/strategy/discussions','POST',{operationId:id,title:'季度预约取舍',usageContext:{kind:'personal',background:'原范围'}},201);
  provider.setResponder(ctx=>{
    const system=ctx.messages.filter(m=>m.role==='developer'||m.role==='system').map(m=>providerMessageText(m.content)).join(' ');
    assert.match(system,/战略选择 Agent · 角色系统提示词 v1.3.0/);
    return {text:'NATIVE_STRATEGY_OPTION：比较预约与延时'};
  });
  await req(strategy+'/messages','POST',{requestId:randomUUID(),text:'比较经营方向',expectedRevision:1},202);
  const actual=await settle(strategy);
  await req(strategy+'/versions','POST',{expectedRevision:actual.discussion.revision,source:actual.replies[0].source,options:'预约、延时',choice:'先核预约',rationale:'容量有限',assumptions:'存在预约需求',unknowns:'增量未知'},201);
  const scope={kind:'personal',id:'self',name:'个人工作'};
  const {version}=await req(strategy+'/versions/1/handoff','POST',{expectedRevision:(await req(strategy)).discussion.revision,scope});
  const owner={role:'goal-draft',...version.destination,strategyChoice:{discussionId:id,version:1}};
  const role=(value:unknown)=>'/api/business-role?owner='+encodeURIComponent(JSON.stringify(value));
  const route=role(owner);
  await req(role({...owner,draftId:randomUUID()}),'GET',undefined,403);
  await req(role({...owner,scope:{...scope,name:'另一个范围'}}),'GET',undefined,403);
  const draft={title:'安排两周预约观察',outcome:'能核对预约需求',perspective:'personal',measurement:{kind:'deliverable',criterion:'逐日留下新增预约数'},baseline:{state:'pending',description:'起始记录待核'},responsible:'门店负责人',strategies:['在同一服务窗口记录预约变化']};
  provider.setResponder(ctx=>{
    const system=ctx.messages.filter(m=>m.role==='developer'||m.role==='system').map(m=>providerMessageText(m.content)).join(' ');
    assert.match(system,/目标管理 Agent · 角色系统提示词 v1.3.0/);
    const users=ctx.messages.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).join(' ');
    assert.match(users,/NATIVE_STRATEGY_OPTION/);assert.match(users,/先核预约/);
    if(!ctx.recentToolResults.length)return {calls:[{name:'strategy_goals',arguments:{action:'propose-goal',draft}}]};
    assert.match(providerMessageText(ctx.recentToolResults[0].content),/editable-goal-suggestion/);return {text:'可编辑建议已就绪'};
  });
  await req(route+'&action=messages','POST',{requestId:randomUUID(),text:'带入准确战略稿准备观察目标',expectedRevision:0},202);
  const body=await settle(route);
  const suggestion=body.goalDrafts[0];assert.equal(suggestion.draft.title,draft.title);
  assert.equal(suggestion.source.sessionId,body.snapshot.sessionId);assert.equal(suggestion.source.owner.draftId,owner.draftId);
  assert.deepEqual((await req('/api/strategy/goals')).goals,[]);
  const linked={...suggestion.draft,title:'用户修改后的观察安排',roleSuggestion:suggestion.source,source:version.source,strategyChoice:{...owner.strategyChoice,contentSha256:version.contentSha256}};
  await req('/api/strategy/goals','POST',{...linked,operationId:randomUUID(),roleSuggestion:{...suggestion.source,sha256:'0'.repeat(64)}},409);
  const {goal}=await req('/api/strategy/goals','POST',{...linked,operationId:randomUUID()},201);
  assert.equal(goal.title,linked.title);assert.equal(goal.status,'candidate');assert.deepEqual(goal.roleSuggestion,suggestion.source);
  await req('/api/strategy/goals/'+goal.goalId+'/versions/1/export');
  provider.setResponder(ctx=>{const input=ctx.messages.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).join(' ');
    assert.match(input,/用户修改后的观察安排/);assert.match(input,/NATIVE_STRATEGY_OPTION/);return {text:'已按正式记录的第一版核对'};});
  const goalRoute=role({role:'goal',goalId:goal.goalId,version:1});
  await req(goalRoute+'&action=messages','POST',{requestId:randomUUID(),text:'核对准确目标',expectedRevision:0},202);
  assert.equal(providerMessageText((await settle(goalRoute)).snapshot.messages.at(-1).content),'已按正式记录的第一版核对');
  assert.deepEqual(provider.errors,[]);
});
