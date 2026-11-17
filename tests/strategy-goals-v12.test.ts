import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import { EnterpriseScopeStore } from '../src/host/enterprise-scope-store.ts';
import { StrategyGoalsStore } from '../src/host/strategy-goals-store.ts';
import { createStrategyGoalSources, validateStrategyGoalScope } from '../src/host/strategy-goal-sources.ts';
import { createStrategyGoalRoutes } from '../src/host/strategy-goals-routes.ts';
import type { GoalDraftInput, GoalSourceRef } from '../src/host/strategy-goals-types.ts';

const goalDraft = (): GoalDraftInput => ({ title: '明确会员业务模块的改善重点', outcome: '在已知职责内形成有依据的选择，上层战略保持未知', perspective: 'profit', scope: { kind: 'department', id: 'member-team', name: '会员业务模块' }, measurement: { kind: 'deliverable', criterion: '交付候选方向、条件与未知' }, baseline: { state: 'pending', description: '观察期间与会员口径待核' }, responsible: '会员业务负责人' });
function fixture(t: { after(fn: () => void): void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-v12-goals-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  return { root, store: new StrategyGoalsStore(root), directory: new EnterpriseScopeStore(path.join(root, 'enterprise')) };
}

test('a department can retain unknown upper organization without creating a directory entry or weakening a declared enterprise identity', t => {
  const { store, directory } = fixture(t), input = goalDraft();
  assert.doesNotThrow(() => validateStrategyGoalScope(input.scope, directory));
  const value = store.create({ ...input, operationId: randomUUID() });
  store.adopt(value, { operationId: randomUUID(), expectedVersion: 1, decision: '明确采用本职责目标，上层未知' });
  assert.equal(store.read(value).scope.enterpriseId, undefined);
  assert.deepEqual(directory.list().enterprises, []);
  assert.throws(() => validateStrategyGoalScope({ ...input.scope, enterpriseId: randomUUID() }, directory), /strategy_goal_scope_unavailable/);
});

test('strategy candidate content and exact discussion source survive reopen and a new revision without rewriting old goal context', t => {
  const { root, store } = fixture(t), discussionId = randomUUID();
  const context = { kind: 'department', background: '已知会员业务职责；企业战略未知' };
  const source = { authority: 'strategy-discussion', id: discussionId, version: 'user-entry-v1', sessionId: 'native-strategy-session', entryType: 'message', sha256: 'a'.repeat(64) };
  const strategyContext = { summary: '优先核对会员购买阻碍，资源承诺仍待确认', methods: [{ id: 'playing-to-win', name: '战略选择框架' }], sources: [source] };
  const input = { ...goalDraft(), usageContext: context, strategyContext, source, operationId: randomUUID() } as unknown as GoalDraftInput & { operationId: string };
  const first = store.create(input);
  assert.deepEqual((first as any).usageContext, context);
  assert.deepEqual((first as any).strategyContext, strategyContext);
  assert.deepEqual(first.source, source);
  assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).schemaVersion, 3);
  const reopened = new StrategyGoalsStore(root);
  assert.deepEqual(reopened.create(input), first);
  const v2 = reopened.revise(first.goalId, { ...goalDraft(), title: '职责内新的候选', expectedVersion: 1, operationId: randomUUID(), usageContext: { kind: 'personal', background: '本次明确的个人观察职责' } } as any);
  assert.equal(v2.version, 2);
  assert.deepEqual(reopened.read(first), first);
  assert.deepEqual((reopened.read(v2) as any).usageContext, { kind: 'personal', background: '本次明确的个人观察职责' });
  assert.throws(() => reopened.create({ ...input, source: { ...source, version: 'latest' }, operationId: randomUUID() } as any), /invalid_strategy_goal_source/);
});

test('an adoption receipt binds the exact seen goal content and preserves discussion quote provenance without authorizing actions', async t => {
  const { root, store } = fixture(t), candidate = store.create({ ...goalDraft(), operationId: randomUUID() });
  const quote = '采用这个职责范围内的目标，基线继续补证。';
  const provenance = { kind: 'discussion-quote', discussionId: randomUUID(), sessionId: 'strategy-native', requestId: randomUUID(), userEntryId: 'native-user-entry', quoteStart: 3, quoteEnd: 3 + quote.length, quote, quoteSha256: createHash('sha256').update(quote).digest('hex'), goalContentSha256: '0'.repeat(64) };
  assert.throws(() => store.adopt(candidate, { operationId: randomUUID(), expectedVersion: 1, decision: quote, provenance } as any), /strategy_goal_content_changed/);
  assert.equal(store.read(candidate).status, 'candidate');
  const { goalContentSha256 } = await import('../src/host/strategy-goals-store.ts') as any;
  provenance.goalContentSha256 = goalContentSha256(candidate);
  assert.throws(() => store.adopt(candidate, { operationId: randomUUID(), expectedVersion: 1, decision: quote, provenance: { ...provenance, quoteEnd: provenance.quoteEnd + 1 } } as any), /invalid_strategy_goal_adoption_provenance/);
  const input = { operationId: randomUUID(), expectedVersion: 1, decision: quote, provenance };
  const adopted = store.adopt(candidate, input as any);
  assert.deepEqual((adopted as any).adoptionProvenance, provenance);
  const reread = new StrategyGoalsStore(root);
  assert.deepEqual(reread.adopt(candidate, input as any), adopted);
  assert.deepEqual((reread.read(candidate) as any).adoptionProvenance, provenance);
  assert.equal(reread.list().arrangements?.length ?? 0, 0);
  assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).schemaVersion, 3);
});

