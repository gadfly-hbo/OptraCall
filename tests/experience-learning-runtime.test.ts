import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { startToolProvider } from './fixtures/tool-provider.ts';
import { readSavedTaskReply } from '../src/host/project-history.ts';
import { createNativeSnapshotReadBudget } from '../src/host/native-session-snapshot.ts';
import { parseAgentCandidateDetails, agentCandidateDetailsSha256 } from '../src/agent/agent-candidate.ts';

async function fixture(t: TestContext) {
  const root = path.resolve('.local/fourbase-modules/m6/implementation/runtime', randomUUID()), projectDirectory = path.join(root, 'project');
  for (const name of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, name), { recursive: true });
  const provider = await startToolProvider(); t.after(() => provider.close());
  const options = { projectId: randomUUID(), taskId: randomUUID(), projectDirectory, sessionDirectory: path.join(root, 'native'), resourceRoot: path.join(root, 'pi'), codeRoot: process.cwd(), managementPorts: [], configuration: { id: 'm6-synthetic', revision: 1, name: 'M6合成', provider: 'synthetic', model: 'synthetic', api: 'openai-completions' as const, apiKey: 'synthetic-m6-only', baseUrl: provider.baseUrl } };
  const agents: ProjectAgent[] = []; t.after(async () => { for (const a of agents) await a.close(); });
  return { root, options, provider, create: (extra: Partial<ProjectAgentOptions> = {}) => { const a = new ProjectAgent({ ...options, ...extra }); agents.push(a); return a; } };
}

test('M6 EL02 actual Pi: an unbound ordinary task can read cross-Case sources directly or through legal nested tools', { timeout: 60_000 }, async t => {
  for (const nested of [false, true]) await t.test(nested ? 'nested' : 'direct', async t => {
    const f = await fixture(t), calls: any[] = [], input = { query: '合成复盘', pageSize: 5 };
    const agent = f.create({ caseSources: async (action, value, ctx) => {
      ctx.assertCurrent(); calls.push({ action, value, requestId: ctx.requestId, sessionId: ctx.sessionId, toolCallId: ctx.toolCallId });
      return { content: [{ type: 'text', text: 'SYNTHETIC_CROSS_CASE_READ_ONLY' }], details: { type: 'optracall.case-source-read', action } };
    } });
    const args = { action: 'find', ...input };
    f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '合成回答，仍需准确回读。' } : { calls: [{ name: nested ? 'codemode' : 'read_case_sources', arguments: nested ? { code: `const r=await tools.read_case_sources(${JSON.stringify(args)});text(r);` } : args }] });
    const opened = await agent.open(); assert.ok(opened.tools.includes('read_case_sources'), 'approved cross-Case readonly capability must be exposed by the real SDK');
    const requestId = randomUUID(), run = agent.start('无Case任务，按需核对以往资料。', requestId);
    await run.accepted; assert.equal((await run.completion).outcome, 'completed');
    assert.equal(calls.length, 1); assert.equal(calls[0].action, 'find'); assert.deepEqual(calls[0].value, input); assert.equal(calls[0].requestId, requestId); assert.equal(calls[0].sessionId, opened.sessionId); assert.ok(calls[0].toolCallId);
    const native = await readFile((await agent.snapshot()).sessionFile!, 'utf8');
    assert.ok(native.includes(nested ? 'codemode' : 'read_case_sources')); assert.ok(JSON.stringify(f.provider.requests.at(-1)?.body.messages).includes('SYNTHETIC_CROSS_CASE_READ_ONLY'));
  });
});

test('M6 EL08 real native candidate chooses v2 only for new refs; feature-off keeps old tools and rejects new writes', async t => {
  const f = await fixture(t), input = { content: { kind: 'experience', title: '合成复盘', bodyMd: '保留反例、失败和无反馈，不推定有效。', aliases: [], scope: null, caution: '纯合成' }, sourceRefs: [] as any[] };
  const sources = async () => ({ content: [{ type: 'text' as const, text: 'unused' }], details: {} });
  const agent = f.create({ caseSources: sources });
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: '保存是工程回执，不是有效结论。' } : { calls: [{ name: 'record_agent_candidate', arguments: input }] });
  assert.equal((await agent.start('原格式', randomUUID()).completion).outcome, 'completed');
  let snapshot = await agent.snapshot();
  const read = async () => (await readFile(snapshot.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(e => e.message?.toolName === 'record_agent_candidate');
  const first = (await read())[0], original = parseAgentCandidateDetails(first.message.details), originalHash = agentCandidateDetailsSha256(original); assert.equal(original.schemaVersion, 1);
  input.sourceRefs = [{ type: 'case-decision', caseStoreId: randomUUID(), caseId: randomUUID(), recordId: randomUUID(), revision: 1 }];
  assert.equal((await agent.start('新增准确来源', randomUUID()).completion).outcome, 'completed');
  const accepted = await read(); assert.equal(parseAgentCandidateDetails(accepted[1].message.details).schemaVersion, 2); assert.deepEqual(accepted[1].message.details.sourceRefs, input.sourceRefs); assert.equal(agentCandidateDetailsSha256(parseAgentCandidateDetails(accepted[0].message.details)), originalHash);
  snapshot = await agent.snapshot(); await agent.close();
  const disabled = f.create({ sessionFile: snapshot.sessionFile }); assert.ok(!(await disabled.open()).tools.includes('read_case_sources'));
  assert.equal((await disabled.start('兼容关闭不接受新增来源', randomUUID()).completion).outcome, 'completed');
  const after = await read(); assert.equal(after.length, 3); assert.equal(after[2].message.isError, true); assert.ok(JSON.stringify(after[2]).includes('experience_learning_disabled')); assert.equal(after[2].message.details?.type, undefined);
  assert.equal(agentCandidateDetailsSha256(parseAgentCandidateDetails(after[0].message.details)), originalHash); assert.equal(parseAgentCandidateDetails(after[1].message.details).schemaVersion, 2);
});

