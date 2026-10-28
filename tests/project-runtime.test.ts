import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectAgent } from '../src/agent/project-runtime.ts';
import { startSyntheticProvider } from './fixtures/synthetic-provider.ts';
import { ConfigurationStore } from '../src/host/config-store.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { SessionManager } from '../src/agent/sdk.ts';
import { createBrowserUIContext } from '../src/agent/browser-ui-context.ts';

async function fixture(t: TestContext, key = 'synthetic-only-key') {
  const provider = await startSyntheticProvider();
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-project-session-'));
  const projectDirectory = path.join(scratch, 'project');
  for (const name of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, name), { recursive: true });
  const options = { projectId: 'native-session', projectDirectory, sessionDirectory: path.join(scratch, 'sessions'), resourceRoot: path.join(scratch, 'resources'), codeRoot: process.cwd(), managementPorts: [4173, 4174, 4175], configuration: { id: 'synthetic', name: 'Synthetic', revision: 1, provider: 'synthetic', api: 'openai-completions' as const, baseUrl: provider.baseUrl, model: 'synthetic-model', apiKey: key } };
  const agents: ProjectAgent[] = [];
  const create = (sessionFile?: string, draft?: string) => { const agent = new ProjectAgent({ ...options, ...(sessionFile ? { sessionFile } : {}), ...(draft === undefined ? {} : { draft }) }); agents.push(agent); return agent; };
  t.after(async () => { for (const agent of agents) await agent.close(); await provider.close(); await rm(scratch, { recursive: true, force: true }); });
  return { provider, create, options };
}
const messageText = (messages: Record<string, any>[]) => messages.map(message => typeof message.content === 'string' ? message.content : (message.content ?? []).filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')).join('\n');
function scalarStrings(value: unknown): string[] { if (typeof value === 'string') return [value]; if (Array.isArray(value)) return value.flatMap(scalarStrings); if (value && typeof value === 'object') return Object.values(value).flatMap(scalarStrings); return []; }
async function within<T>(promise: Promise<T>, message: string, milliseconds = 2000): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); } finally { if (timer) clearTimeout(timer); } }
async function until<T>(read: () => T | undefined, message: string): Promise<T> { const deadline = Date.now() + 2000; return new Promise<T>((resolve, reject) => { const check = () => { const result = read(); if (result !== undefined) { resolve(result); return; } if (Date.now() >= deadline) { reject(new Error(message)); return; } setTimeout(check, 5); }; check(); }); }

test('SDK-04: a project exposes the complete native macOS toolset and bundled harness', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-native-'));
  const projectDirectory = path.join(scratch, 'project');
  for (const name of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, name), { recursive: true });
  const agent = new ProjectAgent({ projectId: 'native-tools', projectDirectory, sessionDirectory: path.join(scratch, 'sessions'), resourceRoot: path.join(scratch, 'resources'), codeRoot: process.cwd(), managementPorts: [4173, 4174, 4175], configuration: { id: 'synthetic', name: 'Synthetic', revision: 1, provider: 'synthetic', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-model', apiKey: 'synthetic-only-key' } });
  try {
    const snapshot = await agent.open();
    for (const tool of ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'codemode', 'tool_search']) assert.ok(snapshot.tools.includes(tool), `native tool ${tool} must be available`);
  } finally { await agent.close(); }
});

