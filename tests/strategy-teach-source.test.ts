import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {verifyConfirmedRounds} from './fixtures/pm-case-rounds.ts';
import {providerMessageText} from './fixtures/tool-provider.ts';
import type { StrategyDiscussionSource } from '../src/host/strategy-discussion-types.ts';

test('strategic co-creation can read the saved observation and original Teach reply only while the project is linked',{timeout:90000},t=>verifyConfirmedRounds(t,async({host,provider,receipt,link})=>{
  const req=async(route:string,method='GET',body?:unknown,status=200):Promise<any>=>{
    const res=await host.request(route,method,body);assert.equal(res.status,status,await res.clone().text());return res.json();
  };
  const {discussion}=await req('/api/strategy/discussions','POST',{operationId:randomUUID(),projectId:receipt.work},201);
  const route='/api/strategy/discussions/'+discussion.id;
  const locate=async()=>(await req(route+'/sources')).sources.find((s:StrategyDiscussionSource)=>s.target.kind==='case-teach-review'&&s.target.reviewId===receipt.review);
  const reference=await locate(); assert.ok(reference);
  assert.equal(reference.target.choiceId,receipt.second);
  const {discussion:bound}=await req(route,'PATCH',{expectedRevision:discussion.revision,sources:[reference]});
  let read='';
  provider.setResponder(call=>{
    if(!call.recentToolResults.length)return {calls:[{name:'strategy_goals',arguments:{action:'read-source',sourceId:reference.id}}]};
    read=providerMessageText(call.recentToolResults.at(-1)?.content);return {text:'已核对原回访观察。'};
  });
  await req(route+'/messages','POST',{text:'核对上期已保存的回访观察。',requestId:randomUUID(),expectedRevision:bound.revision},202);
  for(let i=0;i<300;i++){const state=await req(route);if(!state.busy&&state.discussion.lastRun?.status==='completed')break;await delay(20);}
  assert.match(read,/南店两天回访后复购持平/);
  await link(String(receipt.work),false);
  assert.equal(await locate(),undefined);
  const prev=provider.requests.length;
  const current=(await req(route)).discussion;
  const denied=await host.request(route+'/messages','POST',{requestId:randomUUID(),text:'重开后继续',expectedRevision:current.revision});
  assert.ok([403,409].includes(denied.status));assert.equal(provider.requests.length,prev);
  await link(String(receipt.work),true);
}));
