import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import type { SemanticContextPort, SemanticContextToolResult } from '../src/agent/semantic-context.ts';
import { startToolProvider, type SyntheticToolCall } from './fixtures/tool-provider.ts';

const target = { kind: 'sap' as const, packageId: 'synthetic-rule', version: '1.2', metricName: 'amount', publishedHash: 'a'.repeat(64) };
const queryResult = (action: 'find' | 'read' | 'trace', text = 'SYNTHETIC_EXACT_OLD_RULE'): SemanticContextToolResult => ({ content: [{ type: 'text', text }], details: { schemaVersion: 1, type: 'optracall.semantic-context-result', action, state: 'available', items: [], unknownTime: [], indexRevision: 3, coverage: { complete: true, continuation: null, gaps: [] } } });
function citationInput() {
  const operationId = randomUUID();
  return { operationId, citationId: operationId, baseIndexRevision: 3, report: { path: '060_reports/synthetic.md', sha256: 'b'.repeat(64), bytes: 12 }, attachments: [], selections: [], conceptRefs: [], sapRefs: [{ packageId: target.packageId, version: target.version, metricName: target.metricName, publishedHash: target.publishedHash }], declaration: 'Synthetic author declares the exact old rule; this is not execution verification.', nativeEvidence: null };
}
const recorded = (input: ReturnType<typeof citationInput>, projectId: string): SemanticContextToolResult => ({ content: [{ type: 'text', text: 'Synthetic author declaration saved; adoption and correctness remain unverified.' }], details: { schemaVersion: 1, type: 'optracall.analysis-sources-recorded', claim: 'author-declaration-not-verification', projectId, citationId: input.citationId, operationId: input.operationId, indexRevision: 4, replayed: false, publishedOnRetry: false, report: { originalPath: input.report.path, sha256: input.report.sha256, bytes: input.report.bytes } } });

