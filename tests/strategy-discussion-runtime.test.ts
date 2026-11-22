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

async function miniMaxStrategyFixture(t: TestContext, strategyDiscussion: ProjectAgentOptions['strategyDiscussion']) {
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
  const agent = new ProjectAgent({
    projectId: 'strategy-discussion:' + randomUUID(),
    workspace: { cwd, systemPrompt: ['Use only the synthetic strategy tool when needed.'], capabilityPolicy: 'strategy-discussion' },
    sessionDirectory: path.join(root, 'native'), resourceRoot, codeRoot: fixtureCode, managementPorts: [],
    configuration: { id: 'minimax-m31-flash', name: 'Synthetic MiniMax loopback', revision: 1, provider: 'minimax-cn', api: 'anthropic-messages', baseUrl: provider.baseUrl, model: 'MiniMax-M3.1-Flash', apiKey: 'synthetic-minimax-only' },
    strategyDiscussion,
  });
  t.after(async () => { await agent.close(); await provider.close(); });
  const opened = await agent.open();
  return { agent, provider, opened, requestId };
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
