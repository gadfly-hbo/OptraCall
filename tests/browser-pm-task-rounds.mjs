// Run with node --test tests/browser-pm-task-rounds.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {browserRounds} from './fixtures/browser-task-rounds.mjs';

test('Chrome hands over the unique current action from the project Decision and asks only for ambiguous action',async t=>{
  const f=await browserRounds(t);
  const decision=await f.create('decision','操作中的决策 Task',f.owner);
  await f.send(decision.id,'记录待定取舍','项目内决策回复');
  const a=await f.choose('旧甲'),b=await f.choose('新乙',a.choiceId);
  async function handoff(){
    await f.page.goto(f.base+'/?project='+f.project.id+'&task='+decision.id);
    const drawer=f.page.locator('details.harness-panel').filter({hasText:'交接与依据'});
    await drawer.locator('summary').click();await drawer.getByRole('button',{name:'交给下一 Task'}).click();
    await drawer.getByRole('checkbox',{name:/原会话回复/}).first().check();await drawer.getByRole('button',{name:'核对输入并新建 Task'}).click();
    assert.equal(await f.taskDialog.getByLabel('Task 类型').inputValue(),'do');
  }
  await handoff();
  await f.taskDialog.getByText(/尚无.*行动授权/).waitFor();
  assert.equal(await f.taskDialog.getByRole('button',{name:'创建任务'}).isDisabled(),true);
  await f.taskDialog.getByRole('button',{name:'取消',exact:true}).click();
  const auth=await f.authorize(b.choiceId,'乙店'),count=f.provider.requests.length;
  await handoff();
  await f.taskDialog.getByText(/乙店授权范围/).waitFor();
  assert.equal(await f.taskDialog.getByLabel('选择已授权行动').count(),0);
  const {task,prompt,requestId}=await f.createAndSend('唯一行动交接','实收乙店授权');
  assert.deepEqual(task.assignment.issue,{...f.owner,choiceId:b.choiceId,authorizationId:auth.authorizationId});
  for(const part of [b.choiceId,b.source.messageId,'新乙方案原文','新乙取舍理由','乙店授权范围'])assert.ok(prompt.includes(part),part);
  assert.ok(!prompt.includes('旧甲方案原文'));assert.equal(f.provider.requests.length,count+1);
  const operator=await f.create('decision','登记行动授权',f.owner);
  const record=(text,command)=>f.recordDecision(operator.id,b,text,command);
  await record('请另行授权乙店外场核对。',()=>({action:'arrange-actions',title:'乙店外场',scope:'乙店外场授权范围',checks:[],actions:[{kind:'create',title:'乙店外场核对'}]}));
  const alternate=(await f.api(f.issuePath)).rounds.at(-1).actions.find(a=>a.title==='乙店外场核对');
  const alternateId=alternate.currentAuthorizationId;
  await handoff();const selector=f.taskDialog.getByLabel('选择已授权行动');
  await selector.waitFor();assert.equal(await selector.inputValue(),'');
  assert.equal(await f.taskDialog.getByRole('button',{name:'创建任务'}).isDisabled(),true);
  await selector.selectOption(alternateId);
  if(process.env.OPTRACALL_PM2_RECEIPTS)await f.taskDialog.screenshot({path:path.join(process.env.OPTRACALL_PM2_RECEIPTS,'choose-authorized-action.png')});
  const chosen=await f.createAndSend('选择外场','实收选定的外场授权');
  assert.equal(chosen.task.assignment.issue.authorizationId,alternateId);
  assert.ok(chosen.prompt.includes('乙店外场授权范围'));assert.ok(!chosen.prompt.includes('乙店授权范围'));
  await handoff();await selector.selectOption(alternateId);
  for(const action of [alternate,auth]) {
    await record('撤回这项指定的乙店行动授权。',read=>{
      const row=read.actions.find(a=>a.task.id===action.taskId);
      return {action:'authorize-action',decision:'revoke',itemId:row.item.id,taskId:row.task.id,itemVersion:row.itemVersion,taskVersion:row.taskVersion,
        expectedPreviousAuthorizationId:row.authorizations.at(-1).authorizationId,scope:'撤回原授权'};
    });
  }
  const beforeRevoked=f.provider.requests.length;
  await f.taskDialog.getByLabel('任务名称').fill('撤回后不能新增');
  const post=f.page.waitForResponse(r=>new URL(r.url()).pathname===f.taskPath&&r.request().method()==='POST');
  await f.taskDialog.getByRole('button',{name:'创建任务'}).click();assert.equal((await post).status(),409);
  await f.taskDialog.getByRole('alert').waitFor();assert.equal(await f.taskDialog.getByLabel('任务名称').inputValue(),'撤回后不能新增');
  assert.equal(f.provider.requests.length,beforeRevoked);
  await f.taskDialog.getByRole('button',{name:'取消',exact:true}).click();
  await handoff();await f.taskDialog.getByText(/授权已撤回/).waitFor();
  assert.equal(await f.taskDialog.getByRole('button',{name:'创建任务'}).isDisabled(),true);
  t.diagnostic(JSON.stringify({caseId:f.owner.caseId,issueId:f.owner.issueId,choiceId:b.choiceId,decisionId:decision.id,single:{task:task.id,requestId,checkedSources:[b.source.messageId,'新乙方案原文','新乙取舍理由','乙店授权范围']},selected:{task:chosen.task.id,requestId:chosen.requestId,scope:'乙店外场授权范围'},authorizations:[auth.authorizationId,alternateId],afterRevoke:{status:409,providerDelta:f.provider.requests.length-beforeRevoked}}));
});

