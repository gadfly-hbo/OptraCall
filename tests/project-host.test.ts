import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { SessionManager } from '../src/agent/sdk.ts';

type Host = Awaited<ReturnType<typeof startTestHost>>;
type WireEvent = { type?: string; requestId?: string; outcome?: string; text?: string; [key: string]: unknown };
async function json(response: Response, expected = 200): Promise<any> { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }
async function projectEvents(host: Host, id: string, taskId: string) {
  const response = await host.request(`/api/projects/${id}/tasks/${taskId}/events`);
  if (response.status !== 200) assert.fail(`Project SSE returned ${response.status}: ${await response.text()}`);
  assert.ok(response.body);
  const reader = response.body.getReader(), decoder = new TextDecoder(), events: WireEvent[] = [];
  const waiters = new Map<string, { resolve: (event: WireEvent) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  const pump = (async () => {
    let buffer = '';
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break; buffer += decoder.decode(next.value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const line = block.split('\n').find(value => value.startsWith('data: ')); if (!line) continue;
          const event = JSON.parse(line.slice(6)) as WireEvent; events.push(event);
          if (event.type === 'run.settled' && event.requestId) { const waiter = waiters.get(event.requestId); if (waiter) { clearTimeout(waiter.timer); waiters.delete(event.requestId); waiter.resolve(event); } }
        }
      }
    } catch (error) { for (const waiter of waiters.values()) { clearTimeout(waiter.timer); waiter.reject(error); } waiters.clear(); }
  })();
  return {
    events,
    terminal: (requestId: string) => {
      const existing = events.find(event => event.type === 'run.settled' && event.requestId === requestId); if (existing) return Promise.resolve(existing);
      const pending = new Promise<WireEvent>((resolve, reject) => { const timer = setTimeout(() => { waiters.delete(requestId); reject(new Error('Project terminal event missing.')); }, 60_000); waiters.set(requestId, { resolve, reject, timer }); });
      void pending.catch(() => {}); return pending;
    },
    close: async () => { await reader.cancel(); await pump; for (const waiter of waiters.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Synthetic project stream closed.')); } waiters.clear(); },
  };
}

test('PROJECT-04: upload stays local until explicit clean preparation and native SDK tools analyze the clean copy', { timeout: 120_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ timeoutMs: 10_000 }); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '项目合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-project-model', apiKey: 'synthetic-project-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'HTTP合成项目' }), 201);
  const { task: task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '合成任务' }), 201);
  assert.ok(project.id); assert.ok(path.isAbsolute(project.rootPath));
  const sentinel = `RAW_ONLY_SENTINEL_${randomUUID()}`;
  const uploaded = await json(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'sales.csv', content: Buffer.from('id,amount\n1,10\n2,20\n3,30\n').toString('base64'), directory: '010_draw' }), 201);
  const raw = await json(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'private.txt', content: Buffer.from(sentinel).toString('base64'), directory: '010_draw' }), 201);
  assert.equal(provider.requests.length, 0, 'Saving configuration, creating a project and uploading must not call a model.');
  assert.equal(await (await host.request(`/api/projects/${project.id}/files/content?path=${encodeURIComponent(raw.file.path)}`)).text(), sentinel);
  const initialFiles = await json(await host.request(`/api/projects/${project.id}/files`));
  assert.deepEqual(initialFiles.files.find((node: any) => node.name === '020_clean').children, []);
  await json(await host.request(`/api/projects/${project.id}/files/copy-to-clean`, 'POST', { path: uploaded.file.path }), 201);
  assert.equal(provider.requests.length, 0, 'Only an explicit chat send starts an SDK request.');
  const stages = [
    [
      { name: 'ls', arguments: { path: '.' } },
      { name: 'find', arguments: { pattern: '*.csv', path: '.' } },
      { name: 'grep', arguments: { pattern: 'amount', path: '.', glob: '*.csv' } },
      { name: 'read', arguments: { path: 'sales.csv' } },
      { name: 'codemode', arguments: { code: 'text(await tools.read({path:"sales.csv"}));' } },
    ],
    [{ name: 'bash', arguments: { command: "python3 - <<'PY'\nimport csv,json,pathlib\nrows=list(csv.DictReader(open('sales.csv')))\nvalues=[int(row['amount']) for row in rows]\nsummary={'rows':len(rows),'sum':sum(values),'mean':sum(values)/len(values)}\npathlib.Path('process.json').write_text(json.dumps(summary))\npathlib.Path('../060_reports/summary.md').write_text('# Synthetic report\\nRows: 3\\nTotal: 60\\nAverage: 20\\n')\nprint('ROWS='+str(len(rows))+' SUM='+str(sum(values))+' MEAN='+str(sum(values)/len(values)))\nPY" } }],
  ];
  const final = '合成简析：3 条记录，金额合计 60，平均 20。报告已保存到 060_reports/summary.md。';
  provider.setResponder(context => {
    let used = 0;
    for (const calls of stages) { if (context.recentToolResults.length < used + calls.length) return { calls }; used += calls.length; }
    const actual = context.recentToolResults.map(message => providerMessageText(message.content)).join('\n');
    assert.match(actual, /ROWS=3 SUM=60 MEAN=20/);
    assert.match(actual, /id,amount/);
    assert.ok(!actual.includes(sentinel));
    return { text: final };
  });
  const stream = await projectEvents(host, project.id, task.id); t.after(() => stream.close());
  const requestId = randomUUID(), terminal = stream.terminal(requestId);
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '请分析020_clean中的sales.csv，保存过程文件及最终简报。', requestId }), 202);
  assert.equal((await terminal).outcome, 'completed');
  assert.deepEqual(provider.errors, []);
  assert.ok(provider.requests.length >= 3, 'The SDK must execute tool turns before its final answer.');
  assert.ok(!JSON.stringify(provider.requests.map(request => request.body)).includes(sentinel), 'Host must not automatically attach unrelated raw content to this clean-only analysis request. This does not prove raw-file isolation.');
  const system = (provider.requests[0]?.body.messages ?? []).filter(message => message.role === 'system' || message.role === 'developer').map(message => providerMessageText(message.content)).join('\n');
  assert.match(system, /010_draw/); assert.match(system, /020_clean/); assert.match(system, /060_reports/);
  assert.match(system, /010_draw.{0,100}(?:不得|不要|不应|不读取|do not|never)|(?:不得|不要|不应|不读取|do not|never).{0,100}010_draw/is, 'The SDK system context must state the requested raw-file convention; this is a soft instruction, not a sandbox.');
  const state = await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.ok(JSON.stringify(state.snapshot.messages).includes(final));
  assert.ok(state.snapshot.messages.some((message: any) => message.role === 'toolResult'), 'History must retain native tool results.');
  assert.equal((await fs.readFile(path.join(project.rootPath, '020_clean/process.json'), 'utf8')), '{"rows": 3, "sum": 60, "mean": 20.0}');
  assert.match(await (await host.request(`/api/projects/${project.id}/files/content?path=060_reports%2Fsummary.md`)).text(), /Total: 60/);
  assert.ok(stream.events.some(event => /tool/.test(event.type ?? '') || JSON.stringify(event).includes('tool_execution')));
  assert.equal(stream.events.filter(event => event.type === 'run.settled' && event.requestId === requestId).length, 1);
});

