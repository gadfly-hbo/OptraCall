import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { StrategyGoalsStore } from '../src/host/strategy-goals-store.ts';
import { EnterpriseScopeStore } from '../src/host/enterprise-scope-store.ts';
import { createMetricLibrary } from '../extensions/business-plugins/metric-factory/library/store.ts';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';
import type { GoalDraftInput } from '../src/host/strategy-goals-types.ts';

const baseDraft = (changes: Partial<GoalDraftInput> = {}): GoalDraftInput => ({
  title: '会员持续购买', outcome: '按适用窗口核对持续购买并明确下一轮观察重点', perspective: 'profit',
  scope: { kind: 'personal', id: 'self', name: '合成个人职责' }, bscPerspective: '客户',
  measurement: { kind: 'quantitative', sapMetric: { authority: 'sap-metric', id: 'metric-repeat', version: '3' }, target: '先核定可比基线' },
  baseline: { state: 'pending', description: '待补完整首购历史' }, responsible: '会员运营', necessaryConditions: ['会员资格和交易窗口口径适用'], ...changes,
});
function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optracall-goals-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const enterprise = new EnterpriseScopeStore(root).create({ name: '合成零售企业' });
  const draft = (changes: Partial<GoalDraftInput> = {}) => baseDraft({ scope: { kind: 'enterprise', id: enterprise.id, name: enterprise.name }, ...changes });
  return { root, store: new StrategyGoalsStore(root), enterprise, draft };
}

test('candidate goal remains retrievable after reopen without becoming an adopted enterprise target', t => {
  const { root, store, draft } = fixture(t), input = { ...draft(), operationId: randomUUID() };
  const value = store.create(input);
  assert.equal(store.list().goals.length, 1);
  assert.equal(value.status, 'candidate');
  const record = new StrategyGoalsStore(root).list().goals[0];
  assert.equal(record.adoptedVersion, null);
  assert.equal(record.versions[0].measurement.kind, 'quantitative');
  assert.deepEqual(record.versions[0].baseline, { state: 'pending', description: '待补完整首购历史' });
});

test('only an explicit adoption decision makes one exact candidate the shared BSC and GSA goal', t => {
  const { root, store, draft } = fixture(t), candidate = store.create({ ...draft(), operationId: randomUUID() });
  const value = store.adopt(candidate, { expectedVersion: 1, operationId: randomUUID(), decision: '确认采用这一目标及口径，基线待补' });
  assert.equal(value.status, 'adopted');
  assert.equal(new StrategyGoalsStore(root).get(candidate.goalId).adoptedVersion, 1);
  assert.deepEqual(store.read(candidate).measurement, draft().measurement);
});

test('map handoff publication belongs to each exact receipt without changing goal or operation bodies', t => {
  const {root,store,draft}=fixture(t);
  const map={discussionId:randomUUID(),mapId:randomUUID(),version:1,sha256:'a'.repeat(64)};
  const input=draft({structured:{groupId:map.mapId,nodeId:'G1',planTitle:'合成地图',map,parents:[],strategies:[],metrics:[]}});
  const [legacy]=store.saveTable(randomUUID(),[{input,expected:null}]);
  const operationId=randomUUID(),publication={publicationId:randomUUID(),publishedAt:new Date().toISOString()};
  const rows=[{input,expected:{goalId:legacy.goalId,version:legacy.version}}];
  const [released]=store.saveTable(operationId,rows,publication);
  assert.equal(released.goalId,legacy.goalId);
  assert.equal(released.version,2);
  assert.deepEqual(released.structured,legacy.structured);

  const reopened=new StrategyGoalsStore(root);
  assert.deepEqual(reopened.read(legacy),legacy);
  assert.deepEqual(reopened.saveTable(operationId,rows,publication),[released]);
  assert.deepEqual(reopened.saveTable(randomUUID(),rows,publication),[released]);
  assert.deepEqual(reopened.getOperation(operationId)?.result,released);
  const handoffs=reopened.mapHandoffs(map.discussionId,map.mapId,map.version,map.sha256);
  assert.deepEqual(handoffs.map(({version,publicationId,historical})=>({version,publicationId,historical})),[
    {version:1,publicationId:undefined,historical:true},
    {version:2,publicationId:publication.publicationId,historical:false},
  ]);
});

