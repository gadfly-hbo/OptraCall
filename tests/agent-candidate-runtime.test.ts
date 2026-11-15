import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { createServer, type ServerResponse } from 'node:http';
import { parseAgentCandidateDetails, parseAgentCandidateInput, canonicalCandidateJson, agentCandidateDetailsSha256 } from '../src/agent/agent-candidate.ts';
import { startTestHost } from './fixtures/host-process.ts';
import { readNativeSessionSnapshot } from '../src/host/native-session-snapshot.ts';
import { ProjectStore } from '../src/host/project-store.ts';
import { AgentCandidateControls } from '../src/host/agent-candidate-controls.ts';
import { createAgentCandidateReader } from '../src/host/agent-candidate-reader.ts';

const TOOL = 'record_agent_candidate';
async function fixture(t: TestContext) {
  const root = path.resolve('.local/fourbase-modules/m31/implementation/runtime', randomUUID());
  const projectDirectory = path.join(root, 'project');
  for (const name of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, name), { recursive: true });
  const options = { projectId: randomUUID(), taskId: randomUUID(), projectDirectory, codeRoot: process.cwd(),
    sessionDirectory: path.join(root, 'native'), resourceRoot: path.join(root, 'resources'), managementPorts: [],
    configuration: { id: 'candidate-synthetic', name: 'Synthetic candidate', revision: 1, provider: 'synthetic', api: 'openai-completions' as const, baseUrl: 'http://127.0.0.1:1/v1', model: 'synthetic-candidate', apiKey: 'synthetic-key' } };
  const agents: ProjectAgent[] = [];
  const create = (overrides: Partial<ProjectAgentOptions> = {}) => { const agent = new ProjectAgent({ ...options, ...overrides }); agents.push(agent); return agent; };
  t.after(async () => { for (const agent of agents) await agent.close(); });
  return { root, options, create };
}

test('M31 AC01/AC08: declared candidate tool is available only to an actual ordinary unmanaged project task', async t => {
  const f = await fixture(t);
  const ordinary = await f.create().open();
  assert.ok(ordinary.tools.includes(TOOL), 'ordinary task exposes the Agent-selected candidate capability');
  for (const name of ['read', 'write', 'bash', 'codemode', 'tool_search']) assert.ok(ordinary.tools.includes(name), name);
  const workspace = { cwd: path.join(f.options.projectDirectory, '020_clean'), systemPrompt: ['Synthetic business plugin.'] };
  for (const overrides of [
    { taskId: undefined },
    { workspace },
    { workspace: { ...workspace, capabilityPolicy: 'text-only' as const } },
    { workspace: { ...workspace, capabilityPolicy: 'fixed-draft' as const } },
  ]) {
    const opened = await f.create({ ...overrides, sessionDirectory: path.join(f.root, randomUUID()) }).open();
    assert.ok(!opened.tools.includes(TOOL), 'no task provenance, plugin workspace and sealed profiles do not gain candidate writes');
  }
});

