import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { createProtectedTools } from '../src/agent/protected-tools.ts';

const run = promisify(execFile);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function guardians(cwd: string) {
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid=,stat=,command=']);
  return stdout.split('\n').filter(line => line.includes('protected-tool-supervisor.py') && line.trimEnd().endsWith(cwd));
}
async function eventually(check: () => Promise<boolean>, description: string) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (await check()) return; await pause(40); }
  assert.fail(description);
}
async function fixture(codeRoot = process.cwd()) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-execution-reuse-'));
  const work = path.join(root, 'work'), materials = path.join(root, 'materials'), privateRoot = path.join(root, 'private');
  for (const dir of [work, materials, privateRoot]) await mkdir(dir, { mode: 0o700 });
  const source = path.join(materials, 'source.txt'); await writeFile(source, 'original source\n');
  await writeFile(path.join(privateRoot, 'native.jsonl'), 'original native\n');
  const runtime = await createProtectedTools({ scope: { id: 'reuse-test', cwd: work, writableRoot: work, readRoots: [materials] }, codeRoot, forbiddenRoots: [privateRoot] });
  const call = (name: string, id: string, args: unknown, signal?: AbortSignal) => runtime.tools.find(tool => tool.name === name)!.execute(id, args as never, signal, undefined, {} as never);
  return { root, work, materials, privateRoot, source, runtime, call };
}

test('repeated and concurrent native file calls retain one execution group and read actual changing bytes', { skip: process.platform !== 'darwin', timeout: 30_000 }, async t => {
  const f = await fixture(); t.after(() => f.runtime.close());
  assert.equal((await guardians(f.work)).length, 0, 'creation remains lazy');
  const replies = await Promise.all(Array.from({ length: 8 }, (_, n) => f.call('read', 'parallel-' + n, { path: f.source })));
  assert.ok(replies.every(reply => JSON.stringify(reply).includes('original source')));
  for (let n = 0; n < 16; n++) await f.call('read', 'serial-' + n, { path: f.source });
  assert.equal((await guardians(f.work)).length, 1, 'completed file calls share a single owned group');
  await f.call('write', 'write-v1', { path: 'changing.txt', content: 'first' });
  assert.match(JSON.stringify(await f.call('read', 'read-v1', { path: 'changing.txt' })), /first/);
  await f.call('write', 'write-v2', { path: 'changing.txt', content: 'second' });
  assert.match(JSON.stringify(await f.call('read', 'read-v2', { path: 'changing.txt' })), /second/);
  await assert.rejects(f.call('write', 'write-v2', { path: 'changing.txt', content: 'duplicate' }), /duplicate/);
  assert.equal(await readFile(path.join(f.work, 'changing.txt'), 'utf8'), 'second');
  assert.equal(await readFile(f.source, 'utf8'), 'original source\n');
  assert.equal(await readFile(path.join(f.privateRoot, 'native.jsonl'), 'utf8'), 'original native\n');
  await f.runtime.drain(); await f.runtime.close();
  assert.equal((await guardians(f.work)).length, 0, 'drain and close include guardian exit');
});

test('an isolated tool that naturally ended is collected before scope handoff', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  const f = await fixture(); t.after(() => f.runtime.close());
  assert.match(JSON.stringify(await f.call('bash', 'short-command', { command: 'printf finished' })), /finished/);
  await eventually(async () => (await guardians(f.work)).length === 0, 'finished isolated group and guardian must not accumulate until scope close');
  assert.match(JSON.stringify(await f.call('read', 'later-read', { path: f.source })), /original source/);
});

test('file reuse and natural collection preserve redirected background work across calls', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  const f = await fixture(); t.after(() => f.runtime.close());
  await f.call('bash', 'background', { command: '(sleep 0.7; printf background-complete > background.txt) </dev/null >/dev/null 2>&1 & printf launched' });
  for (let n = 0; n < 8; n++) await f.call('read', 'while-background-' + n, { path: f.source });
  await f.runtime.drain();
  assert.equal(await readFile(path.join(f.work, 'background.txt'), 'utf8'), 'background-complete');
  assert.equal((await guardians(f.work)).length, 0);
});

test('a missing isolated tool result remains unknown even when its execution group naturally closes', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  const f = await fixture(); t.after(() => f.runtime.close());
  await assert.rejects(f.call('bash', 'lost-result', { command: 'kill -KILL "$PPID"' }), /protected_executor_failed|result_unknown/);
  await assert.rejects(f.runtime.drain(), /protected_executor_failed|result_unknown/);
  await f.runtime.close({ retryFailed: false });
  assert.equal((await guardians(f.work)).length, 0, 'actual cleanup is independent of the missing business result');
});

test('stop while the first file call is pending closes its group without creating a replacement', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  const f = await fixture(); t.after(() => f.runtime.close());
  const read = f.call('read', 'first-file', { path: f.source });
  const settled = Promise.allSettled([read]);
  await eventually(async () => (await guardians(f.work)).length === 1, 'first execution group appears');
  await f.runtime.close({ retryFailed: false });
  await settled;
  await assert.rejects(f.call('read', 'after-stop', { path: f.source }), /closed/);
  assert.equal((await guardians(f.work)).length, 0);
});

test('ordinary SDK file errors leave the Agent free to issue a corrected tool call', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  const f = await fixture(); t.after(() => f.runtime.close());
  await assert.rejects(f.call('read', 'absent', { path: 'not-created.txt' }), /ENOENT|not found/i);
  let ownError;
  try { ownError = await f.call('codemode', 'author-error', { code: "throw new Error('protected_executor_failed')" }); }
  catch (error) { ownError = String(error); }
  assert.match(JSON.stringify(ownError), /protected_executor_failed/);
  f.runtime.assertHealthy();
  assert.match(JSON.stringify(await f.call('read', 'corrected', { path: f.source })), /original source/);
  await f.runtime.drain();
});

test('a protocol-malformed result cannot become scope success after natural cleanup', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  // A trusted fixture substitutes only the data producer. The real driver,
  // Seatbelt guardian, group identity and natural retirement are unchanged.
  const codeRoot = await mkdtemp(path.join(os.tmpdir(), 'optracall-malformed-executor-'));
  await mkdir(path.join(codeRoot, 'scripts')); await mkdir(path.join(codeRoot, 'src', 'agent'), { recursive: true });
  await writeFile(path.join(codeRoot, 'package.json'), '{"type":"module"}');
  await copyFile(path.resolve('scripts/protected-tool-supervisor.py'), path.join(codeRoot, 'scripts', 'protected-tool-supervisor.py'));
  await writeFile(path.join(codeRoot, 'scripts', 'protected-tool-entry.mjs'), `import {Socket} from 'node:net';
const channel=new Socket({fd:3,readable:true,writable:true});let data='';
channel.on('data',chunk=>{data+=chunk;const end=data.indexOf('\\n');if(end<0)return;
 const request=JSON.parse(data.slice(0,end));
 channel.end(JSON.stringify({kind:'protected.result',version:2,scopeId:request.scopeId,nonce:request.nonce,toolCallId:request.toolCallId,result:{invalid:true}})+'\\n');
});`);
  const f = await fixture(codeRoot); t.after(() => f.runtime.close());
  await assert.rejects(f.call('bash', 'malformed-result', { command: 'unused by synthetic producer' }), /protected_invalid_tool_result/);
  await assert.rejects(f.runtime.drain(), /protected_invalid_tool_result/);
  await f.runtime.close({ retryFailed: false });
});
