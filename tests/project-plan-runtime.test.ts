import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

for (const count of [1, 3]) test(`A07/A09: one confirmation starts ${count} exact Task(s) through the existing Pi path, with no RAP gate or duplicate dispatch`, { timeout: 40_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  provider.setResponder(() => ({ text: '合成核对：资料不足保留，尚不作根因判断。' }));
  const request = async (route: string, method = 'GET', body?: unknown, status = 200) => { const response = await host.request(route, method, body); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: '合成项目模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-plan', apiKey: 'synthetic-plan-only' });
  const { project } = await request('/api/projects', 'POST', { name: '合成项目确认' }, 201);
  const tasks = Array.from({ length: count }, (_, i) => ({ key: `task-${i}`, name: i === count - 1 ? '分析与综合责任' : `证据维度 ${i + 1}`, selected: true, scope: i === count - 1 ? '综合准确子成果、分歧及遗漏，不编造已完成' : `核对证据维度 ${i + 1}`, capabilities: [] }));
  const plan = { request: '合成项目一次确认启动；资料不足照实保留', premises: ['仅有诉求和基本前提'], materials: [], coverage: [], tasks, taskMode: count === 1 ? 'single' : 'multi', summaryTaskKey: tasks.at(-1)!.key, dependencies: count === 1 ? [] : tasks.slice(0, -1).map(task => ({ from: task.key, to: tasks.at(-1)!.key, reason: '综合准确成果' })), caseContext: null };
  const base = `/api/projects/${project.id}/plan`;
  const draft = await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const input = { operationId: randomUUID(), expectedRevision: draft.state.revision, mode: 'start' };
  const result = await request(base + '/confirm', 'POST', input);
  assert.equal(result.confirmation.tasks.length, count);
  assert.deepEqual(result.confirmation.tasks.map((receipt: any) => receipt.startStatus), tasks.map(() => 'accepted'));
  for (const receipt of result.confirmation.tasks) {
    let state: any;
    const deadline = Date.now() + 20_000;
    do { state = await request(`/api/projects/${project.id}/tasks/${receipt.taskId}`); if (state.task.lastRun?.id === receipt.startRequestId && state.task.lastRun.status === 'completed' && state.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
    assert.equal(state.task.lastRun?.status, 'completed');
    const entries = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const markers = entries.filter(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started' && entry.data.requestId === receipt.startRequestId);
    assert.equal(markers.length, 1);
    const delivered = markers[0].data.providedContext.projectPlan;
    assert.equal(delivered.confirmationId, result.confirmation.id);
    assert.equal(delivered.taskId, receipt.taskId);
    assert.equal(delivered.summaryTaskId, result.confirmation.tasks.at(-1).taskId);
    assert.equal(delivered.taskKey, receipt.taskKey);
  }
  const before = provider.requests.length;
  assert.equal(before, count);
  const replay = await request(base + '/confirm', 'POST', input);
  assert.equal(replay.replayed, true);
  assert.equal(provider.requests.length, before);
  assert.equal((await request(`/api/projects/${project.id}`)).project.tasks.length, count);
  for (const call of provider.requests) assert.match(call.body.messages!.filter(message => message.role === 'user').map(message => providerMessageText(message.content)).join('\n'), /项目整体采用TOC\/TP/);
  assert.deepEqual(provider.errors, []);
});

test('A12: the synthesis Task reads an exact dimension report through actual Pi and excludes unbound project files', { timeout: 40_000 }, async t => {
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost(); t.after(() => host.close());
  const request = async (route: string, method = 'GET', body?: unknown, status = 200) => { const response = await host.request(route, method, body); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await request('/api/configuration', 'PUT', { name: '合成综合模型', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-results', apiKey: 'synthetic-results-only' });
  const { project } = await request('/api/projects', 'POST', { name: '准确子成果' }, 201);
  const plan = { request: '核对两类事实，保留分歧', premises: [], materials: [], coverage: [], tasks: [{ key: 'dimension', name: '维度核查', selected: true, scope: '核对原始事实', capabilities: [] }, { key: 'summary', name: '项目综合', selected: true, scope: '综合并保留冲突', capabilities: [] }], taskMode: 'multi', summaryTaskKey: 'summary', dependencies: [{ from: 'dimension', to: 'summary', reason: '有据综合' }], caseContext: null };
  const base = `/api/projects/${project.id}/plan`;
  const draft = await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const created = await request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: draft.state.revision, mode: 'create' });
  const [dimension, summary] = created.confirmation.tasks;
  const reportText = '# 合成维度核查\n\n事实A与事实B存在口径分歧；不据此确定根因。';
  provider.setResponder(context => context.recentToolResults.length ? { text: '维度原稿已经保存。' } : { calls: [{ name: 'write_report', arguments: { filename: 'dimension.md', content: reportText } }] });
  const runTask = async (receipt: any, text: string) => {
    const route = `/api/projects/${project.id}/tasks/${receipt.taskId}`, requestId = randomUUID();
    await request(route + '/messages', 'POST', { text, requestId, projectPlan: { confirmationId: created.confirmation.id, taskKey: receipt.taskKey } }, 202);
    const deadline = Date.now() + 20_000;
    let state: any;
    do { state = await request(route); if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
    assert.equal(state.task.lastRun?.status, 'completed'); return state;
  };
  await runTask(dimension, '保存本维度准确成果。');
  await request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'unbound.md', text: '未绑定成果，不能猜归属' }, 201);
  let sourceId: string | undefined, observed: any;
  provider.setResponder(context => {
    if (!context.recentToolResults.length) { assert.ok(context.availableTools.includes('read_project_task_results')); return { calls: [{ name: 'read_project_task_results', arguments: { action: 'find', taskId: dimension.taskId } }] }; }
    const latest = JSON.parse(providerMessageText(context.recentToolResults.at(-1)!.content));
    if (latest.action === 'find') { assert.equal(latest.results.length, 1); assert.equal(latest.results[0].relativePath, '060_reports/dimension.md'); sourceId = latest.results[0].id; return { calls: [{ name: 'read_project_task_results', arguments: { action: 'read', id: sourceId } }] }; }
    observed = latest; return { text: '综合保留口径分歧，未把保存或单Task状态当成根因成立。' };
  });
  const state = await runTask(summary, '读取准确维度成果并综合，保留局限。');
  assert.equal(observed.text, reportText);
  assert.equal(observed.contentState, 'exact-bytes-verified');
  assert.equal(observed.result.taskId, dimension.taskId);
  const native = (await readFile(state.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const read = native.find(entry => entry.message?.role === 'toolResult' && entry.message.details?.action === 'read');
  assert.equal(read.message.details.result.id, sourceId);
  assert.equal(read.message.details.scope.confirmationId, created.confirmation.id);
  assert.deepEqual(provider.errors, []);
});

test('A07/A12: one confirmation starts both Tasks and the actual synthesis SDK call waits for a late exact dimension report', { timeout: 45_000 }, async t => {
  const directory = path.resolve('.local/overall-architecture-upgrade/development/project-synthesis-await'); await mkdir(directory, { recursive: true });
  const root = await mkdtemp(path.join(directory, 'one-confirm-')); t.diagnostic(root);
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
  const releaseDimension = deferred(), dimensionEntered = deferred(), summaryFindIssued = deferred();
  t.after(() => releaseDimension.resolve());
  const provider = await startToolProvider(); t.after(() => provider.close());
  await mkdir(path.join(root, 'host/pi'), { recursive: true }); await writeFile(path.join(root, 'host/pi/settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') }); t.after(() => host.close());
  t.after(() => writeFile(path.join(root, 'provider-observations.json'), JSON.stringify({ errors: provider.errors, requests: provider.requests.map(request => ({ path: request.path, body: request.body, closedEarly: request.closedEarly })), hostOutput: host.output() }, null, 2)));
  const mutations: string[] = [];
  const request = async (route: string, method = 'GET', body?: unknown, status = 200): Promise<any> => { if (method !== 'GET') mutations.push(`${method} ${route}`); const response = await host.request(route, method, body); assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  const entries = async (file: string): Promise<any[]> => (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  await request('/api/configuration', 'PUT', { name: '合成一次确认等待', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-await-summary', apiKey: 'synthetic-await-summary-only' });
  const { project } = await request('/api/projects', 'POST', { name: '维度迟到与项目综合' }, 201);
  const plan = { request: '维度与综合同时启动；综合按需有界等候准确成果，不由Host设置专业顺序', premises: ['仅使用合成固定资料'], materials: [], coverage: [], tasks: [{ key: 'dimension', name: '迟到维度', selected: true, scope: '保存合成维度原稿', capabilities: [] }, { key: 'summary', name: '准确综合', selected: true, scope: '通过原成果工具等候并读取已绑定维度报告，保留分歧', capabilities: [] }], taskMode: 'multi', summaryTaskKey: 'summary', dependencies: [{ from: 'dimension', to: 'summary', reason: 'Agent按需读取准确成果，不固定Host运行顺序' }], caseContext: null };
  const base = `/api/projects/${project.id}/plan`, saved = await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const reportText = '# 合成迟到维度\n\n维度A与维度B存在口径分歧，资料不足保留；该稿不确定根因。', reportSha256 = createHash('sha256').update(reportText).digest('hex');
  let found: any, read: any, dimensionSaved = false;
  provider.setResponder(async context => {
    const suppliedText = context.messages.filter(message => message.role === 'user').map(message => providerMessageText(message.content)).join('\n');
    const current = /"currentTask":\{"id":"([^"]+)","key":"(dimension|summary)"/.exec(suppliedText); assert.ok(current, 'identify the actual Task from its supplied project context, never a global response counter');
    const dimension = /"taskId":"([^"]+)","key":"dimension"/.exec(suppliedText); assert.ok(dimension);
    if (current[2] === 'dimension') {
      if (!context.recentToolResults.length) { dimensionEntered.resolve(); await releaseDimension.promise; return { calls: [{ name: 'write_report', arguments: { filename: 'late-dimension.md', content: reportText } }] }; }
      const savedText = providerMessageText(context.recentToolResults[0].content), marker = '准确回执：'; assert.ok(savedText.includes(marker));
      assert.equal(JSON.parse(savedText.slice(savedText.indexOf(marker) + marker.length)).sha256, reportSha256); dimensionSaved = true;
      return { text: '合成维度准确原稿已保存，分歧与不足仍保留。' };
    }
    assert.ok(context.availableTools.includes('read_project_task_results'));
    if (!context.recentToolResults.length) { summaryFindIssued.resolve(); return { calls: [{ name: 'read_project_task_results', arguments: { action: 'find', taskId: dimension[1], waitMs: 2000 } }] }; }
    const latest = JSON.parse(providerMessageText(context.recentToolResults.at(-1)!.content));
    if (latest.action === 'find') { found = latest; assert.equal(latest.results.length, 1); assert.equal(latest.results[0].taskId, dimension[1]); assert.equal(latest.results[0].sha256, reportSha256); return { calls: [{ name: 'read_project_task_results', arguments: { action: 'read', id: latest.results[0].id } }] }; }
    read = latest; assert.equal(latest.text, reportText); assert.equal(latest.contentState, 'exact-bytes-verified');
    return { text: '已读取准确维度稿综合；保留口径分歧、证据不足与根因未知，不把保存或启动视为专业正确。' };
  });
  const result = await request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: saved.state.revision, mode: 'start' });
  assert.deepEqual(result.confirmation.tasks.map((receipt: any) => receipt.startStatus), ['accepted', 'accepted']);
  const dimension = result.confirmation.tasks.find((receipt: any) => receipt.taskKey === 'dimension'), summary = result.confirmation.tasks.find((receipt: any) => receipt.taskKey === 'summary');
  await Promise.all([dimensionEntered.promise, summaryFindIssued.promise]);
  let pendingFind: any, summaryFile: string | undefined; const waitDeadline = Date.now() + 3000;
  do {
    const state = await request(`/api/projects/${project.id}/tasks/${summary.taskId}`); summaryFile = state.task.sessionFile;
    if (summaryFile) { const native = await entries(summaryFile), calls = native.flatMap(entry => entry.message?.role === 'assistant' && Array.isArray(entry.message.content) ? entry.message.content : []); pendingFind = calls.find(call => call.type === 'toolCall' && call.name === 'read_project_task_results' && call.arguments.action === 'find' && call.arguments.waitMs === 2000); if (pendingFind) { assert.equal(native.some(entry => entry.message?.role === 'toolResult' && entry.message.toolCallId === pendingFind.id), false, 'the bounded actual SDK find is still waiting before the dimension is released'); break; } }
    await delay(10);
  } while (Date.now() < waitDeadline);
  assert.ok(pendingFind, 'the summary must actually start find before the late writer is released'); assert.equal(dimensionSaved, false);
  releaseDimension.resolve();
  const evidence: unknown[] = [];
  for (const receipt of [dimension, summary]) {
    const deadline = Date.now() + 15_000; let state: any;
    do { state = await request(`/api/projects/${project.id}/tasks/${receipt.taskId}`); if (state.task.lastRun?.id === receipt.startRequestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
    assert.equal(state.task.lastRun?.status, 'completed'); const native = await entries(state.task.sessionFile), started = native.filter(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started' && entry.data.requestId === receipt.startRequestId);
    assert.equal(started.length, 1); assert.equal(started[0].data.providedContext.projectPlan.confirmationId, result.confirmation.id);
    if (receipt.taskKey === 'dimension') assert.ok(native.some(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'write_report' && entry.message.details?.sha256 === reportSha256));
    else { const exact = native.find(entry => entry.message?.role === 'toolResult' && entry.message.details?.action === 'read'); assert.equal(exact.message.details.result.id, found.results[0].id); assert.equal(exact.message.details.result.sha256, reportSha256); assert.equal(exact.message.details.result.taskId, dimension.taskId); }
    evidence.push({ taskKey: receipt.taskKey, taskId: receipt.taskId, requestId: receipt.startRequestId, nativeFile: state.task.sessionFile, nativeSha256: createHash('sha256').update(await readFile(state.task.sessionFile)).digest('hex'), startedEntryId: started[0].id });
  }
  assert.equal(dimensionSaved, true); assert.equal(read.text, reportText); assert.equal(found.results[0].id, read.result.id); assert.equal(provider.requests.length, 5); assert.deepEqual(provider.errors, []);
  assert.equal(mutations.filter(route => route.endsWith('/plan/confirm')).length, 1); assert.equal(mutations.some(route => /\/tasks\/[^/]+\/(messages|open)$/.test(route)), false); assert.equal(mutations.some(route => /\/tasks$/.test(route)), false);
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ confirmationId: result.confirmation.id, confirmStartCount: 1, directTaskCreatesOrStarts: 0, reportSha256, exactSourceId: read.result.id, summaryWaitMs: 2000, findToolCallId: pendingFind.id, noReportBeforeFind: true, providerRequests: provider.requests.length, native: evidence, professionalCorrectness: 'NOT_RUN', businessEffects: 'NOT_RUN' }, null, 2));
});
