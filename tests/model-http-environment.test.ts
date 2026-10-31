import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectAgent, type ProjectEvent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';

async function fixture(t: TestContext, respond: (response: ServerResponse) => void, settings: Record<string, unknown> = {}) {
  const parent = path.resolve('.local/agent-output-reliability/transport');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'sdk-http-'));
  const resourceRoot = path.join(root, 'resources'), projectDirectory = path.join(root, 'project');
  for (const directory of [resourceRoot, ...['010_draw', '020_clean', '060_reports'].map(name => path.join(projectDirectory, name))]) await mkdir(directory, { recursive: true });
  await writeFile(path.join(resourceRoot, 'settings.json'), JSON.stringify({ ...settings, retry: settings.retry ?? { enabled: false } }));
  let requests = 0;
  const server = createServer(async (request, response) => { for await (const _chunk of request) { /* Consume only synthetic request bytes. */ } requests++; respond(response); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const options: ProjectAgentOptions = { projectId: 'owned-http-environment', projectDirectory, sessionDirectory: path.join(root, 'sessions'), resourceRoot, codeRoot: process.cwd(), managementPorts: [], configuration: { id: 'owned-http', revision: 1, provider: 'synthetic', api: 'openai-completions', name: 'Owned HTTP fixture', model: 'synthetic-http-model', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'synthetic-http-key' } };
  const agent = new ProjectAgent(options);
  const events: ProjectEvent[] = []; agent.subscribe(event => events.push(event));
  t.after(async () => { await agent.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { agent, root, events, options, requests: () => requests };
}
function start(response: ServerResponse) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'synthetic-provider-request' });
  response.write('data: ' + JSON.stringify({ id: 'owned', object: 'chat.completion.chunk', created: 1, model: 'synthetic-http-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Beginning. ' }, finish_reason: null }] }) + '\n\n');
}
function finish(response: ServerResponse) {
  response.write('data: ' + JSON.stringify({ id: 'owned', object: 'chat.completion.chunk', created: 1, model: 'synthetic-http-model', choices: [{ index: 0, delta: { content: 'Completed after a valid stream gap.' }, finish_reason: null }] }) + '\n\n');
  response.write('data: ' + JSON.stringify({ id: 'owned', object: 'chat.completion.chunk', created: 1, model: 'synthetic-http-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n');
  response.end('data: [DONE]\n\n');
}

test('OR01: SDK worker preserves a valid response with a body gap longer than thirty seconds', { timeout: 50_000 }, async t => {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  const f = await fixture(t, response => { start(response); timers.add(setTimeout(() => finish(response), 33_000)); });
  await f.agent.open();
  const result = await f.agent.start('Synthetic transport check only; choose no tools.', randomUUID()).completion;
  await writeFile(path.join(f.root, 'long-gap-result.json'), JSON.stringify({ outcome: result.outcome, diagnostic: result.diagnostic, requests: f.requests() }, null, 2));
  assert.equal(result.outcome, 'completed', 'A stream still within the SDK-supported idle interval must not be cut off by Host transport');
  assert.match(result.text, /Completed after a valid stream gap/);
  assert.equal(f.requests(), 1, 'Transport compatibility must not depend on retrying a completed request');
  const snapshot = await f.agent.snapshot();
  assert.equal(snapshot.lastRun?.outcome, 'completed');
  const native = await readFile(snapshot.sessionFile!, 'utf8');
  assert.doesNotMatch(native, /"errorMessage":"terminated"/);
  const observed = native.trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.customType === 'optracall.http');
  assert.equal(observed.length, 1);
  assert.equal(observed[0].data.phase, 'completed');
  assert.equal(observed[0].data.timeouts.bodyIdleTimeoutMs, 300_000);
  assert.equal(observed[0].data.providerRequestId, 'synthetic-provider-request');
  assert.ok(Date.parse(observed[0].data.lastBodyAt) - Date.parse(observed[0].data.firstBodyAt) >= 32_000);
});

test('OR02: explicit SDK idle timeout records safe cause and timestamps and survives reopen without replay', { timeout: 15_000 }, async t => {
  const f = await fixture(t, response => start(response), { httpIdleTimeoutMs: 200 });
  await f.agent.open();
  const result = await f.agent.start('Synthetic bounded idle failure.', randomUUID()).completion;
  assert.equal(result.outcome, 'failed');
  assert.equal(result.diagnostic?.code, 'http_body_timeout');
  assert.equal(result.diagnostic?.retryCount, 0);
  const snapshot = await f.agent.snapshot(), native = await readFile(snapshot.sessionFile!);
  const records = native.toString('utf8').trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.customType === 'optracall.http');
  assert.equal(records.length, 1);
  const record = records[0].data;
  assert.equal(record.causeCode, 'UND_ERR_BODY_TIMEOUT');
  assert.equal(record.timeouts.bodyIdleTimeoutMs, 200);
  assert.equal(record.timeouts.headersTimeoutMs, 200);
  assert.equal(record.statusCode, 200);
  assert.equal(record.providerRequestId, 'synthetic-provider-request');
  assert.ok(Date.parse(record.endedAt) >= Date.parse(record.lastBodyAt));
  assert.ok(Date.parse(record.lastBodyAt) >= Date.parse(record.firstBodyAt));
  assert.equal(f.requests(), 1);
  await f.agent.close();
  assert.deepEqual(await readFile(snapshot.sessionFile!), native, 'Closing must not alter fixed native evidence');
  const reopened = new ProjectAgent({ ...f.options, sessionFile: snapshot.sessionFile });
  t.after(() => reopened.close());
  const after = await reopened.open();
  assert.deepEqual(after.lastRun, snapshot.lastRun);
  assert.deepEqual(await readFile(snapshot.sessionFile!), native, 'Reopen must not migrate old/custom receipt bytes');
  assert.equal(f.requests(), 1, 'Diagnostic readback does not replay a model request');
});

