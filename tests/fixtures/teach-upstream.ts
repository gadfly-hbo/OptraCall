import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { TeachReviewOwner } from '../../src/host/business-role-types.ts';
import type { StrategyDiscussionDetail } from '../../src/host/strategy-discussion-types.ts';
import type { CaseDecisionService } from '../../src/host/case-decision-service.ts';
import type { startTestHost } from './host-process.ts';
import { providerMessageText, type startToolProvider } from './tool-provider.ts';

export async function checkTeachUpstream(host: Awaited<ReturnType<typeof startTestHost>>, provider: Awaited<ReturnType<typeof startToolProvider>>, round: Awaited<ReturnType<CaseDecisionService['issueTimeline']>>['rounds'][number], excluded: string[]) {
  const review = round.review, binding=round.choice.goalBinding;
  assert.ok(review?.feedback && binding?.strategy);
  const goal=binding.primary;
  const sessions:{role:string;discussionId:string;sessionId:string|null;requestId:string;promptSha256:string;systemSha256:string;expected:string[]}[]=[];
  const goalApi='/api/strategy/goals/'+goal.goalId, before=await (await host.request(goalApi)).json();
  const routes: string[] = [];
  for (const role of ['goal', 'strategy'] as const) {
    const owner:TeachReviewOwner = {role,...goal,teachReview:{caseId:review.caseId,issueId:review.issueId,choiceId:review.choiceId,reviewId:review.operationId}};
    const api = '/api/business-role?owner='+encodeURIComponent(JSON.stringify(owner)); routes.push(api);
    const response = await host.request(api+'&action=origin');assert.equal(response.status,200,await response.clone().text());
    const preview=JSON.stringify(await response.json());
    const expected:string[]=[goal.goalId,binding.strategy,review.operationId,review.reply.expectedTextSha256,review.feedback.feedbackRevisionId,round.choice.strategyRef.recordId,round.actions[0].authorizations[0].id,'复盘原看板的实际观察后'];
    if(role==='strategy')expected.push('原轮当时的目标关系依据');
    for(const s of expected) assert.ok(preview.includes(s),s);
    provider.setResponder(()=>({text:'讨论本轮证据，不修改原判断。'}));
    const requestId=randomUUID();
    const started=await host.request(api+'&action=messages','POST',{requestId,expectedRevision:0,text:'请复核本轮证据。'});assert.equal(started.status,202,await started.clone().text());
    for(let i=0;i<160;i++){
      const state=await (await host.request(api)).json();
      if(state.discussion?.lastRun?.status==='completed')break;
      await delay(30);
    }
    const state:StrategyDiscussionDetail=await (await host.request(api+'&requestId='+requestId)).json();
    assert.equal(state.requestReceipt?.requestId,requestId);assert.equal(state.discussion.lastRun?.status,'completed');
    const request=provider.requests.at(-1)!.body.messages!;
    assert.ok(request.some(m=>['system','developer'].includes(m.role)&&providerMessageText(m.content).includes(role==='goal'?'目标管理 Agent':'战略选择 Agent')));
    const prompt=request.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).join(' ');
    for(const s of expected) assert.ok(prompt.includes(s),s);
    for(const s of [...excluded,'后来另行调整的关系']) assert.ok(!prompt.includes(s),s);
    const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
    sessions.push({role,discussionId:state.discussion.id,sessionId:state.snapshot.sessionId,requestId,promptSha256:digest(prompt),
      systemSha256:digest(request.filter(m=>['developer','system'].includes(m.role)).map(m=>providerMessageText(m.content)).join('\n')),expected});
    const wrong={...owner,teachReview:{...owner.teachReview,reviewId:randomUUID()}};
    assert.ok(!(await host.request('/api/business-role?owner='+encodeURIComponent(JSON.stringify(wrong))+'&action=origin')).ok);
  }
  assert.deepEqual(await (await host.request(goalApi)).json(),before);
  assert.notEqual(sessions[0]!.sessionId,sessions[1]!.sessionId);
  const evidence='.local/product-v13/pm-repair/role';
  await mkdir(evidence,{recursive:true});
  await writeFile(evidence+'/teach-sessions-'+review.operationId+'.json',JSON.stringify({goal,review:review.operationId,sessions},null,2));
  return async () => {
    for(const api of routes)for(const action of ['','&action=origin','&action=messages']){
      const res=await host.request(api+action,action.endsWith('messages')?'POST':'GET',action.endsWith('messages')?{requestId:randomUUID(),expectedRevision:1,text:'重新派发'}:undefined);
      assert.ok([403,409].includes(res.status),await res.clone().text());
    }
  };
}
