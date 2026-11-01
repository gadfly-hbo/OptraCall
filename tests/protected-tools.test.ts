import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createProtectedExecutionScope, createProtectedTools } from '../src/agent/protected-tools.ts';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-protected-tools-'));
  const work = path.join(root, 'work'), inputs = path.join(root, 'inputs'), secrets = path.join(root, 'host-private');
  for (const dir of [work, inputs, secrets]) await mkdir(dir, { mode: 0o700 });
  const input = path.join(inputs, 'source.txt'), native = path.join(secrets, 'session.jsonl'), credential = path.join(secrets, 'auth.json');
  await writeFile(input, '100\n-20\n'); await writeFile(native, 'ORIGINAL NATIVE\n'); await writeFile(credential, 'PRIVATE-SYNTHETIC-KEY');
  const scope = await createProtectedExecutionScope({ id: 'test-scope', cwd: work, writableRoot: work, readRoots: [inputs] });
  return { root, work, inputs, secrets, input, native, credential, scope };
}

test('protected scope refuses pre-existing writable aliases and forbidden ancestor reads', async () => {
  const f = await fixture();
  await symlink(f.input, path.join(f.work, 'alias'));
  await assert.rejects(createProtectedExecutionScope(f.scope), /protected_unsafe_workspace/);
  const g = await fixture(); await link(g.native, path.join(g.work, 'hardlink'));
  await assert.rejects(createProtectedExecutionScope(g.scope), /protected_unsafe_workspace/);
  const h = await fixture();
  await assert.rejects(createProtectedTools({ scope: { ...h.scope, readRoots: [h.root] }, codeRoot: process.cwd(), forbiddenRoots: [h.secrets] }), /protected_forbidden_read/);
  const i = await fixture(); await link(i.native, path.join(i.inputs, 'native-alias'));
  await assert.rejects(createProtectedExecutionScope(i.scope), /protected_unsafe_read_root/);
  const j = await fixture(); await symlink(j.credential, path.join(j.inputs, 'private-alias'));
  await assert.rejects(createProtectedExecutionScope(j.scope), /protected_unsafe_read_root/);
  const k = await fixture(), aliasRoot = path.join(k.root, 'work-alias'); await symlink(k.work, aliasRoot);
  await assert.rejects(createProtectedExecutionScope({ ...k.scope, cwd: aliasRoot, writableRoot: aliasRoot }), /protected_unsafe_workspace/);
});

