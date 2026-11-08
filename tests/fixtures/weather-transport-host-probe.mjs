import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, mkdirSync, copyFileSync, cpSync, writeFileSync, readFileSync, symlinkSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
const evidence = process.argv[3] ? path.resolve(process.argv[3]) : mkdtempSync(path.join(os.tmpdir(), 'weather-host-probe-'));
const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
import { runWeatherTransport } from '../../src/agent/weather-transport.ts';
const osSkip = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec') ? false : 'macOS Seatbelt required; product path fails closed on this platform';

const waitFor = async (predicate, label, limit = 4000) => {
  const deadline = Date.now() + limit;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for ' + label);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
function tree(settings, realWorker = false) {
  const root = mkdtempSync(path.join(evidence, 'case-')), code = path.join(root, 'code'), cache = path.join(root, 'cache');
  mkdirSync(path.join(code, 'src/agent'), { recursive: true }); mkdirSync(cache, { mode: 0o700 });
  for (const name of ['weather-egress.ts', 'weather-transport.ts']) copyFileSync(path.join(repoRoot, 'src/agent', name), path.join(code, 'src/agent', name));
  if (realWorker) {
    copyFileSync(path.join(repoRoot, 'src/agent/weather-worker.ts'), path.join(code, 'src/agent/weather-worker.ts'));
    mkdirSync(path.join(code, 'extensions/connectors'), { recursive: true });
    cpSync(path.join(repoRoot, 'extensions/connectors/weather-mcp'), path.join(code, 'extensions/connectors/weather-mcp'), { recursive: true });
  } else copyFileSync(path.join(fixtureRoot, 'weather-transport-worker-probe.mjs'), path.join(code, 'src/agent/weather-worker.ts'));
  copyFileSync(path.join(fixtureRoot, 'weather-transport-entry-probe.mjs'), path.join(code, 'entry.mjs'));
  writeFileSync(path.join(code, 'package.json'), JSON.stringify({ type: 'module' }));
  symlinkSync(realpathSync(path.join(repoRoot, 'node_modules')), path.join(code, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(path.join(cache, 'fixture.json'), JSON.stringify(settings));
  return { root, code, cache };
}
function launch(t, files) {
  const child = spawn(process.execPath, [path.join(files.code, 'entry.mjs'), files.cache], {
    cwd: files.code, detached: true, env: { PATH: process.env.PATH ?? '', NODE_DISABLE_COMPILE_CACHE: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  const killOwned = () => {
    if (child.exitCode === null && child.signalCode === null && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  };
  const deadline = setTimeout(killOwned, 7000);
  const done = new Promise(resolve => child.once('close', (code, signal) => {
    clearTimeout(deadline); const result = { code, signal, stdout, stderr };
    writeFileSync(path.join(files.root, 'process-result.json'), JSON.stringify(result, null, 2)); resolve(result);
  }));
  t.after(async () => { killOwned(); await done; });
  return { child, done, get stdout() { return stdout; }, get stderr() { return stderr; } };
}
const events = output => output.split('\n').filter(line => line.startsWith('weather-test:')).map(line => JSON.parse(line.slice('weather-test:'.length)));
const records = output => output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

for (const mode of ['unknown-keys', 'unknown-kind', 'duplicate-id', 'oversized', 'future-cancel']) {
  test('WX05: actual Host rejects ' + mode + ' fd frames', { skip: osSkip }, async t => {
    const process = launch(t, tree({ mode })); const result = await process.done;
    assert.equal(result.code, 1, JSON.stringify(result)); assert.match(result.stderr, /protocol_invalid/);
  });
}
test('WX05: non-allowlisted broker URL is rejected before the synthetic upstream', { skip: osSkip }, async t => {
  const process = launch(t, tree({ mode: 'blocked-url' }));
  await waitFor(() => process.stdout.includes('source_unavailable'), 'blocked URL rejection');
  assert.equal(events(process.stderr).length, 0); process.child.stdin.end(); assert.equal((await process.done).code, 0);
});
test('WX05: actual Host caps pending requests and aborts all on close', { skip: osSkip }, async t => {
  const process = launch(t, tree({ mode: 'pending-limit', upstream: 'hold' }));
  await waitFor(() => process.stdout.includes('weather_transport_busy'), 'pending limit');
  assert.equal(events(process.stderr).filter(event => event.type === 'request').length, 8);
  process.child.stdin.end(); const result = await process.done;
  assert.equal(result.code, 0); assert.equal(events(result.stderr).filter(event => event.type === 'abort').length, 8);
});
test('WX05: actual Host response cap applies to a trusted fixture and never forwards oversized body', { skip: osSkip }, async t => {
  const process = launch(t, tree({ mode: 'body-limit', upstream: 'large' }));
  await waitFor(() => process.stdout.includes('source_unavailable'), 'body limit');
  assert.equal(process.stdout.includes('xxxxx'), false); process.child.stdin.end(); assert.equal((await process.done).code, 0);
});
test('WX03: Retry-After survives the actual Host fd response', { skip: osSkip }, async t => {
  const process = launch(t, tree({ mode: 'retry-after', upstream: 'rate-limit' }));
  await waitFor(() => process.stdout.includes('retry-after'), 'Retry-After');
  assert.equal(records(process.stdout)[0].headers['retry-after'], '3'); process.child.stdin.end(); assert.equal((await process.done).code, 0);
});
for (const seatbeltOnly of [false, true]) {
  test('WX05: actual Host worker blocks non-allowlisted direct networks and subprocess bypass' + (seatbeltOnly ? ' at OS layer alone' : ' with both layers'), { skip: osSkip }, async t => {
    let hits = 0;
    const server = http.createServer((_request, response) => { hits++; response.end('must-not-arrive'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const files = tree({ mode: 'direct-network', seatbeltOnly, port: server.address().port, socketPath: 'probe.sock' });
    // A relative socket path avoids sun_path truncation in long private evidence roots.
    const originalCwd = globalThis.process.cwd(); globalThis.process.chdir(files.cache);
    const unix = net.createServer(socket => { hits++; socket.end(); });
    await new Promise(resolve => unix.listen('probe.sock', resolve));
    t.after(async () => { await new Promise(resolve => unix.close(resolve)); globalThis.process.chdir(originalCwd); });
    const process = launch(t, files);
    await waitFor(() => process.stdout.includes('direct-network'), 'direct API result');
    const report = records(process.stdout)[0];
    assert.equal(report.errors.length, seatbeltOnly ? 7 : 8);
    assert.ok(report.errors.every(error => error.error === (seatbeltOnly ? 'EPERM' : 'ERR_ACCESS_DENIED')), JSON.stringify(report));
    assert.equal(hits, 0); process.child.stdin.end(); assert.equal((await process.done).code, 0);
  });
}

test('WX05: unsupported product platforms fail closed before allocating a cache', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform'), absent = path.join(evidence, 'unsupported-cache');
  try {
    // Only exercise rejection: this never enables an unsupported platform.
    Object.defineProperty(process, 'platform', { value: 'linux' });
    await assert.rejects(runWeatherTransport({ cacheRoot: absent }), /unsupported/); assert.equal(existsSync(absent), false);
  } finally { Object.defineProperty(process, 'platform', descriptor); }
});

test('WX05: Node permissions block direct TCP while inherited fd3 still works on CI', async t => {
  const root = mkdtempSync(path.join(evidence, 'node-permission-')), script = path.join(root, 'probe.mjs');
  let hits = 0; const server = http.createServer((_request, response) => { hits++; response.end('must-not-arrive'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  writeFileSync(script, `import net from 'node:net';let denied;try{await new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port:Number(process.argv[2])});socket.once('connect',()=>{socket.destroy();resolve()});socket.once('error',reject)})}catch(e){denied=e.code}const fd=new net.Socket({fd:3,readable:true,writable:true});fd.once('data',data=>{console.log(JSON.stringify({denied,reply:data.toString()}));fd.destroy()});fd.write('ping');`);
  // Inline execution needs no file read permission and avoids /var -> /private/var entry-loader resolution.
  const child = spawn(process.execPath, ['--permission', '--input-type=module', '-e', readFileSync(script, 'utf8').replace('process.argv[2]', 'process.argv[1]'), String(server.address().port)], { cwd: root, env: { NODE_DISABLE_COMPILE_CACHE: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  let output = '', errors = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
  child.stdio[3].on('data', chunk => child.stdio[3].write('pong:' + chunk)); child.stdio[3].on('error', () => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
  t.after(() => { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const status = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(timer); assert.equal(status.code, 0, errors); assert.deepEqual(JSON.parse(output), { denied: 'ERR_ACCESS_DENIED', reply: 'pong:ping' }); assert.equal(hits, 0);
});

function rpc(process) {
  let sequence = 0, buffer = ''; const pending = new Map(), all = [];
  process.child.stdout.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf('\n'); if (end < 0) return;
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      const value = JSON.parse(line); all.push(value);
      const entry = pending.get(value.id); if (entry) { clearTimeout(entry.timer); pending.delete(value.id); entry.resolve(value); }
    }
  });
  const notify = (method, params) => process.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return {
    notify, all,
    request(method, params) {
      const id = ++sequence;
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('RPC timeout: ' + method + ' stderr=' + process.stderr)); }, 4000);
        pending.set(id, { resolve, timer });
        process.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
      return { id, promise };
    },
    forget(id) { const entry = pending.get(id); if (entry) { clearTimeout(entry.timer); pending.delete(id); } },
    close() { for (const entry of pending.values()) clearTimeout(entry.timer); pending.clear(); },
  };
}
test('WX01/03/04/06: real MCP stdio queries/cache/cancel/reuse close P and Q in the SDK-shaped process group', { skip: osSkip }, async t => {
  const files = tree({ upstream: 'normal' }, true), process = launch(t, files), client = rpc(process);
  t.after(() => client.close());
  assert.ok((await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'weather-transport-fixture', version: '1' } }).promise).result);
  client.notify('notifications/initialized', {});
  assert.equal((await client.request('tools/list', {}).promise).result.tools[0].name, 'weather_history');
  const args = { lat: 30, lon: 120, start: '2025-10-01', end: '2025-10-02' };
  const call = input => client.request('tools/call', { name: 'weather_history', arguments: input });
  assert.equal((await call(args).promise).result.structuredContent.cache.hit, false);
  assert.equal((await call(args).promise).result.structuredContent.cache.hit, true);
  const slow = call({ ...args, lat: 55 });
  await waitFor(() => events(process.stderr).some(event => event.type === 'request' && event.id === 2), 'slow request started');
  client.notify('notifications/cancelled', { requestId: slow.id, reason: 'synthetic cancel' }); client.forget(slow.id);
  await waitFor(() => events(process.stderr).some(event => event.type === 'abort' && event.id === 2), 'broker cancellation');
  assert.equal(readdirSync(path.join(files.cache, 'entries')).length, 1, 'cancelled request must not become successful cache data');
  assert.equal((await call({ ...args, lat: 31 }).promise).result.structuredContent.cache.hit, false);
  const table = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,comm='], { encoding: 'utf8' }).split('\n').map(line => line.trim().split(/\s+/)).filter(row => Number(row[1]) === process.child.pid || Number(row[0]) === process.child.pid);
  assert.equal(table.length, 2, JSON.stringify(table));
  const worker = table.find(row => Number(row[1]) === process.child.pid); assert.equal(Number(worker[2]), process.child.pid);
  assert.equal(Number(table.find(row => Number(row[0]) === process.child.pid)[2]), process.child.pid);
  process.child.stdin.end(); assert.equal((await process.done).code, 0);
  assert.throws(() => globalThis.process.kill(Number(worker[0]), 0), { code: 'ESRCH' });
  writeFileSync(path.join(files.root, 'process-group.json'), JSON.stringify(table, null, 2));
});