const candidate = { content: { kind: 'knowledge', title: 'Synthetic retained claim', bodyMd: 'SYNTHETIC_CANDIDATE_BODY', aliases: ['fixture'], scope: null, caution: 'Not a verified business fact.' }, sourceRefs: [] };
async function toolProvider(t: TestContext, plans: { tool?: string; callId?: string; input?: unknown; after?: 'success' | 'failure' | 'hold' }[]) {
  const requests: any[] = [], held = new Set<ServerResponse>();
  let index = 0;
  const server = createServer(async (request, response) => {
    const bytes: Buffer[] = []; for await (const part of request) bytes.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(bytes).toString()); requests.push(body);
    const plan = plans[index++] ?? {};
    if (plan.after === 'failure') { response.writeHead(401, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'synthetic provider failure', type: 'authentication_error' } })); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta: unknown, finish: string | null = null) => response.write('data: ' + JSON.stringify({ id: 'candidate-synthetic', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
    send({ role: 'assistant', content: '' });
    if (plan.after === 'hold') { held.add(response); response.on('close', () => held.delete(response)); return; }
    if (plan.tool) { send({ tool_calls: [{ index: 0, id: plan.callId ?? 'candidate-call-' + index, type: 'function', function: { name: plan.tool, arguments: JSON.stringify(plan.input ?? candidate) } }] }); send({}, 'tool_calls'); }
    else { send({ content: 'Synthetic final answer.' }); send({}, 'stop'); }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { for (const response of held) response.destroy(); server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests,
    async wait(count: number) { const deadline = Date.now() + 5000; while (requests.length < count) { assert.ok(Date.now() < deadline, 'synthetic native request observed'); await new Promise(resolve => setTimeout(resolve, 5)); } },
  };
}
async function nativeEntries(agent: ProjectAgent): Promise<any[]> {
  const state = await agent.snapshot(); assert.ok(state.sessionFile);
  return (await readFile(state.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
}

test('R1 AC01/AC02/AC06: native custom is the candidate authority, survives parent failure/cancellation and reopen; zero is valid', async t => {
  for (const terminal of ['completed', 'failed', 'cancelled', 'zero'] as const) await t.test(terminal, async t => {
    const f = await fixture(t), provider = await toolProvider(t, terminal === 'zero' ? [{}] : [{ tool: TOOL }, terminal === 'failed' ? { after: 'failure' } : terminal === 'cancelled' ? { after: 'hold' } : {}]);
    const agent = f.create({ configuration: { ...f.options.configuration, baseUrl: provider.baseUrl } });
    await agent.open(); const requestId = randomUUID(), run = agent.start('Only a synthetic ordinary task.', requestId);
    await run.accepted;
    if (terminal === 'cancelled') { await provider.wait(2); await agent.stop(); }
    assert.equal((await run.completion).outcome, terminal === 'zero' ? 'completed' : terminal);
    const entries = await nativeEntries(agent), result = entries.filter(entry => entry.customType === 'optracall.agent-candidate');
    assert.equal(result.length, terminal === 'zero' ? 0 : 1);
    if (terminal !== 'zero') {
      const envelope = result[0].data.details;
      const receipt = entries.find(entry => entry.message?.role === 'toolResult' && entry.message.toolName === TOOL).message;
      assert.equal(receipt.isError, false);
      assert.equal(receipt.details.status, 'saved'); assert.equal(receipt.details.candidate.entryId, result[0].id);
      assert.equal(receipt.details.candidate.expectedDetailsSha256, agentCandidateDetailsSha256(envelope));
      assert.ok(!JSON.stringify(receipt).includes(candidate.content.bodyMd), 'direct receipt carries no second candidate body');
      assert.deepEqual(envelope.content, candidate.content); assert.deepEqual(envelope.sourceRefs, []);
      assert.deepEqual(envelope.origin, { projectId: f.options.projectId, taskId: f.options.taskId, sessionId: (await agent.snapshot()).sessionId, requestId, toolCallId: 'candidate-call-1' });
      assert.equal(envelope.claim, 'agent-generated-unconfirmed');
      assert.equal(envelope.type, 'optracall.agent-candidate'); assert.equal(envelope.schemaVersion, 1);
      assert.ok(entries.some(entry => entry.message?.role === 'assistant' && entry.message.content.some((part: any) => part.type === 'toolCall' && part.id === 'candidate-call-1' && part.name === TOOL)));
      assert.ok(entries.some(entry => entry.customType === 'optracall.run' && entry.data.phase === 'started' && entry.data.requestId === requestId));
      assert.equal(entries.filter(entry => entry.message?.details?.type === 'optracall.agent-candidate').length, 0, 'new toolResult is only a reference/status receipt');
      const state = await agent.snapshot(); await agent.close();
      const reopened = f.create({ sessionFile: state.sessionFile }); await reopened.open();
      assert.deepEqual((await nativeEntries(reopened)).find(entry => entry.id === result[0].id)?.data.details, envelope);
    }
    assert.equal(provider.requests.length, terminal === 'zero' ? 1 : 2, 'only native Agent continuation; no Host summary call');
  });
});

test('M31 AC03: native command turns cannot mint valid candidates even when a Provider calls the declared tool', async t => {
  const f = await fixture(t), provider = await toolProvider(t, [{ tool: TOOL }, {}]);
  const agent = f.create({ configuration: { ...f.options.configuration, baseUrl: provider.baseUrl } });
  await agent.open(); await agent.command('/synthetic-candidate-command', randomUUID());
  const results = (await nativeEntries(agent)).filter(entry => entry.message?.role === 'toolResult' && entry.message.toolName === TOOL);
  assert.equal(results.length, 1); assert.equal(results[0].message.isError, true);
  assert.notEqual(results[0].message.details?.type, 'optracall.agent-candidate');
});

test('R1: nested codemode candidate is saved without an independent transcript toolResult', async t => {
  const f = await fixture(t), provider = await toolProvider(t, [{ tool: 'codemode', input: { code: `const result=await tools.${TOOL}(${JSON.stringify(candidate)}); text(result);` } }, {}]);
  const agent = f.create({ configuration: { ...f.options.configuration, baseUrl: provider.baseUrl } });
  await agent.open(); await agent.start('Synthetic nested candidate call.', randomUUID()).completion;
  const entries = await nativeEntries(agent);
  const result = entries.find(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'codemode');
  assert.ok(result);
  const nested = result.message.nestedCalls?.calls;
  assert.ok(Array.isArray(nested) && nested.length === 1);
  assert.equal(nested[0].status, 'ok', 'legal SDK composition must retain a candidate');
  const records = entries.filter(entry => entry.customType === 'optracall.agent-candidate');
  assert.equal(records.length, 1);
  assert.deepEqual(records[0].data.details.content, candidate.content);
  assert.equal(records[0].data.recordVersion, 1);
  assert.equal(entries.filter(entry => entry.message?.role === 'toolResult' && entry.message.toolName === TOOL).length, 0);
  assert.ok(!JSON.stringify(result.message.content).includes(candidate.content.bodyMd), 'receipt carries no second candidate body');
});

test('M31 AC01/AC03: malformed declarations return native tool errors and Agent may correct them in the same run', async t => {
  const invalids = [
    { ...candidate, origin: { projectId: randomUUID() } },
    { ...candidate, content: { ...candidate.content, claim: 'human-confirmed' } },
    { ...candidate, content: { ...candidate.content, title: ' ' } },
    { ...candidate, content: { ...candidate.content, bodyMd: 'x'.repeat(20_001) } },
    { ...candidate, content: { ...candidate.content, aliases: Array(11).fill('alias') } },
    { ...candidate, sourceRefs: [{ type: 'native-reply', projectId: randomUUID(), taskId: randomUUID(), sessionId: 'origin', messageId: 'reply', expectedTextSha256: '0'.repeat(64), path: '/arbitrary/session.jsonl' }] },
  ];
  const f = await fixture(t), provider = await toolProvider(t, [...invalids.map(input => ({ tool: TOOL, input })), { tool: TOOL, input: { content: { kind: 'experience', title: 'Corrected by Agent', bodyMd: 'Corrected declaration.', scope: null, caution: null } } }, {}]);
  const agent = f.create({ configuration: { ...f.options.configuration, baseUrl: provider.baseUrl } });
  await agent.open(); const result = await agent.start('Synthetic structural correction in original run.', randomUUID()).completion;
  assert.equal(result.outcome, 'completed');
  const toolResults = (await nativeEntries(agent)).filter(entry => entry.message?.role === 'toolResult' && entry.message.toolName === TOOL);
  assert.equal(toolResults.length, invalids.length + 1);
  for (const record of toolResults.slice(0, -1)) {
    assert.equal(record.message.isError, true); assert.notEqual(record.message.details?.type, 'optracall.agent-candidate');
  }
  const saved = toolResults.at(-1).message;
  assert.equal(saved.isError, false); assert.equal(saved.details.status, 'saved');
  const records = (await nativeEntries(agent)).filter(entry => entry.customType === 'optracall.agent-candidate');
  assert.equal(records.length, 1, 'invalid declarations do not append candidates');
  const details = records[0].data.details;
  assert.equal(details.content.title, 'Corrected by Agent');
  assert.deepEqual(details.content.aliases, []); assert.deepEqual(details.sourceRefs, []);
  assert.deepEqual(parseAgentCandidateDetails(details), details);
  assert.equal(provider.requests.length, invalids.length + 2, 'the original native loop performs every continuation; no Host correction run');
});

test('M31 D02: exact details parser rejects incompatible claims/defaults/keys and canonical SHA preserves text and array order', () => {
  const envelope = { schemaVersion: 1, type: 'optracall.agent-candidate', claim: 'agent-generated-unconfirmed', origin: { projectId: 'p', taskId: 't', sessionId: 's', requestId: 'r', toolCallId: 'c' }, createdAt: '2026-11-03T00:00:00.000Z', ...candidate };
  const good = parseAgentCandidateDetails(envelope);
  assert.equal(parseAgentCandidateDetails({ ...envelope, schemaVersion: 2 }).schemaVersion, 2, 'M6 compatible reader accepts v2 without rewriting the v1 native entry');
  for (const mutation of [
    { ...envelope, schemaVersion: 3 }, { ...envelope, claim: 'human-confirmed' }, { ...envelope, extra: true },
    { ...envelope, origin: { ...envelope.origin, actor: 'human' } }, { ...envelope, createdAt: '2026-11-03' },
    { ...envelope, content: { ...candidate.content, aliases: undefined } }, { ...envelope, sourceRefs: undefined },
  ]) assert.throws(() => parseAgentCandidateDetails(mutation));
  assert.throws(() => parseAgentCandidateInput({ ...candidate, content: { ...candidate.content, scope: '' } }));
  assert.throws(() => parseAgentCandidateInput({ ...candidate, sourceRefs: Array(9).fill({}) }));
  assert.equal(canonicalCandidateJson({ z: ['two', 'one'], a: { x: '  body\n' } }), '{"a":{"x":"  body\\n"},"z":["two","one"]}');
  assert.equal(agentCandidateDetailsSha256(good), agentCandidateDetailsSha256(parseAgentCandidateDetails(Object.fromEntries(Object.entries(envelope).reverse()))), 'ordering does not change exact JSON identity');
});

test('M31 D02: omitted aliases/sourceRefs default empty but explicit null is invalid', () => {
  for (const input of [{ ...candidate, content: { ...candidate.content, aliases: null } }, { ...candidate, sourceRefs: null }]) {
    assert.throws(() => parseAgentCandidateInput(input), 'null must not be silently repaired to an empty array');
  }
});

test('M31 AC08: native managed ordinary/protected resources never gain the candidate capability', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t);
  for (const profile of ['ordinary', 'protected'] as const) {
    const cwd = path.join(f.options.projectDirectory, '020_clean');
    const agent = f.create({ protectedExecution: { id: randomUUID(), profile, cwd, writableRoot: cwd, readRoots: [] }, sessionDirectory: path.join(f.root, profile) });
    const opened = await agent.open();
    assert.ok(!opened.tools.includes(TOOL)); assert.ok(opened.tools.includes('bash'));
    await agent.close();
  }
});

test('M31 AC08: candidate and existing simulation tools coexist and survive native reload', async t => {
  const f = await fixture(t), agent = f.create({ simulationTools: { storeRoot: path.join(f.root, 'sim-lab'), projectId: f.options.projectId } });
  for (const snapshot of [await agent.open(), (await agent.command('/reload', randomUUID())).snapshot]) {
    assert.ok(snapshot.tools.includes(TOOL)); assert.ok(snapshot.tools.includes('simulation_inspect')); assert.ok(snapshot.tools.includes('bash'));
  }
});

test('R1 AC06: abort while direct or nested native pre-tool hook is in flight cannot save a late candidate', async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
  const f = await fixture(t), provider = await toolProvider(t, [nested ? { tool: 'codemode', input: { code: `const outcome=await tools.${TOOL}(${JSON.stringify(candidate)});text(outcome);` } } : { tool: TOOL }, {}]);
  const gate = path.join(f.root, 'tool-hook-entered'), release = path.join(f.root, 'release-hook');
  const extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'gate.ts'), `import {writeFileSync,existsSync} from 'node:fs';
    export default pi => pi.on('tool_call', async event => {
      if(event.toolName!==${JSON.stringify(TOOL)}) return;
      writeFileSync(${JSON.stringify(gate)},'entered');
      while(!existsSync(${JSON.stringify(release)})) await new Promise(resolve=>setTimeout(resolve,5));
    });`);
  const agent = f.create({ configuration: { ...f.options.configuration, baseUrl: provider.baseUrl } });
  await agent.open(); const running = agent.start('Synthetic delayed native tool hook.', randomUUID());
  const deadline = Date.now() + 5000;
  while (await readFile(gate, 'utf8').catch(() => '') !== 'entered') { assert.ok(Date.now() < deadline, 'native pre-tool hook entered'); await new Promise(resolve => setTimeout(resolve, 5)); }
  const stopping = agent.stop();
  await new Promise(resolve => setTimeout(resolve, 50)); await writeFile(release, 'release');
  await stopping; assert.equal((await running.completion).outcome, 'cancelled');
  const results = (await nativeEntries(agent)).filter(entry => entry.message?.role === 'toolResult' && entry.message.toolName === TOOL);
  assert.equal(results.length, nested ? 0 : 1);
  if (!nested) { assert.equal(results[0].message.isError, true); assert.notEqual(results[0].message.details?.type, 'optracall.agent-candidate'); }
  assert.equal(provider.requests.length, 1);
  assert.equal((await nativeEntries(agent)).filter(entry => entry.customType === 'optracall.agent-candidate').length, 0, 'cancelled late tool cannot append a candidate');
  });
});

