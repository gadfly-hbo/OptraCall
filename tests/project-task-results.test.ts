import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ProjectStore } from '../src/host/project-store.ts';
import type { ProjectPlanConfirmation } from '../src/host/project-plan-types.ts';
import type { ProjectTaskResultBinding } from '../src/host/project-task-results-types.ts';
import { createProjectTaskResultsReader } from '../src/host/project-task-results.ts';

const configuration = { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic', name: 'Synthetic', baseUrl: 'https://example.invalid' };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-project-results-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await projects.create({ name: '合成项目综合', configuration });
  const tasks = await Promise.all(['群体变化', '商品与服务证据', '项目综合'].map(name => projects.createTask(project.id, { name })));
  const taskPlans = tasks.map((task, i) => ({ key: `t${i + 1}`, name: task.name, selected: i !== 2, taskId: task.id, scope: task.name, capabilities: [] }));
  const confirmation: ProjectPlanConfirmation = {
    id: randomUUID(), projectId: project.id, planVersion: 1, confirmedAt: new Date().toISOString(), mode: 'start', authorizations: [],
    plan: { request: '核对多维证据并综合', premises: ['合成资料'], materials: [], coverage: [], tasks: taskPlans, taskMode: 'multi', summaryTaskKey: 't3', dependencies: [], caseContext: null },
    tasks: tasks.map((task, i) => ({ taskKey: `t${i + 1}`, taskId: task.id, createRequestId: randomUUID(), startRequestId: randomUUID(), createStatus: 'not-required', startStatus: 'accepted', observations: [] })),
  };
  const bindings: ProjectTaskResultBinding[] = [], context = { signal: new AbortController().signal, assertCurrent() {} };
  const save = async (taskId: string, filename: string, content: string) => {
    const binding = await projects.writeBoundReport(project.id, taskId, filename, content, { ...context, requestId: randomUUID(), sessionId: randomUUID(), toolCallId: `report/${randomUUID()}` });
    bindings.push(binding); return binding;
  };
  const reader = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation, listBoundReports: async (projectId, taskId) => bindings.filter(x => x.projectId === projectId && x.taskId === taskId) });
  return { root, projects, project, tasks, confirmation, bindings, context, save, reader };
}

test('project synthesis discovers only genuine saved bindings for its confirmed analysis Tasks', async t => {
  const { projects, project, tasks, save, reader, context } = await fixture(t);
  const saved = await save(tasks[0].id, '群体阶段稿.md', '群体变化已核，首购历史仍不足。');
  await projects.saveReport(project.id, '无绑定手工文件.md', '不能猜这是某Task的成果');
  const result = await reader('find', {}, context);
  assert.equal(result.details.action, 'find');
  if (result.details.action !== 'find') return;
  assert.equal(result.details.results.length, 1);
  assert.equal(result.details.results[0].sha256, saved.sha256);
  assert.equal(result.details.results[0].taskId, tasks[0].id);
  assert.equal(result.details.results[0].bindingState, 'saved-receipt-only');
  assert.equal(result.content[0].text.includes('群体变化已核'), false);
});

test('reading a discovered result delivers the exact bound bytes and preserves its original Task and request identity', async t => {
  const { tasks, reader, context, save } = await fixture(t), content = '商品缺货仍是候选解释，未直接推定因果。';
  const saved = await save(tasks[1].id, '商品阶段稿.md', content), found = await reader('find', {}, context);
  assert.equal(found.details.action, 'find'); if (found.details.action !== 'find') return;
  const value = await reader('read', { id: found.details.results[0].id }, context);
  assert.equal(value.details.action, 'read'); if (value.details.action !== 'read') return;
  assert.equal(JSON.parse(value.content[0].text).text, content);
  assert.equal(value.details.contentState, 'exact-bytes-verified');
  assert.equal(value.details.result.sha256, saved.sha256);
  assert.equal(value.details.result.requestId, saved.requestId);
  assert.equal(value.details.result.taskId, tasks[1].id);
  assert.equal(value.details.complete, true);
});

test('result reading is bounded and paginates UTF-16 text without splitting an astral character', async t => {
  const { tasks, reader, context, save } = await fixture(t), source = 'A😀B'.repeat(12000);
  await save(tasks[0].id, '较长成果.md', source);
  const found = await reader('find', {}, context); if (found.details.action !== 'find') assert.fail('expected discovery');
  const id = found.details.results[0].id, bounded = await reader('read', { id }, context);
  assert.ok(bounded.content[0].text.length <= 32768);
  if (bounded.details.action !== 'read') assert.fail('expected exact read');
  assert.equal(bounded.details.complete, false); assert.ok(bounded.details.nextOffset);
  const first = await reader('read', { id, offset: 0, limit: 2 }, context), second = await reader('read', { id, offset: 1, limit: 2 }, context);
  assert.equal(JSON.parse(first.content[0].text).text, 'A');
  assert.equal(JSON.parse(second.content[0].text).text, '😀');
  await assert.rejects(reader('read', { id, offset: 2, limit: 2 }, context), /invalid_project_result_range/);
});

