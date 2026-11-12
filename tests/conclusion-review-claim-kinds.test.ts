import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseConclusionReviewOutput, type ConclusionReviewMetadata } from '../src/host/conclusion-review-contract.ts';
const reportText='C类在本款中最大。可在支持窗口内试点。';
const sha=createHash('sha256').update(reportText).digest('hex');
const metadata:ConclusionReviewMetadata={schemaVersion:1,report:{relativePath:'060_reports/report.md',sha256:sha,bytes:Buffer.byteLength(reportText)},materials:[],providedText:JSON.stringify({content:[]})};
const claim=(id:string,quote:string)=>({id,quote,location:'段落1',reportVersion:sha,verdict:'conditional',evidence:[],evidenceGaps:[],conditions:['支持窗口内'],reason:'仅限指定范围。',impact:'待用户决定。'});
const output=(claims:unknown[])=>JSON.stringify({schemaVersion:1,reportVersion:sha,claims,scope:{reviewed:'两条',unreviewed:[],limitations:[]}});
test('CBH typed review retains explicit recommendation relations and old untyped claims unchanged',()=>{
 const c=claim('c','C类在本款中最大。'),r={...claim('r','可在支持窗口内试点。'),kind:'recommendation',relatedClaimIds:['c']};
 const parsed=parseConclusionReviewOutput(output([c,r]),metadata,reportText);
 assert.deepEqual(parsed.claims[0],c);assert.equal(parsed.claims[1]!.kind,'recommendation');assert.deepEqual(parsed.claims[1]!.relatedClaimIds,['c']);
});
for(const relation of [['absent'],['r'],['c','c'],[]])test(`CBH typed review rejects unverifiable recommendation relation ${JSON.stringify(relation)}`,()=>{
 assert.throws(()=>parseConclusionReviewOutput(output([claim('c','C类在本款中最大。'),{...claim('r','可在支持窗口内试点。'),kind:'recommendation',relatedClaimIds:relation}]),metadata,reportText),{code:'conclusion_review_result_invalid'});
});

test('CBH preserves old saved reviews whose raw answer contained previously ignored kind fields',async()=>{
 const {mkdtemp,mkdir,readFile,writeFile}=await import('node:fs/promises');const path=await import('node:path');const {randomUUID}=await import('node:crypto');
 const {createVerificationStore}=await import('../src/host/verification-store.ts');
 const base=path.resolve('.local/confirmed-conclusions-board-handoff/legacy-claim-shape');await mkdir(base,{recursive:true});
 const root=await mkdtemp(path.join(base,'run-')),store=createVerificationStore({dataRoot:root});
 const request={projectId:randomUUID(),taskId:randomUUID(),verificationId:randomUUID(),mode:'conclusion-review' as const,question:'审查',selection:{},configuration:{id:'synthetic',revision:1,provider:'synthetic',model:'test'},dataFiles:[],authorFiles:[{relativePath:metadata.report.relativePath,bytes:Buffer.from(reportText)}],review:metadata};
 await store.create(request);await store.update(request,{state:'running'});
 const raw=output([{...claim('c','C类在本款中最大。'),kind:'conclusion',relatedClaimIds:[]}]);
 const saved=await store.saveReviewResult(request,{text:raw});
 const recordFile=path.join(store.recordDirectory(request),'record.json');
 const historical=JSON.parse(await readFile(recordFile,'utf8'));
 historical.reviewResult.output.claims=[claim('c','C类在本款中最大。')];
 await writeFile(recordFile,JSON.stringify(historical));const before=await readFile(recordFile);
 const read=await store.read(request);assert.deepEqual(read.reviewResult!.output.claims,historical.reviewResult.output.claims);
 assert.deepEqual(await readFile(recordFile),before);assert.equal(await readFile(saved.reviewResult!.file,'utf8'),raw);
});
