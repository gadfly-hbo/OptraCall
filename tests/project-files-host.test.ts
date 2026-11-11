import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { createHost } from '../src/host/server.ts';
import { providerMessageText, startToolProvider, type SyntheticToolCall } from './fixtures/tool-provider.ts';

const model = 'synthetic-host-bound-files';
const boundTools = ['read_input', 'read_catalog', 'write_report'];
const originalTools = ['read', 'write', 'edit', 'bash', 'codemode'];

async function startHost(root: string) {
  const host = createHost({
    cwd: process.cwd(),
    uiPorts: [4183],
    transportVersion: 'synthetic-project-files-test',
    dataRoot: path.join(root, 'host'),
    projectsRoot: path.join(root, 'projects'),
  });
  await host.ready;
  await new Promise<void>(resolve => host.server.listen(0, '127.0.0.1', resolve));
  const address = host.server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  async function request(route: string, method = 'GET', body?: unknown, status = 200): Promise<any> {
    const response = await fetch(baseUrl + route, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', 'x-optracall-client': '1', origin: baseUrl },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${route}: ${text}`);
    return JSON.parse(text);
  }
  return { request, close: host.close };
}

type Host = Awaited<ReturnType<typeof startHost>>;

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'optracall-project-files-host-')));
  const provider = await startToolProvider();
  let host: Host | undefined;
  t.after(async () => {
    await host?.close();
    await provider.close();
    await rm(root, { recursive: true, force: true });
  });
  host = await startHost(root);
  await host.request('/api/configuration', 'PUT', {
    name: 'Synthetic bound-files model',
    provider: 'openai-compatible',
    baseUrl: provider.baseUrl,
    model,
    apiKey: 'synthetic-bound-files-only',
  });
  const { project } = await host.request('/api/projects', 'POST', { name: 'Synthetic bound-files project' }, 201);
  const tasksRoute = `/api/projects/${project.id}/tasks`;
  const { task } = await host.request(tasksRoute, 'POST', { name: 'Synthetic bound-files task' }, 201);
  return { root, host, provider, project, task, route: `${tasksRoute}/${task.id}` };
}

async function settled(host: Host, route: string, requestId: string) {
  const deadline = Date.now() + 20_000;
  do {
    const state = await host.request(route);
    if (state.task.lastRun?.id === requestId
      && state.task.lastRun.status !== 'running'
      && state.snapshot.status === 'idle') return state;
    await delay(25);
  } while (Date.now() < deadline);
  assert.fail('The synthetic bound-files Host task did not settle.');
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function parseNative(native: string): any[] {
  return native.trim().split('\n').map(line => JSON.parse(line));
}

function toolResults(native: any[]) {
  return native.filter(entry => entry.message?.role === 'toolResult').map(entry => entry.message);
}

function successfulReportReceipts(native: any[]) {
  return native.filter(entry => entry.customType === 'optracall.project-report-write').map(entry => entry.data);
}

function assertBinding(details: Record<string, unknown>, f: Fixture, requestId: string, sessionId: string, toolCallId: string) {
  assert.equal(details.projectId, f.project.id);
  assert.equal(details.taskId, f.task.id);
  assert.equal(details.requestId, requestId);
  assert.equal(details.sessionId, sessionId);
  assert.equal(details.toolCallId, toolCallId);
}

function assertReport(details: Record<string, unknown>, f: Fixture, filename: string, content: string) {
  assert.equal(details.schemaVersion, 1);
  assert.equal(details.filename, filename);
  assert.equal(details.relativePath, '060_reports/' + filename);
  assert.equal(details.path, path.join(f.project.rootPath, '060_reports', filename));
  assert.equal(details.bytes, Buffer.byteLength(content));
  assert.equal(details.sha256, createHash('sha256').update(content).digest('hex'));
}

async function upload(f: Fixture, name: string, content: string) {
  await f.host.request(`/api/projects/${f.project.id}/files/upload`, 'POST', {
    directory: '020_clean', name, content: Buffer.from(content).toString('base64'),
  }, 201);
}

async function installFixtureExtension(f: Fixture, name: string, source: string) {
  const extensions = path.join(f.root, 'host', 'pi', 'extensions');
  await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, name), source);
}

