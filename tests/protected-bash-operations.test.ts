import test from 'node:test';
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProtectedBashOperations } from '../src/agent/protected-bash-operations.ts';
import { createBashTool } from '../src/agent/sdk.ts';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-bash-output-'));
  const captures = path.join(root, 'captures'); await mkdir(captures, { mode: 0o700 });
  return { root, captures, operations: createProtectedBashOperations(captures) };
}
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 3000;
  while (!await check()) { assert.ok(Date.now() < deadline, 'bounded test observation'); await pause(10); }
}

test('foreground output is complete when pipe consumption is delayed until exit', { timeout: 10_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-bash-output-'));
  const operations = createProtectedBashOperations(root);
  const children: { pid?: number; piped: boolean }[] = [];
  const subscription = channel('child_process');
  const observer = (message: unknown) => {
    const child = (message as { process: ChildProcess }).process;
    child.once('spawn', () => {
      if (child.spawnfile !== '/bin/bash') return;
      children.push({ pid: child.pid, piped: Boolean(child.stdout || child.stderr) });
      // Real Node streams and actual child writes: pause only consumption, not
      // shell completion. The old adapter destroys these unread pipes at exit.
      child.stdout?.pause(); child.stderr?.pause();
      child.once('exit', () => { child.stdout?.resume(); child.stderr?.resume(); });
    });
  };
  subscription.subscribe(observer);
  let output = '';
  try {
    const result = await operations.exec("printf '%098304d' 0; printf 'foreground-marker'; printf 'stderr-marker' >&2", root, { onData: value => { output += value; } });
    assert.equal(result.exitCode, 0);
    assert.equal(output.length, 98_334, 'all foreground stdout/stderr bytes precede completion');
    assert.equal(output, '0'.repeat(98_304) + 'foreground-marker' + 'stderr-marker');
    assert.equal(children.length, 1, 'one original bash invocation');
    assert.deepEqual(await readdir(root), []);
  } finally { subscription.unsubscribe(observer); }
});

test('a background descendant inherits anonymous output without delaying the foreground or leaving capture names', { timeout: 10_000 }, async () => {
  const f = await fixture(); let output = '';
  const pending = f.operations.exec("printf foreground; (while [ ! -f release ]; do sleep .02; done; printf background-output; printf completed > background.txt) &", f.root, { onData: value => { output += value; } });
  try {
    const result = await Promise.race([pending, pause(2000).then(() => { throw new Error('foreground waited for inherited output EOF'); })]);
    assert.equal(result.exitCode, 0); assert.equal(output, 'foreground');
    await assert.rejects(readFile(path.join(f.root, 'background.txt')), { code: 'ENOENT' });
    assert.deepEqual(await readdir(f.captures), []);
  } finally { await writeFile(path.join(f.root, 'release'), 'release'); await pending; }
  await until(async () => { try { return await readFile(path.join(f.root, 'background.txt'), 'utf8') === 'completed'; } catch { return false; } });
  assert.equal(output, 'foreground', 'no callback survives tool completion');
  assert.deepEqual(await readdir(f.captures), []);
});

test('output streams while foreground work is active and each concurrent call has independent bytes', { timeout: 10_000 }, async () => {
  const f = await fixture(); let output = '', settled = false;
  const pending = f.operations.exec("printf early; while [ ! -f release ]; do sleep .02; done; printf late >&2", f.root, { onData: value => { output += value; } }).then(value => { settled = true; return value; });
  try { await until(() => output === 'early'); assert.equal(settled, false); assert.deepEqual(await readdir(f.captures), []); }
  finally { await writeFile(path.join(f.root, 'release'), 'release'); }
  assert.equal((await pending).exitCode, 0); assert.equal(output, 'earlylate');
  const results = await Promise.all(Array.from({ length: 64 }, async (_, index) => {
    let text = '';
    const value = await f.operations.exec(`printf '${index}:stdout'; printf ':stderr' >&2`, f.root, { onData: data => { text += data; } });
    return { index, text, code: value.exitCode };
  }));
  for (const result of results) { assert.equal(result.code, 0); assert.equal(result.text, result.index + ':stdout:stderr'); }
  assert.deepEqual(await readdir(f.captures), []);
});

