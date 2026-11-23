import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { anthropicToolResults, startAnthropicToolProvider } from './fixtures/anthropic-tool-provider.ts';

async function miniMaxStrategyFixture(t: TestContext, strategyDiscussion: ProjectAgentOptions['strategyDiscussion'], discussionTools?: 'project-sources' | 'goal-draft') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'issue115-minimax-strategy-'));
  const provider = await startAnthropicToolProvider();
  const cwd = path.join(root, 'workspace'), resourceRoot = path.join(root, 'resources'), fixtureCode = path.join(root, 'fixture-code');
  await mkdir(cwd, { recursive: true });
  await mkdir(resourceRoot, { recursive: true });
  await mkdir(path.join(fixtureCode, 'scripts'), { recursive: true });
  await writeFile(path.join(resourceRoot, 'settings.json'), JSON.stringify({ retry: { enabled: false, maxRetries: 0 }, cacheWarming: 'off' }));
  await writeFile(path.join(fixtureCode, 'scripts/project-entry.mjs'), `
    import { configureHttpTransport } from ${JSON.stringify(pathToFileURL(path.resolve('scripts/http-transport.mjs')).href)};
    import { getGlobalDispatcher, setGlobalDispatcher } from ${JSON.stringify(pathToFileURL(path.resolve('node_modules/undici/index.js')).href)};
    process.umask(0o077);
    const transport = configureHttpTransport();
    setGlobalDispatcher(getGlobalDispatcher().compose(dispatch => (options, handler) => {
      const url = new URL(String(options.origin));
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('issue115_disallows_non_loopback');
      return dispatch(options, handler);
    }));
    process.prependListener('message', message => {
      if (message.method === 'open') message.input.codeRoot = ${JSON.stringify(process.cwd())};
    });
    try { const { runProjectSession } = await import(${JSON.stringify(pathToFileURL(path.resolve('src/agent/project-session.ts')).href)}); await runProjectSession(transport); }
    catch { await transport.close(); process.exitCode = 1; if (process.connected) process.disconnect(); }
  `);
  const requestId = randomUUID();
  const options: ProjectAgentOptions = {
    projectId: 'strategy-discussion:' + randomUUID(),
    workspace: { cwd, systemPrompt: ['Use only the synthetic strategy tool when needed.'], capabilityPolicy: 'strategy-discussion', ...(discussionTools ? { discussionTools } : {}) },
    sessionDirectory: path.join(root, 'native'), resourceRoot, codeRoot: fixtureCode, managementPorts: [],
    configuration: { id: 'minimax-m31-flash', name: 'Synthetic MiniMax loopback', revision: 1, provider: 'minimax-cn', api: 'anthropic-messages', baseUrl: provider.baseUrl, model: 'MiniMax-M3.1-Flash', apiKey: 'synthetic-minimax-only' },
    strategyDiscussion,
  };
  const agent = new ProjectAgent(options);
  t.after(async () => { await agent.close(); await provider.close(); });
  const opened = await agent.open();
  return { agent, provider, opened, requestId, options };
}

async function nativeToolCalls(file: string) {
  const entries = (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return {
    calls: entries.flatMap(entry => entry.message?.role === 'assistant' && Array.isArray(entry.message.content) ? entry.message.content.filter((part: any) => part.type === 'toolCall') : []),
    results: entries.filter(entry => entry.message?.role === 'toolResult').map(entry => entry.message),
  };
}

const syntheticPayload = (value: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: value });

