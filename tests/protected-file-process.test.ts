import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdtemp, writeFile, readFile, realpath, open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { Duplex } from 'node:stream';
import { createReadTool } from '../src/agent/sdk.ts';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const entry = path.resolve(process.env.OPTRACALL_FILE_WORKER_TEST_ENTRY ?? 'scripts/protected-file-entry.mjs');

async function worker(t: test.TestContext) {
  const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), 'optracall-file-worker-')));
  const identity = { scopeId: randomUUID(), nonce: randomUUID(), toolCallId: randomUUID() };
  const child = spawn(process.execPath, [entry, '--worker-json'], { cwd, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  const channel = child.stdio[3] as Duplex;
  let stderr = '', buffered = '';
  const decoder = new StringDecoder('utf8'), messages: any[] = [];
  child.stderr!.on('data', value => { stderr += value; });
  channel.on('error', () => {});
  channel.on('data', value => {
    buffered += decoder.write(value);
    for (let end; (end = buffered.indexOf('\n')) >= 0;) {
      const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
      messages.push(JSON.parse(line));
    }
  });
  let closed = false;
  const exited = new Promise<number | null>(resolve => child.once('close', code => { closed = true; resolve(code); }));
  t.after(async () => { if (!closed) child.kill('SIGKILL'); channel.destroy(); await exited; });
  const send = (value: Record<string, unknown>) => channel.write(JSON.stringify({ version: 2, ...identity, ...value }) + '\n');
  const wait = async (kind: string, callId?: string) => {
    const deadline = Date.now() + 4000;
    for (;;) {
      const result = messages.find(value => value.kind === kind && (callId === undefined || value.callId === callId));
      if (result) { assert.equal(result.version, 2); for (const [key, value] of Object.entries(identity)) assert.equal(result[key], value); return result; }
      assert.equal(closed, false, `worker exited before ${kind}: ${stderr}`);
      assert.ok(Date.now() < deadline, `worker did not send ${kind} for ${callId ?? 'resource'}: ${stderr}`);
      await pause(10);
    }
  };
  const open = async () => { send({ kind: 'protected.open', cwd }); return wait('protected.worker-ready'); };
  const execute = async (callId: string, tool: string, params: unknown) => { send({ kind: 'protected.execute', callId, tool, params }); return wait('protected.result', callId); };
  return { child, channel, cwd, identity, messages, send, wait, open, execute, exited, isClosed: () => closed };
}

test('file worker handshakes and multiplexes real native reads without caching or duplicate execution', { timeout: 15_000 }, async t => {
  const f = await worker(t);
  await f.open();
  for (let i = 0; i < 8; i++) await writeFile(path.join(f.cwd, `${i}.txt`), `native-${i}`);
  const calls = Array.from({ length: 8 }, (_, i) => ({ version: 2, ...f.identity, kind: 'protected.execute', callId: `read-${i}`, tool: 'read', params: { path: `${i}.txt` } }));
  const bytes = Buffer.from(calls.map(value => JSON.stringify(value) + '\n').join(''));
  f.channel.write(bytes.subarray(0, 73)); f.channel.write(bytes.subarray(73));
  const results = await Promise.all(calls.map(value => f.wait('protected.result', value.callId)));
  results.forEach((value, i) => assert.equal(value.result.content[0].text, `native-${i}`));
  await writeFile(path.join(f.cwd, '0.txt'), 'changed-on-disk');
  assert.equal((await f.execute('read-again', 'read', { path: '0.txt' })).result.content[0].text, 'changed-on-disk');
  await f.execute('once', 'write', { path: 'once.txt', content: 'first' });
  f.send({ kind: 'protected.execute', callId: 'once', tool: 'write', params: { path: 'once.txt', content: 'replayed' } });
  assert.equal((await f.execute('check-once', 'read', { path: 'once.txt' })).result.content[0].text, 'first');
  assert.equal(await readFile(path.join(f.cwd, 'once.txt'), 'utf8'), 'first');
  assert.equal(f.messages.filter(value => value.callId === 'once' && value.kind === 'protected.result').length, 1);
  f.send({ kind: 'protected.release' });
  assert.equal(await f.exited, 0);
});

test('file worker retains SDK mutation ordering, text truncation, errors and image results', { timeout: 15_000 }, async t => {
  const f = await worker(t); await f.open();
  f.send({ kind: 'protected.execute', callId: 'write-first', tool: 'write', params: { path: 'shared.txt', content: 'first' } });
  f.send({ kind: 'protected.execute', callId: 'edit-next', tool: 'edit', params: { path: 'shared.txt', edits: [{ oldText: 'first', newText: 'second' }] } });
  assert.equal((await f.wait('protected.result', 'write-first')).error, undefined);
  assert.equal((await f.wait('protected.result', 'edit-next')).error, undefined);
  assert.equal(await readFile(path.join(f.cwd, 'shared.txt'), 'utf8'), 'second');
  assert.match(JSON.stringify((await f.execute('directory', 'ls', {})).result.content), /shared\.txt/);
  const unicode = Buffer.from(JSON.stringify({ version: 2, ...f.identity, kind: 'protected.execute', callId: 'unicode', tool: 'write', params: { path: 'unicode.txt', content: '中文数据' } }) + '\n');
  const split = unicode.indexOf(Buffer.from('中')) + 1;
  f.channel.write(unicode.subarray(0, split)); f.channel.write(unicode.subarray(split));
  await f.wait('protected.result', 'unicode');
  assert.equal(await readFile(path.join(f.cwd, 'unicode.txt'), 'utf8'), '中文数据');
  await writeFile(path.join(f.cwd, 'large.txt'), Array.from({ length: 2500 }, (_, i) => `${i}: native text`).join('\n'));
  // A real PNG drives the SDK image implementation, including its native codec.
  await writeFile(path.join(f.cwd, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'));
  const native = createReadTool(f.cwd);
  for (const filename of ['large.txt', 'image.png']) {
    const expected = await native.execute('direct-' + filename, { path: filename });
    const actual = await f.execute(filename, 'read', { path: filename });
    assert.deepEqual(actual.result, JSON.parse(JSON.stringify(expected)));
    if (filename === 'large.txt') assert.match(actual.result.content[0].text, /Showing lines 1-2000/);
    else assert.ok(actual.result.content.some((value: any) => value.type === 'image' && value.mimeType === 'image/png'));
  }
  let expectedError = '';
  try { await native.execute('missing-direct', { path: 'missing.txt' }); } catch (error) { expectedError = (error as Error).message; }
  assert.equal((await f.execute('missing', 'read', { path: 'missing.txt' })).error, expectedError);
  for (const tool of ['bash', 'codemode', 'grep', 'find', 'mcp__fake']) {
    assert.equal((await f.execute('denied-' + tool, tool, { command: 'touch escaped', code: 'process.exit(9)' })).error, 'protected_tool_unavailable');
  }
  await assert.rejects(readFile(path.join(f.cwd, 'escaped')), /ENOENT/);
  f.send({ kind: 'protected.release' }); assert.equal(await f.exited, 0);
});

async function blockedRead(t: test.TestContext, f: Awaited<ReturnType<typeof worker>>, callId: string) {
  const fifo = path.join(f.cwd, callId + '.fifo');
  execFileSync('/usr/bin/mkfifo', [fifo]);
  f.send({ kind: 'protected.execute', callId, tool: 'read', params: { path: fifo } });
  // With no writer the real SDK's fs.open waits inside libuv. On macOS,
  // unblocking it subsequently produces ESPIPE from the SDK's positioned MIME
  // read; that native error is deliberately retained rather than mocked away.
  await pause(80);
  assert.equal(f.messages.some(value => value.callId === callId), false);
  return async () => {
    const writer = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
    t.after(async () => { try { await writer.close(); } catch { /* already closed */ } });
    await writer.close();
  };
}

test('one native read cancellation leaves concurrent calls alive and release waits for its real fs tail', { timeout: 15_000 }, async t => {
  const f = await worker(t); await f.open();
  const unblock = await blockedRead(t, f, 'blocked-cancel');
  await writeFile(path.join(f.cwd, 'independent.txt'), 'other-call-survived');
  assert.equal((await f.execute('independent', 'read', { path: 'independent.txt' })).result.content[0].text, 'other-call-survived');
  f.send({ kind: 'protected.cancel', callId: 'blocked-cancel' });
  assert.match((await f.wait('protected.result', 'blocked-cancel')).error, /Operation aborted/);
  assert.equal((await f.execute('after-cancel', 'read', { path: 'independent.txt' })).result.content[0].text, 'other-call-survived');
  const ended = new Promise<void>(resolve => f.channel.once('end', resolve));
  f.send({ kind: 'protected.release' }); await ended;
  await pause(80); assert.equal(f.isClosed(), false, 'an SDK rejection and released channel are not OS exit proof');
  await unblock();
  assert.equal(await f.exited, 0);
  assert.equal(f.messages.filter(value => value.kind === 'protected.result' && value.callId === 'blocked-cancel').length, 1);
});

test('normal release seals dispatch without aborting an already accepted native call', { timeout: 15_000 }, async t => {
  const f = await worker(t); await f.open();
  const unblock = await blockedRead(t, f, 'release-read');
  f.send({ kind: 'protected.release' });
  await pause(80); assert.equal(f.isClosed(), false);
  assert.equal(f.messages.some(value => value.callId === 'release-read'), false);
  await unblock();
  const result = await f.wait('protected.result', 'release-read');
  assert.match(result.error, /ESPIPE/);
  assert.doesNotMatch(result.error, /aborted/i);
  assert.equal(await f.exited, 0);
});

test('unexpected channel loss faults current calls while real native fs work remains owned until OS exit', { timeout: 15_000 }, async t => {
  const f = await worker(t); await f.open();
  const unblock = await blockedRead(t, f, 'lost-channel');
  f.channel.destroy();
  await pause(80);
  assert.equal(f.isClosed(), false, 'disconnect cannot erase a blocked native fs tail');
  await unblock();
  assert.equal(await f.exited, 0);
  assert.equal(f.messages.some(value => /closed|idle/.test(value.kind)), false);
});

test('file worker refuses pre-handshake execution, invalid identities and scope-changing envelopes', { timeout: 20_000 }, async t => {
  const first = await worker(t);
  first.send({ kind: 'protected.execute', callId: 'early', tool: 'write', params: { path: 'forbidden.txt', content: 'unsafe' } });
  await first.exited;
  await assert.rejects(readFile(path.join(first.cwd, 'forbidden.txt')), /ENOENT/);
  assert.equal(first.messages.length, 0);
  for (const extra of [
    { version: 1 }, { scopeId: 'different-scope' }, { nonce: 'wrong-channel' }, { toolCallId: 'old-generation' },
    { cwd: '/tmp' }, { env: { SECRET: 'injected' } }, { sessionFile: '/tmp/injected.jsonl' },
    { toolNames: ['read', 'write', 'bash'] }, { context: { executeTool: 'injected' } },
  ]) {
    const f = await worker(t); await f.open();
    f.send({ kind: 'protected.execute', callId: 'bad-envelope', tool: 'write', params: { path: 'forbidden.txt', content: 'unsafe' }, ...extra });
    await f.exited;
    await assert.rejects(readFile(path.join(f.cwd, 'forbidden.txt')), /ENOENT/);
    assert.equal(f.messages.some(value => value.callId === 'bad-envelope'), false);
  }
});

test('file worker rejects malformed and oversized JSON lines without executing their payload', { timeout: 15_000 }, async t => {
  const malformed = await worker(t); await malformed.open();
  malformed.channel.write('{"kind":\n');
  await malformed.exited;
  assert.equal(malformed.messages.length, 1);
  const oversized = await worker(t); await oversized.open();
  const prefix = JSON.stringify({ version: 2, ...oversized.identity, kind: 'protected.execute', callId: 'oversized', tool: 'write', params: { path: 'oversized.txt', content: '' } });
  // A line over the fixed 32 MiB protocol bound is rejected before JSON parse
  // or any SDK write; feed independent chunks rather than one artificial read.
  oversized.channel.write(prefix.slice(0, -4));
  for (let i = 0; i < 33; i++) oversized.channel.write(Buffer.alloc(1024 * 1024, 120));
  oversized.channel.write('"}}\n');
  await oversized.exited;
  await assert.rejects(readFile(path.join(oversized.cwd, 'oversized.txt')), /ENOENT/);
  assert.equal(oversized.messages.some(value => value.callId === 'oversized'), false);
});
