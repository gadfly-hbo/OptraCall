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
