import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { appendFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ProjectStore } from '../src/host/project-store.ts';
import * as sources from '../src/host/project-task-result-sources.ts';
import { createNativeSnapshotReadBudget } from '../src/host/native-session-snapshot.ts';
import { createProjectTaskResultsReader } from '../src/host/project-task-results.ts';
import { createPersonalSourceReader } from '../src/host/personal-retention-sources.ts';
import type { ProjectPlanConfirmation } from '../src/host/project-plan-types.ts';

const configuration = { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic', name: 'Synthetic', baseUrl: 'https://example.invalid' };
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
/** Explicit synthetic ledger material only. The sibling Host/Pi test proves actual SDK persistence. */
function nativeFixture(cwd: string, directory: string) {
  const sessionId = randomUUID(), file = path.join(directory, 'synthetic-native.jsonl'); let parentId: string | null = null;
  writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd }) + '\n');
  const append = (value: Record<string, unknown>) => {
    const id = randomUUID(); appendFileSync(file, JSON.stringify({ ...value, id, parentId, timestamp: new Date().toISOString() }) + '\n'); parentId = id; return id;
  };
  return { getSessionId: () => sessionId, getSessionFile: () => file, appendCustomEntry: (customType: string, data: unknown) => append({ type: 'custom', customType, data }), appendMessage: (message: Record<string, unknown>) => append({ type: 'message', message }) };
}
function answer(manager: ReturnType<typeof nativeFixture>, text: string) {
  return manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions', provider: 'synthetic', model: 'synthetic', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() });
}
function run(manager: ReturnType<typeof nativeFixture>, text: string, requestId: string = randomUUID(), outcome: 'completed' | 'failed' | 'cancelled' | null = 'completed') {
  const sessionId = manager.getSessionId();
  const started = manager.appendCustomEntry('optracall.run', { phase: 'started', requestId, sessionId });
  manager.appendMessage({ role: 'user', content: '仅合成资料', timestamp: Date.now() });
  const messageId = answer(manager, text);
  const settled = outcome === null ? undefined : manager.appendCustomEntry('optracall.run', { phase: 'settled', requestId, sessionId, outcome });
  return { requestId, sessionId, messageId, started, settled, text };
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-chat-results-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const initial = await projects.create({ name: '合成混合成果', configuration });
  const tasks = await Promise.all(['文件证据', '直接短答', '项目综合', '未参与任务'].map(name => projects.createTask(initial.id, { name })));
  const confirmation: ProjectPlanConfirmation = {
    id: randomUUID(), projectId: initial.id, planVersion: 1, confirmedAt: new Date().toISOString(), mode: 'start', authorizations: [],
    plan: { request: '综合准确混合成果', premises: [], materials: [], coverage: [], tasks: tasks.slice(0, 3).map((task, i) => ({ key: `t${i}`, taskId: task.id, name: task.name, scope: task.name, selected: true, capabilities: [] })), taskMode: 'multi', summaryTaskKey: 't2', dependencies: [], caseContext: null },
    tasks: tasks.slice(0, 3).map((task, i) => ({ taskKey: `t${i}`, taskId: task.id, createRequestId: randomUUID(), startRequestId: randomUUID(), createStatus: 'not-required', startStatus: 'accepted', observations: [] })),
  };
  const manager = nativeFixture(path.join(initial.rootPath, '020_clean'), tasks[1].sessionDirectory);
  const old = run(manager, '旧轮短答仍须按原请求理解。');
  const current = run(manager, '本轮短答😀只支持关联，根因仍未知。', confirmation.tasks[1].startRequestId);
  const native = manager.getSessionFile(); assert.ok(native); await projects.setSession(initial.id, tasks[1].id, native);
  const project = await projects.get(initial.id), task = await projects.getTask(initial.id, tasks[1].id);
  const context = { signal: new AbortController().signal, assertCurrent() {} };
  const readSource = createPersonalSourceReader({ projects, enterprise: {} as never, dataContext: {} as never, board: {} as never });
  const options = {
    projects, projectId: project.id, taskId: tasks[2].id, confirmation,
    listBoundReports: async (projectId: string, taskId: string, read?: Parameters<typeof sources.listTaskBoundReports>[2]) => sources.listTaskBoundReports(await projects.get(projectId), await projects.getTask(projectId, taskId), read),
    listResultSources: async (projectId: string, taskId: string, read?: Parameters<typeof sources.listTaskBoundReports>[2]) => sources.listTaskResultSources(await projects.get(projectId), await projects.getTask(projectId, taskId), read),
    readNativeReply: readSource,
  };
  return { root, projects, project, task, tasks, confirmation, context, manager, native, old, current, options, reader: createProjectTaskResultsReader(options) };
}

