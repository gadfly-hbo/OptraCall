import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { availableObservationRequests, observationRequestContext, validateObservationRequest, type ObservationRequestContext, type ObservationRequestSnapshot } from '../extensions/business-plugins/decision-board/ui/observation-request-model.ts';
import type { FeedbackInput } from '../extensions/business-plugins/decision-board/ui/decision-board-client.ts';
import type { BoardActionAuthorization } from '../extensions/business-plugins/decision-board/types.ts';
import type { CaseDecisionRequestView } from '../src/host/ui/workspace-daily-client.ts';

const subject = { projectId: 'project-a', itemId: 'item-a', taskId: 'task-a' };
const context: ObservationRequestContext = { caseId: 'case-a', issueId: 'issue-a', requestId: 'request-second', revision: 3, target: { kind: 'observe', ...subject, authorizationId: 'authorization-a', feedbackBaseRevisionId: 'feedback-2' } };
const request = (patch: Partial<CaseDecisionRequestView> = {}): CaseDecisionRequestView => ({ ...context, kind: 'observe', text: '请补录第二条请求的原始观察 <script>', source: { kind: 'user-declaration', ref: 'session/message-7' }, assignee: { label: '运营负责人', source: 'session/message-7' }, requestedAt: '2026-11-27T00:00:00Z', lifecycle: 'open', status: 'open', operationId: 'request-save', createdAt: '2026-11-27T00:00:00Z', ...patch });
const auth = (): BoardActionAuthorization => ({ authorizationId: 'authorization-a', decision: 'authorize', ...subject, source: { caseStoreId: 'store-a', caseId: 'case-a', choiceId: 'choice-a', strategyRef: { type: 'case-decision', caseStoreId: 'store-a', caseId: 'case-a', recordId: 'strategy-a', revision: 2 } }, caseConfirmation: { issueId: 'issue-a', entry: 'case-form' } } as BoardActionAuthorization);
const snapshot = (): ObservationRequestSnapshot => ({ requests: [request()], authorization: auth(), latestRevisionId: 'feedback-2' });

test('DW08/09 observation picker preserves two distinct requests and binds the explicitly selected second revision', () => {
  const state = snapshot();
  state.requests.unshift(request({ requestId: 'request-first', text: '第一条不同请求' }));
  assert.deepEqual(availableObservationRequests(subject, 'feedback-2', state).map(row => row.requestId), ['request-first', 'request-second']);
  const before = JSON.stringify(state);
  assert.deepEqual(validateObservationRequest(context, subject, 'feedback-2', state), { ref: { requestId: 'request-second', revision: 3, authorizationId: 'authorization-a' }, problem: null });
  assert.equal(JSON.stringify(state), before, 'inspection never completes a request or mutates original records');
});

test('DW09 request revision, target baseline and clicked owner cannot silently switch to a newer or different request', () => {
  for (const changed of [request({ revision: 4 }), request({ caseId: 'another-case' }), request({ issueId: 'another-issue' }), request({ target: { ...context.target, feedbackBaseRevisionId: 'new-base' } }), request({ target: { ...context.target, authorizationId: 'new-authorization' } }), request({ target: { ...context.target, taskId: 'another-task' } })]) {
    assert.equal(validateObservationRequest(context, subject, 'feedback-2', { ...snapshot(), requests: [changed] }).ref, null);
  }
  assert.equal(validateObservationRequest(context, { ...subject, itemId: 'another-item' }, 'feedback-2', snapshot()).ref, null);
  assert.equal(validateObservationRequest(context, { ...subject, projectId: 'another-project' }, 'feedback-2', snapshot()).ref, null);
});

test('DW09 actual current Case authorization, issue and source store must match; work, revoke and another round never answer', () => {
  const original = auth();
  const variants: BoardActionAuthorization[] = [
    { ...original, authorizationId: 'another-round' }, { ...original, decision: 'revoke' },
    { ...original, taskId: 'another-task' }, { ...original, itemId: 'another-item' },
    { ...original, projectId: 'another-project' }, { ...original, caseConfirmation: { entry: 'case-form', issueId: 'another-issue' } },
    { ...original, source: { kind: 'work', projectId: 'project-a', taskId: 'task-a', requestId: 'work-request' } },
    { ...original, source: { ...(original.source as Extract<BoardActionAuthorization['source'], { caseId: string }>), caseId: 'another-case' } },
    { ...original, source: { ...(original.source as Extract<BoardActionAuthorization['source'], { caseId: string }>), caseStoreId: 'another-store' } },
  ];
  for (const authorization of [null, ...variants]) {
    const state = { ...snapshot(), authorization };
    assert.equal(validateObservationRequest(context, subject, 'feedback-2', state).ref, null);
    assert.deepEqual(availableObservationRequests(subject, 'feedback-2', state), []);
  }
});

