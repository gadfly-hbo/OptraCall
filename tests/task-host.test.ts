import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startTestHost } from './fixtures/host-process.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { sessionEvents } from './fixtures/session-events.ts';

async function json(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }
async function until(ready: () => boolean, message: string) { const deadline = Date.now() + 10_000; while (!ready()) { if (Date.now() > deadline) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 10)); } }

test('TASK-01: an empty project contains independently named tasks and task-owned drafts', async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Task synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-task-model', apiKey: 'synthetic-task-only-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '共享分析空间' }), 201);
  assert.deepEqual(project.tasks, [], 'A project is an empty workspace until the user creates a task.');
  const { task: first } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '销售趋势' }), 201);
  const { task: second } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '库存核对' }), 201);
  assert.notEqual(first.id, second.id); assert.equal(first.configuration.model, 'synthetic-task-model');
  await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}/draft`, 'PATCH', { text: '仅属于销售任务的草稿' }));
  const a = await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}`));
  const b = await json(await host.request(`/api/projects/${project.id}/tasks/${second.id}`));
  assert.equal(a.task.draft, '仅属于销售任务的草稿'); assert.equal(b.task.draft, '');
  assert.deepEqual(a.snapshot.messages, []); assert.deepEqual(b.snapshot.messages, []);
  const projectOnly = await json(await host.request(`/api/projects/${project.id}`)); assert.equal(projectOnly.snapshot, undefined);
  const { project: unrelated } = await json(await host.request('/api/projects', 'POST', { name: '另一个工作空间' }), 201);
  await json(await host.request(`/api/projects/${unrelated.id}/tasks/${first.id}`), 404);
  assert.equal(provider.requests.length, 0, 'Create/read/draft must not call a model.');
});

