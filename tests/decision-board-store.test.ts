import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, symlink, link, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createDecisionBoardStore } from '../extensions/business-plugins/decision-board/storage/store.ts';
import { EVIDENCE_CONFIDENCE, type NormalizedItem } from '../extensions/business-plugins/decision-board/types.ts';

const project = randomUUID();
const configuration = { id: 'cfg-1', name: '合成模型', provider: 'synthetic', model: 'synthetic-model', revision: 1 };

function item(title: string, level: NormalizedItem['evidence']['level'] = '数据支撑'): NormalizedItem {
  return { title, rationale: `${title}的依据`, expectedImpact: '改善经营指标', priority: 'high', effort: '1人日', evidence: { facts: [{ text: `${title}事实`, quote: `${title}原文` }], level, reasoning: '直接来自报告数据。' } };
}

async function withStore(use: (store: Awaited<ReturnType<typeof createDecisionBoardStore>>) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-decision-board-'));
  const store = createDecisionBoardStore({ root });
  try { await store.init(); await use(store); } finally { store.close(); await rm(root, { recursive: true, force: true }); }
}

test('report registration updates observation on change but keeps identity', async () => {
  await withStore(async store => {
    const first = store.registerReport({ projectId: project, relativePath: '060_reports/r.md', sha256: 'a'.repeat(64), bytes: 10 });
    const same = store.registerReport({ projectId: project, relativePath: '060_reports/r.md', sha256: 'a'.repeat(64), bytes: 10 });
    assert.equal(same.id, first.id);
    assert.equal(same.firstSeenAt, first.firstSeenAt);
    assert.equal(same.observedSha256, 'a'.repeat(64));
    const changed = store.registerReport({ projectId: project, relativePath: '060_reports/r.md', sha256: 'b'.repeat(64), bytes: 12 });
    assert.equal(changed.id, first.id);
    assert.equal(changed.observedSha256, 'b'.repeat(64));
    assert.equal(changed.observedBytes, 12);
    assert.equal(store.listReports().length, 1);
  });
});

test('only one running extraction per report; other reports unaffected', async () => {
  await withStore(async store => {
    const report = store.registerReport({ projectId: project, relativePath: '060_reports/r.md', sha256: 'a'.repeat(64), bytes: 10 });
    const other = store.registerReport({ projectId: project, relativePath: '060_reports/r2.md', sha256: 'b'.repeat(64), bytes: 10 });
    const runningId = randomUUID();
    store.createExtraction({ id: runningId, reportId: report.id, configuration, sourceSha256: 'a'.repeat(64), sourceBytes: 10, sourceChars: 10, truncated: false, reportExcerpt: '报告' });
    assert.throws(() => store.createExtraction({ id: randomUUID(), reportId: report.id, configuration, sourceSha256: 'a'.repeat(64), sourceBytes: 10, sourceChars: 10, truncated: false, reportExcerpt: '报告' }), { code: 'extraction_busy' });
    store.createExtraction({ id: randomUUID(), reportId: other.id, configuration, sourceSha256: 'b'.repeat(64), sourceBytes: 10, sourceChars: 10, truncated: false, reportExcerpt: '报告2' });
    // Terminal extractions never block a new round.
    store.finishExtraction(runningId, { kind: 'failed', error: 'synthetic failure' });
    store.createExtraction({ id: randomUUID(), reportId: report.id, configuration, sourceSha256: 'a'.repeat(64), sourceBytes: 10, sourceChars: 10, truncated: false, reportExcerpt: '报告' });
  });
});

