import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {setTimeout as delay} from 'node:timers/promises';
import {startTestHost} from './fixtures/host-process.ts';import {startToolProvider,providerMessageText} from './fixtures/tool-provider.ts';
for(const clearSelectedMaterial of [false,true])test(`v1.2 Goal source respects original Project even after clearing current selection: ${clearSelectedMaterial}`,{timeout:60000},async t=>{
 const provider=await startToolProvider(),host=await startTestHost();t.after(async()=>{await host.close();await provider.close();});
 const req=async(route:string,method='GET',body?:unknown,status=200):Promise<any>=>{const r=await host.request(route,method,body);assert.equal(r.status,status,await r.clone().text());return r.json();};
 await req('/api/configuration','PUT',{name:'source-model-a',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic-source-a',apiKey:'synthetic-boundary-only'});
 const projectA=(await req('/api/projects','POST',{name:'原资料项目A'},201)).project;
 await req(`/api/projects/${projectA.id}/files/upload`,'POST',{name:'strategy-background.md',directory:'020_clean',content:Buffer.from('RESTRICTED_DETAIL_ONLY_IN_SOURCE').toString('base64')},201);
 const discussion=(await req('/api/strategy/discussions','POST',{operationId:randomUUID(),projectId:projectA.id,usageContext:{kind:'personal',background:'仅合成来源范围'}},201)).discussion;
 const source=(await req(`/api/strategy/discussions/${discussion.id}/sources`)).sources[0];assert.ok(source);
 const updated=(await req(`/api/strategy/discussions/${discussion.id}`,'PATCH',{expectedRevision:discussion.revision,sources:[source]})).discussion;
 const draft={title:'可独立承接的目标',outcome:'核对当期安排',perspective:'personal',scope:{kind:'personal',id:'self',name:'本人'},measurement:{kind:'deliverable',criterion:'核对明确安排'},baseline:{state:'pending',description:'保持待补'},responsible:'本人'};
 provider.setResponder(ctx=>!ctx.recentToolResults.length?{text:'RESTRICTED_DETAIL_ONLY_IN_SOURCE',calls:[{name:'strategy_goals',arguments:{action:'propose-goal',draft}}]}:{text:'候选已保存'});
 await req(`/api/strategy/discussions/${discussion.id}/messages`,'POST',{requestId:randomUUID(),expectedRevision:updated.revision,text:'按原资料形成候选，暂不经营执行。'},202);
 let detail:any;for(let n=0;n<250;n++){detail=await req(`/api/strategy/discussions/${discussion.id}`);if(!detail.busy&&detail.goals.length)break;await delay(20);}
 let goal=detail.goals[0];
 if(clearSelectedMaterial){
  const cleared=(await req(`/api/strategy/discussions/${discussion.id}`,'PATCH',{expectedRevision:detail.discussion.revision,projectId:null,sources:[]})).discussion;
  provider.setResponder(ctx=>!ctx.recentToolResults.length?{text:'续聊原背景，不从移除选择推定忘记历史',calls:[{name:'strategy_goals',arguments:{action:'propose-goal',goalId:goal.goalId,expectedVersion:1,draft}}]}:{text:'已追加候选第二版'});
  await req(`/api/strategy/discussions/${discussion.id}/messages`,'POST',{requestId:randomUUID(),expectedRevision:cleared.revision,text:'沿原讨论继续形成修订，保留原资料与历史。'},202);
  for(let n=0;n<250;n++){detail=await req(`/api/strategy/discussions/${discussion.id}`);if(!detail.busy&&detail.goals.some((g:any)=>g.version===2))break;await delay(20);}
  goal=detail.goals.find((g:any)=>g.version===2);assert.ok(goal);
 }
 await req(`/api/strategy/discussions/${discussion.id}/adopt`,'POST',{operationId:randomUUID(),goalId:goal.goalId,version:goal.version,expectedVersion:goal.version,goalContentSha256:detail.goalContentHashes[goal.goalId+':'+goal.version],decision:'明确采用此目标，详细原来源仍按权限。'});
 await req('/api/configuration','PUT',{name:'source-model-b',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic-source-b',apiKey:'synthetic-boundary-only'});
 const projectB=(await req('/api/projects','POST',{name:'新分析项目B'},201)).project;
 const plan={request:'读取准确目标，其原始资料须另核原权限',premises:[],materials:[],coverage:[],tasks:[{key:'analysis',name:'原来源资格核对',selected:true,scope:'继续独立工作',capabilities:[]}],taskMode:'single',summaryTaskKey:'analysis',dependencies:[],caseContext:null,goalContext:{goal:{goalId:goal.goalId,version:goal.version},purpose:'query'}};
 await req(`/api/projects/${projectB.id}/plan/draft`,'POST',{operationId:randomUUID(),expectedRevision:0,plan});const state=await req(`/api/projects/${projectB.id}/plan`);let toolResult='';
 provider.setResponder(ctx=>!ctx.recentToolResults.length?{calls:[{name:'read_goal_context_source',arguments:{goalId:goal.goalId,version:goal.version}}]}:(toolResult=providerMessageText(ctx.recentToolResults.at(-1)?.content),{text:'详细来源缺权限，目标正文仍可独立使用。'}));
 const confirmed=await req(`/api/projects/${projectB.id}/plan/confirm`,'POST',{operationId:randomUUID(),expectedRevision:state.revision,mode:'start'});const task=confirmed.confirmation.tasks[0];
 for(let n=0;n<250;n++){const d=await req(`/api/projects/${projectB.id}/tasks/${task.taskId}`);if(d.task.lastRun?.status==='completed'&&d.snapshot.status==='idle')break;await delay(20);}
 assert.ok(!toolResult.includes('RESTRICTED_DETAIL_ONLY_IN_SOURCE'),'original Goal identity is not a permission grant for its private detailed source');assert.match(toolResult,/unavailable|not_authorized|not_delivered/);t.diagnostic(host.scratch);
});

test('a Task reply derived from read_goal_context_source loses eligibility when its strategic source is removed',{timeout:60000},async t=>{
 const host=await startTestHost();t.after(()=>host.close());const provider=await startToolProvider();t.after(()=>provider.close());
 const req=async(route:string,method='GET',body?:unknown,status=200):Promise<any>=>{const r=await host.request(route,method,body);assert.equal(r.status,status,await r.clone().text());return r.json();};
 await req('/api/configuration','PUT',{name:'合成模型',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'source',apiKey:'synthetic-gate'});
 const {project}=await req('/api/projects','POST',{name:'原经营依据'},201);
 await req('/api/projects/'+project.id+'/files/upload','POST',{directory:'020_clean',name:'scope.md',content:Buffer.from('ORIGINAL_GOAL_EVIDENCE').toString('base64')},201);
 const {discussion}=await req('/api/strategy/discussions','POST',{operationId:randomUUID(),projectId:project.id},201);
 const domain='/api/strategy/discussions/'+discussion.id,source=(await req(domain+'/sources')).sources.find((s:any)=>s.title.includes('scope.md'));
 assert.ok(source);const selection=(await req(domain,'PATCH',{expectedRevision:discussion.revision,sources:[source]})).discussion;
 const draft={title:'核对预约缺口',outcome:'可追溯的经营观察',perspective:'personal',scope:{kind:'personal',id:'self',name:'本人'},measurement:{kind:'deliverable',criterion:'有记录'},baseline:{state:'pending',description:'待核'},responsible:'负责人'};
 provider.setResponder(ctx=>{
   if(!ctx.recentToolResults.length)return {calls:[{name:'strategy_goals',arguments:{action:'read-source',sourceId:source.id}}]};
   if(ctx.recentToolResults.length===1){assert.match(providerMessageText(ctx.recentToolResults[0].content),/ORIGINAL_GOAL_EVIDENCE/);return {text:'GOAL_CANDIDATE_DETAIL',calls:[{name:'strategy_goals',arguments:{action:'propose-goal',draft}}]};}
   return {text:'已生成候选'};
 });
 await req(domain+'/messages','POST',{requestId:randomUUID(),expectedRevision:selection.revision,text:'结合所选原件提出候选'},202);
 let detail;for(let i=0;i<200;i++){detail=await req(domain);if(!detail.busy&&detail.goals.length)break;await delay(20);}
 const goal=detail.goals[0];assert.ok(goal,provider.errors.join(' '));
 await req(domain+'/adopt','POST',{operationId:randomUUID(),goalId:goal.goalId,version:goal.version,expectedVersion:goal.version,goalContentSha256:detail.goalContentHashes[goal.goalId+':'+goal.version],decision:'采用，详细材料沿当前权限'});
 const plan={request:'核对原目标来源',premises:[],materials:[],coverage:[],tasks:[{key:'analysis',name:'核对当时的候选',selected:true,scope:'限定原来源',capabilities:[]}],taskMode:'single',summaryTaskKey:'analysis',dependencies:[],caseContext:null,goalContext:{goal:{goalId:goal.goalId,version:goal.version},purpose:'query'}};
 const planRoute='/api/projects/'+project.id+'/plan';
 await req(planRoute+'/draft','POST',{operationId:randomUUID(),expectedRevision:0,plan});
 provider.setResponder(ctx=>{
   if(!ctx.recentToolResults.length)return {calls:[{name:'read_goal_context_source',arguments:{goalId:goal.goalId,version:goal.version}}]};
   assert.match(providerMessageText(ctx.recentToolResults[0].content),/GOAL_CANDIDATE_DETAIL/);return {text:'GOAL_DERIVED_WORK'};
 });
 const confirmed=await req(planRoute+'/confirm','POST',{operationId:randomUUID(),expectedRevision:(await req(planRoute)).revision,mode:'start'});
 const task=confirmed.confirmation.tasks[0], taskRoute='/api/projects/'+project.id+'/tasks/'+task.taskId;
 let msg;for(let i=0;i<200;i++){const {snapshot}=await req(taskRoute);msg=snapshot.messages.find((m:any)=>m.role==='assistant'&&m.nativeEntryId&&providerMessageText(m.content)==='GOAL_DERIVED_WORK');if(msg&&snapshot.status==='idle')break;await delay(20);}
 assert.ok(msg,provider.errors.join(' '));
 const sha256=(await import('node:crypto')).createHash('sha256').update('GOAL_DERIVED_WORK').digest('hex');
 const owner={role:'goal-draft',draftId:randomUUID(),scope:draft.scope,caseSource:{kind:'task',projectId:project.id,taskId:task.taskId,reply:{type:'native-reply',projectId:project.id,taskId:task.taskId,sessionId:msg.nativeSessionId,messageId:msg.nativeEntryId,expectedTextSha256:sha256}}};
 const role='/api/business-role?owner='+encodeURIComponent(JSON.stringify(owner)),original=await req(role+'&action=origin');assert.equal(original.origin.reply.text,'GOAL_DERIVED_WORK');
 const saved=await req(domain), readReply=saved.replies.find((entry:any)=>entry.text.includes('GOAL_CANDIDATE_DETAIL'));assert.ok(readReply);
 await req(domain+'/versions','POST',{expectedRevision:saved.discussion.revision,source:readReply.source,options:'两种安排',choice:'遵循预约',rationale:'原文件',assumptions:'限定门店',unknowns:'其它时段'},201);
 const dependent=await req('/api/strategy/discussions','POST',{operationId:randomUUID(),goal:{goalId:goal.goalId,version:goal.version},projectId:project.id},201);
 const nested='/api/strategy/discussions/'+dependent.discussion.id;
 provider.setResponder(ctx=>!ctx.recentToolResults.length?{calls:[{name:'strategy_goals',arguments:{action:'read-goals'}}]}:{text:'NESTED_GOAL_DEPENDENT'});
 await req(nested+'/messages','POST',{requestId:randomUUID(),expectedRevision:1,text:'核对这个已读取原件的目标。'},202);
 let nestedState;for(let i=0;i<200;i++){nestedState=await req(nested);if(!nestedState.busy&&nestedState.replies.some((r:any)=>r.text==='NESTED_GOAL_DEPENDENT'))break;await delay(20);}
 const dependentSource=nestedState.replies.find((r:any)=>r.text==='NESTED_GOAL_DEPENDENT').source;
 await req(nested+'/versions','POST',{expectedRevision:nestedState.discussion.revision,source:dependentSource,options:'甲或乙',choice:'甲',rationale:'参考准确目标',assumptions:'待核',unknowns:'其它时段'},201);
 const exports=[nested+'/versions/1',nested+'/versions/1/export',domain+'/versions/1',domain+'/versions/1/export','/api/strategy/goals/'+goal.goalId+'/versions/'+goal.version+'/export'];
 for(const path of exports)await req(path);
 await req(domain,'PATCH',{expectedRevision:(await req(domain)).discussion.revision,sources:[],sourceScope:{mode:'selected-only',excludedSources:[source]}});
 const count=provider.requests.length;
 for(const path of exports){const denied=await host.request(path);assert.ok([403,409].includes(denied.status),path);assert.equal((await denied.json()).html,undefined);}
 for(const response of [await host.request(role+'&action=origin'),await host.request(role+'&action=messages','POST',{requestId:randomUUID(),expectedRevision:0,text:'查看原文'})]){
   assert.ok([403,409].includes(response.status),await response.clone().text());assert.ok(!(await response.text()).includes('GOAL_DERIVED_WORK'));
 }
 const attempt=await host.request(nested+'/messages','POST',{requestId:randomUUID(),expectedRevision:(await req(nested)).discussion.revision,text:'继续按上文分析'});
 assert.ok(!attempt.ok); assert.equal(provider.requests.length,count);
});
