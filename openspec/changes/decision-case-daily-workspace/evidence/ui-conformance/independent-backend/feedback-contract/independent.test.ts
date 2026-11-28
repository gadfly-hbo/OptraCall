import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createDecisionBoardStore } from '../../../../extensions/business-plugins/decision-board/storage/store.ts';
import { ProjectStore } from '../../../../src/host/project-store.ts';
import { CaseStore } from '../../../../src/host/case-store.ts';
import { createCaseIssueService } from '../../../../src/host/case-issues.ts';
import { startTestHost } from '../../../../tests/fixtures/host-process.ts';

const evidenceRoot=path.resolve('.local/ui-conformance/backend-independent/feedback-contract');
const base='5dd59909227ab46f3d989ade8b2847e077636855';
let legacyPromise;
function legacyModule(){return legacyPromise??=(async()=>{
  const entry='extensions/business-plugins/decision-board/storage/store.ts';
  const output=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',packages:'external',plugins:[{name:'fixed-old-source',setup(p){p.onLoad({filter:/\.(?:ts|tsx)$/},async args=>{
    const rel=path.relative(process.cwd(),args.path);const source=execFileSync('git',['show',base+':'+rel],{encoding:'utf8'});
    return {loader:'ts',contents:source+(rel===entry?'\nexport const __auditSchemas={SCHEMA,FEEDBACK_SCHEMA,AUTHORIZATION_SCHEMA,ARRANGEMENT_SCHEMA,REQUEST_RESPONSE_SCHEMA};':'')};
  });}}]});
  const file=path.join(evidenceRoot,'legacy-board-store.mjs');await fs.writeFile(file,output.outputFiles[0].text);return import(pathToFileURL(file).href);
})();}
function snapshot(root){const db=new DatabaseSync(path.join(root,'decision-board.sqlite3'),{readOnly:true});try{return {
  version:db.prepare('PRAGMA user_version').get().user_version,
  schema:db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),
  tables:Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()])),
  foreignKeys:db.prepare('PRAGMA foreign_key_check').all(),integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,
};}finally{db.close();}}
function preserved(before,after){for(const [table,rows] of Object.entries(before.tables))for(const [index,row] of rows.entries())for(const [key,value] of Object.entries(row))assert.deepEqual(after.tables[table][index][key],value,`${table}[${index}].${key} changed`);assert.deepEqual(after.foreignKeys,[]);assert.equal(after.integrity,'ok');}
const originalInput=(baseRevision=null)=>({operationId:randomUUID(),expectedLatestRevisionId:baseRevision,adopted:false,outcome:'原样观察：未取得执行反馈',metricDelta:'',review:'未知不是否定效果',score:null,effect:'unknown'});
async function seed(version=6,roots){
  const root=roots?.root??await fs.mkdtemp(path.join(evidenceRoot,'tmp/board-')),projectId=roots?.projectId??randomUUID(),legacy=await legacyModule();
  const store=legacy.createDecisionBoardStore({root});await store.init();
  const item=store.addManualItem({projectId,title:'合成独立原行动',rationale:'仅验证持久契约'});store.decideItem(item.id,{status:'adopted'});const task=store.addTask(item.id,{title:'原任务状态保持'});
  const plainInput=originalInput(),plain=store.saveFeedback(task.id,plainInput);
  const quote={schemaVersion:1,projectId,taskId:randomUUID(),requestId:randomUUID(),sessionId:'original-session',toolCallId:'original-call',originalUserTextSha256:'b'.repeat(64),quote:{start:2,end:6,text:'原用户话'}};
  const secondInput={...originalInput(plain.revisionId),adopted:true,outcome:'原先明确执行',...(version===6?{respondsToRequest:{requestId:randomUUID(),revision:2,authorizationId:randomUUID()}}:{})};
  const second=store.saveFeedback(task.id,secondInput,{quoteProvenance:quote});store.close();
  const before=snapshot(root);assert.equal(before.version,version);await fs.writeFile(path.join(root,'before.json'),JSON.stringify(before,null,2));
  return {root,projectId,item,task,plainInput,plain,secondInput,second,quote,before,legacy};
}