test('SDK-04: fork creates an actual native session, restores the selected branch and rebinds its event stream', async t => {
  const f = await fixture(t), agent = f.create();
  await agent.open();
  await agent.start('FIRST_USER_MESSAGE', 'fork-first').completion;
  await agent.start('SECOND_USER_MESSAGE', 'fork-second').completion;
  const before = await agent.snapshot();
  const selector = await agent.command('/fork');
  const selected = selector.result.entries.find((entry: any) => entry.text === 'SECOND_USER_MESSAGE');
  assert.ok(selected?.entryId);
  const forked = await agent.command(`/fork ${selected.entryId}`);
  assert.equal(forked.result.cancelled, false);
  assert.notEqual(forked.snapshot.sessionFile, before.sessionFile);
  assert.notEqual(forked.snapshot.sessionId, before.sessionId);
  assert.match(messageText(forked.snapshot.messages), /FIRST_USER_MESSAGE/);
  assert.doesNotMatch(messageText(forked.snapshot.messages), /SECOND_USER_MESSAGE/);
  const events: any[] = []; agent.subscribe(event => events.push(event));
  await agent.start('BRANCH_USER_MESSAGE', 'fork-third').completion;
  assert.ok(events.some(event => event.type === 'run.settled' && event.requestId === 'fork-third' && event.outcome === 'completed'));
  const request = JSON.stringify(f.provider.requests.at(-1)!.body.messages);
  assert.match(request, /FIRST_USER_MESSAGE/); assert.match(request, /BRANCH_USER_MESSAGE/); assert.doesNotMatch(request, /SECOND_USER_MESSAGE/);
  const branchSelector = await agent.command('/fork');
  const branchEntry = branchSelector.result.entries.find((entry: any) => entry.text === 'FIRST_USER_MESSAGE');
  const branched = await agent.command(`/branch ${branchEntry.entryId}`);
  assert.equal(branched.result.cancelled, false);
  assert.equal(branched.snapshot.sessionFile, forked.snapshot.sessionFile);
});