test('Chrome returns a late Teach to the old observed round and its two upstreams with the newer round intact',async t=>{
  const f=await browserRounds(t);
  const a=await f.choose('先行甲'),action=await f.authorize(a.choiceId,'甲店');
  const observed=await f.observe(action.taskId,'甲店');
  const decision=await f.create('decision','改变授权范围',f.owner), later='观察后扩至四十店',other='同一轮的另一行动范围';
  await f.recordDecision(decision.id,a,'原单店观察已归档，扩至四十店核查。',read=>{
    const row=read.actions.find(entry=>entry.task.id===action.taskId);
    return {action:'authorize-action',decision:'authorize',itemId:row.item.id,taskId:row.task.id,itemVersion:row.itemVersion,
      taskVersion:row.taskVersion,expectedPreviousAuthorizationId:action.authorizationId,scope:later};
  });
  const subsequent=(await f.api('/api/decision-board/tasks/'+action.taskId+'/feedback','POST',{operationId:randomUUID(),expectedLatestRevisionId:observed.revisionId,
    adopted:true,outcome:'全市后续观察',metricDelta:'2',review:'另核全市',score:null,effect:'none'})).feedback;
  await f.recordDecision(decision.id,a,'另行授权外场核查。',()=>({action:'arrange-actions',title:'外场',scope:other,checks:[],actions:[{kind:'create',title:'外场行动'}]}));
  const extra=(await f.api(f.issuePath)).rounds.at(-1).actions.find(act=>act.title==='外场行动');
  const extraFeedback=await f.observe(extra.taskId,'外场');
  const excluded=[later,other,subsequent.revisionId,extraFeedback.revisionId,extra.taskId,'随后乙方案原文'];
  const b=await f.choose('随后乙',a.choiceId), savedB=(await f.api(f.issuePath)).rounds.at(-1);
  await f.openCase();
  const row=f.work.locator('article').filter({hasText:'先行甲取舍理由'});
  const next=f.work.locator('article').filter({hasText:'随后乙取舍理由'});
  const original=row.locator('p').filter({hasText:'甲店原观察'}).filter({has:f.page.getByRole('button',{name:'按此观察准备 Teach'})});
  await original.getByRole('button',{name:'按此观察准备 Teach'}).click();
  const {task,prompt,requestId}=await f.createAndSend('迟到的甲店复盘','迟到的甲店复盘原文');
  assert.equal(task.assignment.issue.choiceId,a.choiceId);assert.equal(task.assignment.issue.feedbackRevisionId,observed.revisionId);
  for(const marker of ['先行甲方案原文','甲店原观察','甲店授权范围',action.authorizationId,observed.revisionId])assert.ok(prompt.includes(marker),marker);
  for(const marker of excluded)assert.ok(!prompt.includes(marker),marker);
  await f.openCase();
  await row.getByText('本轮复盘',{exact:true}).click();
  await original.getByText('观察时授权范围 · 甲店授权范围',{exact:true}).waitFor();
  await row.getByLabel('原看板观察').selectOption(observed.revisionId);
  const source=row.getByLabel('准确 Teach 原回复');
  const value=await source.locator('option').filter({hasText:'迟到的甲店复盘'}).getAttribute('value');
  await source.selectOption(value);
  await row.getByLabel('实际观察').fill('已核甲店原观察');await row.getByLabel('原判断怎样保留或修订').fill('原判断仍待核');
  await row.getByLabel('下一步或结束理由').fill('提交两边复核');
  const response=f.page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===f.issuePath+'/review');
  await row.getByRole('button',{name:'保存本轮复盘'}).click();
  const saved=await response, command=saved.request().postDataJSON(), body=await saved.json();assert.equal(saved.status(),200,JSON.stringify(body));
  assert.equal(body.review.choiceId,a.choiceId);assert.equal(body.review.reply.taskId,task.id);assert.equal(body.review.feedback.feedbackRevisionId,observed.revisionId);
  assert.deepEqual((await f.api(f.issuePath+'/review','POST',command)).review,body.review);
  await row.getByText('复盘判断 · 原判断仍待核',{exact:true}).waitFor();
  assert.equal(await next.getByRole('button',{name:'按此观察准备 Teach'}).count(),0);
  assert.equal(await next.getByRole('button',{name:'保存本轮复盘'}).count(),0);
  const actual=[];
  for(const [role,button] of [['goal','提交策略复核'],['strategy','提交战略假设复核']]){
    await row.getByRole('button',{name:button}).click();const panel=f.page.locator('.strategy-discussion-panel');
    f.provider.setResponder(()=>({text:'上游收到甲店复盘-'+role}));
    const sending=f.page.waitForRequest(r=>r.method()==='POST'&&r.postDataJSON()?.text==='核对原观察和复盘');
    await panel.getByRole('textbox').fill('核对原观察和复盘');await panel.getByRole('button',{name:'发送',exact:true}).click();
    await panel.getByText('上游收到甲店复盘-'+role,{exact:true}).first().waitFor();
    const message=f.prompt();for(const m of [a.choiceId,observed.revisionId,body.review.reply.messageId,'迟到的甲店复盘原文','甲店原观察'])assert.ok(message.includes(m),m);
    for(const m of excluded)assert.ok(!message.includes(m),m);assert.ok(message.includes(action.authorizationId));
    const display=f.page.locator('main');await display.getByText('观察时授权范围 · 甲店授权范围',{exact:true}).waitFor();assert.ok(!(await display.innerText()).includes(later));actual.push({role,requestId:(await sending).postDataJSON().requestId,choiceId:a.choiceId,messageId:body.review.reply.messageId,feedbackRevisionId:observed.revisionId,checkedText:['迟到的甲店复盘原文','甲店原观察']});
    await f.page.getByRole('button',{name:'返回原事项'}).click();await row.getByText('复盘判断 · 原判断仍待核',{exact:true}).waitFor();
  }
  assert.deepEqual((await f.api(f.issuePath)).rounds.at(-1),savedB);
  if(process.env.OPTRACALL_PM2_RECEIPTS)await row.screenshot({path:path.join(process.env.OPTRACALL_PM2_RECEIPTS,'original-round-review.png')});
  const already=await f.api(f.issuePath+'/review','POST',{...command,operationId:randomUUID(),expectedRevision:await f.revision()},409);
  assert.equal(already.code,'case_round_already_reviewed');
  const early=await f.create('teach','乙店等待观察',{...f.owner,choiceId:b.choiceId});
  await f.send(early.id,'核对缺少的信息','仍在等乙店观察');
  const earlyReply=(await f.api(f.issuePath+'/sources')).replies.find(r=>r.source.taskId===early.id).source;
  const waiting=await f.api(f.issuePath+'/review','POST',{operationId:randomUUID(),expectedRevision:await f.revision(),choiceId:b.choiceId,
    source:earlyReply,observation:'现场尚未反馈',judgement:'缺观察',nextStep:'等到观察再复盘'},409);
  assert.equal(waiting.code,'case_round_waiting_for_feedback');
  await f.api(f.casePath+'/close','POST',{operationId:randomUUID(),expectedRevision:await f.revision(),reason:'已核对原轮次'});
  await f.api(f.issuePath+'/review','POST',{...command,operationId:randomUUID(),expectedRevision:await f.revision()},409);
  assert.deepEqual((await f.api(f.issuePath)).rounds.at(-1),savedB);
  t.diagnostic(JSON.stringify({owner:f.owner,oldChoice:a.choiceId,newChoice:b.choiceId,taskId:task.id,requestId,reviewOperation:body.review.operationId,duplicateReadback:200,missingObservation:waiting.code,closedNewReview:409,originalAuthorization:action.authorizationId,omittedFromThreeRecipients:excluded,actual}));
});
