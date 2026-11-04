import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import type { CaseDecisionOrigin } from '../src/host/case-decision-types.ts';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-m5-case-')));
  const dataRoot = path.join(root, 'private');
  const store = new CaseStore({ dataRoot });
  t.after(async () => { store.close(); });
  await store.initialize();
  const record = store.createCase({ operationId: randomUUID(), title: '门店缺货复盘' });
  const projectId = randomUUID();
  store.linkProject({ operationId: randomUUID(), caseId: record.id, projectId, expectedRevision: 1 });
  const origin: CaseDecisionOrigin = { actorKind: 'agent', projectId, taskId: randomUUID(), requestId: randomUUID(), sessionId: 'native-synthetic-session', toolCallId: 'tool-1' };
  return { root, dataRoot, store, caseId: record.id, caseStoreId: store.getStatus().storeId!, projectId, origin };
}

test('M5-STORE-01: Agent can append an independently versioned Case draft and read its exact prior revision', async t => {
  const { store, caseId, caseStoreId, origin } = await fixture(t);
  const before = store.getCase(caseId);
  const input = { operationId: randomUUID(), caseStoreId, caseId, expectedRevision: 0, kind: 'hypothesis' as const, payload: { title: '权限不足', statement: '缺货可能与补货授权有关' } };
  const first = store.saveDecisionDraft(input, origin);
  assert.equal(first.revision, 1); assert.equal(first.origin.actorKind, 'agent');
  assert.equal(first.lifecycle, 'active'); assert.equal(first.payload.title, '权限不足');
  assert.equal('assessment' in first.payload && first.payload.assessment, 'unresolved');
  const second = store.saveDecisionDraft({ ...input, operationId: randomUUID(), recordId: first.recordId, expectedRevision: 1, payload: { title: '执行路径待核', statement: '已有小额权限，实际执行路径仍未知' } }, { ...origin, toolCallId: 'tool-2' });
  assert.equal(second.recordId, first.recordId); assert.equal(second.revision, 2);
  assert.deepEqual(store.getDecision(caseId, first.recordId, 1), first);
  assert.deepEqual(store.getDecision(caseId, first.recordId), second);
  assert.deepEqual(store.getCase(caseId), before, 'business draft does not pretend to edit the Case core');
  assert.deepEqual(store.saveDecisionDraft(input, origin), first, 'same operation keeps its original result');
  assert.equal(store.listDecisions(caseId).items.length, 1);
});

test('M5-STORE-02: a human choice is exact, cross-revision CAS protected and never inherited by a new Agent draft', async t => {
  const { store, caseId, caseStoreId, origin } = await fixture(t);
  const draft = { operationId: randomUUID(), caseStoreId, caseId, expectedRevision: 0, kind: 'strategy' as const, payload: { title: '先补证', proposal: '核对权限与执行日志' } };
  const first = store.saveDecisionDraft(draft, origin);
  const ref = { type: 'case-decision' as const, caseStoreId, caseId, recordId: first.recordId, revision: first.revision };
  const input = { operationId: randomUUID(), caseStoreId, caseId, strategyRef: ref, choice: 'gather_evidence' as const, expectedPreviousChoiceId: null };
  const chosen = store.chooseStrategy(input);
  assert.equal(chosen.strategyRef.revision, 1); assert.equal(chosen.actorKind, 'user');
  const event = store.getEvents('case', caseId).at(-1)!;
  assert.equal(event.eventType, 'case_strategy_choice'); assert.equal(event.id, chosen.choiceId);
  assert.equal(event.changes.choice!.before, null);
  const next = store.saveDecisionDraft({ ...draft, operationId: randomUUID(), recordId: first.recordId, expectedRevision: 1, payload: { title: '改查执行', proposal: '已有权限，重点核对实际使用' } }, { ...origin, toolCallId: 'tool-next' });
  assert.equal(next.revision, 2);
  assert.deepEqual(store.listDecisions(caseId).choices.map(c => [c.strategyRef.revision, c.choice]), [[1, 'gather_evidence']]);
  assert.throws(() => store.chooseStrategy({ ...input, operationId: randomUUID(), strategyRef: { ...ref, revision: 2 }, choice: 'trial' }), /case_choice_conflict/);
  assert.throws(() => store.chooseStrategy({ ...input, operationId: randomUUID(), expectedPreviousChoiceId: chosen.choiceId }), /case_decision_revision_conflict/);
  const historical = store.chooseStrategy({ ...input, operationId: randomUUID(), expectedPreviousChoiceId: chosen.choiceId, allowHistorical: true, choice: 'defer' });
  assert.equal(historical.previousChoiceId, chosen.choiceId); assert.equal(historical.strategyRef.revision, 1);
  const core = store.getCase(caseId);
  store.closeCase({ caseId, operationId: randomUUID(), expectedRevision: core.revision, closeReason: '暂结，等待实绩' });
  assert.deepEqual(store.chooseStrategy(input), chosen, 'completed original operation wins over today closed status and CAS');
  assert.throws(() => store.chooseStrategy({ ...input, operationId: randomUUID(), expectedPreviousChoiceId: historical.choiceId, strategyRef: { ...ref, revision: 2 } }), /case_closed/);
});