test('completed extraction rebuilds only suggested extracted items', async () => {
  await withStore(async store => {
    const report = store.registerReport({ projectId: project, relativePath: '060_reports/r.md', sha256: 'a'.repeat(64), bytes: 10 });
    const firstId = randomUUID();
    store.createExtraction({ id: firstId, reportId: report.id, configuration, sourceSha256: 'a'.repeat(64), sourceBytes: 10, sourceChars: 10, truncated: false, reportExcerpt: '报告' });
    store.finishExtraction(firstId, { kind: 'completed', items: [item('A'), item('B'), item('C')] });
    const items = () => store.listItems();
    const byTitle = (title: string) => items().find(entry => entry.title === title)!;
    store.decideItem(byTitle('B').id, { status: 'adopted' });
    store.decideItem(byTitle('C').id, { status: 'dismissed', reason: '范围外' });
    const manual = store.addManualItem({ projectId: project, title: 'M', rationale: '经验建议' });
    assert.equal(manual.sourceKind, 'manual');
    assert.equal(manual.evidenceLevel, '经验假设');
    assert.equal(manual.confidence, EVIDENCE_CONFIDENCE['经验假设']);
    const secondId = randomUUID();
    store.createExtraction({ id: secondId, reportId: report.id, configuration, sourceSha256: 'a'.repeat(64), sourceBytes: 10, sourceChars: 10, truncated: false, reportExcerpt: '报告' });
    store.finishExtraction(secondId, { kind: 'completed', items: [item('D'), item('E')] });
    const titles = items().map(entry => entry.title).sort();
    assert.deepEqual(titles, ['B', 'C', 'D', 'E', 'M']);
    assert.equal(byTitle('D').status, 'suggested');
    assert.equal(byTitle('D').confidence, EVIDENCE_CONFIDENCE['数据支撑']);
    assert.equal(store.getReport(report.id)!.lastExtractionAt !== null, true);
    const extraction = store.readExtraction(secondId)!;
    assert.equal(extraction.status, 'completed');
    assert.equal(extraction.itemCount, 2);
  });
});

test('decision state machine keeps dismiss reasons and blocks direct re-adoption', async () => {
  await withStore(async store => {
    const report = store.registerReport({ projectId: project, relativePath: '060_reports/r.md', sha256: 'a'.repeat(64), bytes: 10 });
    const extractionId = randomUUID();
    store.createExtraction({ id: extractionId, reportId: report.id, configuration, sourceSha256: 'a'.repeat(64), sourceBytes: 10, sourceChars: 10, truncated: false, reportExcerpt: '报告' });
    store.finishExtraction(extractionId, { kind: 'completed', items: [item('A')] });
    const itemA = store.listItems()[0]!;
    assert.throws(() => store.decideItem(itemA.id, { status: 'dismissed', reason: 'x' }), { code: 'invalid_dismiss_reason' });
    assert.throws(() => store.decideItem(itemA.id, { status: 'dismissed', reason: '' }), { code: 'invalid_dismiss_reason' });
    const adopted = store.decideItem(itemA.id, { status: 'adopted' });
    assert.equal(adopted.status, 'adopted');
    assert.equal(adopted.decidedAt !== null, true);
    assert.throws(() => store.decideItem(adopted.id, { status: 'adopted' }), { code: 'invalid_item_decision' });
    const dismissed = store.decideItem(adopted.id, { status: 'dismissed', reason: '优先级下调' });
    assert.equal(dismissed.status, 'dismissed');
    assert.equal(dismissed.dismissedReason, '优先级下调');
    // Adopted tasks survive the later dismissal.
    assert.throws(() => store.decideItem(dismissed.id, { status: 'adopted' }), { code: 'item_already_dismissed' });
  });
});

test('tasks require adoption; status and feedback round-trip', async () => {
  await withStore(async store => {
    const report = store.registerReport({ projectId: project, relativePath: '060_reports/r.md', sha256: 'a'.repeat(64), bytes: 10 });
    const extractionId = randomUUID();
    store.createExtraction({ id: extractionId, reportId: report.id, configuration, sourceSha256: 'a'.repeat(64), sourceBytes: 10, sourceChars: 10, truncated: false, reportExcerpt: '报告' });
    store.finishExtraction(extractionId, { kind: 'completed', items: [item('A')] });
    const itemA = store.listItems()[0]!;
    assert.throws(() => store.addTask(itemA.id, { title: 'T' }), { code: 'task_requires_adoption' });
    store.decideItem(itemA.id, { status: 'adopted' });
    const task = store.addTask(itemA.id, { title: 'T', owner: '负责人甲', dueDate: '2026-11-30', priority: 'high', note: '备注' });
    assert.equal(task.status, 'todo');
    assert.equal(store.setTaskStatus(task.id, 'doing').status, 'doing');
    assert.equal(store.setTaskStatus(task.id, 'done').status, 'done');
    const originalFeedback = store.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: true, outcome: '已执行', metricDelta: '+3%', review: '有效', score: 4 });
    store.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: originalFeedback.revisionId, adopted: false, outcome: '部分执行', metricDelta: '0', review: '效果未达预期', score: 2 });
    assert.equal(store.listFeedback().length, 1);
    assert.equal(store.listFeedback()[0]!.score, 2);
    assert.equal(store.listTasks()[0]!.owner, '负责人甲');
    assert.throws(() => store.saveFeedback(task.id, { operationId: randomUUID(), expectedLatestRevisionId: originalFeedback.revisionId, adopted: true, outcome: 'x', metricDelta: 'x', review: 'x', score: 6 }), { code: 'invalid_feedback' });
  });
});

