import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';

type WireMessage = { role: string; content?: unknown; tool_call_id?: string };
type RecordedRequest = { stage: string; body: { model?: string; messages?: WireMessage[] }; toolReply: boolean };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const textOf = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(part => part?.text ?? '').join('\n') : '';

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string) {
  const deadline = Date.now() + 35_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, `${label} did not settle: ${JSON.stringify(value)}`);
    await pause(25);
  }
}

/** Real SSE transport with a deliberately unsafe final answer after a tool's
 * executor disappears. The Host must preserve that missing result as failure. */
async function startMissingResultProvider(command: () => string) {
  const requests: RecordedRequest[] = [];
  let release!: () => void;
  const firstMayReply = new Promise<void>(resolve => { release = resolve; });
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body: RecordedRequest['body'] = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const lastUser = textOf(body.messages?.filter(message => message.role === 'user').at(-1)?.content);
      const stage = lastUser.includes('自动核算意见已交回原主Agent') ? 'author'
        : lastUser.includes('修订复查（已知作者信息，不是新冷读）') ? 'recheck'
          : lastUser.includes('独立核算任务：') ? 'cold'
            : lastUser.includes('首次回复已保存。现在开放以下固定作者副本') ? 'compare' : 'ordinary';
      const record = { stage, body, toolReply: body.messages?.at(-1)?.role === 'tool' };
      requests.push(record);
      if (requests.length === 1) await firstMayReply;
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: `unknown-host-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      send({ role: 'assistant', content: '' });
      if (requests.length === 1 && stage === 'ordinary') {
        send({ tool_calls: [{ index: 0, id: 'destroy-own-executor', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: command() }) } }] });
        send({}, 'tool_calls');
      } else {
        send({ content: 'SYNTHETIC_FINAL_AFTER_MISSING_TOOL_RESULT：此合成最终回复不得掩盖工具结果未知。' }); send({}, 'stop');
      }
      response.write('data: [DONE]\n\n'); response.end();
    } catch (error) { response.destroy(error instanceof Error ? error : undefined); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { requests, release, baseUrl: `http://127.0.0.1:${address.port}/v1`, close: () => new Promise<void>(resolve => { release(); server.close(() => resolve()); server.closeAllConnections(); }) };
}