async function fixture(t: TestContext) {
  const root = path.resolve('.local/fourbase-modules/m7-l1-semantic-trace/implementation/pi-runtime', randomUUID());
  const projectDirectory = path.join(root, 'project');
  for (const name of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, name), { recursive: true });
  const provider = await startToolProvider();
  const options = { projectId: randomUUID(), taskId: randomUUID(), projectDirectory, codeRoot: process.cwd(), sessionDirectory: path.join(root, 'native'), resourceRoot: path.join(root, 'resources'), managementPorts: [], configuration: { id: 'l1-synthetic', name: 'L1 synthetic only', revision: 1, provider: 'synthetic', api: 'openai-completions' as const, baseUrl: provider.baseUrl, model: 'l1-synthetic', apiKey: 'synthetic-l1-key' } };
  const agents: ProjectAgent[] = [];
  const create = (overrides: Partial<ProjectAgentOptions> = {}) => { const agent = new ProjectAgent({ ...options, ...overrides }); agents.push(agent); return agent; };
  t.after(async () => { for (const agent of agents) await agent.close(); await provider.close(); });
  return { root, options, provider, create };
}
async function entries(agent: ProjectAgent) {
  const state = await agent.snapshot(); assert.ok(state.sessionFile);
  return (await readFile(state.sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
}

test('L1 L107/L110: an ordinary project task with the Host capability advertises explicit query and source-save tools', async t => {
  const f = await fixture(t);
  const options = { semanticContext: async () => { throw new Error('Opening a task must not query or save sources.'); } };
  const agent = f.create(options);
  const opened = await agent.open();
  assert.ok(opened.tools.includes('read_semantic_context'), 'ordinary Host callback must expose the query tool through actual Pi customTools');
  assert.ok(opened.tools.includes('record_analysis_sources'), 'ordinary Host callback must expose the original M2 citation save capability');
  assert.ok(opened.tools.includes('bash'));
  assert.equal(f.provider.requests.length, 0, 'open is not a model request or semantic query');
});

test('L1 L101/L102/L107: direct and SDK nested calls keep exact query/save arguments, real run identity, hooks and native results', async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
    const f = await fixture(t), save = citationInput();
    const plan = [
      { name: 'read_semantic_context', arguments: { action: 'read', target } },
      { name: 'read_semantic_context', arguments: { action: 'trace', target, recordedBefore: '2026-10-10T00:00:00+08:00', pageSize: 1 } },
      { name: 'record_analysis_sources', arguments: save },
    ];
    f.provider.setResponder(({ requestNumber }) => {
      const call = plan[requestNumber - 1];
      return call ? { calls: [nested ? { name: 'codemode', arguments: { code: `text(await tools.${call.name}(${JSON.stringify(call.arguments)}));` } } : call] } : { text: 'Synthetic source tracing complete, declaration is not verification.' };
    });
    const hookFile = path.join(f.root, 'hooks.jsonl'), extensionRoot = path.join(f.options.resourceRoot, 'extensions');
    await mkdir(extensionRoot, { recursive: true });
    await writeFile(path.join(extensionRoot, 'observe.ts'), `import {appendFileSync} from 'node:fs'; export default pi=>{for(const name of ['tool_call','tool_result']) pi.on(name,(event,ctx)=>{if(['read_semantic_context','record_analysis_sources'].includes(event.toolName))appendFileSync(${JSON.stringify(hookFile)},JSON.stringify({name,tool:event.toolName,parent:event.parentToolCallId??null,sessionId:ctx.sessionManager.getSessionId()})+'\\n');});};`);
    const calls: { action: string; input: Record<string, unknown>; context: Parameters<SemanticContextPort>[2] }[] = [];
    const agent = f.create({ semanticContext: async (action, input, context) => {
      context.assertCurrent(); assert.equal(context.signal.aborted, false); calls.push({ action, input, context });
      return action === 'record' ? recorded(save, f.options.projectId) : queryResult(action);
    } });
    const opened = await agent.open(), requestId = randomUUID();
    const run = agent.start('Synthetic exact old rule and explicit author declaration.', requestId); await run.accepted;
    assert.equal((await run.completion).outcome, 'completed');
    assert.deepEqual(calls.map(({ action, input }) => ({ action, input })), [
      { action: 'read', input: { target } },
      { action: 'trace', input: { target, recordedBefore: '2026-10-10T00:00:00+08:00', pageSize: 1 } },
      { action: 'record', input: save },
    ]);
    assert.ok(calls.every(call => call.context.requestId === requestId && call.context.sessionId === opened.sessionId && call.context.toolCallId.trim()));
    assert.equal(f.provider.requests.length, 4);
    assert.ok(JSON.stringify(f.provider.requests[1].body.messages).includes('SYNTHETIC_EXACT_OLD_RULE'));
    assert.ok(JSON.stringify(f.provider.requests[3].body.messages).includes('Synthetic author declaration saved; adoption and correctness remain unverified.'));
    const hooks = (await readFile(hookFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(hooks.map(hook => hook.name), ['tool_call', 'tool_result', 'tool_call', 'tool_result', 'tool_call', 'tool_result']);
    assert.ok(hooks.every(hook => hook.sessionId === opened.sessionId && (nested ? /^call_[123]_0$/.test(hook.parent) : hook.parent === null)));
    const native = await entries(agent), results = native.filter(entry => entry.message?.role === 'toolResult');
    if (nested) {
      assert.equal(results.filter(entry => ['read_semantic_context', 'record_analysis_sources'].includes(entry.message.toolName)).length, 0, 'nested calls remain under the actual SDK parent transcript');
      assert.deepEqual(results.map(entry => entry.message.nestedCalls.calls[0].name), plan.map(call => call.name));
      assert.ok(results.every(entry => entry.message.nestedCalls.calls[0].status === 'ok'));
    } else {
      assert.deepEqual(results.map(entry => entry.message.toolName), plan.map(call => call.name));
      assert.deepEqual(results.at(-1).message.details, recorded(save, f.options.projectId).details);
      assert.ok(results.every(entry => entry.message.isError === false));
    }
    const state = await agent.snapshot(); await agent.close();
    const reopened = f.create({ sessionFile: state.sessionFile });
    const recovered = await reopened.open();
    assert.equal(recovered.sessionId, opened.sessionId);
    assert.ok(JSON.stringify(recovered.messages).includes('Synthetic author declaration saved; adoption and correctness remain unverified.'));
    assert.ok(!recovered.tools.includes('read_semantic_context'), 'callback-free reopen preserves new native results without granting the capability');
  });
});

test('L1 L109/L110/L113: callback-free and forbidden profiles keep original tools; no-query work performs zero semantic IO', async t => {
  const f = await fixture(t);
  const denied: SemanticContextPort = async () => { assert.fail('Unavailable profile must not call the Host semantic port.'); };
  const baseline = await f.create().open();
  assert.ok(baseline.tools.includes('bash'));
  assert.ok(!baseline.tools.includes('read_semantic_context'));
  assert.ok(!baseline.tools.includes('record_analysis_sources'));
  const workspace = { cwd: path.join(f.options.projectDirectory, '020_clean'), systemPrompt: ['Synthetic plugin workspace.'] };
  const profiles: Partial<ProjectAgentOptions>[] = [{ projectId: '' }, { taskId: undefined }, { workspace }, { workspace: { ...workspace, capabilityPolicy: 'fixed-draft' } }, { workspace: { ...workspace, capabilityPolicy: 'text-only' } }];
  if (process.platform === 'darwin') for (const profile of ['ordinary', 'protected'] as const) profiles.push({ protectedExecution: { id: randomUUID(), profile, cwd: workspace.cwd, writableRoot: workspace.cwd, readRoots: [] } });
  for (const profile of profiles) {
    const agent = f.create({ ...profile, semanticContext: denied, sessionDirectory: path.join(f.root, randomUUID()) });
    const opened = await agent.open();
    assert.ok(!opened.tools.includes('read_semantic_context'));
    assert.ok(!opened.tools.includes('record_analysis_sources'));
    if (!profile.workspace?.capabilityPolicy) assert.ok(opened.tools.includes('bash'));
    await agent.close();
  }
  let calls = 0;
  const agent = f.create({ semanticContext: async action => { calls++; return queryResult(action === 'record' ? 'find' : action); } });
  const completed = await agent.start('Synthetic normal question; no prerequisite lookup or save.', randomUUID()).completion;
  assert.equal(completed.outcome, 'completed'); assert.equal(calls, 0); assert.equal(f.provider.requests.length, 1);
  assert.deepEqual((await entries(agent)).filter(entry => entry.message?.role === 'toolResult'), []);
  const reloaded = await agent.command('/reload');
  assert.ok(reloaded.snapshot.tools.includes('read_semantic_context'));
  assert.ok(reloaded.snapshot.tools.includes('record_analysis_sources'));
  assert.ok(reloaded.snapshot.tools.includes('record_agent_candidate'));
  assert.ok(reloaded.snapshot.tools.includes('bash'));
});

test('L1 L113: absent/empty/error queries and rejected/unknown saves do not block actual original Python analysis', async t => {
  for (const mode of ['no-query', 'empty', 'query-error', 'save-rejected', 'save-unknown'] as const) await t.test(mode, async t => {
    const f = await fixture(t), save = citationInput();
    await writeFile(path.join(f.options.projectDirectory, '020_clean', 'values.csv'), 'amount\n17\n25\n');
    const python = "python3 - <<'PY'\nimport csv\nfrom pathlib import Path\nwith open('values.csv', newline='') as source:\n    total = sum(int(row['amount']) for row in csv.DictReader(source))\nresult = 'total=' + str(total) + '\\n'\nPath('../060_reports/python-result.txt').write_text(result)\nprint(result, end='')\nPY";
    const calls: SyntheticToolCall[] = mode === 'no-query' ? [] : [{ name: mode.startsWith('save-') ? 'record_analysis_sources' : 'read_semantic_context', arguments: mode.startsWith('save-') ? save : { action: 'find', query: 'synthetic missing semantic rule' } }];
    calls.push({ name: 'bash', arguments: { command: python } });
    f.provider.setResponder(({ requestNumber }) => calls[requestNumber - 1] ? { calls: [calls[requestNumber - 1]] } : { text: 'Synthetic analysis completed: total=42. Any source-save gap remains unverified.' });
    let reads = 0;
    const agent = f.create({ semanticContext: async action => {
      reads++;
      if (mode === 'query-error') throw Object.assign(new Error('Synthetic unavailable query.'), { code: 'semantic_source_unavailable' });
      if (mode === 'save-rejected') throw Object.assign(new Error('Synthetic source save conflict.'), { code: 'data_context_revision_conflict' });
      if (mode === 'save-unknown') throw Object.assign(new Error('Synthetic unknown acknowledgement.'), { code: 'data_context_ack_unknown' });
      return queryResult(action === 'record' ? 'find' : action, 'Synthetic empty semantic directory; no entries, analysis may continue.');
    } });
    const completion = await agent.start('Synthetic same input and permissions: compute the total with existing Python, optional sources may be unavailable.', randomUUID()).completion;
    assert.equal(completion.outcome, 'completed');
    assert.equal(await readFile(path.join(f.options.projectDirectory, '060_reports', 'python-result.txt'), 'utf8'), 'total=42\n');
    assert.equal(reads, mode === 'no-query' ? 0 : 1);
    const saved = await entries(agent), results = saved.filter(entry => entry.message?.role === 'toolResult');
    const pythonResult = results.find(entry => entry.message.toolName === 'bash');
    assert.equal(pythonResult.message.isError, false); assert.ok(JSON.stringify(pythonResult.message.content).includes('total=42'));
    if (['query-error', 'save-rejected', 'save-unknown'].includes(mode)) {
      assert.equal(results[0].message.isError, true, 'auxiliary failure remains an actual SDK tool error');
      assert.ok(!JSON.stringify(results[0].message).includes('optracall.analysis-sources-recorded'));
    }
    assert.equal(f.provider.requests.length, calls.length + 1, 'only Agent-requested tool continuations, no Host retry or extra model loop');
  });
});

test('L1 L107/L110: stop revokes direct/nested query and save callbacks; late results cannot enter a new request', async t => {
  for (const nested of [false, true]) for (const writing of [false, true]) await t.test(`${nested ? 'nested' : 'direct'} ${writing ? 'save' : 'read'}`, async t => {
    const f = await fixture(t), save = citationInput(), tool = writing ? 'record_analysis_sources' : 'read_semantic_context';
    const input = writing ? save : { action: 'read', target };
    f.provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: nested ? 'codemode' : tool, arguments: nested ? { code: `text(await tools.${tool}(${JSON.stringify(input)}));` } : input }] } : { text: 'Synthetic explicitly started fresh request.' });
    let entered!: () => void, release!: (value: SemanticContextToolResult) => void, context: Parameters<SemanticContextPort>[2] | undefined;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const agent = f.create({ semanticContext: async (_action, _input, ctx) => { context = ctx; entered(); return await new Promise(resolve => { release = resolve; }); } });
    const active = agent.start('Synthetic cancel slow source IO.', randomUUID()); await active.accepted; await waiting;
    await agent.stop(); assert.equal(context!.signal.aborted, true);
    assert.throws(() => context!.assertCurrent());
    assert.equal((await active.completion).outcome, 'cancelled');
    const next = agent.start('Synthetic next explicit question.', randomUUID());
    release(writing ? recorded(save, f.options.projectId) : queryResult('read'));
    assert.equal((await next.completion).outcome, 'completed');
    assert.equal(f.provider.requests.length, 2, 'aborted source operation adds no model continuation');
    const persisted = await readFile((await agent.snapshot()).sessionFile!, 'utf8');
    assert.ok(!persisted.includes('SYNTHETIC_EXACT_OLD_RULE'));
    assert.ok(!persisted.includes('Synthetic author declaration saved'));
  });
});