test('reopening the store marks running extractions interrupted without touching items', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-decision-board-reopen-'));
  try {
    const first = createDecisionBoardStore({ root });
    await first.init();
    const report = first.registerReport({ projectId: project, relativePath: '060_reports/r.md', sha256: 'a'.repeat(64), bytes: 10 });
    const extractionId = randomUUID();
    first.createExtraction({ id: extractionId, reportId: report.id, configuration, sourceSha256: 'a'.repeat(64), sourceBytes: 10, sourceChars: 10, truncated: false, reportExcerpt: '报告' });
    first.finishExtraction(extractionId, { kind: 'completed', items: [item('A')] });
    const nextId = randomUUID();
    first.createExtraction({ id: nextId, reportId: report.id, configuration, sourceSha256: 'a'.repeat(64), sourceBytes: 10, sourceChars: 10, truncated: false, reportExcerpt: '报告' });
    first.close();
    const second = createDecisionBoardStore({ root });
    await second.init();
    assert.equal(second.readExtraction(nextId)!.status, 'interrupted');
    assert.equal(second.readExtraction(extractionId)!.status, 'completed');
    assert.equal(second.listItems().length, 1);
    second.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed extraction records the error and preserves previous items', async () => {
  await withStore(async store => {
    const report = store.registerReport({ projectId: project, relativePath: '060_reports/r.md', sha256: 'a'.repeat(64), bytes: 10 });
    const extractionId = randomUUID();
    store.createExtraction({ id: extractionId, reportId: report.id, configuration, sourceSha256: 'a'.repeat(64), sourceBytes: 10, sourceChars: 10, truncated: false, reportExcerpt: '报告' });
    store.finishExtraction(extractionId, { kind: 'failed', error: 'extraction_invalid_output' });
    assert.equal(store.readExtraction(extractionId)!.error, 'extraction_invalid_output');
    assert.equal(store.listItems().length, 0);
  });
});

