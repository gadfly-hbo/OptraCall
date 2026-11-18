import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { SessionManager } from '../src/agent/sdk.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { listTaskBoundReports } from '../src/host/project-task-result-sources.ts';

const configuration = { id: 'synthetic', revision: 1, provider: 'synthetic', model: 'synthetic', name: 'Synthetic', baseUrl: 'https://example.invalid' };
function persistSession(manager: ReturnType<typeof SessionManager.create>) {
  manager.appendMessage({ role: 'user', content: '合成资料核对', timestamp: Date.now() });
  manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: '合成历史，仅用于源码接缝测试。' }], api: 'openai-completions', provider: 'synthetic', model: 'synthetic', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() });
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-result-native-'));
  const projects = new ProjectStore({ dataRoot: path.join(root, 'private'), projectsRoot: path.join(root, 'projects') }); await projects.init();
  t.after(async () => { await projects.close(); await fs.rm(root, { recursive: true, force: true }); });
  const created = await projects.create({ name: '原成果来源', configuration }), sourceTask = await projects.createTask(created.id, { name: '实际分析任务' });
  const manager = SessionManager.create(path.join(created.rootPath, '020_clean'), sourceTask.sessionDirectory);
  persistSession(manager);
  const native = manager.getSessionFile(); assert.ok(native); await projects.setSession(created.id, sourceTask.id, native);
  const project = await projects.get(created.id), task = await projects.getTask(project.id, sourceTask.id);
  const context = { signal: new AbortController().signal, assertCurrent() {}, requestId: randomUUID(), sessionId: manager.getSessionId(), toolCallId: `report/${randomUUID()}` };
  const receipt = await projects.writeBoundReport(project.id, task.id, '原报告.md', '明确来源的原报告', context);
  const data = { schemaVersion: 1, type: 'optracall.project-report-write', ...receipt };
  return { root, projects, project, task, manager, native, data };
}

test('saved result discovery uses the exact Host report receipt in the original SDK native ledger without reading report bodies', async t => {
  const { project, task, manager, native, data } = await fixture(t);
  const entryId = manager.appendCustomEntry('optracall.project-report-write', data), bytes = await fs.readFile(native), before = await fs.stat(native);
  await fs.unlink(data.path);
  const results = await listTaskBoundReports(project, task);
  assert.equal(results.length, 1);
  assert.equal(results[0].nativeEntryId, entryId);
  assert.equal(results[0].taskId, task.id);
  assert.equal(results[0].sha256, data.sha256);
  assert.equal('path' in results[0], false);
  assert.deepEqual(await fs.readFile(native), bytes);
  assert.equal((await fs.stat(native)).mtimeMs, before.mtimeMs);
});

test('imported parent receipts do not become writes by another session, while genuine writes by both sessions retain separate versions', async t => {
  const { projects, project, task, manager, data } = await fixture(t);
  manager.appendCustomEntry('optracall.project-report-write', data);
  const another = SessionManager.create(path.join(project.rootPath, '020_clean'), task.sessionDirectory); persistSession(another);
  another.appendCustomEntry('optracall.project-report-write', data);
  const receipt = await projects.writeBoundReport(project.id, task.id, '新会话报告.md', '新会话实际保存', { signal: new AbortController().signal, assertCurrent() {}, requestId: randomUUID(), sessionId: another.getSessionId(), toolCallId: 'new-session-write' });
  another.appendCustomEntry('optracall.project-report-write', { schemaVersion: 1, type: 'optracall.project-report-write', ...receipt });
  const results = await listTaskBoundReports(project, task);
  assert.equal(results.length, 2);
  assert.deepEqual(new Set(results.map(x => x.sessionId)), new Set([manager.getSessionId(), another.getSessionId()]));
  assert.equal(results.filter(x => x.sha256 === data.sha256).length, 1);
});