test('M31 integrated public Host: ordinary send → same Pi tool call → native save → personal lookup/control/restart, with no extra model calls', { timeout: 30_000 }, async t => {
  const root = path.resolve('.local/fourbase-modules/m31/implementation/runtime', 'host-' + randomUUID());
  const provider = await toolProvider(t, [{ tool: TOOL }, {}]);
  const hostOptions = { dataRoot: path.join(root, 'data'), projectsRoot: path.join(root, 'projects') };
  const host = await startTestHost(hostOptions); t.after(() => host.close());
  const json = async (response: Response, status = 200): Promise<any> => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
  await json(await host.request('/api/configuration', 'PUT', { name: 'M31 isolated SDK', provider: 'openai-compatible', baseUrl: provider.baseUrl, model: 'synthetic-candidate', apiKey: 'synthetic-only-key' }));
  const { project } = await json(await host.request('/api/projects', 'POST', { name: 'M31 real Host synthetic project' }), 201);
  const { task } = await json(await host.request(`/api/projects/${project.id}/tasks`, 'POST', { name: 'Normal unmanaged task' }), 201);
  const route = `/api/projects/${project.id}/tasks/${task.id}`;
  const opened = await json(await host.request(route + '/open', 'POST', {}));
  assert.ok(opened.snapshot.tools.includes(TOOL), 'actual Host passes task provenance to the normal project-task profile');
  const requestId = randomUUID();
  await json(await host.request(route + '/messages', 'POST', { requestId, text: 'Synthetic ordinary task; candidate choice is represented by the canned Provider.' }), 202);
  let current: any; const deadline = Date.now() + 10_000;
  do { current = await json(await host.request(route)); if (current.task.lastRun?.status === 'completed') break; assert.ok(Date.now() < deadline, 'ordinary Host run settles'); await new Promise(resolve => setTimeout(resolve, 10)); } while (true);
  const nativeFile = current.snapshot.sessionFile, before = await readFile(nativeFile);
  const prefix = '/api/personal-retention/candidates';
  const list = await json(await host.request(prefix + '/lookup'));
  assert.equal(list.rows.length, 1, JSON.stringify(list)); assert.equal(list.partial, false); assert.deepEqual(list.issues, []);
  const row = list.rows[0];
  assert.equal(row.status, 'available'); assert.equal(row.parentState, 'completed'); assert.equal(row.details.content.bodyMd, candidate.content.bodyMd);
  assert.deepEqual(row.details.origin, { projectId: project.id, taskId: task.id, sessionId: current.snapshot.sessionId, requestId, toolCallId: 'candidate-call-1' });
  assert.equal(row.ref.expectedDetailsSha256, agentCandidateDetailsSha256(parseAgentCandidateDetails(row.details)));
  assert.equal(row.locations[0].savedPath, 'current');
  const operationId = randomUUID();
  await json(await host.request(prefix + '/controls', 'POST', { operationId, target: row.ref, action: 'bookmark', note: null, expectedTargetRevision: 0 }), 201);
  await json(await host.request(prefix + '/controls', 'POST', { operationId: randomUUID(), target: row.ref, action: 'correct', note: 'Synthetic human opinion, original untouched.' }), 201);
  const detail = await json(await host.request(prefix + '/read', 'POST', { ref: row.ref }));
  assert.equal(detail.details.content.bodyMd, candidate.content.bodyMd); assert.equal(detail.control.notes.length, 1);
  assert.deepEqual(await readFile(nativeFile), before, 'native discovery/read/human control cannot rewrite the original JSONL');
  assert.equal(provider.requests.length, 2, 'one native tool turn and continuation only');
  await host.close();
  const restored = await startTestHost(hostOptions); t.after(() => restored.close());
  const reread = await json(await restored.request(prefix + '/lookup?view=bookmarked'));
  assert.equal(reread.rows.length, 1, JSON.stringify(reread)); assert.deepEqual(reread.rows[0].ref, row.ref);
  assert.equal(reread.rows[0].control.targetRevision, 2); assert.equal(reread.rows[0].control.bookmarked, true);
  assert.equal(reread.rows[0].control.notes[0].note, 'Synthetic human opinion, original untouched.');
  assert.deepEqual(await readFile(nativeFile), before); assert.equal(provider.requests.length, 2, 'restart/read never opens a model loop');
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ outcome: 'PASS', syntheticProviderRequests: provider.requests.length, candidateRef: row.ref, source: nativeFile, unchangedBytes: before.length, humanTargetRevision: reread.rows[0].control.targetRevision }, null, 2) + '\n');
});