test('CHAT-04: consecutive user turns share the same native SDK conversation and keep unique request outcomes', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '多轮合成模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-multiturn', apiKey: 'synthetic-multiturn-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '连续合成对话' }), 201);
  const { task: task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '合成任务' }), 201);
  provider.setResponder(context => {
    const latest = [...context.messages].reverse().find(message => message.role === 'user');
    if (providerMessageText(latest?.content).includes('第二轮')) {
      assert.ok(context.messages.some(message => message.role === 'assistant' && providerMessageText(message.content).includes('第一轮记住：合成编号 A17。')));
      return { text: '第二轮沿用合成编号 A17。' };
    }
    return { text: '第一轮记住：合成编号 A17。' };
  });
  const stream = await projectEvents(host, project.id, task.id); t.after(() => stream.close());
  for (const text of ['第一轮：请记住合成编号 A17。', '第二轮：刚才的合成编号是什么？']) {
    const requestId = randomUUID();
    await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text, requestId }), 202);
    assert.equal((await stream.terminal(requestId)).outcome, 'completed');
  }
  const state = await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.equal(state.snapshot.messages.filter((message: any) => message.role === 'user').length, 2);
  assert.equal(state.snapshot.messages.filter((message: any) => message.role === 'assistant').length, 2);
  assert.equal(provider.requests.length, 2); assert.deepEqual(provider.errors, []);
  const outcomes = stream.events.filter(event => event.type === 'run.settled'); assert.equal(outcomes.length, 2); assert.notEqual(outcomes[0].requestId, outcomes[1].requestId);
});

