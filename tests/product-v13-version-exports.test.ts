import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