test('v1.2 strategy discussion uses the official Pi native history and only its narrow tool across restart', {timeout:45000}, async t => {
  const root=await mkdtemp(path.join(os.tmpdir(),'v12-discussion-runtime-'));
  const provider=await startToolProvider();
  const cwd=path.join(root,'workspace');await mkdir(cwd,{recursive:true});
  let calls=0;
  const options={projectId:'strategy-discussion:'+randomUUID(),workspace:{cwd,systemPrompt:['Discuss strategy. Use the narrow strategy tool only when appropriate.'],capabilityPolicy:'strategy-discussion'},sessionDirectory:path.join(root,'native'),resourceRoot:path.join(root,'resources'),codeRoot:process.cwd(),managementPorts:[],configuration:{id:'synthetic',name:'Synthetic',revision:1,provider:'openai-compatible',api:'openai-completions',baseUrl:provider.baseUrl,model:'synthetic-strategy',apiKey:'synthetic-strategy-only'},strategyDiscussion:async(action:string,_input:unknown,context:any)=>{context.assertCurrent();assert.equal(action,'read-goals');calls++;return {content:[{type:'text',text:'EXACT_GOAL_V1'}],details:{claim:'provided-not-adopted'}};}} as unknown as ProjectAgentOptions;
  const agents:ProjectAgent[]=[];t.after(async()=>{for(const a of agents)await a.close();await provider.close();});
  provider.setResponder(ctx=>ctx.recentToolResults.length?{text:'Candidate remains unadopted.'}:{calls:[{name:'strategy_goals',arguments:{action:'read-goals'}}]});
  const first=new ProjectAgent(options);agents.push(first);const opened=await first.open();
  assert.deepEqual(opened.tools,['strategy_goals'],'no inherited execution, MCP, or ordinary business tools');
  const done=await first.start('FIRST_STRATEGY_REQUEST',randomUUID(),undefined,{userQuoteEligible:true,originalUserText:'FIRST_STRATEGY_REQUEST'}).completion;
  assert.equal(done.outcome,'completed');assert.equal(calls,1);
  const original=await readFile(opened.sessionFile!);await first.close();
  const next=new ProjectAgent({...options,sessionFile:opened.sessionFile});agents.push(next);await next.open();
  provider.setResponder(ctx=>{assert.ok(ctx.messages.some(x=>providerMessageText(x.content).includes('FIRST_STRATEGY_REQUEST')));return {text:'Continued without changing the goal.'};});
  assert.equal((await next.start('SECOND_STRATEGY_REQUEST',randomUUID()).completion).outcome,'completed');
  assert.deepEqual((await readFile(opened.sessionFile!)).subarray(0,original.length),original);
  assert.deepEqual(provider.errors,[]);t.diagnostic(root);
});

