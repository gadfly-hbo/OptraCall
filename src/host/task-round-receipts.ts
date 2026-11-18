import {createHash} from 'node:crypto';
import type {CaseIssueReply} from './case-decision-types.ts';
import type {TaskAssignment} from './task-assignment.ts';

type NativeReply = {kind:'task-native-reply';projectId:string;taskId:string;sessionId:string;messageId:string;sha256:string;requestId:string};
export interface TaskRoundReceipts {
  doSourceRights?:string[];
  doSources?:NativeReply[];
  teachSourceRights?:string[];
  teachSources?:NativeReply[];
}
type Round = {sourceRights:string[]; replies:{source:CaseIssueReply;requestId:string}[]};
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const unavailable=():never=>{throw Error('project_result_lineage_unavailable');};
export function taskRoundReceiptKind(assignment:unknown) {
  if(!object(assignment)||!object(assignment.issue)||!assignment.issue.choiceId)return;
  if(assignment.type==='teach'||assignment.type==='do'&&assignment.issue.authorizationId)return assignment.type;
}
export function taskRoundReceipts(kind:'do'|'teach',round:Round):TaskRoundReceipts {
  const sources=round.replies.map(({source,requestId})=>({kind:'task-native-reply' as const,projectId:source.projectId,taskId:source.taskId,sessionId:source.sessionId,messageId:source.messageId,sha256:source.expectedTextSha256,requestId}));
  return kind==='do' ? {doSourceRights:round.sourceRights,doSources:sources} : {teachSourceRights:round.sourceRights,teachSources:sources};
}
/** Older Hosts put the exact receipt in the first, Host-written JSON line, and persisted the complete native prompt hash. */
export function historicalTaskRoundReceipts(assignment:TaskAssignment, nativeText:string, requestSha:unknown):TaskRoundReceipts {
  const kind=taskRoundReceiptKind(assignment),issue=assignment.issue;
  if(!kind||!issue||createHash('sha256').update(nativeText).digest('hex')!==requestSha)return unavailable();
  const prefix='【用户的 Task 委托】', first=nativeText.split('\n',1)[0]!;
  if(!first.startsWith(prefix))return unavailable();
  // The optional read_project_task_results guidance after the JSON contains no closing JSON brace.
  const end=first.lastIndexOf('}');
  let input;
  try {input=JSON.parse(first.slice(prefix.length,end+1));} catch {return unavailable();}
  const round=kind==='do'?input.authorizedDo:input.teachRound;
  if(!object(round)||!object(round.issue)||round.issue.caseId!==issue.caseId||round.issue.id!==issue.issueId||
    !Array.isArray(round.rounds)||!round.rounds.some(r=>object(r)&&object(r.choice)&&r.choice.id===issue.choiceId)||
    !Array.isArray(round.sourceRights)||!round.sourceRights.every(r=>typeof r==='string')||
    !Array.isArray(round.replies)||!round.replies.every(r=>object(r)&&typeof r.requestId==='string'&&object(r.source)&&r.source.type==='native-reply'&&
      ['projectId','taskId','sessionId','messageId','expectedTextSha256'].every(k=>typeof (r.source as Record<string,unknown>)[k]==='string')))return unavailable();
  return taskRoundReceipts(kind,round as Round);
}
