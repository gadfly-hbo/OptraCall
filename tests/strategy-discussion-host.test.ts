import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {readFile} from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider,providerMessageText } from './fixtures/tool-provider.ts';

test('v1.2 direct strategy discussion persists exact purpose, native candidate and authorized adoption in original GoalStore', {timeout:65000}, async t=>{
 const provider=await startToolProvider(),host=await startTestHost();
 t.after(async()=>{await host.close();await provider.close();});
 const req=async(route:string,method='GET',body?:unknown,status=200):Promise<any>=>{const r=await host.request(route,method,body);assert.equal(r.status,status,await r.clone().text());return r.json();};
 await req('/api/configuration','PUT',{name:'v12 synthetic',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic-strategy',apiKey:'synthetic-v12-only'});
 const created=await req('/api/strategy/discussions','POST',{operationId:randomUUID(),title:'个人事业家庭讨论',usageContext:{kind:'personal',background:'本人事业与家庭'},methods:[{id:'playing-to-win',name:'Playing to Win'}]},201);
 const id=created.discussion.id,base='/api/strategy/discussions/'+id;
 assert.equal(provider.requests.length,0,'create/read never wakes a model');
 const draft={title:'兼顾事业与家庭',outcome:'比较本人可行安排',perspective:'personal',scope:{kind:'personal',id:'self',name:'本人'},measurement:{kind:'deliverable',criterion:'本人核对取舍及可观察条件'},baseline:{state:'pending',description:'时间使用尚待核实'},responsible:'本人',necessaryConditions:['工作负荷和家庭协同待核']};
 provider.setResponder(ctx=>ctx.recentToolResults.length?{text:'候选已保存，尚未采用。'}:{calls:[{name:'strategy_goals',arguments:{action:'propose-goal',draft}}]});
 const before=await req(base),requestId=randomUUID();
 await req(base+'/messages','POST',{requestId,text:'请讨论我的事业与家庭安排。负责人是本人，形成可核对的候选，暂不采用。',expectedRevision:before.discussion.revision},202);
 const settled=async()=>{for(let n=0;n<250;n++){const d=await req(base);if(!d.busy&&d.discussion.lastRun?.status!=='accepted')return d;await delay(20);}throw Error('discussion did not settle');};
 let detail=await settled();assert.equal(detail.discussion.lastRun.status,'completed');assert.equal(detail.goals.length,1);
 const goal=detail.goals[0];assert.equal(goal.status,'candidate');assert.equal(goal.source.authority,'strategy-discussion');assert.equal(goal.usageContext.kind,'personal');
 const nativeEntries=(await readFile(detail.snapshot.sessionFile,'utf8')).trim().split('\n').map((line:string)=>JSON.parse(line));const candidateEntry=nativeEntries.find((entry:any)=>entry.id===goal.source.version);assert.equal(candidateEntry.message.role,'assistant','candidate source is the durable assistant tool carrier, not the question');assert.ok(candidateEntry.message.content.some((part:any)=>part.type==='toolCall'&&part.arguments?.draft?.title===goal.title));
 assert.equal((await req('/api/strategy/goals/'+goal.goalId)).goal.versions.length,1);
 const count=provider.requests.length;await req(base+'/messages','POST',{requestId,text:'请讨论我的事业与家庭安排。负责人是本人，形成可核对的候选，暂不采用。',expectedRevision:before.discussion.revision},202);assert.equal(provider.requests.length,count,'replaying exact request does not call model');
 const decision='我确认采用这个候选目标，保留待核前提。';
 provider.setResponder(ctx=>ctx.recentToolResults.length?{text:'原目标采用已记录，不授权经营执行。'}:{calls:[{name:'strategy_goals',arguments:{action:'adopt-goal',goalId:goal.goalId,version:1,expectedVersion:1,goalContentSha256:detail.goalContentHashes[goal.goalId+':1'],quote:{start:0,end:decision.length,text:decision}}}]});
 await req(base+'/messages','POST',{requestId:randomUUID(),text:decision,expectedRevision:detail.discussion.revision},202);detail=await settled();
 const adopted=(await req('/api/strategy/goals/'+goal.goalId)).goal.versions[0];assert.equal(adopted.status,'adopted');assert.equal(adopted.adoptionProvenance.kind,'discussion-quote');assert.equal(adopted.adoptionProvenance.quote,decision);assert.equal(detail.discussion.usageContext.kind,'personal');
 const sourceRead=await req(base+'/source?sessionId='+encodeURIComponent(goal.source.sessionId)+'&entryId='+encodeURIComponent(String(goal.source.version))+'&sha256='+goal.source.sha256+'&entryType=message');assert.match(sourceRead.body,/兼顾事业与家庭/);assert.equal(sourceRead.role,'assistant');
 const {project}=await req('/api/projects','POST',{name:'战略目标下游实际Task'},201);
 const plan={request:'沿准确战略目标继续分析与综合',premises:[],materials:[],coverage:[],tasks:[{key:'analysis',name:'准确来源核对',selected:true,scope:'核对目标依据，不推断业务效果',capabilities:[]}],taskMode:'single',summaryTaskKey:'analysis',dependencies:[],caseContext:null,goalContext:{goal:{goalId:goal.goalId,version:goal.version},purpose:'assigned-work'}};
 await req(`/api/projects/${project.id}/plan/draft`,'POST',{operationId:randomUUID(),expectedRevision:0,plan});
 const currentPlan=await req(`/api/projects/${project.id}/plan`);let taskSource='';
 provider.setResponder(ctx=>{if(!ctx.recentToolResults.length)return {calls:[{name:'read_goal_context_source',arguments:{goalId:goal.goalId,version:goal.version}}]};taskSource=providerMessageText(ctx.recentToolResults.at(-1)?.content);return {text:'已读取本任务目标准确讨论载体，来源不代表因果已证。'};});
 const confirmed=await req(`/api/projects/${project.id}/plan/confirm`,'POST',{operationId:randomUUID(),expectedRevision:currentPlan.revision,mode:'start'});const task=confirmed.confirmation.tasks[0];
 let taskState:any;for(let n=0;n<300;n++){taskState=await req(`/api/projects/${project.id}/tasks/${task.taskId}`);if(taskState.task.lastRun?.status==='completed'&&taskState.snapshot.status==='idle')break;await delay(20);}
 assert.equal(taskState.task.lastRun.status,'completed');assert.ok(taskSource.includes('兼顾事业与家庭'),'actual Task reads the accurate durable discussion source through the bound narrow tool');assert.ok(taskSource.includes(goal.source.sha256));
 assert.ok(detail.replies.every((x:any)=>x.source.sessionId&&x.source.sha256));assert.deepEqual(provider.errors,[]);
 // The human confirmation in the same discussion pins the effective adoption as well as the latest candidate.
 const goalRoute='/api/strategy/goals/'+goal.goalId;
 for(const version of [2,3])await req(goalRoute+'/revisions','POST',{...draft,source:goal.source,strategies:['第'+version+'版策略'],expectedVersion:version-1,operationId:randomUUID()},201);
 const latest=await req(base);
 const confirmation={goalId:goal.goalId,version:3,expectedVersion:3,expectedAdoptedVersion:1,
   goalContentSha256:latest.goalContentHashes[goal.goalId+':3'],decision:'采用所见候选',operationId:randomUUID()};
 await req(goalRoute+'/adopt','POST',{version:2,expectedVersion:3,operationId:randomUUID(),decision:'另一人选用第二版'});
 assert.equal((await req(base+'/adopt','POST',confirmation,409)).code,'strategy_goal_adoption_changed');
 assert.equal((await req(goalRoute)).goal.adoptedVersion,2);
 const reviewed={...confirmation,operationId:randomUUID(),expectedAdoptedVersion:2};
 const written=await req(base+'/adopt','POST',reviewed);
 assert.equal(written.goal.adoptionProvenance.kind,'ui-confirmation');
 assert.deepEqual((await req(base+'/adopt','POST',reviewed)).goal,written.goal);
 assert.equal((await req(base+'/adopt','POST',{...reviewed,decision:'更改该笔操作的理由'},409)).code,'strategy_goal_operation_conflict');
 assert.equal((await req(goalRoute)).goal.versions.length,3);

 t.diagnostic(host.scratch);
});

test('v1.2 stopped discussion remains stopped and another discussion continues without a project or BSC', {timeout:45000}, async t=>{
 const provider=await startToolProvider(),host=await startTestHost();t.after(async()=>{await host.close();await provider.close();});
 const req=async(route:string,method='GET',body?:unknown,status=200):Promise<any>=>{const r=await host.request(route,method,body);assert.equal(r.status,status,await r.clone().text());return r.json();};
 await req('/api/configuration','PUT',{name:'v12 lifecycle',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic-strategy',apiKey:'synthetic-v12-lifecycle'});
 const a=(await req('/api/strategy/discussions','POST',{operationId:randomUUID(),usageContext:{kind:'department',background:'上层组织未知'}},201)).discussion;
 const b=(await req('/api/strategy/discussions','POST',{operationId:randomUUID(),usageContext:{kind:'personal',background:'家庭与事业'}},201)).discussion;
 provider.setResponder(ctx=>ctx.requestNumber===1?{text:'等待补证',hold:true}:{text:'另一独立讨论已完成；没有取得任何资料权限。'});
 const requestId=randomUUID();await req(`/api/strategy/discussions/${a.id}/messages`,'POST',{requestId,text:'A等待',expectedRevision:a.revision},202);await provider.waitForRequests(1);
 await req(`/api/strategy/discussions/${a.id}`,'PATCH',{expectedRevision:a.revision+1,methods:[]},409);
 await req(`/api/strategy/discussions/${b.id}/messages`,'POST',{requestId:randomUUID(),text:'B正常讨论',expectedRevision:b.revision},202);
 await provider.waitForRequests(2);
 await req(`/api/strategy/discussions/${a.id}/stop`,'POST',{expectedRequestId:requestId});
 let detail:any;for(let n=0;n<200;n++){detail=await req(`/api/strategy/discussions/${a.id}`);if(!detail.busy&&detail.discussion.lastRun.status!=='accepted')break;await delay(20);}
 assert.equal(detail.busy,false);assert.equal(detail.discussion.lastRun.status,'cancelled');
 const requests=provider.requests.length;await req(`/api/strategy/discussions/${a.id}/close`,'POST',{});await req(`/api/strategy/discussions/${a.id}`);await req('/api/strategy/discussions');assert.equal(provider.requests.length,requests);
 assert.equal((await req('/api/strategy/goals')).goals.length,0);assert.equal((await req('/api/projects')).projects.length,0);
});
