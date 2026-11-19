import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withCaseGoal } from './case-goal.ts';
import { startTestHost } from './host-process.ts';
import { providerMessageText, startToolProvider, type ToolProviderResponder } from './tool-provider.ts';

type BrowserReceipt = { [key:string]: unknown };
type BrowserInput = { host: Awaited<ReturnType<typeof startTestHost>>; provider: Awaited<ReturnType<typeof startToolProvider>>; root:string;
  receipt:BrowserReceipt; link:(projectId:string,enable:boolean)=>Promise<unknown>; uiPort:number };
export async function verifyConfirmedRounds(t:TestContext, visit?: (input:BrowserInput)=>Promise<void>) {
  const base = path.resolve('.local/product-v13/pm-repair/case'); await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'round-')); t.diagnostic(root);
  const uiPort=Number(process.env.OPTRACALL_PM_CASE_PORT || 4391);
  const host=await startTestHost({uiPort,dataRoot:path.join(root,'host'),projectsRoot:path.join(root,'projects')});
  const provider=await startToolProvider(); t.after(async()=>{await host.close();await provider.close();});
  async function api(route:string, method='GET', input?:unknown, expected=200) {
    const reply=await host.request(route,method,input), body=await reply.json();
    assert.equal(reply.status,expected,JSON.stringify({route,body})); return body;
  }
  const id=randomUUID;
  await api('/api/configuration','PUT',{name:'合成协议端',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'pm-confirmed-case',apiKey:'synthetic-only'});
  await api('/api/cases/storage/initialize','POST',{});
  const input=await withCaseGoal(host,{operationId:id(),title:'两店复购'});
  const {project:work}=await api('/api/projects','POST',{name:'试行门店',goalOrigin:{goal:input.goalBinding.primary}},201);
  assert.deepEqual(work.goalOrigin.goal,input.goalBinding.primary);
  const {project:source}=await api('/api/projects','POST',{name:'计划项目'},201);
  const {case:record}=await api('/api/cases','POST',input,201), casePath='/api/cases/'+record.id;
  const link=async(projectId:string,enable:boolean)=>{
    const revision=(await api(casePath)).case.revision;
    return api(casePath+'/projects'+(enable?'':'/'+projectId),enable?'POST':'DELETE',{projectId,expectedRevision:revision,operationId:id()});
  };
  await link(work.id,true);await link(source.id,true);
  const {issue}=await api(casePath+'/decisions/issues','POST',{title:'先在哪家门店试行',expectedRevision:(await api(casePath)).case.revision,operationId:id()},201);
  const owner={caseId:record.id,issueId:issue.id}, issuePath=casePath+'/decisions/issues/'+issue.id;
  const tasks=(projectId:string)=>'/api/projects/'+projectId+'/tasks';
  const createTask=async(projectId:string,type:string,issue:Record<string,unknown>,expected=201)=>api(tasks(projectId),'POST',{operationId:id(),name:type+' 的门店任务',assignment:{type,skill:null,issue}},expected);
  async function send(projectId:string,taskId:string,text:string,answer:string|ToolProviderResponder) {
    provider.setResponder(typeof answer === 'string' ? ()=>({text:answer}) : answer);
    const requestId=id(), taskPath=tasks(projectId)+'/'+taskId;
    await api(taskPath+'/messages','POST',{requestId,text},202);
    for(let count=0;count<200;count++){
      const state=await api(taskPath);
      if(state.task.lastRun?.id===requestId&&state.task.lastRun.status!=='running'&&!state.snapshot.busy){
        assert.equal(state.task.lastRun.status,'completed');return {requestId,prompt:provider.requests.at(-1)!.body.messages!.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).join(' ')};
      }
      await delay(35);
    }
    assert.fail('Pi 未获得准确完成回执');
  }
  async function plan(label:string,projectId=source.id){
    const {task}=await createTask(projectId,'plan',owner);const actual=await send(projectId,task.id,'提出候选方案',label);
    assert.ok(actual.prompt.includes(input.goalBinding.primary.goalId));
    const ref=(await api(issuePath+'/sources')).replies.find((row:any)=>row.source.taskId===task.id).source;
    return {ref,revision:(await api(issuePath+'/plans','POST',{operationId:id(),source:ref})).revision};
  }
  const first=await plan('A案：仅北店试行三天'),second=await plan('B案：仅南店试行两天',work.id);
  const firstChoice=id(),secondChoice=id();
  const choose=(revision:any,before:string|null,operationId:string,expected=200)=>api(casePath+'/decisions/'+revision.recordId+'/choice','POST',{caseStoreId:revision.caseStoreId,strategyRef:{type:'case-decision',caseStoreId:revision.caseStoreId,caseId:record.id,recordId:revision.recordId,revision:revision.revision},issueId:issue.id,choice:'trial',reason:'按本轮观察验证',expectedPreviousChoiceId:before,operationId},expected);
  await link(source.id,false); await choose(first.revision,null,firstChoice,409);
  assert.equal((await api(issuePath)).rounds.length,0);
  await link(source.id,true);const {choice:a}=await choose(first.revision,null,firstChoice);
  const firstCommand={operationId:id(),choiceId:a.choiceId,projectId:work.id,title:'原北店行动',scope:'仅北店三天'};
  await link(source.id,false);
  assert.equal((await choose(first.revision,null,firstChoice)).choice.choiceId,a.choiceId);
  await api(issuePath+'/authorize','POST',firstCommand,409);
  assert.equal((await api(issuePath)).rounds[0].actions.length,0);
  await link(source.id,true);
  const {arrangement:original}=await api(issuePath+'/authorize','POST',firstCommand);
  const firstAction=original.actions[0];
  await link(source.id,false);
  const {choice:b}=await choose(second.revision,a.choiceId,secondChoice);
  assert.equal((await api(issuePath+'/authorize','POST',firstCommand)).arrangement.actions[0].authorizationId,firstAction.authorizationId);
  await link(source.id,true);
  // Keep a real unavailable native file in the synthetic root, then restore the same bytes.
  const planPath=(await api(tasks(work.id)+'/'+second.ref.taskId)).task.sessionFile;
  await rename(planPath,planPath+'.temporarily-offline');
  try {
    await choose(second.revision,b.choiceId,id(),409);
    const listing=await api(issuePath+'/sources');assert.ok(listing.limitations.length);assert.ok(listing.replies.some((r:any)=>r.source.taskId===first.ref.taskId));
  } finally {await rename(planPath+'.temporarily-offline',planPath);}
  const beforeDo=provider.requests.length;
  await createTask(work.id,'do',{...owner,choiceId:b.choiceId,authorizationId:firstAction.authorizationId},409);
  const secondCommand={operationId:id(),choiceId:b.choiceId,projectId:work.id,title:'南店回访观察',scope:'仅在南店回访两天'};
  const {arrangement}=await api(issuePath+'/authorize','POST',secondCommand), action=arrangement.actions[0];
  const doIssue={...owner,choiceId:b.choiceId,authorizationId:action.authorizationId};
  const {task:doTask}=await createTask(work.id,'do',doIssue);
  assert.equal(provider.requests.length,beforeDo);
  const doRun=await send(work.id,doTask.id,'按本轮获准范围核对执行安排','仅南店两天，等待原看板观察。');
  for(const expected of ['B案：仅南店试行两天',secondCommand.scope,b.choiceId,action.authorizationId,second.ref.messageId]) assert.ok(doRun.prompt.includes(expected),expected);
  assert.ok(!doRun.prompt.includes('A案：仅北店试行三天'));
  const feedbackPath='/api/decision-board/tasks/'+action.taskId+'/feedback';
  const {feedback}=await api(feedbackPath,'POST',{operationId:id(),expectedLatestRevisionId:null,adopted:true,outcome:'南店两天回访结束',metricDelta:'0',review:'复购没有改善',score:null,effect:'none'});
  let round=(await api(issuePath)).rounds.at(-1);assert.equal(round.actions[0].feedback[0].revisionId,feedback.revisionId);
  const {task:teach}=await createTask(work.id,'teach',{...owner,choiceId:b.choiceId,feedbackRevisionId:feedback.revisionId});
  const teachRun=await send(work.id,teach.id,'按此观察复盘','南店两天后复购持平，先回目标复核。');
  for(const expected of [feedback.revisionId,second.ref.messageId,secondCommand.scope])assert.ok(teachRun.prompt.includes(expected),expected);
  const teachReply=(await api(issuePath+'/sources')).replies.find((r:any)=>r.source.taskId===teach.id).source;
  const {review}=await api(issuePath+'/review','POST',{operationId:id(),expectedRevision:(await api(casePath)).case.revision,choiceId:b.choiceId,feedbackRevisionId:feedback.revisionId,source:teachReply,observation:'南店两天回访后复购持平',judgement:'原假设仍待核',nextStep:'提交上游复核'});
  await link(work.id,false); round=(await api(issuePath)).rounds.at(-1);
  assert.equal(round.historyLimited,true);assert.deepEqual(round.actions,[]);assert.equal(round.review,null);
  const count=provider.requests.length;
  assert.ok([403,409].includes((await host.request(tasks(work.id)+'/'+doTask.id+'/messages','POST',{requestId:id(),text:'继续原执行'})).status));
  assert.equal(count,provider.requests.length);
  await link(work.id,true);round=(await api(issuePath)).rounds.at(-1);
  assert.equal(round.historyLimited,false);assert.equal(round.actions[0].feedback[0].revisionId,feedback.revisionId);assert.equal(round.review.operationId,review.operationId);
  assert.equal(second.ref.projectId,work.id);assert.equal(teachReply.projectId,work.id);
  const receipt={firstPlanRecord:first.revision.recordId,projectGoal:work.goalOrigin,goal:input.goalBinding,caseId:record.id,issueId:issue.id,work:work.id,source:source.id,first:a.choiceId,second:b.choiceId,plan:second.ref,authorization:action,doId:doTask.id,doRequest:doRun.requestId,feedbackId:feedback.revisionId,teach:teachReply,teachRequest:teachRun.requestId,review:review.operationId};
  await writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2));
  await visit?.({host,provider,root,receipt,link,uiPort});
  const {task:decision}=await createTask(work.id,'decision',owner);
  const revoke='撤回南店两天回访的行动授权，保留已经发生的原观察。';
  const revokeRun=await send(work.id,decision.id,revoke,turn=>{
    if(!turn.recentToolResults.length)return {calls:[{name:'record_user_decision',arguments:{action:'read'}}]};
    const result=JSON.parse(providerMessageText(turn.recentToolResults.at(-1)!.content));
    if(result.type==='optracall.quoted-decision-read'){
      const row=result.actions.find((row:any)=>row.task.id===action.taskId);assert.ok(row);
      return {calls:[{name:'record_user_decision',arguments:{action:'authorize-action',decision:'revoke',strategyRef:b.strategyRef,choiceId:b.choiceId,
        quote:{start:0,end:revoke.length,text:revoke},scope:'撤回南店授权',itemId:row.item.id,taskId:row.task.id,itemVersion:row.itemVersion,taskVersion:row.taskVersion,expectedPreviousAuthorizationId:row.authorizations.at(-1).authorizationId}}]};
    }
    assert.equal(result.status,'completed');return {text:'已登记撤回，保留原观察。'};
  });
  const history=(await api('/api/decision-board/action-authorizations/history?taskId='+action.taskId)).authorizations;
  assert.equal(history.at(-1).quoteProvenance.requestId,revokeRun.requestId);assert.equal(history.at(-1).previousAuthorizationId,action.authorizationId);
  const beforeRevoke=provider.requests.length;
  await createTask(work.id,'do',doIssue,409);
  assert.equal((await api(tasks(work.id)+'/'+doTask.id+'/messages','POST',{requestId:id(),text:'原授权已撤回'},409)).code,'case_do_authorization_unavailable');
  assert.equal(provider.requests.length,beforeRevoke);
  round=(await api(issuePath)).rounds.at(-1);
  assert.equal(round.actions[0].currentAuthorizationId,undefined);assert.equal(round.actions[0].feedback[0].revisionId,feedback.revisionId);
  await choose(first.revision,b.choiceId,id());
  const beforeSwitch=provider.requests.length;
  await api(tasks(work.id)+'/'+doTask.id+'/messages','POST',{requestId:id(),text:'继续旧轮次执行'},409);
  await createTask(work.id,'do',doIssue,409);
  assert.equal(provider.requests.length,beforeSwitch);
  await writeFile(path.join(root,'withdrawal.json'),JSON.stringify({caseId:record.id,issueId:issue.id,choiceId:b.choiceId,authorizationId:action.authorizationId,
    revokedBy:history.at(-1).authorizationId,requestId:revokeRun.requestId,feedbackId:feedback.revisionId,rejectedDispatches:2},null,2));
}