test('a missing managed tool result stays failed through HTTP task/native readback and cannot dispatch automatic verification', { skip: process.platform !== 'darwin', timeout: 60_000 }, async t => {
  const runRoot = path.resolve('.local/managed-execution-optimization/worker', 'host-unknown-' + randomUUID());
  await mkdir(runRoot, { recursive: true });
  let command = '', nativeFile: string | undefined, prefix: Buffer | undefined, finalTask: any, automaticStatus: any, chains: any[] = [];
  const provider = await startMissingResultProvider(() => command);
  const host = await startTestHost({ dataRoot: path.join(runRoot, 'host'), projectsRoot: path.join(runRoot, 'projects') });
  t.after(async () => {
    const closed = await Promise.allSettled([host.close(), provider.close()]);
    await writeFile(path.join(runRoot, 'receipt.json'), JSON.stringify({ scope: 'SYNTHETIC_HTTP_REAL_SDK_ONLY', command, nativeFile, prefixBytes: prefix?.length, prefixSha256: prefix && sha(prefix), requests: provider.requests, finalTask, automaticStatus, chains, shutdown: closed.map(value => value.status), hostOutput: host.output() }, null, 2));
    for (const result of closed) if (result.status === 'rejected') throw result.reason;
  });
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'Missing tool result synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-missing-result', apiKey: 'synthetic-only-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: '缺失工具结果合成项目' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: '受管结果未知任务' }), 201);
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`, route = taskRoute + '/automatic-verification';
  const capability = await readJson(await host.request(`${route}/capabilities`));
  if (!capability.supported) { t.skip(`NOT_RUN: ${capability.reason ?? 'managed execution unavailable'}`); return; }
  const source = Buffer.from('id,amount\nsynthetic-a,42\n'), original = Buffer.from('# 合成旧报告\n原稿保留。\n');
  await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: 'source.csv', content: source.toString('base64') }), 201);
  await readJson(await host.request(`/api/projects/${project.id}/files/save-report`, 'POST', { name: 'original.md', text: original.toString() }), 201);
  await readJson(await host.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings: { enabled: true, question: '仅合成资料，工具结果未知不可继续交接。', dataFiles: ['020_clean/source.csv'], reportPath: '060_reports/initial.md', processFiles: [], maxAuthorTurns: 1 } }));
  const newReport = '# 合成新报告\n工具已开始，但其最终结果丢失。\n';
  // Create a real changed report before losing the result, so a false ordinary
  // success cannot be hidden by report_missing/report_unchanged admission.
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  command = `printf %s ${quote(newReport)} > ${quote(path.join(project.rootPath, '060_reports', 'initial.md'))}; kill -KILL "$PPID"`;
  const requestId = randomUUID();
  await readJson(await host.request(`${taskRoute}/messages`, 'POST', { requestId, text: 'SYNTHETIC_MISSING_EXECUTOR_RESULT：运行本次合成工具检查，然后给出最终回复。' }), 202);
  await until(async () => provider.requests.length, count => count === 1, 'first model request');
  const started = await until(async () => readJson(await host.request(taskRoute)), value => typeof value.task.sessionFile === 'string', 'native session registration');
  nativeFile = started.task.sessionFile; prefix = await readFile(nativeFile!);
  assert.ok(prefix.length > 0);
  provider.release();
  finalTask = await until(async () => readJson(await host.request(taskRoute)), value => value.task.lastRun?.id === requestId && value.task.lastRun.status !== 'running', 'failed task readback');
  automaticStatus = await readJson(await host.request(`${route}/status`));
  chains = (await readJson(await host.request(`${route}/chains`))).chains;
  assert.ok(['failed', 'unknown'].includes(finalTask.task.lastRun.status), JSON.stringify(finalTask.task.lastRun));
  assert.equal(finalTask.task.sessionFile, nativeFile);
  const nativeBytes = await readFile(nativeFile!);
  assert.deepEqual(nativeBytes.subarray(0, prefix.length), prefix, 'accepted native prefix must remain byte-for-byte intact');
  const nativeEntries = nativeBytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  const settled = nativeEntries.filter(entry => entry.customType === 'optracall.run' && entry.data?.phase === 'settled' && entry.data.requestId === requestId);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].data.outcome, 'failed', 'the SDK final answer cannot promote a missing tool result to native success');
  assert.ok(nativeEntries.some(entry => entry.type === 'message' && JSON.stringify(entry.message).includes('SYNTHETIC_FINAL_AFTER_MISSING_TOOL_RESULT')));
  assert.equal(automaticStatus.observation?.requestId, requestId);
  assert.equal(chains.some(chain => chain.requestId === requestId && chain.steps?.some((step: any) => ['cold', 'compare', 'author', 'recheck'].includes(step.phase))), false);
  assert.equal(provider.requests.length, 2, 'one tool request and its final response only; no Host replay');
  assert.deepEqual(provider.requests.map(value => value.stage), ['ordinary', 'ordinary']);
  assert.equal(provider.requests[1]!.toolReply, true);
  assert.match(JSON.stringify(provider.requests[1]!.body.messages?.filter(message => message.role === 'tool')), /protected_executor_failed|result_unknown/);
  assert.deepEqual(await readFile(path.join(project.rootPath, '020_clean', 'source.csv')), source);
  assert.deepEqual(await readFile(path.join(project.rootPath, '060_reports', 'original.md')), original);
  assert.equal(await readFile(path.join(project.rootPath, '060_reports', 'initial.md'), 'utf8'), newReport);
  // Further public reads may project the recorded failure; they cannot replay
  // the tool/model or use resource closure to start another analysis phase.
  await readJson(await host.request(taskRoute)); await readJson(await host.request(`${route}/status`));
  await pause(100);
  assert.equal(provider.requests.length, 2);
});
