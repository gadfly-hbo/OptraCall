import type { CaseStore } from './case-store.ts';
import type { CaseIssueReview } from './case-decision-types.ts';
import type { StrategyDiscussion, StrategyDiscussionSource } from './strategy-discussion-types.ts';
import { createStrategyDiscussionSource, StrategyDiscussionSourceFault, type StrategyDiscussionSourceContext } from './strategy-discussion-sources.ts';
import { discussionHash } from './strategy-discussion-store.ts';

type Review = Pick<CaseIssueReview,'caseId'|'issueId'|'choiceId'|'operationId'>;
export function strategyTeachSources<Model>(cases:Pick<CaseStore,'getStatus'|'listCases'|'listProjectLinks'|'getEvents'|'getDecisionIssue'>,
  checkedReview:(ref:Review,projectId:string,model:Model,context:StrategyDiscussionSourceContext)=>Promise<{review:CaseIssueReview;text:string}>){
  const fail=():never=>{throw new StrategyDiscussionSourceFault('strategy_teach_source_unavailable',403);};
  const source=(projectId:string,review:CaseIssueReview)=>{
    const issue=cases.getDecisionIssue(review.caseId,review.issueId);
    return createStrategyDiscussionSource(`${issue.title} · Teach 复盘 · ${review.createdAt.slice(0,10)}`,{
      kind:'case-teach-review',projectId,caseId:review.caseId,issueId:review.issueId,choiceId:review.choiceId,reviewId:review.operationId
    },discussionHash(review),review.operationId);
  };
  const read=async(owner:StrategyDiscussion,model:Model,context:StrategyDiscussionSourceContext,target:Record<string,unknown>)=>{
    const {caseId,issueId,choiceId,reviewId,projectId}=target;
    if(owner.businessOwner||!owner.projectId||projectId!==owner.projectId||typeof caseId!=='string'||typeof issueId!=='string'||typeof choiceId!=='string'||typeof reviewId!=='string')return fail();
    const linked=()=>cases.listProjectLinks(caseId).some(p=>p.projectId===projectId);
    if(!linked())return fail();
    const value=await checkedReview({caseId,issueId,choiceId,operationId:reviewId},owner.projectId,model,context);
    context.assertCurrent();context.signal?.throwIfAborted();
    if(!linked()||value.review.operationId!==reviewId||value.review.choiceId!==choiceId||value.review.issueId!==issueId||value.review.caseId!==caseId||
        value.review.reply.expectedTextSha256!==discussionHash(value.text))return fail();
    return {source:source(owner.projectId,value.review),text:JSON.stringify({observation:value.review.observation,judgement:value.review.judgement,nextStep:value.review.nextStep,reply:value.review.reply,originalReply:value.text})};
  };
  return {read,async list(owner:StrategyDiscussion,model:Model,context:StrategyDiscussionSourceContext){
    const rows:StrategyDiscussionSource[]=[];
    if(owner.businessOwner||!owner.projectId||cases.getStatus().state!=='ready')return rows;
    for(const c of cases.listCases()){
      if(!cases.listProjectLinks(c.id).some(p=>p.projectId===owner.projectId))continue;
      for(const e of cases.getEvents('case',c.id)){
        const r=e.changes.issueReview?.after as CaseIssueReview|undefined;
        if(!r)continue;
        const ref=source(owner.projectId,r);
        try{rows.push((await read(owner,model,context,ref.target)).source);}
        catch{context.assertCurrent();context.signal?.throwIfAborted();}
      }
    }
    return rows;
  }};
}