// Frozen schema1 fixture: production code must preserve these five table definitions.
const LEGACY_BOARD_SCHEMA = `
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
`;
const legacyTables = ['reports', 'extractions', 'board_items', 'board_tasks', 'task_feedback'];
function legacySnapshot(db: DatabaseSync) {
  return legacyTables.map(name => ({ name, sql: db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name), rows: db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all() }));
}
function seedLegacy(root: string) {
  const file = path.join(root, 'decision-board.sqlite3');
  const db = new DatabaseSync(file); db.exec(LEGACY_BOARD_SCHEMA);
  const extractionId = randomUUID(), itemId = randomUUID(), taskId = randomUUID();
  const created = '2026-10-01T00:00:00.000Z', updated = '2026-10-15T00:00:00.000Z';
  db.prepare('INSERT INTO reports (id,project_id,relative_path,observed_sha256,observed_bytes,observed_at,last_extraction_at,first_seen_at,updated_at) VALUES (1,?,?,?,?,?,?,?,?)').run(project, '060_reports/old.md', 'a'.repeat(64), 9, created, created, created, created);
  db.prepare('INSERT INTO extractions (id,report_id,configuration_json,status,source_sha256,source_bytes,source_chars,truncated,item_count,report_excerpt,created_at,updated_at) VALUES (?,1,?,?,?,?,?,?,?,?,?,?)').run(extractionId, JSON.stringify(configuration), 'completed', 'a'.repeat(64), 9, 3, 0, 1, '旧报告', created, created);
  db.prepare('INSERT INTO board_items (id,project_id,report_id,extraction_id,source_kind,title,rationale,priority,status,created_at,updated_at) VALUES (?,?,1,?,?,?,?,?,?,?,?)').run(itemId, project, extractionId, 'extracted', '旧建议', '旧依据', 'medium', 'adopted', created, created);
  db.prepare('INSERT INTO board_tasks (id,item_id,title,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(taskId, itemId, '旧行动', 'doing', 'medium', created, created);
  db.prepare('INSERT INTO task_feedback (task_id,adopted,outcome,metric_delta,review,score,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(taskId, 0, '  原正文\n', '', '未知并非无效', 2, created, updated);
  return { file, db, taskId, before: legacySnapshot(db), created, updated };
}

test('FC02/FC03: null score, immutable revisions, canonical intent retries and latest CAS', async () => {
  await withStore(async store => {
    const suggestion = store.addManualItem({ projectId: project, title: '反馈修订', rationale: '测试未知与负面' });
    store.decideItem(suggestion.id, { status: 'adopted' });
    const task = store.addTask(suggestion.id, { title: '尚未完成也能反馈' });
    const input = { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: false, outcome: '', metricDelta: '', review: '尚未执行，效果未知', score: null };
    const first = store.saveFeedback(task.id, input);
    assert.equal(first.score, null); assert.equal(first.effect, 'unknown');
    assert.equal(first.revisionNumber, 1); assert.equal(first.origin, 'user-save');
    const second = store.saveFeedback(task.id, { ...input, operationId: randomUUID(), expectedLatestRevisionId: first.revisionId, adopted: true, review: '用户认为变差，未经核验', effect: 'negative', score: 1 });
    assert.equal(second.revisionNumber, 2);
    assert.deepEqual(store.saveFeedback(task.id, { ...input, effect: 'unknown' }), first, 'same normalized intent returns the original even after a newer revision');
    assert.throws(() => store.saveFeedback(task.id, { ...input, review: 'changed same intent' }), { code: 'feedback_operation_conflict' });
    assert.throws(() => store.saveFeedback(task.id, { ...input, operationId: randomUUID() }), { code: 'feedback_revision_conflict' });
    assert.deepEqual(store.listFeedbackHistory(task.id), [first, second]);
    assert.deepEqual(store.getFeedbackRevision(first.revisionId), first);
    assert.deepEqual(store.getFeedbackOperation(input.operationId), first);
    assert.equal(store.getFeedbackOperation(randomUUID()), null);
    assert.deepEqual(store.listFeedback(), [second]);
    assert.equal(store.listTasks()[0]!.status, 'todo', 'feedback does not mark action done');
  });
});

test('FC04/FC18: schema1 upgrade preserves original DDL/rows and one honest known baseline across reopen', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-board-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = seedLegacy(root); fixture.db.close();
  const store = createDecisionBoardStore({ root }); t.after(() => store.close());
  await store.init();
  const [baseline] = store.listFeedbackHistory(fixture.taskId);
  assert.ok(baseline); assert.equal(baseline.origin, 'legacy-current');
  assert.equal(baseline.operationId, null); assert.equal(baseline.requestSha256, null);
  assert.equal(baseline.revisionNumber, 1); assert.equal(baseline.effect, 'unknown');
  assert.equal(baseline.legacyCreatedAt, fixture.created); assert.equal(baseline.legacyUpdatedAt, fixture.updated);
  assert.equal(baseline.outcome, '  原正文\n'); assert.equal(baseline.score, 2);
  const next = store.saveFeedback(fixture.taskId, { operationId: randomUUID(), expectedLatestRevisionId: baseline.revisionId, adopted: true, outcome: '新增回录', metricDelta: '', review: '', score: null });
  store.close(); await store.init();
  assert.deepEqual(store.listFeedbackHistory(fixture.taskId), [baseline, next]);
  const db = new DatabaseSync(fixture.file, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 3);
    const expected = fixture.before.map(table => table.name !== 'board_items' ? table : {
      ...table,
      sql: Object.assign(Object.create(null), { sql: String(table.sql!.sql)
        .replace('CREATE TABLE board_items (', 'CREATE TABLE "board_items" (')
        .replace("source_kind IN ('extracted','manual')", "source_kind IN ('extracted','manual','report-confirmation')")
        .replace(' evidence_json TEXT,', ' evidence_json TEXT,\n report_confirmation_json TEXT,')
        .replace(" CHECK((status='dismissed'", " CHECK((source_kind='report-confirmation' AND report_confirmation_json IS NOT NULL AND confidence IS NULL AND evidence_level IS NULL AND evidence_json IS NULL) OR (source_kind!='report-confirmation' AND report_confirmation_json IS NULL)),\n CHECK((status='dismissed'") }),
      rows: table.rows.map(row => Object.assign(Object.create(null), row, { report_confirmation_json: null })),
    });
    assert.deepEqual(legacySnapshot(db), expected, 'all old values and DDL remain exact except the explicit schema3 board source/metadata addition');
  } finally { db.close(); }
});