test('unbound files, other custom records and receipts belonging to another Task do not acquire source authority', async t => {
  const { projects, project, task, manager, data } = await fixture(t);
  await projects.saveReport(project.id, '手工报告.md', '没有Task绑定');
  manager.appendCustomEntry('optracall.other-record', data);
  manager.appendCustomEntry('optracall.project-report-write', { ...data, taskId: randomUUID() });
  manager.appendCustomEntry('optracall.project-report-write', { ...data, sessionId: randomUUID() });
  assert.deepEqual(await listTaskBoundReports(project, task), []);
});

test('duplicate matching proof reuses one saved binding and conflicting proof for the same call remains unknown', async t => {
  const { project, task, manager, data } = await fixture(t);
  manager.appendCustomEntry('optracall.project-report-write', data); manager.appendCustomEntry('optracall.project-report-write', data);
  assert.equal((await listTaskBoundReports(project, task)).length, 1);
  manager.appendCustomEntry('optracall.project-report-write', { ...data, sha256: 'f'.repeat(64) });
  await assert.rejects(listTaskBoundReports(project, task), /project_result_native_binding_conflict/);
});

test('a forged path cannot turn another file into a bound report and does not repair its native record', async t => {
  const { root, project, task, manager, native, data } = await fixture(t);
  manager.appendCustomEntry('optracall.project-report-write', { ...data, path: path.join(root, 'different-owner', '报告.md') });
  const before = await fs.readFile(native);
  await assert.rejects(listTaskBoundReports(project, task), /project_result_native_binding_invalid/);
  assert.deepEqual(await fs.readFile(native), before);
});

test('a future or old native format is not opened for migration or silently treated as an empty result list', async t => {
  const { project, task, manager, native, data } = await fixture(t);
  manager.appendCustomEntry('optracall.project-report-write', data);
  const rows = (await fs.readFile(native, 'utf8')).trimEnd().split('\n'), header = JSON.parse(rows[0]); header.version = 2; rows[0] = JSON.stringify(header);
  const before = rows.join('\n') + '\n'; await fs.writeFile(native, before); const stat = await fs.stat(native);
  await assert.rejects(listTaskBoundReports(project, task), /project_result_native_unavailable/);
  assert.equal(await fs.readFile(native, 'utf8'), before); assert.equal((await fs.stat(native)).mtimeMs, stat.mtimeMs);
});

test('native file count and byte budgets fail explicitly without reading an unbounded ledger', async t => {
  const { project, task, manager, native, data } = await fixture(t); manager.appendCustomEntry('optracall.project-report-write', data);
  const bytes = await fs.readFile(native);
  for (let i = 0; i < 20; i++) await fs.writeFile(path.join(task.sessionDirectory, `copy-${i}.jsonl`), bytes);
  await assert.rejects(listTaskBoundReports(project, task), /project_result_native_budget_exceeded/);
  for (let i = 0; i < 20; i++) await fs.unlink(path.join(task.sessionDirectory, `copy-${i}.jsonl`));
  await fs.truncate(native, 50 * 1024 * 1024 + 1);
  await assert.rejects(listTaskBoundReports(project, task), /project_result_native_budget_exceeded/);
});

test('a linked native source or changed owner is not followed outside the original Task storage', async t => {
  const { root, project, task, manager, native, data } = await fixture(t); manager.appendCustomEntry('optracall.project-report-write', data);
  const external = path.join(root, 'external-native.jsonl'), bytes = await fs.readFile(native); await fs.writeFile(external, bytes);
  await fs.unlink(native); await fs.symlink(external, native);
  await assert.rejects(listTaskBoundReports(project, task), /project_result_native_unavailable/);
  assert.deepEqual(await fs.readFile(external), bytes);
  await assert.rejects(listTaskBoundReports(project, { ...task, sessionDirectory: root }), /project_result_native_owner_mismatch/);
});

test('cancelled and stale original invocation checks remain valid across native filesystem awaits', async t => {
  const { project, task } = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(listTaskBoundReports(project, task, { signal: controller.signal }), /abort/i);
  let current = true;
  const pending = listTaskBoundReports(project, task, { assertCurrent() { if (!current) throw new Error('original_read_no_longer_current'); } });
  queueMicrotask(() => { current = false; });
  await assert.rejects(pending, /original_read_no_longer_current/);
});