test('SDK-04: SDK custom run records survive reopen and preserve known completion', async t => {
  const f = await fixture(t), agent = f.create(); await agent.open();
  const result = await agent.start('Persist this ordinary reply.', 'persisted-run').completion;
  assert.equal(result.outcome, 'completed');
  const snapshot = await agent.snapshot();
  assert.deepEqual(snapshot.lastRun, { requestId: 'persisted-run', outcome: 'completed' });
  const entries = (await readFile(snapshot.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const markers = entries.filter(entry => entry.type === 'custom' && entry.customType === 'optracall.run');
  assert.deepEqual(markers.map(entry => entry.data.phase), ['started', 'settled']);
  assert.equal(markers[1].data.requestId, 'persisted-run');
  await agent.close();
  const reopened = await f.create(snapshot.sessionFile).open();
  assert.deepEqual(reopened.lastRun, { requestId: 'persisted-run', outcome: 'completed' });
  assert.match(messageText(reopened.messages), /Persist this ordinary reply/);
});

test('SDK-04: streamed split secrets and completed native history are masked before IPC and persistence', async t => {
  const key = 'literal-"!$-synthetic-secret', f = await fixture(t, key), agent = f.create();
  f.provider.setChunks(['Before literal-"!', '$-synthetic-', 'secret after.']);
  const events: any[] = []; agent.subscribe(event => events.push(event));
  await agent.open(); await agent.start('Reply briefly.', 'redaction-run').completion;
  const deltaText = events.filter(event => event.type === 'text.delta').map(event => event.text).join('');
  assert.doesNotMatch(deltaText, /literal-"!\$-synthetic-secret/); assert.match(deltaText, /密钥已隐藏/);
  const snapshot = await agent.snapshot();
  assert.ok(scalarStrings(snapshot).every(value => !value.includes(key)));
  const entries = (await readFile(snapshot.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(scalarStrings(entries).every(value => !value.includes(key)));
});

test('SDK-04: cancellation settles once, stores its known outcome, and soft directory guidance reaches the provider', async t => {
  const f = await fixture(t), agent = f.create(); f.provider.setMode('slow');
  const events: any[] = []; agent.subscribe(event => events.push(event));
  await agent.open(); const running = agent.start('Read the prepared synthetic materials.', 'cancelled-run');
  await f.provider.waitForRequests(1); await agent.stop();
  assert.equal((await running.completion).outcome, 'cancelled');
  assert.equal(events.filter(event => event.type === 'run.settled' && event.requestId === 'cancelled-run').length, 1);
  const snapshot = await agent.snapshot();
  assert.deepEqual(snapshot.lastRun, { requestId: 'cancelled-run', outcome: 'cancelled' });
  const request = JSON.stringify(f.provider.requests[0].body.messages);
  assert.match(request, /do not read data in 010_draw/);
  assert.match(request, /020_clean/); assert.match(request, /060_reports/);
});

test('SDK-04: actual Host configuration and project stores open a UUID custom provider with a literal key', async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-store-native-'));
  const dataRoot = path.join(scratch, 'private'), projects = new ProjectStore({ dataRoot, projectsRoot: path.join(scratch, 'projects') });
  t.after(async () => { await projects.close(); await rm(scratch, { recursive: true, force: true }); });
  const configurations = new ConfigurationStore({ dataRoot }); await configurations.init();
  const saved = await configurations.save({ name: 'UUID自定义合成模型', provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-model', apiKey: '!literal-test-key' });
  await projects.init(); const project = await projects.create({ name: 'UUID项目', configuration: saved });
  const configuration = configurations.snapshot(saved.id, saved.revision); assert.ok(configuration);
  const agent = new ProjectAgent({ projectId: project.id, projectDirectory: project.rootPath, sessionDirectory: project.sessionDirectory, resourceRoot: path.join(dataRoot, 'pi'), codeRoot: process.cwd(), managementPorts: [4173, 4174, 4175], configuration });
  t.after(() => agent.close());
  try { const snapshot = await agent.open(); assert.ok(snapshot.tools.includes('codemode')); }
  catch (error) { assert.fail(`UUID native open failed: ${JSON.stringify((error as Error).cause)}`); }
});

test('SDK-04: native resource reload keeps tools active and inspection commands do not issue model calls', async t => {
  const f = await fixture(t), agent = f.create(); await agent.open();
  for (const command of ['/tools', '/session', '/tree', '/skills', '/prompts', '/reload']) await agent.command(command);
  assert.equal(f.provider.requests.length, 0);
  const snapshot = await agent.snapshot();
  for (const tool of ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'codemode', 'tool_search']) assert.ok(snapshot.tools.includes(tool), `${tool} remains active after native reload`);
  assert.equal((await agent.start('A normal reply after reload.', 'after-reload').completion).outcome, 'completed');
});

test('SDK-04: native error messages are masked in events and JSONL and do not reuse an old successful reply', async t => {
  const key = 'synthetic-error-secret', f = await fixture(t, key), agent = f.create(); await agent.open();
  await agent.start('First successful reply.', 'before-failure').completion;
  f.provider.setMode('failure');
  const events: any[] = []; agent.subscribe(event => events.push(event));
  const result = await agent.start('The next request fails authentication.', 'failed-run').completion;
  assert.equal(result.outcome, 'failed'); assert.equal(result.text, '');
  const snapshot = await agent.snapshot();
  assert.deepEqual(snapshot.lastRun, { requestId: 'failed-run', outcome: 'failed' });
  const entries = (await readFile(snapshot.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(scalarStrings([entries, events, snapshot, result]).every(value => !value.includes(key)));
  assert.equal(f.provider.requests.length, 2, 'Authentication failure is not automatically retried by the native SDK.');
});

test('SDK-04: an unfinished native marker reopens as unknown without replaying a model request', async t => {
  const f = await fixture(t), agent = f.create(); await agent.open();
  await agent.start('Create real native history.', 'finished-before-interruption').completion;
  const snapshot = await agent.snapshot(); await agent.close();
  const manager = SessionManager.open(snapshot.sessionFile!, f.options.sessionDirectory, path.join(f.options.projectDirectory, '020_clean'));
  manager.appendCustomEntry('optracall.run', { phase: 'started', requestId: 'unfinished-run', sessionId: manager.getSessionId() });
  const requestCount = f.provider.requests.length;
  const reopened = await f.create(snapshot.sessionFile).open();
  assert.deepEqual(reopened.lastRun, { requestId: 'unfinished-run' });
  assert.equal(reopened.status, 'idle'); assert.equal(f.provider.requests.length, requestCount);
});

test('SDK-04: closing an SDK child already terminated by a signal completes without waiting for another exit', { timeout: 10_000 }, async t => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'optracall-signal-exit-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const projectDirectory = path.join(scratch, 'project'), resourceRoot = path.join(scratch, 'resources');
  for (const name of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, name), { recursive: true });
  await mkdir(path.join(resourceRoot, 'extensions'), { recursive: true });
  await writeFile(path.join(resourceRoot, 'extensions', 'terminate-on-start.ts'), "export default function (pi) { pi.on('session_start', async () => { process.kill(process.pid, 'SIGTERM'); await new Promise(() => {}); }); }\n");
  const agent = new ProjectAgent({ projectId: 'signal-exit', projectDirectory, resourceRoot, sessionDirectory: path.join(scratch, 'sessions'), codeRoot: process.cwd(), managementPorts: [], configuration: { id: 'signal-fixture', name: 'Synthetic signal fixture', revision: 1, provider: 'synthetic', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-model', apiKey: 'synthetic-no-model-call' } });
  await assert.rejects(agent.open(), /runtime_process_stopped|runtime_start_failed/);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([agent.close(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('An already signal-exited SDK child must close within 1000 ms.')), 1000); })]); }
  finally { if (timer) clearTimeout(timer); }
});

test('SDK-04: the first inspect command persists its Host request identity and emits acceptance and one terminal', async t => {
  const f = await fixture(t), agent = f.create(); await agent.open();
  const events: any[] = []; agent.subscribe(event => events.push(event));
  const id = randomUUID(); const pending = agent.command('/tools', id); void pending.catch(() => {});
  const result = await within(pending, 'A native inspect command must be accepted and completed.');
  assert.equal(result.outcome, 'completed');
  assert.equal(events.filter(event => event.type === 'run.accepted' && event.requestId === id).length, 1);
  assert.equal(events.filter(event => event.type === 'run.settled' && event.requestId === id && event.outcome === 'completed').length, 1);
  assert.deepEqual(result.snapshot.lastRun, { requestId: id, outcome: 'completed' });
  assert.equal(f.provider.requests.length, 0);
  const entries = (await readFile(result.snapshot.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(entries.filter(entry => entry.type === 'custom' && entry.customType === 'optracall.run').map(entry => entry.data.phase), ['started', 'settled']);
  await agent.close();
  assert.deepEqual((await f.create(result.snapshot.sessionFile).open()).lastRun, { requestId: id, outcome: 'completed' });
});

test('SDK-04: a slash prompt keeps the Host request id, streams under it and can be stopped', async t => {
  const f = await fixture(t), agent = f.create(); f.provider.setMode('slow'); await agent.open();
  const events: any[] = []; agent.subscribe(event => events.push(event));
  const id = randomUUID(), pending = agent.command('/UNKNOWN_SYNTHETIC prompt', id); void pending.catch(() => {});
  await f.provider.waitForRequests(1);
  await until(() => events.find(event => event.type === 'text.delta' && event.requestId === id), 'Slash output must use the accepted Host request id.');
  assert.equal(agent.busy, true); assert.equal((await agent.snapshot()).status, 'running');
  await within(agent.stop(), 'Stopping a slash prompt must release the actual SDK run.');
  const result = await within(pending, 'A stopped slash command must settle.');
  assert.equal(result.outcome, 'cancelled');
  assert.deepEqual(result.snapshot.lastRun, { requestId: id, outcome: 'cancelled' });
  assert.equal(events.filter(event => event.type === 'run.settled' && event.requestId === id).length, 1);
});

test('SDK-04: installed extension dialogs wait for browser responses and restore all pending questions in snapshots', async t => {
  const f = await fixture(t); await mkdir(path.join(f.options.resourceRoot, 'extensions'), { recursive: true });
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'browser-dialogs.ts'), `export default function(pi){pi.registerCommand('browser-dialogs',{description:'Synthetic browser UI check',handler:async(_args,ctx)=>{const values={hasUI:ctx.hasUI,choice:await ctx.ui.select('Choose synthetic option',['A','B']),confirmed:await ctx.ui.confirm('Synthetic confirmation','Continue this synthetic test?'),input:await ctx.ui.input('Synthetic input','Enter text'),edited:await ctx.ui.editor('Synthetic editor','Initial text')};ctx.ui.notify('Synthetic notice','info');ctx.ui.setStatus('synthetic-status','Ready');pi.sendMessage({customType:'browser-dialog-result',content:JSON.stringify(values),display:true});}});}\n`);
  const agent = f.create(); await agent.open(); const events: any[] = []; agent.subscribe(event => events.push(event));
  let completed = false; const pending = agent.command('/browser-dialogs', randomUUID()).finally(() => { completed = true; }); void pending.catch(() => {});
  const seen = new Set<string>();
  for (const [method, value] of [['select', 'B'], ['confirm', false], ['input', 'User input'], ['editor', 'Edited text']] as const) {
    const event = await until(() => events.find(item => item.type === 'ui.request' && item.request.method === method && !seen.has(item.request.id)), `Native ${method} must request an actual browser answer.`);
    seen.add(event.request.id); assert.equal(completed, false);
    const snapshot = await agent.snapshot(); assert.equal(snapshot.uiRequests?.some(request => request.id === event.request.id), true);
    assert.equal((await agent.respondUI({ id: event.request.id, value })).accepted, true);
  }
  const result = await within(pending, 'An answered native UI command must continue.');
  assert.equal(result.outcome, 'completed'); assert.deepEqual(result.snapshot.uiRequests, []);
  const custom = result.snapshot.messages.find((message: any) => message.role === 'custom' && message.customType === 'browser-dialog-result');
  assert.deepEqual(JSON.parse(custom.content), { hasUI: true, choice: 'B', confirmed: false, input: 'User input', edited: 'Edited text' });
  assert.ok(events.some(event => event.type === 'ui.notification' && event.message === 'Synthetic notice'));
  assert.ok(events.some(event => event.type === 'ui.status' && event.key === 'synthetic-status' && event.text === 'Ready'));
  assert.equal(f.provider.requests.length, 0);
});

test('SDK-04: stop dismisses a waiting browser question, rejects stale answers and settles cancelled exactly once', async t => {
  const f = await fixture(t); await mkdir(path.join(f.options.resourceRoot, 'extensions'), { recursive: true });
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'browser-cancel.ts'), "export default function(pi){pi.registerCommand('browser-cancel',{description:'Synthetic cancellation',handler:async(_args,ctx)=>{await ctx.ui.confirm('Question waiting for user','This has not been answered.');}});}\n");
  const agent = f.create(); await agent.open(); const events: any[] = []; agent.subscribe(event => events.push(event));
  const id = randomUUID(), pending = agent.command('/browser-cancel', id); void pending.catch(() => {});
  const request = await until(() => events.find(event => event.type === 'ui.request')?.request, 'The browser question must remain pending.');
  await within(agent.stop(), 'Stop must release pending native UI.');
  assert.equal((await pending).outcome, 'cancelled');
  assert.deepEqual((await agent.snapshot()).uiRequests, []);
  assert.equal((await agent.respondUI({ id: request.id, value: true })).accepted, false);
  assert.equal(events.filter(event => event.type === 'ui.dismiss' && event.id === request.id).length, 1);
  assert.equal(events.filter(event => event.type === 'run.settled' && event.requestId === id && event.outcome === 'cancelled').length, 1);
});

test('SDK-04: an empty native fork preserves its original header lineage and never rewrites the existing source tree', async t => {
  const f = await fixture(t), agent = f.create(); await agent.open();
  await agent.start('The original first user message.', 'empty-fork-source').completion;
  const selector = await agent.command('/fork'), entry = selector.result.entries[0];
  const before = await agent.snapshot(), sourceBytes = await readFile(before.sessionFile!, 'utf8');
  const id = randomUUID(), events: any[] = []; agent.subscribe(event => events.push(event));
  const forked = await agent.command(`/fork ${entry.entryId}`, id);
  assert.equal(forked.outcome, 'completed'); assert.equal(forked.snapshot.messages.some((message: any) => message.role === 'user' || message.role === 'assistant'), false);
  assert.notEqual(forked.snapshot.sessionFile, before.sessionFile);
  const forkBytes = await readFile(forked.snapshot.sessionFile, 'utf8'), header = JSON.parse(forkBytes.split('\n')[0]);
  assert.equal(header.id, forked.snapshot.sessionId); assert.equal(header.parentSession, before.sessionFile);
  assert.equal((await readFile(before.sessionFile!, 'utf8')).startsWith(sourceBytes), true, 'Existing native entries must remain byte-for-byte intact.');
  const markers = forkBytes.trim().split('\n').map(line => JSON.parse(line)).filter(entry => entry.type === 'custom' && entry.customType === 'optracall.run' && entry.data.requestId === id && entry.data.sessionId === header.id);
  assert.deepEqual(markers.map(entry => entry.data.phase), ['started', 'settled']);
  assert.equal(events.filter(event => event.type === 'run.accepted' && event.requestId === id).length, 1);
  await agent.close(); const reopenedAgent = f.create(forked.snapshot.sessionFile), reopened = await reopenedAgent.open();
  assert.equal(reopened.sessionId, header.id); assert.deepEqual(reopened.lastRun, { requestId: id, outcome: 'completed' });
  assert.equal((await reopenedAgent.start('New user message in the empty fork.', 'empty-fork-next').completion).outcome, 'completed', 'Pi must append after initial export without EEXIST.');
  assert.equal((await readFile(reopened.sessionFile!, 'utf8')).startsWith(forkBytes), true);
});

test('SDK-04: a session-start extension can receive a browser answer before open has completed', async t => {
  const f = await fixture(t); await mkdir(path.join(f.options.resourceRoot, 'extensions'), { recursive: true });
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'startup-question.ts'), "export default function(pi){pi.on('session_start',async(_event,ctx)=>{await ctx.ui.confirm('Startup synthetic question','Answer before the SDK session is opened.');});}\n");
  const agent = f.create(), events: any[] = []; agent.subscribe(event => events.push(event));
  let opened = false; const pending = agent.open().then(value => { opened = true; return value; }); void pending.catch(() => {});
  const request = await until(() => events.find(event => event.type === 'ui.request')?.request, 'The startup browser question must be forwarded before open resolves.');
  assert.equal(opened, false);
  assert.equal((await agent.respondUI({ id: request.id, value: true })).accepted, true);
  assert.deepEqual((await within(pending, 'A startup answer must release open.')).uiRequests, []);
  assert.equal(f.provider.requests.length, 0);
});

