import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';
import { randomUUID } from 'node:crypto';
import { withCaseGoal } from './fixtures/case-goal.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { setTimeout as wait } from 'node:timers/promises';

test('GSA export reads only the selected historical version and leaves goal history intact',async t=>{
  const host=await startTestHost(); t.after(()=>host.close());
  const draft={title:'到店 <script>',outcome:'旧目标',perspective:'personal',scope:{kind:'personal',id:'self',name:'本人'},measurement:{kind:'deliverable',criterion:'有原始记录'},baseline:{state:'pending',description:'尚无统计'},responsible:'店主',strategies:['晚间接待']};
  const create=await host.request('/api/strategy/goals','POST',{...draft,operationId:randomUUID()}); assert.equal(create.status,201);
  const {goal}=await create.json(), route='/api/strategy/goals/'+goal.goalId;
  assert.equal((await host.request(route+'/revisions','POST',{...draft,outcome:'新目标',strategies:['周末接待'],expectedVersion:1,operationId:randomUUID()})).status,201);
  const previous=await (await host.request(route)).json();
  for(const [version,expected,other] of [[1,'晚间接待','周末接待'],[2,'周末接待','晚间接待']] as const){
    const response=await host.request(route+'/versions/'+version+'/export');assert.equal(response.status,200);
    const {html,filename}=await response.json();assert.ok(html.includes(expected));assert.ok(!html.includes(other));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('本版尚无已记录'));assert.ok(filename.endsWith('v'+version+'.html'));
  }
  assert.equal((await host.request(route+'/versions/77/export')).ok,false);
  assert.deepEqual(await (await host.request(route)).json(),previous);
});