test('M6 EL09 scope: plugin/sealed/managed/no-task resources never receive the new tool', async t => {
  const f = await fixture(t), caseSources = async () => ({ content: [{ type: 'text' as const, text: 'unavailable' }], details: {} });
  const workspace = { cwd: path.join(f.options.projectDirectory, '020_clean'), systemPrompt: ['Synthetic plugin only.'] };
  for (const extra of [{ taskId: undefined }, { workspace }, { workspace: { ...workspace, capabilityPolicy: 'text-only' as const } }, { workspace: { ...workspace, capabilityPolicy: 'fixed-draft' as const } }, { protectedExecution: { id: randomUUID(), profile: 'ordinary' as const, cwd: workspace.cwd, writableRoot: workspace.cwd, readRoots: [] } }]) {
    assert.ok(!(await f.create({ ...extra, caseSources, sessionDirectory: path.join(f.root, randomUUID()) }).open()).tools.includes('read_case_sources'));
  }
});

test('M6 EL09 stop revokes deferred source reads and never appends a late source payload', async t => {
  const f = await fixture(t); let entered!: () => void, release!: () => void, denied = false;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const agent = f.create({ caseSources: async (_action, _input, ctx) => { entered(); await new Promise<void>(resolve => { release = resolve; }); try { ctx.assertCurrent(); } catch (error) { denied = true; throw error; } return { content: [{ type: 'text', text: 'LATE_SOURCE_MUST_NOT_APPEAR' }], details: {} }; } });
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'done' } : { calls: [{ name: 'read_case_sources', arguments: { action: 'find' } }] });
  const run = agent.start('取消合成读取', randomUUID()); await waiting; const stopping = agent.stop(); await new Promise(resolve => setTimeout(resolve, 20)); release(); await stopping;
  assert.equal((await run.completion).outcome, 'cancelled'); assert.equal(denied, true); assert.ok(!(await readFile((await agent.snapshot()).sessionFile!, 'utf8')).includes('LATE_SOURCE_MUST_NOT_APPEAR'));
});

test('M6 EL09 completed extension ctx cannot read on a later run, while current legal nested remains usable', async t => {
  const f = await fixture(t), extensions = path.join(f.options.resourceRoot, 'extensions'); await mkdir(extensions, { recursive: true });
  await writeFile(path.join(extensions, 'source-ctx.ts'), `export default pi=>{const parameters={type:'object',properties:{},additionalProperties:false};pi.registerTool({name:'capture_source_ctx',label:'Capture',description:'Synthetic',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{globalThis.__m6ctx=ctx;return{content:[{type:'text',text:'captured'}],details:{}};}});pi.registerTool({name:'reuse_source_ctx',label:'Reuse',description:'Synthetic',parameters,execute:async(_id,_args,signal)=>{const r=await globalThis.__m6ctx.executeTool('read_case_sources',{action:'find'},{signal});return{content:[{type:'text',text:JSON.stringify(r)}],details:{}};}});};`);
  let step = 0, calls = 0;
  const plan = [{ calls: [{ name: 'capture_source_ctx', arguments: {} }] }, { text: 'captured' }, { calls: [{ name: 'reuse_source_ctx', arguments: {} }] }, { text: 'old caller rejected' }, { calls: [{ name: 'codemode', arguments: { code: "text(await tools.read_case_sources({action:'find'}));" } }] }, { text: 'current completed' }];
  f.provider.setResponder(() => plan[step++] ?? { text: 'done' });
  const agent = f.create({ caseSources: async () => { calls++; return { content: [{ type: 'text', text: 'CURRENT_SOURCE_ONLY' }], details: {} }; } });
  for (let i = 0; i < 2; i++) assert.equal((await agent.start('原调用资格' + i, randomUUID()).completion).outcome, 'completed');
  assert.equal(calls, 0); assert.equal((await agent.start('当前嵌套', randomUUID()).completion).outcome, 'completed'); assert.equal(calls, 1);
});

test('M6 EL02 accurate native-reply sources share the caller read budget and cancellation without replay', async t => {
  const f = await fixture(t), agent = f.create();
  f.provider.setResponder(() => ({ text: '预算及取消的合成原文' }));
  assert.equal((await agent.start('合成原回复', randomUUID()).completion).outcome, 'completed');
  const saved = await agent.snapshot(), entries = (await readFile(saved.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const reply = entries.find(e => e.type === 'message' && e.message.role === 'assistant'); assert.ok(reply);
  const project: any = { rootPath: f.options.projectDirectory }, task: any = { sessionDirectory: f.options.sessionDirectory };
  const selection = { sessionId: saved.sessionId, messageId: reply.id };
  const abort = new AbortController(); abort.abort(new Error('m6_original_call_cancelled'));
  await assert.rejects(readSavedTaskReply(project, task, selection, { signal: abort.signal }), /m6_original_call_cancelled/);
  const budget = createNativeSnapshotReadBudget(); budget.files = 0;
  await assert.rejects(readSavedTaskReply(project, task, selection, { budget }), e => (e as any).code === 'native_snapshot_budget_exhausted');
  assert.match((await readSavedTaskReply(project, task, selection)).text, /合成原文/);
});