test('L1 L101/L107/L110: SDK rejects incomplete exact targets and forged save identity before Host IO', async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
    const f = await fixture(t), save = { ...citationInput(), projectId: 'forged-project', declarer: 'user' };
    const calls = [{ name: 'read_semantic_context', arguments: { action: 'read', target: { kind: 'sap', packageId: 'synthetic-rule' } } }, { name: 'record_analysis_sources', arguments: save }];
    f.provider.setResponder(({ requestNumber }) => {
      const call = calls[requestNumber - 1];
      return call ? { calls: [nested ? { name: 'codemode', arguments: { code: `text(await tools.${call.name}(${JSON.stringify(call.arguments)}));` } } : call] } : { text: 'Synthetic invalid auxiliary arguments did not prevent a normal reply.' };
    });
    let io = 0; const agent = f.create({ semanticContext: async () => { io++; return queryResult('read'); } });
    assert.equal((await agent.start('Synthetic malformed target/owner must fail locally.', randomUUID()).completion).outcome, 'completed');
    assert.equal(io, 0);
    const results = (await entries(agent)).filter(entry => entry.message?.role === 'toolResult');
    assert.equal(results.length, 2);
    assert.ok(results.every(entry => nested ? entry.message.nestedCalls.calls[0].status === 'error' : entry.message.isError));
  });
});

