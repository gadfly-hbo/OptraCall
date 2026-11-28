import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';
const file='.local/ui-conformance/demo-aligned/fixture-ids.json',ids=JSON.parse(await fs.readFile(file,'utf8')),base=ids.base;
async function api(route,method='GET',body){const res=await fetch(base+route,{method,headers:{'content-type':'application/json','x-optracall-client':'1',origin:base},...(body?{body:JSON.stringify(body)}:{})});const value=await res.json();if(!res.ok)throw Error(route+' '+res.status+':'+JSON.stringify(value));return value;}
const op=()=>randomUUID();
if(!ids.observationRequest){
 const {caseId}=ids.career,issueId=ids.issues.interview.id,old=ids.requests[1];
 const {choice}=await api(`/api/cases/${caseId}/decisions/${old.target.strategyRef.recordId}/choice`,'POST',{operationId:op(),caseStoreId:old.target.strategyRef.caseStoreId,strategyRef:old.target.strategyRef,issueId,choice:'trial',reason:'完成两次访谈，回录自己实际观察到的工作片段。',expectedPreviousChoiceId:null});
 const {arrangement}=await api(`/api/cases/${caseId}/decisions/issues/${issueId}/authorize`,'POST',{operationId:op(),choiceId:choice.choiceId,projectId:ids.projects.career.id,title:'完成两次职业访谈','scope':'仅回录已经发生的两次访谈，不把等待第三次访谈列为个人待办。'});
 const action=arrangement.actions[0];await api(`/api/decision-board/tasks/${action.taskId}/status`,'POST',{status:'done'});
 await api(`/api/cases/${caseId}/decisions/requests`,'POST',{operationId:op(),expectedRevision:(await api(`/api/cases/${caseId}`)).case.revision,requestId:old.requestId,expectedRequestRevision:old.revision,action:'withdraw',source:{kind:'user-declaration',ref:'synthetic-fixture:replace-introductory-choice-with-observation'}});
 const {request}=await api(`/api/cases/${caseId}/decisions/requests`,'POST',{operationId:op(),expectedRevision:(await api(`/api/cases/${caseId}`)).case.revision,expectedRequestRevision:0,issueId,kind:'observe',text:'补记已有访谈的实际观察',source:{kind:'user-declaration',ref:'synthetic-fixture:explicit-interview-observation'},assignee:{label:'林予安',source:'合成场景中的明确承担人声明'},requestedAt:'2026-11-25T02:00:00.000Z',target:{kind:'observe',projectId:ids.projects.career.id,itemId:action.itemId,taskId:action.taskId,authorizationId:action.authorizationId,feedbackBaseRevisionId:null}});
 ids.observationRequest=request;ids.careerAction={choice,arrangement};await fs.writeFile(file,JSON.stringify(ids,null,2));
}
const projection=await api('/api/workspace/home-pending');await fs.writeFile('.local/ui-conformance/demo-aligned/home-projection.json',JSON.stringify(projection,null,2));console.log(JSON.stringify({pending:projection.pending.map(r=>({title:r.text,kind:r.kind,status:r.status})),externalWaiting:projection.externalWaiting}));