test('saving an exact strategic reply survives reopening and export does not create or hand off a version',{timeout:60000},async t=>{
  const provider=await startToolProvider(),host=await startTestHost();t.after(async()=>{await host.close();await provider.close()});
  await host.request('/api/configuration','PUT',{name:'合成',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic',apiKey:'synthetic-local'});
  const id=randomUUID(),base='/api/strategy/discussions/'+id;
  assert.equal((await host.request('/api/strategy/discussions','POST',{operationId:id,title:'夏季经营'})).status,201);
  provider.setResponder(()=>({text:'备选：延长接待或预约分流。'}));
  assert.equal((await host.request(base+'/messages','POST',{requestId:randomUUID(),text:'比较接待方案',expectedRevision:1})).status,202);
  let detail;for(let i=0;i<200;i++){detail=await (await host.request(base)).json();if(!detail.busy&&detail.replies.length)break;await wait(30);}
  assert.ok(detail.replies.length);
  const input={expectedRevision:detail.discussion.revision,source:detail.replies[0].source,options:'延长接待或预约',choice:'先做预约',rationale:'晚间增量待核',assumptions:'现有人手可排班',unknowns:'需核取消率'};
  const save=await host.request(base+'/versions','POST',input);assert.equal(save.status,201);
  assert.equal((await (await host.request(base+'/versions','POST',input)).json()).version.version,1);
  const changed=await (await host.request(base)).json();assert.notEqual(changed.discussion.revision,input.expectedRevision);
  assert.equal((await host.request(base+'/versions','POST',{...input,choice:'新取舍'})).status,409);
  assert.equal((await host.request(base+'/versions','POST',{...input,expectedRevision:changed.discussion.revision,choice:'新取舍'})).status,201);
  for(const [v,choice] of [[1,'先做预约'],[2,'新取舍']] as const){const {html}=await (await host.request(base+'/versions/'+v+'/export')).json();assert.ok(html.includes(choice));assert.ok(html.includes('备选：延长接待或预约分流。'));assert.ok(html.includes('候选'));}
  assert.equal((await (await host.request(base+'/versions')).json()).versions.length,2);
  assert.equal((await host.request(base+'/versions/1/handoff','POST',{expectedRevision:(await (await host.request(base)).json()).discussion.revision})).status,200);
  const handed=await (await host.request(base+'/versions/1')).json();
  const linked={title:'据已移交原稿梳理',outcome:'可核查接待安排',perspective:'personal',scope:handed.version.destination.scope,measurement:{kind:'deliverable',criterion:'回看当日记录'},baseline:{state:'pending',description:'待补'},responsible:'本人',source:handed.version.source,strategyContext:{summary:'先做预约'},strategyChoice:{discussionId:id,version:1,contentSha256:handed.version.contentSha256}};
  const goal=await (await host.request('/api/strategy/goals','POST',{...linked,operationId:randomUUID()})).json();
  assert.deepEqual(goal.goal?.strategyChoice,linked.strategyChoice);
  const wrong=await host.request('/api/strategy/goals','POST',{...linked,strategyChoice:{...linked.strategyChoice,version:2},operationId:randomUUID()});
  assert.equal(wrong.ok,false);
  assert.ok((await (await host.request(base+'/versions/1/export')).json()).html.includes('已交接'));
  const ownerPath = path.join(host.dataRoot,'strategy-discussions',id,'owner.json');
  const count=provider.requests.length;
  const original=(await (await host.request('/api/configuration')).json()).configuration;
  const changedModel=await host.request('/api/configuration','PUT',{id:original.id,name:'更换后',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'changed-model',apiKey:'synthetic-changed'});
  assert.equal(changedModel.status,200,await changedModel.clone().text());
  for(const route of [base+'/versions/1/export','/api/strategy/goals/'+goal.goal.goalId+'/versions/1/export'])assert.equal((await host.request(route)).status,200);
  assert.equal((await host.request('/api/configuration','DELETE')).status,200);
  for(const route of [base+'/versions/1',base+'/versions/1/export',base+'/versions/2/export','/api/strategy/goals/'+goal.goal.goalId+'/versions/1/export']){
    const response=await host.request(route); assert.equal(response.status,200,await response.clone().text());
  }
  const denied=await host.request(base+'/messages','POST',{requestId:randomUUID(),expectedRevision:(await (await host.request(base)).json()).discussion.revision,text:'发给合成模型'});
  assert.equal(denied.ok,false);assert.equal(provider.requests.length,count);
  const before = await readFile(ownerPath);
  const native = JSON.parse(before.toString('utf8')).sessionFile;
  assert.ok(path.relative(host.dataRoot,native).startsWith(path.join('strategy-discussions',id,'native')+path.sep));
  await rename(native,native+'.held');
  try {
    for (const route of [base+'/versions/1/export',base+'/versions/2/export','/api/strategy/goals/'+goal.goal.goalId+'/versions/1/export']) {
      const response = await host.request(route);
      assert.equal(response.ok,false,route);
      assert.equal((await response.json()).html,undefined);
    }
    assert.deepEqual(await readFile(ownerPath),before);
  } finally { await rename(native+'.held',native); }
  assert.ok((await (await host.request(base+'/versions/1/export')).json()).html.includes('先做预约'));
});

test('quantitative GSA distinguishes exact SAP packages sharing the same metric name and version', async t => {
  const host=await startTestHost();t.after(()=>host.close());
  const library=createMetricLibrary(path.join(host.dataRoot,'metric-assets'));
  const template=await readFile('extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml','utf8');
  for (const id of ['return-visit-members','return-visit-all']) {
    const metric=library.publish(preparePublication(Buffer.from(template.replaceAll('membership-repurchase',id))),'合成夹具');
    const input={operationId:randomUUID(),title:'回访',outcome:'增加',scope:{kind:'personal',id:'self',name:'本人'},perspective:'personal',responsible:'主管',baseline:{state:'pending',description:'待核'},
      measurement:{kind:'quantitative',sapMetric:{authority:'sap-metric',id:metric.id,metricName:metric.metricNames[0],version:metric.version},target:'本季达到 30%'}};
    const created=await host.request('/api/strategy/goals','POST',input);assert.equal(created.status,201,await created.clone().text());
    const {goal}=await created.json();
    const download=await host.request('/api/strategy/goals/'+goal.goalId+'/versions/1/export');assert.equal(download.status,200,await download.clone().text());
    const {html}=await download.json();
    for(const exact of [id,metric.metricNames[0],'1.0.0','本季达到 30%'])assert.ok(html.includes(exact),exact);
    assert.ok(!html.includes(id==='return-visit-members'?'return-visit-all':'return-visit-members'));
  }
});

test('a saved strategic reply supplied with an exact local Goal and frozen basis exports without the previous model',async t=>{
  const provider=await startToolProvider(),host=await startTestHost();t.after(async()=>{await host.close();await provider.close();});
  const req=async(route:string,method='GET',body?:unknown,status=200)=>{
    const result=await host.request(route,method,body);assert.equal(result.status,status,await result.clone().text());return result.json();
  };
  await req('/api/configuration','PUT',{name:'本地夹具',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'local-goal',apiKey:'synthetic-local-goal'});
  const primary=(await withCaseGoal(host,{operationId:randomUUID()})).goalBinding.primary;
  const related=(await withCaseGoal(host,{operationId:randomUUID()})).goalBinding.primary;
  const basis={from:primary,to:related,kind:'strategy',responsibility:'两地核对',rationale:'讨论当时的目标关系'};
  const {relation}=await req('/api/strategy/relations','POST',{...basis,operationId:randomUUID()},201);
  const {discussion}=await req('/api/strategy/discussions','POST',{operationId:randomUUID(),title:'本地目标原版',goal:primary},201);
  const route='/api/strategy/discussions/'+discussion.id;
  provider.setResponder(()=>({text:'只根据当时的本地目标做讨论。'}));
  await req(route+'/messages','POST',{requestId:randomUUID(),expectedRevision:discussion.revision,text:'比较原目标'},202);
  let detail;for(let i=0;i<200;i++){detail=await req(route);if(!detail.busy&&detail.replies.length)break;await wait(30);}
  await req(route+'/versions','POST',{expectedRevision:detail.discussion.revision,source:detail.replies[0].source,choice:'原安排',options:'延期或保留',rationale:'按所见目标',assumptions:'待核',unknowns:'期限'},201);
  await req('/api/strategy/relations/'+relation.id+'/revisions','POST',{...basis,rationale:'之后另行修正',expectedRevision:1,operationId:randomUUID()},201);
  const {project}=await req('/api/projects','POST',{name:'反馈原本地项目'},201);
  const projectSource=(await req('/api/strategy/sources')).sources.find((s:{ref:{authority:string;id:string}})=>s.ref.authority==='project'&&s.ref.id===project.id).ref;
  await req('/api/strategy/feedback','POST',{operationId:randomUUID(),goal:primary,level:'strategy',source:projectSource,note:'原业务记录的观察'},201);
  const {discussion:second}=await req('/api/strategy/discussions','POST',{operationId:randomUUID(),title:'读取本地反馈',goal:primary},201);
  const feedbackRoute='/api/strategy/discussions/'+second.id;
  provider.setResponder(ctx=>!ctx.recentToolResults.length?{calls:[{name:'strategy_goals',arguments:{action:'read-goals'}}]}:{text:'依据当时已记录的反馈'});
  await req(feedbackRoute+'/messages','POST',{requestId:randomUUID(),expectedRevision:1,text:'查当时的目标反馈'},202);
  for(let i=0;i<200;i++){detail=await req(feedbackRoute);if(!detail.busy&&detail.replies.some((r:{text:string})=>r.text==='依据当时已记录的反馈'))break;await wait(30);}
  await req(feedbackRoute+'/versions','POST',{expectedRevision:detail.discussion.revision,source:detail.replies.find((r:{text:string})=>r.text==='依据当时已记录的反馈').source,choice:'原反馈',options:'保留',rationale:'当时来源',assumptions:'待核',unknowns:'期限'},201);
  const checks=provider.requests.length;
  await req('/api/configuration','DELETE');
  await req(feedbackRoute+'/versions/1/export');
  await req('/api/projects/'+project.id,'PATCH',{name:'项目原来源版本已变'});
  assert.ok(!(await host.request(feedbackRoute+'/versions/1/export')).ok);
  assert.equal((await req(route+'/versions/1')).reply,'只根据当时的本地目标做讨论。');
  assert.match((await req(route+'/versions/1/export')).html,/原安排/);
  assert.equal(provider.requests.length,checks);
  // The reference and receipt must still resolve against the exact authority.
  const goalFile=path.join(host.dataRoot,'strategy-goals','index.json');
  const bytes=await readFile(goalFile);const idx=JSON.parse(bytes.toString());
  const historical=idx.relations.find((r:{id:string})=>r.id===relation.id).history[0];
  historical.rationale='合成来源已失去原文';
  await writeFile(goalFile,JSON.stringify(idx));
  try {
    const denied=await host.request(route+'/versions/1/export'); assert.ok(!denied.ok);assert.equal((await denied.json()).html,undefined);
  } finally {await writeFile(goalFile,bytes);}
  assert.equal(provider.requests.length,checks);
});