test('CHAT-04: overlapping projects retain their model routes, credentials, conversation histories and cancellation outcomes', { timeout: 60_000 }, async t => {
  const a = await startToolProvider(), b = await startToolProvider(); t.after(() => a.close()); t.after(() => b.close());
  a.setResponder(() => ({ text: '项目 A 的合成部分回复', hold: true })); b.setResponder(() => ({ text: '项目 B 的独立合成回复' }));
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '项目 A 模型', provider: 'openai-compatible', baseUrl: a.baseUrl, model: 'synthetic-project-a', apiKey: 'synthetic-project-A-key' }));
  const { project: pa } = await json(await host.request('/api/projects', 'POST', { name: '独立 A' }), 201);
  const { task: paTask } = await json(await host.request(`/api/projects/${pa.id}/tasks`, 'POST', { name: '合成任务' }), 201);
  await json(await host.request('/api/configuration', 'PUT', { name: '项目 B 模型', provider: 'openai-compatible', baseUrl: b.baseUrl, model: 'synthetic-project-b', apiKey: 'synthetic-project-B-key' }));
  const { project: pb } = await json(await host.request('/api/projects', 'POST', { name: '独立 B' }), 201);
  const { task: pbTask } = await json(await host.request(`/api/projects/${pb.id}/tasks`, 'POST', { name: '合成任务' }), 201);
  const sa = await projectEvents(host, pa.id, paTask.id), sb = await projectEvents(host, pb.id, pbTask.id); t.after(() => sa.close()); t.after(() => sb.close());
  const ra = randomUUID(), rb = randomUUID();
  await json(await host.request(`/api/projects/${pa.id}/tasks/${paTask.id}/messages`, 'POST', { text: 'A 项目问题', requestId: ra }), 202);
  await a.waitForRequests(1);
  await json(await host.request(`/api/projects/${pa.id}/tasks/${paTask.id}/messages`, 'POST', { text: 'A 忙时重复问题', requestId: randomUUID() }), 409);
  await json(await host.request(`/api/projects/${pb.id}/tasks/${pbTask.id}/messages`, 'POST', { text: 'B 项目问题', requestId: rb }), 202);
  assert.equal((await sb.terminal(rb)).outcome, 'completed');
  const bState = await json(await host.request(`/api/projects/${pb.id}/tasks/${pbTask.id}`));
  assert.ok(JSON.stringify(bState.snapshot.messages).includes('项目 B 的独立合成回复'));
  assert.ok(!JSON.stringify(bState.snapshot.messages).includes('A 项目问题'));
  await json(await host.request(`/api/projects/${pa.id}/tasks/${paTask.id}/stop`, 'POST', {}));
  assert.equal((await sa.terminal(ra)).outcome, 'cancelled');
  const aState = await json(await host.request(`/api/projects/${pa.id}/tasks/${paTask.id}`));
  assert.ok(JSON.stringify(aState.snapshot.messages).includes('项目 A 的合成部分回复'));
  assert.ok(!JSON.stringify(aState.snapshot.messages).includes('B 项目问题'));
  assert.equal(a.requests[0]?.body.model, 'synthetic-project-a'); assert.equal(b.requests[0]?.body.model, 'synthetic-project-b');
  assert.equal(a.requests[0]?.authorization, 'Bearer synthetic-project-A-key'); assert.equal(b.requests[0]?.authorization, 'Bearer synthetic-project-B-key');
  assert.deepEqual(sa.events.filter(event => event.type === 'run.settled').map(event => event.requestId), [ra]);
  assert.deepEqual(sb.events.filter(event => event.type === 'run.settled').map(event => event.requestId), [rb]);
  assert.deepEqual(a.errors, []); assert.deepEqual(b.errors, []);
});