test('native tools and nested codemode compute while originals, native and credentials remain inaccessible', { skip: process.platform !== 'darwin', timeout: 45_000 }, async t => {
  const f = await fixture(), runtime = await createProtectedTools({ scope: f.scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] });
  t.after(() => runtime.close());
  let n = 0;
  const call = (name: string, params: unknown, signal?: AbortSignal) => {
    const tool = runtime.tools.find(item => item.name === name); assert.ok(tool, name);
    return tool.execute('call-' + ++n, params as never, signal, undefined, {} as never);
  };
  const text = (value: { content: unknown[] }) => JSON.stringify(value.content);
  assert.match(text(await call('read', { path: f.input })), /100/);
  await call('write', { path: 'new.md', content: 'first' });
  await call('edit', { path: 'new.md', edits: [{ oldText: 'first', newText: 'second' }] });
  assert.equal(await readFile(path.join(f.work, 'new.md'), 'utf8'), 'second');
  assert.match(text(await call('ls', { path: f.work })), /new\.md/);
  assert.match(text(await call('grep', { path: f.work, pattern: 'second' })), /second/);
  if (runtime.tools.some(tool => tool.name === 'find')) assert.match(text(await call('find', { path: f.work, pattern: '*.md' })), /new\.md/);
  else assert.ok(runtime.unavailableTools.some(tool => tool.name === 'find' && tool.reason.includes('not installed')));
  for (const target of [f.native, f.credential]) {
    await assert.rejects(call('read', { path: target }), /EPERM|EACCES|not permitted|Permission/i);
    await assert.rejects(call('write', { path: target, content: 'FORGED' }), /EPERM|EACCES|not permitted|Permission/i);
  }
  await assert.rejects(call('write', { path: f.input, content: 'changed' }), /EPERM|EACCES|not permitted|Permission/i);
  const computed = await call('bash', { command: "python3 -c 'print(sum(range(11)))'" });
  assert.match(text(computed), /55/);
  const isolation = await call('bash', { command: `python3 - <<'PY'\nimport os, socket\nfor label, action in [('private-read', lambda: open(${JSON.stringify(f.credential)}).read()), ('original-write', lambda: open(${JSON.stringify(f.input)}, 'w').write('changed')), ('native-link', lambda: os.link(${JSON.stringify(f.native)}, 'native-alias')), ('source-link-write', lambda: (os.link(${JSON.stringify(f.input)}, 'source-alias'), open('source-alias', 'w').write('changed'))), ('network', lambda: socket.create_connection(('127.0.0.1', 9), timeout=1))]:\n    try:\n        action()\n        print(label + ':UNEXPECTED')\n    except PermissionError:\n        print(label + ':DENIED')\nPY` });
  for (const label of ['private-read', 'original-write', 'native-link', 'source-link-write', 'network']) assert.match(text(isolation), new RegExp(label + ':DENIED'));
  assert.doesNotMatch(text(isolation), /UNEXPECTED|PRIVATE-SYNTHETIC-KEY/);
  const nested = await call('codemode', { code: `text(await tools.read({path:${JSON.stringify(f.input)}})); text(await tools.bash({command:"python3 -c 'print(7*8)'"}));` });
  assert.match(text(nested), /100/);
  assert.match(text(nested), /56/);
  const denied = await call('codemode', { code: `text(await tools.read({path:${JSON.stringify(f.credential)}}));` });
  assert.doesNotMatch(text(denied), /PRIVATE-SYNTHETIC-KEY/);
  assert.match(text(denied), /failed|not permitted|EPERM|EACCES/i);
  assert.equal(await readFile(f.native, 'utf8'), 'ORIGINAL NATIVE\n');
  assert.equal(await readFile(f.credential, 'utf8'), 'PRIVATE-SYNTHETIC-KEY');
  assert.equal(await readFile(f.input, 'utf8'), '100\n-20\n');
  assert.equal(runtime.tools.some(tool => tool.name.startsWith('mcp__')), false);
});

test('a scope keeps legitimate background computation across tool results and closes it only at release', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  const f = await fixture(), runtime = await createProtectedTools({ scope: f.scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] });
  t.after(() => runtime.close());
  const bash = runtime.tools.find(tool => tool.name === 'bash')!;
  await bash.execute('background', { command: "(sleep 0.3; printf 42 > background-result.txt) & printf started" }, undefined, undefined, {} as never);
  const next = await bash.execute('read-background', { command: 'sleep 0.5; cat background-result.txt' }, undefined, undefined, {} as never);
  assert.match(JSON.stringify(next.content), /42/);
  await bash.execute('still-background', { command: "(sleep 1.2; printf late > after-close.txt) & printf started" }, undefined, undefined, {} as never);
  await runtime.close();
  await new Promise(resolve => setTimeout(resolve, 1400));
  await assert.rejects(readFile(path.join(f.work, 'after-close.txt')), /ENOENT/);
});