test('a revised candidate leaves the adopted goal and old Case or report references on their original version', t => {
  const { store, draft } = fixture(t), initial = store.create({ ...draft(), operationId: randomUUID() });
  const first = store.adopt(initial, { expectedVersion: 1, operationId: randomUUID(), decision: '采纳v1' });
  const revised = store.revise(first.goalId, { ...draft({ title: '会员持续购买与可比口径', measurement: { kind: 'quantitative', sapMetric: { authority: 'sap-metric', id: 'metric-repeat', version: '4' } } }), expectedVersion: 1, operationId: randomUUID() });
  assert.equal(revised.version, 2);
  assert.equal(revised.status, 'candidate');
  assert.equal(store.get(first.goalId).adoptedVersion, 1);
  assert.deepEqual(store.read(first), first);
  store.adopt(revised, { expectedVersion: 2, operationId: randomUUID(), decision: '采纳v2供后续明确采用' });
  assert.equal(store.get(first.goalId).adoptedVersion, 2);
  assert.deepEqual(store.read(first), first);
});

test('retrying an accepted create request returns its original candidate and rejects reuse for different intent', t => {
  const { root, store, draft } = fixture(t), input = { ...draft(), operationId: randomUUID() };
  const first = store.create(input), repeated = new StrategyGoalsStore(root).create(input);
  assert.deepEqual(repeated, first);
  assert.equal(store.list().goals.length, 1);
  assert.throws(() => store.create({ ...input, title: '另一目标' }), /strategy_goal_operation_conflict/);
  assert.equal(store.list().goals.length, 1);
});

test('a department contribution uses an exact adopted parent goal while an unadopted candidate cannot become its basis', t => {
  const { root, store, draft, enterprise } = fixture(t), parent = store.create({ ...draft(), operationId: randomUUID() });
  const child = store.create({ ...draft({ title: '核清会员交易口径', scope: { kind: 'department', id: 'member-team', name: '会员运营部', enterpriseId: enterprise.id }, measurement: { kind: 'deliverable', criterion: '形成可复查的窗口与资格核对稿' } }), operationId: randomUUID() });
  const relation = { from: { goalId: child.goalId, version: 1 }, to: { goalId: parent.goalId, version: 1 }, kind: 'contribution' as const, responsibility: '会员运营部负责口径和群体解释', rationale: '部门提供可核查依据，不分摊企业复购率', operationId: randomUUID() };
  assert.throws(() => store.relate(relation), /strategy_goal_not_adopted/);
  assert.equal(store.list().relations.length, 0);
  store.adopt(parent, { expectedVersion: 1, operationId: randomUUID(), decision: '采用企业目标' });
  store.adopt(child, { expectedVersion: 1, operationId: randomUUID(), decision: '采用部门贡献目标' });
  const value = store.relate(relation);
  assert.deepEqual(value.to, { goalId: parent.goalId, version: 1 });
  assert.deepEqual(new StrategyGoalsStore(root).list().relations, [value]);
  assert.equal(store.list().goals.length, 2);
});

test('a relationship revision preserves its old responsibility and exact target references for history', t => {
  const { store, draft } = fixture(t), a = store.create({ ...draft(), operationId: randomUUID() }), b = store.create({ ...draft({ title: '形成合格口径说明', perspective: 'personal', scope: { kind: 'personal', id: 'analyst', name: '分析协作人' }, measurement: { kind: 'deliverable', criterion: '可复查的会员资格核对说明' } }), operationId: randomUUID() });
  for (const ref of [a, b]) store.adopt(ref, { expectedVersion: 1, operationId: randomUUID(), decision: '采用当前职责目标' });
  const initial = store.relate({ from: b, to: a, kind: 'contribution', responsibility: '核会员资格', rationale: '按实际职责贡献', operationId: randomUUID() });
  const original = store.readRelation(initial.id, 1);
  const operationId=randomUUID();
  const next = store.reviseRelation(initial.id, { from: b, to: a, kind: 'contribution', responsibility: '核会员资格并说明观察窗口', rationale: '按新增资料责任调整', expectedRevision: 1, operationId });
  const snapshots=store.operationContext(store.getOperation(operationId)!);
  assert.deepEqual(snapshots.map(s=>s.relations[0]?.revision),[1,2]);
  assert.deepEqual(snapshots.map(s=>s.feedback),[[],[]]);
  assert.equal(next.revision, 2);
  assert.equal(next.responsibility, '核会员资格并说明观察窗口');
  assert.deepEqual(store.readRelation(initial.id, 1), original);
  assert.throws(() => store.reviseRelation(initial.id, { ...next, responsibility: '过期改写', expectedRevision: 1, operationId: randomUUID() }), /strategy_goal_relation_conflict/);
});