test('SDK-04: multiple browser questions retain their ids and user cancellation is not a false confirmation', async t => {
  const f = await fixture(t); await mkdir(path.join(f.options.resourceRoot, 'extensions'), { recursive: true });
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'parallel-questions.ts'), "export default function(pi){pi.registerCommand('parallel-questions',{description:'Synthetic parallel dialogs',handler:async(_args,ctx)=>{await Promise.all([ctx.ui.select('First question',['A','B']),ctx.ui.confirm('Second question','Explicit response required.')]);}});}\n");
  const agent = f.create(); await agent.open(); const events: any[] = []; agent.subscribe(event => events.push(event));
  const id = randomUUID(), pending = agent.command('/parallel-questions', id); void pending.catch(() => {});
  await until(() => events.filter(event => event.type === 'ui.request').length === 2 ? true : undefined, 'Both native dialogs must stay pending.');
  const questions = (await agent.snapshot()).uiRequests!; assert.equal(questions.length, 2);
  const select = questions.find(question => question.method === 'select')!, confirm = questions.find(question => question.method === 'confirm')!;
  assert.equal((await agent.respondUI({ id: select.id, value: 'not-an-option' })).accepted, false);
  assert.equal((await agent.snapshot()).uiRequests!.length, 2);
  assert.equal((await agent.respondUI({ id: confirm.id, cancelled: true })).accepted, true);
  assert.equal((await within(pending, 'User cancellation must settle the command.')).outcome, 'cancelled');
  assert.equal((await agent.snapshot()).uiRequests!.length, 0);
  assert.equal(events.filter(event => event.type === 'run.settled' && event.requestId === id).length, 1);
  assert.equal(events.filter(event => event.type === 'ui.dismiss').length, 2);
});

