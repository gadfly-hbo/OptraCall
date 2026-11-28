import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { CaseStore } from '../../../../src/host/case-store.ts';
import { startTestHost } from '../../../../tests/fixtures/host-process.ts';
import { projectCaseRoundSummary } from '../../../../src/host/ui/case-board-navigation-model.ts';

const root = path.resolve('.local/ui-conformance/backend-independent/choice-nextstep');
const base = '5dd59909227ab46f3d989ade8b2847e077636855';
let legacyPromise;
function legacyClass() {
  return legacyPromise ??= (async () => {
    const changed = new Set(['src/host/case-store.ts','src/host/case-decision-validation.ts','src/host/case-decision-service.ts','src/host/case-decision-types.ts']);
    const result = await build({entryPoints:['src/host/case-store.ts'],bundle:true,write:false,platform:'node',format:'esm',packages:'external',plugins:[{name:'read-fixed-pre-change-source',setup(plugin){plugin.onLoad({filter:/\.(?:ts|tsx)$/},async args => {
      const rel=path.relative(process.cwd(),args.path); if(!changed.has(rel))return;
      return {contents:execFileSync('git',['show',base+':'+rel],{encoding:'utf8'}),loader:'ts'};
    });}}]});
    const file=path.join(root,'legacy-case-store.mjs');await fs.writeFile(file,result.outputFiles[0].text);
    return (await import(pathToFileURL(file).href)).CaseStore;
  })();
}
function rawSnapshot(dataRoot, choiceId, operationId) {
  const db=new DatabaseSync(path.join(dataRoot,'decision-cases.sqlite3'),{readOnly:true});
  try{return {schema:db.prepare('PRAGMA user_version').get().user_version,event:JSON.stringify(db.prepare('SELECT * FROM work_events WHERE id=?').get(choiceId)),receipt:JSON.stringify(db.prepare('SELECT * FROM operation_receipts WHERE operation_id=?').get(operationId))};}finally{db.close();}
}
async function seed() {
  const dataRoot=await fs.mkdtemp(path.join(root,'tmp/legacy-'));
  const Legacy=await legacyClass(),store=new Legacy({dataRoot});await store.initialize();
  const record=store.createCase({operationId:randomUUID(),title:'Independent legacy Case',nextStep:'Do not replace this Case-wide next step'}),caseId=record.id;
  const projectId=randomUUID(),caseStoreId=store.getStatus().storeId;
  store.linkProject({operationId:randomUUID(),caseId,projectId,expectedRevision:record.revision});
  const issue=store.createDecisionIssue({operationId:randomUUID(),caseId,expectedRevision:store.getCase(caseId).revision,title:'Legacy issue'});
  const plan=store.saveDecisionDraft({operationId:randomUUID(),caseStoreId,caseId,expectedRevision:0,kind:'strategy',payload:{title:'Original strategy',proposal:'Synthetic only'}},{actorKind:'agent',projectId,taskId:randomUUID(),requestId:randomUUID(),sessionId:'synthetic-no-provider',toolCallId:'legacy-seed'});
  const strategyRef={type:'case-decision',caseStoreId,caseId,recordId:plan.recordId,revision:plan.revision};
  const input={operationId:randomUUID(),caseStoreId,caseId,issueId:issue.id,strategyRef,choice:'gather_evidence',reason:'Original human reason',expectedPreviousChoiceId:null};
  const original=store.chooseStrategy(input);store.close();
  return {dataRoot,caseId,issueId:issue.id,input,original,strategyRef,snapshot:rawSnapshot(dataRoot,original.choiceId,input.operationId)};
}

test('independent: true pre-change operation/event replay survives new optional field and rollback reads', async t => {
  const f=await seed(),store=new CaseStore({dataRoot:f.dataRoot});await store.init();t.after(()=>store.close());
  assert.deepEqual(store.chooseStrategy(f.input),f.original);
  for(const empty of [null,'',undefined])assert.deepEqual(store.chooseStrategy({...f.input,nextStep:empty}),f.original);
  assert.deepEqual(rawSnapshot(f.dataRoot,f.original.choiceId,f.input.operationId),f.snapshot,'legacy raw row bytes and schema unchanged by replay');
  const next={...f.input,operationId:randomUUID(),expectedPreviousChoiceId:f.original.choiceId,nextStep:'精确原话 <script>仅文本</script>，并不授权行动。'};
  const saved=store.chooseStrategy(next);assert.equal(saved.nextStep,next.nextStep);assert.equal(store.getCase(f.caseId).nextStep,'Do not replace this Case-wide next step');
  assert.equal(store.getStrategyChoice(f.caseId,saved.choiceId).nextStep,next.nextStep);
  assert.deepEqual(store.chooseStrategy(next),saved);
  assert.throws(()=>store.chooseStrategy({...next,nextStep:'changed'}),{code:'operation_conflict'});
  assert.deepEqual(rawSnapshot(f.dataRoot,f.original.choiceId,f.input.operationId),f.snapshot,'append leaves original event/receipt raw strings and schema unchanged');
  const exact200='中'.repeat(200),second=store.chooseStrategy({...next,operationId:randomUUID(),expectedPreviousChoiceId:saved.choiceId,nextStep:exact200});assert.equal(second.nextStep,exact200);
  for(const invalid of ['中'.repeat(201),{text:'not a string'},'bad\0input',42]){
    const before=JSON.stringify(store.getEvents('case',f.caseId));
    assert.throws(()=>store.chooseStrategy({...next,operationId:randomUUID(),expectedPreviousChoiceId:second.choiceId,nextStep:invalid}));
    assert.equal(JSON.stringify(store.getEvents('case',f.caseId)),before);
  }
  const beforeRollback=rawSnapshot(f.dataRoot,saved.choiceId,next.operationId);store.close();
  const Legacy=await legacyClass(),oldReader=new Legacy({dataRoot:f.dataRoot});await oldReader.init();
  assert.deepEqual(oldReader.chooseStrategy(f.input),f.original);
  assert.equal(oldReader.getStrategyChoices(f.caseId).length,3);oldReader.close();
  assert.deepEqual(rawSnapshot(f.dataRoot,saved.choiceId,next.operationId),beforeRollback,'old reader keeps newly saved unknown optional event field and receipt byte-for-byte');
  console.log(JSON.stringify({baseline:base,legacyOperationId:f.input.operationId,legacyChoiceId:f.original.choiceId,originalRowsPreserved:true,schemaVersion:f.snapshot.schema,optionalFieldExact:saved.nextStep}));
});