test('discovery continuation keeps exact inventory identity and refuses a stale continuation after another saved result', async t => {
  const { tasks, reader, context, save } = await fixture(t);
  await save(tasks[0].id, '阶段稿1.md', '原阶段稿1'); await save(tasks[1].id, '阶段稿2.md', '原阶段稿2');
  const first = await reader('find', { limit: 1 }, context); if (first.details.action !== 'find') assert.fail('expected discovery');
  assert.equal(first.details.results.length, 1); assert.ok(first.details.cursor);
  const second = await reader('find', { limit: 1, cursor: first.details.cursor }, context); if (second.details.action !== 'find') assert.fail('expected discovery');
  assert.equal(second.details.results.length, 1); assert.notEqual(second.details.results[0].id, first.details.results[0].id); assert.equal(second.details.hasMore, false);
  await save(tasks[0].id, '阶段稿3.md', '新阶段稿3');
  await assert.rejects(reader('find', { limit: 1, cursor: first.details.cursor }, context), /project_result_cursor_stale/);
});

test('an existing planned Task cannot be replaced by another Task identity in a stale or malformed confirmation receipt', async t => {
  const { projects, project, tasks, confirmation } = await fixture(t), outside = await projects.createTask(project.id, { name: '未选入本轮的任务' });
  confirmation.tasks[0].taskId = outside.id;
  assert.throws(() => createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation, listBoundReports: async () => [] }), /project_result_scope_unavailable/);
});

test('a late source permission withdrawal removes its metadata even while another participating Task is being discovered', async t => {
  const { projects, project, tasks, confirmation, context, bindings, save } = await fixture(t);
  await save(tasks[0].id, '权限将撤回的成果.md', '不应交付正文或元信息'); await save(tasks[1].id, '仍获准的成果.md', '正常来源');
  let permitted = true;
  const reader = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation,
    assertAuthorized: async ({ sourceTaskId }) => { if (sourceTaskId === tasks[0].id && !permitted) throw new Error('revoked'); },
    listBoundReports: async (_projectId, sourceTaskId) => { if (sourceTaskId === tasks[1].id) permitted = false; return bindings.filter(x => x.taskId === sourceTaskId); },
  });
  const found = await reader('find', {}, context); if (found.details.action !== 'find') assert.fail('expected discovery');
  assert.deepEqual(found.details.results.map(x => x.taskId), [tasks[1].id]);
  assert.ok(found.details.limitations.some(x => x.taskId === tasks[0].id));
  assert.equal(found.content[0].text.includes('权限将撤回的成果'), false);
});

test('single-Task work can read only its own confirmed result and ignores later caller mutation of the confirmation', async t => {
  const { projects, project, tasks, confirmation, bindings, save, context, reader: multi } = await fixture(t);
  await save(tasks[0].id, '自身成果.md', '单任务自身依据'); await save(tasks[1].id, '其他成果.md', '不属于单任务');
  const all = await multi('find', {}, context); if (all.details.action !== 'find') assert.fail('expected discovery');
  const other = all.details.results.find(x => x.taskId === tasks[1].id)!;
  confirmation.plan.taskMode = 'single'; confirmation.plan.summaryTaskKey = 't1'; confirmation.plan.tasks.forEach((x, i) => x.selected = i === 0);
  const reader = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[0].id, confirmation, listBoundReports: async (_projectId, taskId) => bindings.filter(x => x.taskId === taskId) });
  confirmation.plan.taskMode = 'multi'; confirmation.plan.tasks[1].selected = true;
  const found = await reader('find', {}, context); if (found.details.action !== 'find') assert.fail('expected discovery');
  assert.deepEqual(found.details.results.map(x => x.taskId), [tasks[0].id]);
  await assert.rejects(reader('find', { taskId: tasks[1].id }, context), /project_result_scope_forbidden/);
  await assert.rejects(reader('read', { id: other.id }, context), /project_result_reference_unavailable/);
});

