import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { authorityAtFeedback } from '/workspace/OptraCall-issue149-ui-conformance/src/host/case-issues.ts';
import { createCaseDecisionService } from '/workspace/OptraCall-issue149-ui-conformance/src/host/case-decision-service.ts';
import { createPersonalSourceReader } from '/workspace/OptraCall-issue149-ui-conformance/src/host/personal-retention-sources.ts';
import { captureFeedbackMaterials, feedbackMaterialsText } from '/workspace/OptraCall-issue149-ui-conformance/src/host/decision-feedback-context.ts';

const fixed = {
  revisionId:'10000000-0000-4000-8000-000000000001', taskId:'10000000-0000-4000-8000-000000000002', revisionNumber:1,
  operationId:'10000000-0000-4000-8000-000000000003', origin:'manual', adopted:null,
  observationDate:'2021-02-03', sourceScope:'现场原记录 <边界> & 仅甲店\n第二行', savedAt:'2026-11-28T12:00:00.000Z',
  outcome:'只记录客观观察，执行情况没有取得', metricDelta:'', review:'未验证效果', effect:'unknown', score:null,
};
const project={id:'10000000-0000-4000-8000-000000000004',name:'synthetic independent consumer fixture',archivedAt:null};
const item={id:'10000000-0000-4000-8000-000000000005',projectId:project.id,title:'synthetic original',sourceKind:'manual'};
const task={id:fixed.taskId,itemId:item.id,title:'synthetic action',feedback:fixed};
const target={type:'feedback',sourceProjectId:project.id,boardTaskId:task.id,feedbackRevisionId:fixed.revisionId};
const newer={...fixed,revisionId:'10000000-0000-4000-8000-000000000006',revisionNumber:2,adopted:false,observationDate:'2022-03-04',sourceScope:'LATEST_MUST_NOT_REPLACE_EXACT',outcome:'LATEST_BODY'};
const board={getTask:()=>task,getItem:()=>item,getFeedbackRevision:(id:string)=>id===fixed.revisionId?fixed:id===newer.revisionId?newer:null,listFeedbackHistory:()=>[fixed,newer],listTasks:()=>[task]};
const deps:any={cases:{getCase:()=>({}),listProjectLinks:()=>[{projectId:project.id}]},projects:{get:async()=>project},board};
const require=createRequire(import.meta.url);
let components:any;
async function ui(){
  if(components)return components;
  const result=await build({stdin:{contents:"export { SourceBody } from './src/host/ui/CaseDecisionsPanel.tsx'; export { ActionAuthorityHistory } from './extensions/business-plugins/decision-board/ui/ActionAuthorityHistory.tsx';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},platform:'node',format:'cjs',external:['react','react/jsx-runtime'],metafile:true});
  const module={exports:{}};runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,URL,URLSearchParams,crypto});return components=module.exports;
}
const render=(Component:any,props:any)=>renderToStaticMarkup(React.createElement(Component,props));

test('independent fixed consumers: exact source renders null as unknown and original metadata as escaped visible text',async()=>{
 const {SourceBody}=await ui();const html=render(SourceBody,{value:{target,text:JSON.stringify({feedback:fixed})}});
 assert.match(html,/<dt>执行陈述<\/dt><dd>未知<\/dd>/);assert.doesNotMatch(html,/记录为未按建议执行/);
 assert.match(html,/<dt>观察日期<\/dt><dd>2021-02-03<\/dd>/);assert.match(html,/<dt>回录时间<\/dt><dd>2026-11-28T12:00:00.000Z<\/dd>/);
 assert.match(html,/现场原记录 &lt;边界&gt; &amp; 仅甲店\n第二行/);assert.match(html,/未说明／未知/);assert.doesNotMatch(html,/LATEST_MUST_NOT_REPLACE_EXACT/);
});
test('independent fixed consumers: true, false and absent execution remain distinct; old missing metadata is not invented',async()=>{
 const {SourceBody}=await ui();for(const [adopted,label]of [[true,'记录为已按建议执行'],[false,'记录为未按建议执行'],[undefined,'未知']]as const){const html=render(SourceBody,{value:{target,text:JSON.stringify({feedback:{adopted,outcome:'legacy observation',savedAt:fixed.savedAt}})}});assert.ok(html.includes(`<dt>执行陈述</dt><dd>${label}</dd>`));assert.ok(html.includes('<dt>观察日期</dt><dd>未记录</dd>'));assert.ok(html.includes('<dt>来源与范围</dt><dd>未记录</dd>'));}
});
test('independent fixed consumers: unavailable source and paged JSON never manufacture structured feedback facts',async()=>{
 const {SourceBody}=await ui();const unknown=render(SourceBody,{value:{target,text:null}});assert.match(unknown,/UNKNOWN/);assert.doesNotMatch(unknown,/记录为未按建议执行/);
 const page=render(SourceBody,{value:{target,text:JSON.stringify({feedback:fixed}),partial:true,range:{start:0,end:100,total:200}}});assert.doesNotMatch(page,/<dt>执行陈述/);assert.match(page,/2021-02-03/);
});
test('independent fixed consumers: authority panel keeps unknown report independent of authority/effect',async()=>{
 const {ActionAuthorityHistory}=await ui();const unknown=render(ActionAuthorityHistory,{task,initialHistory:[]});assert.match(unknown,/执行情况未知 · 只记录客观观察/);assert.doesNotMatch(unknown,/已回录未按原建议执行/);assert.match(unknown,/未记录明确行动授权/);assert.match(unknown,/未独立验证/);
 const negative=render(ActionAuthorityHistory,{task:{...task,feedback:{...fixed,adopted:false}},initialHistory:[]});assert.match(negative,/已回录未按原建议执行/);assert.doesNotMatch(negative,/执行情况未知/);
});
test('independent fixed consumers: Host exact source and links preserve null without substituting latest metadata',async()=>{
 const service=createCaseDecisionService(deps);const source=await service.source('10000000-0000-4000-8000-000000000007',{target});assert.equal(source.status,'available');assert.deepEqual(JSON.parse(source.text!).feedback,fixed);assert.equal((source.current as any).latestFeedbackRevisionId,newer.revisionId);assert.equal(source.observation,undefined);
 const links=await service.links('10000000-0000-4000-8000-000000000007');assert.equal(links.actions[0].feedbackRevisions[0].adopted,null);assert.equal(links.actions[0].feedbackRevisions[1].adopted,false);
});
test('independent fixed consumers: personal exact-source export retains null/date/scope and full revision identity',async()=>{
 const reader=createPersonalSourceReader(deps);const result=await reader(target as any);assert.deepEqual(JSON.parse(result.text!),fixed);assert.equal(result.status,'available');
});
test('independent fixed consumers: review material snapshot and prompt preserve null/date/scope with exact identity',async()=>{
 const source:any={sourceProjectId:project.id,boardTaskId:task.id,feedbackRevision:fixed};const [material]=await captureFeedbackMaterials({}as any,source,[{id:'feedback',kind:'feedback',mode:'full'}]);assert.deepEqual(JSON.parse(material.body!),fixed);assert.equal(material.source.revisionId,fixed.revisionId);assert.match(feedbackMaterialsText([material]),/"adopted": null/);assert.match(feedbackMaterialsText([material]),/2021-02-03/);
 const [reference]=await captureFeedbackMaterials({}as any,source,[{id:'feedback',kind:'feedback',mode:'reference'}]);assert.equal(reference.body,null);assert.equal(reference.source.revisionId,fixed.revisionId);
});
test('independent fixed consumers: observation date never determines authority; save time or original legacy edit time does',()=>{
 const rows:any=[{authorizationId:'before',createdAt:'2026-11-28T10:00:00.000Z'},{authorizationId:'after',createdAt:'2026-11-28T14:00:00.000Z'}];
 for(const observationDate of ['1900-01-01','2099-01-01']){const result=authorityAtFeedback(rows,{...fixed,observationDate}as any);assert.equal(result?.authority.authorizationId,'before');assert.equal(result?.observedAt,fixed.savedAt);}
 assert.equal(authorityAtFeedback(rows,{...fixed,origin:'legacy-current',legacyUpdatedAt:'2026-11-28T09:00:00.000Z',observationDate:'2099-01-01'}as any),null);
 assert.equal(authorityAtFeedback(rows,{...fixed,savedAt:'invalid',observationDate:'2026-11-28'}as any),undefined);
});