test('independent: actual Host HTTP preserves exact optional nextStep, legacy replay and closed-case write gate', {timeout:60000}, async t => {
  const f=await seed();const projectsRoot=await fs.mkdtemp(path.join(root,'tmp/projects-'));
  let host=await startTestHost({dataRoot:f.dataRoot,projectsRoot});t.after(()=>host.close());
  const route='/api/cases/'+f.caseId+'/decisions/'+f.strategyRef.recordId+'/choice';
  const body=({caseId,...rest})=>rest;
  const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
  assert.deepEqual((await json(await host.request(route,'POST',body(f.input)))).choice,f.original);
  const next={...f.input,operationId:randomUUID(),expectedPreviousChoiceId:f.original.choiceId,nextStep:'HTTP准确可选下一步，不自动新增任务或授权'};
  const saved=(await json(await host.request(route,'POST',body(next)))).choice;assert.equal(saved.nextStep,next.nextStep);
  const timeline=await json(await host.request('/api/cases/'+f.caseId+'/decisions/issues/'+f.issueId));assert.equal(timeline.rounds.at(-1).choice.nextStep,next.nextStep);assert.equal(timeline.rounds.at(-1).actions.length,0);
  assert.deepEqual((await json(await host.request(route,'POST',body(next)))).choice,saved);
  await json(await host.request(route,'POST',body({...next,nextStep:'same operation changed value'})),409);
  const core=await json(await host.request('/api/cases/'+f.caseId));assert.equal(core.case.nextStep,'Do not replace this Case-wide next step');
  await json(await host.request(route,'POST',body({...next,operationId:randomUUID(),expectedPreviousChoiceId:saved.choiceId,nextStep:'x'.repeat(201)})),400);
  await host.close();
  assert.deepEqual(rawSnapshot(f.dataRoot,f.original.choiceId,f.input.operationId),f.snapshot);
  const store=new CaseStore({dataRoot:f.dataRoot});await store.init();store.closeCase({operationId:randomUUID(),caseId:f.caseId,expectedRevision:store.getCase(f.caseId).revision,closeReason:'Independent readonly closure test'});store.close();
  host=await startTestHost({dataRoot:f.dataRoot,projectsRoot});
  assert.deepEqual((await json(await host.request(route,'POST',body(f.input)))).choice,f.original);
  assert.deepEqual((await json(await host.request(route,'POST',body(next)))).choice,saved);
  await json(await host.request(route,'POST',body({...next,operationId:randomUUID(),expectedPreviousChoiceId:saved.choiceId,nextStep:'must not write closed Case'})),409);
  assert.deepEqual(rawSnapshot(f.dataRoot,f.original.choiceId,f.input.operationId),f.snapshot);
});

test('independent: summary prioritizes exact original review over choice nextStep and keeps unknown explicit',()=>{
  const timeline={issue:{id:'issue',title:'original'},rounds:[{choice:{choiceId:'original-choice',strategyRef:{recordId:'original-plan',revision:1},occurredAt:'2026-11-28T01:00:00.000Z',choice:'gather_evidence',reason:'known',nextStep:'choice-original-next'},strategy:{payload:{title:'plan'},references:[]},review:null,actions:[],historyLimited:false,reviewSaved:false,reviewObservationLimited:false}]};
  assert.equal(projectCaseRoundSummary(timeline).next,'choice-original-next');
  timeline.rounds[0].review={operationId:'original-review-op',reply:{messageId:'original-message'},judgement:'original-review',nextStep:'review-original-next'};assert.equal(projectCaseRoundSummary(timeline).next,'review-original-next');
  timeline.rounds[0].review=null;delete timeline.rounds[0].choice.nextStep;assert.match(projectCaseRoundSummary(timeline).next,/尚未记录|暂不可读取/);
});
