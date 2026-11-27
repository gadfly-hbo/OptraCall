import test from 'node:test';
import assert from 'node:assert/strict';
import { initialCaseBoardView, reconcileCaseBoardIssues, selectCaseBoardIssue, projectCaseRoundSummary, type CaseIssueTimeline } from '../src/host/ui/case-board-navigation-model.ts';

const issues = ['a', 'b'].map(id => ({ id, caseId: 'A', title: `事项 ${id}`, createdAt: '2026-11-27T12:00:00Z' }));
test('explicit selection resets a manual auxiliary scope while restoration and ordinary redraw retain it', () => {
  const view = { ...selectCaseBoardIssue(initialCaseBoardView(), 'a'), tab: 'projects' as const, auxScope: { mode: 'all' as const, issueId: '', manual: true } };
  assert.equal(selectCaseBoardIssue(view, 'a', 'restore'), view);
  assert.equal(reconcileCaseBoardIssues(view, issues), view);
  assert.deepEqual(selectCaseBoardIssue(view, 'b', 'explicit').auxScope, { mode: 'issue', issueId: 'b', manual: false });
  assert.deepEqual(selectCaseBoardIssue(view, 'a', 'explicit').auxScope, { mode: 'issue', issueId: 'a', manual: false });
});

test('an empty Case or a removed issue cannot retain another Case issue scope', () => {
  const selected = selectCaseBoardIssue(initialCaseBoardView(), 'foreign');
  assert.deepEqual(reconcileCaseBoardIssues(selected, []), initialCaseBoardView());
  const restored = reconcileCaseBoardIssues(selected, issues);
  assert.equal(restored.activeIssueId, 'a');
  assert.deepEqual(restored.auxScope, { mode: 'issue', issueId: 'a', manual: false });
});

function round(id: string): CaseIssueTimeline['rounds'][number] {
  return { choice: { choiceId: id, caseId: 'A', issueId: 'a', choice: 'defer', reason: `取舍理由 ${id}`, occurredAt: '2026-11-27T12:00:00Z', actorKind: 'user', operationId: 'op', previousChoiceId: null, strategyRef: { type: 'case-decision', caseStoreId: 'store', caseId: 'A', recordId: 'plan', revision: 3 } },
    strategy: { caseStoreId: 'store', caseId: 'A', recordId: 'plan', revision: 3, kind: 'strategy', payload: { title: '准确方案', proposal: '', goal: null, mechanism: null, conditions: null, limitations: null, plan: null }, references: [], impactNotes: [], changeReason: null, lifecycle: 'active', origin: { actorKind: 'user', projectId: null, taskId: null, requestId: null, sessionId: null, toolCallId: null }, createdAt: '', operationId: 'plan-op' }, actions: [], review: null, reviewSaved: false, historyLimited: false, reviewObservationLimited: false };
}
test('the latest original round alone supplies judgement, next step and exact source identities', () => {
  const old = round('old'), current = round('current');
  old.review = { caseId: 'A', issueId: 'a', choiceId: 'old', operationId: 'old-review', createdAt: '', judgement: '旧轮结论', nextStep: '旧轮下一步', observation: '旧观察', reply: { type: 'native-reply', projectId: 'P', taskId: 'T', sessionId: 'S', messageId: 'old-message', expectedTextSha256: 'x' } };
  current.review = { ...old.review, choiceId: 'current', operationId: 'exact-review', judgement: '本轮判断', nextStep: '本轮下一步', reply: { ...old.review.reply, messageId: 'exact-message' } };
  const summary = projectCaseRoundSummary({ issue: issues[0]!, rounds: [old, current] });
  assert.match(summary.title, /选择链第 2 轮/);
  assert.equal(summary.known, '复盘判断：本轮判断');
  assert.equal(summary.next, '本轮下一步');
  assert.match(summary.sources.join(' '), /current.*plan@v3.*exact-review.*exact-message/);
  assert.doesNotMatch(JSON.stringify(summary), /旧轮|old-message|old-review/);
});
test('missing reviews and limited action history remain unknown instead of borrowing older conclusions', () => {
  const current = { ...round('current'), historyLimited: true };
  const summary = projectCaseRoundSummary({ issue: issues[0]!, rounds: [current] });
  assert.match(summary.known, /已记录取舍：暂缓/);
  assert.match(summary.known, /尚未记录或暂不可读取/);
  assert.match(summary.next, /尚未记录或暂不可读取/);
  assert.match(summary.advancing, /待核/);
  assert.equal(summary.limited, true);
  const empty = projectCaseRoundSummary({ issue: issues[1]!, rounds: [] });
  assert.match(empty.title, /事项 b.*尚无取舍轮次/);
  assert.deepEqual(empty.sources, ['事项 b']);
});
test('action progress preserves the exact current authorization and observation identities', () => {
  const current = round('current');
  current.actions.push({ projectId: 'P', itemId: 'I', taskId: 'action', title: '准确行动', status: 'doing', currentAuthorizationId: 'auth-new', authorizations: [{ id: 'auth-old', scope: '旧范围', decision: 'authorize', time: '' }, { id: 'auth-new', scope: '仅南店两天', decision: 'authorize', time: '' }], feedback: [{ revisionId: 'feedback', authorizationId: 'auth-new', observedAt: '', actionTitle: '', effect: '', outcome: '实际观察', metricDelta: '', review: '' }] });
  const summary = projectCaseRoundSummary({ issue: issues[0]!, rounds: [current] });
  assert.match(summary.advancing, /准确行动.*进行中.*仅南店两天/);
  assert.doesNotMatch(summary.advancing, /旧范围/);
  assert.match(summary.sources.join(' '), /行动 action.*授权 auth-new.*观察 feedback/);
});