test('Issue 115 aligns MiniMax Anthropic schema, fragmented non-first actions, native calls and following tool results', { timeout: 45_000 }, async t => {
  const delivered: { action: string; input: Record<string, unknown>; requestId: string; toolCallId: string }[] = [];
  const mapId = randomUUID(), operationId = randomUUID();
  const mapDraft = { title: '合成候选', template: 'bsc', choice: '方向甲', assumptions: '', unknowns: '', nodes: [{ id: 'G1', kind: 'goal', title: '提高复购' }], edges: [] };
  const fixture = await miniMaxStrategyFixture(t, async (action, input, context) => {
    context.assertCurrent();
    delivered.push({ action, input, requestId: context.requestId, toolCallId: context.toolCallId });
    if (action === 'find-sources') return syntheticPayload({ sources: [], range: { start: 0, end: 0, total: 0 }, complete: true });
    if (action === 'read-map') return syntheticPayload({ map: { mapId, version: 2, title: '旧版' } });
    if (action === 'save-map') return syntheticPayload({ map: { mapId, version: 3 }, operationId, claim: 'candidate-not-adopted' });
    throw new Error('unexpected_' + action);
  });
  const { agent, provider, opened, requestId } = fixture;
  provider.setResponder(({ requestNumber }) => {
    if (requestNumber === 1) return { calls: [{ name: 'strategy_goals', arguments: { action: 'find-sources', query: '渠道', offset: 0 }, fragments: 5 }] };
    if (requestNumber === 2) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-map', mapId, version: 2, offset: 0, limit: 20 }, fragments: 4 }] };
    if (requestNumber === 3) return { calls: [{ name: 'strategy_goals', arguments: { action: 'save-map', mapDraft, operationId, reason: '合成保存' }, fragments: 7 }] };
    return { text: '合成工具链完成。' };
  });
  const done = await agent.start('合成战略讨论', requestId, undefined, { originalUserText: '合成战略讨论', userQuoteEligible: true }).completion;
  assert.equal(done.outcome, 'completed', JSON.stringify({ diagnostic: done.diagnostic, providerErrors: provider.errors, requests: provider.requests.length, delivered }));
  assert.deepEqual(delivered.map(call => call.action), ['find-sources', 'read-map', 'save-map']);
  assert.ok(delivered.every(call => call.requestId === requestId));

  const actionSchema = provider.requests[0]?.body.tools?.find((tool: any) => tool.name === 'strategy_goals')?.input_schema?.properties?.action;
  assert.ok(actionSchema, 'the actual Anthropic request includes the action schema');
  for (const action of ['read-goals', 'find-sources', 'read-map', 'save-map']) assert.ok(JSON.stringify(actionSchema).includes(`"${action}"`));
  assert.equal(provider.requests.length, 4);
  assert.ok(provider.requests.slice(0, 3).every(request => request.emitted[0]!.fragments.length > 1));

  const native = await nativeToolCalls(opened.sessionFile!);
  assert.deepEqual(native.calls.map(call => call.name), ['strategy_goals', 'strategy_goals', 'strategy_goals']);
  assert.deepEqual(native.calls.map(call => call.arguments.action), ['find-sources', 'read-map', 'save-map']);
  for (const [index, call] of native.calls.entries()) {
    const emitted = provider.requests[index]!.emitted[0]!;
    assert.equal(call.id, emitted.id);
    assert.deepEqual(call.arguments, emitted.arguments);
    assert.equal(delivered[index]!.toolCallId, emitted.id);
    const following = anthropicToolResults(provider.requests[index + 1]!.body).find(result => result.id === emitted.id);
    assert.ok(following, 'the next Provider request receives the same toolCallId result');
    assert.equal(native.results.find(result => result.toolCallId === emitted.id)?.isError, false);
  }
  assert.match(anthropicToolResults(provider.requests[3]!.body).find(result => result.id === provider.requests[2]!.emitted[0]!.id)!.content, /candidate-not-adopted/);
  assert.deepEqual(provider.errors, []);
  t.diagnostic(`Synthetic MiniMax wire/native evidence: ${opened.sessionFile}`);
});

test('Issue 115 reproduces read-goals dispatch even when unrelated fields vary under MiniMax Anthropic fragmentation', { timeout: 45_000 }, async t => {
  const delivered: { action: string; input: Record<string, unknown>; toolCallId: string }[] = [];
  const fixture = await miniMaxStrategyFixture(t, async (action, input, context) => {
    context.assertCurrent();
    delivered.push({ action, input, toolCallId: context.toolCallId });
    return syntheticPayload({ goalScopes: [], candidates: [], claim: 'provided-not-adopted' });
  });
  const { agent, provider, opened, requestId } = fixture;
  const varyingInputs = [
    { action: 'read-goals' },
    { action: 'read-goals', query: '渠道' },
    { action: 'read-goals', sourceId: 'synthetic-source' },
    { action: 'read-goals', mapDraft: { title: '仍被分派为读取', template: 'table', nodes: [{ id: 'G', kind: 'goal', title: '目标' }], edges: [] } },
  ];
  provider.setResponder(({ requestNumber }) => requestNumber <= varyingInputs.length
    ? { calls: [{ name: 'strategy_goals', arguments: varyingInputs[requestNumber - 1]!, fragments: requestNumber + 1 }] }
    : { text: '合成重复读取结束。' });
  const done = await agent.start('合成重复读取', requestId).completion;
  assert.equal(done.outcome, 'completed', JSON.stringify({ diagnostic: done.diagnostic, providerErrors: provider.errors, requests: provider.requests.length, delivered }));
  assert.equal(delivered.length, 4, 'test-local cap: preserve the symptom without reproducing 314 calls');
  assert.ok(delivered.every(call => call.action === 'read-goals'));
  assert.deepEqual(delivered.map(call => call.input), varyingInputs.map(({ action: _, ...input }) => input));
  const native = await nativeToolCalls(opened.sessionFile!);
  assert.deepEqual(native.calls.map(call => call.arguments.action), Array(4).fill('read-goals'));
  for (const [index, call] of native.calls.entries()) {
    assert.equal(call.id, provider.requests[index]!.emitted[0]!.id);
    assert.deepEqual(call.arguments, provider.requests[index]!.emitted[0]!.arguments);
  }
  assert.deepEqual(provider.errors, []);
  t.diagnostic('The injected first-action symptom is preserved downstream; the real Provider root cause remains unproved.');
});

