import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
    store.saveFeedback(task.id, { adopted: true, outcome: '已执行', metricDelta: '+3%', review: '有效', score: 4 });
    store.saveFeedback(task.id, { adopted: false, outcome: '部分执行', metricDelta: '0', review: '效果未达预期', score: 2 });
    assert.equal(store.listFeedback().length, 1);
    assert.equal(store.listFeedback()[0]!.score, 2);
    assert.equal(store.listTasks()[0]!.owner, '负责人甲');
    assert.throws(() => store.saveFeedback(task.id, { adopted: true, outcome: 'x', metricDelta: 'x', review: 'x', score: 6 }), { code: 'invalid_feedback' });
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
