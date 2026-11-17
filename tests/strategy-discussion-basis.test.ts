import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
test('v1.2 one strategy request keeps its original relationship basis during later tool reads',{timeout:45000},async t=>{
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v12-request-basis-'));t.diagnostic(root);
const provider=await startToolProvider();
const host=await startTestHost({dataRoot:path.join(root,'host'),projectsRoot:path.join(root,'projects')});
const req=async(route:string,method='GET',body?:unknown,status=200):Promise<any>=>{const r=await host.request(route,method,body);const value=await r.json();if(r.status!==status)throw new Error(JSON.stringify({route,status:r.status,value}));return value;};
try{
 await req('/api/configuration','PUT',{name:'Spec synthetic basis',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic-strategy',apiKey:'synthetic-spec-only'});
 const draft={title:'事业家庭选择',outcome:'明确本人本周期安排',perspective:'personal',scope:{kind:'personal',id:'self',name:'本人'},measurement:{kind:'deliverable',criterion:'可核对安排与观察标准'},baseline:{state:'pending',description:'本人时间记录待补'},responsible:'本人'};
 const a=(await req('/api/strategy/goals','POST',{...draft,operationId:randomUUID()},201)).goal;
 const b=(await req('/api/strategy/goals','POST',{...draft,title:'本人健康改善',operationId:randomUUID()},201)).goal;
 for(const g of [a,b])await req('/api/strategy/goals/'+g.goalId+'/adopt','POST',{operationId:randomUUID(),version:g.version,expectedVersion:g.version,decision:'明确采用本人目标'});
 const rel=(await req('/api/strategy/relations','POST',{operationId:randomUUID(),from:{goalId:b.goalId,version:1},to:{goalId:a.goalId,version:1},kind:'contribution',responsibility:'本人时间安排',rationale:'原始关系v1，条件待核'},201)).relation;
 const discussion=(await req('/api/strategy/discussions','POST',{operationId:randomUUID(),goal:{goalId:a.goalId,version:1}},201)).discussion;
 let release!:(x:any)=>void;const gated=new Promise<any>(resolve=>{release=resolve;});
 provider.setResponder(ctx=>ctx.requestNumber===1?gated:{text:'合成回执，无专业评价。'});
 const userText='围绕已采用目标继续讨论，不改变目标承诺。';
 await req('/api/strategy/discussions/'+discussion.id+'/messages','POST',{requestId:randomUUID(),expectedRevision:discussion.revision,text:userText},202);
 await provider.waitForRequests(1);
 await req('/api/strategy/relations/'+rel.id+'/revisions','POST',{...rel,operationId:randomUUID(),expectedRevision:1,rationale:'运行中新增关系v2，应留在下一请求'},201);
 release({calls:[{name:'strategy_goals',arguments:{action:'read-goals'}}]});
 await provider.waitForRequests(2);
 let detail:any;for(let n=0;n<200;n++){detail=await req('/api/strategy/discussions/'+discussion.id);if(!detail.busy)break;await delay(20);}
 const firstUser=provider.requests[0].body.messages?.filter(x=>x.role==='user').at(-1);
 const secondTool=provider.requests[1].body.messages?.filter(x=>x.role==='tool').at(-1);
 const evidence={discussionId:discussion.id,goalId:a.goalId,initialPrompt:providerMessageText(firstUser?.content),sameRequestReadGoals:providerMessageText(secondTool?.content),userText,nativeUiMessage:detail.snapshot.messages.find((m:any)=>m.role==='user'),providerErrors:provider.errors};
 fs.writeFileSync(path.join(root,'evidence.json'),JSON.stringify(evidence,null,2));
 assert.ok(evidence.initialPrompt.includes('原始关系v1'));assert.ok(evidence.sameRequestReadGoals.includes('原始关系v1'));assert.ok(!evidence.sameRequestReadGoals.includes('运行中新增关系v2'));
 console.log(JSON.stringify({initialContainsV1:evidence.initialPrompt.includes('原始关系v1'),toolContainsV2:evidence.sameRequestReadGoals.includes('运行中新增关系v2'),toolContainsV1:evidence.sameRequestReadGoals.includes('原始关系v1'),evidence:path.join(root,'evidence.json')}));
}finally{await host.close();await provider.close();}

});