test('M31 AC06: native fork rebinds future candidate calls to the new session and keeps copied origin untouched', async t => {
  const f = await fixture(t), provider = await toolProvider(t, [{ tool: TOOL }, {}, {}, { tool: TOOL }, {}]);
  const agent = f.create({ configuration: { ...f.options.configuration, baseUrl: provider.baseUrl } });
  await agent.open(); await agent.start('First original synthetic candidate.', randomUUID()).completion;
  const original = (await nativeEntries(agent)).find(entry => entry.customType === 'optracall.agent-candidate');
  const originalSession = (await agent.snapshot()).sessionId;
  await agent.start('Second user message to fork away.', randomUUID()).completion;
  const selector = await agent.command('/fork', randomUUID());
  const selected = selector.result.entries.find((entry: any) => entry.text === 'Second user message to fork away.'); assert.ok(selected);
  const forked = await agent.command('/fork ' + selected.entryId, randomUUID());
  assert.notEqual(forked.snapshot.sessionId, originalSession);
  const newRequestId = randomUUID(); await agent.start('New candidate on actual fork.', newRequestId).completion;
  const saved = (await nativeEntries(agent)).filter(entry => entry.customType === 'optracall.agent-candidate');
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[0].data.details, original.data.details);
  assert.equal(saved[1].data.details.origin.sessionId, forked.snapshot.sessionId);
  assert.equal(saved[1].data.details.origin.requestId, newRequestId);
  assert.equal(saved[1].data.details.origin.taskId, f.options.taskId);
  assert.notEqual(saved[1].data.details.origin.toolCallId, original.data.details.origin.toolCallId);
  assert.deepEqual(saved[1].data.details.content, original.data.details.content, 'same body in a new invocation is a different occurrence, never a Host semantic merge');
});