test('CHAT-04: provider failure remains failed until an explicit new retry and a repeated request ID is not replayed', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close()); provider.setResponder(() => ({ status: 401 }));
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '失败与重试模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-retry-model', apiKey: 'synthetic-retry-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '显式重试' }), 201);
  const { task: task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '合成任务' }), 201);
  const stream = await projectEvents(host, project.id, task.id); t.after(() => stream.close());
  const failedId = randomUUID(), text = '请回答这条合成测试问题。';
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text, requestId: failedId }), 202);
  assert.equal((await stream.terminal(failedId)).outcome, 'failed');
  const failed = await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`)); assert.equal(failed.task.lastRun.status, 'failed');
  assert.equal(provider.requests.length, 1, 'Authentication failure must not retry or switch routes.');
  const duplicate = await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text, requestId: failedId }), 202);
  assert.equal(duplicate.status, 'failed'); assert.equal(provider.requests.length, 1);
  provider.setResponder(() => ({ text: '用户显式重试后的合成成功回复。' }));
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`)); await json(await host.request('/api/projects'));
  assert.equal(provider.requests.length, 1, 'Reading the project must not start a retry.');
  const retryId = randomUUID();
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text, requestId: retryId }), 202);
  assert.equal((await stream.terminal(retryId)).outcome, 'completed');
  assert.equal(provider.requests.length, 2); assert.deepEqual(provider.errors, []);
  const recovered = await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.ok(JSON.stringify(recovered.snapshot.messages).includes('用户显式重试后的合成成功回复。'));
  assert.deepEqual(stream.events.filter(event => event.type === 'run.settled').map(event => event.outcome), ['failed', 'completed']);
});

test('PROJECT-04: restarting the Host reopens native JSONL, drafts and files without replaying accepted messages', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  provider.setResponder(context => {
    const latest = [...context.messages].reverse().find(message => message.role === 'user');
    if (providerMessageText(latest?.content).includes('重启后')) {
      assert.ok(context.messages.some(message => message.role === 'assistant' && providerMessageText(message.content).includes('恢复前记住 RESTORE-Q52。')));
      return { text: '重启后的追问仍记得 RESTORE-Q52。' };
    }
    return { text: '恢复前记住 RESTORE-Q52。' };
  });
  const original = await startTestHost(); t.after(() => original.close());
  await json(await original.request('/api/configuration', 'PUT', { name: '重启恢复模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-restore-model', apiKey: 'synthetic-restore-key' }));
  const { project } = await json(await original.request('/api/projects', 'POST', { name: '持久项目' }), 201);
  const { task: task } = await json(await original.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '合成任务' }), 201);
  await json(await original.request(`/api/projects/${project.id}/tasks/${task.id}/draft`, 'PATCH', { text: '未发送草稿，重启后保留。' }));
  await json(await original.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'persisted.txt', content: Buffer.from('persistent synthetic file').toString('base64'), directory: '020_clean' }), 201);
  const beforeStream = await projectEvents(original, project.id, task.id); t.after(() => beforeStream.close());
  const acceptedId = randomUUID(), text = '重启前：请记住合成标识 RESTORE-Q52。';
  await json(await original.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text, requestId: acceptedId }), 202);
  assert.equal((await beforeStream.terminal(acceptedId)).outcome, 'completed');
  const before = await json(await original.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.ok(before.task.sessionFile?.endsWith('.jsonl')); const history = await fs.readFile(before.task.sessionFile, 'utf8');
  assert.match(history, /恢复前记住 RESTORE-Q52/); assert.ok(!history.includes('synthetic-restore-key'));
  await beforeStream.close(); await original.close();
  const restored = await startTestHost({ dataRoot: original.dataRoot, projectsRoot: original.projectsRoot }); t.after(() => restored.close());
  const after = await json(await restored.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.equal(after.task.draft, '未发送草稿，重启后保留。'); assert.equal(after.task.sessionFile, before.task.sessionFile);
  assert.equal(after.snapshot.sessionId, before.snapshot.sessionId); assert.deepEqual(after.snapshot.messages, before.snapshot.messages);
  assert.equal(await (await restored.request(`/api/projects/${project.id}/files/content?path=020_clean%2Fpersisted.txt`)).text(), 'persistent synthetic file');
  assert.equal(provider.requests.length, 1, 'Reopening a project and its history must not call the provider.');
  const repeated = await json(await restored.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text, requestId: acceptedId }), 202);
  assert.equal(repeated.status, 'completed'); assert.equal(provider.requests.length, 1, 'A previously accepted request ID must remain deduplicated after restart.');
  const afterStream = await projectEvents(restored, project.id, task.id); t.after(() => afterStream.close());
  const followup = randomUUID();
  await json(await restored.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '重启后：刚才记住的标识是什么？', requestId: followup }), 202);
  assert.equal((await afterStream.terminal(followup)).outcome, 'completed'); assert.equal(provider.requests.length, 2); assert.deepEqual(provider.errors, []);
});