test('managed ordinary scope writes only its explicit project roots while fixed phases keep originals read-only', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  const f = await fixture(), clean = path.join(f.root, '020_clean'), reports = path.join(f.root, '060_reports');
  await mkdir(clean, { mode: 0o700 }); await mkdir(reports, { mode: 0o700 });
  const scope = await createProtectedExecutionScope({ ...f.scope, profile: 'ordinary', cwd: clean, writeRoots: [clean, reports], readRoots: [f.inputs, clean, reports] });
  const runtime = await createProtectedTools({ scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] }); t.after(() => runtime.close());
  const write = runtime.tools.find(tool => tool.name === 'write')!;
  await write.execute('ordinary-process', { path: 'calculation.txt', content: '42' }, undefined, undefined, {} as never);
  await write.execute('ordinary-report', { path: path.join(reports, 'initial.md'), content: 'Agent generated body' }, undefined, undefined, {} as never);
  assert.equal(await readFile(path.join(clean, 'calculation.txt'), 'utf8'), '42');
  assert.equal(await readFile(path.join(reports, 'initial.md'), 'utf8'), 'Agent generated body');
  await assert.rejects(write.execute('original-denied', { path: f.input, content: 'changed' }, undefined, undefined, {} as never), /EPERM|EACCES|not permitted|Permission/i);
  await assert.rejects(createProtectedExecutionScope({ ...f.scope, writeRoots: [clean] }), /protected_invalid_scope/);
});

test('scope close stops a continuously writing background Python process', { skip: process.platform !== 'darwin', timeout: 15_000 }, async t => {
  const f = await fixture(), runtime = await createProtectedTools({ scope: f.scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] }); t.after(() => runtime.close());
  const script = 'import time; from pathlib import Path; p=Path("continuous.txt"); i=0\nwhile True:\n i+=1; p.write_text(str(i)); time.sleep(.03)';
  await runtime.tools.find(tool => tool.name === 'bash')!.execute('continuous-background', { command: 'python3 -c ' + "'" + script + "'" + ' >/dev/null 2>&1 & echo started' }, undefined, undefined, {} as never);
  const deadline = Date.now() + 2000;
  for (;;) { try { if ((await readFile(path.join(f.work, 'continuous.txt'), 'utf8')).length) break; } catch {} assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 20)); }
  await runtime.close(); const before = await readFile(path.join(f.work, 'continuous.txt'), 'utf8'); await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await readFile(path.join(f.work, 'continuous.txt'), 'utf8'), before);
});

test('normal drain waits for background results without killing them, while explicit close cancels a pending drain', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  const f = await fixture(), runtime = await createProtectedTools({ scope: f.scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] }); t.after(() => runtime.close());
  const bash = runtime.tools.find(tool => tool.name === 'bash')!;
  await bash.execute('finite-background', { command: '(sleep 0.8; printf complete > natural.txt) & echo started' }, undefined, undefined, {} as never);
  await runtime.drain();
  assert.equal(await readFile(path.join(f.work, 'natural.txt'), 'utf8'), 'complete');
  await assert.rejects(bash.execute('after-drain', { command: 'true' }, undefined, undefined, {} as never), /protected_executor_draining/);
  await runtime.close();
  const g = await fixture(), second = await createProtectedTools({ scope: g.scope, codeRoot: process.cwd(), forbiddenRoots: [g.secrets] }); t.after(() => second.close());
  await second.tools.find(tool => tool.name === 'bash')!.execute('long-background', { command: '(sleep 30; printf late > cancelled.txt) & echo started' }, undefined, undefined, {} as never);
  let drained = false;
  const waiting = second.drain().then(() => { drained = true; }, error => { assert.match(String(error), /protected_executor_closed/); });
  await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(drained, false);
  await second.close(); await waiting;
  await assert.rejects(readFile(path.join(g.work, 'cancelled.txt')), /ENOENT/);
});