test('SDK-04: terminal-only custom UI reports unsupported instead of pretending to render successfully', async t => {
  const f = await fixture(t); await mkdir(path.join(f.options.resourceRoot, 'extensions'), { recursive: true });
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'terminal-only.ts'), "export default function(pi){pi.registerCommand('terminal-only',{description:'Synthetic TUI-only dialog',handler:async(_args,ctx)=>{await ctx.ui.custom(()=>{throw new Error('This terminal factory must not be invoked.');});}});}\n");
  const agent = f.create(); await agent.open(); const events: any[] = []; agent.subscribe(event => events.push(event));
  const result = await agent.command('/terminal-only', randomUUID());
  assert.equal(result.outcome, 'failed');
  assert.ok(events.some(event => event.type === 'ui.notification' && /not supported/.test(event.message)));
  assert.deepEqual(result.snapshot.uiRequests, []); assert.equal(f.provider.requests.length, 0);
});

test('SDK-04: a native compact command owns the Host run and public stop aborts its actual model request', async t => {
  const f = await fixture(t); await mkdir(f.options.resourceRoot, { recursive: true });
  await writeFile(path.join(f.options.resourceRoot, 'settings.json'), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 16 } }));
  const agent = f.create(); await agent.open();
  await agent.start('Earlier synthetic conversation to summarize.', 'compact-before-1').completion;
  await agent.start('A later synthetic message to retain.', 'compact-before-2').completion;
  f.provider.setMode('slow'); const events: any[] = []; agent.subscribe(event => events.push(event));
  const id = randomUUID(), pending = agent.command('/compact', id); void pending.catch(() => {});
  await f.provider.waitForRequests(3);
  assert.equal(agent.busy, true); assert.equal((await agent.snapshot()).status, 'running');
  assert.ok(events.some(event => event.type === 'native' && event.event.type === 'compaction_start' && event.requestId === id));
  await within(agent.stop(), 'Stop must abort native manual compaction.');
  assert.equal((await within(pending, 'Cancelled compaction must settle.')).outcome, 'cancelled');
  await until(() => f.provider.requests[2].closedEarly ? true : undefined, 'The compaction provider connection must actually be aborted.');
  assert.deepEqual((await agent.snapshot()).lastRun, { requestId: id, outcome: 'cancelled' });
  assert.equal(events.filter(event => event.type === 'run.settled' && event.requestId === id).length, 1);
});