test('DW09 original request baseline and current feedback CAS both apply without changing the draft', () => {
  assert.equal(validateObservationRequest(context, subject, 'feedback-2', { ...snapshot(), latestRevisionId: 'feedback-3' }).ref, null);
  assert.equal(validateObservationRequest(context, subject, 'feedback-3', { ...snapshot(), latestRevisionId: 'feedback-3' }).ref, null);
  const empty = { ...context, target: { ...context.target, feedbackBaseRevisionId: null } };
  const state = { ...snapshot(), latestRevisionId: null, requests: [request({ target: empty.target })] };
  assert.ok(validateObservationRequest(empty, subject, null, state).ref);
  assert.equal(context.target.feedbackBaseRevisionId, 'feedback-2');
});

test('DW08/09 only genuinely open observe requests are offered; source text remains exact', () => {
  for (const status of ['answered', 'withdrawn', 'superseded', 'unverifiable'] as const) {
    const state = { ...snapshot(), requests: [request({ status })] };
    assert.deepEqual(availableObservationRequests(subject, 'feedback-2', state), []);
  }
  assert.deepEqual(availableObservationRequests(subject, 'feedback-2', { ...snapshot(), requests: [request({ lifecycle: 'withdrawn' })] }), []);
  const choose = request({ kind: 'choose', target: { kind: 'choose', strategyRef: { type: 'case-decision', caseStoreId: 'store-a', caseId: 'case-a', recordId: 'strategy-a', revision: 2 }, expectedPreviousChoiceId: null } });
  assert.equal(observationRequestContext(choose), null);
  assert.equal(availableObservationRequests(subject, 'feedback-2', snapshot())[0]!.text, '请补录第二条请求的原始观察 <script>');
});

test('DW09 original feedback HTTP save carries exact selected reference; ordinary and lost-ack saves never gain inferred requests or retries', async () => {
  const source = await readFile(new URL('../extensions/business-plugins/decision-board/ui/decision-board-client.ts', import.meta.url), 'utf8');
  const compiled = await transform(source, { loader: 'ts', format: 'esm' });
  const { saveFeedback } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`) as typeof import('../extensions/business-plugins/decision-board/ui/decision-board-client.ts');
  const oldFetch = globalThis.fetch, calls: { path: string; body: FeedbackInput }[] = [];
  const input: FeedbackInput = { operationId: 'stable-save-intent', expectedLatestRevisionId: 'feedback-2', adopted: true, outcome: '原观察正文', metricDelta: '', review: '仍有未知', score: null, effect: 'unknown' };
  globalThis.fetch = async (path, init) => { calls.push({ path: String(path), body: JSON.parse(String(init?.body)) }); return new Response(JSON.stringify({ feedback: { revisionId: 'feedback-3' } }), { status: 200 }); };
  try {
    await saveFeedback(subject.taskId, input);
    assert.equal(Object.hasOwn(calls[0]!.body, 'respondsToRequest'), false, 'legacy/ordinary feedback never inherits a prior request reference');
    const selected = validateObservationRequest(context, subject, input.expectedLatestRevisionId, snapshot()).ref!;
    await saveFeedback(subject.taskId, { ...input, respondsToRequest: selected });
    assert.deepEqual(calls[1]!.body.respondsToRequest, { requestId: 'request-second', revision: 3, authorizationId: 'authorization-a' });
    assert.equal(calls[1]!.path, '/api/decision-board/tasks/task-a/feedback');
    globalThis.fetch = async (path, init) => { calls.push({ path: String(path), body: JSON.parse(String(init?.body)) }); throw new Error('ack lost'); };
    await assert.rejects(saveFeedback(subject.taskId, { ...input, respondsToRequest: selected }), /ack lost/);
    assert.equal(calls.length, 3, 'unknown result does not automatically retry or issue a separate completion');
    assert.equal(calls[2]!.body.operationId, 'stable-save-intent');
  } finally { globalThis.fetch = oldFetch; }
});