async function run(f: Fixture, text: string) {
  const requestId = randomUUID();
  await f.host.request(f.route + '/messages', 'POST', { text, requestId }, 202);
  const state = await settled(f.host, f.route, requestId);
  const native = await readFile(state.task.sessionFile, 'utf8');
  return { requestId, state, native, entries: parseNative(native) };
}

async function saveEvidence(t: TestContext, f: Fixture, result: Awaited<ReturnType<typeof run>>) {
  const evidenceRoot = process.env.OPTRACALL_HOST_BOUND_FILES_EVIDENCE;
  if (!evidenceRoot) return;
  await mkdir(evidenceRoot, { recursive: true });
  const evidencePath = path.resolve(evidenceRoot, `host-http-${Date.now()}-${result.requestId}.json`);
  await writeFile(evidencePath, JSON.stringify({
    test: t.name,
    projectId: f.project.id,
    taskId: f.task.id,
    requestId: result.requestId,
    native: result.native,
    requests: f.provider.requests,
    providerErrors: f.provider.errors,
    lastRun: result.state.task.lastRun,
  }, null, 2));
  t.diagnostic(`Native synthetic Host evidence: ${evidencePath}`);
}

test('Host/Pi exposes optional bound file tools and writes a Unicode report into the existing 060_reports', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  const filename = '销量对照 · 首稿.md';
  const content = '# Synthetic sales\n\n49 / 44 − 1 = 11.36%\n';
  f.provider.setResponder(context => context.recentToolResults.length
    ? { text: 'SYNTHETIC_BOUND_REPORT_COMPLETE' }
    : { calls: [{ name: 'write_report', arguments: { filename, content } }] });
  const result = await run(f, `Save this synthetic report as ${filename}.`);
  await saveEvidence(t, f, result);
  const actualTools = f.provider.requests[0].body.tools!.map(tool => tool.function!.name!);
  assert([...boundTools, ...originalTools].every(tool => actualTools.includes(tool)), `ordinary task is missing file tools: ${actualTools.join(', ')}`);
  assert.deepEqual(f.provider.errors, []);
  assert.equal(result.state.task.lastRun.status, 'completed');
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports', filename), 'utf8'), content);
  const [saved] = toolResults(result.entries);
  assert.equal(saved.toolName, 'write_report');
  assert.equal(saved.isError, false);
  assertBinding(saved.details, f, result.requestId, result.entries[0].id, saved.toolCallId);
  assertReport(saved.details, f, filename, content);
  assert.deepEqual(successfulReportReceipts(result.entries), [saved.details]);
});

