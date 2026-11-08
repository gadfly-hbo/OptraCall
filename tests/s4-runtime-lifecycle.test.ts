import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';

const result = { content: [{ type: 'text' as const, text: 'SYNTHETIC_CURRENT_GRAPH' }], details: { schemaVersion: 1 as const, type: 'optracall.semantic-context-result' as const, action: 'find' as const, state: 'available' as const, items: [], unknownTime: [], indexRevision: 1, coverage: { complete: true, continuation: null, gaps: [] } } };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const pause = () => new Promise(resolve => setTimeout(resolve, 30));

async function fixture(t: TestContext, overrides: Partial<ProjectAgentOptions> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-s4-resource-'));
  const projectDirectory = path.join(root, 'project'), cwd = path.join(projectDirectory, '020_clean');
  await mkdir(cwd, { recursive: true }); await mkdir(path.join(root, 'scripts'));
  const replies = path.join(root, 'replies.jsonl'); await writeFile(replies, '');
  await writeFile(path.join(root, 'scripts/project-entry.mjs'), `
    import {appendFileSync,writeFileSync} from 'node:fs';
    let prompt,options;
    const reply=(id,result)=>process.send({kind:'reply',id,result});
    process.send({kind:'ready'});
    process.on('message',m=>{
      if(m.kind==='personal-context-reply') {
        appendFileSync(${JSON.stringify(replies)},JSON.stringify(m)+'\\n');
        if(prompt) {reply(prompt,{outcome:'completed'});prompt=undefined;} return;
      }
      if(m.method==='open') {options=m.input;reply(m.id,{sessionId:'fixture-session',messages:[],tools:[],status:'idle',sdkVersion:'fixture',capabilities:{read:options.semanticContextReadEnabled,legacy:options.semanticContextEnabled}});}
      if(m.method==='snapshot')reply(m.id,{sessionId:'fixture-session',messages:[],tools:[],status:'idle',sdkVersion:'fixture',capabilities:{}});
      if(m.method==='prompt') {
        prompt=m.id; const q=JSON.parse(m.input.text);
        const file=options.sessionDirectory+'/native.jsonl';writeFileSync(file,'');
        process.send({kind:'event',event:{type:'run.accepted',requestId:m.input.requestId,sessionFile:file}});
        process.send({kind:'personal-context-request',id:'query',feature:'semantic-context',toolCallId:'actual-tool-call',action:q.action??'graph',input:{operation:'find',query:'synthetic'},requestId:m.input.requestId,sessionId:'fixture-session',...q.raw});
        if(q.settleEarly){reply(prompt,{outcome:'completed'});prompt=undefined;}
      }
      if(m.method==='stop') {process.send({kind:'personal-context-cancel',id:'query'});if(prompt){reply(prompt,{outcome:'cancelled'});prompt=undefined;}reply(m.id,{});}
      if(m.method==='drain')reply(m.id,{});
      if(m.method==='close') {if(prompt){reply(prompt,{outcome:'cancelled'});prompt=undefined;}reply(m.id,{closed:true});process.disconnect();}
    });
  `);
  const options: ProjectAgentOptions = { projectId: 'project', taskId: 'task', projectDirectory, codeRoot: root, sessionDirectory: path.join(root, 'native'), resourceRoot: path.join(root, 'resources'), managementPorts: [], configuration: { id: 'synthetic', revision: 1, name: 'Synthetic no-model IPC', provider: 'synthetic', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1', model: 'synthetic', apiKey: 'synthetic-key' }, ...overrides };
  const agent = new ProjectAgent(options);
  t.after(async () => { await agent.close().catch(() => {}); });
  return { root, cwd, agent, replies, options };
}

test('S4A03: ordinary managed Host read facet grants graph only, with a nonserializable run identity', async t => {
  const calls: any[] = [];
  const f = await fixture(t, { protectedExecution: { id: 'ordinary', profile: 'ordinary', cwd: '/synthetic', writableRoot: '/synthetic', readRoots: [] }, semanticContextRead: async (action, _input, ctx) => { calls.push({ action, ctx }); return result; } });
  assert.deepEqual((await f.agent.open()).capabilities, { read: true, legacy: false });
  await f.agent.start('{}', 'first').completion;
  assert.equal(calls.length, 1); assert.equal(calls[0].action, 'graph');
  assert.equal(typeof calls[0].ctx.runToken, 'object');
  assert.equal(typeof calls[0].ctx.registerCleanup, 'function');
  for (const action of ['find', 'read', 'trace', 'record']) await f.agent.start(JSON.stringify({ action }), action).completion;
  assert.equal(calls.length, 1, 'managed directory and original M2 writes stay denied');
});

test('S4A03: graph capability cannot escape into workspace, protected profile or forged run/session', async t => {
  for (const mode of ['protected', 'workspace', 'fixed-draft', 'text-only', 'source-reader', 'stale-run', 'stale-session']) await t.test(mode, async t => {
    let calls = 0;
    const f = await fixture(t, { semanticContextRead: async () => { calls++; return result; }, ...(mode === 'protected' ? { protectedExecution: { id: mode, cwd: '/synthetic', writableRoot: '/synthetic', readRoots: [] } } : ['workspace', 'fixed-draft', 'text-only', 'source-reader'].includes(mode) ? { workspace: { cwd: os.tmpdir(), systemPrompt: [], ...(mode === 'workspace' ? {} : { capabilityPolicy: mode as 'fixed-draft' | 'text-only' | 'source-reader' }) } } : {}) });
    const raw = mode === 'stale-run' ? { requestId: 'forged' } : mode === 'stale-session' ? { sessionId: 'forged' } : {};
    await f.agent.start(JSON.stringify({ raw }), 'actual').completion;
    assert.equal(calls, 0);
    assert.match(await readFile(f.replies, 'utf8'), /semantic_context_run_unavailable/);
  });
});

test('S4A05: SDK cancellation retains Resource occupancy until matching Host query has actually reaped', async t => {
  const entered = deferred<void>(), reaped = deferred<void>();
  let ctx: any, cleanups = 0;
  const port: NonNullable<ProjectAgentOptions['semanticContextRead']> = async (_action, _input, context) => {
    ctx = context; context.registerCleanup?.(async () => { cleanups++; await reaped.promise; }); entered.resolve();
    return await new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  };
  const f = await fixture(t, { semanticContextRead: port, semanticContext: (action, input, ctx) => port(action === 'record' ? 'read' : action, input, ctx) });
  const running = f.agent.start('{"action":"find"}', 'cancel-me'); await entered.promise;
  let stopped = false; const stopping = f.agent.stop().then(() => { stopped = true; });
  await pause(); assert.equal(ctx.signal.aborted, true); assert.equal(stopped, false);
  assert.equal(f.agent.busy, true); assert.throws(() => f.agent.start('{}', 'too-early'), /session_busy/);
  assert.throws(() => ctx.assertCurrent());
  reaped.resolve(); await stopping;
  assert.equal((await running.completion).outcome, 'cancelled'); assert.equal(f.agent.busy, false); assert.equal(cleanups, 1);
  assert.doesNotMatch(await readFile(f.replies, 'utf8'), /SYNTHETIC_CURRENT_GRAPH/);
});

test('S4A05: drain and normal completion wait query cleanup even if the SDK caller already settled', async t => {
  const entered = deferred<void>(), reaped = deferred<void>();
  const port: NonNullable<ProjectAgentOptions['semanticContextRead']> = async (_action, _input, ctx) => { ctx.registerCleanup?.(async () => reaped.promise); entered.resolve(); return result; };
  const f = await fixture(t, { semanticContextRead: port, semanticContext: (action, input, ctx) => port(action === 'record' ? 'read' : action, input, ctx) });
  const running = f.agent.start('{"action":"find","settleEarly":true}', 'early-sdk'); await entered.promise;
  let drained = false, completed = false;
  const draining = f.agent.drain().then(() => { drained = true; });
  void running.completion.then(() => { completed = true; });
  await pause(); assert.equal(drained, false); assert.equal(completed, false); assert.equal(f.agent.busy, true);
  try { assert.equal((await f.agent.snapshot()).status, 'running', 'SDK idle cannot release a still-owned Host query'); }
  finally { reaped.resolve(); }
  await Promise.all([draining, running.completion]); assert.equal(f.agent.busy, false);
});

test('S4A06: failed cleanup quarantines the same Resource until explicit cleanup retry, without replaying a query', async t => {
  const entered = deferred<void>(); let cleanups = 0, queries = 0;
  const port: NonNullable<ProjectAgentOptions['semanticContextRead']> = async (_action, _input, ctx) => { queries++; ctx.registerCleanup?.(async () => { cleanups++; if (cleanups === 1) throw new Error('synthetic_reap_failure'); }); entered.resolve(); return await new Promise((_resolve, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })); };
  const f = await fixture(t, { semanticContextRead: port, semanticContext: (action, input, ctx) => port(action === 'record' ? 'read' : action, input, ctx) });
  const running = f.agent.start('{"action":"find"}', 'cleanup-fails'); void running.completion.catch(() => {}); await entered.promise;
  await assert.rejects(f.agent.stop(), /semantic_context_cleanup_unknown/);
  assert.equal(f.agent.busy, true); assert.throws(() => f.agent.start('{}', 'forbidden-replay'), /session_busy/);
  await assert.rejects(f.agent.stop(), /semantic_context_cleanup_unknown/); assert.equal(cleanups, 1);
  await assert.rejects(f.agent.close({ retryFailed: false }), /semantic_context_cleanup_unknown/); assert.equal(cleanups, 1);
  await f.agent.close(); assert.equal(cleanups, 2); assert.equal(queries, 1); assert.equal(f.agent.busy, false);
});

test('S4A05: cleanup registered after cancellation still belongs to the original Resource after the SDK driver exits', async t => {
  const entered = deferred<void>(), register = deferred<void>(), cleanupEntered = deferred<void>(), reaped = deferred<void>();
  let captured: Parameters<NonNullable<ProjectAgentOptions['semanticContextRead']>>[2] | undefined;
  const f = await fixture(t, { semanticContextRead: async (_action, _input, ctx) => {
    captured = ctx; entered.resolve(); await register.promise;
    ctx.registerCleanup!(async () => { cleanupEntered.resolve(); await reaped.promise; });
    ctx.assertCurrent(); return result;
  } });
  const running = f.agent.start('{}', 'register-after-cancel'); await entered.promise;
  let closed = false; const closing = f.agent.close({ retryFailed: false }).then(() => { closed = true; });
  await pause(); assert.equal(captured!.signal.aborted, true); assert.equal(f.agent.alive, false); assert.equal(f.agent.busy, true); assert.equal(closed, false);
  register.resolve(); await cleanupEntered.promise; await pause(); assert.equal(closed, false); assert.equal(f.agent.busy, true);
  reaped.resolve(); await closing; await running.completion; assert.equal(f.agent.busy, false);
  assert.throws(() => captured!.registerCleanup!(async () => {}), /semantic_context_run_unavailable/, 'a settled cleanup registration cannot mint a detached job');
});
