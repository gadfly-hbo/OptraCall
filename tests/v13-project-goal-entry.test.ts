import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider,providerMessageText } from './fixtures/tool-provider.ts';

async function fixture(t: import('node:test').TestContext) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'optracall-pm-project-')), roots={dataRoot:path.join(directory,'host'),projectsRoot:path.join(directory,'projects')};
  let host=await startTestHost(roots);
  const provider=await startToolProvider();
  t.after(async()=>{await host.close();await provider.close();});
  async function call(route:string,method='GET',data?:unknown,status=200) {
    const response=await host.request(route,method,data);
    const result=await response.json();assert.equal(response.status,status,JSON.stringify({route,result}));return result;
  }
  await call('/api/configuration','PUT',{name:'隐私隔离模型',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'local-project-test',apiKey:'synthetic-only'});
  provider.setResponder(()=>({text:'本轮测试交付。'}));
  async function goal(marker:string) {
    const base={title:marker,outcome:marker+'目标正文',strategies:[marker+'策略'],scope:{kind:'personal',id:'synthetic-project',name:marker+'范围'},perspective:'personal',
      usageContext:{kind:'personal',background:marker+'用途'},measurement:{kind:'deliverable',criterion:'可核'},responsible:'测试人员',baseline:{state:'pending',description:'基线待核'}};
    const {goal:g}=await call('/api/strategy/goals','POST',{...base,operationId:randomUUID()},201);
    await call('/api/strategy/goals/'+g.goalId+'/adopt','POST',{version:1,expectedVersion:1,operationId:randomUUID(),decision:'采用'});
    return {base,ref:{goalId:g.goalId,version:1}};
  }
  function prompt(){return provider.requests.at(-1)!.body.messages!.filter(m=>m.role==='user').map(m=>providerMessageText(m.content)).join('\n');}
  async function run(route:string,isRole=false,revision=0) {
    const requestId=randomUUID();
    await call(route+(isRole?'&action=messages':'/messages'),'POST',{text:'核查本次交接',requestId,expectedRevision:revision},202);
    for(let i=0;i<300;i++){const state=await call(route);const run=(isRole?state.discussion:state.task)?.lastRun;if(run?.status==='failed')assert.fail(JSON.stringify(run));
      if(run?.id===requestId&&run.status==='completed')return {state,prompt:prompt()};await delay(25);}
    assert.fail('Expected synthetic run to complete');
  }
  const role=(projectId:string,issue?:{caseId:string;issueId:string})=>'/api/business-role?owner='+encodeURIComponent(JSON.stringify({role:'project',projectId,...(issue?{issue}:{})}));
  const restart=async()=>{await host.close();host=await startTestHost(roots);};
  return {call,goal,run,role,restart,provider,request:(route:string,method?:string,input?:unknown)=>host.request(route,method,input)};
}