test('OR01/OR02: received heartbeats keep an SDK stream alive beyond its body idle interval', { timeout: 15_000 }, async t => {
  let interval: ReturnType<typeof setInterval> | undefined, end: ReturnType<typeof setTimeout> | undefined;
  t.after(() => { clearInterval(interval); clearTimeout(end); });
  const f = await fixture(t, response => {
    start(response);
    interval = setInterval(() => response.write(': owned heartbeat\n\n'), 100);
    end = setTimeout(() => { clearInterval(interval); finish(response); }, 1600);
  }, { httpIdleTimeoutMs: 800 });
  await f.agent.open();
  const result = await f.agent.start('Synthetic heartbeat response.', randomUUID()).completion;
  assert.equal(result.outcome, 'completed');
  assert.equal(f.requests(), 1);
});

test('OR02: stop cancels the matching request and does not attach its transport failure to a later explicit request', { timeout: 15_000 }, async t => {
  let complete = false;
  const f = await fixture(t, response => { start(response); if (complete) finish(response); });
  await f.agent.open();
  const firstId = randomUUID(), first = f.agent.start('Synthetic request to stop.', firstId);
  while (f.requests() === 0) await new Promise(resolve => setTimeout(resolve, 5));
  await f.agent.stop();
  assert.equal((await first.completion).outcome, 'cancelled');
  complete = true;
  const nextId = randomUUID(), next = await f.agent.start('Explicit new request after cancellation.', nextId).completion;
  assert.equal(next.outcome, 'completed');
  assert.equal(next.diagnostic, undefined);
  assert.equal(f.requests(), 2);
  const snapshot = await f.agent.snapshot();
  assert.equal(snapshot.lastRun?.requestId, nextId);
  const records = (await readFile(snapshot.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.customType === 'optracall.http');
  assert.ok(records.every(entry => entry.data.requestId === firstId || entry.data.requestId === nextId));
  const last = records.at(-1)!;
  assert.equal(last.data.requestId, nextId); assert.equal(last.data.phase, 'completed');
  assert.ok(!JSON.stringify(records).includes('synthetic-http-key'));
  for (const record of records) for (const forbidden of ['headers', 'body', 'url', 'path', 'message', 'stack', 'cause']) assert.equal(record.data[forbidden], undefined);
});

test('OR02: remote closure is distinguished from idle expiry and known secrets/unsafe headers are excluded', { timeout: 15_000 }, async t => {
  let end: ReturnType<typeof setTimeout> | undefined;
  t.after(() => clearTimeout(end));
  const f = await fixture(t, response => {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'synthetic-http-key', 'x-private-detail': 'PRIVATE_HTTP_HEADER_DO_NOT_LOG' });
    response.write(': initial provider heartbeat\n\n');
    end = setTimeout(() => response.destroy(), 30);
  });
  await f.agent.open();
  const result = await f.agent.start('Synthetic deliberate remote disconnect.', randomUUID()).completion;
  assert.equal(result.outcome, 'failed');
  assert.equal(result.diagnostic?.code, 'http_connection_closed');
  const snapshot = await f.agent.snapshot();
  const records = (await readFile(snapshot.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.customType === 'optracall.http');
  assert.equal(records.length, 1);
  assert.equal(records[0].data.causeCode, 'UND_ERR_SOCKET');
  assert.ok(!JSON.stringify(records).includes('synthetic-http-key'));
  assert.ok(!JSON.stringify(records).includes('PRIVATE_HTTP_HEADER_DO_NOT_LOG'));
  assert.equal(f.requests(), 1);
});

test('OR02: existing finite SDK retry keeps separate observations and successful recovery does not retain a stale timeout cause', { timeout: 15_000 }, async t => {
  let first = true;
  const f = await fixture(t, response => { start(response); if (first) first = false; else finish(response); }, { httpIdleTimeoutMs: 200, retry: { enabled: true, maxRetries: 1, baseDelayMs: 5 } });
  await f.agent.open();
  const requestId = randomUUID(), result = await f.agent.start('Synthetic SDK-controlled retry.', requestId).completion;
  assert.equal(result.outcome, 'completed');
  assert.equal(result.diagnostic?.code, 'completed_after_retry');
  assert.equal(result.diagnostic?.retryCount, 1);
  assert.equal(f.requests(), 2);
  const snapshot = await f.agent.snapshot();
  const records = (await readFile(snapshot.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.customType === 'optracall.http');
  assert.deepEqual(records.map(entry => entry.data.phase), ['failed', 'completed']);
  assert.deepEqual(records.map(entry => entry.data.attempt), [1, 2]);
  assert.ok(records.every(entry => entry.data.requestId === requestId));
  assert.equal(records[1].data.causeCode, undefined);
});
