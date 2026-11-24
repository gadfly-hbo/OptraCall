import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID, createHash} from 'node:crypto';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {runtimeEnvironment} from '../scripts/runtime-process.ts';

function parseDiagnosticLines(stderr: string): Record<string, any>[] {
  const entries: Record<string, any>[] = [];
  for (const line of stderr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') entries.push(parsed);
    } catch {}
  }
  return entries;
}

async function startWrappedHost(root: string, instanceId: string) {
  const dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects'), uiRoot = path.join(root, 'ui');
  await mkdir(dataRoot, {recursive: true});
  await mkdir(projectsRoot, {recursive: true});
  await mkdir(uiRoot, {recursive: true});
  const indexHtml = Buffer.from('<!doctype html><html><body>fixture</body></html>', 'utf8');
  await writeFile(path.join(uiRoot, 'index.html'), indexHtml);
  await writeFile(path.join(uiRoot, 'optracall-build.json'), JSON.stringify({schema: 1, version: '0.1.0-test', commit: '0'.repeat(40), tree: '0'.repeat(40), builtAt: new Date().toISOString(), dirty: false, files: [{path: 'index.html', bytes: indexHtml.length, sha256: createHash('sha256').update(indexHtml).digest('hex')}]}) + '\n');
  const child = spawn(process.execPath, [
    path.join(process.cwd(), 'scripts/start-host.mjs'),
    '--port=0',
    '--ui-port=4197',
    `--data-root=${dataRoot}`,
    `--projects-root=${projectsRoot}`,
    `--ui-root=${uiRoot}`,
    `--instance-id=${instanceId}`,
  ], {cwd: process.cwd(), env: runtimeEnvironment(), stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const ready = await new Promise<{ port: number }>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`host startup timeout: ${stderr}`)); }, 20_000);
    child.stdout.on('data', () => {
      for (const line of stdout.split('\n')) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.kind === 'host-ready') { clearTimeout(timer); resolve(parsed); }
        } catch {}
      }
    });
    child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`host exited early code=${code} signal=${signal}: ${stderr}`)); });
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('exit', (code, signal) => resolve({code, signal}));
  });
  const base = `http://127.0.0.1:${ready.port}`;
  const req = async (route: string, method = 'GET', body?: unknown) => fetch(base + route, {
    method,
    headers: {'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4197'},
    ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
  });
  return {
    child, base, port: ready.port, dataRoot, projectsRoot, req, exited,
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

test('I131-A：上传／并发／异常矩阵与包装器退出诊断可区分请求错误与进程退出', {timeout: 120_000}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-i131-upload-matrix-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const instanceId = randomUUID();
  const host = await startWrappedHost(root, instanceId);
  t.after(async () => {
    if (host.child.exitCode === null && host.child.signalCode === null) {
      host.child.kill('SIGTERM');
      await host.exited;
    }
  });

  const health0 = await (await host.req('/api/health')).json();
  assert.equal(health0.runtime.instanceId, instanceId);
  const hostPid = health0.runtime.pid;
  assert.ok(Number.isSafeInteger(hostPid) && hostPid > 0);

  const scope = {kind: 'department', id: 'hean-east', name: '禾岸华东区'};
  const initiativeId = randomUUID();
  const created = await host.req('/api/strategy/initiatives', 'POST', {operationId: initiativeId, title: '上传矩阵测试', scopes: [scope]});
  assert.equal(created.status, 201);
  const filesRoute = `/api/strategy/initiatives/${initiativeId}/files`;

  // 1. Single small TXT upload + idempotent replay + conflict + explicit new upload with same bytes
  const txt = Buffer.from('禾岸零售门店经营摘要：Q1 客流稳定，会员复购待提升。\n', 'utf8');
  const txtBase64 = txt.toString('base64');
  const txtSha = createHash('sha256').update(txt).digest('hex');
  const op1 = randomUUID();
  const up1 = await host.req(filesRoute, 'POST', {operationId: op1, directory: '010_draw', name: '门店摘要.txt', contentBase64: txtBase64});
  assert.equal(up1.status, 201);
  const file1 = (await up1.json()).file;
  assert.equal(file1.operationId, op1);
  assert.equal(file1.sha256, txtSha);

  const replay1 = await host.req(filesRoute, 'POST', {operationId: op1, directory: '010_draw', name: '门店摘要.txt', contentBase64: txtBase64});
  assert.equal(replay1.status, 201);
  assert.equal((await replay1.json()).file.fileId, file1.fileId, 'same operationId replays exact original fileId');

  const conflict1 = await host.req(filesRoute, 'POST', {operationId: op1, directory: '010_draw', name: '门店摘要.txt', contentBase64: Buffer.from('不同正文').toString('base64')});
  assert.equal(conflict1.status, 409);
  assert.equal((await conflict1.json()).code, 'strategy_file_operation_conflict');

  const op2 = randomUUID();
  const explicitNew = await host.req(filesRoute, 'POST', {operationId: op2, directory: '010_draw', name: '门店摘要.txt', contentBase64: txtBase64});
  assert.equal(explicitNew.status, 201);
  const file2 = (await explicitNew.json()).file;
  assert.notEqual(file2.fileId, file1.fileId, 'explicit new upload with new operationId creates distinct record');

  // 2. Concurrent distinct uploads + concurrent same-operationId replays
  const sharedConcurrentOp = randomUUID();
  const concurrentDistinct = Array.from({length: 8}, (_, index) => {
    const op = randomUUID();
    const bytes = Buffer.from(`并发合成文档 #${index}`, 'utf8').toString('base64');
    return host.req(filesRoute, 'POST', {operationId: op, directory: index % 2 === 0 ? '010_draw' : '020_clean', name: `并发-${index}.txt`, contentBase64: bytes});
  });
  const concurrentReplays = Array.from({length: 4}, () =>
    host.req(filesRoute, 'POST', {operationId: sharedConcurrentOp, directory: '020_clean', name: '幂等并发.txt', contentBase64: txtBase64}),
  );
  const responses = await Promise.all([...concurrentDistinct, ...concurrentReplays]);
  for (const response of responses) assert.equal(response.status, 201);
  const replayBodies = await Promise.all(responses.slice(8).map(r => r.json()));
  assert.equal(new Set(replayBodies.map(b => b.file.fileId)).size, 1, 'concurrent same-operationId replays produce one fileId');

  // 3. Invalid request matrix (must return 4xx without crashing Host)
  const invalidPayloads = [
    {operationId: 'not-a-uuid', directory: '010_draw', name: 'a.txt', contentBase64: txtBase64},
    {operationId: randomUUID(), directory: '060_reports', name: 'a.txt', contentBase64: txtBase64},
    {operationId: randomUUID(), directory: '010_draw', name: '../escape.txt', contentBase64: txtBase64},
    {operationId: randomUUID(), directory: '010_draw', name: 'a.txt', contentBase64: txtBase64, extra: true},
  ];
  for (const payload of invalidPayloads) {
    const bad = await host.req(filesRoute, 'POST', payload);
    assert.equal(bad.status, 400);
  }
  const badJson = await fetch(`${host.base}${filesRoute}`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-optracall-client': '1', origin: 'http://127.0.0.1:4197'},
    body: '{"operationId":"broken',
  });
  assert.equal(badJson.status, 400);

  // 4. Aborted TCP upload body mid-flight (must not crash Host)
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect(host.port, '127.0.0.1', () => {
      socket.write(`POST ${filesRoute} HTTP/1.1\r\nHost: 127.0.0.1:${host.port}\r\nOrigin: http://127.0.0.1:4197\r\nX-OptraCall-Client: 1\r\nContent-Type: application/json\r\nContent-Length: 4096\r\n\r\n{"operationId":"${randomUUID()}"`);
      setTimeout(() => { socket.destroy(); resolve(); }, 30);
    });
    socket.on('error', reject);
  });

  // 5. Simulated corrupt index fault on an isolated initiative (request error, process stays alive)
  const corruptId = randomUUID();
  assert.equal((await host.req('/api/strategy/initiatives', 'POST', {operationId: corruptId, title: '索引故障隔离', scopes: [scope]})).status, 201);
  await writeFile(path.join(host.dataRoot, 'strategy-initiatives', corruptId, 'files.json'), '{"formatVersion":999}\n');
  const corruptResp = await host.req(`/api/strategy/initiatives/${corruptId}/files`, 'POST', {operationId: randomUUID(), directory: '010_draw', name: 'x.txt', contentBase64: txtBase64});
  assert.equal(corruptResp.status, 409);
  assert.equal((await corruptResp.json()).code, 'strategy_file_corrupt');

  // Host must still be alive with the exact same PID and instanceId
  const healthAfter = await (await host.req('/api/health')).json();
  assert.equal(healthAfter.runtime.pid, hostPid);
  assert.equal(healthAfter.runtime.instanceId, instanceId);
  const listed = (await (await host.req(filesRoute)).json()).files;
  assert.equal(listed.length, 11, '1 + 1 explicit new + 8 distinct + 1 concurrent replay = 11 logical files');

  // 6. Graceful SIGTERM shutdown emits sanitized exit diagnostics
  host.child.kill('SIGTERM');
  const exit = await host.exited;
  assert.equal(exit.code, 0);
  const logs = parseDiagnosticLines(host.getStderr());
  const shutdownStart = logs.find(entry => entry.kind === 'host-shutdown-start');
  const shutdownDone = logs.find(entry => entry.kind === 'host-shutdown-complete');
  const wrapperExit = logs.find(entry => entry.kind === 'host-wrapper-exit');
  assert.ok(shutdownStart, `expected host-shutdown-start log, got: ${host.getStderr()}`);
  assert.equal(shutdownStart.signal, 'SIGTERM');
  assert.equal(shutdownStart.instanceId, instanceId);
  assert.equal(shutdownStart.pid, hostPid);
  assert.ok(typeof shutdownStart.at === 'string' && !Number.isNaN(Date.parse(shutdownStart.at)));
  assert.ok(shutdownDone, `expected host-shutdown-complete log, got: ${host.getStderr()}`);
  assert.equal(shutdownDone.exitCode, 0);
  assert.ok(wrapperExit, `expected host-wrapper-exit log, got: ${host.getStderr()}`);
  assert.equal(wrapperExit.exitCode, 0);
  assert.equal(wrapperExit.signal, null);
  assert.equal(wrapperExit.hostPid, hostPid);
  assert.equal(wrapperExit.instanceId, instanceId);
});

