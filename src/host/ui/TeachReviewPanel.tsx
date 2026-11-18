import { useEffect, useState } from 'react';
import type { TeachReviewOwner } from '../business-role-types.ts';
import type { CaseIssueReview, CaseStrategyChoiceValue } from '../case-decision-types.ts';
import type { GoalDiscussionSourceRef, GoalRef } from '../strategy-goals-types.ts';
import { BusinessRoleConversation } from './BusinessRoleConversation.tsx';

type Review = {
  upstream:{source:GoalDiscussionSourceRef}[]; caseTitle:string; issue:{title:string}; goal:GoalRef & {title:string;scope:{name:string}}; strategy:string;
  proposal:{recordId:string;revision:number;payload:{title:string}}[]; choice:{decision:CaseStrategyChoiceValue;reason:string|null};
  actions:{taskId:string;title:string;authorizations:{id:string;scope:string}[];feedback:{revisionId:string;outcome:string;metricDelta:string;review:string}[]}[];
  review:CaseIssueReview; replies:{source:CaseIssueReview['reply'];text:string}[];
  relations:{id:string;revision:number;rationale:string;from:GoalRef;to:GoalRef}[];
};
export function TeachReviewPanel({owner,onReturn,onGoal,onStrategy}:{owner:TeachReviewOwner;onReturn():void;onGoal():void;onStrategy(source:GoalDiscussionSourceRef):void}) {
  const [view,setView]=useState<Review>(), [error,setError]=useState(''), [refresh,setRefresh]=useState(0);
  const key=JSON.stringify(owner);
  useEffect(()=>{
    const signal=new AbortController();
    setView(undefined);setError('');
    void (async()=>{
      const response=await fetch('/api/business-role?'+new URLSearchParams({owner:key,action:'origin'}),{signal:signal.signal,cache:'no-store',credentials:'omit'});
      const body=await response.json();
      if(!response.ok)throw Error(body.message||'本轮复盘的原依据不可读取。');
      if(!signal.signal.aborted)setView(body.origin);
    })().catch(e=>{if(!signal.signal.aborted)setError(e.message);});
    return ()=>signal.abort();
  },[key,refresh]);
  const teach=view?.replies.find(item=>item.source.messageId===view.review.reply.messageId&&item.source.sessionId===view.review.reply.sessionId&&item.source.expectedTextSha256===view.review.reply.expectedTextSha256);
  return <section className="case-board strategy-goals-page workspace-management-page">
    <header className="case-board-heading"><h1>{owner.role==='goal'?'目标管理 · 策略复核':'战略选择 · 战略假设复核'}</h1><button className="text-button" onClick={onReturn}>返回原事项</button></header>
    {error&&<p role="alert">{error}</p>}
    <button className="text-button" onClick={()=>setRefresh(n=>n+1)}>重新核对所见轮次</button>
    {view&&<><section className="sg-panel">
      <h2>{view.caseTitle} · {view.issue.title}</h2>
      <p>{view.goal.scope.name} · {view.goal.title} v{view.goal.version} · 策略 {view.strategy}</p>
      <button className="text-button" onClick={onGoal}>打开所涉 GSA v{view.goal.version}</button>
      {owner.role==='strategy'&&view.upstream.map(({source})=><button key={source.id+'/'+source.version} className="text-button" onClick={()=>onStrategy(source)}>定位原战略讨论 · {source.version}</button>)}
      {view.proposal.map(p=><p key={p.recordId}>原方案 · {p.payload.title} v{p.revision}</p>)}
      <p>本轮取舍 · {view.choice.reason||view.choice.decision}</p>
      {view.actions.map(a=><section key={a.taskId}><h3>{a.title}</h3>{a.authorizations.map(x=><p key={x.id}>授权范围 · {x.scope}</p>)}{a.feedback.map(f=><p key={f.revisionId}>所选看板反馈 · {f.outcome} · {f.metricDelta} · {f.review}</p>)}</section>)}
      <p>实际观察 · {view.review.observation}</p><p>复盘判断 · {view.review.judgement}</p><p>下一步 · {view.review.nextStep}</p>
      {teach&&<details><summary>准确 Teach 原回复</summary><p>{teach.text}</p><small>{teach.source.sessionId} · {teach.source.messageId}</small></details>}
      {view.relations.map(r=><p key={r.id}>当时目标关系 v{r.revision} · {r.from.goalId} v{r.from.version} → {r.to.goalId} v{r.to.version} · {r.rationale}</p>)}
    </section><BusinessRoleConversation owner={owner}/></>}
  </section>;
}
