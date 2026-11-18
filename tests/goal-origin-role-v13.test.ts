import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider,providerMessageText} from './fixtures/tool-provider.ts';
import {withCaseGoal} from './fixtures/case-goal.ts';

test('Case and Task goal entry binds the original revision or native reply and fails closed on source loss',{timeout:45000},async t=>{
  const host=await startTestHost();t.after(()=>host.close());
  const provider=await startToolProvider();t.after(()=>provider.close());
  const req=async(route:string,method='GET',payload?:unknown,status=200)=>{
    const res=await host.request(route,method,payload);assert.equal(res.status,status,await res.clone().text());return res.json();
  };
  await req('/api/configuration','PUT',{name:'隔离来源模型',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'origin',apiKey:'synthetic-only'});
  const role=(owner:unknown)=>'/api/business-role?owner='+encodeURIComponent(JSON.stringify(owner));
  const turn=async(route:string,text:string,expectedRevision=0)=>{
    await req(route+'&action=messages','POST',{expectedRevision,text,requestId:randomUUID()},202);
    for(let i=0;i<200;i++){const view=await req(route);if(!view.busy&&view.discussion.lastRun?.status==='completed')return view;await delay(20);}
    assert.fail('Goal turn did not settle: '+provider.errors.join(','));
  };
  await req('/api/cases/storage/initialize','POST',{});
  const create=await withCaseGoal(host,{operationId:randomUUID(),title:'Original Case',description:'CASE_ORIGINAL_EVIDENCE'});
  const cr=(await req('/api/cases','POST',create,201)).case;
  await req('/api/cases/'+cr.id,'PATCH',{operationId:randomUUID(),expectedRevision:1,title:'Renamed Case',judgement:'new',description:'CASE_CURRENT_PRIVATE',nextStep:'later'});
  const owner={role:'goal',goalId:create.goalBinding.primary.goalId,version:create.goalBinding.primary.version};
  const path=role({...owner,caseSource:{kind:'case',caseId:cr.id,caseRevision:1}});
  provider.setResponder(ctx=>{
    assert.ok(ctx.messages.some(m=>(m.role==='developer'||m.role==='system')&&providerMessageText(m.content).includes('目标管理 Agent')));
    const input=ctx.messages.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).join(' ');
    assert.match(input,/CASE_ORIGINAL_EVIDENCE/);assert.doesNotMatch(input,/CASE_CURRENT_PRIVATE/);
    return {text:'FROM_CASE_REPLY'};
  });
  const first=await turn(path,'读当时的业务依据');assert.equal((await req(role(owner))).discussion,null);
  const {project}=await req('/api/projects','POST',{name:'源项目'},201);
  const {task}=await req('/api/projects/'+project.id+'/tasks','POST',{name:'源任务'},201);
  const taskRoute='/api/projects/'+project.id+'/tasks/'+task.id;
  provider.setResponder(()=>({text:'TASK_NATIVE_EXACT'}));
  await req(taskRoute+'/messages','POST',{requestId:randomUUID(),text:'准备原始记录'},202);
  let reply;
  for(let i=0;i<200;i++){
    const {snapshot}=await req(taskRoute);reply=snapshot.messages.find((m:{role:string;nativeEntryId?:string;content:unknown})=>m.role==='assistant'&&m.nativeEntryId&&providerMessageText(m.content)==='TASK_NATIVE_EXACT');
    if(reply&&snapshot.status==='idle')break;await delay(25);
  }
  assert.ok(reply?.nativeEntryId);
  const source={kind:'task',projectId:project.id,taskId:task.id,reply:{type:'native-reply',projectId:project.id,taskId:task.id,sessionId:reply.nativeSessionId,messageId:reply.nativeEntryId,expectedTextSha256:createHash('sha256').update('TASK_NATIVE_EXACT').digest('hex')}};
  const draft={role:'goal-draft',draftId:randomUUID(),scope:{kind:'personal',name:'本地经营',id:'self'},caseSource:source};
  const target=role(draft),priorCalls=provider.requests.length;
  const wrong=await host.request(role({...draft,caseSource:{...source,reply:{...source.reply,expectedTextSha256:'0'.repeat(64)}}}));
  assert.equal(wrong.ok,false);assert.equal(provider.requests.length,priorCalls);
  provider.setResponder(ctx=>{
    const input=ctx.messages.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).join(' ');
    assert.match(input,/TASK_NATIVE_EXACT/);assert.match(input,/源任务/);assert.doesNotMatch(input,/FROM_CASE_REPLY|CASE_ORIGINAL_EVIDENCE/);
    return {text:'FROM_TASK_REPLY'};
  });
  const second=await turn(target,'用原文核对目标');
  assert.notEqual(second.snapshot.sessionId,first.snapshot.sessionId);
  const metadata=role({...draft,caseSource:{kind:'task',projectId:project.id,taskId:task.id}});
  assert.equal((await req(metadata)).discussion,null);
  await req(taskRoute+'/archive','POST',{});
  const calls=provider.requests.length;
  for(const res of [await host.request(target),await host.request(target+'&action=messages','POST',{requestId:randomUUID(),text:'检查失读',expectedRevision:second.discussion.revision})])assert.ok([403,409].includes(res.status),await res.clone().text());
  assert.equal(provider.requests.length,calls);assert.deepEqual(provider.errors,[]);
});