test('L1 L110: original SDK permission hooks can deny direct/nested semantic reads and writes before Host IO', async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
    const f = await fixture(t), calls = [{ name: 'read_semantic_context', arguments: { action: 'read', target } }, { name: 'record_analysis_sources', arguments: citationInput() }];
    const extensionRoot = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensionRoot, { recursive: true });
    await writeFile(path.join(extensionRoot, 'deny.ts'), "export default pi=>pi.on('tool_call',event=>['read_semantic_context','record_analysis_sources'].includes(event.toolName)?{block:true,reason:'Synthetic semantic permission denied.'}:undefined);");
    f.provider.setResponder(({ requestNumber }) => {
      const call = calls[requestNumber - 1];
      return call ? { calls: [nested ? { name: 'codemode', arguments: { code: `text(await tools.${call.name}(${JSON.stringify(call.arguments)}));` } } : call] } : { text: 'Synthetic denied auxiliary tools still allow an ordinary answer.' };
    });
    let io = 0; const agent = f.create({ semanticContext: async () => { io++; return queryResult('read'); } });
    assert.equal((await agent.start('Synthetic native permission denial.', randomUUID()).completion).outcome, 'completed');
    assert.equal(io, 0);
    const results = (await entries(agent)).filter(entry => entry.message?.role === 'toolResult');
    assert.equal(results.length, 2);
    assert.ok(results.every(entry => nested ? entry.message.nestedCalls.calls[0].status === 'error' : entry.message.isError));
  });
});