test('guardian reclaims its owned background group after an abrupt controller IPC loss', { skip: process.platform !== 'darwin', timeout: 20_000 }, async () => {
  const f = await fixture(), script = path.join(f.root, 'controller.mjs');
  const command = `python3 - <<'PY'\nimport json,os,time\npid=os.fork()\nif pid==0:\n time.sleep(2); open('after-controller-loss.txt','w').write('unsafe late write'); os._exit(0)\nprint(json.dumps({'guardian':int(os.environ['OPTRACALL_EXECUTION_SUPERVISOR_PID']),'group':os.getpgrp()}))\nPY`;
  await writeFile(script, `import {createProtectedTools} from ${JSON.stringify(path.join(process.cwd(), 'src/agent/protected-tools.ts'))};
    const runtime=await createProtectedTools(${JSON.stringify({ scope: f.scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] })});
    const result=await runtime.tools.find(tool=>tool.name==='bash').execute('controller-loss',${JSON.stringify({ command })},undefined,undefined,{});
    console.log(result.content.filter(value=>value.type==='text').map(value=>value.text).join(''));
    process.exit(0);`);
  const controller = spawn(process.execPath, [script], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = ''; controller.stdout.on('data', chunk => { output += chunk; }); controller.stderr.on('data', chunk => { errors += chunk; });
  const status = await new Promise(resolve => controller.once('close', resolve));
  assert.equal(status, 0, errors);
  const identity = JSON.parse(output.match(/\{[^\n]*"guardian"[^\n]*\}/)![0]);
  const deadline = Date.now() + 5000;
  for (;;) {
    try { process.kill(-identity.group, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') break; }
    assert.ok(Date.now() < deadline, 'owned group must be reclaimed after parent IPC closes');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await new Promise(resolve => setTimeout(resolve, 2100));
  await assert.rejects(readFile(path.join(f.work, 'after-controller-loss.txt')), /ENOENT/);
});

test('scope release covers descendants created while group shutdown begins', { skip: process.platform !== 'darwin', timeout: 15_000 }, async t => {
  const f = await fixture(), runtime = await createProtectedTools({ scope: f.scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] }); t.after(() => runtime.close());
  const script = `import os,time\nfrom pathlib import Path\nif os.fork()==0:\n Path('fork-ready.txt').write_text(str(os.getpgrp()))\n for i in range(40):\n  if os.fork()==0:\n   time.sleep(.5); Path('fork-late-'+str(i)).write_text('late'); os._exit(0)\n  time.sleep(.02)\n os._exit(0)\nprint('bounded fork work started')\n`;
  await runtime.tools.find(tool => tool.name === 'bash')!.execute('fork-during-close', { command: "python3 - <<'PY'\n" + script + 'PY' }, undefined, undefined, {} as never);
  const deadline = Date.now() + 2000;
  for (;;) { try { await readFile(path.join(f.work, 'fork-ready.txt')); break; } catch {} assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  await runtime.close(); await new Promise(resolve => setTimeout(resolve, 700));
  for (let i = 0; i < 40; i++) await assert.rejects(readFile(path.join(f.work, 'fork-late-' + i)), /ENOENT/);
});

test('sandboxed arbitrary code cannot signal or acquire the trusted guardian and cannot upgrade result IPC to control', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  const f = await fixture(), runtime = await createProtectedTools({ scope: f.scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] }); t.after(() => runtime.close());
  const code = `import ctypes,os,json\nparent=int(os.environ['OPTRACALL_EXECUTION_SUPERVISOR_PID'])\ntry:\n os.kill(parent,18); print('guardian-signal:UNEXPECTED')\nexcept PermissionError:print('guardian-signal:DENIED')\nlib=ctypes.CDLL(None,use_errno=True)\nport=ctypes.c_uint32()\nresult=lib.task_for_pid(lib.mach_task_self(),parent,ctypes.byref(port))\nprint('guardian-task-port:'+('DENIED' if result else 'UNEXPECTED'))\nresult=lib.ptrace(10,parent,None,0)\nif result==0:lib.ptrace(11,parent,ctypes.c_void_p(1),0)\nprint('guardian-ptrace:'+('DENIED' if result else 'UNEXPECTED'))\nprint(json.dumps({'kind':'protected.close','event':{'role':'assistant'},'result':{'content':[]}}))\n`;
  const result = await runtime.tools.find(tool => tool.name === 'bash')!.execute('guardian-boundary', { command: "python3 - <<'PY'\n" + code + "PY" }, undefined, undefined, {} as never);
  const text = JSON.stringify(result.content); assert.match(text, /guardian-signal:DENIED/); assert.match(text, /guardian-task-port:DENIED/); assert.match(text, /guardian-ptrace:DENIED/); assert.doesNotMatch(text, /UNEXPECTED/); assert.match(text, /protected.close/);
  const alive = await runtime.tools.find(tool => tool.name === 'bash')!.execute('after-forged-control', { command: 'python3 -c "print(42)"' }, undefined, undefined, {} as never);
  assert.match(JSON.stringify(alive.content), /42/);
});

test('cancelled tool execution closes its owned process and cannot continue writing', { skip: process.platform !== 'darwin', timeout: 20_000 }, async t => {
  const f = await fixture(), runtime = await createProtectedTools({ scope: f.scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] });
  t.after(() => runtime.close());
  const controller = new AbortController(), tool = runtime.tools.find(item => item.name === 'bash')!;
  const pending = tool.execute('cancel-call', { command: "python3 -c 'import time; time.sleep(30)'" }, controller.signal, undefined, {} as never);
  setTimeout(() => controller.abort(), 300);
  await assert.rejects(pending, /aborted|cancelled/i);
  await runtime.close();
  await assert.rejects(tool.execute('late-call', { command: 'true' }, undefined, undefined, {} as never), /protected_executor_closed/);
});

test('arbitrary Python and nested Node cannot detach from the owned execution group', { skip: process.platform !== 'darwin', timeout: 35_000 }, async t => {
  const f = await fixture(), runtime = await createProtectedTools({ scope: f.scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] });
  t.after(() => runtime.close());
  const bash = runtime.tools.find(tool => tool.name === 'bash')!;
  const script = `import ctypes, errno, os, subprocess, sys\npid = os.fork()\nif pid == 0:\n    for label, operation in [('setsid', os.setsid), ('setpgid', lambda: os.setpgid(0, 0))]:\n        try:\n            operation(); print(label + ':ESCAPED', flush=True)\n        except OSError as error:\n            print(label + ':DENIED:' + str(error.errno), flush=True)\n    libc = ctypes.CDLL(None, use_errno=True)\n    result = libc.syscall(147)\n    print('raw-setsid:' + ('DENIED' if result == -1 and ctypes.get_errno() == errno.EPERM else 'ESCAPED'), flush=True)\n    os._exit(0)\nos.waitpid(pid, 0)\nfor label, attributes in [('spawn-pgroup', {'setpgroup': 0}), ('spawn-session', {'setsid': True}), ('spawn-plain', {})]:\n    try:\n        pid = os.posix_spawn(sys.executable, [sys.executable, '-c', 'pass'], os.environ, **attributes)\n        os.waitpid(pid, 0); print(label + ':ESCAPED', flush=True)\n    except OSError as error:\n        print(label + ':DENIED:' + str(error.errno), flush=True)\nprint('python-runtime:' + str(sum([20, 22])), flush=True)\nsubprocess.run(['/bin/echo', 'python-subprocess:42'], check=True)\n`;
  const result = await bash.execute('detach-python', { command: "python3 - <<'PY'\n" + script + 'PY' }, undefined, undefined, {} as never);
  const text = JSON.stringify(result.content);
  for (const label of ['setsid', 'setpgid', 'raw-setsid', 'spawn-pgroup', 'spawn-session', 'spawn-plain']) assert.match(text, new RegExp(label + ':DENIED'), label + ': ' + text);
  assert.doesNotMatch(text, /ESCAPED/);
  assert.match(text, /python-runtime:42/); assert.match(text, /python-subprocess:42/);
  const nested = await bash.execute('detach-node', { command: `node - <<'JS'\nconst cp = require('node:child_process');\nconst script = 'import os; print(str(os.getpgrp()) + ":" + str(os.getsid(0)))';\nconst own = cp.spawnSync('python3', ['-c', script], { encoding: 'utf8' });\nconst requested = cp.spawnSync('python3', ['-c', script], { encoding: 'utf8', detached: true });\nif (own.status !== 0 || requested.status !== 0 || own.stdout !== requested.stdout) throw new Error('NODE_DETACHED_ESCAPE:' + JSON.stringify({own,requested}));\nconsole.log('nested-node:same-owned-group');\nJS` }, undefined, undefined, {} as never);
  assert.match(JSON.stringify(nested.content), /nested-node:same-owned-group/);
  assert.doesNotMatch(JSON.stringify(nested.content), /NODE_DETACHED_ESCAPE/);
});