test('independent D14: true old v4/v6 feedback hashes, fields and receipts survive nullable v7; old reader fails without touching bytes',async t=>{
  for(const version of [4,6])await t.test('schema '+version,async()=>{
    const f=await seed(version),store=createDecisionBoardStore({root:f.root});await store.init();
    assert.deepEqual(store.saveFeedback(f.task.id,f.plainInput),f.plain);assert.deepEqual(store.saveFeedback(f.task.id,f.secondInput,{quoteProvenance:f.quote}),f.second);
    for(const absent of [null,undefined])assert.deepEqual(store.saveFeedback(f.task.id,{...f.plainInput,observationDate:absent,sourceScope:absent}),f.plain,'absent metadata preserves exact old operation digest');
    preserved(f.before,snapshot(f.root));
    const input={...originalInput(f.second.revisionId),adopted:null,outcome:'实际观察，执行状态仍未知',observationDate:'2024-02-29',sourceScope:'原门店访谈；仍缺少总体样本'};
    const saved=store.saveFeedback(f.task.id,input);assert.equal(saved.adopted,null);assert.equal(saved.observationDate,input.observationDate);assert.equal(saved.sourceScope,input.sourceScope);
    assert.equal(saved.effect,'unknown');assert.equal(saved.score,null);assert.equal(store.getTask(f.task.id).status,'todo');assert.equal(store.listActionAuthorizations(f.task.id).length,0);
    assert.deepEqual(store.saveFeedback(f.task.id,input),saved);assert.throws(()=>store.saveFeedback(f.task.id,{...input,sourceScope:'changed'}),{code:'feedback_operation_conflict'});
    assert.throws(()=>store.saveFeedback(f.task.id,{...input,operationId:randomUUID(),expectedLatestRevisionId:f.second.revisionId}),{code:'feedback_revision_conflict'});
    assert.deepEqual(store.saveFeedback(f.task.id,f.plainInput),f.plain,'late replay returns its original saved revision, not latest');
    const after=snapshot(f.root);assert.equal(after.version,7);preserved(f.before,after);assert.equal(after.tables.feedback_revisions.length,3);store.close();
    const bytes=await fs.readFile(path.join(f.root,'decision-board.sqlite3'));const old=f.legacy.createDecisionBoardStore({root:f.root});await assert.rejects(async()=>old.init(),{code:'unsupported_board_schema'});old.close();assert.deepEqual(await fs.readFile(path.join(f.root,'decision-board.sqlite3')),bytes);
    const reopened=createDecisionBoardStore({root:f.root});await reopened.init();assert.deepEqual(reopened.getFeedbackRevision(saved.revisionId),saved);assert.deepEqual(reopened.saveFeedback(f.task.id,f.secondInput,{quoteProvenance:f.quote}),f.second);reopened.close();
    await fs.writeFile(path.join(f.root,'after.json'),JSON.stringify(snapshot(f.root),null,2));console.log(JSON.stringify({check:'v7-cross-version',oldVersion:version,root:f.root,oldOperation:f.plainInput.operationId,newOperation:input.operationId,oldRowsPreserved:true,oldReaderRejectedWithoutByteChange:true}));
  });
});

test('independent D14: failed commit rolls back nullable migration, revision and operation together',async()=>{
  const f=await seed(6),store=createDecisionBoardStore({root:f.root});await store.init();const before=snapshot(f.root);let called=0;
  assert.throws(()=>store.saveFeedback(f.task.id,{...originalInput(f.second.revisionId),adopted:null,observationDate:'2026-11-27',sourceScope:'原范围'},{assertWritable(){if(++called===2)throw Error('synthetic-denied-before-commit');}}),/synthetic-denied-before-commit/);
  assert.equal(called,2);assert.deepEqual(snapshot(f.root),before);assert.deepEqual(store.listFeedbackHistory(f.task.id),[f.plain,f.second]);store.close();
});

