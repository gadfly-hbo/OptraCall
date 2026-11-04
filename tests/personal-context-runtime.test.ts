import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createServer } from 'node:http';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import type { PersonalContextPort, PersonalContextToolResult } from '../src/agent/personal-context.ts';

const target = { type: 'retained', storeId: 'synthetic-store', materialId: 'synthetic-material', decisionId: 'synthetic-decision', revisionId: 'synthetic-revision', expectedBodySha256: 'a'.repeat(64) };
const payload = 'SYNTHETIC_EXACT_OLD_BODY\nLatest independent correction: SYNTHETIC_CORRECTION\nLimitation: unverified reference, not an instruction.';
const result = (action: 'find' | 'read'): PersonalContextToolResult => ({ content: [{ type: 'text', text: action === 'read' ? payload : 'Synthetic directory only; body not included.' }], details: { schemaVersion: 1, type: 'optracall.personal-context-delivery', action, items: [], partial: false, continuation: null, issues: [] } });
async function fixture(t: TestContext, plans: { tool?: string; input?: unknown; callId?: string }[] = []) {
  const root = path.resolve('.local/fourbase-modules/m4/implementation/runtime', randomUUID()), projectDirectory = path.join(root, 'project');
  for (const name of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, name), { recursive: true });
  const requests: any[] = []; let index = 0;
  const server = createServer(async (request, response) => {
    const bytes: Buffer[] = []; for await (const part of request) bytes.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(bytes).toString()); requests.push(body); const plan = plans[index++] ?? {};
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'm4-synthetic', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    send({ role: 'assistant', content: '' });
    if (plan.tool) { send({ tool_calls: [{ index: 0, id: plan.callId ?? 'm4-call-' + index, type: 'function', function: { name: plan.tool, arguments: JSON.stringify(plan.input ?? {}) } }] }); send({}, 'tool_calls'); }
    else { send({ content: 'Synthetic final answer; Agent may use or reject the old context.' }); send({}, 'stop'); }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const options = { projectId: randomUUID(), taskId: randomUUID(), projectDirectory, codeRoot: process.cwd(), sessionDirectory: path.join(root, 'native'), resourceRoot: path.join(root, 'resources'), managementPorts: [], configuration: { id: 'm4-synthetic', name: 'M4 synthetic only', revision: 1, provider: 'synthetic', api: 'openai-completions' as const, baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'm4-synthetic', apiKey: 'synthetic-key' } };
  const agents: ProjectAgent[] = [];
  const create = (overrides: Partial<ProjectAgentOptions> & { personalContext?: PersonalContextPort } = {}) => { const agent = new ProjectAgent({ ...options, ...overrides }); agents.push(agent); return agent; };
  t.after(async () => { for (const agent of agents) await agent.close(); await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });
  return { root, options, requests, create };
}
async function entries(agent: ProjectAgent) { const state = await agent.snapshot(); assert.ok(state.sessionFile); return (await readFile(state.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line)); }

