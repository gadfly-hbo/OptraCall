import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';

const evidence = [{ materialId: 'orders', locator: '020_clean/orders.csv:2-7', quote: '合成订单', sourceLocator: '020_clean/orders.csv', sourceSha256: 'c'.repeat(64), rangeUtf16: { start: 0, end: 5, total: 20 } }];
function input() {
  return {
    operationId: randomUUID(), projectId: randomUUID(), taskId: randomUUID(), reviewId: randomUUID(),
    report: { relativePath: '060_reports/合成报告.md', sha256: 'a'.repeat(64), bytes: 100, observedSha256: 'b'.repeat(64), observedBytes: 120 },
    confirmedBy: 'local-user',
    conclusions: [{ claimId: 'claim-1', text: '合成资料显示样本期内退货减少。', location: '结论第一段', verdict: 'conditional' as const, conditions: ['仅限样本期与同口径订单'], evidence, reason: '合成订单同口径对照。', impact: '可作为本期观察。' }],
    recommendations: [],
  };
}
async function fixture(t: { after: (fn: () => unknown) => void }) {
  const base = path.resolve('.local/confirmed-conclusions-board-handoff/store');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'run-'));
  const store = createDecisionBoardStore({ root });
  await store.init(); t.after(() => store.close());
  return { root, store };
}

test('an unextracted report accepts one fixed conclusion without creating a suggestion or task', async t => {
  const { root, store } = await fixture(t), request = input();
  const receipt = store.confirmReportConclusions(request);
  assert.equal(receipt.reportSha256, 'a'.repeat(64));
  assert.equal(receipt.confirmedBy, 'local-user');
  assert.equal(receipt.conclusionIds.length, 1);
  assert.deepEqual(receipt.boardItemIds, []);
  assert.deepEqual(store.listItems(), []); assert.deepEqual(store.listTasks(), []); assert.deepEqual(store.listExtractions(), []);
  const report = store.getReport(receipt.reportId)!;
  assert.equal(report.observedSha256, 'b'.repeat(64)); assert.equal(report.observedBytes, 120);
  const saved = store.listConfirmedConclusions(receipt.reportId)[0]!;
  assert.equal(saved.reportSha256, 'a'.repeat(64)); assert.equal(saved.taskId, request.taskId); assert.equal(saved.reviewId, request.reviewId);
  assert.equal(saved.text, request.conclusions[0]!.text); assert.deepEqual(saved.conditions, ['仅限样本期与同口径订单']); assert.deepEqual(saved.evidence, evidence);
  assert.equal(saved.claimId, 'claim-1'); assert.equal(saved.verdict, 'conditional');
  assert.equal(saved.confirmedAt, receipt.confirmedAt); assert.ok(Date.parse(saved.confirmedAt));
  store.close();
  const reopened = createDecisionBoardStore({ root }); await reopened.init();
  try { assert.deepEqual(reopened.listConfirmedConclusions(receipt.reportId), [saved]); assert.deepEqual(reopened.getConfirmationOperation(request.operationId), receipt); }
  finally { reopened.close(); }
});

test('request replay returns its immutable receipt; new operations deduplicate the exact reviewed claim', async t => {
  const { store } = await fixture(t), request = input();
  const first = store.confirmReportConclusions(request);
  assert.deepEqual(store.confirmReportConclusions({ ...request, report: { ...request.report, observedSha256: 'd'.repeat(64), observedBytes: 130 } }), first);
  assert.equal(store.getReport(first.reportId)!.observedSha256, 'b'.repeat(64), 'replay never rewrites today\'s observation');
  assert.throws(() => store.confirmReportConclusions({ ...request, conclusions: [{ ...request.conclusions[0]!, text: '同一请求换了选择正文' }] }), { code: 'confirmation_operation_conflict' });
  const second = store.confirmReportConclusions({ ...request, operationId: randomUUID() });
  assert.deepEqual(second.conclusionIds, first.conclusionIds); assert.deepEqual(second.addedConclusionIds, []);
  assert.equal(store.listConfirmedConclusions().length, 1);
  assert.throws(() => store.confirmReportConclusions({ ...request, operationId: randomUUID(), conclusions: [{ ...request.conclusions[0]!, text: '同一review身份不应偷换正文' }] }), { code: 'confirmation_source_conflict' });
  assert.equal(store.listConfirmedConclusions().length, 1);
  assert.equal(store.getConfirmationOperation(randomUUID()), null);
});