test('fixed old GSA starts Project and two manual Tasks sharing agreement v1 survive adoption, agreement upgrades and reopen', {timeout:60000}, async t=>{
  const {call,goal,run,role,restart}=await fixture(t);
  const {base,ref}=await goal('旧准确版');
  await call('/api/strategy/goals/'+ref.goalId+'/revisions','POST',{...base,title:'后续版',outcome:'不应进入旧版',expectedVersion:1,operationId:randomUUID()},201);
  await call('/api/strategy/goals/'+ref.goalId+'/adopt','POST',{version:2,expectedVersion:2,operationId:randomUUID(),decision:'下一版'});
  const {project}=await call('/api/projects','POST',{name:'来自旧版的项目',goalOrigin:{goal:ref}},201);
  const p='/api/projects/'+project.id;
  assert.deepEqual(project.goalOrigin.goal,ref);assert.equal(project.tasks.length,0);
  await restart();
  const fromRole=await run(role(project.id),true);
  for(const marker of ['旧准确版目标正文','旧准确版策略','旧准确版用途'])assert.ok(fromRole.prompt.includes(marker));
  assert.ok(!fromRole.prompt.includes('不应进入旧版'));
  await call(p+'/agreements','POST',{operationId:randomUUID(),expectedVersion:0,text:'第一版约定独有码'});
  const tasks=[];
  for(const type of ['requirement','plan']){
    const {task}=await call(p+'/tasks','POST',{name:type,operationId:randomUUID(),assignment:{type,skill:null,agreementVersion:1}},201);
    const {state,prompt}=await run(p+'/tasks/'+task.id);
    for(const marker of ['旧准确版目标正文','旧准确版用途','第一版约定独有码'])assert.ok(prompt.includes(marker));
    tasks.push({id:task.id,file:state.task.sessionFile,bytes:await readFile(state.task.sessionFile)});
  }
  await call(p+'/agreements','POST',{operationId:randomUUID(),expectedVersion:1,text:'第二版不要倒灌'});
  await restart();
  for(const task of tasks){
    const state=await call(p+'/tasks/'+task.id);
    assert.equal(state.task.sessionFile,task.file);assert.deepEqual(await readFile(task.file),task.bytes);
    assert.equal(state.task.assignment.agreementVersion,1);
    const marker=task.bytes.toString('utf8').trim().split('\n').map(line=>JSON.parse(line)).find(e=>e.data?.providedContext?.projectGoalOrigin);
    assert.deepEqual(marker?.data.providedContext.projectGoalOrigin,ref);
    const {prompt}=await run(p+'/tasks/'+task.id);
    assert.ok(prompt.includes('第一版约定独有码'));assert.ok(!prompt.includes('第二版不要倒灌'));
  }
  const {project:independent}=await call('/api/projects','POST',{name:'独立项目'},201);
  const actual=await run(role(independent.id),true);assert.ok(!actual.prompt.includes('旧准确版'));
});

test('shared project receives the original Case goal, strategy and issue evidence; after unlink a completed Task creation is readable only by its unchanged operation', {timeout:60000}, async t=>{
  const {call,goal,run,role,request,provider}=await fixture(t);
  const {project}=await call('/api/projects','POST',{name:'共享项目'},201), p='/api/projects/'+project.id;
  await call('/api/cases/storage/initialize','POST',{});
  async function linked(marker:string) {
    const {ref}=await goal(marker);
    const {case:c}=await call('/api/cases','POST',{title:marker+'年度',description:marker+'原始补证依据',operationId:randomUUID(),goalBinding:{primary:ref,related:[],strategy:marker+'策略'}},201);
    const {case:l}=await call('/api/cases/'+c.id+'/projects','POST',{projectId:project.id,operationId:randomUUID(),expectedRevision:1});
    const {issue}=await call('/api/cases/'+c.id+'/decisions/issues','POST',{title:marker+'事项',expectedRevision:l.revision,operationId:randomUUID()},201);
    return {caseId:c.id,issueId:issue.id};
  }
  const a=await linked('甲边界'), b=await linked('乙边界');
  const body={name:'来源计划',operationId:randomUUID(),assignment:{type:'plan',skill:null,issue:a}};
  // The caller ignores the first response after persistence, matching a lost 201.
  const created=await request(p+'/tasks','POST',body);assert.equal(created.status,201);await created.body?.cancel();
  const aa=await run(role(project.id,a),true), bb=await run(role(project.id,b),true);
  for(const [probe,include,exclude] of [[aa,'甲边界','乙边界'],[bb,'乙边界','甲边界']] as const){
    for(const suffix of ['目标正文','策略','原始补证依据'])assert.ok(probe.prompt.includes(include+suffix),suffix);
    assert.ok(!probe.prompt.includes(exclude));
  }
  await call('/api/cases/'+a.caseId+'/projects/'+project.id,'DELETE',{operationId:randomUUID(),expectedRevision:(await call('/api/cases/'+a.caseId)).case.revision});
  const before=provider.requests.length;
  const receipt=await call(p+'/tasks','POST',body,201);assert.equal(receipt.task.id,body.operationId);
  assert.ok([400,409].includes((await request(p+'/tasks','POST',{...body,name:'另一输入'})).status));
  assert.ok([403,409].includes((await request(p+'/tasks','POST',{...body,operationId:randomUUID()})).status));
  assert.ok([403,409].includes((await request(role(project.id,a))).status));
  assert.ok([403,409].includes((await request(p+'/tasks/'+body.operationId+'/messages','POST',{requestId:randomUUID(),text:'已撤权'})).status));
  assert.equal(provider.requests.length,before);
  assert.equal((await call(p)).project.tasks.length,1);
  assert.equal((await call(role(project.id,b))).discussion.lastRun.status,'completed');
});

