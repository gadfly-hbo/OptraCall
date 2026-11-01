import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const supervisor = path.resolve('scripts/protected-tool-supervisor.py');
const darwin = process.platform === 'darwin';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// This intentionally runs the real guardian and real Seatbelt-restricted Node
// processes. The instrumentation runs only in the trusted test launcher; it
// records actual killpg calls and can inject a proof failure without replacing
// group membership, process lifetime, sandbox permissions or waitpid.
async function guardian(input: { shared?: boolean; behavior?: string; instrument?: string } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'optracall-guardian-')));
  const work = path.join(root, 'work'), code = path.join(root, 'immutable');
  await mkdir(work, { mode: 0o700 }); await mkdir(code, { mode: 0o700 });
  const entry = path.join(code, 'worker.mjs'), trace = path.join(root, 'trace.jsonl');
  await writeFile(entry, `import net from 'node:net';
import {writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const channel=new net.Socket({fd:3,readable:true,writable:true});
let buffered='',identity,hold,initial=true,releases=0;const calls=new Map();
const send=(kind,value={})=>channel.write(JSON.stringify({...identity,version:2,kind,...value})+'\\n');
channel.on('data',data=>{buffered+=data;for(;;){const end=buffered.indexOf('\\n');if(end<0)break;
 const message=JSON.parse(buffered.slice(0,end));buffered=buffered.slice(end+1);
 if(initial){initial=false;identity=Object.fromEntries(['scopeId','nonce','toolCallId'].map(key=>[key,message[key]]));
  if(message.kind==='protected.open'){hold=setInterval(()=>{},1000);send('protected.worker-ready');continue;}
  if(${JSON.stringify(input.behavior)}==='background'){
   const child=spawn('/bin/bash',['-c','sleep .35; printf natural > background.txt'],{stdio:'ignore'});child.unref();
  }
  if(${JSON.stringify(input.behavior)}==='tail')setTimeout(()=>writeFile('tail.txt','natural'),350);
  if(${JSON.stringify(input.behavior)}!=='missing-result')send('protected.result',{result:{content:[{type:'text',text:'result'}]}});
  channel.end();continue;
 }
 if(message.kind==='protected.execute'){
  send('protected.close',{processGroup:process.pid,proof:'group-esrch'});
  send('protected.progress',{callId:message.callId,result:{content:[{type:'text',text:'progress:'+message.callId}]}});
  if(message.params?.delay)calls.set(message.callId,setTimeout(()=>{calls.delete(message.callId);send('protected.result',{callId:message.callId,result:{content:[{type:'text',text:message.callId}]}})},message.params.delay));
  else send('protected.result',{callId:message.callId,result:{content:[{type:'text',text:message.callId}]}});
 }
 if(message.kind==='protected.cancel'){clearTimeout(calls.get(message.callId));calls.delete(message.callId);send('protected.result',{callId:message.callId,error:'aborted'});}
 if(message.kind==='protected.release'){
  releases++;writeFile('release-count.txt',String(releases));clearInterval(hold);
  setTimeout(()=>writeFile('release-tail.txt','completed without abort'),200);channel.end();
 }
}});
`);
  const pythonQuery = spawnSync('python3', ['-I', '-S', '-c', "import os,sys; p=os.path.join(sys.prefix,'Resources','Python.app','Contents','MacOS','Python');print(os.path.realpath(p if os.path.isfile(p) else sys.executable))"], { encoding: 'utf8' });
  assert.equal(pythonQuery.status, 0, pythonQuery.stderr);
  const python = pythonQuery.stdout.trim();
  const node = realpathSync(process.execPath);
  const libraries = new Set<string>();
  const libraryRoots = (file: string) => {
    const resolved = realpathSync(file);
    if (libraries.has(resolved)) return;
    libraries.add(resolved);
    libraries.add(resolved.match(/^(\/opt\/homebrew\/Cellar\/[^/]+\/[^/]+)(?:\/|$)/)?.[1] ?? resolved);
    for (const line of spawnSync('/usr/bin/otool', ['-L', resolved], { encoding: 'utf8' }).stdout?.split('\n') ?? []) {
      const dependency = line.trim().split(' (')[0];
      if (dependency.startsWith('/opt/homebrew/') && existsSync(dependency)) libraryRoots(dependency);
    }
  };
  libraryRoots(node);
  const reads = ['/System/Library', '/usr/lib', '/usr/share', '/usr/bin', '/usr/libexec', '/bin', '/sbin', '/Library/Apple', '/dev/null', '/dev/urandom', '/dev/random', ...libraries, code, work].filter(existsSync);
  const profile = ['(version 1)', '(deny default)', '(allow file-read-metadata)', '(allow file-read* (literal "/") '+reads.map(value=>'(subpath '+JSON.stringify(value)+')').join(' ')+')',
    '(allow file-write* (subpath '+JSON.stringify(work)+') (literal "/dev/null"))', '(allow process-exec)', '(allow process-fork)', '(allow sysctl-read)', '(allow signal (target self) (target children) (target same-sandbox))',
    '(deny syscall-unix (syscall-number SYS_setsid SYS_setpgid))', '(deny syscall-unix (with errno ENOSYS) (syscall-number SYS_posix_spawn))'].join('\n');
  const probe = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, node, '-e', "require('node:fs').writeFileSync('sandbox-probe.txt','ready')"], { cwd: work, env: { PATH: '/usr/bin:/bin', HOME: work, OPENSSL_CONF: '/dev/null' }, encoding: 'utf8' });
  assert.equal(probe.status, 0, 'restricted worker startup: ' + probe.stderr);
  assert.equal(await readFile(path.join(work, 'sandbox-probe.txt'), 'utf8'), 'ready');
  const launcher = path.join(code, 'launch.py');
  await writeFile(launcher, `import runpy,sys,json,os\nns=runpy.run_path(${JSON.stringify(supervisor)},run_name='guardian_test')\noriginal_killpg=os.killpg\ndef killpg(group,number):\n with open(${JSON.stringify(trace)},'a') as stream: stream.write(json.dumps({'kind':'killpg','signal':number,'group':group})+'\\n')\n return original_killpg(group,number)\nos.killpg=killpg\n${input.instrument ?? ''}\nsys.exit(ns['main']())\n`);
  const child = spawn(python, ['-I', '-S', launcher, node, entry, profile, work], { cwd: work,
    env: { PATH: '/usr/bin:/bin', HOME: work, PYTHONEXECUTABLE: python, NODE_DISABLE_COMPILE_CACHE: '1', OPENSSL_CONF: '/dev/null' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const identity = { scopeId: 'guardian-test', nonce: randomUUID(), toolCallId: randomUUID() };
  const messages: any[] = []; let buffered = '', stderr = '', exited = false;
  child.stdout.on('data', data => { buffered += data; for (;;) { const end = buffered.indexOf('\n'); if (end < 0) break; const line = buffered.slice(0, end); buffered = buffered.slice(end + 1); messages.push(JSON.parse(line)); } });
  child.stderr.on('data', data => { stderr += data; });
  const exit = new Promise<number | null>(resolve => child.once('close', code => { exited = true; resolve(code); }));
  child.stdin.on('error', () => {});
  const send = (kind: string, value: object = {}) => child.stdin.write(JSON.stringify({ ...identity, version: 2, kind, ...value }) + '\n');
  send(input.shared ? 'protected.open' : 'protected.execute', { cwd: work });
  const waitFor = async (predicate: (value: any) => boolean, label: string, ms = 2000) => {
    const deadline = Date.now() + ms;
    for (;;) { const found = messages.find(predicate); if (found) return found; assert.ok(Date.now() < deadline, label + '; messages=' + JSON.stringify(messages) + '; stderr=' + stderr); await pause(10); }
  };
  const cleanup = async () => {
    try {
      if (exited) return;
      send('protected.close');
      const deadline = Date.now() + 3500;
      while (!exited && Date.now() < deadline) await pause(10);
      if (!exited) { child.kill('SIGKILL'); await exit; throw new Error('guardian test cleanup failed: ' + stderr); }
    } finally { await receipt(); }
  };
  const signals = async () => { try { return (await readFile(trace, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; } };
  const receipt = async () => {
    const evidence = path.resolve('.local/managed-execution-optimization/guardian/process-receipts');
    await mkdir(evidence, { recursive: true });
    await writeFile(path.join(evidence, path.basename(root) + '.json'), JSON.stringify({ root, work, supervisorPid: child.pid, identity, messages, signals: await signals(), exitCode: child.exitCode, signalCode: child.signalCode, stderr }, null, 2) + '\n');
  };
  return { root, work, child, identity, messages, send, waitFor, cleanup, signals, receipt, exit, get exited() { return exited; } };
}

test('guardian naturally reaps an isolated group before drain without sending a terminating signal', { skip: !darwin, timeout: 10_000 }, async t => {
  const g = await guardian(); t.after(g.cleanup);
  const ready = await g.waitFor(value => value.kind === 'protected.ready', 'owned group ready');
  await g.waitFor(value => value.kind === 'protected.result', 'tool result');
  const closed = await g.waitFor(value => value.kind === 'protected.closed', 'natural closed without drain');
  assert.equal(closed.mode, 'natural'); assert.equal(closed.version, 2); assert.equal(closed.proof, 'group-esrch'); assert.equal(closed.processGroup, ready.processGroup);
  assert.equal(await g.exit, 0); assert.throws(() => process.kill(-ready.processGroup, 0), { code: 'ESRCH' });
  assert.deepEqual((await g.signals()).filter(value => value.signal !== 0), []);
});

test('forced cleanup losing waitpid identity never signals that numeric group on an explicit retry', { skip: !darwin, timeout: 15_000 }, async t => {
  const g = await guardian({ shared: true, instrument: `
original_waitpid=os.waitpid
wait_failed=False
def lose_wait_identity(pid,options):
 global wait_failed
 value=original_waitpid(pid,options)
 if not wait_failed:
  wait_failed=True
  raise ChildProcessError(10,'synthetic lost child identity after actual reap')
 return value
os.waitpid=lose_wait_identity
` });
  t.after(g.cleanup);
  await g.waitFor(value => value.kind === 'protected.worker-ready', 'shared worker ready');
  g.send('protected.close');
  const failed = await g.waitFor(value => value.kind === 'protected.cleanup-unknown', 'lost waitpid identity is unknown');
  assert.equal(failed.reaped, true, 'a failed waitpid cannot preserve authority to signal the old numeric group');
  const before = (await g.signals()).filter(value => value.signal !== 0).length;
  g.send('protected.close');
  await g.waitFor(value => value.kind === 'protected.closed', 'explicit retry proves absence by query only');
  assert.equal(await g.exit, 0);
  assert.equal((await g.signals()).filter(value => value.signal !== 0).length, before);
});

for (const behavior of ['background', 'tail']) test('guardian preserves live ' + behavior + ' work after worker data EOF', { skip: !darwin, timeout: 10_000 }, async t => {
  const g = await guardian({ behavior }); t.after(g.cleanup);
  await g.waitFor(value => value.kind === 'protected.result', 'tool result');
  await pause(80); assert.equal(g.messages.some(value => value.kind === 'protected.closed'), false);
  g.send('protected.drain');
  await g.waitFor(value => value.kind === 'protected.closed', 'background naturally closed');
  assert.equal(await readFile(path.join(g.work, behavior === 'background' ? 'background.txt' : 'tail.txt'), 'utf8'), 'natural');
  assert.equal(await g.exit, 0); assert.deepEqual((await g.signals()).filter(value => value.signal !== 0), []);
});

test('shared guardian forwards interleaved call data and cancel, and drain releases once without aborting tails', { skip: !darwin, timeout: 10_000 }, async t => {
  const g = await guardian({ shared: true }); t.after(g.cleanup);
  const ready = await g.waitFor(value => value.kind === 'protected.ready', 'owned group ready');
  const workerReady = await g.waitFor(value => value.kind === 'protected.worker-ready', 'shared worker ready');
  assert.equal(ready.version, 2); assert.equal(workerReady.version, 2);
  // Fragment a trusted frame, then coalesce it with another frame. Neither
  // wrong identity nor a future protocol version can enter this worker.
  const fragmented = JSON.stringify({ ...g.identity, version: 2, kind: 'protected.execute', callId: 'fragmented', params: {} }) + '\n';
  g.child.stdin.write(fragmented.slice(0, 31));
  g.child.stdin.write(fragmented.slice(31) + JSON.stringify({ ...g.identity, version: 2, nonce: 'wrong', kind: 'protected.execute', callId: 'wrong-identity' }) + '\n');
  g.send('protected.execute', { version: 3, callId: 'wrong-version' });
  g.send('protected.execute', { callId: 'first', tool: 'read', params: { delay: 100 } });
  g.send('protected.execute', { callId: 'second', tool: 'read', params: {} });
  g.send('protected.execute', { callId: 'cancelled', tool: 'read', params: { delay: 1500 } });
  g.send('protected.cancel', { callId: 'cancelled' });
  await g.waitFor(value => value.kind === 'protected.result' && value.callId === 'cancelled', 'per-call cancel forwarded');
  await g.waitFor(value => value.kind === 'protected.result' && value.callId === 'first', 'first result');
  assert.equal(g.messages.find(value => value.kind === 'protected.result' && value.callId === 'fragmented').result.content[0].text, 'fragmented');
  assert.equal(g.messages.some(value => value.callId === 'wrong-identity' || value.callId === 'wrong-version'), false);
  const results = g.messages.filter(value => value.kind === 'protected.result');
  assert.equal(results.find(value => value.callId === 'second').result.content[0].text, 'second');
  assert.equal(g.messages.some(value => value.kind === 'protected.closed'), false, 'worker forged close is data without authority');
  assert.equal(g.messages.filter(value => value.kind === 'protected.ready').length, 1);
  g.send('protected.drain'); g.send('protected.drain');
  await g.waitFor(value => value.kind === 'protected.closed', 'shared natural release');
  assert.equal(await g.exit, 0);
  assert.equal(await readFile(path.join(g.work, 'release-count.txt'), 'utf8'), '1');
  assert.equal(await readFile(path.join(g.work, 'release-tail.txt'), 'utf8'), 'completed without abort');
  assert.deepEqual((await g.signals()).filter(value => value.signal !== 0), []);
});

test('natural group closure preserves an absent tool result as an independent error', { skip: !darwin, timeout: 10_000 }, async t => {
  const g = await guardian({ behavior: 'missing-result' }); t.after(g.cleanup);
  const error = await g.waitFor(value => value.kind === 'protected.result', 'missing result error');
  assert.equal(error.error, 'protected_executor_failed'); assert.equal(error.result, undefined);
  const closed = await g.waitFor(value => value.kind === 'protected.closed', 'group nevertheless naturally closed');
  assert.equal(closed.mode, 'natural'); assert.equal(await g.exit, 0);
  assert.deepEqual((await g.signals()).filter(value => value.signal !== 0), []);
});

test('failed final absence query never signals the reaped process-group number on explicit retry', { skip: !darwin, timeout: 10_000 }, async t => {
  const instrument = `original_query=os.killpg\nqueries=0\ndef query(group,number):\n global queries\n if number==0:\n  queries+=1\n  if queries==1: raise OSError(1,'injected-query-failure')\n return original_query(group,number)\nos.killpg=query`;
  const g = await guardian({ instrument }); t.after(g.cleanup);
  const failure = await g.waitFor(value => value.kind === 'protected.cleanup-unknown', 'post-reap query failure');
  assert.equal(failure.reaped, true);
  g.send('protected.drain'); await pause(250);
  assert.equal(g.messages.some(value => value.kind === 'protected.closed'), false);
  assert.equal(g.messages.filter(value => value.kind === 'protected.cleanup-unknown').length, 1);
  g.send('protected.close');
  await g.waitFor(value => value.kind === 'protected.closed', 'explicit query-only retry');
  assert.equal(await g.exit, 0);
  assert.deepEqual((await g.signals()).filter(value => value.signal !== 0), []);
});

test('natural cleanup proof failure is latched until explicit close and never turns a missing result into success', { skip: !darwin, timeout: 10_000 }, async t => {
  const instrument = `original_idle=ns['group_idle']\nattempts=0\ndef idle(group):\n global attempts\n attempts+=1\n if attempts==1: raise RuntimeError('injected-natural-proof-failure')\n return original_idle(group)\nns['main'].__globals__['group_idle']=idle`;
  const g = await guardian({ behavior: 'missing-result', instrument }); t.after(g.cleanup);
  await g.waitFor(value => value.kind === 'protected.cleanup-unknown', 'natural failure reported');
  await g.waitFor(value => value.kind === 'protected.result' && value.error === 'protected_executor_failed', 'missing result stays an error');
  g.send('protected.drain'); g.send('protected.execute', { callId: 'next' });
  await pause(300);
  assert.equal(g.messages.filter(value => value.kind === 'protected.cleanup-unknown').length, 1);
  assert.equal(g.messages.some(value => value.kind === 'protected.closed'), false);
  g.send('protected.close');
  await g.waitFor(value => value.kind === 'protected.closed', 'explicit cleanup retry');
  assert.equal(await g.exit, 0);
  assert.equal(g.messages.filter(value => value.kind === 'protected.result' && !value.error).length, 0);
});

test('failed parent-loss cleanup is attempted once and preserves the held identity', { skip: !darwin, timeout: 10_000 }, async t => {
  const g = await guardian({ shared: true, instrument: `def fail_clear(group,reaped):\n raise RuntimeError('injected-parent-loss-failure')\nns['main'].__globals__['clear_group']=fail_clear` });
  let cleaned = false;
  t.after(async () => {
    try {
      if (cleaned || g.exited) return;
      const group = g.messages.find(value => value.kind === 'protected.ready')?.processGroup;
      if (group) { try { process.kill(-group, 'SIGKILL'); } catch {} }
      g.child.kill('SIGKILL'); await g.exit;
    } finally { await g.receipt(); }
  });
  const ready = await g.waitFor(value => value.kind === 'protected.worker-ready', 'shared worker ready');
  assert.equal(ready.version, 2);
  g.child.stdin.end();
  await g.waitFor(value => value.kind === 'protected.cleanup-unknown', 'parent-loss failure');
  g.child.kill('SIGTERM');
  await pause(350);
  assert.equal(g.messages.filter(value => value.kind === 'protected.cleanup-unknown').length, 1, 'no repeated parent EOF/timer cleanup');
  // No control channel remains for an explicit retry. Stop only this synthetic
  // test group with its still-live pinned guardian, then dispose the guardian.
  const group = g.messages.find(value => value.kind === 'protected.ready').processGroup;
  assert.doesNotThrow(() => process.kill(-group, 0), 'failed cleanup still owns the pinned group');
  process.kill(-group, 'SIGKILL'); g.child.kill('SIGKILL'); await g.exit; cleaned = true;
});
