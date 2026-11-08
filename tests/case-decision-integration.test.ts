import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startTestHost} from './fixtures/host-process.ts';
import {startToolProvider,providerMessageText} from './fixtures/tool-provider.ts';
import {readJson} from './fixtures/joint-context.ts';
import {sessionEvents} from './fixtures/session-events.ts';

test('M5 CD01/02/08 actual Host→Pi→Provider saves an author-bound draft from the original Case task without manual maintenance', {timeout:40_000},async t=>{
  for (const nested of [false, true]) await t.test(nested ? 'legal nested save' : 'direct save', async t => {
  const provider=await startToolProvider();t.after(()=>provider.close());
  const host=await startTestHost();t.after(()=>host.close());
  await readJson(await host.request('/api/configuration','PUT',{name:'M5合成',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic',apiKey:'synthetic-m5-only'}));
  await readJson(await host.request('/api/cases/storage/initialize','POST',{}));
  const {project}=await readJson(await host.request('/api/projects','POST',{name:'M5同任务合成'}),201);
  const {task}=await readJson(await host.request(`/api/projects/${project.id}/tasks`,'POST',{name:'同一普通任务'}),201);
  let {case:record}=await readJson(await host.request('/api/cases','POST',{operationId:randomUUID(),title:'M5合成缺货事项'}),201);
  await readJson(await host.request(`/api/cases/${record.id}/projects`,'POST',{operationId:randomUUID(),expectedRevision:record.revision,projectId:project.id}));
  record=(await readJson(await host.request(`/api/cases/${record.id}`))).case;
  const input={kind:'hypothesis',expectedRevision:0,payload:{title:'执行路径待核',statement:'已有权限仍可能没有实际执行；并非已证实结论。'}};
  provider.setResponder(({recentToolResults})=>recentToolResults.length?{text:'合成答复：已提出有限解释，保留未知。'}:{calls:[{name:nested?'codemode':'save_case_decision_draft',arguments:nested?{code:`const result=await tools.save_case_decision_draft(${JSON.stringify(input)});text(result);`}:input}]});
  const requestId=randomUUID(),route=`/api/projects/${project.id}/tasks/${task.id}`,events=await sessionEvents(host,project.id,task.id);
  try {
    await readJson(await host.request(route+'/messages','POST',{requestId,text:'请分析当前事项，按需要整理判断。',caseContext:{caseId:record.id,caseRevision:record.revision,projectWorkRevision:0,selectedReferenceIds:[]}}),202);
    const terminal=await events.terminal;assert.equal(terminal.type,'run.settled');if(terminal.type==='run.settled')assert.equal(terminal.outcome,'completed');
  }finally{await events.close();}
  const list=await readJson(await host.request(`/api/cases/${record.id}/decisions`));
  assert.equal(list.items.length,1,'normal original-task prompt must persist one independently authored Case draft through the real SDK');
  const draft=list.items[0];assert.equal(draft.payload.statement,input.payload.statement);assert.equal(draft.origin.actorKind,'agent');assert.equal(draft.origin.projectId,project.id);assert.equal(draft.origin.taskId,task.id);assert.equal(draft.origin.requestId,requestId);assert.ok(draft.origin.sessionId);assert.ok(draft.origin.toolCallId);assert.equal(list.choices.length,0);
  assert.equal((await readJson(await host.request(`/api/cases/${record.id}`))).case.revision,record.revision);
  const state=await readJson(await host.request(route));const native=await readFile(state.task.sessionFile,'utf8');assert.ok(native.includes('save_case_decision_draft'));assert.ok(native.includes(draft.operationId));
  assert.ok(provider.requests[0].body.tools?.some(t=>t.function?.name==='save_case_decision_draft'));
  assert.ok(providerMessageText([...provider.requests.at(-1)!.body.messages!].reverse().find(m=>m.role==='tool')?.content).includes(draft.operationId));
  const readOperation=await readJson(await host.request('/api/cases/operations/'+draft.operationId));assert.equal(readOperation.operation.phase,'completed');
  const entries=native.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(entries.filter(e=>e.message?.role==='toolResult'&&e.message.toolName==='save_case_decision_draft').length,nested?0:1);
  if(nested)assert.ok(entries.some(e=>e.message?.toolName==='codemode'&&e.message.nestedCalls?.calls.some((c:{name:string;status:string})=>c.name==='save_case_decision_draft'&&c.status==='ok')));
  });
});
