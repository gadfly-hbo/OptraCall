import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
