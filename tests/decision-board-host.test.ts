import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { readJson } from './fixtures/joint-context.ts';

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) { const value = await read(); if (done(value)) return value; if (Date.now() > deadline) assert.fail(`Board extraction did not settle: ${JSON.stringify(value)}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}

const REPORT_TEXT = '# 会员复购分析\n\n高价值会员复购率从42%降至31%（REPORT_QUOTE_MARKER）。渠道A贡献主要降幅。\n\n建议：针对高价值会员补发召回权益，并核对渠道A的活动投放记录。';
function reply(items: unknown[]): string { return '好的\n```json\n' + JSON.stringify(items) + '\n```\n完'; }
const ITEM_A = { title: '补发高价值会员召回权益', rationale: '高价值会员复购显著下滑。', expectedImpact: '挽回部分流失订单', priority: 'high', effort: '2人日', confidence: 0.01, evidence: { level: '数据支撑', reasoning: '复购率来自清洗数据结论。', facts: [{ text: '复购率下降', quote: 'REPORT_QUOTE_MARKER' }] } };
const ITEM_B = { title: '核对渠道A投放记录', rationale: '渠道A贡献主要降幅。', expectedImpact: '', priority: 'medium', effort: '', evidence: { level: '逻辑推断', reasoning: '由渠道结构推断。', facts: [{ text: '渠道A降幅最大' }] } };

test('DB01–DB09: extraction, decisions, tasks, feedback and re-extraction across projects', { timeout: 90_000 }, async t => {
  const provider = await startSyntheticProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  provider.setChunks([reply([ITEM_A, ITEM_B])]);
  await readJson(await host.request('/api/configuration', 'PUT', { name: '看板合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '合成经营项目' }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: '复购分析.md', text: REPORT_TEXT }), 201);

  const getBoard = async () => readJson(await host.request('/api/decision-board'));
  const first = await getBoard();
  assert.equal(first.reports.length, 1);
  assert.equal(first.reports[0].projectName, '合成经营项目');
  assert.equal(first.reports[0].relativePath, '060_reports/复购分析.md');
  assert.equal(first.stats.suggested, 0);

  await readJson(await host.request('/api/decision-board/reports/extract', 'POST', { projectId: project.id, path: '060_reports/复购分析.md' }), 202);
  await readJson(await host.request('/api/decision-board/reports/extract', 'POST', { projectId: project.id, path: '060_reports/复购分析.md' }), 409);
  const extracted = await until(getBoard, value => value.reports[0].extraction !== null && ['completed', 'failed', 'cancelled'].includes(value.reports[0].extraction.status));
  assert.equal(extracted.reports[0].extraction.status, 'completed', JSON.stringify(extracted.reports[0].extraction));
  assert.equal(extracted.stats.suggested, 2);
  const items = extracted.items as any[];
  const itemA = items.find(item => item.title === ITEM_A.title)!;
  assert.equal(itemA.confidence, 0.9, 'confidence derives from evidence level, never from the model');
  assert.equal(itemA.evidence.facts[0].quote, 'REPORT_QUOTE_MARKER');
  const itemB = items.find(item => item.title === ITEM_B.title)!;
  assert.equal(itemB.confidence, 0.55);
  const request = provider.requests[0]!.body;
  assert.match(JSON.stringify(request.messages), /REPORT_QUOTE_MARKER/);
  assert.ok(!request.tools?.length, 'extraction sessions must not receive tools');

  await readJson(await host.request(`/api/decision-board/items/${itemA.id}/adopt`, 'POST', {}), 200);
  const dismissFault = await host.request(`/api/decision-board/items/${itemB.id}/dismiss`, 'POST', { reason: 'x' });
  assert.equal(dismissFault.status, 400);
  await readJson(await host.request(`/api/decision-board/items/${itemB.id}/dismiss`, 'POST', { reason: '先看召回效果' }), 200);
  const manual = await readJson(await host.request('/api/decision-board/items', 'POST', { projectId: project.id, title: '人工补充渠道排查', rationale: '一线反馈渠道异常' }), 201);
  assert.equal(manual.item.sourceKind, 'manual');
  assert.equal(manual.item.evidenceLevel, '经验假设');

  const { task } = await readJson(await host.request(`/api/decision-board/items/${itemA.id}/tasks`, 'POST', { title: '配置召回权益', owner: '运营甲', dueDate: '2026-11-15' }), 201);
  await readJson(await host.request(`/api/decision-board/tasks/${task.id}/status`, 'POST', { status: 'doing' }), 200);
  await readJson(await host.request(`/api/decision-board/tasks/${task.id}/status`, 'POST', { status: 'done' }), 200);
  await readJson(await host.request(`/api/decision-board/tasks/${task.id}/feedback`, 'POST', { adopted: true, outcome: '已执行', metricDelta: '+2.4%', review: '召回有效', score: 4 }), 200);
  await readJson(await host.request(`/api/decision-board/tasks/${task.id}/feedback`, 'POST', { adopted: true, outcome: '已执行并复盘', metricDelta: '+2.4%', review: '召回有效，继续观察', score: 5 }), 200);
  const afterLoop = await getBoard();
  assert.equal(afterLoop.stats.adopted, 1);
  assert.equal(afterLoop.stats.dismissed, 1);
  assert.equal(afterLoop.stats.manual, 1);
  assert.equal(afterLoop.items.find((item: any) => item.id === itemA.id).tasks[0].feedback.score, 5);

  // A changed report is flagged and a re-extraction keeps decided items (DB02/DB06).
  await writeFile(path.join(project.rootPath, '060_reports/复购分析.md'), REPORT_TEXT + '\n\n补充：渠道B也出现下滑。');
  const changed = await getBoard();
  assert.equal(changed.reports[0].availability, 'changed');
  provider.setChunks([reply([{ ...ITEM_A, title: '新建议：渠道B专项排查' }])]);
  await readJson(await host.request('/api/decision-board/reports/extract', 'POST', { projectId: project.id, path: '060_reports/复购分析.md' }), 202);
  const reextracted = await until(getBoard, value => value.items.some((item: any) => item.title === '新建议：渠道B专项排查') && value.reports[0].extraction.status === 'completed');
  assert.ok(reextracted.items.some((item: any) => item.title === '新建议：渠道B专项排查'));
  assert.ok(reextracted.items.some((item: any) => item.id === itemA.id), 'adopted item survives re-extraction');
  assert.ok(reextracted.items.some((item: any) => item.id === manual.item.id), 'manual item survives re-extraction');

  // Archived projects stay visible but read-only.
  await readJson(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}), 200);
  const archivedBoard = await getBoard();
  assert.equal(archivedBoard.projects[0].archivedAt !== null, true);
  assert.equal(archivedBoard.reports.length, 1);
  const rejected = await host.request('/api/decision-board/items', 'POST', { projectId: project.id, title: '归档后补充', rationale: '不应写入' });
  assert.equal(rejected.status, 409);
});

test('DB03/DB11: invalid output, cancellation, non-UTF-8 reports and missing paths', { timeout: 90_000 }, async t => {
  const provider = await startSyntheticProvider(), host = await startTestHost();
  t.after(async () => { await host.close(); await provider.close(); });
  await readJson(await host.request('/api/configuration', 'PUT', { name: '看板合成模型2', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: 'synthetic-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '失败路径项目' }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'r.md', text: REPORT_TEXT }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'data.csv', content: Buffer.from('a,b\n1,2\n').toString('base64') }), 201);
  await writeFile(path.join(project.rootPath, '060_reports/binary.md'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));

  const getBoard = async () => readJson(await host.request('/api/decision-board'));
  const invalid = await host.request('/api/decision-board/reports/extract', 'POST', { projectId: project.id, path: '060_reports/binary.md' });
  assert.equal(invalid.status, 415);
  const outside = await host.request('/api/decision-board/reports/extract', 'POST', { projectId: project.id, path: '020_clean/data.csv' });
  assert.equal(outside.status, 400, 'extraction only accepts 060_reports paths');

  provider.setChunks(['抱歉，无法完成。']);
  await readJson(await host.request('/api/decision-board/reports/extract', 'POST', { projectId: project.id, path: '060_reports/r.md' }), 202);
  const failed = await until(getBoard, value => value.reports.find((report: any) => report.relativePath === '060_reports/r.md')?.extraction?.status === 'completed' || value.reports.find((report: any) => report.relativePath === '060_reports/r.md')?.extraction?.status === 'failed');
  const failedReport = failed.reports.find((report: any) => report.relativePath === '060_reports/r.md');
  assert.equal(failedReport.extraction.status, 'failed');
  assert.equal(failedReport.extraction.error, 'extraction_invalid_output');
  assert.equal(failed.items.length, 0, 'failed extraction must not fabricate items');

  provider.setMode('slow');
  await readJson(await host.request('/api/decision-board/reports/extract', 'POST', { projectId: project.id, path: '060_reports/r.md' }), 202);
  const running = await until(getBoard, value => value.reports.find((report: any) => report.relativePath === '060_reports/r.md')?.extraction?.status === 'running');
  assert.ok(running.stats.runningExtractions >= 1);
  const stopped = await readJson(await host.request(`/api/decision-board/extraction/${running.reports.find((report: any) => report.relativePath === '060_reports/r.md').extraction.id}/stop`, 'POST', {}));
  assert.equal(stopped.extraction.status, 'cancelled');
  assert.equal((await getBoard()).stats.runningExtractions, 0, 'a terminal extraction frees the report for a new round');
  // DB11: the board never writes report files.
  const { readFile } = await import('node:fs/promises');
  assert.equal(await readFile(path.join(project.rootPath, '060_reports/r.md'), 'utf8'), REPORT_TEXT);
});
