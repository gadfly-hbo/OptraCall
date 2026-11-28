import test from 'node:test';import assert from 'node:assert/strict';
import {createQuotedDecisionAdapter} from '/workspace/OptraCall-issue149-ui-conformance/src/host/quoted-decision-adapter.ts';
test('independent quoted read catalog preserves latest feedback null as null, distinct from false',async()=>{
 const item={id:'item',projectId:'project',sourceKind:'manual',status:'adopted',title:'synthetic item'},task={id:'boardtask',itemId:'item',title:'synthetic task',status:'todo'};
 let adopted:boolean|null=null;
 const board:any={listTasks:()=>[task],getTask:()=>task,getItem:()=>item,listActionAuthorizations:()=>[],listFeedbackHistory:()=>[{revisionId:'exact-null-feedback',revisionNumber:4,adopted,effect:'unknown'}]};
 const cases:any={getStatus:()=>({storeId:'store'}),getCase:()=>({id:'case'}),listProjectLinks:()=>[{projectId:'project'}],listDecisions:()=>({caseStoreId:'store',items:[],choices:[],continuation:null})};
 const adapter=createQuotedDecisionAdapter({cases,board,projects:{get:async()=>({id:'project',archivedAt:null}),getTask:async()=>({id:'native-task'})}as any,mutate:async()=>{throw new Error('read must not mutate');},isClosing:()=>false});
 const context:any={projectId:'project',taskId:'native-task',originalUserText:'read original',signal:new AbortController().signal,assertCurrent(){},caseContext:{caseStoreId:'store',caseId:'case',caseRevision:1,projectWorkRevision:1}};
 const first:any=await adapter('read',{},context);assert.equal(first.details.actions[0].feedback[0].adopted,null);assert.match(first.content[0].text,/"adopted":null/);
 adopted=false;const second:any=await adapter('read',{},context);assert.equal(second.details.actions[0].feedback[0].adopted,false);
});
