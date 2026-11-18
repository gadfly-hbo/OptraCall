// Run with node --test tests/browser-pm-task-rounds.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {providerMessageText} from './fixtures/tool-provider.ts';
import {startTaskRounds} from './fixtures/pm-task-rounds.ts';

async function browserRounds(t) {
  const uiPort = Number(process.env.OPTRACALL_PM2_ROUNDS_PORT || 4397), f = await startTaskRounds(t,uiPort);
  const ui = spawn(process.execPath,['scripts/frontend.mjs','dev','--port',String(uiPort),'--strictPort'],{stdio:['ignore','pipe','pipe'],env:{...process.env,OPTRACALL_HOST_PORT:String(f.host.port)}});
  t.after(()=>ui.kill('SIGTERM'));
  await new Promise((resolve,reject)=>{ui.stdout.on('data',buf=>{if(buf.toString().includes(':'+uiPort+'/'))resolve()});ui.once('exit',c=>reject(Error('UI exit '+c)));});
  const browser=await chromium.launch({channel:'chrome',headless:true}); t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1480,height:1010}});page.setDefaultTimeout(6500);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  t.after(()=>assert.deepEqual(errors,[]));
  const base='http://127.0.0.1:'+uiPort, taskDialog=page.getByRole('dialog',{name:'新建任务'}), work=page.locator('.case-issue-work');
  async function openCase(){
    await page.goto(base);
    await page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button',{name:'决策星图',exact:true}).click();
    const board=page.locator('.case-board');
    await board.getByRole('button',{name:'常规',exact:true}).click();await board.getByRole('button',{name:'门店经营观察',exact:true}).click();
    await work.getByText('历次取舍与实际反馈',{exact:true}).waitFor();
  }
  async function createAndSend(name,text) {
    const received=page.waitForResponse(r=>new URL(r.url()).pathname===f.taskPath && r.request().method()==='POST');
    await taskDialog.getByLabel('任务名称').fill(name);await taskDialog.getByRole('button',{name:'创建任务',exact:true}).click();
    const saved=await received;assert.equal(saved.status(),201,await saved.text());const {task}=await saved.json();
    const composer=page.getByRole('form',{name:'发送消息'});
    f.provider.setResponder(()=>({text}));
    await composer.getByRole('textbox',{name:'消息',exact:true}).fill('接收本次委托');
    const started=page.waitForResponse(r=>new URL(r.url()).pathname===f.taskPath+'/'+task.id+'/messages');
    await composer.getByRole('button',{name:'发送消息'}).click();const accepted=await started;assert.equal(accepted.status(),202);
    await page.getByText(text,{exact:true}).first().waitFor();
    return {task,prompt:f.prompt(),requestId:accepted.request().postDataJSON().requestId};
  }
  return {...f,page,base,work,taskDialog,openCase,createAndSend};
}

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
  async function record(text,command) {
    await f.send(operator.id,text,turn=>{
      if(!turn.recentToolResults.length)return {calls:[{name:'record_user_decision',arguments:{action:'read'}}]};
      const actual=JSON.parse(providerMessageText(turn.recentToolResults.at(-1).content));
      if(actual.type==='optracall.quoted-decision-read')return {calls:[{name:'record_user_decision',arguments:{
        strategyRef:b.strategyRef,choiceId:b.choiceId,quote:{start:0,end:text.length,text},...command(actual)}}]};
      assert.equal(actual.status,'completed',JSON.stringify(actual));return {text:'已登记授权状态'};
    });
  }
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
  const b=await f.choose('随后乙',a.choiceId), savedB=(await f.api(f.issuePath)).rounds.at(-1);
  await f.openCase();
  const row=f.work.locator('article').filter({hasText:'先行甲取舍理由'});
  const next=f.work.locator('article').filter({hasText:'随后乙取舍理由'});
  await row.getByRole('button',{name:'按此观察准备 Teach'}).click();
  const {task,prompt,requestId}=await f.createAndSend('迟到的甲店复盘','迟到的甲店复盘原文');
  assert.equal(task.assignment.issue.choiceId,a.choiceId);assert.equal(task.assignment.issue.feedbackRevisionId,observed.revisionId);
  for(const marker of ['先行甲方案原文','甲店原观察',observed.revisionId])assert.ok(prompt.includes(marker),marker);
  assert.ok(!prompt.includes('随后乙方案原文'));
  await f.openCase();
  await row.getByText('本轮复盘',{exact:true}).click();
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
    assert.ok(!message.includes('随后乙方案原文'));actual.push({role,requestId:(await sending).postDataJSON().requestId,choiceId:a.choiceId,messageId:body.review.reply.messageId,feedbackRevisionId:observed.revisionId,checkedText:['迟到的甲店复盘原文','甲店原观察']});
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
  t.diagnostic(JSON.stringify({owner:f.owner,oldChoice:a.choiceId,newChoice:b.choiceId,taskId:task.id,requestId,reviewOperation:body.review.operationId,duplicateReadback:200,missingObservation:waiting.code,closedNewReview:409,actual}));
});