test('replaying the identical Task creation reads its original receipt after upstream reply is archived', {timeout:45000}, async t=>{
  const {call,run,request}=await fixture(t);
  const {project}=await call('/api/projects','POST',{name:'来源回执项目'},201), route='/api/projects/'+project.id+'/tasks';
  const {task}=await call(route,'POST',{name:'原成果',assignment:{type:'requirement',skill:null}},201);
  await run(route+'/'+task.id);
  const available=await call(route+'/'+task.id+'/results'), reply=available.details.results.find((r:{kind:string})=>r.kind==='native-reply');
  assert.ok(reply,JSON.stringify(available.details));
  const input={name:'下游',operationId:randomUUID(),assignment:{type:'analysis',skill:null,sources:[{taskId:task.id,key:reply.id}]}};
  const lost=await request(route,'POST',input);assert.equal(lost.status,201);await lost.body?.cancel();
  await call(route+'/'+task.id+'/archive','POST',{});
  assert.equal((await call(route,'POST',input,201)).task.id,input.operationId);
  const changed=await request(route,'POST',{...input,name:'修改输入'});assert.ok([400,409].includes(changed.status));
  assert.ok([403,409].includes((await request(route,'POST',{...input,operationId:randomUUID()})).status));
  const blocked=await request(route+'/'+input.operationId+'/messages','POST',{requestId:randomUUID(),text:'用已撤权原件'});
  assert.ok([403,404,409].includes(blocked.status),blocked.status+' '+await blocked.text());
  const {project:other}=await call('/api/projects','POST',{name:'另一归属'},201);
  assert.ok([403,404,409].includes((await request('/api/projects/'+other.id+'/tasks','POST',input)).status));
  assert.equal((await call('/api/projects/'+other.id)).project.tasks.length,0);
  assert.equal((await call('/api/projects/'+project.id)).project.tasks.length,2);
});

test('fixed GSA Case evidence remains bound to the source revision and the actual receiving project after withdrawal', {timeout:45000}, async t=>{
  const {call,goal,run,role,request,provider}=await fixture(t);
  const initial=await goal('关联原案');
  await call('/api/cases/storage/initialize','POST',{});
  const {case:c}=await call('/api/cases','POST',{title:'原案',description:'来源第一版准确正文',operationId:randomUUID(),goalBinding:{primary:initial.ref,related:[],strategy:initial.base.strategies[0]}},201);
  const {goal:next}=await call('/api/strategy/goals','POST',{...initial.base,title:'有原案来源的经营目标',source:{authority:'case',id:c.id,version:1},operationId:randomUUID()},201);
  await call('/api/strategy/goals/'+next.goalId+'/adopt','POST',{version:1,expectedVersion:1,operationId:randomUUID(),decision:'采用'});
  const {project}=await call('/api/projects','POST',{name:'准确历史依据测试',goalOrigin:{goal:{goalId:next.goalId,version:1}}},201);
  const taskRoute='/api/projects/'+project.id+'/tasks';
  assert.equal((await request(role(project.id))).status,403);
  const updated=await call('/api/cases/'+c.id+'/projects','POST',{operationId:randomUUID(),expectedRevision:1,projectId:project.id});
  const {task}=await call(taskRoute,'POST',{name:'旧原依据核对',assignment:{type:'analysis',skill:null}},201);
  const taskPath=taskRoute+'/'+task.id;
  assert.ok((await run(role(project.id),true)).prompt.includes('来源第一版准确正文'));
  assert.ok((await run(taskPath)).prompt.includes('来源第一版准确正文'));
  const before=provider.requests.length;
  await call('/api/cases/'+c.id+'/projects/'+project.id,'DELETE',{operationId:randomUUID(),expectedRevision:updated.case.revision});
  for(const route of [role(project.id),taskPath])assert.ok([403,409].includes((await request(route)).status));
  assert.ok([403,409].includes((await request(taskPath+'/messages','POST',{requestId:randomUUID(),text:'不要以新资料替代'})).status));
  assert.equal(provider.requests.length,before);
});