test('SDK-04: dialog timeout and project close both dismiss pending UI without turning cancellation into an answer', async t => {
  const f = await fixture(t); await mkdir(path.join(f.options.resourceRoot, 'extensions'), { recursive: true });
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'browser-timeout.ts'), "export default function(pi){pi.registerCommand('browser-timeout',{description:'Synthetic dialog timeout',handler:async(_args,ctx)=>{await ctx.ui.input('Expiring synthetic question','No default answer',{timeout:40});}});pi.registerCommand('browser-wait',{description:'Synthetic close cancellation',handler:async(_args,ctx)=>{await ctx.ui.editor('Wait until project close','Not submitted');}});}\n");
  const agent = f.create(); await agent.open(); const events: any[] = []; agent.subscribe(event => events.push(event));
  assert.equal((await agent.command('/browser-timeout', randomUUID())).outcome, 'cancelled');
  assert.equal((await agent.snapshot()).uiRequests!.length, 0);
  const id = randomUUID(), pending = agent.command('/browser-wait', id); void pending.catch(() => {});
  const event = await until(() => events.find(event => event.type === 'ui.request' && event.request.method === 'editor'), 'The editor must wait for an explicit user response.');
  await within(agent.close(), 'Closing a project must dismiss native UI and release the SDK child.');
  assert.equal((await within(pending, 'A closed pending command must settle.')).outcome, 'cancelled');
  assert.equal(events.filter(item => item.type === 'ui.dismiss' && item.id === event.request.id).length, 1);
  assert.equal(events.filter(item => item.type === 'run.settled' && item.requestId === id).length, 1);
});