test('CHAT-04: recovery respects a matching saved completion and never borrows it for a newer unfinished run marker', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close()); provider.setResponder(() => ({ text: '上一轮已知完成。' }));
  const original = await startTestHost(); t.after(() => original.close());
  await json(await original.request('/api/configuration', 'PUT', { name: '恢复边界模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-recovery-marker', apiKey: 'synthetic-recovery-marker-key' }));
  const { project } = await json(await original.request('/api/projects', 'POST', { name: '中断边界合成项目' }), 201);
  const { task: task } = await json(await original.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '合成任务' }), 201);
  const stream = await projectEvents(original, project.id, task.id); t.after(() => stream.close());
  const completedId = randomUUID();
  await json(await original.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '完成旧轮合成问题。', requestId: completedId }), 202);
  assert.equal((await stream.terminal(completedId)).outcome, 'completed');
  const completed = await json(await original.request(`/api/projects/${project.id}/tasks/${task.id}`));
  await stream.close(); await original.close();
  const metadataPath = path.join(original.dataRoot, 'projects', project.id, 'project.json');
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  // Synthetic crash fixture: the SDK terminal reached disk but Host metadata did not settle.
  const persistedTask = metadata.tasks.find((item: any) => item.id === task.id);
  persistedTask.lastRun = { id: completedId, status: 'running', startedAt: persistedTask.lastRun.startedAt };
  await fs.writeFile(metadataPath, JSON.stringify(metadata));
  const matching = await startTestHost({ dataRoot: original.dataRoot, projectsRoot: original.projectsRoot }); t.after(() => matching.close());
  const proven = await json(await matching.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.equal(proven.task.lastRun.status, 'completed'); assert.equal(provider.requests.length, 1);
  await matching.close();
  // A new request was accepted and marked in the native session, then interrupted before its reply.
  const unfinishedId = randomUUID(), startedAt = new Date().toISOString();
  const manager = SessionManager.open(completed.task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean'));
  manager.appendCustomEntry('optracall.run', { requestId: unfinishedId, startedAt });
  const unfinished = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  unfinished.tasks.find((item: any) => item.id === task.id).lastRun = { id: unfinishedId, status: 'running', startedAt };
  await fs.writeFile(metadataPath, JSON.stringify(unfinished));
  const restarted = await startTestHost({ dataRoot: original.dataRoot, projectsRoot: original.projectsRoot }); t.after(() => restarted.close());
  const recovered = await json(await restarted.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.equal(recovered.task.lastRun.id, unfinishedId); assert.equal(recovered.task.lastRun.status, 'interrupted');
  assert.ok(JSON.stringify(recovered.snapshot.messages).includes('上一轮已知完成。'));
  assert.equal(provider.requests.length, 1, 'Recovery must not replay the unknown request.');
  const duplicate = await json(await restarted.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '中断结果未知的请求。', requestId: unfinishedId }), 202);
  assert.equal(duplicate.status, 'interrupted'); assert.equal(provider.requests.length, 1);
});

