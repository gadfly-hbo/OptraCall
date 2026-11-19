import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { withCaseGoal } from './fixtures/case-goal.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { providerMessageText, startToolProvider } from './fixtures/tool-provider.ts';
import type { GoalDraftInput } from '../src/host/strategy-goals-types.ts';

for (const dependency of ['selected Goal', 'related Goal', 'Goal feedback', 'operation Goal', 'operation feedback'] as const) {
  test(`frozen strategy and adopted GSA preserve ${dependency} Case access for Project and manual Task`, {timeout:60000}, async t => {
    const host = await startTestHost(), provider = await startToolProvider();
    t.after(async () => { await host.close(); await provider.close(); });
    async function api(route: string, method = 'GET', input?: unknown, status = 200) {
      const response = await host.request(route, method, input), body = await response.json();
      assert.equal(response.status, status, JSON.stringify({route, body}));
      return body;
    }
    async function completed(route: string, requestId: string) {
      for (let i = 0; i < 300; i++) {
        const detail = await api(route), last = (detail.discussion ?? detail.task)?.lastRun;
        if (last?.id === requestId && last.status === 'completed') return detail;
        if (last?.id === requestId && ['failed', 'unknown', 'cancelled'].includes(last.status)) assert.fail(JSON.stringify(last));
        await wait(25);
      }
      assert.fail('The synthetic request did not complete');
    }
    function lastUserInput() {
      return providerMessageText(provider.requests.at(-1)?.body.messages?.filter(m => m.role === 'user').at(-1)?.content);
    }
    const goals = '/api/strategy/goals';
    const draft: GoalDraftInput = {
      title:'复核营业日', outcome:'有依据地解释营业日差异', scope:{kind:'personal',id:'self',name:'本人'}, perspective:'personal',
      measurement:{kind:'deliverable',criterion:'原始记录可核'},baseline:{state:'pending',description:'待补营业记录'},responsible:'负责人',strategies:['按原证据核对'],
    };
    async function adopt(fields: Partial<GoalDraftInput>,operationId:string=randomUUID()) {
      const {goal} = await api(goals, 'POST', {...draft, ...fields, operationId}, 201);
      const ref = {goalId:goal.goalId, version:goal.version};
      await api(goals+'/'+ref.goalId+'/adopt', 'POST', {...ref, expectedVersion:ref.version, operationId:randomUUID(), decision:'采纳本版'});
      return ref;
    }
    await api('/api/configuration', 'PUT', {name:'本地模拟协议',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'fixture',apiKey:'synthetic-case-check'});
    await api('/api/cases/storage/initialize', 'POST', {});
    const starting = await withCaseGoal(host, {operationId:randomUUID(), title:'营业日调查', description:'首版合成经营记录'});
    const c = (await api('/api/cases', 'POST', starting, 201)).case;
    const caseSource = {authority:'case' as const,id:c.id,version:c.revision};
    const marker = '门店记录-' + dependency + '-' + randomUUID();
    const isOperation=dependency.startsWith('operation'),lookup=randomUUID();
    const restricted = await adopt({source:caseSource, outcome:['selected Goal','operation Goal'].includes(dependency) ? marker : '依据第一版 Case'},dependency==='operation Goal'?lookup:randomUUID());
    const selected = dependency==='selected Goal' ? restricted : await adopt({title:'核准观察期'});
    if (dependency==='related Goal') {
      await api('/api/strategy/relations','POST',{from:selected,to:restricted,kind:'strategy',responsibility:'核准记录',rationale:marker,operationId:randomUUID()},201);
    }
    if (dependency==='Goal feedback' || dependency==='operation feedback') {
      await api('/api/strategy/feedback','POST',{goal:selected,level:'strategy',source:caseSource,note:marker,operationId:dependency==='operation feedback'?lookup:randomUUID()},201);
    }

    const discussionId=randomUUID(), discussion='/api/strategy/discussions/'+discussionId;
    await api('/api/strategy/discussions','POST',{operationId:discussionId,title:'核准营业日期',...(isOperation?{}:{goal:selected})},201);
    const strategicReply='原战略回执 '+marker;
    let sawOperation=false;
    provider.setResponder(turn=>{
      if(isOperation && !turn.recentToolResults.length)return {calls:[{name:'strategy_goals',arguments:{action:'operation',operationId:lookup}}]};
      if(isOperation){
        const returned=JSON.parse(providerMessageText(turn.recentToolResults.at(-1)?.content)).operation;
        assert.equal(returned.operationId,lookup);assert.equal(returned.result.source.id,c.id);
        assert.equal(returned.result.source.version,c.revision);assert.ok(JSON.stringify(returned.result).includes(marker));sawOperation=true;
      }
      return {text:strategicReply};
    });
    const strategicRequest=randomUUID();
    await api(discussion+'/messages','POST',{requestId:strategicRequest,text:'对照当时的目标依据',expectedRevision:1},202);
    const strategic=await completed(discussion,strategicRequest);
    assert.ok(isOperation?sawOperation:lastUserInput().includes(marker),'the actual strategy request must receive its recorded dependency');
    const reply=strategic.replies.find((r:{text:string})=>r.text===strategicReply);
    assert.ok(reply);
    const {version:saved}=await api(discussion+'/versions','POST',{expectedRevision:strategic.discussion.revision,source:reply.source,choice:'以原记录为准',
      options:'核查后再扩大',rationale:'先用观察窗检验',assumptions:'原记录完整',unknowns:'下一期表现'},201);
    const strategyVersion=discussion+'/versions/'+saved.version;
    await api(strategyVersion+'/handoff','POST',{expectedRevision:(await api(discussion)).discussion.revision});
    const {version:handed}=await api(strategyVersion);
    assert.equal(handed.version,1);assert.deepEqual(handed.source,reply.source);
    const derived=await adopt({title:'承接战略的目标',scope:handed.destination.scope,source:handed.source,
      strategyChoice:{discussionId,version:handed.version,contentSha256:handed.contentSha256}});

    const {project}=await api('/api/projects','POST',{name:'承接准确 GSA',goalOrigin:{goal:derived}},201);
    const form='/api/projects/'+project.id+'/tasks';
    const {task}=await api(form,'POST',{operationId:randomUUID(),name:'人工建立的核对任务',assignment:{type:'requirement',skill:null}},201);
    const taskRoute=form+'/'+task.id;
    const role='/api/business-role?owner='+encodeURIComponent(JSON.stringify({role:'project',projectId:project.id}));
    const caseRoute='/api/cases/'+c.id;
    async function link(enabled: boolean) {
      const revision=(await api(caseRoute)).case.revision;
      await api(caseRoute+'/projects'+(enabled?'':'/'+project.id),enabled?'POST':'DELETE',{operationId:randomUUID(),expectedRevision:revision,projectId:project.id});
    }
    async function assertDenied(route: string, method='GET', input?: unknown) {
      const response=await host.request(route,method,input);
      assert.ok([403,409].includes(response.status),method+' '+route+' returned '+response.status);
      const body=await response.json();assert.ok(!JSON.stringify(body).includes(marker));
    }
    async function assertNoDispatch(expectedRevision: number) {
      const before=provider.requests.length;
      await assertDenied(role+'&action=origin');
      await assertDenied(role+'&action=messages','POST',{requestId:randomUUID(),text:'核查本期',expectedRevision});
      await assertDenied(taskRoute+'/messages','POST',{requestId:randomUUID(),text:'核查本期'});
      assert.equal(provider.requests.length,before);
    }
    await assertNoDispatch(0);
    await link(true);
    const preview=await api(role+'&action=origin');
    assert.ok(JSON.stringify(preview.origin).includes(strategicReply));
    provider.setResponder(()=>({text:'已核定当时的目标来源。'}));
    const roleRequest=randomUUID();
    await api(role+'&action=messages','POST',{requestId:roleRequest,text:'项目需要核对哪条依据？',expectedRevision:0},202);
    const projectConversation=await completed(role,roleRequest);
    assert.ok(lastUserInput().includes(strategicReply));
    const taskRequest=randomUUID();
    await api(taskRoute+'/messages','POST',{requestId:taskRequest,text:'人工开始，从原文核对'},202);
    await completed(taskRoute,taskRequest);
    assert.ok(lastUserInput().includes(strategicReply));

    if(isOperation){
      const other=(await api('/api/projects','POST',{name:'同一目标的独立收件方',goalOrigin:{goal:derived}},201)).project;
      const otherRole='/api/business-role?owner='+encodeURIComponent(JSON.stringify({role:'project',projectId:other.id}));
      const otherForm='/api/projects/'+other.id+'/tasks';
      const otherTask=(await api(otherForm,'POST',{name:'人工核对',assignment:{type:'requirement',skill:null}},201)).task;
      const count=provider.requests.length;
      await assertDenied(otherRole+'&action=origin');
      await assertDenied(otherRole+'&action=messages','POST',{requestId:randomUUID(),text:'核对本地归属',expectedRevision:0});
      await assertDenied(otherForm+'/'+otherTask.id+'/messages','POST',{requestId:randomUUID(),text:'核对本地归属'});
      assert.equal(provider.requests.length,count);
      t.diagnostic(JSON.stringify({lookup,deniedProject:other.id,deniedTask:otherTask.id,deniedRequests:provider.requests.length-count}));
    }
    await link(false);
    await assertDenied(role);
    await assertDenied(taskRoute);
    await assertNoDispatch(projectConversation.discussion.revision);
    if(isOperation){
      await link(true);
      const restored=randomUUID();
      await api(taskRoute+'/messages','POST',{requestId:restored,text:'恢复后核对'},202);
      await completed(taskRoute,restored);assert.ok(lastUserInput().includes(strategicReply));
      assert.ok(JSON.stringify((await api(role+'&action=origin')).origin).includes(strategicReply));
      const renewed=randomUUID(),revision=(await api(role)).discussion.revision;
      await api(role+'&action=messages','POST',{requestId:renewed,expectedRevision:revision,text:'复核重新关联后的原据'},202);
      await completed(role,renewed);assert.ok(lastUserInput().includes(strategicReply));
    }
    const beforeExport=provider.requests.length;
    await api('/api/configuration','DELETE');
    assert.ok((await api(strategyVersion+'/export')).html.includes(strategicReply));
    assert.ok((await api(goals+'/'+derived.goalId+'/versions/1/export')).html.includes('承接战略的目标'));
    assert.equal(provider.requests.length,beforeExport);
    t.diagnostic(JSON.stringify({dependency,caseId:c.id,discussionId,strategyVersion:handed.version,goalId:derived.goalId,projectId:project.id,taskId:task.id,
      acceptedRequests:[strategicRequest,roleRequest,taskRequest],providerRequests:provider.requests.length}));
  });
}