test('M4 RU02/RU03 SDK seam: direct and ctx.executeTool nested reads use actual native hooks and deliver visible body without a child transcript', async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
    const code = `const r=await tools.read_personal_context(${JSON.stringify({ target })}); text(r);`;
    const f = await fixture(t, [{ tool: nested ? 'codemode' : 'read_personal_context', input: nested ? { code } : { target } }, {}]);
    const hookFile = path.join(f.root, 'hooks.jsonl'), extensions = path.join(f.options.resourceRoot, 'extensions');
    await mkdir(extensions, { recursive: true });
    await writeFile(path.join(extensions, 'observe.ts'), `import {appendFileSync} from 'node:fs'; export default pi=>{for(const name of ['tool_call','tool_result']) pi.on(name,(event,ctx)=>{if(event.toolName==='read_personal_context')appendFileSync(${JSON.stringify(hookFile)},JSON.stringify({name,parent:event.parentToolCallId??null,sessionId:ctx.sessionManager.getSessionId()})+'\\n');});};`);
    const calls: string[] = [];
    const agent = f.create({ personalContext: async (action, input, context) => { assert.deepEqual(input, { target }); assert.equal(context.signal.aborted, false); calls.push(action); return result(action); } });
    const opened = await agent.open();
    assert.ok(opened.tools.includes('read_personal_context'), 'ordinary Host callback exposes the read capability through Pi customTools');
    assert.ok(opened.tools.includes('find_personal_context'));
    const run = agent.start('Synthetic same-task reuse; no required extra read.', randomUUID()); await run.accepted;
    assert.equal((await run.completion).outcome, 'completed'); assert.deepEqual(calls, ['read']); assert.equal(f.requests.length, 2);
    assert.ok(JSON.stringify(f.requests[1].messages).includes('SYNTHETIC_EXACT_OLD_BODY'));
    assert.ok(JSON.stringify(f.requests[1].messages).includes('SYNTHETIC_CORRECTION'));
    const hooks = (await readFile(hookFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(hooks.map(h => h.name), ['tool_call', 'tool_result']);
    assert.ok(hooks.every(h => h.sessionId === opened.sessionId));
    assert.ok(hooks.every(h => nested ? h.parent === 'm4-call-1' : h.parent === null));
    const saved = await entries(agent), direct = saved.filter(e => e.message?.role === 'toolResult' && e.message.toolName === 'read_personal_context');
    assert.equal(direct.length, nested ? 0 : 1);
    if (nested) { const parent = saved.find(e => e.message?.role === 'toolResult' && e.message.toolName === 'codemode'); assert.equal(parent.message.nestedCalls.calls[0].status, 'ok'); assert.equal(parent.message.nestedCalls.calls[0].name, 'read_personal_context'); }
    else { assert.equal(direct[0].message.isError, false); assert.deepEqual(direct[0].message.content, result('read').content); assert.deepEqual(direct[0].message.details, result('read').details); }
  });
});

test('M4 RU08: callback-only ordinary unmanaged capability; zero reads and unavailable profiles preserve native tools', async t => {
  const f = await fixture(t), port: PersonalContextPort = async action => result(action);
  assert.ok(!(await f.create().open()).tools.includes('read_personal_context'));
  const workspace = { cwd: path.join(f.options.projectDirectory, '020_clean'), systemPrompt: ['Synthetic plugin only.'] };
  for (const override of [{ taskId: undefined }, { workspace }, { workspace: { ...workspace, capabilityPolicy: 'fixed-draft' as const } }, { workspace: { ...workspace, capabilityPolicy: 'text-only' as const } }]) {
    const state = await f.create({ ...override, personalContext: port, sessionDirectory: path.join(f.root, randomUUID()) }).open();
    assert.ok(!state.tools.includes('find_personal_context')); assert.ok(!state.tools.includes('read_personal_context'));
  }
  const agent = f.create({ personalContext: async () => { throw new Error('zero-read task must not query Host'); } });
  assert.equal((await agent.start('Synthetic ordinary answer without looking anything up.', randomUUID()).completion).outcome, 'completed');
  assert.equal(f.requests.length, 1); const saved = await entries(agent); assert.equal(saved.filter(e => e.message?.role === 'toolResult').length, 0);
  const reloaded = await agent.command('/reload'); assert.ok(reloaded.snapshot.tools.includes('find_personal_context')); assert.ok(reloaded.snapshot.tools.includes('record_agent_candidate')); assert.ok(reloaded.snapshot.tools.includes('bash'));
});

