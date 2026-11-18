import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';

test('normal Host and Pi retain one issue from exact Plan and separate human authorization through board observation and Teach', { timeout: 90000 }, async t => {
  const evidence = path.resolve('.local/product-v13/case');
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(path.join(evidence,'cycle-')), dataRoot = path.join(root,'host'), projectsRoot = path.join(root,'projects');
  let host = await startTestHost({dataRoot,projectsRoot}); const provider = await startToolProvider();
  t.after(async () => { await host.close(); await provider.close(); });
  const call = async (route: string, method = 'GET', input?: unknown, status = 200) => {
    const response = await host.request(route, method, input), body = await response.json(); assert.equal(response.status, status, JSON.stringify({ route, body })); return body;
  };
  await call('/api/configuration','PUT',{ name:'合成',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'issue-cycle',apiKey:'synthetic-cycle' });
  const {project} = await call('/api/projects','POST',{ name:'两案共享项目' },201);
  await call('/api/cases/storage/initialize','POST',{});
  async function create(title: string) {
    const {case: record} = await call('/api/cases','POST',await withCaseGoal(host,{ operationId:randomUUID(), title }),201);
    await call('/api/cases/'+record.id+'/projects','POST',{ projectId:project.id,expectedRevision:1,operationId:randomUUID() });
    const path = '/api/cases/'+record.id+'/decisions/issues';
    const {issue} = await call(path,'POST',{ title:'是否扩大试点',expectedRevision:2,operationId:randomUUID() },201);
    return { record,issue,base:path+'/'+issue.id };
  }
  const a = await create('会员回访'), b = await create('另一独立经营问题');
  const taskPath = '/api/projects/'+project.id+'/tasks';
  async function run(type: 'teach'|'plan', text: string, choiceId?: string, feedbackRevisionId?:string,destinationProjectId=project.id) {
    const taskPath='/api/projects/'+destinationProjectId+'/tasks';
    provider.setResponder(() => ({text}));
    const {task} = await call(taskPath,'POST',{ name:type+'经营任务',assignment:{ type, skill:null, issue:{ caseId:a.record.id,issueId:a.issue.id,choiceId,feedbackRevisionId } } },201);
    await call(taskPath+'/'+task.id+'/messages','POST',{requestId:randomUUID(),text:'本次交付'},202);
    for (let i=0;i<240;i++) {
      const state = await call(taskPath+'/'+task.id);
      if (state.task.lastRun?.status === 'failed') assert.fail(JSON.stringify(state.task.lastRun));
      if (state.task.lastRun?.status === 'completed') break;
      await delay(100);
    }
    const sources = await call(a.base+'/sources');
    const found = sources.replies.find((r:any) => r.source.taskId === task.id); assert.ok(found, JSON.stringify(sources)); return found.source;
  }
  const plan = await run('plan','两店先试，店长回访，周五对照同店复购，若毛利下降则停止。');
  await call(b.base+'/plans','POST',{source:plan,operationId:randomUUID()},409);
  const {revision} = await call(a.base+'/plans','POST',{source:plan,operationId:randomUUID()});
  const rolePath='/api/business-role?owner='+encodeURIComponent(JSON.stringify({role:'case',caseId:a.record.id,itemId:a.issue.id}));
  async function askCase(text:string,expectedRevision:number) {
    provider.setResponder(()=>({text:'讨论事项已选准确资料。'}));
    await call(rolePath+'&action=messages','POST',{requestId:randomUUID(),expectedRevision,text},202);
    let state=await call(rolePath);
    for(let i=0;i<180&&state.busy;i++){await delay(30);state=await call(rolePath);}
    assert.equal(state.discussion.lastRun.status,'completed');
    const request=provider.requests.at(-1)!.body.messages!.filter(m=>m.role==='user').at(-1);
    assert.ok(request);return {state,prompt:providerMessageText(request.content)};
  }
  const candidateDiscussion=await askCase('比较这个事项交回的尚未取舍方案',0);
  assert.match(candidateDiscussion.prompt,/若毛利下降则停止/);
  const strategyRef = {type:'case-decision',caseId:a.record.id,caseStoreId:revision.caseStoreId,recordId:revision.recordId,revision:1};
  const choose = (choice:string, before:string|null) => call('/api/cases/'+a.record.id+'/decisions/'+revision.recordId+'/choice','POST',{caseStoreId:revision.caseStoreId,strategyRef,issueId:a.issue.id,choice,expectedPreviousChoiceId:before,reason:'先核试点范围',operationId:randomUUID()});
  const {choice} = await choose('trial',null);
  const command = { title:'两店回访',scope:'仅该两店本周',projectId:project.id,choiceId:choice.choiceId,operationId:randomUUID() };
  const {arrangement} = await call(a.base+'/authorize','POST',command);
  assert.deepEqual((await call(a.base+'/authorize','POST',command)).arrangement,arrangement);
  assert.equal(arrangement.caseConfirmation.issueId,a.issue.id);
  assert.equal(arrangement.quoteProvenance,undefined);
  const action = arrangement.actions[0];
  const pendingTeach = await run('teach','观察期复购持平，保留原假设并缩小下一轮范围。',choice.choiceId);
  const decisionBody = { expectedRevision:4,choiceId:choice.choiceId,source:pendingTeach,observation:'两店试点观察期复购持平',judgement:'原判断尚未证实',nextStep:'下期比较同店',operationId:randomUUID() };
  await call(a.base+'/review','POST',decisionBody,409);
  const {feedback} = await call('/api/decision-board/tasks/'+action.taskId+'/feedback','POST',{operationId:randomUUID(),expectedLatestRevisionId:null,adopted:true,outcome:'两店完成回访',metricDelta:'0',review:'未改善',score:null,effect:'none'});
  const laterFeedback=(await call('/api/decision-board/tasks/'+action.taskId+'/feedback','POST',{operationId:randomUUID(),expectedLatestRevisionId:feedback.revisionId,adopted:false,outcome:'后续不同采样的观察',metricDelta:'-2',review:'负变化',score:null,effect:'negative'})).feedback;
  const foreignFeedback = await host.request(taskPath,'POST',{name:'错配反馈',assignment:{type:'teach',skill:null,issue:{caseId:b.record.id,issueId:b.issue.id,choiceId:choice.choiceId,feedbackRevisionId:feedback.revisionId}}});
  assert.ok([403,404,409].includes(foreignFeedback.status));
  await call(taskPath,'POST',{name:'错配版本',assignment:{type:'teach',skill:null,issue:{caseId:a.record.id,issueId:a.issue.id,choiceId:choice.choiceId,feedbackRevisionId:randomUUID()}}},409);
  const teach = await run('teach','复盘原看板的实际观察后，原假设有待继续验证。',choice.choiceId,feedback.revisionId);
  const frozenTeachRequest = provider.requests.at(-1)!.body.messages!.filter(m => m.role === 'user').map(m=>providerMessageText(m.content)).join(' ');
  assert.ok(!frozenTeachRequest.includes(laterFeedback.revisionId)); assert.ok(!frozenTeachRequest.includes('后续不同采样的观察'));
  await call(a.base+'/review','POST',{...decisionBody,source:teach,feedbackRevisionId:laterFeedback.revisionId},409);
  await call(a.base+'/review','POST',{...decisionBody,source:teach,feedbackRevisionId:feedback.revisionId});
  const scoped = (caseId:string,issueId:string,projectId=project.id) => '/api/business-role?owner=' + encodeURIComponent(JSON.stringify({role:'project',projectId,issue:{caseId,issueId}}));
  const scopeA = scoped(a.record.id,a.issue.id), scopeB = scoped(b.record.id,b.issue.id);
  await call(scoped(a.record.id,b.issue.id),'GET',undefined,404);
  assert.equal((await call(scopeB)).discussion,null);
  let delivered = false;
  provider.setResponder(turn => {
    const reads=turn.recentToolResults.map(row=>providerMessageText(row.content));
    if(!reads.length)return {calls:[{name:'strategy_goals',arguments:{action:'find-sources',query:'经营任务'}}]};
    const rows=JSON.parse(reads[0]).sources;
    const allowedPlan=rows.find((r:any)=>r.target.taskId===plan.taskId);
    const allowedTeach=rows.find((r:any)=>r.target.taskId===pendingTeach.taskId);
    assert.ok(allowedPlan);assert.ok(allowedTeach);
    if(reads.length===1)return {calls:[{name:'strategy_goals',arguments:{action:'read-source',sourceId:allowedPlan.id}}]};
    if(reads.length===2)return {calls:[{name:'strategy_goals',arguments:{action:'read-source',sourceId:allowedTeach.id}}]};
    assert.match(reads[1],/若毛利下降则停止/);assert.match(reads[2],/保留原假设/);delivered=true;return {text:'已综合该事项准确方案与反馈。'};
  });
  await call(scopeA+'&action=messages','POST',{text:'综合该事项方案和阶段反馈',requestId:randomUUID(),expectedRevision:0},202);
  for(let i=0;i<250;i++){const value=await call(scopeA);if(!value.busy&&value.discussion?.lastRun?.status==='completed')break;await delay(30);}
  assert.equal(delivered,true);
  assert.equal((await call(scopeB)).discussion,null);
  const general='/api/business-role?owner='+encodeURIComponent(JSON.stringify({role:'project',projectId:project.id}));
  assert.equal((await call(general)).discussion,null);
  async function assertScopeExcludesPlanAndTeach(scope: string) {
    let separated=false;
    provider.setResponder(turn=>{
    if(!turn.recentToolResults.length)return {calls:[{name:'strategy_goals',arguments:{action:'find-sources',query:'经营任务'}}]};
    const rows=JSON.parse(providerMessageText(turn.recentToolResults[0].content)).sources;
    assert.ok(!rows.some((row:any)=>[plan.taskId,pendingTeach.taskId].includes(row.target.taskId)));separated=true;return {text:'当前事项没有这些原件。'};
    });
    await call(scope+'&action=messages','POST',{text:'核对本事项是否有方案成果',requestId:randomUUID(),expectedRevision:0},202);
    for(let i=0;i<250;i++){const value=await call(scope);if(!value.busy&&value.discussion?.lastRun?.status==='completed')break;await delay(30);}
    assert.equal(separated,true);
  }
  await assertScopeExcludesPlanAndTeach(scopeB);
  const {choice: deferred} = await choose('defer',choice.choiceId);
  const laterTeach = await run('teach','暂缓后观察到来店人数持平，待扩大样本再核。',deferred.choiceId);
  await call(a.base+'/review','POST',{ ...decisionBody, source:laterTeach, choiceId:deferred.choiceId, expectedRevision:6,observation:'暂缓后客流持平',operationId:randomUUID() });
  await host.close(); host = await startTestHost({ dataRoot,projectsRoot });
  const view = await call(a.base); assert.equal(view.rounds.length,2); assert.equal(view.rounds[0].actions[0].feedback[0].effect,'none'); assert.deepEqual(view.rounds[0].review.reply,teach);
  assert.deepEqual(view.rounds[1].review.reply,laterTeach); assert.equal(view.rounds[1].actions.length,0); assert.equal((await call(b.base)).rounds.length,0);
  const {choice: stopped} = await choose('no_action',deferred.choiceId);
  const finalTeach = await run('teach','此轮不行动。两店观察期来店持平，保留现状并结束复盘。',stopped.choiceId);
  const finalReview = {...decisionBody,choiceId:stopped.choiceId,source:finalTeach,operationId:randomUUID(),expectedRevision:(await call('/api/cases/'+a.record.id)).case.revision};
  await call(a.base+'/review','POST',{...finalReview,observation:''},400);
  await call(a.base+'/review','POST',{...finalReview,observation:'两店来店人数持平',nextStep:'结束本轮观察'});
  const end = (await call(a.base)).rounds.at(-1);
  assert.equal(end.review.reply.messageId,finalTeach.messageId); assert.equal(end.actions.length,0);
  const {issue:sibling}=await call('/api/cases/'+a.record.id+'/decisions/issues','POST',{title:'同 Case 的其他事项',expectedRevision:(await call('/api/cases/'+a.record.id)).case.revision,operationId:randomUUID()},201);
  await assertScopeExcludesPlanAndTeach(scoped(a.record.id,sibling.id));
  const origin = {kind:'task', projectId:project.id,taskId:plan.taskId,reply:plan};
  const newCase = await withCaseGoal(host,{operationId:randomUUID(),title:'从原任务承接的独立问题',creationSource:origin});
  const {case:child} = await call('/api/cases','POST',newCase,201);
  assert.deepEqual((await call('/api/cases/'+child.id)).creationSource,origin);
  assert.match((await call('/api/cases/'+child.id+'/origin/reply')).text,/两店先试/);
  const sameGoal = (await call('/api/cases/'+a.record.id)).goalBinding.primary.goalId;
  const otherGoal = (await call('/api/cases/'+b.record.id)).goalBinding.primary.goalId;
  const v1 = '/api/strategy/goals/'+sameGoal+'/versions/1';
  const v2 = '/api/strategy/goals/'+sameGoal+'/versions/2';
  assert.equal((await call(v1+'/arrangements')).arrangements[0].caseConfirmation.goal.strategy, '核对本次议题的原资料');
  assert.match((await call(v1+'/export')).html, new RegExp(action.taskId));
  assert.doesNotMatch((await call('/api/strategy/goals/'+otherGoal+'/versions/1/export')).html,new RegExp(action.taskId));
  const {title,perspective,scope,measurement,baseline,responsible,strategies} = (await call('/api/strategy/goals/'+sameGoal)).goal.versions[0];
  await call('/api/strategy/goals/'+sameGoal+'/revisions','POST',{operationId:randomUUID(),expectedVersion:1,title,perspective,scope,measurement,baseline,responsible,strategies,outcome:'仅复核下一季度的门店'},201);
  assert.deepEqual((await call(v2+'/arrangements')).arrangements,[]);
  assert.doesNotMatch((await call(v2+'/export')).html,new RegExp(action.taskId));
  assert.match((await call(a.base+'/reply','POST',plan)).text,/两店先试/);
  await call(b.base+'/reply','POST',plan,409);
  const {project:auxiliary}=await call('/api/projects','POST',{name:'负责复盘的另一个关联项目'},201);
  await call('/api/cases/'+a.record.id+'/projects','POST',{projectId:auxiliary.id,operationId:randomUUID(),expectedRevision:(await call('/api/cases/'+a.record.id)).case.revision});
  const auxiliaryTeach=await run('teach','从另一已关联项目复核原选择的观察。',choice.choiceId,feedback.revisionId,auxiliary.id);
  const auxiliaryPrompt=provider.requests.at(-1)!.body.messages!.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).join(' ');
  assert.ok(auxiliaryPrompt.includes(feedback.revisionId)&&auxiliaryPrompt.includes('若毛利下降则停止'), 'linked recipient received the same precise Plan and feedback');
  const {state:roleState,prompt:frozenCaseRequest} = await askCase('核对本事项经营判断',candidateDiscussion.state.discussion.revision);
  const expected = [
    ['Teach 原方案',frozenTeachRequest,'若毛利下降则停止'],['Teach 原看板',frozenTeachRequest,'两店完成回访'],
    ['Teach 准确反馈版',frozenTeachRequest,feedback.revisionId],['Teach 本轮授权',frozenTeachRequest,action.authorizationId],
    ['Case 原方案',frozenCaseRequest,'若毛利下降则停止'],['Case 原方案版',frozenCaseRequest,revision.recordId],
    ['Case 原 Teach',frozenCaseRequest,'复盘原看板的实际观察后'],['Case Teach 准确版',frozenCaseRequest,teach.expectedTextSha256],
    ['Case 历次取舍',frozenCaseRequest,stopped.choiceId],
  ];
  assert.deepEqual(expected.filter(([,actual,marker])=>!actual.includes(marker)).map(([name])=>name),[]);
  const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
  await writeFile(path.join(root,'case-role-teach-receipt.json'),JSON.stringify({caseId:a.record.id,issueId:a.issue.id,choiceId:choice.choiceId,
    proposal:strategyRef,plan,teach,selectedFeedback:feedback.revisionId,excludedFeedback:laterFeedback.revisionId,boardAuthorization:action.authorizationId,
    caseSession:roleState.snapshot.sessionId,caseRequest:roleState.requestReceipt?.requestId,casePromptSha256:digest(frozenCaseRequest),
    teachPromptSha256:digest(frozenTeachRequest),verified:expected.map(([name,,marker])=>({name,marker})),roleProvider:'local protocol fixture'},null,2));
  const providerCount=provider.requests.length;
  await call('/api/cases/'+a.record.id+'/projects/'+project.id,'DELETE',{expectedRevision:(await call('/api/cases/'+a.record.id)).case.revision,operationId:randomUUID()});
  const deniedRead=await host.request(rolePath),deniedSend=await host.request(rolePath+'&action=messages','POST',{requestId:randomUUID(),expectedRevision:roleState.discussion.revision,text:'重新发送旧上下文'});
  assert.ok([403,409].includes(deniedRead.status));assert.ok([403,409].includes(deniedSend.status));
  assert.ok([403,409].includes((await host.request(taskPath+'/'+teach.taskId+'/messages','POST',{requestId:randomUUID(),text:'继续复盘原反馈'})).status));
  assert.ok([403,409].includes((await host.request('/api/projects/'+auxiliary.id+'/tasks/'+auxiliaryTeach.taskId+'/messages','POST',{requestId:randomUUID(),text:'继续分析之前收过的原计划'})).status));
  assert.equal(provider.requests.length,providerCount);
  await call(a.base+'/reply','POST',plan,409);
  await call(v1+'/export','GET',undefined,409);
  await call(v1+'/arrangements','GET',undefined,409);
  assert.deepEqual((await call(v2+'/arrangements')).arrangements,[]);
  await call('/api/cases/'+a.record.id+'/projects','POST',{projectId:project.id,expectedRevision:(await call('/api/cases/'+a.record.id)).case.revision,operationId:randomUUID()});
  assert.equal((await call(v1+'/arrangements')).arrangements[0].actions[0].authorizationId,action.authorizationId);
  t.diagnostic(root);
});