test('explicitly selected supported recommendations keep real provenance and append without resetting adoption, tasks or feedback', async t => {
  const { store } = await fixture(t), request = input();
  const recommendation = { ...request.conclusions[0]!, claimId: 'recommendation-1', text: '在样本同口径且供货稳定时开展小范围试点。'.repeat(20), reason: '有条件试点的原始依据。'.repeat(400), conclusionClaimIds: ['claim-1'] };
  const first = store.confirmReportConclusions({ ...request, recommendations: [recommendation] });
  assert.equal(first.boardItemIds.length, 1); assert.deepEqual(first.addedBoardItemIds, first.boardItemIds);
  let saved = store.getItem(first.boardItemIds[0]!);
  assert.equal(saved.sourceKind, 'report-confirmation'); assert.equal(saved.extractionId, null); assert.equal(saved.status, 'suggested');
  assert.equal(saved.confidence, null); assert.equal(saved.evidenceLevel, null); assert.equal(saved.evidence, null);
  assert.equal(saved.reportConfirmation!.text, recommendation.text); assert.equal(saved.reportConfirmation!.reason, recommendation.reason);
  assert.equal(saved.reportConfirmation!.verdict, 'conditional'); assert.deepEqual(saved.reportConfirmation!.conditions, ['仅限样本期与同口径订单']);
  assert.deepEqual(saved.reportConfirmation!.conclusionIds, first.conclusionIds); assert.deepEqual(saved.reportConfirmation!.evidence, evidence);
  assert.throws(() => store.addTask(saved.id, { title: '不可自动建任务' }), { code: 'task_requires_adoption' });
  store.decideItem(saved.id, { status: 'adopted' }); const task = store.addTask(saved.id, { title: '明确采纳后建任务', owner: '合成人员' });
  const feedback = store.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '合成试点尚待完成', metricDelta: '', review: '效果未知', score: null });
  const secondClaim = { ...request.conclusions[0]!, claimId: 'claim-2', text: '第二条独立结论。' };
  const second = store.confirmReportConclusions({ ...request, operationId: randomUUID(), conclusions: [secondClaim], recommendations: [{ ...recommendation, conclusionClaimIds: ['claim-2'] }] });
  assert.deepEqual(second.boardItemIds, first.boardItemIds); assert.deepEqual(second.addedBoardItemIds, []); assert.equal(second.addedConclusionIds.length, 1);
  saved = store.getItem(saved.id); assert.equal(saved.status, 'adopted'); assert.deepEqual(saved.reportConfirmation!.conclusionClaimIds, ['claim-1', 'claim-2']);
  assert.equal(store.listItems().length, 1); assert.deepEqual(store.getTask(task.id), task); assert.deepEqual(store.listFeedbackHistory(task.id), [feedback]);
  assert.deepEqual(store.getConfirmationOperation(request.operationId), first);
  const manual = store.addManualItem({ projectId: request.projectId, title: '人工补充', rationale: '经验' }); assert.equal(manual.sourceKind, 'manual'); assert.equal(manual.evidenceLevel, '经验假设');
});


test('a failed final receipt write rolls back report registration, every selected conclusion and every suggestion', async t => {
  const { store } = await fixture(t), request = input();
  const prepare = DatabaseSync.prototype.prepare;
  const hook = t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
    if (sql.startsWith('INSERT INTO confirmation_operations')) throw new Error('synthetic receipt write failure');
    return prepare.call(this, sql);
  });
  const recommendation = { ...request.conclusions[0]!, claimId: 'recommendation-1', conclusionClaimIds: ['claim-1'] };
  try { assert.throws(() => store.confirmReportConclusions({ ...request, recommendations: [recommendation] }), /synthetic receipt write failure/); }
  finally { hook.mock.restore(); }
  assert.deepEqual(store.listReports(), []); assert.deepEqual(store.listConfirmedConclusions(), []); assert.deepEqual(store.listItems(), []);
  assert.equal(store.getConfirmationOperation(request.operationId), null);
  const retry = store.confirmReportConclusions({ ...request, recommendations: [recommendation] });
  assert.equal(retry.addedConclusionIds.length, 1); assert.equal(retry.addedBoardItemIds.length, 1);
});