test('M4 RU02/RU10: stop aborts pending Host read; late old result cannot reach native or the next run', async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
    const code = `text(await tools.read_personal_context(${JSON.stringify({ target })}));`;
    const f = await fixture(t, [{ tool: nested ? 'codemode' : 'read_personal_context', input: nested ? { code } : { target } }, {}]);
    let entered!: () => void, release!: (value: PersonalContextToolResult) => void, signal: AbortSignal | undefined;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const agent = f.create({ personalContext: async (_action, _input, context) => { signal = context.signal; entered(); return new Promise(resolve => { release = resolve; }); } });
    const active = agent.start('Synthetic cancellation of slow reference IO.', randomUUID()); await active.accepted; await waiting;
    await agent.stop(); assert.equal(signal!.aborted, true); assert.equal((await active.completion).outcome, 'cancelled');
    const next = agent.start('Synthetic fresh question with zero context reads.', randomUUID());
    release(result('read')); assert.equal((await next.completion).outcome, 'completed');
    assert.equal(f.requests.length, 2, 'no Provider continuation for aborted read; one new request for explicitly started next run');
    assert.ok(!JSON.stringify(f.requests[1].messages).includes('SYNTHETIC_EXACT_OLD_BODY'));
    assert.ok(!(await readFile((await agent.snapshot()).sessionFile!, 'utf8')).includes('SYNTHETIC_EXACT_OLD_BODY'));
  });
});

test('M4 RU02: SDK parameter and permission hooks reject direct and nested requests before Host IO', async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
    const f = await fixture(t, [{ tool: nested ? 'codemode' : 'read_personal_context', input: nested ? { code: `text(await tools.read_personal_context(${JSON.stringify({ target })}));` } : { target } }, {}]);
    const extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
    await writeFile(path.join(extensions, 'block.ts'), `export default pi=>pi.on('tool_call',event=>event.toolName==='read_personal_context'?{block:true,reason:'Synthetic reference permission denied.'}:undefined);`);
    let calls = 0; const agent = f.create({ personalContext: async action => { calls++; return result(action); } });
    await agent.start('Synthetic hook denial.', randomUUID()).completion; assert.equal(calls, 0);
    const saved = await entries(agent), last = saved.filter(e => e.message?.role === 'toolResult').at(-1).message;
    if (nested) assert.equal(last.nestedCalls.calls[0].status, 'error'); else assert.equal(last.isError, true);
  });
  const f = await fixture(t, [{ tool: 'read_personal_context', input: { target, ctx: { sessionId: 'forged' }, owner: 'forged' } }, {}]);
  let calls = 0; const agent = f.create({ personalContext: async action => { calls++; return result(action); } });
  await agent.start('Synthetic forged runtime bindings must not be business arguments.', randomUUID()).completion;
  assert.equal(calls, 0); assert.equal((await entries(agent)).filter(e => e.message?.role === 'toolResult').at(-1).message.isError, true);
});

test('M4 RU08: real managed ordinary/protected profiles never gain autonomous personal-context tools', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t);
  for (const profile of ['ordinary', 'protected'] as const) {
    const cwd = path.join(f.options.projectDirectory, '020_clean');
    const agent = f.create({ personalContext: async action => result(action), protectedExecution: { id: randomUUID(), profile, cwd, writableRoot: cwd, readRoots: [] }, sessionDirectory: path.join(f.root, profile) });
    const snapshot = await agent.open(); assert.ok(!snapshot.tools.includes('read_personal_context')); assert.ok(!snapshot.tools.includes('find_personal_context')); assert.ok(snapshot.tools.includes('bash'));
    await agent.close();
  }
});