test('a changed or deleted original result never falls forward to another report or its newest bytes', async t => {
  const { projects, project, tasks, reader, context, save } = await fixture(t), original = await save(tasks[0].id, '原稿.md', '原稿固定字节');
  const first = await reader('find', {}, context); if (first.details.action !== 'find') assert.fail('expected discovery'); const id = first.details.results[0].id;
  await fs.writeFile(path.join(project.rootPath, original.relativePath), '后来改写的内容');
  await save(tasks[0].id, '新稿.md', '独立新稿');
  await assert.rejects(reader('read', { id }, context), /project_result_changed/);
  await fs.unlink(path.join(project.rootPath, original.relativePath));
  await assert.rejects(reader('read', { id }, context), /project_result_unavailable/);
  assert.equal((await projects.readFile(project.id, '060_reports/新稿.md')).bytes.toString(), '独立新稿');
});

test('native-source failure remains an explicit evidence gap and does not expose an unrelated project or path', async t => {
  const { projects, project, tasks, confirmation, context } = await fixture(t), other = await projects.create({ name: '未获准其他项目', configuration });
  const reader = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation, listBoundReports: async (_projectId, taskId) => {
    if (taskId === tasks[0].id) return [{ projectId: other.id, taskId, requestId: randomUUID(), sessionId: randomUUID(), toolCallId: 'foreign', relativePath: '060_reports/不应泄露.md', sha256: 'a'.repeat(64), bytes: 1 }];
    if (taskId === tasks[1].id) throw new Error('private raw diagnostic');
    return [];
  } });
  const found = await reader('find', {}, context); if (found.details.action !== 'find') assert.fail('expected discovery');
  assert.equal(found.details.results.length, 0); assert.equal(found.details.limitations.length, 2);
  assert.equal(found.content[0].text.includes(other.id), false); assert.equal(found.content[0].text.includes('不应泄露'), false); assert.equal(found.content[0].text.includes('private raw diagnostic'), false);
  await assert.rejects(reader('find', { projectId: other.id }, context), /invalid_project_result_arguments/);
  await assert.rejects(reader('read', { id: 'a'.repeat(64), path: '/tmp/secret' }, context), /invalid_project_result_arguments/);
});

test('cancelled or stale invocation authority is checked after source discovery awaits', async t => {
  const { projects, project, tasks, confirmation, bindings, save } = await fixture(t); await save(tasks[0].id, '已保存稿.md', '真实保存');
  const controller = new AbortController(), cancelled = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation, listBoundReports: async () => { controller.abort(); return bindings; } });
  await assert.rejects(cancelled('find', {}, { signal: controller.signal, assertCurrent() {} }), /abort/i);
  let current = true;
  const stale = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation, listBoundReports: async () => { current = false; return bindings; } });
  await assert.rejects(stale('find', {}, { signal: new AbortController().signal, assertCurrent() { if (!current) throw new Error('original_request_not_current'); } }), /original_request_not_current/);
});

test('a report with a text-incompatible body cannot be represented as readable evidence', async t => {
  const { tasks, reader, context, save } = await fixture(t); await save(tasks[0].id, '非正文.bin', 'a\0b');
  const found = await reader('find', {}, context); if (found.details.action !== 'find') assert.fail('expected discovery');
  await assert.rejects(reader('read', { id: found.details.results[0].id }, context), /project_result_requires_text/);
});

test('long metadata and escaped source text stay within delivery budgets and preserve discovery progress', async t => {
  const { projects, project, tasks, bindings, reader, context } = await fixture(t);
  for (let i = 0; i < 40; i++) bindings.push(await projects.writeBoundReport(project.id, tasks[0].id, `合成报告-${i}.md`, '\\"\n'.repeat(10000), { ...context, requestId: String(i).padStart(300, 'r'), sessionId: 's'.repeat(300), toolCallId: 't'.repeat(300) }));
  const ids = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await reader('find', { limit: 40, ...(cursor ? { cursor } : {}) }, context); if (page.details.action !== 'find') assert.fail('expected discovery');
    assert.ok(page.content[0].text.length <= 32768); assert.ok(page.details.results.length);
    page.details.results.forEach(x => ids.add(x.id)); cursor = page.details.cursor;
  } while (cursor);
  assert.equal(ids.size, 40);
  const value = await reader('read', { id: [...ids][0], limit: 16000 }, context); if (value.details.action !== 'read') assert.fail('expected read');
  assert.ok(value.content[0].text.length <= 32768); assert.ok(value.details.nextOffset); assert.ok(value.details.rangeUtf16.end < 16000);
});

