import type { createDecisionBoardStore } from '../../extensions/business-plugins/decision-board/storage/store.ts';
import type { BoardItemRecord, ConfirmedConclusionRecord, ConfirmedReviewClaim, ReportConfirmationReceipt } from '../../extensions/business-plugins/decision-board/types.ts';
import type { ConclusionReviewClaim, ConclusionReviewRecord } from './conclusion-review-contract.ts';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const supported=(claim:ConclusionReviewClaim)=>['supported','conditional'].includes(claim.verdict);
type Owner={projectId:string;taskId:string;verificationId:string};
export class ConclusionHandoffError extends Error { readonly code:string; readonly status:number; constructor(code:string,status=409){super(code);this.code=code;this.status=status;} }
const fail=(code:string,status=409):never=>{throw new ConclusionHandoffError(code,status);};
export type ConclusionHandoffSelection={operationId:string;reportSha256:string;claimIds:string[];recommendationIds:string[]};
export type ConclusionHandoffCandidate={projectId:string;taskId:string;reviewId:string;report:{relativePath:string;sha256:string;currentSha256?:string;currentStatus:'same'|'changed'|'unavailable'};canConfirm:boolean;reason?:string;claims:ConclusionReviewClaim[];recommendations:ConclusionReviewClaim[]};
function parse(value:unknown):ConclusionHandoffSelection {
 if(!value||typeof value!=='object'||Array.isArray(value))return fail('invalid_confirmation_selection',400);
 const x=value as Record<string,unknown>;
 if(Object.keys(x).some(k=>!['operationId','reportSha256','claimIds','recommendationIds'].includes(k))||typeof x.operationId!=='string'||!uuid.test(x.operationId)||typeof x.reportSha256!=='string'||!/^[a-f0-9]{64}$/.test(x.reportSha256))return fail('invalid_confirmation_selection',400);
 const ids=(v:unknown):string[]=>{if(!Array.isArray(v)||v.length>128||v.some(i=>typeof i!=='string'||!i.trim()||i.length>32768)||new Set(v).size!==v.length)return fail('invalid_confirmation_selection',400);return [...v].sort();};
 const claimIds=ids(x.claimIds),recommendationIds=ids(x.recommendationIds??[]);
 if(!claimIds.length)return fail('confirmation_requires_conclusion',400);
 return {operationId:x.operationId,reportSha256:x.reportSha256,claimIds,recommendationIds};
}
export function createConclusionBoardHandoff(options:{
 store:ReturnType<typeof createDecisionBoardStore>;
 readReview(owner:Owner):Promise<ConclusionReviewRecord>;
 readAuthority(owner:Owner):Promise<ConclusionReviewRecord>;
 authorizeSource(record:ConclusionReviewRecord):Promise<void>;
 project(projectId:string):Promise<{archivedAt:string|null}>;
 observe(projectId:string,relativePath:string):Promise<{sha256:string;bytes:number}>;
}) {
 const store=options.store;
 async function review(owner:Owner){const r=await options.readReview(owner);if(r.state!=='completed'||!r.reviewResult)return fail('confirmation_review_not_completed');return r;}
 async function assertSource(source:Pick<ConfirmedConclusionRecord,'projectId'|'taskId'|'reviewId'|'reportSha256'|'claimId'>){
  const r=await options.readAuthority({projectId:source.projectId,taskId:source.taskId,verificationId:source.reviewId});
  await options.authorizeSource(r);
  if(r.state!=='completed'||!r.reviewResult)fail('confirmation_source_unavailable');
  if(r.review.report.sha256!==source.reportSha256||!r.reviewResult!.output.claims.some(c=>c.id===source.claimId&&supported(c)))fail('confirmation_source_unavailable');
 }
 async function assertItemReadable(item:BoardItemRecord){if(item.sourceKind!=='report-confirmation')return;if(!item.reportConfirmation)return fail('confirmation_source_unavailable');await assertSource({...item.reportConfirmation,projectId:item.projectId});}
 async function candidate(owner:Owner):Promise<ConclusionHandoffCandidate>{
  const r=await review(owner),project=await options.project(owner.projectId);let current:Awaited<ReturnType<typeof options.observe>>|undefined;
  try{current=await options.observe(owner.projectId,r.review.report.relativePath);}catch{/* Missing current bytes never become the old fixed version. */}
  const status=current?current.sha256===r.review.report.sha256?'same':'changed':'unavailable';
  return {projectId:owner.projectId,taskId:owner.taskId,reviewId:owner.verificationId,report:{relativePath:r.review.report.relativePath,sha256:r.review.report.sha256,...(current?{currentSha256:current.sha256}:{}),currentStatus:status},canConfirm:!project.archivedAt&&status==='same',...(project.archivedAt?{reason:'项目已归档，当前仅可回看。'}:status!=='same'?{reason:status==='changed'?'当前报告已有更新；请先审查对应新版，旧版记录仍可回看。':'当前报告不可核对；本次选择保留。'}:{}),claims:r.reviewResult!.output.claims.filter(c=>c.kind!=='recommendation'),recommendations:r.reviewResult!.output.claims.filter(c=>c.kind==='recommendation')};
 }
 function mapClaim(r:ConclusionReviewRecord,c:ConclusionReviewClaim):ConfirmedReviewClaim {
  return {claimId:c.id,text:c.quote,location:c.location,verdict:c.verdict as 'supported'|'conditional',conditions:[...c.conditions],evidence:c.evidence.map(e=>{const m=r.review.materials.find(m=>m.id===e.materialId)!;return {...e,sourceLocator:m.locator,...(m.sha256?{sourceSha256:m.sha256}:{}),...(m.rangeUtf16?{rangeUtf16:{...m.rangeUtf16}}:{})};}),reason:c.reason,impact:c.impact};
 }
 function ownerReceipt(receipt:ReportConfirmationReceipt,owner:Owner){if(receipt.projectId!==owner.projectId||receipt.taskId!==owner.taskId||receipt.reviewId!==owner.verificationId)fail('confirmation_operation_not_found',404);return receipt;}
 async function operation(owner:Owner,id:string){
  if(!uuid.test(id))return fail('invalid_confirmation_operation',400);
  await options.readAuthority(owner);const receipt=store.getConfirmationOperation(id);
  return receipt?{state:'committed' as const,receipt:ownerReceipt(receipt,owner)}:{state:'not-submitted' as const};
 }
 async function confirm(owner:Owner,value:unknown){
  const selection=parse(value),existing=store.getConfirmationOperation(selection.operationId);
  if(existing){ownerReceipt(existing,owner);await options.authorizeSource(await options.readAuthority(owner));if(existing.reportSha256!==selection.reportSha256||JSON.stringify(existing.claimIds)!==JSON.stringify(selection.claimIds)||JSON.stringify(existing.recommendationClaimIds)!==JSON.stringify(selection.recommendationIds))fail('confirmation_operation_conflict');return {receipt:existing,created:false};}
  const r=await review(owner);
  const project=await options.project(owner.projectId);if(project.archivedAt)fail('project_archived');
  if(selection.reportSha256!==r.review.report.sha256)fail('confirmation_version_conflict');
  const byId=new Map(r.reviewResult!.output.claims.map(c=>[c.id,c]));
  const conclusions=selection.claimIds.map(id=>{const c=byId.get(id);if(!c||c.kind==='recommendation'||!supported(c))return fail('confirmation_claim_not_eligible');return mapClaim(r,c);});
  const recommendations=selection.recommendationIds.map(id=>{const c=byId.get(id);if(!c||c.kind!=='recommendation'||!supported(c)||!c.relatedClaimIds?.length||c.relatedClaimIds.some(id=>!selection.claimIds.includes(id)))return fail('confirmation_recommendation_not_eligible');return {...mapClaim(r,c),conclusionClaimIds:[...c.relatedClaimIds]};});
  const observed=await options.observe(owner.projectId,r.review.report.relativePath);if(observed.sha256!==selection.reportSha256)fail('confirmation_version_conflict');
  await options.readReview(owner);
  const receipt=store.confirmReportConclusions({operationId:selection.operationId,projectId:owner.projectId,taskId:owner.taskId,reviewId:owner.verificationId,report:{...r.review.report,observedSha256:observed.sha256,observedBytes:observed.bytes},confirmedBy:'local-user',conclusions,recommendations});
  return {receipt,created:true};
 }
 return {candidate,confirm,operation,assertSource,assertItemReadable};
}