test('Issue 115 stops a same-action read loop before the 7th Host dispatch and recovers on the next explicit request', { timeout: 45_000 }, async t => {
  const delivered: { action: string; input: Record<string, unknown> }[] = [];
  const fixture = await miniMaxStrategyFixture(t, async (action, input, context) => {
    context.assertCurrent();
    delivered.push({ action, input });
    return syntheticPayload({ goalScopes: [], candidates: [], claim: 'provided-not-adopted' });
  });
  const { agent, provider, opened, requestId, options } = fixture;
  provider.setResponder(({ requestNumber }) => ({ calls: [{ name: 'strategy_goals', arguments: { action: 'read-goals', query: '无关参数 ' + requestNumber }, fragments: 2 }] }));
  const done = await agent.start('合成读取循环', requestId).completion;
  assert.equal(done.outcome, 'cancelled', JSON.stringify(done.diagnostic));
  assert.equal(done.diagnostic?.code, 'strategy_action_loop');
  assert.equal(delivered.length, 6, 'six identical Host reads dispatch; the seventh is stopped before Host even though the query varies');
  assert.equal(provider.requests.length, 7, 'no Provider continuation after the loop stop');
  assert.ok(delivered.every(call => call.action === 'read-goals'));
  await agent.close();
  const reopened = new ProjectAgent({ ...options, sessionFile: opened.sessionFile });
  t.after(() => reopened.close());
  const snap = await reopened.open();
  assert.equal(snap.lastRun?.outcome, 'cancelled');
  assert.equal(snap.lastRun?.diagnostic?.code, 'strategy_action_loop', 'reopen restores the loop diagnostic from native history');
  let recoveryStep = 0;
  provider.setResponder(() => { recoveryStep += 1; return recoveryStep === 1 ? { calls: [{ name: 'strategy_goals', arguments: { action: 'read-goals' }, fragments: 2 }] } : { text: '合成恢复完成。' }; });
  const recovered = await reopened.start('合成恢复请求', randomUUID()).completion;
  assert.equal(recovered.outcome, 'completed', JSON.stringify(recovered.diagnostic));
  assert.deepEqual(provider.errors, []);
});

test('Issue 115 does not stop legitimate read-source pagination beyond six pages', { timeout: 45_000 }, async t => {
  const delivered: { action: string; input: Record<string, unknown> }[] = [];
  const fixture = await miniMaxStrategyFixture(t, async (action, input, context) => {
    context.assertCurrent();
    delivered.push({ action, input });
    const offset = Number(input.offset ?? 0);
    return syntheticPayload({ source: { id: 'synthetic-source' }, read: { text: '第 ' + offset + ' 页正文', range: { start: offset * 10, end: offset * 10 + 10, total: 100 }, complete: false }, claim: 'provided-not-used-or-verified' });
  });
  const { agent, provider, requestId } = fixture;
  provider.setResponder(({ requestNumber }) => requestNumber <= 8
    ? { calls: [{ name: 'strategy_goals', arguments: { action: 'read-source', sourceId: 'synthetic-source', offset: requestNumber - 1 }, fragments: 2 }] }
    : { text: '合成翻页完成。' });
  const done = await agent.start('合成连续翻页', requestId).completion;
  assert.equal(done.outcome, 'completed', JSON.stringify(done.diagnostic));
  assert.equal(delivered.length, 8, 'eight distinct pages all dispatch; differing results reset the streak');
  assert.notEqual(done.diagnostic?.code, 'strategy_action_loop');
  assert.deepEqual(provider.errors, []);
});