test('R1: candidate-only capability rejects completed parent and previous-run ctx, including reused IDs and replacement signals', { timeout: 60_000 }, async t => {
  for (const sameRun of [true, false]) for (const replaceSignal of [false, true]) await t.test(`same-run=${sameRun},new-signal=${replaceSignal}`, async t => {
    const plans = [{ tool: 'capture_candidate_ctx', callId: 'reused-parent', input: {} },
      ...(!sameRun ? [{}] : []), { tool: 'replay_candidate_ctx', callId: 'reused-parent', input: {} }, {}, { tool: TOOL }, {}];
    const f = await fixture(t), provider = await toolProvider(t, plans);
    const extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
    await writeFile(path.join(extensions, 'retained-candidate-ctx.ts'), `export default pi=>{
      const parameters={type:'object',properties:{},additionalProperties:false};let saved;
      pi.registerTool({name:'capture_candidate_ctx',label:'Capture',description:'Capture current SDK ctx for a synthetic lifetime test',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{saved=ctx;return {content:[{type:'text',text:'Captured.'}],details:{}};}});
      pi.registerTool({name:'replay_candidate_ctx',label:'Replay',description:'Try an expired parent ctx',parameters,execute:async(_id,_args,signal)=>{const result=await saved.executeTool('${TOOL}',${JSON.stringify(candidate)},${replaceSignal ? '{signal:new AbortController().signal}' : '{}'});return {...result.result};}});
    };`);
    const agent = f.create({ configuration: { ...f.options.configuration, baseUrl: provider.baseUrl } });
    const opened = await agent.open();
    assert.equal((await agent.start('Capture and try a completed synthetic parent.', randomUUID()).completion).outcome, 'completed');
    if (!sameRun) assert.equal((await agent.start('Try the captured ctx in the next successful run.', randomUUID()).completion).outcome, 'completed');
    assert.equal((await agent.snapshot()).sessionId, opened.sessionId, 'no fork or session replacement disguises a stale invocation');
    assert.equal((await nativeEntries(agent)).filter(entry => entry.customType === 'optracall.agent-candidate').length, 0, 'expired ctx cannot save on the same manager, without any M4 feature enabled');
    assert.equal((await agent.start('An actual current direct candidate remains legal.', randomUUID()).completion).outcome, 'completed');
    assert.equal((await nativeEntries(agent)).filter(entry => entry.customType === 'optracall.agent-candidate').length, 1);
  });
});