test('SDK-04: stop aborts the native branch summary requested by an installed extension', async t => {
  const f = await fixture(t); await mkdir(path.join(f.options.resourceRoot, 'extensions'), { recursive: true });
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'native-branch-summary.ts'), "export default function(pi){pi.registerCommand('native-branch-summary',{description:'Synthetic native tree summary',handler:async(_args,ctx)=>{const entry=ctx.sessionManager.getEntries().find(entry=>entry.type==='message'&&entry.message.role==='user');await ctx.navigateTree(entry.id,{summarize:true});}});}\n");
  const agent = f.create(); await agent.open();
  await agent.start('First branch message.', 'branch-before-1').completion;
  await agent.start('Second branch message to summarize.', 'branch-before-2').completion;
  f.provider.setMode('slow'); const events: any[] = []; agent.subscribe(event => events.push(event));
  const id = randomUUID(), pending = agent.command('/native-branch-summary', id); void pending.catch(() => {});
  await f.provider.waitForRequests(3);
  assert.equal((await agent.snapshot()).status, 'running');
  await within(agent.stop(), 'Stop must abort the native branch summary.');
  assert.equal((await within(pending, 'The stopped native branch command must settle.')).outcome, 'cancelled');
  await until(() => f.provider.requests[2].closedEarly ? true : undefined, 'The branch summary model connection must be aborted.');
  assert.equal(events.filter(event => event.type === 'run.settled' && event.requestId === id).length, 1);
});