test('execution, strategy and strategic-assumption feedback reference original records rather than duplicating action facts', t => {
  const { root, store, draft } = fixture(t), target = store.create({ ...draft(), operationId: randomUUID() });
  store.adopt(target, { expectedVersion: 1, operationId: randomUUID(), decision: '采纳当前目标' });
  const source = { authority: 'case' as const, id: randomUUID(), version: 3 };
  for (const level of ['execution', 'strategy', 'strategic-assumption'] as const) {
    store.recordFeedback({ goal: target, level, source, note: `依据原记录复核${level}层安排，效果仍待观察`, operationId: randomUUID() });
  }
  const feedback = new StrategyGoalsStore(root).list().feedback;
  assert.equal(feedback.length, 3);
  assert.deepEqual(feedback.map(x => x.level), ['execution', 'strategy', 'strategic-assumption']);
  assert.deepEqual(feedback[0].source, source);
  assert.equal('action' in feedback[0], false);
  assert.equal('effect' in feedback[0], false);
  assert.equal(store.list().goals[0].versions.length, 1);
});

test('persisted relations with an unadopted basis are rejected without rewriting management history', t => {
  const { store, draft } = fixture(t), candidate = store.create({ ...draft(), operationId: randomUUID() });
  const bytes = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  bytes.relations.push({ id: randomUUID(), from: { goalId: candidate.goalId, version: 1 }, to: { goalId: candidate.goalId, version: 9 }, kind: 'contribution', responsibility: '合成职责', rationale: '损坏来源反例', revision: 1, createdAt: new Date().toISOString(), history: [] });
  const corrupted = JSON.stringify(bytes); fs.writeFileSync(store.file, corrupted);
  assert.throws(() => store.list(), /invalid_strategy_goals_storage/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), corrupted);
});

test('quantitative goals reject moving SAP versions instead of silently following a future definition', t => {
  const { store, draft } = fixture(t);
  assert.throws(() => store.create({ ...draft({ measurement: { kind: 'quantitative', sapMetric: { authority: 'sap-metric', id: 'metric-repeat', version: 'latest' } } }), operationId: randomUUID() }), /invalid_strategy_goal_metric/);
  assert.equal(store.list().goals.length, 0);
});

test('stale edits fail while an exact accepted operation can still be read back after later revisions', t => {
  const { root, store, draft } = fixture(t), candidate = store.create({ ...draft(), operationId: randomUUID() });
  const input = { expectedVersion: 1, operationId: randomUUID(), decision: '明确采纳v1' }, adopted = store.adopt(candidate, input);
  store.revise(candidate.goalId, { ...draft({ title: '待核v2' }), expectedVersion: 1, operationId: randomUUID() });
  assert.throws(() => store.revise(candidate.goalId, { ...draft({ title: '过期编辑' }), expectedVersion: 1, operationId: randomUUID() }), /strategy_goal_conflict/);
  assert.deepEqual(new StrategyGoalsStore(root).adopt(candidate, input), adopted);
  assert.deepEqual(store.getOperation(input.operationId)?.result, adopted);
  assert.equal(store.get(candidate.goalId).versions.length, 2);
});

test('candidate adoption requires actual decision text and does not consume a rejected operation', t => {
  const { store, draft } = fixture(t), candidate = store.create({ ...draft(), operationId: randomUUID() }), operationId = randomUUID();
  assert.throws(() => store.adopt(candidate, { expectedVersion: 1, operationId, decision: '  ' }), /invalid_strategy_goal/);
  assert.equal(store.getOperation(operationId), null);
  assert.equal(store.get(candidate.goalId).adoptedVersion, null);
});