test('R1: product multi-level parallel candidates survive incomplete nested arguments and native compaction/reopen', { timeout: 30_000 }, async t => {
  const f = await fixture(t), provider = await toolProvider(t, [{ tool: 'candidate_parallel', input: {} }, {}, {}, {}]);
  const extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
  const longCandidate = { ...candidate, content: { ...candidate.content, bodyMd: 'LONG_PRODUCT_CANDIDATE_' + 'x'.repeat(9000) } };
  await writeFile(path.join(extensions, 'parallel-candidates.ts'), `export default pi=>{
    const parameters={type:'object',properties:{},additionalProperties:false};
    pi.registerTool({name:'candidate_middle',label:'Middle',description:'Synthetic nested candidate',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{const result=await ctx.executeTool('${TOOL}',${JSON.stringify(longCandidate)},{signal:new AbortController().signal});return {...result.result};}});
    pi.registerTool({name:'candidate_parallel',label:'Parallel',description:'Synthetic parallel nested candidates',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{const outcomes=await Promise.all(Array.from({length:4},()=>ctx.executeTool('candidate_middle',{})));return {content:[{type:'text',text:JSON.stringify(outcomes.map(x=>({isError:x.isError,receipt:x.result.details})))}],details:{}};}});
  };`);
  await writeFile(path.join(f.options.resourceRoot, 'settings.json'), JSON.stringify({ compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 16 } }));
  const agent = f.create({ configuration: { ...f.options.configuration, baseUrl: provider.baseUrl } });
  assert.equal((await agent.start('Save parallel synthetic candidates.', randomUUID()).completion).outcome, 'completed');
  const before = await nativeEntries(agent), records = before.filter(entry => entry.customType === 'optracall.agent-candidate');
  assert.equal(records.length, 4); assert.equal(new Set(records.map(entry => entry.id)).size, 4);
  assert.equal(new Set(records.map(entry => entry.data.details.origin.toolCallId)).size, 4);
  assert.ok(records.every(entry => entry.data.details.content.bodyMd === longCandidate.content.bodyMd));
  const parent = before.find(entry => entry.message?.toolName === 'candidate_parallel').message;
  assert.equal(parent.isError, false); assert.equal(parent.nestedCalls.complete, false);
  assert.ok(!JSON.stringify(parent.content).includes(longCandidate.content.bodyMd), 'parent carries receipts, not copied candidate bodies');
  await agent.start('Another synthetic message so compaction has a retained turn.', randomUUID()).completion;
  assert.equal((await agent.command('/compact', randomUUID())).outcome, 'completed');
  const compacted = await nativeEntries(agent); assert.ok(compacted.some(entry => entry.type === 'compaction'));
  assert.deepEqual(compacted.filter(entry => entry.customType === 'optracall.agent-candidate'), records);
  const state = await agent.snapshot(), disk = await readNativeSessionSnapshot(state.sessionFile!, f.options.sessionDirectory, path.join(f.options.projectDirectory, '020_clean'));
  assert.equal(disk.entries.filter(entry => entry.type === 'custom' && entry.customType === 'optracall.agent-candidate').length, 4);
  await agent.close();
  const reopened = f.create({ sessionFile: state.sessionFile }); await reopened.open();
  assert.deepEqual((await nativeEntries(reopened)).filter(entry => entry.customType === 'optracall.agent-candidate'), records);
});

