// Explicit Chrome regression for historical Case choices that took no action.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {browserRounds} from './fixtures/browser-task-rounds.mjs';

for(const [index,scenario] of [
  {decision:'defer',label:'暂缓',observation:'一周后两店会员召回到店率持平',assessment:'未见改善'},
  {decision:'no_action',label:'本次不行动',observation:'两店会员召回的外部观察窗口尚未结束',assessment:'效果未知'}
].entries()) test('Chrome starts a late Teach on the historical '+scenario.decision+' choice without a Board action',async t=>{
  const directory=process.env.OPTRACALL_PM3_EVIDENCE;
  let root;
  if(directory) {
    await mkdir(directory,{recursive:true});
    root=await mkdtemp(path.join(path.resolve(directory),scenario.decision+'-'));
    t.diagnostic(root);
  }
  const f=await browserRounds(t,Number(process.env.OPTRACALL_PM3_PORT||4821)+index,
    root ? {dataRoot:path.join(root,'host'),projectsRoot:path.join(root,'projects')} : undefined,'会员召回');
  const a=await f.choose('甲案'+scenario.label,null,scenario.decision);
  const b=await f.choose('乙案另行试点',a.choiceId);
  const action=await f.authorize(b.choiceId,'乙案专项'),observation=await f.observe(action.taskId,'乙案实测');
  const bt=await f.create('teach','乙案既有复盘',{...f.owner,choiceId:b.choiceId,feedbackRevisionId:observation.revisionId});
  await f.send(bt.id,'复核乙案已有看板观察','乙案原复盘');
  const bs=(await f.api(f.issuePath+'/sources')).replies.find(r=>r.source.taskId===bt.id).source;
  await f.api(f.issuePath+'/review','POST',{operationId:randomUUID(),expectedRevision:await f.revision(),choiceId:b.choiceId,
    source:bs,feedbackRevisionId:observation.revisionId,observation:'乙案原看板观察',judgement:'乙案原判断',nextStep:'乙案结轮'});
  const timeline=async()=>(await f.api(f.issuePath)).rounds;
  const board=()=>f.api('/api/decision-board');
  const originalBoard=await board();
  const before=await timeline(),tasks=async()=>(await f.api('/api/projects/'+f.project.id)).project.tasks;
  assert.equal(before[0].review,null);assert.deepEqual(before[0].actions,[]);
  const baselineTasks=await tasks(),caseRevision=await f.revision(),initialSends=f.provider.requests.length;
  assert.ok(!baselineTasks.some(task=>task.assignment?.type==='teach'&&task.assignment.issue?.choiceId===a.choiceId));
  await f.openCase();
  await f.work.locator('h4').filter({hasText:scenario.label}).waitFor();
  const old=f.work.locator('article').filter({hasText:'甲案'+scenario.label+'取舍理由'});
  await old.getByText('等待本轮实际观察',{exact:false}).first().waitFor();
  await old.getByText('本轮复盘',{exact:true}).click();
  const select=old.getByLabel('准确 Teach 原回复');
  assert.equal(await select.locator('option[value=""]').count(),1);
  assert.equal(await select.locator('option').count(),1);
  assert.equal(await old.getByRole('button',{name:'保存本轮复盘'}).isDisabled(),true);
  const prepare=old.getByRole('button',{name:'按本轮取舍准备 Teach',exact:true});
  const rowButtons=await old.getByRole('button').allTextContents();
  if(root) await old.screenshot({path:path.join(root,'original-choice.png')});
  await f.work.getByRole('button',{name:'准备 Teach Task',exact:true}).click();
  const generic=await f.taskDialog.innerText();
  assert.ok(generic.includes(b.choiceId));assert.ok(!generic.includes(a.choiceId));
  const editable=await f.taskDialog.getByRole('combobox').evaluateAll(items=>items.map(item=>[...item.options].map(o=>o.textContent)));
  assert.ok(!editable.flat().some(text=>text.includes(a.choiceId)));
  if(root) await f.taskDialog.screenshot({path:path.join(root,'generic-bound-to-B.png')});
  await f.taskDialog.getByRole('button',{name:'取消',exact:true}).click();
  await f.work.getByRole('button',{name:'回关联项目协作'}).click();
  await f.page.getByRole('region',{name:'项目协作'}).getByRole('button',{name:'新建任务',exact:true}).click();
  await f.taskDialog.getByLabel('Task 类型').selectOption('teach');
  const projectForm=await f.taskDialog.innerText();
  assert.ok(projectForm.includes(f.owner.issueId));
  assert.ok(!projectForm.includes(a.choiceId) && !projectForm.includes(b.choiceId));
  await f.taskDialog.getByRole('button',{name:'取消',exact:true}).click();
  await f.openCase();
  await old.waitFor();
  const initial={projectForm,issueTitle:'会员召回',decision:scenario.decision,owner:f.owner,caseProject:f.project.id,oldChoice:a.choiceId,currentChoice:b.choiceId,
    originalPlan:a.strategyRef,originalPlanReply:a.source.messageId,oldRoundVisibleButtons:rowButtons,usableHistoricalEntry:await prepare.count(),
    existingOldTeachReplies:0,oldBoardActions:0,genericDialog:generic,genericEditableOptions:editable,protectedCurrentReview:before[1].review.operationId};
  if(root) await writeFile(path.join(root,'initial.json'),JSON.stringify(initial,null,2));
  assert.equal(await prepare.count(),1,'原轮缺少准确 Teach 入口，通用表单绑定当前 B');
  await prepare.click();assert.equal(await f.taskDialog.getByLabel('Task 类型').inputValue(),'teach');
  const oldForm=await f.taskDialog.innerText();for(const mark of [a.choiceId,'会员召回',scenario.label,'甲案'+scenario.label+'方案','v'+a.strategyRef.revision,'甲案'+scenario.label+'取舍理由'])assert.ok(oldForm.includes(mark),mark);
  for(const mark of [b.choiceId,'乙案另行试点','乙案原判断'])assert.ok(!oldForm.includes(mark),mark);
  if(root)await f.taskDialog.screenshot({path:path.join(root,'original-Teach-form.png')});
  await f.taskDialog.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal((await tasks()).length,baselineTasks.length);assert.equal(f.provider.requests.length,initialSends);
  assert.deepEqual(await timeline(),before);assert.equal(await f.revision(),caseRevision);assert.deepEqual(await board(),originalBoard);
  await prepare.click();
  const answer=scenario.assessment+'，保留甲案原判断。';
  const {task,prompt,requestId}=await f.createAndSend('补做甲案'+scenario.label+'复盘',answer,scenario.observation);
  assert.deepEqual(task.assignment.issue,{...f.owner,choiceId:a.choiceId});
  for(const expected of [a.choiceId,a.source.messageId,'甲案'+scenario.label+'方案原文','甲案'+scenario.label+'取舍理由',scenario.observation])assert.ok(prompt.includes(expected),expected);
  for(const excluded of [b.choiceId,bt.id,action.authorizationId,observation.revisionId,'乙案另行试点方案原文','乙案原判断'])assert.ok(!prompt.includes(excluded),excluded);
  assert.equal(f.provider.requests.length,initialSends+1);
  await f.openCase();
  await old.getByText('本轮复盘',{exact:true}).click();
  const option=select.locator('option').filter({hasText:task.name});
  await select.selectOption(await option.getAttribute('value'));
  await old.getByRole('button',{name:'核对 Teach 原回复'}).click();
  await f.work.getByText(answer,{exact:true}).waitFor();
  await old.getByLabel('实际观察').fill(scenario.observation);
  await old.getByLabel('原判断怎样保留或修订').fill(scenario.assessment);
  await old.getByLabel('下一步或结束理由').fill('保留原选择，等待后续观察');
  await old.getByRole('button',{name:'保存本轮复盘'}).click();
  await old.getByText('复盘判断 · '+scenario.assessment,{exact:true}).waitFor();
  await f.openCase();await old.getByText('实际观察 · '+scenario.observation,{exact:true}).waitFor();
  assert.equal(await old.getByText('复盘判断 · '+scenario.assessment,{exact:true}).count(),1);
  assert.equal(await prepare.count(),0);
  const [finished,unchanged]=await timeline();
  assert.deepEqual(unchanged,before[1]);assert.deepEqual(finished.actions,[]);assert.equal(finished.review.feedback,undefined);
  assert.equal(finished.review.reply.taskId,task.id);assert.equal(finished.review.choiceId,a.choiceId);assert.deepEqual(finished.choice,before[0].choice);
  assert.equal((await tasks()).length,baselineTasks.length+1);assert.deepEqual(await board(),originalBoard);
  const sourceHeader='【用户的 Task 委托】';
  const provided=prompt.split('\n').find(line=>line.startsWith(sourceHeader));
  assert.ok(provided);
  const {teachRound}=JSON.parse(provided.slice(sourceHeader.length,provided.lastIndexOf('}')+1));
  const receipt={...initial,confirmedForm:oldForm,received:{requestSha256:createHash('sha256').update(prompt).digest('hex'),teachRound},taskId:task.id,requestId,reviewId:finished.review.operationId,source:finished.review.reply,observation:scenario.observation,
    assessment:scenario.assessment,providerDelta:f.provider.requests.length-initialSends,oldActions:finished.actions.length,unchangedB:unchanged.review.operationId};
  if(root) {await old.screenshot({path:path.join(root,'saved-reopened-A.png')});await writeFile(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2));}
  t.diagnostic(JSON.stringify({requestId,taskId:task.id,oldChoice:a.choiceId,exactReply:finished.review.reply.messageId,review:finished.review.operationId,unchangedB:unchanged.review.operationId}));
});
