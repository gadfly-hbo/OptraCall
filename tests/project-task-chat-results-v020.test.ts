import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startTestHost } from './fixtures/host-process.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';

test('PG04: a designated synthesis Task discovers and reads mixed file/chat results and distinguishes the exact confirmed request', { timeout: 45_000 }, async t => {
  const evidenceRoot = path.resolve('.local/overall-architecture-product-gaps/pm04'); await mkdir(evidenceRoot, { recursive: true });
  const evidence = await mkdtemp(path.join(evidenceRoot, 'host-pi-run-')); t.diagnostic(evidence);
  const provider = await startToolProvider(); t.after(() => provider.close());
  const host = await startTestHost({ dataRoot: path.join(evidence, 'host'), projectsRoot: path.join(evidence, 'projects') }); t.after(() => host.close());
  t.after(() => writeFile(path.join(evidence, 'host-pi-observations.json'), JSON.stringify({ providerErrors: provider.errors, requests: provider.requests.map(request => request.body), host: host.output() }, null, 2)));
  const request = async (route: string, method = 'GET', body?: unknown, expected = 200): Promise<any> => {
    const response = await host.request(route, method, body); assert.equal(response.status, expected, await response.clone().text()); return response.json();
  };
  await request('/api/configuration', 'PUT', { name: '合成聊天成果', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-chat-results', apiKey: 'synthetic-chat-results-only' });
  const { project } = await request('/api/projects', 'POST', { name: '混合准确成果' }, 201);
  const { task: chat } = await request(`/api/projects/${project.id}/tasks`, 'POST', { name: '短答维度' }, 201);
  const wait = async (taskId: string, requestId: string) => {
    const deadline = Date.now() + 20_000; let state: any;
    do { state = await request(`/api/projects/${project.id}/tasks/${taskId}`); if (state.task.lastRun?.id === requestId && state.task.lastRun.status !== 'running' && state.snapshot.status === 'idle') break; await delay(20); } while (Date.now() < deadline);
    assert.equal(state.task.lastRun?.status, 'completed'); return state;
  };
  const oldText = '旧请求只核到上一期，不能冒充本轮结果。';
  provider.setResponder(() => ({ text: oldText }));
  const oldRequestId = randomUUID();
  await request(`/api/projects/${project.id}/tasks/${chat.id}/messages`, 'POST', { text: '只用合成资料留下旧短答。', requestId: oldRequestId }, 202); await wait(chat.id, oldRequestId);
  const tasks = [
    { key: 'file', name: '文件维度', selected: true, scope: '保存有界文件证据', capabilities: [] },
    { key: 'chat', name: chat.name, taskId: chat.id, selected: true, scope: '直接回答，不要求报告、Case或记忆', capabilities: [] },
    { key: 'summary', name: '明确项目综合', selected: true, scope: '读取两个准确维度成果并保留分歧', capabilities: [] },
  ];
  const plan = { request: '综合文件与直接短答，保留新旧及证据限制', premises: ['仅合成资料'], materials: [], coverage: [], tasks, taskMode: 'multi', summaryTaskKey: 'summary', dependencies: [], caseContext: null };
  const base = `/api/projects/${project.id}/plan`, draft = await request(base + '/draft', 'POST', { operationId: randomUUID(), expectedRevision: 0, plan });
  const reportText = '# 文件维度\n\n销售额口径暂不支持直接归因。', chatText = '本轮短答：竞品资料仅支持关联，未验证因果。';
  let discovered: any, reportRead: any, chatRead: any;
  provider.setResponder(context => {
    const user = context.messages.filter(message => message.role === 'user').map(message => providerMessageText(message.content)).join('\n');
    const current = /"currentTask":\{"id":"([^"]+)","key":"(file|chat|summary)"/.exec(user); assert.ok(current);
    if (current[2] === 'file') return context.recentToolResults.length ? { text: '文件证据已保存。' } : { calls: [{ name: 'write_report', arguments: { filename: 'mixed-dimension.md', content: reportText } }] };
    if (current[2] === 'chat') return { text: chatText };
    if (!context.recentToolResults.length) return { calls: [{ name: 'read_project_task_results', arguments: { action: 'find', taskId: chat.id, waitMs: 2000 } }] };
    const latest = JSON.parse(providerMessageText(context.recentToolResults.at(-1)!.content));
    if (!discovered && latest.action === 'find') {
      if (!latest.results.some((result: any) => result.kind === 'native-reply')) { discovered = latest; return { text: '未取得准确无文件成果，保留缺口。' }; }
      if (!latest.results.some((result: any) => result.requestRelation === 'confirmed-request')) return { calls: [{ name: 'read_project_task_results', arguments: { action: 'find', taskId: chat.id, waitMs: 100 } }] };
      discovered = latest;
      const old = latest.results.find((result: any) => result.requestId === oldRequestId), currentReply = latest.results.find((result: any) => result.requestRelation === 'confirmed-request');
      assert.ok(old, 'the exact old request remains distinguishable'); assert.equal(old.requestRelation, 'other-saved-request');
      assert.equal(currentReply.kind, 'native-reply'); assert.equal(currentReply.source.expectedTextSha256, createHash('sha256').update(chatText).digest('hex'));
      assert.equal(JSON.stringify(latest).includes(chatText), false, 'discovery does not deliver a body');
      return { calls: [{ name: 'read_project_task_results', arguments: { action: 'read', id: currentReply.id } }] };
    }
    if (latest.action === 'read' && latest.result.kind === 'native-reply') { chatRead = latest; return { calls: [{ name: 'read_project_task_results', arguments: { action: 'find' } }] }; }
    if (latest.action === 'find') {
      const report = latest.results.find((result: any) => result.kind === 'report');
      if (!report) return { calls: [{ name: 'read_project_task_results', arguments: { action: 'find', waitMs: 100 } }] };
      return { calls: [{ name: 'read_project_task_results', arguments: { action: 'read', id: report.id } }] };
    }
    reportRead = latest; return { text: '已准确读取文件和本轮短答；旧短答未冒充本轮，口径分歧与因果未知保留。' };
  });
  const result = await request(base + '/confirm', 'POST', { operationId: randomUUID(), expectedRevision: draft.state.revision, mode: 'start' });
  const states = await Promise.all(result.confirmation.tasks.map((receipt: any) => wait(receipt.taskId, receipt.startRequestId)));
  assert.ok(discovered, 'the actual synthesis tool must discover native replies');
  assert.ok(discovered.results.some((result: any) => result.kind === 'native-reply'), 'the synthesis directory must expose accurate no-file replies');
  assert.equal(chatRead.text, chatText); assert.equal(chatRead.contentState, 'exact-native-reply-verified'); assert.equal(chatRead.complete, true);
  assert.equal(chatRead.result.requestId, result.confirmation.tasks.find((receipt: any) => receipt.taskKey === 'chat').startRequestId);
  assert.equal(reportRead.text, reportText); assert.equal(reportRead.contentState, 'exact-bytes-verified');
  const chatState = states.find((state: any) => state.task.id === chat.id), summaryState = states.find((state: any) => state.task.id === result.confirmation.tasks.find((receipt: any) => receipt.taskKey === 'summary').taskId);
  const native = (await readFile(chatState.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(native.some(entry => entry.customType === 'optracall.project-report-write' || entry.customType === 'optracall.analysis-delivery'), false, 'a normal answer needs no declaration, report, Case, or retention');
  const summaryNative = (await readFile(summaryState.task.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(summaryNative.some(entry => entry.message?.role === 'toolResult' && entry.message.details?.result?.source?.messageId === chatRead.result.messageId));
  assert.deepEqual(provider.errors, []);
  await writeFile(path.join(evidence, 'host-pi-receipt.json'), JSON.stringify({ confirmationId: result.confirmation.id, oldRequestId, chatReference: chatRead.result, reportReference: reportRead.result, actualSdkReads: 2, professionalQuality: 'NOT_RUN' }, null, 2));
});