test('Issue 115 resets the read streak when the action or the result changes', { timeout: 45_000 }, async t => {
  const delivered: { action: string }[] = [];
  let counter = 0;
  const fixture = await miniMaxStrategyFixture(t, async (action, _input, context) => {
    context.assertCurrent();
    delivered.push({ action });
    if (action === 'find-sources') return syntheticPayload({ sources: [], range: { start: 0, end: 0, total: 0 }, complete: true });
    counter += 1;
    return syntheticPayload({ goalScopes: [], candidates: [], revision: counter, claim: 'provided-not-adopted' });
  });
  const { agent, provider, requestId } = fixture;
  provider.setResponder(({ requestNumber }) => requestNumber <= 8
    ? { calls: [{ name: 'strategy_goals', arguments: requestNumber % 2 ? { action: 'read-goals' } : { action: 'find-sources' }, fragments: 2 }] }
    : { text: '合成交替动作完成。' });
  const done = await agent.start('合成交替读取', requestId).completion;
  assert.equal(done.outcome, 'completed', JSON.stringify(done.diagnostic));
  assert.equal(delivered.length, 8);
  assert.notEqual(done.diagnostic?.code, 'strategy_action_loop');
  assert.deepEqual(provider.errors, []);
});

test('Issue 115 does not apply the read-loop guard to write actions', { timeout: 45_000 }, async t => {
  const delivered: { action: string }[] = [];
  const fixture = await miniMaxStrategyFixture(t, async (action, _input, context) => {
    context.assertCurrent();
    delivered.push({ action });
    return syntheticPayload({ map: { mapId: 'synthetic', version: 1 }, operationId: 'synthetic-op', claim: 'candidate-not-adopted' });
  });
  const { agent, provider, requestId } = fixture;
  provider.setResponder(({ requestNumber }) => requestNumber <= 8
    ? { calls: [{ name: 'strategy_goals', arguments: { action: 'save-map', mapDraft: { title: '合成', template: 'table', nodes: [{ id: 'G', kind: 'goal', title: '目标' }], edges: [] }, reason: '合成保存' }, fragments: 2 }] }
    : { text: '合成写入完成。' });
  const done = await agent.start('合成重复写入', requestId).completion;
  assert.equal(done.outcome, 'completed', JSON.stringify(done.diagnostic));
  assert.equal(delivered.length, 8, 'save-map is a write action and is exempt from the read-loop guard');
  assert.notEqual(done.diagnostic?.code, 'strategy_action_loop');
  assert.deepEqual(provider.errors, []);
});

test('Issue 115 bounds a parallel batch of identical reads to six Host dispatches and recovers', { timeout: 45_000 }, async t => {
  const delivered: { action: string }[] = [];
  const fixture = await miniMaxStrategyFixture(t, async (action, _input, context) => { context.assertCurrent(); delivered.push({ action }); return syntheticPayload({ goalScopes: [], candidates: [], claim: 'provided-not-adopted' }); });
  const { agent, provider, requestId } = fixture;
  let phase = 'loop', recoveryStep = 0;
  provider.setResponder(() => {
    if (phase === 'loop') return { calls: Array.from({ length: 8 }, () => ({ name: 'strategy_goals', arguments: { action: 'read-goals' } })) };
    recoveryStep += 1;
    return recoveryStep === 1 ? { calls: [{ name: 'strategy_goals', arguments: { action: 'read-goals' } }] } : { text: '合成恢复完成。' };
  });
  const done = await agent.start('合成并行批次循环', requestId).completion;
  assert.equal(done.outcome, 'cancelled', JSON.stringify(done.diagnostic));
  assert.equal(done.diagnostic?.code, 'strategy_action_loop');
  assert.equal(delivered.length, 6, 'a parallel batch of eight identical reads dispatches at most six times (Pi sequential execution)');
  assert.equal(provider.requests.length, 1, 'the batch is one Provider response; no continuation after the stop');
  phase = 'recover';
  const recovered = await agent.start('合成批次后恢复', randomUUID()).completion;
  assert.equal(recovered.outcome, 'completed', JSON.stringify(recovered.diagnostic));
  assert.deepEqual(provider.errors, []);
});