test('nonprofit and personal goals can use verifiable deliverables without constructing a full enterprise hierarchy', t => {
  const { root, store, draft } = fixture(t);
  for (const perspective of ['nonprofit', 'personal'] as const) {
    const candidate = store.create({ ...draft({ perspective, scope: { kind: 'personal', id: 'self', name: '当前责任人' }, measurement: { kind: 'deliverable', criterion: '可回查的服务对象观察说明' }, baseline: { state: 'known', description: '当前有两轮服务记录' } }), operationId: randomUUID() });
    store.adopt(candidate, { expectedVersion: 1, operationId: randomUUID(), decision: '采用这一成果要求' });
  }
  assert.deepEqual(new StrategyGoalsStore(root).list().goals.map(x => x.versions[0].perspective), ['nonprofit', 'personal']);
  assert.equal(store.list().relations.length, 0);
});

test('repeated feedback by source and content reuses the record and rejects a moving source version', t => {
  const { store, draft } = fixture(t), candidate = store.create({ ...draft(), operationId: randomUUID() });
  store.adopt(candidate, { expectedVersion: 1, operationId: randomUUID(), decision: '明确采用' });
  const input = { goal: candidate, level: 'execution' as const, source: { authority: 'decision-board' as const, id: randomUUID(), version: 2 }, note: '按看板原安排核对，未证实效果' };
  const first = store.recordFeedback({ ...input, operationId: randomUUID() });
  assert.deepEqual(store.recordFeedback({ ...input, operationId: randomUUID() }), first);
  assert.equal(store.list().feedback.length, 1);
  assert.throws(() => store.recordFeedback({ ...input, source: { ...input.source, version: 'latest' }, operationId: randomUUID() }), /invalid_strategy_goal_source/);
});

test('unknown schemas remain untouched and are never replaced by an empty current index', t => {
  const { root, store, draft } = fixture(t); fs.mkdirSync(store.root);
  const bytes = '{"schemaVersion":99,"futureGoals":["keep"]}'; fs.writeFileSync(store.file, bytes);
  assert.throws(() => new StrategyGoalsStore(root).list(), /invalid_strategy_goals_storage/);
  assert.throws(() => store.create({ ...draft(), operationId: randomUUID() }), /invalid_strategy_goals_storage/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), bytes);
});

test('symlink and hardlink goal indexes are rejected without changing their referenced bytes', t => {
  const { root, store, draft } = fixture(t); fs.mkdirSync(store.root);
  const target = path.join(root, 'original.json'), bytes = '{"original":"keep"}'; fs.writeFileSync(target, bytes);
  fs.symlinkSync(target, store.file);
  assert.throws(() => store.list(), /unsafe_strategy_goals_storage/);
  assert.throws(() => store.create({ ...draft(), operationId: randomUUID() }), /unsafe_strategy_goals_storage/);
  assert.equal(fs.readFileSync(target, 'utf8'), bytes);
  fs.unlinkSync(store.file); fs.linkSync(target, store.file);
  assert.throws(() => store.list(), /unsafe_strategy_goals_storage/);
  assert.equal(fs.readFileSync(target, 'utf8'), bytes);
});

test('an interrupted write claim is not removed or replayed by a new mutation', t => {
  const { store, draft } = fixture(t); fs.mkdirSync(store.root);
  const lock = path.join(store.root, '.write.lock'); fs.writeFileSync(lock, 'unknown previous writer');
  assert.throws(() => store.create({ ...draft(), operationId: randomUUID() }), /strategy_goals_locked/);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'unknown previous writer');
  assert.equal(fs.existsSync(store.file), false);
});

test('a declared department retains its original enterprise anchor while old unanchored goal history remains unchanged', t => {
  const { root, store, draft } = fixture(t), enterprise = new EnterpriseScopeStore(root).create({ name: '真实测试企业目录' });
  const scope = { kind: 'department' as const, id: 'member-team', name: '用户声明会员部门', enterpriseId: enterprise.id };
  const candidate = store.create({ ...draft({ scope }), operationId: randomUUID() });
  assert.deepEqual(new StrategyGoalsStore(root).read(candidate).scope, scope);
  const legacy = store.create({ ...draft({ scope: { kind: 'department', id: 'legacy-team', name: '旧部门职责' } }), operationId: randomUUID() });
  const original = store.read(legacy), before = fs.readFileSync(store.file);
  assert.deepEqual(new StrategyGoalsStore(root).read(legacy), original);
  assert.ok(fs.readFileSync(store.file).equals(before));
  const revised = store.revise(legacy.goalId, { ...draft({ scope }), expectedVersion: 1, operationId: randomUUID() });
  assert.deepEqual(store.read(legacy), original);
  assert.equal(store.read(revised).scope.enterpriseId, enterprise.id);
});

