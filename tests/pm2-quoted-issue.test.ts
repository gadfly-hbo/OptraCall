import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { withCaseGoal } from './fixtures/case-goal.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { providerMessageText, startToolProvider, type ToolProviderResponder } from './fixtures/tool-provider.ts';

test('Decision Task records the bound issue’s exact quoted choice and original Board operations across rounds', {timeout:120_000}, async t => {
  const base = path.resolve('.local/product-v13/pm2/decision');
  await mkdir(base, {recursive:true});
  const root = await mkdtemp(path.join(base, 'pi-'));
  t.diagnostic(root);
  const host = await startTestHost({dataRoot:path.join(root,'host'),projectsRoot:path.join(root,'projects')});
  const provider = await startToolProvider();
  t.after(async () => {await host.close(); await provider.close();});
  await mkdir(path.join(host.dataRoot,'pi'), {recursive:true});
  await writeFile(path.join(host.dataRoot,'pi/settings.json'), JSON.stringify({retry:{enabled:false}}));
  async function api(route:string, method='GET', input?:unknown, expected?:number) {
    const response = await host.request(route,method,input), body = await response.json();
    assert.ok(expected === undefined ? response.ok : response.status === expected, JSON.stringify({route,status:response.status,body}));
    return body;
  }
  await api('/api/configuration','PUT',{name:'原话决策合成',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'decision-issue',apiKey:'synthetic-only'});
  await api('/api/cases/storage/initialize','POST',{});
  const {case:record}=await api('/api/cases','POST',await withCaseGoal(host,{operationId:randomUUID(),title:'会员回访'}));
  const {project}=await api('/api/projects','POST',{name:'门店试行'});
  const {project:planProject}=await api('/api/projects','POST',{name:'北店计划来源'});
  const casePath='/api/cases/'+record.id;
  const tasks=(projectId:string)=>'/api/projects/'+projectId+'/tasks';
  await api(casePath+'/projects','POST',{projectId:project.id,expectedRevision:record.revision,operationId:randomUUID()});
  async function linkPlanSource(active:boolean) {
    const expectedRevision=(await api(casePath)).case.revision;
    return api(casePath+'/projects'+(active?'':'/'+planProject.id),active?'POST':'DELETE',{projectId:planProject.id,expectedRevision,operationId:randomUUID()});
  }
  await linkPlanSource(true);
  async function makeIssue(title:string) {
    const rev=(await api(casePath)).case.revision;
    return (await api(casePath+'/decisions/issues','POST',{title,expectedRevision:rev,operationId:randomUUID()})).issue.id as string;
  }
  const sales=await makeIssue('在哪家先回访'), supply=await makeIssue('何时补充物料');
  async function makeTask(type:string,issueId:string,name:string,projectId=project.id) {
    return (await api(tasks(projectId),'POST',{name,assignment:{type,skill:null,issue:{caseId:record.id,issueId}}})).task.id as string;
  }
  async function turn(taskId:string,text:string,responder:ToolProviderResponder,projectId=project.id) {
    provider.setResponder(responder);
    const requestId=randomUUID(), route=tasks(projectId)+'/'+taskId;
    await api(route+'/messages','POST',{requestId,text},202);
    for(let i=0;i<250;i++){
      const state=await api(route);
      if(state.task.lastRun?.id===requestId && state.task.lastRun.status!=='running' && !state.snapshot.busy) {
        assert.equal(state.task.lastRun.status,'completed',JSON.stringify(state.task.lastRun)); return requestId;
      }
      await delay(45);
    }
    assert.fail('Pi request timed out '+requestId);
  }
  const issuePath=(id:string)=>casePath+'/decisions/issues/'+id;
  async function plan(issueId:string,title:string,projectId=project.id) {
    const taskId=await makeTask('plan',issueId,title,projectId);
    await turn(taskId,'请提出一份方案',()=>({text:title+' 的合成准确方案。'}),projectId);
    const sources=await api(issuePath(issueId)+'/sources'), source=sources.replies.find((r:any)=>r.source.taskId===taskId).source;
    const {revision}=await api(issuePath(issueId)+'/plans','POST',{operationId:randomUUID(),source});
    return {type:'case-decision',caseId:record.id,caseStoreId:revision.caseStoreId,recordId:revision.recordId,revision:revision.revision};
  }
  const first=await plan(sales,'A 仅北店回访',planProject.id), second=await plan(sales,'B 仅南店回访'), foreign=await plan(supply,'C 补物料');
  const decision=await makeTask('decision',sales,'会员决策'), other=await makeTask('decision',supply,'物料决策');
  const evidence:unknown[]=[];
  async function quoted(taskId:string,text:string,input:Record<string,unknown>,repeat=false) {
    const replies:any[]=[];
    const command=input.action==='read'?input:{...input,quote:{text,start:0,end:text.length}};
    const requestId=await turn(taskId,text,context=>{
      if(context.recentToolResults.length) {
        const raw=providerMessageText(context.recentToolResults.at(-1)!.content);
        try {replies.push(JSON.parse(raw));} catch {replies.push(raw);}
      }
      if(replies.length < (repeat?2:1))return {calls:[{name:'record_user_decision',arguments:command}]};
      return {text:'已核对原操作回执。'};
    });
    assert.ok(replies.length);
    evidence.push({taskId,requestId,text,input,replies});
    await writeFile(path.join(root,'pi-tool-receipts.json'),JSON.stringify({caseId:record.id,sales,supply,evidence},null,2));
    if(repeat)assert.deepEqual(replies[0],replies[1]);
    return replies[0];
  }
  const pick=(strategyRef:typeof first,expectedPreviousChoiceId:string|null,choice='trial')=>({action:'choose-strategy',strategyRef,expectedPreviousChoiceId,choice,reason:'用户限定试行范围'});
  const a=await quoted(decision,'这次选择 A，北店小范围试行。',pick(first,null),true);
  assert.equal(a.status,'completed',JSON.stringify(a));
  assert.equal(a.authority.issueId,sales);
  assert.equal((await api(issuePath(sales))).rounds[0].choice.choiceId,a.authority.choiceId);
  assert.equal((await api(issuePath(supply))).rounds.length,0);
  const selection=(receipt:any)=>({choiceId:receipt.authority.choiceId,strategyRef:receipt.authority.strategyRef});
  const arrange=(receipt:any,title:string)=>({action:'arrange-actions',...selection(receipt),title,scope:title,checks:[],actions:[{kind:'create',title}]});
  const auth=(receipt:any,target:any,decision='authorize')=>({action:'authorize-action',decision,...selection(receipt),itemId:target.itemId,taskId:target.taskId,itemVersion:target.itemVersion,taskVersion:target.taskVersion,expectedPreviousAuthorizationId:target.authorizationId,scope:'本次原话范围'});
  const formChoose=(issueId:string,ref:typeof first,previous:string|null,choice:string,expected=200)=>api(casePath+'/decisions/'+ref.recordId+'/choice','POST',{operationId:randomUUID(),caseStoreId:ref.caseStoreId,strategyRef:ref,issueId,choice,expectedPreviousChoiceId:previous},expected);
  const formAuth=(issueId:string,receipt:any,expected=200)=>api(issuePath(issueId)+'/authorize','POST',{operationId:randomUUID(),choiceId:receipt.authority.choiceId,projectId:project.id,title:'原事项试行',scope:'当次授权'},expected);
  const rejected=(reply:unknown,code:string)=>assert.equal(reply,code);
  const original=await quoted(decision,'只在北店安排回访。',arrange(a,'北店首次回访'),true);
  assert.equal(original.status,'completed',JSON.stringify(original));
  const originalTarget=original.authority.actions[0];
  assert.equal((await api(issuePath(sales))).rounds[0].actions[0].currentAuthorizationId,originalTarget.authorizationId);
  await linkPlanSource(false);
  rejected(await quoted(decision,'原方案仍可用时再次选择 A。',pick(first,a.authority.choiceId)),'project_not_linked');
  rejected(await quoted(decision,'按原北店依据追加行动。',arrange(a,'失去依据后追加')),'project_not_linked');
  rejected(await quoted(decision,'为北店原任务新授权。',auth(a,originalTarget)),'project_not_linked');
  assert.equal((await quoted(decision,'读原北店安排。',{action:'read',operationId:original.operationId})).operation.actions[0].authorizationId,originalTarget.authorizationId);
  assert.equal((await quoted(decision,'读原北店取舍。',{action:'read',operationId:a.operationId})).choice.choiceId,a.authority.choiceId);
  assert.equal((await api(issuePath(sales))).rounds.length,1);
  await linkPlanSource(true);
  const {choice:bChoice}=await formChoose(sales,second,a.authority.choiceId,'trial');
  const b={authority:bChoice};
  rejected(await quoted(decision,'再按 A 安排一次。',arrange(a,'过期 A 的安排')),'case_choice_conflict');
  rejected(await quoted(decision,'再授权 A 原行动。',auth(a,originalTarget)),'case_choice_conflict');
  assert.equal((await formAuth(sales,a,409)).code,'case_choice_conflict');
  assert.equal((await api('/api/decision-board')).items.length,1);
  rejected(await quoted(other,'本事项选择北店。',pick(first,null)),'case_issue_scope_mismatch');
  assert.equal((await formChoose(supply,first,null,'trial',409)).code,'case_issue_scope_mismatch');
  const c=await quoted(other,'先试 C 补物料。',pick(foreign,null));
  assert.equal(c.authority.issueId,supply);
  rejected(await quoted(decision,'登记其他事项的安排。',arrange(c,'物料行动')),'case_issue_scope_mismatch');
  assert.equal((await formAuth(sales,c,409)).code,'case_issue_scope_mismatch');
  const cf=await formAuth(supply,c);
  const foreignTarget=cf.arrangement.actions[0];
  rejected(await quoted(decision,'用会员事项取舍改写物料行动授权。',auth(b,foreignTarget)),'case_issue_scope_mismatch');
  const reuse={...arrange(b,'复用物料原行动'),actions:[{kind:'reuse',itemId:foreignTarget.itemId,taskId:foreignTarget.taskId,itemVersion:foreignTarget.itemVersion,taskVersion:foreignTarget.taskVersion,expectedPreviousAuthorizationId:foreignTarget.authorizationId}]};
  rejected(await quoted(decision,'给会员事项复用物料原行动。',reuse),'case_issue_scope_mismatch');
  const catalog=await quoted(decision,'查本事项所见方案和行动。',{action:'read'});
  assert.ok(catalog.catalog.items.some((item:any)=>item.strategyRef.recordId===first.recordId));
  assert.ok(!catalog.catalog.items.some((item:any)=>item.strategyRef.recordId===foreign.recordId));
  assert.equal(catalog.catalog.currentChoiceId,bChoice.choiceId);
  assert.ok(!catalog.actions.some((row:any)=>row.task.id===foreignTarget.taskId));
  const get=(operationId:string)=>({action:'read',operationId});
  const oldChoice=await quoted(decision,'查 A 的原取舍。',get(a.operationId));
  assert.equal(oldChoice.choice.choiceId,a.authority.choiceId);
  assert.equal((await quoted(decision,'查原北店安排。',get(original.operationId))).operation.actions[0].authorizationId,originalTarget.authorizationId);
  rejected(await quoted(other,'核对并非本 Task 的取舍。',get(a.operationId)),'quoted_decision_scope_mismatch');
  rejected(await quoted(decision,'用 B 撤回不属于它的授权。',auth(b,originalTarget,'revoke')),'authorization_scope_mismatch');
  const withdrawal=await quoted(decision,'撤回 A 的原北店授权。',auth(a,originalTarget,'revoke'),true);
  assert.equal(withdrawal.authority.previousAuthorizationId,originalTarget.authorizationId);
  const readWithdraw=await quoted(decision,'读回刚才的原撤回。',get(withdrawal.operationId));
  assert.equal(readWithdraw.authorization.authorizationId,withdrawal.authority.authorizationId);
  const granted=await quoted(decision,'明确授权当前 B 使用原回访任务。',auth(b,{...originalTarget,authorizationId:withdrawal.authority.authorizationId}),true);
  assert.equal(granted.authority.source.choiceId,bChoice.choiceId);
  const legal=await formAuth(sales,b);
  const arranged=await quoted(decision,'另安排南店回访。',arrange(b,'南店回访'),true);
  assert.equal(arranged.authority.source.choiceId,bChoice.choiceId);
  const rounds=(await api(issuePath(sales))).rounds;
  assert.deepEqual(rounds[1].actions.map((r:any)=>r.currentAuthorizationId).sort(),[granted.authority.authorizationId,legal.arrangement.actions[0].authorizationId,arranged.authority.actions[0].authorizationId].sort());
  const before=(await api('/api/decision-board')).items.length;
  let prev=bChoice.choiceId;
  for(const disposition of ['defer','no_action']){
    const passive=await quoted(decision,'本轮'+(disposition==='defer'?'暂缓。':'不行动。'),pick(second,prev,disposition));
    prev=passive.authority.choiceId;
    rejected(await quoted(decision,'为本轮新建安排。',arrange(passive,'不可行动')),'case_choice_not_actionable');
    rejected(await quoted(decision,'为本轮登记授权。',auth(passive,arranged.authority.actions[0])),'case_choice_not_actionable');
    assert.equal((await formAuth(sales,passive,409)).code,'case_choice_not_actionable');
  }
  const {strategyRef:_strategy,choiceId:_choice,...withoutCase}=arrange(a,'缺少本轮引用');
  rejected(await quoted(decision,'安排本事项试行。',withoutCase),'quoted_decision_clarification_required');
  assert.equal((await api('/api/decision-board')).items.length,before);
  const restarted=await quoted(decision,'重新选择北店 A。',pick(first,prev));
  const switched=await quoted(decision,'改判为南店 B。',pick(second,restarted.authority.choiceId));
  assert.equal(switched.authority.previousChoiceId,restarted.authority.choiceId);
  assert.equal(switched.authority.issueId,sales);
  assert.equal((await api(issuePath(supply))).rounds[0].actions[0].currentAuthorizationId,foreignTarget.authorizationId);
  const {choice:held}=await formChoose(supply,foreign,c.authority.choiceId,'defer');
  assert.equal((await formAuth(supply,{authority:held},409)).code,'case_choice_not_actionable');
  const {choice:stopped}=await formChoose(supply,foreign,held.choiceId,'no_action');
  rejected(await quoted(other,'登记物料原行动授权。',auth({authority:stopped},foreignTarget)),'case_choice_not_actionable');
  assert.equal((await formAuth(supply,{authority:stopped},409)).code,'case_choice_not_actionable');
  assert.deepEqual(provider.errors,[]);
});