test('Host/Pi reads 020_clean with native Bash and read pagination, and returns only enabled enterprise catalogue entries', { timeout: 35_000 }, async t => {
  const f = await fixture(t);
  const source = 'sku,units\nSYNTHETIC-SKU,49\n';
  const large = Array.from({ length: 2500 }, (_, index) =>
    'SYNTHETIC-LINE-' + String(index + 1).padStart(4, '0') + '-' + 'x'.repeat(64)).join('\n') + '\n';
  await upload(f, 'source.csv', source);
  await upload(f, 'long-source.txt', large);

  const catalogue = '/api/enterprise-materials';
  const { material: enabled } = await f.host.request(catalogue, 'POST', { title: 'SYNTHETIC_ENABLED_RULE', body: 'Enabled rule.' }, 201);
  await f.host.request(catalogue + '/' + enabled.id + '/enable', 'POST', { expectedVersion: enabled.version });
  const { material: draft } = await f.host.request(catalogue, 'POST', { title: 'SYNTHETIC_NEVER_ENABLED_RULE', body: 'Draft only.' }, 201);
  const { material: stopped } = await f.host.request(catalogue, 'POST', { title: 'SYNTHETIC_STOPPED_RULE', body: 'Stopped rule.' }, 201);
  const stoppedRoute = catalogue + '/' + stopped.id;
  const { material: wasEnabled } = await f.host.request(stoppedRoute + '/enable', 'POST', { expectedVersion: stopped.version });
  await f.host.request(stoppedRoute + '/disable', 'POST', { expectedVersion: wasEnabled.version });

  const calls: SyntheticToolCall[] = [
    { name: 'bash', arguments: { command: 'pwd\ncat source.csv' } },
    { name: 'read_input', arguments: { filename: 'source.csv' } },
    { name: 'read_input', arguments: { filename: 'long-source.txt' } },
    { name: 'read_input', arguments: { filename: 'long-source.txt', offset: 2498, limit: 3 } },
    { name: 'read_catalog', arguments: {} },
  ];
  f.provider.setResponder(context => {
    const call = calls[context.recentToolResults.length];
    return call ? { calls: [call] } : { text: 'SYNTHETIC_BOUND_READ_COMPLETE' };
  });
  const result = await run(f, 'Read the synthetic project inputs and the enabled enterprise catalogue.');
  await saveEvidence(t, f, result);
  assert.deepEqual(f.provider.errors, []);
  assert.equal(result.state.task.lastRun.status, 'completed');
  assert.equal(f.provider.requests.length, calls.length + 1);
  const results = toolResults(result.entries);
  assert.deepEqual(results.map(message => [message.toolName, message.isError]), calls.map(call => [call.name, false]));
  const [bash, input, head, tail, index] = results;
  assert.match(providerMessageText(bash.content), /SYNTHETIC-SKU,49/);
  assert(providerMessageText(bash.content).includes(path.join(f.project.rootPath, '020_clean')));
  assert.equal(providerMessageText(input.content).trimEnd(), source.trimEnd());
  const firstPage = providerMessageText(head.content);
  assert.match(firstPage, /SYNTHETIC-LINE-0001/);
  assert.doesNotMatch(firstPage, /SYNTHETIC-LINE-2500/);
  assert.match(firstPage, /offset|limit/i, 'Pi supplies continuation information for truncated text');
  const finalPage = providerMessageText(tail.content);
  assert.match(finalPage, /SYNTHETIC-LINE-2498[\s\S]*SYNTHETIC-LINE-2499[\s\S]*SYNTHETIC-LINE-2500/);
  assert.doesNotMatch(finalPage, /SYNTHETIC-LINE-2497/);
  assert.equal(tail.details.relativePath, '020_clean/long-source.txt');
  assert.equal(tail.details.bytes, Buffer.byteLength(large));
  assert.equal(tail.details.sha256, createHash('sha256').update(large).digest('hex'));
  for (const message of [input, head, tail, index]) {
    assertBinding(message.details, f, result.requestId, result.entries[0].id, message.toolCallId);
  }
  const catalogueText = providerMessageText(index.content);
  assert(catalogueText.includes(enabled.id));
  assert.match(catalogueText, /SYNTHETIC_ENABLED_RULE/);
  assert(!catalogueText.includes(draft.id) && !catalogueText.includes(stopped.id));
  assert.doesNotMatch(catalogueText, /SYNTHETIC_NEVER_ENABLED_RULE|SYNTHETIC_STOPPED_RULE/);
});