test('FC18: unknown schema objects fail before migration and close the failed connection', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-board-invalid-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = seedLegacy(root);
  fixture.db.exec('CREATE TRIGGER unexpected_feedback_write AFTER INSERT ON task_feedback BEGIN UPDATE reports SET observed_bytes=0; END;');
  fixture.db.close(); const original = await readFile(fixture.file);
  const store = createDecisionBoardStore({ root }); t.after(() => store.close());
  await assert.rejects(async () => store.init(), { code: 'unsupported_board_schema' });
  assert.deepEqual(await readFile(fixture.file), original);
  const repair = new DatabaseSync(fixture.file); repair.exec('DROP TRIGGER unexpected_feedback_write'); repair.close();
  await store.init();
  assert.equal(store.listFeedbackHistory(fixture.taskId).length, 1);
});


test('FC18: a failed migration rolls back new objects/version and preserves all legacy rows', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-board-rollback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = seedLegacy(root);
  // Schema1 SQLite allowed this value, although its application never generated it.
  fixture.db.prepare('UPDATE task_feedback SET score=2.5 WHERE task_id=?').run(fixture.taskId);
  const before = legacySnapshot(fixture.db); fixture.db.close();
  const store = createDecisionBoardStore({ root }); t.after(() => store.close());
  await assert.rejects(async () => store.init(), { code: 'board_migration_failed' });
  const db = new DatabaseSync(fixture.file);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 1);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='feedback_revisions'").get(), undefined);
    assert.deepEqual(legacySnapshot(db), before);
    db.prepare('UPDATE task_feedback SET score=2 WHERE task_id=?').run(fixture.taskId);
  } finally { db.close(); }
  await store.init();
  assert.equal(store.listFeedbackHistory(fixture.taskId).length, 1);
});


test('FC02/FC16: UTF-16 limits, task ownership and intent uniqueness never create partial feedback', async () => {
  await withStore(async store => {
    const suggestion = store.addManualItem({ projectId: project, title: '反馈边界', rationale: '原任务与他项隔离' });
    store.decideItem(suggestion.id, { status: 'adopted' });
    const firstTask = store.addTask(suggestion.id, { title: '第一项' }), secondTask = store.addTask(suggestion.id, { title: '第二项' });
    const input = { operationId: randomUUID(), expectedLatestRevisionId: null, adopted: false, outcome: '', metricDelta: '', review: '', score: null };
    const first = store.saveFeedback(firstTask.id, input);
    assert.throws(() => store.saveFeedback(secondTask.id, input), { code: 'feedback_operation_conflict' });
    assert.equal(store.listFeedbackHistory(secondTask.id).length, 0);
    assert.throws(() => store.saveFeedback(secondTask.id, { ...input, operationId: randomUUID(), review: '😀'.repeat(2001) }), { code: 'invalid_feedback' });
    assert.equal(store.listFeedbackHistory(secondTask.id).length, 0);
    const second = store.saveFeedback(secondTask.id, { ...input, operationId: randomUUID(), review: '😀'.repeat(2000) });
    assert.equal(second.review.length, 4000);
    assert.deepEqual(store.getFeedbackRevision(first.revisionId), first);
    assert.equal(store.getFeedbackRevision(randomUUID()), null);
    assert.throws(() => store.listFeedbackHistory(randomUUID()), { code: 'task_not_found' });
  });
});

test('FC18: unknown schema versions and unsafe linked storage preserve their original data', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-board-open-safety-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = seedLegacy(root); fixture.db.exec('PRAGMA user_version=99'); fixture.db.close();
  const original = await readFile(fixture.file);
  const unsupported = createDecisionBoardStore({ root });
  await assert.rejects(async () => unsupported.init(), { code: 'unsupported_board_schema' });
  assert.deepEqual(await readFile(fixture.file), original);
  const symlinkRoot = path.join(root, 'linked-root'); await symlink(root, symlinkRoot);
  await assert.rejects(async () => createDecisionBoardStore({ root: symlinkRoot }).init(), { code: 'unsafe_board_storage' });
  const hardlinkRoot = path.join(root, 'hardlink-root'); await mkdir(hardlinkRoot);
  await link(fixture.file, path.join(hardlinkRoot, 'decision-board.sqlite3'));
  await assert.rejects(async () => createDecisionBoardStore({ root: hardlinkRoot }).init(), { code: 'unsafe_board_storage' });
  assert.deepEqual(await readFile(fixture.file), original);
});