test('late failure while appending leaves existing report observation, decision state and original receipts intact', async t => {
  const { store } = await fixture(t), request = input();
  const recommendation = { ...request.conclusions[0]!, claimId: 'recommendation-1', conclusionClaimIds: ['claim-1'] };
  const first = store.confirmReportConclusions({ ...request, recommendations: [recommendation] });
  store.decideItem(first.boardItemIds[0]!, { status: 'adopted' });
  const before = { report: store.getReport(first.reportId), item: store.getItem(first.boardItemIds[0]!), conclusions: store.listConfirmedConclusions() };
  const next = { ...request, operationId: randomUUID(), report: { ...request.report, observedSha256: 'd'.repeat(64), observedBytes: 150 }, conclusions: [{ ...request.conclusions[0]!, claimId: 'claim-2' }], recommendations: [{ ...recommendation, conclusionClaimIds: ['claim-2'] }] };
  const prepare = DatabaseSync.prototype.prepare;
  const hook = t.mock.method(DatabaseSync.prototype, 'prepare', function(this: DatabaseSync, sql: string) {
    if (sql.startsWith('INSERT INTO confirmation_operations')) throw new Error('synthetic append failure');
    return prepare.call(this, sql);
  });
  try { assert.throws(() => store.confirmReportConclusions(next), /synthetic append failure/); }
  finally { hook.mock.restore(); }
  assert.deepEqual(store.getReport(first.reportId), before.report); assert.deepEqual(store.getItem(first.boardItemIds[0]!), before.item); assert.deepEqual(store.listConfirmedConclusions(), before.conclusions);
  assert.deepEqual(store.getConfirmationOperation(request.operationId), first); assert.equal(store.getConfirmationOperation(next.operationId), null);
});

test('unsupported claims and unselected or forged recommendation relations have no write side effects', async t => {
  const { store } = await fixture(t), request = input();
  for (const verdict of ['insufficient', 'conflicting']) {
    assert.throws(() => store.confirmReportConclusions({ ...request, conclusions: [{ ...request.conclusions[0]!, verdict }] } as never), { code: 'invalid_confirmation' });
    assert.throws(() => store.confirmReportConclusions({ ...request, recommendations: [{ ...request.conclusions[0]!, claimId: 'r', verdict, conclusionClaimIds: ['claim-1'] }] } as never), { code: 'invalid_confirmation' });
  }
  assert.throws(() => store.confirmReportConclusions({ ...request, recommendations: [{ ...request.conclusions[0]!, claimId: 'r', conclusionClaimIds: ['unselected-claim'] }] }), { code: 'invalid_confirmation' });
  assert.throws(() => store.confirmReportConclusions({ ...request, conclusions: [] }), { code: 'invalid_confirmation' });
  assert.deepEqual(store.listReports(), []); assert.deepEqual(store.listItems(), []); assert.deepEqual(store.listConfirmedConclusions(), []);
});

test('new report bytes produce an independently fixed history version without relabeling previous confirmations', async t => {
  const { store } = await fixture(t), request = input();
  const first = store.confirmReportConclusions(request), original = store.listConfirmedConclusions(first.reportId)[0]!;
  const second = store.confirmReportConclusions({ ...request, operationId: randomUUID(), reviewId: randomUUID(), report: { ...request.report, sha256: 'd'.repeat(64), bytes: 180, observedSha256: 'd'.repeat(64), observedBytes: 180 } });
  assert.equal(second.reportId, first.reportId); assert.notDeepEqual(second.conclusionIds, first.conclusionIds);
  assert.deepEqual(store.listConfirmedConclusions(first.reportId).find(c => c.id === original.id), original);
  assert.equal(store.getReport(first.reportId)!.observedSha256, 'd'.repeat(64)); assert.equal(store.listConfirmedConclusions(first.reportId).length, 2);
});