test('M5-STORE-03: human associations and archive/restore append revisions without changing the original body, choice or action', async t => {
  const { store, caseId, caseStoreId, projectId, origin } = await fixture(t);
  const draft = { operationId: randomUUID(), caseStoreId, caseId, expectedRevision: 0, kind: 'strategy' as const, payload: { title: '核对执行', proposal: '查申请、审批及补货日志' } };
  const first = store.saveDecisionDraft(draft, origin);
  const strategyRef = { type: 'case-decision' as const, caseStoreId, caseId, recordId: first.recordId, revision: 1 };
  const choice = store.chooseStrategy({ operationId: randomUUID(), caseStoreId, caseId, strategyRef, choice: 'gather_evidence', expectedPreviousChoiceId: null });
  const core = store.getCase(caseId);
  const reference = { relation: 'action' as const, target: { type: 'board-task' as const, projectId, itemId: randomUUID(), taskId: randomUUID(), observation: { updatedAt: '2026-11-03T00:00:00.000Z', title: '原日志核对任务', owner: null, dueDate: null, status: 'doing' as const, note: '' } }, note: null };
  const common = { caseStoreId, caseId, recordId: first.recordId };
  const linked = store.reviseDecisionByUser({ ...common, operationId: randomUUID(), expectedRevision: 1, action: 'add_reference', reference });
  assert.equal(linked.revision, 2); assert.equal(linked.origin.actorKind, 'user');
  assert.deepEqual(linked.payload, first.payload);
  assert.equal(linked.references.find(r => r.relation === 'derived_from')?.target.type, 'case-decision');
  assert.equal(store.getDecision(caseId, first.recordId, 1).references.length, 0);
  const repeated = store.reviseDecisionByUser({ ...common, operationId: randomUUID(), expectedRevision: 2, action: 'add_reference', reference });
  assert.equal(repeated.revision, 2);
  const feedback = { relation: 'feedback' as const, target: { type: 'feedback' as const, sourceProjectId: projectId, boardTaskId: reference.target.taskId, feedbackRevisionId: randomUUID() }, note: null };
  const withFeedback = store.reviseDecisionByUser({ ...common, operationId: randomUUID(), expectedRevision: 2, action: 'add_reference', reference: feedback });
  const archived = store.reviseDecisionByUser({ ...common, operationId: randomUUID(), expectedRevision: 3, action: 'archive' });
  assert.equal(archived.revision, 4); assert.equal(archived.lifecycle, 'archived');
  assert.equal(store.listDecisions(caseId).items.length, 0);
  assert.equal(store.listDecisions(caseId, { history: true }).items.length, 4);
  assert.throws(() => store.saveDecisionDraft({ ...draft, operationId: randomUUID(), recordId: first.recordId, expectedRevision: 4 }, origin), /case_decision_archived/);
  assert.throws(() => store.chooseStrategy({ operationId: randomUUID(), caseStoreId, caseId, strategyRef, choice: 'trial', expectedPreviousChoiceId: choice.choiceId, allowHistorical: true }), /case_decision_archived/);
  const restored = store.reviseDecisionByUser({ ...common, operationId: randomUUID(), expectedRevision: 4, action: 'restore' });
  assert.equal(restored.revision, 5); assert.equal(restored.lifecycle, 'active');
  assert.deepEqual(restored.payload, first.payload); assert.deepEqual(store.getCase(caseId), core);
  assert.equal(store.listDecisions(caseId).choices[0]!.strategyRef.revision, 1);
  assert.equal(withFeedback.references.filter(r => ['action', 'feedback'].includes(r.relation)).length, 2);
});