test('an exact discussion source is validated only through its injected native reader and does not borrow task identity', async () => {
  const calls: GoalSourceRef[] = [], source = { authority: 'strategy-discussion', id: randomUUID(), version: 'native-user-entry', sessionId: 'session-exact', entryType: 'message', sha256: 'b'.repeat(64) } as GoalSourceRef;
  let state = 'available';
  const options = { async readDiscussionSource(value: GoalSourceRef) { calls.push(value); if (state !== 'available') throw Object.assign(new Error(state), { code: state }); } } as any;
  const sources = createStrategyGoalSources(options);
  await sources.validate(source);
  assert.deepEqual(calls, [source]);
  await assert.rejects(sources.validate({ ...source, taskId: randomUUID() }), /strategy_goal_feedback_source_unavailable/);
  assert.equal(calls.length, 1);
  await assert.rejects(createStrategyGoalSources({} as any).validate(source), /strategy_goal_feedback_source_unavailable/);
  state = 'native source no longer readable';
  await assert.rejects(sources.validate(source), /strategy_goal_feedback_source_unavailable/);
});

test('generic goal HTTP routes cannot mint discussion adoption provenance and a dedicated verifier receives the exact candidate', async t => {
  const { store } = fixture(t), candidate = store.create({ ...goalDraft(), operationId: randomUUID() });
  const { goalContentSha256 } = await import('../src/host/strategy-goals-store.ts') as any;
  const input = { operationId: randomUUID(), version: 1, expectedVersion: 1, decision: '确认采用', provenance: { kind: 'ui-confirmation', discussionId: randomUUID(), sessionId: 'native-source', goalContentSha256: goalContentSha256(candidate) } };
  const route = createStrategyGoalRoutes({ store, mutate: async fn => fn(), isClosing: () => false });
  await assert.rejects(route(`/api/strategy/goals/${candidate.goalId}/adopt`, 'POST', input), /strategy_goal_adoption_provenance_unavailable/);
  assert.equal(store.read(candidate).status, 'candidate');
  const seen: unknown[] = [];
  const verified = createStrategyGoalRoutes({ store, mutate: async <T>(fn: () => T | Promise<T>) => fn(), isClosing: () => false, validateAdoption(ref: unknown, value: unknown) { seen.push({ ref, value }); } });
  const result = await verified(`/api/strategy/goals/${candidate.goalId}/adopt`, 'POST', input);
  assert.equal((result?.body as any).goal.status, 'adopted');
  assert.deepEqual(seen, [{ ref: { goalId: candidate.goalId, version: 1 }, value: input }]);
  assert.deepEqual(await verified(`/api/strategy/goals/${candidate.goalId}/adopt`, 'POST', input), result);
  assert.equal(seen.length, 1);
});

test('an exact management context snapshot is read atomically without migrating storage and remains fixed after later relation feedback', t => {
  const { store } = fixture(t), a = store.create({ ...goalDraft(), operationId: randomUUID() }), b = store.create({ ...goalDraft(), title: '明确服务所需资源', operationId: randomUUID() });
  for (const ref of [a, b]) store.adopt(ref, { operationId: randomUUID(), expectedVersion: 1, decision: '采用这一准确职责目标' });
  const relation = store.relate({ operationId: randomUUID(), from: b, to: a, kind: 'contribution', responsibility: '职责内资源', rationale: '贡献尚待验证，存在替代路径' });
  const feedback = store.recordFeedback({ operationId: randomUUID(), goal: a, level: 'strategic-assumption', note: '外部前提发生变化，需要重新核对', source: { authority: 'case', id: randomUUID(), version: 1 } });
  const before = fs.readFileSync(store.file);
  const snapshot = (store as any).readContext([a]);
  assert.deepEqual(snapshot.goals, [store.read(a)]);
  assert.deepEqual(snapshot.relations.map((value: any) => [value.id, value.revision, value.from, value.to]), [[relation.id, 1, { goalId: b.goalId, version: 1 }, { goalId: a.goalId, version: 1 }]]);
  assert.deepEqual(snapshot.feedback, [feedback]);
  assert.deepEqual(fs.readFileSync(store.file), before);
  store.reviseRelation(relation.id, { ...relation, operationId: randomUUID(), expectedRevision: 1, rationale: '新的解释，与旧证据分开' });
  assert.equal(snapshot.relations[0].revision, 1);
  assert.equal((store as any).readContext([a]).relations[0].revision, 2);
  assert.equal((store as any).readContext([a], snapshot.basis).relations[0].revision, 1);
  assert.deepEqual(snapshot.feedback, [feedback]);
});
