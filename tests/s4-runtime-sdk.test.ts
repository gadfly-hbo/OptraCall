import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import type { SemanticContextReadPort, SemanticContextToolResult } from '../src/agent/semantic-context.ts';
import type { StudioPort } from '../src/agent/studio.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';

const graphInput = { action: 'graph', operation: 'find', query: 'synthetic scope' };
const modelContent = JSON.stringify({ type: 'synthetic-graph', definition: 'Synthetic net sales deduct returns.', method: 'Choose methods autonomously.', field: 'original-byte-location-337', scope: 'one synthetic store', unknown: 'causal effect remains unknown', sources: ['synthetic-exact-revision'] });
const answer: SemanticContextToolResult = { content: [{ type: 'text', text: modelContent }], details: { schemaVersion: 1, type: 'optracall.semantic-context-result', action: 'find', state: 'available', items: [], unknownTime: [], indexRevision: 1, coverage: { complete: true, continuation: null, gaps: [] } } };

async function fixture(t: TestContext, managed = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'optracall-s4-sdk-')), projectDirectory = path.join(root, 'project'), cwd = path.join(projectDirectory, '020_clean');
  for (const dir of [cwd, path.join(projectDirectory, '060_reports')]) await mkdir(dir, { recursive: true, mode: 0o700 });
  const provider = await startToolProvider();
  const options: ProjectAgentOptions = { projectId: randomUUID(), taskId: randomUUID(), projectDirectory, codeRoot: process.cwd(), sessionDirectory: path.join(root, 'native'), resourceRoot: path.join(root, 'resources'), managementPorts: [], configuration: { id: randomUUID(), revision: 1, name: 'Synthetic S4 SDK', provider: 'synthetic', api: 'openai-completions', baseUrl: provider.baseUrl, model: 'synthetic-s4', apiKey: 'synthetic-s4-only' }, ...(managed ? { protectedExecution: { id: randomUUID(), profile: 'ordinary', cwd, writableRoot: cwd, readRoots: [] } } : {}) };
  const agents: ProjectAgent[] = [];
  const create = (override: Partial<ProjectAgentOptions> = {}) => { const agent = new ProjectAgent({ ...options, ...override }); agents.push(agent); return agent; };
  t.after(async () => { for (const agent of agents) await agent.close(); await provider.close(); });
  return { root, options, provider, create };
}

test('S4A01/09: actual Pi SDK in both ordinary modes exposes the Host read facet, carries content onward and saves/reopens the real tool result', async t => {
  for (const managed of [false, true]) await t.test(managed ? 'managed ordinary' : 'unmanaged ordinary', { skip: managed && process.platform !== 'darwin' }, async t => {
    const f = await fixture(t, managed); let calls = 0;
    const port: SemanticContextReadPort = async (action, input, ctx) => { calls++; assert.equal(action, 'graph'); assert.deepEqual(input, { operation: 'find', query: 'synthetic scope' }); assert.equal(typeof ctx.runToken, 'object'); ctx.assertCurrent(); return answer; };
    const agent = f.create({ semanticContextRead: port });
    const opened = await agent.open(); assert.ok(opened.tools.includes('read_semantic_context')); assert.ok(opened.tools.includes('bash')); assert.ok(!opened.tools.includes('record_analysis_sources')); assert.equal(calls, 0); assert.equal(f.provider.requests.length, 0);
    f.provider.setResponder(({ requestNumber, recentToolResults }) => {
      if (requestNumber === 1) return { calls: [{ name: 'read_semantic_context', arguments: graphInput }] };
      assert.equal(recentToolResults.length, 1); assert.match(JSON.stringify(recentToolResults), /original-byte-location-337/); assert.match(JSON.stringify(recentToolResults), /causal effect remains unknown/);
      return { text: 'Synthetic answer after the semantic content. Calculation tools remain available.' };
    });
    const running = agent.start('Synthetic query through actual Pi SDK.', randomUUID()); await running.accepted; assert.equal((await running.completion).outcome, 'completed'); assert.equal(calls, 1);
    const snapshot = await agent.snapshot(); const before = await readFile(snapshot.sessionFile!, 'utf8');
    const records = before.trim().split('\n').map(line => JSON.parse(line));
    const saved = records.find(record => record.message?.role === 'toolResult' && record.message.toolName === 'read_semantic_context'); assert.ok(saved); assert.equal(saved.message.content[0].text, modelContent); assert.deepEqual(saved.message.details, answer.details);
    const requests = f.provider.requests.length; await agent.close();
    const reopened = f.create({ semanticContextRead: port, sessionFile: snapshot.sessionFile }); const restored = await reopened.open();
    assert.match(JSON.stringify(restored.messages), /original-byte-location-337/); assert.equal(calls, 1); assert.equal(f.provider.requests.length, requests);
    assert.ok((await readFile(snapshot.sessionFile!, 'utf8')).startsWith(before), 'passive reopen preserves original native bytes');
  });
});