test('M4 RU05/RU08/RU10: optional human fixed text remains native prompt and receipt only; sealed profiles reject it', async t => {
  const f = await fixture(t), agent = f.create();
  const personal = { text: 'SYNTHETIC_HUMAN_FIXED_CONTEXT', receipt: { schemaVersion: 1 as const, items: [] } };
  const fingerprint = 'b'.repeat(64), requestId = randomUUID();
  const prompt = 'Synthetic user question.\n' + personal.text;
  await agent.start(prompt, requestId, fingerprint, { personal, originalUserText: 'Synthetic user question.' }).completion;
  const saved = await entries(agent), marker = saved.find(e => e.customType === 'optracall.run' && e.data.phase === 'started');
  assert.deepEqual(marker.data.providedContext.personal, personal.receipt, 'marker stores metadata only; actual content is in native user prompt');
  assert.equal(marker.data.requestFingerprint, fingerprint);
  assert.equal(saved.find(e => e.message?.role === 'user').message.content[0].text, prompt);
  assert.equal(JSON.stringify(marker.data).includes(personal.text), false);
  const workspace = { cwd: path.join(f.options.projectDirectory, '020_clean'), systemPrompt: ['Synthetic sealed profile.'] };
  for (const capabilityPolicy of ['text-only', 'fixed-draft'] as const) {
    const sealed = f.create({ workspace: { ...workspace, capabilityPolicy }, sessionDirectory: path.join(f.root, capabilityPolicy) });
    await assert.rejects(sealed.start(prompt, randomUUID(), undefined, { personal }).completion, error => error instanceof Error && (error.cause as any)?.message === 'fixed_draft_materials_not_allowed');
  }
});

test('M4 RU02/RU10: native fork rebinds the current SDK manager; an old SDK ctx cannot dispatch into its replacement', async t => {
  const f = await fixture(t, [{ tool: 'capture_reference_ctx' }, {}, { tool: 'replay_reference_ctx' }, {}, { tool: 'read_personal_context', input: { target } }, {}]);
  const extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'stale.ts'), `export default pi=>{
    const parameters={type:'object',properties:{},additionalProperties:false};
    pi.registerTool({name:'capture_reference_ctx',label:'Synthetic capture',description:'Synthetic ctx capture only',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{globalThis.__m4OldCtx=ctx;return {content:[{type:'text',text:'Captured synthetic SDK ctx.'}],details:{}};}});
    pi.registerTool({name:'replay_reference_ctx',label:'Synthetic stale replay',description:'Synthetic stale ctx replay only',parameters,execute:async()=>{try {const outcome=await globalThis.__m4OldCtx.executeTool('read_personal_context',${JSON.stringify({ target })});return {content:[{type:'text',text:outcome.isError?'STALE_CTX_REJECTED':'STALE_CTX_UNEXPECTED_SUCCESS'}],details:{}};}catch{return {content:[{type:'text',text:'STALE_CTX_REJECTED'}],details:{}};}}});
  };`);
  let calls = 0; const agent = f.create({ personalContext: async action => { calls++; return result(action); } });
  const before = await agent.open(); await agent.start('Capture SDK context in original session.', randomUUID()).completion;
  const user = (await entries(agent)).find(e => e.message?.role === 'user'); assert.ok(user);
  const fork = await agent.command('/fork ' + user.id + ' at'); assert.notEqual(fork.snapshot.sessionId, before.sessionId);
  await agent.start('Attempt synthetic stale SDK context after fork.', randomUUID()).completion;
  assert.equal(calls, 0); assert.ok(JSON.stringify(f.requests[3].messages).includes('STALE_CTX_REJECTED'));
  await agent.start('Read in the actual current fork session.', randomUUID()).completion; assert.equal(calls, 1);
  const current = await entries(agent), read = current.find(e => e.message?.role === 'toolResult' && e.message.toolName === 'read_personal_context');
  assert.equal(read.message.isError, false); assert.ok(JSON.stringify(f.requests[5].messages).includes('SYNTHETIC_EXACT_OLD_BODY'));
});