test('CFG-04: clearing credentials preserves project history and files, and restart requires explicit reconfiguration', { timeout: 60_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close()); provider.setResponder(() => ({ text: '清除凭据前的合成历史回复。' }));
  const host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: '凭据生命周期模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-clear-model', apiKey: 'synthetic-clear-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '保留资料与历史' }), 201);
  const { task: task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '合成任务' }), 201);
  await json(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { name: 'retained.txt', content: Buffer.from('retain after credential clear').toString('base64'), directory: '020_clean' }), 201);
  const stream = await projectEvents(host, project.id, task.id); t.after(() => stream.close());
  const requestId = randomUUID();
  await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '生成一条合成历史。', requestId }), 202);
  assert.equal((await stream.terminal(requestId)).outcome, 'completed'); await stream.close();
  await json(await host.request(`/api/configuration?provider=${encodeURIComponent(project.configuration.provider)}`, 'DELETE'));
  const missing = await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.equal(missing.snapshot.capabilities.requiresConfiguration, true);
  assert.ok(JSON.stringify(missing.snapshot.messages).includes('清除凭据前的合成历史回复。'));
  assert.equal(await (await host.request(`/api/projects/${project.id}/files/content?path=020_clean%2Fretained.txt`)).text(), 'retain after credential clear');
  const blocked = await json(await host.request(`/api/projects/${project.id}/tasks/${task.id}/messages`, 'POST', { text: '缺少凭据不应发送。', requestId: randomUUID() }), 409);
  assert.equal(blocked.code, 'configuration_required'); assert.equal(provider.requests.length, 1);
  await host.close();
  const restarted = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot }); t.after(() => restarted.close());
  const after = await json(await restarted.request(`/api/projects/${project.id}/tasks/${task.id}`));
  assert.equal(after.snapshot.capabilities.requiresConfiguration, true); assert.ok(JSON.stringify(after.snapshot.messages).includes('清除凭据前的合成历史回复。'));
  assert.equal(provider.requests.length, 1, 'Restart must not reimport credentials, replay messages or switch to a fallback model.');
});

test('EB10/11: read-only request receipts reopen older revisions and unknown legacy evidence after later turns and restart', { timeout: 60000 }, async t => {
  const provider = await startSyntheticProvider(); t.after(() => provider.close());
  let host = await startTestHost(); t.after(() => host.close());
  await json(await host.request('/api/configuration', 'PUT', { name: 'Receipt history synthetic', provider: 'openai-compatible',
    baseUrl: provider.baseUrl, model: 'synthetic-enterprise', apiKey: 'synthetic-receipt-history-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: '历史回执合成项目' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '多轮不同资料' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  await json(await host.request(`${route}/context-receipts`));
  const draft = await json(await host.request('/api/enterprise-materials', 'POST', { title: '历史原文', body: '旧修订依据' }), 201);
  let detail = await json(await host.request(`/api/enterprise-materials/${draft.material.id}/enable`, 'POST', { expectedVersion: draft.material.version }));
  const refs = [];
  for (const text of ['第一轮', '第二轮']) {
    const requestId = randomUUID(), revisionId = detail.material.activeRevisionId;
    const stream = await projectEvents(host, project.id, task.id);
    await json(await host.request(`${route}/messages`, 'POST', { requestId, text,
      enterpriseMaterials: [{ storeId: detail.storeId, materialId: detail.material.id, revisionId, mode: 'full' }] }), 202);
    await stream.terminal(requestId); await stream.close();
    refs.push({ requestId, revisionId });
    if (text === '第一轮') {
      const changed = await json(await host.request(`/api/enterprise-materials/${draft.material.id}`, 'PUT', { expectedVersion: detail.material.version, body: '新修订依据' }));
      detail = await json(await host.request(`/api/enterprise-materials/${draft.material.id}/enable`, 'POST', { expectedVersion: changed.material.version }));
    }
  }
  const state = await json(await host.request(route));
  await host.close();
  const manager = SessionManager.open(state.task.sessionFile, state.task.sessionDirectory, path.join(project.rootPath, '020_clean'));
  manager.appendCustomEntry('optracall.run', { requestId: 'legacy-no-recorded-sources' });
  const before = await fs.readFile(state.task.sessionFile);
  host = await startTestHost({ dataRoot: host.dataRoot, projectsRoot: host.projectsRoot });
  const { receipts } = await json(await host.request(`${route}/context-receipts`));
  assert.equal(receipts.length, 3);
  for (const [index, ref] of refs.entries()) {
    const recorded = receipts.find((item: { requestId: string }) => item.requestId === ref.requestId);
    assert.equal(recorded.providedContext.enterprise.materials[0].revisionId, ref.revisionId);
    assert.equal(recorded.providedContext.enterprise.materials[0].providedText, index ? '新修订依据' : '旧修订依据');
    assert.equal(recorded.providedContext.claim, 'provided-not-adopted');
  }
  assert.equal(receipts.find((item: { requestId: string }) => item.requestId === 'legacy-no-recorded-sources').providedContext, undefined);
  assert.deepEqual(await fs.readFile(state.task.sessionFile), before);
  assert.equal(provider.requests.length, 2);
  await json(await host.request(`/api/projects/${project.id}/tasks/${randomUUID()}/context-receipts`), 404);
});