test('Goal derived from the exact upstream Teach review can enter only a project with the current Case grant', {timeout:120000}, async t=>{
  const {verifyConfirmedRounds}=await import('./fixtures/pm-case-rounds.ts');
  await verifyConfirmedRounds(t,async({host,provider,receipt})=>{
    async function api(route:string,method='GET',input?:unknown,status=200){
      const r=await host.request(route,method,input),v=await r.json();assert.equal(r.status,status,JSON.stringify({route,v}));return v;
    }
    const primary=(receipt.goal as {primary:{goalId:string;version:number}}).primary;
    const ref={caseId:receipt.caseId,issueId:receipt.issueId,choiceId:receipt.second,reviewId:receipt.review};
    const owner={role:'goal',...primary,teachReview:ref};
    const base='/api/business-role?owner='+encodeURIComponent(JSON.stringify(owner)),gsa='/api/strategy/goals/'+primary.goalId;
    const old=(await api(gsa)).goal.versions.find((g:{version:number})=>g.version===primary.version);
    const draft={title:'由指定复盘准备的目标',outcome:'保留原复盘来源的旧版观察',perspective:old.perspective,scope:old.scope,measurement:old.measurement,baseline:old.baseline,responsible:old.responsible,strategies:old.strategies};
    provider.setResponder(turn=>turn.recentToolResults.length ? {text:'已准备复盘建议。'}:
      {calls:[{name:'strategy_goals',arguments:{action:'propose-goal',draft}}]});
    const requestId=randomUUID();const start=await api(base);
    await api(base+'&action=messages','POST',{requestId,expectedRevision:start.discussion?.revision??0,text:'准备目标修订建议'},202);
    let suggestion;
    for(let i=0;i<300;i++){
      const v=await api(base);if(!v.busy&&v.discussion?.lastRun?.status==='completed'){suggestion=v.goalDrafts.at(-1);break;}await delay(25);
    }
    assert.ok(suggestion?.source);
    const expectedVersion=(await api(gsa)).goal.currentVersion;
    const {goal:version}=await api(gsa+'/revisions','POST',{...suggestion.draft,roleSuggestion:suggestion.source,expectedVersion,operationId:randomUUID()},201);
    await api(gsa+'/adopt','POST',{version:version.version,expectedVersion:version.version,operationId:randomUUID(),decision:'采用复盘后的候选'});
    const {project}=await api('/api/projects','POST',{name:'由复盘产生的目标项目',goalOrigin:{goal:{goalId:primary.goalId,version:version.version}}},201);
    const projectRole='/api/business-role?owner='+encodeURIComponent(JSON.stringify({role:'project',projectId:project.id}));
    const before=provider.requests.length;
    await api(projectRole,'GET',undefined,403);
    const c='/api/cases/'+String(ref.caseId);
    await api(c+'/projects','POST',{projectId:project.id,expectedRevision:(await api(c)).case.revision,operationId:randomUUID()});
    assert.equal((await api(projectRole+'&action=origin')).origin.goal.title,draft.title);
    await api(c+'/projects/'+project.id,'DELETE',{expectedRevision:(await api(c)).case.revision,operationId:randomUUID()});
    await api(projectRole,'GET',undefined,403);
    assert.equal(provider.requests.length,before);
    const directory=await api('/api/strategy/sources');
    const source=directory.sources.find((s:{ref:{authority:string;version:unknown}})=>s.ref.authority==='case' && s.ref.version===receipt.second)?.ref;
    assert.ok(source,'selected original Case choice from the GSA directory');
    const originalPlan=receipt.plan as {taskId:string;messageId:string;expectedTextSha256:string};
    const {goal:sourced}=await api('/api/strategy/goals','POST',{...draft,title:'从原取舍选定的目标',source,operationId:randomUUID()},201);
    await api('/api/strategy/goals/'+sourced.goalId+'/adopt','POST',{version:1,expectedVersion:1,operationId:randomUUID(),decision:'采用该原取舍'});
    const {project:choiceProject}=await api('/api/projects','POST',{name:'承接确切取舍的另一项目',goalOrigin:{goal:{goalId:sourced.goalId,version:1}}},201);
    const choiceRole='/api/business-role?owner='+encodeURIComponent(JSON.stringify({role:'project',projectId:choiceProject.id}));
    await api(choiceRole,'GET',undefined,403);
    await api(c+'/projects','POST',{projectId:choiceProject.id,expectedRevision:(await api(c)).case.revision,operationId:randomUUID()});
    const details=(await api(choiceRole+'&action=origin')).origin.goal.evidence[0];
    assert.equal(details.choice.id,receipt.second);assert.equal(details.choice.issue.issueId,receipt.issueId);
    assert.ok(details.replies.some((r:{source:{messageId:string}})=>r.source.messageId===originalPlan.messageId));
    const form='/api/projects/'+choiceProject.id+'/tasks';
    const {task}=await api(form,'POST',{name:'以准确选项启动',assignment:{type:'requirement',skill:null}},201);
    provider.setResponder(()=>({text:'选中的原取舍和原计划已收到。'}));
    await api(form+'/'+task.id+'/messages','POST',{requestId:randomUUID(),text:'核对原据'},202);
    for(let i=0;i<250;i++){if((await api(form+'/'+task.id)).task.lastRun?.status==='completed')break;await delay(25);}
    assert.equal((await api(form+'/'+task.id)).task.lastRun.status,'completed');
    assert.ok(provider.requests.at(-1)!.body.messages!.filter(m=>m.role==='user').some(m=>providerMessageText(m.content).includes(originalPlan.expectedTextSha256)));
    await api(c+'/projects/'+choiceProject.id,'DELETE',{expectedRevision:(await api(c)).case.revision,operationId:randomUUID()});
    await api(choiceRole,'GET',undefined,403);

    // The native reply is reused without a new strategy version, as in older records.
    const {discussion}=await api('/api/strategy/discussions','POST',{operationId:randomUUID(),goal:{goalId:sourced.goalId,version:1}},201);
    const domain='/api/strategy/discussions/'+discussion.id, marker='仅所选第二轮原方案';
    provider.setResponder(()=>({text:marker}));
    await api(domain+'/messages','POST',{requestId:randomUUID(),text:'讨论所选取舍',expectedRevision:discussion.revision},202);
    let fixed;
    for(let i=0;i<300;i++){
      const state=await api(domain);
      fixed=state.replies.find((r:{text:string})=>r.text===marker)?.source;
      if(fixed&&!state.busy)break;
      await delay(25);
    }
    assert.ok(fixed);
    const nested=(await api('/api/strategy/goals','POST',{...draft,title:'经战略原回复的取舍',source:fixed,operationId:randomUUID()},201)).goal;
    await api('/api/strategy/goals/'+nested.goalId+'/adopt','POST',{version:1,expectedVersion:1,operationId:randomUUID(),decision:'采用'});
    const incoming=(await api('/api/projects','POST',{name:'承接两层原方案',goalOrigin:{goal:{goalId:nested.goalId,version:1}}},201)).project;
    const nestedRole='/api/business-role?owner='+encodeURIComponent(JSON.stringify({role:'project',projectId:incoming.id}));
    await api(nestedRole+'&action=origin','GET',undefined,403);
    const linkProject=async(projectId:string,on:boolean)=>api(c+'/projects'+(on?'':'/'+projectId),on?'POST':'DELETE',{projectId,expectedRevision:(await api(c)).case.revision,operationId:randomUUID()});
    await linkProject(incoming.id,true);
    assert.equal((await api(nestedRole+'&action=origin')).origin.goal.evidence[0].body,marker);
    const list='/api/projects/'+incoming.id+'/tasks';
    const manual=(await api(list,'POST',{name:'核对第二轮依据',assignment:{type:'requirement',skill:null}},201)).task;
    const path=list+'/'+manual.id;
    await api(path+'/messages','POST',{requestId:randomUUID(),text:'读回准确的战略原回复'},202);
    for(let i=0;i<300;i++){if((await api(path)).task.lastRun?.status==='completed')break;await delay(25);}
    assert.equal((await api(path)).task.lastRun.status,'completed');
    assert.ok(provider.requests.at(-1)!.body.messages!.some(m=>providerMessageText(m.content).includes(marker)));
    const originalProject=(receipt.plan as {projectId:string}).projectId;
    await linkProject(originalProject,false);
    const sends=provider.requests.length;
    for(const result of [await host.request(nestedRole+'&action=origin'),await host.request(path+'/messages','POST',{requestId:randomUUID(),text:'原项目已经解除关联'})]) {
      assert.ok([403,409].includes(result.status),await result.text());
    }
    assert.equal(provider.requests.length,sends);
    await linkProject(originalProject,true);
    assert.equal((await api(nestedRole+'&action=origin')).origin.goal.evidence[0].body,marker);

  });
});