test('I131-A：宿主被外部强杀时 wrapper 记录可观测 signal 并以非零退出', {timeout: 60_000}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-i131-kill-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const instanceId = randomUUID();
  const host = await startWrappedHost(root, instanceId);
  t.after(async () => {
    if (host.child.exitCode === null && host.child.signalCode === null) {
      host.child.kill('SIGKILL');
      await host.exited;
    }
  });
  const health = await (await host.req('/api/health')).json();
  const hostPid = health.runtime.pid;

  process.kill(hostPid, 'SIGKILL');
  const exit = await host.exited;
  assert.notEqual(exit.code, 0, 'abnormal child termination exits wrapper non-zero');
  const logs = parseDiagnosticLines(host.getStderr());
  const wrapperExit = logs.find(entry => entry.kind === 'host-wrapper-exit');
  assert.ok(wrapperExit, `expected host-wrapper-exit log, got: ${host.getStderr()}`);
  assert.equal(wrapperExit.signal, 'SIGKILL');
  assert.equal(wrapperExit.exitCode, null);
  assert.equal(wrapperExit.hostPid, hostPid);
  assert.equal(wrapperExit.instanceId, instanceId);
});

test('I131-A：启动失败与未捕获致命异常输出脱敏诊断并保持非零退出语义', {timeout: 60_000}, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-i131-fatal-'));
  t.after(() => rm(root, {recursive: true, force: true}));

  // 1. Startup failure via host-entry.mjs (invalid argument -> host-startup-failed + non-zero exit)
  const badStart = await new Promise<{ code: number | null; stderr: string }>(resolve => {
    const child = spawn(process.execPath, [
      path.join(process.cwd(), 'scripts/host-entry.mjs'),
      '--unknown-flag=secret-value-do-not-leak',
    ], {cwd: process.cwd(), env: runtimeEnvironment(), stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('exit', code => resolve({code, stderr}));
  });
  assert.notEqual(badStart.code, 0);
  const badLogs = parseDiagnosticLines(badStart.stderr);
  const startupFailed = badLogs.find(entry => entry.kind === 'host-startup-failed');
  assert.ok(startupFailed, `expected host-startup-failed log, got: ${badStart.stderr}`);
  assert.equal(startupFailed.errorName, 'Error');
  assert.equal(JSON.stringify(startupFailed).includes('secret-value-do-not-leak'), false, 'diagnostic JSON must not echo raw argument values');

  // 2. Uncaught exception inside runHost: uncaughtExceptionMonitor records sanitized event and preserves Node default non-zero fatal exit
  const dataRoot = path.join(root, 'host'), projectsRoot = path.join(root, 'projects');
  await mkdir(dataRoot, {recursive: true});
  await mkdir(projectsRoot, {recursive: true});
  const instanceId = randomUUID();
  const fatalScript = `
    import { runHost } from './src/host/main.ts';
    await runHost({ version: 'synthetic-test', async close() {} });
    setTimeout(() => {
      const err = new TypeError('secret-token-must-not-appear-in-json');
      err.code = 'ERR_SYNTHETIC_FATAL';
      throw err;
    }, 20);
  `;
  const fatalResult = await new Promise<{ code: number | null; stderr: string }>(resolve => {
    const child = spawn(process.execPath, [
      '--input-type=module',
      '-e',
      fatalScript,
      '--',
      '--port=0',
      '--ui-port=4197',
      `--data-root=${dataRoot}`,
      `--projects-root=${projectsRoot}`,
      `--instance-id=${instanceId}`,
    ], {cwd: process.cwd(), env: runtimeEnvironment(), stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('exit', code => resolve({code, stderr}));
  });
  assert.notEqual(fatalResult.code, 0, 'uncaughtExceptionMonitor must preserve default non-zero fatal exit');
  const fatalLogs = parseDiagnosticLines(fatalResult.stderr);
  const fatalEvent = fatalLogs.find(entry => entry.kind === 'host-fatal-exception');
  const processExit = fatalLogs.find(entry => entry.kind === 'host-process-exit');
  assert.ok(fatalEvent, `expected host-fatal-exception log, got: ${fatalResult.stderr}`);
  assert.equal(fatalEvent.origin, 'uncaught_exception');
  assert.equal(fatalEvent.errorName, 'TypeError');
  assert.equal(fatalEvent.errorCode, 'ERR_SYNTHETIC_FATAL');
  assert.equal(fatalEvent.instanceId, instanceId);
  assert.equal(JSON.stringify(fatalEvent).includes('secret-token-must-not-appear-in-json'), false, 'fatal JSON must not include raw error message');
  assert.ok(processExit, `expected host-process-exit log, got: ${fatalResult.stderr}`);
  assert.equal(processExit.reason, 'uncaught_exception');
  assert.notEqual(processExit.exitCode, 0);
});