test('S4A03: actual managed SDK graph schema refuses old directory actions and unauthorized record writes before Host IO', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t, true); let reads = 0, writes = 0;
  const agent = f.create({ semanticContextRead: async () => { reads++; return answer; }, semanticContext: async () => { writes++; return answer; } });
  const opened = await agent.open(); assert.ok(opened.tools.includes('read_semantic_context')); assert.ok(!opened.tools.includes('record_analysis_sources'));
  f.provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [
    { name: 'read_semantic_context', arguments: { action: 'find', query: 'forbidden old directory' } },
    { name: 'read_semantic_context', arguments: { ...graphInput, projectId: 'forged' } },
    { name: 'read_semantic_context', arguments: { ...graphInput, sourceRoot: '/arbitrary' } },
    { name: 'record_analysis_sources', arguments: {} },
  ] } : { text: 'Synthetic denied calls leave ordinary answer available.' });
  assert.equal((await agent.start('Synthetic forbidden semantic actions.', randomUUID()).completion).outcome, 'completed'); assert.equal(reads, 0); assert.equal(writes, 0);
  const entries = (await readFile((await agent.snapshot()).sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const tools = entries.filter(entry => entry.message?.role === 'toolResult'); assert.equal(tools.length, 4); assert.ok(tools.every(entry => entry.message.isError));
});

test('S4A01/03: actual unmanaged Pi codemode may call the same bounded graph tool', async t => {
  const f = await fixture(t); let reads = 0;
  f.provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: 'codemode', arguments: { code: `text(await tools.read_semantic_context(${JSON.stringify(graphInput)}));` } }] } : { text: 'Synthetic graph content returned through original SDK nesting.' });
  const agent = f.create({ semanticContextRead: async () => { reads++; return answer; } });
  assert.equal((await agent.start('Synthetic nested query.', randomUUID()).completion).outcome, 'completed'); assert.equal(reads, 1); assert.match(JSON.stringify(f.provider.requests[1].body.messages), /original-byte-location-337/);
});

test('S4A05: actual SDK stop in both ordinary modes waits matching Host cleanup and prevents another model request', async t => {
  for (const managed of [false, true]) await t.test(managed ? 'managed ordinary' : 'unmanaged ordinary', { skip: managed && process.platform !== 'darwin' }, async t => {
    const f = await fixture(t, managed); let entered!: () => void, reap!: () => void, context: Parameters<SemanticContextReadPort>[2] | undefined;
    const entry = new Promise<void>(resolve => { entered = resolve; }), reaped = new Promise<void>(resolve => { reap = resolve; });
    f.provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: 'read_semantic_context', arguments: graphInput }] } : { text: 'UNEXPECTED_NEXT_MODEL_REQUEST' });
    const agent = f.create({ semanticContextRead: async (_action, _input, ctx) => {
      context = ctx; ctx.registerCleanup!(async () => reaped); entered();
      return await new Promise((_resolve, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true }));
    } });
    const running = agent.start('Synthetic delayed Host graph read.', randomUUID()); await running.accepted; await entry;
    let stopped = false; const stopping = agent.stop().then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(context!.signal.aborted, true); assert.equal(agent.busy, true); assert.equal(stopped, false); assert.equal(f.provider.requests.length, 1);
    reap(); await stopping; assert.equal((await running.completion).outcome, 'cancelled'); assert.equal(agent.busy, false); assert.equal(f.provider.requests.length, 1);
    assert.throws(() => context!.assertCurrent());
  });
});

// Studio ordinary reads share this existing SDK/profile lifecycle fixture.
test('SU15/16/21: ordinary modes can read exact Studio assets through a Host read-only facet without granting write tools', { timeout: 60_000 }, async t => {
  for (const managed of [false, true]) await t.test(managed ? 'managed ordinary' : 'unmanaged ordinary', { skip: managed && process.platform !== 'darwin' }, async t => {
    const f = await fixture(t, managed), calls: string[] = [];
    const port: StudioPort = async (action, _input, ctx) => {
      ctx.assertCurrent(); calls.push(action);
      return { content: [{ type: 'text', text: 'EXACT_RULE_1_2_BODY' }], details: { action, complete: true, ref: { authority: 'sap-metric', id: 'approved-rule', version: '1.2' }, text: 'EXACT_RULE_1_2_BODY' } };
    };
    const agent = f.create({ studioRead: port });
    const opened = await agent.open();
    assert.ok(opened.tools.includes('studio_assets'), 'a separately granted read facet must advertise the existing Studio tool');
    assert.ok(!opened.tools.includes('record_analysis_sources'));
    assert.ok(!opened.tools.includes('save_case_decision_draft'));
    assert.equal(calls.length, 0, 'opening a task does not read or adopt an asset');
    f.provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: 'studio_assets', arguments: { action: 'read-source', systemId: randomUUID(), payload: { ref: { authority: 'sap-metric', id: 'approved-rule', version: '1.2' } } } }] }
      : requestNumber === 2 ? { calls: [{ name: 'studio_assets', arguments: { action: 'save-asset', payload: { body: 'UNAUTHORIZED_WRITE' } } }, { name: 'studio_assets', arguments: { action: 'declare-use', payload: {} } }, { name: 'studio_assets', arguments: { action: 'contribute', payload: {} } }] }
        : { text: 'Read-only source received; no source declaration or professional verification performed.' });
    assert.equal((await agent.start('Read a qualified rule if useful.', randomUUID()).completion).outcome, 'completed');
    assert.deepEqual(calls, ['read-source']);
    const snapshot = await agent.snapshot();
    const results = snapshot.messages.filter(message => message.role === 'toolResult' && message.toolName === 'studio_assets');
    assert.equal(results.length, 4); assert.equal(results[0]!.isError, false); assert.ok(results.slice(1).every(result => result.isError));
    assert.match(JSON.stringify(f.provider.requests[1]?.body.messages), /EXACT_RULE_1_2_BODY/);
    const before = await readFile(snapshot.sessionFile!, 'utf8');
    await agent.close();
    const reopened = f.create({ sessionFile: snapshot.sessionFile, studioRead: port });
    assert.match(JSON.stringify((await reopened.open()).messages), /EXACT_RULE_1_2_BODY/);
    assert.ok((await readFile(snapshot.sessionFile!, 'utf8')).startsWith(before));
    assert.equal(calls.length, 1, 'passive reopen does not manufacture another asset read');
  });
});