test('SDK-04: the RPC editor mirror replaces text and Host synchronization does not emit another editor update', () => {
  const events: any[] = [], adapter = createBrowserUIContext({ emit: event => events.push(event), initialEditorText: 'Initial Host draft' });
  assert.equal(adapter.context.getEditorText(), 'Initial Host draft');
  adapter.updateEditorState('A newer Host draft'); assert.deepEqual(events, []);
  adapter.context.setEditorText('Extension replacement');
  assert.equal(adapter.context.getEditorText(), 'Extension replacement');
  adapter.context.pasteToEditor('Paste replacement');
  assert.equal(adapter.context.getEditorText(), 'Paste replacement');
  assert.deepEqual(events, [{ type: 'ui.editor', text: 'Extension replacement' }, { type: 'ui.editor', text: 'Paste replacement' }]);
  adapter.updateEditorState('Host saved replacement'); assert.equal(events.length, 2);
  assert.equal(adapter.context.getEditorText(), 'Host saved replacement'); adapter.dispose();
});

test('SDK-04: a native extension can decorate notifications and use the RPC editor without failing its command', async t => {
  const f = await fixture(t); await mkdir(path.join(f.options.resourceRoot, 'extensions'), { recursive: true });
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'rpc-editor-compatible.ts'), "export default function(pi){pi.registerCommand('rpc-editor-compatible',{description:'Synthetic RPC editor compatibility',handler:async(_args,ctx)=>{ctx.ui.setWorkingIndicator({frames:['*']});ctx.ui.setHiddenThinkingLabel('Optional label');ctx.ui.setFooter(()=>({render:()=>[]}));ctx.ui.setHeader(()=>({render:()=>[]}));ctx.ui.setWidget('optional',()=>({render:()=>[]}));ctx.ui.setToolsExpanded(true);ctx.ui.notify(ctx.ui.theme.fg('success','Plain notification'));ctx.ui.setEditorText('First replacement');const first=ctx.ui.getEditorText();ctx.ui.pasteToEditor('Final replacement');pi.sendMessage({customType:'rpc-editor-result',content:JSON.stringify({first,final:ctx.ui.getEditorText()}),display:true});}});}\n");
  const agent = f.create(); await agent.open(); const events: any[] = []; agent.subscribe(event => events.push(event));
  const result = await agent.command('/rpc-editor-compatible', randomUUID());
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(events.filter(event => event.type === 'ui.editor').map(event => event.text), ['First replacement', 'Final replacement']);
  assert.ok(events.some(event => event.type === 'ui.notification' && event.message === 'Plain notification'));
  const custom = result.snapshot.messages.find((message: any) => message.role === 'custom' && message.customType === 'rpc-editor-result');
  assert.deepEqual(JSON.parse(custom.content), { first: 'First replacement', final: 'Final replacement' });
  assert.equal(f.provider.requests.length, 0);
});

test('SDK-04: the child receives initial and newer Host draft state without an editor event feedback loop', async t => {
  const f = await fixture(t); await mkdir(path.join(f.options.resourceRoot, 'extensions'), { recursive: true });
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'read-editor-mirror.ts'), "export default function(pi){pi.registerCommand('read-editor-mirror',{description:'Synthetic editor mirror readback',handler:async(_args,ctx)=>{pi.sendMessage({customType:'editor-mirror',content:ctx.ui.getEditorText(),display:true});}});}\n");
  const agent = f.create(undefined, 'Initial draft from Host'); await agent.open();
  const events: any[] = []; agent.subscribe(event => events.push(event));
  const read = async (target: ProjectAgent) => { const result = await target.command('/read-editor-mirror', randomUUID()); assert.equal(result.outcome, 'completed'); return result.snapshot.messages.filter((message: any) => message.role === 'custom' && message.customType === 'editor-mirror').at(-1).content; };
  assert.equal(await read(agent), 'Initial draft from Host');
  await agent.setEditorState('New user draft from Host');
  assert.equal(await read(agent), 'New user draft from Host');
  assert.equal(events.filter(event => event.type === 'ui.editor').length, 0);
  const state = await agent.snapshot(); await agent.close();
  const reopened = f.create(state.sessionFile, 'Older initial draft');
  await reopened.setEditorState('Latest state before opening'); await reopened.open();
  assert.equal(await read(reopened), 'Latest state before opening');
  assert.equal(f.provider.requests.length, 0);
});