test('Issue 115 bounds five sequential reads plus a two-call batch to six Host dispatches', { timeout: 45_000 }, async t => {
  const delivered: { action: string }[] = [];
  const fixture = await miniMaxStrategyFixture(t, async (action, _input, context) => { context.assertCurrent(); delivered.push({ action }); return syntheticPayload({ goalScopes: [], candidates: [], claim: 'provided-not-adopted' }); });
  const { agent, provider, requestId } = fixture;
  provider.setResponder(({ requestNumber }) => {
    if (requestNumber <= 5) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-goals' } }] };
    if (requestNumber === 6) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-goals' } }, { name: 'strategy_goals', arguments: { action: 'read-goals' } }] };
    return { text: '合成完成。' };
  });
  const done = await agent.start('合成顺序加批次', requestId).completion;
  assert.equal(done.outcome, 'cancelled', JSON.stringify(done.diagnostic));
  assert.equal(done.diagnostic?.code, 'strategy_action_loop');
  assert.equal(delivered.length, 6, 'five sequential reads plus a two-call batch stop at the sixth Host dispatch');
  assert.deepEqual(provider.errors, []);
});

test('Issue 115 an exempt operation between reads resets the streak and does not false-stop', { timeout: 45_000 }, async t => {
  const delivered: { action: string }[] = [];
  const fixture = await miniMaxStrategyFixture(t, async (action, _input, context) => {
    context.assertCurrent(); delivered.push({ action });
    if (action === 'operation') return syntheticPayload({ operationId: 'synthetic-op', status: 'completed' });
    return syntheticPayload({ goalScopes: [], candidates: [], claim: 'provided-not-adopted' });
  });
  const { agent, provider, requestId } = fixture;
  provider.setResponder(({ requestNumber }) => {
    if (requestNumber <= 6) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-goals' } }] };
    if (requestNumber === 7) return { calls: [{ name: 'strategy_goals', arguments: { action: 'operation', operationId: randomUUID() } }] };
    if (requestNumber === 8) return { calls: [{ name: 'strategy_goals', arguments: { action: 'read-goals' } }] };
    return { text: '合成豁免重置完成。' };
  });
  const done = await agent.start('合成豁免重置', requestId).completion;
  assert.equal(done.outcome, 'completed', JSON.stringify(done.diagnostic));
  assert.notEqual(done.diagnostic?.code, 'strategy_action_loop');
  assert.equal(delivered.length, 8);
  assert.equal(delivered[6]!.action, 'operation');
  assert.deepEqual(provider.errors, []);
});

test('Issue 115 the read-loop guard does not apply to the business-role project-sources variant', { timeout: 45_000 }, async t => {
  const delivered: { action: string }[] = [];
  const fixture = await miniMaxStrategyFixture(t, async (action, _input, context) => { context.assertCurrent(); delivered.push({ action }); return syntheticPayload({ source: { id: 'synthetic-source' }, read: { text: '合成正文', range: { start: 0, end: 4, total: 4 }, complete: true }, claim: 'provided-not-used-or-verified' }); }, 'project-sources');
  const { agent, provider, requestId } = fixture;
  provider.setResponder(({ requestNumber }) => requestNumber <= 8 ? { calls: [{ name: 'strategy_goals', arguments: { action: 'read-source', sourceId: 'synthetic-source' } }] } : { text: '合成项目资料完成。' });
  const done = await agent.start('合成项目资料读取', requestId).completion;
  assert.equal(done.outcome, 'completed', JSON.stringify(done.diagnostic));
  assert.notEqual(done.diagnostic?.code, 'strategy_action_loop', 'the guard is scoped to the full strategy co-creation tool, not business-role project-sources');
  assert.equal(delivered.length, 8);
  assert.deepEqual(provider.errors, []);
});