test('PG04 native discovery binds only final same-session completed replies and spends one native snapshot budget', async t => {
  const f = await fixture(t), before = await fs.readFile(f.native), budget = createNativeSnapshotReadBudget();
  const found = await sources.listTaskResultSources(f.project, f.task, { budget });
  assert.equal(budget.files, 19); assert.equal(budget.bytes, 50 * 1024 * 1024 - before.length);
  assert.equal(found.reports.length, 0); assert.equal(found.replies.length, 2);
  assert.deepEqual(found.replies.map(reply => reply.requestId), [f.old.requestId, f.current.requestId]);
  assert.equal(found.replies[1].messageId, f.current.messageId); assert.equal(found.replies[1].sha256, sha(f.current.text));
  assert.equal('text' in found.replies[1], false); assert.deepEqual(await fs.readFile(f.native), before);
});

test('PG04 report-backed requests retain reports while a separate no-file request remains discoverable', async t => {
  const f = await fixture(t);
  const report = await f.projects.writeBoundReport(f.project.id, f.task.id, '同请求报告.md', '报告依据', { ...f.context, requestId: f.old.requestId, sessionId: f.old.sessionId, toolCallId: 'saved-report' });
  f.manager.appendCustomEntry('optracall.project-report-write', { schemaVersion: 1, type: 'optracall.project-report-write', ...report });
  const result = await sources.listTaskResultSources(f.project, f.task);
  assert.equal(result.reports.length, 1); assert.deepEqual(result.replies.map(reply => reply.requestId), [f.current.requestId]);
  assert.deepEqual(await sources.listTaskBoundReports(f.project, f.task), result.reports);
});

test('PG04 failed, cancelled, unsettled, legacy and inherited runs do not acquire completed-result authority', async t => {
  const f = await fixture(t);
  for (const outcome of ['failed', 'cancelled', null] as const) run(f.manager, `不能当完成成果：${outcome}`, randomUUID(), outcome);
  const foreign = randomUUID(), requestId = randomUUID();
  f.manager.appendCustomEntry('optracall.run', { phase: 'started', requestId, sessionId: foreign }); answer(f.manager, '父会话继承内容');
  f.manager.appendCustomEntry('optracall.run', { phase: 'settled', requestId, sessionId: foreign, outcome: 'completed' });
  f.manager.appendCustomEntry('optracall.run', { phase: 'started', requestId: 'legacy' }); answer(f.manager, '未知旧归属');
  f.manager.appendCustomEntry('optracall.run', { phase: 'settled', requestId: 'legacy', outcome: 'completed' });
  const results = await sources.listTaskResultSources(f.project, f.task);
  assert.deepEqual(results.replies.map(reply => reply.requestId), [f.old.requestId, f.current.requestId]);
});

