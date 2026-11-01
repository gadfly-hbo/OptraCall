import test from 'node:test';
import assert from 'node:assert/strict';
import { ChildProcess, execFile } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { ProjectAgent } from '../src/agent/project-runtime.ts';
import { createProtectedExecutionScope } from '../src/agent/protected-tools.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const runFile = promisify(execFile);
const evidenceBase = path.resolve('.local/managed-execution-optimization/stop-diagnosis');
const sourceText = 'SYNTHETIC_READ_BEFORE_STOP\n' + ('synthetic padding '.repeat(25) + '\n').repeat(100);
const imageStress = process.env.OPTRACALL_STOP_HELD_TEXT !== '1';
// Native read detects PNG signatures independently of a filename extension.
const sourceName = 'source.txt';
function sourceBytes() {
  if (!imageStress) return Buffer.from(sourceText);
  // A deterministic valid RGB PNG leaves a large real image result in native
  // history and the normal IPC snapshot; no transport response is fabricated.
  const size = 1024, pixels = Buffer.alloc((size * 3 + 1) * size);
  let state = 0x13579bdf;
  for (let y = 0; y < size; y++) for (let x = 1; x <= size * 3; x++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; pixels[y * (size * 3 + 1) + x] = state & 255; }
  const crc = (bytes: Buffer) => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([length, name, data, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string) {
  const deadline = Date.now() + 20_000;
  for (;;) { const value = await read(); if (ready(value)) return value; assert.ok(Date.now() < deadline, `${label}: ${JSON.stringify(value)}`); await pause(10); }
}
const nativeRecords = async (file: string) => (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
async function ownedProcesses(root: string, pids: number[] = []) {
  const { stdout } = await runFile('/bin/ps', ['-axo', 'pid=,ppid=,stat=,command=']);
  const rows = stdout.split('\n').filter(Boolean).map(line => { const [pid, ppid] = line.trim().split(/\s+/); return { pid: Number(pid), ppid: Number(ppid), line }; });
  const selected = new Set(pids);
  for (const row of rows) if (row.line.includes(root)) selected.add(row.pid);
  let changed = true;
  while (changed) { changed = false; for (const row of rows) if (selected.has(row.ppid) && !selected.has(row.pid)) { selected.add(row.pid); changed = true; } }
  return rows.filter(row => selected.has(row.pid)).map(row => row.line);
}

/** Only public ChildProcess transport events, without message bodies/keys. */
function traceDriverTransport() {
  const trace: Record<string, unknown>[] = [], pids = new Set<number>();
  const emit = ChildProcess.prototype.emit, senders = new Map<ChildProcess, ChildProcess['send']>();
  const relevant = (child: ChildProcess) => child.spawnargs?.some(value => value.endsWith('/scripts/project-entry.mjs'));
  ChildProcess.prototype.emit = function (event: string, ...args: any[]) {
    if (relevant(this)) {
      if (this.pid) pids.add(this.pid);
      // Node installs an own send method for IPC children. Capture that public
      // transport once, before ProjectAgent sends its first RPC after ready.
      if (typeof this.send === 'function' && !senders.has(this)) {
        const send = this.send; senders.set(this, send);
        (this as any).send = (message: any, ...values: any[]) => {
          trace.push({ at: performance.now(), direction: 'sent', pid: this.pid, kind: message?.kind, id: message?.id, method: message?.method });
          const callback = values.at(-1);
          if (typeof callback === 'function') values[values.length - 1] = (error: any) => { trace.push({ at: performance.now(), direction: 'send-callback', pid: this.pid, id: message?.id, errorCode: error?.code }); callback(error); };
          return (send as any).call(this, message, ...values);
        };
      }
      if (event === 'message') {
        const message = args[0];
        trace.push({ at: performance.now(), direction: 'received', pid: this.pid, kind: message?.kind, id: message?.id, event: message?.event?.type, requestId: message?.event?.requestId, outcome: message?.event?.outcome, closed: message?.result?.closed, error: message?.error, detailCode: message?.detail?.code, detailMessage: message?.detail?.message });
      } else if (['exit', 'close', 'disconnect', 'error'].includes(event)) trace.push({ at: performance.now(), pid: this.pid, event, code: typeof args[0] === 'number' ? args[0] : undefined, signal: args[1] });
    }
    return emit.call(this, event, ...args);
  };
  return { trace, pids, restore() { ChildProcess.prototype.emit = emit; for (const [child, send] of senders) child.send = send; } };
}

async function heldAfterReadProvider(sourcePath: () => string) {
  const requests: { toolReply: boolean; roles: string[]; toolContent?: string }[] = [];
  const responses = new Set<ServerResponse>(), timers = new Set<ReturnType<typeof setInterval>>();
  let heartbeats = 0;
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const messages = body.messages ?? [], toolReply = messages.at(-1)?.role === 'tool';
      const record = { toolReply, roles: messages.map((value: any) => value.role), ...(toolReply ? { toolContent: JSON.stringify(messages.at(-1)?.content).slice(0, 250) } : {}) };
      requests.push(record); responses.add(response); response.on('close', () => responses.delete(response));
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      const send = (delta: unknown, finish: string | null = null) => response.write(`data: ${JSON.stringify({ id: `held-stop-${requests.length}`, object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      send({ role: 'assistant', content: '' });
      if (requests.length === 1) {
        send({ tool_calls: [{ index: 0, id: 'first-read', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: sourcePath() }) } }] });
        send({}, 'tool_calls'); response.end('data: [DONE]\n\n');
      } else {
        const timer = setInterval(() => { if (!response.destroyed) { heartbeats++; response.write(': synthetic held-final heartbeat\n\n'); } }, 50);
        timers.add(timer); response.on('close', () => { clearInterval(timer); timers.delete(timer); });
      }
    } catch (error) { response.destroy(error instanceof Error ? error : undefined); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { requests, baseUrl: `http://127.0.0.1:${address.port}/v1`, waitHeld: () => until(async () => ({ count: requests.length, heartbeats }), value => value.count === 2 && value.heartbeats >= 2, 'held final response'), close: () => new Promise<void>(resolve => { for (const timer of timers) clearInterval(timer); for (const response of responses) response.destroy(); server.close(() => resolve()); server.closeAllConnections(); }) };
}

test('managed ProjectAgent stop after a read acknowledges close while the final model stream is held', { skip: process.platform !== 'darwin', timeout: 40_000 }, async t => {
  const root = path.join(evidenceBase, 'direct-' + randomUUID());
  const projectDirectory = path.join(root, 'project'), clean = path.join(projectDirectory, '020_clean'), reports = path.join(projectDirectory, '060_reports'), raw = path.join(projectDirectory, '010_draw');
  const work = path.join(root, 'work'), sessionDirectory = path.join(root, 'native'), resourceRoot = path.join(root, 'resources');
  for (const directory of [clean, reports, raw, work, sessionDirectory, resourceRoot]) await mkdir(directory, { recursive: true, mode: 0o700 });
  const source = path.join(clean, sourceName), bytes = sourceBytes(); await writeFile(source, bytes);
  const provider = await heldAfterReadProvider(() => source), transport = traceDriverTransport();
  const scope = await createProtectedExecutionScope({ id: 'held-stop-' + randomUUID(), profile: 'ordinary', cwd: clean, writableRoot: work, writeRoots: [clean, reports], readRoots: [raw, clean, reports] });
  const agent = new ProjectAgent({ projectId: randomUUID(), projectDirectory, sessionDirectory, resourceRoot, codeRoot: process.cwd(), managementPorts: [], protectedExecution: scope, configuration: { id: randomUUID(), revision: 1, name: 'held stop synthetic', provider: 'openai-compatible', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'synthetic-held-stop', apiKey: 'synthetic-held-stop-key' } });
  let stopError: unknown, closeError: unknown, result: unknown, before: string[] = [], after: string[] = [], records: any[] = [];
  t.after(async () => {
    await agent.close().catch(error => { closeError = String(error); }); await provider.close(); transport.restore();
    const completed = (result as any)?.value;
    await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ root, sourceKind: imageStress ? 'png' : 'text', stopError: stopError && String(stopError), closeError, result: completed ? { outcome: completed.outcome, diagnostic: completed.diagnostic, snapshotStatus: completed.snapshot?.status } : result, alive: agent.alive, requests: provider.requests, before, after, records: records.filter(entry => entry.customType === 'optracall.run' || entry.customType === 'optracall.execution'), trace: transport.trace }, null, 2));
  });
  const opened = await agent.open(); assert.ok(opened.sessionFile);
  const requestId = randomUUID(), run = agent.start('Read the synthetic source, then wait for my stop.', requestId);
  const completion = run.completion.then(value => ({ value }), error => ({ error: String(error) }));
  await run.accepted; await provider.waitHeld();
  assert.match(provider.requests[1]!.toolContent!, imageStress ? /image|Image/ : /SYNTHETIC_READ_BEFORE_STOP/);
  before = await ownedProcesses(root, [...transport.pids]);
  const at = performance.now();
  const stopping = agent.stop({ retryFailed: false }).catch(error => { stopError = error; });
  await new Promise<void>(resolve => setImmediate(resolve));
  if (process.env.OPTRACALL_STOP_HELD_BLOCK_PARENT === '1') {
    // Diagnostic-only comparison: the true close RPC is already sent. Pause
    // this test controller's reads without changing, delaying or forging IPC.
    transport.trace.push({ at: performance.now(), event: 'test-parent-block-start' });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
    transport.trace.push({ at: performance.now(), event: 'test-parent-block-end' });
  }
  await stopping;
  transport.trace.push({ at: performance.now(), event: 'stop-returned', elapsedMs: performance.now() - at, error: stopError && String(stopError) });
  result = await completion;
  records = await nativeRecords(opened.sessionFile); after = await ownedProcesses(root, [...transport.pids]);
  assert.equal(stopError, undefined, 'managed stop must await its trusted close reply before treating driver exit as unknown');
  assert.equal((result as any).value?.outcome, 'cancelled');
  assert.equal(agent.alive, false);
  assert.equal(records.filter(entry => entry.customType === 'optracall.run' && entry.data?.phase === 'settled' && entry.data.requestId === requestId).at(-1)?.data.outcome, 'cancelled');
  assert.equal(records.filter(entry => entry.customType === 'optracall.execution').at(-1)?.data.phase, 'closed');
  assert.deepEqual(after, [], 'acknowledgement includes actual owned execution and driver release');
  const closeRequest = transport.trace.find(value => value.direction === 'sent' && value.method === 'close');
  const closeReply = transport.trace.find(value => value.direction === 'received' && value.kind === 'reply' && value.id === closeRequest?.id && value.closed === true);
  assert.ok(closeReply, 'the matching trusted close reply must actually arrive');
  assert.ok(Number(closeReply.at) < Number(transport.trace.find(value => value.event === 'exit')?.at));
  assert.deepEqual(await readFile(source), bytes);
  await pause(100); assert.equal(provider.requests.length, 2);
});

test('public HTTP stop succeeds for a fresh managed task while its post-read model response remains held', { skip: process.platform !== 'darwin', timeout: 40_000 }, async t => {
  const root = path.join(evidenceBase, 'http-' + randomUUID()); await mkdir(root, { recursive: true });
  let source = '';
  const provider = await heldAfterReadProvider(() => source);
  const host = await startTestHost({ dataRoot: path.join(root, 'host'), projectsRoot: path.join(root, 'projects') });
  let stopStatus: number | undefined, stopBody: unknown, taskState: any, automatic: any, records: any[] = [], before: string[] = [], after: string[] = [];
  t.after(async () => {
    const shutdown = await Promise.allSettled([host.close(), provider.close()]);
    const state = taskState && { task: { id: taskState.task.id, sessionFile: taskState.task.sessionFile, lastRun: taskState.task.lastRun }, snapshot: { status: taskState.snapshot?.status, lastRun: taskState.snapshot?.lastRun } };
    await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ root, sourceKind: imageStress ? 'png' : 'text', stopStatus, stopBody, taskState: state, automatic, requests: provider.requests, before, after, records: records.filter(entry => entry.customType === 'optracall.run' || entry.customType === 'optracall.execution'), hostOutput: host.output(), shutdown: shutdown.map(value => value.status === 'fulfilled' ? 'fulfilled' : String(value.reason)) }, null, 2));
  });
  await readJson(await host.request('/api/configuration', 'PUT', { name: 'HTTP held stop synthetic', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-http-held-stop', apiKey: 'synthetic-http-held-stop-key' }));
  const { project } = await readJson(await host.request('/api/projects', 'POST', { name: 'held-final stop synthetic' }), 201);
  const { task } = await readJson(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'managed stop task' }), 201);
  const taskRoute = `/api/projects/${project.id}/tasks/${task.id}`, route = taskRoute + '/automatic-verification';
  const capability = await readJson(await host.request(`${route}/capabilities`));
  if (!capability.supported) { t.skip(`NOT_RUN: ${capability.reason ?? 'managed execution unavailable'}`); return; }
  await readJson(await host.request(`/api/projects/${project.id}/files/upload`, 'POST', { directory: '020_clean', name: sourceName, content: Buffer.from(sourceText).toString('base64') }), 201);
  source = path.join(project.rootPath, '020_clean', sourceName);
  // Public upload is text-only. The image pressure case is an explicitly local
  // synthetic fixture in this isolated project's 020, not an upload feature.
  const bytes = sourceBytes(); if (imageStress) await writeFile(source, bytes);
  await readJson(await host.request(`${route}/settings`, 'PUT', { expectedRevision: 0, settings: { enabled: true, question: '合成停止检查', dataFiles: [`020_clean/${sourceName}`], reportPath: '060_reports/report.md', processFiles: [], maxAuthorTurns: 1 } }));
  const requestId = randomUUID(); await readJson(await host.request(`${taskRoute}/messages`, 'POST', { requestId, text: 'Read the synthetic source, then wait for my stop.' }), 202);
  await provider.waitHeld(); assert.match(provider.requests[1]!.toolContent!, imageStress ? /image|Image/ : /SYNTHETIC_READ_BEFORE_STOP/);
  before = await ownedProcesses(root);
  const response = await host.request(`${taskRoute}/stop`, 'POST', {}); stopStatus = response.status; stopBody = await response.json();
  taskState = await readJson(await host.request(taskRoute));
  // The operation's business finally can finish after the stop response; wait
  // for its public projection rather than asserting same-tick idle timing.
  automatic = stopStatus === 200 ? await until(async () => readJson(await host.request(`${route}/status`)), value => !value.busy, 'stopped operation release') : await readJson(await host.request(`${route}/status`));
  assert.ok(taskState.task.sessionFile); records = await nativeRecords(taskState.task.sessionFile); after = await ownedProcesses(root, before.map(line => Number(line.trim().split(/\s+/)[0])));
  assert.equal(stopStatus, 200, JSON.stringify(stopBody));
  assert.equal(taskState.task.lastRun.status, 'cancelled'); assert.equal(automatic.busy, false);
  assert.equal(records.filter(entry => entry.customType === 'optracall.run' && entry.data?.phase === 'settled' && entry.data.requestId === requestId).at(-1)?.data.outcome, 'cancelled');
  assert.equal(records.filter(entry => entry.customType === 'optracall.execution').at(-1)?.data.phase, 'closed');
  assert.equal(after.some(line => /protected-tool-supervisor|protected-file-entry|project-entry/.test(line)), false);
  assert.deepEqual(await readFile(source), bytes);
  assert.deepEqual((await readJson(await host.request(`${route}/chains`))).chains, []);
  await pause(100); assert.equal(provider.requests.length, 2, 'stop cannot dispatch verification or replay the model');
});