test('independent concurrent processes deduplicate one reviewed source while each gets its own durable receipt', async t => {
  const { root, store } = await fixture(t), basic = input();
  const request = { ...basic, recommendations: [{ ...basic.conclusions[0]!, claimId:'recommendation-race', conclusionClaimIds:['claim-1'] }] }; store.close();
  const script = `import {createDecisionBoardStore} from ${JSON.stringify(pathToFileURL(path.resolve('extensions/business-plugins/decision-board/storage/store.ts')).href)}; const store=createDecisionBoardStore({root:process.argv[1]}); await store.init(); process.stdout.write('ready\\n'); process.stdin.once('data',()=>{try{process.stdout.write(JSON.stringify(store.confirmReportConclusions(JSON.parse(process.argv[2]))));}finally{store.close();}});`;
  const requests = [request, { ...request, operationId: randomUUID() }];
  const workers = requests.map(value => spawn(process.execPath, ['--input-type=module', '-e', script, root, JSON.stringify(value)], { stdio: ['pipe','pipe','pipe'] }));
  t.after(() => { for (const child of workers) if (child.exitCode === null) child.kill(); });
  await Promise.all(workers.map(child => once(child.stdout, 'data')));
  const completions = workers.map(child => {
    let output = '', errors = ''; child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { errors += String(chunk); });
    return once(child, 'exit').then(([code]) => { assert.equal(code, 0, errors); return JSON.parse(output); });
  });
  for (const child of workers) child.stdin.end('go');
  const receipts = await Promise.all(completions);
  assert.deepEqual(receipts[0].conclusionIds, receipts[1].conclusionIds); assert.deepEqual(receipts[0].boardItemIds, receipts[1].boardItemIds);
  assert.equal(receipts.reduce((sum,r) => sum + r.addedConclusionIds.length,0), 1);
  await store.init(); assert.equal(store.listConfirmedConclusions().length,1); assert.equal(store.listItems().length,1);
  for (const receipt of receipts) assert.deepEqual(store.getConfirmationOperation(receipt.operationId), receipt);
});