test('M4 RU02/RU10: closing aborts pending Host IO; a new worker and another owner stay isolated from late replies', async t => {
  const f = await fixture(t, [{ tool: 'read_personal_context', input: { target } }, {}]);
  let entered!: () => void, release!: (value: PersonalContextToolResult) => void, signal: AbortSignal | undefined;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const old = f.create({ personalContext: async (_action, _input, context) => { signal = context.signal; entered(); return new Promise(resolve => { release = resolve; }); } });
  const active = old.start('Synthetic close while Host IO is pending.', randomUUID()); await active.accepted; await waiting;
  const savedFile = (await old.snapshot()).sessionFile!; await old.close(); assert.equal(signal!.aborted, true); assert.equal((await active.completion).outcome, 'cancelled');
  const restarted = f.create({ sessionFile: savedFile, personalContext: async action => result(action) }); await restarted.open();
  const other = f.create({ projectId: randomUUID(), taskId: randomUUID(), sessionDirectory: path.join(f.root, 'other-owner'), personalContext: async () => { throw new Error('other owner is zero-read'); } });
  const run = other.start('Synthetic other owner stays independent.', randomUUID()); release(result('read')); assert.equal((await run.completion).outcome, 'completed');
  assert.ok(!(await readFile(savedFile, 'utf8')).includes('SYNTHETIC_EXACT_OLD_BODY')); assert.ok(!JSON.stringify(f.requests[1].messages).includes('SYNTHETIC_EXACT_OLD_BODY'));
  assert.equal(f.requests.length, 2); assert.ok((await restarted.snapshot()).tools.includes('read_personal_context'));
});

test('M4 RU02: command turns cannot invoke the personal Host port', async t => {
  const f = await fixture(t, [{ tool: 'read_personal_context', input: { target } }, {}]);
  let calls = 0; const agent = f.create({ personalContext: async action => { calls++; return result(action); } });
  await agent.command('/synthetic-command'); assert.equal(calls, 0);
  const saved = await entries(agent), read = saved.find(e => e.message?.role === 'toolResult' && e.message.toolName === 'read_personal_context'); assert.equal(read.message.isError, true);
});

test('M4 RU02/RU10: unexpected worker exit aborts only its pending personal read without replay', async t => {
  const f = await fixture(t, [{ tool: 'read_personal_context', input: { target } }]);
  const pidFile = path.join(f.root, 'worker.pid'), extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'pid.ts'), `import {writeFileSync} from 'node:fs';export default pi=>pi.on('tool_call',event=>{if(event.toolName==='read_personal_context')writeFileSync(${JSON.stringify(pidFile)},String(process.pid));});`);
  let entered!: () => void, signal: AbortSignal | undefined;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const agent = f.create({ personalContext: async (_action, _input, context) => { signal = context.signal; entered(); return new Promise(() => {}); } });
  const active = agent.start('Synthetic abrupt own worker exit.', randomUUID()); void active.completion.catch(() => {}); await active.accepted; await waiting;
  const pid = Number(await readFile(pidFile, 'utf8')); assert.ok(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid); process.kill(pid, 'SIGKILL');
  await assert.rejects(active.completion, /runtime_process_stopped/); assert.equal(signal!.aborted, true); assert.equal(f.requests.length, 1);
});

test('M4 RU08: human context is admitted only on an actual ordinary project task, including managed ordinary', async t => {
  const f = await fixture(t), personal = { text: 'SYNTHETIC_HUMAN_FIXED_CONTEXT', receipt: { schemaVersion: 1 as const, items: [] } };
  const workspace = { cwd: path.join(f.options.projectDirectory, '020_clean'), systemPrompt: ['Synthetic non-task plugin.'] };
  for (const override of [{ taskId: undefined }, { workspace }]) {
    const excluded = f.create({ ...override, sessionDirectory: path.join(f.root, randomUUID()) });
    await assert.rejects(excluded.start('Synthetic ordinary-looking plugin request.\n' + personal.text, randomUUID(), undefined, { personal }).completion, error => error instanceof Error && (error.cause as any)?.message === 'personal_context_profile_unavailable');
  }
  if (process.platform === 'darwin') {
    const cwd = path.join(f.options.projectDirectory, '020_clean');
    const cold = f.create({ protectedExecution: { id: randomUUID(), profile: 'protected', cwd, writableRoot: cwd, readRoots: [] }, sessionDirectory: path.join(f.root, 'cold') });
    await assert.rejects(cold.start('Synthetic cold reader input.', randomUUID(), undefined, { personal }).completion, error => error instanceof Error && (error.cause as any)?.message === 'personal_context_profile_unavailable');
    const ordinary = f.create({ protectedExecution: { id: randomUUID(), profile: 'ordinary', cwd, writableRoot: cwd, readRoots: [] }, sessionDirectory: path.join(f.root, 'ordinary-human') });
    assert.equal((await ordinary.start('Synthetic human context in managed ordinary.\n' + personal.text, randomUUID(), undefined, { personal }).completion).outcome, 'completed');
    const marker = (await entries(ordinary)).find(e => e.customType === 'optracall.run' && e.data.phase === 'started'); assert.deepEqual(marker.data.providedContext.personal, personal.receipt);
  }
});