test('M5-STORE-04: completed original operation bypasses today write checks while cancellation before commit leaves no draft', async t => {
  const { store, caseId, caseStoreId, origin } = await fixture(t);
  const input = { operationId: randomUUID(), caseStoreId, caseId, expectedRevision: 0, kind: 'hypothesis' as const, payload: { title: '待核判断', statement: '执行路径尚不明确' } };
  const first = store.saveDecisionDraft(input, origin);
  let replayChecks = 0;
  assert.deepEqual(store.saveDecisionDraft(input, origin, { assertWritable: () => { replayChecks++; throw new Error('not_writable_today'); } }), first);
  assert.equal(replayChecks, 0);
  const cancelled = new AbortController(); let checks = 0;
  const next = { ...input, operationId: randomUUID(), recordId: first.recordId, expectedRevision: 1, payload: { title: '不应提交', statement: '取消后不得落稿' } };
  assert.throws(() => store.saveDecisionDraft(next, origin, { assertWritable: () => { if (++checks === 2) cancelled.abort(); cancelled.signal.throwIfAborted(); } }), { name: 'AbortError' });
  assert.equal(checks, 2); assert.deepEqual(store.getDecision(caseId, first.recordId), first);
  assert.equal(store.getOperation(next.operationId), null);
});

test('M5-STORE-05: dependencies refer only to exact hypotheses of the same Case; forged identity and stale drafts do not save', async t => {
  const { store, caseId, caseStoreId, origin } = await fixture(t);
  const base = { caseStoreId, caseId, expectedRevision: 0 };
  const h = store.saveDecisionDraft({ ...base, operationId: randomUUID(), kind: 'hypothesis', payload: { title: '权限前提', statement: '完全无权仍待核' } }, origin);
  const target = { type: 'case-decision' as const, caseStoreId, caseId, recordId: h.recordId, revision: 1 };
  const draft = { ...base, operationId: randomUUID(), kind: 'strategy' as const, payload: { title: '备选策略', proposal: '先查明权限和日志' }, references: [{ relation: 'depends_on' as const, target, note: null }] };
  const s = store.saveDecisionDraft(draft, origin);
  assert.equal(s.references[0]!.target.type, 'case-decision');
  assert.throws(() => store.saveDecisionDraft({ ...draft, operationId: randomUUID(), references: [{ relation: 'depends_on', target: { ...target, recordId: s.recordId }, note: null }] }, origin), /case_dependency_requires_hypothesis/);
  const other = store.createCase({ operationId: randomUUID(), title: '另一事项' });
  assert.throws(() => store.saveDecisionDraft({ ...draft, operationId: randomUUID(), references: [{ relation: 'depends_on', target: { ...target, caseId: other.id }, note: null }] }, origin), /case_decision_scope_mismatch/);
  assert.throws(() => store.saveDecisionDraft({ ...draft, operationId: randomUUID(), references: [{ relation: 'depends_on', target: { ...target, revision: 999 }, note: null }] }, origin), /case_decision_not_found/);
  assert.throws(() => store.saveDecisionDraft({ ...draft, operationId: randomUUID(), recordId: randomUUID() }, origin), /host_owned/);
  assert.throws(() => store.saveDecisionDraft({ ...draft, operationId: randomUUID(), origin: { actorKind: 'user' } } as typeof draft, origin), /invalid_case_decision_fields/);
  const second = store.saveDecisionDraft({ ...draft, operationId: randomUUID(), recordId: s.recordId, expectedRevision: 1 }, origin);
  assert.equal(second.revision, 2);
  assert.throws(() => store.saveDecisionDraft({ ...draft, operationId: randomUUID(), recordId: s.recordId, expectedRevision: 1 }, origin), /revision_conflict/);
  assert.throws(() => store.saveDecisionDraft({ ...draft, payload: { title: '伪造同意图', proposal: '不应覆盖' } }, origin), /operation_conflict/);
});

