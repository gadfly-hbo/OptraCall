import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {providerMessageText} from './fixtures/tool-provider.ts';
import {startTaskRounds} from './fixtures/pm-task-rounds.ts';

test('an issue Decision handoff to Do requires the exact current authorized action and preserves an independent Do', async t=>{
  const {api,provider,owner,taskPath,create,send,choose,authorize,prompt}=await startTaskRounds(t);
  const decision=await create('decision','门店取舍',owner);
  await send(decision.id,'请比较','决策任务成果');
  const result=(await api(taskPath+'/'+decision.id+'/results')).details.results[0];
  const sources=[{taskId:decision.id,key:result.id}];
  const createDo=(issue:unknown,expected:number)=>api(taskPath,'POST',{operationId:randomUUID(),name:'从取舍交接执行',assignment:{type:'do',skill:null,sources,issue}},expected);
  const before=provider.requests.length;
  await createDo(owner,409);
  await createDo(undefined,409);
  assert.equal(provider.requests.length,before);
  const independent=await create('do','记录现场既有事实');
  await send(independent.id,'登记线下已经完成的核对','已记录线下事实');
  assert.ok(!prompt().includes('authorizedDo'));
  const a=await choose('A'), first=await authorize(a.choiceId,'A');
  const b=await choose('B',a.choiceId);
  await createDo({...owner,choiceId:a.choiceId,authorizationId:first.authorizationId},409);
  await createDo({...owner,choiceId:b.choiceId,authorizationId:first.authorizationId},409);
  const second=await authorize(b.choiceId,'B');
  const {task}=await createDo({...owner,choiceId:b.choiceId,authorizationId:second.authorizationId},201);
  await send(task.id,'核对本轮授权','实际采用授权范围');
  for(const marker of [b.choiceId,b.source.messageId,'B方案原文','B取舍理由','B授权范围'])assert.ok(prompt().includes(marker),marker);
  assert.ok(!prompt().includes('A方案原文'));
});

test('two Case authorization forms keep the original action and distinguish a conflicting operation', async t => {
  const {api, choose, project, issuePath, provider} = await startTaskRounds(t);
  const {choiceId} = await choose('单店试行');
  const form = {operationId:randomUUID(), projectId:project.id, choiceId, title:'核对北店', scope:'仅北店'};
  const route = issuePath + '/authorize', requests = provider.requests.length;
  const original = (await api(route, 'POST', form)).arrangement;
  assert.equal((await api(route, 'POST', {...form, operationId:randomUUID()}, 409)).code, 'choice_already_arranged');
  assert.equal((await api(route, 'POST', {...form, scope:'另一范围'}, 409)).code, 'arrangement_operation_conflict');
  assert.deepEqual((await api(route, 'POST', form)).arrangement, original);
  const {rounds} = await api(issuePath);
  assert.equal(rounds[0].actions.length, 1);
  assert.equal(rounds[0].actions[0].currentAuthorizationId, original.actions[0].authorizationId);
  assert.equal(provider.requests.length, requests);
});

test('quoted feedback follows the named choice of the reused board action and retains the original receipt', async t => {
  const f = await startTaskRounds(t), a = await f.choose('原试点'), card = await f.authorize(a.choiceId, '甲店');
  const decision = await f.create('decision', '记录试点原话', f.owner);
  const quoted = async (command:Record<string,unknown>, text:string) => {
    let reply = '';
    await f.send(decision.id,text,turn => {
      if (!turn.recentToolResults.length) return {calls:[{name:'record_user_decision',arguments:{...command,...(command.action === 'read' ? {} : {quote:{text,start:0,end:text.length}})}}]};
      reply = providerMessageText(turn.recentToolResults.at(-1)!.content);
      return {text:'已核对本次操作的回执'};
    });
    return reply;
  };
  const feedback = {action:'record-feedback', itemId:card.itemId, taskId:card.taskId, adopted:true, metricDelta:'0', review:'仍需观察', score:null, effect:'none'};
  const original = JSON.parse(await quoted({...feedback,choiceId:a.choiceId,strategyRef:a.strategyRef,expectedLatestRevisionId:null,outcome:'甲店首报'},'甲店首报'));
  assert.equal(original.status,'completed');
  const b = await f.choose('新试点', a.choiceId);
  const stillA = JSON.parse(await quoted({...feedback,choiceId:a.choiceId,strategyRef:a.strategyRef,expectedLatestRevisionId:original.authority.revisionId,outcome:'甲店尚未移交时补报'},'甲店尚未移交时补报'));
  assert.equal(stillA.status,'completed');
  await f.recordDecision(decision.id,b,'现在把该行动交给乙店试点。',()=>({action:'authorize-action',decision:'authorize',itemId:card.itemId,taskId:card.taskId,
    itemVersion:card.itemVersion,taskVersion:card.taskVersion,expectedPreviousAuthorizationId:card.authorizationId,scope:'乙店范围'}));
  const previous = stillA.authority.revisionId;
  const denied = await quoted({...feedback,choiceId:a.choiceId,strategyRef:a.strategyRef,expectedLatestRevisionId:previous,outcome:'晚到的甲店报告'},'晚到的甲店报告');
  assert.match(denied,/case_feedback_round_mismatch/);
  const correct = JSON.parse(await quoted({...feedback,choiceId:b.choiceId,strategyRef:b.strategyRef,expectedLatestRevisionId:previous,outcome:'乙店首报'},'乙店首报'));
  assert.equal(correct.status,'completed');
  const history = (await f.api(f.issuePath)).rounds;
  assert.deepEqual(history.map((r:any)=>r.actions.flatMap((row:any)=>row.feedback.map((item:any)=>item.outcome))),[['甲店首报','甲店尚未移交时补报'],['乙店首报']]);
  const read = JSON.parse(await quoted({action:'read',operationId:original.operationId},'看原甲店反馈回执'));
  assert.equal(read.feedback.revisionId,original.authority.revisionId);
});