test('R1: append without a safe persistence proof returns UNKNOWN and never automatically appends again', async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
  const f = await fixture(t), provider = await toolProvider(t, [nested ? { tool: 'codemode', input: { code: `const result=await tools.${TOOL}(${JSON.stringify(candidate)});text(result);` } } : { tool: TOOL }, {}]);
  const dataRoot = path.join(f.root, 'data'), projects = new ProjectStore({ dataRoot, projectsRoot: path.join(f.root, 'projects') });
  await projects.init(); t.after(() => projects.close());
  const project = await projects.create({ name: 'R1 unknown persistence', configuration: f.options.configuration });
  const task = await projects.createTask(project.id, { name: 'Candidate confirmation failure' });
  const extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
  const extraLink = path.join(f.root, 'unsafe-native-link');
  await writeFile(path.join(extensions, 'unsafe-native.ts'), `import {linkSync} from 'node:fs';export default pi=>pi.on('tool_call',(event,ctx)=>{if(event.toolName==='${TOOL}')linkSync(ctx.sessionManager.getSessionFile(),${JSON.stringify(extraLink)});});`);
  const agent = f.create({ projectId: project.id, taskId: task.id, projectDirectory: project.rootPath, sessionDirectory: task.sessionDirectory, configuration: { ...f.options.configuration, baseUrl: provider.baseUrl } });
  const result = await agent.start('Synthetic unsafe native storage.', randomUUID()).completion;
  assert.equal(result.outcome, 'completed', 'Agent may finish the parent task after receiving an explicit tool error');
  const entries = await nativeEntries(agent), saved = entries.filter(entry => entry.customType === 'optracall.agent-candidate');
  assert.equal(saved.length, 1, 'append can precede failed confirmation; no second append is attempted');
  const receipt = entries.find(entry => entry.message?.toolName === (nested ? 'codemode' : TOOL)).message;
  if (!nested) assert.equal(receipt.isError, true);
  assert.ok(JSON.stringify(receipt.content).includes('agent_candidate_save_unknown'));
  assert.notEqual(receipt.details?.status, 'saved'); assert.equal(provider.requests.length, 2);
  assert.equal(entries.filter(entry => entry.customType === 'optracall.agent-candidate-receipt').length, 0, 'unconfirmed body has no saved confirmation metadata');
  const state = await agent.snapshot();
  await assert.rejects(readNativeSessionSnapshot(state.sessionFile!, task.sessionDirectory, path.join(project.rootPath, '020_clean')), { code: 'session_history_unavailable' });
  await unlink(extraLink); // Fixture-only link cleanup; native bytes and the original UNKNOWN remain.
  await projects.setSession(project.id, task.id, state.sessionFile!);
  const controls = new AgentCandidateControls({ dataRoot, readTarget: async ref => { await reader.read(ref); } });
  const reader = createAgentCandidateReader({ projects, controls });
  const before = await readFile(state.sessionFile!), page = await reader.lookup();
  assert.equal(page.rows.length, 1); assert.equal(page.rows[0]?.status, 'unknown');
  assert.equal(page.rows[0]?.reason, 'candidate_save_unconfirmed'); assert.equal(page.rows[0]?.details, null);
  assert.deepEqual(await readFile(state.sessionFile!), before, 'later safe reading preserves the original UNKNOWN without rewriting native');
  assert.equal(provider.requests.length, 2, 'no hidden repair or model retry');
  });
});