test('guardian loss preserves UNKNOWN without signalling a potentially reused group; explicit close can prove later absence', { skip: process.platform !== 'darwin', timeout: 15_000 }, async () => {
  const f = await fixture(), runtime = await createProtectedTools({ scope: f.scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] });
  const command = `python3 - <<'PY'\nimport json,os,time\npid=os.fork()\nif pid==0:\n time.sleep(3); os._exit(0)\nprint(json.dumps({'guardian':int(os.environ['OPTRACALL_EXECUTION_SUPERVISOR_PID']),'group':os.getpgrp()}))\nPY`;
  const result = await runtime.tools.find(tool => tool.name === 'bash')!.execute('lost-supervisor', { command }, undefined, undefined, {} as never);
  const text = result.content.filter((value: any) => value.type === 'text').map((value: any) => value.text).join('');
  const identity = JSON.parse(text.match(/\{[^\n]*"guardian"[^\n]*\}/)![0]);
  process.kill(identity.guardian, 'SIGKILL');
  await new Promise(resolve => setTimeout(resolve, 100));
  const originalKill = process.kill; let staleSignals = 0;
  process.kill = function (pid, signal) { if (pid < 0 && signal !== 0) { staleSignals++; throw new Error('no stale group signal allowed'); } return originalKill.call(process, pid, signal); };
  try {
    await assert.rejects(runtime.close(), /protected_cleanup_unknown/);
    await assert.rejects(runtime.tools.find(tool => tool.name === 'write')!.execute('no-later-call', { path: 'later.md', content: 'must not run' }, undefined, undefined, {} as never), /protected_cleanup_unknown/);
    await assert.rejects(readFile(path.join(f.work, 'later.md')), /ENOENT/);
    await new Promise(resolve => setTimeout(resolve, 3300));
    await runtime.close(); assert.equal(staleSignals, 0);
    await assert.rejects(runtime.tools.find(tool => tool.name === 'write')!.execute('still-closed', { path: 'later.md', content: 'must not run' }, undefined, undefined, {} as never), /protected_executor_closed/);
  } finally { process.kill = originalKill; await runtime.close(); }
});