test('independent D14: original schema1 legacy-current bytes and original timestamps survive later nullable append',async()=>{
  const legacy=await legacyModule(),root=await fs.mkdtemp(path.join(evidenceRoot,'tmp/schema1-')),db=new DatabaseSync(path.join(root,'decision-board.sqlite3'));
  db.exec(legacy.__auditSchemas.SCHEMA);const itemId=randomUUID(),taskId=randomUUID(),created='2024-03-01T00:00:00.000Z',updated='2024-03-02T00:00:00.000Z';
  db.prepare('INSERT INTO board_items (id,project_id,source_kind,title,rationale,priority,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(itemId,randomUUID(),'manual','原建议','原理由','medium','adopted',created,updated);
  db.prepare('INSERT INTO board_tasks (id,item_id,title,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(taskId,itemId,'原行动','doing','medium',created,updated);
  db.prepare('INSERT INTO task_feedback (task_id,adopted,outcome,metric_delta,review,score,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(taskId,0,'  原正文\n','原指标','原记录并非无效',2,created,updated);db.close();const before=snapshot(root);
  const store=createDecisionBoardStore({root});await store.init();const first=store.listFeedbackHistory(taskId)[0];assert.equal(first.origin,'legacy-current');assert.equal(first.outcome,'  原正文\n');assert.equal(first.createdAt,created);assert.equal(first.updatedAt,updated);assert.equal(first.operationId,null);assert.equal(first.requestSha256,null);
  const saved=store.saveFeedback(taskId,{...originalInput(first.revisionId),adopted:null,observationDate:'2026-11-27',outcome:'新的实际观察',sourceScope:'新的明确范围'});assert.equal(saved.adopted,null);assert.deepEqual(store.getFeedbackRevision(first.revisionId),first);assert.equal(store.getTask(taskId).status,'doing');store.close();preserved(before,snapshot(root));
});

test('independent D14: invalid date/scope/adoption do not append or migrate; null remains distinct from false',async()=>{
  const f=await seed(4),store=createDecisionBoardStore({root:f.root});await store.init();const before=snapshot(f.root);
  for(const patch of [{observationDate:undefined},{observationDate:null},{observationDate:''},{outcome:''},{outcome:'   '},{observationDate:'2026-02-30'},{observationDate:'2026-2-01'},{observationDate:'not-a-date'},{observationDate:5},{sourceScope:'x'.repeat(301)},{sourceScope:{text:'no'}},{sourceScope:'bad\0scope'},{adopted:'unknown'},{adopted:0}]){
    assert.throws(()=>store.saveFeedback(f.task.id,{...originalInput(f.second.revisionId),adopted:null,observationDate:'2026-11-27',sourceScope:'已知来源',...patch}));assert.deepEqual(snapshot(f.root),before);
  }
  const exact={...originalInput(f.second.revisionId),adopted:null,observationDate:'2024-02-29',sourceScope:'中'.repeat(300)};assert.equal(store.saveFeedback(f.task.id,exact).sourceScope,exact.sourceScope);assert.equal(store.getFeedbackRevision(f.plain.revisionId).adopted,false);assert.equal(store.getFeedbackRevision(f.second.revisionId).adopted,true);store.close();
});

test('independent D14: actual isolated Host HTTP persists nullable/date/scope and old original receipt, rejects stale/invalid writes', {timeout:60000}, async t=>{
  const workspace=await fs.mkdtemp(path.join(evidenceRoot,'tmp/http-')),dataRoot=path.join(workspace,'data'),projectsRoot=path.join(workspace,'projects');
  const projects=new ProjectStore({dataRoot,projectsRoot});await projects.init();const project=await projects.create({name:'独立合成D14契约',configuration:{id:'synthetic',revision:1,name:'synthetic',provider:'synthetic',model:'synthetic',baseUrl:'http://127.0.0.1:1'}});await projects.close();
  const f=await seed(6,{root:path.join(dataRoot,'decision-board'),projectId:project.id});const host=await startTestHost({dataRoot,projectsRoot});t.after(()=>host.close());
  const api=async(route,method='GET',input?,expected=200)=>{const response=await host.request(route,method,input),value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;};
  const route='/api/decision-board/tasks/'+f.task.id+'/feedback';assert.deepEqual((await api(route,'POST',f.plainInput)).feedback,f.plain);
  const input={...originalInput(f.second.revisionId),adopted:null,outcome:'两店答复矛盾，未确认整体执行或效果',observationDate:'2024-02-29',sourceScope:'仅两店原访谈，不代表全部门店'};
  const saved=(await api(route,'POST',input)).feedback;assert.equal(saved.adopted,null);assert.equal(saved.observationDate,input.observationDate);assert.equal(saved.sourceScope,input.sourceScope);assert.ok(saved.savedAt>'2024-02-29');
  assert.deepEqual((await api('/api/decision-board/feedback/operations/'+input.operationId)).feedback,saved);
  assert.deepEqual((await api(route,'POST',input)).feedback,saved);assert.deepEqual((await api(route,'POST',f.plainInput)).feedback,f.plain);
  await api(route,'POST',{...input,sourceScope:'changed'},409);await api(route,'POST',{...input,operationId:randomUUID()},409);await api(route,'POST',{...input,operationId:randomUUID(),expectedLatestRevisionId:saved.revisionId,observationDate:'2026-02-30'},400);
  const history=await api('/api/decision-board/feedback/history?taskId='+f.task.id);assert.deepEqual(history.revisions,[f.plain,f.second,saved]);
  const board=await api('/api/decision-board'),view=board.items.find(x=>x.id===f.item.id).tasks.find(x=>x.id===f.task.id);assert.equal(view.status,'todo');assert.equal(view.feedback.adopted,null);assert.equal(view.feedback.observationDate,input.observationDate);assert.equal(view.feedback.sourceScope,input.sourceScope);assert.equal(view.authorization,null);
  await host.close();preserved(f.before,snapshot(f.root));await fs.writeFile(path.join(workspace,'http-evidence.json'),JSON.stringify({baseUrl:host.baseUrl,pid:host.pid,oldReceipt:f.plain,newReceipt:saved,taskStatus:view.status,authorization:view.authorization,output:host.output()},null,2));
});

test('independent D14: declared observation date stays separate from exact request, authorization and immutable saved time',async t=>{
  const root=await fs.mkdtemp(path.join(evidenceRoot,'tmp/case-')),cases=new CaseStore({dataRoot:path.join(root,'cases')}),board=createDecisionBoardStore({root:path.join(root,'board')});await cases.initialize();await board.init();t.after(()=>{cases.close();board.close();});
  const record=cases.createCase({operationId:randomUUID(),title:'原Case'}),caseId=record.id,projectId=randomUUID(),caseStoreId=cases.getStatus().storeId;
  const rev=()=>cases.getCase(caseId).revision;cases.linkProject({operationId:randomUUID(),caseId,projectId,expectedRevision:rev()});const issue=cases.createDecisionIssue({operationId:randomUUID(),caseId,expectedRevision:rev(),title:'原事项'});
  const plan=cases.saveDecisionDraft({operationId:randomUUID(),caseStoreId,caseId,kind:'strategy',expectedRevision:0,payload:{title:'原方案',proposal:'先试两店'}},{actorKind:'agent',projectId,taskId:randomUUID(),requestId:randomUUID(),sessionId:'synthetic',toolCallId:'synthetic'});
  const strategyRef={type:'case-decision',caseStoreId,caseId,recordId:plan.recordId,revision:plan.revision};const choice=cases.chooseStrategy({operationId:randomUUID(),caseStoreId,caseId,issueId:issue.id,strategyRef,choice:'trial',reason:'原取舍',expectedPreviousChoiceId:null});
  const action=board.arrangeActions({operationId:randomUUID(),projectId,source:{caseStoreId,caseId,choiceId:choice.choiceId,strategyRef},title:'原行动',scope:'仅两店',checks:[],actions:[{kind:'create',title:'收集两店原话'}]},{confirmedIssueId:issue.id}).actions[0];
  const request=(base)=>cases.saveDecisionRequest({operationId:randomUUID(),caseId,issueId:issue.id,expectedRevision:rev(),expectedRequestRevision:0,kind:'observe',text:'原观察请求',source:{kind:'user-declaration',ref:'original-user'},assignee:{label:'原负责人',source:'original-user'},target:{kind:'observe',projectId,itemId:action.itemId,taskId:action.taskId,authorizationId:action.authorizationId,feedbackBaseRevisionId:base}});
  const service=createCaseIssueService({cases,board,projects:{get:async id=>({id,archivedAt:null,tasks:[]})},assertActive(){},mutate:fn=>fn()});const first=request(null);await new Promise(resolve=>setTimeout(resolve,10));
  const raw={...originalInput(),adopted:null,observationDate:'2024-02-29',sourceScope:'仅两店原访谈',outcome:'执行情况仍未知'};
  const wrong=board.saveFeedback(action.taskId,{...raw,respondsToRequest:{requestId:first.requestId,revision:first.revision,authorizationId:randomUUID()}});
  assert.notEqual((await service.decisionRequests(caseId)).find(x=>x.requestId===first.requestId).status,'answered');
  const exact=request(wrong.revisionId);await new Promise(resolve=>setTimeout(resolve,10));const saved=board.saveFeedback(action.taskId,{...raw,operationId:randomUUID(),expectedLatestRevisionId:wrong.revisionId,respondsToRequest:{requestId:exact.requestId,revision:exact.revision,authorizationId:action.authorizationId}});
  assert.equal((await service.decisionRequests(caseId)).find(x=>x.requestId===exact.requestId).status,'answered');
  const timeline=await service.issueTimeline(caseId,issue.id),projected=timeline.rounds[0].actions[0].feedback.find(x=>x.revisionId===saved.revisionId);assert.equal(projected.authorizationId,action.authorizationId);assert.equal(projected.observedAt,saved.savedAt);assert.equal(projected.observationDate,raw.observationDate);assert.equal(projected.sourceScope,raw.sourceScope);assert.equal(board.getTask(action.taskId).status,'todo');
});