test('a selected published SAP metric retains its specific metric name and package version without rewriting older package-only history', t => {
  const { root, store, draft } = fixture(t), library = createMetricLibrary(path.join(root, 'metrics'));
  const published = library.publish(preparePublication(fs.readFileSync(new URL('../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url))), 'synthetic-user');
  const metric = { authority: 'sap-metric' as const, id: published.id, version: published.version, metricName: published.metricNames[0] };
  const candidate = store.create({ ...draft({ measurement: { kind: 'quantitative', sapMetric: metric } }), operationId: randomUUID() });
  const measurement = new StrategyGoalsStore(root).read(candidate).measurement;
  assert.equal(measurement.kind, 'quantitative'); if (measurement.kind === 'quantitative') assert.deepEqual(measurement.sapMetric, metric);
});

test('old and current references to one actual Board feedback revision reuse the management record while preserving original references and operation receipts', async t => {
  const { root, store, draft } = fixture(t), board = createDecisionBoardStore({ root: path.join(root, 'board') }); await board.init();
  try {
    const candidate = store.create({ ...draft(), operationId: randomUUID() }); store.adopt(candidate, { expectedVersion: 1, operationId: randomUUID(), decision: '采用当前目标' });
    const projectId = randomUUID(), item = board.addManualItem({ projectId, title: '合成原行动依据', rationale: '事实只在看板维护' }); board.decideItem(item.id, { status: 'adopted' });
    let expectedRecords = 0;
    for (const currentFirst of [false, true]) {
      const task = board.addTask(item.id, { title: currentFirst ? '当前引用先保存' : '旧引用先保存' });
      const feedback = board.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: false, outcome: '原处用户反馈', metricDelta: '', review: '效果待核', score: null, effect: 'unknown' });
      const source = { authority: 'decision-board' as const, id: task.id, version: feedback.revisionId, projectId };
      const input = { goal: candidate, level: 'execution' as const, note: '依据原看板反馈核对目标安排，未推定经营效果' };
      const firstInput = { ...input, source: currentFirst ? { ...source, taskId: task.id } : source, operationId: randomUUID() };
      const repeatedInput = { ...input, source: currentFirst ? source : { ...source, taskId: task.id }, operationId: randomUUID() };
      const first = store.recordFeedback(firstInput), originalReceipt = store.getOperation(firstInput.operationId), before = JSON.parse(fs.readFileSync(store.file, 'utf8'));
      const originalRecordBytes = JSON.stringify(before.feedback.find((value: { id: string }) => value.id === first.id)), originalReceiptBytes = JSON.stringify(before.operations.find((value: { operationId: string }) => value.operationId === firstInput.operationId));
      assert.deepEqual(store.recordFeedback(repeatedInput), first); expectedRecords++;
      assert.equal(store.list().feedback.length, expectedRecords);
      const after = JSON.parse(fs.readFileSync(store.file, 'utf8'));
      assert.equal(JSON.stringify(after.feedback.find((value: { id: string }) => value.id === first.id)), originalRecordBytes);
      assert.equal(JSON.stringify(after.operations.find((value: { operationId: string }) => value.operationId === firstInput.operationId)), originalReceiptBytes);
      assert.deepEqual(store.getOperation(firstInput.operationId), originalReceipt);
      assert.deepEqual(new StrategyGoalsStore(root).recordFeedback(firstInput), first);
      assert.deepEqual(new StrategyGoalsStore(root).recordFeedback(repeatedInput), first);
      assert.throws(() => store.recordFeedback({ ...repeatedInput, operationId: firstInput.operationId }), /strategy_goal_operation_conflict/);
      const next = board.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: feedback.revisionId, adopted: false, outcome: '原处新版本', metricDelta: '', review: '仍待核', score: null, effect: 'unknown' });
      const differentVersion = store.recordFeedback({ ...input, source: { ...source, taskId: task.id, version: next.revisionId }, operationId: randomUUID() }); expectedRecords++;
      assert.notEqual(differentVersion.id, first.id); assert.equal(store.list().feedback.length, expectedRecords);
      assert.deepEqual(board.getFeedbackRevision(feedback.revisionId), feedback); assert.equal(board.getTask(task.id).status, 'todo');
    }
  } finally { board.close(); }
});