// Frozen historical schema2 DDL; it must stay independent of future migrations.
const SCHEMA2 = `
CREATE TABLE reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id TEXT NOT NULL, relative_path TEXT NOT NULL,
 observed_sha256 TEXT, observed_bytes INTEGER, observed_at TEXT,
 last_extraction_at TEXT,
 first_seen_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id, relative_path)
);
CREATE TABLE extractions (
 id TEXT PRIMARY KEY,
 report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE RESTRICT,
 configuration_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled','interrupted')),
 error TEXT,
 source_sha256 TEXT NOT NULL, source_bytes INTEGER NOT NULL,
 source_chars INTEGER NOT NULL, truncated INTEGER NOT NULL,
 item_count INTEGER, dropped_item_count INTEGER,
 session_file TEXT, report_excerpt TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE board_items (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 report_id INTEGER REFERENCES reports(id) ON DELETE RESTRICT,
 extraction_id TEXT,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('extracted','manual')),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 rationale TEXT NOT NULL CHECK(length(rationale) BETWEEN 1 AND 4000),
 expected_impact TEXT NOT NULL DEFAULT '' CHECK(length(expected_impact)<=2000),
 priority TEXT NOT NULL CHECK(priority IN ('high','medium','low')),
 effort TEXT CHECK(effort IS NULL OR length(effort)<=200),
 confidence REAL CHECK(confidence IS NULL OR (confidence>0 AND confidence<=1)),
 evidence_level TEXT CHECK(evidence_level IS NULL OR evidence_level IN ('数据支撑','多源佐证','逻辑推断','经验假设')),
 evidence_json TEXT,
 status TEXT NOT NULL CHECK(status IN ('suggested','adopted','dismissed')),
 dismissed_reason TEXT, decided_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((status='dismissed' AND dismissed_reason IS NOT NULL AND length(dismissed_reason)>=2) OR (status!='dismissed' AND dismissed_reason IS NULL))
);
CREATE TABLE board_tasks (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES board_items(id) ON DELETE RESTRICT,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 owner TEXT CHECK(owner IS NULL OR length(owner)<=200),
 due_date TEXT CHECK(due_date IS NULL OR length(due_date)<=40),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=2000),
 status TEXT NOT NULL CHECK(status IN ('todo','doing','done')),
 priority TEXT NOT NULL CHECK(priority IN ('high','medium','low')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE task_feedback (
 task_id TEXT PRIMARY KEY REFERENCES board_tasks(id) ON DELETE RESTRICT,
 adopted INTEGER NOT NULL CHECK(adopted IN (0,1)),
 outcome TEXT NOT NULL DEFAULT '' CHECK(length(outcome)<=4000),
 metric_delta TEXT NOT NULL DEFAULT '' CHECK(length(metric_delta)<=1000),
 review TEXT NOT NULL DEFAULT '' CHECK(length(review)<=4000),
 score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX board_items_report ON board_items(report_id);
CREATE INDEX board_tasks_item ON board_tasks(item_id);
PRAGMA user_version=1;

CREATE TABLE feedback_revisions (
 revision_id TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES board_tasks(id) ON DELETE RESTRICT,
 revision_number INTEGER NOT NULL CHECK(revision_number>0),
 operation_id TEXT UNIQUE, request_sha256 TEXT,
 adopted INTEGER NOT NULL CHECK(adopted IN (0,1)),
 outcome TEXT NOT NULL CHECK(length(outcome)<=4000),
 metric_delta TEXT NOT NULL CHECK(length(metric_delta)<=1000),
 review TEXT NOT NULL CHECK(length(review)<=4000),
 score INTEGER CHECK(score IS NULL OR (score BETWEEN 1 AND 5 AND score=CAST(score AS INTEGER))),
 effect TEXT NOT NULL CHECK(effect IN ('unknown','positive','negative','none')),
 saved_at TEXT NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('user-save','legacy-current')),
 legacy_created_at TEXT, legacy_updated_at TEXT,
 UNIQUE(task_id,revision_number),
 CHECK((origin='user-save' AND operation_id IS NOT NULL AND request_sha256 IS NOT NULL AND length(request_sha256)=64 AND legacy_created_at IS NULL AND legacy_updated_at IS NULL)
    OR (origin='legacy-current' AND operation_id IS NULL AND request_sha256 IS NULL AND revision_number=1 AND legacy_created_at IS NOT NULL AND legacy_updated_at IS NOT NULL))
);
PRAGMA user_version=2;
`;

async function legacyFixture(t: { after: (fn: () => unknown) => void }) {
  const base = path.resolve('.local/confirmed-conclusions-board-handoff/store'); await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'legacy-')), file = path.join(root,'decision-board.sqlite3');
  const db = new DatabaseSync(file); db.exec(SCHEMA2);
  const projectId = randomUUID(), itemId = randomUUID(), taskId = randomUUID();
  const at = '2026-10-20T00:00:00.000Z';
  db.prepare('INSERT INTO reports (id,project_id,relative_path,observed_sha256,observed_bytes,first_seen_at,updated_at) VALUES (1,?,?,?,?,?,?)').run(projectId,'060_reports/legacy.md','f'.repeat(64),40,at,at);
  db.prepare("INSERT INTO board_items (id,project_id,report_id,source_kind,title,rationale,priority,status,decided_at,created_at,updated_at) VALUES (?,?,1,'manual','保留人工建议','原依据','medium','adopted',?,?,?)").run(itemId,projectId,at,at,at);
  db.prepare("INSERT INTO board_tasks (id,item_id,title,status,priority,created_at,updated_at) VALUES (?,?,'保留原任务','doing','medium',?,?)").run(taskId,itemId,at,at);
  db.prepare("INSERT INTO task_feedback (task_id,adopted,outcome,metric_delta,review,score,created_at,updated_at) VALUES (?,1,'原件旧反馈','','原复盘',3,?,?)").run(taskId,at,at);
  db.prepare("INSERT INTO feedback_revisions (revision_id,task_id,revision_number,operation_id,request_sha256,adopted,outcome,metric_delta,review,score,effect,saved_at,origin,legacy_created_at,legacy_updated_at) VALUES (?,?,1,?,?,1,'  保留新修订\n','','未知',NULL,'unknown',?,'user-save',NULL,NULL)").run(randomUUID(),taskId,randomUUID(),'e'.repeat(64),at);
  const names = ['reports','extractions','board_items','board_tasks','task_feedback','feedback_revisions'];
  const rows = Object.fromEntries(names.map(name => [name, db.prepare(`SELECT * FROM ${name}`).all()])); db.close();
  const store = createDecisionBoardStore({ root }); t.after(() => store.close());
  return { root, file, store, rows, taskId, itemId };
}