test('M4 RU02 independent P2 regression: actual SDK ctx from a completed successful run cannot read in the next run on the same manager, even with reused IDs or a new signal', async t => {
  for (const reuseId of [false, true]) for (const replaceSignal of [false, true]) await t.test(`reused-id=${reuseId},new-signal=${replaceSignal}`, async t => {
    const f = await fixture(t, [{ tool: 'capture_run_reference_ctx', callId: 'captured-root' }, {}, { tool: 'replay_run_reference_ctx', callId: reuseId ? 'captured-root' : 'new-root' }, {}, { tool: 'read_personal_context', input: { target } }, {}]);
    const extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
    await writeFile(path.join(extensions, 'retained-ctx.ts'), `export default pi=>{
      const parameters={type:'object',properties:{},additionalProperties:false};
      pi.registerTool({name:'capture_run_reference_ctx',label:'Synthetic capture',description:'Capture actual successful-run SDK ctx',parameters,execute:async(_id,_args,signal,_update,ctx)=>{globalThis.__m4PriorRunCtx=ctx;globalThis.__m4PriorRunSignal=signal;return {content:[{type:'text',text:'Captured synthetic ctx.'}],details:{}};}});
      pi.registerTool({name:'replay_run_reference_ctx',label:'Synthetic replay',description:'Replay actual prior-run SDK ctx',parameters,execute:async(_id,_args,signal)=>{const facts={priorAborted:globalThis.__m4PriorRunSignal.aborted,sameSignal:globalThis.__m4PriorRunSignal===signal};try{const outcome=await globalThis.__m4PriorRunCtx.executeTool('read_personal_context',${JSON.stringify({ target })},${replaceSignal ? '{signal}' : '{}'});return {content:[{type:'text',text:JSON.stringify({facts,outcome})}],details:{}};}catch(error){return {content:[{type:'text',text:JSON.stringify({facts,rejected:true,error:String(error)})}],details:{}};}}});
    };`);
    let calls = 0; const agent = f.create({ personalContext: async action => { calls++; return result(action); } });
    const opened = await agent.open();
    assert.equal((await agent.start('Capture context in a successful synthetic run.', randomUUID()).completion).outcome, 'completed'); assert.equal(calls, 0);
    assert.equal((await agent.start('Replay old context on unchanged native manager.', randomUUID()).completion).outcome, 'completed');
    assert.equal((await agent.snapshot()).sessionId, opened.sessionId, 'same SDK manager/session; no fork or abort used');
    assert.equal(calls, 0, 'an SDK ctx captured by an earlier successful run cannot invoke the current Host read capability');
    assert.ok(!JSON.stringify(f.requests[3].messages).includes('SYNTHETIC_EXACT_OLD_BODY'));
    assert.ok(JSON.stringify(f.requests[3].messages).includes('priorAborted'));
    const nativeBeforeCurrent = await readFile((await agent.snapshot()).sessionFile!, 'utf8'); assert.ok(!nativeBeforeCurrent.includes('SYNTHETIC_EXACT_OLD_BODY'));
    assert.equal((await agent.start('Positive current run direct read remains available.', randomUUID()).completion).outcome, 'completed');
    assert.equal(calls, 1); assert.ok(JSON.stringify(f.requests[5].messages).includes('SYNTHETIC_EXACT_OLD_BODY'));
  });
});