test('SU07/24: a granted ordinary Studio port accepts an Agent contribution while its source owner remains Host-bound', { timeout: 45_000 }, async t => {
  const f = await fixture(t, false), received: Record<string, unknown>[] = [];
  const payload = { scope: 'enterprise', report: { authority: 'task', id: f.options.taskId, taskId: f.options.taskId, projectId: f.options.projectId, version: 'a'.repeat(64), locator: '060_reports/synthetic.md' }, sourceRefs: [], baseRefs: [], candidate: { kind: 'rule', title: 'Candidate only', body: 'A source boundary to review', scope: 'Synthetic enterprise' } };
  const agent = f.create({ studio: async (action, input, ctx) => { ctx.assertCurrent(); assert.equal(action, 'contribute'); received.push(input); return { content: [{ type: 'text', text: 'Contribution saved, formal assets unchanged.' }], details: { type: 'optracall.studio', action, result: { claim: 'candidate-not-published' } } }; } });
  f.provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: 'studio_assets', arguments: { action: 'contribute', systemId: randomUUID(), payload } }] } : { text: 'Contribution retained for review; no publication performed.' });
  assert.equal((await agent.start('Retain a reusable source correction from this ordinary task.', randomUUID()).completion).outcome, 'completed');
  assert.equal(received.length, 1); assert.deepEqual(received[0]!.payload, payload);
  assert.equal('sourceProjectId' in received[0]!, false); assert.equal('sourceTaskId' in received[0]!, false);
});

test('SU13/16: cancelling a read-only Studio invocation waits its Host cleanup and never resumes the model from a late result', { timeout: 45_000, skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t, true);
  let entered!: () => void, release!: () => void, current: Parameters<StudioPort>[2] | undefined;
  const reached = new Promise<void>(resolve => { entered = resolve; }), cleanup = new Promise<void>(resolve => { release = resolve; });
  const agent = f.create({ studioRead: async (_action, _input, ctx) => { current = ctx; ctx.registerCleanup!(async () => cleanup); entered(); return new Promise((_resolve, reject) => ctx.signal.addEventListener('abort', () => reject(Error('synthetic-read-cancelled')), { once: true })); } });
  f.provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: 'studio_assets', arguments: { action: 'catalog' } }] } : { text: 'UNEXPECTED_LATE_CONTINUATION' });
  const run = agent.start('Read permitted asset metadata if relevant.', randomUUID()); await run.accepted; await reached;
  let stopped = false; const stopping = agent.stop().then(() => { stopped = true; });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(current!.signal.aborted, true); assert.equal(agent.busy, true); assert.equal(stopped, false);
  release(); await stopping; assert.equal((await run.completion).outcome, 'cancelled');
  assert.equal(f.provider.requests.length, 1); assert.throws(() => current!.assertCurrent());
});

test('SU13: a read facet is not automatically granted to sealed profiles or a managed task that only has the old full port', async t => {
  const f = await fixture(t, false);
  const denied: StudioPort = async () => assert.fail('Unavailable profile must not invoke Studio.');
  for (const capabilityPolicy of ['fixed-draft', 'text-only', 'source-reader'] as const) {
    const agent = f.create({ workspace: { cwd: path.join(f.options.projectDirectory!, '020_clean'), systemPrompt: ['Synthetic sealed profile'], capabilityPolicy }, studioRead: denied });
    assert.ok(!(await agent.open()).tools.includes('studio_assets')); await agent.close();
  }
  await t.test('managed full port is not a read grant', { skip: process.platform !== 'darwin' }, async t => {
    const managed = await fixture(t, true), agent = managed.create({ studio: denied });
    assert.ok(!(await agent.open()).tools.includes('studio_assets'));
  });
});
