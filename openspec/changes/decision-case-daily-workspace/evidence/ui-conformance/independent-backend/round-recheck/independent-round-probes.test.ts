import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { homeRequestRoundNumber, projectHomePending } from '../../../../src/host/home-pending.ts';
import { CaseStore } from '../../../../src/host/case-store.ts';
import { createWorkspaceDailyRoutes } from '../../../../src/host/workspace-daily-routes.ts';
import { createWorkspaceDraftStore } from '../../../../src/host/workspace-draft-store.ts';
import { createDecisionBoardStore } from '../../../../extensions/business-plugins/decision-board/storage/store.ts';

test('independent: exact predecessor, never unrelated newer length; malformed links and owner reject', () => {
  const ref = { type: 'case-decision', caseStoreId: 'store', caseId: 'case', recordId: 'strategy', revision: 100 };
  const req = { requestId: 'request', caseId: 'case', issueId: 'issue', kind: 'choose', target: { kind: 'choose', strategyRef: ref, expectedPreviousChoiceId: 'c2' } };
  const c = (id, previous, patch = {}) => ({ choiceId: id, previousChoiceId: previous, issueId: 'issue', caseId: 'case', strategyRef: ref, ...patch });
  const valid = [c('latest', 'c2'), c('c2', 'c1'), c('unrelated', null, {issueId: 'other'}), c('c1', null)];
  assert.equal(homeRequestRoundNumber(req, valid, null, 'store'), 3);
  assert.equal(homeRequestRoundNumber(req, [...valid].reverse(), null, 'store'), 3);
  assert.equal(homeRequestRoundNumber(req, valid, null, 'different-store'), null);
  for (const patch of [{caseId: 'other'}, {issueId: 'other'}, {strategyRef: {...ref,caseId:'other'}}, {strategyRef:{...ref,caseStoreId:'other'}}, {previousChoiceId:undefined}, {previousChoiceId:7}, {previousChoiceId:'c2'}]) {
    assert.equal(homeRequestRoundNumber(req, [c('c2', 'c1'), c('c1', null, patch)], null, 'store'), null, JSON.stringify(patch));
  }
  assert.equal(homeRequestRoundNumber(req, [...valid, c('c1', null)], null, 'store'), null);
  assert.equal(homeRequestRoundNumber({...req,kind:'observe'}, valid, null, 'store'), null);
  const projection = projectHomePending({storeState:'ready',cases:[{record:{id:'wrong-case',status:'analyzing',title:'case',updatedAt:'2026-01-01',nextStep:''},issues:[{id:'issue',caseId:'wrong-case'}],requests:[{...req,assignee:{label:'a',source:'s'}}],choices:valid,requestStatuses:{request:'open'},requestRoundNumbers:{request:3}}]});
  assert.equal(projection.pending[0].roundNumber, null, 'an injected round must not bypass outer Case owner qualification');
});