test('M4 RU02: completed parent invocation cannot reuse its SDK ctx in a later tool turn of the same run', async t => {
  const f = await fixture(t, [{ tool: 'capture_within_run_ctx', callId: 'same-parent' }, { tool: 'replay_within_run_ctx', callId: 'same-parent' }, { tool: 'read_personal_context', input: { target } }, {}]);
  const extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'parent-lifetime.ts'), `export default pi=>{
    const parameters={type:'object',properties:{},additionalProperties:false};
    pi.registerTool({name:'capture_within_run_ctx',label:'Capture',description:'Synthetic capture',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{globalThis.__m4CompletedParentCtx=ctx;return {content:[{type:'text',text:'Captured ctx, parent completed.'}],details:{}};}});
    pi.registerTool({name:'replay_within_run_ctx',label:'Replay',description:'Synthetic completed-parent replay',parameters,execute:async(_id,_args,signal)=>{const outcome=await globalThis.__m4CompletedParentCtx.executeTool('read_personal_context',${JSON.stringify({ target })},{signal});return {content:[{type:'text',text:JSON.stringify(outcome)}],details:{}};}});
  };`);
  let calls = 0; const agent = f.create({ personalContext: async action => { calls++; return result(action); } });
  assert.equal((await agent.start('Synthetic one run with several ordinary tool turns.', randomUUID()).completion).outcome, 'completed');
  assert.equal(calls, 1, 'only the actual current direct read reaches the Host; a completed parent is not an active delegate');
  assert.ok(!JSON.stringify(f.requests[2].messages).includes('SYNTHETIC_EXACT_OLD_BODY'));
  assert.ok(JSON.stringify(f.requests[3].messages).includes('SYNTHETIC_EXACT_OLD_BODY'));
});

test('M4 RU02: current SDK ctx keeps legal multilevel parallel reads and nested caller-specific signals', async t => {
  const f = await fixture(t, [{ tool: 'parallel_reference_chain' }, {}]);
  const extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'nested-chain.ts'), `export default pi=>{
    const parameters={type:'object',properties:{},additionalProperties:false};
    pi.registerTool({name:'middle_reference_read',label:'Middle',description:'Synthetic intermediary',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{const outcome=await ctx.executeTool('read_personal_context',${JSON.stringify({ target })},{signal:new AbortController().signal});return {...outcome.result};}});
    pi.registerTool({name:'parallel_reference_chain',label:'Parallel',description:'Synthetic legal multilevel parallel chain',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{const outcomes=await Promise.all([ctx.executeTool('middle_reference_read',{}),ctx.executeTool('middle_reference_read',{})]);return {content:[{type:'text',text:JSON.stringify(outcomes)}],details:{}};}});
  };`);
  let calls = 0; const agent = f.create({ personalContext: async action => { calls++; return result(action); } });
  assert.equal((await agent.start('Synthetic legal Pi nested parallel composition.', randomUUID()).completion).outcome, 'completed');
  assert.equal(calls, 2); assert.ok(JSON.stringify(f.requests[1].messages).includes('SYNTHETIC_EXACT_OLD_BODY'));
  const parent = (await entries(agent)).find(e => e.message?.role === 'toolResult' && e.message.toolName === 'parallel_reference_chain').message;
  assert.equal(parent.isError, false); assert.equal(parent.nestedCalls.calls.length, 4); assert.ok(parent.nestedCalls.calls.every((call: any) => call.status === 'ok'));
});