test('stdout and stderr share a private unlinked regular file and no capture manager FD reaches the child', { timeout: 10_000 }, async () => {
  const f = await fixture(); let output = '';
  const code = `const fs=require('node:fs');const a=fs.fstatSync(1),b=fs.fstatSync(2),extra=[];for(let fd=3;fd<256;fd++){try{const value=fs.fstatSync(fd);if(value.ino===a.ino&&value.dev===a.dev)extra.push(fd);}catch{}}console.log(JSON.stringify({regular:a.isFile(),same:a.ino===b.ino&&a.dev===b.dev,mode:a.mode&511,links:a.nlink,extra}));`;
  await f.operations.exec(quote(process.execPath) + ' -e ' + quote(code), f.root, { onData: data => { output += data; } });
  assert.deepEqual(JSON.parse(output), { regular: true, same: true, mode: 0o600, links: 0, extra: [] });
  assert.deepEqual(await readdir(f.captures), []);
});

test('abort, explicit timeout, spawn failure and capture failure cannot become successful results', { timeout: 10_000 }, async () => {
  const f = await fixture();
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(f.operations.exec('touch should-not-run', f.root, { signal: cancelled.signal, onData: () => {} }), /^Error: aborted$/);
  await assert.rejects(readFile(path.join(f.root, 'should-not-run')), { code: 'ENOENT' });
  const controller = new AbortController(); let abortedOutput = '';
  const aborted = f.operations.exec('printf before-abort; exec sleep 30', f.root, { signal: controller.signal, onData: data => { abortedOutput += data; } });
  await until(() => abortedOutput === 'before-abort'); controller.abort();
  await assert.rejects(aborted, /^Error: aborted$/);
  let timeoutOutput = '';
  await assert.rejects(f.operations.exec('printf before-timeout; exec sleep 30', f.root, { timeout: .06, onData: data => { timeoutOutput += data; } }), /^Error: timeout:0\.06$/);
  assert.equal(timeoutOutput, 'before-timeout');
  await assert.rejects(f.operations.exec('true', path.join(f.root, 'missing-cwd'), { onData: () => {} }), { code: 'ENOENT' });
  await assert.rejects(createProtectedBashOperations(path.join(f.root, 'missing-capture')).exec('touch should-not-run', f.root, { onData: () => {} }), /protected_bash_capture_failed/);
  assert.deepEqual(await readdir(f.captures), []);
});

test('a capture truncated after delivered output is a technical failure, never success', { timeout: 10_000 }, async () => {
  const f = await fixture(); let output = '';
  const truncate = quote(process.execPath) + ' -e ' + quote("require('node:fs').ftruncateSync(1,0)");
  const pending = f.operations.exec("printf observed; while [ ! -f truncate ]; do sleep .02; done; " + truncate, f.root, { onData: data => { output += data; } });
  try { await until(() => output === 'observed'); }
  finally { await writeFile(path.join(f.root, 'truncate'), 'truncate'); }
  await assert.rejects(pending, /protected_bash_capture_failed/);
  assert.deepEqual(await readdir(f.captures), []);
});

test('the SDK retains native result, error status, output truncation and timeout/abort formatting', { timeout: 15_000 }, async () => {
  const f = await fixture(), tool = createBashTool(f.root, { shellPath: '/bin/bash', exposeSessionEnvironment: false, operations: f.operations });
  const success = await tool.execute('native-success', { command: 'printf stdout; printf stderr >&2' });
  assert.equal((success as any).structuredContent.output, 'stdoutstderr');
  assert.equal((success as any).structuredContent.exit_code, 0);
  assert.equal((success as any).structuredContent.truncated, false);
  const failure = await tool.execute('native-failure', { command: 'printf failed; exit 7' });
  assert.equal((failure as any).isError, true); assert.equal((failure as any).structuredContent.exit_code, 7);
  assert.match(JSON.stringify(failure.content), /failed.*Command exited with code 7/);
  const large = await tool.execute('native-large', { command: "printf '%098304d' 0; printf tail-marker" });
  assert.match(JSON.stringify(large.content), /tail-marker/);
  assert.equal((large as any).structuredContent.output.length, 98_315);
  assert.equal((large as any).structuredContent.truncated, false);
  assert.equal((large as any).details.truncation.truncated, true);
  await assert.rejects(tool.execute('native-timeout', { command: 'printf timed; exec sleep 30', timeout: .06 }), /timed[\s\S]*Command timed out after 0\.06 seconds/);
  const controller = new AbortController(); let sawOutput = false;
  const aborted = tool.execute('native-abort', { command: 'printf aborted-marker; exec sleep 30' }, controller.signal, update => { if (JSON.stringify(update).includes('aborted-marker')) sawOutput = true; });
  await until(() => sawOutput); controller.abort();
  await assert.rejects(aborted, /aborted-marker[\s\S]*Command aborted/);
  assert.deepEqual(await readdir(f.captures), []);
});
