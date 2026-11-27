import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { readJson } from './fixtures/joint-context.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';

for(const change of ['route','credential'] as const)test(`DW16: ${change} change revokes late Case declaration before COMMIT and stops the stale Pi turn`,{timeout:60_000},async t=>{
  const provider=await startToolProvider(),replacement=await startToolProvider();
  t.after(async()=>{await provider.close();await replacement.close();});
  const host=await startTestHost();t.after(()=>host.close());
  const input={name:'合成配置变更',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic',apiKey:'synthetic-before'};
  const {configuration}=await readJson(await host.request('/api/configuration','PUT',input));
  await readJson(await host.request('/api/cases/storage/initialize','POST',{}));
  const {case:record}=await readJson(await host.request('/api/cases','POST',await withCaseGoal(host,{operationId:randomUUID(),title:'合成迟到声明'})),201);
  const {issue:a}=await readJson(await host.request(`/api/cases/${record.id}/decisions/issues`,'POST',{operationId:randomUUID(),expectedRevision:record.revision,title:'事项A'}),201);
  const rev=(await readJson(await host.request(`/api/cases/${record.id}`))).case.revision;
  const {issue:b}=await readJson(await host.request(`/api/cases/${record.id}/decisions/issues`,'POST',{operationId:randomUUID(),expectedRevision:rev,title:'事项B'}),201);
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});t.after(()=>release());
  provider.setResponder(async ctx=>{if(ctx.recentToolResults.length)return{text:'结束'};await held;return{calls:[{name:'strategy_goals',arguments:{action:'case-save-issue-edge',fromIssueId:a.id,toIssueId:b.id,expectedEdgeRevision:0,explanation:'旧配置迟到关系'}}]};});
  const owner=JSON.stringify({role:'case',caseId:record.id,itemId:a.id}),route=`/api/business-role?owner=${encodeURIComponent(owner)}`;
  const accepted=await readJson(await host.request(route+'&action=messages','POST',{requestId:randomUUID(),text:'明确事项A承接事项B',expectedRevision:0}),202);
  await provider.waitForRequests(1);
  await readJson(await host.request('/api/configuration','PUT',{...input,id:configuration.id,baseUrl:change==='route'?replacement.baseUrl:provider.baseUrl,apiKey:'synthetic-after'}));
  release();
  const ownerFile=path.join(host.dataRoot,'business-role-discussions',accepted.discussion.id,'owner.json');
  let terminal='accepted';
  for(let i=0;i<100;i++){const value=JSON.parse(await fs.readFile(ownerFile,'utf8'));terminal=value.lastRun?.status;if(terminal!=='accepted')break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.notEqual(terminal,'accepted','original lifecycle must settle the revoked operation');
  const {edges}=await readJson(await host.request(`/api/cases/${record.id}/decisions/issue-edges`));
  assert.equal(edges.length,0,'late declaration must not create an edge or a saved receipt');
  assert.equal(provider.requests.length,1,'invalid captured configuration cannot trigger another old Provider request');
});