test('L1 L110: a settled SDK caller cannot reuse its captured executeTool in a subsequent run', async t => {
  const f = await fixture(t), extensionRoot = path.join(f.options.resourceRoot, 'extensions');
  await mkdir(extensionRoot, { recursive: true });
  await writeFile(path.join(extensionRoot, 'stale.ts'), `export default pi=>{
    const parameters={type:'object',properties:{},additionalProperties:false};
    pi.registerTool({name:'capture_l1_context',label:'Synthetic capture',description:'Synthetic SDK context capture',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{globalThis.__l1CapturedContext=ctx;return {content:[{type:'text',text:'Synthetic caller captured.'}],details:{}};}});
    pi.registerTool({name:'replay_l1_context',label:'Synthetic replay',description:'Synthetic stale SDK context check',parameters,execute:async()=>{const outcome=await globalThis.__l1CapturedContext.executeTool('read_semantic_context',${JSON.stringify({ action: 'read', target })});return {content:[{type:'text',text:outcome.isError?'STALE_L1_CALLER_REJECTED':'STALE_L1_CALLER_UNEXPECTED_SUCCESS'}],details:{}};}});
  };`);
  f.provider.setResponder(({ requestNumber }) => {
    const call = ({ 1: { name: 'capture_l1_context', arguments: {} }, 3: { name: 'replay_l1_context', arguments: {} }, 4: { name: 'read_semantic_context', arguments: { action: 'read', target } } } as Record<number, SyntheticToolCall>)[requestNumber];
    return call ? { calls: [call] } : { text: 'Synthetic ordinary completion.' };
  });
  let reads = 0; const agent = f.create({ semanticContext: async action => { reads++; return queryResult(action === 'record' ? 'read' : action); } });
  await agent.start('Synthetic first caller settles.', randomUUID()).completion;
  assert.equal(reads, 0);
  assert.equal((await agent.start('Synthetic later run rejects old caller but permits a current read.', randomUUID()).completion).outcome, 'completed');
  assert.equal(reads, 1);
  const results = (await entries(agent)).filter(entry => entry.message?.role === 'toolResult');
  assert.ok(JSON.stringify(results.find(entry => entry.message.toolName === 'replay_l1_context').message.content).includes('STALE_L1_CALLER_REJECTED'));
  assert.equal(results.find(entry => entry.message.toolName === 'read_semantic_context').message.isError, false);
});