test('PG04 a completed marker on a different branch cannot adopt another branch reply', async t => {
  const f = await fixture(t), rows = (await fs.readFile(f.native, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line));
  rows.find(row => row.id === f.current.settled).parentId = f.current.started;
  await fs.writeFile(f.native, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const found = await sources.listTaskResultSources(f.project, f.task);
  assert.deepEqual(found.replies.map(reply => reply.requestId), [f.old.requestId]);
});

test('PG04 a completed run without an actual final assistant reply cannot promote an earlier answer', async t => {
  const f = await fixture(t), requestId = randomUUID(), sessionId = f.manager.getSessionId();
  f.manager.appendCustomEntry('optracall.run', { phase: 'started', requestId, sessionId });
  answer(f.manager, '中间答复，不是末尾的实际回答');
  f.manager.appendMessage({ role: 'user', content: '后来继续提问，但尚无回答', timestamp: Date.now() });
  f.manager.appendCustomEntry('optracall.run', { phase: 'settled', requestId, sessionId, outcome: 'completed' });
  const found = await sources.listTaskResultSources(f.project, f.task);
  assert.deepEqual(found.replies.map(reply => reply.requestId), [f.old.requestId, f.current.requestId]);
});

test('PG04 confirmed scope discovers exact source refs without bodies and reads through the original native-reply reader', async t => {
  const f = await fixture(t), found = await f.reader('find', {}, f.context);
  if (found.details.action !== 'find') assert.fail('find expected');
  assert.equal(found.details.results.length, 2); assert.equal(found.content[0].text.includes(f.current.text), false);
  const current = found.details.results.find(result => result.requestId === f.current.requestId)!;
  const old = found.details.results.find(result => result.requestId === f.old.requestId)!;
  assert.equal(current.kind, 'native-reply'); assert.equal(current.requestRelation, 'confirmed-request'); assert.equal(old.requestRelation, 'other-saved-request');
  const read = await f.reader('read', { id: current.id }, f.context);
  assert.equal(JSON.parse(read.content[0].text).text, f.current.text); assert.equal(read.details.action === 'read' && read.details.contentState, 'exact-native-reply-verified');
  await assert.rejects(f.reader('find', { taskId: f.tasks[3].id }, f.context), /project_result_scope_forbidden/);
  await assert.rejects(f.reader('read', { id: current.id, source: current }, f.context), /invalid_project_result_arguments/);
});

test('PG04 changed reply text invalidates the discovered id and never falls forward to new text', async t => {
  const f = await fixture(t), found = await f.reader('find', {}, f.context);
  if (found.details.action !== 'find') assert.fail('find expected');
  const original = found.details.results.find(result => result.requestId === f.current.requestId)!;
  const rows = (await fs.readFile(f.native, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line));
  rows.find(row => row.id === f.current.messageId).message.content[0].text = '改写的正文不得冒充已发现的旧字节';
  await fs.writeFile(f.native, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  await assert.rejects(f.reader('read', { id: original.id }, f.context), /project_result_reference_unavailable|project_result_changed/);
});

test('PG04 late permission withdrawal and native read failure expose no body or successful read claim', async t => {
  const f = await fixture(t); let allowed = true;
  const reader = createProjectTaskResultsReader({ ...f.options, assertAuthorized: async () => { if (!allowed) throw new Error('revoked'); }, readNativeReply: async (...args) => { const result = await f.options.readNativeReply(...args); allowed = false; return result; } });
  const found = await reader('find', {}, f.context); if (found.details.action !== 'find') assert.fail('find expected');
  await assert.rejects(reader('read', { id: found.details.results[0].id }, f.context), /project_result_permission_unavailable/);
  const broken = createProjectTaskResultsReader({ ...f.options, readNativeReply: async () => { throw new Error('private-path-secret'); } });
  await assert.rejects(broken('read', { id: found.details.results[0].id }, f.context), error => error instanceof Error && error.message === 'project_result_unavailable');
});

test('PG04 native reading rechecks original cancellation, duplicate-native ambiguity, and existing source budgets', async t => {
  const f = await fixture(t), found = await f.reader('find', {}, f.context); if (found.details.action !== 'find') assert.fail('find expected');
  const controller = new AbortController();
  const reader = createProjectTaskResultsReader({ ...f.options, readNativeReply: async (...args) => { const result = await f.options.readNativeReply(...args); controller.abort(); return result; } });
  await assert.rejects(reader('read', { id: found.details.results[0].id }, { ...f.context, signal: controller.signal }), /abort/i);
  await fs.copyFile(f.native, path.join(f.task.sessionDirectory, 'duplicate-native.jsonl'));
  const ambiguous = await sources.listTaskResultSources(f.project, f.task);
  assert.equal(ambiguous.replies.length, 0); assert.ok(ambiguous.limitations?.includes('project_result_native_reply_conflict'));
  await assert.rejects(f.reader('read', { id: found.details.results[0].id }, f.context), /project_result_reference_unavailable/);
});

test('PG04 the legacy report-only reader keeps duplicate matching report proof readable despite unrelated ambiguous chat history', async t => {
  const f = await fixture(t);
  const report = await f.projects.writeBoundReport(f.project.id, f.task.id, '报告兼容.md', '报告原字节仍可核', { ...f.context, requestId: f.old.requestId, sessionId: f.old.sessionId, toolCallId: 'legacy-report' });
  f.manager.appendCustomEntry('optracall.project-report-write', { schemaVersion: 1, type: 'optracall.project-report-write', ...report });
  await fs.copyFile(f.native, path.join(f.task.sessionDirectory, 'duplicate-report-proof.jsonl'));
  const results = await sources.listTaskBoundReports(f.project, f.task);
  assert.equal(results.length, 1); assert.equal(results[0].sha256, report.sha256);
  const combined = await sources.listTaskResultSources(f.project, f.task);
  assert.equal(combined.reports[0].sha256, report.sha256); assert.equal(combined.replies.length, 0);
  assert.ok(combined.limitations?.includes('project_result_native_reply_conflict'));
});