test('Host/Pi keeps nested write_report receipts, rejects same-name overwrites, and allows ordinary report writes', { timeout: 35_000 }, async t => {
  const f = await fixture(t);
  await upload(f, 'source.csv', 'sku,units\nSYNTHETIC,44\n');
  const nativeObservation = path.join(f.root, 'nested-native-result.json');
  await installFixtureExtension(f, 'observe-bound-context.ts', `
    import { writeFileSync } from 'node:fs';
    export default pi => pi.on('tool_result', event => {
      if (event.toolName === 'write_report' && event.parentToolCallId) {
        writeFileSync(${JSON.stringify(nativeObservation)}, JSON.stringify(event));
      }
    });
  `);
  const filename = '自主文件名 · 周报.md';
  const content = '# 合成周报\n\n销量 44 件。\n';
  const ordinaryFilename = '普通写入.md';
  const ordinaryContent = '# 普通 write 仍可出稿\n';
  const code = 'await tools.read_input({ filename: "source.csv" }); ' +
    'const receipt = await tools.write_report(' + JSON.stringify({ filename, content }) + '); text(receipt);';
  const calls: SyntheticToolCall[] = [
    { name: 'codemode', arguments: { code } },
    { name: 'write_report', arguments: { filename, content: 'must not overwrite' } },
    { name: 'write', arguments: { path: path.join(f.project.rootPath, '060_reports', ordinaryFilename), content: ordinaryContent } },
  ];
  f.provider.setResponder(context => {
    const call = calls[context.recentToolResults.length];
    return call ? { calls: [call] } : { text: 'SYNTHETIC_CHOICE_COMPLETE' };
  });
  const result = await run(f, 'Choose an appropriate filename yourself and save a synthetic weekly report.');
  await saveEvidence(t, f, result);
  assert.deepEqual(f.provider.errors, []);
  assert.equal(result.state.task.lastRun.status, 'completed');
  const [nested, duplicate, ordinary] = toolResults(result.entries);
  assert.deepEqual([nested.toolName, duplicate.toolName, ordinary.toolName], ['codemode', 'write_report', 'write']);
  assert.equal(nested.isError, false);
  assert.deepEqual(nested.nestedCalls.calls.map((entry: any) => [entry.name, entry.status]), [['read_input', 'ok'], ['write_report', 'ok']]);
  assert(providerMessageText(nested.content).includes(path.join(f.project.rootPath, '060_reports', filename)));
  const observed = JSON.parse(await readFile(nativeObservation, 'utf8'));
  assert.equal(observed.parentToolCallId, nested.toolCallId);
  assert.equal(observed.toolCallId, nested.toolCallId + '/2');
  assert.equal(observed.toolCallId, nested.nestedCalls.calls[1].id);
  assertBinding(observed.details, f, result.requestId, result.entries[0].id, observed.toolCallId);
  assertReport(observed.details, f, filename, content);
  assert.deepEqual(successfulReportReceipts(result.entries), [observed.details], 'nested success persists once, collision and ordinary write do not add bound receipts');
  assert.equal(duplicate.isError, true);
  assert.match(providerMessageText(duplicate.content), /exists|conflict|同名|已存在/i);
  assert.equal(ordinary.isError, false);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports', filename), 'utf8'), content);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports', ordinaryFilename), 'utf8'), ordinaryContent);
  const system = f.provider.requests[0].body.messages!.filter(message => message.role === 'system').map(message => providerMessageText(message.content)).join('\n');
  assert.doesNotMatch(system, /(?:must|required to|必须|务必)[^\n]{0,45}write_report|write_report[^\n]{0,45}(?:mandatory|required|必须)/i);
});