test('bounded discovery waits for a later genuine saved binding and checks once at the deadline when saving did not change Task metadata', async t => {
  const { projects, project, tasks, confirmation, bindings, save, context } = await fixture(t), observedBudgets: unknown[] = []; let bodyReads = 0;
  const reader = createProjectTaskResultsReader({ projectId: project.id, taskId: tasks[2].id, confirmation,
    projects: { get: id => projects.get(id), getTask: (projectId, taskId) => projects.getTask(projectId, taskId), captureFeedbackFile: (...args) => { bodyReads++; return projects.captureFeedbackFile(...args); } },
    listBoundReports: async (_projectId, taskId, options) => { observedBudgets.push(options?.budget); return bindings.filter(value => value.taskId === taskId); },
  });
  const writeLater = new Promise<void>((resolve, reject) => setTimeout(() => { void save(tasks[0].id, '稍后保存的原成果.md', '仍待其他事实核对').then(() => resolve(), reject); }, 20));
  try {
    const found = await reader('find', { taskId: tasks[0].id, waitMs: 250 }, context);
    if (found.details.action !== 'find') assert.fail('expected discovery');
    assert.equal(found.details.results.length, 1); assert.equal(found.details.results[0].taskId, tasks[0].id);
    assert.equal(found.details.wait?.outcome, 'available'); assert.equal(found.details.wait?.requestedMs, 250);
    assert.equal(observedBudgets.length, 2); assert.ok(observedBudgets[0]); assert.equal(observedBudgets[0], observedBudgets[1]);
    assert.equal(bodyReads, 0); assert.equal(found.content[0].text.includes('仍待其他事实核对'), false);
  } finally { await writeLater; }
});

test('a wait duration must be an explicit bounded integer and invalid values never read native sources', async t => {
  const { projects, project, tasks, confirmation, context } = await fixture(t); let nativeReads = 0;
  const reader = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation, listBoundReports: async () => { nativeReads++; return []; } });
  for (const waitMs of [null, -1, 30_001, 0.5, '100', Number.NaN]) await assert.rejects(reader('find', { waitMs }, context), /invalid_project_result_wait/);
  assert.equal(nativeReads, 0);
});

test('a real source Task metadata change releases an empty wait promptly without rescanning native history on each metadata poll', async t => {
  const { projects, project, tasks, confirmation, bindings, save, context } = await fixture(t); let nativeReads = 0;
  const reader = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation, listBoundReports: async (_projectId, taskId) => { nativeReads++; return bindings.filter(value => value.taskId === taskId); } });
  const writeLater = new Promise<void>((resolve, reject) => setTimeout(() => { void (async () => {
    await save(tasks[0].id, '完成后可读的原成果.md', '仍须自主核对专业判断');
    await projects.markRun(project.id, tasks[0].id, { id: confirmation.tasks[0].startRequestId, status: 'completed', startedAt: new Date().toISOString(), settledAt: new Date().toISOString() });
  })().then(() => resolve(), reject); }, 20));
  try {
    const found = await reader('find', { taskId: tasks[0].id, waitMs: 5000 }, context); if (found.details.action !== 'find') assert.fail('expected discovery');
    assert.equal(found.details.results.length, 1); assert.equal(found.details.wait?.outcome, 'available'); assert.ok(found.details.wait!.elapsedMs < 2000);
    assert.equal(nativeReads, 2); assert.equal(found.details.results[0].taskState, 'completed');
    assert.ok(found.details.results[0].limitations.some(value => value.includes('不单独证明Task完成')));
  } finally { await writeLater; }
});

for (const stop of ['cancel', 'stale'] as const) test(`an original ${stop} stops an in-flight wait without waking work or performing another native read`, async t => {
  const { projects, project, tasks, confirmation } = await fixture(t), controller = new AbortController(); let current = true, nativeReads = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const before = await projects.get(project.id), context = { signal: controller.signal, assertCurrent() { if (!current) throw new Error('original_invocation_stopped'); } };
  const reader = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation, listBoundReports: async () => {
    nativeReads++; timer ??= setTimeout(() => { if (stop === 'cancel') controller.abort(); else current = false; }, 20); return [];
  } });
  const started = performance.now();
  try { await assert.rejects(reader('find', { taskId: tasks[0].id, waitMs: 30000 }, context), stop === 'cancel' ? /abort/i : /original_invocation_stopped/); }
  finally { clearTimeout(timer); }
  assert.ok(performance.now() - started < 2000); assert.equal(nativeReads, 1); assert.deepEqual(await projects.get(project.id), before);
});

