import type { CaseStore } from './case-store.ts';
import { CaseStoreError, type CaseCreationSource, type CaseRecord } from './case-types.ts';
import { caseDecisionId, caseDecisionRevision, parseCaseDecisionTarget } from './case-decision-validation.ts';

export function parseCaseCreationSource(value:unknown):CaseCreationSource {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new CaseStoreError('invalid_case_origin');
  const fields=value as Record<string,unknown>;
  if(fields.kind==='case'&&Object.keys(fields).every(k=>['kind','caseId','caseRevision'].includes(k))){
    return {kind:'case',caseId:caseDecisionId(fields.caseId),caseRevision:caseDecisionRevision(fields.caseRevision)};
  }
  if(fields.kind!=='task'||Object.keys(fields).some(k=>!['kind','projectId','taskId','reply'].includes(k)))throw new CaseStoreError('invalid_case_origin');
  const projectId=caseDecisionId(fields.projectId),taskId=caseDecisionId(fields.taskId);
  if(fields.reply===undefined)return {kind:'task',projectId,taskId};
  const target=parseCaseDecisionTarget({type:'source',source:fields.reply});
  if(target.type!=='source'||target.source.type!=='native-reply'||target.source.excerpt||target.source.projectId!==projectId||target.source.taskId!==taskId)throw new CaseStoreError('invalid_case_origin');
  return {kind:'task',projectId,taskId,reply:target.source};
}

/** Reconstruct only the Case's own business fields from its original revision deltas. */
export function readCaseOriginRevision(cases:CaseStore,source:Extract<CaseCreationSource,{kind:'case'}>){
  const head=cases.getCase(source.caseId);
  const events=cases.getEvents('case',head.id).filter(e=>e.revision<=source.caseRevision);
  if(source.caseRevision>head.revision||events.length!==source.caseRevision||
    events.some((e,i)=>e.revision!==i+1)||events[0]?.eventType!=='case_created')throw new CaseStoreError('case_origin_revision_unavailable',409);
  const fields=['title','description','judgement','nextStep','status','closeReason'] as const;
  const facts:Partial<Pick<CaseRecord,typeof fields[number]>>={};
  for(const event of events){
    for(const field of fields)if(event.changes[field])Object.assign(facts,{[field]:event.changes[field].after});
  }
  const event=events.at(-1)!;
  const binding=cases.getGoalBinding(head.id,new Date(event.occurredAt),event.revision);
  return {id:head.id,revision:event.revision,recordedAt:event.occurredAt,...facts,
    ...(event.note?{note:event.note}:{}),...(binding?{goalBinding:binding}:{})};
}

/** The issue event pins the business facts in force when the user opened that issue. */
export function readCaseIssueOrigin(cases: CaseStore, caseId: string, issueId: string) {
  const created = cases.getEvents('case',caseId).find(event => {
    const issue = event.changes.decisionIssue?.after as {id?: string} | undefined;
    return issue?.id === issueId;
  });
  if (!created) throw new CaseStoreError('case_origin_revision_unavailable',409);
  return readCaseOriginRevision(cases,{kind:'case',caseId,caseRevision:created.revision});
}