async function setup(t) {
  const root = await fs.mkdtemp(path.resolve('.local/ui-conformance/backend-independent/round-recheck/tmp/round-probe-'));
  const cases = new CaseStore({dataRoot:path.join(root,'cases')}); await cases.initialize();
  const board = createDecisionBoardStore({root:path.join(root,'board')}); await board.init();
  t.after(() => { cases.close(); board.close(); });
  const caseRecord = cases.createCase({operationId:randomUUID(),title:'independent round fixture'}), caseId = caseRecord.id;
  const projectId = randomUUID(), storeId = cases.getStatus().storeId;
  const rev = () => cases.getCase(caseId).revision;
  cases.linkProject({operationId:randomUUID(),caseId,projectId,expectedRevision:rev()});
  const issue = cases.createDecisionIssue({operationId:randomUUID(),caseId,expectedRevision:rev(),title:'original issue'});
  const plan = cases.saveDecisionDraft({operationId:randomUUID(),caseStoreId:storeId,caseId,expectedRevision:0,kind:'strategy',payload:{title:'original proposal',proposal:'preserve exact basis'}},{actorKind:'agent',projectId,taskId:randomUUID(),requestId:randomUUID(),sessionId:'synthetic-only',toolCallId:'seed'});
  const strategyRef = {type:'case-decision',caseStoreId:storeId,caseId,recordId:plan.recordId,revision:plan.revision};
  const first = cases.chooseStrategy({operationId:randomUUID(),caseStoreId:storeId,caseId,issueId:issue.id,strategyRef,choice:'trial',expectedPreviousChoiceId:null});
  const arranged = board.arrangeActions({operationId:randomUUID(),projectId,source:{caseStoreId:storeId,caseId,choiceId:first.choiceId,strategyRef},scope:'original scope',title:'original action',checks:[],actions:[{kind:'create',title:'original task'}]},{confirmedIssueId:issue.id}).actions[0];
  const target = {kind:'observe',projectId,itemId:arranged.itemId,taskId:arranged.taskId,authorizationId:arranged.authorizationId,feedbackBaseRevisionId:null};
  const req = cases.saveDecisionRequest({operationId:randomUUID(),caseId,expectedRevision:rev(),expectedRequestRevision:0,issueId:issue.id,kind:'observe',text:'respond to exact authorization',source:{kind:'user-declaration',ref:'independent-source'},assignee:{label:'declared person',source:'independent-source'},target});
  let authTransform = (rows) => rows, projectDenied = false, reportSource = false, reportDenied = false, checks = 0;
  const readBoard = { getTask:board.getTask, getItem:(id) => ({...board.getItem(id),...(reportSource?{sourceKind:'report-confirmation'}:{})}), listFeedbackHistory:board.listFeedbackHistory, listActionAuthorizations:(id) => authTransform(board.listActionAuthorizations(id)) };
  const routes = createWorkspaceDailyRoutes({cases,board:readBoard,drafts:createWorkspaceDraftStore({root:path.join(root,'drafts')}),assertActiveProject:async () => { if (projectDenied) throw Object.assign(Error('forbidden'),{code:'forbidden',statusCode:403}); },assertBoardItemReadable:async () => {checks++; if(reportDenied) throw Object.assign(Error('forbidden'),{code:'forbidden',statusCode:403});},adoptGoal:async () => {throw Error('unexpected mutation');},createCase:async () => {throw Error('unexpected mutation');}});
  const read = async () => {const result = (await routes({pathname:'/api/workspace/home-pending',method:'GET'})).body; return [...result.pending,...result.unresolvedRequests].find(r => r.requestId===req.requestId);};
  return {root,cases,board,caseId,projectId,issue,strategyRef,first,arranged,read, setAuth:(f) => {authTransform=f;}, denyProject:(v) => {projectDenied=v;}, asReport:(v) => {reportSource=v;}, denyReport:(v) => {reportDenied=v;}, checks:()=>checks};
}

test('independent: observation exact authorization rejects duplicates and all original-owner mismatches', async t => {
  const f = await setup(t);
  const originalEvents = f.cases.getEvents('case',f.caseId);
  assert.equal((await f.read()).roundNumber, 1);
  const mutations = [
    rows => [],
    rows => [...rows, structuredClone(rows[0])],
    rows => rows.map(a => ({...a,authorizationId:randomUUID()})),
    rows => rows.map(a => ({...a,projectId:randomUUID()})),
    rows => rows.map(a => ({...a,itemId:randomUUID()})),
    rows => rows.map(a => ({...a,taskId:randomUUID()})),
    rows => rows.map(a => ({...a,decision:'revoke'})),
    rows => rows.map(a => ({...a,source:{...a.source,caseId:randomUUID()}})),
    rows => rows.map(a => ({...a,source:{...a.source,caseStoreId:randomUUID()}})),
    rows => rows.map(a => ({...a,source:{...a.source,choiceId:randomUUID()}})),
    rows => rows.map(a => ({...a,source:{...a.source,strategyRef:{...a.source.strategyRef,revision:99}}})),
    rows => rows.map(a => ({...a,source:{...a.source,strategyRef:{...a.source.strategyRef,recordId:randomUUID()}}})),
    rows => rows.map(a => ({...a,source:{...a.source,kind:'project-action'}})),
  ];
  for (const mutate of mutations) { f.setAuth(mutate); assert.equal((await f.read()).roundNumber,null,mutate.toString()); }
  f.setAuth(rows=>rows); assert.equal((await f.read()).roundNumber,1);
  assert.deepEqual(f.cases.getEvents('case',f.caseId), originalEvents, 'read failures and recovery never create or rewrite choice/request events');
});

test('independent: old observe round survives newer exact same-issue choice; revoked project/report cannot expose a known round', async t => {
  const f = await setup(t);
  f.cases.chooseStrategy({operationId:randomUUID(),caseStoreId:f.strategyRef.caseStoreId,caseId:f.caseId,issueId:f.issue.id,strategyRef:f.strategyRef,choice:'trial',expectedPreviousChoiceId:f.first.choiceId});
  const old = await f.read(); assert.equal(old.roundNumber,1); assert.equal(old.status,'superseded');
  f.denyProject(true); assert.equal((await f.read()).roundNumber,null);
  f.denyProject(false); f.asReport(true); assert.equal((await f.read()).roundNumber,1); assert.ok(f.checks()>=2, 'report source is requalified for round projection');
  f.denyReport(true); assert.equal((await f.read()).roundNumber,null);
  f.denyReport(false); assert.equal((await f.read()).roundNumber,1);
});