test('Host/Pi stop and same-session continuation do not let an old SDK tool context save a report', { timeout: 35_000 }, async t => {
  const f = await fixture(t);
  const staleFile = 'must-not-save.md', freshFile = 'continued.md';
  await installFixtureExtension(f, 'stale-bound-context.ts', `
    export default pi => {
      const parameters = { type: 'object', properties: {}, additionalProperties: false };
      let oldContext;
      function tool(name, execute) {
        pi.registerTool({ name, label: name, description: 'Synthetic Host integration probe.', parameters, execute });
      }
      function response(text) {
        return { content: [{ type: 'text', text }], details: {} };
      }
      tool('capture_bound_context', async (_id, _args, _signal, _update, ctx) => {
        if (typeof ctx.executeTool !== 'function') throw new Error('Native SDK context does not expose executeTool.');
        oldContext = ctx;
        return response('SYNTHETIC_CONTEXT_CAPTURED');
      });
      tool('replay_bound_context', async () => {
        if (!oldContext) return response('SYNTHETIC_CONTEXT_MISSING');
        try {
          const result = await oldContext.executeTool('write_report', ${JSON.stringify({ filename: staleFile, content: 'Stale context must not publish.' })});
          return response(result.isError ? 'SYNTHETIC_STALE_CONTEXT_REJECTED' : 'SYNTHETIC_STALE_CONTEXT_EXECUTED');
        } catch {
          return response('SYNTHETIC_STALE_CONTEXT_REJECTED');
        }
      });
    };
  `);
  const fresh = '# Continued synthetic report\n';
  f.provider.setResponder(context => {
    const latestUser = context.messages.filter(message => message.role === 'user').at(-1);
    if (providerMessageText(latestUser?.content).includes('SYNTHETIC_STOP_TURN')) {
      if (!context.recentToolResults.length) return { calls: [{ name: 'capture_bound_context', arguments: {} }] };
      return { hold: true };
    }
    const steps: SyntheticToolCall[] = [
      { name: 'replay_bound_context', arguments: {} },
      { name: 'write_report', arguments: { filename: freshFile, content: fresh } },
    ];
    const call = steps[context.recentToolResults.length];
    return call ? { calls: [call] } : { text: 'SYNTHETIC_BOUND_CONTINUED' };
  });

  const stoppedRequestId = randomUUID();
  await f.host.request(f.route + '/messages', 'POST', { text: 'SYNTHETIC_STOP_TURN capture current context.', requestId: stoppedRequestId }, 202);
  await f.provider.waitForRequests(2);
  assert.match(providerMessageText(f.provider.requests[1].body.messages?.filter(message => message.role === 'tool').at(-1)?.content),
    /SYNTHETIC_CONTEXT_CAPTURED/);
  await f.host.request(f.route + '/stop', 'POST', {});
  const stopped = await settled(f.host, f.route, stoppedRequestId);
  assert.equal(stopped.task.lastRun.status, 'cancelled');
  const originalNative = parseNative(await readFile(stopped.task.sessionFile, 'utf8'));

  const result = await run(f, 'Continue the same synthetic session and save a fresh report.');
  await saveEvidence(t, f, result);
  assert.deepEqual(f.provider.errors, []);
  assert.equal(result.state.task.lastRun.status, 'completed');
  assert.equal(result.state.task.sessionFile, stopped.task.sessionFile);
  assert.equal(result.entries[0].id, originalNative[0].id);
  const messages = toolResults(result.entries);
  const replay = messages.find(message => message.toolName === 'replay_bound_context');
  assert.match(providerMessageText(replay?.content), /SYNTHETIC_STALE_CONTEXT_REJECTED/);
  const saved = messages.find(message => message.toolName === 'write_report');
  assert.equal(saved.isError, false);
  assertBinding(saved.details, f, result.requestId, result.entries[0].id, saved.toolCallId);
  assertReport(saved.details, f, freshFile, fresh);
  assert.deepEqual(successfulReportReceipts(originalNative), []);
  assert.deepEqual(successfulReportReceipts(result.entries), [saved.details]);
  assert.equal(await readFile(path.join(f.project.rootPath, '060_reports', freshFile), 'utf8'), fresh);
  await assert.rejects(readFile(path.join(f.project.rootPath, '060_reports', staleFile)), { code: 'ENOENT' });
});

test('Host/Pi does not advertise ordinary project file bindings in the requirements workspace', { timeout: 25_000 }, async t => {
  const f = await fixture(t);
  f.provider.setResponder(() => ({ text: JSON.stringify({
    clarifications: [{ category: '指标口径', priority: 'should_confirm', question: '需要核对哪些资料？', rationale: '仅澄清确实存在的缺口。' }],
    facts: [],
    hypotheses: [],
  }) }));
  const { instance } = await f.host.request('/api/requirement-instances', 'POST', { title: '合成需求梳理', scene: 'daily' }, 201);
  const generated = await f.host.request('/api/requirement-instances/' + instance.id + '/generate', 'POST', { call: 'elicit' });
  assert.equal(generated.repairAttempts, 0);
  assert.equal(generated.proposal.clarifications[0].question, '需要核对哪些资料？');
  assert.deepEqual(f.provider.errors, []);
  assert.equal(f.provider.requests.length, 1);
  const tools = f.provider.requests[0].body.tools ?? [];
  assert(!tools.some(tool => boundTools.includes(tool.function?.name ?? '')));
});