test('controlled schema2 migration preserves all original row values, task and feedback and never duplicates on reopen', async t => {
  const { file, store, rows, taskId, itemId } = await legacyFixture(t);
  await store.init(); const task = store.getTask(taskId), feedback = store.listFeedbackHistory(taskId), item = store.getItem(itemId);
  assert.equal(item.sourceKind,'manual'); assert.equal(item.status,'adopted'); assert.equal(item.reportConfirmation,undefined);
  assert.equal(task.status,'doing'); assert.equal(feedback[0]!.outcome,'  保留新修订\n'); assert.equal(store.listConfirmedConclusions().length,0);
  store.close(); await store.init(); assert.deepEqual(store.getTask(taskId),task); assert.deepEqual(store.listFeedbackHistory(taskId),feedback); store.close();
  const db = new DatabaseSync(file, { readOnly:true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,3);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    for (const [name,before] of Object.entries(rows)) {
      const after = db.prepare(`SELECT * FROM ${name}`).all();
      assert.deepEqual(after, name === 'board_items' ? before.map(row => Object.assign(Object.create(null),row,{report_confirmation_json:null})) : before);
    }
  } finally { db.close(); }
});

test('an interrupted schema2 replacement rolls back its original table, rows and schema version', async t => {
  const { file, store } = await legacyFixture(t), bytes = await fs.readFile(file);
  const exec = DatabaseSync.prototype.exec;
  const hook = t.mock.method(DatabaseSync.prototype,'exec',function(this: DatabaseSync,sql: string) {
    if (sql.includes('CREATE TABLE confirmed_conclusions')) throw new Error('synthetic schema2 migration failure');
    return exec.call(this,sql);
  });
  try { await assert.rejects(async () => store.init(), { code:'board_migration_failed' }); }
  finally { hook.mock.restore(); }
  assert.deepEqual(await fs.readFile(file),bytes,'failed migration preserves the exact historical database bytes');
  const db = new DatabaseSync(file,{readOnly:true}); try { assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,2); } finally { db.close(); }
  await store.init(); assert.equal(store.listItems().length,1); assert.equal(store.listTasks().length,1);
});

test('selection order is canonical while reviewed quotation whitespace and source ranges remain exact', async t => {
  const { store } = await fixture(t), request = input();
  const upper = { ...request.conclusions[0]!, claimId:'Z', text:'  原报告中的逐字结论\n', conditions:['  原适用条件\n'] };
  const lower = { ...request.conclusions[0]!, claimId:'a' };
  const recommendation = { ...request.conclusions[0]!, claimId:'action', conclusionClaimIds:['a','Z','a'] };
  const ordered = { ...request, conclusions:[lower,upper], recommendations:[recommendation] };
  const first = store.confirmReportConclusions(ordered);
  assert.deepEqual(first.claimIds,['Z','a']); assert.deepEqual(first.recommendationClaimIds,['action']);
  assert.deepEqual(store.confirmReportConclusions({ ...ordered, conclusions:[upper,lower], recommendations:[{ ...recommendation, conclusionClaimIds:['Z','a'] }] }),first);
  assert.equal(store.listConfirmedConclusions().find(c => c.claimId === 'Z')!.text,'  原报告中的逐字结论\n');
  assert.deepEqual(store.listConfirmedConclusions().find(c => c.claimId === 'Z')!.conditions,['  原适用条件\n']);
  assert.deepEqual(store.getItem(first.boardItemIds[0]!).reportConfirmation!.evidence[0]!.rangeUtf16,{start:0,end:5,total:20});
  assert.throws(() => store.confirmReportConclusions({ ...ordered, recommendations:[{ ...recommendation, conclusionClaimIds:['Z'] }] }), {code:'confirmation_operation_conflict'});
});