test('TASK-02: same-project tasks run concurrently with their own routes, request ledger, events and stop', { timeout: 60_000 }, async t => {
  const a = await startToolProvider(), b = await startToolProvider(); t.after(() => a.close()); t.after(() => b.close());
  a.setResponder(() => ({ text: '任务A的部分输出', hold: true }));
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  b.setResponder(async () => { await barrier; return { text: '任务B独立完成' }; });
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '任务A模型', provider: 'openai-compatible', baseUrl: a.baseUrl, model: 'synthetic-task-a', apiKey: 'synthetic-task-A-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '并行任务空间' }), 201);
  const configB = await json(await host.request('/api/configuration', 'PUT', { name: '任务B模型', provider: 'openai-compatible', baseUrl: b.baseUrl, model: 'synthetic-task-b', apiKey: 'synthetic-task-B-key' }));
  const { task: first } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '任务A' }), 201);
  const { task: second } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '任务B', configurationId: configB.configuration.id }), 201);
  assert.equal(first.configuration.model, 'synthetic-task-a', 'Changing the global selection does not change the project default.'); assert.equal(second.configuration.model, 'synthetic-task-b');
  const streamA = await sessionEvents(host, project.id, first.id), streamB = await sessionEvents(host, project.id, second.id); t.after(() => streamA.close()); t.after(() => streamB.close());
  const sharedRequestId = randomUUID();
  await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}/messages`, 'POST', { text: '只属于任务A的问题', requestId: sharedRequestId }), 202); await a.waitForRequests(1);
  await json(await host.request(`/api/projects/${project.id}/tasks/${second.id}/messages`, 'POST', { text: '只属于任务B的问题', requestId: sharedRequestId }), 202); await b.waitForRequests(1);
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}), 409);
  const renamed = await json(await host.request(`/api/projects/${project.id}`, 'PATCH', { name: '运行中改名的空间' })); assert.equal(renamed.project.rootPath, project.rootPath); assert.equal(renamed.project.name, '运行中改名的空间');
  await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}/stop`, 'POST', {}));
  const doneA = await streamA.terminal; assert.equal(doneA.type, 'run.settled'); if (doneA.type === 'run.settled') assert.equal(doneA.outcome, 'cancelled');
  const stillRunning = await json(await host.request(`/api/projects/${project.id}/tasks/${second.id}`)); assert.equal(stillRunning.snapshot.status, 'running'); assert.equal(b.requests[0].closedEarly, false);
  release(); const doneB = await streamB.terminal; assert.equal(doneB.type, 'run.settled'); if (doneB.type === 'run.settled') assert.equal(doneB.outcome, 'completed');
  const finalA = await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}`)), finalB = await json(await host.request(`/api/projects/${project.id}/tasks/${second.id}`));
  assert.ok(JSON.stringify(finalA.snapshot.messages).includes('任务A的部分输出')); assert.ok(!JSON.stringify(finalA.snapshot.messages).includes('只属于任务B的问题'));
  assert.ok(JSON.stringify(finalB.snapshot.messages).includes('任务B独立完成')); assert.ok(!JSON.stringify(finalB.snapshot.messages).includes('只属于任务A的问题'));
  assert.notEqual(finalA.task.sessionDirectory, finalB.task.sessionDirectory);
  for (const event of streamA.events as any[]) { assert.equal(event.projectId, project.id); assert.equal(event.taskId, first.id); }
  for (const event of streamB.events as any[]) { assert.equal(event.projectId, project.id); assert.equal(event.taskId, second.id); }
  assert.equal(a.requests[0].authorization, 'Bearer synthetic-task-A-key'); assert.equal(b.requests[0].authorization, 'Bearer synthetic-task-B-key');
  assert.equal(a.requests[0].body.model, 'synthetic-task-a'); assert.equal(b.requests[0].body.model, 'synthetic-task-b');
  const duplicate = await json(await host.request(`/api/projects/${project.id}/tasks/${second.id}/messages`, 'POST', { text: '不得重放', requestId: sharedRequestId }), 202); assert.equal(duplicate.deduplicated, true); assert.equal(b.requests.length, 1);
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('ARCHIVE-01: archive is read-only and reversible without moving files, losing task state or starting SDK workers', { timeout: 60_000 }, async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-archive-host-')), dataRoot = path.join(scratch, 'host'), projectsRoot = path.join(scratch, 'projects'), starts = path.join(scratch, 'worker-starts.txt');
  const extensions = path.join(dataRoot, 'pi', 'extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'count-startup.ts'), `import { appendFileSync } from 'node:fs'; export default function(pi) { pi.on('session_start', () => { appendFileSync(${JSON.stringify(starts)}, 'started\\n'); }); }\n`);
  const provider = await startSyntheticProvider(); t.after(() => provider.close()); const host = await startTestHost({ dataRoot, projectsRoot }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '归档合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-archive', apiKey: 'synthetic-archive-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '完整保留的项目' }), 201);
  const { task: first } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '有历史的任务' }), 201);
  const { task: second } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '未打开的任务' }), 201);
  const raw = await json(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'retained.txt', content: Buffer.from('retained synthetic original').toString('base64'), directory: '010_draw' }), 201);
  const passive = await sessionEvents(host, project.id, second.id); await until(() => passive.events.some(event => event.type === 'snapshot'), 'Passive task snapshot missing.'); await passive.close();
  await json(await host.request('/api/projects')); await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}`));
  await assert.rejects(readFile(starts), { code: 'ENOENT' }); assert.equal(provider.requests.length, 0, 'Listing, saved history and SSE must not initialize workers.');
  const opened = await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}/open`, 'POST', {})); assert.ok(opened.snapshot.tools.includes('bash'));
  const initialStarts = await readFile(starts, 'utf8');
  const stream = await sessionEvents(host, project.id, first.id); t.after(() => stream.close()); const originalId = randomUUID();
  await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}/messages`, 'POST', { text: '保留这段合成历史。', requestId: originalId }), 202); await stream.terminal;
  await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}/draft`, 'PATCH', { text: '归档前的未发送草稿' }));
  const before = await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}`));
  const archived = await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {})); assert.equal(typeof archived.project.archivedAt, 'string'); assert.equal(archived.project.rootPath, project.rootPath);
  const read = await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}`)); assert.deepEqual(read.snapshot.messages, before.snapshot.messages); assert.equal(read.task.draft, '归档前的未发送草稿'); assert.equal(read.task.sessionFile, before.task.sessionFile);
  assert.equal(await (await host.request(`/api/projects/${project.id}/files/content?path=${encodeURIComponent(raw.file.path)}`)).text(), 'retained synthetic original');
  const archivedStream = await sessionEvents(host, project.id, first.id); await until(() => archivedStream.events.some(event => event.type === 'snapshot'), 'Archived history snapshot missing.'); await archivedStream.close();
  const blocked: Array<[string, string, unknown]> = [
    [`/api/projects/${project.id}`, 'PATCH', { name: '不能改名' }],
    [`/api/projects/${project.id}/tasks`, 'POST', { name: '不能新增任务' }],
    [`/api/projects/${project.id}/tasks/${first.id}/draft`, 'PATCH', { text: '不能覆盖草稿' }],
    [`/api/projects/${project.id}/tasks/${first.id}/messages`, 'POST', { text: '即使旧UUID也不得写', requestId: originalId }],
    [`/api/projects/${project.id}/tasks/${first.id}/commands`, 'POST', { text: '/tools', requestId: randomUUID() }],
    [`/api/projects/${project.id}/tasks/${first.id}/open`, 'POST', {}],
    [`/api/projects/${project.id}/tasks/${first.id}/ui-response`, 'POST', { id: 'late-archived-response', value: true }],
    [`/api/projects/${project.id}/files/upload`, 'POST', { name: 'blocked.txt', content: Buffer.from('blocked').toString('base64'), directory: '020_clean' }],
    [`/api/projects/${project.id}/files/copy-to-clean`, 'POST', { path: raw.file.path }],
    [`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'blocked.md', text: 'blocked' }],
  ];
  for (const [route, method, input] of blocked) { const result = await json(await host.request(route, method, input), 409); assert.equal(result.code, 'project_archived', route); }
  const deleted = await host.request(`/api/projects/${project.id}`, 'DELETE'); assert.ok([404, 405].includes(deleted.status));
  assert.equal((await json(await host.request(`/api/projects/${project.id}`))).project.archivedAt, archived.project.archivedAt);
  assert.equal(await readFile(starts, 'utf8'), initialStarts); assert.equal(provider.requests.length, 1);
  const restored = await json(await host.request(`/api/projects/${project.id}/restore`, 'POST', {})); assert.equal(restored.project.archivedAt, null); assert.equal(restored.project.rootPath, project.rootPath); assert.deepEqual(restored.project.tasks.map((task: any) => task.id), [first.id, second.id]);
  await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}`)); assert.equal(await readFile(starts, 'utf8'), initialStarts); assert.equal(provider.requests.length, 1, 'Restore and saved-history read must not run either task.');
  await host.close(); const restarted = await startTestHost({ dataRoot, projectsRoot }); t.after(() => restarted.close());
  const after = await json(await restarted.request(`/api/projects/${project.id}/tasks/${first.id}`)); assert.equal(after.task.draft, '归档前的未发送草稿'); assert.deepEqual(after.snapshot.messages, before.snapshot.messages);
  assert.equal(await readFile(starts, 'utf8'), initialStarts);
  const resumed = await sessionEvents(restarted, project.id, first.id); t.after(() => resumed.close());
  await json(await restarted.request(`/api/projects/${project.id}/tasks/${first.id}/messages`, 'POST', { text: '用户显式继续原有任务。', requestId: randomUUID() }), 202); await resumed.terminal;
  assert.equal(await readFile(starts, 'utf8'), initialStarts + initialStarts); assert.equal(provider.requests.length, 2); assert.ok(JSON.stringify(provider.requests[1].body.messages).includes('保留这段合成历史'));
});

test('TASK-03: archive refuses opening tasks and stop cancels only its own startup interaction', { timeout: 30_000 }, async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-task-opening-')), dataRoot = path.join(scratch, 'host'), projectsRoot = path.join(scratch, 'projects');
  const extensions = path.join(dataRoot, 'pi', 'extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'startup-question.ts'), "export default function(pi) { pi.on('session_start', async (_event, ctx) => { if (!await ctx.ui.confirm('任务启动确认', '仅由所属任务回应。')) throw new Error('Synthetic startup declined'); }); }\n");
  const provider = await startSyntheticProvider(); t.after(() => provider.close()); const host = await startTestHost({ dataRoot, projectsRoot }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '启动合成配置', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-opening', apiKey: 'synthetic-opening-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '启动交互空间' }), 201);
  const { task: first } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '准备停止的任务' }), 201);
  const { task: second } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '继续等待回应的任务' }), 201);
  const a = await sessionEvents(host, project.id, first.id), b = await sessionEvents(host, project.id, second.id); t.after(() => a.close()); t.after(() => b.close());
  const openingA = host.request(`/api/projects/${project.id}/tasks/${first.id}/open`, 'POST', {}), openingB = host.request(`/api/projects/${project.id}/tasks/${second.id}/open`, 'POST', {});
  await until(() => a.events.some(event => event.type === 'ui.request') && b.events.some(event => event.type === 'ui.request'), 'Both task startup questions must arrive.');
  const questionA: any = a.events.find(event => event.type === 'ui.request'), questionB: any = b.events.find(event => event.type === 'ui.request'); assert.notEqual(questionA.request.id, questionB.request.id);
  assert.equal(questionA.projectId, project.id); assert.equal(questionA.taskId, first.id); assert.equal(questionB.taskId, second.id);
  const blocked = await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}), 409); assert.equal(blocked.code, 'project_busy');
  await json(await host.request(`/api/projects/${project.id}/tasks/${second.id}/ui-response`, 'POST', { id: questionA.request.id, value: true }), 409);
  await json(await host.request(`/api/projects/${project.id}/tasks/${first.id}/stop`, 'POST', {}));
  const stopped = await openingA; assert.ok([409, 500].includes(stopped.status), 'Stopped startup cannot report a successfully initialized session.');
  assert.equal(b.events.some(event => event.type === 'ui.dismiss' && event.id === questionB.request.id), false, 'Stopping A must not dismiss B.');
  await json(await host.request(`/api/projects/${project.id}/tasks/${second.id}/ui-response`, 'POST', { id: questionB.request.id, value: true }));
  const opened = await json(await openingB); assert.equal(opened.snapshot.status, 'idle');
  assert.equal((await json(await host.request(`/api/projects/${project.id}`))).project.archivedAt, null); assert.equal(provider.requests.length, 0);
  await json(await host.request(`/api/projects/${project.id}/archive`, 'POST', {}));
});