test('R1: a child paused before execution cannot save after its launching parent has completed', async t => {
  const f = await fixture(t), provider = await toolProvider(t, [{ tool: 'launch_candidate_child', input: {} }, { tool: 'release_candidate_child', input: {} }, {}]);
  const extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'unawaited-candidate.ts'), `export default pi=>{
    let release,pending;const parameters={type:'object',properties:{},additionalProperties:false};
    pi.on('tool_call',async event=>{if(event.toolName==='${TOOL}')await new Promise(resolve=>{release=resolve;});});
    pi.registerTool({name:'launch_candidate_child',label:'Launch',description:'Synthetic child paused in the SDK hook',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{pending=ctx.executeTool('${TOOL}',${JSON.stringify(candidate)});return {content:[{type:'text',text:'Parent has returned.'}],details:{}};}});
    pi.registerTool({name:'release_candidate_child',label:'Release',description:'Release the child after the original parent returned',parameters,execute:async()=>{if(!release)throw Error('Fixture child has not reached its hook');release();const result=await pending;return {...result.result};}});
  };`);
  const agent = f.create({ configuration: { ...f.options.configuration, baseUrl: provider.baseUrl } });
  assert.equal((await agent.start('Try a late unawaited child in the same run.', randomUUID()).completion).outcome, 'completed');
  const entries = await nativeEntries(agent);
  assert.ok(entries.some(entry => entry.message?.toolName === 'launch_candidate_child'), 'the original parent actually finished');
  assert.equal(entries.filter(entry => entry.customType === 'optracall.agent-candidate').length, 0, 'expired parent qualification must be checked before the child writes');
  assert.ok(JSON.stringify(entries.filter(entry => entry.message?.toolName === 'release_candidate_child')).includes('personal_context_run_unavailable'));
  assert.equal(provider.requests.length, 3);
});