test('nested detached requests remain owned while background work persists until scope close', { skip: process.platform !== 'darwin', timeout: 15_000 }, async t => {
  const f = await fixture(), runtime = await createProtectedTools({ scope: f.scope, codeRoot: process.cwd(), forbiddenRoots: [f.secrets] });
  t.after(() => runtime.close());
  const script = `import os,time\nopen('detached-ready.txt','w').write(str(os.getpgrp()))\ntime.sleep(1.2)\nopen('detached-late.txt','w').write('unsafe late output')\n`;
  const code = `const fs=require('node:fs'),cp=require('node:child_process');\nconst child=cp.spawn('python3',['-c',${JSON.stringify(script)}],{detached:true,stdio:'ignore'});child.unref();\nconst deadline=Date.now()+5000;while(!fs.existsSync('detached-ready.txt')&&Date.now()<deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);\nif(!fs.existsSync('detached-ready.txt')) throw new Error('child did not initialize');console.log('nested child initialized');`;
  const bash = runtime.tools.find(tool => tool.name === 'bash')!;
  const result = await bash.execute('detached-background', { command: "node <<'JS'\n" + code + '\nJS' }, undefined, undefined, {} as never);
  assert.match(JSON.stringify(result.content), /nested child initialized/);
  await runtime.close();
  await new Promise(resolve => setTimeout(resolve, 1400));
  await assert.rejects(readFile(path.join(f.work, 'detached-late.txt')), /ENOENT/);
  assert.ok(runtime.pythonRuntimes.some(item => item.command === 'python3' && /^3\./.test(item.version) && path.isAbsolute(item.executable)));
});
