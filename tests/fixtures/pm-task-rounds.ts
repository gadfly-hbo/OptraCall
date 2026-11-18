import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import { withCaseGoal } from './case-goal.ts';
import { startTestHost } from './host-process.ts';
import { startToolProvider, providerMessageText, type ToolProviderResponder } from './tool-provider.ts';

export async function startTaskRounds(t: TestContext, uiPort?: number) {
  const host = await startTestHost({ uiPort }), provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  async function api(route: string, method = 'GET', input?: unknown, expected = 200) {
    const response = await host.request(route, method, input), data = await response.json();
    assert.equal(response.status, expected, JSON.stringify({ route, data }));
    return data;
  }
  const id = randomUUID;
  await api('/api/configuration', 'PUT', { name:'合成模型', provider:'openai-compatible', model:'synthetic-task-rounds', baseUrl:provider.baseUrl, apiKey:'synthetic-only' });
  await api('/api/cases/storage/initialize', 'POST', {});
  const input = await withCaseGoal(host, { title:'门店经营观察', operationId:id() });
  const { project } = await api('/api/projects', 'POST', { name:'门店项目' }, 201);
  const { case:record } = await api('/api/cases', 'POST', input, 201);
  const casePath = '/api/cases/'+record.id, taskPath = '/api/projects/'+project.id+'/tasks';
  await api(casePath+'/projects','POST',{ projectId:project.id, expectedRevision:record.revision, operationId:id() });
  const revision = async () => (await api(casePath)).case.revision;
  const { issue } = await api(casePath+'/decisions/issues','POST',{title:'门店补货',expectedRevision:await revision(),operationId:id()},201);
  const issuePath = casePath+'/decisions/issues/'+issue.id, owner = {caseId:record.id,issueId:issue.id};
  async function create(type:string,name:string,issue?:Record<string,string>) {
    return (await api(taskPath,'POST',{name,operationId:id(),assignment:{type,skill:null,issue}},201)).task;
  }
  async function send(taskId:string,input:string,answer:string | ToolProviderResponder) {
    provider.setResponder(typeof answer === 'string' ? ()=>({text:answer}) : answer);
    const requestId = id(), path = taskPath+'/'+taskId;
    await api(path+'/messages','POST',{requestId,text:input},202);
    for(let i=0;i<240;i++) {
      const {task,snapshot} = await api(path);
      if(task.lastRun?.id===requestId && !snapshot.busy && task.lastRun.status!=='running') {
        assert.equal(task.lastRun.status,'completed');
        return requestId;
      }
      await delay(35);
    }
    assert.fail('没有取得本次 Pi 完成回执');
  }
  const prompt = () => provider.requests.at(-1)!.body.messages!.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).join('\n');
  async function choose(label:string,previous:string|null = null) {
    const task = await create('plan',label+'方案',owner);
    await send(task.id,'提出可核对的方案',label+'方案原文');
    const {source} = (await api(issuePath+'/sources')).replies.find((r:any)=>r.source.taskId===task.id);
    const {revision:plan} = await api(issuePath+'/plans','POST',{source,operationId:id()});
    const {choice} = await api(casePath+'/decisions/'+plan.recordId+'/choice','POST',{caseStoreId:plan.caseStoreId,
      strategyRef:{type:'case-decision',caseStoreId:plan.caseStoreId,caseId:record.id,recordId:plan.recordId,revision:plan.revision},
      issueId:issue.id,choice:'trial',reason:label+'取舍理由',operationId:id(),expectedPreviousChoiceId:previous});
    return {choiceId:choice.choiceId,strategyRef:choice.strategyRef,source};
  }
  async function authorize(choiceId:string,label:string) {
    const result=await api(issuePath+'/authorize','POST',{operationId:id(),projectId:project.id,choiceId,title:label+'行动',scope:label+'授权范围'});
    return result.arrangement.actions[0];
  }
  async function observe(taskId:string,label:string) {
    return (await api('/api/decision-board/tasks/'+taskId+'/feedback','POST',{operationId:id(),expectedLatestRevisionId:null,
      adopted:true,outcome:label+'原观察',metricDelta:'0',review:label+'效果待核',score:null,effect:'none'})).feedback;
  }
  return {host,provider,api,project,owner,casePath,taskPath,issuePath,revision,create,send,prompt,choose,authorize,observe};
}