test('two strategic replies preserve the case grant through frozen candidate goals and unversioned-handoff records', {timeout:90000}, async t=>{
  const {call,goal,role,provider,run,request}=await fixture(t);
  const initial=await goal('接收范围');
  await call('/api/cases/storage/initialize','POST',{});
  const {case:original}=await call('/api/cases','POST',{title:'原案',description:'固定原案依据',operationId:randomUUID(),
    goalBinding:{primary:initial.ref,related:[],strategy:initial.base.strategies[0]}},201);
  const candidate=async(title:string,source:unknown)=>{
    const {goal:created}=await call('/api/strategy/goals','POST',{...initial.base,title,outcome:title,source,operationId:randomUUID()},201);
    return {goalId:created.goalId,version:created.version as number};
  };
  const derive=async(ref:typeof initial.ref, marker:string)=>{
    const {discussion}=await call('/api/strategy/discussions','POST',{operationId:randomUUID(),goal:ref},201);
    const route='/api/strategy/discussions/'+discussion.id;
    provider.setResponder(()=>({text:marker}));
    await call(route+'/messages','POST',{text:'根据所选候选目标核对',requestId:randomUUID(),expectedRevision:discussion.revision},202);
    for(let n=0;n<300;n++){
      const state=await call(route);
      const reply=state.replies.find((r:{text:string})=>r.text===marker);
      if(!state.busy&&reply)return reply.source;
      await delay(25);
    }
    assert.fail('missing exact assistant reply');
  };
  const first=await candidate('原案候选',{authority:'case',id:original.id,version:1});
  const intermediate=await candidate('中间候选',await derive(first,'首次原回复'));
  const last=await candidate('交给项目的目标',await derive(intermediate,'二次原回复'));
  await call('/api/strategy/goals/'+last.goalId+'/adopt','POST',{...last,expectedVersion:1,operationId:randomUUID(),decision:'采用'});
  const {project}=await call('/api/projects','POST',{name:'两次转交',goalOrigin:{goal:last}},201);
  const owner=role(project.id),links='/api/cases/'+original.id+'/projects';
  const count=provider.requests.length;
  assert.equal((await request(owner+'&action=origin')).status,403);
  assert.equal((await request(owner+'&action=messages','POST',{requestId:randomUUID(),expectedRevision:0,text:'核当前资格'})).status,403);
  assert.equal(provider.requests.length,count);
  await call(links,'POST',{operationId:randomUUID(),expectedRevision:original.revision,projectId:project.id});
  assert.match((await run(owner,true)).prompt,/二次原回复/);
  const rev=(await call('/api/cases/'+original.id)).case.revision;
  await call(links+'/'+project.id,'DELETE',{operationId:randomUUID(),expectedRevision:rev});
  assert.equal((await request(owner+'&action=origin')).status,403);
});