test('an empty bounded wait reports only its limited observation and never treats Task completion as a delivered or professional result', async t => {
  const { projects, project, tasks, confirmation, context } = await fixture(t); let nativeReads = 0;
  await projects.markRun(project.id, tasks[0].id, { id: confirmation.tasks[0].startRequestId, status: 'completed', startedAt: new Date().toISOString(), settledAt: new Date().toISOString() });
  const before = await projects.get(project.id), reader = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation, listBoundReports: async () => { nativeReads++; return []; } });
  const found = await reader('find', { taskId: tasks[0].id, waitMs: 120 }, context); if (found.details.action !== 'find') assert.fail('expected discovery');
  assert.deepEqual(found.details.results, []); assert.equal(found.details.wait?.outcome, 'timed-out'); assert.equal(nativeReads, 2);
  assert.ok(found.details.limitations.some(value => value.code === 'bounded_wait_no_result' && value.message?.includes('本次有限等候范围未取得')));
  assert.deepEqual(await projects.get(project.id), before);
});

test('an already saved report returns immediately despite a long requested wait and each tool call receives a fresh original native budget', async t => {
  const { projects, project, tasks, confirmation, bindings, save, context } = await fixture(t), budgets: unknown[] = [];
  await save(tasks[0].id, '已经保存的原成果.md', '准确旧成果');
  const reader = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation, listBoundReports: async (_projectId, taskId, options) => { assert.equal(options?.signal, context.signal); assert.equal(typeof options?.assertCurrent, 'function'); budgets.push(options?.budget); return bindings.filter(value => value.taskId === taskId); } });
  const first = await reader('find', { taskId: tasks[0].id, waitMs: 30000 }, context), next = await reader('find', { taskId: tasks[0].id, waitMs: 0 }, context);
  if (first.details.action !== 'find' || next.details.action !== 'find') assert.fail('expected discovery');
  assert.equal(first.details.wait?.outcome, 'not-needed'); assert.equal(first.details.wait?.elapsedMs, 0); assert.equal(next.details.wait, undefined);
  assert.equal(budgets.length, 2); assert.ok(budgets[0]); assert.notEqual(budgets[0], budgets[1]);
});

test('waiting cannot enlarge the confirmed Task scope and a withdrawn source permission remains an explicit gap', async t => {
  const { projects, project, tasks, confirmation, context } = await fixture(t); let allowed = true, nativeReads = 0;
  const reader = createProjectTaskResultsReader({ projects, projectId: project.id, taskId: tasks[2].id, confirmation, assertAuthorized: async () => { if (!allowed) throw new Error('original source permission withdrawn'); }, listBoundReports: async () => { nativeReads++; return []; } });
  await assert.rejects(reader('find', { taskId: randomUUID(), waitMs: 30000 }, context), /project_result_scope_forbidden/); assert.equal(nativeReads, 0);
  const timer = setTimeout(() => { allowed = false; }, 20);
  try {
    const found = await reader('find', { taskId: tasks[0].id, waitMs: 120 }, context); if (found.details.action !== 'find') assert.fail('expected discovery');
    assert.deepEqual(found.details.results, []); assert.equal(nativeReads, 1); assert.ok(found.details.limitations.some(value => value.code === 'project_result_permission_unavailable'));
  } finally { clearTimeout(timer); }
});

test('a manual handoff without a Plan exposes only the exact selected saved version to the receiving Task', async t => {
  const { projects, project, tasks, save, bindings, context } = await fixture(t);
  const source = tasks[0], receiver = tasks[2];
  await save(source.id, '初稿.md', '准确初稿');
  const base = { projects, projectId: project.id, listBoundReports: async (_: string, id: string) => bindings.filter(b => b.taskId === id) };
  const browse = createProjectTaskResultsReader({ ...base, taskId: source.id, handoff: { mode: 'own-results' } });
  const catalog = (await browse('find', {}, context)).details;
  if (catalog.action !== 'find') assert.fail();
  const key = catalog.results[0].id;
  const reader = createProjectTaskResultsReader({ ...base, taskId: receiver.id, handoff: { mode: 'selected', sources: [{ taskId: source.id, key }] } });
  await save(source.id, '另一次独立成果.md', '新稿不能自动提供');
  const selected = (await reader('find', {}, context)).details;
  if (selected.action !== 'find') assert.fail();
  assert.deepEqual(selected.results.map(r => r.id), [key]);
  assert.equal(selected.scope.confirmationId, undefined);
  assert.equal(JSON.parse((await reader('read', { id: key }, context)).content[0].text).text, '准确初稿');
  await assert.rejects(reader('find', { taskId: tasks[1].id }, context), /scope_forbidden/);
});