test('M5-STORE-06: directory/history pages remain bounded and bound to the exact Case, with old versions independently readable', async t => {
  const { store, caseId, caseStoreId, origin } = await fixture(t);
  const saved = Array.from({ length: 3 }, (_, i) => store.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId, expectedRevision: 0, kind: 'strategy', payload: { title: `备选${i + 1}`, proposal: `第${i + 1}项做法` } }, { ...origin, toolCallId: `tool-${i}` }));
  const page = store.listDecisions(caseId, { pageSize: 2 });
  assert.equal(page.items.length, 2); assert.ok(page.continuation);
  const next = store.listDecisions(caseId, { pageSize: 2, continuation: page.continuation });
  assert.equal(next.items.length, 1); assert.equal(next.continuation, null);
  assert.deepEqual([...page.items, ...next.items].map(i => i.recordId).sort(), saved.map(i => i.recordId).sort());
  const other = store.createCase({ operationId: randomUUID(), title: '别的事项' });
  assert.throws(() => store.listDecisions(other.id, { continuation: page.continuation }), /invalid_case_decision_page/);
  assert.throws(() => store.listDecisions(caseId, { pageSize: 51 }), /invalid_case_decision_page/);
  assert.throws(() => store.getDecision(caseId, saved[0]!.recordId, 999), /case_decision_not_found/);
  const core = store.getCase(caseId);
  store.closeCase({ operationId: randomUUID(), caseId, expectedRevision: core.revision, closeReason: '只读历史' });
  assert.throws(() => store.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId, recordId: saved[0]!.recordId, expectedRevision: 1, kind: 'strategy', payload: saved[0]!.payload }, origin), /case_closed/);
  assert.throws(() => store.reviseDecisionByUser({ operationId: randomUUID(), caseStoreId, caseId, recordId: saved[0]!.recordId, expectedRevision: 1, action: 'archive' }), /case_closed/);
  assert.equal(store.listDecisions(caseId).items.length, 3);
});

test('M5-STORE-07: a changed directory requires an explicit fresh read instead of silently skipping or repeating rows', async t => {
  for (const history of [false, true]) await t.test(history ? 'history appended between pages' : 'card archived between pages', async sub => {
    const { store, caseId, caseStoreId, origin } = await fixture(sub);
    for (let i = 0; i < 3; i++) store.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId, expectedRevision: 0, kind: 'strategy', payload: { title: `备选${i}`, proposal: `合成做法${i}` } }, origin);
    const page = store.listDecisions(caseId, { pageSize: 2, history });
    assert.equal(page.items.length, 2); assert.ok(page.continuation);
    const first = page.items[0]!;
    if (history) store.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId, recordId: first.recordId, expectedRevision: first.revision, kind: 'strategy', payload: { title: '新修订', proposal: '分页期间追加的版本' } }, origin);
    else store.reviseDecisionByUser({ operationId: randomUUID(), caseStoreId, caseId, recordId: first.recordId, expectedRevision: first.revision, action: 'archive' });
    assert.deepEqual(store.getDecision(caseId, first.recordId, first.revision), first);
    assert.throws(() => store.listDecisions(caseId, { pageSize: 2, history, continuation: page.continuation }), { code: 'case_decision_continuation_changed', statusCode: 409 });
    const fresh = store.listDecisions(caseId, { pageSize: 2, history });
    const seen = [...fresh.items];
    if (fresh.continuation) seen.push(...store.listDecisions(caseId, { pageSize: 2, history, continuation: fresh.continuation }).items);
    assert.equal(new Set(seen.map(row => `${row.recordId}@${row.revision}`)).size, history ? 4 : 2, 'fresh traversal retains every expected exact row without duplicates');
  });
});

test('M5-STORE-08: new human choices invalidate the Case directory cursor while another Case does not', async t => {
  const { store, caseId, caseStoreId, origin, projectId } = await fixture(t);
  for (let i = 0; i < 3; i++) store.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId, expectedRevision: 0, kind: 'strategy', payload: { title: `备选${i}`, proposal: `合成做法${i}` } }, origin);
  const page = store.listDecisions(caseId, { pageSize: 2 });
  assert.ok(page.continuation);
  const other = store.createCase({ operationId: randomUUID(), title: '另一Case不改变当前目录' });
  store.linkProject({ operationId: randomUUID(), caseId: other.id, projectId, expectedRevision: 1 });
  store.saveDecisionDraft({ operationId: randomUUID(), caseStoreId, caseId: other.id, expectedRevision: 0, kind: 'strategy', payload: { title: '其他备选', proposal: '不关联当前Case' } }, origin);
  assert.equal(store.listDecisions(caseId, { pageSize: 2, continuation: page.continuation }).items.length, 1);
  const selected = page.items[0]!;
  const choice = store.chooseStrategy({ operationId: randomUUID(), caseStoreId, caseId, strategyRef: { type: 'case-decision', caseStoreId, caseId, recordId: selected.recordId, revision: selected.revision }, choice: 'gather_evidence', expectedPreviousChoiceId: null });
  assert.deepEqual(store.getDecision(caseId, selected.recordId, selected.revision), selected);
  assert.throws(() => store.listDecisions(caseId, { pageSize: 2, continuation: page.continuation }), { code: 'case_decision_continuation_changed', statusCode: 409 });
  assert.equal(store.listDecisions(caseId, { pageSize: 2 }).choices[0]!.choiceId, choice.choiceId);
});
